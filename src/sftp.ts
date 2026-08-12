const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { buildRemotePosixCommand } = require("./remote-posix");
const { getSftpConnection, spawnSftpSessionCommand } = require("./sftp-session");
const {
  decodeRemoteFilenameOutput,
  decodeRemoteText,
  encodeRemoteText,
  normalizeTextEncoding,
  remotePathOperand,
  shellQuote
} = require("./sftp-encoding");
const DEFAULT_MAX_OPEN_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_DIRECTORY_PAGE_SIZE = 50;
const MAX_DIRECTORY_PAGE_SIZE = 200;
const DIRECTORY_CACHE_TTL_MS = 2 * 60 * 1000;
const DIRECTORY_CACHE_MAX_SNAPSHOTS = 24;
const DIRECTORY_CACHE_MAX_ENTRIES = 100000;
const MAX_RECURSIVE_SEARCH_ENTRIES = 20000;
const SFTP_RECYCLE_DIRECTORY = ".terma-recycle-bin";
const LEGACY_SFTP_RECYCLE_DIRECTORY = ".tunneldesk-recycle-bin";
const SFTP_RECYCLE_DIRECTORIES = [SFTP_RECYCLE_DIRECTORY, LEGACY_SFTP_RECYCLE_DIRECTORY];
const directorySnapshots = new Map();
const directoryAliases = new Map();
const directorySnapshotRequests = new Map();
const directoryCacheVersions = new Map();
const directoryNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function permissionPathOperand(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("./")) return normalized;
  return `./${normalized}`;
}

function spawnRemote(connection, command) {
  return spawnSftpSessionCommand(connection, buildRemotePosixCommand(command));
}

