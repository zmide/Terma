function connPayload(form=$("connectionForm"), validateStartup=false) {
  const field = id => connectionFormField(form, id);
  const groupValue = field("conn_group").value;
  const passwordAuth = field("conn_auth_type").value === "password";
  const selectedKey = field("conn_key");
  if (!passwordAuth && selectedKey?.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1") {
    throw new Error(connectionFormIdentityWarning(form) || IDENTITY_FILE_UNSAFE_FALLBACK);
  }
  const startup = connectionTerminalFormConfig(form);
  if (validateStartup && startup.terminal_startup_mode === "program" && !startup.terminal_program_path) {
    openConnectionAdvancedOptions(form);
    const programPath = field("conn_terminal_program_path");
    programPath?.focus({preventScroll:true});
    programPath?.scrollIntoView({block:"center", behavior:"smooth"});
    throw new Error("请填写要在远端启动的程序完整路径");
  }
  return {
    id:field("conn_id").value,
    name:field("conn_name").value.trim(),
    group_name:(groupValue === "__new_group__" ? pendingGroup : groupValue).trim()||"默认分组",
    ssh_user:field("conn_user").value.trim(),
    ssh_host:field("conn_host").value.trim(),
    ssh_port:Number(field("conn_port").value||22),
    sort_order:Number(field("conn_sort_order").value||1),
    auth_type:passwordAuth ? "password" : "key",
    identity_file:passwordAuth ? "" : field("conn_key").value,
    ssh_password:passwordAuth ? field("conn_password").value : "",
    private_key_passphrase:passwordAuth ? "" : field("conn_key_passphrase")?.value || "",
    clear_private_key_passphrase:Boolean(field("conn_clear_key_passphrase")?.checked),
    ssh_agent_mode:passwordAuth ? "off" : field("conn_agent_mode")?.value || "auto",
    jump_connection_id:Number(field("conn_jump")?.value || 0) || null,
    connect_timeout_seconds:Number(field("conn_connect_timeout")?.value || 10),
    keepalive_interval_seconds:Number(field("conn_keepalive_interval")?.value ?? 60),
    keepalive_count_max:Number(field("conn_keepalive_count")?.value || 3),
    tcp_keepalive:Number(field("conn_tcp_keepalive")?.value ?? 1),
    x11_mode:field("conn_x11_mode")?.value || "off",
    tags:field("conn_tags").value.trim(),
    autostart_forwards:Number(field("conn_autostart").value),
    extra_args:field("conn_extra").value.trim(),
    ...startup
  };
}

function renderJumpConnectionOptions(selected="", currentId=0) {
  const select = $("conn_jump");
  if (!select) return;
  const items = connections.filter(item => Number(item.id) !== Number(currentId) && !item.jump_connection_id);
  select.replaceChildren(
    new Option("直接连接", ""),
    ...items.map(item => new Option(`${item.name} · ${item.ssh_user}@${item.ssh_host}:${item.ssh_port}`, String(item.id)))
  );
  select.value = selected ? String(selected) : "";
}

function toggleAuthFields() {
  const password = $("conn_auth_type")?.value === "password";
  const keyBox = $("keyAuthBox");
  const passwordBox = $("passwordAuthBox");
  if (keyBox) {
    keyBox.hidden = password;
    keyBox.setAttribute("aria-hidden", String(password));
    keyBox.querySelectorAll("input, select, button").forEach(control => { control.disabled = password; });
  }
  if (passwordBox) {
    passwordBox.hidden = !password;
    passwordBox.setAttribute("aria-hidden", String(!password));
    passwordBox.querySelectorAll("input, select, button").forEach(control => { control.disabled = !password; });
  }
  const x11 = $("conn_x11_mode");
  if (x11) x11.title = password
    ? "X11 图形转发由内置 SSH 使用已保存密码建立"
    : "X11 图形转发默认由内置 SSH 建立，必要时安全回退系统 OpenSSH";
}

function groupNames(extra="", kind="all") {
  const items = kind === "ssh" ? connections : kind === "remote" ? remoteProfiles : [...connections, ...remoteProfiles];
  const names = new Set(items.map(c => c.group_name || "默认分组"));
  names.add("默认分组");
  if (extra) names.add(extra);
  return [...names];
}

function renderGroupOptions(selected="") {
  if (!$("conn_group")) return;
  const value = selected || pendingGroup || "默认分组";
  $("conn_group").innerHTML = groupNames(value, "ssh").map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("") + `<option value="__new_group__">新增分组...</option>`;
  $("conn_group").value = value;
  pendingGroupSelectValue = value;
  $("conn_group").onchange = handleGroupSelectChange;
}

