const crypto = require("node:crypto");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { clearSftpJobIssue, setSftpJobIssue } = require("./sftp-job-issues");

const MAX_CHECKPOINT_ENTRIES = 10000;

function codedSftpJobError(message: string, code: string, params: any = {}, internalCode = "") {
  const error: any = new Error(message);
  if (internalCode) error.code = internalCode;
  error.sftpJobCode = code;
  error.sftpJobParams = params;
  return error;
}

function checkpointJobIssue(error: any) {
  const message = error?.message || String(error || "");
  if (error?.sftpJobCode) return {message, code:error.sftpJobCode, params:error.sftpJobParams || {}};
  const targetExists = message.match(/^目标目录已存在同名项目：(.+)$/);
  if (targetExists) return {message, code:"sftp_cross_copy_target_exists", params:{name:targetExists[1]}};
  return {message, code:"", params:{}};
}

function sftpCall(channel: any, method: string, ...args: any[]) {
  return new Promise((resolve, reject) => {
    channel[method](...args, (error: any, value: any) => error ? reject(error) : resolve(value));
  });
}

async function remoteLstat(channel: any, remotePath: string) {
  return sftpCall(channel, "lstat", remotePath);
}

async function remoteReaddir(channel: any, remotePath: string) {
  return await sftpCall(channel, "readdir", remotePath) as any[] || [];
}

async function remoteReadlink(channel: any, remotePath: string) {
  return String(await sftpCall(channel, "readlink", remotePath) || "");
}

async function remoteExists(channel: any, remotePath: string) {
  try {
    await remoteLstat(channel, remotePath);
    return true;
  } catch (error: any) {
    if ([2, "2", "ENOENT"].includes(error?.code)) return false;
    throw error;
  }
}

async function ensureRemoteDirectory(channel: any, remotePath: string) {
  const normalized = path.posix.normalize(String(remotePath || ".").replace(/\\/g, "/")) || ".";
  if (normalized === "." || normalized === "/") return;
  const absolute = normalized.startsWith("/");
  let current = absolute ? "/" : "";
  for (const part of normalized.split("/").filter(Boolean)) {
    current = current === "/" ? `/${part}` : current ? `${current}/${part}` : part;
    try {
      await sftpCall(channel, "mkdir", current);
    } catch (error: any) {
      try {
        const stats: any = await remoteLstat(channel, current);
        if (!stats?.isDirectory?.()) throw error;
      } catch {
        throw error;
      }
    }
  }
}

function normalizedRemotePaths(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => (
    path.posix.normalize(String(item || "").replace(/\\/g, "/"))
  )).filter(Boolean))];
}

function validRemoteSelection(paths: string[]) {
  return paths.length > 0
    && paths.length <= 200
    && paths.every(item => !item.includes("\0") && item !== "." && item !== ".." && !item.startsWith("../") && item.length <= 4096);
}

function manifestTransferred(manifest: any[]) {
  return manifest.reduce((total, entry) => total + (entry.type === "file" ? Math.max(0, Number(entry.transferred || 0)) : 0), 0);
}

function safeEntryName(value: unknown) {
  const name = String(value || "");
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw codedSftpJobError("远程文件名无效", "sftp_remote_filename_invalid");
  }
  return name;
}

async function availableTargetName(channel: any, targetDir: string, requested: string, reserved: Set<string>) {
  const extension = path.posix.extname(requested);
  const base = extension && extension !== requested ? requested.slice(0, -extension.length) : requested;
  for (let index = 0; index < 10000; index += 1) {
    const name = index === 0 ? requested : `${base} (${index})${extension}`;
    if (reserved.has(name)) continue;
    if (!await remoteExists(channel, path.posix.join(targetDir, name))) {
      reserved.add(name);
      return name;
    }
  }
  throw codedSftpJobError(`无法为 ${requested} 分配可用名称`, "sftp_cross_copy_name_unavailable", {name:requested});
}

