const REMOTE_PROTOCOL_META = {
  rdp:{label:"RDP", icon:"monitor-up", port:3389},
  vnc:{label:"VNC", icon:"monitor", port:5900},
  xdmcp:{label:"XDMCP", icon:"panels-top-left", port:177},
  ftp:{label:"FTP", icon:"folder-sync", port:21},
  telnet:{label:"Telnet", icon:"square-terminal", port:23},
  serial:{label:"Serial", icon:"usb", port:0}
};

function remoteProtocolLabel(protocol) {
  const value = String(protocol || "").toLowerCase();
  const fallback = REMOTE_PROTOCOL_META[value]?.label || value.toUpperCase();
  return value === "serial" ? tr("remote:auto.serial", {defaultValue:fallback}) : fallback;
}

function remoteProtocolAction(protocol) {
  const value = String(protocol || "").toLowerCase();
  if (["rdp", "vnc"].includes(value)) return tr("remote:actions.open_remote_desktop", {defaultValue:"打开远程桌面"});
  if (value === "xdmcp") return tr("remote:actions.open_graphical_desktop", {defaultValue:"打开图形桌面"});
  if (value === "ftp") return tr("remote:actions.open_files", {defaultValue:"打开文件"});
  return tr("remote:actions.open_terminal", {defaultValue:"打开终端"});
}

function remoteOpenProfileLabel(profile) {
  return tr("remote:actions.open_profile", {
    protocol:remoteProtocolLabel(profile?.protocol),
    name:profile?.name || "",
    defaultValue:`打开 ${remoteProtocolLabel(profile?.protocol)} · ${profile?.name || ""}`
  });
}
const remoteTerminalSessions = new Map();
const remoteTerminalCounts = new Map();
const ftpProfileStates = new Map();
const vncSessions = new Map();
let vncFullscreenSessionKey = "";
let remoteDesktopRenderSerial = 0;
const VNC_CLIPBOARD_POLL_INTERVAL_MS = 900;
const VNC_CLIPBOARD_LOCAL_IMAGE_POLL_INTERVAL_MS = 5000;
const VNC_CLIPBOARD_REMOTE_IMAGE_POLL_INTERVAL_MS = 3000;
const VNC_CLIPBOARD_IMAGE_INPUT_IDLE_MS = 1400;
const VNC_CLIPBOARD_ECHO_GUARD_MS = 3000;
const remoteAdminGrantCache = new Map();
let noVncRfbPromise = null;
let xdmcpProgressTimer = null;
let linuxDesktopManagerState = {connectionId:0, diagnostics:null, sshX11:null, error:null, taskId:"", task:null, logs:[]};
let linuxDesktopTaskLogView = {taskId:"", expanded:false, follow:true, scrollTop:0};
const linuxDesktopTaskMonitors = new Map();
let pendingRemoteGroupSelectValue = "默认分组";

function vncQuickOpenUsesNewWindow() {
  return runtimeSettings?.saved?.vnc_quick_open_new_window !== false;
}

function rdpServerActionKey(profileId) {
  return `rdp-server:${Number(profileId || 0)}`;
}

function vncServerActionKey(profileId) {
  return `vnc-server:${Number(profileId || 0)}`;
}

function xdmcpServerActionKey(profileId) {
  return `xdmcp-server:${Number(profileId || 0)}`;
}

function x11ComponentsActionKey(connectionId) {
  return `x11-components:${Number(connectionId || 0)}`;
}

function x11ForwardingActionKey(connectionId) {
  return `x11-forwarding:${Number(connectionId || 0)}`;
}

function vncClipboardHelperActionKey(profileId) {
  return `vnc-clipboard-helper:${Number(profileId || 0)}`;
}

function linuxDesktopActionKey(connectionId) {
  return `linux-desktop:${Number(connectionId || 0)}`;
}

function remoteProfileById(id) {
  return remoteProfiles.find(item => Number(item.id) === Number(id));
}

function matchingRemoteProfile(profile, protocol) {
  const host = normalizeRemoteHost(profile?.host);
  if (!host) return null;
  return remoteProfiles.find(item => item.protocol === protocol
    && normalizeRemoteHost(item.host) === host) || null;
}

function normalizeRemoteHost(value="") {
  let host = String(value || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (host.startsWith("::ffff:")) host = host.slice(7);
  return host;
}

function remoteProfilesForSshConnection(connection) {
  if (!connection) return [];
  const host = normalizeRemoteHost(connection.ssh_host);
  if (!host) return [];
  return remoteProfiles.filter(profile => {
    if (profile.protocol === "serial") return false;
    const profileHost = normalizeRemoteHost(profile.host);
    return profileHost === host;
  });
}

function remoteDesktopProfilesForSshConnection(connectionId) {
  const connection = currentConnection(connectionId);
  return remoteProfilesForSshConnection(connection)
    .filter(profile => ["rdp", "vnc", "xdmcp"].includes(String(profile.protocol || "").toLowerCase()));
}

function openRemoteDesktopJumpMenu(event, connectionId) {
  const profiles = remoteDesktopProfilesForSshConnection(connectionId);
  if (!profiles.length) {
    notify(tr("remote:management.no_linked_desktop", {defaultValue:"当前 SSH 连接没有关联的远程桌面连接"}), "info");
    return;
  }
  if (profiles.length === 1) {
    openRemoteProfile(profiles[0]);
    return;
  }
  showActionMenu(event, profiles.map(profile => ({
    label:remoteOpenProfileLabel(profile),
    icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-up",
    run:() => openRemoteProfile(profile)
  })));
}

function remoteDesktopJumpButtonHtml(connectionId) {
  const profiles = remoteDesktopProfilesForSshConnection(connectionId);
  if (!profiles.length) return "";
  const title = profiles.length === 1
    ? tr("remote:actions.open_named_desktop", {name:profiles[0].name, defaultValue:`打开远程桌面：${profiles[0].name}`})
    : tr("remote:actions.open_linked_desktops", {count:profiles.length, defaultValue:`打开关联远程桌面（${profiles.length} 个）`});
  const handler = profiles.length === 1
    ? `openRemoteProfile(remoteProfileById(${Number(profiles[0].id)}))`
    : `openRemoteDesktopJumpMenu(event,${Number(connectionId)})`;
  return `<button class="icon-button workspace-jump-button remote-desktop-jump-button" type="button" title="${escAttr(title)}" aria-label="${escAttr(title)}" onclick="${handler}">${icon("monitor-up")}</button>`;
}

function remoteDesktopProfilesForProfile(profile) {
  if (!profile) return [];
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  const host = normalizeRemoteHost(profile.host);
  return remoteProfiles.filter(candidate => {
    if (!["rdp", "vnc", "xdmcp"].includes(String(candidate.protocol || "").toLowerCase())) return false;
    if (connectionId) return linuxDesktopManagerConnectionIdForProfile(candidate) === connectionId;
    return Boolean(host) && normalizeRemoteHost(candidate.host) === host;
  });
}

function remoteDesktopSwitchProfiles(profileId) {
  const current = remoteProfileById(profileId);
  return remoteDesktopProfilesForProfile(current)
    .filter(profile => Number(profile.id) !== Number(profileId));
}

function openRemoteDesktopSwitchMenu(event, profileId) {
  const profiles = remoteDesktopSwitchProfiles(profileId);
  if (!profiles.length) return;
  showActionMenu(event, profiles.map(profile => ({
    label:remoteOpenProfileLabel(profile),
    icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-up",
    run:() => openRemoteProfile(profile)
  })));
}

function remoteDesktopSwitchButtonHtml(profile) {
  const profiles = remoteDesktopSwitchProfiles(profile?.id);
  const disabled = !profiles.length;
  const title = disabled
    ? tr("remote:actions.no_other_desktops", {defaultValue:"当前服务器没有其他远程桌面"})
    : tr("remote:actions.switch_other_desktops", {count:profiles.length, defaultValue:`切换到当前服务器的其他远程桌面（${profiles.length} 个）`});
  const handler = disabled ? "" : ` onclick="openRemoteDesktopSwitchMenu(event,${Number(profile?.id || 0)})"`;
  return `<button class="icon-button workspace-jump-button remote-desktop-switch-button" type="button" title="${escAttr(title)}" aria-label="${escAttr(title)}"${handler} ${disabled ? "disabled" : ""}>${icon("monitor-up")}</button>`;
}

function remoteWorkspaceJumpButtonsHtml(profile) {
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  const remoteSwitch = remoteDesktopSwitchButtonHtml(profile);
  if (!connectionId && !remoteSwitch) return "";
  const linkedWorkspace = tr("remote:actions.linked_workspace", {defaultValue:"关联工作区"});
  const linkedTerminal = tr("remote:actions.open_linked_terminal", {defaultValue:"打开关联终端"});
  const linkedSftp = tr("remote:actions.open_linked_sftp", {defaultValue:"打开关联 SFTP"});
  return `<span class="workspace-jump-actions" aria-label="${escAttr(linkedWorkspace)}">
    ${connectionId ? `<button class="icon-button workspace-jump-button" type="button" title="${escAttr(linkedTerminal)}" aria-label="${escAttr(linkedTerminal)}" onclick="openTerminal(${connectionId})">${icon("square-terminal")}</button>` : ""}
    ${connectionId ? `<button class="icon-button workspace-jump-button" type="button" title="${escAttr(linkedSftp)}" aria-label="${escAttr(linkedSftp)}" onclick="openSftp(${connectionId})">${icon("folder-open")}</button>` : ""}
    ${remoteSwitch}
  </span>`;
}

function openRemoteProfile(profile, options={}) {
  if (!profile) return;
  if (["rdp", "vnc", "xdmcp"].includes(profile.protocol)) return openRemoteDesktop(profile.id, true, false, options);
  if (profile.protocol === "ftp") return openFtpProfile(profile.id);
  return openRemoteTerminal(profile.id);
}

function remoteProfileOpenActionsForSsh(connectionId) {
  const connection = currentConnection(connectionId);
  return remoteProfilesForSshConnection(connection).map(profile => ({
    label:remoteOpenProfileLabel(profile),
    icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "plug",
    run:()=>openRemoteProfile(profile)
  }));
}

function filteredRemoteProfiles() {
  const query = String(remoteConnectionSearch || "").trim().toLowerCase();
  if (!query) return remoteProfiles;
  return remoteProfiles.filter(profile => [
    profile.name, profile.group_name, profile.tags, profile.protocol, profile.host, profile.port,
    profile.username, profile.options?.path
  ].some(value => String(value ?? "").toLowerCase().includes(query)));
}

function setRemoteConnectionSearch(value) {
  remoteConnectionSearch = value || "";
  localStorage.setItem("remoteConnectionSearch", remoteConnectionSearch);
  renderConnections();
}

function remoteProfileEndpoint(profile) {
  if (profile.protocol === "serial") return profile.options?.path || tr("remote:management.serial_not_selected", {defaultValue:"未选择串口"});
  if (profile.protocol === "xdmcp" && profile.options?.mode === "broadcast") return tr("remote:management.lan_broadcast_endpoint", {port:profile.port || 177, defaultValue:`局域网广播:${profile.port || 177}`});
  const user = profile.username ? `${profile.username}@` : "";
  const rawHost = String(profile.host || "").trim();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return `${user}${displayHost}:${profile.port}`;
}

async function inspectLinuxDesktopForRemoteProfile(profile) {
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!connectionId) return null;
  try {
    return await api(`/api/connections/${connectionId}/linux-desktop`);
  } catch {
    return null;
  }
}

