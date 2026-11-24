import {filesServices} from '@/features/files/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {sftpTabRuntimes} from '@/features/files/sftp/tab-runtime';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {notify} from '@/features/efficiency/notification-actions';
import {selectConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import { dockTabs, renderTabs } from './workspace-dock-tabs';
import { dockLayout } from './workspace-dock-layout';
import { executionPaneId, runInWorkspacePane } from './workspace-pane-scope';
import {
  workspaceAllTabs, workspaceCssEscape,
  workspaceDockElement, workspaceDockState, workspaceFindPane, workspaceFindPaneForTab,
  workspaceHasTabKey, workspaceLeaves, workspaceNextPaneId,
  workspacePaneHistoryService, workspacePaneNodes, workspaceTabByKey, workspaceVisiblePanes
} from './workspace-dock-state';
import type { WorkspaceLayoutNode, WorkspacePaneNode, WorkspaceSplitNode } from './workspace-layout-service';
import type { WorkspaceTab } from './workspace-tab-runtime';
import type { SftpTabRuntime } from '../files/sftp/tab-runtime';

type RenderOptions = { fast?: boolean; paneId?: string };
type TabMetadata = Partial<WorkspaceTab> & {skipToolbarSync?: boolean};


export function saveFocusedSftpPaneState() {
  const pane = workspaceFindPane(workspaceDockState.focusedPaneId);
  const tab = applicationState.tabs.find(item => item.key === pane?.activeTabKey);
  if (tab?.kind === "sftp") {
    filesServices.termaSftpTabs?.view.remember(tab.key);
  }
}

export function focusWorkspacePane(paneId: string) {
  const pane = workspaceFindPane(paneId);
  if (!pane) return;
  const wasFocused = workspaceDockState.focusedPaneId === paneId;
  if (!wasFocused) saveFocusedSftpPaneState();
  workspaceDockState.focusedPaneId = paneId;
  const tab = applicationState.tabs.find(item => item.key === pane.activeTabKey);
  if (tab) {
    workspacePaneHistoryService().remember(pane, tab.key, tab.key);
    applicationState.activeTabKey = tab.key;
    applicationState.activeView = tab.viewName || tab.kind || "welcome";
    const connectionId = Number(tab.id);
    if ((workspaceServices.termaWorkspaceTabRuntime!.connectionKind(tab) === "ssh" || tab.kind === "edit")
        && Number.isInteger(connectionId) && connectionId > 0 && typeof applicationState.selectedId !== "undefined" && Number(applicationState.selectedId) !== connectionId) {
      if (typeof selectConnection === "function") selectConnection(connectionId, {render:false, reveal:false});
      else applicationState.selectedId = connectionId;
    }
    if (tab.kind === "sftp") filesServices.termaSftpTabs?.runtime.restore(tab.key);
    workspaceServices.termaWorkspaceShell.setHeading(workspaceServices.termaWorkspaceViews!.presentation.activeSubtitle(tab));
    workspaceServices.termaWorkspaceViews!.presentation.syncTitle(tab.title, tab.subtitle, tab.viewName || tab.kind, tab.key, tab);
    dockTabs.revealWorkspaceTab(tab.key);
  }
  if (wasFocused) return;
  syncFocusedWorkspaceClasses();
  for (const node of workspacePaneNodes.values()) node.classList.toggle("focused", node.dataset.paneId === workspaceDockState.focusedPaneId);
  dockTabs.syncWorkspaceTabIds();
  workspaceServices.termaWorkspaceToolbar?.sync();
  workspaceServices.termaWorkspacePersistence?.schedule();
}

export function syncFocusedWorkspaceClasses() {
  const tab = applicationState.tabs.find(item => item.key === applicationState.activeTabKey);
  const viewName = tab?.viewName || tab?.kind || applicationState.activeView || "welcome";
  const content = document.getElementById("content");
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  content?.classList.toggle("terminal-content", terminalLike);
  content?.classList.toggle("sftp-content", viewName === "sftp");
  document.body.classList.toggle("mobile-terminal-active", isMobileLayout() && terminalLike);
}

export function workspaceReplacePaneWithSplit(targetPaneId: string, splitNode: WorkspaceSplitNode, node = workspaceDockState.workspaceLayout) {
  return workspaceServices.termaWorkspaceLayout!.replacePaneWithSplit(targetPaneId, splitNode, node);
}

export function normalizeWorkspaceLayoutAfterMutation(preferredPaneId="") {
  const state = workspaceServices.termaWorkspaceLayout!.normalize(
    {layout:workspaceDockState.workspaceLayout, tabs:applicationState.tabs, focusedPaneId: workspaceDockState.focusedPaneId, activeTabKey:applicationState.activeTabKey},
    preferredPaneId,
    workspaceNextPaneId
  );
  if (!state.layout) return;
  workspaceDockState.workspaceLayout = state.layout;
  applicationState.tabs = state.tabs;
  workspaceDockState.focusedPaneId = state.focusedPaneId;
  applicationState.activeTabKey = state.activeTabKey;
}

export function setPaneActiveKey(pane: WorkspacePaneNode | null, key: string) {
  if (!pane || !pane.tabs.includes(key)) return;
  workspacePaneHistoryService().remember(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  if (pane.id === workspaceDockState.focusedPaneId) applicationState.activeTabKey = key;
}

export function addTab(key: string, title?: string, subtitle?: string, viewName?: string, closable = true, meta: TabMetadata = {}) {
  if (key !== "welcome") {
    applicationState.tabs = applicationState.tabs.filter(tab => tab.key !== "welcome");
    for (const pane of workspaceLeaves()) {
      pane.tabs = pane.tabs.filter(tabKey => tabKey !== "welcome");
      if (pane.activeTabKey === "welcome") pane.activeTabKey = pane.tabs[0] || "";
    }
    normalizeWorkspaceLayoutAfterMutation(workspaceDockState.focusedPaneId);
  }
  let pane = workspaceFindPaneForTab(key)
    || workspaceFindPane(executionPaneId())
    || workspaceFindPane(workspaceDockState.focusedPaneId)
    || workspaceLeaves()[0];
  const insertionAnchorKey = pane?.activeTabKey || applicationState.activeTabKey;
  const result = workspaceServices.termaWorkspaceState!.addTab(applicationState.tabs, insertionAnchorKey, {key, title, subtitle, viewName, closable, ...meta});
  if (!result.added) return;
  applicationState.tabs = result.tabs;
  pane = workspaceFindPaneForTab(key) || pane || workspaceLeaves()[0];
  if (!pane.tabs.includes(key)) {
    const insertion = pane.tabs.indexOf(insertionAnchorKey);
    pane.tabs.splice(insertion >= 0 ? insertion + 1 : pane.tabs.length, 0, key);
  }
  workspacePaneHistoryService().remember(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  workspaceDockState.focusedPaneId = pane.id;
  applicationState.activeTabKey = key;
  applicationState.activeView = viewName || "welcome";
  renderTabs();
  dockTabs.revealWorkspaceTab(key);
}

export function setWorkspaceTabConnectionStatus(key: string, status: string) {
  const normalized = ["connected", "disconnected", "connecting"].includes(status) ? status : "disconnected";
  const matchingTabs = workspaceServices.termaWorkspaceGroups!.tabsByKey(key);
  if (!matchingTabs.length) return;
  for (const tab of matchingTabs) tab.connectionStatus = normalized;
  for (const pane of workspaceLeaves()) {
    if (!pane.tabs.includes(key)) continue;
    dockTabs.paintPaneTabs(pane);
  }
  workspaceServices.termaWorkspaceMobile?.render();
}

export function renderWorkspacePaneContent(paneId: string, options: RenderOptions = {}) {
  if (!workspaceDockElement()) return null;
  if (isMobileLayout() && paneId !== workspaceDockState.focusedPaneId) return null;
  const pane = workspaceFindPane(paneId);
  const tab = applicationState.tabs.find(item => item.key === pane?.activeTabKey);
  if (!pane || !tab) return null;
  const previousActiveKey = applicationState.activeTabKey;
  const previousActiveView = applicationState.activeView;
  applicationState.activeTabKey = tab.key;
  applicationState.activeView = tab.viewName || tab.kind || "welcome";
  try {
    return runInWorkspacePane(paneId, () => {
      const result = workspaceServices.termaWorkspaceTabRuntime!.render(tab, {...options, paneId});
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch(error => runInWorkspacePane(paneId, () => notify(error instanceof Error ? error.message : String(error), "error")));
      }
      return result;
    });
  } finally {
    if (paneId !== workspaceDockState.focusedPaneId) {
      applicationState.activeTabKey = previousActiveKey;
      applicationState.activeView = previousActiveView;
    }
  }
}

export function activateTab(key: string) {
  const tab = applicationState.tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  if (!tab || !pane) return;
  workspaceServices.termaWorkspaceTabRuntime!.activated(key);
  const previousPaneTabKey = pane.activeTabKey;
  saveFocusedSftpPaneState();
  ({focusedPaneId: workspaceDockState.focusedPaneId, activeTabKey:applicationState.activeTabKey, activeView:applicationState.activeView} = workspaceServices.termaWorkspaceState!.activateTab(tab, pane, key));
  workspacePaneHistoryService().remember(pane, key, previousPaneTabKey);
  if (tab.kind === "sftp") filesServices.termaSftpTabs?.runtime.restore(tab.key);
  dockTabs.syncWorkspaceTabActivation(key);
  const fastSftp = tab.kind === "sftp" && typeof sftpTabRuntimes !== "undefined" && sftpTabRuntimes.has(tab.key);
  renderWorkspacePaneContent(pane.id, {fast:fastSftp, paneId:pane.id});
  syncFocusedWorkspaceClasses();
  if (!["terminal", "quick-terminal", "sftp"].includes(tab.kind ?? "")) workspaceServices.termaWorkspaceToolbar?.sync();
}

export function setWorkspace(title?: string, subtitle?: string, viewName = "welcome", key = viewName, updateTab = true, closable = true, meta: TabMetadata = {}) {
  const skipToolbarSync = meta?.skipToolbarSync === true;
  const tabMeta = {...meta};
  delete tabMeta.skipToolbarSync;
  const existingPane = workspaceFindPaneForTab(applicationState.activeTabKey) || workspaceFindPaneForTab(key);
  const paneId = executionPaneId() || existingPane?.id || workspaceDockState.focusedPaneId;
  if (updateTab) addTab(key, title, subtitle, viewName, closable, tabMeta);
  const resolvedPaneId = executionPaneId() || workspaceFindPaneForTab(applicationState.activeTabKey)?.id || paneId;
  const pane = dockLayout.port.pane(resolvedPaneId);
  const workspace = pane.querySelector<HTMLElement>(".workspace");
  if (!workspace) return;
  const view = workspace.querySelector<HTMLElement>(`#view-${workspaceCssEscape(viewName)}`);
  workspace.querySelectorAll<HTMLElement>(":scope > .view").forEach(item => { item.hidden = true; });
  if (view) view.hidden = false;
  pane.dataset.activeView = viewName || "welcome";
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  workspace.classList.toggle("terminal-workspace", terminalLike);
  pane.classList.toggle("terminal-pane", terminalLike);
  pane.classList.toggle("sftp-pane", viewName === "sftp");
  if (resolvedPaneId === workspaceDockState.focusedPaneId) {
    workspaceServices.termaWorkspaceShell.setHeading(subtitle || "");
    applicationState.activeView = viewName || "welcome";
    workspaceServices.termaWorkspaceViews!.presentation.syncTitle(title, subtitle, viewName, key, tabMeta);
    syncFocusedWorkspaceClasses();
  }
  if (!skipToolbarSync) runInWorkspacePane(resolvedPaneId, () => workspaceServices.termaWorkspaceToolbar?.sync());
  if (isMobileLayout() && viewName !== "welcome" && resolvedPaneId === workspaceDockState.focusedPaneId && !applicationState.restoringTabs) workspaceServices.termaWorkspaceShell.showMobileWorkspace();
}

export function closeTabsByKey(keys: string[], anchorKey = "") {
  const runtime = workspaceServices.termaWorkspaceTabRuntime!;
  const closing = runtime.closing(keys);
  const targets = new Set(closing.keys());
  if (!targets.size) {
    if (keys.some(key => applicationState.tabs.some(tab => tab.key === key && tab.pinned))) notify(tr("common:notifications.pinned_tabs_close", {defaultValue:"Unpin pinned tabs before closing them"}), "info");
    return;
  }
  const anchorPane = workspaceFindPaneForTab(anchorKey) || workspaceFindPane(workspaceDockState.focusedPaneId);
  const panes = workspaceLeaves();
  const paneActiveKeysBeforeClose = new Map(panes.map(pane => [pane.id, pane.activeTabKey]));
  const result = workspaceServices.termaWorkspaceState!.removeDockedTabs(applicationState.tabs, panes, targets, pane => workspacePaneHistoryService().recent(pane, targets));
  applicationState.tabs = result.tabs;
  for (const [index, pane] of panes.entries()) {
    pane.tabs = result.panes[index].tabs;
    pane.activeTabKey = result.panes[index].activeTabKey;
    workspacePaneHistoryService().trim(pane);
    if (pane.activeTabKey) workspacePaneHistoryService().remember(pane, pane.activeTabKey, pane.activeTabKey);
  }
  const paneIdsBeforeNormalize = workspaceLeaves().map(pane => pane.id).join("\0");
  normalizeWorkspaceLayoutAfterMutation(anchorPane?.id || workspaceDockState.focusedPaneId);
  const paneIdsAfterNormalize = workspaceLeaves().map(pane => pane.id).join("\0");
  const focusedPane = workspaceFindPane(workspaceDockState.focusedPaneId) || workspaceLeaves()[0];
  workspaceDockState.focusedPaneId = focusedPane.id;
  applicationState.activeTabKey = focusedPane.activeTabKey || "";
  renderTabs({rebuildLayout:paneIdsBeforeNormalize !== paneIdsAfterNormalize});
  for (const pane of workspaceVisiblePanes()) {
    if (pane.id === focusedPane.id || !pane.activeTabKey) continue;
    if (paneActiveKeysBeforeClose.get(pane.id) !== pane.activeTabKey) renderWorkspacePaneContent(pane.id);
  }
  if (applicationState.activeTabKey) {
    const tab = applicationState.tabs.find(item => item.key === applicationState.activeTabKey);
    applicationState.activeView = tab?.viewName || tab?.kind || "welcome";
    renderWorkspacePaneContent(focusedPane.id);
  } else connectionsServices.termaConnectionViews?.renderWelcome();
  runtime.cleanup(closing,true);
  runtime.closed();
}

export function moveWorkspaceTab(key: string, offset: number) {
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return workspaceServices.termaWorkspaceTabActions?.hideMenu();
  const nextTabs = workspaceServices.termaWorkspaceState!.moveTab(pane.tabs, key, offset);
  if (nextTabs === pane.tabs) return workspaceServices.termaWorkspaceTabActions?.hideMenu();
  pane.tabs = nextTabs;
  normalizeWorkspaceLayoutAfterMutation(pane.id);
  workspaceServices.termaWorkspaceTabActions?.hideMenu();
  renderTabs();
  dockTabs.revealWorkspaceTab(key);
}

export function syncResponsivePane() {
  if (workspaceServices.termaWorkspaceShell.syncResponsive()) {
    renderTabs({rebuildLayout:true});
    const focusedPane = workspaceFindPane(workspaceDockState.focusedPaneId);
    for (const pane of workspaceVisiblePanes()) {
      if (pane.id !== focusedPane?.id && pane.activeTabKey) renderWorkspacePaneContent(pane.id);
    }
    if (focusedPane?.activeTabKey) renderWorkspacePaneContent(focusedPane.id);
  }
}

function updateVisibleWorkspaceTabs() {
  for (const pane of workspaceVisiblePanes()) {
    dockTabs.syncTabScroll(pane.id);
    if (pane.activeTabKey) dockTabs.revealWorkspaceTab(pane.activeTabKey);
  }
}

export function mountWorkspaceDock() {
  if (!workspaceDockElement()) return;
  dockLayout.port.pane('pane-1');
  dockLayout.render();
  window.addEventListener('resize', () => requestAnimationFrame(updateVisibleWorkspaceTabs));
}

// The remaining classic terminal and utility scripts use these names during M10.
export function installWorkspaceDockRuntime() {
  Object.assign(globalThis, {
    workspaceCssEscape, workspaceAllTabs, workspaceTabByKey, workspaceHasTabKey,
    workspaceFindPane, workspaceFindPaneForTab, setWorkspaceTabConnectionStatus, activateTab, setWorkspace
  });
  Object.defineProperty(globalThis, 'focusedPaneId', {
    configurable: true,
    get: () => workspaceDockState.focusedPaneId,
    set: (value: string) => { workspaceDockState.focusedPaneId = value; }
  });
}
