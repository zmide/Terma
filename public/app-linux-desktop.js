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
  setWorkspace(tr("remote:linux_desktop.title", {defaultValue:"Linux 桌面管理"}), tr("remote:linux_desktop.workspace_subtitle", {defaultValue:"安装、探测和修复远端 Linux 图形桌面"}), "linux-desktop", `linux-desktop-${normalizedConnectionId || "select"}`, updateTab, true, {kind:"linux-desktop", id:normalizedConnectionId});
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

function linuxDesktopDetectedSessionLabel(session, fallback=tr("remote:linux_desktop.unknown", {defaultValue:"未知"})) {
  if (!session) return fallback;
  if (session.desktop_id) return linuxDesktopLabel(session.desktop_id);
  return session.name || session.raw || fallback;
}

function renderLinuxDesktopUsageBadges(diagnostics, desktopId) {
  const usage = diagnostics?.desktop_usage?.[desktopId];
  if (!usage) return "";
  const badges = [];
  const add = (kind, label, title) => badges.push(`<span class="linux-desktop-usage-badge ${kind}" title="${escAttr(title)}">${esc(label)}</span>`);
  const badgeLabels = {
    system_default:tr("remote:linux_desktop.usage.system_default", {defaultValue:"系统默认"}),
    account_default:tr("remote:linux_desktop.usage.account_default", {defaultValue:"账号默认"}),
    xdmcp_configured:tr("remote:linux_desktop.usage.xdmcp_configured", {defaultValue:"XDMCP 配置"}),
    rdp_configured:tr("remote:linux_desktop.usage.rdp_configured", {defaultValue:"RDP 配置"}),
    vnc_configured:tr("remote:linux_desktop.usage.vnc_configured", {defaultValue:"VNC 配置"}),
    local_active:tr("remote:linux_desktop.usage.local_active", {defaultValue:"当前本地会话"}),
    xdmcp_active:tr("remote:linux_desktop.usage.xdmcp_active", {defaultValue:"XDMCP 当前会话"}),
    rdp_active:tr("remote:linux_desktop.usage.rdp_active", {defaultValue:"RDP 当前会话"}),
    remote_active:tr("remote:linux_desktop.usage.remote_active", {defaultValue:"当前远程会话"}),
    vnc_shared:tr("remote:linux_desktop.usage.vnc_shared", {defaultValue:"VNC 共享当前会话"}),
    vnc_virtual_active:tr("remote:linux_desktop.usage.vnc_virtual_active", {defaultValue:"VNC 虚拟会话"})
  };
  const badgeHints = {
    system_default:tr("remote:linux_desktop.usage_hints.system_default", {defaultValue:"显示管理器或 x-session-manager 的默认选择，不代表会话正在运行"}),
    account_default:tr("remote:linux_desktop.usage_hints.account_default", {defaultValue:"当前 SSH 管理账号保存的桌面选择，不代表会话正在运行"}),
    xdmcp_configured:tr("remote:linux_desktop.usage_hints.xdmcp_configured", {defaultValue:"XDMCP/显示管理器已配置使用此桌面，不代表当前已有 XDMCP 会话"}),
    rdp_configured:tr("remote:linux_desktop.usage_hints.rdp_configured", {defaultValue:"XRDP 启动脚本已明确选择此桌面，不代表当前已有 RDP 会话"}),
    vnc_configured:tr("remote:linux_desktop.usage_hints.vnc_configured", {defaultValue:"TigerVNC 独立桌面配置已明确选择此桌面，不代表当前会话正在运行"}),
    local_active:tr("remote:linux_desktop.usage_hints.local_active", {defaultValue:"检测到带本地 seat 的活动图形会话正在使用此桌面"}),
    xdmcp_active:tr("remote:linux_desktop.usage_hints.xdmcp_active", {defaultValue:"检测到活动 XDMCP 图形会话；桌面名称来自会话本身或明确的 XDMCP 配置"}),
    rdp_active:tr("remote:linux_desktop.usage_hints.rdp_active", {defaultValue:"检测到活动 XRDP 图形会话；桌面名称来自会话本身或明确的 XRDP 启动配置"}),
    remote_active:tr("remote:linux_desktop.usage_hints.remote_active", {defaultValue:"检测到不带本地 seat 的活动图形会话正在使用此桌面"}),
    vnc_shared:tr("remote:linux_desktop.usage_hints.vnc_shared", {defaultValue:"检测到 x11vnc/wayvnc 正在共享此活动桌面"}),
    vnc_virtual_active:tr("remote:linux_desktop.usage_hints.vnc_virtual_active", {defaultValue:"检测到 TigerVNC 独立虚拟会话正在使用此桌面"})
  };
  const badge = key => badgeLabels[key] || key;
  const hint = key => badgeHints[key] || key;
  if (usage.system_default) add("configured", badge("system_default"), hint("system_default"));
  if (usage.account_default) add("configured", badge("account_default"), hint("account_default"));
  if (usage.xdmcp_configured) add("protocol", badge("xdmcp_configured"), hint("xdmcp_configured"));
  if (usage.rdp_configured) add("protocol", badge("rdp_configured"), hint("rdp_configured"));
  if (usage.vnc_configured) add("protocol", badge("vnc_configured"), hint("vnc_configured"));
  if (usage.local_active) add("active", badge("local_active"), hint("local_active"));
  if (usage.xdmcp_active) add("active", badge("xdmcp_active"), hint("xdmcp_active"));
  if (usage.rdp_active) add("active", badge("rdp_active"), hint("rdp_active"));
  if (usage.remote_active && !usage.xdmcp_active && !usage.rdp_active) add("active", badge("remote_active"), hint("remote_active"));
  if (usage.vnc_shared) add("active", badge("vnc_shared"), hint("vnc_shared"));
  if (usage.vnc_virtual_active) add("active", badge("vnc_virtual_active"), hint("vnc_virtual_active"));
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
    ? tr("remote:linux_desktop.not_installed", {defaultValue:"未安装"})
    : sharedVnc.length
      ? tr("remote:linux_desktop.shared_session", {desktop:sharedLabels.length ? sharedLabels.join(" / ") : tr("remote:linux_desktop.desktop_unknown", {defaultValue:"桌面未知"}), defaultValue:`共享当前会话 · ${sharedLabels.length ? sharedLabels.join(" / ") : "桌面未知"}`})
      : virtualVnc.length
        ? virtualLabels.length ? tr("remote:linux_desktop.virtual_session", {desktop:virtualLabels.join(" / "), defaultValue:`虚拟会话 · ${virtualLabels.join(" / ")}`}) : tr("remote:linux_desktop.virtual_session_configured", {defaultValue:"虚拟会话 · 桌面由登录/启动配置决定"})
        : selection.vnc?.state === "configured"
          ? tr("remote:linux_desktop.configured_not_running", {desktop:sessionLabel(selection.vnc, tr("remote:linux_desktop.configured", {defaultValue:"已配置"})), defaultValue:`${sessionLabel(selection.vnc, "已配置")} · 尚未运行`})
          : tr("remote:linux_desktop.choose_at_login", {defaultValue:"登录/启动时选择"});
  const items = [
    ["settings-2", tr("remote:linux_desktop.system_default", {defaultValue:"系统默认"}), sessionLabel(selection.system_default, tr("sftp:auto.unknown", {defaultValue:"未知"}))],
    ["user-round", tr("remote:linux_desktop.account_default", {defaultValue:"账号默认"}), sessionLabel(selection.account_default, tr("remote:linux_desktop.choose_at_login", {defaultValue:"登录时选择"}))],
    ["panels-top-left", "XDMCP", selection.xdmcp?.state === "disabled" ? tr("remote:linux_desktop.not_enabled", {defaultValue:"未启用"}) : sessionLabel(selection.xdmcp, tr("remote:linux_desktop.choose_at_login", {defaultValue:"登录时选择"}))],
    ["monitor", "RDP", selection.rdp?.state === "not-installed" ? tr("remote:linux_desktop.not_installed", {defaultValue:"未安装"}) : sessionLabel(selection.rdp, tr("sftp:auto.unknown", {defaultValue:"未知"}))],
    ["radio-tower", "VNC", vncValue],
    ["activity", tr("remote:linux_desktop.current_graphical_session", {defaultValue:"当前图形会话"}), activeGraphical.length ? activeLabels.length ? activeLabels.join(" / ") : tr("remote:linux_desktop.active_unknown", {defaultValue:"活动中 · 桌面未知"}) : tr("remote:linux_desktop.not_detected", {defaultValue:"未检测到"})]
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
  const diagnosticsStructuredIssues = Array.isArray(diagnosticsError?.issues) && typeof localizedConnectionExtraArgsError === "function"
    ? localizedConnectionExtraArgsError(diagnosticsError.issues)
    : "";
  const diagnosticsErrorText = diagnosticsStructuredIssues || (diagnosticsError
    ? (typeof localizedTermaUiPhrase === "function"
      ? localizedTermaUiPhrase(diagnosticsError.message || tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"}))
      : (diagnosticsError.message || tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"})))
    : "");
  const loading = Boolean(state.loading);
  const connection = currentConnection(selected);
  const catalog = diagnostics?.desktop_catalog || ["xfce", "gnome", "plasma", "mate", "cinnamon", "lxqt"].map(id => ({id}));
  const installed = new Set((diagnostics?.desktops || []).map(item => item.id));
  const installable = new Set(diagnostics?.installable_desktops || []);
  const platformSupported = diagnostics?.platform_supported !== false;
  const macos = diagnostics?.os_id === "macos" || state.sshX11?.platform === "macos";
  const actionKey = linuxDesktopActionKey(selected);
  const taskRunning = linuxDesktopTaskInProgress(state.task);
  const managerTitle = macos
    ? tr("remote:linux_desktop.macos_title", {defaultValue:"macOS X11 管理"})
    : tr("remote:linux_desktop.title", {defaultValue:"Linux 桌面管理"});
  const managerSubtitle = macos
    ? tr("remote:linux_desktop.macos_subtitle", {defaultValue:"探测远端 XQuartz、xauth 和 SSH X11 转发，并提供交互式安装与配置入口。"})
    : tr("remote:linux_desktop.subtitle", {defaultValue:"选择 SSH 主机后，探测并安装可用于 RDP、VNC 和 XDMCP 的图形桌面。"});
  const hostLabel = connection?.name || tr("common:x11.remote_host", {defaultValue:"SSH 主机"});
  const emptyProbeText = loading
    ? tr("remote:linux_desktop.detecting_host", {host:hostLabel, defaultValue:`正在探测 ${hostLabel} 的系统、桌面与 X11 状态...`})
    : selected
      ? tr("remote:linux_desktop.preparing", {defaultValue:"正在准备探测..."})
      : tr("remote:linux_desktop.select_to_detect", {defaultValue:"请选择一个 SSH 主机开始探测。"});
  const detectButtonLabel = loading
    ? tr("remote:linux_desktop.detecting", {defaultValue:"探测中..."})
    : tr("remote:linux_desktop.detect_again", {defaultValue:"重新探测"});
  const managerHint = platformSupported
    ? tr("remote:linux_desktop.hint", {defaultValue:"远程桌面不要求服务器连接物理显示器。RDP、XDMCP 和虚拟 VNC 需要远端能启动桌面会话；x11vnc/wayvnc 共享已有会话；SSH X11 单程序不需要完整桌面。配置标记不等于正在运行，只有“当前会话”或“VNC 会话”标记代表已探测到活动会话。"})
    : macos
      ? tr("remote:linux_desktop.macos_hint", {defaultValue:"macOS 不安装 Linux 桌面环境。请使用上方的“安装远端 XQuartz”和“在终端开启 X11 转发”；出现 sudo 提示时输入远端 macOS 账号密码。"})
      : tr("remote:linux_desktop.unsupported_hint", {defaultValue:"当前 SSH 主机不是 Linux，不能在此主机上安装 Linux 桌面环境。"});
  view.innerHTML = `<div class="linux-desktop-manager remote-desktop-launch">
    <div class="remote-desktop-icon">${icon("monitor-cog")}</div>
    <h2>${esc(managerTitle)}</h2>
    <div class="muted">${esc(managerSubtitle)}</div>
    <div class="linux-desktop-manager-toolbar"><label>${esc(tr("remote:linux_desktop.management_connection", {defaultValue:"SSH 管理连接"}))}<select id="linuxDesktopConnection" onchange="selectLinuxDesktopManagerConnection(this.value)" ${loading ? "disabled" : ""}><option value="0">${esc(tr("remote:linux_desktop.select_host", {defaultValue:"请选择 SSH 主机"}))}</option>${linuxDesktopManagerConnectionOptions(selected)}</select></label><button type="button" onclick="loadLinuxDesktopManager()" ${selected && !loading ? "" : "disabled"}>${icon(loading ? "loader-circle" : "refresh-cw")}<span>${esc(detectButtonLabel)}</span></button></div>
    ${selected && diagnostics ? `<div class="linux-desktop-diagnostics ${macos ? state.sshX11?.ready ? "ready" : "warning" : diagnostics.has_desktop ? "ready" : "warning"}"><div><strong>${esc(diagnostics.connection?.name || tr("common:x11.remote_host", {defaultValue:"SSH 主机"}))}</strong><span>${macos ? esc(tr("remote:linux_desktop.macos_x11_environment", {defaultValue:"macOS · SSH X11 graphical environment"})) : `${esc(diagnostics.os_id || "Linux")} · ${esc(diagnostics.package_manager || tr("remote:linux_desktop.unknown_package_manager", {defaultValue:"未识别包管理器"}))} · ${esc(diagnostics.display_manager || tr("remote:linux_desktop.unknown_display_manager", {defaultValue:"未识别显示管理器"}))}`}</span></div><span class="status-pill">${macos ? state.sshX11?.ready ? esc(tr("remote:linux_desktop.x11_ready", {defaultValue:"X11 已就绪"})) : state.sshX11?.xquartz_installed ? esc(tr("remote:linux_desktop.xquartz_config_pending", {defaultValue:"XQuartz 已安装，配置未完成"})) : esc(tr("remote:linux_desktop.xquartz_missing", {defaultValue:"未安装 XQuartz"})) : diagnostics.has_desktop ? esc(tr("remote:linux_desktop.desktop_count", {count:diagnostics.desktops.length, defaultValue:`已发现 ${diagnostics.desktops.length} 个桌面`})) : esc(tr("remote:linux_desktop.no_desktop", {defaultValue:"未检测到图形桌面"}))}</span></div>
      ${platformSupported ? `${renderLinuxDesktopSelectionSummary(diagnostics)}<div class="linux-desktop-grid">${catalog.map(item => { const id = item.id; const available = installable.has(id); const isInstalled = installed.has(id); const enabled = (isInstalled || available) && !taskRunning; const statusLabel = isInstalled ? tr("remote:linux_desktop.installed_available", {defaultValue:"已安装，可用于图形会话"}) : available ? tr("remote:linux_desktop.auto_installable", {defaultValue:"可自动安装"}) : tr("remote:linux_desktop.no_auto_plan", {defaultValue:"当前包管理器未提供自动方案"}); const actionLabel = isInstalled ? tr("common:actions.remove", {defaultValue:"卸载"}) : tr("common:actions.install", {defaultValue:"安装"}); return `<article class="linux-desktop-card ${isInstalled ? "installed" : ""}" data-desktop-id="${escAttr(id)}"><div class="linux-desktop-card-icon">${icon(item.icon || "monitor")}</div><div><strong>${esc(item.label || linuxDesktopLabel(id))}</strong><span>${esc(statusLabel)}</span>${isInstalled ? renderLinuxDesktopUsageBadges(diagnostics, id) : ""}</div><button type="button" data-ui-action-key="${escAttr(actionKey)}" class="${enabled && !isInstalled ? "primary" : ""}" onclick="${isInstalled ? `uninstallLinuxDesktop('${escAttr(id)}',this)` : `installLinuxDesktop('${escAttr(id)}')`}" ${enabled ? "" : "disabled"}>${icon(isInstalled ? "trash-2" : "package-plus")}<span>${esc(actionLabel)}</span></button></article>`; }).join("")}</div>` : ""}
      ${renderSshX11ForwardingPanel(connection, state.sshX11, "linux-desktop")}
      <div class="linux-desktop-hint">${esc(managerHint)}</div>` : selected && diagnosticsError ? `<div class="connection-test-status remote-diagnostic-status error"><span class="remote-diagnostic-icon">${icon("circle-alert")}</span><span class="remote-diagnostic-copy">${esc(diagnosticsErrorText)}</span>${diagnosticsAuthFailed ? `<span class="remote-diagnostic-actions"><button type="button" data-action="linux-desktop-credential-repair" data-connection-id="${selected}">${icon("key-round")}<span>${esc(tr("common:actions.repair_credentials", {defaultValue:"修复 SSH 凭据"}))}</span></button></span>` : ""}</div>` : `<div class="connection-test-status ${loading ? "busy remote-probe-loading" : ""}">${loading ? icon("loader-circle") : ""}<span>${esc(emptyProbeText)}</span></div>`}
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
        error:error.message || tr("common:notifications.exact.x11_config_probe_failed", {defaultValue:"SSH X11 配置探测失败"}),
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
      message:error.message || tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"}),
      code:error.code || "",
      issues:Array.isArray(error?.details?.issues) ? error.details.issues : Array.isArray(error?.issues) ? error.issues : [],
      connectionId:Number(error.connectionId || id)
    };
    linuxDesktopManagerState.loading = false;
    renderLinuxDesktopManager();
    const structuredError = typeof localizedConnectionExtraArgsError === "function" ? localizedConnectionExtraArgsError(linuxDesktopManagerState.error.issues) : "";
    notify(structuredError || (typeof localizedTermaUiPhrase === "function"
      ? localizedTermaUiPhrase(error.message || tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"}))
      : (error.message || tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"}))), "error");
  }
}

async function repairLinuxDesktopCredentials(connectionId) {
  const id = Number(connectionId || linuxDesktopManagerState.connectionId || 0);
  if (typeof repairSshCredentials !== "function" || id < 1) return false;
  return repairSshCredentials(id, {
    context:tr("common:notifications.exact.linux_desktop_probe_failed", {defaultValue:"Linux 桌面探测失败"}),
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
  const actionLabel = task.action === "uninstall"
    ? tr("remote:linux_desktop.action_uninstall", {defaultValue:"卸载"})
    : tr("remote:linux_desktop.action_install", {defaultValue:"安装"});
  const stateLabel = done
    ? tr("remote:linux_desktop.task_state_done", {defaultValue:"完成"})
    : failed
      ? tr("remote:linux_desktop.task_state_failed", {defaultValue:"失败"})
      : tr("remote:linux_desktop.task_state_running", {defaultValue:"中"});
  const desktopLabel = task.desktop_label || tr("remote:linux_desktop.desktop_generic", {defaultValue:"Linux 桌面"});
  const taskTitle = tr("remote:linux_desktop.task_title", {desktop:desktopLabel, action:actionLabel, state:stateLabel, defaultValue:`${desktopLabel}${actionLabel}${stateLabel}`});
  const taskStatus = done
    ? tr("common:auto.done", {defaultValue:"已完成"})
    : failed
      ? task.error || tr("remote:linux_desktop.task_failed", {action:actionLabel, defaultValue:`${actionLabel}失败`})
      : `${progress}%`;
  const viewLogLabel = tr("remote:linux_desktop.view_task_log", {action:actionLabel, defaultValue:`查看${actionLabel}日志`});
  container.innerHTML = `<div class="linux-desktop-task-head"><div><strong>${esc(taskTitle)}</strong><span>${esc(task.stage || "prepare")} · ${esc(taskStatus)}</span></div><button class="icon-button" onclick="toggleLinuxDesktopTaskLog()" title="${escAttr(viewLogLabel)}" aria-label="${escAttr(viewLogLabel)}">${icon("scroll-text")}</button></div><div class="linux-desktop-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><pre id="linuxDesktopTaskLog" data-task-id="${escAttr(logView.taskId)}" class="linux-desktop-task-log${logView.expanded ? " expanded" : ""}">${esc(logs.map(item => `[${new Date(item.at || Date.now()).toLocaleTimeString()}] ${item.stream === "stderr" || item.stream === "error" ? "! " : ""}${item.text || ""}`).join("\n"))}</pre>`;
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
  if (!plan) return notify(tr("remote:linux_desktop.no_install_plan", {defaultValue:"当前包管理器没有可用的桌面安装方案"}), "info");
  const label = linuxDesktopLabel(desktopId);
  const modal = $("modal");
  const packageManager = diagnostics.package_manager || tr("remote:linux_desktop.unknown_package_manager", {defaultValue:"未识别包管理器"});
  const steps = [
    tr("remote:linux_desktop.install_step_choose", {desktop:label, defaultValue:`选择一种方式安装 ${label}；在线安装要求远端可以访问软件源。`}),
    tr("remote:linux_desktop.install_step_local_offline", {defaultValue:"本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统：Terma 会解析依赖、下载匹配架构的软件包并通过 SFTP 上传。"}),
    tr("remote:linux_desktop.install_step_remote_cache", {defaultValue:"使用远端缓存不会访问软件源，只有远端缓存已经完整时才能成功。"}),
    tr("remote:linux_desktop.install_step_redetect", {defaultValue:"安装结束后 Terma 会重新探测桌面会话；RDP、VNC 或 XDMCP 仍需各自的服务端配置。"})
  ];
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  modal.innerHTML = `<div class="modal-card wide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="linuxDesktopInstallTitle">
    <div class="modal-title-row"><div><h2 id="linuxDesktopInstallTitle">${esc(tr("remote:linux_desktop.install_title", {desktop:label, defaultValue:`安装 ${label}`}))}</h2><span class="muted">${esc(diagnostics.connection?.name || tr("common:x11.remote_host", {defaultValue:"SSH 主机"}))} · ${esc(packageManager)}</span></div><button class="icon-button" type="button" onclick="closeRemoteInstallDialog()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
    <div class="connection-test-status warning">${esc(tr("remote:linux_desktop.install_warning", {defaultValue:"请选择安装方式。安装桌面可能下载较大的软件包，并可能影响正在运行的图形会话。"}))}</div>
    ${remoteInstallModesMarkup(plan, mode => `installLinuxDesktop('${escAttr(desktopId)}','${mode}',this)`, "revealRemoteInstallManual(this)", linuxDesktopActionKey(linuxDesktopManagerState.connectionId))}
    ${remoteInstallManualMarkup(plan, {steps, note:tr("remote:linux_desktop.install_offline_note", {defaultValue:"如果服务器和本机都不能联网，请先在另一台可联网设备上按发行版与架构下载完整软件包及依赖，再上传到远端并使用对应包管理器安装。"})})}
    <div class="actions"><button type="button" onclick="closeRemoteInstallDialog()">${esc(closeLabel)}</button></div>
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
  if (!id) return notify(tr("remote:linux_desktop.select_management_connection", {defaultValue:"请先选择 SSH 管理连接"}), "info");
  const actionKey = linuxDesktopActionKey(id);
  if (!mode) {
    if (isUiActionInFlight(actionKey)) return notify(tr("remote:linux_desktop.task_running", {defaultValue:"Linux 桌面任务正在执行，请等待完成"}), "info");
    return openLinuxDesktopInstallOptions(desktopId);
  }
  if (!beginUiAction(actionKey, button, tr("common:auto.installing", {defaultValue:"安装中..."}))) {
    notify(tr("remote:linux_desktop.task_running", {defaultValue:"Linux 桌面任务正在执行，请等待完成"}), "info");
    return null;
  }
  let handedOff = false;
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline"
    ? tr("remote:linux_desktop.mode_local_offline", {defaultValue:"本机下载后离线"})
    : normalizedMode === "offline"
      ? tr("remote:linux_desktop.mode_remote_cache", {defaultValue:"使用远端缓存"})
      : tr("remote:linux_desktop.mode_online", {defaultValue:"在线"});
  const desktopLabel = linuxDesktopLabel(desktopId);
  const message = normalizedMode === "local-offline"
    ? tr("remote:linux_desktop.confirm_local_offline", {desktop:desktopLabel, defaultValue:`Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载 ${desktopLabel} 及其依赖，通过 SFTP 上传后安装。是否继续？`})
    : normalizedMode === "offline"
      ? tr("remote:linux_desktop.confirm_remote_cache", {desktop:desktopLabel, defaultValue:`将只使用远端包管理器已经缓存的软件包安装 ${desktopLabel}，不会访问软件源。缓存不完整时安装会失败，是否继续？`})
      : tr("remote:linux_desktop.confirm_online", {desktop:desktopLabel, defaultValue:`将通过远端软件源在线安装 ${desktopLabel}。安装期间可能下载较大的软件包，是否继续？`});
  const operationTitle = tr("remote:linux_desktop.install_mode_title", {mode:modeLabel, defaultValue:`${modeLabel}安装 Linux 桌面`});
  try {
    if (!await confirmModal(message, operationTitle, tr("common:actions.install", {defaultValue:"安装"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return null;
    let adminAuth = null;
    if (!linuxDesktopManagerState.diagnostics?.privileged) {
      const grantScope = normalizedMode === "local-offline"
        ? "linux-desktop.install-local-offline"
        : normalizedMode === "offline"
          ? "linux-desktop.install-offline"
          : "linux-desktop.install";
      adminAuth = await requestRemoteAdminAuthorization(id, operationTitle, grantScope);
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
    notify(error.message || tr("remote:linux_desktop.install_start_failed", {mode:modeLabel, defaultValue:`${modeLabel}安装 Linux 桌面启动失败`}), "error");
    return null;
  } finally {
    if (!handedOff) endUiAction(actionKey, button);
  }
}

async function uninstallLinuxDesktop(desktopId, button=null) {
  const id = Number(linuxDesktopManagerState.connectionId || 0);
  if (!id) return notify(tr("remote:linux_desktop.select_management_connection", {defaultValue:"请先选择 SSH 管理连接"}), "info");
  const actionKey = linuxDesktopActionKey(id);
  if (!beginUiAction(actionKey, button, tr("common:auto.uninstalling", {defaultValue:"卸载中..."}))) {
    notify(tr("remote:linux_desktop.task_running", {defaultValue:"Linux 桌面任务正在执行，请等待完成"}), "info");
    return null;
  }
  let handedOff = false;
  const label = linuxDesktopLabel(desktopId);
  try {
    if (!await confirmModal(
      tr("remote:linux_desktop.uninstall_confirm", {desktop:label, defaultValue:`将通过 SSH 卸载 ${label} 的桌面组件。可能影响现有图形登录、RDP、VNC 或 XDMCP 会话，是否继续？`}),
      tr("remote:linux_desktop.uninstall_title", {defaultValue:"卸载 Linux 桌面"}),
      tr("common:actions.remove", {defaultValue:"卸载"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    let adminAuth = null;
    if (!linuxDesktopManagerState.diagnostics?.privileged) {
      adminAuth = await requestRemoteAdminAuthorization(
        id,
        tr("remote:linux_desktop.uninstall_title", {defaultValue:"卸载 Linux 桌面"}),
        "linux-desktop.uninstall"
      );
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
    notify(error.message || tr("remote:linux_desktop.uninstall_start_failed", {defaultValue:"Linux 桌面卸载启动失败"}), "error");
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
  if (!isUiActionInFlight(actionKey)) beginUiAction(actionKey, button, tr("remote:linux_desktop.task_in_progress", {defaultValue:"任务进行中..."}));
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
          const actionLabel = task.action === "uninstall"
            ? tr("remote:linux_desktop.action_uninstall", {defaultValue:"卸载"})
            : tr("remote:linux_desktop.action_install", {defaultValue:"安装"});
          notify(tr("remote:linux_desktop.task_complete_redetect", {action:actionLabel, defaultValue:`Linux 桌面${actionLabel}完成，正在重新探测`}), "success");
          linuxDesktopManagerState.taskId = "";
          await loadLinuxDesktopManager();
        } else if (visible(task)) {
          linuxDesktopManagerState.taskId = "";
          renderLinuxDesktopManager();
          const actionLabel = task.action === "uninstall"
            ? tr("remote:linux_desktop.action_uninstall", {defaultValue:"卸载"})
            : tr("remote:linux_desktop.action_install", {defaultValue:"安装"});
          notify(task.status === "cancelled"
            ? tr("remote:linux_desktop.task_cancelled", {action:actionLabel, defaultValue:`Linux 桌面${actionLabel}已取消`})
            : task.error || tr("remote:linux_desktop.task_operation_failed", {action:actionLabel, defaultValue:`Linux 桌面${actionLabel}失败`}), task.status === "cancelled" ? "info" : "error");
        }
        finish(task);
        return;
      }
      monitor.timer = setTimeout(poll, 900);
    } catch (error) {
      if (String(linuxDesktopManagerState.taskId || "") === id) notify(error.message || tr("remote:linux_desktop.task_log_read_failed", {defaultValue:"读取桌面管理日志失败"}), "error");
      finish(null);
    }
  };
  void poll();
  return completion;
}
