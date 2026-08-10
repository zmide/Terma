const WORKSPACE_LAYOUT_VERSION = 1;
const WORKSPACE_MIN_SPLIT_RATIO = 0.15;
const WORKSPACE_MAX_SPLIT_RATIO = 0.85;
const WORKSPACE_MAX_RESTORE_DEPTH = 64;
const WORKSPACE_MAX_RESTORE_NODES = 256;
const WORKSPACE_HEADER_HEIGHT_DEFAULT = 42;
const WORKSPACE_HEADER_HEIGHT_MIN = 34;
const WORKSPACE_HEADER_HEIGHT_MAX = 64;
const WORKSPACE_TAB_HEIGHT_DEFAULT = 32;
const WORKSPACE_TAB_HEIGHT_MIN = 26;
const WORKSPACE_TAB_HEIGHT_MAX = 48;
const WORKSPACE_GROUP_STORAGE_VERSION = 1;
const WORKSPACE_GROUP_MAIN_ID = "workspace-main";
const legacyWorkspaceApi = {
  renderTabs,
  updateWorkspaceTabScrollControls,
  scrollWorkspaceTabs,
  handleWorkspaceTabsWheel,
  revealWorkspaceTab,
  addTab,
  setWorkspaceTabConnectionStatus,
  renderTabContent,
  activateTab,
  setWorkspace,
  closeTab,
  closeTabsByKey,
  closeTabsByMode,
  moveWorkspaceTab,
  showTabContextMenu,
  beginWorkspaceTabDrag,
  moveWorkspaceTabDrag,
  finishWorkspaceTabDrag,
  persistableTabs,
  saveTabsState,
  restoreTabsState,
  syncResponsivePane
};
let workspacePaneSerial = 1;
let workspaceSplitSerial = 0;
let workspaceTabCopySerial = 0;
let workspaceExecutionPaneId = "";
let focusedPaneId = "pane-1";
let workspaceLayout = {type:"pane", id:"pane-1", tabs:[], activeTabKey:""};
let workspaceTabDropTarget = null;
let workspaceSplitterDrag = null;
let workspaceChromeResize = null;
let workspaceChromeFitFrame = 0;
let workspaceChromeFitTimer = 0;
let workspaceChromeLastFitAt = 0;
let workspaceHeaderHeight = WORKSPACE_HEADER_HEIGHT_DEFAULT;
let workspaceTabHeight = WORKSPACE_TAB_HEIGHT_DEFAULT;
const workspacePaneNodes = new Map();
let workspaceGroupSerial = 0;
let activeWorkspaceGroupId = WORKSPACE_GROUP_MAIN_ID;
let workspaceGroups = [{
  id:WORKSPACE_GROUP_MAIN_ID,
  name:"主工作区",
  tabs:[],
  layout:null,
  activeTabKey:"",
  focusedPaneId:"pane-1"
}];
const workspaceSelectedTabKeys = new Set();
let workspaceGroupSwitching = false;
let workspaceGroupSelectionMode = false;
let workspaceGroupDragId = "";
const workspacePaneTabHistory = new Map();

