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
    {label:"临时启动 X11（受限）", icon:"x11", run:()=>openX11Terminal(connectionId,"untrusted")},
    {label:"临时启动可信 X11", icon:"badge-check", run:()=>openX11Terminal(connectionId,"trusted")},
    {separator:true},
    {label:"X Server 管理", icon:"x11", run:()=>openXServerManager(connectionId)},
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
  if (diagnostics?.authorization_required) {
    if (!await ensureDesktopIntegrationAuthorized(["xserver"])) return false;
    diagnostics = await api("/api/xserver").catch(() => null);
  }
  if (diagnostics?.integration_available === false) {
    notify(diagnostics.reason || "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server", "error");
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
  const authorizationRequired = Boolean(diagnostics.authorization_required);
  const localDirectAuthorized = diagnostics.authorization_kind === "local-direct";
  const standaloneBackend = diagnostics.integration_available === false && !diagnostics.desktop_backend_available;
  const integrationUnavailable = authorizationRequired || standaloneBackend;
  const integrationUnavailableReason = diagnostics.reason || (standaloneBackend
    ? "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server"
    : "当前浏览器会话没有桌面集成权限");
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
  const stateTitle = authorizationRequired ? "等待桌面授权" : standaloneBackend ? "桌面集成不可用" : diagnostics.available ? "已就绪" : diagnostics.running ? "正在运行" : "未启动";
  const stateReason = integrationUnavailable ? integrationUnavailableReason : diagnostics.reason || "";
  const stateIcon = authorizationRequired ? "shield-alert" : integrationUnavailable ? "monitor-x" : diagnostics.available ? "circle-check" : diagnostics.running ? "circle-pause" : "circle-alert";
  const stateClass = integrationUnavailable ? "warning" : diagnostics.available ? "ready" : diagnostics.running ? "warning" : "";
  const details = integrationUnavailable
    ? authorizationRequired
      ? `<dl class="xserver-details"><div><dt>当前后端</dt><dd>Terma 桌面后端</dd></div><div><dt>浏览器会话</dt><dd>尚未获得桌面集成授权</dd></div><div><dt>X Server</dt><dd>${diagnostics.running || diagnostics.available ? "正在运行" : "状态受限"}</dd></div>${serverSide.display ? `<div><dt>后端 DISPLAY</dt><dd>${esc(serverSide.display)}</dd></div>` : ""}<div><dt>授权范围</dt><dd>仅 X Server 与本机图形调用；时长由申请时选择</dd></div></dl>`
      : `<dl class="xserver-details"><div><dt>当前后端</dt><dd>独立 Web/测试后端</dd></div><div><dt>桌面设备</dt><dd>无法探测 X Server</dd></div>${serverSide.display ? `<div><dt>后端 DISPLAY</dt><dd>${esc(serverSide.display)}</dd></div>` : ""}<div><dt>管理范围</dt><dd>仅运行 Terma 的桌面设备</dd></div></dl>`
    : `<dl class="xserver-details"><div><dt>运行方式</dt><dd>${esc(xServerModeLabel(diagnostics.mode))}</dd></div><div><dt>DISPLAY</dt><dd>${esc(diagnostics.display || "-")}</dd></div>${localDirectAuthorized ? `<div><dt>浏览器权限</dt><dd>本机直连自动授权</dd></div>` : ""}<div><dt>管理范围</dt><dd>${esc(diagnostics.managed ? "Terma 当前会话" : "系统或桌面会话")}</dd></div>${["win32","darwin"].includes(diagnostics.platform) ? `<div><dt>下次启动</dt><dd>${diagnostics.auto_start === false ? "保持关闭" : "自动启动"}</dd></div>` : ""}</dl>`;
  modal.innerHTML = `<div class="modal-card xserver-manager" role="dialog" aria-modal="true" aria-labelledby="xServerManagerTitle">
    <div class="modal-title-row"><div><h2 id="xServerManagerTitle">X Server</h2><span class="muted">${esc(authorizationRequired ? "当前浏览器尚未授权" : standaloneBackend ? "独立 Web/测试后端" : localDirectAuthorized ? "本机直连自动授权" : diagnostics.server || xServerModeLabel(diagnostics.mode))}</span></div><button class="icon-button" type="button" onclick="closeXServerManager()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <div class="xserver-state ${stateClass}"><span>${icon(stateIcon)}</span><div><b>${esc(stateTitle)}</b><small>${esc(stateReason)}</small></div></div>
    ${details}
    ${desktopIntegrationAuthorizationMarkup(diagnostics, ["xserver"], {refreshTarget:"xserver"})}
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
