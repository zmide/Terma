const productivityState = {
  quickItems:[],
  quickIndex:0,
  snippets:[],
  workspaces:[],
  closedTabs:[],
  broadcastTargets:new Set(),
  broadcastPaused:false,
  externalEditTimers:new Map(),
  externalEditPrompts:new Set(),
  externalEditObserved:new Map()
};

function externalEditorSettings() {
  return {
    mode:localStorage.getItem("sftpExternalEditorMode") || "system",
    path:localStorage.getItem("sftpExternalEditorPath") || "",
    args:(localStorage.getItem("sftpExternalEditorArgs") || "").match(/(?:[^\s"]+|"[^"]*")+/g)?.map(value => value.replace(/^"|"$/g, "")) || []
  };
}

async function openSftpExternalEdit(connectionId, remotePath) {
  const session = await api(`/api/connections/${Number(connectionId)}/sftp/external-edit`, {
    method:"POST",
    body:JSON.stringify({path:remotePath, editor:externalEditorSettings()})
  });
  notify("外部编辑器已打开；保存后会自动检查并上传", "success");
  const timer = setInterval(() => pollSftpExternalEdit(session.id), 1200);
  productivityState.externalEditTimers.set(session.id, timer);
}

async function pollSftpExternalEdit(id) {
  let session;
  try { session = await api(`/api/sftp/external-edits/${id}`); }
  catch {
    clearInterval(productivityState.externalEditTimers.get(id));
    productivityState.externalEditTimers.delete(id);
    return;
  }
  if (session.status === "synced") {
    const signature = `${session.status}:${session.updated_at || ""}`;
    if (productivityState.externalEditObserved.get(id) !== signature) {
      productivityState.externalEditObserved.set(id, signature);
      notify(`已上传：${session.remote_path}`, "success");
      const tab = tabs.find(item => item.kind === "sftp" && Number(item.id) === Number(session.connection_id));
      if (tab && typeof refreshSftp === "function") refreshSftp({refresh:true, tabKey:tab.key}).catch(() => {});
    }
  }
  if (session.status !== "conflict" || productivityState.externalEditPrompts.has(id)) return;
  productivityState.externalEditPrompts.add(id);
  try {
    const choice = await chooseModal("远程文件已变化", `${session.connection_name}\n${session.remote_path}\n\n请选择如何处理本地编辑内容。`, [
      {label:"覆盖远程并保留备份", value:"overwrite", className:"danger"},
      {label:"另存为远程文件", value:"save_as", className:"primary"},
      {label:"取消本次上传", value:"cancel"}
    ]);
    const payload = {action:choice};
    if (choice === "save_as") {
      const remotePath = await inputModal("另存为远程文件", "远程路径", `${session.remote_path}.local`);
      if (!remotePath) return;
      payload.remote_path = remotePath;
    }
    if (!choice) return;
    const resolved = await api(`/api/sftp/external-edits/${id}/resolve`, {method:"POST", body:JSON.stringify(payload)});
    notify(resolved.message, choice === "cancel" ? "info" : "success");
  } finally {
    productivityState.externalEditPrompts.delete(id);
  }
}

async function openSftpExternalEditManager() {
  const sessions = await api("/api/sftp/external-edits").catch(() => []);
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide productivity-manager"><div class="productivity-manager-head"><div><h2>外部编辑会话</h2><span>${sessions.length} 个</span></div><button class="icon-button" title="刷新" aria-label="刷新" onclick="openSftpExternalEditManager()">${icon("refresh-cw")}</button></div><div class="productivity-list">${sessions.length ? sessions.map(session => `<div class="productivity-row"><span class="quick-result-icon">${icon(session.status === "conflict" ? "triangle-alert" : "file-pen-line")}</span><div><strong>${esc(session.remote_path)}</strong><small>${esc(session.connection_name)} · ${esc(session.message || session.status)}</small><code>${esc(session.local_path)}</code></div><div class="actions tight"><button class="danger" onclick="stopSftpExternalEdit('${escAttr(session.id)}')">停止并清理</button></div></div>`).join("") : stateView("empty", "暂无外部编辑会话", "从 SFTP 文件右键菜单使用外部编辑器打开后会显示在这里。")}</div><div class="actions"><button onclick="closeModal()">关闭</button></div></div>`;
  refreshIcons();
}

async function stopSftpExternalEdit(id) {
  await api(`/api/sftp/external-edits/${encodeURIComponent(id)}`, {method:"DELETE"});
  clearInterval(productivityState.externalEditTimers.get(id));
  productivityState.externalEditTimers.delete(id);
  productivityState.externalEditObserved.delete(id);
  await openSftpExternalEditManager();
}

async function chooseSftpSyncLocalDirectory() {
  const result = await api("/api/sftp/sync/choose-directory", {method:"POST", body:"{}"});
  return String(result?.path || "");
}

async function openSftpDirectorySync(connectionId, remotePath=".", tabKey=activeTabKey) {
  if (!window.tunnelDeskDesktop) return notify("目录同步仅在桌面端提供", "info");
  let localPath = "";
  try { localPath = await chooseSftpSyncLocalDirectory(); }
  catch (error) { return notify(error.message || "无法选择本地目录", "error"); }
  if (!localPath) return;
  const connection = currentConnection(Number(connectionId));
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>目录比较与同步</h2><span>${esc(connection?.name || "SSH 主机")}</span></div><button class="icon-button" title="关闭" aria-label="关闭" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-paths"><label>本地目录<input id="sftpSyncLocalPath" value="${escAttr(localPath)}" readonly></label><label>远程目录<input id="sftpSyncRemotePath" value="${escAttr(remotePath || ".")}" readonly></label></div>
    <div class="form-grid sftp-sync-options"><label>同步方式<select id="sftpSyncMode"><option value="bidirectional">双向同步</option><option value="upload">仅上传到远程</option><option value="download">仅下载到本地</option></select></label><label class="checkline"><input id="sftpSyncUseHash" type="checkbox">内容不明确时校验 SHA-256</label></div>
    <label>附加排除规则<textarea id="sftpSyncExcludes" rows="3" placeholder="每行一个，例如 build 或 *.log"></textarea></label>
    <div class="sftp-sync-safety">${icon("shield-check")}<span>只同步勾选项目，不会删除本地或远程文件；远程覆盖会先保留备份。</span></div>
    <div class="actions"><button onclick="closeModal()">取消</button><button class="primary" onclick="createSftpSyncPlan(${Number(connectionId)},'${escAttr(tabKey)}')">${icon("scan-search")}<span>生成变更清单</span></button></div></div>`;
  refreshIcons();
}

async function createSftpSyncPlan(connectionId, tabKey=activeTabKey) {
  const request = {
    local_path:$("sftpSyncLocalPath")?.value || "",
    remote_path:$("sftpSyncRemotePath")?.value || ".",
    mode:$("sftpSyncMode")?.value || "bidirectional",
    use_hash:Boolean($("sftpSyncUseHash")?.checked),
    excludes:$("sftpSyncExcludes")?.value || ""
  };
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card"><h2>正在比较目录</h2>${stateView("loading", "正在扫描本地和远程文件", "可在工作区任务中心查看进度")}</div>`;
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/plan`, {method:"POST", body:JSON.stringify(request)});
    if (typeof refreshSftpJobs === "function") refreshSftpJobs();
    let current = job;
    while (current.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 600));
      current = await api(`/api/sftp/sync/jobs/${encodeURIComponent(job.id)}`);
    }
    if (current.status === "cancelled") return closeModal();
    if (current.status !== "completed" || !current.plan_result) throw new Error(current.errors?.[0]?.error || "目录比较失败");
    renderSftpSyncPlan(connectionId, current.plan_result, tabKey);
  } catch (error) {
    modal.innerHTML = `<div class="modal-card"><h2>目录比较失败</h2>${stateView("error", "无法生成同步清单", error.message || String(error))}<div class="actions"><button onclick="closeModal()">关闭</button><button class="primary" onclick="openSftpDirectorySync(${Number(connectionId)},'${escAttr(request.remote_path)}','${escAttr(tabKey)}')">重试</button></div></div>`;
  }
}

function sftpSyncActionLabel(action) {
  return {upload:"上传", download:"下载", conflict:"冲突"}[action] || action;
}

function renderSftpSyncPlan(connectionId, plan, tabKey=activeTabKey) {
  const modal = $("modal");
  modal._sftpSyncPlan = plan;
  const totals = plan.totals || {};
  modal.innerHTML = `<div class="modal-card extra-wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>确认同步清单</h2><span>${Number(totals.upload || 0)} 项上传 · ${Number(totals.download || 0)} 项下载 · ${Number(totals.conflict || 0)} 项冲突</span></div><button class="icon-button" title="关闭" aria-label="关闭" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-plan-head"><label class="checkline"><input id="sftpSyncSelectAll" type="checkbox" checked onchange="toggleSftpSyncPlanSelection(this.checked)">选择全部非冲突项目</label><span>${esc(plan.local_path)} ⇄ ${esc(plan.remote_path)}</span></div>
    <div class="sftp-sync-plan-list">${plan.actions.length ? plan.actions.map(item => `<div class="sftp-sync-plan-row ${escAttr(item.action)}"><input class="sftp-sync-plan-check" type="checkbox" value="${item.index}" ${item.selected ? "checked" : ""} ${item.action === "conflict" ? "disabled" : ""}><span class="sftp-sync-direction">${icon(item.action === "upload" ? "upload" : item.action === "download" ? "download" : "triangle-alert")}<strong>${sftpSyncActionLabel(item.action)}</strong></span><div><strong title="${escAttr(item.relative)}">${esc(item.relative)}</strong><small>${esc(item.reason)}</small></div>${item.action === "conflict" ? `<select class="sftp-sync-conflict-direction" data-index="${item.index}" onchange="setSftpSyncConflictDirection(${item.index},this.value)"><option value="">暂不处理</option><option value="upload">上传本地版本</option><option value="download">下载远程版本</option></select>` : `<span class="sftp-sync-size">${item.local_size === null ? "-" : formatBytes(item.local_size)} / ${item.remote_size === null ? "-" : formatBytes(item.remote_size)}</span>`}</div>`).join("") : stateView("empty", "两端内容一致", "没有需要同步的文件")}</div>
    <div class="actions"><button onclick="closeModal()">取消</button><button ${plan.actions.length ? "" : "disabled"} class="primary" onclick="executeSftpSyncPlan(${Number(connectionId)},'${escAttr(plan.id)}','${escAttr(tabKey)}')">${icon("play")}<span>执行所选项目</span></button></div></div>`;
  refreshIcons();
}

function toggleSftpSyncPlanSelection(checked) {
  document.querySelectorAll(".sftp-sync-plan-check:not(:disabled)").forEach(input => { input.checked = checked; });
}

function setSftpSyncConflictDirection(index, direction) {
  const input = document.querySelector(`.sftp-sync-plan-check[value="${Number(index)}"]`);
  if (!input) return;
  input.disabled = !direction;
  input.checked = Boolean(direction);
}

async function executeSftpSyncPlan(connectionId, planId, tabKey=activeTabKey) {
  const selected = [...document.querySelectorAll(".sftp-sync-plan-check:checked")].map(input => Number(input.value));
  if (!selected.length) return notify("请选择至少一个同步项目", "info");
  const overrides = {};
  document.querySelectorAll(".sftp-sync-conflict-direction").forEach(select => {
    if (select.value) overrides[Number(select.dataset.index)] = select.value;
  });
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/execute`, {method:"POST", body:JSON.stringify({plan_id:planId, selected_indexes:selected, overrides})});
    closeModal();
    notify(`目录同步已开始，共 ${job.total || selected.length} 项`, "success");
    if (typeof refreshSftpJobs === "function") await refreshSftpJobs();
    if (typeof openSftpTaskList === "function") openSftpTaskList();
    productivityState.syncRefreshTabKey = tabKey;
  } catch (error) {
    notify(error.message || "目录同步启动失败", "error");
  }
}

