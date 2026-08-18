const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { notifyEvent } = require("./notifications");
const { buildDeleteRemotePathCommand, buildRecycleRemotePathCommand, invalidateRemoteDirectoryCache } = require("./sftp");
const { clearSftpDragCache, deliverSftpPaths, getSftpConnection, openSftpChannel, releaseNativeSftpDragTicket, sftpDragCacheInfo } = require("./sftp-session");
const { readSftpJobHistory, writeSftpJobHistoryAtomic } = require("./sftp-job-store");
const { createCheckpointTransfers } = require("./sftp-checkpoint-transfers");
const { createSftpDownloadCache } = require("./sftp-download-cache");
const { createSftpDownloadJobs } = require("./sftp-download-jobs");
const { filenameEncoding, remotePathOperand, shellQuote, spawnRemote } = require("./sftp-job-paths");
const { createNativeSftpDragJobs } = require("./sftp-native-drag-jobs");
const { buildCrossCopyOverwriteCommand, buildItemProgressJobCommand, buildRemoteExtractCommand, normalizeCompressionRequest } = require("./sftp-operation-commands");
const { createSftpTransferScheduler } = require("./sftp-transfer-scheduler");
const { createSftpUploadJobs } = require("./sftp-upload-jobs");
const { clearSftpJobIssue, setSftpJobIssue } = require("./sftp-job-issues");

const jobs = new Map();
const JOBS_FILE = path.join(DATA_DIR, "sftp-jobs.json");
const MAX_HISTORY = 120;
const ACTIVE_STATUSES = new Set(["running", "pending", "paused"]);
let historyCache: any[] | null = null;
let persistTimer: any = null;
let downloadCacheService: any = null;

function uploadJobOwnsLocalPath(job) {
  if (job?.type !== "upload") return false;
  return job.local_path_owned === true;
}

