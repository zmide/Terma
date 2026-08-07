const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "public", "app-remote.js"), "utf8");
const utilsSource = fs.readFileSync(path.resolve(__dirname, "..", "public", "app-utils.js"), "utf8");
const apiSource = fs.readFileSync(path.resolve(__dirname, "..", "public", "app-api.js"), "utf8");
const openStart = source.indexOf("async function openRemoteDesktop(");
const openEnd = source.indexOf("\nfunction renderRdpServerState", openStart);
const openRemoteDesktop = source.slice(openStart, openEnd);
const renderStart = source.indexOf("function renderEmbeddedVnc(");
const renderEnd = source.indexOf("\nasync function connectEmbeddedVnc", renderStart);
const renderEmbeddedVnc = source.slice(renderStart, renderEnd);
const embeddedOpenStart = source.indexOf("async function openEmbeddedVncDesktop(");
const embeddedOpenEnd = source.indexOf("\nfunction renderEmbeddedVnc", embeddedOpenStart);
const openEmbeddedVncDesktop = source.slice(embeddedOpenStart, embeddedOpenEnd);
const managementControlsStart = source.indexOf("function syncEmbeddedVncManagementControls(");
const managementControlsEnd = source.indexOf("\nfunction showVncManagement", managementControlsStart);
const syncEmbeddedVncManagementControls = source.slice(managementControlsStart, managementControlsEnd);
const managementStart = source.indexOf("function showVncManagement(");
const managementEnd = source.indexOf("\nasync function connectEmbeddedVnc", managementStart);
const showVncManagement = source.slice(managementStart, managementEnd);
const focusStart = source.indexOf("function vncSessionCanFocus(");
const focusEnd = source.indexOf("\nasync function ensureVncClipboardTransport", focusStart);
const vncFocus = source.slice(focusStart, focusEnd);
const connectStart = source.indexOf("async function connectEmbeddedVnc(");
const connectEnd = source.indexOf("\nasync function saveVncCredential", connectStart);
const connectEmbeddedVnc = source.slice(connectStart, connectEnd);
const fullscreenStart = source.indexOf("function syncVncFullscreenPresentation(");
const fullscreenEnd = source.indexOf("\nasync function launchRemoteDesktop", fullscreenStart);
const fullscreenSource = source.slice(fullscreenStart, fullscreenEnd);
const cursorPolicyStart = source.indexOf("function normalizeVncRemotePlatform(");
const cursorPolicyEnd = source.indexOf("\nfunction vncClipboardDefaultStatus", cursorPolicyStart);
const cursorPolicy = source.slice(cursorPolicyStart, cursorPolicyEnd);
const taskWatcherStart = source.indexOf("function watchRemoteComponentTask(");
const taskWatcherEnd = source.indexOf("\nfunction reusableRemoteAdminGrant", taskWatcherStart);
const taskWatcher = source.slice(taskWatcherStart, taskWatcherEnd);
const actionStart = source.indexOf("async function runVncServerAction(");
const actionEnd = source.indexOf("\nfunction installVncServer", actionStart);
const vncServerAction = source.slice(actionStart, actionEnd);
const sourceSaveStart = source.indexOf("async function saveVncServerSessionSource(");
const sourceSaveEnd = source.indexOf("\nfunction vncSessionKeyForProfile", sourceSaveStart);
const saveVncServerSessionSource = source.slice(sourceSaveStart, sourceSaveEnd);
const rdpInstallStart = source.indexOf("async function installRdpServer(");
const rdpInstallEnd = source.indexOf("\nasync function runRdpServerActionImpl", rdpInstallStart);
const rdpServerActions = source.slice(rdpInstallStart, rdpInstallEnd);
const x11InstallStart = source.indexOf("async function installRemoteX11Components(");
const x11InstallEnd = source.indexOf("\nfunction openX11InstallTerminal", x11InstallStart);
const x11ComponentActions = source.slice(x11InstallStart, x11InstallEnd);
const linuxManagerStart = source.indexOf("function openLinuxDesktopManager(");
const linuxManagerEnd = source.indexOf("\nfunction showRemoteProfileFromSshMenu", linuxManagerStart);
const linuxDesktopManager = source.slice(linuxManagerStart, linuxManagerEnd);
const xServerManagerStart = source.indexOf("async function renderXServerManager(");
const xServerManagerEnd = source.indexOf("\nasync function inspectSshX11Forwarding", xServerManagerStart);
const xServerManager = source.slice(xServerManagerStart, xServerManagerEnd);
const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.css"), "utf8");