function productivityConnectionLabel(connection) {
  return `${connection.name}  ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
}

function quoteExternalCommandArg(value) {
  const text = String(value || "");
  return /[\s"']/u.test(text) ? `"${text.replace(/(["\\])/g, "\\$1")}"` : text;
}

function externalConnectionCommand(connection, kind="ssh") {
  const jump = connection.jump_connection_id ? currentConnection(Number(connection.jump_connection_id)) : null;
  const args = [];
  if (kind === "ssh") args.push("ssh", "-p", String(connection.ssh_port || 22));
  else args.push("sftp", "-P", String(connection.ssh_port || 22));
  if (connection.identity_file) args.push("-i", quoteExternalCommandArg(connection.identity_file));
  if (jump) args.push("-J", `${jump.ssh_user}@${jump.ssh_host}:${jump.ssh_port || 22}`);
  args.push(`${connection.ssh_user}@${connection.ssh_host}`);
  return args.join(" ");
}

async function copyExternalConnectionCommand(id, kind="ssh") {
  const connection = currentConnection(Number(id));
  if (!connection) return;
  await navigator.clipboard.writeText(externalConnectionCommand(connection, kind));
  notify(`已复制 ${kind === "sftp" ? "SFTP" : "SSH"} 命令（不含密码和私钥口令）`, "success");
}

async function openConnectionInVsCode(id, remotePath="") {
  await api(`/api/connections/${Number(id)}/external-tools/vscode`, {method:"POST", body:JSON.stringify({path:remotePath})});
  notify("已交给 VS Code Remote SSH 打开", "success");
}

function productivitySearchText(...values) {
  return values.flat().map(value => String(value ?? "").toLowerCase()).join(" ");
}

function quickPanelCommands() {
  ensureTunnelDeskActions();
  return listAppActions({surface:"quick-panel"}).filter(action => action.quick !== false).map(action => ({...action, kind:"command", run:()=>runAppAction(action.id, {surface:"quick-panel"})}));
}

function ensureTunnelDeskActions() {
  if (appAction("snippets.manage")) return;
  registerAppAction({id:"snippets.manage", icon:"library", title:"管理命令片段", detail:"命令片段", search:"snippet command 命令 片段", run:openCommandSnippetManager});
  registerAppAction({id:"workspaces.manage", icon:"panels-top-left", title:"管理命名工作区", detail:"工作区", search:"workspace save restore 工作区", run:openNamedWorkspaceManager});
  registerAppAction({id:"workspaces.save", icon:"save", title:"保存当前工作区为预设", detail:"工作区", search:"workspace save preset 保存 工作区 预设", run:saveCurrentNamedWorkspace});
  registerAppAction({id:"terminal.broadcast", icon:"radio", title:"开始终端广播", detail:"终端", search:"broadcast multiexec 广播 多终端", run:openTerminalBroadcastPicker});
  registerAppAction({id:"tabs.restore", icon:"undo-2", title:"恢复最近关闭的标签", detail:"标签", search:"restore closed tab 恢复 关闭 标签", run:restoreRecentlyClosedTab});
  registerAppAction({id:"ssh.key-wizard", icon:"key-round", title:"SSH 密钥向导", detail:"安全", search:"ssh key generate deploy 密钥 生成 部署", run:openSshKeyWizard});
  registerAppAction({id:"ssh.config-import", icon:"file-input", title:"检测 SSH config", detail:"导入", search:"ssh config import detect 导入 检测", run:openSshConfigImport});
  registerAppAction({id:"sftp.external-edits", icon:"file-pen-line", title:"管理外部编辑会话", detail:"SFTP", search:"external editor sftp 外部 编辑", visible:()=>Boolean(window.tunnelDeskDesktop), run:openSftpExternalEditManager});
  registerAppAction({id:"connection.terminal", quick:false, run:context=>openTerminal(Number(context.connectionId))});
  registerAppAction({id:"connection.sftp", quick:false, run:context=>openSftp(Number(context.connectionId), context.path || ".")});
  registerAppAction({id:"connection.forwards", quick:false, run:context=>openForwards(Number(context.connectionId))});
}