function workspaceCssEscape(value) {
  if (typeof cssEscape === "function") return cssEscape(value);
  if (globalThis.CSS?.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function workspaceDockElement() {
  return document.getElementById("workspaceDock");
}

function currentWorkspaceGroup() {
  return workspaceGroups.find(group => group.id === activeWorkspaceGroupId)
    || workspaceGroups[0]
    || null;
}

function workspaceAllTabs() {
  const result = [...tabs];
  for (const group of workspaceGroups) {
    if (group.id === activeWorkspaceGroupId) continue;
    result.push(...(group.tabs || []));
  }
  return result;
}

function workspaceTabsByKey(key) {
  const normalized = String(key || "");
  return workspaceAllTabs().filter(tab => tab?.key === normalized);
}

function workspaceTabByKey(key) {
  return workspaceTabsByKey(key)[0] || null;
}

function workspaceHasTabKey(key) {
  return Boolean(workspaceTabByKey(key));
}

function workspacePaneHistoryKey(paneId, groupId=activeWorkspaceGroupId) {
  return `${groupId}\u0000${paneId}`;
}

function rememberWorkspacePaneTab(pane, key, previousKey=pane?.activeTabKey) {
  if (!pane || !key || !pane.tabs.includes(key)) return;
  const available = new Set(pane.tabs);
  const historyKey = workspacePaneHistoryKey(pane.id);
  const history = (workspacePaneTabHistory.get(historyKey) || [])
    .filter(tabKey => available.has(tabKey) && tabKey !== previousKey && tabKey !== key);
  if (previousKey && previousKey !== key && available.has(previousKey)) history.push(previousKey);
  history.push(key);
  workspacePaneTabHistory.set(historyKey, history);
}

function recentWorkspacePaneTab(pane, excludedKeys) {
  if (!pane) return "";
  const available = new Set(pane.tabs);
  const historyKey = workspacePaneHistoryKey(pane.id);
  const history = (workspacePaneTabHistory.get(historyKey) || []).filter(key => available.has(key));
  if (history.length) workspacePaneTabHistory.set(historyKey, history);
  else workspacePaneTabHistory.delete(historyKey);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const key = history[index];
    if (!excludedKeys.has(key)) return key;
  }
  return "";
}

function trimWorkspacePaneTabHistory(pane) {
  if (!pane) return;
  const historyKey = workspacePaneHistoryKey(pane.id);
  const available = new Set(pane.tabs);
  const history = (workspacePaneTabHistory.get(historyKey) || []).filter(key => available.has(key));
  if (history.length) workspacePaneTabHistory.set(historyKey, history);
  else workspacePaneTabHistory.delete(historyKey);
}

function workspaceGroupName() {
  return currentWorkspaceGroup()?.name || "主工作区";
}

function workspaceGroupPersistableTab(tab) {
  if (!tab?.kind || tab.transient || tab.kind === "quick-terminal") return null;
  const {key,title,subtitle,viewName,closable,kind,id,path,protocol,pinned} = tab;
  return {key,title,subtitle,viewName,closable,kind,id,path,protocol,pinned:Boolean(pinned)};
}

function workspaceFilterLayout(node, allowedKeys) {
  if (!node) return null;
  if (node.type === "pane") {
    const paneTabs = (node.tabs || []).filter(key => allowedKeys.has(key));
    if (!paneTabs.length) return null;
    return {
      type:"pane",
      id:node.id,
      tabs:paneTabs,
      activeTabKey:paneTabs.includes(node.activeTabKey) ? node.activeTabKey : paneTabs[0]
    };
  }
  const first = workspaceFilterLayout(node.first, allowedKeys);
  const second = workspaceFilterLayout(node.second, allowedKeys);
  if (!first) return second;
  if (!second) return first;
  return {
    type:"split",
    id:node.id,
    direction:node.direction === "column" ? "column" : "row",
    ratio:Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, Number(node.ratio) || 0.5)),
    first,
    second
  };
}

function captureCurrentWorkspaceGroup() {
  const group = currentWorkspaceGroup();
  if (!group || workspaceGroupSwitching) return group;
  group.tabs = tabs.filter(tab => tab?.kind);
  group.layout = serializeWorkspaceLayout();
  group.activeTabKey = activeTabKey;
  group.focusedPaneId = focusedPaneId;
  return group;
}

function workspaceGroupBarElement() {
  let bar = document.getElementById("workspaceGroupBar");
  const dock = workspaceDockElement();
  if (bar || !dock?.parentElement) return bar;
  bar = document.createElement("nav");
  bar.id = "workspaceGroupBar";
  bar.className = "workspace-group-bar";
  bar.setAttribute("aria-label", "工作区组");
  dock.parentElement.insertBefore(bar, dock);
  return bar;
}

