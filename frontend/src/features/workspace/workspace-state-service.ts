import {workspaceServices} from '@/features/workspace/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import type { WorkspaceLayoutNode, WorkspacePaneNode } from './workspace-layout-service';

export type WorkspaceStateTab = {
  key?: unknown;
  kind?: unknown;
  [key: string]: unknown;
};

export type WorkspaceStateGroup = {
  id: string;
  name: string;
  tabs: WorkspaceStateTab[];
  layout: WorkspaceLayoutNode | null;
  activeTabKey: string;
  focusedPaneId: string;
};

export type WorkspaceStateGroupMutation = {
  id: string;
  name: string;
  tabs: WorkspaceStateTab[];
  layout: WorkspaceLayoutNode | null;
  activeTabKey: string;
  focusedPaneId: string;
};

type WorkspaceStatePort = {
  mainId: string;
  legacyNames: ReadonlySet<string>;
  nextGroupId: () => string;
  defaultName: () => string;
};

/** Recent tabs are scoped to both group and pane and never enter saved layouts. */
export function createPaneTabHistory(activeGroup: () => string) {
  const histories = new Map<string, string[]>();
  const historyKey = (pane: WorkspacePaneNode) => `${activeGroup()}\u0000${pane.id}`;

  function trim(pane: WorkspacePaneNode | null) {
    if (!pane) return [];
    const key = historyKey(pane);
    const available = new Set(pane.tabs);
    const history = (histories.get(key) || []).filter(tabKey => available.has(tabKey));
    if (history.length) histories.set(key, history);
    else histories.delete(key);
    return history;
  }

  function remember(pane: WorkspacePaneNode | null, key: string, previousKey = pane?.activeTabKey) {
    if (!pane || !key || !pane.tabs.includes(key)) return;
    const history = trim(pane).filter(tabKey => tabKey !== previousKey && tabKey !== key);
    if (previousKey && previousKey !== key && pane.tabs.includes(previousKey)) history.push(previousKey);
    history.push(key);
    histories.set(historyKey(pane), history);
  }

  function recent(pane: WorkspacePaneNode | null, excludedKeys: ReadonlySet<string>) {
    const history = trim(pane);
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (!excludedKeys.has(history[index])) return history[index];
    }
    return '';
  }

  return { remember, recent, trim, clear: () => histories.clear() };
}

function persistableTab(tab: WorkspaceStateTab) {
  if (!tab?.kind || tab.transient || tab.kind === 'quick-terminal') return null;
  const fields = ['key', 'title', 'subtitle', 'viewName', 'closable', 'kind', 'id', 'path', 'fileSource', 'protocol', 'pinned', 'sessionMode', 'sessionBackend', 'persistentSessionId', 'resumePolicy', 'lastKnownCwd'];
  const persisted: Record<string, unknown> = {};
  for (const field of fields) persisted[field] = tab[field];
  persisted.pinned = Boolean(tab.pinned);
  return persisted;
}

function restoreTab(tab: WorkspaceStateTab) {
  const restored = { ...tab };
  const usesConnectionStatus = ['terminal', 'quick-terminal', 'sftp', 'remote-terminal'].includes(String(restored.kind))
    || (restored.kind === 'remote-desktop' && restored.protocol === 'vnc');
  if (usesConnectionStatus) restored.connectionStatus = 'disconnected';
  else delete restored.connectionStatus;
  return restored;
}

function normalizeName(port: WorkspaceStatePort, id: string, name: unknown) {
  const raw = String(name || '').trim();
  if (id === port.mainId && (!raw || port.legacyNames.has(raw))) return '';
  return raw;
}

