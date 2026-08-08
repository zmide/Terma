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
  if (!tab?.kind) return null;
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
    return `<button class="workspace-group-tab${active ? " active" : ""}${hasActivity ? " has-activity" : ""}" type="button" role="tab" aria-selected="${active}" draggable="true" data-workspace-group-id="${escAttr(group.id)}" title="${escAttr(group.name)}，${tabCount} 个标签${hasActivity ? "，有新的终端活动" : ""}" onclick="switchWorkspaceGroup('${escAttr(group.id)}')" oncontextmenu="showWorkspaceGroupContextMenu(event,'${escAttr(group.id)}')" ondragstart="beginWorkspaceGroupDrag(event,'${escAttr(group.id)}')" ondragover="moveWorkspaceGroupDrag(event,'${escAttr(group.id)}')" ondrop="dropWorkspaceGroup(event,'${escAttr(group.id)}')" ondragend="endWorkspaceGroupDrag()">${icon("panels-top-left")}<span>${esc(group.name)}</span>${hasActivity ? `<i class="workspace-group-activity" aria-label="有新的终端活动"></i>` : ""}<small>${tabCount}</small></button>`;
  }).join("");
  const selectionActions = workspaceGroupSelectionMode
    ? `<span class="workspace-group-selection">选择要组合的标签 · 已选 ${selectedCount} 个</span><button class="primary" type="button" onclick="confirmWorkspaceGroupSelection()" ${selectedCount < 2 ? "disabled" : ""}>${icon("check")}<span>确认组合</span></button><button type="button" onclick="cancelWorkspaceGroupSelection()">${icon("x")}<span>取消</span></button>`
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

function beginWorkspaceGroupDrag(event, groupId) {
  workspaceGroupDragId = groupId;
  event.stopPropagation();
  event.dataTransfer?.setData("text/x-terma-workspace-group", groupId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  event.currentTarget?.classList.add("dragging");
}

function moveWorkspaceGroupDrag(event, groupId) {
  if (!workspaceGroupDragId || workspaceGroupDragId === groupId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropWorkspaceGroup(event, targetGroupId) {
  if (!workspaceGroupDragId || workspaceGroupDragId === targetGroupId) return endWorkspaceGroupDrag();
  event.preventDefault();
  event.stopPropagation();
  const sourceIndex = workspaceGroups.findIndex(group => group.id === workspaceGroupDragId);
  const targetIndex = workspaceGroups.findIndex(group => group.id === targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0) return endWorkspaceGroupDrag();
  const [moving] = workspaceGroups.splice(sourceIndex, 1);
  const targetNode = event.currentTarget?.closest?.(".workspace-group-tab") || event.currentTarget;
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

function workspaceLeaves(node=workspaceLayout, result=[]) {
  if (!node) return result;
  if (node.type === "pane") result.push(node);
  else {
    workspaceLeaves(node.first, result);
    workspaceLeaves(node.second, result);
  }
  return result;
}

function workspaceFindPane(paneId, node=workspaceLayout) {
  if (!node) return null;
  if (node.type === "pane") return node.id === paneId ? node : null;
  return workspaceFindPane(paneId, node.first) || workspaceFindPane(paneId, node.second);
}

function workspaceFindPaneForTab(key) {
  return workspaceLeaves().find(pane => pane.tabs.includes(key)) || null;
}

function workspaceFindSplit(splitId, node=workspaceLayout) {
  if (!node || node.type === "pane") return null;
  if (node.id === splitId) return node;
  return workspaceFindSplit(splitId, node.first) || workspaceFindSplit(splitId, node.second);
}

function currentWorkspacePaneId() {
  return workspaceExecutionPaneId || focusedPaneId || workspaceLeaves()[0]?.id || "pane-1";
}

function currentWorkspaceDomScope() {
  const paneId = currentWorkspacePaneId();
  return workspacePaneNodes.get(paneId)
    || document.querySelector(`.workspace-pane[data-pane-id="${workspaceCssEscape(paneId)}"]`)
    || null;
}

function workspaceGlobalHeaderToolsElement() {
  return document.getElementById("workspaceGlobalHeaderTools");
}

function clampWorkspaceChromeHeight(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function storedWorkspaceChromeHeight(key, min, max, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null || stored === ""
      ? fallback
      : clampWorkspaceChromeHeight(stored, min, max, fallback);
  } catch {
    return fallback;
  }
}

function scaledWorkspaceChromeValue(height, defaultHeight, base, slope, min, max) {
  return Math.max(min, Math.min(max, base + (height - defaultHeight) * slope));
}

function scheduleWorkspaceChromeFit() {
  if (workspaceChromeFitFrame || workspaceChromeFitTimer) return;
  if (workspaceChromeResize) {
    const now = globalThis.performance?.now?.() ?? Date.now();
    const remaining = Math.max(0, 64 - (now - workspaceChromeLastFitAt));
    if (remaining > 0) {
      workspaceChromeFitTimer = setTimeout(() => {
        workspaceChromeFitTimer = 0;
        scheduleWorkspaceChromeFit();
      }, remaining);
      return;
    }
  }
  workspaceChromeFitFrame = requestAnimationFrame(() => {
    workspaceChromeFitFrame = 0;
    workspaceChromeLastFitAt = globalThis.performance?.now?.() ?? Date.now();
    if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
    for (const pane of workspaceVisiblePanes()) {
      updateWorkspaceTabScrollControls(pane.id);
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
    }
    if (typeof syncSftpListLayout === "function") {
      for (const pane of workspaceVisiblePanes()) {
        const list = workspacePaneElement(pane.id)?.querySelector("#sftpList");
        if (list) syncSftpListLayout(list);
      }
    }
  });
}

function syncWorkspaceChromeResizeAria() {
  const headerHandle = document.getElementById("workspaceHeaderResize");
  if (headerHandle) {
    headerHandle.setAttribute("aria-valuemin", String(WORKSPACE_HEADER_HEIGHT_MIN));
    headerHandle.setAttribute("aria-valuemax", String(WORKSPACE_HEADER_HEIGHT_MAX));
    headerHandle.setAttribute("aria-valuenow", String(workspaceHeaderHeight));
  }
  document.querySelectorAll(".workspace-tab-resizer").forEach(handle => {
    handle.setAttribute("aria-valuemin", String(WORKSPACE_TAB_HEIGHT_MIN));
    handle.setAttribute("aria-valuemax", String(WORKSPACE_TAB_HEIGHT_MAX));
    handle.setAttribute("aria-valuenow", String(workspaceTabHeight));
  });
}

function applyWorkspaceHeaderHeight(value, options={}) {
  workspaceHeaderHeight = clampWorkspaceChromeHeight(
    value,
    WORKSPACE_HEADER_HEIGHT_MIN,
    WORKSPACE_HEADER_HEIGHT_MAX,
    WORKSPACE_HEADER_HEIGHT_DEFAULT
  );
  const root = document.documentElement;
  if (root?.style) {
    root.style.setProperty("--workspace-header-height", `${workspaceHeaderHeight}px`);
    root.style.setProperty("--workspace-header-title-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 14, .2, 12, 18).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-subtitle-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 10, .12, 9, 13).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-control-height", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 30, .27, 27, 36).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-control-font-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 12, .1, 11, 14).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-icon-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 14, .13, 13, 17).toFixed(2)}px`);
  }
  if (options.persist) {
    try { localStorage.setItem("workspaceHeaderHeight", String(workspaceHeaderHeight)); } catch {}
  }
  syncWorkspaceChromeResizeAria();
  if (options.fit !== false) scheduleWorkspaceChromeFit();
  return workspaceHeaderHeight;
}

function applyWorkspaceTabHeight(value, options={}) {
  workspaceTabHeight = clampWorkspaceChromeHeight(
    value,
    WORKSPACE_TAB_HEIGHT_MIN,
    WORKSPACE_TAB_HEIGHT_MAX,
    WORKSPACE_TAB_HEIGHT_DEFAULT
  );
  const root = document.documentElement;
  if (root?.style) {
    root.style.setProperty("--workspace-tab-height", `${workspaceTabHeight}px`);
    root.style.setProperty("--workspace-tab-font-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 12, .18, 10.5, 15).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-dot-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 7, .1, 6, 9).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-close-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 18, .2, 16, 22).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-horizontal-padding", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 8, .2, 6, 11).toFixed(2)}px`);
  }
  if (options.persist) {
    try { localStorage.setItem("workspaceTabHeight", String(workspaceTabHeight)); } catch {}
  }
  syncWorkspaceChromeResizeAria();
  if (options.fit !== false) scheduleWorkspaceChromeFit();
  return workspaceTabHeight;
}

function workspaceChromeResizeValue(kind) {
  return kind === "header" ? workspaceHeaderHeight : workspaceTabHeight;
}

function applyWorkspaceChromeResizeValue(kind, value, options={}) {
  return kind === "header"
    ? applyWorkspaceHeaderHeight(value, options)
    : applyWorkspaceTabHeight(value, options);
}

function workspaceChromeResizeDefault(kind) {
  return kind === "header" ? WORKSPACE_HEADER_HEIGHT_DEFAULT : WORKSPACE_TAB_HEIGHT_DEFAULT;
}

function beginWorkspaceChromeResize(event, kind) {
  if (event.button !== 0 || isMobileLayout()) return;
  if (workspaceChromeResize) endWorkspaceChromeResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  workspaceChromeResize = {
    kind,
    pointerId:event.pointerId,
    startY:event.clientY,
    startValue:workspaceChromeResizeValue(kind),
    handle:event.currentTarget
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("workspace-chrome-resizing", kind === "header" ? "workspace-header-resizing" : "workspace-tab-resizing");
  window.addEventListener("pointermove", moveWorkspaceChromeResize, {passive:false});
  window.addEventListener("pointerup", endWorkspaceChromeResize);
  window.addEventListener("pointercancel", cancelWorkspaceChromeResize);
  window.addEventListener("blur", finishWorkspaceChromeResizeOnBlur);
}

function moveWorkspaceChromeResize(event) {
  const drag = workspaceChromeResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applyWorkspaceChromeResizeValue(drag.kind, drag.startValue + event.clientY - drag.startY);
}

function cancelWorkspaceChromeResize(event) {
  endWorkspaceChromeResize(event, true);
}

function finishWorkspaceChromeResizeOnBlur() {
  endWorkspaceChromeResize(null);
}

function finishWorkspaceChromeResizeOnLostCapture(event) {
  endWorkspaceChromeResize(event);
}

function endWorkspaceChromeResize(event, cancelled=false) {
  const drag = workspaceChromeResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveWorkspaceChromeResize);
  window.removeEventListener("pointerup", endWorkspaceChromeResize);
  window.removeEventListener("pointercancel", cancelWorkspaceChromeResize);
  window.removeEventListener("blur", finishWorkspaceChromeResizeOnBlur);
  workspaceChromeResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("workspace-chrome-resizing", "workspace-header-resizing", "workspace-tab-resizing");
  if (workspaceChromeFitTimer) {
    clearTimeout(workspaceChromeFitTimer);
    workspaceChromeFitTimer = 0;
  }
  applyWorkspaceChromeResizeValue(drag.kind, cancelled ? drag.startValue : workspaceChromeResizeValue(drag.kind), {
    persist:!cancelled
  });
}

