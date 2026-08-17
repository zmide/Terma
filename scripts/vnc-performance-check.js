const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const vncCoreSource = fs.readFileSync(path.join(root, "public", "app-vnc-core.js"), "utf8");
const vncRemoteSource = fs.readFileSync(path.join(root, "public", "app-remote.js"), "utf8");
const vncProfileSource = fs.readFileSync(path.join(root, "public", "app-remote-profiles.js"), "utf8");
const vncSource = fs.readFileSync(path.join(root, "public", "app-vnc.js"), "utf8");
const vncClipboardSource = fs.readFileSync(path.join(root, "public", "app-vnc-clipboard.js"), "utf8");
const sftpTasksSource = fs.readFileSync(path.join(root, "public", "app-sftp-tasks.js"), "utf8");
const sftpCoreSource = fs.readFileSync(path.join(root, "public", "app-sftp-core.js"), "utf8");
const productivitySource = fs.readFileSync(path.join(root, "public", "app-productivity.js"), "utf8");
const desktopSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const loadAllSource = sourceBetween(appSource, "function autoRefreshDataChanged(", "\nfunction startAutoRefresh(");
const refreshState = {
  connections:[{id:1, name:"SSH"}],
  remoteProfiles:[{id:8, name:"VNC", host:"192.168.31.77"}],
  forwardTemplates:[{id:1, name:"Forward"}],
  securitySettings:{enabled:true},
  refreshInFlight:false,
  activeView:"remote-desktop",
  primaryView:"remote",
  renderConnectionsCount:0,
  renderForwardsCount:0,
  renderRunningCount:0,
  renderWelcomeCount:0
};
const refreshContext = vm.createContext({
  ...refreshState,
  api:async endpoint => {
    if (endpoint === "/api/connections") return structuredClone(refreshContext.nextConnections);
    if (endpoint === "/api/remote-profiles") return structuredClone(refreshContext.nextRemoteProfiles);
    if (endpoint === "/api/forward-templates") return structuredClone(refreshContext.nextForwardTemplates);
    if (endpoint === "/api/security") return {enabled:true};
    throw new Error(`unexpected endpoint: ${endpoint}`);
  },
  renderConnections:() => { refreshContext.renderConnectionsCount += 1; },
  renderForwards:() => { refreshContext.renderForwardsCount += 1; },
  renderRunningForwards:() => { refreshContext.renderRunningCount += 1; },
  renderStartupSummary:() => { refreshContext.renderWelcomeCount += 1; },
  structuredClone
});
refreshContext.nextConnections = structuredClone(refreshState.connections);
refreshContext.nextRemoteProfiles = structuredClone(refreshState.remoteProfiles);
refreshContext.nextForwardTemplates = structuredClone(refreshState.forwardTemplates);
vm.runInContext(`${loadAllSource}\nthis.loadAllForCheck = loadAll;`, refreshContext);

