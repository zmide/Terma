const crypto = require("node:crypto");
const fs = require("node:fs");
const iconv = require("iconv-lite");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { notifyEvent } = require("./notifications");
const { buildDeleteRemotePathCommand, buildRecycleRemotePathCommand, invalidateRemoteDirectoryCache, readRemoteDirectorySize } = require("./sftp");
const { clearSftpDragCache, deliverSftpPaths, getSftpConnection, releaseNativeSftpDragTicket, sftpDragCacheInfo, spawnSftpSessionCommand } = require("./sftp-session");
const { readSftpJobHistory, writeSftpJobHistoryAtomic } = require("./sftp-job-store");

const jobs = new Map();
const nativeDragJobIds = new Map();
const closedNativeDragTokens = new Map();
const JOBS_FILE = path.join(DATA_DIR, "sftp-jobs.json");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const MAX_HISTORY = 120;
const DOWNLOAD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BROWSER_DELIVERY_GRACE_MS = 10 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["running", "pending", "paused"]);
const NATIVE_DRAG_DISCARD_TTL_MS = 5 * 60 * 1000;
let historyCache: any[] | null = null;
let persistTimer: any = null;
let downloadCacheMaintained = false;
let nativeDragCancelHandler: any = null;

function setNativeSftpDragCancelHandler(handler) {
  nativeDragCancelHandler = typeof handler === "function" ? handler : null;
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
  if (!downloadCacheMaintained) {
    downloadCacheMaintained = true;
    maintainDownloadCache();
  }
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

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

const FILENAME_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function filenameEncoding(connection) {
  const encoding = String(connection?.sftp_filename_encoding || "utf8").toLowerCase();
  return FILENAME_ENCODINGS.has(encoding) ? encoding : "utf8";
}

function remotePathOperand(connection, value) {
  const text = String(value || "");
  const encoding = filenameEncoding(connection);
  if (encoding === "utf8") return shellQuote(text);
  const bytes = iconv.encode(text, encoding);
  if (iconv.decode(bytes, encoding) !== text) throw new Error(`文件名包含 ${encoding} 无法表示的字符`);
  const octal = [...bytes].map((byte) => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
  return `"$(printf '%b' ${shellQuote(octal)})"`;
}

function spawnRemote(connection, command) {
  const portableCommand = `sh -c ${shellQuote(command)}`;
  return spawnSftpSessionCommand(connection, portableCommand);
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

function removeDownloadCacheFile(job) {
  if (!job?.temp_path) return false;
  try { fs.unlinkSync(job.temp_path); } catch (error) { if (error?.code !== "ENOENT") return false; }
  job.temp_path = "";
  return true;
}

function maintainDownloadCache(now = Date.now()) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive:true });
  const history = historyCache || [];
  const referenced = new Set();
  let changed = false;
  for (const job of [...jobs.values(), ...history]) {
    if (job?.type !== "download" || !job.temp_path) continue;
    const delivered = ["saved", "delivered"].includes(job.delivery_status);
    const deliveryGraceExpired = job.delivery_status !== "delivered"
      || now - Number(job.delivered_at || 0) >= BROWSER_DELIVERY_GRACE_MS;
    const expired = ["done", "cancelled"].includes(job.status)
      && now - Number(job.finished_at || job.created_at || now) >= DOWNLOAD_CACHE_TTL_MS;
    if ((delivered && deliveryGraceExpired) || job.status === "cancelled" || expired) {
      if (removeDownloadCacheFile(job)) changed = true;
      if (expired && !delivered) {
        job.delivery_status = "expired";
        job.cache_expired_at = now;
      }
      continue;
    }
    referenced.add(path.resolve(job.temp_path));
  }
  try {
    for (const entry of fs.readdirSync(DOWNLOADS_DIR, {withFileTypes:true})) {
      if (!entry.isFile()) continue;
      const file = path.resolve(DOWNLOADS_DIR, entry.name);
      if (!referenced.has(file)) try { fs.unlinkSync(file); } catch {}
    }
  } catch {}
  if (changed && historyCache) historyCache = writeSftpJobHistoryAtomic(JOBS_FILE, historyCache, MAX_HISTORY);
}

const downloadCacheTimer = setInterval(() => maintainDownloadCache(), 60 * 60 * 1000);
downloadCacheTimer.unref?.();

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

function addUniqueByteRange(ranges, start, end) {
  const first = Math.max(0, Number(start || 0));
  const last = Math.max(first - 1, Number(end ?? first - 1));
  if (last < first) return 0;
  const before = ranges.reduce((total, range) => total + range[1] - range[0] + 1, 0);
  const merged = [];
  let nextStart = first;
  let nextEnd = last;
  let inserted = false;
  for (const range of ranges) {
    if (range[1] + 1 < nextStart) {
      merged.push(range);
      continue;
    }
    if (nextEnd + 1 < range[0]) {
      if (!inserted) merged.push([nextStart, nextEnd]);
      inserted = true;
      merged.push(range);
      continue;
    }
    nextStart = Math.min(nextStart, range[0]);
    nextEnd = Math.max(nextEnd, range[1]);
  }
  if (!inserted) merged.push([nextStart, nextEnd]);
  ranges.splice(0, ranges.length, ...merged);
  const after = ranges.reduce((total, range) => total + range[1] - range[0] + 1, 0);
  return Math.max(0, after - before);
}

function markNativeSftpDragClosed(token) {
  const key = String(token || "");
  if (!key) return;
  const previous = closedNativeDragTokens.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => closedNativeDragTokens.delete(key), NATIVE_DRAG_DISCARD_TTL_MS);
  timer.unref?.();
  closedNativeDragTokens.set(key, timer);
}

