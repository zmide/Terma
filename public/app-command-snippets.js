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
      <div class="command-snippet-copy"><div class="command-snippet-name"><strong>${esc(item.name)}</strong><span>${esc(item.group_name || tr("terminal:snippets.default_group", {defaultValue:"默认分组"}))}</span>${item.quick_visible ? `<span class="command-snippet-quick-mark">${esc(tr("terminal:auto.command_bar", {defaultValue:"命令栏"}))}</span>` : ""}</div>${item.description ? `<small>${esc(item.description)}</small>` : ""}<code>${esc(item.command)}</code>${item.tags ? `<div class="command-snippet-tags">${String(item.tags).split(",").filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}</div>
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
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide" data-snippet-return="${options.quick ? "terminal" : "manager"}" role="dialog" aria-modal="true"><h2>${esc(tr(id ? "terminal:snippets.edit_title" : "terminal:snippets.create_title", {defaultValue:id ? "编辑命令片段" : "新建命令片段"}))}</h2>
    <div class="grid"><div><label>${esc(tr("terminal:snippets.name", {defaultValue:"名称"}))}</label><input id="snippetName" maxlength="120" value="${escAttr(item.name || "")}"></div><div><label>${esc(tr("terminal:snippets.group", {defaultValue:"分组"}))}</label><input id="snippetGroup" maxlength="120" value="${escAttr(item.group_name || tr("terminal:snippets.default_group", {defaultValue:"默认分组"}))}"></div></div>
    <label>${esc(tr("terminal:snippets.command", {defaultValue:"命令或脚本"}))}</label><textarea id="snippetCommand" class="snippet-command" spellcheck="false">${esc(item.command || "")}</textarea>
    <div class="grid"><div><label>${esc(tr("terminal:snippets.tags", {defaultValue:"标签"}))}</label><input id="snippetTags" value="${escAttr(item.tags || "")}"></div><div><label>${esc(tr("terminal:snippets.description", {defaultValue:"说明"}))}</label><input id="snippetDescription" value="${escAttr(item.description || "")}"></div></div>
    <fieldset class="snippet-quick-settings"><legend>${esc(tr("terminal:snippets.quick_bar", {defaultValue:"快速命令栏"}))}</legend>
      <label class="checkline"><input id="snippetQuickVisible" type="checkbox" ${quickVisible ? "checked" : ""}>${esc(tr("terminal:snippets.show_in_quick_bar", {defaultValue:"显示在终端快速命令栏"}))}</label>
      <div class="grid snippet-quick-grid"><div><label>${esc(tr("terminal:snippets.click_action", {defaultValue:"单击操作"}))}</label><select id="snippetQuickAction"><option value="execute" ${quickAction === "execute" ? "selected" : ""}>${esc(tr("terminal:auto.run_now", {defaultValue:"立即执行"}))}</option><option value="insert" ${quickAction === "insert" ? "selected" : ""}>${esc(tr("terminal:auto.insert_only", {defaultValue:"仅插入终端"}))}</option></select></div><div><label>${esc(tr("terminal:snippets.icon", {defaultValue:"图标"}))}</label><select id="snippetQuickBadge">${commandSnippetQuickBadges.map(value => `<option value="${value}" ${value === quickBadge ? "selected" : ""}>${esc(commandSnippetBadgeLabel(value))}</option>`).join("")}</select></div></div>
      <div><label>${esc(tr("terminal:snippets.color", {defaultValue:"颜色"}))}</label><div class="snippet-color-swatches" role="radiogroup" aria-label="${escAttr(tr("terminal:snippets.quick_color", {defaultValue:"快速命令颜色"}))}">${commandSnippetQuickColors.map(value => { const label = tr(`terminal:snippets.colors.${value}`, {defaultValue:value}); return `<label class="snippet-color-swatch ${value}" title="${escAttr(label)}"><input type="radio" name="snippetQuickColor" value="${value}" ${value === quickColor ? "checked" : ""}><span aria-hidden="true"></span><b>${esc(label)}</b></label>`; }).join("")}</div></div>
    </fieldset>
    <div class="actions"><button class="primary" type="button" data-snippet-save>${esc(tr("common:actions.save", {defaultValue:"保存"}))}</button><button type="button" data-snippet-back>${esc(tr("common:actions.back", {defaultValue:"返回"}))}</button></div>
  </div>`;
  const card = modal.querySelector("[data-snippet-return]");
  card?.querySelector("[data-snippet-save]")?.addEventListener("click", () => void saveCommandSnippetUi(Number(id)));
  card?.querySelector("[data-snippet-back]")?.addEventListener("click", () => {
    if (options.quick) closeModal();
    else void openCommandSnippetManager();
  });
  setTimeout(() => $("snippetName")?.focus(), 0);
}