function linuxDesktopMissingNotice(profile, diagnostics) {
  const positivelyLinux = diagnostics?.platform === "linux" || diagnostics?.os_id === "linux" || (diagnostics?.platform_supported === true && Boolean(diagnostics?.connection || diagnostics?.ssh_connection));
  if (!diagnostics || !positivelyLinux || diagnostics.has_desktop || !["rdp", "vnc", "xdmcp"].includes(profile?.protocol)) return "";
  const id = Number(profile.id || 0);
  const protocol = String(profile.protocol || "").toUpperCase();
  return `<div class="connection-test-status warning linux-desktop-missing-notice">${icon("monitor-off")}<span>${esc(tr("remote:diagnostics.linux_desktop_missing", {protocol, defaultValue:`未检测到可用的 Linux 图形桌面，${protocol} 可能无法登录。`}))}</span><button type="button" onclick="openLinuxDesktopManagerForProfile(${id})">${icon("monitor-cog")}<span>${esc(tr("remote:diagnostics.open_linux_desktop_manager", {defaultValue:"前往 Linux 桌面管理"}))}</span></button></div>`;
}

function remoteDiagnosticStatusMarkup(message, options={}) {
  const tone = options.tone || "warning";
  const statusIcon = options.icon || (tone === "error" ? "circle-alert" : tone === "success" ? "circle-check" : "info");
  const title = String(options.title || "").trim();
  const actions = String(options.actions || "").trim();
  return `<div class="connection-test-status remote-diagnostic-status ${escAttr(tone)}"><span class="remote-diagnostic-icon">${icon(statusIcon)}</span><span class="remote-diagnostic-copy">${title ? `<b>${esc(title)}</b>` : ""}<span>${esc(message || "")}</span></span>${actions ? `<span class="remote-diagnostic-actions">${actions}</span>` : ""}</div>`;
}

function remoteEndpointProbeRequestFailure(error, method="tcp") {
  const normalizedMethod = method === "xdmcp-query" ? "xdmcp-query" : "tcp";
  const rawError = error?.preserveMessage === true || !error?.publicCode
    ? String(error?.message || "")
    : "";
  return {
    supported:true,
    method:normalizedMethod,
    ok:false,
    ...(normalizedMethod === "xdmcp-query" ? {responded:false, response:""} : {}),
    reason_code:"probe_request_failed",
    reason_params:{},
    raw_error:rawError,
    error:rawError
  };
}

function remoteEndpointProbeReason(probe={}) {
  const code = String(probe?.reason_code || "").trim();
  const params = probe?.reason_params && typeof probe.reason_params === "object" && !Array.isArray(probe.reason_params)
    ? probe.reason_params
    : {};
  let reason = "";
  switch (code) {
    case "tcp_reachable": reason = tr("remote:endpoint_probe.reasons.tcp_reachable", {...params, defaultValue:"TCP connection succeeded"}); break;
    case "tcp_target_invalid": reason = tr("remote:endpoint_probe.reasons.tcp_target_invalid", {...params, defaultValue:"The TCP target is invalid"}); break;
    case "tcp_timeout": reason = tr("remote:endpoint_probe.reasons.tcp_timeout", {...params, defaultValue:"The TCP connection timed out"}); break;
    case "tcp_failed": reason = tr("remote:endpoint_probe.reasons.tcp_failed", {...params, defaultValue:"The TCP connection failed"}); break;
    case "probe_request_failed": reason = tr("remote:endpoint_probe.reasons.probe_request_failed", {...params, defaultValue:"The connectivity probe failed"}); break;
    case "xdmcp_target_invalid": reason = tr("remote:endpoint_probe.reasons.xdmcp_target_invalid", {...params, defaultValue:"The XDMCP target is invalid"}); break;
    case "host_resolution_failed": reason = tr("remote:endpoint_probe.reasons.host_resolution_failed", {...params, defaultValue:"Host name resolution failed"}); break;
    case "xdmcp_no_response": reason = tr("remote:endpoint_probe.reasons.xdmcp_no_response", {...params, defaultValue:"No XDMCP Query response was received"}); break;
    case "xdmcp_udp_failed": reason = tr("remote:endpoint_probe.reasons.xdmcp_udp_failed", {...params, defaultValue:"The XDMCP UDP probe failed"}); break;
    case "xdmcp_response_invalid": reason = tr("remote:endpoint_probe.reasons.xdmcp_response_invalid", {...params, defaultValue:"An invalid XDMCP response was received"}); break;
    case "xdmcp_version_unsupported": reason = tr("remote:endpoint_probe.reasons.xdmcp_version_unsupported", {...params, defaultValue:`Unsupported XDMCP version ${params.version ?? ""} was received`}); break;
    case "xdmcp_willing": reason = tr("remote:endpoint_probe.reasons.xdmcp_willing", {...params, defaultValue:"The XDMCP service accepts graphical logins"}); break;
    case "xdmcp_login_rejected": reason = tr("remote:endpoint_probe.reasons.xdmcp_login_rejected", {...params, defaultValue:"The XDMCP service responded but is not accepting graphical logins"}); break;
    case "xdmcp_opcode_unexpected": reason = tr("remote:endpoint_probe.reasons.xdmcp_opcode_unexpected", {...params, defaultValue:`Unexpected XDMCP response ${params.opcode ?? ""} was received`}); break;
    case "xdmcp_send_failed": reason = tr("remote:endpoint_probe.reasons.xdmcp_send_failed", {...params, defaultValue:"The XDMCP Query could not be sent"}); break;
    case "xdmcp_broadcast_probe_unsupported": reason = tr("remote:endpoint_probe.reasons.xdmcp_broadcast_probe_unsupported", {...params, defaultValue:"XDMCP broadcast mode cannot be probed as a single host"}); break;
    case "protocol_probe_unsupported": reason = tr("remote:endpoint_probe.reasons.protocol_probe_unsupported", {...params, defaultValue:`Port probing is not supported for ${params.protocol || "this protocol"}`}); break;
  }
  const rawError = String(probe?.raw_error || "").trim();
  const legacyError = code ? "" : String(probe?.error || "").trim();
  const detail = rawError || legacyError;
  if (reason && detail && reason !== detail) {
    return tr("remote:endpoint_probe.reason_with_detail", {reason, detail, defaultValue:`${reason}: ${detail}`});
  }
  return reason || detail;
}

