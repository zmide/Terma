const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { remotePathOperand, spawnRemote } = require("./sftp-job-paths");

function createSftpDownloadJobs(dependencies: any) {
  const {
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
  } = dependencies;

  function getRemoteSize(connection: any, remotePath: string) {
    const child = spawnRemote(connection, `wc -c < ${remotePathOperand(connection, remotePath)} | tr -d ' '`);
    return new Promise<number>((resolve, reject) => {
      let out = "";
      let err = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(new Error("获取远程文件大小超时")); }, 15000);
      child.stdout.on("data", (chunk: any) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk: any) => { err += chunk.toString(); });
      child.on("error", (error: any) => { clearTimeout(timer); reject(error); });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(err.trim() || `读取远程文件大小失败（退出码 ${code ?? "?"}）`));
        const size = Number((out || "").trim());
        resolve(Number.isFinite(size) ? size : 0);
      });
    });
  }

  function safeLocalFilename(value: unknown) {
    const source = String(value || "download");
    const normalized = process.platform === "win32"
      ? source.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "")
      : source.replace(/[\x00/]/g, "_");
    return normalized || "download";
  }

  function availableLocalPath(directory: string, filename: string) {
    const parsed = path.parse(safeLocalFilename(filename));
    let target = path.join(directory, `${parsed.name}${parsed.ext}`);
    for (let index = 1; fs.existsSync(target); index += 1) target = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    return target;
  }

  function autoSaveDownloadedFile(job: any) {
    const directory = String(job.auto_save_directory || "").trim();
    if (!directory || !job.temp_path || !fs.existsSync(job.temp_path)) return;
    try {
      fs.mkdirSync(directory, { recursive:true });
      const target = availableLocalPath(directory, job.download_name || path.posix.basename(job.remote_path || "download"));
      try {
        fs.renameSync(job.temp_path, target);
      } catch (error: any) {
        if (error?.code !== "EXDEV") throw error;
        fs.copyFileSync(job.temp_path, target, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(job.temp_path);
      }
      job.saved_path = target;
      job.delivery_status = "saved";
      job.delivered_at = Date.now();
      job.temp_path = "";
    } catch (error: any) {
      job.delivery_status = "failed";
      job.delivery_error = error.message || String(error);
    }
  }

  function startLocalDeliveryJob(connectionId: number, remotePaths: unknown, targetDirectory: string, conflictMode = "rename", options: any = {}) {
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
    queueTransferJob("download", job, async () => {
      const current = jobs.get(id);
      if (!current) return;
      current.phase = "local-saving";
      current.current = "正在下载到本机";
      persistJobs();
      try {
        const result = await deliverSftpPaths(connectionId, paths, current.target_directory, current.conflict_mode, {
          onFile: ({size}: any) => {
            if (current.status !== "running") return;
            const bytes = Math.max(0, Number(size || 0));
            if (bytes <= 0) return;
            current.size = Math.max(0, Number(current.size || 0)) + bytes;
            current.size_known = true;
            current.progress_known = true;
            updateTransferProgress(current);
            persistJobs();
          },
          onBytes: (bytes: number) => {
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
        releaseTransferSlot(current);
        persistJobs(true);
        notifyEvent({
          type:"sftp",
          level:"success",
          title:"SFTP 下载到本机已完成",
          message:`${current.connection_name} · ${current.label}\n已保存到 ${current.saved_path}`,
          action:{view:"sftp", connection_id:current.connection_id}
        }, {cooldown_ms:0});
      } catch (error: any) {
        current.status = "failed";
        current.phase = "";
        current.current = "";
        current.delivery_status = "failed";
        current.error = error?.message || "下载到本机失败";
        current.finished_at = Date.now();
        finishTransferMetrics(current);
        releaseTransferSlot(current);
        persistJobs(true);
        notifyEvent({
          type:"sftp",
          level:"error",
          title:"SFTP 下载到本机失败",
          message:`${current.connection_name} · ${current.label}\n${current.error}`,
          action:{view:"sftp", connection_id:current.connection_id}
        }, {cooldown_ms:0});
      }
    }, {phase:"local-saving", current:"正在下载到本机"});

    return {
      id,
      status:job.status,
      type:job.type,
      connection_id:job.connection_id,
      target_directory:job.target_directory,
      delivery_mode:job.delivery_mode
    };
  }

  function startDownloadJob(connectionId: number, remotePath: string, options: any = {}) {
    const connection = getSftpConnection(connectionId);
    const id = crypto.randomUUID();
    const basename = path.posix.basename(String(remotePath || "").replace(/\\/g, "/")) || "download";
    fs.mkdirSync(downloadsDirectory, { recursive:true });
    const tempPath = path.join(downloadsDirectory, `${id}-${basename}`);
    const job: any = {
      id,
      connection_id:Number(connectionId),
      connection_name:connection.name,
      type:"download",
      label:`下载 ${basename}`,
      remote_path:remotePath,
      temp_path:tempPath,
      delivery_mode:options.deliveryMode === "desktop" ? "desktop" : "browser",
      delivery_status:"pending",
      auto_save_directory:options.deliveryMode === "desktop" ? String(options.autoSaveDirectory || "") : "",
      status:"pending",
      stdout:"",
      stderr:"",
      error:"",
      size:0,
      size_known:false,
      progress_known:false,
      transferred:0,
      progress:0,
      created_at:Date.now(),
      started_at:null,
      finished_at:null
    };
    resetTransferSpeed(job);
    jobs.set(id, job);
    persistJobs();
    queueTransferJob("download", job, () => runDownloadJob(id, true), {phase:"preparing", current:"正在准备下载"});
    return {id, status:job.status, delivery_mode:job.delivery_mode};
  }

  function runDownloadJob(id: string, fetchSize: boolean) {
    const job = jobs.get(id);
    if (!job) return;
    const connection = getSftpConnection(job.connection_id);
    (async () => {
      try {
        if (fetchSize) {
          job.source_changed = false;
          job.warning = "";
          delete job.final_remote_size;
        }
        if (fetchSize || !job.size_known) {
          job.size = await getRemoteSize(connection, job.remote_path);
          if (fetchSize || !Number.isFinite(Number(job.initial_remote_size))) job.initial_remote_size = job.size;
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
          const latestSize = await getRemoteSize(connection, job.remote_path);
          if (latestSize === job.size) {
            finishDownloadJob(id, true);
            return;
          }
          job.size = latestSize;
          job.source_changed = true;
          if (offset > latestSize) {
            fs.truncateSync(job.temp_path, 0);
            offset = 0;
            job.transferred = 0;
          }
          updateTransferProgress(job);
          persistJobs();
        }
        const command = offset > 0 ? `tail -c +${offset + 1} ${remotePathOperand(connection, job.remote_path)}` : `cat -- ${remotePathOperand(connection, job.remote_path)}`;
        const child = spawnRemote(connection, command);
        const out = fs.createWriteStream(job.temp_path, offset > 0 ? {flags:"a"} : {});
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
        const finish = (status: string, error = "") => {
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
          releaseTransferSlot(job);
          persistJobs(status !== "paused");
          if (status === "done" || status === "failed") {
            notifyEvent({
              type:"sftp",
              level:status === "done" ? "success" : "error",
              title:status === "done" ? "SFTP 下载已完成" : "SFTP 下载失败",
              message:`${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${job.warning ? `\n${job.warning}` : ""}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}${job.error ? `\n${job.error}` : ""}`,
              action:{view:"sftp", connection_id:job.connection_id}
            }, {cooldown_ms:0});
          }
        };
        const completeAfterStreams = () => {
          if (!childClosed || !stdoutEnded || outputEnding || paused || job.status === "cancelled") return;
          outputEnding = true;
          out.end(() => void (async () => {
            if (paused || job.status === "cancelled") return;
            const realSize = fs.existsSync(job.temp_path) ? fs.statSync(job.temp_path).size : 0;
            job.transferred = realSize;
            const initialRemoteSize = Math.max(0, Number(job.initial_remote_size ?? job.size ?? 0));
            let finalRemoteSize = Math.max(0, Number(job.size || 0));
            let finalSizeKnown = false;
            try {
              finalRemoteSize = Math.max(0, Number(await getRemoteSize(connection, job.remote_path) || 0));
              finalSizeKnown = true;
            } catch {}
            const sourceChanged = realSize !== initialRemoteSize || (finalSizeKnown && finalRemoteSize !== initialRemoteSize);
            if (sourceChanged) {
              job.source_changed = true;
              if (finalSizeKnown) job.final_remote_size = finalRemoteSize;
              job.warning = `远端文件在下载期间发生变化；已保存本次读取到的 ${formatSftpTransferSize(realSize)} 快照（开始 ${formatSftpTransferSize(initialRemoteSize)}${finalSizeKnown ? `，结束 ${formatSftpTransferSize(finalRemoteSize)}` : ""}）`;
              if (closeCode === 0) {
                job.size = realSize;
                job.size_known = true;
                finish("done");
                return;
              }
            }
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
          })().catch((error: any) => finish("failed", error.message || "下载完整性校验失败")));
        };
        child.stdout.on("data", (chunk: any) => {
          if (paused) return;
          if (!out.write(chunk)) { child.stdout.pause(); out.once("drain", () => child.stdout.resume()); }
          recordTransferred(job, chunk.length);
          persistJobs();
        });
        child.stdout.on("end", () => {
          stdoutEnded = true;
          completeAfterStreams();
        });
        child.stdout.on("error", (error: any) => finish("failed", error.message));
        out.on("error", (error: any) => finish("failed", error.message));
        child.stderr.on("data", (chunk: any) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
        child.on("error", (error: any) => finish("failed", error.message));
        child.on("close", (code: number | null, signal: string | null) => {
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
      } catch (error: any) {
        if (!jobs.has(id) || job.status === "paused" || job.status === "cancelled") return;
        job.status = "failed";
        job.error = error.message || "下载启动失败";
        job.finished_at = Date.now();
        releaseTransferSlot(job);
        persistJobs(true);
        notifyEvent({type:"sftp", level:"error", title:"SFTP 下载失败", message:`${job.connection_name} · ${job.label}\n${job.error}`, action:{view:"sftp", connection_id:job.connection_id}}, {cooldown_ms:0});
      }
    })();
  }

  function finishDownloadJob(id: string, complete: boolean) {
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
      releaseTransferSlot(job);
      persistJobs(true);
      notifyEvent({type:"sftp", level:"success", title:"SFTP 下载已完成", message:`${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}`, action:{view:"sftp", connection_id:job.connection_id}}, {cooldown_ms:0});
    }
  }

  function getSftpJobFile(id: string) {
    const job = jobs.get(id) || readHistory().find((item: any) => item.id === id);
    if (!job) throw new Error("任务不存在");
    if (job.type !== "download") throw new Error("该任务没有可下载的文件");
    if (!fs.existsSync(job.temp_path)) throw new Error("临时文件不存在");
    return {path:job.temp_path, name:job.download_name || path.posix.basename(job.remote_path || "download")};
  }

  function startArchiveDownloadJob(connectionId: number, remotePaths: unknown, options: any = {}) {
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
    fs.mkdirSync(downloadsDirectory, {recursive:true});
    const tempPath = path.join(downloadsDirectory, `${id}-${basename}`);
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
      status:"pending",
      stdout:"",
      stderr:"",
      error:"",
      size:0,
      size_known:false,
      progress_known:false,
      transferred:0,
      progress:0,
      created_at:Date.now(),
      started_at:null,
      finished_at:null
    };
    resetTransferSpeed(job);
    jobs.set(id, job);
    persistJobs();
    queueTransferJob("download", job, () => {
      const command = `tar -C ${remotePathOperand(connection, parent)} -czf - -- ${names.map(name => remotePathOperand(connection, name)).join(" ")}`;
      const child = spawnRemote(connection, command);
      const out = fs.createWriteStream(tempPath);
      job.child = child;
      job.out = out;
      let finished = false;
      const finish = (status: string, error = "") => {
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
        releaseTransferSlot(job);
        persistJobs(true);
        notifyEvent({
          type:"sftp",
          level:status === "done" ? "success" : "error",
          title:status === "done" ? "SFTP 打包下载已完成" : "SFTP 打包下载失败",
          message:`${job.connection_name} · ${job.label}${job.saved_path ? `\n已保存到 ${job.saved_path}` : ""}${error ? `\n${error}` : ""}`,
          action:{view:"sftp", connection_id:job.connection_id}
        }, {cooldown_ms:0});
      };
      child.stdout.on("data", (chunk: any) => {
        if (!out.write(chunk)) { child.stdout.pause(); out.once("drain", () => child.stdout.resume()); }
        recordTransferred(job, chunk.length);
        persistJobs();
      });
      child.stderr.on("data", (chunk: any) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
      child.on("error", (error: any) => { try { out.destroy(); } catch {} finish("failed", error.message); });
      child.on("close", (code: number | null) => {
        out.end(() => finish(code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}`)));
      });
    }, {phase:"archiving", current:"正在打包并下载"});
    return {id, status:job.status, delivery_mode:job.delivery_mode};
  }

  function markSftpJobDelivered(id: string) {
    const job = jobs.get(id) || readHistory().find((item: any) => item.id === id);
    if (!job || job.type !== "download") return {ok:false};
    job.delivery_status = "delivered";
    job.delivered_at = Date.now();
    if (jobs.has(id)) persistJobs(true);
    else writeJsonJobs(readHistory());
    return {ok:true};
  }

  return {
    getRemoteSize,
    getSftpJobFile,
    markSftpJobDelivered,
    runDownloadJob,
    startArchiveDownloadJob,
    startDownloadJob,
    startLocalDeliveryJob
  };
}

module.exports = { createSftpDownloadJobs };
