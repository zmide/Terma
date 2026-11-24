import {workspaceServices} from '@/features/workspace/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr,rememberTermaRawUiPhrase} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {isMobileLayout} from '@/shared/browser-ui';
import {notify} from '@/features/efficiency/notification-actions';
import {icon} from '@/shared/ui/icon-service';
import {api} from '@/shared/api/workspace-request';
import {$} from '@/shared/workspace-dom';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {nextTerminalTabIndex,openTerminal,restoreQuickTerminalTab,syncTerminalToolbarPlacement,updateTerminalStatusForLayout} from '@/features/terminal/terminal-page';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { terminalStartupOverrides } from '@/features/terminal/terminal-startup-state';
import { renderWorkspacePaneContent, syncFocusedWorkspaceClasses, saveFocusedSftpPaneState, activateTab, workspaceReplacePaneWithSplit, normalizeWorkspaceLayoutAfterMutation, setPaneActiveKey, addTab, setWorkspace, focusWorkspacePane, closeTabsByKey, moveWorkspaceTab } from './workspace-dock-runtime';
import {
  WORKSPACE_GROUP_MAIN_ID, WORKSPACE_MAX_RESTORE_DEPTH, WORKSPACE_MAX_RESTORE_NODES,
  WORKSPACE_MAX_SPLIT_RATIO, WORKSPACE_MIN_SPLIT_RATIO, isWorkspaceTab, workspaceCssEscape,
  workspaceDockElement, workspaceDockState, workspaceFindPane, workspaceFindPaneForTab, workspaceFindSplit,
  workspaceLeaves, workspaceNextPaneId, workspaceNextSplitId, workspacePaneHistoryService, workspacePaneNodes,
  workspaceTabByKey, workspaceVisiblePanes
} from './workspace-dock-state';
import { workspacePaneElement, workspaceElementForTab, runInWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { applyWorkspaceSplitGeometry, dockViewPort } from './workspace-dock-layout';
import { dockTabs, renderTabs, revealWorkspaceTab, workspaceTabViewModel } from './workspace-dock-tabs';
import { localizedWorkspaceTabTitle, workspaceTabConnectionStateText, workspaceTabPresentation } from './workspace-tab-presentation';
import { confirmModal, inputModal } from '@/shared/workspace-prompts';
import { runtimePreferences } from '@/features/settings/runtime-settings-model';
import type {installWorkspaceDragService} from './workspace-drag-service';
import type {EventRegistry} from '../../shared/actions/event-registry';
import type {installWorkspaceChromeService} from './workspace-chrome-service';
import type {installWorkspaceGroupController} from './workspace-group-controller';
import type {installWorkspaceMobileService} from './workspace-mobile-service';
import type {WorkspaceStateTab} from './workspace-state-service';
import type {installWorkspacePersistenceService} from './workspace-persistence-service';
import type {installWorkspaceTabCopy} from './workspace-tab-copy';
import type {installWorkspaceTabActions} from './workspace-tab-actions';
import type {installWorkspaceToolbarPlacement, ToolbarPlacement} from './workspace-toolbar-placement';
import type {installWorkspaceTabRuntime, WorkspaceTab} from './workspace-tab-runtime';
import type {installNamedWorkspaceService} from '../quick/named-workspace-service';
import type {Connection} from '../quick/named-workspace-references';
import type {RemoteProfile} from '../remote/profile-model';
import type {Api} from '../operations/operations-types';
import {cleanTab} from '../session-efficiency/session-model';
import {repaintTerminalBroadcast, stopTerminalBroadcast} from '../session-efficiency/terminal-broadcast-workspace';
import {openConnectionDashboard} from '../connections/connection-dashboard';
import {openSavedConnectionForm} from '../connections/connection-form-workspace';
import {closeTerminalSession} from '../terminal/terminal-session-lifecycle';
import type { createFilePageRuntime } from '../files/file-page-runtime';




const openWorkspaceTabs = () => applicationState.tabs.filter(isWorkspaceTab);

export const workspaceGroupHost = (): Parameters<typeof installWorkspaceGroupController>[0] => ({
  read:() => ({groups:workspaceDockState.workspaceGroups, activeId:workspaceDockState.activeWorkspaceGroupId, tabs:applicationState.tabs, layout:workspaceDockState.workspaceLayout, activeTabKey:applicationState.activeTabKey, focusedPaneId: workspaceDockState.focusedPaneId}),
  replaceGroups:groups => { workspaceDockState.workspaceGroups = groups; },
  serial:() => workspaceDockState.workspaceGroupSerial,
  setSerial:serial => { workspaceDockState.workspaceGroupSerial = serial; },
  setActive:id => { workspaceDockState.activeWorkspaceGroupId = id; },
  mainId:WORKSPACE_GROUP_MAIN_ID,
  layout:{
    serialize:layout => workspaceServices.termaWorkspaceLayout!.serialize(layout),
    filter:(layout, keys) => workspaceServices.termaWorkspaceLayout!.filter(layout, keys, WORKSPACE_MIN_SPLIT_RATIO, WORKSPACE_MAX_SPLIT_RATIO),
    paneForTab:key => workspaceFindPaneForTab(key)?.id
  },
  views:() => workspaceServices.termaWorkspaceViews,
  dock:workspaceDockElement,
  mobile:() => isMobileLayout(),
  suppressTabClick:() => workspaceServices.termaWorkspaceDrag?.tabs.suppressClick() ?? false,
  activateTab:key => activateTab(key),
  renderMobile:() => workspaceServices.termaWorkspaceMobile?.render(),
  renderTabs:() => renderTabs(),
  apply(group) {
    applicationState.restoringTabs = true;
    try {
      const model = workspaceServices.termaWorkspacePersistence!.restoreGroupLayout(group);
      ({layout:workspaceDockState.workspaceLayout, focusedPaneId: workspaceDockState.focusedPaneId, activeTabKey:applicationState.activeTabKey, activeView:applicationState.activeView} = model);
      applicationState.tabs=model.tabs.filter(isWorkspaceTab);
      renderTabs({rebuildLayout:true});
      for (const pane of workspaceVisiblePanes()) {
        if (pane.id !== workspaceDockState.focusedPaneId) renderWorkspacePaneContent(pane.id);
      }
      if (applicationState.activeTabKey) renderWorkspacePaneContent(workspaceDockState.focusedPaneId);
      else connectionsServices.termaConnectionViews?.renderWelcome();
      syncFocusedWorkspaceClasses();
      workspaceServices.termaWorkspaceToolbar?.sync();
    } finally {
      applicationState.restoringTabs = false;
    }
  },
  save:() => workspaceServices.termaWorkspacePersistence?.save(),
  savePreset:() => quickServices.termaNamedWorkspaces.save(),
  saveFilePane:() => saveFocusedSftpPaneState(),
  hideMenu:() => workspaceServices.termaWorkspaceTabActions?.hideMenu(),
  reveal:key => revealWorkspaceTab(key),
  input:(title, label, value) => inputModal(title, label, value),
  confirm:(message, title, ok, cancel) => confirmModal(message, title, ok, cancel, true),
  tr:(key, values) => tr(key, values),
  notify:(message, level) => notify(message, level),
  remember:message => rememberTermaRawUiPhrase(message)
});

export const workspaceChromeHost = (): Parameters<typeof installWorkspaceChromeService>[0] => ({
  mobile: () => isMobileLayout(),
  operationCollapsed: workspaceShell.isCollapsed,
  fitContent() {
    terminalViewport.schedule();
    for (const pane of workspaceVisiblePanes()) {
      dockTabs.syncTabScroll(pane.id);
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
      const list = workspacePaneElement(pane.id)?.querySelector<HTMLElement>("#sftpList");
      if (list) filesServices.termaSftpColumns.syncSftpListLayout(list);
    }
  }
});

export const workspaceMobileHost = (): Parameters<typeof installWorkspaceMobileService>[0] => ({
  isMobile:() => isMobileLayout(),
  models:() => openWorkspaceTabs().filter(tab => tab.kind !== "welcome" && tab.viewName !== "welcome").map(tab => {
    const model = workspaceTabViewModel(tab, {activeTabKey:applicationState.activeTabKey});
    const title = localizedWorkspaceTabTitle(tab);
    const status = workspaceTabConnectionStateText(tab.connectionStatus);
    const label = [title, status].filter(Boolean).join(" · ");
    return {...model, status:tab.connectionStatus ? (tab.connectionStatus === "connected" || tab.connectionStatus === "connecting" ? tab.connectionStatus : "disconnected") : "", label, tooltip:label, closeLabel:`${tr("navigation:auto.close_tab")} · ${title}`};
  }),
  label:() => tr("navigation:mobile.open_tabs"),
  tabs:() => dockViewPort,
  hasTab:key => applicationState.tabs.some(tab => tab.key === key),
  activate:key => activateTab(key),
  showWorkspace:workspaceShell.showMobileWorkspace
});

export function registerMobileWorkspaceAction(registry: EventRegistry) {
  registry.register('mobile-workspace-tab-activate', ({dataset}) => {
    const key = dataset.tabKey || "";
    if (workspaceServices.termaWorkspaceGroups?.selectionMode()) return workspaceServices.termaWorkspaceGroups.toggleSelection(key);
    return workspaceServices.termaWorkspaceMobile?.activate(key);
  });
}

export const workspaceDragHost = (): Parameters<typeof installWorkspaceDragService>[0] => ({
  mobile:() => isMobileLayout(),
  label:zone => tr(`navigation:auto.drop_${zone}`, {defaultValue:`Drop in a split on the ${zone}`}),
  panes:() => workspacePaneNodes.values(),
  pane:id => workspacePaneElement(id),
  tabs:{
    context:() => workspaceDockState.activeWorkspaceGroupId,
    mobile:() => isMobileLayout(),
    selectionMode:() => Boolean(workspaceServices.termaWorkspaceGroups?.selectionMode()),
    source(key) {
      const pane = workspaceFindPaneForTab(key);
      if (!pane) return null;
      const tab = workspacePaneElement(pane.id)?.querySelector<HTMLElement>(`.tab[data-tab-key="${workspaceCssEscape(key)}"]`);
      return tab ? {tab, paneId:pane.id, activeTabKey:pane.activeTabKey} : null;
    },
    activateSource(key, source) {
      if (source.activeTabKey !== key || (source.paneId && workspaceDockState.focusedPaneId !== source.paneId)) activateTab(key);
    },
    presentation(key) {
      const tab = applicationState.tabs.find(item => item.key === key);
      const {icon: tabIcon, title} = workspaceTabPresentation.fallback({...tab, title:tab ? localizedWorkspaceTabTitle(tab) : ""});
      return {icon:tabIcon || icon("grip-vertical"), title};
    },
    hideMenu:() => workspaceServices.termaWorkspaceTabActions?.hideMenu(),
    render:() => renderTabs()
  },
  mutation:() => createWorkspaceDragMutationPort(),
  splitter:() => ({
    min:WORKSPACE_MIN_SPLIT_RATIO,
    max:WORKSPACE_MAX_SPLIT_RATIO,
    split:workspaceFindSplit,
    element:id => document.querySelector<HTMLElement>(`.workspace-split[data-split-id="${workspaceCssEscape(id)}"]`),
    update:applyWorkspaceSplitGeometry,
    save:() => workspaceServices.termaWorkspacePersistence?.save(),
    fit:() => { if (typeof terminalViewport.schedule === "function") terminalViewport.schedule(); }
  })
});

const createWorkspaceDragMutationPort = (): ReturnType<Parameters<typeof installWorkspaceDragService>[0]['mutation']> => ({
  findPaneForTab:key => workspaceFindPaneForTab(key),
  findPane:id => workspaceFindPane(id),
  nextPaneId:() => workspaceNextPaneId(),
  nextSplitId:() => workspaceNextSplitId(),
  replacePaneWithSplit:(paneId, split) => workspaceReplacePaneWithSplit(paneId, split),
  setLayout:layout => { workspaceDockState.workspaceLayout = layout; },
  normalize:preferredPaneId => normalizeWorkspaceLayoutAfterMutation(preferredPaneId),
  setFocusedPane:id => { workspaceDockState.focusedPaneId = id; },
  setActiveTab:key => { applicationState.activeTabKey = key; },
  setActiveView:view => { applicationState.activeView = view; },
  tab(key) {
    const tab = applicationState.tabs.find(item => item.key === key);
    return tab ? {
      viewName: typeof tab.viewName === 'string' ? tab.viewName : undefined,
      kind: typeof tab.kind === 'string' ? tab.kind : undefined
    } : null;
  },
  renderTabs:options => renderTabs(options),
  renderPaneContent:paneId => renderWorkspacePaneContent(paneId),
  revealTab:key => revealWorkspaceTab(key),
  syncFocused:() => syncFocusedWorkspaceClasses(),
  syncToolbars:() => { workspaceServices.termaWorkspaceToolbar?.sync({force:true}); }
});

type StoragePort = Parameters<typeof installWorkspacePersistenceService>[0];

export function workspaceStorageHost(docked: StoragePort['docked']): StoragePort {
  return {
    storage:() => localStorage,
    current:() => ({tabs:applicationState.tabs, activeTabKey:applicationState.activeTabKey}),
    enabled:() => runtimePreferences.snapshot?.saved?.restore_workspace_tabs !== false,
    pending:() => Boolean(applicationState.workspaceRestorePending),
    report:error => console.warn('Workspace storage failed', error),
    docked
  };
}

export const workspaceDockedStorageHost = (): NonNullable<StoragePort['docked']> => ({
  docked:() => Boolean(workspaceDockElement()),
  current:() => ({tabs:applicationState.tabs, activeTabKey:applicationState.activeTabKey, focusedPaneId: workspaceDockState.focusedPaneId, layout:workspaceDockState.workspaceLayout, groupId:workspaceDockState.activeWorkspaceGroupId}),
  restoreGroups({groups, activeGroupId, serial}) {
    workspaceDockState.workspaceGroups = groups;
    workspaceDockState.activeWorkspaceGroupId = activeGroupId;
    workspaceDockState.workspaceGroupSerial = Math.max(workspaceDockState.workspaceGroupSerial, serial);
  },
  clearHistory:() => workspacePaneHistoryService().clear(),
  rollback() {
    const state = {tabs:applicationState.tabs, workspaceLayout: workspaceDockState.workspaceLayout, focusedPaneId: workspaceDockState.focusedPaneId, activeTabKey:applicationState.activeTabKey, activeView:applicationState.activeView, workspaceGroups: workspaceDockState.workspaceGroups, activeWorkspaceGroupId: workspaceDockState.activeWorkspaceGroupId, workspaceGroupSerial: workspaceDockState.workspaceGroupSerial};
    return () => {
      ({tabs:applicationState.tabs, workspaceLayout: workspaceDockState.workspaceLayout, focusedPaneId: workspaceDockState.focusedPaneId, activeTabKey:applicationState.activeTabKey, activeView:applicationState.activeView, workspaceGroups: workspaceDockState.workspaceGroups, activeWorkspaceGroupId: workspaceDockState.activeWorkspaceGroupId, workspaceGroupSerial: workspaceDockState.workspaceGroupSerial} = state);
      applicationState.restoringTabs = false;
    };
  },
  revealActive:() => revealWorkspaceTab(applicationState.activeTabKey),
  options:{
    maxDepth:WORKSPACE_MAX_RESTORE_DEPTH,
    maxNodes:WORKSPACE_MAX_RESTORE_NODES,
    minRatio:WORKSPACE_MIN_SPLIT_RATIO,
    maxRatio:WORKSPACE_MAX_SPLIT_RATIO,
    nextPaneId:workspaceNextPaneId,
    nextSplitId:workspaceNextSplitId
  }
});

export const namedWorkspaceHost = (): Parameters<typeof installNamedWorkspaceService>[0] => ({
  api:(...args) => api(...args),
  tr:(...args) => tr(...args),
  connections:() => applicationState.connections,
  profiles:() => applicationState.remoteProfiles,
  profileLabel:protocol => remoteServices.termaRemoteProfiles.presentation.label(protocol),
  localFiles:() => true,
  tabs:() => workspaceServices.termaWorkspaceGroups!.tabs(),
  activeGroup() {
    const group = workspaceServices.termaWorkspaceGroups!.current();
    return group ? {id:group.id, name:group.id === WORKSPACE_GROUP_MAIN_ID ? '' : workspaceServices.termaWorkspaceState!.groupDisplayName(group)} : null;
  },
  snapshot:() => ({
    tabs:workspaceServices.termaWorkspacePersistence!.persistableTabs(),
    groups:workspaceServices.termaWorkspaceGroups!.serialize(),
    layout:workspaceServices.termaWorkspaceLayout!.serialize(workspaceDockState.workspaceLayout),
    activeKey:applicationState.activeTabKey, activeGroupId:workspaceDockState.activeWorkspaceGroupId, focusedPaneId: workspaceDockState.focusedPaneId
  }),
  rememberFilePath(key) {
    try { filesServices.termaSftpTabs.view.remember(key); }
    catch (error) { console.warn('Unable to capture the workspace file directory', error); }
    return filesServices.termaSftpTabs.view.cached(key)?.state.path;
  },
  closeWorkspace(records) {
    closeModal();
    efficiencyServices.termaEfficiency.palette.close();
    for (const tab of new Map(records.map(item => [item.key, item])).values()) {
      if (typeof tab.key !== 'string') continue;
      closeTerminalSession(tab.key);
      remoteServices.termaRemoteTransport.releaseWorkspace(tab.key);
      if (tab.kind === 'sftp') filesServices.termaSftpConnection.close(tab.key);
    }
  },
  applyLayout:saved => workspaceServices.termaWorkspacePersistence!.applyPreset(saved),
  refresh:() => sharedServices.termaWorkspaceRefresh.load({silent:true}),
  input:(...args) => inputModal(...args),
  confirm:(...args) => confirmModal(...args),
  notify:(...args) => notify(...args)
});

type FilePages = ReturnType<typeof createFilePageRuntime>['pages'];

export const workspaceFilePageHost = (): Parameters<typeof createFilePageRuntime>[0]['workspace'] => ({
  native: () => Boolean(window.termaDesktop),
  mobile: () => isMobileLayout(),
  active: () => applicationState.activeTabKey,
  tab: key => workspaceTabByKey(key) ?? undefined,
  view: () => $('view-local-files'),
  root: key => workspaceElementForTab(key, '#view-local-files'),
  workspace: (key, title, subtitle, update, options) => setWorkspace(title, subtitle, 'local-files', key, update, true, options),
  pane: () => workspaceFindPaneForTab(applicationState.activeTabKey) ?? workspaceFindPane(workspaceDockState.focusedPaneId) ?? undefined,
  findPane: id => workspaceFindPane(id) ?? undefined,
  scroll(id, value) {
    const strip = workspacePaneElement(id)?.querySelector<HTMLElement>('.tabs');
    if (strip && value !== undefined) strip.scrollLeft = value;
    return strip?.scrollLeft ?? 0;
  },
  split: (key, paneId, zone) => { if (zone) workspaceServices.termaWorkspaceDrag!.applyTabDrop({key}, {paneId, zone}); },
  restore(pane, key, scroll) {
    pane.activeTabKey = key;
    renderTabs();
    renderWorkspacePaneContent(pane.id);
    const strip = workspacePaneElement(pane.id)?.querySelector<HTMLElement>('.tabs');
    if (strip) strip.scrollLeft = scroll;
    revealWorkspaceTab(key);
  },
  show: (event, actions) => filesServices.termaSftpMenus?.show(event, actions),
  tabs: openWorkspaceTabs,
  heading: subtitle => workspaceShell.setHeading(subtitle),
  renderTabs: () => renderTabs(),
  persist: () => workspaceServices.termaWorkspacePersistence?.save()
});

export const workspaceTabCopyHost = (files: Pick<FilePages, 'label' | 'open'>): Parameters<typeof installWorkspaceTabCopy>[0] => ({
  tabs:openWorkspaceTabs,
  pane:key => workspaceFindPaneForTab(key)?.id,
  select(key, paneId) {
    workspaceDockState.focusedPaneId = paneId;
    setPaneActiveKey(workspaceFindPane(paneId), key);
    const tab = applicationState.tabs.find(tab => tab.key === key);
    applicationState.activeView = String(tab?.viewName || tab?.kind || 'welcome');
  },
  activate:key => activateTab(key),
  add(tab, key, title) {
    const {key:previousKey, title:previousTitle, subtitle, viewName, closable, ...meta} = tab;
    addTab(key, title, subtitle, viewName, closable !== false, meta);
  },
  render:paneId => renderWorkspacePaneContent(paneId),
  split:(key, paneId, zone) => workspaceServices.termaWorkspaceDrag!.applyTabDrop({key}, {paneId, zone}),
  mobile:() => isMobileLayout(),
  defer:open => requestAnimationFrame(open),
  text:(key, values) => tr(key, values),
  nextTerminalIndex:id => nextTerminalTabIndex(id),
  connectionName:id => currentConnection(id)?.name,
  copyStartup(from, to) {
    if (terminalStartupOverrides.has(from)) terminalStartupOverrides.set(to, terminalStartupOverrides.get(from)!);
  },
  discardStartup:key => terminalStartupOverrides.delete(key),
  terminal:(pane, id, key, title) => runInWorkspacePane(pane, () => openTerminal(id, true, key, title)),
  sftp:(pane, source, key) => Promise.resolve(runInWorkspacePane(pane, () => filesServices.termaSftpPage.duplicate(source, key))),
  fileLabel:source => files.label(source),
  local:(path, key, source) => files.open(path, true, key, source),
  hideMenu:() => workspaceServices.termaWorkspaceTabActions?.hideMenu(),
  renderTabs:() => renderTabs(),
  save:() => workspaceServices.termaWorkspacePersistence?.save(),
  error:error => notify((error as {message?: string} | null)?.message || tr('errors:backend.request_failed'), 'error')
});

export const workspaceTabRuntimeHost = (files: Pick<FilePages, 'open' | 'release'>): Parameters<typeof installWorkspaceTabRuntime>[0] => ({
  tabs:openWorkspaceTabs,
  tab:key => workspaceTabByKey(key),
  terminal:(id, key, title) => openTerminal(id, false, key, title),
  quickTerminal:tab => restoreQuickTerminalTab(tab),
  forwards:id => id === undefined ? undefined : forwardsServices.termaForwardWorkspace.openConnection(id, false),
  forwardManager:() => forwardsServices.termaForwardWorkspace.openManager(false),
  edit:id => openSavedConnectionForm(id, false),
  importData:() => dataExchangeServices.termaExchange.feature().open(false),
  log:(path, title) => logsServices.termaLogReader.feature().service.open(path || '', title || tr('common:log_viewer.default_title'), false),
  command:() => batchServices.termaBatch.open(false),
  sftp:(id, path, key, options) => filesServices.termaSftpPage.open(Number(id), path, false, key, options as Parameters<(typeof filesServices)['termaSftpPage']['open']>[4]),
  local:tab => files.open(tab.path || '', false, tab.key),
  dashboard:id => openConnectionDashboard(id, false),
  remoteEdit:(id, protocol) => id ? remoteServices.termaRemoteProfiles.editor.edit(Number(id), false) : remoteServices.termaRemoteProfiles.editor.create(protocol, '', false),
  remoteDesktop:id => remoteServices.termaRemoteDesktop.open(Number(id), false),
  linuxDesktop:id => remoteServices.termaRemoteManagement.desktop.open(id, false),
  remoteTerminal:(id, key, title) => remoteServices.termaRemoteTransport.terminal.open(Number(id), false, key, title),
  ftp:(id, path, key) => remoteServices.termaRemoteTransport.ftp.open(Number(id), path, false, key),
  settings:key => settingsServices.termaSettingsViews?.open(false, key),
  fallback:tab => setWorkspace(tab.title, tab.subtitle, tab.viewName, tab.key, false, tab.closable),
  viewed:key => efficiencyServices.termaTerminalActivity?.markViewed(key),
  rememberClosed:keys => sessionEfficiencyServices.termaSessionEfficiency?.history.remember(keys),
  releaseLocal:key => files.release([key]),
  releaseTerminal:key => closeTerminalSession(key),
  releaseRemote:key => remoteServices.termaRemoteTransport.releaseWorkspace(key),
  releaseSftp:key => filesServices.termaSftpConnection.close(key),
  releaseSftpCache(key) {
    applicationState.sftpDisconnectedTabs.delete(key);
    filesServices.termaSftpDirectoryWorkspace.cache.clearTab(key);
  },
  releaseLog:key => logsServices.termaLogReader?.feature().release(key),
  releaseCommand:key => batchServices.termaBatch.dispose(key),
  broadcast:() => efficiencyServices.termaTerminalBroadcast,
  stopBroadcast:() => stopTerminalBroadcast(),
  repaintBroadcast:repaintTerminalBroadcast,
  defer(callback) {
    const run = () => typeof setTimeout === 'function' ? setTimeout(callback, 0) : callback();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
  }
});

export const workspaceTabActionsHost = (): Parameters<typeof installWorkspaceTabActions>[0] => ({
  tabs:openWorkspaceTabs,
  scope(key) {
    const available = openWorkspaceTabs();
    if (!available.some(tab => tab.key === key)) return;
    if (!workspaceDockElement()) return {id:'', tabs:available, docked:false};
    const pane = workspaceFindPaneForTab(key);
    if (pane) {
      const byKey = new Map(available.map(tab => [tab.key, tab]));
      return {id:pane.id, tabs:pane.tabs.flatMap(key => byKey.get(key) ?? []), docked:true};
    }
  },
  focus:scope => { if (scope.docked) focusWorkspacePane(scope.id); },
  text:(key, values) => tr(key, values),
  transport(key) {
    const remote = remoteServices.termaRemoteTransport?.socketStatus(key);
    const vnc = remoteServices.termaVncRuntime?.findSession(key);
    return {terminal:terminalSessions.get(key)?.socket?.readyState, remote,
      vnc:Boolean(vnc?.connected || vnc?.connecting || ['connected','connecting'].includes(vnc?.statusState ?? ''))};
  },
  connectionKind:tab => workspaceServices.termaWorkspaceTabRuntime.connectionKind(tab),
  edit:(id, kind) => { if (kind === 'ssh') openSavedConnectionForm(id); else remoteServices.termaRemoteProfiles.editor.edit(Number(id)); },
  confirm:rows => workspaceServices.termaWorkspaceViews!.confirmClose($('modal')!, rows, tr),
  prepare:tab => sessionEfficiencyServices.termaSessionEfficiency.service.prepare(cleanTab(tab)),
  terminate:record => sessionEfficiencyServices.termaSessionEfficiency.service.terminateRecord(record),
  save:() => workspaceServices.termaWorkspacePersistence?.save(),
  error:error => notify((error as {message?: string} | null)?.message || tr('terminal:session.terminate_failed'), 'error'),
  close:(keys, anchor) => closeTabsByKey(keys, anchor),
  combine:key => workspaceServices.termaWorkspaceGroups!.beginSelection(key),
  pin:key => workspaceServices.termaWorkspaceTabCopy.togglePin(key),
  duplicate:key => workspaceServices.termaWorkspaceTabCopy.duplicate(key),
  move:(key, offset) => moveWorkspaceTab(key, offset),
  show:(host, items) => workspaceServices.termaWorkspaceViews!.menu(host, items),
  unmount:host => workspaceServices.termaWorkspaceViews?.unmount(host)
});

export const workspaceToolbarHost = (): Parameters<typeof installWorkspaceToolbarPlacement>[0] => ({
  settings() {
    const value = runtimePreferences.snapshot?.saved?.workspace_toolbar_placement;
    return value && typeof value === 'object' ? value : {};
  },
  mobile:() => isMobileLayout(),
  dock:() => workspaceDockElement(),
  focused:() => workspaceDockState.focusedPaneId,
  panes:() => workspaceLeaves(),
  visiblePanes:() => workspaceVisiblePanes(),
  pane:id => workspaceFindPane(id),
  paneForTab:key => workspaceFindPaneForTab(key),
  paneElement:id => workspacePaneElement(id),
  paneNodes:() => workspacePaneNodes.values(),
  tabKind(key) {
    const kind = applicationState.tabs.find(tab => tab.key === key)?.kind;
    return typeof kind === 'string' ? kind : undefined;
  },
  escape:value => workspaceCssEscape(value),
  legacySync() {
    if (typeof syncTerminalToolbarPlacement === 'function') syncTerminalToolbarPlacement(applicationState.activeTabKey);
    filesServices.termaSftpPage.toolbar(applicationState.activeTabKey);
  },
  updateTerminal:key => { if (typeof updateTerminalStatusForLayout === 'function') updateTerminalStatusForLayout(key); },
  updateSftp:key => filesServices.termaSftpView.refresh(key, 'navigation'),
  fitTerminal:() => { if (typeof terminalViewport.schedule === 'function') terminalViewport.schedule(); },
  bindTerminalScroll:toolbar => terminalServices.termaTerminalToolbarScroll?.bind(toolbar)
});