function resetWorkspaceChromeSize(event, kind) {
  if (isMobileLayout()) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  applyWorkspaceChromeResizeValue(kind, workspaceChromeResizeDefault(kind), {persist:true});
}

function handleWorkspaceChromeResizeKey(event, kind) {
  if (isMobileLayout()) return;
  const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!direction && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const rangeValue = event.key === "Home"
    ? (kind === "header" ? WORKSPACE_HEADER_HEIGHT_MIN : WORKSPACE_TAB_HEIGHT_MIN)
    : event.key === "End"
      ? (kind === "header" ? WORKSPACE_HEADER_HEIGHT_MAX : WORKSPACE_TAB_HEIGHT_MAX)
      : workspaceChromeResizeValue(kind) + direction * (event.shiftKey ? 4 : 1);
  applyWorkspaceChromeResizeValue(kind, rangeValue, {persist:true});
}

function bindWorkspaceChromeResizeHandle(handle, kind) {
  if (!handle || handle.dataset.workspaceResizeBound === "1") return;
  handle.dataset.workspaceResizeBound = "1";
  handle.setAttribute("aria-valuemin", String(kind === "header" ? WORKSPACE_HEADER_HEIGHT_MIN : WORKSPACE_TAB_HEIGHT_MIN));
  handle.setAttribute("aria-valuemax", String(kind === "header" ? WORKSPACE_HEADER_HEIGHT_MAX : WORKSPACE_TAB_HEIGHT_MAX));
  handle.setAttribute("aria-valuenow", String(workspaceChromeResizeValue(kind)));
  handle.addEventListener("pointerdown", event => beginWorkspaceChromeResize(event, kind));
  handle.addEventListener("lostpointercapture", finishWorkspaceChromeResizeOnLostCapture);
  handle.addEventListener("dblclick", event => resetWorkspaceChromeSize(event, kind));
  handle.addEventListener("keydown", event => handleWorkspaceChromeResizeKey(event, kind));
}

function initWorkspaceChromeSizing() {
  workspaceHeaderHeight = storedWorkspaceChromeHeight(
    "workspaceHeaderHeight",
    WORKSPACE_HEADER_HEIGHT_MIN,
    WORKSPACE_HEADER_HEIGHT_MAX,
    WORKSPACE_HEADER_HEIGHT_DEFAULT
  );
  workspaceTabHeight = storedWorkspaceChromeHeight(
    "workspaceTabHeight",
    WORKSPACE_TAB_HEIGHT_MIN,
    WORKSPACE_TAB_HEIGHT_MAX,
    WORKSPACE_TAB_HEIGHT_DEFAULT
  );
  applyWorkspaceHeaderHeight(workspaceHeaderHeight, {fit:false});
  applyWorkspaceTabHeight(workspaceTabHeight, {fit:false});
  bindWorkspaceChromeResizeHandle(document.getElementById("workspaceHeaderResize"), "header");
  document.querySelectorAll(".workspace-tab-resizer").forEach(handle => bindWorkspaceChromeResizeHandle(handle, "tabs"));
  syncWorkspaceChromeResizeAria();
}

function workspacePaneHeaderToolsElement(paneId) {
  return workspacePaneElement(paneId)?.querySelector('[data-workspace-role="header-tools"]') || null;
}

function workspaceToolbarSettingsValue() {
  try {
    const value = runtimeSettings?.saved?.workspace_toolbar_placement
      || runtimeSettings?.workspace_toolbar_placement;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function workspaceToolbarPlacementForTab(tabKey, kind="") {
  if (isMobileLayout()) return "tab";
  const tab = tabs.find(item => item.key === tabKey);
  const toolbarKind = kind || tab?.kind || "";
  const mode = workspaceLeaves().length > 1 ? "split" : "unsplit";
  const placement = workspaceToolbarSettingsValue()?.[mode]?.[toolbarKind];
  return placement === "tab" ? "tab" : "header";
}

function workspaceToolbarMountElement(kind, tabKey) {
  const escapedKind = workspaceCssEscape(kind);
  const escapedKey = workspaceCssEscape(tabKey);
  const registered = document.querySelector(`[data-workspace-toolbar-mount="${escapedKind}"][data-workspace-tab-key="${escapedKey}"]`);
  if (registered) return registered;
  const pane = workspaceFindPaneForTab(tabKey);
  const view = workspacePaneElement(pane?.id)?.querySelector(`#view-${escapedKind}`);
  const viewKey = view?.dataset?.workspaceTabKey
    || view?.dataset?.terminalTabKey
    || view?.dataset?.sftpTabKey
    || "";
  if (!view || (viewKey && viewKey !== tabKey)) return null;
  const mountId = kind === "terminal" ? "terminalToolbarMount" : kind === "sftp" ? "sftpToolbarMount" : "";
  return mountId ? view.querySelector(`#${mountId}`) : null;
}

function registerWorkspaceToolbar(kind, tabKey, toolbar, mount) {
  if (!toolbar || !tabKey || !["terminal", "sftp"].includes(kind)) return null;
  toolbar.dataset.workspaceToolbarKind = kind;
  toolbar.dataset.workspaceTabKey = tabKey;
  if (mount) {
    mount.dataset.workspaceToolbarMount = kind;
    mount.dataset.workspaceTabKey = tabKey;
  }
  return toolbar;
}

function workspaceToolbarRecord(toolbar) {
  if (!toolbar) return null;
  const kind = toolbar.dataset.workspaceToolbarKind
    || (toolbar.classList.contains("terminal-toolbar") ? "terminal" : toolbar.classList.contains("sftp-toolbar") ? "sftp" : "");
  if (!kind) return null;
  const pane = toolbar.closest(".workspace-pane");
  const view = toolbar.closest(`#view-${kind}`);
  const mount = toolbar.closest("[data-workspace-toolbar-mount]")
    || toolbar.closest(kind === "terminal" ? "#terminalToolbarMount" : "#sftpToolbarMount");
  const tabKey = toolbar.dataset.workspaceTabKey
    || mount?.dataset?.workspaceTabKey
    || view?.dataset?.workspaceTabKey
    || view?.dataset?.terminalTabKey
    || view?.dataset?.sftpTabKey
    || workspaceFindPane(pane?.dataset?.paneId)?.activeTabKey
    || "";
  if (!tabKey) return null;
  const ownerMount = workspaceToolbarMountElement(kind, tabKey) || mount;
  registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
  return {kind, tabKey, toolbar, mount:ownerMount};
}

function workspaceToolbarDestination(kind, tabKey, mount=null) {
  const pane = workspaceFindPaneForTab(tabKey);
  const tab = tabs.find(item => item.key === tabKey);
  const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
  if (!pane || !tab || tab.kind !== kind || pane.activeTabKey !== tabKey) {
    return {host:ownerMount, visible:false, header:false};
  }
  if (isMobileLayout()) {
    return {host:ownerMount, visible:pane.id === focusedPaneId, header:false};
  }
  if (workspaceToolbarPlacementForTab(tabKey, kind) === "tab") {
    return {host:workspacePaneHeaderToolsElement(pane.id), visible:true, header:true};
  }
  if (pane.id === focusedPaneId) {
    return {host:workspaceGlobalHeaderToolsElement(), visible:true, header:true};
  }
  return {host:ownerMount, visible:false, header:false};
}

function returnWorkspaceToolbarToMount(toolbar, hidden=true) {
  const record = workspaceToolbarRecord(toolbar);
  if (!record) {
    toolbar?.remove();
    return;
  }
  if (!record.mount?.isConnected) {
    toolbar.remove();
    return;
  }
  if (record.mount && toolbar.parentElement !== record.mount) record.mount.appendChild(toolbar);
  toolbar.classList.remove("terminal-toolbar-header", "sftp-toolbar-header");
  toolbar.hidden = hidden;
}

function placeWorkspaceToolbar(kind, tabKey, toolbar, mount=null) {
  registerWorkspaceToolbar(kind, tabKey, toolbar, mount);
  const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
  if (ownerMount) registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
  const destination = workspaceToolbarDestination(kind, tabKey, ownerMount);
  const host = destination.host || ownerMount;
  if (!host) {
    toolbar.remove();
    return false;
  }
  for (const existing of [...host.querySelectorAll(":scope > .terminal-toolbar, :scope > .sftp-toolbar")]) {
    if (existing === toolbar) continue;
    const existingRecord = workspaceToolbarRecord(existing);
    if (existingRecord?.kind === kind && existingRecord.tabKey === tabKey) existing.remove();
    else returnWorkspaceToolbarToMount(existing, true);
  }
  if (toolbar.parentElement !== host) host.appendChild(toolbar);
  toolbar.hidden = !destination.visible;
  toolbar.classList.toggle("terminal-toolbar-header", destination.header && kind === "terminal");
  toolbar.classList.toggle("sftp-toolbar-header", destination.header && kind === "sftp");
  return destination.visible;
}

function syncWorkspaceToolbarHostVisibility() {
  const hosts = [
    workspaceGlobalHeaderToolsElement(),
    ...[...workspacePaneNodes.values()].map(pane => pane.querySelector('[data-workspace-role="header-tools"]'))
  ].filter(Boolean);
  for (const host of hosts) {
    host.hidden = ![...host.children].some(child => child.matches?.(".terminal-toolbar:not([hidden]), .sftp-toolbar:not([hidden])"));
  }
}

function syncWorkspaceToolbarPlacements() {
  if (!workspaceDockElement()) {
    if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement(activeTabKey);
    if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement(activeTabKey);
    return;
  }
  const discovered = [...document.querySelectorAll(".terminal-toolbar, .sftp-toolbar")]
    .map(workspaceToolbarRecord)
    .filter(Boolean);
  const owners = new Map();
  for (const record of discovered) {
    const owner = `${record.kind}\0${record.tabKey}`;
    const previous = owners.get(owner);
    if (!previous) {
      owners.set(owner, record);
      continue;
    }
    const previousAtMount = previous.toolbar.parentElement === previous.mount;
    const currentAtMount = record.toolbar.parentElement === record.mount;
    if (currentAtMount && !previousAtMount) {
      previous.toolbar.remove();
      owners.set(owner, record);
    } else {
      record.toolbar.remove();
    }
  }
  const records = [...owners.values()];
  const ranked = records.map(record => ({
    ...record,
    destination:workspaceToolbarDestination(record.kind, record.tabKey, record.mount)
  })).sort((left, right) => Number(left.destination.visible) - Number(right.destination.visible));
  for (const record of ranked) placeWorkspaceToolbar(record.kind, record.tabKey, record.toolbar, record.mount);
  syncWorkspaceToolbarHostVisibility();
  for (const pane of workspaceVisiblePanes()) {
    const tab = tabs.find(item => item.key === pane.activeTabKey);
    if (tab?.kind === "terminal" && typeof updateTerminalStatusForLayout === "function") updateTerminalStatusForLayout(tab.key);
    if (tab?.kind === "sftp" && typeof syncSftpMobileToolbarState === "function") syncSftpMobileToolbarState(tab.key);
  }
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function runInWorkspacePane(paneId, action) {
  const previousPaneId = workspaceExecutionPaneId;
  workspaceExecutionPaneId = paneId || previousPaneId || focusedPaneId;
  try {
    return action();
  } finally {
    workspaceExecutionPaneId = previousPaneId;
  }
}

function captureWorkspacePane() {
  const paneId = currentWorkspacePaneId();
  return action => {
    if (workspaceDockElement() && !workspaceFindPane(paneId)) return undefined;
    return runInWorkspacePane(paneId, action);
  };
}

function captureWorkspaceTab(tabKey=activeTabKey) {
  const fallbackPaneId = currentWorkspacePaneId();
  return action => {
    if (!workspaceDockElement()) return runInWorkspacePane(fallbackPaneId, action);
    const pane = workspaceFindPaneForTab(tabKey);
    if (!pane || pane.activeTabKey !== tabKey) return undefined;
    return runInWorkspacePane(pane.id, action);
  };
}

function workspacePaneElement(paneId) {
  return workspacePaneNodes.get(paneId)
    || document.querySelector(`.workspace-pane[data-pane-id="${workspaceCssEscape(paneId)}"]`)
    || null;
}

function workspaceElementForTab(key, selector) {
  const pane = workspaceFindPaneForTab(key);
  // A pane reuses one DOM section per view, so inactive tabs must not resolve another tab's mounted controls.
  if (!pane || pane.activeTabKey !== key) return null;
  return workspacePaneElement(pane.id)?.querySelector(selector) || null;
}

function workspaceNextPaneId() {
  let id = "";
  do {
    workspacePaneSerial += 1;
    id = `pane-${workspacePaneSerial}`;
  } while (workspaceFindPane(id) || workspacePaneNodes.has(id));
  return id;
}

function workspaceNextSplitId() {
  let id = "";
  do {
    workspaceSplitSerial += 1;
    id = `split-${workspaceSplitSerial}`;
  } while (workspaceFindSplit(id));
  return id;
}

function workspaceViewsFragment(paneId) {
  const template = document.getElementById("workspaceViewsTpl");
  if (template?.content) {
    const fragment = template.content.cloneNode(true);
    fragment.querySelectorAll?.(".view").forEach(view => { view.dataset.workspacePaneId = paneId; });
    return fragment;
  }
  const fragment = document.createDocumentFragment();
  for (const name of ["welcome", "terminal", "forwards", "edit", "import", "log", "command", "sftp", "local-files", "settings", "dashboard", "remote-desktop", "remote-terminal", "ftp", "linux-desktop"]) {
    const section = document.createElement("section");
    section.id = `view-${name}`;
    section.className = "view";
    section.dataset.workspacePaneId = paneId;
    section.hidden = name !== "welcome";
    fragment.appendChild(section);
  }
  return fragment;
}

function createWorkspacePaneElement(paneId) {
  const pane = document.createElement("section");
  pane.className = "workspace-pane";
  pane.dataset.paneId = paneId;
  pane.innerHTML = `
    <div class="workspace-pane-chrome">
      <div class="tabs-shell">
        <button class="tabs-scroll-button tabs-scroll-left" type="button" title="向左滚动标签" aria-label="向左滚动标签" hidden>${icon("chevron-left")}</button>
        <div class="tabs" role="tablist"></div>
        <button class="tabs-scroll-button tabs-scroll-right" type="button" title="向右滚动标签" aria-label="向右滚动标签" hidden>${icon("chevron-right")}</button>
        <div class="workspace-tab-insert-indicator" aria-hidden="true" hidden></div>
        <div class="workspace-tab-resizer" role="separator" aria-orientation="horizontal" aria-label="调整标签栏高度" tabindex="0" title="拖动调整标签栏高度，双击恢复默认"></div>
      </div>
      <div class="workspace-header-tools" data-workspace-role="header-tools" hidden></div>
    </div>
    <div class="workspace"></div>
    <div class="workspace-pane-drop-indicator" aria-hidden="true" hidden><span></span></div>`;
  pane.querySelector(".workspace").appendChild(workspaceViewsFragment(paneId));
  pane.addEventListener("pointerdown", () => focusWorkspacePane(paneId), true);
  pane.addEventListener("focusin", () => focusWorkspacePane(paneId), true);
  const tabsNode = pane.querySelector(".tabs");
  tabsNode.addEventListener("scroll", () => updateWorkspaceTabScrollControls(paneId), {passive:true});
  tabsNode.addEventListener("wheel", event => handleWorkspaceTabsWheel(event, paneId), {passive:false});
  if (typeof ResizeObserver === "function") {
    pane._workspaceTabResizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!workspaceFindPane(paneId)) return;
        updateWorkspaceTabScrollControls(paneId);
        const activeKey = workspaceFindPane(paneId)?.activeTabKey;
        if (activeKey) revealWorkspaceTab(activeKey);
      });
    });
    pane._workspaceTabResizeObserver.observe(tabsNode);
  }
  pane.querySelector(".tabs-shell").addEventListener("contextmenu", event => {
    if (event.target.closest(".tab,button")) return;
    showWorkspaceTabsContextMenu(event);
  });
  pane.querySelector(".tabs-scroll-left").addEventListener("click", () => scrollWorkspaceTabs(-1, paneId));
  pane.querySelector(".tabs-scroll-right").addEventListener("click", () => scrollWorkspaceTabs(1, paneId));
  bindWorkspaceChromeResizeHandle(pane.querySelector(".workspace-tab-resizer"), "tabs");
  syncWorkspaceChromeResizeAria();
  workspacePaneNodes.set(paneId, pane);
  return pane;
}