function beginNativeSftpDragJob(token, ticket) {
  const key = String(token || "");
  if (closedNativeDragTokens.has(key)) return { id:"", status:"discarded" };
  const existingId = nativeDragJobIds.get(key);
  if (existingId && jobs.has(existingId)) return { id:existingId, status:jobs.get(existingId).status };
  const connectionId = Number(ticket?.connection_id || 0);
  const connection = getSftpConnection(connectionId);
  const topLevel = Array.isArray(ticket?.top_level) ? ticket.top_level : [];
  const entries = Array.isArray(ticket?.entries) ? ticket.entries : [];
  const names = topLevel.map(item => String(item?.name || "")).filter(Boolean);
  const label = names.length === 1
    ? `拖出 ${names[0]} 到本机`
    : `拖出 ${Math.max(1, names.length)} 项到本机`;
  const manifestReady = Boolean(ticket?.ready && Array.isArray(ticket?.entries));
  const topLevelSizeKnown = topLevel.length > 0 && topLevel.every(entry => (
    entry?.type === "file"
    && entry?.metadata_known === true
    && Number.isFinite(Number(entry?.size))
  ));
  const sizeKnown = manifestReady || topLevelSizeKnown;
  const sizedEntries = manifestReady ? entries : topLevel;
  const measuredSize = sizedEntries.reduce((total, entry) => (
    entry?.type === "file" ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
  const size = sizeKnown ? measuredSize : 0;
  const id = crypto.randomUUID();
  const job: any = {
    id,
    connection_id:connectionId,
    connection_name:connection.name,
    type:"native-drag",
    label,
    status:"running",
    phase:"system-saving",
    can_cancel:true,
    can_pause:false,
    stdout:"",
    stderr:"",
    error:"",
    size,
    size_known:sizeKnown,
    progress_known:sizeKnown,
    progress_unit:"bytes",
    transferred:0,
    progress:0,
    item_count:topLevel.length,
    delivery_mode:"native-drag",
    native_drag_token:key,
    native_drag_ranges:new Map(),
    streams:new Set(),
    created_at:Date.now(),
    started_at:Date.now(),
    finished_at:null
  };
  resetTransferSpeed(job);
  jobs.set(id, job);
  nativeDragJobIds.set(key, id);
  persistJobs();
  return { id, status:job.status };
}

function recordNativeSftpDragBytes(token, bytes) {
  const key = String(token || "");
  const jobId = nativeDragJobIds.get(key);
  const job = jobId ? jobs.get(jobId) : null;
  if (!job || job.status !== "running") return {ok:false, status:job?.status || "missing"};
  const requested = Math.max(0, Math.floor(Number(bytes || 0)));
  const remaining = job.size_known
    ? Math.max(0, Number(job.size || 0) - Number(job.transferred || 0))
    : requested;
  const added = Math.min(requested, remaining);
  if (added > 0) {
    recordTransferred(job, added);
    persistJobs();
  }
  return {
    ok:true,
    status:job.status,
    transferred:Number(job.transferred || 0),
    progress:Number(job.progress || 0)
  };
}

function trackNativeSftpDragStream(token, index, opened) {
  const key = String(token || "");
  const jobId = nativeDragJobIds.get(key);
  const job = jobId ? jobs.get(jobId) : null;
  if (!job || job.status !== "running") {
    try { opened?.stream?.destroy(new Error("SFTP 拖出任务已取消")); } catch {}
    throw new Error("SFTP 拖出任务已取消");
  }
  const stream = opened?.stream;
  if (!stream?.on) throw new Error("SFTP 拖出读取流无效");
  job.streams.add(stream);
  const rangeKey = String(index);
  const ranges = job.native_drag_ranges.get(rangeKey) || [];
  job.native_drag_ranges.set(rangeKey, ranges);
  let offset = Math.max(0, Number(opened.start || 0));
  let closed = false;
  const detach = () => {
    if (closed) return;
    closed = true;
    job.streams.delete(stream);
  };
  stream.on("data", (chunk) => {
    const length = Number(chunk?.length || 0);
    if (length <= 0) return;
    const end = offset + length - 1;
    const added = addUniqueByteRange(ranges, offset, end);
    offset = end + 1;
    if (job.status !== "running" || added <= 0) return;
    recordTransferred(job, added);
    if (job.size) job.transferred = Math.min(job.size, job.transferred);
    persistJobs();
  });
  stream.once("end", detach);
  stream.once("close", detach);
  stream.once("error", detach);
  return { id:job.id, status:job.status };
}

function finishNativeSftpDragJob(token, status, error = "") {
  const key = String(token || "");
  markNativeSftpDragClosed(key);
  const id = nativeDragJobIds.get(key);
  const job = id ? jobs.get(id) : null;
  if (!job) return { ok:false, status:"missing" };
  if (job.status === "cancelled") {
    nativeDragJobIds.delete(key);
    return { ok:true, status:job.status };
  }
  const requestedStatus = ["done", "cancelled", "failed"].includes(status) ? status : "failed";
  const incomplete = requestedStatus === "done"
    && Number(job.size || 0) > 0
    && Number(job.transferred || 0) < Number(job.size || 0);
  const finalStatus = incomplete ? "cancelled" : requestedStatus;
  if (finalStatus !== "done") {
    for (const stream of job.streams) {
      try { stream.destroy(); } catch {}
    }
  }
  job.streams.clear();
  job.status = finalStatus;
  job.phase = "";
  job.can_cancel = false;
  job.can_pause = false;
  job.error = finalStatus === "done"
    ? ""
    : String(error || (incomplete ? "目标端未读取完整内容" : finalStatus === "cancelled" ? "用户已取消" : "拖出下载失败"));
  job.finished_at = Date.now();
  if (finalStatus === "done") {
    job.transferred = job.size || job.transferred;
    job.progress = 100;
  }
  finishTransferMetrics(job);
  nativeDragJobIds.delete(key);
  persistJobs(true);
  notifyEvent({
    type:"sftp",
    level:finalStatus === "done" ? "success" : finalStatus === "failed" ? "error" : "info",
    title:finalStatus === "done" ? "SFTP 拖出已完成" : finalStatus === "failed" ? "SFTP 拖出失败" : "SFTP 拖出已取消",
    message:`${job.connection_name} · ${job.label}${job.error ? `\n${job.error}` : ""}`,
    action:{view:"sftp", connection_id:job.connection_id}
  }, {cooldown_ms:0});
  return { ok:true, status:job.status };
}

function discardNativeSftpDragJob(token) {
  const key = String(token || "");
  markNativeSftpDragClosed(key);
  const id = nativeDragJobIds.get(key);
  const job = id ? jobs.get(id) : null;
  if (!job) return { ok:true, status:"discarded" };
  for (const stream of job.streams || []) {
    try { stream.destroy(); } catch {}
  }
  job.streams?.clear?.();
  nativeDragJobIds.delete(key);
  jobs.delete(id);
  writeJsonJobs(readHistory().filter((item: any) => item.id !== id));
  return { ok:true, status:"discarded" };
}

function uploadJobResult(job) {
  return {
    id:job.id,
    status:job.status,
    type:job.type,
    phase:job.phase,
    connection_id:job.connection_id,
    connection_name:job.connection_name,
    remote_path:job.remote_path
  };
}

function createUploadJob(connectionId, localPath, remotePath, size = 0, phase = "uploading", options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const id = crypto.randomUUID();
  const normalizedRemotePath = String(remotePath || "").replace(/\\/g, "/");
  const remoteParent = path.posix.dirname(normalizedRemotePath);
  const remoteTempName = `.terma-upload-${id}.part`;
  const remoteTempPath = remoteParent === "/"
    ? `/${remoteTempName}`
    : remoteParent === "."
      ? remoteTempName
      : `${remoteParent.replace(/\/+$/, "")}/${remoteTempName}`;
  const job: any = {
    id,
    connection_id:Number(connectionId),
    connection_name:connection.name,
    type:"upload",
    phase,
    can_pause:phase === "uploading",
    label:`上传 ${path.basename(remotePath || localPath || "文件")}`,
    status:"running",
    stdout:"",
    stderr:"",
    error:"",
    size:Math.max(0, Number(size || 0)),
    size_known:options.sizeKnown !== false,
    progress_known:options.sizeKnown !== false,
    two_stage_upload:phase === "receiving",
    transferred:0,
    received_bytes:0,
    progress:0,
    remote_path:remotePath,
    remote_temp_path:remoteTempPath,
    upload_generation:0,
    local_path:localPath,
    staged_complete:phase === "uploading",
    created_at:Date.now(),
    started_at:Date.now(),
    finished_at:null
  };
  resetTransferSpeed(job);
  return job;
}

function uploadRemoteWriteCommand(connection, job, append = false) {
  const operator = append ? ">>" : ">";
  return `cat ${operator} ${remotePathOperand(connection, job.remote_temp_path)}`;
}

function uploadRemoteCommitCommand(connection, job) {
  const temporary = remotePathOperand(connection, job.remote_temp_path);
  const target = remotePathOperand(connection, job.remote_path);
  const expectedSize = Math.max(0, Number(job.size || 0));
  return [
    `if [ ! -f ${temporary} ]; then echo "远端上传暂存文件不存在" >&2; exit 1; fi`,
    expectedSize
      ? `td_upload_size=$(wc -c < ${temporary} | tr -d '[:space:]'); if [ "$td_upload_size" != ${shellQuote(String(expectedSize))} ]; then echo "远端上传内容不完整" >&2; exit 1; fi`
      : "",
    `if [ -d ${target} ]; then echo "目标路径是目录，无法覆盖" >&2; exit 1; fi`,
    job.conflict_mode === "overwrite"
      ? ""
      : `if [ -e ${target} ] || [ -L ${target} ]; then echo "目标目录已存在同名项目" >&2; exit 1; fi`,
    `${job.conflict_mode === "overwrite" ? "mv -f" : "mv"} -- ${temporary} ${target}`
  ].filter(Boolean).join(" && ");
}

function cleanupRemoteUploadArtifact(job) {
  if (!job?.remote_temp_path || !job?.connection_id) return;
  try {
    const connection = getSftpConnection(job.connection_id);
    const child = spawnRemote(connection, `rm -f -- ${remotePathOperand(connection, job.remote_temp_path)}`);
    child.on("error", () => {});
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end();
  } catch {}
}

function finishUploadTransfer(job, status, error = "") {
  if (ignoreStoppedTransferFinish(job, status)) return;
  if (job.finished_at && status !== "paused") return;
  job.status = status;
  job.error = error || "";
  if (status !== "paused") {
    job.finished_at = Date.now();
    job.can_pause = false;
  }
  if (status === "done") {
    job.transferred = job.size || job.transferred;
    job.progress = 100;
    try { fs.unlinkSync(job.local_path); } catch {}
    invalidateRemoteDirectoryCache(job.connection_id);
  }
  if (status !== "paused") finishTransferMetrics(job);
  persistJobs(status !== "paused");
  if (status !== "paused") {
    notifyEvent({
      type:"sftp",
      level:status === "done" ? "success" : "error",
      title:status === "done" ? "SFTP 上传已完成" : "SFTP 上传失败",
      message:`${job.connection_name} · ${job.label}${job.error ? `\n${job.error}` : ""}`,
      action:{ view:"sftp", connection_id:job.connection_id }
    }, { cooldown_ms:0 });
  }
}

function commitUploadTransfer(job, generation) {
  if (!job || job.status !== "running" || Number(job.upload_generation || 0) !== Number(generation)) return;
  const connection = getSftpConnection(job.connection_id);
  const child = spawnRemote(connection, uploadRemoteCommitCommand(connection, job));
  job.child = child;
  job.stream = null;
  job.phase = "committing";
  job.can_pause = false;
  updateTransferProgress(job);
  persistJobs(true);
  child.stdout.on("data", (chunk) => { job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.on("error", (error) => {
    if (Number(job.upload_generation || 0) !== Number(generation)) return;
    finishUploadTransfer(job, "failed", error.message);
  });
  child.on("close", (code, signal) => {
    if (Number(job.upload_generation || 0) !== Number(generation)) return;
    if (job.status === "cancelled" || job.status === "paused") return;
    finishUploadTransfer(job, code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`));
  });
  child.stdin.end();
}

function finishUploadReceiveFailure(job, error) {
  if (!job || job.status === "cancelled") return;
  job.status = "failed";
  job.can_pause = false;
  job.error = error?.message || String(error || "文件接收失败");
  job.finished_at = Date.now();
  finishTransferMetrics(job);
  cleanupJobArtifacts(job);
  persistJobs(true);
}

function startUploadTransfer(job, offset = 0, generation = 0) {
  const connection = getSftpConnection(job.connection_id);
  if (!job.size && job.local_path && fs.existsSync(job.local_path)) job.size = fs.statSync(job.local_path).size;
  const transferred = Math.max(0, Number(offset || 0));
  const runGeneration = generation || Math.max(0, Number(job.upload_generation || 0)) + 1;
  job.upload_generation = runGeneration;
  const child = spawnRemote(connection, uploadRemoteWriteCommand(connection, job, transferred > 0));
  const stream = fs.createReadStream(job.local_path, transferred > 0 ? {start:transferred} : {});
  job.child = child;
  job.stream = stream;
  job.status = "running";
  job.phase = "uploading";
  job.can_pause = true;
  job.staged_complete = true;
  job.transferred = transferred;
  updateTransferProgress(job);
  job.error = "";
  job.finished_at = null;
  resetTransferSpeed(job);
  persistJobs(true);

  stream.on("data", (chunk) => {
    if (Number(job.upload_generation || 0) !== runGeneration || job.status !== "running" || job.phase !== "uploading") return;
    recordTransferred(job, chunk.length);
    persistJobs();
  });
  stream.on("error", (error) => {
    if (Number(job.upload_generation || 0) !== runGeneration) return;
    try { child.kill("SIGKILL"); } catch {}
    finishUploadTransfer(job, "failed", error.message);
  });
  child.stdout.on("data", (chunk) => { job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.on("error", (error) => {
    if (Number(job.upload_generation || 0) !== runGeneration) return;
    finishUploadTransfer(job, "failed", error.message);
  });
  child.on("close", (code, signal) => {
    if (Number(job.upload_generation || 0) !== runGeneration) return;
    if (job.status === "cancelled") {
      cleanupRemoteUploadArtifact(job);
      return;
    }
    if (job.status === "paused") return;
    if (code === 0) return commitUploadTransfer(job, runGeneration);
    finishUploadTransfer(job, "failed", job.stderr || `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`);
  });
  stream.pipe(child.stdin);
  return uploadJobResult(job);
}

function startUploadJob(connectionId, localPath, remotePath, size = 0) {
  const job = createUploadJob(connectionId, localPath, remotePath, size, "uploading", {sizeKnown:true});
  job.conflict_mode = "overwrite";
  jobs.set(job.id, job);
  persistJobs(true);
  return startUploadTransfer(job);
}

function startUploadReceiveJob(connectionId, remotePath, filename, size = 0, options: any = {}) {
  const directory = path.join(DATA_DIR, "uploads");
  fs.mkdirSync(directory, {recursive:true});
  const safeName = path.basename(String(filename || "upload.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "upload.bin";
  const localPath = path.join(directory, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`);
  const job = createUploadJob(connectionId, localPath, remotePath, size, "receiving", {sizeKnown:options.sizeKnown !== false});
  job.conflict_mode = options.conflict === "overwrite" ? "overwrite" : "error";
  jobs.set(job.id, job);
  persistJobs(true);
  return uploadJobResult(job);
}

function uploadReceiveCancelledError() {
  const error: any = new Error("上传已取消");
  error.code = "SFTP_UPLOAD_CANCELLED";
  return error;
}

function receiveUploadJobContent(id, request) {
  const job = jobs.get(id);
  if (!job || job.type !== "upload") throw new Error("上传任务不存在");
  if (job.status === "cancelled") throw uploadReceiveCancelledError();
  if (job.status !== "running" || job.phase !== "receiving" || job.receive_token) throw new Error("当前上传任务无法接收文件内容");
  const declaredSize = Math.max(0, Number(request?.headers?.["content-length"] || 0));
  const declaredSizeKnown = request?.headers?.["content-length"] !== undefined;
  if (job.size > 0 && declaredSize > 0 && declaredSize !== job.size) {
    const error = new Error(`文件大小不一致：应为 ${job.size} 字节，实际 ${declaredSize} 字节`);
    finishUploadReceiveFailure(job, error);
    throw error;
  }
  if (!job.size && declaredSize) job.size = declaredSize;
  if (declaredSizeKnown) {
    job.size_known = true;
    job.progress_known = true;
  }

  const token = {};
  const out = fs.createWriteStream(job.local_path, {flags:"wx"});
  job.receive_token = token;
  job.responder = request;
  job.out = out;
  persistJobs(true);

  return new Promise((resolve, reject) => {
    let settled = false;
    let received = 0;
    const clearHandles = () => {
      if (job.receive_token !== token) return;
      job.receive_token = null;
      job.responder = null;
      job.out = null;
    };
    const fail = (source) => {
      if (settled) return;
      settled = true;
      try { request.unpipe(out); } catch {}
      try { out.destroy(); } catch {}
      clearHandles();
      if (job.status === "cancelled") {
        cleanupJobArtifacts(job);
        persistJobs(true);
        reject(uploadReceiveCancelledError());
        return;
      }
      const error = source instanceof Error ? source : new Error(String(source || "文件接收失败"));
      finishUploadReceiveFailure(job, error);
      reject(error);
    };
    const complete = () => {
      if (settled) return;
      if (job.status === "cancelled") return fail(uploadReceiveCancelledError());
      const expected = Math.max(0, Number(job.size || declaredSize || 0));
      if (expected && received !== expected) return fail(new Error(`文件接收不完整：应为 ${expected} 字节，实际 ${received} 字节`));
      settled = true;
      clearHandles();
      job.size = expected || received;
      job.size_known = true;
      job.progress_known = true;
      job.received_bytes = received;
      job.staged_complete = true;
      try {
        resolve(startUploadTransfer(job));
      } catch (error) {
        finishUploadReceiveFailure(job, error);
        reject(error);
      }
    };
    request.on("data", (chunk) => {
      if (job.receive_token !== token || job.status !== "running") return;
      received += Number(chunk?.length || 0);
      job.received_bytes = received;
      recordTransferred(job, Number(chunk?.length || 0));
      persistJobs();
    });
    request.once("aborted", () => fail(new Error("文件接收连接已中断")));
    request.once("error", fail);
    out.once("error", fail);
    out.once("finish", complete);
    out.once("close", () => {
      if (!settled && !out.writableFinished) fail(new Error("文件接收连接已关闭"));
    });
    if (request.aborted || request.destroyed) {
      fail(new Error("文件接收连接已中断"));
      return;
    }
    request.pipe(out);
  });
}

function cancelSftpJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const persisted = readHistory().find((item: any) => item.id === id);
    if (persisted) return { ok:true, status:persisted.status };
    throw new Error("任务不存在");
  }
  if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status };
  if (job.type === "upload" && job.phase === "committing") return { ok:true, status:job.status, phase:job.phase };
  if (job.type === "native-drag" && job.native_drag_token) {
    if (job.phase === "cancelling") {
      return {ok:true, status:job.status, phase:job.phase, can_cancel:false};
    }
    let accepted = false;
    try {
      accepted = Boolean(nativeDragCancelHandler?.(String(job.native_drag_token)));
    } catch {}
    if (!accepted) {
      return {
        ok:false,
        status:job.status,
        phase:job.phase,
        can_cancel:true,
        code:"NATIVE_DRAG_CANCEL_REJECTED",
        message:"系统暂未接受停止请求，传输仍在继续"
      };
    }
    if (!ACTIVE_STATUSES.has(job.status)) {
      return {ok:true, status:job.status, phase:job.phase || "", can_cancel:false};
    }
    // The target file manager still owns the IDataObject/FUSE/File Promise
    // read. Keep the streams and ticket alive until its native terminal
    // callback confirms cancellation; tearing them down here turns a user
    // cancellation into a disk, HTTP, or FUSE read error.
    job.phase = "cancelling";
    job.can_cancel = false;
    job.can_pause = false;
    job.error = "";
    job.speed_bps = 0;
    persistJobs(true);
    return {ok:true, status:job.status, phase:job.phase, can_cancel:false};
  }
  const uploadPhase = job.type === "upload" ? job.phase : "";
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

function getRemoteSize(connection, remotePath) {
  const child = spawnRemote(connection, `wc -c < ${remotePathOperand(connection, remotePath)} | tr -d ' '`);
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(new Error("获取远程文件大小超时")); }, 15000);
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `读取远程文件大小失败（退出码 ${code ?? "?"}）`));
      const size = Number((out || "").trim());
      resolve(Number.isFinite(size) ? size : 0);
    });
  });
}

