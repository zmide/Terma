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
    title:`正在用外部编辑器打开 ${sftpOpenFilename(remotePath)}`,
    detail:"正在读取远程文件并准备本地副本...",
    icon:"external-link"
  });
  let session;
  try {
    session = await api(`/api/connections/${Number(connectionId)}/sftp/external-edit`, {
      method:"POST",
      body:JSON.stringify({path:remotePath, editor:externalEditorSettings(), ...externalEditSavePolicy()})
    });
  } catch (error) {
    progress.fail(error.message || "外部编辑器打开失败");
    return;
  }
  progress.finish(externalEditSavePolicy().save_rule === "overwrite" ? "外部编辑器已打开；保存后会自动覆盖远端" : "外部编辑器已打开；保存后会询问是否上传到远端", 3500);
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
      notify(`已上传：${session.remote_path}`, "success");
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
          conflict ? "远程文件已变化" : "内容已由外部编辑器更改",
          `${session.connection_name}\n${session.remote_path}\n\n${conflict ? "远端内容也发生了变化，请选择如何处理本地编辑内容。" : "是否将外部编辑器中的更改保存到远端？"}`,
          conflict ? [
            ...(session.can_compare ? [{label:"对比内容", value:"compare"}] : []),
            {label:"覆盖远程并保留备份", value:"overwrite", className:"danger"},
            {label:"另存为远程文件", value:"save_as", className:"primary"},
            {label:"暂不保存", value:"cancel"}
          ] : [
            ...(session.can_compare ? [{label:"对比内容", value:"compare"}] : []),
            {label:"保存到远端", value:"save", className:"primary"},
            {label:"另存为远程文件", value:"save_as"},
            {label:"暂不保存", value:"cancel"}
          ]
        );
        if (choice === "compare") {
          try {
            const comparison = await api(`/api/sftp/external-edits/${encodeURIComponent(id)}/comparison`);
            choice = await openSftpExternalComparison(session, comparison);
          } catch (error) {
            notify(error.message || "无法生成文本对比", "error");
            continue;
          }
        }
        const payload = {action:choice};
        if (choice === "save_as") {
          const remotePath = await inputModal("另存为远程文件", "远程路径", `${session.remote_path}.local`);
          if (!remotePath) continue;
          payload.remote_path = remotePath;
        }
        if (!choice) continue;
        const resolved = await api(`/api/sftp/external-edits/${id}/resolve`, {method:"POST", body:JSON.stringify(payload)});
        if (resolved.status === "conflict") notify(resolved.message, "info");
        else notify(resolved.message, choice === "cancel" ? "info" : "success");
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
  modal.innerHTML = `<div class="modal-card wide productivity-manager"><div class="productivity-manager-head"><div><h2>外部编辑会话</h2><span>${sessions.length} 个</span></div><button class="icon-button" title="刷新" aria-label="刷新" onclick="openSftpExternalEditManager()">${icon("refresh-cw")}</button></div><div class="productivity-list">${sessions.length ? sessions.map(session => `<div class="productivity-row"><span class="quick-result-icon">${icon(session.status === "conflict" ? "triangle-alert" : "file-pen-line")}</span><div><strong>${esc(session.remote_path)}</strong><small>${esc(session.connection_name)} · ${esc(session.message || session.status)}</small><code>${esc(session.local_path)}</code></div><div class="actions tight">${new Set(["modified", "conflict"]).has(session.status) ? `<button class="primary" onclick="promptSftpExternalEditById('${escAttr(session.id)}')">处理更改</button>` : ""}<button class="danger" onclick="stopSftpExternalEdit('${escAttr(session.id)}')">停止并清理</button></div></div>`).join("") : stateView("empty", "暂无外部编辑会话", "从 SFTP 文件右键菜单使用外部编辑器打开后会显示在这里。")}</div><div class="actions"><button onclick="closeModal()">关闭</button></div></div>`;
  refreshIcons();
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
  if (!window.termaDesktop) return notify("目录同步仅在桌面端提供", "info");
  let localPath = "";
  try { localPath = await chooseSftpSyncLocalDirectory(); }
  catch (error) { return notify(error.message || "无法选择本地目录", "error"); }
  if (!localPath) return;
  const connection = currentConnection(Number(connectionId));
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>目录比较与同步</h2><span>${esc(connection?.name || "SSH 主机")}</span></div><button class="icon-button" title="关闭" aria-label="关闭" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-paths"><label>本地目录<input id="sftpSyncLocalPath" value="${escAttr(localPath)}" readonly></label><label>远程目录<input id="sftpSyncRemotePath" value="${escAttr(remotePath || ".")}" readonly></label></div>
    <div class="form-grid sftp-sync-options"><label>同步方式<select id="sftpSyncMode"><option value="bidirectional">双向同步</option><option value="upload">仅上传到远程</option><option value="download">仅下载到本地</option></select></label><label class="checkline"><input id="sftpSyncUseHash" type="checkbox">内容不明确时校验 SHA-256</label></div>
    <label>附加排除规则<textarea id="sftpSyncExcludes" rows="3" placeholder="每行一个，例如 build 或 *.log"></textarea></label>
    <div class="sftp-sync-safety">${icon("shield-check")}<span>只同步勾选项目，不会删除本地或远程文件；远程覆盖会先保留备份。</span></div>
    <div class="actions"><button onclick="closeModal()">取消</button><button class="primary" onclick="createSftpSyncPlan(${Number(connectionId)},'${escAttr(tabKey)}')">${icon("scan-search")}<span>生成变更清单</span></button></div></div>`;
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
  modal.innerHTML = `<div class="modal-card"><h2>正在比较目录</h2>${stateView("loading", "正在扫描本地和远程文件", "可在工作区任务中心查看进度")}</div>`;
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/plan`, {method:"POST", body:JSON.stringify(request)});
    if (typeof refreshSftpJobs === "function") refreshSftpJobs();
    let current = job;
    while (current.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 600));
      current = await api(`/api/sftp/sync/jobs/${encodeURIComponent(job.id)}`);
    }
    if (current.status === "cancelled") return closeModal();
    if (current.status !== "completed" || !current.plan_result) throw new Error(current.errors?.[0]?.error || "目录比较失败");
    renderSftpSyncPlan(connectionId, current.plan_result, tabKey);
  } catch (error) {
    modal.innerHTML = `<div class="modal-card"><h2>目录比较失败</h2>${stateView("error", "无法生成同步清单", error.message || String(error))}<div class="actions"><button onclick="closeModal()">关闭</button><button class="primary" onclick="openSftpDirectorySync(${Number(connectionId)},'${escAttr(request.remote_path)}','${escAttr(tabKey)}')">重试</button></div></div>`;
  }
}

