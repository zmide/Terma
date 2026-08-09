function grouped(){ return connections.reduce((m,c)=>{(m[c.group_name] ||= []).push(c); return m;},{}); }

function filteredConnections() {
  const q = connectionSearch.trim().toLowerCase();
  if (!q) return connections;
  return connections.filter(c => [
    c.name, c.group_name, c.tags, c.ssh_host, c.ssh_user, c.ssh_port,
    ...(c.forwards || []).flatMap(f => [f.mode, f.bind_host, f.bind_port, f.target_host, f.target_port])
  ].some(value => String(value ?? "").toLowerCase().includes(q)));
}

function setConnectionSearch(value) {
  connectionSearch = value || "";
  localStorage.setItem("connectionSearch", connectionSearch);
  renderConnections();
}

function connectionHasRunningForwards(c){ return (c.forwards||[]).some(f=>f.status==="running"); }

function connectionToggleButton(c){
  const action=connectionHasRunningForwards(c)?"stop":"start";
  const text=action==="start"?"启用转发":"停止转发";
  return `<button class="connection-forward-toggle" type="button" title="${text}" aria-label="${text}" data-action="connection-forward" data-connection-id="${c.id}" data-forward-action="${action}">${icon(action === "start" ? "play" : "square")}<span>${text}</span></button>`;
}

function connectionCompactToggleButton(c){
  const action=connectionHasRunningForwards(c)?"stop":"start";
  const text=action==="start"?"启用转发":"停止转发";
  return `<button class="icon-button connection-forward-toggle${action === "stop" ? " is-running" : ""}" title="${text}" aria-label="${text}" data-action="connection-forward" data-connection-id="${c.id}" data-forward-action="${action}">${icon(action === "start" ? "play" : "square")}</button>`;
}

function showConnectionMenu(event, id) {
  const c = connections.find(item => item.id === id);
  if (!c) return;
  const remoteOpenActions = typeof remoteProfileOpenActionsForSsh === "function" ? remoteProfileOpenActionsForSsh(id) : [];
  showActionMenu(event, [
    {label:"SFTP 文件", icon:"folder-open", run:()=>runAppAction("connection.sftp", {connectionId:id})},
    {label:"服务器仪表盘", icon:"gauge", run:()=>openServerDashboard(id)},
    {label:"健康检查", icon:"activity", run:()=>checkConnectionHealth(id)},
    {label:c.notifications_muted ? "开启命令通知" : "静音命令通知", icon:c.notifications_muted ? "bell" : "bell-off", run:()=>toggleConnectionNotifications(id)},
    {label:c.x11_mode && c.x11_mode !== "off" ? "X11 图形终端（默认已开启）" : "X11 图形终端", icon:"x11", children:()=>x11LaunchActions(id)},
    ...(remoteOpenActions.length ? [
      {label:"打开其他连接…", icon:"external-link", children:()=>remoteOpenActions},
    ] : []),
    {label:"生成其他连接…", icon:"plug-zap", children:()=>remoteProfileFromSshActions(id)},
    {separator:true},
    {label:"复制", icon:"copy", run:()=>duplicateConnection(id)},
    {label:"编辑连接", icon:"pencil", run:()=>editConnection(id)},
    {label:"删除连接", icon:"trash-2", danger:true, run:()=>deleteConnection(id)}
  ]);
}

function showConnectionGroupMenu(event, groupName) {
  const names = orderedConnectionGroupNames();
  const index = names.indexOf(groupName);
  showActionMenu(event, [
    {label:"重命名分组", icon:"pencil", run:()=>renameConnectionGroup(groupName)},
    {separator:true},
    ...(index > 0 ? [{label:"上移分组", icon:"arrow-up", run:()=>moveConnectionGroup(groupName,-1)}] : []),
    ...(index >= 0 && index < names.length - 1 ? [{label:"下移分组", icon:"arrow-down", run:()=>moveConnectionGroup(groupName,1)}] : [])
  ]);
}

function connectionGroupItems(view=primaryView) {
  return view === "remote" ? remoteProfiles : connections;
}

