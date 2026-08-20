function globalForwardStoredSet(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveGlobalForwardStoredSet(key, values) {
  localStorage.setItem(key, JSON.stringify([...values]));
}

const globalForwardManagerState = {
  query:localStorage.getItem("globalForwardSearch") || "",
  status:localStorage.getItem("globalForwardStatus") || "all",
  connectionId:Number(localStorage.getItem("globalForwardConnection") || 0),
  groupMode:localStorage.getItem("globalForwardGroupMode") === "ssh" ? "ssh" : "flat",
  page:Math.max(1, Number(localStorage.getItem("globalForwardPage") || 1)),
  pageSize:[12,24,48,96].includes(Number(localStorage.getItem("globalForwardPageSize"))) ? Number(localStorage.getItem("globalForwardPageSize")) : 12,
  collapsedGroups:globalForwardStoredSet("globalForwardCollapsedGroups"),
  collapsedConnections:globalForwardStoredSet("globalForwardCollapsedConnections"),
  focusId:0
};

let globalForwardSortDrag = null;

function globalForwardMatches(connection, forward) {
  if (globalForwardManagerState.connectionId && Number(connection.id) !== globalForwardManagerState.connectionId) return false;
  if (globalForwardManagerState.status !== "all" && String(forward.status || "stopped") !== globalForwardManagerState.status) return false;
  const needle = globalForwardManagerState.query.trim().toLowerCase();
  if (!needle) return true;
  const search = typeof quickForwardSearchText === "function"
    ? quickForwardSearchText(connection, forward)
    : [connection.name, connection.ssh_host, forwardDisplayName(forward), forwardText(forward), forward.status].join(" ").toLowerCase();
  return search.includes(needle);
}

function compareGlobalForwardRows(left, right) {
  const rank = {failed:0, reconnecting:1, running:2, stopped:3};
  return (rank[left.forward.status] ?? 4) - (rank[right.forward.status] ?? 4)
    || String(left.connection.name || "").localeCompare(String(right.connection.name || ""), document.documentElement.lang || "zh-CN", {numeric:true})
    || String(forwardDisplayName(left.forward)).localeCompare(String(forwardDisplayName(right.forward)), document.documentElement.lang || "zh-CN", {numeric:true});
}

function globalForwardRows() {
  const rows = [];
  for (const connection of connections) {
    for (const forward of connection.forwards || []) {
      if (globalForwardMatches(connection, forward)) rows.push({connection, forward});
    }
  }
  return rows.sort(compareGlobalForwardRows);
}

function globalForwardAllRows() {
  return connections.flatMap(connection => (connection.forwards || []).map(forward => ({connection, forward})));
}

function globalForwardPagination(rows) {
  const total = rows.length;
  const pageSize = [12,24,48,96].includes(Number(globalForwardManagerState.pageSize)) ? Number(globalForwardManagerState.pageSize) : 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(globalForwardManagerState.page) || 1), totalPages);
  if (page !== globalForwardManagerState.page) {
    globalForwardManagerState.page = page;
    localStorage.setItem("globalForwardPage", String(page));
  }
  const start = total ? (page - 1) * pageSize : 0;
  return {rows:rows.slice(start, start + pageSize), total, page, pageSize, totalPages, first:total ? start + 1 : 0, last:Math.min(start + pageSize, total)};
}

function renderGlobalForwardPagination(pagination) {
  if (!pagination.total) return "";
  const pageLabel = tr("connections:forward_manager.pagination.page", {page:pagination.page, pages:pagination.totalPages, defaultValue:`Page ${pagination.page} of ${pagination.totalPages}`});
  const showingLabel = tr("connections:forward_manager.pagination.showing", {from:pagination.first, to:pagination.last, total:pagination.total, defaultValue:`Showing ${pagination.first}–${pagination.last} of ${pagination.total}`});
  const sizes = [12,24,48,96].map(size => `<option value="${size}"${size === pagination.pageSize ? " selected" : ""}>${size}</option>`).join("");
  return `<div class="forward-pagination" aria-label="${escAttr(tr("connections:forward_manager.pagination.label", {defaultValue:"Forwarding list pagination"}))}"><button data-action="global-forward-page" data-page="${pagination.page - 1}"${pagination.page <= 1 ? " disabled" : ""}>${esc(tr("connections:forward_manager.pagination.previous", {defaultValue:"Previous"}))}</button><span class="pager-count"><span>${esc(showingLabel)}</span><strong>${esc(pageLabel)}</strong><label><span>${esc(tr("connections:forward_manager.pagination.page_size", {defaultValue:"Items per page"}))}</span><select data-change-action="global-forward-page-size" aria-label="${escAttr(tr("connections:forward_manager.pagination.page_size", {defaultValue:"Items per page"}))}">${sizes}</select></label></span><button data-action="global-forward-page" data-page="${pagination.page + 1}"${pagination.page >= pagination.totalPages ? " disabled" : ""}>${esc(tr("connections:forward_manager.pagination.next", {defaultValue:"Next"}))}</button></div>`;
}