function formatSftpTransferSize(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function serializableJob(source) {
  const {
    child,
    stream,
    streams,
    out,
    responder,
    pauseNow,
    receive_token,
    transfer_runner,
    transfer_waiters,
    transfer_queued,
    transfer_slot_kind,
    transfer_start_phase,
    transfer_start_current,
    native_drag_token,
    native_drag_ranges,
    ...job
  } = source || {};
  return job;
}

function resetTransferSpeed(job) {
  job.speed_bps = 0;
  job.speed_sample_at = Date.now();
  job.speed_sample_bytes = Number(job.transferred || 0);
}

function updateTransferProgress(job) {
  const size = Math.max(0, Number(job.size || 0));
  const sizeKnown = Boolean(job.size_known || job.progress_known || size > 0);
  job.progress_known = sizeKnown;
  if (!sizeKnown) {
    job.progress = 0;
    return;
  }
  if (job.type === "upload" && job.two_stage_upload) {
    const received = Math.max(0, Math.min(size, Number(job.received_bytes || 0)));
    const uploaded = Math.max(0, Math.min(size, Number(job.transferred || 0)));
    if (job.phase === "receiving") {
      job.progress = size ? Math.min(50, Math.floor(received / size * 50)) : 50;
    } else if (job.phase === "committing") {
      job.progress = 99;
    } else {
      job.progress = size ? Math.min(99, 50 + Math.floor(uploaded / size * 49)) : 99;
    }
    return;
  }
  job.progress = size
    ? Math.min(99, Math.floor(Math.max(0, Number(job.transferred || 0)) / size * 100))
    : 0;
}

function recordTransferred(job, bytes) {
  job.transferred = Number(job.transferred || 0) + Number(bytes || 0);
  updateTransferProgress(job);
  const now = Date.now();
  const elapsed = now - Number(job.speed_sample_at || now);
  if (elapsed >= 500) {
    const delta = Math.max(0, job.transferred - Number(job.speed_sample_bytes || 0));
    const current = delta * 1000 / elapsed;
    job.speed_bps = job.speed_bps ? Math.round(job.speed_bps * 0.35 + current * 0.65) : Math.round(current);
    job.speed_sample_at = now;
    job.speed_sample_bytes = job.transferred;
  }
}

function finishTransferMetrics(job) {
  const elapsed = Math.max(1, Number(job.finished_at || Date.now()) - Number(job.started_at || Date.now()));
  job.average_bps = Math.round(Number(job.transferred || 0) * 1000 / elapsed);
  job.speed_bps = 0;
}

const {
  queueTransferJob,
  refreshSftpTransferQueues,
  rejectTransferWaiters,
  releaseTransferSlot,
  removeQueuedTransfer,
  resolveTransferWaiters,
  transferCancelledError,
  waitForSftpTransferStart
} = createSftpTransferScheduler({
  activeStatuses:ACTIVE_STATUSES,
  finishTransferMetrics,
  jobs,
  persistJobs
});

function ignoreStoppedTransferFinish(job, status) {
  return job.status === "cancelled" || (job.status === "paused" && status !== "paused");
}

const {
  cleanupCrossCopyArtifacts,
  resumeCrossCopyJob,
  startCrossCopyJob
} = createCheckpointTransfers({
  finishTransferMetrics,
  getSftpConnection,
  jobs,
  notifyEvent,
  openSftpChannel,
  persistJobs,
  queueTransferJob,
  recordTransferred,
  releaseTransferSlot,
  remotePathOperand,
  resetTransferSpeed,
  shellQuote,
  spawnRemote,
  updateTransferProgress
});

function cleanupRemoteArchiveJobArtifact(job) {
  const remotePath = String(job?.remote_archive_path || "");
  if (!remotePath) return false;
  try {
    const connection = getSftpConnection(job.connection_id);
    const child = spawnRemote(connection, `rm -f -- ${remotePathOperand(connection, remotePath)}`);
    child.stdin?.end?.();
    child.stdout?.resume?.();
    child.stderr?.resume?.();
    job.remote_archive_path = "";
    if (job.remote_path === remotePath) job.remote_path = "";
    job.archive_ready = false;
    return true;
  } catch {
    return false;
  }
}

function readHistory(): any[] {
  if (historyCache) return historyCache;
  const loaded = readSftpJobHistory(JOBS_FILE);
  const interruptedAt = Date.now();
  let changed = false;
  historyCache = loaded.map((source: any) => {
    const restored = serializableJob(source);
    if (Object.keys(restored).length !== Object.keys(source || {}).length) changed = true;
    if (restored?.type === "upload" && typeof restored.local_path_owned !== "boolean") {
      restored.local_path_owned = uploadJobOwnsLocalPath(restored);
      changed = true;
    }
    if (!ACTIVE_STATUSES.has(restored?.status)) return restored;
    changed = true;
    const restartResumable = restored.resume_supported === true && ["download", "cross-copy"].includes(restored.type);
    const interrupted = {
      ...restored,
      status:"failed",
      error:restartResumable ? "Terma 已重启，可从检查点继续任务" : "Terma 已重启，任务已中断",
      error_code:restartResumable ? "sftp_restart_resume_available" : "sftp_restart_interrupted",
      can_resume:restartResumable,
      speed_bps:0,
      average_bps:0,
      finished_at:interruptedAt,
      interrupted_at:interruptedAt
    };
    delete interrupted.error_params;
    if (interrupted.type === "download") interrupted.delivery_status = "interrupted";
    if (!restartResumable) {
      cleanupJobArtifacts(interrupted);
      if (interrupted.type === "upload") cleanupRemoteUploadArtifact(interrupted);
    }
    return interrupted;
  });
  if (changed) historyCache = writeSftpJobHistoryAtomic(JOBS_FILE, historyCache, MAX_HISTORY);
  downloadCacheService?.ensureDownloadCacheMaintained();
  return historyCache;
}

function persistJobs(immediate = false) {
  if (!immediate) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persistJobs(true), 400);
    return;
  }
  clearTimeout(persistTimer);
  persistTimer = null;
  const active: any[] = [...jobs.values()].map(serializableJob);
  const byId = new Map(readHistory().map((job: any) => [job.id, job]));
  for (const job of active) byId.set(job.id, job);
  const next = [...byId.values()].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)).slice(0, MAX_HISTORY);
  writeJsonJobs(next);
}

