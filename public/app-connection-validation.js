function connectionExtraArgsValidationPayload(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  return {
    extra_args:field("conn_extra")?.value || "",
    connect_timeout_seconds:Number(field("conn_connect_timeout")?.value || 10),
    keepalive_interval_seconds:Number(field("conn_keepalive_interval")?.value ?? 60),
    keepalive_count_max:Number(field("conn_keepalive_count")?.value || 3),
    tcp_keepalive:Number(field("conn_tcp_keepalive")?.value ?? 1)
  };
}

function connectionAdvancedOptions(form=$("connectionForm")) {
  return connectionFormField(form, "connAdvancedOptions");
}

function openConnectionAdvancedOptions(form=$("connectionForm")) {
  const details = connectionAdvancedOptions(form);
  if (details) details.open = true;
  return details;
}

function updateConnectionAdvancedStatus(form=$("connectionForm"), openForIssues=true) {
  const status = connectionFormField(form, "connAdvancedStatus");
  if (!status) return;
  const issues = Array.isArray(form?._extraArgsIssues) ? form._extraArgsIssues : [];
  const errors = issues.filter(item => item?.severity === "error").length;
  const warnings = issues.filter(item => item?.severity === "warning").length;
  const terminalStatus = connectionFormField(form, "connTerminalDetectionStatus");
  const terminalError = terminalStatus?.classList.contains("error");
  const terminalWarning = terminalStatus?.classList.contains("warning");
  const parts = [];
  if (errors) parts.push(`${errors} 处参数错误`);
  if (warnings) parts.push(`${warnings} 条参数提醒`);
  if (terminalError) parts.push("终端检测失败");
  else if (terminalWarning) parts.push("终端检测有提醒");
  status.textContent = parts.join(" · ") || "终端、跳板与连接调优";
  status.className = `connection-form-advanced-status${errors || terminalError ? " error" : warnings || terminalWarning ? " warning" : ""}`;
  if (openForIssues && parts.length) openConnectionAdvancedOptions(form);
}

function focusConnectionExtraArgsIssue(form, issue) {
  const editor = connectionFormField(form, "conn_extra");
  if (!editor) return;
  openConnectionAdvancedOptions(form);
  editor.focus({preventScroll:true});
  const start = Math.max(0, Math.min(editor.value.length, Number(issue?.start || 0)));
  const end = Math.max(start, Math.min(editor.value.length, Number(issue?.end ?? start)));
  try { editor.setSelectionRange(start, end); } catch {}
  editor.scrollIntoView({block:"center", behavior:"smooth"});
}

function renderConnectionExtraArgsDiagnostics(form=$("connectionForm"), issues=[]) {
  const editor = connectionFormField(form, "conn_extra");
  const box = connectionFormField(form, "connExtraDiagnostics");
  if (!editor || !box) return;
  const items = Array.isArray(issues) ? issues : [];
  const errors = items.filter(item => item?.severity === "error");
  form._extraArgsIssues = items;
  editor.setAttribute("aria-invalid", errors.length ? "true" : "false");
  editor.classList.toggle("has-validation-error", Boolean(errors.length));
  if (!items.length) {
    box.hidden = true;
    box.className = "ssh-extra-diagnostics";
    box.replaceChildren();
    updateConnectionAdvancedStatus(form);
    return;
  }
  box.hidden = false;
  box.className = `ssh-extra-diagnostics ${errors.length ? "has-errors" : "has-warnings"}`;
  const heading = document.createElement("div");
  heading.className = "ssh-extra-diagnostics-head";
  heading.innerHTML = `<strong>${errors.length ? `${errors.length} 处需要修正` : `${items.length} 条参数提醒`}</strong><span>点击下面条目可定位到对应行</span>`;
  box.replaceChildren(heading);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ssh-extra-issue ${item.severity === "warning" ? "warning" : "error"}`;
    const label = item.option || item.token || "附加参数";
    button.innerHTML = `<span class="ssh-extra-issue-title">${icon(item.severity === "warning" ? "triangle-alert" : "circle-alert")}<b>第 ${Number(item.line || 1)} 行 · ${esc(label)}</b></span><span>${esc(item.message || "参数无效")}</span>${item.suggestion ? `<small>${esc(item.suggestion)}</small>` : ""}`;
    button.addEventListener("click", () => focusConnectionExtraArgsIssue(form, item));
    box.appendChild(button);
  }
  updateConnectionAdvancedStatus(form);
}

async function validateConnectionExtraArgs(form=$("connectionForm")) {
  if (!form?.isConnected) return {ok:true, args:[], issues:[]};
  clearTimeout(form._extraArgsValidationTimer);
  const requestId = Number(form._extraArgsValidationRequestId || 0) + 1;
  form._extraArgsValidationRequestId = requestId;
  const payload = connectionExtraArgsValidationPayload(form);
  if (!String(payload.extra_args || "").trim()) {
    const result = {ok:true, args:[], issues:[]};
    renderConnectionExtraArgsDiagnostics(form, result.issues);
    return result;
  }
  try {
    const result = await api("/api/ssh/extra-args/validate", {method:"POST", body:JSON.stringify(payload)});
    if (!form.isConnected || form._extraArgsValidationRequestId !== requestId) return result;
    renderConnectionExtraArgsDiagnostics(form, result.issues);
    return result;
  } catch (error) {
    if (Array.isArray(error?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, error.details.issues);
    throw error;
  }
}

function scheduleConnectionExtraArgsValidation(form=$("connectionForm"), delay=180) {
  if (!form) return;
  clearTimeout(form._extraArgsValidationTimer);
  form._extraArgsValidationTimer = setTimeout(() => validateConnectionExtraArgs(form).catch(() => {}), delay);
}

async function ensureConnectionExtraArgsValid(form=$("connectionForm")) {
  const result = await validateConnectionExtraArgs(form);
  const firstError = result?.issues?.find(item => item?.severity === "error");
  if (!firstError) return true;
  focusConnectionExtraArgsIssue(form, firstError);
  notify(`SSH 附加参数第 ${firstError.line || 1} 行需要修正`, "error");
  return false;
}