function quickPanelItems(query="") {
  const needle = String(query || "").trim().toLowerCase();
  const matches = item => !needle || productivitySearchText(item.title, item.detail, item.search).includes(needle);
  const items = [];
  if (typeof listWorkspaceGroups === "function") {
    for (const group of listWorkspaceGroups()) {
      items.push({
        kind:"workspace-group",
        icon:"panels-top-left",
        title:group.name,
        detail:`工作区组 · ${group.tabCount} 个标签${group.active ? " · 当前" : ""}`,
        search:"workspace group switch 工作区 组 切换",
        run:()=>switchWorkspaceGroup(group.id)
      });
    }
  }
  for (const tab of tabs) {
    items.push({
      kind:"tab",
      icon:tab.kind === "terminal" ? "square-terminal" : tab.kind === "sftp" ? "folder-open" : "panel-top",
      title:tab.title,
      detail:"切换标签",
      search:productivitySearchText(tab.subtitle, tab.kind),
      run:()=>activateTab(tab.key)
    });
  }
  for (const connection of [...connections].sort((left, right) =>
    Number(right.favorite || 0) - Number(left.favorite || 0)
    || Number(right.last_used_at || 0) - Number(left.last_used_at || 0)
    || Number(left.sort_order || 0) - Number(right.sort_order || 0)
  )) {
    items.push({
      kind:"connection",
      icon:connection.favorite ? "star" : "server",
      title:connection.name,
      detail:`${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`,
      search:productivitySearchText(connection.group_name, connection.tags),
      connection,
      run:()=>runAppAction("connection.terminal", {connectionId:connection.id})
    });
  }
  for (const profile of [...remoteProfiles].sort((left, right) =>
    Number(right.favorite || 0) - Number(left.favorite || 0)
    || Number(right.last_used_at || 0) - Number(left.last_used_at || 0)
    || String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN")
  )) {
    const meta = REMOTE_PROTOCOL_META[profile.protocol] || {label:profile.protocol,icon:"plug"};
    items.push({
      kind:"remote-profile",
      icon:profile.favorite ? "star" : meta.icon,
      title:profile.name,
      detail:`${meta.label} · ${remoteProfileEndpoint(profile)}`,
      search:productivitySearchText(profile.group_name, profile.tags, profile.protocol),
      remoteProfile:profile,
      run:()=>["rdp","vnc","xdmcp"].includes(profile.protocol) ? openRemoteDesktop(profile.id) : profile.protocol === "ftp" ? openFtpProfile(profile.id) : openRemoteTerminal(profile.id)
    });
  }
  for (const snippet of productivityState.snippets) {
    items.push({
      kind:"snippet",
      icon:"command",
      title:snippet.name,
      detail:snippet.group_name || "命令片段",
      search:productivitySearchText(snippet.tags, snippet.description, snippet.command),
      snippet,
      run:()=>openSnippetExecution(snippet)
    });
  }
  for (const workspace of productivityState.workspaces) {
    items.push({
      kind:"workspace",
      icon:"panels-top-left",
      title:workspace.name,
      detail:`命名工作区 · ${namedWorkspaceSavedTabs(workspace.layout || {}).length} 个标签`,
      search:productivitySearchText(workspace.description, "workspace 工作区"),
      workspace,
      run:()=>previewNamedWorkspace(workspace.id)
    });
  }
  items.push(...quickPanelCommands());
  return items.filter(matches).slice(0, 120);
}

