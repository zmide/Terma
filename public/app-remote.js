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
let linuxDesktopManagerState = {connectionId:0, diagnostics:null, sshX11:null, taskId:"", task:null, logs:[]};
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

function remoteWorkspaceJumpButtonsHtml(profile) {
  const connectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  if (!connectionId) return "";
  return `<span class="workspace-jump-actions" aria-label="关联工作区">
    <button class="icon-button workspace-jump-button" type="button" title="打开关联终端" aria-label="打开关联终端" onclick="openTerminal(${connectionId})">${icon("square-terminal")}</button>
    <button class="icon-button workspace-jump-button" type="button" title="打开关联 SFTP" aria-label="打开关联 SFTP" onclick="openSftp(${connectionId})">${icon("folder-open")}</button>
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
  return `${user}${profile.host}:${profile.port}`;
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
  if (!diagnostics || diagnostics.platform_supported === false || diagnostics.has_desktop || !["rdp", "vnc", "xdmcp"].includes(profile?.protocol)) return "";
  const id = Number(profile.id || 0);
  return `<div class="connection-test-status warning linux-desktop-missing-notice">${icon("monitor-off")}<span>未检测到可用的 Linux 图形桌面，${profile.protocol.toUpperCase()} 可能无法登录。</span><button type="button" onclick="openLinuxDesktopManagerForProfile(${id})">${icon("monitor-cog")}<span>前往 Linux 桌面管理</span></button></div>`;
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
    {label:"X Server 管理", icon:"app-window", run:()=>openXServerManager()},
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

function reusableRemoteAdminGrant(connectionId) {
  const id = Number(connectionId || 0);
  const grant = remoteAdminGrantCache.get(id);
  if (!grant?.id) return null;
  const expiresAt = Number(grant.expires_at || 0);
  if (expiresAt > 0 && expiresAt <= Date.now()) {
    remoteAdminGrantCache.delete(id);
    return null;
  }
  return grant;
}

function rememberRemoteAdminGrant(connectionId, grant={}) {
  const id = Number(connectionId || 0);
  const policy = String(grant.reuse_policy || "once");
  if (!id || !grant.id || policy === "once") return;
  remoteAdminGrantCache.set(id, {
    id:String(grant.id),
    reuse_policy:policy,
    expires_at:Number(grant.expires_at || 0)
  });
}

async function requestRemoteAdminAuthorization(connectionId, scope="远端管理") {
  const normalizedConnectionId = Number(connectionId || 0);
  const connection = currentConnection(normalizedConnectionId);
  if (!connection) throw new Error("SSH 连接不存在");
  const cachedGrant = reusableRemoteAdminGrant(normalizedConnectionId);
  if (cachedGrant) return {admin_grant_id:cachedGrant.id};
  let identities = [];
  try { identities = await api("/api/identity-files"); } catch {}
  return new Promise(resolve => {
    const modal = $("modal");
    const defaultMethod = connection.has_password ? "password" : identities.length ? "key" : "agent";
    const defaultKey = identities.find(item => item.permission_ok)?.path || identities[0]?.path || "";
    modal.innerHTML = `<form class="modal-card remote-admin-modal" role="dialog" aria-modal="true" aria-labelledby="remoteAdminTitle">
      <div class="modal-title-row"><div><h2 id="remoteAdminTitle">临时管理员授权</h2><span class="muted">${esc(scope)} · ${esc(connection.name || connection.ssh_host)}</span></div><button class="icon-button" type="button" data-admin-cancel title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status warning">账号、密码和私钥口令不会保存到连接、配置、日志或任务中心。选择免密复用时，程序内存中只保留临时授权标识。</div>
      <div class="grid remote-admin-grid"><div><label>管理员 SSH 账号</label><input id="remoteAdminUser" autocomplete="username" value="${escAttr(connection.ssh_user || "root")}" required></div><div><label>SSH 认证方式</label><select id="remoteAdminMethod"><option value="password" ${defaultMethod === "password" ? "selected" : ""}>密码</option><option value="key" ${defaultMethod === "key" ? "selected" : ""}>已有私钥</option><option value="agent">SSH Agent</option></select></div></div>
      <div id="remoteAdminPasswordBox"><label>SSH 密码</label><input id="remoteAdminPassword" type="password" autocomplete="current-password" placeholder="只在本次操作中使用"></div>
      <div id="remoteAdminKeyBox" hidden><label>私钥</label><select id="remoteAdminKey"><option value="">请选择 Terma 已识别的私钥</option>${identities.map(item => `<option value="${escAttr(item.path)}" ${item.path === defaultKey ? "selected" : ""}>${esc(item.label || item.name || item.path)}${item.permission_ok ? "" : "（权限需修复）"}</option>`).join("")}</select><label>私钥口令（可选）</label><input id="remoteAdminPassphrase" type="password" autocomplete="new-password" placeholder="没有口令可留空"></div>
      <div class="grid remote-admin-grid"><div><label>sudo 密码</label><select id="remoteAdminSudoMode"><option value="none" selected>不提供（仅 root/免密 sudo）</option><option value="same">与 SSH 密码相同</option><option value="separate">单独输入</option></select></div><div id="remoteAdminSudoPasswordBox" hidden><label>sudo 密码</label><input id="remoteAdminSudoPassword" type="password" autocomplete="current-password" placeholder="可留空尝试免密 sudo"></div></div>
      <div><label>再次使用时免密</label><select id="remoteAdminReusePolicy"><option value="once" selected>仅本次操作</option><option value="10m">10分钟内</option><option value="30m">30分钟内</option><option value="session">本次程序运行时</option></select></div>
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
          body:JSON.stringify({
            connection_id:normalizedConnectionId,
            scope,
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
  if (sshX11?.error) return `<div class="x11-forwarding-panel warning"><div class="x11-forwarding-head"><span>${icon("circle-alert")}</span><div><b>SSH X11 转发</b><small>${esc(sshX11.error)}</small></div></div></div>`;
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
  const sourceArg = escAttr(source);
  const automaticAction = sshX11.can_manage
    ? `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon(action === "enable" ? "shield-check" : "shield-off")}<span>${action === "enable" ? "开启 X11 转发" : "关闭 X11 转发"}</span></button>`
    : `<button class="${action === "enable" ? "primary" : "danger"}" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="changeSshX11Forwarding('${action}',this,${Number(connection.id)},'${sourceArg}')">${icon("key-round")}<span>临时授权后${action === "enable" ? "开启" : "关闭"}</span></button>${sshX11.can_terminal_manage && sshX11.terminal_commands?.[action] ? `<button type="button" onclick="openSshX11ConfigureTerminal(${Number(connection.id)},'${action}','${sourceArg}')">${icon("square-terminal")}<span>在终端手动${action === "enable" ? "开启" : "关闭"}</span></button>` : ""}`;
  const installXQuartz = macos && !sshX11?.xquartz_installed
    ? `<button type="button" onclick="openRemoteXQuartzInstall(${Number(connection.id)})">${icon("package-plus")}<span>安装远端 XQuartz</span></button>`
    : "";
  const privilegeHint = !sshX11.can_manage && sshX11.can_terminal_manage
    ? `<div class="x11-forwarding-hint">后台探测会使用保存的 SSH 账号建立独立连接，不会继承其他终端中的 sudo -i。通过终端操作时可正常输入 sudo 密码。</div>`
    : "";
  return `<div class="x11-forwarding-panel ${ready ? "ready" : enabled ? "warning" : ""}"><div class="x11-forwarding-head"><span>${icon(ready ? "circle-check" : enabled ? "circle-alert" : "circle-off")}</span><div><b>SSH X11 转发 · ${esc(connection.name)}</b><small>${esc(status)} · ${esc(sshX11.config_file || "/etc/ssh/sshd_config")}</small></div></div><div class="x11-forwarding-meta"><span>平台：${macos ? "macOS" : "Linux"}</span><span>sshd：${sshX11.sshd_present ? "已检测" : "未检测到"}</span><span>${macos ? "XQuartz" : "xauth"}：${macos ? (sshX11.xquartz_installed ? "已安装" : "未安装") : esc(sshX11.xauth_path || "未检测到")}</span><span>XAuthLocation：${esc(sshX11.xauth_location || "未设置")}</span><span>DISPLAY 偏移：${esc(sshX11.x11_display_offset || "未知")}</span></div><div class="actions"><button type="button" onclick="inspectSshX11Forwarding(${Number(connection.id)},'${sourceArg}')">${icon("refresh-cw")}<span>重新检测</span></button>${installXQuartz}${automaticAction}</div>${privilegeHint}</div>`;
}

function openLinuxDesktopManager(connectionId=0, updateTab=true) {
  const normalizedConnectionId = Number(connectionId || 0);
  const sameConnection = Number(linuxDesktopManagerState.connectionId || 0) === normalizedConnectionId;
  const monitoredTask = activeLinuxDesktopMonitorForConnection(normalizedConnectionId)?.task || null;
  if (!sameConnection) {
    linuxDesktopManagerState = {
      connectionId:normalizedConnectionId,
      diagnostics:null,
      sshX11:null,
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
    <div class="linux-desktop-manager-toolbar"><label>SSH 管理连接<select id="linuxDesktopConnection" onchange="selectLinuxDesktopManagerConnection(this.value)"><option value="0">请选择 SSH 主机</option>${linuxDesktopManagerConnectionOptions(selected)}</select></label><button type="button" onclick="loadLinuxDesktopManager()" ${selected ? "" : "disabled"}>${icon("refresh-cw")}<span>重新探测</span></button></div>
    ${selected && diagnostics ? `<div class="linux-desktop-diagnostics ${macos ? state.sshX11?.ready ? "ready" : "warning" : diagnostics.has_desktop ? "ready" : "warning"}"><div><strong>${esc(diagnostics.connection?.name || "SSH 主机")}</strong><span>${macos ? "macOS · SSH X11 图形环境" : `${esc(diagnostics.os_id || "Linux")} · ${esc(diagnostics.package_manager || "未识别包管理器")} · ${esc(diagnostics.display_manager || "未识别显示管理器")}`}</span></div><span class="status-pill">${macos ? state.sshX11?.ready ? "X11 已就绪" : state.sshX11?.xquartz_installed ? "XQuartz 已安装，配置未完成" : "未安装 XQuartz" : diagnostics.has_desktop ? `已发现 ${diagnostics.desktops.length} 个桌面` : "未检测到图形桌面"}</span></div>
      ${platformSupported ? `${renderLinuxDesktopSelectionSummary(diagnostics)}<div class="linux-desktop-grid">${catalog.map(item => { const id = item.id; const available = installable.has(id); const isInstalled = installed.has(id); const enabled = (isInstalled || available) && !taskRunning; return `<article class="linux-desktop-card ${isInstalled ? "installed" : ""}" data-desktop-id="${escAttr(id)}"><div class="linux-desktop-card-icon">${icon(item.icon || "monitor")}</div><div><strong>${esc(item.label || linuxDesktopLabel(id))}</strong><span>${isInstalled ? "已安装，可用于图形会话" : available ? "可自动安装" : "当前包管理器未提供自动方案"}</span>${isInstalled ? renderLinuxDesktopUsageBadges(diagnostics, id) : ""}</div><button type="button" data-ui-action-key="${escAttr(actionKey)}" class="${enabled && !isInstalled ? "primary" : ""}" onclick="${isInstalled ? `uninstallLinuxDesktop('${escAttr(id)}',this)` : `installLinuxDesktop('${escAttr(id)}')`}" ${enabled ? "" : "disabled"}>${icon(isInstalled ? "trash-2" : "package-plus")}<span>${isInstalled ? "卸载" : "安装"}</span></button></article>`; }).join("")}</div>` : ""}
      ${renderSshX11ForwardingPanel(connection, state.sshX11, "linux-desktop")}
      <div class="linux-desktop-hint">${platformSupported ? "远程桌面不要求服务器连接物理显示器。RDP、XDMCP 和虚拟 VNC 需要远端能启动桌面会话；x11vnc/wayvnc 共享已有会话；SSH X11 单程序不需要完整桌面。配置标记不等于正在运行，只有“当前会话”或“VNC 会话”标记代表已探测到活动会话。" : macos ? "macOS 不安装 Linux 桌面环境。请使用上方的“安装远端 XQuartz”和“在终端开启 X11 转发”；出现 sudo 提示时输入远端 macOS 账号密码。" : "当前 SSH 主机不是 Linux，不能在此主机上安装 Linux 桌面环境。"}</div>` : `<div class="connection-test-status">请选择一个 SSH 主机开始探测。</div>`}
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
  try {
    const [diagnostics, sshX11] = await Promise.all([
      api(`/api/connections/${id}/linux-desktop`),
      api(`/api/connections/${id}/x11-forwarding`).catch(error => ({error:error.message || "SSH X11 配置探测失败"}))
    ]);
    if (Number(linuxDesktopManagerState.connectionId || 0) !== id) return;
    linuxDesktopManagerState.diagnostics = diagnostics;
    linuxDesktopManagerState.sshX11 = sshX11;
    renderLinuxDesktopManager();
  } catch (error) {
    if (Number(linuxDesktopManagerState.connectionId || 0) !== id) return;
    linuxDesktopManagerState.diagnostics = null;
    renderLinuxDesktopManager();
    notify(error.message || "Linux 桌面探测失败", "error");
  }
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

function showRemoteProfileFromSshMenu(event, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  showActionMenu(event, remoteProfileFromSshActions(connectionId));
}

function remoteProfileFromSshActions(connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return [];
  return [
    {label:"生成全部连接", icon:"layers-3", run:()=>createAllRemoteProfilesFromSsh(connectionId)},
    {separator:true},
    ...Object.entries(REMOTE_PROTOCOL_META)
      .filter(([protocol]) => protocol !== "serial")
      .map(([protocol, meta]) => ({
        label:`生成 ${meta.label} 连接`,
        icon:meta.icon,
        run:()=>createRemoteProfileFromSsh(connectionId, protocol)
      })),
    {separator:true},
    {label:"串口连接需单独选择本机设备", icon:"usb", run:()=>{ showPrimary("remote"); newRemoteProfile("serial", connection.group_name); }}
  ];
}

async function createRemoteProfileFromSsh(connectionId, protocol) {
  const result = await api(`/api/connections/${connectionId}/remote-profiles`, {
    method:"POST",
    body:JSON.stringify({protocol})
  });
  await loadAll();
  selectedRemoteProfileId = Number(result.id || 0) || null;
  const profile = remoteProfileById(result.id);
  if (profile) revealRemoteProfile(profile);
  showPrimary("remote");
  notify(result.created === false ? `已存在 ${result.name}，已切换到其他连接` : `已生成 ${result.name}`, result.created === false ? "info" : "success");
  return result;
}

async function createAllRemoteProfilesFromSsh(connectionId) {
  const result = await api(`/api/connections/${connectionId}/remote-profiles`, {
    method:"POST",
    body:JSON.stringify({protocol:"all"})
  });
  await loadAll();
  const items = Array.isArray(result.results) ? result.results : [];
  const first = items.find(item => item.created) || items[0];
  selectedRemoteProfileId = Number(first?.id || 0) || null;
  const profile = remoteProfileById(first?.id);
  if (profile) revealRemoteProfile(profile);
  showPrimary("remote");
  const created = Number(result.created_count || 0);
  const existing = Number(result.existing_count || 0);
  notify(created
    ? `已生成 ${created} 个连接${existing ? `，${existing} 个已存在` : ""}`
    : "这些连接都已存在，已切换到其他连接", created ? "success" : "info");
  return result;
}

function renderRemoteProfileRow(profile) {
  const meta = REMOTE_PROTOCOL_META[profile.protocol] || {label:profile.protocol.toUpperCase(),icon:"plug",action:"打开"};
  const active = selectedRemoteProfileId === profile.id ? " active" : "";
  const graphical = ["rdp", "vnc", "xdmcp"].includes(profile.protocol);
  const primary = graphical
    ? `openRemoteDesktop(${profile.id})`
    : profile.protocol === "ftp"
      ? `openFtpProfile(${profile.id})`
      : `openRemoteTerminal(${profile.id})`;
  const capability = profile.protocol === "rdp"
    ? "本机 RDP"
    : profile.protocol === "vnc"
      ? (profile.options?.client_mode === "system" ? "系统客户端" : "内置桌面")
      : profile.protocol === "xdmcp" ? "内置 XDMCP"
      : profile.protocol === "ftp" ? "内置文件" : "内置终端";
  const sourceConnection = connections.find(connection => Number(connection.id) === Number(profile.options?.source_ssh_connection_id));
  const sourceTitle = sourceConnection ? ` · 来自 SSH：${sourceConnection.name}` : "";
  const displayName = sourceConnection ? sourceConnection.name : profile.name;
  return `<div class="conn-row remote-profile-row${active}" data-remote-profile-id="${profile.id}">
    <div class="conn-main"><span class="conn-name" title="${escAttr(profile.name)}">${esc(displayName)}</span><span class="protocol-badge protocol-${escAttr(profile.protocol)}">${icon(meta.icon)} ${esc(meta.label)}</span></div>
    <div class="conn-meta" title="${escAttr(remoteProfileEndpoint(profile))}">${esc(remoteProfileEndpoint(profile))}</div>
    ${profile.tags ? `<div class="forward-tags">${String(profile.tags).split(",").filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
    <div class="conn-footer">
      <div class="conn-summary"><span title="${escAttr(capability + sourceTitle)}">${icon(["rdp","vnc","xdmcp"].includes(profile.protocol) ? "external-link" : "layers-2")} ${capability}</span>${sourceConnection ? `<span class="remote-source-badge" title="来源：${escAttr(sourceConnection.name)}">${icon("server-cog")}</span>` : ""}</div>
      <div class="conn-actions" aria-label="${escAttr(profile.name)} 快捷操作">
        <button class="icon-button conn-primary-action" onclick="${primary}" title="${meta.action}" aria-label="${meta.action}">${icon(meta.icon)}</button>
        <button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="编辑连接" aria-label="编辑连接">${icon("pencil")}</button>
        <button class="icon-button connection-favorite${profile.favorite ? " active" : ""}" onclick="toggleRemoteProfileFavorite(event,${profile.id},${profile.favorite ? 0 : 1})" title="${profile.favorite ? "取消收藏" : "收藏连接"}" aria-label="${profile.favorite ? "取消收藏" : "收藏连接"}" aria-pressed="${profile.favorite ? "true" : "false"}">${icon("star")}</button>
        <button class="icon-button" onclick="showRemoteProfileMenu(event,${profile.id})" title="更多操作" aria-label="更多操作">${icon("ellipsis")}</button>
      </div>
    </div>
  </div>`;
}

function showRemoteProfileMenu(event, id) {
  const profile = remoteProfileById(id);
  if (!profile) return;
  const openAction = ["rdp", "vnc", "xdmcp"].includes(profile.protocol)
    ? () => openRemoteDesktop(id)
    : profile.protocol === "ftp"
      ? () => openFtpProfile(id)
      : () => openRemoteTerminal(id);
  showActionMenu(event, [
    {label:REMOTE_PROTOCOL_META[profile.protocol]?.action || "打开", icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "plug", run:openAction},
    {label:"测试连接", icon:"activity", run:()=>testRemoteProfile(id)},
    {separator:true},
    {label:"复制", icon:"copy", run:()=>duplicateRemoteProfile(id)},
    {label:"编辑连接", icon:"pencil", run:()=>editRemoteProfile(id)},
    {label:"删除连接", icon:"trash-2", danger:true, run:()=>deleteRemoteProfile(id)}
  ]);
}

async function toggleRemoteProfileFavorite(event, id, favorite) {
  event?.stopPropagation?.();
  await api(`/api/remote-profiles/${id}/flags`, {method:"POST", body:JSON.stringify({favorite})});
  await loadAll();
}

async function duplicateRemoteProfile(id) {
  const result = await api(`/api/remote-profiles/${id}/duplicate`, {method:"POST"});
  const source = remoteProfileById(id);
  if (source) revealRemoteProfile(source);
  await loadAll();
  notify(`已复制为 ${result.name}`, "success");
}

async function deleteRemoteProfile(id) {
  const profile = remoteProfileById(id);
  if (!profile || !await confirmModal(`删除连接 ${profile.name}？`, "删除远程连接", "删除", "取消", true)) return;
  await api(`/api/remote-profiles/${id}`, {method:"DELETE"});
  selectedRemoteProfileId = null;
  await loadAll();
  renderWelcome();
  notify("已删除连接", "success");
}

async function testRemoteProfile(id, button=null) {
  if (button) setButtonBusy(button, true, "测试中...");
  try {
    const result = await api(`/api/remote-profiles/${id}/test`, {method:"POST", body:"{}"});
    notify(result.ok ? (result.message || "连接测试通过") : (result.message || "连接测试失败"), result.ok ? "success" : "error");
    return result;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

const REMOTE_RESOLUTION_PRESETS = Object.freeze([
  [1024,768,"XGA · 4:3"],
  [1280,720,"HD · 720p"],
  [1280,800,"WXGA · 16:10"],
  [1366,768,"HD"],
  [1440,900,"WXGA+ · 16:10"],
  [1600,900,"HD+"],
  [1680,1050,"WSXGA+ · 16:10"],
  [1920,1080,"Full HD · 1080p"],
  [1920,1200,"WUXGA · 16:10"],
  [2048,1080,"DCI 2K"],
  [2560,1080,"超宽屏"],
  [2560,1440,"QHD · 1440p"],
  [2560,1600,"WQXGA · 16:10"],
  [3440,1440,"超宽屏"],
  [3840,1080,"双 Full HD"],
  [3840,1600,"超宽屏"],
  [3840,2160,"4K UHD"],
  [4096,2160,"DCI 4K"],
  [5120,1440,"双 QHD"],
  [5120,2880,"5K"],
  [7680,4320,"8K UHD"]
]);

function normalizedRdpDisplayMode(options={}) {
  const mode = String(options.display_mode || "");
  if (["dynamic","fullscreen","fixed"].includes(mode)) return mode;
  if (Object.prototype.hasOwnProperty.call(options, "fullscreen")) return options.fullscreen === false ? "fixed" : "fullscreen";
  return "dynamic";
}

function normalizedXdmcpWindowMode(options={}) {
  const mode = String(options.window_mode || "");
  if (["resizable","fullscreen","fixed"].includes(mode)) return mode;
  return mode === "windowed" ? "fixed" : "resizable";
}

function remoteResolutionPreset(options={}) {
  const width = Math.round(Number(options.width || 1440));
  const height = Math.round(Number(options.height || 900));
  return REMOTE_RESOLUTION_PRESETS.some(([presetWidth,presetHeight]) => presetWidth === width && presetHeight === height)
    ? `${width}x${height}`
    : "custom";
}

function remoteResolutionOptionsMarkup(options={}) {
  const selected = remoteResolutionPreset(options);
  return `${REMOTE_RESOLUTION_PRESETS.map(([width,height,label]) => {
    const value = `${width}x${height}`;
    return `<option value="${value}" ${selected === value ? "selected" : ""}>${width} × ${height} · ${label}</option>`;
  }).join("")}<option value="custom" ${selected === "custom" ? "selected" : ""}>自定义宽高</option>`;
}

function remoteResolutionFieldsMarkup(prefix, options={}, visible=false) {
  const custom = remoteResolutionPreset(options) === "custom";
  return `<div id="${prefix}_resolution_options" class="remote-resolution-options" ${visible ? "" : "hidden"}>
    <label>固定分辨率</label>
    <select id="${prefix}_resolution_preset" onchange="applyRemoteResolutionPreset('${prefix}')">${remoteResolutionOptionsMarkup(options)}</select>
    <div id="${prefix}_custom_resolution" class="grid remote-resolution-custom" ${custom ? "" : "hidden"}>
      <div><label>宽度</label><input id="${prefix}_width" type="number" min="640" max="8192" value="${Number(options.width || 1440)}"></div>
      <div><label>高度</label><input id="${prefix}_height" type="number" min="480" max="8192" value="${Number(options.height || 900)}"></div>
    </div>
  </div>`;
}

function syncRemoteResolutionFields(prefix, modeId) {
  const visible = $(modeId)?.value === "fixed";
  const options = $(`${prefix}_resolution_options`);
  if (options) options.hidden = !visible;
  const custom = $(`${prefix}_custom_resolution`);
  if (custom) custom.hidden = !visible || $(`${prefix}_resolution_preset`)?.value !== "custom";
}

function applyRemoteResolutionPreset(prefix) {
  const preset = $(`${prefix}_resolution_preset`)?.value || "custom";
  if (preset !== "custom") {
    const [width,height] = preset.split("x").map(Number);
    if ($(`${prefix}_width`)) $(`${prefix}_width`).value = String(width);
    if ($(`${prefix}_height`)) $(`${prefix}_height`).value = String(height);
  }
  const custom = $(`${prefix}_custom_resolution`);
  if (custom) custom.hidden = preset !== "custom";
}

function syncRemoteQualityValue(input) {
  const output = $("remote_quality_value");
  if (output) output.textContent = String(Math.max(0, Math.min(9, Number(input?.value ?? 8))));
}

function remoteDesktopProtocolGuideMarkup(protocol, diagnostics=null, profile=null) {
  if (protocol === "rdp") {
    const sourceId = Number(diagnostics?.ssh_connection?.id || profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
    const sourceConnection = sourceId ? currentConnection(sourceId) : null;
    const loginUser = String(profile?.username || sourceConnection?.ssh_user || diagnostics?.ssh_connection?.user || diagnostics?.ssh_connection?.ssh_user || diagnostics?.connection?.ssh_user || "").trim();
    const loginHint = loginUser
      ? `XRDP 登录使用远端 Linux 桌面账号：${loginUser}。`
      : "XRDP 登录使用远端 Linux 桌面账号，不是临时管理员授权的 root 密码、VNC 密码或 Windows 当前账号。";
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("badge-check")}</span><div><span class="remote-protocol-guide-tag">推荐</span><strong>xrdp 使用 Xorg/xorgxrdp</strong><small>默认优先选择 Xorg；登录器里的 Xvnc 是兼容后端，仅在 Xorg 后端不可用时使用。</small><small>${esc(loginHint)}${loginUser ? " 不要填写临时管理员授权密码、VNC 密码或 Windows 当前账号。" : ""}</small></div></div>`;
  }
  if (protocol === "vnc") {
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("panels-top-left")}</span><div><span class="remote-protocol-guide-tag">桌面关系</span><strong>共享来源用 x11vnc，独立来源用 TigerVNC</strong><small>物理桌面和 XRDP 会话由 x11vnc 镜像；TigerVNC 创建新的独立 X11 桌面。日志中的 Xtigervnc/Xvnc 是底层进程名，不是另一套需要单独部署的产品。</small><small class="remote-protocol-guide-risk">RDP、VNC、XDMCP 的端口互不冲突；同一 Linux 用户并跑 XRDP 与 TigerVNC 可能争用 HOME、DBus 或桌面单实例，独立 VNC 推荐使用单独的普通用户。</small></div></div>`;
  }
  if (protocol === "xdmcp") {
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("monitor-up")}</span><div><span class="remote-protocol-guide-tag">本机要求</span><strong>运行 Terma 的设备必须有可用的本机 X Server</strong><small>Linux 常用 Xephyr，macOS 使用 XQuartz，Windows 需要已安装并启动的 X Server；XDMCP 不依赖 SSH X11 转发，后者也不是 XDMCP 客户端。</small></div></div>`;
  }
  return "";
}

function remoteProtocolOptionsMarkup(protocol, options={}) {
  if (protocol === "rdp") {
    const displayMode = normalizedRdpDisplayMode(options);
    return `<div class="grid"><div><label>显示方式</label><select id="remote_rdp_display_mode" onchange="syncRemoteResolutionFields('remote_rdp','remote_rdp_display_mode')"><option value="dynamic" ${displayMode === "dynamic" ? "selected" : ""}>自动跟随窗口（推荐）</option><option value="fullscreen" ${displayMode === "fullscreen" ? "selected" : ""}>全屏</option><option value="fixed" ${displayMode === "fixed" ? "selected" : ""}>固定分辨率</option></select></div><div><label>声音</label><select id="remote_audio"><option value="local" ${options.audio !== "remote" && options.audio !== "off" ? "selected" : ""}>在本机播放</option><option value="remote" ${options.audio === "remote" ? "selected" : ""}>在远端播放</option><option value="off" ${options.audio === "off" ? "selected" : ""}>关闭</option></select></div></div>${remoteResolutionFieldsMarkup("remote_rdp", options, displayMode === "fixed")}<div class="remote-display-help">自动模式会让 RDP 桌面随客户端窗口变化；固定模式可选常用、超宽、2K、4K、5K、8K 或自定义尺寸。</div><div class="grid"><div><label>域</label><input id="remote_domain" value="${escAttr(options.domain || "")}" placeholder="可选"></div><div class="check-grid"><label class="checkline"><input id="remote_clipboard" type="checkbox" ${options.clipboard !== false ? "checked" : ""}>共享剪贴板</label><label class="checkline"><input id="remote_admin_session" type="checkbox" ${options.admin_session ? "checked" : ""}>管理会话</label></div></div>${remoteDesktopProtocolGuideMarkup("rdp")}`;
  }
  if (protocol === "vnc") {
    const displayMode = ["scale","original","resize"].includes(String(options.display_mode)) ? String(options.display_mode) : "scale";
    const quality = Math.max(0, Math.min(9, Number(options.quality ?? 8)));
    return `<div class="grid3 remote-display-grid"><div><label>打开方式</label><select id="remote_vnc_client_mode"><option value="auto" ${!["embedded","system"].includes(options.client_mode) ? "selected" : ""}>自动（优先内置）</option><option value="embedded" ${options.client_mode === "embedded" ? "selected" : ""}>Terma 内置</option><option value="system" ${options.client_mode === "system" ? "selected" : ""}>系统客户端</option></select></div><div><label>显示方式</label><select id="remote_vnc_display_mode"><option value="scale" ${displayMode === "scale" ? "selected" : ""}>适应窗口（推荐）</option><option value="original" ${displayMode === "original" ? "selected" : ""}>原始像素</option><option value="resize" ${displayMode === "resize" ? "selected" : ""}>跟随窗口（服务器支持时）</option></select></div><div><label>鼠标模式</label><select id="remote_vnc_cursor_mode"><option value="auto" ${!["show","hide"].includes(options.cursor_mode) ? "selected" : ""}>自动（按远端平台）</option><option value="show" ${options.cursor_mode === "show" ? "selected" : ""}>手动显示本地光标</option><option value="hide" ${options.cursor_mode === "hide" ? "selected" : ""}>手动隐藏本地光标</option></select></div></div><div class="remote-quality-setting"><div class="remote-quality-heading"><label for="remote_quality">画质</label><output id="remote_quality_value" for="remote_quality">${quality}</output></div><input id="remote_quality" type="range" min="0" max="9" step="1" value="${quality}" oninput="syncRemoteQualityValue(this)"><div class="remote-quality-scale"><span>0 · 更省流量</span><span>9 · 更清晰</span></div></div><div class="remote-display-help">画质控制 JPEG 压缩质量，与分辨率不是同一项；两者越高通常越占带宽。VNC 由服务器按变化发送画面，没有通用且可靠的固定帧率设置。</div><div class="check-grid"><label class="checkline"><input id="remote_shared" type="checkbox" ${options.shared !== false ? "checked" : ""}>共享会话</label><label class="checkline"><input id="remote_view_only" type="checkbox" ${options.view_only ? "checked" : ""}>仅查看</label></div>${remoteDesktopProtocolGuideMarkup("vnc")}<div class="grid"><div><label>SSH 剪贴板辅助</label><select id="remote_vnc_ssh_connection"><option value="0">自动匹配同主机</option>${xdmcpManagementConnectionOptions(options.source_ssh_connection_id)}</select></div><div class="connection-test-status">用于可靠传输中文剪贴板；Linux 还需 xclip/xsel 或 wl-clipboard。</div></div>`;
  }
  if (protocol === "xdmcp") {
    const windowMode = normalizedXdmcpWindowMode(options);
    return `<div class="grid3 remote-display-grid"><div><label>连接方式</label><select id="remote_xdmcp_mode"><option value="query" ${options.mode !== "indirect" && options.mode !== "broadcast" ? "selected" : ""}>直接查询</option><option value="indirect" ${options.mode === "indirect" ? "selected" : ""}>间接查询</option><option value="broadcast" ${options.mode === "broadcast" ? "selected" : ""}>局域网广播</option></select></div><div><label>显示方式</label><select id="remote_xdmcp_window_mode" onchange="syncRemoteResolutionFields('remote_xdmcp','remote_xdmcp_window_mode')"><option value="resizable" ${windowMode === "resizable" ? "selected" : ""}>可调整窗口（支持时）</option><option value="fullscreen" ${windowMode === "fullscreen" ? "selected" : ""}>全屏</option><option value="fixed" ${windowMode === "fixed" ? "selected" : ""}>固定分辨率</option></select></div><div><label>SSH 管理连接</label><select id="remote_xdmcp_ssh_connection"><option value="0">自动匹配同主机</option>${xdmcpManagementConnectionOptions(options.ssh_connection_id)}</select></div></div>${remoteResolutionFieldsMarkup("remote_xdmcp", options, windowMode === "fixed")}<div class="grid"><div><label>本地地址</label><input id="remote_xdmcp_local_address" value="${escAttr(options.local_address || "")}" placeholder="自动选择"></div><div class="remote-display-help">Linux 和 macOS 的 Xephyr 可随窗口调整；Windows 会使用所选初始尺寸打开，不能可靠动态调整。XDMCP/X11 没有通用帧率限制。</div></div><div class="xdmcp-session-auto">${icon("sparkles")}<span>桌面会话由远端登录界面自动提供</span></div>${remoteDesktopProtocolGuideMarkup("xdmcp")}<div class="connection-test-status">SSH 管理连接可使用私钥、SSH Agent 或密码完成探测和配置；XDMCP 图形登录由远端显示管理器验证，通常仍需输入桌面账号和密码。</div><div class="connection-test-status warning">XDMCP 不加密，只应在可信局域网使用；跨公网请使用 SSH X11、RDP 或 VNC。</div>`;
  }
  if (protocol === "ftp") return `<div class="grid"><div><label>传输安全</label><select id="remote_ftp_secure"><option value="none" ${options.secure !== "explicit" && options.secure !== "implicit" ? "selected" : ""}>FTP（不加密）</option><option value="explicit" ${options.secure === "explicit" ? "selected" : ""}>显式 FTPS</option><option value="implicit" ${options.secure === "implicit" ? "selected" : ""}>隐式 FTPS</option></select></div><div><label>默认目录</label><input id="remote_base_path" value="${escAttr(options.base_path || "/")}" placeholder="/"></div></div><div class="check-grid"><span class="protocol-mode-note">FTP 固定使用被动模式，兼容常见 NAT 和防火墙环境。</span><label class="checkline"><input id="remote_reject_unauthorized" type="checkbox" ${options.reject_unauthorized !== false ? "checked" : ""}>验证 TLS 证书</label></div>`;
  if (protocol === "telnet") return `<div class="grid"><div><label>终端类型</label><input id="remote_terminal_type" value="${escAttr(options.terminal_type || "xterm-256color")}"></div><div><label>字符编码</label>${remoteEncodingSelect("remote_encoding", options.encoding || "utf8")}</div></div><div class="connection-test-status warning">Telnet 不加密用户名、密码和终端内容，只应在可信内网或加密隧道中使用。</div>`;
  return `<div class="grid"><div><label>串口设备</label><div class="upload-line"><input id="remote_serial_path" list="remoteSerialPorts" value="${escAttr(options.path || "")}" placeholder="COM3 或 /dev/ttyUSB0"><button type="button" onclick="loadRemoteSerialPorts()">${icon("refresh-cw")}<span>扫描</span></button></div><datalist id="remoteSerialPorts"></datalist></div><div><label>波特率</label><input id="remote_baud_rate" type="number" min="50" max="4000000" value="${Number(options.baud_rate || 115200)}"></div></div><div class="grid3"><div><label>数据位</label><select id="remote_data_bits">${[8,7,6,5].map(value => `<option value="${value}" ${Number(options.data_bits || 8) === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label>停止位</label><select id="remote_stop_bits">${[1,1.5,2].map(value => `<option value="${value}" ${Number(options.stop_bits || 1) === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label>校验位</label><select id="remote_parity">${[["none","无"],["even","偶"],["odd","奇"],["mark","Mark"],["space","Space"]].map(([value,label]) => `<option value="${value}" ${String(options.parity || "none") === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="grid"><div><label>字符编码</label>${remoteEncodingSelect("remote_encoding", options.encoding || "utf8")}</div><div class="check-grid"><label class="checkline"><input id="remote_rts_cts" type="checkbox" ${options.rts_cts ? "checked" : ""}>RTS/CTS</label><label class="checkline"><input id="remote_xon" type="checkbox" ${options.xon ? "checked" : ""}>XON</label><label class="checkline"><input id="remote_xoff" type="checkbox" ${options.xoff ? "checked" : ""}>XOFF</label></div></div>`;
}

function xdmcpManagementConnectionOptions(selectedId=0) {
  const selected = Number(selectedId || 0);
  return (Array.isArray(connections) ? connections : []).map(connection => {
    const endpoint = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`;
    return `<option value="${Number(connection.id)}" ${Number(connection.id) === selected ? "selected" : ""}>${esc(connection.name)} · ${esc(endpoint)}</option>`;
  }).join("");
}

function remoteEncodingSelect(id, selected) {
  const options = [["utf8","UTF-8"],["gb18030","GB18030"],["gbk","GBK"],["big5","Big5"],["shift_jis","Shift_JIS"],["euc-kr","EUC-KR"],["latin1","ISO-8859-1"]];
  return `<select id="${id}">${options.map(([value,label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
}

function renderRemoteProfileForm(profile={}) {
  const protocol = profile.protocol || "rdp";
  const meta = REMOTE_PROTOCOL_META[protocol];
  const passwordHint = profile.has_password ? "留空表示保持已保存密码" : "可选";
  $("view-edit").innerHTML = `<div class="panel remote-profile-editor"><form id="remoteProfileForm">
    <input id="remote_id" type="hidden" value="${Number(profile.id || 0) || ""}">
    <input id="remote_source_ssh_connection_id" type="hidden" value="${Number(profile.options?.source_ssh_connection_id || 0)}">
    <div class="workspace-head"><div><h2>${profile.id ? `编辑 ${esc(meta.label)} 连接` : `添加 ${esc(meta.label)} 连接`}</h2><div class="subtitle">协议配置只显示实际需要的字段。</div></div><span class="protocol-badge protocol-${protocol}">${icon(meta.icon)} ${esc(meta.label)}</span></div>
    <div class="grid3"><div><label>协议</label><select id="remote_protocol" onchange="changeRemoteProfileProtocol()">${Object.entries(REMOTE_PROTOCOL_META).map(([value,item]) => `<option value="${value}" ${protocol === value ? "selected" : ""}>${item.label}</option>`).join("")}</select></div><div><label>名称</label><input id="remote_name" required value="${escAttr(profile.name || "")}" placeholder="${meta.label} 连接"></div><div><label>分组</label><select id="remote_group" onchange="handleRemoteGroupSelectChange(this)">${groupNames(profile.group_name || "默认分组", "remote").map(name => `<option value="${escAttr(name)}" ${name === (profile.group_name || "默认分组") ? "selected" : ""}>${esc(name)}</option>`).join("")}<option value="__new_group__">新增分组...</option></select></div></div>
    <div id="remoteNetworkFields" class="grid" ${protocol === "serial" ? "hidden" : ""}><div><label>目标主机</label><input id="remote_host" value="${escAttr(profile.host || "")}" placeholder="example.com"></div><div><label>端口</label><input id="remote_port" type="number" min="1" max="65535" value="${Number(profile.port || meta.port || 0) || ""}"></div></div>
    <div id="remoteCredentialFields" class="grid" ${["telnet","serial","xdmcp"].includes(protocol) ? "hidden" : ""}><div><label>用户名</label><input id="remote_username" value="${escAttr(profile.username || (protocol === "ftp" ? "anonymous" : ""))}" autocomplete="username"></div><div id="remotePasswordField" ${protocol === "rdp" ? "hidden" : ""}><label>密码</label><input id="remote_password" type="password" autocomplete="new-password" placeholder="${escAttr(passwordHint)}"><label class="checkline" ${profile.has_password ? "" : "hidden"}><input id="remote_clear_password" type="checkbox">清除已保存密码</label></div></div>
    <div id="remoteDesktopCredentialNote" class="connection-test-status" ${["rdp","vnc"].includes(protocol) ? "" : "hidden"}>${protocol === "vnc" ? "VNC 密码可选保存并加密存储；留空时会在连接时询问。" : "RDP 凭据由系统客户端提示或保存，不会放入启动命令。"}</div>
    <label>标签</label><input id="remote_tags" value="${escAttr(profile.tags || "")}" placeholder="例如：办公 内网 图形桌面">
    <fieldset><legend>${esc(meta.label)} 选项</legend><div id="remoteProtocolOptions">${remoteProtocolOptionsMarkup(protocol, profile.options || {})}</div></fieldset>
    <div class="actions"><button class="primary" type="submit">${icon("save")}<span>保存连接</span></button>${profile.id ? "" : `<button type="submit" data-clear-after-save="1">${icon("save-all")}<span>保存并清空</span></button>`}${profile.id ? `<button type="button" onclick="testRemoteProfile(${profile.id},this)">${icon("activity")}<span>测试连接</span></button>` : ""}<button type="button" onclick="closeTabsByKey([activeTabKey],activeTabKey)">关闭</button></div>
  </form></div>`;
  $("remoteProfileForm").addEventListener("submit", saveRemoteProfileForm);
  pendingRemoteGroupSelectValue = profile.group_name || "默认分组";
  if (protocol === "serial") loadRemoteSerialPorts().catch(() => {});
  refreshIcons();
}

function handleRemoteGroupSelectChange(select) {
  if (select.value !== "__new_group__") {
    pendingRemoteGroupSelectValue = select.value || "默认分组";
    return;
  }
  select.value = pendingRemoteGroupSelectValue || "默认分组";
  openGroupModal(name => {
    remoteGroupOpen.add(name);
    saveRemoteGroupState();
    const createOption = select.querySelector('option[value="__new_group__"]');
    createOption?.before(new Option(name, name));
    select.value = name;
    pendingRemoteGroupSelectValue = name;
  });
}

function newRemoteProfile(protocol="rdp", groupName="") {
  selectedRemoteProfileId = null;
  const value = REMOTE_PROTOCOL_META[protocol] ? protocol : "rdp";
  setWorkspace(`添加 ${REMOTE_PROTOCOL_META[value].label}`, groupName ? `分组：${groupName}` : "新建远程连接", "edit", `remote-new-${value}`, true, true, {kind:"remote-edit", id:0, protocol:value});
  renderRemoteProfileForm({protocol:value, group_name:groupName || pendingGroup || "默认分组", options:{}});
}

function editRemoteProfile(id, updateTab=true) {
  const profile = remoteProfileById(id);
  if (!profile) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  setWorkspace(`${profile.name} · 编辑`, remoteProfileEndpoint(profile), "edit", `remote-edit-${profile.id}`, updateTab, true, {kind:"remote-edit", id:profile.id, protocol:profile.protocol});
  renderRemoteProfileForm(profile);
  renderConnections();
}

function changeRemoteProfileProtocol() {
  const protocol = $("remote_protocol").value;
  const meta = REMOTE_PROTOCOL_META[protocol];
  $("remoteNetworkFields").hidden = protocol === "serial";
  $("remoteCredentialFields").hidden = ["telnet","serial","xdmcp"].includes(protocol);
  $("remotePasswordField").hidden = protocol === "rdp";
  $("remoteDesktopCredentialNote").hidden = !["rdp","vnc"].includes(protocol);
  if (["rdp","vnc"].includes(protocol)) $("remoteDesktopCredentialNote").textContent = protocol === "vnc" ? "VNC 密码可选保存并加密存储；留空时会在连接时询问。" : "RDP 凭据由系统客户端提示或保存，不会放入启动命令。";
  if (protocol !== "serial") $("remote_port").value = meta.port;
  if (protocol === "ftp" && !$("remote_username").value) $("remote_username").value = "anonymous";
  $("remoteProtocolOptions").innerHTML = remoteProtocolOptionsMarkup(protocol, {});
  if (protocol === "serial") loadRemoteSerialPorts().catch(() => {});
  refreshIcons();
}

function remoteProfileFormOptions(protocol) {
  const sourceSshId = Number($("remote_source_ssh_connection_id")?.value || 0);
  const withSource = options => sourceSshId ? {...options, source_ssh_connection_id:sourceSshId} : options;
  if (protocol === "rdp") {
    const displayMode = $("remote_rdp_display_mode").value;
    return withSource({domain:$("remote_domain").value.trim(), display_mode:displayMode, fullscreen:displayMode === "fullscreen", width:Number($("remote_rdp_width").value), height:Number($("remote_rdp_height").value), admin_session:$("remote_admin_session").checked, clipboard:$("remote_clipboard").checked, audio:$("remote_audio").value});
  }
  if (protocol === "vnc") {
    const vncSourceId = Number($("remote_vnc_ssh_connection")?.value || 0);
    const existingOptions = remoteProfileById(Number($("remote_id")?.value || 0))?.options || {};
    const options = {client_mode:$("remote_vnc_client_mode").value, cursor_mode:$("remote_vnc_cursor_mode").value, display_mode:$("remote_vnc_display_mode").value, server_session_mode:existingOptions.server_session_mode || "auto", server_display:existingOptions.server_display || "", view_only:$("remote_view_only").checked, shared:$("remote_shared").checked, quality:Number($("remote_quality").value)};
    return vncSourceId ? {...options, source_ssh_connection_id:vncSourceId} : options;
  }
  if (protocol === "xdmcp") return withSource({mode:$("remote_xdmcp_mode").value, window_mode:$("remote_xdmcp_window_mode").value, width:Number($("remote_xdmcp_width").value), height:Number($("remote_xdmcp_height").value), local_address:$("remote_xdmcp_local_address").value.trim(), ssh_connection_id:Number($("remote_xdmcp_ssh_connection").value || 0)});
  if (protocol === "ftp") return withSource({secure:$("remote_ftp_secure").value, passive:true, reject_unauthorized:$("remote_reject_unauthorized").checked, base_path:$("remote_base_path").value.trim() || "/"});
  if (protocol === "telnet") return withSource({terminal_type:$("remote_terminal_type").value.trim(), encoding:$("remote_encoding").value});
  return withSource({path:$("remote_serial_path").value.trim(), baud_rate:Number($("remote_baud_rate").value), data_bits:Number($("remote_data_bits").value), stop_bits:Number($("remote_stop_bits").value), parity:$("remote_parity").value, rts_cts:$("remote_rts_cts").checked, xon:$("remote_xon").checked, xoff:$("remote_xoff").checked, encoding:$("remote_encoding").value});
}

async function saveRemoteProfileForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const clearAfterSave = event.submitter?.dataset.clearAfterSave === "1";
  const protocol = $("remote_protocol").value;
  const id = Number($("remote_id").value || 0);
  const payload = {
    protocol,
    name:$("remote_name").value.trim(),
    group_name:$("remote_group").value || "默认分组",
    host:protocol === "serial" ? "" : $("remote_host").value.trim(),
    port:protocol === "serial" ? null : Number($("remote_port").value),
    username:["telnet","serial","xdmcp"].includes(protocol) ? "" : $("remote_username").value.trim(),
    password:["ftp","vnc"].includes(protocol) ? $("remote_password").value : "",
    clear_password:Boolean($("remote_clear_password")?.checked),
    tags:$("remote_tags").value.trim(),
    options:remoteProfileFormOptions(protocol)
  };
  form.dataset.saving = "1";
  try {
    if (id) await api(`/api/remote-profiles/${id}`, {method:"PUT", body:JSON.stringify(payload)});
    else await api("/api/remote-profiles", {method:"POST", body:JSON.stringify(payload)});
    remoteGroupOpen.add(payload.group_name);
    saveRemoteGroupState();
    await loadAll();
    renderConnections();
    if (clearAfterSave && !id) {
      renderRemoteProfileForm({protocol, group_name:payload.group_name, options:{}});
      $("remote_name")?.focus();
      notify("连接已保存，可以继续添加", "success");
    } else {
      notify("远程连接已保存", "success");
    }
  } finally {
    delete form.dataset.saving;
  }
}

async function loadRemoteSerialPorts() {
  const result = await api("/api/serial/ports");
  const list = $("remoteSerialPorts");
  if (list) list.innerHTML = (result.ports || []).map(port => `<option value="${escAttr(port.path)}">${esc(port.manufacturer || port.friendly_name || port.path)}</option>`).join("");
  if (!result.available) notify(result.error || "串口组件不可用", "error");
  else if (!result.ports?.length) notify("没有检测到串口设备", "info");
  return result;
}

async function openRemoteDesktop(id, updateTab=true, showManagement=false) {
  const profile = remoteProfileById(id);
  if (!profile || !["rdp","vnc","xdmcp"].includes(profile.protocol)) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const meta = REMOTE_PROTOCOL_META[profile.protocol];
  const key = `remote-desktop-${profile.id}`;
  setWorkspace(profile.name, remoteProfileEndpoint(profile), "remote-desktop", key, updateTab, true, {kind:"remote-desktop", id:profile.id, protocol:profile.protocol});
  const embeddedVnc = profile.protocol === "vnc" && profile.options?.client_mode !== "system";
  const existingVncSession = embeddedVnc ? vncSessions.get(key) : null;
  if (!showManagement && existingVncSession?.workspace && (existingVncSession.connected || existingVncSession.connecting)) {
    if (existingVncSession.presentation === "management") return showVncManagement(profile.id, key, false);
    return renderEmbeddedVnc(profile, key);
  }
  const view = $("view-remote-desktop");
  if (!view) return;
  const renderScope = captureRemoteDesktopRenderScope(profile.id, key, view);
  const embeddedXdmcp = profile.protocol === "xdmcp";
  const managedRdp = profile.protocol === "rdp";
  const managedVnc = profile.protocol === "vnc";
  const sharedVnc = embeddedXdmcp ? matchingRemoteProfile(profile, "vnc") : null;
  view.dataset.remoteClientAvailable = "0";
  const launchHandler = embeddedVnc
    ? `openEmbeddedVncDesktop(${profile.id},'${escAttr(key)}',this)`
    : `launchRemoteDesktop(${profile.id},'${escAttr(key)}',this)`;
  const launchIcon = embeddedXdmcp ? "panels-top-left" : embeddedVnc ? "monitor-play" : "external-link";
  const launchLabel = embeddedXdmcp ? "新建图形登录" : embeddedVnc ? "打开内置 VNC" : `打开 ${meta.label} 客户端`;
  const serverStateMarkup = embeddedXdmcp
    ? `<div id="xdmcpServerState" class="xdmcp-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端图形登录服务</span></div></div>`
    : managedRdp
      ? `<div id="rdpServerState" class="rdp-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 RDP 服务</span></div></div>`
      : `<div id="vncServerState" class="vnc-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 VNC 服务</span></div></div>`;
  const inspectActions = embeddedXdmcp
    ? `<button onclick="inspectXdmcpServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openXdmcpSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`
    : managedRdp
      ? `<button onclick="inspectRdpServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openRdpSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`
      : `<button onclick="inspectVncServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openVncSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`;
  const helpText = embeddedXdmcp
    ? "Terma 负责启动本机 XDMCP 窗口；XDMCP 每次都会新建图形登录，不能接入已经打开的桌面，也不依赖 SSH X11 转发。需要共享当前桌面时请使用 VNC。"
    : managedRdp
      ? "Terma 会先探测远端 xrdp、桌面会话和本机客户端；默认停留在本页，由你确认后再打开远程桌面。"
      : `Terma 会先探测远端 VNC 服务和桌面环境；默认停留在本页，由你确认后再打开${embeddedVnc ? "内置" : "系统"}客户端。`;
  view.innerHTML = `<div class="remote-desktop-launch"><div class="remote-desktop-icon">${icon(meta.icon)}</div><h2>${esc(profile.name)}</h2><div class="cmd">${esc(remoteProfileEndpoint(profile))}</div><div id="remoteDesktopStatus" class="connection-test-status">正在检查本机 ${embeddedVnc ? "内置 VNC" : embeddedXdmcp ? "XDMCP" : `${meta.label}`} 客户端...</div>${serverStateMarkup}<div class="actions"><button id="remoteDesktopLaunchButton" class="primary" disabled onclick="${launchHandler}">${icon(launchIcon)}<span>${launchLabel}</span></button>${embeddedVnc ? `<button id="remoteDesktopCloseButton" hidden onclick="closeEmbeddedVncDesktop(${profile.id},'${escAttr(key)}',this)" title="断开并关闭内置 VNC 桌面">${icon("monitor-off")}<span>关闭桌面</span></button>` : ""}<button id="remoteDesktopInstallButton" hidden onclick="installRemoteDesktopClient(${profile.id},'${profile.protocol}',this)">${icon("download")}<span>安装客户端</span></button><button id="remoteDesktopXServerButton" hidden onclick="openXServerManager()">${icon("monitor-up")}<span>安装 XQuartz</span></button>${sharedVnc ? `<button onclick="openRemoteDesktop(${sharedVnc.id})">${icon("monitor")}<span>共享当前桌面（VNC）</span></button>` : ""}${inspectActions}<button onclick="editRemoteProfile(${profile.id})">${icon("settings-2")}<span>连接设置</span></button></div><div class="muted">${esc(helpText)}</div></div>`;
  if (embeddedVnc && existingVncSession) {
    existingVncSession.managementNodes = Array.from(view.childNodes);
    existingVncSession.presentation = "management";
    syncEmbeddedVncManagementControls(existingVncSession, view);
  }
  refreshIcons();
  if (typeof remoteWorkspaceJumpButtonsHtml === "function") {
    const jumpButtons = remoteWorkspaceJumpButtonsHtml(profile);
    if (jumpButtons) view.querySelector(".remote-desktop-launch .actions")?.insertAdjacentHTML("afterbegin", jumpButtons);
  }
  try {
    const [diagnostics, serverState, desktopDiagnostics] = await Promise.all([
      embeddedVnc ? Promise.resolve({vnc:{available:true, launchable:true, client:"Terma 内置 VNC"}}) : api("/api/remote-clients/diagnostics"),
      embeddedXdmcp
        ? inspectXdmcpServer(profile.id).catch(error => ({error:error.message || "XDMCP 服务探测失败"}))
        : managedRdp
          ? inspectRdpServer(profile.id).catch(error => ({error:error.message || "RDP 服务探测失败"}))
          : inspectVncServer(profile.id).catch(error => ({error:error.message || "VNC 服务探测失败"})),
      managedVnc ? inspectLinuxDesktopForRemoteProfile(profile) : Promise.resolve(null)
    ]);
    const item = diagnostics[profile.protocol] || {};
    const clientLaunchable = Boolean(item.available || item.launchable);
    const vncStatus = String(serverState?.status || "").toLowerCase();
    const vncServiceBlocked = managedVnc && serverState?.diagnostics_available !== false && !vncServerReady(serverState) && (serverState?.server_session_configurable === true || ["not-installed", "stopped", "not-listening", "blocked"].includes(vncStatus));
    const effectiveDesktopDiagnostics = managedRdp ? serverState : desktopDiagnostics;
    const rdpServerReady = !managedRdp || serverState?.error || serverState?.platform_supported === false || (serverState?.xrdp_installed && serverState?.xrdp_active && serverState?.xrdp_listening);
    const vncReadyForLaunch = !managedVnc || serverState?.diagnostics_available === false || !vncServiceBlocked;
    await withRemoteDesktopRenderScope(renderScope, async activeView => {
      const status = activeView.querySelector("#remoteDesktopStatus");
      if (!status) return;
      activeView.dataset.remoteClientAvailable = clientLaunchable ? "1" : "0";
      status.className = `connection-test-status ${item.available ? "success" : clientLaunchable ? "warning" : "error"}`;
      status.textContent = item.available ? `已检测到 ${item.client || meta.label} 客户端` : (item.reason || diagnostics.message || `未检测到 ${meta.label} 客户端`);
      const launchButton = activeView.querySelector("#remoteDesktopLaunchButton");
      const installButton = activeView.querySelector("#remoteDesktopInstallButton");
      const xServerButton = activeView.querySelector("#remoteDesktopXServerButton");
      if (installButton) {
        installButton.hidden = !item.can_install;
        const label = installButton.querySelector("span");
        if (label) label.textContent = item.install_label || `安装 ${meta.label} 客户端`;
      }
      if (xServerButton) {
        xServerButton.hidden = !item.requires_xserver;
        const label = xServerButton.querySelector("span");
        if (label) label.textContent = item.xserver_installed ? "启动 XQuartz" : "安装 XQuartz";
      }
      if (!embeddedXdmcp && launchButton) launchButton.disabled = !clientLaunchable
        || (managedRdp && serverState?.platform_supported !== false && (!serverState?.xrdp_installed || !serverState?.xrdp_active || !serverState?.xrdp_listening))
        || vncServiceBlocked
        || (managedVnc && desktopDiagnostics?.platform_supported !== false && desktopDiagnostics && !desktopDiagnostics.has_desktop);
      if (embeddedXdmcp && serverState) renderXdmcpServerState(serverState, profile.id, activeView.querySelector("#xdmcpServerState"));
      if (managedRdp && serverState) renderRdpServerState(serverState, profile.id, key, activeView.querySelector("#rdpServerState"));
      if (managedVnc && serverState) renderVncServerState(serverState, profile.id, key, activeView.querySelector("#vncServerState"));
      if (embeddedVnc && existingVncSession?.presentation === "management") syncEmbeddedVncManagementControls(existingVncSession, activeView);
      const missingNotice = linuxDesktopMissingNotice(profile, effectiveDesktopDiagnostics);
      if (missingNotice) status.insertAdjacentHTML("afterend", missingNotice);
      if (updateTab && remoteDesktopQuickOpen && clientLaunchable && (!effectiveDesktopDiagnostics || effectiveDesktopDiagnostics.platform_supported === false || effectiveDesktopDiagnostics.has_desktop) && (!embeddedXdmcp || serverState?.ready_for_login) && rdpServerReady && vncReadyForLaunch) {
        if (embeddedVnc) await openEmbeddedVncDesktop(profile.id, key);
        else await launchRemoteDesktop(profile.id, key);
      }
    });
  } catch (error) {
    withRemoteDesktopRenderScope(renderScope, activeView => {
      const status = activeView.querySelector("#remoteDesktopStatus");
      if (!status) return;
      status.className = "connection-test-status error";
      status.textContent = error.message;
    });
  }
}

function rdpInstallPlanFromDiagnostics(diagnostics={}) {
  return diagnostics.rdp_install_plan || diagnostics.install_plan || diagnostics.package_plan?.install_plan || diagnostics.package_plan || null;
}

function remoteGraphicsRenderingMarkup(diagnostics={}) {
  const rendering = diagnostics?.graphics_rendering;
  if (!rendering || rendering.visible === false || !rendering.summary) return "";
  const uiText = value => String(value || "").replaceAll("TigerVNC/Xvnc", "TigerVNC");
  const risk = Boolean(rendering.java_gui_risk);
  const ready = rendering.state === "accelerated";
  const details = [
    rendering.backend ? `后端：${uiText(rendering.backend)}` : "",
    rendering.source_display || rendering.display ? `显示：${rendering.source_display || rendering.display}` : "",
    rendering.drm_device ? `DRM：${rendering.drm_device}${rendering.drm_device_available ? "（可用）" : "（不可用）"}` : ""
  ].filter(Boolean);
  const commands = Array.isArray(rendering.compatibility_commands) ? rendering.compatibility_commands : [];
  const actions = risk && commands.length
    ? `<div class="remote-rendering-actions">${commands.map(item => `<button type="button" onclick="copyRemoteGraphicsCommand('${escAttr(encodeURIComponent(item.command || ""))}','${escAttr(item.label || "Java")}',this)" title="复制 ${escAttr(item.label || "Java")} 兼容启动命令">${icon("copy")}<span>${esc(item.label || "Java")}</span></button>`).join("")}</div>`
    : "";
  return `<div class="remote-rendering-state ${risk ? "warning" : ready ? "ready" : ""}">
    <span class="remote-rendering-icon">${icon(risk ? "triangle-alert" : ready ? "badge-check" : "monitor-cog")}</span>
    <div class="remote-rendering-copy"><strong>${esc(uiText(rendering.summary))}</strong><small>${esc(uiText(rendering.detail))}</small>${details.length ? `<span>${esc(details.join(" · "))}</span>` : ""}</div>
    ${actions}
  </div>`;
}

async function copyRemoteGraphicsCommand(encoded, label="Java", button=null) {
  try {
    const command = decodeURIComponent(String(encoded || ""));
    if (!command) throw new Error("兼容启动命令为空");
    if (button) setButtonBusy(button, true, "复制中...");
    await writeClipboardText(command);
    notify(`${label} 兼容启动命令已复制`, "success");
  } catch (error) {
    notify(error.message || "复制兼容启动命令失败", "error");
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

function renderRdpServerState(diagnostics, profileId=selectedRemoteProfileId, key=`remote-desktop-${profileId}`, targetContainer=null) {
  const container = targetContainer || $("rdpServerState");
  if (!container) return;
  const actionKey = rdpServerActionKey(profileId);
  setRemoteComponentTaskHost(container, false);
  container._rdpDiagnostics = diagnostics || {};
  if (diagnostics?.error) {
    container.innerHTML = `<div class="connection-test-status warning">${icon("circle-alert")}<span>${esc(diagnostics.error)}</span></div>`;
    refreshIcons();
    return;
  }
  const linux = diagnostics?.platform_supported !== false;
  const installed = Boolean(diagnostics?.xrdp_installed);
  const active = Boolean(diagnostics?.xrdp_active);
  const listening = Boolean(diagnostics?.xrdp_listening);
  const ready = installed && active && listening;
  const plan = rdpInstallPlanFromDiagnostics(diagnostics);
  const profile = remoteProfileById(profileId);
  const managerConnection = diagnostics?.connection?.name || currentConnection(linuxDesktopManagerConnectionIdForProfile(profile))?.name || "SSH 管理连接";
  const title = !linux ? "当前主机不使用 Linux xrdp 管理" : installed ? "远端 xrdp 已安装" : "远端未安装 xrdp";
  const detail = !linux
    ? "Terma 不会在非 Linux 主机上安装 xrdp；仍可直接使用系统 RDP 服务。"
    : installed
      ? `${active ? "服务运行中" : "服务未运行"} · ${listening ? "TCP 3389 已监听" : "TCP 3389 未监听"} · ${diagnostics.has_desktop ? "桌面会话可用" : "尚未检测到可用桌面会话"}`
      : "请选择下方显示为可用的安装方式；本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统。";
  const serviceActions = linux && installed ? `<div class="remote-service-actions"><button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','${active ? "stop" : "start"}',this)">${icon(active ? "circle-stop" : "circle-play")}<span>${active ? "停止服务" : "启动服务"}</span></button><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','uninstall',this)">${icon("package-minus")}<span>卸载服务</span></button></div>` : "";
  container.innerHTML = `<div class="remote-service-head rdp-server-head"><span class="remote-service-icon xdmcp-server-icon ${!linux || ready ? "ready" : "warning"}">${icon(!linux ? "info" : ready ? "circle-check" : installed ? "circle-alert" : "package-x")}</span><div><b>${esc(title)}</b><small>${esc(managerConnection)} · ${esc(detail)}</small></div></div>${linux && !installed ? remoteInstallModesMarkup(plan || {}, mode => `installRdpServer(${Number(profileId)},'${escAttr(key)}',this,'${mode}')`, `openRdpSetupGuide(${Number(profileId)})`, actionKey) : ""}${linux && installed ? `<div class="remote-service-meta rdp-server-meta"><span>${icon("package-check")} xrdp 已安装</span><span>${icon(active ? "circle-play" : "circle-stop")} ${active ? "服务运行中" : "服务未运行"}</span><span>${icon(listening ? "radio-tower" : "unplug")} ${listening ? "3389 已监听" : "3389 未监听"}</span><span>${icon("monitor")} ${diagnostics.has_desktop ? "桌面会话可用" : "需要安装桌面会话"}</span></div>` : ""}${remoteDesktopProtocolGuideMarkup("rdp", diagnostics, profile)}${remoteGraphicsRenderingMarkup(diagnostics)}${serviceActions}`;
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
  if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || (linux && !ready);
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectRdpServer(profileId, button=null, targetContainer=null) {
  const container = targetContainer || $("rdpServerState");
  if (button) setButtonBusy(button, true, "探测中...");
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 RDP 服务</span></div>`;
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
    renderRdpServerState(diagnostics, profileId, `remote-desktop-${profileId}`, container);
    return diagnostics;
  } catch (error) {
    if (container) renderRdpServerState({error:error.message || "RDP 服务探测失败"}, profileId, `remote-desktop-${profileId}`, container);
    throw error;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function closeRdpSetupGuide() {
  closeRemoteInstallDialog();
}

async function openRdpSetupGuide(profileId) {
  const modal = $("modal");
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
    const plan = rdpInstallPlanFromDiagnostics(diagnostics) || {};
    const profile = remoteProfileById(profileId);
    const sourceId = Number(diagnostics.connection?.id || linuxDesktopManagerConnectionIdForProfile(profile) || 0);
    const installed = Boolean(diagnostics.xrdp_installed);
    const active = Boolean(diagnostics.xrdp_active);
    const actionKey = rdpServerActionKey(profileId);
    const steps = diagnostics.platform_supported === false
      ? ["当前 SSH 管理主机不是 Linux，Terma 不会安装 xrdp。", "Windows 主机请在系统设置中开启远程桌面；其他系统请使用其原生 RDP 服务端说明。"]
      : [
          "先确认远端已经安装可用的 Linux 桌面；没有桌面时请前往 Linux 桌面管理安装 XFCE、GNOME、Plasma 等桌面环境。",
          "安装 xrdp 与对应的 Xorg 后端，并按发行版启用 xrdp 服务。",
          "只有检测到活动防火墙且端口未放行时，才需要开放 TCP 3389；未启用防火墙时不需要添加规则。",
          "安装完成后返回 RDP 工作区重新探测，再启动本机 RDP 客户端。"
        ];
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="rdpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="rdpSetupGuideTitle">RDP 服务安装/配置</h2><span class="muted">${esc(diagnostics.connection?.name || profile?.name || "远端主机")} · ${esc(diagnostics.package_manager || "未识别包管理器")}</span></div><button class="icon-button" type="button" onclick="closeRdpSetupGuide()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status ${diagnostics.xrdp_installed ? "success" : "warning"}">${esc(diagnostics.xrdp_installed ? "远端已经检测到 xrdp；如仍无法连接，请检查桌面会话、服务状态和 TCP 3389。" : diagnostics.platform_supported === false ? "当前主机不适用 Linux xrdp 自动安装。" : "远端未检测到 xrdp，请选择安装方式或查看手动说明。")}</div>
      ${remoteDesktopProtocolGuideMarkup("rdp", diagnostics, profile)}
      ${diagnostics.platform_supported === false || installed ? "" : remoteInstallModesMarkup(plan, mode => `installRdpServer(${Number(profileId)},'remote-desktop-${Number(profileId)}',this,'${mode}')`, "revealRemoteInstallManual(this)", actionKey)}
      ${remoteInstallManualMarkup(plan, {steps, note:"如果远端和本机都无法联网，请在另一台同发行版、同版本、同架构的设备上下载 xrdp、xorgxrdp 及完整依赖，再上传到远端安装。"})}
      <div class="actions"><button type="button" onclick="closeRdpSetupGuide()">关闭</button>${installed ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'remote-desktop-${Number(profileId)}','${active ? "stop" : "start"}',this)">${icon(active ? "circle-stop" : "circle-play")}<span>${active ? "停止服务" : "启动服务"}</span></button><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'remote-desktop-${Number(profileId)}','uninstall',this)">${icon("package-minus")}<span>卸载服务</span></button>` : ""}${sourceId ? `<button type="button" onclick="closeRdpSetupGuide();openLinuxDesktopManager(${sourceId})">${icon("monitor-cog")}<span>Linux 桌面管理</span></button>` : ""}</div>
    </div>`;
    setRemoteInstallDialogCommands(plan);
    modal.hidden = false;
    modal.onclick = null;
    modal.querySelector(".remote-install-manual")?.setAttribute("open", "");
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || "RDP 安装说明读取失败", "error");
  }
}

async function installRdpServer(profileId, key, button=null, mode="online") {
  const actionKey = rdpServerActionKey(profileId);
  if (!beginUiAction(actionKey, button, "安装中...")) {
    notify("RDP 服务任务正在执行，请等待完成", "info");
    return null;
  }
  try {
    return await installRdpServerImpl(profileId, key, button, mode);
  } finally {
    endUiAction(actionKey, button);
  }
}

async function installRdpServerImpl(profileId, key, button=null, mode="online") {
  const profile = remoteProfileById(profileId);
  if (!profile) return notify("RDP 连接不存在", "error");
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline" ? "本机下载后离线" : normalizedMode === "offline" ? "使用远端缓存" : "在线";
  let diagnostics = $("rdpServerState")?._rdpDiagnostics || null;
  if (!diagnostics || diagnostics.error) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
  const message = normalizedMode === "local-offline"
    ? "Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载匹配架构的 xrdp 软件包及依赖，通过 SFTP 上传后安装。是否继续？"
    : normalizedMode === "offline"
      ? "将只使用远端包管理器已经缓存的软件包安装 xrdp，不会访问软件源。缓存不完整时安装会失败，是否继续？"
      : "将通过远端软件源在线安装 xrdp 和对应的 Xorg 后端。是否继续？";
  if (!await confirmModal(message, `${modeLabel}安装 RDP 服务`, "安装", "取消", true)) return null;
  const sourceId = Number(diagnostics.connection?.id || linuxDesktopManagerConnectionIdForProfile(profile) || 0);
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    if (!sourceId) return notify("该 RDP 连接没有关联的 SSH 管理连接", "error");
    adminAuth = await requestRemoteAdminAuthorization(sourceId, `${modeLabel}安装 RDP 服务`);
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, "安装中...");
  try {
    const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
    const result = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`, {method:"POST", body:JSON.stringify({action, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const taskContainer = $("rdpServerState");
      const taskScope = captureRemoteComponentTaskScope(profileId, key, taskContainer);
      closeRdpSetupGuide();
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:taskContainer,
        scope:taskScope,
        title:`${modeLabel}安装 RDP 服务`,
        onDone:(_, activeContainer) => activeContainer ? inspectRdpServer(profileId, null, activeContainer).catch(() => {}) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, `${modeLabel}安装 RDP 服务`, "RDP 服务安装已加入任务中心");
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    renderRdpServerState(result.after || result.before || diagnostics, profileId, key);
    notify("RDP 服务安装完成，已重新探测", "success");
    return result;
  } catch (error) {
    notify(error.message || `${modeLabel}安装 RDP 服务失败`, "error");
    return null;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

async function runRdpServerAction(profileId, key, action, button=null) {
  const actionKey = rdpServerActionKey(profileId);
  const busyLabel = action === "stop" ? "停止中..." : action === "uninstall" ? "卸载中..." : action === "restart" ? "重启中..." : "启动中...";
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify("RDP 服务任务正在执行，请等待完成", "info");
    return null;
  }
  try {
    return await runRdpServerActionImpl(profileId, key, action, button);
  } finally {
    endUiAction(actionKey, button);
  }
}

async function runRdpServerActionImpl(profileId, key, action, button=null) {
  const profile = remoteProfileById(profileId);
  if (!profile) return notify("RDP 连接不存在", "error");
  const labels = {start:"启动 RDP 服务", stop:"停止 RDP 服务", restart:"重启 RDP 服务", uninstall:"卸载 RDP 服务"};
  const label = labels[action] || "管理 RDP 服务";
  const danger = ["stop", "uninstall"].includes(action);
  const message = action === "uninstall"
    ? "将停止并卸载远端 xrdp 与对应的 Xorg 后端。不会卸载桌面环境，但现有 RDP 会话会立即断开。是否继续？"
    : action === "stop"
      ? "将停止远端 xrdp 服务，现有 RDP 会话会立即断开。是否继续？"
      : action === "restart"
        ? "将重启远端 xrdp 服务，现有 RDP 会话会立即断开。是否继续？"
        : "将启用并启动远端 xrdp 服务。是否继续？";
  if (!await confirmModal(message, label, action === "uninstall" ? "卸载" : action === "stop" ? "停止" : action === "restart" ? "重启" : "启动", "取消", danger)) return null;
  let diagnostics = $("rdpServerState")?._rdpDiagnostics || null;
  if (!diagnostics || diagnostics.error) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
  const sourceId = Number(diagnostics.connection?.id || linuxDesktopManagerConnectionIdForProfile(profile) || 0);
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    if (!sourceId) return notify("该 RDP 连接没有关联的 SSH 管理连接", "error");
    adminAuth = await requestRemoteAdminAuthorization(sourceId, label);
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, `${action === "uninstall" ? "卸载" : action === "stop" ? "停止" : action === "restart" ? "重启" : "启动"}中...`);
  try {
    const result = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`, {method:"POST", body:JSON.stringify({action, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const taskContainer = $("rdpServerState");
      const taskScope = captureRemoteComponentTaskScope(profileId, key, taskContainer);
      closeRdpSetupGuide();
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:taskContainer,
        scope:taskScope,
        title:label,
        onDone:(_, activeContainer) => activeContainer ? inspectRdpServer(profileId, null, activeContainer).catch(() => {}) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, label, `${label}已加入任务中心`);
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    renderRdpServerState(result.after || result.before || diagnostics, profileId, key);
    notify(`${label}完成，已重新探测`, "success");
    return result;
  } catch (error) {
    notify(error.message || `${label}失败`, "error");
    return null;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

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

function noVncRfbClass() {
  if (!noVncRfbPromise) noVncRfbPromise = import("/vendor/novnc/core/rfb.js").then(module => module.default);
  return noVncRfbPromise;
}

function normalizeVncRemotePlatform(value="") {
  const platform = String(value || "").trim().toLowerCase();
  if (["darwin", "mac", "macos", "osx"].includes(platform)) return "macos";
  if (platform === "linux" || platform.startsWith("linux-")) return "linux";
  return platform;
}

function vncCursorMode(session) {
  const mode = String(session?.profile?.options?.cursor_mode || "auto").trim().toLowerCase();
  return ["auto", "show", "hide"].includes(mode) ? mode : "auto";
}

function vncUsesFramebufferCursor(session) {
  const platform = normalizeVncRemotePlatform(session?.remotePlatform || session?.vncServerDiagnostics?.platform || session?.vncServerDiagnostics?.os_id);
  if (platform !== "macos") return false;
  const diagnostics = session?.vncServerDiagnostics || null;
  const serviceUnit = String(diagnostics?.service_unit || "").trim().toLowerCase();
  const builtinScreenSharing = diagnostics?.builtin === true || serviceUnit === "com.apple.screensharing";
  // macOS Screen Sharing paints the pointer into the framebuffer. If the
  // server was not identified, keep the macOS-safe fallback; an explicit
  // third-party server marker can opt out when it provides RFB cursor shapes.
  return builtinScreenSharing || !diagnostics || diagnostics?.builtin !== false;
}

function applyVncCursorPolicy(session, rfb=session?.rfb) {
  if (!session) return false;
  const mode = vncCursorMode(session);
  const hideLocalCursor = mode === "hide" || (mode === "auto" && vncUsesFramebufferCursor(session));
  session.localCursorHidden = hideLocalCursor;
  session.screen?.classList.toggle("vnc-hide-local-cursor", hideLocalCursor);
  const canvas = rfb?._canvas;
  canvas?.classList.toggle("vnc-local-cursor-target", hideLocalCursor);
  const fallbackCursorCanvas = rfb?._cursor?._canvas;
  fallbackCursorCanvas?.classList.toggle("vnc-local-cursor-overlay-hidden", hideLocalCursor);
  if (rfb) rfb.showDotCursor = !hideLocalCursor;
  renderVncCursorModeControl(session);
  return hideLocalCursor;
}

function vncDisplayMode(session) {
  const mode = String(session?.profile?.options?.display_mode || "scale").trim().toLowerCase();
  return ["scale", "original", "resize"].includes(mode) ? mode : "scale";
}

function applyVncDisplayMode(session, rfb=session?.rfb) {
  if (!session) return "scale";
  const mode = vncDisplayMode(session);
  session.viewport?.classList.toggle("vnc-display-original", mode === "original");
  session.viewport?.classList.toggle("vnc-display-resize", mode === "resize");
  if (rfb) {
    // Keep local scaling enabled while requesting remote resize so servers
    // without SetDesktopSize support still fill the available viewport.
    rfb.scaleViewport = mode !== "original";
    rfb.resizeSession = mode === "resize";
  }
  return mode;
}

function renderVncCursorModeControl(session) {
  const button = session?.workspace?.querySelector("[data-vnc-cursor-mode]");
  if (!button) return;
  const mode = vncCursorMode(session);
  const detail = mode === "auto"
    ? `自动（当前${session.localCursorHidden ? "隐藏" : "显示"}本地光标）`
    : mode === "hide"
      ? "手动隐藏本地光标"
      : "手动显示本地光标";
  const label = `鼠标模式：${detail}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(mode !== "auto"));
  button.classList.toggle("active", mode !== "auto");
}

function showVncCursorModeMenu(event, key) {
  const session = vncSessions.get(key);
  if (!session) return;
  const mode = vncCursorMode(session);
  showActionMenu(event, [
    {label:"自动（按远端平台）", icon:mode === "auto" ? "circle-check" : "sparkles", run:()=>setVncCursorMode(key, "auto")},
    {separator:true},
    {label:"手动：显示本地光标", icon:mode === "show" ? "circle-check" : "mouse-pointer-2", run:()=>setVncCursorMode(key, "show")},
    {label:"手动：隐藏本地光标", icon:mode === "hide" ? "circle-check" : "eye-off", run:()=>setVncCursorMode(key, "hide")}
  ]);
}

async function setVncCursorMode(key, mode) {
  const session = vncSessions.get(key);
  if (!session?.profile || !["auto", "show", "hide"].includes(mode)) return;
  const profile = remoteProfileById(session.profile.id) || session.profile;
  const updated = await api(`/api/remote-profiles/${Number(profile.id)}`, {
    method:"PUT",
    body:JSON.stringify({options:{...(profile.options || {}), cursor_mode:mode}})
  });
  const index = remoteProfiles.findIndex(item => Number(item.id) === Number(updated.id));
  if (index >= 0) remoteProfiles[index] = updated;
  session.profile = updated;
  applyVncCursorPolicy(session);
  const text = mode === "auto" ? "VNC 鼠标模式已设为自动" : mode === "hide" ? "已手动隐藏本地光标" : "已手动显示本地光标";
  notify(text, "success");
}

function vncClipboardDefaultStatus(session) {
  if (session?.clipboardBridgeError) return {text:"SSH 剪贴板辅助不可用", state:"error"};
  if (session?.clipboardAutoSync) return {text:vncClipboardUsesSsh(session?.clipboardTransport) ? "剪贴板：自动同步（SSH）" : "剪贴板：自动同步", state:"active"};
  if (session?.clipboardPermissionBlocked) return {text:"剪贴板权限受限", state:"error"};
  if (vncClipboardUsesSsh(session?.clipboardTransport)) return {text:"剪贴板：SSH 辅助", state:""};
  return {text:"剪贴板：手动", state:""};
}

function vncClipboardUsesSsh(transport="") {
  return String(transport || "").startsWith("ssh-");
}

function vncClipboardNeedsUnicodeBridge(text="") {
  return Array.from(String(text ?? "")).some(character => character.codePointAt(0) > 0xff);
}

function vncClipboardLegacyRfbCanSendUnicode(session) {
  const formats = session?.rfb?._clipboardServerCapabilitiesFormats || {};
  const actions = session?.rfb?._clipboardServerCapabilitiesActions || {};
  return Boolean(formats[1] && actions[0x08000000]);
}

function normalizeVncClipboardHost(value="") {
  return normalizeRemoteHost(value);
}

function vncClipboardMatchingConnections(profile) {
  const items = typeof connections !== "undefined" && Array.isArray(connections) ? connections : [];
  const host = normalizeVncClipboardHost(profile?.host);
  if (!host) return [];
  const username = String(profile?.username || "").trim().toLowerCase();
  return items.filter(connection => normalizeVncClipboardHost(connection?.ssh_host) === host).sort((left, right) => {
    const leftUser = username && String(left?.ssh_user || "").trim().toLowerCase() === username ? 1 : 0;
    const rightUser = username && String(right?.ssh_user || "").trim().toLowerCase() === username ? 1 : 0;
    return rightUser - leftUser
      || Number(Boolean(right?.favorite)) - Number(Boolean(left?.favorite))
      || Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function vncClipboardBridgeCandidate(session) {
  const sourceId = Number(session?.profile?.options?.source_ssh_connection_id || session?.profile?.options?.ssh_connection_id || 0);
  return sourceId > 0 || vncClipboardMatchingConnections(session?.profile).length > 0;
}

function normalizeVncClipboardText(text="") {
  const value = String(text ?? "");
  if (!/^(?:(?:\\u[0-9a-f]{4})|(?:\\U[0-9a-f]{8}))+$/i.test(value)) return value;
  try {
    const jsonEscaped = value.replace(/\\U([0-9a-f]{8})/gi, (_match, digits) => {
      const point = Number.parseInt(digits, 16);
      if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return _match;
      return String.fromCodePoint(point).split("").map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    });
    return JSON.parse(`"${jsonEscaped}"`);
  } catch {
    return value;
  }
}

function refreshVncClipboardControlRefs(session) {
  if (!session) return;
  const key = String(session.key || "");
  const renderedWorkspace = typeof document !== "undefined" && typeof document.querySelectorAll === "function"
    ? [...document.querySelectorAll(".vnc-workspace")].find(node => String(node.dataset?.vncKey || "") === key)
    : null;
  const workspace = session.workspace?.isConnected
    ? session.workspace
    : renderedWorkspace || session.workspace;
  if (!workspace) return;
  session.workspace = workspace;
  session.clipboardStatus = workspace.querySelector("#vncClipboardStatus") || session.clipboardStatus;
  session.clipboardHelperButton = workspace.querySelector("[data-vnc-clipboard-helper]") || session.clipboardHelperButton;
  session.clipboardSyncButton = workspace.querySelector("[data-vnc-clipboard-sync]") || session.clipboardSyncButton;
  session.clipboardReceiveButton = workspace.querySelector("[data-vnc-clipboard-receive]") || session.clipboardReceiveButton;
}

function renderVncClipboardControls(session) {
  if (!session) return;
  refreshVncClipboardControlRefs(session);
  const fallback = vncClipboardDefaultStatus(session);
  const status = session.clipboardStatus;
  if (status) {
    status.textContent = session.clipboardStatusText || fallback.text;
    status.className = `vnc-clipboard-status${session.clipboardStatusState ? ` ${session.clipboardStatusState}` : fallback.state ? ` ${fallback.state}` : ""}`;
    const connectionName = session.clipboardBridgeConnectionName ? ` · ${session.clipboardBridgeConnectionName}` : "";
    status.title = `${session.clipboardBridgeError || status.textContent}${connectionName} · 点击设置 SSH 剪贴板辅助`;
    status.classList.toggle("clickable", true);
  }
  const syncButton = session.clipboardSyncButton;
  if (syncButton) {
    syncButton.classList.toggle("active", Boolean(session.clipboardAutoSync));
    syncButton.setAttribute("aria-pressed", session.clipboardAutoSync ? "true" : "false");
    syncButton.title = session.clipboardAutoSync ? "关闭剪贴板自动同步" : "开启剪贴板自动同步";
    syncButton.setAttribute("aria-label", syncButton.title);
  }
  const helperButton = session.clipboardHelperButton;
  if (helperButton) {
    const active = vncClipboardUsesSsh(session.clipboardTransport);
    helperButton.classList.toggle("active", active);
    helperButton.classList.toggle("attention", Boolean(session.clipboardBridgeError));
    helperButton.title = active
      ? `SSH 剪贴板辅助已启用${session.clipboardBridgeConnectionName ? `：${session.clipboardBridgeConnectionName}` : ""}`
      : session.clipboardBridgeError || "设置 SSH 剪贴板辅助";
    helperButton.setAttribute("aria-label", helperButton.title);
  }
  const receiveButton = session.clipboardReceiveButton;
  if (receiveButton) {
    receiveButton.disabled = !session.remoteClipboardAvailable && !vncClipboardBridgeCandidate(session);
    receiveButton.classList.toggle("attention", Boolean(session.remoteClipboardAvailable && session.remoteClipboardPending));
    receiveButton.title = session.remoteClipboardAvailable
      ? "读取最近收到的远端剪贴板"
      : vncClipboardBridgeCandidate(session) ? "通过 SSH 读取远端系统剪贴板" : "远端尚未发送剪贴板";
    receiveButton.setAttribute("aria-label", receiveButton.title);
  }
}

function setVncClipboardStatus(session, text="", state="", resetAfter=0) {
  if (!session) return;
  if (session.clipboardStatusTimer) clearTimeout(session.clipboardStatusTimer);
  session.clipboardStatusTimer = null;
  session.clipboardStatusText = text;
  session.clipboardStatusState = state;
  renderVncClipboardControls(session);
  if (resetAfter > 0) {
    session.clipboardStatusTimer = setTimeout(() => {
      session.clipboardStatusTimer = null;
      session.clipboardStatusText = "";
      session.clipboardStatusState = "";
      renderVncClipboardControls(session);
    }, resetAfter);
  }
}

function requestVncClipboardSshConnection(session) {
  return new Promise(resolve => {
    if (!session?.profile) return resolve(null);
    const modal = $("modal");
    const matches = vncClipboardMatchingConnections(session.profile);
    const configuredId = Number(session.profile.options?.source_ssh_connection_id || session.profile.options?.ssh_connection_id || 0);
    const selectedId = configuredId || Number(matches[0]?.id || 0);
    const optionRows = (typeof connections !== "undefined" && Array.isArray(connections) ? connections : []).map(connection => {
      const sameHost = normalizeVncClipboardHost(connection.ssh_host) === normalizeVncClipboardHost(session.profile.host);
      const label = `${connection.name} · ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}${sameHost ? " · 同主机" : ""}`;
      return `<option value="${Number(connection.id)}" ${Number(connection.id) === selectedId ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");
    modal.hidden = false;
    modal.innerHTML = `<form class="modal-card vnc-clipboard-modal vnc-clipboard-helper-modal">
      <div class="modal-title-row"><div><h2>SSH 剪贴板辅助</h2><span class="muted">${esc(session.profile.name)} · ${esc(session.profile.host)}</span></div><button class="icon-button" type="button" data-vnc-clipboard-helper-cancel title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status">VNC 的旧剪贴板协议只能可靠传输 Latin-1。关联 SSH 后，Terma 会直接读写远端系统剪贴板，中文使用 UTF-8 传输。</div>
      ${matches.length ? `<div class="connection-test-status success">已找到 ${matches.length} 个同主机 SSH 连接，默认选择 ${esc(matches[0].name || matches[0].ssh_host)}。</div>` : `<div class="connection-test-status warning">没有自动找到同主机 SSH。可以选择其他能管理此桌面会话的 SSH 连接。</div>`}
      <label>SSH 辅助连接</label><select id="vncClipboardSshConnection" onchange="inspectVncClipboardHelper(vncSessions.get('${escAttr(session.key)}'),document.querySelector('#vncClipboardHelperState'))"><option value="0">自动匹配同主机</option>${optionRows}</select>
      <div class="muted">Linux 远端需要 xclip/xsel（X11）或 wl-clipboard（Wayland）；macOS 已自带 pbcopy/pbpaste，不会安装 Linux 软件包。</div>
      <div id="vncClipboardHelperState" class="vnc-clipboard-helper-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在识别远端系统和剪贴板辅助工具</span></div></div>
      <div class="actions"><button type="button" data-vnc-clipboard-helper-cancel>取消</button><button class="primary" type="submit">保存并检测</button></div></form>`;
    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      modal.onclick = null;
      modal.hidden = true;
      modal.innerHTML = "";
      if (session.clipboardHelperModalFinish === finish) session.clipboardHelperModalFinish = null;
      resolve(value);
    };
    session.clipboardHelperModalFinish = finish;
    const onKeyDown = event => { if (event.key === "Escape") finish(null); };
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault();
      finish(Number(modal.querySelector("#vncClipboardSshConnection")?.value || 0));
    };
    modal.querySelectorAll("[data-vnc-clipboard-helper-cancel]").forEach(button => { button.onclick = () => finish(null); });
    modal.onclick = null;
    document.addEventListener("keydown", onKeyDown);
    refreshIcons();
    void inspectVncClipboardHelper(session, modal.querySelector("#vncClipboardHelperState"));
  });
}

function vncClipboardHelperManualMarkup(diagnostics={}) {
  const guide = diagnostics.guide || {};
  return remoteInstallManualMarkup(diagnostics.install_plan || {}, {
    steps:Array.isArray(guide.steps) ? guide.steps : [],
    commands:Array.isArray(guide.commands) ? guide.commands : [],
    note:guide.summary || "安装或检查完成后，返回此窗口重新检测。"
  });
}

function renderVncClipboardHelperState(session, diagnostics, container) {
  if (!container || !diagnostics) return;
  session.clipboardHelperDiagnostics = diagnostics;
  const platform = String(diagnostics.platform || "unknown").toLowerCase();
  const available = Boolean(diagnostics.available);
  if (available && vncClipboardUsesSsh(diagnostics.transport)) {
    session.clipboardTransport = String(diagnostics.transport);
    session.clipboardTransportChecked = true;
    session.clipboardBridgeConnectionId = Number(diagnostics.connection_id || 0);
    session.clipboardBridgeConnectionName = String(diagnostics.connection_name || "");
    session.clipboardBridgeResolvedBy = String(diagnostics.resolved_by || "");
    session.clipboardBridgeError = "";
    session.clipboardStatusText = "";
    session.clipboardStatusState = "";
  } else if (platform === "linux" && diagnostics.connection_id) {
    session.clipboardTransport = "rfb";
    session.clipboardTransportChecked = true;
    session.clipboardBridgeConnectionId = Number(diagnostics.connection_id || 0);
    session.clipboardBridgeConnectionName = String(diagnostics.connection_name || "");
    session.clipboardBridgeError = String(diagnostics.reason || "SSH 剪贴板辅助通道不可用");
    session.clipboardStatusText = "";
    session.clipboardStatusState = "";
  }
  const platformLabel = platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : "未识别系统";
  const tool = diagnostics.tool ? ` · ${diagnostics.tool}` : "";
  const title = available ? `${platformLabel} 剪贴板辅助可用${tool}` : `${platformLabel} 剪贴板辅助尚不可用`;
  const actionKey = vncClipboardHelperActionKey(session.profile?.id);
  let body = "";
  if (platform === "macos") {
    body = `<div class="connection-test-status ${available ? "success" : "warning"}">${icon(available ? "circle-check" : "circle-alert")}<span>${esc(available ? "macOS 系统自带 pbcopy/pbpaste，无需安装。" : diagnostics.reason || "macOS 已自带剪贴板工具，请检查图形登录会话和剪贴板权限。")}</span></div>`;
  } else if (platform === "linux" && !available) {
    body = `${remoteInstallModesMarkup(diagnostics.install_plan || {}, mode => `installVncClipboardHelper('${escAttr(session.key)}','${escAttr(mode)}',this)`, "revealRemoteInstallManual(this)", actionKey)}<div class="connection-test-status warning">${icon("info")}<span>${esc(diagnostics.reason || "请安装与当前 X11/Wayland 会话匹配的剪贴板工具。")}</span></div>`;
  } else if (available) {
    const uninstallPlan = diagnostics.uninstall_plan || diagnostics.install_plan?.uninstall || {};
    const uninstallAction = platform === "linux" && uninstallPlan.available
      ? `<div class="actions tight"><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="uninstallVncClipboardHelper('${escAttr(session.key)}',this)">${icon("package-minus")}<span>卸载辅助工具</span></button></div>`
      : "";
    body = `<div class="connection-test-status success">${icon("circle-check")}<span>SSH Unicode 剪贴板通道已经可用。</span></div>${uninstallAction}`;
  } else {
    body = `<div class="connection-test-status warning">${icon("circle-alert")}<span>${esc(diagnostics.reason || "请先确认 SSH 辅助连接对应的远端系统。")}</span></div>`;
  }
  container.innerHTML = `<div class="rdp-server-head"><span class="xdmcp-server-icon ${available ? "ready" : "warning"}">${icon(available ? "circle-check" : "circle-alert")}</span><div><b>${esc(title)}</b><small>${esc(diagnostics.connection_name || session.profile.host || "")}</small></div><button class="icon-button" type="button" onclick="inspectVncClipboardHelper(vncSessions.get('${escAttr(session.key)}'),document.querySelector('#vncClipboardHelperState'))" title="重新检测" aria-label="重新检测">${icon("refresh-cw")}</button></div>${body}${vncClipboardHelperManualMarkup(diagnostics)}`;
  renderVncClipboardControls(session);
  setRemoteInstallDialogCommands(diagnostics.install_plan || {}, diagnostics.guide?.commands || []);
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function persistVncClipboardSshSelection(session, connectionId) {
  const profile = session.profile;
  const options = {...(profile.options || {})};
  delete options.ssh_connection_id;
  if (connectionId) options.source_ssh_connection_id = Number(connectionId);
  else delete options.source_ssh_connection_id;
  const saved = await api(`/api/remote-profiles/${profile.id}`, {method:"PUT", body:JSON.stringify({
    protocol:profile.protocol, name:profile.name, group_name:profile.group_name, host:profile.host,
    port:profile.port, username:profile.username || "", tags:profile.tags || "", options
  })});
  profile.options = saved.options || options;
  const listed = remoteProfileById(profile.id);
  if (listed) listed.options = {...profile.options};
}

async function inspectVncClipboardHelper(session, container) {
  if (!session?.profile || !container) return null;
  try {
    container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在识别远端系统和剪贴板辅助工具</span></div>`;
    refreshIcons();
    const connectionId = Number($("modal")?.querySelector("#vncClipboardSshConnection")?.value || 0);
    const diagnostics = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action:"guide", connection_id:connectionId})});
    renderVncClipboardHelperState(session, diagnostics, container);
    return diagnostics;
  } catch (error) {
    container.innerHTML = `<div class="connection-test-status error">${icon("circle-alert")}<span>${esc(error.message || "剪贴板辅助探测失败")}</span></div>`;
    refreshIcons();
    return null;
  }
}

function resetVncClipboardTransportState(session) {
  if (!session) return;
  session.clipboardTransport = "rfb";
  session.clipboardTransportChecked = false;
  session.clipboardTransportPromise = null;
  session.clipboardBridgeError = "";
  session.clipboardBridgeConnectionId = 0;
  session.clipboardBridgeConnectionName = "";
}

async function watchVncClipboardHelperTask(session, taskId, action="install") {
  if (!session || !taskId) return;
  const uninstalling = action === "uninstall";
  session.clipboardHelperTaskId = String(taskId);
  while (vncSessions.get(session.key) === session && session.clipboardHelperTaskId === String(taskId)) {
    await new Promise(resolve => setTimeout(resolve, 900));
    let task;
    try { task = await api(`/api/remote-component/tasks/${encodeURIComponent(taskId)}`); }
    catch (error) {
      if (session.clipboardHelperTaskId === String(taskId)) {
        session.clipboardHelperTaskId = "";
        session.clipboardBridgeError = error.message || `无法读取剪贴板辅助${uninstalling ? "卸载" : "安装"}状态`;
        setVncClipboardStatus(session, "SSH 剪贴板辅助不可用", "error");
        if (session.clipboardAutoSync) startVncClipboardPolling(session);
      }
      return;
    }
    if (task.status === "running") continue;
    session.clipboardHelperTaskId = "";
    if (task.status !== "done") {
      session.clipboardBridgeError = task.error || `剪贴板辅助工具${uninstalling ? "卸载" : "安装"}失败`;
      setVncClipboardStatus(session, "SSH 剪贴板辅助不可用", "error");
      notify(session.clipboardBridgeError, "error");
      if (session.clipboardAutoSync) startVncClipboardPolling(session);
      return;
    }
    let diagnostics = task.after || null;
    try {
      if (!diagnostics) diagnostics = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action:"guide"})});
      const helperState = document.querySelector("#vncClipboardHelperState");
      if (helperState && diagnostics) renderVncClipboardHelperState(session, diagnostics, helperState);
      resetVncClipboardTransportState(session);
      const transport = await ensureVncClipboardTransport(session);
      if (uninstalling) {
        if (vncClipboardUsesSsh(transport)) throw new Error("卸载完成后重新探测仍检测到 SSH 剪贴板辅助工具");
        setVncClipboardStatus(session, "SSH 剪贴板辅助已卸载", "success", 2600);
        notify("剪贴板辅助工具卸载完成，远端状态已重新探测", "success");
      } else {
        if (!vncClipboardUsesSsh(transport)) throw new Error(session.clipboardBridgeError || diagnostics?.reason || "安装完成，但当前图形会话仍无法访问系统剪贴板");
        setVncClipboardStatus(session, "SSH 剪贴板辅助已启用", "success", 2600);
        notify("剪贴板辅助工具安装完成，SSH Unicode 通道已刷新", "success");
      }
      if (session.clipboardAutoSync) startVncClipboardPolling(session);
    } catch (error) {
      session.clipboardBridgeError = error.message || `${uninstalling ? "卸载" : "安装"}完成，但 SSH 剪贴板辅助状态验证失败`;
      setVncClipboardStatus(session, "SSH 剪贴板辅助不可用", "error");
      notify(session.clipboardBridgeError, "error");
    }
    return;
  }
}

async function installVncClipboardHelper(key, mode="online", button=null) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify("VNC 会话不存在", "error");
  const actionKey = vncClipboardHelperActionKey(session.profile.id);
  if (!beginUiAction(actionKey, button, "安装中...")) {
    notify("剪贴板辅助工具任务正在执行，请等待完成", "info");
    return null;
  }
  const modal = $("modal");
  const connectionId = Number(modal?.querySelector("#vncClipboardSshConnection")?.value || 0);
  const diagnostics = session.clipboardHelperDiagnostics || {};
  const sourceId = connectionId || Number(diagnostics.connection_id || 0);
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
  const modeLabel = normalizedMode === "local-offline" ? "本机下载后离线" : normalizedMode === "offline" ? "使用远端缓存" : "在线";
  let adminAuth = null;
  try {
    setButtonBusy(button, true);
    await persistVncClipboardSshSelection(session, connectionId);
    session.clipboardHelperModalFinish?.({installing:true});
    if (!diagnostics.root) {
      adminAuth = await requestRemoteAdminAuthorization(sourceId, `${modeLabel}安装 Unicode 剪贴板辅助工具`);
      if (!adminAuth) return;
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action, connection_id:connectionId, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const activeAction = String(result.task.action || action);
      const activeUninstall = activeAction === "uninstall";
      stopVncClipboardPolling(session);
      resetVncClipboardTransportState(session);
      setVncClipboardStatus(session, activeUninstall ? "SSH 剪贴板辅助卸载中" : "SSH 剪贴板辅助安装中", "active");
      const requestAccepted = notifyRemoteComponentTaskRequest(result, `${modeLabel}安装剪贴板辅助工具`, `剪贴板辅助工具${modeLabel}安装已加入任务中心`);
      if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
      await watchVncClipboardHelperTask(session, result.task.id, activeAction);
      return requestAccepted ? result : null;
    }
    resetVncClipboardTransportState(session);
    renderVncClipboardHelperState(session, result.after || result.before, modal?.querySelector("#vncClipboardHelperState"));
    notify("剪贴板辅助工具安装完成", "success");
    return result;
  } catch (error) {
    notify(error.message || "剪贴板辅助工具安装失败", "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function uninstallVncClipboardHelper(key, button=null) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify("VNC 会话不存在", "error");
  const actionKey = vncClipboardHelperActionKey(session.profile.id);
  if (!beginUiAction(actionKey, button, "卸载中...")) {
    notify("剪贴板辅助工具任务正在执行，请等待完成", "info");
    return null;
  }
  const modal = $("modal");
  const connectionId = Number(modal?.querySelector("#vncClipboardSshConnection")?.value || 0);
  const diagnostics = session.clipboardHelperDiagnostics || {};
  const uninstallPlan = diagnostics.uninstall_plan || diagnostics.install_plan?.uninstall || {};
  if (String(diagnostics.platform || "").toLowerCase() !== "linux" || !diagnostics.available || !uninstallPlan.available) {
    return notify(uninstallPlan.reason || "当前没有可安全自动卸载的 Linux 剪贴板辅助工具", "error");
  }
  const sourceId = connectionId || Number(diagnostics.connection_id || 0);
  const packageLabel = Array.isArray(uninstallPlan.package_names) && uninstallPlan.package_names.length
    ? uninstallPlan.package_names.join("、")
    : diagnostics.tool || "剪贴板辅助软件包";
  let adminAuth = null;
  try {
    setButtonBusy(button, true, "准备卸载...");
    await persistVncClipboardSshSelection(session, connectionId);
    session.clipboardHelperModalFinish?.({installing:true});
    const confirmed = await confirmModal(
      `将从远端 Linux 卸载 ${packageLabel}。依赖该工具的其他桌面程序也可能受影响，VNC 将退回服务端原生剪贴板能力。是否继续？`,
      "卸载剪贴板辅助工具",
      "卸载",
      "取消",
      true
    );
    if (!confirmed) return null;
    if (!diagnostics.root) {
      adminAuth = await requestRemoteAdminAuthorization(sourceId, "卸载 Unicode 剪贴板辅助工具");
      if (!adminAuth) return null;
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action:"uninstall", connection_id:connectionId, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const activeAction = String(result.task.action || "uninstall");
      const activeUninstall = activeAction === "uninstall";
      stopVncClipboardPolling(session);
      resetVncClipboardTransportState(session);
      setVncClipboardStatus(session, activeUninstall ? "SSH 剪贴板辅助卸载中" : "SSH 剪贴板辅助安装中", "active");
      const requestAccepted = notifyRemoteComponentTaskRequest(result, "卸载剪贴板辅助工具", "剪贴板辅助工具卸载已加入任务中心");
      if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
      await watchVncClipboardHelperTask(session, result.task.id, activeAction);
      return requestAccepted ? result : null;
    }
    resetVncClipboardTransportState(session);
    notify("剪贴板辅助工具卸载完成", "success");
    return result;
  } catch (error) {
    notify(error.message || "剪贴板辅助工具卸载失败", "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function configureVncClipboardSsh(key) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify("VNC 会话不存在", "error");
  const connectionId = await requestVncClipboardSshConnection(session);
  if (connectionId === null) return focusEmbeddedVnc(session);
  if (connectionId?.installing) return focusEmbeddedVnc(session);
  try {
    await persistVncClipboardSshSelection(session, connectionId);
    session.clipboardTransport = "rfb";
    session.clipboardTransportChecked = false;
    session.clipboardTransportPromise = null;
    session.clipboardBridgeError = "";
    session.clipboardBridgeConnectionId = 0;
    session.clipboardBridgeConnectionName = "";
    const transport = await ensureVncClipboardTransport(session);
    if (!vncClipboardUsesSsh(transport)) {
      setVncClipboardStatus(session, "SSH 剪贴板辅助不可用", "error");
      notify(session.clipboardBridgeError || "所选 SSH 无法访问远端图形剪贴板，请检查远端剪贴板组件和桌面会话", "error");
      return;
    }
    setVncClipboardStatus(session, "SSH 剪贴板辅助已启用", "success", 2600);
    notify(`已通过 ${session.clipboardBridgeConnectionName || "所选 SSH"} 启用中文剪贴板辅助`, "success");
    if (session.clipboardPendingUnicodeText !== undefined) {
      const pending = session.clipboardPendingUnicodeText;
      session.clipboardPendingUnicodeText = undefined;
      await sendVncClipboardText(session, pending, true);
    }
    if (session.clipboardAutoSync) startVncClipboardPolling(session);
  } catch (error) {
    session.clipboardBridgeError = error.message || "SSH 剪贴板辅助设置失败";
    setVncClipboardStatus(session, "SSH 剪贴板辅助不可用", "error");
    notify(session.clipboardBridgeError, "error");
  } finally {
    focusEmbeddedVnc(session);
  }
}

function stopVncClipboardPolling(session) {
  if (!session?.clipboardPollTimer) return;
  clearInterval(session.clipboardPollTimer);
  session.clipboardPollTimer = null;
}

function resetVncClipboardBridgeWriteState(session) {
  if (!session) return;
  session.clipboardBridgeWriteRevision = Number(session.clipboardBridgeWriteRevision || 0) + 1;
  session.clipboardBridgeWritePendingRevision = 0;
  session.clipboardBridgeEchoGuard = null;
}

function vncClipboardSendUnavailableReason(session) {
  if (!session?.rfb || !session.connected) return "VNC 尚未连接完成";
  if (session.profile?.options?.view_only || session.rfb.viewOnly) return "仅查看模式不能向远端发送剪贴板";
  return "";
}

function vncClipboardSessionVisible(session) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof document !== "undefined" && typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  if (session?.viewport?.isConnected === false) return false;
  if (session?.viewport?.closest?.("[hidden]")) return false;
  return true;
}

async function readVncLocalClipboard() {
  if (window.termaDesktop?.readClipboardText) return String(await window.termaDesktop.readClipboardText());
  if (!navigator.clipboard?.readText) throw new Error("当前浏览器不支持直接读取剪贴板");
  return String(await navigator.clipboard.readText());
}

async function writeVncLocalClipboard(text, manual=false) {
  const value = String(text ?? "");
  if (window.termaDesktop?.writeClipboardText) {
    await window.termaDesktop.writeClipboardText(value);
    return;
  }
  if (!manual) {
    if (!navigator.clipboard?.writeText) throw new Error("当前浏览器不能自动写入剪贴板");
    await navigator.clipboard.writeText(value);
    return;
  }
  await writeClipboardText(value);
}

function vncSessionCanFocus(session) {
  if (!session?.workspace?.isConnected || !session?.viewport?.isConnected) return false;
  const pane = session.workspace.closest?.(".workspace-pane");
  if (!pane) return typeof activeTabKey === "undefined" || activeTabKey === session.key;
  const paneId = String(pane.dataset?.paneId || "");
  if (paneId && typeof focusedPaneId !== "undefined" && focusedPaneId && paneId !== focusedPaneId) return false;
  const paneState = paneId && typeof workspaceFindPane === "function" ? workspaceFindPane(paneId) : null;
  if (paneState?.activeTabKey && paneState.activeTabKey !== session.key) return false;
  return true;
}

function focusEmbeddedVnc(session) {
  if (!vncSessionCanFocus(session)) return false;
  try {
    session.rfb?.focus?.({preventScroll:true});
    return true;
  } catch {
    return false;
  }
}

async function ensureVncClipboardTransport(session) {
  if (!session || session.clipboardTransportChecked) return session?.clipboardTransport || "rfb";
  if (session.clipboardTransportPromise) return session.clipboardTransportPromise;
  resetVncClipboardBridgeWriteState(session);
  if (!vncClipboardBridgeCandidate(session)) {
    session.clipboardTransport = "rfb";
    session.clipboardTransportChecked = true;
    return "rfb";
  }
  session.clipboardTransportPromise = (async () => {
    try {
      const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard`);
      session.clipboardTransport = result?.available && vncClipboardUsesSsh(result?.transport) ? String(result.transport) : "rfb";
      session.clipboardTransportChecked = true;
      if (vncClipboardUsesSsh(session.clipboardTransport)) {
        session.clipboardBridgeConnectionId = Number(result.connection_id || 0);
        session.clipboardBridgeConnectionName = String(result.connection_name || "");
        session.clipboardBridgeResolvedBy = String(result.resolved_by || "");
        session.remoteClipboardBridgeLastSeen = normalizeVncClipboardText(result.text ?? "");
        session.remoteClipboardAvailable = true;
        session.remoteClipboardPending = false;
        session.remoteClipboardText = session.remoteClipboardBridgeLastSeen;
        session.clipboardBridgeError = "";
      } else {
        session.clipboardBridgeConnectionId = Number(result?.connection_id || session.clipboardBridgeConnectionId || 0);
        session.clipboardBridgeConnectionName = String(result?.connection_name || session.clipboardBridgeConnectionName || "");
        session.clipboardBridgeResolvedBy = String(result?.resolved_by || session.clipboardBridgeResolvedBy || "");
        session.clipboardBridgeError = String(result?.reason || "SSH 剪贴板辅助通道不可用");
      }
    } catch (error) {
      session.clipboardTransport = "rfb";
      session.clipboardTransportChecked = true;
      session.clipboardBridgeError = error.message || "SSH 剪贴板辅助通道不可用";
    } finally {
      session.clipboardTransportPromise = null;
      renderVncClipboardControls(session);
    }
    return session.clipboardTransport;
  })();
  return session.clipboardTransportPromise;
}

async function sendVncClipboardText(session, text, announce=false) {
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) {
    if (announce) notify(unavailable, "info");
    return false;
  }
  const value = String(text ?? "");
  const transport = await ensureVncClipboardTransport(session);
  if (vncClipboardUsesSsh(transport)) {
    const previousText = normalizeVncClipboardText(session.remoteClipboardBridgeLastSeen ?? session.remoteClipboardText ?? "");
    const writeRevision = Number(session.clipboardBridgeWriteRevision || 0) + 1;
    const writeOperationId = Number(session.clipboardRemoteOperationId || 0);
    const writeRfb = session.rfb;
    session.clipboardBridgeWriteRevision = writeRevision;
    session.clipboardBridgeWritePendingRevision = writeRevision;
    try {
      await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard`, {method:"POST", body:JSON.stringify({text:value})});
      if (session.clipboardBridgeWriteRevision !== writeRevision) return true;
      session.clipboardBridgeWritePendingRevision = 0;
      if (
        writeOperationId !== Number(session.clipboardRemoteOperationId || 0)
        || session.rfb !== writeRfb
        || !session.connected
      ) return false;
      session.clipboardBridgeEchoGuard = {
        expectedText:value,
        previousText,
        operationId:writeOperationId,
        expiresAt:Date.now() + VNC_CLIPBOARD_ECHO_GUARD_MS
      };
      session.remoteClipboardBridgeLastSeen = value;
      session.remoteClipboardAvailable = true;
      session.remoteClipboardText = value;
      session.remoteClipboardPending = false;
    } catch (error) {
      if (session.clipboardBridgeWritePendingRevision === writeRevision) session.clipboardBridgeWritePendingRevision = 0;
      if (session.clipboardBridgeWriteRevision !== writeRevision) return false;
      if (
        writeOperationId !== Number(session.clipboardRemoteOperationId || 0)
        || session.rfb !== writeRfb
        || !session.connected
      ) return false;
      setVncClipboardStatus(session, "SSH 剪贴板同步失败", "error");
      if (announce) notify(error.message || "写入远端系统剪贴板失败", "error");
      return false;
    }
  } else {
    if (vncClipboardNeedsUnicodeBridge(value) && !vncClipboardLegacyRfbCanSendUnicode(session)) {
      session.clipboardPendingUnicodeText = value;
      const reason = `${session.clipboardBridgeError || "远端 VNC 未协商 Unicode 剪贴板；请关联同主机 SSH，并在 Linux 安装 xclip/xsel 或 wl-clipboard"}。点击红色剪贴板状态进行设置`;
      setVncClipboardStatus(session, "中文剪贴板需要 SSH 辅助", "error");
      if (announce) notify(reason, "error");
      return false;
    }
    session.rfb.clipboardPasteFrom(value);
  }
  session.clipboardLastSeenLocal = value;
  session.clipboardLastSentText = value;
  const confirmed = vncClipboardUsesSsh(transport);
  setVncClipboardStatus(session, confirmed ? "已同步到远端" : "已发送（服务端未确认）", confirmed ? "success" : "warning", 2200);
  if (announce) notify(confirmed ? "本机剪贴板已通过 SSH 同步到远端系统" : "本机剪贴板已通过 VNC 发送，服务端不会返回确认", confirmed ? "success" : "info");
  return true;
}

async function syncVncClipboardFromLocal(session) {
  if (!session?.clipboardAutoSync || session.clipboardReadInFlight || !vncClipboardSessionVisible(session)) return false;
  if (vncClipboardSendUnavailableReason(session)) return false;
  session.clipboardReadInFlight = true;
  try {
    const text = await readVncLocalClipboard();
    if (text === session.clipboardLastSeenLocal) return false;
    session.clipboardLastSeenLocal = text;
    if (session.remoteClipboardAvailable && text === session.remoteClipboardText) return false;
    return await sendVncClipboardText(session, text, false);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/notallowed|denied|permission|权限|不支持|unavailable/i.test(message)) {
      session.clipboardAutoSync = false;
      session.clipboardPermissionBlocked = true;
      stopVncClipboardPolling(session);
      setVncClipboardStatus(session, "剪贴板权限受限", "error");
      if (!session.clipboardPermissionNoticeShown) {
        session.clipboardPermissionNoticeShown = true;
        notify("无法持续读取本机剪贴板，已改为手动同步", "info");
      }
    }
    return false;
  } finally {
    session.clipboardReadInFlight = false;
  }
}

function startVncClipboardPolling(session) {
  stopVncClipboardPolling(session);
  if (!session?.clipboardAutoSync || !session.connected) return;
  void ensureVncClipboardTransport(session);
  session.clipboardPollTimer = setInterval(() => {
    void syncVncClipboardFromLocal(session);
    void pollVncRemoteClipboardBridge(session);
  }, VNC_CLIPBOARD_POLL_INTERVAL_MS);
}

async function pollVncRemoteClipboardBridge(session, force=false) {
  if (!session?.connected || session.clipboardRemoteReadInFlight) return false;
  if (!force && (!session.clipboardAutoSync || !vncClipboardSessionVisible(session))) return false;
  const transport = await ensureVncClipboardTransport(session);
  if (!vncClipboardUsesSsh(transport)) return false;
  if (session.clipboardBridgeWritePendingRevision) return false;
  const readRevision = Number(session.clipboardBridgeWriteRevision || 0);
  const readOperationId = Number(session.clipboardRemoteOperationId || 0);
  const readRfb = session.rfb;
  session.clipboardRemoteReadInFlight = true;
  try {
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard`);
    if (
      readRevision !== Number(session.clipboardBridgeWriteRevision || 0)
      || readOperationId !== Number(session.clipboardRemoteOperationId || 0)
      || session.rfb !== readRfb
      || !session.connected
    ) return false;
    if (result?.truncated) {
      setVncClipboardStatus(session, `远端剪贴板超过 ${Math.round(Number(result.max_bytes || 0) / 1024)} KiB，未自动同步`, "warning");
      return false;
    }
    const value = normalizeVncClipboardText(result?.text ?? "");
    let echoGuard = session.clipboardBridgeEchoGuard;
    if (echoGuard && Number(echoGuard.operationId || 0) !== readOperationId) {
      session.clipboardBridgeEchoGuard = null;
      echoGuard = null;
    }
    if (echoGuard && Number(echoGuard.expiresAt || 0) <= Date.now()) {
      session.clipboardBridgeEchoGuard = null;
      echoGuard = null;
    }
    if (echoGuard && value === echoGuard.expectedText) {
      session.clipboardBridgeEchoGuard = null;
      session.remoteClipboardBridgeLastSeen = value;
      session.remoteClipboardAvailable = true;
      session.remoteClipboardText = value;
      session.remoteClipboardPending = false;
      renderVncClipboardControls(session);
      return false;
    }
    if (echoGuard && value === echoGuard.previousText) return false;
    if (echoGuard) session.clipboardBridgeEchoGuard = null;
    if (value === session.remoteClipboardBridgeLastSeen) return false;
    session.remoteClipboardBridgeLastSeen = value;
    session.remoteClipboardAvailable = true;
    session.remoteClipboardText = value;
    if (value === session.clipboardLastSentText) {
      session.remoteClipboardPending = false;
      renderVncClipboardControls(session);
      return false;
    }
    await handleVncRemoteClipboard(session, session.rfb, value);
    return true;
  } catch (error) {
    if (
      readRevision !== Number(session.clipboardBridgeWriteRevision || 0)
      || readOperationId !== Number(session.clipboardRemoteOperationId || 0)
      || session.rfb !== readRfb
      || !session.connected
    ) return false;
    session.clipboardBridgeError = error.message || "读取远端系统剪贴板失败";
    if (force) throw error;
    return false;
  } finally {
    session.clipboardRemoteReadInFlight = false;
  }
}

async function handleVncClipboardEvent(session, rfb, text) {
  if (!session || session.rfb !== rfb || !session.connected) return false;
  const transport = await ensureVncClipboardTransport(session);
  if (session.rfb !== rfb || !session.connected) return false;
  if (vncClipboardUsesSsh(transport)) {
    return pollVncRemoteClipboardBridge(session, true).catch(() => false);
  }
  await handleVncRemoteClipboard(session, rfb, normalizeVncClipboardText(text));
  return true;
}

async function handleVncRemoteClipboard(session, rfb, text) {
  if (!session || session.rfb !== rfb || !session.connected) return;
  const value = String(text ?? "");
  const operationId = Number(session.clipboardRemoteOperationId || 0) + 1;
  session.clipboardRemoteOperationId = operationId;
  session.remoteClipboardAvailable = true;
  session.remoteClipboardPending = true;
  session.remoteClipboardText = value;
  if (vncClipboardUsesSsh(session.clipboardTransport)) session.remoteClipboardBridgeLastSeen = value;
  renderVncClipboardControls(session);
  if (!session.clipboardAutoSync || !vncClipboardSessionVisible(session)) {
    setVncClipboardStatus(session, "收到远端内容，点击读取", "warning");
    return;
  }
  try {
    await writeVncLocalClipboard(value, false);
    if (session.rfb !== rfb || session.clipboardRemoteOperationId !== operationId) return;
    session.clipboardLastSeenLocal = value;
    session.remoteClipboardPending = false;
    session.clipboardPermissionBlocked = false;
    setVncClipboardStatus(session, "已从远端同步", "success", 2200);
  } catch (error) {
    if (session.rfb !== rfb || session.clipboardRemoteOperationId !== operationId) return;
    setVncClipboardStatus(session, "收到远端内容，点击读取", "warning");
    if (!session.clipboardRemoteWriteNoticeShown) {
      session.clipboardRemoteWriteNoticeShown = true;
      notify("已收到远端剪贴板；浏览器未允许自动写入，请点击工具栏的读取按钮", "info");
    }
  }
}

function requestVncClipboardText(session, reason="") {
  return new Promise(resolve => {
    const modal = $("modal");
    modal.hidden = false;
    modal.innerHTML = `<form class="modal-card vnc-clipboard-modal"><h2>发送剪贴板到 ${esc(session?.profile?.name || "VNC")}</h2>
      ${reason ? `<div class="connection-test-status warning">${esc(reason)}</div>` : ""}
      <label>要发送的文本</label><textarea id="vncClipboardManualText" rows="8" autofocus placeholder="在此按 Ctrl+V 或 Command+V 粘贴；留空可清空远端剪贴板"></textarea>
      <div class="muted">内容只发送到当前 VNC 会话，不会保存到 Terma。</div>
      <div class="actions"><button type="button" data-vnc-clipboard-cancel>取消</button><button class="primary" type="submit">发送</button></div></form>`;
    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      modal.onclick = null;
      modal.hidden = true;
      modal.innerHTML = "";
      resolve(value);
    };
    const onKeyDown = event => { if (event.key === "Escape") finish(null); };
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault();
      finish(modal.querySelector("#vncClipboardManualText")?.value ?? "");
    };
    modal.querySelector("[data-vnc-clipboard-cancel]").onclick = () => finish(null);
    modal.onclick = null;
    document.addEventListener("keydown", onKeyDown);
    setTimeout(() => modal.querySelector("#vncClipboardManualText")?.focus(), 0);
  });
}

function vncSessionStatus(session, text, state="") {
  if (!session) return;
  session.statusText = text;
  session.statusState = state;
  if (session.status) {
    session.status.textContent = text;
    session.status.className = `vnc-status${state ? ` ${state}` : ""}`;
  }
  setWorkspaceTabConnectionStatus(session.key, state === "connected" ? "connected" : state === "connecting" ? "connecting" : "disconnected");
}

function vncServiceFailureDetail(message="") {
  const value = String(message || "");
  if (/ECONNREFUSED|refused|拒绝/i.test(value)) return "远端拒绝了 5900 端口连接，VNC 服务可能尚未开启。";
  if (/ETIMEDOUT|timeout|超时/i.test(value)) return "连接远端 5900 端口超时，请同时检查网络和防火墙。";
  if (/ENOTFOUND|EAI_AGAIN|resolve|解析/i.test(value)) return "无法解析远端主机地址，请检查连接地址。";
  return "远端 5900 端口当前不可访问。";
}

function vncServerReady(diagnostics={}) {
  const selection = diagnostics?.server_session_selection || {};
  const selectedComponent = diagnostics?.selected_component || selection.component_state || null;
  if (diagnostics?.server_session_configurable === true) {
    if (selection.requires_selection || selection.source_available === false || diagnostics?.server_session_selection_matches_running === false) return false;
    if (selectedComponent) return selectedComponent.install_required !== true && selectedComponent.listening === true;
  }
  const status = String(diagnostics?.status || "").toLowerCase();
  return diagnostics?.listening === true || ["ready", "reachable"].includes(status);
}

function renderVncServerState(diagnostics, profileId=selectedRemoteProfileId, key=`remote-desktop-${profileId}`, targetContainer=null) {
  const container = targetContainer || $("vncServerState");
  const profile = remoteProfileById(profileId);
  if (!container || !profile) return;
  const actionKey = vncServerActionKey(profileId);
  container.dataset.remoteProfileId = String(profileId);
  const operationError = String(diagnostics?.error || diagnostics?.operation_error || "").trim();
  const lastGoodDiagnostics = container._vncLastGoodDiagnostics || {};
  const effectiveDiagnostics = operationError && Object.keys(lastGoodDiagnostics).length
    ? {...lastGoodDiagnostics, operation_error:operationError}
    : diagnostics || {};
  if (!operationError && !effectiveDiagnostics.error) container._vncLastGoodDiagnostics = effectiveDiagnostics;
  setRemoteComponentTaskHost(container, false);
  container._vncDiagnostics = effectiveDiagnostics;
  if (effectiveDiagnostics?.error && !effectiveDiagnostics?.status) {
    container.innerHTML = `<div class="connection-test-status warning">${icon("circle-alert")}<span>${esc(effectiveDiagnostics.error)}</span></div>`;
  } else {
    container.innerHTML = vncConnectionHelpMarkup(profile, effectiveDiagnostics?.platform || "", vncServerReady(effectiveDiagnostics), "", effectiveDiagnostics, key, {preflight:true, showConnect:false});
  }
  const status = String(effectiveDiagnostics?.status || "").toLowerCase();
  const selectedManagementBlocked = effectiveDiagnostics?.server_session_configurable === true && !vncServerReady(effectiveDiagnostics);
  const blocked = effectiveDiagnostics?.diagnostics_available !== false && (selectedManagementBlocked || ["not-installed", "stopped", "not-listening", "blocked"].includes(status));
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
  if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || blocked;
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectVncServer(profileId, button=null, targetContainer=null) {
  const container = targetContainer || $("vncServerState");
  if (button) setButtonBusy(button, true, "探测中...");
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 VNC 服务</span></div>`;
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
    renderVncServerState(diagnostics, profileId, `remote-desktop-${profileId}`, container);
    return diagnostics;
  } catch (error) {
    if (container) renderVncServerState({error:error.message || "VNC 服务探测失败"}, profileId, `remote-desktop-${profileId}`, container);
    throw error;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

function vncDiagnosticCopy(diagnostics, serviceAvailable, detail="") {
  const status = String(diagnostics?.status || "").toLowerCase();
  if (serviceAvailable || status === "ready" || status === "reachable") return {title:"VNC 服务可访问，但连接未完成", summary:"远端 VNC 端口可以访问，请检查认证方式和连接密码。"};
  const platform = String(diagnostics?.platform || "").toLowerCase();
  if (platform === "macos") return {title:"未开启 macOS 屏幕共享", summary:"macOS 自带 VNC 服务，请在系统设置中开启“屏幕共享”或“远程管理”。"};
  if (status === "not-installed") return {title:"未安装 VNC 服务", summary:"远端 Linux 主机没有检测到 VNC Server 组件，可以授权 Terma 安装，或按手册手动安装。"};
  if (status === "stopped") return {title:"VNC 服务已安装，但尚未启动", summary:"远端已经有 VNC 组件或服务单元，但目标端口没有监听。可以尝试启动服务，或打开手动配置说明。"};
  if (status === "blocked") return {title:"VNC 服务可能被防火墙拦截", summary:"远端检测到 VNC 组件，但目标端口没有从当前网络可访问；请检查防火墙和安全组。"};
  if (status === "not-listening") return {title:"VNC 服务未监听目标端口", summary:"远端 VNC 组件存在，但没有监听当前连接配置的端口，可能是显示编号或服务配置不一致。"};
  if (status === "ssh-unreachable" || status === "probe-failed") return {title:"无法完成远端 VNC 服务探测", summary:"SSH 管理连接暂时不可用，无法区分服务未安装和服务未启动；可以先打开手动安装/配置说明。"};
  return {title:"未检测到可用的 VNC 服务", summary:vncServiceFailureDetail(detail)};
}

function vncServerSessionSourceLabel(source={}) {
  const kind = source.kind === "xrdp" ? "XRDP 会话" : source.kind === "physical" ? "物理桌面" : "X11 桌面";
  const display = source.display || "未知显示";
  const owner = source.user ? ` · ${source.user}` : "";
  const desktop = source.desktop ? ` · ${source.desktop}` : "";
  return `${kind} ${display}${owner}${desktop}`;
}

function vncServerSessionSourceMarkup(profile, diagnostics={}, key="") {
  if (String(diagnostics?.platform || "").toLowerCase() !== "linux") return "";
  const sources = Array.isArray(diagnostics.session_sources) ? diagnostics.session_sources : [];
  const configurable = diagnostics.server_session_configurable !== false;
  const selection = diagnostics.server_session_selection || {};
  if (!configurable) {
    if (!diagnostics.server_mode || diagnostics.server_mode === "unknown") return "";
    const current = diagnostics.server_mode === "virtual" ? "TigerVNC 独立虚拟桌面" : diagnostics.source_display ? `当前共享 ${diagnostics.source_display}` : "当前 VNC 服务来源未知";
    return `<div class="vnc-server-source readonly"><span class="vnc-server-source-label">当前服务端桌面来源</span><strong>${esc(current)}</strong><small>当前 VNC 服务由系统单元管理，Terma 不会重写它的 DISPLAY；如需切换，请先在系统服务配置中修改。</small></div>`;
  }
  const selectedValue = selection.mode === "virtual"
    ? "virtual"
    : selection.mode === "shared" && selection.display
      ? `shared|${selection.display}`
      : "auto";
  const runningSource = diagnostics.server_mode === "virtual"
    ? "TigerVNC 独立虚拟桌面"
    : diagnostics.server_mode === "shared-x11" && diagnostics.source_display
      ? `共享 ${diagnostics.source_display}${diagnostics.source_xrdp ? "（XRDP 会话）" : ""}`
      : diagnostics.vnc_process
        ? "已检测到 VNC 进程，但来源未知"
        : "当前没有运行中的 VNC 桌面";
  const options = [
    `<option value="auto" ${selectedValue === "auto" ? "selected" : ""}>自动选择（只有一个活动桌面时）</option>`,
    ...sources.map(source => {
      const value = `shared|${source.display}`;
      const risk = source.kind === "xrdp" && diagnostics.xrdp_software_rendering ? " · Java GUI 白屏风险" : "";
      return `<option value="${escAttr(value)}" ${selectedValue === value ? "selected" : ""}>${esc(vncServerSessionSourceLabel(source)+risk)}</option>`;
    }),
    `<option value="virtual" ${selectedValue === "virtual" ? "selected" : ""}>TigerVNC 独立虚拟桌面</option>`
  ].join("");
  const warning = selection.requires_selection
    ? `<div class="connection-test-status warning">检测到多个活动图形桌面；请选择共享物理桌面、XRDP 会话或独立虚拟桌面，Terma 不会替你猜测。</div>`
    : selection.install_required || selection.manual_only
      ? `<div class="connection-test-status warning">${esc(selection.reason || diagnostics.start_plan_reason || "所选桌面来源需要先安装对应的 VNC 组件。")}</div>`
    : selection.reason && selection.source_available === false
      ? `<div class="connection-test-status warning">${esc(selection.reason)}</div>`
      : "";
  const actionKey = vncServerActionKey(profile.id);
  return `<div class="vnc-server-source"><span class="vnc-server-source-label">当前运行来源</span><strong>${esc(runningSource)}</strong><label class="vnc-server-source-label" for="vnc_server_session_source_${Number(profile.id)}">目标桌面来源</label><select id="vnc_server_session_source_${Number(profile.id)}" data-ui-action-key="${escAttr(actionKey)}" onchange="saveVncServerSessionSource(${Number(profile.id)},this,'${escAttr(key)}')">${options}</select><small>物理桌面和 XRDP 会话由 x11vnc 镜像已有画面；TigerVNC 独立虚拟桌面会创建新的 X11 会话，通常使用软件渲染。选择会保存，并在下次启动或重启 VNC 服务时生效。</small>${warning}</div>`;
}

async function saveVncServerSessionSource(profileId, select, key="") {
  if (!select) return;
  const stateContainer = select.closest?.("#vncServerState") || null;
  const explicitSession = key ? vncSessions.get(key) : null;
  const helpSession = explicitSession?.help?.contains(select)
    ? explicitSession
    : [...vncSessions.values()].find(session => session?.help?.contains(select)) || null;
  const value = String(select.value || "auto");
  const separator = value.indexOf("|");
  const mode = separator >= 0 ? value.slice(0, separator) : value;
  const display = separator >= 0 ? value.slice(separator + 1) : "";
  if (!["auto", "shared", "virtual"].includes(mode)) return;
  select.disabled = true;
  try {
    const profile = remoteProfileById(profileId);
    if (!profile) throw new Error("VNC 连接不存在");
    const updated = await api(`/api/remote-profiles/${Number(profileId)}`, {
      method:"PUT",
      body:JSON.stringify({options:{...(profile.options || {}), server_session_mode:mode, server_display:mode === "shared" ? display : ""}})
    });
    const index = remoteProfiles.findIndex(item => Number(item.id) === Number(updated.id));
    if (index >= 0) remoteProfiles[index] = updated;
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
    if (stateContainer?.isConnected) {
      renderVncServerState(diagnostics, profileId, key || `remote-desktop-${profileId}`, stateContainer);
    } else if (helpSession?.help?.isConnected) {
      showVncConnectionHelp(helpSession, vncServerReady(diagnostics), "", diagnostics);
    } else {
      const currentContainer = $("vncServerState");
      if (currentContainer) renderVncServerState(diagnostics, profileId, key || `remote-desktop-${profileId}`, currentContainer);
    }
    notify("VNC 服务端桌面来源已保存", "success");
  } catch (error) {
    notify(error.message || "保存 VNC 桌面来源失败", "error");
  } finally {
    if (document.contains(select)) select.disabled = false;
  }
}

function vncSessionKeyForProfile(profileId) {
  for (const [key, session] of vncSessions.entries()) {
    if (Number(session?.profile?.id) === Number(profileId)) return key;
  }
  return `remote-desktop-${Number(profileId)}`;
}

function vncConnectionHelpMarkup(profile, platform="", serviceAvailable=false, detail="", diagnostics=null, key="", options={}) {
  const resolvedPlatform = String(diagnostics?.platform || platform || "").toLowerCase();
  const macos = resolvedPlatform === "macos";
  const selection = diagnostics?.server_session_selection || {};
  const selectedComponent = diagnostics?.selected_component || selection.component_state || null;
  const componentScoped = diagnostics?.server_session_configurable === true && Boolean(selectedComponent);
  const componentInstallRequired = componentScoped && (selection.install_required === true || selectedComponent.install_required === true);
  const status = componentScoped
    ? componentInstallRequired
      ? "not-installed"
      : selectedComponent.listening
        ? "ready"
        : selectedComponent.running
          ? "not-listening"
          : selectedComponent.installed
            ? "stopped"
            : "not-installed"
    : String(diagnostics?.status || "").toLowerCase();
  const reconnectKey = key || `remote-desktop-${profile.id}`;
  const actionKey = vncServerActionKey(profile.id);
  const installPlan = diagnostics?.install_plan || {};
  const installed = componentScoped
    ? selectedComponent.installed === true
    : Boolean(diagnostics?.installed || diagnostics?.service_unit || diagnostics?.commands?.length);
  const running = componentScoped
    ? selectedComponent.listening === true && diagnostics?.server_session_selection_matches_running !== false
    : Boolean(serviceAvailable || diagnostics?.listening || ["ready", "reachable"].includes(status));
  const currentRunning = Boolean(serviceAvailable || diagnostics?.listening || ["ready", "reachable"].includes(String(diagnostics?.status || "").toLowerCase()));
  const selectionPending = diagnostics?.server_session_configurable === true && diagnostics?.server_session_selection_matches_running === false;
  const copy = componentInstallRequired
    ? {title:`未安装 ${selectedComponent.label || "所选 VNC 组件"}`, summary:selection.reason || selectedComponent.reason || diagnostics?.start_plan_reason || "请先安装所选桌面来源需要的 VNC 组件。"}
    : selectionPending
      ? {title:"所选桌面来源尚未生效", summary:"当前 VNC 服务仍在使用旧来源；请应用来源并重启，或先安装目标来源需要的组件。"}
      : options.preflight && running
    ? {title:"VNC 服务已就绪", summary:"远端 VNC 端口和服务探测通过，可以打开远程桌面。"}
    : vncDiagnosticCopy(diagnostics, serviceAvailable, detail);
  const needsInstall = componentInstallRequired || status === "not-installed" || (["stopped", "not-listening"].includes(status) && !diagnostics?.start_plan && !installed);
  const installModes = needsInstall && !macos
    ? remoteInstallModesMarkup(installPlan, mode => `installVncServer(${Number(profile.id)},'${escAttr(reconnectKey)}',this,'${mode}')`, `openVncSetupGuide(${Number(profile.id)})`, actionKey)
    : "";
  const startButton = ["stopped", "not-listening", "blocked"].includes(status) && diagnostics?.start_plan
    ? `<button class="primary" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="startVncServer(${Number(profile.id)},'${escAttr(reconnectKey)}',this)">${icon("play")}<span>${status === "blocked" ? "放行并启动" : diagnostics.start_plan.kind === "service" ? "启动 VNC 服务" : diagnostics.start_plan.kind === "tigervnc-systemd" ? "配置并启用 TigerVNC" : "配置并启动"}</span></button>`
    : "";
  const toggleButton = running
    ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','stop',this)">${icon("circle-stop")}<span>停止服务</span></button>`
    : !startButton && diagnostics?.start_plan
      ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','start',this)">${icon("circle-play")}<span>启动服务</span></button>`
      : "";
  const serviceActions = installed && !macos ? `${toggleButton}<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','uninstall',this)">${icon("package-minus")}<span>卸载服务</span></button>` : "";
  const restartForSelection = currentRunning && diagnostics?.start_plan && diagnostics?.server_session_configurable && diagnostics?.server_session_selection_matches_running === false
    ? `<button class="primary" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','restart',this)">${icon("refresh-cw")}<span>应用来源并重启</span></button>`
    : "";
  const activeSession = vncSessions.get(reconnectKey);
  const serviceComponent = diagnostics?.running_component || diagnostics?.selected_component || null;
  const serviceUnit = String(serviceComponent?.service_unit || diagnostics?.service_unit || "").trim();
  const serviceState = String(serviceComponent?.service_state || diagnostics?.service_state || "未知");
  const listenerProcess = String(serviceComponent?.listener_process || diagnostics?.listener_process || "").trim();
  const listenerName = listenerProcess
    ? (listenerProcess.match(/(?:^|\/)\b(Xtigervnc|Xvnc|x11vnc|wayvnc|gnome-remote-desktop)\b/i)?.[1] || "VNC 监听进程")
    : "";
  const embedded = profile.options?.client_mode !== "system";
  const reconnecting = Boolean(activeSession?.workspace) || (!options.preflight && !running);
  const connectAction = embedded
    ? activeSession?.workspace
      ? `reconnectEmbeddedVnc(${Number(profile.id)},'${escAttr(reconnectKey)}')`
      : `openEmbeddedVncDesktop(${Number(profile.id)},'${escAttr(reconnectKey)}',this)`
    : `launchRemoteDesktop(${Number(profile.id)},'${escAttr(reconnectKey)}',this)`;
  const connectLabel = reconnecting ? "重新连接" : embedded ? "打开内置 VNC" : "打开系统客户端";
  const connectButton = options.showConnect === false ? "" : `<button class="primary" type="button" onclick="${connectAction}">${icon(reconnecting ? "refresh-cw" : embedded ? "monitor" : "external-link")}<span>${connectLabel}</span></button>`;
  return `<div class="remote-service-state vnc-connection-help-panel">
    <div class="remote-service-head vnc-connection-help-head"><span class="remote-service-icon ${running ? "ready" : status === "not-installed" ? "error" : "warning"}">${icon(running ? "circle-check" : status === "not-installed" ? "package-x" : "monitor-off")}</span><div class="vnc-connection-help-copy">
      <strong>${esc(copy.title)}</strong>
      <span>${esc(copy.summary)}</span>
    </div></div>
    ${diagnostics?.operation_error ? `<div class="connection-test-status error">${icon("circle-alert")}<span>${esc(diagnostics.operation_error)}</span></div>` : ""}
    ${macos ? `<div class="vnc-setup-path"><span>开启路径</span><code>系统设置 &gt; 通用 &gt; 共享 &gt; 屏幕共享</code></div>
      <ol class="vnc-setup-steps">
        <li>开启“屏幕共享”或“远程管理”，二者选择一个即可。</li>
        <li>打开右侧详情，在“允许访问”中加入此连接使用的 macOS 账号。</li>
        <li>使用内置 VNC 时，允许 VNC 观看者使用密码控制屏幕并设置密码，然后在连接设置中保存该密码。</li>
      </ol>
      <div class="vnc-setup-legacy">旧版 macOS：系统偏好设置 &gt; 共享 &gt; 屏幕共享</div>` : `<div class="vnc-setup-path"><span>检查项目</span><code>VNC 服务 · TCP ${Number(diagnostics?.port || profile.port || 5900)} · 防火墙 · 连接密码</code></div>`}
    ${serviceUnit ? `<div class="vnc-setup-legacy" title="${escAttr(listenerProcess)}">服务单元：${esc(serviceUnit)} · 状态：${esc(serviceState)}${listenerName ? ` · 监听进程：${esc(listenerName)}` : ""}${diagnostics?.start_plan?.persistent ? " · Terma 管理 · 重启后自动启动" : ""}</div>` : ""}
    ${vncServerSessionSourceMarkup(profile, diagnostics || {}, reconnectKey)}
    ${installModes}
    ${remoteGraphicsRenderingMarkup(diagnostics || {})}
    <div class="remote-service-actions">
      ${restartForSelection}${startButton}${serviceActions}
      ${options.preflight ? "" : `<button type="button" onclick="openVncSetupGuide(${Number(profile.id)})">${icon("book-open-check")}<span>手动安装/配置说明</span></button>`}
      ${connectButton}
      ${options.preflight ? "" : `<button type="button" onclick="editRemoteProfile(${Number(profile.id)})">${icon("settings-2")}<span>连接设置</span></button>`}
    </div>
  </div>`;
}

function hideVncConnectionHelp(session) {
  if (!session) return;
  session.helpState = null;
  if (session.help) {
    session.help.hidden = true;
    session.help.innerHTML = "";
  }
}

function showVncConnectionHelp(session, serviceAvailable=false, detail="", diagnostics=null) {
  if (!session) return;
  session.helpState = {serviceAvailable:Boolean(serviceAvailable), detail:String(detail || ""), diagnostics:diagnostics || null};
  if (diagnostics) {
    session.vncServerDiagnostics = diagnostics;
    session.remotePlatform = diagnostics.platform || diagnostics.os_id || session.remotePlatform;
    applyVncCursorPolicy(session);
  }
  if (!session.help) return;
  session.help.innerHTML = vncConnectionHelpMarkup(session.profile, session.remotePlatform, serviceAvailable, detail, diagnostics, session.key);
  session.help.hidden = false;
  refreshIcons();
  const actionKey = vncServerActionKey(session.profile?.id);
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function diagnoseEmbeddedVncDisconnect(profile, key) {
  const session = vncSessions.get(key);
  if (!session) return;
  const diagnosticToken = Number(session.diagnosticToken || 0) + 1;
  session.diagnosticToken = diagnosticToken;
  vncSessionStatus(session, "正在检测 VNC 端口...", "connecting");
  let serviceAvailable = false;
  let detail = "";
  let diagnostics = null;
  const stageTimer = setTimeout(() => {
    if (vncSessions.get(key) === session && session.diagnosticToken === diagnosticToken) vncSessionStatus(session, "正在通过 SSH 检查服务...", "connecting");
  }, 650);
  const planTimer = setTimeout(() => {
    if (vncSessions.get(key) === session && session.diagnosticToken === diagnosticToken) vncSessionStatus(session, "正在生成修复方案...", "connecting");
  }, 1800);
  try {
    diagnostics = await api(`/api/remote-profiles/${profile.id}/vnc/server`);
    serviceAvailable = diagnostics?.status === "ready" || diagnostics?.status === "reachable" || diagnostics?.listening === true;
  } catch (error) {
    detail = error.message || "";
  } finally {
    clearTimeout(stageTimer);
    clearTimeout(planTimer);
  }
  if (!vncSessions.has(key) || session.diagnosticToken !== diagnosticToken || session.rfb || session.connecting) return;
  const copy = vncDiagnosticCopy(diagnostics, serviceAvailable, detail);
  vncSessionStatus(session, copy.title, "error");
  showVncConnectionHelp(session, serviceAvailable, detail, diagnostics);
}

function closeVncSetupGuide() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
  modal._vncCommands = null;
  modal._vncProfileId = null;
  modal._remoteInstallCommands = null;
}

async function copyVncSetupCommands() {
  const commands = Array.isArray($("modal")?._vncCommands) ? $("modal")._vncCommands : [];
  if (!commands.length) return notify("当前没有可复制的命令", "info");
  try {
    await copyText(commands.join("\n"));
    notify("VNC 配置命令已复制", "success");
  } catch (error) {
    notify(error.message || "复制命令失败", "error");
  }
}

async function openVncSetupGuide(profileId) {
  const modal = $("modal");
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
    const guide = diagnostics.guide || {};
    const commands = Array.isArray(guide.commands) ? guide.commands.filter(Boolean) : [];
    const steps = Array.isArray(guide.steps) ? guide.steps : [];
    const title = guide.title || "VNC 安装/配置说明";
    const state = diagnostics.status || "unknown";
    const selection = diagnostics.server_session_selection || {};
    const selectedComponent = diagnostics.selected_component || selection.component_state || null;
    const componentScoped = diagnostics.server_session_configurable === true && Boolean(selectedComponent);
    const installed = componentScoped ? selectedComponent.installed === true : Boolean(diagnostics.installed || diagnostics.service_unit || diagnostics.commands?.length);
    const running = componentScoped ? vncServerReady(diagnostics) : Boolean(diagnostics.listening || ["ready", "reachable"].includes(String(state).toLowerCase()));
    const key = vncSessionKeyForProfile(profileId);
    const actionKey = vncServerActionKey(profileId);
    const installPlan = diagnostics.install_plan || {};
    const installModes = (componentScoped ? selectedComponent.install_required === true : !installed) && diagnostics.platform !== "macos"
      ? remoteInstallModesMarkup(installPlan, mode => `installVncServer(${Number(profileId)},'${escAttr(key)}',this,'${mode}')`, "revealRemoteInstallManual(this)", actionKey)
      : "";
    const startAvailable = Boolean(diagnostics.start_plan);
    const serviceToggle = running
      ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','stop',this)">${icon("circle-stop")}<span>停止服务</span></button>`
      : startAvailable
        ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','start',this)">${icon("circle-play")}<span>启动服务</span></button>`
        : "";
    const serviceActions = installed && diagnostics.platform !== "macos" ? `${serviceToggle}<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','uninstall',this)">${icon("package-minus")}<span>卸载服务</span></button>` : "";
    modal.innerHTML = `<div class="modal-card wide x11-install-guide vnc-setup-guide" role="dialog" aria-modal="true" aria-labelledby="vncSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="vncSetupGuideTitle">${esc(title)}</h2><span class="muted">${esc(diagnostics.ssh_connection?.name || diagnostics.platform || "远端主机")}</span></div><button class="icon-button" type="button" onclick="closeVncSetupGuide()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status ${state === "ready" || state === "reachable" ? "success" : "warning"}">${esc(guide.summary || "请按下面步骤完成 VNC 服务配置。")}</div>
      ${installModes}
      ${remoteInstallManualMarkup(installPlan, {steps, commands, note:"Terma 只会在你明确授权后执行安装、启停或卸载。VNC 密码不会写入命令、日志或本窗口；本机也无法联网时，请在其他匹配远端系统版本与 CPU 架构的设备准备软件包和全部依赖。"})}
      <div id="vncSetupTaskState"></div>
      <div class="actions"><button type="button" onclick="closeVncSetupGuide()">关闭</button>${serviceActions}${commands.length ? `<button type="button" onclick="copyVncSetupCommands()">${icon("copy")}<span>复制命令</span></button>` : ""}</div>
    </div>`;
    modal._vncCommands = commands;
    modal._vncProfileId = Number(profileId);
    setRemoteInstallDialogCommands(installPlan, commands);
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
    return diagnostics;
  } catch (error) {
    notify(error.message || "VNC 安装说明读取失败", "error");
    return null;
  }
}

async function runVncServerAction(profileId, key, action, button=null) {
  const actionKey = vncServerActionKey(profileId);
  const busyLabel = action === "stop" || action === "disable"
    ? "停止中..."
    : action === "uninstall"
      ? "卸载中..."
      : action === "install" || action === "install-offline" || action === "install-local-offline"
        ? "安装中..."
        : "启动中...";
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify("VNC 服务任务正在执行，请等待完成", "info");
    return null;
  }
  try {
    return await runVncServerActionImpl(profileId, key, action, button);
  } finally {
    endUiAction(actionKey, button);
  }
}

async function runVncServerActionImpl(profileId, key, action, button=null) {
  const profile = remoteProfileById(profileId);
  if (!profile) return notify("VNC 连接不存在", "error");
  const session = vncSessions.get(key);
  let diagnostics = session?.helpState?.diagnostics || {};
  if (!Object.keys(diagnostics).length) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
  const sourceId = Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || diagnostics.ssh_connection?.id || 0);
  if (!sourceId) return notify("该 VNC 连接没有关联的 SSH 管理连接", "error");
  const isInstall = action === "install" || action === "install-offline" || action === "install-local-offline";
  const uninstall = action === "uninstall";
  const stop = action === "stop" || action === "disable";
  const offlineInstall = action === "install-offline";
  const localOfflineInstall = action === "install-local-offline";
  const installModeLabel = localOfflineInstall ? "本机下载后离线" : offlineInstall ? "使用远端缓存" : "在线";
  let transientVncPassword = "";
  let allowNoPassword = false;
  let saveVncPasswordAfterConfirm = false;
  let refreshAfterError = false;
  const startsVncService = ["start", "restart", "enable"].includes(action);
  const startPlanSupportsNoPassword = diagnostics?.start_plan?.supports_no_password === true;
  const startPlanRequiresPassword = diagnostics?.start_plan?.requires_vnc_password === true;
  if (startsVncService && !profile.has_password && !diagnostics?.password_file && (startPlanSupportsNoPassword || startPlanRequiresPassword)) {
    const credentials = await requestVncCredentials(profile, ["password"], {
      failureReason:startPlanSupportsNoPassword
        ? "当前连接没有保存 VNC 服务密码。默认请设置密码；仅在可信网络中明确选择无密码访问。"
        : "当前连接没有保存 VNC 服务密码，请先设置一个服务密码。",
      allowNoPassword:startPlanSupportsNoPassword,
      updateByDefault:true,
      title:startPlanSupportsNoPassword ? "设置 VNC 服务认证" : "设置 VNC 服务密码",
      submitLabel:"保存并继续"
    });
    if (!credentials) return null;
    allowNoPassword = credentials.allow_no_password === true;
    if (!credentials.credentials?.password && !allowNoPassword) return null;
    transientVncPassword = String(credentials.credentials.password);
    saveVncPasswordAfterConfirm = Boolean(credentials.update_saved_password && transientVncPassword);
  }
  const message = isInstall
    ? localOfflineInstall
      ? "Terma 将根据远端 Debian/Ubuntu 或兼容 APT/.deb 系统的软件包索引，在本机下载匹配架构的软件包和依赖，再通过 SFTP 上传并使用临时管理员权限安装。是否继续？"
      : `Terma 将在远端执行${offlineInstall ? "缓存离线" : "在线"}安装。安装不会自动覆盖现有 VNC 配置，是否继续？`
    : uninstall
      ? "将停止并卸载远端 VNC Server 与剪贴板辅助软件包。不会卸载 Linux 桌面环境，但现有 VNC 会话会立即断开。是否继续？"
      : stop
        ? "将停止远端 VNC 服务，现有 VNC 会话会立即断开。是否继续？"
        : "Terma 将尝试启动检测到的 VNC 服务单元，是否继续？";
  const actionLabel = isInstall ? `${installModeLabel}安装 VNC 服务` : uninstall ? "卸载 VNC 服务" : stop ? "停止 VNC 服务" : "启动 VNC 服务";
  if (!await confirmModal(message, actionLabel, isInstall ? "安装" : uninstall ? "卸载" : stop ? "停止" : "启动", "取消", uninstall || stop)) return null;
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    adminAuth = await requestRemoteAdminAuthorization(sourceId, actionLabel);
    if (!adminAuth) return null;
  }
  if (button) setButtonBusy(button, true, isInstall ? `${installModeLabel}安装中...` : uninstall ? "卸载中..." : stop ? "停止中..." : "启动中...");
  if (session) vncSessionStatus(session, isInstall ? `正在${installModeLabel}安装 VNC 服务...` : uninstall ? "正在卸载 VNC 服务..." : stop ? "正在停止 VNC 服务..." : "正在配置并启动 VNC 服务...", "connecting");
  try {
    const result = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`, {method:"POST", body:JSON.stringify({action, allow_no_password:allowNoPassword === true, ...(transientVncPassword ? {vnc_password:transientVncPassword} : {}), ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (saveVncPasswordAfterConfirm && !result.task_conflict) {
      try {
        await saveVncCredential(profile, transientVncPassword);
      } catch (error) {
        notify(`服务请求已提交，但密码未能保存，将仅用于本次启动：${error.message}`, "info");
      }
    }
    if (result.task) {
      const modalTaskHost = Number($("modal")?._vncProfileId || 0) === Number(profileId) ? $("vncSetupTaskState") : null;
      const taskStateContainer = $("vncServerState");
      const sessionTaskHost = vncSessions.get(key)?.help || null;
      const taskFallbackContainer = taskStateContainer || sessionTaskHost || null;
      const taskScope = captureRemoteComponentTaskScope(profileId, key, taskFallbackContainer || modalTaskHost);
      const runningLabel = String(result.task.action_label || result.task.component_label || actionLabel);
      if (session) vncSessionStatus(session, result.task_conflict ? `${runningLabel}任务正在执行` : `${actionLabel}已加入任务中心`, "connecting");
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => modalTaskHost?.isConnected && Number($("modal")?._vncProfileId || 0) === Number(profileId)
          ? modalTaskHost
          : taskFallbackContainer,
        scope:taskScope,
        title:actionLabel,
        onDone:async () => {
          if (vncSessions.get(key)) await diagnoseEmbeddedVncDisconnect(profile, key);
          const workspaceContainer = remoteComponentTaskContainer(taskScope, taskStateContainer);
          if (workspaceContainer?.id === "vncServerState") await inspectVncServer(profileId, null, workspaceContainer).catch(() => {});
          if (Number($("modal")?._vncProfileId || 0) === Number(profileId)) await openVncSetupGuide(profileId);
        }
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, actionLabel, `${actionLabel}已加入任务中心`);
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    const after = result.after || result.before || {};
    if (session) {
      session.remotePlatform = after.platform || session.remotePlatform;
      session.vncServerDiagnostics = after;
      applyVncCursorPolicy(session);
      const available = after.status === "ready" || after.status === "reachable" || after.listening === true;
      const copy = vncDiagnosticCopy(after, available, result.output || "");
      vncSessionStatus(session, copy.title, "error");
      showVncConnectionHelp(session, available, result.output || "", after);
    }
    if ($("vncServerState")) renderVncServerState(after, profileId, key);
    notify(isInstall ? "VNC 服务组件安装完成，可继续配置并启动" : uninstall ? "VNC 服务卸载完成" : stop ? "VNC 服务已停止" : "VNC 服务配置/启动命令已执行", "success");
    return result;
  } catch (error) {
    refreshAfterError = true;
    notify(error.message || "VNC 服务操作失败", "error");
    if (session) vncSessionStatus(session, error.message || "VNC 服务操作失败", "error");
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
    const container = $("vncServerState");
    if (refreshAfterError && container && Number(container.dataset.remoteProfileId || selectedRemoteProfileId || 0) === Number(profileId)) {
      await inspectVncServer(profileId, null, container).catch(() => {});
    }
  }
}

function installVncServer(profileId, key, button=null, mode="online") {
  const action = mode === "local-offline" || mode === "install-local-offline"
    ? "install-local-offline"
    : mode === "offline" || mode === "install-offline"
      ? "install-offline"
      : "install";
  return runVncServerAction(profileId, key, action, button);
}

function startVncServer(profileId, key, button=null) {
  return runVncServerAction(profileId, key, "start", button);
}

async function openEmbeddedVncDesktop(profileId, key=`remote-desktop-${profileId}`, button=null) {
  const profile = remoteProfileById(profileId);
  if (!profile || profile.protocol !== "vnc") return notify("VNC 连接不存在", "error");
  const view = $("view-remote-desktop");
  if (!view) return null;
  const renderScope = captureRemoteDesktopRenderScope(profile.id, key, view);
  const existingSession = vncSessions.get(key);
  if (existingSession?.workspace && (existingSession.connected || existingSession.connecting)) {
    existingSession.presentation = "viewer";
    return withRemoteDesktopRenderScope(renderScope, () => {
      renderEmbeddedVnc(profile, key);
      return true;
    }) || null;
  }
  if (button) setButtonBusy(button, true, "打开中...");
  try {
    const [diagnostics, desktopDiagnostics] = await Promise.all([
      api(`/api/remote-profiles/${Number(profileId)}/vnc/server`).catch(() => null),
      inspectLinuxDesktopForRemoteProfile(profile)
    ]);
    if (desktopDiagnostics?.platform_supported !== false && desktopDiagnostics && !desktopDiagnostics.has_desktop) {
      withRemoteDesktopRenderScope(renderScope, () => renderLinuxDesktopMissingWorkspace(profile, key, desktopDiagnostics));
      return null;
    }
    return withRemoteDesktopRenderScope(renderScope, () => {
      renderEmbeddedVnc(profile, key, diagnostics || desktopDiagnostics);
      return true;
    }) || null;
  } catch (error) {
    withRemoteDesktopRenderScope(renderScope, () => notify(error.message || "内置 VNC 打开失败", "error"));
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function renderEmbeddedVnc(profile, key, diagnostics=null) {
  const view = $("view-remote-desktop");
  let session = vncSessions.get(key);
  if (session?.workspace) {
    view.replaceChildren(session.workspace);
    session.presentation = "viewer";
    session.profile = profile;
    const sourceConnection = currentConnection(Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0));
    const sourcePlatform = String(sourceConnection?.terminal_program_platform || "").toLowerCase();
    session.vncServerDiagnostics = diagnostics || session.vncServerDiagnostics || null;
    session.remotePlatform = diagnostics?.platform || diagnostics?.os_id || (["macos", "darwin"].includes(sourcePlatform) ? "macos" : "") || session.remotePlatform || "";
    session.viewport = session.workspace.querySelector("#vncViewport");
    session.screen = session.workspace.querySelector(".vnc-screen") || session.screen;
    applyVncDisplayMode(session);
    applyVncCursorPolicy(session);
    session.status = session.workspace.querySelector("#vncStatus");
    session.clipboardStatus = session.workspace.querySelector("#vncClipboardStatus");
    session.clipboardHelperButton = session.workspace.querySelector("[data-vnc-clipboard-helper]");
    session.clipboardSyncButton = session.workspace.querySelector("[data-vnc-clipboard-sync]");
    session.clipboardReceiveButton = session.workspace.querySelector("[data-vnc-clipboard-receive]");
    session.help = session.viewport?.querySelector("#vncConnectionHelp") || null;
    vncSessionStatus(session, session.statusText || `正在连接 ${remoteProfileEndpoint(profile)}`, session.statusState || "connecting");
    renderVncClipboardControls(session);
    if (session.helpState) showVncConnectionHelp(session, session.helpState.serviceAvailable, session.helpState.detail, session.helpState.diagnostics);
    requestAnimationFrame(() => {
      try {
        applyVncDisplayMode(session);
      } catch {}
      focusEmbeddedVnc(session);
    });
    refreshIcons();
    if (!session.rfb && !session.connecting) connectEmbeddedVnc(profile, key);
    return;
  }
  const managementNodes = session?.managementNodes?.length
    ? session.managementNodes
    : view.querySelector("#vncServerState")
      ? Array.from(view.childNodes)
      : [];
  view.innerHTML = `<div class="vnc-workspace" data-vnc-key="${escAttr(key)}">
    <div class="vnc-toolbar">
      <div class="vnc-toolbar-status"><span class="terminal-connection-dot"></span><span id="vncStatus" class="vnc-status connecting">正在连接 ${esc(remoteProfileEndpoint(profile))}</span><button id="vncClipboardStatus" class="vnc-clipboard-status clickable" type="button" onclick="configureVncClipboardSsh('${escAttr(key)}')" role="status" aria-live="polite">剪贴板：手动</button></div>
      <div class="vnc-toolbar-actions">
        <button class="icon-button" onclick="showVncManagement(${profile.id},'${escAttr(key)}')" title="返回探测与管理" aria-label="返回探测与管理">${icon("arrow-left")}</button>
        <button class="icon-button" onclick="sendVncCtrlAltDelete('${escAttr(key)}')" title="发送 Ctrl+Alt+Del" aria-label="发送 Ctrl+Alt+Del">${icon("keyboard")}</button>
        <button class="vnc-clipboard-helper-button" data-vnc-clipboard-helper onclick="configureVncClipboardSsh('${escAttr(key)}')" title="设置 SSH 剪贴板辅助" aria-label="设置 SSH 剪贴板辅助">${icon("link-2")}<span>SSH 辅助</span></button>
        <button class="icon-button" data-vnc-clipboard-sync onclick="toggleVncClipboardSync('${escAttr(key)}')" title="开启剪贴板自动同步" aria-label="开启剪贴板自动同步" aria-pressed="false">${icon("clipboard-check")}</button>
        <button class="icon-button" onclick="pasteClipboardToVnc('${escAttr(key)}')" title="发送本机剪贴板" aria-label="发送本机剪贴板">${icon("clipboard-paste")}</button>
        <button class="icon-button" data-vnc-clipboard-receive onclick="copyVncClipboardFromRemote('${escAttr(key)}')" title="远端尚未发送剪贴板" aria-label="远端尚未发送剪贴板" disabled>${icon("clipboard-copy")}</button>
        <button class="icon-button" data-vnc-cursor-mode onclick="showVncCursorModeMenu(event,'${escAttr(key)}')" title="鼠标模式：自动" aria-label="鼠标模式：自动" aria-pressed="false">${icon("mouse-pointer-2")}</button>
        <button class="icon-button" onclick="toggleVncFullscreen('${escAttr(key)}')" title="全屏" aria-label="全屏">${icon("maximize-2")}</button>
        <button class="icon-button" onclick="openVncSetupGuide(${profile.id})" title="VNC 服务管理" aria-label="VNC 服务管理">${icon("server-cog")}</button>
        <button class="icon-button" onclick="reconnectEmbeddedVnc(${profile.id},'${escAttr(key)}')" title="重新连接" aria-label="重新连接">${icon("refresh-cw")}</button>
        <button class="icon-button" onclick="launchRemoteDesktop(${profile.id},'${escAttr(key)}',this)" title="改用系统客户端" aria-label="改用系统客户端">${icon("external-link")}</button>
        <button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="连接设置" aria-label="连接设置">${icon("settings-2")}</button>
      </div>
    </div>
    <div id="vncViewport" class="vnc-viewport" tabindex="0"><div id="vncConnectionHelp" class="vnc-connection-help" hidden></div></div>
  </div>`;
  if (typeof remoteWorkspaceJumpButtonsHtml === "function") {
    const jumpButtons = remoteWorkspaceJumpButtonsHtml(profile);
    if (jumpButtons) view.querySelector(".vnc-toolbar-actions")?.insertAdjacentHTML("afterbegin", jumpButtons);
  }
  const viewport = view.querySelector("#vncViewport");
  if (!session) {
    session = {key, profile, rfb:null, screen:document.createElement("div"), status:null, statusText:"", statusState:"connecting", connecting:false, connected:false, clipboardAutoSync:!profile.options?.view_only, remoteClipboardAvailable:false, remoteClipboardPending:false, managementNodes};
    session.screen.className = "vnc-screen";
    vncSessions.set(key, session);
  } else if (!session.managementNodes?.length && managementNodes.length) {
    session.managementNodes = managementNodes;
  }
  session.workspace = view.querySelector(".vnc-workspace");
  session.presentation = "viewer";
  session.profile = profile;
  session.vncServerDiagnostics = diagnostics || session.vncServerDiagnostics || null;
  const sourceConnection = currentConnection(Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0));
  const sourcePlatform = String(sourceConnection?.terminal_program_platform || "").toLowerCase();
  const previousRemotePlatform = session.remotePlatform || "";
  session.remotePlatform = diagnostics?.platform || diagnostics?.os_id || (["macos", "darwin"].includes(sourcePlatform) ? "macos" : "") || previousRemotePlatform;
  if (session.remotePlatform !== previousRemotePlatform) {
    session.clipboardTransport = "rfb";
    session.clipboardTransportChecked = false;
    session.clipboardTransportPromise = null;
    session.remoteClipboardBridgeLastSeen = undefined;
  }
  applyVncCursorPolicy(session);
  session.status = view.querySelector("#vncStatus");
  session.clipboardStatus = view.querySelector("#vncClipboardStatus");
  session.clipboardHelperButton = view.querySelector("[data-vnc-clipboard-helper]");
  session.clipboardSyncButton = view.querySelector("[data-vnc-clipboard-sync]");
  session.clipboardReceiveButton = view.querySelector("[data-vnc-clipboard-receive]");
  session.viewport = viewport;
  session.help = viewport.querySelector("#vncConnectionHelp");
  viewport.appendChild(session.screen);
  applyVncDisplayMode(session);
  if (session.helpState) showVncConnectionHelp(session, session.helpState.serviceAvailable, session.helpState.detail, session.helpState.diagnostics);
  vncSessionStatus(session, session.statusText || `正在连接 ${remoteProfileEndpoint(profile)}`, session.statusState || "connecting");
  renderVncClipboardControls(session);
  refreshIcons();
  if (!session.rfb && !session.connecting) connectEmbeddedVnc(profile, key);
}

function syncEmbeddedVncManagementControls(session, view=$("view-remote-desktop")) {
  if (!session || !view) return;
  const launchButton = view.querySelector("#remoteDesktopLaunchButton");
  if (launchButton) {
    setButtonBusy(launchButton, false);
    launchButton.disabled = false;
    launchButton.title = "重新进入仍在运行的内置 VNC 桌面";
    const label = launchButton.querySelector("span");
    if (label) label.textContent = "重新进入";
  }
  const closeButton = view.querySelector("#remoteDesktopCloseButton");
  if (closeButton) {
    closeButton.hidden = false;
    closeButton.disabled = false;
  }
  const status = view.querySelector("#remoteDesktopStatus");
  if (status) {
    const live = Boolean(session.connected || session.connecting);
    status.className = `connection-test-status ${live ? "success" : "warning"}`;
    status.textContent = live
      ? "内置 VNC 桌面仍在运行，可以重新进入或关闭桌面"
      : "内置 VNC 桌面已断开，可以重新进入或关闭桌面";
  }
}

function showVncManagement(profileId, key=`remote-desktop-${profileId}`, refresh=true) {
  const view = $("view-remote-desktop");
  const session = vncSessions.get(key);
  if (!view || !session) return openRemoteDesktop(profileId, false, true);
  if (!session.managementNodes?.length) return openRemoteDesktop(profileId, false, true);
  captureRemoteDesktopRenderScope(profileId, key, view);
  session.presentation = "management";
  view.replaceChildren(...session.managementNodes);
  syncEmbeddedVncManagementControls(session, view);
  const container = view.querySelector("#vncServerState");
  if (refresh && container) void inspectVncServer(profileId, null, container).catch(() => {});
  refreshIcons();
}

async function closeEmbeddedVncDesktop(profileId, key=`remote-desktop-${profileId}`, button=null) {
  const profile = remoteProfileById(profileId);
  if (!profile || profile.protocol !== "vnc") return notify("VNC 连接不存在", "error");
  if (button) setButtonBusy(button, true, "关闭中...");
  try {
    closeRemoteProtocolSession(key);
    setWorkspaceTabConnectionStatus(key, "disconnected");
    notify("内置 VNC 桌面已关闭", "success");
    return await openRemoteDesktop(profileId, false, true);
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

async function connectEmbeddedVnc(profile, key) {
  const session = vncSessions.get(key);
  if (!session || session.connecting) return;
  const connectionRevision = Number(session.connectionRevision || 0) + 1;
  session.connectionRevision = connectionRevision;
  const isCurrentConnection = () => vncSessions.get(key) === session && session.connectionRevision === connectionRevision;
  session.diagnosticToken = Number(session.diagnosticToken || 0) + 1;
  session.connecting = true;
  session.connected = false;
  session.clipboardRemoteOperationId = Number(session.clipboardRemoteOperationId || 0) + 1;
  session.remoteClipboardAvailable = false;
  session.remoteClipboardPending = false;
  session.remoteClipboardText = "";
  session.clipboardLastSeenLocal = undefined;
  session.clipboardLastSentText = undefined;
  session.clipboardTransport = "rfb";
  session.clipboardTransportChecked = false;
  session.clipboardTransportPromise = null;
  session.remoteClipboardBridgeLastSeen = undefined;
  resetVncClipboardBridgeWriteState(session);
  stopVncClipboardPolling(session);
  renderVncClipboardControls(session);
  hideVncConnectionHelp(session);
  vncSessionStatus(session, `正在连接 ${remoteProfileEndpoint(profile)}`, "connecting");
  try {
    const RFB = await noVncRfbClass();
    if (!isCurrentConnection()) return;
    try { session.rfb?.disconnect?.(); } catch {}
    session.screen.replaceChildren();
    let credentials = session.nextCredentials || null;
    session.nextCredentials = null;
    if (!credentials && profile.has_password) {
      const saved = await api(`/api/remote-profiles/${profile.id}/vnc-credential`, {method:"POST", body:"{}"});
      if (!isCurrentConnection()) return;
      if (saved.has_password) credentials = {username:profile.username || "", password:saved.password || ""};
    }
    if (!credentials && profile.username) credentials = {username:profile.username};
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const rfb = new RFB(session.screen, `${protocol}://${location.host}/ws/vnc?id=${profile.id}`, {
      shared:profile.options?.shared !== false,
      credentials:credentials || undefined
    });
    session.rfb = rfb;
    applyVncDisplayMode(session, rfb);
    rfb.viewOnly = Boolean(profile.options?.view_only);
    rfb.qualityLevel = Math.max(0, Math.min(9, Number(profile.options?.quality ?? 8)));
    applyVncCursorPolicy(session);
    rfb.background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#1e1e1e";
    rfb.addEventListener("connect", () => {
      if (!isCurrentConnection() || session.rfb !== rfb) return rfb.disconnect();
      session.connecting = false;
      session.connected = true;
      session.authRetrying = false;
      session.everConnected = true;
      hideVncConnectionHelp(session);
      vncSessionStatus(session, profile.options?.view_only ? "已连接 · 仅查看" : "已连接 · 可控制", "connected");
      if (session.clipboardAutoSync && !profile.options?.view_only) startVncClipboardPolling(session);
      else renderVncClipboardControls(session);
      focusEmbeddedVnc(session);
    });
    rfb.addEventListener("credentialsrequired", async event => {
      if (!isCurrentConnection() || session.rfb !== rfb) return;
      const result = await requestVncCredentials(profile, event.detail?.types || ["password"]);
      if (!result || !isCurrentConnection() || session.rfb !== rfb) return rfb.disconnect();
      if (result.update_saved_password) {
        await saveVncCredential(profile, result.credentials.password).catch(error => notify(error.message, "error"));
        if (!isCurrentConnection() || session.rfb !== rfb) return rfb.disconnect();
      }
      rfb.sendCredentials(result.credentials);
    });
    rfb.addEventListener("securityfailure", event => {
      if (!isCurrentConnection() || session.rfb !== rfb) return;
      void handleVncSecurityFailure(profile, key, rfb, event.detail?.reason || "VNC 认证失败");
    });
    rfb.addEventListener("clipboard", event => {
      if (!isCurrentConnection() || session.rfb !== rfb) return;
      // Some VNC servers expose only the legacy Latin-1 clipboard encoding;
      // noVNC then receives CJK text as question marks.  Once the SSH bridge
      // is available, prefer its UTF-8 system clipboard and do not let a
      // lossy RFB event overwrite the correct value.
      void handleVncClipboardEvent(session, rfb, event.detail?.text ?? "");
    });
    rfb.addEventListener("disconnect", event => {
      if (!isCurrentConnection() || session.rfb !== rfb) return;
      session.rfb = null;
      session.connecting = false;
      session.connected = false;
      session.clipboardRemoteOperationId = Number(session.clipboardRemoteOperationId || 0) + 1;
      resetVncClipboardBridgeWriteState(session);
      stopVncClipboardPolling(session);
      if (session.authRetrying) return;
      if (event.detail?.clean) return vncSessionStatus(session, "VNC 会话已结束");
      void diagnoseEmbeddedVncDisconnect(profile, key);
    });
  } catch (error) {
    if (!isCurrentConnection()) return;
    session.connecting = false;
    session.connected = false;
    session.clipboardRemoteOperationId = Number(session.clipboardRemoteOperationId || 0) + 1;
    resetVncClipboardBridgeWriteState(session);
    stopVncClipboardPolling(session);
    session.rfb = null;
    vncSessionStatus(session, error.message || "内置 VNC 启动失败", "error");
    void diagnoseEmbeddedVncDisconnect(profile, key);
    if (profile.options?.client_mode !== "embedded" && !session.systemFallbackStarted) {
      session.systemFallbackStarted = true;
      const diagnostics = await api("/api/remote-clients/diagnostics").catch(() => null);
      if (!isCurrentConnection()) return;
      if (diagnostics?.vnc?.available) {
        notify("内置 VNC 不可用，正在改用系统客户端", "info");
        await launchRemoteDesktop(profile.id, key).catch(fallbackError => notify(fallbackError.message, "error"));
      }
    }
  }
}

async function saveVncCredential(profile, password) {
  const result = await api(`/api/remote-profiles/${profile.id}/vnc-credential`, {method:"PUT", body:JSON.stringify({password})});
  profile.has_password = Boolean(result.has_password);
  return result;
}

async function handleVncSecurityFailure(profile, key, rfb, reason) {
  const session = vncSessions.get(key);
  if (!session || session.rfb !== rfb || session.authRetrying) return;
  session.authRetrying = true;
  vncSessionStatus(session, reason || "VNC 认证失败", "error");
  const result = await requestVncCredentials(profile, ["password"], {failureReason:reason, updateByDefault:true});
  if (!vncSessions.has(key)) return;
  try { rfb.disconnect(); } catch {}
  if (session.rfb === rfb) session.rfb = null;
  session.connecting = false;
  session.connected = false;
  session.clipboardRemoteOperationId = Number(session.clipboardRemoteOperationId || 0) + 1;
  resetVncClipboardBridgeWriteState(session);
  stopVncClipboardPolling(session);
  if (!result) {
    session.authRetrying = false;
    return vncSessionStatus(session, "VNC 认证失败，已取消重新输入", "error");
  }
  if (result.update_saved_password) {
    await saveVncCredential(profile, result.credentials.password).catch(error => notify(`密码未能保存：${error.message}`, "error"));
  }
  session.nextCredentials = result.credentials;
  session.authRetrying = false;
  connectEmbeddedVnc(profile, key);
}

function requestVncCredentials(profile, types=[], options={}) {
  return new Promise(resolve => {
    const required = new Set(types);
    const allowNoPassword = options.allowNoPassword === true;
    const modal = $("modal");
    modal.hidden = false;
    modal.innerHTML = `<form class="modal-card vnc-credentials-modal"><h2>${esc(options.title || `连接 ${profile.name}`)}</h2>
      ${options.failureReason ? `<div class="connection-test-status error">${esc(options.failureReason || "VNC 密码错误，请重新输入")}</div>` : ""}
      ${required.has("username") ? `<label>用户名</label><input id="vncCredentialUsername" autocomplete="username" value="${escAttr(profile.username || "")}">` : ""}
      ${required.has("target") ? `<label>目标会话</label><input id="vncCredentialTarget" autocomplete="off">` : ""}
      <label>VNC 密码</label><input id="vncCredentialPassword" type="password" autocomplete="current-password" autofocus required>
      ${allowNoPassword ? `<label class="checkline"><input id="vncCredentialNoPassword" type="checkbox">允许无密码访问（仅限可信网络）</label>` : ""}
      <label class="checkline"><input id="vncCredentialSave" type="checkbox" ${options.updateByDefault ? "checked" : ""}>${profile.has_password ? "更新保存密码" : "保存密码"}</label>
      <div class="muted">密码会加密存储；取消勾选时只用于本次 VNC 会话。无密码模式不会保存密码。</div>
      <div class="actions"><button type="button" data-vnc-cancel>取消</button><button class="primary" type="submit">${esc(options.submitLabel || "连接")}</button></div></form>`;
    enhancePasswordInputs(modal);
    const passwordInput = modal.querySelector("#vncCredentialPassword");
    const noPasswordInput = modal.querySelector("#vncCredentialNoPassword");
    const savePasswordInput = modal.querySelector("#vncCredentialSave");
    const syncPasswordMode = () => {
      const noPassword = Boolean(noPasswordInput?.checked);
      if (passwordInput) {
        passwordInput.required = !noPassword;
        passwordInput.disabled = noPassword;
        syncPasswordVisibilityControl(passwordInput);
        if (noPassword) passwordInput.value = "";
      }
      if (savePasswordInput) {
        savePasswordInput.disabled = noPassword;
        if (noPassword) savePasswordInput.checked = false;
      }
    };
    noPasswordInput?.addEventListener("change", syncPasswordMode);
    syncPasswordMode();
    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      modal.onclick = null;
      modal.hidden = true;
      modal.innerHTML = "";
      resolve(value);
    };
    const onKeyDown = event => { if (event.key === "Escape") finish(null); };
    modal.querySelector("form").onsubmit = event => {
      event.preventDefault();
      const password = passwordInput?.value || "";
      const noPassword = Boolean(noPasswordInput?.checked);
      if (!noPassword && !password) {
        notify("请输入 VNC 密码，或明确勾选允许无密码访问", "error");
        passwordInput?.focus();
        return;
      }
      finish({
        credentials:{
          username:modal.querySelector("#vncCredentialUsername")?.value || profile.username || "",
          target:modal.querySelector("#vncCredentialTarget")?.value || "",
          password
        },
        allow_no_password:noPassword,
        update_saved_password:Boolean(!noPassword && savePasswordInput?.checked)
      });
    };
    modal.querySelector("[data-vnc-cancel]").onclick = () => finish(null);
    modal.onclick = null;
    document.addEventListener("keydown", onKeyDown);
  });
}

function reconnectEmbeddedVnc(id, key) {
  const profile = remoteProfileById(id);
  const session = vncSessions.get(key);
  if (!profile || !session) return openRemoteDesktop(id, false);
  try { session.rfb?.disconnect?.(); } catch {}
  session.rfb = null;
  session.connecting = false;
  session.connected = false;
  session.clipboardRemoteOperationId = Number(session.clipboardRemoteOperationId || 0) + 1;
  session.clipboardLastSeenLocal = undefined;
  session.clipboardLastSentText = undefined;
  session.clipboardTransport = "rfb";
  session.clipboardTransportChecked = false;
  session.clipboardTransportPromise = null;
  session.remoteClipboardBridgeLastSeen = undefined;
  resetVncClipboardBridgeWriteState(session);
  stopVncClipboardPolling(session);
  connectEmbeddedVnc(profile, key);
}

function sendVncCtrlAltDelete(key) {
  const rfb = vncSessions.get(key)?.rfb;
  if (!rfb) return notify("VNC 尚未连接", "info");
  rfb.sendCtrlAltDel();
}

async function pasteClipboardToVnc(key) {
  const session = vncSessions.get(key);
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) return notify(unavailable, "info");
  let text;
  try {
    text = await readVncLocalClipboard();
  } catch (error) {
    text = await requestVncClipboardText(session, `${error.message || "浏览器未允许读取剪贴板"}，请在下方手动粘贴。`);
    if (text === null) return setVncClipboardStatus(session, "已取消发送", "", 1600);
  }
  await sendVncClipboardText(session, text, true);
  focusEmbeddedVnc(session);
}

async function copyVncClipboardFromRemote(key) {
  const session = vncSessions.get(key);
  if (!session) return notify("VNC 尚未连接", "info");
  if (vncClipboardBridgeCandidate(session)) {
    try { await pollVncRemoteClipboardBridge(session, true); }
    catch (error) { return notify(error.message || "读取远端系统剪贴板失败", "error"); }
  }
  if (!session.remoteClipboardAvailable) return notify("远端尚未发送剪贴板内容", "info");
  try {
    await writeVncLocalClipboard(session.remoteClipboardText, true);
    session.clipboardLastSeenLocal = session.remoteClipboardText;
    session.remoteClipboardPending = false;
    session.clipboardPermissionBlocked = false;
    setVncClipboardStatus(session, "已读取远端剪贴板", "success", 2200);
    notify("远端剪贴板已复制到本机", "success");
  } catch (error) {
    setVncClipboardStatus(session, "读取远端剪贴板失败", "error");
    notify(error.message || "写入本机剪贴板失败", "error");
  } finally {
    focusEmbeddedVnc(session);
  }
}

async function toggleVncClipboardSync(key) {
  const session = vncSessions.get(key);
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) return notify(unavailable, "info");
  if (session.clipboardAutoSync) {
    session.clipboardAutoSync = false;
    stopVncClipboardPolling(session);
    setVncClipboardStatus(session);
    notify("已关闭 VNC 剪贴板自动同步", "info");
    focusEmbeddedVnc(session);
    return;
  }
  try {
    const text = await readVncLocalClipboard();
    session.clipboardPermissionBlocked = false;
    session.clipboardPermissionNoticeShown = false;
    session.clipboardAutoSync = true;
    if (!session.remoteClipboardAvailable || text !== session.remoteClipboardText) await sendVncClipboardText(session, text, false);
    else session.clipboardLastSeenLocal = text;
    startVncClipboardPolling(session);
    setVncClipboardStatus(session, "剪贴板：自动同步", "active");
    notify("已开启 VNC 剪贴板自动同步；仅在 Terma 位于前台时读取本机剪贴板", "success");
  } catch (error) {
    session.clipboardAutoSync = false;
    session.clipboardPermissionBlocked = true;
    stopVncClipboardPolling(session);
    setVncClipboardStatus(session, "剪贴板权限受限", "error");
    notify(`${error.message || "无法读取本机剪贴板"}；仍可使用两个手动剪贴板按钮`, "info");
  } finally {
    focusEmbeddedVnc(session);
  }
}

function syncVncFullscreenPresentation() {
  const session = vncSessions.get(vncFullscreenSessionKey);
  const active = document.fullscreenElement === document.documentElement && Boolean(session?.viewport?.isConnected);
  for (const item of vncSessions.values()) item.viewport?.classList.toggle("vnc-fullscreen-active", active && item === session);
  document.documentElement.classList.toggle("vnc-fullscreen-document", active);
  if (!active) {
    if (!document.fullscreenElement || document.fullscreenElement === document.documentElement) vncFullscreenSessionKey = "";
    return;
  }
  requestAnimationFrame(() => {
    try { applyVncDisplayMode(session); } catch {}
    focusEmbeddedVnc(session);
  });
}

if (typeof document !== "undefined") document.addEventListener("fullscreenchange", syncVncFullscreenPresentation);

async function toggleVncFullscreen(key) {
  const session = vncSessions.get(key);
  if (!session?.viewport) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
    return;
  }
  if (!document.documentElement.requestFullscreen) return notify("当前环境不支持全屏显示", "info");
  // noVNC may render its software cursor as a body-level overlay. Keeping the
  // whole document in the fullscreen tree prevents that cursor from vanishing.
  vncFullscreenSessionKey = key;
  session.viewport.classList.add("vnc-fullscreen-active");
  try {
    await document.documentElement.requestFullscreen();
    syncVncFullscreenPresentation();
  } catch (error) {
    session.viewport.classList.remove("vnc-fullscreen-active");
    vncFullscreenSessionKey = "";
    notify(error.message || "无法进入全屏", "error");
  }
}