function ensureWorkspacePaneElement(paneId) {
  return workspacePaneElement(paneId) || createWorkspacePaneElement(paneId);
}

function applyWorkspaceSplitGeometry(element, node) {
  const ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, Number(node.ratio) || 0.5));
  node.ratio = ratio;
  element.style.setProperty("--workspace-split-ratio", `${ratio * 100}%`);
  const separator = element.querySelector(":scope > .workspace-splitter");
  if (separator) {
    separator.setAttribute("aria-valuemin", String(Math.round(WORKSPACE_MIN_SPLIT_RATIO * 100)));
    separator.setAttribute("aria-valuemax", String(Math.round(WORKSPACE_MAX_SPLIT_RATIO * 100)));
    separator.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
}

function buildWorkspaceLayoutNode(node) {
  if (!node || !["pane", "split"].includes(node.type)) return null;
  if (node.type === "pane") return ensureWorkspacePaneElement(node.id);
  const split = document.createElement("div");
  split.className = `workspace-split workspace-split-${node.direction}`;
  split.dataset.splitId = node.id;
  applyWorkspaceSplitGeometry(split, node);
  const first = document.createElement("div");
  first.className = "workspace-split-child workspace-split-first";
  const firstNode = buildWorkspaceLayoutNode(node.first);
  const secondNode = buildWorkspaceLayoutNode(node.second);
  if (!firstNode) return secondNode;
  if (!secondNode) return firstNode;
  first.appendChild(firstNode);
  const separator = document.createElement("div");
  separator.className = "workspace-splitter";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-orientation", node.direction === "row" ? "vertical" : "horizontal");
  separator.setAttribute("aria-label", "调整分屏比例");
  separator.addEventListener("pointerdown", event => beginWorkspaceSplitterDrag(event, node.id));
  separator.addEventListener("dblclick", () => setWorkspaceSplitRatio(node.id, 0.5));
  separator.addEventListener("keydown", event => handleWorkspaceSplitterKey(event, node.id));
  const second = document.createElement("div");
  second.className = "workspace-split-child workspace-split-second";
  second.appendChild(secondNode);
  split.append(first, separator, second);
  applyWorkspaceSplitGeometry(split, node);
  return split;
}

function renderWorkspaceLayout() {
  const dock = workspaceDockElement();
  if (!dock) return;
  let visibleLayout = workspaceLayout;
  if (isMobileLayout()) {
    visibleLayout = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0] || workspaceLayout;
  }
  const root = buildWorkspaceLayoutNode(visibleLayout);
  if (!root) return;
  dock.replaceChildren(root);
  const livePaneIds = new Set(workspaceLeaves().map(pane => pane.id));
  for (const [paneId, pane] of workspacePaneNodes) {
    if (livePaneIds.has(paneId)) continue;
    pane._workspaceTabResizeObserver?.disconnect?.();
    pane.remove();
    workspacePaneNodes.delete(paneId);
  }
  document.body.classList.toggle("workspace-is-split", workspaceLeaves().length > 1 && !isMobileLayout());
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) updateWorkspaceTabScrollControls(pane.id);
    if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
    if (typeof syncSftpListLayout === "function") {
      for (const pane of workspaceVisiblePanes()) {
        const list = workspacePaneElement(pane.id)?.querySelector("#sftpList");
        if (list) syncSftpListLayout(list);
      }
    }
  });
}

function workspaceVisiblePanes() {
  if (!isMobileLayout()) return workspaceLeaves();
  const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  return focused ? [focused] : [];
}

function workspaceTabsForPane(pane) {
  if (isMobileLayout()) return tabs;
  const byKey = new Map(tabs.map(tab => [tab.key, tab]));
  return pane.tabs.map(key => byKey.get(key)).filter(Boolean);
}

function reconcileWorkspaceLayoutTabs() {
  const validKeys = new Set(tabs.map(tab => tab.key));
  const claimedKeys = new Set();
  for (const pane of workspaceLeaves()) {
    pane.tabs = pane.tabs.filter(key => {
      if (!validKeys.has(key) || claimedKeys.has(key)) return false;
      claimedKeys.add(key);
      return true;
    });
    if (!pane.tabs.includes(pane.activeTabKey)) pane.activeTabKey = pane.tabs[0] || "";
  }
  let targetPane = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  if (!targetPane) {
    targetPane = {type:"pane", id:workspaceNextPaneId(), tabs:[], activeTabKey:""};
    workspaceLayout = targetPane;
  }
  for (const tab of tabs) {
    if (claimedKeys.has(tab.key)) continue;
    targetPane.tabs.push(tab.key);
    claimedKeys.add(tab.key);
  }
  if (activeTabKey && targetPane.tabs.includes(activeTabKey)) targetPane.activeTabKey = activeTabKey;
  if (!targetPane.activeTabKey) targetPane.activeTabKey = targetPane.tabs[0] || "";
  normalizeWorkspaceLayoutAfterMutation(targetPane.id);
}

function syncWorkspaceLegacyTabIds() {
  for (const [paneId, pane] of workspacePaneNodes) {
    const focused = paneId === focusedPaneId;
    const entries = [
      [pane.querySelector(".tabs"), "tabs"],
      [pane.querySelector(".tabs-scroll-left"), "tabsScrollLeft"],
      [pane.querySelector(".tabs-scroll-right"), "tabsScrollRight"]
    ];
    for (const [element, id] of entries) {
      if (!element) continue;
      if (focused) element.id = id;
      else element.removeAttribute("id");
    }
  }
}

