import {efficiencyServices} from '@/features/efficiency/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {applicationState} from '@/shared/application-state';
import { normalizeWorkspaceLayoutAfterMutation } from './workspace-dock-runtime';
import { workspaceDockState, workspaceFindPane, workspaceFindPaneForTab, workspaceLeaves, workspacePaneNodes, workspaceVisiblePanes } from './workspace-dock-state';
import { currentWorkspacePaneId, workspacePaneElement } from './workspace-pane-scope';
import { dockLayout } from './workspace-dock-layout';
import { workspaceTabPresentation } from './workspace-tab-presentation';
import type { WorkspacePaneNode } from './workspace-layout-service';
import type { WorkspaceTabView } from './workspace-port';
import type { WorkspaceTab } from './workspace-tab-runtime';

function tabsElement(paneId: string) {
  return workspacePaneElement(paneId)?.querySelector<HTMLElement>('.tabs');
}

function syncTabScroll(paneId = currentWorkspacePaneId()) {
  const pane = workspacePaneElement(paneId);
  const container = pane?.querySelector<HTMLElement>('.tabs');
  const left = pane?.querySelector<HTMLButtonElement>('.tabs-scroll-left');
  const right = pane?.querySelector<HTMLButtonElement>('.tabs-scroll-right');
  if (!container || !left || !right) return;
  const overflowing = container.scrollWidth > container.clientWidth + 1;
  left.hidden = right.hidden = !overflowing;
  left.disabled = !overflowing || container.scrollLeft <= 1;
  right.disabled = !overflowing || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  pane?.querySelector('.tabs-shell')?.classList.toggle('overflowing', overflowing);
}

export function scrollWorkspaceTabs(direction: number, paneId = currentWorkspacePaneId()) {
  const container = tabsElement(paneId);
  if (!container) return;
  container.scrollBy({left: direction * Math.max(160, container.clientWidth * 0.7), behavior: 'smooth'});
}

export function handleWorkspaceTabsWheel(event: WheelEvent, paneId = currentWorkspacePaneId()) {
  const container = tabsElement(paneId);
  if (!container || container.scrollWidth <= container.clientWidth + 1) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const canScroll = delta < 0 ? container.scrollLeft > 0 : container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
  if (!delta || !canScroll) return;
  event.preventDefault();
  container.scrollLeft += delta;
}

export function revealWorkspaceTab(key: string) {
  requestAnimationFrame(() => {
    const pane = workspaceFindPaneForTab(key) ?? workspaceFindPane(workspaceDockState.focusedPaneId);
    if (!pane) return;
    const container = tabsElement(pane.id);
    const tab = container && [...container.querySelectorAll<HTMLElement>('.tab')].find(item => item.dataset.tabKey === key);
    if (!container || !tab) return;
    const bounds = container.getBoundingClientRect(), tabBounds = tab.getBoundingClientRect();
    const margin = Math.min(6, Math.max(2, container.clientWidth * 0.02));
    if (tabBounds.left < bounds.left + margin) {
      container.scrollLeft = Math.max(0, container.scrollLeft - (bounds.left + margin - tabBounds.left));
    } else if (tabBounds.right > bounds.right - margin) {
      container.scrollLeft = Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + (tabBounds.right - bounds.right + margin));
    }
    syncTabScroll(pane.id);
  });
}

export function syncWorkspaceTabIds() {
  for (const [paneId, pane] of workspacePaneNodes) {
    for (const [selector, id] of [['.tabs', 'tabs'], ['.tabs-scroll-left', 'tabsScrollLeft'], ['.tabs-scroll-right', 'tabsScrollRight']]) {
      const element = pane.querySelector<HTMLElement>(selector);
      if (!element) continue;
      if (paneId === workspaceDockState.focusedPaneId) element.id = id;
      else element.removeAttribute('id');
    }
  }
}

