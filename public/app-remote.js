const REMOTE_PROTOCOL_META = {
  rdp:{label:"RDP", icon:"monitor-up", port:3389, action:"打开远程桌面"},
  vnc:{label:"VNC", icon:"monitor", port:5900, action:"打开远程桌面"},
  xdmcp:{label:"XDMCP", icon:"panels-top-left", port:177, action:"打开图形桌面"},
  ftp:{label:"FTP", icon:"folder-sync", port:21, action:"打开文件"},
  telnet:{label:"Telnet", icon:"square-terminal", port:23, action:"打开终端"},
  serial:{label:"串口", icon:"usb", port:0, action:"打开终端"}
};
const remoteTerminalSessions = new Map();
const remoteTerminalCounts = new Map();
const ftpProfileStates = new Map();
const vncSessions = new Map();
let vncFullscreenSessionKey = "";
let remoteDesktopRenderSerial = 0;
const VNC_CLIPBOARD_POLL_INTERVAL_MS = 900;
const VNC_CLIPBOARD_ECHO_GUARD_MS = 3000;
const remoteAdminGrantCache = new Map();
let noVncRfbPromise = null;
let xdmcpProgressTimer = null;
let linuxDesktopManagerState = {connectionId:0, diagnostics:null, sshX11:null, error:null, taskId:"", task:null, logs:[]};
let linuxDesktopTaskLogView = {taskId:"", expanded:false, follow:true, scrollTop:0};
const linuxDesktopTaskMonitors = new Map();
let pendingRemoteGroupSelectValue = "默认分组";

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
    notify("当前 SSH 连接没有关联的远程桌面连接", "info");
    return;
  }
  if (profiles.length === 1) {
    openRemoteProfile(profiles[0]);
    return;
  }
  showActionMenu(event, profiles.map(profile => ({
    label:`打开 ${REMOTE_PROTOCOL_META[profile.protocol]?.label || String(profile.protocol || "").toUpperCase()} · ${profile.name}`,
    icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-up",
    run:() => openRemoteProfile(profile)
  })));
}

function remoteDesktopJumpButtonHtml(connectionId) {
  const profiles = remoteDesktopProfilesForSshConnection(connectionId);
  if (!profiles.length) return "";
  const title = profiles.length === 1
    ? `打开远程桌面：${profiles[0].name}`
    : `打开关联远程桌面（${profiles.length} 个）`;
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
    label:`打开 ${REMOTE_PROTOCOL_META[profile.protocol]?.label || String(profile.protocol || "").toUpperCase()} · ${profile.name}`,
    icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-up",
    run:() => openRemoteProfile(profile)
  })));
}

function remoteDesktopSwitchButtonHtml(profile) {
  const profiles = remoteDesktopSwitchProfiles(profile?.id);
  const disabled = !profiles.length;
  const title = disabled
    ? "当前服务器没有其他远程桌面"
    : `切换到当前服务器的其他远程桌面（${profiles.length} 个）`;
  const handler = disabled ? "" : ` onclick="openRemoteDesktopSwitchMenu(event,${Number(profile?.id || 0)})"`;
  return `<button class="icon-button workspace-jump-button remote-desktop-switch-button" type="button" title="${escAttr(title)}" aria-label="${escAttr(title)}"${handler} ${disabled ? "disabled" : ""}>${icon("monitor-up")}</button>`;
}

function remoteWorkspaceJumpButtonsHtml(profile) {
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  const remoteSwitch = remoteDesktopSwitchButtonHtml(profile);
  if (!connectionId && !remoteSwitch) return "";
  return `<span class="workspace-jump-actions" aria-label="关联工作区">
    ${connectionId ? `<button class="icon-button workspace-jump-button" type="button" title="打开关联终端" aria-label="打开关联终端" onclick="openTerminal(${connectionId})">${icon("square-terminal")}</button>` : ""}
    ${connectionId ? `<button class="icon-button workspace-jump-button" type="button" title="打开关联 SFTP" aria-label="打开关联 SFTP" onclick="openSftp(${connectionId})">${icon("folder-open")}</button>` : ""}
    ${remoteSwitch}
  </span>`;
}

