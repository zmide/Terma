function openLinuxDesktopManager(connectionId=0, updateTab=true) {
  const normalizedConnectionId = Number(connectionId || 0);
  const sameConnection = Number(linuxDesktopManagerState.connectionId || 0) === normalizedConnectionId;
  const monitoredTask = activeLinuxDesktopMonitorForConnection(normalizedConnectionId)?.task || null;
  if (!sameConnection) {
    linuxDesktopManagerState = {
      connectionId:normalizedConnectionId,
      diagnostics:null,
      sshX11:null,
      error:null,
      loading:Boolean(normalizedConnectionId),
      taskId:String(monitoredTask?.id || ""),
      task:monitoredTask,
      logs:monitoredTask?.logs || []
    };
    resetLinuxDesktopTaskLogView(monitoredTask?.id || "");
  } else if (monitoredTask && !linuxDesktopManagerState.task) {
    linuxDesktopManagerState.taskId = String(monitoredTask.id || "");
    linuxDesktopManagerState.task = monitoredTask;
    linuxDesktopManagerState.logs = monitoredTask.logs || [];
  }
  showPrimary("remote");
  setWorkspace("Linux 桌面管理", "安装、探测和修复远端 Linux 图形桌面", "linux-desktop", `linux-desktop-${normalizedConnectionId || "select"}`, updateTab, true, {kind:"linux-desktop", id:normalizedConnectionId});
  renderLinuxDesktopManager();
  if (linuxDesktopManagerState.connectionId) {
    void loadLinuxDesktopManager();
    if (monitoredTask) pollLinuxDesktopInstallTask(monitoredTask.id, normalizedConnectionId, null, monitoredTask);
    else void restoreLinuxDesktopRunningTask(normalizedConnectionId);
  }
}

function linuxDesktopTaskInProgress(task) {
  return ["running", "pending", "queued"].includes(String(task?.status || "").toLowerCase());
}

function activeLinuxDesktopMonitorForConnection(connectionId) {
  const id = Number(connectionId || 0);
  if (!id) return null;
  return [...linuxDesktopTaskMonitors.values()]
    .filter(entry => Number(entry.connectionId || entry.task?.connection_id || 0) === id && linuxDesktopTaskInProgress(entry.task))
    .sort((left, right) => Number(right.task?.updated_at || right.task?.created_at || 0) - Number(left.task?.updated_at || left.task?.created_at || 0))[0] || null;
}

async function restoreLinuxDesktopRunningTask(connectionId) {
  const id = Number(connectionId || 0);
  if (!id || activeLinuxDesktopMonitorForConnection(id)) return null;
  try {
    const tasks = await api("/api/linux-desktop/tasks");
    const task = (Array.isArray(tasks) ? tasks : [])
      .filter(item => Number(item.connection_id || 0) === id && linuxDesktopTaskInProgress(item))
      .sort((left, right) => Number(right.updated_at || right.created_at || 0) - Number(left.updated_at || left.created_at || 0))[0] || null;
    if (!task) return null;
    if (Number(linuxDesktopManagerState.connectionId || 0) === id && !linuxDesktopTaskInProgress(linuxDesktopManagerState.task)) {
      linuxDesktopManagerState.taskId = String(task.id || "");
      linuxDesktopManagerState.task = task;
      linuxDesktopManagerState.logs = task.logs || [];
      resetLinuxDesktopTaskLogView(task.id);
      renderLinuxDesktopManager();
    }
    pollLinuxDesktopInstallTask(task.id, id, null, task);
    return task;
  } catch {
    return null;
  }
}

function linuxDesktopDetectedSessionLabel(session, fallback="未知") {
  if (!session) return fallback;
  if (session.desktop_id) return linuxDesktopLabel(session.desktop_id);
  return session.name || session.raw || fallback;
}

