function textSelectionFromTextarea(el) {
  return el.value.slice(el.selectionStart || 0, el.selectionEnd || 0);
}

const batchCommandStates = new Map();

function batchCommandStateKey(key=activeTabKey) {
  return String(key || "command");
}

function batchCommandState(key=activeTabKey) {
  const stateKey = batchCommandStateKey(key);
  let state = batchCommandStates.get(stateKey);
  if (!state) {
    state = {draft:null, export:null, socket:null, runSerial:0, preflight:false};
    batchCommandStates.set(stateKey, state);
  }
  return state;
}

function batchCommandStateForRoot(root) {
  return batchCommandState(root?.dataset?.batchTabKey || activeTabKey);
}

function readBatchCommandDraft(root=currentBatchRoot()) {
  if (!root) return null;
  const timeout = Math.max(5, Math.min(600, Number(root.querySelector("#batchCommandTimeout")?.value || 60)));
  return {
    command:root.querySelector("#batchCommandText")?.value || "",
    templateId:root.querySelector("#batchCommandTemplate")?.value || "",
    timeout,
    selectedIds:[...root.querySelectorAll(".batch-command-check:checked")].map(input => String(input.value))
  };
}

function rememberBatchCommandDraft(root=currentBatchRoot(), key=root?.dataset?.batchTabKey || activeTabKey) {
  const draft = readBatchCommandDraft(root);
  const state = batchCommandState(key);
  if (draft) state.draft = draft;
  if (draft && state.export && !state.export.invalidated && root?.isConnected && !batchCommandDraftMatchesExport(root, state.export)) {
    state.export.invalidated = true;
    const results = batchElement("batchCommandResults", root);
    if (results) results.innerHTML = "";
    const txt = batchElement("batchExportTxtBtn", root);
    const json = batchElement("batchExportJsonBtn", root);
    if (txt) txt.hidden = true;
    if (json) json.hidden = true;
    const status = batchElement("batchCommandStatus", root);
    if (status) status.textContent = "";
  }
}

function bindBatchCommandDraft(root) {
  if (!root) return;
  const remember = () => rememberBatchCommandDraft(root);
  root.querySelectorAll("#batchCommandTemplate, #batchCommandTimeout, #batchCommandText, .batch-command-check").forEach(field => {
    field.addEventListener("input", remember);
    field.addEventListener("change", remember);
  });
  remember();
}

function resetBatchCommandDraft(key=activeTabKey) {
  disposeBatchCommandTab(key);
}

function disposeBatchCommandTab(key=activeTabKey) {
  const stateKey = batchCommandStateKey(key);
  const state = batchCommandStates.get(stateKey);
  if (!state) return;
  try { state.socket?.close(); } catch {}
  batchCommandStates.delete(stateKey);
}

function currentBatchRoot() {
  const scope = typeof currentWorkspaceDomScope === "function" ? currentWorkspaceDomScope() : document;
  return scope.querySelector("#view-command");
}

function batchElement(id, root=currentBatchRoot()) {
  return root?.querySelector(`#${CSS.escape(id)}`) || null;
}

async function copyCommandContext(target, all=false) {
  const text = target.matches("textarea")
    ? (all ? target.value : textSelectionFromTextarea(target) || target.value)
    : (all ? target.textContent : String(getSelection()?.toString() || "").trim() || target.textContent);
  await copyText(text || "");
}

async function pasteCommandContext(target) {
  if (!target?.matches("textarea")) return;
  const text = await navigator.clipboard.readText();
  const start = target.selectionStart || 0;
  const end = target.selectionEnd || 0;
  target.value = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  const next = start + text.length;
  target.focus();
  target.setSelectionRange(next, next);
  target.dispatchEvent(new Event("input", {bubbles:true}));
}

function hideCommandContextMenu() {
  $("commandContextMenu")?.remove();
}