function renderWorkspaceGroupBar() {
  const bar = workspaceGroupBarElement();
  if (!bar) return;
  captureCurrentWorkspaceGroup();
  for (const key of [...workspaceSelectedTabKeys]) {
    if (!tabs.some(tab => tab.key === key)) workspaceSelectedTabKeys.delete(key);
  }
  const show = workspaceGroups.length > 1 || workspaceGroupSelectionMode || workspaceSelectedTabKeys.size > 0;
  bar.hidden = !show;
  document.body.classList.toggle("workspace-groups-visible", show);
  if (!show) {
    bar.replaceChildren();
    return;
  }
  const selectedCount = workspaceSelectedTabKeys.size;
  const groupButtons = workspaceGroups.map(group => {
    const active = group.id === activeWorkspaceGroupId;
    const tabCount = group.tabs.filter(tab => tab?.kind).length;
    const hasActivity = group.tabs.some(tab => tab?.activityState);
    return `<button class="workspace-group-tab${active ? " active" : ""}${hasActivity ? " has-activity" : ""}" type="button" role="tab" aria-selected="${active}" draggable="true" data-workspace-group-id="${escAttr(group.id)}" title="${escAttr(group.name)}，${tabCount} 个标签${hasActivity ? "，有新的终端活动" : ""}" data-action="workspace-group-switch" data-contextmenu-action="workspace-group-menu" data-dragstart-action="workspace-group-drag-start" data-dragover-action="workspace-group-drag-over" data-drop-action="workspace-group-drop" data-dragend-action="workspace-group-drag-end">${icon("panels-top-left")}<span>${esc(group.name)}</span>${hasActivity ? `<i class="workspace-group-activity" aria-label="有新的终端活动"></i>` : ""}<small>${tabCount}</small></button>`;
  }).join("");
  const selectionActions = workspaceGroupSelectionMode
    ? `<span class="workspace-group-selection">选择要组合的标签 · 已选 ${selectedCount} 个</span><button class="primary" type="button" data-action="workspace-group-selection-confirm" ${selectedCount < 2 ? "disabled" : ""}>${icon("check")}<span>确认组合</span></button><button type="button" data-action="workspace-group-selection-cancel">${icon("x")}<span>取消</span></button>`
    : "";
  bar.innerHTML = `<div class="workspace-group-tabs" role="tablist">${groupButtons}</div><div class="workspace-group-actions">${selectionActions}</div>`;
}

function clearWorkspaceTabSelection(options={}) {
  if (!workspaceSelectedTabKeys.size && !workspaceGroupSelectionMode) return;
  workspaceSelectedTabKeys.clear();
  if (options.render !== false) renderTabs();
}

function beginWorkspaceGroupSelection(seedKey="") {
  hideTabContextMenu();
  if (!workspaceGroupSelectionMode) workspaceSelectedTabKeys.clear();
  workspaceGroupSelectionMode = true;
  if (seedKey && tabs.some(tab => tab.key === seedKey)) workspaceSelectedTabKeys.add(seedKey);
  renderTabs();
  if (seedKey) revealWorkspaceTab(seedKey);
}

function cancelWorkspaceGroupSelection() {
  workspaceGroupSelectionMode = false;
  workspaceSelectedTabKeys.clear();
  hideTabContextMenu();
  renderTabs();
}

async function confirmWorkspaceGroupSelection() {
  if (workspaceSelectedTabKeys.size < 2) return notify("请选择至少两个标签", "info");
  await createWorkspaceGroupFromSelection();
}

function toggleWorkspaceTabSelection(key) {
  if (!tabs.some(tab => tab.key === key)) return;
  workspaceGroupSelectionMode = true;
  if (workspaceSelectedTabKeys.has(key)) workspaceSelectedTabKeys.delete(key);
  else workspaceSelectedTabKeys.add(key);
  renderTabs();
  revealWorkspaceTab(key);
}

function nextWorkspaceGroupId() {
  let id = "";
  do {
    workspaceGroupSerial += 1;
    id = `workspace-group-${workspaceGroupSerial}`;
  } while (workspaceGroups.some(group => group.id === id));
  return id;
}

function defaultWorkspaceGroupName() {
  const used = new Set(workspaceGroups.map(group => String(group.name || "").toLowerCase()));
  let index = 1;
  let name = `工作区 ${index}`;
  while (used.has(name.toLowerCase())) {
    index += 1;
    name = `工作区 ${index}`;
  }
  return name;
}

async function createWorkspaceGroupFromSelection() {
  const selectedKeys = [...workspaceSelectedTabKeys].filter(key => tabs.some(tab => tab.key === key));
  if (selectedKeys.length < 2) return notify("请选择至少两个标签", "info");
  hideTabContextMenu();
  const name = await inputModal("组成工作区", "工作区名称", defaultWorkspaceGroupName());
  if (!name) return;
  const normalizedName = String(name).trim();
  if (workspaceGroups.some(group => group.name.toLowerCase() === normalizedName.toLowerCase())) {
    return notify("已经存在同名工作区", "info");
  }
  const source = captureCurrentWorkspaceGroup();
  if (!source) return;
  const sourceLayout = source.layout || serializeWorkspaceLayout();
  const selectedSet = new Set(selectedKeys);
  const selectedTabs = source.tabs.filter(tab => selectedSet.has(tab.key));
  const remainingTabs = source.tabs.filter(tab => !selectedSet.has(tab.key));
  const group = {
    id:nextWorkspaceGroupId(),
    name:normalizedName,
    tabs:selectedTabs,
    layout:workspaceFilterLayout(sourceLayout, selectedSet),
    activeTabKey:selectedSet.has(activeTabKey) ? activeTabKey : selectedTabs[0]?.key || "",
    focusedPaneId:workspaceFindPaneForTab(selectedSet.has(activeTabKey) ? activeTabKey : selectedTabs[0]?.key)?.id || "pane-1"
  };
  source.tabs = remainingTabs;
  source.layout = workspaceFilterLayout(sourceLayout, new Set(remainingTabs.map(tab => tab.key)));
  if (!remainingTabs.some(tab => tab.key === source.activeTabKey)) source.activeTabKey = remainingTabs[0]?.key || "";
  workspaceGroups.push(group);
  workspaceGroupSelectionMode = false;
  workspaceSelectedTabKeys.clear();
  switchWorkspaceGroup(group.id, {notify:false, skipCapture:true});
  notify(`已组成工作区“${normalizedName}”`, "success");
}