function orderedConnectionGroupNames(view=primaryView) {
  return [...new Set(connectionGroupItems(view).map(item => item.group_name || "默认分组"))];
}

function activeConnectionGroupOpen() {
  return primaryView === "remote" ? remoteGroupOpen : groupOpen;
}

function saveActiveConnectionGroupState() {
  if (primaryView === "remote") saveRemoteGroupState();
  else saveGroupState();
}

async function saveConnectionGroupOrder(names) {
  const allNames = [...new Set([...connections, ...remoteProfiles].map(item => item.group_name || "默认分组"))];
  const mergedNames = [...names, ...allNames.filter(name => !names.includes(name))];
  await api("/api/connection-groups/reorder", {method:"POST", body:JSON.stringify({names:mergedNames})});
  const order = new Map(mergedNames.map((name,index) => [name,index]));
  // The API already defines each group's item order; stable sort only moves whole groups.
  connections.sort((a,b) => (order.get(a.group_name) ?? names.length) - (order.get(b.group_name) ?? names.length));
  remoteProfiles.sort((a,b) => (order.get(a.group_name) ?? names.length) - (order.get(b.group_name) ?? names.length));
  renderConnections();
}

async function moveConnectionGroup(groupName, delta) {
  const names = orderedConnectionGroupNames();
  const index = names.indexOf(groupName);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= names.length) return;
  [names[index], names[target]] = [names[target], names[index]];
  await saveConnectionGroupOrder(names);
}

let connectionGroupDrag = null;
let connectionGroupClickSuppressedUntil = 0;

function toggleConnectionGroupFromHeader(groupName) {
  if (Date.now() < connectionGroupClickSuppressedUntil) return;
  toggleGroupOpen(groupName);
}

function beginConnectionGroupDrag(event, groupName) {
  if ((primaryView === "remote" ? remoteConnectionSearch : connectionSearch) || event.button > 0) return;
  const group = event.currentTarget.closest(".group");
  const originalNames = [...$("connectionGroups").querySelectorAll(".group[data-group-name]")].map(item => decodeURIComponent(item.dataset.groupName));
  const state = {group, groupName, originalNames, pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, active:false, timer:0};
  state.timer = setTimeout(() => {
    state.active = true;
    group.classList.add("group-dragging");
    document.body.classList.add("connection-group-drag-active");
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }, 450);
  connectionGroupDrag = state;
  const move = moveEvent => {
    if (connectionGroupDrag !== state || moveEvent.pointerId !== state.pointerId) return;
    if (!state.active && Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) > 8) {
      clearTimeout(state.timer);
      connectionGroupDrag = null;
      cleanup();
      return;
    }
    if (!state.active) return;
    moveEvent.preventDefault();
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".group");
    if (target && target !== state.group && target.parentElement === state.group.parentElement) {
      const rect = target.getBoundingClientRect();
      target.parentElement.insertBefore(state.group, moveEvent.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
    }
    const tree = $("connectionGroups");
    const rect = tree?.getBoundingClientRect();
    if (tree && rect) {
      if (moveEvent.clientY < rect.top + 40) tree.scrollBy({top:-14});
      else if (moveEvent.clientY > rect.bottom - 40) tree.scrollBy({top:14});
    }
  };
  const finish = async endEvent => {
    if (endEvent.pointerId !== state.pointerId) return;
    clearTimeout(state.timer);
    cleanup();
    if (!state.active) {
      connectionGroupDrag = null;
      if (state.renderPending) renderConnections();
      return;
    }
    state.group.classList.remove("group-dragging");
    document.body.classList.remove("connection-group-drag-active");
    connectionGroupClickSuppressedUntil = Date.now() + 500;
    connectionGroupDrag = null;
    const names = [...$("connectionGroups").querySelectorAll(".group[data-group-name]")].map(item => decodeURIComponent(item.dataset.groupName));
    try {
      await saveConnectionGroupOrder(names);
      notify("分组顺序已保存", "success");
    } catch (error) {
      notify(error.message, "error");
      await loadAll();
    }
  };
  const cancel = cancelEvent => {
    if (cancelEvent.pointerId !== state.pointerId) return;
    clearTimeout(state.timer);
    cleanup();
    state.group.classList.remove("group-dragging");
    document.body.classList.remove("connection-group-drag-active");
    connectionGroupDrag = null;
    const nodes = new Map([...$("connectionGroups").querySelectorAll(".group[data-group-name]")].map(item => [decodeURIComponent(item.dataset.groupName), item]));
    for (const name of state.originalNames) {
      const node = nodes.get(name);
      if (node) $("connectionGroups").appendChild(node);
    }
    if (state.renderPending) renderConnections();
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
  };
  document.addEventListener("pointermove", move, {passive:false});
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}