function globalForwardManagerSubtitle() {
  const total = globalForwardAllRows().length;
  return tr("connections:forward_manager.subtitle", {count:total, defaultValue:`集中管理 ${total} 条转发规则`});
}

function globalForwardStatusOptions() {
  return [
    ["all", tr("connections:forward_manager.all_statuses", {defaultValue:"全部状态"})],
    ["running", tr("connections:forwards.running", {defaultValue:"运行中"})],
    ["reconnecting", tr("connections:forwards.reconnecting", {defaultValue:"重连中"})],
    ["stopped", tr("connections:forwards.stopped", {defaultValue:"已停止"})],
    ["failed", tr("connections:forwards.failed", {defaultValue:"启动失败"})]
  ];
}

function renderGlobalForwardCard(connection, forward, options={}) {
  const access = forwardCanAccess(forward) ? forwardAccessInfo(forward) : null;
  const active = forwardIsActive(forward);
  const startStopLabel = active
    ? tr("connections:quick_open.stop_forward", {defaultValue:"停止转发"})
    : tr("connections:quick_open.start_forward", {defaultValue:"启动转发"});
  const editLabel = tr("common:actions.edit", {defaultValue:"编辑"});
  const deleteLabel = tr("common:actions.delete", {defaultValue:"删除"});
  const manageLabel = tr("connections:forward_manager.open_connection_rules", {defaultValue:"打开此服务器的转发页"});
  const manageShortLabel = tr("connections:forward_manager.server_rules", {defaultValue:"服务器转发"});
  const copyLabel = tr("common:auto.copy", {defaultValue:"复制"});
  const highlighted = Number(globalForwardManagerState.focusId) === Number(forward.id);
  const connectionSubtitle = options.grouped
    ? `<code>${esc(connection.ssh_host)}:${Number(connection.ssh_port || 22)}</code>`
    : `${esc(connection.name)} · <code>${esc(connection.ssh_host)}:${Number(connection.ssh_port || 22)}</code>`;
  return `<article class="global-forward-card${options.grouped ? " is-grouped" : ""}${highlighted ? " is-focused" : ""}" data-forward-id="${Number(forward.id)}">
    <div class="global-forward-main">
      <div class="global-forward-title"><span class="global-forward-icon">${icon("route")}</span><div><strong>${esc(forwardDisplayName(forward))}</strong><span>${connectionSubtitle}</span></div><span class="status-pill ${escAttr(forward.status || "stopped")}">${esc(forwardStatusText(forward.status || "stopped"))}</span></div>
      <div class="global-forward-details">
        <div><small>${esc(tr("connections:forwards.rule", {defaultValue:"转发规则"}))}</small><span>${forwardText(forward)}</span></div>
        <div><small>${esc(tr("connections:forwards.service_entry", {defaultValue:"服务入口"}))}</small><span>${esc([forwardModeText(forward.mode), serviceTypeText(forward.service_type)].filter(Boolean).join(" · "))}</span></div>
        ${forward.service_note ? `<div><small>${esc(tr("connections:auto.note", {defaultValue:"备注"}))}</small><span>${esc(forward.service_note)}</span></div>` : ""}
      </div>
      ${access?.url ? `<div class="global-forward-access"><span>${icon("link")}<code title="${escAttr(access.url)}">${esc(access.url)}</code></span><div><a class="open-forward-link" href="${escAttr(access.url)}" target="_blank" rel="noopener">${icon("external-link")}<span>${esc(tr("common:auto.open", {defaultValue:"打开"}))}</span></a><button data-action="global-forward-copy" data-copy-text="${escAttr(access.url)}" title="${escAttr(copyLabel)}" aria-label="${escAttr(copyLabel)}">${icon("copy")}<span>${esc(copyLabel)}</span></button></div></div>` : `<div class="global-forward-access muted"><span>${icon("link-2-off")}<span>${esc(tr("connections:forward_manager.address_after_start", {defaultValue:"启动成功后显示访问地址"}))}</span></span></div>`}
    </div>
    <div class="global-forward-actions">
      <button class="${active ? "" : "primary"}" data-action="global-forward-toggle" data-forward-id="${Number(forward.id)}" title="${escAttr(startStopLabel)}" aria-label="${escAttr(startStopLabel)}">${icon(active ? "square" : "play")}<span>${esc(startStopLabel)}</span></button>
      <button data-action="global-forward-edit" data-forward-id="${Number(forward.id)}" title="${escAttr(editLabel)}" aria-label="${escAttr(editLabel)}">${icon("pencil")}<span>${esc(editLabel)}</span></button>
      <button data-action="global-forward-open-connection" data-connection-id="${Number(connection.id)}" data-forward-id="${Number(forward.id)}" title="${escAttr(manageLabel)}" aria-label="${escAttr(manageLabel)}">${icon("server-cog")}<span>${esc(manageShortLabel)}</span></button>
      <button class="danger" data-action="global-forward-delete" data-forward-id="${Number(forward.id)}" title="${escAttr(deleteLabel)}" aria-label="${escAttr(deleteLabel)}">${icon("trash-2")}<span>${esc(deleteLabel)}</span></button>
    </div>
  </article>`;
}

