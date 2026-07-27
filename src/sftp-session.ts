const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { DATA_DIR } = require("./config");
const { getConnection } = require("./db");
const { connectSsh } = require("./ssh2-client");

const sessions = new Map();
const SFTP_DRAG_ROOT = path.join(DATA_DIR, "sftp-drag");
const SFTP_DRAG_TTL_MS = 6 * 60 * 60 * 1000;
const SFTP_DRAG_CLEAR_GRACE_MS = 10 * 60 * 1000;
const activeSftpDragStaging = new Map();

function connectionFingerprint(connection) {
  return JSON.stringify([
    connection.ssh_host,
    Number(connection.ssh_port || 22),
    connection.ssh_user,
    connection.auth_type || "key",
    connection.identity_file || "",
    connection.ssh_password || ""
  ]);
}

function sessionView(record) {
  return {
    status: record?.status || "disconnected",
    connected: Boolean(record?.status === "connected" && record?.client),
    error: record?.error || ""
  };
}

function markDisconnected(record, error = null) {
  if (!record) return;
  if (record.status === "disconnected" && record.manualDisconnected) return;
  record.status = "disconnected";
  record.client = null;
  record.connecting = null;
  record.manualDisconnected = false;
  record.error = error?.message || record.error || "";
}

function endSessionRecord(record) {
  if (!record) return;
  record.generation += 1;
  const client = record.client;
  record.client = null;
  record.connecting = null;
  try { client?.end(); } catch {}
}

async function connectSftpSession(connectionId, options: any = {}) {
  const id = Number(connectionId);
  const connection = getConnection(id);
  const fingerprint = connectionFingerprint(connection);
  let record = sessions.get(id);

  if (record?.fingerprint !== fingerprint) {
    endSessionRecord(record);
    sessions.delete(id);
    record = null;
  }
  if (!options.force && record?.status === "connected" && record.client) return sessionView(record);
  if (!options.force && record?.connecting) return record.connecting;
  const generation = Number(record?.generation || 0) + 1;
  endSessionRecord(record);
  record = {
    id,
    fingerprint,
    status: "connecting",
    client: null,
    connecting: null,
    manualDisconnected: false,
    error: "",
    generation
  };
  sessions.set(id, record);
  record.connecting = (async () => {
    try {
      const client: any = await connectSsh(connection);
      if (sessions.get(id) !== record || record.generation !== generation) {
        try { client.end(); } catch {}
        throw new Error("SFTP 连接已取消");
      }
      record.client = client;
      record.status = "connected";
      record.error = "";
      record.connecting = null;
      client.once("close", () => markDisconnected(record));
      client.once("end", () => markDisconnected(record));
      client.on("error", (error) => markDisconnected(record, error));
      return sessionView(record);
    } catch (error) {
      if (sessions.get(id) === record) markDisconnected(record, error);
      throw error;
    }
  })();
  return record.connecting;
}

function disconnectSftpSession(connectionId, options: any = {}) {
  const id = Number(connectionId);
  let record = sessions.get(id);
  if (!record) {
    if (!options.remember) return { status: "disconnected", connected: false, error: "" };
    const connection = getConnection(id);
    record = {
      id,
      fingerprint: connectionFingerprint(connection),
      status: "disconnected",
      client: null,
      connecting: null,
      manualDisconnected: true,
      error: "",
      generation: 1
    };
    sessions.set(id, record);
    return sessionView(record);
  }
  endSessionRecord(record);
  record.status = "disconnected";
  record.manualDisconnected = options.remember !== false;
  record.error = "";
  return sessionView(record);
}

function sftpSessionStatus(connectionId) {
  return sessionView(sessions.get(Number(connectionId)));
}

function closeAllSftpSessions() {
  for (const record of sessions.values()) endSessionRecord(record);
  sessions.clear();
}

function safeLocalEntryName(value) {
  const source = String(value || "download");
  const normalized = process.platform === "win32"
    ? source.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "")
    : source.replace(/[\x00/]/g, "_");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "download";
}

function availableLocalEntry(parent, filename) {
  const parsed = path.parse(safeLocalEntryName(filename));
  let target = path.join(parent, `${parsed.name}${parsed.ext}`);
  for (let index = 1; fs.existsSync(target); index += 1) target = path.join(parent, `${parsed.name} (${index})${parsed.ext}`);
  return target;
}

function resolvedSftpDragEntry(name) {
  const target = path.resolve(SFTP_DRAG_ROOT, name);
  return path.dirname(target) === path.resolve(SFTP_DRAG_ROOT) ? target : "";
}

function sftpDragEntryProtected(target, stats, now = Date.now()) {
  const leaseUntil = Number(activeSftpDragStaging.get(target) || 0);
  if (leaseUntil > now) return true;
  if (leaseUntil) activeSftpDragStaging.delete(target);
  return now - Number(stats?.mtimeMs || 0) < SFTP_DRAG_CLEAR_GRACE_MS;
}

