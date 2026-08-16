function xdmcpServerAction(diagnostics) {
  if (diagnostics.action === "manual" && diagnostics.required_action && diagnostics.required_action !== "manual") {
    const authorized = xdmcpServerAction({...diagnostics, action:diagnostics.required_action, privileged:true});
    return authorized ? {...authorized, label:tr("remote:xdmcp_status.after_temporary_authorization", {action:authorized.label, defaultValue:`临时授权后${authorized.label}`})} : null;
  }
  if (diagnostics.action === "cleanup-sessions") return {action:"cleanup-sessions", label:tr("remote:xdmcp_status.end_conflicting_sessions", {defaultValue:"结束冲突会话"}), icon:"monitor-x", danger:true};
  if (diagnostics.action === "repair-xrdp") return {action:"repair-xrdp", label:tr("remote:xdmcp_status.repair_rdp_session", {defaultValue:"修复 RDP 会话"}), icon:"wrench", danger:true};
  if (diagnostics.action === "install-xfce") return {action:"install-xfce", label:tr("remote:xdmcp_status.install_compatible_desktop", {defaultValue:"安装兼容桌面"}), icon:"package-plus", danger:true};
  if (diagnostics.action === "repair-session") return {action:"repair-session", label:tr("remote:xdmcp_status.repair_default_desktop", {defaultValue:"修复默认桌面"}), icon:"wand-sparkles", danger:true};
  if (diagnostics.listening) return {action:"disable", label:tr("remote:xdmcp_status.close_xdmcp", {defaultValue:"关闭 XDMCP"}), icon:"circle-stop", danger:true};
  if (diagnostics.action === "install-lightdm") return {action:"install-lightdm", label:tr("remote:xdmcp_status.install_switch_lightdm", {defaultValue:"安装并切换 LightDM"}), icon:"package-plus", danger:true};
  if (diagnostics.action === "enable") return {action:"enable", label:tr("remote:xdmcp_status.enable_service", {defaultValue:"启用 XDMCP 服务"}), icon:"power", danger:true};
  if (diagnostics.action === "restart") return {action:"enable", label:tr("remote:xdmcp_status.apply_restart", {defaultValue:"应用并重启"}), icon:"refresh-cw", danger:true};
  return null;
}

function xdmcpInstallPlanForAction(diagnostics, action) {
  const key = action === "install-xfce" ? "xfce" : action === "install-rdp" ? "rdp" : "lightdm";
  return diagnostics?.package_plans?.[key] || (key === "rdp" ? diagnostics?.rdp_install_plan : null) || null;
}

function xdmcpInstallAction(action) {
  return ["install-lightdm", "install-xfce", "install-rdp"].includes(String(action || ""));
}

function openXdmcpInstallOptions(profileId, action) {
  return openXdmcpSetupGuide(profileId, action);
}

function localizedXdmcpManagerLabel(diagnostics={}) {
  const raw = String(diagnostics.manager_label || "").trim();
  return !raw || raw === "未知" ? tr("remote:xdmcp_status.unknown_manager", {defaultValue:"未知"}) : raw;
}

function localizedXdmcpWarning(diagnostics={}) {
  const raw = String(diagnostics.warning || "").trim();
  if (!raw) return "";
  if (diagnostics.platform_unsupported) return tr("remote:xdmcp_status.warning_macos", {defaultValue:"macOS 不提供可由 Terma 配置的 XDMCP 图形登录服务。请使用 VNC 共享桌面，或通过 SSH X11 打开单个图形程序。"});
  if (!diagnostics.privileged && diagnostics.action === "manual") return tr("remote:xdmcp_status.warning_privilege", {defaultValue:"当前 SSH 管理账号没有 root 或免密 sudo 权限。可点击操作按钮输入一次性管理员账号、密码、私钥或 SSH Agent，也可以在终端中手动执行。"});
  if (diagnostics.session_conflict) {
    const localSessions = Array.isArray(diagnostics.matching_local_graphical_sessions) ? diagnostics.matching_local_graphical_sessions : [];
    const remoteSessions = Array.isArray(diagnostics.matching_remote_graphical_sessions) ? diagnostics.matching_remote_graphical_sessions : [];
    const display = diagnostics.plasma_display || "";
    if (localSessions.length) return tr("remote:xdmcp_status.warning_local_conflict", {user:diagnostics.login_user || tr("remote:xdmcp_status.current_management_account", {defaultValue:"当前管理账号"}), display, defaultValue:`账号 ${diagnostics.login_user || "当前管理账号"} 已在本地桌面运行 Plasma（${display}），同账号再次登录 XDMCP 可能只显示壁纸。请先注销本地桌面或改用另一个账号。`});
    return tr("remote:xdmcp_status.warning_remote_conflict", {count:remoteSessions.length, display, defaultValue:`检测到 ${remoteSessions.length} 个同账号远程图形会话，Plasma 仍绑定在 ${display}；可先结束这些会话，再启动新的 XDMCP 桌面。`});
  }
  if (diagnostics.root_plasma_risk) return tr("remote:xdmcp_status.warning_root_plasma", {defaultValue:"当前使用 root 账号启动 Plasma X11，KDE 会话容易因 DBus/KDE 运行时冲突黑屏。建议安装并切换到 XFCE 等轻量 X11 会话，或使用普通桌面账号。"});
  if (!diagnostics.has_x11_session) {
    if (diagnostics.listening) return tr("remote:xdmcp_status.warning_no_desktop_listening", {defaultValue:"XDMCP 已启用且 UDP 177 正在监听，但远端没有可启动的 X11 桌面会话；直接登录通常会得到黑屏。请先安装 XFCE、Plasma X11 或其他 X11 桌面。"});
    if (diagnostics.enabled) return tr("remote:xdmcp_status.warning_no_desktop_enabled", {defaultValue:"XDMCP 配置已经写入，但 UDP 177 尚未监听；同时远端没有可启动的 X11 桌面会话。请先安装桌面，再应用并重启显示管理器。"});
    return tr("remote:xdmcp_status.warning_no_desktop_disabled", {defaultValue:"XDMCP 尚未启用、UDP 177 未监听，并且远端没有可启动的 X11 桌面会话。请先安装桌面，再启用 XDMCP 服务。"});
  }
  if (diagnostics.session_needs_repair) return tr("remote:xdmcp_status.warning_session_repair", {session:diagnostics.saved_session || "default", preferred:diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || "", defaultValue:`管理账号保存的桌面会话 ${diagnostics.saved_session || "default"} 无法启动完整桌面，可由 Terma 自动改为 ${diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || ""}。`});
  const manager = String(diagnostics.manager || "").toLowerCase();
  if (manager === "sddm") return tr("remote:xdmcp_status.warning_sddm", {defaultValue:"当前 SDDM 不提供 XDMCP 服务端；Debian/Ubuntu 可安装并切换 LightDM。"});
  if (manager === "gdm" && !diagnostics.gdm_xdmcp_capable) return tr("remote:xdmcp_status.warning_gdm", {version:diagnostics.manager_version ? ` ${diagnostics.manager_version}` : "", defaultValue:`当前 GDM${diagnostics.manager_version ? ` ${diagnostics.manager_version}` : ""} 不提供可用的 XDMCP 服务端；GDM 50 起已移除该能力，Debian/Ubuntu 可安装并切换 LightDM。`});
  if (manager === "unknown" || manager === "xdm") return tr("remote:xdmcp_status.warning_manager_unsupported", {defaultValue:"当前显示管理器无法由 Terma 自动配置。"});
  if (raw === "XDMCP 不加密，只应在可信局域网使用。" || diagnostics.ready_for_login) return tr("remote:xdmcp_status.security_warning", {defaultValue:"XDMCP 不加密，只应在可信局域网使用。"});
  return raw;
}