function globalForwardSortingEnabled() {
  const total = globalForwardRows().length;
  return !globalForwardManagerState.query.trim()
    && globalForwardManagerState.status === "all"
    && !globalForwardManagerState.connectionId
    && globalForwardManagerState.page === 1
    && total <= globalForwardManagerState.pageSize;
}

function globalForwardGroupedConnections(sourceRows=globalForwardRows()) {
  const filtered = Boolean(globalForwardManagerState.query.trim()) || globalForwardManagerState.status !== "all";
  const grouped = new Map();
  for (const item of sourceRows) {
    const key = Number(item.connection.id);
    if (!grouped.has(key)) grouped.set(key, {connection:item.connection, rows:[]});
    grouped.get(key).rows.push(item);
  }
  return [...grouped.values()].filter(item => !filtered || item.rows.length);
}

function renderGlobalForwardGroupedList(sourceRows) {
  const byGroup = new Map();
  for (const item of globalForwardGroupedConnections(sourceRows)) {
    const name = String(item.connection.group_name || TERMA_DEFAULT_CONNECTION_GROUP);
    if (!byGroup.has(name)) byGroup.set(name, []);
    byGroup.get(name).push(item);
  }
  const sorting = globalForwardSortingEnabled();
  const dragHint = sorting
    ? tr("connections:forward_manager.drag_hint", {defaultValue:"长按拖动调整顺序"})
    : tr("connections:forward_manager.drag_filtered_hint", {defaultValue:"清除搜索和筛选后可拖动排序"});
  return `<div class="global-forward-grouped-list${sorting ? " is-sortable" : ""}">${[...byGroup.entries()].map(([groupName, items]) => {
    const groupKey = String(groupName);
    const groupCollapsed = globalForwardManagerState.collapsedGroups.has(groupKey);
    const ruleCount = items.reduce((sum, item) => sum + item.rows.length, 0);
    return `<section class="global-forward-group" data-forward-group-name="${encodeURIComponent(groupKey)}">
      <header class="global-forward-group-head">
        <button class="global-forward-drag-handle" type="button" data-pointerdown-action="global-forward-sort-start" data-sort-kind="group" data-group-name="${encodeURIComponent(groupKey)}" title="${escAttr(dragHint)}" aria-label="${escAttr(dragHint)}"${sorting ? "" : " disabled"}>${icon("grip-vertical")}</button>
        <button class="global-forward-tree-toggle" type="button" data-action="global-forward-group-toggle" data-group-name="${encodeURIComponent(groupKey)}" aria-expanded="${!groupCollapsed}">${icon(groupCollapsed ? "chevron-right" : "chevron-down")}<strong>${esc(connectionGroupDisplayName(groupKey))}</strong><span>${esc(tr("connections:forward_manager.group_summary", {servers:items.length, rules:ruleCount, defaultValue:`${items.length} 台服务器 · ${ruleCount} 条转发`}))}</span></button>
      </header>
      <div class="global-forward-group-body"${groupCollapsed ? " hidden" : ""}>${items.map(({connection, rows}) => {
        const connectionKey = String(connection.id);
        const connectionCollapsed = globalForwardManagerState.collapsedConnections.has(connectionKey);
        const runningCount = rows.filter(({forward}) => forward.status === "running").length;
        const addLabel = tr("connections:forward_manager.add_for_server", {name:connection.name, defaultValue:`为 ${connection.name} 新增转发`});
        return `<section class="global-forward-connection" data-connection-id="${Number(connection.id)}" data-group-name="${encodeURIComponent(groupKey)}">
          <header class="global-forward-connection-head">
            <button class="global-forward-drag-handle" type="button" data-pointerdown-action="global-forward-sort-start" data-sort-kind="connection" data-group-name="${encodeURIComponent(groupKey)}" data-connection-id="${Number(connection.id)}" title="${escAttr(dragHint)}" aria-label="${escAttr(dragHint)}"${sorting ? "" : " disabled"}>${icon("grip-vertical")}</button>
            <button class="global-forward-tree-toggle" type="button" data-action="global-forward-connection-toggle" data-connection-id="${Number(connection.id)}" aria-expanded="${!connectionCollapsed}">${icon(connectionCollapsed ? "chevron-right" : "chevron-down")}<span class="global-forward-server-icon">${icon("server")}</span><span class="global-forward-server-copy"><strong>${esc(connection.name)}</strong><small>${esc(connection.ssh_user)}@${esc(connection.ssh_host)}:${Number(connection.ssh_port || 22)}</small></span><span class="global-forward-server-count">${esc(tr("connections:forward_manager.server_summary", {rules:rows.length, running:runningCount, defaultValue:`${rows.length} 条 · ${runningCount} 条运行中`}))}</span></button>
            <button class="global-forward-server-add" type="button" data-action="global-forward-add" data-connection-id="${Number(connection.id)}" title="${escAttr(addLabel)}" aria-label="${escAttr(addLabel)}">${icon("plus")}<span>${esc(tr("connections:forward_manager.add_short", {defaultValue:"新增"}))}</span></button>
          </header>
          <div class="global-forward-connection-body"${connectionCollapsed ? " hidden" : ""}>${rows.length ? rows.sort(compareGlobalForwardRows).map(({connection:rowConnection, forward}) => renderGlobalForwardCard(rowConnection, forward, {grouped:true})).join("") : stateView("empty", tr("connections:forward_manager.server_empty", {defaultValue:"此服务器还没有转发规则"}), tr("connections:forward_manager.server_empty_hint", {defaultValue:"使用服务器标题右侧的新增按钮创建第一条规则。"}))}</div>
        </section>`;
      }).join("")}</div>
    </section>`;
  }).join("")}</div>`;
}