async function renameConnectionGroup(currentName) {
  const groupSelect = $("conn_group");
  const nextName = await inputModal("重命名分组", "分组名称", currentName);
  if (!nextName || nextName === currentName) return;
  const result = await api("/api/connection-groups/rename", {
    method:"POST",
    body:JSON.stringify({current_name:currentName, new_name:nextName})
  });
  if (groupOpen.delete(currentName)) groupOpen.add(result.group_name);
  if (remoteGroupOpen.delete(currentName)) remoteGroupOpen.add(result.group_name);
  saveGroupState();
  saveRemoteGroupState();
  await loadAll();
  if (groupSelect?.isConnected) {
    const nextValue = groupSelect.value === currentName ? result.group_name : groupSelect.value;
    groupSelect.innerHTML = groupNames(nextValue, "ssh").map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("") + `<option value="__new_group__">新增分组...</option>`;
    groupSelect.value = nextValue;
  }
  notify(`分组已重命名，更新 ${result.updated} 个连接`, "success");
}

function renderConnections(){
  if (connectionGroupDrag) {
    connectionGroupDrag.renderPending = true;
    return;
  }
  if (primaryView === "logs") return renderLogs().catch(e=>notify(e.message,"error"));
  if (primaryView === "running") return renderRunningForwards();
  if (primaryView === "remote") return renderRemoteConnections();
  const uiState = captureUiState($("connectionGroups") || document);
  connectionVirtual.scrollTop = $("connectionGroups")?.scrollTop || connectionVirtual.scrollTop;
  const sshGroups = filteredConnections().reduce((m,c)=>{(m[c.group_name] ||= []).push(c); return m;},{});
  const names = [...new Set([...orderedConnectionGroupNames("connections"), ...Object.keys(sshGroups)])]
    .filter(name => sshGroups[name]?.length);
  const existingIds = new Set(connections.map(c => c.id));
  [...selectedConnectionIds].forEach(id => { if (!existingIds.has(id)) selectedConnectionIds.delete(id); });
  const groupHtml = names.map(g=>{
    const open = groupOpen.has(g);
    return `<div class="group" data-group-name="${encodeURIComponent(g)}">
      <div class="group-head-row connection-group-head-row">
        <span class="connection-group-drag-handle" role="button" tabindex="0" title="长按拖动分组排序" aria-label="长按拖动 ${escAttr(g)} 分组排序" onpointerdown="beginConnectionGroupDrag(event,decodeURIComponent('${encodeURIComponent(g)}'))">${icon("grip-vertical")}</span>
        <button class="group-head" data-action="connection-group-toggle" data-contextmenu-action="connection-group-menu" data-group="${escAttr(encodeURIComponent(g))}"><span class="chev">${open ? "▾" : "▸"}</span><span>${esc(g)}</span><span class="count">${sshGroups[g]?.length || 0}</span></button>
        <button class="icon-button connection-group-menu-button" data-action="connection-group-menu" data-group="${escAttr(encodeURIComponent(g))}" title="分组操作" aria-label="${escAttr(g)} 分组操作">${icon("ellipsis")}</button>
      </div>
      ${open ? renderVirtualConnectionRows(sshGroups[g] || []) : ""}
    </div>`;
  }).join("");
  const emptyHtml = stateView("empty", connectionSearch ? "没有匹配的 SSH 连接" : "暂无 SSH 连接", connectionSearch ? "请调整搜索关键词。" : "添加 SSH 连接后即可打开终端、SFTP、转发和 X11。", connectionSearch ? `<button data-action="connection-search-clear">清除搜索</button>` : `<button class="primary" data-action="connection-new">添加 SSH</button>`);
  $("connectionGroups").innerHTML = renderGroupCreator() + renderConnectionBulkBar() + (groupHtml || emptyHtml);
  restoreUiState(uiState);
  syncConnectionBulkBar();
}

