function rdpInstallPlanFromDiagnostics(diagnostics={}) {
  return diagnostics.rdp_install_plan || diagnostics.install_plan || diagnostics.package_plan?.install_plan || diagnostics.package_plan || null;
}

function remoteGraphicsRenderingCopy(rendering={}) {
  const protocol = String(rendering.protocol || "").toLowerCase();
  const state = String(rendering.state || "unknown").toLowerCase();
  const backend = String(rendering.backend || "");
  const display = String(rendering.source_display || rendering.display || "");
  if (protocol === "rdp") {
    if (state === "software") {
      return {
        summary:display
          ? tr("remote:rendering.rdp_software_display", {display, defaultValue:`XRDP ${display} 已回退到软件渲染`})
          : tr("remote:rendering.rdp_software", {defaultValue:"XRDP 图形加速当前不可用"}),
        detail:rendering.drm_device && !rendering.drm_device_available
          ? tr("remote:rendering.rdp_missing_drm", {device:rendering.drm_device, defaultValue:`xorgxrdp 配置的 DRM 设备 ${rendering.drm_device} 不存在；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。`})
          : tr("remote:rendering.rdp_software_detail", {defaultValue:"xorgxrdp 日志检测到 swrast/软件 OpenGL 回退；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。"})
      };
    }
    if (state === "accelerated") return {
      summary:tr("remote:rendering.rdp_accelerated", {display, defaultValue:`XRDP ${display} 已检测到 DRM 渲染节点`}),
      detail:tr("remote:rendering.rdp_accelerated_detail", {defaultValue:"当前日志未发现软件 OpenGL 回退；具体应用仍可能受自身图形后端限制。"})
    };
    if (state === "unknown") return {
      summary:tr("remote:rendering.rdp_pending", {defaultValue:"XRDP 渲染状态等待活动会话确认"}),
      detail:tr("remote:rendering.rdp_pending_detail", {defaultValue:"建立 RDP 图形会话后可进一步判断 DRM 和软件 OpenGL 回退状态。"})
    };
  }
  if (protocol === "vnc") {
    if (backend === "macOS Screen Sharing") return {
      summary:tr("remote:rendering.vnc_macos_shared", {defaultValue:"VNC 正在共享 macOS 已有桌面"}),
      detail:tr("remote:rendering.vnc_macos_shared_detail", {defaultValue:"应用仍由本机桌面会话负责渲染，系统屏幕共享只传输最终画面。"})
    };
    if (backend === "x11vnc -> xorgxrdp") return rendering.java_gui_risk ? {
      summary:tr("remote:rendering.vnc_xrdp_limited", {display:display || tr("remote:rendering.session", {defaultValue:"会话"}), defaultValue:`VNC 正在共享受限的 XRDP ${display || "会话"}`}),
      detail:tr("remote:rendering.vnc_xrdp_limited_detail", {defaultValue:"x11vnc 不会改变应用的渲染方式，因此会继承源 XRDP 会话的软件 OpenGL 限制。"})
    } : {
      summary:tr("remote:rendering.vnc_xrdp_shared", {display:display || tr("remote:rendering.session", {defaultValue:"会话"}), defaultValue:`VNC 正在共享 XRDP ${display || "会话"}`}),
      detail:tr("remote:rendering.vnc_xrdp_shared_detail", {defaultValue:"x11vnc 直接共享源 XRDP 会话，应用渲染能力与该会话保持一致。"})
    };
    if (backend === "TigerVNC/Xvnc" || backend === "TigerVNC") return {
      summary:tr("remote:rendering.vnc_virtual", {defaultValue:"VNC 使用独立虚拟显示，通常只有软件渲染"}),
      detail:tr("remote:rendering.vnc_virtual_detail", {defaultValue:"TigerVNC 不等同于物理 GPU 桌面；JavaFX、OpenGL 或依赖硬件合成的 Java 界面可能白屏。"})
    };
    if (backend === "wayvnc") return {
      summary:tr("remote:rendering.vnc_wayland_shared", {defaultValue:"VNC 正在共享已有 Wayland 桌面"}),
      detail:tr("remote:rendering.vnc_wayland_shared_detail", {defaultValue:"应用仍由原桌面会话负责渲染，VNC 只传输最终画面。"})
    };
    if (backend === "x11vnc") return {
      summary:tr("remote:rendering.vnc_x11_shared", {display:display || tr("remote:rendering.desktop", {defaultValue:"桌面"}), defaultValue:`VNC 正在共享已有 X11 ${display || "桌面"}`}),
      detail:tr("remote:rendering.vnc_x11_shared_detail", {defaultValue:"应用仍由源 X11 会话负责渲染，VNC 本身不会把硬件渲染改成软件渲染。"})
    };
    if (state === "unknown") return {
      summary:tr("remote:rendering.vnc_unknown", {defaultValue:"VNC 渲染来源尚未确定"}),
      detail:tr("remote:rendering.vnc_unknown_detail", {defaultValue:"启动 VNC 服务后可判断它共享已有桌面还是创建独立虚拟显示。"})
    };
  }
  if (protocol === "xdmcp" && (state === "remote-x11" || backend === "remote X11")) return {
    summary:tr("remote:rendering.xdmcp_remote_x11", {defaultValue:"XDMCP 使用客户端 X Server，直接 GPU 渲染通常受限"}),
    detail:tr("remote:rendering.xdmcp_remote_x11_detail", {defaultValue:"普通 X11 界面通常可用，但 JavaFX、OpenGL、JOGL 或内嵌浏览器可能需要软件渲染参数。"})
  };
  return {summary:String(rendering.summary || ""), detail:String(rendering.detail || "")};
}

