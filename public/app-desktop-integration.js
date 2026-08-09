let desktopIntegrationStatusCache = null;

function normalizeDesktopIntegrationScopes(scopes) {
  const allowed = new Set(["xserver", "remote-client"]);
  return [...new Set((Array.isArray(scopes) ? scopes : [scopes])
    .map(scope => String(scope || "").trim().toLowerCase())
    .filter(scope => allowed.has(scope)))];
}

function desktopIntegrationExpiryText(status) {
  if (status?.authorization_browser_session) return "授权在本次浏览器会话结束时失效";
  const expiresAt = Number(status?.authorization_expires_at || 0);
  if (!expiresAt) return "";
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
  return remaining > 0 ? `临时授权约 ${remaining} 分钟后到期` : "临时授权已到期";
}

function normalizeDesktopIntegrationAuthorizationDuration(options={}) {
  const authorizationMode = options.authorizationMode === "browser-session" ? "browser-session" : "timed";
  if (authorizationMode === "browser-session") return {authorizationMode, durationMinutes:0};
  const durationMinutes = Number(options.durationMinutes ?? 10);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
    throw new Error("授权时长必须是 1 到 480 分钟");
  }
  return {authorizationMode, durationMinutes};
}

function desktopIntegrationAuthorizationSelection(element) {
  const authorization = element?.closest?.(".desktop-integration-authorization");
  const select = authorization?.querySelector?.('[data-role="desktop-integration-duration"]');
  const selected = String(select?.value || "10");
  if (selected === "browser-session") return {authorizationMode:"browser-session", durationMinutes:0};
  const durationMinutes = selected === "custom"
    ? Number(authorization?.querySelector?.('[data-role="desktop-integration-custom-minutes"]')?.value || 0)
    : Number(selected);
  return normalizeDesktopIntegrationAuthorizationDuration({durationMinutes});
}

async function loadDesktopIntegrationStatus(force=false) {
  if (!force && desktopIntegrationStatusCache) return desktopIntegrationStatusCache;
  desktopIntegrationStatusCache = await api("/api/desktop-integration/status");
  return desktopIntegrationStatusCache;
}

async function requestDesktopIntegrationAuthorization(scopes=["xserver", "remote-client"], options={}) {
  const normalizedScopes = normalizeDesktopIntegrationScopes(scopes);
  const duration = normalizeDesktopIntegrationAuthorizationDuration(options);
  if (!normalizedScopes.length) throw new Error("没有可申请的桌面集成能力");
  const current = await loadDesktopIntegrationStatus(true);
  if (current.native_desktop || normalizedScopes.every(scope => current.scopes?.includes(scope))) return current;
  if (!current.desktop_backend_available) {
    if (!options.silent) notify("当前连接的是独立 Web/测试后端，没有可确认授权的 Terma 桌面端", "error");
    return null;
  }
  if (!current.can_request_authorization) {
    const message = current.web_session_authenticated
      ? "桌面集成临时授权只能从运行 Terma 的本机浏览器申请"
      : "请先使用 Web 密码或访问 Token 登录，再申请桌面集成临时授权";
    if (!options.silent) notify(message, "error");
    return null;
  }
  const result = await api("/api/desktop-integration/authorize", {
    method:"POST",
    body:JSON.stringify({
      scopes:normalizedScopes,
      authorization_mode:duration.authorizationMode,
      duration_minutes:duration.durationMinutes
    })
  });
  desktopIntegrationStatusCache = result;
  if (!result.approved || !result.authorized) {
    if (!options.silent) notify("Terma 桌面端未授予临时桌面集成权限", "info");
    return null;
  }
  if (!options.silent) notify(duration.authorizationMode === "browser-session"
    ? "已获得本次浏览器会话的桌面集成授权"
    : `已获得 ${duration.durationMinutes} 分钟桌面集成临时授权`, "success");
  return result;
}

async function revokeDesktopIntegrationAuthorization(options={}) {
  const result = await api("/api/desktop-integration/authorize", {method:"DELETE", body:"{}"});
  desktopIntegrationStatusCache = null;
  if (!options.silent) notify("已撤销当前浏览器的桌面集成临时授权", "success");
  return result;
}

