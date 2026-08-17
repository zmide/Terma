function isDetachedVncWindow() {
  return Boolean(window.termaVncDetached);
}

const browserDetachedVncWindows = new Map();

function reserveVncDetachedBrowserWindow(profileId) {
  const id = Number(profileId || 0);
  if (!Number.isInteger(id) || id <= 0 || window.termaDesktop?.openVncWindow) return null;
  const existing = browserDetachedVncWindows.get(id);
  if (existing && !existing.closed) return {profileId:id, child:existing, created:false, blocked:false};
  const child = window.open("", `terma-vnc-${id}`, "popup,width=1280,height=820");
  if (!child) return {profileId:id, child:null, created:false, blocked:true};
  browserDetachedVncWindows.set(id, child);
  return {profileId:id, child, created:true, blocked:false};
}

function cancelReservedVncDetachedBrowserWindow(reservation) {
  if (!reservation?.created) return;
  const id = Number(reservation.profileId || 0);
  const child = reservation.child;
  if (child && !child.closed) child.close();
  if (browserDetachedVncWindows.get(id) === child) browserDetachedVncWindows.delete(id);
}

function embeddedVncSessionKeysForProfile(profileId, preferredKey="") {
  const id = Number(profileId || 0);
  const keys = new Set();
  if (preferredKey && Number(vncSessions.get(preferredKey)?.profile?.id || 0) === id) keys.add(preferredKey);
  for (const [key, session] of vncSessions) {
    if (!String(key).startsWith("detached-vnc-") && Number(session?.profile?.id || 0) === id) keys.add(key);
  }
  return [...keys];
}

function prepareVncManagementForDetachedWindow(profileId, preferredKey="") {
  if (isDetachedVncWindow()) return Promise.resolve(false);
  const id = Number(profileId || 0);
  const sessionKeys = embeddedVncSessionKeysForProfile(id, preferredKey);
  if (!sessionKeys.length) return Promise.resolve(false);
  for (const key of sessionKeys) {
    closeRemoteProtocolSession(key);
    setWorkspaceTabConnectionStatus(key, "disconnected");
  }
  return Promise.resolve(openRemoteDesktop(id, false, true)).then(() => true);
}

async function closeVncDetachedWindowForProfile(profileId) {
  const id = Number(profileId || 0);
  if (!Number.isInteger(id) || id <= 0 || isDetachedVncWindow()) return {ok:false, closed:false};
  if (window.termaDesktop?.closeVncWindowForProfile) return window.termaDesktop.closeVncWindowForProfile(id);
  const child = browserDetachedVncWindows.get(id);
  if (!child || child.closed) {
    browserDetachedVncWindows.delete(id);
    return {ok:true, profileId:id, closed:false};
  }
  child.close();
  browserDetachedVncWindows.delete(id);
  return {ok:true, profileId:id, closed:true};
}

async function openVncInNewWindow(profileId, key="", options={}) {
  const id = Number(profileId || 0);
  if (!Number.isInteger(id) || id <= 0) return notify(tr("remote:vnc_ui.detached_profile_missing", {defaultValue:"VNC 连接不存在"}), "error");
  try {
    if (window.termaDesktop?.openVncWindow) {
      const managementReady = prepareVncManagementForDetachedWindow(id, key);
      await window.termaDesktop.openVncWindow(id, {key});
      await managementReady;
      if (options.closeDetectionTab && key && tabs.some(tab => tab.key === key)) closeTabsByKey([key], key);
      return true;
    }
    const url = new URL(location.href);
    url.searchParams.set("termaVncWindow", String(id));
    const reservation = Number(options.browserReservation?.profileId || 0) === id ? options.browserReservation : null;
    if (reservation?.blocked) throw new Error(tr("remote:vnc_ui.detached_open_failed", {defaultValue:"无法打开新窗口，请检查浏览器弹窗权限"}));
    let child = reservation?.child || browserDetachedVncWindows.get(id);
    if (child && !child.closed && !reservation?.created) {
      child.focus();
      await prepareVncManagementForDetachedWindow(id, key);
      if (options.closeDetectionTab && key && tabs.some(tab => tab.key === key)) closeTabsByKey([key], key);
      return true;
    }
    if (!child || child.closed) child = window.open(url.href, `terma-vnc-${id}`, "popup,width=1280,height=820");
    if (!child) throw new Error(tr("remote:vnc_ui.detached_open_failed", {defaultValue:"无法打开新窗口，请检查浏览器弹窗权限"}));
    browserDetachedVncWindows.set(id, child);
    if (reservation?.created) child.location.replace(url.href);
    child.focus();
    await prepareVncManagementForDetachedWindow(id, key);
    if (options.closeDetectionTab && key && tabs.some(tab => tab.key === key)) closeTabsByKey([key], key);
    return true;
  } catch (error) {
    cancelReservedVncDetachedBrowserWindow(options.browserReservation);
    notify(window.termaDesktop?.openVncWindow
      ? tr("remote:vnc_ui.detached_open_failed", {defaultValue:"无法打开 VNC 新窗口，请重试"})
      : error.message || tr("remote:vnc_ui.detached_open_failed", {defaultValue:"无法打开 VNC 新窗口"}), "error");
    return false;
  }
}

