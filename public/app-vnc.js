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
  if (/ECONNREFUSED|refused|拒绝/i.test(value)) return tr("remote:vnc_status.failure_refused", {defaultValue:"远端拒绝了 5900 端口连接，VNC 服务可能尚未开启。"});
  if (/ETIMEDOUT|timeout|超时/i.test(value)) return tr("remote:vnc_status.failure_timeout", {defaultValue:"连接远端 5900 端口超时，请同时检查网络和防火墙。"});
  if (/ENOTFOUND|EAI_AGAIN|resolve|解析/i.test(value)) return tr("remote:vnc_status.failure_resolve", {defaultValue:"无法解析远端主机地址，请检查连接地址。"});
  return tr("remote:vnc_status.failure_unreachable", {defaultValue:"远端 5900 端口当前不可访问。"});
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
    const repair = remoteManagementCredentialRepairMarkup(profileId, effectiveDiagnostics, "vnc");
    container.innerHTML = `${remoteEndpointProbeMarkup(profile, effectiveDiagnostics.endpoint_probe || {})}${remoteDiagnosticStatusMarkup(effectiveDiagnostics.error, {tone:"warning", icon:"server-off", title:tr("remote:diagnostics.ssh_probe_unavailable", {defaultValue:"SSH 深度探测不可用"}), actions:repair})}`;
  } else {
    const sshProbeFailed = ["ssh-unreachable", "probe-failed"].includes(String(effectiveDiagnostics?.status || "").toLowerCase());
    const sshAuthFailed = sshProbeFailed && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure({
      code:effectiveDiagnostics?.code || "",
      message:effectiveDiagnostics?.ssh_error || ""
    });
    const repair = sshAuthFailed ? remoteManagementCredentialRepairMarkup(profileId, {
      code:effectiveDiagnostics?.code || "SSH_AUTHENTICATION_FAILED",
      message:effectiveDiagnostics?.ssh_error || tr("remote:vnc_status.ssh_auth_failed", {defaultValue:"SSH 认证失败"}),
      connectionId:Number(effectiveDiagnostics?.connection_id || effectiveDiagnostics?.ssh_connection?.id || 0)
    }, "vnc") : "";
    const managementNotice = effectiveDiagnostics?.diagnostics_available === false && !effectiveDiagnostics?.ssh_connection
      ? remoteManagementUnavailableMarkup(profile, tr("remote:vnc_status.ssh_management_optional", {defaultValue:"VNC 会先按端口与 RFB 协议连接；关联 SSH 后可管理 Linux VNC 服务和图形会话。"}))
      : sshAuthFailed
        ? remoteDiagnosticStatusMarkup(effectiveDiagnostics.ssh_error || tr("remote:vnc_status.ssh_auth_failed", {defaultValue:"SSH 认证失败"}), {tone:"warning", icon:"key-round", title:tr("remote:vnc_status.ssh_probe_auth_failed", {defaultValue:"SSH 深度探测认证失败"}), actions:repair})
        : "";
    const unmanaged = effectiveDiagnostics?.diagnostics_available === false && !effectiveDiagnostics?.ssh_connection;
    const connectionHelp = unmanaged
      ? ""
      : vncConnectionHelpMarkup(profile, effectiveDiagnostics?.platform || "", vncServerReady(effectiveDiagnostics), "", effectiveDiagnostics, key, {preflight:true, showConnect:false});
    container.innerHTML = `${remoteEndpointProbeMarkup(profile, effectiveDiagnostics.endpoint_probe || {})}${managementNotice}${connectionHelp}`;
  }
  const status = String(effectiveDiagnostics?.status || "").toLowerCase();
  const selectedManagementBlocked = effectiveDiagnostics?.server_session_configurable === true && !vncServerReady(effectiveDiagnostics);
  const endpointBlocked = effectiveDiagnostics?.endpoint_probe?.supported && !effectiveDiagnostics.endpoint_probe.ok;
  const blocked = endpointBlocked || (effectiveDiagnostics?.diagnostics_available !== false && (selectedManagementBlocked || ["not-installed", "stopped", "not-listening", "blocked"].includes(status)));
  const launchButton = remoteWorkspaceQuery(container, "#remoteDesktopLaunchButton", "remoteDesktopLaunchButton");
  const view = remoteWorkspaceQuery(container, "#view-remote-desktop", "view-remote-desktop");
  if (launchButton) launchButton.disabled = view?.dataset.remoteClientAvailable !== "1" || blocked;
  refreshIcons();
  syncUiActionControls(actionKey, isUiActionInFlight(actionKey));
}

async function inspectVncServer(profileId, button=null, targetContainer=null) {
  const container = targetContainer || $("vncServerState");
  if (button) setButtonBusy(button, true, tr("remote:diagnostics.detecting", {defaultValue:"探测中..."}));
  if (container) container.innerHTML = `<div class="xdmcp-server-loading">${icon("loader-circle")}<span>${esc(tr("remote:auto.probe_vnc", {defaultValue:"正在探测远端 VNC 服务"}))}</span></div>`;
  try {
    const profile = remoteProfileById(profileId);
    const managementConnectionId = linuxDesktopManagerConnectionIdForProfile(profile);
    const [diagnostics, endpointProbe] = await Promise.all([
      managementConnectionId
        ? api(`/api/remote-profiles/${Number(profileId)}/vnc/server`).catch(error => ({error:error.message || tr("remote:vnc_status.ssh_probe_failed", {defaultValue:"VNC SSH 深度探测失败"}), code:error.code || "", connectionId:Number(error.connectionId || managementConnectionId)}))
        : Promise.resolve({
          diagnostics_available:false,
          management_available:false,
          status:"unmanaged",
          error:""
        }),
      api(`/api/remote-profiles/${Number(profileId)}/connectivity`).catch(error => ({supported:true, ok:false, error:error.message || tr("remote:diagnostics.port_probe_failed", {defaultValue:"端口探测失败"})}))
    ]);
    diagnostics.endpoint_probe = endpointProbe;
    renderVncServerState(diagnostics, profileId, `remote-desktop-${profileId}`, container);
    return diagnostics;
  } finally {
    if (button && document.contains(button)) setButtonBusy(button, false);
  }
}

function vncDiagnosticCopy(diagnostics, serviceAvailable, detail="") {
  const status = String(diagnostics?.status || "").toLowerCase();
  if (serviceAvailable || status === "ready" || status === "reachable") return {
    title:tr("remote:vnc_status.accessible_title", {defaultValue:"VNC 服务可访问，但连接未完成"}),
    summary:tr("remote:vnc_status.accessible_summary", {defaultValue:"远端 VNC 端口可以访问，请检查认证方式和连接密码。"})
  };
  const platform = String(diagnostics?.platform || "").toLowerCase();
  if (platform === "macos") return {title:tr("remote:vnc_status.macos_disabled_title", {defaultValue:"未开启 macOS 屏幕共享"}), summary:tr("remote:vnc_status.macos_disabled_summary", {defaultValue:"macOS 自带 VNC 服务，请在系统设置中开启“屏幕共享”或“远程管理”。"})};
  if (status === "not-installed") return {title:tr("remote:vnc_status.not_installed_title", {defaultValue:"未安装 VNC 服务"}), summary:tr("remote:vnc_status.not_installed_summary", {defaultValue:"远端 Linux 主机没有检测到 VNC Server 组件，可以授权 Terma 安装，或按手册手动安装。"})};
  if (status === "stopped") return {title:tr("remote:vnc_status.stopped_title", {defaultValue:"VNC 服务已安装，但尚未启动"}), summary:tr("remote:vnc_status.stopped_summary", {defaultValue:"远端已经有 VNC 组件或服务单元，但目标端口没有监听。可以尝试启动服务，或打开手动配置说明。"})};
  if (status === "blocked") return {title:tr("remote:vnc_status.blocked_title", {defaultValue:"VNC 服务可能被防火墙拦截"}), summary:tr("remote:vnc_status.blocked_summary", {defaultValue:"远端检测到 VNC 组件，但目标端口没有从当前网络可访问；请检查防火墙和安全组。"})};
  if (status === "not-listening") return {title:tr("remote:vnc_status.not_listening_title", {defaultValue:"VNC 服务未监听目标端口"}), summary:tr("remote:vnc_status.not_listening_summary", {defaultValue:"远端 VNC 组件存在，但没有监听当前连接配置的端口，可能是显示编号或服务配置不一致。"})};
  if (status === "ssh-unreachable" || status === "probe-failed") return {title:tr("remote:vnc_status.probe_unavailable_title", {defaultValue:"无法完成远端 VNC 服务探测"}), summary:tr("remote:vnc_status.probe_unavailable_summary", {defaultValue:"SSH 管理连接暂时不可用，无法区分服务未安装和服务未启动；可以先打开手动安装/配置说明。"})};
  return {title:tr("remote:vnc_status.unavailable_title", {defaultValue:"未检测到可用的 VNC 服务"}), summary:vncServiceFailureDetail(detail)};
}