function ensureQuickPanel() {
  let panel = document.getElementById("quickPanel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "quickPanel";
  panel.className = "quick-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="quick-panel-dialog" role="dialog" aria-modal="true" aria-label="快速打开">
    <div class="quick-panel-search">${icon("search")}<input id="quickPanelInput" autocomplete="off" spellcheck="false" placeholder="搜索连接、标签、工作区、命令片段或功能"></div>
    <div id="quickPanelResults" class="quick-panel-results" role="listbox"></div>
  </div>`;
  document.body.appendChild(panel);
  const input = panel.querySelector("#quickPanelInput");
  input.addEventListener("input", () => renderQuickPanel(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      productivityState.quickIndex = Math.max(0, Math.min(productivityState.quickItems.length - 1, productivityState.quickIndex + step));
      renderQuickPanel(input.value, false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runQuickPanelItem(productivityState.quickIndex);
    } else if (event.key === "Escape") closeQuickPanel();
  });
  panel.addEventListener("pointerdown", event => {
    if (event.target === panel) closeQuickPanel();
  });
  return panel;
}

async function openQuickPanel() {
  const panel = ensureQuickPanel();
  panel.hidden = false;
  const input = panel.querySelector("#quickPanelInput");
  input.value = "";
  productivityState.quickIndex = 0;
  await Promise.all([loadCommandSnippets(), loadNamedWorkspaces()]);
  renderQuickPanel();
  input.focus();
}

function closeQuickPanel() {
  const panel = document.getElementById("quickPanel");
  if (panel) panel.hidden = true;
}

function renderQuickPanel(query="", reset=true) {
  const panel = ensureQuickPanel();
  productivityState.quickItems = quickPanelItems(query);
  if (reset) productivityState.quickIndex = 0;
  productivityState.quickIndex = Math.min(productivityState.quickIndex, Math.max(0, productivityState.quickItems.length - 1));
  const results = panel.querySelector("#quickPanelResults");
  results.innerHTML = productivityState.quickItems.length ? productivityState.quickItems.map((item, index) => {
    const actions = item.connection ? `<span class="quick-result-actions">
      <button title="打开终端" aria-label="打开终端" onclick="event.stopPropagation();closeQuickPanel();runAppAction('connection.terminal',{connectionId:${item.connection.id}})">${icon("square-terminal")}</button>
      <button title="打开 SFTP" aria-label="打开 SFTP" onclick="event.stopPropagation();closeQuickPanel();runAppAction('connection.sftp',{connectionId:${item.connection.id}})">${icon("folder-open")}</button>
      <button title="管理转发" aria-label="管理转发" onclick="event.stopPropagation();closeQuickPanel();runAppAction('connection.forwards',{connectionId:${item.connection.id}})">${icon("route")}</button>
    </span>` : item.remoteProfile ? `<span class="quick-result-actions"><button title="${escAttr(REMOTE_PROTOCOL_META[item.remoteProfile.protocol]?.action || "打开")}" aria-label="${escAttr(REMOTE_PROTOCOL_META[item.remoteProfile.protocol]?.action || "打开")}" onclick="event.stopPropagation();runQuickPanelItem(${index})">${icon(REMOTE_PROTOCOL_META[item.remoteProfile.protocol]?.icon || "plug")}</button><button title="编辑连接" aria-label="编辑连接" onclick="event.stopPropagation();closeQuickPanel();editRemoteProfile(${item.remoteProfile.id})">${icon("pencil")}</button></span>` : "";
    return `<div class="quick-result${index === productivityState.quickIndex ? " active" : ""}" role="option" aria-selected="${index === productivityState.quickIndex}" data-index="${index}" onclick="runQuickPanelItem(${index})" onpointermove="productivityState.quickIndex=${index}">
      <span class="quick-result-icon">${icon(item.icon)}</span><span class="quick-result-copy"><strong>${esc(item.title)}</strong><small>${esc(item.detail || "")}</small></span>${actions}
    </div>`;
  }).join("") : stateView("empty", "没有匹配结果", "换一个关键词试试。");
  results.querySelector(".quick-result.active")?.scrollIntoView({block:"nearest"});
  refreshIcons();
}

function runQuickPanelItem(index) {
  const item = productivityState.quickItems[Number(index)];
  if (!item) return;
  closeQuickPanel();
  Promise.resolve(item.run()).catch(error => notify(error.message, "error"));
}

async function loadCommandSnippets() {
  productivityState.snippets = await api("/api/command-snippets").catch(() => productivityState.snippets);
  return productivityState.snippets;
}

async function openCommandSnippetManager() {
  await loadCommandSnippets();
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide productivity-manager" role="dialog" aria-modal="true">
    <div class="productivity-manager-head"><div><h2>命令片段</h2><span>${productivityState.snippets.length} 条</span></div><div class="actions tight"><button onclick="importCommandSnippetsFile()">${icon("upload")}<span>导入</span></button><button onclick="exportCommandSnippets()">${icon("download")}<span>导出</span></button><button class="primary" onclick="openCommandSnippetEditor()">${icon("plus")}<span>新建片段</span></button></div></div>
    <div class="productivity-list">${productivityState.snippets.length ? productivityState.snippets.map(item => `<div class="productivity-row">
      <button class="productivity-favorite${item.favorite ? " active" : ""}" title="${item.favorite ? "取消收藏" : "收藏"}" onclick="toggleCommandSnippetFavorite(${item.id})">${icon("star")}</button>
      <div><strong>${esc(item.name)}</strong><small>${esc(item.group_name || "默认分组")}${item.tags ? ` · ${esc(item.tags)}` : ""}</small><code>${esc(item.command)}</code></div>
      <div class="actions tight"><button onclick="closeModal();openSnippetExecutionById(${item.id})">${icon("play")}<span>使用</span></button><button title="编辑" aria-label="编辑" onclick="openCommandSnippetEditor(${item.id})">${icon("pencil")}</button><button class="danger" title="删除" aria-label="删除" onclick="deleteCommandSnippetUi(${item.id})">${icon("trash-2")}</button></div>
    </div>`).join("") : stateView("empty", "暂无命令片段", "保存常用命令后可从快速面板直接使用。")}</div>
    <div class="actions"><button onclick="closeModal()">关闭</button></div>
  </div>`;
  refreshIcons();
}

function exportCommandSnippets() {
  const payload = {format:"tunneldesk-command-snippets", version:1, exported_at:new Date().toISOString(), snippets:productivityState.snippets.map(({id, created_at, updated_at, last_used_at, ...item}) => item)};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "tunneldesk-command-snippets.json";
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
      if (!Array.isArray(items)) throw new Error("不是有效的 TunnelDesk 命令片段文件");
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

function openCommandSnippetEditor(id=0) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id)) || {};
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true"><h2>${id ? "编辑" : "新建"}命令片段</h2>
    <div class="grid"><div><label>名称</label><input id="snippetName" maxlength="120" value="${escAttr(item.name || "")}"></div><div><label>分组</label><input id="snippetGroup" maxlength="120" value="${escAttr(item.group_name || "默认分组")}"></div></div>
    <label>命令或脚本</label><textarea id="snippetCommand" class="snippet-command" spellcheck="false">${esc(item.command || "")}</textarea>
    <div class="grid"><div><label>标签</label><input id="snippetTags" value="${escAttr(item.tags || "")}"></div><div><label>说明</label><input id="snippetDescription" value="${escAttr(item.description || "")}"></div></div>
    <label class="checkline"><input id="snippetFavorite" type="checkbox" ${item.favorite ? "checked" : ""}>收藏</label>
    <div class="actions"><button class="primary" onclick="saveCommandSnippetUi(${Number(id)})">保存</button><button onclick="openCommandSnippetManager()">返回</button></div>
  </div>`;
  setTimeout(() => $("snippetName")?.focus(), 0);
}

async function saveCommandSnippetUi(id=0) {
  const payload = {
    name:$("snippetName").value.trim(),
    group_name:$("snippetGroup").value.trim(),
    command:$("snippetCommand").value,
    tags:$("snippetTags").value.trim(),
    description:$("snippetDescription").value.trim(),
    favorite:$("snippetFavorite").checked ? 1 : 0
  };
  await api(id ? `/api/command-snippets/${id}` : "/api/command-snippets", {method:id ? "PUT" : "POST", body:JSON.stringify(payload)});
  await openCommandSnippetManager();
  notify("命令片段已保存", "success");
}

async function toggleCommandSnippetFavorite(id) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id));
  if (!item) return;
  await api(`/api/command-snippets/${id}`, {method:"PUT", body:JSON.stringify({...item, favorite:item.favorite ? 0 : 1})});
  await openCommandSnippetManager();
}

async function deleteCommandSnippetUi(id) {
  if (!await confirmModal("删除这个命令片段？", "删除命令片段", "删除", "取消", true)) return;
  await api(`/api/command-snippets/${id}`, {method:"DELETE"});
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

const SSH_WORKSPACE_TAB_KINDS = new Set(["terminal", "sftp", "forwards", "dashboard", "edit"]);
const REMOTE_WORKSPACE_TAB_KINDS = new Set(["remote-edit", "remote-desktop", "remote-terminal", "ftp"]);

function namedWorkspaceTabExists(tab) {
  if (SSH_WORKSPACE_TAB_KINDS.has(tab?.kind)) return Boolean(currentConnection(Number(tab.id)));
  if (REMOTE_WORKSPACE_TAB_KINDS.has(tab?.kind)) return Boolean(remoteProfileById(Number(tab.id)));
  if (tab?.kind === "local-files") return typeof localFilesAvailable === "function" && localFilesAvailable();
  return ["settings", "import", "command", "log"].includes(tab?.kind);
}

function captureNamedWorkspaceLayout() {
  const allWorkspaceTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  if (typeof rememberSftpViewState === "function") {
    for (const tab of allWorkspaceTabs.filter(item => item.kind === "sftp")) {
      try { rememberSftpViewState(tab.key); } catch {}
    }
  }
  const persistTab = tab => {
    const state = sftpViewStates.get(tab.key);
    return tab.kind === "sftp" && state?.path ? {...tab, path:state.path} : tab;
  };
  const savedGroups = typeof serializeWorkspaceGroupsForPreset === "function"
    ? serializeWorkspaceGroupsForPreset().map(group => ({...group, tabs:(group.tabs || []).map(persistTab).filter(tab => tab.kind !== "remote-edit" || Number(tab.id) > 0)}))
    : [];
  const activeSavedGroup = savedGroups.find(group => group.id === activeWorkspaceGroupId) || savedGroups[0];
  const savedTabs = activeSavedGroup?.tabs || persistableTabs().map(persistTab).filter(tab => tab.kind !== "remote-edit" || Number(tab.id) > 0);
  const allSavedTabs = savedGroups.length ? savedGroups.flatMap(group => group.tabs || []) : savedTabs;
  const usedConnectionIds = [...new Set(allSavedTabs.filter(tab => ["terminal", "sftp", "forwards"].includes(tab.kind)).map(tab => Number(tab.id)).filter(Boolean))];
  const usedRemoteProfileIds = [...new Set(allSavedTabs.filter(tab => REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind)).map(tab => Number(tab.id)).filter(Boolean))];
  const runningForwardIds = connections.flatMap(connection => (connection.forwards || []).filter(forward => forward.status === "running").map(forward => forward.id));
  return {
    version:1,
    tabs:savedTabs,
    layout:typeof serializeWorkspaceLayout === "function" ? serializeWorkspaceLayout() : null,
    activeTabKey,
    focusedPaneId:typeof focusedPaneId === "string" ? focusedPaneId : "",
    workspace_groups_version:savedGroups.length ? 1 : 0,
    workspace_groups:savedGroups,
    active_workspace_group_id:typeof activeWorkspaceGroupId === "string" ? activeWorkspaceGroupId : "workspace-main",
    running_forward_ids:runningForwardIds,
    connection_refs:usedConnectionIds.map(id => {
      const connection = currentConnection(id);
      return connection ? {id, name:connection.name, host:connection.ssh_host, port:connection.ssh_port, user:connection.ssh_user} : {id};
    }),
    remote_profile_refs:usedRemoteProfileIds.map(id => {
      const profile = remoteProfileById(id);
      return profile ? {id, name:profile.name, protocol:profile.protocol, host:profile.host, port:profile.port, path:profile.options?.path || ""} : {id};
    }),
    forward_refs:connections.flatMap(connection => (connection.forwards || []).filter(forward => runningForwardIds.includes(forward.id)).map(forward => ({
      id:forward.id,
      connection_id:connection.id,
      mode:forward.mode,
      bind_host:forward.bind_host,
      bind_port:forward.bind_port,
      target_host:forward.target_host,
      target_port:forward.target_port
    })))
  };
}

async function loadNamedWorkspaces() {
  productivityState.workspaces = await api("/api/named-workspaces").catch(() => productivityState.workspaces);
  return productivityState.workspaces;
}

async function saveCurrentNamedWorkspace() {
  const currentWorkspaceTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  if (!currentWorkspaceTabs.some(tab => tab.kind)) return notify("当前没有可保存的工作区标签", "info");
  const suggestedName = typeof workspaceGroupName === "function" ? workspaceGroupName() : "";
  const name = await inputModal("保存工作区预设", "预设名称", suggestedName === "主工作区" ? "" : suggestedName);
  if (!name) return;
  await api("/api/named-workspaces", {method:"POST", body:JSON.stringify({name, layout:captureNamedWorkspaceLayout()})});
  await loadNamedWorkspaces();
  notify(`工作区“${name}”已保存`, "success");
}

function namedWorkspaceSavedTabs(layout={}) {
  const groups = Array.isArray(layout.workspace_groups) ? layout.workspace_groups : [];
  if (groups.length) return groups.flatMap(group => Array.isArray(group.tabs) ? group.tabs : []);
  return Array.isArray(layout.tabs) ? layout.tabs : [];
}

function eachNamedWorkspaceTab(layout, callback) {
  const groups = Array.isArray(layout.workspace_groups) ? layout.workspace_groups : [];
  if (groups.length) {
    for (const group of groups) for (const tab of Array.isArray(group.tabs) ? group.tabs : []) callback(tab, group);
  }
  for (const tab of Array.isArray(layout.tabs) ? layout.tabs : []) callback(tab, null);
}

async function openNamedWorkspaceManager() {
  await loadNamedWorkspaces();
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide productivity-manager"><div class="productivity-manager-head"><div><h2>命名工作区</h2><span>${productivityState.workspaces.length} 个</span></div><div class="actions tight"><button onclick="importNamedWorkspaceFile()">${icon("upload")}<span>导入</span></button><button class="primary" onclick="closeModal();saveCurrentNamedWorkspace()">${icon("save")}<span>保存当前</span></button></div></div>
    <div class="productivity-list">${productivityState.workspaces.length ? productivityState.workspaces.map(item => `<div class="productivity-row"><span class="quick-result-icon">${icon("panels-top-left")}</span><div><strong>${esc(item.name)}</strong><small>${namedWorkspaceSavedTabs(item.layout || {}).length} 个标签${Array.isArray(item.layout?.workspace_groups) && item.layout.workspace_groups.length > 1 ? ` · ${item.layout.workspace_groups.length} 个工作区组` : ""}${item.description ? ` · ${esc(item.description)}` : ""}</small></div><div class="actions tight"><button class="primary" onclick="previewNamedWorkspace(${item.id})">打开</button><button title="导出" aria-label="导出" onclick="exportNamedWorkspace(${item.id})">${icon("download")}</button><button title="重命名" aria-label="重命名" onclick="renameNamedWorkspace(${item.id})">${icon("pencil")}</button><button title="复制" aria-label="复制" onclick="duplicateNamedWorkspaceUi(${item.id})">${icon("copy")}</button><button class="danger" title="删除" aria-label="删除" onclick="deleteNamedWorkspaceUi(${item.id})">${icon("trash-2")}</button></div></div>`).join("") : stateView("empty", "暂无命名工作区", "保存当前标签和分屏后可一键恢复。")}</div><div class="actions"><button onclick="closeModal()">关闭</button></div></div>`;
  refreshIcons();
}

