const sftpTaskLogViewStates = new Map();
const SFTP_TASK_CENTER_MIN_WIDTH = 340;
const SFTP_TASK_CENTER_MIN_HEIGHT = 240;
const SFTP_TASK_CENTER_VIEWPORT_GAP = 12;
const SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1";
let sftpTaskCenterResize = null;
let sftpBackgroundRefreshInFlight = false;
let sftpBackgroundVisibilityBound = false;
let sftpLastJobsPollAt = 0;
let sftpLastActiveSessionStatusPollAt = 0;
let sftpLastAllSessionStatusPollAt = 0;
let sftpJobsRefreshPromise = null;
let sftpJobsRefreshTrailing = false;
let sftpDirectoryRefreshTimer = 0;
let sftpDirectoryRefreshActive = false;
let sftpPreferredDirectoryRefreshKey = "";

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

function startSftpTaskCenterResize(event, handle=event.currentTarget) {
  if (event.button !== 0 || isMobileLayout()) return;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (!drawer || drawer.hidden) return;
  if (sftpTaskCenterResize) finishSftpTaskCenterResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  const rect = drawer.getBoundingClientRect();
  sftpTaskCenterResize = {
    drawer,
    handle,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    startWidth:rect.width,
    startHeight:rect.height
  };
  try { handle?.setPointerCapture?.(event.pointerId); } catch {}
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
  const schedule = delay => {
    clearTimeout(sftpJobsTimer);
    sftpJobsTimer = setTimeout(run, Math.max(0, Number(delay || 0)));
  };
  const run = async () => {
    if (sftpBackgroundRefreshInFlight) return schedule(1000);
    sftpBackgroundRefreshInFlight = true;
    let nextDelay = 10000;
    try {
      const now = Date.now();
      const drawer = document.getElementById("sftpTaskCenterDrawer");
      const hasActiveJobs = sftpLatestJobs.some(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status));
      const drawerOpen = Boolean(drawer && !drawer.hidden);
      const vncRendering = typeof hasActiveEmbeddedVncRendering === "function" && hasActiveEmbeddedVncRendering();
      const activeSftpTab = !document.hidden && tabs.find(tab => tab.key === activeTabKey && tab.kind === "sftp");
      const jobsInterval = hasActiveJobs ? 2000 : drawerOpen ? 3000 : vncRendering ? 15000 : 10000;
      const activeSessionInterval = typeof runtimeConfiguredBackgroundIntervalMs === "function"
        ? runtimeConfiguredBackgroundIntervalMs("sftp_active_status_poll_interval_ms", 5000)
        : 5000;
      const allSessionsInterval = typeof runtimeConfiguredBackgroundIntervalMs === "function"
        ? runtimeConfiguredBackgroundIntervalMs("sftp_background_status_poll_interval_ms", 15000)
        : 15000;
      nextDelay = document.hidden ? 30000 : Math.min(jobsInterval, activeSftpTab ? activeSessionInterval : allSessionsInterval);
      const tasks = [];
      if (!document.hidden && now - sftpLastJobsPollAt >= jobsInterval) {
        tasks.push(Promise.resolve(refreshSftpJobsIfStale(jobsInterval)).catch(() => {}));
      }
      const allSessionsDue = !document.hidden && now - sftpLastAllSessionStatusPollAt >= allSessionsInterval;
      const activeSessionDue = activeSftpTab && now - sftpLastActiveSessionStatusPollAt >= activeSessionInterval;
      if (allSessionsDue) {
        sftpLastAllSessionStatusPollAt = now;
        if (activeSftpTab) sftpLastActiveSessionStatusPollAt = now;
        tasks.push(Promise.resolve(refreshActiveSftpSessionStatus()).catch(() => {}));
      } else if (activeSessionDue) {
        sftpLastActiveSessionStatusPollAt = now;
        tasks.push(Promise.resolve(refreshActiveSftpSessionStatus(activeSftpTab.key)).catch(() => {}));
      }
      if (tasks.length) await Promise.allSettled(tasks);
    } finally {
      sftpBackgroundRefreshInFlight = false;
      schedule(nextDelay);
    }
  };
  if (!sftpBackgroundVisibilityBound) {
    sftpBackgroundVisibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        sftpLastJobsPollAt = 0;
        sftpLastActiveSessionStatusPollAt = 0;
        sftpLastAllSessionStatusPollAt = 0;
        schedule(0);
      }
    });
  }
  schedule(3000);
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

function localizedSftpJobText(value) {
  const source = String(value || "");
  return typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(source) : source;
}