function listSftpJobs() {
  const active: any[] = [...jobs.values()].map((source: any) => {
    const job = serializableJob(source);
    return {
      ...job,
      can_resume: job.resume_supported === true
        && ["paused", "failed"].includes(job.status)
        && (job.type !== "upload" || (job.staged_complete && job.phase !== "receiving" && fs.existsSync(job.local_path || "")))
    };
  });
  const activeIds = new Set(active.map((job) => job.id));
  const history = readHistory().filter((job) => !activeIds.has(job.id)).map((job: any) => ({
    ...job,
    can_resume: job.resume_supported === true
      && ["paused", "failed"].includes(job.status)
      && ["download", "cross-copy"].includes(job.type)
  }));
  return [...active, ...history]
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, MAX_HISTORY);
}

function clearFinishedSftpJobs() {
  const keepStatuses = new Set(["running", "pending", "paused", "failed"]);
  const before = listSftpJobs();
  for (const [id, job] of jobs) {
    if (!keepStatuses.has(job.status)) jobs.delete(id);
  }
  const active = [...jobs.values()].map(serializableJob);
  const activeIds = new Set(active.map((job: any) => job.id));
  const history = readHistory().filter((job: any) => keepStatuses.has(job.status) && !activeIds.has(job.id));
  writeJsonJobs([...active, ...history]);
  const removed = Math.max(0, before.length - active.length - history.length);
  return { ok: true, removed };
}

function writeJsonJobs(items) {
  const previous = historyCache ? [...historyCache] : readSftpJobHistory(JOBS_FILE);
  historyCache = writeSftpJobHistoryAtomic(JOBS_FILE, items, MAX_HISTORY);
  const retained = new Set(historyCache.map((item: any) => item.id));
  for (const item of previous) {
    if (!retained.has(item.id)) cleanupJobArtifacts(item);
  }
}

downloadCacheService = createSftpDownloadCache({
  clearSftpDragCache,
  dataDir:DATA_DIR,
  getHistory:readHistory,
  getHistoryCache:() => historyCache || [],
  hasHistoryCache:() => historyCache !== null,
  jobs,
  persistJobs,
  replaceHistoryCache:(items: any[]) => { historyCache = writeSftpJobHistoryAtomic(JOBS_FILE, items, MAX_HISTORY); },
  sftpDragCacheInfo
});
const {
  clearSftpCache,
  downloadsDirectory,
  removeDownloadCacheFile,
  sftpCacheInfo
} = downloadCacheService;

process.once("beforeExit", () => {
  if (persistTimer) persistJobs(true);
});

