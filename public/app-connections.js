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
  return `<button class="connection-forward-toggle" type="button" title="${text}" aria-label="${text}" onclick="connectionForwardAction(${c.id},'${action}',this)">${icon(action === "start" ? "play" : "square")}<span>${text}</span></button>`;
}

function connectionCompactToggleButton(c){
  const action=connectionHasRunningForwards(c)?"stop":"start";
  const text=action==="start"?"启用转发":"停止转发";
  return `<button class="icon-button connection-forward-toggle${action === "stop" ? " is-running" : ""}" title="${text}" aria-label="${text}" onclick="connectionForwardAction(${c.id},'${action}',this)">${icon(action === "start" ? "play" : "square")}</button>`;
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
        <button class="group-head" onclick="toggleConnectionGroupFromHeader(decodeURIComponent('${encodeURIComponent(g)}'))" oncontextmenu="showConnectionGroupMenu(event,decodeURIComponent('${encodeURIComponent(g)}'))"><span class="chev">${open ? "▾" : "▸"}</span><span>${esc(g)}</span><span class="count">${sshGroups[g]?.length || 0}</span></button>
        <button class="icon-button connection-group-menu-button" onclick="showConnectionGroupMenu(event,decodeURIComponent('${encodeURIComponent(g)}'))" title="分组操作" aria-label="${escAttr(g)} 分组操作">${icon("ellipsis")}</button>
      </div>
      ${open ? renderVirtualConnectionRows(sshGroups[g] || []) : ""}
    </div>`;
  }).join("");
  const emptyHtml = stateView("empty", connectionSearch ? "没有匹配的 SSH 连接" : "暂无 SSH 连接", connectionSearch ? "请调整搜索关键词。" : "添加 SSH 连接后即可打开终端、SFTP、转发和 X11。", connectionSearch ? `<button onclick="setConnectionSearch('')">清除搜索</button>` : `<button class="primary" onclick="newConnection()">添加 SSH</button>`);
  $("connectionGroups").innerHTML = renderGroupCreator() + renderConnectionBulkBar() + (groupHtml || emptyHtml);
  restoreUiState(uiState);
  syncConnectionBulkBar();
}

function renderConnectionBulkBar() {
  if (!connectionBulkMode) return "";
  return `<div class="connection-bulk-bar">
    <label class="checkline"><input id="connectionSelectAll" type="checkbox" onchange="toggleAllConnections(this.checked)"><span id="connectionBulkCount">已选 0 项</span></label>
    <div class="actions tight"><button id="connectionBulkEditBtn" onclick="openConnectionBulkSettings()" disabled>${icon("settings-2")}<span>批量设置</span></button><button id="connectionBulkDeleteBtn" class="danger" onclick="bulkDeleteConnections()" disabled>${icon("trash-2")}<span>删除</span></button></div>
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
    <div class="upload-line"><input id="newGroupName" placeholder="例如：生产环境"><button onclick="confirmAddGroup()">确定</button></div>
    <div class="actions"><button onclick="cancelAddGroup()">取消</button></div>
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
  const bulkCheck = connectionBulkMode ? `<label class="connection-bulk-check" title="选择 ${escAttr(c.name)}"><input type="checkbox" ${selectedConnectionIds.has(c.id) ? "checked" : ""} onchange="setConnectionSelected(${c.id},this.checked)"><span class="sr-only">选择 ${esc(c.name)}</span></label>` : "";
  return `<div class="conn-row${active}${bulkClass}">
    ${bulkCheck}
    <div class="conn-main"><span class="conn-name conn-name-open" title="双击打开终端" ondblclick="event.stopPropagation();openTerminal(${c.id})">${esc(c.name)}</span><span class="conn-state"><span class="status-dot${running}"></span>${running ? "运行中" : "已停止"}<span class="health-badge${healthClass}" title="健康状态：${escAttr(healthText)}" aria-label="健康状态：${escAttr(healthText)}">${icon(health?.ok ? "circle-check" : health ? "circle-alert" : "circle-help")}</span></span></div>
    <div class="conn-meta">${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</div>
    ${c.tags ? `<div class="forward-tags">${String(c.tags).split(",").filter(Boolean).map(tag=>`<span>${esc(tag)}</span>`).join("")}</div>` : ""}
    <div class="conn-footer">
      <div class="conn-summary"><span title="${c.forwards.length} 条转发">${icon("route")} ${c.forwards.length}</span>${identityWarning ? `<span class="connection-identity-warning" title="${escAttr(identityWarning)}" aria-label="${escAttr(identityWarning)}">${icon("triangle-alert")} 私钥需重新导入</span>` : ""}</div>
      <div class="conn-actions" aria-label="${escAttr(c.name)} 快捷操作">
        <button class="icon-button conn-primary-action" onclick="openTerminal(${c.id})" title="打开终端" aria-label="打开终端">${icon("square-terminal")}</button>
        <button class="icon-button" onclick="openSftp(${c.id})" title="打开 SFTP" aria-label="打开 SFTP">${icon("folder-open")}</button>
        <button class="icon-button" onclick="openForwards(${c.id})" title="管理转发" aria-label="管理转发">${icon("route")}</button>
        ${connectionCompactToggleButton(c)}
        <button class="icon-button connection-favorite${c.favorite ? " active" : ""}" onclick="toggleConnectionFavorite(event,${c.id},${c.favorite ? 0 : 1})" title="${c.favorite ? "取消收藏" : "收藏连接"}" aria-label="${c.favorite ? "取消收藏" : "收藏连接"}" aria-pressed="${c.favorite ? "true" : "false"}">${icon("star")}</button>
        <button class="icon-button" onclick="showConnectionMenu(event,${c.id})" title="更多操作" aria-label="更多操作">${icon("ellipsis")}</button>
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
        <button class="remote-host-head" type="button" onclick="toggleRemoteHostOpen(decodeURIComponent('${encoded}'))" aria-expanded="${open ? "true" : "false"}">
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
        <button class="group-head" onclick="toggleConnectionGroupFromHeader(decodeURIComponent('${encodeURIComponent(name)}'))" oncontextmenu="showConnectionGroupMenu(event,decodeURIComponent('${encodeURIComponent(name)}'))"><span class="chev">${open ? "▾" : "▸"}</span><span>${esc(name)}</span><span class="count">${groups[name]?.length || 0}</span></button>
        <button class="icon-button connection-group-menu-button" onclick="showConnectionGroupMenu(event,decodeURIComponent('${encodeURIComponent(name)}'))" title="分组操作" aria-label="${escAttr(name)} 分组操作">${icon("ellipsis")}</button>
      </div>
      ${open ? renderRemoteHostGroups(groups[name] || []) : ""}
    </div>`;
  }).join("");
  const emptyHtml = stateView("empty", remoteConnectionSearch ? "没有匹配的其他连接" : "暂无其他连接", remoteConnectionSearch ? "请调整搜索关键词。" : "可以单独添加连接，也可以从 SSH 连接的更多菜单快速生成。", remoteConnectionSearch ? `<button onclick="setRemoteConnectionSearch('')">清除搜索</button>` : `<button class="primary" onclick="newRemoteProfile('rdp')">添加其他连接</button>`);
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
    <div class="bulk-setting-row"><label class="checkline"><input id="bulkSetGroup" type="checkbox" onchange="toggleConnectionBulkField('Group',this.checked)">修改分组</label><input id="bulkGroup" list="bulkGroupOptions" placeholder="选择或输入分组" disabled><datalist id="bulkGroupOptions">${groups}</datalist></div>
    <div class="bulk-setting-row"><label class="checkline"><input id="bulkSetPort" type="checkbox" onchange="toggleConnectionBulkField('Port',this.checked)">修改端口</label><input id="bulkPort" type="number" min="1" max="65535" value="22" disabled></div>
    <div class="bulk-setting-row credentials"><label class="checkline"><input id="bulkSetAuth" type="checkbox" onchange="toggleConnectionBulkField('Auth',this.checked)">修改登录凭据</label><div id="bulkAuthFields">
      <select id="bulkAuthType" disabled onchange="toggleConnectionBulkAuthType()"><option value="password">密码</option><option value="key">私钥</option></select>
      <input id="bulkPassword" type="password" autocomplete="new-password" placeholder="输入新 SSH 密码" disabled>
      <select id="bulkIdentity" disabled hidden><option value="">选择私钥</option></select>
    </div></div>
    <div class="actions"><button onclick="closeModal()">取消</button><button class="primary" onclick="applyConnectionBulkSettings()">应用设置</button></div>
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
  $("modal").innerHTML = `<div class="modal-card"><h2>批量删除 SSH 连接</h2><div class="modal-message">确定删除选中的 ${ids.length} 个 SSH 连接及其全部转发吗？删除前会自动创建配置快照。</div><div class="actions"><button onclick="closeModal()">取消</button><button class="danger" onclick="performBulkDeleteConnections()">确认删除</button></div></div>`;
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