function safeLocalFilename(value) {
  const source = String(value || "download");
  const normalized = process.platform === "win32"
    ? source.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "")
    : source.replace(/[\x00/]/g, "_");
  return normalized || "download";
}

function availableLocalPath(directory, filename) {
  const parsed = path.parse(safeLocalFilename(filename));
  let target = path.join(directory, `${parsed.name}${parsed.ext}`);
  for (let index = 1; fs.existsSync(target); index += 1) target = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
  return target;
}

function autoSaveDownloadedFile(job) {
  const directory = String(job.auto_save_directory || "").trim();
  if (!directory || !job.temp_path || !fs.existsSync(job.temp_path)) return;
  try {
    fs.mkdirSync(directory, { recursive:true });
    const target = availableLocalPath(directory, job.download_name || path.posix.basename(job.remote_path || "download"));
    try {
      fs.renameSync(job.temp_path, target);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      fs.copyFileSync(job.temp_path, target, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(job.temp_path);
    }
    job.saved_path = target;
    job.delivery_status = "saved";
    job.delivered_at = Date.now();
    job.temp_path = "";
  } catch (error) {
    job.delivery_status = "failed";
    job.delivery_error = error.message || String(error);
  }
}

function startLocalDeliveryJob(connectionId, remotePaths, targetDirectory, conflictMode = "rename", options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const paths = Array.isArray(remotePaths) ? remotePaths.map(item => String(item || "")).filter(Boolean) : [];
  const id = crypto.randomUUID();
  const names = paths.map(item => path.posix.basename(item.replace(/\\/g, "/").replace(/\/+$/, "")) || "download");
  const label = String(options.label || (names.length === 1 ? `下载 ${names[0]} 到本机` : `下载 ${Math.max(1, names.length)} 项到本机`));
  const job: any = {
    id,
    connection_id:Number(connectionId),
    connection_name:connection.name,
    type:"local-delivery",
    label,
    remote_paths:paths,
    target_directory:String(targetDirectory || ""),
    conflict_mode:["error", "overwrite", "rename"].includes(String(conflictMode || "")) ? String(conflictMode) : "rename",
    delivery_mode:String(options.deliveryMode || "local-files"),
    delivery_status:"pending",
    status:"pending",
    phase:"preparing",
    current:"正在准备下载",
    can_cancel:false,
    can_pause:false,
    stdout:"",
    stderr:"",
    error:"",
    size:0,
    size_known:false,
    progress_known:false,
    progress_unit:"bytes",
    transferred:0,
    progress:0,
    item_count:paths.length,
    item_transferred:0,
    created_at:Date.now(),
    started_at:null,
    finished_at:null
  };
  resetTransferSpeed(job);
  jobs.set(id, job);
  persistJobs();

  setImmediate(async () => {
    const current = jobs.get(id);
    if (!current) return;
    current.status = "running";
    current.phase = "local-saving";
    current.current = "正在下载到本机";
    current.started_at = Date.now();
    persistJobs();
    try {
      const result = await deliverSftpPaths(connectionId, paths, current.target_directory, current.conflict_mode, {
        onFile: ({size}) => {
          if (current.status !== "running") return;
          const bytes = Math.max(0, Number(size || 0));
          if (bytes <= 0) return;
          current.size = Math.max(0, Number(current.size || 0)) + bytes;
          current.size_known = true;
          current.progress_known = true;
          updateTransferProgress(current);
          persistJobs();
        },
        onBytes: (bytes) => {
          if (current.status !== "running") return;
          recordTransferred(current, Math.max(0, Number(bytes || 0)));
          persistJobs();
        },
        onItem: () => {
          if (current.status !== "running") return;
          current.item_transferred = Math.min(current.item_count, Number(current.item_transferred || 0) + 1);
          current.current = `已接收 ${current.item_transferred} / ${Math.max(1, current.item_count)} 项`;
          persistJobs();
        }
      });
      current.status = "done";
      current.phase = "";
      current.current = "已保存到本机";
      current.delivery_status = "saved";
      current.saved_path = result.directory;
      current.saved_files = result.files;
      if (!current.size_known) {
        current.progress_unit = "items";
        current.size = Math.max(1, current.item_count);
        current.transferred = current.size;
        current.size_known = true;
        current.progress_known = true;
      } else {
        current.transferred = Math.max(Number(current.size || 0), Number(current.transferred || 0));
      }
      current.progress = 100;
      current.finished_at = Date.now();
      finishTransferMetrics(current);
      persistJobs(true);
      notifyEvent({
        type:"sftp",
        level:"success",
        title:"SFTP 下载到本机已完成",
        message:`${current.connection_name} · ${current.label}\n已保存到 ${current.saved_path}`,
        action:{view:"sftp", connection_id:current.connection_id}
      }, {cooldown_ms:0});
    } catch (error) {
      current.status = "failed";
      current.phase = "";
      current.current = "";
      current.delivery_status = "failed";
      current.error = error?.message || "下载到本机失败";
      current.finished_at = Date.now();
      finishTransferMetrics(current);
      persistJobs(true);
      notifyEvent({
        type:"sftp",
        level:"error",
        title:"SFTP 下载到本机失败",
        message:`${current.connection_name} · ${current.label}\n${current.error}`,
        action:{view:"sftp", connection_id:current.connection_id}
      }, {cooldown_ms:0});
    }
  });

  return {
    id,
    status:job.status,
    type:job.type,
    connection_id:job.connection_id,
    target_directory:job.target_directory,
    delivery_mode:job.delivery_mode
  };
}

function startDownloadJob(connectionId, remotePath, options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const id = crypto.randomUUID();
  const basename = path.posix.basename(String(remotePath || "").replace(/\\/g, "/")) || "download";
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const tempPath = path.join(DOWNLOADS_DIR, `${id}-${basename}`);
  const job = {
    id,
    connection_id: Number(connectionId),
    connection_name: connection.name,
    type: "download",
    label: `下载 ${basename}`,
    remote_path: remotePath,
    temp_path: tempPath,
    delivery_mode: options.deliveryMode === "desktop" ? "desktop" : "browser",
    delivery_status: "pending",
    auto_save_directory: options.deliveryMode === "desktop" ? String(options.autoSaveDirectory || "") : "",
    status: "pending",
    stdout: "",
    stderr: "",
    error: "",
    size: 0,
    size_known: false,
    progress_known: false,
    transferred: 0,
    progress: 0,
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: null
  };
  resetTransferSpeed(job);
  jobs.set(id, job);
  persistJobs();
  runDownloadJob(id, true);
  return { id, status: job.status, delivery_mode:job.delivery_mode };
}

function runDownloadJob(id, fetchSize) {
  const job = jobs.get(id);
  if (!job) return;
  const connection = getSftpConnection(job.connection_id);
  (async () => {
    try {
      if (fetchSize || !job.size_known) {
        job.size = await getRemoteSize(connection, job.remote_path);
        job.size_known = true;
        job.progress_known = true;
        updateTransferProgress(job);
        persistJobs();
      }
      if (!jobs.has(id) || job.status === "cancelled" || job.status === "paused") return;
      let offset = fs.existsSync(job.temp_path) ? fs.statSync(job.temp_path).size : 0;
      if (job.size_known && offset > job.size) {
        fs.truncateSync(job.temp_path, 0);
        offset = 0;
      }
      job.transferred = offset;
      updateTransferProgress(job);
      if (job.size_known && offset === job.size) {
        finishDownloadJob(id, true);
        return;
      }
      const command = offset > 0 ? `tail -c +${offset + 1} ${remotePathOperand(connection, job.remote_path)}` : `cat -- ${remotePathOperand(connection, job.remote_path)}`;
      const child = spawnRemote(connection, command);
      const out = fs.createWriteStream(job.temp_path, offset > 0 ? { flags: "a" } : {});
      job.child = child;
      job.out = out;
      job.status = "running";
      job.started_at = job.started_at || Date.now();
      job.finished_at = null;
      job.error = "";
      resetTransferSpeed(job);
      persistJobs();
      let paused = false;
      let childClosed = false;
      let stdoutEnded = false;
      let outputEnding = false;
      let closeCode: number | null = null;
      let closeSignal: string | null = null;
      const finish = (status, error = "") => {
        if (ignoreStoppedTransferFinish(job, status)) return;
        if (job.finished_at && status !== "paused") return;
        try { out.destroy(); } catch {}
        if (status !== "paused") try { child.kill("SIGTERM"); } catch {}
        if (status === "done") {
          job.transferred = (job.size || fs.existsSync(job.temp_path)) ? fs.statSync(job.temp_path).size : job.transferred;
          job.progress = 100;
        }
        job.status = status;
        if (error) job.error = error;
        if (status !== "paused") job.finished_at = Date.now();
        if (status !== "paused") finishTransferMetrics(job);
        if (status === "done" && job.delivery_mode === "desktop") autoSaveDownloadedFile(job);
        persistJobs(status !== "paused");
        if (status === "done" || status === "failed") {
          notifyEvent({
            type: "sftp",
            level: status === "done" ? "success" : "error",
            title: status === "done" ? "SFTP 下载已完成" : "SFTP 下载失败",
            message: `${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}${job.error ? `\n${job.error}` : ""}`,
            action: { view: "sftp", connection_id: job.connection_id }
          }, { cooldown_ms: 0 });
        }
      };
      const completeAfterStreams = () => {
        if (!childClosed || !stdoutEnded || outputEnding || paused || job.status === "cancelled") return;
        outputEnding = true;
        out.end(() => {
          if (paused || job.status === "cancelled") return;
          const realSize = fs.existsSync(job.temp_path) ? fs.statSync(job.temp_path).size : 0;
          job.transferred = realSize;
          const sizeMatches = !job.size_known || realSize === Number(job.size || 0);
          if ((closeCode === 0 && sizeMatches) || (closeCode !== 0 && job.size > 0 && sizeMatches)) {
            finish("done");
            return;
          }
          if (!sizeMatches) {
            finish("failed", `下载不完整：应为 ${Number(job.size || 0)} 字节，实际 ${realSize} 字节`);
            return;
          }
          finish("failed", job.stderr || `退出码 ${closeCode ?? ""}${closeSignal ? `，信号 ${closeSignal}` : ""}`);
        });
      };
      child.stdout.on("data", (chunk) => {
        if (paused) return;
        if (!out.write(chunk)) { child.stdout.pause(); out.once("drain", () => child.stdout.resume()); }
        recordTransferred(job, chunk.length);
        persistJobs();
      });
      child.stdout.on("end", () => {
        stdoutEnded = true;
        completeAfterStreams();
      });
      child.stdout.on("error", (error) => finish("failed", error.message));
      out.on("error", (error) => finish("failed", error.message));
      child.stderr.on("data", (chunk) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
      child.on("error", (error) => finish("failed", error.message));
      child.on("close", (code, signal) => {
        if (job.status === "paused" || job.status === "cancelled") return;
        childClosed = true;
        closeCode = code;
        closeSignal = signal;
        completeAfterStreams();
      });
      job.pauseNow = () => {
        paused = true;
        try { child.stdout.pause(); } catch {}
        try { child.kill("SIGTERM"); } catch {}
        finish("paused");
      };
    } catch (error) {
      if (!jobs.has(id) || job.status === "paused" || job.status === "cancelled") return;
      job.status = "failed";
      job.error = error.message || "下载启动失败";
      job.finished_at = Date.now();
      persistJobs(true);
      notifyEvent({ type: "sftp", level: "error", title: "SFTP 下载失败", message: `${job.connection_name} · ${job.label}\n${job.error}`, action: { view: "sftp", connection_id: job.connection_id } }, { cooldown_ms: 0 });
    }
  })();
}

function finishDownloadJob(id, complete) {
  const job = jobs.get(id);
  if (!job || job.status === "paused" || job.status === "cancelled") return;
  try { job.out?.destroy(); } catch {}
  try { job.child?.kill("SIGTERM"); } catch {}
  if (complete) {
    job.transferred = fs.existsSync(job.temp_path) ? fs.statSync(job.temp_path).size : job.transferred;
    job.progress = 100;
    job.status = "done";
    job.finished_at = Date.now();
    finishTransferMetrics(job);
    if (job.delivery_mode === "desktop") autoSaveDownloadedFile(job);
    persistJobs(true);
    notifyEvent({ type: "sftp", level: "success", title: "SFTP 下载已完成", message: `${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}`, action: { view: "sftp", connection_id: job.connection_id } }, { cooldown_ms: 0 });
  }
}

function pauseSftpJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error("任务不存在");
  if (!ACTIVE_STATUSES.has(job.status)) return { ok: true, status: job.status };
  if (job.type === "upload" && job.phase === "receiving") throw new Error("文件接收阶段只能取消任务");
  if (job.type === "upload" && job.phase === "committing") return { ok:true, status:job.status };
  if (job.status !== "running") {
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
    runDownloadJob(id, false);
    return { ok: true, status: job.status };
  }
  if (job.type === "upload") {
    resumeUploadJob(id);
    return { ok: true, status: job.status };
  }
  throw new Error("该任务类型暂不支持继续");
}

function resumeUploadJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  const connection = getSftpConnection(job.connection_id);
  if (!job.staged_complete || !job.local_path || !fs.existsSync(job.local_path)) throw new Error("上传暂存文件不存在，无法继续");
  job.status = "pending";
  job.phase = "resuming";
  job.can_pause = false;
  job.error = "";
  job.started_at = Date.now();
  job.finished_at = null;
  const generation = Math.max(0, Number(job.upload_generation || 0)) + 1;
  job.upload_generation = generation;
  persistJobs(true);
  const child = spawnRemote(connection, `if [ -f ${remotePathOperand(connection, job.remote_temp_path)} ]; then wc -c < ${remotePathOperand(connection, job.remote_temp_path)} | tr -d ' '; else printf '0'; fi`);
  job.child = child;
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", (error) => {
    if (Number(job.upload_generation || 0) !== generation) return;
    finishUploadTransfer(job, "failed", error.message);
  });
  child.on("close", (code) => {
    if (Number(job.upload_generation || 0) !== generation) return;
    if (job.status === "cancelled" || job.status === "paused") return;
    if (code !== 0) return finishUploadTransfer(job, "failed", stderr.trim() || "读取远端上传进度失败");
    const offset = Number(stdout.trim() || 0);
    const localSize = fs.statSync(job.local_path).size;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > localSize) {
      finishUploadTransfer(job, "failed", "远端暂存文件大小异常，无法继续上传");
      return;
    }
    startUploadTransfer(job, offset, generation);
  });
  child.stdin.end();
}