function runRemoteCommand(connection, command, input = null, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawnSftpSessionCommand(connection, command);
    const chunks = [];
    const errors = [];
    let settled = false;
    const finish = (error = null, code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks);
      const stderr = Buffer.concat(errors).toString("utf8");
      if (error) reject(error);
      else if (code !== 0) reject(new Error(stderr || (code === null ? "远程目录命令被连接中断，请重试" : `远程命令退出码 ${code}`)));
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(new Error("远程文件操作超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(null, code));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function runRemote(connection, command, input = null, timeoutMs = 30000): Promise<Buffer> {
  return runRemoteCommand(connection, buildRemotePosixCommand(command), input, timeoutMs);
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label}必须是正整数`);
  return parsed;
}

function normalizeRemoteDirectoryListOptions(options: any = {}) {
  const sort = String(options.sort || "name").toLowerCase();
  const dir = String(options.dir || "asc").toLowerCase();
  if (!["name", "size", "mtime"].includes(sort)) throw new Error("目录排序字段无效");
  if (!["asc", "desc"].includes(dir)) throw new Error("目录排序方向无效");
  return {
    page: positiveInteger(options.page, 1, "页码"),
    page_size: Math.min(positiveInteger(options.page_size, DEFAULT_DIRECTORY_PAGE_SIZE, "每页数量"), MAX_DIRECTORY_PAGE_SIZE),
    query: String(options.query || "").trim().slice(0, 256),
    sort,
    dir,
    refresh: options.refresh === true || String(options.refresh || "") === "1",
    recursive: options.recursive === true || String(options.recursive || "") === "1"
  };
}

function paginateRemoteEntries(entries, options: any = {}) {
  const normalized = normalizeRemoteDirectoryListOptions(options);
  const source = Array.isArray(entries) ? entries : [];
  const query = normalized.query.toLowerCase();
  const direction = normalized.dir === "desc" ? -1 : 1;
  const filtered = source
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !query || String(entry?.name || "").toLowerCase().includes(query));

  filtered.sort((left, right) => {
    const leftDirectory = left.entry?.type === "dir";
    const rightDirectory = right.entry?.type === "dir";
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;

    let comparison = 0;
    if (normalized.sort === "size") comparison = (Number(left.entry?.size) || 0) - (Number(right.entry?.size) || 0);
    else if (normalized.sort === "mtime") comparison = (Number(left.entry?.mtime) || 0) - (Number(right.entry?.mtime) || 0);
    if (comparison === 0) comparison = directoryNameCollator.compare(String(left.entry?.name || ""), String(right.entry?.name || ""));
    if (comparison !== 0) return comparison * direction;
    return left.index - right.index;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / normalized.page_size));
  const page = Math.min(normalized.page, totalPages);
  const offset = (page - 1) * normalized.page_size;
  return {
    entries: filtered.slice(offset, offset + normalized.page_size).map(({ entry }) => entry),
    page,
    page_size: normalized.page_size,
    total,
    total_pages: totalPages,
    unfiltered_total: source.length
  };
}

function normalizedRemotePath(value) {
  const remotePath = String(value || ".").replace(/\\/g, "/");
  if (remotePath === "/") return "/";
  return remotePath.replace(/\/+$/, "") || ".";
}

function directoryCacheKey(connectionId, remotePath, recursive = false) {
  return `${Number(connectionId)}\0${recursive ? "recursive\0" : "directory\0"}${normalizedRemotePath(remotePath)}`;
}

function removeDirectorySnapshot(key) {
  directorySnapshots.delete(key);
  for (const [alias, target] of directoryAliases) {
    if (target === key) directoryAliases.delete(alias);
  }
}

function pruneDirectorySnapshots(now = Date.now()) {
  for (const [key, snapshot] of directorySnapshots) {
    if (snapshot.expires_at <= now) removeDirectorySnapshot(key);
  }
  let totalEntries = [...directorySnapshots.values()].reduce((total, snapshot) => total + Number(snapshot.entries?.length || 0), 0);
  while (directorySnapshots.size > DIRECTORY_CACHE_MAX_SNAPSHOTS || totalEntries > DIRECTORY_CACHE_MAX_ENTRIES) {
    const oldest = directorySnapshots.keys().next().value;
    if (oldest === undefined) break;
    totalEntries -= Number(directorySnapshots.get(oldest)?.entries?.length || 0);
    removeDirectorySnapshot(oldest);
  }
}

function cachedDirectorySnapshot(connectionId, remotePath, recursive = false) {
  pruneDirectorySnapshots();
  const requestedKey = directoryCacheKey(connectionId, remotePath, recursive);
  const canonicalKey = directoryAliases.get(requestedKey) || requestedKey;
  const snapshot = directorySnapshots.get(canonicalKey);
  if (!snapshot) return null;
  directorySnapshots.delete(canonicalKey);
  directorySnapshots.set(canonicalKey, snapshot);
  return snapshot;
}

function cacheDirectorySnapshot(connectionId, remotePath, snapshot, recursive = false) {
  pruneDirectorySnapshots();
  const requestedKey = directoryCacheKey(connectionId, remotePath, recursive);
  const canonicalKey = directoryCacheKey(connectionId, snapshot.path, recursive);
  directorySnapshots.delete(canonicalKey);
  directorySnapshots.set(canonicalKey, snapshot);
  directoryAliases.set(requestedKey, canonicalKey);
  directoryAliases.set(canonicalKey, canonicalKey);
  pruneDirectorySnapshots();
}

function invalidateRemoteDirectoryCache(connectionId) {
  const id = Number(connectionId);
  const prefix = `${id}\0`;
  directoryCacheVersions.set(id, Number(directoryCacheVersions.get(id) || 0) + 1);
  for (const key of [...directorySnapshots.keys()]) {
    if (key.startsWith(prefix)) removeDirectorySnapshot(key);
  }
  for (const key of [...directoryAliases.keys()]) {
    if (key.startsWith(prefix)) directoryAliases.delete(key);
  }
  for (const key of [...directorySnapshotRequests.keys()]) {
    if (key.startsWith(prefix)) directorySnapshotRequests.delete(key);
  }
}

function buildRemoteRecursiveDirectoryEntriesCommand() {
  const excluded = [
    `-name ${shellQuote(SFTP_RECYCLE_DIRECTORY)}`,
    `-name ${shellQuote(LEGACY_SFTP_RECYCLE_DIRECTORY)}`,
    `-name ${shellQuote(".terma-upload-*.part")}`,
    `-name ${shellQuote(".tunneldesk-upload-*.part")}`
  ].join(" -o ");
  return `find . ! -name . \\( \\( ${excluded} \\) -prune -o -exec sh -c 'for entry in "$@"; do if [ -d "$entry" ]; then type=d; else type=f; fi; name=\${entry#./}; printf "%s\\t%s\\n" "$name" "$type"; done' sh {} + \\)`;
}

function buildRemoteDirectoryEntriesCommand() {
  return [
    `if stat -c "%s" . >/dev/null 2>&1; then TERMA_STAT_STYLE=gnu`,
    `elif stat -f "%z" . >/dev/null 2>&1; then TERMA_STAT_STYLE=bsd`,
    `else echo "远程系统缺少兼容的 stat 命令" >&2; exit 1`,
    `fi`,
    `export TERMA_STAT_STYLE`,
    `find . ! -name . ! -name ${shellQuote(SFTP_RECYCLE_DIRECTORY)} ! -name ${shellQuote(LEGACY_SFTP_RECYCLE_DIRECTORY)} ! -name ${shellQuote(".terma-upload-*.part")} ! -name ${shellQuote(".tunneldesk-upload-*.part")} -prune -exec sh -c 'for entry in "$@"; do terma_link=0; terma_link_size=0; terma_link_missing=0; if [ -L "$entry" ]; then terma_link=1; fi; if [ -d "$entry" ]; then type=d; else type=f; fi; if [ "$TERMA_STAT_STYLE" = gnu ]; then if [ "$terma_link" = 1 ]; then own_meta=$(stat -c "%s %Y %a %U %G" "$entry") || exit 1; terma_link_size=\${own_meta%% *}; if [ -e "$entry" ]; then meta=$(stat -L -c "%s %Y %a %U %G" "$entry") || exit 1; else meta=$own_meta; terma_link_missing=1; fi; else meta=$(stat -c "%s %Y %a %U %G" "$entry") || exit 1; fi; else if [ "$terma_link" = 1 ]; then own_meta=$(stat -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; terma_link_size=\${own_meta%% *}; if [ -e "$entry" ]; then meta=$(stat -L -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; else meta=$own_meta; terma_link_missing=1; fi; else meta=$(stat -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; fi; fi; name=\${entry#./}; printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$name" "$type" "$meta" "$terma_link" "$terma_link_size" "$terma_link_missing"; done' sh {} +`
  ].join("; ");
}

async function enumerateRemoteDir(connectionId, remotePath = ".") {
  const connection = getSftpConnection(connectionId);
  const dir = remotePath || ".";
  const listEntries = buildRemoteDirectoryEntriesCommand();
  const command = [
    `cd ${remotePathOperand(connection, dir)}`,
    `pwd`,
    listEntries
  ].join(" && ");
  const output = decodeRemoteFilenameOutput(connection, await runRemote(connection, command));
  const [cwdLine, ...rows] = output.split(/\r?\n/).filter(Boolean);
  return {
    path: cwdLine || dir,
    entries: rows.map((line) => {
      const [name, type, meta = "", link = "0", linkSize = "0", linkMissing = "0"] = line.split("\t");
      const [size, mtime, mode, owner, group] = meta.trim().split(/\s+/);
      return {
        name,
        type: type === "d" ? "dir" : "file",
        size: Number(size || 0),
        mtime: Number(mtime || 0),
        mode: String(mode || ""),
        owner: String(owner || ""),
        group: String(group || ""),
        is_symlink:link === "1",
        link_size:link === "1" ? Number(linkSize || 0) : 0,
        link_target_missing:link === "1" && linkMissing === "1"
      };
    })
  };
}

async function enumerateRemoteTree(connectionId, remotePath = ".") {
  const connection = getSftpConnection(connectionId);
  const dir = remotePath || ".";
  const command = [
    `cd ${remotePathOperand(connection, dir)}`,
    `{ pwd; ${buildRemoteRecursiveDirectoryEntriesCommand()}; } | sed -n '1,${MAX_RECURSIVE_SEARCH_ENTRIES + 2}p;${MAX_RECURSIVE_SEARCH_ENTRIES + 3}q'`
  ].join(" && ");
  const output = decodeRemoteFilenameOutput(connection, await runRemote(connection, command, null, 30000));
  const [cwdLine, ...allRows] = output.split(/\r?\n/).filter(Boolean);
  const truncated = allRows.length > MAX_RECURSIVE_SEARCH_ENTRIES;
  const rows = allRows.slice(0, MAX_RECURSIVE_SEARCH_ENTRIES);
  return {
    path: cwdLine || dir,
    truncated,
    entries: rows.map((line) => {
      const separator = line.lastIndexOf("\t");
      const name = separator >= 0 ? line.slice(0, separator) : line;
      const type = separator >= 0 ? line.slice(separator + 1) : "f";
      return {
        name,
        type: type === "d" ? "dir" : "file",
        size: 0,
        mtime: 0,
        mode: "",
        owner: "",
        group: "",
        metadata_known: false
      };
    })
  };
}

async function loadDirectorySnapshot(connectionId, remotePath, recursive, refresh) {
  if (!refresh) {
    const cached = cachedDirectorySnapshot(connectionId, remotePath, recursive);
    if (cached) return cached;
  }
  const requestKey = directoryCacheKey(connectionId, remotePath, recursive);
  let request = directorySnapshotRequests.get(requestKey);
  if (!request) {
    const cacheVersion = Number(directoryCacheVersions.get(Number(connectionId)) || 0);
    request = (recursive ? enumerateRemoteTree(connectionId, remotePath) : enumerateRemoteDir(connectionId, remotePath))
      .then((result) => {
        const snapshot = {...result, expires_at:Date.now() + DIRECTORY_CACHE_TTL_MS};
        if (Number(directoryCacheVersions.get(Number(connectionId)) || 0) === cacheVersion) {
          cacheDirectorySnapshot(connectionId, remotePath, snapshot, recursive);
        }
        return snapshot;
      })
      .finally(() => {
        if (directorySnapshotRequests.get(requestKey) === request) directorySnapshotRequests.delete(requestKey);
      });
    directorySnapshotRequests.set(requestKey, request);
  }
  return request;
}

async function listRemoteDir(connectionId, remotePath = ".", options: any = {}) {
  const normalized = normalizeRemoteDirectoryListOptions(options);
  const recursive = normalized.recursive && Boolean(normalized.query);
  const snapshot = await loadDirectorySnapshot(connectionId, remotePath, recursive, normalized.refresh);
  return {
    path: snapshot.path,
    recursive,
    truncated:Boolean(snapshot.truncated),
    ...paginateRemoteEntries(snapshot.entries, normalized)
  };
}

function remoteBackupVersionTimestamp(name, prefix, fallback = 0) {
  const stamp = String(name || "").slice(String(prefix || "").length).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})-/);
  return stamp
    ? Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6]), Number(stamp[7]))
    : Math.max(0, Number(fallback || 0));
}

async function listRemoteFileVersions(connectionId, remotePathValue, maximum = 10) {
  const remotePath = path.posix.normalize(String(remotePathValue || "").replace(/\\/g, "/"));
  if (!remotePath || remotePath === "." || remotePath === "/" || remotePath.includes("\0") || remotePath.startsWith("../")) {
    throw new Error("远程文件路径无效");
  }
  const directory = path.posix.dirname(remotePath);
  const filename = path.posix.basename(remotePath);
  const prefix = `${filename}.bak-`;
  const limit = Math.max(1, Math.min(10, Math.trunc(Number(maximum) || 10)));
  const listing = await listRemoteDir(connectionId, directory, {
    page:1,
    page_size:200,
    query:prefix,
    // Backups use cp -p, so mtime belongs to the overwritten source. The
    // timestamp embedded in the backup name is the reliable version order.
    sort:"name",
    dir:"desc",
    refresh:true
  });
  const versions = (listing.entries || [])
    .filter(entry => entry.type === "file" && String(entry.name || "").startsWith(prefix))
    .sort((left, right) => String(right.name || "").localeCompare(String(left.name || "")))
    .slice(0, limit)
    .map(entry => {
      const name = String(entry.name || "");
      const changedAt = remoteBackupVersionTimestamp(name, prefix, Math.max(0, Number(entry.mtime || 0)) * 1000);
      return {
        name,
        path:directory === "/" ? `/${name}` : directory === "." ? name : `${directory}/${name}`,
        size:Math.max(0, Number(entry.size || 0)),
        mtime:Math.max(0, Number(entry.mtime || 0)),
        changed_at:changedAt
      };
    });
  return {path:remotePath, limit, versions};
}

function buildRemoteDirectorySizeCommand(remotePath, connection = null, token = "") {
  const pathValue = String(remotePath || "").replace(/\\/g, "/");
  if (!pathValue || pathValue.includes("\0") || pathValue.length > 4096) throw new Error("远程目录路径无效或过长");
  const safeToken = /^[a-f0-9]{8,64}$/i.test(String(token || ""))
    ? String(token)
    : randomBytes(12).toString("hex");
  return [
    `TERMA_TARGET=${remotePathOperand(connection, pathValue)}`,
    `TERMA_SIZE_FILE="\${TMPDIR:-/tmp}/.terma-size-${safeToken}"`,
    `trap 'rm -f "$TERMA_SIZE_FILE"' 0 1 2 3 15`,
    `if [ ! -d "$TERMA_TARGET" ]; then printf '%s\\n' '目标不是目录或已不存在' >&2; exit 1; fi`,
    `if stat -c '%s' "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_STAT_STYLE=gnu; elif stat -f '%z' "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_STAT_STYLE=bsd; else printf '%s\\n' '远程系统缺少兼容的 stat 命令' >&2; exit 1; fi`,
    `if [ "$TERMA_STAT_STYLE" = gnu ]; then if ! find "$TERMA_TARGET" -type f -exec stat -c '%s' {} + > "$TERMA_SIZE_FILE"; then printf '%s\\n' '目录存在无法读取的内容，未返回不完整大小' >&2; exit 1; fi; else if ! find "$TERMA_TARGET" -type f -exec stat -f '%z' {} + > "$TERMA_SIZE_FILE"; then printf '%s\\n' '目录存在无法读取的内容，未返回不完整大小' >&2; exit 1; fi; fi`,
    `awk 'BEGIN { total=0 } { if ($1 !~ /^[0-9]+$/) exit 2; total += $1 } END { if (NR == 0) print "0"; else printf "%.0f\\n", total }' "$TERMA_SIZE_FILE"`
  ].join("; ");
}

async function readRemoteDirectorySize(connectionId, remotePath) {
  const connection = getSftpConnection(connectionId);
  const command = buildRemoteDirectorySizeCommand(remotePath, connection);
  const output = (await runRemote(connection, command, null, 5 * 60 * 1000)).toString("utf8").trim();
  const sizeBytes = output.split(/\r?\n/).filter(Boolean).pop() || "";
  if (!/^\d+$/.test(sizeBytes)) throw new Error("远程目录大小返回格式无效");
  const exactSize = BigInt(sizeBytes);
  return {
    path:String(remotePath || ""),
    size:exactSize <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exactSize) : null,
    size_bytes:exactSize.toString(),
    method:"recursive-file-bytes"
  };
}

async function makeRemoteDir(connectionId, remotePath) {
  const connection = getSftpConnection(connectionId);
  await runRemote(connection, `mkdir -p ${remotePathOperand(connection, remotePath)}`);
  return { ok: true };
}

function normalizeRemoteCreateFilePath(remotePath) {
  const raw = String(remotePath || "").replace(/\\/g, "/").trim();
  if (!raw || raw.includes("\0") || raw.length > 4096) throw new Error("新建文件路径无效或过长");
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === "/" || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("新建文件路径无效");
  }
  if (raw.endsWith("/")) throw new Error("文件名不能以斜杠结尾");
  return normalized;
}

function buildRemoteCreateFileCommand(remotePath, connection = null) {
  const normalizedPath = normalizeRemoteCreateFilePath(remotePath);
  const quotedPath = remotePathOperand(connection, normalizedPath);
  return {
    path: normalizedPath,
    command: `if [ -e ${quotedPath} ] || [ -L ${quotedPath} ]; then printf '%s\\n' '目标文件已存在' >&2; exit 1; fi; : > ${quotedPath}`
  };
}

async function createRemoteFile(connectionId, remotePath) {
  const connection = getSftpConnection(connectionId);
  const { path: normalizedPath, command } = buildRemoteCreateFileCommand(remotePath, connection);
  await runRemote(connection, command, null, 60000);
  return { ok: true, path: normalizedPath };
}

function normalizeRemoteDeletePath(remotePath) {
  const raw = String(remotePath || "").replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.length > 4096) throw new Error("远程路径无效或过长");
  const normalized = path.posix.normalize(raw);
  if (!normalized || ["/", ".", ".."].includes(normalized) || normalized.startsWith("../")) {
    throw new Error("不能删除根目录或当前目录");
  }
  return normalized;
}

function buildDeleteRemotePathCommand(remotePath, connection = null) {
  const normalizedPath = normalizeRemoteDeletePath(remotePath);
  return {
    path: normalizedPath,
    command: `rm -rf -- ${remotePathOperand(connection, normalizedPath)}`
  };
}

async function deleteRemotePath(connectionId, remotePath) {
  const connection = getSftpConnection(connectionId);
  const request = buildDeleteRemotePathCommand(remotePath, connection);
  await runRemote(connection, request.command);
  return { ok: true };
}

function normalizeRemoteRecyclePath(remotePath) {
  const raw = String(remotePath || "").replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.length > 4096) throw new Error("远程路径无效或过长");
  const normalized = path.posix.normalize(raw);
  if (!normalized || ["/", ".", ".."].includes(normalized) || normalized.startsWith("../")) {
    throw new Error("不能将根目录或当前目录移入回收站");
  }
  if (normalized.split("/").some(part => SFTP_RECYCLE_DIRECTORIES.includes(part))) throw new Error("不能操作 Terma 回收站目录");
  return normalized;
}

function normalizeRemoteRecycleItemId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9-]{8,80}$/.test(id)) throw new Error("回收站项目编号无效");
  return id;
}

function normalizeRemoteRecycleStorage(value) {
  const storage = String(value || "terma").trim().toLowerCase();
  if (storage === "terma") return { key:"terma", directory:SFTP_RECYCLE_DIRECTORY };
  if (storage === "tunneldesk") return { key:"tunneldesk", directory:LEGACY_SFTP_RECYCLE_DIRECTORY };
  throw new Error("回收站来源无效");
}

function remoteRecycleRootAssignment(storage = "terma") {
  const directory = normalizeRemoteRecycleStorage(storage).directory;
  return `if [ -z "$HOME" ]; then echo "远端用户主目录不可用" >&2; exit 1; fi; terma_root="$HOME/${directory}"`;
}

function buildRecycleRemotePathCommand(remotePath, itemId, deletedAt = Date.now(), connection = null) {
  const source = normalizeRemoteRecyclePath(remotePath);
  const id = normalizeRemoteRecycleItemId(itemId);
  const encodedPath = Buffer.from(source, "utf8").toString("base64");
  const sourceOperand = permissionPathOperand(source);
  return [
    remoteRecycleRootAssignment(),
    `terma_item="$terma_root/items/${id}"`,
    `if [ ! -e ${remotePathOperand(connection, sourceOperand)} ] && [ ! -L ${remotePathOperand(connection, sourceOperand)} ]; then echo "远程项目不存在" >&2; exit 1; fi`,
    `mkdir -p "$terma_root/items" && mkdir "$terma_item"`,
    `printf '%s\\n' ${shellQuote(encodedPath)} > "$terma_item/path.b64"`,
    `printf '%s\\n' ${shellQuote(String(Number(deletedAt) || Date.now()))} > "$terma_item/deleted-at"`,
    `if mv ${remotePathOperand(connection, sourceOperand)} "$terma_item/payload"; then :; else rm -rf "$terma_item"; exit 1; fi`
  ].join("; ");
}

function buildListRemoteRecycleCommand() {
  const commands = [`if [ -z "$HOME" ]; then echo "远端用户主目录不可用" >&2; exit 1; fi`];
  for (const storage of ["terma", "tunneldesk"]) {
    const source = normalizeRemoteRecycleStorage(storage);
    commands.push(
      `terma_root="$HOME/${source.directory}"`,
      `terma_items="$terma_root/items"`,
      `if [ -d "$terma_items" ]; then for terma_item in "$terma_items"/*; do [ -d "$terma_item" ] || continue; terma_id=\${terma_item##*/}; terma_path=$(tr -d '\\r\\n' < "$terma_item/path.b64" 2>/dev/null) || continue; terma_deleted=$(tr -d '\\r\\n' < "$terma_item/deleted-at" 2>/dev/null); if [ -d "$terma_item/payload" ]; then terma_type=dir; else terma_type=file; fi; printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$terma_id" "$terma_path" "$terma_deleted" "$terma_type" ${shellQuote(source.key)}; done; fi`
    );
  }
  return commands.join("; ");
}

