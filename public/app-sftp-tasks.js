const sftpTaskLogViewStates = new Map();
const SFTP_TASK_CENTER_MIN_WIDTH = 340;
const SFTP_TASK_CENTER_MIN_HEIGHT = 240;
const SFTP_TASK_CENTER_VIEWPORT_GAP = 12;
const SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1";
let sftpTaskCenterResize = null;

function savedSftpTaskCenterSize() {
  try {
    const saved = JSON.parse(localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY) || "null");
    const width = Number(saved?.width);
    const height = Number(saved?.height);
    return Number.isFinite(width) && Number.isFinite(height) ? {width, height} : null;
  } catch {
    return null;
  }
}

function persistSftpTaskCenterSize(drawer) {
  if (!drawer || isMobileLayout()) return;
  const rect = drawer.getBoundingClientRect();
  try {
    localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY, JSON.stringify({
      width:Math.round(rect.width),
      height:Math.round(rect.height)
    }));
  } catch {}
}

function restoreSftpTaskCenterSize(drawer) {
  if (!drawer) return false;
  if (isMobileLayout()) {
    drawer.style.removeProperty("width");
    drawer.style.removeProperty("height");
    return false;
  }
  const saved = savedSftpTaskCenterSize();
  if (!saved) return false;
  applySftpTaskCenterSize(drawer, saved.width, saved.height);
  return true;
}

function sftpTaskCenterResizeBounds(drawer) {
  const rect = drawer.getBoundingClientRect();
  const maxWidth = Math.max(1, rect.right - SFTP_TASK_CENTER_VIEWPORT_GAP);
  const maxHeight = Math.max(1, window.innerHeight - rect.top - SFTP_TASK_CENTER_VIEWPORT_GAP);
  return {
    minWidth:Math.min(SFTP_TASK_CENTER_MIN_WIDTH, maxWidth),
    minHeight:Math.min(SFTP_TASK_CENTER_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight
  };
}

function applySftpTaskCenterSize(drawer, width, height) {
  const bounds = sftpTaskCenterResizeBounds(drawer);
  const nextWidth = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, Number(width) || bounds.minWidth));
  const nextHeight = Math.max(bounds.minHeight, Math.min(bounds.maxHeight, Number(height) || bounds.minHeight));
  drawer.style.width = `${Math.round(nextWidth)}px`;
  drawer.style.height = `${Math.round(nextHeight)}px`;
}

function startSftpTaskCenterResize(event) {
  if (event.button !== 0 || isMobileLayout()) return;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (!drawer || drawer.hidden) return;
  if (sftpTaskCenterResize) finishSftpTaskCenterResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  const rect = drawer.getBoundingClientRect();
  sftpTaskCenterResize = {
    drawer,
    handle:event.currentTarget,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    startWidth:rect.width,
    startHeight:rect.height
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("sftp-task-center-resizing");
  window.addEventListener("pointermove", moveSftpTaskCenterResize, {passive:false});
  window.addEventListener("pointerup", finishSftpTaskCenterResize);
  window.addEventListener("pointercancel", cancelSftpTaskCenterResize);
  window.addEventListener("blur", finishSftpTaskCenterResizeOnBlur);
}

function moveSftpTaskCenterResize(event) {
  const drag = sftpTaskCenterResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applySftpTaskCenterSize(
    drag.drawer,
    drag.startWidth - (event.clientX - drag.startX),
    drag.startHeight + (event.clientY - drag.startY)
  );
}

function cancelSftpTaskCenterResize(event) {
  finishSftpTaskCenterResize(event, true);
}

function finishSftpTaskCenterResizeOnBlur() {
  finishSftpTaskCenterResize(null);
}

function finishSftpTaskCenterResize(event, cancelled=false) {
  const drag = sftpTaskCenterResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveSftpTaskCenterResize);
  window.removeEventListener("pointerup", finishSftpTaskCenterResize);
  window.removeEventListener("pointercancel", cancelSftpTaskCenterResize);
  window.removeEventListener("blur", finishSftpTaskCenterResizeOnBlur);
  sftpTaskCenterResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("sftp-task-center-resizing");
  if (cancelled) applySftpTaskCenterSize(drag.drawer, drag.startWidth, drag.startHeight);
  else persistSftpTaskCenterSize(drag.drawer);
}

function resetSftpTaskCenterSize(event) {
  if (isMobileLayout()) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  drawer?.style.removeProperty("width");
  drawer?.style.removeProperty("height");
  try { localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY); } catch {}
}

function handleSftpTaskCenterResizeKey(event) {
  if (isMobileLayout()) return;
  if (event.key === "Home") return resetSftpTaskCenterSize(event);
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (!drawer) return;
  const rect = drawer.getBoundingClientRect();
  const step = event.shiftKey ? 32 : 16;
  const width = rect.width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0);
  const height = rect.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
  applySftpTaskCenterSize(drawer, width, height);
  persistSftpTaskCenterSize(drawer);
}

function startSftpJobsTimer() {
  if (sftpJobsTimer) return;
  sftpJobsTimer = setInterval(() => {
    if (!document.hidden) refreshSftpJobs();
    void refreshActiveSftpSessionStatus();
  }, 3000);
}

function sftpJobProgress(job) {
  const size = Math.max(0, Number(job?.size || 0));
  const known = job?.progress_known === true || job?.size_known === true || size > 0;
  if (!known) return null;
  const transferred = Math.max(0, Math.min(size, Number(job?.transferred || 0)));
  const calculated = size ? transferred / size * 100 : 0;
  const explicit = Number(job?.progress);
  let percent = Number.isFinite(explicit) ? explicit : calculated;
  if (["running", "pending", "paused"].includes(job?.status) && percent >= 100) percent = 99;
  if (job?.status === "done") percent = 100;
  return {
    size,
    transferred,
    percent:Math.max(0, Math.min(100, percent)),
    weightable:size > 0 && !job?.two_stage_upload
  };
}

