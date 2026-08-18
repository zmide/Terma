const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { remotePathOperand, shellQuote, spawnRemote } = require("./sftp-job-paths");
const { clearSftpJobIssue, setSftpJobIssue } = require("./sftp-job-issues");
const { archiveTarCreateOptions, normalizeArchiveFilenameEncoding } = require("./sftp-operation-commands");

function codedSftpJobError(message: string, code: string, params: any = {}) {
  const error: any = new Error(message);
  error.sftpJobCode = code;
  error.sftpJobParams = params;
  return error;
}

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
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(codedSftpJobError("获取远程文件大小超时", "sftp_remote_size_timeout")); }, 15000);
      child.stdout.on("data", (chunk: any) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk: any) => { err += chunk.toString(); });
      child.on("error", (error: any) => { clearTimeout(timer); reject(error); });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          if (err.trim()) return reject(new Error(err.trim()));
          return reject(codedSftpJobError(`读取远程文件大小失败（退出码 ${code ?? "?"}）`, "sftp_remote_size_failed", {exit_code:code}));
        }
        const size = Number((out || "").trim());
        resolve(Number.isFinite(size) ? size : 0);
      });
    });
  }

  function cleanupRemoteArchiveArtifact(job: any) {
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
      clearSftpJobIssue(job, "delivery_error");
    } catch (error: any) {
      job.delivery_status = "failed";
      setSftpJobIssue(job, "delivery_error", error.message || String(error));
    }
  }

  function savedDownloadIsFile(job: any) {
    if (!job?.saved_path) return false;
    try { return fs.statSync(job.saved_path).isFile(); }
    catch { return false; }
  }

  function downloadCompletionAction(job: any) {
    const hasSavedPath = Boolean(job?.saved_path);
    const savedFile = savedDownloadIsFile(job);
    return {
      view:"sftp",
      connection_id:job.connection_id,
      download_job_id:job.id,
      can_open_file:savedFile,
      can_open_directory:hasSavedPath,
      can_delete_file:savedFile
    };
  }

  function downloadCompletionMessage(job: any) {
    return job?.saved_path ? `已保存到 ${job.saved_path}` : `${job.connection_name} · ${job.label}`;
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
      resume_supported:false,
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
          message:downloadCompletionMessage(current),
          action:downloadCompletionAction(current)
        }, {cooldown_ms:0});
      } catch (error: any) {
        current.status = "failed";
        current.phase = "";
        current.current = "";
        current.delivery_status = "failed";
        if (error?.message) setSftpJobIssue(current, "error", error.message, error.sftpJobCode || "", error.sftpJobParams || {});
        else setSftpJobIssue(current, "error", "下载到本机失败", "sftp_local_delivery_failed");
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
      can_pause:true,
      resume_supported:true,
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
          clearSftpJobIssue(job, "warning");
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
        job.phase = "downloading";
        job.current = job.archive_download ? "正在下载远端压缩包" : "正在下载";
        job.can_pause = true;
        job.started_at = job.started_at || Date.now();
        job.finished_at = null;
        clearSftpJobIssue(job, "error");
        resetTransferSpeed(job);
        persistJobs();
        let paused = false;
        let childClosed = false;
        let stdoutEnded = false;
        let outputEnding = false;
        let closeCode: number | null = null;
        let closeSignal: string | null = null;
        const finish = (status: string, error = "", errorCode = "", errorParams: any = {}) => {
          if (ignoreStoppedTransferFinish(job, status)) return;
          if (job.finished_at && status !== "paused") return;
          try { out.destroy(); } catch {}
          if (status !== "paused") try { child.kill("SIGTERM"); } catch {}
          if (status === "done") {
            job.transferred = (job.size || fs.existsSync(job.temp_path)) ? fs.statSync(job.temp_path).size : job.transferred;
            job.progress = 100;
          }
          job.status = status;
          if (error || status === "done") setSftpJobIssue(job, "error", error, errorCode, errorParams);
          if (status !== "paused") job.finished_at = Date.now();
          if (status !== "paused") finishTransferMetrics(job);
          if (status === "done" && job.delivery_mode === "desktop") autoSaveDownloadedFile(job);
          if (status === "done" && job.archive_download) cleanupRemoteArchiveArtifact(job);
          releaseTransferSlot(job);
          persistJobs(status !== "paused");
          if (status === "done" || status === "failed") {
            notifyEvent({
              type:"sftp",
              level:status === "done" ? "success" : "error",
              title:job.archive_download
                ? (status === "done" ? "SFTP 打包下载已完成" : "SFTP 打包下载失败")
                : (status === "done" ? "SFTP 下载已完成" : "SFTP 下载失败"),
              message:`${status === "done" ? downloadCompletionMessage(job) : `${job.connection_name} · ${job.label}`}${job.warning ? `\n${job.warning}` : ""}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}${job.error ? `\n${job.error}` : ""}`,
              action:status === "done" ? downloadCompletionAction(job) : {view:"sftp", connection_id:job.connection_id}
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
              const actualSize = formatSftpTransferSize(realSize);
              const initialSize = formatSftpTransferSize(initialRemoteSize);
              const finalSize = finalSizeKnown ? formatSftpTransferSize(finalRemoteSize) : "";
              setSftpJobIssue(
                job,
                "warning",
                `远端文件在下载期间发生变化；已保存本次读取到的 ${actualSize} 快照（开始 ${initialSize}${finalSizeKnown ? `，结束 ${finalSize}` : ""}）`,
                finalSizeKnown ? "sftp_source_changed_with_final_size" : "sftp_source_changed",
                {actual_size:actualSize, initial_size:initialSize, final_size:finalSize}
              );
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
              finish("failed", `下载不完整：应为 ${Number(job.size || 0)} 字节，实际 ${realSize} 字节`, "sftp_download_incomplete", {expected:Number(job.size || 0), actual:realSize});
              return;
            }
            if (job.stderr) finish("failed", job.stderr);
            else finish("failed", `退出码 ${closeCode ?? ""}${closeSignal ? `，信号 ${closeSignal}` : ""}`, closeSignal ? "sftp_process_exit_with_signal" : "sftp_process_exit", {exit_code:closeCode, signal:closeSignal || ""});
          })().catch((error: any) => {
            if (error?.message) finish("failed", error.message, error.sftpJobCode || "", error.sftpJobParams || {});
            else finish("failed", "下载完整性校验失败", "sftp_download_integrity_check_failed");
          }));
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
        if (error?.message) setSftpJobIssue(job, "error", error.message, error.sftpJobCode || "", error.sftpJobParams || {});
        else setSftpJobIssue(job, "error", "下载启动失败", "sftp_download_start_failed");
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
      job.phase = "";
      job.current = job.archive_download ? "打包下载已完成" : "下载已完成";
      clearSftpJobIssue(job, "error");
      job.can_pause = false;
      job.can_cancel = false;
      job.finished_at = Date.now();
      finishTransferMetrics(job);
      if (job.delivery_mode === "desktop") autoSaveDownloadedFile(job);
      if (job.archive_download) cleanupRemoteArchiveArtifact(job);
      releaseTransferSlot(job);
      persistJobs(true);
      notifyEvent({type:"sftp", level:"success", title:job.archive_download ? "SFTP 打包下载已完成" : "SFTP 下载已完成", message:`${downloadCompletionMessage(job)}${job.delivery_error ? `\n自动保存失败：${job.delivery_error}` : ""}`, action:downloadCompletionAction(job)}, {cooldown_ms:0});
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
    const rawPaths = Array.isArray(remotePaths) ? remotePaths : [];
    const paths = [...new Set(rawPaths.map(item => {
      const value = String(item || "").replace(/\\/g, "/");
      if (!value || value.includes("\0") || value.length > 4096) throw new Error("打包下载路径无效");
      const normalized = path.posix.normalize(value);
      if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized === "/") {
        throw new Error("打包下载路径无效");
      }
      return normalized;
    }))];
    if (!paths.length || paths.length > 200) throw new Error("一次最多打包下载 200 个项目");
    const parents = new Set(paths.map(item => path.posix.dirname(item.replace(/\/+$/, "")) || "."));
    if (parents.size !== 1) throw new Error("打包下载的项目必须位于同一目录");
    const parent = [...parents][0];
    const names = paths.map(item => {
      const name = path.posix.basename(item.replace(/\/+$/, ""));
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) throw new Error("打包下载文件名无效");
      return name;
    });
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const requestedName = String(options.filename || "").trim().replace(/\\/g, "/");
    if (requestedName.includes("/") || requestedName.includes("\0")) throw new Error("打包下载文件名不能包含路径");
    let basename = path.posix.basename(requestedName || `terma-${timestamp}.tar.gz`);
    if (!/\.(?:tar\.gz|tgz)$/i.test(basename)) basename = `${basename}.tar.gz`;
    if (Buffer.byteLength(basename, "utf8") > 255) throw new Error("打包下载文件名过长");
    const filenameEncoding = normalizeArchiveFilenameEncoding(options.encoding);
    fs.mkdirSync(downloadsDirectory, {recursive:true});
    const tempPath = path.join(downloadsDirectory, `${id}-${basename}`);
    const job: any = {
      id,
      connection_id:Number(connectionId),
      connection_name:connection.name,
      type:"download",
      label:`打包下载 ${paths.length} 项`,
      archive_download:true,
      archive_source_paths:paths,
      archive_parent:parent,
      archive_names:names,
      archive_filename_encoding:filenameEncoding,
      archive_ready:false,
      remote_archive_path:"",
      remote_paths:paths,
      remote_path:"",
      download_name:basename,
      temp_path:tempPath,
      delivery_mode:options.deliveryMode === "desktop" ? "desktop" : "browser",
      delivery_status:"pending",
      auto_save_directory:options.deliveryMode === "desktop" ? String(options.autoSaveDirectory || "") : "",
      status:"pending",
      can_pause:false,
      can_cancel:true,
      resume_supported:true,
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
    queueTransferJob("download", job, () => prepareArchiveDownloadJob(id), {phase:"archiving", current:"正在远端生成压缩包"});
    return {id, status:job.status, delivery_mode:job.delivery_mode};
  }

  function failArchivePreparation(job: any, error: unknown) {
    if (!job) return;
    cleanupRemoteArchiveArtifact(job);
    if (job.status === "cancelled" || job.status === "paused") return;
    job.status = "failed";
    job.phase = "";
    job.current = "";
    job.can_pause = false;
    job.can_cancel = false;
    if (error instanceof Error && error.message) setSftpJobIssue(job, "error", error.message, (error as any).sftpJobCode || "", (error as any).sftpJobParams || {});
    else setSftpJobIssue(job, "error", String(error || "远端打包失败"), "sftp_archive_prepare_failed");
    job.finished_at = Date.now();
    finishTransferMetrics(job);
    releaseTransferSlot(job);
    persistJobs(true);
    notifyEvent({
      type:"sftp",
      level:"error",
      title:"SFTP 打包下载失败",
      message:`${job.connection_name} · ${job.label}\n${job.error}`,
      action:{view:"sftp", connection_id:job.connection_id}
    }, {cooldown_ms:0});
  }

  function prepareArchiveDownloadJob(id: string) {
    const job = jobs.get(id);
    if (!job) return;
    const connection = getSftpConnection(job.connection_id);
    const marker = `__TERMA_ARCHIVE_${crypto.randomBytes(12).toString("hex")}__:`;
    const parent = String(job.archive_parent || ".");
    const names = Array.isArray(job.archive_names) ? job.archive_names : [];
    const tarOptions = archiveTarCreateOptions(normalizeArchiveFilenameEncoding(job.archive_filename_encoding));
    const command = [
      `td_archive=$(mktemp "\${TMPDIR:-/tmp}/terma-download-XXXXXXXX.tar.gz") || exit $?`,
      `trap 'rm -f -- "$td_archive"; exit 130' 1 2 3 15`,
      `printf '%s%s\\n' ${shellQuote(marker)} "$td_archive"`,
      `if tar ${tarOptions}-C ${remotePathOperand(connection, parent)} -czf "$td_archive" -- ${names.map((name: string) => remotePathOperand(connection, name)).join(" ")}; then trap - 1 2 3 15; exit 0; else td_status=$?; trap - 1 2 3 15; rm -f -- "$td_archive"; exit "$td_status"; fi`
    ].join("; ");
    const child = spawnRemote(connection, command);
    job.child = child;
    job.status = "running";
    job.phase = "archiving";
    job.current = "正在远端生成稳定压缩包";
    job.can_pause = false;
    job.can_cancel = true;
    clearSftpJobIssue(job, "error");
    job.finished_at = null;
    job.started_at = job.started_at || Date.now();
    job.archive_ready = false;
    resetTransferSpeed(job);
    persistJobs(true);
    let stdout = "";
    let stderr = "";
    const captureArchivePath = () => {
      const line = stdout.split(/\r?\n/).find(item => item.startsWith(marker));
      const remotePath = line ? line.slice(marker.length).trim() : "";
      if (!remotePath || remotePath.includes("\0") || remotePath.includes("\n") || remotePath.length > 4096) return;
      job.remote_archive_path = remotePath;
      persistJobs();
      if (job.status === "cancelled") cleanupRemoteArchiveArtifact(job);
    };
    child.stdout.on("data", (chunk: any) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-16000);
      captureArchivePath();
    });
    child.stderr.on("data", (chunk: any) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
      job.stderr = stderr;
      persistJobs();
    });
    child.on("error", (error: any) => failArchivePreparation(job, error));
    child.on("close", (code: number | null, signal: string | null) => {
      job.child = null;
      captureArchivePath();
      if (job.status === "cancelled" || job.status === "paused") {
        cleanupRemoteArchiveArtifact(job);
        return;
      }
      if (code !== 0 || !job.remote_archive_path) {
        if (stderr) failArchivePreparation(job, new Error(stderr));
        else failArchivePreparation(job, codedSftpJobError(`远端打包失败（退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}）`, signal ? "sftp_archive_prepare_process_exit_with_signal" : "sftp_archive_prepare_process_exit", {exit_code:code, signal:signal || ""}));
        return;
      }
      job.archive_ready = true;
      job.remote_path = job.remote_archive_path;
      job.phase = "preparing";
      job.current = "压缩完成，正在开始断点下载";
      job.can_pause = false;
      if (fs.existsSync(job.temp_path)) fs.truncateSync(job.temp_path, 0);
      job.transferred = 0;
      job.size = 0;
      job.size_known = false;
      job.progress_known = false;
      persistJobs(true);
      runDownloadJob(id, true);
    });
  }

  function resumeArchiveDownloadJob(job: any) {
    if (job.archive_ready && job.remote_archive_path) {
      job.remote_path = job.remote_archive_path;
      queueTransferJob("download", job, () => runDownloadJob(job.id, false), {phase:"preparing", current:"正在继续压缩包下载"});
    } else {
      cleanupRemoteArchiveArtifact(job);
      if (job.temp_path && fs.existsSync(job.temp_path)) fs.truncateSync(job.temp_path, 0);
      queueTransferJob("download", job, () => prepareArchiveDownloadJob(job.id), {phase:"archiving", current:"正在重新生成远端压缩包"});
    }
    return {ok:true, status:job.status};
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
    cleanupRemoteArchiveArtifact,
    markSftpJobDelivered,
    prepareArchiveDownloadJob,
    resumeArchiveDownloadJob,
    runDownloadJob,
    startArchiveDownloadJob,
    startDownloadJob,
    startLocalDeliveryJob
  };
}

module.exports = { createSftpDownloadJobs };
