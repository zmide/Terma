async function openSettings(updateTab=true) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = !updateTab && currentTab?.kind === "settings" ? currentTab.key : "settings";
  inPane(() => {
    setWorkspace(tr("settings:title", {defaultValue:"设置"}), tr("settings:subtitle", {defaultValue:"访问保护、通知、运行信息与开源许可。"}), "settings", tabKey, updateTab, true, {kind:"settings"});
    $("view-settings").innerHTML = stateView("loading", tr("settings:auto.loading", {defaultValue:"正在加载设置"}), tr("settings:auto.loading_detail", {defaultValue:"正在读取访问保护、运行状态和程序信息。"}));
  });
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : inPane;
  try {
    await loadSecuritySettings();
    await loadTrustedSshHosts();
    try {
      await loadAboutSettings();
    } catch (error) {
      aboutSettings = { product_name:"Terma", repository_url:"https://github.com/zmide/Terma", load_error:error.message };
    }
    await loadRuntimeSettings();
    await loadDesktopSettings();
    await loadProgramCacheSettings().catch(() => { programCacheSettings = {bytes:0,reclaimable_bytes:0,categories:{}}; });
    inTab(() => {
      renderSettings();
      refreshUpdateStatus(false);
    });
  } catch (error) {
    inTab(() => {
      $("view-settings").innerHTML = stateView("error", tr("settings:auto.load_failed", {defaultValue:"设置加载失败"}), error.message, `<button onclick="openSettings(false)">${esc(tr("common:actions.retry", {defaultValue:"重试"}))}</button>`);
    });
  }
}

function notificationSecondsValue(milliseconds, fallback="") {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return String(Math.round(value / 100) / 10);
}

function thirdPartyUseLabel(value) {
  switch (String(value || "")) {
    case "terminal": return tr("settings:third_party_uses.terminal", {defaultValue:"终端显示与交互"});
    case "sftp_text_edit": return tr("settings:third_party_uses.sftp_text_edit", {defaultValue:"SFTP 文本编辑"});
    case "sftp_diff": return tr("settings:third_party_uses.sftp_diff", {defaultValue:"SFTP 文本差异比较"});
    case "builtin_vnc": return tr("settings:third_party_uses.builtin_vnc", {defaultValue:"内置 VNC 客户端"});
    case "zmodem_transfer": return tr("settings:third_party_uses.zmodem_transfer", {defaultValue:"终端 sz/rz 文件传输"});
    case "ssh_sftp_transport": return tr("settings:third_party_uses.ssh_sftp_transport", {defaultValue:"SSH/SFTP 通信"});
    case "x11_protocol_client": return tr("settings:third_party_uses.x11_protocol_client", {defaultValue:"X11 图片剪贴板协议桥接"});
    case "interface_i18n": return tr("settings:third_party_uses.interface_i18n", {defaultValue:"界面国际化与语言资源管理"});
    case "interface_icons": return tr("settings:third_party_uses.interface_icons", {defaultValue:"界面图标"});
    case "desktop_runtime": return tr("settings:third_party_uses.desktop_runtime", {defaultValue:"桌面应用运行时"});
    case "desktop_pty": return tr("settings:third_party_uses.desktop_pty", {defaultValue:"桌面端 PTY 会话"});
    case "windows_x_server": return tr("settings:third_party_uses.windows_x_server", {defaultValue:"Windows X Server 运行时"});
    default: return tr("settings:third_party_uses.other", {defaultValue:"运行时组件"});
  }
}