function handleGroupSelectChange() {
  if ($("conn_group").value !== "__new_group__") return;
  $("conn_group").value = pendingGroupSelectValue || "默认分组";
  openGroupModal((name) => {
    pendingGroup = name;
    groupOpen.add(pendingGroup);
    saveGroupState();
    renderGroupOptions(pendingGroup);
  });
}

function openGroupModal(onSave) {
  $("modal").hidden = false;
  $("modal").innerHTML = `<div class="modal-card">
    <h2>新增分组</h2>
    <label>分组名称</label>
    <input id="modalGroupName" placeholder="例如：生产环境">
    <div class="actions">
      <button class="primary" data-action="connection-group-save">保存</button>
      <button data-action="connection-modal-close">取消</button>
    </div>
  </div>`;
  window.pendingGroupModalSave = onSave;
  setTimeout(()=>$("modalGroupName")?.focus(), 0);
}

function saveGroupModal() {
  const name = $("modalGroupName")?.value.trim();
  if (!name) return notify("请输入分组名称", "error");
  const save = window.pendingGroupModalSave;
  closeModal();
  if (save) save(name);
}

function closeModal() {
  $("modal").hidden = true;
  $("modal").innerHTML = "";
  window.pendingGroupModalSave = null;
}

function resetConnectionForm(){
  if (!$("connectionForm")) return;
  $("connectionForm").reset();
  $("conn_id").value="";
  renderGroupOptions(pendingGroup || "默认分组");
  $("conn_port").value=22;
  $("conn_sort_order").value=1;
  $("conn_auth_type").value="key";
  $("conn_password").value="";
  if ($("conn_key_passphrase")) $("conn_key_passphrase").value="";
  if ($("conn_agent_mode")) $("conn_agent_mode").value="auto";
  if ($("conn_clear_key_passphrase")) $("conn_clear_key_passphrase").checked=false;
  if ($("connClearPassphraseLine")) $("connClearPassphraseLine").hidden=true;
  if ($("conn_connect_timeout")) $("conn_connect_timeout").value="10";
  if ($("conn_keepalive_interval")) $("conn_keepalive_interval").value="60";
  if ($("conn_keepalive_count")) $("conn_keepalive_count").value="3";
  if ($("conn_tcp_keepalive")) $("conn_tcp_keepalive").value="1";
  if ($("conn_x11_mode")) $("conn_x11_mode").value="off";
  if ($("conn_remote_generation")) $("conn_remote_generation").value="";
  if ($("connRemoteGenerationLine")) $("connRemoteGenerationLine").hidden=false;
  renderJumpConnectionOptions();
  $("conn_tags").value="";
  $("conn_autostart").value="0";
  if ($("connTestStatus")) {
    $("connTestStatus").hidden = true;
    $("connTestStatus").textContent = "";
    $("connTestStatus").className = "connection-test-status";
  }
  $("conn_extra").value="";
  renderConnectionExtraArgsDiagnostics($("connectionForm"), []);
  resetConnectionTerminalStartup($("connectionForm"));
  updateConnectionAdvancedStatus($("connectionForm"), false);
  const advanced = connectionAdvancedOptions($("connectionForm"));
  if (advanced) advanced.open = false;
  toggleAuthFields();
}

function wireConnectionForm() {
  const form = $("connectionForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    await saveConnectionForm(false, e.submitter);
  });
  form.addEventListener("invalid", event => {
    if (event.target?.closest?.("#connAdvancedOptions")) openConnectionAdvancedOptions(form);
  }, true);
  form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0);
  form.addEventListener("input", event => {
    if (!event.target.matches("#conn_host,#conn_port,#conn_user,#conn_password,#conn_key_passphrase,#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count")) return;
    form._terminalCredentialRevision += 1;
    markConnectionTerminalDetectionStale(form);
    if (event.target.matches("#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count")) scheduleConnectionExtraArgsValidation(form);
  });
  form.addEventListener("change", event => {
    if (!event.target.matches("#conn_host,#conn_port,#conn_user,#conn_auth_type,#conn_key,#conn_agent_mode,#conn_jump,#conn_extra,#conn_tcp_keepalive")) return;
    form._terminalCredentialRevision += 1;
    markConnectionTerminalDetectionStale(form);
    if (event.target.matches("#conn_extra,#conn_tcp_keepalive")) scheduleConnectionExtraArgsValidation(form, 0);
  });
}

