async function openSettingsSection(id) {
  const inPane = captureSettingsPane();
  activeSettingsSection = normalizeSettingsSection(id);
  if (activeView !== "settings") await openSettings();
  inPane(() => showSettingsSection(activeSettingsSection));
}

function showSettingsSection(id, options={}) {
  const next = normalizeSettingsSection(id);
  activeSettingsSection = next;
  $("view-settings")?.querySelectorAll(".settings-group").forEach(group => {
    group.hidden = group.id !== next;
  });
  setExplorerSectionActive(next);
  if (activeView === "settings" && $("workspaceSubtitle")) $("workspaceSubtitle").textContent = settingsSectionLabel(next);
  if (next === "settings-about") markUpdateNoticeRead();
  if (options.moveToWorkspace !== false) {
    const scope = typeof currentWorkspaceDomScope === "function" ? currentWorkspaceDomScope() : document;
    scope.querySelector(".workspace")?.scrollTo?.({top:0, behavior:"auto"});
    if (isMobileLayout()) showMobileWorkspace();
  }
}

function scrollToSetting(id) {
  showSettingsSection(id);
}

function closeLicenseModal() {
  const modal = $("modal");
  if (licenseModalKeyHandler) document.removeEventListener("keydown", licenseModalKeyHandler);
  licenseModalKeyHandler = null;
  modal.onclick = null;
  modal.hidden = true;
  modal.innerHTML = "";
  const trigger = licenseModalTrigger;
  licenseModalTrigger = null;
  const focusTarget = trigger?.isConnected ? trigger : $("openLicenseBtn");
  focusTarget?.focus({preventScroll:true});
  setTimeout(() => {
    if (modal.hidden && focusTarget?.isConnected) focusTarget.focus({preventScroll:true});
  }, 0);
}

async function showLicenseModal(triggerElement=null) {
  const trigger = triggerElement || $("openLicenseBtn");
  licenseModalTrigger = trigger || null;
  try {
    const about = aboutSettings?.license_text ? aboutSettings : await loadAboutSettings();
    if (!about.license_text) throw new Error(about.license_error || tr("settings:security.license_missing"));
    const modal = $("modal");
    modal.innerHTML = `<div class="modal-card wide license-modal" role="dialog" aria-modal="true" aria-labelledby="licenseModalTitle">
      <div class="license-modal-head"><div><h2 id="licenseModalTitle">GNU General Public License v3.0</h2><span>${esc(about.product_name || "Terma")} · ${esc(about.license || "GPL-3.0-only")}</span></div><button id="licenseModalClose" class="icon-button" type="button" title="${escAttr(tr("settings:security.close_license"))}" aria-label="${escAttr(tr("settings:security.close_license"))}">${icon("x")}</button></div>
      <pre id="licenseText" class="license-text" tabindex="0"></pre>
      <div class="actions"><button type="button" onclick="closeLicenseModal()">${esc(tr("common:actions.close"))}</button></div>
    </div>`;
    $("licenseText").textContent = about.license_text || tr("settings:security.license_missing_short");
    modal.hidden = false;
    modal.onclick = null;
    $("licenseModalClose").onclick = closeLicenseModal;
    licenseModalKeyHandler = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLicenseModal();
    };
    document.addEventListener("keydown", licenseModalKeyHandler);
    $("licenseModalClose").focus();
  } catch (error) {
    licenseModalTrigger = null;
    trigger?.focus();
    notify(tr("settings:security.license_load_failed", {error:error.message}), "error");
  }
}