function getSftpJobFile(id) {
  const job = jobs.get(id) || readHistory().find((item) => item.id === id);
  if (!job) throw new Error("任务不存在");
  if (job.type !== "download") throw new Error("该任务没有可下载的文件");
  if (!fs.existsSync(job.temp_path)) throw new Error("临时文件不存在");
  return { path: job.temp_path, name: job.download_name || path.posix.basename(job.remote_path || "download") };
}

function startArchiveDownloadJob(connectionId, remotePaths, options: any = {}) {
  const connection = getSftpConnection(connectionId);
  const paths = [...new Set((Array.isArray(remotePaths) ? remotePaths : []).map(item => String(item || "").replace(/\\/g, "/")).filter(Boolean))];
  if (!paths.length || paths.length > 200) throw new Error("一次最多打包下载 200 个项目");
  const parents = new Set(paths.map(item => path.posix.dirname(item.replace(/\/+$/, "")) || "."));
  if (parents.size !== 1) throw new Error("打包下载的项目必须位于同一目录");
  const parent = [...parents][0];
  const names = paths.map(item => path.posix.basename(item.replace(/\/+$/, "")));
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `terma-${timestamp}.tar.gz`;
  fs.mkdirSync(DOWNLOADS_DIR, {recursive:true});
  const tempPath = path.join(DOWNLOADS_DIR, `${id}-${basename}`);
  const job: any = {
    id,
    connection_id:Number(connectionId),
    connection_name:connection.name,
    type:"download",
    label:`打包下载 ${paths.length} 项`,
    remote_paths:paths,
    remote_path:parent,
    download_name:basename,
    temp_path:tempPath,
    delivery_mode:options.deliveryMode === "desktop" ? "desktop" : "browser",
    delivery_status:"pending",
    auto_save_directory:options.deliveryMode === "desktop" ? String(options.autoSaveDirectory || "") : "",
    status:"running",
    stdout:"",
    stderr:"",
    error:"",
    size:0,
    size_known:false,
    progress_known:false,
    transferred:0,
    progress:0,
    created_at:Date.now(),
    started_at:Date.now(),
    finished_at:null
  };
  resetTransferSpeed(job);
  jobs.set(id, job);
  persistJobs();
  const command = `tar -C ${remotePathOperand(connection, parent)} -czf - -- ${names.map(name => remotePathOperand(connection, name)).join(" ")}`;
  const child = spawnRemote(connection, command);
  const out = fs.createWriteStream(tempPath);
  job.child = child;
  job.out = out;
  let finished = false;
  const finish = (status, error="") => {
    if (finished || ignoreStoppedTransferFinish(job, status)) return;
    finished = true;
    job.status = status;
    job.error = error;
    job.finished_at = Date.now();
    if (status === "done") {
      job.size = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : job.transferred;
      job.size_known = true;
      job.progress_known = true;
      job.transferred = job.size;
      job.progress = 100;
      if (job.delivery_mode === "desktop") autoSaveDownloadedFile(job);
    }
    finishTransferMetrics(job);
    persistJobs(true);
    notifyEvent({
      type:"sftp",
      level:status === "done" ? "success" : "error",
      title:status === "done" ? "SFTP 打包下载已完成" : "SFTP 打包下载失败",
      message:`${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${error ? `\n${error}` : ""}`,
      action:{view:"sftp", connection_id:job.connection_id}
    }, {cooldown_ms:0});
  };
  child.stdout.on("data", chunk => {
    if (!out.write(chunk)) { child.stdout.pause(); out.once("drain", () => child.stdout.resume()); }
    recordTransferred(job, chunk.length);
    persistJobs();
  });
  child.stderr.on("data", chunk => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
  child.on("error", error => { try { out.destroy(); } catch {} finish("failed", error.message); });
  child.on("close", code => {
    out.end(() => finish(code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}`)));
  });
  return {id, status:job.status, delivery_mode:job.delivery_mode};
}

function markSftpJobDelivered(id) {
  const job = jobs.get(id) || readHistory().find((item) => item.id === id);
  if (!job || job.type !== "download") return {ok:false};
  job.delivery_status = "delivered";
  job.delivered_at = Date.now();
  if (jobs.has(id)) persistJobs(true);
  else writeJsonJobs(readHistory());
  return {ok:true};
}

function directoryCacheStats(directory, protectedPaths = new Set()) {
  let bytes = 0;
  let files = 0;
  let reclaimableBytes = 0;
  let reclaimableFiles = 0;
  try {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      if (!entry.isFile()) continue;
      const file = path.resolve(directory, entry.name);
      const size = fs.statSync(file).size;
      bytes += size;
      files += 1;
      if (!protectedPaths.has(file)) {
        reclaimableBytes += size;
        reclaimableFiles += 1;
      }
    }
  } catch {}
  return {bytes, files, reclaimable_bytes:reclaimableBytes, reclaimable_files:reclaimableFiles};
}

function sftpCacheInfo() {
  readHistory();
  maintainDownloadCache();
  const protectedDownloads = new Set();
  const protectedUploads = new Set();
  for (const job of jobs.values()) {
    if (!["running", "pending", "paused", "failed"].includes(job.status)) continue;
    if (job.type === "download" && job.temp_path) protectedDownloads.add(path.resolve(job.temp_path));
    if (job.type === "upload" && job.local_path) protectedUploads.add(path.resolve(job.local_path));
  }
  const downloads = directoryCacheStats(DOWNLOADS_DIR, protectedDownloads);
  const uploads = directoryCacheStats(path.join(DATA_DIR, "uploads"), protectedUploads);
  const drag = sftpDragCacheInfo();
  return {
    bytes:downloads.bytes + uploads.bytes + drag.bytes,
    files:downloads.files + uploads.files + drag.files,
    reclaimable_bytes:downloads.reclaimable_bytes + uploads.reclaimable_bytes + drag.reclaimable_bytes,
    reclaimable_files:downloads.reclaimable_files + uploads.reclaimable_files + drag.reclaimable_files,
    downloads,
    uploads,
    drag
  };
}

function clearSftpCache(category = "") {
  const requested = String(category || "");
  const clearDownloads = !requested || requested === "sftp_downloads";
  const clearUploads = !requested || requested === "sftp_uploads";
  const clearDrag = !requested || requested === "sftp_drag";
  readHistory();
  const protectedPaths = new Set();
  for (const job of jobs.values()) {
    if (!["running", "pending", "paused", "failed"].includes(job.status)) continue;
    for (const key of ["temp_path", "local_path"]) if (job[key]) protectedPaths.add(path.resolve(job[key]));
  }
  if (clearDownloads) {
    for (const job of [...jobs.values(), ...readHistory()]) {
      if (job.type !== "download" || !["done", "cancelled"].includes(job.status)) continue;
      if (removeDownloadCacheFile(job) && !["saved", "delivered"].includes(job.delivery_status)) job.delivery_status = "cache_cleared";
    }
  }
  const directories = [
    ...(clearDownloads ? [DOWNLOADS_DIR] : []),
    ...(clearUploads ? [path.join(DATA_DIR, "uploads")] : [])
  ];
  for (const directory of directories) {
    try {
      for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        if (!entry.isFile()) continue;
        const file = path.resolve(directory, entry.name);
        if (!protectedPaths.has(file)) try { fs.unlinkSync(file); } catch {}
      }
    } catch {}
  }
  if (clearDrag) clearSftpDragCache();
  persistJobs(true);
  return sftpCacheInfo();
}

function buildCrossCopyOverwriteCommand(targetConnection, targetDir, names) {
  const temporaryName = `.terma-cross-copy-${crypto.randomUUID()}`;
  const temporaryRoot = `./${temporaryName}`;
  const incomingRoot = `${temporaryRoot}/incoming`;
  const backupRoot = `${temporaryRoot}/backup`;
  const replacements = [];
  const rollback = [];
  names.forEach((name, index) => {
    const target = remotePathOperand(targetConnection, `./${name}`);
    const staged = remotePathOperand(targetConnection, `${incomingRoot}/${name}`);
    const backup = shellQuote(`${backupRoot}/${index}`);
    const marker = shellQuote(`${temporaryRoot}/placed-${index}`);
    replacements.push(`(if [ -e ${target} ] || [ -L ${target} ]; then mv -- ${target} ${backup}; fi) && : > ${marker} && mv -- ${staged} ${target}`);
    rollback.unshift(`if [ -e ${marker} ]; then rm -rf -- ${target}; fi; if [ -e ${backup} ] || [ -L ${backup} ]; then mv -- ${backup} ${target}; fi`);
  });
  const rollbackBody = rollback.join("; ");
  return [
    `cd ${remotePathOperand(targetConnection, targetDir)} || exit $?`,
    `td_tmp=${shellQuote(temporaryName)}`,
    `mkdir -- "$td_tmp" || exit $?`,
    "td_committed=0",
    `td_rollback() { td_status=$?; trap - 0 1 2 3 15; if [ "$td_committed" -ne 1 ]; then ${rollbackBody}; fi; rm -rf -- "$td_tmp"; exit "$td_status"; }`,
    "trap td_rollback 0 1 2 3 15",
    `(mkdir -- "$td_tmp/incoming" "$td_tmp/backup" && tar -xf - -C "$td_tmp/incoming" && ${replacements.join(" && ")})`,
    "td_status=$?",
    "if [ \"$td_status\" -ne 0 ]; then exit \"$td_status\"; fi",
    "td_committed=1",
    "rm -rf -- \"$td_tmp\"",
    "td_status=$?",
    "trap - 0 1 2 3 15",
    "exit \"$td_status\""
  ].join("; ");
}

function crossCopyProgressEntries(paths, entries) {
  const allowed = new Set(paths);
  const byPath = new Map();
  for (const source of Array.isArray(entries) ? entries : []) {
    const remotePath = path.posix.normalize(String(source?.path || "").replace(/\\/g, "/"));
    if (!allowed.has(remotePath) || byPath.has(remotePath)) continue;
    byPath.set(remotePath, {
      path:remotePath,
      type:["dir", "directory"].includes(String(source?.type || "")) ? "directory" : "file",
      size:Math.max(0, Number(source?.size || 0)),
      metadataKnown:Boolean(source?.metadataKnown)
    });
  }
  return paths.map(remotePath => byPath.get(remotePath) || {path:remotePath, type:"file", size:0, metadataKnown:false});
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

function buildItemProgressJobCommand(connection, action, paths, targetDir) {
  const source = [...new Set((Array.isArray(paths) ? paths : []).map(item => String(item || "").replace(/\\/g, "/")).filter(Boolean))];
  if (!source.length) throw new Error(`请选择要${action === "copy" ? "复制" : "移动"}的文件`);
  if (source.length > 200 || source.some(item => item.includes("\0") || item.length > 4096)) throw new Error("远程路径无效或数量过多");
  const marker = `__TERMA_JOB_${crypto.randomBytes(12).toString("hex")}__:`;
  const commandName = action === "copy" ? "cp -a" : "mv";
  const target = remotePathOperand(connection, targetDir);
  const commands = source.map((item, index) => (
    `(${commandName} -- ${remotePathOperand(connection, item)} ${target}) && printf '%s\\n' ${shellQuote(`${marker}${index + 1}`)}`
  ));
  return {command:commands.join(" && "), marker, itemCount:source.length};
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

function normalizeCompressionRequest(paths, targetDir = ".", archiveName = "", connection = null) {
  const source = Array.isArray(paths) ? paths : [paths];
  const normalizedPaths = [...new Set(source.map((item) => path.posix.normalize(String(item || "").replace(/\\/g, "/"))).filter(Boolean))];
  if (!normalizedPaths.length) throw new Error("请选择要压缩的文件或目录");
  if (normalizedPaths.length > 200) throw new Error("一次最多压缩 200 个文件或目录");
  if (normalizedPaths.some((item) => item === "." || item === ".." || item.startsWith("../") || item.includes("\0") || item.length > 4096)) throw new Error("压缩路径无效");
  const parent = path.posix.dirname(normalizedPaths[0]) || ".";
  if (normalizedPaths.some((item) => (path.posix.dirname(item) || ".") !== parent)) throw new Error("多选压缩必须选择同一目录下的项目");
  const target = path.posix.normalize(String(targetDir || parent).replace(/\\/g, "/")) || ".";
  if (target !== parent) throw new Error("压缩目标必须是所选项目所在目录");
  const requestedName = String(archiveName || "").trim().replace(/\\/g, "/");
  if (requestedName.includes("/") || requestedName.includes("\0")) throw new Error("压缩包名称不能包含路径");
  let name = path.posix.basename(requestedName);
  if (!name || name === "." || name === "..") name = normalizedPaths.length === 1 ? `${path.posix.basename(normalizedPaths[0])}.tar.gz` : "archive.tar.gz";
  if (!/\.(?:tar\.gz|tgz)$/i.test(name)) name = `${name}.tar.gz`;
  if (Buffer.byteLength(name, "utf8") > 255) throw new Error("压缩包名称过长");
  const output = path.posix.join(target, name);
  if (normalizedPaths.includes(output)) throw new Error("压缩包不能覆盖被选中的源文件");
  const temporaryOutput = path.posix.join(target, `.terma-${crypto.randomUUID()}.tar.gz.part`);
  const names = normalizedPaths.map((item) => `./${path.posix.basename(item)}`);
  const command = `if [ -e ${remotePathOperand(connection, output)} ]; then echo "目标压缩包已存在" >&2; exit 1; fi; tar -czf ${remotePathOperand(connection, temporaryOutput)} -C ${remotePathOperand(connection, parent)} -- ${names.map((item) => remotePathOperand(connection, item)).join(" ")} && mv -- ${remotePathOperand(connection, temporaryOutput)} ${remotePathOperand(connection, output)} || { status=$?; rm -f -- ${remotePathOperand(connection, temporaryOutput)}; exit $status; }`;
  return { paths: normalizedPaths, target, parent, name, output, temporary_output: temporaryOutput, command };
}

function compressJob(connectionId, paths, targetDir = ".", archiveName = "") {
  const connection = getSftpConnection(connectionId);
  const request = normalizeCompressionRequest(paths, targetDir, archiveName, connection);
  return { ...startSftpJob(connectionId, "compress", request.command, `压缩 ${request.paths.length} 项为 ${request.name}`), output:request.output };
}

module.exports = { beginNativeSftpDragJob, cancelSftpJob, clearFinishedSftpJobs, clearSftpCache, compressJob, copyJob, crossCopyJob, deletePathsJob, deleteSftpJob, discardNativeSftpDragJob, extractJob, finishNativeSftpDragJob, getSftpJobFile, listSftpJobs, markSftpJobDelivered, moveJob, normalizeCompressionRequest, pauseSftpJob, receiveUploadJobContent, recordNativeSftpDragBytes, resumeSftpJob, setNativeSftpDragCancelHandler, sftpCacheInfo, startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startUploadJob, startUploadReceiveJob, trackNativeSftpDragStream, __addUniqueByteRange: addUniqueByteRange, __buildCompressCommand: normalizeCompressionRequest, __buildCrossCopyOverwriteCommand: buildCrossCopyOverwriteCommand, __buildDeleteJobRequest: buildDeleteJobRequest, __consumeDeleteJobOutput: consumeDeleteJobOutput };
