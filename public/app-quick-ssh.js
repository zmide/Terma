function quickSshEndpointText(target={}) {
  const host = String(target.host || "");
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return `${target.user ? `${target.user}@` : ""}${displayHost}:${Number(target.port || 22)}`;
}

function parseQuickSshTarget(value) {
  const raw = String(value || "").trim();
  if (!raw || /[\0\r\n\t ]/.test(raw) || /[\\/?#]/.test(raw)) return null;
  const at = raw.lastIndexOf("@");
  const user = at >= 0 ? raw.slice(0, at) : "";
  let endpoint = at >= 0 ? raw.slice(at + 1) : raw;
  if (at >= 0 && !user) return null;
  if (!endpoint || user.startsWith("-") || endpoint.startsWith("-")) return null;
  if (user && /[:\\/]/.test(user)) return null;

  let host = endpoint;
  let port = 22;
  if (endpoint.startsWith("[")) {
    const closing = endpoint.indexOf("]");
    if (closing <= 1) return null;
    host = endpoint.slice(1, closing);
    const suffix = endpoint.slice(closing + 1);
    if (suffix) {
      if (!/^:\d+$/.test(suffix)) return null;
      port = Number(suffix.slice(1));
    }
  } else if ((endpoint.match(/:/g) || []).length === 1) {
    const separator = endpoint.lastIndexOf(":");
    const candidatePort = endpoint.slice(separator + 1);
    if (!/^\d+$/.test(candidatePort)) return null;
    host = endpoint.slice(0, separator);
    port = Number(candidatePort);
  }
  if (!host || host.startsWith("-") || !/^[A-Za-z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {raw, user, host, port, user_missing:!user};
}

function quickSshExactConnections(target) {
  if (!target) return [];
  const host = String(target.host || "").toLowerCase();
  const user = String(target.user || "");
  return connections.filter(connection =>
    String(connection.ssh_host || "").toLowerCase() === host
    && Number(connection.ssh_port || 22) === Number(target.port || 22)
    && (!user || String(connection.ssh_user || "") === user)
  );
}

function closeQuickSshLaunchSurfaces() {
  if (typeof closeQuickConnectionLauncher === "function") closeQuickConnectionLauncher();
  if (typeof closeQuickPanel === "function") closeQuickPanel();
}

function quickSshAuthType() {
  return document.querySelector('input[name="quickSshAuthType"]:checked')?.value === "key" ? "key" : "password";
}

function syncQuickSshAuthFields() {
  const keyAuth = quickSshAuthType() === "key";
  const password = $("quickSshPassword");
  const key = $("quickSshIdentity");
  const passphrase = $("quickSshPassphrase");
  if (password) {
    password.closest(".quick-ssh-auth-panel").hidden = keyAuth;
    password.required = !keyAuth;
    password.disabled = keyAuth;
  }
  if (key) {
    key.closest(".quick-ssh-auth-panel").hidden = !keyAuth;
    key.required = keyAuth;
    key.disabled = !keyAuth;
  }
  if (passphrase) passphrase.disabled = !keyAuth;
}

function clearQuickSshSecrets() {
  for (const id of ["quickSshPassword", "quickSshPassphrase"]) {
    const field = $(id);
    if (field) field.value = "";
  }
}

let quickSshSubmission = null;

function closeQuickSshAuthModal() {
  if (quickSshSubmission) quickSshSubmission.cancelled = true;
  clearQuickSshSecrets();
  const modal = $("modal");
  if (!modal || modal.dataset.quickSshAuth !== "1") return;
  modal.dataset.quickSshAuth = "";
  modal.hidden = true;
  modal.onkeydown = null;
  modal.innerHTML = "";
}

async function startQuickSshConnection(target, options={}) {
  if (!target?.host) return;
  closeQuickSshLaunchSurfaces();
  const identities = await api("/api/identity-files").catch(() => []);
  const modal = $("modal");
  modal.dataset.quickSshAuth = "1";
  const title = options.repair
    ? tr("connections:quick_ssh.repair_title", {defaultValue:"修复临时 SSH 凭据"})
    : options.reconnectKey
      ? tr("connections:quick_ssh.reconnect_title", {defaultValue:"重新认证快速连接"})
      : tr("connections:quick_ssh.title", {defaultValue:"快速连接"});
  modal.innerHTML = `<form class="modal-card quick-ssh-auth-modal" data-submit-action="quick-ssh-submit" data-host="${escAttr(target.host)}" data-port="${Number(target.port || 22)}" data-reconnect-key="${escAttr(options.reconnectKey || "")}">
    <header class="quick-ssh-auth-head"><div><h2>${esc(title)}</h2><span>${esc(quickSshEndpointText(target))}</span></div><button class="icon-button" type="button" data-action="quick-ssh-close" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></header>
    <div class="quick-ssh-target-grid">
      <div><label for="quickSshUser">${esc(tr("connections:auto.ssh_user", {defaultValue:"SSH 用户名"}))}</label><input id="quickSshUser" required autocomplete="username" value="${escAttr(target.user || "")}" placeholder="root"></div>
      <div><label for="quickSshPort">${esc(tr("connections:auto.ssh_port", {defaultValue:"端口"}))}</label><input id="quickSshPort" type="number" min="1" max="65535" required value="${Number(target.port || 22)}"></div>
    </div>
    <fieldset class="quick-ssh-auth-choice"><legend>${esc(tr("connections:auto.login_method", {defaultValue:"认证方式"}))}</legend>
      <label><input type="radio" name="quickSshAuthType" value="password" checked data-change-action="quick-ssh-auth-type"><span>${icon("key-round")}${esc(tr("connections:auto.password_login", {defaultValue:"密码"}))}</span></label>
      <label><input type="radio" name="quickSshAuthType" value="key" data-change-action="quick-ssh-auth-type"><span>${icon("file-key")}${esc(tr("connections:auto.key_login", {defaultValue:"私钥"}))}</span></label>
    </fieldset>
    <div class="quick-ssh-auth-panel"><label for="quickSshPassword">${esc(tr("connections:auto.ssh_password", {defaultValue:"SSH 密码"}))}</label><input id="quickSshPassword" type="password" required autocomplete="current-password"></div>
    <div class="quick-ssh-auth-panel" hidden><label for="quickSshIdentity">${esc(tr("connections:auto.key_login", {defaultValue:"私钥"}))}</label><select id="quickSshIdentity"><option value="">${esc(tr("connections:identity.select", {defaultValue:"请选择私钥"}))}</option>${identities.map(item => `<option value="${escAttr(item.path)}">${esc(localizedIdentityFileLabel(item, {permission:true}))}</option>`).join("")}</select><label for="quickSshPassphrase">${esc(tr("connections:auto.key_passphrase", {defaultValue:"私钥口令（可选）"}))}</label><input id="quickSshPassphrase" type="password" autocomplete="off"></div>
    <div id="quickSshStatus" class="quick-ssh-status ${options.repair ? "warning" : ""}" aria-live="polite">${esc(options.repair ? tr("connections:quick_ssh.repair_hint", {defaultValue:"上次认证失败。请修改用户名、密码或私钥；新凭据仍只用于本次临时会话，不会保存到连接库。"}) : tr("connections:quick_ssh.session_hint", {defaultValue:"凭据仅用于本次临时会话（最长 12 小时），不会保存到连接库。"}))}</div>
    <div class="actions"><button type="button" data-action="quick-ssh-new">${esc(tr("connections:quick_ssh.save_connection", {defaultValue:"保存为 SSH 连接"}))}</button><button type="button" data-action="quick-ssh-close">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button id="quickSshConnect" class="primary" type="submit">${icon("square-terminal")}<span>${esc(tr("connections:quick_ssh.connect_terminal", {defaultValue:"连接终端"}))}</span></button></div>
  </form>`;
  modal.hidden = false;
  modal.onkeydown = event => {
    if (event.key === "Escape") closeQuickSshAuthModal();
  };
  const preferredAuth = options.authType === "key" ? "key" : "password";
  const authInput = document.querySelector(`input[name="quickSshAuthType"][value="${preferredAuth}"]`);
  if (authInput) authInput.checked = true;
  syncQuickSshAuthFields();
  refreshIcons();
  setTimeout(() => $(target.user ? "quickSshPassword" : "quickSshUser")?.focus({preventScroll:true}), 0);
}

async function submitQuickSshConnection(form, trigger) {
  if (form.dataset.submitting === "1") return;
  if (quickSshSubmission) quickSshSubmission.cancelled = true;
  const submission = {form, cancelled:false};
  quickSshSubmission = submission;
  const user = $("quickSshUser")?.value.trim() || "";
  const host = String(form.dataset.host || "");
  const port = Number($("quickSshPort")?.value || 22);
  const authType = quickSshAuthType();
  const payload = {
    name:quickSshEndpointText({user, host, port}),
    ssh_user:user,
    ssh_host:host,
    ssh_port:port,
    auth_type:authType,
    ssh_password:authType === "password" ? $("quickSshPassword")?.value || "" : "",
    identity_file:authType === "key" ? $("quickSshIdentity")?.value || "" : "",
    private_key_passphrase:authType === "key" ? $("quickSshPassphrase")?.value || "" : "",
    quick_connection_id:Number(terminalSessions.get(String(form.dataset.reconnectKey || ""))?.connection?.id || 0)
  };
  form.dataset.submitting = "1";
  setButtonBusy(trigger, true, tr("connections:quick_ssh.connecting", {defaultValue:"连接中..."}));
  const status = $("quickSshStatus");
  if (status) {
    status.textContent = tr("connections:quick_ssh.verifying_host", {defaultValue:"正在校验 SSH 主机身份..."});
    status.className = "quick-ssh-status";
  }
  try {
    await api("/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection:{ssh_user:user, ssh_host:host, ssh_port:port}})
    });
    if (submission.cancelled) return;
    if (status) status.textContent = tr("connections:quick_ssh.creating_ticket", {defaultValue:"正在创建一次性连接凭据..."});
    const ticket = await api("/api/terminal/quick-tickets", {method:"POST", body:JSON.stringify(payload)});
    payload.ssh_password = "";
    payload.private_key_passphrase = "";
    payload.identity_file = "";
    if (submission.cancelled) {
      await api("/api/terminal/quick-tickets", {
        method:"DELETE",
        body:JSON.stringify({token:ticket.token}),
        skipSftpConnect:true,
        skipHostTrustPrompt:true
      }).catch(() => {});
      return;
    }
    clearQuickSshSecrets();
    if (quickSshSubmission === submission) quickSshSubmission = null;
    closeQuickSshAuthModal();
    if (form.dataset.reconnectKey) resumeQuickTerminalWithTicket(form.dataset.reconnectKey, ticket.connection, ticket.token);
    else openQuickTerminal(ticket.connection, ticket.token);
  } catch (error) {
    if (status) {
      status.textContent = localizedTermaUiPhrase(error.message || tr("connections:quick_ssh.failed", {defaultValue:"快速连接失败"}));
      status.className = "quick-ssh-status error";
    }
    throw error;
  } finally {
    if (quickSshSubmission === submission) quickSshSubmission = null;
    form.dataset.submitting = "";
    setButtonBusy(trigger, false);
  }
}

function prefillNewSshConnection(target) {
  closeQuickSshLaunchSurfaces();
  if ($("modal")?.dataset.quickSshAuth === "1") closeQuickSshAuthModal();
  if (newConnection() === false) return;
  const values = target || {};
  if ($("conn_name")) $("conn_name").value = quickSshEndpointText(values).replace(/:22$/, "") || values.host || "";
  if ($("conn_user")) $("conn_user").value = values.user || "";
  if ($("conn_host")) $("conn_host").value = values.host || "";
  if ($("conn_port")) $("conn_port").value = Number(values.port || 22);
  setTimeout(() => $(values.user ? "conn_name" : "conn_user")?.focus({preventScroll:true}), 0);
}

function runQuickSshDefault(value) {
  const target = parseQuickSshTarget(value);
  if (!target) return false;
  const exact = quickSshExactConnections(target)[0];
  if (exact) {
    closeQuickSshLaunchSurfaces();
    openTerminal(exact.id);
  } else {
    startQuickSshConnection(target).catch(error => notify(localizedTermaUiPhrase(error.message || tr("connections:quick_ssh.failed", {defaultValue:"快速连接失败"})), "error"));
  }
  return true;
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("quick-ssh-close", () => closeQuickSshAuthModal());
  registerTermaAction("quick-ssh-auth-type", () => syncQuickSshAuthFields());
  registerTermaAction("quick-ssh-submit", ({event, element}) => {
    event.preventDefault();
    return submitQuickSshConnection(element, event.submitter || $("quickSshConnect"));
  });
  registerTermaAction("quick-ssh-new", ({element}) => {
    const form = element.closest("form");
    prefillNewSshConnection({
      user:$("quickSshUser")?.value.trim() || "",
      host:form?.dataset.host || "",
      port:Number($("quickSshPort")?.value || 22)
    });
  });
}
