import {workspaceServices} from '@/features/workspace/installed-services';
import {sharedServices} from '@/shared/installed-services';
import type { WorkspaceLayoutNode } from './workspace-layout-service';
import type { WorkspaceStateGroup, WorkspaceStateTab, createWorkspaceStateService } from './workspace-state-service';
import type { WorkspaceMenuItem, WorkspaceViews } from './workspace-port';

type GroupSnapshot = {
  groups: WorkspaceStateGroup[];
  activeId: string;
  tabs: WorkspaceStateTab[];
  layout: WorkspaceLayoutNode;
  activeTabKey: string;
  focusedPaneId: string;
};

type SwitchOptions = { notify?: boolean; skipCapture?: boolean };
type GroupPort = {
  read(): GroupSnapshot;
  replaceGroups(groups: WorkspaceStateGroup[]): void;
  serial(): number;
  setSerial(serial: number): void;
  setActive(id: string): void;
  mainId: string;
  layout: {
    serialize(layout: WorkspaceLayoutNode): WorkspaceLayoutNode | null;
    filter(layout: WorkspaceLayoutNode | null, keys: ReadonlySet<string>): WorkspaceLayoutNode | null;
    paneForTab(key: string): string | undefined;
  };
  views: () => WorkspaceViews | undefined;
  dock: () => HTMLElement | null;
  mobile: () => boolean;
  suppressTabClick(): boolean;
  activateTab(key: string): void;
  renderMobile(): void;
  renderTabs(): void;
  apply(group: WorkspaceStateGroup): void;
  save(): void;
  savePreset(): void;
  saveFilePane(): void;
  hideMenu(): void;
  reveal(key: string): void;
  input(title: string, label: string, value: string): Promise<string | null | undefined>;
  confirm(message: () => string, title: string, ok: string, cancel: string): Promise<boolean>;
  tr(key: string, values?: Record<string, unknown>): string;
  notify(message: string, level: 'info' | 'success'): void;
  remember(message: string): string;
};

const groupTransferType = 'text/x-terma-workspace-group';