function sftpSyncActionLabel(action) {
  return {upload:"上传", download:"下载", conflict:"冲突"}[action] || action;
}

function renderSftpSyncPlan(connectionId, plan, tabKey=activeTabKey) {
  const modal = $("modal");
  modal._sftpSyncPlan = plan;
  const totals = plan.totals || {};
  modal.innerHTML = `<div class="modal-card extra-wide sftp-sync-modal" role="dialog" aria-modal="true"><div class="productivity-manager-head"><div><h2>确认同步清单</h2><span>${Number(totals.upload || 0)} 项上传 · ${Number(totals.download || 0)} 项下载 · ${Number(totals.conflict || 0)} 项冲突</span></div><button class="icon-button" title="关闭" aria-label="关闭" onclick="closeModal()">${icon("x")}</button></div>
    <div class="sftp-sync-plan-head"><label class="checkline"><input id="sftpSyncSelectAll" type="checkbox" checked onchange="toggleSftpSyncPlanSelection(this.checked)">选择全部非冲突项目</label><span>${esc(plan.local_path)} ⇄ ${esc(plan.remote_path)}</span></div>
    <div class="sftp-sync-plan-list">${plan.actions.length ? plan.actions.map(item => `<div class="sftp-sync-plan-row ${escAttr(item.action)}"><input class="sftp-sync-plan-check" type="checkbox" value="${item.index}" ${item.selected ? "checked" : ""} ${item.action === "conflict" ? "disabled" : ""}><span class="sftp-sync-direction">${icon(item.action === "upload" ? "upload" : item.action === "download" ? "download" : "triangle-alert")}<strong>${sftpSyncActionLabel(item.action)}</strong></span><div><strong title="${escAttr(item.relative)}">${esc(item.relative)}</strong><small>${esc(item.reason)}</small></div>${item.action === "conflict" ? `<select class="sftp-sync-conflict-direction" data-index="${item.index}" onchange="setSftpSyncConflictDirection(${item.index},this.value)"><option value="">暂不处理</option><option value="upload">上传本地版本</option><option value="download">下载远程版本</option></select>` : `<span class="sftp-sync-size">${item.local_size === null ? "-" : formatBytes(item.local_size)} / ${item.remote_size === null ? "-" : formatBytes(item.remote_size)}</span>`}</div>`).join("") : stateView("empty", "两端内容一致", "没有需要同步的文件")}</div>
    <div class="actions"><button onclick="closeModal()">取消</button><button ${plan.actions.length ? "" : "disabled"} class="primary" onclick="executeSftpSyncPlan(${Number(connectionId)},'${escAttr(plan.id)}','${escAttr(tabKey)}')">${icon("play")}<span>执行所选项目</span></button></div></div>`;
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
  if (!selected.length) return notify("请选择至少一个同步项目", "info");
  const overrides = {};
  document.querySelectorAll(".sftp-sync-conflict-direction").forEach(select => {
    if (select.value) overrides[Number(select.dataset.index)] = select.value;
  });
  try {
    const job = await api(`/api/connections/${Number(connectionId)}/sftp/sync/execute`, {method:"POST", body:JSON.stringify({plan_id:planId, selected_indexes:selected, overrides})});
    closeModal();
    notify(`目录同步已开始，共 ${job.total || selected.length} 项`, "success");
    if (typeof refreshSftpJobs === "function") await refreshSftpJobs();
    if (typeof openSftpTaskList === "function") openSftpTaskList();
    productivityState.syncRefreshTabKey = tabKey;
  } catch (error) {
    notify(error.message || "目录同步启动失败", "error");
  }
}