function workspaceTabHtml(tab, pane) {
  const presentation = workspaceTabPresentation(tab);
  const broadcastSelected = typeof isTerminalBroadcastTarget === "function" && isTerminalBroadcastTarget(tab.key);
  const multiSelected = workspaceSelectedTabKeys.has(tab.key);
  const visibleInPane = tab.key === pane.activeTabKey;
  if (visibleInPane && tab.activityState) tab.activityState = "";
  const fullTitle = [tab.title, tab.subtitle, broadcastSelected ? "终端同步中" : "", multiSelected ? "已选中，可组成工作区" : ""].filter(Boolean).join(" - ");
  const connectionStatus = ["terminal", "sftp"].includes(tab.kind) ? (tab.connectionStatus || "connecting") : "";
  const connectionDot = connectionStatus
    ? `<span class="tab-connection-dot ${connectionStatus}" title="${connectionStatus === "connected" ? "已连接" : connectionStatus === "disconnected" ? "已断开" : "连接中"}" aria-hidden="true"></span>`
    : "";
  return `<button class="tab ${tab.key === pane.activeTabKey ? "active" : ""}${multiSelected ? " multi-selected" : ""}${tab.pinned ? " pinned" : ""}${broadcastSelected ? " broadcast-selected" : ""}${tab.activityState ? ` activity-${escAttr(tab.activityState)}` : ""}" role="tab" aria-selected="${tab.key === pane.activeTabKey}" aria-checked="${multiSelected}" data-tab-key="${escAttr(tab.key)}" data-kind="${escAttr(tab.kind || "")}" title="${esc(fullTitle)}" aria-label="${esc(`${tab.title}${broadcastSelected ? "，已加入终端同步" : ""}${multiSelected ? "，已选择" : ""}`)}" onpointerdown="beginWorkspaceTabDrag(event,'${escAttr(tab.key)}')" onclick="activateWorkspaceTabFromClick(event,'${escAttr(tab.key)}')" oncontextmenu="showTabContextMenu(event,'${escAttr(tab.key)}')" ondragover="handleSftpTabDragOver(event,'${escAttr(tab.key)}')" ondragleave="handleSftpTabDragLeave(event,'${escAttr(tab.key)}')" ondrop="dropSftpItemsOnTab(event,'${escAttr(tab.key)}')">${connectionDot}${presentation.icon}${tab.pinned ? `<span class="tab-pin" aria-hidden="true">${icon("pin")}</span>` : ""}<span class="tab-title">${esc(presentation.title)}</span>${tab.closable && !tab.pinned ? `<span class="tab-close" title="关闭标签" aria-label="关闭标签" onpointerdown="event.stopPropagation()" onclick="closeTab(event,'${escAttr(tab.key)}')">x</span>` : ""}</button>`;
}

renderTabs = function() {
  if (!workspaceDockElement()) return legacyWorkspaceApi.renderTabs();
  if (typeof syncSftpTabTitles === "function") syncSftpTabTitles();
  reconcileWorkspaceLayoutTabs();
  renderWorkspaceLayout();
  for (const pane of workspaceVisiblePanes()) {
    const paneElement = workspacePaneElement(pane.id);
    if (!paneElement) continue;
    paneElement.classList.toggle("focused", pane.id === focusedPaneId);
    const container = paneElement.querySelector(".tabs");
    const previousScrollLeft = container.scrollLeft;
    const paneTabs = workspaceTabsForPane(pane);
    const displayPane = isMobileLayout() ? (workspaceFindPane(focusedPaneId) || pane) : pane;
    container.innerHTML = paneTabs.map(tab => workspaceTabHtml(tab, displayPane)).join("");
    container.scrollLeft = previousScrollLeft;
    updateWorkspaceTabScrollControls(pane.id);
  }
  syncWorkspaceLegacyTabIds();
  syncWorkspaceToolbarPlacements();
  renderWorkspaceGroupBar();
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) {
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
    }
  });
  if (!window.restoringTabs) saveTabsState();
};

updateWorkspaceTabScrollControls = function(paneId=currentWorkspacePaneId()) {
  const pane = workspacePaneElement(paneId);
  const container = pane?.querySelector(".tabs");
  const left = pane?.querySelector(".tabs-scroll-left");
  const right = pane?.querySelector(".tabs-scroll-right");
  if (!container || !left || !right) return;
  const overflowing = container.scrollWidth > container.clientWidth + 1;
  left.hidden = !overflowing;
  right.hidden = !overflowing;
  left.disabled = !overflowing || container.scrollLeft <= 1;
  right.disabled = !overflowing || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  pane.querySelector(".tabs-shell")?.classList.toggle("overflowing", overflowing);
};

scrollWorkspaceTabs = function(direction, paneId=currentWorkspacePaneId()) {
  const container = workspacePaneElement(paneId)?.querySelector(".tabs");
  if (!container) return;
  container.scrollBy({left:direction * Math.max(160, container.clientWidth * 0.7), behavior:"smooth"});
};

handleWorkspaceTabsWheel = function(event, paneId=currentWorkspacePaneId()) {
  const container = workspacePaneElement(paneId)?.querySelector(".tabs");
  if (!container || container.scrollWidth <= container.clientWidth + 1) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const canScroll = delta < 0 ? container.scrollLeft > 0 : container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
  if (!delta || !canScroll) return;
  event.preventDefault();
  container.scrollLeft += delta;
};

revealWorkspaceTab = function(key) {
  requestAnimationFrame(() => {
    const pane = workspaceFindPaneForTab(key) || workspaceFindPane(focusedPaneId);
    const container = workspacePaneElement(pane?.id)?.querySelector(".tabs");
    const tabNode = container ? [...container.querySelectorAll(".tab")].find(item => item.dataset.tabKey === key) : null;
    if (!container || !tabNode) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = tabNode.getBoundingClientRect();
    const margin = Math.min(6, Math.max(2, container.clientWidth * 0.02));
    if (tabRect.left < containerRect.left + margin) {
      container.scrollLeft = Math.max(0, container.scrollLeft - (containerRect.left + margin - tabRect.left));
    } else if (tabRect.right > containerRect.right - margin) {
      container.scrollLeft = Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + (tabRect.right - containerRect.right + margin));
    }
    updateWorkspaceTabScrollControls(pane.id);
  });
};

function saveFocusedSftpPaneState() {
  const pane = workspaceFindPane(focusedPaneId);
  const tab = tabs.find(item => item.key === pane?.activeTabKey);
  if (tab?.kind === "sftp" && typeof rememberSftpViewState === "function") {
    try { rememberSftpViewState(tab.key); } catch {}
  }
}

function focusWorkspacePane(paneId) {
  const pane = workspaceFindPane(paneId);
  if (!pane) return;
  const wasFocused = focusedPaneId === paneId;
  if (!wasFocused) saveFocusedSftpPaneState();
  focusedPaneId = paneId;
  const tab = tabs.find(item => item.key === pane.activeTabKey);
  if (tab) {
    rememberWorkspacePaneTab(pane, tab.key, tab.key);
    activeTabKey = tab.key;
    activeView = tab.viewName || tab.kind || "welcome";
    const connectionId = Number(tab.id);
    if (Number.isInteger(connectionId) && connectionId > 0 && typeof selectedId !== "undefined" && selectedId !== connectionId) {
      if (typeof selectConnection === "function") selectConnection(connectionId);
      else selectedId = connectionId;
    }
    if (typeof restoreSftpRuntimeForTab === "function" && tab.kind === "sftp") restoreSftpRuntimeForTab(tab.key);
    const subtitle = document.getElementById("workspaceSubtitle");
    if (subtitle) subtitle.textContent = tab.subtitle || "";
    revealWorkspaceTab(tab.key);
  }
  if (wasFocused) return;
  syncFocusedWorkspaceClasses();
  for (const node of workspacePaneNodes.values()) node.classList.toggle("focused", node.dataset.paneId === focusedPaneId);
  syncWorkspaceLegacyTabIds();
  syncWorkspaceToolbarPlacements();
  saveTabsState();
}

function syncFocusedWorkspaceClasses() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const viewName = tab?.viewName || tab?.kind || activeView || "welcome";
  const content = document.getElementById("content");
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  content?.classList.toggle("terminal-content", terminalLike);
  content?.classList.toggle("sftp-content", viewName === "sftp");
  document.body.classList.toggle("mobile-terminal-active", isMobileLayout() && terminalLike);
}

function workspaceReplacePaneWithSplit(targetPaneId, splitNode, node=workspaceLayout) {
  if (node.type === "pane") return node.id === targetPaneId ? splitNode : node;
  node.first = workspaceReplacePaneWithSplit(targetPaneId, splitNode, node.first);
  node.second = workspaceReplacePaneWithSplit(targetPaneId, splitNode, node.second);
  return node;
}

function pruneWorkspaceLayout(node=workspaceLayout) {
  if (!node) return null;
  if (node.type === "pane") return node.tabs.length ? node : null;
  node.first = pruneWorkspaceLayout(node.first);
  node.second = pruneWorkspaceLayout(node.second);
  if (!node.first) return node.second;
  if (!node.second) return node.first;
  return node;
}

function normalizeWorkspaceLayoutAfterMutation(preferredPaneId="") {
  workspaceLayout = pruneWorkspaceLayout(workspaceLayout);
  if (!workspaceLayout) {
    const paneId = preferredPaneId || workspaceNextPaneId();
    workspaceLayout = {type:"pane", id:paneId, tabs:[], activeTabKey:""};
  }
  const leaves = workspaceLeaves();
  const byKey = new Map(tabs.map(tab => [tab.key, tab]));
  const assigned = new Set();
  for (const pane of leaves) {
    pane.tabs = pane.tabs.filter(key => {
      if (!byKey.has(key) || assigned.has(key)) return false;
      assigned.add(key);
      return true;
    });
    if (!pane.tabs.includes(pane.activeTabKey)) pane.activeTabKey = pane.tabs[0] || "";
  }
  const preferred = workspaceFindPane(preferredPaneId)
    || workspaceFindPane(focusedPaneId)
    || leaves[0];
  for (const tab of tabs) {
    if (assigned.has(tab.key)) continue;
    preferred.tabs.push(tab.key);
    assigned.add(tab.key);
  }
  if (!preferred.activeTabKey && preferred.tabs.length) preferred.activeTabKey = preferred.tabs[0];
  if (!workspaceFindPane(focusedPaneId)) focusedPaneId = preferred.id;
  const order = workspaceLeaves().flatMap(pane => pane.tabs);
  tabs = order.map(key => byKey.get(key)).filter(Boolean);
  const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  if (focused?.activeTabKey) activeTabKey = focused.activeTabKey;
}

function setPaneActiveKey(pane, key) {
  if (!pane || !pane.tabs.includes(key)) return;
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  if (pane.id === focusedPaneId) activeTabKey = key;
}

addTab = function(key, title, subtitle, viewName, closable=true, meta={}) {
  if (key !== "welcome") {
    tabs = tabs.filter(tab => tab.key !== "welcome");
    for (const pane of workspaceLeaves()) {
      pane.tabs = pane.tabs.filter(tabKey => tabKey !== "welcome");
      if (pane.activeTabKey === "welcome") pane.activeTabKey = pane.tabs[0] || "";
    }
    normalizeWorkspaceLayoutAfterMutation(focusedPaneId);
  }
  if (key === "welcome" && tabs.some(tab => tab.key !== "welcome")) return;
  let pane = workspaceFindPaneForTab(key)
    || workspaceFindPane(workspaceExecutionPaneId)
    || workspaceFindPane(focusedPaneId)
    || workspaceLeaves()[0];
  const insertionAnchorKey = pane?.activeTabKey || activeTabKey;
  let found = tabs.find(tab => tab.key === key);
  if (found) Object.assign(found, {title, subtitle, viewName, closable, ...meta});
  else {
    found = {key, title, subtitle, viewName, closable, ...meta};
    const insertion = tabs.findIndex(tab => tab.key === insertionAnchorKey);
    tabs.splice(insertion >= 0 ? insertion + 1 : tabs.length, 0, found);
  }
  pane = workspaceFindPaneForTab(key) || pane || workspaceLeaves()[0];
  if (!pane.tabs.includes(key)) {
    const insertion = pane.tabs.indexOf(insertionAnchorKey);
    pane.tabs.splice(insertion >= 0 ? insertion + 1 : pane.tabs.length, 0, key);
  }
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  focusedPaneId = pane.id;
  activeTabKey = key;
  activeView = viewName;
  renderTabs();
  revealWorkspaceTab(key);
};

