function vncClipboardDefaultStatus(session) {
  if (session?.clipboardBridgeError) return {text:tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), state:"error"};
  if (session?.clipboardAutoSync) return {text:vncClipboardUsesSsh(session?.clipboardTransport) ? tr("remote:clipboard.auto_sync_ssh", {defaultValue:"剪贴板：自动同步（SSH）"}) : tr("remote:clipboard.auto_sync", {defaultValue:"剪贴板：自动同步"}), state:"active"};
  if (session?.clipboardPermissionBlocked) return {text:tr("remote:clipboard.permission_limited", {defaultValue:"剪贴板权限受限"}), state:"error"};
  if (vncClipboardUsesSsh(session?.clipboardTransport)) return {text:tr("remote:clipboard.ssh_helper_status", {defaultValue:"剪贴板：SSH 辅助"}), state:""};
  return {text:tr("remote:clipboard.manual", {defaultValue:"剪贴板：手动"}), state:""};
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
  session.clipboardSendImageButton = workspace.querySelector("[data-vnc-clipboard-send-image]") || session.clipboardSendImageButton;
  session.clipboardReceiveImageButton = workspace.querySelector("[data-vnc-clipboard-receive-image]") || session.clipboardReceiveImageButton;
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
    status.title = tr("remote:clipboard.status_setup_hint", {status:localizedRemoteTaskText(session.clipboardBridgeError) || status.textContent, connection:connectionName, defaultValue:`${session.clipboardBridgeError || status.textContent}${connectionName} · 点击设置 SSH 剪贴板辅助`});
    status.classList.toggle("clickable", true);
  }
  const syncButton = session.clipboardSyncButton;
  if (syncButton) {
    syncButton.classList.toggle("active", Boolean(session.clipboardAutoSync));
    syncButton.setAttribute("aria-pressed", session.clipboardAutoSync ? "true" : "false");
    syncButton.title = session.clipboardAutoSync
      ? session.clipboardAutoSyncImages
        ? tr("remote:clipboard.disable_auto_sync_with_images", {defaultValue:"关闭文本和图片自动同步"})
        : tr("remote:clipboard.disable_auto_sync", {defaultValue:"关闭剪贴板自动同步"})
      : session.clipboardAutoSyncImages
        ? tr("remote:clipboard.enable_auto_sync_with_images", {defaultValue:"开启文本和图片自动同步"})
        : tr("remote:clipboard.enable_auto_sync", {defaultValue:"开启剪贴板自动同步"});
    syncButton.setAttribute("aria-label", syncButton.title);
  }
  const helperButton = session.clipboardHelperButton;
  if (helperButton) {
    const active = vncClipboardUsesSsh(session.clipboardTransport);
    helperButton.classList.toggle("active", active);
    helperButton.classList.toggle("attention", Boolean(session.clipboardBridgeError));
    helperButton.title = active
      ? tr("remote:clipboard.helper_enabled_named", {connection:session.clipboardBridgeConnectionName ? `: ${session.clipboardBridgeConnectionName}` : "", defaultValue:`SSH 剪贴板辅助已启用${session.clipboardBridgeConnectionName ? `：${session.clipboardBridgeConnectionName}` : ""}`})
      : localizedRemoteTaskText(session.clipboardBridgeError) || tr("remote:clipboard.configure_helper", {defaultValue:"设置 SSH 剪贴板辅助"});
    helperButton.setAttribute("aria-label", helperButton.title);
  }
  const receiveButton = session.clipboardReceiveButton;
  if (receiveButton) {
    receiveButton.disabled = !session.remoteClipboardAvailable && !vncClipboardBridgeCandidate(session);
    receiveButton.classList.toggle("attention", Boolean(session.remoteClipboardAvailable && session.remoteClipboardPending));
    receiveButton.title = session.remoteClipboardAvailable
      ? tr("remote:clipboard.read_recent_remote", {defaultValue:"读取最近收到的远端剪贴板"})
      : vncClipboardBridgeCandidate(session) ? tr("remote:clipboard.read_remote_ssh", {defaultValue:"通过 SSH 读取远端系统剪贴板"}) : tr("remote:clipboard.remote_not_sent", {defaultValue:"远端尚未发送剪贴板"});
    receiveButton.setAttribute("aria-label", receiveButton.title);
  }
  const imageAvailable = vncClipboardImageTransportAvailable(session);
  for (const button of [session.clipboardSendImageButton, session.clipboardReceiveImageButton]) {
    if (!button) continue;
    button.disabled = !imageAvailable || !session.connected;
    button.classList.toggle("attention", Boolean(session.clipboardBridgeError));
    button.title = imageAvailable
      ? (button === session.clipboardSendImageButton ? tr("remote:clipboard.send_local_image", {defaultValue:"发送本机剪贴板图片"}) : tr("remote:clipboard.read_remote_image", {defaultValue:"读取远端剪贴板图片"}))
      : tr("common:x11.clipboard_requires_helper", {defaultValue:"图片剪贴板需要 SSH 辅助和 xclip/wl-clipboard"});
    button.setAttribute("aria-label", button.title);
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
      const label = tr("remote:clipboard.connection_option", {name:connection.name, user:connection.ssh_user, host:connection.ssh_host, port:connection.ssh_port || 22, sameHost:sameHost ? tr("remote:clipboard.same_host_suffix", {defaultValue:" · 同主机"}) : "", defaultValue:`${connection.name} · ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}${sameHost ? " · 同主机" : ""}`});
      return `<option value="${Number(connection.id)}" ${Number(connection.id) === selectedId ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");
    modal.hidden = false;
    const closeLabel = tr("remote:clipboard.close", {defaultValue:"关闭"});
    modal.innerHTML = `<form class="modal-card vnc-clipboard-modal vnc-clipboard-helper-modal">
      <div class="modal-title-row"><div><h2>${esc(tr("remote:clipboard.helper_title", {defaultValue:"SSH 剪贴板辅助"}))}</h2><span class="muted">${esc(session.profile.name)} · ${esc(session.profile.host)}</span></div><button class="icon-button" type="button" data-vnc-clipboard-helper-cancel title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      <div class="connection-test-status">${esc(tr("remote:clipboard.protocol_explanation", {defaultValue:"VNC 的旧剪贴板协议只能可靠传输 Latin-1。关联 SSH 后，Terma 会直接读写远端系统剪贴板，中文使用 UTF-8 传输。"}))}</div>
      ${matches.length ? `<div class="connection-test-status success">${esc(tr("remote:clipboard.matches_found", {count:matches.length, name:matches[0].name || matches[0].ssh_host, defaultValue:`已找到 ${matches.length} 个同主机 SSH 连接，默认选择 ${matches[0].name || matches[0].ssh_host}。`}))}</div>` : `<div class="connection-test-status warning">${esc(tr("remote:clipboard.no_match", {defaultValue:"没有自动找到同主机 SSH。可以选择其他能管理此桌面会话的 SSH 连接。"}))}</div>`}
      <label>${esc(tr("remote:clipboard.ssh_connection", {defaultValue:"SSH 辅助连接"}))}</label><select id="vncClipboardSshConnection" onchange="inspectVncClipboardHelper(vncSessions.get('${escAttr(session.key)}'),document.querySelector('#vncClipboardHelperState'))"><option value="0">${esc(tr("remote:clipboard.match_same_host", {defaultValue:"自动匹配同主机"}))}</option>${optionRows}</select>
      <div class="muted">${esc(tr("remote:clipboard.platform_tools_hint", {defaultValue:"Linux 远端需要 xclip/xsel（X11）或 wl-clipboard（Wayland）；macOS 已自带 pbcopy/pbpaste，不会安装 Linux 软件包。"}))}</div>
      <div id="vncClipboardHelperState" class="vnc-clipboard-helper-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>${esc(tr("remote:clipboard.detecting_helper", {defaultValue:"正在识别远端系统和剪贴板辅助工具"}))}</span></div></div>
      <div class="actions"><button type="button" data-vnc-clipboard-helper-cancel>${esc(tr("remote:clipboard.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${esc(tr("remote:clipboard.save_detect", {defaultValue:"保存并检测"}))}</button></div></form>`;
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
    note:localizedRemoteTaskText(guide.summary) || tr("remote:clipboard.return_detect", {defaultValue:"安装或检查完成后，返回此窗口重新检测。"})
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
    session.clipboardBridgeTool = String(diagnostics.tool || "");
    session.clipboardBridgeResolvedBy = String(diagnostics.resolved_by || "");
    session.clipboardBridgeError = "";
    session.clipboardStatusText = "";
    session.clipboardStatusState = "";
  } else if (platform === "linux" && diagnostics.connection_id) {
    session.clipboardTransport = "rfb";
    session.clipboardTransportChecked = true;
    session.clipboardBridgeConnectionId = Number(diagnostics.connection_id || 0);
    session.clipboardBridgeConnectionName = String(diagnostics.connection_name || "");
    session.clipboardBridgeTool = String(diagnostics.tool || "");
    session.clipboardBridgeError = localizedRemoteTaskText(diagnostics.reason) || tr("remote:clipboard.channel_unavailable", {defaultValue:"SSH 剪贴板辅助通道不可用"});
    session.clipboardStatusText = "";
    session.clipboardStatusState = "";
  }
  const platformLabel = platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : tr("remote:clipboard.unknown_platform", {defaultValue:"未识别系统"});
  const tool = diagnostics.tool ? ` · ${diagnostics.tool}` : "";
  const title = available ? tr("remote:clipboard.available_title", {platform:platformLabel, tool, defaultValue:`${platformLabel} 剪贴板辅助可用${tool}`}) : tr("remote:clipboard.unavailable_title", {platform:platformLabel, defaultValue:`${platformLabel} 剪贴板辅助尚不可用`});
  const actionKey = vncClipboardHelperActionKey(session.profile?.id);
  let body = "";
  if (platform === "macos") {
    body = `<div class="connection-test-status ${available ? "success" : "warning"}">${icon(available ? "circle-check" : "circle-alert")}<span>${esc(available ? tr("remote:clipboard.macos_builtin", {defaultValue:"macOS 系统自带 pbcopy/pbpaste，无需安装。"}) : localizedRemoteTaskText(diagnostics.reason) || tr("remote:clipboard.macos_check_session", {defaultValue:"macOS 已自带剪贴板工具，请检查图形登录会话和剪贴板权限。"}))}</span></div>`;
  } else if (platform === "linux" && !available) {
    body = `${remoteInstallModesMarkup(diagnostics.install_plan || {}, mode => `installVncClipboardHelper('${escAttr(session.key)}','${escAttr(mode)}',this)`, "revealRemoteInstallManual(this)", actionKey)}<div class="connection-test-status warning">${icon("info")}<span>${esc(localizedRemoteTaskText(diagnostics.reason) || tr("remote:clipboard.install_matching_tool", {defaultValue:"请安装与当前 X11/Wayland 会话匹配的剪贴板工具。"}))}</span></div>`;
  } else if (available) {
    const uninstallPlan = diagnostics.uninstall_plan || diagnostics.install_plan?.uninstall || {};
    const uninstallAction = platform === "linux" && uninstallPlan.available
      ? `<div class="actions tight"><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="uninstallVncClipboardHelper('${escAttr(session.key)}',this)">${icon("package-minus")}<span>${esc(tr("remote:clipboard.uninstall_helper", {defaultValue:"卸载辅助工具"}))}</span></button></div>`
      : "";
    body = `<div class="connection-test-status success">${icon("circle-check")}<span>${esc(tr("remote:clipboard.unicode_channel_ready", {defaultValue:"SSH Unicode 剪贴板通道已经可用。"}))}</span></div>${uninstallAction}`;
  } else {
    body = `<div class="connection-test-status warning">${icon("circle-alert")}<span>${esc(localizedRemoteTaskText(diagnostics.reason) || tr("remote:clipboard.confirm_remote_system", {defaultValue:"请先确认 SSH 辅助连接对应的远端系统。"}))}</span></div>`;
  }
  const detectAgain = tr("remote:clipboard.detect_again", {defaultValue:"重新检测"});
  container.innerHTML = `<div class="rdp-server-head"><span class="xdmcp-server-icon ${available ? "ready" : "warning"}">${icon(available ? "circle-check" : "circle-alert")}</span><div><b>${esc(title)}</b><small>${esc(diagnostics.connection_name || session.profile.host || "")}</small></div><button class="icon-button" type="button" onclick="inspectVncClipboardHelper(vncSessions.get('${escAttr(session.key)}'),document.querySelector('#vncClipboardHelperState'))" title="${escAttr(detectAgain)}" aria-label="${escAttr(detectAgain)}">${icon("refresh-cw")}</button></div>${body}${vncClipboardHelperManualMarkup(diagnostics)}`;
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
    container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>${esc(tr("remote:clipboard.detecting_helper", {defaultValue:"正在识别远端系统和剪贴板辅助工具"}))}</span></div>`;
    refreshIcons();
    const connectionId = Number($("modal")?.querySelector("#vncClipboardSshConnection")?.value || 0);
    const diagnostics = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action:"guide", connection_id:connectionId})});
    renderVncClipboardHelperState(session, diagnostics, container);
    return diagnostics;
  } catch (error) {
    const connectionId = Number($("modal")?.querySelector("#vncClipboardSshConnection")?.value || session.profile.options?.source_ssh_connection_id || 0);
    const repair = connectionId > 0 && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)
      ? `<button type="button" data-action="vnc-clipboard-credential-repair" data-vnc-key="${escAttr(session.key)}" data-connection-id="${connectionId}">${icon("key-round")}<span>${esc(tr("remote:clipboard.repair_ssh_credentials", {defaultValue:"修复 SSH 凭据"}))}</span></button>`
      : "";
    container.innerHTML = remoteDiagnosticStatusMarkup(error.message || tr("remote:clipboard.probe_failed", {defaultValue:"剪贴板辅助探测失败"}), {tone:"error", icon:"circle-alert", title:tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), actions:repair});
    refreshIcons();
    return null;
  }
}

async function repairVncClipboardCredentials(key, connectionId) {
  const session = vncSessions.get(String(key || ""));
  const id = Number(connectionId || 0);
  if (!session || id < 1 || typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(id, {
    context:tr("remote:clipboard.auth_failed", {defaultValue:"VNC 剪贴板辅助认证失败"}),
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
  session.clipboardBridgeTool = "";
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
        session.clipboardBridgeError = error.message || tr("remote:clipboard.task_status_read_failed", {action:uninstalling ? tr("remote:clipboard.uninstall", {defaultValue:"卸载"}) : tr("remote:clipboard.install", {defaultValue:"安装"}), defaultValue:`无法读取剪贴板辅助${uninstalling ? "卸载" : "安装"}状态`});
        setVncClipboardStatus(session, tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), "error");
        if (session.clipboardAutoSync) startVncClipboardPolling(session);
      }
      return;
    }
    if (task.status === "running") continue;
    session.clipboardHelperTaskId = "";
    if (task.status !== "done") {
      session.clipboardBridgeError = remoteTaskErrorLabel(task) || tr("remote:clipboard.task_failed", {action:uninstalling ? tr("remote:clipboard.uninstall", {defaultValue:"卸载"}) : tr("remote:clipboard.install", {defaultValue:"安装"}), defaultValue:`剪贴板辅助工具${uninstalling ? "卸载" : "安装"}失败`});
      setVncClipboardStatus(session, tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), "error");
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
        if (vncClipboardUsesSsh(transport)) throw new Error(tr("remote:clipboard.uninstall_still_detected", {defaultValue:"卸载完成后重新探测仍检测到 SSH 剪贴板辅助工具"}));
        setVncClipboardStatus(session, tr("remote:clipboard.helper_uninstalled", {defaultValue:"SSH 剪贴板辅助已卸载"}), "success", 2600);
        notify(tr("remote:clipboard.uninstall_verified", {defaultValue:"剪贴板辅助工具卸载完成，远端状态已重新探测"}), "success");
      } else {
        if (!vncClipboardUsesSsh(transport)) throw new Error(localizedRemoteTaskText(session.clipboardBridgeError || diagnostics?.reason) || tr("remote:clipboard.install_session_unavailable", {defaultValue:"安装完成，但当前图形会话仍无法访问系统剪贴板"}));
        setVncClipboardStatus(session, tr("remote:clipboard.helper_enabled", {defaultValue:"SSH 剪贴板辅助已启用"}), "success", 2600);
        notify(tr("remote:clipboard.install_verified", {defaultValue:"剪贴板辅助工具安装完成，SSH Unicode 通道已刷新"}), "success");
      }
      if (session.clipboardAutoSync) startVncClipboardPolling(session);
    } catch (error) {
      const actionLabel = uninstalling ? tr("remote:clipboard.uninstall", {defaultValue:"卸载"}) : tr("remote:clipboard.install", {defaultValue:"安装"});
      session.clipboardBridgeError = error.message || tr("remote:clipboard.verify_failed", {action:actionLabel, defaultValue:`${uninstalling ? "卸载" : "安装"}完成，但 SSH 剪贴板辅助状态验证失败`});
      setVncClipboardStatus(session, tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), "error");
      notify(session.clipboardBridgeError, "error");
    }
    return;
  }
}

async function installVncClipboardHelper(key, mode="online", button=null) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify(tr("remote:clipboard.session_missing", {defaultValue:"VNC 会话不存在"}), "error");
  const actionKey = vncClipboardHelperActionKey(session.profile.id);
  if (!beginUiAction(actionKey, button, tr("remote:clipboard.installing", {defaultValue:"安装中..."}))) {
    notify(tr("remote:clipboard.task_running", {defaultValue:"剪贴板辅助工具任务正在执行，请等待完成"}), "info");
    return null;
  }
  const modal = $("modal");
  const connectionId = Number(modal?.querySelector("#vncClipboardSshConnection")?.value || 0);
  const diagnostics = session.clipboardHelperDiagnostics || {};
  const sourceId = connectionId || Number(diagnostics.connection_id || 0);
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
  const modeLabel = normalizedMode === "local-offline"
    ? tr("remote:vnc_ui.mode_local_offline", {defaultValue:"本机下载后离线"})
    : normalizedMode === "offline"
      ? tr("remote:vnc_ui.mode_remote_cache", {defaultValue:"使用远端缓存"})
      : tr("remote:vnc_ui.mode_online", {defaultValue:"在线"});
  let adminAuth = null;
  try {
    setButtonBusy(button, true);
    await persistVncClipboardSshSelection(session, connectionId);
    session.clipboardHelperModalFinish?.({installing:true});
    if (!diagnostics.root) {
      adminAuth = await requestRemoteAdminAuthorization(sourceId, tr("remote:clipboard.install_unicode_action", {mode:modeLabel, defaultValue:`${modeLabel}安装 Unicode 剪贴板辅助工具`}));
      if (!adminAuth) return;
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action, connection_id:connectionId, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const activeAction = String(result.task.action || action);
      const activeUninstall = activeAction === "uninstall";
      stopVncClipboardPolling(session);
      resetVncClipboardTransportState(session);
      setVncClipboardStatus(session, activeUninstall ? tr("remote:clipboard.helper_uninstalling", {defaultValue:"SSH 剪贴板辅助卸载中"}) : tr("remote:clipboard.helper_installing", {defaultValue:"SSH 剪贴板辅助安装中"}), "active");
      const actionLabel = tr("remote:clipboard.install_helper_action", {mode:modeLabel, defaultValue:`${modeLabel}安装剪贴板辅助工具`});
      const requestAccepted = notifyRemoteComponentTaskRequest(result, actionLabel, tr("remote:clipboard.install_added", {mode:modeLabel, defaultValue:`剪贴板辅助工具${modeLabel}安装已加入任务中心`}));
      if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
      await watchVncClipboardHelperTask(session, result.task.id, activeAction);
      return requestAccepted ? result : null;
    }
    resetVncClipboardTransportState(session);
    renderVncClipboardHelperState(session, result.after || result.before, modal?.querySelector("#vncClipboardHelperState"));
    notify(tr("remote:clipboard.install_complete", {defaultValue:"剪贴板辅助工具安装完成"}), "success");
    return result;
  } catch (error) {
    notify(error.message || tr("remote:clipboard.install_failed", {defaultValue:"剪贴板辅助工具安装失败"}), "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function uninstallVncClipboardHelper(key, button=null) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify(tr("remote:clipboard.session_missing", {defaultValue:"VNC 会话不存在"}), "error");
  const actionKey = vncClipboardHelperActionKey(session.profile.id);
  if (!beginUiAction(actionKey, button, tr("remote:clipboard.uninstalling", {defaultValue:"卸载中..."}))) {
    notify(tr("remote:clipboard.task_running", {defaultValue:"剪贴板辅助工具任务正在执行，请等待完成"}), "info");
    return null;
  }
  const modal = $("modal");
  const connectionId = Number(modal?.querySelector("#vncClipboardSshConnection")?.value || 0);
  const diagnostics = session.clipboardHelperDiagnostics || {};
  const uninstallPlan = diagnostics.uninstall_plan || diagnostics.install_plan?.uninstall || {};
  if (String(diagnostics.platform || "").toLowerCase() !== "linux" || !diagnostics.available || !uninstallPlan.available) {
    return notify(localizedRemoteTaskText(uninstallPlan.reason) || tr("remote:clipboard.no_safe_uninstall", {defaultValue:"当前没有可安全自动卸载的 Linux 剪贴板辅助工具"}), "error");
  }
  const sourceId = connectionId || Number(diagnostics.connection_id || 0);
  const packageLabel = Array.isArray(uninstallPlan.package_names) && uninstallPlan.package_names.length
    ? uninstallPlan.package_names.join("、")
    : diagnostics.tool || tr("remote:clipboard.helper_package", {defaultValue:"剪贴板辅助软件包"});
  let adminAuth = null;
  try {
    setButtonBusy(button, true, tr("remote:clipboard.preparing_uninstall", {defaultValue:"准备卸载..."}));
    await persistVncClipboardSshSelection(session, connectionId);
    session.clipboardHelperModalFinish?.({installing:true});
    const confirmed = await confirmModal(
      tr("remote:clipboard.confirm_uninstall", {package:packageLabel, defaultValue:`将从远端 Linux 卸载 ${packageLabel}。依赖该工具的其他桌面程序也可能受影响，VNC 将退回服务端原生剪贴板能力。是否继续？`}),
      tr("remote:clipboard.uninstall_helper_action", {defaultValue:"卸载剪贴板辅助工具"}),
      tr("remote:clipboard.uninstall", {defaultValue:"卸载"}),
      tr("remote:clipboard.cancel", {defaultValue:"取消"}),
      true
    );
    if (!confirmed) return null;
    if (!diagnostics.root) {
      adminAuth = await requestRemoteAdminAuthorization(sourceId, tr("remote:clipboard.uninstall_unicode_action", {defaultValue:"卸载 Unicode 剪贴板辅助工具"}));
      if (!adminAuth) return null;
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/helper`, {method:"POST", body:JSON.stringify({action:"uninstall", connection_id:connectionId, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const activeAction = String(result.task.action || "uninstall");
      const activeUninstall = activeAction === "uninstall";
      stopVncClipboardPolling(session);
      resetVncClipboardTransportState(session);
      setVncClipboardStatus(session, activeUninstall ? tr("remote:clipboard.helper_uninstalling", {defaultValue:"SSH 剪贴板辅助卸载中"}) : tr("remote:clipboard.helper_installing", {defaultValue:"SSH 剪贴板辅助安装中"}), "active");
      const requestAccepted = notifyRemoteComponentTaskRequest(result, tr("remote:clipboard.uninstall_helper_action", {defaultValue:"卸载剪贴板辅助工具"}), tr("remote:clipboard.uninstall_added", {defaultValue:"剪贴板辅助工具卸载已加入任务中心"}));
      if (typeof refreshSftpJobs === "function") void refreshSftpJobs();
      await watchVncClipboardHelperTask(session, result.task.id, activeAction);
      return requestAccepted ? result : null;
    }
    resetVncClipboardTransportState(session);
    notify(tr("remote:clipboard.uninstall_complete", {defaultValue:"剪贴板辅助工具卸载完成"}), "success");
    return result;
  } catch (error) {
    notify(error.message || tr("remote:clipboard.uninstall_failed", {defaultValue:"剪贴板辅助工具卸载失败"}), "error");
    return null;
  } finally {
    endUiAction(actionKey, button);
  }
}

async function configureVncClipboardSsh(key) {
  const session = vncSessions.get(key);
  if (!session?.profile) return notify(tr("remote:clipboard.session_missing", {defaultValue:"VNC 会话不存在"}), "error");
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
    session.clipboardBridgeTool = "";
    const transport = await ensureVncClipboardTransport(session);
    if (!vncClipboardUsesSsh(transport)) {
      setVncClipboardStatus(session, tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), "error");
      notify(localizedRemoteTaskText(session.clipboardBridgeError) || tr("remote:clipboard.selected_ssh_unavailable", {defaultValue:"所选 SSH 无法访问远端图形剪贴板，请检查远端剪贴板组件和桌面会话"}), "error");
      return;
    }
    setVncClipboardStatus(session, tr("remote:clipboard.helper_enabled", {defaultValue:"SSH 剪贴板辅助已启用"}), "success", 2600);
    const connectionName = session.clipboardBridgeConnectionName || tr("remote:clipboard.selected_ssh", {defaultValue:"所选 SSH"});
    notify(tr("remote:clipboard.unicode_helper_enabled_via", {connection:connectionName, defaultValue:`已通过 ${connectionName} 启用中文剪贴板辅助`}), "success");
    if (session.clipboardPendingUnicodeText !== undefined) {
      const pending = session.clipboardPendingUnicodeText;
      session.clipboardPendingUnicodeText = undefined;
      await sendVncClipboardText(session, pending, true);
    }
    if (session.clipboardAutoSync) startVncClipboardPolling(session);
  } catch (error) {
    session.clipboardBridgeError = error.message || tr("remote:clipboard.setup_failed", {defaultValue:"SSH 剪贴板辅助设置失败"});
    setVncClipboardStatus(session, tr("remote:clipboard.helper_unavailable", {defaultValue:"SSH 剪贴板辅助不可用"}), "error");
    notify(session.clipboardBridgeError, "error");
  } finally {
    focusEmbeddedVnc(session);
  }
}

function stopVncClipboardPolling(session) {
  if (!session) return;
  if (session.clipboardPollTimer) clearInterval(session.clipboardPollTimer);
  if (session.clipboardImagePollTimer) clearInterval(session.clipboardImagePollTimer);
  session.clipboardPollTimer = null;
  session.clipboardImagePollTimer = null;
}

function resetVncClipboardBridgeWriteState(session) {
  if (!session) return;
  session.clipboardBridgeWriteRevision = Number(session.clipboardBridgeWriteRevision || 0) + 1;
  session.clipboardBridgeWritePendingRevision = 0;
  session.clipboardBridgeEchoGuard = null;
  session.clipboardImageWriteRevision = Number(session.clipboardImageWriteRevision || 0) + 1;
  session.clipboardImageRemoteReadToken = Number(session.clipboardImageRemoteReadToken || 0) + 1;
  session.clipboardImageLocalReadToken = Number(session.clipboardImageLocalReadToken || 0) + 1;
  session.clipboardImageRemoteReadInFlight = false;
  session.clipboardImageLocalReadInFlight = false;
  session.clipboardImageLastSeenLocalHash = "";
  session.remoteClipboardImageHash = "";
}

function vncClipboardSendUnavailableReason(session) {
  if (!session?.rfb || !session.connected) return tr("remote:clipboard.vnc_not_ready", {defaultValue:"VNC 尚未连接完成"});
  if (session.profile?.options?.view_only || session.rfb.viewOnly) return tr("remote:clipboard.view_only_no_send", {defaultValue:"仅查看模式不能向远端发送剪贴板"});
  return "";
}

function vncClipboardSessionVisible(session) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof document !== "undefined" && typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  if (session?.viewport?.isConnected === false) return false;
  if (session?.viewport?.closest?.("[hidden]")) return false;
  return true;
}