function decodeRemoteRecyclePath(value) {
  const encoded = String(value || "").trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("回收站元数据已损坏");
  return normalizeRemoteRecyclePath(Buffer.from(encoded, "base64").toString("utf8"));
}

function parseRemoteRecycleItems(output) {
  return String(output || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [rawId, encodedPath, rawDeletedAt, rawType, rawStorage] = line.split("\t");
    const id = normalizeRemoteRecycleItemId(rawId);
    const originalPath = decodeRemoteRecyclePath(encodedPath);
    return {
      id,
      original_path: originalPath,
      name: path.posix.basename(originalPath),
      type: rawType === "dir" ? "dir" : "file",
      deleted_at: Number(rawDeletedAt) || 0,
      storage: normalizeRemoteRecycleStorage(rawStorage || "terma").key
    };
  }).sort((left, right) => right.deleted_at - left.deleted_at);
}

function buildRestoreRemoteRecycleCommand(itemId, originalPath, connection = null, storage = "terma") {
  const id = normalizeRemoteRecycleItemId(itemId);
  const target = normalizeRemoteRecyclePath(originalPath);
  const targetOperand = permissionPathOperand(target);
  const parentOperand = permissionPathOperand(path.posix.dirname(target));
  return [
    remoteRecycleRootAssignment(storage),
    `terma_item="$terma_root/items/${id}"`,
    `if [ ! -e "$terma_item/payload" ] && [ ! -L "$terma_item/payload" ]; then echo "回收站项目不存在" >&2; exit 1; fi`,
    `if [ -e ${remotePathOperand(connection, targetOperand)} ] || [ -L ${remotePathOperand(connection, targetOperand)} ]; then echo "原路径已有同名项目，无法恢复" >&2; exit 1; fi`,
    `mkdir -p ${remotePathOperand(connection, parentOperand)}`,
    `mv "$terma_item/payload" ${remotePathOperand(connection, targetOperand)}`,
    `rm -rf "$terma_item"`
  ].join("; ");
}