function renderConnectionBulkBar() {
  if (!connectionBulkMode) return "";
  return `<div class="connection-bulk-bar">
    <label class="checkline"><input id="connectionSelectAll" type="checkbox" data-change-action="connection-select-all"><span id="connectionBulkCount">已选 0 项</span></label>
    <div class="actions tight"><button id="connectionBulkEditBtn" data-action="connection-bulk-settings" disabled>${icon("settings-2")}<span>批量设置</span></button><button id="connectionBulkDeleteBtn" class="danger" data-action="connection-bulk-delete" disabled>${icon("trash-2")}<span>删除</span></button></div>
  </div>`;
}

function toggleConnectionBulkMode() {
  connectionBulkMode = !connectionBulkMode;
  selectedConnectionIds.clear();
  if (connectionBulkMode) filteredConnections().forEach(c => groupOpen.add(c.group_name));
  saveGroupState();
  renderExplorerTools();
  renderConnections();
}

function setConnectionSelected(id, checked) {
  if (checked) selectedConnectionIds.add(Number(id));
  else selectedConnectionIds.delete(Number(id));
  syncConnectionBulkBar();
}

function toggleAllConnections(checked) {
  filteredConnections().forEach(c => checked ? selectedConnectionIds.add(c.id) : selectedConnectionIds.delete(c.id));
  renderConnections();
}

function syncConnectionBulkBar() {
  if (!connectionBulkMode) return;
  const visibleIds = filteredConnections().map(c => c.id);
  const selectedVisible = visibleIds.filter(id => selectedConnectionIds.has(id)).length;
  const selectAll = $("connectionSelectAll");
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }
  if ($("connectionBulkCount")) $("connectionBulkCount").textContent = `已选 ${selectedConnectionIds.size} 项`;
  if ($("connectionBulkEditBtn")) $("connectionBulkEditBtn").disabled = !selectedConnectionIds.size;
  if ($("connectionBulkDeleteBtn")) $("connectionBulkDeleteBtn").disabled = !selectedConnectionIds.size;
}

function renderVirtualConnectionRows(items) {
  if (items.length <= 80) return items.map(c=>renderConnectionRow(c)).join("");
  const viewport = $("connectionGroups")?.clientHeight || 600;
  const start = Math.max(0, Math.floor(connectionVirtual.scrollTop / connectionVirtual.rowHeight) - connectionVirtual.buffer);
  const visibleCount = Math.ceil(viewport / connectionVirtual.rowHeight) + connectionVirtual.buffer * 2;
  const end = Math.min(items.length, start + visibleCount);
  const top = start * connectionVirtual.rowHeight;
  const bottom = Math.max(0, (items.length - end) * connectionVirtual.rowHeight);
  return `<div class="virtual-spacer" style="height:${top}px"></div>${items.slice(start,end).map(c=>renderConnectionRow(c)).join("")}<div class="virtual-spacer" style="height:${bottom}px"></div>`;
}

function onConnectionScroll() {
  connectionVirtual.scrollTop = $("connectionGroups")?.scrollTop || 0;
  if (primaryView === "connections") {
    clearTimeout(window.connectionVirtualTimer);
    window.connectionVirtualTimer = setTimeout(renderConnections, 40);
  }
}

function renderGroupCreator() {
  if (!addingGroup) return "";
  return `<div class="panel" style="margin:8px;padding:8px">
    <label style="margin-top:0">新分组</label>
    <div class="upload-line"><input id="newGroupName" placeholder="例如：生产环境"><button data-action="connection-group-add-confirm">确定</button></div>
    <div class="actions"><button data-action="connection-group-add-cancel">取消</button></div>
  </div>`;
}