const CONNECTION_TERMINAL_PROFILE_GROUPS = [
  ["shell", "Shell"],
  ["repl", "交互式语言"],
  ["session", "会话工具"],
  ["tool", "交互工具"],
  ["custom", "其他"]
];

function connectionFormField(form, id) {
  if (form?.querySelector) return form.querySelector(`#${CSS.escape(id)}`);
  return $(id);
}

function normalizeConnectionTerminalKind(value) {
  return ["shell", "repl", "session", "tool", "custom"].includes(String(value || "").toLowerCase())
    ? String(value).toLowerCase()
    : "custom";
}

function normalizeConnectionTerminalPlatform(value) {
  const platform = String(value || "").toLowerCase();
  if (["windows", "win32", "win"].includes(platform)) return "windows";
  if (["posix", "linux", "darwin", "macos", "unix", "freebsd"].includes(platform)) return "posix";
  return "auto";
}

function connectionTerminalArgs(value) {
  if (Array.isArray(value)) return value.map(item => String(item ?? "")).filter(Boolean).join(" ");
  return String(value ?? "");
}

function connectionTerminalProfilePath(profile) {
  return String(profile?.path ?? profile?.program_path ?? profile?.executable ?? profile?.command ?? "");
}

function connectionTerminalFormConfig(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  const mode = field("conn_terminal_startup_mode")?.value === "program" ? "program" : "default";
  return {
    terminal_startup_mode:mode,
    terminal_profile_name:field("conn_terminal_profile_name")?.value.trim() || "",
    terminal_profile_kind:normalizeConnectionTerminalKind(field("conn_terminal_profile_kind")?.value),
    terminal_program_path:field("conn_terminal_program_path")?.value.trim() || "",
    terminal_program_args:field("conn_terminal_program_args")?.value.trim() || "",
    terminal_working_directory:field("conn_terminal_working_directory")?.value.trim() || "",
    terminal_program_platform:normalizeConnectionTerminalPlatform(field("conn_terminal_program_platform")?.value)
  };
}

function toggleConnectionTerminalStartup(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  const program = field("conn_terminal_startup_mode")?.value === "program";
  const box = field("connTerminalProgramFields");
  const path = field("conn_terminal_program_path");
  const profileSelect = field("conn_terminal_profile_select");
  if (box) {
    box.hidden = !program;
    box.setAttribute("aria-hidden", String(!program));
  }
  if (path) path.required = program;
  if (profileSelect) {
    if (program && (profileSelect.value === "" || profileSelect.value === "__default__")) {
      if ([...profileSelect.options].some(option => option.value === "__custom__")) {
        profileSelect.value = "__custom__";
        if (!field("conn_terminal_profile_name")?.value.trim()) field("conn_terminal_profile_name").value = "自定义程序";
        if (field("conn_terminal_profile_kind")) field("conn_terminal_profile_kind").value = "custom";
      }
    } else if (!program && [...profileSelect.options].some(option => option.value === "__default__")) {
      profileSelect.value = "__default__";
    }
  }
}

function resetConnectionTerminalProfileSelect(form, saved=false) {
  const select = connectionFormField(form, "conn_terminal_profile_select");
  if (!select) return;
  const config = connectionTerminalFormConfig(form);
  select.replaceChildren();
  if (saved && config.terminal_startup_mode === "program" && config.terminal_program_path) {
    select.add(new Option(`当前已保存：${config.terminal_profile_name || config.terminal_program_path}`, "__current__", true, true));
  } else {
    select.add(new Option("测试 SSH 后显示可用选项", "", true, true));
  }
  select.add(new Option("自定义程序...", "__custom__"));
}

function resetConnectionTerminalStartup(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  if (!field("conn_terminal_startup_mode")) return;
  field("conn_terminal_startup_mode").value = "default";
  field("conn_terminal_profile_name").value = "";
  field("conn_terminal_profile_kind").value = "shell";
  field("conn_terminal_program_path").value = "";
  field("conn_terminal_program_args").value = "";
  field("conn_terminal_working_directory").value = "";
  field("conn_terminal_program_platform").value = "auto";
  resetConnectionTerminalProfileSelect(form);
  const status = field("connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection muted";
    status.textContent = "尚未检测。填写连接信息后点击“测试 SSH”。";
  }
  const summary = field("connTerminalCapabilities");
  if (summary) {
    summary.hidden = true;
    summary.className = "terminal-startup-capabilities";
    summary.replaceChildren();
  }
  form._terminalCapabilities = null;
  form._terminalCapabilitiesChecked = false;
  form._terminalProbeStale = false;
  form._terminalCredentialRevision = 0;
  toggleConnectionTerminalStartup(form);
}

