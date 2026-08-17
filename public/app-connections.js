function currentConnection(id=selectedId){
  const connectionId = Number(id);
  if (typeof quickConnectionsById !== "undefined" && quickConnectionsById.has(connectionId)) {
    return quickConnectionsById.get(connectionId);
  }
  return connections.find(x=>x.id===connectionId);
}

function selectConnection(id) {
  const quick = typeof quickConnectionsById !== "undefined" ? quickConnectionsById.get(Number(id)) : null;
  if (quick) return quick;
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
  if (!requireConfigEncryptionUnlocked(tr("connections:form.edit_context", {defaultValue:"编辑 SSH 连接"}))) return;
  const c = selectConnection(id);
  if(!c) return;
  $("view-edit").innerHTML = $("connectionFormTpl").innerHTML;
  refreshIcons();
  const form = $("connectionForm");
  form.dataset.identityFileStatus = String(c.identity_file_status || "none");
  form.dataset.identityFileMessage = connectionIdentityWarningMessage(c);
  $("conn_id").value=c.id;
  const saveOnly = $("connSaveOnly");
  if (saveOnly) {
    saveOnly.hidden = false;
    saveOnly.dataset.i18n = "connections:auto.save_only";
    saveOnly.textContent = tr("connections:auto.save_only", {defaultValue:"仅保存"});
  }
  const primarySave = $("connPrimarySave");
  if (primarySave) {
    primarySave.dataset.saveAction = "close";
    primarySave.dataset.i18n = "connections:auto.save_close";
    primarySave.textContent = tr("connections:auto.save_close", {defaultValue:"保存并关闭"});
  }
  const saveAndOpen = $("connSaveAndConnect");
  if (saveAndOpen) {
    saveAndOpen.hidden = false;
    saveAndOpen.dataset.closeAfterSave = "1";
    saveAndOpen.dataset.i18n = "connections:auto.save_open";
    saveAndOpen.textContent = tr("connections:auto.save_open", {defaultValue:"保存并打开"});
  }
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
  setWorkspace(
    tr("connections:form.edit_title", {name:c.name, defaultValue:`${c.name} · 编辑`}),
    `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`,
    "edit", `edit-${c.id}`, updateTab, true, {kind:"edit", id:c.id}
  );
}

async function deleteConnection(id){
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const c = currentConnection(id);
  const name = c?.name || id;
  if(!await confirmModal(
    tr("connections:dialogs.delete_ssh_message", {name, defaultValue:`删除连接 ${name} 及其所有转发？`}),
    tr("connections:dialogs.delete_ssh_title", {defaultValue:"删除 SSH 连接"}),
    tr("common:actions.delete", {defaultValue:"删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return;
  await api(`/api/connections/${id}`,{method:"DELETE"});
  if(selectedId===id) selectedId=null;
  await loadAll();
  inPane(renderWelcome);
  notify(tr("connections:notifications.ssh_deleted", {defaultValue:"已删除连接"}),"success");
}

async function duplicateConnection(id) {
  const source = currentConnection(id);
  const result = await api(`/api/connections/${id}/duplicate`, {method:"POST"});
  groupOpen.add(source?.group_name || TERMA_DEFAULT_CONNECTION_GROUP);
  saveGroupState();
  await loadAll();
  notify(tr("connections:notifications.duplicated", {name:result.name, defaultValue:`已复制为 ${result.name}`}), "success");
}

function connectionActionId(element) {
  return Number(element.dataset.connectionId || 0);
}

if (typeof registerTermaAction === "function") {
registerTermaAction("connection-forward", ({element}) => connectionForwardAction(
  connectionActionId(element),
  element.dataset.forwardAction,
  element
));
registerTermaAction("connection-group-toggle", ({element}) => toggleConnectionGroupFromHeader(decodeURIComponent(element.dataset.group || "")));
registerTermaAction("connection-group-menu", ({event, element}) => showConnectionGroupMenu(event, decodeURIComponent(element.dataset.group || "")));
registerTermaAction("connection-search-clear", () => setConnectionSearch(""));
registerTermaAction("connection-new", () => newConnection());
registerTermaAction("connection-select-all", ({element}) => toggleAllConnections(element.checked));
registerTermaAction("connection-bulk-settings", () => openConnectionBulkSettings());
registerTermaAction("connection-bulk-delete", () => bulkDeleteConnections());
registerTermaAction("connection-group-add-confirm", () => confirmAddGroup());
registerTermaAction("connection-group-add-cancel", () => cancelAddGroup());
registerTermaAction("connection-select", ({element}) => setConnectionSelected(connectionActionId(element), element.checked));
registerTermaAction("connection-open-terminal", ({event, element}) => {
  event.stopPropagation();
  return openTerminal(connectionActionId(element));
});
registerTermaAction("connection-open-sftp", ({element}) => openSftp(connectionActionId(element)));
registerTermaAction("connection-open-forwards", ({element}) => openForwards(connectionActionId(element)));
registerTermaAction("connection-favorite", ({event, element}) => toggleConnectionFavorite(event, connectionActionId(element), Number(element.dataset.favorite || 0)));
registerTermaAction("connection-menu", ({event, element}) => showConnectionMenu(event, connectionActionId(element)));
registerTermaAction("remote-host-toggle", ({element}) => toggleRemoteHostOpen(decodeURIComponent(element.dataset.hostKey || "")));
registerTermaAction("remote-search-clear", () => setRemoteConnectionSearch(""));
registerTermaAction("remote-new", () => newRemoteProfile("rdp"));
registerTermaAction("connection-bulk-field", ({element}) => toggleConnectionBulkField(element.dataset.field, element.checked));
registerTermaAction("connection-bulk-auth-type", () => toggleConnectionBulkAuthType());
registerTermaAction("connection-modal-close", () => closeModal());
registerTermaAction("connection-bulk-apply", () => applyConnectionBulkSettings());
registerTermaAction("connection-bulk-delete-confirm", () => performBulkDeleteConnections());
registerTermaAction("connection-group-save", () => saveGroupModal());
registerTermaAction("connection-dashboard-refresh", ({element}) => openServerDashboard(connectionActionId(element), false));
}