function buildDeleteRemoteRecycleCommand(itemId, storage = "terma") {
  const id = normalizeRemoteRecycleItemId(itemId);
  return `${remoteRecycleRootAssignment(storage)}; terma_item="$terma_root/items/${id}"; if [ ! -d "$terma_item" ]; then echo "回收站项目不存在" >&2; exit 1; fi; rm -rf "$terma_item"`;
}

function buildClearRemoteRecycleCommand() {
  return ["terma", "tunneldesk"].map(storage => `${remoteRecycleRootAssignment(storage)}; rm -rf "$terma_root/items"; mkdir -p "$terma_root/items"`).join("; ");
}

async function readRemoteRecycleItem(connection, itemId, storage = "terma") {
  const id = normalizeRemoteRecycleItemId(itemId);
  const command = `${remoteRecycleRootAssignment(storage)}; terma_item="$terma_root/items/${id}"; cat "$terma_item/path.b64"`;
  return decodeRemoteRecyclePath((await runRemote(connection, command)).toString("utf8"));
}

async function recycleRemotePath(connectionId, remotePath) {
  const connection = getSftpConnection(connectionId);
  const id = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
  const deletedAt = Date.now();
  const originalPath = normalizeRemoteRecyclePath(remotePath);
  await runRemote(connection, buildRecycleRemotePathCommand(originalPath, id, deletedAt, connection), null, 60000);
  return { ok: true, recycled: true, id, original_path: originalPath, deleted_at: deletedAt };
}

