const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { decodeRemoteText, invalidateRemoteDirectoryCache, listRemoteDir, readRemoteBinaryFile, writeRemoteFile } = require("./sftp");
const { getSftpConnection } = require("./sftp-session");

const ROOT = path.join(DATA_DIR, "external-edit");
const COMPARISON_LIMIT = 5 * 1024 * 1024;
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
    remote_metadata:session.remoteMetadata,
    can_compare:Boolean(session.canCompare),
    last_backup_path:session.lastBackupPath || ""
  };
}

function comparisonText(content, label) {
  if (!Buffer.isBuffer(content) || content.length > COMPARISON_LIMIT) throw new Error(`${label}超过 5 MB，不能在对比窗口中打开`);
  if (content.includes(0)) throw new Error(`${label}包含二进制内容，不能进行文本对比`);
  return decodeRemoteText(content, "auto");
}

async function getExternalEditComparison(id) {
  const session = sessions.get(String(id || ""));
  if (!session) throw new Error("外部编辑会话不存在或已结束");
  const localStat = fs.statSync(session.localPath);
  if (!localStat.isFile()) throw new Error("外部编辑临时文件不存在");
  if (localStat.size > COMPARISON_LIMIT) throw new Error("外部编辑内容超过 5 MB，不能进行文本对比");
  const local = fs.readFileSync(session.localPath);
  const [{content:remote}, metadata] = await Promise.all([
    readRemoteBinaryFile(session.connectionId, session.remotePath, COMPARISON_LIMIT),
    remoteMetadata(session.connectionId, session.remotePath)
  ]);
  const oldText = comparisonText(remote, "远端文件");
  const newText = comparisonText(local, "外部编辑内容");
  session.canCompare = true;
  return {
    id:session.id,
    remote_path:session.remotePath,
    old_label:"远端当前版本",
    new_label:"外部编辑内容",
    old_text:oldText.content,
    new_text:newText.content,
    old_encoding:oldText.encoding,
    new_encoding:newText.encoding,
    old_size:remote.length,
    new_size:local.length,
    remote_changed_at:Math.max(0, Number(metadata.mtime || 0)) * 1000,
    local_changed_at:Math.max(0, Number(localStat.mtimeMs || 0))
  };
}

async function syncLocalChange(session) {
  if (session.syncing || session.closed) return;
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
      session.canCompare = local.length <= COMPARISON_LIMIT && remote.length <= COMPARISON_LIMIT && !local.includes(0) && !remote.includes(0);
      session.updatedAt = Date.now();
      return;
    }
    session.pendingLocalHash = localHash;
    session.canCompare = local.length <= COMPARISON_LIMIT && remote.length <= COMPARISON_LIMIT && !local.includes(0) && !remote.includes(0);
    session.status = "modified";
    session.message = "内容已由外部编辑器更改，等待确认是否保存";
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
  const connection = getSftpConnection(Number(connectionId));
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
    timer:null,
    canCompare:false,
    lastBackupPath:""
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
  if (!new Set(["modified", "conflict"]).has(session.status)) throw new Error("当前没有需要保存的外部编辑内容");
  if (!new Set(["save", "overwrite", "save_as", "cancel"]).has(action)) throw new Error("外部编辑处理方式无效");
  if (session.status === "conflict" && action === "save") throw new Error("远程文件已变化，请明确选择覆盖或另存为");
  if (action === "cancel") {
    session.status = "watching";
    session.message = "本次更改未保存到远端；继续编辑并保存时会再次提示";
    session.localHash = hash(fs.readFileSync(session.localPath));
    session.pendingLocalHash = "";
    session.updatedAt = Date.now();
    return sessionView(session);
  }
  const local = fs.readFileSync(session.localPath);
  if (action === "save") {
    const [{content:remote}, metadata] = await Promise.all([
      readRemoteBinaryFile(session.connectionId, session.remotePath, 100 * 1024 * 1024),
      remoteMetadata(session.connectionId, session.remotePath)
    ]);
    const remotelyChanged = hash(remote) !== session.remoteHash
      || metadata.size !== session.remoteMetadata.size
      || metadata.mtime !== session.remoteMetadata.mtime;
    if (remotelyChanged) {
      session.status = "conflict";
      session.message = "远程文件在编辑期间已变化，请选择覆盖、另存为或取消";
      session.updatedAt = Date.now();
      return sessionView(session);
    }
  }
  const target = action === "save_as" ? normalizeRemotePath(data.remote_path) : session.remotePath;
  const writeResult = await writeRemoteFile(session.connectionId, target, local, {backup:action === "overwrite" || action === "save"});
  invalidateRemoteDirectoryCache(session.connectionId);
  session.remotePath = target;
  session.remoteMetadata = await remoteMetadata(session.connectionId, target);
  session.remoteHash = hash(local);
  session.localHash = hash(local);
  session.pendingLocalHash = "";
  session.canCompare = false;
  session.lastBackupPath = String(writeResult?.backup_path || "");
  session.status = "synced";
  session.message = action === "save_as" ? "已另存到远程文件" : action === "overwrite" ? "已覆盖远程文件并保留备份" : "已保存到远程并保留原文件备份";
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
  getExternalEditComparison,
  listExternalEdits,
  resolveExternalEdit,
  startExternalEdit,
  stopAllExternalEdits,
  stopExternalEdit,
  stopExternalEditsForConnection
};
