let sftpAutomationState = {items:[],runs:[],tab:"all",editing:null,connections:[],history:{automationId:0,page:1,total:0,totalPages:1,historyLimit:300}};
let sftpAutomationRemotePicker = {path:".",nodes:new Map(),expanded:new Set(["."])};
let sftpAutomationCronTimer = 0;
let sftpAutomationRefreshTimer = 0;
let sftpAutomationRefreshEpoch = 0;
let sftpAutomationDrag = null;

function sftpAutomationLabel(key, options={}) {
  return tr(`sftp:automation.${key}`, {defaultValue:options.defaultValue || key, ...options});
}

function installSftpAutomationQuickAction(host=document.getElementById("workspaceQuickActions")) {
  if (!host || document.getElementById("sftpAutomationQuickButton")) return;
  const button = document.createElement("button");
  button.id = "sftpAutomationQuickButton";
  button.className = "icon-button sftp-automation-quick-button";
  button.type = "button";
  button.dataset.action = "sftp-automation-open";
  button.title = sftpAutomationLabel("open", {defaultValue:"传输与同步"});
  button.setAttribute("aria-label", button.title);
  button.innerHTML = icon("folder-sync");
  host.appendChild(button);
}

async function loadSftpAutomations() {
  if (!window.termaDesktop) return [];
  const result = await api("/api/sftp/automations");
  sftpAutomationState.items = Array.isArray(result) ? result : [];
  return sftpAutomationState.items;
}

function sftpAutomationDate(value) {
  if (!value) return sftpAutomationLabel("never", {defaultValue:"未安排"});
  try { return new Date(Number(value) * 1000).toLocaleString(); } catch { return ""; }
}

function sftpAutomationStatus(item) {
  const key = sftpAutomationStatusKey(item);
  return {
    idle:sftpAutomationLabel("status_idle", {defaultValue:"已启用"}),
    running:sftpAutomationLabel("status_running", {defaultValue:"运行中"}),
    done:sftpAutomationLabel("status_done", {defaultValue:"上次成功"}),
    failed:sftpAutomationLabel("status_failed", {defaultValue:"上次失败"}),
    needs_attention:sftpAutomationLabel("status_attention", {defaultValue:"需要处理"}),
    paused:sftpAutomationLabel("status_paused", {defaultValue:"已暂停"})
  }[key] || key;
}

function sftpAutomationDirection(item) {
  return {
    upload:sftpAutomationLabel("upload", {defaultValue:"上传"}),
    download:sftpAutomationLabel("download", {defaultValue:"下载"}),
    bidirectional:sftpAutomationLabel("bidirectional", {defaultValue:"双向同步"})
  }[item?.direction] || item?.direction || "";
}

function sftpAutomationStatusKey(item) {
  if (item?.enabled === false) return "paused";
  const key = String(item?.last_status || (item?.enabled ? "idle" : "paused"));
  return ["idle", "running", "done", "failed", "needs_attention", "paused"].includes(key) ? key : "idle";
}

function sftpAutomationStatusClass(item) {
  const key = sftpAutomationStatusKey(item);
  if (key === "failed" || key === "needs_attention") return "status-attention";
  return `status-${key}`;
}

function sftpAutomationTitle(mode="new") {
  return sftpAutomationLabel(mode === "edit" ? "edit_title" : "new_title", {defaultValue:mode === "edit" ? "编辑传输与同步任务" : "新建传输与同步任务"});
}

function sftpAutomationTaskKindIcon(kind) {
  return kind === "sync" ? "folder-sync" : "calendar-clock";
}

function sftpAutomationIsRealtime(item) {
  return item?.kind === "sync" && (item?.trigger_mode === "continuous" || item?.schedule?.frequency === "realtime");
}

function stopSftpAutomationManagerRefresh() {
  if (sftpAutomationRefreshTimer) clearTimeout(sftpAutomationRefreshTimer);
  sftpAutomationRefreshTimer = 0;
  sftpAutomationRefreshEpoch += 1;
}

function sftpAutomationManagerIsOpen() {
  return Boolean(document.querySelector('.sftp-automation-manager[data-sftp-automation-view="manager"]'));
}

