function productivitySearchText(...values) {
  return values.flat().map(value => String(value ?? "").toLowerCase()).join(" ");
}

function quickPanelCommands() {
  ensureTermaActions();
  return listAppActions({surface:"quick-panel"}).filter(action => action.quick !== false).map(action => ({...action, kind:"command", run:()=>runAppAction(action.id, {surface:"quick-panel"})}));
}

function ensureTermaActions() {
  if (appAction("snippets.manage")) return;
  registerAppAction({id:"snippets.manage", icon:"library", title:"管理命令片段", detail:"命令片段", search:"snippet command 命令 片段", run:openCommandSnippetManager});
  registerAppAction({id:"workspaces.manage", icon:"panels-top-left", title:"管理命名工作区", detail:"工作区", search:"workspace save restore 工作区", run:openNamedWorkspaceManager});
  registerAppAction({id:"workspaces.save", icon:"save", title:"保存当前工作区为预设", detail:"工作区", search:"workspace save preset 保存 工作区 预设", run:saveCurrentNamedWorkspace});
  registerAppAction({id:"terminal.broadcast", icon:"radio", title:"开始终端广播", detail:"终端", search:"broadcast multiexec 广播 多终端", run:openTerminalBroadcastPicker});
  registerAppAction({id:"tabs.restore", icon:"undo-2", title:"恢复最近关闭的标签", detail:"标签", search:"restore closed tab 恢复 关闭 标签", run:restoreRecentlyClosedTab});
  registerAppAction({id:"ssh.key-wizard", icon:"key-round", title:"SSH 密钥向导", detail:"安全", search:"ssh key generate deploy 密钥 生成 部署", run:openSshKeyWizard});
  registerAppAction({id:"ssh.config-import", icon:"file-input", title:"检测 SSH config", detail:"导入", search:"ssh config import detect 导入 检测", run:openSshConfigImport});
  registerAppAction({id:"sftp.external-edits", icon:"file-pen-line", title:"管理外部编辑会话", detail:"SFTP", search:"external editor sftp 外部 编辑", visible:()=>Boolean(window.termaDesktop), run:openSftpExternalEditManager});
  registerAppAction({id:"connection.terminal", quick:false, run:context=>openTerminal(Number(context.connectionId))});
  registerAppAction({id:"connection.sftp", quick:false, run:context=>openSftp(Number(context.connectionId), context.path || ".")});
  registerAppAction({id:"connection.forwards", quick:false, run:context=>openForwards(Number(context.connectionId))});
}

function quickPanelConnectionItem(connection) {
  return {
    kind:"connection",
    icon:connection.favorite ? "star" : "server",
    title:connection.name,
    detail:`${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`,
    search:productivitySearchText(connection.group_name, connection.tags),
    connection,
    run:()=>runAppAction("connection.terminal", {connectionId:connection.id})
  };
}

function quickPanelItems(query="") {
  const needle = String(query || "").trim().toLowerCase();
  const matches = item => !needle || productivitySearchText(item.title, item.detail, item.search).includes(needle);
  const directTarget = parseQuickSshTarget(query);
  const exactConnections = quickSshExactConnections(directTarget);
  const exactIds = new Set(exactConnections.map(connection => Number(connection.id)));
  const directItems = directTarget ? [
    ...exactConnections.map(quickPanelConnectionItem),
    ...(!exactConnections.length ? [{
      kind:"quick-ssh",
      icon:"zap",
      title:"快速连接",
      detail:`${quickSshEndpointText(directTarget)} · 凭据仅用于本次终端`,
      search:"ssh quick connect 快速连接",
      run:()=>startQuickSshConnection(directTarget)
    }] : []),
    {
      kind:"quick-ssh-new",
      icon:"plus",
      title:"新建 SSH 连接",
      detail:`使用 ${quickSshEndpointText(directTarget)} 填充连接表单`,
      search:"ssh new create 新建连接",
      run:()=>prefillNewSshConnection(directTarget)
    }
  ] : [];
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
    if (!exactIds.has(Number(connection.id))) items.push(quickPanelConnectionItem(connection));
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
  const matchedItems = items.filter(matches);
  const directText = String(query || "");
  const explicitDirectTarget = ["@", ".", ":", "[", "]"].some(character => directText.includes(character));
  return (explicitDirectTarget || exactConnections.length
    ? [...directItems, ...matchedItems]
    : [...matchedItems, ...directItems]
  ).slice(0, 120);
}

function ensureQuickPanel() {
  let panel = document.getElementById("quickPanel");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "quickPanel";
  panel.className = "quick-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="quick-panel-dialog" role="dialog" aria-modal="true" aria-label="快速打开">
    <div class="quick-panel-search">${icon("search")}<input id="quickPanelInput" autocomplete="off" spellcheck="false" placeholder="搜索内容，或输入 用户名@主机:端口"></div>
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