const VNC_CLIPBOARD_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const VNC_CLIPBOARD_PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function vncClipboardImageTransportAvailable(session) {
  const transport = String(session?.clipboardTransport || "");
  if (transport === "ssh-linux-wayland") return session?.clipboardBridgeTool === "wl-clipboard";
  return transport === "ssh-linux-x11" && session?.clipboardBridgeTool === "xclip";
}

function vncClipboardImageBytes(payload) {
  const source = payload?.data ?? payload;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (Array.isArray(source)) return Uint8Array.from(source);
  if (Array.isArray(source?.data)) return Uint8Array.from(source.data);
  throw new Error(tr("remote:clipboard.image_invalid", {defaultValue:"剪贴板图片数据无效"}));
}

function validateVncClipboardImageBytes(value) {
  const bytes = vncClipboardImageBytes(value);
  if (!bytes.byteLength) throw new Error(tr("remote:clipboard.image_empty", {defaultValue:"剪贴板图片为空"}));
  if (bytes.byteLength > VNC_CLIPBOARD_IMAGE_MAX_BYTES) throw new Error(tr("remote:clipboard.image_too_large", {defaultValue:"剪贴板图片超过 25 MB"}));
  if (bytes.byteLength < VNC_CLIPBOARD_PNG_SIGNATURE.length || !VNC_CLIPBOARD_PNG_SIGNATURE.every((item, index) => bytes[index] === item)) {
    throw new Error(tr("remote:clipboard.image_not_png", {defaultValue:"剪贴板图片不是有效的 PNG 数据"}));
  }
  return bytes;
}