setWorkspaceTabConnectionStatus = function(key, status) {
  const normalized = ["connected", "disconnected", "connecting"].includes(status) ? status : "disconnected";
  const matchingTabs = workspaceTabsByKey(key);
  if (!matchingTabs.length) return;
  for (const tab of matchingTabs) tab.connectionStatus = normalized;
  document.querySelectorAll(`.workspace-pane .tab[data-tab-key="${workspaceCssEscape(key)}"] .tab-connection-dot`).forEach(dot => {
    dot.className = `tab-connection-dot ${normalized}`;
    dot.title = normalized === "connected" ? "已连接" : normalized === "disconnected" ? "已断开" : "连接中";
  });
};

renderTabContent = function(tab) {
  if (tab.kind === "terminal") return openTerminal(tab.id, false, tab.key, tab.title);
  if (tab.kind === "forwards") return openForwards(tab.id, false);
  if (tab.kind === "edit") return editConnection(tab.id, false);
  if (tab.kind === "import") return showImport(false);
  if (tab.kind === "log") return openLog(tab.path, tab.title, false);
  if (tab.kind === "command") return openBatchCommand(false);
  if (tab.kind === "sftp") return openSftp(tab.id, tab.path || ".", false, tab.key);
  if (tab.kind === "dashboard") return openServerDashboard(tab.id, false);
  if (tab.kind === "remote-edit") return tab.id ? editRemoteProfile(tab.id, false) : newRemoteProfile(tab.protocol || "rdp");
  if (tab.kind === "remote-desktop") return openRemoteDesktop(tab.id, false);
  if (tab.kind === "linux-desktop") {
    const connectionId = Number(tab.id || String(tab.key || "").match(/^linux-desktop-(\d+)$/)?.[1] || 0);
    return openLinuxDesktopManager(connectionId, false);
  }
  if (tab.kind === "remote-terminal") return openRemoteTerminal(tab.id, false, tab.key, tab.title);
  if (tab.kind === "ftp") return openFtpProfile(tab.id, tab.path || "/", false, tab.key);
  if (tab.kind === "settings") return openSettings(false);
  return setWorkspace(tab.title, tab.subtitle, tab.viewName, tab.key, false, tab.closable);
};

function renderWorkspacePaneContent(paneId) {
  if (!workspaceDockElement()) return null;
  if (isMobileLayout() && paneId !== focusedPaneId) return null;
  const pane = workspaceFindPane(paneId);
  const tab = tabs.find(item => item.key === pane?.activeTabKey);
  if (!pane || !tab) return null;
  const previousExecutionPane = workspaceExecutionPaneId;
  const previousActiveKey = activeTabKey;
  const previousActiveView = activeView;
  workspaceExecutionPaneId = paneId;
  activeTabKey = tab.key;
  activeView = tab.viewName || tab.kind || "welcome";
  try {
    const result = renderTabContent(tab);
    if (result?.catch) {
      result.catch(error => {
        const previousPane = workspaceExecutionPaneId;
        workspaceExecutionPaneId = paneId;
        try { notify(error.message || String(error), "error"); }
        finally { workspaceExecutionPaneId = previousPane; }
      });
    }
    return result;
  } finally {
    workspaceExecutionPaneId = previousExecutionPane;
    if (paneId !== focusedPaneId) {
      activeTabKey = previousActiveKey;
      activeView = previousActiveView;
    }
  }
}

activateTab = function(key) {
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  if (!tab || !pane) return;
  saveFocusedSftpPaneState();
  focusedPaneId = pane.id;
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  activeTabKey = key;
  activeView = tab.viewName || tab.kind || "welcome";
  if (typeof restoreSftpRuntimeForTab === "function" && tab.kind === "sftp") restoreSftpRuntimeForTab(tab.key);
  renderTabs();
  revealWorkspaceTab(key);
  renderWorkspacePaneContent(pane.id);
  syncFocusedWorkspaceClasses();
  syncWorkspaceToolbarPlacements();
};

setWorkspace = function(title, subtitle, viewName, key=viewName, updateTab=true, closable=true, meta={}) {
  if (!workspaceDockElement()) return legacyWorkspaceApi.setWorkspace(title, subtitle, viewName, key, updateTab, closable, meta);
  const existingPane = workspaceFindPaneForTab(activeTabKey) || workspaceFindPaneForTab(key);
  const paneId = workspaceExecutionPaneId || existingPane?.id || focusedPaneId;
  if (updateTab) addTab(key, title, subtitle, viewName, closable, meta);
  const resolvedPaneId = workspaceExecutionPaneId || workspaceFindPaneForTab(activeTabKey)?.id || paneId;
  const pane = ensureWorkspacePaneElement(resolvedPaneId);
  const workspace = pane.querySelector(".workspace");
  const view = workspace.querySelector(`#view-${workspaceCssEscape(viewName)}`);
  workspace.querySelectorAll(":scope > .view").forEach(item => { item.hidden = true; });
  if (view) view.hidden = false;
  pane.dataset.activeView = viewName;
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  workspace.classList.toggle("terminal-workspace", terminalLike);
  pane.classList.toggle("terminal-pane", terminalLike);
  pane.classList.toggle("sftp-pane", viewName === "sftp");
  if (resolvedPaneId === focusedPaneId) {
    const heading = document.getElementById("workspaceTitle");
    const description = document.getElementById("workspaceSubtitle");
    if (heading) heading.textContent = "工作区";
    if (description) description.textContent = subtitle || "";
    activeView = viewName;
    if (typeof syncWorkspaceDocumentTitle === "function") syncWorkspaceDocumentTitle(title, subtitle, viewName, key, meta);
    syncFocusedWorkspaceClasses();
  }
  const previousExecutionPane = workspaceExecutionPaneId;
  workspaceExecutionPaneId = resolvedPaneId;
  try {
    syncWorkspaceToolbarPlacements();
  } finally {
    workspaceExecutionPaneId = previousExecutionPane;
  }
  if (isMobileLayout() && viewName !== "welcome" && resolvedPaneId === focusedPaneId && !window.restoringTabs) showMobileWorkspace();
};

closeTab = function(event, key) {
  event.stopPropagation();
  closeTabsByKey([key], key);
};

closeTabsByKey = function(keys, anchorKey="") {
  const targets = new Set(keys.filter(key => !tabs.find(item => item.key === key)?.pinned));
  if (!targets.size) {
    if (keys.length) notify("固定标签需要先取消固定后才能关闭", "info");
    return;
  }
  if (typeof rememberClosedWorkspaceTabs === "function") rememberClosedWorkspaceTabs([...targets]);
  const anchorPane = workspaceFindPaneForTab(anchorKey) || workspaceFindPane(focusedPaneId);
  for (const key of targets) {
    const tab = tabs.find(item => item.key === key);
    closeTerminalSession(key);
    if (typeof closeRemoteProtocolSession === "function") closeRemoteProtocolSession(key);
    if (typeof ftpProfileStates !== "undefined") ftpProfileStates.delete(key);
    if (tab?.kind === "sftp" && typeof closeSftpSession === "function") closeSftpSession(key);
    if (tab?.kind === "log" && typeof disposeLogViewerState === "function") disposeLogViewerState(key);
    sftpDisconnectedTabs.delete(key);
    sftpViewStates.delete(key);
    if (typeof clearSftpDirectoryViewCache === "function") clearSftpDirectoryViewCache(key);
    if (tab?.kind === "command") stopBatchCommand();
  }
  tabs = tabs.filter(tab => !targets.has(tab.key));
  for (const pane of workspaceLeaves()) {
    const previousIndex = Math.max(0, pane.tabs.findIndex(key => targets.has(key)));
    const recentKey = targets.has(pane.activeTabKey) ? recentWorkspacePaneTab(pane, targets) : "";
    pane.tabs = pane.tabs.filter(key => !targets.has(key));
    if (!pane.tabs.includes(pane.activeTabKey)) {
      pane.activeTabKey = recentKey || pane.tabs[Math.min(previousIndex, pane.tabs.length - 1)] || pane.tabs.at(-1) || "";
    }
    trimWorkspacePaneTabHistory(pane);
    if (pane.activeTabKey) rememberWorkspacePaneTab(pane, pane.activeTabKey, pane.activeTabKey);
  }
  normalizeWorkspaceLayoutAfterMutation(anchorPane?.id || focusedPaneId);
  const focusedPane = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  focusedPaneId = focusedPane.id;
  activeTabKey = focusedPane.activeTabKey || "";
  renderTabs();
  if (activeTabKey) {
    const tab = tabs.find(item => item.key === activeTabKey);
    activeView = tab?.viewName || tab?.kind || "welcome";
    renderWorkspacePaneContent(focusedPane.id);
  } else renderWelcome();
};

closeTabsByMode = function(mode, key) {
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return;
  const paneTabs = pane.tabs.map(tabKey => tabs.find(tab => tab.key === tabKey)).filter(Boolean);
  const index = paneTabs.findIndex(tab => tab.key === key);
  const closable = paneTabs.filter(tab => tab.closable);
  let targets = [];
  if (mode === "current") targets = closable.filter(tab => tab.key === key);
  if (mode === "others") targets = closable.filter(tab => tab.key !== key);
  if (mode === "right") targets = paneTabs.slice(index + 1).filter(tab => tab.closable);
  if (mode === "all") targets = closable;
  hideTabContextMenu();
  if (targets.length) closeTabsByKey(targets.map(tab => tab.key), key);
};

moveWorkspaceTab = function(key, offset) {
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return hideTabContextMenu();
  const index = pane.tabs.indexOf(key);
  const target = Math.max(0, Math.min(pane.tabs.length - 1, index + offset));
  if (index < 0 || target === index) return hideTabContextMenu();
  pane.tabs.splice(index, 1);
  pane.tabs.splice(target, 0, key);
  normalizeWorkspaceLayoutAfterMutation(pane.id);
  hideTabContextMenu();
  renderTabs();
  revealWorkspaceTab(key);
};

function nextWorkspaceTabCopyKey(tab) {
  const base = String(tab?.key || tab?.kind || "tab").replace(/-copy-\d+$/, "");
  let key = "";
  do {
    workspaceTabCopySerial += 1;
    key = `${base}-copy-${workspaceTabCopySerial}`;
  } while (tabs.some(item => item.key === key));
  return key;
}

function workspaceTabCopyTitle(tab) {
  if (tab?.kind === "local-files") return "本地文件";
  const base = String(tab?.title || "标签").replace(/ · 副本(?: \d+)?$/, "");
  const copyCount = tabs.filter(item => String(item.title || "").startsWith(`${base} · 副本`)).length + 1;
  return `${base} · 副本${copyCount > 1 ? ` ${copyCount}` : ""}`;
}

function addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle) {
  const {
    key:ignoredKey,
    title:ignoredTitle,
    subtitle,
    viewName,
    closable,
    ...meta
  } = tab;
  addTab(duplicateKey, duplicateTitle, subtitle, viewName, closable !== false, meta);
}

function duplicateWorkspaceTab(key, options={}) {
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  if (!tab || !pane) return "";
  hideTabContextMenu();
  focusedPaneId = pane.id;
  setPaneActiveKey(pane, key);
  activeView = tab.viewName || tab.kind || "welcome";
  const duplicateKey = nextWorkspaceTabCopyKey(tab);
  const duplicateTitle = workspaceTabCopyTitle(tab);
  if (typeof options.beforeOpen === "function") {
    options.beforeOpen(duplicateKey, duplicateTitle, tab);
  } else if (
    tab.kind === "terminal"
    && typeof terminalStartupOverrides !== "undefined"
    && terminalStartupOverrides.has(key)
  ) {
    terminalStartupOverrides.set(duplicateKey, terminalStartupOverrides.get(key));
  }
  const splitZone = !isMobileLayout() && ["left", "right", "top", "bottom"].includes(options.splitZone)
    ? options.splitZone
    : "";
  if (splitZone) {
    addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle);
    const openedInSplit = applyWorkspaceTabDrop(
      {key:duplicateKey},
      {paneId:pane.id, zone:splitZone}
    );
    if (!openedInSplit) activateTab(duplicateKey);
    if (options.result && typeof options.result === "object") {
      Object.assign(options.result, {key:duplicateKey, opened:true, split:Boolean(openedInSplit)});
    }
    return duplicateKey;
  }
  if (tab.kind === "terminal") {
    const openedKey = openTerminal(tab.id, true, duplicateKey, duplicateTitle);
    if (!openedKey) {
      if (typeof terminalStartupOverrides !== "undefined") terminalStartupOverrides.delete(duplicateKey);
      if (options.result && typeof options.result === "object") {
        Object.assign(options.result, {key:"", opened:false, split:false});
      }
      return "";
    }
    if (options.result && typeof options.result === "object") {
      Object.assign(options.result, {key:duplicateKey, opened:true, split:false});
    }
    return duplicateKey;
  }
  if (tab.kind === "sftp") {
    if (typeof duplicateSftpTab === "function") return duplicateSftpTab(key);
    return openSftp(tab.id, tab.path || ".", true, duplicateKey);
  }
  if (tab.kind === "local-files" && typeof openLocalFiles === "function") {
    return openLocalFiles(tab.path || "", true, duplicateKey);
  }
  addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle);
  renderWorkspacePaneContent(pane.id);
  return duplicateKey;
};

function workspaceCanDuplicateTab(tab) {
  return Boolean(tab?.kind);
}

function toggleWorkspaceTabPinned(key) {
  const tab = tabs.find(item => item.key === key);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  hideTabContextMenu();
  renderTabs();
  saveTabsState();
}

showTabContextMenu = function(event, key) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  const paneTabs = pane?.tabs || [];
  const index = paneTabs.indexOf(key);
  if (!tab || !pane || index < 0) return;
  focusWorkspacePane(pane.id);
  const options = [
    ["组成工作区", () => beginWorkspaceGroupSelection(key), true, "combine"],
    [tab.pinned ? "取消固定标签" : "固定标签", () => toggleWorkspaceTabPinned(key), true, "pin"],
    ...(tab.kind === "terminal" ? [[tab.notificationsMuted ? "开启此标签通知" : "静音此标签通知", () => toggleTabNotifications(key), true, tab.notificationsMuted ? "bell" : "bell-off"]] : []),
    ["复制标签", () => duplicateWorkspaceTab(key), workspaceCanDuplicateTab(tab), "copy"],
    ["向左移动", () => moveWorkspaceTab(key, -1), index > 0, "arrow-left"],
    ["向右移动", () => moveWorkspaceTab(key, 1), index < paneTabs.length - 1, "arrow-right"],
    ["关闭当前标签", () => closeTabsByMode("current", key), Boolean(tab.closable && !tab.pinned), "x"],
    ["关闭其他标签", () => closeTabsByMode("others", key), paneTabs.some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned && tabKey !== key), "circle-x"],
    ["关闭右侧标签", () => closeTabsByMode("right", key), paneTabs.slice(index + 1).some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned), "panel-right-close"],
    ["关闭此窗格标签", () => closeTabsByMode("all", key), paneTabs.some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned), "panel-top-close"]
  ];
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
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
};

function showWorkspaceTabsContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `${icon("combine")}<span>组成工作区</span>`;
  button.disabled = tabs.length < 2;
  button.onclick = () => beginWorkspaceGroupSelection();
  menu.appendChild(button);
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
}

function workspaceClearDropIndicators() {
  for (const pane of workspacePaneNodes.values()) {
    const indicator = pane.querySelector(".workspace-pane-drop-indicator");
    if (indicator) {
      indicator.hidden = true;
      indicator.dataset.zone = "";
    }
    const insertion = pane.querySelector(".workspace-tab-insert-indicator");
    if (insertion) insertion.hidden = true;
  }
  workspaceTabDropTarget = null;
}

function workspaceDropZoneAtPoint(pane, clientX, clientY) {
  const tabsShell = pane.querySelector(".tabs-shell");
  const tabsRect = tabsShell?.getBoundingClientRect();
  if (tabsRect && clientY >= tabsRect.top && clientY <= tabsRect.bottom) {
    const candidates = [...tabsShell.querySelectorAll(".tab:not(.tab-dragging)")];
    const index = candidates.findIndex(tab => clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2);
    return {zone:"tabs", index:index < 0 ? candidates.length : index};
  }
  const workspace = pane.querySelector(".workspace");
  const rect = workspace?.getBoundingClientRect();
  if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  if (isMobileLayout()) return {zone:"center", index:null};
  const distances = [
    ["left", (clientX - rect.left) / Math.max(1, rect.width)],
    ["right", (rect.right - clientX) / Math.max(1, rect.width)],
    ["top", (clientY - rect.top) / Math.max(1, rect.height)],
    ["bottom", (rect.bottom - clientY) / Math.max(1, rect.height)]
  ].sort((left, right) => left[1] - right[1]);
  return {zone:distances[0][1] <= 0.36 ? distances[0][0] : "center", index:null};
}