function showCommandContextMenu(event) {
  const target = event.target.closest?.("textarea.command-textarea, .command-output");
  if (!target) return;
  event.preventDefault();
  hideCommandContextMenu();
  const isInput = target.matches("textarea");
  const menu = document.createElement("div");
  menu.id = "commandContextMenu";
  menu.className = "context-menu";
  const items = [
    [tr("terminal:batch.context_copy"), () => copyCommandContext(target)],
    ...(isInput
      ? [[tr("terminal:batch.context_paste"), () => pasteCommandContext(target)], [tr("terminal:batch.context_select_all"), () => { target.focus(); target.select(); }]]
      : [[tr("terminal:batch.context_copy_all"), () => copyCommandContext(target, true)]])
  ];
  for (const [label, action] of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      try { await action(); } catch (error) { notify(error.message || tr("terminal:batch.operation_failed"), "error"); }
      hideCommandContextMenu();
    });
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
}

async function renderCommandTemplates(options={}) {
  if (options.reload !== false || !commandTemplates.length) await loadCommandTemplates();
  $("connectionGroups").innerHTML = `<div class="command-template-manager">
    <div class="template-list">
      ${commandTemplates.map(template => renderTemplateRow(template)).join("") || stateView("empty", tr("terminal:batch.templates_empty_title"), tr("terminal:batch.templates_empty_hint"), `<button class="primary" onclick="newCommandTemplate()">${esc(tr("terminal:template_editor.add_title"))}</button>`)}
    </div>
  </div>`;
}

function renderTemplateEditor(template=null) {
  const editing = Boolean(template);
  return `<div class="modal-card wide command-template-modal" role="dialog" aria-modal="true" aria-labelledby="commandTemplateTitle">
    <div class="modal-title-row"><div><h2 id="commandTemplateTitle">${esc(tr(editing ? "terminal:template_editor.edit_title" : "terminal:template_editor.add_title", {defaultValue:editing ? "编辑命令模板" : "新增命令模板"}))}</h2><span class="muted">${esc(tr("terminal:template_editor.hint", {defaultValue:"保存后可在批量执行中直接套用。"}))}</span></div><button class="icon-button" type="button" data-template-cancel title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div>
    <label>${esc(tr("terminal:template_editor.name", {defaultValue:"模板名称"}))}</label>
    <input id="templateName" value="${escAttr(template?.name || "")}" placeholder="${escAttr(tr("terminal:template_editor.name_example", {defaultValue:"例如：查看系统信息"}))}">
    <label>${esc(tr("terminal:template_editor.command", {defaultValue:"命令"}))}</label>
    <textarea id="templateCommand" class="template-command-editor" wrap="off" spellcheck="false" placeholder="${escAttr(tr("terminal:template_editor.command_example", {defaultValue:"例如：uname -a"}))}">${esc(template?.command || "")}</textarea>
    <label>${esc(tr("terminal:template_editor.comment", {defaultValue:"备注"}))}</label>
    <input id="templateDescription" value="${escAttr(template?.description || "")}" placeholder="${escAttr(tr("remote:auto.optional", {defaultValue:"可选"}))}">
    <div class="actions">
      <button class="primary" type="button" data-template-save>${esc(tr(editing ? "terminal:template_editor.save" : "terminal:template_editor.add", {defaultValue:editing ? "保存模板" : "新增模板"}))}</button>
      <button type="button" data-template-cancel>${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button>
    </div>
  </div>`;
}

function formatCommandPreview(command) {
  return String(command || "").split(/\r?\n/).map(line => line.replace(/https?:\/\/[^\s"'<>]+/g, url => {
    try { return decodeURI(url); } catch { return url; }
  })).join("\n");
}

function renderTemplateRow(template) {
  const preview = formatCommandPreview(template.command);
  const editLabel = tr("terminal:batch.edit_template");
  const deleteLabel = tr("terminal:batch.delete_template");
  return `<div class="template-row">
    <button class="template-main" onclick="applyTemplateToCommand('${escAttr(template.id)}')">
      <span class="conn-name">${esc(template.name)}</span>
      <span class="template-command-preview" title="${escAttr(template.command)}">${esc(preview)}</span>
      ${template.description ? `<span class="muted">${esc(template.description)}</span>` : ""}
    </button>
    <div class="template-actions">
      <button class="icon-button" onclick="editCommandTemplate('${escAttr(template.id)}')" title="${escAttr(editLabel)}" aria-label="${escAttr(editLabel)}">${icon("pencil")}</button>
      <button class="danger icon-button" onclick="deleteCommandTemplate('${escAttr(template.id)}')" title="${escAttr(deleteLabel)}" aria-label="${escAttr(deleteLabel)}">${icon("trash-2")}</button>
    </div>
  </div>`;
}