async function saveGlobalForwardConnectionOrder(groupName, ids) {
  await api("/api/connections/reorder", {method:"POST", body:JSON.stringify({group_name:groupName, ids})});
  await loadAll({silent:true});
}

function beginGlobalForwardSortDrag(event, element) {
  if (event.button > 0 || !globalForwardSortingEnabled()) return;
  const kind = element.dataset.sortKind;
  const selector = kind === "group" ? ".global-forward-group" : ".global-forward-connection";
  const node = element.closest(selector);
  const container = node?.parentElement;
  if (!node || !container) return;
  const state = {kind, node, container, pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, active:false, timer:0, groupName:decodeURIComponent(element.dataset.groupName || "")};
  state.timer = setTimeout(() => {
    state.active = true;
    node.classList.add("is-dragging");
    document.body.classList.add("global-forward-sort-active");
    try { element.setPointerCapture(event.pointerId); } catch {}
  }, 220);
  globalForwardSortDrag = state;
  const move = moveEvent => {
    if (globalForwardSortDrag !== state || moveEvent.pointerId !== state.pointerId) return;
    if (!state.active && Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) > 8) return cleanup(false);
    if (!state.active) return;
    moveEvent.preventDefault();
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(selector);
    if (target && target !== node && target.parentElement === container) {
      const rect = target.getBoundingClientRect();
      container.insertBefore(node, moveEvent.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
    }
    const workspace = node.closest(".workspace");
    const rect = workspace?.getBoundingClientRect();
    if (workspace && rect) {
      if (moveEvent.clientY < rect.top + 64) workspace.scrollBy({top:-18});
      else if (moveEvent.clientY > rect.bottom - 64) workspace.scrollBy({top:18});
    }
  };
  const finish = async finishEvent => {
    if (finishEvent.pointerId !== state.pointerId) return;
    const active = state.active;
    cleanup(true);
    if (!active) return;
    try {
      if (kind === "group") {
        const names = [...container.querySelectorAll(":scope > .global-forward-group")].map(item => decodeURIComponent(item.dataset.forwardGroupName || ""));
        await saveConnectionGroupOrder(names);
      } else {
        const ids = [...container.querySelectorAll(":scope > .global-forward-connection")].map(item => Number(item.dataset.connectionId));
        await saveGlobalForwardConnectionOrder(state.groupName, ids);
      }
      notify(tr("connections:forward_manager.order_saved", {defaultValue:"转发列表顺序已保存"}), "success");
    } catch (error) {
      notify(localizedTermaUiPhrase(error.message), "error");
      await loadAll({silent:true}).catch(()=>{});
    }
    renderGlobalForwardManager();
  };
  const cancel = cancelEvent => {
    if (cancelEvent.pointerId !== state.pointerId) return;
    cleanup(true);
    renderGlobalForwardManager();
  };
  const cleanup = reset => {
    clearTimeout(state.timer);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
    if (reset) {
      node.classList.remove("is-dragging");
      document.body.classList.remove("global-forward-sort-active");
    }
    if (globalForwardSortDrag === state) globalForwardSortDrag = null;
  };
  document.addEventListener("pointermove", move, {passive:false});
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}

