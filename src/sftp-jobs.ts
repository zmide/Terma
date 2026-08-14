const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { notifyEvent } = require("./notifications");
const { buildDeleteRemotePathCommand, buildRecycleRemotePathCommand, invalidateRemoteDirectoryCache, readRemoteDirectorySize } = require("./sftp");
const { clearSftpDragCache, deliverSftpPaths, getSftpConnection, releaseNativeSftpDragTicket, sftpDragCacheInfo } = require("./sftp-session");
const { readSftpJobHistory, writeSftpJobHistoryAtomic } = require("./sftp-job-store");
const { createSftpDownloadCache } = require("./sftp-download-cache");
const { createSftpDownloadJobs } = require("./sftp-download-jobs");
const { filenameEncoding, remotePathOperand, shellQuote, spawnRemote } = require("./sftp-job-paths");
const { createNativeSftpDragJobs } = require("./sftp-native-drag-jobs");
const { buildCrossCopyOverwriteCommand, buildItemProgressJobCommand, crossCopyProgressEntries, normalizeCompressionRequest } = require("./sftp-operation-commands");
const { createSftpTransferScheduler } = require("./sftp-transfer-scheduler");
const { createSftpUploadJobs } = require("./sftp-upload-jobs");

const jobs = new Map();
const JOBS_FILE = path.join(DATA_DIR, "sftp-jobs.json");
const MAX_HISTORY = 120;
const ACTIVE_STATUSES = new Set(["running", "pending", "paused"]);
let historyCache: any[] | null = null;
let persistTimer: any = null;
let downloadCacheService: any = null;

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

function readHistory(): any[] {
  if (historyCache) return historyCache;
  const loaded = readSftpJobHistory(JOBS_FILE);
  const interruptedAt = Date.now();
  let changed = false;
  historyCache = loaded.map((source: any) => {
    const restored = serializableJob(source);
    if (Object.keys(restored).length !== Object.keys(source || {}).length) changed = true;
    if (!ACTIVE_STATUSES.has(restored?.status)) return restored;
    changed = true;
    const interrupted = {
      ...restored,
      status:"failed",
      error:"Terma 已重启，任务已中断",
      can_resume:false,
      speed_bps:0,
      average_bps:0,
      finished_at:interruptedAt,
      interrupted_at:interruptedAt
    };
    if (interrupted.type === "download") interrupted.delivery_status = "interrupted";
    cleanupJobArtifacts(interrupted);
    if (interrupted.type === "upload") cleanupRemoteUploadArtifact(interrupted);
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
      can_resume: ["upload", "download"].includes(job.type)
        && ["paused", "failed"].includes(job.status)
        && (job.type !== "upload" || (job.staged_complete && job.phase !== "receiving" && fs.existsSync(job.local_path || "")))
    };
  });
  const activeIds = new Set(active.map((job) => job.id));
  return [...active, ...readHistory().filter((job) => !activeIds.has(job.id))]
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
  const finish = (status, error = "") => {
    if (finished || job.status === "cancelled") return;
    finished = true;
    flushOutput();
    job.status = status;
    job.error = error;
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
    finish(code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`));
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
  const finish = (status, error = "") => {
    if (finished || job.status === "cancelled") return;
    finished = true;
    flushOutput();
    job.status = status;
    job.error = error;
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
    finish(code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`));
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
    job.error = "用户已取消";
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
  job.error = "用户已取消";
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
  if (job.type === "download") removeDownloadCacheFile(job);
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
  if (job.type === "upload") {
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
      if (hist.temp_path) try { fs.unlinkSync(hist.temp_path); } catch {}
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
  if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status };
  if (job.type === "upload" && job.phase === "receiving") throw new Error("文件接收阶段只能取消任务");
  if (job.type === "upload" && job.phase === "committing") return { ok:true, status:job.status };
  if (job.status !== "running") {
    removeQueuedTransfer(job);
    rejectTransferWaiters(job, new Error("任务已暂停"));
    job.status = "paused";
    job.can_pause = false;
    job.error = "";
    job.finished_at = null;
    job.speed_bps = 0;
    job.average_bps = 0;
    persistJobs(true);
    return { ok: true, status: job.status };
  }
  job.status = "paused";
  job.can_pause = false;
  job.error = "";
  job.finished_at = null;
  job.speed_bps = 0;
  job.average_bps = 0;
  persistJobs(true);
  if (job.type === "download" && typeof job.pauseNow === "function") {
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
  const job = jobs.get(id);
  if (!job) {
    const hist = readHistory().find((item) => item.id === id);
    if (!hist) throw new Error("任务不存在");
    return { ok: false, error: "历史任务无法恢复，请重新开始下载或上传" };
  }
  if (job.status === "running") return { ok: true, status: job.status };
  if (!["paused", "failed"].includes(job.status)) throw new Error(`当前状态（${job.status}）无法继续`);
  if (job.type === "download") {
    queueTransferJob("download", job, () => runDownloadJob(id, false), {phase:"preparing", current:"正在继续下载"});
    return { ok: true, status: job.status };
  }
  if (job.type === "upload") {
    resumeUploadJob(id);
    return { ok: true, status: job.status };
  }
  throw new Error("该任务类型暂不支持继续");
}