function localCachePathStats(target) {
  let bytes = 0;
  let files = 0;
  const visit = (current) => {
    let stats;
    try { stats = fs.lstatSync(current); } catch { return; }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      bytes += Number(stats.size || 0);
      files += 1;
      return;
    }
    let entries = [];
    try { entries = fs.readdirSync(current); } catch { return; }
    for (const entry of entries) visit(path.join(current, entry));
  };
  visit(target);
  return {bytes, files};
}

function cleanupSftpDragStaging(now = Date.now()) {
  try {
    for (const entry of fs.readdirSync(SFTP_DRAG_ROOT, {withFileTypes:true})) {
      const target = resolvedSftpDragEntry(entry.name);
      if (!target) continue;
      const stats = fs.lstatSync(target);
      const age = now - stats.mtimeMs;
      if (age > SFTP_DRAG_TTL_MS && !sftpDragEntryProtected(target, stats, now)) {
        fs.rmSync(target, {recursive:true, force:true});
        activeSftpDragStaging.delete(target);
      }
    }
  } catch {}
}

function sftpDragCacheInfo(now = Date.now()) {
  cleanupSftpDragStaging(now);
  let bytes = 0;
  let files = 0;
  let reclaimableBytes = 0;
  let reclaimableFiles = 0;
  try {
    for (const entry of fs.readdirSync(SFTP_DRAG_ROOT, {withFileTypes:true})) {
      const target = resolvedSftpDragEntry(entry.name);
      if (!target) continue;
      const stats = fs.lstatSync(target);
      const usage = localCachePathStats(target);
      bytes += usage.bytes;
      files += usage.files;
      // Only a staging operation that is still writing must survive an explicit
      // cache clear. Completed staging remains protected from automatic expiry,
      // but users can reclaim it immediately from Settings.
      if (Number(activeSftpDragStaging.get(target) || 0) !== Number.POSITIVE_INFINITY) {
        reclaimableBytes += usage.bytes;
        reclaimableFiles += usage.files;
      }
    }
  } catch {}
  return {bytes, files, reclaimable_bytes:reclaimableBytes, reclaimable_files:reclaimableFiles};
}

function clearSftpDragCache(now = Date.now()) {
  try {
    for (const entry of fs.readdirSync(SFTP_DRAG_ROOT, {withFileTypes:true})) {
      const target = resolvedSftpDragEntry(entry.name);
      if (!target) continue;
      if (Number(activeSftpDragStaging.get(target) || 0) === Number.POSITIVE_INFINITY) continue;
      fs.rmSync(target, {recursive:true, force:true});
      activeSftpDragStaging.delete(target);
    }
  } catch {}
  return sftpDragCacheInfo(now);
}

async function openSftpChannel(connectionId) {
  const id = Number(connectionId);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await connectSftpSession(id, {force:attempt > 0});
      const record = sessions.get(id);
      if (!record?.client || record.status !== "connected") throw new Error("SFTP 会话未连接");
      return await new Promise((resolve, reject) => {
        record.client.sftp((error, channel) => error ? reject(error) : resolve(channel));
      });
    } catch (error) {
      lastError = error;
      const record = sessions.get(id);
      if (record && attempt === 0) {
        endSessionRecord(record);
        record.status = "disconnected";
        record.manualDisconnected = false;
        record.error = error?.message || "";
      }
    }
  }
  throw lastError || new Error("SFTP 会话未连接");
}

function sftpLstat(channel, remotePath) {
  return new Promise((resolve, reject) => channel.lstat(remotePath, (error, stats) => error ? reject(error) : resolve(stats)));
}

function sftpReaddir(channel, remotePath) {
  return new Promise((resolve, reject) => channel.readdir(remotePath, (error, entries) => error ? reject(error) : resolve(entries || [])));
}

function sftpFastGet(channel, remotePath, localPath) {
  return new Promise((resolve, reject) => channel.fastGet(remotePath, localPath, {}, error => error ? reject(error) : resolve(undefined)));
}

async function downloadSftpEntry(channel, remotePath, localPath, counter) {
  counter.value += 1;
  if (counter.value > 10000) throw new Error("一次拖出最多处理 10000 个文件和目录");
  const stats: any = await sftpLstat(channel, remotePath);
  if (!stats?.isDirectory?.()) {
    fs.mkdirSync(path.dirname(localPath), {recursive:true});
    await sftpFastGet(channel, remotePath, localPath);
    return;
  }
  fs.mkdirSync(localPath, {recursive:true});
  const entries: any[] = await sftpReaddir(channel, remotePath) as any[];
  for (const entry of entries) {
    const name = String(entry?.filename || "");
    if (!name || name === "." || name === "..") continue;
    await downloadSftpEntry(channel, path.posix.join(remotePath, name), availableLocalEntry(localPath, name), counter);
  }
}