function openRemoteProfile(profile) {
  if (!profile) return;
  if (["rdp", "vnc", "xdmcp"].includes(profile.protocol)) return openRemoteDesktop(profile.id);
  if (profile.protocol === "ftp") return openFtpProfile(profile.id);
  return openRemoteTerminal(profile.id);
}

function remoteProfileOpenActionsForSsh(connectionId) {
  const connection = currentConnection(connectionId);
  return remoteProfilesForSshConnection(connection).map(profile => ({
    label:`打开 ${REMOTE_PROTOCOL_META[profile.protocol]?.label || String(profile.protocol || "").toUpperCase()} · ${profile.name}`,
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
  if (profile.protocol === "serial") return profile.options?.path || "未选择串口";
  if (profile.protocol === "xdmcp" && profile.options?.mode === "broadcast") return `局域网广播:${profile.port || 177}`;
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
  return `<div class="connection-test-status warning linux-desktop-missing-notice">${icon("monitor-off")}<span>未检测到可用的 Linux 图形桌面，${profile.protocol.toUpperCase()} 可能无法登录。</span><button type="button" onclick="openLinuxDesktopManagerForProfile(${id})">${icon("monitor-cog")}<span>前往 Linux 桌面管理</span></button></div>`;
}

function remoteDiagnosticStatusMarkup(message, options={}) {
  const tone = options.tone || "warning";
  const statusIcon = options.icon || (tone === "error" ? "circle-alert" : tone === "success" ? "circle-check" : "info");
  const title = String(options.title || "").trim();
  const actions = String(options.actions || "").trim();
  return `<div class="connection-test-status remote-diagnostic-status ${escAttr(tone)}"><span class="remote-diagnostic-icon">${icon(statusIcon)}</span><span class="remote-diagnostic-copy">${title ? `<b>${esc(title)}</b>` : ""}<span>${esc(message || "")}</span></span>${actions ? `<span class="remote-diagnostic-actions">${actions}</span>` : ""}</div>`;
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
    return remoteDiagnosticStatusMarkup(
      willing
        ? `已从 Terma 主机收到 ${endpoint} 的 XDMCP WILLING 响应，可新建图形登录。`
        : responded
          ? `${endpoint} 已返回 XDMCP 响应，但当前不接受图形登录（${probe.error || probe.response || "服务拒绝"}）。`
          : `${endpoint} 未返回 XDMCP Query 响应（${probe.error || "UDP 无响应"}）。UDP 防火墙或服务策略可能丢弃探测包，仍可直接尝试图形登录。`,
      {tone:willing ? "success" : responded ? "error" : "warning", icon:willing ? "radio-tower" : responded ? "circle-x" : "circle-help", title:willing ? "XDMCP 服务已响应" : responded ? "XDMCP 服务拒绝登录" : "未收到 XDMCP 响应"}
    );
  }
  return remoteDiagnosticStatusMarkup(
    probe.ok
      ? `已从 Terma 主机直连 ${endpoint}；可按协议启动客户端，SSH 仅用于 Linux 服务管理和深度诊断。`
      : `无法从 Terma 主机连接 ${endpoint}（${probe.error || "端口不可达"}）。请检查服务、防火墙和网络路由。`,
    {tone:probe.ok ? "success" : "error", icon:probe.ok ? "radio-tower" : "unplug", title:probe.ok ? `${String(profile?.protocol || "").toUpperCase()} 端口可达` : `${String(profile?.protocol || "").toUpperCase()} 端口不可达`}
  );
}

function renderLinuxDesktopMissingWorkspace(profile, key, diagnostics) {
  const view = $("view-remote-desktop");
  if (!view) return;
  view.innerHTML = `<div class="remote-desktop-launch"><div class="remote-desktop-icon">${icon(REMOTE_PROTOCOL_META[profile.protocol]?.icon || "monitor-off")}</div><h2>${esc(profile.name)}</h2><div class="cmd">${esc(remoteProfileEndpoint(profile))}</div>${linuxDesktopMissingNotice(profile, diagnostics)}<div class="actions"><button class="primary" type="button" onclick="openLinuxDesktopManagerForProfile(${profile.id})">${icon("monitor-cog")}<span>前往 Linux 桌面管理</span></button><button type="button" onclick="editRemoteProfile(${profile.id})">${icon("settings-2")}<span>连接设置</span></button></div><div class="muted">安装桌面后重新打开此连接，Terma 会重新检测远端图形环境。</div></div>`;
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
    {label:"从 SSH 连接生成…", icon:"server-cog", run:()=>showPrimary("connections")},
    {label:"X Server 管理", icon:"x11", run:()=>openXServerManager()},
    {separator:true},
    {label:"刷新其他连接", icon:"refresh-cw", run:()=>loadAll()}
  ]);
}

