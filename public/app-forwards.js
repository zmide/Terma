function captureForwardWorkspace(connectionId=selectedId) {
  const tab = tabs.find(item => item.key === activeTabKey);
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tab?.key || "") : action => action();
  return {
    tab,
    run:inTab,
    refresh() {
      inTab(() => {
        if (tab?.kind === "forwards" && Number(tab.id) === Number(connectionId)) openForwards(connectionId, false);
        else if (tab?.kind === "terminal" && Number(tab.id) === Number(connectionId)) openTerminal(connectionId, false, tab.key, tab.title || "");
      });
    }
  };
}

function openForwards(id, updateTab=true) {
  const c = selectConnection(id);
  if (!c) return;
  if (updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(c.id, "forwards");
  const rulesCount = tr("connections:forwards.rules_count", {count:c.forwards.length, defaultValue:`${c.forwards.length} forwarding rules`});
  $("view-forwards").innerHTML = `<div class="workspace-head"><div class="subtitle">${esc(rulesCount)}</div><div class="actions">${connectionToggleButton(c)}</div></div>` + $("forwardManagerTpl").innerHTML;
  $("forward_conn_id").value = c.id;
  wireForwardForm();
  toggleForwardLabels();
  renderForwards();
  if (typeof applyTermaTranslations === "function") applyTermaTranslations($("view-forwards"));
  const workspaceTitle = tr("connections:forwards.workspace_tab", {name:c.name, defaultValue:`${c.name} · Forwarding list`});
  setWorkspace(workspaceTitle, tr("connections:forwards.short_count", {count:c.forwards.length, defaultValue:`${c.forwards.length} forwards`}), "forwards", `forwards-${c.id}`, updateTab, true, {kind:"forwards", id:c.id});
}

async function connectionForwardAction(id, action, button=null){
  const workspace = captureForwardWorkspace(id);
  const c = currentConnection(id);
  if (action === "start" && !(c?.forwards || []).length) {
    notify(tr("common:notifications.connection_no_forwards", {defaultValue:"This connection has no forwarding rules yet"}), "info");
    if (workspace.tab?.kind === "terminal") focusTerminalSession(workspace.tab.key);
    return;
  }
  setButtonBusy(button, true, action === "start" ? tr("common:auto.starting", {defaultValue:"Starting..."}) : tr("common:auto.stopping", {defaultValue:"Stopping..."}));
  try {
    if (action === "start") {
      const handled = await handleConnectionPortConflicts(c);
      if (!handled) return;
    }
    await api(`/api/connections/${id}/${action}-forwards`,{method:"POST"});
    await loadAll();
    workspace.refresh();
    notify(tr(action === "start" ? "common:notifications.all_forwards_started" : "common:notifications.all_forwards_stopped", {defaultValue:action === "start" ? "Started all forwarding rules for this connection" : "Stopped all forwarding rules for this connection"}), "success");
  } catch (error) {
    await loadAll().catch(()=>{});
    notify(error.message || tr("common:notifications.exact.forward_operation_failed", {defaultValue:"Forwarding operation failed"}), "error");
    if (
      action === "start"
      && typeof sshAuthenticationFailure === "function"
      && sshAuthenticationFailure(error)
      && typeof repairSshCredentials === "function"
    ) {
      await repairSshCredentials(id, {
        context:tr("connections:forwards.auth_failed_context", {defaultValue:"Authentication failed while starting forwarding"}),
        error,
        onSaved:async () => workspace.refresh()
      });
    }
  } finally {
    setButtonBusy(button, false);
    if (workspace.tab?.kind === "terminal") focusTerminalSession(workspace.tab.key);
  }
}

async function handleConnectionPortConflicts(connection) {
  for (const forward of connection?.forwards || []) {
    if (!["local", "socks"].includes(forward.mode) || forward.status === "running") continue;
    const diagnosis = await diagnoseForwardPort(forward.id, {silent:true});
    if (!diagnosis.occupied) continue;
    const resolved = await offerResolvePortConflict(forward, diagnosis);
    if (!resolved) {
      notify(tr("common:notifications.forward_port_occupied_before_start", {name:forwardDisplayName(forward), defaultValue:`${forwardDisplayName(forward)} was not enabled because its port was already in use.`}), "error");
      return false;
    }
  }
  return true;
}

async function startAllForwards(button=null){
  setButtonBusy(button, true, tr("common:auto.starting", {defaultValue:"Starting..."}));
  try {
    const targets = connections.filter(c => (c.forwards || []).length);
    if (!targets.length) return notify(tr("common:notifications.exact.no_startable_forwards", {defaultValue:"There are no forwarding rules to start"}), "info");
    let ok = 0, failed = 0;
    for (const c of targets) {
      try {
        const handled = await handleConnectionPortConflicts(c);
        if (!handled) {
          failed++;
          continue;
        }
        await api(`/api/connections/${c.id}/start-forwards`, {method:"POST"});
        ok++;
      } catch (error) {
        failed++;
        notify(tr("connections:forwards.connection_start_failed", {name:c.name, error:error.message, defaultValue:`${c.name} failed to start forwarding: ${error.message}`}), "error");
      }
    }
    await loadAll();
    notify(tr("common:notifications.all_forwards_result", {success:ok, failed, defaultValue:`Start all forwarding completed: ${ok} succeeded, ${failed} failed`}), failed ? "error" : "success");
  } finally {
    setButtonBusy(button, false);
  }
}

async function restoreForwards() {
  try {
    const result = await api("/api/forwards/restore", {method:"POST"});
    await loadAll();
    if (primaryView === "running") renderRunningForwards();
    notify(tr("common:notifications.restore_forwards_result", {success:result.ok, failed:result.failed, defaultValue:`Restore previous forwarding completed: ${result.ok} succeeded, ${result.failed} failed`}), result.failed ? "error" : "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

function forwardNeedsStop(forward) {
  const status = String(forward?.status || "stopped");
  return status !== "stopped" || Boolean(Number(forward?.pid || 0)) || Boolean(Number(forward?.restore || 0));
}

async function stopAllForwardsUi(button=null){
  setButtonBusy(button, true, tr("common:auto.stopping", {defaultValue:"Stopping..."}));
  try {
    await loadAll();
    const targets = connections.filter(c => (c.forwards || []).some(forwardNeedsStop));
    if (!targets.length) return notify(tr("common:notifications.exact.no_stoppable_forwards", {defaultValue:"There are no forwarding rules to stop or clean up"}), "info");
    let ok = 0, failed = 0;
    for (const c of targets) {
      try {
        await api(`/api/connections/${c.id}/stop-forwards`, {method:"POST"});
        ok++;
      } catch {
        failed++;
      }
    }
    await loadAll();
    notify(tr("common:notifications.stop_forwards_result", {success:ok, failed, defaultValue:`Stop and clean up forwarding completed: ${ok} succeeded, ${failed} failed`}), failed ? "error" : "success");
  } finally {
    setButtonBusy(button, false);
  }
}

function wireForwardForm() {
  renderForwardTemplateOptions();
  $("forwardForm").addEventListener("submit", async e => {
    e.preventDefault();
    const workspace = captureForwardWorkspace(Number($("forward_conn_id")?.value || 0));
    try {
      const id=Number($("forward_conn_id").value);
      if(!id) throw new Error(tr("connections:forwards.select_connection", {defaultValue:"Select a connection first"}));
      const checkedPayload = await confirmForwardPortBeforeSave(forwardPayload(), editingForwardId);
      if (!checkedPayload) return;
      if (editingForwardId) {
        const forward = currentForward(editingForwardId);
        await api(`/api/forwards/${editingForwardId}`, {method:"PUT", body:JSON.stringify(checkedPayload)});
        if (forward?.status === "running" && await confirmModal(
          tr("connections:forwards.restart_confirm", {defaultValue:"This forwarding rule is running. Restart it now to apply the changes?"}),
          tr("connections:forwards.restart_title", {defaultValue:"Restart forwarding"}),
          tr("connections:forwards.restart_now", {defaultValue:"Restart now"}),
          tr("connections:forwards.restart_later", {defaultValue:"Later"})
        )) {
          await api(`/api/forwards/${editingForwardId}/stop`, {method:"POST"});
          await api(`/api/forwards/${editingForwardId}/start`, {method:"POST"});
        }
        notify(tr("connections:forwards.saved", {defaultValue:"Forwarding rule saved"}), "success");
        cancelForwardEdit();
      } else {
        await api(`/api/connections/${id}/forwards`,{method:"POST",body:JSON.stringify(checkedPayload)});
        clearForwardForm();
        notify(tr("common:notifications.forward_added", {defaultValue:"Forwarding rule added"}),"success");
      }
      await loadAll();
      workspace.refresh();
    } catch(err){notify(err.message,"error");}
  });
}

async function confirmForwardPortBeforeSave(payload, excludeId=0) {
  if (!["local", "socks"].includes(payload.mode)) return payload;
  const result = await api("/api/ports/check-forward", {method:"POST", body:JSON.stringify({host:payload.bind_host, port:payload.bind_port, exclude_id:excludeId})});
  if (!result.configured && !result.usage?.occupied) return payload;
  const messages = [];
  if (result.configured) messages.push(tr("connections:forwards.port_configured", {name:result.configured.connection_name, defaultValue:`This local port is already configured by ${result.configured.connection_name}`}));
  if (result.usage?.occupied) {
    const separator = tr("connections:forwards.process_separator", {defaultValue:", "});
    const owners = (result.usage.processes || []).map(p => tr("connections:forwards.process_pid", {name:p.name || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"}), pid:p.pid, defaultValue:`${p.name || "Unknown process"} (PID: ${p.pid})`})).join(separator) || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"});
    messages.push(tr("connections:forwards.port_occupied", {owners, defaultValue:`This local port is occupied by ${owners}`}));
  }
  const recommended = result.recommended?.recommended_port;
  const choice = await chooseModal(tr("connections:forwards.port_conflict_title", {defaultValue:"Port conflict"}), `${messages.join("\n")}\n\n${tr("connections:forwards.port_conflict_message", {defaultValue:"Continuing may cause batch startup failures."})}`, [
    {label:tr("navigation:menus.forward_save_anyway", {defaultValue:"Save anyway"}), value:"save", className:"danger"},
    {label:tr("navigation:menus.forward_save_recommended", {port:recommended || "", defaultValue:`Save with recommended port ${recommended || ""}`}), value:"recommend", className:"primary"},
    {label:tr("common:actions.cancel", {defaultValue:"Cancel"}), value:"cancel"}
  ]);
  if (choice === "save") return payload;
  if (choice === "recommend" && recommended) {
    $("forward_bind_port").value = recommended;
    return {...payload, bind_port:recommended};
  }
  return null;
}

function toggleForwardLabels(){
  if (!$("forward_mode")) return;
  const m=$("forward_mode").value;
  const socks=m==="socks";
  $("targetHostBox").style.display=socks?"none":"block";
  $("targetPortBox").style.display=socks?"none":"block";
  $("forward_bind_label").textContent=m==="remote"
    ? tr("connections:auto.remote_bind_host", {defaultValue:"Remote bind address"})
    : socks ? tr("connections:auto.socks_bind_host", {defaultValue:"SOCKS5 bind address"}) : tr("connections:auto.local_bind_host", {defaultValue:"Local bind address"});
  $("forward_bind_port_label").textContent=m==="remote"
    ? tr("connections:auto.remote_bind_port", {defaultValue:"Remote bind port"})
    : socks ? tr("connections:auto.socks_bind_port", {defaultValue:"SOCKS5 bind port"}) : tr("connections:auto.local_bind_port", {defaultValue:"Local bind port"});
}

function forwardPayload(){
  return {
    mode:$("forward_mode").value,
    service_name:$("forward_service_name").value.trim(),
    service_type:$("forward_service_type").value.trim(),
    service_note:$("forward_service_note").value.trim(),
    url_scheme:$("forward_url_scheme").value.trim(),
    bind_host:$("forward_bind_host").value.trim()||"127.0.0.1",
    bind_port:Number($("forward_bind_port").value),
    target_host:$("forward_target_host").value.trim()||"127.0.0.1",
    target_port:Number($("forward_target_port").value)
  };
}

function clearForwardForm() {
  $("forward_bind_port").value="";
  $("forward_target_port").value="";
  $("forward_service_name").value="";
  $("forward_service_type").value="";
  $("forward_service_note").value="";
  $("forward_url_scheme").value="";
}

function editForward(id) {
  const f = currentForward(id);
  if (!f) return notify(tr("connections:forwards.not_found", {defaultValue:"Forwarding rule not found"}), "error");
  editingForwardId = Number(id);
  $("forward_mode").value = f.mode;
  $("forward_bind_host").value = f.bind_host || "127.0.0.1";
  $("forward_bind_port").value = f.bind_port || "";
  $("forward_target_host").value = f.target_host || "127.0.0.1";
  $("forward_target_port").value = f.target_port || "";
  $("forward_service_name").value = f.service_name || "";
  $("forward_service_type").value = f.service_type || "";
  $("forward_service_note").value = f.service_note || "";
  $("forward_url_scheme").value = f.url_scheme || "";
  $("forwardSubmitBtn").textContent = tr("connections:auto.save_forward", {defaultValue:"Save forwarding rule"});
  $("cancelForwardEditBtn").hidden = false;
  toggleForwardLabels();
  $("forwardForm").scrollIntoView({block:"start", behavior:"smooth"});
}

function cancelForwardEdit() {
  editingForwardId = 0;
  if ($("forwardSubmitBtn")) $("forwardSubmitBtn").textContent = tr("connections:auto.add_forward", {defaultValue:"Add forwarding rule"});
  if ($("cancelForwardEditBtn")) $("cancelForwardEditBtn").hidden = true;
  if ($("forwardForm")) clearForwardForm();
}

async function saveForwardTemplate() {
  const workspace = captureForwardWorkspace();
  const payload = forwardPayload();
  const fallbackName = payload.service_name || serviceTypeText(payload.service_type) || forwardModeText(payload.mode) || tr("connections:auto.forward_template", {defaultValue:"Forwarding template"});
  const current = forwardTemplates.find(item => String(item.id) === String(editingForwardTemplateId));
  const name = await inputModal(
    editingForwardTemplateId ? tr("connections:forwards.template_save_edit_title", {defaultValue:"Save template changes"}) : tr("connections:forwards.template_save_title", {defaultValue:"Save forwarding template"}),
    tr("connections:forwards.template_name", {defaultValue:"Template name"}),
    current?.name || fallbackName
  );
  if (!name) return notify(tr("common:notifications.template_save_cancelled", {defaultValue:"Template save cancelled"}), "info");
  if (editingForwardTemplateId && current) {
    await api(`/api/forward-templates/${editingForwardTemplateId}`, {method:"PUT", body:JSON.stringify({name, ...payload})});
  } else {
    await api("/api/forward-templates", {method:"POST", body:JSON.stringify({name, ...payload})});
  }
  editingForwardTemplateId = "";
  await loadForwardTemplates();
  workspace.run(() => {
    renderForwardTemplateOptions();
    const box = $("forwardTemplateManager");
    if (box) box.hidden = false;
    renderForwardTemplateManager();
  });
  notify(tr("common:notifications.forward_template_saved", {name, defaultValue:`Forwarding template saved: ${name}`}), "success");
}

async function loadForwardTemplates() {
  forwardTemplates = await api("/api/forward-templates");
  return forwardTemplates;
}

function renderForwardTemplateOptions() {
  const select = $("forward_template_select");
  if (!select) return;
  select.innerHTML = `<option value="">${esc(tr("connections:auto.choose_template", {defaultValue:"Choose a template"}))}</option>${forwardTemplates.map(t=>`<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join("")}`;
}

function applyForwardTemplate(id) {
  const t = forwardTemplates.find(item => String(item.id) === String(id));
  if (!t) return;
  $("forward_mode").value = t.mode || "local";
  $("forward_bind_host").value = t.bind_host || "127.0.0.1";
  $("forward_bind_port").value = t.bind_port || "";
  $("forward_target_host").value = t.target_host || "127.0.0.1";
  $("forward_target_port").value = t.target_port || "";
  $("forward_service_name").value = t.service_name || t.name || "";
  $("forward_service_type").value = t.service_type || "";
  $("forward_service_note").value = t.service_note || "";
  $("forward_url_scheme").value = t.url_scheme || "";
  toggleForwardLabels();
}

function showForwardTemplateManager() {
  const box = $("forwardTemplateManager");
  box.hidden = !box.hidden;
  renderForwardTemplateManager();
}

function renderForwardTemplateManager() {
  const box = $("forwardTemplateManager");
  if (!box) return;
  box.innerHTML = forwardTemplates.map(t => `<div class="template-row ${String(t.id) === String(editingForwardTemplateId) ? "active" : ""}"><button class="template-main" onclick="applyForwardTemplate('${escAttr(t.id)}')"><span class="conn-name">${esc(t.name)}</span><span class="muted">${esc(forwardText(t))}</span></button><div class="template-actions"><button onclick="editForwardTemplate('${escAttr(t.id)}')">${String(t.id) === String(editingForwardTemplateId) ? esc(tr("connections:forwards.template_editing", {defaultValue:"Editing"})) : esc(tr("common:actions.edit", {defaultValue:"Edit"}))}</button><button onclick="applyForwardTemplateBatch('${escAttr(t.id)}')">${esc(tr("connections:forwards.template_apply_batch", {defaultValue:"Apply in batch"}))}</button><button class="danger" onclick="deleteForwardTemplate('${escAttr(t.id)}')">${esc(tr("common:actions.delete", {defaultValue:"Delete"}))}</button></div></div>`).join("") || `<div class="empty compact">${esc(tr("connections:forwards.template_empty", {defaultValue:"No forwarding templates"}))}</div>`;
}

function editForwardTemplate(id) {
  const t = forwardTemplates.find(item => String(item.id) === String(id));
  if (!t) return;
  editingForwardTemplateId = id;
  applyForwardTemplate(id);
  const box = $("forwardTemplateManager");
  if (box) box.hidden = false;
  notify(tr("common:notifications.forward_template_loaded", {defaultValue:"Template loaded into the form. Edit it, then select Save as template to update it."}), "info");
}

async function deleteForwardTemplate(id) {
  const workspace = captureForwardWorkspace();
  if (!await confirmModal(
    tr("connections:forwards.template_delete_confirm", {defaultValue:"Delete this forwarding template?"}),
    tr("connections:forwards.template_delete_title", {defaultValue:"Delete forwarding template"}),
    tr("common:actions.delete", {defaultValue:"Delete"}),
    tr("common:actions.cancel", {defaultValue:"Cancel"}),
    true
  )) return;
  await api(`/api/forward-templates/${id}`, {method:"DELETE"});
  await loadForwardTemplates();
  workspace.run(() => {
    renderForwardTemplateOptions();
    renderForwardTemplateManager();
  });
}

async function applyForwardTemplateBatch(id) {
  const workspace = captureForwardWorkspace();
  const current = currentConnection();
  const choices = [
    {label:tr("navigation:menus.current_connection", {defaultValue:"Current connection"}), value:"current", className:"primary"},
    {label:tr("navigation:menus.current_group", {defaultValue:"Current group"}), value:"group"},
    {label:tr("navigation:menus.all_connections", {defaultValue:"All connections"}), value:"all"},
    {label:tr("common:actions.cancel", {defaultValue:"Cancel"}), value:"cancel"}
  ];
  const choice = await chooseModal(
    tr("connections:forwards.template_apply_batch_title", {defaultValue:"Apply template in batch"}),
    tr("connections:forwards.template_apply_batch_message", {defaultValue:"Choose which connections should receive this forwarding template."}),
    choices
  );
  if (choice === "cancel") return;
  let ids = [];
  if (choice === "current" && current) ids = [current.id];
  else if (choice === "group" && current) ids = connections.filter(item => item.group_name === current.group_name).map(item => item.id);
  else if (choice === "all") ids = connections.map(item => item.id);
  if (!ids.length) return notify(tr("common:notifications.exact.no_applicable_connections", {defaultValue:"There are no applicable connections"}), "info");
  const result = await api(`/api/forward-templates/${id}/apply`, {method:"POST", body:JSON.stringify({connection_ids:ids})});
  await loadAll();
  workspace.refresh();
  notify(tr("common:notifications.exact.forward_template_applied", {count:result.created?.length || 0, defaultValue:`Template applied; added ${result.created?.length || 0} forwarding rules`}), "success");
}

async function recommendForwardPort() {
  const portInput = $("forward_bind_port");
  const host = $("forward_bind_host").value.trim() || "127.0.0.1";
  const port = portInput.value ? Number(portInput.value) : 6000;
  const result = await api("/api/ports/recommend", {method:"POST", body:JSON.stringify({host, port, exclude_id:editingForwardId})});
  if (portInput.isConnected) portInput.value = result.recommended_port;
  notify(tr("common:notifications.recommended_port", {port:result.recommended_port, defaultValue:`Recommended available port: ${result.recommended_port}`}), "success");
}

function renderForwards(){
  if (!$("forwardList")) return;
  const c=currentConnection();
  if(!c){$("forwardList").innerHTML=stateView("empty", tr("connections:forwards.no_connection_selected", {defaultValue:"No SSH connection selected"}), tr("connections:forwards.no_connection_selected_hint", {defaultValue:"Open the forwarding list from an SSH connection on the left."})); return;}
  $("forwardList").innerHTML = c.forwards.length ? `<div class="forward-bulk-toolbar">
    <label class="checkline"><input id="forwardSelectAll" type="checkbox" onchange="toggleCheckGroup(this,'forward'); updateForwardBulkActions()"> ${esc(tr("connections:forwards.select_all", {defaultValue:"Select all forwarding rules"}))}</label>
  </div><div class="forward-list">
    <div class="forward-list-head">
      <span>${esc(tr("connections:forwards.select", {defaultValue:"Select"}))}</span>
      <span>${esc(tr("connections:forwards.rule", {defaultValue:"Rule"}))}</span><span>${esc(tr("connections:forwards.status", {defaultValue:"Status"}))}</span><span>${esc(tr("connections:forwards.service_entry", {defaultValue:"Service"}))}</span><span>${esc(tr("connections:forwards.actions", {defaultValue:"Actions"}))}</span>
    </div>
    ${c.forwards.map(f=>renderForwardCard(f)).join("")}
  </div>` : stateView("empty", tr("connections:forwards.empty", {defaultValue:"No forwarding rules"}), tr("connections:forwards.empty_hint", {defaultValue:"Use the form above to add your first local, remote, or SOCKS5 forwarding rule."}), `<button class="primary" onclick="$('forwardMode')?.focus()">${esc(tr("connections:auto.add_forward", {defaultValue:"Add forwarding rule"}))}</button>`);
  updateForwardBulkActions();
}

function updateForwardBulkActions() {
  const btn = $("bulkDeleteForwardsBtn");
  const root = $("view-forwards") || document;
  const checks = [...root.querySelectorAll(".forward-check")];
  const selected = checks.filter(item => item.checked).length;
  const selectAll = $("forwardSelectAll");
  if (selectAll) {
    selectAll.checked = checks.length > 0 && selected === checks.length;
    selectAll.indeterminate = selected > 0 && selected < checks.length;
  }
  if (!btn) return;
  btn.hidden = !selected;
  btn.textContent = tr("connections:forwards.delete_selected", {count:selected, defaultValue:`Delete selected forwarding rules (${selected})`});
}

function renderForwardCard(f) {
  const access = forwardAccessInfo(f);
  const runtimeDetail = forwardQualityText(f);
  const failureTime = f.status === "failed" ? forwardEventTimeText(f.updated_at) : "";
  const startLabel = tr("common:auto.start", {defaultValue:"Start"});
  const stopLabel = tr("common:auto.stop", {defaultValue:"Stop"});
  const moreLabel = tr("connections:actions.more", {defaultValue:"More actions"});
  return `<div class="forward-card">
    <label class="checkline"><input class="forward-check" type="checkbox" value="${f.id}" onchange="updateForwardBulkActions()"><span>${esc(forwardDisplayName(f))}</span></label>
    <div class="forward-rule"><div class="field-label">${esc(tr("connections:forwards.rule", {defaultValue:"Rule"}))}</div><div>${forwardText(f)}</div></div>
    <div class="forward-status"><div class="field-label">${esc(tr("connections:forwards.status", {defaultValue:"Status"}))}</div><span class="status-pill ${escAttr(f.status || "stopped")}">${forwardStatusText(f.status)}</span>${runtimeDetail ? `<div class="conn-meta">${runtimeDetail}</div>` : ""}${failureTime ? `<div class="conn-meta">${esc(tr("connections:forwards.failed_at", {time:failureTime, defaultValue:`Failed at ${failureTime}`}))}</div>` : ""}${f.last_error ? `<div class="conn-meta error forward-error-detail">${esc(f.last_error).slice(0,500)}</div>` : ""}</div>
    <div class="forward-service"><div class="field-label">${esc(tr("connections:forwards.service_entry", {defaultValue:"Service"}))}</div><div class="forward-tags"><span>${forwardModeText(f.mode)}</span>${f.service_type ? `<span>${serviceTypeText(f.service_type)}</span>` : ""}</div>${f.service_note ? `<div class="conn-meta">${esc(f.service_note)}</div>` : ""}${forwardAccessHtml(access)}${access.url ? `<div class="actions tight"><a class="open-forward-link" href="${esc(access.url)}" target="_blank" rel="noopener">${esc(tr("common:auto.open", {defaultValue:"Open"}))}</a><button onclick="copyText('${escAttr(access.url)}')">${esc(tr("common:auto.copy", {defaultValue:"Copy"}))}</button></div>` : `<span class="muted">${esc(tr("connections:forwards.no_address", {defaultValue:"No open address"}))}</span>`}</div>
    <div class="forward-actions">${f.status === "running" ? `<button title="${escAttr(stopLabel)}" aria-label="${escAttr(stopLabel)}" onclick="stopSingleForward(${f.id},this)">${icon("square")}<span>${esc(stopLabel)}</span></button>` : `<button class="primary" title="${escAttr(startLabel)}" aria-label="${escAttr(startLabel)}" onclick="startSingleForward(${f.id},this)">${icon("play")}<span>${esc(startLabel)}</span></button>`}<button class="icon-button" title="${escAttr(moreLabel)}" aria-label="${escAttr(moreLabel)}" onclick="showForwardMenu(event,${f.id})">${icon("ellipsis")}</button></div>
  </div>`;
}

function showForwardMenu(event, id) {
  const forward = currentForward(id);
  const access = forward ? forwardAccessInfo(forward) : null;
  showActionMenu(event, [
    {label:tr("navigation:menus.forward_edit_rule", {defaultValue:"Edit rule"}), icon:"pencil", run:()=>editForward(id)},
    {label:tr("navigation:menus.forward_copy_rule", {defaultValue:"Copy rule details"}), icon:"copy", run:()=>copyText(forwardText(forward))},
    ...(access?.url ? [{label:tr("navigation:menus.forward_copy_local_address", {defaultValue:"Copy local access address"}), icon:"link", run:()=>copyText(access.url)}] : []),
    ...(forward?.mode !== "socks" ? [{label:tr("navigation:menus.forward_copy_target_address", {defaultValue:"Copy target address"}), icon:"target", run:()=>copyText(`${forward.target_host}:${forward.target_port}`)}] : []),
    ...(forward?.mode !== "remote" ? [{label:tr("navigation:menus.forward_test_connectivity", {defaultValue:"Quick connectivity test"}), icon:"activity", run:()=>diagnoseForwardPort(id)}] : []),
    {separator:true},
    {label:tr("navigation:menus.forward_delete_rule", {defaultValue:"Delete rule"}), icon:"trash-2", danger:true, run:()=>deleteForward(id)}
  ]);
}

function forwardModeText(mode){ return {local:tr("connections:forwards.local_forward", {defaultValue:"Local forwarding"}), remote:tr("connections:forwards.remote_forward", {defaultValue:"Remote forwarding"}), socks:"SOCKS5"}[mode] || esc(mode); }

function forwardStatusText(status){
  const key = {running:"running", stopped:"stopped", failed:"failed", reconnecting:"reconnecting"}[status];
  const fallback = {running:"Running", stopped:"Stopped", failed:"Failed to start", reconnecting:"Reconnecting"}[status];
  return key ? tr(`connections:forwards.${key}`, {defaultValue:fallback}) : esc(status);
}

function serviceTypeText(type){ return {web:"Web", mysql:"MySQL", redis:"Redis", ssh:"SSH", socks:"SOCKS5", other:tr("common:auto.other", {defaultValue:"Other"})}[type] || esc(type || ""); }

function forwardDisplayName(f) {
  if (f.service_name) return f.service_name;
  if (f.service_type && f.service_type !== "other") return serviceTypeText(f.service_type);
  return forwardModeText(f.mode);
}

function forwardText(f){
  const endpoint = (host, port) => `${String(host || "").includes(":") && !String(host).startsWith("[") ? `[${host}]` : host}:${port}`;
  if(f.mode==="socks") return `${esc(endpoint(f.bind_host, f.bind_port))}`;
  const bind = esc(endpoint(f.bind_host, f.bind_port));
  const target = esc(endpoint(f.target_host, f.target_port));
  return tr(`connections:forwards.${f.mode === "remote" ? "remote_listener" : "local_listener"}`, {
    bind,
    target,
    defaultValue:`${f.mode === "remote" ? "Remote listener" : "Local listener"} ${bind} → target ${target}`
  });
}

function forwardAccessInfo(f) {
  if (f.mode === "remote") return { url: "", note: "" };
  const rawBindHost = String(f.bind_host || "");
  const wildcard = ["0.0.0.0", "::", ""].includes(rawBindHost);
  const bindHost = wildcard ? "0.0.0.0" : rawBindHost;
  const host = currentPageHostForForward(bindHost);
  const scheme = f.url_scheme || (f.service_type === "web" ? "http" : "http");
  const urlHost = String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
  const url = `${scheme}://${urlHost}:${f.bind_port}`;
  const lanPage = !isLoopbackHost(location.hostname);
  let note = "";
  if (lanPage && isLoopbackHost(bindHost)) note = tr("connections:forwards.local_only_lan_warning", {defaultValue:"This forwarding rule listens only on this computer and cannot be opened directly from the LAN. Change the bind address to 0.0.0.0 and restart it."});
  else if (lanPage && wildcard) note = tr("connections:forwards.lan_access", {defaultValue:"Available on the LAN"});
  else if (!lanPage) note = isLoopbackHost(bindHost)
    ? tr("connections:forwards.local_only", {defaultValue:"Local access only"})
    : tr("connections:forwards.bind_access", {defaultValue:"Available through the listener address"});
  return { url, note, localOnly: lanPage && isLoopbackHost(bindHost) };
}

function forwardOpenUrl(f) {
  return forwardAccessInfo(f).url || "";
}

function forwardAccessHtml(access) {
  if (!access?.url) return "";
  return `<div class="service-url">${esc(access.url)}</div>${access.note ? `<div class="conn-meta ${access.localOnly ? "warning-text" : ""}">${esc(access.note)}</div>` : ""}`;
}

function forwardQualityText(f) {
  const parts = [];
  if (f.pid) parts.push(`PID ${f.pid}`);
  if (f.started_at) {
    const duration = formatDuration(Date.now()/1000 - Number(f.started_at));
    parts.push(tr("connections:forwards.runtime", {duration, defaultValue:`Running for ${duration}`}));
  }
  if (Number(f.reconnect_count || 0)) parts.push(tr("connections:forwards.reconnect_count", {count:f.reconnect_count, defaultValue:`Reconnected ${f.reconnect_count} times`}));
  return parts.join(" · ");
}

function forwardEventTimeText(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false});
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return tr("connections:forwards.duration_hours_minutes", {hours:h, minutes:m, defaultValue:`${h}h ${m}m`});
  if (m) return tr("connections:forwards.duration_minutes_seconds", {minutes:m, seconds:s % 60, defaultValue:`${m}m ${s % 60}s`});
  return tr("connections:forwards.duration_seconds", {seconds:s, defaultValue:`${s}s`});
}

async function deleteForward(id){ const workspace=captureForwardWorkspace(); await api(`/api/forwards/${id}`,{method:"DELETE"}); await loadAll(); workspace.refresh(); notify(tr("common:notifications.forward_deleted", {defaultValue:"Forwarding rule deleted"}),"success"); }

function currentForward(id) {
  for (const c of connections) {
    const found = (c.forwards || []).find(f => f.id === Number(id));
    if (found) return found;
  }
  return null;
}

function forwardPortDiagnosisEndpoint(diagnosis={}) {
  const rawHost = String(diagnosis?.host || "").trim();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  const displayHost = host.includes(":") ? `[${host}]` : host;
  const port = Number(diagnosis?.port || 0);
  return port ? `${displayHost}:${port}` : displayHost;
}

function forwardPortDiagnosisMessage(diagnosis={}) {
  const endpoint = forwardPortDiagnosisEndpoint(diagnosis);
  return diagnosis?.occupied
    ? tr("connections:forwards.diagnosis_port_occupied", {endpoint, defaultValue:`Listening endpoint ${endpoint} is in use`})
    : tr("connections:forwards.diagnosis_port_available", {endpoint, defaultValue:`Listening endpoint ${endpoint} is available`});
}

async function diagnoseForwardPort(id, options={}) {
  setButtonBusy(options.button, true, tr("connections:forwards.diagnosing", {defaultValue:"Diagnosing..."}));
  const f = currentForward(id);
  try {
    if (!f) throw new Error(tr("connections:forwards.not_found", {defaultValue:"Forwarding rule not found"}));
    if (f.mode === "remote") {
      notify(tr("common:notifications.remote_forward_port_note", {defaultValue:"Remote-forward ports listen on the server, so Terma cannot inspect the occupying process locally. If startup fails, the SSH error will be shown."}), "info");
      return {occupied:false, remote:true};
    }
    const result = await api("/api/ports/diagnose", {method:"POST", body:JSON.stringify({host:f.bind_host || "127.0.0.1", port:f.bind_port})});
    if (!result.occupied) {
      if (!options.silent) notify(forwardPortDiagnosisMessage(result), "success");
      return result;
    }
    const detail = result.processes?.length
      ? result.processes.map(p => `${p.name || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"})} PID ${p.pid}${p.path ? `\n${p.path}` : ""}`).join("\n")
      : tr("connections:forwards.processes_unidentified", {defaultValue:"Unable to identify the occupying process"});
    if (options.offerFix) {
      const killed = await offerKillPortOwners(result);
      if (killed) {
        const after = await api("/api/ports/diagnose", {method:"POST", body:JSON.stringify({host:f.bind_host || "127.0.0.1", port:f.bind_port})});
        const afterMessage = forwardPortDiagnosisMessage(after);
        notify(after.occupied ? tr("common:notifications.port_still_occupied", {message:afterMessage, defaultValue:`The port is still in use: ${afterMessage}`}) : afterMessage, after.occupied ? "error" : "success");
        return after;
      }
    }
    if (!options.silent) notify(`${forwardPortDiagnosisMessage(result)}\n${detail}`, "error");
    return result;
  } finally {
    setButtonBusy(options.button, false);
  }
}

async function offerKillPortOwners(diagnosis) {
  const processes = diagnosis.processes || [];
  if (!processes.length) return false;
  const detail = processes.map(p => `${p.name || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"})} PID ${p.pid}${p.path ? `\n${p.path}` : ""}`).join("\n");
  if (!await confirmModal(
    `${forwardPortDiagnosisMessage(diagnosis)}\n\n${detail}\n\n${tr("connections:forwards.close_owners_question", {defaultValue:"Try to close these occupying processes?"})}`,
    tr("connections:forwards.close_owners_title", {defaultValue:"Close occupying processes"}),
    tr("connections:forwards.try_close", {defaultValue:"Try to close"}),
    tr("common:actions.cancel", {defaultValue:"Cancel"}),
    true
  )) return false;
  for (const p of processes) {
    if (!await confirmModal(
      tr("connections:forwards.close_process_confirm", {name:p.name || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"}), pid:p.pid, defaultValue:`Close ${p.name || "Unknown process"} PID ${p.pid}?`}),
      tr("connections:forwards.close_process_title", {defaultValue:"Confirm process close"}),
      tr("connections:forwards.close_process_action", {defaultValue:"Terminate"}),
      tr("connections:forwards.skip", {defaultValue:"Skip"}),
      true
    )) continue;
    await api("/api/ports/kill", {method:"POST", body:JSON.stringify({pid:p.pid, host:diagnosis.host, port:diagnosis.port})});
  }
  return true;
}

async function offerResolvePortConflict(forward, diagnosis) {
  const owners = (diagnosis.processes || []).map(p => `${p.name || tr("connections:forwards.unknown_process", {defaultValue:"Unknown process"})} PID ${p.pid}${p.path ? `\n${p.path}` : ""}`).join("\n") || tr("connections:forwards.processes_unidentified", {defaultValue:"Unable to identify the occupying process"});
  const choice = await chooseModal(tr("connections:forwards.port_conflict_handling", {defaultValue:"Handle port conflict"}), `${forwardPortDiagnosisMessage(diagnosis)}\n${owners}`, [
    {label:tr("navigation:menus.forward_try_close_owner", {defaultValue:"Try to close the occupying process"}), value:"kill", className:"danger"},
    {label:tr("navigation:menus.forward_use_recommended_port", {defaultValue:"Use recommended port"}), value:"recommend", className:"primary"},
    {label:tr("common:actions.cancel", {defaultValue:"Cancel"}), value:"cancel"}
  ]);
  if (choice === "kill") return offerKillPortOwners(diagnosis);
  if (choice === "recommend") {
    const recommended = await api("/api/ports/recommend", {method:"POST", body:JSON.stringify({host:forward.bind_host || "127.0.0.1", port:forward.bind_port})});
    const nextPort = recommended.recommended_port;
    if (!await confirmModal(
      tr("connections:forwards.recommended_port_confirm", {port:nextPort, defaultValue:`Use recommended port ${nextPort} and save this forwarding rule?`}),
      tr("connections:forwards.recommended_port_title", {defaultValue:"Use recommended port"}),
      tr("common:actions.save", {defaultValue:"Save"}),
      tr("common:actions.cancel", {defaultValue:"Cancel"})
    )) return false;
    await api(`/api/forwards/${forward.id}`, {method:"PUT", body:JSON.stringify({...forward, bind_port:nextPort})});
    await loadAll({silent:true});
    notify(tr("common:notifications.recommended_port_applied", {port:nextPort, defaultValue:`Switched to recommended port ${nextPort}`}), "success");
    return true;
  }
  return false;
}

async function startSingleForward(id, button=null) {
  const workspace = captureForwardWorkspace();
  setButtonBusy(button, true, tr("common:auto.starting", {defaultValue:"Starting..."}));
  try {
    const diagnosis = await diagnoseForwardPort(id, {silent:true});
    if (diagnosis.occupied) {
      const f = currentForward(id);
      const resolved = await offerResolvePortConflict(f, diagnosis);
      if (!resolved) {
        notify(forwardPortDiagnosisMessage(diagnosis), "error");
        return;
      }
    }
    await api(`/api/forwards/${id}/start`, {method:"POST"});
    await loadAll();
    workspace.refresh();
    notify(tr("common:notifications.forward_started_action", {defaultValue:"Forwarding started"}), "success");
  } catch (error) {
    await loadAll({silent:true}).catch(()=>{});
    notify(error.message || tr("common:notifications.exact.forward_start_failed_action", {defaultValue:"Failed to start forwarding"}), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function stopSingleForward(id, button=null) {
  const workspace = captureForwardWorkspace();
  setButtonBusy(button, true, tr("common:auto.stopping", {defaultValue:"Stopping..."}));
  try {
    await api(`/api/forwards/${id}/stop`, {method:"POST"});
    await loadAll();
    workspace.refresh();
    notify(tr("common:notifications.forward_stopped_action", {defaultValue:"Forwarding stopped"}), "success");
  } catch (error) {
    notify(error.message || tr("connections:forwards.stop_failed", {defaultValue:"Failed to stop forwarding"}), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function stopForwardFromRunning(id) {
  await api(`/api/forwards/${id}/stop`, {method:"POST"});
  await loadAll();
  renderRunningForwards();
  notify(tr("common:notifications.forward_stopped_action", {defaultValue:"Forwarding stopped"}), "success");
}

async function retryForwardFromRunning(id, button=null) {
  setButtonBusy(button, true, tr("common:auto.retrying", {defaultValue:"Retrying..."}));
  try {
    const forward = currentForward(id);
    if (forward && ["local", "socks"].includes(forward.mode)) {
      const diagnosis = await diagnoseForwardPort(id, {silent:true});
      if (diagnosis.occupied) {
        const resolved = await offerResolvePortConflict(forward, diagnosis);
        if (!resolved) {
          notify(tr("common:notifications.forward_port_retry_cancelled", {name:forwardDisplayName(forward), defaultValue:`${forwardDisplayName(forward)} was not retried because the port is still in use.`}), "error");
          return;
        }
      }
    }
    await api(`/api/forwards/${id}/stop`, {method:"POST"}).catch(()=>{});
    await api(`/api/forwards/${id}/start`, {method:"POST"});
    await loadAll();
    renderRunningForwards();
    notify(tr("common:notifications.forward_restarted_action", {defaultValue:"Forwarding restarted"}), "success");
  } catch (error) {
    await loadAll({silent:true}).catch(()=>{});
    renderRunningForwards();
    notify(error.message || tr("common:notifications.exact.forward_retry_failed_action", {defaultValue:"Failed to retry forwarding"}), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function bulkDeleteForwards(){
  const workspace = captureForwardWorkspace();
  const scope = typeof currentWorkspaceDomScope === "function" ? currentWorkspaceDomScope() : document;
  const ids=[...scope.querySelectorAll(".forward-check:checked")].map(x=>Number(x.value));
  if(!ids.length) return notify(tr("connections:forwards.select_rule", {defaultValue:"Select forwarding rules"}),"error");
  await api("/api/forwards/bulk-delete",{method:"POST",body:JSON.stringify({ids})});
  await loadAll();
  workspace.refresh();
  notify(tr("common:notifications.forwards_bulk_deleted", {defaultValue:"Bulk forwarding deletion completed"}),"success");
}