function remoteEndpointProbeMarkup(profile, probe={}) {
  if (!probe?.supported) return "";
  const endpoint = remoteProfileEndpoint({
    protocol:profile?.protocol || probe.protocol,
    host:profile?.host || probe.host || "",
    port:profile?.port || probe.port || "",
    username:"",
    options:profile?.options || {}
  });
  if (probe.method === "xdmcp-query") {
    const willing = probe.ok && probe.response === "willing";
    const responded = Boolean(probe.responded);
    const error = remoteEndpointProbeReason(probe) || tr("remote:endpoint_probe.service_rejected", {defaultValue:"Service rejected the request"});
    return remoteDiagnosticStatusMarkup(
      willing
        ? tr("remote:endpoint_probe.xdmcp_willing", {endpoint, defaultValue:`已从 Terma 主机收到 ${endpoint} 的 XDMCP WILLING 响应，可新建图形登录。`})
        : responded
          ? tr("remote:endpoint_probe.xdmcp_rejected", {endpoint, error, defaultValue:`${endpoint} 已返回 XDMCP 响应，但当前不接受图形登录（${error}）。`})
          : tr("remote:endpoint_probe.xdmcp_no_response", {endpoint, error:error || tr("remote:endpoint_probe.udp_no_response", {defaultValue:"No UDP response"}), defaultValue:`${endpoint} did not return an XDMCP Query response (${error || "no UDP response"}). A UDP firewall or service policy may discard probes; you can still try a graphical login directly.`}),
      {
        tone:willing ? "success" : responded ? "error" : "warning",
        icon:willing ? "radio-tower" : responded ? "circle-x" : "circle-help",
        title:tr(willing ? "remote:endpoint_probe.xdmcp_title_willing" : responded ? "remote:endpoint_probe.xdmcp_title_rejected" : "remote:endpoint_probe.xdmcp_title_no_response", {
          defaultValue:willing ? "XDMCP 服务已响应" : responded ? "XDMCP 服务拒绝登录" : "未收到 XDMCP 响应"
        })
      }
    );
  }
  const protocol = String(profile?.protocol || probe.protocol || "").toUpperCase();
  const error = remoteEndpointProbeReason(probe) || tr("remote:endpoint_probe.port_unreachable", {defaultValue:"Port unreachable"});
  return remoteDiagnosticStatusMarkup(
    probe.ok
      ? tr("remote:endpoint_probe.reachable", {endpoint, defaultValue:`已从 Terma 主机直连 ${endpoint}；可按协议启动客户端，SSH 仅用于 Linux 服务管理和深度诊断。`})
      : tr("remote:endpoint_probe.unreachable", {endpoint, error, defaultValue:`无法从 Terma 主机连接 ${endpoint}（${error}）。请检查服务、防火墙和网络路由。`}),
    {
      tone:probe.ok ? "success" : "error",
      icon:probe.ok ? "radio-tower" : "unplug",
      title:tr(probe.ok ? "remote:endpoint_probe.title_reachable" : "remote:endpoint_probe.title_unreachable", {
        protocol,
        defaultValue:probe.ok ? `${protocol} 端口可达` : `${protocol} 端口不可达`
      })
    }
  );
}

function localizedRemoteClientLabel(value="", protocol="") {
  const raw = String(value || "").trim();
  const labels = {
    "远程桌面连接":["remote:clients.windows_remote_desktop", "Windows 远程桌面连接"],
    "屏幕共享":["remote:clients.macos_screen_sharing", "macOS 屏幕共享"],
    "系统 VNC 客户端":["remote:clients.system_vnc", "系统 VNC 客户端"],
    "Terma 内置 VNC":["remote:clients.terma_embedded_vnc", "Terma 内置 VNC"],
    "Terma 内置 X Server":["remote:clients.terma_embedded_xserver", "Terma 内置 X Server"],
    "Terma 内置 XDMCP（XQuartz）":["remote:clients.terma_embedded_xdmcp_xquartz", "Terma 内置 XDMCP（XQuartz）"],
    "Terma XDMCP（Xephyr）":["remote:clients.terma_xdmcp_xephyr", "Terma XDMCP（Xephyr）"]
  };
  const localized = labels[raw];
  if (localized) return tr(localized[0], {defaultValue:localized[1]});
  return raw || (typeof remoteProtocolLabel === "function" ? remoteProtocolLabel(protocol) : String(protocol || "").toUpperCase());
}

function localizedRemoteClientInstallLabel(value="", protocol="") {
  const raw = String(value || "").trim();
  const labels = {
    "安装 Windows App":["remote:clients.install_windows_app", "安装 Windows App"],
    "安装 FreeRDP":["remote:clients.install_freerdp", "安装 FreeRDP"],
    "安装 XQuartz":["remote:clients.install_xquartz", "安装 XQuartz"],
    "安装 Xephyr":["remote:clients.install_xephyr", "安装 Xephyr"]
  };
  const localized = labels[raw];
  if (localized) return tr(localized[0], {defaultValue:localized[1]});
  if (raw) return raw;
  const protocolLabel = typeof remoteProtocolLabel === "function" ? remoteProtocolLabel(protocol) : String(protocol || "").toUpperCase();
  return tr("remote:auto.install_client_for", {protocol:protocolLabel, defaultValue:`安装 ${protocolLabel} 客户端`});
}

function localizedRemoteClientReason(item={}, diagnostics={}, protocol="") {
  const raw = String(item?.reason || diagnostics?.message || "").trim();
  const protocolLabel = typeof remoteProtocolLabel === "function" ? remoteProtocolLabel(protocol) : String(protocol || "").toUpperCase();
  if (diagnostics?.authorization_required) {
    return tr("remote:clients.authorization_required", {protocol:protocolLabel, defaultValue:`${protocolLabel} 客户端需要临时桌面集成授权。`});
  }
  if (item?.reason_code === "vnc_client_selection_required") {
    return tr("remote:clients.reason_vnc_selection_required", {defaultValue:"未找到系统 VNC 客户端；打开连接时请选择 VNC Viewer 程序"});
  }
  const reasons = {
    "未找到 FreeRDP 或 Remmina":["remote:clients.reason_rdp_missing", "未找到 FreeRDP 或 Remmina"],
    "当前 Terma 没有可用的图形桌面 DISPLAY":["remote:clients.reason_display_missing", "当前 Terma 没有可用的图形桌面 DISPLAY"],
    "未找到系统 VNC 客户端":["remote:clients.reason_vnc_missing", "未找到系统 VNC 客户端"],
    "未检测到可用的 XDMCP X Server":["remote:clients.reason_xdmcp_xserver_missing", "未检测到可用的 XDMCP X Server"],
    "未检测到 VcXsrv、Xming、X410 或 DISPLAY":["remote:clients.reason_windows_xserver_missing", "未检测到 VcXsrv、Xming、X410 或 DISPLAY"],
    "已找到 X Server，但尚未运行":["remote:clients.reason_xserver_not_running", "已找到 X Server，但尚未运行"],
    "未安装 XQuartz":["remote:clients.reason_xquartz_missing", "未安装 XQuartz"],
    "已安装 XQuartz，但尚未运行":["remote:clients.reason_xquartz_not_running", "已安装 XQuartz，但尚未运行"]
  };
  const localized = reasons[raw];
  if (localized) return tr(localized[0], {defaultValue:localized[1]});
  return raw || tr("remote:capabilities.client_missing", {client:protocolLabel, defaultValue:`未检测到 ${protocolLabel} 客户端`});
}

function renderLinuxDesktopMissingWorkspace(profile, key, diagnostics) {
  const view = $("view-remote-desktop");
  if (!view) return;
  view.innerHTML = `<div class="remote-desktop-launch"><div class="remote-desktop-icon">${icon(REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-off")}</div><h2>${esc(profile.name)}</h2><div class="cmd">${esc(remoteProfileEndpoint(profile))}</div>${linuxDesktopMissingNotice(profile, diagnostics)}<div class="actions"><button class="primary" type="button" onclick="openLinuxDesktopManagerForProfile(${profile.id})">${icon("monitor-cog")}<span>${esc(tr("remote:diagnostics.open_linux_desktop_manager", {defaultValue:"前往 Linux 桌面管理"}))}</span></button><button type="button" onclick="editRemoteProfile(${profile.id})">${icon("settings-2")}<span>${esc(tr("remote:actions.connection_settings", {defaultValue:"连接设置"}))}</span></button></div><div class="muted">${esc(tr("remote:management.reopen_after_desktop_install", {defaultValue:"安装桌面后重新打开此连接，Terma 会重新检测远端图形环境。"}))}</div></div>`;
  refreshIcons();
}

function openAddConnectionMenu() {
  newConnection();
}

function openAddRemoteConnectionMenu(event) {
  showActionMenu(event, [
    ...Object.entries(REMOTE_PROTOCOL_META).map(([protocol, meta]) => ({
      label:meta.label,
      icon:meta.icon,
      run:()=>newRemoteProfile(protocol)
    }))
  ]);
}

function showRemoteExplorerMenu(event) {
  showActionMenu(event, [
    {label:tr("remote:auto.from_ssh", {defaultValue:"从 SSH 连接生成…"}), icon:"server-cog", run:()=>showPrimary("connections")},
    {label:tr("common:x11.manager", {defaultValue:"X Server 管理"}), icon:"x11", run:()=>openXServerManager()},
    {separator:true},
    {label:tr("common:auto.refresh_other_connections", {defaultValue:"刷新其他连接"}), icon:"refresh-cw", run:()=>loadAll()}
  ]);
}

function linuxDesktopManagerConnectionIdForProfile(profile) {
  const sourceId = Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
  const host = String(profile?.host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (sourceId) {
    const configured = currentConnection(sourceId);
    if (configured && String(configured.ssh_host || "").trim().toLowerCase().replace(/^\[|\]$/g, "") === host) return sourceId;
  }
  const matches = connections.filter(item => String(item.ssh_host || "").trim().toLowerCase().replace(/^\[|\]$/g, "") === host);
  return matches.length === 1 ? Number(matches[0].id || 0) : 0;
}

function remoteManagementCredentialRepairMarkup(profileId, error, surface) {
  if (typeof sshAuthenticationFailure !== "function" || !sshAuthenticationFailure(error)) return "";
  const profile = remoteProfileById(profileId);
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!connectionId) return "";
  return `<button type="button" data-action="remote-management-credential-repair" data-remote-profile-id="${Number(profileId)}" data-surface="${escAttr(surface || "")}">${icon("key-round")}<span>${esc(tr("remote:diagnostics.repair_ssh_credentials", {defaultValue:"修复 SSH 管理凭据"}))}</span></button>`;
}

function remoteManagementSetupActionMarkup(profileId) {
  return `<button type="button" data-action="remote-management-new-ssh" data-remote-profile-id="${Number(profileId)}">${icon("server-cog")}<span>${esc(tr("remote:diagnostics.new_ssh_management_connection", {defaultValue:"新建 SSH 管理连接"}))}</span></button>`;
}