async function resolveCrossCopyProgressSize(job, sourceConnection, entries) {
  let total = 0;
  for (const entry of entries) {
    if (job.status !== "running") return;
    if (entry.type === "directory") {
      const result = await readRemoteDirectorySize(job.source_connection_id, entry.path);
      const size = result?.size ?? Number(result?.size_bytes || 0);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("跨主机复制内容过大，无法计算进度");
      total += size;
    } else if (entry.metadataKnown) {
      total += entry.size;
    } else {
      total += Number(await getRemoteSize(sourceConnection, entry.path));
    }
    if (!Number.isSafeInteger(total)) throw new Error("跨主机复制内容过大，无法计算进度");
  }
  if (job.status !== "running") return;
  job.size = total;
  job.size_known = true;
  job.progress_known = true;
  job.progress_estimated = true;
  updateTransferProgress(job);
  persistJobs(true);
}

function crossCopyJob(sourceConnectionId, targetConnectionId, paths, targetDir = ".", conflictMode = "error", entries: any[] = []) {
  const sourceConnection = getSftpConnection(sourceConnectionId);
  const targetConnection = getSftpConnection(targetConnectionId);
  const sameConnection = Number(sourceConnectionId) === Number(targetConnectionId);
  if (filenameEncoding(sourceConnection) !== filenameEncoding(targetConnection)) {
    throw new Error("源主机和目标主机的 SFTP 文件名编码必须一致，避免复制后文件名乱码");
  }
  const normalized: string[] = [...new Set<string>((paths || []).map((item) => path.posix.normalize(String(item || "").replace(/\\/g, "/"))).filter(Boolean))];
  if (!normalized.length) throw new Error("请选择要复制的文件或目录");
  if (normalized.length > 200 || normalized.some((item) => item.includes("\0") || item === "." || item === ".." || item.startsWith("../") || item.length > 4096)) {
    throw new Error("复制路径无效或数量过多");
  }
  const parent = path.posix.dirname(normalized[0]) || ".";
  if (normalized.some((item) => (path.posix.dirname(item) || ".") !== parent)) throw new Error("复制的项目必须位于同一目录");
  const names = normalized.map((item) => path.posix.basename(item));
  const progressEntries = crossCopyProgressEntries(normalized, entries);
  const initialSizeCandidate = progressEntries.reduce((total, entry) => total + entry.size, 0);
  const initialSizeKnown = progressEntries.every(entry => entry.type === "file" && entry.metadataKnown)
    && Number.isSafeInteger(initialSizeCandidate);
  const initialSize = initialSizeKnown ? initialSizeCandidate : 0;
  const conflict = ["error", "overwrite", "rename"].includes(String(conflictMode || "")) ? String(conflictMode) : "error";
  const normalizedTargetDir = path.posix.normalize(String(targetDir || ".").replace(/\\/g, "/")) || ".";
  if (sameConnection) {
    const targetInsideSource = normalized.some((sourcePath) => normalizedTargetDir === sourcePath || normalizedTargetDir.startsWith(`${sourcePath}/`));
    if (targetInsideSource) throw new Error("不能把远端项目复制到自身或其子目录");
    const copiesOntoSource = normalized.some((sourcePath) => path.posix.join(normalizedTargetDir, path.posix.basename(sourcePath)) === sourcePath);
    if (copiesOntoSource && conflict !== "rename") throw new Error("源和目标是同一项目，请选择自动改名或取消");
  }
  const sourceNames = names.map((name) => remotePathOperand(sourceConnection, `./${name}`)).join(" ");
  const collisionChecks = names.map((name) => {
    const operand = remotePathOperand(targetConnection, `./${name}`);
    return `if [ -e ${operand} ] || [ -L ${operand} ]; then echo "目标目录已存在同名项目" >&2; exit 1; fi`;
  }).join("; ");
  const sourceCommand = `tar -cf - -C ${remotePathOperand(sourceConnection, parent)} -- ${sourceNames}`;
  let targetCommand = `cd ${remotePathOperand(targetConnection, targetDir)} && ${collisionChecks} && tar -xf -`;
  if (conflict === "overwrite") {
    targetCommand = buildCrossCopyOverwriteCommand(targetConnection, targetDir, names);
  } else if (conflict === "rename") {
    if (filenameEncoding(targetConnection) !== "utf8") throw new Error("非 UTF-8 文件名编码暂不支持自动改名，请选择覆盖或取消");
    const temporaryName = `.terma-cross-copy-${crypto.randomUUID()}`;
    const moves = names.map((name) => {
      const extension = path.posix.extname(name);
      const base = extension && extension !== name ? name.slice(0, -extension.length) : name;
      return [
        `td_source="$td_tmp/"${shellQuote(name)}`,
        `td_target=${shellQuote(name)}`,
        `td_index=1`,
        `while [ -e "$td_target" ] || [ -L "$td_target" ]; do td_target=${shellQuote(base)}" ($td_index)"${shellQuote(extension)}; td_index=$((td_index + 1)); done`,
        `mv -- "$td_source" "$td_target"`
      ].join("; ");
    }).join("; ");
    targetCommand = `cd ${remotePathOperand(targetConnection, targetDir)} && td_tmp=${shellQuote(temporaryName)} && mkdir "$td_tmp" && trap 'rm -rf -- "$td_tmp"' 0 1 2 3 15 && tar -xf - -C "$td_tmp" && ${moves} && rmdir "$td_tmp" && trap - 0 1 2 3 15`;
  }
  const source = spawnRemote(sourceConnection, sourceCommand);
  const target = spawnRemote(targetConnection, targetCommand);
  const id = crypto.randomUUID();
  const job: any = {
    id,
    connection_id: Number(targetConnectionId),
    connection_name: targetConnection.name,
    source_connection_id: Number(sourceConnectionId),
    source_connection_name: sourceConnection.name,
    target_connection_id: Number(targetConnectionId),
    type: "cross-copy",
    label: sameConnection ? `复制 ${normalized.length} 项` : `从 ${sourceConnection.name} 复制 ${normalized.length} 项`,
    status: "running",
    stdout: "",
    stderr: "",
    error: "",
    size: initialSize,
    size_known: initialSizeKnown,
    progress_known: initialSizeKnown,
    progress_estimated: initialSizeKnown,
    transferred: 0,
    progress: 0,
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: null,
    child: source,
    responder: target
  };
  resetTransferSpeed(job);
  jobs.set(id, job);
  persistJobs();
  if (!initialSizeKnown) {
    void resolveCrossCopyProgressSize(job, sourceConnection, progressEntries).catch(() => {});
  }
  let sourceCode = null;
  let targetCode = null;
  let finished = false;
  const finish = (status, error = "") => {
    if (finished || job.status === "cancelled") return;
    finished = true;
    if (status !== "done") {
      try { source.kill("SIGTERM"); } catch {}
      try { target.kill("SIGTERM"); } catch {}
    }
    job.status = status;
    job.error = error;
    job.finished_at = Date.now();
    if (status === "done") {
      if (!job.size_known) job.size = job.transferred;
      job.size_known = true;
      job.progress_known = true;
      job.progress = 100;
    }
    finishTransferMetrics(job);
    persistJobs(true);
    notifyEvent({
      type: "sftp",
      level: status === "done" ? "success" : "error",
      title: status === "done" ? (sameConnection ? "SFTP 复制已完成" : "跨主机复制已完成") : (sameConnection ? "SFTP 复制失败" : "跨主机复制失败"),
      message: `${sameConnection ? targetConnection.name : `${sourceConnection.name} → ${targetConnection.name}`} · ${normalized.length} 项${error ? `\n${error}` : ""}`,
      action: { view: "sftp", connection_id: Number(targetConnectionId) }
    }, { cooldown_ms: 0 });
  };
  const maybeFinish = () => {
    if (sourceCode === null || targetCode === null) return;
    if (sourceCode === 0 && targetCode === 0) finish("done");
    else finish("failed", job.stderr || `源主机退出码 ${sourceCode}，目标主机退出码 ${targetCode}`);
  };
  source.stdout.on("data", (chunk) => { recordTransferred(job, chunk.length); persistJobs(); });
  source.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${sourceConnection.name}: ${chunk.toString()}`.slice(-12000); persistJobs(); });
  target.stdout.on("data", (chunk) => { job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000); persistJobs(); });
  target.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${targetConnection.name}: ${chunk.toString()}`.slice(-12000); persistJobs(); });
  source.on("error", (error) => finish("failed", `${sourceConnection.name}: ${error.message}`));
  target.on("error", (error) => finish("failed", `${targetConnection.name}: ${error.message}`));
  target.stdin.on("error", (error) => finish("failed", `${targetConnection.name}: ${error.message}`));
  source.on("close", (code) => { sourceCode = code; maybeFinish(); });
  target.on("close", (code) => { targetCode = code; maybeFinish(); });
  source.stdout.pipe(target.stdin);
  return { id, status: job.status, type: job.type, connection_id: Number(targetConnectionId) };
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