function localizedSftpTaskMessage(message, code="", params={}) {
  const source = String(message || "");
  const normalizedCode = typeof normalizeBackendPublicErrorCode === "function"
    ? normalizeBackendPublicErrorCode(code)
    : String(code || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const safeParams = typeof backendPublicErrorParams === "function" ? backendPublicErrorParams(params) : {};
  const language = typeof normalizeTermaLanguage === "function"
    ? normalizeTermaLanguage(document.documentElement.lang || window.i18next?.resolvedLanguage || "zh-CN")
    : String(document.documentElement.lang || "zh-CN");
  const key = normalizedCode ? `tasks:job_issues.${normalizedCode}` : "";
  if (key && window.i18next?.exists?.(key, {lng:language, fallbackLng:false})) {
    return tr(key, {...safeParams, lng:language, fallbackLng:false, defaultValue:""});
  }
  if (normalizedCode && language === "en-US") {
    return tr("tasks:job_issues.unknown", {lng:"en-US", fallbackLng:false, defaultValue:"The task could not be completed."});
  }
  if (!source) return "";
  return typeof rememberTermaRawUiPhrase === "function" ? rememberTermaRawUiPhrase(source) : source;
}

function localizedSftpJobIssue(job, field) {
  return localizedSftpTaskMessage(
    job?.[field],
    job?.[`${field}_code`],
    job?.[`${field}_params`]
  );
}

function sftpTaskInlineArgument(value) {
  return `'${escAttr(String(value ?? ""))}'`;
}

function sftpJobDisplayLabel(job={}) {
  if (job.label_i18n === true) return String(job.label || job.type || "");
  const source = String(job.label || job.type || "");
  const pathName = value => String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  if (job.type === "download") {
    if (job.archive_download) {
      const count = Array.isArray(job.remote_paths) ? job.remote_paths.length : Number(job.item_count || 0);
      return tr("sftp:task_ui.archive_download", {count, defaultValue:`打包下载 ${count} 项`});
    }
    if (source === "批量下载到本机") return tr("sftp:task_ui.batch_download_local", {defaultValue:"批量下载到本机"});
    const name = pathName(job.remote_path) || source.match(/^下载\s+(.+)$/)?.[1] || "";
    return name ? tr("sftp:task_ui.download_file", {name, defaultValue:`下载 ${name}`}) : localizedSftpJobText(source);
  }
  if (job.type === "upload") {
    const name = pathName(job.remote_path || job.local_path) || source.match(/^上传\s+(.+)$/)?.[1] || "";
    return name ? tr("sftp:task_ui.upload_file", {name, defaultValue:`上传 ${name}`}) : localizedSftpJobText(source);
  }
  if (job.type === "delete") {
    const count = Math.max(1, Number(job.item_count || job.size || 1));
    const action = tr(job.recycled ? "sftp:operations.recycle_confirm" : "sftp:menu.delete", {defaultValue:job.recycled ? "移入回收站" : "删除"});
    const name = count === 1 ? source.match(/^(?:移入回收站|删除)\s+(.+)$/)?.[1] || "" : "";
    if (count === 1 && !name) return localizedSftpJobText(source);
    return name
      ? tr("sftp:task_ui.item_action", {action, name, defaultValue:`${action} ${name}`})
      : tr("sftp:task_ui.items_action", {action, count, defaultValue:`${action} ${count} 项`});
  }
  if (job.type === "cross-copy") {
    const count = Math.max(0, Number(job.source_paths?.length || job.item_count || job.size || 0));
    return job.source_connection_name
      ? tr("sftp:task_ui.copy_from_connection", {name:job.source_connection_name, count, defaultValue:`从 ${job.source_connection_name} 复制 ${count} 项`})
      : tr("sftp:task_ui.copy_items", {count, defaultValue:`复制 ${count} 项`});
  }
  return localizedSftpJobText(source);
}

function sftpJobProgressLabel(job, progress) {
  if (!progress) return "";
  return job?.progress_estimated
    ? tr("tasks:auto.estimated_percent", {percent:Math.round(progress.percent), defaultValue:`约 ${Math.round(progress.percent)}%`})
    : `${Math.round(progress.percent)}%`;
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
    ? localizedSftpJobText(job.current)
    : job.progress_unit === "items" && size
      ? tr("tasks:auto.processed_items", {count:size, completed:Math.min(size, transferred), total:size, defaultValue:`已处理 ${Math.min(size, transferred)} / ${size} 项`})
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
    tr("sftp:task_ui.mute_message", {defaultValue:"静默后将永久关闭此类悬浮进度卡。后台任务仍会继续，也可以通过标题栏任务中心查看；需要恢复时，请前往通知设置重新开启。"}),
    tr("sftp:task_ui.mute_title", {defaultValue:"静默悬浮进度卡"}),
    tr("sftp:task_ui.mute_confirm", {defaultValue:"永久静默"}),
    tr("common:actions.cancel", {defaultValue:"取消"})
  );
  if (!accepted) return;
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({sftp_floating_progress_enabled:false})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    updateSftpTaskFloat(sftpLatestJobs);
    notify(tr("sftp:task_ui.muted", {defaultValue:"悬浮进度卡已静默，可在通知设置中重新开启"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.mute_failed", {defaultValue:"静默悬浮进度卡失败"}), "error");
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
  const title = active.length === 1
    ? sftpJobDisplayLabel(active[0]) || tr("sftp:task_ui.background_task", {defaultValue:"后台任务"})
    : tr("sftp:task_ui.background_tasks", {count:active.length, defaultValue:`${active.length} 个后台任务`});
  const detail = active.length === 1
    ? sftpFloatingJobDetail(active[0])
    : [
        active.some(job => job.status === "running") ? tr("sftp:task_ui.running_items", {count:active.filter(job => job.status === "running").length, defaultValue:`${active.filter(job => job.status === "running").length} 项执行中`}) : "",
        active.some(job => job.status === "pending") ? tr("sftp:task_ui.pending_items", {count:active.filter(job => job.status === "pending").length, defaultValue:`${active.filter(job => job.status === "pending").length} 项准备中`}) : "",
        active.some(job => job.status === "paused") ? tr("sftp:task_ui.paused_items", {count:active.filter(job => job.status === "paused").length, defaultValue:`${active.filter(job => job.status === "paused").length} 项已暂停`}) : "",
        totalSpeed ? `${formatBytes(totalSpeed)}/s` : "",
        determinate ? (active.some(job => job.progress_estimated) ? tr("tasks:auto.estimated_percent", {percent:Math.round(percent), defaultValue:`约 ${Math.round(percent)}%`}) : `${Math.round(percent)}%`) : ""
      ].filter(Boolean).join(" · ");
  const singleJob = active.length === 1 ? active[0] : null;
  const singleCancelable = Boolean(singleJob
    && singleJob.can_cancel !== false
    && !(singleJob.type === "upload" && singleJob.phase === "committing"));
  const singlePausable = Boolean(singleJob
    && singleJob.status === "running"
    && singleJob.resume_supported === true
    && singleJob.can_pause !== false);
  const singleResumable = Boolean(singleJob
    && singleJob.status === "paused"
    && singleJob.can_resume);
  if (!box.querySelector(".sftp-task-float-head")) {
    const openText = tr("tasks:actions.open_center", {defaultValue:"打开任务中心"});
    const stopText = tr("tasks:actions.stop", {defaultValue:"停止任务"});
    const closeText = tr("tasks:actions.close_floating", {defaultValue:"关闭当前悬浮进度"});
    const muteText = tr("tasks:actions.mute_floating", {defaultValue:"静默悬浮进度卡"});
    const progressText = tr("tasks:actions.progress", {defaultValue:"任务进度"});
    box.innerHTML = `<div class="sftp-task-float-head"><button type="button" class="sftp-task-float-open" title="${escAttr(openText)}"><span class="sftp-task-float-icon"></span><span class="sftp-task-float-copy"><strong class="sftp-task-float-title"></strong><span class="sftp-task-float-detail"></span></span></button><span class="sftp-task-float-actions"><button type="button" class="icon-button sftp-task-float-pause" onclick="event.stopPropagation();toggleSftpTaskFloatJob(this)" hidden></button><button type="button" class="icon-button sftp-task-float-cancel" onclick="event.stopPropagation();cancelSftpJob(this.dataset.jobId)" title="${escAttr(stopText)}" aria-label="${escAttr(stopText)}" hidden>${icon("square")}</button><button type="button" class="icon-button sftp-task-float-close" onclick="event.stopPropagation();dismissSftpTaskFloat()" title="${escAttr(closeText)}" aria-label="${escAttr(closeText)}">${icon("x")}</button><button type="button" class="icon-button sftp-task-float-mute" onclick="event.stopPropagation();muteSftpTaskFloat()" title="${escAttr(muteText)}" aria-label="${escAttr(muteText)}">${icon("bell-off")}</button></span></div><div class="progress" role="progressbar" aria-label="${escAttr(progressText)}"><i></i></div>`;
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
  const pauseButton = box.querySelector(".sftp-task-float-pause");
  if (pauseButton) {
    const action = singlePausable ? "pause" : singleResumable ? "resume" : "";
    pauseButton.hidden = !action;
    pauseButton.dataset.action = action;
    pauseButton.dataset.jobId = action ? String(singleJob?.id || "") : "";
    pauseButton.title = action === "pause" ? tr("tasks:actions.pause", {defaultValue:"暂停"}) : tr("tasks:actions.resume", {defaultValue:"继续"});
    pauseButton.setAttribute("aria-label", pauseButton.title);
    if (action && pauseButton.dataset.icon !== action) {
      pauseButton.innerHTML = icon(action === "pause" ? "pause" : "play");
      pauseButton.dataset.icon = action;
    }
  }
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
function sftpTaskCenterRenderSignature(visible, view) {
  const language = String(document.documentElement.lang || "zh-CN");
  return JSON.stringify([language, view, visible.map(job => ({
    id:job.id,
    raw_sync_id:job.raw_sync_id,
    raw_desktop_id:job.raw_desktop_id,
    type:job.type,
    label:job.label,
    label_key:job.label_key,
    label_params:job.label_params,
    connection_id:job.connection_id,
    connection_name:job.connection_name,
    status:job.status,
    phase:job.phase,
    current:job.current,
    current_key:job.current_key,
    current_params:job.current_params,
    size:job.size,
    transferred:job.transferred,
    progress:job.progress,
    progress_unit:job.progress_unit,
    progress_known:job.progress_known,
    speed_bps:job.speed_bps,
    average_bps:job.average_bps,
    can_cancel:job.can_cancel,
    can_pause:job.can_pause,
    can_resume:job.can_resume,
    resume_supported:job.resume_supported,
    delivery_status:job.delivery_status,
    saved_path:job.saved_path,
    delivery_error:job.delivery_error,
    warning:job.warning,
    error:job.error,
    finished_at:job.finished_at,
    logs:Array.isArray(job.logs) ? job.logs.slice(-80) : []
  }))]);
}
function renderSftpTaskCenterDrawer(jobs=sftpLatestJobs) {
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const list = document.getElementById("sftpTaskCenterList");
  if (!drawer || !list || drawer.hidden) return;
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
  const renderSignature = sftpTaskCenterRenderSignature(visible, sftpTaskCenterView);
  if (list._sftpTaskCenterRenderSignature !== renderSignature) {
    const nextMarkup = visible.length
      ? visible.map(renderSftpJob).join("")
      : `<div class="sftp-task-empty">${esc(tr(showingHistory ? "tasks:auto.empty_history" : showingFailed ? "tasks:auto.empty_failed" : "tasks:auto.empty_current", {defaultValue:showingHistory ? "暂无已完成或已取消的任务" : showingFailed ? "暂无失败的任务" : "暂无进行中的任务"}))}</div>`;
    captureSftpTaskLogViewStates(list);
    list.innerHTML = nextMarkup;
    list._sftpTaskCenterRenderSignature = renderSignature;
    bindSftpTaskLogViewStates(list);
  }
  list.setAttribute("aria-labelledby", showingHistory ? "sftpTaskCenterHistoryTab" : showingFailed ? "sftpTaskCenterFailedTab" : "sftpTaskCenterCurrentTab");
  const summary = document.getElementById("sftpTaskCenterSummary");
  if (summary) summary.textContent = [
    activeCount ? tr("tasks:auto.running_count", {count:activeCount, defaultValue:`${activeCount} 项进行中`}) : "",
    failedCount ? tr("tasks:auto.failed_count", {count:failedCount, defaultValue:`${failedCount} 项失败`}) : "",
    !activeCount && !failedCount ? tr("tasks:auto.empty_current", {defaultValue:"暂无进行中的任务"}) : ""
  ].filter(Boolean).join(" · ");
  const footer = document.getElementById("sftpTaskCenterFooter");
  if (footer) footer.hidden = !((showingHistory && history.length) || (showingFailed && failed.length));
  const clearLabel = document.getElementById("sftpTaskCenterClearLabel");
  if (clearLabel) clearLabel.textContent = tr(showingFailed ? "tasks:dialogs.clear_failed_action" : "tasks:dialogs.clear_history_action", {defaultValue:showingFailed ? "清空失败" : "清空历史"});
  const clearButton = document.getElementById("sftpTaskCenterClearButton");
  if (clearButton) {
    clearButton.title = tr(showingFailed ? "tasks:auto.delete_all_failed" : "tasks:auto.delete_all_history", {defaultValue:showingFailed ? "删除全部失败任务记录" : "删除全部历史任务记录"});
    clearButton.setAttribute("aria-label", clearButton.title);
  }
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
  const description = [
    activeCount ? tr("tasks:auto.running_count", {count:activeCount, defaultValue:`${activeCount} 项进行中`}) : "",
    failedCount ? tr("tasks:auto.failed_count", {count:failedCount, defaultValue:`${failedCount} 项失败`}) : ""
  ].filter(Boolean).join(tr("tasks:auto.summary_separator", {defaultValue:"，"}));
  button.title = description
    ? tr("tasks:auto.center_summary", {summary:description, defaultValue:`任务中心：${description}`})
    : tr("tasks:title", {defaultValue:"任务中心"});
  button.setAttribute("aria-label", button.title);
  if (progressBar) {
    const progress = sftpTaskCenterProgress(jobs);
    const determinate = Boolean(progress?.determinate);
    progressBar.hidden = !progress;
    progressBar.classList.toggle("is-indeterminate", Boolean(progress) && !determinate);
    const fill = progressBar.querySelector("i");
    if (fill) fill.style.width = `${Math.round(progress?.percent || 0)}%`;
    if (progress) {
      progressBar.setAttribute("aria-valuetext", determinate ? `${Math.round(progress.percent)}%` : tr("sftp:task_ui.calculating_progress", {defaultValue:"正在计算任务进度"}));
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

function settleSftpJobFromNotification(event) {
  const jobId = String(event?.action?.sftp_job_id || event?.action?.download_job_id || "");
  if (!jobId) return false;
  const job = sftpLatestJobs.find(item => String(item?.id || "") === jobId);
  if (!job || !SFTP_ACTIVE_JOB_STATUSES.has(job.status)) return false;
  const failed = event?.level === "error";
  job.status = failed ? "failed" : "done";
  job.phase = "";
  job.finished_at = job.finished_at || Date.now();
  job.can_pause = false;
  job.can_cancel = false;
  if (!failed) {
    job.progress = 100;
    if (Number(job.size || 0) > 0) job.transferred = Number(job.size || 0);
  }
  // The notification can arrive before the next authoritative task poll.
  // Queue the directory refresh here as well; otherwise recording the final
  // status below makes the later status-diff pass believe nothing changed.
  const connectionId = Number(job.connection_id || event?.action?.connection_id || 0);
  if (connectionId && SFTP_MUTATING_JOB_TYPES.has(String(job.type || ""))) {
    queueSftpDirectoryRefresh(connectionId);
    flushPendingSftpDirectoryRefresh();
  }
  sftpKnownJobStatuses.set(jobId, job.status);
  updateSftpTaskCenter(sftpLatestJobs);
  return true;
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
  if (!sftpPendingDirectoryRefreshes.size) return;
  const preferredKey = String(tabKey || "");
  if (preferredKey && sftpPendingDirectoryRefreshes.has(preferredKey)) {
    sftpPreferredDirectoryRefreshKey = preferredKey;
  }
  if (sftpDirectoryRefreshActive || sftpDirectoryRefreshTimer) return;
  sftpDirectoryRefreshTimer = setTimeout(runPendingSftpDirectoryRefresh, 0);
}

async function runPendingSftpDirectoryRefresh() {
  sftpDirectoryRefreshTimer = 0;
  if (sftpDirectoryRefreshActive) return;
  let selectedKey = "";
  const preferredKey = sftpPreferredDirectoryRefreshKey;
  sftpPreferredDirectoryRefreshKey = "";
  const keys = preferredKey
    ? [preferredKey, ...[...sftpPendingDirectoryRefreshes].filter(key => key !== preferredKey)]
    : [...sftpPendingDirectoryRefreshes];
  for (const key of keys) {
    if (!sftpPendingDirectoryRefreshes.has(key)) continue;
    const runtime = sftpTabRuntimes.get(key);
    if (!runtime) {
      sftpPendingDirectoryRefreshes.delete(key);
      continue;
    }
    if (runtime.state.loading || !sftpRuntimeRoot(key)?.isConnected) continue;
    selectedKey = key;
    break;
  }
  if (!selectedKey) return;
  sftpPendingDirectoryRefreshes.delete(selectedKey);
  sftpDirectoryRefreshActive = true;
  try {
    await refreshSftp({tabKey:selectedKey});
  } finally {
    sftpDirectoryRefreshActive = false;
    if (sftpPendingDirectoryRefreshes.size) flushPendingSftpDirectoryRefresh();
  }
}

function refreshSftpJobsIfStale(maxAge=2000) {
  if (sftpJobsRefreshPromise) return sftpJobsRefreshPromise;
  const age = Date.now() - Number(sftpLastJobsPollAt || 0);
  if (age >= 0 && age < Math.max(0, Number(maxAge || 0))) return Promise.resolve(sftpLatestJobs);
  return refreshSftpJobs();
}

async function performSftpJobsRefresh() {
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
    label:job.type === "sync-scan"
      ? tr("sftp:task_ui.directory_compare", {defaultValue:"目录比较"})
      : tr("sftp:task_ui.directory_sync", {defaultValue:"目录同步"}),
    label_i18n:true,
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
  })), ...desktopJobs.map(task => {
    const component = task.desktop_label || tr("sftp:task_ui.linux_desktop", {defaultValue:"Linux 桌面"});
    const action = task.action === "uninstall"
      ? tr("sftp:task_ui.uninstall", {defaultValue:"卸载"})
      : tr("sftp:task_ui.install", {defaultValue:"安装"});
    const stages = {
      prepare:tr("sftp:task_ui.stage_prepare", {defaultValue:"正在准备"}),
      packages:tr("sftp:task_ui.stage_packages", {defaultValue:"正在处理软件包"}),
      refresh:tr("sftp:task_ui.stage_refresh", {defaultValue:"正在刷新会话"}),
      verify:tr("sftp:task_ui.stage_verify", {defaultValue:"正在验证结果"}),
      done:tr("tasks:status.done", {defaultValue:"已完成"})
    };
    return ({
    id:`desktop:${task.id}`,
    raw_desktop_id:task.id,
    type:"linux-desktop",
    label:tr("sftp:task_ui.component_action", {component, action, defaultValue:`${component}${action}`}),
    label_i18n:true,
    connection_id:Number(task.connection_id || 0),
    connection_name:task.connection_name || "",
    status:task.status,
    phase:task.stage || "prepare",
    current:stages[task.stage] || task.stage || "",
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
  });
  }), ...componentJobs.map(task => {
    const component = task.component_label || tr("sftp:task_ui.remote_component", {defaultValue:"远端组件"});
    const action = task.action_label
      ? localizedSftpJobText(task.action_label)
      : tr("sftp:task_ui.offline_install", {defaultValue:"离线安装"});
    return ({
    id:`component:${task.id}`,
    raw_component_id:task.id,
    type:"remote-component",
    label:tr("sftp:task_ui.component_action", {component, action, defaultValue:`${component}${action}`}),
    label_i18n:true,
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
  });
  })];
  if (requestSeq !== sftpJobsRequestSeq) return sftpLatestJobs;
  sftpLastJobsPollAt = Date.now();
  const readyBrowserDownload = jobs.find(job => job.status === "done"
    && job.type === "download"
    && sftpPendingBrowserDownloads.has(job.id));
  if (readyBrowserDownload) {
    sftpPendingBrowserDownloads.delete(readyBrowserDownload.id);
    saveSftpJobFile(readyBrowserDownload.id);
    notify(tr("sftp:task_ui.browser_saved", {defaultValue:"下载完成，已交给当前设备的浏览器保存"}), "success");
  }
  sftpLatestJobs = jobs;
  updateSftpTaskCenter(jobs);
  for (const connectionId of completedSftpMutationForCurrentView(jobs)) queueSftpDirectoryRefresh(connectionId);
  flushPendingSftpDirectoryRefresh();
  if (jobs.some(job => ["running", "pending", "paused"].includes(job.status))) startSftpJobsTimer();
  return jobs;
}

function refreshSftpJobs() {
  if (sftpJobsRefreshPromise) {
    sftpJobsRefreshTrailing = true;
    return sftpJobsRefreshPromise;
  }
  sftpJobsRefreshPromise = (async () => {
    let jobs = sftpLatestJobs;
    do {
      sftpJobsRefreshTrailing = false;
      jobs = await performSftpJobsRefresh();
      // Let callers that arrived while the four task endpoints were being
      // combined request one final fresh snapshot, without starting their own
      // parallel refreshes.
      await Promise.resolve();
    } while (sftpJobsRefreshTrailing);
    return jobs;
  })().finally(() => {
    sftpJobsRefreshPromise = null;
    sftpJobsRefreshTrailing = false;
  });
  return sftpJobsRefreshPromise;
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
    ? localizedSftpJobText(job.current)
    : job.progress_unit === "items" && job.size
      ? tr("tasks:auto.processed_items", {count:Number(job.size), completed:Math.min(Number(job.size), Number(job.transferred || 0)), total:Number(job.size), defaultValue:`已处理 ${Math.min(Number(job.size), Number(job.transferred || 0))} / ${Number(job.size)} 项`})
      : job.size
        ? `${formatBytes(job.transferred || 0)} / ${formatBytes(job.size)}`
        : formatBytes(job.transferred || 0);
  const detail = [sftpJobStatus(job.status, job.phase), amount, speed ? `${formatBytes(speed)}/s${running ? "" : tr("tasks:auto.average_suffix", {defaultValue:" 平均"})}` : "", sftpJobProgressLabel(job, progressInfo)].filter(Boolean).join(" · ");
  const progressBar = ["running", "pending", "paused", "done", "failed"].includes(job.status) && progressInfo ? `<div class="progress" aria-label="${Math.round(progress)}%"><i style="width:${progress}%"></i></div>` : "";
  const jobIdArg = sftpTaskInlineArgument(job.id);
  const rawSyncIdArg = sftpTaskInlineArgument(job.raw_sync_id);
  const rawDesktopIdArg = sftpTaskInlineArgument(job.raw_desktop_id);
  let downloadAction = "";
  if (done && job.type === "download" && job.delivery_status === "saved") {
    const openFile = tr("tasks:actions.open_file", {defaultValue:"打开文件"});
    const openDirectory = tr("tasks:actions.open_directory", {defaultValue:"打开目录"});
    downloadAction = `<button class="icon-button primary sftp-task-icon-action" type="button" title="${escAttr(openFile)}" aria-label="${escAttr(openFile)}" onclick="event.stopPropagation();openSftpDownloadedFile(${jobIdArg},this)">${icon("external-link")}</button><button class="icon-button sftp-task-icon-action" type="button" title="${escAttr(openDirectory)}" aria-label="${escAttr(openDirectory)}" onclick="event.stopPropagation();openSftpDownloadDirectory(this,${jobIdArg})">${icon("folder-open")}</button>`;
  } else if (done && job.type === "download" && ["delivered", "expired", "cache_cleared"].includes(job.delivery_status)) {
    downloadAction = `<button onclick="event.stopPropagation();retryCompletedSftpDownload(${jobIdArg},this)">${icon("download")}<span>${esc(tr("tasks:actions.download_again", {defaultValue:"再次下载"}))}</span></button>`;
  } else if (done && job.type === "download") {
    downloadAction = `<button class="primary" onclick="event.stopPropagation();saveSftpJobFile(${jobIdArg},this)">${icon("download")}<span>${esc(tr("tasks:actions.save_local", {defaultValue:"保存到本机"}))}</span></button>`;
  }
  const resumeBtn = resumable ? `<button class="${job.status === "failed" ? "primary" : ""}" onclick="event.stopPropagation();resumeSftpJob(${jobIdArg},this)">${esc(job.status === "failed" ? tr("tasks:actions.retry", {defaultValue:"重试"}) : tr("tasks:actions.resume", {defaultValue:"继续"}))}</button>` : "";
  const pauseBtn = running && job.resume_supported === true && job.can_pause !== false ? `<button onclick="event.stopPropagation();pauseSftpJob(${jobIdArg},this)">${esc(tr("tasks:actions.pause", {defaultValue:"暂停"}))}</button>` : "";
  const cancelBtn = cancelable ? `<button onclick="event.stopPropagation();cancelSftpJob(${jobIdArg},this)">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button>` : "";
  const retrySyncBtn = syncJob && job.status === "failed" && job.type === "sync" ? `<button class="primary" onclick="event.stopPropagation();retrySftpSyncJob(${rawSyncIdArg},this)">${esc(tr("tasks:actions.retry_failed", {defaultValue:"重试失败项"}))}</button>` : "";
  const exportSyncBtn = syncJob && ["failed", "done", "cancelled"].includes(job.status) ? `<button onclick="event.stopPropagation();exportSftpSyncResult(${rawSyncIdArg},this)">${icon("download")}<span>${esc(tr("tasks:actions.export_result", {defaultValue:"导出结果"}))}</span></button>` : "";
  const desktopOpenBtn = desktopJob ? `<button onclick="event.stopPropagation();openLinuxDesktopTask(${Number(job.connection_id)},${rawDesktopIdArg},this)">${icon("monitor-cog")}<span>${esc(tr("tasks:actions.view", {defaultValue:"查看"}))}</span></button>` : "";
  const deleteTask = tr("tasks:actions.delete", {defaultValue:"删除任务"});
  const deleteBtn = deletable ? `<button class="icon-button danger sftp-task-icon-action" type="button" title="${escAttr(deleteTask)}" aria-label="${escAttr(deleteTask)}" onclick="event.stopPropagation();deleteSftpJob(${jobIdArg},this)">${icon("trash-2")}</button>` : "";
  const finishedAt = job.finished_at ? `<time datetime="${escAttr(new Date(job.finished_at).toISOString())}">${esc(new Date(job.finished_at).toLocaleString())}</time>` : "";
  const deliveryText = job.saved_path ? `<span class="sftp-job-delivery" data-i18n-skip>${esc(tr("tasks:notifications.saved_to", {path:job.saved_path, defaultValue:`已保存到 ${job.saved_path}`}))}</span>` : "";
  const deliveryErrorText = localizedSftpJobIssue(job, "delivery_error");
  const transferWarningText = localizedSftpJobIssue(job, "warning");
  const jobErrorText = localizedSftpJobIssue(job, "error");
  const deliveryError = deliveryErrorText ? `<div class="sftp-job-error"><strong>${esc(tr("tasks:auto.auto_save_failed", {defaultValue:"自动保存失败"}))}</strong><span data-i18n-skip>${esc(deliveryErrorText).slice(0,500)}</span></div>` : "";
  const transferWarning = transferWarningText ? `<div class="sftp-job-warning"><strong>${esc(tr("tasks:auto.transfer_notice", {defaultValue:"传输提示"}))}</strong><span data-i18n-skip>${esc(transferWarningText).slice(0,500)}</span></div>` : "";
  const taskLogView = (desktopJob || componentJob) ? ensureSftpTaskLogViewState(job.id) : null;
  const taskLog = taskLogView && job.logs?.length ? `<details class="global-task-log" data-task-id="${escAttr(job.id)}" ${taskLogView.expanded ? "open" : ""}><summary>${esc(tr("tasks:auto.view_logs", {defaultValue:"查看日志"}))}</summary><pre>${esc(job.logs.slice(-80).map(item => `[${new Date(item.at || Date.now()).toLocaleTimeString()}] ${item.text || ""}`).join("\n"))}</pre></details>` : "";
  const currentText = localizedSftpJobText(job.current);
  return `<div class="sftp-job ${escAttr(job.status)}"><div><strong data-i18n-skip>${esc(sftpJobDisplayLabel(job))}</strong><span data-i18n-skip>${esc(job.connection_name || "")} · ${esc(detail)}${job.progress_unit === "percent" ? "" : currentText ? ` · ${esc(currentText)}` : ""}${finishedAt ? ` · ${finishedAt}` : ""}</span>${deliveryText}${progressBar}${taskLog}${transferWarning}${deliveryError}${jobErrorText ? `<div class="sftp-job-error"><strong>${esc(tr("tasks:auto.failure_reason", {defaultValue:"失败原因"}))}</strong><span data-i18n-skip>${esc(jobErrorText).slice(0,500)}</span></div>` : ""}</div><div class="actions tight">${downloadAction}${resumeBtn}${pauseBtn}${retrySyncBtn}${exportSyncBtn}${desktopOpenBtn}${cancelBtn}${deleteBtn}</div></div>`;
}

function closeSftpRecycleBin() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
  sftpRecycleBinConnectionId = 0;
}

function sftpRecycleItemHtml(connectionId, item) {
  const deletedAt = item.deleted_at
    ? new Date(item.deleted_at).toLocaleString(document.documentElement.lang || undefined)
    : tr("sftp:recycle_bin.unknown_time", {defaultValue:"时间未知"});
  const storage = item.storage === "tunneldesk" ? "tunneldesk" : "terma";
  const legacy = storage === "tunneldesk" ? tr("sftp:recycle_bin.legacy_suffix", {defaultValue:" · 旧版数据"}) : "";
  const deletedText = tr("sftp:recycle_bin.deleted_at", {date:deletedAt, legacy, defaultValue:`删除于 ${deletedAt}${legacy}`});
  const restore = tr("sftp:recycle_bin.restore", {defaultValue:"恢复"});
  const permanentDelete = tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"});
  const idArg = sftpTaskInlineArgument(item.id);
  const nameArg = sftpTaskInlineArgument(item.name || item.original_path);
  const storageArg = sftpTaskInlineArgument(storage);
  return `<div class="sftp-recycle-item"><span class="sftp-recycle-icon ${escAttr(item.type)}">${icon(item.type === "dir" ? "folder" : "file")}</span><div data-i18n-skip><strong title="${escAttr(item.original_path)}">${esc(item.name || item.original_path)}</strong><span>${esc(item.original_path)}</span><small>${esc(deletedText)}</small></div><div class="actions tight"><button type="button" title="${escAttr(restore)}" aria-label="${escAttr(restore)}" onclick="restoreSftpRecycleItem(${Number(connectionId)},${idArg},${storageArg})">${icon("undo-2")}<span>${esc(restore)}</span></button><button class="danger" type="button" title="${escAttr(permanentDelete)}" aria-label="${escAttr(permanentDelete)}" onclick="deleteSftpRecycleItem(${Number(connectionId)},${idArg},${nameArg},${storageArg})">${icon("trash-2")}<span>${esc(permanentDelete)}</span></button></div></div>`;
}

async function openSftpRecycleBin(tabKey=activeTabKey, connectionIdOverride=0) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const tab = tabs.find(item => item.key === tabKey);
  const connectionId = Number(connectionIdOverride || tab?.id || runtime?.state.connectionId || sftpRecycleBinConnectionId);
  if (!connectionId) return;
  sftpRecycleBinConnectionId = connectionId;
  const modal = $("modal");
  modal.onclick = null;
  const close = tr("common:actions.close", {defaultValue:"关闭"});
  const clear = tr("sftp:recycle_bin.clear", {defaultValue:"清空回收站"});
  modal.innerHTML = `<div class="modal-card wide sftp-recycle-modal" role="dialog" aria-modal="true" aria-labelledby="sftpRecycleTitle"><div class="sftp-modal-head"><div><h2 id="sftpRecycleTitle">${esc(tr("sftp:recycle_bin.title", {defaultValue:"SFTP 回收站"}))}</h2><span id="sftpRecycleSummary">${esc(tr("sftp:recycle_bin.loading_remote", {defaultValue:"正在读取远端回收站"}))}</span></div><button class="icon-button" type="button" title="${escAttr(close)}" aria-label="${escAttr(close)}" onclick="closeSftpRecycleBin()">${icon("x")}</button></div><div id="sftpRecycleList" class="sftp-recycle-list">${stateView("loading", tr("sftp:recycle_bin.loading", {defaultValue:"正在读取回收站"}))}</div><div class="actions"><button id="sftpRecycleClear" class="danger" type="button" title="${escAttr(clear)}" aria-label="${escAttr(clear)}" hidden onclick="clearSftpRecycleBin(${connectionId})">${icon("trash-2")}<span>${esc(clear)}</span></button><button type="button" onclick="closeSftpRecycleBin()">${esc(close)}</button></div></div>`;
  modal.hidden = false;
  try {
    const data = await api(`/api/connections/${connectionId}/sftp/trash`);
    if (sftpRecycleBinConnectionId !== connectionId || !$("sftpRecycleList")) return;
    const items = data.items || [];
    const state = data.enabled
      ? tr("sftp:recycle_bin.enabled", {defaultValue:"已开启"})
      : tr("sftp:recycle_bin.disabled", {defaultValue:"当前关闭"});
    $("sftpRecycleSummary").textContent = tr("sftp:recycle_bin.summary", {state, count:items.length, defaultValue:`${state} · ${items.length} 个项目`});
    $("sftpRecycleList").innerHTML = items.length
      ? items.map(item => sftpRecycleItemHtml(connectionId, item)).join("")
      : stateView("empty", tr("sftp:recycle_bin.empty", {defaultValue:"回收站为空"}), data.enabled
        ? tr("sftp:recycle_bin.empty_enabled_hint", {defaultValue:"删除的远程项目会保存在这里。"})
        : tr("sftp:recycle_bin.empty_disabled_hint", {defaultValue:"可在 SFTP 页面右上角的全局设置中开启回收站。"}));
    $("sftpRecycleClear").hidden = !items.length;
  } catch (error) {
    if ($("sftpRecycleList")) $("sftpRecycleList").innerHTML = stateView("error", tr("sftp:recycle_bin.load_failed", {defaultValue:"回收站读取失败"}), error.message, `<button onclick="openSftpRecycleBin(${sftpTaskInlineArgument(tabKey)})">${esc(tr("common:actions.retry", {defaultValue:"重试"}))}</button>`);
  }
}

async function restoreSftpRecycleItem(connectionId, id, storage="terma") {
  try {
    const result = await api(`/api/connections/${connectionId}/sftp/trash/restore`, {method:"POST", body:JSON.stringify({id, storage})});
    const path = result.original_path || tr("sftp:drag.remote_item", {defaultValue:"远程项目"});
    notify(tr("sftp:recycle_bin.restored", {path, defaultValue:`已恢复：${path}`}), "success");
    queueSftpDirectoryRefresh(connectionId);
    flushPendingSftpDirectoryRefresh();
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.restore_failed", {defaultValue:"恢复失败"}), "error");
  }
  openSftpRecycleBin("", connectionId);
}

async function deleteSftpRecycleItem(connectionId, id, name, storage="terma") {
  if (!await confirmModal(
    tr("sftp:recycle_bin.delete_message", {name, defaultValue:`永久删除回收站中的项目且无法恢复？\n${name}`}),
    tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"}),
    tr("sftp:recycle_bin.permanent_delete", {defaultValue:"永久删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return openSftpRecycleBin("", connectionId);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/delete`, {method:"POST", body:JSON.stringify({id, storage})});
    notify(tr("sftp:recycle_bin.deleted", {defaultValue:"回收站项目已永久删除"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.delete_failed", {defaultValue:"永久删除失败"}), "error");
  }
  openSftpRecycleBin("", connectionId);
}

async function clearSftpRecycleBin(connectionId) {
  if (!await confirmModal(
    tr("sftp:recycle_bin.clear_message", {defaultValue:"永久删除当前服务器回收站内的全部项目？此操作无法撤销。"}),
    tr("sftp:recycle_bin.clear_title", {defaultValue:"清空 SFTP 回收站"}),
    tr("sftp:recycle_bin.clear_confirm", {defaultValue:"全部永久删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return openSftpRecycleBin("", connectionId);
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/clear`, {method:"POST", body:"{}"});
    notify(tr("sftp:recycle_bin.cleared", {defaultValue:"SFTP 回收站已清空"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:recycle_bin.clear_failed", {defaultValue:"清空回收站失败"}), "error");
  }
  openSftpRecycleBin("", connectionId);
}

function sftpJobStatus(status, phase="") {
  if (status === "running" && ["archiving", "committing", "downloading", "scanning", "transferring"].includes(phase)) {
    return tr(`tasks:phase.${phase}`, {defaultValue:phase});
  }
  if (status === "pending" && phase === "queued") return tr("tasks:phase.queued", {defaultValue:"排队中"});
  if (status === "running" && phase === "receiving") return tr("tasks:phase.receiving", {defaultValue:"正在准备上传"});
  if (status === "running" && phase === "uploading") return tr("tasks:phase.uploading", {defaultValue:"正在上传到远端"});
  if (status === "running" && phase === "committing") return tr("tasks:phase.completing", {defaultValue:"正在完成"});
  if (status === "running" && phase === "system-saving") return tr("tasks:phase.system_saving", {defaultValue:"正在保存到本机"});
  if (status === "running" && phase === "local-saving") return tr("tasks:phase.local_saving", {defaultValue:"正在下载到本机"});
  if (status === "running" && phase === "cancelling") return tr("tasks:phase.cancelling", {defaultValue:"正在停止"});
  if (status === "pending" && phase === "resuming") return tr("tasks:phase.resuming", {defaultValue:"正在继续"});
  return tr(`tasks:status.${status}`, {defaultValue:status});
}

async function cancelSftpJob(id, button=null) {
  const key = String(id || "");
  const actionKey = `sftp-task:cancel:${key}`;
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.stopping", {defaultValue:"停止中..."}))) return null;
  const upload = sftpUploadRequests.get(key);
  if (upload) upload.cancelled = true;
  try {
    if (key.startsWith("sync:")) {
      await api(`/api/sftp/sync/jobs/${encodeURIComponent(key.slice(5))}/cancel`, {method:"POST"});
      await refreshSftpJobs();
      return;
    }
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/cancel`, {method:"POST"});
    if (result?.ok === false) notify(localizedSftpTaskMessage(result.message, result.message_code, result.message_params) || tr("sftp:task_ui.stop_rejected", {defaultValue:"停止请求未被接受，任务仍在继续"}), "info");
    await refreshSftpJobs();
  } finally {
    try { upload?.xhr?.abort(); } catch {}
    endUiAction(actionKey, button);
  }
}

async function pauseSftpJob(id, button=null) {
  const actionKey = `sftp-task:pause:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.pausing", {defaultValue:"暂停中..."}))) return null;
  try {
    await api(`/api/sftp/jobs/${encodeURIComponent(id)}/pause`, {method:"POST"});
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.pause_failed", {defaultValue:"暂停任务失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function resumeSftpJob(id, button=null) {
  const actionKey = `sftp-task:resume:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.processing", {defaultValue:"处理中..."}))) return null;
  try {
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/resume`, {method:"POST"});
    if (result && result.error) return notify(result.error, "error");
    notify(tr("sftp:task_ui.resumed", {defaultValue:"SFTP 任务已重新开始"}), "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.resume_failed", {defaultValue:"重试任务失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function deleteSftpJob(id, button=null) {
  const key = String(id || "");
  const actionKey = `sftp-task:delete:${key}`;
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.deleting", {defaultValue:"删除中..."}))) return null;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const centerButton = document.getElementById("sftpTaskCenterButton");
  const keepOpen = Boolean(drawer && !drawer.hidden);
  try {
    if (!await confirmModal(
      tr("tasks:dialogs.delete_message", {defaultValue:"删除该任务记录？"}),
      tr("tasks:dialogs.delete_title", {defaultValue:"删除任务"}),
      tr("common:actions.delete", {defaultValue:"删除"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    await deleteSftpJobRecord(key);
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.delete_failed", {defaultValue:"删除任务失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
    if (keepOpen && drawer) {
      drawer.hidden = false;
      centerButton?.setAttribute("aria-expanded", "true");
      renderSftpTaskCenterDrawer();
    }
  }
}

async function toggleSftpTaskFloatJob(button) {
  const id = String(button?.dataset?.jobId || "");
  const action = String(button?.dataset?.action || "");
  if (!id || !["pause", "resume"].includes(action)) return;
  if (action === "pause") await pauseSftpJob(id, button);
  else await resumeSftpJob(id, button);
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if (typeof updateSftpTaskCenter === "function") updateSftpTaskCenter(Array.isArray(sftpLatestJobs) ? sftpLatestJobs : []);
    if (sftpRecycleBinConnectionId && $("sftpRecycleTitle")) openSftpRecycleBin("", sftpRecycleBinConnectionId);
  });
}

function deleteSftpJobRecord(id) {
  const key = String(id || "");
  if (key.startsWith("desktop:")) return api(`/api/linux-desktop/tasks/${encodeURIComponent(key.slice(8))}`, {method:"DELETE"});
  if (key.startsWith("component:")) return api(`/api/remote-component/tasks/${encodeURIComponent(key.slice(10))}`, {method:"DELETE"});
  if (key.startsWith("sync:")) return api(`/api/sftp/sync/jobs/${encodeURIComponent(key.slice(5))}`, {method:"DELETE"});
  return api(`/api/sftp/jobs/${encodeURIComponent(key)}`, {method:"DELETE"});
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
  const archive = await sftpArchiveOptionsModal({mode:"extract", connectionId:id, path, target:runtime?.state.path || "."});
  if (!archive) return;
  const job = await api(`/api/connections/${id}/sftp/extract`, {method:"POST", body:JSON.stringify({path, target:archive.target, encoding:archive.encoding, overwrite:archive.overwrite, background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function compressSingleSftp(id, path, tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const archive = await sftpArchiveOptionsModal({mode:"compress", connectionId:id, title:tr("sftp:dialogs.compress_remote", {defaultValue:"压缩远程项目"}), filename:`${sftpPathName(path)}.tar.gz`});
  if (!archive) return;
  try {
    const job = await api(`/api/connections/${id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:[path], target:runtime?.state.path || ".", filename:archive.filename, encoding:archive.encoding})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:operations.compress_failed", {defaultValue:"压缩任务创建失败"}), "error");
  }
}

function openSftpActionSheet(tabKey=activeTabKey) {
  const actions = [
    { label: tr("sftp:action_sheet.copy_selected", {defaultValue:"复制选中"}), value: "copy" },
    { label: tr("sftp:action_sheet.move_selected", {defaultValue:"移动选中"}), value: "move" },
    ...(sftpClipboardMatchesConnection(tabKey) ? [{ label: tr("sftp:clipboard.paste_current", {defaultValue:"粘贴到当前目录"}), value: "paste" }] : []),
    ...(sftpClipboard?.paths?.length ? [{ label: tr("sftp:clipboard.cancel_title", {defaultValue:"取消复制/移动队列"}), value: "cancelClipboard" }] : []),
    { label: tr("sftp:action_sheet.download_selected", {defaultValue:"下载选中"}), value: "download" },
    { label: tr("sftp:action_sheet.compress_selected", {defaultValue:"压缩选中"}), value: "compress" },
    { label: tr("sftp:menu.permissions", {defaultValue:"设置权限"}), value: "permissions" },
    { label: tr("sftp:action_sheet.extract_selected", {defaultValue:"解压选中压缩包"}), value: "extract" },
    { label: tr("sftp:action_sheet.delete_selected", {defaultValue:"删除选中"}), value: "delete", className: "danger" },
    { label: tr("common:actions.cancel", {defaultValue:"取消"}), value: "" }
  ];
  chooseModal(tr("sftp:action_sheet.title", {defaultValue:"SFTP 操作"}), tr("sftp:action_sheet.hint", {defaultValue:"选择要执行的文件操作。"}), actions).then(value => {
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
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.clearing", {defaultValue:"清理中..."}))) return null;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const centerButton = document.getElementById("sftpTaskCenterButton");
  const keepOpen = Boolean(drawer && !drawer.hidden);
  try {
    if (!await confirmModal(
      tr("tasks:dialogs.clear_history_message", {defaultValue:"清空全部已完成和已取消的任务记录？失败记录会保留。"}),
      tr("tasks:dialogs.clear_history_title", {defaultValue:"清空任务历史"}),
      tr("tasks:dialogs.clear_history_action", {defaultValue:"清空历史"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    const result = await api("/api/sftp/jobs/clear-finished", {method:"POST"});
    const syncResult = window.termaDesktop ? await api("/api/sftp/sync/jobs/clear-finished", {method:"POST"}).catch(() => ({removed:0})) : {removed:0};
    const desktopResult = await api("/api/linux-desktop/tasks/clear-finished", {method:"POST"}).catch(() => ({removed:0}));
    const componentResult = await api("/api/remote-component/tasks/clear-finished", {method:"POST"}).catch(() => ({removed:0}));
    const count = Number(result.removed || 0) + Number(syncResult.removed || 0) + Number(desktopResult.removed || 0) + Number(componentResult.removed || 0);
    notify(tr("sftp:task_ui.history_cleared", {count, defaultValue:`已清理 ${count} 条历史任务`}), "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.clear_history_failed", {defaultValue:"清空任务历史失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
    if (keepOpen && drawer) {
      drawer.hidden = false;
      centerButton?.setAttribute("aria-expanded", "true");
      renderSftpTaskCenterDrawer();
    }
  }
}

async function clearFailedSftpJobs(button=null) {
  const actionKey = "sftp-task:clear-failed";
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.clearing", {defaultValue:"清理中..."}))) return null;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  const centerButton = document.getElementById("sftpTaskCenterButton");
  const keepOpen = Boolean(drawer && !drawer.hidden);
  try {
    const failed = sftpTaskCollections().failed;
    if (!failed.length) return null;
    if (!await confirmModal(
      tr("tasks:dialogs.clear_failed_message", {count:failed.length, defaultValue:`删除全部 ${failed.length} 条失败任务记录？此操作不会影响任务中心中的其他记录。`}),
      tr("tasks:dialogs.clear_failed_title", {defaultValue:"清空失败任务"}),
      tr("tasks:dialogs.clear_failed_action", {defaultValue:"清空失败"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    const results = await Promise.allSettled(failed.map(job => deleteSftpJobRecord(job.id)));
    const removed = results.filter(result => result.status === "fulfilled").length;
    const rejected = results.length - removed;
    await refreshSftpJobs();
    notify(rejected
      ? tr("sftp:task_ui.failed_tasks_partially_deleted", {removed, rejected, defaultValue:`已删除 ${removed} 条失败任务，${rejected} 条删除失败`})
      : tr("sftp:task_ui.failed_tasks_deleted", {count:removed, defaultValue:`已删除 ${removed} 条失败任务`}), rejected ? "error" : "success");
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.clear_failed_failed", {defaultValue:"清空失败任务失败"}), "error");
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
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.retrying", {defaultValue:"重试中..."}))) return null;
  try {
    const job = await api(`/api/sftp/sync/jobs/${encodeURIComponent(id)}/retry`, {method:"POST", body:"{}"});
    notify(tr("sftp:task_ui.sync_retried", {count:job.total || 0, defaultValue:`已重试 ${job.total || 0} 个失败项目`}), "success");
    await refreshSftpJobs();
  } catch (error) {
    notify(error.message || tr("sftp:task_ui.sync_retry_failed", {defaultValue:"同步任务重试失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}

async function exportSftpSyncResult(id, button=null) {
  const actionKey = `sftp-task:sync-export:${String(id || "")}`;
  if (!beginUiAction(actionKey, button, tr("sftp:task_ui.exporting", {defaultValue:"导出中..."}))) return null;
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
    notify(error.message || tr("sftp:task_ui.export_failed", {defaultValue:"导出同步结果失败"}), "error");
  } finally {
    endUiAction(actionKey, button);
  }
}
