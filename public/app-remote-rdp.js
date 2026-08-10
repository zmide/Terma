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
  const profile = remoteProfileById(profileId);
  const endpointProbe = diagnostics?.endpoint_probe || {};
  if (diagnostics?.error || diagnostics?.management_available === false) {
    const authFailed = typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(diagnostics);
    const repair = authFailed ? remoteManagementCredentialRepairMarkup(profileId, diagnostics, "rdp") : "";
    const management = diagnostics?.management_available === false
      ? remoteManagementUnavailableMarkup(profile, diagnostics.error)
      : remoteDiagnosticStatusMarkup(diagnostics.error || "SSH 深度探测不可用", {
        tone:"warning",
        icon:"server-off",
        title:"SSH 深度探测不可用",
        actions:repair
      });
    container.innerHTML = `${remoteEndpointProbeMarkup(profile, endpointProbe)}${management}`;
    const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
    const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
    if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || (endpointProbe.supported && !endpointProbe.ok);
    refreshIcons();
    return;
  }
  const linux = diagnostics?.platform_supported !== false;
  const installed = Boolean(diagnostics?.xrdp_installed);
  const active = Boolean(diagnostics?.xrdp_active);
  const listening = Boolean(diagnostics?.xrdp_listening);
  const ready = installed && active && listening;
  const plan = rdpInstallPlanFromDiagnostics(diagnostics);
  const managerConnection = diagnostics?.connection?.name || currentConnection(linuxDesktopManagerConnectionIdForProfile(profile))?.name || "SSH 管理连接";
  const title = !linux ? "当前主机不使用 Linux xrdp 管理" : installed ? "远端 xrdp 已安装" : "远端未安装 xrdp";
  const detail = !linux
    ? "Terma 不会在非 Linux 主机上安装 xrdp；仍可直接使用系统 RDP 服务。"
    : installed
      ? `${active ? "服务运行中" : "服务未运行"} · ${listening ? "TCP 3389 已监听" : "TCP 3389 未监听"} · ${diagnostics.has_desktop ? "桌面会话可用" : "尚未检测到可用桌面会话"}`
      : "请选择下方显示为可用的安装方式；本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统。";
  const serviceActions = linux && installed ? `<div class="remote-service-actions"><button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','${active ? "stop" : "start"}',this)">${icon(active ? "circle-stop" : "circle-play")}<span>${active ? "停止服务" : "启动服务"}</span></button><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','uninstall',this)">${icon("package-minus")}<span>卸载服务</span></button></div>` : "";
  container.innerHTML = `${remoteEndpointProbeMarkup(profile, endpointProbe)}<div class="remote-service-head rdp-server-head"><span class="remote-service-icon xdmcp-server-icon ${!linux || ready ? "ready" : "warning"}">${icon(!linux ? "info" : ready ? "circle-check" : installed ? "circle-alert" : "package-x")}</span><div><b>${esc(title)}</b><small>${esc(managerConnection)} · ${esc(detail)}</small></div></div>${linux && !installed ? remoteInstallModesMarkup(plan || {}, mode => `installRdpServer(${Number(profileId)},'${escAttr(key)}',this,'${mode}')`, `openRdpSetupGuide(${Number(profileId)})`, actionKey) : ""}${linux && installed ? `<div class="remote-service-meta rdp-server-meta"><span>${icon("package-check")} xrdp 已安装</span><span>${icon(active ? "circle-play" : "circle-stop")} ${active ? "服务运行中" : "服务未运行"}</span><span>${icon(listening ? "radio-tower" : "unplug")} ${listening ? "3389 已监听" : "3389 未监听"}</span><span>${icon("monitor")} ${diagnostics.has_desktop ? "桌面会话可用" : "需要安装桌面会话"}</span></div>` : ""}${remoteDesktopProtocolGuideMarkup("rdp", diagnostics, profile)}${remoteGraphicsRenderingMarkup(diagnostics)}${serviceActions}`;
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
  if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || (endpointProbe.supported ? !endpointProbe.ok : linux && !ready);
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectRdpServer(profileId, button=null, targetContainer=null) {
  const container = targetContainer || $("rdpServerState");
  if (button) setButtonBusy(button, true, "探测中...");
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 RDP 服务</span></div>`;
  try {
    const profile = remoteProfileById(profileId);
    const managementConnectionId = linuxDesktopManagerConnectionIdForProfile(profile);
    const connectivityPromise = api(`/api/remote-profiles/${Number(profileId)}/connectivity`).catch(error => ({supported:true, ok:false, error:error.message || "端口探测失败"}));
    let diagnostics;
    if (!managementConnectionId) {
      diagnostics = {
        management_available:false,
        code:"REMOTE_MANAGEMENT_SSH_REQUIRED",
        error:"RDP 可以直接使用系统服务；如需管理 Linux xrdp、桌面和安装状态，可新建并关联 SSH 管理连接。"
      };
    } else {
      try {
        diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
        diagnostics.management_available = true;
      } catch (error) {
        diagnostics = {management_available:true, error:error.message || "RDP SSH 深度探测失败", code:error.code || "", connectionId:Number(error.connectionId || managementConnectionId)};
      }
    }
    diagnostics.endpoint_probe = await connectivityPromise;
    renderRdpServerState(diagnostics, profileId, `remote-desktop-${profileId}`, container);
    return diagnostics;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function closeRdpSetupGuide() {
  closeRemoteInstallDialog();
}

async function openRdpSetupGuide(profileId) {
  const modal = $("modal");
  const profile = remoteProfileById(profileId);
  if (!linuxDesktopManagerConnectionIdForProfile(profile)) {
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="rdpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="rdpSetupGuideTitle">RDP 配置说明</h2><span class="muted">${esc(profile?.name || "RDP")} · ${esc(remoteProfileEndpoint(profile || {}))}</span></div><button class="icon-button" type="button" onclick="closeRdpSetupGuide()" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      ${remoteDiagnosticStatusMarkup("Windows 主机请在系统设置中开启远程桌面并允许 TCP 3389（或当前自定义端口）。Terma 会直接探测端口并启动本机 RDP 客户端，不要求 SSH。", {tone:"success", icon:"monitor-up", title:"Windows / 独立 RDP 服务"})}
      ${remoteManagementUnavailableMarkup(profile, "如果目标是 Linux 且希望由 Terma 安装或管理 xrdp、桌面环境和服务状态，可以新建 SSH 管理连接；这不会影响当前 RDP 配置。")}
      ${remoteDesktopProtocolGuideMarkup("rdp", {}, profile)}
      <div class="actions"><button type="button" onclick="closeRdpSetupGuide()">关闭</button></div>
    </div>`;
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    return;
  }
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
    const plan = rdpInstallPlanFromDiagnostics(diagnostics) || {};
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
    if (typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)) {
      return repairRemoteManagementCredentials(profileId, "rdp");
    }
    return null;
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