async function buildManifest(channel: any, sourcePaths: string[], topLevelNames: Map<string, string>) {
  const manifest: any[] = [];
  const append = async (sourcePath: string, relativePath: string) => {
    if (manifest.length >= MAX_CHECKPOINT_ENTRIES) {
      throw codedSftpJobError(`一次最多处理 ${MAX_CHECKPOINT_ENTRIES} 个文件和目录`, "sftp_cross_copy_too_many_entries", {max:MAX_CHECKPOINT_ENTRIES});
    }
    const stats: any = await remoteLstat(channel, sourcePath);
    const common = {
      source_path:sourcePath,
      relative_path:relativePath,
      mode:Math.max(0, Number(stats?.mode || 0)),
      mtime:Math.max(0, Number(stats?.mtime || 0))
    };
    if (stats?.isSymbolicLink?.()) {
      manifest.push({...common, type:"symlink", size:0, link_target:await remoteReadlink(channel, sourcePath), transferred:0, status:"pending"});
      return;
    }
    if (stats?.isDirectory?.()) {
      manifest.push({...common, type:"directory", size:0, transferred:0, status:"pending"});
      const children = (await remoteReaddir(channel, sourcePath))
        .filter(item => item?.filename && item.filename !== "." && item.filename !== "..")
        .sort((left, right) => String(left.filename).localeCompare(String(right.filename)));
      for (const child of children) {
        const name = safeEntryName(child.filename);
        await append(path.posix.join(sourcePath, name), path.posix.join(relativePath, name));
      }
      return;
    }
    manifest.push({...common, type:"file", size:Math.max(0, Number(stats?.size || 0)), transferred:0, status:"pending"});
  };
  for (const sourcePath of sourcePaths) {
    const sourceName = safeEntryName(path.posix.basename(sourcePath.replace(/\/+$/, "")));
    await append(sourcePath, topLevelNames.get(sourceName) || sourceName);
  }
  return manifest;
}

function closeChannel(channel: any) {
  try { channel?.end?.(); } catch {}
}

function sourceChangedError(entry: any) {
  return codedSftpJobError(
    `源文件在传输期间发生变化：${entry.source_path}`,
    "sftp_cross_copy_source_changed",
    {path:entry.source_path},
    "SFTP_SOURCE_CHANGED"
  );
}

async function validateSourceEntry(channel: any, entry: any) {
  const stats: any = await remoteLstat(channel, entry.source_path);
  if (!stats) throw sourceChangedError(entry);
  if (entry.type === "file") {
    if (stats.isDirectory?.() || stats.isSymbolicLink?.()) throw sourceChangedError(entry);
    if (Number(stats.size || 0) !== Number(entry.size || 0) || Number(stats.mtime || 0) !== Number(entry.mtime || 0)) throw sourceChangedError(entry);
    return;
  }
  if (entry.type === "directory") {
    if (!stats.isDirectory?.() || Number(stats.mtime || 0) !== Number(entry.mtime || 0)) throw sourceChangedError(entry);
    return;
  }
  if (entry.type === "symlink") {
    if (!stats.isSymbolicLink?.() || await remoteReadlink(channel, entry.source_path) !== String(entry.link_target || "")) throw sourceChangedError(entry);
    return;
  }
  throw sourceChangedError(entry);
}