async function ensureDesktopIntegrationAuthorized(scopes, options={}) {
  const normalizedScopes = normalizeDesktopIntegrationScopes(scopes);
  const current = await loadDesktopIntegrationStatus(true);
  if (current.native_desktop || normalizedScopes.every(scope => current.scopes?.includes(scope))) return true;
  return Boolean(await requestDesktopIntegrationAuthorization(normalizedScopes, options));
}

function desktopIntegrationAuthorizationMarkup(status, scopes, options={}) {
  const normalizedScopes = normalizeDesktopIntegrationScopes(scopes);
  const authorized = status?.native_desktop || normalizedScopes.every(scope => status?.scopes?.includes(scope));
  if (authorized && status?.authorization_kind !== "temporary") return "";
  if (authorized) {
    return `<div class="connection-test-status success desktop-integration-authorization"><div class="desktop-integration-authorization-copy"><b>浏览器临时授权已启用</b><small>${esc(desktopIntegrationExpiryText(status))}</small></div><div class="desktop-integration-authorization-actions"><button type="button" data-action="desktop-integration-revoke" data-refresh-target="${escAttr(options.refreshTarget || "")}" data-remote-profile-id="${Number(options.remoteProfileId || 0)}">${icon("shield-off")}<span>撤销授权</span></button></div></div>`;
  }
  if (!status?.desktop_backend_available) return "";
  const canRequest = Boolean(status.can_request_authorization);
  const detail = canRequest
    ? "在 Terma 桌面端确认后，当前本机浏览器可在所选时长内调用图形集成功能。"
    : status.web_session_authenticated
      ? "此授权只能从运行 Terma 的同一台设备上的浏览器申请。"
      : "请先使用 Web 密码或访问 Token 登录，再申请临时授权。";
  const controls = canRequest ? `<div class="desktop-integration-authorization-actions"><label class="desktop-integration-duration"><span>授权时长</span><select data-role="desktop-integration-duration" data-change-action="desktop-integration-duration"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="custom">自定义</option><option value="browser-session">本次浏览器会话</option></select></label><label class="desktop-integration-custom-duration" hidden><span>分钟</span><input type="number" min="1" max="480" step="1" value="120" inputmode="numeric" data-role="desktop-integration-custom-minutes"></label><button class="primary" type="button" data-action="desktop-integration-authorize" data-scopes="${escAttr(normalizedScopes.join(","))}" data-refresh-target="${escAttr(options.refreshTarget || "")}" data-remote-profile-id="${Number(options.remoteProfileId || 0)}">${icon("shield-check")}<span>申请授权</span></button></div>` : "";
  return `<div class="connection-test-status warning desktop-integration-authorization"><div class="desktop-integration-authorization-copy"><b>等待桌面授权</b><small>${esc(detail)}</small></div>${controls}</div>`;
}

async function refreshDesktopIntegrationConsumer(element) {
  const target = String(element?.dataset?.refreshTarget || "");
  const profileId = Number(element?.dataset?.remoteProfileId || 0);
  if (target === "xserver" && typeof renderXServerManager === "function") await renderXServerManager();
  if (target === "remote-profile" && profileId && typeof openRemoteDesktop === "function") {
    await openRemoteDesktop(profileId, false, true);
  }
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("desktop-integration-authorize", async ({element}) => {
    const scopes = String(element.dataset.scopes || "").split(",");
    const duration = desktopIntegrationAuthorizationSelection(element);
    setButtonBusy(element, true, "等待桌面端确认...");
    try {
      if (await requestDesktopIntegrationAuthorization(scopes, duration)) await refreshDesktopIntegrationConsumer(element);
    } finally {
      if (document.contains(element)) setButtonBusy(element, false);
    }
  });
  registerTermaAction("desktop-integration-revoke", async ({element}) => {
    setButtonBusy(element, true, "撤销中...");
    try {
      await revokeDesktopIntegrationAuthorization();
      await refreshDesktopIntegrationConsumer(element);
    } finally {
      if (document.contains(element)) setButtonBusy(element, false);
    }
  });
  registerTermaAction("desktop-integration-duration", ({element}) => {
    const authorization = element.closest(".desktop-integration-authorization");
    const custom = authorization?.querySelector(".desktop-integration-custom-duration");
    if (!custom) return;
    custom.hidden = element.value !== "custom";
    if (!custom.hidden) custom.querySelector("input")?.focus();
  });
}
