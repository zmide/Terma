const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadDockingModel() {
  const storage = new Map();
  const noop = () => {};
  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    CSS:{escape:value => String(value)},
    tabs:[],
    activeTabKey:"",
    activeView:"welcome",
    selectedId:null,
    responsiveLayoutMobile:false,
    runtimeSettings:{saved:{restore_workspace_tabs:true}},
    terminalSessions:new Map(),
    sftpDisconnectedTabs:new Set(),
    sftpViewStates:new Map(),
    workspaceTabDrag:null,
    workspaceTabSuppressClickUntil:0,
    window:{restoringTabs:false, addEventListener:noop, removeEventListener:noop},
    document:{
      getElementById:() => null,
      querySelector:() => null,
      querySelectorAll:() => [],
      body:{classList:{add:noop, remove:noop, toggle:noop}, appendChild:noop}
    },
    localStorage:{
      getItem:key => storage.get(key) || null,
      setItem:(key, value) => storage.set(key, String(value))
    },
    requestAnimationFrame:callback => { callback(); return 1; },
    cancelAnimationFrame:noop,
    icon:() => "",
    esc:value => String(value),
    escAttr:value => String(value),
    notify:noop,
    hideTabContextMenu:noop,
    closeTerminalSession:noop,
    closeSftpSession:noop,
    stopBatchCommand:noop,
    renderWelcome:noop,
    openTerminal:noop,
    openForwards:noop,
    editConnection:noop,
    showImport:noop,
    openLog:noop,
    openBatchCommand:noop,
    openSftp:noop,
    openServerDashboard:noop,
    openSettings:noop,
    syncTerminalToolbarPlacement:noop,
    syncSftpToolbarPlacement:noop,
    showMobileWorkspace:noop,
    renderTabs:noop,
    updateWorkspaceTabScrollControls:noop,
    scrollWorkspaceTabs:noop,
    handleWorkspaceTabsWheel:noop,
    revealWorkspaceTab:noop,
    addTab:noop,
    setWorkspaceTabConnectionStatus:noop,
    renderTabContent:noop,
    activateTab:noop,
    setWorkspace:noop,
    closeTab:noop,
    closeTabsByKey:noop,
    closeTabsByMode:noop,
    moveWorkspaceTab:noop,
    showTabContextMenu:noop,
    beginWorkspaceTabDrag:noop,
    moveWorkspaceTabDrag:noop,
    finishWorkspaceTabDrag:noop,
    persistableTabs:() => [],
    saveTabsState:noop,
    restoreTabsState:noop,
    syncResponsivePane:noop
  };
  sandbox.selectConnection = id => {
    sandbox.selectedId = id;
    return {id};
  };
  sandbox.openLinuxDesktopManager = (connectionId, updateTab) => {
    sandbox.linuxDesktopManagerOpen = {connectionId, updateTab};
  };
  sandbox.isMobileLayout = () => sandbox.__mobile === true;
  sandbox.globalThis = sandbox;

  const filename = path.join(root, "public", "app-docking.js");
  const source = fs.readFileSync(filename, "utf8")
    .replace(/\r?\nif \(workspaceDockElement\(\)\) \{[\s\S]*?\}\s*else\s*\{[\s\S]*?\}\s*$/, "")
    + `\n;globalThis.__dockingModel = {
      workspaceLeaves,
      workspaceFindPane,
      workspaceFindSplit,
      workspaceReplacePaneWithSplit,
      pruneWorkspaceLayout,
      workspaceFilterLayout,
      workspaceAllTabs,
      workspaceTabByKey,
      workspaceHasTabKey,
      serializeWorkspaceLayout,
      restoreWorkspaceLayoutNode,
      workspaceDropZoneAtPoint,
      workspaceToolbarPlacementForTab,
      returnWorkspaceToolbarToMount,
      workspaceVisiblePanes,
      setWorkspaceSplitRatio,
      focusWorkspacePane,
      duplicateWorkspaceTab,
      captureCurrentWorkspaceGroup,
      serializeWorkspaceGroupsForPreset,
      applyWorkspaceGroupPreset,
      restoreWorkspaceGroups,
      switchWorkspaceGroup,
      beginWorkspaceGroupSelection,
      cancelWorkspaceGroupSelection,
      activateWorkspaceTabFromClick,
      beginWorkspaceGroupDrag,
      dropWorkspaceGroup,
      addTab,
      setWorkspaceTabConnectionStatus,
      renderTabContent,
      activateTab,
      closeTabsByKey,
      setLayout:value => { workspaceLayout = value; },
      getLayout:() => workspaceLayout,
      setFocusedPane:value => { focusedPaneId = value; },
      getFocusedPane:() => focusedPaneId,
      setTabs:value => { tabs = value; },
      getTabs:() => tabs,
      setWorkspaceGroups:(value, activeId) => { workspaceGroups = value; activeWorkspaceGroupId = activeId; },
      getWorkspaceGroups:() => workspaceGroups,
      getActiveWorkspaceGroupId:() => activeWorkspaceGroupId,
      getWorkspaceGroupSelectionMode:() => workspaceGroupSelectionMode,
      getWorkspaceSelectedTabKeys:() => [...workspaceSelectedTabKeys],
      resetSerials:() => { workspacePaneSerial = 1; workspaceSplitSerial = 0; }
    };`;

  vm.runInNewContext(source, sandbox, {filename, timeout:5000});
  return {api:sandbox.__dockingModel, sandbox, storage};
}

