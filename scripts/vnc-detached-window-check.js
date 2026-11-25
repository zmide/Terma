const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const main = read("desktop/main.js");
const preload = read("desktop/preload.js");
const workspaceBootstrap = read("frontend/src/shared/workspace-bootstrap.ts");
const workspaceRestore = read("frontend/src/shared/workspace-restore.ts");
const vncRuntime = read('frontend/src/features/remote/vnc-runtime.ts');
const remoteDesktopViews = read("frontend/src/features/remote/RemoteDesktopViews.ts");
const windowService=read('frontend/src/features/remote/vnc-window-service.ts'),fullscreen=read('frontend/src/features/remote/vnc-fullscreen.ts'),sessionService=read('frontend/src/features/remote/vnc-session-service.ts');
const desktopWorkspace = read("frontend/src/features/remote/remote-desktop-workspace.ts");
const runtime = read("src/runtime-settings.ts");
const storageRoutes = read("src/routes/storage-routes.ts");
const settingsRuntime = read("frontend/src/features/settings/runtime-view.ts");
const settings = read("frontend/src/features/settings/SettingsPage.ts");
const css = read("public/app.css");

assert.match(main, /const auxiliaryDesktopWindows = new Set\(\)/, "detached windows must be tracked separately from the main window");
assert.match(main, /const detachedVncWindows = new Map\(\)/, "each VNC profile must have a single detached-window slot");
assert.match(main, /function desktopWindowForSender[\s\S]*?auxiliaryDesktopWindows/, "desktop IPC must recognize only registered Terma windows");
assert.match(main, /createDetachedVncWindow[\s\S]*?Number\.isInteger\(id\)[\s\S]*?fetchJson\("\/api\/remote-profiles"\)[\s\S]*?find\(item => Number\(item\?\.id\) === id\)/, "the main process must validate the profile ID and resolve the profile itself");
assert.match(main, /sanitizeAuxiliaryWindowTitle[\s\S]*?replace\(\/\[\\0\\r\\n\]\//, "detached window titles must reject control characters");
assert.match(main, /target\.searchParams\.set\("termaVncWindow", String\(id\)\)/, "the detached URL must contain only the profile identifier");
assert.doesNotMatch(main, /searchParams\.set\([^\n]*(?:password|credential|secret)/i, "credentials must never be placed in the detached URL");
assert.match(main, /page-title-updated[\s\S]*?window\.setTitle\(title\)/, "the profile-derived native title must survive page title updates");
assert.match(main, /const existing = activeDetachedVncWindow\(id\)[\s\S]*?existing\.focus\(\)[\s\S]*?reused:true/, "opening the same VNC profile again must focus the existing detached window");
assert.match(main, /function closeDetachedVncWindowForProfile[\s\S]*?activeDetachedVncWindow\(id\)[\s\S]*?window\.close\(\)/, "the main window must be able to close the detached window before switching back to built-in VNC");
assert.match(main, /terma:vnc-open-window[\s\S]*?desktopWindowForSender\(event\)[\s\S]*?rendererBelongsToDesktop\(event\)/, "opening a detached window must validate the IPC sender");
assert.match(main, /terma:vnc-close-profile-window[\s\S]*?desktopWindowForSender\(event\) !== mainWindow[\s\S]*?closeDetachedVncWindowForProfile/, "only the main Terma window may request a profile-window switch");
assert.match(main, /terma:vnc-window-close[\s\S]*?window === mainWindow/, "the detached close command must not close the main Terma window");
assert.match(main, /terma:remote-profile-settings[\s\S]*?desktopWindowForSender\(event\)[\s\S]*?rendererBelongsToDesktop\(event\)[\s\S]*?bringMainWindowToFront\(\)[\s\S]*?terma:open-remote-profile-settings/, "detached VNC settings must be routed to the focused main window through validated IPC");
assert.match(main, /terma:remote-profile-settings[\s\S]*?detachedProfileId !== profileId[\s\S]*?detachedVncWindows\.has\(profileId\)/, "detached settings IPC must bind the request to the actual VNC window profile");
assert.doesNotMatch(main, /terma:vnc-window-maximize/, "native maximize controls must come from the Electron title bar");
assert.match(preload, /openVncWindow[\s\S]*?terma:vnc-open-window/);
assert.match(preload, /closeVncWindowForProfile[\s\S]*?terma:vnc-close-profile-window/);
assert.match(preload, /closeVncWindow[\s\S]*?terma:vnc-window-close/);
assert.match(preload, /openRemoteProfileSettings[\s\S]*?terma:remote-profile-settings/);
assert.match(preload, /onRemoteProfileSettings[\s\S]*?terma:open-remote-profile-settings/);
assert.doesNotMatch(preload, /toggleVncWindowMaximize|terma:vnc-window-maximize/);
assert.match(workspaceBootstrap, /detachedProfileId: \(\) => detachedProfileId/, "the detached query is supplied to the workspace restore owner");
assert.match(workspaceRestore, /if \(detached\)[\s\S]*?await port\.initDetachedVnc\(port\.detachedProfileId\?\.\(\) \|\| 0\)/, "detached restoration initializes the selected VNC workspace");
assert.match(workspaceBootstrap, /initDetachedVnc\(id\).*termaVncRuntime\.windows\.init\(id\)/);
assert.match(windowService, /function init\(id:number\)[\s\S]*?if\(!valid\(id\)\)[\s\S]*?port.mountDetached/);
assert.match(remoteDesktopViews, /function detachedVncRoot[\s\S]*?vnc-detached-root[\s\S]*?appendChild\(root\)/);
assert.match(vncRuntime, /mountDetached:[\s\S]*?detachedVncRoot\(\)[\s\S]*?desktop\.scope\.selectTab\(key\);[\s\S]*?session\.mount\(profile, key, null, root, true\)/);
assert.match(windowService, /async function prepare[\s\S]*?port.closeSession\(key\)[\s\S]*?port.disconnected\(key\)[\s\S]*?await port.showManagement\(id\)/, "switching to a detached window must close built-in VNC and restore the detection view");
assert.match(vncRuntime, /const showManagement = \(id: number\) => desktop\.open\(id,false,true\)/);
assert.doesNotMatch(vncRuntime, /embeddedVncSessionKeysForProfile|prepareVncManagementForDetachedWindow/);
assert.match(windowService,/pending=new Map[\s\S]*?state.claims.add\(claim\)/);
assert.match(windowService,/state.claims.delete[\s\S]*?state.claims.size[\s\S]*?state.child.close\(\)/);
assert.match(windowService,/state.status='committed'[\s\S]*?state.child.location.replace/);
assert.match(desktopWorkspace, /const reservation = updateTab[\s\S]*?port\.reserve\(id\)[\s\S]*?await port\.prepare\(profile/, "VNC quick-open must reserve the browser window before asynchronous probing through the desktop service");
assert.match(desktopWorkspace, /port\.detach\(id, key, \{closeDetectionTab: true, browserReservation: reservation\}\)[\s\S]*?finally \{[\s\S]*?port\.cancel\(reservation\)/, "failed or stale probes must close an unused reserved popup");
assert.match(sessionService,/await port.prepareEmbedded\(id\)/);
assert.match(desktopWorkspace, /id: 'remoteDesktopNewWindowButton'[^\n]*?port\.detach\(id, key\)/, "the VNC detection view must retain itself while opening a detached window");
assert.match(runtime, /DEFAULT_VNC_FULLSCREEN_TOOLBAR = "always"[\s\S]*?VNC_FULLSCREEN_TOOLBAR_MODES = new Set\(\["always", "never", "edge"\]\)/);
assert.match(storageRoutes, /vnc_fullscreen_toolbar:data\.vnc_fullscreen_toolbar \?\? current\.vnc_fullscreen_toolbar/, "the toolbar preference must survive runtime-settings saves");
assert.match(settings, /"id": "settings-general"[\s\S]*?h\(WorkspacePreferences/, "the toolbar preference must be exposed in general settings");
assert.doesNotMatch(settingsRuntime, /id="runtimeVncFullscreenToolbar"/, "the toolbar preference must not be mixed into listener settings");
assert.match(remoteDesktopViews, /class: 'vnc-fullscreen-toolbar-edge-zone'/, "the Vue fullscreen viewer must include a dedicated top-edge pointer target");
assert.match(fullscreen,/doc.addEventListener\(type,pointer,true\)/);
assert.match(fullscreen,/e.clientY<=1/);
assert.match(fullscreen,/element.contains\(session.workspace\)[\s\S]*?session.workspace.contains\(element\)/);
assert.match(css, /vnc-fullscreen-toolbar-edge-zone \{ position:fixed; top:0; left:0; right:0; z-index:60003; display:block; height:1px;/, "the top-edge target must remain above the noVNC canvas");
assert.match(css, /vnc-fullscreen-document:fullscreen \.modal \{ z-index:60030; \}/, "fullscreen VNC dialogs must remain above the canvas");
assert.match(css, /body\.vnc-detached-window-body \.app \{ display:none !important; \}/, "detached windows must hide only the main app chrome");
assert.doesNotMatch(css, /vnc-detached-window-body #(?:toast|modal)/, "detached VNC notifications and dialogs must remain visible");

async function checkWindowEnvironment() {
  const {vncWindowEnvironment} = require('./frontend-service-test-helper').loadFrontendService('frontend/src/features/remote/vnc-window-service.ts');
  const events = [], collect = (...event) => events.push(event);
  const popup = {closed:false};
  const host = {location:{href:'http://127.0.0.1/',origin:'http://127.0.0.1'}, open:(...args)=>{collect('popup',...args);return popup;}, close:()=>collect('close'),
    opener:{closed:false, focus:()=>collect('focus'), postMessage:(data,origin)=>collect('message',structuredClone(data),origin)}};
  const port = vncWindowEnvironment(host);
  assert.equal(port.href(),host.location.href);
  assert.equal(port.native(),false);
  assert.equal(port.popup(7),popup);
  assert.equal(await port.settings(7),true);
  assert.equal((await port.closeSelf()).ok,true);
  host.opener.closed=true;
  assert.equal(await port.settings(7),false);
  host.termaDesktop = {openVncWindow:(id,{key})=>{collect('openNative',id,key);return {ok:true};},
    closeVncWindowForProfile:id=>collect('closeNative',id), closeVncWindow:()=>collect('closeSelf'),
    openRemoteProfileSettings:id=>{collect('nativeSettings',id);return {ok:false};}};
  assert.equal(port.native(),true);
  assert.equal((await port.openNative(7,'remote-desktop-7')).ok,true);
  await port.closeNative(7);
  assert.equal(await port.settings(7),false);
  await port.closeSelf();
  assert.deepEqual(events,[['popup','','terma-vnc-7','popup,width=1280,height=820'],['focus'],['message',{type:'terma:remote-profile-settings',profileId:7},'http://127.0.0.1'],['close'],
    ['openNative',7,'remote-desktop-7'],['closeNative',7],['nativeSettings',7],['closeSelf']]);
}
checkWindowEnvironment().then(() => console.log("Detached VNC window checks passed"))
  .catch(error=>{console.error(error);process.exitCode=1;});