async function launchRemoteDesktop(id, key="", button=null) {
  if (button) setButtonBusy(button, true, "启动中...");
  try {
    const profile = remoteProfileById(id);
    if (profile?.protocol === "rdp") {
      let serverState = null;
      try {
        serverState = await inspectRdpServer(id);
      } catch (error) {
        // Standalone RDP profiles may not have an SSH management connection.
        // The native RDP client can still connect directly in that case.
        if (!/没有找到同主机的 SSH 连接|明确选择用于管理的连接/.test(String(error?.message || ""))) throw error;
      }
      if (serverState?.platform_supported !== false) {
        if (!serverState?.has_desktop) throw new Error("远端未检测到可用桌面会话，请先前往 Linux 桌面管理安装或修复桌面");
        if (!serverState?.xrdp_installed) throw new Error("远端未安装 xrdp，请先安装 RDP 服务");
        if (!serverState?.xrdp_active) throw new Error("远端 xrdp 服务未运行，请先启动或修复 RDP 服务");
        if (!serverState?.xrdp_listening) throw new Error("远端 TCP 3389 未监听，请检查 xrdp 服务与端口配置");
      }
    }
    if (profile?.protocol === "xdmcp") {
      let serverState = await inspectXdmcpServer(id);
      if (serverState.session_conflict) {
        if (!serverState.can_cleanup_remote_sessions) {
          throw new Error(serverState.local_graphical_sessions?.length
            ? "同一账号正在 Linux 本地桌面运行 Plasma。请先注销本地桌面，或使用另一个 Linux 账号登录 XDMCP。"
            : "Plasma 已绑定到其他图形会话，Terma 无法安全自动结束；请先注销旧会话。");
        }
        const cleanup = await configureXdmcpHost(id, "cleanup-sessions");
        if (!cleanup) return null;
        serverState = cleanup.after;
        if (serverState.session_conflict) throw new Error("旧的 Plasma 图形会话仍未完全退出，请稍后重新探测再启动");
      }
    }
    const result = await api(`/api/remote-profiles/${id}/launch`, {method:"POST", body:"{}"});
    const status = $("remoteDesktopStatus");
    if (status) {
      status.className = "connection-test-status success";
      status.textContent = result.protocol === "xdmcp" ? `已在 ${result.client || "X Server"} 打开` : `已交给 ${result.client || "系统客户端"} 打开，凭据由客户端提示`;
    }
    notify(result.protocol === "xdmcp" ? "已启动 XDMCP 图形桌面" : "已打开系统远程桌面客户端", "success");
  } catch (error) {
    const status = $("remoteDesktopStatus");
    if (status) {
      status.className = "connection-test-status error";
      status.textContent = error.message || "远程桌面客户端启动失败";
    }
    notify(error.message || "远程桌面客户端启动失败", "error");
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

async function installRemoteDesktopClient(profileId, protocol, button=null) {
  if (button) setButtonBusy(button, true, "处理中...");
  try {
    const result = protocol === "xdmcp"
      ? await api("/api/xserver/install", {method:"POST", body:"{}"})
      : await api("/api/remote-clients/install", {method:"POST", body:JSON.stringify({protocol})});
    if (result.opened) {
      notify(`已打开 ${result.target || "客户端下载页面"}，安装完成后返回 Terma 重新检测`, "info");
      return result;
    }
    if (protocol === "xdmcp") await api("/api/xserver", {method:"POST", body:"{}"});
    notify(`${protocol.toUpperCase()} 客户端已安装`, "success");
    await openRemoteDesktop(profileId, false);
    return result;
  } catch (error) {
    notify(error.message || "客户端安装失败", "error");
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function ftpStateForKey(key, profile, path="") {
  if (!ftpProfileStates.has(key)) ftpProfileStates.set(key, {key, profileId:profile.id, path:path || profile.options?.base_path || "/", entries:[], loading:false});
  return ftpProfileStates.get(key);
}

function openFtpProfile(id, path="", updateTab=true, existingKey="") {
  const profile = remoteProfileById(id);
  if (!profile || profile.protocol !== "ftp") return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const key = existingKey || `ftp-${profile.id}`;
  const state = ftpStateForKey(key, profile, path);
  if (path) state.path = path;
  setWorkspace(profile.name, remoteProfileEndpoint(profile), "ftp", key, updateTab, true, {kind:"ftp", id:profile.id, path:state.path, protocol:"ftp"});
  const view = $("view-ftp");
  view.dataset.ftpTabKey = key;
  view.innerHTML = `<div class="ftp-toolbar"><button class="terminal-mobile-back" onclick="backToExplorer()">${icon("arrow-left")}<span>返回</span></button><button class="icon-button" onclick="ftpGoParent('${escAttr(key)}')" title="上一级" aria-label="上一级">${icon("corner-left-up")}</button><div class="ftp-path-field">${icon("folder-open")}<input id="ftpPathInput" value="${escAttr(state.path)}" onkeydown="if(event.key==='Enter')loadFtpDirectory('${escAttr(key)}',this.value)"></div><button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}',null,true)" title="刷新" aria-label="刷新">${icon("refresh-cw")}</button><button class="icon-button" onclick="createFtpDirectory('${escAttr(key)}')" title="新建文件夹" aria-label="新建文件夹">${icon("folder-plus")}</button><label class="icon-button ftp-upload-button" title="上传文件" aria-label="上传文件">${icon("upload")}<input id="ftpUploadInput" type="file" multiple onchange="uploadFtpFiles('${escAttr(key)}',this.files)"></label></div><div id="ftpList" class="ftp-list"></div>`;
  refreshIcons();
  loadFtpDirectory(key, state.path).catch(error => notify(error.message, "error"));
}

async function loadFtpDirectory(key, pathValue=null, refresh=false) {
  const state = ftpProfileStates.get(key);
  if (!state || state.loading) return;
  state.loading = true;
  const list = $("ftpList");
  if (list) list.innerHTML = stateView("loading", "正在读取 FTP 目录", "正在与服务器交换目录列表。", "");
  try {
    const target = pathValue === null ? state.path : String(pathValue || "/");
    const result = await api(`/api/remote-profiles/${state.profileId}/ftp?path=${encodeURIComponent(target)}${refresh ? "&refresh=1" : ""}`);
    state.path = result.path || target;
    state.entries = result.entries || [];
    const input = $("ftpPathInput");
    if (input) input.value = state.path;
    const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
    if (tab) tab.path = state.path;
    renderFtpEntries(key);
    saveTabsState();
  } finally {
    state.loading = false;
  }
}

function renderFtpEntries(key) {
  const state = ftpProfileStates.get(key);
  const list = $("ftpList");
  if (!state || !list) return;
  if (!state.entries.length) return void (list.innerHTML = stateView("empty", "目录为空", "可以上传文件或新建文件夹。", `<button class="primary" onclick="createFtpDirectory('${escAttr(key)}')">新建文件夹</button>`));
  list.innerHTML = `<div class="ftp-table" role="table"><div class="ftp-row ftp-head" role="row"><span>名称</span><span>大小</span><span>修改时间</span><span>操作</span></div>${state.entries.map(entry => `<div class="ftp-row" role="row" ondblclick="${entry.type === "directory" ? `loadFtpDirectory('${escAttr(key)}','${escAttr(`${state.path.replace(/\/$/, "")}/${entry.name}`)}')` : `downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')`}"><span class="ftp-name">${icon(entry.type === "directory" ? "folder" : entry.type === "link" ? "file-symlink" : "file")}<span>${esc(entry.name)}</span></span><span>${entry.type === "directory" ? "—" : formatBytes(entry.size)}</span><span>${entry.modified_at ? esc(new Date(entry.modified_at).toLocaleString()) : "—"}</span><span class="ftp-row-actions">${entry.type === "directory" ? `<button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}','${escAttr(`${state.path.replace(/\/$/, "")}/${entry.name}`)}')" title="打开" aria-label="打开">${icon("folder-open")}</button>` : `<button class="icon-button" onclick="downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="下载" aria-label="下载">${icon("download")}</button>`}<button class="icon-button" onclick="renameFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="重命名" aria-label="重命名">${icon("pencil")}</button><button class="icon-button danger" onclick="deleteFtpEntry('${escAttr(key)}','${escAttr(entry.name)}','${entry.type}')" title="删除" aria-label="删除">${icon("trash-2")}</button></span></div>`).join("")}</div>`;
  refreshIcons();
}

function ftpGoParent(key) {
  const state = ftpProfileStates.get(key);
  if (!state || state.path === "/") return;
  const parts = state.path.split("/").filter(Boolean);
  parts.pop();
  loadFtpDirectory(key, `/${parts.join("/")}` || "/");
}

async function createFtpDirectory(key) {
  const state = ftpProfileStates.get(key);
  const name = await inputModal("新建 FTP 文件夹", "文件夹名称", "");
  if (!state || !name) return;
  await api(`/api/remote-profiles/${state.profileId}/ftp/mkdir`, {method:"POST", body:JSON.stringify({path:state.path,name})});
  await loadFtpDirectory(key, null, true);
}

async function renameFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  const newName = await inputModal("重命名 FTP 项目", "新名称", name);
  if (!state || !newName || newName === name) return;
  await api(`/api/remote-profiles/${state.profileId}/ftp/rename`, {method:"POST", body:JSON.stringify({path:state.path,name,new_name:newName})});
  await loadFtpDirectory(key, null, true);
}

async function deleteFtpEntry(key, name, type) {
  const state = ftpProfileStates.get(key);
  if (!state || !await confirmModal(`确定删除 ${name}${type === "directory" ? " 及其内容" : ""}？FTP 不支持 Terma 回收站。`, "删除 FTP 项目", "删除", "取消", true)) return;
  await api(`/api/remote-profiles/${state.profileId}/ftp/delete`, {method:"POST", body:JSON.stringify({path:state.path,name,type})});
  await loadFtpDirectory(key, null, true);
}

async function uploadFtpFiles(key, files) {
  const state = ftpProfileStates.get(key);
  if (!state || !files?.length) return;
  for (const file of files) {
    const body = new FormData();
    body.append("path", state.path);
    body.append("file", file, file.name);
    const response = await fetch(`/api/remote-profiles/${state.profileId}/ftp/upload`, {method:"POST", body});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `上传 ${file.name} 失败`);
  }
  $("ftpUploadInput").value = "";
  await loadFtpDirectory(key, null, true);
  notify(`已上传 ${files.length} 个文件`, "success");
}

function downloadFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  if (!state) return;
  const link = document.createElement("a");
  link.href = `/api/remote-profiles/${state.profileId}/ftp/download?path=${encodeURIComponent(state.path)}&name=${encodeURIComponent(name)}`;
  link.download = name;
  link.click();
}

function nextRemoteTerminalIndex(id) {
  let next = Number(remoteTerminalCounts.get(Number(id)) || 0) + 1;
  while (tabs.some(tab => tab.key === `remote-terminal-${id}-${next}`)) next += 1;
  remoteTerminalCounts.set(Number(id), next);
  return next;
}

function openRemoteTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const profile = remoteProfileById(id);
  if (!profile || !["telnet","serial"].includes(profile.protocol)) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const next = existingKey ? 0 : nextRemoteTerminalIndex(id);
  const key = existingKey || `remote-terminal-${id}-${next}`;
  const title = existingTitle || `${profile.name}${next > 1 ? ` #${next}` : ""}`;
  const meta = REMOTE_PROTOCOL_META[profile.protocol];
  const view = $("view-remote-terminal");
  view.dataset.remoteTerminalKey = key;
  view.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><button class="terminal-mobile-back" onclick="backToExplorer()">${icon("arrow-left")}<span>返回</span></button><span class="terminal-connection-dot"></span><div id="remoteTerminalStatus" class="terminal-status">正在连接 ${esc(remoteProfileEndpoint(profile))}</div></div><div class="actions terminal-actions"><button class="icon-button" onclick="reconnectRemoteTerminal(${profile.id},'${escAttr(key)}')" title="重新连接" aria-label="重新连接">${icon("refresh-cw")}<span>重连</span></button><button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="连接设置" aria-label="连接设置">${icon("settings-2")}</button></div></div><div id="remoteTerminalMount" class="terminal-box"></div><div class="terminal-mobile-composer"><input id="remoteTerminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入内容" onkeydown="if(event.key==='Enter')sendRemoteTerminalMobileInput('${escAttr(key)}')"><button class="primary icon-button" onclick="sendRemoteTerminalMobileInput('${escAttr(key)}')" title="发送" aria-label="发送">${icon("send")}</button></div>`;
  setWorkspace(title, `${meta.label} · ${remoteProfileEndpoint(profile)}`, "remote-terminal", key, updateTab, true, {kind:"remote-terminal", id:profile.id, protocol:profile.protocol});
  attachRemoteTerminal(profile, key).catch(error => {
    const mount = document.querySelector(`[data-remote-terminal-key="${CSS.escape(key)}"] #remoteTerminalMount`) || $("remoteTerminalMount");
    if (mount) mount.innerHTML = stateView("error", "终端组件加载失败", error.message, `<button onclick="reconnectRemoteTerminal(${profile.id},'${escAttr(key)}')">重新连接</button>`);
  });
}