function linuxDesktopManagerConnectionIdForProfile(profile) {
  const sourceId = Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
  if (sourceId && currentConnection(sourceId)) return sourceId;
  const host = String(profile?.host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return Number(connections.find(item => String(item.ssh_host || "").trim().toLowerCase().replace(/^\[|\]$/g, "") === host)?.id || 0);
}

function remoteManagementCredentialRepairMarkup(profileId, error, surface) {
  if (typeof sshAuthenticationFailure !== "function" || !sshAuthenticationFailure(error)) return "";
  const profile = remoteProfileById(profileId);
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!connectionId) return "";
  return `<button type="button" data-action="remote-management-credential-repair" data-remote-profile-id="${Number(profileId)}" data-surface="${escAttr(surface || "")}">${icon("key-round")}<span>修复 SSH 管理凭据</span></button>`;
}

function remoteManagementSetupActionMarkup(profileId) {
  return `<button type="button" data-action="remote-management-new-ssh" data-remote-profile-id="${Number(profileId)}">${icon("server-cog")}<span>新建 SSH 管理连接</span></button>`;
}

function remoteManagementUnavailableMarkup(profile, message="") {
  const protocol = String(profile?.protocol || "远程").toUpperCase();
  const detail = message || `${protocol} 连接本身不依赖 SSH；关联 SSH 后可增加 Linux 服务安装、状态识别和凭据修复能力。`;
  return remoteDiagnosticStatusMarkup(detail, {
    tone:"warning",
    icon:"server-off",
    title:"未关联 SSH 管理连接",
    actions:remoteManagementSetupActionMarkup(profile?.id)
  });
}

function newRemoteManagementSshConnection(profileId) {
  const profile = remoteProfileById(profileId);
  if (!profile || newConnection(profile.group_name || "默认分组") === false) return false;
  const form = $("connectionForm");
  if (!form) return false;
  form.dataset.remoteProfileLinkId = String(profile.id);
  form.insertAdjacentHTML("afterbegin", `<div class="connection-test-status remote-management-link-notice">保存后会自动关联到“${esc(profile.name)}”，用于 Linux 服务管理和深度诊断；远程桌面密码不会复制到 SSH。</div>`);
  if ($("conn_name")) $("conn_name").value = `${profile.name} · SSH 管理`.slice(0, 120);
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
  notify(`已把 SSH 管理连接关联到 ${profile.name}`, "success");
  return true;
}

async function repairRemoteManagementCredentials(profileId, surface="") {
  const profile = remoteProfileById(profileId);
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!profile || !connectionId || typeof repairSshCredentials !== "function") {
    notify("没有找到此远程连接使用的 SSH 管理连接", "error");
    return false;
  }
  const retry = async () => {
    if (surface === "rdp") await inspectRdpServer(profile.id);
    else if (surface === "vnc") await inspectVncServer(profile.id);
    else if (surface === "xdmcp") await inspectXdmcpServer(profile.id);
  };
  return repairSshCredentials(connectionId, {
    context:`${String(surface || profile.protocol).toUpperCase()} 服务探测认证失败`,
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
    notify(error.message || "读取桌面管理任务失败", "error");
  }
}

function linuxDesktopManagerConnectionOptions(selectedId=0) {
  return (Array.isArray(connections) ? connections : []).map(connection => `<option value="${Number(connection.id)}" ${Number(connection.id) === Number(selectedId) ? "selected" : ""}>${esc(connection.name)} · ${esc(connection.ssh_user)}@${esc(connection.ssh_host)}</option>`).join("");
}

function linuxDesktopLabel(id) {
  return ({xfce:"XFCE", gnome:"GNOME", plasma:"KDE Plasma", mate:"MATE", cinnamon:"Cinnamon", lxqt:"LXQt"}[id] || id || "Linux 桌面");
}