function renderGlobalForwardManager() {
  const view = $("view-forward-manager");
  if (!view) return;
  const uiState = captureUiState(view);
  const allRows = globalForwardAllRows();
  const rows = globalForwardRows();
  const pagination = globalForwardPagination(rows);
  const visibleRows = pagination.rows;
  const running = allRows.filter(({forward}) => forward.status === "running").length;
  const reconnecting = allRows.filter(({forward}) => forward.status === "reconnecting").length;
  const failed = allRows.filter(({forward}) => forward.status === "failed").length;
  const stopped = allRows.length - running - reconnecting - failed;
  const connectionOptions = [...connections]
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), document.documentElement.lang || "zh-CN", {numeric:true}))
    .map(connection => `<option value="${Number(connection.id)}"${Number(connection.id) === globalForwardManagerState.connectionId ? " selected" : ""}>${esc(connection.name)} · ${esc(connection.ssh_host)}</option>`).join("");
  const statusOptions = globalForwardStatusOptions().map(([value, label]) => `<option value="${escAttr(value)}"${value === globalForwardManagerState.status ? " selected" : ""}>${esc(label)}</option>`).join("");
  const groupModeOptions = [["flat", tr("connections:forward_manager.no_grouping", {defaultValue:"不分组"})], ["ssh", tr("connections:forward_manager.group_by_ssh", {defaultValue:"按 SSH 连接分组"})]]
    .map(([value, label]) => `<option value="${value}"${value === globalForwardManagerState.groupMode ? " selected" : ""}>${esc(label)}</option>`).join("");
  const addLabel = tr("connections:forward_manager.add", {defaultValue:"新增转发"});
  view.innerHTML = `<div class="global-forward-manager">
    <section class="panel global-forward-hero">
      <div class="workspace-head"><div><h2>${esc(tr("connections:forward_manager.title", {defaultValue:"转发列表"}))}</h2><div class="subtitle">${esc(globalForwardManagerSubtitle())}</div></div><div class="actions"><button data-action="global-forward-refresh">${icon("refresh-cw")}<span>${esc(tr("common:auto.refresh", {defaultValue:"刷新"}))}</span></button><button data-action="global-forward-restore">${icon("history")}<span>${esc(tr("connections:auto.restore_forwards", {defaultValue:"恢复转发"}))}</span></button><button class="primary" data-action="global-forward-add">${icon("plus")}<span>${esc(addLabel)}</span></button></div></div>
      <div class="global-forward-stats">
        <button data-action="global-forward-status-shortcut" data-status="all" class="${globalForwardManagerState.status === "all" ? "active" : ""}"><strong>${allRows.length}</strong><span>${esc(tr("connections:forward_manager.total", {defaultValue:"全部"}))}</span></button>
        <button data-action="global-forward-status-shortcut" data-status="running" class="good ${globalForwardManagerState.status === "running" ? "active" : ""}"><strong>${running}</strong><span>${esc(tr("connections:forwards.running", {defaultValue:"运行中"}))}</span></button>
        <button data-action="global-forward-status-shortcut" data-status="reconnecting" class="warning ${globalForwardManagerState.status === "reconnecting" ? "active" : ""}"><strong>${reconnecting}</strong><span>${esc(tr("connections:forwards.reconnecting", {defaultValue:"重连中"}))}</span></button>
        <button data-action="global-forward-status-shortcut" data-status="failed" class="bad ${globalForwardManagerState.status === "failed" ? "active" : ""}"><strong>${failed}</strong><span>${esc(tr("connections:forwards.failed", {defaultValue:"启动失败"}))}</span></button>
        <button data-action="global-forward-status-shortcut" data-status="stopped" class="${globalForwardManagerState.status === "stopped" ? "active" : ""}"><strong>${stopped}</strong><span>${esc(tr("connections:forwards.stopped", {defaultValue:"已停止"}))}</span></button>
      </div>
      <div class="global-forward-toolbar">
        <label class="search-field">${icon("search")}<input value="${escAttr(globalForwardManagerState.query)}" data-input-action="global-forward-search" placeholder="${escAttr(tr("connections:forward_manager.search", {defaultValue:"搜索名称、服务器、端口、路径或备注"}))}" aria-label="${escAttr(tr("connections:forward_manager.search", {defaultValue:"搜索名称、服务器、端口、路径或备注"}))}"></label>
        <select data-change-action="global-forward-status-filter" aria-label="${escAttr(tr("connections:forward_manager.status_filter", {defaultValue:"状态筛选"}))}">${statusOptions}</select>
        <select data-change-action="global-forward-connection-filter" aria-label="${escAttr(tr("connections:forward_manager.server_filter", {defaultValue:"服务器筛选"}))}"><option value="0">${esc(tr("connections:forward_manager.all_servers", {defaultValue:"全部服务器"}))}</option>${connectionOptions}</select>
        <select data-change-action="global-forward-group-mode" aria-label="${escAttr(tr("connections:forward_manager.group_mode", {defaultValue:"分组方式"}))}">${groupModeOptions}</select>
      </div>
    </section>
    <section class="panel global-forward-list-panel">
      <div class="global-forward-list-head"><strong>${esc(tr("connections:forward_manager.results", {count:rows.length, defaultValue:`${rows.length} 条结果`}))}</strong><span>${esc(tr("connections:forward_manager.running_access_hint", {defaultValue:"只有运行中的转发显示访问地址"}))}</span></div>
      ${globalForwardManagerState.groupMode === "ssh"
        ? `${visibleRows.length ? renderGlobalForwardGroupedList(visibleRows) : stateView("empty", tr("connections:forward_manager.empty", {defaultValue:"没有匹配的转发规则"}), tr("connections:forward_manager.empty_hint", {defaultValue:"调整筛选条件，或新增一条转发规则。"}), `<button class="primary" data-action="global-forward-add">${esc(addLabel)}</button>`)}${renderGlobalForwardPagination(pagination)}`
        : `<div class="global-forward-list">${visibleRows.length ? visibleRows.map(({connection, forward}) => renderGlobalForwardCard(connection, forward)).join("") : stateView("empty", tr("connections:forward_manager.empty", {defaultValue:"没有匹配的转发规则"}), tr("connections:forward_manager.empty_hint", {defaultValue:"调整筛选条件，或新增一条转发规则。"}), `<button class="primary" data-action="global-forward-add">${esc(addLabel)}</button>`)}</div>${renderGlobalForwardPagination(pagination)}`}
    </section>
  </div>`;
  refreshIcons();
  restoreUiState(uiState);
  if (globalForwardManagerState.focusId) {
    requestAnimationFrame(() => {
      const card = view.querySelector(`.global-forward-card[data-forward-id="${Number(globalForwardManagerState.focusId)}"]`);
      card?.scrollIntoView({block:"center", behavior:"smooth"});
      if (card) setTimeout(() => card.classList.remove("is-focused"), 1800);
      globalForwardManagerState.focusId = 0;
    });
  }
}