function fillConnectionTerminalStartup(form, connection={}) {
  const field = id => connectionFormField(form, id);
  if (!field("conn_terminal_startup_mode")) return;
  const mode = connection.terminal_startup_mode === "program" || connection.terminal_program_path ? "program" : "default";
  field("conn_terminal_startup_mode").value = mode;
  field("conn_terminal_profile_name").value = connection.terminal_profile_name || "";
  field("conn_terminal_profile_kind").value = normalizeConnectionTerminalKind(connection.terminal_profile_kind || (mode === "program" ? "custom" : "shell"));
  field("conn_terminal_program_path").value = connection.terminal_program_path || "";
  field("conn_terminal_program_args").value = connection.terminal_program_args || "";
  field("conn_terminal_working_directory").value = connection.terminal_working_directory || "";
  field("conn_terminal_program_platform").value = normalizeConnectionTerminalPlatform(connection.terminal_program_platform);
  resetConnectionTerminalProfileSelect(form, true);
  const status = field("connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection muted";
    status.textContent = mode === "program"
      ? "已加载保存的启动配置。测试 SSH 可刷新这台机器的可用选项。"
      : "当前使用服务器默认登录 Shell。测试 SSH 可检测更多可用选项。";
  }
  form._terminalCapabilities = null;
  form._terminalCapabilitiesChecked = false;
  form._terminalProbeStale = false;
  form._terminalCredentialRevision = 0;
  toggleConnectionTerminalStartup(form);
}

function connectionTerminalCapabilityProfiles(raw={}) {
  const direct = Array.isArray(raw.profiles) ? raw.profiles : Array.isArray(raw.terminal_profiles) ? raw.terminal_profiles : [];
  const combined = direct.length ? direct : [
    ...(Array.isArray(raw.shells) ? raw.shells.map(item => typeof item === "object" ? {...item, kind:item.kind || "shell"} : {label:String(item), path:String(item), kind:"shell"}) : []),
    ...(Array.isArray(raw.repls) ? raw.repls.map(item => typeof item === "object" ? {...item, kind:item.kind || "repl"} : {label:String(item), path:String(item), kind:"repl"}) : []),
    ...(Array.isArray(raw.session_tools) ? raw.session_tools.map(item => typeof item === "object" ? {...item, kind:item.kind || "session"} : {label:String(item), path:String(item), kind:"session"}) : []),
    ...(Array.isArray(raw.interactive_tools) ? raw.interactive_tools.map(item => typeof item === "object" ? {...item, kind:item.kind || "tool"} : {label:String(item), path:String(item), kind:"tool"}) : [])
  ];
  return combined
    .map((profile, index) => {
      const item = typeof profile === "object" && profile ? profile : {path:String(profile || "")};
      const path = connectionTerminalProfilePath(item);
      if (!path) return null;
      return {
        ...item,
        _index:index,
        label:String(item.label || item.name || path),
        name:String(item.name || item.label || path),
        path,
        args:connectionTerminalArgs(item.args ?? item.program_args),
        kind:normalizeConnectionTerminalKind(item.kind || item.type),
        platform:normalizeConnectionTerminalPlatform(item.platform || raw.platform),
        working_directory:String(item.working_directory ?? item.cwd ?? "")
      };
    })
    .filter(Boolean);
}

function normalizeConnectionTerminalCapabilities(raw={}) {
  const defaultValue = raw.default_shell ?? raw.login_shell ?? null;
  const defaultShell = typeof defaultValue === "string"
    ? {name:defaultValue.split(/[\\/]/).pop() || defaultValue, label:defaultValue.split(/[\\/]/).pop() || defaultValue, path:defaultValue}
    : defaultValue && typeof defaultValue === "object"
      ? {
          ...defaultValue,
          name:String(defaultValue.name || defaultValue.label || connectionTerminalProfilePath(defaultValue)),
          label:String(defaultValue.label || defaultValue.name || connectionTerminalProfilePath(defaultValue)),
          path:connectionTerminalProfilePath(defaultValue)
        }
      : null;
  const tools = (Array.isArray(raw.tools) ? raw.tools : [])
    .map(item => typeof item === "object" && item
      ? {label:String(item.label || item.name || item.id || item.path || ""), path:String(item.path || ""), version:String(item.version || "")}
      : {label:String(item || ""), path:"", version:""})
    .filter(item => item.label);
  return {
    platform:String(raw.platform || "unknown").toLowerCase(),
    platform_label:String(raw.platform_label || raw.os_label || raw.platform || "未知平台"),
    default_shell:defaultShell,
    profiles:connectionTerminalCapabilityProfiles(raw),
    tools,
    warnings:(Array.isArray(raw.warnings) ? raw.warnings : raw.warning ? [raw.warning] : []).map(String).filter(Boolean)
  };
}

function appendConnectionTerminalCapabilityChip(parent, text, title="") {
  const chip = document.createElement("span");
  chip.className = "terminal-startup-chip";
  chip.textContent = text;
  if (title) chip.title = title;
  parent.appendChild(chip);
}

function renderConnectionTerminalCapabilitySummary(form, capabilities) {
  const box = connectionFormField(form, "connTerminalCapabilities");
  if (!box) return;
  box.replaceChildren();
  box.hidden = false;
  box.className = "terminal-startup-capabilities";

  const heading = document.createElement("div");
  heading.className = "terminal-startup-capability-heading";
  const defaultShell = capabilities.default_shell;
  const shellText = defaultShell?.path || defaultShell?.label || "未识别";
  heading.textContent = `${capabilities.platform_label} · 默认 Shell：${shellText}`;
  box.appendChild(heading);

  if (capabilities.profiles.length) {
    const row = document.createElement("div");
    row.className = "terminal-startup-capability-row";
    const label = document.createElement("strong");
    label.textContent = "可启动";
    row.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "terminal-startup-chips";
    capabilities.profiles.forEach(profile => appendConnectionTerminalCapabilityChip(chips, profile.label, `${profile.path}${profile.args ? ` ${profile.args}` : ""}`));
    row.appendChild(chips);
    box.appendChild(row);
  }

  if (capabilities.tools.length) {
    const row = document.createElement("div");
    row.className = "terminal-startup-capability-row";
    const label = document.createElement("strong");
    label.textContent = "已安装工具";
    row.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "terminal-startup-chips";
    capabilities.tools.forEach(tool => appendConnectionTerminalCapabilityChip(chips, `${tool.label}${tool.version ? ` ${tool.version}` : ""}`, tool.path));
    row.appendChild(chips);
    box.appendChild(row);
  }

  capabilities.warnings.forEach(text => {
    const warning = document.createElement("div");
    warning.className = "terminal-startup-capability-warning";
    warning.textContent = text;
    box.appendChild(warning);
  });
}

