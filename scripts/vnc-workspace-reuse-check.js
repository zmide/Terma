const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const {loadFrontendService} = require("./frontend-service-test-helper");

const source = readFrontendDomain(path.resolve(__dirname, ".."), "remote");
const sessionOwner=fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/vnc-session-service.ts'),'utf8'),managementOwner=fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/vnc-management-service.ts'),'utf8'),fullscreenOwner=fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/vnc-fullscreen.ts'),'utf8');
const diagnosticsOwner=fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/management-diagnostics.ts'),'utf8');
const quickViews = fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "features", "quick", "quick-views.ts"), "utf8");
const vncWorkspaceOwner = fs.readFileSync(path.resolve(__dirname, '../frontend/src/features/remote/vnc-workspace.ts'), 'utf8');
const vncRuntimeSource = fs.readFileSync(path.resolve(__dirname, "../frontend/src/features/remote/vnc-runtime.ts"), "utf8");
const utilsSource = fs.readFileSync(path.resolve(__dirname, "../frontend/src/shared/ui-action-service.ts"), "utf8");
const apiSource = fs.readFileSync(path.resolve(__dirname, "..", "frontend/src/shared/api/workspace-request.ts"), "utf8");
const remoteDesktopViewsSource = fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "features", "remote", "RemoteDesktopViews.ts"), "utf8");
const remoteDesktopServiceSource = fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "features", "remote", "remote-desktop-service.ts"), "utf8");
const openRemoteDesktop = fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/remote-desktop-workspace.ts'),'utf8');
const remoteDesktopRuntime = fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/remote-desktop-runtime.ts'),'utf8');
const vncToolbarOwner = path.resolve(__dirname, '../frontend/src/features/remote/vnc-clipboard-toolbar.ts');

const rdpServerActions = fs.readFileSync(path.resolve(__dirname,"..","frontend/src/features/remote/protocol-service.ts"),"utf8");
const x11ComponentActions = fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/x11/remote-service.ts'),'utf8');
const linuxDesktopManager=fs.readFileSync(path.resolve(__dirname,'../frontend/src/features/remote/desktop-service.ts'),'utf8');
const xServerManagerStart = quickViews.indexOf("export function renderXServerManager(");
const xServerManagerEnd = quickViews.indexOf("\nexport function renderSshX11ForwardingPanel", xServerManagerStart);
const xServerManager = quickViews.slice(xServerManagerStart, xServerManagerEnd);
const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.css"), "utf8");

const docking = fs.readFileSync(path.resolve(__dirname, '../frontend/src/features/workspace/workspace-host.ts'), 'utf8');
assert.match(docking, /remoteDesktop:id => remoteServices\.termaRemoteDesktop\.open\(Number\(id\), false\)/, "remote desktop restores through the typed workspace");
assert.equal(fs.existsSync(path.resolve(__dirname, '../public/app-vnc.js')), false, 'the old VNC host script is retired');
assert.match(vncRuntimeSource, /remoteServices\.termaRemoteDesktop\.scope\.activeWorkspace\(workspace, key\)/);
assert.ok(rdpServerActions.includes('export function createProtocolService'), "RDP service action owner must be available");
assert.match(quickViews, /termaX11\.remote\.operate\(id, 'components', mode, button, 'install-guide'\)/, "X11 component action source must be available");
assert.ok(linuxDesktopManager.includes('export function createDesktopService'), "Linux desktop manager source must be available");
assert.ok(xServerManagerStart >= 0 && xServerManagerEnd > xServerManagerStart, "X Server manager source must be available");

