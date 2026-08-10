const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { DATA_DIR } = require("./config");
const { getConnection } = require("./db");
const { resolveQuickConnectionById } = require("./quick-terminal");
const { connectSsh, normalizeSshTransportError } = require("./ssh2-client");

const sessions = new Map();
const SFTP_DRAG_ROOT = path.join(DATA_DIR, "sftp-drag");
const SFTP_DRAG_TTL_MS = 6 * 60 * 60 * 1000;
const SFTP_DRAG_CLEAR_GRACE_MS = 10 * 60 * 1000;
const SFTP_NATIVE_DRAG_TICKET_TTL_MS = 70 * 60 * 1000;
const SFTP_NATIVE_DRAG_MAX_TOP_LEVEL = 100;
const SFTP_NATIVE_DRAG_MAX_ENTRIES = 10000;
const SFTP_NATIVE_DRAG_MAX_TICKETS = 64;
const SFTP_NATIVE_DRAG_MAX_TICKETS_PER_CONNECTION = 8;
const activeSftpDragStaging = new Map();
const nativeSftpDragTickets = new Map();

function getSftpConnection(connectionId) {
  const id = Number(connectionId);
  if (Number.isSafeInteger(id) && id < 0) {
    const connection = resolveQuickConnectionById(id);
    if (!connection) throw new Error("临时连接已失效，请重新建立快速连接");
    return connection;
  }
  return getConnection(id);
}

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
  const connection = getSftpConnection(id);
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
      client.on("error", (error) => markDisconnected(record, normalizeSshTransportError(error, connection)));
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
    const connection = getSftpConnection(id);
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
  for (const ticket of nativeSftpDragTickets.values()) cancelNativeSftpDragTicket(ticket);
  nativeSftpDragTickets.clear();
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

function normalizeSftpDeliveryPaths(remotePaths) {
  const paths = [...new Set((Array.isArray(remotePaths) ? remotePaths : [])
    .map(item => String(item || "").replace(/\\/g, "/"))
    .filter(Boolean))];
  if (!paths.length || paths.length > 100) throw new Error("一次最多保存 100 个远程文件或目录");
  if (paths.some(item => item.includes("\0") || item.length > 4096)) throw new Error("远程路径无效或过长");
  return paths;
}

function normalizeSftpDeliveryDirectory(targetDirectory) {
  const requestedDirectory = String(targetDirectory || "").trim();
  if (!requestedDirectory || !path.isAbsolute(requestedDirectory)) throw new Error("本机下载目录无效");
  return path.resolve(requestedDirectory);
}

function planSftpPathDelivery(remotePaths, targetDirectory) {
  const directory = normalizeSftpDeliveryDirectory(targetDirectory);
  const paths = normalizeSftpDeliveryPaths(remotePaths);
  return {
    directory,
    items:paths.map(remotePath => {
      const name = safeLocalEntryName(path.posix.basename(remotePath.replace(/\/+$/, "")) || "download");
      const target = path.join(directory, name);
      return {path:remotePath, name, target, exists:fs.existsSync(target)};
    })
  };
}

function moveStagedSftpEntry(source, target) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    fs.cpSync(source, target, {recursive:true, errorOnExist:true, force:false});
    fs.rmSync(source, {recursive:true, force:true});
  }
}

function replaceLocalEntryFromStage(source, target) {
  if (!fs.existsSync(target)) return moveStagedSftpEntry(source, target);
  const backup = path.join(path.dirname(target), `.terma-overwrite-${crypto.randomUUID()}`);
  fs.renameSync(target, backup);
  try {
    moveStagedSftpEntry(source, target);
    fs.rmSync(backup, {recursive:true, force:true});
  } catch (error) {
    try { fs.rmSync(target, {recursive:true, force:true}); } catch {}
    try { fs.renameSync(backup, target); } catch {}
    throw error;
  }
}