function remoteManagementUnavailableMarkup(profile, message="") {
  const protocol = String(profile?.protocol || tr("remote:diagnostics.remote_protocol", {defaultValue:"远程"})).toUpperCase();
  const detail = message || tr("remote:diagnostics.ssh_management_optional", {protocol, defaultValue:`${protocol} 连接本身不依赖 SSH；关联 SSH 后可增加 Linux 服务安装、状态识别和凭据修复能力。`});
  return remoteDiagnosticStatusMarkup(detail, {
    tone:"warning",
    icon:"server-off",
    title:tr("remote:diagnostics.ssh_management_unlinked", {defaultValue:"未关联 SSH 管理连接"}),
    actions:remoteManagementSetupActionMarkup(profile?.id)
  });
}

function newRemoteManagementSshConnection(profileId) {
  const profile = remoteProfileById(profileId);
  if (!profile || newConnection(profile.group_name || "默认分组") === false) return false;
  const form = $("connectionForm");
  if (!form) return false;
  form.dataset.remoteProfileLinkId = String(profile.id);
  form.insertAdjacentHTML("afterbegin", `<div class="connection-test-status remote-management-link-notice">${esc(tr("remote:management.link_after_save", {name:profile.name, defaultValue:`保存后会自动关联到“${profile.name}”，用于 Linux 服务管理和深度诊断；远程桌面密码不会复制到 SSH。`}))}</div>`);
  if ($("conn_name")) $("conn_name").value = tr("remote:management.generated_ssh_name", {name:profile.name, defaultValue:`${profile.name} · SSH 管理`}).slice(0, 120);
  if ($("conn_host")) $("conn_host").value = profile.host || "";
  if ($("conn_port")) $("conn_port").value = 22;
  if ($("conn_user")) $("conn_user").value = profile.protocol === "rdp" ? "" : profile.username || "";
  setTimeout(() => $("conn_user")?.focus({preventScroll:true}), 0);
  return true;
}

async function linkRemoteProfileSshManagement(profileId, connectionId) {
  const profile = remoteProfileById(profileId);
  const id = Number(connectionId || 0);
  if (!profile || id < 1) return false;
  const options = {...(profile.options || {}), source_ssh_connection_id:id};
  if (profile.protocol === "xdmcp") options.ssh_connection_id = id;
  await api(`/api/remote-profiles/${profile.id}`, {method:"PUT", body:JSON.stringify({
    protocol:profile.protocol,
    name:profile.name,
    group_name:profile.group_name,
    host:profile.host,
    port:profile.port,
    username:profile.username || "",
    tags:profile.tags || "",
    options
  })});
  notify(tr("remote:management.linked_success", {name:profile.name, defaultValue:`已把 SSH 管理连接关联到 ${profile.name}`}), "success");
  return true;
}

async function repairRemoteManagementCredentials(profileId, surface="") {
  const profile = remoteProfileById(profileId);
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!profile || !connectionId || typeof repairSshCredentials !== "function") {
    notify(tr("remote:management.connection_not_found", {defaultValue:"没有找到此远程连接使用的 SSH 管理连接"}), "error");
    return false;
  }
  const retry = async () => {
    if (surface === "rdp") await inspectRdpServer(profile.id);
    else if (surface === "vnc") await inspectVncServer(profile.id);
    else if (surface === "xdmcp") await inspectXdmcpServer(profile.id);
  };
  return repairSshCredentials(connectionId, {
    context:tr("remote:management.probe_auth_failed", {protocol:String(surface || profile.protocol).toUpperCase(), defaultValue:`${String(surface || profile.protocol).toUpperCase()} 服务探测认证失败`}),
    onSaved:retry
  });
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("remote-management-credential-repair", ({element}) => repairRemoteManagementCredentials(
    Number(element.dataset.remoteProfileId || 0),
    element.dataset.surface || ""
  ));
  registerTermaAction("remote-management-new-ssh", ({element}) => newRemoteManagementSshConnection(
    Number(element.dataset.remoteProfileId || 0)
  ));
}

function openLinuxDesktopManagerForProfile(profileId) {
  const profile = remoteProfileById(profileId);
  return openLinuxDesktopManager(linuxDesktopManagerConnectionIdForProfile(profile));
}

async function openLinuxDesktopTask(connectionId, taskId) {
  openLinuxDesktopManager(Number(connectionId || 0));
  try {
    const task = await api(`/api/linux-desktop/tasks/${encodeURIComponent(taskId)}`);
    linuxDesktopManagerState.taskId = task.id;
    linuxDesktopManagerState.task = task;
    linuxDesktopManagerState.logs = task.logs || [];
    renderLinuxDesktopManager();
    if (["running", "pending", "queued"].includes(String(task.status || "").toLowerCase())) {
      pollLinuxDesktopInstallTask(task.id, Number(task.connection_id || connectionId || 0), null, task);
    }
  } catch (error) {
    notify(error.message || tr("remote:tasks.desktop_task_read_failed", {defaultValue:"读取桌面管理任务失败"}), "error");
  }
}

function linuxDesktopManagerConnectionOptions(selectedId=0) {
  return (Array.isArray(connections) ? connections : []).map(connection => `<option value="${Number(connection.id)}" ${Number(connection.id) === Number(selectedId) ? "selected" : ""}>${esc(connection.name)} · ${esc(connection.ssh_user)}@${esc(connection.ssh_host)}</option>`).join("");
}

function linuxDesktopLabel(id) {
  return ({xfce:"XFCE", gnome:"GNOME", plasma:"KDE Plasma", mate:"MATE", cinnamon:"Cinnamon", lxqt:"LXQt"}[id] || id || tr("remote:management.linux_desktop", {defaultValue:"Linux 桌面"}));
}

const REMOTE_INSTALL_MODE_ORDER = ["online", "local-offline", "offline", "manual"];
const REMOTE_INSTALL_MODE_META = {
  online:{icon:"cloud-download"},
  "local-offline":{icon:"hard-drive-download"},
  offline:{icon:"database-zap"},
  manual:{icon:"book-open-check"}
};

function remoteInstallModeCopy(modeId) {
  if (modeId === "online") return {label:tr("remote:install.online", {defaultValue:"在线安装"}), description:tr("remote:install.online_description", {defaultValue:"由远端主机联网，通过系统包管理器直接安装。"})};
  if (modeId === "local-offline") return {label:tr("remote:install.local_offline", {defaultValue:"本机下载后离线安装"}), description:tr("remote:install.local_offline_description", {defaultValue:"仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；Terma 会在本机下载依赖并通过 SFTP 上传安装。"})};
  if (modeId === "offline") return {label:tr("remote:install.remote_cache", {defaultValue:"使用远端缓存"}), description:tr("remote:install.remote_cache_description", {defaultValue:"不访问软件源，只使用远端包管理器已经缓存的软件包。"})};
  return {label:tr("remote:install.manual", {defaultValue:"手动安装/配置说明"}), description:tr("remote:install.manual_description", {defaultValue:"查看适合当前系统的命令、配置步骤和注意事项。"})};
}

function remoteInstallPlanRoot(value={}) {
  const candidates = [value?.install_plan, value?.component_plan, value?.package_plan?.install_plan, value];
  return candidates.find(item => item && (Array.isArray(item.modes) || item.online || item.offline || item.local_offline || item.manual)) || {};
}

function remoteInstallPlanMode(value, modeId) {
  const plan = remoteInstallPlanRoot(value);
  const key = modeId === "local-offline" ? "local_offline" : modeId;
  const mode = plan[key] || (Array.isArray(plan.modes) ? plan.modes.find(item => String(item?.id || "") === modeId) : null) || {};
  const meta = REMOTE_INSTALL_MODE_META[modeId] || {icon:"package"};
  const copy = REMOTE_INSTALL_MODE_META[modeId] ? remoteInstallModeCopy(modeId) : {label:modeId, description:""};
  const command = String(mode.command || "").trim();
  const available = modeId === "manual" ? true : mode.available === undefined ? Boolean(command) : Boolean(mode.available);
  return {
    id:modeId,
    label:copy.label,
    icon:meta.icon,
    description:mode.description ? safeRemoteTaskLegacyText(mode.description, copy.description) : copy.description,
    command,
    available,
    package_names:Array.isArray(mode.package_names) ? mode.package_names : []
  };
}

function remoteInstallModesMarkup(plan, runExpression, manualExpression="revealRemoteInstallManual(this)", actionKey="") {
  return `<div class="remote-install-modes" role="group" aria-label="${escAttr(tr("remote:install.methods", {defaultValue:"安装方式"}))}">${REMOTE_INSTALL_MODE_ORDER.map(modeId => {
    const mode = remoteInstallPlanMode(plan, modeId);
    const action = modeId === "manual" ? manualExpression : runExpression(modeId);
    const actionAttr = actionKey && modeId !== "manual" ? ` data-ui-action-key="${escAttr(actionKey)}"` : "";
    const unavailableDescription = tr("remote:install.unavailable_description", {description:mode.description || tr("remote:install.no_plan", {defaultValue:"当前系统没有可用方案"}), defaultValue:`${mode.description || "当前系统没有可用方案"} · 当前不可用`});
    return `<button type="button" class="remote-install-mode" data-install-mode="${modeId}"${actionAttr} onclick="${action}" ${mode.available ? "" : "disabled"}><span class="remote-install-mode-icon">${icon(mode.icon)}</span><span class="remote-install-mode-copy"><strong>${esc(mode.label)}</strong><small>${esc(mode.available ? mode.description : unavailableDescription)}</small></span><span class="remote-install-mode-state">${modeId === "manual" ? icon("chevron-down") : mode.available ? icon("chevron-right") : esc(tr("remote:install.unavailable", {defaultValue:"不可用"}))}</span></button>`;
  }).join("")}</div>`;
}

