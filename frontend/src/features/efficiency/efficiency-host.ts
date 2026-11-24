import {workspaceServices} from '@/features/workspace/installed-services';
import {snippetsServices} from '@/features/snippets/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {confirmModal} from '@/shared/workspace-prompts';
import {api} from '@/shared/api/workspace-request';
import {showActionMenu} from '@/shared/action-menu';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {notify} from '@/features/efficiency/notification-actions';
import {refreshIcons} from '@/shared/ui/icon-service';
import {keepTerminalKeyboardClosed} from '@/shared/browser-ui';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {openTerminal,focusTerminalSession} from '@/features/terminal/terminal-page';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSurfaceCache,terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalHistory} from '../terminal/terminal-history';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { terminalDirectory } from '@/features/terminal/terminal-directory-workspace';
import { activateTab } from '@/features/workspace/workspace-dock-runtime';
import { localizedWorkspaceTabTitle } from '../workspace/workspace-tab-presentation';
import type { Forward as WorkspaceForward } from '../forwards/forward-model';
import { stopTerminalBroadcast, terminalBroadcastKeys } from '../session-efficiency/terminal-broadcast-workspace';
import type { QuickSshSearchTarget } from '../quick/quick-port';
import type { RemoteProfile } from '../remote/profile-model';
import type { TerminalSurfaceSession } from '../terminal/terminal-surface-service';
import type { Connection, Forward, Profile, Tab } from './palette-model';
import type { EfficiencyPort } from './efficiency-runtime';

type ConnectionState = Connection & {identity_file?: string; updated_at?: string | number};
type ProfileState = Profile & RemoteProfile;
type ForwardState = Forward & WorkspaceForward & {type?: string};
type TabState = Tab & {id?: number};
type Session = Pick<TerminalSurfaceSession, 'id' | 'connected' | 'quickToken'> & {connection?: ConnectionState; connectionRevision?: number};

function rowStamp<T>(rows: () => T[], match: (row: T) => boolean, fingerprint: (row: T) => readonly unknown[]) {
  const selected = rows().find(match);
  const original = selected === undefined ? undefined : JSON.stringify(fingerprint(selected));
  return () => {
    if (original === undefined) return false;
    const row = rows().find(match);
    return row !== undefined && JSON.stringify(fingerprint(row)) === original;
  };
}

function capture(kind: string, id: string | number) {
  const equal = (value: number | string) => String(value) === String(id);
  const byId = (row: {id: number | string}) => equal(row.id);
  switch (kind) {
    case 'connection': return rowStamp(() => applicationState.connections, byId, row => [row.ssh_host, row.ssh_port, row.ssh_user, row.identity_file, row.updated_at]);
    case 'profile': return rowStamp(() => applicationState.remoteProfiles, byId, row => [row.protocol, row.host, row.port, row.options]);
    case 'tab': return rowStamp(() => applicationState.tabs, row => equal(row.key), row => [row.kind, row.id]);
    case 'group': return rowStamp(() => workspaceServices.termaWorkspaceGroups!.list(), byId, row => [row.id]);
    case 'snippet': return rowStamp(() => snippetsServices.termaSnippets.service.state.items, byId, row => [row.command, row.workflow_json, row.quick_action]);
    case 'workspace': return rowStamp(() => quickServices.termaNamedWorkspacePresets.items(), byId, row => [row.id]);
    default: return rowStamp(() => applicationState.connections.flatMap(c => (c.forwards || []) as ForwardState[]), byId,
      row => [row.connection_id, row.bind_host, row.bind_port, row.type]);
  }
}

function dispatch(kind: string, id: string | number, target: object = {}) {
  const savedId = Number(id);
  switch (kind) {
    case 'snippets.manage': return snippetsServices.termaSnippets.navigate('manager');
    case 'workspaces.manage': return quickServices.termaNamedWorkspaces.manager();
    case 'workspaces.save': return quickServices.termaNamedWorkspaces.save();
    case 'terminal.broadcast': return sessionEfficiencyServices.termaSessionEfficiency.openBroadcast();
    case 'tabs.restore': return sessionEfficiencyServices.termaSessionEfficiency.history.restore();
    case 'ssh.key-wizard': return settingsServices.termaKeyWizard.open();
    case 'ssh.config-import': return dataExchangeServices.termaSshConfigDiscovery.open();
    case 'sftp.external-edits': return window.termaDesktop ? filesServices.termaSftpWorkflow.externalManager() : false;
    case 'connection.terminal': return currentConnection(savedId) && openTerminal(savedId);
    case 'connection.sftp': return currentConnection(savedId) && filesServices.termaSftpPage.open(savedId, 'path' in target && typeof target.path === 'string' && target.path || '.');
    case 'connection.forwards': return currentConnection(savedId) && forwardsServices.termaForwardWorkspace.openConnection(savedId);
    case 'quick-ssh': return quickServices.termaQuickViews?.startQuickSshConnection(target);
    case 'quick-ssh-new': return quickServices.termaQuickSshFlow?.prefill(target as QuickSshSearchTarget);
    case 'group': return workspaceServices.termaWorkspaceGroups?.switchGroup(String(id));
    case 'tab': return applicationState.tabs.some(tab => tab.key === id) && activateTab(String(id));
    case 'profile': {
      const profile = remoteServices.termaRemoteProfiles.byId(savedId);
      return profile ? remoteServices.termaRemoteProfiles.open(profile) : false;
    }
    case 'snippet': return snippetsServices.termaSnippets.navigate('execute', savedId);
    case 'workspace': return quickServices.termaNamedWorkspaces.preview(savedId);
    default: return false;
  }
}

