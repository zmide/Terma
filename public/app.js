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
    connections = connectionRows;
    remoteProfiles = remoteRows || [];
    forwardTemplates = templateRows || [];
    if (!editingSettings) securitySettings = security;
    if (["connections", "remote"].includes(primaryView)) renderConnections();
    else if (primaryView === "running") renderRunningForwards();
    if (activeView === "forwards") renderForwards();
    if (activeView === "welcome") renderStartupSummary();
  } catch (error) {
    if (!options.silent) throw error;
  } finally {
    refreshInFlight = false;
  }
}
function startAutoRefresh() {
  [800, 1800, 3200, 5200, 8000].forEach(delay => {
    setTimeout(() => {
      if (!document.hidden) loadAll({silent:true});
    }, delay);
  });
  setInterval(() => {
    if (!document.hidden) loadAll({silent:true});
  }, 4000);
  setInterval(() => {
    if (!window.termaDesktop && !document.hidden) pollNotifications();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadAll({silent:true});
      if (!window.termaDesktop) pollNotifications();
    }
  });
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
window.addEventListener("focusout", () => setTimeout(syncViewportHeight, 120));
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
window.termaDesktop?.onSftpDragError?.(message => notify(message, "error"));
window.termaDesktop?.onNotification?.(payload => {
  void handleNotificationEvent(payload?.event, {fromDesktop:true, display:payload?.display !== false});
});
window.termaDesktop?.onNotificationAction?.(action => handleNotificationAction(action));
Promise.all([loadAll(), loadRuntimeSettings()]).then(() => {
  const restored = restoreTabsState();
  if (!restored) renderWelcome();
  window.workspaceRestorePending = false;
  saveTabsState();
  syncResponsivePane();
}).catch(e=>{
  window.workspaceRestorePending = false;
  notify(e.message,"error");
});
startAutoRefresh();
if (!window.termaDesktop) pollNotifications();
refreshSftpJobs();
startSftpJobsTimer();
initProductivityFeatures();
