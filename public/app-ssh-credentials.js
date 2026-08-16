function sshAuthenticationFailure(value) {
  const code = String(value?.code || value?.details?.code || "").toUpperCase();
  if (code === "SSH_AUTHENTICATION_FAILED") return true;
  const text = String(value?.message || value?.error || value?.output || value || "").toLowerCase();
  return /ssh \u8ba4\u8bc1\u5931\u8d25|authentication failed|all configured authentication methods failed|no more authentication methods available|permission denied \((?:publickey|password|keyboard-interactive)/.test(text);
}

function sshCredentialRepairPayload(connection, values={}) {
  const authType = values.auth_type === "key" ? "key" : "password";
  const identityFile = authType === "key" ? String(values.identity_file || "") : "";
  const passphrase = authType === "key" ? String(values.private_key_passphrase || "") : "";
  const changedIdentity = authType === "key" && identityFile !== String(connection.identity_file || "");
  return {
    ...connection,
    id:Number(connection.id),
    ssh_user:String(values.ssh_user || "").trim(),
    ssh_port:Number(values.ssh_port || 22),
    auth_type:authType,
    identity_file:identityFile,
    ssh_password:authType === "password" ? String(values.ssh_password || "") : "",
    private_key_passphrase:passphrase,
    clear_private_key_passphrase:authType !== "key" || (changedIdentity && !passphrase),
    ssh_agent_mode:"off"
  };
}

function registerTemporarySshCredential(ticket) {
  const connection = {
    ...ticket.connection,
    id:Number(ticket.connection?.id || 0),
    quick_connection:true,
    quick_token:String(ticket.token || ""),
    terminal_font_family_inherit:1,
    terminal_font_size_inherit:1,
    terminal_mobile_font_size_inherit:1,
    terminal_line_height:1,
    terminal_font_weight:"normal"
  };
  if (!Number.isSafeInteger(connection.id) || connection.id >= 0 || !connection.quick_token) {
    throw new Error(tr("connections:credentials.temporary_create_failed", {defaultValue:"临时 SSH 凭据创建失败"}));
  }
  quickConnectionsById.set(connection.id, connection);
  return connection;
}

let sshCredentialRepairActive = false;

async function promptSshCredentialRepair(connection, options={}) {
  if (sshCredentialRepairActive || (typeof remoteCredentialRepairActive !== "undefined" && remoteCredentialRepairActive)) {
    notify(tr("connections:credentials.repair_active", {defaultValue:"已有 SSH 凭据修复窗口，请先完成当前操作"}), "info");
    return null;
  }
  sshCredentialRepairActive = true;
  const identities = await api("/api/identity-files").catch(() => []);
  const modal = $("modal");
  const temporaryAllowed = typeof options.onTemporary === "function";
  const preferredAuth = connection.auth_type === "password" ? "password" : "key";
  const identityOptions = identities.map(item => `<option value="${escAttr(item.path)}" ${String(item.path) === String(connection.identity_file || "") ? "selected" : ""}>${esc(localizedIdentityFileLabel(item, {permission:true}))}</option>`).join("");
  const context = localizedTermaUiPhrase(options.context || tr("connections:credentials.reconnect", {defaultValue:"重新连接"}));
  modal.dataset.sshCredentialRepair = "1";
  modal.innerHTML = `<form class="modal-card ssh-credential-repair-modal" role="dialog" aria-modal="true" aria-labelledby="sshCredentialRepairTitle">
    <div class="modal-title-row"><div><h2 id="sshCredentialRepairTitle">${esc(tr("connections:credentials.repair_title", {defaultValue:"修复 SSH 认证"}))}</h2><span class="muted">${esc(context)} · ${esc(connection.name || connection.ssh_host)}</span></div><button class="icon-button" type="button" data-credential-close title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div>
    <div class="ssh-credential-target"><span>${icon("server")}</span><div><strong>${esc(connection.ssh_host)}</strong><small>${esc(tr("connections:credentials.host_unchanged_hint", {defaultValue:"主机地址保持不变；可修正当前账号和 SSH 端口。"}))}</small></div></div>
    <div class="grid"><div><label for="sshCredentialUser">${esc(tr("connections:auto.ssh_user", {defaultValue:"SSH 用户名"}))}</label><input id="sshCredentialUser" required autocomplete="username" value="${escAttr(connection.ssh_user || "")}"></div><div><label for="sshCredentialPort">${esc(tr("connections:auto.ssh_port", {defaultValue:"端口"}))}</label><input id="sshCredentialPort" type="number" min="1" max="65535" required value="${Number(connection.ssh_port || 22)}"></div></div>
    <fieldset class="quick-ssh-auth-choice"><legend>${esc(tr("connections:auto.login_method", {defaultValue:"认证方式"}))}</legend>
      <label><input type="radio" name="sshCredentialAuthType" value="password" ${preferredAuth === "password" ? "checked" : ""}><span>${icon("key-round")}${esc(tr("connections:auto.password_login", {defaultValue:"密码"}))}</span></label>
      <label><input type="radio" name="sshCredentialAuthType" value="key" ${preferredAuth === "key" ? "checked" : ""}><span>${icon("file-key")}${esc(tr("connections:auto.key_login", {defaultValue:"私钥"}))}</span></label>
    </fieldset>
    <div id="sshCredentialPasswordPanel"><label for="sshCredentialPassword">${esc(tr("connections:auto.ssh_password", {defaultValue:"SSH 密码"}))}</label><input id="sshCredentialPassword" type="password" autocomplete="current-password"></div>
    <div id="sshCredentialKeyPanel"><label for="sshCredentialIdentity">${esc(tr("connections:auto.key_login", {defaultValue:"私钥"}))}</label><select id="sshCredentialIdentity"><option value="">${esc(tr("connections:identity.select", {defaultValue:"请选择私钥"}))}</option>${identityOptions}</select><div class="ssh-credential-upload"><label class="file-picker"><input id="sshCredentialKeyUpload" type="file" accept="*/*"><span class="file-picker-button">${esc(tr("connections:auto.upload_key", {defaultValue:"上传私钥"}))}</span><span class="file-picker-name" data-i18n="common:auto.not_selected">${esc(tr("common:auto.not_selected", {defaultValue:"未选择文件"}))}</span></label></div><label for="sshCredentialPassphrase">${esc(tr("connections:auto.key_passphrase", {defaultValue:"私钥口令（可选）"}))}</label><input id="sshCredentialPassphrase" type="password" autocomplete="off"></div>
    <label class="checkline ssh-credential-save"><input id="sshCredentialSave" type="checkbox" checked ${temporaryAllowed ? "" : "disabled"}><span>${esc(tr("connections:credentials.save_to_connection", {name:connection.name || connection.ssh_host, defaultValue:`保存到“${connection.name || connection.ssh_host}”连接`}))}</span></label>
    <div id="sshCredentialStatus" class="connection-test-status" aria-live="polite">${esc(tr("connections:credentials.verify_first", {defaultValue:"连接前会先验证新凭据。"}))}${esc(temporaryAllowed ? tr("connections:credentials.temporary_hint", {defaultValue:"取消保存时只创建当前终端或 SFTP 使用的临时会话，最长 12 小时。"}) : tr("connections:credentials.save_required_hint", {defaultValue:"当前操作需要保存凭据后重试。"}))}</div>
    <div class="field-help">${esc(tr("connections:credentials.upload_management_hint", {defaultValue:"上传的私钥会进入 Terma 密钥管理；即使不保存此连接，也不会自动删除已上传的密钥。"}))}</div>
    <div class="actions"><button type="button" data-credential-close>${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="sshCredentialConnect" class="primary" type="submit">${icon("link-2")}<span>${esc(tr("connections:credentials.verify_connect", {defaultValue:"验证并连接"}))}</span></button></div>
  </form>`;
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();

  return new Promise(resolve => {
    const form = modal.querySelector("form");
    const passwordPanel = $("sshCredentialPasswordPanel");
    const keyPanel = $("sshCredentialKeyPanel");
    const passwordInput = $("sshCredentialPassword");
    const identitySelect = $("sshCredentialIdentity");
    const passphraseInput = $("sshCredentialPassphrase");
    const saveInput = $("sshCredentialSave");
    const status = $("sshCredentialStatus");
    const submit = $("sshCredentialConnect");
    const closeButtons = [...modal.querySelectorAll("[data-credential-close]")];
    const radios = [...modal.querySelectorAll('input[name="sshCredentialAuthType"]')];
    const upload = $("sshCredentialKeyUpload");
    let finished = false;

    const authType = () => modal.querySelector('input[name="sshCredentialAuthType"]:checked')?.value === "key" ? "key" : "password";
    const syncAuth = () => {
      const key = authType() === "key";
      passwordPanel.hidden = key;
      keyPanel.hidden = !key;
      passwordInput.required = !key;
      identitySelect.required = key;
    };
    const clearSecrets = () => {
      if (passwordInput) passwordInput.value = "";
      if (passphraseInput) passphraseInput.value = "";
    };
    const finish = value => {
      if (finished) return;
      finished = true;
      clearSecrets();
      modal.dataset.sshCredentialRepair = "";
      modal.hidden = true;
      modal.onkeydown = null;
      modal.innerHTML = "";
      sshCredentialRepairActive = false;
      resolve(value);
    };
    const close = () => finish(null);
    closeButtons.forEach(button => button.addEventListener("click", close));
    radios.forEach(radio => radio.addEventListener("change", syncAuth));
    modal.onkeydown = event => {
      if (event.key === "Escape" && form.dataset.submitting !== "1") finish(null);
    };
    upload.addEventListener("change", async () => {
      const file = upload.files?.[0];
      updateFilePicker(upload);
      if (!file) return;
      try {
        status.className = "connection-test-status busy";
        status.textContent = tr("connections:credentials.uploading_checking", {defaultValue:"正在上传并检查私钥权限..."});
        const saved = await uploadOneKey(file);
        const option = new Option(localizedIdentityFileLabel(saved, {permission:true}), saved.path, true, true);
        identitySelect.add(option);
        identitySelect.value = saved.path;
        status.className = "connection-test-status success";
        status.textContent = tr("connections:credentials.uploaded_selected", {defaultValue:"私钥已上传并选中，可继续验证连接。"});
      } catch (error) {
        status.className = "connection-test-status error";
        status.textContent = localizedTermaUiPhrase(error.message || tr("connections:credentials.upload_failed", {defaultValue:"私钥上传失败"}));
      }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (form.dataset.submitting === "1") return;
      const values = {
        ssh_user:$("sshCredentialUser")?.value.trim() || "",
        ssh_port:Number($("sshCredentialPort")?.value || 22),
        auth_type:authType(),
        ssh_password:passwordInput?.value || "",
        identity_file:identitySelect?.value || "",
        private_key_passphrase:passphraseInput?.value || ""
      };
      if (!values.ssh_user) return notify(tr("connections:credentials.user_required", {defaultValue:"请输入 SSH 用户名"}), "error");
      if (!Number.isInteger(values.ssh_port) || values.ssh_port < 1 || values.ssh_port > 65535) return notify(tr("connections:credentials.port_invalid", {defaultValue:"SSH 端口必须在 1-65535 之间"}), "error");
      if (values.auth_type === "password" && !values.ssh_password) return notify(tr("connections:credentials.password_required", {defaultValue:"请输入 SSH 密码"}), "error");
      if (values.auth_type === "key" && !values.identity_file) return notify(tr("connections:credentials.key_required", {defaultValue:"请选择或上传私钥"}), "error");
      const payload = sshCredentialRepairPayload(connection, values);
      form.dataset.submitting = "1";
      closeButtons.forEach(button => { button.disabled = true; });
      setButtonBusy(submit, true, tr("connections:credentials.verifying", {defaultValue:"验证中..."}));
      try {
        status.className = "connection-test-status busy";
        status.textContent = tr("connections:credentials.verifying_host_credentials", {defaultValue:"正在校验主机身份和 SSH 凭据..."});
        await api("/api/ssh/preflight", {
          method:"POST",
          body:JSON.stringify({connection:{ssh_user:payload.ssh_user, ssh_host:payload.ssh_host, ssh_port:payload.ssh_port}})
        });
        const tested = await api("/api/test-ssh", {method:"POST", body:JSON.stringify(payload)});
        if (!tested.ok) throw new Error(tested.output || tested.error || tr("connections:credentials.verification_failed", {defaultValue:"SSH 凭据验证失败"}));
        const save = Boolean(saveInput?.checked || !temporaryAllowed);
        if (save) {
          status.textContent = tr("connections:credentials.verified_saving", {defaultValue:"验证成功，正在保存连接..."});
          await api(`/api/connections/${Number(connection.id)}`, {method:"PUT", body:JSON.stringify(payload)});
          finish({saved:true, connectionId:Number(connection.id)});
          return;
        }
        status.textContent = tr("connections:credentials.verified_creating_temporary", {defaultValue:"验证成功，正在创建临时会话..."});
        const connectionName = connection.name || connection.ssh_host;
        const ticketName = tr("connections:credentials.temporary_name", {name:connectionName, defaultValue:`${connectionName} · 临时认证`});
        const ticket = await api("/api/terminal/quick-tickets", {method:"POST", body:JSON.stringify({...payload, name:ticketName})});
        finish({saved:false, ticket});
      } catch (error) {
        status.className = "connection-test-status error";
        status.textContent = localizedTermaUiPhrase(error.message || tr("connections:credentials.verification_failed", {defaultValue:"SSH 凭据验证失败"}));
      } finally {
        if (!finished) {
          form.dataset.submitting = "";
          closeButtons.forEach(button => { button.disabled = false; });
          setButtonBusy(submit, false);
        }
      }
    });
    syncAuth();
    setTimeout(() => $(preferredAuth === "password" ? "sshCredentialPassword" : "sshCredentialIdentity")?.focus({preventScroll:true}), 0);
  });
}

async function repairSshCredentials(connectionId, options={}) {
  const id = Number(connectionId || options.error?.connectionId || 0);
  const connection = currentConnection(id);
  if (!connection || connection.quick_connection || id < 1) return false;
  const outcome = await promptSshCredentialRepair(connection, options);
  if (!outcome) return false;
  if (outcome.saved) {
    await loadAll();
    const savedConnection = currentConnection(id);
    notify(tr("connections:credentials.verified_saved", {defaultValue:"SSH 凭据已验证并保存"}), "success");
    if (typeof options.onSaved === "function") await options.onSaved(savedConnection || connection);
    return {saved:true, connection:savedConnection || connection};
  }
  const temporaryConnection = registerTemporarySshCredential(outcome.ticket);
  notify(tr("connections:credentials.temporary_created", {defaultValue:"已创建仅供当前操作使用的临时 SSH 会话"}), "success");
  await options.onTemporary(temporaryConnection, outcome.ticket.token);
  return {saved:false, connection:temporaryConnection, token:outcome.ticket.token};
}