async function listRemoteRecycleItems(connectionId) {
  const connection = getSftpConnection(connectionId);
  return parseRemoteRecycleItems((await runRemote(connection, buildListRemoteRecycleCommand())).toString("utf8"));
}

async function restoreRemoteRecycleItem(connectionId, itemId, storage = "terma") {
  const connection = getSftpConnection(connectionId);
  const originalPath = await readRemoteRecycleItem(connection, itemId, storage);
  await runRemote(connection, buildRestoreRemoteRecycleCommand(itemId, originalPath, connection, storage), null, 60000);
  return { ok: true, original_path: originalPath };
}

async function deleteRemoteRecycleItem(connectionId, itemId, storage = "terma") {
  const connection = getSftpConnection(connectionId);
  await runRemote(connection, buildDeleteRemoteRecycleCommand(itemId, storage), null, 60000);
  return { ok: true };
}

async function clearRemoteRecycleItems(connectionId) {
  const connection = getSftpConnection(connectionId);
  await runRemote(connection, buildClearRemoteRecycleCommand(), null, 60000);
  return { ok: true };
}

async function renameRemotePath(connectionId, from, to) {
  const connection = getSftpConnection(connectionId);
  await runRemote(connection, `mv -- ${remotePathOperand(connection, from)} ${remotePathOperand(connection, to)}`);
  return { ok: true };
}

function normalizeRemotePrincipal(value, label) {
  const principal = String(value || "").trim();
  if (!principal) return "";
  if (principal.length > 64 || !/^(?:[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+)$/.test(principal)) throw new Error(`${label}格式无效`);
  return principal;
}

function normalizeRemotePermissionRequest(paths, mode, recursive = false, owner = "", group = "") {
  const source = Array.isArray(paths) ? paths : [paths];
  const normalizedPaths = [...new Set(source
    .map((item) => path.posix.normalize(String(item || "").replace(/\\/g, "/").trim()))
    .filter(Boolean))];
  if (!normalizedPaths.length) throw new Error("请选择要设置权限的文件或目录");
  if (normalizedPaths.length > 200) throw new Error("一次最多设置 200 个文件或目录的权限");
  if (normalizedPaths.some((item) => item.includes("\0") || item.length > 4096)) throw new Error("远程路径无效或过长");
  if (normalizedPaths.reduce((total, item) => total + item.length, 0) > 32768) throw new Error("所选远程路径总长度过长");
  const normalizedMode = String(mode ?? "").trim();
  if (!/^[0-7]{3}$/.test(normalizedMode)) throw new Error("权限值必须是三位八进制数字，例如 755");
  const applyRecursively = recursive === true;
  if (normalizedPaths.some((item) => item === ".." || item.startsWith("../"))) throw new Error("远程路径不能越出当前连接目录");
  if (applyRecursively && normalizedPaths.some((item) => ["/", ".", ".."].includes(item))) {
    throw new Error("不能对根目录或当前目录递归设置权限");
  }
  return {
    paths: normalizedPaths,
    mode: normalizedMode,
    recursive: applyRecursively,
    owner: normalizeRemotePrincipal(owner, "所有者"),
    group: normalizeRemotePrincipal(group, "用户组")
  };
}

function buildRemotePermissionCommand(request, connection = null) {
  const normalized = normalizeRemotePermissionRequest(request?.paths, request?.mode, request?.recursive, request?.owner, request?.group);
  const permissionPaths = normalized.paths.map(permissionPathOperand);
  const quotedPaths = permissionPaths.map((item) => remotePathOperand(connection, item)).join(" ");
  const commands = permissionPaths.map((item) => `if [ -L ${remotePathOperand(connection, item)} ]; then echo "暂不支持修改符号链接权限" >&2; exit 1; fi`);
  const recursiveFlag = normalized.recursive ? "-R " : "";
  if (normalized.owner && normalized.group) {
    commands.push(`chown ${recursiveFlag}${shellQuote(`${normalized.owner}:${normalized.group}`)} ${quotedPaths}`);
  } else if (normalized.owner) {
    commands.push(`chown ${recursiveFlag}${shellQuote(normalized.owner)} ${quotedPaths}`);
  } else if (normalized.group) {
    commands.push(`chgrp ${recursiveFlag}${shellQuote(normalized.group)} ${quotedPaths}`);
  }
  commands.push(`chmod ${recursiveFlag}${normalized.mode} ${quotedPaths}`);
  return commands.join(" && ");
}

async function setRemotePermissions(connectionId, paths, mode, recursive = false, owner = "", group = "") {
  const connection = getSftpConnection(connectionId);
  const request = normalizeRemotePermissionRequest(paths, mode, recursive, owner, group);
  await runRemote(connection, buildRemotePermissionCommand(request, connection), null, 120000);
  invalidateRemoteDirectoryCache(connectionId);
  return { ok: true, ...request };
}

async function copyRemotePaths(connectionId, paths, targetDir) {
  const connection = getSftpConnection(connectionId);
  const quoted = (paths || []).map((item) => remotePathOperand(connection, item)).join(" ");
  if (!quoted) throw new Error("请选择要复制的文件");
  await runRemote(connection, `cp -a -- ${quoted} ${remotePathOperand(connection, targetDir)}`, null, 120000);
  return { ok: true };
}

async function moveRemotePaths(connectionId, paths, targetDir) {
  const connection = getSftpConnection(connectionId);
  const quoted = (paths || []).map((item) => remotePathOperand(connection, item)).join(" ");
  if (!quoted) throw new Error("请选择要移动的文件");
  await runRemote(connection, `mv -- ${quoted} ${remotePathOperand(connection, targetDir)}`, null, 120000);
  return { ok: true };
}

async function extractRemoteArchive(connectionId, remotePath, targetDir) {
  const connection = getSftpConnection(connectionId);
  const lower = String(remotePath || "").toLowerCase();
  let command;
  if (lower.endsWith(".zip")) command = `cd ${remotePathOperand(connection, targetDir)} && unzip -o ${remotePathOperand(connection, remotePath)}`;
  else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) command = `cd ${remotePathOperand(connection, targetDir)} && tar -xzf ${remotePathOperand(connection, remotePath)}`;
  else if (lower.endsWith(".tar")) command = `cd ${remotePathOperand(connection, targetDir)} && tar -xf ${remotePathOperand(connection, remotePath)}`;
  else throw new Error("暂只支持 zip、tar.gz、tgz、tar 解压");
  await runRemote(connection, command, null, 120000);
  return { ok: true };
}