function applyWorkspaceGroupState(group) {
  workspaceGroupSwitching = true;
  window.restoringTabs = true;
  try {
    tabs = [...(group.tabs || [])];
    const validKeys = new Set(tabs.map(tab => tab.key));
    const usedKeys = new Set();
    workspaceLayout = restoreWorkspaceLayoutNode(group.layout, validKeys, usedKeys, new Set(), new Set())
      || {type:"pane", id:"pane-1", tabs:[], activeTabKey:""};
    const firstPane = workspaceLeaves()[0];
    for (const tab of tabs) {
      if (usedKeys.has(tab.key)) continue;
      firstPane.tabs.push(tab.key);
      usedKeys.add(tab.key);
    }
    if (!firstPane.activeTabKey || !firstPane.tabs.includes(firstPane.activeTabKey)) firstPane.activeTabKey = firstPane.tabs[0] || "";
    focusedPaneId = workspaceFindPane(group.focusedPaneId)?.id
      || workspaceFindPaneForTab(group.activeTabKey)?.id
      || firstPane.id;
    const focusedPane = workspaceFindPane(focusedPaneId);
    if (focusedPane?.tabs.includes(group.activeTabKey)) focusedPane.activeTabKey = group.activeTabKey;
    activeTabKey = focusedPane?.activeTabKey || tabs[0]?.key || "";
    activeView = tabs.find(tab => tab.key === activeTabKey)?.viewName || tabs.find(tab => tab.key === activeTabKey)?.kind || "welcome";
    renderTabs();
    const visiblePanes = workspaceVisiblePanes();
    for (const pane of visiblePanes.filter(pane => pane.id !== focusedPaneId)) renderWorkspacePaneContent(pane.id);
    if (activeTabKey) renderWorkspacePaneContent(focusedPaneId);
    else renderWelcome();
    syncFocusedWorkspaceClasses();
    syncWorkspaceToolbarPlacements();
  } finally {
    window.restoringTabs = false;
    workspaceGroupSwitching = false;
  }
}

function switchWorkspaceGroup(groupId, options={}) {
  const target = workspaceGroups.find(group => group.id === groupId);
  if (!target || target.id === activeWorkspaceGroupId) {
    clearWorkspaceTabSelection();
    return;
  }
  saveFocusedSftpPaneState();
  if (!options.skipCapture) captureCurrentWorkspaceGroup();
  activeWorkspaceGroupId = target.id;
  workspaceGroupSelectionMode = false;
  workspaceSelectedTabKeys.clear();
  applyWorkspaceGroupState(target);
  saveTabsState();
  revealWorkspaceTab(activeTabKey);
  if (options.notify !== false) notify(`已切换到“${target.name}”`, "success");
}

