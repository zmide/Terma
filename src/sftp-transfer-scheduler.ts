const { RUNTIME_SETTINGS_FILE } = require("./config");
const { readRuntimeSettings } = require("./runtime-settings");
const { clearSftpJobIssue, setSftpJobIssue } = require("./sftp-job-issues");

type TransferKind = "upload" | "download";

function createSftpTransferScheduler(dependencies: any) {
  const {
    activeStatuses,
    finishTransferMetrics,
    jobs,
    persistJobs
  } = dependencies;
  const transferQueues: Record<TransferKind, string[]> = { upload: [], download: [] };
  const activeTransferJobs: Record<TransferKind, Set<string>> = { upload: new Set(), download: new Set() };

  function transferConcurrency(kind: TransferKind) {
    const settings = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    const value = kind === "upload" ? settings.sftp_upload_concurrency : settings.sftp_download_concurrency;
    return Math.max(1, Math.min(8, Number(value || 3)));
  }

  function removeQueuedTransfer(job: any) {
    const kind = String(job?.transfer_queue_kind || "") as TransferKind;
    if (!transferQueues[kind]) return;
    transferQueues[kind] = transferQueues[kind].filter(id => id !== job.id);
    job.transfer_queued = false;
  }

  function rejectTransferWaiters(job: any, error: any) {
    const waiters = Array.isArray(job?.transfer_waiters) ? job.transfer_waiters.splice(0) : [];
    for (const waiter of waiters) waiter.reject(error);
  }

  function resolveTransferWaiters(job: any) {
    const waiters = Array.isArray(job?.transfer_waiters) ? job.transfer_waiters.splice(0) : [];
    for (const waiter of waiters) waiter.resolve(job);
  }

  function releaseTransferSlot(job: any) {
    const kind = String(job?.transfer_slot_kind || "") as TransferKind;
    if (!activeTransferJobs[kind]) return;
    activeTransferJobs[kind].delete(job.id);
    job.transfer_slot_kind = "";
    setImmediate(() => drainTransferQueue(kind));
  }

  function drainTransferQueue(kind: TransferKind) {
    const queue = transferQueues[kind];
    const active = activeTransferJobs[kind];
    const limit = transferConcurrency(kind);
    while (active.size < limit && queue.length) {
      const id = queue.shift();
      const job = id ? jobs.get(id) : null;
      if (!job || job.status !== "pending" || !job.transfer_runner) continue;
      job.transfer_queued = false;
      job.transfer_slot_kind = kind;
      active.add(job.id);
      job.status = "running";
      job.phase = job.transfer_start_phase || (kind === "upload" ? "uploading" : "preparing");
      job.current = job.transfer_start_current || (kind === "upload" ? "正在上传" : "正在准备下载");
      job.started_at = Date.now();
      job.finished_at = null;
      const runner = job.transfer_runner;
      job.transfer_runner = null;
      persistJobs(true);
      try {
        Promise.resolve(runner()).catch((error: any) => failTransferStart(job, error));
      } catch (error) {
        failTransferStart(job, error);
      }
    }
  }

  function failTransferStart(job: any, error: any) {
    if (!activeStatuses.has(job.status)) return;
    job.status = "failed";
    if (error?.message) setSftpJobIssue(job, "error", error.message);
    else setSftpJobIssue(job, "error", "传输启动失败", "sftp_transfer_start_failed");
    job.finished_at = Date.now();
    finishTransferMetrics(job);
    rejectTransferWaiters(job, error);
    releaseTransferSlot(job);
    persistJobs(true);
  }

  function drainTransferQueues() {
    drainTransferQueue("upload");
    drainTransferQueue("download");
  }

  function queueTransferJob(kind: TransferKind, job: any, runner: () => any, options: any = {}) {
    removeQueuedTransfer(job);
    job.transfer_queue_kind = kind;
    job.transfer_runner = runner;
    job.transfer_queued = true;
    job.transfer_start_phase = options.phase || (kind === "upload" ? "uploading" : "preparing");
    job.transfer_start_current = options.current || (kind === "upload" ? "正在上传" : "正在准备下载");
    job.status = "pending";
    job.phase = "queued";
    job.current = options.queuedCurrent || (kind === "upload" ? "等待上传并发额度" : "等待下载并发额度");
    clearSftpJobIssue(job, "error");
    job.can_pause = false;
    job.finished_at = null;
    transferQueues[kind].push(job.id);
    persistJobs(true);
    drainTransferQueue(kind);
    return job;
  }

  function waitForSftpTransferStart(id: string) {
    const job = jobs.get(id);
    if (!job) return Promise.reject(new Error("传输任务不存在"));
    if (job.status === "running") return Promise.resolve(job);
    if (job.status !== "pending") return Promise.reject(new Error(job.error || "传输任务已结束"));
    if (!Array.isArray(job.transfer_waiters)) job.transfer_waiters = [];
    return new Promise((resolve, reject) => job.transfer_waiters.push({ resolve, reject }));
  }

  function transferCancelledError() {
    const error: any = new Error("传输已取消");
    error.code = "SFTP_TRANSFER_CANCELLED";
    return error;
  }

  function refreshSftpTransferQueues() {
    drainTransferQueues();
    return {
      download: { active: activeTransferJobs.download.size, queued: transferQueues.download.length, limit: transferConcurrency("download") },
      upload: { active: activeTransferJobs.upload.size, queued: transferQueues.upload.length, limit: transferConcurrency("upload") }
    };
  }

  return {
    queueTransferJob,
    refreshSftpTransferQueues,
    rejectTransferWaiters,
    releaseTransferSlot,
    removeQueuedTransfer,
    resolveTransferWaiters,
    transferCancelledError,
    waitForSftpTransferStart
  };
}

module.exports = { createSftpTransferScheduler };