async function transferFile(job: any, sourceChannel: any, targetChannel: any, entry: any, targetPath: string, dependencies: any) {
  await ensureRemoteDirectory(targetChannel, path.posix.dirname(targetPath));
  await validateSourceEntry(sourceChannel, entry);
  let offset = 0;
  try {
    const targetStats: any = await remoteLstat(targetChannel, targetPath);
    if (targetStats?.isDirectory?.() || targetStats?.isSymbolicLink?.()) {
      throw codedSftpJobError(
        `目标检查点类型异常：${entry.relative_path}`,
        "sftp_cross_copy_checkpoint_type_invalid",
        {path:entry.relative_path},
        "SFTP_CHECKPOINT_CORRUPT"
      );
    }
    offset = Math.max(0, Number(targetStats?.size || 0));
  } catch (error: any) {
    if (![2, "2", "ENOENT"].includes(error?.code)) throw error;
  }
  if (offset > Number(entry.size || 0)) {
    await sftpCall(targetChannel, "unlink", targetPath).catch(() => {});
    offset = 0;
  }
  entry.transferred = offset;
  job.transferred = manifestTransferred(job.checkpoint_manifest || []);
  dependencies.updateTransferProgress(job);
  dependencies.persistJobs(true);
  if (offset === Number(entry.size || 0)) {
    entry.status = "done";
    return;
  }
  const input = sourceChannel.createReadStream(entry.source_path, {start:offset, autoClose:true});
  const output = targetChannel.createWriteStream(targetPath, {flags:offset > 0 ? "a" : "w", autoClose:true});
  job.stream = input;
  job.out = output;
  job.pauseNow = () => {
    try { input.destroy(); } catch {}
    try { output.destroy(); } catch {}
  };
  let transferred = offset;
  input.on("data", (chunk: any) => {
    if (job.status !== "running") return;
    const length = Math.max(0, Number(chunk?.length || 0));
    transferred += length;
    entry.transferred = Math.min(Number(entry.size || transferred), transferred);
    dependencies.recordTransferred(job, length);
    dependencies.persistJobs();
  });
  try {
    await pipeline(input, output);
  } finally {
    job.stream = null;
    job.out = null;
    job.pauseNow = null;
  }
  if (job.status === "paused" || job.status === "cancelled") return;
  const targetStats: any = await remoteLstat(targetChannel, targetPath);
  if (Number(targetStats?.size || 0) !== Number(entry.size || 0)) {
    throw codedSftpJobError(
      `目标临时文件大小不一致：${entry.relative_path}`,
      "sftp_cross_copy_checkpoint_size_mismatch",
      {path:entry.relative_path},
      "SFTP_CHECKPOINT_CORRUPT"
    );
  }
  entry.transferred = Number(entry.size || 0);
  entry.status = "done";
  try { if (entry.mode) await sftpCall(targetChannel, "chmod", targetPath, entry.mode & 0o7777); } catch {}
  try { if (entry.mtime) await sftpCall(targetChannel, "utimes", targetPath, entry.mtime, entry.mtime); } catch {}
  dependencies.persistJobs(true);
}

function waitRemoteCommand(child: any, job: any) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on?.("data", (chunk: any) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
      job.stderr = stderr;
    });
    child.once?.("error", reject);
    child.once?.("close", (code: number | null, signal: string | null) => {
      if (code === 0) resolve(undefined);
      else if (stderr) reject(new Error(stderr));
      else reject(codedSftpJobError(`退出码 ${code ?? ""}${signal ? `，信号 ${signal}` : ""}`, signal ? "sftp_process_exit_with_signal" : "sftp_process_exit", {exit_code:code, signal:signal || ""}));
    });
    child.stdin?.end?.();
  });
}

function commitCommand(connection: any, job: any, remotePathOperand: any, shellQuote: any) {
  const targetDir = String(job.target_directory || ".");
  const staging = String(job.checkpoint_staging_path || "");
  const stagingName = path.posix.basename(staging);
  const topLevel = Array.isArray(job.checkpoint_top_level) ? job.checkpoint_top_level : [];
  const overwrite = job.conflict_mode === "overwrite";
  const checks: string[] = [];
  const placements: string[] = [];
  const rollback: string[] = [];
  topLevel.forEach((item: any, index: number) => {
    const name = safeEntryName(item.target_name);
    const target = remotePathOperand(connection, `./${name}`);
    const staged = remotePathOperand(connection, `./${stagingName}/incoming/${name}`);
    const backup = remotePathOperand(connection, `./${stagingName}/backup/${index}`);
    const marker = remotePathOperand(connection, `./${stagingName}/placed-${index}`);
    if (!overwrite) checks.push(`if [ -e ${target} ] || [ -L ${target} ]; then echo ${shellQuote(`目标目录已存在同名项目：${name}`)} >&2; exit 1; fi`);
    const backupStep = overwrite ? `if [ -e ${target} ] || [ -L ${target} ]; then mv -- ${target} ${backup}; fi; ` : "";
    placements.push(`${backupStep}: > ${marker} && mv -- ${staged} ${target}`);
    rollback.unshift(`if [ -e ${marker} ]; then if [ -e ${target} ] || [ -L ${target} ]; then mv -- ${target} ${staged}; fi; rm -f -- ${marker}; fi; if [ -e ${backup} ] || [ -L ${backup} ]; then mv -- ${backup} ${target}; fi`);
  });
  return [
    `cd ${remotePathOperand(connection, targetDir)} || exit $?`,
    `td_committed=0`,
    `td_cleanup() { td_status=$?; trap - 0 1 2 3 15; if [ "$td_committed" -ne 1 ]; then ${rollback.join("; ")}; fi; if [ "$td_committed" -eq 1 ]; then rm -rf -- ${remotePathOperand(connection, `./${stagingName}`)}; fi; exit "$td_status"; }`,
    "trap td_cleanup 0 1 2 3 15",
    ...checks,
    ...placements,
    "td_committed=1",
    `rm -rf -- ${remotePathOperand(connection, `./${stagingName}`)}`,
    "td_status=$?",
    "trap - 0 1 2 3 15",
    "exit \"$td_status\""
  ].join("; ");
}

