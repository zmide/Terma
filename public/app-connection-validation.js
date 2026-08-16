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

function localizedConnectionExtraArgsIssue(item={}) {
  const code = String(item.code || "");
  const optionSource = item.option || item.token || tr("connections:validation.additional_args", {defaultValue:"附加参数"});
  const option = typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(optionSource) : optionSource;
  const token = String(item.token || item.option || "");
  const quote = String(item.message || "").match(/(["']) \u5f15\u53f7/)?.[1] || '"';
  const currentValue = String(item.message || "").match(/\uff08\u5f53\u524d\uff1a(.+?)\uff09/)?.[1] || "";
  const current = currentValue ? tr("connections:validation.current_suffix", {value:currentValue, defaultValue:`（当前：${currentValue}）`}) : "";
  const values = {option, token, quote, current};
  const defaultMessage = item.message || tr("connections:validation.invalid_parameter", {defaultValue:"参数无效"});
  const handlers = {
    SSH_EXTRA_ARGS_UNCLOSED_QUOTE:() => ({
      message:tr("connections:validation.messages.unclosed_quote", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.unclosed_quote", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_DUPLICATES_STRUCTURED_FIELD:() => ({
      message:tr("connections:validation.messages.duplicate_structured", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.duplicate_structured", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_MISSING_OPTION_VALUE:() => ({
      message:tr("connections:validation.messages.missing_option_value", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.missing_option_value", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_HOST_TRUST_MANAGED:() => ({
      message:tr("connections:validation.messages.host_trust_managed", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.host_trust_managed", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_OPTION_NOT_ALLOWED:() => ({
      message:tr("connections:validation.messages.option_not_allowed", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.option_not_allowed", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_POSITIONAL_TOKEN:() => ({
      message:tr("connections:validation.messages.positional_token", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.positional_token", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_MISSING_ARGUMENT:() => ({
      message:tr("connections:validation.messages.missing_argument", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.missing_argument", {...values, defaultValue:item.suggestion || ""})
    }),
    SSH_EXTRA_ARGS_SHORT_OPTION_NOT_ALLOWED:() => ({
      message:tr("connections:validation.messages.short_option_not_allowed", {...values, defaultValue:defaultMessage}),
      suggestion:tr("connections:validation.suggestions.short_option_not_allowed", {...values, defaultValue:item.suggestion || ""})
    })
  };
  const localized = handlers[code]?.();
  const message = localized?.message
    || (typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(defaultMessage) : defaultMessage);
  const suggestion = localized?.suggestion
    || (typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(item.suggestion || "") : (item.suggestion || ""));
  return {option, message, suggestion};
}

function localizedConnectionExtraArgsError(details={}) {
  const issues = Array.isArray(details?.issues) ? details.issues : Array.isArray(details) ? details : [];
  if (!issues.length) return "";
  const heading = tr("connections:validation.invalid_summary", {
    count:issues.length,
    defaultValue:`SSH 附加参数有 ${issues.length} 处需要修正：`
  });
  const rows = issues.map(item => {
    const localized = localizedConnectionExtraArgsIssue(item);
    const line = tr("connections:validation.line_label", {
      line:Number(item?.line || 1),
      option:localized.option,
      defaultValue:`第 ${Number(item?.line || 1)} 行 · ${localized.option}`
    });
    const severity = item?.severity === "warning"
      ? tr("connections:validation.reminder", {defaultValue:"提醒"})
      : tr("connections:validation.problem", {defaultValue:"问题"});
    const suggestion = localized.suggestion
      ? tr("connections:validation.suggestion_suffix", {suggestion:localized.suggestion, defaultValue:`；建议：${localized.suggestion}`})
      : "";
    return tr("connections:validation.issue_row", {line, severity, message:localized.message, suggestion, defaultValue:`${line}（${severity}）：${localized.message}${suggestion}`});
  });
  return [heading, ...rows].join("\n");
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
  if (errors) parts.push(tr("connections:validation.error_count", {count:errors, defaultValue:`${errors} 处参数错误`}));
  if (warnings) parts.push(tr("connections:validation.warning_count", {count:warnings, defaultValue:`${warnings} 条参数提醒`}));
  if (terminalError) parts.push(tr("connections:validation.terminal_failed", {defaultValue:"终端检测失败"}));
  else if (terminalWarning) parts.push(tr("connections:validation.terminal_warning", {defaultValue:"终端检测有提醒"}));
  status.textContent = parts.join(" · ") || tr("connections:validation.summary", {defaultValue:"终端、跳板与连接调优"});
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
  heading.innerHTML = `<strong>${esc(errors.length
    ? tr("connections:validation.fix_count", {count:errors.length, defaultValue:`${errors.length} 处需要修正`})
    : tr("connections:validation.warning_count", {count:items.length, defaultValue:`${items.length} 条参数提醒`}))}</strong><span>${esc(tr("connections:validation.click_to_locate", {defaultValue:"点击下面条目可定位到对应行"}))}</span>`;
  box.replaceChildren(heading);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ssh-extra-issue ${item.severity === "warning" ? "warning" : "error"}`;
    const localized = localizedConnectionExtraArgsIssue(item);
    const lineLabel = tr("connections:validation.line_label", {line:Number(item.line || 1), option:localized.option, defaultValue:`第 ${Number(item.line || 1)} 行 · ${localized.option}`});
    button.innerHTML = `<span class="ssh-extra-issue-title">${icon(item.severity === "warning" ? "triangle-alert" : "circle-alert")}<b>${esc(lineLabel)}</b></span><span>${esc(localized.message)}</span>${localized.suggestion ? `<small>${esc(localized.suggestion)}</small>` : ""}`;
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
  notify(tr("common:notifications.ssh_extra_argument_line", {line:firstError.line || 1, defaultValue:`SSH 附加参数第 ${firstError.line || 1} 行需要修正`}), "error");
  return false;
}