export function createWorkspaceGroupController(port: GroupPort, state: ReturnType<typeof createWorkspaceStateService>) {
  const {tr} = port;
  const selected = new Set<string>();
  let selectionMode = false;
  let selectionRevision = 0;
  let groupPrompt = false;
  let applying = false;
  let dragId = '';
  let dragElement: HTMLElement | null = null;

  function current(snapshot = port.read()) {
    return snapshot.groups.find(group => group.id === snapshot.activeId) || snapshot.groups[0] || null;
  }

  function capture(snapshot = port.read()) {
    const group = current(snapshot);
    if (group && !applying) {
      group.tabs = snapshot.tabs.filter(tab => tab?.kind);
      group.layout = port.layout.serialize(snapshot.layout);
      group.activeTabKey = snapshot.activeTabKey;
      group.focusedPaneId = snapshot.focusedPaneId;
    }
    return group;
  }

  function tabs() {
    const snapshot = port.read();
    return state.allTabs(snapshot.tabs, snapshot.groups, snapshot.activeId);
  }

  const tabsByKey = (key: string) => tabs().filter(tab => tab.key === key);
  const tabByKey = (key: string) => tabs().find(tab => tab.key === key) ?? null;

  function list() {
    const snapshot = port.read();
    capture(snapshot);
    return snapshot.groups.map(group => ({
      id: group.id, name: state.groupDisplayName(group), tabCount: group.tabs.length, active: group.id === snapshot.activeId
    }));
  }

  function serialize() {
    const snapshot = port.read();
    capture(snapshot);
    return state.serializeGroups(snapshot.groups);
  }

  function groupBar() {
    const label = tr('navigation:menus.workspace_groups', {defaultValue: '工作区组'});
    let bar = document.getElementById('workspaceGroupBar');
    if (!bar) {
      const dock = port.dock();
      if (!dock?.parentElement) return null;
      bar = document.createElement('nav');
      bar.id = 'workspaceGroupBar';
      bar.className = 'workspace-group-bar';
      dock.before(bar);
    }
    bar.setAttribute('aria-label', label);
    return bar;
  }

  function groupView(group: WorkspaceStateGroup, activeId: string) {
    const name = state.groupDisplayName(group);
    const count = group.tabs.filter(tab => tab?.kind).length;
    const activity = group.tabs.some(tab => tab?.activityState);
    const activityLabel = tr('navigation:menus.workspace_group_activity', {defaultValue: '有新的终端活动'});
    const suffix = activity ? tr('navigation:menus.workspace_group_activity_suffix', {defaultValue: '，有新的终端活动'}) : '';
    return {
      id: group.id, name, count, active: group.id === activeId, activity, activityLabel,
      label: tr('navigation:menus.workspace_group_tab_title', {name, count, activity: suffix, defaultValue: `${name}，${count} 个标签${suffix}`})
    };
  }

  function render() {
    port.renderMobile();
    const bar = groupBar();
    const views = port.views();
    if (!bar || !views) return;
    const snapshot = port.read();
    capture(snapshot);
    const validKeys = new Set(snapshot.tabs.map(tab => tab.key));
    for (const key of selected) if (!validKeys.has(key)) selected.delete(key);
    const canCombine = port.mobile() && snapshot.tabs.filter(tab => tab.kind !== 'welcome' && tab.viewName !== 'welcome').length >= 2;
    const show = snapshot.groups.length > 1 || selectionMode || selected.size > 0;
    bar.hidden = !show;
    document.body.classList.toggle('workspace-groups-visible', show);
    if (!show) {
      if (bar.childElementCount) views.unmount(bar);
      return;
    }
    const actions = selectionMode ? {
      text: tr('navigation:menus.workspace_group_selection', {count: selected.size, defaultValue: `选择要组合的标签 · 已选 ${selected.size} 个`}),
      confirm: tr('navigation:menus.workspace_group_confirm', {defaultValue: '确认组合'}),
      cancel: tr('common:actions.cancel', {defaultValue: '取消'}),
      enabled: selected.size >= 2
    } : null;
    const combine = canCombine ? tr('navigation:auto.combine_workspace', {defaultValue: 'Combine into workspace'}) : '';
    views.groups(bar, snapshot.groups.map(group => groupView(group, snapshot.activeId)), actions, combine);
  }

  function clearSelection(redraw = true) {
    if (!selected.size && !selectionMode) return;
    selected.clear();
    selectionRevision++;
    if (redraw) port.renderTabs();
  }

  function resetSelection() {
    clearSelection(false);
    selectionMode = false;
  }

  function activateFromClick(event: MouseEvent, key: string) {
    if (!key) return;
    if (port.suppressTabClick()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (selectionMode || ((event.ctrlKey || event.metaKey) && !port.mobile())) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(key);
      return;
    }
    clearSelection(false);
    port.activateTab(key);
  }

  function beginSelection(seed = '') {
    port.hideMenu();
    if (!selectionMode) selected.clear();
    selectionMode = true;
    selectionRevision++;
    if (seed && port.read().tabs.some(tab => tab.key === seed)) selected.add(seed);
    port.renderTabs();
    if (seed) port.reveal(seed);
  }

  function cancelSelection() {
    resetSelection();
    port.hideMenu();
    port.renderTabs();
  }

  function toggleSelection(key: string) {
    if (!port.read().tabs.some(tab => tab.key === key)) return;
    selectionMode = true;
    selectionRevision++;
    if (!selected.delete(key)) selected.add(key);
    port.renderTabs();
    port.reveal(key);
  }

  function apply(group: WorkspaceStateGroup, options: { resetSelection?: boolean } = {}) {
    if (options.resetSelection) resetSelection();
    applying = true;
    try {
      port.apply(group);
    } finally {
      applying = false;
    }
  }

  function revealGroup() {
    const active = document.querySelector<HTMLElement>('#workspaceGroupBar .workspace-group-tab[aria-selected="true"]');
    const list = active?.parentElement;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    const tabRect = active.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (tabRect.left < listRect.left) list.scrollLeft += tabRect.left - listRect.left;
    else if (tabRect.right > listRect.right) list.scrollLeft += tabRect.right - listRect.right;
  }

  function switchGroup(id: string, options: SwitchOptions = {}) {
    const snapshot = port.read();
    const target = snapshot.groups.find(group => group.id === id);
    if (!target || target.id === snapshot.activeId) {
      clearSelection();
      return;
    }
    port.saveFilePane();
    if (!options.skipCapture) capture(snapshot);
    port.setActive(target.id);
    resetSelection();
    apply(target);
    port.save();
    port.reveal(port.read().activeTabKey);
    revealGroup();
    if (options.notify !== false) {
      const name = state.groupDisplayName(target);
      port.notify(port.remember(tr('navigation:menus.workspace_group_switched', {name, defaultValue: `已切换到“${name}”`})), 'success');
    }
  }

  const minimum = () => port.notify(tr('navigation:menus.workspace_group_minimum', {defaultValue: '请选择至少两个标签'}), 'info');
  const duplicate = () => port.notify(tr('navigation:menus.workspace_group_duplicate', {defaultValue: '已经存在同名工作区'}), 'info');
  const groupNameLabel = () => tr('navigation:menus.workspace_group_name', {defaultValue: '工作区名称'});

  async function confirmSelection() {
    if (groupPrompt) return;
    const {activeId, groups, tabs} = port.read();
    const keys = new Set(tabs.map(tab => tab.key).filter((key): key is string => typeof key === 'string' && selected.has(key)));
    if (keys.size < 2) return minimum();
    port.hideMenu();
    const revision = selectionRevision;
    groupPrompt = true;
    let name: string;
    try {
      name = (await port.input(tr('navigation:auto.combine_workspace', {defaultValue: '组成工作区'}), groupNameLabel(), state.defaultGroupName(groups)))?.trim() || '';
    } finally {
      groupPrompt = false;
    }
    const latest = port.read();
    if (!name || latest.activeId !== activeId || !selectionMode || revision !== selectionRevision) return;
    if (state.hasGroupName(latest.groups, name)) return duplicate();
    const source = capture(latest);
    if (!source) return;
    const first = source.tabs.find(tab => typeof tab.key === 'string' && keys.has(tab.key));
    const focusKey = keys.has(source.activeTabKey) ? source.activeTabKey : String(first?.key || '');
    const allocation = state.nextGroupId(latest.groups, port.serial());
    const result = state.createGroupFromSelection(latest.groups, activeId, keys,
      {id: allocation.id, name, focusedPaneId: port.layout.paneForTab(focusKey) || 'pane-1'}, port.layout.filter);
    if (!result.created) return minimum();
    port.setSerial(allocation.serial);
    port.replaceGroups(result.groups);
    switchGroup(result.created.id, {notify: false, skipCapture: true});
    port.notify(port.remember(tr('navigation:menus.workspace_group_created', {name, defaultValue: `已组成工作区“${name}”`})), 'success');
  }

  function endDrag() {
    dragElement?.classList.remove('dragging');
    dragElement = null;
    dragId = '';
  }

  function beginDrag(event: DragEvent, id: string, element: HTMLElement) {
    endDrag();
    dragId = id;
    dragElement = element;
    event.stopPropagation();
    event.dataTransfer?.setData(groupTransferType, id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    element.classList.add('dragging');
  }

  function moveDrag(event: DragEvent, id: string) {
    if (!dragId || dragId === id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function drop(event: DragEvent, target: string, element: HTMLElement) {
    if (!dragId || dragId === target) return endDrag();
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const {groups} = port.read();
    const next = state.reorderGroups(groups, dragId, target, event.clientX > rect.left + rect.width / 2);
    endDrag();
    if (next === groups) return;
    port.replaceGroups(next);
    render();
    port.save();
  }

  async function rename(id: string) {
    port.hideMenu();
    const group = port.read().groups.find(item => item.id === id);
    if (!group) return;
    const name = await port.input(tr('navigation:menus.workspace_group_rename_title', {defaultValue: '重命名工作区'}), groupNameLabel(), state.groupDisplayName(group));
    if (!name) return;
    const result = state.renameGroup(port.read().groups, id, name);
    if (result.duplicate) return duplicate();
    if (!result.renamed) return;
    port.replaceGroups(result.groups);
    render();
    port.save();
  }

  async function dissolve(id: string) {
    port.hideMenu();
    const group = port.read().groups.find(item => item.id === id);
    if (!group || id === port.mainId) return;
    const name = state.groupDisplayName(group);
    const confirmed = await port.confirm(
      () => port.remember(tr('navigation:menus.workspace_group_dissolve_message', {name, defaultValue: `“${name}”中的标签会移回主工作区，会话不会关闭。`})),
      tr('navigation:menus.workspace_group_dissolve_title', {defaultValue: '解散工作区'}),
      tr('navigation:menus.workspace_group_dissolve', {defaultValue: '解散'}),
      tr('common:actions.cancel', {defaultValue: '取消'})
    );
    if (!confirmed) return;
    const snapshot = port.read();
    capture(snapshot);
    const result = state.dissolveGroup(snapshot.groups, id, port.mainId, port.layout.filter);
    if (!result.dissolved) return;
    port.replaceGroups(result.groups);
    if (snapshot.activeId === id) {
      switchGroup(result.activeGroupId, {notify: false, skipCapture: true});
    } else {
      if (snapshot.activeId === result.activeGroupId) {
        const main = result.groups.find(item => item.id === result.activeGroupId);
        if (main) {
          port.saveFilePane();
          apply(main);
        }
      }
      render();
      port.save();
    }
    port.notify(port.remember(tr('navigation:menus.workspace_group_dissolved', {name, defaultValue: `工作区“${name}”已解散`})), 'success');
  }

  function openMenu(event: MouseEvent, options: WorkspaceMenuItem[]) {
    event.preventDefault();
    event.stopPropagation();
    port.hideMenu();
    const menu = document.createElement('div');
    menu.id = 'tabContextMenu';
    menu.className = 'context-menu tab-context-menu';
    port.views()?.menu(menu, options);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
  }

  function groupMenu(event: MouseEvent, id: string) {
    const snapshot = port.read();
    if (!snapshot.groups.some(group => group.id === id)) return;
    openMenu(event, [
      {label: tr('navigation:menus.workspace_group_open', {defaultValue: '打开工作区'}), action: () => switchGroup(id), enabled: id !== snapshot.activeId, icon: 'panels-top-left'},
      {label: tr('navigation:menus.workspace_group_rename', {defaultValue: '重命名'}), action: () => rename(id), enabled: true, icon: 'pencil'},
      {label: tr('navigation:menus.workspace_group_save_preset', {defaultValue: '保存为预设'}), action: () => {
        port.hideMenu();
        if (id !== port.read().activeId) switchGroup(id, {notify: false});
        port.savePreset();
      }, enabled: true, icon: 'save'},
      {label: tr('navigation:menus.workspace_group_dissolve_title', {defaultValue: '解散工作区'}), action: () => dissolve(id), enabled: id !== port.mainId, icon: 'ungroup'}
    ]);
  }

  function tabsMenu(event: MouseEvent) {
    openMenu(event, [{
      label: tr('navigation:auto.combine_workspace', {defaultValue: 'Combine into workspace'}),
      icon: 'combine', enabled: port.read().tabs.length >= 2, action: () => beginSelection()
    }]);
  }

  return {
    current, firstPopulated: () => port.read().groups.find(group => group.tabs.length),
    capture, tabs, tabsByKey, tabByKey, activateFromClick, list, serialize, render, clearSelection, beginSelection, cancelSelection, toggleSelection,
    selectionMode: () => selectionMode, isSelected: (key: string) => selected.has(key), confirmSelection, apply, switchGroup,
    beginDrag, moveDrag, endDrag, drop, groupMenu, tabsMenu
  };
}

export function installWorkspaceGroupController(port: GroupPort) {
  const state = workspaceServices.termaWorkspaceState;
  if (state && !workspaceServices.termaWorkspaceGroups) {
    const groups = createWorkspaceGroupController(port, state);
    workspaceServices.termaWorkspaceGroups = groups;
    const events = sharedServices.termaEventRegistry;
    if (!events) return;
    events.register('workspace-tab-activate', ({event, dataset}) => groups.activateFromClick(event as MouseEvent, dataset.tabKey || ''));
    events.register('workspace-group-switch', ({dataset}) => groups.switchGroup(dataset.workspaceGroupId || ''));
    events.register('workspace-group-menu', ({event, dataset}) => groups.groupMenu(event as MouseEvent, dataset.workspaceGroupId || ''));
    events.register('workspace-group-drag-start', ({event, element, dataset}) => groups.beginDrag(event as DragEvent, dataset.workspaceGroupId || '', element as HTMLElement));
    events.register('workspace-group-drag-over', ({event, dataset}) => groups.moveDrag(event as DragEvent, dataset.workspaceGroupId || ''));
    events.register('workspace-group-drop', ({event, element, dataset}) => groups.drop(event as DragEvent, dataset.workspaceGroupId || '', element as HTMLElement));
    events.register('workspace-group-drag-end', groups.endDrag);
    events.register('workspace-group-selection-begin', () => groups.beginSelection());
    events.register('workspace-group-selection-confirm', groups.confirmSelection);
    events.register('workspace-group-selection-cancel', groups.cancelSelection);
  }
}



export interface InstalledFeaturesWorkspaceWorkspaceGroupControllerServices {
  termaWorkspaceGroups?: ReturnType<typeof createWorkspaceGroupController>;
}