async function saveConnectionForm(clearAfterSave=false, trigger=null) {
  if (!requireConfigEncryptionUnlocked("保存 SSH 连接")) return;
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const form = $("connectionForm");
  if (!form || form.dataset.saving === "1") return;
  form.dataset.saving = "1";
  if (trigger) setButtonBusy(trigger, true, "保存中...");
  try {
    if (!await ensureConnectionExtraArgsValid(form)) return;
    const p=connPayload(form, true);
    const generation = !p.id ? String($("conn_remote_generation")?.value || "") : "";
    let generated = null;
    if(p.id) await api(`/api/connections/${p.id}`,{method:"PUT",body:JSON.stringify(p)});
    else {
      const saved = await api("/api/connections",{method:"POST",body:JSON.stringify(p)});
      if (generation && saved?.id) {
        try {
          generated = await api(`/api/connections/${saved.id}/remote-profiles`, {
            method:"POST",
            body:JSON.stringify({protocol:generation})
          });
        } catch (generationError) {
          notify(`SSH 已保存，但其他连接生成失败：${generationError.message}`, "error");
        }
      }
    }
    pendingGroup = "";
    groupOpen.add(p.group_name);
    saveGroupState();
    await loadAll();
    if (clearAfterSave && !p.id) {
      let keyLoad = Promise.resolve();
      inPane(() => {
        resetConnectionForm();
        keyLoad = loadKeys().catch(()=>{});
        $("conn_name")?.focus();
      });
      await keyLoad;
      const generatedCount = generation === "all" ? Number(generated?.created_count || 0) : generated ? 1 : 0;
      notify(`连接已保存${generatedCount ? `，并生成 ${generatedCount} 个其他连接` : ""}，表单已清空`,"success");
    } else {
      const generatedCount = generation === "all" ? Number(generated?.created_count || 0) : generated ? 1 : 0;
      notify(`连接已保存${generatedCount ? `，并生成 ${generatedCount} 个其他连接` : ""}`,"success");
    }
  } catch(err){
    if (Array.isArray(err?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, err.details.issues);
    notify(err.message,"error");
  }
  finally {
    delete form.dataset.saving;
    if (trigger) setButtonBusy(trigger, false);
  }
}

async function loadKeys(selected, select=$("conn_key")) {
  if (!select) return;
  const root = select.closest("#view-edit") || select.form || document;
  const keys = await api("/api/identity-files");
  if (!select.isConnected) return;
  const current = selected ?? select.value;
  const currentAllowed = Boolean(current) && keys.some(k => String(k.path || "") === String(current));
  const previousWasLegacy = select.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1";
  const showLegacy = Boolean(connectionFormIdentityWarning(select.form))
    && !currentAllowed
    && (selected !== undefined ? Boolean(current) : previousWasLegacy);
  select.innerHTML = `${showLegacy ? connectionLegacyIdentityOption(select.form) : ""}<option value="">不使用私钥</option>` + keys.map(k=>`<option value="${esc(k.path)}">${esc(k.label)}${k.permission_ok ? "" : "（需检查权限）"}</option>`).join("");
  if (currentAllowed) select.value = current;
  renderKeyStatus(select, root.querySelector?.("#keyStatus"));
}

async function uploadOneKey(file){
  const form = new FormData();
  form.append("key", file);
  const res = await fetch("/api/identity-files", {method:"POST", body:form});
  const data = await res.json();
  if(!res.ok) throw new Error(data.error||res.statusText);
  return data;
}

async function uploadKey(){
  const f=$("key_upload").files[0];
  const select = $("conn_key");
  if(!f) return notify("请选择密钥文件","error");
  const data=await uploadOneKey(f);
  await loadKeys(data.path, select);
  const form = select?.closest?.("form");
  if (form) {
    form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0) + 1;
    markConnectionTerminalDetectionStale(form);
  }
  notify("密钥已上传","success");
}

async function renderKeyStatus(select=$("conn_key"), box=$("keyStatus")) {
  if (!box) return;
  if (select?.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1") {
    box.textContent = connectionFormIdentityWarning(select.form) || IDENTITY_FILE_UNSAFE_FALLBACK;
    box.className = "key-status warning";
    return;
  }
  const key = select?.value || "";
  if (!key) {
    box.textContent = "未选择私钥";
    box.className = "key-status muted";
    return;
  }
  try {
    const status = await api("/api/identity-files/check", {method:"POST", body:JSON.stringify({path:key})});
    box.textContent = status.ok ? `权限正常：${status.label}` : `需要修复权限：${status.details}`;
    box.className = `key-status ${status.ok ? "success" : "error"}`;
  } catch (error) {
    box.textContent = error.message;
    box.className = "key-status error";
  }
}