async function readVncLocalClipboardImage() {
  if (window.termaDesktop?.readClipboardImage) {
    const payload = await window.termaDesktop.readClipboardImage();
    if (!payload?.ok) {
      if (payload?.reason === "empty") return null;
      throw new Error(payload?.error || tr("remote:clipboard.local_image_read_failed", {defaultValue:"无法读取本机剪贴板图片"}));
    }
    return validateVncClipboardImageBytes(payload);
  }
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(value => String(value || "").toLowerCase() === "image/png");
      if (type) return validateVncClipboardImageBytes(await (await item.getType(type)).arrayBuffer());
    }
  }
  return null;
}

async function writeVncLocalClipboardImage(value) {
  const bytes = validateVncClipboardImageBytes(value);
  if (window.termaDesktop?.writeClipboardImage) {
    await window.termaDesktop.writeClipboardImage(bytes);
    return true;
  }
  if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
    await navigator.clipboard.write([new ClipboardItem({"image/png":new Blob([bytes], {type:"image/png"})})]);
    return true;
  }
  throw new Error(tr("remote:clipboard.local_image_write_unsupported", {defaultValue:"当前环境不支持自动写入本机图片剪贴板"}));
}

async function vncClipboardImageSha256(value) {
  const bytes = validateVncClipboardImageBytes(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error(tr("remote:clipboard.image_hash_unavailable", {defaultValue:"当前环境无法安全识别剪贴板图片变化"}));
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  return Array.from(digest, item => item.toString(16).padStart(2, "0")).join("");
}

async function readVncLocalClipboardSnapshot(includeImage=false) {
  if (window.termaDesktop?.readClipboardSnapshot) {
    const payload = await window.termaDesktop.readClipboardSnapshot({includeImage});
    let image = null;
    if (includeImage && payload?.image_available) {
      if (!payload?.image?.ok) throw new Error(payload?.image?.error || tr("remote:clipboard.local_image_read_failed", {defaultValue:"无法读取本机剪贴板图片"}));
      image = validateVncClipboardImageBytes(payload.image);
    }
    return {
      textAvailable:payload?.text_available === true,
      text:payload?.text_available === true ? String(payload.text ?? "") : "",
      imageAvailable:payload?.image_available === true,
      image
    };
  }
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read();
    let textAvailable = false;
    let text = "";
    let imageAvailable = false;
    let image = null;
    for (const item of items) {
      const imageType = item.types.find(value => String(value || "").toLowerCase() === "image/png");
      if (imageType) {
        imageAvailable = true;
        if (includeImage && !image) image = validateVncClipboardImageBytes(await (await item.getType(imageType)).arrayBuffer());
      }
      const textType = item.types.find(value => String(value || "").toLowerCase().startsWith("text/plain"));
      if (textType && !textAvailable) {
        textAvailable = true;
        text = await (await item.getType(textType)).text();
      }
    }
    return {textAvailable, text, imageAvailable, image};
  }
  return {textAvailable:true, text:await readVncLocalClipboard(), imageAvailable:false, image:null};
}