function showWorkspaceTabInsertionIndicator(paneElement, index) {
  const shell = paneElement.querySelector(".tabs-shell");
  const tabsNode = paneElement.querySelector(".tabs");
  const insertion = paneElement.querySelector(".workspace-tab-insert-indicator");
  if (!shell || !tabsNode || !insertion) return;
  const candidates = [...tabsNode.querySelectorAll(".tab:not(.tab-dragging)")];
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

function updateWorkspaceTabDropTarget(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const paneElement = element?.closest?.(".workspace-pane");
  if (!paneElement) return workspaceClearDropIndicators();
  const paneId = paneElement.dataset.paneId;
  const target = workspaceDropZoneAtPoint(paneElement, clientX, clientY);
  if (!target) return workspaceClearDropIndicators();
  for (const [otherPaneId, otherPane] of workspacePaneNodes) {
    if (otherPaneId === paneId) continue;
    const otherIndicator = otherPane.querySelector(".workspace-pane-drop-indicator");
    if (!otherIndicator) continue;
    otherIndicator.hidden = true;
    otherIndicator.dataset.zone = "";
    const otherInsertion = otherPane.querySelector(".workspace-tab-insert-indicator");
    if (otherInsertion) otherInsertion.hidden = true;
  }
  workspaceTabDropTarget = {paneId, ...target};
  const indicator = paneElement.querySelector(".workspace-pane-drop-indicator");
  if (!indicator) return;
  const insertion = paneElement.querySelector(".workspace-tab-insert-indicator");
  if (target.zone === "tabs") {
    indicator.hidden = true;
    indicator.dataset.zone = "";
    showWorkspaceTabInsertionIndicator(paneElement, target.index);
    return;
  }
  if (insertion) insertion.hidden = true;
  indicator.hidden = false;
  indicator.dataset.zone = target.zone;
  const labels = {left:"在左侧分屏", right:"在右侧分屏", top:"在上方分屏", bottom:"在下方分屏", center:"移到此窗格"};
  indicator.querySelector("span").textContent = labels[target.zone] || "";
}

function scheduleWorkspaceTabDockAutoScroll() {
  const drag = workspaceTabDrag;
  if (!drag?.dragging || drag.autoScrollFrame) return;
  drag.autoScrollFrame = requestAnimationFrame(updateWorkspaceTabDockAutoScroll);
}

function updateWorkspaceTabDockAutoScroll() {
  const drag = workspaceTabDrag;
  if (!drag?.dragging) return;
  drag.autoScrollFrame = 0;
  const target = workspaceTabDropTarget;
  const pane = workspacePaneElement(target?.paneId || drag.sourcePaneId);
  const container = pane?.querySelector(".tabs");
  const shell = pane?.querySelector(".tabs-shell");
  const rect = container?.getBoundingClientRect();
  const shellRect = shell?.getBoundingClientRect();
  if (container && rect && shellRect && drag.pointerY >= shellRect.top && drag.pointerY <= shellRect.bottom) {
    const edge = Math.min(42, Math.max(20, rect.width / 5));
    let amount = 0;
    if (drag.pointerX < rect.left + edge) amount = -10;
    else if (drag.pointerX > rect.right - edge) amount = 10;
    if (amount) {
      const previous = container.scrollLeft;
      container.scrollLeft += amount;
      if (container.scrollLeft !== previous) updateWorkspaceTabDropTarget(drag.pointerX, drag.pointerY);
    }
  }
  scheduleWorkspaceTabDockAutoScroll();
}

activateWorkspaceTabFromClick = function(event, key) {
  if (Date.now() < workspaceTabSuppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (workspaceGroupSelectionMode || (event.ctrlKey || event.metaKey) && !isMobileLayout()) {
    event.preventDefault();
    event.stopPropagation();
    toggleWorkspaceTabSelection(key);
    return;
  }
  clearWorkspaceTabSelection({render:false});
  activateTab(key);
};

beginWorkspaceTabDrag = function(event, key) {
  if (event.button !== 0 || event.target.closest(".tab-close")) return;
  if (workspaceGroupSelectionMode) return;
  if (event.ctrlKey || event.metaKey) return;
  if (workspaceTabDrag) finishWorkspaceTabDrag(null, true);
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return;
  if (pane.activeTabKey !== key || focusedPaneId !== pane.id) activateTab(key);
  const tabNode = event.currentTarget?.closest?.(".tab")
    || workspacePaneElement(pane.id)?.querySelector(`.tab[data-tab-key="${workspaceCssEscape(key)}"]`);
  if (!tabNode) return;
  workspaceTabDrag = {
    key,
    sourcePaneId:pane.id,
    tab:tabNode,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    pointerX:event.clientX,
    pointerY:event.clientY,
    pointerType:event.pointerType || "",
    dragging:false,
    ghost:null,
    autoScrollFrame:0
  };
  try { tabNode.setPointerCapture?.(event.pointerId); } catch {}
  window.addEventListener("pointermove", moveWorkspaceTabDrag, {passive:false});
  window.addEventListener("pointerup", endWorkspaceTabDrag);
  window.addEventListener("pointercancel", cancelWorkspaceTabDrag);
  window.addEventListener("keydown", handleWorkspaceTabDragKeydown);
};

function refreshWorkspaceDraggedTab(drag) {
  const pane = workspaceFindPaneForTab(drag?.key);
  const liveTab = pane
    ? workspacePaneElement(pane.id)?.querySelector(`.tab[data-tab-key="${workspaceCssEscape(drag.key)}"]`)
    : null;
  if (!liveTab || liveTab === drag.tab) return;
  drag.tab.classList.remove("tab-dragging");
  drag.tab.removeAttribute("aria-grabbed");
  drag.tab = liveTab;
  if (drag.dragging) {
    liveTab.classList.add("tab-dragging");
    liveTab.setAttribute("aria-grabbed", "true");
  }
}

moveWorkspaceTabDrag = function(event) {
  const drag = workspaceTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  refreshWorkspaceDraggedTab(drag);
  drag.pointerX = event.clientX;
  drag.pointerY = event.clientY;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.dragging) {
    if (Math.hypot(deltaX, deltaY) < WORKSPACE_TAB_DRAG_THRESHOLD) return;
    if (isMobileLayout() && drag.pointerType === "touch" && Math.abs(deltaY) > Math.abs(deltaX)) {
      return finishWorkspaceTabDrag(event, true);
    }
    drag.dragging = true;
    drag.tab.classList.add("tab-dragging");
    drag.tab.setAttribute("aria-grabbed", "true");
    document.body.classList.add("workspace-tab-drag-active");
    createWorkspaceTabDragGhost(drag);
    hideTabContextMenu();
    scheduleWorkspaceTabDockAutoScroll();
  }
  event.preventDefault();
  updateWorkspaceTabDragGhost(event.clientX, event.clientY);
  updateWorkspaceTabDropTarget(event.clientX, event.clientY);
};

function applyWorkspaceTabDrop(drag, target) {
  const sourcePane = workspaceFindPaneForTab(drag.key);
  const targetPane = workspaceFindPane(target?.paneId);
  if (!sourcePane || !targetPane || !target) return false;
  const edgeDrop = ["left", "right", "top", "bottom"].includes(target.zone);
  if (edgeDrop && sourcePane.id === targetPane.id && sourcePane.tabs.length <= 1) return false;
  const sourceIndex = sourcePane.tabs.indexOf(drag.key);
  if (sourceIndex < 0) return false;
  sourcePane.tabs.splice(sourceIndex, 1);
  if (!sourcePane.tabs.includes(sourcePane.activeTabKey)) sourcePane.activeTabKey = sourcePane.tabs[Math.min(sourceIndex, sourcePane.tabs.length - 1)] || sourcePane.tabs.at(-1) || "";

  let destinationPane = targetPane;
  if (edgeDrop) {
    const newPane = {type:"pane", id:workspaceNextPaneId(), tabs:[drag.key], activeTabKey:drag.key};
    const newFirst = ["left", "top"].includes(target.zone);
    const split = {
      type:"split",
      id:workspaceNextSplitId(),
      direction:["left", "right"].includes(target.zone) ? "row" : "column",
      ratio:0.5,
      first:newFirst ? newPane : targetPane,
      second:newFirst ? targetPane : newPane
    };
    workspaceLayout = workspaceReplacePaneWithSplit(targetPane.id, split);
    destinationPane = newPane;
  } else {
    let insertion = Number.isInteger(target.index) ? target.index : targetPane.tabs.length;
    insertion = Math.max(0, Math.min(targetPane.tabs.length, insertion));
    targetPane.tabs.splice(insertion, 0, drag.key);
    targetPane.activeTabKey = drag.key;
  }
  normalizeWorkspaceLayoutAfterMutation(destinationPane.id);
  focusedPaneId = destinationPane.id;
  activeTabKey = drag.key;
  const tab = tabs.find(item => item.key === drag.key);
  activeView = tab?.viewName || tab?.kind || "welcome";
  renderTabs();
  const sourceAfter = workspaceFindPane(sourcePane.id);
  if (sourceAfter?.activeTabKey && sourceAfter.id !== destinationPane.id) renderWorkspacePaneContent(sourceAfter.id);
  renderWorkspacePaneContent(destinationPane.id);
  revealWorkspaceTab(drag.key);
  syncFocusedWorkspaceClasses();
  return true;
}

finishWorkspaceTabDrag = function(event, cancelled) {
  const drag = workspaceTabDrag;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  window.removeEventListener("pointermove", moveWorkspaceTabDrag);
  window.removeEventListener("pointerup", endWorkspaceTabDrag);
  window.removeEventListener("pointercancel", cancelWorkspaceTabDrag);
  window.removeEventListener("keydown", handleWorkspaceTabDragKeydown);
  if (drag.autoScrollFrame) cancelAnimationFrame(drag.autoScrollFrame);
  try {
    if (drag.tab.hasPointerCapture?.(drag.pointerId)) drag.tab.releasePointerCapture(drag.pointerId);
  } catch {}
  const target = workspaceTabDropTarget;
  document.body.classList.remove("workspace-tab-drag-active");
  drag.tab.classList.remove("tab-dragging");
  drag.tab.removeAttribute("aria-grabbed");
  drag.ghost?.remove();
  workspaceClearDropIndicators();
  const dragged = drag.dragging;
  workspaceTabDrag = null;
  workspaceTabSuppressClickUntil = Date.now() + 350;
  if (!dragged) return;
  const applied = !cancelled && applyWorkspaceTabDrop(drag, target);
  if (!applied) renderTabs();
};

function beginWorkspaceSplitterDrag(event, splitId) {
  if (event.button !== 0 || isMobileLayout()) return;
  const split = workspaceFindSplit(splitId);
  const element = event.currentTarget.closest(".workspace-split");
  if (!split || !element) return;
  event.preventDefault();
  workspaceSplitterDrag = {splitId, pointerId:event.pointerId, element, separator:event.currentTarget};
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("workspace-split-resizing", split.direction === "row" ? "workspace-split-resizing-row" : "workspace-split-resizing-column");
  window.addEventListener("pointermove", moveWorkspaceSplitterDrag, {passive:false});
  window.addEventListener("pointerup", endWorkspaceSplitterDrag);
  window.addEventListener("pointercancel", endWorkspaceSplitterDrag);
}

function moveWorkspaceSplitterDrag(event) {
  const drag = workspaceSplitterDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const split = workspaceFindSplit(drag.splitId);
  if (!split) return;
  const rect = drag.element.getBoundingClientRect();
  const raw = split.direction === "row"
    ? (event.clientX - rect.left) / Math.max(1, rect.width)
    : (event.clientY - rect.top) / Math.max(1, rect.height);
  split.ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, raw));
  applyWorkspaceSplitGeometry(drag.element, split);
  event.preventDefault();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function endWorkspaceSplitterDrag(event) {
  const drag = workspaceSplitterDrag;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveWorkspaceSplitterDrag);
  window.removeEventListener("pointerup", endWorkspaceSplitterDrag);
  window.removeEventListener("pointercancel", endWorkspaceSplitterDrag);
  try {
    if (drag.separator.hasPointerCapture?.(drag.pointerId)) drag.separator.releasePointerCapture(drag.pointerId);
  } catch {}
  workspaceSplitterDrag = null;
  document.body.classList.remove("workspace-split-resizing", "workspace-split-resizing-row", "workspace-split-resizing-column");
  saveTabsState();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function setWorkspaceSplitRatio(splitId, ratio) {
  const split = workspaceFindSplit(splitId);
  if (!split) return;
  split.ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, ratio));
  const element = document.querySelector(`.workspace-split[data-split-id="${workspaceCssEscape(splitId)}"]`);
  if (element) applyWorkspaceSplitGeometry(element, split);
  saveTabsState();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function handleWorkspaceSplitterKey(event, splitId) {
  const split = workspaceFindSplit(splitId);
  if (!split) return;
  const relevant = split.direction === "row" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (!relevant.includes(event.key)) return;
  event.preventDefault();
  const decrease = ["ArrowLeft", "ArrowUp"].includes(event.key);
  setWorkspaceSplitRatio(splitId, split.ratio + (decrease ? -0.025 : 0.025));
}

function serializeWorkspaceLayout(node=workspaceLayout) {
  if (!node) return null;
  if (node.type === "pane") return {type:"pane", id:node.id, tabs:[...node.tabs], activeTabKey:node.activeTabKey};
  return {
    type:"split",
    id:node.id,
    direction:node.direction,
    ratio:node.ratio,
    first:serializeWorkspaceLayout(node.first),
    second:serializeWorkspaceLayout(node.second)
  };
}

function serializeWorkspaceGroupsForPreset() {
  captureCurrentWorkspaceGroup();
  return workspaceGroups.map(group => ({
    id:group.id,
    name:group.name,
    tabs:(group.tabs || []).map(workspaceGroupPersistableTab).filter(Boolean),
    layout:group.layout ? JSON.parse(JSON.stringify(group.layout)) : null,
    activeTabKey:group.activeTabKey || "",
    focusedPaneId:group.focusedPaneId || "pane-1"
  }));
}

function applyWorkspaceGroupPreset(saved={}) {
  workspacePaneTabHistory.clear();
  const hasGroups = Array.isArray(saved.workspaceGroups) && saved.workspaceGroups.length > 0;
  restoreWorkspaceGroups(hasGroups ? saved : {
    ...saved,
    workspaceGroups:[],
    activeWorkspaceGroupId:WORKSPACE_GROUP_MAIN_ID
  });
  let target = currentWorkspaceGroup();
  if (!target?.tabs?.length) {
    target = workspaceGroups.find(group => group.tabs?.length) || target;
    if (target) activeWorkspaceGroupId = target.id;
  }
  if (!target) return null;
  applyWorkspaceGroupState(target);
  saveTabsState();
  revealWorkspaceTab(activeTabKey);
  return target;
}

persistableTabs = function() {
  return tabs.map(workspaceGroupPersistableTab).filter(Boolean);
};

saveTabsState = function() {
  if (window.workspaceRestorePending) return;
  try {
    captureCurrentWorkspaceGroup();
    const groups = workspaceGroups.map(group => ({
      id:group.id,
      name:group.name,
      tabs:(group.tabs || []).map(workspaceGroupPersistableTab).filter(Boolean),
      layout:group.layout,
      activeTabKey:group.activeTabKey,
      focusedPaneId:group.focusedPaneId
    }));
    const activeGroup = groups.find(group => group.id === activeWorkspaceGroupId) || groups[0];
    localStorage.setItem("workspaceTabs", JSON.stringify({
      version:WORKSPACE_LAYOUT_VERSION,
      workspaceGroupsVersion:WORKSPACE_GROUP_STORAGE_VERSION,
      activeWorkspaceGroupId,
      workspaceGroups:groups,
      activeTabKey:activeGroup?.activeTabKey || activeTabKey,
      focusedPaneId:activeGroup?.focusedPaneId || focusedPaneId,
      tabs:activeGroup?.tabs || persistableTabs(),
      layout:activeGroup?.layout || serializeWorkspaceLayout()
    }));
  } catch {}
};

