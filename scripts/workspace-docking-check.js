const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript-legacy");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService, installedServiceFixture } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");

function installWorkspaceState(window) {
  const file = path.join(root, "frontend/src/features/workspace/workspace-state-service.ts");
  const { installWorkspaceStateService } = loadFrontendService(file, {window});
  installWorkspaceStateService();
}

function installWorkspaceStorage(sandbox, port) {
  const directory = path.join(root, "frontend/src/features/workspace");
  const globals = {window:sandbox.window, document:{addEventListener() {}, removeEventListener() {}}};
  if (!sandbox.window.termaWorkspaceLayout) {
    loadFrontendService(path.join(directory, "workspace-layout-service.ts"), globals).installWorkspaceLayoutService();
  }
  sandbox.window.setTimeout = sandbox.setTimeout || setTimeout;
  loadFrontendService(path.join(directory, "workspace-persistence-service.ts"), globals).installWorkspacePersistenceService(port);
}

function loadWorkspaceHost(sandbox) {
  const presentation = loadFrontendService(path.join(root, 'frontend/src/features/workspace/workspace-tab-presentation.ts'), {
    window:sandbox.window, document:sandbox.document, tr:sandbox.tr, icon:sandbox.icon,
    get tabs() { return sandbox.tabs; }, get activeView() { return sandbox.activeView; }
  });
  sandbox.window.termaWorkspaceViews ||= {};
  sandbox.window.termaWorkspaceViews.presentation = {
    ...presentation.workspaceTabPresentation,
    syncTitle: sandbox.syncWorkspaceDocumentTitle || presentation.syncWorkspaceDocumentTitle
  };
  const filename = path.join(root, 'frontend/src/features/workspace/workspace-host.ts');
  vm.createContext(sandbox);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}
  }).outputText;
  const exports = {};
  const evaluate = vm.runInContext(`(function(exports, require){${source}\n})`, sandbox, {filename});
  evaluate(exports, dependency => {
    const installed=installedServiceFixture(dependency,sandbox.window);if(installed)return installed;
    if(dependency==='@/shared/application-state')return {applicationState:sandbox};
    if(['@/shared/browser-ui','@/shared/workspace-dom','@/shared/i18n/workspace-bootstrap','@/shared/ui/icon-service','@/shared/action-menu','@/features/connections/connection-selection'].includes(dependency))return sandbox;
    if(dependency==='@/features/terminal/terminal-page')return sandbox;
    if(dependency==='@/features/terminal/terminal-connection-runtime')return sandbox;
    if(dependency==='@/features/terminal/terminal-session-state')return {
      terminalSessions:sandbox.terminalSessions||new Map(),terminalSurfaceCache:sandbox.terminalSurfaceCache||new Map(),terminalCounts:sandbox.terminalCounts||new Map()
    };
    if (dependency === '@/features/terminal/terminal-viewport-service') {
      return {terminalViewport:sandbox.window.termaTerminalViewport || {schedule() {}}};
    }
    if (dependency === '@/features/terminal/terminal-startup-state') {
      return {terminalStartupOverrides: sandbox.terminalStartupOverrides};
    }
    if (dependency === './workspace-dock-state') return sandbox.dockState;
    if (dependency === './workspace-dock-runtime') return sandbox.dockRuntime;
    if (dependency === '@/features/workspace/workspace-shell-controller') return {workspaceShell: sandbox.window.termaWorkspaceShell};
    if (dependency === '@/shared/workspace-prompts') {
      return { inputModal: sandbox.inputModal, confirmModal: sandbox.confirmModal };
    }
    if (dependency === '@/features/settings/runtime-settings-model') {
      return {runtimePreferences:{get snapshot() { return sandbox.runtimeSettings; }}};
    }
    if (dependency === '../connections/connection-dashboard') {
      return {openConnectionDashboard: sandbox.openServerDashboard};
    }
    if (dependency === '../connections/connection-form-workspace') {
      return {openSavedConnectionForm: sandbox.editConnection};
    }
    if (dependency === '../session-efficiency/terminal-broadcast-workspace') {
      return {repaintTerminalBroadcast() {}, stopTerminalBroadcast() {}};
    }
    if (dependency === './workspace-tab-presentation') return presentation;
    if (dependency === '@/features/workspace/workspace-pane-scope') return sandbox.paneScope;
    if (dependency === '@/features/workspace/workspace-modal-host') return {closeModal:sandbox.closeModal||(()=>{})};
    if (dependency === '@/features/efficiency/notification-actions') return {notify() {}};
    if (dependency === '@/shared/api/workspace-request') return {api:async()=>({})};
    if (dependency === './workspace-dock-layout') return sandbox.dockLayout;
    if (dependency === './workspace-dock-tabs') return sandbox.dockTabs;
    if (dependency === '../terminal/terminal-session-lifecycle') return {closeTerminalSession:sandbox.closeTerminalSession};
    assert.equal(dependency, '../session-efficiency/session-model');
    return loadFrontendService(path.resolve(path.dirname(filename), dependency + '.ts'));
  });
  const pages = {open:(path,update,key,source) => source ? sandbox.openWebFiles?.(path,update,key,source) : sandbox.openLocalFiles?.(path,update,key),
    label:source => sandbox.webFilesSourceLabel?.(source), release:keys => sandbox.filePageLifecycleService?.().release(keys)};
  return {...exports, workspaceTabRuntimeHost:() => exports.workspaceTabRuntimeHost(pages), workspaceTabCopyHost:() => exports.workspaceTabCopyHost(pages)};
}