function sftpJobProgressLabel(job, progress) {
  if (!progress) return "";
  return `${job?.progress_estimated ? "约 " : ""}${Math.round(progress.percent)}%`;
}

function sftpTaskCollections(jobs=sftpLatestJobs) {
  const current = jobs.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status));
  const failed = jobs.filter(job => job.status === "failed"
    || (job.status === "done" && job.type === "download" && job.delivery_status === "failed"));
  const history = jobs.filter(job => ["done", "cancelled"].includes(job.status)
    && !(job.type === "download" && job.delivery_status === "failed"));
  const activeCount = current.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status)).length;
  const failedCount = failed.length;
  return {current, failed, history, activeCount, failedCount};
}

function sftpTaskCenterProgress(jobs=sftpLatestJobs) {
  const active = jobs.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status));
  if (!active.length) return null;
  const entries = active.map(job => ({job, progress:sftpJobProgress(job)}));
  const known = entries.filter(entry => entry.progress);
  if (!known.length) return {activeCount:active.length, percent:0, determinate:false};
  const progressUnits = new Set(known.map(entry => entry.job.progress_unit || "bytes"));
  const canWeightBySize = progressUnits.size === 1 && known.every(entry => entry.progress.weightable);
  const totalWeight = canWeightBySize ? known.reduce((sum, entry) => sum + entry.progress.size, 0) : known.length;
  const percent = canWeightBySize && totalWeight
    ? known.reduce((sum, entry) => sum + entry.progress.percent * entry.progress.size, 0) / totalWeight
    : known.reduce((sum, entry) => sum + entry.progress.percent, 0) / totalWeight;
  return {
    activeCount:active.length,
    percent:Math.max(0, Math.min(99, percent)),
    determinate:known.length === entries.length
  };
}

function sftpFloatingProgressEnabled() {
  return runtimeSettings !== null && runtimeSettings?.saved?.sftp_floating_progress_enabled !== false;
}