function remoteGraphicsRenderingMarkup(diagnostics={}) {
  const rendering = diagnostics?.graphics_rendering;
  if (!rendering || rendering.visible === false || !rendering.summary) return "";
  const uiText = value => String(value || "").replaceAll("TigerVNC/Xvnc", "TigerVNC");
  const copy = remoteGraphicsRenderingCopy(rendering);
  const risk = Boolean(rendering.java_gui_risk);
  const ready = rendering.state === "accelerated";
  const drmStatus = rendering.drm_device_available
    ? tr("remote:rendering.available", {defaultValue:"可用"})
    : tr("remote:rendering.unavailable", {defaultValue:"不可用"});
  const details = [
    rendering.backend ? tr("remote:rendering.backend", {backend:uiText(rendering.backend), defaultValue:`后端：${uiText(rendering.backend)}`}) : "",
    rendering.source_display || rendering.display ? tr("remote:rendering.display", {display:rendering.source_display || rendering.display, defaultValue:`显示：${rendering.source_display || rendering.display}`}) : "",
    rendering.drm_device ? tr("remote:rendering.drm", {device:rendering.drm_device, status:drmStatus, defaultValue:`DRM：${rendering.drm_device}（${drmStatus}）`}) : ""
  ].filter(Boolean);
  const commands = Array.isArray(rendering.compatibility_commands) ? rendering.compatibility_commands : [];
  const actions = risk && commands.length
    ? `<div class="remote-rendering-actions">${commands.map(item => {
      const label = item.id === "java2d-safe" ? tr("remote:rendering.java2d_safe", {defaultValue:"Java2D 深度兼容"}) : String(item.label || "Java");
      return `<button type="button" onclick="copyRemoteGraphicsCommand('${escAttr(encodeURIComponent(item.command || ""))}','${escAttr(label)}',this)" title="${escAttr(tr("remote:rendering.copy_command_title", {label, defaultValue:`复制 ${label} 兼容启动命令`}))}">${icon("copy")}<span>${esc(label)}</span></button>`;
    }).join("")}</div>`
    : "";
  return `<div class="remote-rendering-state ${risk ? "warning" : ready ? "ready" : ""}">
    <span class="remote-rendering-icon">${icon(risk ? "triangle-alert" : ready ? "badge-check" : "monitor-cog")}</span>
    <div class="remote-rendering-copy"><strong>${esc(uiText(copy.summary))}</strong><small>${esc(uiText(copy.detail))}</small>${details.length ? `<span>${esc(details.join(" · "))}</span>` : ""}</div>
    ${actions}
  </div>`;
}