function startSftpJob(connectionId, type, command, label, options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const id = crypto.randomUUID();
  const itemCount = Math.max(0, Number(options.itemCount || 0));
  const job: any = {
    id,
    connection_id: Number(connectionId),
    connection_name: connection.name,
    type,
    label,
    status: "running",
    stdout: "",
    stderr: "",
    error: "",
    size:itemCount,
    size_known:itemCount > 0,
    progress_known:itemCount > 0,
    progress_unit:itemCount ? "items" : undefined,
    transferred:0,
    progress:0,
    item_count:itemCount,
    completed_items:0,
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: null
  };
  resetTransferSpeed(job);
  const child = spawnRemote(connection, command);
  job.child = child;
  jobs.set(id, job);
  persistJobs();
  const outputState = {remainder:""};
  let stdoutEnded = false;
  const flushOutput = () => {
    if (stdoutEnded || !options.progressMarker) return;
    stdoutEnded = true;
    consumeDeleteJobOutput(job, options.progressMarker, outputState, "", true);
  };
  child.stdout.on("data", (chunk) => {
    if (options.progressMarker) consumeDeleteJobOutput(job, options.progressMarker, outputState, chunk);
    else job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000);
    persistJobs();
  });
  child.stdout.on("end", flushOutput);
  child.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
  let finished = false;
  const finish = (status, error = "", errorCode = "", errorParams = {}) => {
    if (finished || job.status === "cancelled") return;
    finished = true;
    flushOutput();
    job.status = status;
    setSftpJobIssue(job, "error", error, errorCode, errorParams);
    job.finished_at = Date.now();
    job.speed_bps = 0;
    job.average_bps = 0;
    if (status === "done") {
      if (itemCount) {
        job.completed_items = itemCount;
        job.transferred = itemCount;
      }
      job.progress = 100;
    }
    persistJobs(true);
    notifyEvent({
      type: "sftp",
      level: status === "done" ? "success" : "error",
      title: status === "done" ? "SFTP 任务已完成" : "SFTP 任务失败",
      message: `${job.connection_name} · ${job.label}${job.error ? `\n${job.error}` : ""}`,
      action: { view: "sftp", connection_id: job.connection_id }
    }, { cooldown_ms: 0 });
  };
  child.on("error", (error) => finish("failed", error.message));
  child.on("close", (code, signal) => {
    if (code === 0) return finish("done");
    if (job.stderr) return finish("failed", job.stderr);
    finish("failed", `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`, signal ? "sftp_process_exit_with_signal" : "sftp_process_exit", {exit_code:code, signal:signal || ""});
  });
  return { id, status: job.status };
}

function buildDeleteJobRequest(connection, paths, recycleEnabled = false) {
  const source = Array.isArray(paths) ? paths : [paths];
  if (!source.length) throw new Error("请选择要删除的文件或目录");
  if (source.length > 200) throw new Error("一次最多删除 200 个文件或目录");
  const prepared = [];
  const seen = new Set();
  let totalPathBytes = 0;
  for (const remotePath of source) {
    const request = buildDeleteRemotePathCommand(remotePath, connection);
    if (seen.has(request.path)) continue;
    seen.add(request.path);
    totalPathBytes += Buffer.byteLength(request.path, "utf8");
    if (totalPathBytes > 32768) throw new Error("所选远程路径总长度过长");
    prepared.push(request);
  }
  if (!prepared.length) throw new Error("请选择要删除的文件或目录");
  const createdAt = Date.now();
  const markerPrefix = `__TERMA_DELETE_${crypto.randomBytes(12).toString("hex")}__:`;
  const operations = prepared.map((request, index) => {
    const operation = recycleEnabled
      ? buildRecycleRemotePathCommand(
        request.path,
        `${(createdAt + index).toString(36)}-${crypto.randomBytes(8).toString("hex")}`,
        createdAt + index,
        connection
      )
      : request.command;
    return `(${operation}) && printf '%s\\n' ${shellQuote(`${markerPrefix}${index + 1}`)}`;
  });
  return {
    command: operations.join(" && "),
    paths: prepared.map((item) => item.path),
    recycled: Boolean(recycleEnabled),
    item_count: prepared.length,
    progress_marker: markerPrefix
  };
}

function consumeDeleteJobOutput(job, markerPrefix, state, chunk = "", flush = false) {
  state.remainder = `${state.remainder || ""}${Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "")}`;
  const consumeLine = (rawLine, terminated) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(markerPrefix)) {
      const completed = Number(line.slice(markerPrefix.length));
      if (Number.isInteger(completed) && completed >= 1 && completed <= job.item_count) {
        job.completed_items = Math.max(Number(job.completed_items || 0), completed);
        job.transferred = job.completed_items;
        job.progress = Math.min(99, Math.floor(job.completed_items / job.item_count * 100));
        return;
      }
    }
    if (line || terminated) job.stdout = `${job.stdout}${line}${terminated ? "\n" : ""}`.slice(-12000);
  };
  let newlineAt = state.remainder.indexOf("\n");
  while (newlineAt >= 0) {
    consumeLine(state.remainder.slice(0, newlineAt), true);
    state.remainder = state.remainder.slice(newlineAt + 1);
    newlineAt = state.remainder.indexOf("\n");
  }
  if (flush && state.remainder) {
    consumeLine(state.remainder, false);
    state.remainder = "";
  } else if (state.remainder.length > 16000) {
    const retained = state.remainder.slice(-12000);
    consumeLine(state.remainder.slice(0, -12000), false);
    state.remainder = retained;
  }
}