function sftpFloatingJobDetail(job) {
  const progress = sftpJobProgress(job);
  const speed = job.status === "running" ? Number(job.speed_bps || 0) : 0;
  const transferred = Math.max(0, Number(job.transferred || 0));
  const size = Math.max(0, Number(job.size || 0));
  const amount = job.progress_unit === "percent"
    ? (job.current || "")
    : job.progress_unit === "items" && size
      ? `已处理 ${Math.min(size, transferred)} / ${size} 项`
      : progress
        ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.size)}`
        : "";
  return [job.connection_name || "", sftpJobStatus(job.status, job.phase), amount, speed ? `${formatBytes(speed)}/s` : "", sftpJobProgressLabel(job, progress)]
    .filter(Boolean)
    .join(" · ");
}

function dismissSftpTaskFloat() {
  for (const job of sftpLatestJobs.filter(item => SFTP_ACTIVE_JOB_STATUSES.has(item.status))) {
    if (job.id) sftpDismissedFloatingJobIds.add(String(job.id));
  }
  const box = document.getElementById("sftpTaskFloat");
  if (box) box.hidden = true;
}

async function muteSftpTaskFloat() {
  const accepted = await confirmModal(
    "静默后将永久关闭此类悬浮进度卡。后台任务仍会继续，也可以通过标题栏任务中心查看；需要恢复时，请前往通用设置重新开启。",
    "静默悬浮进度卡",
    "永久静默",
    "取消"
  );
  if (!accepted) return;
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({sftp_floating_progress_enabled:false})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    updateSftpTaskFloat(sftpLatestJobs);
    notify("悬浮进度卡已静默，可在通用设置中重新开启", "success");
  } catch (error) {
    notify(error.message || "静默悬浮进度卡失败", "error");
  }
}

async function openSftpTaskList(event) {
  if (event?.target?.closest?.(".sftp-task-float-actions")) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  setSftpTaskCenterView("current");
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (drawer?.hidden) await toggleSftpTaskCenter();
  else await refreshSftpJobs();
}

function updateSftpTaskFloat(jobs=sftpLatestJobs) {
  const box = document.getElementById("sftpTaskFloat");
  if (!box) return;
  const active = jobs.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status));
  const activeIds = new Set(active.map(job => String(job.id || "")).filter(Boolean));
  for (const id of [...sftpDismissedFloatingJobIds]) {
    if (!activeIds.has(id)) sftpDismissedFloatingJobIds.delete(id);
  }
  if (!sftpFloatingProgressEnabled() || !active.length) {
    box.hidden = true;
    if (!active.length) {
      box.innerHTML = "";
      delete box.dataset.statusIcon;
    }
    return;
  }
  if (!active.some(job => !sftpDismissedFloatingJobIds.has(String(job.id || "")))) {
    box.hidden = true;
    return;
  }

  const aggregate = sftpTaskCenterProgress(active);
  const determinate = Boolean(aggregate?.determinate);
  const percent = Number(aggregate?.percent || 0);
  const totalSpeed = active.reduce((total, job) => total + (job.status === "running" ? Math.max(0, Number(job.speed_bps || 0)) : 0), 0);
  const title = active.length === 1 ? (active[0].label || "后台任务") : `${active.length} 个后台任务`;
  const detail = active.length === 1
    ? sftpFloatingJobDetail(active[0])
    : [
        active.some(job => job.status === "running") ? `${active.filter(job => job.status === "running").length} 项执行中` : "",
        active.some(job => job.status === "pending") ? `${active.filter(job => job.status === "pending").length} 项准备中` : "",
        active.some(job => job.status === "paused") ? `${active.filter(job => job.status === "paused").length} 项已暂停` : "",
        totalSpeed ? `${formatBytes(totalSpeed)}/s` : "",
        determinate ? `${active.some(job => job.progress_estimated) ? "约 " : ""}${Math.round(percent)}%` : ""
      ].filter(Boolean).join(" · ");
  const singleCancelable = active.length === 1
    && active[0].can_cancel !== false
    && !(active[0].type === "upload" && active[0].phase === "committing");
  if (!box.querySelector(".sftp-task-float-head")) {
    box.innerHTML = `<div class="sftp-task-float-head"><button type="button" class="sftp-task-float-open" title="打开任务中心"><span class="sftp-task-float-icon"></span><span class="sftp-task-float-copy"><strong class="sftp-task-float-title"></strong><span class="sftp-task-float-detail"></span></span></button><span class="sftp-task-float-actions"><button type="button" class="icon-button sftp-task-float-cancel" onclick="event.stopPropagation();cancelSftpJob(this.dataset.jobId)" title="停止任务" aria-label="停止任务" hidden>${icon("square")}</button><button type="button" class="icon-button sftp-task-float-close" onclick="event.stopPropagation();dismissSftpTaskFloat()" title="关闭当前悬浮进度" aria-label="关闭当前悬浮进度">${icon("x")}</button><button type="button" class="icon-button sftp-task-float-mute" onclick="event.stopPropagation();muteSftpTaskFloat()" title="静默悬浮进度卡" aria-label="静默悬浮进度卡">${icon("bell-off")}</button></span></div><div class="progress" role="progressbar" aria-label="任务进度"><i></i></div>`;
  }
  const hasRunning = active.some(job => job.status === "running");
  const statusIcon = box.querySelector(".sftp-task-float-icon");
  const statusIconKind = hasRunning ? "running" : "paused";
  if (statusIcon && box.dataset.statusIcon !== statusIconKind) {
    statusIcon.innerHTML = hasRunning ? `<span class="sftp-task-spinner" aria-hidden="true"></span>` : icon("pause");
    box.dataset.statusIcon = statusIconKind;
  }
  const titleNode = box.querySelector(".sftp-task-float-title");
  const detailNode = box.querySelector(".sftp-task-float-detail");
  if (titleNode) titleNode.textContent = title;
  if (detailNode) detailNode.textContent = detail;
  const cancelButton = box.querySelector(".sftp-task-float-cancel");
  if (cancelButton) {
    cancelButton.hidden = !singleCancelable;
    cancelButton.dataset.jobId = singleCancelable ? String(active[0].id || "") : "";
  }
  const progress = box.querySelector(".progress");
  const progressBar = progress?.querySelector("i");
  if (progress) {
    progress.classList.toggle("indeterminate", !determinate);
    if (determinate) {
      progress.setAttribute("aria-valuenow", String(Math.round(percent)));
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
    } else {
      progress.removeAttribute("aria-valuenow");
      progress.removeAttribute("aria-valuemin");
      progress.removeAttribute("aria-valuemax");
    }
  }
  if (progressBar) progressBar.style.width = determinate ? `${percent}%` : "";
  box.hidden = false;
}

function ensureSftpTaskLogViewState(taskId) {
  const key = String(taskId || "");
  let state = sftpTaskLogViewStates.get(key);
  if (!state) {
    state = {expanded:false, openedOnce:false, follow:true, scrollTop:0};
    sftpTaskLogViewStates.set(key, state);
  }
  return state;
}

function sftpTaskLogAtBottom(log) {
  return !log || log.scrollHeight - log.scrollTop - log.clientHeight <= 12;
}

function captureSftpTaskLogViewStates(root=document.getElementById("sftpTaskCenterList")) {
  root?.querySelectorAll?.(".global-task-log[data-task-id]").forEach(details => {
    const state = ensureSftpTaskLogViewState(details.dataset.taskId);
    const log = details.querySelector("pre");
    state.expanded = details.open;
    if (!log || !details.open) return;
    const firstOpen = !state.openedOnce;
    state.openedOnce = true;
    state.follow = firstOpen ? true : sftpTaskLogAtBottom(log);
    if (state.follow) log.scrollTop = log.scrollHeight;
    state.scrollTop = log.scrollTop;
  });
}

function restoreSftpTaskLogScroll(log, state) {
  if (!log || !state) return;
  if (state.follow) log.scrollTop = log.scrollHeight;
  else log.scrollTop = Math.min(state.scrollTop, Math.max(0, log.scrollHeight - log.clientHeight));
  state.scrollTop = log.scrollTop;
}

function bindSftpTaskLogViewStates(root=document.getElementById("sftpTaskCenterList")) {
  root?.querySelectorAll?.(".global-task-log[data-task-id]").forEach(details => {
    const state = ensureSftpTaskLogViewState(details.dataset.taskId);
    const log = details.querySelector("pre");
    details.open = state.expanded;
    details.addEventListener("toggle", () => {
      const firstOpen = details.open && !state.openedOnce;
      state.expanded = details.open;
      if (!details.open || !log) return;
      if (firstOpen) {
        state.openedOnce = true;
        state.follow = true;
      }
      restoreSftpTaskLogScroll(log, state);
    });
    log?.addEventListener("scroll", () => {
      state.follow = sftpTaskLogAtBottom(log);
      state.scrollTop = log.scrollTop;
    }, {passive:true});
    if (details.open && log) {
      state.openedOnce = true;
      restoreSftpTaskLogScroll(log, state);
    }
  });
}

function renderSftpTaskCenterDrawer(jobs=sftpLatestJobs) {
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const list = document.getElementById("sftpTaskCenterList");
  if (!drawer || !list) return;
  captureSftpTaskLogViewStates(list);
  const {current, failed, history, activeCount, failedCount} = sftpTaskCollections(jobs);
  const showingHistory = sftpTaskCenterView === "history";
  const showingFailed = sftpTaskCenterView === "failed";
  const visible = showingHistory ? history : showingFailed ? failed : current;
  const currentTab = document.getElementById("sftpTaskCenterCurrentTab");
  const failedTab = document.getElementById("sftpTaskCenterFailedTab");
  const historyTab = document.getElementById("sftpTaskCenterHistoryTab");
  currentTab?.setAttribute("aria-selected", String(!showingHistory && !showingFailed));
  failedTab?.setAttribute("aria-selected", String(showingFailed));
  historyTab?.setAttribute("aria-selected", String(showingHistory));
  currentTab?.classList.toggle("active", !showingHistory && !showingFailed);
  failedTab?.classList.toggle("active", showingFailed);
  historyTab?.classList.toggle("active", showingHistory);
  const currentCount = document.getElementById("sftpTaskCenterCurrentCount");
  const failedCountNode = document.getElementById("sftpTaskCenterFailedCount");
  const historyCount = document.getElementById("sftpTaskCenterHistoryCount");
  if (currentCount) currentCount.textContent = String(current.length);
  if (failedCountNode) failedCountNode.textContent = String(failed.length);
  if (historyCount) historyCount.textContent = String(history.length);
  list.innerHTML = visible.length
    ? visible.map(renderSftpJob).join("")
    : `<div class="sftp-task-empty">${showingHistory ? "暂无已完成或已取消的任务" : showingFailed ? "暂无失败的任务" : "暂无进行中的任务"}</div>`;
  bindSftpTaskLogViewStates(list);
  list.setAttribute("aria-labelledby", showingHistory ? "sftpTaskCenterHistoryTab" : showingFailed ? "sftpTaskCenterFailedTab" : "sftpTaskCenterCurrentTab");
  const summary = document.getElementById("sftpTaskCenterSummary");
  if (summary) summary.textContent = [
    activeCount ? `${activeCount} 项进行中` : "",
    failedCount ? `${failedCount} 项失败` : "",
    !activeCount && !failedCount ? "暂无进行中的任务" : ""
  ].filter(Boolean).join(" · ");
  const footer = document.getElementById("sftpTaskCenterFooter");
  if (footer) footer.hidden = !showingHistory || !history.length;
}

function updateSftpTaskCenter(jobs=sftpLatestJobs) {
  const button = document.getElementById("sftpTaskCenterButton");
  const iconBox = document.getElementById("sftpTaskCenterIcon");
  const badge = document.getElementById("sftpTaskCenterBadge");
  const progressBar = document.getElementById("sftpTaskCenterProgress");
  if (!button || !iconBox || !badge) return;
  const {current, failed, activeCount, failedCount} = sftpTaskCollections(jobs);
  const status = failedCount ? "failed" : activeCount ? "running" : "idle";
  if (button.dataset.status !== status) {
    iconBox.innerHTML = icon(status === "failed" ? "circle-alert" : status === "running" ? "loader-circle" : "list-checks");
    button.dataset.status = status;
  }
  button.classList.toggle("is-running", activeCount > 0);
  button.classList.toggle("is-failed", failedCount > 0);
  const attentionCount = current.length + failed.length;
  badge.hidden = !attentionCount;
  badge.textContent = attentionCount > 99 ? "99+" : String(attentionCount);
  const description = [activeCount ? `${activeCount} 项进行中` : "", failedCount ? `${failedCount} 项失败` : ""].filter(Boolean).join("，");
  button.title = description ? `任务中心：${description}` : "任务中心";
  button.setAttribute("aria-label", button.title);
  if (progressBar) {
    const progress = sftpTaskCenterProgress(jobs);
    const determinate = Boolean(progress?.determinate);
    progressBar.hidden = !progress;
    progressBar.classList.toggle("is-indeterminate", Boolean(progress) && !determinate);
    const fill = progressBar.querySelector("i");
    if (fill) fill.style.width = `${Math.round(progress?.percent || 0)}%`;
    if (progress) {
      progressBar.setAttribute("aria-valuetext", determinate ? `${Math.round(progress.percent)}%` : "正在计算任务进度");
      if (determinate) progressBar.setAttribute("aria-valuenow", String(Math.round(progress.percent)));
      else progressBar.removeAttribute("aria-valuenow");
    } else {
      progressBar.removeAttribute("aria-valuenow");
      progressBar.removeAttribute("aria-valuetext");
    }
  }
  renderSftpTaskCenterDrawer(jobs);
  updateSftpTaskFloat(jobs);
}

function setSftpTaskCenterView(view) {
  sftpTaskCenterView = ["history", "failed"].includes(view) ? view : "current";
  renderSftpTaskCenterDrawer();
}

function closeSftpTaskCenter() {
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const button = document.getElementById("sftpTaskCenterButton");
  if (sftpTaskCenterResize) finishSftpTaskCenterResize(null);
  if (drawer) drawer.hidden = true;
  button?.setAttribute("aria-expanded", "false");
}

async function toggleSftpTaskCenter(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const button = document.getElementById("sftpTaskCenterButton");
  if (!drawer || !button) return;
  if (!drawer.hidden) return closeSftpTaskCenter();
  drawer.hidden = false;
  restoreSftpTaskCenterSize(drawer);
  button.setAttribute("aria-expanded", "true");
  renderSftpTaskCenterDrawer();
  await refreshSftpJobs();
}

function trackSftpMutationJob(job) {
  if (job?.id) sftpKnownJobStatuses.set(String(job.id), String(job.status || "running"));
}

function completedSftpMutationForCurrentView(jobs) {
  const connectionsToRefresh = new Set();
  const visibleIds = new Set();
  for (const job of jobs) {
    const id = String(job.id || "");
    if (!id) continue;
    visibleIds.add(id);
    const previous = sftpKnownJobStatuses.get(id);
    if (previous && previous !== job.status && ["done", "cancelled", "failed"].includes(job.status) && SFTP_MUTATING_JOB_TYPES.has(job.type)) {
      const connectionId = Number(job.connection_id || 0);
      if (connectionId) connectionsToRefresh.add(connectionId);
      if (job.type === "local-delivery" && typeof refreshLocalFilesForDeliveryJob === "function") refreshLocalFilesForDeliveryJob(job);
    }
    sftpKnownJobStatuses.set(id, String(job.status || ""));
  }
  for (const id of [...sftpKnownJobStatuses.keys()]) {
    if (!visibleIds.has(id) && sftpKnownJobStatuses.size > 80) sftpKnownJobStatuses.delete(id);
  }
  return connectionsToRefresh;
}

function queueSftpDirectoryRefresh(connectionId) {
  const id = Number(connectionId || 0);
  for (const runtime of sftpTabRuntimes.values()) {
    if (Number(runtime.connectionId) === id) sftpPendingDirectoryRefreshes.add(runtime.tabKey);
  }
}

function flushPendingSftpDirectoryRefresh(tabKey="") {
  const keys = tabKey ? [String(tabKey)] : [...sftpPendingDirectoryRefreshes];
  for (const key of keys) {
    if (!sftpPendingDirectoryRefreshes.has(key)) continue;
    const runtime = sftpTabRuntimes.get(key);
    if (!runtime) {
      sftpPendingDirectoryRefreshes.delete(key);
      continue;
    }
    if (runtime.state.loading || !sftpRuntimeRoot(key)?.isConnected) continue;
    sftpPendingDirectoryRefreshes.delete(key);
    void refreshSftp({tabKey:key});
  }
}

async function refreshSftpJobs() {
  const requestSeq = ++sftpJobsRequestSeq;
  const [transferJobs, syncJobs, desktopJobs, componentJobs] = await Promise.all([
    api("/api/sftp/jobs").catch(() => []),
    window.termaDesktop ? api("/api/sftp/sync/jobs").catch(() => []) : Promise.resolve([]),
    api("/api/linux-desktop/tasks").catch(() => []),
    api("/api/remote-component/tasks").catch(() => [])
  ]);
  const jobs = [...transferJobs, ...syncJobs.map(job => ({
    ...job,
    id:`sync:${job.id}`,
    raw_sync_id:job.id,
    label:job.type === "sync-scan" ? "目录比较" : "目录同步",
    connection_name:connections.find(item => Number(item.id) === Number(job.connection_id))?.name || "",
    status:job.status === "completed" ? "done" : job.status,
    size:Number(job.total || 0),
    transferred:Number(job.completed || 0),
    progress_unit:"items",
    progress_known:Boolean(job.total),
    can_cancel:job.status === "running",
    can_pause:false,
    finished_at:["completed", "failed", "cancelled"].includes(job.status) ? job.updated_at : null,
    error:job.errors?.map(item => `${item.relative ? `${item.relative}：` : ""}${item.error}`).join("\n") || ""
  })), ...desktopJobs.map(task => ({
    id:`desktop:${task.id}`,
    raw_desktop_id:task.id,
    type:"linux-desktop",
    label:`${task.desktop_label || "Linux 桌面"}${task.action_label || (task.action === "uninstall" ? "卸载" : "安装")}`,
    connection_id:Number(task.connection_id || 0),
    connection_name:task.connection_name || "",
    status:task.status,
    phase:task.stage || "prepare",
    current:({prepare:"正在准备", packages:"正在处理软件包", refresh:"正在刷新会话", verify:"正在验证结果", done:"已完成"}[task.stage] || task.stage || ""),
    size:100,
    transferred:Number(task.progress || 0),
    progress:Number(task.progress || 0),
    progress_unit:"percent",
    progress_known:true,
    can_cancel:false,
    can_pause:false,
    finished_at:task.finished_at || null,
    updated_at:task.updated_at || 0,
    logs:Array.isArray(task.logs) ? task.logs : [],
    error:task.error || ""
  })), ...componentJobs.map(task => ({
    id:`component:${task.id}`,
    raw_component_id:task.id,
    type:"remote-component",
    label:`${task.component_label || "远端组件"}${task.action_label || "离线安装"}`,
    connection_id:Number(task.connection_id || 0),
    connection_name:task.connection_name || "",
    status:task.status,
    phase:task.stage || "prepare",
    current:task.current || "",
    size:100,
    transferred:Number(task.progress || 0),
    progress:Number(task.progress || 0),
    progress_unit:"percent",
    progress_known:true,
    can_cancel:false,
    can_pause:false,
    finished_at:task.finished_at || null,
    updated_at:task.updated_at || 0,
    logs:Array.isArray(task.logs) ? task.logs : [],
    error:task.error || ""
  }))];
  if (requestSeq !== sftpJobsRequestSeq) return sftpLatestJobs;
  const readyBrowserDownload = jobs.find(job => job.status === "done"
    && job.type === "download"
    && sftpPendingBrowserDownloads.has(job.id));
  if (readyBrowserDownload) {
    sftpPendingBrowserDownloads.delete(readyBrowserDownload.id);
    saveSftpJobFile(readyBrowserDownload.id);
    notify("下载完成，已交给当前设备的浏览器保存", "success");
  }
  sftpLatestJobs = jobs;
  updateSftpTaskCenter(jobs);
  for (const connectionId of completedSftpMutationForCurrentView(jobs)) queueSftpDirectoryRefresh(connectionId);
  flushPendingSftpDirectoryRefresh();
  if (jobs.some(job => ["running", "pending", "paused"].includes(job.status))) startSftpJobsTimer();
  return jobs;
}

function renderSftpJob(job) {
  const syncJob = String(job.id || "").startsWith("sync:");
  const desktopJob = String(job.id || "").startsWith("desktop:");
  const componentJob = String(job.id || "").startsWith("component:");
  const done = job.status === "done";
  const running = job.status === "running";
  const paused = job.status === "paused";
  const pending = job.status === "pending";
  const cancelable = (running || paused || pending)
    && job.can_cancel !== false
    && !(job.type === "upload" && job.phase === "committing");
  const deletable = ["paused", "failed", "done", "cancelled"].includes(job.status);
  const resumable = Boolean(job.can_resume);
  const progressInfo = sftpJobProgress(job);
  const progress = progressInfo?.percent || 0;
  const speed = running ? Number(job.speed_bps || 0) : Number(job.average_bps || 0);
  const amount = job.progress_unit === "percent"
    ? (job.current || "")
    : job.progress_unit === "items" && job.size
      ? `已处理 ${Math.min(Number(job.size), Number(job.transferred || 0))} / ${Number(job.size)} 项`
      : job.size
        ? `${formatBytes(job.transferred || 0)} / ${formatBytes(job.size)}`
        : formatBytes(job.transferred || 0);
  const detail = [sftpJobStatus(job.status, job.phase), amount, speed ? `${formatBytes(speed)}/s${running ? "" : " 平均"}` : "", sftpJobProgressLabel(job, progressInfo)].filter(Boolean).join(" · ");
  const progressBar = ["running", "pending", "paused", "done", "failed"].includes(job.status) && progressInfo ? `<div class="progress" aria-label="${Math.round(progress)}%"><i style="width:${progress}%"></i></div>` : "";
  let downloadAction = "";
  if (done && job.type === "download" && job.delivery_status === "saved") {
    downloadAction = `<button class="primary" onclick="event.stopPropagation();openSftpDownloadDirectory(this)">${icon("folder-open")}<span>打开目录</span></button>`;
  } else if (done && job.type === "download" && ["delivered", "expired", "cache_cleared"].includes(job.delivery_status)) {
    downloadAction = `<button onclick="event.stopPropagation();downloadSftp(${Number(job.connection_id)},'${escAttr(job.remote_path || "")}', 'file', this)">${icon("download")}<span>再次下载</span></button>`;
  } else if (done && job.type === "download") {
    downloadAction = `<button class="primary" onclick="event.stopPropagation();saveSftpJobFile('${escAttr(job.id)}', this)">${icon("download")}<span>保存到本机</span></button>`;
  }
  const resumeBtn = resumable && (job.type === "download" || job.type === "upload") ? `<button class="${job.status === "failed" ? "primary" : ""}" onclick="event.stopPropagation();resumeSftpJob('${escAttr(job.id)}', this)">${job.status === "failed" ? "重试" : "继续"}</button>` : "";
  const pauseBtn = running && job.can_pause !== false && (job.type === "download" || job.type === "upload") ? `<button onclick="event.stopPropagation();pauseSftpJob('${escAttr(job.id)}', this)">暂停</button>` : "";
  const cancelBtn = cancelable ? `<button onclick="event.stopPropagation();cancelSftpJob('${escAttr(job.id)}', this)">取消</button>` : "";
  const retrySyncBtn = syncJob && job.status === "failed" && job.type === "sync" ? `<button class="primary" onclick="event.stopPropagation();retrySftpSyncJob('${escAttr(job.raw_sync_id)}', this)">重试失败项</button>` : "";
  const exportSyncBtn = syncJob && ["failed", "done", "cancelled"].includes(job.status) ? `<button onclick="event.stopPropagation();exportSftpSyncResult('${escAttr(job.raw_sync_id)}', this)">${icon("download")}<span>导出结果</span></button>` : "";
  const desktopOpenBtn = desktopJob ? `<button onclick="event.stopPropagation();openLinuxDesktopTask(${Number(job.connection_id)},'${escAttr(job.raw_desktop_id)}', this)">${icon("monitor-cog")}<span>查看</span></button>` : "";
  const deleteBtn = deletable ? `<button class="danger" onclick="event.stopPropagation();deleteSftpJob('${escAttr(job.id)}', this)">删除</button>` : "";
  const finishedAt = job.finished_at ? `<time datetime="${escAttr(new Date(job.finished_at).toISOString())}">${esc(new Date(job.finished_at).toLocaleString())}</time>` : "";
  const deliveryText = job.saved_path ? `<span class="sftp-job-delivery">已保存到 ${esc(job.saved_path)}</span>` : "";
  const deliveryError = job.delivery_error ? `<div class="sftp-job-error"><strong>自动保存失败</strong><span>${esc(job.delivery_error).slice(0,500)}</span></div>` : "";
  const taskLogView = (desktopJob || componentJob) ? ensureSftpTaskLogViewState(job.id) : null;
  const taskLog = taskLogView && job.logs?.length ? `<details class="global-task-log" data-task-id="${escAttr(job.id)}" ${taskLogView.expanded ? "open" : ""}><summary>查看日志</summary><pre>${esc(job.logs.slice(-80).map(item => `[${new Date(item.at || Date.now()).toLocaleTimeString()}] ${item.text || ""}`).join("\n"))}</pre></details>` : "";
  return `<div class="sftp-job ${escAttr(job.status)}"><div><strong>${esc(job.label || job.type)}</strong><span>${esc(job.connection_name || "")} · ${esc(detail)}${job.progress_unit === "percent" ? "" : job.current ? ` · ${esc(job.current)}` : ""}${finishedAt ? ` · ${finishedAt}` : ""}</span>${deliveryText}${progressBar}${taskLog}${deliveryError}${job.error ? `<div class="sftp-job-error"><strong>失败原因</strong><span>${esc(job.error).slice(0,500)}</span></div>` : ""}</div><div class="actions tight">${downloadAction}${resumeBtn}${pauseBtn}${retrySyncBtn}${exportSyncBtn}${desktopOpenBtn}${cancelBtn}${deleteBtn}</div></div>`;
}

function closeSftpRecycleBin() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
  sftpRecycleBinConnectionId = 0;
}

function sftpRecycleItemHtml(connectionId, item) {
  const deletedAt = item.deleted_at ? new Date(item.deleted_at).toLocaleString() : "时间未知";
  const storage = item.storage === "tunneldesk" ? "tunneldesk" : "terma";
  const legacy = storage === "tunneldesk" ? " · 旧版数据" : "";
  return `<div class="sftp-recycle-item"><span class="sftp-recycle-icon ${escAttr(item.type)}">${icon(item.type === "dir" ? "folder" : "file")}</span><div><strong title="${escAttr(item.original_path)}">${esc(item.name || item.original_path)}</strong><span>${esc(item.original_path)}</span><small>删除于 ${esc(deletedAt)}${legacy}</small></div><div class="actions tight"><button type="button" onclick="restoreSftpRecycleItem(${connectionId},'${escAttr(item.id)}','${storage}')">${icon("undo-2")}<span>恢复</span></button><button class="danger" type="button" onclick="deleteSftpRecycleItem(${connectionId},'${escAttr(item.id)}','${escAttr(item.name || item.original_path)}','${storage}')">${icon("trash-2")}<span>永久删除</span></button></div></div>`;
}

async function openSftpRecycleBin(tabKey=activeTabKey, connectionIdOverride=0) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const connectionId = Number(connectionIdOverride || tab?.id || runtime?.state.connectionId || sftpRecycleBinConnectionId);
  if (!connectionId) return;
  sftpRecycleBinConnectionId = connectionId;
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card wide sftp-recycle-modal" role="dialog" aria-modal="true" aria-labelledby="sftpRecycleTitle"><div class="sftp-modal-head"><div><h2 id="sftpRecycleTitle">SFTP 回收站</h2><span id="sftpRecycleSummary">正在读取远端回收站</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeSftpRecycleBin()">${icon("x")}</button></div><div id="sftpRecycleList" class="sftp-recycle-list">${stateView("loading", "正在读取回收站")}</div><div class="actions"><button id="sftpRecycleClear" class="danger" type="button" hidden onclick="clearSftpRecycleBin(${connectionId})">${icon("trash-2")}<span>清空回收站</span></button><button type="button" onclick="closeSftpRecycleBin()">关闭</button></div></div>`;
  modal.hidden = false;
  try {
    const data = await api(`/api/connections/${connectionId}/sftp/trash`);
    if (sftpRecycleBinConnectionId !== connectionId || !$("sftpRecycleList")) return;
    const items = data.items || [];
    $("sftpRecycleSummary").textContent = `${data.enabled ? "已开启" : "当前关闭"} · ${items.length} 个项目`;
    $("sftpRecycleList").innerHTML = items.length
      ? items.map(item => sftpRecycleItemHtml(connectionId, item)).join("")
      : stateView("empty", "回收站为空", data.enabled ? "删除的远程项目会保存在这里。" : "可在 SFTP 页面右上角的全局设置中开启回收站。");
    $("sftpRecycleClear").hidden = !items.length;
  } catch (error) {
    if ($("sftpRecycleList")) $("sftpRecycleList").innerHTML = stateView("error", "回收站读取失败", error.message, `<button onclick="openSftpRecycleBin('${escAttr(tabKey)}')">重试</button>`);
  }
}

