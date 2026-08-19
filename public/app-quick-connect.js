const QUICK_CONNECTION_RESULT_LIMIT = 120;
const QUICK_FORWARD_RESULT_LIMIT = 120;
let quickConnectionSearchCache = new WeakMap();
let quickForwardSearchCache = new WeakMap();
let quickConnectionRenderFrame = 0;
let quickConnectionRenderQuery = "";

function quickSearchSignature(values) {
  return values.map(value => String(value ?? "")).join("\u0001").toLowerCase();
}

function quickConnectionSearchText(connection) {
  const signature = quickSearchSignature([
    connection.name,
    connection.group_name,
    connection.tags,
    connection.ssh_host,
    connection.ssh_user,
    connection.ssh_port,
    `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`
  ]);
  const cached = quickConnectionSearchCache.get(connection);
  if (cached?.signature === signature) return cached.text;
  const result = {signature, text:signature.replaceAll("\u0001", " ")};
  quickConnectionSearchCache.set(connection, result);
  return result.text;
}

function quickForwardSearchAliases(forward) {
  const mode = {
    local:`local ${tr("connections:quick_open.search_alias_local", {defaultValue:"local forwarding"})}`,
    remote:`remote ${tr("connections:quick_open.search_alias_remote", {defaultValue:"remote forwarding"})}`,
    socks:`socks socks5 ${tr("connections:quick_open.search_alias_socks", {defaultValue:"dynamic forwarding"})}`
  }[forward.mode] || forward.mode;
  const status = {
    running:`running ${tr("connections:quick_open.search_alias_running", {defaultValue:"running"})}`,
    stopped:`stopped ${tr("connections:quick_open.search_alias_stopped", {defaultValue:"stopped"})}`,
    failed:`failed ${tr("connections:quick_open.search_alias_failed", {defaultValue:"failed to start"})}`,
    reconnecting:`reconnecting ${tr("connections:quick_open.search_alias_reconnecting", {defaultValue:"reconnecting"})}`
  }[forward.status] || forward.status;
  return `${mode || ""} ${status || ""}`;
}

function quickForwardSearchText(connection, forward) {
  const signature = quickSearchSignature([
    connection.name,
    connection.group_name,
    connection.tags,
    connection.ssh_host,
    connection.ssh_user,
    connection.ssh_port,
    forward.service_name,
    forward.service_type,
    forward.service_note,
    forward.mode,
    forward.status,
    forward.url_scheme,
    forward.url_path,
    forward.bind_host,
    forward.bind_port,
    forward.target_host,
    forward.target_port,
    `${forward.bind_host}:${forward.bind_port}`,
    `${forward.target_host}:${forward.target_port}`,
    quickForwardSearchAliases(forward)
  ]);
  const cached = quickForwardSearchCache.get(forward);
  if (cached?.signature === signature) return cached.text;
  const result = {signature, text:signature.replaceAll("\u0001", " ")};
  quickForwardSearchCache.set(forward, result);
  return result.text;
}

