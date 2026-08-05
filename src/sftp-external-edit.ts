const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { getConnection } = require("./db");
const { invalidateRemoteDirectoryCache, listRemoteDir, readRemoteBinaryFile, writeRemoteFile } = require("./sftp");

const ROOT = path.join(DATA_DIR, "external-edit");
const sessions = new Map();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRemotePath(value) {
  const remotePath = path.posix.normalize(String(value || "").replace(/\\/g, "/"));
  if (!remotePath || remotePath === "." || remotePath === "/" || remotePath.includes("\0") || remotePath.startsWith("../")) throw new Error("远程文件路径无效");
  return remotePath;
}

function safeName(value) {
  return String(value || "remote-file").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(-180) || "remote-file";
}

async function remoteMetadata(connectionId, remotePath) {
  const parent = path.posix.dirname(remotePath);
  const name = path.posix.basename(remotePath);
  const listing = await listRemoteDir(connectionId, parent, {page:1, pageSize:500, query:name, refresh:true});
  const item = (listing.entries || []).find(entry => entry.name === name);
  if (!item || item.type !== "file") throw new Error("远程文件不存在或不是普通文件");
  return {size:Number(item.size || 0), mtime:Number(item.mtime || 0)};
}

function sessionView(session) {
  return {
    id:session.id,
    connection_id:session.connectionId,
    connection_name:session.connectionName,
    remote_path:session.remotePath,
    local_path:session.localPath,
    status:session.status,
    message:session.message || "",
    updated_at:session.updatedAt,
    remote_metadata:session.remoteMetadata
  };
}

async function syncLocalChange(session) {
  if (session.syncing || session.closed || session.status === "conflict") return;
  session.syncing = true;
  try {
    const local = fs.readFileSync(session.localPath);
    const localHash = hash(local);
    if (localHash === session.localHash) return;
    const [{content:remote}, metadata] = await Promise.all([
      readRemoteBinaryFile(session.connectionId, session.remotePath, 100 * 1024 * 1024),
      remoteMetadata(session.connectionId, session.remotePath)
    ]);
    const remoteHash = hash(remote);
    const remotelyChanged = remoteHash !== session.remoteHash
      || metadata.size !== session.remoteMetadata.size
      || metadata.mtime !== session.remoteMetadata.mtime;
    if (remotelyChanged) {
      session.status = "conflict";
      session.message = "远程文件在编辑期间已变化，请选择覆盖、另存为或取消";
      session.pendingLocalHash = localHash;
      session.updatedAt = Date.now();
      return;
    }
    await writeRemoteFile(session.connectionId, session.remotePath, local, {backup:true});
    invalidateRemoteDirectoryCache(session.connectionId);
    session.remoteMetadata = await remoteMetadata(session.connectionId, session.remotePath);
    session.remoteHash = localHash;
    session.localHash = localHash;
    session.status = "synced";
    session.message = "已自动上传";
    session.updatedAt = Date.now();
  } catch (error) {
    session.status = "error";
    session.message = error.message || String(error);
    session.updatedAt = Date.now();
  } finally {
    session.syncing = false;
  }
}

function watchSession(session) {
  fs.watchFile(session.localPath, {interval:700, persistent:false}, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => syncLocalChange(session), 350);
  });
}

async function startExternalEdit(connectionId, remotePathValue, options: any = {}) {
  const connection = getConnection(Number(connectionId));
  const remotePath = normalizeRemotePath(remotePathValue);
  const [{content}, metadata] = await Promise.all([
    readRemoteBinaryFile(connection.id, remotePath, 100 * 1024 * 1024),
    remoteMetadata(connection.id, remotePath)
  ]);
  const id = crypto.randomUUID();
  const directory = path.join(ROOT, id);
  fs.mkdirSync(directory, {recursive:true});
  const localPath = path.join(directory, safeName(path.posix.basename(remotePath)));
  fs.writeFileSync(localPath, content, {flag:"wx"});
  const session = {
    id,
    connectionId:connection.id,
    connectionName:connection.name,
    remotePath,
    localPath,
    remoteMetadata:metadata,
    remoteHash:hash(content),
    localHash:hash(content),
    status:"watching",
    message:"等待外部编辑器保存",
    updatedAt:Date.now(),
    syncing:false,
    closed:false,
    timer:null
  };
  sessions.set(id, session);
  try {
    await Promise.resolve(options.open(localPath, options.editor || {}));
  } catch (error) {
    sessions.delete(id);
    fs.rmSync(directory, {recursive:true, force:true});
    throw error;
  }
  watchSession(session);
  return sessionView(session);
}

function listExternalEdits() {
  return [...sessions.values()].map(sessionView).sort((left, right) => right.updated_at - left.updated_at);
}

function getExternalEdit(id) {
  const session = sessions.get(String(id || ""));
  if (!session) throw new Error("外部编辑会话不存在或已结束");
  return sessionView(session);
}

async function resolveExternalEdit(id, action, data: any = {}) {
  const session = sessions.get(String(id || ""));
  if (!session) throw new Error("外部编辑会话不存在或已结束");
  if (session.status !== "conflict") throw new Error("当前没有需要处理的远程冲突");
  if (!new Set(["overwrite", "save_as", "cancel"]).has(action)) throw new Error("冲突处理方式无效");
  if (action === "cancel") {
    session.status = "paused";
    session.message = "已取消本次自动上传；继续保存文件时会重新检查";
    session.localHash = hash(fs.readFileSync(session.localPath));
    session.updatedAt = Date.now();
    return sessionView(session);
  }
  const local = fs.readFileSync(session.localPath);
  const target = action === "save_as" ? normalizeRemotePath(data.remote_path) : session.remotePath;
  await writeRemoteFile(session.connectionId, target, local, {backup:action === "overwrite"});
  invalidateRemoteDirectoryCache(session.connectionId);
  session.remotePath = target;
  session.remoteMetadata = await remoteMetadata(session.connectionId, target);
  session.remoteHash = hash(local);
  session.localHash = hash(local);
  session.status = "synced";
  session.message = action === "save_as" ? "已另存到远程文件" : "已覆盖远程文件并保留备份";
  session.updatedAt = Date.now();
  return sessionView(session);
}

function stopExternalEdit(id) {
  const session = sessions.get(String(id || ""));
  if (!session) return {ok:true};
  session.closed = true;
  clearTimeout(session.timer);
  fs.unwatchFile(session.localPath);
  sessions.delete(session.id);
  try { fs.rmSync(path.dirname(session.localPath), {recursive:true, force:true}); } catch {}
  return {ok:true};
}

function stopAllExternalEdits() {
  for (const id of [...sessions.keys()]) stopExternalEdit(id);
}

function stopExternalEditsForConnection(connectionId) {
  for (const [id, session] of sessions) {
    if (Number(session.connectionId) === Number(connectionId)) stopExternalEdit(id);
  }
}

module.exports = {
  getExternalEdit,
  listExternalEdits,
  resolveExternalEdit,
  startExternalEdit,
  stopAllExternalEdits,
  stopExternalEdit,
  stopExternalEditsForConnection
};
