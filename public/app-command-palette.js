function productivitySearchText(...values) {
  return values.flat().map(value => String(value ?? "").toLowerCase()).join(" ");
}

function quickPanelCommands() {
  ensureTermaActions();
  return listAppActions({surface:"quick-panel"}).filter(action => action.quick !== false).map(action => ({...action, kind:"command", run:()=>runAppAction(action.id, {surface:"quick-panel"})}));
}

function ensureTermaActions() {
  registerAppAction({id:"snippets.manage", icon:"library", title:tr("common:command_palette.manage_snippets", {defaultValue:"管理命令片段"}), detail:tr("common:auto.command_snippets", {defaultValue:"命令片段"}), search:"snippet command 命令 片段", run:openCommandSnippetManager});
  registerAppAction({id:"workspaces.manage", icon:"panels-top-left", title:tr("common:command_palette.manage_workspaces", {defaultValue:"管理命名工作区"}), detail:tr("common:auto.workspace", {defaultValue:"工作区"}), search:"workspace save restore 工作区", run:openNamedWorkspaceManager});
  registerAppAction({id:"workspaces.save", icon:"save", title:tr("common:command_palette.save_workspace", {defaultValue:"保存当前工作区为预设"}), detail:tr("common:auto.workspace", {defaultValue:"工作区"}), search:"workspace save preset 保存 工作区 预设", run:saveCurrentNamedWorkspace});
  registerAppAction({id:"terminal.broadcast", icon:"radio", title:tr("common:command_palette.start_broadcast", {defaultValue:"开始终端广播"}), detail:tr("common:auto.terminal", {defaultValue:"终端"}), search:"broadcast multiexec 广播 多终端", run:openTerminalBroadcastPicker});
  registerAppAction({id:"tabs.restore", icon:"undo-2", title:tr("common:command_palette.restore_tab", {defaultValue:"恢复最近关闭的标签"}), detail:tr("common:auto.tabs", {defaultValue:"标签"}), search:"restore closed tab 恢复 关闭 标签", run:restoreRecentlyClosedTab});
  registerAppAction({id:"ssh.key-wizard", icon:"key-round", title:tr("common:command_palette.ssh_key_wizard", {defaultValue:"SSH 密钥向导"}), detail:tr("common:auto.security", {defaultValue:"安全"}), search:"ssh key generate deploy 密钥 生成 部署", run:openSshKeyWizard});
  registerAppAction({id:"ssh.config-import", icon:"file-input", title:tr("common:command_palette.detect_ssh_config", {defaultValue:"检测 SSH config"}), detail:tr("common:auto.import", {defaultValue:"导入"}), search:"ssh config import detect 导入 检测", run:openSshConfigImport});
  registerAppAction({id:"sftp.external-edits", icon:"file-pen-line", title:tr("common:command_palette.manage_external_edits", {defaultValue:"管理外部编辑会话"}), detail:"SFTP", search:"external editor sftp 外部 编辑", visible:()=>Boolean(window.termaDesktop), run:openSftpExternalEditManager});
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

function quickPanelForwardItem(connection, forward) {
  const accessUrl = typeof quickForwardAccessUrl === "function" ? quickForwardAccessUrl(forward) : "";
  const status = typeof quickForwardStatusLabel === "function" ? quickForwardStatusLabel(forward) : String(forward.status || "");
  const rule = typeof quickForwardRuleText === "function" ? quickForwardRuleText(forward) : `${forward.bind_host}:${forward.bind_port}`;
  const name = typeof quickForwardName === "function" ? quickForwardName(forward) : String(forward.service_name || "Forwarding");
  const active = typeof quickForwardIsActive === "function" ? quickForwardIsActive(forward) : ["running", "reconnecting"].includes(String(forward.status || ""));
  const toggleLabel = active
    ? tr("connections:quick_open.stop_forward", {defaultValue:"停止转发"})
    : tr("connections:quick_open.start_forward", {defaultValue:"启动转发"});
  return {
    kind:"forward",
    icon:"route",
    title:name,
    detail:`${connection.name} · ${rule} · ${status}${accessUrl ? ` · ${accessUrl}` : ""}`,
    search:typeof quickForwardSearchText === "function" ? quickForwardSearchText(connection, forward) : productivitySearchText(connection.name, connection.ssh_host, name, rule, status, accessUrl),
    connection,
    forward,
    run:()=>openForwards(connection.id)
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
      title:tr("common:command_palette.quick_connect", {defaultValue:"快速连接"}),
      detail:tr("common:command_palette.quick_connect_detail", {endpoint:quickSshEndpointText(directTarget), defaultValue:`${quickSshEndpointText(directTarget)} · 凭据仅用于本次终端`}),
      search:"ssh quick connect 快速连接",
      run:()=>startQuickSshConnection(directTarget)
    }] : []),
    {
      kind:"quick-ssh-new",
      icon:"plus",
      title:tr("common:command_palette.new_ssh", {defaultValue:"新建 SSH 连接"}),
      detail:tr("common:command_palette.new_ssh_detail", {endpoint:quickSshEndpointText(directTarget), defaultValue:`使用 ${quickSshEndpointText(directTarget)} 填充连接表单`}),
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
        detail:tr("common:command_palette.workspace_group_detail", {count:group.tabCount, active:group.active ? tr("common:command_palette.current_suffix", {defaultValue:" · 当前"}) : "", defaultValue:`工作区组 · ${group.tabCount} 个标签${group.active ? " · 当前" : ""}`}),
        search:"workspace group switch 工作区 组 切换",
        run:()=>switchWorkspaceGroup(group.id)
      });
    }
  }
  for (const tab of tabs) {
    items.push({
      kind:"tab",
      icon:tab.kind === "terminal" ? "square-terminal" : tab.kind === "sftp" ? "folder-open" : "panel-top",
      title:typeof localizedWorkspaceTabTitle === "function" ? localizedWorkspaceTabTitle(tab) : tab.title,
      detail:tr("navigation:auto.switch_tab", {defaultValue:"切换标签"}),
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
    for (const forward of connection.forwards || []) items.push(quickPanelForwardItem(connection, forward));
  }
  for (const profile of [...remoteProfiles].sort((left, right) =>
    Number(right.favorite || 0) - Number(left.favorite || 0)
    || Number(right.last_used_at || 0) - Number(left.last_used_at || 0)
    || String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN")
  )) {
    const meta = REMOTE_PROTOCOL_META[profile.protocol] || {icon:"plug"};
    const protocolLabel = typeof remoteProtocolLabel === "function"
      ? remoteProtocolLabel(profile.protocol)
      : String(profile.protocol || "").toUpperCase();
    items.push({
      kind:"remote-profile",
      icon:profile.favorite ? "star" : meta.icon,
      title:profile.name,
      detail:`${protocolLabel} · ${remoteProfileEndpoint(profile)}`,
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
      detail:snippet.group_name || tr("common:auto.command_snippets", {defaultValue:"命令片段"}),
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
      detail:tr("common:command_palette.named_workspace_detail", {count:namedWorkspaceSavedTabs(workspace.layout || {}).length, defaultValue:`命名工作区 · ${namedWorkspaceSavedTabs(workspace.layout || {}).length} 个标签`}),
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
  if (panel) {
    syncQuickPanelLocalization(panel);
    return panel;
  }
  panel = document.createElement("div");
  panel.id = "quickPanel";
  panel.className = "quick-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="quick-panel-dialog" role="dialog" aria-modal="true" aria-label="${escAttr(tr("navigation:auto.quick_open", {defaultValue:"快速打开"}))}">
    <div class="quick-panel-search">${icon("search")}<input id="quickPanelInput" autocomplete="off" spellcheck="false" aria-label="${escAttr(tr("common:command_palette.search_placeholder", {defaultValue:"搜索内容，或输入 用户名@主机:端口"}))}" placeholder="${escAttr(tr("common:command_palette.search_placeholder", {defaultValue:"搜索内容，或输入 用户名@主机:端口"}))}"></div>
    <div id="quickPanelResults" class="quick-panel-results" role="listbox"></div>
  </div>`;
  document.body.appendChild(panel);
  syncQuickPanelLocalization(panel);
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
  panel.querySelector("#quickPanelResults")?.addEventListener("pointermove", event => {
    const item = event.target.closest?.(".quick-result[data-index]");
    if (!item) return;
    const index = Number(item.dataset.index);
    if (Number.isInteger(index) && productivityState.quickIndex !== index) {
      productivityState.quickIndex = index;
      renderQuickPanel(input?.value || "", false);
    }
  });
  return panel;
}

function syncQuickPanelLocalization(panel=document.getElementById("quickPanel")) {
  if (!panel) return;
  const title = tr("navigation:auto.quick_open", {defaultValue:"快速打开"});
  const search = tr("common:command_palette.search_placeholder", {defaultValue:"搜索内容，或输入 用户名@主机:端口"});
  panel.querySelector(".quick-panel-dialog")?.setAttribute("aria-label", title);
  const input = panel.querySelector("#quickPanelInput");
  if (input) {
    input.placeholder = search;
    input.setAttribute("aria-label", search);
  }
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
    const actions = item.kind === "connection" ? `<span class="quick-result-actions">
      <button data-action="quick-panel-connection-terminal" data-connection-id="${Number(item.connection.id)}" title="${escAttr(tr("common:command_palette.open_terminal", {defaultValue:"打开终端"}))}" aria-label="${escAttr(tr("common:command_palette.open_terminal", {defaultValue:"打开终端"}))}">${icon("square-terminal")}</button>
      <button data-action="quick-panel-connection-sftp" data-connection-id="${Number(item.connection.id)}" title="${escAttr(tr("common:command_palette.open_sftp", {defaultValue:"打开 SFTP"}))}" aria-label="${escAttr(tr("common:command_palette.open_sftp", {defaultValue:"打开 SFTP"}))}">${icon("folder-open")}</button>
      <button data-action="quick-panel-connection-forward" data-connection-id="${Number(item.connection.id)}" title="${escAttr(tr("common:command_palette.manage_forwards", {defaultValue:"管理转发"}))}" aria-label="${escAttr(tr("common:command_palette.manage_forwards", {defaultValue:"管理转发"}))}">${icon("route")}</button>
    </span>` : item.kind === "forward" ? (() => {
      const active = typeof quickForwardIsActive === "function" ? quickForwardIsActive(item.forward) : ["running", "reconnecting"].includes(String(item.forward.status || ""));
      const accessUrl = typeof quickForwardAccessUrl === "function" ? quickForwardAccessUrl(item.forward) : "";
      const toggleLabel = active ? tr("connections:quick_open.stop_forward", {defaultValue:"停止转发"}) : tr("connections:quick_open.start_forward", {defaultValue:"启动转发"});
      return `<span class="quick-result-actions">${accessUrl ? `<a href="${escAttr(accessUrl)}" target="_blank" rel="noopener" data-action="quick-panel-stop-propagation" title="${escAttr(tr("connections:quick_open.open_forward_url", {defaultValue:"打开访问地址"}))}" aria-label="${escAttr(tr("connections:quick_open.open_forward_url", {defaultValue:"打开访问地址"}))}">${icon("external-link")}</a>` : ""}<button data-action="quick-forward-toggle" data-forward-id="${Number(item.forward.id)}" title="${escAttr(toggleLabel)}" aria-label="${escAttr(toggleLabel)}">${icon(active ? "square" : "play")}</button><button data-action="quick-panel-forward-open" data-connection-id="${Number(item.connection.id)}" data-forward-id="${Number(item.forward.id)}" title="${escAttr(tr("connections:quick_open.open_forward", {defaultValue:"打开转发规则"}))}" aria-label="${escAttr(tr("connections:quick_open.open_forward", {defaultValue:"打开转发规则"}))}">${icon("route")}</button></span>`;
    })() : item.remoteProfile ? (() => {
      const openLabel = typeof remoteProtocolAction === "function"
        ? remoteProtocolAction(item.remoteProfile.protocol)
        : tr("common:auto.open", {defaultValue:"打开"});
      return `<span class="quick-result-actions"><button data-action="quick-panel-run" data-index="${index}" title="${escAttr(openLabel)}" aria-label="${escAttr(openLabel)}">${icon(REMOTE_PROTOCOL_META[item.remoteProfile.protocol]?.icon || "plug")}</button><button data-action="quick-panel-remote-edit" data-remote-profile-id="${Number(item.remoteProfile.id)}" title="${escAttr(tr("common:command_palette.edit_connection", {defaultValue:"编辑连接"}))}" aria-label="${escAttr(tr("common:command_palette.edit_connection", {defaultValue:"编辑连接"}))}">${icon("pencil")}</button></span>`;
    })() : "";
    const accessibleLabel = [item.title, item.detail].filter(Boolean).join(" · ");
    return `<div class="quick-result${index === productivityState.quickIndex ? " active" : ""}" role="option" aria-selected="${index === productivityState.quickIndex}" aria-label="${escAttr(accessibleLabel)}" title="${escAttr(accessibleLabel)}" data-i18n-skip data-index="${index}" data-action="quick-panel-run">
      <span class="quick-result-icon">${icon(item.icon)}</span><span class="quick-result-copy"><strong>${esc(item.title)}</strong><small>${esc(item.detail || "")}</small></span>${actions}
    </div>`;
  }).join("") : stateView("empty", tr("common:auto.no_matches", {defaultValue:"没有匹配结果"}), tr("common:command_palette.try_another", {defaultValue:"换一个关键词试试。"}));
  results.querySelector(".quick-result.active")?.scrollIntoView({block:"nearest"});
  refreshIcons();
}

function runQuickPanelItem(index) {
  const item = productivityState.quickItems[Number(index)];
  if (!item) return;
  closeQuickPanel();
  Promise.resolve(item.run()).catch(error => notify(error.message, "error"));
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("quick-panel-run", ({event, element}) => {
    if (event.target.closest("button, a")) return;
    event.stopPropagation();
    runQuickPanelItem(Number(element.dataset.index));
  });
  registerTermaAction("quick-panel-connection-terminal", ({event, element}) => {
    event.stopPropagation(); closeQuickPanel(); runAppAction("connection.terminal", {connectionId:Number(element.dataset.connectionId)});
  });
  registerTermaAction("quick-panel-connection-sftp", ({event, element}) => {
    event.stopPropagation(); closeQuickPanel(); runAppAction("connection.sftp", {connectionId:Number(element.dataset.connectionId)});
  });
  registerTermaAction("quick-panel-connection-forward", ({event, element}) => {
    event.stopPropagation(); closeQuickPanel(); runAppAction("connection.forwards", {connectionId:Number(element.dataset.connectionId)});
  });
  registerTermaAction("quick-panel-forward-open", ({event, element}) => {
    event.stopPropagation();
    closeQuickPanel();
    const connectionId = Number(element.dataset.connectionId || 0);
    const forwardId = Number(element.dataset.forwardId || 0);
    openForwards(connectionId);
    requestAnimationFrame(() => document.querySelector(`.forward-card[data-forward-id="${forwardId}"]`)?.scrollIntoView({block:"center", behavior:"smooth"}));
  });
  registerTermaAction("quick-panel-remote-edit", ({event, element}) => {
    event.stopPropagation(); closeQuickPanel(); editRemoteProfile(Number(element.dataset.remoteProfileId));
  });
  registerTermaAction("quick-panel-stop-propagation", ({event}) => event.stopPropagation());
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    const panel = document.getElementById("quickPanel");
    if (!panel) return;
    syncQuickPanelLocalization(panel);
    if (!panel.hidden) renderQuickPanel(panel.querySelector("#quickPanelInput")?.value || "", false);
  });
}
