function xdmcpServerAction(diagnostics) {
  if (diagnostics.action === "manual" && diagnostics.required_action && diagnostics.required_action !== "manual") {
    const authorized = xdmcpServerAction({...diagnostics, action:diagnostics.required_action, privileged:true});
    return authorized ? {...authorized, label:`临时授权后${authorized.label}`} : null;
  }
  if (diagnostics.action === "cleanup-sessions") return {action:"cleanup-sessions", label:"结束冲突会话", icon:"monitor-x", danger:true};
  if (diagnostics.action === "repair-xrdp") return {action:"repair-xrdp", label:"修复 RDP 会话", icon:"wrench", danger:true};
  if (diagnostics.action === "install-xfce") return {action:"install-xfce", label:"安装兼容桌面", icon:"package-plus", danger:true};
  if (diagnostics.action === "repair-session") return {action:"repair-session", label:"修复默认桌面", icon:"wand-sparkles", danger:true};
  if (diagnostics.listening) return {action:"disable", label:"关闭 XDMCP", icon:"circle-stop", danger:true};
  if (diagnostics.action === "install-lightdm") return {action:"install-lightdm", label:"安装并切换 LightDM", icon:"package-plus", danger:true};
  if (diagnostics.action === "enable") return {action:"enable", label:"启用 XDMCP 服务", icon:"power", danger:true};
  if (diagnostics.action === "restart") return {action:"enable", label:"应用并重启", icon:"refresh-cw", danger:true};
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

function renderXdmcpServerState(diagnostics, profileId=selectedRemoteProfileId, targetContainer=null) {
  const container = targetContainer || $("xdmcpServerState");
  if (!container) return;
  const actionKey = xdmcpServerActionKey(profileId);
  setRemoteComponentTaskHost(container, false);
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
  const serviceStateLabel = ready
    ? "XDMCP 已启用 · UDP 177 已监听"
    : diagnostics.enabled
      ? "XDMCP 已配置 · 等待显示管理器重启"
      : "XDMCP 未启用 · UDP 177 未监听";
  const firewallLabel = diagnostics.firewall === "none"
    ? "未检测到活动防火墙"
    : diagnostics.firewall_managed
      ? `${diagnostics.firewall} · Terma 已管理 177/UDP`
      : `${diagnostics.firewall} · 启用时自动开放 177/UDP`;
  const actionHandler = action
    ? xdmcpInstallAction(action.action)
      ? `openXdmcpInstallOptions(${Number(profileId || 0)},'${action.action}')`
      : `configureXdmcpHost(${Number(profileId || 0)},'${action.action}',this)`
    : "";
  const serviceActions = `<div class="remote-service-actions">${action ? `<button class="${action.danger ? "danger" : "primary"}" data-ui-action-key="${escAttr(actionKey)}" onclick="${actionHandler}">${icon(action.icon)}<span>${esc(action.label)}</span></button>` : ""}${diagnostics.can_uninstall_lightdm ? `<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="configureXdmcpHost(${Number(profileId || 0)},'uninstall-lightdm',this)">${icon("package-minus")}<span>卸载并恢复显示管理器</span></button>` : ""}</div>`;
  container._xdmcpDiagnostics = diagnostics;
  const pendingServiceCopy = desktopReady && diagnostics.supported && !ready
    ? diagnostics.enabled
      ? `X11 桌面会话和显示管理器 ${diagnostics.manager_label} 均已就绪；XDMCP 配置已写入，但 UDP 177 尚未监听，请应用并重启显示管理器。`
      : `X11 桌面会话和显示管理器 ${diagnostics.manager_label} 均已就绪；当前只需启用 XDMCP 服务，无需重新安装桌面或切换显示管理器。`
    : "";
  container.innerHTML = `<div class="remote-service-head xdmcp-server-head"><span class="remote-service-icon xdmcp-server-icon ${healthy ? "ready" : diagnostics.platform_unsupported ? "error" : diagnostics.supported || diagnostics.replacement_available ? "warning" : "error"}">${icon(healthy ? "circle-check" : diagnostics.platform_unsupported ? "circle-x" : diagnostics.supported || diagnostics.replacement_available ? "circle-alert" : "circle-x")}</span><div><b>显示管理器：${esc(diagnostics.manager_label)}</b><small>${esc(serviceStateLabel)} · ${esc(diagnostics.ssh_connection?.name || "SSH 管理连接")}</small></div></div><div class="remote-service-meta xdmcp-server-meta"><span title="配置文件">${icon("file-cog")} ${esc(diagnostics.config_file || "未检测到配置文件")}</span><span title="防火墙状态">${icon("shield")} ${esc(firewallLabel)}</span>${preferredSession ? `<span title="XDMCP 登录时将使用的桌面">${icon("sparkles")} X11 桌面会话：${esc(preferredSession)}（可用）</span>` : ""}${savedSession ? `<span title="管理账号保存的默认桌面">${icon("user-round-cog")} 账号桌面映射：${esc(savedSession)}</span>` : ""}${diagnostics.session_conflict ? `<span title="Plasma 当前显示目标">${icon("monitor-x")} 已绑定 ${esc(diagnostics.plasma_display || "其他显示器")}</span>` : ""}</div>${sessionNames.length ? `<div class="xdmcp-sessions" aria-label="可用 X11 桌面">${sessionNames.map(name => `<span>${icon("monitor")} ${esc(name)}</span>`).join("")}</div>` : `<div class="connection-test-status warning">${esc(diagnostics.platform_unsupported ? "macOS 不提供 XDMCP X11 桌面会话。" : "没有检测到可供 XDMCP 登录的 X11 桌面会话，直接登录可能黑屏。")}</div>`}${pendingServiceCopy ? `<div class="connection-test-status">${esc(pendingServiceCopy)}</div>` : ""}${diagnostics.warning ? `<div class="connection-test-status ${healthy ? "" : "warning"}">${esc(diagnostics.warning)}</div>` : ""}${remoteDesktopProtocolGuideMarkup("xdmcp")}${remoteGraphicsRenderingMarkup(diagnostics)}${serviceActions}`;
  if (!diagnostics.has_x11_session && !diagnostics.platform_unsupported) {
     container.insertAdjacentHTML("beforeend", linuxDesktopMissingNotice(remoteProfileById(profileId) || {id:profileId, protocol:"xdmcp"}, diagnostics));
  }
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  if (launchButton) {
    const clientAvailable = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop")?.dataset.remoteClientAvailable === "1";
    launchButton.disabled = !canLaunch || !clientAvailable;
    launchButton.title = !clientAvailable ? "请先安装或启动本机 XDMCP 客户端" : canLaunch ? "新建 XDMCP 图形登录" : (diagnostics.warning || "远端 XDMCP 当前不可安全启动");
  }
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectXdmcpServer(id, button=null, targetContainer=null) {
  if (button) setButtonBusy(button, true, "探测中...");
  const container = targetContainer || $("xdmcpServerState");
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端图形登录服务</span></div>`;
  try {
    const diagnostics = await api(`/api/remote-profiles/${id}/xdmcp/server`);
    renderXdmcpServerState(diagnostics, id, container);
    return diagnostics;
  } catch (error) {
    if (container) container.innerHTML = `<div class="connection-test-status error">${esc(error.message || "XDMCP 服务器探测失败")}</div>`;
    throw error;
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

function openXdmcpSetupTerminal(connectionId, command="") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 管理连接不存在", "error");
  const text = String(command || $("modal")?._xdmcpInstallCommand || "").trim();
  if (!text) return notify("当前没有可自动执行的安装命令，请按说明手动操作", "info");
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  const startupCommand = `${text}; printf '\\n\\nXDMCP 依赖安装已结束，请按回车返回 Shell。\\n'; exec "${'${SHELL:-/bin/sh}'}"`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:"XDMCP 依赖安装",
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify(startupCommand)}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeXdmcpSetupGuide();
  openTerminal(connection.id, true, key, `${connection.name} · XDMCP 安装`);
}

async function copyXdmcpSetupCommand() {
  const command = String($("modal")?._xdmcpInstallCommand || "").trim();
  if (!command) return notify("当前没有可复制的安装命令", "info");
  try {
    await copyText(command);
    notify("XDMCP 安装命令已复制", "success");
  } catch (error) {
    notify(error.message || "复制命令失败", "error");
  }
}

async function openXdmcpSetupGuide(profileId, requestedAction="") {
  const modal = $("modal");
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/xdmcp/server`);
    const connectionId = Number(diagnostics.ssh_connection?.id || 0);
    const manager = diagnostics.manager_label || diagnostics.manager || "未知显示管理器";
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
      || diagnostics.resolved_saved_session_label || "已检测到的 X11 桌面";
    const steps = isMac
      ? ["macOS 远端不提供可由 Terma 自动启用的 XDMCP 显示管理器。请在 Linux 服务器上使用 XDMCP，macOS 服务器建议使用 VNC。", "如果只是运行 X11 应用，请在本机安装并启动 XQuartz，然后使用 SSH X11 转发。"]
      : needsDesktopInstall
        ? ["XDMCP 只负责把登录画面传到本机，远端还必须安装可运行的 X11 桌面会话。", "当前账号是 root 且使用 Plasma，KDE/DBus 运行时容易黑屏；建议安装并切换到 XFCE。", "安装完成后返回本页面点击“重新探测”，再启动图形登录。", "XDMCP 使用 UDP 177，建议只在可信局域网开放，并在防火墙中放行 177/UDP。"]
        : needsManagerInstall
          ? ["当前桌面会话可用，但现有显示管理器不提供可用的 XDMCP 服务端。", "Debian/Ubuntu 可由 Terma 安装并切换到 LightDM；该操作会结束当前图形登录，请先保存工作。", "切换完成后重新探测，再启动图形登录。", "XDMCP 使用 UDP 177，只应在可信局域网开放。"]
          : diagnostics.listening
            ? [`${manager} 和 ${desktopLabel} 已就绪，远端正在监听 UDP 177。`, "可直接关闭此说明并新建图形登录；不需要重复安装 LightDM 或桌面环境。", "XDMCP 不加密，只应在可信局域网使用。"]
            : diagnostics.supported && diagnostics.has_x11_session
              ? [`已检测到 ${manager} 和 ${desktopLabel}，桌面组件已经可用。`, "当前缺少的是 XDMCP 服务开关：返回连接页面点击“启用 XDMCP 服务”，无需重新安装 LightDM 或桌面环境。", "启用时 Terma 只会在检测到活动防火墙时开放 UDP 177；未启用防火墙不会添加多余规则。", "XDMCP 不加密，只应在可信局域网使用。"]
              : ["确认远端显示管理器已安装并拥有 X11 桌面会话。", "缺少组件时可安装桌面或切换显示管理器；组件齐全时只需启用 XDMCP 服务。", "操作完成后返回本页面点击“重新探测”。", "XDMCP 使用 UDP 177，只应在可信局域网开放。"];
    const firewall = diagnostics.firewall === "ufw-active"
      ? "sudo ufw allow 177/udp"
      : diagnostics.firewall === "firewalld-active"
        ? "sudo firewall-cmd --permanent --add-port=177/udp && sudo firewall-cmd --reload"
        : "";
    const guideTitle = installAction ? `${installAction === "install-xfce" ? "兼容桌面" : installAction === "install-rdp" ? "RDP 服务" : "LightDM"}安装方式` : command ? "XDMCP 安装/配置说明" : "XDMCP 配置说明";
    const manualCommands = [command, firewall].filter(Boolean);
    const setupStateSummary = diagnostics.listening
      ? "XDMCP 已启用，远端正在监听 UDP 177。"
      : diagnostics.enabled
        ? "XDMCP 配置已经写入，但 UDP 177 尚未监听；需要应用配置并重启显示管理器。"
        : diagnostics.supported
          ? `${manager} 已安装并可配置，但 XDMCP 尚未启用，UDP 177 未监听。`
          : diagnostics.warning || "当前尚未检测到可用的 XDMCP/UDP 177 服务。";
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="xdmcpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="xdmcpSetupGuideTitle">${esc(guideTitle)}</h2><span class="muted">${esc(manager)} · ${esc(diagnostics.ssh_connection?.name || "SSH 管理连接")}</span></div><button class="icon-button" type="button" onclick="closeXdmcpSetupGuide()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status ${diagnostics.listening ? "success" : "warning"}">${esc(setupStateSummary)}</div>
      ${remoteDesktopProtocolGuideMarkup("xdmcp")}
      ${diagnostics.warning && diagnostics.warning !== setupStateSummary ? `<div class="connection-test-status warning">${esc(diagnostics.warning)}</div>` : ""}
      ${installPlan ? remoteInstallModesMarkup(installPlan, mode => `configureXdmcpHost(${Number(profileId)},'${installAction}',this,'${mode}')`, "revealRemoteInstallManual(this)", actionKey) : ""}
      ${remoteInstallManualMarkup(installPlan || {}, {steps, commands:manualCommands, note:"临时管理员授权只用于本次操作。安装或切换显示管理器可能结束当前图形会话；启用 XDMCP 时只有检测到活动防火墙才会添加 UDP 177 规则。"})}
      <div class="actions"><button type="button" onclick="closeXdmcpSetupGuide()">关闭</button>${command && connectionId ? `<button type="button" onclick="openXdmcpSetupTerminal(${connectionId})">${icon("square-terminal")}<span>在终端执行参考命令</span></button>` : ""}</div>
    </div>`;
    modal._xdmcpInstallCommand = command;
    setRemoteInstallDialogCommands(installPlan || {}, manualCommands);
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || "XDMCP 安装说明读取失败", "error");
  }
}

function beginXdmcpInstallProgress(action) {
  if (xdmcpProgressTimer) clearInterval(xdmcpProgressTimer);
  const container = $("xdmcpServerState");
  if (!container) return () => {};
  const stages = action === "install-xfce"
    ? ["准备安装兼容桌面", "刷新软件包索引", "安装 XFCE 和 dbus-x11", "配置 LightDM 与 xrdp 会话", "重启服务并重新探测"]
    : action === "repair-xrdp"
      ? ["检查 xrdp 会话配置", "备份现有 startwm.sh", "清理旧 D-Bus 环境", "切换到独立 XFCE 会话", "重启 xrdp 并重新探测"]
    : ["准备切换显示管理器", "安装 LightDM 组件", "写入 XDMCP 配置", "重启图形登录服务", "重新探测远端状态"];
  let stage = 0;
  const title = action === "install-xfce" ? "正在安装兼容桌面" : action === "repair-xrdp" ? "正在修复 RDP 会话" : "正在安装并配置 LightDM";
  container.innerHTML = `<div class="xdmcp-install-progress" role="status" aria-live="polite"><div class="xdmcp-install-progress-head"><span class="xdmcp-server-icon warning">${icon("loader-circle")}</span><div><b>${esc(title)}</b><small id="xdmcpProgressStage">${esc(stages[0])}</small></div></div><div class="xdmcp-progress-track" aria-hidden="true"><span class="xdmcp-progress-bar"></span></div><div class="muted">操作可能需要几分钟，请不要关闭 Terma 或远端终端。</div></div>`;
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
  const busyLabel = action === "disable" ? "关闭中..." : action === "uninstall-lightdm" ? "卸载中..." : action.startsWith("install-") ? "安装中..." : "处理中...";
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify("XDMCP 服务任务正在执行，请等待完成", "info");
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
  const modeLabel = normalizedMode === "local-offline" ? "本机下载后离线" : normalizedMode === "offline" ? "使用远端缓存" : "在线";
  const requestAction = packageInstall && normalizedMode === "local-offline"
    ? `${action}-local-offline`
    : packageInstall && normalizedMode === "offline"
      ? `${action}-offline`
      : action;
  const disable = action === "disable";
  const repairSession = action === "repair-session";
  const cleanupSessions = action === "cleanup-sessions";
  const message = cleanupSessions
    ? "检测到同一个 Linux 账号已有 XRDP/XDMCP 图形会话，Plasma 仍绑定在旧显示器上。将只结束没有本地 seat 的远程图形会话，不会关闭 seat0 本地桌面。未保存的远程桌面内容会丢失。"
    : repairSession
    ? "将把当前 SSH 管理账号保存的无效/通用桌面会话改为自动探测到的 X11 桌面，并重启 LightDM。当前本地图形会话会结束。"
    : uninstallLightdm
    ? "将停止 XDMCP、卸载由 Terma 安装的 LightDM，并尝试恢复切换前的显示管理器。当前图形会话会结束；只有检测到可恢复备份时才会自动执行。"
    : install
    ? `${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 LightDM，并在安装完成后切换显示管理器。当前本地图形会话可能结束，未保存内容可能丢失；XDMCP 只能用于可信局域网。`
    : installDesktop
    ? `${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 XFCE 和 dbus-x11。安装完成后请重新探测，再把 LightDM 与 xrdp 会话切换到 XFCE。`
    : installRdp
    ? `${modeLabel}${normalizedMode === "local-offline" ? "（仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统）" : ""}安装 xrdp 和对应的 Xorg 后端。安装完成后请重新探测并检查 RDP 桌面会话。`
    : action === "repair-xrdp"
    ? "将备份并修改远端 xrdp 的启动脚本，清理旧 D-Bus 环境后使用独立 XFCE 会话。现有 RDP 会话会被重启。"
    : disable
      ? "将关闭 XDMCP 并重启图形登录服务，当前本地图形会话可能结束。"
      : "将备份显示管理器配置、启用 XDMCP 并立即重启图形登录服务。当前本地图形会话会结束，未保存内容可能丢失。";
  if (!await confirmModal(message, cleanupSessions ? "结束冲突会话" : uninstallLightdm ? "卸载并恢复显示管理器" : disable ? "关闭 XDMCP" : repairSession ? "修复默认桌面" : packageInstall ? `${modeLabel}${install ? "安装 LightDM" : installDesktop ? "安装兼容桌面" : "安装 RDP 服务"}` : action === "repair-xrdp" ? "修复 RDP 会话" : "启用 XDMCP", cleanupSessions ? "结束并继续" : uninstallLightdm ? "卸载并恢复" : disable ? "关闭并重启" : repairSession ? "修复并重启" : packageInstall ? "安装" : action === "repair-xrdp" ? "修复并重启" : "启用并重启", "取消", true)) return null;
  let adminAuth = null;
  const serverState = $("xdmcpServerState");
  if (serverState?.dataset.adminRequired === "1") {
    adminAuth = await requestRemoteAdminAuthorization(Number(serverState.dataset.adminConnectionId || 0), packageInstall ? `${modeLabel}安装 XDMCP 组件` : uninstallLightdm ? "卸载并恢复显示管理器" : action === "repair-xrdp" ? "修复 RDP 会话" : "配置 XDMCP");
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, cleanupSessions ? "清理中..." : uninstallLightdm ? "卸载中..." : packageInstall ? "安装中..." : action === "repair-xrdp" || repairSession ? "修复中..." : "配置中...");
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
        title:uninstallLightdm ? "卸载并恢复显示管理器" : packageInstall ? `${modeLabel}安装 XDMCP 组件` : disable ? "关闭 XDMCP" : "配置 XDMCP",
        onDone:(_, activeContainer) => activeContainer ? inspectXdmcpServer(id, null, activeContainer).catch(() => {}) : null
      });
      const requestedLabel = uninstallLightdm ? "卸载并恢复显示管理器" : packageInstall ? `${modeLabel}安装 XDMCP 组件` : disable ? "关闭 XDMCP" : "配置 XDMCP";
      const requestAccepted = notifyRemoteComponentTaskRequest(result, requestedLabel, `${result.task.action_label || result.task.component_label || "XDMCP 操作"}已加入任务中心`);
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    if (result.after || result.before) renderXdmcpServerState(result.after || result.before);
    notify(cleanupSessions ? "冲突的远程图形会话已结束" : disable ? "XDMCP 已关闭" : packageInstall ? `${modeLabel}安装完成，已重新探测` : "XDMCP 已配置并重新探测", "success");
    return result;
  } catch (error) {
    const container = $("xdmcpServerState");
    if (container) {
      container.innerHTML = `<div class="connection-test-status error">${esc(error.message || "XDMCP 配置失败")}</div>`;
      refreshIcons();
    }
    notify(error.message || "XDMCP 配置失败", "error");
    return null;
  } finally {
    stopProgress();
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}