function openGlobalForwardManager(updateTab=true, focusId=0) {
  if (focusId) globalForwardManagerState.focusId = Number(focusId);
  renderGlobalForwardManager();
  const title = tr("connections:forward_manager.title", {defaultValue:"转发列表"});
  setWorkspace(title, globalForwardManagerSubtitle(), "forward-manager", "forward-manager", updateTab, true, {kind:"forward-manager"});
}

function globalForwardEditorValues(forward=null, preferredConnectionId=0) {
  return {
    connection_id:Number(forward?.connection_id || preferredConnectionId || selectedId || connections[0]?.id || 0),
    mode:String(forward?.mode || "local"),
    bind_host:String(forward?.bind_host || "127.0.0.1"),
    bind_port:forward?.bind_port || "",
    target_host:String(forward?.target_host || "127.0.0.1"),
    target_port:forward?.target_port || "",
    service_name:String(forward?.service_name || ""),
    service_type:String(forward?.service_type || ""),
    service_note:String(forward?.service_note || ""),
    url_scheme:String(forward?.url_scheme || ""),
    url_path:String(forward?.url_path || "")
  };
}

function syncGlobalForwardEditorMode() {
  const form = document.getElementById("globalForwardEditorForm");
  if (!form) return;
  const socks = form.elements.mode.value === "socks";
  form.querySelectorAll("[data-forward-target-field]").forEach(element => element.hidden = socks);
}

function openGlobalForwardEditor(forwardId=0, preferredConnectionId=0) {
  const modal = document.getElementById("modal");
  if (!modal) return;
  const forward = forwardId ? currentForward(forwardId) : null;
  if (forwardId && !forward) return notify(tr("connections:forwards.not_found", {defaultValue:"Forwarding rule not found"}), "error");
  const values = globalForwardEditorValues(forward, preferredConnectionId);
  const title = forward ? tr("connections:forward_manager.edit", {defaultValue:"编辑转发"}) : tr("connections:forward_manager.add", {defaultValue:"新增转发"});
  const connectionOptions = connections.map(connection => `<option value="${Number(connection.id)}"${Number(connection.id) === values.connection_id ? " selected" : ""}>${esc(connection.name)} · ${esc(connection.ssh_host)}</option>`).join("");
  modal.dataset.globalForwardEditor = "1";
  modal.innerHTML = `<div class="modal-card global-forward-editor" role="dialog" aria-modal="true" aria-labelledby="globalForwardEditorTitle">
    <header><div><h2 id="globalForwardEditorTitle">${esc(title)}</h2><span>${esc(forward && forwardIsActive(forward) ? tr("connections:forward_manager.running_edit_hint", {defaultValue:"保存后会自动安全重启，失败时恢复旧配置。"}) : tr("connections:forward_manager.editor_hint", {defaultValue:"保存后可直接在转发列表中启动。"}))}</span></div><button class="icon-button" type="button" data-action="global-forward-editor-close" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></header>
    <form id="globalForwardEditorForm" data-submit-action="global-forward-save" data-forward-id="${Number(forwardId || 0)}">
      <div class="grid"><div><label>${esc(tr("common:auto.server", {defaultValue:"服务器"}))}</label><select name="connection_id"${forward ? " disabled" : ""}>${connectionOptions}</select></div><div><label>${esc(tr("connections:auto.forward_type", {defaultValue:"转发类型"}))}</label><select name="mode" data-change-action="global-forward-editor-mode"><option value="local"${values.mode === "local" ? " selected" : ""}>${esc(tr("connections:auto.local_forward", {defaultValue:"本地转发 -L"}))}</option><option value="remote"${values.mode === "remote" ? " selected" : ""}>${esc(tr("connections:auto.remote_forward", {defaultValue:"远程转发 -R"}))}</option><option value="socks"${values.mode === "socks" ? " selected" : ""}>SOCKS5 -D</option></select></div></div>
      <div class="grid3"><div><label>${esc(tr("connections:auto.local_bind_host", {defaultValue:"监听地址"}))}</label><input name="bind_host" value="${escAttr(values.bind_host)}" required></div><div><label>${esc(tr("connections:auto.local_bind_port", {defaultValue:"监听端口"}))}</label><input name="bind_port" type="number" min="1" max="65535" value="${escAttr(values.bind_port)}" required></div><div><label>${esc(tr("connections:auto.access_protocol", {defaultValue:"访问协议"}))}</label><select name="url_scheme"><option value=""${!values.url_scheme ? " selected" : ""}>${esc(tr("common:auto.automatic", {defaultValue:"自动"}))}</option><option value="http"${values.url_scheme === "http" ? " selected" : ""}>http</option><option value="https"${values.url_scheme === "https" ? " selected" : ""}>https</option></select></div></div>
      <div class="grid" data-forward-target-field><div><label>${esc(tr("connections:auto.target_host", {defaultValue:"目标主机"}))}</label><input name="target_host" value="${escAttr(values.target_host)}"></div><div><label>${esc(tr("connections:auto.target_port", {defaultValue:"目标端口"}))}</label><input name="target_port" type="number" min="1" max="65535" value="${escAttr(values.target_port)}"></div></div>
      <div class="grid3"><div><label>${esc(tr("connections:auto.service_name", {defaultValue:"服务名称"}))}</label><input name="service_name" value="${escAttr(values.service_name)}"></div><div><label>${esc(tr("connections:auto.service_type", {defaultValue:"服务类型"}))}</label><select name="service_type"><option value="">${esc(tr("common:auto.automatic", {defaultValue:"自动"}))}</option>${["web","mysql","redis","ssh","socks","other"].map(type => `<option value="${type}"${values.service_type === type ? " selected" : ""}>${esc(serviceTypeText(type))}</option>`).join("")}</select></div><div><label>${esc(tr("connections:auto.note", {defaultValue:"备注"}))}</label><input name="service_note" value="${escAttr(values.service_note)}"></div></div>
      <label>${esc(tr("connections:auto.url_path", {defaultValue:"URL 路径"}))}</label><input name="url_path" maxlength="2048" spellcheck="false" value="${escAttr(values.url_path)}" placeholder="/admin">
      <div class="actions"><button type="button" data-action="global-forward-editor-close">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button class="primary" type="submit">${esc(tr("common:actions.save", {defaultValue:"保存"}))}</button></div>
    </form>
  </div>`;
  modal.hidden = false;
  syncGlobalForwardEditorMode();
  refreshIcons();
}