const REMOTE_INSTALL_MODE_ORDER = ["online", "local-offline", "offline", "manual"];
const REMOTE_INSTALL_MODE_META = {
  online:{label:"在线安装", icon:"cloud-download", description:"由远端主机联网，通过系统包管理器直接安装。"},
  "local-offline":{label:"本机下载后离线安装", icon:"hard-drive-download", description:"仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；Terma 会在本机下载依赖并通过 SFTP 上传安装。"},
  offline:{label:"使用远端缓存", icon:"database-zap", description:"不访问软件源，只使用远端包管理器已经缓存的软件包。"},
  manual:{label:"手动安装/配置说明", icon:"book-open-check", description:"查看适合当前系统的命令、配置步骤和注意事项。"}
};

function remoteInstallPlanRoot(value={}) {
  const candidates = [value?.install_plan, value?.component_plan, value?.package_plan?.install_plan, value];
  return candidates.find(item => item && (Array.isArray(item.modes) || item.online || item.offline || item.local_offline || item.manual)) || {};
}

function remoteInstallPlanMode(value, modeId) {
  const plan = remoteInstallPlanRoot(value);
  const key = modeId === "local-offline" ? "local_offline" : modeId;
  const mode = plan[key] || (Array.isArray(plan.modes) ? plan.modes.find(item => String(item?.id || "") === modeId) : null) || {};
  const meta = REMOTE_INSTALL_MODE_META[modeId] || {label:modeId, icon:"package", description:""};
  const command = String(mode.command || "").trim();
  const available = modeId === "manual" ? true : mode.available === undefined ? Boolean(command) : Boolean(mode.available);
  return {
    id:modeId,
    label:meta.label,
    icon:meta.icon,
    description:String(mode.description || meta.description || ""),
    command,
    available,
    package_names:Array.isArray(mode.package_names) ? mode.package_names : []
  };
}

function remoteInstallModesMarkup(plan, runExpression, manualExpression="revealRemoteInstallManual(this)", actionKey="") {
  return `<div class="remote-install-modes" role="group" aria-label="安装方式">${REMOTE_INSTALL_MODE_ORDER.map(modeId => {
    const mode = remoteInstallPlanMode(plan, modeId);
    const action = modeId === "manual" ? manualExpression : runExpression(modeId);
    const actionAttr = actionKey && modeId !== "manual" ? ` data-ui-action-key="${escAttr(actionKey)}"` : "";
    return `<button type="button" class="remote-install-mode" data-install-mode="${modeId}"${actionAttr} onclick="${action}" ${mode.available ? "" : "disabled"}><span class="remote-install-mode-icon">${icon(mode.icon)}</span><span class="remote-install-mode-copy"><strong>${esc(mode.label)}</strong><small>${esc(mode.available ? mode.description : `${mode.description || "当前系统没有可用方案"} · 当前不可用`)}</small></span><span class="remote-install-mode-state">${modeId === "manual" ? icon("chevron-down") : mode.available ? icon("chevron-right") : "不可用"}</span></button>`;
  }).join("")}</div>`;
}

function remoteInstallManualMarkup(plan, options={}) {
  const steps = Array.isArray(options.steps) ? options.steps.filter(Boolean) : [];
  const localPackages = remoteInstallPlanMode(plan, "local-offline").package_names;
  const commands = [...new Set([
    ...(Array.isArray(options.commands) ? options.commands : []),
    remoteInstallPlanMode(plan, "online").command,
    remoteInstallPlanMode(plan, "offline").command
  ].map(value => String(value || "").trim()).filter(Boolean))];
  const manualOfflineStep = commands.length
    ? localPackages.length
      ? `如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载 ${localPackages.join("、")} 及全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。`
      : "如果远端和运行 Terma 的本机都无法联网，请在另一台与远端发行版、版本及 CPU 架构匹配的联网机器下载所需组件和全部依赖，再通过本地文件/SFTP 上传后按发行版的离线安装方式执行。"
    : "";
  const manualSteps = manualOfflineStep ? [...steps, manualOfflineStep] : steps;
  const note = String(options.note || "命令会按当前系统探测结果生成。执行前请确认远端已有可用的软件源或离线缓存，并保存正在运行的图形会话。")
  return `<details class="remote-install-manual"><summary>${icon("book-open-check")}<span>手动安装/配置说明</span></summary><div class="remote-install-manual-body">${manualSteps.length ? `<ol class="x11-install-steps">${manualSteps.map(item => `<li>${esc(item)}</li>`).join("")}</ol>` : ""}${commands.length ? `<label>参考命令</label>${commands.map(command => `<pre class="x11-install-command">${esc(command)}</pre>`).join("")}<button type="button" class="remote-install-copy" onclick="copyRemoteInstallCommands()">${icon("copy")}<span>复制参考命令</span></button>` : `<div class="connection-test-status warning">当前系统没有可自动生成的命令，请按照发行版的软件包管理器文档手动安装对应组件。</div>`}<div class="x11-install-note">${esc(note)}</div></div></details>`;
}