function previewNamedWorkspace(id) {
  const workspace = productivityState.workspaces.find(item => Number(item.id) === Number(id));
  if (!workspace) return;
  const layout = workspace.layout || {};
  const savedTabs = namedWorkspaceSavedTabs(layout);
  const previewConnections = [
    ...[...new Set(savedTabs.filter(tab => SSH_WORKSPACE_TAB_KINDS.has(tab.kind)).map(tab => Number(tab.id)).filter(Boolean))].map(connectionId => currentConnection(connectionId)?.name || `已删除 SSH #${connectionId}`),
    ...[...new Set(savedTabs.filter(tab => REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind)).map(tab => Number(tab.id)).filter(Boolean))].map(profileId => remoteProfileById(profileId)?.name || `已删除远程连接 #${profileId}`)
  ];
  const forwards = layout.running_forward_ids || [];
  const modal = $("modal");
  modal.hidden = false;
  const missing = savedTabs.filter(tab => (SSH_WORKSPACE_TAB_KINDS.has(tab.kind) || REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind)) && !namedWorkspaceTabExists(tab));
  modal.innerHTML = `<div class="modal-card"><h2>打开 ${esc(workspace.name)}</h2><div class="workspace-preview"><strong>${savedTabs.length} 个标签</strong><span>${esc(previewConnections.join("、") || "无连接标签")}</span><small>${Array.isArray(layout.workspace_groups) && layout.workspace_groups.length > 1 ? `${layout.workspace_groups.length} 个工作区组 · ` : ""}${forwards.length ? `将启动 ${forwards.length} 条转发` : "不启动转发"}</small>${missing.length ? `<small class="danger-text">${missing.length} 个连接引用缺失，需要先重新绑定</small>` : ""}</div><div class="actions">${missing.length ? `<button class="primary" onclick="repairNamedWorkspace(${workspace.id})">修复缺失连接</button>` : `<button class="primary" onclick="applyNamedWorkspace(${workspace.id})">确认打开</button>`}<button onclick="openNamedWorkspaceManager()">返回</button></div></div>`;
}

async function applyNamedWorkspace(id) {
  const workspace = await api(`/api/named-workspaces/${id}/use`, {method:"POST", body:"{}"});
  const saved = workspace.layout || {};
  const restored = namedWorkspaceSavedTabs(saved).filter(namedWorkspaceTabExists);
  if (!restored.length) return notify("这个工作区没有可恢复的标签，请先修复缺失连接", "error");
  closeModal();
  const currentTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  for (const tab of [...new Map(currentTabs.map(tab => [tab.key, tab])).values()]) {
    closeTerminalSession(tab.key);
    if (typeof closeRemoteProtocolSession === "function") closeRemoteProtocolSession(tab.key);
    if (typeof ftpProfileStates !== "undefined") ftpProfileStates.delete(tab.key);
    if (tab.kind === "sftp" && typeof closeSftpSession === "function") closeSftpSession(tab.key);
  }
  const groups = Array.isArray(saved.workspace_groups)
    ? saved.workspace_groups.map(group => ({...group, tabs:(group.tabs || []).filter(namedWorkspaceTabExists).map(tab => ({...tab}))}))
    : [];
  const restoredTarget = typeof applyWorkspaceGroupPreset === "function"
    ? applyWorkspaceGroupPreset({
      workspaceGroups:groups,
      activeWorkspaceGroupId:saved.active_workspace_group_id || saved.activeWorkspaceGroupId,
      tabs:restored,
      layout:saved.layout,
      activeTabKey:saved.activeTabKey,
      focusedPaneId:saved.focusedPaneId
    })
    : null;
  if (!restoredTarget) {
    tabs = restored.map(tab => ({...tab}));
    const validKeys = new Set(tabs.map(tab => tab.key));
    const usedKeys = new Set();
    workspaceLayout = restoreWorkspaceLayoutNode(saved.layout, validKeys, usedKeys, new Set(), new Set())
      || {type:"pane", id:"pane-1", tabs:tabs.map(tab => tab.key), activeTabKey:tabs[0].key};
    const firstPane = workspaceLeaves()[0];
    for (const tab of tabs) if (!usedKeys.has(tab.key)) firstPane.tabs.push(tab.key);
    focusedPaneId = workspaceFindPane(saved.focusedPaneId)?.id || workspaceFindPaneForTab(saved.activeTabKey)?.id || firstPane.id;
    const focused = workspaceFindPane(focusedPaneId);
    if (focused.tabs.includes(saved.activeTabKey)) focused.activeTabKey = saved.activeTabKey;
    activeTabKey = focused.activeTabKey || focused.tabs[0];
    renderTabs();
    for (const pane of workspaceVisiblePanes().filter(item => item.id !== focusedPaneId)) renderWorkspacePaneContent(pane.id);
    renderWorkspacePaneContent(focusedPaneId);
    saveTabsState();
  }
  const forwardIds = saved.running_forward_ids || [];
  const results = await Promise.allSettled(forwardIds.map(forwardId => api(`/api/forwards/${forwardId}/start`, {method:"POST", body:"{}"})));
  const failedIds = forwardIds.filter((forwardId, index) => results[index]?.status === "rejected");
  const failed = failedIds.length;
  await loadAll({silent:true});
  if (failed) return showWorkspaceForwardFailures(workspace.name, failedIds);
  notify(`工作区“${workspace.name}”已打开`, "success");
}

function showWorkspaceForwardFailures(name, forwardIds) {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card"><h2>工作区已部分打开</h2><p>${esc(name)} 的标签已恢复，但 ${forwardIds.length} 条转发启动失败。</p><div class="actions"><button onclick="closeModal()">保留当前结果</button><button class="primary" onclick='retryWorkspaceForwards(${JSON.stringify(forwardIds)})'>重试失败转发</button></div></div>`;
}

async function retryWorkspaceForwards(forwardIds) {
  const results = await Promise.allSettled((forwardIds || []).map(id => api(`/api/forwards/${id}/start`, {method:"POST", body:"{}"})));
  const failed = results.filter(item => item.status === "rejected").length;
  await loadAll({silent:true});
  closeModal();
  notify(failed ? `仍有 ${failed} 条转发启动失败` : "失败的转发已全部启动", failed ? "error" : "success");
}

