import {workspaceServices} from '@/features/workspace/installed-services';
import type { WorkspaceLayoutNode, WorkspacePaneNode, WorkspaceSplitNode } from './workspace-layout-service';
import { createWorkspaceTabDrag, workspaceTabInsertion, type WorkspaceTabDragPort } from './workspace-tab-drag';

export type WorkspaceDropZone = 'tabs' | 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface WorkspaceDropTarget {
  paneId?: string;
  zone: WorkspaceDropZone;
  index?: number | null;
}

type WorkspaceDropMutationPort = {
  findPaneForTab: (key: string) => WorkspacePaneNode | null;
  findPane: (id: string) => WorkspacePaneNode | null;
  nextPaneId: () => string;
  nextSplitId: () => string;
  replacePaneWithSplit: (paneId: string, split: WorkspaceSplitNode) => WorkspaceLayoutNode;
  setLayout: (layout: WorkspaceLayoutNode) => void;
  normalize: (preferredPaneId: string) => void;
  setFocusedPane: (id: string) => void;
  setActiveTab: (key: string) => void;
  setActiveView: (view: string) => void;
  tab: (key: string) => { viewName?: string; kind?: string } | null;
  renderTabs: (options?: { rebuildLayout?: boolean }) => void;
  renderPaneContent: (id: string) => void;
  revealTab: (key: string) => void;
  syncFocused: () => void;
  syncToolbars: () => void;
};

type WorkspaceDropMutationDrag = { key: string; sourceActiveTabKey?: string };

type WorkspaceDragPort = {
  mobile: () => boolean;
  label: (zone: Exclude<WorkspaceDropZone, 'tabs'>) => string;
  panes: () => Iterable<HTMLElement>;
  pane: (id: string) => HTMLElement | null;
  splitter: () => WorkspaceSplitterPort;
  tabs: WorkspaceTabDragPort;
  mutation: () => WorkspaceDropMutationPort;
};

type WorkspaceSplitterPort = {
  min: number;
  max: number;
  split: (id: string) => WorkspaceSplitNode | null;
  element: (id: string) => HTMLElement | null;
  update: (element: HTMLElement, split: WorkspaceSplitNode) => void;
  save: () => void;
  fit: () => void;
};

function dropZoneAtPoint(port: WorkspaceDragPort, pane: Element, clientX: number, clientY: number): WorkspaceDropTarget | null {
  const tabsShell = pane.querySelector('.tabs-shell');
  const tabsRect = tabsShell?.getBoundingClientRect();
  if (tabsShell && tabsRect && clientY >= tabsRect.top && clientY <= tabsRect.bottom) {
    return { zone: 'tabs', index: workspaceTabInsertion(tabsShell, clientX).index };
  }

  const workspace = pane.querySelector('.workspace');
  const rect = workspace?.getBoundingClientRect();
  if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  if (port.mobile()) return { zone: 'center', index: null };

  const distances = [
    ['left', (clientX - rect.left) / Math.max(1, rect.width)],
    ['right', (rect.right - clientX) / Math.max(1, rect.width)],
    ['top', (clientY - rect.top) / Math.max(1, rect.height)],
    ['bottom', (rect.bottom - clientY) / Math.max(1, rect.height)]
  ] as const;
  const nearest = [...distances].sort((left, right) => left[1] - right[1])[0];
  return { zone: nearest[1] <= 0.36 ? nearest[0] : 'center', index: null };
}

function clearDropIndicators(panes: Iterable<HTMLElement>) {
  for (const pane of panes) {
    const indicator = pane.querySelector<HTMLElement>('.workspace-pane-drop-indicator');
    if (indicator) {
      indicator.hidden = true;
      indicator.dataset.zone = '';
    }
    const insertion = pane.querySelector<HTMLElement>('.workspace-tab-insert-indicator');
    if (insertion) insertion.hidden = true;
  }
}

function showTabInsertionIndicator(pane: HTMLElement, index: number) {
  const shell = pane.querySelector<HTMLElement>('.tabs-shell');
  const tabsNode = pane.querySelector<HTMLElement>('.tabs');
  const insertion = pane.querySelector<HTMLElement>('.workspace-tab-insert-indicator');
  if (!shell || !tabsNode || !insertion) return;
  const candidates = [...tabsNode.querySelectorAll<HTMLElement>('.tab:not(.tab-dragging)')];
  const boundedIndex = Math.max(0, Math.min(candidates.length, Number(index) || 0));
  const shellRect = shell.getBoundingClientRect();
  const tabsRect = tabsNode.getBoundingClientRect();
  const anchorRect = boundedIndex < candidates.length
    ? candidates[boundedIndex].getBoundingClientRect()
    : candidates.at(-1)?.getBoundingClientRect();
  const clientX = boundedIndex < candidates.length
    ? anchorRect?.left ?? tabsRect.left
    : anchorRect?.right ?? tabsRect.left;
  const clampedX = Math.max(tabsRect.left, Math.min(tabsRect.right, clientX));
  insertion.style.left = `${clampedX - shellRect.left}px`;
  insertion.hidden = false;
}