function remoteInstallManualMarkup(plan, options={}) {
  const steps = Array.isArray(options.steps) ? options.steps.filter(Boolean).map(item => safeRemoteTaskLegacyText(item)).filter(Boolean) : [];
  const localPackages = remoteInstallPlanMode(plan, "local-offline").package_names;
  const commands = [...new Set([
    ...(Array.isArray(options.commands) ? options.commands : []),
    remoteInstallPlanMode(plan, "online").command,
    remoteInstallPlanMode(plan, "offline").command
  ].map(value => String(value || "").trim()).filter(Boolean))];
  const manualOfflineStep = commands.length
    ? localPackages.length
      ? tr("remote:auto.manual_offline_packages", {packages:localPackages.join(", "), defaultValue:`如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载 ${localPackages.join("、")} 及全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。`})
      : tr("remote:auto.manual_offline_components", {defaultValue:"如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载所需组件和全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。"})
    : "";
  const manualSteps = manualOfflineStep ? [...steps, manualOfflineStep] : steps;
  const note = localizedRemoteTaskText(options.note) || tr("remote:install.default_note", {defaultValue:"命令会按当前系统探测结果生成。执行前请确认远端已有可用的软件源或离线缓存，并保存正在运行的图形会话。"});
  return `<details class="remote-install-manual"><summary>${icon("book-open-check")}<span>${esc(tr("remote:auto.manual_install", {defaultValue:"手动安装/配置说明"}))}</span></summary><div class="remote-install-manual-body">${manualSteps.length ? `<ol class="x11-install-steps">${manualSteps.map(item => `<li>${esc(item)}</li>`).join("")}</ol>` : ""}${commands.length ? `<label>${esc(tr("remote:auto.reference_commands", {defaultValue:"参考命令"}))}</label>${commands.map(command => `<pre class="x11-install-command">${esc(command)}</pre>`).join("")}<button type="button" class="remote-install-copy" onclick="copyRemoteInstallCommands()">${icon("copy")}<span>${esc(tr("remote:auto.copy_reference_commands", {defaultValue:"复制参考命令"}))}</span></button>` : `<div class="connection-test-status warning">${esc(tr("remote:auto.manual_commands_unavailable", {defaultValue:"当前系统没有可自动生成的命令，请按照发行版的软件包管理器文档手动安装对应组件。"}))}</div>`}<div class="x11-install-note">${esc(note)}</div></div></details>`;
}

function revealRemoteInstallManual(button=null) {
  const details = button?.closest?.(".modal-card, .rdp-server-state")?.querySelector?.(".remote-install-manual") || $("modal")?.querySelector?.(".remote-install-manual");
  if (!details) return;
  details.open = true;
  details.scrollIntoView?.({block:"nearest", behavior:"smooth"});
}

async function copyRemoteInstallCommands() {
  const commands = Array.isArray($("modal")?._remoteInstallCommands) ? $("modal")._remoteInstallCommands : [];
  if (!commands.length) return notify(tr("remote:install.no_copy_commands", {defaultValue:"当前没有可复制的参考命令"}), "info");
  try {
    await copyText(commands.join("\n\n"));
    notify(tr("remote:install.commands_copied", {defaultValue:"参考命令已复制"}), "success");
  } catch (error) {
    notify(error.message || tr("remote:install.copy_failed", {defaultValue:"复制参考命令失败"}), "error");
  }
}

function setRemoteInstallDialogCommands(plan, extraCommands=[]) {
  const modal = $("modal");
  modal._remoteInstallCommands = [...new Set([
    ...extraCommands,
    remoteInstallPlanMode(plan, "online").command,
    remoteInstallPlanMode(plan, "offline").command
  ].map(value => String(value || "").trim()).filter(Boolean))];
}

function closeRemoteInstallDialog() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal._remoteInstallCommands = null;
  modal.innerHTML = "";
}

const remoteComponentTaskWatchers = new Map();

function setRemoteComponentTaskHost(container, active) {
  if (!container) return;
  container.classList.toggle("remote-component-task-host", Boolean(active));
}

function captureRemoteComponentTaskScope(profileId, key="", container=null) {
  const pane = container?.closest?.(".workspace-pane");
  const paneId = String(pane?.dataset?.paneId
    || (key && typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key)?.id : "")
    || "");
  return {
    profileId:Number(profileId || 0),
    key:String(key || ""),
    paneId,
    containerId:String(container?.id || ""),
    container:container || null
  };
}

function remoteComponentTaskScopeMatches(scope) {
  if (!scope) return true;
  const key = String(scope.key || "");
  const paneId = String(scope.paneId || "");
  if (paneId && typeof workspaceFindPane === "function") {
    const pane = workspaceFindPane(paneId);
    if (!pane) return false;
    if (key && pane.activeTabKey !== key) return false;
    const tab = typeof tabs !== "undefined" ? tabs.find(item => item.key === key) : null;
    if (tab?.kind === "remote-desktop" && scope.profileId && Number(tab.id) !== Number(scope.profileId)) return false;
    return true;
  }
  if (key && typeof activeTabKey !== "undefined" && activeTabKey && activeTabKey !== key) return false;
  if (scope.profileId && typeof selectedRemoteProfileId !== "undefined" && Number(selectedRemoteProfileId || 0) !== Number(scope.profileId)) return false;
  return true;
}

function remoteComponentTaskContainer(scope, container) {
  if (!remoteComponentTaskScopeMatches(scope)) return null;
  const belongsToScope = candidate => {
    if (!candidate || candidate.isConnected === false) return false;
    const pane = candidate.closest?.(".workspace-pane");
    return !pane || !scope?.paneId || String(pane.dataset?.paneId || "") === String(scope.paneId);
  };
  if (belongsToScope(container)) return container;
  if (belongsToScope(scope?.container)) return scope.container;
  const containerId = String(scope?.containerId || "");
  if (!containerId) return null;
  if (scope?.key && typeof workspaceElementForTab === "function") {
    const replacement = workspaceElementForTab(scope.key, `#${containerId}`);
    if (belongsToScope(replacement)) {
      scope.container = replacement;
      return replacement;
    }
  }
  if (!scope?.paneId && typeof document !== "undefined") {
    const replacement = document.getElementById?.(containerId) || null;
    if (belongsToScope(replacement)) {
      scope.container = replacement;
      return replacement;
    }
  }
  return null;
}

function captureRemoteDesktopRenderScope(profileId, key, view) {
  const scope = captureRemoteComponentTaskScope(profileId, key, view);
  scope.requestId = String(++remoteDesktopRenderSerial);
  if (view) view.dataset.remoteDesktopRenderRequest = scope.requestId;
  return scope;
}

function remoteDesktopRenderView(scope) {
  if (!remoteComponentTaskScopeMatches(scope)) return null;
  const view = scope?.container;
  if (!view || view.isConnected === false) return null;
  if (String(view.dataset?.remoteDesktopRenderRequest || "") !== String(scope.requestId || "")) return null;
  return view;
}

function withRemoteDesktopRenderScope(scope, action) {
  const run = () => {
    const view = remoteDesktopRenderView(scope);
    return view ? action(view) : undefined;
  };
  return scope?.paneId && typeof runInWorkspacePane === "function"
    ? runInWorkspacePane(scope.paneId, run)
    : run();
}

function remoteWorkspaceQuery(container, selector, fallbackId="") {
  const pane = container?.closest?.(".workspace-pane");
  return pane?.querySelector?.(selector) || (fallbackId ? $(fallbackId) : null);
}

function remoteComponentTaskStatus(task={}) {
  const status = String(task.status || "pending").toLowerCase();
  if (status === "done") return {label:tr("remote:tasks.done", {defaultValue:"已完成"}), icon:"circle-check", className:"success"};
  if (status === "failed") return {label:tr("remote:tasks.failed", {defaultValue:"失败"}), icon:"circle-alert", className:"error"};
  if (status === "cancelled") return {label:tr("remote:tasks.cancelled", {defaultValue:"已取消"}), icon:"circle-stop", className:"warning"};
  if (status === "pending") return {label:tr("remote:tasks.pending", {defaultValue:"准备中"}), icon:"package-clock", className:"running"};
  return {label:tr("remote:tasks.running", {defaultValue:"执行中"}), icon:"loader-circle", className:"running"};
}

function localizedRemoteTaskText(value="") {
  if (value && typeof value === "object" && !Array.isArray(value) && value.i18n_key) {
    const params = value.params && typeof value.params === "object" && !Array.isArray(value.params) ? value.params : {};
    return tr(String(value.i18n_key), {...params, defaultValue:String(value.fallback || value.i18n_key)});
  }
  const raw = String(value || "");
  if (!raw || typeof localizedTermaUiPhrase !== "function") return raw;
  return localizedTermaUiPhrase(raw) || raw;
}

function normalizedRemoteTaskKey(value="") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function translatedRemoteTaskKey(group, value, params={}) {
  const key = normalizedRemoteTaskKey(value);
  if (!key) return "";
  const resourceKey = `remote:${group}.${key}`;
  if (!window.i18next?.exists?.(resourceKey)) return "";
  return tr(resourceKey, {...params, defaultValue:""});
}

function remoteTaskEnglishInterface() {
  return /^en(?:-|$)/i.test(String(document.documentElement.lang || window.i18next?.resolvedLanguage || ""));
}

function safeRemoteTaskLegacyText(value, fallback="") {
  const raw = value && typeof value === "object" ? "" : String(value || "").trim();
  if (!raw && !(value && typeof value === "object")) return fallback;
  const localized = localizedRemoteTaskText(value).trim();
  if (!remoteTaskEnglishInterface() || !/[\u3400-\u9fff]/.test(localized)) return localized;
  return fallback;
}