function openCommandTemplateEditor(template=null) {
  const modal = $("modal");
  if (!modal) return;
  editingTemplateId = template ? String(template.id) : "";
  modal.onclick = null;
  modal.onkeydown = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeModal();
  };
  modal.hidden = false;
  modal.innerHTML = renderTemplateEditor(template);
  const card = modal.querySelector(".command-template-modal");
  card?.querySelectorAll("[data-template-cancel]").forEach(button => button.addEventListener("click", () => closeModal()));
  card?.querySelector("[data-template-save]")?.addEventListener("click", () => void saveTemplateForm());
  setTimeout(() => $("templateName")?.focus(), 0);
}

function newCommandTemplate() {
  openCommandTemplateEditor();
}

function editCommandTemplate(id) {
  const template = commandTemplates.find(item => item.id === id);
  if (template) openCommandTemplateEditor(template);
}

async function saveTemplateForm() {
  const payload = {
    name: $("templateName")?.value.trim(),
    command: $("templateCommand")?.value || "",
    description: $("templateDescription")?.value.trim()
  };
  const path = editingTemplateId ? `/api/command-templates/${encodeURIComponent(editingTemplateId)}` : "/api/command-templates";
  await api(path, {method: editingTemplateId ? "PUT" : "POST", body:JSON.stringify(payload)});
  notify(tr(editingTemplateId ? "terminal:batch.template_saved" : "terminal:batch.template_added"), "success");
  closeModal();
  await renderCommandTemplates();
  renderCommandTemplateOptions();
}

async function deleteCommandTemplate(id) {
  const template = commandTemplates.find(item => item.id === id);
  if (!await confirmModal(
    tr("terminal:batch.delete_template_confirm", {name:template?.name || ""}),
    tr("terminal:batch.delete_template_title"),
    tr("common:actions.delete"),
    tr("common:actions.cancel"),
    true
  )) return;
  await api(`/api/command-templates/${encodeURIComponent(id)}`, {method:"DELETE"});
  notify(tr("terminal:batch.template_deleted"), "success");
  await renderCommandTemplates();
  renderCommandTemplateOptions();
}

function applyTemplateToCommand(id) {
  primaryView = "command";
  const template = commandTemplates.find(item => item.id === id);
  if (!template) return;
  openBatchCommand();
  setTimeout(() => {
    const select = $("batchCommandTemplate");
    if (select) select.value = id;
    if ($("batchCommandText")) $("batchCommandText").value = template.command || "";
    rememberBatchCommandDraft();
  }, 0);
}

