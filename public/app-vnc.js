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
  if (!requireConfigEncryptionUnlocked("保存 VNC 密码")) throw new Error("配置加密已锁定");
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
    const scopes = profile?.protocol === "xdmcp" ? ["remote-client", "xserver"] : ["remote-client"];
    if (!await ensureDesktopIntegrationAuthorized(scopes)) return null;
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
    if (!await ensureDesktopIntegrationAuthorized(protocol === "xdmcp" ? ["remote-client", "xserver"] : ["remote-client"])) return null;
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