function portableDragEntryName(value, platform: string = process.platform) {
  const source = String(value || "download").normalize("NFC");
  let normalized = source.replace(/[\x00/\\]/g, "_");
  if (platform === "win32") {
    normalized = normalized.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) normalized = `_${normalized}`;
  }
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "download";
}

function availablePortableDragName(used, filename, platform: string = process.platform) {
  const safeName = portableDragEntryName(filename, platform);
  const parsed = path.posix.parse(safeName);
  let candidate = safeName;
  for (let index = 1; used.has(candidate.toLocaleLowerCase()); index += 1) {
    candidate = `${parsed.name} (${index})${parsed.ext}`;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function normalizedNativeDragPaths(remotePaths) {
  const source = [...new Set((Array.isArray(remotePaths) ? remotePaths : [])
    .map(item => String(item || "").replace(/\\/g, "/"))
    .filter(Boolean)
    .map(item => path.posix.normalize(item)))];
  if (!source.length || source.length > SFTP_NATIVE_DRAG_MAX_TOP_LEVEL) {
    throw new Error(`一次最多拖出 ${SFTP_NATIVE_DRAG_MAX_TOP_LEVEL} 个文件或目录`);
  }
  if (source.some(item => item.includes("\0") || item.length > 4096)) throw new Error("远端路径无效或过长");
  return source.filter((item, index) => !source.some((parent, parentIndex) => (
    parentIndex !== index
    && item !== parent
    && item.startsWith(`${parent.replace(/\/+$/, "")}/`)
  )));
}

function cleanupNativeSftpDragTickets(now = Date.now()) {
  for (const [token, ticket] of nativeSftpDragTickets) {
    if (Number(ticket.expiresAt || 0) <= now) {
      cancelNativeSftpDragTicket(ticket);
      nativeSftpDragTickets.delete(token);
    }
  }
}

function assertNativeSftpDragTicketActive(ticket) {
  if (ticket?.cancelled) throw nativeSftpDragCancelledError();
}

function cancelNativeSftpDragTicket(ticket) {
  if (!ticket || ticket.cancelled) return;
  ticket.cancelled = true;
  const channel = ticket.manifestChannel;
  ticket.manifestChannel = null;
  try { channel?.end(); } catch {}
}

function nativeSftpDragTicketComplete(ticket) {
  return ticket?.deliveredItemIds instanceof Set
    && ticket.deliveredItemIds.size >= (ticket.topLevel || []).length;
}

function evictOldestNativeSftpDragTicket(tickets) {
  const oldest = tickets
    .filter(ticket => !nativeSftpDragTicketComplete(ticket))
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))[0];
  if (oldest) {
    cancelNativeSftpDragTicket(oldest);
    nativeSftpDragTickets.delete(oldest.token);
  }
  return Boolean(oldest);
}

function enforceNativeSftpDragTicketLimits(connectionId) {
  const id = Number(connectionId);
  const forConnection = () => [...nativeSftpDragTickets.values()]
    .filter(ticket => Number(ticket.connectionId) === id && !nativeSftpDragTicketComplete(ticket));
  while (forConnection().length >= SFTP_NATIVE_DRAG_MAX_TICKETS_PER_CONNECTION) {
    if (!evictOldestNativeSftpDragTicket(forConnection())) break;
  }
  const unfinished = () => [...nativeSftpDragTickets.values()]
    .filter(ticket => !nativeSftpDragTicketComplete(ticket));
  while (unfinished().length >= SFTP_NATIVE_DRAG_MAX_TICKETS) {
    if (!evictOldestNativeSftpDragTicket(unfinished())) break;
  }
}

function nativeSftpDragTicket(token, options: any = {}) {
  cleanupNativeSftpDragTickets();
  const key = String(token || "");
  const ticket = nativeSftpDragTickets.get(key);
  if (!ticket) throw new Error("拖出凭据已失效，请重新拖动");
  if (options.touch !== false) ticket.expiresAt = Date.now() + SFTP_NATIVE_DRAG_TICKET_TTL_MS;
  return ticket;
}

