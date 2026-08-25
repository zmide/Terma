const termaVncWindowParams = new URLSearchParams(location.search);
const termaVncDetachedProfileId = Number(termaVncWindowParams.get("termaVncWindow") || 0);
window.termaVncDetached = Number.isInteger(termaVncDetachedProfileId) && termaVncDetachedProfileId > 0;
if (window.termaVncDetached) {
  document.documentElement.classList.add("vnc-detached-window");
  document.body.classList.add("vnc-detached-window-body");
}

function autoRefreshDataChanged(previous, next) {
  if (previous === next) return false;
  try {
    return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
  } catch {
    return true;
  }
}

let autoRefreshRevision = "";
let autoRefreshRevisionInFlight = false;
let autoRefreshTimer = 0;
let notificationPollTimer = 0;
const FOREGROUND_NOTIFICATION_POLL_MS = 1200;
const BACKGROUND_NOTIFICATION_POLL_MS = 15000;

function uiStateRefreshIntervalMs() {
  return typeof runtimeConfiguredBackgroundIntervalMs === "function"
    ? runtimeConfiguredBackgroundIntervalMs("ui_refresh_interval_ms", 4000)
    : 4000;
}

async function refreshUiStateIfChanged(options={}) {
  if (autoRefreshRevisionInFlight || document.hidden) return false;
  autoRefreshRevisionInFlight = true;
  try {
    const result = await api("/api/ui-state/revision");
    const revision = String(result?.revision || "");
    const first = !autoRefreshRevision;
    const changed = Boolean(revision && revision !== autoRefreshRevision);
    if (revision) autoRefreshRevision = revision;
    if (options.force === true || (!first && changed)) await loadAll({silent:true});
    return changed;
  } catch {
    await loadAll({silent:true});
    return true;
  } finally {
    autoRefreshRevisionInFlight = false;
  }
}