function deletePathsJob(connectionId, paths, recycleEnabled = false) {
  const connection = getSftpConnection(connectionId);
  const request = buildDeleteJobRequest(connection, paths, recycleEnabled);
  const id = crypto.randomUUID();
  const singleName = request.item_count === 1 ? path.posix.basename(request.paths[0]) : "";
  const action = request.recycled ? "移入回收站" : "删除";
  const job: any = {
    id,
    connection_id: Number(connectionId),
    connection_name: connection.name,
    type: "delete",
    label: singleName ? `${action} ${singleName}` : `${action} ${request.item_count} 项`,
    status: "running",
    stdout: "",
    stderr: "",
    error: "",
    size: request.item_count,
    size_known: true,
    progress_known: true,
    transferred: 0,
    progress: 0,
    progress_unit: "items",
    completed_items: 0,
    item_count: request.item_count,
    recycled: request.recycled,
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: null
  };
  resetTransferSpeed(job);
  const child = spawnRemote(connection, request.command);
  const outputState = { remainder: "" };
  job.child = child;
  jobs.set(id, job);
  persistJobs();
  let finished = false;
  let stdoutEnded = false;
  const flushOutput = () => {
    if (stdoutEnded) return;
    stdoutEnded = true;
    consumeDeleteJobOutput(job, request.progress_marker, outputState, "", true);
  };
  const finish = (status, error = "", errorCode = "", errorParams = {}) => {
    if (finished || job.status === "cancelled") return;
    finished = true;
    flushOutput();
    job.status = status;
    setSftpJobIssue(job, "error", error, errorCode, errorParams);
    job.finished_at = Date.now();
    job.speed_bps = 0;
    job.average_bps = 0;
    if (status === "done") {
      job.completed_items = job.item_count;
      job.transferred = job.item_count;
      job.progress = 100;
    }
    invalidateRemoteDirectoryCache(connectionId);
    persistJobs(true);
    const partial = status === "failed" && job.completed_items
      ? `\n已处理 ${job.completed_items}/${job.item_count} 项`
      : "";
    notifyEvent({
      type: "sftp",
      level: status === "done" ? "success" : "error",
      title: status === "done" ? "SFTP 删除已完成" : "SFTP 删除失败",
      message: `${job.connection_name} · ${job.label}${partial}${job.error ? `\n${job.error}` : ""}`,
      action: { view: "sftp", connection_id: job.connection_id }
    }, { cooldown_ms: 0 });
  };
  child.stdout.on("data", (chunk) => {
    consumeDeleteJobOutput(job, request.progress_marker, outputState, chunk);
    persistJobs();
  });
  child.stdout.on("end", flushOutput);
  child.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.on("error", (error) => finish("failed", error.message));
  child.on("close", (code, signal) => {
    if (code === 0) return finish("done");
    if (job.stderr) return finish("failed", job.stderr);
    finish("failed", `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`, signal ? "sftp_process_exit_with_signal" : "sftp_process_exit", {exit_code:code, signal:signal || ""});
  });
  return {
    id,
    status: job.status,
    type: job.type,
    recycled: job.recycled,
    item_count: job.item_count,
    progress_unit: job.progress_unit
  };
}

const {
  addUniqueByteRange,
  beginNativeSftpDragJob,
  discardNativeSftpDragJob,
  finishNativeSftpDragJob,
  forgetNativeSftpDragJob,
  recordNativeSftpDragBytes,
  requestNativeSftpDragCancel,
  setNativeSftpDragCancelHandler,
  trackNativeSftpDragStream
} = createNativeSftpDragJobs({
  activeStatuses:ACTIVE_STATUSES,
  finishTransferMetrics,
  getSftpConnection,
  jobs,
  notifyEvent,
  persistJobs,
  queueTransferJob,
  readHistory,
  recordTransferred,
  rejectTransferWaiters,
  releaseTransferSlot,
  removeQueuedTransfer,
  resetTransferSpeed,
  resolveTransferWaiters,
  transferCancelledError,
  writeJsonJobs
});