function exportNamedWorkspace(id) {
  const workspace = productivityState.workspaces.find(item => Number(item.id) === Number(id));
  if (!workspace) return;
  const payload = {format:"tunneldesk-named-workspace", version:1, exported_at:new Date().toISOString(), workspace:{name:workspace.name, description:workspace.description || "", layout:workspace.layout}};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${String(workspace.name || "workspace").replace(/[\\/:*?"<>|]+/g, "-")}.tunneldesk-workspace.json`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

function importNamedWorkspaceFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.tunneldesk-workspace.json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { await importNamedWorkspaceData(JSON.parse(await file.text())); }
    catch (error) { notify(error.message || "工作区文件导入失败", "error"); }
  };
  input.click();
}

function matchImportedConnection(reference) {
  return connections.find(item => reference.host && item.ssh_host === reference.host && Number(item.ssh_port || 22) === Number(reference.port || 22) && item.ssh_user === reference.user)
    || connections.find(item => reference.name && item.name === reference.name)
    || null;
}

function matchImportedRemoteProfile(reference) {
  return remoteProfiles.find(item => reference.protocol && item.protocol === reference.protocol && reference.host && item.host === reference.host && Number(item.port || 0) === Number(reference.port || 0))
    || remoteProfiles.find(item => reference.protocol && item.protocol === reference.protocol && reference.path && item.options?.path === reference.path)
    || remoteProfiles.find(item => reference.name && item.name === reference.name && (!reference.protocol || item.protocol === reference.protocol))
    || null;
}

async function importNamedWorkspaceData(payload) {
  const source = payload?.workspace || payload;
  if (!source?.layout || !namedWorkspaceSavedTabs(source.layout).length) throw new Error("不是有效的 TunnelDesk 命名工作区文件");
  const layout = JSON.parse(JSON.stringify(source.layout));
  const idMap = new Map();
  for (const reference of layout.connection_refs || []) {
    const matched = matchImportedConnection(reference);
    if (matched) idMap.set(Number(reference.id), Number(matched.id));
  }
  const remoteIdMap = new Map();
  for (const reference of layout.remote_profile_refs || []) {
    const matched = matchImportedRemoteProfile(reference);
    if (matched) remoteIdMap.set(Number(reference.id), Number(matched.id));
  }
  eachNamedWorkspaceTab(layout, tab => {
    if (SSH_WORKSPACE_TAB_KINDS.has(tab.kind) && idMap.has(Number(tab.id))) tab.id = idMap.get(Number(tab.id));
    if (REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind) && remoteIdMap.has(Number(tab.id))) tab.id = remoteIdMap.get(Number(tab.id));
  });
  const forwardMap = new Map();
  for (const reference of layout.forward_refs || []) {
    const connectionId = idMap.get(Number(reference.connection_id)) || Number(reference.connection_id);
    const connection = currentConnection(connectionId);
    const matched = (connection?.forwards || []).find(forward => forward.mode === reference.mode && forward.bind_host === reference.bind_host && Number(forward.bind_port) === Number(reference.bind_port) && forward.target_host === reference.target_host && Number(forward.target_port) === Number(reference.target_port));
    if (matched) forwardMap.set(Number(reference.id), Number(matched.id));
  }
  layout.running_forward_ids = (layout.running_forward_ids || []).map(id => forwardMap.get(Number(id))).filter(Boolean);
  layout.connection_refs = (layout.connection_refs || []).map(reference => ({...reference, id:idMap.get(Number(reference.id)) || Number(reference.id)}));
  layout.remote_profile_refs = (layout.remote_profile_refs || []).map(reference => ({...reference, id:remoteIdMap.get(Number(reference.id)) || Number(reference.id)}));
  let name = String(source.name || "导入的工作区").trim();
  const names = new Set(productivityState.workspaces.map(item => String(item.name).toLowerCase()));
  if (names.has(name.toLowerCase())) {
    const base = `${name}（导入）`;
    name = base;
    let index = 2;
    while (names.has(name.toLowerCase())) {
      name = `${base}${index}`;
      index += 1;
    }
  }
  await api("/api/named-workspaces", {method:"POST", body:JSON.stringify({name, description:source.description || "", layout})});
  await loadNamedWorkspaces();
  notify(`工作区“${name}”已导入`, "success");
  await openNamedWorkspaceManager();
}

function repairNamedWorkspace(id) {
  const workspace = productivityState.workspaces.find(item => Number(item.id) === Number(id));
  if (!workspace) return;
  const savedTabs = namedWorkspaceSavedTabs(workspace.layout || {});
  const missingSsh = [...new Set(savedTabs.filter(tab => SSH_WORKSPACE_TAB_KINDS.has(tab.kind)).map(tab => Number(tab.id)).filter(connectionId => connectionId && !currentConnection(connectionId)))];
  const missingRemote = [...new Set(savedTabs.filter(tab => REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind)).map(tab => Number(tab.id)).filter(profileId => profileId && !remoteProfileById(profileId)))];
  const refs = new Map((workspace.layout?.connection_refs || []).map(item => [Number(item.id), item]));
  const remoteRefs = new Map((workspace.layout?.remote_profile_refs || []).map(item => [Number(item.id), item]));
  const modal = $("modal");
  const sshRows = missingSsh.map(oldId => { const reference = refs.get(oldId) || {id:oldId}; return `<label><span>${esc(reference.name || `SSH #${oldId}`)}<small>${esc([reference.user, reference.host].filter(Boolean).join("@"))}</small></span><select data-workspace-missing-kind="ssh" data-workspace-missing-id="${oldId}"><option value="">选择现有 SSH</option>${connections.map(connection => `<option value="${connection.id}" ${matchImportedConnection(reference)?.id === connection.id ? "selected" : ""}>${esc(connection.name)} · ${esc(connection.ssh_user)}@${esc(connection.ssh_host)}</option>`).join("")}</select></label>`; }).join("");
  const remoteRows = missingRemote.map(oldId => { const reference = remoteRefs.get(oldId) || {id:oldId}; return `<label><span>${esc(reference.name || `远程连接 #${oldId}`)}<small>${esc(reference.protocol || "远程协议")}</small></span><select data-workspace-missing-kind="remote" data-workspace-missing-id="${oldId}"><option value="">选择同协议连接</option>${remoteProfiles.filter(profile => !reference.protocol || profile.protocol === reference.protocol).map(profile => `<option value="${profile.id}" ${matchImportedRemoteProfile(reference)?.id === profile.id ? "selected" : ""}>${esc(profile.name)} · ${esc(REMOTE_PROTOCOL_META[profile.protocol]?.label || profile.protocol)}</option>`).join("")}</select></label>`; }).join("");
  modal.innerHTML = `<div class="modal-card"><h2>修复缺失连接</h2><div class="workspace-repair-list">${sshRows}${remoteRows}</div><div class="actions"><button onclick="previewNamedWorkspace(${id})">返回</button><button class="primary" onclick="saveNamedWorkspaceRepair(${id})">保存绑定</button></div></div>`;
}

async function saveNamedWorkspaceRepair(id) {
  const workspace = productivityState.workspaces.find(item => Number(item.id) === Number(id));
  if (!workspace) return;
  const mapping = new Map([...document.querySelectorAll("[data-workspace-missing-id]")].map(select => [`${select.dataset.workspaceMissingKind}:${Number(select.dataset.workspaceMissingId)}`, Number(select.value)]));
  if ([...mapping.values()].some(value => !value)) return notify("请为每个缺失项选择一个现有连接", "info");
  const layout = JSON.parse(JSON.stringify(workspace.layout || {}));
  eachNamedWorkspaceTab(layout, tab => {
    const kind = REMOTE_WORKSPACE_TAB_KINDS.has(tab.kind) ? "remote" : SSH_WORKSPACE_TAB_KINDS.has(tab.kind) ? "ssh" : "";
    const key = `${kind}:${Number(tab.id)}`;
    if (kind && mapping.has(key)) tab.id = mapping.get(key);
  });
  layout.connection_refs = (layout.connection_refs || []).map(reference => mapping.has(`ssh:${Number(reference.id)}`) ? {...reference, id:mapping.get(`ssh:${Number(reference.id)}`)} : reference);
  layout.remote_profile_refs = (layout.remote_profile_refs || []).map(reference => mapping.has(`remote:${Number(reference.id)}`) ? {...reference, id:mapping.get(`remote:${Number(reference.id)}`)} : reference);
  await api(`/api/named-workspaces/${id}`, {method:"PUT", body:JSON.stringify({...workspace, layout})});
  await loadNamedWorkspaces();
  notify("缺失连接已重新绑定", "success");
  previewNamedWorkspace(id);
}

async function renameNamedWorkspace(id) {
  const item = productivityState.workspaces.find(row => Number(row.id) === Number(id));
  const name = await inputModal("重命名工作区", "工作区名称", item?.name || "");
  if (!name || !item) return;
  await api(`/api/named-workspaces/${id}`, {method:"PUT", body:JSON.stringify({...item, name})});
  await openNamedWorkspaceManager();
}

async function duplicateNamedWorkspaceUi(id) {
  await api(`/api/named-workspaces/${id}/duplicate`, {method:"POST", body:"{}"});
  await openNamedWorkspaceManager();
}

async function deleteNamedWorkspaceUi(id) {
  if (!await confirmModal("删除这个命名工作区？连接配置不会被删除。", "删除工作区", "删除", "取消", true)) return;
  await api(`/api/named-workspaces/${id}`, {method:"DELETE"});
  await openNamedWorkspaceManager();
}

function openSshKeyWizard() {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide ssh-key-wizard"><h2>SSH 密钥向导</h2>
    <div class="grid"><div><label>密钥名称</label><input id="sshKeyName" value="id_ed25519_tunneldesk" maxlength="80"></div><div><label>备注</label><input id="sshKeyComment" value="TunnelDesk" maxlength="120"></div></div>
    <label>私钥口令（可选）</label><input id="sshKeyPassphrase" type="password" autocomplete="new-password">
    <div class="actions"><button class="primary" onclick="generateSshKeyUi()">${icon("key-round")}<span>生成 Ed25519 密钥</span></button><button onclick="closeModal()">取消</button></div>
  </div>`;
  refreshIcons();
}

async function generateSshKeyUi() {
  const result = await api("/api/ssh/keys/generate", {method:"POST", body:JSON.stringify({
    name:$("sshKeyName").value.trim(),
    comment:$("sshKeyComment").value.trim(),
    passphrase:$("sshKeyPassphrase").value
  })});
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card wide ssh-key-wizard"><h2>密钥已生成</h2>
    <div class="key-result-path"><strong>私钥位置</strong><code>${esc(result.private_path)}</code><small>${result.has_passphrase ? "私钥已使用口令保护" : "私钥未设置口令"}</small></div>
    <label>公钥</label><textarea id="generatedPublicKey" readonly>${esc(result.public_key)}</textarea>
    <label>部署到服务器</label><select id="generatedKeyConnection"><option value="">选择 SSH 连接</option>${connections.map(connection => `<option value="${connection.id}">${esc(productivityConnectionLabel(connection))}</option>`).join("")}</select>
    <div class="actions"><button onclick="copyGeneratedPublicKey()">${icon("copy")}<span>复制公钥</span></button><button onclick="downloadGeneratedPublicKey('${escAttr(result.public_path)}')">${icon("download")}<span>下载公钥</span></button><button class="primary" onclick="deployGeneratedPublicKeyUi('${escAttr(result.public_path)}')">${icon("upload")}<span>部署公钥</span></button><button onclick="closeModal();loadKeys()">完成</button></div>
  </div>`;
  refreshIcons();
}

async function copyGeneratedPublicKey() {
  await navigator.clipboard.writeText($("generatedPublicKey")?.value || "");
  notify("公钥已复制", "success");
}

function downloadGeneratedPublicKey(publicPath) {
  const content = $("generatedPublicKey")?.value || "";
  const blob = new Blob([`${content.trim()}\n`], {type:"text/plain;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = String(publicPath || "id_ed25519.pub").split(/[\\/]/).pop();
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function deployGeneratedPublicKeyUi(publicPath) {
  const connectionId = Number($("generatedKeyConnection")?.value || 0);
  const connection = currentConnection(connectionId);
  if (!connection) return notify("请选择目标 SSH 连接", "info");
  if (!await confirmModal(`将公钥追加到 ${connection.name}（${connection.ssh_user}@${connection.ssh_host}）的 authorized_keys。不会覆盖已有公钥。`, "部署 SSH 公钥", "确认部署", "取消")) return;
  await api(`/api/connections/${connectionId}/ssh-key/deploy`, {method:"POST", body:JSON.stringify({public_path:publicPath})});
  notify(`公钥已部署到 ${connection.name}`, "success");
}

async function openSshConfigImport() {
  const detected = await api("/api/ssh/config/detect");
  if (!detected.available || !detected.count) return notify("没有检测到可导入的 ~/.ssh/config 主机", "info");
  const conflictText = detected.conflicts?.length ? `\n同名连接：${detected.conflicts.join("、")}` : "";
  const accepted = await confirmModal(`检测到 ${detected.count} 个 SSH 主机。导入前会显示完整预览，不会自动覆盖现有连接。${conflictText}`, "导入 SSH config", "查看预览", "取消");
  if (!accepted) return;
  closeModal();
  showImport();
  showImportSection("import-source", {moveToWorkspace:false});
  if ($("config_text")) $("config_text").value = detected.text;
  await parseImportText();
}

async function detectSshConfigOnFirstUse() {
  if (localStorage.getItem("sshConfigDetectionSeenV1") === "1") return;
  localStorage.setItem("sshConfigDetectionSeenV1", "1");
  const detected = await api("/api/ssh/config/detect").catch(() => null);
  if (detected?.count) notify(`检测到 ${detected.count} 个 SSH config 主机，可从快速面板查看导入预览`, "info");
}

function loadClosedWorkspaceTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem("closedWorkspaceTabsV1") || "[]");
    productivityState.closedTabs = Array.isArray(saved) ? saved : [];
  } catch {
    productivityState.closedTabs = [];
  }
}

function rememberClosedWorkspaceTabs(keys) {
  const closing = keys.map(key => {
    const tab = tabs.find(item => item.key === key);
    if (!tab?.kind) return null;
    const state = sftpViewStates.get(key);
    return {...tab, path:tab.kind === "sftp" ? (state?.path || tab.path || ".") : tab.path, closed_at:Date.now()};
  }).filter(Boolean);
  if (!closing.length) return;
  productivityState.closedTabs = [...closing.reverse(), ...productivityState.closedTabs.filter(item => !closing.some(tab => tab.key === item.key))].slice(0, 30);
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
}

function restoreRecentlyClosedTab() {
  loadClosedWorkspaceTabs();
  const tab = productivityState.closedTabs.shift();
  if (!tab) return notify("没有可恢复的已关闭标签", "info");
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
  if (Number(tab.id) && !currentConnection(Number(tab.id))) return notify("原连接已删除，无法恢复这个标签", "error");
  let key = tab.key;
  if (tabs.some(item => item.key === key)) key = `${key}-restored-${Date.now()}`;
  addTab(key, tab.title, tab.subtitle, tab.viewName, tab.closable !== false, {...tab, key, pinned:false});
  renderTabContent(tabs.find(item => item.key === key));
  notify("已恢复最近关闭的标签", "success");
}

function openTerminalBroadcastPicker() {
  const terminalTabs = tabs.filter(tab => tab.kind === "terminal");
  if (terminalTabs.length < 2) return notify("至少打开两个终端后才能广播输入", "info");
  const selected = productivityState.broadcastTargets.size
    ? productivityState.broadcastTargets
    : new Set(terminalTabs.map(tab => tab.key));
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card"><h2>终端广播</h2><label>选择要同步输入的终端</label><div class="snippet-target-grid">${terminalTabs.map(tab => `<label class="checkline"><input name="broadcastTarget" type="checkbox" value="${escAttr(tab.key)}" ${selected.has(tab.key) ? "checked" : ""}>${esc(tab.title)}</label>`).join("")}</div><div class="actions"><button class="primary" onclick="startTerminalBroadcast()">开始同步</button><button onclick="closeModal()">取消</button></div></div>`;
}

function startTerminalBroadcast() {
  const targets = [...document.querySelectorAll("input[name='broadcastTarget']:checked")].map(input => input.value);
  if (targets.length < 2) return notify("请至少选择两个需要同步的终端", "info");
  productivityState.broadcastTargets = new Set(targets);
  closeModal();
  updateTerminalBroadcastBar();
  renderTabs();
  if (targets.includes(activeTabKey) && typeof focusTerminalSession === "function") focusTerminalSession(activeTabKey);
}

function stopTerminalBroadcast() {
  productivityState.broadcastTargets.clear();
  productivityState.broadcastPaused = false;
  updateTerminalBroadcastBar();
  renderTabsPreservingTerminalFocus();
}

function isTerminalBroadcastTarget(key) {
  return productivityState.broadcastTargets.has(String(key || ""));
}

function terminalBroadcastKeys() {
  const openTerminalKeys = new Set(tabs.filter(tab => tab.kind === "terminal").map(tab => tab.key));
  return [...productivityState.broadcastTargets].filter(key => openTerminalKeys.has(key));
}

function updateTerminalBroadcastBar(message="") {
  let bar = document.getElementById("terminalBroadcastBar");
  const keys = terminalBroadcastKeys();
  if (keys.length < 2) {
    productivityState.broadcastTargets.clear();
    bar?.remove();
    document.body.classList.remove("terminal-broadcast-active");
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "terminalBroadcastBar";
    bar.className = "terminal-broadcast-bar";
    const quickActions = document.getElementById("workspaceQuickActions");
    if (quickActions) quickActions.before(bar);
    else document.querySelector(".topbar")?.appendChild(bar);
  }
  productivityState.broadcastTargets = new Set(keys);
  bar.innerHTML = `${icon("radio")}<strong>终端同步</strong><span>${esc(message || `${keys.length} 个终端 · 可在任意选中终端输入`)}</span><button class="icon-button terminal-broadcast-exit" onclick="stopTerminalBroadcast()" title="退出终端同步" aria-label="退出终端同步">${icon("x")}</button>`;
  document.body.classList.add("terminal-broadcast-active");
  refreshIcons();
}

function sendBroadcastPayload(sourceKey, outgoing, raw="") {
  const keys = terminalBroadcastKeys();
  for (const key of keys) {
    const session = terminalSessions.get(key);
    if (key !== sourceKey && /[\r\n]/.test(raw) && typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
    if (session?.socket?.readyState === WebSocket.OPEN) session.socket.send(outgoing);
  }
}

function handleTerminalBroadcastInput(sourceKey, outgoing, raw) {
  const keys = terminalBroadcastKeys();
  if (!productivityState.broadcastTargets.has(sourceKey)) return false;
  if (keys.length < 2) {
    stopTerminalBroadcast();
    return false;
  }
  const sensitive = keys.some(key => terminalSessions.get(key)?.sensitiveInput);
  if (sensitive) {
    const source = terminalSessions.get(sourceKey);
    if (source?.socket?.readyState === WebSocket.OPEN) source.socket.send(outgoing);
    if (!productivityState.broadcastPaused) {
      productivityState.broadcastPaused = true;
      updateTerminalBroadcastBar("有终端正在等待隐藏输入，已暂停同步");
    }
    return true;
  }
  if (productivityState.broadcastPaused) {
    productivityState.broadcastPaused = false;
    updateTerminalBroadcastBar();
  }
  const value = String(raw || "");
  const needsConfirmation = value.length > 2 && (/[\r\n]/.test(value) || (typeof commandLooksDangerous === "function" && commandLooksDangerous(value)));
  if (needsConfirmation) {
    confirmModal(`即将向 ${keys.length} 个终端发送：\n\n${value}`, "确认广播输入", "发送", "取消", true)
      .then(accepted => {
        if (accepted) sendBroadcastPayload(sourceKey, outgoing, raw);
        if (typeof focusTerminalSession === "function") focusTerminalSession(sourceKey);
      });
  } else sendBroadcastPayload(sourceKey, outgoing, raw);
  return true;
}

function noteTerminalCommandStarted(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  session.smartCommandStartedAt = Date.now();
  session.smartHadOutput = false;
  clearTimeout(session.smartCompletionTimer);
}

function isWorkspaceTabCurrentlyVisible(key) {
  if (typeof workspaceVisiblePanes === "function") {
    return workspaceVisiblePanes().some(pane => pane.activeTabKey === key);
  }
  return activeTabKey === key;
}

function renderTabsPreservingTerminalFocus() {
  const focusedKey = activeView === "terminal" && document.activeElement?.closest?.(".xterm") ? activeTabKey : "";
  renderTabs();
  if (focusedKey && typeof focusTerminalSession === "function") focusTerminalSession(focusedKey);
}

function updateTerminalSmartState(key, chunk) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const text = typeof chunk === "string" ? chunk : "";
  session.smartOutputTail = `${session.smartOutputTail || ""}${text}`.slice(-500);
  session.sensitiveInput = /(?:password|passphrase|口令|密码)\s*[:：]?\s*$/i.test(session.smartOutputTail);
  if (text) session.smartHadOutput = true;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (tab && !isWorkspaceTabCurrentlyVisible(key) && tab.activityState !== "output") {
    tab.activityState = "output";
    renderTabsPreservingTerminalFocus();
  }
  const oscComplete = /\x1b\]133;D(?:;\d+)?(?:\x07|\x1b\\)/.test(text);
  if (oscComplete) return markTerminalCommandComplete(key, "shell");
  if (!session.smartCommandStartedAt || !session.smartHadOutput) return;
  clearTimeout(session.smartCompletionTimer);
  session.smartCompletionTimer = setTimeout(() => markTerminalCommandComplete(key, "idle"), 1400);
}

function markTerminalCommandComplete(key, source="idle") {
  const session = terminalSessions.get(key);
  if (!session?.smartCommandStartedAt) return;
  const elapsed = Date.now() - session.smartCommandStartedAt;
  session.smartCommandStartedAt = 0;
  clearTimeout(session.smartCompletionTimer);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab || isWorkspaceTabCurrentlyVisible(key)) return;
  tab.activityState = "complete";
  renderTabsPreservingTerminalFocus();
  const connection = currentConnection(session.id);
  if (elapsed >= 5000 && !connection?.notifications_muted && !tab.notificationsMuted) {
    const event = {title:"命令已完成", message:`${tab.title} · ${Math.max(1, Math.round(elapsed / 1000))} 秒`, action:{type:"tab", key}};
    notify(event.message, "success");
    if (typeof showDesktopNotification === "function") showDesktopNotification(event);
  }
}

function markWorkspaceTabViewed(key) {
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab?.activityState) return;
  tab.activityState = "";
}

async function toggleConnectionNotifications(id) {
  const connection = currentConnection(Number(id));
  if (!connection) return;
  const muted = connection.notifications_muted ? 0 : 1;
  await api(`/api/connections/${id}/flags`, {method:"POST", body:JSON.stringify({favorite:Number(connection.favorite || 0), notifications_muted:muted})});
  connection.notifications_muted = muted;
  notify(muted ? "已静音此连接的命令完成通知" : "已开启此连接的命令完成通知", "success");
}

function toggleTabNotifications(key) {
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab || tab.kind !== "terminal") return;
  tab.notificationsMuted = !tab.notificationsMuted;
  if (typeof hideTabContextMenu === "function") hideTabContextMenu();
  saveTabsState();
  renderTabs();
  notify(tab.notificationsMuted ? "已静音此终端标签的命令完成通知" : "已开启此终端标签的命令完成通知", "success");
}