function renderDropTargetIndicator(port: WorkspaceDragPort, pane: HTMLElement, target: WorkspaceDropTarget) {
  const indicator = pane.querySelector<HTMLElement>('.workspace-pane-drop-indicator');
  if (!indicator) return null;
  const insertion = pane.querySelector<HTMLElement>('.workspace-tab-insert-indicator');
  if (target.zone === 'tabs') {
    indicator.hidden = true;
    indicator.dataset.zone = '';
    showTabInsertionIndicator(pane, target.index ?? 0);
    return null;
  }
  if (insertion) insertion.hidden = true;
  indicator.hidden = false;
  indicator.dataset.zone = target.zone;
  const span = indicator.querySelector('span');
  if (span) span.textContent = port.label(target.zone);
  return span;
}

function clampSplitRatio(value: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(min, Math.min(max, 0.5));
  return Math.max(min, Math.min(max, numeric));
}

function splitRatioAtPointer(direction: 'row' | 'column', event: PointerEvent, rect: DOMRect, min: number, max: number) {
  const raw = direction === 'row'
    ? (event.clientX - rect.left) / Math.max(1, rect.width)
    : (event.clientY - rect.top) / Math.max(1, rect.height);
  return clampSplitRatio(raw, min, max);
}

function createSplitterControls(port: WorkspaceDragPort) {
  let drag: { pointerId: number; end: () => void } | undefined;

  function begin(id: string, event: PointerEvent) {
    if (event.button !== 0 || port.mobile() || drag) return;
    const layout = port.splitter();
    const split = layout.split(id);
    const handle = event.currentTarget as HTMLElement | null;
    const element = handle?.closest<HTMLElement>('.workspace-split');
    if (!split || !handle || !element) return;
    event.preventDefault();
    const { pointerId } = event;
    const controller = new AbortController();
    const { signal } = controller;
    const directionClass = split.direction === 'row' ? 'workspace-split-resizing-row' : 'workspace-split-resizing-column';
    const end = () => {
      drag = undefined;
      controller.abort();
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch { /* The handle can be removed during layout changes. */ }
      document.body.classList.remove('workspace-split-resizing', directionClass);
      layout.save();
      layout.fit();
    };
    drag = { pointerId, end };
    document.body.classList.add('workspace-split-resizing', directionClass);
    try { handle.setPointerCapture(pointerId); } catch { /* Capture can be unavailable for synthetic input. */ }
    window.addEventListener('pointermove', move => {
      if (move.pointerId !== pointerId) return;
      const liveSplit = layout.split(id);
      if (!liveSplit) return;
      liveSplit.ratio = splitRatioAtPointer(liveSplit.direction, move, element.getBoundingClientRect(), layout.min, layout.max);
      layout.update(element, liveSplit);
      move.preventDefault();
      layout.fit();
    }, { passive: false, signal });
    const finish = (release: PointerEvent) => {
      if (release.pointerId === drag?.pointerId) drag.end();
    };
    window.addEventListener('pointerup', finish, { signal });
    window.addEventListener('pointercancel', finish, { signal });
    window.addEventListener('pagehide', end, { signal });
  }

  function setRatio(id: string, ratio: number) {
    const layout = port.splitter();
    const split = layout.split(id);
    if (!split) return;
    split.ratio = clampSplitRatio(ratio, layout.min, layout.max);
    const element = layout.element(id);
    if (element) layout.update(element, split);
    layout.save();
    layout.fit();
  }

  function keydown(id: string, event: KeyboardEvent) {
    const split = port.splitter().split(id);
    if (!split) return;
    const [decrease, increase] = split.direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    setRatio(id, split.ratio + (event.key === decrease ? -0.025 : 0.025));
  }

  return { begin, setRatio, keydown };
}

