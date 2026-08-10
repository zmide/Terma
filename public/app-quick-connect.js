function quickConnectionSearchText(connection) {
  return [
    connection.name,
    connection.group_name,
    connection.ssh_host,
    connection.ssh_user,
    connection.ssh_port
  ].join(" ").toLowerCase();
}

function quickConnectionRows(query="") {
  const needle = String(query || "").trim().toLowerCase();
  return [...connections]
    .filter(connection => !needle || quickConnectionSearchText(connection).includes(needle))
    .sort((left, right) => Number(right.favorite || 0) - Number(left.favorite || 0)
      || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN", {numeric:true}));
}

function renderQuickConnectionRows(query="") {
  const list = $("quickConnectionList");
  if (!list) return;
  const rows = quickConnectionRows(query);
  list.innerHTML = rows.length ? rows.map(connection => `<div class="quick-connection-row" data-dblclick-action="quick-connect-terminal" data-connection-id="${connection.id}" tabindex="0" title="双击打开终端">
    <strong title="${escAttr(connection.name)}">${icon(connection.favorite ? "star" : "server")}<span>${esc(connection.name)}</span></strong>
    <code title="${escAttr(connection.ssh_host)}">${esc(connection.ssh_host)}</code>
    <span class="quick-connection-port">${Number(connection.ssh_port || 22)}</span>
    <span class="quick-connection-user" title="${escAttr(connection.ssh_user)}">${esc(connection.ssh_user)}</span>
    <div class="quick-connection-actions">
      <button class="icon-button" type="button" data-action="quick-connect-edit" data-connection-id="${connection.id}" title="编辑连接" aria-label="编辑连接">${icon("pencil")}</button>
      <button class="icon-button primary" type="button" data-action="quick-connect-terminal" data-connection-id="${connection.id}" title="打开终端" aria-label="打开终端">${icon("square-terminal")}</button>
      <button class="icon-button" type="button" data-action="quick-connect-sftp" data-connection-id="${connection.id}" title="打开 SFTP 文件管理" aria-label="打开 SFTP 文件管理">${icon("folder-sync")}</button>
    </div>
  </div>`).join("") : stateView("empty", "没有匹配的服务器", query ? "换一个名称、地址或用户名试试" : "请先添加 SSH 连接");
}

function closeQuickConnectionLauncher() {
  const modal = $("modal");
  if (!modal || modal.dataset.quickConnectionLauncher !== "1") return;
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
    <header class="quick-connection-head"><div><h2 id="quickConnectionTitle">快速打开服务器</h2><span>双击一行默认打开终端</span></div><button class="icon-button" type="button" data-action="quick-connect-close" title="关闭" aria-label="关闭">${icon("x")}</button></header>
    <label class="quick-connection-search">${icon("search")}<input id="quickConnectionSearch" type="search" autocomplete="off" placeholder="搜索名称、IP、端口或用户名" data-input-action="quick-connect-search"></label>
    <div class="quick-connection-columns" aria-hidden="true"><span>名称</span><span>IP / 主机</span><span>端口</span><span>用户名</span><span>操作</span></div>
    <div id="quickConnectionList" class="quick-connection-list"></div>
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

if (typeof registerTermaAction === "function") {
  registerTermaAction("quick-connect-open", () => openQuickConnectionLauncher());
  registerTermaAction("quick-connect-close", () => closeQuickConnectionLauncher());
  registerTermaAction("quick-connect-search", ({element}) => renderQuickConnectionRows(element.value));
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
}