const {
  cleanupRemoteUploadArtifact,
  receiveUploadJobContent,
  resumeUploadJob,
  startUploadJob,
  startUploadReceiveJob,
  uploadReceiveCancelledError
} = createSftpUploadJobs({
  cleanupJobArtifacts,
  dataDir:DATA_DIR,
  finishTransferMetrics,
  getSftpConnection,
  ignoreStoppedTransferFinish,
  invalidateRemoteDirectoryCache,
  jobs,
  notifyEvent,
  persistJobs,
  queueTransferJob,
  recordTransferred,
  releaseTransferSlot,
  resetTransferSpeed,
  resolveTransferWaiters,
  uploadJobOwnsLocalPath,
  updateTransferProgress,
  waitForSftpTransferStart
});

function cancelSftpJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const persisted = readHistory().find((item: any) => item.id === id);
    if (persisted) return { ok:true, status:persisted.status };
    throw new Error("任务不存在");
  }
  if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status };
  if (job.type === "upload" && job.phase === "committing") return { ok:true, status:job.status, phase:job.phase };
  if (job.transfer_queued) {
    removeQueuedTransfer(job);
    job.status = "cancelled";
    job.can_pause = false;
    job.can_cancel = false;
    job.finished_at = Date.now();
    setSftpJobIssue(job, "error", "用户已取消", "sftp_user_cancelled");
    rejectTransferWaiters(job, transferCancelledError());
    if (job.type === "native-drag" && job.native_drag_token) {
      forgetNativeSftpDragJob(job);
    }
    cleanupJobArtifacts(job);
    persistJobs(true);
    return {ok:true, status:job.status};
  }
  if (job.type === "native-drag" && job.native_drag_token) {
    return requestNativeSftpDragCancel(job);
  }
  const uploadPhase = job.type === "upload" ? job.phase : "";
  removeQueuedTransfer(job);
  rejectTransferWaiters(job, job.type === "upload" ? uploadReceiveCancelledError() : transferCancelledError());
  if (job.type === "upload") job.upload_generation = Math.max(0, Number(job.upload_generation || 0)) + 1;
  job.status = "cancelled";
  job.can_pause = false;
  job.finished_at = Date.now();
  setSftpJobIssue(job, "error", "用户已取消", "sftp_user_cancelled");
  try { job.child?.kill("SIGTERM"); } catch {}
  try { job.stream?.destroy(); } catch {}
  try { job.out?.destroy(); } catch {}
  try { job.responder?.kill?.("SIGTERM"); } catch {}
  try { job.responder?.destroy?.(); } catch {}
  if (job.streams instanceof Set) {
    for (const stream of job.streams) {
      try { stream.destroy(); } catch {}
    }
    job.streams.clear();
  }
  if (job.type === "delete") {
    job.speed_bps = 0;
    job.average_bps = 0;
    invalidateRemoteDirectoryCache(job.connection_id);
  } else {
    finishTransferMetrics(job);
  }
  if (job.type === "download") {
    removeDownloadCacheFile(job);
    if (job.archive_download) cleanupRemoteArchiveJobArtifact(job);
  }
  if (job.type === "upload") {
    cleanupJobArtifacts(job);
    if (uploadPhase !== "receiving") {
      cleanupRemoteUploadArtifact(job);
      setTimeout(() => cleanupRemoteUploadArtifact(job), 500);
    }
    invalidateRemoteDirectoryCache(job.connection_id);
    setTimeout(() => cleanupJobArtifacts(job), 100);
  }
  releaseTransferSlot(job);
  persistJobs(true);
  return { ok: true, status: job.status };
}