function openBatchCommand(updateTab=true) {
  const tabKey = batchCommandStateKey(updateTab ? "command" : activeTabKey);
  const state = batchCommandState(tabKey);
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const selected = state.draft
    ? new Set(state.draft.selectedIds)
    : new Set([selectedId].filter(Boolean).map(String));
  const command = state.draft?.command || "";
  const templateId = state.draft?.templateId || "";
  const timeout = state.draft?.timeout || 60;
  const existingRoot = $("view-command");
  if (existingRoot?.querySelector(".command-panel") && existingRoot.dataset.batchTabKey === tabKey) {
    setWorkspace(tr("terminal:batch.title"), tr("terminal:batch.workspace_subtitle"), "command", "command", updateTab, true, {kind:"command"});
    renderCommandTemplateOptions(existingRoot);
    renderBatchCommandResults(existingRoot);
    return;
  }
  $("view-command").innerHTML = `<div class="panel command-panel">
    <div class="workspace-head">
      <div>
        <h2>${esc(tr("terminal:batch.title"))}</h2>
        <div class="subtitle">${esc(tr("terminal:batch.subtitle"))}</div>
      </div>
      <div class="actions">
        <button onclick="setBatchCommandChecks(true)">${icon("list-checks")}<span>${esc(tr("terminal:batch.select_all"))}</span></button>
        <button onclick="setBatchCommandChecks(false)">${icon("list-x")}<span>${esc(tr("terminal:batch.clear_selection"))}</span></button>
      </div>
    </div>
    <div class="grid">
      <div>
        <label>${esc(tr("terminal:batch.preset_template"))}</label>
        <select id="batchCommandTemplate" onchange="useCommandTemplate(this.value)">${renderCommandTemplateOptionsHtml()}</select>
      </div>
      <div>
        <label>${esc(tr("terminal:batch.timeout_seconds"))}</label>
        <input id="batchCommandTimeout" type="number" min="5" max="600" value="${timeout}">
      </div>
    </div>
    <label>${esc(tr("terminal:batch.command"))}</label>
    <textarea id="batchCommandText" class="command-textarea" wrap="off" spellcheck="false" placeholder="${escAttr(tr("terminal:batch.command_placeholder"))}">${esc(command)}</textarea>
    <div class="actions command-actions">
      <button id="batchCommandRunBtn" class="primary" onclick="runBatchCommand()">${icon("play")}<span>${esc(tr("terminal:batch.run"))}</span></button>
      <button id="batchCommandStopBtn" onclick="stopBatchCommand()" disabled>${icon("square")}<span>${esc(tr("terminal:batch.stop"))}</span></button>
      <button id="batchExportTxtBtn" onclick="exportBatchCommand('txt')" hidden>${icon("file-text")}<span>${esc(tr("terminal:batch.export_txt"))}</span></button>
      <button id="batchExportJsonBtn" onclick="exportBatchCommand('json')" hidden>${icon("braces")}<span>${esc(tr("terminal:batch.export_json"))}</span></button>
      <span id="batchCommandStatus" class="muted"></span>
    </div>
    <label>${esc(tr("terminal:batch.targets"))} <span id="batchTargetCount" class="field-count">${esc(tr("terminal:batch.selected_count", {count:selected.size}))}</span></label>
    <div class="command-targets">${renderBatchCommandTargets(selected)}</div>
    <div id="batchCommandResults" class="command-results"></div>
  </div>`;
  setWorkspace(tr("terminal:batch.title"), tr("terminal:batch.workspace_subtitle"), "command", "command", updateTab, true, {kind:"command"});
  const root = $("view-command");
  if (root) root.dataset.batchTabKey = tabKey;
  const select = batchElement("batchCommandTemplate", root);
  if (select && templateId && [...select.options].some(option => option.value === templateId)) select.value = templateId;
  bindBatchCommandDraft(root);
  renderBatchCommandResults(root);
  if (!commandTemplates.length) {
    loadCommandTemplates().then(() => inPane(() => {
      if (root?.isConnected) renderCommandTemplateOptions(root);
    })).catch(()=>{});
  }
}

async function loadCommandTemplates() {
  commandTemplates = await api("/api/command-templates");
  return commandTemplates;
}

function renderCommandTemplateOptionsHtml() {
  return `<option value="">${esc(tr("terminal:batch.manual_command"))}</option>` + commandTemplates.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
}

function renderCommandTemplateOptions(root=currentBatchRoot()) {
  const select = batchElement("batchCommandTemplate", root);
  if (select) select.innerHTML = renderCommandTemplateOptionsHtml();
  const draft = batchCommandStateForRoot(root).draft;
  if (select && draft?.templateId && [...select.options].some(option => option.value === draft.templateId)) {
    select.value = draft.templateId;
  }
}

function useCommandTemplate(id) {
  const item = commandTemplates.find(template => template.id === id);
  if (item && $("batchCommandText")) $("batchCommandText").value = item.command || "";
  rememberBatchCommandDraft();
}

