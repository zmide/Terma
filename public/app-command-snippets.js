async function loadCommandSnippets() {
  productivityState.snippets = await api("/api/command-snippets").catch(() => productivityState.snippets);
  if (typeof refreshTerminalQuickCommandBars === "function") refreshTerminalQuickCommandBars();
  return productivityState.snippets;
}

async function openCommandSnippetManager() {
  await loadCommandSnippets();
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide productivity-manager command-snippet-manager" role="dialog" aria-modal="true">
    <div class="productivity-manager-head"><div class="command-snippet-manager-title"><span class="command-snippet-manager-icon">${icon("braces")}</span><span><h2>${esc(tr("terminal:snippets.title", {defaultValue:"命令片段"}))}</h2><small>${esc(tr("terminal:snippets.count", {count:productivityState.snippets.length, defaultValue:`${productivityState.snippets.length} 条常用命令`}))}</small></span></div><div class="command-snippet-toolbar"><button data-snippet-manager-action="import">${icon("upload")}<span>${esc(tr("common:actions.import", {defaultValue:"导入"}))}</span></button><button data-snippet-manager-action="export">${icon("download")}<span>${esc(tr("common:actions.export", {defaultValue:"导出"}))}</span></button><button class="primary" data-snippet-manager-action="create">${icon("plus")}<span>${esc(tr("common:actions.create", {defaultValue:"新建"}))}</span></button></div></div>
    <div class="productivity-list command-snippet-list">${productivityState.snippets.length ? productivityState.snippets.map(item => `<div class="productivity-row command-snippet-row" data-command-snippet-id="${Number(item.id)}">
      <button class="productivity-favorite${item.favorite ? " active" : ""}" data-snippet-manager-action="favorite" title="${escAttr(tr(item.favorite ? "terminal:snippets.unfavorite" : "terminal:snippets.favorite", {defaultValue:item.favorite ? "取消收藏" : "收藏"}))}" aria-label="${escAttr(tr(item.favorite ? "terminal:snippets.unfavorite" : "terminal:snippets.favorite", {defaultValue:item.favorite ? "取消收藏" : "收藏"}))}">${icon("star")}</button>
       <div class="command-snippet-copy"><div class="command-snippet-name"><strong>${esc(item.name)}</strong><span>${esc(item.group_name || tr("terminal:snippets.default_group", {defaultValue:"默认分组"}))}</span>${commandSnippetVariables(item.command).length ? `<span class="command-snippet-workflow-mark">${esc(tr("terminal:snippets.parameterized_workflow", {defaultValue:"参数化 Workflow"}))}</span>` : ""}${item.quick_visible ? `<span class="command-snippet-quick-mark">${esc(tr("terminal:auto.command_bar", {defaultValue:"命令栏"}))}</span>` : ""}</div>${item.description ? `<small>${esc(item.description)}</small>` : ""}<code>${esc(item.command)}</code>${item.tags ? `<div class="command-snippet-tags">${String(item.tags).split(",").filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}</div>
      <div class="command-snippet-actions"><button class="primary" data-snippet-manager-action="use">${icon("play")}<span>${esc(tr("terminal:snippets.use", {defaultValue:"使用"}))}</span></button><button class="icon-button" data-snippet-manager-action="edit" title="${escAttr(tr("common:actions.edit", {defaultValue:"编辑"}))}" aria-label="${escAttr(tr("common:actions.edit", {defaultValue:"编辑"}))}">${icon("pencil")}</button><button class="icon-button danger" data-snippet-manager-action="delete" title="${escAttr(tr("common:actions.delete", {defaultValue:"删除"}))}" aria-label="${escAttr(tr("common:actions.delete", {defaultValue:"删除"}))}">${icon("trash-2")}</button></div>
    </div>`).join("") : stateView("empty", tr("terminal:snippets.empty", {defaultValue:"暂无命令片段"}), tr("terminal:snippets.empty_hint", {defaultValue:"新建后可放到终端下方的快速命令栏。"}))}</div>
    <div class="actions command-snippet-footer"><button data-snippet-manager-action="close">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button></div>
  </div>`;
  modal.querySelector(".command-snippet-manager")?.addEventListener("click", event => {
    const action = event.target.closest?.("[data-snippet-manager-action]")?.dataset.snippetManagerAction;
    if (!action) return;
    const id = Number(event.target.closest?.("[data-command-snippet-id]")?.dataset.commandSnippetId || 0);
    if (action === "import") return importCommandSnippetsFile();
    if (action === "export") return exportCommandSnippets();
    if (action === "create") return openCommandSnippetEditor();
    if (action === "close") return closeModal();
    if (action === "favorite") return void toggleCommandSnippetFavorite(id);
    if (action === "edit") return openCommandSnippetEditor(id);
    if (action === "delete") return void deleteCommandSnippetUi(id);
    if (action === "use") { closeModal(); return void openSnippetExecutionById(id); }
  });
  refreshIcons();
}

function exportCommandSnippets() {
  const payload = {format:"terma-command-snippets", version:2, exported_at:new Date().toISOString(), snippets:productivityState.snippets.map(({id, created_at, updated_at, last_used_at, ...item}) => item)};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "terma-command-snippets.json";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

function importCommandSnippetsFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const items = Array.isArray(payload) ? payload : payload?.snippets;
      if (!Array.isArray(items)) throw new Error(tr("terminal:snippets.invalid_file", {defaultValue:"不是有效的 Terma 命令片段文件"}));
      const names = new Set(productivityState.snippets.map(item => String(item.name).toLowerCase()));
      let imported = 0;
      for (const source of items.slice(0, 1000)) {
        if (!source?.name || !source?.command) continue;
        let name = String(source.name).trim();
        const base = name;
        let index = 2;
        while (names.has(name.toLowerCase())) { name = tr("terminal:snippets.imported_copy", {name:base, count:index, defaultValue:`${base}（导入${index}）`}); index += 1; }
        await api("/api/command-snippets", {method:"POST", body:JSON.stringify({...source, name})});
        names.add(name.toLowerCase());
        imported += 1;
      }
      await loadCommandSnippets();
      notify(tr("terminal:snippets.imported", {count:imported, defaultValue:`已导入 ${imported} 条命令片段`}), "success");
      await openCommandSnippetManager();
    } catch (error) {
      notify(error.message || tr("terminal:snippets.import_failed", {defaultValue:"命令片段导入失败"}), "error");
    }
  };
  input.click();
}

