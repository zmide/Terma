import {workspaceServices} from '@/features/workspace/installed-services';
export type WorkspaceLayoutTab = { key: string };

export type WorkspacePaneNode = {
  type: 'pane';
  id: string;
  tabs: string[];
  activeTabKey: string;
};

export type WorkspaceSplitNode = {
  type: 'split';
  id: string;
  direction: 'row' | 'column';
  ratio: number;
  first: WorkspaceLayoutNode;
  second: WorkspaceLayoutNode;
};

export type WorkspaceLayoutNode = WorkspacePaneNode | WorkspaceSplitNode;

export type WorkspaceLayoutState<T extends WorkspaceLayoutTab = WorkspaceLayoutTab> = {
  layout: WorkspaceLayoutNode | null;
  tabs: T[];
  focusedPaneId: string;
  activeTabKey: string;
};

export type WorkspaceLayoutRestoreOptions = {
  validKeys: ReadonlySet<string>;
  usedKeys?: Set<string>;
  usedPaneIds?: Set<string>;
  usedSplitIds?: Set<string>;
  maxDepth?: number;
  maxNodes?: number;
  minRatio?: number;
  maxRatio?: number;
  nextPaneId: (reservedIds: ReadonlySet<string>) => string;
  nextSplitId: (reservedIds: ReadonlySet<string>) => string;
};

export type WorkspaceLayoutIdAllocation = {
  id: string;
  serial: number;
};

export type WorkspaceLayoutService = {
  leaves: (node: WorkspaceLayoutNode | null, result?: WorkspacePaneNode[]) => WorkspacePaneNode[];
  findPane: (paneId: string, node: WorkspaceLayoutNode | null) => WorkspacePaneNode | null;
  findPaneForTab: (key: string, node: WorkspaceLayoutNode | null) => WorkspacePaneNode | null;
  findSplit: (splitId: string, node: WorkspaceLayoutNode | null) => WorkspaceSplitNode | null;
  allocateId: (prefix: 'pane' | 'split', node: WorkspaceLayoutNode | null, occupiedIds: ReadonlySet<string>, serial: number) => WorkspaceLayoutIdAllocation;
  replacePaneWithSplit: (targetPaneId: string, splitNode: WorkspaceSplitNode, node: WorkspaceLayoutNode) => WorkspaceLayoutNode;
  prune: (node: WorkspaceLayoutNode | null) => WorkspaceLayoutNode | null;
  filter: (node: WorkspaceLayoutNode | null, allowedKeys: ReadonlySet<string>, minRatio?: number, maxRatio?: number) => WorkspaceLayoutNode | null;
  serialize: (node: WorkspaceLayoutNode | null) => WorkspaceLayoutNode | null;
  restore: (saved: unknown, options: WorkspaceLayoutRestoreOptions) => WorkspaceLayoutNode | null;
  normalize: <T extends WorkspaceLayoutTab>(state: WorkspaceLayoutState<T>, preferredPaneId: string, nextPaneId: () => string) => WorkspaceLayoutState<T>;
};

function leaves(node: WorkspaceLayoutNode | null, result: WorkspacePaneNode[] = []) {
  if (!node) return result;
  if (node.type === 'pane') {
    result.push(node);
    return result;
  }
  leaves(node.first, result);
  leaves(node.second, result);
  return result;
}

function findPane(paneId: string, node: WorkspaceLayoutNode | null): WorkspacePaneNode | null {
  if (!node) return null;
  if (node.type === 'pane') return node.id === paneId ? node : null;
  return findPane(paneId, node.first) || findPane(paneId, node.second);
}

function findPaneForTab(key: string, node: WorkspaceLayoutNode | null) {
  return leaves(node).find(pane => pane.tabs.includes(key)) || null;
}

function findSplit(splitId: string, node: WorkspaceLayoutNode | null): WorkspaceSplitNode | null {
  if (!node || node.type === 'pane') return null;
  if (node.id === splitId) return node;
  return findSplit(splitId, node.first) || findSplit(splitId, node.second);
}