function renderXdmcpServerState(diagnostics, profileId=selectedRemoteProfileId, targetContainer=null) {
  const container = targetContainer || $("xdmcpServerState");
  if (!container) return;
  const actionKey = xdmcpServerActionKey(profileId);
  setRemoteComponentTaskHost(container, false);
  if (diagnostics?.error) {
    const profile = remoteProfileById(profileId);
    const management = diagnostics.management_available === false
      ? remoteManagementUnavailableMarkup(profile, diagnostics.error)
      : remoteDiagnosticStatusMarkup(diagnostics.error, {tone:"warning", icon:"server-off", title:tr("remote:diagnostics.ssh_probe_unavailable", {defaultValue:"SSH 深度探测不可用"}), actions:remoteManagementCredentialRepairMarkup(profileId, diagnostics, "xdmcp")});
    container.innerHTML = `${remoteEndpointProbeMarkup(profile, diagnostics.endpoint_probe || {})}${management}`;
    const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
    const clientAvailable = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop")?.dataset.remoteClientAvailable === "1";
    if (launchButton) {
      launchButton.disabled = !clientAvailable;
      launchButton.title = clientAvailable
        ? tr("remote:xdmcp_status.probe_unavailable_launch_anyway", {defaultValue:"SSH 深度探测不可用，仍可直接尝试 XDMCP 图形登录"})
        : tr("remote:auto.xdmcp_client_required", {defaultValue:"请先安装或授权本机 XDMCP 客户端"});
    }
    refreshIcons();
    return;
  }
  container.dataset.adminRequired = diagnostics.privileged ? "0" : "1";
  container.dataset.adminConnectionId = String(diagnostics.ssh_connection?.id || 0);
  const action = xdmcpServerAction(diagnostics);
  const sessionNames = (diagnostics.usable_sessions || diagnostics.sessions || []).map(item => item.name || item.id).filter(Boolean);
  const preferredSession = diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || "";
  const savedSession = diagnostics.resolved_saved_session_label || diagnostics.saved_session || "";
  const ready = diagnostics.listening;
  const canLaunch = Boolean(diagnostics.ready_for_login);
  const healthy = canLaunch;
  const desktopReady = Boolean(diagnostics.has_x11_session);
  const managerLabel = localizedXdmcpManagerLabel(diagnostics);
  const serviceStateLabel = ready
    ? tr("remote:xdmcp_status.enabled_listening", {defaultValue:"XDMCP 已启用 · UDP 177 已监听"})
    : diagnostics.enabled
      ? tr("remote:xdmcp_status.configured_restart_pending", {defaultValue:"XDMCP 已配置 · 等待显示管理器重启"})
      : tr("remote:xdmcp_status.disabled_not_listening", {defaultValue:"XDMCP 未启用 · UDP 177 未监听"});
  const firewallLabel = diagnostics.firewall === "none"
    ? tr("remote:xdmcp_status.no_active_firewall", {defaultValue:"未检测到活动防火墙"})
    : diagnostics.firewall_managed
      ? tr("remote:xdmcp_status.firewall_managed", {firewall:diagnostics.firewall, defaultValue:`${diagnostics.firewall} · Terma 已管理 177/UDP`})
      : tr("remote:xdmcp_status.firewall_auto_open", {firewall:diagnostics.firewall, defaultValue:`${diagnostics.firewall} · 启用时自动开放 177/UDP`});
  const actionHandler = action
    ? xdmcpInstallAction(action.action)
      ? `openXdmcpInstallOptions(${Number(profileId || 0)},'${action.action}')`
      : `configureXdmcpHost(${Number(profileId || 0)},'${action.action}',this)`
    : "";
  const serviceActions = `<div class="remote-service-actions">${action ? `<button class="${action.danger ? "danger" : "primary"}" data-ui-action-key="${escAttr(actionKey)}" onclick="${actionHandler}">${icon(action.icon)}<span>${esc(action.label)}</span></button>` : ""}${diagnostics.can_uninstall_lightdm ? `<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="configureXdmcpHost(${Number(profileId || 0)},'uninstall-lightdm',this)">${icon("package-minus")}<span>${esc(tr("remote:xdmcp_status.uninstall_restore_manager", {defaultValue:"卸载并恢复显示管理器"}))}</span></button>` : ""}</div>`;
  container._xdmcpDiagnostics = diagnostics;
  const pendingServiceCopy = desktopReady && diagnostics.supported && !ready
    ? diagnostics.enabled
      ? tr("remote:xdmcp_status.pending_restart", {manager:managerLabel, defaultValue:`X11 桌面会话和显示管理器 ${managerLabel} 均已就绪；XDMCP 配置已写入，但 UDP 177 尚未监听，请应用并重启显示管理器。`})
      : tr("remote:xdmcp_status.pending_enable", {manager:managerLabel, defaultValue:`X11 桌面会话和显示管理器 ${managerLabel} 均已就绪；当前只需启用 XDMCP 服务，无需重新安装桌面或切换显示管理器。`})
    : "";
  const warning = localizedXdmcpWarning(diagnostics);
  const managementConnection = diagnostics.ssh_connection?.name || tr("remote:diagnostics.ssh_management_connection", {defaultValue:"SSH 管理连接"});
  const configFile = diagnostics.config_file || tr("remote:xdmcp_status.config_not_detected", {defaultValue:"未检测到配置文件"});
  const conflictDisplay = diagnostics.plasma_display || tr("remote:xdmcp_status.other_display", {defaultValue:"其他显示器"});
  container.innerHTML = `<div class="remote-service-head xdmcp-server-head"><span class="remote-service-icon xdmcp-server-icon ${healthy ? "ready" : diagnostics.platform_unsupported ? "error" : diagnostics.supported || diagnostics.replacement_available ? "warning" : "error"}">${icon(healthy ? "circle-check" : diagnostics.platform_unsupported ? "circle-x" : diagnostics.supported || diagnostics.replacement_available ? "circle-alert" : "circle-x")}</span><div><b>${esc(tr("remote:xdmcp_status.display_manager", {manager:managerLabel, defaultValue:`显示管理器：${managerLabel}`}))}</b><small>${esc(serviceStateLabel)} · ${esc(managementConnection)}</small></div></div><div class="remote-service-meta xdmcp-server-meta"><span title="${escAttr(tr("remote:xdmcp_status.config_file", {defaultValue:"配置文件"}))}">${icon("file-cog")} ${esc(configFile)}</span><span title="${escAttr(tr("remote:xdmcp_status.firewall_status", {defaultValue:"防火墙状态"}))}">${icon("shield")} ${esc(firewallLabel)}</span>${preferredSession ? `<span title="${escAttr(tr("remote:xdmcp_status.login_desktop_title", {defaultValue:"XDMCP 登录时将使用的桌面"}))}">${icon("sparkles")} ${esc(tr("remote:xdmcp_status.x11_session_available", {session:preferredSession, defaultValue:`X11 桌面会话：${preferredSession}（可用）`}))}</span>` : ""}${savedSession ? `<span title="${escAttr(tr("remote:xdmcp_status.saved_desktop_title", {defaultValue:"管理账号保存的默认桌面"}))}">${icon("user-round-cog")} ${esc(tr("remote:xdmcp_status.account_desktop_mapping", {session:savedSession, defaultValue:`账号桌面映射：${savedSession}`}))}</span>` : ""}${diagnostics.session_conflict ? `<span title="${escAttr(tr("remote:xdmcp_status.plasma_display_title", {defaultValue:"Plasma 当前显示目标"}))}">${icon("monitor-x")} ${esc(tr("remote:xdmcp_status.bound_display", {display:conflictDisplay, defaultValue:`已绑定 ${conflictDisplay}`}))}</span>` : ""}</div>${sessionNames.length ? `<div class="xdmcp-sessions" aria-label="${escAttr(tr("remote:xdmcp_status.available_x11_desktops", {defaultValue:"可用 X11 桌面"}))}">${sessionNames.map(name => `<span>${icon("monitor")} ${esc(name)}</span>`).join("")}</div>` : `<div class="connection-test-status warning">${esc(tr(diagnostics.platform_unsupported ? "remote:xdmcp_status.macos_no_session" : "remote:xdmcp_status.no_login_session", {defaultValue:diagnostics.platform_unsupported ? "macOS 不提供 XDMCP X11 桌面会话。" : "没有检测到可供 XDMCP 登录的 X11 桌面会话，直接登录可能黑屏。"}))}</div>`}${pendingServiceCopy ? `<div class="connection-test-status">${esc(pendingServiceCopy)}</div>` : ""}${warning ? `<div class="connection-test-status ${healthy ? "" : "warning"}">${esc(warning)}</div>` : ""}${remoteDesktopProtocolGuideMarkup("xdmcp")}${remoteGraphicsRenderingMarkup(diagnostics)}${serviceActions}`;
  if (!diagnostics.has_x11_session && !diagnostics.platform_unsupported) {
     container.insertAdjacentHTML("beforeend", linuxDesktopMissingNotice(remoteProfileById(profileId) || {id:profileId, protocol:"xdmcp"}, diagnostics));
  }
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  if (launchButton) {
    const clientAvailable = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop")?.dataset.remoteClientAvailable === "1";
    launchButton.disabled = !canLaunch || !clientAvailable;
    launchButton.title = !clientAvailable
      ? tr("remote:xdmcp_status.client_required", {defaultValue:"请先安装或启动本机 XDMCP 客户端"})
      : canLaunch
        ? tr("remote:actions.new_graphical_login", {defaultValue:"新建 XDMCP 图形登录"})
        : (warning || tr("remote:xdmcp_status.not_safe_to_start", {defaultValue:"远端 XDMCP 当前不可安全启动"}));
  }
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectXdmcpServer(id, button=null, targetContainer=null) {
  if (button) setButtonBusy(button, true, tr("remote:diagnostics.detecting", {defaultValue:"探测中..."}));
  const container = targetContainer || $("xdmcpServerState");
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>${esc(tr("remote:auto.probe_graphical_login", {defaultValue:"正在探测远端图形登录服务"}))}</span></div>`;
  try {
    const profile = remoteProfileById(id);
    const connectivityPromise = api(`/api/remote-profiles/${Number(id)}/connectivity`).catch(error => remoteEndpointProbeRequestFailure(error, "xdmcp-query"));
    let diagnostics;
    if (!linuxDesktopManagerConnectionIdForProfile(profile)) {
      diagnostics = {
        management_available:false,
        code:"REMOTE_MANAGEMENT_SSH_REQUIRED",
        error:tr("remote:xdmcp_status.ssh_management_optional", {defaultValue:"XDMCP 可以直接尝试图形登录；关联 SSH 后可探测和管理显示管理器、桌面会话与 UDP 177 服务。"})
      };
    } else {
      try {
        diagnostics = await api(`/api/remote-profiles/${id}/xdmcp/server`);
        diagnostics.management_available = true;
      } catch (error) {
        diagnostics = {management_available:true, error:error.message || tr("remote:xdmcp_status.ssh_probe_failed", {defaultValue:"XDMCP SSH 深度探测失败"}), code:error.code || "", connectionId:Number(error.connectionId || linuxDesktopManagerConnectionIdForProfile(profile))};
      }
    }
    diagnostics.endpoint_probe = await connectivityPromise;
    renderXdmcpServerState(diagnostics, id, container);
    return diagnostics;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function xdmcpInstallCommand(diagnostics = {}) {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  if (diagnostics.platform_unsupported) return "";
  const needsXfce = Boolean(diagnostics.needs_desktop_install || diagnostics.root_plasma_risk);
  const needsLightdm = diagnostics.required_action === "install-lightdm"
    || diagnostics.action === "install-lightdm"
    || Boolean(diagnostics.replacement_available && !diagnostics.supported);
  if (!needsXfce && !needsLightdm) return "";
  if (manager === "apt") return needsXfce
    ? "sudo apt-get update && sudo apt-get install -y xfce4 dbus-x11"
    : "sudo apt-get update && sudo apt-get install -y lightdm lightdm-gtk-greeter";
  if (manager === "dnf") return needsXfce
    ? "sudo dnf group install -y \"Xfce\" && sudo dnf install -y dbus-x11"
    : "sudo dnf install -y lightdm lightdm-gtk-greeter";
  if (manager === "pacman") return needsXfce
    ? "sudo pacman -S --noconfirm xfce4 dbus"
    : "sudo pacman -S --noconfirm lightdm lightdm-gtk-greeter";
  return "";
}

function closeXdmcpSetupGuide() {
  const modal = $("modal");
  modal._xdmcpInstallCommand = null;
  closeRemoteInstallDialog();
}

function quoteXdmcpShellText(value="") {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function openXdmcpSetupTerminal(connectionId, command="") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("remote:xdmcp_setup.ssh_management_missing", {defaultValue:"SSH 管理连接不存在"}), "error");
  const text = String(command || $("modal")?._xdmcpInstallCommand || "").trim();
  if (!text) return notify(tr("remote:xdmcp_setup.no_auto_command", {defaultValue:"当前没有可自动执行的安装命令，请按说明手动操作"}), "info");
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  const completionMessage = tr("remote:xdmcp_setup.shell_install_complete", {defaultValue:"XDMCP 依赖安装已结束，请按回车返回 Shell。"});
  const startupCommand = `${text}; printf '\\n\\n%s\\n' ${quoteXdmcpShellText(completionMessage)}; exec "${'${SHELL:-/bin/sh}'}"`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:tr("remote:xdmcp_setup.dependency_install", {defaultValue:"XDMCP 依赖安装"}),
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify(startupCommand)}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeXdmcpSetupGuide();
  openTerminal(connection.id, true, key, tr("remote:xdmcp_setup.terminal_title", {name:connection.name, defaultValue:`${connection.name} · XDMCP 安装`}));
}

async function copyXdmcpSetupCommand() {
  const command = String($("modal")?._xdmcpInstallCommand || "").trim();
  if (!command) return notify(tr("remote:xdmcp_setup.no_copy_command", {defaultValue:"当前没有可复制的安装命令"}), "info");
  try {
    await copyText(command);
    notify(tr("remote:xdmcp_setup.command_copied", {defaultValue:"XDMCP 安装命令已复制"}), "success");
  } catch (error) {
    notify(error.message || tr("remote:xdmcp_setup.copy_failed", {defaultValue:"复制命令失败"}), "error");
  }
}

async function openXdmcpSetupGuide(profileId, requestedAction="") {
  const modal = $("modal");
  const profile = remoteProfileById(profileId);
  if (!linuxDesktopManagerConnectionIdForProfile(profile)) {
    const closeLabel = tr("remote:xdmcp_setup.close", {defaultValue:"关闭"});
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="xdmcpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="xdmcpSetupGuideTitle">${esc(tr("remote:xdmcp_setup.setup_title", {defaultValue:"XDMCP 配置说明"}))}</h2><span class="muted">${esc(profile?.name || "XDMCP")} · ${esc(remoteProfileEndpoint(profile || {}))}</span></div><button class="icon-button" type="button" onclick="closeXdmcpSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      ${remoteDiagnosticStatusMarkup(tr("remote:xdmcp_setup.standalone_detail", {defaultValue:"目标 Linux 主机需要启用支持 XDMCP 的显示管理器并开放 UDP 177。XDMCP 不加密，只应在可信局域网使用；Terma 可以在没有 SSH 的情况下直接尝试图形登录。"}), {tone:"warning", icon:"panels-top-left", title:tr("remote:xdmcp_setup.standalone_title", {defaultValue:"独立 XDMCP 服务"})})}
      ${remoteManagementUnavailableMarkup(profile, tr("remote:xdmcp_setup.management_link_hint", {defaultValue:"关联 SSH 后，Terma 才能识别显示管理器和桌面会话，并提供安装、启用、修复与防火墙配置。"}))}
      ${remoteDesktopProtocolGuideMarkup("xdmcp", {}, profile)}
      <div class="actions"><button type="button" onclick="closeXdmcpSetupGuide()">${esc(closeLabel)}</button></div>
    </div>`;
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    return null;
  }
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/xdmcp/server`);
    const connectionId = Number(diagnostics.ssh_connection?.id || 0);
    const manager = localizedXdmcpManagerLabel(diagnostics) || tr("remote:xdmcp_setup.unknown_display_manager", {defaultValue:"未知显示管理器"});
    const isMac = String(diagnostics.os_id || diagnostics.os_like || "").toLowerCase().includes("mac");
    const needsDesktopInstall = Boolean(diagnostics.needs_desktop_install || diagnostics.root_plasma_risk);
    const needsManagerInstall = diagnostics.required_action === "install-lightdm"
      || diagnostics.action === "install-lightdm"
      || Boolean(diagnostics.replacement_available && !diagnostics.supported);
    const installAction = xdmcpInstallAction(requestedAction)
      ? requestedAction
      : needsDesktopInstall
        ? "install-xfce"
        : needsManagerInstall
          ? "install-lightdm"
          : "";
    const actionKey = xdmcpServerActionKey(profileId);
    const installPlan = installAction ? xdmcpInstallPlanForAction(diagnostics, installAction) : null;
    const command = installPlan ? remoteInstallPlanMode(installPlan, "online").command : xdmcpInstallCommand(diagnostics);
    const desktopLabel = diagnostics.preferred_session?.name || diagnostics.preferred_session?.id
      || diagnostics.resolved_saved_session_label || tr("remote:xdmcp_setup.detected_x11_desktop", {defaultValue:"已检测到的 X11 桌面"});
    const steps = isMac
      ? [tr("remote:xdmcp_setup.step_macos_no_manager", {defaultValue:"macOS 远端不提供可由 Terma 自动启用的 XDMCP 显示管理器。请在 Linux 服务器上使用 XDMCP，macOS 服务器建议使用 VNC。"}), tr("remote:xdmcp_setup.step_macos_xquartz", {defaultValue:"如果只是运行 X11 应用，请在本机安装并启动 XQuartz，然后使用 SSH X11 转发。"})]
      : needsDesktopInstall
        ? [tr("remote:xdmcp_setup.step_desktop_required", {defaultValue:"XDMCP 只负责把登录画面传到本机，远端还必须安装可运行的 X11 桌面会话。"}), tr("remote:xdmcp_setup.step_root_plasma", {defaultValue:"当前账号是 root 且使用 Plasma，KDE/DBus 运行时容易黑屏；建议安装并切换到 XFCE。"}), tr("remote:xdmcp_setup.step_redetect_launch", {defaultValue:"安装完成后返回本页面点击“重新探测”，再启动图形登录。"}), tr("remote:xdmcp_setup.step_udp_firewall", {defaultValue:"XDMCP 使用 UDP 177，建议只在可信局域网开放，并在防火墙中放行 177/UDP。"})]
        : needsManagerInstall
          ? [tr("remote:xdmcp_setup.step_manager_missing", {defaultValue:"当前桌面会话可用，但现有显示管理器不提供可用的 XDMCP 服务端。"}), tr("remote:xdmcp_setup.step_switch_lightdm", {defaultValue:"Debian/Ubuntu 可由 Terma 安装并切换到 LightDM；该操作会结束当前图形登录，请先保存工作。"}), tr("remote:xdmcp_setup.step_redetect_after_switch", {defaultValue:"切换完成后重新探测，再启动图形登录。"}), tr("remote:xdmcp_setup.step_trusted_lan", {defaultValue:"XDMCP 使用 UDP 177，只应在可信局域网开放。"})]
          : diagnostics.listening
            ? [tr("remote:xdmcp_setup.step_ready", {manager, desktop:desktopLabel, defaultValue:`${manager} 和 ${desktopLabel} 已就绪，远端正在监听 UDP 177。`}), tr("remote:xdmcp_setup.step_ready_launch", {defaultValue:"可直接关闭此说明并新建图形登录；不需要重复安装 LightDM 或桌面环境。"}), tr("remote:xdmcp_status.security_warning", {defaultValue:"XDMCP 不加密，只应在可信局域网使用。"})]
            : diagnostics.supported && diagnostics.has_x11_session
              ? [tr("remote:xdmcp_setup.step_components_ready", {manager, desktop:desktopLabel, defaultValue:`已检测到 ${manager} 和 ${desktopLabel}，桌面组件已经可用。`}), tr("remote:xdmcp_setup.step_enable_only", {defaultValue:"当前缺少的是 XDMCP 服务开关：返回连接页面点击“启用 XDMCP 服务”，无需重新安装 LightDM 或桌面环境。"}), tr("remote:xdmcp_setup.step_firewall_behavior", {defaultValue:"启用时 Terma 只会在检测到活动防火墙时开放 UDP 177；未启用防火墙不会添加多余规则。"}), tr("remote:xdmcp_status.security_warning", {defaultValue:"XDMCP 不加密，只应在可信局域网使用。"})]
              : [tr("remote:xdmcp_setup.step_confirm_manager", {defaultValue:"确认远端显示管理器已安装并拥有 X11 桌面会话。"}), tr("remote:xdmcp_setup.step_install_or_enable", {defaultValue:"缺少组件时可安装桌面或切换显示管理器；组件齐全时只需启用 XDMCP 服务。"}), tr("remote:xdmcp_setup.step_redetect", {defaultValue:"操作完成后返回本页面点击“重新探测”。"}), tr("remote:xdmcp_setup.step_trusted_lan", {defaultValue:"XDMCP 使用 UDP 177，只应在可信局域网开放。"})];
    const firewall = diagnostics.firewall === "ufw-active"
      ? "sudo ufw allow 177/udp"
      : diagnostics.firewall === "firewalld-active"
        ? "sudo firewall-cmd --permanent --add-port=177/udp && sudo firewall-cmd --reload"
        : "";
    const installTarget = installAction === "install-xfce" ? tr("remote:xdmcp_setup.compatible_desktop", {defaultValue:"兼容桌面"}) : installAction === "install-rdp" ? tr("remote:xdmcp_setup.rdp_service", {defaultValue:"RDP 服务"}) : "LightDM";
    const guideTitle = installAction ? tr("remote:xdmcp_setup.install_methods_title", {target:installTarget, defaultValue:`${installTarget}安装方式`}) : command ? tr("remote:xdmcp_setup.install_setup_title", {defaultValue:"XDMCP 安装/配置说明"}) : tr("remote:xdmcp_setup.setup_title", {defaultValue:"XDMCP 配置说明"});
    const manualCommands = [command, firewall].filter(Boolean);
    const setupStateSummary = diagnostics.listening
      ? tr("remote:xdmcp_setup.enabled_listening", {defaultValue:"XDMCP 已启用，远端正在监听 UDP 177。"})
      : diagnostics.enabled
        ? tr("remote:xdmcp_setup.configured_not_listening", {defaultValue:"XDMCP 配置已经写入，但 UDP 177 尚未监听；需要应用配置并重启显示管理器。"})
        : diagnostics.supported
          ? tr("remote:xdmcp_setup.manager_ready_disabled", {manager, defaultValue:`${manager} 已安装并可配置，但 XDMCP 尚未启用，UDP 177 未监听。`})
          : localizedXdmcpWarning(diagnostics) || tr("remote:xdmcp_setup.service_not_detected", {defaultValue:"当前尚未检测到可用的 XDMCP/UDP 177 服务。"});
    const closeLabel = tr("remote:xdmcp_setup.close", {defaultValue:"关闭"});
    const warning = localizedXdmcpWarning(diagnostics);
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="xdmcpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="xdmcpSetupGuideTitle">${esc(guideTitle)}</h2><span class="muted">${esc(manager)} · ${esc(diagnostics.ssh_connection?.name || tr("remote:diagnostics.ssh_management_connection", {defaultValue:"SSH 管理连接"}))}</span></div><button class="icon-button" type="button" onclick="closeXdmcpSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      <div class="connection-test-status ${diagnostics.listening ? "success" : "warning"}">${esc(setupStateSummary)}</div>
      ${remoteDesktopProtocolGuideMarkup("xdmcp")}
      ${warning && warning !== setupStateSummary ? `<div class="connection-test-status warning">${esc(warning)}</div>` : ""}
      ${installPlan ? remoteInstallModesMarkup(installPlan, mode => `configureXdmcpHost(${Number(profileId)},'${installAction}',this,'${mode}')`, "revealRemoteInstallManual(this)", actionKey) : ""}
      ${remoteInstallManualMarkup(installPlan || {}, {steps, commands:manualCommands, note:tr("remote:xdmcp_setup.admin_install_note", {defaultValue:"临时管理员授权只用于本次操作。安装或切换显示管理器可能结束当前图形会话；启用 XDMCP 时只有检测到活动防火墙才会添加 UDP 177 规则。"})})}
      <div class="actions"><button type="button" onclick="closeXdmcpSetupGuide()">${esc(closeLabel)}</button>${command && connectionId ? `<button type="button" onclick="openXdmcpSetupTerminal(${connectionId})">${icon("square-terminal")}<span>${esc(tr("remote:xdmcp_setup.run_reference_terminal", {defaultValue:"在终端执行参考命令"}))}</span></button>` : ""}</div>
    </div>`;
    modal._xdmcpInstallCommand = command;
    setRemoteInstallDialogCommands(installPlan || {}, manualCommands);
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || tr("remote:xdmcp_setup.guide_read_failed", {defaultValue:"XDMCP 安装说明读取失败"}), "error");
    if (typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)) {
      return repairRemoteManagementCredentials(profileId, "xdmcp");
    }
    return null;
  }
}

