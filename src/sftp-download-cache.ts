const fs = require("node:fs");
const path = require("node:path");

const DOWNLOAD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BROWSER_DELIVERY_GRACE_MS = 10 * 60 * 1000;
const PROTECTED_JOB_STATUSES = new Set(["running", "pending", "paused", "failed"]);

function createSftpDownloadCache(dependencies: any) {
  const {
    clearSftpDragCache,
    dataDir,
    getHistory,
    getHistoryCache,
    hasHistoryCache,
    jobs,
    persistJobs,
    replaceHistoryCache,
    sftpDragCacheInfo
  } = dependencies;
  const downloadsDirectory = path.join(dataDir, "downloads");
  const uploadsDirectory = path.join(dataDir, "uploads");
  let maintained = false;

  function removeDownloadCacheFile(job: any) {
    if (!job?.temp_path) return false;
    try {
      fs.unlinkSync(job.temp_path);
    } catch (error: any) {
      if (error?.code !== "ENOENT") return false;
    }
    job.temp_path = "";
    return true;
  }

  function maintainDownloadCache(now = Date.now()) {
    fs.mkdirSync(downloadsDirectory, {recursive:true});
    const history = getHistoryCache();
    const referenced = new Set<string>();
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
      for (const entry of fs.readdirSync(downloadsDirectory, {withFileTypes:true})) {
        if (!entry.isFile()) continue;
        const file = path.resolve(downloadsDirectory, entry.name);
        if (!referenced.has(file)) try { fs.unlinkSync(file); } catch {}
      }
    } catch {}
    if (changed && hasHistoryCache()) replaceHistoryCache(history);
  }

  function ensureDownloadCacheMaintained() {
    if (maintained) return;
    maintained = true;
    maintainDownloadCache();
  }

  function directoryCacheStats(directory: string, protectedPaths = new Set<string>()) {
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
    getHistory();
    maintainDownloadCache();
    const protectedDownloads = new Set<string>();
    const protectedUploads = new Set<string>();
    for (const job of jobs.values()) {
      if (!PROTECTED_JOB_STATUSES.has(job.status)) continue;
      if (job.type === "download" && job.temp_path) protectedDownloads.add(path.resolve(job.temp_path));
      if (job.type === "upload" && job.local_path) protectedUploads.add(path.resolve(job.local_path));
    }
    const downloads = directoryCacheStats(downloadsDirectory, protectedDownloads);
    const uploads = directoryCacheStats(uploadsDirectory, protectedUploads);
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
    getHistory();
    const protectedPaths = new Set<string>();
    for (const job of jobs.values()) {
      if (!PROTECTED_JOB_STATUSES.has(job.status)) continue;
      for (const key of ["temp_path", "local_path"]) if (job[key]) protectedPaths.add(path.resolve(job[key]));
    }
    if (clearDownloads) {
      for (const job of [...jobs.values(), ...getHistory()]) {
        if (job.type !== "download" || !["done", "cancelled"].includes(job.status)) continue;
        if (removeDownloadCacheFile(job) && !["saved", "delivered"].includes(job.delivery_status)) job.delivery_status = "cache_cleared";
      }
    }
    const directories = [
      ...(clearDownloads ? [downloadsDirectory] : []),
      ...(clearUploads ? [uploadsDirectory] : [])
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

  const maintenanceTimer = setInterval(() => maintainDownloadCache(), 60 * 60 * 1000);
  maintenanceTimer.unref?.();

  return {
    clearSftpCache,
    downloadsDirectory,
    ensureDownloadCacheMaintained,
    maintainDownloadCache,
    removeDownloadCacheFile,
    sftpCacheInfo
  };
}

module.exports = { createSftpDownloadCache };