function allocateId(prefix: 'pane' | 'split', node: WorkspaceLayoutNode | null, occupiedIds: ReadonlySet<string>, serial: number): WorkspaceLayoutIdAllocation {
  const used = new Set(occupiedIds);
  const pending: WorkspaceLayoutNode[] = node ? [node] : [];
  while (pending.length) {
    const current = pending.pop() as WorkspaceLayoutNode;
    if (current.id.startsWith(`${prefix}-`)) used.add(current.id);
    if (current.type === 'split') {
      pending.push(current.first, current.second);
    }
  }
  let nextSerial = Number.isFinite(serial) ? Math.max(0, Math.floor(serial)) : 0;
  let id = `${prefix}-${nextSerial + 1}`;
  while (used.has(id)) {
    nextSerial += 1;
    id = `${prefix}-${nextSerial + 1}`;
  }
  return { id, serial: nextSerial + 1 };
}

function replacePaneWithSplit(targetPaneId: string, splitNode: WorkspaceSplitNode, node: WorkspaceLayoutNode): WorkspaceLayoutNode {
  if (node.type === 'pane') return node.id === targetPaneId ? splitNode : node;
  node.first = replacePaneWithSplit(targetPaneId, splitNode, node.first);
  node.second = replacePaneWithSplit(targetPaneId, splitNode, node.second);
  return node;
}

