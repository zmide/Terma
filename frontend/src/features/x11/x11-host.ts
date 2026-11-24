import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {showActionMenu} from '@/shared/action-menu';
import {notify} from '@/features/efficiency/notification-actions';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {nextTerminalTabIndex,openTerminal,openQuickTerminal,focusTerminalSession} from '@/features/terminal/terminal-page';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {reconnectTerminal} from '@/features/terminal/terminal-connection-runtime';
import {repairSshCredentials} from '@/features/connections/ssh-credential-runtime';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalActionConnection} from '@/features/terminal/terminal-metadata';
import { terminalStartupOverrides, terminalStartupConfigForConnection, effectiveTerminalStartupConfig } from '@/features/terminal/terminal-startup-state';
import { activateTab } from '@/features/workspace/workspace-dock-runtime';
import { workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import type {TerminalDisplayMenuAction} from '../terminal/TerminalDisplayMenuView';
import {createX11ContextService} from './context-service';
import {x11Presentation} from './presentation-service';
import type {X11Connection, X11Port, X11Session} from './x11-types';

type WorkspaceTab = {id?: number; kind?: string};
type RuntimeLink = Pick<X11Port, 'ask' | 'owner' | 'restore' | 'manual'> & {managerKey(): string};
type HostPort = Omit<X11Port, 'manager' | 'guide' | 'header'>;

const tr: X11Port['tr'] = (key, params) => sharedServices.termaI18nRuntime!.translate(key, params);
const session = (key: string) => terminalSessions.get(key);
const connection = (id: number) => currentConnection(id);

const context = createX11ContextService({
  activeKey: () => applicationState.activeTabKey,
  session,
  tab: key => workspaceTabByKey(key),
  connection,
  managementConnectionId: id => remoteServices.termaRemoteManagement.connectionId(remoteServices.termaRemoteProfiles.byId(id))
});

export const x11MenuHost = {
  connection: (key: string, id: number) => terminalActionConnection(key, id),
  session,
  tr,
  open(event: MouseEvent, actions: () => TerminalDisplayMenuAction[]) {
    if (!terminalServices.termaTerminalActionMenu?.open(event, actions)) showActionMenu(event, actions());
  }
};

export function createX11Host(runtime: RuntimeLink): HostPort {
  return {
    api: (url, options) => api(url, options),
    tr,
    notify: (message, kind) => notify(localizedTermaUiPhrase(message), kind),
    localize: message => localizedTermaUiPhrase(message),
    unlocked: label => requireConfigEncryptionUnlocked(label),
    repair: id => repairSshCredentials(id, {context: () => tr('common:x11.management_auth_failed')}),
    refreshLinux: () => remoteServices.termaRemoteManagement.desktop.load(),
    connection,
    session,
    sessionKey(id, preferred = '') {
      const keys = [preferred, runtime.managerKey(), applicationState.activeTabKey, ...terminalSessions.keys()];
      return keys.find(key => session(key)?.connection?.id === id) || '';
    },
    activeContext: context.active,
    scope() {
      const key = applicationState.activeTabKey;
      const tab = workspaceTabByKey(key);
      return () => applicationState.activeTabKey === key && (!tab || workspaceTabByKey(key) === tab);
    },
    owner: runtime.owner,
    restore: runtime.restore,
    manual: runtime.manual,
    beforeOpen: () => closeModal(),
    ask: runtime.ask,
    authorize: (id, title, scope) => remoteServices.termaRemoteManagement.authorize(id, title, scope),
    desktopAuthorize: () => sharedServices.termaDesktopIntegration.ensure(['xserver']),
    begin: (key, button, label) => sharedServices.termaUiActions.begin(key, button, label),
    end: (key, button) => sharedServices.termaUiActions.end(key, button),
    busy: (button, value, label) => {
      if (button?.isConnected) sharedServices.termaUiActions.setButtonBusy(button, value, label);
    },
    watch: watchTask,
    reload: () => sharedServices.termaWorkspaceRefresh.load(),
    next: id => `terminal-${id}-${nextTerminalTabIndex(id)}`,
    startup: (value, key) => key ? effectiveTerminalStartupConfig(value, key) : terminalStartupConfigForConnection(value),
    override: (key, value) => terminalStartupOverrides.set(key, value),
    openTerminal: (id, key, title) => openTerminal(id, true, key, title),
    reconnect: (id, key) => reconnectTerminal(id, key),
    quickTerminal: (value, token, title) => openQuickTerminal(value, token, true, '', title),
    updateTerminal: key => terminalServices.termaTerminalToolbar?.refresh(key),
    send: (key, command) => sendTerminalData(key, command, {focus: true}),
    activate: key => activateTab(key),
    focus: key => focusTerminalSession(key),
    async copy(text) { await sharedServices.termaClipboard.copy(text); },
    reason: x11Presentation.reason,
    listen(listener) {
      window.addEventListener('focus', listener);
      document.addEventListener('visibilitychange', listener);
      return () => {
        window.removeEventListener('focus', listener);
        document.removeEventListener('visibilitychange', listener);
      };
    },
    hidden: () => document.hidden,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer)
  };
}

const watchTask: X11Port['watch'] = async (result, title, container, current) => {
  const tasks = remoteServices.termaRemoteManagement.tasks;
  if (!result.task) throw new Error(tr('common:x11.forwarding_task_failed'));
  const completion = tasks.watch(result.task, {title, container: () => current() ? container() : null});
  const accepted = tasks.requested(result, title, tr('remote:tasks.added_to_center', {action: title}));
  const task = await completion;
  if (String(task?.status || '').toLowerCase() !== 'done') {
    throw new Error(task?.error || tr('common:x11.forwarding_task_failed'));
  }
  return accepted;
};
