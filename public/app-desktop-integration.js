let desktopIntegrationStatusCache = null;

function normalizeDesktopIntegrationScopes(scopes) {
  const allowed = new Set(["xserver", "remote-client"]);
  return [...new Set((Array.isArray(scopes) ? scopes : [scopes])
    .map(scope => String(scope || "").trim().toLowerCase())
    .filter(scope => allowed.has(scope)))];
}

function desktopIntegrationExpiryText(status) {
  if (status?.authorization_browser_session) return tr("remote:desktop_authorization.browser_session_expiry");
  const expiresAt = Number(status?.authorization_expires_at || 0);
  if (!expiresAt) return "";
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
  return remaining > 0
    ? tr("remote:desktop_authorization.expires_in", {count:remaining})
    : tr("remote:desktop_authorization.expired");
}

function normalizeDesktopIntegrationAuthorizationDuration(options={}) {
  const authorizationMode = options.authorizationMode === "browser-session" ? "browser-session" : "timed";
  if (authorizationMode === "browser-session") return {authorizationMode, durationMinutes:0};
  const durationMinutes = Number(options.durationMinutes ?? 10);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
    throw new Error(tr("remote:desktop_authorization.duration_invalid"));
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
  if (!normalizedScopes.length) throw new Error(tr("remote:desktop_authorization.no_scopes"));
  const current = await loadDesktopIntegrationStatus(true);
  if (current.native_desktop || normalizedScopes.every(scope => current.scopes?.includes(scope))) return current;
  if (!current.desktop_backend_available) {
    if (!options.silent) notify(tr("remote:desktop_authorization.desktop_unavailable"), "error");
    return null;
  }
  if (!current.can_request_authorization) {
    const message = current.web_session_authenticated
      ? tr("remote:desktop_authorization.local_only")
      : tr("remote:desktop_authorization.login_first");
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
    if (!options.silent) notify(tr("remote:desktop_authorization.not_granted"), "info");
    return null;
  }
  if (!options.silent) notify(duration.authorizationMode === "browser-session"
    ? tr("remote:desktop_authorization.browser_session_granted")
    : tr("remote:desktop_authorization.granted_minutes", {count:duration.durationMinutes}), "success");
  return result;
}

async function revokeDesktopIntegrationAuthorization(options={}) {
  const result = await api("/api/desktop-integration/authorize", {method:"DELETE", body:"{}"});
  desktopIntegrationStatusCache = null;
  if (!options.silent) notify(tr("remote:desktop_authorization.revoked"), "success");
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
    return `<div class="connection-test-status success desktop-integration-authorization"><div class="desktop-integration-authorization-copy"><b>${esc(tr("remote:desktop_authorization.enabled"))}</b><small>${esc(desktopIntegrationExpiryText(status))}</small></div><div class="desktop-integration-authorization-actions"><button type="button" data-action="desktop-integration-revoke" data-refresh-target="${escAttr(options.refreshTarget || "")}" data-remote-profile-id="${Number(options.remoteProfileId || 0)}">${icon("shield-off")}<span>${esc(tr("remote:desktop_authorization.revoke"))}</span></button></div></div>`;
  }
  if (!status?.desktop_backend_available) return "";
  const canRequest = Boolean(status.can_request_authorization);
  const detail = canRequest
    ? tr("remote:desktop_authorization.request_hint")
    : status.web_session_authenticated
      ? tr("remote:desktop_authorization.same_device_only")
      : tr("common:notifications.desktop_authorization_login_required");
  const controls = canRequest ? `<div class="desktop-integration-authorization-actions"><label class="desktop-integration-duration"><span>${esc(tr("remote:desktop_authorization.duration"))}</span><select data-role="desktop-integration-duration" data-change-action="desktop-integration-duration"><option value="5">${esc(tr("remote:desktop_authorization.minutes", {count:5}))}</option><option value="10" selected>${esc(tr("remote:desktop_authorization.minutes", {count:10}))}</option><option value="30">${esc(tr("remote:desktop_authorization.minutes", {count:30}))}</option><option value="60">${esc(tr("remote:desktop_authorization.hour"))}</option><option value="custom">${esc(tr("remote:desktop_authorization.custom"))}</option><option value="browser-session">${esc(tr("remote:desktop_authorization.browser_session_option"))}</option></select></label><label class="desktop-integration-custom-duration" hidden><span>${esc(tr("remote:desktop_authorization.minute_unit"))}</span><input type="number" min="1" max="480" step="1" value="120" inputmode="numeric" data-role="desktop-integration-custom-minutes"></label><button class="primary" type="button" data-action="desktop-integration-authorize" data-scopes="${escAttr(normalizedScopes.join(","))}" data-refresh-target="${escAttr(options.refreshTarget || "")}" data-remote-profile-id="${Number(options.remoteProfileId || 0)}">${icon("shield-check")}<span>${esc(tr("remote:desktop_authorization.request"))}</span></button></div>` : "";
  return `<div class="connection-test-status warning desktop-integration-authorization"><div class="desktop-integration-authorization-copy"><b>${esc(tr("remote:desktop_authorization.waiting"))}</b><small>${esc(detail)}</small></div>${controls}</div>`;
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
    setButtonBusy(element, true, tr("remote:desktop_authorization.waiting_confirmation"));
    try {
      if (await requestDesktopIntegrationAuthorization(scopes, duration)) await refreshDesktopIntegrationConsumer(element);
    } finally {
      if (document.contains(element)) setButtonBusy(element, false);
    }
  });
  registerTermaAction("desktop-integration-revoke", async ({element}) => {
    setButtonBusy(element, true, tr("remote:desktop_authorization.revoking"));
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