function createCheckpointTransfers(dependencies: any) {
  const {
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
  } = dependencies;

  async function prepareCrossCopyJob(job: any) {
    const sourceChannel: any = await openSftpChannel(job.source_connection_id);
    const targetChannel: any = await openSftpChannel(job.target_connection_id);
    try {
      const reserved = new Set<string>();
      const topLevelNames = new Map<string, string>();
      for (const sourcePath of job.source_paths) {
        const sourceName = safeEntryName(path.posix.basename(sourcePath.replace(/\/+$/, "")));
        const targetName = job.conflict_mode === "rename"
          ? await availableTargetName(targetChannel, job.target_directory, sourceName, reserved)
          : sourceName;
        reserved.add(targetName);
        topLevelNames.set(sourceName, targetName);
      }
      job.checkpoint_top_level = job.source_paths.map((sourcePath: string) => {
        const sourceName = safeEntryName(path.posix.basename(sourcePath.replace(/\/+$/, "")));
        return {source_path:sourcePath, source_name:sourceName, target_name:topLevelNames.get(sourceName) || sourceName};
      });
      job.checkpoint_manifest = await buildManifest(sourceChannel, job.source_paths, topLevelNames);
      job.size = job.checkpoint_manifest.reduce((total: number, entry: any) => total + (entry.type === "file" ? Number(entry.size || 0) : 0), 0);
      job.size_known = true;
      job.progress_known = true;
      job.progress_estimated = false;
      job.item_count = job.checkpoint_manifest.length;
      job.checkpoint_staging_path = path.posix.join(job.target_directory, `.terma-cross-copy-${job.id}.part`);
      await ensureRemoteDirectory(targetChannel, path.posix.join(job.checkpoint_staging_path, "incoming"));
      await ensureRemoteDirectory(targetChannel, path.posix.join(job.checkpoint_staging_path, "backup"));
      persistJobs(true);
    } finally {
      closeChannel(sourceChannel);
      closeChannel(targetChannel);
    }
  }

  async function runCrossCopyJob(id: string) {
    const job = jobs.get(id);
    if (!job) return;
    job.status = "running";
    job.started_at = job.started_at || Date.now();
    job.finished_at = null;
    clearSftpJobIssue(job, "error");
    job.can_cancel = true;
    job.can_pause = false;
    job.phase = job.checkpoint_manifest?.length ? "transferring" : "scanning";
    job.current = job.phase === "scanning" ? "正在扫描源文件" : "正在继续跨 SFTP 传输";
    resetTransferSpeed(job);
    persistJobs(true);
    let sourceChannel: any = null;
    let targetChannel: any = null;
    try {
      if (!Array.isArray(job.checkpoint_manifest) || !job.checkpoint_manifest.length) await prepareCrossCopyJob(job);
      if (job.status !== "running") return;
      sourceChannel = await openSftpChannel(job.source_connection_id);
      targetChannel = await openSftpChannel(job.target_connection_id);
      job.phase = "transferring";
      job.can_pause = true;
      job.current = "正在传输文件";
      job.transferred = manifestTransferred(job.checkpoint_manifest);
      updateTransferProgress(job);
      persistJobs(true);
      for (let index = 0; index < job.checkpoint_manifest.length; index += 1) {
        if (job.status !== "running") break;
        const entry = job.checkpoint_manifest[index];
        const targetPath = path.posix.join(job.checkpoint_staging_path, "incoming", entry.relative_path);
        job.item_transferred = index;
        job.current = `${entry.relative_path} · ${index + 1}/${job.checkpoint_manifest.length}`;
        if (entry.type === "directory") {
          await validateSourceEntry(sourceChannel, entry);
          await ensureRemoteDirectory(targetChannel, targetPath);
          entry.status = "done";
        } else if (entry.type === "symlink") {
          await validateSourceEntry(sourceChannel, entry);
          await ensureRemoteDirectory(targetChannel, path.posix.dirname(targetPath));
          if (await remoteExists(targetChannel, targetPath)) {
            const existingTarget = await remoteReadlink(targetChannel, targetPath).catch(() => "");
            if (existingTarget !== String(entry.link_target || "")) {
              throw codedSftpJobError(
                `目标检查点符号链接异常：${entry.relative_path}`,
                "sftp_cross_copy_checkpoint_symlink_invalid",
                {path:entry.relative_path},
                "SFTP_CHECKPOINT_CORRUPT"
              );
            }
          } else {
            await sftpCall(targetChannel, "symlink", entry.link_target, targetPath);
          }
          entry.status = "done";
        } else {
          await transferFile(job, sourceChannel, targetChannel, entry, targetPath, {persistJobs, recordTransferred, updateTransferProgress});
        }
        persistJobs(true);
      }
      if (job.status !== "running") return;
      for (const entry of [...job.checkpoint_manifest].reverse()) {
        if (entry.type !== "directory") continue;
        const targetPath = path.posix.join(job.checkpoint_staging_path, "incoming", entry.relative_path);
        try { if (entry.mode) await sftpCall(targetChannel, "chmod", targetPath, entry.mode & 0o7777); } catch {}
        try { if (entry.mtime) await sftpCall(targetChannel, "utimes", targetPath, entry.mtime, entry.mtime); } catch {}
      }
      closeChannel(sourceChannel);
      closeChannel(targetChannel);
      sourceChannel = null;
      targetChannel = null;
      job.phase = "committing";
      job.can_pause = false;
      job.current = "正在提交到目标目录";
      persistJobs(true);
      const targetConnection = getSftpConnection(job.target_connection_id);
      const child = spawnRemote(targetConnection, commitCommand(targetConnection, job, remotePathOperand, shellQuote));
      job.child = child;
      await waitRemoteCommand(child, job);
      job.child = null;
      if (job.status !== "running") return;
      job.status = "done";
      job.phase = "";
      job.current = "跨 SFTP 传输已完成";
      job.can_pause = false;
      job.can_cancel = false;
      job.transferred = job.size;
      job.progress = 100;
      job.item_transferred = job.item_count;
      job.finished_at = Date.now();
      finishTransferMetrics(job);
      releaseTransferSlot(job);
      persistJobs(true);
      notifyEvent({
        type:"sftp",
        level:"success",
        title:"跨主机复制已完成",
        message:`${job.source_connection_name} → ${job.connection_name} · ${job.source_paths.length} 项`,
        action:{view:"sftp", connection_id:job.target_connection_id}
      }, {cooldown_ms:0});
    } catch (error: any) {
      if (job.status === "paused" || job.status === "cancelled") return;
      job.status = "failed";
      job.phase = "";
      job.can_pause = false;
      job.can_cancel = false;
      const issue = checkpointJobIssue(error);
      setSftpJobIssue(job, "error", issue.message, issue.code, issue.params);
      if (["SFTP_SOURCE_CHANGED", "SFTP_CHECKPOINT_CORRUPT"].includes(error?.code)) job.resume_supported = false;
      job.finished_at = Date.now();
      finishTransferMetrics(job);
      releaseTransferSlot(job);
      persistJobs(true);
      notifyEvent({
        type:"sftp",
        level:"error",
        title:"跨主机复制失败",
        message:`${job.source_connection_name} → ${job.connection_name}\n${job.error}`,
        action:{view:"sftp", connection_id:job.target_connection_id}
      }, {cooldown_ms:0});
    } finally {
      closeChannel(sourceChannel);
      closeChannel(targetChannel);
      job.stream = null;
      job.out = null;
      job.pauseNow = null;
    }
  }

  function startCrossCopyJob(sourceConnectionId: number, targetConnectionId: number, remotePaths: unknown, targetDir = ".", conflictMode = "error") {
    const sourceConnection = getSftpConnection(sourceConnectionId);
    const targetConnection = getSftpConnection(targetConnectionId);
    const sourcePaths = normalizedRemotePaths(remotePaths);
    if (!validRemoteSelection(sourcePaths)) throw new Error("复制路径无效或数量过多");
    const parent = path.posix.dirname(sourcePaths[0]) || ".";
    if (sourcePaths.some(item => (path.posix.dirname(item) || ".") !== parent)) throw new Error("复制的项目必须位于同一目录");
    const normalizedTarget = path.posix.normalize(String(targetDir || ".").replace(/\\/g, "/")) || ".";
    const sameConnection = Number(sourceConnectionId) === Number(targetConnectionId);
    if (sameConnection && sourcePaths.some(sourcePath => normalizedTarget === sourcePath || normalizedTarget.startsWith(`${sourcePath}/`))) {
      throw new Error("不能把远端项目复制到自身或其子目录");
    }
    const conflict = ["error", "overwrite", "rename"].includes(String(conflictMode || "")) ? String(conflictMode) : "error";
    if (sameConnection && conflict !== "rename" && sourcePaths.some(sourcePath => (
      path.posix.join(normalizedTarget, path.posix.basename(sourcePath.replace(/\/+$/, ""))) === sourcePath
    ))) {
      throw new Error("不能用远端项目覆盖自身；如需保留副本，请选择自动改名");
    }
    const id = crypto.randomUUID();
    const job: any = {
      id,
      connection_id:Number(targetConnectionId),
      connection_name:targetConnection.name,
      source_connection_id:Number(sourceConnectionId),
      source_connection_name:sourceConnection.name,
      target_connection_id:Number(targetConnectionId),
      target_directory:normalizedTarget,
      source_paths:sourcePaths,
      conflict_mode:conflict,
      type:"cross-copy",
      label:sameConnection ? `复制 ${sourcePaths.length} 项` : `从 ${sourceConnection.name} 复制 ${sourcePaths.length} 项`,
      status:"pending",
      phase:"scanning",
      current:"等待扫描源文件",
      can_cancel:true,
      can_pause:false,
      resume_supported:true,
      stdout:"",
      stderr:"",
      error:"",
      size:0,
      size_known:false,
      progress_known:false,
      progress_unit:"bytes",
      transferred:0,
      progress:0,
      item_count:0,
      item_transferred:0,
      created_at:Date.now(),
      started_at:null,
      finished_at:null
    };
    resetTransferSpeed(job);
    jobs.set(id, job);
    persistJobs(true);
    queueTransferJob("download", job, () => runCrossCopyJob(id), {phase:"scanning", current:"正在扫描源文件"});
    return {id, status:job.status, type:job.type, connection_id:Number(targetConnectionId)};
  }

  function resumeCrossCopyJob(job: any) {
    queueTransferJob("download", job, () => runCrossCopyJob(job.id), {phase:"transferring", current:"正在继续跨 SFTP 传输"});
    return {ok:true, status:job.status};
  }

  function cleanupCrossCopyArtifacts(job: any) {
    if (job?.type !== "cross-copy" || !job.checkpoint_staging_path) return false;
    try {
      const connection = getSftpConnection(job.target_connection_id || job.connection_id);
      const child = spawnRemote(connection, `rm -rf -- ${remotePathOperand(connection, job.checkpoint_staging_path)}`);
      child.stdin?.end?.();
      child.stdout?.resume?.();
      child.stderr?.resume?.();
      return true;
    } catch {
      return false;
    }
  }

  return {cleanupCrossCopyArtifacts, resumeCrossCopyJob, startCrossCopyJob};
}

module.exports = {
  __buildManifest:buildManifest,
  __commitCommand:commitCommand,
  __ensureRemoteDirectory:ensureRemoteDirectory,
  __manifestTransferred:manifestTransferred,
  createCheckpointTransfers
};