function beginXdmcpInstallProgress(action) {
  if (xdmcpProgressTimer) clearInterval(xdmcpProgressTimer);
  const container = $("xdmcpServerState");
  if (!container) return () => {};
  const stages = action === "install-xfce"
    ? [tr("remote:xdmcp_setup.progress_prepare_desktop", {defaultValue:"准备安装兼容桌面"}), tr("remote:xdmcp_setup.progress_refresh_packages", {defaultValue:"刷新软件包索引"}), tr("remote:xdmcp_setup.progress_install_xfce", {defaultValue:"安装 XFCE 和 dbus-x11"}), tr("remote:xdmcp_setup.progress_configure_sessions", {defaultValue:"配置 LightDM 与 xrdp 会话"}), tr("remote:xdmcp_setup.progress_restart_detect", {defaultValue:"重启服务并重新探测"})]
    : action === "repair-xrdp"
      ? [tr("remote:xdmcp_setup.progress_check_xrdp", {defaultValue:"检查 xrdp 会话配置"}), tr("remote:xdmcp_setup.progress_backup_startwm", {defaultValue:"备份现有 startwm.sh"}), tr("remote:xdmcp_setup.progress_clean_dbus", {defaultValue:"清理旧 D-Bus 环境"}), tr("remote:xdmcp_setup.progress_switch_xfce", {defaultValue:"切换到独立 XFCE 会话"}), tr("remote:xdmcp_setup.progress_restart_xrdp", {defaultValue:"重启 xrdp 并重新探测"})]
    : [tr("remote:xdmcp_setup.progress_prepare_manager", {defaultValue:"准备切换显示管理器"}), tr("remote:xdmcp_setup.progress_install_lightdm", {defaultValue:"安装 LightDM 组件"}), tr("remote:xdmcp_setup.progress_write_config", {defaultValue:"写入 XDMCP 配置"}), tr("remote:xdmcp_setup.progress_restart_login", {defaultValue:"重启图形登录服务"}), tr("remote:xdmcp_setup.progress_redetect", {defaultValue:"重新探测远端状态"})];
  let stage = 0;
  const title = action === "install-xfce" ? tr("remote:xdmcp_setup.installing_desktop", {defaultValue:"正在安装兼容桌面"}) : action === "repair-xrdp" ? tr("remote:xdmcp_setup.repairing_rdp", {defaultValue:"正在修复 RDP 会话"}) : tr("remote:xdmcp_setup.installing_lightdm", {defaultValue:"正在安装并配置 LightDM"});
  container.innerHTML = `<div class="xdmcp-install-progress" role="status" aria-live="polite"><div class="xdmcp-install-progress-head"><span class="xdmcp-server-icon warning">${icon("loader-circle")}</span><div><b>${esc(title)}</b><small id="xdmcpProgressStage">${esc(stages[0])}</small></div></div><div class="xdmcp-progress-track" aria-hidden="true"><span class="xdmcp-progress-bar"></span></div><div class="muted">${esc(tr("remote:xdmcp_setup.progress_wait_notice", {defaultValue:"操作可能需要几分钟，请不要关闭 Terma 或远端终端。"}))}</div></div>`;
  refreshIcons();
  const update = () => {
    stage = Math.min(stage + 1, stages.length - 1);
    const target = $("xdmcpProgressStage");
    if (target) target.textContent = stages[stage];
  };
  xdmcpProgressTimer = setInterval(update, 1800);
  return () => {
    if (xdmcpProgressTimer) clearInterval(xdmcpProgressTimer);
    xdmcpProgressTimer = null;
  };
}