function normalizeOpenFileLimit(value) {
  const limit = Number(value || DEFAULT_MAX_OPEN_FILE_SIZE);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 * 1024 * 1024) throw new Error("SFTP 文件打开上限无效");
  return limit;
}

function formatOpenFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2).replace(/\.00$/, "")} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2).replace(/\.00$/, "")} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${bytes} B`;
}

function humanizeOpenFileError(value, maximumBytes) {
  const message = String(value?.message || value || "远程文件读取失败").trim();
  const linked = /符号链接本身为\s+(\d+)\s+B，目标文件实际为\s+(\d+)\s+B/.exec(message);
  if (linked) {
    return `符号链接本身为 ${formatOpenFileSize(linked[1])}，目标文件实际为 ${formatOpenFileSize(linked[2])}，超过 ${formatOpenFileSize(maximumBytes)}，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限`;
  }
  const regular = /文件实际为\s+(\d+)\s+B/.exec(message);
  if (regular) {
    return `文件实际为 ${formatOpenFileSize(regular[1])}，超过 ${formatOpenFileSize(maximumBytes)}，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限`;
  }
  return message;
}

function normalizeRemoteUploadName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/\\\\\0]/.test(name)) {
    throw new Error("上传文件名无效");
  }
  if (Buffer.byteLength(name, "utf8") > 255) throw new Error("上传文件名过长");
  return name;
}

function normalizeRemoteUploadDirectory(value) {
  const raw = String(value || ".").replace(/\\\\/g, "/").trim();
  if (!raw || raw.includes("\0") || raw.length > 4096) throw new Error("上传目录无效");
  return raw;
}

function joinRemoteUploadPath(directory, name) {
  const dir = directory === "/" ? "/" : directory.replace(/\/+$/, "") || ".";
  return dir === "/" ? `/${name}` : dir === "." ? name : `${dir}/${name}`;
}

async function remotePathExists(connection, remotePath) {
  const output = await runRemote(
    connection,
    `if [ -e ${remotePathOperand(connection, remotePath)} ] || [ -L ${remotePathOperand(connection, remotePath)} ]; then printf '1'; else printf '0'; fi`
  );
  return output.toString("utf8") === "1";
}

function suffixedRemoteUploadName(name, index) {
  const extension = path.posix.extname(name);
  const base = extension && extension !== name ? name.slice(0, -extension.length) : name;
  return `${base} (${index})${extension}`;
}

async function resolveRemoteUploadTarget(connectionId, directory, filename, conflict = "error") {
  const connection = getSftpConnection(connectionId);
  const dir = normalizeRemoteUploadDirectory(directory);
  const name = normalizeRemoteUploadName(filename);
  const requestedPath = joinRemoteUploadPath(dir, name);
  const exists = await remotePathExists(connection, requestedPath);
  if (!exists) return { path:requestedPath, name, exists:false, renamed:false };
  if (conflict === "overwrite") return { path:requestedPath, name, exists:true, renamed:false };
  if (conflict !== "rename") return { path:requestedPath, name, exists:true, renamed:false };
  for (let index = 1; index <= 9999; index += 1) {
    const candidateName = suffixedRemoteUploadName(name, index);
    if (!await remotePathExists(connection, joinRemoteUploadPath(dir, candidateName))) {
      return { path:joinRemoteUploadPath(dir, candidateName), name:candidateName, exists:true, renamed:true };
    }
  }
  throw new Error("无法为上传文件生成可用名称");
}

async function planRemoteUploads(connectionId, directory, filenames) {
  const source = Array.isArray(filenames) ? filenames : [];
  if (!source.length || source.length > 200) throw new Error("一次最多检查 200 个上传文件");
  const seen = new Set();
  const items = [];
  for (const rawName of source) {
    const name = normalizeRemoteUploadName(rawName);
    if (seen.has(name)) continue;
    seen.add(name);
    const target = await resolveRemoteUploadTarget(connectionId, directory, name, "error");
    const renamed = target.exists ? await resolveRemoteUploadTarget(connectionId, directory, name, "rename") : target;
    items.push({ name, exists:target.exists, suggested_name:renamed.name, suggested_path:renamed.path });
  }
  return { directory:normalizeRemoteUploadDirectory(directory), items };
}

function buildReadRemoteBinaryCommand(remotePath, maximumBytes, connection = null) {
  const limit = normalizeOpenFileLimit(maximumBytes);
  const limitMb = Math.max(1, Math.round(limit / 1024 / 1024));
  return [
    `TERMA_TARGET=${remotePathOperand(connection, remotePath)}`,
    `TERMA_LIMIT=${limit}`,
    `if [ -L "$TERMA_TARGET" ]; then TERMA_IS_LINK=1; else TERMA_IS_LINK=0; fi`,
    `if [ "$TERMA_IS_LINK" = 1 ] && [ ! -e "$TERMA_TARGET" ]; then printf "%s\\n" "符号链接指向的目标不存在" >&2; exit 1; fi`,
    `if [ ! -f "$TERMA_TARGET" ]; then printf "%s\\n" "目标不是普通文件" >&2; exit 1; fi`,
    `if stat -L -c "%s" "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_STAT_STYLE=gnu; TERMA_SIZE=$(stat -L -c "%s" "$TERMA_TARGET"); if [ "$TERMA_IS_LINK" = 1 ]; then TERMA_LINK_SIZE=$(stat -c "%s" "$TERMA_TARGET"); fi`,
    `elif stat -L -f "%z" "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_STAT_STYLE=bsd; TERMA_SIZE=$(stat -L -f "%z" "$TERMA_TARGET"); if [ "$TERMA_IS_LINK" = 1 ]; then TERMA_LINK_SIZE=$(stat -f "%z" "$TERMA_TARGET"); fi`,
    `else printf "%s\\n" "远程系统缺少兼容的 stat 命令" >&2; exit 1; fi`,
    `case "$TERMA_SIZE" in ""|*[!0-9]*) printf "%s\\n" "远程文件大小返回格式无效" >&2; exit 1;; esac`,
    `if [ "$TERMA_SIZE" -gt "$TERMA_LIMIT" ]; then if [ "$TERMA_IS_LINK" = 1 ]; then printf "符号链接本身为 %s B，目标文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "\${TERMA_LINK_SIZE:-0}" "$TERMA_SIZE" >&2; else printf "文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "$TERMA_SIZE" >&2; fi; exit 1; fi`,
    `head -c ${limit + 1} "$TERMA_TARGET"`
  ].join("; ");
}