function renderLinuxDesktopUsageBadges(diagnostics, desktopId) {
  const usage = diagnostics?.desktop_usage?.[desktopId];
  if (!usage) return "";
  const badges = [];
  const add = (kind, label, title) => badges.push(`<span class="linux-desktop-usage-badge ${kind}" title="${escAttr(title)}">${esc(label)}</span>`);
  if (usage.system_default) add("configured", "系统默认", "显示管理器或 x-session-manager 的默认选择，不代表会话正在运行");
  if (usage.account_default) add("configured", "账号默认", "当前 SSH 管理账号保存的桌面选择，不代表会话正在运行");
  if (usage.xdmcp_configured) add("protocol", "XDMCP 配置", "XDMCP/显示管理器已配置使用此桌面，不代表当前已有 XDMCP 会话");
  if (usage.rdp_configured) add("protocol", "RDP 配置", "XRDP 启动脚本已明确选择此桌面，不代表当前已有 RDP 会话");
  if (usage.vnc_configured) add("protocol", "VNC 配置", "TigerVNC 独立桌面配置已明确选择此桌面，不代表当前会话正在运行");
  if (usage.local_active) add("active", "当前本地会话", "检测到带本地 seat 的活动图形会话正在使用此桌面");
  if (usage.xdmcp_active) add("active", "XDMCP 当前会话", "检测到活动 XDMCP 图形会话；桌面名称来自会话本身或明确的 XDMCP 配置");
  if (usage.rdp_active) add("active", "RDP 当前会话", "检测到活动 XRDP 图形会话；桌面名称来自会话本身或明确的 XRDP 启动配置");
  if (usage.remote_active && !usage.xdmcp_active && !usage.rdp_active) add("active", "当前远程会话", "检测到不带本地 seat 的活动图形会话正在使用此桌面");
  if (usage.vnc_shared) add("active", "VNC 共享当前会话", "检测到 x11vnc/wayvnc 正在共享此活动桌面");
  if (usage.vnc_virtual_active) add("active", "VNC 虚拟会话", "检测到 TigerVNC 独立虚拟会话正在使用此桌面");
  return badges.length ? `<div class="linux-desktop-usage-badges">${badges.join("")}</div>` : "";
}