async function prepareEmbeddedVncWindowSwitch(profileId) {
  if (isDetachedVncWindow()) return true;
  try {
    await closeVncDetachedWindowForProfile(profileId);
    return true;
  } catch (error) {
    notify(error.message || tr("remote:vnc_ui.window_switch_failed", {defaultValue:"无法切换 VNC 显示窗口"}), "error");
    return false;
  }
}

async function closeDetachedVncWindow(key="") {
  if (key) closeRemoteProtocolSession(key);
  if (window.termaDesktop?.closeVncWindow) return window.termaDesktop.closeVncWindow();
  window.close();
  return {ok:true};
}

async function initDetachedVncWindow(profileId) {
  const id = Number(profileId || 0);
  const profile = remoteProfileById(id);
  if (!profile || profile.protocol !== "vnc") {
    notify(tr("remote:vnc_ui.detached_profile_missing", {defaultValue:"VNC 连接不存在"}), "error");
    return false;
  }
  document.documentElement.classList.add("vnc-detached-window");
  document.body.classList.add("vnc-detached-window-body");
  let root = document.getElementById("vncDetachedRoot");
  if (!root) {
    root = document.createElement("main");
    root.id = "vncDetachedRoot";
    root.className = "vnc-detached-root";
    document.body.appendChild(root);
  }
  const key = `detached-vnc-${id}`;
  if (typeof activeTabKey !== "undefined") activeTabKey = key;
  renderEmbeddedVnc(profile, key, null, root, true);
  return true;
}

function vncFullscreenToolbarMode() {
  const value = runtimeSettings?.saved?.vnc_fullscreen_toolbar;
  return ["always", "never", "edge"].includes(value) ? value : "always";
}

function syncVncFullscreenToolbarLabel(session, active) {
  const button = session?.workspace?.querySelector?.("[data-vnc-fullscreen-toggle]");
  if (!button) return;
  const label = tr(active ? "remote:vnc_ui.exit_fullscreen" : "remote:vnc_ui.enter_fullscreen", {defaultValue:active ? "退出内部全屏" : "进入内部全屏"});
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon(active ? "minimize-2" : "maximize-2");
}

function syncVncFullscreenPresentation() {
  const session = vncSessions.get(vncFullscreenSessionKey);
  const active = document.fullscreenElement === document.documentElement && Boolean(session?.viewport?.isConnected);
  for (const item of vncSessions.values()) {
    const selected = active && item === session;
    item.viewport?.classList.toggle("vnc-fullscreen-active", selected);
    item.workspace?.classList.toggle("vnc-fullscreen-active", selected);
    item.workspace?.classList.toggle("vnc-fullscreen-toolbar-always", selected && vncFullscreenToolbarMode() === "always");
    item.workspace?.classList.toggle("vnc-fullscreen-toolbar-never", selected && vncFullscreenToolbarMode() === "never");
    item.workspace?.classList.toggle("vnc-fullscreen-toolbar-edge", selected && vncFullscreenToolbarMode() === "edge");
    syncVncFullscreenToolbarLabel(item, selected);
  }
  document.documentElement.classList.toggle("vnc-fullscreen-document", active);
  document.documentElement.classList.toggle("vnc-fullscreen-toolbar-edge-visible", false);
  if (!active) {
    if (!document.fullscreenElement || document.fullscreenElement === document.documentElement) vncFullscreenSessionKey = "";
    return;
  }
  requestAnimationFrame(() => {
    try { applyVncDisplayMode(session); } catch {}
    focusEmbeddedVnc(session);
  });
}