function terminalSftpPath(key) {
  const session = terminalSessions.get(String(key || ""));
  const selected = String(session?.term?.getSelection?.() || "").trim();
  if (selected && !/\s/.test(selected) && /^(?:\/|\.{1,2}\/|~\/)/.test(selected)) return selected;
  return session?.currentDirectoryKnown ? session.currentDirectory : ".";
}

function openTerminalPathInSftp(connectionId, key) {
  const remotePath = terminalSftpPath(key);
  openSftp(Number(connectionId), remotePath, true);
}

function installProductivityHeaderButton() {
  const host = document.getElementById("workspaceQuickActions");
  if (!document.getElementById("quickPanelButton")) {
    const button = document.createElement("button");
    button.id = "quickPanelButton";
    button.className = "icon-button quick-panel-button";
    button.title = "快速打开（Ctrl+K）";
    button.setAttribute("aria-label", "快速打开");
    button.innerHTML = icon("zap");
    button.onclick = openQuickPanel;
    if (host) host.appendChild(button);
    else document.getElementById("sftpTaskCenter")?.before(button);
  }
  installXServerQuickAction(host);
}

let xServerQuickStatusTimer = 0;

function installXServerQuickAction(host = document.getElementById("workspaceQuickActions")) {
  if (!host || typeof openXServerManager !== "function") return;
  let button = document.getElementById("xServerQuickButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "xServerQuickButton";
    button.className = "icon-button xserver-quick-button";
    button.title = "X Server 状态";
    button.setAttribute("aria-label", "X Server 状态");
    button.onclick = () => openXServerManager();
    host.appendChild(button);
  }
  refreshXServerQuickAction();
  if (!xServerQuickStatusTimer) {
    xServerQuickStatusTimer = window.setInterval(() => {
      if (!document.hidden) refreshXServerQuickAction();
    }, 8000);
  }
}