assert.ok(openStart >= 0 && openEnd > openStart, "openRemoteDesktop source must be available");
assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderEmbeddedVnc source must be available");
assert.ok(embeddedOpenStart >= 0 && embeddedOpenEnd > embeddedOpenStart, "openEmbeddedVncDesktop source must be available");
assert.ok(managementControlsStart >= 0 && managementControlsEnd > managementControlsStart, "VNC management control sync source must be available");
assert.ok(managementStart >= 0 && managementEnd > managementStart, "showVncManagement source must be available");
assert.ok(focusStart >= 0 && focusEnd > focusStart, "VNC focus guard source must be available");
assert.ok(connectStart >= 0 && connectEnd > connectStart, "connectEmbeddedVnc source must be available");
assert.ok(fullscreenStart >= 0 && fullscreenEnd > fullscreenStart, "VNC fullscreen source must be available");
assert.ok(cursorPolicyStart >= 0 && cursorPolicyEnd > cursorPolicyStart, "VNC cursor policy source must be available");
assert.ok(taskWatcherStart >= 0 && taskWatcherEnd > taskWatcherStart, "remote component task watcher source must be available");
assert.ok(actionStart >= 0 && actionEnd > actionStart, "VNC server action source must be available");
assert.ok(sourceSaveStart >= 0 && sourceSaveEnd > sourceSaveStart, "VNC source save source must be available");
assert.ok(rdpInstallStart >= 0 && rdpInstallEnd > rdpInstallStart, "RDP service action source must be available");
assert.ok(x11InstallStart >= 0 && x11InstallEnd > x11InstallStart, "X11 component action source must be available");
assert.ok(linuxManagerStart >= 0 && linuxManagerEnd > linuxManagerStart, "Linux desktop manager source must be available");
assert.ok(xServerManagerStart >= 0 && xServerManagerEnd > xServerManagerStart, "X Server manager source must be available");

const cachedWorkspace = openRemoteDesktop.indexOf("const existingVncSession");
const desktopProbe = openRemoteDesktop.indexOf("inspectLinuxDesktopForRemoteProfile(profile)");
assert.ok(cachedWorkspace >= 0, "VNC open path must detect an existing workspace");
assert.ok(desktopProbe >= 0, "first VNC open must retain Linux desktop diagnostics");
assert.ok(cachedWorkspace < desktopProbe, "an existing VNC workspace must be restored before any remote desktop probe");
assert.match(openRemoteDesktop, /const existingVncSession = embeddedVnc \? vncSessions\.get\(key\) : null;[\s\S]*?if \(!showManagement && existingVncSession\?\.workspace && \(existingVncSession\.connected \|\| existingVncSession\.connecting\)\) \{[\s\S]*?existingVncSession\.presentation === "management"[\s\S]*?showVncManagement\(profile\.id, key, false\)[\s\S]*?return renderEmbeddedVnc\(profile, key\)/, "tab switching must preserve the user's management/viewer choice for a live VNC session");
assert.match(openRemoteDesktop, /id="remoteDesktopCloseButton"[\s\S]*?closeEmbeddedVncDesktop\([^)]*\)[\s\S]*?关闭桌面/, "the probe page must include a close action for a retained embedded desktop");