async function restoreSftpRecycleItem(connectionId, id, storage="terma") {
  try {
    const result = await api(`/api/connections/${connectionId}/sftp/trash/restore`, {method:"POST", body:JSON.stringify({id, storage})});
    notify(`已恢复：${result.original_path || "远程项目"}`, "success");
    queueSftpDirectoryRefresh(connectionId);
    flushPendingSftpDirectoryRefresh();
  } catch (error) {
    notify(error.message || "恢复失败", "error");
  }
  openSftpRecycleBin("", connectionId);
}

async function deleteSftpRecycleItem(connectionId, id, name, storage="terma") {
  if (!await confirmModal(`永久删除回收站中的项目且无法恢复？\n${name}`, "永久删除", "永久删除", "取消", true)) return openSftpRecycleBin("", connectionId);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/delete`, {method:"POST", body:JSON.stringify({id, storage})});
    notify("回收站项目已永久删除", "success");
  } catch (error) {
    notify(error.message || "永久删除失败", "error");
  }
  openSftpRecycleBin("", connectionId);
}

async function clearSftpRecycleBin(connectionId) {
  if (!await confirmModal("永久删除当前服务器回收站内的全部项目？此操作无法撤销。", "清空 SFTP 回收站", "全部永久删除", "取消", true)) return openSftpRecycleBin("", connectionId);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/clear`, {method:"POST", body:"{}"});
    notify("SFTP 回收站已清空", "success");
  } catch (error) {
    notify(error.message || "清空回收站失败", "error");
  }
  openSftpRecycleBin("", connectionId);
}