function remoteTaskComponentLabel(task={}) {
  const componentKey = normalizedRemoteTaskKey(task.component_key || task.component);
  const exact = translatedRemoteTaskKey("task_components", componentKey);
  if (exact) return exact;
  if (componentKey.startsWith("linux-desktop-")) {
    const desktopNames = {xfce:"XFCE", gnome:"GNOME", plasma:"KDE Plasma", mate:"MATE", cinnamon:"Cinnamon", lxqt:"LXQt"};
    const name = desktopNames[componentKey.slice("linux-desktop-".length)] || componentKey.slice("linux-desktop-".length);
    return tr("remote:task_components.linux-desktop-named", {name, defaultValue:`Linux 桌面 · ${name}`});
  }
  if (componentKey.startsWith("xdmcp-")) {
    if (componentKey.includes("lightdm")) return tr("remote:task_components.xdmcp-lightdm", {defaultValue:"LightDM XDMCP 服务"});
    if (componentKey.includes("desktop") || componentKey.includes("xfce")) return tr("remote:task_components.xdmcp-desktop", {defaultValue:"XDMCP 兼容桌面"});
    if (componentKey.includes("rdp")) return tr("remote:task_components.rdp-server", {defaultValue:"RDP 服务"});
    return tr("remote:task_components.xdmcp", {defaultValue:"XDMCP 服务"});
  }
  return safeRemoteTaskLegacyText(task.component_label, tr("remote:tasks.component_task", {defaultValue:"远程组件任务"}));
}

function remoteTaskActionLabel(task={}) {
  const action = translatedRemoteTaskKey("task_actions", task.action_key || task.action);
  if (action) return action;
  return safeRemoteTaskLegacyText(task.action_label, tr("remote:task_actions.configure", {defaultValue:"配置"}));
}

function remoteTaskCurrentLabel(task={}) {
  const current = translatedRemoteTaskKey("task_stages", task.current_key || task.stage, task.current_params || {});
  if (current) return current;
  return safeRemoteTaskLegacyText(task.current || task.stage, remoteComponentTaskStatus(task).label);
}

function remoteTaskErrorLabel(task={}) {
  const raw = String(task.error || "").trim();
  if (!raw) return "";
  if (task.error_code && typeof localizedBackendPublicError === "function") {
    return localizedBackendPublicError({
      error_code:task.error_code,
      error_params:task.error_params,
      preserve_error_message:task.preserve_error_message === true
    }, raw);
  }
  return safeRemoteTaskLegacyText(raw, tr("remote:tasks.operation_failed", {defaultValue:"远程组件操作失败"}));
}