function buildReadRemoteBinaryExecCommand(remotePath, maximumBytes, connection = null) {
  return buildRemotePosixCommand(buildReadRemoteBinaryCommand(remotePath, maximumBytes, connection));
}

async function readRemoteBinaryFile(connectionId, remotePath, maximumBytes = DEFAULT_MAX_OPEN_FILE_SIZE) {
  const connection = getSftpConnection(connectionId);
  const limit = normalizeOpenFileLimit(maximumBytes);
  let body;
  try {
    body = await runRemoteCommand(connection, buildReadRemoteBinaryExecCommand(remotePath, limit, connection), null, 60000);
  } catch (error) {
    throw new Error(humanizeOpenFileError(error, limit));
  }
  if (body.length > limit) throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限`);
  return {content:body, size:body.length, limit};
}

function buildStreamRemoteOpenCommand(remotePath, maximumBytes, connection = null) {
  const limit = normalizeOpenFileLimit(maximumBytes);
  const limitMb = Math.max(1, Math.round(limit / 1024 / 1024));
  return [
    `TERMA_TARGET=${remotePathOperand(connection, remotePath)}`,
    `TERMA_LIMIT=${limit}`,
    `if [ -L "$TERMA_TARGET" ]; then TERMA_IS_LINK=1; else TERMA_IS_LINK=0; fi`,
    `if [ "$TERMA_IS_LINK" = 1 ] && [ ! -e "$TERMA_TARGET" ]; then printf "%s\\n" "符号链接指向的目标不存在" >&2; exit 1; fi`,
    `if [ ! -f "$TERMA_TARGET" ]; then printf "%s\\n" "目标不是普通文件" >&2; exit 1; fi`,
    `if stat -L -c "%s" "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_SIZE=$(stat -L -c "%s" "$TERMA_TARGET"); if [ "$TERMA_IS_LINK" = 1 ]; then TERMA_LINK_SIZE=$(stat -c "%s" "$TERMA_TARGET"); fi`,
    `elif stat -L -f "%z" "$TERMA_TARGET" >/dev/null 2>&1; then TERMA_SIZE=$(stat -L -f "%z" "$TERMA_TARGET"); if [ "$TERMA_IS_LINK" = 1 ]; then TERMA_LINK_SIZE=$(stat -f "%z" "$TERMA_TARGET"); fi`,
    `else printf "%s\\n" "远程系统缺少兼容的 stat 命令" >&2; exit 1; fi`,
    `case "$TERMA_SIZE" in ""|*[!0-9]*) printf "%s\\n" "远程文件大小返回格式无效" >&2; exit 1;; esac`,
    `if [ "$TERMA_SIZE" -gt "$TERMA_LIMIT" ]; then if [ "$TERMA_IS_LINK" = 1 ]; then printf "符号链接本身为 %s B，目标文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "\${TERMA_LINK_SIZE:-0}" "$TERMA_SIZE" >&2; else printf "文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "$TERMA_SIZE" >&2; fi; exit 1; fi`,
    `printf "TERMA_OPEN_READY:%s:%s:%s\\n" "$TERMA_SIZE" "$TERMA_IS_LINK" "\${TERMA_LINK_SIZE:-0}"`,
    `head -c "$TERMA_SIZE" < "$TERMA_TARGET"`
  ].join("; ");
}