async function sendVncClipboardImageBytes(session, value, announce=false, knownHash="") {
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) {
    if (announce) notify(unavailable, "info");
    return false;
  }
  const transport = await ensureVncClipboardTransport(session);
  if (!vncClipboardImageTransportAvailable({...session, clipboardTransport:transport})) {
    throw new Error(tr("remote:clipboard.image_requires_helper", {defaultValue:"图片剪贴板需要 SSH 辅助和远端 xclip/wl-clipboard"}));
  }
  const bytes = validateVncClipboardImageBytes(value);
  const hash = knownHash || await vncClipboardImageSha256(bytes);
  const writeRevision = Number(session.clipboardImageWriteRevision || 0) + 1;
  const operationId = Number(session.clipboardRemoteOperationId || 0);
  const rfb = session.rfb;
  session.clipboardImageWriteRevision = writeRevision;
  const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/image`, {
    method:"POST",
    headers:{"Content-Type":"image/png"},
    body:bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    responseType:"json"
  });
  if (
    session.clipboardImageWriteRevision !== writeRevision
    || operationId !== Number(session.clipboardRemoteOperationId || 0)
    || session.rfb !== rfb
    || !session.connected
  ) return false;
  const remoteHash = /^[0-9a-f]{64}$/i.test(String(result?.sha256 || "")) ? String(result.sha256).toLowerCase() : hash;
  session.clipboardImageLastSeenLocalHash = hash;
  session.remoteClipboardImageHash = remoteHash;
  setVncClipboardStatus(session, tr("remote:clipboard.image_synced_remote", {defaultValue:"图片已同步到远端"}), "success", 2600);
  if (announce) notify(tr("remote:clipboard.local_image_synced", {defaultValue:"本机剪贴板图片已同步到远端 VNC 桌面"}), "success");
  return true;
}

async function sendVncClipboardImage(key, announce=false) {
  const session = vncSessions.get(key);
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) {
    if (announce) notify(unavailable, "info");
    return false;
  }
  try {
    const bytes = await readVncLocalClipboardImage();
    if (!bytes) {
      if (announce) notify(tr("remote:clipboard.local_png_missing", {defaultValue:"本机剪贴板中没有 PNG 图片"}), "info");
      return false;
    }
    return await sendVncClipboardImageBytes(session, bytes, announce);
  } catch (error) {
    setVncClipboardStatus(session, tr("remote:clipboard.image_sync_failed", {defaultValue:"图片剪贴板同步失败"}), "error");
    if (announce) notify(error.message || tr("remote:clipboard.local_image_send_failed", {defaultValue:"发送本机剪贴板图片失败"}), "error");
    return false;
  }
}

async function receiveVncClipboardImage(key, announce=false) {
  const session = vncSessions.get(key);
  const unavailable = vncClipboardSendUnavailableReason(session);
  if (unavailable) {
    if (announce) notify(unavailable, "info");
    return false;
  }
  try {
    const transport = await ensureVncClipboardTransport(session);
    if (!vncClipboardImageTransportAvailable({...session, clipboardTransport:transport})) {
      throw new Error(tr("remote:clipboard.image_requires_helper", {defaultValue:"图片剪贴板需要 SSH 辅助和远端 xclip/wl-clipboard"}));
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/image`, {responseType:"arrayBuffer"});
    const bytes = validateVncClipboardImageBytes(result.data);
    const hash = await vncClipboardImageSha256(bytes);
    await writeVncLocalClipboardImage(bytes);
    session.remoteClipboardImageHash = hash;
    session.clipboardImageLastSeenLocalHash = hash;
    setVncClipboardStatus(session, tr("remote:clipboard.remote_image_read", {defaultValue:"已读取远端图片"}), "success", 2600);
    if (announce) notify(tr("remote:clipboard.remote_image_written", {defaultValue:"远端 VNC 剪贴板图片已写入本机剪贴板"}), "success");
    return true;
  } catch (error) {
    setVncClipboardStatus(session, tr("remote:clipboard.remote_image_read_failed", {defaultValue:"读取远端图片失败"}), "error");
    if (announce) notify(error.message || tr("remote:clipboard.remote_clipboard_image_failed", {defaultValue:"读取远端剪贴板图片失败"}), "error");
    return false;
  }
}