function remoteComponentTaskMarkup(task={}, options={}) {
  const state = remoteComponentTaskStatus(task);
  const rawProgress = Number(task.progress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
  const title = remoteTaskActionLabel(task) || safeRemoteTaskLegacyText(options.title) || remoteTaskComponentLabel(task);
  const current = remoteTaskCurrentLabel(task) || state.label;
  const error = remoteTaskErrorLabel(task);
  return `<div class="remote-component-progress ${state.className}" role="status" aria-live="polite">
    <div class="remote-component-progress-head"><span class="remote-service-icon ${state.className}">${icon(state.icon)}</span><div><b>${esc(title)}</b><small>${esc(current)} · ${esc(state.label)}</small></div><strong>${Math.round(progress)}%</strong></div>
    <div class="remote-component-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
    ${error ? `<div class="connection-test-status error">${esc(error)}</div>` : ""}
    <div class="actions tight"><button type="button" onclick="toggleSftpTaskCenter(event)">${icon("list-checks")}<span>${esc(tr("remote:tasks.open_center_logs", {defaultValue:"查看任务中心与日志"}))}</span></button></div>
  </div>`;
}

function renderRemoteComponentTask(container, task, options={}) {
  if (!container) return;
  setRemoteComponentTaskHost(container, true);
  container.innerHTML = remoteComponentTaskMarkup(task, options);
  container._remoteComponentTask = task;
  refreshIcons();
}

function notifyRemoteComponentTaskRequest(result, requestedLabel, queuedMessage) {
  if (!result?.task_conflict) {
    notify(queuedMessage, "success");
    return true;
  }
  const runningLabel = remoteTaskActionLabel(result.task) || remoteTaskComponentLabel(result.task) || tr("remote:tasks.existing_operation", {defaultValue:"已有远端操作"});
  if (result.conflict_same_action) {
    notify(tr("remote:tasks.already_running_adopted", {action:runningLabel, defaultValue:`${runningLabel}任务已在执行，已接管当前进度`}), "info");
    return true;
  }
  const reason = safeRemoteTaskLegacyText(result.error || result.task?.resource_conflict_message)
    || tr("remote:tasks.operation_running", {action:runningLabel, defaultValue:`${runningLabel}任务正在执行`});
  notify(tr("remote:tasks.request_rejected", {action:requestedLabel, reason, defaultValue:`未执行${requestedLabel}：${reason}`}), "error");
  return false;
}

function watchRemoteComponentTask(task, options={}) {
  if (!task?.id) return Promise.resolve(task);
  const id = String(task.id);
  const createSubscriber = currentOptions => ({options:currentOptions || {}});
  const previous = remoteComponentTaskWatchers.get(id);
  if (previous) {
    previous.current = task || previous.current;
    const subscriber = createSubscriber(options);
    previous.subscribers.add(subscriber);
    void previous.publishSubscriber(subscriber, previous.current).catch(() => {});
    return previous.completion;
  }
  let resolveCompletion;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  const watcher = {
    cancelled:false,
    timer:null,
    current:task,
    subscribers:new Set(),
    completion,
    finished:false,
    publishSubscriber:null,
    finish(current) {
      if (watcher.finished) return;
      watcher.finished = true;
      resolveCompletion(current);
    }
  };
  watcher.subscribers.add(createSubscriber(options));
  remoteComponentTaskWatchers.set(id, watcher);
  const subscriberOptions = subscriber => subscriber?.options || {};
  const subscriberScopeMatches = subscriber => remoteComponentTaskScopeMatches(subscriberOptions(subscriber).scope);
  const resolveSubscriberContainer = subscriber => {
    const currentOptions = subscriberOptions(subscriber);
    const container = typeof currentOptions.container === "function" ? currentOptions.container() : currentOptions.container;
    return remoteComponentTaskContainer(currentOptions.scope, container);
  };
  watcher.publishSubscriber = async (subscriber, current) => {
    const currentOptions = subscriberOptions(subscriber);
    const container = resolveSubscriberContainer(subscriber);
    if (container) renderRemoteComponentTask(container, current, currentOptions);
    if (subscriberScopeMatches(subscriber) && typeof currentOptions.onUpdate === "function") {
      await currentOptions.onUpdate(current, container);
    }
  };
  const publishUpdate = async current => {
    await Promise.allSettled([...watcher.subscribers].map(subscriber => watcher.publishSubscriber(subscriber, current)));
  };
  const publishTerminal = async (current, status) => {
    await Promise.allSettled([...watcher.subscribers].map(async subscriber => {
      const currentOptions = subscriberOptions(subscriber);
      if (!subscriberScopeMatches(subscriber)) return;
      const container = resolveSubscriberContainer(subscriber);
      if (status === "done" && typeof currentOptions.onDone === "function") await currentOptions.onDone(current, container);
      if (status === "failed" && typeof currentOptions.onFailed === "function") await currentOptions.onFailed(current, container);
    }));
  };
  const tick = async current => {
    watcher.current = current;
    if (watcher.cancelled) {
      if (remoteComponentTaskWatchers.get(id) === watcher) remoteComponentTaskWatchers.delete(id);
      watcher.finish(current);
      return;
    }
    await publishUpdate(current);
    if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
    const status = String(current?.status || "").toLowerCase();
    if (["done", "failed", "cancelled"].includes(status)) {
      if (remoteComponentTaskWatchers.get(id) === watcher) remoteComponentTaskWatchers.delete(id);
      try {
        await publishTerminal(current, status);
      } finally {
        watcher.finish(current);
      }
      return;
    }
    watcher.timer = setTimeout(async () => {
      try {
        const latest = await api(`/api/remote-component/tasks/${encodeURIComponent(id)}`);
        await tick(latest);
      } catch (error) {
        const failedTask = {...current, status:"failed", error:error.message || tr("remote:tasks.status_read_failed", {defaultValue:"远程组件任务状态读取失败"})};
        watcher.current = failedTask;
        if (remoteComponentTaskWatchers.get(id) === watcher) remoteComponentTaskWatchers.delete(id);
        try {
          await publishUpdate(failedTask);
          await publishTerminal(failedTask, "failed");
        } finally {
          watcher.finish(failedTask);
        }
      }
    }, 1200);
  };
  void tick(task).catch(() => watcher.finish(watcher.current || task));
  return completion;
}

function reusableRemoteAdminGrant(connectionId, scope = "") {
  const id = Number(connectionId || 0);
  const grant = remoteAdminGrantCache.get(id);
  if (!grant?.id) return null;
  const expiresAt = Number(grant.expires_at || 0);
  if (expiresAt > 0 && expiresAt <= Date.now()) {
    remoteAdminGrantCache.delete(id);
    return null;
  }
  if (grant.scope && grant.scope !== String(scope || "").trim() && grant.scope !== "host:*") return null;
  return grant;
}

function rememberRemoteAdminGrant(connectionId, grant={}) {
  const id = Number(connectionId || 0);
  const policy = String(grant.reuse_policy || "once");
  if (!id || !grant.id || policy === "once") return;
  remoteAdminGrantCache.set(id, {
    id:String(grant.id),
    reuse_policy:policy,
    expires_at:Number(grant.expires_at || 0),
    scope:String(grant.scope || "").trim()
  });
}

async function requestRemoteAdminAuthorization(connectionId, scopeLabel=tr("remote:admin.remote_management", {defaultValue:"远端管理"}), grantScope=scopeLabel) {
  const normalizedConnectionId = Number(connectionId || 0);
  const connection = currentConnection(normalizedConnectionId);
  if (!connection) throw new Error(tr("remote:admin.ssh_connection_missing", {defaultValue:"SSH 连接不存在"}));
  const quickConnection = Boolean(connection.quick_connection || normalizedConnectionId < 0);
  const cachedGrant = quickConnection ? null : reusableRemoteAdminGrant(normalizedConnectionId, grantScope);
  if (cachedGrant) return {admin_grant_id:cachedGrant.id};
  let identities = [];
  try { identities = await api("/api/identity-files"); } catch {}
  return new Promise(resolve => {
    const modal = $("modal");
    const defaultMethod = connection.auth_type === "password" || connection.has_password ? "password" : identities.length ? "key" : "agent";
    const defaultKey = identities.find(item => item.permission_ok)?.path || identities[0]?.path || "";
    modal.innerHTML = `<form class="modal-card remote-admin-modal" role="dialog" aria-modal="true" aria-labelledby="remoteAdminTitle">
      <div class="modal-title-row"><div><h2 id="remoteAdminTitle">${esc(tr("remote:admin.title", {defaultValue:"临时管理员授权"}))}</h2><span class="muted">${esc(scopeLabel)} · ${esc(connection.name || connection.ssh_host)}</span></div><button class="icon-button" type="button" data-admin-cancel title="${escAttr(tr("remote:admin.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("remote:admin.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div>
      <div class="connection-test-status warning">${esc(tr("remote:admin.privacy_notice", {defaultValue:"账号、密码和私钥口令不会保存到连接、配置、日志或任务中心。选择免密复用时，程序内存中只保留临时授权标识。"}))}</div>
      <div class="grid remote-admin-grid"><div><label>${esc(tr("remote:admin.ssh_user", {defaultValue:"管理员 SSH 账号"}))}</label><input id="remoteAdminUser" autocomplete="username" value="${escAttr(connection.ssh_user || "root")}" required></div><div><label>${esc(tr("remote:admin.auth_method", {defaultValue:"SSH 认证方式"}))}</label><select id="remoteAdminMethod"><option value="password" ${defaultMethod === "password" ? "selected" : ""}>${esc(tr("remote:admin.password", {defaultValue:"密码"}))}</option><option value="key" ${defaultMethod === "key" ? "selected" : ""}>${esc(tr("remote:admin.existing_key", {defaultValue:"已有私钥"}))}</option><option value="agent">SSH Agent</option></select></div></div>
      <div id="remoteAdminPasswordBox"><label>${esc(tr("remote:admin.ssh_password", {defaultValue:"SSH 密码"}))}</label><input id="remoteAdminPassword" type="password" autocomplete="current-password" placeholder="${escAttr(tr("remote:admin.once_placeholder", {defaultValue:"只在本次操作中使用"}))}"></div>
      <div id="remoteAdminKeyBox" hidden><label>${esc(tr("remote:admin.private_key", {defaultValue:"私钥"}))}</label><select id="remoteAdminKey"><option value="">${esc(tr("remote:admin.select_private_key", {defaultValue:"请选择 Terma 已识别的私钥"}))}</option>${identities.map(item => `<option value="${escAttr(item.path)}" ${item.path === defaultKey ? "selected" : ""}>${esc(localizedIdentityFileLabel(item, {permission:true, repair:true}))}</option>`).join("")}</select><label>${esc(tr("remote:admin.passphrase_optional", {defaultValue:"私钥口令（可选）"}))}</label><input id="remoteAdminPassphrase" type="password" autocomplete="new-password" placeholder="${escAttr(tr("remote:admin.passphrase_empty", {defaultValue:"没有口令可留空"}))}"></div>
      <div class="grid remote-admin-grid"><div><label>${esc(tr("remote:admin.sudo_password", {defaultValue:"sudo 密码"}))}</label><select id="remoteAdminSudoMode"><option value="none" selected>${esc(tr("remote:admin.sudo_none", {defaultValue:"不提供（仅 root/免密 sudo）"}))}</option><option value="same">${esc(tr("remote:admin.sudo_same", {defaultValue:"与 SSH 密码相同"}))}</option><option value="separate">${esc(tr("remote:admin.sudo_separate", {defaultValue:"单独输入"}))}</option></select></div><div id="remoteAdminSudoPasswordBox" hidden><label>${esc(tr("remote:admin.sudo_password", {defaultValue:"sudo 密码"}))}</label><input id="remoteAdminSudoPassword" type="password" autocomplete="current-password" placeholder="${escAttr(tr("remote:admin.sudo_empty", {defaultValue:"可留空尝试免密 sudo"}))}"></div></div>
      ${quickConnection ? `<div class="muted remote-admin-note">${esc(tr("remote:admin.quick_once", {defaultValue:"快速连接的管理员授权只用于这一次操作，不会复用或写入连接库。"}))}</div><input id="remoteAdminReusePolicy" type="hidden" value="once">` : `<div><label>${esc(tr("remote:admin.reuse_label", {defaultValue:"再次使用时免密"}))}</label><select id="remoteAdminReusePolicy"><option value="once" selected>${esc(tr("remote:admin.reuse_once", {defaultValue:"仅本次操作"}))}</option><option value="10m">${esc(tr("remote:admin.reuse_10m", {defaultValue:"10分钟内"}))}</option><option value="30m">${esc(tr("remote:admin.reuse_30m", {defaultValue:"30分钟内"}))}</option><option value="session">${esc(tr("remote:admin.reuse_session", {defaultValue:"本次程序运行时"}))}</option></select></div>`}
      <div class="muted remote-admin-note">${esc(tr("remote:admin.validation_notice", {defaultValue:"Terma 会先验证 SSH 登录和 root/sudo 能力，再执行限定的管理脚本。关闭程序后，所有临时授权都会失效。"}))}</div>
      <div class="actions"><button type="button" data-admin-cancel>${esc(tr("remote:admin.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${esc(tr("remote:admin.authorize_continue", {defaultValue:"授权并继续"}))}</button></div>
    </form>`;
    modal.hidden = false;
    refreshIcons();
    const form = modal.querySelector("form");
    const method = modal.querySelector("#remoteAdminMethod");
    const passwordBox = modal.querySelector("#remoteAdminPasswordBox");
    const keyBox = modal.querySelector("#remoteAdminKeyBox");
    const sudoMode = modal.querySelector("#remoteAdminSudoMode");
    const sudoBox = modal.querySelector("#remoteAdminSudoPasswordBox");
    const reusePolicy = modal.querySelector("#remoteAdminReusePolicy");
    const submitButton = form.querySelector('button[type="submit"]');
    const sameSudoOption = sudoMode.querySelector('option[value="same"]');
    const syncSudoMode = () => {
      sameSudoOption.disabled = method.value !== "password";
      if (sameSudoOption.disabled && sudoMode.value === "same") sudoMode.value = "none";
      sudoBox.hidden = sudoMode.value !== "separate";
    };
    const syncMethod = () => {
      const value = method.value;
      passwordBox.hidden = value !== "password";
      keyBox.hidden = value !== "key";
      syncSudoMode();
    };
    let finished = false;
    let submitting = false;
    const cancelButtons = [...modal.querySelectorAll("[data-admin-cancel]")];
    const sensitiveInputs = ["#remoteAdminPassword", "#remoteAdminPassphrase", "#remoteAdminSudoPassword"]
      .map(selector => modal.querySelector(selector))
      .filter(Boolean);
    const clearSensitiveFields = () => sensitiveInputs.forEach(input => { input.value = ""; });
    const onCancel = () => {
      if (!submitting) finish(null);
    };
    let onSubmit = null;
    const onKeyDown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!submitting) finish(null);
    };
    const finish = value => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKeyDown);
      method.removeEventListener("change", syncMethod);
      sudoMode.removeEventListener("change", syncSudoMode);
      cancelButtons.forEach(button => button.removeEventListener("click", onCancel));
      if (onSubmit) form.removeEventListener("submit", onSubmit);
      clearSensitiveFields();
      modal.hidden = true;
      modal.onclick = null;
      modal.innerHTML = "";
      resolve(value);
    };
    method.addEventListener("change", syncMethod);
    sudoMode.addEventListener("change", syncSudoMode);
    cancelButtons.forEach(button => button.addEventListener("click", onCancel));
    modal.onclick = null;
    document.addEventListener("keydown", onKeyDown);
    syncMethod();
    onSubmit = async event => {
      event.preventDefault();
      if (submitting) return;
      const authMethod = method.value;
      const user = modal.querySelector("#remoteAdminUser").value.trim();
      const sshPassword = modal.querySelector("#remoteAdminPassword").value;
      const key = modal.querySelector("#remoteAdminKey").value;
      const passphrase = modal.querySelector("#remoteAdminPassphrase").value;
      const sudoValue = sudoMode.value;
      const sudoPassword = sudoValue === "same" ? sshPassword : sudoValue === "separate" ? modal.querySelector("#remoteAdminSudoPassword").value : "";
      if (!user) return notify(tr("remote:admin.user_required", {defaultValue:"请输入管理员 SSH 账号"}), "error");
      if (authMethod === "password" && !sshPassword) return notify(tr("remote:admin.password_required", {defaultValue:"请输入 SSH 密码"}), "error");
      if (authMethod === "key" && !key) return notify(tr("remote:admin.key_required", {defaultValue:"请选择私钥"}), "error");
      submitting = true;
      cancelButtons.forEach(button => { button.disabled = true; });
      if (submitButton) setButtonBusy(submitButton, true, tr("remote:admin.validating", {defaultValue:"验证中..."}));
      try {
        const result = await api("/api/admin-grants", {
          method:"POST",
          headers:quickConnection && typeof quickConnectionRequestHeaders === "function" ? quickConnectionRequestHeaders(normalizedConnectionId) : {},
          body:JSON.stringify({
            connection_id:normalizedConnectionId,
            scope:grantScope,
            admin_auth:{
              ssh_user:user,
              auth_method:authMethod,
              ssh_password:authMethod === "password" ? sshPassword : "",
              identity_file:authMethod === "key" ? key : "",
              private_key_passphrase:authMethod === "key" ? passphrase : "",
              sudo_requested:true,
              sudo_password:sudoPassword,
              reuse_policy:String(reusePolicy?.value || "once")
            }
          })
        });
        const grant = result?.admin_grant || {id:result?.admin_grant_id, reuse_policy:reusePolicy?.value || "once", expires_at:0};
        if (!grant?.id) throw new Error(tr("remote:admin.grant_missing", {defaultValue:"临时管理员授权验证完成，但未返回授权标识"}));
        rememberRemoteAdminGrant(normalizedConnectionId, grant);
        finish({admin_grant_id:String(grant.id)});
      } catch (error) {
        notify(error.message || tr("remote:admin.failed", {defaultValue:"临时管理员授权失败"}), "error");
        submitting = false;
        cancelButtons.forEach(button => { button.disabled = false; });
        if (submitButton && document.contains(submitButton)) setButtonBusy(submitButton, false);
      }
    };
    form.addEventListener("submit", onSubmit);
    modal.querySelector("#remoteAdminUser")?.focus();
  });
}