function restoreGroups(saved: unknown, port: WorkspaceStatePort) {
  const source = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const storedGroups = Array.isArray(source.workspaceGroups) ? source.workspaceGroups : [];
  const usedGroupIds = new Set<string>();
  const groups: WorkspaceStateGroup[] = [];
  let serial = 0;
  for (const entry of storedGroups) {
    if (!entry || typeof entry !== 'object') continue;
    const stored = entry as Record<string, unknown>;
    let id = typeof stored.id === 'string' && stored.id ? stored.id : port.nextGroupId();
    while (usedGroupIds.has(id)) id = port.nextGroupId();
    usedGroupIds.add(id);
    serial = Math.max(serial, Number(id.match(/(\d+)$/)?.[1] || 0));
    const tabs: WorkspaceStateTab[] = [];
    const tabKeys = new Set<string>();
    for (const item of Array.isArray(stored.tabs) ? stored.tabs : []) {
      if (!item || typeof item !== 'object') continue;
      const tab = item as WorkspaceStateTab;
      const key = typeof tab.key === 'string' ? tab.key : '';
      if (!key || !tab.kind || tabKeys.has(key)) continue;
      tabs.push(restoreTab(tab));
      tabKeys.add(key);
    }
    const activeTabKey = tabs.some(tab => tab.key === stored.activeTabKey) ? String(stored.activeTabKey) : String(tabs[0]?.key || '');
    groups.push({
      id,
      name: normalizeName(port, id, stored.name) || (id === port.mainId ? '' : port.defaultName()),
      tabs,
      layout: (stored.layout && typeof stored.layout === 'object' ? stored.layout : null) as WorkspaceLayoutNode | null,
      activeTabKey,
      focusedPaneId: typeof stored.focusedPaneId === 'string' ? stored.focusedPaneId : 'pane-1'
    });
  }
  if (!groups.length) {
    const legacyTabs: WorkspaceStateTab[] = [];
    const legacyKeys = new Set<string>();
    for (const item of Array.isArray(source.tabs) ? source.tabs : []) {
      if (!item || typeof item !== 'object') continue;
      const tab = item as WorkspaceStateTab;
      const key = typeof tab.key === 'string' ? tab.key : '';
      if (!key || !tab.kind || legacyKeys.has(key)) continue;
      legacyTabs.push(restoreTab(tab));
      legacyKeys.add(key);
    }
    groups.push({
      id: port.mainId,
      name: '',
      tabs: legacyTabs,
      layout: (source.layout && typeof source.layout === 'object' ? source.layout : null) as WorkspaceLayoutNode | null,
      activeTabKey: legacyTabs.some(tab => tab.key === source.activeTabKey) ? String(source.activeTabKey) : String(legacyTabs[0]?.key || ''),
      focusedPaneId: typeof source.focusedPaneId === 'string' ? source.focusedPaneId : 'pane-1'
    });
  }
  if (!groups.some(group => group.id === port.mainId)) groups.unshift({id:port.mainId,name:'',tabs:[],layout:null,activeTabKey:'',focusedPaneId:'pane-1'});
  const requested = typeof source.activeWorkspaceGroupId === 'string' ? source.activeWorkspaceGroupId : '';
  const activeGroupId = groups.some(group => group.id === requested)
    ? requested
    : groups.find(group => group.tabs.length)?.id || port.mainId;
  return { groups, activeGroupId, serial };
}

function cloneLayout(node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null {
  if (!node) return null;
  if (node.type === 'pane') return {type: 'pane', id: node.id, tabs: [...node.tabs], activeTabKey: node.activeTabKey};
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    first: cloneLayout(node.first) as WorkspaceLayoutNode,
    second: cloneLayout(node.second) as WorkspaceLayoutNode
  };
}

function appendLayoutTabs(node: WorkspaceLayoutNode | null, tabKeys: ReadonlySet<string>) {
  if (!node) {
    const tabs = [...tabKeys];
    return tabs.length ? {type: 'pane', id: 'pane-1', tabs, activeTabKey: tabs[0]} as WorkspaceLayoutNode : null;
  }
  const next = cloneLayout(node) as WorkspaceLayoutNode;
  const leaves: Array<Extract<WorkspaceLayoutNode, {type: 'pane'}>> = [];
  const visit = (current: WorkspaceLayoutNode) => {
    if (current.type === 'pane') leaves.push(current);
    else {
      visit(current.first);
      visit(current.second);
    }
  };
  visit(next);
  const first = leaves[0];
  if (first) {
    const placed = new Set(leaves.flatMap(pane => pane.tabs));
    for (const key of tabKeys) if (!placed.has(key)) first.tabs.push(key);
    if (!first.activeTabKey) first.activeTabKey = first.tabs[0] || '';
  }
  return next;
}