const VNC_FULLSCREEN_TOOLBAR_HIDE_DELAY_MS = 500;

function hideVncFullscreenEdgeToolbar(delay=VNC_FULLSCREEN_TOOLBAR_HIDE_DELAY_MS) {
  clearTimeout(window.__termaVncToolbarHideTimer);
  window.__termaVncToolbarHideTimer = setTimeout(() => document.documentElement.classList.remove("vnc-fullscreen-toolbar-edge-visible"), delay);
}

function activeVncFullscreenEdgeSession() {
  const session = vncSessions.get(vncFullscreenSessionKey);
  const fullscreenElement = document.fullscreenElement;
  if (!fullscreenElement || vncFullscreenToolbarMode() !== "edge" || !session?.workspace?.isConnected) return null;
  const containsSession = fullscreenElement === document.documentElement
    || fullscreenElement.contains(session.workspace)
    || session.workspace.contains(fullscreenElement);
  return containsSession && session.workspace.classList.contains("vnc-fullscreen-toolbar-edge") ? session : null;
}

function handleVncFullscreenEdgePointer(event) {
  const session = activeVncFullscreenEdgeSession();
  if (!session) return;
  const target = event.target instanceof Element ? event.target : null;
  const overEdgeZone = Boolean(target?.closest(".vnc-fullscreen-toolbar-edge-zone"));
  if (overEdgeZone || event.clientY <= 1) {
    document.documentElement.classList.add("vnc-fullscreen-toolbar-edge-visible");
    clearTimeout(window.__termaVncToolbarHideTimer);
    return;
  }
  if (document.documentElement.classList.contains("vnc-fullscreen-toolbar-edge-visible")) {
    if (event.clientY <= Math.max(52, session.workspace.querySelector(".vnc-toolbar")?.getBoundingClientRect().bottom || 0)) {
      clearTimeout(window.__termaVncToolbarHideTimer);
    } else hideVncFullscreenEdgeToolbar();
  }
}

if (typeof document !== "undefined") document.addEventListener("fullscreenchange", syncVncFullscreenPresentation);
if (typeof document !== "undefined") {
  document.addEventListener("pointerover", handleVncFullscreenEdgePointer, true);
  document.addEventListener("pointermove", handleVncFullscreenEdgePointer, true);
  document.addEventListener("mouseover", handleVncFullscreenEdgePointer, true);
  document.addEventListener("mousemove", handleVncFullscreenEdgePointer, true);
}

async function toggleVncFullscreen(key) {
  const session = vncSessions.get(key);
  if (!session?.viewport) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
    return;
  }
  if (!document.documentElement.requestFullscreen) return notify(tr("remote:vnc_ui.fullscreen_unsupported", {defaultValue:"当前环境不支持全屏显示"}), "info");
  // noVNC may render its software cursor as a body-level overlay. Keeping the
  // whole document in the fullscreen tree prevents that cursor from vanishing.
  vncFullscreenSessionKey = key;
  session.viewport.classList.add("vnc-fullscreen-active");
  try {
    await document.documentElement.requestFullscreen();
    syncVncFullscreenPresentation();
  } catch (error) {
    session.viewport.classList.remove("vnc-fullscreen-active");
    vncFullscreenSessionKey = "";
    notify(error.message || tr("remote:vnc_ui.fullscreen_failed", {defaultValue:"无法进入全屏"}), "error");
  }
}
