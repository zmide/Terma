async function openSettings(updateTab=true) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = !updateTab && currentTab?.kind === "settings" ? currentTab.key : "settings";
  inPane(() => {
    setWorkspace("设置", "访问保护、通知、运行信息与开源许可", "settings", tabKey, updateTab, true, {kind:"settings"});
    $("view-settings").innerHTML = stateView("loading", "正在加载设置", "正在读取访问保护、运行状态和程序信息。");
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
      $("view-settings").innerHTML = stateView("error", "设置加载失败", error.message, `<button onclick="openSettings(false)">重试</button>`);
    });
  }
}

function renderSettings() {
  const s = securitySettings || {};
  const about = aboutSettings || {};
  const thirdPartyComponents = Array.isArray(about.third_party_components) ? about.third_party_components : [];
  const thirdPartyRows = thirdPartyComponents.map(item => {
    const name = String(item?.name || "未知组件");
    const version = String(item?.version || "未知");
    const license = String(item?.license || "未知");
    const projectUrl = String(item?.project_url || "");
    const nameHtml = /^https:\/\//i.test(projectUrl)
      ? `<a href="${escAttr(projectUrl)}" target="_blank" rel="noopener" title="打开 ${escAttr(name)} 项目主页">${esc(name)}</a>`
      : esc(name);
    return `<div class="about-third-party-row" role="row"><span role="cell">${nameHtml}</span><code role="cell">${esc(version)}</code><span role="cell">${esc(license)}</span></div>`;
  }).join("");
  const toolbarPlacement = normalizeWorkspaceToolbarPlacement(runtimeSettings?.saved?.workspace_toolbar_placement);
  const uiState = captureUiState($("view-settings") || document);
  $("view-settings").innerHTML = `<div class="panel settings-panel">
    <div class="workspace-head"><div><h2>设置</h2><div class="subtitle">访问保护、通知、运行信息与开源许可。</div></div></div>
    <div class="settings-layout"><div class="settings-groups">
      <div class="settings-group" id="settings-general">
        <div class="settings-group-head"><h3>通用设置</h3><span>管理桌面端行为和工作区恢复。</span></div>
        <div class="settings-grid single">
          ${storageSettingsPanelHtml()}
          ${desktopBehaviorPanelHtml()}
          <section>
            <h3>终端显示</h3>
            <label class="check-row"><input id="terminalLatencyVisible" type="checkbox" ${terminalLatencyVisible ? "checked" : ""} onchange="setTerminalLatencyVisible(this.checked)"> 显示终端交互响应延迟</label>
            <div class="muted">默认开启。延迟从实际按键发送开始，到远端终端首次返回数据为止；不会额外发送探测命令，也不会触发 Tab 补全。此选项保存在当前设备。</div>
          </section>
          <section>
            <h3>工作区</h3>
            <label class="check-row"><input id="restoreWorkspaceTabs" type="checkbox" ${runtimeSettings?.saved?.restore_workspace_tabs !== false ? "checked" : ""}> 恢复上次未关闭的标签</label>
            <div class="muted">默认开启。重新启动 Terma 后会恢复终端、SFTP、转发、设置、日志、导入导出等所有未关闭的工作区标签。</div>
            <h3>任务中心</h3>
            <label class="check-row"><input id="taskCenterFloatingProgressEnabled" type="checkbox" ${runtimeSettings?.saved?.sftp_floating_progress_enabled !== false ? "checked" : ""}> 显示右上角悬浮任务进度卡</label>
            <div class="muted">用于显示传输、目录同步和 Linux 桌面安装/卸载等后台任务。关闭悬浮卡不会停止任务，仍可从工作区标题栏的任务中心查看。</div>
            <h3>操作按钮位置</h3>
            <div class="muted">桌面端可以分别设置终端和 SFTP 的操作按钮。选择“工作区标题栏”时，只显示当前焦点标签的按钮；移动端仍使用紧凑布局。</div>
            <label for="toolbarPlacementUnsplitTerminal">未分屏 · 终端</label>
            <select id="toolbarPlacementUnsplitTerminal">
              <option value="tab" ${toolbarPlacement.unsplit.terminal === "tab" ? "selected" : ""}>各自标签内</option>
              <option value="header" ${toolbarPlacement.unsplit.terminal === "header" ? "selected" : ""}>工作区标题栏</option>
            </select>
            <label for="toolbarPlacementUnsplitSftp">未分屏 · SFTP</label>
            <select id="toolbarPlacementUnsplitSftp">
              <option value="tab" ${toolbarPlacement.unsplit.sftp === "tab" ? "selected" : ""}>各自标签内</option>
              <option value="header" ${toolbarPlacement.unsplit.sftp === "header" ? "selected" : ""}>工作区标题栏</option>
            </select>
            <label for="toolbarPlacementSplitTerminal">分屏 · 终端</label>
            <select id="toolbarPlacementSplitTerminal">
              <option value="tab" ${toolbarPlacement.split.terminal === "tab" ? "selected" : ""}>各自标签内</option>
              <option value="header" ${toolbarPlacement.split.terminal === "header" ? "selected" : ""}>工作区标题栏</option>
            </select>
            <label for="toolbarPlacementSplitSftp">分屏 · SFTP</label>
            <select id="toolbarPlacementSplitSftp">
              <option value="tab" ${toolbarPlacement.split.sftp === "tab" ? "selected" : ""}>各自标签内</option>
              <option value="header" ${toolbarPlacement.split.sftp === "header" ? "selected" : ""}>工作区标题栏</option>
            </select>
            <div class="actions"><button id="restoreWorkspaceTabsSave" class="primary" type="button" onclick="saveWorkspaceSettings()">${icon("save")}<span>保存通用设置</span></button></div>
          </section>
        </div>
      </div>
      <div class="settings-group" id="settings-basic">
        <div class="settings-group-head"><h3>安全设置</h3><span>管理 Web 访问认证、SSH 主机信任、密码、Token 和配置加密。</span></div>
        <div class="settings-grid">
      ${sshHostTrustPanelHtml()}
      <section>
        <h3>Web 访问保护</h3>
        <label>认证策略</label>
        <select id="securityAuthMode">
          <option value="lan" ${s.auth_mode === "lan" ? "selected" : ""}>仅非本机访问时校验密码</option>
          <option value="always" ${s.auth_mode === "always" ? "selected" : ""}>所有浏览器访问都校验密码</option>
          <option value="off" ${s.auth_mode === "off" ? "selected" : ""}>关闭 Web 认证（高风险）</option>
        </select>
        <div class="muted">“本机直连”要求来源和 Host 都是回环或当前机器地址，并且没有反向代理转发头；通过局域网地址、反代域名或代理转发访问仍需登录。</div>
        <label>会话 Cookie 安全模式</label>
        <select id="securitySecureCookieMode">
          <option value="auto" ${(s.secure_cookie_mode || "auto") === "auto" ? "selected" : ""}>自动识别 HTTPS（推荐）</option>
          <option value="always" ${s.secure_cookie_mode === "always" ? "selected" : ""}>始终使用 Secure</option>
          <option value="never" ${s.secure_cookie_mode === "never" ? "selected" : ""}>从不使用 Secure</option>
        </select>
        <label class="check-row"><input id="securityTrustedProxyEnabled" type="checkbox" data-change-action="security-local-direct-desktop-integration" ${s.trusted_proxy_enabled ? "checked" : ""}> 信任指定的 HTTPS 反向代理</label>
        <label>可信代理 IP</label>
        <input id="securityTrustedProxyAddresses" value="${escAttr((s.trusted_proxy_addresses || []).join(", "))}" placeholder="例如 127.0.0.1, 192.168.1.2">
        <div class="muted">仅来自这些 IP 的请求可以使用 X-Forwarded-For 和 X-Forwarded-Proto。自动模式只在直连 HTTPS 或可信代理明确报告 HTTPS 时发送 Secure Cookie。</div>
        <label class="check-row"><input id="securityLocalDirectDesktopIntegration" type="checkbox" data-change-action="security-local-direct-desktop-integration" ${s.local_direct_desktop_integration_enabled ? "checked" : ""}> 本机直连浏览器自动使用桌面集成</label>
        ${localDirectDesktopIntegrationStatusHtml(s)}
        <label>允许的 Host / 反代域名</label>
        <input id="securityAllowedHosts" value="${escAttr((s.allowed_hosts || []).join(", "))}" placeholder="例如 terma.example.com, terma.example.com:8443">
        <div class="muted">直接访问本机、当前机器名或监听 IP 无需填写；使用自定义反代域名时，请填写浏览器实际使用的精确 Host，不支持通配符。</div>
        <h3>登录限速</h3>
        <label>单来源失败次数</label>
        <input id="securityLoginMaxFailures" type="number" min="${Number(s.login_protection?.limits?.maxFailures?.min || 1)}" max="${Number(s.login_protection?.limits?.maxFailures?.max || 100)}" value="${Number(s.login_protection?.max_failures || 5)}">
        <label>单来源统计窗口（秒）</label>
        <input id="securityLoginWindowSeconds" type="number" min="${Number(s.login_protection?.limits?.windowSeconds?.min || 30)}" max="${Number(s.login_protection?.limits?.windowSeconds?.max || 86400)}" value="${Number(s.login_protection?.window_seconds || 300)}">
        <label>单来源锁定时间（秒）</label>
        <input id="securityLoginLockSeconds" type="number" min="${Number(s.login_protection?.limits?.lockSeconds?.min || 1)}" max="${Number(s.login_protection?.limits?.lockSeconds?.max || 86400)}" value="${Number(s.login_protection?.lock_seconds || 300)}">
        <label class="check-row"><input id="securityGlobalLoginProtectionEnabled" type="checkbox" ${s.login_protection?.global_enabled !== false ? "checked" : ""}> 启用全局登录失败保护</label>
        <label>全局失败次数</label>
        <input id="securityGlobalLoginMaxFailures" type="number" min="${Number(s.login_protection?.limits?.globalMaxFailures?.min || 0)}" max="${Number(s.login_protection?.limits?.globalMaxFailures?.max || 10000)}" value="${Number(s.login_protection?.global_max_failures || 50)}">
        <label>全局统计窗口（秒）</label>
        <input id="securityGlobalLoginWindowSeconds" type="number" min="${Number(s.login_protection?.limits?.globalWindowSeconds?.min || 30)}" max="${Number(s.login_protection?.limits?.globalWindowSeconds?.max || 86400)}" value="${Number(s.login_protection?.global_window_seconds || 300)}">
        <label>全局锁定时间（秒）</label>
        <input id="securityGlobalLoginLockSeconds" type="number" min="${Number(s.login_protection?.limits?.globalLockSeconds?.min || 1)}" max="${Number(s.login_protection?.limits?.globalLockSeconds?.max || 86400)}" value="${Number(s.login_protection?.global_lock_seconds || 60)}">
        <div class="muted">单来源保护只影响当前来源地址；全局保护会在多个来源累计失败达到阈值后短暂暂停新的登录尝试。关闭全局保护不会关闭单来源保护。</div>
        <div class="warning">关闭局域网密码后，局域网内设备可能直接操作 SSH、SFTP、密钥、转发和批量命令。</div>
        <div class="actions"><button class="primary" onclick="saveSecurityOptions()">保存认证策略</button><button onclick="logout()">退出登录</button></div>
      </section>
      <section>
        <h3>会话管理</h3>
        <label>登录会话有效期（分钟）</label>
        <input id="securitySessionTtlMinutes" type="number" min="${Number(s.session_management?.limits?.ttl_minutes?.min || 5)}" max="${Number(s.session_management?.limits?.ttl_minutes?.max || 43200)}" value="${Number(s.session_management?.ttl_minutes || 720)}">
        <label>最大活动会话数</label>
        <input id="securitySessionMaxSessions" type="number" min="${Number(s.session_management?.limits?.max_sessions?.min || 1)}" max="${Number(s.session_management?.limits?.max_sessions?.max || 10000)}" value="${Number(s.session_management?.max_sessions || 1000)}">
        <label>过期会话清理间隔（分钟）</label>
        <input id="securitySessionCleanupMinutes" type="number" min="${Number(s.session_management?.limits?.cleanup_minutes?.min || 1)}" max="${Number(s.session_management?.limits?.cleanup_minutes?.max || 1440)}" value="${Number(s.session_management?.cleanup_minutes || 10)}">
        <div class="cmd">当前活动会话：${Number(s.active_sessions || 0)}</div>
        <div class="muted">保存后对新会话立即生效。缩短有效期或降低数量上限时，已有会话会同步收紧；过期会话即使尚未到定时清理时间也不能继续使用。</div>
        <div class="actions"><button class="primary" onclick="saveSessionManagement()">${icon("save")}<span>保存会话设置</span></button></div>
      </section>
      <section>
        <h3>密码和 Token</h3>
        <label>设置 Web 密码 <span id="securityPasswordState">${s.password_set ? "（已设置）" : "（未设置）"}</span></label>
        <input id="securityPassword" type="password" placeholder="至少 8 位">
        <div class="muted">Web 密码用于浏览器登录，普通使用、手机访问和局域网访问一般只需要设置这个。</div>
        <div class="actions"><button onclick="saveWebPassword()">保存密码</button></div>
        <label>访问 Token <span id="securityTokenState">${s.token_set ? "（已设置）" : "（未设置）"}</span></label>
        <div class="muted">Token 主要给脚本、curl 或第三方工具通过 Bearer Token 调用 API 使用；未设置 Web 密码而当前访问需要认证时，也可在登录页输入 Token。Token 由系统随机生成，只显示一次。</div>
        <div class="actions"><button id="securityTokenBtn" onclick="generateAccessToken()">${s.token_set ? "重新生成 Token" : "生成 Token"}</button></div>
      </section>
      <section class="security-encryption-section">
        <h3>配置加密</h3>
        <details id="securityAdvancedDetails" class="advanced-settings" open>
          <summary>配置加密 ${s.encryption_transition_pending ? "（切换待继续）" : s.encryption_upgrade_required ? "（需要密钥轮换）" : s.encryption_enabled ? (s.encryption_unlocked ? "（已解锁）" : "（已锁定）") : "（可选）"}</summary>
          <div class="muted">配置加密不是普通使用必需项。启用时会自动加密现有和以后保存的私钥路径、额外 SSH 参数；不会加密私钥文件本身。个人或局域网自用场景通常保持关闭即可。</div>
          <div class="warning">启用后，SSH 连接、SFTP、终端、转发和批量命令在使用加密字段前需要先解锁。旧版加密会在输入原主密码后使用全新密钥轮换；完成后请重新生成备份并清理旧 v1 备份。关闭加密会要求主密码，并把已加密字段解密回普通数据库字段。</div>
          <label>主密码</label>
          <input id="securityMasterPassword" type="password" placeholder="${s.encryption_enabled ? "输入现有主密码" : "新主密码至少 12 位"}">
          <div class="actions">
            ${s.encryption_enabled ? "" : `<button onclick="enableConfigEncryption()">启用加密</button>`}
            ${s.encryption_enabled ? `<button onclick="unlockConfigEncryption()">${s.encryption_transition_pending ? "继续修复" : s.encryption_upgrade_required ? "解锁并轮换密钥" : "解锁"}</button>${s.encryption_transition_pending ? "" : `<button class="danger" onclick="disableConfigEncryption()">解密并关闭</button>`}` : ""}
          </div>
        </details>
      </section>
        </div>
      </div>
      <div class="settings-group" id="settings-notifications">
        <div class="settings-group-head"><h3>通知设置</h3><span>选择异常和后台任务的提醒方式。</span></div>
        <div class="settings-grid single">
      <section>
        <h3>通知</h3>
        <div class="muted">转发异常、自动重连失败、恢复成功、批量命令完成和 SFTP 后台任务完成会先显示页面提示。授权桌面通知后，浏览器或桌面端也可以显示系统通知。</div>
        <div class="cmd">当前状态：${notificationPermissionText()}</div>
        <label>提醒方式</label>
        <select id="notificationMode">
          <option value="on" ${(s.notification_mode || "on") === "on" ? "selected" : ""}>正常提醒</option>
          <option value="muted" ${s.notification_mode === "muted" ? "selected" : ""}>静音，只记录已读</option>
          <option value="off" ${s.notification_mode === "off" ? "selected" : ""}>关闭提醒</option>
        </select>
        <div class="actions"><button class="primary" onclick="saveNotificationOptions()">保存通知设置</button><button onclick="requestDesktopNotifications()">开启桌面通知</button></div>
      </section>
        </div>
      </div>
      <div class="settings-group" id="settings-runtime">
        <div class="settings-group-head"><h3>启动与运行</h3><span>配置监听地址和端口，查看当前运行诊断。</span></div>
        <div class="settings-grid runtime-settings-grid">
          <section>
            <h3>监听配置</h3>
            <div id="runtimeSettingsPanel">${runtimeSettingsPanelHtml()}</div>
          </section>
          <section>
            <h3>当前访问地址</h3>
            <div class="muted">这些地址来自当前正在运行的 Terma；保存监听配置后，重启程序才会刷新实际地址。</div>
            <div id="runtimeCurrentUrls">${runtimeUrlListHtml()}</div>
            <h3 class="runtime-diagnostics-title">运行诊断</h3>
            <div class="muted">查看进程、数据目录、日志、Web 启动路径和 PTY 依赖状态。</div>
            <div id="runtimeDiagnostics" class="diagnostics-box muted">尚未加载</div>
            <div class="actions"><button type="button" onclick="loadRuntimeDiagnostics()">${icon("refresh-cw")}<span>刷新诊断</span></button></div>
          </section>
        </div>
      </div>
      <div class="settings-group" id="settings-theme">
        <div class="settings-group-head"><h3>主题配置</h3><span>选择界面预设，并分别调整毛玻璃与流光玻璃强度。</span></div>
        <div class="settings-grid single">
          ${themeAppearancePanelHtml()}
        </div>
      </div>
      <div class="settings-group" id="settings-cache">
        <div class="settings-group-head"><h3>缓存管理</h3><span>查看各类程序缓存占用，并按需释放可安全清理的内容。</span></div>
        <div class="settings-grid single">
          ${cacheManagementPanelHtml()}
        </div>
      </div>
      <div class="settings-group" id="settings-about">
        <div class="settings-group-head"><h3>关于 Terma</h3><span>版本、更新、项目地址与开源许可信息。</span></div>
        <div class="settings-grid single">
          <section class="about-section">
            <div class="about-product"><img class="about-mark" src="/assets/terma-icon.png" alt="" aria-hidden="true"><div><h3>${esc(about.product_name || "Terma")}</h3><div class="muted">版本 ${esc(about.version || "未知")}</div></div></div>
            <dl class="about-meta">
              <div><dt>开源许可</dt><dd>${esc(about.license_name || "GNU General Public License v3.0 only")}（${esc(about.license || "GPL-3.0-only")}）</dd></div>
              <div><dt>项目作者</dt><dd>${esc(about.author || "zmide")}</dd></div>
              <div><dt>版权</dt><dd>Copyright (C) 2026 zmide</dd></div>
            </dl>
            ${about.load_error || about.license_error ? `<div class="warning">程序版本与许可信息加载失败：${esc(about.load_error || about.license_error)}</div>` : ""}
            <div id="updateCheckArea">${updateStatusHtml()}</div>
            <div class="muted">本软件按现状提供，不附带任何担保。使用、修改和再分发须遵守 GNU GPL v3.0 条款。</div>
            <div class="actions about-actions"><a class="button-link" href="${escAttr(about.repository_url || "https://github.com/zmide/Terma")}" target="_blank" rel="noopener">${icon("github")}<span>GitHub 源码</span></a><button id="openLicenseBtn" onclick="showLicenseModal()">${icon("scroll-text")}<span>查看开源许可正文</span></button></div>
            <section class="about-third-party" aria-labelledby="aboutThirdPartyTitle">
              <div class="about-third-party-head"><div><h4 id="aboutThirdPartyTitle">随附组件</h4><span>程序内置组件的版本与许可证</span></div><span class="status-pill">${thirdPartyComponents.length} 项</span></div>
              ${thirdPartyRows ? `<div class="about-third-party-list" role="table" aria-label="第三方组件清单"><div class="about-third-party-row about-third-party-head-row" role="row"><span role="columnheader">组件</span><span role="columnheader">版本</span><span role="columnheader">许可证</span></div>${thirdPartyRows}</div>` : `<div class="warning">未找到随程序提供的第三方组件清单。</div>`}
              <div class="muted about-third-party-notice">${about.third_party_notices_available ? "详细组件来源与许可证说明随程序提供于 THIRD_PARTY_NOTICES.md。" : esc(about.third_party_notices_error || "未找到第三方组件声明")}</div>
            </section>
          </section>
        </div>
      </div>
    </div></div>
  </div>`;
  restoreUiState(uiState);
  bindThemeAppearancePanel();
  showSettingsSection(activeSettingsSection, {moveToWorkspace:false});
  syncRuntimeHostOptions();
  syncDesktopCustomDataMode();
  syncUpdateNoticeForCurrentSection();
  refreshIcons();
}