async function configureXdmcpHost(id, action, button=null, installMode="online") {
  const actionKey = xdmcpServerActionKey(id);
  const busyLabel = action === "disable" ? tr("remote:xdmcp_setup.closing", {defaultValue:"关闭中..."}) : action === "uninstall-lightdm" ? tr("remote:xdmcp_setup.uninstalling", {defaultValue:"卸载中..."}) : action.startsWith("install-") ? tr("remote:xdmcp_setup.installing", {defaultValue:"安装中..."}) : tr("remote:xdmcp_setup.processing", {defaultValue:"处理中..."});
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify(tr("remote:xdmcp_setup.task_running", {defaultValue:"XDMCP 服务任务正在执行，请等待完成"}), "info");
    return null;
  }
  try {
    return await configureXdmcpHostImpl(id, action, button, installMode);
  } finally {
    endUiAction(actionKey, button);
  }
}

async function configureXdmcpHostImpl(id, action, button=null, installMode="online") {
  const install = action === "install-lightdm";
  const installDesktop = action === "install-xfce";
  const installRdp = action === "install-rdp";
  const uninstallLightdm = action === "uninstall-lightdm";
  const packageInstall = install || installDesktop || installRdp;
  const normalizedMode = ["online", "offline", "local-offline"].includes(installMode) ? installMode : "online";
  const modeLabel = normalizedMode === "local-offline"
    ? tr("remote:vnc_ui.mode_local_offline", {defaultValue:"本机下载后离线"})
    : normalizedMode === "offline"
      ? tr("remote:vnc_ui.mode_remote_cache", {defaultValue:"使用远端缓存"})
      : tr("remote:vnc_ui.mode_online", {defaultValue:"在线"});
  const requestAction = packageInstall && normalizedMode === "local-offline"
    ? `${action}-local-offline`
    : packageInstall && normalizedMode === "offline"
      ? `${action}-offline`
      : action;
  const disable = action === "disable";
  const repairSession = action === "repair-session";
  const cleanupSessions = action === "cleanup-sessions";
  const localOfflineSuffix = normalizedMode === "local-offline" ? tr("remote:xdmcp_setup.local_offline_suffix", {defaultValue:"（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）"}) : "";
  const message = cleanupSessions
    ? tr("remote:xdmcp_setup.confirm_cleanup_sessions", {defaultValue:"检测到同一个 Linux 账号已有 XRDP/XDMCP 图形会话，Plasma 仍绑定在旧显示器上。将只结束没有本地 seat 的远程图形会话，不会关闭 seat0 本地桌面。未保存的远程桌面内容会丢失。"})
    : repairSession
    ? tr("remote:xdmcp_setup.confirm_repair_session", {defaultValue:"将把当前 SSH 管理账号保存的无效/通用桌面会话改为自动探测到的 X11 桌面，并重启 LightDM。当前本地图形会话会结束。"})
    : uninstallLightdm
    ? tr("remote:xdmcp_setup.confirm_uninstall_lightdm", {defaultValue:"将停止 XDMCP、卸载由 Terma 安装的 LightDM，并尝试恢复切换前的显示管理器。当前图形会话会结束；只有检测到可恢复备份时才会自动执行。"})
    : install
    ? tr("remote:xdmcp_setup.confirm_install_lightdm", {mode:modeLabel, suffix:localOfflineSuffix, defaultValue:`${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 LightDM，并在安装完成后切换显示管理器。当前本地图形会话可能结束，未保存内容可能丢失；XDMCP 只能用于可信局域网。`})
    : installDesktop
    ? tr("remote:xdmcp_setup.confirm_install_xfce", {mode:modeLabel, suffix:localOfflineSuffix, defaultValue:`${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 XFCE 和 dbus-x11。安装完成后请重新探测，再把 LightDM 与 xrdp 会话切换到 XFCE。`})
    : installRdp
    ? tr("remote:xdmcp_setup.confirm_install_rdp", {mode:modeLabel, suffix:localOfflineSuffix, defaultValue:`${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 xrdp 和对应的 Xorg 后端。安装完成后请重新探测并检查 RDP 桌面会话。`})
    : action === "repair-xrdp"
    ? tr("remote:xdmcp_setup.confirm_repair_xrdp", {defaultValue:"将备份并修改远端 xrdp 的启动脚本，清理旧 D-Bus 环境后使用独立 XFCE 会话。现有 RDP 会话会被重启。"})
    : disable
      ? tr("remote:xdmcp_setup.confirm_disable", {defaultValue:"将关闭 XDMCP 并重启图形登录服务，当前本地图形会话可能结束。"})
      : tr("remote:xdmcp_setup.confirm_enable", {defaultValue:"将备份显示管理器配置、启用 XDMCP 并立即重启图形登录服务。当前本地图形会话会结束，未保存内容可能丢失。"});
  const packageAction = install ? tr("remote:xdmcp_setup.install_lightdm", {defaultValue:"安装 LightDM"}) : installDesktop ? tr("remote:xdmcp_setup.install_desktop", {defaultValue:"安装兼容桌面"}) : tr("remote:xdmcp_setup.install_rdp", {defaultValue:"安装 RDP 服务"});
  const dialogTitle = cleanupSessions ? tr("remote:xdmcp_setup.end_conflicts", {defaultValue:"结束冲突会话"}) : uninstallLightdm ? tr("remote:xdmcp_status.uninstall_restore_manager", {defaultValue:"卸载并恢复显示管理器"}) : disable ? tr("remote:xdmcp_status.close_xdmcp", {defaultValue:"关闭 XDMCP"}) : repairSession ? tr("remote:xdmcp_status.repair_default_desktop", {defaultValue:"修复默认桌面"}) : packageInstall ? tr("remote:xdmcp_setup.mode_install_action", {mode:modeLabel, action:packageAction, defaultValue:`${modeLabel}${packageAction}`}) : action === "repair-xrdp" ? tr("remote:xdmcp_status.repair_rdp_session", {defaultValue:"修复 RDP 会话"}) : tr("remote:xdmcp_setup.enable_xdmcp", {defaultValue:"启用 XDMCP"});
  const confirmLabel = cleanupSessions ? tr("remote:xdmcp_setup.end_continue", {defaultValue:"结束并继续"}) : uninstallLightdm ? tr("remote:xdmcp_setup.uninstall_restore", {defaultValue:"卸载并恢复"}) : disable ? tr("remote:xdmcp_setup.close_restart", {defaultValue:"关闭并重启"}) : repairSession || action === "repair-xrdp" ? tr("remote:xdmcp_setup.repair_restart", {defaultValue:"修复并重启"}) : packageInstall ? tr("remote:xdmcp_setup.install", {defaultValue:"安装"}) : tr("remote:xdmcp_setup.enable_restart", {defaultValue:"启用并重启"});
  if (!await confirmModal(message, dialogTitle, confirmLabel, tr("remote:xdmcp_setup.cancel", {defaultValue:"取消"}), true)) return null;
  let adminAuth = null;
  const serverState = $("xdmcpServerState");
  if (serverState?.dataset.adminRequired === "1") {
    const authorizationScope = packageInstall
      ? tr("remote:xdmcp_setup.install_components_action", {mode:modeLabel, defaultValue:`${modeLabel}安装 XDMCP 组件`})
      : uninstallLightdm ? tr("remote:xdmcp_status.uninstall_restore_manager", {defaultValue:"卸载并恢复显示管理器"})
        : action === "repair-xrdp" ? tr("remote:xdmcp_status.repair_rdp_session", {defaultValue:"修复 RDP 会话"})
          : tr("remote:xdmcp_setup.configure_xdmcp", {defaultValue:"配置 XDMCP"});
    adminAuth = await requestRemoteAdminAuthorization(Number(serverState.dataset.adminConnectionId || 0), authorizationScope);
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, cleanupSessions ? tr("remote:xdmcp_setup.cleaning", {defaultValue:"清理中..."}) : uninstallLightdm ? tr("remote:xdmcp_setup.uninstalling", {defaultValue:"卸载中..."}) : packageInstall ? tr("remote:xdmcp_setup.installing", {defaultValue:"安装中..."}) : action === "repair-xrdp" || repairSession ? tr("remote:xdmcp_setup.repairing", {defaultValue:"修复中..."}) : tr("remote:xdmcp_setup.configuring", {defaultValue:"配置中..."}));
  const stopProgress = (["install-xfce", "install-lightdm", "repair-xrdp"].includes(action) && normalizedMode !== "local-offline") ? beginXdmcpInstallProgress(action) : () => {};
  try {
    const result = await api(`/api/remote-profiles/${id}/xdmcp/server`, {method:"POST", body:JSON.stringify({action:requestAction, restart:!cleanupSessions, confirmation:cleanupSessions ? "XDMCP_END_REMOTE_SESSIONS" : "XDMCP_TRUSTED_LAN", ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const taskContainer = $("xdmcpServerState");
      const taskKey = `remote-desktop-${Number(id)}`;
      const taskScope = captureRemoteComponentTaskScope(id, taskKey, taskContainer);
      closeXdmcpSetupGuide();
      stopProgress();
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:taskContainer,
        scope:taskScope,
        title:uninstallLightdm ? tr("remote:xdmcp_status.uninstall_restore_manager", {defaultValue:"卸载并恢复显示管理器"}) : packageInstall ? tr("remote:xdmcp_setup.install_components_action", {mode:modeLabel, defaultValue:`${modeLabel}安装 XDMCP 组件`}) : disable ? tr("remote:xdmcp_status.close_xdmcp", {defaultValue:"关闭 XDMCP"}) : tr("remote:xdmcp_setup.configure_xdmcp", {defaultValue:"配置 XDMCP"}),
        onDone:(_, activeContainer) => activeContainer ? inspectXdmcpServer(id, null, activeContainer).catch(() => {}) : null
      });
      const requestedLabel = uninstallLightdm ? tr("remote:xdmcp_status.uninstall_restore_manager", {defaultValue:"卸载并恢复显示管理器"}) : packageInstall ? tr("remote:xdmcp_setup.install_components_action", {mode:modeLabel, defaultValue:`${modeLabel}安装 XDMCP 组件`}) : disable ? tr("remote:xdmcp_status.close_xdmcp", {defaultValue:"关闭 XDMCP"}) : tr("remote:xdmcp_setup.configure_xdmcp", {defaultValue:"配置 XDMCP"});
      const taskLabel = remoteTaskActionLabel(result.task) || remoteTaskComponentLabel(result.task) || tr("remote:xdmcp_setup.operation", {defaultValue:"XDMCP 操作"});
      const requestAccepted = notifyRemoteComponentTaskRequest(result, requestedLabel, tr("remote:tasks.added_to_center", {action:taskLabel, defaultValue:`${taskLabel}已加入任务中心`}));
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    if (result.after || result.before) renderXdmcpServerState(result.after || result.before);
    notify(cleanupSessions ? tr("remote:xdmcp_setup.conflicts_ended", {defaultValue:"冲突的远程图形会话已结束"}) : disable ? tr("remote:xdmcp_setup.closed", {defaultValue:"XDMCP 已关闭"}) : packageInstall ? tr("remote:xdmcp_setup.install_complete_redetected", {mode:modeLabel, defaultValue:`${modeLabel}安装完成，已重新探测`}) : tr("remote:xdmcp_setup.configured_redetected", {defaultValue:"XDMCP 已配置并重新探测"}), "success");
    return result;
  } catch (error) {
    const container = $("xdmcpServerState");
    if (container) {
      container.innerHTML = `<div class="connection-test-status error">${esc(error.message || tr("remote:xdmcp_setup.configure_failed", {defaultValue:"XDMCP 配置失败"}))}</div>`;
      refreshIcons();
    }
    notify(error.message || tr("remote:xdmcp_setup.configure_failed", {defaultValue:"XDMCP 配置失败"}), "error");
    return null;
  } finally {
    stopProgress();
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}
