const crypto = require("node:crypto");

const NATIVE_DRAG_DISCARD_TTL_MS = 5 * 60 * 1000;

function createNativeSftpDragJobs(dependencies: any) {
  const {
    activeStatuses,
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
  } = dependencies;
  const nativeDragJobIds = new Map<string, string>();
  const closedNativeDragTokens = new Map<string, NodeJS.Timeout>();
  let nativeDragCancelHandler: any = null;

  function addUniqueByteRange(ranges: number[][], start: number, end: number) {
    const first = Math.max(0, Number(start || 0));
    const last = Math.max(first - 1, Number(end ?? first - 1));
    if (last < first) return 0;
    const before = ranges.reduce((total, range) => total + range[1] - range[0] + 1, 0);
    const merged: number[][] = [];
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

  function setNativeSftpDragCancelHandler(handler: any) {
    nativeDragCancelHandler = typeof handler === "function" ? handler : null;
  }

  function markNativeSftpDragClosed(token: unknown) {
    const key = String(token || "");
    if (!key) return;
    const previous = closedNativeDragTokens.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => closedNativeDragTokens.delete(key), NATIVE_DRAG_DISCARD_TTL_MS);
    timer.unref?.();
    closedNativeDragTokens.set(key, timer);
  }

  function forgetNativeSftpDragJob(job: any) {
    const token = String(job?.native_drag_token || "");
    if (!token) return;
    markNativeSftpDragClosed(token);
    nativeDragJobIds.delete(token);
  }

  function beginNativeSftpDragJob(token: unknown, ticket: any) {
    const key = String(token || "");
    if (closedNativeDragTokens.has(key)) return { id:"", status:"discarded" };
    const existingId = nativeDragJobIds.get(key);
    if (existingId && jobs.has(existingId)) return { id:existingId, status:jobs.get(existingId).status };
    const connectionId = Number(ticket?.connection_id || 0);
    const connection = getSftpConnection(connectionId);
    const topLevel = Array.isArray(ticket?.top_level) ? ticket.top_level : [];
    const entries = Array.isArray(ticket?.entries) ? ticket.entries : [];
    const names = topLevel.map((item: any) => String(item?.name || "")).filter(Boolean);
    const label = names.length === 1 ? `拖出 ${names[0]} 到本机` : `拖出 ${Math.max(1, names.length)} 项到本机`;
    const manifestReady = Boolean(ticket?.ready && Array.isArray(ticket?.entries));
    const topLevelSizeKnown = topLevel.length > 0 && topLevel.every((entry: any) => (
      entry?.type === "file" && entry?.metadata_known === true && Number.isFinite(Number(entry?.size))
    ));
    const sizeKnown = manifestReady || topLevelSizeKnown;
    const sizedEntries = manifestReady ? entries : topLevel;
    const size = sizeKnown
      ? sizedEntries.reduce((total: number, entry: any) => entry?.type === "file" ? total + Math.max(0, Number(entry.size || 0)) : total, 0)
      : 0;
    const id = crypto.randomUUID();
    const job: any = {
      id,
      connection_id:connectionId,
      connection_name:connection.name,
      type:"native-drag",
      label,
      status:"pending",
      phase:"queued",
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
      started_at:null,
      finished_at:null
    };
    resetTransferSpeed(job);
    jobs.set(id, job);
    nativeDragJobIds.set(key, id);
    queueTransferJob("download", job, () => resolveTransferWaiters(job), {
      phase:"system-saving",
      current:"正在由系统保存",
      queuedCurrent:"等待下载并发额度"
    });
    return { id, status:job.status };
  }

  function recordNativeSftpDragBytes(token: unknown, bytes: unknown) {
    const job = nativeJob(token);
    if (!job || job.status !== "running") return {ok:false, status:job?.status || "missing"};
    const requested = Math.max(0, Math.floor(Number(bytes || 0)));
    const remaining = job.size_known ? Math.max(0, Number(job.size || 0) - Number(job.transferred || 0)) : requested;
    const added = Math.min(requested, remaining);
    if (added > 0) {
      recordTransferred(job, added);
      persistJobs();
    }
    return { ok:true, status:job.status, transferred:Number(job.transferred || 0), progress:Number(job.progress || 0) };
  }

  function trackNativeSftpDragStream(token: unknown, index: unknown, opened: any) {
    const job = nativeJob(token);
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
    stream.on("data", (chunk: any) => {
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

  function finishNativeSftpDragJob(token: unknown, status: string, error = "") {
    const key = String(token || "");
    markNativeSftpDragClosed(key);
    const job = nativeJob(key);
    if (!job) return { ok:false, status:"missing" };
    if (job.status === "cancelled") {
      nativeDragJobIds.delete(key);
      return { ok:true, status:job.status };
    }
    const requestedStatus = ["done", "cancelled", "failed"].includes(status) ? status : "failed";
    const incomplete = requestedStatus === "done" && Number(job.size || 0) > 0 && Number(job.transferred || 0) < Number(job.size || 0);
    const finalStatus = incomplete ? "cancelled" : requestedStatus;
    if (finalStatus !== "done") destroyStreams(job);
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
    releaseTransferSlot(job);
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

  function discardNativeSftpDragJob(token: unknown) {
    const key = String(token || "");
    markNativeSftpDragClosed(key);
    const job = nativeJob(key);
    if (!job) return { ok:true, status:"discarded" };
    removeQueuedTransfer(job);
    rejectTransferWaiters(job, transferCancelledError());
    destroyStreams(job);
    job.streams?.clear?.();
    releaseTransferSlot(job);
    nativeDragJobIds.delete(key);
    jobs.delete(job.id);
    writeJsonJobs(readHistory().filter((item: any) => item.id !== job.id));
    return { ok:true, status:"discarded" };
  }

  function requestNativeSftpDragCancel(job: any) {
    if (job.phase === "cancelling") return {ok:true, status:job.status, phase:job.phase, can_cancel:false};
    let accepted = false;
    try { accepted = Boolean(nativeDragCancelHandler?.(String(job.native_drag_token))); } catch {}
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
    if (!activeStatuses.has(job.status)) return {ok:true, status:job.status, phase:job.phase || "", can_cancel:false};
    // The native target still owns the active stream until its terminal callback.
    job.phase = "cancelling";
    job.can_cancel = false;
    job.can_pause = false;
    job.error = "";
    job.speed_bps = 0;
    persistJobs(true);
    return {ok:true, status:job.status, phase:job.phase, can_cancel:false};
  }

  function nativeJob(token: unknown) {
    const id = nativeDragJobIds.get(String(token || ""));
    return id ? jobs.get(id) : null;
  }

  function destroyStreams(job: any) {
    for (const stream of job?.streams || []) {
      try { stream.destroy(); } catch {}
    }
  }

  return {
    addUniqueByteRange,
    beginNativeSftpDragJob,
    discardNativeSftpDragJob,
    finishNativeSftpDragJob,
    forgetNativeSftpDragJob,
    recordNativeSftpDragBytes,
    requestNativeSftpDragCancel,
    setNativeSftpDragCancelHandler,
    trackNativeSftpDragStream
  };
}

module.exports = { createNativeSftpDragJobs };
