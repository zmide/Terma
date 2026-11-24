import {settingsServices} from '@/features/settings/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {toggleTheme} from '@/shared/theme-runtime';
import {updateFilePicker} from '@/shared/form-controls';
import {applicationState} from '@/shared/application-state';
import {openTerminal} from '@/features/terminal/terminal-page';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import type {createTaskRuntime} from '../features/files/sftp/task-runtime';
import type {DelegatedActionHandler, EventRegistry} from './actions/event-registry';

function inConnectionForm(element: Element, action: (form: HTMLFormElement) => unknown) {
  const form = element.closest<HTMLFormElement>('#connectionForm');
  if (form) return action(form);
}

const connectionId = (dataset: DOMStringMap) => Number(dataset.connectionId || 0);
const connectionGroup = (dataset: DOMStringMap) => decodeURIComponent(dataset.group || '');

interface StaticTaskPort {
  runtime: Pick<ReturnType<typeof createTaskRuntime>, 'toggle' | 'close' | 'view' | 'open'>;
  view(): string;
}
type StaticActionHandler = (context: Parameters<DelegatedActionHandler>[0], tasks: StaticTaskPort) => ReturnType<DelegatedActionHandler>;
const actions: Record<string, Record<string, StaticActionHandler>> = {
  'workspace-shell': {
    'static-operation-pin': () => workspaceShell.togglePinned(),
    'static-operation-collapse': () => workspaceShell.setCollapsed(true),
    'static-operation-expand': () => workspaceShell.setCollapsed(false),
    'static-language-toggle': () => settingsServices.termaLanguageSettings.toggle(),
    'static-theme-toggle': () => toggleTheme(),
    'static-refresh': () => sharedServices.termaWorkspaceRefresh.refresh(),
    'static-operation-guide-dismiss': () => workspaceShell.dismissGuide(),
    'static-primary': ({dataset}) => workspaceShell.showPrimary(dataset.primary ?? '', dataset.explorer === 'true'),
  },
  'workspace-tabs': {
    'workspace-event-stop': ({event}) => event.stopPropagation(),
    'workspace-tab-drag-start': ({event, dataset}) => {
      if (event instanceof PointerEvent && dataset.tabKey) workspaceServices.termaWorkspaceDrag?.tabs.begin(event, dataset.tabKey);
    },
    'workspace-tab-menu': ({event, dataset}) => {
      if (event instanceof MouseEvent && dataset.tabKey) workspaceServices.termaWorkspaceTabActions.showMenu(event, dataset.tabKey);
    },
    'workspace-tab-sftp-drag-over': ({event, element, dataset}) => {
      if (event instanceof DragEvent && element instanceof HTMLElement && dataset.tabKey) filesServices.termaSftpDragWorkspace.drag.destinations.over(event, dataset.tabKey, element);
    },
    'workspace-tab-sftp-drag-leave': ({event, element}) => {
      if (event instanceof DragEvent && element instanceof HTMLElement) filesServices.termaSftpDragWorkspace.drag.destinations.leave(event, element);
    },
    'workspace-tab-sftp-drop': ({event, element, dataset}) => {
      if (event instanceof DragEvent && element instanceof HTMLElement && dataset.tabKey) return filesServices.termaSftpDragWorkspace.drag.destinations.drop(event, dataset.tabKey, element);
    },
    'workspace-tab-close': ({event, dataset}) => {
      event.stopPropagation();
      if (dataset.tabKey) return workspaceServices.termaWorkspaceTabActions.requestClose([dataset.tabKey], dataset.tabKey);
    },
  },
  'workspace-welcome': {
    'workspace-show-connections': () => workspaceShell.reveal('connections'),
    'workspace-show-running': () => workspaceShell.reveal('running'),
    'workspace-startup-log': ({dataset}) => logsServices.termaLogReader.feature().service.date(Number(dataset.logTimestamp) || undefined),
  },
  'connections': {
    'static-group-add': () => connectionsServices.termaConnectionGroups?.startAdding(),
    'workspace-group-add': () => connectionsServices.termaConnectionGroups?.startAdding(),
    'workspace-connection-check-all': ({element}) => {
      if (element instanceof HTMLElement) return connectionsServices.termaConnectionHealthBatch?.checkAll(element);
    },
    'workspace-connection-search': ({element}) => {
      if (element instanceof HTMLInputElement) return connectionsServices.termaConnectionList?.setSearch(element.value);
    },
    'workspace-connection-bulk': () => connectionsServices.termaConnectionList?.toggleBulkMode(),
    'connection-forward': ({element, dataset}) => {
      const action = dataset.forwardAction;
      if (action === 'start' || action === 'stop') return forwardsServices.termaForwardActions.command(connectionId(dataset), action, true, element);
    },
    'connection-group-toggle': ({dataset}) => {
      if (connectionsServices.termaConnectionGroupDrag?.isClickSuppressed()) return;
      const group = connectionGroup(dataset);
      return applicationState.primaryView === 'remote' ? remoteServices.termaRemoteList.toggleGroup(group) : connectionsServices.termaConnectionList?.toggleGroup(group);
    },
    'connection-group-menu': ({event, dataset}) => {
      if (event instanceof MouseEvent) return connectionsServices.termaConnectionMenu?.openGroup(event, connectionGroup(dataset));
    },
    'connection-search-clear': () => connectionsServices.termaConnectionList?.setSearch(''),
    'connection-select-all': ({element}) => {
      if (element instanceof HTMLInputElement) return connectionsServices.termaConnectionList?.toggleAll(element.checked);
    },
    'connection-bulk-settings': () => connectionsServices.termaConnectionViews?.openConnectionBulkSettings(),
    'connection-bulk-delete': () => connectionsServices.termaConnectionViews?.bulkDeleteConnections(),
    'connection-select': ({element, dataset}) => {
      if (element instanceof HTMLInputElement) return connectionsServices.termaConnectionList?.setSelected(connectionId(dataset), element.checked);
    },
    'connection-open-terminal': ({event, dataset}) => {
      event.stopPropagation();
      return openTerminal(connectionId(dataset));
    },
    'connection-open-sftp': ({dataset}) => filesServices.termaSftpPage.open(connectionId(dataset)),
    'connection-open-forwards': ({dataset}) => forwardsServices.termaForwardWorkspace.openConnection(connectionId(dataset)),
    'connection-favorite': ({event, dataset}) => {
      event.stopPropagation();
      return connectionsServices.termaConnectionList?.toggleFavorite(connectionId(dataset), Number(dataset.favorite || 0));
    },
    'connection-menu': ({event, dataset}) => {
      if (event instanceof MouseEvent) return connectionsServices.termaConnectionMenu?.open(event, connectionId(dataset));
    },
    'connection-modal-close': () => closeModal(),
    'connection-bulk-apply': () => connectionsServices.termaConnectionBulkActions?.apply(),
    'connection-bulk-delete-confirm': () => connectionsServices.termaConnectionBulkActions?.remove(),
  },
  'remote-connections': {
    'workspace-linux-desktop': () => remoteServices.termaRemoteManagement.desktop.open(),
    'workspace-remote-search': ({element}) => {
      if (element instanceof HTMLInputElement) return remoteServices.termaRemoteList.setSearch(element.value);
    },
    'workspace-remote-add': ({event}) => {
      if (event instanceof MouseEvent) return remoteServices.termaRemoteList.add(event);
    },
    'remote-search-clear': () => remoteServices.termaRemoteList.setSearch(''),
    'remote-new': () => remoteServices.termaRemoteProfiles.editor.create('rdp'),
  },
  'forwards': {
    'static-forwards-start-all': ({element}) => forwardsServices.termaForwardGlobal.service.startAll(element),
    'static-forwards-stop-all': ({element}) => forwardsServices.termaForwardGlobal.service.stopAll(element),
  },
  'navigation': {
    'static-explorer-back': () => workspaceShell.showMobileExplorer(),
  },
  'task-center': {
    'static-task-center-toggle': ({event}, tasks) => tasks.runtime.toggle(event),
    'static-task-center-close': (_context, tasks) => tasks.runtime.close(),
    'static-task-center-view': ({dataset}, tasks) => tasks.runtime.view(dataset.taskView ?? ''),
    'static-task-center-clear': ({event, element}, tasks) => {
      event.stopPropagation();
      if (!(element instanceof HTMLElement)) return;
      const actions = filesServices.termaTaskActions.current;
      return tasks.view() === 'failed' ? actions.clearFailed(element) : actions.clearHistory(element);
    },
    'static-task-center-pause-all': ({event, element}) => {
      event.stopPropagation();
      if (element instanceof HTMLElement) return filesServices.termaTaskActions.current.batch('pause', element);
    },
    'static-task-center-resume-all': ({event, element}) => {
      event.stopPropagation();
      if (element instanceof HTMLElement) return filesServices.termaTaskActions.current.batch('resume', element);
    },
    'static-task-center-clear-queue': ({event, element}) => {
      event.stopPropagation();
      if (element instanceof HTMLElement) return filesServices.termaTaskActions.current.batch('cancel', element);
    },
    'static-task-list-open': ({event}, tasks) => tasks.runtime.open(event),
    'static-task-resize-start': ({event, element}) => {
      if (event instanceof PointerEvent) filesServices.termaFileLayouts.taskCenter.startSftpTaskCenterResize(event, element);
    },
    'static-task-resize-reset': ({event}) => filesServices.termaFileLayouts.taskCenter.resetSftpTaskCenterSize(event),
    'static-task-resize-key': ({event}) => {
      if (event instanceof KeyboardEvent) filesServices.termaFileLayouts.taskCenter.handleSftpTaskCenterResizeKey(event);
    },
  },
  'connection-form': {
    'static-auth-fields': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormWorkspace.updateAuth(form)),
    'static-key-status': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormActions?.renderKeyStatus(form)),
    'static-key-refresh': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormActions?.refreshKeys(form)),
    'static-file-picker': ({element}) => {if (element instanceof HTMLInputElement) updateFilePicker(element);},
    'static-key-upload': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormActions?.upload(form)),
    'static-key-repair': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormActions?.repairKey(form)),
    'static-terminal-startup': ({element}) => {if (element instanceof HTMLSelectElement) connectionsServices.termaConnectionTerminal?.toggleStartup(element.form);},
    'static-terminal-profile': ({element}) => {if (element instanceof HTMLSelectElement) connectionsServices.termaConnectionTerminal?.applyProfile(element.value, element);},
    'static-connection-save-clear': ({element}) => inConnectionForm(element, form =>
      connectionsServices.termaConnectionSave?.save(form, {clearAfterSave:true, trigger:element instanceof HTMLElement ? element : null})),
    'static-connection-save-connect': ({element, dataset}) => inConnectionForm(element, form =>
      connectionsServices.termaConnectionSave?.save(form, {connectAfterSave:true, closeAfterSave:dataset.closeAfterSave === '1', trigger:element instanceof HTMLElement ? element : null})),
    'static-connection-test': ({element}) => inConnectionForm(element, form =>
      connectionsServices.termaConnectionFormActions?.test(form, element instanceof HTMLElement ? element : null)),
    'static-connection-reset': ({element}) => inConnectionForm(element, form => connectionsServices.termaConnectionFormWorkspace.reset(form)),
  },
  'import-export': {
  },
};

const openConnectionFormIds = ['static-connection-new', 'workspace-connection-new', 'connection-new'];

export const STATIC_ACTION_DEFINITIONS = Object.freeze([
  ...Object.entries(actions).flatMap(([source, handlers]) => Object.keys(handlers).map(id => Object.freeze({id, source}))),
  ...openConnectionFormIds.map(id => Object.freeze({id, source: 'connections'}))
]);

export function registerStaticActions(registry: EventRegistry, openConnectionForm: () => boolean, tasks: StaticTaskPort) {
  for (const handlers of Object.values(actions)) {
    for (const [id, handler] of Object.entries(handlers)) registry.register(id, context => handler(context, tasks));
  }
  for (const id of openConnectionFormIds) registry.register(id, () => openConnectionForm());
}