const sessionConnection = (session: Session | undefined) => session?.connection || currentConnection(session?.id);
const connectionStamp = (connection: ConnectionState | undefined) => JSON.stringify([
  connection?.ssh_host, connection?.ssh_port, connection?.ssh_user, connection?.updated_at
]);

function quickCommandTarget(key: string) {
  const session = terminalSessions.get(key), tab = applicationState.tabs.find(item => item.key === key);
  if (!session || !tab) return null;
  const connection = sessionConnection(session), revision = session.connectionRevision, token = session.quickToken;
  const stamp = connectionStamp(connection);
  return {
    connection: {ssh_host: connection?.ssh_host, ssh_user: connection?.ssh_user},
    current: () => terminalSessions.get(key) === session && applicationState.tabs.includes(tab) && session.connected
      && session.connectionRevision === revision && session.quickToken === token && connectionStamp(sessionConnection(session)) === stamp
  };
}

export function createEfficiencyHost(): EfficiencyPort {
  return {
    tr: (key, params) => tr(key, params), desktop: () => Boolean(window.termaDesktop), api: (url, options) => api(url, options),
    unlocked: () => requireConfigEncryptionUnlocked(tr('terminal:quick_commands.bar')),
    snapshot: () => ({connections:applicationState.connections, profiles: applicationState.remoteProfiles, tabs:applicationState.tabs.flatMap(tab=>typeof tab.kind==='string'&&typeof tab.title==='string'?[{...tab,kind:tab.kind,title:tab.title}]:[]), groups: workspaceServices.termaWorkspaceGroups!.list(), snippets: snippetsServices.termaSnippets.service.state.items, workspaces: quickServices.termaNamedWorkspacePresets.items()}),
    parse: query => quickServices.termaQuickSshService!.parse(query),
    exact: target => quickServices.termaQuickSshService!.matching(target as QuickSshSearchTarget | null) as Connection[],
    endpoint: target => quickServices.termaQuickSshService!.endpoint(target),
    forward: (connection, forward) => quickServices.termaQuickForwardPresentation!.describe(connection, forward),
    profile: profile => ({icon: remoteServices.termaRemoteProfiles.presentation.icon(profile.protocol), label: remoteServices.termaRemoteProfiles.presentation.label(profile.protocol), endpoint: remoteServices.termaRemoteProfiles.presentation.endpoint(profile as ProfileState)}),
    tabTitle: tab => localizedWorkspaceTabTitle(tab), workspaceCount: workspace => quickServices.termaNamedWorkspacePresets.count(workspace.layout || {}),
    capture, dispatch,
    load: () => Promise.all([snippetsServices.termaSnippets.service.load(), quickServices.termaNamedWorkspacePresets.list().catch(() => quickServices.termaNamedWorkspacePresets.items())]),
    page: (route, run) => quickServices.termaCommandNavigation.start(route, run), navigationActive: () => quickServices.termaCommandNavigation.active(),
    exit: () => quickServices.termaCommandNavigation.exit(), notify: text => notify(text, 'error'),
    quickForwardIsActive: forward => forwardsServices.termaForwardRuntime.isActive(forward as WorkspaceForward),
    quickForwardAccessUrl: forward => forwardsServices.termaForwardRuntime.runningUrl(forward as WorkspaceForward),
    remoteProtocolAction: protocol => remoteServices.termaRemoteProfiles.presentation.action(protocol),
    protocolMeta: remoteServices.termaRemoteProfiles.presentation.metadata, refreshIcons: () => refreshIcons(),
    snippets: () => snippetsServices.termaSnippets.service.state.items, publish: rows => snippetsServices.termaSnippets.service.replaceItems(rows),
    loadSnippets: () => snippetsServices.termaSnippets.service.load(),
    expand: async (snippet, connection) => (await snippetsServices.termaSnippets.expand(snippet, connection, null, false))[0] || '',
    retainsQuickBar: bar => terminalSurfaceCache.get(bar.dataset.terminalKey || '')?.contains(bar) === true,
    target: quickCommandTarget, send: (key, text) => sendTerminalData(key, text),
    used(key, command) {
      terminalHistory.save(command);
      const session = terminalSessions.get(key), connection = sessionConnection(session);
      if (session && connection) void terminalDirectory.track(session, connection, key, command);
    },
    focus: key => focusTerminalSession(key), fit: () => terminalViewport.schedule(),
    toolbar() {
      document.querySelectorAll<HTMLElement>('[data-terma-vue-terminal-toolbar]').forEach(toolbar => terminalServices.termaTerminalToolbar?.refresh(toolbar.dataset.workspaceTabKey || toolbar.dataset.terminalTabKey || ''));
    },
    edit: (id, quick) => snippetsServices.termaSnippets.navigate('editor', id, {quick}), manage: () => snippetsServices.termaSnippets.navigate('manager'),
    menu: (event, items) => showActionMenu(event, items),
    confirm: () => confirmModal(tr('terminal:snippets.delete_message'), tr('terminal:snippets.delete_title'), tr('common:actions.delete'), tr('common:actions.cancel'), true),
    keepKeyboard: event => keepTerminalKeyboardClosed(event), restore: () => sessionEfficiencyServices.termaSessionEfficiency.history.restore(),
    broadcasting: () => terminalBroadcastKeys().length >= 2, stopBroadcast: () => stopTerminalBroadcast()
  };
}