function confirmAddGroup() {
  const name = $("newGroupName")?.value.trim();
  if (!name) return notify("请输入分组名称", "error");
  pendingGroup = name;
  activeConnectionGroupOpen().add(name);
  saveActiveConnectionGroupState();
  addingGroup = false;
  renderConnections();
  if (primaryView === "remote") {
    pendingGroup = "";
    newRemoteProfile("rdp", name);
  } else newConnection(name);
}

function cancelAddGroup() {
  addingGroup = false;
  renderConnections();
}

const IDENTITY_FILE_UNSAFE_FALLBACK = "私钥已不在安全目录，请编辑连接并导入 Terma 密钥目录或用户 ~/.ssh 顶层。";

function connectionIdentityWarningMessage(connection) {
  if (connection?.identity_file_status !== "unsafe") return "";
  return String(connection.identity_file_message || IDENTITY_FILE_UNSAFE_FALLBACK);
}

function connectionFormIdentityWarning(form) {
  if (form?.dataset?.identityFileStatus !== "unsafe") return "";
  return String(form.dataset.identityFileMessage || IDENTITY_FILE_UNSAFE_FALLBACK);
}

function connectionLegacyIdentityOption(form) {
  if (!connectionFormIdentityWarning(form)) return "";
  return `<option value="" data-legacy-unsafe="1" selected disabled>当前私钥已失效，请重新导入</option>`;
}

function renderConnectionRow(c) {
  const active = c.id === selectedId ? " active" : "";
  const running = connectionHasRunningForwards(c) ? " running" : "";
  const health = healthResults.get(c.id);
  const healthClass = health ? (health.ok ? " ok" : " bad") : "";
  const healthText = health ? health.status : "未检测";
  const identityWarning = connectionIdentityWarningMessage(c);
  const bulkClass = connectionBulkMode ? " bulk-mode" : "";
  const bulkCheck = connectionBulkMode ? `<label class="connection-bulk-check" title="选择 ${escAttr(c.name)}"><input type="checkbox" ${selectedConnectionIds.has(c.id) ? "checked" : ""} data-change-action="connection-select" data-connection-id="${c.id}"><span class="sr-only">选择 ${esc(c.name)}</span></label>` : "";
  return `<div class="conn-row${active}${bulkClass}">
    ${bulkCheck}
    <div class="conn-main"><span class="conn-name conn-name-open" title="双击打开终端" data-dblclick-action="connection-open-terminal" data-connection-id="${c.id}">${esc(c.name)}</span><span class="conn-state"><span class="status-dot${running}"></span>${running ? "运行中" : "已停止"}<span class="health-badge${healthClass}" title="健康状态：${escAttr(healthText)}" aria-label="健康状态：${escAttr(healthText)}">${icon(health?.ok ? "circle-check" : health ? "circle-alert" : "circle-help")}</span></span></div>
    <div class="conn-meta">${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</div>
    ${c.tags ? `<div class="forward-tags">${String(c.tags).split(",").filter(Boolean).map(tag=>`<span>${esc(tag)}</span>`).join("")}</div>` : ""}
    <div class="conn-footer">
      <div class="conn-summary"><span title="${c.forwards.length} 条转发">${icon("route")} ${c.forwards.length}</span>${identityWarning ? `<span class="connection-identity-warning" title="${escAttr(identityWarning)}" aria-label="${escAttr(identityWarning)}">${icon("triangle-alert")} 私钥需重新导入</span>` : ""}</div>
      <div class="conn-actions" aria-label="${escAttr(c.name)} 快捷操作">
        <button class="icon-button conn-primary-action" data-action="connection-open-terminal" data-connection-id="${c.id}" title="打开终端" aria-label="打开终端">${icon("square-terminal")}</button>
        <button class="icon-button" data-action="connection-open-sftp" data-connection-id="${c.id}" title="打开 SFTP" aria-label="打开 SFTP">${icon("folder-open")}</button>
        <button class="icon-button" data-action="connection-open-forwards" data-connection-id="${c.id}" title="管理转发" aria-label="管理转发">${icon("route")}</button>
        ${connectionCompactToggleButton(c)}
        <button class="icon-button connection-favorite${c.favorite ? " active" : ""}" data-action="connection-favorite" data-connection-id="${c.id}" data-favorite="${c.favorite ? 0 : 1}" title="${c.favorite ? "取消收藏" : "收藏连接"}" aria-label="${c.favorite ? "取消收藏" : "收藏连接"}" aria-pressed="${c.favorite ? "true" : "false"}">${icon("star")}</button>
        <button class="icon-button" data-action="connection-menu" data-connection-id="${c.id}" title="更多操作" aria-label="更多操作">${icon("ellipsis")}</button>
      </div>
    </div>
  </div>`;
}