async function loadRuntimeDiagnostics() {
  const box = $("runtimeDiagnostics");
  const view = box?.closest("#view-settings");
  if (!box) return;
  box.textContent = tr("settings:auto.loading", {defaultValue:"正在加载..."});
  try {
    const data = await api("/api/diagnostics/runtime");
    let webInfo = null;
    try { webInfo = typeof data.web_info === "string" ? JSON.parse(data.web_info) : data.web_info; } catch {}
    const ptyHelper = data.platform === "win32"
      ? "Windows ConPTY"
      : data.platform !== "darwin"
        ? tr("settings:auto.diagnostic_helper_not_required", {defaultValue:"当前平台不依赖 spawn-helper"})
      : data.pty?.helper_exists
        ? `${data.pty.helper_executable ? tr("settings:auto.diagnostic_executable", {defaultValue:"可执行"}) : tr("settings:auto.diagnostic_not_executable", {defaultValue:"不可执行"})} · ${data.pty.helper_path}`
        : tr("settings:auto.diagnostic_not_found", {defaultValue:"未找到"});
    const localUrl = safeRuntimeUrl(data.web_url || webInfo?.local_url || runtimeSettings?.local_url);
    const lanUrls = [...new Set((data.lan_urls || webInfo?.lan_urls || runtimeSettings?.lan_urls || []).map(safeRuntimeUrl).filter(Boolean))];
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, local_url:localUrl, lan_urls:lanUrls});
    const urls = view?.querySelector("#runtimeCurrentUrls");
    if (urls) urls.innerHTML = runtimeUrlListHtml();
    const actualHosts = runtimeHostValues(webInfo?.hosts || webInfo?.host || runtimeSettings?.effective?.listen_hosts);
    const actualPort = runtimePortValue(webInfo?.port ?? runtimeSettings?.effective?.listen_port);
    const ptyStatus = data.pty?.operational
      ? tr("settings:auto.diagnostic_available", {defaultValue:"可用"})
      : data.pty?.available
        ? tr("settings:auto.diagnostic_partial", {defaultValue:"组件已加载，但运行条件不完整"})
        : tr("settings:auto.diagnostic_unavailable", {
            error:data.pty?.error || tr("settings:auto.diagnostic_optional_missing", {defaultValue:"optional 依赖未安装或加载失败"}),
            defaultValue:`不可用（${data.pty?.error || "optional 依赖未安装或加载失败"}）`
          });
    const rows = [
      [tr("settings:auto.diagnostic_process", {defaultValue:"进程"}), `PID ${data.pid} · ${data.platform}/${data.arch} · ${data.node}`],
      [tr("settings:auto.diagnostic_listener", {defaultValue:"实际监听"}), `${actualHosts.join("、") || tr("settings:auto.diagnostic_unknown", {defaultValue:"未知"})}:${actualPort}`],
      [tr("settings:auto.diagnostic_local_address", {defaultValue:"本机地址"}), localUrl || tr("settings:auto.diagnostic_not_generated", {defaultValue:"未生成"})],
      [tr("settings:auto.diagnostic_lan_address", {defaultValue:"局域网地址"}), lanUrls.join("，") || tr("settings:auto.diagnostic_none", {defaultValue:"无"})],
      [tr("settings:auto.diagnostic_data_directory", {defaultValue:"数据目录"}), data.data_dir || tr("settings:auto.diagnostic_unknown", {defaultValue:"未知"})],
      [tr("settings:auto.diagnostic_log_directory", {defaultValue:"日志目录"}), data.log_dir || tr("settings:auto.diagnostic_unknown", {defaultValue:"未知"})],
      [tr("settings:auto.diagnostic_web_log", {defaultValue:"Web 日志"}), data.web_log || tr("settings:auto.diagnostic_unknown", {defaultValue:"未知"})],
      [tr("settings:auto.diagnostic_pty", {defaultValue:"PTY"}), ptyStatus],
      [tr("settings:auto.diagnostic_pty_helper", {defaultValue:"PTY 辅助程序"}), ptyHelper]
    ];
    box.className = "diagnostics-box";
    box.innerHTML = `<dl class="runtime-diagnostic-grid">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
  } catch (error) {
    box.className = "diagnostics-box error";
    box.textContent = error.message;
  }
}

function notificationPermissionText() {
  if (typeof Notification === "undefined") return tr("settings:auto.notifications_unsupported");
  return {
    granted:tr("settings:auto.notifications_authorized"),
    denied:tr("settings:auto.notifications_denied"),
    default:tr("settings:auto.notifications_page_only")
  }[Notification.permission] || Notification.permission;
}

function updateSecurityBadges() {
  const s = securitySettings || {};
  if ($("securityPasswordState")) $("securityPasswordState").textContent = tr(s.password_set ? "settings:auto.set" : "settings:auto.not_set");
  if ($("securityTokenState")) $("securityTokenState").textContent = tr(s.token_set ? "settings:auto.set" : "settings:auto.not_set");
  if ($("securityTokenBtn")) $("securityTokenBtn").textContent = tr(s.token_set ? "settings:auto.regenerate_token" : "settings:auto.generate_token");
}

function localDirectDesktopIntegrationPresentation(settings=securitySettings || {}, overrides={}) {
  const status = settings.local_direct_desktop_integration || {};
  const enabled = overrides.enabled ?? Boolean(settings.local_direct_desktop_integration_enabled);
  const trustedProxyEnabled = overrides.trustedProxyEnabled ?? Boolean(settings.trusted_proxy_enabled);
  const hosts = Array.isArray(status.actual_listen_hosts) ? status.actual_listen_hosts : [];
  if (!enabled) return {
    className:"",
    text:tr("settings:security.desktop_integration_disabled")
  };
  if (trustedProxyEnabled) return {
    className:"warning",
    text:tr("settings:security.desktop_integration_proxy")
  };
  if (status.listen_loopback_only === false) return {
    className:"warning",
    text:tr("settings:security.desktop_integration_non_loopback", {hosts:hosts.length ? ` (${hosts.join(", ")})` : ""})
  };
  if (status.direct_loopback_request === false) return {
    className:"warning",
    text:tr("settings:security.desktop_integration_not_direct")
  };
  if (status.web_access_authorized === false) return {
    className:"warning",
    text:tr("settings:security.desktop_integration_login_required")
  };
  return {
    className:"success",
    text:tr("settings:security.desktop_integration_active")
  };
}

function localDirectDesktopIntegrationStatusHtml(settings=securitySettings || {}) {
  const presentation = localDirectDesktopIntegrationPresentation(settings);
  return `<div id="securityLocalDirectDesktopIntegrationState" class="connection-test-status ${presentation.className}">${esc(presentation.text)}</div>`;
}

function updateLocalDirectDesktopIntegrationPreview() {
  const state = $("securityLocalDirectDesktopIntegrationState");
  if (!state) return;
  const presentation = localDirectDesktopIntegrationPresentation(securitySettings || {}, {
    enabled:Boolean($("securityLocalDirectDesktopIntegration")?.checked),
    trustedProxyEnabled:Boolean($("securityTrustedProxyEnabled")?.checked)
  });
  state.className = `connection-test-status ${presentation.className}`.trim();
  state.textContent = presentation.text;
}

async function saveSecurityOptions() {
  const auth_mode = $("securityAuthMode").value;
  const lan_auth_enabled = auth_mode !== "off";
  const secure_cookie_mode = $("securitySecureCookieMode")?.value || "auto";
  const trusted_proxy_enabled = Boolean($("securityTrustedProxyEnabled")?.checked);
  const trusted_proxy_addresses = String($("securityTrustedProxyAddresses")?.value || "").split(/[\s,]+/).filter(Boolean);
  const local_direct_desktop_integration_enabled = Boolean($("securityLocalDirectDesktopIntegration")?.checked);
  const allowed_hosts = String($("securityAllowedHosts")?.value || "").split(/[\s,]+/).filter(Boolean);
  const login_max_failures = Number($("securityLoginMaxFailures")?.value);
  const login_window_seconds = Number($("securityLoginWindowSeconds")?.value);
  const login_lock_seconds = Number($("securityLoginLockSeconds")?.value);
  const global_login_protection_enabled = Boolean($("securityGlobalLoginProtectionEnabled")?.checked);
  const global_login_max_failures = Number($("securityGlobalLoginMaxFailures")?.value);
  const global_login_window_seconds = Number($("securityGlobalLoginWindowSeconds")?.value);
  const global_login_lock_seconds = Number($("securityGlobalLoginLockSeconds")?.value);
  let confirm_unsafe = false;
  if (auth_mode === "off") {
    confirm_unsafe = await confirmModal(tr("settings:security.disable_lan_password_confirm"), tr("settings:auto.high_risk"), tr("settings:security.confirm_disable"), tr("common:actions.cancel"), true);
    if (!confirm_unsafe) return;
  }
  securitySettings = await api("/api/security", {method:"PUT", body:JSON.stringify({auth_mode, lan_auth_enabled, secure_cookie_mode, trusted_proxy_enabled, trusted_proxy_addresses, local_direct_desktop_integration_enabled, allowed_hosts, login_max_failures, login_window_seconds, login_lock_seconds, global_login_protection_enabled, global_login_max_failures, global_login_window_seconds, global_login_lock_seconds, confirm_unsafe})});
  updateLocalDirectDesktopIntegrationPreview();
  notify(tr("settings:security.policy_saved"), "success");
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("security-local-direct-desktop-integration", updateLocalDirectDesktopIntegrationPreview);
}

async function saveSessionManagement() {
  const inPane = captureSettingsPane();
  const session_ttl_minutes = Number($("securitySessionTtlMinutes").value);
  const session_max_sessions = Number($("securitySessionMaxSessions").value);
  const session_cleanup_minutes = Number($("securitySessionCleanupMinutes").value);
  securitySettings = await api("/api/security", {
    method:"PUT",
    body:JSON.stringify({session_ttl_minutes, session_max_sessions, session_cleanup_minutes})
  });
  inPane(() => {
    renderSettings();
    refreshIcons();
  });
  notify(tr("settings:security.session_saved"), "success");
}

function notificationDurationFormValue(id, options={}) {
  const input = $(id);
  const raw = String(input?.value || "").trim();
  if (!raw && options.nullable) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 60) throw new Error(tr("settings:auto.notification_duration_invalid"));
  return Math.round(seconds * 1000);
}

function notificationDisplayFormValue() {
  return {
    info:{
      enabled:$("notificationInfoEnabled")?.checked !== false,
      duration_ms:notificationDurationFormValue("notificationInfoDuration")
    },
    success:{
      enabled:$("notificationSuccessEnabled")?.checked !== false,
      duration_ms:notificationDurationFormValue("notificationSuccessDuration")
    },
    error:{
      enabled:$("notificationErrorEnabled")?.checked !== false,
      duration_ms:notificationDurationFormValue("notificationErrorDuration")
    },
    progress:{
      enabled:$("notificationProgressEnabled")?.checked !== false,
      success_duration_ms:notificationDurationFormValue("notificationProgressSuccessDuration", {nullable:true}),
      error_duration_ms:notificationDurationFormValue("notificationProgressErrorDuration")
    }
  };
}

function syncNotificationSettingControls() {
  const groups = [
    ["notificationInfoEnabled", ["notificationInfoDuration"]],
    ["notificationSuccessEnabled", ["notificationSuccessDuration"]],
    ["notificationErrorEnabled", ["notificationErrorDuration"]],
    ["notificationProgressEnabled", ["notificationProgressSuccessDuration", "notificationProgressErrorDuration"]]
  ];
  for (const [toggleId, fieldIds] of groups) {
    const disabled = $(toggleId)?.checked === false;
    fieldIds.forEach(id => { if ($(id)) $(id).disabled = disabled; });
  }
}

async function saveNotificationOptions() {
  const inPane = captureSettingsPane();
  const button = $("notificationSaveBtn");
  const notification_mode = $("notificationMode")?.value || "on";
  let notification_display;
  try {
    notification_display = notificationDisplayFormValue();
  } catch (error) {
    return notify(error.message || tr("settings:auto.notification_invalid"), "error");
  }
  setButtonBusy(button, true, tr("settings:auto.saving"));
  try {
    const [securityResult, runtimeResult] = await Promise.allSettled([
      api("/api/security", {method:"PUT", body:JSON.stringify({notification_mode})}),
      api("/api/runtime-settings", {
        method:"PUT",
        body:JSON.stringify({
          notification_display,
          sftp_floating_progress_enabled:$("taskCenterFloatingProgressEnabled")?.checked !== false
        })
      })
    ]);
    if (securityResult.status === "fulfilled") securitySettings = securityResult.value;
    if (runtimeResult.status === "fulfilled") runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...runtimeResult.value});
    inPane(() => {
      syncNotificationSettingControls();
      if (typeof updateSftpTaskFloat === "function") updateSftpTaskFloat(typeof sftpLatestJobs === "undefined" ? [] : sftpLatestJobs);
    });
    const failure = [securityResult, runtimeResult].find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    notify(tr(notification_mode === "on" ? "settings:auto.notification_saved" : notification_mode === "muted" ? "settings:security.notifications_muted" : "settings:security.notifications_off"), "success");
  } catch (error) {
    notify(error.message || tr("settings:auto.notification_save_failed"), "error");
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

async function saveWebPassword() {
  const inPane = captureSettingsPane();
  const password = $("securityPassword").value;
  securitySettings = await api("/api/security/password", {method:"POST", body:JSON.stringify({password})});
  inPane(() => {
    const input = $("securityPassword");
    if (input) input.value = "";
    updateSecurityBadges();
  });
  notify(tr("settings:auto.web_password_saved"), "success");
}

async function generateAccessToken() {
  const inPane = captureSettingsPane();
  if (securitySettings?.token_set && !await confirmModal(tr("settings:security.regenerate_token_confirm"), tr("settings:auto.regenerate_token"), tr("settings:security.continue"), tr("common:actions.cancel"), true)) return;
  const result = await api("/api/security/token", {method:"POST", body:JSON.stringify({})});
  securitySettings = result;
  inPane(updateSecurityBadges);
  await inputModal(tr("settings:auto.token_once"), tr("settings:auto.token_save"), result.token || "");
  notify(tr("settings:auto.token_generated"), "success");
}

async function enableConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  const result = await api("/api/security/encryption/enable", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  const snapshotText = result.removed_snapshots ? tr("settings:security.snapshots_removed", {count:result.removed_snapshots}) : "";
  notify(tr("settings:security.encryption_enabled", {rows:result.encrypted_rows || 0, snapshots:snapshotText}), "success");
}

async function unlockConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  const result = await api("/api/security/encryption/unlock", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  notify(tr(result.key_rotated ? "settings:security.encryption_rotated" : result.transition_rows ? "settings:security.encryption_repaired" : "settings:security.encryption_unlocked", {rows:result.transition_rows || 0}), "success");
}

async function disableConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  if (securitySettings?.encryption_enabled && !password) return notify(tr("settings:security.master_password_required"), "error");
  if (!await confirmModal(tr("settings:security.disable_encryption_confirm"), tr("settings:security.disable_encryption_title"), tr("settings:security.decrypt_disable"), tr("common:actions.cancel"), true)) return;
  const result = await api("/api/security/encryption/disable", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  const snapshotText = result.removed_snapshots ? tr("settings:security.snapshots_removed", {count:result.removed_snapshots}) : "";
  notify(tr("settings:security.encryption_disabled", {rows:result.decrypted_rows || 0, snapshots:snapshotText}), "success");
}

async function logout() {
  await api("/api/auth/logout", {method:"POST"});
  location.href = "/login";
}
