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
    const storedName = normalizedWorkspaceGroupStoredName(groupId, stored.name);
    restoredGroups.push({
      id:groupId,
      name:storedName || (groupId === WORKSPACE_GROUP_MAIN_ID ? "" : defaultWorkspaceGroupName()),
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
      name:"",
      tabs:legacyTabs,
      layout:saved.layout || null,
      activeTabKey:legacyTabs.some(tab => tab.key === saved.activeTabKey) ? saved.activeTabKey : legacyTabs[0]?.key || "",
      focusedPaneId:typeof saved.focusedPaneId === "string" ? saved.focusedPaneId : "pane-1"
    });
  }
  if (!restoredGroups.some(group => group.id === WORKSPACE_GROUP_MAIN_ID)) {
    restoredGroups.unshift({id:WORKSPACE_GROUP_MAIN_ID, name:"", tabs:[], layout:null, activeTabKey:"", focusedPaneId:"pane-1"});
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

if (typeof registerTermaAction === "function") {
registerTermaAction("workspace-group-switch", ({element}) => switchWorkspaceGroup(element.dataset.workspaceGroupId));
registerTermaAction("workspace-group-menu", ({event, element}) => showWorkspaceGroupContextMenu(event, element.dataset.workspaceGroupId));
registerTermaAction("workspace-group-drag-start", ({event, element}) => beginWorkspaceGroupDrag(event, element.dataset.workspaceGroupId, element));
registerTermaAction("workspace-group-drag-over", ({event, element}) => moveWorkspaceGroupDrag(event, element.dataset.workspaceGroupId));
registerTermaAction("workspace-group-drop", ({event, element}) => dropWorkspaceGroup(event, element.dataset.workspaceGroupId, element));
registerTermaAction("workspace-group-drag-end", () => endWorkspaceGroupDrag());
registerTermaAction("workspace-group-selection-confirm", () => confirmWorkspaceGroupSelection());
registerTermaAction("workspace-group-selection-cancel", () => cancelWorkspaceGroupSelection());
}