function quickConnectionRows(query="") {
  const needle = String(query || "").trim().toLowerCase();
  const exactIds = new Set(quickSshExactConnections(parseQuickSshTarget(query)).map(connection => Number(connection.id)));
  return [...connections]
    .filter(connection => !needle || exactIds.has(Number(connection.id)) || quickConnectionSearchText(connection).includes(needle))
    .sort((left, right) => Number(right.favorite || 0) - Number(left.favorite || 0)
      || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN", {numeric:true}));
}

function quickForwardRows(query="") {
  const needle = String(query || "").trim().toLowerCase();
  const rows = [];
  for (const connection of connections) {
    for (const forward of connection.forwards || []) {
      if (!needle || quickForwardSearchText(connection, forward).includes(needle)) rows.push({connection, forward});
    }
  }
  return rows.sort((left, right) => Number(right.forward.status === "running") - Number(left.forward.status === "running")
    || Number(right.connection.favorite || 0) - Number(left.connection.favorite || 0)
    || String(left.forward.service_name || left.connection.name || "").localeCompare(String(right.forward.service_name || right.connection.name || ""), "zh-CN", {numeric:true})
    || Number(left.forward.id || 0) - Number(right.forward.id || 0));
}

function quickForwardEndpoint(host, port) {
  const value = String(host || "");
  const displayHost = value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
  return `${displayHost}:${port || ""}`;
}

function quickForwardName(forward) {
  if (forward.service_name) return forward.service_name;
  if (forward.service_type && forward.service_type !== "other") return String(forward.service_type).toUpperCase();
  return {
    local:tr("connections:forwards.local_forward", {defaultValue:"本地转发"}),
    remote:tr("connections:forwards.remote_forward", {defaultValue:"远程转发"}),
    socks:"SOCKS5"
  }[forward.mode] || tr("connections:quick_open.forward_rule", {defaultValue:"转发规则"});
}

function quickForwardModeLabel(forward) {
  return {
    local:tr("connections:forwards.local_forward", {defaultValue:"本地转发"}),
    remote:tr("connections:forwards.remote_forward", {defaultValue:"远程转发"}),
    socks:"SOCKS5"
  }[forward.mode] || String(forward.mode || "");
}

function quickForwardStatusLabel(forward) {
  const key = {running:"running", stopped:"stopped", failed:"failed", reconnecting:"reconnecting"}[forward.status];
  const fallback = {running:"运行中", stopped:"已停止", failed:"启动失败", reconnecting:"重连中"}[forward.status] || String(forward.status || "");
  return key ? tr(`connections:forwards.${key}`, {defaultValue:fallback}) : fallback;
}

function quickForwardRuleText(forward) {
  const bind = quickForwardEndpoint(forward.bind_host, forward.bind_port);
  if (forward.mode === "socks") return bind;
  return `${bind} → ${quickForwardEndpoint(forward.target_host, forward.target_port)}`;
}

function quickForwardAccessUrl(forward) {
  if (String(forward?.status || "") !== "running" || typeof forwardAccessInfo !== "function") return "";
  return forwardAccessInfo(forward)?.url || "";
}

function quickForwardIsActive(forward) {
  return ["running", "reconnecting"].includes(String(forward?.status || ""));
}

async function toggleQuickForward(element) {
  const id = Number(element?.dataset.forwardId || 0);
  if (!id) return;
  const forward = typeof currentForward === "function" ? currentForward(id) : null;
  if (!forward) return notify(tr("connections:forwards.not_found", {defaultValue:"Forwarding rule not found"}), "error");
  if (quickForwardIsActive(forward)) await stopSingleForward(id, element);
  else await startSingleForward(id, element);
  if (document.getElementById("quickConnectionList")) renderQuickConnectionRows($("quickConnectionSearch")?.value || "");
  if (!document.getElementById("quickPanel")?.hidden) renderQuickPanel($("quickPanelInput")?.value || "", false);
}

function quickResultLimitHtml(shown, total) {
  if (shown >= total) return "";
  return `<div class="quick-result-limit">${esc(tr("connections:quick_open.result_limit", {shown, total, defaultValue:`仅显示前 ${shown} / ${total} 项，请继续输入关键词缩小范围`}))}</div>`;
}

function renderQuickConnectionRows(query="") {
  const list = $("quickConnectionList");
  if (!list) return;
  const allConnectionRows = quickConnectionRows(query);
  const allForwardRows = quickForwardRows(query);
  const rows = allConnectionRows.slice(0, QUICK_CONNECTION_RESULT_LIMIT);
  const forwardRows = allForwardRows.slice(0, QUICK_FORWARD_RESULT_LIMIT);
  const target = parseQuickSshTarget(query);
  const exact = quickSshExactConnections(target);
  const savedRows = rows.map(connection => `<div class="quick-connection-row" data-dblclick-action="quick-connect-terminal" data-connection-id="${connection.id}" tabindex="0" title="${escAttr(tr("connections:quick_open.double_click_terminal", {defaultValue:"双击打开终端"}))}">
    <strong title="${escAttr(connection.name)}">${icon(connection.favorite ? "star" : "server")}<span>${esc(connection.name)}</span></strong>
    <code title="${escAttr(connection.ssh_host)}">${esc(connection.ssh_host)}</code>
    <span class="quick-connection-port">${Number(connection.ssh_port || 22)}</span>
    <span class="quick-connection-user" title="SSH · ${escAttr(connection.ssh_user)}">SSH · ${esc(connection.ssh_user)}</span>
    <div class="quick-connection-actions">
      <button class="icon-button" type="button" data-action="quick-connect-edit" data-connection-id="${connection.id}" title="${escAttr(tr("connections:quick_open.edit", {defaultValue:"编辑连接"}))}" aria-label="${escAttr(tr("connections:quick_open.edit", {defaultValue:"编辑连接"}))}">${icon("pencil")}</button>
      <button class="icon-button primary" type="button" data-action="quick-connect-terminal" data-connection-id="${connection.id}" title="${escAttr(tr("connections:quick_open.open_terminal", {defaultValue:"打开终端"}))}" aria-label="${escAttr(tr("connections:quick_open.open_terminal", {defaultValue:"打开终端"}))}">${icon("square-terminal")}</button>
      <button class="icon-button" type="button" data-action="quick-connect-sftp" data-connection-id="${connection.id}" title="${escAttr(tr("connections:quick_open.open_sftp", {defaultValue:"打开 SFTP 文件管理"}))}" aria-label="${escAttr(tr("connections:quick_open.open_sftp", {defaultValue:"打开 SFTP 文件管理"}))}">${icon("folder-sync")}</button>
    </div>
  </div>`).join("");
  const forwardingRows = forwardRows.map(({connection, forward}) => {
    const accessUrl = quickForwardAccessUrl(forward);
    const status = quickForwardStatusLabel(forward);
    const type = [quickForwardModeLabel(forward), forward.service_type && forward.service_type !== "other" ? String(forward.service_type).toUpperCase() : ""].filter(Boolean).join(" · ");
    const server = `${connection.name} · ${connection.ssh_host}`;
    const openRule = tr("connections:quick_open.open_forward", {defaultValue:"打开转发规则"});
    const openUrl = tr("connections:quick_open.open_forward_url", {defaultValue:"打开访问地址"});
    const toggleLabel = quickForwardIsActive(forward)
      ? tr("connections:quick_open.stop_forward", {defaultValue:"停止转发"})
      : tr("connections:quick_open.start_forward", {defaultValue:"启动转发"});
    const addressLabel = tr("connections:quick_open.access_address", {defaultValue:"访问地址"});
    const typeText = type || tr("connections:quick_open.forward_rule", {defaultValue:"转发规则"});
    return `<div class="quick-connection-row quick-forward-row" data-dblclick-action="quick-connect-forward" data-connection-id="${connection.id}" data-forward-id="${forward.id}" tabindex="0" title="${escAttr(openRule)}">
      <strong title="${escAttr(quickForwardName(forward))}">${icon("route")}<span>${esc(quickForwardName(forward))}</span><small class="quick-forward-status ${escAttr(forward.status || "stopped")}">${esc(status)}</small></strong>
      <span class="quick-forward-server"><code title="${escAttr(server)}">${esc(server)}</code>${accessUrl ? `<small title="${escAttr(accessUrl)}">${esc(addressLabel)}：${esc(accessUrl)}</small>` : ""}</span>
      <span class="quick-connection-port">${Number(forward.bind_port || 0)}</span>
      <span class="quick-connection-user" title="${escAttr(`${typeText} · ${quickForwardRuleText(forward)}`)}">${esc(typeText)}</span>
      <div class="quick-connection-actions quick-forward-actions">
        ${accessUrl ? `<a class="icon-button" href="${escAttr(accessUrl)}" target="_blank" rel="noopener" title="${escAttr(openUrl)}" aria-label="${escAttr(openUrl)}">${icon("external-link")}</a>` : ""}
        <button class="icon-button${quickForwardIsActive(forward) ? " danger" : " primary"}" type="button" data-action="quick-forward-toggle" data-forward-id="${forward.id}" title="${escAttr(toggleLabel)}" aria-label="${escAttr(toggleLabel)}">${icon(quickForwardIsActive(forward) ? "square" : "play")}</button>
        <button class="icon-button primary" type="button" data-action="quick-connect-forward" data-connection-id="${connection.id}" data-forward-id="${forward.id}" title="${escAttr(openRule)}" aria-label="${escAttr(openRule)}">${icon("route")}</button>
      </div>
    </div>`;
  }).join("");
  const targetRows = target && !allForwardRows.length ? `${exact.length ? "" : `<button class="quick-connection-target-row primary-target" type="button" data-action="quick-connect-direct">
      <span class="quick-result-icon">${icon("zap")}</span><span><strong>${esc(tr("connections:quick_open.quick_connect", {defaultValue:"快速连接"}))}</strong><small>${esc(quickSshEndpointText(target))} · ${esc(tr("connections:quick_open.quick_connect_hint", {defaultValue:"可使用终端、SFTP 与 X11，不保存连接"}))}</small></span><span>${icon("square-terminal")}</span>
    </button>`}<button class="quick-connection-target-row" type="button" data-action="quick-connect-new">
      <span class="quick-result-icon">${icon("plus")}</span><span><strong>${esc(tr("connections:quick_open.new_ssh_connection", {defaultValue:"新建 SSH 连接"}))}</strong><small>${esc(tr("connections:quick_open.new_ssh_hint", {endpoint:quickSshEndpointText(target), defaultValue:`使用 ${quickSshEndpointText(target)} 填充连接表单`}))}</small></span><span>${icon("pencil")}</span>
    </button>` : "";
  const connectionSection = savedRows ? `<div class="quick-result-section-label"><span>${esc(tr("connections:quick_open.connections", {defaultValue:"SSH 连接"}))}</span><span>${allConnectionRows.length}</span></div>${savedRows}${quickResultLimitHtml(rows.length, allConnectionRows.length)}` : "";
  const forwardSection = forwardingRows ? `<div class="quick-result-section-label"><span>${esc(tr("connections:quick_open.forwards", {defaultValue:"转发规则"}))}</span><span>${allForwardRows.length}</span></div>${forwardingRows}${quickResultLimitHtml(forwardRows.length, allForwardRows.length)}` : "";
  list.innerHTML = connectionSection + forwardSection + targetRows || stateView(
    "empty",
    tr("connections:quick_open.no_matching_servers", {defaultValue:"没有匹配的连接或转发"}),
    query
      ? tr("connections:quick_open.direct_target_hint", {defaultValue:"也可以输入 用户名@主机:端口 直接连接"})
      : tr("connections:quick_open.add_ssh_hint", {defaultValue:"请先添加 SSH 连接或转发规则"})
  );
  refreshIcons();
}

function scheduleQuickConnectionRows(query="") {
  quickConnectionRenderQuery = String(query || "");
  if (quickConnectionRenderFrame) return;
  quickConnectionRenderFrame = requestAnimationFrame(() => {
    quickConnectionRenderFrame = 0;
    renderQuickConnectionRows(quickConnectionRenderQuery);
  });
}

function closeQuickConnectionLauncher() {
  const modal = $("modal");
  if (!modal || modal.dataset.quickConnectionLauncher !== "1") return;
  if (quickConnectionRenderFrame) cancelAnimationFrame(quickConnectionRenderFrame);
  quickConnectionRenderFrame = 0;
  modal.hidden = true;
  modal.dataset.quickConnectionLauncher = "";
  modal.onclick = null;
  modal.innerHTML = "";
}

function openQuickConnectionLauncher() {
  const modal = $("modal");
  if (!modal) return;
  modal.dataset.quickConnectionLauncher = "1";
  modal.innerHTML = `<div class="modal-card quick-connection-modal" role="dialog" aria-modal="true" aria-labelledby="quickConnectionTitle">
    <header class="quick-connection-head"><div><h2 id="quickConnectionTitle">${esc(tr("connections:quick_open.title", {defaultValue:"快速打开"}))}</h2><span>${esc(tr("connections:quick_open.subtitle", {defaultValue:"搜索 SSH 连接和转发规则；双击打开"}))}</span></div><button class="icon-button" type="button" data-action="quick-connect-close" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></header>
    <label class="quick-connection-search">${icon("search")}<input id="quickConnectionSearch" type="search" autocomplete="off" spellcheck="false" placeholder="${escAttr(tr("connections:quick_open.search_placeholder", {defaultValue:"搜索连接、转发、端口或 URL，也可输入 用户名@主机:端口"}))}" data-input-action="quick-connect-search" data-keydown-action="quick-connect-keydown"></label>
    <div class="quick-connection-table">
      <div class="quick-connection-columns" aria-hidden="true"><span>${esc(tr("connections:quick_open.name", {defaultValue:"名称"}))}</span><span>${esc(tr("connections:quick_open.host", {defaultValue:"服务器"}))}</span><span>${esc(tr("connections:quick_open.port", {defaultValue:"端口"}))}</span><span>${esc(tr("connections:quick_open.kind_or_user", {defaultValue:"类型 / 用户"}))}</span><span class="quick-connection-actions-heading">${esc(tr("connections:quick_open.actions", {defaultValue:"操作"}))}</span></div>
      <div id="quickConnectionList" class="quick-connection-list"></div>
    </div>
  </div>`;
  modal.hidden = false;
  modal.onclick = null;
  renderQuickConnectionRows();
  $("quickConnectionSearch")?.focus({preventScroll:true});
}

function quickConnectionId(element) {
  return Number(element?.dataset.connectionId || 0);
}

function runQuickConnectionAction(element, action) {
  const id = quickConnectionId(element);
  if (!id) return;
  closeQuickConnectionLauncher();
  action(id);
}

function runQuickForwardAction(element) {
  const connectionId = quickConnectionId(element);
  const forwardId = Number(element?.dataset.forwardId || 0);
  if (!connectionId || !forwardId) return;
  closeQuickConnectionLauncher();
  openForwards(connectionId);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const card = document.querySelector(`.forward-card[data-forward-id="${forwardId}"]`);
    if (!card) return;
    card.classList.add("quick-open-target");
    card.scrollIntoView({block:"center", behavior:"smooth"});
    setTimeout(() => card.classList.remove("quick-open-target"), 1600);
  }));
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("quick-connect-open", () => openQuickConnectionLauncher());
  registerTermaAction("quick-connect-close", () => closeQuickConnectionLauncher());
  registerTermaAction("quick-connect-search", ({element}) => scheduleQuickConnectionRows(element.value));
  registerTermaAction("quick-connect-keydown", ({event, element}) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const firstConnection = quickConnectionRows(element.value)[0];
    if (firstConnection) return runQuickConnectionAction({dataset:{connectionId:firstConnection.id}}, id => openTerminal(id));
    const firstForward = quickForwardRows(element.value)[0];
    if (firstForward) return runQuickForwardAction({dataset:{connectionId:firstForward.connection.id, forwardId:firstForward.forward.id}});
    runQuickSshDefault(element.value);
  });
  registerTermaAction("quick-connect-edit", ({event, element}) => {
    event.stopPropagation();
    runQuickConnectionAction(element, id => editConnection(id));
  });
  registerTermaAction("quick-connect-terminal", ({event, element}) => {
    event.stopPropagation();
    runQuickConnectionAction(element, id => openTerminal(id));
  });
  registerTermaAction("quick-connect-sftp", ({event, element}) => {
    event.stopPropagation();
    runQuickConnectionAction(element, id => openSftp(id));
  });
  registerTermaAction("quick-connect-forward", ({event, element}) => {
    event.stopPropagation();
    runQuickForwardAction(element);
  });
  registerTermaAction("quick-forward-toggle", ({event, element}) => {
    event.stopPropagation();
    return toggleQuickForward(element);
  });
  registerTermaAction("quick-connect-direct", ({event}) => {
    event.stopPropagation();
    const target = parseQuickSshTarget($("quickConnectionSearch")?.value || "");
    if (target) return startQuickSshConnection(target);
  });
  registerTermaAction("quick-connect-new", ({event}) => {
    event.stopPropagation();
    const target = parseQuickSshTarget($("quickConnectionSearch")?.value || "");
    if (target) prefillNewSshConnection(target);
  });
}