function extractJob(connectionId, remotePath, targetDir) {
  const connection = getSftpConnection(connectionId);
  const lower = String(remotePath || "").toLowerCase();
  let command;
  if (lower.endsWith(".zip")) command = `cd ${remotePathOperand(connection, targetDir)} && unzip -o ${remotePathOperand(connection, remotePath)}`;
  else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) command = `cd ${remotePathOperand(connection, targetDir)} && tar -xzf ${remotePathOperand(connection, remotePath)}`;
  else if (lower.endsWith(".tar")) command = `cd ${remotePathOperand(connection, targetDir)} && tar -xf ${remotePathOperand(connection, remotePath)}`;
  else throw new Error("暂只支持 zip、tar.gz、tgz、tar 解压");
  return startSftpJob(connectionId, "extract", command, `解压 ${remotePath}`);
}

function compressJob(connectionId, paths, targetDir = ".", archiveName = "") {
  const connection = getSftpConnection(connectionId);
  const request = normalizeCompressionRequest(paths, targetDir, archiveName, connection);
  return { ...startSftpJob(connectionId, "compress", request.command, `压缩 ${request.paths.length} 项为 ${request.name}`), output:request.output };
}

module.exports = { beginNativeSftpDragJob, cancelSftpJob, clearFinishedSftpJobs, clearSftpCache, compressJob, copyJob, crossCopyJob, deletePathsJob, deleteSftpJob, discardNativeSftpDragJob, extractJob, finishNativeSftpDragJob, getSftpJobFile, listSftpJobs, markSftpJobDelivered, moveJob, normalizeCompressionRequest, pauseSftpJob, receiveUploadJobContent, recordNativeSftpDragBytes, refreshSftpTransferQueues, resumeSftpJob, setNativeSftpDragCancelHandler, sftpCacheInfo, startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startUploadJob, startUploadReceiveJob, trackNativeSftpDragStream, waitForSftpTransferStart, __addUniqueByteRange: addUniqueByteRange, __buildCompressCommand: normalizeCompressionRequest, __buildCrossCopyOverwriteCommand: buildCrossCopyOverwriteCommand, __buildDeleteJobRequest: buildDeleteJobRequest, __consumeDeleteJobOutput: consumeDeleteJobOutput };