function sftpJobStatus(status, phase="") {
  if (status === "running" && phase === "receiving") return "正在准备上传";
  if (status === "running" && phase === "uploading") return "正在上传到远端";
  if (status === "running" && phase === "committing") return "正在完成";
  if (status === "running" && phase === "system-saving") return "正在保存到本机";
  if (status === "running" && phase === "local-saving") return "正在下载到本机";
  if (status === "running" && phase === "cancelling") return "正在停止";
  if (status === "pending" && phase === "resuming") return "正在继续";
  return {pending:"准备中", running:"执行中", done:"完成", failed:"失败", cancelled:"已取消", paused:"已暂停"}[status] || status;
}

async function cancelSftpJob(id, button=null) {
  const key = String(id || "");
  const actionKey = `sftp-task:cancel:${key}`;
  if (!beginUiAction(actionKey, button, "停止中...")) return null;
  const upload = sftpUploadRequests.get(key);
  if (upload) upload.cancelled = true;
  try {
    if (key.startsWith("sync:")) {
      await api(`/api/sftp/sync/jobs/${encodeURIComponent(key.slice(5))}/cancel`, {method:"POST"});
      await refreshSftpJobs();
      return;
    }
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/cancel`, {method:"POST"});
    if (result?.ok === false) notify(result.message || "停止请求未被接受，任务仍在继续", "info");
    await refreshSftpJobs();
  } finally {
    try { upload?.xhr?.abort(); } catch {}
    endUiAction(actionKey, button);
  }
}

async function pauseSftpJob(id, button=null) {
  const actionKey = `sftp-task:pause:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, "暂停中...")) return null;
  try {
    await api(`/api/sftp/jobs/${encodeURIComponent(id)}/pause`, {method:"POST"});
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || "暂停任务失败", "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function resumeSftpJob(id, button=null) {
  const actionKey = `sftp-task:resume:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, "处理中...")) return null;
  try {
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/resume`, {method:"POST"});
    if (result && result.error) return notify(result.error, "error");
    notify("SFTP 任务已重新开始", "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || "重试任务失败", "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function deleteSftpJob(id, button=null) {
  const key = String(id || "");
  const actionKey = `sftp-task:delete:${key}`;
  if (!beginUiAction(actionKey, button, "删除中...")) return null;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const centerButton = document.getElementById("sftpTaskCenterButton");
  const keepOpen = Boolean(drawer && !drawer.hidden);
  try {
    if (!await confirmModal("删除该任务记录？","删除任务","删除","取消", true)) return null;
    if (key.startsWith("desktop:")) {
      await api(`/api/linux-desktop/tasks/${encodeURIComponent(key.slice(8))}`, {method:"DELETE"});
    } else if (key.startsWith("component:")) {
      await api(`/api/remote-component/tasks/${encodeURIComponent(key.slice(10))}`, {method:"DELETE"});
    } else if (key.startsWith("sync:")) {
      await api(`/api/sftp/sync/jobs/${encodeURIComponent(key.slice(5))}`, {method:"DELETE"});
    } else {
      await api(`/api/sftp/jobs/${encodeURIComponent(id)}`, {method:"DELETE"});
    }
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || "删除任务失败", "error");
  } finally {
    endUiAction(actionKey, button);
    if (keepOpen && drawer) {
      drawer.hidden = false;
      centerButton?.setAttribute("aria-expanded", "true");
      renderSftpTaskCenterDrawer();
    }
  }
}