function renderSettings() {
  const s = securitySettings || {};
  const about = aboutSettings || {};
  const thirdPartyComponents = Array.isArray(about.third_party_components) ? about.third_party_components : [];
  const thirdPartyRows = thirdPartyComponents.map(item => {
    const name = String(item?.name || tr("settings:auto.unknown_component", {defaultValue:"未知组件"}));
    const version = String(item?.version || tr("settings:auto.unknown_value", {defaultValue:"未知"}));
    const license = String(item?.license || tr("settings:auto.unknown_value", {defaultValue:"未知"}));
    const purpose = thirdPartyUseLabel(item?.use);
    const projectUrl = String(item?.project_url || "");
    const projectTitle = tr("settings:auto.open_component_project", {name, defaultValue:`打开 ${name} 项目主页`});
    const nameHtml = /^https:\/\//i.test(projectUrl)
      ? `<a href="${escAttr(projectUrl)}" target="_blank" rel="noopener" title="${escAttr(projectTitle)}" aria-label="${escAttr(projectTitle)}">${esc(name)}</a>`
      : esc(name);
    return `<div class="about-third-party-row" role="row"><span role="cell">${nameHtml}</span><code role="cell">${esc(version)}</code><span role="cell">${esc(license)}</span><span role="cell">${esc(purpose)}</span></div>`;
  }).join("");
  const toolbarPlacement = normalizeWorkspaceToolbarPlacement(runtimeSettings?.saved?.workspace_toolbar_placement);
  const vncFullscreenToolbar = ["always", "never", "edge"].includes(runtimeSettings?.saved?.vnc_fullscreen_toolbar)
    ? runtimeSettings.saved.vnc_fullscreen_toolbar
    : "always";
  const notificationDisplay = normalizeNotificationDisplay(runtimeSettings?.saved?.notification_display);
  const unknownValue = tr("settings:auto.unknown_value", {defaultValue:"未知"});
  const aboutLoadError = about.load_error || about.license_error
    ? tr("settings:auto.about_load_failed", {error:about.load_error || about.license_error, defaultValue:`程序版本与许可信息加载失败：${about.load_error || about.license_error}`})
    : "";
  const thirdPartyNotice = about.third_party_notices_available
    ? tr("settings:auto.third_party_notice", {defaultValue:"详细组件来源与许可证说明随程序提供于 THIRD_PARTY_NOTICES.md。"})
    : (about.third_party_notices_error || tr("settings:auto.third_party_declaration_missing", {defaultValue:"未找到第三方组件声明"}));
  const uiState = captureUiState($("view-settings") || document);
  $("view-settings").innerHTML = `<div class="panel settings-panel">
    <div class="workspace-head"><div><h2>${esc(tr("settings:title", {defaultValue:"设置"}))}</h2><div class="subtitle">${esc(tr("settings:subtitle", {defaultValue:"访问保护、通知、运行信息与开源许可。"}))}</div></div></div>
    <div class="settings-layout"><div class="settings-groups">
      <div class="settings-group" id="settings-general">
        <div class="settings-group-head"><h3>${esc(tr("settings:general.title", {defaultValue:"通用设置"}))}</h3><span>${esc(tr("settings:general.description", {defaultValue:"管理桌面端行为和工作区恢复。"}))}</span></div>
        <div class="settings-grid single">
          ${storageSettingsPanelHtml()}
          ${desktopBehaviorPanelHtml()}
          <section>
            <h3>${esc(tr("settings:auto.terminal_display"))}</h3>
            <label class="check-row"><input id="terminalLatencyVisible" type="checkbox" ${terminalLatencyVisible ? "checked" : ""} onchange="setTerminalLatencyVisible(this.checked)"> ${esc(tr("settings:auto.show_terminal_latency"))}</label>
            <div class="muted">${esc(tr("settings:auto.terminal_latency_hint"))}</div>
          </section>
          <section>
            <h3>${esc(tr("settings:auto.workspace"))}</h3>
            <label class="check-row"><input id="restoreWorkspaceTabs" type="checkbox" ${runtimeSettings?.saved?.restore_workspace_tabs !== false ? "checked" : ""}> ${esc(tr("settings:auto.restore_tabs"))}</label>
            <div class="muted">${esc(tr("settings:auto.restore_tabs_hint"))}</div>
            <div class="settings-vnc-toolbar-field">
              <label for="generalVncFullscreenToolbar">${esc(tr("settings:auto.vnc_fullscreen_toolbar", {defaultValue:"VNC 内部全屏快捷栏"}))}</label>
              <select id="generalVncFullscreenToolbar">
                <option value="always" ${vncFullscreenToolbar === "always" ? "selected" : ""}>${esc(tr("settings:auto.vnc_fullscreen_toolbar_always", {defaultValue:"始终显示"}))}</option>
                <option value="never" ${vncFullscreenToolbar === "never" ? "selected" : ""}>${esc(tr("settings:auto.vnc_fullscreen_toolbar_never", {defaultValue:"始终隐藏（按 Esc 退出）"}))}</option>
                <option value="edge" ${vncFullscreenToolbar === "edge" ? "selected" : ""}>${esc(tr("settings:auto.vnc_fullscreen_toolbar_edge", {defaultValue:"鼠标移到顶部边界时显示"}))}</option>
              </select>
              <span>${esc(tr("settings:auto.vnc_fullscreen_toolbar_hint", {defaultValue:"控制 VNC 内容全屏时快捷栏的显示方式。"}))}</span>
            </div>
            <h3>${esc(tr("settings:auto.action_location"))}</h3>
            <div class="muted">${esc(tr("settings:auto.action_location_hint"))}</div>
            <label for="toolbarPlacementUnsplitTerminal">${esc(tr("settings:auto.single_terminal"))}</label>
            <select id="toolbarPlacementUnsplitTerminal">
              <option value="tab" ${toolbarPlacement.unsplit.terminal === "tab" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_tab"))}</option>
              <option value="header" ${toolbarPlacement.unsplit.terminal === "header" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_header"))}</option>
            </select>
            <label for="toolbarPlacementUnsplitSftp">${esc(tr("settings:auto.single_sftp"))}</label>
            <select id="toolbarPlacementUnsplitSftp">
              <option value="tab" ${toolbarPlacement.unsplit.sftp === "tab" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_tab"))}</option>
              <option value="header" ${toolbarPlacement.unsplit.sftp === "header" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_header"))}</option>
            </select>
            <label for="toolbarPlacementSplitTerminal">${esc(tr("settings:auto.split_terminal"))}</label>
            <select id="toolbarPlacementSplitTerminal">
              <option value="tab" ${toolbarPlacement.split.terminal === "tab" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_tab"))}</option>
              <option value="header" ${toolbarPlacement.split.terminal === "header" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_header"))}</option>
            </select>
            <label for="toolbarPlacementSplitSftp">${esc(tr("settings:auto.split_sftp"))}</label>
            <select id="toolbarPlacementSplitSftp">
              <option value="tab" ${toolbarPlacement.split.sftp === "tab" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_tab"))}</option>
              <option value="header" ${toolbarPlacement.split.sftp === "header" ? "selected" : ""}>${esc(tr("settings:auto.toolbar_in_header"))}</option>
            </select>
            <div class="actions"><button id="restoreWorkspaceTabsSave" class="primary" type="button" onclick="saveWorkspaceSettings()">${icon("save")}<span>${esc(tr("settings:general.save", {defaultValue:"保存通用设置"}))}</span></button></div>
          </section>
        </div>
      </div>
      <div class="settings-group" id="settings-basic">
        <div class="settings-group-head"><h3>${esc(tr("settings:auto.security_settings"))}</h3><span>${esc(tr("settings:auto.security_description"))}</span></div>
        <div class="settings-grid">
      ${sshHostTrustPanelHtml()}
      <section>
        <h3>${esc(tr("settings:auto.web_access"))}</h3>
        <label>${esc(tr("settings:auto.auth_policy"))}</label>
        <select id="securityAuthMode">
          <option value="lan" ${s.auth_mode === "lan" ? "selected" : ""}>${esc(tr("settings:auto.auth_lan"))}</option>
          <option value="always" ${s.auth_mode === "always" ? "selected" : ""}>${esc(tr("settings:auto.auth_always"))}</option>
          <option value="off" ${s.auth_mode === "off" ? "selected" : ""}>${esc(tr("settings:auto.auth_off"))}</option>
        </select>
        <div class="muted">${esc(tr("settings:auto.local_direct_hint"))}</div>
        <label>${esc(tr("settings:auto.cookie_security"))}</label>
        <select id="securitySecureCookieMode">
          <option value="auto" ${(s.secure_cookie_mode || "auto") === "auto" ? "selected" : ""}>${esc(tr("settings:auto.cookie_auto"))}</option>
          <option value="always" ${s.secure_cookie_mode === "always" ? "selected" : ""}>${esc(tr("settings:auto.cookie_always"))}</option>
          <option value="never" ${s.secure_cookie_mode === "never" ? "selected" : ""}>${esc(tr("settings:auto.cookie_never"))}</option>
        </select>
        <label class="check-row"><input id="securityTrustedProxyEnabled" type="checkbox" data-change-action="security-local-direct-desktop-integration" ${s.trusted_proxy_enabled ? "checked" : ""}> ${esc(tr("settings:auto.trust_proxy"))}</label>
        <label>${esc(tr("settings:auto.trusted_proxy_ip"))}</label>
        <input id="securityTrustedProxyAddresses" value="${escAttr((s.trusted_proxy_addresses || []).join(", "))}" placeholder="${escAttr(tr("settings:auto.trusted_proxy_placeholder"))}">
        <div class="muted">${esc(tr("settings:auto.trusted_proxy_hint"))}</div>
        <label class="check-row"><input id="securityLocalDirectDesktopIntegration" type="checkbox" data-change-action="security-local-direct-desktop-integration" ${s.local_direct_desktop_integration_enabled ? "checked" : ""}> ${esc(tr("settings:auto.local_desktop_integration"))}</label>
        ${localDirectDesktopIntegrationStatusHtml(s)}
        <label>${esc(tr("settings:auto.allowed_hosts"))}</label>
        <input id="securityAllowedHosts" value="${escAttr((s.allowed_hosts || []).join(", "))}" placeholder="${escAttr(tr("settings:auto.allowed_hosts_placeholder"))}">
        <div class="muted">${esc(tr("settings:auto.allowed_hosts_hint"))}</div>
        <h3>${esc(tr("settings:auto.login_rate_limit"))}</h3>
        <label>${esc(tr("settings:auto.source_failures"))}</label>
        <input id="securityLoginMaxFailures" type="number" min="${Number(s.login_protection?.limits?.maxFailures?.min || 1)}" max="${Number(s.login_protection?.limits?.maxFailures?.max || 100)}" value="${Number(s.login_protection?.max_failures || 5)}">
        <label>${esc(tr("settings:auto.source_window"))}</label>
        <input id="securityLoginWindowSeconds" type="number" min="${Number(s.login_protection?.limits?.windowSeconds?.min || 30)}" max="${Number(s.login_protection?.limits?.windowSeconds?.max || 86400)}" value="${Number(s.login_protection?.window_seconds || 300)}">
        <label>${esc(tr("settings:auto.source_lock"))}</label>
        <input id="securityLoginLockSeconds" type="number" min="${Number(s.login_protection?.limits?.lockSeconds?.min || 1)}" max="${Number(s.login_protection?.limits?.lockSeconds?.max || 86400)}" value="${Number(s.login_protection?.lock_seconds || 300)}">
        <label class="check-row"><input id="securityGlobalLoginProtectionEnabled" type="checkbox" ${s.login_protection?.global_enabled !== false ? "checked" : ""}> ${esc(tr("settings:auto.global_login_protection"))}</label>
        <label>${esc(tr("settings:auto.global_failures"))}</label>
        <input id="securityGlobalLoginMaxFailures" type="number" min="${Number(s.login_protection?.limits?.globalMaxFailures?.min || 0)}" max="${Number(s.login_protection?.limits?.globalMaxFailures?.max || 10000)}" value="${Number(s.login_protection?.global_max_failures || 50)}">
        <label>${esc(tr("settings:auto.global_window"))}</label>
        <input id="securityGlobalLoginWindowSeconds" type="number" min="${Number(s.login_protection?.limits?.globalWindowSeconds?.min || 30)}" max="${Number(s.login_protection?.limits?.globalWindowSeconds?.max || 86400)}" value="${Number(s.login_protection?.global_window_seconds || 300)}">
        <label>${esc(tr("settings:auto.global_lock"))}</label>
        <input id="securityGlobalLoginLockSeconds" type="number" min="${Number(s.login_protection?.limits?.globalLockSeconds?.min || 1)}" max="${Number(s.login_protection?.limits?.globalLockSeconds?.max || 86400)}" value="${Number(s.login_protection?.global_lock_seconds || 60)}">
        <div class="muted">${esc(tr("settings:auto.login_protection_hint"))}</div>
        <div class="warning">${esc(tr("settings:auto.lan_password_warning"))}</div>
        <div class="actions"><button class="primary" onclick="saveSecurityOptions()">${esc(tr("settings:auto.save_auth_policy"))}</button><button onclick="logout()">${esc(tr("settings:auto.sign_out"))}</button></div>
      </section>
      <section>
        <h3>${esc(tr("settings:auto.session_management"))}</h3>
        <label>${esc(tr("settings:auto.session_ttl"))}</label>
        <input id="securitySessionTtlMinutes" type="number" min="${Number(s.session_management?.limits?.ttl_minutes?.min || 5)}" max="${Number(s.session_management?.limits?.ttl_minutes?.max || 43200)}" value="${Number(s.session_management?.ttl_minutes || 720)}">
        <label>${esc(tr("settings:auto.session_max"))}</label>
        <input id="securitySessionMaxSessions" type="number" min="${Number(s.session_management?.limits?.max_sessions?.min || 1)}" max="${Number(s.session_management?.limits?.max_sessions?.max || 10000)}" value="${Number(s.session_management?.max_sessions || 1000)}">
        <label>${esc(tr("settings:auto.session_cleanup"))}</label>
        <input id="securitySessionCleanupMinutes" type="number" min="${Number(s.session_management?.limits?.cleanup_minutes?.min || 1)}" max="${Number(s.session_management?.limits?.cleanup_minutes?.max || 1440)}" value="${Number(s.session_management?.cleanup_minutes || 10)}">
        <div class="cmd">${esc(tr("settings:auto.active_sessions", {count:Number(s.active_sessions || 0)}))}</div>
        <div class="muted">${esc(tr("settings:auto.session_hint"))}</div>
        <div class="actions"><button class="primary" onclick="saveSessionManagement()">${icon("save")}<span>${esc(tr("settings:auto.save_session"))}</span></button></div>
      </section>
      <section>
        <h3>${esc(tr("settings:auto.passwords_tokens"))}</h3>
        <label>${esc(tr("settings:auto.set_web_password"))} <span id="securityPasswordState">${esc(tr(s.password_set ? "settings:auto.set" : "settings:auto.not_set"))}</span></label>
        <input id="securityPassword" type="password" placeholder="${escAttr(tr("settings:auto.web_password_placeholder"))}">
        <div class="muted">${esc(tr("settings:auto.web_password_hint"))}</div>
        <div class="actions"><button onclick="saveWebPassword()">${esc(tr("settings:auto.save_password"))}</button></div>
        <label>${esc(tr("settings:auto.access_token"))} <span id="securityTokenState">${esc(tr(s.token_set ? "settings:auto.set" : "settings:auto.not_set"))}</span></label>
        <div class="muted">${esc(tr("settings:auto.access_token_hint"))}</div>
        <div class="actions"><button id="securityTokenBtn" onclick="generateAccessToken()">${esc(tr(s.token_set ? "settings:auto.regenerate_token" : "settings:auto.generate_token"))}</button></div>
      </section>
      <section class="security-encryption-section">
        <h3>${esc(tr("settings:auto.config_encryption"))}</h3>
        <details id="securityAdvancedDetails" class="advanced-settings" open>
          <summary>${esc(tr("settings:auto.config_encryption"))} ${esc(tr(s.encryption_transition_pending ? "settings:auto.encryption_transition_pending" : s.encryption_upgrade_required ? "settings:auto.encryption_upgrade_required" : s.encryption_enabled ? (s.encryption_unlocked ? "settings:auto.encryption_state_unlocked" : "settings:auto.encryption_state_locked") : "settings:auto.encryption_optional"))}</summary>
          <div class="muted">${esc(tr("settings:auto.config_encryption_hint"))}</div>
          <div class="warning">${esc(tr("settings:auto.config_encryption_detail"))}</div>
          <label>${esc(tr("settings:auto.master_password"))}</label>
          <input id="securityMasterPassword" type="password" placeholder="${escAttr(tr(s.encryption_enabled ? "settings:auto.existing_master_password_placeholder" : "settings:auto.new_master_password_placeholder"))}">
          <div class="actions">
            ${s.encryption_enabled ? "" : `<button onclick="enableConfigEncryption()">${esc(tr("settings:auto.enable_encryption"))}</button>`}
            ${s.encryption_enabled ? `<button onclick="unlockConfigEncryption()">${esc(tr(s.encryption_transition_pending ? "settings:auto.continue_repair" : s.encryption_upgrade_required ? "settings:auto.unlock_rotate" : "settings:auto.unlock"))}</button>${s.encryption_transition_pending ? "" : `<button class="danger" onclick="disableConfigEncryption()">${esc(tr("settings:security.decrypt_disable"))}</button>`}` : ""}
          </div>
        </details>
      </section>
        </div>
      </div>
      <div class="settings-group" id="settings-notifications">
        <div class="settings-group-head"><h3>${esc(tr("settings:auto.notification_settings"))}</h3><span>${esc(tr("settings:auto.notifications_description"))}</span></div>
        <div class="settings-grid single">
      <section>
        <h3>${esc(tr("settings:auto.notifications"))}</h3>
        <div class="muted">${esc(tr("settings:auto.notifications_intro"))}</div>
        <div class="cmd">${esc(tr("settings:auto.notification_status", {status:notificationPermissionText()}))}</div>
        <label>${esc(tr("settings:auto.notification_method"))}</label>
        <select id="notificationMode">
          <option value="on" ${(s.notification_mode || "on") === "on" ? "selected" : ""}>${esc(tr("settings:auto.notification_mode_on"))}</option>
          <option value="muted" ${s.notification_mode === "muted" ? "selected" : ""}>${esc(tr("settings:auto.notification_mode_muted"))}</option>
          <option value="off" ${s.notification_mode === "off" ? "selected" : ""}>${esc(tr("settings:auto.notification_mode_off"))}</option>
        </select>
        <h3>${esc(tr("settings:auto.page_notifications"))}</h3>
        <div class="notification-preference-list">
          <div class="notification-preference-row">
            <label class="check-row"><input id="notificationInfoEnabled" type="checkbox" ${notificationDisplay.info.enabled ? "checked" : ""} onchange="syncNotificationSettingControls()"> ${esc(tr("settings:auto.info_notification"))}</label>
            <label class="notification-duration"><span>${esc(tr("settings:auto.display"))}</span><input id="notificationInfoDuration" type="number" min="0.5" max="60" step="0.1" value="${notificationSecondsValue(notificationDisplay.info.duration_ms, "3.5")}"><span>${esc(tr("settings:auto.seconds"))}</span></label>
          </div>
          <div class="notification-preference-row">
            <label class="check-row"><input id="notificationSuccessEnabled" type="checkbox" ${notificationDisplay.success.enabled ? "checked" : ""} onchange="syncNotificationSettingControls()"> ${esc(tr("settings:auto.success_notification"))}</label>
            <label class="notification-duration"><span>${esc(tr("settings:auto.display"))}</span><input id="notificationSuccessDuration" type="number" min="0.5" max="60" step="0.1" value="${notificationSecondsValue(notificationDisplay.success.duration_ms, "3.5")}"><span>${esc(tr("settings:auto.seconds"))}</span></label>
          </div>
          <div class="notification-preference-row">
            <label class="check-row"><input id="notificationErrorEnabled" type="checkbox" ${notificationDisplay.error.enabled ? "checked" : ""} onchange="syncNotificationSettingControls()"> ${esc(tr("settings:auto.error_notification"))}</label>
            <label class="notification-duration"><span>${esc(tr("settings:auto.display"))}</span><input id="notificationErrorDuration" type="number" min="0.5" max="60" step="0.1" value="${notificationSecondsValue(notificationDisplay.error.duration_ms, "8")}"><span>${esc(tr("settings:auto.seconds"))}</span></label>
          </div>
          <div class="notification-preference-row notification-progress-preference">
            <label class="check-row"><input id="notificationProgressEnabled" type="checkbox" ${notificationDisplay.progress.enabled ? "checked" : ""} onchange="syncNotificationSettingControls()"> ${esc(tr("settings:auto.progress_notification"))}</label>
            <div class="notification-progress-durations">
              <label class="notification-duration"><span>${esc(tr("settings:auto.after_success"))}</span><input id="notificationProgressSuccessDuration" type="number" min="0.5" max="60" step="0.1" value="${notificationSecondsValue(notificationDisplay.progress.success_duration_ms)}" placeholder="${escAttr(tr("settings:auto.task_default"))}"><span>${esc(tr("settings:auto.seconds"))}</span></label>
              <label class="notification-duration"><span>${esc(tr("settings:auto.after_failure"))}</span><input id="notificationProgressErrorDuration" type="number" min="0.5" max="60" step="0.1" value="${notificationSecondsValue(notificationDisplay.progress.error_duration_ms, "8")}"><span>${esc(tr("settings:auto.seconds"))}</span></label>
            </div>
          </div>
          <div class="notification-preference-row">
            <label class="check-row"><input id="taskCenterFloatingProgressEnabled" type="checkbox" ${runtimeSettings?.saved?.sftp_floating_progress_enabled !== false ? "checked" : ""}> ${esc(tr("settings:auto.floating_task_card"))}</label>
            <span class="muted">${esc(tr("settings:auto.while_task_running"))}</span>
          </div>
        </div>
        <div class="muted">${esc(tr("settings:auto.notification_disable_hint"))}</div>
        <div class="actions"><button id="notificationSaveBtn" class="primary" onclick="saveNotificationOptions()">${esc(tr("settings:auto.save_notifications"))}</button><button onclick="requestDesktopNotifications()">${esc(tr("settings:auto.enable_desktop_notifications"))}</button></div>
      </section>
        </div>
      </div>
      <div class="settings-group" id="settings-runtime">
        <div class="settings-group-head"><h3>${esc(tr("settings:sections.runtime"))}</h3><span>${esc(tr("settings:auto.runtime_description"))}</span></div>
        <div class="settings-grid runtime-settings-grid">
          <section>
            <h3>${esc(tr("settings:auto.listener_config"))}</h3>
            <div id="runtimeSettingsPanel">${runtimeSettingsPanelHtml()}</div>
          </section>
          <section>
            <h3>${esc(tr("settings:auto.current_urls"))}</h3>
            <div class="muted">${esc(tr("settings:auto.current_urls_hint"))}</div>
            <div id="runtimeCurrentUrls">${runtimeUrlListHtml()}</div>
            <h3 class="runtime-diagnostics-title">${esc(tr("settings:auto.runtime_diagnostics"))}</h3>
            <div class="muted">${esc(tr("settings:auto.runtime_diagnostics_hint"))}</div>
            <div id="runtimeDiagnostics" class="diagnostics-box muted">${esc(tr("settings:auto.not_loaded"))}</div>
            <div class="actions"><button type="button" onclick="loadRuntimeDiagnostics()">${icon("refresh-cw")}<span>${esc(tr("settings:auto.refresh_diagnostics"))}</span></button></div>
          </section>
        </div>
      </div>
      <div class="settings-group" id="settings-cache">
        <div class="settings-group-head"><h3>${esc(tr("settings:sections.cache"))}</h3><span>${esc(tr("settings:auto.cache_description"))}</span></div>
        <div class="settings-grid single">
          ${cacheManagementPanelHtml()}
        </div>
      </div>
      <div class="settings-group" id="settings-about">
        <div class="settings-group-head"><h3>${esc(tr("settings:auto.about_title", {defaultValue:"关于 Terma"}))}</h3><span>${esc(tr("settings:auto.about_description", {defaultValue:"版本、更新、项目地址与开源许可信息。"}))}</span></div>
        <div class="settings-grid single">
          <section class="about-section">
            <div class="about-product"><img class="about-mark" src="/assets/terma-icon.png" alt="" aria-hidden="true"><div><h3>${esc(about.product_name || "Terma")}</h3><div class="muted">${esc(tr("settings:auto.version_value", {version:about.version || unknownValue, defaultValue:`版本 ${about.version || unknownValue}`}))}</div></div></div>
            <dl class="about-meta">
              <div><dt>${esc(tr("settings:auto.open_source_license", {defaultValue:"开源许可"}))}</dt><dd>${esc(tr("settings:auto.license_identifier", {name:about.license_name || "GNU General Public License v3.0 only", identifier:about.license || "GPL-3.0-only"}))}</dd></div>
              <div><dt>${esc(tr("settings:auto.project_author", {defaultValue:"项目作者"}))}</dt><dd>${esc(about.author || "zmide")}</dd></div>
              <div><dt>${esc(tr("settings:auto.copyright", {defaultValue:"版权"}))}</dt><dd>Copyright (C) 2026 zmide</dd></div>
            </dl>
            ${aboutLoadError ? `<div class="warning">${esc(aboutLoadError)}</div>` : ""}
            <div id="updateCheckArea">${updateStatusHtml()}</div>
            <div class="muted">${esc(tr("settings:auto.warranty_notice", {defaultValue:"本软件按现状提供，不附带任何担保。使用、修改和再分发须遵守 GNU GPL v3.0 条款。"}))}</div>
            <div class="actions about-actions"><a class="button-link" href="${escAttr(about.repository_url || "https://github.com/zmide/Terma")}" target="_blank" rel="noopener">${icon("github")}<span>${esc(tr("settings:auto.github_source", {defaultValue:"GitHub 源码"}))}</span></a><button id="openLicenseBtn" onclick="showLicenseModal(this)">${icon("scroll-text")}<span>${esc(tr("settings:auto.view_license", {defaultValue:"查看开源许可正文"}))}</span></button></div>
            <section class="about-third-party" aria-labelledby="aboutThirdPartyTitle">
              <div class="about-third-party-head"><div><h4 id="aboutThirdPartyTitle">${esc(tr("settings:auto.bundled_components", {defaultValue:"随附组件"}))}</h4><span>${esc(tr("settings:auto.bundled_components_hint", {defaultValue:"程序内置组件的版本与许可证"}))}</span></div><span class="status-pill">${esc(tr("settings:auto.item_count", {count:thirdPartyComponents.length, defaultValue:`${thirdPartyComponents.length} 项`}))}</span></div>
              ${thirdPartyRows ? `<div class="about-third-party-list" role="table" aria-label="${escAttr(tr("settings:auto.third_party", {defaultValue:"第三方组件清单"}))}"><div class="about-third-party-row about-third-party-head-row" role="row"><span role="columnheader">${esc(tr("settings:auto.component", {defaultValue:"组件"}))}</span><span role="columnheader">${esc(tr("settings:auto.version", {defaultValue:"版本"}))}</span><span role="columnheader">${esc(tr("settings:auto.license", {defaultValue:"许可证"}))}</span><span role="columnheader">${esc(tr("settings:auto.purpose", {defaultValue:"用途"}))}</span></div>${thirdPartyRows}</div>` : `<div class="warning">${esc(tr("settings:auto.bundled_components_missing", {defaultValue:"未找到随程序提供的第三方组件清单。"}))}</div>`}
              <div class="muted about-third-party-notice">${esc(thirdPartyNotice)}</div>
            </section>
          </section>
        </div>
      </div>
    </div></div>
  </div>`;
  restoreUiState(uiState);
  showSettingsSection(activeSettingsSection, {moveToWorkspace:false});
  syncRuntimeHostOptions();
  syncNotificationSettingControls();
  syncDesktopCustomDataMode();
  syncUpdateNoticeForCurrentSection();
  refreshIcons();
}