function renderRemoteHostGroups(profiles) {
  const grouped = new Map();
  for (const profile of profiles || []) {
    const key = remoteHostKey(profile);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(profile);
  }
  const keys = [...grouped.keys()];
  const searching = Boolean(String(remoteConnectionSearch || "").trim());
  return keys.map(key => {
    const items = grouped.get(key) || [];
    const first = items[0] || {};
    const encoded = encodeURIComponent(key);
    const open = searching || remoteHostOpen.has(key);
    const label = remoteHostLabel(first);
    return `<div class="remote-host-group" data-remote-host-key="${encoded}">
      <div class="remote-host-head-row">
        <button class="remote-host-head" type="button" data-action="remote-host-toggle" data-host-key="${escAttr(encoded)}" aria-expanded="${open ? "true" : "false"}">
          <span class="chev">${open ? "▾" : "▸"}</span><span class="remote-host-icon">${icon("server")}</span><span class="remote-host-label" title="${escAttr(label)}">${esc(label)}</span><span class="count">${items.length}</span>
        </button>
      </div>
      ${open ? items.map(profile => renderRemoteProfileRow(profile)).join("") : ""}
    </div>`;
  }).join("");
}

function renderRemoteConnections() {
  const uiState = captureUiState($("connectionGroups") || document);
  const visibleProfiles = filteredRemoteProfiles();
  const groups = visibleProfiles.reduce((result,profile)=>{(result[profile.group_name] ||= []).push(profile); return result;},{});
  const names = [...new Set([...orderedConnectionGroupNames("remote"), ...Object.keys(groups)])].filter(name => groups[name]?.length);
  if (localStorage.getItem("openRemoteGroups") === null && names.length) {
    names.forEach(name => remoteGroupOpen.add(name));
    saveRemoteGroupState();
  }
  const groupHtml = names.map(name => {
    const open = remoteGroupOpen.has(name);
    return `<div class="group" data-group-name="${encodeURIComponent(name)}">
      <div class="group-head-row connection-group-head-row">
        <span class="connection-group-drag-handle" role="button" tabindex="0" title="长按拖动分组排序" aria-label="长按拖动 ${escAttr(name)} 分组排序" onpointerdown="beginConnectionGroupDrag(event,decodeURIComponent('${encodeURIComponent(name)}'))">${icon("grip-vertical")}</span>
        <button class="group-head" data-action="connection-group-toggle" data-contextmenu-action="connection-group-menu" data-group="${escAttr(encodeURIComponent(name))}"><span class="chev">${open ? "▾" : "▸"}</span><span>${esc(name)}</span><span class="count">${groups[name]?.length || 0}</span></button>
        <button class="icon-button connection-group-menu-button" data-action="connection-group-menu" data-group="${escAttr(encodeURIComponent(name))}" title="分组操作" aria-label="${escAttr(name)} 分组操作">${icon("ellipsis")}</button>
      </div>
      ${open ? renderRemoteHostGroups(groups[name] || []) : ""}
    </div>`;
  }).join("");
  const emptyHtml = stateView("empty", remoteConnectionSearch ? "没有匹配的其他连接" : "暂无其他连接", remoteConnectionSearch ? "请调整搜索关键词。" : "可以单独添加连接，也可以从 SSH 连接的更多菜单快速生成。", remoteConnectionSearch ? `<button data-action="remote-search-clear">清除搜索</button>` : `<button class="primary" data-action="remote-new">添加其他连接</button>`);
  $("connectionGroups").innerHTML = renderGroupCreator() + (groupHtml || emptyHtml);
  restoreUiState(uiState);
}