async function attachRemoteTerminal(profile, key) {
  await ensureTerminalLibs();
  const view = $("view-remote-terminal");
  const mount = $("remoteTerminalMount");
  if (!view || !mount) return;
  let session = remoteTerminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({cursorBlink:true,convertEol:true,fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:Number(localStorage.getItem("terminalFontSize") || 13),theme:typeof terminalThemeForSettings === "function" ? terminalThemeForSettings() : undefined});
    const fit = new FitAddonClass();
    term.loadAddon(fit);
    session = {key,profile,term,fit,socket:null,connected:false,logId:createTerminalLogId(),resizeObserver:null};
    remoteTerminalSessions.set(key, session);
    term.onData(data => {
      if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(data);
    });
  }
  session.profile = profile;
  session.mount = mount;
  view.dataset.remoteTerminalKey = key;
  if (session.term.element) mount.appendChild(session.term.element);
  else session.term.open(mount);
  session.resizeObserver?.disconnect?.();
  session.resizeObserver = new ResizeObserver(() => {
    try { session.fit.fit(); } catch {}
    if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({type:"resize",cols:session.term.cols,rows:session.term.rows}));
  });
  session.resizeObserver.observe(mount);
  setTimeout(() => {
    try { session.fit.fit(); session.term.focus(); } catch {}
    if (!session.socket || session.socket.readyState >= WebSocket.CLOSING) connectRemoteTerminal(profile, key);
  }, 0);
}