const cachedWorkspace = openRemoteDesktop.indexOf("port.mountVnc(profile, key)");
const desktopProbe = openRemoteDesktop.indexOf("port.prepare(profile, prepareOptions)");
assert.ok(cachedWorkspace >= 0, "VNC open path must detect an existing workspace");
assert.ok(desktopProbe >= 0, "first VNC open must retain Linux desktop diagnostics");
assert.ok(cachedWorkspace < desktopProbe, "an existing VNC workspace must be restored before any remote desktop probe");
assert.match(remoteDesktopServiceSource, /options\.managedVnc && options\.managementConnectionId\s*\? port\.inspectLinux\(profile\)/, "managed VNC preparation retains Linux desktop diagnostics in its current service");
assert.match(openRemoteDesktop, /id: 'remoteDesktopCloseButton'[\s\S]*?port\.closeVncSession\(key\)/, "the Vue probe page must include a close action for a retained embedded desktop");
assert.match(remoteDesktopRuntime, /remoteServices\.termaRemoteViews\?\.renderDesktopLaunch/, "RDP/VNC/XDMCP management launch pages must use the installed Vue view adapter");
assert.match(openRemoteDesktop, /view\.__termaRemoteDesktopRefresh = \(\) => scope\.paint\(renderScope, target => \{[\s\S]*?render\(target, [^\n]+\);\s*refreshStatus\(\);/, "live language changes must repaint the desktop launch page without repeating its probe");
assert.match(vncRuntimeSource, /newWindow:guard\(\(\) => windows\.open\(id,key\)\)/, "the connected VNC toolbar must expose a detached-window action beside fullscreen");
assert.doesNotMatch(vncRuntimeSource, /data-vnc-window-maximize|toggleVncWindowMaximize/, "detached VNC maximization must use the Electron title bar instead of a duplicate toolbar action");
assert.match(vncRuntimeSource, /closeWindow:guard\(\(\) => windows\.closeSelf\(key\)\)/, "a detached VNC workspace must expose an explicit close action");
assert.match(vncRuntimeSource, /settings:guard\(\(\) => detached \? windows\.settings\(id\) : remoteServices\.termaRemoteProfiles\.editor\.edit\(id,true\)\)/, "a detached VNC workspace must expose connection settings beside close");
assert.match(openRemoteDesktop, /remoteDesktopLaunchButton: \{disabled: false, label: tr\('remote:vnc_status.reenter'\)[\s\S]*?remoteDesktopCloseButton: \{hidden: false, disabled: false\}/, "a retained desktop exposes localized re-enter and close actions through Vue state");
assert.match(vncWorkspaceOwner, /function refresh[\s\S]*?session\?\.workspace === workspace && session\.presentation === 'viewer'\) render\(session, target, detached\)/, "language updates must re-render the VNC toolbar without reconnecting the desktop");

const {createVncClipboardToolbar} = loadFrontendService(vncToolbarOwner);
const {createRemoteWorkspaceScope} = loadFrontendService('frontend/src/features/remote/remote-workspace-scope.ts');
let focusedPane = 'first', paneActive = 'vnc-test';
const {activeWorkspace} = createRemoteWorkspaceScope({activeKey:()=> 'vnc-test', focusedPane:()=>focusedPane,
  pane:()=>({activeTabKey:paneActive})});
const toolbar = createVncClipboardToolbar({}, {}, activeWorkspace);
let focusCalls = 0;
const focused = {key:'vnc-test',workspace:{isConnected:true,closest:()=>({dataset:{paneId:'first'}})},viewport:{isConnected:true},rfb:{focus:()=>{focusCalls++;}}};
assert.equal(toolbar.focus(focused),true);
focusedPane='second';
assert.equal(toolbar.focus(focused),false,'background splits may not steal keyboard focus');
focusedPane='first';paneActive='other';
assert.equal(toolbar.focus(focused),false,'inactive VNC tabs may not steal keyboard focus');
focused.workspace.isConnected=false;
assert.equal(toolbar.focus(focused),false,'detached VNC tabs may not steal keyboard focus');
assert.equal(focusCalls,1);

assert.doesNotMatch(source, /scheduleInitialVncReconnect|initialReconnectTimer|initialReconnectUsed/, "VNC failures must not launch blind unauthenticated retries that can trigger a server blacklist");
assert.doesNotMatch(source, /noVncRfbClass|\bvncSessions\b/, "the classic host must not own the RFB loader or any session map");
assert.match(vncRuntimeSource, /const RFB = await remoteServices\.termaVncRuntime\.loadRfb\(\);[\s\S]*?return new RFB\(owner\.screen, url\.href, /);
assert.match(vncRuntimeSource, /patchNoVncFailureEvents[\s\S]*?dispatchEvent\(new CustomEvent\('termafailure'/, "noVNC internal failures must be exposed to Terma diagnostics");
assert.match(diagnosticsOwner, /classifyVncFailure[\s\S]*?Unsupported security types[\s\S]*?Too many security failures/, "VNC authentication incompatibility and server lockout must be classified explicitly");
assert.doesNotMatch(source, /function (?:vncDiagnosticCopy|vncServiceFailureDetail|classifyVncFailure)\(/, "classic VNC must not retain a duplicate diagnosis owner");
assert.match(sessionOwner, /vncFailureTitleKey\(detail\)/, "session status uses the shared diagnosis owner");

assert.match(remoteDesktopViewsSource, /class: 'vnc-fullscreen-toolbar-edge-zone'/, "top-edge mode must include a Vue-owned pointer target above the noVNC canvas");
assert.match(css, /html\.vnc-fullscreen-document:fullscreen \.vnc-viewport\.vnc-fullscreen-active \{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:60000;/s, "the active VNC viewport must cover the fullscreen document without covering noVNC's software cursor layer");
assert.match(css, /\.vnc-workspace\.vnc-fullscreen-active \{[^}]*position:fixed;[^}]*inset:0;/s, "the fullscreen workspace must include the toolbar and viewport");
assert.match(css, /vnc-fullscreen-toolbar-edge-visible[\s\S]*?transform:translateY\(0\)/, "the top-edge toolbar mode must reveal the toolbar without leaving fullscreen");

assert.match(vncRuntimeSource, /cursorMode:guard\(event => presentation\.menu\(event,key\)\)/, "the active VNC workspace delegates cursor selection to its typed owner");
assert.doesNotMatch(source, /function (?:setVncCursorMode|applyVncCursorPolicy|applyVncDisplayMode)\(/, "the classic VNC shell no longer controls cursor or display mode");
assert.match(css, /\.vnc-screen\.vnc-hide-local-cursor canvas[^}]*cursor:none !important;/s, "macOS framebuffer cursor mode must hide the noVNC CSS cursor");
assert.match(css, /\.vnc-local-cursor-overlay-hidden[^}]*visibility:hidden !important;/s, "macOS framebuffer cursor mode must hide noVNC's fallback overlay cursor");
assert.match(css, /\.vnc-viewport\.vnc-display-original \{[^}]*overflow:auto;/s, "original-pixel mode must allow scrolling instead of forcing local scaling");

assert.match(rdpServerActions, /port.begin\(id,protocol,button,policy.busy\)/, "RDP installation must use the shared profile resource lock adapter");
assert.match(rdpServerActions, /const mutations=new Set<string>\(\)[\s\S]*?lock=`\$\{protocol\}:\$\{id\}`[\s\S]*?mutations.has\(lock\)/, "RDP start, stop and uninstall must share the installation lock");
assert.match(x11ComponentActions,/locks\.add\(lock\)[\s\S]*await port\.watch[\s\S]*locks\.delete\(lock\)/,'X11 actions retain their resource lock until task completion');
assert.match(x11ComponentActions,/lock=x11RemoteActionKey\(area,id\)/,'install and uninstall share the same component lock');
assert.match(linuxDesktopManager, /function monitorFor\(id:number\).*?monitors\.values\(\).*?item\.connectionId===id&&desktopTaskRunning\(item\.task\)/, "Linux desktop tasks must remain discoverable for the selected host after reopening");
const desktopService=fs.readFileSync(path.resolve(__dirname,"../frontend/src/features/remote/desktop-service.ts"),"utf8");
assert.match(desktopService, /port\.api\('\/api\/linux-desktop\/tasks'\)/, "Linux desktop manager must recover a running task when in-memory view state is missing");
assert.match(desktopService, /finish:[\s\S]*?port\.end\(id,button\)/, "Linux desktop resource locks must release only when task polling settles");
const uiActionOwner = fs.readFileSync(path.resolve(__dirname, "../frontend/src/shared/ui-action-service.ts"), "utf8");
assert.match(utilsSource, /export const syncUiActionControls=[\s\S]*?sharedServices\.termaUiActions\.syncControls/, "resource locks must use the shared typed owner");
assert.match(uiActionOwner, /querySelectorAll<ActionControl>\('\[data-ui-action-key\]'\)/, "resource locks must synchronize every visible control for the same remote resource");
assert.match(uiActionOwner, /function begin[\s\S]*?syncControls\(normalized, true\)/, "starting a resource action must immediately disable all matching controls");
assert.match(uiActionOwner, /function end[\s\S]*?syncControls\(normalized, false\)/, "settled resource actions must restore all matching controls");
assert.match(apiSource, /data\.code === 'REMOTE_TASK_CONFLICT'[\s\S]*?data\.task\?\.id/, "409 resource conflicts must hand the existing task back to the frontend watcher");
assert.match(apiSource, /task\.type !== 'remote-component'[\s\S]*?reused_task: same[\s\S]*?task_conflict: true[\s\S]*?conflict_same_action: same/, "remote component conflicts must distinguish same-action reuse from an opposite action");
assert.match(apiSource, /ok: same/, "an opposite remote component action must not be reported as successful");
assert.match(xServerManager, /diagnostics\.integration_available === false/, "X Server management must detect a backend without desktop integration");
assert.match(xServerManager, /当前连接的是独立 Web\/测试后端，无法读取运行 Terma 桌面设备上的 X Server/, "X Server management must explain which device owns the X Server");
assert.match(xServerManager, /!integrationUnavailable && diagnostics\.can_stop[\s\S]*?!integrationUnavailable && diagnostics\.can_install[\s\S]*?!integrationUnavailable && diagnostics\.can_start/, "desktop X Server actions must be hidden when desktop integration is unavailable");

assert.match(sessionOwner,/const sessions=new Map/);
assert.match(sessionOwner,/session.connectionRevision===revision/);
assert.match(sessionOwner,/current\(\)[\s\S]*?session.rfb===rfb/);
assert.match(sessionOwner,/saved.password=''/);
assert.match(sessionOwner,/rfb.approveServer/);
assert.match(sessionOwner,/port.confirm/);
assert.match(sessionOwner,/system_fallback_blocked_lockout/);
assert.match(vncWorkspaceOwner,/session.screen.parentElement !== session.viewport\) session.viewport.appendChild\(session.screen\)/);
assert.match(sessionOwner,/session.presentation='viewer'/);
assert.match(managementOwner,/pending.has\(id\)\|\|!port.begin/);
assert.match(managementOwner,/await view.watch/);
assert.match(fullscreenOwner,/await root.requestFullscreen\(\)/);
assert.match(fullscreenOwner,/doc.addEventListener\('fullscreenchange',sync\)/);
assert.match(fullscreenOwner,/\['always','never','edge'\]/);
async function checkRemoteTaskConflictContract() {
  let payload = null;
  const {createWorkspaceRequest} = loadFrontendService('frontend/src/shared/api/workspace-request.ts', {Headers,fetch});
  const testApi = createWorkspaceRequest({
    tr:(key, options = {}) => options.defaultValue || key,
    fetch: async () => new Response(JSON.stringify(payload), {status:409})
  }, {message:(_data, raw) => raw});
  payload = {
    code:"REMOTE_TASK_CONFLICT",
    error:"VNC 服务已有启动任务正在执行",
    task:{id:"remote-component-1", type:"remote-component", action:"start", action_label:"启动", status:"running"}
  };
  const opposite = await testApi("/api/remote-profiles/1/vnc/server", {method:"POST", body:JSON.stringify({action:"stop"})});
  assert.equal(opposite.ok, false, "an opposite action conflict must not be successful");
  assert.equal(opposite.reused_task, false, "an opposite action must not be marked as a reused request");
  assert.equal(opposite.task_conflict, true);
  assert.equal(opposite.conflict_same_action, false);
  assert.equal(opposite.requested_action, "stop");
  assert.equal(opposite.running_action, "start");
  assert.equal(opposite.task.id, "remote-component-1", "the running task must remain available for observation");

  const same = await testApi("/api/remote-profiles/1/vnc/server", {method:"POST", body:JSON.stringify({action:"start"})});
  assert.equal(same.ok, true);
  assert.equal(same.reused_task, true);
  assert.equal(same.conflict_same_action, true);
  assert.equal(same.task.id, "remote-component-1");
}

async function checkEmbeddedVncPresentationScope(){
const {createVncSessionService}=require('./frontend-service-test-helper').loadFrontendService('frontend/src/features/remote/vnc-session-service.ts');let active=true,renders=0,switches=0;const busy=[],profile={id:7,protocol:'vnc',host:'host.test',options:{}};const port={seed:()=>[],bind(){},profile:()=>profile,unlocked:()=>true,tr:k=>k,scope:()=>({current:()=>active,showMissingDesktop(){}}),busy:(_,v)=>busy.push(v),readDiagnostics:async()=>{active=false;return {};},readDesktop:async()=>null,prepareEmbedded:async()=>{switches++;return true;},notify(){},screen:()=>({}),render:()=>renders++};const service=createVncSessionService(port);assert.equal(await service.open(7,'key',{}),null);assert.equal(renders,0);assert.equal(switches,0);assert.deepEqual(busy,[true,false]);
}

Promise.all([checkRemoteTaskConflictContract(), checkEmbeddedVncPresentationScope()])
  .then(() => console.log("VNC 工作区复用检查通过：已有标签立即恢复，旧连接异步结果隔离，后台分屏不抢焦点，全屏与自动/手动鼠标策略有效"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