function closeGlobalForwardEditor() {
  const modal = document.getElementById("modal");
  if (!modal || modal.dataset.globalForwardEditor !== "1") return;
  modal.hidden = true;
  modal.dataset.globalForwardEditor = "";
  modal.innerHTML = "";
}

function globalForwardEditorPayload(form) {
  const mode = String(form.elements.mode.value || "local");
  return {
    mode,
    bind_host:String(form.elements.bind_host.value || "").trim() || "127.0.0.1",
    bind_port:Number(form.elements.bind_port.value),
    target_host:mode === "socks" ? "" : String(form.elements.target_host.value || "").trim() || "127.0.0.1",
    target_port:mode === "socks" ? null : Number(form.elements.target_port.value),
    service_name:String(form.elements.service_name.value || "").trim(),
    service_type:String(form.elements.service_type.value || "").trim(),
    service_note:String(form.elements.service_note.value || "").trim(),
    url_scheme:String(form.elements.url_scheme.value || "").trim(),
    url_path:String(form.elements.url_path.value || "").trim()
  };
}

async function saveGlobalForwardEditor(form) {
  const button = form.querySelector('button[type="submit"]');
  const forwardId = Number(form.dataset.forwardId || 0);
  const existing = forwardId ? currentForward(forwardId) : null;
  const connectionId = Number(existing?.connection_id || form.elements.connection_id?.value || 0);
  if (!connectionId) throw new Error(tr("connections:forwards.select_connection", {defaultValue:"Select a connection first"}));
  setButtonBusy(button, true, tr("common:auto.saving", {defaultValue:"正在保存..."}));
  try {
    const payload = await confirmForwardPortAvailability(globalForwardEditorPayload(form), forwardId, recommended => {
      form.elements.bind_port.value = recommended;
    }, Boolean(existing && forwardIsActive(existing)));
    if (!payload) return;
    let result;
    if (forwardId) result = await api(`/api/forwards/${forwardId}`, {method:"PUT", body:JSON.stringify({...payload, restart_if_running:true})});
    else result = await api(`/api/connections/${connectionId}/forwards`, {method:"POST", body:JSON.stringify(payload)});
    closeGlobalForwardEditor();
    await loadAll();
    openGlobalForwardManager(false, forwardId || Number(result.id || 0));
    notify(forwardId
      ? (result.restarted ? tr("connections:forwards.saved_restarted", {defaultValue:"Forwarding rule saved and restarted"}) : tr("connections:forwards.saved", {defaultValue:"Forwarding rule saved"}))
      : tr("common:notifications.forward_added", {defaultValue:"Forwarding rule added"}), "success");
  } finally {
    setButtonBusy(button, false);
  }
}