function connectRemoteTerminal(profile, key) {
  const session = remoteTerminalSessions.get(key);
  if (!session) return;
  try { session.socket?.close(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws/remote-terminal?id=${profile.id}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(profile.name)}&log_id=${encodeURIComponent(session.logId)}`);
  socket.binaryType = "arraybuffer";
  session.socket = socket;
  session.connected = false;
  const status = $("remoteTerminalStatus");
  if (status) status.textContent = `正在连接 ${remoteProfileEndpoint(profile)}`;
  setWorkspaceTabConnectionStatus(key, "connecting");
  socket.onopen = () => {
    if (session.socket !== socket) return;
    session.connected = true;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = `已连接 ${remoteProfileEndpoint(profile)}`;
    setWorkspaceTabConnectionStatus(key, "connected");
    socket.send(JSON.stringify({type:"resize",cols:session.term.cols,rows:session.term.rows}));
    session.term.focus();
  };
  socket.onmessage = async event => {
    if (session.socket !== socket) return;
    if (event.data instanceof Blob) session.term.write(new Uint8Array(await event.data.arrayBuffer()));
    else if (event.data instanceof ArrayBuffer) session.term.write(new Uint8Array(event.data));
    else session.term.write(String(event.data));
  };
  socket.onerror = () => {
    if (session.socket !== socket) return;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = "连接错误";
  };
  socket.onclose = () => {
    if (session.socket !== socket) return;
    session.connected = false;
    session.socket = null;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = "已断开，点击重连";
    setWorkspaceTabConnectionStatus(key, "disconnected");
  };
}

function reconnectRemoteTerminal(id, key) {
  const profile = remoteProfileById(id);
  const session = remoteTerminalSessions.get(key);
  if (!profile || !session) return openRemoteTerminal(id, false, key);
  session.term.write("\r\n正在重新连接...\r\n");
  connectRemoteTerminal(profile, key);
}

function sendRemoteTerminalMobileInput(key) {
  const input = $("remoteTerminalMobileInput");
  const session = remoteTerminalSessions.get(key);
  if (!input || !session?.socket || session.socket.readyState !== WebSocket.OPEN) return;
  session.socket.send(`${input.value}\r`);
  input.value = "";
}

function closeRemoteProtocolSession(key) {
  const vnc = vncSessions.get(key);
  if (vnc) {
    if (vncFullscreenSessionKey === key) {
      vncFullscreenSessionKey = "";
      vnc.viewport?.classList.remove("vnc-fullscreen-active");
      document.documentElement.classList.remove("vnc-fullscreen-document");
      if (document.fullscreenElement === document.documentElement) void document.exitFullscreen?.().catch(() => {});
    }
    vnc.connectionRevision = Number(vnc.connectionRevision || 0) + 1;
    stopVncClipboardPolling(vnc);
    resetVncClipboardBridgeWriteState(vnc);
    if (vnc.clipboardStatusTimer) clearTimeout(vnc.clipboardStatusTimer);
    try { vnc.rfb?.disconnect?.(); } catch {}
    vncSessions.delete(key);
  }
  const session = remoteTerminalSessions.get(key);
  if (!session) return;
  try { session.socket?.close(); } catch {}
  try { session.resizeObserver?.disconnect(); } catch {}
  try { session.term?.dispose(); } catch {}
  remoteTerminalSessions.delete(key);
}

function showX11LaunchMenu(event, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  showActionMenu(event, x11LaunchActions(connectionId));
}

function x11LaunchActions(connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return [];
  return [
    {label:"启动 X11 图形应用…", icon:"panels-top-left", run:()=>openX11AppLauncher(connectionId)},
    {separator:true},
    {label:"临时启动 X11（受限）", icon:"app-window", run:()=>openX11Terminal(connectionId,"untrusted")},
    {label:"临时启动可信 X11", icon:"badge-check", run:()=>openX11Terminal(connectionId,"trusted")},
    {separator:true},
    {label:"X Server 管理", icon:"app-window", run:()=>openXServerManager(connectionId)},
    {separator:true},
    {label:"默认使用受限 X11（-X）", icon:"shield-check", run:()=>saveConnectionX11Mode(connectionId,"untrusted")},
    {label:"默认使用可信 X11（-Y）", icon:"badge-check", run:()=>saveConnectionX11Mode(connectionId,"trusted")},
    ...(connection.x11_mode !== "off" ? [{label:"关闭默认 X11 转发", icon:"x", run:()=>saveConnectionX11Mode(connectionId,"off")}] : [])
  ];
}

let x11AppModalKeyHandler = null;
let x11AppDiscoverySerial = 0;

function closeX11AppLauncher() {
  x11AppDiscoverySerial += 1;
  if (x11AppModalKeyHandler) document.removeEventListener("keydown", x11AppModalKeyHandler);
  x11AppModalKeyHandler = null;
  const modal = $("modal");
  modal.onclick = null;
  modal.hidden = true;
  modal.innerHTML = "";
}

function applyX11AppPreset() {
  const modal = $("modal");
  const command = $("x11AppCommand");
  const args = $("x11AppArgs");
  const selected = modal?._x11Applications?.get?.($("x11AppPreset")?.value);
  if (!command || !args) return;
  if (!selected) {
    if (command.dataset.detected === "1") command.value = "";
    command.dataset.detected = "0";
    args.value = "";
    command.focus();
    return;
  }
  command.value = selected.path || selected.command;
  command.dataset.detected = "1";
  args.value = selected.args || "";
  if (selected.mode === "trusted") $("x11AppMode").value = "trusted";
}

function x11ApplicationOptions(applications) {
  const groups = new Map();
  for (const item of applications) {
    const label = item.category_label || "应用";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups.entries()].map(([label, items]) => `<optgroup label="${escAttr(label)}">${items.map(item => `<option value="${escAttr(item.id)}">${esc(item.label)}</option>`).join("")}</optgroup>`).join("")
    + '<option value="custom">自定义程序…</option>';
}

async function detectX11Applications(connectionId) {
  const modal = $("modal");
  const select = $("x11AppPreset");
  const status = $("x11AppDetection");
  if (!select || !status) return;
  const serial = ++x11AppDiscoverySerial;
  modal._x11Applications = new Map();
  select.disabled = true;
  select.innerHTML = '<option value="">正在探测…</option>';
  status.className = "connection-test-status busy";
  status.textContent = "正在通过 SSH 识别远端已安装的 X11 图形程序…";
  try {
    const result = await api(`/api/connections/${connectionId}/x11-applications`, {method:"POST", body:"{}"});
    if (serial !== x11AppDiscoverySerial || modal.hidden || !$("x11AppPreset")) return;
    const discovery = result.discovery || {};
    const applications = Array.isArray(discovery.applications) ? discovery.applications : [];
    modal._x11Applications = new Map(applications.map(item => [String(item.id), item]));
    select.innerHTML = x11ApplicationOptions(applications);
    select.disabled = false;
    select.value = applications[0]?.id || "custom";
    applyX11AppPreset();
    const warning = Array.isArray(discovery.warnings) ? discovery.warnings.find(Boolean) : "";
    status.className = `connection-test-status ${applications.length ? "success" : "warning"}`;
    status.textContent = applications.length
      ? `已自动识别 ${applications.length} 个图形程序${warning ? `；${warning}` : "，请选择后启动"}`
      : `远端没有识别到常用 X11 图形程序${warning ? `；${warning}` : "，可以填写自定义程序"}`;
    renderX11InstallAction(connectionId, discovery);
  } catch (error) {
    if (serial !== x11AppDiscoverySerial || modal.hidden || !$("x11AppPreset")) return;
    select.innerHTML = '<option value="custom">自定义程序…</option>';
    select.disabled = false;
    select.value = "custom";
    status.className = "connection-test-status error";
    status.textContent = `自动识别失败：${error.message || "无法连接远端"}`;
    renderX11InstallAction(connectionId, null);
  } finally {
    refreshIcons();
  }
}

function renderX11InstallAction(connectionId, discovery) {
  const host = $("x11AppInstallAction");
  if (!host) return;
  const plan = discovery?.install_plan;
  const shouldOffer = !discovery || !discovery.applications?.length || !discovery.xauth_available;
  if (!shouldOffer) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const macos = discovery?.platform === "macos";
  const label = macos && !discovery?.xquartz_installed
    ? "安装远端 XQuartz"
    : plan?.supported ? "安装/配置常用 X11 程序" : "查看 X11 安装说明";
  host.innerHTML = `<button type="button" class="x11-install-link" onclick="openX11InstallGuide(${Number(connectionId)})">${icon(plan?.supported ? "package-plus" : "book-open-check")}<span>${label}</span></button>`;
  refreshIcons();
}

function closeX11InstallGuide() {
  const modal = $("modal");
  modal._x11ConnectionId = null;
  closeRemoteInstallDialog();
}

function x11InstallPlanCommand(plan, mode="online") {
  return remoteInstallPlanMode(plan, mode).command || (mode === "online" ? String(plan?.command || "").trim() : "");
}

async function openX11InstallGuide(connectionId) {
  const modal = $("modal");
  try {
    const result = await api(`/api/connections/${Number(connectionId)}/x11-applications/install-plan`, {method:"POST", body:"{}"});
    const discovery = result.discovery || {};
    const plan = result.install_plan || discovery.install_plan || {};
    const command = x11InstallPlanCommand(plan, "online");
    const optional = Array.isArray(plan.optional_commands) ? plan.optional_commands : [];
    const macos = discovery.platform === "macos";
    const installed = macos ? Boolean(discovery.xquartz_installed && discovery.xauth_available) : Boolean(discovery.xauth_available);
    const title = macos ? "安装远端 XQuartz" : "安装/配置 X11 图形程序";
    const steps = Array.isArray(plan.instructions) ? plan.instructions : [];
    const actionKey = x11ComponentsActionKey(connectionId);
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="x11InstallGuideTitle">
      <div class="modal-title-row"><div><h2 id="x11InstallGuideTitle">${title}</h2><span class="muted">${esc(discovery.platform || "远端主机")} · ${esc(plan.package_manager || "未识别包管理器")}</span></div><button class="icon-button" type="button" onclick="closeX11InstallGuide()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <div class="connection-test-status ${plan.supported ? "warning" : "error"}">${esc(plan.supported ? (macos ? "远端 macOS 未安装完整的 XQuartz 组件，请选择安装方式。" : "远端没有完整识别到 xauth 或常用 X11 程序，请选择安装方式。") : (macos && discovery.xquartz_installed ? "远端 XQuartz 已安装；请重新检测 SSH X11 转发配置和图形程序。" : "当前远端没有识别到可自动执行的包管理器，请打开手动安装说明。"))}</div>
      ${remoteInstallModesMarkup(plan, mode => `installRemoteX11Components(${Number(connectionId)},this,${plan.requires_password ? "true" : "false"},'${mode}')`, "revealRemoteInstallManual(this)", actionKey)}
      ${remoteInstallManualMarkup(plan, {steps, commands:optional, note:macos ? "XQuartz 安装完成后通常需要退出并重新登录 macOS，再重新建立 SSH X11 会话。" : "如果服务器和本机都不能联网，请在另一台同发行版、同架构设备上下载 xauth、x11-apps、xterm 及完整依赖后上传安装。"})}
      ${optional.length ? `<details class="x11-install-optional"><summary>可选：安装 Firefox 等大型程序</summary><div>${optional.map(item => `<pre class="x11-install-command">${esc(item)}</pre>`).join("")}</div></details>` : ""}
      <div id="x11InstallTaskState"></div>
      <div class="actions"><button type="button" onclick="closeX11InstallGuide()">关闭</button>${installed && !macos ? `<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="uninstallRemoteX11Components(${Number(connectionId)},this)">${icon("package-minus")}<span>卸载 X11 组件</span></button>` : ""}${command ? `<button type="button" onclick="openX11InstallTerminal(${Number(connectionId)},'',${macos ? "true" : "false"})">${icon("square-terminal")}<span>在终端执行推荐命令</span></button>` : `<button type="button" onclick="openX11InstallManualTerminal(${Number(connectionId)})">${icon("square-terminal")}<span>打开安装终端</span></button>`}</div>
    </div>`;
    modal._x11InstallCommand = command;
    modal._x11ConnectionId = Number(connectionId);
    setRemoteInstallDialogCommands(plan, optional);
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || "X11 安装说明读取失败", "error");
  }
}