async function openConnectionBulkSettings() {
  const count = selectedConnectionIds.size;
  if (!count) return notify("请选择 SSH 连接", "info");
  const info = await api("/api/identity-files/info");
  const groups = groupNames("", "ssh").map(name => `<option value="${escAttr(name)}"></option>`).join("");
  $("modal").hidden = false;
  $("modal").innerHTML = `<div class="modal-card wide connection-bulk-modal">
    <h2>批量设置 SSH 连接</h2>
    <div class="muted">将设置应用到已选的 ${count} 个连接。未勾选的项目保持原值；修改端口或凭据时会停止这些连接的转发。</div>
    <div class="bulk-setting-row"><label class="checkline"><input id="bulkSetGroup" type="checkbox" data-change-action="connection-bulk-field" data-field="Group">修改分组</label><input id="bulkGroup" list="bulkGroupOptions" placeholder="选择或输入分组" disabled><datalist id="bulkGroupOptions">${groups}</datalist></div>
    <div class="bulk-setting-row"><label class="checkline"><input id="bulkSetPort" type="checkbox" data-change-action="connection-bulk-field" data-field="Port">修改端口</label><input id="bulkPort" type="number" min="1" max="65535" value="22" disabled></div>
    <div class="bulk-setting-row credentials"><label class="checkline"><input id="bulkSetAuth" type="checkbox" data-change-action="connection-bulk-field" data-field="Auth">修改登录凭据</label><div id="bulkAuthFields">
      <select id="bulkAuthType" disabled data-change-action="connection-bulk-auth-type"><option value="password">密码</option><option value="key">私钥</option></select>
      <input id="bulkPassword" type="password" autocomplete="new-password" placeholder="输入新 SSH 密码" disabled>
      <select id="bulkIdentity" disabled hidden><option value="">选择私钥</option></select>
    </div></div>
    <div class="actions"><button data-action="connection-modal-close">取消</button><button class="primary" data-action="connection-bulk-apply">应用设置</button></div>
  </div>`;
  $("bulkIdentity").replaceChildren(
    new Option("选择私钥", ""),
    ...(info.items || []).map(item => new Option(`${item.label}${item.source_label ? ` · ${item.source_label}` : ""}`, String(item.path || "")))
  );
  refreshIcons();
}

function toggleConnectionBulkField(name, enabled) {
  if (name === "Auth") {
    $("bulkAuthType").disabled = !enabled;
    toggleConnectionBulkAuthType();
  } else {
    $(`bulk${name}`).disabled = !enabled;
    if (enabled) $(`bulk${name}`).focus();
  }
}

function toggleConnectionBulkAuthType() {
  const enabled = Boolean($("bulkSetAuth")?.checked);
  const password = $("bulkAuthType")?.value === "password";
  const passwordInput = $("bulkPassword");
  passwordInput.hidden = !password;
  $("bulkIdentity").hidden = password;
  passwordInput.disabled = !enabled || !password;
  $("bulkIdentity").disabled = !enabled || password;
  syncPasswordVisibilityControl(passwordInput);
}