async function repairSelectedKey() {
  const select = $("conn_key");
  const key = select?.value || "";
  if (!key) return notify("请先选择私钥", "info");
  try {
    const status = await api("/api/identity-files/repair", {method:"POST", body:JSON.stringify({path:key})});
    await loadKeys(key, select);
    notify(status.ok ? "私钥权限已修复" : `已尝试修复：${status.details}`, status.ok ? "success" : "error");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function testConnectionForm(button=null){
  button = button || $("connTestBtn");
  const form = button?.closest?.("form") || $("connectionForm");
  if (!await ensureConnectionExtraArgsValid(form)) return;
  const status = connectionFormField(form, "connTestStatus");
  const detectionStatus = connectionFormField(form, "connTerminalDetectionStatus");
  const startRevision = Number(form?._terminalCredentialRevision || 0);
  setButtonBusy(button, true, "测试中...");
  if (status) { status.hidden = false; status.className = "connection-test-status busy"; status.textContent = "正在测试 SSH 连接，请稍候..."; }
  if (detectionStatus) {
    detectionStatus.className = "terminal-startup-detection busy";
    detectionStatus.textContent = "正在连接并检测远端平台、默认 Shell 和可用程序...";
  }
  notify("正在测试 SSH 连接，请稍候...", "info");
  try {
    const payload = {...connPayload(form), discover_terminal:true};
    const r=await api("/api/test-ssh",{method:"POST",body:JSON.stringify(payload)});
    const message = r.ok
      ? `SSH 测试成功，用时 ${r.elapsed_ms}ms`
      : `SSH 测试失败：${r.output || r.error || "请检查连接信息"}`;
    if (status) { status.className = `connection-test-status ${r.ok ? "success" : "error"}`; status.textContent = message; }
    if (r.ok && Number(form?._terminalCredentialRevision || 0) !== startRevision) {
      form._terminalCapabilitiesChecked = true;
      form._terminalProbeStale = true;
      connectionFormField(form, "connTerminalCapabilities")?.classList.add("is-stale");
      if (detectionStatus) {
        detectionStatus.className = "terminal-startup-detection stale";
        detectionStatus.textContent = "测试期间连接信息发生了变化，本次检测结果未应用。请重新测试 SSH。";
      }
    } else if (r.ok) {
      const rawCapabilities = r.capabilities || r.terminal_capabilities || r.discovery;
      form._terminalCapabilitiesChecked = true;
      form._terminalProbeStale = false;
      if (rawCapabilities && typeof rawCapabilities === "object") {
        const capabilities = renderConnectionTerminalProfiles(form, rawCapabilities);
        if (detectionStatus) {
          const defaultShell = capabilities.default_shell?.label || capabilities.default_shell?.path || "未识别";
          detectionStatus.className = "terminal-startup-detection success";
          detectionStatus.textContent = `检测完成：${capabilities.platform_label}，默认 Shell 为 ${defaultShell}，可快速选择 ${capabilities.profiles.length} 个启动配置。`;
        }
      } else if (detectionStatus) {
        form._terminalCapabilities = null;
        resetConnectionTerminalProfileSelect(form, true);
        const summary = connectionFormField(form, "connTerminalCapabilities");
        if (summary) {
          summary.hidden = true;
          summary.className = "terminal-startup-capabilities";
          summary.replaceChildren();
        }
        detectionStatus.className = "terminal-startup-detection warning";
        detectionStatus.textContent = "SSH 连接正常，但未能读取远端启动环境。仍可使用默认 Shell 或手动填写程序路径。";
      }
    } else if (detectionStatus) {
      detectionStatus.className = "terminal-startup-detection error";
      detectionStatus.textContent = "SSH 测试失败，未更新终端启动选项。";
    }
    notify(message, r.ok?"success":"error");
  } catch(e){
    if (Array.isArray(e?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, e.details.issues);
    const message = `SSH 测试无法完成：${e.message}`;
    if (status) { status.className = "connection-test-status error"; status.textContent = message; }
    if (detectionStatus) {
      detectionStatus.className = "terminal-startup-detection error";
      detectionStatus.textContent = "无法检测远端启动环境，请检查连接信息后重试。";
    }
    notify(message,"error");
  }
  finally {
    updateConnectionAdvancedStatus(form);
    setButtonBusy(button, false);
  }
}