async function installRemoteX11Components(connectionId, button=null, needsAuthorization=true, mode="online") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 连接不存在", "error");
  const actionKey = x11ComponentsActionKey(connectionId);
  if (!beginUiAction(actionKey, button, "安装中...")) {
    notify("X11 组件任务正在执行，请等待完成", "info");
    return null;
  }
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline" ? "本机下载后离线" : normalizedMode === "offline" ? "使用远端缓存" : "在线";
  const message = normalizedMode === "local-offline"
    ? "Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载匹配的软件包及依赖，通过 SFTP 上传后安装 X11 组件。是否继续？"
    : normalizedMode === "offline"
      ? "将只使用远端包管理器已经缓存的软件包安装 X11 组件，不会访问软件源。缓存不完整时安装会失败，是否继续？"
      : "将通过远端软件源在线安装 X11 组件。是否继续？";
  try {
    if (!await confirmModal(message, `${modeLabel}安装 X11 组件`, "安装", "取消", true)) return null;
    const auth = needsAuthorization ? await requestRemoteAdminAuthorization(connectionId, `${modeLabel}安装远端 X11 组件`) : null;
    if (needsAuthorization && !auth) return null;
    if (button && document.contains(button)) setButtonBusy(button, true, "安装中...");
    const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
    const result = await api(`/api/connections/${Number(connectionId)}/x11-applications/install`, {method:"POST", body:JSON.stringify({action, ...(auth ? {admin_auth:auth} : {})})});
    if (result.task) {
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? $("x11InstallTaskState") : null,
        title:`${modeLabel}安装 X11 组件`,
        onDone:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? openX11InstallGuide(connectionId) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, `${modeLabel}安装 X11 组件`, "X11 组件安装已加入任务中心");
      await taskCompletion;
      if (!requestAccepted) return null;
    } else {
      closeX11InstallGuide();
      notify("远端 X11 组件安装完成，请重新识别", "success");
    }
  } catch (error) {
    notify(error.message || `${modeLabel}安装远端 X11 组件失败`, "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function uninstallRemoteX11Components(connectionId, button=null) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 连接不存在", "error");
  const actionKey = x11ComponentsActionKey(connectionId);
  if (!beginUiAction(actionKey, button, "卸载中...")) {
    notify("X11 组件任务正在执行，请等待完成", "info");
    return null;
  }
  try {
    if (!await confirmModal("将卸载远端 xauth、常用 X11 工具和终端组件。正在使用这些组件的 SSH X11 会话可能中断；不会卸载 Linux 桌面环境。是否继续？", "卸载远端 X11 组件", "卸载", "取消", true)) return null;
    const auth = await requestRemoteAdminAuthorization(connectionId, "卸载远端 X11 组件");
    if (!auth) return null;
    if (button && document.contains(button)) setButtonBusy(button, true, "卸载中...");
    const result = await api(`/api/connections/${Number(connectionId)}/x11-applications/install`, {method:"POST", body:JSON.stringify({action:"uninstall", admin_auth:auth})});
    if (result.task) {
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? $("x11InstallTaskState") : null,
        title:"卸载远端 X11 组件",
        onDone:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? openX11InstallGuide(connectionId) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, "卸载远端 X11 组件", "X11 组件卸载已加入任务中心");
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    closeX11InstallGuide();
    notify("远端 X11 组件卸载完成", "success");
    return result;
  } catch (error) {
    notify(error.message || "卸载远端 X11 组件失败", "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function copyX11InstallCommand(button) {
  const command = String($("modal")?._x11InstallCommand || "").trim();
  if (!command) return notify("当前没有可复制的安装命令", "info");
  try {
    await copyText(command);
    notify("安装命令已复制", "success");
  } catch (error) {
    notify(error.message || "复制命令失败", "error");
  }
}

function openX11InstallTerminal(connectionId, commandOverride="", remoteXQuartz=false) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 连接不存在", "error");
  const command = String(commandOverride || $("modal")?._x11InstallCommand || "").trim();
  if (!command) return openX11InstallManualTerminal(connectionId);
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  const startupCommand = `${command}; printf '\\n\\nTerma 安装命令已结束，请按回车返回 Shell。\\n'; exec "${'${SHELL:-/bin/sh}'}"`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:remoteXQuartz ? "远端 XQuartz 安装" : "X11 组件安装",
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify(startupCommand)}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeX11InstallGuide();
  openTerminal(connection.id, true, key, `${connection.name} · ${remoteXQuartz ? "XQuartz 安装" : "X11 安装"}`);
}

