function x11ShellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'"'"'`)}'`;
}

function x11ShellPrintfLine(value, shellValue="") {
  const source = String(value ?? "");
  const marker = shellValue ? source.indexOf("%s") : -1;
  if (marker < 0) return `printf '\\n\\n%s\\n' ${x11ShellSingleQuote(source)}`;
  const before = source.slice(0, marker);
  const after = source.slice(marker + 2);
  return `printf '\\n\\n%s%s%s\\n' ${x11ShellSingleQuote(before)} "${shellValue}" ${x11ShellSingleQuote(after)}`;
}

function showX11LaunchMenu(event, connectionId, terminalKey="") {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  showActionMenu(event, x11LaunchActions(connectionId, terminalKey));
}

function showQuickX11LaunchMenu(event, terminalKey) {
  const session = terminalSessions.get(String(terminalKey || ""));
  if (!session?.connection?.quick_connection) return;
  const connectionId = Number(session.connection.id || 0);
  showActionMenu(event, [
    {label:tr("terminal:x11_menu.temporary_untrusted", {defaultValue:"临时启动 X11（受限）"}), icon:"x11", run:()=>openQuickX11Terminal(terminalKey, "untrusted")},
    {label:tr("terminal:x11_menu.temporary_trusted", {defaultValue:"临时启动可信 X11"}), icon:"badge-check", run:()=>openQuickX11Terminal(terminalKey, "trusted")},
    {separator:true},
    {label:tr("common:x11.manager", {defaultValue:"X Server 管理"}), icon:"x11", run:()=>openXServerManager(connectionId, terminalKey)}
  ]);
}

async function openQuickX11Terminal(terminalKey, mode="untrusted") {
  const session = terminalSessions.get(String(terminalKey || ""));
  const connection = session?.connection;
  const token = String(session?.quickToken || connection?.quick_token || "");
  if (!connection?.quick_connection || !token) return notify(tr("common:x11.quick_credentials_expired", {defaultValue:"临时连接凭据已失效，请先重新连接"}), "error");
  if (!await ensureXServerReady()) return false;
  const x11Mode = mode === "trusted" ? "trusted" : "untrusted";
  openQuickTerminal(
    {...connection, x11_mode:x11Mode},
    token,
    true,
    "",
    `${connection.name} · ${x11Mode === "trusted" ? tr("common:auto.trusted_x11", {defaultValue:"可信 X11"}) : "X11"}`
  );
  return true;
}

function x11ModeScopeActions(connectionId, mode, terminalKey="") {
  return [
    {label:tr("terminal:x11_menu.current_terminal", {defaultValue:"当前终端生效"}), icon:"refresh-cw", run:()=>saveAndApplyX11ModeToCurrentTerminal(connectionId, mode, terminalKey)},
    {label:tr("terminal:x11_menu.new_terminal", {defaultValue:"新建终端"}), icon:"square-terminal", run:()=>saveAndOpenX11ModeTerminal(connectionId, mode)},
    {label:tr("terminal:x11_menu.next_start", {defaultValue:"下次生效"}), icon:"save", run:()=>saveConnectionX11Mode(connectionId, mode)}
  ];
}

function x11LaunchActions(connectionId, terminalKey="") {
  const connection = currentConnection(connectionId);
  if (!connection) return [];
  return [
    {label:tr("terminal:x11_menu.launch_app", {defaultValue:"启动 X11 图形应用…"}), icon:"panels-top-left", run:()=>openX11AppLauncher(connectionId)},
    {separator:true},
    {label:tr("terminal:x11_menu.temporary_untrusted", {defaultValue:"临时启动 X11（受限）"}), icon:"x11", run:()=>openX11Terminal(connectionId,"untrusted")},
    {label:tr("terminal:x11_menu.temporary_trusted", {defaultValue:"临时启动可信 X11"}), icon:"badge-check", run:()=>openX11Terminal(connectionId,"trusted")},
    {separator:true},
    {label:tr("common:x11.manager", {defaultValue:"X Server 管理"}), icon:"x11", run:()=>openXServerManager(connectionId)},
    {separator:true},
    {label:tr("terminal:x11_menu.default_untrusted", {defaultValue:"默认使用受限 X11（-X）"}), icon:"shield-check", children:()=>x11ModeScopeActions(connectionId,"untrusted",terminalKey)},
    {label:tr("terminal:x11_menu.default_trusted", {defaultValue:"默认使用可信 X11（-Y）"}), icon:"badge-check", children:()=>x11ModeScopeActions(connectionId,"trusted",terminalKey)},
    ...(connection.x11_mode !== "off" ? [{label:tr("terminal:x11_menu.disable_default", {defaultValue:"关闭默认 X11 转发"}), icon:"x", children:()=>x11ModeScopeActions(connectionId,"off",terminalKey)}] : [])
  ];
}

function terminalKeyForX11Scope(connectionId, preferredKey="") {
  const candidates = [String(preferredKey || ""), String(activeTabKey || "")];
  return candidates.find(key => {
    const session = terminalSessions.get(key);
    return session && !session.connection?.quick_connection && Number(session.id) === Number(connectionId);
  }) || "";
}

function updateTerminalX11ScopeButton(key, mode) {
  const button = terminalElementForKey(key, ".terminal-x11-button");
  if (!button) return;
  const enabled = mode === "trusted" || mode === "untrusted";
  const label = enabled
    ? mode === "trusted"
      ? tr("common:auto.trusted_x11", {defaultValue:"可信 X11"})
      : tr("common:auto.untrusted_x11", {defaultValue:"受限 X11"})
    : tr("common:auto.x11_disabled", {defaultValue:"关闭 X11"});
  button.classList.toggle("active", enabled);
  button.title = tr("terminal:x11_menu.current_mode", {mode:label, defaultValue:`X11 图形转发：当前终端${label}`});
  button.setAttribute("aria-label", button.title);
}

async function saveAndApplyX11ModeToCurrentTerminal(connectionId, mode, preferredKey="") {
  const key = terminalKeyForX11Scope(connectionId, preferredKey);
  if (!currentConnection(connectionId) || !key) throw new Error(tr("common:x11.current_terminal_missing", {defaultValue:"当前没有这台服务器的终端，请选择“新建终端”"}));
  const normalizedMode = ["trusted", "untrusted"].includes(mode) ? mode : "off";
  if (normalizedMode !== "off" && !await ensureXServerReady()) return false;
  await persistConnectionX11Mode(connectionId, normalizedMode);
  const connection = currentConnection(connectionId);
  if (!connection) throw new Error(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}));
  terminalStartupOverrides.set(key, {
    ...effectiveTerminalStartupConfig(connection, key),
    x11_mode:normalizedMode
  });
  updateTerminalStartupButton(key, connection);
  updateTerminalX11ScopeButton(key, normalizedMode);
  reconnectTerminal(connectionId, key);
  const modeLabel = normalizedMode === "off"
    ? tr("common:auto.x11_disabled", {defaultValue:"关闭 X11"})
    : normalizedMode === "trusted"
      ? tr("common:auto.trusted_x11", {defaultValue:"可信 X11"})
      : tr("common:auto.untrusted_x11", {defaultValue:"受限 X11"});
  notify(tr("common:x11.reconnecting_mode", {mode:modeLabel, defaultValue:`当前终端正在重连并${normalizedMode === "off" ? "关闭 X11" : `启用${modeLabel}`}，原有内容已保留`}), "success");
  return true;
}

async function saveAndOpenX11ModeTerminal(connectionId, mode) {
  const normalizedMode = ["trusted", "untrusted"].includes(mode) ? mode : "off";
  if (normalizedMode !== "off" && !await ensureXServerReady()) return false;
  await persistConnectionX11Mode(connectionId, normalizedMode);
  return openTerminalWithX11Mode(connectionId, normalizedMode, {xServerReady:true, savedDefault:true});
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
    const label = x11ApplicationCategoryLabel(item);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups.entries()].map(([label, items]) => `<optgroup label="${escAttr(label)}">${items.map(item => `<option value="${escAttr(item.id)}">${esc(x11ApplicationLabel(item))}</option>`).join("")}</optgroup>`).join("")
    + `<option value="custom">${esc(tr("common:x11.custom_application", {defaultValue:"自定义程序…"}))}</option>`;
}

function x11ApplicationCategoryLabel(item={}) {
  return {
    terminal:tr("common:x11.category_terminal", {defaultValue:"终端"}),
    tool:tr("common:x11.category_tool", {defaultValue:"小工具"}),
    file:tr("common:x11.category_file", {defaultValue:"文件管理"}),
    browser:tr("common:x11.category_browser", {defaultValue:"浏览器"}),
    desktop:tr("common:x11.category_desktop", {defaultValue:"桌面会话"})
  }[String(item.category || "")] || item.category_label || tr("common:x11.category_application", {defaultValue:"应用"});
}

function x11ApplicationLabel(item={}) {
  return {
    dolphin:tr("common:x11.application_dolphin", {defaultValue:"Dolphin 文件管理器"}),
    nautilus:tr("common:x11.application_nautilus", {defaultValue:"GNOME 文件"}),
    thunar:tr("common:x11.application_thunar", {defaultValue:"Thunar 文件管理器"}),
    plasma:tr("common:x11.application_plasma", {defaultValue:"KDE Plasma 会话"}),
    gnome:tr("common:x11.application_gnome", {defaultValue:"GNOME 会话"}),
    xfce:tr("common:x11.application_xfce", {defaultValue:"XFCE 会话"})
  }[String(item.id || "")] || item.label || item.command || item.id || "";
}