const cachedBranch = renderEmbeddedVnc.slice(
  renderEmbeddedVnc.indexOf("if (session?.workspace)"),
  renderEmbeddedVnc.indexOf("view.innerHTML =")
);
assert.match(cachedBranch, /view\.replaceChildren\(session\.workspace\)/, "tab switching must reattach the existing VNC workspace");
assert.match(cachedBranch, /applyVncDisplayMode\(session\)/, "reattached noVNC canvas must restore its selected display policy immediately");
assert.doesNotMatch(cachedBranch, /inspectLinuxDesktopForRemoteProfile|connectEmbeddedVnc\(profile, key\)[\s\S]*await/, "cached VNC restore must stay local and synchronous");
assert.match(renderEmbeddedVnc, /managementNodes[\s\S]*?Array\.from\(view\.childNodes\)/, "opening the embedded viewer must preserve the probe and management DOM");
assert.match(renderEmbeddedVnc, /showVncManagement\([^)]*\)[\s\S]*?返回探测与管理/, "the VNC toolbar must expose a return-to-management command");
assert.match(renderEmbeddedVnc, /session\.presentation = "viewer"/, "attaching the desktop must remember the viewer presentation");
assert.match(openEmbeddedVncDesktop, /captureRemoteDesktopRenderScope\(profile\.id, key, view\)[\s\S]*?withRemoteDesktopRenderScope\(renderScope/, "late embedded VNC probes must be scoped to the view that requested them");
assert.match(openEmbeddedVncDesktop, /finally \{\s*if \(button\) setButtonBusy\(button, false\);\s*\}/, "the cached launch button must leave its busy state even after it is detached from the document");
assert.doesNotMatch(openEmbeddedVncDesktop, /document\.contains\(button\)/, "detached management controls must not retain an opening state");
assert.match(syncEmbeddedVncManagementControls, /setButtonBusy\(launchButton, false\)[\s\S]*?label\.textContent = "重新进入"[\s\S]*?closeButton\.hidden = false/, "a retained desktop must expose re-enter and close actions on the probe page");
assert.match(showVncManagement, /view\.replaceChildren\(\.\.\.session\.managementNodes\)/, "returning from the viewer must restore the preserved management page");
assert.match(showVncManagement, /captureRemoteDesktopRenderScope\(profileId, key, view\)[\s\S]*?session\.presentation = "management"/, "returning to management must invalidate stale desktop renders and remember the chosen presentation");
assert.match(showVncManagement, /inspectVncServer\(profileId, null, container\)/, "restored management state should refresh its remote probe in place");

assert.match(vncFocus, /session\?\.workspace\?\.isConnected/, "a detached VNC workspace must not steal keyboard focus");
assert.match(vncFocus, /paneId !== focusedPaneId/, "a visible VNC in a background split pane must not steal keyboard focus");
assert.match(vncFocus, /paneState\?\.activeTabKey[\s\S]*?paneState\.activeTabKey !== session\.key/, "only the active VNC tab in a pane may receive focus");

assert.match(connectEmbeddedVnc, /const connectionRevision = Number\(session\.connectionRevision \|\| 0\) \+ 1/);
assert.match(connectEmbeddedVnc, /vncSessions\.get\(key\) === session && session\.connectionRevision === connectionRevision/);
assert.match(connectEmbeddedVnc, /const RFB = await noVncRfbClass\(\);\s*if \(!isCurrentConnection\(\)\) return;/);
assert.match(connectEmbeddedVnc, /vnc-credential[\s\S]*?if \(!isCurrentConnection\(\)\) return;/, "a closed or reopened tab must discard a late credential response");
assert.match(connectEmbeddedVnc, /addEventListener\("connect"[\s\S]*?!isCurrentConnection\(\)/, "an obsolete noVNC connection event must be ignored");
assert.match(connectEmbeddedVnc, /catch \(error\) \{\s*if \(!isCurrentConnection\(\)\) return;/, "an obsolete connection failure must not alter the replacement tab");
assert.match(connectEmbeddedVnc, /applyVncDisplayMode\(session, rfb\)/, "new noVNC sessions must apply the saved scale or remote-resize policy");

assert.match(fullscreenSource, /document\.documentElement\.requestFullscreen\(\)/, "fullscreen must keep noVNC's body-level cursor overlay inside the fullscreen tree");
assert.match(fullscreenSource, /document\.addEventListener\("fullscreenchange", syncVncFullscreenPresentation\)/, "fullscreen exit must restore the regular VNC presentation");
assert.match(fullscreenSource, /applyVncDisplayMode\(session\)/, "fullscreen changes must restore the selected VNC display policy");
assert.doesNotMatch(fullscreenSource, /viewport\.requestFullscreen/, "the VNC viewport alone must not enter fullscreen because noVNC's fallback cursor lives under document.body");
assert.match(css, /html\.vnc-fullscreen-document:fullscreen \.vnc-viewport\.vnc-fullscreen-active \{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:60000;/s, "the active VNC viewport must cover the fullscreen document without covering noVNC's software cursor layer");

assert.match(cursorPolicy, /\["auto", "show", "hide"\]/, "VNC cursor mode must support automatic and both manual overrides");
assert.match(cursorPolicy, /mode === "hide" \|\| \(mode === "auto" && vncUsesFramebufferCursor\(session\)\)/, "automatic mode must hide the duplicate local cursor only for framebuffer cursor servers");
assert.match(cursorPolicy, /rfb\.showDotCursor = !hideLocalCursor/, "hidden local cursor mode must also disable noVNC's transparent-cursor dot");
assert.match(cursorPolicy, /showVncCursorModeMenu[\s\S]*?setVncCursorMode/, "the active VNC workspace must expose automatic and manual cursor controls");
assert.match(cursorPolicy, /\["scale", "original", "resize"\]/, "VNC display mode must support local scaling, original pixels, and remote resizing");
assert.match(cursorPolicy, /rfb\.scaleViewport = mode !== "original"/);
assert.match(cursorPolicy, /rfb\.resizeSession = mode === "resize"/);
assert.match(css, /\.vnc-screen\.vnc-hide-local-cursor canvas[^}]*cursor:none !important;/s, "macOS framebuffer cursor mode must hide the noVNC CSS cursor");
assert.match(css, /\.vnc-local-cursor-overlay-hidden[^}]*visibility:hidden !important;/s, "macOS framebuffer cursor mode must hide noVNC's fallback overlay cursor");
assert.match(css, /\.vnc-viewport\.vnc-display-original \{[^}]*overflow:auto;/s, "original-pixel mode must allow scrolling instead of forcing local scaling");

assert.match(taskWatcher, /const completion = new Promise[\s\S]*?return completion;/, "remote component watchers must expose task completion to action locks");
assert.match(taskWatcher, /catch \(error\)[\s\S]*?watcher\.finish\(failedTask\)/, "task polling failures must release the action lock");
assert.match(taskWatcher, /const previous = remoteComponentTaskWatchers\.get\(id\);[\s\S]*?if \(previous\) \{[\s\S]*?return previous\.completion;/, "re-watching the same task must reuse its completion instead of releasing the action lock early");
assert.doesNotMatch(taskWatcher, /if \(previous\) \{[\s\S]*?previous\.finish/, "re-watching the same task must not finish the active watcher");
assert.match(taskWatcher, /subscribers:new Set\(\)/, "one remote task poller must retain multiple subscribers");
assert.match(taskWatcher, /previous\.subscribers\.add\(subscriber\)/, "re-watching a task must subscribe without replacing the first caller");
assert.match(taskWatcher, /Promise\.allSettled\(\[\.\.\.watcher\.subscribers\]/, "updates and terminal callbacks must fan out to every task subscriber");
assert.doesNotMatch(taskWatcher, /previous\.options\s*=\s*options/, "a second task watcher must not overwrite the first watcher's callbacks");
assert.match(vncServerAction, /const actionKey = vncServerActionKey\(profileId\);/, "all VNC service actions for the same profile must share one lock");
assert.doesNotMatch(vncServerAction, /const actionKey = `vnc-server:[^`]*\$\{String\(action/, "VNC service locks must not be scoped to only one action name");
assert.match(vncServerAction, /const taskCompletion = watchRemoteComponentTask\(result\.task,[\s\S]*?notifyRemoteComponentTaskRequest\([^;]+;\s*await taskCompletion;/, "VNC task creation should report conflict-aware status while keeping the action locked until completion");
assert.match(saveVncServerSessionSource, /const stateContainer = select\.closest\?\.\("#vncServerState"\)/, "VNC source changes must remember the panel that initiated the save");
assert.match(saveVncServerSessionSource, /helpSession[\s\S]*?showVncConnectionHelp\(helpSession, vncServerReady\(diagnostics\)/, "embedded VNC source changes must refresh the existing help panel in place");
assert.equal((saveVncServerSessionSource.match(/\/vnc\/server`/g) || []).length, 1, "VNC source changes should reuse one diagnostics request for the active panel");

assert.match(rdpServerActions, /async function installRdpServer[\s\S]*?const actionKey = rdpServerActionKey\(profileId\);[\s\S]*?beginUiAction/, "RDP installation must use the shared profile resource lock");
assert.match(rdpServerActions, /async function runRdpServerAction[\s\S]*?const actionKey = rdpServerActionKey\(profileId\);/, "RDP start, stop and uninstall must share the installation lock");
assert.match(x11ComponentActions, /async function installRemoteX11Components[\s\S]*?x11ComponentsActionKey\(connectionId\)[\s\S]*?await taskCompletion/, "X11 installation must hold a connection resource lock until task completion");
assert.match(x11ComponentActions, /async function uninstallRemoteX11Components[\s\S]*?x11ComponentsActionKey\(connectionId\)[\s\S]*?await taskCompletion/, "X11 uninstall must share the same connection resource lock");
assert.match(linuxDesktopManager, /const linuxDesktopTaskMonitors = new Map|activeLinuxDesktopMonitorForConnection/, "Linux desktop tasks must remain discoverable after reopening the manager");
assert.match(linuxDesktopManager, /api\("\/api\/linux-desktop\/tasks"\)/, "Linux desktop manager must recover a running task when in-memory view state is missing");
assert.match(linuxDesktopManager, /function pollLinuxDesktopInstallTask[\s\S]*?endUiAction\(actionKey, button\)/, "Linux desktop resource locks must release only when task polling settles");
assert.match(utilsSource, /function syncUiActionControls[\s\S]*?\[data-ui-action-key\]/, "resource locks must synchronize every visible control for the same remote resource");
assert.match(utilsSource, /function beginUiAction[\s\S]*?syncUiActionControls\(actionKey, true\)/, "starting a resource action must immediately disable all matching controls");
assert.match(utilsSource, /function endUiAction[\s\S]*?syncUiActionControls\(actionKey, false\)/, "settled resource actions must restore all matching controls");
assert.match(apiSource, /data\.code === "REMOTE_TASK_CONFLICT"[\s\S]*?data\.task\?\.id/, "409 resource conflicts must hand the existing task back to the frontend watcher");
assert.match(apiSource, /task\.type === "remote-component"[\s\S]*?reused_task:sameAction[\s\S]*?task_conflict:true[\s\S]*?conflict_same_action:sameAction/, "remote component conflicts must distinguish same-action reuse from an opposite action");
assert.match(apiSource, /ok:sameAction/, "an opposite remote component action must not be reported as successful");
assert.match(xServerManager, /diagnostics\.integration_available === false/, "X Server management must detect a backend without desktop integration");
assert.match(xServerManager, /当前连接的是独立 Web\/测试后端，无法读取运行 Terma 桌面设备上的 X Server/, "X Server management must explain which device owns the X Server");
assert.match(xServerManager, /!integrationUnavailable && diagnostics\.can_stop[\s\S]*?!integrationUnavailable && diagnostics\.can_install[\s\S]*?!integrationUnavailable && diagnostics\.can_start/, "desktop X Server actions must be hidden when desktop integration is unavailable");

async function checkRemoteTaskConflictContract() {
  let payload = null;
  const context = {
    fetch:async () => ({status:409, statusText:"Conflict", ok:false, text:async () => JSON.stringify(payload)}),
    location:{href:""},
    JSON,
    String,
    Number,
    Boolean,
    Error
  };
  vm.runInNewContext(`${apiSource}\nthis.testApi = api;`, context);
  payload = {
    code:"REMOTE_TASK_CONFLICT",
    error:"VNC 服务已有启动任务正在执行",
    task:{id:"remote-component-1", type:"remote-component", action:"start", action_label:"启动", status:"running"}
  };
  const opposite = await context.testApi("/api/remote-profiles/1/vnc/server", {method:"POST", body:JSON.stringify({action:"stop"})});
  assert.equal(opposite.ok, false, "an opposite action conflict must not be successful");
  assert.equal(opposite.reused_task, false, "an opposite action must not be marked as a reused request");
  assert.equal(opposite.task_conflict, true);
  assert.equal(opposite.conflict_same_action, false);
  assert.equal(opposite.requested_action, "stop");
  assert.equal(opposite.running_action, "start");
  assert.equal(opposite.task.id, "remote-component-1", "the running task must remain available for observation");

  const same = await context.testApi("/api/remote-profiles/1/vnc/server", {method:"POST", body:JSON.stringify({action:"start"})});
  assert.equal(same.ok, true);
  assert.equal(same.reused_task, true);
  assert.equal(same.conflict_same_action, true);
  assert.equal(same.task.id, "remote-component-1");
}

async function checkRemoteTaskSubscriberFanout() {
  const calls = new Map();
  const context = {
    Map,
    Set,
    Promise,
    String,
    Boolean,
    Number,
    encodeURIComponent,
    setTimeout:callback => { setImmediate(callback); return 1; },
    remoteComponentTaskScopeMatches:() => true,
    remoteComponentTaskContainer:(_scope, container) => container || null,
    renderRemoteComponentTask:() => {},
    api:async pathValue => {
      const taskId = decodeURIComponent(String(pathValue).split("/").pop());
      calls.set(taskId, Number(calls.get(taskId) || 0) + 1);
      if (taskId === "fanout-failed") throw new Error("poll failed");
      return {id:taskId, type:"remote-component", action:"start", status:"done", progress:100};
    }
  };
  vm.runInNewContext(`const remoteComponentTaskWatchers = new Map();\n${taskWatcher}\nthis.testWatch = watchRemoteComponentTask;`, context);

  const doneEvents = [];
  const runningTask = {id:"fanout-done", type:"remote-component", action:"start", status:"running", progress:20};
  const first = context.testWatch(runningTask, {
    container:{id:"first"},
    onUpdate:task => doneEvents.push(`first:update:${task.status}`),
    onDone:task => doneEvents.push(`first:done:${task.status}`)
  });
  const second = context.testWatch(runningTask, {
    container:{id:"second"},
    onUpdate:task => doneEvents.push(`second:update:${task.status}`),
    onDone:task => doneEvents.push(`second:done:${task.status}`)
  });
  assert.strictEqual(second, first, "duplicate watchers must share one completion promise");
  const doneTask = await first;
  assert.equal(doneTask.status, "done");
  assert.equal(calls.get("fanout-done"), 1, "duplicate watchers must share one polling loop");
  assert.ok(doneEvents.includes("first:update:running"));
  assert.ok(doneEvents.includes("second:update:running"));
  assert.ok(doneEvents.includes("first:update:done"));
  assert.ok(doneEvents.includes("second:update:done"));
  assert.ok(doneEvents.includes("first:done:done"));
  assert.ok(doneEvents.includes("second:done:done"));

  const failedEvents = [];
  const failedTask = {id:"fanout-failed", type:"remote-component", action:"stop", status:"running", progress:10};
  const failedFirst = context.testWatch(failedTask, {onFailed:task => failedEvents.push(`first:${task.status}`)});
  const failedSecond = context.testWatch(failedTask, {onFailed:task => failedEvents.push(`second:${task.status}`)});
  assert.strictEqual(failedSecond, failedFirst);
  const failedResult = await failedFirst;
  assert.equal(failedResult.status, "failed");
  assert.equal(calls.get("fanout-failed"), 1);
  assert.deepEqual(failedEvents.sort(), ["first:failed", "second:failed"]);
}

async function checkEmbeddedVncPresentationScope() {
  const profile = {id:7, protocol:"vnc", options:{}};
  const view = {};
  const sessions = new Map();
  const busyStates = [];
  let currentScope = null;
  let diagnosticsCalls = 0;
  let renders = 0;
  const context = {
    Map,
    Promise,
    remoteProfileById:() => profile,
    $:() => view,
    vncSessions:sessions,
    captureRemoteDesktopRenderScope:() => (currentScope = {active:true}),
    withRemoteDesktopRenderScope:(scope, action) => scope.active ? action(view) : undefined,
    setButtonBusy:(_button, busy) => busyStates.push(busy),
    api:async () => {
      diagnosticsCalls += 1;
      currentScope.active = false;
      return {status:"ready"};
    },
    inspectLinuxDesktopForRemoteProfile:async () => ({platform_supported:true, has_desktop:true}),
    renderLinuxDesktopMissingWorkspace:() => { throw new Error("unexpected missing desktop render"); },
    renderEmbeddedVnc:() => { renders += 1; },
    notify:() => {}
  };
  vm.runInNewContext(`${openEmbeddedVncDesktop}\nthis.testOpenEmbeddedVnc = openEmbeddedVncDesktop;`, context);

  const staleResult = await context.testOpenEmbeddedVnc(7, "remote-desktop-7", {});
  assert.equal(staleResult, null, "a stale asynchronous open must not replace the newly selected view");
  assert.equal(renders, 0);
  assert.deepEqual(busyStates, [true, false], "a detached launch button must always leave its busy state");

  const retained = {workspace:{}, connected:true, connecting:false, presentation:"management"};
  sessions.set("remote-desktop-7", retained);
  const reopened = await context.testOpenEmbeddedVnc(7, "remote-desktop-7", {});
  assert.equal(reopened, true);
  assert.equal(retained.presentation, "viewer", "re-entering a retained session must select the viewer presentation");
  assert.equal(renders, 1);
  assert.equal(diagnosticsCalls, 1, "re-entering a live desktop must stay local instead of probing again");
}

Promise.all([checkRemoteTaskConflictContract(), checkRemoteTaskSubscriberFanout(), checkEmbeddedVncPresentationScope()])
  .then(() => console.log("VNC 工作区复用检查通过：已有标签立即恢复，旧连接异步结果隔离，后台分屏不抢焦点，全屏与自动/手动鼠标策略有效"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