async function openX11InstallManualTerminal(connectionId) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 连接不存在", "error");
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:"X11 安装说明",
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify("printf '%s\\n' '请根据安装说明输入适合当前系统的 X11 安装命令。'; exec \"${'${SHELL:-/bin/sh}'}\"")}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeX11InstallGuide();
  openTerminal(connection.id, true, key, `${connection.name} · X11 安装说明`);
}

function openX11AppLauncher(connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const modal = $("modal");
  const initialMode = connection.x11_mode === "trusted" ? "trusted" : "untrusted";
  modal.innerHTML = `<form class="modal-card x11-app-launcher" role="dialog" aria-modal="true" aria-labelledby="x11AppLauncherTitle">
    <div class="modal-title-row"><div><h2 id="x11AppLauncherTitle">X11 图形应用</h2><span class="muted">${esc(connection.name)}</span></div><button class="icon-button" type="button" onclick="closeX11AppLauncher()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <div class="x11-app-detection"><div id="x11AppDetection" class="connection-test-status busy" aria-live="polite">正在识别远端图形程序…</div><button class="icon-button" type="button" onclick="detectX11Applications(${Number(connectionId)})" title="重新识别" aria-label="重新识别">${icon("refresh-cw")}</button></div><div id="x11AppInstallAction" class="x11-app-install-action" hidden></div>
    <div class="grid"><div><label>已安装程序</label><select id="x11AppPreset" disabled onchange="applyX11AppPreset()"><option value="">正在探测…</option></select></div><div><label>转发模式</label><select id="x11AppMode"><option value="untrusted" ${initialMode === "untrusted" ? "selected" : ""}>受限（-X）</option><option value="trusted" ${initialMode === "trusted" ? "selected" : ""}>可信（-Y）</option></select></div></div>
    <label>程序</label><input id="x11AppCommand" required value="" autocomplete="off" spellcheck="false">
    <label>参数</label><input id="x11AppArgs" value="" autocomplete="off" spellcheck="false" placeholder="可选">
    <div class="actions"><button type="button" onclick="closeX11AppLauncher()">取消</button><button class="primary" type="submit">${icon("play")}<span>启动</span></button></div>
  </form>`;
  modal.hidden = false;
  modal.onclick = null;
  x11AppModalKeyHandler = event => { if (event.key === "Escape") closeX11AppLauncher(); };
  document.addEventListener("keydown", x11AppModalKeyHandler);
  modal.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setButtonBusy(button, true, "启动中");
    try {
      const presetKey = $("x11AppPreset").value;
      const preset = modal._x11Applications?.get?.(presetKey);
      const command = $("x11AppCommand").value.trim();
      const args = $("x11AppArgs").value.trim();
      const mode = $("x11AppMode").value === "trusted" ? "trusted" : "untrusted";
      const launched = await launchX11App(connectionId, {label:preset?.label || command, command, args, kind:preset?.kind || "custom", mode});
      if (!launched) return setButtonBusy(button, false);
      closeX11AppLauncher();
    } catch (error) {
      const status = $("x11AppDetection");
      if (status) {
        status.className = "connection-test-status error";
        status.textContent = error.message || "X11 图形应用启动失败";
      }
      notify(error.message || "X11 图形应用启动失败", "error");
      setButtonBusy(button, false);
    }
  });
  refreshIcons();
  void detectX11Applications(connectionId);
}