async function saveCommandSnippetUi(id=0) {
  const returnTo = $("modal")?.querySelector("[data-snippet-return]")?.dataset.snippetReturn || "manager";
  const payload = {
    name:$("snippetName").value.trim(),
    group_name:$("snippetGroup").value.trim(),
    command:$("snippetCommand").value,
    tags:$("snippetTags").value.trim(),
    description:$("snippetDescription").value.trim(),
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

async function expandSnippetCommand(snippet, connection=null) {
  let text = String(snippet.command || "");
  const builtins = {
    host:connection?.ssh_host || "",
    user:connection?.ssh_user || "",
    date:new Date().toISOString().slice(0, 10)
  };
  const names = [...new Set([...text.matchAll(/\$\{([A-Za-z_][\w-]*)\}/g)].map(match => match[1]))];
  for (const name of names) {
    let value = builtins[name];
    if (value === undefined) {
      value = await inputModal(tr("terminal:snippets.variable_title", {defaultValue:"命令变量"}), name, "");
      if (value === null) throw new Error(tr("terminal:snippets.use_cancelled", {defaultValue:"已取消使用命令片段"}));
    }
    text = text.replaceAll(`\${${name}}`, String(value));
  }
  return text;
}

async function openSnippetExecution(snippet) {
  await api(`/api/command-snippets/${snippet.id}/use`, {method:"POST", body:"{}"}).catch(() => {});
  const terminalTabs = tabs.filter(tab => tab.kind === "terminal");
  const activeTerminal = tabs.find(tab => tab.key === activeTabKey && tab.kind === "terminal");
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide snippet-run-modal" role="dialog" aria-modal="true"><h2>${esc(snippet.name)}</h2><code class="snippet-preview">${esc(snippet.command)}</code>
    <div class="snippet-target-section"><strong>${esc(tr("terminal:snippets.open_terminals", {defaultValue:"已打开终端"}))}</strong><div class="snippet-target-grid">${terminalTabs.map(tab => `<label class="checkline snippet-target-option" title="${escAttr(tab.title)}"><input name="snippetTerminalTarget" type="checkbox" value="${escAttr(tab.key)}" aria-label="${escAttr(tab.title)}" ${tab.key === activeTabKey ? "checked" : ""}><span class="snippet-target-name">${esc(tab.title)}</span></label>`).join("") || `<span class="muted">${esc(tr("terminal:snippets.no_open_terminals", {defaultValue:"暂无已打开终端"}))}</span>`}</div></div>
    <div class="snippet-target-section"><strong>${esc(tr("terminal:snippets.ssh_hosts", {defaultValue:"SSH 主机"}))}</strong><div class="snippet-target-grid">${connections.map(connection => `<label class="checkline snippet-target-option" title="${escAttr(connection.name)}"><input name="snippetConnectionTarget" type="checkbox" value="${connection.id}" aria-label="${escAttr(connection.name)}"><span class="snippet-target-name">${esc(connection.name)}</span></label>`).join("")}</div></div>
    <div class="actions"><button ${activeTerminal ? "" : "disabled"} onclick="runSnippetOnTargets(${snippet.id},'insert')">${esc(tr("terminal:snippets.insert_current", {defaultValue:"插入当前终端"}))}</button><button class="primary" onclick="runSnippetOnTargets(${snippet.id},'terminals')">${esc(tr("terminal:snippets.run_selected_terminals", {defaultValue:"在所选终端执行"}))}</button><button onclick="runSnippetOnTargets(${snippet.id},'connections')">${esc(tr("terminal:snippets.run_selected_hosts", {defaultValue:"在所选主机执行"}))}</button><button onclick="closeModal()">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button></div>
  </div>`;
}

async function runSnippetOnTargets(id, mode) {
  const snippet = productivityState.snippets.find(item => Number(item.id) === Number(id));
  if (!snippet) return;
  const terminalKeys = [...document.querySelectorAll("input[name='snippetTerminalTarget']:checked")].map(input => input.value);
  const connectionIds = [...document.querySelectorAll("input[name='snippetConnectionTarget']:checked")].map(input => Number(input.value));
  const active = tabs.find(tab => tab.key === activeTabKey && tab.kind === "terminal");
  const reference = currentConnection(mode === "connections" ? connectionIds[0] : terminalSessions.get((mode === "insert" ? active?.key : terminalKeys[0]))?.id);
  const command = await expandSnippetCommand(snippet, reference);
  if (mode === "insert") {
    if (!active) return notify(tr("terminal:snippets.open_terminal_first", {defaultValue:"请先打开一个终端"}), "info");
    closeModal();
    sendTerminalData(active.key, command);
    return;
  }
  if (mode === "terminals") {
    if (!terminalKeys.length) return notify(tr("terminal:snippets.select_terminal", {defaultValue:"请选择至少一个终端"}), "info");
    if ((command.includes("\n") || (typeof commandLooksDangerous === "function" && commandLooksDangerous(command)))
      && !await confirmModal(tr("terminal:snippets.confirm_terminals", {count:terminalKeys.length, command, defaultValue:`即将在 ${terminalKeys.length} 个终端执行：\n\n${command}`}), tr("terminal:snippets.confirm_title", {defaultValue:"确认执行命令片段"}), tr("terminal:auto.execute", {defaultValue:"执行"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
    closeModal();
    for (const key of terminalKeys) sendTerminalData(key, `${command}\r`);
    notify(tr("terminal:snippets.sent_terminals", {count:terminalKeys.length, defaultValue:`已发送到 ${terminalKeys.length} 个终端`}), "success");
    return;
  }
  if (!connectionIds.length) return notify(tr("terminal:snippets.select_host", {defaultValue:"请选择至少一台 SSH 主机"}), "info");
  if (!await confirmModal(tr("terminal:snippets.confirm_hosts", {count:connectionIds.length, command, defaultValue:`即将在 ${connectionIds.length} 台主机执行：\n\n${command}`}), tr("terminal:snippets.confirm_batch_title", {defaultValue:"确认批量执行"}), tr("terminal:auto.execute", {defaultValue:"执行"}), tr("common:actions.cancel", {defaultValue:"取消"}), true)) return;
  closeModal();
  const result = await api("/api/commands/batch", {method:"POST", body:JSON.stringify({ids:connectionIds, command})});
  showSnippetBatchResult(snippet.name, result);
}

function showSnippetBatchResult(title, result) {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide"><h2>${esc(title)} · ${result.ok}/${result.total}</h2><div class="productivity-list">${(result.results || []).map(item => `<div class="productivity-row batch-result ${item.ok ? "ok" : "bad"}"><div><strong>${esc(item.name)}</strong><small>${esc(item.ok ? tr("terminal:snippets.run_succeeded", {defaultValue:"执行成功"}) : tr("terminal:snippets.run_failed", {code:item.exit_code, defaultValue:`失败 · ${item.exit_code}`}))}</small><pre>${esc(item.output || "")}</pre></div></div>`).join("")}</div><div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button></div></div>`;
}