function nativeSftpDragTicketView(ticket) {
  const deliveredItemIds = ticket.deliveredItemIds instanceof Set
    ? [...ticket.deliveredItemIds]
    : [];
  return {
    token: ticket.token,
    connection_id: ticket.connectionId,
    platform: ticket.platform,
    created_at: ticket.createdAt,
    expires_at: ticket.expiresAt,
    ready:Boolean(Array.isArray(ticket.entries)),
    top_level:(ticket.topLevel || []).map((entry) => ({...entry})),
    entries:(ticket.entries || []).map((entry, index) => ({
      index,
      name: entry.name,
      relative_path: entry.relativePath,
      type: entry.type,
      size: entry.size,
      modified_at: entry.modifiedAt,
      mode: entry.mode,
      is_symlink:Boolean(entry.isSymlink),
      link_size:Math.max(0, Number(entry.linkSize || 0)),
      top_level: entry.topLevel,
      top_level_id: entry.topLevelId
    })),
    delivered_item_ids:deliveredItemIds,
    delivered_count:deliveredItemIds.length,
    delivery_complete:deliveredItemIds.length >= (ticket.topLevel || []).length
  };
}

async function appendNativeSftpDragEntry(channel, remotePath, relativePath, ticket, entries, topLevel = false, topLevelId = "") {
  assertNativeSftpDragTicketActive(ticket);
  if (entries.length >= SFTP_NATIVE_DRAG_MAX_ENTRIES) {
    throw new Error(`一次拖出最多处理 ${SFTP_NATIVE_DRAG_MAX_ENTRIES} 个文件和目录`);
  }
  const linkStats: any = await sftpLstat(channel, remotePath);
  assertNativeSftpDragTicketActive(ticket);
  const symbolicLink = Boolean(linkStats?.isSymbolicLink?.());
  let stats: any = linkStats;
  if (symbolicLink) {
    try {
      stats = await sftpStat(channel, remotePath);
    } catch {
      throw new Error(`符号链接目标不存在或无法读取：${remotePath}`);
    }
    assertNativeSftpDragTicketActive(ticket);
  }
  const directory = Boolean(stats?.isDirectory?.());
  const manifestEntry = {
    name:path.posix.basename(relativePath),
    relativePath,
    remotePath,
    type:directory ? "directory" : "file",
    size:directory ? 0 : Math.max(0, Number(stats?.size || 0)),
    modifiedAt:Math.max(0, Number(stats?.mtime || 0)) * 1000,
    mode:Number(stats?.mode || 0),
    isSymlink:symbolicLink,
    linkSize:symbolicLink ? Math.max(0, Number(linkStats?.size || 0)) : 0,
    topLevel:Boolean(topLevel),
    topLevelId:String(topLevelId || "")
  };
  entries.push(manifestEntry);
  if (topLevel) {
    const source = (ticket.topLevel || []).find(item => String(item.id) === String(topLevelId));
    if (source) {
      source.type = manifestEntry.type;
      source.size = manifestEntry.size;
      source.modified_at = manifestEntry.modifiedAt;
      source.metadata_known = true;
      source.is_symlink = manifestEntry.isSymlink;
      source.link_size = manifestEntry.linkSize;
    }
  }
  if (!directory) return;
  const children: any[] = await sftpReaddir(channel, remotePath) as any[];
  assertNativeSftpDragTicketActive(ticket);
  const usedNames = new Set();
  for (const child of children) {
    const rawName = String(child?.filename || "");
    if (!rawName || rawName === "." || rawName === "..") continue;
    assertNativeSftpDragTicketActive(ticket);
    const localName = availablePortableDragName(usedNames, rawName, ticket.platform);
    await appendNativeSftpDragEntry(
      channel,
      path.posix.join(remotePath, rawName),
      path.posix.join(relativePath, localName),
      ticket,
      entries,
      false,
      topLevelId
    );
  }
}

