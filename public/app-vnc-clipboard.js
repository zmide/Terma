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
    const connectionId = Number($("modal")?.querySelector("#vncClipboardSshConnection")?.value || session.profile.options?.source_ssh_connection_id || 0);
    const repair = connectionId > 0 && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)
      ? `<button type="button" data-action="vnc-clipboard-credential-repair" data-vnc-key="${escAttr(session.key)}" data-connection-id="${connectionId}">${icon("key-round")}<span>修复 SSH 凭据</span></button>`
      : "";
    container.innerHTML = remoteDiagnosticStatusMarkup(error.message || "剪贴板辅助探测失败", {tone:"error", icon:"circle-alert", title:"SSH 剪贴板辅助不可用", actions:repair});
    refreshIcons();
    return null;
  }
}

async function repairVncClipboardCredentials(key, connectionId) {
  const session = vncSessions.get(String(key || ""));
  const id = Number(connectionId || 0);
  if (!session || id < 1 || typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(id, {
    context:"VNC 剪贴板辅助认证失败",
    onSaved:async () => configureVncClipboardSsh(session.key)
  });
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("vnc-clipboard-credential-repair", ({element}) => repairVncClipboardCredentials(
    element.dataset.vncKey || "",
    Number(element.dataset.connectionId || 0)
  ));
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