function localizedVncComponentLabel(component="", fallback="") {
  const key = String(component || "").toLowerCase();
  if (key === "x11vnc") return tr("remote:vnc_status.component_x11vnc", {defaultValue:"x11vnc 共享桌面"});
  if (key === "tigervnc") return tr("remote:vnc_status.component_tigervnc", {defaultValue:"TigerVNC 独立虚拟桌面"});
  return String(fallback || "") || tr("remote:vnc_status.component_selected", {defaultValue:"所选 VNC 组件"});
}

function vncServerSessionSourceLabel(source={}) {
  const kind = source.kind === "xrdp"
    ? tr("remote:vnc_status.source_xrdp", {defaultValue:"XRDP 会话"})
    : source.kind === "physical"
      ? tr("remote:vnc_status.source_physical", {defaultValue:"物理桌面"})
      : tr("remote:vnc_status.source_x11", {defaultValue:"X11 桌面"});
  const display = source.display || tr("remote:vnc_status.unknown_display", {defaultValue:"未知显示"});
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
    const current = diagnostics.server_mode === "virtual"
      ? localizedVncComponentLabel("tigervnc")
      : diagnostics.source_display
        ? tr("remote:vnc_status.current_shared", {display:diagnostics.source_display, defaultValue:`当前共享 ${diagnostics.source_display}`})
        : tr("remote:vnc_status.current_source_unknown", {defaultValue:"当前 VNC 服务来源未知"});
    return `<div class="vnc-server-source readonly"><span class="vnc-server-source-label">${esc(tr("remote:vnc_status.current_server_source", {defaultValue:"当前服务端桌面来源"}))}</span><strong>${esc(current)}</strong><small>${esc(tr("remote:vnc_status.readonly_source_help", {defaultValue:"当前 VNC 服务由系统单元管理，Terma 不会重写它的 DISPLAY；如需切换，请先在系统服务配置中修改。"}))}</small></div>`;
  }
  const selectedValue = selection.mode === "virtual"
    ? "virtual"
    : selection.mode === "shared" && selection.display
      ? `shared|${selection.display}`
      : "auto";
  const runningSource = diagnostics.server_mode === "virtual"
    ? localizedVncComponentLabel("tigervnc")
    : diagnostics.server_mode === "shared-x11" && diagnostics.source_display
      ? tr("remote:vnc_status.running_shared", {display:diagnostics.source_display, suffix:diagnostics.source_xrdp ? tr("remote:vnc_status.xrdp_session_suffix", {defaultValue:"（XRDP 会话）"}) : "", defaultValue:`共享 ${diagnostics.source_display}${diagnostics.source_xrdp ? "（XRDP 会话）" : ""}`})
      : diagnostics.vnc_process
        ? tr("remote:vnc_status.process_source_unknown", {defaultValue:"已检测到 VNC 进程，但来源未知"})
        : tr("remote:vnc_status.no_running_desktop", {defaultValue:"当前没有运行中的 VNC 桌面"});
  const options = [
    `<option value="auto" ${selectedValue === "auto" ? "selected" : ""}>${esc(tr("remote:vnc_status.source_auto", {defaultValue:"自动选择（只有一个活动桌面时）"}))}</option>`,
    ...sources.map(source => {
      const value = `shared|${source.display}`;
      const risk = source.kind === "xrdp" && diagnostics.xrdp_software_rendering ? tr("remote:vnc_status.java_gui_risk_suffix", {defaultValue:" · Java GUI 白屏风险"}) : "";
      return `<option value="${escAttr(value)}" ${selectedValue === value ? "selected" : ""}>${esc(vncServerSessionSourceLabel(source)+risk)}</option>`;
    }),
    `<option value="virtual" ${selectedValue === "virtual" ? "selected" : ""}>${esc(localizedVncComponentLabel("tigervnc"))}</option>`
  ].join("");
  const componentKey = selection.component || selection.component_state?.key || diagnostics.selected_component?.key || "";
  const warning = selection.requires_selection
    ? `<div class="connection-test-status warning">${esc(tr("remote:vnc_status.multiple_sources", {defaultValue:"检测到多个活动图形桌面；请选择共享物理桌面、XRDP 会话或独立虚拟桌面，Terma 不会替你猜测。"}))}</div>`
    : selection.install_required || selection.manual_only
      ? `<div class="connection-test-status warning">${esc(tr(selection.manual_only ? "remote:vnc_status.component_manual_only" : "remote:vnc_status.component_install_required", {component:localizedVncComponentLabel(componentKey), defaultValue:selection.manual_only ? `${localizedVncComponentLabel(componentKey)} 需要手动配置后才能使用。` : `所选桌面来源需要先安装 ${localizedVncComponentLabel(componentKey)}。`}))}</div>`
    : selection.reason && selection.source_available === false
      ? `<div class="connection-test-status warning">${esc(selection.display
        ? tr("remote:vnc_status.selected_display_missing", {display:selection.display, defaultValue:`所选显示 ${selection.display} 当前不存在`})
        : tr("remote:vnc_status.select_active_display", {defaultValue:"请选择要共享的活动显示"}))}</div>`
      : "";
  const actionKey = vncServerActionKey(profile.id);
  return `<div class="vnc-server-source"><span class="vnc-server-source-label">${esc(tr("remote:vnc_status.current_running_source", {defaultValue:"当前运行来源"}))}</span><strong>${esc(runningSource)}</strong><label class="vnc-server-source-label" for="vnc_server_session_source_${Number(profile.id)}">${esc(tr("remote:vnc_status.target_desktop_source", {defaultValue:"目标桌面来源"}))}</label><select id="vnc_server_session_source_${Number(profile.id)}" data-ui-action-key="${escAttr(actionKey)}" onchange="saveVncServerSessionSource(${Number(profile.id)},this,'${escAttr(key)}')">${options}</select><small>${esc(tr("remote:vnc_status.source_help", {defaultValue:"物理桌面和 XRDP 会话由 x11vnc 镜像已有画面；TigerVNC 独立虚拟桌面会创建新的 X11 会话，通常使用软件渲染。选择会保存，并在下次启动或重启 VNC 服务时生效。"}))}</small>${warning}</div>`;
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
    if (!profile) throw new Error(tr("remote:vnc_status.connection_missing", {defaultValue:"VNC 连接不存在"}));
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
    notify(tr("remote:vnc_status.source_saved", {defaultValue:"VNC 服务端桌面来源已保存"}), "success");
  } catch (error) {
    notify(error.message || tr("remote:vnc_status.source_save_failed", {defaultValue:"保存 VNC 桌面来源失败"}), "error");
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
  const selectedComponentKey = selectedComponent?.key || selectedComponent?.component || selection.component || "";
  const selectedComponentLabel = localizedVncComponentLabel(selectedComponentKey, selectedComponent?.label);
  const copy = componentInstallRequired
    ? {
      title:tr("remote:vnc_status.component_not_installed", {component:selectedComponentLabel, defaultValue:`未安装 ${selectedComponentLabel}`}),
      summary:tr(selectedComponent?.manual_only || selection.manual_only ? "remote:vnc_status.component_manual_only" : "remote:vnc_status.component_install_required", {component:selectedComponentLabel, defaultValue:selectedComponent?.manual_only || selection.manual_only ? `${selectedComponentLabel} 需要手动配置后才能使用。` : `请先安装所选桌面来源需要的 ${selectedComponentLabel}。`})
    }
    : selectionPending
      ? {title:tr("remote:vnc_status.selection_pending_title", {defaultValue:"所选桌面来源尚未生效"}), summary:tr("remote:vnc_status.selection_pending_summary", {defaultValue:"当前 VNC 服务仍在使用旧来源；请应用来源并重启，或先安装目标来源需要的组件。"})}
      : options.preflight && running
    ? {title:tr("remote:vnc_status.ready_title", {defaultValue:"VNC 服务已就绪"}), summary:tr("remote:vnc_status.ready_summary", {defaultValue:"远端 VNC 端口和服务探测通过，可以打开远程桌面。"})}
    : vncDiagnosticCopy(diagnostics, serviceAvailable, detail);
  const needsInstall = componentInstallRequired || status === "not-installed" || (["stopped", "not-listening"].includes(status) && !diagnostics?.start_plan && !installed);
  const installModes = needsInstall && !macos
    ? remoteInstallModesMarkup(installPlan, mode => `installVncServer(${Number(profile.id)},'${escAttr(reconnectKey)}',this,'${mode}')`, `openVncSetupGuide(${Number(profile.id)})`, actionKey)
    : "";
  const startButton = ["stopped", "not-listening", "blocked"].includes(status) && diagnostics?.start_plan
    ? `<button class="primary" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="startVncServer(${Number(profile.id)},'${escAttr(reconnectKey)}',this)">${icon("play")}<span>${esc(tr(status === "blocked" ? "remote:vnc_status.allow_and_start" : diagnostics.start_plan.kind === "service" ? "remote:vnc_status.start_vnc" : diagnostics.start_plan.kind === "tigervnc-systemd" ? "remote:vnc_status.configure_tigervnc" : "remote:vnc_status.configure_and_start", {defaultValue:status === "blocked" ? "放行并启动" : diagnostics.start_plan.kind === "service" ? "启动 VNC 服务" : diagnostics.start_plan.kind === "tigervnc-systemd" ? "配置并启用 TigerVNC" : "配置并启动"}))}</span></button>`
    : "";
  const toggleButton = running
    ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','stop',this)">${icon("circle-stop")}<span>${esc(tr("remote:vnc_status.stop_service", {defaultValue:"停止服务"}))}</span></button>`
    : !startButton && diagnostics?.start_plan
      ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','start',this)">${icon("circle-play")}<span>${esc(tr("remote:vnc_status.start_service", {defaultValue:"启动服务"}))}</span></button>`
      : "";
  const serviceActions = installed && !macos ? `${toggleButton}<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','uninstall',this)">${icon("package-minus")}<span>${esc(tr("remote:vnc_status.uninstall_service", {defaultValue:"卸载服务"}))}</span></button>` : "";
  const restartForSelection = currentRunning && diagnostics?.start_plan && diagnostics?.server_session_configurable && diagnostics?.server_session_selection_matches_running === false
    ? `<button class="primary" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profile.id)},'${escAttr(reconnectKey)}','restart',this)">${icon("refresh-cw")}<span>${esc(tr("remote:vnc_status.apply_source_restart", {defaultValue:"应用来源并重启"}))}</span></button>`
    : "";
  const activeSession = vncSessions.get(reconnectKey);
  const serviceComponent = diagnostics?.running_component || diagnostics?.selected_component || null;
  const serviceUnit = String(serviceComponent?.service_unit || diagnostics?.service_unit || "").trim();
  const serviceState = String(serviceComponent?.service_state || diagnostics?.service_state || tr("remote:vnc_status.unknown", {defaultValue:"未知"}));
  const listenerProcess = String(serviceComponent?.listener_process || diagnostics?.listener_process || "").trim();
  const listenerName = listenerProcess
    ? (listenerProcess.match(/(?:^|\/)\b(Xtigervnc|Xvnc|x11vnc|wayvnc|gnome-remote-desktop)\b/i)?.[1] || tr("remote:vnc_status.listener_process", {defaultValue:"VNC 监听进程"}))
    : "";
  const embedded = profile.options?.client_mode !== "system";
  const reconnecting = Boolean(activeSession?.workspace) || (!options.preflight && !running);
  const connectAction = embedded
    ? activeSession?.workspace
      ? `reconnectEmbeddedVnc(${Number(profile.id)},'${escAttr(reconnectKey)}')`
      : `openEmbeddedVncDesktop(${Number(profile.id)},'${escAttr(reconnectKey)}',this)`
    : `launchRemoteDesktop(${Number(profile.id)},'${escAttr(reconnectKey)}',this)`;
  const connectLabel = tr(reconnecting ? "remote:vnc_status.reconnect" : embedded ? "remote:actions.open_embedded_vnc" : "remote:vnc_status.open_system_client", {defaultValue:reconnecting ? "重新连接" : embedded ? "打开内置 VNC" : "打开系统客户端"});
  const connectButton = options.showConnect === false ? "" : `<button class="primary" type="button" onclick="${connectAction}">${icon(reconnecting ? "refresh-cw" : embedded ? "monitor" : "external-link")}<span>${connectLabel}</span></button>`;
  return `<div class="remote-service-state vnc-connection-help-panel">
    <div class="remote-service-head vnc-connection-help-head"><span class="remote-service-icon ${running ? "ready" : status === "not-installed" ? "error" : "warning"}">${icon(running ? "circle-check" : status === "not-installed" ? "package-x" : "monitor-off")}</span><div class="vnc-connection-help-copy">
      <strong>${esc(copy.title)}</strong>
      <span>${esc(copy.summary)}</span>
    </div></div>
    ${diagnostics?.operation_error ? `<div class="connection-test-status error">${icon("circle-alert")}<span>${esc(diagnostics.operation_error)}</span></div>` : ""}
    ${macos ? `<div class="vnc-setup-path"><span>${esc(tr("remote:vnc_status.enable_path", {defaultValue:"开启路径"}))}</span><code>${esc(tr("remote:vnc_status.macos_settings_path", {defaultValue:"系统设置 > 通用 > 共享 > 屏幕共享"}))}</code></div>
      <ol class="vnc-setup-steps">
        <li>${esc(tr("remote:vnc_status.macos_step_enable", {defaultValue:"开启“屏幕共享”或“远程管理”，二者选择一个即可。"}))}</li>
        <li>${esc(tr("remote:vnc_status.macos_step_account", {defaultValue:"打开右侧详情，在“允许访问”中加入此连接使用的 macOS 账号。"}))}</li>
        <li>${esc(tr("remote:vnc_status.macos_step_password", {defaultValue:"使用内置 VNC 时，允许 VNC 观看者使用密码控制屏幕并设置密码，然后在连接设置中保存该密码。"}))}</li>
      </ol>
      <div class="vnc-setup-legacy">${esc(tr("remote:vnc_status.macos_legacy_path", {defaultValue:"旧版 macOS：系统偏好设置 > 共享 > 屏幕共享"}))}</div>` : `<div class="vnc-setup-path"><span>${esc(tr("remote:vnc_status.check_items", {defaultValue:"检查项目"}))}</span><code>${esc(tr("remote:vnc_status.check_items_value", {port:Number(diagnostics?.port || profile.port || 5900), defaultValue:`VNC 服务 · TCP ${Number(diagnostics?.port || profile.port || 5900)} · 防火墙 · 连接密码`}))}</code></div>`}
    ${serviceUnit ? `<div class="vnc-setup-legacy" title="${escAttr(listenerProcess)}">${esc(tr("remote:vnc_status.service_unit", {unit:serviceUnit, defaultValue:`服务单元：${serviceUnit}`}))} · ${esc(tr("remote:vnc_status.service_state", {state:serviceState, defaultValue:`状态：${serviceState}`}))}${listenerName ? ` · ${esc(tr("remote:vnc_status.listener", {process:listenerName, defaultValue:`监听进程：${listenerName}`}))}` : ""}${diagnostics?.start_plan?.persistent ? ` · ${esc(tr("remote:vnc_status.managed_persistent", {defaultValue:"Terma 管理 · 重启后自动启动"}))}` : ""}</div>` : ""}
    ${vncServerSessionSourceMarkup(profile, diagnostics || {}, reconnectKey)}
    ${installModes}
    ${remoteGraphicsRenderingMarkup(diagnostics || {})}
    <div class="remote-service-actions">
      ${restartForSelection}${startButton}${serviceActions}
      ${options.preflight ? "" : `<button type="button" onclick="openVncSetupGuide(${Number(profile.id)})">${icon("book-open-check")}<span>${esc(tr("remote:auto.manual_install", {defaultValue:"手动安装/配置说明"}))}</span></button>`}
      ${connectButton}
      ${options.preflight ? "" : `<button type="button" onclick="editRemoteProfile(${Number(profile.id)})">${icon("settings-2")}<span>${esc(tr("remote:actions.connection_settings", {defaultValue:"连接设置"}))}</span></button>`}
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
  vncSessionStatus(session, tr("remote:vnc_ui.detecting_port", {defaultValue:"正在检测 VNC 端口..."}), "connecting");
  let serviceAvailable = false;
  let detail = "";
  let diagnostics = null;
  const stageTimer = setTimeout(() => {
    if (vncSessions.get(key) === session && session.diagnosticToken === diagnosticToken) vncSessionStatus(session, tr("remote:vnc_ui.checking_service_ssh", {defaultValue:"正在通过 SSH 检查服务..."}), "connecting");
  }, 650);
  const planTimer = setTimeout(() => {
    if (vncSessions.get(key) === session && session.diagnosticToken === diagnosticToken) vncSessionStatus(session, tr("remote:vnc_ui.preparing_repair", {defaultValue:"正在生成修复方案..."}), "connecting");
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
  if (!commands.length) return notify(tr("remote:vnc_ui.no_copy_commands", {defaultValue:"当前没有可复制的命令"}), "info");
  try {
    await copyText(commands.join("\n"));
    notify(tr("remote:vnc_ui.commands_copied", {defaultValue:"VNC 配置命令已复制"}), "success");
  } catch (error) {
    notify(error.message || tr("remote:vnc_ui.copy_commands_failed", {defaultValue:"复制命令失败"}), "error");
  }
}

function localizedVncGuideText(value, fallback="") {
  if (value && typeof value === "object" && !Array.isArray(value) && value.key) {
    const params = value.params && typeof value.params === "object" && !Array.isArray(value.params) ? {...value.params} : {};
    if (params.component_key) {
      params.component = tr(`remote:vnc_guide.components.${String(params.component_key)}`, {
        defaultValue:String(params.component_key).toUpperCase()
      });
      delete params.component_key;
    }
    return tr(`remote:vnc_guide.${String(value.key)}`, {...params, defaultValue:fallback || String(value.key)});
  }
  return localizedRemoteTaskText(value) || fallback;
}

async function openVncSetupGuide(profileId) {
  const modal = $("modal");
  const profile = remoteProfileById(profileId);
  if (!linuxDesktopManagerConnectionIdForProfile(profile)) {
    const closeLabel = tr("remote:vnc_ui.close", {defaultValue:"关闭"});
    modal.innerHTML = `<div class="modal-card wide x11-install-guide vnc-setup-guide" role="dialog" aria-modal="true" aria-labelledby="vncSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="vncSetupGuideTitle">${esc(tr("remote:vnc_ui.setup_title", {defaultValue:"VNC 配置说明"}))}</h2><span class="muted">${esc(profile?.name || "VNC")} · ${esc(remoteProfileEndpoint(profile || {}))}</span></div><button class="icon-button" type="button" onclick="closeVncSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      ${remoteDiagnosticStatusMarkup(tr("remote:vnc_ui.standalone_detail", {defaultValue:"请在目标系统中开启屏幕共享、远程管理或独立 VNC Server，并确认当前 TCP 端口允许访问。Terma 会直接按 VNC/RFB 协议连接，不要求 SSH。"}), {tone:"success", icon:"monitor-up", title:tr("remote:vnc_ui.standalone_title", {defaultValue:"独立 VNC 服务"})})}
      ${remoteManagementUnavailableMarkup(profile, tr("remote:vnc_ui.management_link_hint", {defaultValue:"如需由 Terma 识别、安装或启停 Linux VNC 服务，并选择物理桌面、XRDP 会话或虚拟桌面，可新建并关联 SSH 管理连接。"}))}
      ${remoteDesktopProtocolGuideMarkup("vnc", {}, profile)}
      <div class="actions"><button type="button" onclick="closeVncSetupGuide()">${esc(closeLabel)}</button></div>
    </div>`;
    modal.hidden = false;
    modal.onclick = null;
    refreshIcons();
    return null;
  }
  try {
    const diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
    const guide = diagnostics.guide || {};
    const commands = Array.isArray(guide.commands) ? guide.commands.filter(Boolean) : [];
    const steps = Array.isArray(guide.steps) ? guide.steps.map(item => localizedVncGuideText(item)).filter(Boolean) : [];
    const title = localizedVncGuideText(guide.title, tr("remote:vnc_ui.install_setup_title", {defaultValue:"VNC 安装/配置说明"}));
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
      ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','stop',this)">${icon("circle-stop")}<span>${esc(tr("remote:vnc_status.stop_service", {defaultValue:"停止服务"}))}</span></button>`
      : startAvailable
        ? `<button type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','start',this)">${icon("circle-play")}<span>${esc(tr("remote:vnc_status.start_service", {defaultValue:"启动服务"}))}</span></button>`
        : "";
    const serviceActions = installed && diagnostics.platform !== "macos" ? `${serviceToggle}<button class="danger" type="button" data-ui-action-key="${escAttr(actionKey)}" onclick="runVncServerAction(${Number(profileId)},'${escAttr(key)}','uninstall',this)">${icon("package-minus")}<span>${esc(tr("remote:vnc_status.uninstall_service", {defaultValue:"卸载服务"}))}</span></button>` : "";
    const closeLabel = tr("remote:vnc_ui.close", {defaultValue:"关闭"});
    modal.innerHTML = `<div class="modal-card wide x11-install-guide vnc-setup-guide" role="dialog" aria-modal="true" aria-labelledby="vncSetupGuideTitle">
      <div class="modal-title-row"><div><h2 id="vncSetupGuideTitle">${esc(title)}</h2><span class="muted">${esc(diagnostics.ssh_connection?.name || diagnostics.platform || tr("remote:vnc_ui.remote_host", {defaultValue:"远端主机"}))}</span></div><button class="icon-button" type="button" onclick="closeVncSetupGuide()" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div>
      <div class="connection-test-status ${state === "ready" || state === "reachable" ? "success" : "warning"}">${esc(localizedVncGuideText(guide.summary, tr("remote:vnc_ui.follow_steps", {defaultValue:"请按下面步骤完成 VNC 服务配置。"})))}</div>
      ${installModes}
      ${remoteInstallManualMarkup(installPlan, {steps, commands, note:tr("remote:vnc_ui.install_privacy_note", {defaultValue:"Terma 只会在你明确授权后执行安装、启停或卸载。VNC 密码不会写入命令、日志或本窗口；本机也无法联网时，请在其他匹配远端系统版本与 CPU 架构的设备准备软件包和全部依赖。"})})}
      <div id="vncSetupTaskState"></div>
      <div class="actions"><button type="button" onclick="closeVncSetupGuide()">${esc(closeLabel)}</button>${serviceActions}${commands.length ? `<button type="button" onclick="copyVncSetupCommands()">${icon("copy")}<span>${esc(tr("remote:vnc_ui.copy_commands", {defaultValue:"复制命令"}))}</span></button>` : ""}</div>
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
    notify(error.message || tr("remote:vnc_ui.guide_read_failed", {defaultValue:"VNC 安装说明读取失败"}), "error");
    if (typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)) {
      return repairRemoteManagementCredentials(profileId, "vnc");
    }
    return null;
  }
}

async function runVncServerAction(profileId, key, action, button=null) {
  const actionKey = vncServerActionKey(profileId);
  const busyLabel = action === "stop" || action === "disable"
    ? tr("remote:vnc_ui.stopping", {defaultValue:"停止中..."})
    : action === "uninstall"
      ? tr("remote:vnc_ui.uninstalling", {defaultValue:"卸载中..."})
      : action === "install" || action === "install-offline" || action === "install-local-offline"
        ? tr("remote:vnc_ui.installing", {defaultValue:"安装中..."})
        : tr("remote:vnc_ui.starting", {defaultValue:"启动中..."});
  if (!beginUiAction(actionKey, button, busyLabel)) {
    notify(tr("remote:vnc_ui.task_running", {defaultValue:"VNC 服务任务正在执行，请等待完成"}), "info");
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
  if (!profile) return notify(tr("remote:vnc_status.connection_missing", {defaultValue:"VNC 连接不存在"}), "error");
  const session = vncSessions.get(key);
  let diagnostics = session?.helpState?.diagnostics || {};
  if (!Object.keys(diagnostics).length) diagnostics = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`);
  const sourceId = Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || diagnostics.ssh_connection?.id || 0);
  if (!sourceId) return notify(tr("remote:vnc_ui.no_ssh_management", {defaultValue:"该 VNC 连接没有关联的 SSH 管理连接"}), "error");
  const isInstall = action === "install" || action === "install-offline" || action === "install-local-offline";
  const uninstall = action === "uninstall";
  const stop = action === "stop" || action === "disable";
  const offlineInstall = action === "install-offline";
  const localOfflineInstall = action === "install-local-offline";
  const installModeLabel = localOfflineInstall
    ? tr("remote:vnc_ui.mode_local_offline", {defaultValue:"本机下载后离线"})
    : offlineInstall
      ? tr("remote:vnc_ui.mode_remote_cache", {defaultValue:"使用远端缓存"})
      : tr("remote:vnc_ui.mode_online", {defaultValue:"在线"});
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
        ? tr("remote:vnc_ui.password_missing_optional", {defaultValue:"当前连接没有保存 VNC 服务密码。默认请设置密码；仅在可信网络中明确选择无密码访问。"})
        : tr("remote:vnc_ui.password_missing_required", {defaultValue:"当前连接没有保存 VNC 服务密码，请先设置一个服务密码。"}),
      allowNoPassword:startPlanSupportsNoPassword,
      updateByDefault:true,
      title:startPlanSupportsNoPassword ? tr("remote:vnc_ui.set_service_auth", {defaultValue:"设置 VNC 服务认证"}) : tr("remote:vnc_ui.set_service_password", {defaultValue:"设置 VNC 服务密码"}),
      submitLabel:tr("remote:vnc_ui.save_continue", {defaultValue:"保存并继续"})
    });
    if (!credentials) return null;
    allowNoPassword = credentials.allow_no_password === true;
    if (!credentials.credentials?.password && !allowNoPassword) return null;
    transientVncPassword = String(credentials.credentials.password);
    saveVncPasswordAfterConfirm = Boolean(credentials.update_saved_password && transientVncPassword);
  }
  const message = isInstall
    ? localOfflineInstall
      ? tr("remote:vnc_ui.confirm_local_offline_install", {defaultValue:"Terma 将根据远端 Debian/Ubuntu 或兼容 APT/.deb 系统的软件包索引，在本机下载匹配架构的软件包和依赖，再通过 SFTP 上传并使用临时管理员权限安装。是否继续？"})
      : tr("remote:vnc_ui.confirm_remote_install", {mode:offlineInstall ? tr("remote:vnc_ui.cache_offline", {defaultValue:"缓存离线"}) : tr("remote:vnc_ui.online", {defaultValue:"在线"}), defaultValue:`Terma 将在远端执行${offlineInstall ? "缓存离线" : "在线"}安装。安装不会自动覆盖现有 VNC 配置，是否继续？`})
    : uninstall
      ? tr("remote:vnc_ui.confirm_uninstall", {defaultValue:"将停止并卸载远端 VNC Server 与剪贴板辅助软件包。不会卸载 Linux 桌面环境，但现有 VNC 会话会立即断开。是否继续？"})
      : stop
        ? tr("remote:vnc_ui.confirm_stop", {defaultValue:"将停止远端 VNC 服务，现有 VNC 会话会立即断开。是否继续？"})
        : tr("remote:vnc_ui.confirm_start", {defaultValue:"Terma 将尝试启动检测到的 VNC 服务单元，是否继续？"});
  const actionLabel = isInstall
    ? tr("remote:vnc_ui.install_service_action", {mode:installModeLabel, defaultValue:`${installModeLabel}安装 VNC 服务`})
    : uninstall ? tr("remote:vnc_ui.uninstall_service_action", {defaultValue:"卸载 VNC 服务"})
      : stop ? tr("remote:vnc_ui.stop_service_action", {defaultValue:"停止 VNC 服务"})
        : tr("remote:vnc_ui.start_service_action", {defaultValue:"启动 VNC 服务"});
  const confirmLabel = isInstall ? tr("remote:vnc_ui.install", {defaultValue:"安装"}) : uninstall ? tr("remote:vnc_ui.uninstall", {defaultValue:"卸载"}) : stop ? tr("remote:vnc_ui.stop", {defaultValue:"停止"}) : tr("remote:vnc_ui.start", {defaultValue:"启动"});
  if (!await confirmModal(message, actionLabel, confirmLabel, tr("remote:vnc_ui.cancel", {defaultValue:"取消"}), uninstall || stop)) return null;
  let adminAuth = null;
  if (diagnostics.privileged !== true) {
    adminAuth = await requestRemoteAdminAuthorization(sourceId, actionLabel, `vnc.server.${action}`);
    if (!adminAuth) return null;
  }
  if (button) setButtonBusy(button, true, isInstall ? tr("remote:vnc_ui.installing_mode", {mode:installModeLabel, defaultValue:`${installModeLabel}安装中...`}) : uninstall ? tr("remote:vnc_ui.uninstalling", {defaultValue:"卸载中..."}) : stop ? tr("remote:vnc_ui.stopping", {defaultValue:"停止中..."}) : tr("remote:vnc_ui.starting", {defaultValue:"启动中..."}));
  if (session) vncSessionStatus(session, isInstall ? tr("remote:vnc_ui.installing_service", {mode:installModeLabel, defaultValue:`正在${installModeLabel}安装 VNC 服务...`}) : uninstall ? tr("remote:vnc_ui.uninstalling_service", {defaultValue:"正在卸载 VNC 服务..."}) : stop ? tr("remote:vnc_ui.stopping_service", {defaultValue:"正在停止 VNC 服务..."}) : tr("remote:vnc_ui.configuring_starting", {defaultValue:"正在配置并启动 VNC 服务..."}), "connecting");
  try {
    const result = await api(`/api/remote-profiles/${Number(profileId)}/vnc/server`, {method:"POST", body:JSON.stringify({action, allow_no_password:allowNoPassword === true, ...(transientVncPassword ? {vnc_password:transientVncPassword} : {}), ...(adminAuth ? {admin_auth:adminAuth} : {})})});
    if (saveVncPasswordAfterConfirm && !result.task_conflict) {
      try {
        await saveVncCredential(profile, transientVncPassword);
      } catch (error) {
        notify(tr("remote:vnc_ui.password_save_failed_after_submit", {error:error.message, defaultValue:`服务请求已提交，但密码未能保存，将仅用于本次启动：${error.message}`}), "info");
      }
    }
    if (result.task) {
      const modalTaskHost = Number($("modal")?._vncProfileId || 0) === Number(profileId) ? $("vncSetupTaskState") : null;
      const taskStateContainer = $("vncServerState");
      const sessionTaskHost = vncSessions.get(key)?.help || null;
      const taskFallbackContainer = taskStateContainer || sessionTaskHost || null;
      const taskScope = captureRemoteComponentTaskScope(profileId, key, taskFallbackContainer || modalTaskHost);
      const runningLabel = remoteTaskActionLabel(result.task)
        || remoteTaskComponentLabel(result.task)
        || actionLabel;
      if (session) vncSessionStatus(session, result.task_conflict ? tr("remote:tasks.operation_running", {action:runningLabel, defaultValue:`${runningLabel}任务正在执行`}) : tr("remote:tasks.added_to_center", {action:actionLabel, defaultValue:`${actionLabel}已加入任务中心`}), "connecting");
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
      const requestAccepted = notifyRemoteComponentTaskRequest(result, actionLabel, tr("remote:tasks.added_to_center", {action:actionLabel, defaultValue:`${actionLabel}已加入任务中心`}));
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
    notify(isInstall ? tr("remote:vnc_ui.install_complete", {defaultValue:"VNC 服务组件安装完成，可继续配置并启动"}) : uninstall ? tr("remote:vnc_ui.uninstall_complete", {defaultValue:"VNC 服务卸载完成"}) : stop ? tr("remote:vnc_ui.stop_complete", {defaultValue:"VNC 服务已停止"}) : tr("remote:vnc_ui.configure_start_complete", {defaultValue:"VNC 服务配置/启动命令已执行"}), "success");
    return result;
  } catch (error) {
    refreshAfterError = true;
    notify(error.message || tr("remote:vnc_ui.operation_failed", {defaultValue:"VNC 服务操作失败"}), "error");
    if (session) vncSessionStatus(session, error.message || tr("remote:vnc_ui.operation_failed", {defaultValue:"VNC 服务操作失败"}), "error");
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
  if (!profile || profile.protocol !== "vnc") return notify(tr("remote:vnc_status.connection_missing", {defaultValue:"VNC 连接不存在"}), "error");
  const view = $("view-remote-desktop");
  if (!view) return null;
  const renderScope = captureRemoteDesktopRenderScope(profile.id, key, view);
  const existingSession = vncSessions.get(key);
  if (existingSession?.workspace && (existingSession.connected || existingSession.connecting)) {
    if (!await prepareEmbeddedVncWindowSwitch(profile.id)) return null;
    existingSession.presentation = "viewer";
    return withRemoteDesktopRenderScope(renderScope, () => {
      renderEmbeddedVnc(profile, key);
      return true;
    }) || null;
  }
  if (button) setButtonBusy(button, true, tr("remote:vnc_ui.opening", {defaultValue:"打开中..."}));
  try {
    const [diagnostics, desktopDiagnostics] = await Promise.all([
      api(`/api/remote-profiles/${Number(profileId)}/vnc/server`).catch(() => null),
      inspectLinuxDesktopForRemoteProfile(profile)
    ]);
    if (desktopDiagnostics?.platform_supported !== false && desktopDiagnostics && !desktopDiagnostics.has_desktop) {
      withRemoteDesktopRenderScope(renderScope, () => renderLinuxDesktopMissingWorkspace(profile, key, desktopDiagnostics));
      return null;
    }
    if (!withRemoteDesktopRenderScope(renderScope, () => true)) return null;
    if (!await prepareEmbeddedVncWindowSwitch(profile.id)) return null;
    return withRemoteDesktopRenderScope(renderScope, () => {
      renderEmbeddedVnc(profile, key, diagnostics || desktopDiagnostics);
      return true;
    }) || null;
  } catch (error) {
    withRemoteDesktopRenderScope(renderScope, () => notify(error.message || tr("remote:vnc_ui.embedded_open_failed", {defaultValue:"内置 VNC 打开失败"}), "error"));
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

function renderEmbeddedVnc(profile, key, diagnostics=null, targetView=null, detached=isDetachedVncWindow()) {
  const view = targetView || $("view-remote-desktop");
  let session = vncSessions.get(key);
  if (session?.workspace) {
    view.replaceChildren(session.workspace);
    session.presentation = "viewer";
    session.profile = profile;
    session.clipboardAutoSyncImages = profile.options?.auto_sync_images !== false;
    const sourceConnection = currentConnection(Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0));
    const sourcePlatform = String(sourceConnection?.terminal_program_platform || "").toLowerCase();
    session.vncServerDiagnostics = diagnostics || session.vncServerDiagnostics || null;
    session.remotePlatform = diagnostics?.platform || diagnostics?.os_id || (["macos", "darwin"].includes(sourcePlatform) ? "macos" : "") || session.remotePlatform || "";
    session.viewport = session.workspace.querySelector("#vncViewport");
    session.screen = session.workspace.querySelector(".vnc-screen") || session.screen;
    bindVncInteractionTracking(session);
    applyVncDisplayMode(session);
    applyVncCursorPolicy(session);
    session.status = session.workspace.querySelector("#vncStatus");
    session.clipboardStatus = session.workspace.querySelector("#vncClipboardStatus");
    session.clipboardHelperButton = session.workspace.querySelector("[data-vnc-clipboard-helper]");
    session.clipboardSyncButton = session.workspace.querySelector("[data-vnc-clipboard-sync]");
    session.clipboardSendImageButton = session.workspace.querySelector("[data-vnc-clipboard-send-image]");
    session.clipboardReceiveImageButton = session.workspace.querySelector("[data-vnc-clipboard-receive-image]");
    session.clipboardReceiveButton = session.workspace.querySelector("[data-vnc-clipboard-receive]");
    session.help = session.viewport?.querySelector("#vncConnectionHelp") || null;
    vncSessionStatus(session, session.statusText || tr("remote:vnc_ui.connecting_endpoint", {endpoint:remoteProfileEndpoint(profile), defaultValue:`正在连接 ${remoteProfileEndpoint(profile)}`}), session.statusState || "connecting");
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
  const connectingLabel = tr("remote:vnc_ui.connecting_endpoint", {endpoint:remoteProfileEndpoint(profile), defaultValue:`正在连接 ${remoteProfileEndpoint(profile)}`});
  const clipboardManualLabel = tr("remote:clipboard.manual", {defaultValue:"剪贴板：手动"});
  const backLabel = tr("remote:vnc_ui.back_management", {defaultValue:"返回探测与管理"});
  const ctrlAltDeleteLabel = tr("remote:vnc_ui.send_ctrl_alt_delete", {defaultValue:"发送 Ctrl+Alt+Del"});
  const clipboardHelperLabel = tr("remote:clipboard.configure_helper", {defaultValue:"设置 SSH 剪贴板辅助"});
  const clipboardHelperShort = tr("remote:clipboard.helper_short", {defaultValue:"SSH 辅助"});
  const clipboardSyncLabel = tr("remote:clipboard.enable_auto_sync", {defaultValue:"开启剪贴板自动同步"});
  const clipboardSendLabel = tr("remote:clipboard.send_local", {defaultValue:"发送本机剪贴板"});
  const clipboardSendImageLabel = tr("remote:clipboard.send_local_image", {defaultValue:"发送本机剪贴板图片"});
  const clipboardEmptyRemoteLabel = tr("remote:clipboard.remote_not_sent", {defaultValue:"远端尚未发送剪贴板"});
  const clipboardReceiveImageLabel = tr("remote:clipboard.read_remote_image", {defaultValue:"读取远端剪贴板图片"});
  const cursorAutoLabel = tr("remote:vnc_ui.cursor_auto", {defaultValue:"鼠标模式：自动"});
  const fullscreenLabel = tr("remote:vnc_ui.enter_fullscreen", {defaultValue:"进入内部全屏"});
  const newWindowLabel = tr("remote:vnc_ui.open_new_window", {defaultValue:"在新窗口打开"});
  const closeWindowLabel = tr("remote:vnc_ui.close_new_window", {defaultValue:"关闭此 VNC 窗口"});
  const serviceManagementLabel = tr("remote:vnc_ui.service_management", {defaultValue:"VNC 服务管理"});
  const reconnectLabel = tr("remote:vnc_status.reconnect", {defaultValue:"重新连接"});
  const systemClientLabel = tr("remote:vnc_ui.use_system_client", {defaultValue:"改用系统客户端"});
  const connectionSettingsLabel = tr("remote:actions.connection_settings", {defaultValue:"连接设置"});
  view.innerHTML = `<div class="vnc-workspace" data-vnc-key="${escAttr(key)}">
    <div class="vnc-fullscreen-toolbar-edge-zone" aria-hidden="true"></div>
    <div class="vnc-toolbar">
      <div class="vnc-toolbar-status"><span class="terminal-connection-dot"></span><span id="vncStatus" class="vnc-status connecting">${esc(connectingLabel)}</span><button id="vncClipboardStatus" class="vnc-clipboard-status clickable" type="button" onclick="configureVncClipboardSsh('${escAttr(key)}')" role="status" aria-live="polite">${esc(clipboardManualLabel)}</button></div>
      <div class="vnc-toolbar-actions">
        ${detached ? "" : `<button class="icon-button" onclick="showVncManagement(${profile.id},'${escAttr(key)}')" title="${escAttr(backLabel)}" aria-label="${escAttr(backLabel)}">${icon("arrow-left")}</button>`}
        <button class="icon-button" onclick="sendVncCtrlAltDelete('${escAttr(key)}')" title="${escAttr(ctrlAltDeleteLabel)}" aria-label="${escAttr(ctrlAltDeleteLabel)}">${icon("keyboard")}</button>
        <button class="vnc-clipboard-helper-button" data-vnc-clipboard-helper onclick="configureVncClipboardSsh('${escAttr(key)}')" title="${escAttr(clipboardHelperLabel)}" aria-label="${escAttr(clipboardHelperLabel)}">${icon("link-2")}<span>${esc(clipboardHelperShort)}</span></button>
        <button class="icon-button" data-vnc-clipboard-sync onclick="toggleVncClipboardSync('${escAttr(key)}')" title="${escAttr(clipboardSyncLabel)}" aria-label="${escAttr(clipboardSyncLabel)}" aria-pressed="false">${icon("clipboard-check")}</button>
        <button class="icon-button" onclick="pasteClipboardToVnc('${escAttr(key)}')" title="${escAttr(clipboardSendLabel)}" aria-label="${escAttr(clipboardSendLabel)}">${icon("clipboard-paste")}</button>
        <button class="icon-button" data-vnc-clipboard-send-image onclick="sendVncClipboardImage('${escAttr(key)}',true)" title="${escAttr(clipboardSendImageLabel)}" aria-label="${escAttr(clipboardSendImageLabel)}">${icon("image-up")}</button>
        <button class="icon-button" data-vnc-clipboard-receive onclick="copyVncClipboardFromRemote('${escAttr(key)}')" title="${escAttr(clipboardEmptyRemoteLabel)}" aria-label="${escAttr(clipboardEmptyRemoteLabel)}" disabled>${icon("clipboard-copy")}</button>
        <button class="icon-button" data-vnc-clipboard-receive-image onclick="receiveVncClipboardImage('${escAttr(key)}',true)" title="${escAttr(clipboardReceiveImageLabel)}" aria-label="${escAttr(clipboardReceiveImageLabel)}">${icon("image-down")}</button>
        <button class="icon-button" data-vnc-cursor-mode onclick="showVncCursorModeMenu(event,'${escAttr(key)}')" title="${escAttr(cursorAutoLabel)}" aria-label="${escAttr(cursorAutoLabel)}" aria-pressed="false">${icon("mouse-pointer-2")}</button>
        <button class="icon-button" data-vnc-fullscreen-toggle onclick="toggleVncFullscreen('${escAttr(key)}')" title="${escAttr(fullscreenLabel)}" aria-label="${escAttr(fullscreenLabel)}">${icon("maximize-2")}</button>
        ${detached ? "" : `<button class="icon-button" onclick="openVncInNewWindow(${profile.id},'${escAttr(key)}')" title="${escAttr(newWindowLabel)}" aria-label="${escAttr(newWindowLabel)}">${icon("panel-top-open")}</button>`}
        ${detached ? "" : `<button class="icon-button" onclick="openVncSetupGuide(${profile.id})" title="${escAttr(serviceManagementLabel)}" aria-label="${escAttr(serviceManagementLabel)}">${icon("server-cog")}</button>`}
        <button class="icon-button" onclick="reconnectEmbeddedVnc(${profile.id},'${escAttr(key)}')" title="${escAttr(reconnectLabel)}" aria-label="${escAttr(reconnectLabel)}">${icon("refresh-cw")}</button>
        ${detached ? "" : `<button class="icon-button" onclick="launchRemoteDesktop(${profile.id},'${escAttr(key)}',this)" title="${escAttr(systemClientLabel)}" aria-label="${escAttr(systemClientLabel)}">${icon("external-link")}</button>`}
        ${detached ? `<button class="icon-button" onclick="closeDetachedVncWindow('${escAttr(key)}')" title="${escAttr(closeWindowLabel)}" aria-label="${escAttr(closeWindowLabel)}">${icon("x")}</button>` : `<button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="${escAttr(connectionSettingsLabel)}" aria-label="${escAttr(connectionSettingsLabel)}">${icon("settings-2")}</button>`}
      </div>
    </div>
    <div id="vncViewport" class="vnc-viewport" tabindex="0"><div id="vncConnectionHelp" class="vnc-connection-help" hidden></div></div>
  </div>`;
  if (!detached && typeof remoteWorkspaceJumpButtonsHtml === "function") {
    const jumpButtons = remoteWorkspaceJumpButtonsHtml(profile);
    if (jumpButtons) view.querySelector(".vnc-toolbar-actions")?.insertAdjacentHTML("afterbegin", jumpButtons);
  }
  const viewport = view.querySelector("#vncViewport");
  if (!session) {
    session = {key, profile, rfb:null, screen:document.createElement("div"), status:null, statusText:"", statusState:"connecting", connecting:false, connected:false, clipboardAutoSync:!profile.options?.view_only, clipboardAutoSyncImages:profile.options?.auto_sync_images !== false, remoteClipboardAvailable:false, remoteClipboardPending:false, managementNodes};
    session.screen.className = "vnc-screen";
    vncSessions.set(key, session);
  } else if (!session.managementNodes?.length && managementNodes.length) {
    session.managementNodes = managementNodes;
  }
  session.workspace = view.querySelector(".vnc-workspace");
  session.presentation = "viewer";
  session.profile = profile;
  session.clipboardAutoSyncImages = profile.options?.auto_sync_images !== false;
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
  session.clipboardSendImageButton = view.querySelector("[data-vnc-clipboard-send-image]");
  session.clipboardReceiveImageButton = view.querySelector("[data-vnc-clipboard-receive-image]");
  session.clipboardReceiveButton = view.querySelector("[data-vnc-clipboard-receive]");
  session.viewport = viewport;
  session.help = viewport.querySelector("#vncConnectionHelp");
  viewport.appendChild(session.screen);
  bindVncInteractionTracking(session);
  applyVncDisplayMode(session);
  if (session.helpState) showVncConnectionHelp(session, session.helpState.serviceAvailable, session.helpState.detail, session.helpState.diagnostics);
  vncSessionStatus(session, session.statusText || tr("remote:vnc_ui.connecting_endpoint", {endpoint:remoteProfileEndpoint(profile), defaultValue:`正在连接 ${remoteProfileEndpoint(profile)}`}), session.statusState || "connecting");
  renderVncClipboardControls(session);
  refreshIcons();
  if (!session.rfb && !session.connecting) connectEmbeddedVnc(profile, key);
}

function bindVncInteractionTracking(session) {
  const screen = session?.screen;
  if (!screen || session.interactionTrackingScreen === screen) return;
  session.interactionTrackingScreen = screen;
  const markInteraction = () => { session.lastInteractionAt = Date.now(); };
  screen.addEventListener("pointerdown", markInteraction, {passive:true});
  screen.addEventListener("pointermove", markInteraction, {passive:true});
  screen.addEventListener("wheel", markInteraction, {passive:true});
  screen.addEventListener("keydown", markInteraction);
}

function syncEmbeddedVncManagementControls(session, view=$("view-remote-desktop")) {
  if (!session || !view) return;
  const launchButton = view.querySelector("#remoteDesktopLaunchButton");
  if (launchButton) {
    setButtonBusy(launchButton, false);
    launchButton.disabled = false;
    launchButton.title = tr("remote:vnc_status.reenter_embedded_title", {defaultValue:"重新进入仍在运行的内置 VNC 桌面"});
    const label = launchButton.querySelector("span");
    if (label) label.textContent = tr("remote:vnc_status.reenter", {defaultValue:"重新进入"});
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
      ? tr("remote:vnc_status.embedded_running", {defaultValue:"内置 VNC 桌面仍在运行，可以重新进入或关闭桌面"})
      : tr("remote:vnc_status.embedded_disconnected", {defaultValue:"内置 VNC 桌面已断开，可以重新进入或关闭桌面"});
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
  if (!profile || profile.protocol !== "vnc") return notify(tr("remote:vnc_status.connection_missing", {defaultValue:"VNC 连接不存在"}), "error");
  if (button) setButtonBusy(button, true, tr("remote:vnc_ui.closing", {defaultValue:"关闭中..."}));
  try {
    closeRemoteProtocolSession(key);
    setWorkspaceTabConnectionStatus(key, "disconnected");
    notify(tr("remote:vnc_ui.embedded_closed", {defaultValue:"内置 VNC 桌面已关闭"}), "success");
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
  vncSessionStatus(session, tr("remote:vnc_ui.connecting_endpoint", {endpoint:remoteProfileEndpoint(profile), defaultValue:`正在连接 ${remoteProfileEndpoint(profile)}`}), "connecting");
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
      vncSessionStatus(session, profile.options?.view_only ? tr("remote:vnc_ui.connected_view_only", {defaultValue:"已连接 · 仅查看"}) : tr("remote:vnc_ui.connected_control", {defaultValue:"已连接 · 可控制"}), "connected");
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
      void handleVncSecurityFailure(profile, key, rfb, event.detail?.reason || tr("remote:vnc_ui.auth_failed", {defaultValue:"VNC 认证失败"}));
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
      if (event.detail?.clean) return vncSessionStatus(session, tr("remote:vnc_ui.session_ended", {defaultValue:"VNC 会话已结束"}));
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
    vncSessionStatus(session, error.message || tr("remote:vnc_ui.embedded_start_failed", {defaultValue:"内置 VNC 启动失败"}), "error");
    void diagnoseEmbeddedVncDisconnect(profile, key);
    if (profile.options?.client_mode !== "embedded" && !session.systemFallbackStarted) {
      session.systemFallbackStarted = true;
      const diagnostics = await api("/api/remote-clients/diagnostics").catch(() => null);
      if (!isCurrentConnection()) return;
      if (diagnostics?.vnc?.available) {
        notify(tr("remote:vnc_ui.fallback_system_client", {defaultValue:"内置 VNC 不可用，正在改用系统客户端"}), "info");
        await launchRemoteDesktop(profile.id, key).catch(fallbackError => notify(fallbackError.message, "error"));
      }
    }
  }
}

async function saveVncCredential(profile, password) {
  if (!requireConfigEncryptionUnlocked(tr("remote:vnc_ui.save_password", {defaultValue:"保存 VNC 密码"}))) throw new Error(tr("remote:vnc_ui.encryption_locked", {defaultValue:"配置加密已锁定"}));
  const result = await api(`/api/remote-profiles/${profile.id}/vnc-credential`, {method:"PUT", body:JSON.stringify({password})});
  profile.has_password = Boolean(result.has_password);
  return result;
}

async function handleVncSecurityFailure(profile, key, rfb, reason) {
  const session = vncSessions.get(key);
  if (!session || session.rfb !== rfb || session.authRetrying) return;
  session.authRetrying = true;
  vncSessionStatus(session, reason || tr("remote:vnc_ui.auth_failed", {defaultValue:"VNC 认证失败"}), "error");
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
    return vncSessionStatus(session, tr("remote:vnc_ui.auth_retry_cancelled", {defaultValue:"VNC 认证失败，已取消重新输入"}), "error");
  }
  if (result.update_saved_password) {
    await saveVncCredential(profile, result.credentials.password).catch(error => notify(tr("remote:vnc_ui.password_save_failed", {error:error.message, defaultValue:`密码未能保存：${error.message}`}), "error"));
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
    modal.innerHTML = `<form class="modal-card vnc-credentials-modal"><h2>${esc(options.title || tr("remote:vnc_ui.connect_named", {name:profile.name, defaultValue:`连接 ${profile.name}`}))}</h2>
      ${options.failureReason ? `<div class="connection-test-status error">${esc(options.failureReason || tr("remote:vnc_ui.password_incorrect", {defaultValue:"VNC 密码错误，请重新输入"}))}</div>` : ""}
      ${required.has("username") ? `<label>${esc(tr("remote:vnc_ui.username", {defaultValue:"用户名"}))}</label><input id="vncCredentialUsername" autocomplete="username" value="${escAttr(profile.username || "")}">` : ""}
      ${required.has("target") ? `<label>${esc(tr("remote:vnc_ui.target_session", {defaultValue:"目标会话"}))}</label><input id="vncCredentialTarget" autocomplete="off">` : ""}
      <label>${esc(tr("remote:vnc_ui.vnc_password", {defaultValue:"VNC 密码"}))}</label><input id="vncCredentialPassword" type="password" autocomplete="current-password" autofocus required>
      ${allowNoPassword ? `<label class="checkline"><input id="vncCredentialNoPassword" type="checkbox">${esc(tr("remote:vnc_ui.allow_no_password", {defaultValue:"允许无密码访问（仅限可信网络）"}))}</label>` : ""}
      <label class="checkline"><input id="vncCredentialSave" type="checkbox" ${options.updateByDefault ? "checked" : ""}>${esc(profile.has_password ? tr("remote:vnc_ui.update_saved_password", {defaultValue:"更新保存密码"}) : tr("remote:vnc_ui.save_password", {defaultValue:"保存密码"}))}</label>
      <div class="muted">${esc(tr("remote:vnc_ui.password_storage_hint", {defaultValue:"密码会加密存储；取消勾选时只用于本次 VNC 会话。无密码模式不会保存密码。"}))}</div>
      <div class="actions"><button type="button" data-vnc-cancel>${esc(tr("remote:vnc_ui.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${esc(options.submitLabel || tr("remote:vnc_ui.connect", {defaultValue:"连接"}))}</button></div></form>`;
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
        notify(tr("remote:vnc_ui.password_or_no_password_required", {defaultValue:"请输入 VNC 密码，或明确勾选允许无密码访问"}), "error");
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
  if (!rfb) return notify(tr("remote:clipboard.vnc_not_connected", {defaultValue:"VNC 尚未连接"}), "info");
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
    const reason = error.message || tr("remote:clipboard.browser_read_denied", {defaultValue:"浏览器未允许读取剪贴板"});
    text = await requestVncClipboardText(session, tr("remote:clipboard.manual_paste_reason", {reason, defaultValue:`${reason}，请在下方手动粘贴。`}));
    if (text === null) return setVncClipboardStatus(session, tr("remote:clipboard.send_cancelled", {defaultValue:"已取消发送"}), "", 1600);
  }
  await sendVncClipboardText(session, text, true);
  focusEmbeddedVnc(session);
}

async function copyVncClipboardFromRemote(key) {
  const session = vncSessions.get(key);
  if (!session) return notify(tr("remote:clipboard.vnc_not_connected", {defaultValue:"VNC 尚未连接"}), "info");
  if (vncClipboardBridgeCandidate(session)) {
    try { await pollVncRemoteClipboardBridge(session, true); }
    catch (error) { return notify(error.message || tr("remote:clipboard.remote_read_failed", {defaultValue:"读取远端系统剪贴板失败"}), "error"); }
  }
  if (!session.remoteClipboardAvailable) return notify(tr("remote:clipboard.remote_content_missing", {defaultValue:"远端尚未发送剪贴板内容"}), "info");
  try {
    await writeVncLocalClipboard(session.remoteClipboardText, true);
    session.clipboardLastSeenLocal = session.remoteClipboardText;
    session.remoteClipboardPending = false;
    session.clipboardPermissionBlocked = false;
    setVncClipboardStatus(session, tr("remote:clipboard.remote_read", {defaultValue:"已读取远端剪贴板"}), "success", 2200);
    notify(tr("remote:clipboard.remote_copied_local", {defaultValue:"远端剪贴板已复制到本机"}), "success");
  } catch (error) {
    setVncClipboardStatus(session, tr("remote:clipboard.remote_read_failed", {defaultValue:"读取远端剪贴板失败"}), "error");
    notify(error.message || tr("remote:clipboard.local_write_failed", {defaultValue:"写入本机剪贴板失败"}), "error");
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
    notify(tr("remote:clipboard.auto_sync_disabled", {defaultValue:"已关闭 VNC 剪贴板自动同步"}), "info");
    focusEmbeddedVnc(session);
    return;
  }
  try {
    const snapshot = await readVncLocalClipboardSnapshot(Boolean(session.clipboardAutoSyncImages));
    session.clipboardPermissionBlocked = false;
    session.clipboardPermissionNoticeShown = false;
    session.clipboardAutoSync = true;
    if (snapshot.imageAvailable && session.clipboardAutoSyncImages && snapshot.image) {
      await sendVncClipboardImageBytes(session, snapshot.image, false);
    } else if (!snapshot.imageAvailable && snapshot.textAvailable) {
      const text = snapshot.text;
      if (!session.remoteClipboardAvailable || text !== session.remoteClipboardText) await sendVncClipboardText(session, text, false);
      else session.clipboardLastSeenLocal = text;
    }
    startVncClipboardPolling(session);
    setVncClipboardStatus(session, tr("remote:clipboard.auto_sync", {defaultValue:"剪贴板：自动同步"}), "active");
    notify(session.clipboardAutoSyncImages
      ? tr("remote:clipboard.auto_sync_enabled_with_images", {defaultValue:"已开启 VNC 文本和图片自动同步；仅在 Terma 位于前台时读取本机剪贴板"})
      : tr("remote:clipboard.auto_sync_enabled", {defaultValue:"已开启 VNC 剪贴板自动同步；仅在 Terma 位于前台时读取本机剪贴板"}), "success");
  } catch (error) {
    session.clipboardAutoSync = false;
    session.clipboardPermissionBlocked = true;
    stopVncClipboardPolling(session);
    setVncClipboardStatus(session, tr("remote:clipboard.permission_limited", {defaultValue:"剪贴板权限受限"}), "error");
    const reason = error.message || tr("remote:clipboard.local_read_failed", {defaultValue:"无法读取本机剪贴板"});
    notify(tr("remote:clipboard.manual_buttons_available", {reason, defaultValue:`${reason}；仍可使用两个手动剪贴板按钮`}), "info");
  } finally {
    focusEmbeddedVnc(session);
  }
}

async function launchRemoteDesktop(id, key="", button=null) {
  if (button) setButtonBusy(button, true, tr("remote:vnc_ui.starting", {defaultValue:"启动中..."}));
  try {
    const profile = remoteProfileById(id);
    if (!profile) throw new Error(tr("remote:vnc_ui.detached_profile_missing", {defaultValue:"远程连接不存在"}));
    const scopes = profile?.protocol === "xdmcp" ? ["remote-client", "xserver"] : ["remote-client"];
    if (!await ensureDesktopIntegrationAuthorized(scopes)) return null;
    if (["rdp", "vnc"].includes(profile.protocol)) {
      const diagnostics = await api("/api/remote-clients/diagnostics");
      const client = diagnostics?.[profile.protocol] || {};
      if (!client.available && !client.launchable) {
        throw new Error(localizedRemoteClientReason(client, diagnostics, profile.protocol));
      }
    }
    if (profile?.protocol === "rdp") {
      // The launch API performs a fresh TCP preflight. SSH/Linux diagnostics are
      // optional management information and must never block a reachable RDP service.
    }
    if (profile?.protocol === "xdmcp") {
      const managementConnectionId = linuxDesktopManagerConnectionIdForProfile(profile);
      let serverState = managementConnectionId
        ? await api(`/api/remote-profiles/${Number(id)}/xdmcp/server`).catch(() => null)
        : null;
      if (!serverState) serverState = {};
      if (serverState.session_conflict) {
        if (!serverState.can_cleanup_remote_sessions) {
          throw new Error(serverState.local_graphical_sessions?.length
            ? tr("remote:xdmcp_setup.local_plasma_conflict", {defaultValue:"同一账号正在 Linux 本地桌面运行 Plasma。请先注销本地桌面，或使用另一个 Linux 账号登录 XDMCP。"})
            : tr("remote:xdmcp_setup.remote_plasma_conflict", {defaultValue:"Plasma 已绑定到其他图形会话，Terma 无法安全自动结束；请先注销旧会话。"}));
        }
        const cleanup = await configureXdmcpHost(id, "cleanup-sessions");
        if (!cleanup) return null;
        serverState = cleanup.after;
        if (serverState.session_conflict) throw new Error(tr("remote:xdmcp_setup.conflict_cleanup_incomplete", {defaultValue:"旧的 Plasma 图形会话仍未完全退出，请稍后重新探测再启动"}));
      }
    }
    const result = await api(`/api/remote-profiles/${id}/launch`, {method:"POST", body:"{}"});
    const status = $("remoteDesktopStatus");
    if (status) {
      status.className = "connection-test-status success";
      status.textContent = result.protocol === "xdmcp"
        ? tr("remote:clients.opened_in", {client:result.client || "X Server", defaultValue:`已在 ${result.client || "X Server"} 打开`})
        : result.protocol === "rdp" && result.credentials === "stdin"
          ? tr("remote:clients.opened_password_stdin", {client:result.client || "FreeRDP", defaultValue:`已交给 ${result.client || "FreeRDP"} 打开，已通过标准输入传递保存的密码`})
          : result.protocol === "rdp" && result.credentials === "windows-credential-manager"
            ? tr("remote:clients.opened_windows_credentials", {client:result.client || tr("remote:clients.windows_remote_desktop", {defaultValue:"Windows 远程桌面"}), defaultValue:`已交给 ${result.client || "Windows 远程桌面"} 打开，已通过当前 Windows 用户的临时凭据传递密码`})
          : result.protocol === "rdp" && result.password_transfer_requested && !result.password_transfer_supported
            ? tr("remote:clients.opened_prefill_unsupported", {client:result.client || tr("remote:clients.system_client", {defaultValue:"系统客户端"}), defaultValue:`已交给 ${result.client || "系统客户端"} 打开；该客户端不支持安全预填充，仍会显示凭据窗口`})
            : tr("remote:clients.opened_client_prompts", {client:result.client || tr("remote:clients.system_client", {defaultValue:"系统客户端"}), defaultValue:`已交给 ${result.client || "系统客户端"} 打开，凭据由客户端提示`});
    }
    notify(result.protocol === "xdmcp" ? tr("remote:clients.xdmcp_started", {defaultValue:"已启动 XDMCP 图形桌面"}) : tr("remote:clients.system_client_opened", {defaultValue:"已打开系统远程桌面客户端"}), "success");
  } catch (error) {
    const status = $("remoteDesktopStatus");
    if (status) {
      status.className = "connection-test-status error";
      status.textContent = error.message || tr("remote:clients.launch_failed", {defaultValue:"远程桌面客户端启动失败"});
    }
    notify(error.message || tr("remote:clients.launch_failed", {defaultValue:"远程桌面客户端启动失败"}), "error");
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

async function installRemoteDesktopClient(profileId, protocol, button=null) {
  if (button) setButtonBusy(button, true, tr("remote:clients.processing", {defaultValue:"处理中..."}));
  try {
    if (!await ensureDesktopIntegrationAuthorized(protocol === "xdmcp" ? ["remote-client", "xserver"] : ["remote-client"])) return null;
    const result = protocol === "xdmcp"
      ? await api("/api/xserver/install", {method:"POST", body:"{}"})
      : await api("/api/remote-clients/install", {method:"POST", body:JSON.stringify({protocol})});
    if (result.opened) {
      notify(tr("remote:clients.download_page_opened", {target:result.target || tr("remote:clients.download_page", {defaultValue:"客户端下载页面"}), defaultValue:`已打开 ${result.target || "客户端下载页面"}，安装完成后返回 Terma 重新检测`}), "info");
      return result;
    }
    if (protocol === "xdmcp") await api("/api/xserver", {method:"POST", body:"{}"});
    notify(tr("remote:clients.installed", {protocol:protocol.toUpperCase(), defaultValue:`${protocol.toUpperCase()} 客户端已安装`}), "success");
    await openRemoteDesktop(profileId, false);
    return result;
  } catch (error) {
    notify(error.message || tr("remote:clients.install_failed", {defaultValue:"客户端安装失败"}), "error");
    return null;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}
