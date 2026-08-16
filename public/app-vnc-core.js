function noVncRfbClass() {
  if (!noVncRfbPromise) noVncRfbPromise = import("/vendor/novnc/core/rfb.js").then(module => module.default);
  return noVncRfbPromise;
}

function normalizeVncRemotePlatform(value="") {
  const platform = String(value || "").trim().toLowerCase();
  if (["darwin", "mac", "macos", "osx"].includes(platform)) return "macos";
  if (platform === "linux" || platform.startsWith("linux-")) return "linux";
  return platform;
}

function vncCursorMode(session) {
  const mode = String(session?.profile?.options?.cursor_mode || "auto").trim().toLowerCase();
  return ["auto", "show", "hide"].includes(mode) ? mode : "auto";
}

function vncUsesFramebufferCursor(session) {
  const platform = normalizeVncRemotePlatform(session?.remotePlatform || session?.vncServerDiagnostics?.platform || session?.vncServerDiagnostics?.os_id);
  if (platform !== "macos") return false;
  const diagnostics = session?.vncServerDiagnostics || null;
  const serviceUnit = String(diagnostics?.service_unit || "").trim().toLowerCase();
  const builtinScreenSharing = diagnostics?.builtin === true || serviceUnit === "com.apple.screensharing";
  // macOS Screen Sharing paints the pointer into the framebuffer. If the
  // server was not identified, keep the macOS-safe fallback; an explicit
  // third-party server marker can opt out when it provides RFB cursor shapes.
  return builtinScreenSharing || !diagnostics || diagnostics?.builtin !== false;
}

function applyVncCursorPolicy(session, rfb=session?.rfb) {
  if (!session) return false;
  const mode = vncCursorMode(session);
  const hideLocalCursor = mode === "hide" || (mode === "auto" && vncUsesFramebufferCursor(session));
  session.localCursorHidden = hideLocalCursor;
  session.screen?.classList.toggle("vnc-hide-local-cursor", hideLocalCursor);
  const canvas = rfb?._canvas;
  canvas?.classList.toggle("vnc-local-cursor-target", hideLocalCursor);
  const fallbackCursorCanvas = rfb?._cursor?._canvas;
  fallbackCursorCanvas?.classList.toggle("vnc-local-cursor-overlay-hidden", hideLocalCursor);
  if (rfb) rfb.showDotCursor = !hideLocalCursor;
  renderVncCursorModeControl(session);
  return hideLocalCursor;
}

function vncDisplayMode(session) {
  const mode = String(session?.profile?.options?.display_mode || "scale").trim().toLowerCase();
  return ["scale", "original", "resize"].includes(mode) ? mode : "scale";
}

function applyVncDisplayMode(session, rfb=session?.rfb) {
  if (!session) return "scale";
  const mode = vncDisplayMode(session);
  session.viewport?.classList.toggle("vnc-display-original", mode === "original");
  session.viewport?.classList.toggle("vnc-display-resize", mode === "resize");
  if (rfb) {
    // Keep local scaling enabled while requesting remote resize so servers
    // without SetDesktopSize support still fill the available viewport.
    rfb.scaleViewport = mode !== "original";
    rfb.resizeSession = mode === "resize";
  }
  return mode;
}

function renderVncCursorModeControl(session) {
  const button = session?.workspace?.querySelector("[data-vnc-cursor-mode]");
  if (!button) return;
  const mode = vncCursorMode(session);
  const pointerState = session.localCursorHidden
    ? tr("navigation:menus.vnc_pointer_hidden", {defaultValue:"隐藏"})
    : tr("navigation:menus.vnc_pointer_visible", {defaultValue:"显示"});
  const detail = mode === "auto"
    ? tr("navigation:menus.vnc_mouse_auto_current", {state:pointerState, defaultValue:`自动（当前${pointerState}本地光标）`})
    : mode === "hide"
      ? tr("remote:auto.mouse_hide", {defaultValue:"手动隐藏本地光标"})
      : tr("remote:auto.mouse_show", {defaultValue:"手动显示本地光标"});
  const label = tr("navigation:menus.vnc_mouse_mode_detail", {detail, defaultValue:`鼠标模式：${detail}`});
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(mode !== "auto"));
  button.classList.toggle("active", mode !== "auto");
}

function showVncCursorModeMenu(event, key) {
  const session = vncSessions.get(key);
  if (!session) return;
  const mode = vncCursorMode(session);
  showActionMenu(event, [
    {label:tr("remote:auto.mouse_auto", {defaultValue:"自动（按远端平台）"}), icon:mode === "auto" ? "circle-check" : "sparkles", run:()=>setVncCursorMode(key, "auto")},
    {separator:true},
    {label:tr("remote:auto.mouse_show", {defaultValue:"手动显示本地光标"}), icon:mode === "show" ? "circle-check" : "mouse-pointer-2", run:()=>setVncCursorMode(key, "show")},
    {label:tr("remote:auto.mouse_hide", {defaultValue:"手动隐藏本地光标"}), icon:mode === "hide" ? "circle-check" : "eye-off", run:()=>setVncCursorMode(key, "hide")}
  ]);
}

async function setVncCursorMode(key, mode) {
  const session = vncSessions.get(key);
  if (!session?.profile || !["auto", "show", "hide"].includes(mode)) return;
  const profile = remoteProfileById(session.profile.id) || session.profile;
  const updated = await api(`/api/remote-profiles/${Number(profile.id)}`, {
    method:"PUT",
    body:JSON.stringify({options:{...(profile.options || {}), cursor_mode:mode}})
  });
  const index = remoteProfiles.findIndex(item => Number(item.id) === Number(updated.id));
  if (index >= 0) remoteProfiles[index] = updated;
  session.profile = updated;
  applyVncCursorPolicy(session);
  const detail = mode === "auto"
    ? tr("remote:auto.mouse_auto", {defaultValue:"自动（按远端平台）"})
    : mode === "hide"
      ? tr("remote:auto.mouse_hide", {defaultValue:"手动隐藏本地光标"})
      : tr("remote:auto.mouse_show", {defaultValue:"手动显示本地光标"});
  const text = tr("navigation:menus.vnc_mouse_mode_saved", {detail, defaultValue:`VNC 鼠标模式已设为：${detail}`});
  notify(text, "success");
}
