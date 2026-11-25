const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {loadFrontendService} = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const {hasActiveVncRendering} = loadFrontendService('frontend/src/features/remote/vnc-presentation.ts');
const clipboardPollingPath = path.join(root, "frontend/src/features/remote/vnc-clipboard-polling.ts");
const sftpTasksSource = fs.readFileSync(path.join(root, "frontend/src/entries", "about-embed.ts"), "utf8");
const sftpPollerSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "files", "sftp", "sftp-task-poller.ts"), "utf8");
const sftpConnectionSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "files", "sftp", "connection-service.ts"), "utf8");
const x11LocalService = fs.readFileSync(path.join(root, "frontend", "src", "features", "x11", "local-service.ts"), "utf8");
const taskCenterVue = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "TaskCenter.ts"), "utf8");
const quickHeaderVue = fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "QuickHeader.ts"), "utf8");
const desktopSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
const applicationLifecycleSource = fs.readFileSync(path.join(root, "frontend/src/shared/application-lifecycle-service.ts"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const refreshSource = fs.readFileSync(path.join(root, 'frontend/src/shared/workspace-refresh.ts'), 'utf8');
const {createWorkspaceDataRefresh} = loadFrontendService('frontend/src/shared/data-refresh.ts');
const workspaceBootstrap = fs.readFileSync(path.join(root, "frontend/src/shared/workspace-bootstrap.ts"), "utf8");
const bootstrapBackgroundSource = fs.readFileSync(path.join(root, "frontend/src/shared/bootstrap-background.ts"), "utf8");
const refreshState = {
  connections:[{id:1, name:"SSH"}],
  remoteProfiles:[{id:8, name:"VNC", host:"192.168.31.77"}],
  forwardTemplates:[{id:1, name:"Forward"}],
  securitySettings:{enabled:true},
  activeView:"remote-desktop",
  primaryView:"remote",
  renderConnectionsCount:0,
  renderForwardsCount:0,
  renderRunningCount:0,
  renderWelcomeCount:0
};
const refreshContext = {
  ...refreshState,
  nextConnections: structuredClone(refreshState.connections),
  nextRemoteProfiles: structuredClone(refreshState.remoteProfiles),
  nextForwardTemplates: structuredClone(refreshState.forwardTemplates)
};
const refresh = createWorkspaceDataRefresh({
  request:async endpoint => {
    if (endpoint === "/api/connections") return structuredClone(refreshContext.nextConnections);
    if (endpoint === "/api/remote-profiles") return structuredClone(refreshContext.nextRemoteProfiles);
    if (endpoint === "/api/forward-templates") return structuredClone(refreshContext.nextForwardTemplates);
    if (endpoint === "/api/security") return {enabled:true};
    throw new Error(`unexpected endpoint: ${endpoint}`);
  },
  readCurrent: () => ({...refreshContext, security:refreshContext.securitySettings}),
  commit: snapshot => Object.assign(refreshContext, snapshot),
  primaryView: () => refreshContext.primaryView,
  activeView: () => refreshContext.activeView,
  renderConnections:() => { refreshContext.renderConnectionsCount += 1; },
  renderWelcome:() => { refreshContext.renderWelcomeCount += 1; },
  renderForwards:() => { refreshContext.renderForwardsCount += 1; },
  renderRunning:() => { refreshContext.renderRunningCount += 1; }
});

(async () => {
  await refresh.load({silent:true});
  assert.equal(refreshContext.renderConnectionsCount, 0, "unchanged silent refresh must not rebuild the remote connection explorer");

  refreshContext.nextRemoteProfiles = [{id:8, name:"VNC renamed", host:"192.168.31.77"}];
  await refresh.load({silent:true});
  assert.equal(refreshContext.renderConnectionsCount, 1, "changed remote profiles must still refresh the explorer");

  await refresh.load();
  assert.equal(refreshContext.renderConnectionsCount, 2, "explicit refresh must preserve the existing forced-render behavior");
  const previousForwardPaints = refreshContext.renderForwardsCount;
  refreshContext.primaryView = 'running';
  refreshContext.activeView = 'forward-manager';
  await refresh.load();
  assert.equal(refreshContext.renderForwardsCount, previousForwardPaints + 1, "all open forward pages share one refresh per data commit");
  assert.equal(refreshContext.renderRunningCount, 1, "refresh also updates the running-forward explorer");
  refreshContext.activeView = 'welcome';
  await refresh.load({silent:true});
  assert.equal(refreshContext.renderWelcomeCount, 1, 'the welcome summary still updates on an unchanged silent refresh');

  const vnc = {rfb:{}, connected:true, presentation:"viewer", screen:{isConnected:true}};
  assert.equal(hasActiveVncRendering([], false), false);
  assert.equal(hasActiveVncRendering([vnc], false), true, "a connected embedded VNC viewer must activate the render-performance guard");
  vnc.presentation = "management";
  assert.equal(hasActiveVncRendering([vnc], false), false, "the management page must not be treated as active VNC rendering");
  assert.equal(hasActiveVncRendering([], true), true, "a detached VNC window must always use the render-performance guard");
  assert.match(sftpTasksSource, /termaVncRuntime\?\.renderingActive\(\)/, "SFTP polling reads active rendering from the typed VNC owner");

  assert.match(workspaceBootstrap, /background\.start\(backgroundPort, \{\s*detached: Boolean\(remoteServices\.termaVncDetached\)\s*\}\)/, "startup passes detached mode to the shared background owner");
  assert.match(bootstrapBackgroundSource, /if \(detached\) \{[\s\S]*?return;[\s\S]*?await port\.startAutoRefresh/, "detached VNC windows must not start unrelated application background services");
  assert.match(taskCenterVue, /visible\.map\(\s*job\s*=>\s*h\(Fragment,\s*\{\s*key:\s*job\.id\s*\}/, "Vue task rows must keep stable keys so polling patches existing DOM rows");
  assert.match(taskCenterVue, /paintQuickView\(host, content\)/, "task center updates must pass through Vue's keyed DOM patcher");
  assert.match(sftpPollerSource, /jobsInterval = state\.hasActiveJobs \? 2000 : state\.drawerOpen \? 3000 : state\.vncRendering \? 15000 : 10000/, "SFTP task polling must adapt to active work and VNC rendering");
  assert.match(sftpTasksSource, /termaRuntimeSettingsModel\.interval\('sftp_active_status_poll_interval_ms',\s*5000\)/, "the active SFTP tab must use the configured responsive status check");
  assert.match(sftpTasksSource, /termaRuntimeSettingsModel\.interval\('sftp_background_status_poll_interval_ms',\s*15000\)/, "background SFTP sessions must use the configured slower status check");
  assert.match(sftpTasksSource, /refreshSessions: key => sftpConnection\.refresh\(key\)/, "the bridge must preserve the optional session selector");
  assert.match(sftpPollerSource, /port\.refreshSessions\(\)/, "the slower SFTP pass must still cover every open session");
  const sftpStatusSource = sourceBetween(sftpConnectionSource, "async function refresh(", "\n  function close(");
  assert.doesNotMatch(sftpStatusSource, /\bensure\(|'POST'|'DELETE'/, "background SFTP status checks must not force periodic SSH reconnects");
  assert.match(sftpStatusSource, /port\.request\(id, 'GET'\)/, "background status checks must only observe existing SFTP sessions");
  const profileView=fs.readFileSync(path.join(root,'frontend/src/features/connections/RemoteProfileForm.tsx'),'utf8');
  assert.match(profileView,/qualityPresets = \{balanced:8,smooth:6\}/);
  assert.match(profileView,/remote_vnc_performance_preset/);
  assert.match(profileView,/draft\.value\.remote_quality=String\(quality\.value\)/);

  const sessionOwner=fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-session-service.ts'),'utf8');
  assert.match(sessionOwner, /if\(session.rfb\)\{session.rfb.qualityLevel=Math.max\(0,Math.min\(9,Number\(profile.options\?\.quality\?\?8\)\)\)/, "editing an active VNC profile must apply the new quality without requiring a reconnect");
  const timeouts = new Map();
  const idle = new Map();
  let token = 0, localImages = 0, remoteImages = 0;
  const {createVncClipboardPolling} = loadFrontendService(clipboardPollingPath, {
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: (callback, delay) => {const id=++token;timeouts.set(id,{callback,delay});return id;},
    clearTimeout: id => timeouts.delete(id),
    requestIdleCallback: callback => {const id=++token;idle.set(id,callback);return id;},
    cancelIdleCallback: id => idle.delete(id)
  });
  const session = {connected:true,clipboardAutoSync:true,clipboardAutoSyncImages:true};
  const poller = createVncClipboardPolling({
    sessions: () => [session], interval: (key, fallback) => key.startsWith('vnc_local') ? fallback + 1000 : fallback,
    now: () => 2000, text: {transport: async () => "rfb"},
    images: {automatic: () => true, fromLocal: async () => {localImages++;}, poll: async () => {remoteImages++;}}
  });
  poller.start(session);
  const [local, remote] = [...timeouts.entries()];
  assert.equal(local[1].delay,6000,"local images use the configured interval");
  assert.equal(remote[1].delay,3000,"remote images retain their default interval");
  timeouts.delete(remote[0]);remote[1].callback();
  assert.equal(remoteImages,1,"remote image polling does not wait for idle decoding");
  timeouts.delete(local[0]);local[1].callback();
  assert.equal(localImages,0,"local decoding waits until idle");
  const queuedIdle = [...idle.values()][0];
  poller.refresh();
  assert.equal(idle.size,0,"refresh cancels old idle callbacks");
  queuedIdle();
  assert.equal(localImages,0,"an obsolete polling generation cannot read the clipboard");
  await poller.afterFocus();
  assert.equal(localImages,1,"focus immediately checks local image metadata");
  poller.stop(session);
  assert.equal(timeouts.size,0,"stopping clears both image schedules");
  const imageOwner = fs.readFileSync(path.join(root, "frontend/src/features/remote/vnc-clipboard-images.ts"), "utf8");
  const localImageSyncSource = sourceBetween(imageOwner, "async function fromLocal(", "\n  async function changedRemoteHash(");
  assert.ok(
    localImageSyncSource.includes("revision === state.deliveredRevision")
      && localImageSyncSource.indexOf("revision === state.deliveredRevision") < localImageSyncSource.indexOf("port.local.readSnapshot(true)"),
    "unchanged Windows clipboard revisions must be rejected before PNG decoding"
  );
  assert.match(workspaceBootstrap, /termaVncRuntime\?\.syncImagesAfterFocus\(\)/);
  assert.match(applicationLifecycleSource, /attempt\('vnc-clipboard', port\.syncVncClipboard\)/);
  assert.match(applicationLifecycleSource, /\}, 120\)/);
  assert.match(desktopSource, /image_revision:sequence > 0 \? `win32:\$\{sequence\}` : ""/, "only a reliable native clipboard sequence may suppress a full image read");
  assert.match(refreshSource, /revision\.check\(options\)/);
  assert.match(refreshSource, /runtimeConfiguredBackgroundIntervalMs\('ui_refresh_interval_ms', backgroundIntervals\.ui_refresh_interval_ms\)/);
  const xServerRefreshSource = sourceBetween(x11LocalService, "function refreshHeader()", "\n function schedule(");
  assert.match(xServerRefreshSource, /port\.header\(d\)/, "X Server status polling must delegate rendering through the explicit header port");
  assert.match(quickHeaderVue, /const status = data\?\.available && !unauthorized \? 'ready' : data\?\.running \|\| unauthorized \? 'warning' : 'error'/, "Vue quick header must derive its X Server state from the latest diagnostics");
  assert.match(quickHeaderVue, /paintQuickView\(host, \[/, "X Server status updates must pass through Vue's view renderer");
  assert.doesNotMatch(quickHeaderVue, /querySelector|innerHTML/, "the migrated quick header must not mutate the DOM outside Vue");

  console.log("PASS VNC rendering is isolated from periodic background DOM rebuilds");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