function beginWorkspaceGroupDrag(event, groupId, groupElement=event.currentTarget) {
  workspaceGroupDragId = groupId;
  event.stopPropagation();
  event.dataTransfer?.setData("text/x-terma-workspace-group", groupId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  groupElement?.classList.add("dragging");
}

function moveWorkspaceGroupDrag(event, groupId) {
  if (!workspaceGroupDragId || workspaceGroupDragId === groupId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropWorkspaceGroup(event, targetGroupId, groupElement=event.currentTarget) {
  if (!workspaceGroupDragId || workspaceGroupDragId === targetGroupId) return endWorkspaceGroupDrag();
  event.preventDefault();
  event.stopPropagation();
  const sourceIndex = workspaceGroups.findIndex(group => group.id === workspaceGroupDragId);
  const targetIndex = workspaceGroups.findIndex(group => group.id === targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0) return endWorkspaceGroupDrag();
  const [moving] = workspaceGroups.splice(sourceIndex, 1);
  const targetNode = groupElement?.closest?.(".workspace-group-tab") || groupElement;
  const rect = targetNode?.getBoundingClientRect?.();
  const insertAfter = rect ? event.clientX > rect.left + rect.width / 2 : false;
  let insertion = workspaceGroups.findIndex(group => group.id === targetGroupId);
  if (insertAfter) insertion += 1;
  workspaceGroups.splice(Math.max(0, insertion), 0, moving);
  endWorkspaceGroupDrag();
  renderWorkspaceGroupBar();
  saveTabsState();
}

function endWorkspaceGroupDrag() {
  workspaceGroupDragId = "";
  document.querySelectorAll?.(".workspace-group-tab.dragging").forEach(node => node.classList.remove("dragging"));
}

async function renameWorkspaceGroup(groupId) {
  hideTabContextMenu();
  const group = workspaceGroups.find(item => item.id === groupId);
  if (!group) return;
  const name = await inputModal("重命名工作区", "工作区名称", group.name);
  if (!name) return;
  const normalizedName = String(name).trim();
  if (workspaceGroups.some(item => item.id !== group.id && item.name.toLowerCase() === normalizedName.toLowerCase())) {
    return notify("已经存在同名工作区", "info");
  }
  group.name = normalizedName;
  renderWorkspaceGroupBar();
  saveTabsState();
}

async function dissolveWorkspaceGroup(groupId) {
  hideTabContextMenu();
  const group = workspaceGroups.find(item => item.id === groupId);
  if (!group || group.id === WORKSPACE_GROUP_MAIN_ID) return;
  if (!await confirmModal(`“${group.name}”中的标签会移回主工作区，会话不会关闭。`, "解散工作区", "解散", "取消", true)) return;
  if (group.id === activeWorkspaceGroupId) captureCurrentWorkspaceGroup();
  const main = workspaceGroups.find(item => item.id === WORKSPACE_GROUP_MAIN_ID) || workspaceGroups[0];
  const existing = new Set(main.tabs.map(tab => tab.key));
  const moving = group.tabs.filter(tab => !existing.has(tab.key));
  main.tabs.push(...moving);
  const mergedKeys = new Set(main.tabs.map(tab => tab.key));
  const mainLayout = workspaceFilterLayout(main.layout, mergedKeys);
  if (mainLayout?.type === "pane") {
    for (const tab of moving) if (!mainLayout.tabs.includes(tab.key)) mainLayout.tabs.push(tab.key);
    main.layout = mainLayout;
  } else {
    const first = (() => {
      let node = mainLayout;
      while (node && node.type !== "pane") node = node.first;
      return node;
    })();
    if (first) for (const tab of moving) if (!first.tabs.includes(tab.key)) first.tabs.push(tab.key);
    main.layout = mainLayout;
  }
  if (!main.layout) main.layout = {type:"pane", id:"pane-1", tabs:main.tabs.map(tab => tab.key), activeTabKey:main.tabs[0]?.key || ""};
  workspaceGroups = workspaceGroups.filter(item => item.id !== group.id);
  if (activeWorkspaceGroupId === group.id) {
    activeWorkspaceGroupId = main.id;
    applyWorkspaceGroupState(main);
  }
  renderWorkspaceGroupBar();
  saveTabsState();
  notify(`工作区“${group.name}”已解散`, "success");
}

function listWorkspaceGroups() {
  captureCurrentWorkspaceGroup();
  return workspaceGroups.map(group => ({id:group.id, name:group.name, tabCount:group.tabs.length, active:group.id === activeWorkspaceGroupId}));
}

function showWorkspaceGroupContextMenu(event, groupId) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const group = workspaceGroups.find(item => item.id === groupId);
  if (!group) return;
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  const options = [
    ["打开工作区", () => switchWorkspaceGroup(group.id), group.id !== activeWorkspaceGroupId, "panels-top-left"],
    ["重命名", () => renameWorkspaceGroup(group.id), true, "pencil"],
    ["保存为预设", () => { hideTabContextMenu(); if (group.id !== activeWorkspaceGroupId) switchWorkspaceGroup(group.id, {notify:false}); saveCurrentNamedWorkspace(); }, true, "save"],
    ["解散工作区", () => dissolveWorkspaceGroup(group.id), group.id !== WORKSPACE_GROUP_MAIN_ID, "ungroup"]
  ];
  for (const [label, action, enabled, iconName] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `${icon(iconName)}<span>${esc(label)}</span>`;
    button.disabled = !enabled;
    button.onclick = action;
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
}
