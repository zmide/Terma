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
    <div class="productivity-manager-head"><div class="command-snippet-manager-title"><span class="command-snippet-manager-icon">${icon("braces")}</span><span><h2>命令片段</h2><small>${productivityState.snippets.length} 条常用命令</small></span></div><div class="command-snippet-toolbar"><button data-snippet-manager-action="import">${icon("upload")}<span>导入</span></button><button data-snippet-manager-action="export">${icon("download")}<span>导出</span></button><button class="primary" data-snippet-manager-action="create">${icon("plus")}<span>新建</span></button></div></div>
    <div class="productivity-list command-snippet-list">${productivityState.snippets.length ? productivityState.snippets.map(item => `<div class="productivity-row command-snippet-row" data-command-snippet-id="${Number(item.id)}">
      <button class="productivity-favorite${item.favorite ? " active" : ""}" data-snippet-manager-action="favorite" title="${item.favorite ? "取消收藏" : "收藏"}" aria-label="${item.favorite ? "取消收藏" : "收藏"}">${icon("star")}</button>
      <div class="command-snippet-copy"><div class="command-snippet-name"><strong>${esc(item.name)}</strong><span>${esc(item.group_name || "默认分组")}</span>${item.quick_visible ? `<span class="command-snippet-quick-mark">命令栏</span>` : ""}</div>${item.description ? `<small>${esc(item.description)}</small>` : ""}<code>${esc(item.command)}</code>${item.tags ? `<div class="command-snippet-tags">${String(item.tags).split(",").filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}</div>
      <div class="command-snippet-actions"><button class="primary" data-snippet-manager-action="use">${icon("play")}<span>使用</span></button><button class="icon-button" data-snippet-manager-action="edit" title="编辑" aria-label="编辑">${icon("pencil")}</button><button class="icon-button danger" data-snippet-manager-action="delete" title="删除" aria-label="删除">${icon("trash-2")}</button></div>
    </div>`).join("") : stateView("empty", "暂无命令片段", "新建后可放到终端下方的快速命令栏。")}</div>
    <div class="actions command-snippet-footer"><button data-snippet-manager-action="close">关闭</button></div>
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
      if (!Array.isArray(items)) throw new Error("不是有效的 Terma 命令片段文件");
      const names = new Set(productivityState.snippets.map(item => String(item.name).toLowerCase()));
      let imported = 0;
      for (const source of items.slice(0, 1000)) {
        if (!source?.name || !source?.command) continue;
        let name = String(source.name).trim();
        const base = name;
        let index = 2;
        while (names.has(name.toLowerCase())) { name = `${base}（导入${index}）`; index += 1; }
        await api("/api/command-snippets", {method:"POST", body:JSON.stringify({...source, name})});
        names.add(name.toLowerCase());
        imported += 1;
      }
      await loadCommandSnippets();
      notify(`已导入 ${imported} 条命令片段`, "success");
      await openCommandSnippetManager();
    } catch (error) {
      notify(error.message || "命令片段导入失败", "error");
    }
  };
  input.click();
}

const commandSnippetQuickBadges = ["", "令", "查", "服", "网", "库", "文", "启", "停"];
const commandSnippetQuickColors = [
  ["blue", "蓝色"], ["green", "绿色"], ["amber", "琥珀"], ["red", "红色"],
  ["cyan", "青色"], ["gray", "灰色"], ["purple", "紫色"]
];

function openCommandSnippetEditor(id=0, options={}) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id)) || {};
  const quickAction = ["execute", "insert"].includes(item.quick_action) ? item.quick_action : "execute";
  const quickBadge = commandSnippetQuickBadges.includes(item.quick_badge) ? item.quick_badge : "";
  const quickColor = commandSnippetQuickColors.some(([value]) => value === item.quick_color) ? item.quick_color : "blue";
  const quickVisible = id ? Boolean(item.quick_visible) : Boolean(options.quick);
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide" data-snippet-return="${options.quick ? "terminal" : "manager"}" role="dialog" aria-modal="true"><h2>${id ? "编辑" : "新建"}命令片段</h2>
    <div class="grid"><div><label>名称</label><input id="snippetName" maxlength="120" value="${escAttr(item.name || "")}"></div><div><label>分组</label><input id="snippetGroup" maxlength="120" value="${escAttr(item.group_name || "默认分组")}"></div></div>
    <label>命令或脚本</label><textarea id="snippetCommand" class="snippet-command" spellcheck="false">${esc(item.command || "")}</textarea>
    <div class="grid"><div><label>标签</label><input id="snippetTags" value="${escAttr(item.tags || "")}"></div><div><label>说明</label><input id="snippetDescription" value="${escAttr(item.description || "")}"></div></div>
    <fieldset class="snippet-quick-settings"><legend>快速命令栏</legend>
      <label class="checkline"><input id="snippetQuickVisible" type="checkbox" ${quickVisible ? "checked" : ""}>显示在终端快速命令栏</label>
      <div class="grid snippet-quick-grid"><div><label>单击操作</label><select id="snippetQuickAction"><option value="execute" ${quickAction === "execute" ? "selected" : ""}>立即执行</option><option value="insert" ${quickAction === "insert" ? "selected" : ""}>仅插入终端</option></select></div><div><label>图标</label><select id="snippetQuickBadge">${commandSnippetQuickBadges.map(value => `<option value="${value}" ${value === quickBadge ? "selected" : ""}>${value || "无（更紧凑）"}</option>`).join("")}</select></div></div>
      <div><label>颜色</label><div class="snippet-color-swatches" role="radiogroup" aria-label="快速命令颜色">${commandSnippetQuickColors.map(([value,label]) => `<label class="snippet-color-swatch ${value}" title="${label}"><input type="radio" name="snippetQuickColor" value="${value}" ${value === quickColor ? "checked" : ""}><span aria-hidden="true"></span><b>${label}</b></label>`).join("")}</div></div>
    </fieldset>
    <div class="actions"><button class="primary" type="button" data-snippet-save>保存</button><button type="button" data-snippet-back>返回</button></div>
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
  notify("命令片段已保存", "success");
}

async function toggleCommandSnippetFavorite(id) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id));
  if (!item) return;
  await api(`/api/command-snippets/${id}`, {method:"PUT", body:JSON.stringify({...item, favorite:item.favorite ? 0 : 1})});
  await loadCommandSnippets();
  await openCommandSnippetManager();
}

async function deleteCommandSnippetUi(id) {
  if (!await confirmModal("删除这个命令片段？", "删除命令片段", "删除", "取消", true)) return;
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
      value = await inputModal("命令变量", name, "");
      if (value === null) throw new Error("已取消使用命令片段");
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
    <div class="snippet-target-section"><strong>已打开终端</strong><div class="snippet-target-grid">${terminalTabs.map(tab => `<label class="checkline"><input name="snippetTerminalTarget" type="checkbox" value="${escAttr(tab.key)}" ${tab.key === activeTabKey ? "checked" : ""}>${esc(tab.title)}</label>`).join("") || `<span class="muted">暂无已打开终端</span>`}</div></div>
    <div class="snippet-target-section"><strong>SSH 主机</strong><div class="snippet-target-grid">${connections.map(connection => `<label class="checkline"><input name="snippetConnectionTarget" type="checkbox" value="${connection.id}">${esc(connection.name)}</label>`).join("")}</div></div>
    <div class="actions"><button ${activeTerminal ? "" : "disabled"} onclick="runSnippetOnTargets(${snippet.id},'insert')">插入当前终端</button><button class="primary" onclick="runSnippetOnTargets(${snippet.id},'terminals')">在所选终端执行</button><button onclick="runSnippetOnTargets(${snippet.id},'connections')">在所选主机执行</button><button onclick="closeModal()">取消</button></div>
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
    if (!active) return notify("请先打开一个终端", "info");
    closeModal();
    sendTerminalData(active.key, command);
    return;
  }
  if (mode === "terminals") {
    if (!terminalKeys.length) return notify("请选择至少一个终端", "info");
    if ((command.includes("\n") || (typeof commandLooksDangerous === "function" && commandLooksDangerous(command)))
      && !await confirmModal(`即将在 ${terminalKeys.length} 个终端执行：\n\n${command}`, "确认执行命令片段", "执行", "取消", true)) return;
    closeModal();
    for (const key of terminalKeys) sendTerminalData(key, `${command}\r`);
    notify(`已发送到 ${terminalKeys.length} 个终端`, "success");
    return;
  }
  if (!connectionIds.length) return notify("请选择至少一台 SSH 主机", "info");
  if (!await confirmModal(`即将在 ${connectionIds.length} 台主机执行：\n\n${command}`, "确认批量执行", "执行", "取消", true)) return;
  closeModal();
  const result = await api("/api/commands/batch", {method:"POST", body:JSON.stringify({ids:connectionIds, command})});
  showSnippetBatchResult(snippet.name, result);
}

function showSnippetBatchResult(title, result) {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide"><h2>${esc(title)} · ${result.ok}/${result.total}</h2><div class="productivity-list">${(result.results || []).map(item => `<div class="productivity-row batch-result ${item.ok ? "ok" : "bad"}"><div><strong>${esc(item.name)}</strong><small>${item.ok ? "执行成功" : `失败 · ${esc(item.exit_code)}`}</small><pre>${esc(item.output || "")}</pre></div></div>`).join("")}</div><div class="actions"><button onclick="closeModal()">关闭</button></div></div>`;
}
