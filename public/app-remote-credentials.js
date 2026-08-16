function remoteProfileAuthenticationFailure(value, protocol="") {
  const code = String(value?.code || value?.details?.code || "").toUpperCase();
  if (code === "FTP_AUTHENTICATION_FAILED") return true;
  const text = String(value?.message || value?.error || value || "").toLowerCase();
  if (protocol === "ftp") return /\b530\b|not logged in|login incorrect|ftp \u8ba4\u8bc1\u5931\u8d25|authentication failed/.test(text);
  return false;
}

let remoteCredentialRepairActive = false;

async function promptRemoteProfileCredentialRepair(profile, options={}) {
  if (!profile || profile.protocol !== "ftp") return null;
  if (remoteCredentialRepairActive || (typeof sshCredentialRepairActive !== "undefined" && sshCredentialRepairActive)) {
    notify(tr("common:notifications.credential_repair_open", {defaultValue:"已有凭据修复窗口，请先完成当前操作"}), "info");
    return null;
  }
  if (!requireConfigEncryptionUnlocked(tr("remote:credentials.repair_context", {defaultValue:"修复 FTP 凭据"}))) return null;
  remoteCredentialRepairActive = true;
  const modal = $("modal");
  modal.dataset.remoteCredentialRepair = "1";
  modal.innerHTML = `<form class="modal-card ssh-credential-repair-modal" role="dialog" aria-modal="true" aria-labelledby="remoteCredentialRepairTitle">
    <div class="modal-title-row"><div><h2 id="remoteCredentialRepairTitle">${esc(tr("remote:credentials.repair_title", {defaultValue:"修复 FTP 认证"}))}</h2><span class="muted">${esc(options.context || tr("remote:credentials.reconnect", {defaultValue:"重新连接"}))} · ${esc(profile.name || profile.host)}</span></div><button class="icon-button" type="button" data-remote-credential-close title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div>
    <div class="ssh-credential-target"><span>${icon("server")}</span><div><strong>${esc(profile.host)}</strong><small>${esc(tr("remote:credentials.host_unchanged_hint", {defaultValue:"目标主机保持不变；验证成功后更新此 FTP 连接。"}))}</small></div></div>
    <div class="grid"><div><label for="remoteCredentialUser">${esc(tr("remote:credentials.username", {defaultValue:"FTP 用户名"}))}</label><input id="remoteCredentialUser" required autocomplete="username" value="${escAttr(profile.username || "anonymous")}"></div><div><label for="remoteCredentialPort">${esc(tr("remote:credentials.port", {defaultValue:"端口"}))}</label><input id="remoteCredentialPort" type="number" min="1" max="65535" required value="${Number(profile.port || 21)}"></div></div>
    <label for="remoteCredentialPassword">${esc(tr("remote:credentials.password", {defaultValue:"FTP 密码"}))}</label><input id="remoteCredentialPassword" type="password" autocomplete="current-password" required>
    <label class="checkline ssh-credential-save"><input id="remoteCredentialSave" type="checkbox" checked disabled><span>${esc(tr("remote:credentials.save_to_connection", {name:profile.name || profile.host, defaultValue:`验证后更新“${profile.name || profile.host}”连接`}))}</span></label>
    <div id="remoteCredentialStatus" class="connection-test-status" aria-live="polite">${esc(tr("remote:credentials.verify_hint", {defaultValue:"FTP 每次操作都会建立独立连接；新凭据会先验证，成功后才替换已保存密码。"}))}</div>
    <div class="actions"><button type="button" data-remote-credential-close>${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="remoteCredentialConnect" class="primary" type="submit">${icon("link-2")}<span>${esc(tr("remote:credentials.verify_connect", {defaultValue:"验证并连接"}))}</span></button></div>
  </form>`;
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();

  return new Promise(resolve => {
    const form = modal.querySelector("form");
    const passwordInput = $("remoteCredentialPassword");
    const status = $("remoteCredentialStatus");
    const submit = $("remoteCredentialConnect");
    const closeButtons = [...modal.querySelectorAll("[data-remote-credential-close]")];
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      if (passwordInput) passwordInput.value = "";
      modal.dataset.remoteCredentialRepair = "";
      modal.hidden = true;
      modal.onkeydown = null;
      modal.innerHTML = "";
      remoteCredentialRepairActive = false;
      resolve(value);
    };
    closeButtons.forEach(button => button.addEventListener("click", () => finish(null)));
    modal.onkeydown = event => {
      if (event.key === "Escape" && form.dataset.submitting !== "1") finish(null);
    };
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (form.dataset.submitting === "1") return;
      const username = $("remoteCredentialUser")?.value.trim() || "";
      const port = Number($("remoteCredentialPort")?.value || 21);
      const password = passwordInput?.value || "";
      if (!username) return notify(tr("remote:credentials.user_required", {defaultValue:"请输入 FTP 用户名"}), "error");
      if (!Number.isInteger(port) || port < 1 || port > 65535) return notify(tr("common:notifications.ftp_port_invalid", {defaultValue:"FTP 端口必须在 1-65535 之间"}), "error");
      if (!password) return notify(tr("remote:credentials.password_required", {defaultValue:"请输入 FTP 密码"}), "error");
      form.dataset.submitting = "1";
      closeButtons.forEach(button => { button.disabled = true; });
      setButtonBusy(submit, true, tr("remote:credentials.verifying", {defaultValue:"验证中..."}));
      try {
        status.className = "connection-test-status busy";
        status.textContent = tr("remote:credentials.verifying_details", {defaultValue:"正在验证 FTP 用户名、密码和端口..."});
        await api(`/api/remote-profiles/${Number(profile.id)}/test-credentials`, {
          method:"POST",
          body:JSON.stringify({username, password, port})
        });
        status.textContent = tr("remote:credentials.verified_updating", {defaultValue:"验证成功，正在更新连接..."});
        await api(`/api/remote-profiles/${Number(profile.id)}`, {
          method:"PUT",
          body:JSON.stringify({
            protocol:profile.protocol,
            name:profile.name,
            group_name:profile.group_name || TERMA_DEFAULT_CONNECTION_GROUP,
            host:profile.host,
            port,
            username,
            password,
            tags:profile.tags || "",
            options:profile.options || {}
          })
        });
        finish({saved:true, profileId:Number(profile.id)});
      } catch (error) {
        status.className = "connection-test-status error";
        status.textContent = error.message || tr("remote:credentials.verification_failed", {defaultValue:"FTP 凭据验证失败"});
      } finally {
        if (!finished) {
          form.dataset.submitting = "";
          closeButtons.forEach(button => { button.disabled = false; });
          setButtonBusy(submit, false);
        }
      }
    });
    setTimeout(() => passwordInput?.focus({preventScroll:true}), 0);
  });
}

async function repairRemoteProfileCredentials(profileId, options={}) {
  const id = Number(profileId || options.error?.remoteProfileId || 0);
  const profile = remoteProfileById(id);
  if (!profile) return false;
  const outcome = await promptRemoteProfileCredentialRepair(profile, options);
  if (!outcome?.saved) return false;
  await loadAll();
  const savedProfile = remoteProfileById(id) || profile;
  notify(tr("common:notifications.credential_verified", {protocol:profile.protocol.toUpperCase(), defaultValue:`${profile.protocol.toUpperCase()} 凭据已验证并保存`}), "success");
  if (typeof options.onSaved === "function") await options.onSaved(savedProfile);
  return {saved:true, profile:savedProfile};
}