function x11DiscoveryWarning(discovery={}) {
  if (discovery.xauth_available) return "";
  return discovery.platform === "macos"
    ? tr("common:x11.warning_xquartz_missing", {defaultValue:"远端未安装 XQuartz，缺少 xauth 与常用 X11 程序"})
    : tr("common:x11.warning_xauth_missing", {defaultValue:"远端探测未找到 xauth；如果终端已获得 DISPLAY 且图形程序可以打开，可继续使用，安装 xauth 可提高授权兼容性"});
}

async function detectX11Applications(connectionId) {
  const modal = $("modal");
  const select = $("x11AppPreset");
  const status = $("x11AppDetection");
  if (!select || !status) return;
  const serial = ++x11AppDiscoverySerial;
  modal._x11Applications = new Map();
  select.disabled = true;
  select.innerHTML = `<option value="">${esc(tr("common:x11.detecting_option", {defaultValue:"正在探测…"}))}</option>`;
  status.className = "connection-test-status busy";
  status.textContent = tr("common:x11.detecting_applications", {defaultValue:"正在通过 SSH 识别远端已安装的 X11 图形程序…"});
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
    const warning = Array.isArray(discovery.warnings) && discovery.warnings.some(Boolean) ? x11DiscoveryWarning(discovery) : "";
    status.className = `connection-test-status ${applications.length ? "success" : "warning"}`;
    status.textContent = applications.length
      ? warning
        ? tr("common:x11.detected_with_warning", {count:applications.length, warning, defaultValue:"已自动识别 {{count}} 个图形程序；{{warning}}"})
        : tr("common:x11.detected_applications", {count:applications.length, defaultValue:"已自动识别 {{count}} 个图形程序，请选择后启动"})
      : warning
        ? tr("common:x11.none_with_warning", {warning, defaultValue:"远端没有识别到常用 X11 图形程序；{{warning}}"})
        : tr("common:x11.no_applications", {defaultValue:"远端没有识别到常用 X11 图形程序，可以填写自定义程序"});
    renderX11InstallAction(connectionId, discovery);
  } catch (error) {
    if (serial !== x11AppDiscoverySerial || modal.hidden || !$("x11AppPreset")) return;
    select.innerHTML = `<option value="custom">${esc(tr("common:x11.custom_application", {defaultValue:"自定义程序…"}))}</option>`;
    select.disabled = false;
    select.value = "custom";
    status.className = "connection-test-status error";
    status.textContent = tr("common:x11.detection_failed", {defaultValue:"自动识别失败，请检查 SSH 连接后重试"});
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
    ? tr("common:x11.install_xquartz", {defaultValue:"安装远端 XQuartz"})
    : plan?.supported
      ? tr("common:x11.install_common_apps", {defaultValue:"安装/配置常用 X11 程序"})
      : tr("common:x11.view_install_guide", {defaultValue:"查看 X11 安装说明"});
  host.innerHTML = `<button type="button" class="x11-install-link" onclick="openX11InstallGuide(${Number(connectionId)})">${icon(plan?.supported ? "package-plus" : "book-open-check")}<span>${esc(label)}</span></button>`;
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
    const applicationCount = Array.isArray(discovery.applications) ? discovery.applications.length : 0;
    const installStateClass = installed ? "success" : plan.supported ? "warning" : "error";
    const installStateText = installed
      ? macos
        ? tr("common:x11.guide_xquartz_ready", {defaultValue:"远端 XQuartz 与 xauth 已识别，X11 组件已经可用。"})
        : applicationCount
          ? tr("common:x11.guide_apps_ready", {count:applicationCount, defaultValue:"远端已识别 xauth 和 {{count}} 个常用 X11 程序，组件安装完成。"})
          : tr("common:x11.guide_xauth_ready", {defaultValue:"远端 xauth 已安装；尚未识别到常用 X11 程序，可继续安装工具或直接填写程序路径。"})
      : plan.supported
        ? (macos
          ? tr("common:x11.guide_xquartz_incomplete", {defaultValue:"远端 macOS 未安装完整的 XQuartz 组件，请选择安装方式。"})
          : tr("common:x11.guide_components_incomplete", {defaultValue:"远端没有完整识别到 xauth 或常用 X11 程序，请选择安装方式。"}))
        : (macos && discovery.xquartz_installed
          ? tr("common:x11.guide_redetect_xquartz", {defaultValue:"远端 XQuartz 已安装；请重新检测 SSH X11 转发配置和图形程序。"})
          : tr("common:x11.guide_manual_required", {defaultValue:"当前远端没有识别到可自动执行的包管理器，请打开手动安装说明。"}));
    const title = macos
      ? tr("common:x11.install_xquartz", {defaultValue:"安装远端 XQuartz"})
      : tr("common:x11.install_graphical_apps", {defaultValue:"安装/配置 X11 图形程序"});
    const steps = Array.isArray(plan.instructions) ? plan.instructions : [];
    const actionKey = x11ComponentsActionKey(connectionId);
    const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="x11InstallGuideTitle">
      <div class="modal-title-row"><div><h2 id="x11InstallGuideTitle">${esc(title)}</h2><span class="muted">${esc(discovery.platform || tr("common:x11.remote_host", {defaultValue:"远端主机"}))} · ${esc(plan.package_manager || tr("common:x11.package_unknown", {defaultValue:"未识别包管理器"}))}</span></div><button class="icon-button" type="button" onclick="closeX11InstallGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      <div class="connection-test-status ${installStateClass}">${esc(installStateText)}</div>
      ${remoteInstallModesMarkup(plan, mode => `installRemoteX11Components(${Number(connectionId)},this,${plan.requires_password ? "true" : "false"},'${mode}')`, "revealRemoteInstallManual(this)", actionKey)}
      ${remoteInstallManualMarkup(plan, {steps, commands:optional, note:macos ? tr("common:x11.guide_xquartz_restart_note", {defaultValue:"XQuartz 安装完成后通常需要退出并重新登录 macOS，再重新建立 SSH X11 会话。"}) : tr("common:x11.guide_offline_note", {defaultValue:"如果服务器和本机都不能联网，请在另一台同发行版、同架构设备上下载 xauth、x11-apps、xterm 及完整依赖后上传安装。"})})}
      ${optional.length ? `<details class="x11-install-optional"><summary>${esc(tr("common:x11.guide_optional_apps", {defaultValue:"可选：安装 Firefox 等大型程序"}))}</summary><div>${optional.map(item => `<pre class="x11-install-command">${esc(item)}</pre>`).join("")}</div></details>` : ""}
      <div id="x11InstallTaskState"></div>
      <div class="actions"><button type="button" onclick="closeX11InstallGuide()">${esc(closeLabel)}</button>${installed && !macos ? `<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="uninstallRemoteX11Components(${Number(connectionId)},this)">${icon("package-minus")}<span>${esc(tr("common:x11.remove_components", {defaultValue:"卸载 X11 组件"}))}</span></button>` : ""}${command ? `<button type="button" onclick="openX11InstallTerminal(${Number(connectionId)},'',${macos ? "true" : "false"})">${icon("square-terminal")}<span>${esc(tr("common:x11.run_recommended_terminal", {defaultValue:"在终端执行推荐命令"}))}</span></button>` : `<button type="button" onclick="openX11InstallManualTerminal(${Number(connectionId)})">${icon("square-terminal")}<span>${esc(tr("common:x11.open_install_terminal", {defaultValue:"打开安装终端"}))}</span></button>`}</div>
    </div>`;
    modal._x11InstallCommand = command;
    modal._x11ConnectionId = Number(connectionId);
    setRemoteInstallDialogCommands(plan, optional);
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || tr("common:x11.guide_load_failed", {defaultValue:"X11 安装说明读取失败"}), "error");
  }
}

async function installRemoteX11Components(connectionId, button=null, needsAuthorization=true, mode="online") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  const actionKey = x11ComponentsActionKey(connectionId);
  if (!beginUiAction(actionKey, button, tr("common:auto.installing", {defaultValue:"安装中..."}))) {
    notify(tr("common:x11.component_task_running", {defaultValue:"X11 组件任务正在执行，请等待完成"}), "info");
    return null;
  }
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline"
    ? tr("common:x11.local_offline", {defaultValue:"本机下载后离线"})
    : normalizedMode === "offline"
      ? tr("common:x11.remote_cache", {defaultValue:"使用远端缓存"})
      : tr("common:x11.online", {defaultValue:"在线"});
  const message = normalizedMode === "local-offline"
    ? tr("common:x11.install_components_local_confirm", {defaultValue:"Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载匹配的软件包及依赖，通过 SFTP 上传后安装 X11 组件。是否继续？"})
    : normalizedMode === "offline"
      ? tr("common:x11.install_components_cache_confirm", {defaultValue:"将只使用远端包管理器已经缓存的软件包安装 X11 组件，不会访问软件源。缓存不完整时安装会失败，是否继续？"})
      : tr("common:x11.install_components_online_confirm", {defaultValue:"将通过远端软件源在线安装 X11 组件。是否继续？"});
  const title = tr("common:x11.install_components_title", {mode:modeLabel, defaultValue:"{{mode}}安装 X11 组件"});
  try {
    if (!await confirmModal(message, title, tr("common:actions.install", {defaultValue:"安装"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return null;
    const grantScope = normalizedMode === "local-offline"
      ? "x11.remote-install-local-offline"
      : normalizedMode === "offline"
        ? "x11.remote-install-offline"
        : "x11.remote-install";
    const auth = needsAuthorization
      ? await requestRemoteAdminAuthorization(connectionId, tr("common:x11.install_remote_components_title", {mode:modeLabel, defaultValue:"{{mode}}安装远端 X11 组件"}), grantScope)
      : null;
    if (needsAuthorization && !auth) return null;
    if (button && document.contains(button)) setButtonBusy(button, true, tr("common:auto.installing", {defaultValue:"安装中..."}));
    const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
    const result = await api(`/api/connections/${Number(connectionId)}/x11-applications/install`, {method:"POST", body:JSON.stringify({action, ...(auth ? {admin_auth:auth} : {})})});
    if (result.task) {
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? $("x11InstallTaskState") : null,
        title,
        onDone:() => Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? openX11InstallGuide(connectionId) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, title, tr("common:x11.install_queued", {defaultValue:"X11 组件安装已加入任务中心"}));
      await taskCompletion;
      if (!requestAccepted) return null;
    } else {
      closeX11InstallGuide();
      notify(tr("common:x11.install_completed", {defaultValue:"远端 X11 组件安装完成，请重新识别"}), "success");
    }
  } catch (error) {
    notify(error.message || tr("common:x11.install_failed", {mode:modeLabel, defaultValue:"{{mode}}安装远端 X11 组件失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function uninstallRemoteX11Components(connectionId, button=null, source="install-guide") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  const actionKey = x11ComponentsActionKey(connectionId);
  if (!beginUiAction(actionKey, button, tr("common:auto.uninstalling", {defaultValue:"卸载中..."}))) {
    notify(tr("common:x11.component_task_running", {defaultValue:"X11 组件任务正在执行，请等待完成"}), "info");
    return null;
  }
  const title = tr("common:x11.remove_remote_components", {defaultValue:"卸载远端 X11 组件"});
  try {
    if (!await confirmModal(
      tr("common:x11.remove_components_confirm", {defaultValue:"将卸载远端 xauth、常用 X11 工具和终端组件。正在使用这些组件的 SSH X11 会话可能中断；不会卸载 Linux 桌面环境。是否继续？"}),
      title,
      tr("common:actions.remove", {defaultValue:"卸载"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    const auth = await requestRemoteAdminAuthorization(connectionId, title, "x11.remote-uninstall");
    if (!auth) return null;
    if (button && document.contains(button)) setButtonBusy(button, true, tr("common:auto.uninstalling", {defaultValue:"卸载中..."}));
    const result = await api(`/api/connections/${Number(connectionId)}/x11-applications/install`, {method:"POST", body:JSON.stringify({action:"uninstall", admin_auth:auth})});
    if (result.task) {
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => source === "install-guide" && Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? $("x11InstallTaskState") : null,
        title,
        onDone:() => source === "xserver"
          ? renderXServerManager()
          : Number($("modal")?._x11ConnectionId || 0) === Number(connectionId) ? openX11InstallGuide(connectionId) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, title, tr("common:x11.remove_queued", {defaultValue:"X11 组件卸载已加入任务中心"}));
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    if (source === "xserver") await renderXServerManager();
    else closeX11InstallGuide();
    notify(tr("common:x11.remove_completed", {defaultValue:"远端 X11 组件卸载完成"}), "success");
    return result;
  } catch (error) {
    notify(error.message || tr("common:x11.remove_failed", {defaultValue:"卸载远端 X11 组件失败"}), "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

function x11ClipboardActionKey(connectionId) {
  return `x11-clipboard-${Number(connectionId || 0)}`;
}

function renderX11ClipboardHelperPanel(connection, diagnostics) {
  if (!connection) return "";
  const id = Number(connection.id || 0);
  const actionKey = x11ClipboardActionKey(id);
  if (!diagnostics) return `<section class="xserver-clipboard-panel"><div class="connection-test-status warning">${esc(tr("common:x11.clipboard_status_failed", {defaultValue:"无法读取远端 xclip 状态，请刷新后重试。"}))}</div></section>`;
  const plan = diagnostics.install_plan || {};
  const installed = diagnostics.installed === true;
  const stateClass = installed ? "success" : diagnostics.platform === "linux" ? "warning" : "error";
  const stateText = installed
    ? tr("common:x11.clipboard_installed", {defaultValue:"远端已安装 xclip，可用于 X11 图片剪贴板。"})
    : diagnostics.platform === "linux"
      ? tr("common:x11.clipboard_missing", {defaultValue:"远端尚未安装 xclip；安装后，X11 转发终端可接收本机剪贴板图片。"})
      : tr("common:x11.clipboard_not_linux", {defaultValue:"当前远端不是 Linux，Terma 不会安装 xclip。"});
  const installModes = !installed && diagnostics.platform === "linux"
    ? remoteInstallModesMarkup(plan, mode => `runX11ClipboardHelperAction(${id},'${mode}',this)`, "revealRemoteInstallManual(this)", actionKey)
    : "";
  const manual = remoteInstallManualMarkup(plan, {
    steps:Array.isArray(diagnostics.guide?.steps) ? diagnostics.guide.steps : [],
    commands:Array.isArray(diagnostics.guide?.commands) ? diagnostics.guide.commands : [],
    note:tr("common:x11.clipboard_note", {defaultValue:"图片通过 SSH X11 转发直接写入远端图形剪贴板；VNC 连接的图片剪贴板仍需在 VNC 会话中配置对应的 xclip 或 wl-clipboard。"})
  });
  const retryLabel = tr("common:x11.clipboard_retry", {defaultValue:"重新检测"});
  return `<section class="xserver-clipboard-panel ${installed ? "ready" : "warning"}"><div class="remote-service-head xserver-clipboard-head"><span class="remote-service-icon ${installed ? "ready" : "warning"}">${icon(installed ? "clipboard-check" : "clipboard-x")}</span><div><b>${esc(tr("common:x11.clipboard", {defaultValue:"X11 图片剪贴板"}))}</b><small>${esc(connection.name || connection.ssh_host || tr("common:x11.remote_host", {defaultValue:"SSH 主机"}))} · ${esc(diagnostics.package_manager || tr("common:x11.package_unknown", {defaultValue:"未识别包管理器"}))}</small></div><button class="icon-button" type="button" onclick="inspectX11ClipboardHelper(${id},this)" title="${escAttr(retryLabel)}" aria-label="${escAttr(retryLabel)}">${icon("refresh-cw")}</button></div><div class="connection-test-status ${stateClass}">${icon(installed ? "circle-check" : "info")}<span>${esc(stateText)}</span></div>${installModes}${manual}${installed ? `<div class="actions tight"><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runX11ClipboardHelperAction(${id},'uninstall',this)">${icon("package-minus")}<span>${esc(tr("common:x11.remove_xclip", {defaultValue:"卸载 xclip"}))}</span></button></div>` : ""}<div id="x11ClipboardTaskState"></div></section>`;
}

async function inspectX11ClipboardHelper(connectionId, button=null) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return null;
  if (button) setButtonBusy(button, true, tr("common:x11.clipboard_detecting", {defaultValue:"探测中..."}));
  try {
    const diagnostics = await api(`/api/connections/${Number(connection.id)}/x11-clipboard/helper`);
    const host = document.querySelector(".xserver-clipboard-panel");
    if (host) host.outerHTML = renderX11ClipboardHelperPanel(connection, diagnostics);
    else await renderXServerManager();
    refreshIcons();
    return diagnostics;
  } catch (error) {
    notify(error.message || tr("common:x11.clipboard_detection_failed", {defaultValue:"X11 图片剪贴板探测失败"}), "error");
    return null;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

async function runX11ClipboardHelperAction(connectionId, mode="online", button=null) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : mode === "uninstall" ? "uninstall" : "online";
  const action = normalizedMode === "uninstall" ? "uninstall" : normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
  const actionKey = x11ClipboardActionKey(connectionId);
  if (!beginUiAction(actionKey, button, action === "uninstall" ? tr("common:auto.uninstalling", {defaultValue:"卸载中..."}) : tr("common:auto.installing", {defaultValue:"安装中..."}))) {
    notify(tr("common:x11.clipboard_task_running", {defaultValue:"X11 图片剪贴板任务正在执行，请等待完成"}), "info");
    return null;
  }
  try {
    const before = await api(`/api/connections/${Number(connection.id)}/x11-clipboard/helper`);
    const modeLabel = normalizedMode === "local-offline"
      ? tr("common:x11.local_offline", {defaultValue:"本机下载后离线"})
      : normalizedMode === "offline"
        ? tr("common:x11.remote_cache", {defaultValue:"使用远端缓存"})
        : tr("common:x11.online", {defaultValue:"在线"});
    const title = action === "uninstall"
      ? tr("common:x11.remove_xclip", {defaultValue:"卸载 xclip"})
      : normalizedMode === "local-offline"
        ? tr("common:x11.local_offline_title", {defaultValue:"本机下载后离线安装 xclip"})
        : tr("common:x11.install_xclip", {mode:modeLabel, defaultValue:`${modeLabel}安装 xclip`});
    const message = action === "uninstall"
      ? tr("common:x11.remove_xclip_confirm", {defaultValue:"将卸载远端 xclip，依赖 X11 图片剪贴板的程序可能受影响。是否继续？"})
      : normalizedMode === "local-offline"
        ? tr("common:x11.local_offline_confirm", {defaultValue:"将由本机下载 xclip 及依赖，通过 SFTP 上传到远端后安装。是否继续？"})
        : normalizedMode === "offline"
          ? tr("common:x11.remote_cache_confirm", {defaultValue:"将只使用远端已经缓存的软件包安装 xclip，不会访问软件源。是否继续？"})
          : tr("common:x11.online_confirm", {defaultValue:"将通过远端软件源在线安装 xclip。是否继续？"});
    if (!await confirmModal(message, title, action === "uninstall" ? tr("common:actions.remove", {defaultValue:"卸载"}) : tr("common:actions.install", {defaultValue:"安装"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return null;
    const grantScope = `x11.clipboard.${action}`;
    const auth = before.root ? null : await requestRemoteAdminAuthorization(Number(connection.id), title, grantScope);
    if (!before.root && !auth) return null;
    if (button && document.contains(button)) setButtonBusy(button, true, action === "uninstall" ? tr("common:auto.uninstalling", {defaultValue:"卸载中..."}) : tr("common:auto.installing", {defaultValue:"安装中..."}));
    const result = await api(`/api/connections/${Number(connection.id)}/x11-clipboard/helper`, {method:"POST", body:JSON.stringify({action, ...(auth ? {admin_auth:auth} : {})})});
    if (result.task) {
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:() => $("x11ClipboardTaskState"),
        title,
        onDone:() => renderXServerManager()
      });
      const accepted = notifyRemoteComponentTaskRequest(result, title, tr("common:x11.clipboard_task_queued", {title, defaultValue:"{{title}}已加入任务中心"}));
      await taskCompletion;
      return accepted ? result : null;
    }
    notify(action === "uninstall"
      ? tr("common:x11.xclip_removed", {defaultValue:"xclip 已卸载"})
      : tr("common:x11.xclip_installed", {defaultValue:"xclip 已安装"}), "success");
    await renderXServerManager();
    return result;
  } catch (error) {
    notify(error.message || (action === "uninstall"
      ? tr("common:x11.xclip_remove_failed", {defaultValue:"卸载 xclip 失败"})
      : tr("common:x11.xclip_install_failed", {defaultValue:"安装 xclip 失败"})), "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function copyX11InstallCommand(button) {
  const command = String($("modal")?._x11InstallCommand || "").trim();
  if (!command) return notify(tr("common:x11.no_install_command", {defaultValue:"当前没有可复制的安装命令"}), "info");
  try {
    await copyText(command);
    notify(tr("common:x11.install_command_copied", {defaultValue:"安装命令已复制"}), "success");
  } catch (error) {
    notify(error.message || tr("common:x11.copy_command_failed", {defaultValue:"复制命令失败"}), "error");
  }
}

function openX11InstallTerminal(connectionId, commandOverride="", remoteXQuartz=false) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  const command = String(commandOverride || $("modal")?._x11InstallCommand || "").trim();
  if (!command) return openX11InstallManualTerminal(connectionId);
  if (connection.quick_connection) {
    const terminalKey = xServerManagerTerminalKey || [...terminalSessions.entries()].find(([, session]) => Number(session?.connection?.id) === Number(connectionId))?.[0] || "";
    const session = terminalSessions.get(terminalKey);
    if (!session?.connected) return notify(tr("common:x11.quick_terminal_not_connected", {defaultValue:"当前临时终端尚未连接，无法放入安装命令"}), "error");
    closeX11InstallGuide();
    if (typeof activateTab === "function") activateTab(terminalKey);
    if (!sendTerminalData(terminalKey, command, {focus:true})) return notify(tr("common:x11.quick_terminal_write_failed", {defaultValue:"无法写入当前临时终端"}), "error");
    notify(tr("common:x11.install_command_sent", {defaultValue:"安装命令已放入当前临时终端，请确认内容后按 Enter 执行"}), "info");
    return terminalKey;
  }
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  const finishedMessage = tr("common:x11.install_terminal_finished", {defaultValue:"Terma 安装命令已结束，请按回车返回 Shell。"});
  const startupCommand = `${command}; ${x11ShellPrintfLine(finishedMessage)}; exec "${'${SHELL:-/bin/sh}'}"`;
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:remoteXQuartz
      ? tr("common:x11.remote_xquartz_install", {defaultValue:"远端 XQuartz 安装"})
      : tr("common:x11.component_install", {defaultValue:"X11 组件安装"}),
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify(startupCommand)}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeX11InstallGuide();
  openTerminal(connection.id, true, key, `${connection.name} · ${remoteXQuartz ? tr("common:x11.xquartz_install", {defaultValue:"XQuartz 安装"}) : tr("common:x11.install", {defaultValue:"X11 安装"})}`);
}

async function openX11InstallManualTerminal(connectionId) {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  if (connection.quick_connection) {
    const terminalKey = xServerManagerTerminalKey || [...terminalSessions.entries()].find(([, session]) => Number(session?.connection?.id) === Number(connectionId))?.[0] || "";
    if (!terminalSessions.get(terminalKey)?.connected) return notify(tr("common:x11.quick_terminal_manual_not_connected", {defaultValue:"当前临时终端尚未连接，无法执行手动安装"}), "error");
    closeX11InstallGuide();
    if (typeof activateTab === "function") activateTab(terminalKey);
    notify(tr("common:x11.returned_to_quick_terminal", {defaultValue:"已返回当前临时终端，请按照安装说明输入适合远端系统的命令"}), "info");
    focusTerminalSession(terminalKey);
    return terminalKey;
  }
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  const prompt = tr("common:x11.manual_install_terminal_prompt", {defaultValue:"请根据安装说明输入适合当前系统的 X11 安装命令。"});
  terminalStartupOverrides.set(key, {
    terminal_startup_mode:"program",
    terminal_profile_name:tr("common:x11.install_guide", {defaultValue:"X11 安装说明"}),
    terminal_profile_kind:"tool",
    terminal_program_path:"/bin/sh",
    terminal_program_args:`-lc ${JSON.stringify(`printf '%s\\n' ${x11ShellSingleQuote(prompt)}; exec "${'${SHELL:-/bin/sh}'}"`)}`,
    terminal_working_directory:"",
    terminal_program_platform:"posix",
    x11_mode:connection.x11_mode === "trusted" ? "trusted" : "untrusted"
  });
  closeX11InstallGuide();
  openTerminal(connection.id, true, key, `${connection.name} · ${tr("common:x11.install_guide", {defaultValue:"X11 安装说明"})}`);
}

function openX11AppLauncher(connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const modal = $("modal");
  const initialMode = connection.x11_mode === "trusted" ? "trusted" : "untrusted";
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  const detectAgainLabel = tr("common:x11.detect_again", {defaultValue:"重新识别"});
  modal.innerHTML = `<form class="modal-card x11-app-launcher" role="dialog" aria-modal="true" aria-labelledby="x11AppLauncherTitle">
    <div class="modal-title-row"><div><h2 id="x11AppLauncherTitle">${esc(tr("common:x11.app_launcher_title", {defaultValue:"X11 图形应用"}))}</h2><span class="muted">${esc(connection.name)}</span></div><button class="icon-button" type="button" onclick="closeX11AppLauncher()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
    <div class="x11-app-detection"><div id="x11AppDetection" class="connection-test-status busy" aria-live="polite">${esc(tr("common:x11.detecting_short", {defaultValue:"正在识别远端图形程序…"}))}</div><button class="icon-button" type="button" onclick="detectX11Applications(${Number(connectionId)})" title="${escAttr(detectAgainLabel)}" aria-label="${escAttr(detectAgainLabel)}">${icon("refresh-cw")}</button></div><div id="x11AppInstallAction" class="x11-app-install-action" hidden></div>
    <div class="grid"><div><label>${esc(tr("common:x11.installed_applications", {defaultValue:"已安装程序"}))}</label><select id="x11AppPreset" disabled onchange="applyX11AppPreset()"><option value="">${esc(tr("common:x11.detecting_option", {defaultValue:"正在探测…"}))}</option></select></div><div><label>${esc(tr("common:x11.forwarding_mode", {defaultValue:"转发模式"}))}</label><select id="x11AppMode"><option value="untrusted" ${initialMode === "untrusted" ? "selected" : ""}>${esc(tr("common:x11.mode_untrusted", {defaultValue:"受限（-X）"}))}</option><option value="trusted" ${initialMode === "trusted" ? "selected" : ""}>${esc(tr("common:x11.mode_trusted", {defaultValue:"可信（-Y）"}))}</option></select></div></div>
    <label>${esc(tr("common:x11.application", {defaultValue:"程序"}))}</label><input id="x11AppCommand" required value="" autocomplete="off" spellcheck="false">
    <label>${esc(tr("common:x11.arguments", {defaultValue:"参数"}))}</label><input id="x11AppArgs" value="" autocomplete="off" spellcheck="false" placeholder="${escAttr(tr("common:auto.optional", {defaultValue:"可选"}))}">
    <div class="actions"><button type="button" onclick="closeX11AppLauncher()">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${icon("play")}<span>${esc(tr("common:auto.start", {defaultValue:"启动"}))}</span></button></div>
  </form>`;
  modal.hidden = false;
  modal.onclick = null;
  x11AppModalKeyHandler = event => { if (event.key === "Escape") closeX11AppLauncher(); };
  document.addEventListener("keydown", x11AppModalKeyHandler);
  modal.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setButtonBusy(button, true, tr("common:x11.launching", {defaultValue:"启动中"}));
    try {
      const presetKey = $("x11AppPreset").value;
      const preset = modal._x11Applications?.get?.(presetKey);
      const command = $("x11AppCommand").value.trim();
      const args = $("x11AppArgs").value.trim();
      const mode = $("x11AppMode").value === "trusted" ? "trusted" : "untrusted";
      const launched = await launchX11App(connectionId, {label:preset ? x11ApplicationLabel(preset) : command, command, args, kind:preset?.kind || "custom", mode});
      if (!launched) return setButtonBusy(button, false);
      closeX11AppLauncher();
    } catch (error) {
      const status = $("x11AppDetection");
      if (status) {
        status.className = "connection-test-status error";
        status.textContent = error.message || tr("common:x11.launch_failed", {defaultValue:"X11 图形应用启动失败"});
      }
      notify(error.message || tr("common:x11.launch_failed", {defaultValue:"X11 图形应用启动失败"}), "error");
      setButtonBusy(button, false);
    }
  });
  refreshIcons();
  void detectX11Applications(connectionId);
}

function xServerReasonText(diagnostics={}, fallback="") {
  const code = String(diagnostics?.reason_code || "").trim().toLowerCase();
  const params = typeof backendPublicErrorParams === "function"
    ? backendPublicErrorParams(diagnostics?.reason_params)
    : {};
  const rawReason = String(diagnostics?.reason || "").trim();
  if (rawReason && diagnostics?.reason_preserve_message === true) {
    return typeof rememberTermaRawUiPhrase === "function" ? rememberTermaRawUiPhrase(rawReason) : rawReason;
  }
  switch (code) {
    case "desktop_xserver_authorization_required_running":
      return tr("common:x11.reason_authorization_required_running", params);
    case "desktop_xserver_authorization_required":
      return tr("common:x11.reason_authorization_required", params);
    case "desktop_xserver_standalone_unavailable":
      return tr("common:x11.standalone_backend_unavailable", params);
    case "xserver_ready":
      return tr("common:x11.reason_xserver_ready", params);
    case "xserver_display_unavailable":
      return tr("common:x11.reason_xserver_display_unavailable", params);
    case "xserver_installed_stopped":
      return tr("common:x11.reason_xserver_installed_stopped", params);
    case "xserver_runtime_missing":
      return tr("common:x11.reason_xserver_runtime_missing", params);
    case "xquartz_ready":
      return tr("common:x11.reason_xquartz_ready", params);
    case "xquartz_display_unavailable":
      return tr("common:x11.reason_xquartz_display_unavailable", params);
    case "xquartz_installed_stopped":
      return tr("common:x11.reason_xquartz_installed_stopped", params);
    case "xquartz_not_installed":
      return tr("common:x11.reason_xquartz_not_installed", params);
    case "linux_x11_ready":
      return tr("common:x11.reason_linux_x11_ready", params);
    case "linux_x11_ready_xephyr_missing":
      return tr("common:x11.reason_linux_x11_ready_xephyr_missing", params);
    case "linux_xauth_missing":
      return tr("common:x11.reason_linux_xauth_missing", params);
    case "linux_display_missing":
      return tr("common:x11.reason_linux_display_missing", params);
    case "xserver_unavailable":
      return tr("common:x11.reason_xserver_unavailable", params);
  }
  const language = typeof normalizeTermaLanguage === "function"
    ? normalizeTermaLanguage(document.documentElement.lang || window.i18next?.resolvedLanguage || "zh-CN")
    : String(document.documentElement.lang || "zh-CN");
  if (rawReason && (language !== "en-US" || !/[\u3400-\u9fff]/.test(rawReason))) return rawReason;
  return fallback || tr("common:x11.reason_xserver_unavailable");
}

async function ensureXServerReady() {
  let diagnostics = await api("/api/xserver").catch(() => null);
  let startError = "";
  if (diagnostics?.authorization_required) {
    if (!await ensureDesktopIntegrationAuthorized(["xserver"])) return false;
    diagnostics = await api("/api/xserver").catch(() => null);
  }
  if (diagnostics?.integration_available === false) {
    notify(xServerReasonText(diagnostics, tr("common:x11.standalone_backend_unavailable", {defaultValue:"当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server"})), "error");
    return false;
  }
  if (diagnostics?.can_start && !diagnostics.available) {
    diagnostics = await api("/api/xserver", {method:"POST", body:"{}"}).catch(error => {
      startError = error.message || tr("common:x11.server_start_failed", {defaultValue:"X Server 启动失败"});
      return {...diagnostics, reason:startError};
    });
  }
  if (startError) {
    notify(startError, "error");
    return false;
  }
  if (diagnostics && !diagnostics.available) {
    const reason = xServerReasonText(diagnostics, tr("common:x11.reason_xserver_unavailable", {defaultValue:"X Server 当前不可用"}));
    return confirmModal(
      tr("common:x11.server_not_ready_confirm", {reason, defaultValue:`${reason}。仍要继续吗？`}),
      tr("common:x11.server_not_ready_title", {defaultValue:"本机 X Server 未就绪"}),
      tr("common:x11.continue_anyway", {defaultValue:"仍然继续"}),
      tr("common:actions.cancel", {defaultValue:"取消"})
    );
  }
  return true;
}

async function launchX11App(connectionId, values) {
  const connection = currentConnection(connectionId);
  if (!connection) throw new Error(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}));
  const command = String(values.command || "").trim();
  const args = String(values.args || "").trim();
  if (!command || command.length > 1024 || /[\0\r\n]/.test(command)) throw new Error(tr("common:x11.invalid_application", {defaultValue:"请输入有效的图形程序"}));
  if (args.length > 4096 || /[\0\r\n]/.test(args)) throw new Error(tr("common:x11.invalid_application_args", {defaultValue:"图形程序参数无效"}));
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
  if (!openedKey) throw new Error(tr("common:x11.terminal_tab_create_failed", {defaultValue:"X11 终端标签创建失败"}));
  notify(tr("common:x11.application_started", {defaultValue:"已启动 X11 图形应用，图形窗口可能需要几秒显示"}), "success");
  return true;
}

async function openTerminalWithX11Mode(connectionId, mode="untrusted", options={}) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const normalizedMode = ["trusted", "untrusted"].includes(mode) ? mode : "off";
  if (normalizedMode !== "off" && !options.xServerReady && !await ensureXServerReady()) return;
  const next = nextTerminalTabIndex(connection.id);
  const key = `terminal-${connection.id}-${next}`;
  terminalStartupOverrides.set(key, {...terminalStartupConfigForConnection(connection), x11_mode:normalizedMode});
  const ordinaryTerminal = tr("common:x11.ordinary_terminal", {defaultValue:"普通终端"});
  const trustedX11 = tr("common:auto.trusted_x11", {defaultValue:"可信 X11"});
  const restrictedX11 = tr("common:auto.untrusted_x11", {defaultValue:"受限 X11"});
  const title = normalizedMode === "off"
    ? `${connection.name} · ${ordinaryTerminal}`
    : `${connection.name} · X11${normalizedMode === "trusted" ? `（${tr("common:x11.trusted_parenthetical", {defaultValue:"可信"})}）` : ""}`;
  const openedKey = openTerminal(connection.id, true, key, title);
  if (openedKey) {
    const terminalLabel = normalizedMode === "off"
      ? ordinaryTerminal
      : `${normalizedMode === "trusted" ? trustedX11 : restrictedX11} ${tr("common:x11.terminal_suffix", {defaultValue:"终端"})}`;
    notify(options.savedDefault
      ? tr("common:x11.saved_default_opened", {terminal:terminalLabel, defaultValue:`已保存默认设置，并打开${terminalLabel}`})
      : normalizedMode === "off"
        ? tr("common:x11.ordinary_opened_without_forwarding", {defaultValue:"已打开不启用 X11 的普通终端"})
        : tr("common:x11.graphical_terminal_opened", {defaultValue:"已打开 X11 图形终端"}), "success");
  }
  return openedKey;
}

async function openX11Terminal(connectionId, mode="untrusted") {
  return openTerminalWithX11Mode(connectionId, mode);
}

let xServerModalKeyHandler = null;
let xServerManagerConnectionId = 0;
let xServerManagerTerminalKey = "";
let xServerManagerRequestId = 0;
let xServerManagerOpening = false;

function activeXServerManagerContext() {
  const tabKey = String(typeof activeTabKey === "undefined" ? "" : activeTabKey || "");
  const session = typeof terminalSessions === "undefined" ? null : terminalSessions.get(tabKey);
  const sessionConnection = session?.connection;
  if (sessionConnection) {
    return {connectionId:Number(sessionConnection.id || 0), terminalKey:tabKey};
  }
  const tab = typeof workspaceTabByKey === "function"
    ? workspaceTabByKey(tabKey)
    : (typeof tabs === "undefined" ? null : tabs.find(item => item.key === tabKey));
  if (tab?.kind === "remote-desktop") {
    const profile = typeof remoteProfileById === "function" ? remoteProfileById(Number(tab.id || 0)) : null;
    const managementId = typeof linuxDesktopManagerConnectionIdForProfile === "function" ? linuxDesktopManagerConnectionIdForProfile(profile) : 0;
    return managementId ? {connectionId:Number(managementId), terminalKey:""} : {connectionId:0, terminalKey:""};
  }
  const connectionId = Number(tab?.id || 0);
  const sshOwnedTab = ["terminal", "quick-terminal", "sftp", "edit", "linux-desktop"].includes(String(tab?.kind || ""));
  return sshOwnedTab && currentConnection(connectionId)
    ? {connectionId, terminalKey:""}
    : {connectionId:0, terminalKey:""};
}

function closeXServerManager() {
  xServerManagerRequestId += 1;
  xServerManagerOpening = false;
  if (xServerModalKeyHandler) document.removeEventListener("keydown", xServerModalKeyHandler);
  xServerModalKeyHandler = null;
  const modal = $("modal");
  modal.onclick = null;
  modal.dataset.xServerManager = "";
  modal.hidden = true;
  modal.innerHTML = "";
}

function showXServerManagerLoading() {
  const modal = $("modal");
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  const title = tr("common:x11.local_xserver_title", {defaultValue:"本机 X Server"});
  modal.dataset.xServerManager = "1";
  modal.innerHTML = `<div class="modal-card xserver-manager" role="dialog" aria-modal="true" aria-labelledby="xServerManagerTitle">
    <div class="modal-title-row"><div><h2 id="xServerManagerTitle">${esc(title)}</h2><span class="muted">${esc(tr("common:x11.loading_context", {defaultValue:"正在读取本机与当前 SSH 上下文"}))}</span></div><button class="icon-button" type="button" onclick="closeXServerManager()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
    <div class="xserver-state loading"><span>${icon("loader-circle")}</span><div><b>${esc(tr("common:x11.opening_manager", {defaultValue:"正在打开 X Server 管理"}))}</b><small>${esc(tr("common:x11.checking_context", {defaultValue:"正在检查桌面授权、DISPLAY 和 SSH X11 转发状态..."}))}</small></div></div>
  </div>`;
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();
}

function xServerModeLabel(value) {
  const labels = {
    bundled:tr("common:x11.mode_bundled", {defaultValue:"Terma 内置"}),
    system:tr("common:x11.mode_system", {defaultValue:"系统组件"}),
    native:tr("common:x11.mode_native", {defaultValue:"本机桌面会话"}),
    missing:tr("common:auto.not_installed", {defaultValue:"未安装"})
  };
  return labels[value] || value || tr("common:auto.unknown", {defaultValue:"未知"});
}

async function renderXServerManager(requestId=0) {
  const diagnosticsPromise = api("/api/xserver");
  const modal = $("modal");
  const connection = xServerManagerConnectionId ? currentConnection(xServerManagerConnectionId) : null;
  const quickConnection = Boolean(connection?.quick_connection);
  const sshX11Promise = connection ? api(`/api/connections/${Number(connection.id)}/x11-forwarding`).catch(error => ({
    error:error.message || tr("common:x11.forwarding_probe_failed", {defaultValue:"SSH X11 配置探测失败"}),
    code:error.code || "",
    connectionId:Number(error.connectionId || connection.id)
  })) : Promise.resolve(null);
  const x11ClipboardPromise = connection ? api(`/api/connections/${Number(connection.id)}/x11-clipboard/helper`).catch(error => ({
    error:error.message || tr("common:x11.clipboard_detection_failed", {defaultValue:"X11 图片剪贴板探测失败"}),
    code:error.code || "",
    connectionId:Number(error.connectionId || connection.id)
  })) : Promise.resolve(null);
  const [diagnostics, sshX11, x11Clipboard] = await Promise.all([diagnosticsPromise, sshX11Promise, x11ClipboardPromise]);
  if (requestId && requestId !== xServerManagerRequestId) return false;
  if (requestId && modal.dataset.xServerManager !== "1") return false;
  const authorizationRequired = Boolean(diagnostics.authorization_required);
  const localDirectAuthorized = diagnostics.authorization_kind === "local-direct";
  const standaloneBackend = diagnostics.integration_available === false && !diagnostics.desktop_backend_available;
  const integrationUnavailable = authorizationRequired || standaloneBackend;
  const integrationUnavailableReason = xServerReasonText(diagnostics, standaloneBackend
    ? tr("common:x11.standalone_backend_unavailable", {defaultValue:"当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server"})
    : tr("common:x11.browser_integration_unauthorized", {defaultValue:"当前浏览器会话没有桌面集成权限"}));
  const serverSide = diagnostics.server_side || {};
  const installLabel = diagnostics.platform === "linux"
    ? tr("common:x11.install_linux_graphical_components", {defaultValue:"安装 Linux 图形组件"})
    : tr("common:x11.install_xquartz_local", {defaultValue:"安装 XQuartz"});
  const defaultX11Mode = connection?.x11_mode === "trusted" ? "trusted" : connection?.x11_mode === "untrusted" ? "untrusted" : "off";
  const temporaryX11Label = tr("common:x11.open_temporary_terminal", {defaultValue:"临时打开 X11 终端"});
  const defaultEnableLabel = tr("common:x11.default_enable", {defaultValue:"普通终端默认启用"});
  const defaultDisableLabel = tr("common:x11.default_disable", {defaultValue:"关闭普通终端默认 X11"});
  const linuxX11Action = !integrationUnavailable && diagnostics.platform === "linux" && connection
    ? `<button class="primary" type="button" onclick="openX11TerminalFromManager(${Number(connection.id)})">${icon("square-terminal")}<span>${esc(temporaryX11Label)}</span></button>${quickConnection ? "" : `<button type="button" onclick="changeConnectionDefaultX11(${Number(connection.id)},'${defaultX11Mode === "off" ? "trusted" : "off"}',this)">${icon(defaultX11Mode === "off" ? "badge-check" : "circle-off")}<span>${esc(defaultX11Mode === "off" ? defaultEnableLabel : defaultDisableLabel)}</span></button>`}`
    : "";
  const linuxHint = !integrationUnavailable && diagnostics.platform === "linux"
    ? `<div class="connection-test-status">${quickConnection
      ? esc(tr("common:x11.quick_display_ready", {name:connection.name, defaultValue:`本机 DISPLAY 已就绪；“${connection.name}”是临时连接，可临时打开 X11 终端，但不会保存默认 X11 配置。`}))
      : connection
        ? defaultX11Mode === "off"
          ? esc(tr("common:x11.display_ready_default_off", {name:connection.name, defaultValue:`本机 DISPLAY 已就绪；“${connection.name}”的普通终端尚未默认请求 X11，可临时打开或保存为默认。`}))
          : esc(tr("common:x11.display_ready_default_mode", {name:connection.name, mode:defaultX11Mode === "trusted" ? tr("common:auto.trusted_x11", {defaultValue:"可信 X11"}) : tr("common:auto.untrusted_x11", {defaultValue:"受限 X11"}), defaultValue:`“${connection.name}”的普通终端已默认使用${defaultX11Mode === "trusted" ? "可信" : "受限"} X11，可直接运行 Java GUI 等图形程序。`}))
        : esc(tr("common:x11.display_ready_no_connection", {defaultValue:"本机 DISPLAY 已就绪；SSH 普通终端是否转发图形窗口取决于对应连接保存的 X11 模式。"}))}</div>`
    : "";
  const sshX11Block = renderSshX11ForwardingPanel(connection, sshX11);
  const x11ClipboardBlock = renderX11ClipboardHelperPanel(connection, x11Clipboard);
  const stateTitle = authorizationRequired
    ? tr("common:x11.state_waiting_authorization", {defaultValue:"等待桌面授权"})
    : standaloneBackend
      ? tr("common:x11.state_integration_unavailable", {defaultValue:"桌面集成不可用"})
      : diagnostics.available
        ? tr("common:auto.ready", {defaultValue:"已就绪"})
        : diagnostics.platform === "linux" && !diagnostics.display
          ? tr("common:x11.state_no_display", {defaultValue:"未检测到桌面显示会话"})
          : diagnostics.running
            ? tr("common:auto.running", {defaultValue:"正在运行"})
            : diagnostics.installed
              ? tr("common:x11.state_not_started", {defaultValue:"未启动"})
              : tr("common:auto.not_installed", {defaultValue:"未安装"});
  const stateReason = integrationUnavailable
    ? integrationUnavailableReason
    : xServerReasonText(diagnostics, tr("common:x11.reason_xserver_unavailable", {defaultValue:"X Server 当前不可用"}));
  const stateIcon = authorizationRequired ? "shield-alert" : integrationUnavailable ? "monitor-x" : diagnostics.available ? "circle-check" : diagnostics.running ? "circle-pause" : "circle-alert";
  const stateClass = integrationUnavailable ? "warning" : diagnostics.available ? "ready" : diagnostics.running ? "warning" : "";
  const detailRow = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const details = integrationUnavailable
    ? authorizationRequired
      ? `<dl class="xserver-details">${detailRow(tr("common:x11.detail_current_backend", {defaultValue:"当前后端"}), tr("common:x11.detail_terma_desktop_backend", {defaultValue:"Terma 桌面后端"}))}${detailRow(tr("common:x11.detail_browser_session", {defaultValue:"浏览器会话"}), tr("common:x11.detail_browser_not_authorized", {defaultValue:"尚未获得桌面集成授权"}))}${detailRow("X Server", diagnostics.running || diagnostics.available ? tr("common:auto.running", {defaultValue:"正在运行"}) : tr("common:x11.detail_status_limited", {defaultValue:"状态受限"}))}${serverSide.display ? detailRow(tr("common:x11.detail_backend_display", {defaultValue:"后端 DISPLAY"}), serverSide.display) : ""}${detailRow(tr("common:x11.detail_authorization_scope", {defaultValue:"授权范围"}), tr("common:x11.detail_authorization_scope_value", {defaultValue:"仅 X Server 与本机图形调用；时长由申请时选择"}))}</dl>`
      : `<dl class="xserver-details">${detailRow(tr("common:x11.detail_current_backend", {defaultValue:"当前后端"}), tr("common:x11.detail_standalone_backend", {defaultValue:"独立 Web/测试后端"}))}${detailRow(tr("common:x11.detail_desktop_device", {defaultValue:"桌面设备"}), tr("common:x11.detail_xserver_unavailable", {defaultValue:"无法探测 X Server"}))}${serverSide.display ? detailRow(tr("common:x11.detail_backend_display", {defaultValue:"后端 DISPLAY"}), serverSide.display) : ""}${detailRow(tr("common:x11.detail_management_scope", {defaultValue:"管理范围"}), tr("common:x11.detail_terma_desktop_only", {defaultValue:"仅运行 Terma 的桌面设备"}))}</dl>`
    : `<dl class="xserver-details">${detailRow(tr("common:x11.detail_run_mode", {defaultValue:"运行方式"}), xServerModeLabel(diagnostics.mode))}${detailRow("DISPLAY", diagnostics.display || "-")}${localDirectAuthorized ? detailRow(tr("common:x11.detail_browser_permission", {defaultValue:"浏览器权限"}), tr("common:x11.detail_local_auto_authorized", {defaultValue:"本机直连自动授权"})) : ""}${detailRow(tr("common:x11.detail_management_scope", {defaultValue:"管理范围"}), diagnostics.managed ? tr("common:x11.detail_current_session", {defaultValue:"Terma 当前会话"}) : tr("common:x11.detail_system_session", {defaultValue:"系统或桌面会话"}))}${["win32","darwin"].includes(diagnostics.platform) ? detailRow(tr("common:x11.detail_next_start", {defaultValue:"下次启动"}), diagnostics.auto_start === false ? tr("common:x11.detail_keep_closed", {defaultValue:"保持关闭"}) : tr("common:x11.detail_auto_start", {defaultValue:"自动启动"})) : ""}</dl>`;
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  const managerTitle = tr("common:x11.local_xserver_title", {defaultValue:"本机 X Server"});
  const managerSubtitle = authorizationRequired
    ? tr("common:x11.browser_not_authorized", {defaultValue:"当前浏览器尚未授权"})
    : standaloneBackend
      ? tr("common:x11.standalone_backend", {defaultValue:"独立 Web/测试后端"})
      : localDirectAuthorized
        ? tr("common:x11.local_direct_authorized", {defaultValue:"本机直连自动授权"})
        : diagnostics.server || xServerModeLabel(diagnostics.mode);
  const autoStartHint = tr("common:x11.auto_start_hint", {defaultValue:"自动启动只会启动已经存在的本机 X Server。Windows 源码启动会准备 Terma 内置运行时；Linux 和 macOS 的系统组件需要在此单独确认安装。"});
  const refreshLabel = tr("common:auto.refresh", {defaultValue:"刷新"});
  const stopLabel = tr("common:auto.stop", {defaultValue:"停止"});
  const startLabel = tr("common:auto.start", {defaultValue:"启动"});
  modal.innerHTML = `<div class="modal-card xserver-manager" role="dialog" aria-modal="true" aria-labelledby="xServerManagerTitle">
    <div class="modal-title-row"><div><h2 id="xServerManagerTitle">${esc(managerTitle)}</h2><span class="muted">${esc(managerSubtitle)}</span></div><button class="icon-button" type="button" onclick="closeXServerManager()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
    <div class="xserver-state ${stateClass}"><span>${icon(stateIcon)}</span><div><b>${esc(stateTitle)}</b><small>${esc(stateReason)}</small></div></div>
    ${details}
    ${desktopIntegrationAuthorizationMarkup(diagnostics, ["xserver"], {refreshTarget:"xserver"})}
    ${!integrationUnavailable ? `<div class="connection-test-status">${esc(autoStartHint)}</div>` : ""}
    ${linuxHint}
    ${sshX11Block}
    ${x11ClipboardBlock}
    <div class="actions"><button type="button" onclick="renderXServerManager()">${icon("refresh-cw")}<span>${esc(refreshLabel)}</span></button>${!integrationUnavailable && diagnostics.can_stop ? `<button type="button" onclick="changeXServerState('stop',this)">${icon("square")}<span>${esc(stopLabel)}</span></button>` : ""}${!integrationUnavailable && diagnostics.can_install ? `<button class="primary" type="button" onclick="installXServerComponentsFromManager(this,'${escAttr(diagnostics.platform || "")}')">${icon("download")}<span>${esc(installLabel)}</span></button>` : ""}${!integrationUnavailable && diagnostics.can_start ? `<button class="primary" type="button" onclick="changeXServerState('start',this)">${icon("play")}<span>${esc(startLabel)}</span></button>` : ""}${linuxX11Action}</div>
  </div>`;
  modal.hidden = false;
  modal.dataset.xServerManager = "1";
  refreshIcons();
  if (connection) {
    const actionKey = x11ForwardingActionKey(connection.id);
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
    const componentsActionKey = x11ComponentsActionKey(connection.id);
    syncUiActionControls(componentsActionKey, isUiActionInFlight(componentsActionKey));
    const clipboardActionKey = x11ClipboardActionKey(connection.id);
    syncUiActionControls(clipboardActionKey, isUiActionInFlight(clipboardActionKey));
  }
  return true;
}

async function inspectSshX11Forwarding(connectionId, source="xserver") {
  xServerManagerConnectionId = Number(connectionId || xServerManagerConnectionId || 0);
  try {
    if (source === "linux-desktop") await loadLinuxDesktopManager();
    else await renderXServerManager();
  } catch (error) { notify(error.message || tr("common:x11.forwarding_probe_failed", {defaultValue:"SSH X11 配置探测失败"}), "error"); }
}

async function repairX11ManagerCredentials(connectionId, source="xserver") {
  const id = Number(connectionId || 0);
  if (typeof repairSshCredentials !== "function" || id < 1) return false;
  const render = async () => {
    if (source === "linux-desktop") await loadLinuxDesktopManager();
    else {
      xServerManagerConnectionId = id;
      await renderXServerManager();
    }
  };
  const repaired = await repairSshCredentials(id, {
    context:tr("common:x11.management_auth_failed", {defaultValue:"X11 管理认证失败"}),
    onSaved:render
  });
  if (!repaired) await render().catch(() => {});
  return repaired;
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("x11-credential-repair", ({element}) => repairX11ManagerCredentials(
    Number(element.dataset.connectionId || 0),
    element.dataset.source || "xserver"
  ));
  registerTermaAction("x11-quick-credential-repair", ({element}) => {
    const key = element.dataset.terminalKey || xServerManagerTerminalKey || "";
    const session = terminalSessions.get(key);
    closeXServerManager();
    return session?.connection ? repairTerminalCredentials(session.connection, key) : false;
  });
}

async function changeSshX11Forwarding(action, button, connectionId, source="xserver") {
  const enabled = action === "enable";
  const actionKey = x11ForwardingActionKey(connectionId);
  const busyLabel = enabled
    ? tr("common:x11.enabling", {defaultValue:"开启中..."})
    : tr("common:x11.disabling", {defaultValue:"关闭中..."});
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify(tr("common:x11.forwarding_task_running", {defaultValue:"SSH X11 转发任务正在执行，请等待完成"}), "info");
    return null;
  }
  const message = enabled
    ? tr("common:x11.enable_forwarding_confirm", {defaultValue:"将备份并修改远端 sshd_config，开启 X11Forwarding，然后尝试重新加载 SSH 服务。是否继续？"})
    : tr("common:x11.disable_forwarding_confirm", {defaultValue:"将关闭远端 sshd_config 的 X11Forwarding。已有 SSH 会话不受影响，新会话将不能使用 X11。是否继续？"});
  const title = enabled
    ? tr("common:x11.enable_ssh_forwarding", {defaultValue:"开启 SSH X11 转发"})
    : tr("common:x11.disable_ssh_forwarding", {defaultValue:"关闭 SSH X11 转发"});
  try {
    if (!await confirmModal(
      message,
      title,
      enabled ? tr("common:auto.enable", {defaultValue:"开启"}) : tr("common:auto.disable", {defaultValue:"关闭"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      enabled ? false : true
    )) return null;
    let adminAuth = null;
    setButtonBusy(button, true, busyLabel);
    const diagnostics = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`);
    if (!diagnostics.can_manage) {
      adminAuth = await requestRemoteAdminAuthorization(Number(connectionId), title, "x11.sshd-config");
      if (!adminAuth) return;
    }
    const result = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`, {method:"POST", body:JSON.stringify({action, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const requestAccepted = notifyRemoteComponentTaskRequest(result, title, enabled
        ? tr("common:x11.enable_forwarding_queued", {defaultValue:"SSH X11 转发开启已加入任务中心"})
        : tr("common:x11.disable_forwarding_queued", {defaultValue:"SSH X11 转发关闭已加入任务中心"}));
      const task = await watchRemoteComponentTask(result.task, {title});
      if (String(task?.status || "").toLowerCase() !== "done") throw new Error(task?.error || tr("common:x11.forwarding_task_failed", {defaultValue:"SSH X11 转发任务执行失败"}));
      if (!requestAccepted) {
        if (source === "linux-desktop") await loadLinuxDesktopManager();
        else await renderXServerManager();
        return null;
      }
    }
    notify(enabled
      ? tr("common:x11.forwarding_enabled", {defaultValue:"SSH X11 转发已开启"})
      : tr("common:x11.forwarding_disabled", {defaultValue:"SSH X11 转发已关闭"}), "success");
    if (source === "linux-desktop") await loadLinuxDesktopManager();
    else await renderXServerManager();
  } catch (error) {
    notify(error.message || tr("common:x11.forwarding_config_failed", {defaultValue:"SSH X11 转发配置失败"}), "error");
    if (source === "linux-desktop") await loadLinuxDesktopManager().catch(() => {});
    else await renderXServerManager().catch(() => {});
  } finally {
    endUiAction(actionKey, button);
  }
}

async function openSshX11ConfigureTerminal(connectionId, action, source="xserver") {
  const connection = currentConnection(Number(connectionId));
  if (!connection) return notify(tr("common:x11.connection_missing", {defaultValue:"SSH 连接不存在"}), "error");
  try {
    const diagnostics = await api(`/api/connections/${Number(connectionId)}/x11-forwarding`);
    const command = String(diagnostics.terminal_commands?.[action] || "").trim();
    if (!command) throw new Error(tr("common:x11.interactive_command_missing", {defaultValue:"当前主机没有可用的交互式 X11 配置命令"}));
    if (connection.quick_connection) {
      const terminalKey = xServerManagerTerminalKey || [...terminalSessions.entries()].find(([, session]) => Number(session?.connection?.id) === Number(connectionId))?.[0] || "";
      const session = terminalSessions.get(terminalKey);
      if (!session?.connected) throw new Error(tr("common:x11.quick_terminal_config_not_connected", {defaultValue:"当前临时终端尚未连接，无法放入配置命令"}));
      if (source === "xserver" && !$("modal")?.hidden) closeXServerManager();
      if (typeof activateTab === "function") activateTab(terminalKey);
      if (!sendTerminalData(terminalKey, command, {focus:true})) throw new Error(tr("common:x11.quick_terminal_write_failed", {defaultValue:"无法写入当前临时终端"}));
      notify(tr("common:x11.config_command_sent", {defaultValue:"配置命令已放入当前临时终端，请确认内容后按 Enter 执行"}), "info");
      return;
    }
    const next = nextTerminalTabIndex(connection.id);
    const key = `terminal-${connection.id}-${next}`;
    const label = action === "enable"
      ? tr("common:x11.enable_ssh_forwarding", {defaultValue:"开启 X11 转发"})
      : tr("common:x11.disable_ssh_forwarding", {defaultValue:"关闭 X11 转发"});
    const finishedMessage = tr("common:x11.config_terminal_finished", {action:label, defaultValue:`Terma：${label}命令已结束（退出码 %s）。`});
    const startupCommand = `${command}; terma_status=$?; ${x11ShellPrintfLine(finishedMessage, "$terma_status")}; exec "${'${SHELL:-/bin/sh}'}"`;
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
    notify(tr("common:x11.config_terminal_opened", {defaultValue:"已打开配置终端；出现 sudo 提示时请输入远端账号密码"}), "info");
  } catch (error) {
    notify(error.message || tr("common:x11.config_terminal_open_failed", {defaultValue:"打开 X11 配置终端失败"}), "error");
  }
}

async function openRemoteXQuartzInstall(connectionId) {
  if (!$('modal')?.hidden) closeXServerManager();
  await openX11InstallGuide(Number(connectionId));
}

async function openRemoteX11ComponentsInstall(connectionId) {
  if (!$('modal')?.hidden) closeXServerManager();
  await openX11InstallGuide(Number(connectionId));
}

async function installXServerComponentsFromManager(button, platform) {
  const linux = platform === "linux";
  const message = linux
    ? tr("common:x11.install_linux_components_confirm", {defaultValue:"将使用当前 Linux 系统的软件包管理器安装 Xephyr、FreeRDP 和缺少的 X11 授权组件。普通用户会出现系统管理员授权窗口。"})
    : tr("common:x11.install_local_xquartz_confirm", {defaultValue:"将从 XQuartz 官方发布页下载安装包，校验 SHA-256、Apple 公证和开发者签名后调用 macOS 管理员授权窗口。"});
  const title = linux
    ? tr("common:x11.install_linux_components_title", {defaultValue:"安装 Linux 图形组件"})
    : tr("common:x11.install_local_xquartz_title", {defaultValue:"安装 XQuartz"});
  if (!await confirmModal(message, title, tr("common:actions.install", {defaultValue:"安装"}), tr("common:actions.cancel", {defaultValue:"取消"}))) return;
  try {
    setButtonBusy(button, true, tr("common:auto.installing", {defaultValue:"安装中..."}));
    const result = await api("/api/xserver/install", {method:"POST", body:"{}"});
    notify(linux
      ? tr("common:x11.linux_components_installed", {defaultValue:"Linux 图形组件已安装，可使用 RDP 和 XDMCP"})
      : result.restart_required
        ? tr("common:x11.xquartz_installed_restart", {defaultValue:"XQuartz 已安装，请退出并重新登录 macOS 后使用 X11"})
        : tr("common:x11.xquartz_installed", {defaultValue:"XQuartz 已安装"}), "success");
    await renderXServerManager();
  } catch (error) {
    notify(error.message || tr("common:x11.local_component_install_failed", {title, defaultValue:"{{title}}失败"}), "error");
    await renderXServerManager().catch(() => {});
  }
}

async function openXServerManager(connectionId=0, terminalKey="") {
  if (xServerManagerOpening || ($("modal")?.dataset.xServerManager === "1" && !$('modal')?.hidden)) return false;
  const requestId = ++xServerManagerRequestId;
  xServerManagerOpening = true;
  try {
    const explicitConnectionId = Number(connectionId || 0);
    const context = explicitConnectionId
      ? {connectionId:explicitConnectionId, terminalKey:String(terminalKey || "")}
      : activeXServerManagerContext();
    xServerManagerConnectionId = Number(context.connectionId || 0);
    xServerManagerTerminalKey = String(context.terminalKey || "");
    showXServerManagerLoading();
    const modal = $("modal");
    modal.onclick = null;
    if (xServerModalKeyHandler) document.removeEventListener("keydown", xServerModalKeyHandler);
    xServerModalKeyHandler = event => { if (event.key === "Escape") closeXServerManager(); };
    document.addEventListener("keydown", xServerModalKeyHandler);
    await renderXServerManager(requestId);
    return true;
  } catch (error) {
    if (requestId !== xServerManagerRequestId) return false;
    const modal = $("modal");
    const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
    const retryLabel = tr("common:actions.retry", {defaultValue:"重试"});
    const title = tr("common:x11.local_xserver_title", {defaultValue:"本机 X Server"});
    const failedLabel = tr("common:x11.status_read_failed", {defaultValue:"状态读取失败"});
    const errorText = error.message || tr("common:x11.server_status_failed", {defaultValue:"X Server 状态读取失败"});
    modal.dataset.xServerManager = "1";
    modal.innerHTML = `<div class="modal-card xserver-manager" role="dialog" aria-modal="true"><div class="modal-title-row"><div><h2>${esc(title)}</h2><span class="muted">${esc(failedLabel)}</span></div><button class="icon-button" type="button" onclick="closeXServerManager()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div><div class="connection-test-status remote-diagnostic-status error"><span class="remote-diagnostic-icon">${icon("circle-alert")}</span><span class="remote-diagnostic-copy">${esc(errorText)}</span><span class="remote-diagnostic-actions"><button type="button" onclick="closeXServerManager();openXServerManager(${Number(xServerManagerConnectionId)},'${escAttr(xServerManagerTerminalKey)}')">${icon("refresh-cw")}<span>${esc(retryLabel)}</span></button></span></div></div>`;
    modal.hidden = false;
    refreshIcons();
    notify(error.message || tr("common:x11.server_status_failed", {defaultValue:"X Server 状态读取失败"}), "error");
    return false;
  } finally {
    if (requestId === xServerManagerRequestId) xServerManagerOpening = false;
  }
}