async function deleteGlobalForward(id) {
  const forward = currentForward(id);
  if (!forward) return;
  const confirmed = await confirmModal(
    tr("connections:forward_manager.delete_confirm", {name:forwardDisplayName(forward), defaultValue:`删除转发“${forwardDisplayName(forward)}”？正在运行时会先停止。`}),
    tr("connections:forward_manager.delete_title", {defaultValue:"删除转发"}),
    tr("common:actions.delete", {defaultValue:"删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  );
  if (!confirmed) return;
  await api(`/api/forwards/${Number(id)}`, {method:"DELETE"});
  await loadAll();
  renderGlobalForwardManager();
  notify(tr("common:notifications.forward_deleted", {defaultValue:"Forwarding rule deleted"}), "success");
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("global-forward-add", ({element}) => openGlobalForwardEditor(0, Number(element?.dataset.connectionId || 0)));
  registerTermaAction("global-forward-editor-close", () => closeGlobalForwardEditor());
  registerTermaAction("global-forward-editor-mode", () => syncGlobalForwardEditorMode());
  registerTermaAction("global-forward-save", ({event, element}) => { event.preventDefault(); return saveGlobalForwardEditor(element); });
  registerTermaAction("global-forward-refresh", async ({element}) => { setButtonBusy(element, true); try { await loadAll(); renderGlobalForwardManager(); } finally { setButtonBusy(element, false); } });
  registerTermaAction("global-forward-restore", ({element}) => restoreForwards(element));
  registerTermaAction("global-forward-search", ({element}) => { globalForwardManagerState.query = element.value || ""; globalForwardManagerState.page = 1; localStorage.setItem("globalForwardSearch", globalForwardManagerState.query); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-status-filter", ({element}) => { globalForwardManagerState.status = element.value || "all"; globalForwardManagerState.page = 1; localStorage.setItem("globalForwardStatus", globalForwardManagerState.status); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-connection-filter", ({element}) => { globalForwardManagerState.connectionId = Number(element.value || 0); globalForwardManagerState.page = 1; localStorage.setItem("globalForwardConnection", String(globalForwardManagerState.connectionId)); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-group-mode", ({element}) => { globalForwardManagerState.groupMode = element.value === "ssh" ? "ssh" : "flat"; globalForwardManagerState.page = 1; localStorage.setItem("globalForwardGroupMode", globalForwardManagerState.groupMode); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-status-shortcut", ({element}) => { globalForwardManagerState.status = element.dataset.status || "all"; globalForwardManagerState.page = 1; localStorage.setItem("globalForwardStatus", globalForwardManagerState.status); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-page", ({element}) => { globalForwardManagerState.page = Math.max(1, Number(element.dataset.page || 1)); localStorage.setItem("globalForwardPage", String(globalForwardManagerState.page)); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-page-size", ({element}) => { const size = [12,24,48,96].includes(Number(element.value)) ? Number(element.value) : 12; globalForwardManagerState.pageSize = size; globalForwardManagerState.page = 1; localStorage.setItem("globalForwardPageSize", String(size)); localStorage.setItem("globalForwardPage", "1"); renderGlobalForwardManager(); });
  registerTermaAction("global-forward-group-toggle", ({element}) => {
    const name = decodeURIComponent(element.dataset.groupName || "");
    if (globalForwardManagerState.collapsedGroups.has(name)) globalForwardManagerState.collapsedGroups.delete(name);
    else globalForwardManagerState.collapsedGroups.add(name);
    saveGlobalForwardStoredSet("globalForwardCollapsedGroups", globalForwardManagerState.collapsedGroups);
    renderGlobalForwardManager();
  });
  registerTermaAction("global-forward-connection-toggle", ({element}) => {
    const id = String(Number(element.dataset.connectionId || 0));
    if (globalForwardManagerState.collapsedConnections.has(id)) globalForwardManagerState.collapsedConnections.delete(id);
    else globalForwardManagerState.collapsedConnections.add(id);
    saveGlobalForwardStoredSet("globalForwardCollapsedConnections", globalForwardManagerState.collapsedConnections);
    renderGlobalForwardManager();
  });
  registerTermaAction("global-forward-sort-start", ({event, element}) => beginGlobalForwardSortDrag(event, element));
  registerTermaAction("global-forward-copy", ({element}) => copyText(element.dataset.copyText || ""));
  registerTermaAction("global-forward-toggle", async ({element}) => {
    const id = Number(element.dataset.forwardId || 0);
    const forward = currentForward(id);
    if (!forward) return;
    if (forwardIsActive(forward)) await stopSingleForward(id, element);
    else await startSingleForward(id, element);
    renderGlobalForwardManager();
  });
  registerTermaAction("global-forward-edit", ({element}) => openGlobalForwardEditor(Number(element.dataset.forwardId || 0)));
  registerTermaAction("global-forward-delete", ({element}) => deleteGlobalForward(Number(element.dataset.forwardId || 0)));
  registerTermaAction("global-forward-open-connection", ({element}) => {
    const connectionId = Number(element.dataset.connectionId || 0);
    const forwardId = Number(element.dataset.forwardId || 0);
    openForwards(connectionId);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`.forward-card[data-forward-id="${forwardId}"]`)?.scrollIntoView({block:"center", behavior:"smooth"})));
  });
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if (typeof activeView !== "undefined" && activeView === "forward-manager") renderGlobalForwardManager();
  });
}