async function stageSftpPaths(connectionId, remotePaths) {
  const paths = [...new Set((Array.isArray(remotePaths) ? remotePaths : []).map(item => String(item || "").replace(/\\/g, "/")).filter(Boolean))];
  if (!paths.length || paths.length > 100) throw new Error("一次最多拖出 100 个文件或目录");
  if (paths.some(item => item.includes("\0") || item.length > 4096)) throw new Error("远程路径无效或过长");
  cleanupSftpDragStaging();
  fs.mkdirSync(SFTP_DRAG_ROOT, {recursive:true});
  const directory = path.join(SFTP_DRAG_ROOT, crypto.randomUUID());
  fs.mkdirSync(directory, {recursive:true});
  activeSftpDragStaging.set(directory, Number.POSITIVE_INFINITY);
  let channel: any = null;
  let staged = false;
  const files = [];
  try {
    channel = await openSftpChannel(connectionId);
    const counter = {value:0};
    for (const remotePath of paths) {
      const baseName = path.posix.basename(remotePath.replace(/\/+$/, "")) || "download";
      const localPath = availableLocalEntry(directory, baseName);
      await downloadSftpEntry(channel, remotePath, localPath, counter);
      files.push(localPath);
    }
    fs.utimesSync(directory, new Date(), new Date());
    staged = true;
    return {directory, files};
  } catch (error) {
    try { fs.rmSync(directory, {recursive:true, force:true}); } catch {}
    throw error;
  } finally {
    if (staged) activeSftpDragStaging.set(directory, Date.now() + SFTP_DRAG_CLEAR_GRACE_MS);
    else activeSftpDragStaging.delete(directory);
    try { channel?.end(); } catch {}
  }
}

async function deliverSftpPaths(connectionId, remotePaths, targetDirectory) {
  const requestedDirectory = String(targetDirectory || "").trim();
  if (!requestedDirectory || !path.isAbsolute(requestedDirectory)) throw new Error("本机下载目录无效");
  const directory = path.resolve(requestedDirectory);
  fs.mkdirSync(directory, {recursive:true});
  const staged = await stageSftpPaths(connectionId, remotePaths);
  const saved = [];
  try {
    for (const source of staged.files) {
      const target = availableLocalEntry(directory, path.basename(source));
      try {
        fs.renameSync(source, target);
      } catch (error) {
        if (error?.code !== "EXDEV") throw error;
        fs.cpSync(source, target, {recursive:true, errorOnExist:true, force:false});
        fs.rmSync(source, {recursive:true, force:true});
      }
      saved.push(target);
    }
    return {ok:true, directory, files:saved};
  } finally {
    try { fs.rmSync(staged.directory, {recursive:true, force:true}); } catch {}
    activeSftpDragStaging.delete(staged.directory);
  }
}

function spawnSftpSessionCommand(connection, command) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = null;
  child.killed = false;
  child.channel = null;
  let closed = false;

  child.on("error", () => {});
  const close = (code = null, signal = null) => {
    if (closed) return;
    closed = true;
    try { child.stdin.unpipe(); } catch {}
    try { child.stdout.end(); } catch {}
    try { child.stderr.end(); } catch {}
    child.emit("close", code, signal);
  };
  const reportError = (error) => {
    child.emit("error", error);
    close(null);
  };
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    try { child.channel?.close(); } catch {}
    close(null, signal);
    return true;
  };

  queueMicrotask(async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !child.killed; attempt += 1) {
      try {
        await connectSftpSession(connection.id, {force:attempt > 0});
        if (child.killed) return;
        const record = sessions.get(Number(connection.id));
        if (!record?.client || record.status !== "connected") throw new Error("SFTP 会话未连接");
        const channel: any = await new Promise((resolve, reject) => {
          record.client.exec(String(command || ""), (error, openedChannel) => error ? reject(error) : resolve(openedChannel));
        });
        if (child.killed) {
          try { channel.close(); } catch {}
          return;
        }
        child.channel = channel;
        child.stdin.pipe(channel);
        channel.pipe(child.stdout);
        channel.stderr?.pipe(child.stderr);
        channel.on("error", reportError);
        channel.once("close", (code, signal) => close(code, signal));
        return;
      } catch (error) {
        lastError = error;
        const record = sessions.get(Number(connection.id));
        if (record && attempt === 0) {
          endSessionRecord(record);
          record.status = "disconnected";
          record.manualDisconnected = false;
          record.error = error?.message || "";
        }
      }
    }
    reportError(lastError || new Error("SFTP 会话未连接"));
  });
  return child;
}

module.exports = {
  clearSftpDragCache,
  closeAllSftpSessions,
  connectSftpSession,
  disconnectSftpSession,
  cleanupSftpDragStaging,
  deliverSftpPaths,
  sftpSessionStatus,
  sftpDragCacheInfo,
  stageSftpPaths,
  spawnSftpSessionCommand
};