function vncClipboardAutomaticImageSyncEnabled(session) {
  return Boolean(session?.clipboardAutoSync
    && session?.clipboardAutoSyncImages
    && session?.connected
    && !vncClipboardSendUnavailableReason(session)
    && vncClipboardSessionVisible(session));
}

async function syncVncClipboardImageFromLocal(session) {
  if (!vncClipboardAutomaticImageSyncEnabled(session) || session.clipboardImageLocalReadInFlight) return false;
  const readToken = Number(session.clipboardImageLocalReadToken || 0) + 1;
  session.clipboardImageLocalReadToken = readToken;
  session.clipboardImageLocalReadInFlight = true;
  try {
    const transport = await ensureVncClipboardTransport(session);
    if (!vncClipboardImageTransportAvailable({...session, clipboardTransport:transport})) return false;
    const snapshot = await readVncLocalClipboardSnapshot(true);
    if (!snapshot.imageAvailable || !snapshot.image) {
      session.clipboardImageLastSeenLocalHash = "";
      return false;
    }
    const hash = await vncClipboardImageSha256(snapshot.image);
    if (hash === session.clipboardImageLastSeenLocalHash) return false;
    session.clipboardImageLastSeenLocalHash = hash;
    if (hash === session.remoteClipboardImageHash) return false;
    if (!vncClipboardAutomaticImageSyncEnabled(session)) return false;
    return await sendVncClipboardImageBytes(session, snapshot.image, false, hash);
  } catch (error) {
    if (vncClipboardAutomaticImageSyncEnabled(session)) {
      setVncClipboardStatus(session, error?.message || tr("remote:clipboard.image_sync_failed", {defaultValue:"图片剪贴板同步失败"}), "error", 3200);
    }
    return false;
  } finally {
    if (session.clipboardImageLocalReadToken === readToken) session.clipboardImageLocalReadInFlight = false;
  }
}

