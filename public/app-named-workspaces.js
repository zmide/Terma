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
  const payload = {format:"terma-named-workspace", version:2, exported_at:new Date().toISOString(), workspace:{name:workspace.name, description:workspace.description || "", layout:workspace.layout}};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${String(workspace.name || "workspace").replace(/[\\/:*?"<>|]+/g, "-")}.terma-workspace.json`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

function importNamedWorkspaceFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.terma-workspace.json,.tunneldesk-workspace.json,application/json";
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
  if (!source?.layout || !namedWorkspaceSavedTabs(source.layout).length) throw new Error("不是有效的 Terma 命名工作区文件");
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
    <div class="grid"><div><label>密钥名称</label><input id="sshKeyName" value="id_ed25519_terma" maxlength="80"></div><div><label>备注</label><input id="sshKeyComment" value="Terma" maxlength="120"></div></div>
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