function renderSftpAutomationManagerList() {
  const list = document.querySelector('.sftp-automation-manager[data-sftp-automation-view="manager"] .sftp-automation-list');
  if (!list) return false;
  const scrollTop = list.scrollTop;
  const items = sftpAutomationState.items;
  list.innerHTML = items.length ? items.map(sftpAutomationRow).join("") : sftpAutomationEmptyState();
  list.scrollTop = Math.min(scrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
  refreshIcons();
  return true;
}

function scheduleSftpAutomationManagerRefresh(epoch, delay) {
  if (epoch !== sftpAutomationRefreshEpoch || !sftpAutomationManagerIsOpen()) return;
  if (sftpAutomationRefreshTimer) clearTimeout(sftpAutomationRefreshTimer);
  sftpAutomationRefreshTimer = setTimeout(async () => {
    sftpAutomationRefreshTimer = 0;
    if (epoch !== sftpAutomationRefreshEpoch || !sftpAutomationManagerIsOpen()) return;
    const previous = JSON.stringify(sftpAutomationState.items);
    try {
      await loadSftpAutomations();
      if (epoch !== sftpAutomationRefreshEpoch || !sftpAutomationManagerIsOpen()) return;
      if (JSON.stringify(sftpAutomationState.items) !== previous) renderSftpAutomationManagerList();
    } catch {}
    if (epoch !== sftpAutomationRefreshEpoch || !sftpAutomationManagerIsOpen()) return;
    const running = sftpAutomationState.items.some(item => sftpAutomationStatusKey(item) === "running");
    scheduleSftpAutomationManagerRefresh(epoch, document.hidden ? 5000 : running ? 900 : 3000);
  }, Math.max(250, Number(delay) || 0));
}

function startSftpAutomationManagerRefresh() {
  stopSftpAutomationManagerRefresh();
  const epoch = sftpAutomationRefreshEpoch;
  const running = sftpAutomationState.items.some(item => sftpAutomationStatusKey(item) === "running");
  scheduleSftpAutomationManagerRefresh(epoch, running ? 900 : 3000);
}

function sftpAutomationOrderIds(list) {
  return [...(list?.querySelectorAll?.(":scope > [data-sftp-automation-id]") || [])]
    .map(row => Number(row.dataset.sftpAutomationId || 0))
    .filter(id => Number.isSafeInteger(id) && id > 0);
}

async function persistSftpAutomationOrder(list) {
  const ids = sftpAutomationOrderIds(list);
  if (!ids.length || ids.length !== sftpAutomationState.items.length) return startSftpAutomationManagerRefresh();
  const previous = [...sftpAutomationState.items];
  const byId = new Map(previous.map(item => [Number(item.id), item]));
  sftpAutomationState.items = ids.map((id, index) => ({...byId.get(id),sort_order:index + 1}));
  try {
    await api("/api/sftp/automations/reorder", {method:"POST",body:JSON.stringify({ids})});
  } catch (error) {
    sftpAutomationState.items = previous;
    renderSftpAutomationManagerList();
    notify(error.message || sftpAutomationLabel("sort_save_failed", {defaultValue:"保存任务顺序失败，请刷新后重试"}), "error");
  } finally {
    if (sftpAutomationManagerIsOpen()) startSftpAutomationManagerRefresh();
  }
}

function moveSftpAutomationByKeyboard(event, handle) {
  if (!handle || !["ArrowUp","ArrowDown"].includes(event.key)) return;
  const row = handle.closest("[data-sftp-automation-id]");
  const list = row?.parentElement;
  if (!row || !list) return;
  const rows = [...list.querySelectorAll(":scope > [data-sftp-automation-id]")];
  const index = rows.indexOf(row);
  const target = rows[index + (event.key === "ArrowUp" ? -1 : 1)];
  if (!target) return;
  event.preventDefault();
  stopSftpAutomationManagerRefresh();
  if (event.key === "ArrowUp") list.insertBefore(row, target);
  else list.insertBefore(target, row);
  const id = Number(row.dataset.sftpAutomationId || 0);
  void persistSftpAutomationOrder(list).then(() => requestAnimationFrame(() => list.querySelector(`[data-sftp-automation-id="${id}"] .sftp-automation-drag-handle`)?.focus()));
}

function beginSftpAutomationDrag(event, handle) {
  const row = handle?.closest?.("[data-sftp-automation-id]");
  const list = row?.parentElement;
  if (!handle || !row || !list || event.button !== 0 || sftpAutomationDrag) return;
  event.preventDefault();
  event.stopPropagation();
  stopSftpAutomationManagerRefresh();
  const originalIds = sftpAutomationOrderIds(list);
  const state = {handle,row,list,pointerId:event.pointerId,startY:event.clientY,moved:false,originalIds};
  sftpAutomationDrag = state;
  row.classList.add("dragging");
  list.classList.add("sorting");
  try { handle.setPointerCapture?.(event.pointerId); } catch {}
  const move = moveEvent => {
    if (sftpAutomationDrag !== state || moveEvent.pointerId !== state.pointerId) return;
    if (!state.moved && Math.abs(moveEvent.clientY - state.startY) < 4) return;
    state.moved = true;
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.("[data-sftp-automation-id]")
      || [...list.querySelectorAll(":scope > [data-sftp-automation-id]")].filter(item => item !== row).find(item => {
        const rect = item.getBoundingClientRect();
        return moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom;
      });
    if (!target || target === row || target.parentElement !== list) return;
    const rect = target.getBoundingClientRect();
    list.insertBefore(row, moveEvent.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
    const listRect = list.getBoundingClientRect();
    if (moveEvent.clientY < listRect.top + 36) list.scrollTop -= 24;
    else if (moveEvent.clientY > listRect.bottom - 36) list.scrollTop += 24;
  };
  const finish = finishEvent => {
    if (sftpAutomationDrag !== state) return;
    sftpAutomationDrag = null;
    row.classList.remove("dragging");
    list.classList.remove("sorting");
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    if (finishEvent.type === "pointercancel") {
      const byId = new Map([...list.querySelectorAll(":scope > [data-sftp-automation-id]")].map(item => [Number(item.dataset.sftpAutomationId || 0), item]));
      state.originalIds.forEach(id => { const item = byId.get(id); if (item) list.appendChild(item); });
      startSftpAutomationManagerRefresh();
    } else if (state.moved) void persistSftpAutomationOrder(list);
    else startSftpAutomationManagerRefresh();
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}

function sftpAutomationUnifiedSchedule(item={}) {
  const schedule = {...(item.schedule || {})};
  if (sftpAutomationIsRealtime(item)) schedule.frequency = "realtime";
  else if (item.kind === "sync" && item.trigger_mode === "interval") {
    schedule.frequency = "every_minute";
    schedule.interval = Number(item.options?.interval_minutes || schedule.interval || 15);
  } else if (item.id && item.kind === "sync" && item.trigger_mode === "manual") schedule.frequency = "legacy_manual";
  return schedule;
}

function sftpAutomationEmptyState(type="tasks") {
  const runs = type === "runs";
  const title = runs
    ? sftpAutomationLabel("no_runs", {defaultValue:"暂无运行记录"})
    : sftpAutomationLabel("empty", {defaultValue:"暂无任务"});
  const detail = runs
    ? sftpAutomationLabel("no_runs_hint", {defaultValue:"保存任务并运行后会显示在这里。"})
    : sftpAutomationLabel("empty_hint", {defaultValue:"新建一个传输与同步任务，选择方向和执行周期即可。"});
  const action = runs ? "" : `<button type="button" class="primary" data-action="sftp-automation-new">${icon("plus")}<span>${esc(sftpAutomationLabel("empty_action", {defaultValue:"新建第一个任务"}))}</span></button>`;
  return `<div class="sftp-automation-empty" role="status"><span class="sftp-automation-empty-icon">${icon(runs ? "history" : "folder-sync")}</span><strong>${esc(title)}</strong><span>${esc(detail)}</span>${action ? `<div class="actions">${action}</div>` : ""}</div>`;
}

function sftpAutomationSafety(form=false) {
  return `<div class="sftp-automation-safety"><span class="sftp-automation-safety-icon">${icon("shield-check")}</span><div><strong>${esc(sftpAutomationLabel("secure_title", {defaultValue:"安全运行"}))}</strong><span>${esc(sftpAutomationLabel(form ? "safety_form" : "safety", {defaultValue:form ? "默认不删除任何一侧文件；冲突只保留版本并记录，不会弹出无人值守认证框。" : "只使用已保存的 SSH 连接；不会在 Web 端读取本机目录，不会自动接受新的主机指纹。"}))}</span></div></div>`;
}

function sftpAutomationRow(item) {
  const run = sftpAutomationLabel("run_now", {defaultValue:"立即运行"});
  const edit = sftpAutomationLabel("edit", {defaultValue:"编辑"});
  const history = sftpAutomationLabel("history", {defaultValue:"运行记录"});
  const pause = item.enabled ? sftpAutomationLabel("pause", {defaultValue:"暂停"}) : sftpAutomationLabel("enable", {defaultValue:"启用"});
  const remove = sftpAutomationLabel("delete", {defaultValue:"删除"});
  const directionArrow = item.direction === "download" ? "←" : item.direction === "upload" ? "→" : "⇄";
  const statusKey = sftpAutomationStatusKey(item);
  const realtimeMonitoring = sftpAutomationIsRealtime(item) && item.enabled;
  const last = sftpAutomationDate(item.last_run_at);
  const next = sftpAutomationDate(item.next_run_at);
  const timing = statusKey === "running"
    ? sftpAutomationLabel("running_detail", {defaultValue:"正在扫描并处理文件变化…"})
    : sftpAutomationIsRealtime(item)
      ? realtimeMonitoring
        ? sftpAutomationLabel("realtime_waiting", {defaultValue:`等待文件变化 · 最近同步：${last}`, last})
        : sftpAutomationLabel("last_sync", {defaultValue:`最近同步：${last}`, last})
      : item.kind === "sync"
        ? sftpAutomationLabel("last_sync_next", {defaultValue:`最近同步：${last} · 下次：${next}`, last, next})
        : sftpAutomationLabel("last_next", {defaultValue:`上次：${last} · 下次：${next}`, last, next});
  const scheduleIcon = statusKey === "running" ? "loader-circle" : statusKey === "done" ? "circle-check" : realtimeMonitoring ? "radio" : "clock-3";
  const openLocal = sftpAutomationLabel("open_local", {defaultValue:"打开本机目录"});
  const openRemote = sftpAutomationLabel("open_remote", {defaultValue:"在 SFTP 打开远程目录"});
  const drag = sftpAutomationLabel("drag_reorder_named", {defaultValue:`拖动“${item.name}”调整顺序`, name:item.name});
  return `<article class="sftp-automation-row ${sftpAutomationStatusClass(item)}" data-sftp-automation-id="${Number(item.id)}"><div class="sftp-automation-leading"><button type="button" class="sftp-automation-drag-handle" data-pointerdown-action="sftp-automation-sort-start" data-keydown-action="sftp-automation-sort-key" title="${escAttr(drag)}" aria-label="${escAttr(drag)}">${icon("grip-vertical")}</button><span class="sftp-automation-kind-icon">${icon(sftpAutomationTaskKindIcon(item.kind))}</span></div><div class="sftp-automation-copy"><div class="sftp-automation-title-line"><strong title="${escAttr(item.name)}">${esc(item.name)}</strong><span class="sftp-automation-status ${sftpAutomationStatusClass(item)}">${esc(sftpAutomationStatus(item))}</span></div><small class="sftp-automation-meta">${icon("server")}<span>${esc(item.connection_name || sftpAutomationLabel("connection", {defaultValue:"SSH 连接"}))}</span><span class="sftp-automation-meta-separator">·</span><span>${esc(sftpAutomationDirection(item))}</span></small><div class="sftp-automation-path-summary"><button type="button" data-action="sftp-automation-open-local" data-id="${Number(item.id)}" title="${escAttr(openLocal)}">${icon("folder-open")}<span>${esc(item.local_path || "-")}</span></button><b aria-hidden="true">${directionArrow}</b><button type="button" data-action="sftp-automation-open-remote" data-id="${Number(item.id)}" title="${escAttr(openRemote)}">${icon("folder-search")}<span>${esc(item.remote_path || "-")}</span></button></div><small class="sftp-automation-schedule">${icon(scheduleIcon)}<span>${esc(timing)}</span></small></div><div class="actions sftp-automation-row-actions" role="toolbar"><button type="button" class="primary sftp-automation-action-run" data-action="sftp-automation-run" data-id="${Number(item.id)}" title="${escAttr(run)}" aria-label="${escAttr(run)}">${icon("play")}<span class="sftp-automation-action-text">${esc(run)}</span></button><button type="button" class="sftp-automation-action-history" data-action="sftp-automation-history" data-id="${Number(item.id)}" data-kind="${escAttr(item.kind)}" title="${escAttr(history)}" aria-label="${escAttr(history)}">${icon("history")}<span class="sftp-automation-action-text">${esc(history)}</span></button><button type="button" class="sftp-automation-action-edit sftp-automation-action-compact" data-action="sftp-automation-edit" data-id="${Number(item.id)}" title="${escAttr(edit)}" aria-label="${escAttr(edit)}">${icon("pencil")}<span class="sftp-automation-action-text">${esc(edit)}</span></button><button type="button" class="sftp-automation-action-toggle sftp-automation-action-compact" data-action="sftp-automation-toggle" data-id="${Number(item.id)}" data-enabled="${item.enabled ? "false" : "true"}" title="${escAttr(pause)}" aria-label="${escAttr(pause)}">${icon(item.enabled ? "pause" : "play")}<span class="sftp-automation-action-text">${esc(pause)}</span></button><button type="button" class="danger sftp-automation-delete sftp-automation-action-compact" data-action="sftp-automation-delete" data-id="${Number(item.id)}" title="${escAttr(remove)}" aria-label="${escAttr(remove)}">${icon("trash-2")}<span class="sftp-automation-action-text">${esc(remove)}</span></button></div></article>`;
}

async function openSftpAutomationManager() {
  if (!window.termaDesktop) return notify(sftpAutomationLabel("desktop_only", {defaultValue:"传输与同步管理仅在桌面端提供"}), "info");
  stopSftpAutomationManagerRefresh();
  try {
    await loadSftpAutomations();
    sftpAutomationState.connections = await api("/api/connections");
  } catch (error) { return notify(error.message || sftpAutomationLabel("load_failed", {defaultValue:"读取传输与同步任务失败"}), "error"); }
  sftpAutomationState.tab = "all";
  const modal = $("modal");
  modal.hidden = false;
  const items = sftpAutomationState.items;
  const title = sftpAutomationLabel("title", {defaultValue:"传输与同步任务"});
  const hint = sftpAutomationLabel("hint", {defaultValue:"Terma 保持运行时按规则执行；删除传播默认关闭"});
  const refreshLabel = sftpAutomationLabel("refresh", {defaultValue:"刷新"});
  const closeLabel = sftpAutomationLabel("close", {defaultValue:"关闭"});
  const addLabel = sftpAutomationLabel("new", {defaultValue:"新建任务"});
  const managerHeader = `<header class="sftp-automation-head"><div class="sftp-automation-heading"><span class="sftp-automation-hero-icon">${icon("folder-sync")}</span><div><h2 id="sftpAutomationTitle">${esc(title)}</h2><span>${esc(hint)}</span></div></div><div class="sftp-automation-head-actions"><button type="button" class="primary" data-action="sftp-automation-new">${icon("plus")}<span>${esc(addLabel)}</span></button><button type="button" class="icon-button" title="${escAttr(refreshLabel)}" aria-label="${escAttr(refreshLabel)}" data-action="sftp-automation-refresh">${icon("refresh-cw")}</button><button type="button" class="icon-button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}" data-action="sftp-automation-close">${icon("x")}</button></div></header>`;
  const content = items.length ? items.map(sftpAutomationRow).join("") : sftpAutomationEmptyState();
  modal.innerHTML = `<div class="modal-card extra-wide productivity-manager sftp-automation-modal sftp-automation-manager" data-sftp-automation-view="manager" role="dialog" aria-modal="true" aria-labelledby="sftpAutomationTitle">${managerHeader}<div class="productivity-list sftp-automation-list">${content}</div>${sftpAutomationSafety()}</div>`;
  refreshIcons();
  startSftpAutomationManagerRefresh();
}

function sftpAutomationRunRow(run) {
  const metrics = run.summary || {};
  const state = {last_status:run.status, enabled:true};
  const statusIcon = run.status === "done" ? "circle-check" : run.status === "running" ? "loader-circle" : "circle-alert";
  const transferred = Number(metrics.transferred || 0);
  const deleted = Number(metrics.deleted || 0);
  const skipped = Number(metrics.skipped || 0);
  const conflicts = Number(metrics.conflicts || 0);
  const failed = Number(metrics.failed || 0);
  const processed = Number(metrics.processed || metrics.files || 0);
  const noChangeStreakValue = Number(metrics.no_change_streak || 1);
  const noChangeStreak = Number.isSafeInteger(noChangeStreakValue) && noChangeStreakValue > 0 ? noChangeStreakValue : 1;
  const result = run.error || (!transferred && !deleted && !conflicts && !failed
    ? noChangeStreak > 1
      ? sftpAutomationLabel("no_changes_streak", {defaultValue:`没有文件变化 · 连续检查 ${noChangeStreak} 次`, count:noChangeStreak})
      : sftpAutomationLabel("no_changes", {defaultValue:"没有文件变化"})
    : sftpAutomationLabel("run_summary", {defaultValue:"传输 {{transferred}} 项 · 删除 {{deleted}} 项 · 跳过 {{skipped}} 项 · 冲突 {{conflicts}} 项 · 失败 {{failed}} 项", transferred, deleted, skipped, conflicts, failed}));
  const reason = sftpAutomationLabel(`reason_${String(run.reason || "manual")}`, {defaultValue:String(run.reason || "manual")});
  const startedAt = Number(run.started_at || 0) * 1000;
  const finishedAt = Number(run.finished_at || 0) * 1000;
  const duration = finishedAt > startedAt ? Math.max(0, Math.round((finishedAt - startedAt) / 1000)) : 0;
  const details = Array.isArray(metrics.details) ? metrics.details : [];
  const detailMarkup = details.slice(0, 200).map(detail => `<li data-detail-action="${escAttr(detail.action || "skipped")}"><span class="sftp-automation-detail-action action-${escAttr(detail.action || "skipped")}">${esc(sftpAutomationLabel(`detail_${String(detail.action || "skipped")}`, {defaultValue:String(detail.action || "skipped")}))}</span><code title="${escAttr(detail.path || "")}">${esc(detail.path || "-")}</code>${detail.reason ? `<small>${esc(sftpAutomationLabel(`detail_reason_${String(detail.reason)}`, {defaultValue:String(detail.reason)}))}</small>` : ""}${Number(detail.bytes || 0) ? `<small>${esc(formatBytes(Number(detail.bytes)))}</small>` : ""}</li>`).join("");
  const omitted = Number(metrics.details_omitted || 0) + Math.max(0, details.length - 200);
  const detailsEmpty = sftpAutomationLabel("details_empty", {defaultValue:"旧记录没有逐文件明细，可查看本轮汇总。"});
  const stat = (filter, label, value) => {
    const filterTitle = sftpAutomationLabel("filter_details", {defaultValue:`按“${label}”筛选文件明细`, label});
    return `<button type="button" data-action="sftp-automation-run-filter" data-filter="${escAttr(filter)}" title="${escAttr(filterTitle)}" aria-label="${escAttr(filterTitle)}" aria-pressed="false"><span>${esc(label)}</span><strong>${Number(value || 0)}</strong></button>`;
  };
  const processedLabel = sftpAutomationLabel("detail_processed", {defaultValue:"处理"});
  const transferredLabel = sftpAutomationLabel("detail_transferred", {defaultValue:"传输"});
  const deletedLabel = sftpAutomationLabel("detail_deleted", {defaultValue:"删除"});
  const skippedLabel = sftpAutomationLabel("detail_skipped", {defaultValue:"跳过"});
  const conflictsLabel = sftpAutomationLabel("detail_conflicts", {defaultValue:"冲突"});
  const failedLabel = sftpAutomationLabel("detail_failed", {defaultValue:"失败"});
  const filterEmpty = sftpAutomationLabel("filter_empty", {defaultValue:"这个分类没有文件明细"});
  return `<details class="sftp-automation-run-row ${sftpAutomationStatusClass(state)}"><summary><span class="sftp-automation-kind-icon">${icon(statusIcon)}</span><div class="sftp-automation-copy"><div class="sftp-automation-title-line"><strong title="${escAttr(run.automation_name || "")}">${esc(run.automation_name || "")}</strong><span class="sftp-automation-status ${sftpAutomationStatusClass(state)}">${esc(sftpAutomationStatus(state))}</span></div><small class="sftp-automation-meta"><span>${esc(new Date(startedAt).toLocaleString())}</span><span class="sftp-automation-meta-separator">·</span><span>${esc(reason)}</span></small><code>${esc(result)}</code></div><span class="sftp-automation-run-expand" title="${escAttr(sftpAutomationLabel("expand_details", {defaultValue:"展开详细记录"}))}">${icon("chevron-down")}</span></summary><div class="sftp-automation-run-details"><div class="sftp-automation-run-stats">${stat("all", processedLabel, processed)}${stat("transferred", transferredLabel, transferred)}${stat("deleted", deletedLabel, deleted)}${stat("skipped", skippedLabel, skipped)}${stat("conflicts", conflictsLabel, conflicts)}${stat("failed", failedLabel, failed)}<div><span>${esc(sftpAutomationLabel("detail_duration", {defaultValue:"耗时"}))}</span><strong>${duration} s</strong></div></div>${detailMarkup ? `<ul>${detailMarkup}</ul><p class="sftp-automation-filter-empty" hidden>${esc(filterEmpty)}</p>` : `<p>${esc(detailsEmpty)}</p>`}${omitted ? `<p>${esc(sftpAutomationLabel("details_omitted", {defaultValue:`另有 ${omitted} 条明细未在页面展开`, count:omitted}))}</p>` : ""}${run.error ? `<pre>${esc(run.error)}</pre>` : ""}</div></details>`;
}

function filterSftpAutomationRunDetails(button) {
  const details = button?.closest?.(".sftp-automation-run-details");
  const list = details?.querySelector("ul");
  if (!details || !list) return;
  const requested = String(button.dataset.filter || "all");
  const active = button.getAttribute("aria-pressed") === "true" && requested !== "all" ? "all" : requested;
  const filters = {
    all:() => true,
    transferred:action => ["uploaded","downloaded"].includes(action),
    deleted:action => ["deleted_local","deleted_remote"].includes(action),
    skipped:action => action === "skipped",
    conflicts:action => ["conflict","delete_conflict"].includes(action),
    failed:action => action === "failed"
  };
  const matches = filters[active] || filters.all;
  details.querySelectorAll('[data-action="sftp-automation-run-filter"]').forEach(item => {
    const selected = item.dataset.filter === active;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  let visible = 0;
  list.querySelectorAll("[data-detail-action]").forEach(item => {
    const show = matches(String(item.dataset.detailAction || ""));
    item.hidden = !show;
    if (show) visible += 1;
  });
  const empty = details.querySelector(".sftp-automation-filter-empty");
  if (empty) empty.hidden = visible > 0;
}

function confirmSftpAutomationAction({title,message,confirmText,danger=false}) {
  return new Promise(resolve => {
    const modal = $("modal");
    if (!modal || modal.hidden) return resolve(false);
    stopSftpAutomationManagerRefresh();
    modal.querySelector(".sftp-automation-confirm-layer")?.remove();
    const layer = document.createElement("div");
    const titleId = `sftpAutomationConfirmTitle${Date.now()}`;
    layer.className = "sftp-automation-confirm-layer";
    layer.innerHTML = `<section class="sftp-automation-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}"><span class="sftp-automation-confirm-icon">${icon(danger ? "triangle-alert" : "circle-help")}</span><div><h3 id="${titleId}">${esc(title)}</h3><p>${esc(message)}</p></div><div class="actions"><button type="button" data-confirm-value="false">${esc(sftpAutomationLabel("cancel", {defaultValue:"取消"}))}</button><button type="button" class="${danger ? "danger" : "primary"}" data-confirm-value="true">${icon(danger ? "trash-2" : "check")}<span>${esc(confirmText)}</span></button></div></section>`;
    modal.appendChild(layer);
    const previousFocus = document.activeElement;
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      window.removeEventListener("keydown", onKeyDown, true);
      layer.remove();
      if (sftpAutomationManagerIsOpen()) startSftpAutomationManagerRefresh();
      if (!value && previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    layer.addEventListener("pointerdown", event => { if (event.target === layer) finish(false); });
    layer.querySelectorAll("[data-confirm-value]").forEach(item => item.addEventListener("click", () => finish(item.dataset.confirmValue === "true")));
    window.addEventListener("keydown", onKeyDown, true);
    refreshIcons();
    layer.querySelector('[data-confirm-value="true"]')?.focus();
  });
}

function sftpAutomationHistoryRetentionOptions(value) {
  const choices = [...new Set([100,300,500,1000,3000,5000,Number(value || 300)])].filter(item => item >= 100 && item <= 5000).sort((a,b) => a-b);
  return choices.map(item => `<option value="${item}" ${item === Number(value) ? "selected" : ""}>${item}</option>`).join("");
}

async function openSftpAutomationHistory(id, page=1) {
  stopSftpAutomationManagerRefresh();
  const item = sftpAutomationState.items.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  let result;
  try { result = await api(`/api/sftp/automations/${Number(id)}/runs?page=${Math.max(1,Number(page) || 1)}`); }
  catch (error) { notify(error.message || sftpAutomationLabel("history_load_failed", {defaultValue:"读取运行记录失败"}), "error"); return; }
  const runs = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
  const total = Number(result?.total ?? runs.length);
  const currentPage = Number(result?.page || 1);
  const totalPages = Number(result?.total_pages || 1);
  const historyLimit = Number(result?.history_limit || item.options?.history_limit || 300);
  sftpAutomationState.history = {automationId:Number(id),page:currentPage,total,totalPages,historyLimit};
  const modal = $("modal");
  const title = sftpAutomationLabel("task_history", {defaultValue:`${item.name} · 运行记录`, name:item.name});
  const countText = sftpAutomationLabel("history_count", {defaultValue:`共 ${total} 条`, count:total});
  const pageText = sftpAutomationLabel("history_page", {defaultValue:`第 ${currentPage} / ${totalPages} 页`, page:currentPage, pages:totalPages});
  modal.innerHTML = `<div class="modal-card extra-wide productivity-manager sftp-automation-modal sftp-automation-manager sftp-automation-history-modal" data-sftp-automation-view="history"><header class="sftp-automation-head"><div class="sftp-automation-heading"><span class="sftp-automation-hero-icon">${icon("history")}</span><div><h2>${esc(title)}</h2><span>${esc(sftpAutomationLabel("task_history_hint", {defaultValue:"这里只显示当前任务的执行结果；点击记录可展开逐文件明细。"}))}</span></div></div><button type="button" class="icon-button" data-action="sftp-automation-history-close" aria-label="${escAttr(sftpAutomationLabel("close", {defaultValue:"关闭"}))}">${icon("x")}</button></header><div class="sftp-automation-history-toolbar"><span>${icon("database")}<b>${esc(countText)}</b></span><label>${esc(sftpAutomationLabel("history_limit", {defaultValue:"最多保留"}))}<select data-change-action="sftp-automation-history-limit" data-id="${Number(id)}">${sftpAutomationHistoryRetentionOptions(historyLimit)}</select><span>${esc(sftpAutomationLabel("history_limit_unit", {defaultValue:"条"}))}</span></label><button type="button" class="danger" data-action="sftp-automation-history-clear" data-id="${Number(id)}">${icon("trash-2")}<span>${esc(sftpAutomationLabel("clear_history", {defaultValue:"清空记录"}))}</span></button></div><div class="productivity-list sftp-automation-list">${runs.length ? runs.map(sftpAutomationRunRow).join("") : sftpAutomationEmptyState("runs")}</div><nav class="sftp-automation-history-pager" aria-label="${escAttr(pageText)}"><button type="button" data-action="sftp-automation-history-page" data-id="${Number(id)}" data-page="${currentPage - 1}" ${currentPage <= 1 ? "disabled" : ""}>${icon("chevron-left")}<span>${esc(sftpAutomationLabel("previous_page", {defaultValue:"上一页"}))}</span></button><strong>${esc(pageText)}</strong><button type="button" data-action="sftp-automation-history-page" data-id="${Number(id)}" data-page="${currentPage + 1}" ${currentPage >= totalPages ? "disabled" : ""}><span>${esc(sftpAutomationLabel("next_page", {defaultValue:"下一页"}))}</span>${icon("chevron-right")}</button></nav>${sftpAutomationSafety()}</div>`;
  refreshIcons();
}

async function updateSftpAutomationHistoryLimit(id, value) {
  try {
    await api(`/api/sftp/automations/${Number(id)}/history-settings`, {method:"POST",body:JSON.stringify({history_limit:Number(value)})});
    await loadSftpAutomations();
    return openSftpAutomationHistory(id, 1);
  } catch (error) { notify(error.message || sftpAutomationLabel("history_limit_failed", {defaultValue:"保存记录上限失败"}), "error"); }
}

async function clearSftpAutomationHistory(id) {
  const accepted = await confirmSftpAutomationAction({
    title:sftpAutomationLabel("clear_history_title", {defaultValue:"清空运行记录"}),
    message:sftpAutomationLabel("clear_history_confirm", {defaultValue:"清空这个任务的全部已结束运行记录？"}),
    confirmText:sftpAutomationLabel("clear_history", {defaultValue:"清空记录"}),
    danger:true
  });
  if (!accepted) return;
  try {
    await api(`/api/sftp/automations/${Number(id)}/runs`, {method:"DELETE"});
    return openSftpAutomationHistory(id, 1);
  } catch (error) { notify(error.message || sftpAutomationLabel("clear_history_failed", {defaultValue:"清空运行记录失败"}), "error"); }
}

async function chooseSftpAutomationDirectory(inputId) {
  try { const result = await api("/api/sftp/sync/choose-directory", {method:"POST", body:"{}"}); if (result?.path) $(inputId).value = result.path; }
  catch (error) { notify(error.message || sftpAutomationLabel("choose_failed", {defaultValue:"无法选择本机目录"}), "error"); }
}

function sftpAutomationConnectionOptions(selected) {
  const list = Array.isArray(sftpAutomationState.connections) ? sftpAutomationState.connections : [];
  return list.map(item => `<option value="${Number(item.id)}" ${Number(item.id) === Number(selected) ? "selected" : ""}>${esc(item.name)} · ${esc(item.ssh_user)}@${esc(item.ssh_host)}</option>`).join("");
}

function sftpAutomationDateTimeValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "";
  const date = new Date(number);
  const pad = part => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sftpAutomationNumber(value, fallback, min=1, max=10080) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function sftpAutomationScheduleOptions(schedule={}) {
  const options = [
    ["once", "once", "once"], ["every_second", "every_second", "every_second"], ["every_minute", "every_minute", "every_minute"],
    ["every_hour", "every_hour", "every_hour"], ["daily", "daily", "daily"], ["weekly", "weekly", "weekly"],
    ["monthly", "monthly", "monthly"], ["yearly", "yearly", "yearly"], ["specified_time", "specified_time", "specified_time"],
    ["countdown", "countdown", "countdown"], ["half_hour", "half_hour", "half_hour"], ["cron", "cron", "cron"], ["realtime", "realtime", "realtime"]
  ];
  if (String(schedule.frequency) === "legacy_manual") options.push(["legacy_manual", "legacy_manual", "legacy_manual"]);
  return options.map(([value, key, fallback]) => `<option value="${value}" ${String(schedule.frequency || "daily") === value ? "selected" : ""}>${esc(sftpAutomationLabel(key, {defaultValue:fallback}))}</option>`).join("");
}

function sftpAutomationWeekdayFields(schedule={}) {
  const selected = new Set((Array.isArray(schedule.weekdays) ? schedule.weekdays : [schedule.weekday ?? 1]).map(value => Number(value)));
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return `<div class="sftp-automation-weekdays">${keys.map((key, index) => `<label class="checkline"><input type="checkbox" name="sftpAutomationWeekday" value="${index}" ${selected.has(index) ? "checked" : ""}>${esc(sftpAutomationLabel(`weekday_${key}`, {defaultValue:key}))}</label>`).join("")}</div>`;
}

function sftpAutomationScheduleFields(schedule={}) {
  const frequency = String(schedule.frequency || "daily");
  if (frequency === "legacy_manual") return `<p class="sftp-automation-schedule-hint">${esc(sftpAutomationLabel("legacy_manual_hint", {defaultValue:"这是旧版手动同步任务；选择其他周期后即可自动执行。"}))}</p>`;
  const interval = sftpAutomationNumber(schedule.interval, frequency === "every_second" ? 30 : 1, 1, frequency === "every_second" ? 86400 : 10080);
  const unitKey = {
    every_second:"unit_seconds", every_minute:"unit_minutes", every_hour:"unit_hours", daily:"unit_days",
    weekly:"unit_weeks", monthly:"unit_months", yearly:"unit_years", half_hour:"unit_half_hour"
  }[frequency];
  let body = "";
  if (unitKey) {
    const valueLabel = frequency === "half_hour"
      ? sftpAutomationLabel("half_hour_count", {defaultValue:"每隔"})
      : sftpAutomationLabel("interval_value", {defaultValue:"间隔"});
    body += `<div class="sftp-automation-schedule-inline"><label>${esc(valueLabel)}<input id="sftpAutomationScheduleInterval" type="number" min="1" max="${frequency === "every_second" ? 86400 : 10080}" value="${interval}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel(unitKey, {defaultValue:"Unit"}))}</span></div>`;
  }
  if (frequency === "weekly") body += `<div class="sftp-automation-schedule-block"><span class="sftp-automation-field-caption">${esc(sftpAutomationLabel("weekdays", {defaultValue:"星期"}))}</span>${sftpAutomationWeekdayFields(schedule)}</div>`;
  if (frequency === "monthly") body += `<div class="sftp-automation-schedule-inline"><label>${esc(sftpAutomationLabel("day", {defaultValue:"日期"}))}<input id="sftpAutomationScheduleDay" type="number" min="1" max="31" value="${sftpAutomationNumber(schedule.day, 1, 1, 31)}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("day_of_month", {defaultValue:"日"}))}</span></div>`;
  if (frequency === "yearly") body += `<div class="sftp-automation-schedule-inline"><label>${esc(sftpAutomationLabel("month", {defaultValue:"月份"}))}<input id="sftpAutomationScheduleMonth" type="number" min="1" max="12" value="${sftpAutomationNumber(schedule.month, 1, 1, 12)}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("month_unit", {defaultValue:"月"}))}</span><label>${esc(sftpAutomationLabel("day", {defaultValue:"日期"}))}<input id="sftpAutomationScheduleDay" type="number" min="1" max="31" value="${sftpAutomationNumber(schedule.day, 1, 1, 31)}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("day_of_month", {defaultValue:"日"}))}</span></div>`;
  if (frequency === "countdown") {
    const total = sftpAutomationNumber(schedule.countdown_seconds, 60, 1, 2678400);
    const countdownHours = Math.floor(total / 3600);
    const countdownMinutes = Math.floor((total % 3600) / 60);
    const countdownSeconds = total % 60;
    body += `<div class="sftp-automation-schedule-inline sftp-automation-countdown"><label>${esc(sftpAutomationLabel("countdown_hours", {defaultValue:"Hours"}))}<input id="sftpAutomationCountdownHours" type="number" min="0" max="744" value="${countdownHours}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("unit_hours", {defaultValue:"hours"}))}</span><label>${esc(sftpAutomationLabel("countdown_minutes", {defaultValue:"Minutes"}))}<input id="sftpAutomationCountdownMinutes" type="number" min="0" max="59" value="${countdownMinutes}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("unit_minutes", {defaultValue:"minutes"}))}</span><label>${esc(sftpAutomationLabel("countdown_seconds_label", {defaultValue:"Seconds"}))}<input id="sftpAutomationCountdownSeconds" type="number" min="0" max="59" value="${countdownSeconds}"></label><span class="sftp-automation-unit">${esc(sftpAutomationLabel("unit_seconds", {defaultValue:"seconds"}))}</span></div>`;
  }
  if (frequency === "half_hour") {
    const selectedSlots = new Set(Array.isArray(schedule.half_hour_slots) && schedule.half_hour_slots.length ? schedule.half_hour_slots.map(value => Number(value)) : Array.from({length:48}, (_, index) => index));
    body += `<div class="sftp-automation-schedule-block"><span class="sftp-automation-field-caption">${esc(sftpAutomationLabel("half_hour_slots", {defaultValue:"Run at"}))}</span><div class="sftp-automation-half-hour-slots">${Array.from({length:48}, (_, index) => { const hour = Math.floor(index / 2); const minute = index % 2 ? "30" : "00"; return `<label class="checkline"><input type="checkbox" name="sftpAutomationHalfHourSlot" value="${index}" ${selectedSlots.has(index) ? "checked" : ""}>${String(hour).padStart(2,"0")}:${minute}</label>`; }).join("")}</div></div>`;
  }
  if (frequency === "cron") body += `<label class="sftp-automation-cron-field">${esc(sftpAutomationLabel("cron_expression", {defaultValue:"Cron 表达式"}))}<input id="sftpAutomationCron" maxlength="120" value="${escAttr(schedule.cron || "")}" placeholder="*/5 * * * *" data-input-action="sftp-automation-cron"><small id="sftpAutomationCronStatus" class="sftp-automation-cron-status">${esc(sftpAutomationLabel("cron_help", {defaultValue:"支持 5 位或 6 位（含秒）Cron 表达式"}))}</small><ol id="sftpAutomationCronNextRuns" class="sftp-automation-cron-runs"></ol></label>`;
  if (frequency === "realtime") body += `<p class="sftp-automation-schedule-hint">${esc(sftpAutomationLabel("realtime_hint", {defaultValue:"监听本机变化，并约每 10 秒检查一次远端变化。可设置未来开始时间。"}))}</p>`;
  if (["once", "specified_time"].includes(frequency)) body += `<p class="sftp-automation-schedule-hint">${esc(sftpAutomationLabel("specified_time_hint", {defaultValue:"设置一次执行的开始时间。"}))}</p>`;
  const start = sftpAutomationDateTimeValue(schedule.start_at_ms || schedule.at_ms);
  body += `<label class="sftp-automation-start-field">${esc(sftpAutomationLabel("start_time", {defaultValue:"开始时间"}))}<input id="sftpAutomationStartAt" type="datetime-local" value="${escAttr(start)}"><small>${esc(sftpAutomationLabel("start_time_hint", {defaultValue:"从这个时间开始按所选周期执行。"}))}</small></label>`;
  return body;
}

function sftpAutomationScheduleMarkup(schedule={}) {
  return `<div class="sftp-automation-schedule-panel"><label>${esc(sftpAutomationLabel("frequency", {defaultValue:"执行周期"}))}<select id="sftpAutomationFrequency" data-change-action="sftp-automation-frequency">${sftpAutomationScheduleOptions(schedule)}</select></label><div id="sftpAutomationScheduleFields">${sftpAutomationScheduleFields(schedule)}</div></div>`;
}

function sftpAutomationRemoteJoin(base, name) {
  const left = String(base || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  const right = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!right || right === ".") return left;
  if (left === ".") return right;
  return `${left}/${right}`.replace(/\/\.\//g, "/");
}

function sftpAutomationRemoteDisplayPath(value) {
  const pathValue = String(value || ".").replace(/\\/g, "/");
  return pathValue === "." ? "~" : pathValue;
}

function sftpAutomationRemoteApiPath(value) {
  const pathValue = String(value || ".").trim().replace(/\\/g, "/");
  if (!pathValue || pathValue === "." || pathValue === "~") return ".";
  if (pathValue === "/") return "/";
  return pathValue.replace(/\/$/, "") || "/";
}

function sftpAutomationRemoteParent(value) {
  const normalized = String(value || ".").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || ".";
  if (normalized === "." || normalized === "/") return ".";
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index) || ".";
}

function renderSftpAutomationRemoteEntries() {
  const host = $("sftpAutomationRemoteEntries");
  if (!host) return;
  const renderNode = (nodePath, name, depth=0) => {
    const expanded = sftpAutomationRemotePicker.expanded.has(nodePath);
    const children = sftpAutomationRemotePicker.nodes.get(nodePath);
    const childMarkup = expanded && Array.isArray(children) ? children.map(entry => renderNode(sftpAutomationRemoteJoin(nodePath, entry.name), entry.name, depth + 1)).join("") : "";
    return `<div class="sftp-automation-tree-node"><button type="button" class="sftp-automation-remote-entry${sftpAutomationRemotePicker.path === nodePath ? " active" : ""}" style="--tree-depth:${depth}" data-action="sftp-automation-remote-toggle" data-path="${escAttr(nodePath)}" aria-expanded="${expanded}"><span class="sftp-automation-tree-chevron">${icon(expanded ? "chevron-down" : "chevron-right")}</span><span class="sftp-automation-remote-entry-icon">${icon(expanded ? "folder-open" : "folder")}</span><span>${esc(name)}</span></button>${childMarkup}</div>`;
  };
  host.innerHTML = `${renderNode("/", sftpAutomationLabel("remote_picker_root", {defaultValue:"根目录"}), 0)}${renderNode(".", sftpAutomationLabel("remote_picker_home", {defaultValue:"登录目录"}), 0)}`;
  const pathInput = $("sftpAutomationRemotePickerPath");
  if (pathInput) { pathInput.value = sftpAutomationRemoteDisplayPath(sftpAutomationRemotePicker.path); pathInput.readOnly = true; }
  const up = document.querySelector('[data-action="sftp-automation-remote-up"]');
  if (up) up.disabled = sftpAutomationRemotePicker.path === "." || sftpAutomationRemotePicker.path === "/";
  refreshIcons();
}

async function loadSftpAutomationRemoteDirectory(value) {
  const connectionId = Number($("sftpAutomationConnection")?.value || 0);
  const pathValue = sftpAutomationRemoteApiPath(value);
  const host = $("sftpAutomationRemoteEntries");
  if (!connectionId) {
    if (host) host.innerHTML = `<div class="sftp-automation-remote-empty">${icon("server-off")}<span>${esc(sftpAutomationLabel("remote_picker_no_connection", {defaultValue:"请先选择 SSH 连接"}))}</span></div>`;
    return;
  }
  if (host) host.innerHTML = `<div class="sftp-automation-remote-loading">${icon("loader-circle")}<span>${esc(sftpAutomationLabel("remote_picker_loading", {defaultValue:"正在读取远程目录…"}))}</span></div>`;
  try {
    const result = await api(`/api/connections/${connectionId}/sftp?path=${encodeURIComponent(pathValue)}&page=1&page_size=200&refresh=1`);
    sftpAutomationRemotePicker.path = pathValue;
    sftpAutomationRemotePicker.expanded.add(pathValue);
    sftpAutomationRemotePicker.nodes.set(pathValue, (Array.isArray(result?.entries) ? result.entries : []).filter(entry => entry && (entry.type === "dir" || entry.is_dir || entry.kind === "directory")));
    renderSftpAutomationRemoteEntries();
  } catch (error) {
    if (host) host.innerHTML = `<div class="sftp-automation-remote-empty">${icon("circle-alert")}<span>${esc(error.message || sftpAutomationLabel("remote_picker_failed", {defaultValue:"读取远程目录失败"}))}</span></div>`;
    refreshIcons();
  }
}

function toggleSftpAutomationRemotePicker(show=true) {
  const picker = $("sftpAutomationRemotePicker");
  if (!picker) return;
  picker.hidden = !show;
  if (show) {
    const requestedPath = sftpAutomationRemoteApiPath($("sftpAutomationRemote")?.value || ".");
    sftpAutomationRemotePicker = {path:requestedPath,nodes:new Map(),expanded:new Set(["."])};
    loadSftpAutomationRemoteDirectory(".").then(() => requestedPath === "." ? null : loadSftpAutomationRemoteDirectory(requestedPath));
  }
}

async function createSftpAutomationRemoteFolder() {
  const name = String($("sftpAutomationRemoteNewName")?.value || "").trim();
  if (!name) return;
  if (name === "." || name === ".." || /[\\/\0]/.test(name)) return notify(sftpAutomationLabel("remote_picker_new_invalid", {defaultValue:"文件夹名称不能包含斜杠，也不能是 . 或 .."}), "error");
  const connectionId = Number($("sftpAutomationConnection")?.value || 0);
  const target = sftpAutomationRemoteJoin(sftpAutomationRemotePicker.path, name);
  try {
    await api(`/api/connections/${connectionId}/sftp/mkdir`, {method:"POST",body:JSON.stringify({path:target})});
    await loadSftpAutomationRemoteDirectory(sftpAutomationRemotePicker.path);
    showSftpAutomationRemoteFolderEditor(false);
    notify(sftpAutomationLabel("remote_picker_new_done", {defaultValue:"远程文件夹已创建"}), "success");
  } catch (error) { notify(error.message || sftpAutomationLabel("remote_picker_new_failed", {defaultValue:"创建远程文件夹失败"}), "error"); }
}

function showSftpAutomationRemoteFolderEditor(show=true) {
  const picker = $("sftpAutomationRemotePicker");
  if (!picker) return;
  let editor = $("sftpAutomationRemoteNewEditor");
  if (!editor && show) {
    picker.querySelector(".sftp-automation-remote-toolbar")?.insertAdjacentHTML("afterend", `<div id="sftpAutomationRemoteNewEditor" class="sftp-automation-remote-new-editor"><input id="sftpAutomationRemoteNewName" maxlength="255" placeholder="${escAttr(sftpAutomationLabel("remote_picker_new_prompt", {defaultValue:"请输入新文件夹名称"}))}"><button type="button" class="primary" data-action="sftp-automation-remote-new-confirm">${esc(sftpAutomationLabel("remote_picker_new_confirm", {defaultValue:"创建"}))}</button><button type="button" data-action="sftp-automation-remote-new-cancel">${esc(sftpAutomationLabel("cancel", {defaultValue:"取消"}))}</button></div>`);
    editor = $("sftpAutomationRemoteNewEditor");
  }
  if (editor) editor.hidden = !show;
  if (show) $("sftpAutomationRemoteNewName")?.focus();
}

async function updateSftpAutomationCronPreview() {
  clearTimeout(sftpAutomationCronTimer);
  sftpAutomationCronTimer = setTimeout(async () => {
    const input = $("sftpAutomationCron");
    const status = $("sftpAutomationCronStatus");
    const list = $("sftpAutomationCronNextRuns");
    if (!input || !status || !list) return;
    const cron = input.value.trim();
    if (!cron) { status.className = "sftp-automation-cron-status"; status.textContent = sftpAutomationLabel("cron_help", {defaultValue:"支持 5 位或 6 位（含秒）Cron 表达式"}); list.innerHTML = ""; return; }
    try {
      const result = await api("/api/sftp/automations/cron-preview", {method:"POST",body:JSON.stringify({cron,from_ms:Date.now(),start_at_ms:Date.parse($("sftpAutomationStartAt")?.value || "") || 0})});
      status.className = `sftp-automation-cron-status ${result.valid ? "valid" : "invalid"}`;
      status.textContent = sftpAutomationLabel(result.valid ? "cron_valid" : "cron_invalid", {defaultValue:result.valid ? "表达式有效，最近 3 次执行时间：" : "表达式无效或未来一年没有执行时间"});
      list.innerHTML = result.valid ? (result.next_runs || []).map(value => `<li>${esc(new Date(Number(value)).toLocaleString())}</li>`).join("") : "";
    } catch (error) { status.className = "sftp-automation-cron-status invalid"; status.textContent = error.message || sftpAutomationLabel("cron_invalid", {defaultValue:"表达式无效或未来一年没有执行时间"}); list.innerHTML = ""; }
  }, 250);
}

function syncSftpAutomationScheduleFields() {
  const frequency = $("sftpAutomationFrequency")?.value || "daily";
  const defaultInterval = frequency === "every_second" ? 30 : 1;
  const currentInterval = Number($("sftpAutomationScheduleInterval")?.value || 0);
  const countdownInputs = [$("sftpAutomationCountdownHours"), $("sftpAutomationCountdownMinutes"), $("sftpAutomationCountdownSeconds")];
  const countdownSeconds = countdownInputs.some(Boolean) ? (Number($("sftpAutomationCountdownHours")?.value || 0) * 3600) + (Number($("sftpAutomationCountdownMinutes")?.value || 0) * 60) + Number($("sftpAutomationCountdownSeconds")?.value || 0) : 60;
  const schedule = {frequency, interval:frequency === "every_second" && currentInterval <= 1 ? defaultInterval : (currentInterval || defaultInterval), day:Number($("sftpAutomationScheduleDay")?.value || 1), month:Number($("sftpAutomationScheduleMonth")?.value || 1), countdown_seconds:countdownSeconds, half_hour_slots:[...document.querySelectorAll('input[name="sftpAutomationHalfHourSlot"]:checked')].map(input => Number(input.value)), cron:$("sftpAutomationCron")?.value || "", start_at_ms:Date.parse($("sftpAutomationStartAt")?.value || "") || 0, weekdays:[...document.querySelectorAll('input[name="sftpAutomationWeekday"]:checked')].map(input => Number(input.value))};
  const host = $("sftpAutomationScheduleFields");
  if (host) { host.innerHTML = sftpAutomationScheduleFields(schedule); refreshIcons(); if (frequency === "cron") updateSftpAutomationCronPreview(); }
  syncSftpAutomationModeHint();
}

function syncSftpAutomationModeHint() {
  const direction = $("sftpAutomationDirection")?.value || "upload";
  const frequency = $("sftpAutomationFrequency")?.value || "daily";
  const propagateDeletes = Boolean($("sftpAutomationPropagateDeletes")?.checked);
  const safeSync = direction === "bidirectional" || frequency === "realtime" || propagateDeletes || $("sftpAutomationForm")?.dataset.existingKind === "sync";
  const hint = $("sftpAutomationModeHint");
  if (hint) {
    hint.classList.toggle("safe-sync", safeSync);
    const hintKey = propagateDeletes ? "safe_delete_mode_hint" : safeSync ? "safe_mode_hint" : "transfer_mode_hint";
    const defaultValue = propagateDeletes ? "安全同步删除已启用：只有基线确认目标未改变时才传播删除，冲突文件会保留。" : safeSync ? "此组合由安全同步引擎执行：保留基线与冲突副本，默认不传播删除。" : "此组合按普通传输执行：源文件未变化时跳过，目标缺失时自动补传。";
    hint.innerHTML = `${icon(safeSync ? "shield-check" : "send")}<span>${esc(sftpAutomationLabel(hintKey, {defaultValue}))}</span>`;
    refreshIcons();
  }
  const notifyInput = $("sftpAutomationNotify");
  if (notifyInput?.dataset.auto === "true") notifyInput.checked = !safeSync;
}

function editSftpAutomation(id=0) {
  stopSftpAutomationManagerRefresh();
  const item = sftpAutomationState.items.find(entry => Number(entry.id) === Number(id)) || {kind:"transfer",enabled:true,direction:"upload",trigger_mode:"schedule",options:{conflict:"overwrite",interval_minutes:15,compare_content:true,history_limit:300,propagate_deletes:false},schedule:{frequency:"daily",hour:9,minute:0}};
  const modal = $("modal");
  const selectedConnection = item.connection_id || sftpAutomationState.connections?.[0]?.id || "";
  const schedule = sftpAutomationUnifiedSchedule(item);
  const options = item.options || {};
  const saveLabel = sftpAutomationLabel("save", {defaultValue:"保存并启用"});
  const formTitle = sftpAutomationTitle(id ? "edit" : "new");
  const formHint = sftpAutomationLabel("form_hint", {defaultValue:"任务保存在本机；Terma 完全退出时不会执行。"});
  const closeLabel = sftpAutomationLabel("close", {defaultValue:"关闭"});
  const remotePath = sftpAutomationRemoteDisplayPath(item.remote_path || ".");
  const notifyDefault = options.notify === undefined ? !(item.direction === "bidirectional" || schedule.frequency === "realtime" || item.kind === "sync") : Boolean(options.notify);
  modal.innerHTML = `<div class="modal-card wide sftp-automation-modal sftp-automation-form-modal"><header class="sftp-automation-head sftp-automation-form-head"><div class="sftp-automation-heading"><span class="sftp-automation-hero-icon">${icon("folder-sync")}</span><div><h2 id="sftpAutomationFormTitle">${esc(formTitle)}</h2><span>${esc(formHint)}</span></div></div><button type="button" class="icon-button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}" data-action="sftp-automation-form-close">${icon("x")}</button></header><div id="sftpAutomationForm" class="form-grid sftp-automation-form" data-existing-kind="${escAttr(id ? item.kind : "")}"><label>${esc(sftpAutomationLabel("name", {defaultValue:"任务名称"}))}<input id="sftpAutomationName" value="${escAttr(item.name || "")}" maxlength="120"></label><label>${esc(sftpAutomationLabel("connection", {defaultValue:"SSH 连接"}))}<select id="sftpAutomationConnection">${sftpAutomationConnectionOptions(selectedConnection)}</select></label><label>${esc(sftpAutomationLabel("local_path", {defaultValue:"本机目录"}))}<div class="sftp-automation-path"><input id="sftpAutomationLocal" value="${escAttr(item.local_path || "")}" placeholder="C:\\Work\\project"><button type="button" data-action="sftp-automation-choose">${esc(sftpAutomationLabel("choose", {defaultValue:"选择"}))}</button></div></label><label>${esc(sftpAutomationLabel("remote_path", {defaultValue:"远程目录或文件"}))}<div class="sftp-automation-path sftp-automation-remote-path"><input id="sftpAutomationRemote" value="${escAttr(remotePath)}" placeholder="/srv/project"><button type="button" data-action="sftp-automation-remote-browse">${icon("folder-search")}<span>${esc(sftpAutomationLabel("remote_browse", {defaultValue:"浏览"}))}</span></button></div><div id="sftpAutomationRemotePicker" class="sftp-automation-remote-picker" hidden><div class="sftp-automation-remote-toolbar"><input id="sftpAutomationRemotePickerPath" value="${escAttr(remotePath)}" aria-label="${escAttr(sftpAutomationLabel("remote_picker_path", {defaultValue:"远程路径"}))}"><button type="button" data-action="sftp-automation-remote-up" title="${escAttr(sftpAutomationLabel("remote_picker_up", {defaultValue:"上一级"}))}" aria-label="${escAttr(sftpAutomationLabel("remote_picker_up", {defaultValue:"上一级"}))}">${icon("arrow-up")}</button><button type="button" data-action="sftp-automation-remote-refresh" title="${escAttr(sftpAutomationLabel("remote_picker_refresh", {defaultValue:"刷新"}))}" aria-label="${escAttr(sftpAutomationLabel("remote_picker_refresh", {defaultValue:"刷新"}))}">${icon("refresh-cw")}</button><button type="button" class="primary" data-action="sftp-automation-remote-select">${esc(sftpAutomationLabel("remote_picker_select", {defaultValue:"选择此目录"}))}</button></div><div id="sftpAutomationRemoteEntries" class="sftp-automation-remote-entries"></div></div></label><label>${esc(sftpAutomationLabel("direction", {defaultValue:"方向"}))}<select id="sftpAutomationDirection" data-change-action="sftp-automation-direction"><option value="upload" ${item.direction === "upload" ? "selected" : ""}>${esc(sftpAutomationLabel("upload", {defaultValue:"上传到服务器"}))}</option><option value="download" ${item.direction === "download" ? "selected" : ""}>${esc(sftpAutomationLabel("download", {defaultValue:"下载到本机"}))}</option><option value="bidirectional" ${item.direction === "bidirectional" ? "selected" : ""}>${esc(sftpAutomationLabel("bidirectional", {defaultValue:"双向同步"}))}</option></select></label>${sftpAutomationScheduleMarkup(schedule)}<div id="sftpAutomationModeHint" class="sftp-automation-mode-hint"></div><label>${esc(sftpAutomationLabel("conflict", {defaultValue:"同名文件"}))}<select id="sftpAutomationConflict"><option value="skip" ${options.conflict === "skip" ? "selected" : ""}>${esc(sftpAutomationLabel("skip", {defaultValue:"跳过"}))}</option><option value="rename" ${options.conflict === "rename" ? "selected" : ""}>${esc(sftpAutomationLabel("rename", {defaultValue:"自动重命名"}))}</option><option value="overwrite" ${options.conflict === "overwrite" ? "selected" : ""}>${esc(sftpAutomationLabel("overwrite", {defaultValue:"覆盖"}))}</option></select></label><label>${esc(sftpAutomationLabel("excludes", {defaultValue:"排除规则"}))}<textarea id="sftpAutomationExcludes" rows="3" placeholder="build\n*.log">${esc(item.options?.excludes || "")}</textarea></label><label class="checkline"><input id="sftpAutomationEnabled" type="checkbox" ${item.enabled !== false ? "checked" : ""}>${esc(sftpAutomationLabel("enabled", {defaultValue:"保存后启用"}))}</label></div>${sftpAutomationSafety(true)}<div class="actions"><button type="button" data-action="sftp-automation-form-close">${esc(sftpAutomationLabel("cancel", {defaultValue:"取消"}))}</button><button type="button" class="primary" data-action="sftp-automation-save" data-id="${Number(id)}">${icon("save")}<span>${esc(saveLabel)}</span></button></div></div>`;
  refreshIcons();
  const toolbar = document.querySelector(".sftp-automation-remote-toolbar");
  if (toolbar) toolbar.insertAdjacentHTML("beforeend", `<button type="button" data-action="sftp-automation-remote-root" title="${escAttr(sftpAutomationLabel("remote_picker_root", {defaultValue:"根目录"}))}">${icon("home")}</button><button type="button" data-action="sftp-automation-remote-new">${icon("folder-plus")}<span>${esc(sftpAutomationLabel("remote_picker_new", {defaultValue:"新建文件夹"}))}</span></button>`);
  const form = document.querySelector(".sftp-automation-form");
  const conflictField = $("sftpAutomationConflict")?.closest("label");
  if (conflictField?.firstChild?.nodeType === Node.TEXT_NODE) conflictField.firstChild.nodeValue = sftpAutomationLabel("existing_file_policy", {defaultValue:"目标已有同名文件（首次传输）"});
  if (conflictField) conflictField.insertAdjacentHTML("beforeend", `<small>${esc(sftpAutomationLabel("existing_file_policy_hint", {defaultValue:"建立同步基线后，单侧内容变化会更新另一侧；两侧都变化时保留冲突副本。"}))}</small>`);
  if (form) form.insertAdjacentHTML("beforeend", `<label>${esc(sftpAutomationLabel("missed_policy", {defaultValue:"错过执行时间"}))}<select id="sftpAutomationMissedPolicy"><option value="run_once" ${item.missed_policy !== "skip" ? "selected" : ""}>${esc(sftpAutomationLabel("missed_run_once", {defaultValue:"启动后立即补执行一次"}))}</option><option value="skip" ${item.missed_policy === "skip" ? "selected" : ""}>${esc(sftpAutomationLabel("missed_skip", {defaultValue:"跳过并等待下一次"}))}</option></select><small>${esc(sftpAutomationLabel("missed_hint", {defaultValue:"Terma 重启后不会补跑每个错过周期，最多只补执行一次。"}))}</small></label><label class="checkline"><input id="sftpAutomationNotify" type="checkbox" data-change-action="sftp-automation-notify" data-auto="${options.notify === undefined ? "true" : "false"}" ${notifyDefault ? "checked" : ""}>${esc(sftpAutomationLabel("notify", {defaultValue:"任务完成或失败时汇总通知（不逐文件通知）"}))}</label>`);
  if (form) form.insertAdjacentHTML("beforeend", `<label class="checkline sftp-automation-option-card"><input id="sftpAutomationCompareContent" type="checkbox" ${options.compare_content !== false ? "checked" : ""}><span><strong>${esc(sftpAutomationLabel("compare_content", {defaultValue:"智能内容校验"}))}</strong><small>${esc(sftpAutomationLabel("compare_content_hint", {defaultValue:"同名且大小相同时，首次建立基线或任一侧时间变化会使用 SHA-256 确认内容，避免重复传输或误覆盖。"}))}</small></span></label><label class="checkline sftp-automation-option-card danger"><input id="sftpAutomationPropagateDeletes" type="checkbox" data-change-action="sftp-automation-delete-mode" ${options.propagate_deletes ? "checked" : ""}><span><strong>${esc(sftpAutomationLabel("propagate_deletes", {defaultValue:"同步删除"}))}</strong><small>${esc(sftpAutomationLabel("propagate_deletes_hint", {defaultValue:"默认关闭。启用后只删除上次已同步且目标未改变的文件；目标也改变时保留并记为冲突。"}))}</small></span></label>`);
  if ($("sftpAutomationCron")) updateSftpAutomationCronPreview();
  syncSftpAutomationModeHint();
}

async function saveSftpAutomation(id=0) {
  const direction = $("sftpAutomationDirection")?.value || "upload";
  const existing = sftpAutomationState.items.find(item => Number(item.id) === Number(id));
  const startAtMs = Date.parse($("sftpAutomationStartAt")?.value || "") || 0;
  const frequency = $("sftpAutomationFrequency")?.value || "daily";
  if (frequency === "cron" && !$("sftpAutomationCronStatus")?.classList.contains("valid")) return notify(sftpAutomationLabel("cron_save_invalid", {defaultValue:"请先输入有效的 Cron 表达式"}), "error");
  const countdownInputs = [$("sftpAutomationCountdownHours"), $("sftpAutomationCountdownMinutes"), $("sftpAutomationCountdownSeconds")];
  const countdownSeconds = countdownInputs.some(Boolean) ? (Number($("sftpAutomationCountdownHours")?.value || 0) * 3600) + (Number($("sftpAutomationCountdownMinutes")?.value || 0) * 60) + Number($("sftpAutomationCountdownSeconds")?.value || 0) : Number(existing?.schedule?.countdown_seconds || 60);
  const schedule = frequency === "legacy_manual" ? {...(existing?.schedule || {frequency:"daily"})} : {
    frequency,
    interval:Number($("sftpAutomationScheduleInterval")?.value || 1),
    weekdays:[...document.querySelectorAll('input[name="sftpAutomationWeekday"]:checked')].map(input => Number(input.value)),
    weekday:Number(document.querySelector('input[name="sftpAutomationWeekday"]:checked')?.value || 1),
    day:Number($("sftpAutomationScheduleDay")?.value || 1),
    month:Number($("sftpAutomationScheduleMonth")?.value || 1),
    countdown_seconds:countdownSeconds,
    half_hour_slots:[...document.querySelectorAll('input[name="sftpAutomationHalfHourSlot"]:checked')].map(input => Number(input.value)),
    cron:$("sftpAutomationCron")?.value || "",
    start_at_ms:startAtMs,
    at_ms:startAtMs || existing?.schedule?.at_ms || 0,
    hour:startAtMs ? new Date(startAtMs).getHours() : Number(existing?.schedule?.hour || 9),
    minute:startAtMs ? new Date(startAtMs).getMinutes() : Number(existing?.schedule?.minute || 0)
  };
  const triggerMode = frequency === "legacy_manual" ? "manual" : frequency === "realtime" ? "continuous" : "schedule";
  const payload = {kind:"auto",name:$("sftpAutomationName")?.value || "",connection_id:Number($("sftpAutomationConnection")?.value || 0),local_path:$("sftpAutomationLocal")?.value || "",remote_path:sftpAutomationRemoteApiPath($("sftpAutomationRemote")?.value || "."),direction,trigger_mode:triggerMode,enabled:Boolean($("sftpAutomationEnabled")?.checked),missed_policy:$("sftpAutomationMissedPolicy")?.value || existing?.missed_policy || "run_once",options:{conflict:$("sftpAutomationConflict")?.value || "overwrite",excludes:$("sftpAutomationExcludes")?.value || "",interval_minutes:frequency === "every_minute" ? Number(schedule.interval || 1) : Number(existing?.options?.interval_minutes || 15),notify:Boolean($("sftpAutomationNotify")?.checked),compare_content:Boolean($("sftpAutomationCompareContent")?.checked),propagate_deletes:Boolean($("sftpAutomationPropagateDeletes")?.checked),history_limit:Number(existing?.options?.history_limit || 300)},schedule};
  try { await api(id ? `/api/sftp/automations/${Number(id)}` : "/api/sftp/automations", {method:id ? "PUT" : "POST",body:JSON.stringify(payload)}); notify(sftpAutomationLabel("saved", {defaultValue:"传输与同步任务已保存"}), "success"); return openSftpAutomationManager(); }
  catch (error) { notify(error.message || sftpAutomationLabel("save_failed", {defaultValue:"保存任务失败"}), "error"); }
}

async function runSftpAutomation(id) {
  try { await api(`/api/sftp/automations/${Number(id)}/run`, {method:"POST",body:"{}"}); await loadSftpAutomations(); openSftpAutomationManager(sftpAutomationState.tab); }
  catch (error) { notify(error.message || sftpAutomationLabel("run_failed", {defaultValue:"启动自动化任务失败"}), "error"); }
}

async function toggleSftpAutomation(id, enabled) {
  try { await api(`/api/sftp/automations/${Number(id)}/${enabled ? "enable" : "pause"}`, {method:"POST",body:"{}"}); return openSftpAutomationManager(sftpAutomationState.tab); }
  catch (error) { notify(error.message || sftpAutomationLabel("toggle_failed", {defaultValue:"更新任务状态失败"}), "error"); }
}

async function deleteSftpAutomation(id) {
  const accepted = await confirmSftpAutomationAction({
    title:sftpAutomationLabel("delete_title", {defaultValue:"删除任务"}),
    message:sftpAutomationLabel("delete_confirm", {defaultValue:"删除这个自动化任务？"}),
    confirmText:sftpAutomationLabel("delete_confirm_action", {defaultValue:"删除"}),
    danger:true
  });
  if (!accepted) return;
  try { await api(`/api/sftp/automations/${Number(id)}`, {method:"DELETE"}); return openSftpAutomationManager(sftpAutomationState.tab); }
  catch (error) { notify(error.message || sftpAutomationLabel("delete_failed", {defaultValue:"删除任务失败"}), "error"); }
}

async function openSftpAutomationLocalPath(id) {
  const item = sftpAutomationState.items.find(entry => Number(entry.id) === Number(id));
  if (!item?.local_path) return;
  try { await api("/api/local-files/open", {method:"POST",body:JSON.stringify({path:item.local_path})}); }
  catch (error) { notify(error.message || sftpAutomationLabel("open_local_failed", {defaultValue:"打开本机目录失败"}), "error"); }
}

function openSftpAutomationRemotePath(id) {
  const item = sftpAutomationState.items.find(entry => Number(entry.id) === Number(id));
  if (!item?.connection_id || !item.remote_path) return;
  stopSftpAutomationManagerRefresh();
  closeModal();
  return openSftp(Number(item.connection_id), item.remote_path, true);
}

registerTermaAction("sftp-automation-open", () => openSftpAutomationManager());
registerTermaAction("sftp-automation-close", () => { stopSftpAutomationManagerRefresh(); closeModal(); });
registerTermaAction("sftp-automation-refresh", () => openSftpAutomationManager());
registerTermaAction("sftp-automation-new", () => editSftpAutomation(0));
registerTermaAction("sftp-automation-run", ({element}) => runSftpAutomation(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-edit", ({element}) => editSftpAutomation(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-history", ({element}) => openSftpAutomationHistory(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-history-close", () => openSftpAutomationManager());
registerTermaAction("sftp-automation-history-page", ({element}) => openSftpAutomationHistory(Number(element.dataset.id || 0), Number(element.dataset.page || 1)));
registerTermaAction("sftp-automation-history-limit", ({element}) => updateSftpAutomationHistoryLimit(Number(element.dataset.id || 0), Number(element.value || 300)));
registerTermaAction("sftp-automation-history-clear", ({element}) => clearSftpAutomationHistory(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-run-filter", ({element}) => filterSftpAutomationRunDetails(element));
registerTermaAction("sftp-automation-sort-start", ({event, element}) => beginSftpAutomationDrag(event, element));
registerTermaAction("sftp-automation-sort-key", ({event, element}) => moveSftpAutomationByKeyboard(event, element));
registerTermaAction("sftp-automation-toggle", ({element}) => toggleSftpAutomation(Number(element.dataset.id || 0), element.dataset.enabled === "true"));
registerTermaAction("sftp-automation-delete", ({element}) => deleteSftpAutomation(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-open-local", ({element}) => openSftpAutomationLocalPath(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-open-remote", ({element}) => openSftpAutomationRemotePath(Number(element.dataset.id || 0)));
registerTermaAction("sftp-automation-form-close", () => openSftpAutomationManager());
registerTermaAction("sftp-automation-choose", () => chooseSftpAutomationDirectory("sftpAutomationLocal"));
registerTermaAction("sftp-automation-frequency", () => syncSftpAutomationScheduleFields());
registerTermaAction("sftp-automation-cron", () => updateSftpAutomationCronPreview());
registerTermaAction("sftp-automation-direction", () => syncSftpAutomationModeHint());
registerTermaAction("sftp-automation-delete-mode", () => syncSftpAutomationModeHint());
registerTermaAction("sftp-automation-notify", () => { if ($("sftpAutomationNotify")) $("sftpAutomationNotify").dataset.auto = "false"; });
registerTermaAction("sftp-automation-remote-browse", () => toggleSftpAutomationRemotePicker(true));
registerTermaAction("sftp-automation-remote-root", () => loadSftpAutomationRemoteDirectory("/"));
registerTermaAction("sftp-automation-remote-up", () => loadSftpAutomationRemoteDirectory(sftpAutomationRemoteParent(sftpAutomationRemotePicker.path || $("sftpAutomationRemotePickerPath")?.value || ".")));
registerTermaAction("sftp-automation-remote-refresh", () => loadSftpAutomationRemoteDirectory(sftpAutomationRemotePicker.path || $("sftpAutomationRemotePickerPath")?.value || "."));
registerTermaAction("sftp-automation-remote-toggle", ({element}) => {
  const nodePath = sftpAutomationRemoteApiPath(element.dataset.path || ".");
  sftpAutomationRemotePicker.path = nodePath;
  if (sftpAutomationRemotePicker.expanded.has(nodePath) && sftpAutomationRemotePicker.nodes.has(nodePath)) { sftpAutomationRemotePicker.expanded.delete(nodePath); renderSftpAutomationRemoteEntries(); }
  else loadSftpAutomationRemoteDirectory(nodePath);
});
registerTermaAction("sftp-automation-remote-new", () => showSftpAutomationRemoteFolderEditor(true));
registerTermaAction("sftp-automation-remote-new-confirm", () => createSftpAutomationRemoteFolder());
registerTermaAction("sftp-automation-remote-new-cancel", () => showSftpAutomationRemoteFolderEditor(false));
registerTermaAction("sftp-automation-remote-select", () => {
  const pathValue = sftpAutomationRemotePicker.path || $("sftpAutomationRemotePickerPath")?.value || ".";
  if ($("sftpAutomationRemote")) $("sftpAutomationRemote").value = sftpAutomationRemoteDisplayPath(pathValue);
  toggleSftpAutomationRemotePicker(false);
});
registerTermaAction("sftp-automation-save", ({element}) => saveSftpAutomation(Number(element.dataset.id || 0)));