function restoreWorkspaceGroups(saved) {
  const storedGroups = Array.isArray(saved.workspaceGroups) ? saved.workspaceGroups : [];
  const usedGroupIds = new Set();
  const restoredGroups = [];
  for (const stored of storedGroups) {
    if (!stored || typeof stored !== "object") continue;
    let groupId = typeof stored.id === "string" && stored.id ? stored.id : nextWorkspaceGroupId();
    if (usedGroupIds.has(groupId)) groupId = nextWorkspaceGroupId();
    usedGroupIds.add(groupId);
    const serial = Number(groupId.match(/(\d+)$/)?.[1] || 0);
    workspaceGroupSerial = Math.max(workspaceGroupSerial, serial);
    const groupTabs = [];
    const groupTabKeys = new Set();
    for (const tab of Array.isArray(stored.tabs) ? stored.tabs : []) {
      if (!tab || typeof tab !== "object" || typeof tab.key !== "string" || !tab.key || !tab.kind || groupTabKeys.has(tab.key)) continue;
      groupTabs.push({...tab});
      groupTabKeys.add(tab.key);
    }
    restoredGroups.push({
      id:groupId,
      name:String(stored.name || (groupId === WORKSPACE_GROUP_MAIN_ID ? "主工作区" : defaultWorkspaceGroupName())).trim() || "工作区",
      tabs:groupTabs,
      layout:stored.layout || null,
      activeTabKey:groupTabs.some(tab => tab.key === stored.activeTabKey) ? stored.activeTabKey : groupTabs[0]?.key || "",
      focusedPaneId:typeof stored.focusedPaneId === "string" ? stored.focusedPaneId : "pane-1"
    });
  }
  if (!restoredGroups.length) {
    const legacyTabs = [];
    const legacyKeys = new Set();
    for (const tab of Array.isArray(saved.tabs) ? saved.tabs : []) {
      if (!tab || typeof tab !== "object" || typeof tab.key !== "string" || !tab.key || !tab.kind || legacyKeys.has(tab.key)) continue;
      legacyTabs.push({...tab});
      legacyKeys.add(tab.key);
    }
    restoredGroups.push({
      id:WORKSPACE_GROUP_MAIN_ID,
      name:"主工作区",
      tabs:legacyTabs,
      layout:saved.layout || null,
      activeTabKey:legacyTabs.some(tab => tab.key === saved.activeTabKey) ? saved.activeTabKey : legacyTabs[0]?.key || "",
      focusedPaneId:typeof saved.focusedPaneId === "string" ? saved.focusedPaneId : "pane-1"
    });
  }
  if (!restoredGroups.some(group => group.id === WORKSPACE_GROUP_MAIN_ID)) {
    restoredGroups.unshift({id:WORKSPACE_GROUP_MAIN_ID, name:"主工作区", tabs:[], layout:null, activeTabKey:"", focusedPaneId:"pane-1"});
  }
  workspaceGroups = restoredGroups;
  activeWorkspaceGroupId = workspaceGroups.some(group => group.id === saved.activeWorkspaceGroupId)
    ? saved.activeWorkspaceGroupId
    : workspaceGroups.find(group => group.tabs.length)?.id || WORKSPACE_GROUP_MAIN_ID;
  return currentWorkspaceGroup();
}

function restoreWorkspaceLayoutNode(saved, validKeys, usedKeys, usedPaneIds, usedSplitIds, depth=0, budget={count:0}) {
  if (!saved || typeof saved !== "object") return null;
  budget.count += 1;
  if (depth > WORKSPACE_MAX_RESTORE_DEPTH || budget.count > WORKSPACE_MAX_RESTORE_NODES) return null;
  if (saved.type === "pane") {
    let paneId = typeof saved.id === "string" && saved.id ? saved.id : workspaceNextPaneId();
    if (usedPaneIds.has(paneId)) paneId = workspaceNextPaneId();
    usedPaneIds.add(paneId);
    const serial = Number(paneId.match(/(\d+)$/)?.[1] || 0);
    workspacePaneSerial = Math.max(workspacePaneSerial, serial);
    const paneTabs = (Array.isArray(saved.tabs) ? saved.tabs : []).filter(key => {
      if (!validKeys.has(key) || usedKeys.has(key)) return false;
      usedKeys.add(key);
      return true;
    });
    if (!paneTabs.length) return null;
    const activeKey = paneTabs.includes(saved.activeTabKey) ? saved.activeTabKey : paneTabs[0];
    return {type:"pane", id:paneId, tabs:paneTabs, activeTabKey:activeKey};
  }
  if (saved.type !== "split") return null;
  let splitId = typeof saved.id === "string" && saved.id ? saved.id : workspaceNextSplitId();
  if (usedSplitIds.has(splitId)) splitId = workspaceNextSplitId();
  usedSplitIds.add(splitId);
  const serial = Number(splitId.match(/(\d+)$/)?.[1] || 0);
  workspaceSplitSerial = Math.max(workspaceSplitSerial, serial);
  const first = restoreWorkspaceLayoutNode(saved.first, validKeys, usedKeys, usedPaneIds, usedSplitIds, depth + 1, budget);
  const second = restoreWorkspaceLayoutNode(saved.second, validKeys, usedKeys, usedPaneIds, usedSplitIds, depth + 1, budget);
  if (!first) return second;
  if (!second) return first;
  return {
    type:"split",
    id:splitId,
    direction:saved.direction === "column" ? "column" : "row",
    ratio:Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, Number(saved.ratio) || 0.5)),
    first,
    second
  };
}

restoreTabsState = function() {
  const previousState = {
    tabs,
    workspaceLayout,
    focusedPaneId,
    activeTabKey,
    activeView,
    workspaceGroups,
    activeWorkspaceGroupId
  };
  try {
    if (runtimeSettings?.saved?.restore_workspace_tabs === false) return false;
    workspacePaneTabHistory.clear();
    const saved = JSON.parse(localStorage.getItem("workspaceTabs") || "{}");
    const activeGroup = restoreWorkspaceGroups(saved);
    const restored = activeGroup?.tabs || [];
    if (!restored.length) return false;
    window.restoringTabs = true;
    tabs = [...restored];
    const validKeys = new Set(restored.map(tab => tab.key));
    const usedKeys = new Set();
    const restoredLayout = restoreWorkspaceLayoutNode(activeGroup.layout, validKeys, usedKeys, new Set(), new Set());
    workspaceLayout = restoredLayout || {type:"pane", id:"pane-1", tabs:[], activeTabKey:""};
    const firstPane = workspaceLeaves()[0];
    for (const tab of restored) {
      if (usedKeys.has(tab.key)) continue;
      firstPane.tabs.push(tab.key);
      usedKeys.add(tab.key);
    }
    if (!firstPane.activeTabKey || !firstPane.tabs.includes(firstPane.activeTabKey)) firstPane.activeTabKey = firstPane.tabs[0];
    focusedPaneId = workspaceFindPane(activeGroup.focusedPaneId)?.id
      || workspaceFindPaneForTab(activeGroup.activeTabKey)?.id
      || firstPane.id;
    const focusedPane = workspaceFindPane(focusedPaneId);
    if (focusedPane.tabs.includes(activeGroup.activeTabKey)) focusedPane.activeTabKey = activeGroup.activeTabKey;
    activeTabKey = focusedPane.activeTabKey;
    const activeTab = tabs.find(tab => tab.key === activeTabKey);
    activeView = activeTab?.viewName || activeTab?.kind || "welcome";
    renderTabs();
    const leaves = workspaceVisiblePanes();
    for (const pane of leaves.filter(pane => pane.id !== focusedPaneId)) renderWorkspacePaneContent(pane.id);
    renderWorkspacePaneContent(focusedPaneId);
    window.restoringTabs = false;
    saveTabsState();
    syncFocusedWorkspaceClasses();
    syncWorkspaceToolbarPlacements();
    captureCurrentWorkspaceGroup();
    renderWorkspaceGroupBar();
    return true;
  } catch (error) {
    console.error("restore workspace layout failed", error);
    tabs = previousState.tabs;
    workspaceLayout = previousState.workspaceLayout;
    focusedPaneId = previousState.focusedPaneId;
    activeTabKey = previousState.activeTabKey;
    activeView = previousState.activeView;
    workspaceGroups = previousState.workspaceGroups;
    activeWorkspaceGroupId = previousState.activeWorkspaceGroupId;
    window.restoringTabs = false;
    return false;
  }
};

syncResponsivePane = function() {
  const wasMobile = responsiveLayoutMobile;
  legacyWorkspaceApi.syncResponsivePane();
  if (wasMobile !== isMobileLayout()) {
    renderTabs();
    const focusedPane = workspaceFindPane(focusedPaneId);
    for (const pane of workspaceVisiblePanes()) {
      if (pane.id !== focusedPane?.id && pane.activeTabKey) renderWorkspacePaneContent(pane.id);
    }
    if (focusedPane?.activeTabKey) renderWorkspacePaneContent(focusedPane.id);
  }
};

function restoreLegacyWorkspaceApi() {
  renderTabs = legacyWorkspaceApi.renderTabs;
  updateWorkspaceTabScrollControls = legacyWorkspaceApi.updateWorkspaceTabScrollControls;
  scrollWorkspaceTabs = legacyWorkspaceApi.scrollWorkspaceTabs;
  handleWorkspaceTabsWheel = legacyWorkspaceApi.handleWorkspaceTabsWheel;
  revealWorkspaceTab = legacyWorkspaceApi.revealWorkspaceTab;
  addTab = legacyWorkspaceApi.addTab;
  setWorkspaceTabConnectionStatus = legacyWorkspaceApi.setWorkspaceTabConnectionStatus;
  renderTabContent = legacyWorkspaceApi.renderTabContent;
  activateTab = legacyWorkspaceApi.activateTab;
  setWorkspace = legacyWorkspaceApi.setWorkspace;
  closeTab = legacyWorkspaceApi.closeTab;
  closeTabsByKey = legacyWorkspaceApi.closeTabsByKey;
  closeTabsByMode = legacyWorkspaceApi.closeTabsByMode;
  moveWorkspaceTab = legacyWorkspaceApi.moveWorkspaceTab;
  showTabContextMenu = legacyWorkspaceApi.showTabContextMenu;
  beginWorkspaceTabDrag = legacyWorkspaceApi.beginWorkspaceTabDrag;
  moveWorkspaceTabDrag = legacyWorkspaceApi.moveWorkspaceTabDrag;
  finishWorkspaceTabDrag = legacyWorkspaceApi.finishWorkspaceTabDrag;
  persistableTabs = legacyWorkspaceApi.persistableTabs;
  saveTabsState = legacyWorkspaceApi.saveTabsState;
  restoreTabsState = legacyWorkspaceApi.restoreTabsState;
  syncResponsivePane = legacyWorkspaceApi.syncResponsivePane;
}

initWorkspaceChromeSizing();

window.addEventListener("resize", () => requestAnimationFrame(() => {
  for (const pane of workspaceVisiblePanes()) {
    updateWorkspaceTabScrollControls(pane.id);
    if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
  }
}));

if (workspaceDockElement()) {
  ensureWorkspacePaneElement("pane-1");
  renderWorkspaceLayout();
} else {
  restoreLegacyWorkspaceApi();
}
