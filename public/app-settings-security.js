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
  if (activeView === "settings" && $("workspaceSubtitle")) $("workspaceSubtitle").textContent = SETTINGS_SECTION_META[next];
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
  $("openLicenseBtn")?.focus();
}

async function showLicenseModal() {
  const trigger = $("openLicenseBtn");
  try {
    const about = aboutSettings?.license_text ? aboutSettings : await loadAboutSettings();
    if (!about.license_text) throw new Error(about.license_error || "未找到随程序提供的开源许可正文");
    const modal = $("modal");
    modal.innerHTML = `<div class="modal-card wide license-modal" role="dialog" aria-modal="true" aria-labelledby="licenseModalTitle">
      <div class="license-modal-head"><div><h2 id="licenseModalTitle">GNU General Public License v3.0</h2><span>${esc(about.product_name || "Terma")} · ${esc(about.license || "GPL-3.0-only")}</span></div><button id="licenseModalClose" class="icon-button" type="button" title="关闭许可正文" aria-label="关闭许可正文">${icon("x")}</button></div>
      <pre id="licenseText" class="license-text" tabindex="0"></pre>
      <div class="actions"><button type="button" onclick="closeLicenseModal()">关闭</button></div>
    </div>`;
    $("licenseText").textContent = about.license_text || "未找到开源许可正文。";
    modal.hidden = false;
    modal.onclick = null;
    $("licenseModalClose").onclick = closeLicenseModal;
    licenseModalKeyHandler = event => {
      if (event.key === "Escape") closeLicenseModal();
    };
    document.addEventListener("keydown", licenseModalKeyHandler);
    $("licenseModalClose").focus();
  } catch (error) {
    trigger?.focus();
    notify(`许可正文加载失败：${error.message}`, "error");
  }
}

