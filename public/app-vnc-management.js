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

async function launchVncWithTemporaryPassword(id, key="", button=null, clientModeOverride="") {
  const profile = remoteProfileById(id);
  if (!profile || profile.protocol !== "vnc") {
    notify(tr("remote:vnc_status.connection_missing", {defaultValue:"VNC 连接不存在"}), "error");
    return null;
  }
  const result = await requestVncCredentials(profile, ["password"], {
    title:tr("remote:vnc_ui.use_other_password_title", {name:profile.name, defaultValue:`本次连接使用其他密码 · ${profile.name}`}),
    submitLabel:tr("remote:vnc_ui.use_other_password_submit", {defaultValue:"使用此密码并打开"}),
    updateByDefault:false,
    passwordStorageHint:tr("remote:vnc_ui.temporary_password_hint", {defaultValue:"此密码只用于本次打开 VNC，不会覆盖连接设置中的已保存密码；如需保存，请勾选“保存密码”。"})
  });
  if (!result) return null;
  if (result.update_saved_password) {
    await saveVncCredential(profile, result.credentials.password).catch(error => notify(tr("remote:vnc_ui.password_save_failed", {error:error.message, defaultValue:`密码未能保存：${error.message}`}), "error"));
  }
  return launchRemoteDesktop(id, key, button, clientModeOverride, {password:result.credentials.password});
}

async function saveVncCredential(profile, password) {
  if (!requireConfigEncryptionUnlocked(tr("remote:vnc_ui.save_password", {defaultValue:"保存 VNC 密码"}))) throw new Error(tr("remote:vnc_ui.encryption_locked", {defaultValue:"配置加密已锁定"}));
  const result = await api(`/api/remote-profiles/${profile.id}/vnc-credential`, {method:"PUT", body:JSON.stringify({password})});
  profile.has_password = Boolean(result.has_password);
  return result;
}