function reserveNativeSftpDragTicket(connectionId, remotePaths, options: any = {}) {
  const paths = normalizedNativeDragPaths(remotePaths);
  const platform = ["win32", "darwin", "linux"].includes(String(options.platform || ""))
    ? String(options.platform)
    : process.platform;
  cleanupNativeSftpDragTickets();
  enforceNativeSftpDragTicketLimits(connectionId);
  const token = crypto.randomBytes(32).toString("base64url");
  const usedNames = new Set();
  const sourceEntries = Array.isArray(options.entries) ? options.entries : [];
  const byPath = new Map<string, any>(sourceEntries.map(item => [path.posix.normalize(String(item?.path || "").replace(/\\/g, "/")), item]));
  const ticket: any = {
    token,
    connectionId:Number(connectionId),
    platform,
    remotePaths:paths,
    entries:null,
    manifestPromise:null,
    manifestChannel:null,
    cancelled:false,
    topLevel:paths.map((remotePath, index) => {
      const source = byPath.get(remotePath);
      const rawName = String(source?.name || path.posix.basename(remotePath.replace(/\/+$/, "")) || "download");
      return {
        id:String(index),
        name:availablePortableDragName(usedNames, rawName, platform),
        remote_path:remotePath,
        type:source?.type === "directory" ? "directory" : "file",
        size:Math.max(0, Number(source?.size || 0)),
        modified_at:Math.max(0, Number(source?.mtime || 0)),
        metadata_known:Boolean(source?.metadataKnown)
      };
    }),
    deliveredItemIds:new Set(),
    createdAt:Date.now(),
    expiresAt:Date.now() + SFTP_NATIVE_DRAG_TICKET_TTL_MS
  };
  nativeSftpDragTickets.set(token, ticket);
  return nativeSftpDragTicketView(ticket);
}

async function ensureNativeSftpDragManifest(ticket) {
  if (ticket.manifestPromise) return ticket.manifestPromise;
  if (Array.isArray(ticket.entries)) return ticket;
  const manifestPromise = (async () => {
    let channel: any = null;
    let channelRegistered = false;
    const entries = [];
    try {
      assertNativeSftpDragTicketActive(ticket);
      channel = await openSftpChannel(ticket.connectionId);
      assertNativeSftpDragTicketActive(ticket);
      ticket.manifestChannel = channel;
      channelRegistered = true;
      for (const topLevel of ticket.topLevel) {
        assertNativeSftpDragTicketActive(ticket);
        await appendNativeSftpDragEntry(channel, topLevel.remote_path, topLevel.name, ticket, entries, true, topLevel.id);
      }
      assertNativeSftpDragTicketActive(ticket);
      ticket.entries = entries;
      return ticket;
    } catch (error) {
      ticket.entries = null;
      if (ticket.cancelled) throw nativeSftpDragCancelledError();
      throw error;
    } finally {
      ticket.manifestPromise = null;
      const closeChannel = !channelRegistered || ticket.manifestChannel === channel;
      if (ticket.manifestChannel === channel) ticket.manifestChannel = null;
      if (closeChannel) {
        try { channel?.end(); } catch {}
      }
    }
  })();
  ticket.manifestPromise = manifestPromise;
  return manifestPromise;
}

async function createNativeSftpDragTicket(connectionId, remotePaths, options: any = {}) {
  const reserved = reserveNativeSftpDragTicket(connectionId, remotePaths, options);
  return getNativeSftpDragTicket(reserved.token);
}

async function getNativeSftpDragTicket(token) {
  const ticket = nativeSftpDragTicket(token);
  await ensureNativeSftpDragManifest(ticket);
  assertNativeSftpDragTicketActive(ticket);
  return nativeSftpDragTicketView(ticket);
}