async function applyConnectionBulkSettings() {
  const changes = {};
  if ($("bulkSetGroup").checked) changes.group_name = $("bulkGroup").value.trim();
  if ($("bulkSetPort").checked) changes.ssh_port = Number($("bulkPort").value);
  if ($("bulkSetAuth").checked) {
    changes.auth = $("bulkAuthType").value === "password"
      ? {type:"password", password:$("bulkPassword").value}
      : {type:"key", identity_file:$("bulkIdentity").value};
  }
  if (!Object.keys(changes).length) return notify("请至少勾选一项批量设置", "info");
  try {
    const result = await api("/api/connections/bulk-update", {method:"POST", body:JSON.stringify({ids:[...selectedConnectionIds], changes})});
    closeModal();
    selectedConnectionIds.clear();
    await loadAll();
    notify(`已更新 ${result.updated || 0} 个 SSH 连接`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

function bulkDeleteConnections() {
  const ids = [...selectedConnectionIds];
  if (!ids.length) return notify("请选择 SSH 连接", "info");
  $("modal").hidden = false;
  $("modal").innerHTML = `<div class="modal-card"><h2>批量删除 SSH 连接</h2><div class="modal-message">确定删除选中的 ${ids.length} 个 SSH 连接及其全部转发吗？删除前会自动创建配置快照。</div><div class="actions"><button data-action="connection-modal-close">取消</button><button class="danger" data-action="connection-bulk-delete-confirm">确认删除</button></div></div>`;
}

async function performBulkDeleteConnections() {
  const ids = [...selectedConnectionIds];
  closeModal();
  const result = await api("/api/connections/bulk-delete", {method:"POST", body:JSON.stringify({ids})});
  if (ids.includes(selectedId)) selectedId = null;
  selectedConnectionIds.clear();
  await loadAll();
  notify(`已删除 ${result.deleted || ids.length} 个 SSH 连接`, "success");
}

function toggleGroupOpen(group) {
  const openGroups = activeConnectionGroupOpen();
  if (openGroups.has(group)) openGroups.delete(group);
  else openGroups.add(group);
  saveActiveConnectionGroupState();
  renderConnections();
}

function remoteHostKey(profile) {
  const group = String(profile?.group_name || "默认分组").trim() || "默认分组";
  const host = typeof normalizeRemoteHost === "function"
    ? normalizeRemoteHost(profile?.host)
    : String(profile?.host || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "").replace(/^::ffff:/, "");
  if (profile?.protocol === "serial") return JSON.stringify(["serial", group, String(profile?.options?.path || "local").trim().toLowerCase()]);
  return JSON.stringify(["host", group, host || "unknown"]);
}

function remoteHostLabel(profile) {
  if (profile?.protocol === "serial") return String(profile?.options?.path || "本机串口");
  const normalize = typeof normalizeRemoteHost === "function"
    ? normalizeRemoteHost
    : value => String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "").replace(/^::ffff:/, "");
  const host = normalize(profile?.host);
  const sourceId = Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
  const matched = connections.find(connection => Number(connection.id) === sourceId && normalize(connection.ssh_host) === host)
    || connections.find(connection => normalize(connection.ssh_host) === host);
  return String(matched?.name || profile?.host || "").trim() || "未设置主机";
}

function toggleRemoteHostOpen(key) {
  const value = String(key || "");
  if (!value) return;
  if (remoteHostOpen.has(value)) remoteHostOpen.delete(value);
  else remoteHostOpen.add(value);
  saveRemoteHostState();
  renderConnections();
}

function revealRemoteProfile(profile) {
  if (!profile) return;
  remoteGroupOpen.add(profile.group_name || "默认分组");
  remoteHostOpen.add(remoteHostKey(profile));
  saveRemoteGroupState();
  saveRemoteHostState();
}

function addGroup() {
  addingGroup = true;
  renderConnections();
  setTimeout(()=>$("newGroupName")?.focus(), 0);
}

function newConnection(groupName="") {
  if (!requireConfigEncryptionUnlocked("新增 SSH 连接")) return;
  selectedId = null;
  $("view-edit").innerHTML = $("connectionFormTpl").innerHTML;
  refreshIcons();
  setWorkspace("添加 SSH", groupName || pendingGroup ? `分组：${groupName || pendingGroup}` : "新建连接", "edit");
  resetConnectionForm();
  renderGroupOptions(groupName || pendingGroup);
  loadKeys().catch(()=>{});
  wireConnectionForm();
}

async function toggleConnectionFavorite(event, id, favorite) {
  event?.stopPropagation?.();
  await api(`/api/connections/${id}/flags`, {method:"POST", body:JSON.stringify({favorite:Number(favorite), notifications_muted:Number(currentConnection(id)?.notifications_muted || 0)})});
  await loadAll();
}

function noteConnectionUsage(id, action="open") {
  const connection = currentConnection(Number(id));
  if (connection) connection.last_used_at = Date.now();
  void api(`/api/connections/${Number(id)}/usage`, {
    method:"POST",
    body:JSON.stringify({action})
  }).catch(() => {});
}