function renderConnectionTerminalProfiles(form, rawCapabilities) {
  const capabilities = normalizeConnectionTerminalCapabilities(rawCapabilities);
  const select = connectionFormField(form, "conn_terminal_profile_select");
  const config = connectionTerminalFormConfig(form);
  form._terminalCapabilities = capabilities;
  form._terminalCapabilitiesChecked = true;
  form._terminalProbeStale = false;
  if (!select) return capabilities;

  select.replaceChildren();
  const defaultShell = capabilities.default_shell;
  const defaultLabel = defaultShell?.label || defaultShell?.name || defaultShell?.path;
  select.add(new Option(defaultLabel ? `自动使用默认 Shell（${defaultLabel}）` : "自动使用服务器默认登录 Shell", "__default__"));

  const profileIndex = new Map(capabilities.profiles.map((profile,index) => [profile, index]));
  for (const [kind, label] of CONNECTION_TERMINAL_PROFILE_GROUPS) {
    const profiles = capabilities.profiles.filter(profile => profile.kind === kind);
    if (!profiles.length) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    profiles.forEach(profile => group.appendChild(new Option(
      `${profile.label}${profile.args ? ` · ${profile.args}` : ""}`,
      `profile:${profileIndex.get(profile)}`
    )));
    select.appendChild(group);
  }
  select.add(new Option("自定义程序...", "__custom__"));

  if (config.terminal_startup_mode === "default") {
    select.value = "__default__";
  } else {
    const matchIndex = capabilities.profiles.findIndex(profile =>
      profile.path === config.terminal_program_path
      && profile.args === config.terminal_program_args
    );
    if (matchIndex >= 0) {
      select.value = `profile:${matchIndex}`;
    } else {
      const current = new Option(`当前配置：${config.terminal_profile_name || config.terminal_program_path}`, "__current__", true, true);
      select.insertBefore(current, select.firstChild);
    }
  }
  renderConnectionTerminalCapabilitySummary(form, capabilities);
  return capabilities;
}

function applyConnectionTerminalProfile(value, select=null) {
  const form = select?.closest?.("form") || $("connectionForm");
  const field = id => connectionFormField(form, id);
  if (!form || !field("conn_terminal_startup_mode") || value === "" || value === "__current__") return;
  if (value === "__default__") {
    field("conn_terminal_startup_mode").value = "default";
    toggleConnectionTerminalStartup(form);
    return;
  }
  if (value === "__custom__") {
    field("conn_terminal_startup_mode").value = "program";
    if (!field("conn_terminal_profile_name").value.trim()) field("conn_terminal_profile_name").value = "自定义程序";
    field("conn_terminal_profile_kind").value = "custom";
    toggleConnectionTerminalStartup(form);
    setTimeout(() => field("conn_terminal_program_path")?.focus(), 0);
    return;
  }
  const index = Number(String(value).replace(/^profile:/, ""));
  const profile = form._terminalCapabilities?.profiles?.[index];
  if (!profile) return;
  field("conn_terminal_startup_mode").value = "program";
  field("conn_terminal_profile_name").value = profile.name || profile.label || "";
  field("conn_terminal_profile_kind").value = normalizeConnectionTerminalKind(profile.kind);
  field("conn_terminal_program_path").value = profile.path;
  field("conn_terminal_program_args").value = profile.args || "";
  field("conn_terminal_working_directory").value = profile.working_directory || "";
  field("conn_terminal_program_platform").value = normalizeConnectionTerminalPlatform(profile.platform);
  toggleConnectionTerminalStartup(form);
}

function markConnectionTerminalDetectionStale(form=$("connectionForm")) {
  if (!form?._terminalCapabilitiesChecked || form._terminalProbeStale) return;
  form._terminalProbeStale = true;
  const status = connectionFormField(form, "connTerminalDetectionStatus");
  if (status) {
    status.className = "terminal-startup-detection stale";
    status.textContent = "连接信息已变化，下面的检测结果可能已过期。请重新测试 SSH。";
  }
  connectionFormField(form, "connTerminalCapabilities")?.classList.add("is-stale");
}

function connectionExtraArgsValidationPayload(form=$("connectionForm")) {
  const field = id => connectionFormField(form, id);
  return {
    extra_args:field("conn_extra")?.value || "",
    connect_timeout_seconds:Number(field("conn_connect_timeout")?.value || 10),
    keepalive_interval_seconds:Number(field("conn_keepalive_interval")?.value ?? 60),
    keepalive_count_max:Number(field("conn_keepalive_count")?.value || 3),
    tcp_keepalive:Number(field("conn_tcp_keepalive")?.value ?? 1)
  };
}

function focusConnectionExtraArgsIssue(form, issue) {
  const editor = connectionFormField(form, "conn_extra");
  if (!editor) return;
  editor.focus({preventScroll:true});
  const start = Math.max(0, Math.min(editor.value.length, Number(issue?.start || 0)));
  const end = Math.max(start, Math.min(editor.value.length, Number(issue?.end ?? start)));
  try { editor.setSelectionRange(start, end); } catch {}
  editor.scrollIntoView({block:"center", behavior:"smooth"});
}