async function openNativeSftpDragTicketFile(token, index, options: any = {}) {
  const ticket = nativeSftpDragTicket(token);
  await ensureNativeSftpDragManifest(ticket);
  const entry = ticket.entries[Number(index)];
  if (!entry || entry.type !== "file") throw new Error("拖出文件不存在");
  const size = Math.max(0, Number(entry.size || 0));
  const start = Math.max(0, Math.min(size, Number(options.start || 0)));
  const requestedEnd = options.end === undefined || options.end === null ? size - 1 : Number(options.end);
  const end = Math.max(start - 1, Math.min(size - 1, requestedEnd));
  const channel: any = await openSftpChannel(ticket.connectionId);
  let stream;
  try {
    if (size === 0 || end < start) {
      stream = new PassThrough();
      stream.end();
    } else {
      stream = channel.createReadStream(entry.remotePath, {start, end, autoClose:true});
    }
  } catch (error) {
    try { channel?.end(); } catch {}
    throw error;
  }
  const close = () => {
    try { channel?.end(); } catch {}
  };
  stream.once("close", close);
  stream.once("end", close);
  stream.once("error", close);
  return {
    stream,
    entry:nativeSftpDragTicketView(ticket).entries[Number(index)],
    start,
    end,
    length:Math.max(0, end - start + 1),
    total:size
  };
}

function validateNativeSftpDragTarget(promisedName, targetPath, targetDirectory) {
  const requestedDirectory = String(targetDirectory || "").trim();
  const requestedTarget = String(targetPath || "").trim();
  if (!requestedDirectory || !path.isAbsolute(requestedDirectory)) {
    throw new Error("Finder 提供的目标目录无效");
  }
  if (!requestedTarget || !path.isAbsolute(requestedTarget)) {
    throw new Error("Finder 提供的目标路径无效");
  }
  const directory = path.resolve(requestedDirectory);
  const target = path.resolve(requestedTarget);
  const promised = String(promisedName || "").normalize("NFC");
  const actualName = path.basename(target);
  if (!promised) throw new Error("拖出文件名称无效");
  if (path.dirname(target) !== directory) {
    throw new Error("Finder 提供的目标路径不在指定目录内");
  }
  const stats = fs.statSync(directory, {throwIfNoEntry:false});
  if (!stats?.isDirectory()) throw new Error("Finder 提供的目标目录不存在");
  if (fs.existsSync(target)) throw new Error("Finder 提供的目标路径已存在");
  return {
    directory,
    target,
    name:actualName,
    promisedName:promised,
    renamed:actualName.normalize("NFC") !== promised
  };
}

function nativeSftpDragCancelledError() {
  const error: any = new Error("SFTP 拖出已取消");
  error.code = "SFTP_NATIVE_DRAG_CANCELLED";
  error.cancelled = true;
  error.name = "AbortError";
  return error;
}

function throwIfNativeSftpDragCancelled(signal: any) {
  if (signal?.aborted) throw nativeSftpDragCancelledError();
}