function revealRemoteInstallManual(button=null) {
  const details = button?.closest?.(".modal-card, .rdp-server-state")?.querySelector?.(".remote-install-manual") || $("modal")?.querySelector?.(".remote-install-manual");
  if (!details) return;
  details.open = true;
  details.scrollIntoView?.({block:"nearest", behavior:"smooth"});
}

async function copyRemoteInstallCommands() {
  const commands = Array.isArray($("modal")?._remoteInstallCommands) ? $("modal")._remoteInstallCommands : [];
  if (!commands.length) return notify("当前没有可复制的参考命令", "info");
  try {
    await copyText(commands.join("\n\n"));
    notify("参考命令已复制", "success");
  } catch (error) {
    notify(error.message || "复制参考命令失败", "error");
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
  if (status === "done") return {label:"已完成", icon:"circle-check", className:"success"};
  if (status === "failed") return {label:"失败", icon:"circle-alert", className:"error"};
  if (status === "cancelled") return {label:"已取消", icon:"circle-stop", className:"warning"};
  if (status === "pending") return {label:"准备中", icon:"package-clock", className:"running"};
  return {label:"执行中", icon:"loader-circle", className:"running"};
}

function remoteComponentTaskMarkup(task={}, options={}) {
  const state = remoteComponentTaskStatus(task);
  const rawProgress = Number(task.progress);
  const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;
  const title = String(task.action_label || options.title || task.component_label || "远程组件任务");
  const current = String(task.current || task.stage || state.label);
  const error = String(task.error || "").trim();
  return `<div class="remote-component-progress ${state.className}" role="status" aria-live="polite">
    <div class="remote-component-progress-head"><span class="remote-service-icon ${state.className}">${icon(state.icon)}</span><div><b>${esc(title)}</b><small>${esc(current)} · ${esc(state.label)}</small></div><strong>${Math.round(progress)}%</strong></div>
    <div class="remote-component-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
    ${error ? `<div class="connection-test-status error">${esc(error)}</div>` : ""}
    <div class="actions tight"><button type="button" onclick="toggleSftpTaskCenter(event)">${icon("list-checks")}<span>查看任务中心与日志</span></button></div>
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
  const runningLabel = String(result.task?.action_label || result.task?.component_label || "已有远端操作");
  if (result.conflict_same_action) {
    notify(`${runningLabel}任务已在执行，已接管当前进度`, "info");
    return true;
  }
  notify(`未执行${requestedLabel}：${result.error || result.task?.resource_conflict_message || `${runningLabel}任务正在执行`}`, "error");
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
        const failedTask = {...current, status:"failed", error:error.message || "远程组件任务状态读取失败"};
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

async function requestRemoteAdminAuthorization(connectionId, scopeLabel="远端管理", grantScope=scopeLabel) {
  const normalizedConnectionId = Number(connectionId || 0);
  const connection = currentConnection(normalizedConnectionId);
  if (!connection) throw new Error("SSH 连接不存在");
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
      <div class="modal-title-row"><div><h2 id="remoteAdminTitle">临时管理员授权</h2><span class="muted">${esc(scopeLabel)} · ${esc(connection.name || connection.ssh_host)}</span></div><button class="icon-button" type="button" data-admin-cancel title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status warning">账号、密码和私钥口令不会保存到连接、配置、日志或任务中心。选择免密复用时，程序内存中只保留临时授权标识。</div>
      <div class="grid remote-admin-grid"><div><label>管理员 SSH 账号</label><input id="remoteAdminUser" autocomplete="username" value="${escAttr(connection.ssh_user || "root")}" required></div><div><label>SSH 认证方式</label><select id="remoteAdminMethod"><option value="password" ${defaultMethod === "password" ? "selected" : ""}>密码</option><option value="key" ${defaultMethod === "key" ? "selected" : ""}>已有私钥</option><option value="agent">SSH Agent</option></select></div></div>
      <div id="remoteAdminPasswordBox"><label>SSH 密码</label><input id="remoteAdminPassword" type="password" autocomplete="current-password" placeholder="只在本次操作中使用"></div>
      <div id="remoteAdminKeyBox" hidden><label>私钥</label><select id="remoteAdminKey"><option value="">请选择 Terma 已识别的私钥</option>${identities.map(item => `<option value="${escAttr(item.path)}" ${item.path === defaultKey ? "selected" : ""}>${esc(item.label || item.name || item.path)}${item.permission_ok ? "" : "（权限需修复）"}</option>`).join("")}</select><label>私钥口令（可选）</label><input id="remoteAdminPassphrase" type="password" autocomplete="new-password" placeholder="没有口令可留空"></div>
      <div class="grid remote-admin-grid"><div><label>sudo 密码</label><select id="remoteAdminSudoMode"><option value="none" selected>不提供（仅 root/免密 sudo）</option><option value="same">与 SSH 密码相同</option><option value="separate">单独输入</option></select></div><div id="remoteAdminSudoPasswordBox" hidden><label>sudo 密码</label><input id="remoteAdminSudoPassword" type="password" autocomplete="current-password" placeholder="可留空尝试免密 sudo"></div></div>
      ${quickConnection ? `<div class="muted remote-admin-note">快速连接的管理员授权只用于这一次操作，不会复用或写入连接库。</div><input id="remoteAdminReusePolicy" type="hidden" value="once">` : `<div><label>再次使用时免密</label><select id="remoteAdminReusePolicy"><option value="once" selected>仅本次操作</option><option value="10m">10分钟内</option><option value="30m">30分钟内</option><option value="session">本次程序运行时</option></select></div>`}
      <div class="muted remote-admin-note">Terma 会先验证 SSH 登录和 root/sudo 能力，再执行限定的管理脚本。关闭程序后，所有临时授权都会失效。</div>
      <div class="actions"><button type="button" data-admin-cancel>取消</button><button class="primary" type="submit">授权并继续</button></div>
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
      if (!user) return notify("请输入管理员 SSH 账号", "error");
      if (authMethod === "password" && !sshPassword) return notify("请输入 SSH 密码", "error");
      if (authMethod === "key" && !key) return notify("请选择私钥", "error");
      submitting = true;
      cancelButtons.forEach(button => { button.disabled = true; });
      if (submitButton) setButtonBusy(submitButton, true, "验证中...");
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
        if (!grant?.id) throw new Error("临时管理员授权验证完成，但未返回授权标识");
        rememberRemoteAdminGrant(normalizedConnectionId, grant);
        finish({admin_grant_id:String(grant.id)});
      } catch (error) {
        notify(error.message || "临时管理员授权失败", "error");
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
  const connectionLabel = `${connection.name}${quickConnection ? "（临时）" : ""}`;
  const sourceArg = escAttr(source);
  if (sshX11?.error) {
    const authenticationFailed = typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(sshX11);
    const repairAction = !authenticationFailed ? "" : quickConnection
      ? `<button type="button" data-action="x11-quick-credential-repair" data-terminal-key="${escAttr(xServerManagerTerminalKey || "")}">${icon("key-round")}<span>修复临时 SSH 凭据</span></button>`
      : `<button type="button" data-action="x11-credential-repair" data-connection-id="${Number(connection.id)}" data-source="${sourceArg}">${icon("key-round")}<span>修复 SSH 凭据</span></button>`;
    return `<div class="x11-forwarding-panel warning"><div class="x11-forwarding-head"><span>${icon("circle-alert")}</span><div><b>远端 SSH X11 组件与转发 · ${esc(connectionLabel)}</b><small>${esc(sshX11.error)}</small></div></div>${repairAction ? `<div class="actions">${repairAction}</div>` : ""}</div>`;
  }
  const enabled = sshX11?.x11_forwarding === "yes";
  const macos = sshX11?.platform === "macos";
  const ready = Boolean(sshX11?.ready ?? (enabled && sshX11?.xauth_path));
  const status = enabled
    ? ready
      ? "已开启，xauth 配置可用"
      : macos && !sshX11?.xquartz_installed
        ? "已开启，但远端未安装 XQuartz"
        : macos && !sshX11?.xauth_location_valid
          ? "已开启，但 sshd 的 XAuthLocation 不可用"
          : "已开启，但未检测到 xauth"
    : sshX11?.x11_forwarding === "no" ? "已关闭" : "未能确定";
  const action = enabled ? "disable" : "enable";
  const actionKey = x11ForwardingActionKey(connection.id);
  const automaticAction = sshX11.can_manage
    ? `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon(action === "enable" ? "shield-check" : "shield-off")}<span>${action === "enable" ? "开启 X11 转发" : "关闭 X11 转发"}</span></button>`
    : `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon("key-round")}<span>临时授权后${action === "enable" ? "开启" : "关闭"}</span></button>${sshX11.can_terminal_manage && sshX11.terminal_commands?.[action] ? `<button type="button" onclick="openSshX11ConfigureTerminal(${Number(connection.id)},'${action}','${sourceArg}')">${icon("square-terminal")}<span>在终端手动${action === "enable" ? "开启" : "关闭"}</span></button>` : ""}`;
  const installX11Components = macos && !sshX11?.xquartz_installed
    ? `<button type="button" onclick="openRemoteX11ComponentsInstall(${Number(connection.id)})">${icon("package-plus")}<span>安装远端 XQuartz</span></button>`
    : !macos && !sshX11?.xauth_path
      ? `<button type="button" onclick="openRemoteX11ComponentsInstall(${Number(connection.id)})">${icon("package-plus")}<span>安装 xauth / X11 组件</span></button>`
      : "";
  const uninstallX11Components = !macos && sshX11?.xauth_path
    ? `<button class="danger" type="button" data-ui-action-key="${escAttr(x11ComponentsActionKey(connection.id))}" onclick="uninstallRemoteX11Components(${Number(connection.id)},this,'xserver')">${icon("package-minus")}<span>卸载 X11 组件</span></button>`
    : "";
  const privilegeHint = !sshX11.can_manage && sshX11.can_terminal_manage
    ? `<div class="x11-forwarding-hint">${quickConnection ? "后台探测使用当前临时凭据，不会保存连接或继承终端中的 sudo -i；管理员授权只用于这一次操作。" : "后台探测会使用保存的 SSH 账号建立独立连接，不会继承其他终端中的 sudo -i。通过终端操作时可正常输入 sudo 密码。"}</div>`
    : "";
  const missingXauthHint = enabled && !ready
    ? `<div class="x11-forwarding-hint warning">${macos ? "远端缺少可用的 XQuartz/xauth，SSH 可以连接，但图形窗口无法转发。" : "远端未检测到 xauth，sshd 无法为 X11 会话创建授权 Cookie；请安装后重新建立 X11 终端。"}</div>`
    : "";
  return `<div class="x11-forwarding-panel ${ready ? "ready" : enabled ? "warning" : ""}"><div class="x11-forwarding-head"><span>${icon(ready ? "circle-check" : enabled ? "circle-alert" : "circle-off")}</span><div><b>远端 SSH X11 组件与转发 · ${esc(connectionLabel)}</b><small>${esc(status)} · ${esc(sshX11.config_file || "/etc/ssh/sshd_config")}</small></div></div><div class="x11-forwarding-meta"><span>平台：${macos ? "macOS" : "Linux"}</span><span>sshd：${sshX11.sshd_present ? "已检测" : "未检测到"}</span><span>${macos ? "XQuartz" : "xauth"}：${macos ? (sshX11.xquartz_installed ? "已安装" : "未安装") : esc(sshX11.xauth_path || "未检测到")}</span><span>XAuthLocation：${esc(sshX11.xauth_location || "未设置")}</span><span>DISPLAY 偏移：${esc(sshX11.x11_display_offset || "未知")}</span></div>${missingXauthHint}<div class="actions"><button type="button" onclick="inspectSshX11Forwarding(${Number(connection.id)},'${sourceArg}')">${icon("refresh-cw")}<span>重新检测</span></button>${installX11Components}${uninstallX11Components}${automaticAction}</div>${privilegeHint}</div>`;
}