function saveSftpJobFile(id) {
  const a = document.createElement("a");
  a.href = `/api/sftp/jobs/${encodeURIComponent(id)}/fetch`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
  setTimeout(() => refreshSftpJobs(), 1500);
}

async function extractSingleSftp(id, path, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const job = await api(`/api/connections/${id}/sftp/extract`, {method:"POST", body:JSON.stringify({path, target:runtime?.state.path || ".", background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function compressSingleSftp(id, path, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const name = await inputModal("压缩远程项目", "压缩包名称（自动使用 tar.gz）", `${sftpPathName(path)}.tar.gz`);
  if (!name) return;
  try {
    const job = await api(`/api/connections/${id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:[path], target:runtime?.state.path || ".", filename:name})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "压缩任务创建失败", "error");
  }
}

function openSftpActionSheet(tabKey=activeTabKey) {
  const actions = [
    { label: "复制选中", value: "copy" },
    { label: "移动选中", value: "move" },
    ...(sftpClipboardMatchesConnection(tabKey) ? [{ label: "粘贴到当前目录", value: "paste" }] : []),
    ...(sftpClipboard?.paths?.length ? [{ label: "取消复制/移动队列", value: "cancelClipboard" }] : []),
    { label: "下载选中", value: "download" },
    { label: "压缩选中", value: "compress" },
    { label: "设置权限", value: "permissions" },
    { label: "解压选中压缩包", value: "extract" },
    { label: "删除选中", value: "delete", className: "danger" },
    { label: "取消", value: "" }
  ];
  chooseModal("SFTP 操作", "选择要执行的文件操作。", actions).then(value => {
    if (value === "copy" || value === "move") copySftpSelection(value, tabKey);
    if (value === "paste") pasteSftpClipboard(tabKey);
    if (value === "cancelClipboard") cancelSftpClipboard();
    if (value === "download") downloadSftpSelection(tabKey);
    if (value === "compress") compressSftpSelection(tabKey);
    if (value === "permissions") openSftpPermissionsForSelection(null, tabKey);
    if (value === "extract") extractSftpSelection(tabKey);
    if (value === "delete") deleteSftpSelection(tabKey);
  });
}

async function clearFinishedSftpJobs(button=null) {
  const actionKey = "sftp-task:clear-history";
  if (!beginUiAction(actionKey, button, "清理中...")) return null;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const centerButton = document.getElementById("sftpTaskCenterButton");
  const keepOpen = Boolean(drawer && !drawer.hidden);
  try {
    if (!await confirmModal("清空全部已完成和已取消的任务记录？失败记录会保留。", "清空任务历史", "清空历史", "取消", true)) return null;
    const result = await api("/api/sftp/jobs/clear-finished", {method:"POST"});
    const syncResult = window.termaDesktop ? await api("/api/sftp/sync/jobs/clear-finished", {method:"POST"}).catch(() => ({removed:0})) : {removed:0};
    const desktopResult = await api("/api/linux-desktop/tasks/clear-finished", {method:"POST"}).catch(() => ({removed:0}));
    const componentResult = await api("/api/remote-component/tasks/clear-finished", {method:"POST"}).catch(() => ({removed:0}));
    notify(`已清理 ${Number(result.removed || 0) + Number(syncResult.removed || 0) + Number(desktopResult.removed || 0) + Number(componentResult.removed || 0)} 条历史任务`, "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || "清空任务历史失败", "error");
  } finally {
    endUiAction(actionKey, button);
    if (keepOpen && drawer) {
      drawer.hidden = false;
      centerButton?.setAttribute("aria-expanded", "true");
      renderSftpTaskCenterDrawer();
    }
  }
}

async function retrySftpSyncJob(id, button=null) {
  const actionKey = `sftp-task:sync-retry:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, "重试中...")) return null;
  try {
    const job = await api(`/api/sftp/sync/jobs/${encodeURIComponent(id)}/retry`, {method:"POST", body:"{}"});
    notify(`已重试 ${job.total || 0} 个失败项目`, "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || "同步任务重试失败", "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function exportSftpSyncResult(id, button=null) {
  const actionKey = `sftp-task:sync-export:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, "导出中...")) return null;
  try {
    const job = await api(`/api/sftp/sync/jobs/${encodeURIComponent(id)}`);
    const blob = new Blob([JSON.stringify(job, null, 2)], {type:"application/json"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `terma-sync-${id}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  } catch (error) {
    notify(error.message || "导出同步结果失败", "error");
  } finally {
    endUiAction(actionKey, button);
  }
}