async function openX11TerminalFromManager(connectionId) {
  const connection = currentConnection(Number(connectionId));
  const quickTerminalKey = xServerManagerTerminalKey;
  closeXServerManager();
  if (connection?.quick_connection) {
    const terminalKey = quickTerminalKey || [...terminalSessions.entries()].find(([, session]) => Number(session?.connection?.id) === Number(connectionId))?.[0] || "";
    return openQuickX11Terminal(terminalKey, "untrusted");
  }
  await openX11Terminal(connectionId, "untrusted");
}

async function changeConnectionDefaultX11(connectionId, mode, button) {
  try {
    setButtonBusy(button, true, tr("common:auto.saving", {defaultValue:"保存中..."}));
    await saveConnectionX11Mode(connectionId, mode);
    xServerManagerConnectionId = Number(connectionId);
    await renderXServerManager();
  } catch (error) {
    notify(error.message || tr("common:x11.default_mode_save_failed", {defaultValue:"默认 X11 模式保存失败"}), "error");
    setButtonBusy(button, false);
  }
}

async function changeXServerState(action, button) {
  if (action === "stop" && !await confirmModal(
    tr("common:x11.stop_server_confirm", {defaultValue:"停止 X Server 会同时关闭由它显示的 X11/XDMCP 图形窗口，并在下次启动 Terma 时保持关闭。"}),
    tr("common:x11.stop_server_title", {defaultValue:"停止 X Server"}),
    tr("common:auto.stop", {defaultValue:"停止"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return;
  try {
    setButtonBusy(button, true, action === "start"
      ? tr("common:x11.starting_server", {defaultValue:"启动中"})
      : tr("common:x11.stopping_server", {defaultValue:"停止中"}));
    await api("/api/xserver", {method:action === "start" ? "POST" : "DELETE", body:"{}"});
    notify(action === "start"
      ? tr("common:x11.server_started", {defaultValue:"X Server 已启动，并会在下次自动启动"})
      : tr("common:x11.server_stopped", {defaultValue:"X Server 已停止，并会在下次保持关闭"}), "success");
    await renderXServerManager();
  } catch (error) {
    notify(error.message || (action === "start"
      ? tr("common:x11.server_start_failed", {defaultValue:"X Server 启动失败"})
      : tr("common:x11.server_stop_failed", {defaultValue:"X Server 停止失败"})), "error");
    await renderXServerManager().catch(() => {});
  }
}

async function saveConnectionX11Mode(connectionId, mode) {
  await persistConnectionX11Mode(connectionId, mode);
  const modeLabel = mode === "trusted"
    ? tr("common:auto.trusted_x11", {defaultValue:"可信 X11"})
    : tr("common:auto.untrusted_x11", {defaultValue:"受限 X11"});
  notify(mode === "off"
    ? tr("common:x11.default_forwarding_disabled", {defaultValue:"已关闭默认 X11 转发，下次连接生效"})
    : tr("common:x11.default_mode_saved", {mode:modeLabel, defaultValue:`已保存默认 X11 模式：${modeLabel}，下次连接生效`}), "success");
}

async function persistConnectionX11Mode(connectionId, mode) {
  await api(`/api/connections/${connectionId}/x11-mode`, {method:"POST", body:JSON.stringify({mode})});
  await loadAll();
}