function renderSshX11ForwardingPanel(connection, sshX11, source="xserver") {
  if (!connection) return "";
  const quickConnection = Boolean(connection.quick_connection || Number(connection.id) < 0);
  const connectionLabel = quickConnection ? tr("remote:management.temporary_connection", {name:connection.name, defaultValue:`${connection.name}（临时）`}) : connection.name;
  const sourceArg = escAttr(source);
  if (sshX11?.error) {
    const authenticationFailed = typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(sshX11);
    const repairAction = !authenticationFailed ? "" : quickConnection
      ? `<button type="button" data-action="x11-quick-credential-repair" data-terminal-key="${escAttr(xServerManagerTerminalKey || "")}">${icon("key-round")}<span>${esc(tr("common:actions.repair_temporary_credentials", {defaultValue:"修复临时 SSH 凭据"}))}</span></button>`
      : `<button type="button" data-action="x11-credential-repair" data-connection-id="${Number(connection.id)}" data-source="${sourceArg}">${icon("key-round")}<span>${esc(tr("common:actions.repair_credentials", {defaultValue:"修复 SSH 凭据"}))}</span></button>`;
    return `<div class="x11-forwarding-panel warning"><div class="x11-forwarding-head"><span>${icon("circle-alert")}</span><div><b>${esc(tr("common:x11.forwarding_title", {name:connectionLabel, defaultValue:`远端 SSH X11 组件与转发 · ${connectionLabel}`}))}</b><small>${esc(typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(sshX11.error) : sshX11.error)}</small></div></div>${repairAction ? `<div class="actions">${repairAction}</div>` : ""}</div>`;
  }
  const enabled = sshX11?.x11_forwarding === "yes";
  const macos = sshX11?.platform === "macos";
  const ready = Boolean(sshX11?.ready ?? (enabled && sshX11?.xauth_path));
  const status = enabled
    ? ready
      ? tr("common:x11.status_ready", {defaultValue:"已开启，xauth 配置可用"})
      : macos && !sshX11?.xquartz_installed
        ? tr("common:x11.status_xquartz_missing", {defaultValue:"已开启，但远端未安装 XQuartz"})
        : macos && !sshX11?.xauth_location_valid
          ? tr("common:x11.status_xauth_location_invalid", {defaultValue:"已开启，但 sshd 的 XAuthLocation 不可用"})
          : tr("common:x11.status_xauth_missing", {defaultValue:"已开启，但未检测到 xauth"})
    : sshX11?.x11_forwarding === "no" ? tr("common:x11.status_disabled", {defaultValue:"已关闭"}) : tr("common:x11.status_unknown", {defaultValue:"未能确定"});
  const action = enabled ? "disable" : "enable";
  const actionKey = x11ForwardingActionKey(connection.id);
  const forwardingAction = action === "enable"
    ? tr("common:x11.enable_forwarding", {defaultValue:"开启 X11 转发"})
    : tr("common:x11.disable_forwarding", {defaultValue:"关闭 X11 转发"});
  const automaticAction = sshX11.can_manage
    ? `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon(action === "enable" ? "shield-check" : "shield-off")}<span>${esc(forwardingAction)}</span></button>`
    : `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon("key-round")}<span>${esc(tr(action === "enable" ? "common:x11.temporary_enable" : "common:x11.temporary_disable", {defaultValue:`临时授权后${action === "enable" ? "开启" : "关闭"}`}))}</span></button>${sshX11.can_terminal_manage && sshX11.terminal_commands?.[action] ? `<button type="button" onclick="openSshX11ConfigureTerminal(${Number(connection.id)},'${action}','${sourceArg}')">${icon("square-terminal")}<span>${esc(tr(action === "enable" ? "common:x11.manual_enable" : "common:x11.manual_disable", {defaultValue:`在终端手动${action === "enable" ? "开启" : "关闭"}`}))}</span></button>` : ""}`;
  const installX11Components = macos && !sshX11?.xquartz_installed
    ? `<button type="button" onclick="openRemoteX11ComponentsInstall(${Number(connection.id)})">${icon("package-plus")}<span>${esc(tr("common:x11.install_xquartz", {defaultValue:"安装远端 XQuartz"}))}</span></button>`
    : !macos && !sshX11?.xauth_path
      ? `<button type="button" onclick="openRemoteX11ComponentsInstall(${Number(connection.id)})">${icon("package-plus")}<span>${esc(tr("common:x11.install_components", {defaultValue:"安装 xauth / X11 组件"}))}</span></button>`
      : "";
  const uninstallX11Components = !macos && sshX11?.xauth_path
    ? `<button class="danger" type="button" data-ui-action-key="${escAttr(x11ComponentsActionKey(connection.id))}" onclick="uninstallRemoteX11Components(${Number(connection.id)},this,'xserver')">${icon("package-minus")}<span>${esc(tr("common:x11.remove_components", {defaultValue:"卸载 X11 组件"}))}</span></button>`
    : "";
  const privilegeHint = !sshX11.can_manage && sshX11.can_terminal_manage
    ? `<div class="x11-forwarding-hint">${esc(tr(quickConnection ? "common:x11.quick_privilege_hint" : "common:x11.privilege_hint", {defaultValue:quickConnection ? "后台探测使用当前临时凭据，不会保存连接或继承终端中的 sudo -i；管理员授权只用于这一次操作。" : "后台探测会使用保存的 SSH 账号建立独立连接，不会继承其他终端中的 sudo -i。通过终端操作时可正常输入 sudo 密码。"}))}</div>`
    : "";
  const missingXauthHint = enabled && !ready
    ? `<div class="x11-forwarding-hint warning">${esc(tr(macos ? "common:x11.missing_xquartz_hint" : "common:x11.missing_xauth_hint", {defaultValue:macos ? "远端缺少可用的 XQuartz/xauth，SSH 可以连接，但图形窗口无法转发。" : "远端未检测到 xauth，sshd 无法为 X11 会话创建授权 Cookie；请安装后重新建立 X11 终端。"}))}</div>`
    : "";
  return `<div class="x11-forwarding-panel ${ready ? "ready" : enabled ? "warning" : ""}"><div class="x11-forwarding-head"><span>${icon(ready ? "circle-check" : enabled ? "circle-alert" : "circle-off")}</span><div><b>${esc(tr("common:x11.forwarding_title", {name:connectionLabel, defaultValue:`远端 SSH X11 组件与转发 · ${connectionLabel}`}))}</b><small>${esc(status)} · ${esc(sshX11.config_file || "/etc/ssh/sshd_config")}</small></div></div><div class="x11-forwarding-meta"><span>${esc(tr("common:x11.platform", {platform:macos ? "macOS" : "Linux", defaultValue:`平台：${macos ? "macOS" : "Linux"}`}))}</span><span>sshd: ${esc(sshX11.sshd_present ? tr("common:auto.detected", {defaultValue:"已检测"}) : tr("common:auto.not_detected", {defaultValue:"未检测到"}))}</span><span>${macos ? "XQuartz" : "xauth"}: ${esc(macos ? (sshX11.xquartz_installed ? tr("common:auto.installed", {defaultValue:"已安装"}) : tr("common:auto.not_installed", {defaultValue:"未安装"})) : (sshX11.xauth_path || tr("common:auto.not_detected", {defaultValue:"未检测到"})))}</span><span>XAuthLocation: ${esc(sshX11.xauth_location || tr("common:auto.not_set", {defaultValue:"未设置"}))}</span><span>DISPLAY ${esc(tr("common:x11.offset", {defaultValue:"偏移"}))}: ${esc(sshX11.x11_display_offset || tr("common:auto.unknown", {defaultValue:"未知"}))}</span></div>${missingXauthHint}<div class="actions"><button type="button" onclick="inspectSshX11Forwarding(${Number(connection.id)},'${sourceArg}')">${icon("refresh-cw")}<span>${esc(tr("common:actions.detect_again", {defaultValue:"重新检测"}))}</span></button>${installX11Components}${uninstallX11Components}${automaticAction}</div>${privilegeHint}</div>`;
}