export function workspaceTabViewModel(tab: WorkspaceTab, pane: {activeTabKey: string; id?: string}): WorkspaceTabView {
  const broadcast = efficiencyServices.termaTerminalBroadcast?.isTarget(tab.key) ?? false;
  const selected = workspaceServices.termaWorkspaceGroups?.isSelected(tab.key) ?? false;
  const active = tab.key === pane.activeTabKey;
  if (active && tab.activityState) tab.activityState = '';
  const title = tab.kind === 'local-files'
    ? (tab.fileSource ? filesServices.termaLocalFileRuntime.pages.label(tab.fileSource) : tr('common:auto.local_files', {defaultValue: 'Local Files'}))
    : workspaceTabPresentation.title(tab);
  const tabTitle = {...tab, title};
  const tooltip = [
    title, workspaceTabPresentation.subtitle(tab),
    broadcast ? tr('navigation:auto.terminal_syncing', {defaultValue: 'Terminal broadcast active'}) : '',
    selected ? tr('navigation:auto.selected_for_workspace', {defaultValue: 'Selected for workspace grouping'}) : ''
  ].filter(Boolean).join(' - ');
  const label = [
    title,
    broadcast ? tr('navigation:auto.terminal_syncing_suffix', {defaultValue: ', included in terminal sync'}) : '',
    selected ? tr('navigation:auto.selected_suffix', {defaultValue: ', selected'}) : ''
  ].join('');
  const statusVisible = ['terminal', 'quick-terminal', 'sftp', 'remote-terminal'].includes(tab.kind ?? '')
    || (tab.kind === 'remote-desktop' && tab.protocol === 'vnc');
  const status = statusVisible ? tab.connectionStatus || 'disconnected' : '';
  const dropTarget = [...(workspacePaneElement(pane.id)?.querySelectorAll<HTMLElement>('.tab.sftp-drop-target') ?? [])]
    .some(node => node.dataset.tabKey === tab.key);
  return {
    key: tab.key, kind: tab.kind ?? '', protocol: workspaceTabPresentation.protocol(tabTitle),
    title: workspaceTabPresentation.compact(tabTitle), label, tooltip,
    closeLabel: tr('navigation:auto.close_tab', {defaultValue: 'Close tab'}),
    active, selected, broadcast, pinned: Boolean(tab.pinned), closable: Boolean(tab.closable),
    activity: tab.activityState ?? '', status, statusLabel: workspaceTabPresentation.status(status), dropTarget
  };
}

function tabsForPane(pane: WorkspacePaneNode) {
  const byKey = new Map(applicationState.tabs.map(tab => [tab.key, tab]));
  return pane.tabs.flatMap(key => {
    const tab = byKey.get(key);
    return tab ? [tab] : [];
  });
}

export function paintPaneTabs(pane: WorkspacePaneNode) {
  const element = workspacePaneElement(pane.id);
  const container = element?.querySelector<HTMLElement>('.tabs');
  if (!container) return;
  const mobile = isMobileLayout();
  const display = mobile ? workspaceFindPane(workspaceDockState.focusedPaneId) ?? pane : pane;
  element?.classList.toggle('focused', pane.id === workspaceDockState.focusedPaneId);
  const previousScroll = container.scrollLeft;
  workspaceServices.termaWorkspaceViews?.tabs(container, (mobile ? applicationState.tabs : tabsForPane(pane)).map(tab => workspaceTabViewModel(tab, display)),
    dockLayout.port);
  container.scrollLeft = previousScroll;
  syncTabScroll(pane.id);
}

function repaintVisibleTabs() {
  for (const pane of workspaceVisiblePanes()) paintPaneTabs(pane);
  syncWorkspaceTabIds();
}

export function renderTabs(options: {rebuildLayout?: boolean} = {}) {
  filesServices.termaSftpTabs?.runtime.titles();
  normalizeWorkspaceLayoutAfterMutation(workspaceFindPane(workspaceDockState.focusedPaneId)?.id || workspaceLeaves()[0]?.id || '');
  const layout = dockLayout;
  const rebuild = options.rebuildLayout ?? layout.needsRebuild();
  if (rebuild) layout.render();
  repaintVisibleTabs();
  workspaceServices.termaWorkspaceToolbar?.sync();
  workspaceServices.termaWorkspaceGroups?.render();
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) {
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
    }
  });
  if (!applicationState.restoringTabs) workspaceServices.termaWorkspacePersistence?.schedule();
}

export function syncWorkspaceTabActivation(key: string) {
  const tab = applicationState.tabs.find(item => item.key === key);
  if (tab) tab.activityState = '';
  const layout = dockLayout;
  if (isMobileLayout() && layout.needsRebuild()) layout.render();
  repaintVisibleTabs();
  workspaceServices.termaWorkspaceGroups?.render();
  revealWorkspaceTab(key);
  if (!applicationState.restoringTabs) workspaceServices.termaWorkspacePersistence?.schedule();
}

export const dockTabs = {
  syncTabScroll, scrollWorkspaceTabs, handleWorkspaceTabsWheel, revealWorkspaceTab,
  syncWorkspaceTabIds, workspaceTabViewModel, paintPaneTabs, renderTabs, syncWorkspaceTabActivation
};

