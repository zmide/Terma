const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function checkSourceContracts() {
  const docking = readFrontendDomain(root, "docking");
  const terminal = readFrontendDomain(root, "terminal");
  const logs = readFrontendDomain(root, "logs");
  const settings = readFrontendDomain(root, "settings");
  const connections = readFrontendDomain(root, "connections");
  const batch = read("public/app-batch.js");
  const forwards = read("public/app-forwards.js");
  const imports = read("public/app-import.js");
  const workspace = read("public/app-workspace.js");
  const sftp = readFrontendDomain(root, "sftp");

  assert.match(docking, /function captureWorkspacePane\(\)/);
  assert.match(docking, /workspaceDockElement\(\) && !workspaceFindPane\(paneId\)/);
  assert.match(docking, /function captureWorkspaceTab\(tabKey=activeTabKey\)/);
  assert.match(docking, /pane\.activeTabKey !== tabKey/);
  assert.match(docking, /selectedId !== connectionId/);
  assert.doesNotMatch(docking, /isMobileLayout\(\) && event\.pointerType === "touch"\) return/);
  assert.match(docking, /drag\.pointerType === "touch" && Math\.abs\(deltaY\) > Math\.abs\(deltaX\)/);
  assert.match(docking, /if \(!record\.mount\?\.isConnected\) \{\s*toolbar\.remove\(\);\s*return;\s*\}/);
  assert.doesNotMatch(terminal, /function terminalElementForKey[\s\S]*?document\.querySelector\(selector\)[\s\S]*?\n\}/);
  assert.match(logs, /const logViewerStates = new Map\(\)/);
  assert.match(logs, /captureWorkspaceTab\(tabKey\)/);
  assert.match(settings, /function settingsQueryAll\(selector\)/);
  assert.match(settings, /setInterval\(\(\) => refreshUpdateDownloadProgress\(inPane\), 500\)/);
  assert.match(connections, /async function loadKeys\(selected, select=/);
  assert.match(connections, /if \(body\?\.isConnected\) body\.innerHTML/);
  assert.match(batch, /function currentBatchRoot\(\)/);
  assert.match(batch, /captureWorkspaceTab\(tabKey\)/);
  assert.match(batch, /const socket = new WebSocket/);
  assert.match(forwards, /function captureForwardWorkspace\(connectionId=selectedId\)/);
  assert.match(forwards, /scope\.querySelectorAll\("\.forward-check:checked"\)/);
  assert.match(imports, /loadSecuritySettings\(\)\.then\(\(\) => inPane\(renderBackupControls\)\)/);
  assert.doesNotMatch(imports, /document\.querySelector\("\.workspace"\)/);
  assert.match(workspace, /setTimeout\(\(\) => loadStartupSummary\(box\), 1200\)/);
  assert.match(sftp, /const mountedShell = view\.querySelector\(":scope > \.sftp-shell"\)/);
  assert.match(sftp, /const mounted = mountedTabKey === tabKey\s*&& mountedShell\?\.dataset\.sftpTabKey === tabKey\s*&& mountedToolbar\?\.dataset\.workspaceTabKey === tabKey/);
  assert.match(sftp, /function navigateSftpPath\(remotePath, tabKey=activeTabKey, options=\{\}\)/);

  const runtimeRootStart = sftp.indexOf("function sftpRuntimeRoot(");
  const runtimeRootEnd = sftp.indexOf("\nfunction sftpElement(", runtimeRootStart);
  const ensureRuntimeStart = sftp.indexOf("function ensureSftpRuntime(");
  const ensureRuntimeEnd = sftp.indexOf("\nfunction saveActiveSftpRuntime(", ensureRuntimeStart);
  assert.ok(runtimeRootStart >= 0 && runtimeRootEnd > runtimeRootStart, "sftpRuntimeRoot source is available");
  assert.ok(ensureRuntimeStart >= 0 && ensureRuntimeEnd > ensureRuntimeStart, "ensureSftpRuntime source is available");
  assert.doesNotMatch(sftp.slice(runtimeRootStart, runtimeRootEnd), /dataset\.sftpTabKey\s*=(?!=)/);
  assert.doesNotMatch(sftp.slice(ensureRuntimeStart, ensureRuntimeEnd), /dataset\.sftpTabKey\s*=(?!=)/);
}

function checkTerminalElementIsolation() {
  const terminal = readFrontendDomain(root, "terminal");
  const start = terminal.indexOf("function terminalElementForKey(");
  const end = terminal.indexOf("\nfunction updateTerminalStatusForLayout", start);
  assert.ok(start >= 0 && end > start, "terminalElementForKey source is available");

  const queries = [];
  const expected = {owner:"terminal-b"};
  const stale = {owner:"terminal-a"};
  const sandbox = {
    CSS:{escape:value => String(value)},
    terminalSessions:new Map(),
    workspaceElementForTab:() => null,
    workspaceCssEscape:value => String(value),
    document:{
      querySelector:selector => {
        queries.push(selector);
        if (selector === '.terminal-toolbar[data-workspace-tab-key="terminal-b"]') {
          return {querySelector:() => expected};
        }
        if (selector === "#terminalStatus") return stale;
        return null;
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${terminal.slice(start, end)}\n;globalThis.__terminalElementForKey = terminalElementForKey;`,
    sandbox,
    {filename:"public/app-terminal.js", timeout:5000}
  );

  assert.equal(sandbox.__terminalElementForKey("terminal-b", "#terminalStatus"), expected);
  assert.deepEqual(queries, ['.terminal-toolbar[data-workspace-tab-key="terminal-b"]']);
}

function loadDockingModel() {
  const filename = path.join(root, "scripts", "workspace-docking-check.js");
  const source = fs.readFileSync(filename, "utf8")
    .replace(/\r\n?/g, "\n")
    .replace(
      "setWorkspaceSplitRatio,\n      focusWorkspacePane,\n      duplicateWorkspaceTab,",
      "setWorkspaceSplitRatio,\n      focusWorkspacePane,\n      captureWorkspacePane,\n      captureWorkspaceTab,\n      currentWorkspacePaneId,\n      duplicateWorkspaceTab,"
    )
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
console.log("Workspace pane async isolation checks passed");