function cleanupJobArtifacts(job) {
  try { if (job.temp_path) fs.unlinkSync(job.temp_path); } catch {}
  if (job?.type === "cross-copy") cleanupCrossCopyArtifacts(job);
  if (job?.archive_download) cleanupRemoteArchiveJobArtifact(job);
  if (uploadJobOwnsLocalPath(job)) {
    try { if (job.local_path) fs.unlinkSync(job.local_path); } catch {}
  }
}

function deleteSftpJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const hist = readHistory().find((item) => item.id === id);
    if (hist) {
      const remaining = readHistory().filter((item) => item.id !== id);
      writeJsonJobs(remaining);
      cleanupJobArtifacts(hist);
      return { ok: true };
    }
    throw new Error("任务不存在");
  }
  if (job.status === "running" || job.status === "pending") throw new Error("请先暂停或取消运行中的任务");
  if (job.type === "upload") cleanupRemoteUploadArtifact(job);
  cleanupJobArtifacts(job);
  jobs.delete(id);
  writeJsonJobs(readHistory().filter((item) => item.id !== id));
  return { ok: true };
}

const {
  getRemoteSize,
  getSftpJobFile,
  markSftpJobDelivered,
  resumeArchiveDownloadJob,
  runDownloadJob,
  startArchiveDownloadJob,
  startDownloadJob,
  startLocalDeliveryJob
} = createSftpDownloadJobs({
  deliverSftpPaths,
  downloadsDirectory,
  finishTransferMetrics,
  formatSftpTransferSize,
  getSftpConnection,
  ignoreStoppedTransferFinish,
  jobs,
  notifyEvent,
  persistJobs,
  queueTransferJob,
  readHistory,
  recordTransferred,
  releaseTransferSlot,
  resetTransferSpeed,
  updateTransferProgress,
  writeJsonJobs
});

function pauseSftpJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error("任务不存在");
  if (job.resume_supported !== true || !["upload", "download", "cross-copy"].includes(job.type)) throw new Error("该任务类型暂不支持暂停");
  if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status };
  if (job.type === "upload" && job.phase === "receiving") throw new Error("文件接收阶段只能取消任务");
  if (job.type === "upload" && job.phase === "committing") return { ok:true, status:job.status };
  if (job.status === "running" && job.can_pause === false) throw new Error("当前阶段暂不能暂停，请等待进入文件传输阶段");
  if (job.status !== "running") {
    removeQueuedTransfer(job);
    rejectTransferWaiters(job, new Error("任务已暂停"));
    job.status = "paused";
    job.can_pause = false;
    clearSftpJobIssue(job, "error");
    job.finished_at = null;
    job.speed_bps = 0;
    job.average_bps = 0;
    persistJobs(true);
    return { ok: true, status: job.status };
  }
  job.status = "paused";
  job.can_pause = false;
  clearSftpJobIssue(job, "error");
  job.finished_at = null;
  job.speed_bps = 0;
  job.average_bps = 0;
  persistJobs(true);
  if (typeof job.pauseNow === "function") {
    job.pauseNow();
  } else if (job.type === "upload") {
    job.upload_generation = Math.max(0, Number(job.upload_generation || 0)) + 1;
    try { job.child?.kill("SIGTERM"); } catch {}
    try { job.stream?.destroy(); } catch {}
  } else {
    try { job.child?.kill("SIGTERM"); } catch {}
  }
  releaseTransferSlot(job);
  return { ok: true, status: job.status };
}