function prune(node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null {
  if (!node) return null;
  if (node.type === 'pane') return node.tabs.length ? node : null;
  const first = prune(node.first);
  const second = prune(node.second);
  if (!first) return second;
  if (!second) return first;
  node.first = first;
  node.second = second;
  return node;
}

function filter(node: WorkspaceLayoutNode | null, allowedKeys: ReadonlySet<string>, minRatio = 0.2, maxRatio = 0.8): WorkspaceLayoutNode | null {
  if (!node) return null;
  if (node.type === 'pane') {
    const tabs = node.tabs.filter(key => allowedKeys.has(key));
    if (!tabs.length) return null;
    return {
      type: 'pane',
      id: node.id,
      tabs,
      activeTabKey: tabs.includes(node.activeTabKey) ? node.activeTabKey : tabs[0]
    };
  }
  const first = filter(node.first, allowedKeys, minRatio, maxRatio);
  const second = filter(node.second, allowedKeys, minRatio, maxRatio);
  if (!first) return second;
  if (!second) return first;
  return {
    type: 'split',
    id: node.id,
    direction: node.direction === 'column' ? 'column' : 'row',
    ratio: clampRatio(node.ratio, minRatio, maxRatio),
    first,
    second
  };
}

function serialize(node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null {
  if (!node) return null;
  if (node.type === 'pane') {
    return { type: 'pane', id: node.id, tabs: [...node.tabs], activeTabKey: node.activeTabKey };
  }
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    first: serialize(node.first) as WorkspaceLayoutNode,
    second: serialize(node.second) as WorkspaceLayoutNode
  };
}

function restore(saved: unknown, options: WorkspaceLayoutRestoreOptions): WorkspaceLayoutNode | null {
  const {
    validKeys, usedKeys = new Set<string>(), usedPaneIds = new Set<string>(), usedSplitIds = new Set<string>(),
    maxDepth = 32, maxNodes = 256, minRatio = 0.2, maxRatio = 0.8, nextPaneId, nextSplitId
  } = options;
  let count = 0;

  function restoreNode(savedNode: unknown, depth: number): WorkspaceLayoutNode | null {
    if (!savedNode || typeof savedNode !== 'object') return null;
    count += 1;
    if (depth > maxDepth || count > maxNodes) return null;
    const value = savedNode as Partial<WorkspaceLayoutNode>;
    if (value.type === 'pane') {
      const paneId = claimRestoredId(value.id, usedPaneIds, nextPaneId);
      const paneTabs = (Array.isArray(value.tabs) ? value.tabs : []).filter(key => {
        if (typeof key !== 'string' || !validKeys.has(key) || usedKeys.has(key)) return false;
        usedKeys.add(key);
        return true;
      });
      if (!paneTabs.length) return null;
      return {
        type: 'pane',
        id: paneId,
        tabs: paneTabs,
        activeTabKey: paneTabs.includes(value.activeTabKey as string) ? value.activeTabKey as string : paneTabs[0]
      };
    }
    if (value.type !== 'split') return null;
    const splitId = claimRestoredId(value.id, usedSplitIds, nextSplitId);
    const first = restoreNode(value.first, depth + 1);
    const second = restoreNode(value.second, depth + 1);
    if (!first) return second;
    if (!second) return first;
    return {
      type: 'split',
      id: splitId,
      direction: value.direction === 'column' ? 'column' : 'row',
      ratio: clampRatio(value.ratio, minRatio, maxRatio),
      first,
      second
    };
  }
  return restoreNode(saved, 0);
}

function claimRestoredId(savedId: unknown, usedIds: Set<string>, allocate: (reservedIds: ReadonlySet<string>) => string) {
  const id = typeof savedId === 'string' && savedId && !usedIds.has(savedId) ? savedId : allocate(usedIds);
  usedIds.add(id);
  return id;
}

function clampRatio(value: unknown, min: number, max: number) {
  const numeric = Number(value);
  const fallback = Math.max(min, Math.min(max, 0.5));
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function normalize<T extends WorkspaceLayoutTab>(state: WorkspaceLayoutState<T>, preferredPaneId: string, nextPaneId: () => string): WorkspaceLayoutState<T> {
  let layout = prune(state.layout);
  if (!layout) {
    const paneId = preferredPaneId || nextPaneId();
    layout = { type: 'pane', id: paneId, tabs: [], activeTabKey: '' };
  }
  const visiblePanes = leaves(layout);
  const byKey = new Map(state.tabs.map(tab => [tab.key, tab]));
  const assigned = new Set<string>();
  for (const pane of visiblePanes) {
    pane.tabs = pane.tabs.filter(key => {
      if (!byKey.has(key) || assigned.has(key)) return false;
      assigned.add(key);
      return true;
    });
    if (!pane.tabs.includes(pane.activeTabKey)) pane.activeTabKey = pane.tabs[0] || '';
  }
  const preferred = findPane(preferredPaneId, layout)
    || findPane(state.focusedPaneId, layout)
    || visiblePanes[0];
  for (const tab of state.tabs) {
    if (assigned.has(tab.key)) continue;
    preferred?.tabs.push(tab.key);
    assigned.add(tab.key);
  }
  if (preferred && state.activeTabKey && preferred.tabs.includes(state.activeTabKey)) {
    preferred.activeTabKey = state.activeTabKey;
  }
  if (preferred && !preferred.activeTabKey && preferred.tabs.length) preferred.activeTabKey = preferred.tabs[0];
  const nextFocusedPaneId = findPane(state.focusedPaneId, layout) ? state.focusedPaneId : (preferred?.id || '');
  const orderedTabs = leaves(layout).flatMap(pane => pane.tabs)
    .map(key => byKey.get(key))
    .filter((tab): tab is T => Boolean(tab));
  const focused = findPane(nextFocusedPaneId, layout) || leaves(layout)[0];
  return {
    layout,
    tabs: orderedTabs,
    focusedPaneId: focused?.id || nextFocusedPaneId,
    activeTabKey: focused?.activeTabKey || ''
  };
}

export function createWorkspaceLayoutService(): WorkspaceLayoutService {
  return { leaves, findPane, findPaneForTab, findSplit, allocateId, replacePaneWithSplit, prune, filter, serialize, restore, normalize };
}

export function installWorkspaceLayoutService() {
  if (!workspaceServices.termaWorkspaceLayout) workspaceServices.termaWorkspaceLayout = createWorkspaceLayoutService();
}



export interface InstalledFeaturesWorkspaceWorkspaceLayoutServiceServices {
  termaWorkspaceLayout?: WorkspaceLayoutService;
}