async function pollVncRemoteClipboardImageBridge(session, force=false) {
  if (!session?.connected || session.clipboardImageRemoteReadInFlight) return false;
  if (!force && !vncClipboardAutomaticImageSyncEnabled(session)) return false;
  const transport = await ensureVncClipboardTransport(session);
  if (!vncClipboardImageTransportAvailable({...session, clipboardTransport:transport})) return false;
  const readRevision = Number(session.clipboardImageWriteRevision || 0);
  const readToken = Number(session.clipboardImageRemoteReadToken || 0) + 1;
  session.clipboardImageRemoteReadToken = readToken;
  const operationId = Number(session.clipboardRemoteOperationId || 0);
  const rfb = session.rfb;
  session.clipboardImageRemoteReadInFlight = true;
  try {
    const metadata = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/image/metadata`);
    if (
      readRevision !== Number(session.clipboardImageWriteRevision || 0)
      || operationId !== Number(session.clipboardRemoteOperationId || 0)
      || session.rfb !== rfb
      || !session.connected
      || (!force && !vncClipboardAutomaticImageSyncEnabled(session))
    ) return false;
    if (metadata?.too_large) {
      const size = Math.max(1, Math.ceil(Number(metadata.bytes || metadata.max_bytes || 0) / (1024 * 1024)));
      setVncClipboardStatus(session, tr("remote:clipboard.remote_image_too_large", {size, defaultValue:`远端剪贴板图片超过 ${size} MB，未自动同步`}), "warning");
      return false;
    }
    if (!metadata?.available) {
      session.remoteClipboardImageHash = "";
      return false;
    }
    const expectedHash = String(metadata.sha256 || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedHash) || expectedHash === session.remoteClipboardImageHash) return false;
    if (expectedHash === session.clipboardImageLastSeenLocalHash) {
      session.remoteClipboardImageHash = expectedHash;
      return false;
    }
    const result = await api(`/api/remote-profiles/${session.profile.id}/vnc-clipboard/image`, {responseType:"arrayBuffer"});
    const bytes = validateVncClipboardImageBytes(result.data);
    const actualHash = await vncClipboardImageSha256(bytes);
    if (actualHash !== expectedHash) return false;
    if (
      readRevision !== Number(session.clipboardImageWriteRevision || 0)
      || operationId !== Number(session.clipboardRemoteOperationId || 0)
      || session.rfb !== rfb
      || !session.connected
      || (!force && !vncClipboardAutomaticImageSyncEnabled(session))
    ) return false;
    await writeVncLocalClipboardImage(bytes);
    session.remoteClipboardImageHash = actualHash;
    session.clipboardImageLastSeenLocalHash = actualHash;
    setVncClipboardStatus(session, tr("remote:clipboard.image_synced_from_remote", {defaultValue:"已从远端同步图片"}), "success", 2600);
    return true;
  } catch (error) {
    if (force) throw error;
    return false;
  } finally {
    if (session.clipboardImageRemoteReadToken === readToken) session.clipboardImageRemoteReadInFlight = false;
  }
}

async function readVncLocalClipboard() {
  if (window.termaDesktop?.readClipboardText) return String(await window.termaDesktop.readClipboardText());
  if (!navigator.clipboard?.readText) throw new Error(tr("remote:clipboard.browser_read_unsupported", {defaultValue:"当前浏览器不支持直接读取剪贴板"}));
  return String(await navigator.clipboard.readText());
}

async function writeVncLocalClipboard(text, manual=false) {
  const value = String(text ?? "");
  if (window.termaDesktop?.writeClipboardText) {
    await window.termaDesktop.writeClipboardText(value);
    return;
  }
  if (!manual) {
    if (!navigator.clipboard?.writeText) throw new Error(tr("remote:clipboard.browser_write_unsupported", {defaultValue:"当前浏览器不能自动写入剪贴板"}));
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
        session.clipboardBridgeTool = String(result.tool || "");
        session.clipboardBridgeResolvedBy = String(result.resolved_by || "");
        if (result?.text_available === false) {
          session.remoteClipboardBridgeLastSeen = undefined;
          session.remoteClipboardAvailable = false;
          session.remoteClipboardPending = false;
          session.remoteClipboardText = "";
        } else {
          session.remoteClipboardBridgeLastSeen = normalizeVncClipboardText(result.text ?? "");
          session.remoteClipboardAvailable = true;
          session.remoteClipboardPending = false;
          session.remoteClipboardText = session.remoteClipboardBridgeLastSeen;
        }
        session.clipboardBridgeError = "";
      } else {
        session.clipboardBridgeConnectionId = Number(result?.connection_id || session.clipboardBridgeConnectionId || 0);
        session.clipboardBridgeConnectionName = String(result?.connection_name || session.clipboardBridgeConnectionName || "");
        session.clipboardBridgeTool = String(result?.tool || session.clipboardBridgeTool || "");
        session.clipboardBridgeResolvedBy = String(result?.resolved_by || session.clipboardBridgeResolvedBy || "");
        session.clipboardBridgeError = localizedRemoteTaskText(result?.reason) || tr("remote:clipboard.channel_unavailable", {defaultValue:"SSH 剪贴板辅助通道不可用"});
      }
    } catch (error) {
      session.clipboardTransport = "rfb";
      session.clipboardTransportChecked = true;
      session.clipboardBridgeError = error.message || tr("remote:clipboard.channel_unavailable", {defaultValue:"SSH 剪贴板辅助通道不可用"});
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
      setVncClipboardStatus(session, tr("remote:clipboard.ssh_sync_failed", {defaultValue:"SSH 剪贴板同步失败"}), "error");
      if (announce) notify(error.message || tr("remote:clipboard.remote_write_failed", {defaultValue:"写入远端系统剪贴板失败"}), "error");
      return false;
    }
  } else {
    if (vncClipboardNeedsUnicodeBridge(value) && !vncClipboardLegacyRfbCanSendUnicode(session)) {
      session.clipboardPendingUnicodeText = value;
      const detail = localizedRemoteTaskText(session.clipboardBridgeError) || tr("remote:clipboard.unicode_not_negotiated", {defaultValue:"远端 VNC 未协商 Unicode 剪贴板；请关联同主机 SSH，并在 Linux 安装 xclip/xsel 或 wl-clipboard"});
      const reason = tr("remote:clipboard.click_error_status", {detail, defaultValue:`${detail}。点击红色剪贴板状态进行设置`});
      setVncClipboardStatus(session, tr("remote:clipboard.unicode_requires_ssh", {defaultValue:"中文剪贴板需要 SSH 辅助"}), "error");
      if (announce) notify(reason, "error");
      return false;
    }
    session.rfb.clipboardPasteFrom(value);
  }
  session.clipboardLastSeenLocal = value;
  session.clipboardLastSentText = value;
  const confirmed = vncClipboardUsesSsh(transport);
  setVncClipboardStatus(session, confirmed ? tr("remote:clipboard.synced_remote", {defaultValue:"已同步到远端"}) : tr("remote:clipboard.sent_unconfirmed", {defaultValue:"已发送（服务端未确认）"}), confirmed ? "success" : "warning", 2200);
  if (announce) notify(confirmed ? tr("remote:clipboard.local_synced_ssh", {defaultValue:"本机剪贴板已通过 SSH 同步到远端系统"}) : tr("remote:clipboard.local_sent_vnc", {defaultValue:"本机剪贴板已通过 VNC 发送，服务端不会返回确认"}), confirmed ? "success" : "info");
  return true;
}

async function syncVncClipboardFromLocal(session) {
  if (!session?.clipboardAutoSync || session.clipboardReadInFlight || !vncClipboardSessionVisible(session)) return false;
  if (vncClipboardSendUnavailableReason(session)) return false;
  session.clipboardReadInFlight = true;
  try {
    const snapshot = await readVncLocalClipboardSnapshot(false);
    if (snapshot.imageAvailable) return false;
    session.clipboardImageLastSeenLocalHash = "";
    if (!snapshot.textAvailable) return false;
    const text = snapshot.text;
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
      setVncClipboardStatus(session, tr("remote:clipboard.permission_limited", {defaultValue:"剪贴板权限受限"}), "error");
      if (!session.clipboardPermissionNoticeShown) {
        session.clipboardPermissionNoticeShown = true;
        notify(tr("remote:clipboard.auto_read_failed_manual", {defaultValue:"无法持续读取本机剪贴板，已改为手动同步"}), "info");
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
  if (session.clipboardAutoSyncImages) {
    const pollImages = () => {
      void syncVncClipboardImageFromLocal(session).then(sent => sent ? false : pollVncRemoteClipboardImageBridge(session));
    };
    pollImages();
    session.clipboardImagePollTimer = setInterval(pollImages, VNC_CLIPBOARD_IMAGE_POLL_INTERVAL_MS);
  }
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
      setVncClipboardStatus(session, tr("remote:clipboard.remote_too_large", {size:Math.round(Number(result.max_bytes || 0) / 1024), defaultValue:`远端剪贴板超过 ${Math.round(Number(result.max_bytes || 0) / 1024)} KiB，未自动同步`}), "warning");
      return false;
    }
    if (result?.text_available === false) {
      session.remoteClipboardBridgeLastSeen = undefined;
      session.remoteClipboardAvailable = false;
      session.remoteClipboardPending = false;
      session.remoteClipboardText = "";
      renderVncClipboardControls(session);
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
    session.clipboardBridgeError = error.message || tr("remote:clipboard.remote_read_failed", {defaultValue:"读取远端系统剪贴板失败"});
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
    setVncClipboardStatus(session, tr("remote:clipboard.remote_received_click", {defaultValue:"收到远端内容，点击读取"}), "warning");
    return;
  }
  try {
    await writeVncLocalClipboard(value, false);
    if (session.rfb !== rfb || session.clipboardRemoteOperationId !== operationId) return;
    session.clipboardLastSeenLocal = value;
    session.remoteClipboardPending = false;
    session.clipboardPermissionBlocked = false;
    setVncClipboardStatus(session, tr("remote:clipboard.synced_from_remote", {defaultValue:"已从远端同步"}), "success", 2200);
  } catch (error) {
    if (session.rfb !== rfb || session.clipboardRemoteOperationId !== operationId) return;
    setVncClipboardStatus(session, tr("remote:clipboard.remote_received_click", {defaultValue:"收到远端内容，点击读取"}), "warning");
    if (!session.clipboardRemoteWriteNoticeShown) {
      session.clipboardRemoteWriteNoticeShown = true;
      notify(tr("remote:clipboard.remote_received_manual_read", {defaultValue:"已收到远端剪贴板；浏览器未允许自动写入，请点击工具栏的读取按钮"}), "info");
    }
  }
}

function requestVncClipboardText(session, reason="") {
  return new Promise(resolve => {
    const modal = $("modal");
    modal.hidden = false;
    modal.innerHTML = `<form class="modal-card vnc-clipboard-modal"><h2>${esc(tr("remote:clipboard.send_to", {name:session?.profile?.name || "VNC", defaultValue:`发送剪贴板到 ${session?.profile?.name || "VNC"}`}))}</h2>
      ${reason ? `<div class="connection-test-status warning">${esc(reason)}</div>` : ""}
      <label>${esc(tr("remote:clipboard.text_to_send", {defaultValue:"要发送的文本"}))}</label><textarea id="vncClipboardManualText" rows="8" autofocus placeholder="${escAttr(tr("remote:clipboard.manual_paste_placeholder", {defaultValue:"在此按 Ctrl+V 或 Command+V 粘贴；留空可清空远端剪贴板"}))}"></textarea>
      <div class="muted">${esc(tr("remote:clipboard.session_only_notice", {defaultValue:"内容只发送到当前 VNC 会话，不会保存到 Terma。"}))}</div>
      <div class="actions"><button type="button" data-vnc-clipboard-cancel>${esc(tr("remote:clipboard.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${esc(tr("remote:clipboard.send", {defaultValue:"发送"}))}</button></div></form>`;
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