async function loadRuntimeDiagnostics() {
  const box = $("runtimeDiagnostics");
  const view = box?.closest("#view-settings");
  if (!box) return;
  box.textContent = "正在加载...";
  try {
    const data = await api("/api/diagnostics/runtime");
    let webInfo = null;
    try { webInfo = typeof data.web_info === "string" ? JSON.parse(data.web_info) : data.web_info; } catch {}
    const ptyHelper = data.platform === "win32"
      ? "Windows ConPTY"
      : data.platform !== "darwin"
        ? "当前平台不依赖 spawn-helper"
      : data.pty?.helper_exists
        ? `${data.pty.helper_executable ? "可执行" : "不可执行"} · ${data.pty.helper_path}`
        : "未找到";
    const localUrl = safeRuntimeUrl(data.web_url || webInfo?.local_url || runtimeSettings?.local_url);
    const lanUrls = [...new Set((data.lan_urls || webInfo?.lan_urls || runtimeSettings?.lan_urls || []).map(safeRuntimeUrl).filter(Boolean))];
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, local_url:localUrl, lan_urls:lanUrls});
    const urls = view?.querySelector("#runtimeCurrentUrls");
    if (urls) urls.innerHTML = runtimeUrlListHtml();
    const actualHosts = runtimeHostValues(webInfo?.hosts || webInfo?.host || runtimeSettings?.effective?.listen_hosts);
    const actualPort = runtimePortValue(webInfo?.port ?? runtimeSettings?.effective?.listen_port);
    const ptyStatus = data.pty?.operational
      ? "可用"
      : data.pty?.available
        ? "组件已加载，但运行条件不完整"
        : `不可用（${data.pty?.error || "optional 依赖未安装或加载失败"}）`;
    const rows = [
      ["进程", `PID ${data.pid} · ${data.platform}/${data.arch} · ${data.node}`],
      ["实际监听", `${actualHosts.join("、") || "未知"}:${actualPort}`],
      ["本机地址", localUrl || "未生成"],
      ["局域网地址", lanUrls.join("，") || "无"],
      ["数据目录", data.data_dir || "未知"],
      ["日志目录", data.log_dir || "未知"],
      ["Web 日志", data.web_log || "未知"],
      ["PTY", ptyStatus],
      ["PTY 辅助程序", ptyHelper]
    ];
    box.className = "diagnostics-box";
    box.innerHTML = `<dl class="runtime-diagnostic-grid">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
  } catch (error) {
    box.className = "diagnostics-box error";
    box.textContent = error.message;
  }
}

function notificationPermissionText() {
  if (typeof Notification === "undefined") return "当前浏览器不支持系统通知，仍会显示页面提示";
  return { granted: "已授权系统通知", denied: "浏览器已拒绝系统通知，仍会显示页面提示", default: "未授权，仅显示页面提示" }[Notification.permission] || Notification.permission;
}

function updateSecurityBadges() {
  const s = securitySettings || {};
  if ($("securityPasswordState")) $("securityPasswordState").textContent = s.password_set ? "（已设置）" : "（未设置）";
  if ($("securityTokenState")) $("securityTokenState").textContent = s.token_set ? "（已设置）" : "（未设置）";
  if ($("securityTokenBtn")) $("securityTokenBtn").textContent = s.token_set ? "重新生成 Token" : "生成 Token";
}

function localDirectDesktopIntegrationPresentation(settings=securitySettings || {}, overrides={}) {
  const status = settings.local_direct_desktop_integration || {};
  const enabled = overrides.enabled ?? Boolean(settings.local_direct_desktop_integration_enabled);
  const trustedProxyEnabled = overrides.trustedProxyEnabled ?? Boolean(settings.trusted_proxy_enabled);
  const hosts = Array.isArray(status.actual_listen_hosts) ? status.actual_listen_hosts : [];
  if (!enabled) return {
    className:"",
    text:"默认关闭。启用后，只在 Terma 实际仅监听本机回环地址、当前浏览器直连本机且已通过当前 Web 访问策略时，自动开放 X Server 和系统远程客户端。"
  };
  if (trustedProxyEnabled) return {
    className:"warning",
    text:"当前不生效：已启用可信反向代理。反代访问仍需 Web 登录；桌面集成继续使用临时授权。"
  };
  if (status.listen_loopback_only === false) return {
    className:"warning",
    text:`当前不生效：Terma 实际监听包含非回环地址${hosts.length ? `（${hosts.join("、")}）` : ""}。`
  };
  if (status.direct_loopback_request === false) return {
    className:"warning",
    text:"当前不生效：此页面不是通过 127.0.0.1、localhost 或 [::1] 直连访问，或请求包含反向代理转发头。"
  };
  if (status.web_access_authorized === false) return {
    className:"warning",
    text:"监听条件满足，但当前 Web 访问策略仍要求登录；完成登录后才会自动获得有限桌面集成权限。"
  };
  return {
    className:"success",
    text:"当前已生效：此本机直连浏览器可自动使用 X Server 和系统远程客户端；本地文件、更新、迁移等桌面能力仍不开放。"
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
    confirm_unsafe = await confirmModal("关闭局域网访问密码会让同一局域网内设备直接操作 Terma。确认关闭？", "高风险设置", "确认关闭", "取消", true);
    if (!confirm_unsafe) return;
  }
  securitySettings = await api("/api/security", {method:"PUT", body:JSON.stringify({auth_mode, lan_auth_enabled, secure_cookie_mode, trusted_proxy_enabled, trusted_proxy_addresses, local_direct_desktop_integration_enabled, allowed_hosts, login_max_failures, login_window_seconds, login_lock_seconds, global_login_protection_enabled, global_login_max_failures, global_login_window_seconds, global_login_lock_seconds, confirm_unsafe})});
  updateLocalDirectDesktopIntegrationPreview();
  notify("安全策略已保存", "success");
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
  notify("会话设置已保存", "success");
}

function notificationDurationFormValue(id, options={}) {
  const input = $(id);
  const raw = String(input?.value || "").trim();
  if (!raw && options.nullable) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 60) throw new Error("通知显示时长必须在 0.5-60 秒之间");
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
    return notify(error.message || "通知设置无效", "error");
  }
  setButtonBusy(button, true, "保存中");
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
    notify(notification_mode === "on" ? "通知设置已保存" : notification_mode === "muted" ? "通知设置已保存，后台事件已静音" : "通知设置已保存，后台事件提醒已关闭", "success");
  } catch (error) {
    notify(error.message || "通知设置保存失败", "error");
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
  notify("Web 密码已保存", "success");
}

async function generateAccessToken() {
  const inPane = captureSettingsPane();
  if (securitySettings?.token_set && !await confirmModal("重新生成 Token 后，旧 Token 会立即失效。继续？", "重新生成 Token", "继续", "取消", true)) return;
  const result = await api("/api/security/token", {method:"POST", body:JSON.stringify({})});
  securitySettings = result;
  inPane(updateSecurityBadges);
  await inputModal("访问 Token 只显示一次", "请保存这个 Token", result.token || "");
  notify("访问 Token 已生成", "success");
}

async function enableConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  const result = await api("/api/security/encryption/enable", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  const snapshotText = result.removed_snapshots ? `，并清理 ${result.removed_snapshots} 个旧快照` : "";
  notify(`配置加密已启用，已处理 ${result.encrypted_rows || 0} 行敏感配置${snapshotText}`, "success");
}

async function unlockConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  const result = await api("/api/security/encryption/unlock", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  notify(result.key_rotated ? `配置加密密钥已轮换，处理 ${result.transition_rows || 0} 行敏感配置；请重新生成备份并清理旧 v1 备份` : result.transition_rows ? `配置加密切换已修复，处理 ${result.transition_rows} 行敏感配置` : "配置加密已解锁", "success");
}

async function disableConfigEncryption() {
  const inPane = captureSettingsPane();
  const password = $("securityMasterPassword").value;
  if (securitySettings?.encryption_enabled && !password) return notify("请输入主密码后再关闭配置加密", "error");
  if (!await confirmModal("关闭配置加密会先用主密码解密已加密字段，再关闭加密。关闭后可以使用普通数据库备份迁移。确认关闭？", "关闭配置加密", "解密并关闭", "取消", true)) return;
  const result = await api("/api/security/encryption/disable", {method:"POST", body:JSON.stringify({password})});
  await loadSecuritySettings();
  inPane(renderSettings);
  const snapshotText = result.removed_snapshots ? `，并清理 ${result.removed_snapshots} 个旧快照` : "";
  notify(`配置加密已关闭，已解密 ${result.decrypted_rows || 0} 行敏感配置${snapshotText}`, "success");
}

async function logout() {
  await api("/api/auth/logout", {method:"POST"});
  location.href = "/login";
}