function renderBatchCommandTargets(selected=new Set()) {
  const groups = filteredConnections().reduce((m,c)=>{(m[c.group_name] ||= []).push(c); return m;},{});
  const names = Object.keys(groups);
  if (!names.length) return stateView("empty", tr("terminal:batch.targets_empty_title"), tr("terminal:batch.targets_empty_hint"));
  return names.map(group => `<div class="command-target-group">
    <div class="command-target-title">${esc(group)} <span>${groups[group].length}</span></div>
    ${groups[group].map(c => `<label class="command-target">
      <input class="batch-command-check" type="checkbox" value="${c.id}" ${selected.has(String(c.id)) ? "checked" : ""} onchange="updateBatchTargetCount()">
      <span><strong>${esc(c.name)}</strong><em>${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</em></span>
    </label>`).join("")}
  </div>`).join("");
}

function setBatchCommandChecks(checked) {
  currentBatchRoot()?.querySelectorAll(".batch-command-check").forEach(input => input.checked = checked);
  updateBatchTargetCount();
  rememberBatchCommandDraft();
}

function updateBatchTargetCount() {
  const count = currentBatchRoot()?.querySelectorAll(".batch-command-check:checked").length || 0;
  if ($("batchTargetCount")) $("batchTargetCount").textContent = tr("terminal:batch.selected_count", {count});
  rememberBatchCommandDraft();
}

function commandLooksDangerous(command) {
  return /\b(rm\s+(-[a-z]*r[a-z]*f|-rf|-[a-z]*f[a-z]*r)|mkfs|shutdown|reboot|poweroff|halt|chmod\s+-R\s+777|chown\s+-R)\b|dd\s+if=|:\s*\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}/i.test(command);
}

function updateBatchResultHead(id, text, root=currentBatchRoot()) {
  const row = batchElement(`batchResult-${id}`, root);
  const status = row?.querySelector(".command-result-head span");
  if (status) status.textContent = text;
}

