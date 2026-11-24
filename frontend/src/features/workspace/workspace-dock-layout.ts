import {workspaceServices} from '@/features/workspace/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {notify} from '@/features/efficiency/notification-actions';
import { focusWorkspacePane } from './workspace-dock-runtime';
import {
  WORKSPACE_MAX_SPLIT_RATIO, WORKSPACE_MIN_SPLIT_RATIO, workspaceDockElement, workspaceDockState,
  workspaceFindPane, workspaceFindPaneForTab, workspaceLeaves, workspacePaneNodes, workspaceVisiblePanes
} from './workspace-dock-state';
import { workspacePaneElement } from './workspace-pane-scope';
import { dockTabs, handleWorkspaceTabsWheel, revealWorkspaceTab, scrollWorkspaceTabs } from './workspace-dock-tabs';
import type { WorkspacePaneNode, WorkspaceSplitNode } from './workspace-layout-service';
import type { WorkspaceViewPort } from './workspace-port';

const tabResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

function viewContents(paneId: string) {
  const template = document.querySelector<HTMLTemplateElement>('#workspaceViewsTpl');
  if (template) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    fragment.querySelectorAll<HTMLElement>('.view').forEach(view => { view.dataset.workspacePaneId = paneId; });
    return fragment;
  }
  const fragment = document.createDocumentFragment();
  for (const name of ['welcome', 'terminal', 'forwards', 'edit', 'import', 'log', 'command', 'sftp', 'local-files', 'settings', 'dashboard', 'remote-desktop', 'remote-terminal', 'ftp', 'linux-desktop']) {
    const section = document.createElement('section');
    section.id = `view-${name}`;
    section.className = 'view';
    section.dataset.workspacePaneId = paneId;
    section.hidden = name !== 'welcome';
    fragment.append(section);
  }
  return fragment;
}

function reportActionError(error: unknown) {
  notify(error instanceof Error ? error.message : String(error), 'error');
}

function getOrCreatePane(id: string) {
  const existing = workspacePaneElement(id);
  if (existing) return existing;
  const pane = workspaceServices.termaWorkspaceViews!.createPane(id, dockViewPort);
  const tabs = pane.querySelector('.tabs');
  if (tabs && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => requestAnimationFrame(() => {
      const model = workspaceFindPane(id);
      if (!model || workspacePaneNodes.get(id) !== pane) return;
      dockTabs.syncTabScroll(id);
      if (model.activeTabKey) revealWorkspaceTab(model.activeTabKey);
    }));
    observer.observe(tabs);
    tabResizeObservers.set(pane, observer);
  }
  workspacePaneNodes.set(id, pane);
  return pane;
}

export const dockViewPort: WorkspaceViewPort = {
  tr: key => tr(key),
  action(name, event, element) {
    const registry = sharedServices.termaEventRegistry;
    if (!registry?.has(name)) return;
    try {
      const result = registry.dispatch(name, {event, element, action: name, dataset: element.dataset});
      void Promise.resolve(result).catch(reportActionError);
    } catch (error) {
      reportActionError(error);
    }
  },
  pane: getOrCreatePane,
  focus: id => focusWorkspacePane(id),
  views: viewContents,
  scroll: (id, direction) => scrollWorkspaceTabs(direction, id),
  tabScroll: id => dockTabs.syncTabScroll(id),
  tabWheel: (id, event) => handleWorkspaceTabsWheel(event, id),
  tabsMenu: event => workspaceServices.termaWorkspaceGroups?.tabsMenu(event),
  splitStart: (id, event) => workspaceServices.termaWorkspaceDrag?.splitter.begin(id, event),
  splitKey: (id, event) => workspaceServices.termaWorkspaceDrag?.splitter.keydown(id, event),
  splitReset: id => workspaceServices.termaWorkspaceDrag?.splitter.setRatio(id, 0.5),
  get minRatio() { return WORKSPACE_MIN_SPLIT_RATIO; },
  get maxRatio() { return WORKSPACE_MAX_SPLIT_RATIO; }
};

export function applyWorkspaceSplitGeometry(element: HTMLElement, node: WorkspaceSplitNode) {
  const {minRatio, maxRatio} = dockViewPort;
  const ratio = Math.max(minRatio, Math.min(maxRatio, Number(node.ratio) || 0.5));
  node.ratio = ratio;
  element.style.setProperty('--workspace-split-ratio', `${ratio * 100}%`);
  const separator = element.querySelector(':scope > .workspace-splitter');
  if (separator) {
    separator.setAttribute('aria-valuemin', String(Math.round(minRatio * 100)));
    separator.setAttribute('aria-valuemax', String(Math.round(maxRatio * 100)));
    separator.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  }
}

function visibleTree() {
  return isMobileLayout() ? workspaceVisiblePanes()[0] ?? workspaceDockState.workspaceLayout : workspaceDockState.workspaceLayout;
}

function needsRebuild() {
  const dock = workspaceDockElement();
  if (!dock) return false;
  const tree = visibleTree(), root = dock.firstElementChild as HTMLElement | null;
  if (!root || !tree || dock.children.length !== 1) return true;
  const containsPane = (pane: WorkspacePaneNode) => dock.contains(workspacePaneElement(pane.id));
  if (tree.type === 'pane') return root.dataset.paneSlotId !== tree.id || !containsPane(tree);
  return root.dataset.splitId !== tree.id || workspaceVisiblePanes().some(pane => !containsPane(pane));
}

function releasePane(paneId: string, pane: HTMLElement) {
  tabResizeObservers.get(pane)?.disconnect();
  tabResizeObservers.delete(pane);
  const view = pane.querySelector<HTMLElement>('#view-sftp');
  const key = view?.dataset.sftpTabKey;
  if (view && key && workspaceFindPaneForTab(key)) filesServices.termaSftpPage?.preserveView(view, key);
  workspaceServices.termaWorkspaceViews!.releasePane(pane);
  pane.remove();
  workspacePaneNodes.delete(paneId);
}

function render() {
  const dock = workspaceDockElement(), views = workspaceServices.termaWorkspaceViews;
  if (!dock || !views) return;
  const tree = visibleTree();
  if (!tree) return;
  const viewport = terminalServices.termaTerminalViewport;
  const anchors = viewport?.capture() ?? null;
  views.layout(dock, tree, dockViewPort);
  const livePanes = new Set(workspaceLeaves().map(pane => pane.id));
  for (const [id, pane] of workspacePaneNodes) {
    if (!livePanes.has(id)) releasePane(id, pane);
  }
  document.body.classList.toggle('workspace-is-split', livePanes.size > 1 && !isMobileLayout());
  viewport?.schedule({anchors});
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) dockTabs.syncTabScroll(pane.id);
    viewport?.schedule({anchors});
    for (const pane of workspaceVisiblePanes()) {
      const list = workspacePaneElement(pane.id)?.querySelector<HTMLElement>('#sftpList');
      if (list) filesServices.termaSftpColumns.syncSftpListLayout(list);
    }
  });
}

export const dockLayout = { port: dockViewPort, needsRebuild, render };