function sftpReadToExclusiveFile(channel, remotePath, localPath, signal: any = null, onProgress: any = null) {
  return new Promise((resolve, reject) => {
    let input;
    let output;
    let ownsTarget = false;
    let settled = false;
    const onAbort = () => finish(nativeSftpDragCancelledError());
    const removePartialTarget = () => {
      if (!ownsTarget) return;
      try { fs.rmSync(localPath, {force:true}); } catch {}
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      try { signal?.removeEventListener?.("abort", onAbort); } catch {}
      if (error) {
        try { input?.destroy(); } catch {}
        try { output?.destroy(); } catch {}
        removePartialTarget();
        reject(error);
      } else {
        resolve(undefined);
      }
    };
    try {
      throwIfNativeSftpDragCancelled(signal);
      signal?.addEventListener?.("abort", onAbort, {once:true});
      throwIfNativeSftpDragCancelled(signal);
    } catch (error) {
      finish(error);
      return;
    }
    try {
      fs.mkdirSync(path.dirname(localPath), {recursive:true});
      output = fs.createWriteStream(localPath, {flags:"wx"});
      output.once("error", finish);
      output.once("finish", () => finish());
      output.once("open", () => {
        ownsTarget = true;
        if (settled) {
          try { output?.destroy(); } catch {}
          removePartialTarget();
          return;
        }
        try {
          throwIfNativeSftpDragCancelled(signal);
          input = channel.createReadStream(remotePath, {autoClose:true});
          input.once("error", finish);
          if (typeof onProgress === "function") {
            input.on("data", (chunk) => {
              const bytes = Math.max(0, Number(chunk?.length || 0));
              if (!bytes) return;
              try { onProgress(bytes); } catch {}
            });
          }
          input.pipe(output);
        } catch (error) {
          finish(error);
        }
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function downloadNativeSftpPromiseEntry(channel, remotePath, localPath, counter, signal: any = null, onProgress: any = null) {
  throwIfNativeSftpDragCancelled(signal);
  counter.value += 1;
  if (counter.value > SFTP_NATIVE_DRAG_MAX_ENTRIES) {
    throw new Error(`一次拖出最多处理 ${SFTP_NATIVE_DRAG_MAX_ENTRIES} 个文件和目录`);
  }
  const linkStats: any = await sftpLstat(channel, remotePath);
  const stats: any = linkStats?.isSymbolicLink?.()
    ? await sftpStat(channel, remotePath)
    : linkStats;
  throwIfNativeSftpDragCancelled(signal);
  if (!stats?.isDirectory?.()) {
    await sftpReadToExclusiveFile(channel, remotePath, localPath, signal, onProgress);
    return "file";
  }
  fs.mkdirSync(localPath);
  try {
    const entries: any[] = await sftpReaddir(channel, remotePath) as any[];
    const usedNames = new Set();
    for (const entry of entries) {
      const name = String(entry?.filename || "");
      if (!name || name === "." || name === "..") continue;
      const localName = availablePortableDragName(usedNames, name, "darwin");
      await downloadNativeSftpPromiseEntry(
        channel,
        path.posix.join(remotePath, name),
        path.join(localPath, localName),
        counter,
        signal,
        onProgress
      );
      throwIfNativeSftpDragCancelled(signal);
    }
  } catch (error) {
    try { fs.rmSync(localPath, {recursive:true, force:true}); } catch {}
    throw error;
  }
  return "directory";
}

async function deliverNativeSftpDragTicketItem(token, itemId, targetPath, targetDirectory, options: any = {}) {
  const ticket = nativeSftpDragTicket(token);
  const id = String(itemId ?? "");
  const item = ticket.topLevel.find(entry => String(entry.id) === id);
  if (!item) throw new Error("拖出项目不存在或已失效");
  const signal = options?.signal || null;
  const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
  throwIfNativeSftpDragCancelled(signal);
  const destination = validateNativeSftpDragTarget(item.name, targetPath, targetDirectory);
  let channel: any = null;
  try {
    channel = await openSftpChannel(ticket.connectionId);
    throwIfNativeSftpDragCancelled(signal);
    if (fs.existsSync(destination.target)) throw new Error("Finder 提供的目标路径已存在");
    const type = await downloadNativeSftpPromiseEntry(
      channel,
      item.remote_path,
      destination.target,
      {value:0},
      signal,
      onProgress
    );
    throwIfNativeSftpDragCancelled(signal);
    ticket.deliveredItemIds.add(id);
    ticket.expiresAt = Date.now() + SFTP_NATIVE_DRAG_TICKET_TTL_MS;
    return {
      ok:true,
      token:ticket.token,
      item_id:id,
      name:destination.name,
      promised_name:destination.promisedName,
      renamed:destination.renamed,
      type,
      path:destination.target,
      delivered_count:ticket.deliveredItemIds.size,
      total_count:ticket.topLevel.length,
      complete:ticket.deliveredItemIds.size >= ticket.topLevel.length
    };
  } finally {
    try { channel?.end(); } catch {}
  }
}

async function deliverNativeSftpDragTicket(token, targetDirectory) {
  const ticket = nativeSftpDragTicket(token);
  return deliverSftpPaths(ticket.connectionId, ticket.remotePaths, targetDirectory);
}

function releaseNativeSftpDragTicket(token) {
  const key = String(token || "");
  const ticket = nativeSftpDragTickets.get(key);
  if (!ticket) return false;
  cancelNativeSftpDragTicket(ticket);
  return nativeSftpDragTickets.delete(key);
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
  const connection = getSftpConnection(id);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await connectSftpSession(id, {force:attempt > 0});
      const record = sessions.get(id);
      if (!record?.client || record.status !== "connected") throw new Error("SFTP 会话未连接");
      return await new Promise((resolve, reject) => {
        record.client.sftp((error, channel) => error ? reject(normalizeSshTransportError(error, connection)) : resolve(channel));
      });
    } catch (error) {
      lastError = error;
      const record = sessions.get(id);
      if (record && attempt === 0) {
        endSessionRecord(record);
        record.status = "disconnected";
        record.manualDisconnected = false;
        record.error = normalizeSshTransportError(error, connection)?.message || "";
      }
    }
  }
  throw lastError || new Error("SFTP 会话未连接");
}

function sftpLstat(channel, remotePath) {
  return new Promise((resolve, reject) => channel.lstat(remotePath, (error, stats) => error ? reject(error) : resolve(stats)));
}

function sftpStat(channel, remotePath) {
  return new Promise((resolve, reject) => channel.stat(remotePath, (error, stats) => error ? reject(error) : resolve(stats)));
}

function sftpReaddir(channel, remotePath) {
  return new Promise((resolve, reject) => channel.readdir(remotePath, (error, entries) => error ? reject(error) : resolve(entries || [])));
}

function sftpFastGet(channel, remotePath, localPath, options: any = {}) {
  const expectedSize = Math.max(0, Number(options.size || 0));
  let reported = 0;
  const report = (transferred) => {
    const value = Math.max(0, Number(transferred || 0));
    const delta = Math.max(0, value - reported);
    reported = Math.max(reported, value);
    if (delta > 0) options.onBytes?.(delta);
  };
  return new Promise((resolve, reject) => {
    try {
      channel.fastGet(remotePath, localPath, {
        step: (transferred) => report(transferred)
      }, error => {
        if (!error && expectedSize > reported) report(expectedSize);
        error ? reject(error) : resolve(undefined);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function downloadSftpEntry(channel, remotePath, localPath, counter, progress: any = null) {
  counter.value += 1;
  if (counter.value > 10000) throw new Error("一次拖出最多处理 10000 个文件和目录");
  const linkStats: any = await sftpLstat(channel, remotePath);
  const stats: any = linkStats?.isSymbolicLink?.() ? await sftpStat(channel, remotePath) : linkStats;
  if (!stats?.isDirectory?.()) {
    fs.mkdirSync(path.dirname(localPath), {recursive:true});
    const size = Math.max(0, Number(stats?.size || 0));
    progress?.onFile?.({path:remotePath, size});
    await sftpFastGet(channel, remotePath, localPath, {size, onBytes:progress?.onBytes});
    return;
  }
  fs.mkdirSync(localPath, {recursive:true});
  const entries: any[] = await sftpReaddir(channel, remotePath) as any[];
  for (const entry of entries) {
    const name = String(entry?.filename || "");
    if (!name || name === "." || name === "..") continue;
    await downloadSftpEntry(channel, path.posix.join(remotePath, name), availableLocalEntry(localPath, name), counter, progress);
  }
}

async function stageSftpPaths(connectionId, remotePaths, progress: any = null) {
  const paths = normalizeSftpDeliveryPaths(remotePaths);
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
      await downloadSftpEntry(channel, remotePath, localPath, counter, progress);
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

async function deliverSftpPaths(connectionId, remotePaths, targetDirectory, conflictMode = "rename", progress: any = null) {
  const directory = normalizeSftpDeliveryDirectory(targetDirectory);
  const conflict = ["error", "overwrite", "rename"].includes(String(conflictMode || "")) ? String(conflictMode) : "rename";
  fs.mkdirSync(directory, {recursive:true});
  const staged = await stageSftpPaths(connectionId, remotePaths, progress);
  const saved = [];
  try {
    for (const source of staged.files) {
      const requestedTarget = path.join(directory, safeLocalEntryName(path.basename(source)));
      if (conflict === "error" && fs.existsSync(requestedTarget)) {
        const error: any = new Error(`本地目录已存在同名项目：${path.basename(requestedTarget)}`);
        error.conflict = true;
        throw error;
      }
      const target = conflict === "rename" ? availableLocalEntry(directory, path.basename(source)) : requestedTarget;
      if (conflict === "overwrite") replaceLocalEntryFromStage(source, target);
      else moveStagedSftpEntry(source, target);
      saved.push(target);
      progress?.onItem?.({source, target});
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
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const close = (code = null, signal = null, endOutput = true) => {
    if (closed) return;
    closed = true;
    try { child.stdin.unpipe(); } catch {}
    if (endOutput) {
      try { child.stdout.end(); } catch {}
      try { child.stderr.end(); } catch {}
    }
    child.emit("close", code, signal);
  };
  const reportError = (error) => {
    child.emit("error", normalizeSshTransportError(error, connection));
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
          record.client.exec(String(command || ""), (error, openedChannel) => error ? reject(normalizeSshTransportError(error, connection)) : resolve(openedChannel));
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
        let channelClosed = false;
        let stdoutEnded = false;
        let stderrEnded = false;
        let closeCode = null;
        let closeSignal = null;
        const closeAfterOutput = () => {
          if (channelClosed && stdoutEnded && stderrEnded) close(closeCode, closeSignal, false);
        };
        child.stdout.once("end", () => {
          stdoutEnded = true;
          closeAfterOutput();
        });
        child.stderr.once("end", () => {
          stderrEnded = true;
          closeAfterOutput();
        });
        channel.once("close", (code, signal) => {
          channelClosed = true;
          closeCode = code;
          closeSignal = signal;
          setImmediate(() => {
            if (!child.stdout.writableEnded) child.stdout.end();
            if (!child.stderr.writableEnded) child.stderr.end();
            closeAfterOutput();
          });
        });
        return;
      } catch (error) {
        lastError = error;
        const record = sessions.get(Number(connection.id));
        if (record && attempt === 0) {
          endSessionRecord(record);
          record.status = "disconnected";
          record.manualDisconnected = false;
          record.error = normalizeSshTransportError(error, connection)?.message || "";
        }
      }
    }
    reportError(lastError || new Error("SFTP 会话未连接"));
  });
  return child;
}

module.exports = {
  __normalizedNativeDragPaths: normalizedNativeDragPaths,
  __moveStagedSftpEntry: moveStagedSftpEntry,
  __portableDragEntryName: portableDragEntryName,
  __replaceLocalEntryFromStage: replaceLocalEntryFromStage,
  __validateNativeSftpDragTarget: validateNativeSftpDragTarget,
  clearSftpDragCache,
  closeAllSftpSessions,
  connectSftpSession,
  createNativeSftpDragTicket,
  disconnectSftpSession,
  cleanupSftpDragStaging,
  deliverNativeSftpDragTicket,
  deliverNativeSftpDragTicketItem,
  deliverSftpPaths,
  getSftpConnection,
  getNativeSftpDragTicket,
  openNativeSftpDragTicketFile,
  releaseNativeSftpDragTicket,
  reserveNativeSftpDragTicket,
  sftpSessionStatus,
  sftpDragCacheInfo,
  planSftpPathDelivery,
  stageSftpPaths,
  spawnSftpSessionCommand
};