const workspaceRuntimeFile = path.join(root, "frontend/src/features/workspace/workspace-tab-runtime.ts");
function installTabRuntime(sandbox, port) {
  loadFrontendService(workspaceRuntimeFile, {window:sandbox.window}).installWorkspaceTabRuntime(port);
}

function loadDockingModel() {
  const storage = new Map();
  const noop = () => {};
  const titleCalls = [];
  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    setTimeout:() => 1,
    clearTimeout:noop,
    CSS:{escape:value => String(value)},
    tabs:[],
    titleCalls,
    activeTabKey:"",
    activeView:"welcome",
    selectedId:null,
    responsiveLayoutMobile:false,
    runtimeSettings:{saved:{restore_workspace_tabs:true}},
    terminalSessions:new Map(),
    sftpDisconnectedTabs:new Set(),
    window:{restoringTabs:false, addEventListener:noop, removeEventListener:noop, termaSftpPage:{toolbar:noop}, termaWorkspaceViews:{tabs:(target, models) => {
      for (const model of models) {
        const button = target?.buttons?.find(item => item.dataset.tabKey === model.key);
        if (!button) continue;
        button.classList.toggle("active", model.active);
        button.classList.toggle("activity-output", model.activity === "output");
      }
    }}},
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
    tr:(key, options={}) => options.defaultValue || key,
    notify:noop,
    currentConnection:() => null,
    nextTerminalTabIndex:() => 2,
    terminalStartupOverrides:new Map(),
    hideTabContextMenu:noop,
    closeTerminalSession:noop,
    closeSftpSession:noop,
    renderWelcome:noop,
    openTerminal:noop,
    openForwards:noop,
    editConnection:noop,
    openLog:noop,
    openBatchCommand:noop,
    openSftp:noop,
    openServerDashboard:noop,
    openSettings:noop,
    syncTerminalToolbarPlacement:noop,
    syncWorkspaceDocumentTitle:(...args) => titleCalls.push(args),
    registerTermaAction:noop,
    renderTabs:noop,
    updateWorkspaceTabScrollControls:noop,
    scrollWorkspaceTabs:noop,
    handleWorkspaceTabsWheel:noop,
    revealWorkspaceTab:noop,
    addTab:noop,
    setWorkspaceTabConnectionStatus:noop,
    renderTabContent:(...args) => sandbox.window.termaWorkspaceTabRuntime.render(...args),
    activateTab:noop,
    setWorkspace:noop,
    closeTab:noop,
    closeTabsByKey:noop,
    moveWorkspaceTab:noop,
    showTabContextMenu:noop,
    saveTabsState:() => sandbox.window.termaWorkspacePersistence.save(),
  };
  sandbox.window.termaWorkspaceTabActions = {hideMenu:noop};
  sandbox.window.termaConnectionViews = {renderWelcome:noop};
  sandbox.window.termaBatch = {open:(...args)=>sandbox.openBatchCommand(...args),dispose:noop};
  sandbox.window.termaLogReader = {feature:()=>({service:{open:(...args)=>sandbox.openLog(...args)},release:noop})};
  sandbox.window.termaWorkspaceShell = {setHeading:noop,showMobileWorkspace:noop,isCollapsed:()=>false,syncResponsive:()=>false};
  sandbox.selectConnection = id => {
    sandbox.selectedId = id;
    return {id};
  };
  sandbox.window.termaRemoteManagement = {desktop:{open:(connectionId, updateTab) => {
    sandbox.linuxDesktopManagerOpen = {connectionId, updateTab};
  }}};
  sandbox.isMobileLayout = () => sandbox.__mobile === true;
  sandbox.globalThis = sandbox;
  installWorkspaceState(sandbox.window);
  const layoutServiceFile = path.join(root, "frontend/src/features/workspace/workspace-layout-service.ts");
  const { installWorkspaceLayoutService } = loadFrontendService(layoutServiceFile, {window:sandbox.window});
  installWorkspaceLayoutService();
  const dragServiceFile = path.join(root, "frontend/src/features/workspace/workspace-drag-service.ts");
  const { createWorkspaceDragService } = loadFrontendService(dragServiceFile, {window:sandbox.window, document:sandbox.document});
  const dockStateFile = path.join(root, 'frontend/src/features/workspace/workspace-dock-state.ts');
  vm.createContext(sandbox);
  const dockStateSource = ts.transpileModule(fs.readFileSync(dockStateFile, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  sandbox.dockState = {};
  sandbox.require=name=>{
    const installed=installedServiceFixture(name,sandbox.window);if(installed)return installed;
   if(name==='@/shared/application-state')return {applicationState:sandbox};
   if(name==='@/features/files/sftp/tab-runtime')return {sftpTabRuntimes:sandbox.sftpTabRuntimes};
   return sandbox;
  };
  vm.runInContext(`(function(exports){${dockStateSource}\n})`, sandbox, {filename:dockStateFile})(sandbox.dockState);
  Object.assign(sandbox, sandbox.dockState);
  for (const property of Object.keys(sandbox.dockState.workspaceDockState)) {
    Object.defineProperty(sandbox, property, {
      configurable:true, get:()=>sandbox.dockState.workspaceDockState[property],
      set:value=>{sandbox.dockState.workspaceDockState[property]=value;}
    });
  }
  sandbox.dockRuntime = {};
  sandbox.dockLayout = {};
  const paneScopeFile = path.join(root, 'frontend/src/features/workspace/workspace-pane-scope.ts');
  const sandboxExports = {};
  sandbox.paneScope = sandboxExports;
  vm.createContext(sandbox);
  const paneScopeSource = ts.transpileModule(fs.readFileSync(paneScopeFile,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInContext(`(function(exports, require){${paneScopeSource}\n})`, sandbox, {filename:paneScopeFile})(sandboxExports, name=>installedServiceFixture(name,sandbox.window)||(name==='@/shared/application-state'?{applicationState:sandbox}:sandbox.dockState));
  sandbox.paneScope.installWorkspacePaneScope();
  const tabsFile = path.join(root, 'frontend/src/features/workspace/workspace-dock-tabs.ts');
  const tabsSource = ts.transpileModule(fs.readFileSync(tabsFile, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  sandbox.dockTabs = {};
  vm.runInContext(`(function(exports, require){${tabsSource}\n})`, sandbox, {filename:tabsFile})(sandbox.dockTabs, name => {
    const installed=installedServiceFixture(name,sandbox.window);if(installed)return installed;
    if(name==='@/shared/application-state')return {applicationState:sandbox};
    if(name==='@/features/files/sftp/tab-runtime')return {sftpTabRuntimes:sandbox.sftpTabRuntimes};
    if(['@/shared/browser-ui','@/shared/workspace-dom','@/shared/i18n/workspace-bootstrap','@/shared/ui/icon-service','@/shared/action-menu','@/features/connections/connection-selection','@/features/efficiency/notification-actions'].includes(name))return sandbox;
    if (name === './workspace-dock-runtime') return sandbox.dockRuntime;
    if (name === './workspace-dock-layout') return sandbox.dockLayout;
    if (name === './workspace-dock-state') return sandbox.dockState;
    if (name === './workspace-pane-scope') return sandbox.paneScope;
    assert.equal(name, './workspace-tab-presentation');
    return {get workspaceTabPresentation() { return sandbox.window.termaWorkspaceViews.presentation; }};
  });
  const layoutFile = path.join(root, 'frontend/src/features/workspace/workspace-dock-layout.ts');
  const layoutSource = ts.transpileModule(fs.readFileSync(layoutFile, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInContext(`(function(exports, require){${layoutSource}\n})`, sandbox, {filename:layoutFile})(sandbox.dockLayout, name => {
    const installed=installedServiceFixture(name,sandbox.window);if(installed)return installed;
    if(name==='@/shared/application-state')return {applicationState:sandbox};
    if(name==='@/features/files/sftp/tab-runtime')return {sftpTabRuntimes:sandbox.sftpTabRuntimes};
    if(['@/shared/browser-ui','@/shared/workspace-dom','@/shared/i18n/workspace-bootstrap','@/shared/ui/icon-service','@/shared/action-menu','@/features/connections/connection-selection','@/features/efficiency/notification-actions'].includes(name))return sandbox;
    if (name === './workspace-dock-runtime') return sandbox.dockRuntime;
    if (name === './workspace-dock-state') return sandbox.dockState;
    if (name === './workspace-dock-tabs') return sandbox.dockTabs;
    assert.equal(name, './workspace-pane-scope');
    return sandbox.paneScope;
  });
  const host = loadWorkspaceHost(sandbox);
  sandbox.window.termaWorkspaceDrag = createWorkspaceDragService(host.workspaceDragHost());
  const filename = path.join(root, "frontend/src/features/workspace/workspace-dock-runtime.ts");
  sandbox.exports = sandbox.dockRuntime;
  sandbox.require = name => {
    const installed=installedServiceFixture(name,sandbox.window);if(installed)return installed;
    if(name==='@/shared/application-state')return {applicationState:sandbox};
    if(name==='@/features/files/sftp/tab-runtime')return {sftpTabRuntimes:sandbox.sftpTabRuntimes};
    if(['@/shared/browser-ui','@/shared/workspace-dom','@/shared/i18n/workspace-bootstrap','@/shared/ui/icon-service','@/shared/action-menu','@/features/connections/connection-selection','@/features/efficiency/notification-actions'].includes(name))return sandbox;
    if(name==='@/shared/application-state')return {applicationState:sandbox};
    if(['@/shared/browser-ui','@/shared/workspace-dom','@/shared/i18n/workspace-bootstrap','@/shared/ui/icon-service','@/shared/action-menu','@/features/connections/connection-selection'].includes(name))return sandbox;
    if (name === './workspace-dock-tabs') return sandbox.dockTabs;
    if (name === './workspace-dock-layout') return sandbox.dockLayout;
    if (name === './workspace-pane-scope') return sandbox.paneScope;
    assert.equal(name, './workspace-dock-state');
    return sandbox.dockState;
  };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText
    + '\ninstallWorkspaceDockRuntime();\n'
    + `\n;globalThis.__dockingModel = {
      workspaceLeaves,
      workspaceFindPane,
      workspaceFindSplit,
      workspaceReplacePaneWithSplit,
      workspaceFilterLayout:(layout, keys) => window.__groupHost.layout.filter(layout, keys),
      workspaceAllTabs,
      workspaceTabByKey,
      workspaceHasTabKey,
      serializeWorkspaceLayout:() => window.termaWorkspaceLayout.serialize(workspaceLayout),
      restoreWorkspaceLayoutNode:(...args) => window.termaWorkspacePersistence.restoreLayout(...args),
      workspaceDropZoneAtPoint:window.termaWorkspaceDrag.dropZoneAtPoint,
      applyWorkspaceTabDrop: window.termaWorkspaceDrag.applyTabDrop,
      workspaceToolbarPlacementForTab:(...args) => window.termaWorkspaceToolbar.placement(...args),
      returnWorkspaceToolbarToMount:(...args) => window.termaWorkspaceToolbar.returnToMount(...args),
      workspaceVisiblePanes,
      setWorkspaceSplitRatio:window.termaWorkspaceDrag.splitter.setRatio,
      focusWorkspacePane,
      captureWorkspacePane:globalThis.paneScope.captureWorkspacePane,
      captureWorkspaceTab:globalThis.paneScope.captureWorkspaceTab,
      currentWorkspacePaneId:globalThis.paneScope.currentWorkspacePaneId,
      duplicateWorkspaceTab:(...args) => window.termaWorkspaceTabCopy.duplicate(...args),
      captureCurrentWorkspaceGroup:(...args) => window.termaWorkspaceGroups.capture(...args),
      serializeWorkspaceGroupsForPreset:() => window.termaWorkspaceGroups.serialize(),
      applyWorkspaceGroupPreset:(...args) => window.termaWorkspacePersistence.applyPreset(...args),
      restoreWorkspaceGroups:saved => window.termaWorkspacePersistence.restoreGroups(saved),
      saveTabsState,
      restoreTabsState:() => window.termaWorkspacePersistence.restore(),
      switchWorkspaceGroup:(...args) => window.termaWorkspaceGroups.switchGroup(...args),
      beginWorkspaceGroupSelection:(...args) => window.termaWorkspaceGroups.beginSelection(...args),
      cancelWorkspaceGroupSelection:() => window.termaWorkspaceGroups.cancelSelection(),
      activateWorkspaceTabFromClick:(...args) => window.termaWorkspaceGroups.activateFromClick(...args),
      beginWorkspaceGroupDrag:(...args) => window.termaWorkspaceGroups.beginDrag(...args),
      dropWorkspaceGroup:(...args) => window.termaWorkspaceGroups.drop(...args),
      addTab,
      setWorkspaceTabConnectionStatus,
      renderTabContent,
      syncWorkspaceTabActivation:globalThis.dockTabs.syncWorkspaceTabActivation,
      activateTab,
      closeTabsByKey,
      setLayout:value => { workspaceLayout = value; },
      getLayout:() => workspaceLayout,
      setFocusedPane:value => { focusedPaneId = value; },
      getFocusedPane:() => focusedPaneId,
      setTabs:value => { tabs = value; },
      getTabs:() => tabs,
      setWorkspaceGroups:(value, activeId) => { workspaceGroups = value; activeWorkspaceGroupId = activeId; },
      setWorkspacePaneNode:(paneId, node) => workspacePaneNodes.set(paneId, node),
      removeWorkspacePaneNode:paneId => workspacePaneNodes.delete(paneId),
      getWorkspaceGroups:() => workspaceGroups,
      getActiveWorkspaceGroupId:() => activeWorkspaceGroupId,
      getWorkspaceGroupSelectionMode:() => window.termaWorkspaceGroups.selectionMode(),
      getTitleCalls:() => titleCalls,
      getWorkspaceSelectedTabKeys:() => tabs.filter(tab => window.termaWorkspaceGroups.isSelected(tab.key)).map(tab => tab.key),
      resetSerials:() => { dockState.workspaceDockState.workspacePaneSerial = 1; dockState.workspaceDockState.workspaceSplitSerial = 0; }
    };`;

  vm.runInNewContext(source, sandbox, {filename, timeout:5000});
  const toolbar = loadFrontendService(path.join(root, 'frontend/src/features/workspace/workspace-toolbar-placement.ts'), {window:sandbox.window, document:sandbox.document});
  toolbar.installWorkspaceToolbarPlacement(host.workspaceToolbarHost());
  installTabRuntime(sandbox, host.workspaceTabRuntimeHost());
  const {installWorkspaceTabCopy} = loadFrontendService(path.join(root, 'frontend/src/features/workspace/workspace-tab-copy.ts'), {window:sandbox.window});
  installWorkspaceTabCopy(host.workspaceTabCopyHost());
  const groupControllerFile = path.join(root, "frontend/src/features/workspace/workspace-group-controller.ts");
  const {installWorkspaceGroupController} = loadFrontendService(groupControllerFile, {window:sandbox.window, document:sandbox.document});
  sandbox.window.__groupHost = host.workspaceGroupHost();
  installWorkspaceGroupController(sandbox.window.__groupHost);
  installWorkspaceStorage(sandbox, host.workspaceStorageHost({...host.workspaceDockedStorageHost(), docked:() => true}));
  return {api:sandbox.__dockingModel, sandbox, storage};
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
  check('shared dock queries retain live records and reject malformed metadata', () => {
    const {sandbox} = loadDockingModel();
    const valid = {key:'local', kind:'local-files', fileSource:'browser'};
    const invalid = [{key:12}, {key:'broken', kind:[]}, {key:'bad-source', fileSource:'remote'}, {key:'bad-id', id:NaN}];
    sandbox.tabs = [valid, ...invalid];
    assert.equal(sandbox.dockState.workspaceTabByKey('local'), valid);
    assert.deepEqual([...sandbox.dockState.workspaceAllTabs()], [valid]);
    assert.equal(sandbox.dockState.workspaceTabByKey('broken'), null);
  });

  const {api, sandbox, storage} = loadDockingModel();

  check("an empty workspace remains readable before the layout service loads", () => {
    const service = sandbox.window.termaWorkspaceLayout;
    const result = [];
    try {
      sandbox.window.termaWorkspaceLayout = undefined;
      assert.equal(api.workspaceLeaves(null, result), result);
      assert.deepEqual(result, []);
    } finally {
      sandbox.window.termaWorkspaceLayout = service;
    }
  });

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

  check("closing an inactive pane's active tab rerenders its replacement content", () => {
    const left = pane("pane-close-left", ["close-left"]);
    const right = pane("pane-close-right", ["close-right-a", "close-right-b"]);
    right.activeTabKey = "close-right-a";
    api.setTabs([
      {key:"close-left", title:"Left", kind:"settings", closable:true},
      {key:"close-right-a", title:"Right A", kind:"settings", closable:true},
      {key:"close-right-b", title:"Right B", kind:"settings", closable:true}
    ]);
    api.setLayout(split("split-close", "row", left, right));
    api.setFocusedPane(left.id);
    const rendered = [];
    const previousRenderPane = sandbox.renderWorkspacePaneContent;
    sandbox.renderWorkspacePaneContent = paneId => rendered.push(paneId);
    try {
      api.closeTabsByKey(["close-right-a"], "close-right-a");
    } finally {
      sandbox.renderWorkspacePaneContent = previousRenderPane;
    }
    assert.equal(api.workspaceFindPane(right.id).activeTabKey, "close-right-b");
    assert.ok(rendered.includes(right.id), "the non-focused pane must render its newly active tab");
  });

  check("incremental tab activation refreshes workspace group activity", () => {
    const activePane = pane("pane-activity", ["activity-tab"]);
    api.setTabs([{key:"activity-tab", title:"Activity", kind:"terminal", closable:true, activityState:"output"}]);
    api.setLayout(activePane);
    api.setFocusedPane(activePane.id);
    const tabClasses = new Set(["tab", "activity-output"]);
    const tabButton = {
      dataset:{tabKey:"activity-tab"},
      classList:{
        [Symbol.iterator]:() => tabClasses[Symbol.iterator](),
        contains:name => tabClasses.has(name),
        remove:(...names) => names.forEach(name => tabClasses.delete(name)),
        toggle:(name, enabled) => enabled ? tabClasses.add(name) : tabClasses.delete(name)
      },
      setAttribute:() => {}
    };
    api.setWorkspacePaneNode(activePane.id, {
      dataset:{paneId:activePane.id},
      classList:{toggle:() => {}},
      querySelector:selector => selector === ".tabs" ? {buttons:[tabButton], querySelectorAll:() => [], removeAttribute:() => {}} : null,
      querySelectorAll:selector => selector === ".tabs .tab[data-tab-key]" ? [tabButton] : []
    });
    let groupRenders = 0;
    const previousGroupRender = sandbox.window.termaWorkspaceGroups.render;
    sandbox.window.termaWorkspaceGroups.render = () => { groupRenders += 1; };
    try {
      api.syncWorkspaceTabActivation("activity-tab");
    } finally {
      sandbox.window.termaWorkspaceGroups.render = previousGroupRender;
    }
    assert.equal(api.getTabs()[0].activityState, "");
    assert.equal(tabClasses.has("activity-output"), false, "the active tab DOM must clear its current activity marker immediately");
    assert.equal(tabClasses.has("active"), true, "the activated tab must remain visually selected");
    assert.equal(groupRenders, 1, "clearing tab activity must refresh the group activity marker");
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

  check("tab runtime preserves SFTP activation scope and the new owner of a reopened tab", () => {
    const { createWorkspaceTabRuntime } = loadFrontendService(workspaceRuntimeFile);
    const { createTerminalBroadcastService } = loadFrontendService(path.join(root, "frontend/src/features/efficiency/terminal-broadcast-service.ts"));
    let live = [{key:"browser",kind:"local-files",pinned:true},{key:"sftp",kind:"sftp",id:7,path:"/work"},{key:"log",kind:"log"},
      ...["one","two","three"].map(key=>({key,kind:"terminal"}))];
    const service = createTerminalBroadcastService(), disposed = [], releases = [], marked = [];
    service.setTargets(["one","two","three"]);
    let later, repaint = 0;
    const runtime = createWorkspaceTabRuntime({
      tabs:() => live, tab:key => live.find(tab=>tab.key===key), sftp:(...values)=>marked.push(values),
      rememberClosed:keys=>marked.push(Array.from(keys)), releaseLocal:key=>releases.push(key),
      releaseTerminal:key=>disposed.push("terminal:"+key), releaseRemote:()=>{},
      releaseSftp:key=>disposed.push("sftp:"+key), releaseSftpCache:()=>{}, releaseLog:key=>disposed.push("log:"+key),
      broadcast:()=>service, stopBroadcast:()=>service.clear(), repaintBroadcast:()=>repaint++, defer:run=>{later=run;}
    });
    runtime.render(live[1], {fast:true,paneId:"right",activationToken:8});
    assert.equal(JSON.stringify(marked[0]),JSON.stringify([7,"/work","sftp",{fast:true,paneId:"right",activationToken:8}]));
    const closing=runtime.closing(["browser","sftp","log","one","closed-already"]);
    assert.deepEqual(releases, [], "pinned file page must retain its working state");
    assert.equal([...closing.keys()].join(','), 'sftp,log,one');
    live = live.filter(tab=>!closing.has(tab.key));
    runtime.cleanup(closing,true);
    runtime.closed();
    assert.deepEqual(Array.from(service.openTargets(["one","two","three"])),["two","three"]);
    assert.equal(repaint,1);
    live.push({key:"sftp",kind:"sftp",id:20});
    later();
    assert.deepEqual(disposed,["terminal:log","log:log","terminal:one"]);
    live = live.filter(tab=>tab.key!=="two");
    runtime.closed();
    assert.equal(service.state.targets.size,0);
  });

  check("empty panes collapse without flattening surviving nested splits", () => {
    const layout = split(
      "split-1",
      "row",
      pane("empty"),
      split("split-2", "column", pane("pane-2", ["a"]), pane("pane-3", ["b"]))
    );
    const pruned = sandbox.window.termaWorkspaceLayout.prune(layout);
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

  check("dissolving a group keeps the main group's existing split tab placement", () => {
    const main = {id:"workspace-main", tabs:[{key:"left"},{key:"right"}],
      layout:split("split-main","row",pane("left-pane",["left"]),pane("right-pane",["right"]))};
    const other = {id:"workspace-group-1", tabs:[{key:"moved"}]};
    const result = sandbox.window.termaWorkspaceState.dissolveGroup([main, other], other.id, main.id, api.workspaceFilterLayout);
    const merged = result.groups.find(group => group.id === main.id);
    assert.equal(api.workspaceLeaves(merged.layout).map(item => item.tabs.join(",")).join("|"), "left,moved|right");
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
    api.beginWorkspaceGroupDrag({stopPropagation:() => {}, dataTransfer:{setData:() => {}}}, "workspace-group-2", {classList});
    api.dropWorkspaceGroup({preventDefault:() => {}, stopPropagation:() => {}, clientX:0}, "workspace-main", {getBoundingClientRect:() => ({left:0, width:100})});
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

  check("restored workspace tabs discard stale connection colors and do not persist runtime status", () => {
    const restoredModel = loadDockingModel();
    const restoredTabs = [
      {key:"terminal-restored", kind:"terminal", connectionStatus:"connected"},
      {key:"sftp-restored", kind:"sftp", connectionStatus:"connecting"},
      {key:"remote-terminal-restored", kind:"remote-terminal", connectionStatus:"connected"},
      {key:"vnc-restored", kind:"remote-desktop", protocol:"vnc", connectionStatus:"connected"},
      {key:"rdp-restored", kind:"remote-desktop", protocol:"rdp", connectionStatus:"connected"}
    ];
    restoredModel.storage.set("workspaceTabs", JSON.stringify({
      activeWorkspaceGroupId:"workspace-main",
      workspaceGroups:[{
        id:"workspace-main",
        name:"",
        tabs:restoredTabs,
        layout:pane("pane-restored", restoredTabs.map(tab => tab.key)),
        activeTabKey:"terminal-restored",
        focusedPaneId:"pane-restored"
      }]
    }));

    assert.equal(restoredModel.api.restoreTabsState(), true);
    const byKey = new Map(restoredModel.api.getTabs().map(tab => [tab.key, tab]));
    for (const key of ["terminal-restored", "sftp-restored", "remote-terminal-restored", "vnc-restored"]) {
      assert.equal(byKey.get(key).connectionStatus, "disconnected", `${key} must restart disconnected`);
    }
    assert.equal(Object.hasOwn(byKey.get("rdp-restored"), "connectionStatus"), false);
    const saved = JSON.parse(restoredModel.storage.get("workspaceTabs"));
    assert.equal(saved.workspaceGroups[0].tabs.every(tab => !Object.hasOwn(tab, "connectionStatus")), true);
  });

  check("legacy workspace restore also resets and omits connection status", () => {
    const legacy = loadDockingModel();
    legacy.storage.set("workspaceTabs", JSON.stringify({
      activeTabKey:"terminal-legacy",
      tabs:[
        {key:"terminal-legacy", kind:"terminal", connectionStatus:"connected"},
        {key:"sftp-legacy", kind:"sftp", connectionStatus:"connecting", pinned:true},
        {key:"rdp-legacy", kind:"remote-desktop", protocol:"rdp", connectionStatus:"connected"}
      ]
    }));
    assert.equal(legacy.api.restoreTabsState(), true);
    const [terminal, sftp, rdp] = legacy.api.getTabs();
    assert.equal(legacy.sandbox.activeTabKey, "terminal-legacy");
    assert.equal(legacy.api.getLayout().tabs.join(","), "terminal-legacy,sftp-legacy,rdp-legacy");
    assert.equal(terminal.connectionStatus, "disconnected");
    assert.equal(sftp.connectionStatus, "disconnected");
    assert.equal(sftp.pinned, true);
    assert.equal(Object.hasOwn(rdp, "connectionStatus"), false);
    const saved = JSON.parse(legacy.storage.get("workspaceTabs"));
    assert.equal(saved.workspaceGroupsVersion, 1);
    assert.equal(saved.tabs.every(tab => !Object.hasOwn(tab, "connectionStatus")), true);
  });

  check("invalid workspace storage leaves current tabs intact", () => {
    const {api, storage} = loadDockingModel();
    const tabs = [{key:"existing", kind:"terminal"}];
    api.setTabs(tabs);
    storage.set("workspaceTabs", '{"tabs": (invalid)');
    assert.equal(api.restoreTabsState(), false);
    assert.equal(api.getTabs(), tabs);
    assert.equal(storage.get("workspaceTabs"), '{"tabs": (invalid)');
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

  check("recursive restore reserves every claimed ID and ignores invalid or duplicate tabs", () => {
    api.resetSerials();
    api.setLayout(pane("pane-live", ["live"]));
    api.setWorkspacePaneNode("pane-3", {});
    const stored = split(
      "split-1", "row", pane("pane-2", ["a"]),
      split("split-1", "column", pane("pane-2", ["a", "b", "stale"]), pane("", ["c"]))
    );
    let restored;
    try {
      restored = api.restoreWorkspaceLayoutNode(stored, new Set(["a", "b", "c"]), new Set(), new Set(), new Set());
    } finally {
      api.removeWorkspacePaneNode("pane-3");
    }
    assert.equal(restored.id, "split-1");
    assert.equal(restored.second.id, "split-2");
    assert.equal(api.workspaceLeaves(restored).map(item => item.id).join(","), "pane-2,pane-4,pane-5");
    assert.equal(api.workspaceLeaves(restored).map(item => item.tabs.join(",")).join("|"), "a|b|c");
    assert.equal(restored.second.first.activeTabKey, "b");
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

  check("splitting a background tab keeps the previously active tab in the source pane", () => {
    api.resetSerials();
    api.setTabs([
      {key:"sftp-1", kind:"sftp"},
      {key:"sftp-2", kind:"sftp"},
      {key:"terminal-3", kind:"terminal"}
    ]);
    api.setLayout(pane("pane-source", ["sftp-1", "sftp-2", "terminal-3"]));
    api.setFocusedPane("pane-source");
    const applied = api.applyWorkspaceTabDrop(
      {key:"sftp-2", sourcePaneId:"pane-source", sourceActiveTabKey:"sftp-1"},
      {paneId:"pane-source", zone:"right"}
    );
    assert.equal(applied, true);
    const source = api.workspaceLeaves().find(item => item.tabs.includes("sftp-1"));
    const destination = api.workspaceLeaves().find(item => item.tabs.includes("sftp-2"));
    assert.equal(source.activeTabKey, "sftp-1");
    assert.deepEqual([...source.tabs], ["sftp-1", "terminal-3"]);
    assert.equal(destination.activeTabKey, "sftp-2");
  });

  check("splitting the active middle tab returns the source pane to its left neighbor", () => {
    api.resetSerials();
    api.setTabs([
      {key:"terminal-1", kind:"terminal"},
      {key:"sftp-1", kind:"sftp"},
      {key:"terminal-2", kind:"terminal"}
    ]);
    const layout = pane("pane-source", ["terminal-1", "sftp-1", "terminal-2"]);
    layout.activeTabKey = "sftp-1";
    api.setLayout(layout);
    api.setFocusedPane("pane-source");
    const applied = api.applyWorkspaceTabDrop(
      {key:"sftp-1", sourcePaneId:"pane-source", sourceActiveTabKey:"sftp-1"},
      {paneId:"pane-source", zone:"right"}
    );
    assert.equal(applied, true);
    const source = api.workspaceLeaves().find(item => item.tabs.includes("terminal-1"));
    const destination = api.workspaceLeaves().find(item => item.tabs.includes("sftp-1"));
    assert.deepEqual([...source.tabs], ["terminal-1", "terminal-2"]);
    assert.equal(source.activeTabKey, "terminal-1");
    assert.equal(destination.activeTabKey, "sftp-1");
  });

  check("focusing another split pane updates the native workspace title", () => {
    api.setTabs([
      {key:"terminal-left", kind:"terminal", viewName:"terminal", title:"Linux图形界面测试", subtitle:"root@192.168.31.77:22"},
      {key:"terminal-right", kind:"terminal", viewName:"terminal", title:"Linux图形界面测试", subtitle:"root@192.168.31.76:22"}
    ]);
    api.setLayout({
      type:"split",
      id:"split-title",
      direction:"row",
      ratio:0.5,
      first:pane("pane-title-left", ["terminal-left"]),
      second:pane("pane-title-right", ["terminal-right"])
    });
    for (const paneId of ["pane-title-left", "pane-title-right"]) {
      api.setWorkspacePaneNode(paneId, {
        dataset:{paneId},
        classList:{toggle:() => {}},
        querySelector:() => null
      });
    }
    api.setFocusedPane("pane-title-left");
    const calls = api.getTitleCalls();
    calls.length = 0;
    api.focusWorkspacePane("pane-title-right");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "Linux图形界面测试");
    assert.equal(calls[0][1], "root@192.168.31.76:22");
    assert.equal(calls[0][3], "terminal-right");
    assert.equal(calls[0][4].kind, "terminal");
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

  check("scheduled workspace saves flush once and survive a cached page transition", () => {
    const window = new EventTarget();
    const document = new EventTarget();
    let nextTimer = 0;
    const timers = new Map();
    window.setTimeout = callback => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    };
    const file = path.join(root, "frontend/src/features/workspace/workspace-persistence-service.ts");
    const { createWorkspacePersistenceService } = loadFrontendService(file, {
      window, document, clearTimeout:timer => timers.delete(timer)
    });
    let writes = 0;
    const service = createWorkspacePersistenceService({
      save:() => { writes += 1; },
      restoring:() => Boolean(window.workspaceRestorePending)
    });
    service.schedule();
    service.schedule();
    assert.equal(timers.size, 1);
    window.dispatchEvent(Object.assign(new Event("pagehide"), {persisted:true}));
    assert.equal(timers.size, 0);
    assert.equal(writes, 1);

    service.schedule();
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(writes, 2);

    service.schedule();
    window.workspaceRestorePending = true;
    service.flush();
    service.schedule();
    assert.equal(timers.size, 0);
    assert.equal(writes, 2);
    window.workspaceRestorePending = false;
    service.dispose();
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
    assert.equal(terminalCall.existingKey, "terminal-7-2");
    assert.equal(terminalCall.title, "Host #2");
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

  check("split copy keeps startup settings but does not inherit the source session", () => {
    const key = 'terminal-8-1';
    const source = {key,kind:'terminal',id:8,title:'Host',viewName:'terminal',closable:true,pinned:true,
      sessionMode:'persistent',sessionBackend:'tmux',persistentSessionId:'live-id',resumePolicy:'never',connectionStatus:'connected'};
    api.setTabs([source]);
    api.setLayout(pane('pane-32',[key]));
    api.setFocusedPane('pane-32');
    sandbox.terminalStartupOverrides.set(key,{profile:'shell'});
    const result = {};
    const copyKey = api.duplicateWorkspaceTab(key,{splitZone:'right',result});
    const copied = api.getTabs().find(tab => tab.key === copyKey);
    assert.deepEqual(result,{key:'terminal-8-2',opened:true,split:true});
    assert.equal(copied.sessionMode,'persistent');
    assert.equal(copied.sessionBackend,'tmux');
    assert.equal(copied.persistentSessionId,undefined);
    assert.equal(copied.resumePolicy,undefined);
    assert.equal(copied.connectionStatus,undefined);
    assert.equal(copied.pinned,undefined);
    assert.deepEqual(sandbox.terminalStartupOverrides.get(copyKey),{profile:'shell'});
    assert.equal(source.persistentSessionId,'live-id');
    assert.equal(api.workspaceFindPane('pane-32').activeTabKey,key);
  });

  check("queued terminal copy discards stale startup data after the source is replaced", () => {
    const key = 'terminal-9-1';
    const source = {key,kind:'terminal',id:9,title:'Host',closable:true};
    api.setTabs([source]);
    api.setLayout(pane('pane-33',[key]));
    api.setFocusedPane('pane-33');
    const schedule = sandbox.requestAnimationFrame, terminal = sandbox.openTerminal;
    const queued = [];
    sandbox.requestAnimationFrame = callback => queued.push(callback);
    sandbox.openTerminal = () => assert.fail('replacement must not open the queued terminal');
    const result = {};
    try {
      sandbox.terminalStartupOverrides.set(key,{profile:'shell'});
      const copyKey = api.duplicateWorkspaceTab(key,{result});
      assert(sandbox.terminalStartupOverrides.has(copyKey));
      api.setTabs([{...source}]);
      queued.forEach(run => run());
      assert.deepEqual(result,{key:'',opened:false,split:false});
      assert(!sandbox.terminalStartupOverrides.has(copyKey));
    } finally {
      sandbox.requestAnimationFrame = schedule;
      sandbox.openTerminal = terminal;
    }
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

  check("typed pane history isolates groups with reused pane and tab keys", () => {
    const {createPaneTabHistory} = loadFrontendService(path.join(root, "frontend/src/features/workspace/workspace-state-service.ts"), {window:{}});
    let group = "main";
    const history = createPaneTabHistory(() => group);
    const leaf = pane("shared-pane", ["a", "b", "c"]);
    history.remember(leaf, "a", "a");
    history.remember(leaf, "b", "a");
    history.remember(leaf, "c", "b");
    group = "other";
    assert.equal(history.recent(leaf, new Set()), "");
    history.remember(leaf, "c", "c");
    history.remember(leaf, "a", "c");
    history.remember(leaf, "b", "a");
    assert.equal(history.recent(leaf, new Set(["b"])), "a");
    group = "main";
    assert.equal(history.recent(leaf, new Set(["c"])), "b");
    assert.equal(history.recent(pane("other-pane", ["a", "b", "c"]), new Set()), "");
    history.clear();
    assert.equal(history.recent(leaf, new Set()), "");
    group = "other";
    assert.equal(history.recent(leaf, new Set()), "");
  });

  check("typed pane history trims closed tabs, ignores invalid activation and skips batch targets", () => {
    const {createPaneTabHistory} = loadFrontendService(path.join(root, "frontend/src/features/workspace/workspace-state-service.ts"), {window:{}});
    const history = createPaneTabHistory(() => "main");
    const leaf = pane("mru", ["a", "b", "c"]);
    history.remember(null, "a");
    history.remember(leaf, "a", "a");
    history.remember(leaf, "b", "a");
    history.remember(leaf, "c", "b");
    history.remember(leaf, "missing", "c");
    history.remember(leaf, "", "c");
    assert.equal(history.recent(leaf, new Set(["b", "c"])), "a");
    leaf.tabs = ["a", "c"];
    history.trim(leaf);
    leaf.tabs.push("b");
    assert.equal(history.recent(leaf, new Set(["a", "c"])), "");
    history.remember(leaf, "a", "c");
    assert.equal(history.recent(leaf, new Set(["a"])), "c");
    leaf.tabs = [];
    history.trim(leaf);
    leaf.tabs = ["a", "b", "c"];
    assert.equal(history.recent(leaf, new Set()), "");
    assert.equal(history.recent(null, new Set()), "");
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

  check("closing without recent tabs follows pane order and protects pinned tabs", () => {
    const keys = ["a", "b", "c", "d", "e"];
    const records = keys.map(key => ({key, kind:"settings", closable:true, pinned:key === "e"}));
    const docking = loadDockingModel();
    const leaf = {...pane("pane-fallback", keys), activeTabKey:"c"};
    docking.api.setTabs(records);
    docking.api.setLayout(leaf);
    docking.api.setFocusedPane(leaf.id);
    docking.sandbox.activeTabKey = "c";
    docking.api.closeTabsByKey(["b", "c", "e"], "c");
    assert.equal(docking.api.getTabs().map(tab => tab.key).join(","), "a,d,e");
    assert.equal(docking.api.workspaceFindPane(leaf.id).tabs.join(","), "a,d,e");
    assert.equal(docking.sandbox.activeTabKey, "d");

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
