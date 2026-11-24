import {filesServices} from '@/features/files/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {showActionMenu} from '@/shared/action-menu';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {openTerminalConnection,focusTerminalSession} from '@/features/terminal/terminal-page';
import {disconnectTerminal,reconnectTerminal} from '@/features/terminal/terminal-connection-runtime';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {createTerminalLogId} from '@/features/terminal/terminal-identity';
import { effectiveTerminalStartupConfig } from '@/features/terminal/terminal-startup-state';
import { renderTabs } from '@/features/workspace/workspace-dock-tabs';
import { addTab, closeTabsByKey, activateTab } from '@/features/workspace/workspace-dock-runtime';
import { confirmModal } from '@/shared/workspace-prompts';
import type { Api } from '../operations/operations-types';
import type { ManagementConnection } from '../remote/management-types';
import type { TerminalStartupConfig } from '../terminal/TerminalStartupView';
import { terminalSessionBackendForStartup } from '../terminal/terminal-startup-service';
import type { TerminalSurfaceSession } from '../terminal/terminal-surface-service';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import type { SessionLease } from './persistent-session-service';
import type { SessionEfficiencyPort } from './session-runtime';
import type { SessionTab } from './session-model';
import { repaintTerminalBroadcast } from './terminal-broadcast-workspace';

type Connection = ManagementConnection & {
  identity_file?: string;
  updated_at?: string;
  terminal_session_mode?: string;
  terminal_session_backend?: string;
  terminal_session_id?: string;
};

const openTab = (key: string) => applicationState.tabs.find(tab => tab.key === key);
const connectionFor = (key: string, id?: number): Connection | null => terminalSessions.get(key)?.connection || currentConnection(Number(id || 0)) || null;
const endpoint = (connection: Connection | null) => JSON.stringify([connection?.id, connection?.ssh_host, connection?.ssh_port, connection?.ssh_user, connection?.identity_file, connection?.updated_at]);
const signature = (tab?: Pick<WorkspaceTab, 'kind' | 'id' | 'sessionMode' | 'sessionBackend' | 'persistentSessionId'>) => JSON.stringify([tab?.kind, tab?.id, tab?.sessionMode || 'none', tab?.sessionBackend || 'auto', tab?.persistentSessionId || '']);

function sessionTabs(): SessionTab[] {
  return applicationState.tabs.map(tab => ({
    ...tab, kind: tab.kind || '', title: tab.title || '', subtitle: tab.subtitle || '',
    viewName: tab.viewName || '', closable: tab.closable !== false,
    path: tab.kind === 'sftp' ? filesServices.termaSftpTabs?.runtime.dialogContext(tab.key)?.path || tab.path || '.' : tab.path
  }));
}

function restoreClosed(tab: SessionTab) {
  const key = openTab(tab.key) ? `${tab.key}-restored-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : tab.key;
  const fileSource: WorkspaceTab['fileSource'] = tab.fileSource === 'browser' || tab.fileSource === 'server' ? tab.fileSource : undefined;
  const restored = {...tab, fileSource, key, pinned: false, connectionStatus: 'disconnected'};
  addTab(key, restored.title, restored.subtitle, restored.viewName, restored.closable, restored);
  try {
    const current = openTab(key);
    if (!current) return false;
    workspaceServices.termaWorkspaceTabRuntime.render(current);
    return true;
  } catch (error) {
    closeTabsByKey([key], key);
    throw error;
  }
}

function capture(saved: SessionTab, open: boolean): SessionLease | null {
  const key = saved.key, original = open ? openTab(key) : undefined, connection = connectionFor(key, saved.id);
  if (!connection || (open && !original)) return null;
  const fixedEndpoint = endpoint(connection), engine = open ? terminalSessions.get(key) : undefined;
  let expected = signature(saved), attempt = engine?.connectionAttempt;
  const current = () => endpoint(connectionFor(key, saved.id)) === fixedEndpoint &&
    (!open || (openTab(key) === original && signature(original) === expected && terminalSessions.get(key) === engine && engine?.connectionAttempt === attempt));
  if (!current()) return null;

  return {
    current,
    patch(values) {
      if (!current() || !original) return;
      Object.assign(original, values);
      expected = signature(original);
    },
    cancelPending() {
      if (!open || !current() || !engine) return;
      disconnectTerminal(key);
      attempt = engine.connectionAttempt;
    },
    startup() {
      const config = effectiveTerminalStartupConfig(connection, key);
      const windows = config.terminal_startup_mode === 'program' && (config.terminal_program_platform === 'windows' || /^[A-Za-z]:[\\/]|\\/.test(config.terminal_program_path));
      return {windows, backend: terminalSessionBackendForStartup(config) || 'auto'};
    },
    reopen(tab, reconnect) {
      if (!current()) return;
      const activeConnection = connectionFor(key, saved.id);
      if (!activeConnection) return;
      openTerminalConnection({...activeConnection, terminal_session_mode: tab.sessionMode, terminal_session_backend: tab.sessionBackend, terminal_session_id: tab.persistentSessionId}, false, key, tab.title);
      const session = terminalSessions.get(key);
      if (reconnect && (session?.socket?.readyState === WebSocket.OPEN || session?.connected)) reconnectTerminal(activeConnection.id, key);
    },
    activate() {
      if (!current()) return;
      activateTab(key);
      focusTerminalSession(key);
    }
  };
}

export function createSessionEfficiencyHost(): SessionEfficiencyPort {
  return {
    tr: (key, values) => tr(key, values),
    read: () => localStorage.getItem('closedWorkspaceTabsV1'),
    write: value => localStorage.setItem('closedWorkspaceTabsV1', value),
    now: Date.now,
    id: () => createTerminalLogId(),
    tabs: sessionTabs,
    unlocked: () => requireConfigEncryptionUnlocked(tr('terminal:session.manager.title')),
    api: (url, options) => api(url, options),
    save: () => workspaceServices.termaWorkspacePersistence?.save(),
    exists(tab) {
      if (['terminal', 'sftp', 'forwards', 'dashboard', 'linux-desktop'].includes(tab.kind) || (tab.kind === 'edit' && tab.id)) return !!connectionFor(tab.key, tab.id);
      if (['remote-terminal', 'remote-desktop', 'ftp'].includes(tab.kind) || (tab.kind === 'remote-edit' && tab.id)) return !!remoteServices.termaRemoteProfiles.byId(Number(tab.id));
      return true;
    },
    restore: restoreClosed,
    capture,
    notify: (key, type, error) => notify(error instanceof Error && error.message ? error.message : tr(key), type),
    confirm: () => confirmModal(() => tr('terminal:session.terminate_confirm'), () => tr('terminal:session.manager.terminate_title'), () => tr('terminal:session.manager.terminate'), () => tr('common:actions.cancel'), true),
    beforeOpen: () => closeModal(),
    menu: (event, items) => { if (!terminalServices.termaTerminalActionMenu?.open(event as MouseEvent, items)) showActionMenu(event, items()); },
    broadcastUpdated(keys) {
      repaintTerminalBroadcast();
      renderTabs();
      if (keys.includes(applicationState.activeTabKey)) focusTerminalSession(applicationState.activeTabKey);
    },
    reconnect(key) {
      const tab = openTab(key), connection = tab && connectionFor(key, tab.id);
      if (connection) reconnectTerminal(connection.id, key);
    },
    label(tab) {
      const connection = connectionFor(tab.key, tab.id);
      return connection ? `${connection.ssh_user || ''}@${connection.ssh_host || ''}:${connection.ssh_port || 22}` : tr('terminal:session.manager.connection_missing');
    }
  };
}