function streamRemoteOpenFile(connectionId, remotePath, maximumBytes, res, req, secureResponseHeaders = headers => headers) {
  const connection = getSftpConnection(connectionId);
  const limit = normalizeOpenFileLimit(maximumBytes);
  const child = spawnRemote(connection, buildStreamRemoteOpenCommand(remotePath, limit, connection));
  let headerBuffer = Buffer.alloc(0);
  let headersSent = false;
  let completed = false;
  let expectedSize = -1;
  let writtenSize = 0;
  let stderrSize = 0;
  const stderr = [];
  const cleanup = () => {
    req?.removeListener("aborted", abort);
    res?.removeListener("close", onResponseClose);
  };
  const abort = () => {
    if (completed) return;
    completed = true;
    cleanup();
    try { child.kill("SIGKILL"); } catch {}
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  const sendError = value => {
    if (completed) return;
    completed = true;
    cleanup();
    const message = humanizeOpenFileError(value, limit);
    if (headersSent || res.headersSent) {
      try { res.destroy(new Error(message)); } catch {}
      return;
    }
    const body = Buffer.from(JSON.stringify({error:message}), "utf8");
    res.writeHead(500, secureResponseHeaders({
      "Content-Type":"application/json; charset=utf-8",
      "Content-Length":body.length,
      "Cache-Control":"no-store"
    }));
    res.end(body);
  };
  const writeBody = chunk => {
    if (!chunk.length || completed) return;
    if (expectedSize < 0 || writtenSize + chunk.length > expectedSize) {
      sendError("远程文件内容超过声明大小");
      try { child.kill("SIGKILL"); } catch {}
      return;
    }
    writtenSize += chunk.length;
    if (!res.write(chunk)) {
      child.stdout.pause();
      res.once("drain", () => {
        if (!completed) child.stdout.resume();
      });
    }
  };
  req?.once("aborted", abort);
  res?.once("close", onResponseClose);
  child.stdout.on("data", chunk => {
    if (completed) return;
    if (headersSent) return writeBody(chunk);
    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const newline = headerBuffer.indexOf(0x0a);
    if (newline < 0 && headerBuffer.length > 1024) return sendError("远程文件流响应头无效");
    if (newline < 0) return;
    if (newline > 1024) return sendError("远程文件流响应头无效");
    const marker = headerBuffer.subarray(0, newline).toString("utf8").trim();
    const match = /^TERMA_OPEN_READY:(\d+):([01]):(\d+)$/.exec(marker);
    if (!match) return sendError("远程文件流响应头无效");
    const size = Number(match[1]);
    if (!Number.isSafeInteger(size) || size < 0 || size > limit) return sendError("远程文件大小超出允许范围");
    expectedSize = size;
    headersSent = true;
    res.writeHead(200, secureResponseHeaders({
      "Content-Type":"application/octet-stream",
      "Content-Length":size,
      "Cache-Control":"no-store",
      "X-Terma-File-Size":size,
      "X-Terma-File-Limit":limit,
      "X-Terma-File-Link":match[2]
    }));
    writeBody(headerBuffer.subarray(newline + 1));
    headerBuffer = Buffer.alloc(0);
  });
  child.stderr.on("data", chunk => {
    if (stderrSize >= 64 * 1024) return;
    const bounded = chunk.subarray(0, 64 * 1024 - stderrSize);
    stderr.push(bounded);
    stderrSize += bounded.length;
  });
  child.on("error", error => sendError(error));
  child.on("close", code => {
    if (completed) return;
    if (!headersSent || code !== 0 || writtenSize !== expectedSize) {
      const sizeMismatch = headersSent && code === 0 && writtenSize !== expectedSize
        ? `远程文件读取不完整：${formatOpenFileSize(writtenSize)} / ${formatOpenFileSize(expectedSize)}`
        : "";
      sendError(Buffer.concat(stderr).toString("utf8").trim() || sizeMismatch || `远程文件读取失败（退出码 ${code ?? "?"}）`);
      return;
    }
    completed = true;
    cleanup();
    res.end();
  });
  child.stdin.end();
}

async function readRemoteTextFile(connectionId, remotePath, requestedEncoding = "", maximumBytes = DEFAULT_MAX_OPEN_FILE_SIZE) {
  const connection = getSftpConnection(connectionId);
  const {content:body, size, limit} = await readRemoteBinaryFile(connectionId, remotePath, maximumBytes);
  if (body.includes(0)) throw new Error("该文件包含二进制内容，无法安全地以文本编辑");
  const preferred = normalizeTextEncoding(requestedEncoding || connection.sftp_text_encoding || "auto");
  const decoded = decodeRemoteText(body, preferred);
  return { ...decoded, preferred_encoding: connection.sftp_text_encoding || "auto", size, limit };
}
function streamRemoteFile(connectionId, remotePath, res, req) {
  const connection = getSftpConnection(connectionId);
  const basename = String(remotePath || "").split("/").pop() || "download";
  const child = spawnRemote(connection, `cat -- ${remotePathOperand(connection, remotePath)}`);
  let headersSent = false;
  let stderr = [];
  let aborted = false;
  const sendError = (message) => {
    if (headersSent || res.writableEnded) { try { res.end(); } catch {} return; }
    try {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: message }));
    } catch {}
  };
  const onAbort = () => {
    aborted = true;
    try { child.kill("SIGKILL"); } catch {}
  };
  if (req) req.on("close", onAbort);
  child.stdout.on("data", (chunk) => {
    if (aborted) return;
    if (!headersSent) {
      headersSent = true;
      try {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(basename)}"`,
          "Cache-Control": "no-store"
        });
      } catch {}
    }
    if (!res.write(chunk)) {
      child.stdout.pause();
      res.once("drain", () => child.stdout.resume());
    }
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", (error) => sendError(error.message || "远程文件读取失败"));
  child.on("close", (code) => {
    if (req) req.removeListener("close", onAbort);
    if (aborted) return;
    if (code !== 0 && !headersSent) {
      const message = Buffer.concat(stderr).toString("utf8").trim() || `远程文件读取失败（退出码 ${code ?? "?"}）`;
      sendError(message);
      return;
    }
    try { res.end(); } catch {}
  });
  child.stdin.end();
}

async function writeRemoteFile(connectionId, remotePath, data, options: { backup?: boolean } = {}) {
  const connection = getSftpConnection(connectionId);
  const quotedPath = remotePathOperand(connection, remotePath);
  let backupPath = null;
  let command = "";
  if (options.backup) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    backupPath = `${remotePath}.bak-${stamp}-${randomBytes(4).toString("hex")}`;
    command = `cp -p -- ${quotedPath} ${remotePathOperand(connection, backupPath)} && `;
  }
  await runRemote(connection, `${command}cat > ${quotedPath}`, data, 60000);
  return { ok: true, backup_path: backupPath };
}

async function setRemoteFileMtime(connectionId, remotePath, mtimeSeconds) {
  const connection = getSftpConnection(connectionId);
  const epoch = Math.max(0, Math.floor(Number(mtimeSeconds || 0)));
  if (!epoch) return {ok:true};
  const target = remotePathOperand(connection, remotePath);
  const command = `touch -m -d @${epoch} -- ${target} 2>/dev/null || { TERMA_STAMP=$(date -r ${epoch} +%Y%m%d%H%M.%S 2>/dev/null) && touch -m -t "$TERMA_STAMP" ${target}; }`;
  await runRemote(connection, command, null, 30000);
  invalidateRemoteDirectoryCache(connectionId);
  return {ok:true};
}

module.exports = {
  listRemoteDir,
  listRemoteFileVersions,
  __remoteBackupVersionTimestamp:remoteBackupVersionTimestamp,
  __buildRemoteDirectoryEntriesCommand:buildRemoteDirectoryEntriesCommand,
  __buildRemoteRecursiveDirectoryEntriesCommand:buildRemoteRecursiveDirectoryEntriesCommand,
  buildRemoteDirectorySizeCommand,
  readRemoteDirectorySize,
  normalizeRemoteDirectoryListOptions,
  paginateRemoteEntries,
  invalidateRemoteDirectoryCache,
  __cacheDirectorySnapshot: cacheDirectorySnapshot,
  __cachedDirectorySnapshot: cachedDirectorySnapshot,
  makeRemoteDir,
  buildRemoteCreateFileCommand,
  createRemoteFile,
  buildDeleteRemotePathCommand,
  deleteRemotePath,
  recycleRemotePath,
  listRemoteRecycleItems,
  restoreRemoteRecycleItem,
  deleteRemoteRecycleItem,
  clearRemoteRecycleItems,
  buildRecycleRemotePathCommand,
  buildListRemoteRecycleCommand,
  buildRestoreRemoteRecycleCommand,
  buildDeleteRemoteRecycleCommand,
  buildClearRemoteRecycleCommand,
  parseRemoteRecycleItems,
  copyRemotePaths,
  moveRemotePaths,
  normalizeRemotePermissionRequest,
  buildRemotePermissionCommand,
  setRemotePermissions,
  extractRemoteArchive,
  renameRemotePath,
  readRemoteTextFile,
  readRemoteBinaryFile,
  streamRemoteOpenFile,
  __buildStreamRemoteOpenCommand:buildStreamRemoteOpenCommand,
  __buildReadRemoteBinaryCommand:buildReadRemoteBinaryCommand,
  __buildReadRemoteBinaryExecCommand:buildReadRemoteBinaryExecCommand,
  decodeRemoteText,
  encodeRemoteText,
  normalizeTextEncoding,
  planRemoteUploads,
  remotePathOperand,
  resolveRemoteUploadTarget,
  decodeRemoteFilenameOutput,
  writeRemoteFile,
  setRemoteFileMtime,
  streamRemoteFile
};