function normalizeBatchCommandInput(command) {
  return String(command || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Batch command lifecycle is keyed by the workspace tab. This keeps detached
// sockets and drafts from updating a different tab after navigation.
function batchCommandUiRoot(tabKey) {
  if (typeof workspaceElementForTab === "function") {
    const root = workspaceElementForTab(batchCommandStateKey(tabKey), "#view-command");
    if (root) return root;
  }
  return String(activeTabKey || "command") === batchCommandStateKey(tabKey) ? currentBatchRoot() : null;
}

function batchCommandDraftMatchesExport(root=currentBatchRoot(), data=batchCommandStateForRoot(root).export) {
  if (!root || !data || data.invalidated) return false;
  const draft = readBatchCommandDraft(root);
  if (!draft) return false;
  const selected = [...new Set(draft.selectedIds.map(String))].sort();
  const resultIds = (data.ids || Object.keys(data.results || {})).map(String).sort();
  return normalizeBatchCommandInput(draft.command) === normalizeBatchCommandInput(data.command)
    && draft.timeout === Math.max(5, Math.min(600, Math.round(Number(data.timeout_ms || 60000) / 1000)))
    && selected.join(",") === resultIds.join(",");
}

function setBatchCommandStatus(root, data=batchCommandStateForRoot(root).export, override="") {
  const status = batchElement("batchCommandStatus", root);
  if (!status) return;
  let statusText = override;
  if (!statusText && data) {
    if (data.status === "finished") statusText = tr("terminal:batch.finished_summary", {ok:data.ok_count ?? 0, failed:data.failed_count ?? 0});
    else if (data.status === "stopped") statusText = tr("terminal:batch.stopped_results_kept");
    else if (data.status === "disconnected") statusText = tr("terminal:batch.channel_disconnected_results_kept");
    else if (data.status === "error") statusText = tr("terminal:batch.connection_failed");
    else statusText = tr("terminal:batch.running");
  }
  if (data?.log_path) {
    status.innerHTML = `${esc(statusText)} · ${esc(tr("terminal:batch.log"))}: <button class="ghost" onclick="openLog('${escAttr(data.log_path)}','${escAttr(data.log_label)}')">${esc(data.log_label || tr("terminal:batch.view_log"))}</button>`;
  } else status.textContent = statusText;
}

function batchCommandResultStatus(item, data=batchCommandStateForRoot().export) {
  if (item.ok === true) return tr("terminal:batch.result_success", {code:item.exit_code ?? "", error:item.error ? ` · ${item.error}` : ""});
  if (item.ok === false) return tr("terminal:batch.result_failure", {code:item.exit_code ?? "", error:item.error ? ` · ${item.error}` : ""});
  if (item.state === "stopped") return tr(item.started ? "terminal:batch.status_stopped" : "terminal:batch.status_stopped_not_started");
  if (item.state === "disconnected") return tr(item.started ? "terminal:batch.status_disconnected_incomplete" : "terminal:batch.status_disconnected_not_started");
  return tr(item.started ? "terminal:batch.status_running" : (data?.running ? "terminal:batch.status_waiting" : "terminal:batch.status_incomplete"));
}

function updateBatchCommandUi(root=currentBatchRoot(), data=batchCommandStateForRoot(root).export) {
  if (!root) return;
  const state = batchCommandStateForRoot(root);
  const matches = batchCommandDraftMatchesExport(root, data);
  const busy = Boolean(state.preflight || (matches && data?.running));
  const runButton = batchElement("batchCommandRunBtn", root);
  const stopButton = batchElement("batchCommandStopBtn", root);
  setButtonBusy(runButton, busy, tr(state.preflight ? "terminal:batch.preparing" : "terminal:batch.running"));
  if (stopButton) stopButton.disabled = !Boolean(matches && data?.running);
  root.querySelectorAll("#batchCommandTemplate, #batchCommandTimeout, #batchCommandText, .batch-command-check, .workspace-head .actions button").forEach(field => {
    field.disabled = busy;
  });
  if (matches && data?.finished_at && data.status === "finished") {
    batchElement("batchExportTxtBtn", root)?.removeAttribute("hidden");
    batchElement("batchExportJsonBtn", root)?.removeAttribute("hidden");
  }
  if (!matches && !busy) setBatchCommandStatus(root, null, "");
}

function renderBatchCommandResults(root=currentBatchRoot()) {
  const container = batchElement("batchCommandResults", root);
  if (!container) return;
  const data = batchCommandStateForRoot(root).export;
  if (!batchCommandDraftMatchesExport(root, data)) {
    container.innerHTML = "";
    batchElement("batchExportTxtBtn", root)?.setAttribute("hidden", "");
    batchElement("batchExportJsonBtn", root)?.setAttribute("hidden", "");
    updateBatchCommandUi(root, data);
    return;
  }
  const ids = data.ids || Object.keys(data.results || {});
  container.innerHTML = ids.map(id => {
    const item = data.results?.[id] || data.results?.[String(id)];
    if (!item) return "";
    return `<div class="command-result${item.ok === true ? " ok" : item.ok === false ? " bad" : ""}" id="batchResult-${escAttr(id)}">
      <div class="command-result-head"><strong>${esc(item.name || id)}</strong><span>${esc(batchCommandResultStatus(item, data))}</span></div>
      <pre class="command-output live" id="batchOutput-${escAttr(id)}">${esc(item.output || "")}</pre>
    </div>`;
  }).join("");
  setBatchCommandStatus(root, data);
  updateBatchCommandUi(root, data);
}

function handleBatchCommandEvent(message, tabKey=activeTabKey, runId=null) {
  const state = batchCommandState(tabKey);
  if (runId != null && state.export?.run_id !== runId) return;
  const data = state.export;
  const uiRoot = batchCommandUiRoot(tabKey);
  if (message.type === "ready") return;
  if (message.type === "meta") {
    if (data) Object.assign(data, {log_path:message.log_path || "", log_label:message.log_label || ""});
    if (uiRoot) setBatchCommandStatus(uiRoot, data);
    return;
  }
  if (message.type === "start") {
    if (data?.results?.[message.id]) Object.assign(data.results[message.id], {started:true, state:"running"});
    if (uiRoot) updateBatchResultHead(message.id, tr("terminal:batch.status_running"), uiRoot);
    return;
  }
  if (message.type === "data") {
    if (data?.results?.[message.id]) data.results[message.id].output += message.data || "";
    const output = batchElement(`batchOutput-${message.id}`, uiRoot);
    if (output) {
      output.textContent += message.data || "";
      output.scrollTop = output.scrollHeight;
    }
    return;
  }
  if (message.type === "exit") {
    const localizedError = message.error
      ? localizedBackendPublicError(message, message.error)
      : "";
    if (data?.results?.[message.id]) {
      Object.assign(data.results[message.id], {
        ok:message.ok,
        state:message.ok ? "success" : "failed",
        exit_code:message.exit_code,
        error:localizedError,
        elapsed_ms:message.elapsed_ms
      });
    }
    if (uiRoot) {
      const row = batchElement(`batchResult-${message.id}`, uiRoot);
      if (row) row.classList.add(message.ok ? "ok" : "bad");
      updateBatchResultHead(message.id, batchCommandResultStatus(data?.results?.[message.id] || message, data), uiRoot);
    }
    return;
  }
  if (message.type === "done") {
    if (data) Object.assign(data, {status:"finished",running:false,finished_at:new Date().toISOString(),ok_count:message.ok,failed_count:message.failed});
    if (uiRoot) renderBatchCommandResults(uiRoot);
    return;
  }
  if (message.type === "error") {
    const localizedError = localizedBackendPublicError(message, message.error || "");
    if (data) {
      Object.assign(data, {status:"error",running:false,error:localizedError,finished_at:new Date().toISOString()});
      for (const item of Object.values(data.results || {})) {
        if (item.ok === null) Object.assign(item, {state:"disconnected", error:item.error || localizedError});
      }
    }
    if (uiRoot) {
      setBatchCommandStatus(uiRoot, data);
      updateBatchCommandUi(uiRoot, data);
    }
    notify(localizedError || tr("terminal:batch.batch_failed"), "error");
  }
}

async function runBatchCommand() {
  const tabKey = batchCommandStateKey(activeTabKey);
  const state = batchCommandState(tabKey);
  const root = currentBatchRoot();
  if (!root || state.preflight || state.export?.running) return;
  const commandInput = batchElement("batchCommandText", root);
  const ids = [...root.querySelectorAll(".batch-command-check:checked")].map(input => Number(input.value));
  let command = normalizeBatchCommandInput(commandInput?.value || "");
  const timeout = Math.max(5, Math.min(600, Number(batchElement("batchCommandTimeout", root)?.value || 60)));
  if (!ids.length) return notify(tr("terminal:batch.select_target_error"), "error");
  if (!command.trim()) return notify(tr("terminal:batch.enter_command_error"), "error");

  state.preflight = true;
  updateBatchCommandUi(root, state.export);
  const active = () => String(activeTabKey || "command") === tabKey && Boolean(currentBatchRoot()?.isConnected);
  const cancelPreflight = () => {
    state.preflight = false;
    if (active()) updateBatchCommandUi(currentBatchRoot(), state.export);
  };

  const lines = command.split(/\n/).map(line => line.trim()).filter(Boolean);
  const uniqueLines = [...new Set(lines)];
  if (lines.length > 1 && uniqueLines.length === 1
    && await confirmModal(
      tr("terminal:batch.repeated_command_message", {count:lines.length}),
      tr("terminal:batch.repeated_command_title"),
      tr("terminal:batch.run_once"),
      tr("terminal:batch.run_original")
    )) {
    command = uniqueLines[0];
  }
  if (lines.length > 1 && uniqueLines.length !== 1
    && !await confirmModal(
      tr("terminal:batch.multiline_message", {count:lines.length}),
      tr("terminal:batch.confirm_title"),
      tr("terminal:batch.continue"),
      tr("common:actions.cancel")
    )) {
    cancelPreflight();
    return;
  }
  if (!active()) {
    cancelPreflight();
    return;
  }
  if (commandInput.value !== command) commandInput.value = command;
  rememberBatchCommandDraft(root);
  if (commandLooksDangerous(command)
    && !await confirmModal(
      tr("terminal:batch.dangerous_message"),
      tr("terminal:batch.dangerous_title"),
      tr("terminal:batch.continue_run"),
      tr("common:actions.cancel"),
      true
    )) {
    cancelPreflight();
    return;
  }
  if (!active()) {
    cancelPreflight();
    return;
  }

  batchElement("batchCommandStatus", root).textContent = tr("terminal:batch.verifying_host_identity");
  try {
    for (const id of ids) {
      await api("/api/ssh/preflight", {method:"POST", body:JSON.stringify({connection_id:id})});
      if (!active()) {
        cancelPreflight();
        return;
      }
    }
  } catch (error) {
    cancelPreflight();
    if (error.code !== "SSH_HOST_TRUST_CANCELLED") notify(error.message || tr("terminal:batch.host_identity_failed"), "error");
    return;
  }

  const runId = ++state.runSerial;
  state.preflight = false;
  state.export = {
    tab_key:tabKey,
    run_id:runId,
    ids:[...ids],
    timeout_ms:timeout * 1000,
    command,
    started_at:new Date().toISOString(),
    finished_at:null,
    status:"running",
    running:true,
    log_path:"",
    log_label:"",
    ok_count:null,
    failed_count:null,
    invalidated:false,
    results:Object.fromEntries(ids.map(id => {
      const connection = currentConnection(id);
      return [id, {
        id,
        name:connection?.name || String(id),
        host:connection ? `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}` : "",
        output:"",
        ok:null,
        state:"pending",
        started:false,
        exit_code:null,
        error:"",
        elapsed_ms:null
      }];
    }))
  };
  renderBatchCommandResults(root);
  updateBatchCommandUi(root, state.export);
  batchElement("batchCommandStatus", root).textContent = tr("terminal:batch.connecting_channel");

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws/batch-command`);
  state.socket = socket;
  socket.addEventListener("open", () => socket.send(JSON.stringify({ids, command, timeout_ms:timeout * 1000})));
  socket.addEventListener("message", event => handleBatchCommandEvent(JSON.parse(event.data), tabKey, runId));
  socket.addEventListener("error", () => {
    if (state.export?.run_id !== runId) return;
    state.export.status = "error";
    state.export.running = false;
    state.export.finished_at ||= new Date().toISOString();
    for (const item of Object.values(state.export.results || {})) {
      if (item.ok === null) item.state = "disconnected";
    }
    const uiRoot = batchCommandUiRoot(tabKey);
    if (uiRoot) renderBatchCommandResults(uiRoot);
    notify(tr("terminal:batch.connection_failed"), "error");
  });
  socket.addEventListener("close", () => {
    if (state.export?.run_id === runId && state.export.running) {
      state.export.running = false;
      state.export.status = state.export.stop_requested ? "stopped" : "disconnected";
      state.export.finished_at ||= new Date().toISOString();
      for (const item of Object.values(state.export.results || {})) {
        if (item.ok === null) item.state = state.export.stop_requested ? "stopped" : "disconnected";
      }
      const uiRoot = batchCommandUiRoot(tabKey);
      if (uiRoot) renderBatchCommandResults(uiRoot);
    }
    if (state.socket === socket) state.socket = null;
  });
}

function stopBatchCommand(key=activeTabKey) {
  const state = batchCommandState(key);
  if (state.export?.running) state.export.stop_requested = true;
  try { state.socket?.close(); } catch {}
}

function exportBatchCommand(format) {
  const state = batchCommandState(activeTabKey);
  if (!state.export || state.export.invalidated) return notify(tr("terminal:batch.no_export_results"), "info");
  const data = {...state.export, results:Object.values(state.export.results || {})};
  const text = format === "json"
    ? JSON.stringify(data, null, 2)
    : [
        `${tr("terminal:batch.export_command")}: ${data.command}`,
        `${tr("terminal:batch.export_started")}: ${data.started_at}`,
        `${tr("terminal:batch.export_finished")}: ${data.finished_at || ""}`,
        "",
        ...data.results.flatMap(item => [
          `===== ${item.name} · ${item.host} =====`,
          `${tr("terminal:batch.export_status")}: ${batchCommandResultStatus(item, data)}`,
          item.error ? `${tr("terminal:batch.export_error")}: ${item.error}` : "",
          item.output || tr("terminal:batch.no_output"),
          ""
        ])
      ].join("\n");
  const blob = new Blob([text], {type:format === "json" ? "application/json" : "text/plain"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `terma-batch-${new Date().toISOString().replace(/[:.]/g,"-")}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