async function ensureXServerReady() {
  let diagnostics = await api("/api/xserver").catch(() => null);
  let startError = "";
  if (diagnostics?.integration_available === false) {
    notify("当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server", "error");
    return false;
  }
  if (diagnostics?.can_start && !diagnostics.available) {
    diagnostics = await api("/api/xserver", {method:"POST", body:"{}"}).catch(error => {
      startError = error.message || "X Server 启动失败";
      return {...diagnostics, reason:startError};
    });
  }
  if (startError) {
    notify(startError, "error");
    return false;
  }
  if (diagnostics && !diagnostics.available) {
    return confirmModal(`${diagnostics.reason}。仍要继续吗？`, "本机 X Server 未就绪", "仍然继续", "取消");
  }
  return true;
}

async function launchX11App(connectionId, values) {
  const connection = currentConnection(connectionId);
  if (!connection) throw new Error("SSH 连接不存在");
  const command = String(values.command || "").trim();
  const args = String(values.args || "").trim();
  if (!command || command.length > 1024 || /[\0\r\n]/.test(command)) throw new Error("请输入有效的图形程序");
  if (args.length > 4096 || /[\0\r\n]/.test(args)) throw new Error("图形程序参数无效");
  const verified = await api(`/api/connections/${connectionId}/x11-applications/verify`, {method:"POST", body:JSON.stringify({command})});
  const resolvedCommand = verified.application?.path || command;
  if (!await ensureXServerReady()) return false;
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:String(values.label || command).slice(0, 120),
    terminal_profile_kind:values.kind || "custom",
    terminal_program_path:resolvedCommand,
    terminal_program_args:args,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:values.mode === "trusted" ? "trusted" : "untrusted"
  });
  const openedKey = openTerminal(connection.id, true, key, `${connection.name} · ${String(values.label || command)}`);
  if (!openedKey) throw new Error("X11 终端标签创建失败");
  notify("已启动 X11 图形应用，图形窗口可能需要几秒显示", "success");
  return true;
}