const commandSnippetQuickBadges = ["", "command", "inspect", "service", "network", "database", "file", "start", "stop"];
const commandSnippetLegacyBadgeCodes = Object.freeze({
  "令":"command",
  "查":"inspect",
  "服":"service",
  "网":"network",
  "库":"database",
  "文":"file",
  "启":"start",
  "停":"stop"
});
const commandSnippetQuickColors = ["blue", "green", "amber", "red", "cyan", "gray", "purple"];

function normalizeCommandSnippetBadge(value) {
  const raw = String(value || "");
  const code = commandSnippetLegacyBadgeCodes[raw] || raw;
  return commandSnippetQuickBadges.includes(code) ? code : "";
}

function commandSnippetBadgeLabel(value) {
  const code = normalizeCommandSnippetBadge(value);
  return code ? tr(`terminal:snippets.badges.${code}`, {defaultValue:code}) : tr("terminal:snippets.badges.none", {defaultValue:"无（更紧凑）"});
}

function commandSnippetBadgeGlyph(value) {
  const code = normalizeCommandSnippetBadge(value);
  return code ? tr(`terminal:snippets.badge_glyphs.${code}`, {defaultValue:code}) : "";
}

function openCommandSnippetEditor(id=0, options={}) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id)) || {};
  const quickAction = ["execute", "insert"].includes(item.quick_action) ? item.quick_action : "execute";
  const quickBadge = normalizeCommandSnippetBadge(item.quick_badge);
  const quickColor = commandSnippetQuickColors.includes(item.quick_color) ? item.quick_color : "blue";
  const quickVisible = id ? Boolean(item.quick_visible) : Boolean(options.quick);
  const initialName = id ? String(item.name || "") : String(options.name || "");
  const initialCommand = id ? String(item.command || "") : String(options.command || "");
  const initialDescription = id ? String(item.description || "") : String(options.description || "");
  const workflow = commandSnippetWorkflowValue(id ? item.workflow_json : options.workflow_json);
  const returnTo = options.returnTo || (options.quick ? "terminal" : "manager");
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide" data-snippet-return="${returnTo}" role="dialog" aria-modal="true"><h2>${esc(tr(id ? "terminal:snippets.edit_title" : "terminal:snippets.create_title", {defaultValue:id ? "编辑命令片段" : "新建命令片段"}))}</h2>
    <div class="grid"><div><label>${esc(tr("terminal:snippets.name", {defaultValue:"名称"}))}</label><input id="snippetName" maxlength="120" value="${escAttr(initialName)}"></div><div><label>${esc(tr("terminal:snippets.group", {defaultValue:"分组"}))}</label><input id="snippetGroup" maxlength="120" value="${escAttr(item.group_name || tr("terminal:snippets.default_group", {defaultValue:"默认分组"}))}"></div></div>
     <label>${esc(tr("terminal:snippets.command", {defaultValue:"命令或脚本"}))}</label><textarea id="snippetCommand" class="snippet-command" spellcheck="false">${esc(initialCommand)}</textarea><small class="snippet-parameter-hint">${esc(tr("terminal:snippets.parameter_hint", {defaultValue:"使用 ${name} 定义参数；使用时会先填写参数并预览每个目标的最终命令。"}))}</small>${commandSnippetWorkflowEditorHtml(initialCommand, workflow)}
    <div class="grid"><div><label>${esc(tr("terminal:snippets.tags", {defaultValue:"标签"}))}</label><input id="snippetTags" value="${escAttr(item.tags || "")}"></div><div><label>${esc(tr("terminal:snippets.description", {defaultValue:"说明"}))}</label><input id="snippetDescription" value="${escAttr(initialDescription)}"></div></div>
    <fieldset class="snippet-quick-settings"><legend>${esc(tr("terminal:snippets.quick_bar", {defaultValue:"快速命令栏"}))}</legend>
      <label class="checkline"><input id="snippetQuickVisible" type="checkbox" ${quickVisible ? "checked" : ""}>${esc(tr("terminal:snippets.show_in_quick_bar", {defaultValue:"显示在终端快速命令栏"}))}</label>
      <div class="grid snippet-quick-grid"><div><label>${esc(tr("terminal:snippets.click_action", {defaultValue:"单击操作"}))}</label><select id="snippetQuickAction"><option value="execute" ${quickAction === "execute" ? "selected" : ""}>${esc(tr("terminal:auto.run_now", {defaultValue:"立即执行"}))}</option><option value="insert" ${quickAction === "insert" ? "selected" : ""}>${esc(tr("terminal:auto.insert_only", {defaultValue:"仅插入终端"}))}</option></select></div><div><label>${esc(tr("terminal:snippets.icon", {defaultValue:"图标"}))}</label><select id="snippetQuickBadge">${commandSnippetQuickBadges.map(value => `<option value="${value}" ${value === quickBadge ? "selected" : ""}>${esc(commandSnippetBadgeLabel(value))}</option>`).join("")}</select></div></div>
      <div><label>${esc(tr("terminal:snippets.color", {defaultValue:"颜色"}))}</label><div class="snippet-color-swatches" role="radiogroup" aria-label="${escAttr(tr("terminal:snippets.quick_color", {defaultValue:"快速命令颜色"}))}">${commandSnippetQuickColors.map(value => { const label = tr(`terminal:snippets.colors.${value}`, {defaultValue:value}); return `<label class="snippet-color-swatch ${value}" title="${escAttr(label)}"><input type="radio" name="snippetQuickColor" value="${value}" ${value === quickColor ? "checked" : ""}><span aria-hidden="true"></span><b>${esc(label)}</b></label>`; }).join("")}</div></div>
    </fieldset>
    <div class="actions"><button class="primary" type="button" data-snippet-save>${esc(tr("common:actions.save", {defaultValue:"保存"}))}</button><button type="button" data-snippet-back>${esc(tr("common:actions.back", {defaultValue:"返回"}))}</button></div>
  </div>`;
  const card = modal.querySelector("[data-snippet-return]");
  card?.querySelector("[data-snippet-save]")?.addEventListener("click", () => void saveCommandSnippetUi(Number(id)));
  card?.querySelector("[data-snippet-workflow-sync]")?.addEventListener("click", () => syncCommandSnippetWorkflowParameters(card, $("snippetCommand")?.value || ""));
  card?.querySelector("#snippetWorkflowMultiStep")?.addEventListener("change", event => { const steps = card.querySelector("#snippetWorkflowSteps"); if (steps) steps.disabled = !event.target.checked; });
  card?.addEventListener("change", event => {
    if (event.target.matches("[data-workflow-secret]")) {
      const row = event.target.closest("[data-workflow-parameter-row]");
      const defaultInput = row?.querySelector("[data-workflow-default]");
      if (defaultInput) { defaultInput.disabled = event.target.checked; if (event.target.checked) defaultInput.value = ""; }
    }
    if (event.target.matches("[data-workflow-type]")) {
      const row = event.target.closest("[data-workflow-parameter-row]");
      const optionsInput = row?.querySelector("[data-workflow-options]");
      if (optionsInput) optionsInput.disabled = event.target.value !== "select";
    }
  });
  card?.querySelector("[data-snippet-back]")?.addEventListener("click", () => {
    if (options.quick) closeModal();
    else void openCommandSnippetManager();
  });
  setTimeout(() => $("snippetName")?.focus(), 0);
}

async function saveCommandSnippetUi(id=0) {
  const returnTo = $("modal")?.querySelector("[data-snippet-return]")?.dataset.snippetReturn || "manager";
  const card = $("modal")?.querySelector("[data-snippet-return]");
  const command = $("snippetCommand").value;
  const payload = {
    name:$("snippetName").value.trim(),
    group_name:$("snippetGroup").value.trim(),
    command,
    tags:$("snippetTags").value.trim(),
    description:$("snippetDescription").value.trim(),
    workflow_json:collectCommandSnippetWorkflow(card, command),
    favorite:Number(productivityState.snippets.find(row => Number(row.id) === Number(id))?.favorite || 0) ? 1 : 0,
    quick_visible:$("snippetQuickVisible").checked ? 1 : 0,
    quick_action:$("snippetQuickAction").value,
    quick_badge:$("snippetQuickBadge").value,
    quick_color:document.querySelector("input[name='snippetQuickColor']:checked")?.value || "blue"
  };
  await api(id ? `/api/command-snippets/${id}` : "/api/command-snippets", {method:id ? "PUT" : "POST", body:JSON.stringify(payload)});
  await loadCommandSnippets();
  if (returnTo === "terminal") closeModal();
  else await openCommandSnippetManager();
  notify(tr("terminal:snippets.saved", {defaultValue:"命令片段已保存"}), "success");
}

async function toggleCommandSnippetFavorite(id) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id));
  if (!item) return;
  await api(`/api/command-snippets/${id}`, {method:"PUT", body:JSON.stringify({...item, favorite:item.favorite ? 0 : 1})});
  await loadCommandSnippets();
  await openCommandSnippetManager();
}

async function deleteCommandSnippetUi(id) {
  if (!await confirmModal(tr("terminal:snippets.delete_message", {defaultValue:"删除这个命令片段？"}), tr("terminal:snippets.delete_title", {defaultValue:"删除命令片段"}), tr("common:actions.delete", {defaultValue:"删除"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
  await api(`/api/command-snippets/${id}`, {method:"DELETE"});
  await loadCommandSnippets();
  await openCommandSnippetManager();
}

function openSnippetExecutionById(id) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id));
  if (item) openSnippetExecution(item);
}

function commandSnippetVariables(command) {
  return [...new Set([...String(command || "").matchAll(/\$\{([A-Za-z_][\w-]*)\}/g)].map(match => match[1]))];
}

const commandSnippetBuiltinVariables = new Set(["host", "user", "date"]);

function commandSnippetParameterNames(command) {
  return commandSnippetVariables(command).filter(name => !commandSnippetBuiltinVariables.has(name));
}

const commandSnippetWorkflowTypes = ["text", "path", "port", "boolean", "select"];

function commandSnippetWorkflowValue(value) {
  if (!value) return {version:1, dryRun:false, parameters:[], steps:[]};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return {
      version:Math.max(1, Math.min(100, Math.trunc(Number(parsed?.version || 1) || 1))),
      dryRun:parsed?.dryRun === true,
      parameters:Array.isArray(parsed?.parameters) ? parsed.parameters : [],
      steps:Array.isArray(parsed?.steps) ? parsed.steps : []
    };
  } catch { return {version:1, dryRun:false, parameters:[], steps:[]}; }
}

function commandSnippetWorkflowParameters(command, workflow={}) {
  const existing = new Map((Array.isArray(workflow.parameters) ? workflow.parameters : []).map(item => [String(item?.name || ""), item]));
  const names = new Set(commandSnippetParameterNames(command));
  for (const step of Array.isArray(workflow.steps) ? workflow.steps : []) commandSnippetParameterNames(step?.command || "").forEach(name => names.add(name));
  return [...names].map(name => {
    const item = existing.get(name) || {};
    const type = commandSnippetWorkflowTypes.includes(String(item.type)) ? String(item.type) : "text";
    return {name, type, required:item.required !== false, default:String(item.default || ""), secret:item.secret === true, options:Array.isArray(item.options) ? item.options.map(String) : []};
  });
}

function commandSnippetWorkflowParameterRowsHtml(command, workflow={}) {
  const params = commandSnippetWorkflowParameters(command, workflow);
  return params.length ? params.map(item => `<div class="snippet-workflow-parameter" data-workflow-parameter-row="${escAttr(item.name)}"><strong>${esc(item.name)}</strong><select data-workflow-type aria-label="${escAttr(tr("terminal:snippets.workflow_type", {defaultValue:"参数类型"}))}">${commandSnippetWorkflowTypes.map(type => `<option value="${type}" ${type === item.type ? "selected" : ""}>${esc(tr(`terminal:snippets.workflow_types.${type}`, {defaultValue:type}))}</option>`).join("")}</select><input type="text" data-workflow-default value="${escAttr(item.secret ? "" : item.default)}" placeholder="${escAttr(tr("terminal:snippets.workflow_default", {defaultValue:"默认值"}))}" ${item.secret ? "disabled" : ""}><input type="text" data-workflow-options value="${escAttr(item.options.join(", "))}" placeholder="${escAttr(tr("terminal:snippets.workflow_options", {defaultValue:"选项，用逗号分隔"}))}" ${item.type === "select" ? "" : "disabled"}><label class="checkline"><input type="checkbox" data-workflow-required ${item.required ? "checked" : ""}>${esc(tr("terminal:snippets.workflow_required", {defaultValue:"必填"}))}</label><label class="checkline"><input type="checkbox" data-workflow-secret ${item.secret ? "checked" : ""}>${esc(tr("terminal:snippets.workflow_secret", {defaultValue:"敏感"}))}</label></div>`).join("") : `<span class="muted" data-workflow-empty>${esc(tr("terminal:snippets.workflow_no_parameters", {defaultValue:"命令中还没有自定义参数"}))}</span>`;
}

function commandSnippetWorkflowEditorHtml(command, workflow) {
  const params = commandSnippetWorkflowParameters(command, workflow);
  const steps = Array.isArray(workflow.steps) && workflow.steps.length ? workflow.steps.map(item => String(item?.command || "").trim()).filter(Boolean) : [];
  const stepText = steps.length > 1 ? steps.join("\n") : "";
  return `<fieldset class="snippet-workflow-settings"><legend>${esc(tr("terminal:snippets.workflow_settings", {defaultValue:"Workflow 配置"}))}</legend><div class="snippet-workflow-toolbar"><label class="checkline"><input id="snippetWorkflowEnabled" type="checkbox" ${params.length || steps.length || workflow.dryRun ? "checked" : ""}>${esc(tr("terminal:snippets.workflow_enabled", {defaultValue:"启用结构化 Workflow"}))}</label><button type="button" data-snippet-workflow-sync>${icon("refresh-cw")}<span>${esc(tr("terminal:snippets.workflow_sync", {defaultValue:"同步参数"}))}</span></button></div><div class="snippet-workflow-parameters" data-snippet-workflow-parameters>${commandSnippetWorkflowParameterRowsHtml(command, workflow)}</div><label class="checkline"><input id="snippetWorkflowMultiStep" type="checkbox" ${steps.length > 1 ? "checked" : ""}>${esc(tr("terminal:snippets.workflow_multi_step", {defaultValue:"按步骤执行"}))}</label><textarea id="snippetWorkflowSteps" class="snippet-workflow-steps" rows="3" placeholder="${escAttr(tr("terminal:snippets.workflow_steps_placeholder", {defaultValue:"每行一个步骤；留空时使用上面的命令"}))}" ${steps.length > 1 ? "" : "disabled"}>${esc(stepText)}</textarea><div class="snippet-workflow-footer"><label>${esc(tr("terminal:snippets.workflow_version", {defaultValue:"版本"}))}<input id="snippetWorkflowVersion" type="number" min="1" max="100" value="${workflow.version}"></label><label class="checkline"><input id="snippetWorkflowDryRun" type="checkbox" ${workflow.dryRun ? "checked" : ""}>${esc(tr("terminal:snippets.workflow_dry_run", {defaultValue:"仅试运行预览"}))}</label></div><small class="snippet-parameter-hint">${esc(tr("terminal:snippets.workflow_security_hint", {defaultValue:"敏感参数不会保存默认值；执行前仍会校验路径、端口和选项。"}))}</small></fieldset>`;
}

function collectCommandSnippetWorkflow(card, command) {
  const enabled = Boolean(card?.querySelector("#snippetWorkflowEnabled")?.checked);
  if (!enabled) return "";
  const parameters = [...(card?.querySelectorAll("[data-workflow-parameter-row]") || [])].map(row => {
    const name = String(row.dataset.workflowParameterRow || "");
    const type = commandSnippetWorkflowTypes.includes(row.querySelector("[data-workflow-type]")?.value) ? row.querySelector("[data-workflow-type]").value : "text";
    const secret = row.querySelector("[data-workflow-secret]")?.checked === true;
    return {name, type, required:row.querySelector("[data-workflow-required]")?.checked !== false, default:secret ? "" : String(row.querySelector("[data-workflow-default]")?.value || "").slice(0, 200), secret, options:type === "select" ? String(row.querySelector("[data-workflow-options]")?.value || "").split(/[,，\n]/).map(item => item.trim()).filter(Boolean).slice(0, 50) : []};
  }).filter(item => item.name);
  const steps = card?.querySelector("#snippetWorkflowMultiStep")?.checked ? String(card.querySelector("#snippetWorkflowSteps")?.value || "").replace(/\r\n?/g, "\n").split("\n").map(item => item.trim()).filter(Boolean).map((commandText, index) => ({id:`step-${index + 1}`, label:tr("terminal:snippets.workflow_step_label", {index:index + 1, defaultValue:`步骤 ${index + 1}`}), command:commandText})) : [];
  const result = {version:Math.max(1, Math.min(100, Math.trunc(Number(card?.querySelector("#snippetWorkflowVersion")?.value || 1) || 1))), dryRun:card?.querySelector("#snippetWorkflowDryRun")?.checked === true, parameters, steps};
  return result.parameters.length || result.steps.length || result.dryRun ? JSON.stringify(result) : "";
}

function syncCommandSnippetWorkflowParameters(card, command) {
  if (!card) return;
  const workflow = commandSnippetWorkflowValue(collectCommandSnippetWorkflow(card, command));
  const holder = card.querySelector("[data-snippet-workflow-parameters]");
  if (holder) holder.innerHTML = commandSnippetWorkflowParameterRowsHtml(command, workflow);
}

function snippetExecutionParameterValues(root) {
  const values = {};
  root?.querySelectorAll?.("[data-snippet-parameter]").forEach(input => {
    values[String(input.dataset.snippetParameter || "")] = input.type === "checkbox" ? (input.checked ? "true" : "false") : String(input.value || "");
  });
  return values;
}

function snippetExecutionMissingParameters(snippet, values) {
  const workflow = commandSnippetWorkflowValue(snippet?.workflow_json);
  const parameters = commandSnippetWorkflowParameters(snippet?.command, workflow);
  return parameters.filter(item => item.required && item.type !== "boolean" && !String(values?.[item.name] ?? item.default ?? "").trim()).map(item => item.name);
}

function snippetExecutionWorkflowParameter(snippet, name) {
  const workflow = commandSnippetWorkflowValue(snippet?.workflow_json);
  return commandSnippetWorkflowParameters(snippet?.command, workflow).find(item => item.name === name) || {name, type:"text", required:true, default:"", secret:false, options:[]};
}

function validateSnippetWorkflowValue(parameter, rawValue) {
  const value = String(rawValue ?? "");
  if (parameter.type === "boolean") return /^(?:true|false|yes|no|on|off|1|0)$/i.test(value) ? value : "";
  if (parameter.required && !value.trim()) throw new Error(tr("terminal:snippets.workflow_required_error", {name:parameter.name, defaultValue:`请填写参数 ${parameter.name}`}));
  if (!value.trim()) return value;
  if (/[ \r\n;&|`$()]/.test(value)) throw new Error(tr("terminal:snippets.workflow_value_invalid", {name:parameter.name, defaultValue:`参数 ${parameter.name} 包含不安全字符`}));
  if (parameter.type === "port" && (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw new Error(tr("terminal:snippets.workflow_port_invalid", {name:parameter.name, defaultValue:`参数 ${parameter.name} 必须是 1-65535 的端口`}));
  if (parameter.type === "select" && parameter.options.length && !parameter.options.includes(value)) throw new Error(tr("terminal:snippets.workflow_option_invalid", {name:parameter.name, defaultValue:`参数 ${parameter.name} 不在允许选项中`}));
  return value;
}

function snippetExecutionTargets(root) {
  const targets = [];
  root?.querySelectorAll?.("input[name='snippetTerminalTarget']:checked").forEach(input => {
    const key = String(input.value || "");
    const session = terminalSessions.get(key);
    const connection = session?.connection || currentConnection(session?.id);
    targets.push({kind:"terminal", key, name:String(input.closest("label")?.title || connection?.name || key), connection});
  });
  root?.querySelectorAll?.("input[name='snippetConnectionTarget']:checked").forEach(input => {
    const id = Number(input.value);
    const connection = currentConnection(id);
    targets.push({kind:"connection", id, name:String(connection?.name || input.closest("label")?.title || id), connection});
  });
  return targets;
}

function snippetExecutionTargetCommandSummary(commands) {
  return commands.map(item => `${item.name}:\n${item.command}`).join("\n\n");
}

function snippetWorkflowExecutionCommand(commands) {
  const list = (Array.isArray(commands) ? commands : []).map(item => String(item || "").trim()).filter(Boolean);
  return list.length > 1 ? `set -e\n${list.join("\n")}` : (list[0] || "");
}

async function expandSnippetCommand(snippet, connection=null, values=null) {
  let text = String(snippet.command || "");
  const builtins = {
    host:connection?.ssh_host || "",
    user:connection?.ssh_user || "",
    date:new Date().toISOString().slice(0, 10)
  };
  const names = commandSnippetVariables(text);
  const hasExplicitValues = values && typeof values === "object";
  for (const name of names) {
    let value = builtins[name];
    if (value === undefined) {
      if (hasExplicitValues) value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : "";
      else {
        const parameter = snippetExecutionWorkflowParameter(snippet, name);
        value = await inputModal(tr("terminal:snippets.variable_title", {defaultValue:"命令变量"}), name, parameter.default || "");
        if (value === null) throw new Error(tr("terminal:snippets.use_cancelled", {defaultValue:"已取消使用命令片段"}));
      }
      value = validateSnippetWorkflowValue(snippetExecutionWorkflowParameter(snippet, name), value);
    }
    text = text.replaceAll(`\${${name}}`, String(value));
  }
  return text;
}

async function expandSnippetSteps(snippet, connection=null, values=null) {
  const workflow = commandSnippetWorkflowValue(snippet?.workflow_json);
  const configured = workflow.steps.map(item => String(item?.command || "").trim()).filter(Boolean);
  if (configured.length) return Promise.all(configured.map(command => expandSnippetCommand({...snippet, command}, connection, values)));
  return [await expandSnippetCommand(snippet, connection, values)];
}

async function openSnippetExecution(snippet) {
  await api(`/api/command-snippets/${snippet.id}/use`, {method:"POST", body:"{}"}).catch(() => {});
  const terminalTabs = tabs.filter(tab => tab.kind === "terminal");
  const activeTerminal = tabs.find(tab => tab.key === activeTabKey && tab.kind === "terminal");
  const workflow = commandSnippetWorkflowValue(snippet.workflow_json);
  const workflowParameters = commandSnippetWorkflowParameters(snippet.command, workflow);
  const parameterNames = workflowParameters.map(item => item.name);
  const workflowSteps = workflow.steps.map(item => String(item?.command || "").trim()).filter(Boolean);
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide snippet-run-modal" role="dialog" aria-modal="true"><div class="snippet-run-title"><div><h2>${esc(snippet.name)}</h2><small>${parameterNames.length ? esc(tr("terminal:snippets.parameterized_workflow", {defaultValue:"参数化 Workflow"})) : esc(tr("terminal:snippets.execution_preview", {defaultValue:"执行前预览"}))}</small></div><span class="snippet-run-variable-count">${parameterNames.length ? esc(tr("terminal:snippets.parameter_count", {count:parameterNames.length, defaultValue:`${parameterNames.length} 个参数`})) : esc(tr("terminal:snippets.no_parameters", {defaultValue:"无自定义参数"}))}</span></div><code class="snippet-template-command">${esc(snippet.command)}</code>
      ${parameterNames.length ? `<section class="snippet-parameter-section"><strong>${esc(tr("terminal:snippets.workflow_parameters", {defaultValue:"Workflow 参数"}))}</strong><div class="snippet-parameter-grid">${workflowParameters.map(item => item.type === "boolean" ? `<label class="checkline snippet-parameter-toggle"><input type="checkbox" data-snippet-parameter="${escAttr(item.name)}" ${/^(?:true|yes|on|1)$/i.test(item.default) ? "checked" : ""}><span>${esc(item.name)}</span></label>` : item.type === "select" && item.options.length ? `<label><span>${esc(item.name)}</span><select data-snippet-parameter="${escAttr(item.name)}"><option value="">${esc(tr("terminal:snippets.workflow_select_placeholder", {defaultValue:"请选择"}))}</option>${item.options.map(option => `<option value="${escAttr(option)}" ${option === item.default ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>` : `<label><span>${esc(item.name)}${item.required ? " *" : ""}</span><input type="${item.secret ? "password" : "text"}" data-snippet-parameter="${escAttr(item.name)}" value="${escAttr(item.default)}" autocomplete="${item.secret ? "new-password" : "off"}" spellcheck="false" inputmode="${item.type === "port" ? "numeric" : "text"}" placeholder="${escAttr(tr(`terminal:snippets.workflow_types.${item.type}`, {defaultValue:item.type}))}"></label>`).join("")}</div></section>` : ""}
      ${workflowSteps.length > 1 ? `<section class="snippet-parameter-section"><strong>${esc(tr("terminal:snippets.workflow_steps_preview", {defaultValue:"执行步骤"}))}</strong><ol class="snippet-workflow-step-preview">${workflowSteps.map(step => `<li><code>${esc(step)}</code></li>`).join("")}</ol></section>` : ""}
      ${workflow.dryRun ? `<div class="snippet-preview-empty">${icon("flask-conical")}<span>${esc(tr("terminal:snippets.workflow_dry_run_notice", {defaultValue:"当前 Workflow 为试运行模式，只生成预览，不会发送命令。"}))}</span></div>` : ""}
     <div class="snippet-target-section"><strong>${esc(tr("terminal:snippets.open_terminals", {defaultValue:"已打开终端"}))}</strong><div class="snippet-target-grid">${terminalTabs.map(tab => `<label class="checkline snippet-target-option" title="${escAttr(tab.title)}"><input name="snippetTerminalTarget" type="checkbox" value="${escAttr(tab.key)}" aria-label="${escAttr(tab.title)}" ${tab.key === activeTabKey ? "checked" : ""}><span class="snippet-target-name">${esc(tab.title)}</span></label>`).join("") || `<span class="muted">${esc(tr("terminal:snippets.no_open_terminals", {defaultValue:"暂无已打开终端"}))}</span>`}</div></div>
     <div class="snippet-target-section"><strong>${esc(tr("terminal:snippets.ssh_hosts", {defaultValue:"SSH 主机"}))}</strong><div class="snippet-target-grid">${connections.map(connection => `<label class="checkline snippet-target-option" title="${escAttr(connection.name)}"><input name="snippetConnectionTarget" type="checkbox" value="${connection.id}" aria-label="${escAttr(connection.name)}"><span class="snippet-target-name">${esc(connection.name)}</span></label>`).join("")}</div></div>
     <section class="snippet-execution-preview"><div class="snippet-preview-head"><strong>${esc(tr("terminal:snippets.execution_preview", {defaultValue:"执行前预览"}))}</strong><span>${esc(tr("terminal:snippets.preview_hint", {defaultValue:"确认参数和目标后再执行"}))}</span></div><div data-snippet-preview></div></section>
     <div class="actions"><button type="button" data-action="snippet-run" data-snippet-id="${Number(snippet.id)}" data-snippet-mode="insert" data-snippet-run-mode="insert" ${activeTerminal ? "" : "disabled"}>${esc(tr("terminal:snippets.insert_current", {defaultValue:"插入当前终端"}))}</button><button class="primary" type="button" data-action="snippet-run" data-snippet-id="${Number(snippet.id)}" data-snippet-mode="terminals" data-snippet-run-mode="terminals">${esc(tr("terminal:snippets.run_selected_terminals", {defaultValue:"在所选终端执行"}))}</button><button type="button" data-action="snippet-run" data-snippet-id="${Number(snippet.id)}" data-snippet-mode="connections" data-snippet-run-mode="connections">${esc(tr("terminal:snippets.run_selected_hosts", {defaultValue:"在所选主机执行"}))}</button><button type="button" data-action="snippet-execution-close">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button></div>
   </div>`;
  const card = modal.querySelector(".snippet-run-modal");
  const refresh = () => void refreshSnippetExecutionPreview(snippet);
  card?.addEventListener("input", event => { if (event.target.matches("[data-snippet-parameter]")) refresh(); });
  card?.addEventListener("change", event => { if (event.target.matches("[name='snippetTerminalTarget'],[name='snippetConnectionTarget']")) refresh(); });
  refresh();
}

async function refreshSnippetExecutionPreview(snippet) {
  const modal = $("modal");
  const card = modal?.querySelector(".snippet-run-modal");
  const slot = card?.querySelector("[data-snippet-preview]");
  if (!card || !slot) return;
  const workflow = commandSnippetWorkflowValue(snippet.workflow_json);
  const values = snippetExecutionParameterValues(card);
  const missing = snippetExecutionMissingParameters(snippet, values);
  const targets = snippetExecutionTargets(card);
  const token = String(Number(card.dataset.previewToken || 0) + 1);
  card.dataset.previewToken = token;
  const buttons = card.querySelectorAll("[data-snippet-run-mode]");
  buttons.forEach(button => {
    const mode = button.dataset.snippetRunMode;
    const enabled = !missing.length && (mode === "insert" ? Boolean(activeTabKey && tabs.some(tab => tab.key === activeTabKey && tab.kind === "terminal")) : targets.some(target => target.kind === (mode === "terminals" ? "terminal" : "connection")));
    button.disabled = !enabled;
  });
  if (missing.length) {
    slot.innerHTML = `<div class="snippet-preview-empty warning">${icon("circle-alert")}<span>${esc(tr("terminal:snippets.workflow_missing_parameter", {defaultValue:"请填写所有 Workflow 参数"}))}：${esc(missing.join(", "))}</span></div>`;
    return;
  }
  if (!targets.length) {
    slot.innerHTML = `<div class="snippet-preview-empty">${icon("mouse-pointer-click")}<span>${esc(tr("terminal:snippets.workflow_preview_empty", {defaultValue:"请选择目标后查看命令预览"}))}</span></div>`;
    return;
  }
  const rows = [];
  for (const target of targets.slice(0, 80)) {
    try {
      const commands = await expandSnippetSteps(snippet, target.connection, values);
      rows.push({name:target.name, kind:target.kind, command:commands.join("\n")});
    } catch (error) {
      rows.push({name:target.name, kind:target.kind, error:String(error?.message || error)});
    }
  }
  if (card.dataset.previewToken !== token) return;
  const hasError = rows.some(item => item.error);
  buttons.forEach(button => { if (hasError || workflow.dryRun) button.disabled = true; });
  slot.innerHTML = `<div class="snippet-preview-list">${rows.map(item => `<article class="snippet-preview-row${item.error ? " warning" : ""}"><div><strong>${esc(item.name)}</strong><small>${esc(item.kind === "terminal" ? tr("terminal:snippets.preview_terminal", {defaultValue:"终端"}) : tr("terminal:snippets.preview_host", {defaultValue:"SSH 主机"}))}</small></div><code title="${escAttr(item.error || item.command)}">${esc(item.error || item.command)}</code></article>`).join("")}</div>`;
}

async function runSnippetOnTargets(id, mode) {
  const snippet = productivityState.snippets.find(item => Number(item.id) === Number(id));
  if (!snippet) return;
  const card = $("modal")?.querySelector(".snippet-run-modal");
  const workflow = commandSnippetWorkflowValue(snippet.workflow_json);
  if (workflow.dryRun) {
    notify(tr("terminal:snippets.workflow_dry_run_notice", {defaultValue:"当前 Workflow 为试运行模式，只生成预览，不会发送命令。"}), "info");
    return;
  }
  const values = snippetExecutionParameterValues(card);
  const missing = snippetExecutionMissingParameters(snippet, values);
  if (missing.length) {
    notify(tr("terminal:snippets.workflow_missing_parameter", {defaultValue:"请填写所有 Workflow 参数"}), "info");
    card?.querySelector(`[data-snippet-parameter="${CSS.escape(missing[0])}"]`)?.focus();
    return;
  }
  const terminalKeys = [...(card?.querySelectorAll("input[name='snippetTerminalTarget']:checked") || [])].map(input => input.value);
  const connectionIds = [...(card?.querySelectorAll("input[name='snippetConnectionTarget']:checked") || [])].map(input => Number(input.value));
  const active = tabs.find(tab => tab.key === activeTabKey && tab.kind === "terminal");
  if (mode === "insert") {
    if (!active) return notify(tr("terminal:snippets.open_terminal_first", {defaultValue:"请先打开一个终端"}), "info");
    const commands = await expandSnippetSteps(snippet, active.connection || currentConnection(terminalSessions.get(active.key)?.id), values);
    closeModal();
    sendTerminalData(active.key, snippetWorkflowExecutionCommand(commands));
    return;
  }
  if (mode === "terminals") {
    if (!terminalKeys.length) return notify(tr("terminal:snippets.select_terminal", {defaultValue:"请选择至少一个终端"}), "info");
    const commands = await Promise.all(terminalKeys.map(async key => ({key, name:tabs.find(tab => tab.key === key)?.title || key, command:snippetWorkflowExecutionCommand(await expandSnippetSteps(snippet, terminalSessions.get(key)?.connection || currentConnection(terminalSessions.get(key)?.id), values))})));
    const risky = commands.some(item => item.command.includes("\n") || (typeof commandLooksDangerous === "function" && commandLooksDangerous(item.command)));
    if (risky && !await confirmModal(tr("terminal:snippets.confirm_terminals", {count:terminalKeys.length, command:snippetExecutionTargetCommandSummary(commands), defaultValue:`即将在 ${terminalKeys.length} 个终端执行：\n\n${snippetExecutionTargetCommandSummary(commands)}`}), tr("terminal:snippets.confirm_title", {defaultValue:"确认执行命令片段"}), tr("terminal:auto.execute", {defaultValue:"执行"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
    closeModal();
    for (const item of commands) sendTerminalData(item.key, `${item.command}\r`);
    notify(tr("terminal:snippets.sent_terminals", {count:terminalKeys.length, defaultValue:`已发送到 ${terminalKeys.length} 个终端`}), "success");
    return;
  }
  if (!connectionIds.length) return notify(tr("terminal:snippets.select_host", {defaultValue:"请选择至少一台 SSH 主机"}), "info");
  const commands = await Promise.all(connectionIds.map(async id => ({id, name:currentConnection(id)?.name || String(id), command:snippetWorkflowExecutionCommand(await expandSnippetSteps(snippet, currentConnection(id), values))})));
  const previewText = snippetExecutionTargetCommandSummary(commands);
  if (!await confirmModal(tr("terminal:snippets.confirm_hosts", {count:connectionIds.length, command:previewText, defaultValue:`即将在 ${connectionIds.length} 台主机执行：\n\n${previewText}`}), tr("terminal:snippets.confirm_batch_title", {defaultValue:"确认批量执行"}), tr("terminal:auto.execute", {defaultValue:"执行"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
  closeModal();
  const merged = {ok:0, total:0, results:[]};
  for (const item of commands) {
    try {
      const result = await api("/api/commands/batch", {method:"POST", body:JSON.stringify({ids:[item.id], command:item.command})});
      merged.ok += Number(result?.ok || 0);
      merged.total += Number(result?.total || 1);
      merged.results.push(...(Array.isArray(result?.results) ? result.results : [{name:item.name, ok:Number(result?.ok || 0) > 0, output:result?.output || ""}]));
    } catch (error) {
      merged.total += 1;
      merged.results.push({name:item.name, ok:false, output:String(error?.message || error)});
    }
  }
  showSnippetBatchResult(snippet.name, merged);
}

function showSnippetBatchResult(title, result) {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide"><h2>${esc(title)} · ${result.ok}/${result.total}</h2><div class="productivity-list">${(result.results || []).map(item => `<div class="productivity-row batch-result ${item.ok ? "ok" : "bad"}"><div><strong>${esc(item.name)}</strong><small>${esc(item.ok ? tr("terminal:snippets.run_succeeded", {defaultValue:"执行成功"}) : tr("terminal:snippets.run_failed", {code:item.exit_code, defaultValue:`失败 · ${item.exit_code}`}))}</small><pre>${esc(item.output || "")}</pre></div></div>`).join("")}</div><div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button></div></div>`;
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("snippet-run", ({element}) => runSnippetOnTargets(Number(element.dataset.snippetId || 0), element.dataset.snippetMode || "terminals"));
  registerTermaAction("snippet-execution-close", () => closeModal());
}