export function applyTabDrop(port: WorkspaceDropMutationPort, drag: WorkspaceDropMutationDrag, target: WorkspaceDropTarget | null) {
  const sourcePane = port.findPaneForTab(drag.key);
  const targetPane = target?.paneId ? port.findPane(target.paneId) : null;
  if (!sourcePane || !targetPane || !target) return false;
  const edgeDrop = ['left', 'right', 'top', 'bottom'].includes(target.zone);
  if (edgeDrop && sourcePane.id === targetPane.id && sourcePane.tabs.length <= 1) return false;
  const sourceIndex = sourcePane.tabs.indexOf(drag.key);
  if (sourceIndex < 0) return false;
  sourcePane.tabs.splice(sourceIndex, 1);
  if (!sourcePane.tabs.includes(sourcePane.activeTabKey)) {
    const previousTab = sourcePane.tabs[sourceIndex - 1] || '';
    const rememberedActive = drag.sourceActiveTabKey && drag.sourceActiveTabKey !== drag.key && sourcePane.tabs.includes(drag.sourceActiveTabKey)
      ? drag.sourceActiveTabKey
      : '';
    const activeFallback = drag.sourceActiveTabKey === drag.key ? previousTab : '';
    sourcePane.activeTabKey = rememberedActive || activeFallback || sourcePane.tabs[Math.min(sourceIndex, sourcePane.tabs.length - 1)] || sourcePane.tabs.at(-1) || '';
  }

  let destinationPane = targetPane;
  if (edgeDrop) {
    const newPane: WorkspacePaneNode = { type: 'pane', id: port.nextPaneId(), tabs: [drag.key], activeTabKey: drag.key };
    const newFirst = ['left', 'top'].includes(target.zone);
    const split: WorkspaceSplitNode = {
      type: 'split', id: port.nextSplitId(),
      direction: ['left', 'right'].includes(target.zone) ? 'row' : 'column', ratio: 0.5,
      first: newFirst ? newPane : targetPane,
      second: newFirst ? targetPane : newPane
    };
    port.setLayout(port.replacePaneWithSplit(targetPane.id, split));
    destinationPane = newPane;
  } else {
    let insertion = Number.isInteger(target.index) ? target.index as number : targetPane.tabs.length;
    insertion = Math.max(0, Math.min(targetPane.tabs.length, insertion));
    targetPane.tabs.splice(insertion, 0, drag.key);
    targetPane.activeTabKey = drag.key;
  }
  port.normalize(destinationPane.id);
  port.setFocusedPane(destinationPane.id);
  port.setActiveTab(drag.key);
  const tab = port.tab(drag.key);
  port.setActiveView(tab?.viewName || tab?.kind || 'welcome');
  port.renderTabs({ rebuildLayout: true });
  const sourceAfter = port.findPane(sourcePane.id);
  if (sourceAfter?.activeTabKey && sourceAfter.id !== destinationPane.id) port.renderPaneContent(sourceAfter.id);
  port.renderPaneContent(destinationPane.id);
  port.revealTab(drag.key);
  port.syncFocused();
  port.syncToolbars();
  return true;
}

export function createWorkspaceDragService(port: WorkspaceDragPort) {
  let dropTarget: WorkspaceDropTarget | null = null;

  function clearDropTarget() {
    clearDropIndicators(port.panes());
    dropTarget = null;
    return null;
  }

  function updateDropTarget(clientX: number, clientY: number) {
    const pane = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.workspace-pane');
    const paneId = pane?.dataset.paneId;
    if (!pane || !paneId || port.pane(paneId) !== pane) return clearDropTarget();
    const target = dropZoneAtPoint(port, pane, clientX, clientY);
    if (!target) return clearDropTarget();
    clearDropIndicators([...port.panes()].filter(candidate => candidate !== pane));
    dropTarget = { paneId, ...target };
    return renderDropTargetIndicator(port, pane, target);
  }

  const tabs = createWorkspaceTabDrag(port.tabs, {
    scrollArea(sourcePaneId) {
      const pane = port.pane(dropTarget?.paneId || sourcePaneId);
      const tabs = pane?.querySelector<HTMLElement>('.tabs');
      const shell = pane?.querySelector<HTMLElement>('.tabs-shell');
      return tabs && shell ? { tabs, shell } : null;
    },
    update: updateDropTarget,
    clear: clearDropTarget,
    apply(key, sourceActiveTabKey) {
      return applyTabDrop(port.mutation(), { key, sourceActiveTabKey }, dropTarget);
    }
  });
  return {
    dropZoneAtPoint: (pane: Element, clientX: number, clientY: number) => dropZoneAtPoint(port, pane, clientX, clientY),
    tabs,
    splitter: createSplitterControls(port),
    applyTabDrop: (drag: WorkspaceDropMutationDrag, target: WorkspaceDropTarget | null) => applyTabDrop(port.mutation(), drag, target)
  };
}

export function installWorkspaceDragService(port: WorkspaceDragPort) {
  if (workspaceServices.termaWorkspaceDrag) return;
  workspaceServices.termaWorkspaceDrag = createWorkspaceDragService(port);
}

export interface InstalledFeaturesWorkspaceWorkspaceDragServiceServices {
  termaWorkspaceDrag?: ReturnType<typeof createWorkspaceDragService>;
}