function loadLegacyWorkspaceModel() {
  const noop = () => {};
  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    tabs:[],
    activeTabKey:"",
    activeView:"welcome",
    responsiveLayoutMobile:false,
    terminalSessions:new Map(),
    sftpDisconnectedTabs:new Set(),
    sftpViewStates:new Map(),
    isMobileLayout:() => false,
    requestAnimationFrame:callback => { callback(); return 1; },
    cancelAnimationFrame:noop,
    localStorage:{getItem:() => null, setItem:noop},
    window:{addEventListener:noop, removeEventListener:noop},
    document:{body:{classList:{add:noop, remove:noop, toggle:noop}}}
  };
  sandbox.globalThis = sandbox;

  const filename = path.join(root, "public", "app-workspace.js");
  const source = fs.readFileSync(filename, "utf8")
    .replace(/\r?\ninitActivityBarSizing\(\);\r?\ninitOperationPaneSizing\(\);\s*$/, "")
    + `\nrenderTabs = () => {};
      revealWorkspaceTab = () => {};
      renderTabContent = () => {};
      renderWelcome = () => {};
      closeTerminalSession = () => {};
      globalThis.__legacyWorkspaceModel = {
        addTab,
        activateTab,
        closeTabsByKey,
        getTabs:() => tabs,
        getActiveTabKey:() => activeTabKey
      };`;

  vm.runInNewContext(source, sandbox, {filename, timeout:5000});
  return sandbox.__legacyWorkspaceModel;
}

function pane(id, tabs=[]) {
  return {type:"pane", id, tabs:[...tabs], activeTabKey:tabs[0] || ""};
}

function split(id, direction, first, second, ratio=0.5) {
  return {type:"split", id, direction, ratio, first, second};
}

function fakePane(rect, tabRects=[]) {
  const tabNodes = tabRects.map(tabRect => ({
    getBoundingClientRect:() => ({
      ...tabRect,
      right:tabRect.right ?? tabRect.left + tabRect.width
    })
  }));
  const tabsShell = {
    getBoundingClientRect:() => ({left:rect.left, right:rect.right, top:-32, bottom:-1, width:rect.width, height:31}),
    querySelectorAll:() => tabNodes
  };
  const workspace = {getBoundingClientRect:() => rect};
  return {querySelector:selector => selector === ".tabs-shell" ? tabsShell : selector === ".workspace" ? workspace : null};
}

