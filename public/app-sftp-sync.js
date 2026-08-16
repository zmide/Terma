const productivityState = {
  quickItems:[],
  quickIndex:0,
  snippets:[],
  workspaces:[],
  closedTabs:[],
  broadcastTargets:new Set(),
  broadcastPaused:false,
  externalEditTimers:new Map(),
  externalEditPrompts:new Set(),
  externalEditPromptQueue:[],
  externalEditPromptActive:false,
  externalEditPromptSignatures:new Map(),
  externalEditObserved:new Map()
};

function externalEditorSettings() {
  return {
    mode:localStorage.getItem("sftpExternalEditorMode") || "system",
    path:localStorage.getItem("sftpExternalEditorPath") || "",
    args:(localStorage.getItem("sftpExternalEditorArgs") || "").match(/(?:[^\s"]+|"[^"]*")+/g)?.map(value => value.replace(/^"|"$/g, "")) || []
  };
}

function externalEditSavePolicy() {
  const saved = runtimeSettings?.saved || runtimeSettings || {};
  return {
    save_rule:saved.sftp_external_edit_save_rule === "overwrite" ? "overwrite" : "prompt",
    backup_on_auto_save:saved.sftp_external_edit_backup_enabled !== false
  };
}

async function openSftpExternalEdit(connectionId, remotePath) {
  const progress = createProgressToast({
    title:tr("sftp:external_edit.opening", {name:sftpOpenFilename(remotePath), defaultValue:"正在用外部编辑器打开 {{name}}"}),
    detail:tr("sftp:external_edit.preparing_copy", {defaultValue:"正在读取远程文件并准备本地副本..."}),
    icon:"external-link"
  });
  let session;
  try {
    session = await api(`/api/connections/${Number(connectionId)}/sftp/external-edit`, {
      method:"POST",
      body:JSON.stringify({path:remotePath, editor:externalEditorSettings(), ...externalEditSavePolicy()})
    });
  } catch (error) {
    progress.fail(error.message || tr("sftp:external_edit.open_failed", {defaultValue:"外部编辑器打开失败"}));
    return;
  }
  progress.finish(externalEditSavePolicy().save_rule === "overwrite"
    ? tr("sftp:external_edit.opened_overwrite", {defaultValue:"外部编辑器已打开；保存后会自动覆盖远端"})
    : tr("sftp:external_edit.opened_prompt", {defaultValue:"外部编辑器已打开；保存后会询问是否上传到远端"}), 3500);
  const timer = setInterval(() => pollSftpExternalEdit(session.id), 1200);
  productivityState.externalEditTimers.set(session.id, timer);
}

async function pollSftpExternalEdit(id) {
  let session;
  try { session = await api(`/api/sftp/external-edits/${id}`); }
  catch {
    clearInterval(productivityState.externalEditTimers.get(id));
    productivityState.externalEditTimers.delete(id);
    return;
  }
  if (session.status === "synced") {
    const signature = `${session.status}:${session.updated_at || ""}`;
    if (productivityState.externalEditObserved.get(id) !== signature) {
      productivityState.externalEditObserved.set(id, signature);
      notify(tr("sftp:external_edit.uploaded", {path:session.remote_path, defaultValue:"已上传：{{path}}"}), "success");
      if (typeof queueSftpDirectoryRefresh === "function") {
        queueSftpDirectoryRefresh(session.connection_id);
        flushPendingSftpDirectoryRefresh();
      }
    }
  }
  if (!new Set(["modified", "conflict"]).has(session.status)) return;
  await promptSftpExternalEdit(session);
}

async function promptSftpExternalEdit(session, force=false) {
  const id = String(session?.id || "");
  if (!id || !new Set(["modified", "conflict"]).has(session.status) || productivityState.externalEditPrompts.has(id)) return;
  const signature = `${session.status}:${session.updated_at || ""}`;
  if (!force && productivityState.externalEditPromptSignatures.get(id) === signature) return;
  productivityState.externalEditPromptSignatures.set(id, signature);
  productivityState.externalEditPrompts.add(id);
  productivityState.externalEditPromptQueue.push(session);
  return drainSftpExternalEditPrompts();
}

async function drainSftpExternalEditPrompts() {
  if (productivityState.externalEditPromptActive) return;
  productivityState.externalEditPromptActive = true;
  try {
    while (productivityState.externalEditPromptQueue.length) {
      const session = productivityState.externalEditPromptQueue.shift();
      const id = String(session?.id || "");
      try {
        const conflict = session.status === "conflict";
        let choice = await chooseModal(
          conflict
            ? tr("sftp:external_edit.conflict_title", {defaultValue:"远程文件已变化"})
            : tr("sftp:external_edit.modified_title", {defaultValue:"内容已由外部编辑器更改"}),
          `${session.connection_name}\n${session.remote_path}\n\n${conflict
            ? tr("sftp:external_edit.conflict_message", {defaultValue:"远端内容也发生了变化，请选择如何处理本地编辑内容。"})
            : tr("sftp:external_edit.modified_message", {defaultValue:"是否将外部编辑器中的更改保存到远端？"})}`,
          conflict ? [
            ...(session.can_compare ? [{label:tr("sftp:external_edit.compare", {defaultValue:"对比内容"}), value:"compare"}] : []),
            {label:tr("sftp:external_edit.overwrite_backup", {defaultValue:"覆盖远程并保留备份"}), value:"overwrite", className:"danger"},
            {label:tr("sftp:external_edit.save_as_remote", {defaultValue:"另存为远程文件"}), value:"save_as", className:"primary"},
            {label:tr("sftp:external_edit.postpone", {defaultValue:"暂不保存"}), value:"cancel"}
          ] : [
            ...(session.can_compare ? [{label:tr("sftp:external_edit.compare", {defaultValue:"对比内容"}), value:"compare"}] : []),
            {label:tr("sftp:external_edit.save_remote", {defaultValue:"保存到远端"}), value:"save", className:"primary"},
            {label:tr("sftp:external_edit.save_as_remote", {defaultValue:"另存为远程文件"}), value:"save_as"},
            {label:tr("sftp:external_edit.postpone", {defaultValue:"暂不保存"}), value:"cancel"}
          ]
        );
        if (choice === "compare") {
          try {
            const comparison = await api(`/api/sftp/external-edits/${encodeURIComponent(id)}/comparison`);
            choice = await openSftpExternalComparison(session, comparison);
          } catch (error) {
            notify(error.message || tr("sftp:external_edit.compare_failed", {defaultValue:"无法生成文本对比"}), "error");
            continue;
          }
        }
        const payload = {action:choice};
        if (choice === "save_as") {
          const remotePath = await inputModal(
            tr("sftp:external_edit.save_as_remote", {defaultValue:"另存为远程文件"}),
            tr("sftp:external_edit.remote_path", {defaultValue:"远程路径"}),
            `${session.remote_path}.local`
          );
          if (!remotePath) continue;
          payload.remote_path = remotePath;
        }
        if (!choice) continue;
        const resolved = await api(`/api/sftp/external-edits/${id}/resolve`, {method:"POST", body:JSON.stringify(payload)});
        const resolutionKey = resolved.status === "conflict"
          ? "conflict_pending"
          : choice === "cancel"
            ? "changes_not_saved"
            : choice === "save_as"
              ? "saved_as_remote"
              : choice === "overwrite"
                ? "overwritten_backup"
                : "saved_backup";
        const resolutionMessage = {
          conflict_pending:tr("sftp:external_edit.conflict_pending", {defaultValue:"远端文件仍有冲突，请重新选择处理方式"}),
          changes_not_saved:tr("sftp:external_edit.changes_not_saved", {defaultValue:"本地更改暂未保存到远端"}),
          saved_as_remote:tr("sftp:external_edit.saved_as_remote", {defaultValue:"本地更改已另存为远程文件"}),
          overwritten_backup:tr("sftp:external_edit.overwritten_backup", {defaultValue:"远程文件已覆盖，原文件已备份"}),
          saved_backup:tr("sftp:external_edit.saved_backup", {defaultValue:"更改已保存到远端，原文件已备份"})
        }[resolutionKey];
        notify(resolutionMessage, resolved.status === "conflict" || choice === "cancel" ? "info" : "success");
        if (resolved.status === "synced" && typeof queueSftpDirectoryRefresh === "function") {
          queueSftpDirectoryRefresh(resolved.connection_id);
          flushPendingSftpDirectoryRefresh();
        }
      } finally {
        productivityState.externalEditPrompts.delete(id);
      }
    }
  } finally {
    productivityState.externalEditPromptActive = false;
  }
}

async function promptSftpExternalEditById(id) {
  const session = await api(`/api/sftp/external-edits/${encodeURIComponent(id)}`);
  closeModal();
  return promptSftpExternalEdit(session, true);
}

async function openSftpExternalEditManager() {
  const sessions = await api("/api/sftp/external-edits").catch(() => []);
  const modal = $("modal");
  modal.hidden = false;
  const refreshLabel = tr("common:auto.refresh", {defaultValue:"刷新"});
  modal.innerHTML = `<div class="modal-card wide productivity-manager"><div class="productivity-manager-head"><div><h2>${esc(tr("sftp:external_edit.manager_title", {defaultValue:"外部编辑会话"}))}</h2><span>${esc(tr("sftp:external_edit.count", {count:sessions.length, defaultValue:"{{count}} 个"}))}</span></div><button class="icon-button" title="${escAttr(refreshLabel)}" aria-label="${escAttr(refreshLabel)}" onclick="openSftpExternalEditManager()">${icon("refresh-cw")}</button></div><div class="productivity-list">${sessions.length ? sessions.map(session => `<div class="productivity-row"><span class="quick-result-icon">${icon(session.status === "conflict" ? "triangle-alert" : "file-pen-line")}</span><div><strong>${esc(session.remote_path)}</strong><small>${esc(session.connection_name)} · ${esc(sftpExternalEditStatusLabel(session.status))}</small><code>${esc(session.local_path)}</code></div><div class="actions tight">${new Set(["modified", "conflict"]).has(session.status) ? `<button class="primary" onclick="promptSftpExternalEditById('${escAttr(session.id)}')">${esc(tr("sftp:external_edit.handle_changes", {defaultValue:"处理更改"}))}</button>` : ""}<button class="danger" onclick="stopSftpExternalEdit('${escAttr(session.id)}')">${esc(tr("sftp:external_edit.stop_cleanup", {defaultValue:"停止并清理"}))}</button></div></div>`).join("") : stateView("empty", tr("sftp:external_edit.empty_title", {defaultValue:"暂无外部编辑会话"}), tr("sftp:external_edit.empty_hint", {defaultValue:"从 SFTP 文件右键菜单使用外部编辑器打开后会显示在这里。"}))}</div><div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button></div></div>`;
  refreshIcons();
}

function sftpExternalEditStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  const labels = {
    watching:tr("sftp:external_edit.status_watching", {defaultValue:"等待外部编辑器保存"}),
    modified:tr("sftp:external_edit.status_modified", {defaultValue:"内容已更改，等待处理"}),
    conflict:tr("sftp:external_edit.status_conflict", {defaultValue:"远端文件有冲突"}),
    synced:tr("sftp:external_edit.status_synced", {defaultValue:"已同步到远端"}),
    error:tr("sftp:external_edit.status_error", {defaultValue:"外部编辑会话出错"})
  };
  return labels[normalized] || String(status || "");
}

async function stopSftpExternalEdit(id) {
  await api(`/api/sftp/external-edits/${encodeURIComponent(id)}`, {method:"DELETE"});
  clearInterval(productivityState.externalEditTimers.get(id));
  productivityState.externalEditTimers.delete(id);
  productivityState.externalEditPromptSignatures.delete(id);
  productivityState.externalEditPrompts.delete(id);
  productivityState.externalEditPromptQueue = productivityState.externalEditPromptQueue.filter(session => String(session?.id || "") !== String(id));
  productivityState.externalEditObserved.delete(id);
  await openSftpExternalEditManager();
}

async function chooseSftpSyncLocalDirectory() {
  const result = await api("/api/sftp/sync/choose-directory", {method:"POST", body:"{}"});
  return String(result?.path || "");
}

async function openSftpDirectorySync(connectionId, remotePath=".", tabKey=activeTabKey) {
  if (!window.termaDesktop) return notify(tr("sftp:sync.desktop_only", {defaultValue:"目录同步仅在桌面端提供"}), "info");
  let localPath = "";
  try { localPath = await chooseSftpSyncLocalDirectory(); }
  catch (error) { return notify(error.message || tr("sftp:sync.choose_local_failed", {defaultValue:"无法选择本地目录"}), "error"); }
  if (!localPath) return;
  const connection = currentConnection(Number(connectionId));
  const modal = $("modal");
  modal.hidden = false;
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  modal.innerHTML = `<div class="modal-card wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>${esc(tr("sftp:sync.title", {defaultValue:"目录比较与同步"}))}</h2><span>${esc(connection?.name || tr("sftp:sync.ssh_host", {defaultValue:"SSH 主机"}))}</span></div><button class="icon-button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-paths"><label>${esc(tr("sftp:sync.local_directory", {defaultValue:"本地目录"}))}<input id="sftpSyncLocalPath" value="${escAttr(localPath)}" readonly></label><label>${esc(tr("sftp:sync.remote_directory", {defaultValue:"远程目录"}))}<input id="sftpSyncRemotePath" value="${escAttr(remotePath || ".")}" readonly></label></div>
    <div class="form-grid sftp-sync-options"><label>${esc(tr("sftp:sync.mode", {defaultValue:"同步方式"}))}<select id="sftpSyncMode"><option value="bidirectional">${esc(tr("sftp:sync.bidirectional", {defaultValue:"双向同步"}))}</option><option value="upload">${esc(tr("sftp:sync.upload_only", {defaultValue:"仅上传到远程"}))}</option><option value="download">${esc(tr("sftp:sync.download_only", {defaultValue:"仅下载到本地"}))}</option></select></label><label class="checkline"><input id="sftpSyncUseHash" type="checkbox">${esc(tr("sftp:sync.use_hash", {defaultValue:"内容不明确时校验 SHA-256"}))}</label></div>
    <label>${esc(tr("sftp:sync.excludes", {defaultValue:"附加排除规则"}))}<textarea id="sftpSyncExcludes" rows="3" placeholder="${escAttr(tr("sftp:sync.excludes_placeholder", {defaultValue:"每行一个，例如 build 或 *.log"}))}"></textarea></label>
    <div class="sftp-sync-safety">${icon("shield-check")}<span>${esc(tr("sftp:sync.safety", {defaultValue:"只同步勾选项目，不会删除本地或远程文件；远程覆盖会先保留备份。"}))}</span></div>
    <div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button class="primary" onclick="createSftpSyncPlan(${Number(connectionId)},'${escAttr(tabKey)}')">${icon("scan-search")}<span>${esc(tr("sftp:sync.generate_plan", {defaultValue:"生成变更清单"}))}</span></button></div></div>`;
  refreshIcons();
}

async function createSftpSyncPlan(connectionId, tabKey=activeTabKey) {
  const request = {
    local_path:$("sftpSyncLocalPath")?.value || "",
    remote_path:$("sftpSyncRemotePath")?.value || ".",
    mode:$("sftpSyncMode")?.value || "bidirectional",
    use_hash:Boolean($("sftpSyncUseHash")?.checked),
    excludes:$("sftpSyncExcludes")?.value || ""
  };
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card"><h2>${esc(tr("sftp:sync.comparing_title", {defaultValue:"正在比较目录"}))}</h2>${stateView("loading", tr("sftp:sync.scanning", {defaultValue:"正在扫描本地和远程文件"}), tr("sftp:sync.progress_hint", {defaultValue:"可在工作区任务中心查看进度"}))}</div>`;
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/plan`, {method:"POST", body:JSON.stringify(request)});
    if (typeof refreshSftpJobs === "function") refreshSftpJobs();
    let current = job;
    while (current.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 600));
      current = await api(`/api/sftp/sync/jobs/${encodeURIComponent(job.id)}`);
    }
    if (current.status === "cancelled") return closeModal();
    if (current.status !== "completed" || !current.plan_result) throw new Error(current.errors?.[0]?.error || tr("sftp:sync.compare_failed", {defaultValue:"目录比较失败"}));
    renderSftpSyncPlan(connectionId, current.plan_result, tabKey);
  } catch (error) {
    modal.innerHTML = `<div class="modal-card"><h2>${esc(tr("sftp:sync.compare_failed", {defaultValue:"目录比较失败"}))}</h2>${stateView("error", tr("sftp:sync.plan_failed", {defaultValue:"无法生成同步清单"}), error.message || String(error))}<div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button><button class="primary" onclick="openSftpDirectorySync(${Number(connectionId)},'${escAttr(request.remote_path)}','${escAttr(tabKey)}')">${esc(tr("common:actions.retry", {defaultValue:"重试"}))}</button></div></div>`;
  }
}

function sftpSyncActionLabel(action) {
  return {
    upload:tr("sftp:sync.action_upload", {defaultValue:"上传"}),
    download:tr("sftp:sync.action_download", {defaultValue:"下载"}),
    conflict:tr("sftp:sync.action_conflict", {defaultValue:"冲突"})
  }[action] || action;
}

function sftpSyncReasonLabel(reason) {
  return {
    "两端内容不同":tr("sftp:sync.reason_different", {defaultValue:"两端内容不同"}),
    "本地与远程不同":tr("sftp:sync.reason_local_remote_different", {defaultValue:"本地与远程不同"}),
    "远程缺少文件":tr("sftp:sync.reason_remote_missing", {defaultValue:"远程缺少文件"}),
    "本地缺少文件":tr("sftp:sync.reason_local_missing", {defaultValue:"本地缺少文件"}),
    "本地文件较新":tr("sftp:sync.reason_local_newer", {defaultValue:"本地文件较新"}),
    "远程文件较新":tr("sftp:sync.reason_remote_newer", {defaultValue:"远程文件较新"}),
    "冲突：已选择上传本地文件":tr("sftp:sync.reason_conflict_upload", {defaultValue:"冲突：已选择上传本地文件"}),
    "冲突：已选择下载远程文件":tr("sftp:sync.reason_conflict_download", {defaultValue:"冲突：已选择下载远程文件"})
  }[String(reason || "")] || String(reason || "");
}

function renderSftpSyncPlan(connectionId, plan, tabKey=activeTabKey) {
  const modal = $("modal");
  modal._sftpSyncPlan = plan;
  const totals = plan.totals || {};
  const closeLabel = tr("common:actions.close", {defaultValue:"关闭"});
  modal.innerHTML = `<div class="modal-card extra-wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>${esc(tr("sftp:sync.plan_title", {defaultValue:"确认同步清单"}))}</h2><span>${esc(tr("sftp:sync.totals", {upload:Number(totals.upload || 0), download:Number(totals.download || 0), conflict:Number(totals.conflict || 0), defaultValue:"{{upload}} 项上传 · {{download}} 项下载 · {{conflict}} 项冲突"}))}</span></div><button class="icon-button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-plan-head"><label class="checkline"><input id="sftpSyncSelectAll" type="checkbox" checked onchange="toggleSftpSyncPlanSelection(this.checked)">${esc(tr("sftp:sync.select_non_conflicts", {defaultValue:"选择全部非冲突项目"}))}</label><span>${esc(plan.local_path)} ⇄ ${esc(plan.remote_path)}</span></div>
    <div class="sftp-sync-plan-list">${plan.actions.length ? plan.actions.map(item => `<div class="sftp-sync-plan-row ${escAttr(item.action)}"><input class="sftp-sync-plan-check" type="checkbox" value="${item.index}" ${item.selected ? "checked" : ""} ${item.action === "conflict" ? "disabled" : ""}><span class="sftp-sync-direction">${icon(item.action === "upload" ? "upload" : item.action === "download" ? "download" : "triangle-alert")}<strong>${esc(sftpSyncActionLabel(item.action))}</strong></span><div><strong title="${escAttr(item.relative)}">${esc(item.relative)}</strong><small>${esc(sftpSyncReasonLabel(item.reason))}</small></div>${item.action === "conflict" ? `<select class="sftp-sync-conflict-direction" data-index="${item.index}" onchange="setSftpSyncConflictDirection(${item.index},this.value)"><option value="">${esc(tr("sftp:sync.conflict_skip", {defaultValue:"暂不处理"}))}</option><option value="upload">${esc(tr("sftp:sync.conflict_upload", {defaultValue:"上传本地版本"}))}</option><option value="download">${esc(tr("sftp:sync.conflict_download", {defaultValue:"下载远程版本"}))}</option></select>` : `<span class="sftp-sync-size">${item.local_size === null ? "-" : formatBytes(item.local_size)} / ${item.remote_size === null ? "-" : formatBytes(item.remote_size)}</span>`}</div>`).join("") : stateView("empty", tr("sftp:sync.empty_title", {defaultValue:"两端内容一致"}), tr("sftp:sync.empty_hint", {defaultValue:"没有需要同步的文件"}))}</div>
    <div class="actions"><button onclick="closeModal()">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button><button ${plan.actions.length ? "" : "disabled"} class="primary" onclick="executeSftpSyncPlan(${Number(connectionId)},'${escAttr(plan.id)}','${escAttr(tabKey)}')">${icon("play")}<span>${esc(tr("sftp:sync.execute_selected", {defaultValue:"执行所选项目"}))}</span></button></div></div>`;
  refreshIcons();
}

function toggleSftpSyncPlanSelection(checked) {
  document.querySelectorAll(".sftp-sync-plan-check:not(:disabled)").forEach(input => { input.checked = checked; });
}

function setSftpSyncConflictDirection(index, direction) {
  const input = document.querySelector(`.sftp-sync-plan-check[value="${Number(index)}"]`);
  if (!input) return;
  input.disabled = !direction;
  input.checked = Boolean(direction);
}

async function executeSftpSyncPlan(connectionId, planId, tabKey=activeTabKey) {
  const selected = [...document.querySelectorAll(".sftp-sync-plan-check:checked")].map(input => Number(input.value));
  if (!selected.length) return notify(tr("sftp:sync.select_one", {defaultValue:"请选择至少一个同步项目"}), "info");
  const overrides = {};
  document.querySelectorAll(".sftp-sync-conflict-direction").forEach(select => {
    if (select.value) overrides[Number(select.dataset.index)] = select.value;
  });
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/execute`, {method:"POST", body:JSON.stringify({plan_id:planId, selected_indexes:selected, overrides})});
    closeModal();
    notify(tr("sftp:sync.started", {count:job.total || selected.length, defaultValue:"目录同步已开始，共 {{count}} 项"}), "success");
    if (typeof refreshSftpJobs === "function") await refreshSftpJobs();
    if (typeof openSftpTaskList === "function") openSftpTaskList();
    productivityState.syncRefreshTabKey = tabKey;
  } catch (error) {
    notify(error.message || tr("sftp:sync.start_failed", {defaultValue:"目录同步启动失败"}), "error");
  }
}