async function loadAll(options={}){
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const editingSettings = activeView === "settings" && document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    const [connectionRows, remoteRows, templateRows, security] = await Promise.all([
      api("/api/connections"),
      api("/api/remote-profiles").catch(() => remoteProfiles),
      api("/api/forward-templates").catch(() => forwardTemplates),
      editingSettings ? Promise.resolve(securitySettings) : api("/api/security").catch(() => securitySettings)
    ]);
    const connectionsChanged = autoRefreshDataChanged(connections, connectionRows);
    const remoteProfilesChanged = autoRefreshDataChanged(remoteProfiles, remoteRows || []);
    const forwardTemplatesChanged = autoRefreshDataChanged(forwardTemplates, templateRows || []);
    const renderUnchanged = options.silent !== true || options.forceRender === true;
    connections = connectionRows;
    remoteProfiles = remoteRows || [];
    forwardTemplates = templateRows || [];
    if (!editingSettings) securitySettings = security;
    if (primaryView === "connections" && (renderUnchanged || connectionsChanged)) renderConnections();
    else if (primaryView === "remote" && (renderUnchanged || connectionsChanged || remoteProfilesChanged)) renderConnections();
    else if (primaryView === "running" && (renderUnchanged || connectionsChanged)) renderRunningForwards();
    if (activeView === "forwards" && (renderUnchanged || connectionsChanged || forwardTemplatesChanged)) renderForwards();
    if (activeView === "forward-manager" && (renderUnchanged || connectionsChanged || forwardTemplatesChanged) && typeof renderGlobalForwardManager === "function") renderGlobalForwardManager();
    if (activeView === "welcome") renderStartupSummary();
  } catch (error) {
    if (!options.silent) throw error;
  } finally {
    refreshInFlight = false;
  }
}
function startAutoRefresh() {
  const scheduleRefresh = delay => {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(async () => {
      if (!document.hidden) await refreshUiStateIfChanged();
      scheduleRefresh(document.hidden ? 15000 : uiStateRefreshIntervalMs());
    }, Math.max(0, Number(delay || 0)));
  };
  const scheduleNotifications = delay => {
    if (window.termaDesktop) return;
    clearTimeout(notificationPollTimer);
    notificationPollTimer = setTimeout(async () => {
      if (!document.hidden) await pollNotifications();
      scheduleNotifications(document.hidden ? BACKGROUND_NOTIFICATION_POLL_MS : FOREGROUND_NOTIFICATION_POLL_MS);
    }, Math.max(0, Number(delay || 0)));
  };
  setTimeout(() => { if (!document.hidden) void refreshUiStateIfChanged({force:true}); }, 800);
  setTimeout(() => { if (!document.hidden) void refreshUiStateIfChanged(); }, 2500);
  scheduleRefresh(uiStateRefreshIntervalMs());
  scheduleNotifications(FOREGROUND_NOTIFICATION_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshUiStateIfChanged();
      if (!window.termaDesktop) pollNotifications();
      scheduleRefresh(uiStateRefreshIntervalMs());
      scheduleNotifications(FOREGROUND_NOTIFICATION_POLL_MS);
    }
  });
}
let terminalWindowResumeRefreshTimer = 0;
function scheduleTerminalWindowResumeRefresh() {
  clearTimeout(terminalWindowResumeRefreshTimer);
  terminalWindowResumeRefreshTimer = setTimeout(() => {
    terminalWindowResumeRefreshTimer = 0;
    if (typeof refreshTerminalSessionsAfterWindowResume === "function") refreshTerminalSessionsAfterWindowResume();
    requestAnimationFrame(() => {
      if (typeof refreshTerminalSessionsAfterWindowResume === "function") refreshTerminalSessionsAfterWindowResume();
    });
    if (typeof syncVncClipboardImagesAfterFocus === "function") {
      setTimeout(() => { void syncVncClipboardImagesAfterFocus(); }, 120);
    }
  }, 0);
}
window.workspaceRestorePending = true;
applyTheme(preferredTheme());
renderExplorerTools();
initOperationPaneBehavior();
loadCachedUpdateStatus();
syncViewportHeight();
bindNativeFileDialogViewportRecovery();
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("scroll", syncViewportHeight);
window.addEventListener("resize", () => { syncViewportHeight(); syncResponsivePane(); });
window.addEventListener("orientationchange", () => setTimeout(syncViewportHeight, 250));
window.addEventListener("focus", scheduleTerminalWindowResumeRefresh);
window.addEventListener("pageshow", scheduleTerminalWindowResumeRefresh);
window.addEventListener("focusout", () => setTimeout(syncViewportHeight, 120));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleTerminalWindowResumeRefresh();
});
window.restoringTabs = true;
renderWelcome();
window.restoringTabs = false;
$("connectionGroups")?.addEventListener("scroll", onConnectionScroll, {passive:true});
document.addEventListener("contextmenu", showCommandContextMenu);
$("modal")?.addEventListener("click", event => {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
document.addEventListener("click", event => {
  hideActionMenu();
  hideCommandContextMenu();
  hideSftpContextMenu();
  hideTabContextMenu();
  if (!event.target?.closest?.("#sftpTaskCenter")) closeSftpTaskCenter();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    hideActionMenu();
    hideCommandContextMenu();
    hideSftpContextMenu();
    hideTabContextMenu();
    closeSftpTaskCenter();
  }
});
refreshIcons();
document.addEventListener("scroll", () => {
  if (!isMobileLayout()) hideActionMenu();
}, true);
window.termaDesktop?.onSftpDragError?.(message => notify(
  message || tr("sftp:drag.native_start_failed", {defaultValue:"无法启动系统拖拽"}),
  "error"
));
window.termaDesktop?.onNotification?.(payload => {
  void handleNotificationEvent(payload?.event, {fromDesktop:true, display:payload?.display !== false});
});
window.termaDesktop?.onNotificationAction?.(action => handleNotificationAction(action));
window.termaDesktop?.onRemoteProfileSettings?.(profileId => {
  const id = Number(profileId || 0);
  if (!Number.isInteger(id) || id <= 0) return;
  const open = () => {
    if (typeof editRemoteProfile === "function") editRemoteProfile(id);
    else setTimeout(open, 50);
  };
  open();
});
Promise.all([loadAll(), loadRuntimeSettings()]).then(async () => {
  if (window.termaVncDetached) {
    await setTermaLanguage(runtimeSettings?.saved?.language || document.documentElement.lang, {render:false, emit:false});
    await initDetachedVncWindow(termaVncDetachedProfileId);
    window.workspaceRestorePending = false;
    return;
  }
  await ensureTermaLanguageOnboarding();
  const restored = restoreTabsState();
  if (!restored) renderWelcome();
  window.workspaceRestorePending = false;
  saveTabsState();
  syncResponsivePane();
}).catch(e=>{
  window.workspaceRestorePending = false;
  notify(e.message,"error");
});
if (!window.termaVncDetached) {
  startAutoRefresh();
  if (!window.termaDesktop) pollNotifications();
  refreshSftpJobs();
  startSftpJobsTimer();
  initProductivityFeatures();
}