function runWorkspaceDockingChecks({silent=false}={}) {
  const checks = [];
  const check = (name, task) => {
    try {
      task();
      checks.push({name, pass:true});
      if (!silent) console.log(`[OK] ${name}`);
    } catch (error) {
      checks.push({name, pass:false, detail:error.message});
      if (!silent) console.error(`[FAIL] ${name} - ${error.message}`);
    }
  };

  const {api, sandbox, storage} = loadDockingModel();

  check("nested pane and split trees remain addressable", () => {
    const layout = split("split-1", "row", pane("pane-1", ["terminal-1"]), split(
      "split-2",
      "column",
      pane("pane-2", ["sftp-1"]),
      pane("pane-3", ["settings"]),
      0.6
    ));
    api.setLayout(layout);
    assert.equal(api.workspaceLeaves().map(item => item.id).join(","), "pane-1,pane-2,pane-3");
    assert.equal(api.workspaceFindPane("pane-3").activeTabKey, "settings");
    assert.equal(api.workspaceFindSplit("split-2").direction, "column");

    const nested = split("split-3", "column", pane("pane-4", ["terminal-2"]), layout.first);
    api.setLayout(api.workspaceReplacePaneWithSplit("pane-1", nested));
    assert.equal(api.workspaceLeaves().map(item => item.id).join(","), "pane-4,pane-1,pane-2,pane-3");
  });

  check("Linux desktop manager tabs restore their content and legacy connection id", () => {
    api.renderTabContent({key:"linux-desktop-17", kind:"linux-desktop", id:17});
    assert.equal(sandbox.linuxDesktopManagerOpen.connectionId, 17);
    assert.equal(sandbox.linuxDesktopManagerOpen.updateTab, false);

    api.renderTabContent({key:"linux-desktop-29", kind:"linux-desktop"});
    assert.equal(sandbox.linuxDesktopManagerOpen.connectionId, 29);
    assert.equal(sandbox.linuxDesktopManagerOpen.updateTab, false);

    api.renderTabContent({key:"linux-desktop-select", kind:"linux-desktop"});
    assert.equal(sandbox.linuxDesktopManagerOpen.connectionId, 0);
  });

  check("empty panes collapse without flattening surviving nested splits", () => {
    const layout = split(
      "split-1",
      "row",
      pane("empty"),
      split("split-2", "column", pane("pane-2", ["a"]), pane("pane-3", ["b"]))
    );
    const pruned = api.pruneWorkspaceLayout(layout);
    assert.equal(pruned.id, "split-2");
    assert.equal(api.workspaceLeaves(pruned).map(item => item.id).join(","), "pane-2,pane-3");
  });

  check("workspace groups keep only their selected tabs while preserving internal splits", () => {
    const layout = split(
      "split-groups",
      "row",
      pane("pane-group-left", ["a", "b"]),
      pane("pane-group-right", ["c"])
    );
    const selected = api.workspaceFilterLayout(layout, new Set(["b", "c"]));
    const remaining = api.workspaceFilterLayout(layout, new Set(["a"]));
    assert.equal(selected.type, "split");
    assert.equal(api.workspaceLeaves(selected).map(item => item.tabs.join(",")).join("|"), "b|c");
    assert.equal(remaining.type, "pane");
    assert.equal(remaining.tabs.join(","), "a");
  });

  check("explicit workspace composition mode supports empty entry, left-click toggles and cancel", () => {
    api.setTabs([{key:"a", kind:"terminal"},{key:"b", kind:"sftp"}]);
    api.setLayout(pane("pane-select", ["a", "b"]));
    api.beginWorkspaceGroupSelection();
    assert.equal(api.getWorkspaceGroupSelectionMode(), true);
    assert.equal(api.getWorkspaceSelectedTabKeys().join(","), "");
    const click = {preventDefault:() => {}, stopPropagation:() => {}, ctrlKey:false, metaKey:false};
    api.activateWorkspaceTabFromClick(click, "a");
    api.activateWorkspaceTabFromClick(click, "b");
    assert.equal(api.getWorkspaceSelectedTabKeys().join(","), "a,b");
    api.activateWorkspaceTabFromClick(click, "a");
    assert.equal(api.getWorkspaceSelectedTabKeys().join(","), "b");
    api.cancelWorkspaceGroupSelection();
    assert.equal(api.getWorkspaceGroupSelectionMode(), false);
    assert.equal(api.getWorkspaceSelectedTabKeys().join(","), "");
  });

  check("workspace group drag sorting changes and persists group order", () => {
    const groups = [
      {id:"workspace-main", name:"Main", tabs:[{key:"a", kind:"terminal"}], layout:pane("pane-a", ["a"]), activeTabKey:"a", focusedPaneId:"pane-a"},
      {id:"workspace-group-1", name:"One", tabs:[{key:"b", kind:"sftp"}], layout:pane("pane-b", ["b"]), activeTabKey:"b", focusedPaneId:"pane-b"},
      {id:"workspace-group-2", name:"Two", tabs:[{key:"c", kind:"terminal"}], layout:pane("pane-c", ["c"]), activeTabKey:"c", focusedPaneId:"pane-c"}
    ];
    api.setWorkspaceGroups(groups, "workspace-main");
    api.setTabs(groups[0].tabs);
    api.setLayout(groups[0].layout);
    api.setFocusedPane("pane-a");
    sandbox.activeTabKey = "a";
    const classList = {add:() => {}, remove:() => {}};
    api.beginWorkspaceGroupDrag({stopPropagation:() => {}, dataTransfer:{setData:() => {}}, currentTarget:{classList}}, "workspace-group-2");
    api.dropWorkspaceGroup({preventDefault:() => {}, stopPropagation:() => {}, clientX:0, currentTarget:{closest:() => ({getBoundingClientRect:() => ({left:0, width:100})})}}, "workspace-main");
    assert.equal(api.getWorkspaceGroups().map(group => group.id).join(","), "workspace-group-2,workspace-main,workspace-group-1");
    const saved = JSON.parse(storage.get("workspaceTabs"));
    assert.equal(saved.workspaceGroups.map(group => group.id).join(","), "workspace-group-2,workspace-main,workspace-group-1");
  });

  check("switching workspace groups captures the old layout and restores the target independently", () => {
    sandbox.__mobile = false;
    const groupA = {
      id:"workspace-main",
      name:"Main",
      tabs:[{key:"a", kind:"terminal", title:"A"}],
      layout:pane("pane-a", ["a"]),
      activeTabKey:"a",
      focusedPaneId:"pane-a"
    };
    const groupB = {
      id:"workspace-group-1",
      name:"Ops",
      tabs:[{key:"b", kind:"sftp", title:"B"}],
      layout:pane("pane-b", ["b"]),
      activeTabKey:"b",
      focusedPaneId:"pane-b"
    };
    api.setWorkspaceGroups([groupA, groupB], groupA.id);
    api.setTabs(groupA.tabs);
    api.setLayout(groupA.layout);
    api.setFocusedPane("pane-a");
    sandbox.activeTabKey = "a";

    api.switchWorkspaceGroup(groupB.id, {notify:false});

    assert.equal(api.getActiveWorkspaceGroupId(), groupB.id);
    assert.equal(api.getTabs().map(tab => tab.key).join(","), "b");
    assert.equal(api.workspaceLeaves().map(item => item.id).join(","), "pane-b");
    assert.equal(api.getWorkspaceGroups()[0].tabs.map(tab => tab.key).join(","), "a");
    const saved = JSON.parse(storage.get("workspaceTabs"));
    assert.equal(saved.activeWorkspaceGroupId, groupB.id);
    assert.equal(saved.workspaceGroups.length, 2);
    assert.equal(saved.workspaceGroups[0].tabs[0].key, "a");
  });

  check("stateless singleton tab keys can persist independently in different workspace groups", () => {
    const restored = api.restoreWorkspaceGroups({
      activeWorkspaceGroupId:"workspace-main",
      workspaceGroups:[
        {id:"workspace-main", name:"Main", tabs:[{key:"settings", kind:"settings"}]},
        {id:"workspace-group-2", name:"Other", tabs:[{key:"settings", kind:"settings"}]}
      ]
    });
    assert.equal(restored.tabs[0].key, "settings");
    assert.equal(api.getWorkspaceGroups()[1].tabs[0].key, "settings");
  });

  check("background sessions can resolve and update tabs in inactive workspace groups", () => {
    const active = {id:"workspace-main", name:"Main", tabs:[{key:"active", kind:"terminal"}], layout:pane("pane-active", ["active"]), activeTabKey:"active", focusedPaneId:"pane-active"};
    const hidden = {id:"workspace-group-3", name:"Hidden", tabs:[{key:"hidden", kind:"sftp", connectionStatus:"connecting"}], layout:pane("pane-hidden", ["hidden"]), activeTabKey:"hidden", focusedPaneId:"pane-hidden"};
    api.setWorkspaceGroups([active, hidden], active.id);
    api.setTabs(active.tabs);
    api.setLayout(active.layout);
    api.setFocusedPane("pane-active");
    sandbox.activeTabKey = "active";

    assert.equal(api.workspaceHasTabKey("hidden"), true);
    assert.equal(api.workspaceTabByKey("hidden").kind, "sftp");
    assert.equal(api.workspaceAllTabs().map(tab => tab.key).join(","), "active,hidden");
    api.setWorkspaceTabConnectionStatus("hidden", "connected");
    assert.equal(hidden.tabs[0].connectionStatus, "connected");
  });

  check("workspace group presets preserve order, names and recursive split trees", () => {
    const first = {
      id:"workspace-main",
      name:"主工作区",
      tabs:[{key:"a", kind:"terminal", title:"A"}],
      layout:pane("pane-a", ["a"]),
      activeTabKey:"a",
      focusedPaneId:"pane-a"
    };
    const second = {
      id:"workspace-group-9",
      name:"开发组",
      tabs:[{key:"b", kind:"sftp", title:"B"},{key:"c", kind:"terminal", title:"C"}],
      layout:split("split-preset", "row", pane("pane-b", ["b"]), pane("pane-c", ["c"])),
      activeTabKey:"c",
      focusedPaneId:"pane-c"
    };
    api.setWorkspaceGroups([first, second], second.id);
    api.setTabs(second.tabs);
    api.setLayout(second.layout);
    api.setFocusedPane("pane-c");
    sandbox.activeTabKey = "c";
    const preset = api.serializeWorkspaceGroupsForPreset();
    assert.deepEqual(preset.map(group => group.name), ["主工作区", "开发组"]);
    assert.equal(preset[1].layout.type, "split");
    assert.equal(preset[1].layout.first.tabs[0], "b");
    api.applyWorkspaceGroupPreset({workspaceGroups:preset, activeWorkspaceGroupId:"workspace-group-9"});
    assert.equal(api.getActiveWorkspaceGroupId(), "workspace-group-9");
    assert.equal(api.getWorkspaceGroups()[1].name, "开发组");
    assert.equal(api.workspaceLeaves().map(item => item.id).join(","), "pane-b,pane-c");
  });

  check("recursive layouts serialize and restore with bounded ratios", () => {
    const layout = split(
      "split-10",
      "row",
      pane("pane-10", ["a"]),
      split("split-11", "column", pane("pane-11", ["b"]), pane("pane-12", ["c"]), 0.74),
      0.22
    );
    api.setLayout(layout);
    const saved = api.serializeWorkspaceLayout();
    const restored = api.restoreWorkspaceLayoutNode(
      {...saved, ratio:99},
      new Set(["a", "b", "c"]),
      new Set(),
      new Set(),
      new Set()
    );
    assert.equal(restored.ratio, 0.85);
    assert.equal(restored.second.direction, "column");
    assert.equal(api.workspaceLeaves(restored).map(item => item.activeTabKey).join(","), "a,b,c");
  });

  check("all four pane-edge drop zones can create another split", () => {
    sandbox.__mobile = false;
    const target = fakePane({left:0, right:100, top:0, bottom:100, width:100, height:100});
    assert.equal(api.workspaceDropZoneAtPoint(target, 5, 50).zone, "left");
    assert.equal(api.workspaceDropZoneAtPoint(target, 95, 50).zone, "right");
    assert.equal(api.workspaceDropZoneAtPoint(target, 50, 5).zone, "top");
    assert.equal(api.workspaceDropZoneAtPoint(target, 50, 95).zone, "bottom");
    assert.equal(api.workspaceDropZoneAtPoint(target, 50, 50).zone, "center");
  });

  check("tab-strip drops resolve an exact insertion index", () => {
    sandbox.__mobile = false;
    const target = fakePane(
      {left:0, right:300, top:0, bottom:100, width:300, height:100},
      [
        {left:20, width:80},
        {left:100, width:90},
        {left:190, width:70}
      ]
    );
    assert.equal(api.workspaceDropZoneAtPoint(target, 25, -16).index, 0);
    assert.equal(api.workspaceDropZoneAtPoint(target, 135, -16).index, 1);
    assert.equal(api.workspaceDropZoneAtPoint(target, 255, -16).index, 3);
  });

  check("terminal and SFTP toolbar placements stay independent in each layout mode", () => {
    api.setTabs([
      {key:"terminal-a", kind:"terminal"},
      {key:"sftp-a", kind:"sftp"}
    ]);
    sandbox.runtimeSettings.saved.workspace_toolbar_placement = {
      unsplit:{terminal:"tab", sftp:"header"},
      split:{terminal:"header", sftp:"tab"}
    };
    sandbox.__mobile = false;
    api.setLayout(pane("pane-toolbar", ["terminal-a", "sftp-a"]));
    assert.equal(api.workspaceToolbarPlacementForTab("terminal-a"), "tab");
    assert.equal(api.workspaceToolbarPlacementForTab("sftp-a"), "header");
    api.setLayout(split(
      "split-toolbar",
      "row",
      pane("pane-toolbar-left", ["terminal-a"]),
      pane("pane-toolbar-right", ["sftp-a"])
    ));
    assert.equal(api.workspaceToolbarPlacementForTab("terminal-a"), "header");
    assert.equal(api.workspaceToolbarPlacementForTab("sftp-a"), "tab");
    sandbox.__mobile = true;
    assert.equal(api.workspaceToolbarPlacementForTab("terminal-a"), "tab");
    assert.equal(api.workspaceToolbarPlacementForTab("sftp-a"), "tab");
    sandbox.__mobile = false;
  });

  check("toolbars with a removed owner mount are discarded", () => {
    api.setTabs([{key:"terminal-stale", kind:"terminal"}]);
    api.setLayout(pane("pane-stale", ["terminal-stale"]));
    let removed = 0;
    const toolbar = {
      dataset:{workspaceToolbarKind:"terminal", workspaceTabKey:"terminal-stale"},
      classList:{contains:value => value === "terminal-toolbar", remove:() => {}},
      closest:() => null,
      remove:() => { removed += 1; }
    };

    api.returnWorkspaceToolbarToMount(toolbar);

    assert.equal(removed, 1);
  });

  check("split ratios clamp and persist with the workspace tree", () => {
    api.setTabs([
      {key:"a", kind:"terminal", title:"A"},
      {key:"b", kind:"sftp", title:"B"}
    ]);
    api.setLayout(split("split-20", "row", pane("pane-20", ["a"]), pane("pane-21", ["b"])));
    api.setFocusedPane("pane-20");
    sandbox.activeTabKey = "a";
    api.setWorkspaceSplitRatio("split-20", 2);
    assert.equal(api.getLayout().ratio, 0.85);
    let saved = JSON.parse(storage.get("workspaceTabs"));
    assert.equal(saved.layout.ratio, 0.85);
    api.setWorkspaceSplitRatio("split-20", -2);
    saved = JSON.parse(storage.get("workspaceTabs"));
    assert.equal(saved.layout.ratio, 0.15);
  });

  check("duplicating a terminal tab passes a distinct session key", () => {
    api.setTabs([{key:"terminal-7-1", kind:"terminal", id:7, title:"Host", viewName:"terminal", closable:true}]);
    api.setLayout(pane("pane-30", ["terminal-7-1"]));
    api.setFocusedPane("pane-30");
    let terminalCall = null;
    sandbox.openTerminal = (id, updateTab, existingKey, title) => {
      terminalCall = {id, updateTab, existingKey, title};
      api.addTab(existingKey, title, "", "terminal", true, {kind:"terminal", id});
    };
    api.duplicateWorkspaceTab("terminal-7-1");
    const keys = api.getTabs().map(item => item.key);
    assert.equal(new Set(keys).size, 2);
    assert.equal(terminalCall.id, 7);
    assert.equal(terminalCall.updateTab, true);
    assert.match(terminalCall.existingKey, /^terminal-7-1-copy-\d+$/);
    assert.match(terminalCall.title, /副本/);
  });

  check("ordinary workspace tabs also duplicate with independent keys", () => {
    api.setTabs([{key:"settings", kind:"settings", title:"Settings", subtitle:"General", viewName:"settings", closable:true}]);
    api.setLayout(pane("pane-31", ["settings"]));
    api.setFocusedPane("pane-31");
    sandbox.openSettings = () => {};
    api.duplicateWorkspaceTab("settings");
    const copied = api.getTabs().find(item => item.key !== "settings");
    assert.ok(copied);
    assert.match(copied.key, /^settings-copy-\d+$/);
    assert.equal(copied.kind, "settings");
    assert.equal(api.workspaceFindPane("pane-31").activeTabKey, copied.key);
  });

  check("new tabs open after the active tab and close back to it", () => {
    api.setTabs([
      {key:"first", kind:"terminal", title:"First"},
      {key:"second", kind:"terminal", title:"Second"},
      {key:"third", kind:"terminal", title:"Third"}
    ]);
    api.setLayout(pane("pane-mru", ["first", "second", "third"]));
    api.setFocusedPane("pane-mru");
    sandbox.activeTabKey = "first";

    api.activateTab("second");
    api.addTab("settings", "Settings", "General", "settings", true, {kind:"settings"});
    assert.equal(api.workspaceFindPane("pane-mru").activeTabKey, "settings");
    assert.equal(api.workspaceFindPane("pane-mru").tabs.join(","), "first,second,settings,third");
    assert.equal(api.getTabs().map(tab => tab.key).join(","), "first,second,settings,third");

    api.closeTabsByKey(["settings"], "settings");
    assert.equal(api.workspaceFindPane("pane-mru").activeTabKey, "second");
    assert.equal(sandbox.activeTabKey, "second");
  });

  check("legacy tabs also open after the active tab and close back to it", () => {
    const legacy = loadLegacyWorkspaceModel();
    legacy.addTab("first", "First", "", "terminal", true, {kind:"terminal"});
    legacy.addTab("second", "Second", "", "terminal", true, {kind:"terminal"});
    legacy.addTab("third", "Third", "", "terminal", true, {kind:"terminal"});
    legacy.activateTab("second");
    legacy.addTab("settings", "Settings", "General", "settings", true, {kind:"settings"});
    assert.equal(legacy.getTabs().map(tab => tab.key).join(","), "first,second,settings,third");
    legacy.closeTabsByKey(["settings"], "settings");
    assert.equal(legacy.getActiveTabKey(), "second");
    assert.equal(legacy.getTabs().map(tab => tab.key).join(","), "first,second,third");
  });

  check("recent-tab fallback stays inside its pane and skips tabs closed in the same batch", () => {
    api.setTabs([
      {key:"left-a", kind:"terminal"},
      {key:"left-b", kind:"terminal"},
      {key:"left-c", kind:"settings"},
      {key:"left-d", kind:"settings"},
      {key:"right-a", kind:"sftp"},
      {key:"right-b", kind:"sftp"}
    ]);
    api.setLayout(split(
      "split-mru",
      "row",
      pane("pane-mru-left", ["left-a", "left-b", "left-c", "left-d"]),
      pane("pane-mru-right", ["right-a", "right-b"])
    ));
    api.setFocusedPane("pane-mru-left");
    sandbox.activeTabKey = "left-a";

    api.activateTab("left-b");
    api.activateTab("left-c");
    api.activateTab("right-b");
    api.activateTab("left-d");
    api.closeTabsByKey(["left-d", "left-c"], "left-d");

    assert.equal(api.workspaceFindPane("pane-mru-left").activeTabKey, "left-b");
    assert.equal(api.workspaceFindPane("pane-mru-right").activeTabKey, "right-b");
    assert.equal(sandbox.activeTabKey, "left-b");
  });

  check("recent-tab history remains runtime-only", () => {
    const saved = JSON.parse(storage.get("workspaceTabs"));
    assert.equal(JSON.stringify(saved).includes("workspacePaneTabHistory"), false);
    assert.equal(JSON.stringify(saved).includes("tabHistory"), false);
  });

  check("mobile layout exposes only the focused pane", () => {
    api.setLayout(split("split-40", "row", pane("pane-40", ["a"]), pane("pane-41", ["b"])));
    api.setFocusedPane("pane-41");
    sandbox.__mobile = true;
    assert.equal(api.workspaceVisiblePanes().map(item => item.id).join(","), "pane-41");
    sandbox.__mobile = false;
    assert.equal(api.workspaceVisiblePanes().length, 2);
  });

  const failures = checks.filter(item => !item.pass).map(item => `${item.name}: ${item.detail}`);
  return {passed:failures.length === 0, failures, checks};
}

if (require.main === module) {
  const result = runWorkspaceDockingChecks();
  if (!result.passed) process.exit(1);
  console.log(`Workspace docking checks passed: ${result.checks.length}`);
}

module.exports = runWorkspaceDockingChecks;