function renderLinuxDesktopSelectionSummary(diagnostics) {
  if (!diagnostics) return "";
  const selection = diagnostics.desktop_selection || {};
  const sessionLabel = (entry, fallback) => linuxDesktopDetectedSessionLabel(entry?.session, fallback);
  const activeGraphical = Array.isArray(diagnostics.active_graphical_sessions) ? diagnostics.active_graphical_sessions : [];
  const activeLabels = [...new Set(activeGraphical.map(item => item.desktop_id ? linuxDesktopLabel(item.desktop_id) : "").filter(Boolean))];
  const activeVnc = Array.isArray(diagnostics.active_vnc_sessions) ? diagnostics.active_vnc_sessions : [];
  const sharedVnc = activeVnc.filter(item => item.shared);
  const virtualVnc = activeVnc.filter(item => item.virtual);
  const sharedLabels = [...new Set(sharedVnc.map(item => item.desktop_id ? linuxDesktopLabel(item.desktop_id) : "").filter(Boolean))];
  const virtualLabels = [...new Set(virtualVnc.map(item => item.desktop_id ? linuxDesktopLabel(item.desktop_id) : "").filter(Boolean))];
  let vncValue = selection.vnc?.state === "not-installed"
    ? "未安装"
    : sharedVnc.length
      ? `共享当前会话${sharedLabels.length ? ` · ${sharedLabels.join(" / ")}` : " · 桌面未知"}`
      : virtualVnc.length
        ? virtualLabels.length ? `虚拟会话 · ${virtualLabels.join(" / ")}` : "虚拟会话 · 桌面由登录/启动配置决定"
        : selection.vnc?.state === "configured"
          ? `${sessionLabel(selection.vnc, "已配置")} · 尚未运行`
          : "登录/启动时选择";
  const items = [
    ["settings-2", "系统默认", sessionLabel(selection.system_default, "未知")],
    ["user-round", "账号默认", sessionLabel(selection.account_default, "登录时选择")],
    ["panels-top-left", "XDMCP", selection.xdmcp?.state === "disabled" ? "未启用" : sessionLabel(selection.xdmcp, "登录时选择")],
    ["monitor", "RDP", selection.rdp?.state === "not-installed" ? "未安装" : sessionLabel(selection.rdp, "未知")],
    ["radio-tower", "VNC", vncValue],
    ["activity", "当前图形会话", activeGraphical.length ? activeLabels.length ? activeLabels.join(" / ") : "活动中 · 桌面未知" : "未检测到"]
  ];
  return `<div class="linux-desktop-selection-summary">${items.map(([itemIcon,label,value]) => `<div><span>${icon(itemIcon)}${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>`;
}

function renderLinuxDesktopManager() {
  const view = $("view-linux-desktop");
  if (!view) return;
  const state = linuxDesktopManagerState;
  if (state.task) captureLinuxDesktopTaskLogView();
  const selected = Number(state.connectionId || 0);
  const diagnostics = state.diagnostics;
  const diagnosticsError = state.error;
  const diagnosticsAuthFailed = Boolean(diagnosticsError && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(diagnosticsError));
  const loading = Boolean(state.loading);
  const connection = currentConnection(selected);
  const catalog = diagnostics?.desktop_catalog || ["xfce", "gnome", "plasma", "mate", "cinnamon", "lxqt"].map(id => ({id}));
  const installed = new Set((diagnostics?.desktops || []).map(item => item.id));
  const installable = new Set(diagnostics?.installable_desktops || []);
  const platformSupported = diagnostics?.platform_supported !== false;
  const macos = diagnostics?.os_id === "macos" || state.sshX11?.platform === "macos";
  const actionKey = linuxDesktopActionKey(selected);
  const taskRunning = linuxDesktopTaskInProgress(state.task);
  view.innerHTML = `<div class="linux-desktop-manager remote-desktop-launch">
    <div class="remote-desktop-icon">${icon("monitor-cog")}</div>
    <h2>${macos ? "macOS X11 管理" : "Linux 桌面管理"}</h2>
    <div class="muted">${macos ? "探测远端 XQuartz、xauth 和 SSH X11 转发，并提供交互式安装与配置入口。" : "选择 SSH 主机后，探测并安装可用于 RDP、VNC 和 XDMCP 的图形桌面。"}</div>
    <div class="linux-desktop-manager-toolbar"><label>SSH 管理连接<select id="linuxDesktopConnection" onchange="selectLinuxDesktopManagerConnection(this.value)" ${loading ? "disabled" : ""}><option value="0">请选择 SSH 主机</option>${linuxDesktopManagerConnectionOptions(selected)}</select></label><button type="button" onclick="loadLinuxDesktopManager()" ${selected && !loading ? "" : "disabled"}>${icon(loading ? "loader-circle" : "refresh-cw")}<span>${loading ? "探测中..." : "重新探测"}</span></button></div>
    ${selected && diagnostics ? `<div class="linux-desktop-diagnostics ${macos ? state.sshX11?.ready ? "ready" : "warning" : diagnostics.has_desktop ? "ready" : "warning"}"><div><strong>${esc(diagnostics.connection?.name || "SSH 主机")}</strong><span>${macos ? "macOS · SSH X11 图形环境" : `${esc(diagnostics.os_id || "Linux")} · ${esc(diagnostics.package_manager || "未识别包管理器")} · ${esc(diagnostics.display_manager || "未识别显示管理器")}`}</span></div><span class="status-pill">${macos ? state.sshX11?.ready ? "X11 已就绪" : state.sshX11?.xquartz_installed ? "XQuartz 已安装，配置未完成" : "未安装 XQuartz" : diagnostics.has_desktop ? `已发现 ${diagnostics.desktops.length} 个桌面` : "未检测到图形桌面"}</span></div>
      ${platformSupported ? `${renderLinuxDesktopSelectionSummary(diagnostics)}<div class="linux-desktop-grid">${catalog.map(item => { const id = item.id; const available = installable.has(id); const isInstalled = installed.has(id); const enabled = (isInstalled || available) && !taskRunning; return `<article class="linux-desktop-card ${isInstalled ? "installed" : ""}" data-desktop-id="${escAttr(id)}"><div class="linux-desktop-card-icon">${icon(item.icon || "monitor")}</div><div><strong>${esc(item.label || linuxDesktopLabel(id))}</strong><span>${isInstalled ? "已安装，可用于图形会话" : available ? "可自动安装" : "当前包管理器未提供自动方案"}</span>${isInstalled ? renderLinuxDesktopUsageBadges(diagnostics, id) : ""}</div><button type="button" data-ui-action-key="${escAttr(actionKey)}" class="${enabled && !isInstalled ? "primary" : ""}" onclick="${isInstalled ? `uninstallLinuxDesktop('${escAttr(id)}',this)` : `installLinuxDesktop('${escAttr(id)}')`}" ${enabled ? "" : "disabled"}>${icon(isInstalled ? "trash-2" : "package-plus")}<span>${isInstalled ? "卸载" : "安装"}</span></button></article>`; }).join("")}</div>` : ""}
      ${renderSshX11ForwardingPanel(connection, state.sshX11, "linux-desktop")}
      <div class="linux-desktop-hint">${platformSupported ? "远程桌面不要求服务器连接物理显示器。RDP、XDMCP 和虚拟 VNC 需要远端能启动桌面会话；x11vnc/wayvnc 共享已有会话；SSH X11 单程序不需要完整桌面。配置标记不等于正在运行，只有“当前会话”或“VNC 会话”标记代表已探测到活动会话。" : macos ? "macOS 不安装 Linux 桌面环境。请使用上方的“安装远端 XQuartz”和“在终端开启 X11 转发”；出现 sudo 提示时输入远端 macOS 账号密码。" : "当前 SSH 主机不是 Linux，不能在此主机上安装 Linux 桌面环境。"}</div>` : selected && diagnosticsError ? `<div class="connection-test-status remote-diagnostic-status error"><span class="remote-diagnostic-icon">${icon("circle-alert")}</span><span class="remote-diagnostic-copy">${esc(diagnosticsError.message || "Linux 桌面探测失败")}</span>${diagnosticsAuthFailed ? `<span class="remote-diagnostic-actions"><button type="button" data-action="linux-desktop-credential-repair" data-connection-id="${selected}">${icon("key-round")}<span>修复 SSH 凭据</span></button></span>` : ""}</div>` : `<div class="connection-test-status ${loading ? "busy remote-probe-loading" : ""}">${loading ? `${icon("loader-circle")}<span>正在探测 ${esc(connection?.name || "SSH 主机")} 的系统、桌面与 X11 状态...</span>` : selected ? "正在准备探测..." : "请选择一个 SSH 主机开始探测。"}</div>`}
    ${state.task ? `<div id="linuxDesktopInstallTask" class="linux-desktop-install-task"></div>` : ""}
  </div>`;
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  const x11ActionKey = x11ForwardingActionKey(selected);
  syncUiActionControls(x11ActionKey, isUiActionInFlight(x11ActionKey));
  if (state.task) renderLinuxDesktopTask(state.task);
}

function selectLinuxDesktopManagerConnection(value) {
  linuxDesktopManagerState.connectionId = Number(value || 0);
  const activeManagerTab = tabs.find(tab => tab.key === activeTabKey && tab.kind === "linux-desktop");
  if (activeManagerTab) {
    activeManagerTab.id = linuxDesktopManagerState.connectionId;
    saveTabsState();
  }
  linuxDesktopManagerState.diagnostics = null;
  linuxDesktopManagerState.sshX11 = null;
  linuxDesktopManagerState.error = null;
  linuxDesktopManagerState.loading = Boolean(linuxDesktopManagerState.connectionId);
  linuxDesktopManagerState.taskId = "";
  linuxDesktopManagerState.task = null;
  linuxDesktopManagerState.logs = [];
  const monitoredTask = activeLinuxDesktopMonitorForConnection(linuxDesktopManagerState.connectionId)?.task || null;
  if (monitoredTask) {
    linuxDesktopManagerState.taskId = String(monitoredTask.id || "");
    linuxDesktopManagerState.task = monitoredTask;
    linuxDesktopManagerState.logs = monitoredTask.logs || [];
  }
  resetLinuxDesktopTaskLogView();
  renderLinuxDesktopManager();
  if (linuxDesktopManagerState.connectionId) {
    void loadLinuxDesktopManager();
    if (monitoredTask) pollLinuxDesktopInstallTask(monitoredTask.id, linuxDesktopManagerState.connectionId, null, monitoredTask);
    else void restoreLinuxDesktopRunningTask(linuxDesktopManagerState.connectionId);
  }
}

async function loadLinuxDesktopManager() {
  const id = Number(linuxDesktopManagerState.connectionId || 0);
  if (!id) return;
  linuxDesktopManagerState.error = null;
  linuxDesktopManagerState.loading = true;
  renderLinuxDesktopManager();
  try {
    const [diagnostics, sshX11] = await Promise.all([
      api(`/api/connections/${id}/linux-desktop`),
      api(`/api/connections/${id}/x11-forwarding`).catch(error => ({
        error:error.message || "SSH X11 配置探测失败",
        code:error.code || "",
        connectionId:Number(error.connectionId || id)
      }))
    ]);
    if (Number(linuxDesktopManagerState.connectionId || 0) !== id) return;
    linuxDesktopManagerState.diagnostics = diagnostics;
    linuxDesktopManagerState.sshX11 = sshX11;
    linuxDesktopManagerState.error = null;
    linuxDesktopManagerState.loading = false;
    renderLinuxDesktopManager();
  } catch (error) {
    if (Number(linuxDesktopManagerState.connectionId || 0) !== id) return;
    linuxDesktopManagerState.diagnostics = null;
    linuxDesktopManagerState.error = {
      message:error.message || "Linux 桌面探测失败",
      code:error.code || "",
      connectionId:Number(error.connectionId || id)
    };
    linuxDesktopManagerState.loading = false;
    renderLinuxDesktopManager();
    notify(error.message || "Linux 桌面探测失败", "error");
  }
}

async function repairLinuxDesktopCredentials(connectionId) {
  const id = Number(connectionId || linuxDesktopManagerState.connectionId || 0);
  if (typeof repairSshCredentials !== "function" || id < 1) return false;
  return repairSshCredentials(id, {
    context:"Linux 桌面探测认证失败",
    onSaved:async () => loadLinuxDesktopManager()
  });
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("linux-desktop-credential-repair", ({element}) => repairLinuxDesktopCredentials(Number(element.dataset.connectionId || 0)));
}

function resetLinuxDesktopTaskLogView(taskId="") {
  linuxDesktopTaskLogView = {taskId:String(taskId || ""), expanded:false, follow:true, scrollTop:0};
  return linuxDesktopTaskLogView;
}

function ensureLinuxDesktopTaskLogView(task) {
  const taskId = String(task?.id || linuxDesktopManagerState.taskId || "");
  if (linuxDesktopTaskLogView.taskId !== taskId) resetLinuxDesktopTaskLogView(taskId);
  return linuxDesktopTaskLogView;
}

function linuxDesktopTaskLogAtBottom(log) {
  return !log || log.scrollHeight - log.scrollTop - log.clientHeight <= 12;
}

function captureLinuxDesktopTaskLogView() {
  const log = $("linuxDesktopTaskLog");
  if (!log) return;
  const taskId = String(log.dataset.taskId || "");
  if (linuxDesktopTaskLogView.taskId !== taskId) resetLinuxDesktopTaskLogView(taskId);
  linuxDesktopTaskLogView.expanded = log.classList.contains("expanded");
  linuxDesktopTaskLogView.follow = linuxDesktopTaskLogAtBottom(log);
  linuxDesktopTaskLogView.scrollTop = log.scrollTop;
}

function restoreLinuxDesktopTaskLogView(log, task) {
  if (!log) return;
  const view = ensureLinuxDesktopTaskLogView(task);
  log.classList.toggle("expanded", view.expanded);
  if (view.follow) log.scrollTop = log.scrollHeight;
  else log.scrollTop = Math.min(view.scrollTop, Math.max(0, log.scrollHeight - log.clientHeight));
  view.scrollTop = log.scrollTop;
  log.addEventListener("scroll", () => {
    if (linuxDesktopTaskLogView.taskId !== String(log.dataset.taskId || "")) return;
    linuxDesktopTaskLogView.follow = linuxDesktopTaskLogAtBottom(log);
    linuxDesktopTaskLogView.scrollTop = log.scrollTop;
  }, {passive:true});
}

function renderLinuxDesktopTask(task) {
  const container = $("linuxDesktopInstallTask");
  if (!container) return;
  captureLinuxDesktopTaskLogView();
  const logView = ensureLinuxDesktopTaskLogView(task);
  const logs = Array.isArray(task.logs) ? task.logs : [];
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  const done = task.status === "done";
  const failed = task.status === "failed";
  const verb = task.action_label || (task.action === "uninstall" ? "卸载" : "安装");
  container.innerHTML = `<div class="linux-desktop-task-head"><div><strong>${esc(task.desktop_label || "Linux 桌面")}${verb}${done ? "完成" : failed ? "失败" : "中"}</strong><span>${esc(task.stage || "prepare")} · ${done ? "已完成" : failed ? esc(task.error || `${verb}失败`) : `${progress}%`}</span></div><button class="icon-button" onclick="toggleLinuxDesktopTaskLog()" title="查看${verb}日志" aria-label="查看${verb}日志">${icon("scroll-text")}</button></div><div class="linux-desktop-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><pre id="linuxDesktopTaskLog" data-task-id="${escAttr(logView.taskId)}" class="linux-desktop-task-log${logView.expanded ? " expanded" : ""}">${esc(logs.map(item => `[${new Date(item.at || Date.now()).toLocaleTimeString()}] ${item.stream === "stderr" || item.stream === "error" ? "! " : ""}${item.text || ""}`).join("\n"))}</pre>`;
  refreshIcons();
  restoreLinuxDesktopTaskLogView($("linuxDesktopTaskLog"), task);
}

function toggleLinuxDesktopTaskLog() {
  const log = $("linuxDesktopTaskLog");
  if (!log) return;
  captureLinuxDesktopTaskLogView();
  log.classList.toggle("expanded");
  linuxDesktopTaskLogView.expanded = log.classList.contains("expanded");
  if (linuxDesktopTaskLogView.follow) {
    log.scrollTop = log.scrollHeight;
    linuxDesktopTaskLogView.scrollTop = log.scrollTop;
  }
}

function openLinuxDesktopInstallOptions(desktopId) {
  const diagnostics = linuxDesktopManagerState.diagnostics || {};
  const plan = diagnostics.desktop_install_plans?.[desktopId];
  if (!plan) return notify("当前包管理器没有可用的桌面安装方案", "info");
  const label = linuxDesktopLabel(desktopId);
  const modal = $("modal");
  const packageManager = diagnostics.package_manager || "未识别包管理器";
  const steps = [
    `选择一种方式安装 ${label}；在线安装要求远端可以访问软件源。`,
    "本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统：Terma 会解析依赖、下载匹配架构的软件包并通过 SFTP 上传。",
    "使用远端缓存不会访问软件源，只有远端缓存已经完整时才能成功。",
    "安装结束后 Terma 会重新探测桌面会话；RDP、VNC 或 XDMCP 仍需各自的服务端配置。"
  ];
  modal.innerHTML = `<div class="modal-card wide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="linuxDesktopInstallTitle">
    <div class="modal-title-row"><div><h2 id="linuxDesktopInstallTitle">安装 ${esc(label)}</h2><span class="muted">${esc(diagnostics.connection?.name || "SSH 主机")} · ${esc(packageManager)}</span></div><button class="icon-button" type="button" onclick="closeRemoteInstallDialog()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <div class="connection-test-status warning">请选择安装方式。安装桌面可能下载较大的软件包，并可能影响正在运行的图形会话。</div>
    ${remoteInstallModesMarkup(plan, mode => `installLinuxDesktop('${escAttr(desktopId)}','${mode}',this)`, "revealRemoteInstallManual(this)", linuxDesktopActionKey(linuxDesktopManagerState.connectionId))}
    ${remoteInstallManualMarkup(plan, {steps, note:"如果服务器和本机都不能联网，请先在另一台可联网设备上按发行版与架构下载完整软件包及依赖，再上传到远端并使用对应包管理器安装。"})}
    <div class="actions"><button type="button" onclick="closeRemoteInstallDialog()">关闭</button></div>
  </div>`;
  setRemoteInstallDialogCommands(plan);
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();
  const actionKey = linuxDesktopActionKey(linuxDesktopManagerState.connectionId);
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function installLinuxDesktop(desktopId, mode="", button=null) {
  const id = Number(linuxDesktopManagerState.connectionId || 0);
  if (!id) return notify("请先选择 SSH 管理连接", "info");
  const actionKey = linuxDesktopActionKey(id);
  if (!mode) {
    if (isUiActionInFlight(actionKey)) return notify("Linux 桌面任务正在执行，请等待完成", "info");
    return openLinuxDesktopInstallOptions(desktopId);
  }
  if (!beginUiAction(actionKey, button, "安装中...")) {
    notify("Linux 桌面任务正在执行，请等待完成", "info");
    return null;
  }
  let handedOff = false;
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline" ? "本机下载后离线" : normalizedMode === "offline" ? "使用远端缓存" : "在线";
  const message = normalizedMode === "local-offline"
    ? `Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载 ${linuxDesktopLabel(desktopId)} 及其依赖，通过 SFTP 上传后安装。是否继续？`
    : normalizedMode === "offline"
      ? `将只使用远端包管理器已经缓存的软件包安装 ${linuxDesktopLabel(desktopId)}，不会访问软件源。缓存不完整时安装会失败，是否继续？`
      : `将通过远端软件源在线安装 ${linuxDesktopLabel(desktopId)}。安装期间可能下载较大的软件包，是否继续？`;
  try {
    if (!await confirmModal(message, `${modeLabel}安装 Linux 桌面`, "安装", "取消", true)) return null;
    let adminAuth = null;
    if (!linuxDesktopManagerState.diagnostics?.privileged) {
      adminAuth = await requestRemoteAdminAuthorization(id, `${modeLabel}安装 Linux 桌面`);
      if (!adminAuth) return null;
    }
    const task = await api(`/api/connections/${id}/linux-desktop/install`, {method:"POST", body:JSON.stringify({desktop_id:desktopId, mode:normalizedMode, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    linuxDesktopManagerState.taskId = task.id;
    linuxDesktopManagerState.task = task;
    linuxDesktopManagerState.logs = task.logs || [];
    renderLinuxDesktopManager();
    if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
    handedOff = true;
    pollLinuxDesktopInstallTask(task.id, id, button, task);
    return task;
  } catch (error) {
    notify(error.message || `${modeLabel}安装 Linux 桌面启动失败`, "error");
    return null;
  } finally {
    if (!handedOff) endUiAction(actionKey, button);
  }
}

async function uninstallLinuxDesktop(desktopId, button=null) {
  const id = Number(linuxDesktopManagerState.connectionId || 0);
  if (!id) return notify("请先选择 SSH 管理连接", "info");
  const actionKey = linuxDesktopActionKey(id);
  if (!beginUiAction(actionKey, button, "卸载中...")) {
    notify("Linux 桌面任务正在执行，请等待完成", "info");
    return null;
  }
  let handedOff = false;
  const label = linuxDesktopLabel(desktopId);
  try {
    if (!await confirmModal(`将通过 SSH 卸载 ${label} 的桌面组件。可能影响现有图形登录、RDP、VNC 或 XDMCP 会话，是否继续？`, "卸载 Linux 桌面", "卸载", "取消", true)) return null;
    let adminAuth = null;
    if (!linuxDesktopManagerState.diagnostics?.privileged) {
      adminAuth = await requestRemoteAdminAuthorization(id, "卸载 Linux 桌面");
      if (!adminAuth) return null;
    }
    const task = await api(`/api/connections/${id}/linux-desktop/uninstall`, {method:"POST", body:JSON.stringify({desktop_id:desktopId, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    linuxDesktopManagerState.taskId = task.id;
    linuxDesktopManagerState.task = task;
    linuxDesktopManagerState.logs = task.logs || [];
    renderLinuxDesktopManager();
    if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
    handedOff = true;
    pollLinuxDesktopInstallTask(task.id, id, button, task);
    return task;
  } catch (error) {
    notify(error.message || "Linux 桌面卸载启动失败", "error");
    return null;
  } finally {
    if (!handedOff) endUiAction(actionKey, button);
  }
}

function pollLinuxDesktopInstallTask(taskId, connectionId=0, button=null, initialTask=null) {
  const id = String(taskId || "");
  if (!id) return Promise.resolve(null);
  const existing = linuxDesktopTaskMonitors.get(id);
  if (existing) return existing.promise;
  const normalizedConnectionId = Number(connectionId || initialTask?.connection_id || linuxDesktopManagerState.connectionId || 0);
  const actionKey = linuxDesktopActionKey(normalizedConnectionId);
  if (!isUiActionInFlight(actionKey)) beginUiAction(actionKey, button, "任务进行中...");
  let resolveCompletion;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  const monitor = {task:initialTask, connectionId:normalizedConnectionId, timer:null, promise:completion};
  linuxDesktopTaskMonitors.set(id, monitor);
  const finish = task => {
    if (monitor.timer) clearTimeout(monitor.timer);
    monitor.timer = null;
    if (linuxDesktopTaskMonitors.get(id) === monitor) linuxDesktopTaskMonitors.delete(id);
    endUiAction(actionKey, button);
    resolveCompletion(task || null);
  };
  const visible = task => String(linuxDesktopManagerState.taskId || "") === id
    && Number(linuxDesktopManagerState.connectionId || 0) === Number(task?.connection_id || normalizedConnectionId);
  const poll = async () => {
    try {
      const task = await api(`/api/linux-desktop/tasks/${encodeURIComponent(id)}`);
      monitor.task = task;
      if (visible(task)) {
        linuxDesktopManagerState.task = task;
        linuxDesktopManagerState.logs = task.logs || [];
        if ($("linuxDesktopInstallTask")) renderLinuxDesktopTask(task);
      }
      if (["done", "failed", "cancelled"].includes(String(task.status || "").toLowerCase())) {
        if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
        if (visible(task) && task.status === "done") {
          notify(`Linux 桌面${task.action === "uninstall" ? "卸载" : "安装"}完成，正在重新探测`, "success");
          linuxDesktopManagerState.taskId = "";
          await loadLinuxDesktopManager();
        } else if (visible(task)) {
          linuxDesktopManagerState.taskId = "";
          renderLinuxDesktopManager();
          notify(task.status === "cancelled" ? `Linux 桌面${task.action === "uninstall" ? "卸载" : "安装"}已取消` : task.error || `Linux 桌面${task.action === "uninstall" ? "卸载" : "安装"}失败`, task.status === "cancelled" ? "info" : "error");
        }
        finish(task);
        return;
      }
      monitor.timer = setTimeout(poll, 900);
    } catch (error) {
      if (String(linuxDesktopManagerState.taskId || "") === id) notify(error.message || "读取桌面管理日志失败", "error");
      finish(null);
    }
  };
  void poll();
  return completion;
}