function resumeSftpJob(id) {
  let job = jobs.get(id);
  if (!job) {
    const hist = readHistory().find((item) => item.id === id);
    if (!hist) throw new Error("任务不存在");
    if (hist.resume_supported !== true || !["download", "cross-copy"].includes(hist.type)) {
      return { ok: false, error: "历史任务无法恢复，请重新开始下载或上传" };
    }
    job = {...hist, status:"failed", can_resume:true, child:null, stream:null, out:null, responder:null};
    jobs.set(id, job);
    persistJobs(true);
  }
  if (job.status === "running") return { ok: true, status: job.status };
  if (!["paused", "failed"].includes(job.status)) throw new Error(`当前状态（${job.status}）无法继续`);
  if (job.resume_supported !== true) throw new Error("该任务类型暂不支持继续");
  if (job.type === "download") {
    if (job.archive_download) return resumeArchiveDownloadJob(job);
    queueTransferJob("download", job, () => runDownloadJob(id, false), {phase:"preparing", current:"正在继续下载"});
    return { ok: true, status: job.status };
  }
  if (job.type === "upload") {
    resumeUploadJob(id);
    return { ok: true, status: job.status };
  }
  if (job.type === "cross-copy") return resumeCrossCopyJob(job);
  throw new Error("该任务类型暂不支持继续");
}

function crossCopyJob(sourceConnectionId, targetConnectionId, paths, targetDir = ".", conflictMode = "error", entries: any[] = []) {
  const sourceConnection = getSftpConnection(sourceConnectionId);
  const targetConnection = getSftpConnection(targetConnectionId);
  if (filenameEncoding(sourceConnection) !== filenameEncoding(targetConnection)) {
    throw new Error("源主机和目标主机的 SFTP 文件名编码必须一致，避免复制后文件名乱码");
  }
  if (String(conflictMode || "") === "rename" && filenameEncoding(targetConnection) !== "utf8") {
    throw new Error("非 UTF-8 文件名编码暂不支持自动改名，请选择覆盖或取消");
  }
  return startCrossCopyJob(sourceConnectionId, targetConnectionId, paths, targetDir, conflictMode);
}

function copyJob(connectionId, paths, targetDir) {
  const connection = getSftpConnection(connectionId);
  const request = buildItemProgressJobCommand(connection, "copy", paths, targetDir);
  return startSftpJob(connectionId, "copy", request.command, `复制 ${request.itemCount} 项`, {
    itemCount:request.itemCount,
    progressMarker:request.marker
  });
}

function moveJob(connectionId, paths, targetDir) {
  const connection = getSftpConnection(connectionId);
  const request = buildItemProgressJobCommand(connection, "move", paths, targetDir);
  return startSftpJob(connectionId, "move", request.command, `移动 ${request.itemCount} 项`, {
    itemCount:request.itemCount,
    progressMarker:request.marker
  });
}

function extractJob(connectionId, remotePath, targetDir, options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const request = buildRemoteExtractCommand(connection, remotePath, targetDir, options);
  return startSftpJob(connectionId, "extract", request.command, `解压 ${remotePath}`);
}

function compressJob(connectionId, paths, targetDir = ".", archiveName = "", filenameEncoding = "default") {
  const connection = getSftpConnection(connectionId);
  const request = normalizeCompressionRequest(paths, targetDir, archiveName, connection, filenameEncoding);
  return { ...startSftpJob(connectionId, "compress", request.command, `压缩 ${request.paths.length} 项为 ${request.name}`), output:request.output };
}

module.exports = { beginNativeSftpDragJob, cancelSftpJob, clearFinishedSftpJobs, clearSftpCache, compressJob, copyJob, crossCopyJob, deletePathsJob, deleteSftpJob, discardNativeSftpDragJob, extractJob, finishNativeSftpDragJob, getSftpJobFile, listSftpJobs, markSftpJobDelivered, moveJob, normalizeCompressionRequest, pauseSftpJob, receiveUploadJobContent, recordNativeSftpDragBytes, refreshSftpTransferQueues, resumeSftpJob, setNativeSftpDragCancelHandler, sftpCacheInfo, startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startUploadJob, startUploadReceiveJob, trackNativeSftpDragStream, waitForSftpTransferStart, __addUniqueByteRange: addUniqueByteRange, __buildCompressCommand: normalizeCompressionRequest, __buildCrossCopyOverwriteCommand: buildCrossCopyOverwriteCommand, __buildDeleteJobRequest: buildDeleteJobRequest, __consumeDeleteJobOutput: consumeDeleteJobOutput };