export function createWorkspaceStateService(port: WorkspaceStatePort) {
  function namedWorkspaceSavedTabs(layout: Record<string, unknown> = {}) {
    const groups = Array.isArray(layout.workspace_groups) ? layout.workspace_groups : [];
    if (groups.length) return groups.flatMap(group => group && typeof group === 'object' && Array.isArray((group as Record<string, unknown>).tabs) ? (group as Record<string, unknown>).tabs as WorkspaceStateTab[] : []);
    return Array.isArray(layout.tabs) ? layout.tabs as WorkspaceStateTab[] : [];
  }

  function eachNamedWorkspaceTab(layout: Record<string, unknown>, callback: (tab: WorkspaceStateTab, group: Record<string, unknown> | null) => void) {
    const groups = Array.isArray(layout.workspace_groups) ? layout.workspace_groups : [];
    if (groups.length) {
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue;
        const record = group as Record<string, unknown>;
        for (const tab of Array.isArray(record.tabs) ? record.tabs : []) {
          if (tab && typeof tab === 'object') callback(tab as WorkspaceStateTab, record);
        }
      }
    }
    for (const tab of Array.isArray(layout.tabs) ? layout.tabs : []) {
      if (tab && typeof tab === 'object') callback(tab as WorkspaceStateTab, null);
    }
  }

  function serializeGroups(groups: WorkspaceStateGroup[]) {
    return groups.map(group => ({
      id: group.id,
      name: group.name,
      tabs: group.tabs.map(persistableTab).filter((tab): tab is Record<string, unknown> => Boolean(tab)),
      layout: group.layout ? JSON.parse(JSON.stringify(group.layout)) : null,
      activeTabKey: group.activeTabKey || '',
      focusedPaneId: group.focusedPaneId || 'pane-1'
    }));
  }

  function groupDisplayName(group: { id?: string; name?: unknown } | null) {
    const raw = normalizeName(port, group?.id || '', group?.name);
    if (group?.id === port.mainId && !raw) return tr?.('common:auto.main_workspace', {defaultValue: '主工作区'}) || '主工作区';
    return raw || tr?.('common:auto.workspace', {defaultValue: '工作区'}) || '工作区';
  }

  function nextGroupId(groups: readonly WorkspaceStateGroup[], serial: number) {
    const existingIds = new Set(groups.map(group => group.id));
    let nextSerial = Number.isFinite(serial) ? Math.max(0, Math.floor(serial)) : 0;
    let id = `workspace-group-${nextSerial + 1}`;
    while (existingIds.has(id)) {
      nextSerial += 1;
      id = `workspace-group-${nextSerial + 1}`;
    }
    return {id, serial: nextSerial + 1};
  }

  function hasGroupName(groups: readonly WorkspaceStateGroup[], name: string, exceptId?: string) {
    const key = name.toLowerCase();
    return groups.some(group => group.id !== exceptId && groupDisplayName(group).toLowerCase() === key);
  }

  function defaultGroupName(groups: readonly WorkspaceStateGroup[]) {
    const existingNames = new Set(groups.map(group => groupDisplayName(group).toLowerCase()));
    for (let index = 1; ; index += 1) {
      const fallback = `工作区 ${index}`;
      const name = tr?.('navigation:menus.workspace_group_default_name', {index, defaultValue: fallback}) || fallback;
      if (!existingNames.has(name.toLowerCase())) return name;
    }
  }

  function allTabs(activeTabs: WorkspaceStateTab[], groups: WorkspaceStateGroup[], activeId: string) {
    const result = [...activeTabs];
    for (const group of groups) if (group.id !== activeId) result.push(...(group.tabs || []));
    return result;
  }

  function addTab<T extends {key?: unknown}>(tabs: T[], activeKey: string, record: T) {
    const nextTabs = record.key === 'welcome' ? tabs.filter(tab => tab.key === 'welcome') : tabs.filter(tab => tab.key !== 'welcome');
    if (record.key === 'welcome' && tabs.some(tab => tab.key !== 'welcome')) return {tabs, activeKey, added: false};
    const key = String(record.key || '');
    const found = nextTabs.find(tab => tab.key === key);
    if (found) Object.assign(found, record);
    else {
      const insertion = nextTabs.findIndex(tab => tab.key === activeKey);
      nextTabs.splice(insertion >= 0 ? insertion + 1 : nextTabs.length, 0, record);
    }
    return {tabs: nextTabs, activeKey: key, added: true};
  }

  function moveTab<T extends WorkspaceStateTab | string>(tabs: T[], key: string, offset: number) {
    const index = tabs.findIndex(tab => (typeof tab === 'string' ? tab : tab.key) === key);
    const target = Math.max(0, Math.min(tabs.length - 1, index + offset));
    if (index < 0 || target === index) return tabs;
    const nextTabs = [...tabs];
    const [tab] = nextTabs.splice(index, 1);
    nextTabs.splice(target, 0, tab);
    return nextTabs;
  }

  function removeTabRecords<T extends {key?: unknown}>(tabs: T[], keys: ReadonlySet<string>) {
    return tabs.filter(tab => !keys.has(String(tab.key || '')));
  }

  function removeTabs(tabs: WorkspaceStateTab[], activeKey: string, keys: ReadonlySet<string>, anchorKey: string, recentKey: string) {
    const nextTabs = removeTabRecords(tabs, keys);
    if (!keys.has(activeKey)) return {tabs: nextTabs, activeKey, fallbackKey: ''};
    const anchorIndex = Math.max(0, tabs.findIndex(tab => tab.key === anchorKey));
    const previousKeys = tabs.map(tab => String(tab.key || ''));
    const fallbackKey = [recentKey, previousKeys[anchorIndex], ...previousKeys.slice(0, anchorIndex).reverse(), ...previousKeys.slice(anchorIndex + 1)]
      .find(key => !keys.has(key) && nextTabs.some(tab => tab.key === key)) || '';
    return {tabs: nextTabs, activeKey: fallbackKey, fallbackKey};
  }

  function removeDockedTabs<T extends {key?: unknown}>(
    tabs: T[],
    panes: WorkspacePaneNode[],
    keys: ReadonlySet<string>,
    recentTab: (pane: WorkspacePaneNode) => string
  ) {
    const nextPanes = panes.map(pane => {
      const tabKeys = pane.tabs.filter(key => !keys.has(key));
      let activeTabKey = pane.activeTabKey;
      const recentKey = keys.has(activeTabKey) ? recentTab(pane) : '';
      if (!tabKeys.includes(activeTabKey)) {
        const previousIndex = Math.max(0, pane.tabs.findIndex(key => keys.has(key)));
        activeTabKey = recentKey || tabKeys[Math.min(previousIndex, tabKeys.length - 1)] || tabKeys.at(-1) || '';
      }
      return {tabs: tabKeys, activeTabKey};
    });
    return {tabs: removeTabRecords(tabs, keys), panes: nextPanes};
  }

  function createGroupFromSelection(
    groups: WorkspaceStateGroup[],
    activeId: string,
    selectedKeys: ReadonlySet<string>,
    group: Pick<WorkspaceStateGroup, 'id' | 'name' | 'focusedPaneId'>,
    filterLayout: (layout: WorkspaceLayoutNode | null, keys: ReadonlySet<string>) => WorkspaceLayoutNode | null
  ) {
    const source = groups.find(item => item.id === activeId);
    if (!source) return {groups, created: null as WorkspaceStateGroup | null};
    const selectedTabs = source.tabs.filter(tab => selectedKeys.has(String(tab.key || '')));
    const remainingTabs = source.tabs.filter(tab => !selectedKeys.has(String(tab.key || '')));
    if (selectedTabs.length < 2) return {groups, created: null as WorkspaceStateGroup | null};
    const created: WorkspaceStateGroup = {
      id: group.id,
      name: group.name,
      tabs: selectedTabs,
      layout: filterLayout(source.layout, selectedKeys),
      activeTabKey: selectedKeys.has(source.activeTabKey) ? source.activeTabKey : String(selectedTabs[0]?.key || ''),
      focusedPaneId: group.focusedPaneId || 'pane-1'
    };
    const nextSource: WorkspaceStateGroup = {
      ...source,
      tabs: remainingTabs,
      layout: filterLayout(source.layout, new Set(remainingTabs.map(tab => String(tab.key || '')))),
      activeTabKey: remainingTabs.some(tab => tab.key === source.activeTabKey) ? source.activeTabKey : String(remainingTabs[0]?.key || '')
    };
    return {groups: groups.map(item => item.id === activeId ? nextSource : item).concat(created), created};
  }

  function reorderGroups(groups: WorkspaceStateGroup[], sourceId: string, targetId: string, insertAfter = false) {
    if (!sourceId || !targetId || sourceId === targetId) return groups;
    const sourceIndex = groups.findIndex(group => group.id === sourceId);
    const targetIndex = groups.findIndex(group => group.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return groups;
    const next = [...groups];
    const [moving] = next.splice(sourceIndex, 1);
    let insertion = next.findIndex(group => group.id === targetId);
    if (insertAfter) insertion += 1;
    next.splice(Math.max(0, insertion), 0, moving);
    return next;
  }

  function renameGroup(groups: WorkspaceStateGroup[], groupId: string, name: string) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return {groups, renamed: false, duplicate: false};
    const group = groups.find(item => item.id === groupId);
    if (!group) return {groups, renamed: false, duplicate: false};
    if (hasGroupName(groups, normalizedName, groupId)) return {groups, renamed: false, duplicate: true};
    return {groups: groups.map(item => item.id === groupId ? {...item, name: normalizedName} : item), renamed: true, duplicate: false};
  }

  function dissolveGroup(groups: WorkspaceStateGroup[], groupId: string, mainId: string, filterLayout: (layout: WorkspaceLayoutNode | null, keys: ReadonlySet<string>) => WorkspaceLayoutNode | null) {
    const group = groups.find(item => item.id === groupId);
    if (!group || group.id === mainId) return {groups, dissolved: null as WorkspaceStateGroup | null, activeGroupId: ''};
    const main = groups.find(item => item.id === mainId) || groups.find(item => item.id !== groupId);
    if (!main) return {groups, dissolved: null as WorkspaceStateGroup | null, activeGroupId: ''};
    const existing = new Set(main.tabs.map(tab => String(tab.key || '')));
    const moving = group.tabs.filter(tab => !existing.has(String(tab.key || '')));
    const mergedTabs = [...main.tabs, ...moving];
    const mergedKeys = new Set(mergedTabs.map(tab => String(tab.key || '')));
    let mergedLayout = filterLayout(main.layout, mergedKeys);
    mergedLayout = appendLayoutTabs(mergedLayout, mergedKeys);
    if (!mergedLayout) mergedLayout = {type: 'pane', id: 'pane-1', tabs: mergedTabs.map(tab => String(tab.key || '')), activeTabKey: String(mergedTabs[0]?.key || '')};
    const nextMain = {...main, tabs: mergedTabs, layout: mergedLayout};
    const nextGroups = groups.filter(item => item.id !== groupId).map(item => item.id === nextMain.id ? nextMain : item);
    return {groups: nextGroups, dissolved: group, activeGroupId: main.id};
  }

  function activateTab(tab: {viewName?: unknown; kind?: unknown}, pane: WorkspacePaneNode, key: string) {
    pane.activeTabKey = key;
    return {
      activeTabKey: key,
      activeView: String(tab.viewName || tab.kind || 'welcome'),
      focusedPaneId: pane.id
    };
  }

  function applyGroupState(group: WorkspaceStateGroup, restoredLayout: WorkspaceLayoutNode | null) {
    const tabs = [...(group.tabs || [])];
    const layout = restoredLayout || {type: 'pane', id: 'pane-1', tabs: [], activeTabKey: ''} as WorkspaceLayoutNode;
    const leaves: Array<Extract<WorkspaceLayoutNode, {type: 'pane'}>> = [];
    const visit = (node: WorkspaceLayoutNode) => {
      if (node.type === 'pane') leaves.push(node);
      else {
        visit(node.first);
        visit(node.second);
      }
    };
    visit(layout);
    const firstPane = leaves[0] || (layout.type === 'pane' ? layout : null);
    const usedKeys = new Set(leaves.flatMap(pane => pane.tabs));
    if (firstPane) {
      for (const tab of tabs) {
        const key = String(tab.key || '');
        if (key && !usedKeys.has(key)) {
          firstPane.tabs.push(key);
          usedKeys.add(key);
        }
      }
      if (!firstPane.activeTabKey || !firstPane.tabs.includes(firstPane.activeTabKey)) firstPane.activeTabKey = firstPane.tabs[0] || '';
    }
    const findPane = (node: WorkspaceLayoutNode | null, paneId: string): Extract<WorkspaceLayoutNode, {type: 'pane'}> | null => {
      if (!node) return null;
      if (node.type === 'pane') return node.id === paneId ? node : null;
      return findPane(node.first, paneId) || findPane(node.second, paneId);
    };
    const findPaneForTab = (node: WorkspaceLayoutNode | null, key: string): Extract<WorkspaceLayoutNode, {type: 'pane'}> | null => {
      if (!node) return null;
      if (node.type === 'pane') return node.tabs.includes(key) ? node : null;
      return findPaneForTab(node.first, key) || findPaneForTab(node.second, key);
    };
    const focusedPane = findPane(layout, group.focusedPaneId)
      || findPaneForTab(layout, group.activeTabKey)
      || firstPane;
    if (focusedPane?.tabs.includes(group.activeTabKey)) focusedPane.activeTabKey = group.activeTabKey;
    const activeTabKey = focusedPane?.activeTabKey || String(tabs[0]?.key || '');
    const activeTab = tabs.find(tab => tab.key === activeTabKey);
    return {
      tabs,
      layout,
      focusedPaneId: focusedPane?.id || 'pane-1',
      activeTabKey,
      activeView: String(activeTab?.viewName || activeTab?.kind || 'welcome')
    };
  }

  function prepareNamedWorkspaceLayout(layout: Record<string, unknown>, hasTab: (tab: WorkspaceStateTab) => boolean) {
    const source = JSON.parse(JSON.stringify(layout || {})) as Record<string, unknown>;
    const filterTabs = (items: unknown) => Array.isArray(items)
      ? items.filter(item => item && typeof item === 'object' && hasTab(item as WorkspaceStateTab)).map(item => ({...(item as WorkspaceStateTab)}))
      : [];
    const groups = Array.isArray(source.workspace_groups)
      ? source.workspace_groups.filter(group => group && typeof group === 'object').map(group => ({
        ...(group as Record<string, unknown>),
        tabs: filterTabs((group as Record<string, unknown>).tabs)
      }))
      : [];
    const tabs = filterTabs(source.tabs);
    return {
      ...source,
      tabs,
      workspace_groups: groups,
      active_workspace_group_id: typeof source.active_workspace_group_id === 'string' ? source.active_workspace_group_id : 'workspace-main'
    };
  }

  return {
    createPaneHistory: createPaneTabHistory,
    persistableTab,
    restoreTab,
    restoreGroups: (saved: unknown) => restoreGroups(saved, port),
    namedWorkspaceSavedTabs,
    eachNamedWorkspaceTab,
    serializeGroups,
    groupDisplayName,
    hasGroupName,
    nextGroupId,
    defaultGroupName,
    allTabs,
    addTab,
    moveTab,
    removeTabs,
    removeDockedTabs,
    createGroupFromSelection,
    reorderGroups,
    renameGroup,
    dissolveGroup,
    activateTab,
    applyGroupState,
    prepareNamedWorkspaceLayout
  };
}

export function installWorkspaceStateService() {
  if (workspaceServices.termaWorkspaceState) return;
  workspaceServices.termaWorkspaceState = createWorkspaceStateService({
    mainId: 'workspace-main',
    legacyNames: new Set(['主工作区', 'Main workspace']),
    nextGroupId: () => `workspace-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    defaultName: () => tr?.('navigation:menus.workspace_group_default_name', {index: 1, defaultValue: '工作区 1'}) || '工作区 1'
  });
}



export interface InstalledFeaturesWorkspaceWorkspaceStateServiceServices {
  termaWorkspaceState?: ReturnType<typeof createWorkspaceStateService>;
}
