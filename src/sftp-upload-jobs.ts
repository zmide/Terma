const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { remotePathOperand, shellQuote, spawnRemote } = require("./sftp-job-paths");

function createSftpUploadJobs(dependencies: any) {
  const {
    cleanupJobArtifacts,
    dataDir,
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
  } = dependencies;

  function uploadJobResult(job: any) {
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

  function createUploadJob(connectionId: number, localPath: string, remotePath: string, size = 0, phase = "uploading", options: any = {}) {
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

  function uploadRemoteWriteCommand(connection: any, job: any, append = false) {
    const operator = append ? ">>" : ">";
    return `cat ${operator} ${remotePathOperand(connection, job.remote_temp_path)}`;
  }

  function uploadRemoteCommitCommand(connection: any, job: any) {
    const temporary = remotePathOperand(connection, job.remote_temp_path);
    const target = remotePathOperand(connection, job.remote_path);
    const expectedSize = Math.max(0, Number(job.size || 0));
    return [
      `if [ ! -f ${temporary} ]; then echo "远端上传暂存文件不存在" >&2; exit 1; fi`,
      expectedSize
        ? `terma_upload_size=$(wc -c < ${temporary} | tr -d '[:space:]'); if [ "$terma_upload_size" != ${shellQuote(String(expectedSize))} ]; then echo "远端上传内容不完整" >&2; exit 1; fi`
        : "",
      `if [ -d ${target} ]; then echo "目标路径是目录，无法覆盖" >&2; exit 1; fi`,
      job.conflict_mode === "overwrite"
        ? ""
        : `if [ -e ${target} ] || [ -L ${target} ]; then echo "目标目录已存在同名项目" >&2; exit 1; fi`,
      `${job.conflict_mode === "overwrite" ? "mv -f" : "mv"} -- ${temporary} ${target}`
    ].filter(Boolean).join(" && ");
  }

  function cleanupRemoteUploadArtifact(job: any) {
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

  function finishUploadTransfer(job: any, status: string, error = "") {
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
    releaseTransferSlot(job);
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

  function commitUploadTransfer(job: any, generation: number) {
    if (!job || job.status !== "running" || Number(job.upload_generation || 0) !== Number(generation)) return;
    const connection = getSftpConnection(job.connection_id);
    const child = spawnRemote(connection, uploadRemoteCommitCommand(connection, job));
    job.child = child;
    job.stream = null;
    job.phase = "committing";
    job.can_pause = false;
    updateTransferProgress(job);
    persistJobs(true);
    child.stdout.on("data", (chunk: any) => { job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000); persistJobs(); });
    child.stderr.on("data", (chunk: any) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
    child.on("error", (error: any) => {
      if (Number(job.upload_generation || 0) !== Number(generation)) return;
      finishUploadTransfer(job, "failed", error.message);
    });
    child.on("close", (code: number | null, signal: string | null) => {
      if (Number(job.upload_generation || 0) !== Number(generation)) return;
      if (job.status === "cancelled" || job.status === "paused") return;
      finishUploadTransfer(job, code === 0 ? "done" : "failed", code === 0 ? "" : (job.stderr || `退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`));
    });
    child.stdin.end();
  }

  function finishUploadReceiveFailure(job: any, error: any) {
    if (!job || job.status === "cancelled") return;
    job.status = "failed";
    job.can_pause = false;
    job.error = error?.message || String(error || "文件接收失败");
    job.finished_at = Date.now();
    finishTransferMetrics(job);
    releaseTransferSlot(job);
    cleanupJobArtifacts(job);
    persistJobs(true);
  }

  function startUploadTransfer(job: any, offset = 0, generation = 0) {
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

    stream.on("data", (chunk: any) => {
      if (Number(job.upload_generation || 0) !== runGeneration || job.status !== "running" || job.phase !== "uploading") return;
      recordTransferred(job, chunk.length);
      persistJobs();
    });
    stream.on("error", (error: any) => {
      if (Number(job.upload_generation || 0) !== runGeneration) return;
      try { child.kill("SIGKILL"); } catch {}
      finishUploadTransfer(job, "failed", error.message);
    });
    child.stdout.on("data", (chunk: any) => { job.stdout = `${job.stdout}${chunk.toString()}`.slice(-12000); persistJobs(); });
    child.stderr.on("data", (chunk: any) => { job.stderr = `${job.stderr}${chunk.toString()}`.slice(-12000); persistJobs(); });
    child.on("error", (error: any) => {
      if (Number(job.upload_generation || 0) !== runGeneration) return;
      finishUploadTransfer(job, "failed", error.message);
    });
    child.on("close", (code: number | null, signal: string | null) => {
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

  function startUploadJob(connectionId: number, localPath: string, remotePath: string, size = 0) {
    const job = createUploadJob(connectionId, localPath, remotePath, size, "uploading", {sizeKnown:true});
    job.conflict_mode = "overwrite";
    jobs.set(job.id, job);
    persistJobs(true);
    queueTransferJob("upload", job, () => {
      startUploadTransfer(job);
      resolveTransferWaiters(job);
    }, {phase:"uploading", current:"正在上传"});
    return uploadJobResult(job);
  }

  function startUploadReceiveJob(connectionId: number, remotePath: string, filename: string, size = 0, options: any = {}) {
    const directory = path.join(dataDir, "uploads");
    fs.mkdirSync(directory, {recursive:true});
    const safeName = path.basename(String(filename || "upload.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "upload.bin";
    const localPath = path.join(directory, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`);
    const job = createUploadJob(connectionId, localPath, remotePath, size, "receiving", {sizeKnown:options.sizeKnown !== false});
    job.conflict_mode = options.conflict === "overwrite" ? "overwrite" : "error";
    jobs.set(job.id, job);
    persistJobs(true);
    queueTransferJob("upload", job, () => resolveTransferWaiters(job), {
      phase:"receiving",
      current:"正在接收文件",
      queuedCurrent:"等待上传并发额度"
    });
    return uploadJobResult(job);
  }

  function uploadReceiveCancelledError() {
    const error: any = new Error("上传已取消");
    error.code = "SFTP_UPLOAD_CANCELLED";
    return error;
  }

  async function receiveUploadJobContent(id: string, request: any) {
    const job = jobs.get(id);
    if (!job || job.type !== "upload") throw new Error("上传任务不存在");
    if (job.status === "cancelled") throw uploadReceiveCancelledError();
    if (job.status === "pending") await waitForSftpTransferStart(id);
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
      const fail = (source: any) => {
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
        } catch (error: any) {
          finishUploadReceiveFailure(job, error);
          reject(error);
        }
      };
      request.on("data", (chunk: any) => {
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

  function resumeUploadJob(id: string) {
    const job = jobs.get(id);
    if (!job) return;
    if (!job.staged_complete || !job.local_path || !fs.existsSync(job.local_path)) throw new Error("上传暂存文件不存在，无法继续");
    queueTransferJob("upload", job, () => {
      const connection = getSftpConnection(job.connection_id);
      job.error = "";
      const generation = Math.max(0, Number(job.upload_generation || 0)) + 1;
      job.upload_generation = generation;
      const temporary = remotePathOperand(connection, job.remote_temp_path);
      const child = spawnRemote(connection, `if [ -f ${temporary} ]; then wc -c < ${temporary} | tr -d ' '; else printf '0'; fi`);
      job.child = child;
      job.phase = "resuming";
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: any) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: any) => { stderr += chunk.toString(); });
      child.on("error", (error: any) => {
        if (Number(job.upload_generation || 0) !== generation) return;
        finishUploadTransfer(job, "failed", error.message);
      });
      child.on("close", (code: number | null) => {
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
    }, {phase:"resuming", current:"正在继续上传"});
  }

  return {
    cleanupRemoteUploadArtifact,
    receiveUploadJobContent,
    resumeUploadJob,
    startUploadJob,
    startUploadReceiveJob,
    uploadReceiveCancelledError
  };
}

module.exports = { createSftpUploadJobs };