function renderConnectionExtraArgsDiagnostics(form=$("connectionForm"), issues=[]) {
  const editor = connectionFormField(form, "conn_extra");
  const box = connectionFormField(form, "connExtraDiagnostics");
  if (!editor || !box) return;
  const items = Array.isArray(issues) ? issues : [];
  const errors = items.filter(item => item?.severity === "error");
  form._extraArgsIssues = items;
  editor.setAttribute("aria-invalid", errors.length ? "true" : "false");
  editor.classList.toggle("has-validation-error", Boolean(errors.length));
  if (!items.length) {
    box.hidden = true;
    box.className = "ssh-extra-diagnostics";
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.className = `ssh-extra-diagnostics ${errors.length ? "has-errors" : "has-warnings"}`;
  const heading = document.createElement("div");
  heading.className = "ssh-extra-diagnostics-head";
  heading.innerHTML = `<strong>${errors.length ? `${errors.length} 处需要修正` : `${items.length} 条参数提醒`}</strong><span>点击下面条目可定位到对应行</span>`;
  box.replaceChildren(heading);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ssh-extra-issue ${item.severity === "warning" ? "warning" : "error"}`;
    const label = item.option || item.token || "附加参数";
    button.innerHTML = `<span class="ssh-extra-issue-title">${icon(item.severity === "warning" ? "triangle-alert" : "circle-alert")}<b>第 ${Number(item.line || 1)} 行 · ${esc(label)}</b></span><span>${esc(item.message || "参数无效")}</span>${item.suggestion ? `<small>${esc(item.suggestion)}</small>` : ""}`;
    button.addEventListener("click", () => focusConnectionExtraArgsIssue(form, item));
    box.appendChild(button);
  }
}

async function validateConnectionExtraArgs(form=$("connectionForm")) {
  if (!form?.isConnected) return {ok:true, args:[], issues:[]};
  clearTimeout(form._extraArgsValidationTimer);
  const requestId = Number(form._extraArgsValidationRequestId || 0) + 1;
  form._extraArgsValidationRequestId = requestId;
  const payload = connectionExtraArgsValidationPayload(form);
  if (!String(payload.extra_args || "").trim()) {
    const result = {ok:true, args:[], issues:[]};
    renderConnectionExtraArgsDiagnostics(form, result.issues);
    return result;
  }
  try {
    const result = await api("/api/ssh/extra-args/validate", {method:"POST", body:JSON.stringify(payload)});
    if (!form.isConnected || form._extraArgsValidationRequestId !== requestId) return result;
    renderConnectionExtraArgsDiagnostics(form, result.issues);
    return result;
  } catch (error) {
    if (Array.isArray(error?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, error.details.issues);
    throw error;
  }
}

function scheduleConnectionExtraArgsValidation(form=$("connectionForm"), delay=180) {
  if (!form) return;
  clearTimeout(form._extraArgsValidationTimer);
  form._extraArgsValidationTimer = setTimeout(() => validateConnectionExtraArgs(form).catch(() => {}), delay);
}

async function ensureConnectionExtraArgsValid(form=$("connectionForm")) {
  const result = await validateConnectionExtraArgs(form);
  const firstError = result?.issues?.find(item => item?.severity === "error");
  if (!firstError) return true;
  focusConnectionExtraArgsIssue(form, firstError);
  notify(`SSH 附加参数第 ${firstError.line || 1} 行需要修正`, "error");
  return false;
}

function connPayload(form=$("connectionForm"), validateStartup=false) {
  const field = id => connectionFormField(form, id);
  const groupValue = field("conn_group").value;
  const passwordAuth = field("conn_auth_type").value === "password";
  const selectedKey = field("conn_key");
  if (!passwordAuth && selectedKey?.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1") {
    throw new Error(connectionFormIdentityWarning(form) || IDENTITY_FILE_UNSAFE_FALLBACK);
  }
  const startup = connectionTerminalFormConfig(form);
  if (validateStartup && startup.terminal_startup_mode === "program" && !startup.terminal_program_path) {
    throw new Error("请填写要在远端启动的程序完整路径");
  }
  return {
    id:field("conn_id").value,
    name:field("conn_name").value.trim(),
    group_name:(groupValue === "__new_group__" ? pendingGroup : groupValue).trim()||"默认分组",
    ssh_user:field("conn_user").value.trim(),
    ssh_host:field("conn_host").value.trim(),
    ssh_port:Number(field("conn_port").value||22),
    sort_order:Number(field("conn_sort_order").value||1),
    auth_type:passwordAuth ? "password" : "key",
    identity_file:passwordAuth ? "" : field("conn_key").value,
    ssh_password:passwordAuth ? field("conn_password").value : "",
    private_key_passphrase:passwordAuth ? "" : field("conn_key_passphrase")?.value || "",
    clear_private_key_passphrase:Boolean(field("conn_clear_key_passphrase")?.checked),
    ssh_agent_mode:passwordAuth ? "off" : field("conn_agent_mode")?.value || "auto",
    jump_connection_id:Number(field("conn_jump")?.value || 0) || null,
    connect_timeout_seconds:Number(field("conn_connect_timeout")?.value || 10),
    keepalive_interval_seconds:Number(field("conn_keepalive_interval")?.value ?? 60),
    keepalive_count_max:Number(field("conn_keepalive_count")?.value || 3),
    tcp_keepalive:Number(field("conn_tcp_keepalive")?.value ?? 1),
    x11_mode:field("conn_x11_mode")?.value || "off",
    tags:field("conn_tags").value.trim(),
    autostart_forwards:Number(field("conn_autostart").value),
    extra_args:field("conn_extra").value.trim(),
    ...startup
  };
}

function renderJumpConnectionOptions(selected="", currentId=0) {
  const select = $("conn_jump");
  if (!select) return;
  const items = connections.filter(item => Number(item.id) !== Number(currentId) && !item.jump_connection_id);
  select.replaceChildren(
    new Option("直接连接", ""),
    ...items.map(item => new Option(`${item.name} · ${item.ssh_user}@${item.ssh_host}:${item.ssh_port}`, String(item.id)))
  );
  select.value = selected ? String(selected) : "";
}

function toggleAuthFields() {
  const password = $("conn_auth_type")?.value === "password";
  const keyBox = $("keyAuthBox");
  const passwordBox = $("passwordAuthBox");
  if (keyBox) {
    keyBox.hidden = password;
    keyBox.setAttribute("aria-hidden", String(password));
    keyBox.querySelectorAll("input, select, button").forEach(control => { control.disabled = password; });
  }
  if (passwordBox) {
    passwordBox.hidden = !password;
    passwordBox.setAttribute("aria-hidden", String(!password));
    passwordBox.querySelectorAll("input, select, button").forEach(control => { control.disabled = !password; });
  }
  const x11 = $("conn_x11_mode");
  if (x11) x11.title = password
    ? "X11 图形转发由内置 SSH 使用已保存密码建立"
    : "X11 图形转发默认由内置 SSH 建立，必要时安全回退系统 OpenSSH";
}

function groupNames(extra="", kind="all") {
  const items = kind === "ssh" ? connections : kind === "remote" ? remoteProfiles : [...connections, ...remoteProfiles];
  const names = new Set(items.map(c => c.group_name || "默认分组"));
  names.add("默认分组");
  if (extra) names.add(extra);
  return [...names];
}

function renderGroupOptions(selected="") {
  if (!$("conn_group")) return;
  const value = selected || pendingGroup || "默认分组";
  $("conn_group").innerHTML = groupNames(value, "ssh").map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("") + `<option value="__new_group__">新增分组...</option>`;
  $("conn_group").value = value;
  pendingGroupSelectValue = value;
  $("conn_group").onchange = handleGroupSelectChange;
}

function handleGroupSelectChange() {
  if ($("conn_group").value !== "__new_group__") return;
  $("conn_group").value = pendingGroupSelectValue || "默认分组";
  openGroupModal((name) => {
    pendingGroup = name;
    groupOpen.add(pendingGroup);
    saveGroupState();
    renderGroupOptions(pendingGroup);
  });
}

function openGroupModal(onSave) {
  $("modal").hidden = false;
  $("modal").innerHTML = `<div class="modal-card">
    <h2>新增分组</h2>
    <label>分组名称</label>
    <input id="modalGroupName" placeholder="例如：生产环境">
    <div class="actions">
      <button class="primary" onclick="saveGroupModal()">保存</button>
      <button onclick="closeModal()">取消</button>
    </div>
  </div>`;
  window.pendingGroupModalSave = onSave;
  setTimeout(()=>$("modalGroupName")?.focus(), 0);
}

function saveGroupModal() {
  const name = $("modalGroupName")?.value.trim();
  if (!name) return notify("请输入分组名称", "error");
  const save = window.pendingGroupModalSave;
  closeModal();
  if (save) save(name);
}

function closeModal() {
  $("modal").hidden = true;
  $("modal").innerHTML = "";
  window.pendingGroupModalSave = null;
}

function resetConnectionForm(){
  if (!$("connectionForm")) return;
  $("connectionForm").reset();
  $("conn_id").value="";
  renderGroupOptions(pendingGroup || "默认分组");
  $("conn_port").value=22;
  $("conn_sort_order").value=1;
  $("conn_auth_type").value="key";
  $("conn_password").value="";
  if ($("conn_key_passphrase")) $("conn_key_passphrase").value="";
  if ($("conn_agent_mode")) $("conn_agent_mode").value="auto";
  if ($("conn_clear_key_passphrase")) $("conn_clear_key_passphrase").checked=false;
  if ($("connClearPassphraseLine")) $("connClearPassphraseLine").hidden=true;
  if ($("conn_connect_timeout")) $("conn_connect_timeout").value="10";
  if ($("conn_keepalive_interval")) $("conn_keepalive_interval").value="60";
  if ($("conn_keepalive_count")) $("conn_keepalive_count").value="3";
  if ($("conn_tcp_keepalive")) $("conn_tcp_keepalive").value="1";
  if ($("conn_x11_mode")) $("conn_x11_mode").value="off";
  if ($("conn_remote_generation")) $("conn_remote_generation").value="";
  if ($("connRemoteGenerationLine")) $("connRemoteGenerationLine").hidden=false;
  renderJumpConnectionOptions();
  $("conn_tags").value="";
  $("conn_autostart").value="0";
  if ($("connTestStatus")) {
    $("connTestStatus").hidden = true;
    $("connTestStatus").textContent = "";
    $("connTestStatus").className = "connection-test-status";
  }
  $("conn_extra").value="";
  renderConnectionExtraArgsDiagnostics($("connectionForm"), []);
  resetConnectionTerminalStartup($("connectionForm"));
  toggleAuthFields();
}

function wireConnectionForm() {
  const form = $("connectionForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    await saveConnectionForm(false, e.submitter);
  });
  form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0);
  form.addEventListener("input", event => {
    if (!event.target.matches("#conn_host,#conn_port,#conn_user,#conn_password,#conn_key_passphrase,#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count")) return;
    form._terminalCredentialRevision += 1;
    markConnectionTerminalDetectionStale(form);
    if (event.target.matches("#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count")) scheduleConnectionExtraArgsValidation(form);
  });
  form.addEventListener("change", event => {
    if (!event.target.matches("#conn_host,#conn_port,#conn_user,#conn_auth_type,#conn_key,#conn_agent_mode,#conn_jump,#conn_extra,#conn_tcp_keepalive")) return;
    form._terminalCredentialRevision += 1;
    markConnectionTerminalDetectionStale(form);
    if (event.target.matches("#conn_extra,#conn_tcp_keepalive")) scheduleConnectionExtraArgsValidation(form, 0);
  });
}

async function saveConnectionForm(clearAfterSave=false, trigger=null) {
  if (!requireConfigEncryptionUnlocked("保存 SSH 连接")) return;
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const form = $("connectionForm");
  if (!form || form.dataset.saving === "1") return;
  form.dataset.saving = "1";
  if (trigger) setButtonBusy(trigger, true, "保存中...");
  try {
    if (!await ensureConnectionExtraArgsValid(form)) return;
    const p=connPayload(form, true);
    const generation = !p.id ? String($("conn_remote_generation")?.value || "") : "";
    let generated = null;
    if(p.id) await api(`/api/connections/${p.id}`,{method:"PUT",body:JSON.stringify(p)});
    else {
      const saved = await api("/api/connections",{method:"POST",body:JSON.stringify(p)});
      if (generation && saved?.id) {
        try {
          generated = await api(`/api/connections/${saved.id}/remote-profiles`, {
            method:"POST",
            body:JSON.stringify({protocol:generation})
          });
        } catch (generationError) {
          notify(`SSH 已保存，但其他连接生成失败：${generationError.message}`, "error");
        }
      }
    }
    pendingGroup = "";
    groupOpen.add(p.group_name);
    saveGroupState();
    await loadAll();
    if (clearAfterSave && !p.id) {
      let keyLoad = Promise.resolve();
      inPane(() => {
        resetConnectionForm();
        keyLoad = loadKeys().catch(()=>{});
        $("conn_name")?.focus();
      });
      await keyLoad;
      const generatedCount = generation === "all" ? Number(generated?.created_count || 0) : generated ? 1 : 0;
      notify(`连接已保存${generatedCount ? `，并生成 ${generatedCount} 个其他连接` : ""}，表单已清空`,"success");
    } else {
      const generatedCount = generation === "all" ? Number(generated?.created_count || 0) : generated ? 1 : 0;
      notify(`连接已保存${generatedCount ? `，并生成 ${generatedCount} 个其他连接` : ""}`,"success");
    }
  } catch(err){
    if (Array.isArray(err?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, err.details.issues);
    notify(err.message,"error");
  }
  finally {
    delete form.dataset.saving;
    if (trigger) setButtonBusy(trigger, false);
  }
}

async function loadKeys(selected, select=$("conn_key")) {
  if (!select) return;
  const root = select.closest("#view-edit") || select.form || document;
  const keys = await api("/api/identity-files");
  if (!select.isConnected) return;
  const current = selected ?? select.value;
  const currentAllowed = Boolean(current) && keys.some(k => String(k.path || "") === String(current));
  const previousWasLegacy = select.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1";
  const showLegacy = Boolean(connectionFormIdentityWarning(select.form))
    && !currentAllowed
    && (selected !== undefined ? Boolean(current) : previousWasLegacy);
  select.innerHTML = `${showLegacy ? connectionLegacyIdentityOption(select.form) : ""}<option value="">不使用私钥</option>` + keys.map(k=>`<option value="${esc(k.path)}">${esc(k.label)}${k.permission_ok ? "" : "（需检查权限）"}</option>`).join("");
  if (currentAllowed) select.value = current;
  renderKeyStatus(select, root.querySelector?.("#keyStatus"));
}

async function uploadOneKey(file){
  const form = new FormData();
  form.append("key", file);
  const res = await fetch("/api/identity-files", {method:"POST", body:form});
  const data = await res.json();
  if(!res.ok) throw new Error(data.error||res.statusText);
  return data;
}

async function uploadKey(){
  const f=$("key_upload").files[0];
  const select = $("conn_key");
  if(!f) return notify("请选择密钥文件","error");
  const data=await uploadOneKey(f);
  await loadKeys(data.path, select);
  const form = select?.closest?.("form");
  if (form) {
    form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0) + 1;
    markConnectionTerminalDetectionStale(form);
  }
  notify("密钥已上传","success");
}

async function renderKeyStatus(select=$("conn_key"), box=$("keyStatus")) {
  if (!box) return;
  if (select?.selectedOptions?.[0]?.dataset?.legacyUnsafe === "1") {
    box.textContent = connectionFormIdentityWarning(select.form) || IDENTITY_FILE_UNSAFE_FALLBACK;
    box.className = "key-status warning";
    return;
  }
  const key = select?.value || "";
  if (!key) {
    box.textContent = "未选择私钥";
    box.className = "key-status muted";
    return;
  }
  try {
    const status = await api("/api/identity-files/check", {method:"POST", body:JSON.stringify({path:key})});
    box.textContent = status.ok ? `权限正常：${status.label}` : `需要修复权限：${status.details}`;
    box.className = `key-status ${status.ok ? "success" : "error"}`;
  } catch (error) {
    box.textContent = error.message;
    box.className = "key-status error";
  }
}

async function repairSelectedKey() {
  const select = $("conn_key");
  const key = select?.value || "";
  if (!key) return notify("请先选择私钥", "info");
  try {
    const status = await api("/api/identity-files/repair", {method:"POST", body:JSON.stringify({path:key})});
    await loadKeys(key, select);
    notify(status.ok ? "私钥权限已修复" : `已尝试修复：${status.details}`, status.ok ? "success" : "error");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function testConnectionForm(button=null){
  button = button || $("connTestBtn");
  const form = button?.closest?.("form") || $("connectionForm");
  if (!await ensureConnectionExtraArgsValid(form)) return;
  const status = connectionFormField(form, "connTestStatus");
  const detectionStatus = connectionFormField(form, "connTerminalDetectionStatus");
  const startRevision = Number(form?._terminalCredentialRevision || 0);
  setButtonBusy(button, true, "测试中...");
  if (status) { status.hidden = false; status.className = "connection-test-status busy"; status.textContent = "正在测试 SSH 连接，请稍候..."; }
  if (detectionStatus) {
    detectionStatus.className = "terminal-startup-detection busy";
    detectionStatus.textContent = "正在连接并检测远端平台、默认 Shell 和可用程序...";
  }
  notify("正在测试 SSH 连接，请稍候...", "info");
  try {
    const payload = {...connPayload(form), discover_terminal:true};
    const r=await api("/api/test-ssh",{method:"POST",body:JSON.stringify(payload)});
    const message = r.ok
      ? `SSH 测试成功，用时 ${r.elapsed_ms}ms`
      : `SSH 测试失败：${r.output || r.error || "请检查连接信息"}`;
    if (status) { status.className = `connection-test-status ${r.ok ? "success" : "error"}`; status.textContent = message; }
    if (r.ok && Number(form?._terminalCredentialRevision || 0) !== startRevision) {
      form._terminalCapabilitiesChecked = true;
      form._terminalProbeStale = true;
      connectionFormField(form, "connTerminalCapabilities")?.classList.add("is-stale");
      if (detectionStatus) {
        detectionStatus.className = "terminal-startup-detection stale";
        detectionStatus.textContent = "测试期间连接信息发生了变化，本次检测结果未应用。请重新测试 SSH。";
      }
    } else if (r.ok) {
      const rawCapabilities = r.capabilities || r.terminal_capabilities || r.discovery;
      form._terminalCapabilitiesChecked = true;
      form._terminalProbeStale = false;
      if (rawCapabilities && typeof rawCapabilities === "object") {
        const capabilities = renderConnectionTerminalProfiles(form, rawCapabilities);
        if (detectionStatus) {
          const defaultShell = capabilities.default_shell?.label || capabilities.default_shell?.path || "未识别";
          detectionStatus.className = "terminal-startup-detection success";
          detectionStatus.textContent = `检测完成：${capabilities.platform_label}，默认 Shell 为 ${defaultShell}，可快速选择 ${capabilities.profiles.length} 个启动配置。`;
        }
      } else if (detectionStatus) {
        form._terminalCapabilities = null;
        resetConnectionTerminalProfileSelect(form, true);
        const summary = connectionFormField(form, "connTerminalCapabilities");
        if (summary) {
          summary.hidden = true;
          summary.className = "terminal-startup-capabilities";
          summary.replaceChildren();
        }
        detectionStatus.className = "terminal-startup-detection warning";
        detectionStatus.textContent = "SSH 连接正常，但未能读取远端启动环境。仍可使用默认 Shell 或手动填写程序路径。";
      }
    } else if (detectionStatus) {
      detectionStatus.className = "terminal-startup-detection error";
      detectionStatus.textContent = "SSH 测试失败，未更新终端启动选项。";
    }
    notify(message, r.ok?"success":"error");
  } catch(e){
    if (Array.isArray(e?.details?.issues)) renderConnectionExtraArgsDiagnostics(form, e.details.issues);
    const message = `SSH 测试无法完成：${e.message}`;
    if (status) { status.className = "connection-test-status error"; status.textContent = message; }
    if (detectionStatus) {
      detectionStatus.className = "terminal-startup-detection error";
      detectionStatus.textContent = "无法检测远端启动环境，请检查连接信息后重试。";
    }
    notify(message,"error");
  }
  finally { setButtonBusy(button, false); }
}

async function checkConnectionHealth(id, button=null) {
  const c = currentConnection(id) || connections.find(item => item.id === id);
  setButtonBusy(button, true, "检查中...");
  try {
    const result = await api(`/api/connections/${id}/health`, {method:"POST"});
    healthResults.set(id, result);
    renderConnections();
    notify(formatHealthMessage(c, result), result.ok ? "success" : "error");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function formatHealthMessage(connection, result) {
  const lines = [`${connection?.name || result.id} 健康检查：${result.status}${result.cached ? `（缓存 ${Math.round((result.cache_age_ms || 0)/1000)} 秒）` : ""}`];
  if (!result.ssh?.ok) lines.push(result.ssh?.output || "SSH 连接异常");
  for (const forward of result.forwards || []) {
    if (forward.reachable === false) lines.push(`转发 ${forward.id} 本地端口不可达`);
    if (forward.port_usage?.occupied) {
      const owners = (forward.port_usage.processes || []).map(p => `${p.name || "未知程序"}(${p.pid})`).join("、") || "未知程序";
      lines.push(`转发 ${forward.id} 端口被占用：${owners}`);
    }
  }
  return lines.join("\n");
}

async function checkAllHealth(button=null) {
  setButtonBusy(button, true, "检查中...");
  try {
    notify("正在执行健康检查...", "info");
    const results = await api("/api/health?refresh=1");
    for (const item of results) healthResults.set(item.id, item);
    renderConnections();
    const failed = results.filter(item => !item.ok);
    notify(`健康检查完成：正常 ${results.length - failed.length} 个，异常 ${failed.length} 个`, failed.length ? "error" : "success");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function openServerDashboard(id, updateTab=true) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const c = selectConnection(id);
  if (!c) return;
  let body = null;
  inPane(() => {
    $("view-dashboard").innerHTML = `<div class="panel">
    <div class="workspace-head">
      <div>
        <h2>${esc(c.name)} · 仪表盘</h2>
        <div class="subtitle">${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</div>
      </div>
      <div class="actions"><button onclick="openServerDashboard(${c.id},false)">刷新巡检</button><button onclick="openTerminal(${c.id})">打开终端</button></div>
    </div>
    <div id="serverDashboardBody" class="dashboard-grid">
      <div class="dashboard-card"><strong>巡检中</strong><span>正在通过 SSH 获取系统信息...</span></div>
    </div>
  </div>`;
    setWorkspace(`${c.name} · 仪表盘`, "服务器基础巡检", "dashboard", `dashboard-${c.id}`, updateTab, true, {kind:"dashboard", id:c.id});
    body = $("serverDashboardBody");
  });
  try {
    const result = await api(`/api/connections/${c.id}/inspect`, {method:"POST"});
    if (body?.isConnected) body.innerHTML = renderServerInspection(result);
  } catch (error) {
    if (body?.isConnected) body.innerHTML = `<div class="dashboard-card bad"><strong>巡检失败</strong><span>${esc(error.message)}</span></div>`;
  }
}

function renderServerInspection(result) {
  const sections = parseInspectionOutput(result.output || "");
  const names = [
    ["system", "系统"],
    ["os", "发行版"],
    ["uptime", "运行时间"],
    ["memory", "内存"],
    ["disk", "磁盘"],
    ["ports", "监听端口"]
  ];
  return names.map(([key, title]) => `<div class="dashboard-card ${result.ok ? "" : "bad"}"><strong>${title}</strong><pre>${esc(sections[key] || "暂无数据")}</pre></div>`).join("");
}

function parseInspectionOutput(text) {
  const out = {};
  let key = "summary";
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      key = match[1].trim();
      out[key] = "";
    } else {
      out[key] = `${out[key] || ""}${line}\n`;
    }
  }
  for (const name of Object.keys(out)) out[name] = out[name].trim();
  return out;
}

function currentConnection(id=selectedId){ return connections.find(x=>x.id===id); }

function selectConnection(id) {
  selectedId = id;
  const c = currentConnection();
  if (c) {
    groupOpen.add(c.group_name);
    saveGroupState();
  }
  renderConnections();
  return c;
}

function editConnection(id, updateTab=true){
  if (!requireConfigEncryptionUnlocked("编辑 SSH 连接")) return;
  const c = selectConnection(id);
  if(!c) return;
  $("view-edit").innerHTML = $("connectionFormTpl").innerHTML;
  refreshIcons();
  const form = $("connectionForm");
  form.dataset.identityFileStatus = String(c.identity_file_status || "none");
  form.dataset.identityFileMessage = connectionIdentityWarningMessage(c);
  $("conn_id").value=c.id;
  if ($("connSaveAndClear")) $("connSaveAndClear").hidden = true;
  if ($("connRemoteGenerationLine")) $("connRemoteGenerationLine").hidden = true;
  $("conn_name").value=c.name;
  renderGroupOptions(c.group_name);
  $("conn_user").value=c.ssh_user;
  $("conn_host").value=c.ssh_host;
  $("conn_port").value=c.ssh_port;
  $("conn_sort_order").value=c.sort_order || 1;
  $("conn_auth_type").value=c.auth_type || "key";
  $("conn_password").value="";
  $("conn_key_passphrase").value="";
  $("conn_agent_mode").value=c.ssh_agent_mode || "auto";
  $("connClearPassphraseLine").hidden=!c.has_private_key_passphrase;
  $("conn_clear_key_passphrase").checked=false;
  $("conn_connect_timeout").value=String(c.connect_timeout_seconds || 10);
  $("conn_keepalive_interval").value=String(Number.isInteger(Number(c.keepalive_interval_seconds)) ? Number(c.keepalive_interval_seconds) : 60);
  $("conn_keepalive_count").value=String(c.keepalive_count_max || 3);
  $("conn_tcp_keepalive").value=String(Number(c.tcp_keepalive ?? 1) ? 1 : 0);
  $("conn_x11_mode").value=c.x11_mode || "off";
  renderJumpConnectionOptions(c.jump_connection_id, c.id);
  $("conn_tags").value=c.tags || "";
  $("conn_autostart").value=String(c.autostart_forwards||0);
  $("conn_extra").value=c.extra_args||"";
  fillConnectionTerminalStartup(form, c);
  toggleAuthFields();
  loadKeys(c.identity_file);
  wireConnectionForm();
  scheduleConnectionExtraArgsValidation(form, 0);
  setWorkspace(`${c.name} · 编辑`, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "edit", `edit-${c.id}`, updateTab, true, {kind:"edit", id:c.id});
}

async function deleteConnection(id){
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const c = currentConnection(id);
  if(!await confirmModal(`删除连接 ${c?.name || id} 及其所有转发？`, "删除 SSH 连接", "删除", "取消", true)) return;
  await api(`/api/connections/${id}`,{method:"DELETE"});
  if(selectedId===id) selectedId=null;
  await loadAll();
  inPane(renderWelcome);
  notify("已删除连接","success");
}

async function duplicateConnection(id) {
  const source = currentConnection(id);
  const result = await api(`/api/connections/${id}/duplicate`, {method:"POST"});
  groupOpen.add(source?.group_name || "默认分组");
  saveGroupState();
  await loadAll();
  notify(`已复制为 ${result.name}`, "success");
}