(async () => {
  await refreshContext.loadAllForCheck({silent:true});
  assert.equal(refreshContext.renderConnectionsCount, 0, "unchanged silent refresh must not rebuild the remote connection explorer");

  refreshContext.nextRemoteProfiles = [{id:8, name:"VNC renamed", host:"192.168.31.77"}];
  await refreshContext.loadAllForCheck({silent:true});
  assert.equal(refreshContext.renderConnectionsCount, 1, "changed remote profiles must still refresh the explorer");

  await refreshContext.loadAllForCheck();
  assert.equal(refreshContext.renderConnectionsCount, 2, "explicit refresh must preserve the existing forced-render behavior");

  const activeVncSource = sourceBetween(vncCoreSource, "function hasActiveEmbeddedVncRendering(", "\nfunction normalizeVncRemotePlatform(");
  const vncContext = vm.createContext({window:{termaVncDetached:false}, vncSessions:new Map()});
  vm.runInContext(`${activeVncSource}\nthis.hasActiveVncForCheck = hasActiveEmbeddedVncRendering;`, vncContext);
  assert.equal(vncContext.hasActiveVncForCheck(), false);
  vncContext.vncSessions.set("remote-desktop-8", {rfb:{}, connected:true, presentation:"viewer", screen:{isConnected:true}});
  assert.equal(vncContext.hasActiveVncForCheck(), true, "a connected embedded VNC viewer must activate the render-performance guard");
  vncContext.vncSessions.get("remote-desktop-8").presentation = "management";
  assert.equal(vncContext.hasActiveVncForCheck(), false, "the management page must not be treated as active VNC rendering");
  vncContext.window.termaVncDetached = true;
  assert.equal(vncContext.hasActiveVncForCheck(), true, "a detached VNC window must always use the render-performance guard");

  assert.match(appSource, /if \(!window\.termaVncDetached\) \{[\s\S]*?startAutoRefresh\(\);[\s\S]*?startSftpJobsTimer\(\);[\s\S]*?initProductivityFeatures\(\);[\s\S]*?\}/, "detached VNC windows must not start unrelated application background services");
  assert.match(sftpTasksSource, /if \(!drawer \|\| !list \|\| drawer\.hidden\) return;/, "a closed task drawer must not be rebuilt by polling");
  assert.match(sftpTasksSource, /jobsInterval = hasActiveJobs \? 2000 : drawerOpen \? 3000 : vncRendering \? 15000 : 10000/, "SFTP task polling must adapt to active work and VNC rendering");
  assert.match(sftpTasksSource, /runtimeConfiguredBackgroundIntervalMs\("sftp_active_status_poll_interval_ms", 5000\)/, "the active SFTP tab must use the configured responsive status check");
  assert.match(sftpTasksSource, /runtimeConfiguredBackgroundIntervalMs\("sftp_background_status_poll_interval_ms", 15000\)/, "background SFTP sessions must use the configured slower status check");
  assert.match(sftpTasksSource, /refreshActiveSftpSessionStatus\(\)/, "the slower SFTP pass must still cover every open session");
  const sftpStatusSource = sourceBetween(sftpCoreSource, "async function refreshActiveSftpSessionStatus(", "\nfunction closeSftpSession(");
  assert.doesNotMatch(sftpStatusSource, /ensureSftpConnection\(/, "background SFTP status checks must not force periodic SSH reconnects");
  assert.match(vncRemoteSource, /VNC_CLIPBOARD_LOCAL_IMAGE_POLL_INTERVAL_MS = 5000/);
  assert.match(vncRemoteSource, /VNC_CLIPBOARD_REMOTE_IMAGE_POLL_INTERVAL_MS = 3000/);
  assert.match(vncProfileSource, /VNC_PERFORMANCE_PRESETS/);
  assert.match(vncProfileSource, /smooth:\{quality:6\}/);
  assert.match(vncProfileSource, /remote_vnc_performance_preset/);
  assert.match(vncProfileSource, /applyVncPerformancePreset/);
  assert.match(vncProfileSource, /quality\.value = String\(preset\.quality\)/);
  assert.match(vncSource, /session\.rfb\.qualityLevel = Math\.max\(0, Math\.min\(9, Number\(profile\.options\?\.quality \?\? 8\)\)\)/, "editing an active VNC profile must apply the new quality without requiring a reconnect");
  assert.match(vncClipboardSource, /scheduleVncClipboardLocalImagePoll/);
  assert.match(vncClipboardSource, /scheduleVncClipboardRemoteImagePoll/);
  assert.match(vncClipboardSource, /runtimeConfiguredBackgroundIntervalMs\("vnc_remote_image_poll_interval_ms", VNC_CLIPBOARD_REMOTE_IMAGE_POLL_INTERVAL_MS\)/);
  assert.match(vncClipboardSource, /function refreshVncClipboardImagePollingIntervals\(/);
  const remoteImageScheduleSource = sourceBetween(vncClipboardSource, "function scheduleVncClipboardRemoteImagePoll(", "\nfunction refreshVncClipboardImagePollingIntervals(");
  assert.doesNotMatch(remoteImageScheduleSource, /requestIdleCallback/, "remote image metadata checks must not add another idle delay after the configured interval");
  assert.match(vncClipboardSource, /syncVncClipboardImagesAfterFocus/);
  assert.match(vncClipboardSource, /clipboardImageLastProcessedRevision/);
  const localImageSyncSource = sourceBetween(vncClipboardSource, "async function syncVncClipboardImageFromLocal(", "\nasync function pollVncRemoteClipboardImageBridge(");
  assert.ok(
    localImageSyncSource.indexOf("revision === session.clipboardImageLastProcessedRevision")
      < localImageSyncSource.indexOf("readVncLocalClipboardSnapshot(true)"),
    "unchanged Windows clipboard revisions must be rejected before PNG decoding"
  );
  const focusImageSyncSource = sourceBetween(vncClipboardSource, "async function syncVncClipboardImagesAfterFocus(", "\nasync function pollVncRemoteClipboardBridge(");
  assert.match(focusImageSyncSource, /syncVncClipboardImageFromLocal\(session\)/, "window focus must immediately run the lightweight local image check");
  assert.doesNotMatch(focusImageSyncSource, /forceContentRead/, "window focus must not force unchanged PNG decoding");
  assert.match(appSource, /setTimeout\(\(\) => \{ void syncVncClipboardImagesAfterFocus\(\); \}, 120\)/);
  assert.match(desktopSource, /image_revision:sequence > 0 \? `win32:\$\{sequence\}` : ""/, "only a reliable native clipboard sequence may suppress a full image read");
  assert.match(appSource, /refreshUiStateIfChanged/);
  assert.match(appSource, /runtimeConfiguredBackgroundIntervalMs\("ui_refresh_interval_ms", 4000\)/);
  const xServerRefreshSource = sourceBetween(productivitySource, "async function refreshXServerQuickAction(", "\nfunction installProductivityKeyboard(");
  assert.doesNotMatch(xServerRefreshSource, /refreshIcons\(/, "X Server status polling must not rescan and recreate icons across the VNC document");
  assert.match(xServerRefreshSource, /if \(button\.className !== className\)/, "X Server status polling must avoid unchanged DOM writes");

  console.log("PASS VNC rendering is isolated from periodic background DOM rebuilds");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