async function refreshXServerQuickAction() {
  const button = document.getElementById("xServerQuickButton");
  if (!button) return;
  try {
    const diagnostics = await api("/api/xserver");
    const state = diagnostics?.available ? "ready" : diagnostics?.running ? "warning" : "error";
    const label = diagnostics?.available ? "X Server 已就绪" : diagnostics?.running ? "X Server 正在运行" : "X Server 未启动";
    button.className = `icon-button xserver-quick-button ${state}`;
    button.title = `${label}${diagnostics?.display ? ` · ${diagnostics.display}` : ""}`;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = icon(diagnostics?.available ? "server-cog" : diagnostics?.running ? "server" : "server-off");
    refreshIcons();
  } catch {
    button.className = "icon-button xserver-quick-button error";
    button.title = "X Server 状态不可用";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = icon("server-off");
    refreshIcons();
  }
}

function installProductivityKeyboard() {
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openQuickPanel();
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      restoreRecentlyClosedTab();
    } else if (event.key === "Escape" && productivityState.broadcastTargets.size >= 2) {
      stopTerminalBroadcast();
    }
  });
}

function installProductivityTabHooks() {
  const originalActivateTab = activateTab;
  activateTab = function(key) {
    markWorkspaceTabViewed(key);
    return originalActivateTab(key);
  };
  const originalCloseTabsByKey = closeTabsByKey;
  closeTabsByKey = function(keys, anchorKey="") {
    const result = originalCloseTabsByKey(keys, anchorKey);
    if (!productivityState.broadcastTargets.size) return result;
    const remaining = terminalBroadcastKeys();
    if (remaining.length < 2) stopTerminalBroadcast();
    else if (remaining.length !== productivityState.broadcastTargets.size) {
      productivityState.broadcastTargets = new Set(remaining);
      updateTerminalBroadcastBar();
    }
    return result;
  };
}

function initProductivityFeatures() {
  ensureTunnelDeskActions();
  loadClosedWorkspaceTabs();
  installProductivityHeaderButton();
  installProductivityKeyboard();
  installProductivityTabHooks();
  loadCommandSnippets();
  loadNamedWorkspaces();
  detectSshConfigOnFirstUse();
  refreshIcons();
}
