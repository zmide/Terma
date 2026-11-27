const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadFrontendService } = require('./frontend-service-test-helper');
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function checkSourceContracts() {
  const docking = read("frontend/src/features/workspace/workspace-dock-runtime.ts");
  const terminal = readFrontendDomain(root, "terminal");
  const operationsHost = read("frontend/src/features/operations/workspace-operations-host.ts");
  const settings = read("frontend/src/features/settings/settings-workspace.ts");
  const forwards = read("frontend/src/features/forwards/forward-workspace.ts");
  const imports = read("frontend/src/features/data-exchange/exchange-workspace.ts");
  const connectionHost = read("frontend/src/features/connections/connection-host.ts");
  const sftp = read("frontend/src/features/files/sftp/view-workspace.ts");
  const sftpLifecycle = read("frontend/src/features/files/sftp/page-lifecycle.ts");
  const sftpDirectoryLoader = read("frontend/src/features/files/sftp/directory-loader.ts");
  const sftpRuntime = read("frontend/src/features/files/sftp/tab-runtime.ts");

  const paneScope = read("frontend/src/features/workspace/workspace-pane-scope.ts");
  assert.match(paneScope, /function captureWorkspacePane\(\)/);
  assert.match(paneScope, /workspaceDockElement\(\) && !workspaceFindPane\(paneId\)/);
  assert.match(paneScope, /function captureWorkspaceTab\(tabKey = applicationState\.activeTabKey\)/);
  assert.match(paneScope, /pane\.activeTabKey !== tabKey/);
  assert.match(docking, /Number\(applicationState\.selectedId\) !== connectionId/);
  const tabDrag = read("frontend/src/features/workspace/workspace-tab-drag.ts");
  assert.doesNotMatch(tabDrag, /port\.mobile\(\) && event\.pointerType === 'touch'\) return/);
  assert.match(tabDrag, /dy > dx && port\.mobile\(\) && drag\.pointerType === 'touch'/);
  const toolbar = read("frontend/src/features/workspace/workspace-toolbar-placement.ts");
  assert.match(toolbar, /if \(!record\.mount\?\.isConnected\) \{\s*toolbar\.remove\(\);\s*return;\s*\}/);
  const dockLayout = read("frontend/src/features/workspace/workspace-dock-layout.ts");
  assert.match(dockLayout, /function needsRebuild\(\)/);
  const dockTabs = read("frontend/src/features/workspace/workspace-dock-tabs.ts");
  assert.match(dockTabs, /options\.rebuildLayout \?\? layout\.needsRebuild\(\)/);
  assert.doesNotMatch(dockTabs, /if \(options\.rebuildLayout !== false\) layout\.render\(\)/);
  assert.match(toolbar, /workspaceToolbarPlacementDirty/);
  assert.match(toolbar, /workspaceToolbarPlacementStateSignature\(\)/);
  assert.match(toolbar, /if \(changed\) port\.fitTerminal\(\)/);
  const dragService = read("frontend/src/features/workspace/workspace-drag-service.ts");
  assert.match(dragService, /port\.renderTabs\(\{\s*rebuildLayout:\s*true\s*\}\)/);
  const groupsHost = read("frontend/src/features/workspace/workspace-host.ts");
  assert.match(groupsHost, /restoreGroupLayout\(group\)[\s\S]*?renderTabs\(\{rebuildLayout:true\}\)/, "applying a restored group rebuilds its pane layout");
  assert.match(docking, /if \(workspaceServices\.termaWorkspaceShell\.syncResponsive\(\)\)\s*\{\s*renderTabs\(\{rebuildLayout:true\}\)/, "viewport mode changes rebuild the workspace explicitly");
  assert.match(read('frontend/src/features/terminal/terminal-engine-view.ts'), /function terminalViewForKey\(key=''\)/);
  assert.match(terminal, /attachTerminal\(c, key, terminalMount\)/);
  assert.doesNotMatch(terminal, /async function attachTerminal\(c, key\) \{\s*const mount = \$\("terminalMount"\)/);
  assert.match(read('frontend/src/features/logs/log-reader-service.ts'), /entries=new Map<string,Entry>/);
  assert.ok(operationsHost.includes("workspaceElementForTab(key, '#view-log')"));
  assert.match(settings, /captureWorkspaceTab\(tab.key\)/);
  assert.match(settings, /workspaceTabByKey\(tab.key\) === tab/);
  const download = read('frontend/src/features/settings/update-download-controller.ts');
  assert.match(download, /startPolling\(inPane = port\.capturePane\(\)\)/);
  assert.match(download, /port\.setProgress\(status\);\s*inPane\(port\.repaint\)/);
  const keyOptions = read('frontend/src/features/connections/connection-key-options.ts');
  assert.match(keyOptions, /WeakMap<HTMLSelectElement, object>/);
  assert.match(keyOptions, /!select\.isConnected \|\| requests\.get\(select\) !== request/);
  const dashboard = read('frontend/src/features/connections/connection-dashboard.ts');
  assert.match(dashboard, /captureWorkspaceTab\(tab.key\)/);
  assert.match(dashboard, /workspaceTabByKey\(tab.key\) === tab/);
  assert.match(read('frontend/src/features/batch/BatchViews.ts'),/sessions=new Map<object/);
  assert.ok(operationsHost.includes("workspaceElementForTab(tab.key, '#view-command')"));
  assert.match(operationsHost, /socket = new WebSocket/);
  assert.match(forwards, /const inTab = host\.captureTab\(tab\?\.key/);
  assert.match(read('frontend/src/features/forwards/ForwardPages.ts'),/model\.selected/);
  assert.ok(imports.includes("captureWorkspaceTab(key)") && imports.includes("workspaceElementForTab(tab.key, '#view-import')"));
  assert.match(read("frontend/src/features/data-exchange/exchange-service.ts"), /scope\.valid\(\)/);
  assert.doesNotMatch(imports, /document\.querySelector\("\.workspace"\)/);
  assert.match(connectionHost, /setTimeout\(\(\) => void loadStartupSummary\(box\), 1200\)/);
  assert.match(sftpLifecycle, /const shell=view\.querySelector<HTMLElement>\(':scope > \.sftp-shell'\)/);
  assert.match(sftpLifecycle, /const mounted=mountedKey===key&&shell\?\.dataset\.sftpTabKey===key&&toolbar\?\.dataset\.workspaceTabKey===key/);
  assert.match(sftpRuntime, /renderedRequestSeq:\s*-1/);
  assert.match(sftpLifecycle, /runtime\.renderedRequestSeq!==Number\(runtime\.state\.requestSeq\|\|0\)/);
  assert.match(sftpDirectoryLoader, /runtime\.renderedRequestSeq=sequence/);
  assert.match(read("frontend/src/entries/about-embed.ts"), /saveTabs: \(\) => workspaceServices\.termaWorkspacePersistence\?\.schedule\(\)/, "completed SFTP directory reads must coalesce workspace persistence");
  assert.match(sftp, /function navigate\(path: string, key = applicationState\.activeTabKey, options: DirectoryLoadOptions = \{\}\)/);

  const runtimeRootStart = sftpRuntime.indexOf("function root(");
  const runtimeRootEnd = sftpRuntime.indexOf("\n  function ensure(", runtimeRootStart);
  const ensureRuntimeStart = sftpRuntime.indexOf("function ensure(");
  const ensureRuntimeEnd = sftpRuntime.indexOf("\n  function restore(", ensureRuntimeStart);
  assert.ok(runtimeRootStart >= 0 && runtimeRootEnd > runtimeRootStart, "sftpRuntimeRoot source is available");
  assert.ok(ensureRuntimeStart >= 0 && ensureRuntimeEnd > ensureRuntimeStart, "ensureSftpRuntime source is available");
  assert.doesNotMatch(sftpRuntime.slice(runtimeRootStart, runtimeRootEnd), /dataset\.sftpTabKey\s*=(?!=)/);
  assert.doesNotMatch(sftpRuntime.slice(ensureRuntimeStart, ensureRuntimeEnd), /dataset\.sftpTabKey\s*=(?!=)/);
}

function checkTerminalElementIsolation() {
  const queries = [];
  const current = {owner:'mounted-pane'};
  const retained = {owner:'cached-surface'};
  const toolbar = {owner:'floating-toolbar'};
  const stale = {owner:'unrelated-pane'};
  const source = path.join(root, 'frontend/src/features/terminal/terminal-surface-service.ts');
  const {createTerminalSurfaceService} = loadFrontendService(source, {
    CSS:{escape:value => value.replace('"', '\\"')},
    document:{querySelector:selector => {
      queries.push(selector);
      if (selector === '.terminal-toolbar[data-workspace-tab-key="floating\\"tab"]') return {querySelector:() => toolbar};
      if (selector === '#terminalStatus') return stale;
      return null;
    }}
  });
  const surface = createTerminalSurfaceService({
    workspaceElement:key => key === 'mounted' ? current : null,
    surfaces:new Map([['mounted',{querySelector:() => stale}],['cached',{querySelector:() => retained}]]),
    sessions:new Map([['closed', {key:'closed'}]])
  });
  assert.equal(surface.element('mounted', '#terminalStatus'), current);
  assert.equal(surface.element('cached', '#terminalStatus'), retained);
  assert.equal(surface.element('floating"tab', '#terminalStatus'), toolbar);
  assert.equal(surface.element('closed', '#terminalStatus'), null);
  assert.deepEqual(queries, ['.terminal-toolbar[data-workspace-tab-key="floating\\"tab"]', '.terminal-toolbar[data-workspace-tab-key="closed"]']);
}

function checkTerminalViewIsolation() {
  const {loadFrontendService}=require('./frontend-service-test-helper');
  const expected = {owner:"pane-b-terminal"};
  const stale = {owner:"global-terminal"};
  const panes = new Map([
    ["pane-a", {id:"pane-a"}],
    ["pane-b", {id:"pane-b"}]
  ]);
  const sandbox = {
    window:{termaWorkspacePaneScope:{executionPaneId:() => "pane-a",workspacePaneElement:id => ({querySelector:selector => id === "pane-b" && selector === "#view-terminal" ? expected : null})}},
    focusedPaneId:"pane-a",
    workspaceFindPaneForTab:key => key === "terminal-b" ? panes.get("pane-b") : null,
    workspaceFindPane:id => panes.get(id) || null,
    $:id => id === "view-terminal" ? stale : null
  };
  const cache=new Map([
    [path.resolve('frontend/src/features/workspace/workspace-dock-state.ts'),{workspaceFindPaneForTab:sandbox.workspaceFindPaneForTab,workspaceFindPane:sandbox.workspaceFindPane}],
    [path.resolve('frontend/src/features/workspace/workspace-pane-scope.ts'),sandbox.window.termaWorkspacePaneScope]
  ]);
  sandbox.document={getElementById:sandbox.$};
  sandbox.__terminalViewForKey=loadFrontendService('frontend/src/features/terminal/terminal-engine-view.ts',sandbox,cache).terminalViewForKey;

  assert.equal(sandbox.__terminalViewForKey("terminal-b"), expected, "the terminal view must come from the tab's owning pane");
}

function loadDockingModel() {
  const filename = path.join(root, "scripts", "workspace-docking-check.js");
  const source = fs.readFileSync(filename, "utf8")
    .replace(/\r\n?/g, "\n")
    .replace(
      "module.exports = runWorkspaceDockingChecks;",
      "module.exports = {runWorkspaceDockingChecks, loadDockingModel};"
    );
  const moduleBox = {exports:{}};
  vm.runInNewContext(source, {
    require,
    module:moduleBox,
    exports:moduleBox.exports,
    __dirname:path.dirname(filename),
    __filename:filename,
    console,
    CustomEvent,
    process
  }, {filename, timeout:5000});
  return moduleBox.exports.loadDockingModel();
}

function checkCapturedExecution() {
  const {api, sandbox} = loadDockingModel();
  sandbox.document.getElementById = id => id === "workspaceDock" ? {} : null;
  api.setTabs([
    {key:"log-a", kind:"log", title:"A"},
    {key:"settings-b", kind:"forwards", id:42, title:"B"},
    {key:"other-a", kind:"settings", title:"Other"}
  ]);
  api.setLayout({
    type:"split",
    id:"split-isolation",
    direction:"row",
    ratio:0.5,
    first:{type:"pane", id:"pane-a", tabs:["log-a", "other-a"], activeTabKey:"log-a"},
    second:{type:"pane", id:"pane-b", tabs:["settings-b"], activeTabKey:"settings-b"}
  });
  api.setFocusedPane("pane-a");
  sandbox.activeTabKey = "log-a";

  const inPaneA = api.captureWorkspacePane();
  const inLogA = api.captureWorkspaceTab("log-a");
  api.setFocusedPane("pane-b");
  sandbox.activeTabKey = "settings-b";

  assert.equal(inPaneA(() => api.currentWorkspacePaneId()), "pane-a");
  assert.equal(api.currentWorkspacePaneId(), "pane-b");
  assert.equal(inLogA(() => api.currentWorkspacePaneId()), "pane-a");

  sandbox.selectedId = 999;
  api.focusWorkspacePane("pane-b");
  assert.equal(sandbox.selectedId, 42);
  api.setFocusedPane("pane-a");
  sandbox.selectedId = 999;
  api.focusWorkspacePane("pane-b");
  assert.equal(sandbox.selectedId, 42);

  api.getLayout().first.activeTabKey = "other-a";
  assert.equal(inLogA(() => "stale write"), undefined);

  api.setLayout({type:"pane", id:"pane-b", tabs:["settings-b"], activeTabKey:"settings-b"});
  assert.equal(inPaneA(() => "removed pane write"), undefined);
}

checkSourceContracts();
checkCapturedExecution();
checkTerminalElementIsolation();
checkTerminalViewIsolation();
async function checkCloseActionIsolation() {
  const {createWorkspaceTabActions} = loadFrontendService(path.join(root,'frontend/src/features/workspace/workspace-tab-actions.ts'));
  const current = {key:'term',title:'Fixture',kind:'terminal',id:1,closable:true,connectionStatus:'connected'};
  const pendingTab = {key:'sftp',kind:'sftp',closable:true,connectionStatus:'disconnected'};
  let tabs = [current,pendingTab], answer, stopped = 0, saves = 0;
  const close = [], seen = [];
  const service = createWorkspaceTabActions({
    tabs:() => tabs, transport:() => ({}), confirm:rows => {seen.push(rows);return new Promise(resolve=>{answer=resolve;});},
    prepare:tab => ({tab}), terminate:async ({tab}) => {stopped++;tab.sessionMode='none';tab.persistentSessionId='';return true;},
    save:() => saves++, close:(keys,key) => close.push([Array.from(keys),key]), error:error=>{throw error;}
  },{},{});
  let requested = service.requestClose(['term'],'term');
  tabs = [{...current},pendingTab];
  answer('detach');
  assert.equal(await requested,false,'same key in another workspace never receives the old close approval');
  requested = service.requestClose(['term','sftp'],'term');
  pendingTab.connectionStatus='connected';
  answer('detach');
  assert.equal(await requested,false,'a newly connected sibling was not listed in the confirmation');
  pendingTab.connectionStatus='disconnected';
  requested = service.requestClose(['term'],'term');
  tabs[0].pinned=true;
  answer('detach');
  assert.equal(await requested,false,'a pin added while the dialog was open is honored');
  tabs[0].pinned=false;
  tabs[0].sessionMode='persistent';tabs[0].persistentSessionId='terma-test';
  requested = service.requestClose(['term','sftp'],'term');
  assert.equal(seen.at(-1)[0].persistent,true);
  answer('terminate');
  assert.equal(await requested,true,'terminating the approved persistent session permits closing its original tab');
  assert.equal(stopped,1);assert.equal(saves,1);
  assert.deepEqual(close,[[['term','sftp'],'term']]);
}
checkCloseActionIsolation().then(()=>console.log("Workspace pane async isolation checks passed"),error=>{console.error(error);process.exitCode=1;});