async function copyRemoteGraphicsCommand(encoded, label="Java", button=null) {
  try {
    const command = decodeURIComponent(String(encoded || ""));
    if (!command) throw new Error(tr("remote:rendering.command_empty", {defaultValue:"兼容启动命令为空"}));
    if (button) setButtonBusy(button, true, tr("remote:rendering.copying", {defaultValue:"复制中..."}));
    await writeClipboardText(command);
    notify(tr("remote:rendering.command_copied", {label, defaultValue:`${label} 兼容启动命令已复制`}), "success");
  } catch (error) {
    notify(error.message || tr("remote:rendering.copy_failed", {defaultValue:"复制兼容启动命令失败"}), "error");
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
      : remoteDiagnosticStatusMarkup(diagnostics.error || tr("remote:diagnostics.ssh_probe_unavailable", {defaultValue:"SSH 深度探测不可用"}), {
        tone:"warning",
        icon:"server-off",
        title:tr("remote:diagnostics.ssh_probe_unavailable", {defaultValue:"SSH 深度探测不可用"}),
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
  const managerConnection = diagnostics?.connection?.name || currentConnection(linuxDesktopManagerConnectionIdForProfile(profile))?.name || tr("remote:diagnostics.ssh_management_connection", {defaultValue:"SSH 管理连接"});
  const title = !linux
    ? tr("remote:rdp_status.non_linux_title", {defaultValue:"当前主机不使用 Linux xrdp 管理"})
    : installed
      ? tr("remote:rdp_status.installed_title", {defaultValue:"远端 xrdp 已安装"})
      : tr("remote:rdp_status.not_installed_title", {defaultValue:"远端未安装 xrdp"});
  const detail = !linux
    ? tr("remote:rdp_status.non_linux_detail", {defaultValue:"Terma 不会在非 Linux 主机上安装 xrdp；仍可直接使用系统 RDP 服务。"})
    : installed
      ? [
        active
          ? tr("remote:rdp_status.service_running", {defaultValue:"服务运行中"})
          : tr("remote:rdp_status.service_stopped", {defaultValue:"服务未运行"}),
        listening
          ? tr("remote:rdp_status.tcp_listening", {defaultValue:"TCP 3389 已监听"})
          : tr("remote:rdp_status.tcp_not_listening", {defaultValue:"TCP 3389 未监听"}),
        diagnostics.has_desktop
          ? tr("remote:rdp_status.desktop_available", {defaultValue:"桌面会话可用"})
          : tr("remote:rdp_status.desktop_not_detected", {defaultValue:"尚未检测到可用桌面会话"})
      ].join(" · ")
      : tr("remote:rdp_status.install_hint", {defaultValue:"请选择下方显示为可用的安装方式；本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统。"});
  const startStopLabel = active
    ? tr("remote:rdp_status.stop_service", {defaultValue:"停止服务"})
    : tr("remote:rdp_status.start_service", {defaultValue:"启动服务"});
  const serviceActions = linux && installed ? `<div class="remote-service-actions"><button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','${active ? "stop" : "start"}',this)">${icon(active ? "circle-stop" : "circle-play")}<span>${esc(startStopLabel)}</span></button><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'${escAttr(key)}','uninstall',this)">${icon("package-minus")}<span>${esc(tr("remote:rdp_status.uninstall_service", {defaultValue:"卸载服务"}))}</span></button></div>` : "";
  const installedMeta = tr("remote:rdp_status.installed_meta", {defaultValue:"xrdp 已安装"});
  const serviceMeta = active
    ? tr("remote:rdp_status.service_running", {defaultValue:"服务运行中"})
    : tr("remote:rdp_status.service_stopped", {defaultValue:"服务未运行"});
  const listeningMeta = listening
    ? tr("remote:rdp_status.port_listening", {defaultValue:"3389 已监听"})
    : tr("remote:rdp_status.port_not_listening", {defaultValue:"3389 未监听"});
  const desktopMeta = diagnostics.has_desktop
    ? tr("remote:rdp_status.desktop_available", {defaultValue:"桌面会话可用"})
    : tr("remote:rdp_status.desktop_install_required", {defaultValue:"需要安装桌面会话"});
  container.innerHTML = `${remoteEndpointProbeMarkup(profile, endpointProbe)}<div class="remote-service-head rdp-server-head"><span class="remote-service-icon xdmcp-server-icon ${!linux || ready ? "ready" : "warning"}">${icon(!linux ? "info" : ready ? "circle-check" : installed ? "circle-alert" : "package-x")}</span><div><b>${esc(title)}</b><small>${esc(managerConnection)} · ${esc(detail)}</small></div></div>${linux && !installed ? remoteInstallModesMarkup(plan || {}, mode => `installRdpServer(${Number(profileId)},'${escAttr(key)}',this,'${mode}')`, `openRdpSetupGuide(${Number(profileId)})`, actionKey) : ""}${linux && installed ? `<div class="remote-service-meta rdp-server-meta"><span>${icon("package-check")} ${esc(installedMeta)}</span><span>${icon(active ? "circle-play" : "circle-stop")} ${esc(serviceMeta)}</span><span>${icon(listening ? "radio-tower" : "unplug")} ${esc(listeningMeta)}</span><span>${icon("monitor")} ${esc(desktopMeta)}</span></div>` : ""}${remoteDesktopProtocolGuideMarkup("rdp", diagnostics, profile)}${remoteGraphicsRenderingMarkup(diagnostics)}${serviceActions}`;
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
  if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || (endpointProbe.supported ? !endpointProbe.ok : linux && !ready);
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectRdpServer(profileId, button=null, targetContainer=null) {
  const container = targetContainer || $("rdpServerState");
  if (button) setButtonBusy(button, true, tr("remote:diagnostics.detecting", {defaultValue:"探测中..."}));
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>${esc(tr("remote:auto.probe_rdp", {defaultValue:"正在探测远端 RDP 服务"}))}</span></div>`;
  try {
    const profile = remoteProfileById(profileId);
    const managementConnectionId = linuxDesktopManagerConnectionIdForProfile(profile);
    const connectivityPromise = api(`/api/remote-profiles/${Number(profileId)}/connectivity`).catch(error => remoteEndpointProbeRequestFailure(error, "tcp"));
    let diagnostics;
    if (!managementConnectionId) {
      diagnostics = {
        management_available:false,
        code:"REMOTE_MANAGEMENT_SSH_REQUIRED",
        error:tr("remote:rdp_status.ssh_management_optional", {defaultValue:"RDP 可以直接使用系统服务；如需管理 Linux xrdp、桌面和安装状态，可新建并关联 SSH 管理连接。"})
      };
    } else {
      try {
        diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
        diagnostics.management_available = true;
      } catch (error) {
        diagnostics = {management_available:true, error:error.message || tr("remote:rdp_status.ssh_probe_failed", {defaultValue:"RDP SSH 深度探测失败"}), code:error.code || "", connectionId:Number(error.connectionId || managementConnectionId)};
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
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  if (!linuxDesktopManagerConnectionIdForProfile(profile)) {
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="rdpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="rdpSetupGuideTitle">${esc(tr("remote:rdp_status.setup_title", {defaultValue:"RDP 配置说明"}))}</h2><span class="muted">${esc(profile?.name || "RDP")} · ${esc(remoteProfileEndpoint(profile || {}))}</span></div><button class="icon-button" type="button" onclick="closeRdpSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      ${remoteDiagnosticStatusMarkup(tr("remote:rdp_status.standalone_detail", {defaultValue:"Windows 主机请在系统设置中开启远程桌面并允许 TCP 3389（或当前自定义端口）。Terma 会直接探测端口并启动本机 RDP 客户端，不要求 SSH。"}), {tone:"success", icon:"monitor-up", title:tr("remote:rdp_status.standalone_title", {defaultValue:"Windows / 独立 RDP 服务"})})}
      ${remoteManagementUnavailableMarkup(profile, tr("remote:rdp_status.management_link_hint", {defaultValue:"如果目标是 Linux 且希望由 Terma 安装或管理 xrdp、桌面环境和服务状态，可以新建 SSH 管理连接；这不会影响当前 RDP 配置。"}))}
      ${remoteDesktopProtocolGuideMarkup("rdp", {}, profile)}
      <div class="actions"><button type="button" onclick="closeRdpSetupGuide()">${esc(closeLabel)}</button></div>
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
      ? [
          tr("remote:rdp_status.guide_non_linux", {defaultValue:"当前 SSH 管理主机不是 Linux，Terma 不会安装 xrdp。"}),
          tr("remote:rdp_status.guide_native_server", {defaultValue:"Windows 主机请在系统设置中开启远程桌面；其他系统请使用其原生 RDP 服务端说明。"})
        ]
      : [
          tr("remote:rdp_status.guide_desktop", {defaultValue:"先确认远端已经安装可用的 Linux 桌面；没有桌面时请前往 Linux 桌面管理安装 XFCE、GNOME、Plasma 等桌面环境。"}),
          tr("remote:rdp_status.guide_install", {defaultValue:"安装 xrdp 与对应的 Xorg 后端，并按发行版启用 xrdp 服务。"}),
          tr("remote:rdp_status.guide_firewall", {defaultValue:"只有检测到活动防火墙且端口未放行时，才需要开放 TCP 3389；未启用防火墙时不需要添加规则。"}),
          tr("remote:rdp_status.guide_redetect", {defaultValue:"安装完成后返回 RDP 工作区重新探测，再启动本机 RDP 客户端。"})
        ];
    const serverStatus = diagnostics.xrdp_installed
      ? tr("remote:rdp_status.guide_installed", {defaultValue:"远端已经检测到 xrdp；如仍无法连接，请检查桌面会话、服务状态和 TCP 3389。"})
      : diagnostics.platform_supported === false
        ? tr("remote:rdp_status.guide_unsupported", {defaultValue:"当前主机不适用 Linux xrdp 自动安装。"})
        : tr("remote:rdp_status.guide_missing", {defaultValue:"远端未检测到 xrdp，请选择安装方式或查看手动说明。"});
    const serviceActionLabel = active
      ? tr("remote:rdp_status.stop_service", {defaultValue:"停止服务"})
      : tr("remote:rdp_status.start_service", {defaultValue:"启动服务"});
    modal.innerHTML = `<div class="modal-card wide x11-install-guide remote-install-dialog" role="dialog" aria-modal="true" aria-labelledby="rdpSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="rdpSetupGuideTitle">${esc(tr("remote:rdp_status.install_setup_title", {defaultValue:"RDP 服务安装/配置"}))}</h2><span class="muted">${esc(diagnostics.connection?.name || profile?.name || tr("remote:rdp_status.remote_host", {defaultValue:"远端主机"}))} · ${esc(diagnostics.package_manager || tr("remote:rdp_status.unknown_package_manager", {defaultValue:"未识别包管理器"}))}</span></div><button class="icon-button" type="button" onclick="closeRdpSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      <div class="connection-test-status ${diagnostics.xrdp_installed ? "success" : "warning"}">${esc(serverStatus)}</div>
      ${remoteDesktopProtocolGuideMarkup("rdp", diagnostics, profile)}
      ${diagnostics.platform_supported === false || installed ? "" : remoteInstallModesMarkup(plan, mode => `installRdpServer(${Number(profileId)},'remote-desktop-${Number(profileId)}',this,'${mode}')`, "revealRemoteInstallManual(this)", actionKey)}
      ${remoteInstallManualMarkup(plan, {steps, note:tr("remote:rdp_status.guide_offline_note", {defaultValue:"如果远端和本机都无法联网，请在另一台同发行版、同版本、同架构的设备上下载 xrdp、xorgxrdp 及完整依赖，再上传到远端安装。"})})}
      <div class="actions"><button type="button" onclick="closeRdpSetupGuide()">${esc(closeLabel)}</button>${installed ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'remote-desktop-${Number(profileId)}','${active ? "stop" : "start"}',this)">${icon(active ? "circle-stop" : "circle-play")}<span>${esc(serviceActionLabel)}</span></button><button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runRdpServerAction(${Number(profileId)},'remote-desktop-${Number(profileId)}','uninstall',this)">${icon("package-minus")}<span>${esc(tr("remote:rdp_status.uninstall_service", {defaultValue:"卸载服务"}))}</span></button>` : ""}${sourceId ? `<button type="button" onclick="closeRdpSetupGuide();openLinuxDesktopManager(${sourceId})">${icon("monitor-cog")}<span>${esc(tr("remote:rdp_status.linux_desktop_management", {defaultValue:"Linux 桌面管理"}))}</span></button>` : ""}</div>
    </div>`;
    setRemoteInstallDialogCommands(plan);
    modal.hidden = false;
    modal.onclick = null;
    modal.querySelector(".remote-install-manual")?.setAttribute("open", "");
    refreshIcons();
    syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
  } catch (error) {
    notify(error.message || tr("remote:rdp_status.guide_read_failed", {defaultValue:"RDP 安装说明读取失败"}), "error");
    if (typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)) {
      return repairRemoteManagementCredentials(profileId, "rdp");
    }
    return null;
  }
}

async function installRdpServer(profileId, key, button=null, mode="online") {
  const actionKey = rdpServerActionKey(profileId);
  if (!beginUiAction(actionKey, button, tr("common:auto.installing", {defaultValue:"安装中..."}))) {
    notify(tr("remote:rdp_status.task_running", {defaultValue:"RDP 服务任务正在执行，请等待完成"}), "info");
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
  if (!profile) return notify(tr("remote:rdp_status.connection_missing", {defaultValue:"RDP 连接不存在"}), "error");
  const normalizedMode = ["online", "offline", "local-offline"].includes(mode) ? mode : "online";
  const modeLabel = normalizedMode === "local-offline"
    ? tr("remote:rdp_status.mode_local_offline", {defaultValue:"本机下载后离线"})
    : normalizedMode === "offline"
      ? tr("remote:rdp_status.mode_remote_cache", {defaultValue:"使用远端缓存"})
      : tr("remote:rdp_status.mode_online", {defaultValue:"在线"});
  let diagnostics = $("rdpServerState")?._rdpDiagnostics || null;
  if (!diagnostics || diagnostics.error) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
  const message = normalizedMode === "local-offline"
    ? tr("remote:rdp_status.confirm_local_offline_install", {defaultValue:"Terma 将针对已识别的 Debian/Ubuntu 或兼容 APT/.deb 系统，在本机下载匹配架构的 xrdp 软件包及依赖，通过 SFTP 上传后安装。是否继续？"})
    : normalizedMode === "offline"
      ? tr("remote:rdp_status.confirm_remote_cache_install", {defaultValue:"将只使用远端包管理器已经缓存的软件包安装 xrdp，不会访问软件源。缓存不完整时安装会失败，是否继续？"})
      : tr("remote:rdp_status.confirm_online_install", {defaultValue:"将通过远端软件源在线安装 xrdp 和对应的 Xorg 后端。是否继续？"});
  const operationTitle = tr("remote:rdp_status.install_action_title", {mode:modeLabel, defaultValue:`${modeLabel}安装 RDP 服务`});
  if (!await confirmModal(message, operationTitle, tr("common:actions.install", {defaultValue:"安装"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return null;
  const action = normalizedMode === "local-offline" ? "install-local-offline" : normalizedMode === "offline" ? "install-offline" : "install";
  const sourceId = Number(diagnostics.connection?.id || linuxDesktopManagerConnectionIdForProfile(profile) || 0);
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    if (!sourceId) return notify(tr("remote:rdp_status.ssh_management_missing", {defaultValue:"该 RDP 连接没有关联的 SSH 管理连接"}), "error");
    adminAuth = await requestRemoteAdminAuthorization(sourceId, operationTitle, `rdp.server.${action}`);
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, tr("common:auto.installing", {defaultValue:"安装中..."}));
  try {
    const result = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`, {method:"POST", body:JSON.stringify({action, ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (result.task) {
      const taskContainer = $("rdpServerState");
      const taskScope = captureRemoteComponentTaskScope(profileId, key, taskContainer);
      closeRdpSetupGuide();
      const taskCompletion = watchRemoteComponentTask(result.task, {
        container:taskContainer,
        scope:taskScope,
        title:operationTitle,
        onDone:(_, activeContainer) => activeContainer ? inspectRdpServer(profileId, null, activeContainer).catch(() => {}) : null
      });
      const requestAccepted = notifyRemoteComponentTaskRequest(result, operationTitle, tr("remote:rdp_status.install_queued", {defaultValue:"RDP 服务安装已加入任务中心"}));
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    renderRdpServerState(result.after || result.before || diagnostics, profileId, key);
    notify(tr("remote:rdp_status.install_complete_redetected", {defaultValue:"RDP 服务安装完成，已重新探测"}), "success");
    return result;
  } catch (error) {
    notify(error.message || tr("remote:rdp_status.install_failed", {mode:modeLabel, defaultValue:`${modeLabel}安装 RDP 服务失败`}), "error");
    return null;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

async function runRdpServerAction(profileId, key, action, button=null) {
  const actionKey = rdpServerActionKey(profileId);
  const busyLabel = action === "stop"
    ? tr("common:auto.stopping", {defaultValue:"停止中..."})
    : action === "uninstall"
      ? tr("common:auto.uninstalling", {defaultValue:"卸载中..."})
      : action === "restart"
        ? tr("remote:rdp_status.restarting", {defaultValue:"重启中..."})
        : tr("common:auto.starting", {defaultValue:"启动中..."});
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify(tr("remote:rdp_status.task_running", {defaultValue:"RDP 服务任务正在执行，请等待完成"}), "info");
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
  if (!profile) return notify(tr("remote:rdp_status.connection_missing", {defaultValue:"RDP 连接不存在"}), "error");
  const labels = {
    start:tr("remote:rdp_status.action_start", {defaultValue:"启动 RDP 服务"}),
    stop:tr("remote:rdp_status.action_stop", {defaultValue:"停止 RDP 服务"}),
    restart:tr("remote:rdp_status.action_restart", {defaultValue:"重启 RDP 服务"}),
    uninstall:tr("remote:rdp_status.action_uninstall", {defaultValue:"卸载 RDP 服务"})
  };
  const label = labels[action] || tr("remote:rdp_status.action_manage", {defaultValue:"管理 RDP 服务"});
  const danger = ["stop", "uninstall"].includes(action);
  const message = action === "uninstall"
    ? tr("remote:rdp_status.confirm_uninstall", {defaultValue:"将停止并卸载远端 xrdp 与对应的 Xorg 后端。不会卸载桌面环境，但现有 RDP 会话会立即断开。是否继续？"})
    : action === "stop"
      ? tr("remote:rdp_status.confirm_stop", {defaultValue:"将停止远端 xrdp 服务，现有 RDP 会话会立即断开。是否继续？"})
      : action === "restart"
        ? tr("remote:rdp_status.confirm_restart", {defaultValue:"将重启远端 xrdp 服务，现有 RDP 会话会立即断开。是否继续？"})
        : tr("remote:rdp_status.confirm_start", {defaultValue:"将启用并启动远端 xrdp 服务。是否继续？"});
  const confirmLabel = action === "uninstall"
    ? tr("common:actions.remove", {defaultValue:"卸载"})
    : action === "stop"
      ? tr("common:auto.stop", {defaultValue:"停止"})
      : action === "restart"
        ? tr("remote:rdp_status.restart", {defaultValue:"重启"})
        : tr("common:auto.start", {defaultValue:"启动"});
  if (!await confirmModal(message, label, confirmLabel, tr("common:actions.cancel", {defaultValue:"取消"}), danger)) return null;
  let diagnostics = $("rdpServerState")?._rdpDiagnostics || null;
  if (!diagnostics || diagnostics.error) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/rdp/server`);
  const sourceId = Number(diagnostics.connection?.id || linuxDesktopManagerConnectionIdForProfile(profile) || 0);
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    if (!sourceId) return notify(tr("remote:rdp_status.ssh_management_missing", {defaultValue:"该 RDP 连接没有关联的 SSH 管理连接"}), "error");
    adminAuth = await requestRemoteAdminAuthorization(sourceId, label, `rdp.server.${action}`);
    if (!adminAuth) return null;
  }
  if (button && document.contains(button)) setButtonBusy(button, true, busyRdpServerActionLabel(action));
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
      const requestAccepted = notifyRemoteComponentTaskRequest(result, label, tr("remote:rdp_status.action_queued", {action:label, defaultValue:`${label}已加入任务中心`}));
      await taskCompletion;
      return requestAccepted ? result : null;
    }
    renderRdpServerState(result.after || result.before || diagnostics, profileId, key);
    notify(tr("remote:rdp_status.action_complete_redetected", {action:label, defaultValue:`${label}完成，已重新探测`}), "success");
    return result;
  } catch (error) {
    notify(error.message || tr("remote:rdp_status.action_failed", {action:label, defaultValue:`${label}失败`}), "error");
    return null;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

function busyRdpServerActionLabel(action) {
  if (action === "uninstall") return tr("common:auto.uninstalling", {defaultValue:"卸载中..."});
  if (action === "stop") return tr("common:auto.stopping", {defaultValue:"停止中..."});
  if (action === "restart") return tr("remote:rdp_status.restarting", {defaultValue:"重启中..."});
  return tr("common:auto.starting", {defaultValue:"启动中..."});
}