async function openX11Terminal(connectionId, mode="untrusted") {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  if (!await ensureXServerReady()) return;
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  terminalStartupOverrides.set(key, {...terminalStartupConfigForConnection(connection), x11_mode:mode});
  const openedKey = openTerminal(connection.id, true, key, `${connection.name} · X11${mode === "trusted" ? "（可信）" : ""}`);
  if (openedKey) notify("已打开 X11 图形终端", "success");
  return openedKey;
}

let xServerModalKeyHandler = null;
let xServerManagerConnectionId = 0;

function closeXServerManager() {
  if (xServerModalKeyHandler) document.removeEventListener("keydown", xServerModalKeyHandler);
  xServerModalKeyHandler = null;
  const modal = $("modal");
  modal.onclick = null;
  modal.hidden = true;
  modal.innerHTML = "";
}

function xServerModeLabel(value) {
  return {bundled:"Terma 内置", system:"系统组件", native:"桌面会话", missing:"未安装"}[value] || value || "未知";
}

async function renderXServerManager() {
  const diagnostics = await api("/api/xserver");
  const modal = $("modal");
  const connection = currentConnection(xServerManagerConnectionId) || currentConnection();
  const sshX11 = connection ? await api(`/api/connections/${Number(connection.id)}/x11-forwarding`).catch(error => ({error:error.message || "SSH X11 配置探测失败"})) : null;
  const integrationUnavailable = diagnostics.integration_available === false;
  const integrationUnavailableReason = "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server";
  const serverSide = diagnostics.server_side || {};
  const installLabel = diagnostics.platform === "linux" ? "安装 Linux 图形组件" : "安装 XQuartz";
  const defaultX11Mode = connection?.x11_mode === "trusted" ? "trusted" : connection?.x11_mode === "untrusted" ? "untrusted" : "off";
  const linuxX11Action = !integrationUnavailable && diagnostics.platform === "linux" && connection
    ? `<button class="primary" type="button" onclick="openX11TerminalFromManager(${Number(connection.id)})">${icon("square-terminal")}<span>临时打开 X11 终端</span></button><button type="button" onclick="changeConnectionDefaultX11(${Number(connection.id)},'${defaultX11Mode === "off" ? "trusted" : "off"}',this)">${icon(defaultX11Mode === "off" ? "badge-check" : "circle-off")}<span>${defaultX11Mode === "off" ? "普通终端默认启用" : "关闭普通终端默认 X11"}</span></button>`
    : "";
  const linuxHint = !integrationUnavailable && diagnostics.platform === "linux"
    ? `<div class="connection-test-status">${connection ? defaultX11Mode === "off" ? `本机 DISPLAY 已就绪；“${esc(connection.name)}”的普通终端尚未默认请求 X11，可临时打开或保存为默认。` : `“${esc(connection.name)}”的普通终端已默认使用${defaultX11Mode === "trusted" ? "可信" : "受限"} X11，可直接运行 Java GUI 等图形程序。` : "本机 DISPLAY 已就绪；SSH 普通终端是否转发图形窗口取决于对应连接保存的 X11 模式。"}</div>`
    : "";
  const sshX11Block = renderSshX11ForwardingPanel(connection, sshX11);
  const stateTitle = integrationUnavailable ? "桌面集成不可用" : diagnostics.available ? "已就绪" : diagnostics.running ? "正在运行" : "未启动";
  const stateReason = integrationUnavailable ? integrationUnavailableReason : diagnostics.reason || "";
  const stateIcon = integrationUnavailable ? "monitor-x" : diagnostics.available ? "circle-check" : diagnostics.running ? "circle-pause" : "circle-alert";
  const stateClass = integrationUnavailable ? "warning" : diagnostics.available ? "ready" : diagnostics.running ? "warning" : "";
  const details = integrationUnavailable
    ? `<dl class="xserver-details"><div><dt>当前后端</dt><dd>独立 Web/测试后端</dd></div><div><dt>桌面设备</dt><dd>无法探测 X Server</dd></div>${serverSide.display ? `<div><dt>后端 DISPLAY</dt><dd>${esc(serverSide.display)}</dd></div>` : ""}<div><dt>管理范围</dt><dd>仅运行 Terma 的桌面设备</dd></div></dl>`
    : `<dl class="xserver-details"><div><dt>运行方式</dt><dd>${esc(xServerModeLabel(diagnostics.mode))}</dd></div><div><dt>DISPLAY</dt><dd>${esc(diagnostics.display || "-")}</dd></div><div><dt>管理范围</dt><dd>${esc(diagnostics.managed ? "Terma 当前会话" : "系统或桌面会话")}</dd></div>${["win32","darwin"].includes(diagnostics.platform) ? `<div><dt>下次启动</dt><dd>${diagnostics.auto_start === false ? "保持关闭" : "自动启动"}</dd></div>` : ""}</dl>`;
  modal.innerHTML = `<div class="modal-card xserver-manager" role="dialog" aria-modal="true" aria-labelledby="xServerManagerTitle">
    <div class="modal-title-row"><div><h2 id="xServerManagerTitle">X Server</h2><span class="muted">${esc(integrationUnavailable ? "独立 Web/测试后端" : diagnostics.server || xServerModeLabel(diagnostics.mode))}</span></div><button class="icon-button" type="button" onclick="closeXServerManager()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <div class="xserver-state ${stateClass}"><span>${icon(stateIcon)}</span><div><b>${esc(stateTitle)}</b><small>${esc(stateReason)}</small></div></div>
    ${details}
    ${linuxHint}
    ${sshX11Block}
    <div class="actions"><button type="button" onclick="renderXServerManager()">${icon("refresh-cw")}<span>刷新</span></button>${!integrationUnavailable && diagnostics.can_stop ? `<button type="button" onclick="changeXServerState('stop',this)">${icon("square")}<span>停止</span></button>` : ""}${!integrationUnavailable && diagnostics.can_install ? `<button class="primary" type="button" onclick="installXServerComponentsFromManager(this,'${escAttr(diagnostics.platform || "")}')">${icon("download")}<span>${esc(installLabel)}</span></button>` : ""}${!integrationUnavailable && diagnostics.can_start ? `<button class="primary" type="button" onclick="changeXServerState('start',this)">${icon("play")}<span>启动</span></button>` : ""}${linuxX11Action}</div>
  </div>`;
  modal.hidden = false;
  refreshIcons();
  if (connection) {
    const actionKey = x11ForwardingActionKey(connection.id);
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  }
}

async function inspectSshX11Forwarding(connectionId, source="xserver") {
  xServerManagerConnectionId = Number(connectionId || xServerManagerConnectionId || 0);
  try {
    if (source === "linux-desktop") await loadLinuxDesktopManager();
    else await renderXServerManager();
  } catch (error) { notify(error.message || "SSH X11 配置探测失败", "error"); }
}

async function changeSshX11Forwarding(action, button, connectionId, source="xserver") {
  const enabled = action === "enable";
  const actionKey = x11ForwardingActionKey(connectionId);
  if (!beginUiAction(actionKey, button, enabled ? "开启中..." : "关闭中...")) {
    notify("SSH X11 转发任务正在执行，请等待完成", "info");
    return null;
  }
  const message = enabled
    ? "将备份并修改远端 sshd_config，开启 X11Forwarding，然后尝试重新加载 SSH 服务。是否继续？"
    : "将关闭远端 sshd_config 的 X11Forwarding。已有 SSH 会话不受影响，新会话将不能使用 X11。是否继续？";
  try {
    if (!await confirmModal(message, enabled ? "开启 SSH X11 转发" : "关闭 SSH X11 转发", enabled ? "开启" : "关闭", "取消", enabled ? false : true)) return null;
    let adminAuth = null;
    setButtonBusy(button, true, enabled ? "开启中..." : "关闭中...");
    const diagnostics = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`);
    if (!diagnostics.can_manage) {
      adminAuth = await requestRemoteAdminAuthorization(Number(connectionId), enabled ? "开启 SSH X11 转发" : "关闭 SSH X11 转发");
      if (!adminAuth) return;
    }
    const result = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`, {method:"POST", body:JSON.stringify({action, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const requestedLabel = `${enabled ? "开启" : "关闭"} SSH X11 转发`;
      const requestAccepted = notifyRemoteComponentTaskRequest(result, requestedLabel, `SSH X11 转发${enabled ? "开启" : "关闭"}已加入任务中心`);
      const task = await watchRemoteComponentTask(result.task, {title:`${enabled ? "开启" : "关闭"} SSH X11 转发`});
      if (String(task?.status || "").toLowerCase() !== "done") throw new Error(task?.error || "SSH X11 转发任务执行失败");
      if (!requestAccepted) {
        if (source === "linux-desktop") await loadLinuxDesktopManager();
        else await renderXServerManager();
        return null;
      }
    }
    notify(enabled ? "SSH X11 转发已开启" : "SSH X11 转发已关闭", "success");
    if (source === "linux-desktop") await loadLinuxDesktopManager();
    else await renderXServerManager();
  } catch (error) {
    notify(error.message || "SSH X11 转发配置失败", "error");
    if (source === "linux-desktop") await loadLinuxDesktopManager().catch(() => {});
    else await renderXServerManager().catch(() => {});
  } finally {
    endUiAction(actionKey, button);
  }
}

async function openSshX11ConfigureTerminal(connectionId, action, source="xserver") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify("SSH 连接不存在", "error");
  try {
    const diagnostics = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`);
    const command = String(diagnostics.terminal_commands?.[action] || "").trim();
    if (!command) throw new Error("当前主机没有可用的交互式 X11 配置命令");
    const next = nextTerminalTabIndex(connection.id);
    const key = `terminal-${connection.id}-${next}`;
    const label = action === "enable" ? "开启 X11 转发" : "关闭 X11 转发";
    const startupCommand = `${command}; td_status=$?; printf '\n\nTerma：${label}命令已结束（退出码 %s）。\n' "$td_status"; exec "${'${SHELL:-/bin/sh}'}"`;
    terminalStartupOverrides.set(key, {
      terminal_startup_mode:"program",
      terminal_profile_name:label,
      terminal_profile_kind:"tool",
      terminal_program_path:"/bin/sh",
      terminal_program_args:`-lc ${JSON.stringify(startupCommand)}`,
      terminal_working_directory:"",
      terminal_program_platform:"posix",
      x11_mode:"off"
    });
    if (source === "xserver" && !$('modal')?.hidden) closeXServerManager();
    openTerminal(connection.id, true, key, `${connection.name} · ${label}`);
    notify("已打开配置终端；出现 sudo 提示时请输入远端账号密码", "info");
  } catch (error) {
    notify(error.message || "打开 X11 配置终端失败", "error");
  }
}

async function openRemoteXQuartzInstall(connectionId) {
  if (!$('modal')?.hidden) closeXServerManager();
  await openX11InstallGuide(Number(connectionId));
}

async function installXServerComponentsFromManager(button, platform) {
  const linux = platform === "linux";
  const message = linux
    ? "将使用当前 Linux 系统的软件包管理器安装 Xephyr、FreeRDP 和缺少的 X11 授权组件。普通用户会出现系统管理员授权窗口。"
    : "将从 XQuartz 官方发布页下载安装包，校验 SHA-256、Apple 公证和开发者签名后调用 macOS 管理员授权窗口。";
  const title = linux ? "安装 Linux 图形组件" : "安装 XQuartz";
  if (!await confirmModal(message, title, "安装", "取消")) return;
  try {
    setButtonBusy(button, true, "安装中...");
    const result = await api("/api/xserver/install", {method:"POST", body:"{}"});
    notify(linux ? "Linux 图形组件已安装，可使用 RDP 和 XDMCP" : result.restart_required ? "XQuartz 已安装，请退出并重新登录 macOS 后使用 X11" : "XQuartz 已安装", "success");
    await renderXServerManager();
  } catch (error) {
    notify(error.message || `${title}失败`, "error");
    await renderXServerManager().catch(() => {});
  }
}

async function openXServerManager(connectionId=0) {
  try {
    xServerManagerConnectionId = Number(connectionId || 0);
    await renderXServerManager();
    const modal = $("modal");
    modal.onclick = null;
    if (xServerModalKeyHandler) document.removeEventListener("keydown", xServerModalKeyHandler);
    xServerModalKeyHandler = event => { if (event.key === "Escape") closeXServerManager(); };
    document.addEventListener("keydown", xServerModalKeyHandler);
  } catch (error) {
    notify(error.message || "X Server 状态读取失败", "error");
  }
}

async function openX11TerminalFromManager(connectionId) {
  closeXServerManager();
  await openX11Terminal(connectionId, "untrusted");
}

async function changeConnectionDefaultX11(connectionId, mode, button) {
  try {
    setButtonBusy(button, true, "保存中...");
    await saveConnectionX11Mode(connectionId, mode);
    xServerManagerConnectionId = Number(connectionId);
    await renderXServerManager();
  } catch (error) {
    notify(error.message || "默认 X11 模式保存失败", "error");
    setButtonBusy(button, false);
  }
}

async function changeXServerState(action, button) {
  if (action === "stop" && !await confirmModal("停止 X Server 会同时关闭由它显示的 X11/XDMCP 图形窗口，并在下次启动 Terma 时保持关闭。", "停止 X Server", "停止", "取消", true)) return;
  try {
    setButtonBusy(button, true, action === "start" ? "启动中" : "停止中");
    await api("/api/xserver", {method:action === "start" ? "POST" : "DELETE", body:"{}"});
    notify(action === "start" ? "X Server 已启动，并会在下次自动启动" : "X Server 已停止，并会在下次保持关闭", "success");
    await renderXServerManager();
  } catch (error) {
    notify(error.message || `X Server ${action === "start" ? "启动" : "停止"}失败`, "error");
    await renderXServerManager().catch(() => {});
  }
}

async function saveConnectionX11Mode(connectionId, mode) {
  await api(`/api/connections/${connectionId}/x11-mode`, {method:"POST", body:JSON.stringify({mode})});
  await loadAll();
  notify(mode === "off" ? "已关闭默认 X11 转发" : `已保存默认 X11 模式：${mode === "trusted" ? "可信" : "受限"}`, "success");
}
