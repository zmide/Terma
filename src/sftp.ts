const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { getConnection } = require("./db");
const { buildRemotePosixCommand } = require("./remote-posix");
const { spawnSftpSessionCommand } = require("./sftp-session");
const {
  decodeRemoteFilenameOutput,
  decodeRemoteText,
  encodeRemoteText,
  normalizeTextEncoding,
  remotePathOperand,
  shellQuote
} = require("./sftp-encoding");
const DEFAULT_MAX_OPEN_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_DIRECTORY_PAGE_SIZE = 50;
const MAX_DIRECTORY_PAGE_SIZE = 200;
const DIRECTORY_CACHE_TTL_MS = 15 * 1000;
const DIRECTORY_CACHE_MAX_SNAPSHOTS = 20;
const SFTP_RECYCLE_DIRECTORY = ".tunneldesk-recycle-bin";
const directorySnapshots = new Map();
const directoryAliases = new Map();
const directoryNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function permissionPathOperand(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("./")) return normalized;
  return `./${normalized}`;
}

function spawnRemote(connection, command) {
  const portableCommand = `sh -c ${shellQuote(command)}`;
  return spawnSftpSessionCommand(connection, portableCommand);
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
      else if (code !== 0) reject(new Error(stderr || `远程命令退出码 ${code}`));
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
  return runRemoteCommand(connection, `sh -c ${shellQuote(command)}`, input, timeoutMs);
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
    refresh: options.refresh === true || String(options.refresh || "") === "1"
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

function directoryCacheKey(connectionId, remotePath) {
  return `${Number(connectionId)}\0${normalizedRemotePath(remotePath)}`;
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
  while (directorySnapshots.size > DIRECTORY_CACHE_MAX_SNAPSHOTS) {
    const oldest = directorySnapshots.keys().next().value;
    if (oldest === undefined) break;
    removeDirectorySnapshot(oldest);
  }
}

function cachedDirectorySnapshot(connectionId, remotePath) {
  pruneDirectorySnapshots();
  const requestedKey = directoryCacheKey(connectionId, remotePath);
  const canonicalKey = directoryAliases.get(requestedKey) || requestedKey;
  const snapshot = directorySnapshots.get(canonicalKey);
  if (!snapshot) return null;
  directorySnapshots.delete(canonicalKey);
  directorySnapshots.set(canonicalKey, snapshot);
  return snapshot;
}

function cacheDirectorySnapshot(connectionId, remotePath, snapshot) {
  pruneDirectorySnapshots();
  const requestedKey = directoryCacheKey(connectionId, remotePath);
  const canonicalKey = directoryCacheKey(connectionId, snapshot.path);
  directorySnapshots.delete(canonicalKey);
  directorySnapshots.set(canonicalKey, snapshot);
  directoryAliases.set(requestedKey, canonicalKey);
  directoryAliases.set(canonicalKey, canonicalKey);
  pruneDirectorySnapshots();
}

function invalidateRemoteDirectoryCache(connectionId) {
  const prefix = `${Number(connectionId)}\0`;
  for (const key of [...directorySnapshots.keys()]) {
    if (key.startsWith(prefix)) removeDirectorySnapshot(key);
  }
  for (const key of [...directoryAliases.keys()]) {
    if (key.startsWith(prefix)) directoryAliases.delete(key);
  }
}

function buildRemoteDirectoryEntriesCommand() {
  return [
    `if stat -c "%s" . >/dev/null 2>&1; then TD_STAT_STYLE=gnu`,
    `elif stat -f "%z" . >/dev/null 2>&1; then TD_STAT_STYLE=bsd`,
    `else echo "远程系统缺少兼容的 stat 命令" >&2; exit 1`,
    `fi`,
    `export TD_STAT_STYLE`,
    `find . ! -name . ! -name ${shellQuote(SFTP_RECYCLE_DIRECTORY)} ! -name ${shellQuote(".tunneldesk-upload-*.part")} -prune -exec sh -c 'for entry in "$@"; do td_link=0; td_link_size=0; td_link_missing=0; if [ -L "$entry" ]; then td_link=1; fi; if [ -d "$entry" ]; then type=d; else type=f; fi; if [ "$TD_STAT_STYLE" = gnu ]; then if [ "$td_link" = 1 ]; then own_meta=$(stat -c "%s %Y %a %U %G" "$entry") || exit 1; td_link_size=\${own_meta%% *}; if [ -e "$entry" ]; then meta=$(stat -L -c "%s %Y %a %U %G" "$entry") || exit 1; else meta=$own_meta; td_link_missing=1; fi; else meta=$(stat -c "%s %Y %a %U %G" "$entry") || exit 1; fi; else if [ "$td_link" = 1 ]; then own_meta=$(stat -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; td_link_size=\${own_meta%% *}; if [ -e "$entry" ]; then meta=$(stat -L -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; else meta=$own_meta; td_link_missing=1; fi; else meta=$(stat -f "%z %m %Lp %Su %Sg" "$entry") || exit 1; fi; fi; name=\${entry#./}; printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$name" "$type" "$meta" "$td_link" "$td_link_size" "$td_link_missing"; done' sh {} +`
  ].join("; ");
}

async function enumerateRemoteDir(connectionId, remotePath = ".") {
  const connection = getConnection(connectionId);
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

async function listRemoteDir(connectionId, remotePath = ".", options: any = {}) {
  const normalized = normalizeRemoteDirectoryListOptions(options);
  let snapshot = normalized.refresh ? null : cachedDirectorySnapshot(connectionId, remotePath);
  if (!snapshot) {
    const result = await enumerateRemoteDir(connectionId, remotePath);
    snapshot = { ...result, expires_at: Date.now() + DIRECTORY_CACHE_TTL_MS };
    cacheDirectorySnapshot(connectionId, remotePath, snapshot);
  }
  return {
    path: snapshot.path,
    ...paginateRemoteEntries(snapshot.entries, normalized)
  };
}

function buildRemoteDirectorySizeCommand(remotePath, connection = null, token = "") {
  const pathValue = String(remotePath || "").replace(/\\/g, "/");
  if (!pathValue || pathValue.includes("\0") || pathValue.length > 4096) throw new Error("远程目录路径无效或过长");
  const safeToken = /^[a-f0-9]{8,64}$/i.test(String(token || ""))
    ? String(token)
    : randomBytes(12).toString("hex");
  return [
    `TD_TARGET=${remotePathOperand(connection, pathValue)}`,
    `TD_SIZE_FILE="\${TMPDIR:-/tmp}/.tunneldesk-size-${safeToken}"`,
    `trap 'rm -f "$TD_SIZE_FILE"' 0 1 2 3 15`,
    `if [ ! -d "$TD_TARGET" ]; then printf '%s\\n' '目标不是目录或已不存在' >&2; exit 1; fi`,
    `if stat -c '%s' "$TD_TARGET" >/dev/null 2>&1; then TD_STAT_STYLE=gnu; elif stat -f '%z' "$TD_TARGET" >/dev/null 2>&1; then TD_STAT_STYLE=bsd; else printf '%s\\n' '远程系统缺少兼容的 stat 命令' >&2; exit 1; fi`,
    `if [ "$TD_STAT_STYLE" = gnu ]; then if ! find "$TD_TARGET" -type f -exec stat -c '%s' {} + > "$TD_SIZE_FILE"; then printf '%s\\n' '目录存在无法读取的内容，未返回不完整大小' >&2; exit 1; fi; else if ! find "$TD_TARGET" -type f -exec stat -f '%z' {} + > "$TD_SIZE_FILE"; then printf '%s\\n' '目录存在无法读取的内容，未返回不完整大小' >&2; exit 1; fi; fi`,
    `awk 'BEGIN { total=0 } { if ($1 !~ /^[0-9]+$/) exit 2; total += $1 } END { if (NR == 0) print "0"; else printf "%.0f\\n", total }' "$TD_SIZE_FILE"`
  ].join("; ");
}

async function readRemoteDirectorySize(connectionId, remotePath) {
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
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
  if (normalized.split("/").includes(SFTP_RECYCLE_DIRECTORY)) throw new Error("不能操作 TunnelDesk 回收站目录");
  return normalized;
}

function normalizeRemoteRecycleItemId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9-]{8,80}$/.test(id)) throw new Error("回收站项目编号无效");
  return id;
}

function remoteRecycleRootAssignment() {
  return `if [ -z "$HOME" ]; then echo "远端用户主目录不可用" >&2; exit 1; fi; td_root="$HOME/${SFTP_RECYCLE_DIRECTORY}"`;
}

function buildRecycleRemotePathCommand(remotePath, itemId, deletedAt = Date.now(), connection = null) {
  const source = normalizeRemoteRecyclePath(remotePath);
  const id = normalizeRemoteRecycleItemId(itemId);
  const encodedPath = Buffer.from(source, "utf8").toString("base64");
  const sourceOperand = permissionPathOperand(source);
  return [
    remoteRecycleRootAssignment(),
    `td_item="$td_root/items/${id}"`,
    `if [ ! -e ${remotePathOperand(connection, sourceOperand)} ] && [ ! -L ${remotePathOperand(connection, sourceOperand)} ]; then echo "远程项目不存在" >&2; exit 1; fi`,
    `mkdir -p "$td_root/items" && mkdir "$td_item"`,
    `printf '%s\\n' ${shellQuote(encodedPath)} > "$td_item/path.b64"`,
    `printf '%s\\n' ${shellQuote(String(Number(deletedAt) || Date.now()))} > "$td_item/deleted-at"`,
    `if mv ${remotePathOperand(connection, sourceOperand)} "$td_item/payload"; then :; else rm -rf "$td_item"; exit 1; fi`
  ].join("; ");
}

function buildListRemoteRecycleCommand() {
  return [
    remoteRecycleRootAssignment(),
    `td_items="$td_root/items"`,
    `if [ -d "$td_items" ]; then for td_item in "$td_items"/*; do [ -d "$td_item" ] || continue; td_id=\${td_item##*/}; td_path=$(tr -d '\\r\\n' < "$td_item/path.b64" 2>/dev/null) || continue; td_deleted=$(tr -d '\\r\\n' < "$td_item/deleted-at" 2>/dev/null); if [ -d "$td_item/payload" ]; then td_type=dir; else td_type=file; fi; printf '%s\\t%s\\t%s\\t%s\\n' "$td_id" "$td_path" "$td_deleted" "$td_type"; done; fi`
  ].join("; ");
}

function decodeRemoteRecyclePath(value) {
  const encoded = String(value || "").trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("回收站元数据已损坏");
  return normalizeRemoteRecyclePath(Buffer.from(encoded, "base64").toString("utf8"));
}

function parseRemoteRecycleItems(output) {
  return String(output || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [rawId, encodedPath, rawDeletedAt, rawType] = line.split("\t");
    const id = normalizeRemoteRecycleItemId(rawId);
    const originalPath = decodeRemoteRecyclePath(encodedPath);
    return {
      id,
      original_path: originalPath,
      name: path.posix.basename(originalPath),
      type: rawType === "dir" ? "dir" : "file",
      deleted_at: Number(rawDeletedAt) || 0
    };
  }).sort((left, right) => right.deleted_at - left.deleted_at);
}

function buildRestoreRemoteRecycleCommand(itemId, originalPath, connection = null) {
  const id = normalizeRemoteRecycleItemId(itemId);
  const target = normalizeRemoteRecyclePath(originalPath);
  const targetOperand = permissionPathOperand(target);
  const parentOperand = permissionPathOperand(path.posix.dirname(target));
  return [
    remoteRecycleRootAssignment(),
    `td_item="$td_root/items/${id}"`,
    `if [ ! -e "$td_item/payload" ] && [ ! -L "$td_item/payload" ]; then echo "回收站项目不存在" >&2; exit 1; fi`,
    `if [ -e ${remotePathOperand(connection, targetOperand)} ] || [ -L ${remotePathOperand(connection, targetOperand)} ]; then echo "原路径已有同名项目，无法恢复" >&2; exit 1; fi`,
    `mkdir -p ${remotePathOperand(connection, parentOperand)}`,
    `mv "$td_item/payload" ${remotePathOperand(connection, targetOperand)}`,
    `rm -rf "$td_item"`
  ].join("; ");
}

function buildDeleteRemoteRecycleCommand(itemId) {
  const id = normalizeRemoteRecycleItemId(itemId);
  return `${remoteRecycleRootAssignment()}; td_item="$td_root/items/${id}"; if [ ! -d "$td_item" ]; then echo "回收站项目不存在" >&2; exit 1; fi; rm -rf "$td_item"`;
}

function buildClearRemoteRecycleCommand() {
  return `${remoteRecycleRootAssignment()}; rm -rf "$td_root/items"; mkdir -p "$td_root/items"`;
}

async function readRemoteRecycleItem(connection, itemId) {
  const id = normalizeRemoteRecycleItemId(itemId);
  const command = `${remoteRecycleRootAssignment()}; td_item="$td_root/items/${id}"; cat "$td_item/path.b64"`;
  return decodeRemoteRecyclePath((await runRemote(connection, command)).toString("utf8"));
}

async function recycleRemotePath(connectionId, remotePath) {
  const connection = getConnection(connectionId);
  const id = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
  const deletedAt = Date.now();
  const originalPath = normalizeRemoteRecyclePath(remotePath);
  await runRemote(connection, buildRecycleRemotePathCommand(originalPath, id, deletedAt, connection), null, 60000);
  return { ok: true, recycled: true, id, original_path: originalPath, deleted_at: deletedAt };
}

async function listRemoteRecycleItems(connectionId) {
  const connection = getConnection(connectionId);
  return parseRemoteRecycleItems((await runRemote(connection, buildListRemoteRecycleCommand())).toString("utf8"));
}

async function restoreRemoteRecycleItem(connectionId, itemId) {
  const connection = getConnection(connectionId);
  const originalPath = await readRemoteRecycleItem(connection, itemId);
  await runRemote(connection, buildRestoreRemoteRecycleCommand(itemId, originalPath, connection), null, 60000);
  return { ok: true, original_path: originalPath };
}

async function deleteRemoteRecycleItem(connectionId, itemId) {
  const connection = getConnection(connectionId);
  await runRemote(connection, buildDeleteRemoteRecycleCommand(itemId), null, 60000);
  return { ok: true };
}

async function clearRemoteRecycleItems(connectionId) {
  const connection = getConnection(connectionId);
  await runRemote(connection, buildClearRemoteRecycleCommand(), null, 60000);
  return { ok: true };
}

async function renameRemotePath(connectionId, from, to) {
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
  const request = normalizeRemotePermissionRequest(paths, mode, recursive, owner, group);
  await runRemote(connection, buildRemotePermissionCommand(request, connection), null, 120000);
  invalidateRemoteDirectoryCache(connectionId);
  return { ok: true, ...request };
}

async function copyRemotePaths(connectionId, paths, targetDir) {
  const connection = getConnection(connectionId);
  const quoted = (paths || []).map((item) => remotePathOperand(connection, item)).join(" ");
  if (!quoted) throw new Error("请选择要复制的文件");
  await runRemote(connection, `cp -a -- ${quoted} ${remotePathOperand(connection, targetDir)}`, null, 120000);
  return { ok: true };
}

async function moveRemotePaths(connectionId, paths, targetDir) {
  const connection = getConnection(connectionId);
  const quoted = (paths || []).map((item) => remotePathOperand(connection, item)).join(" ");
  if (!quoted) throw new Error("请选择要移动的文件");
  await runRemote(connection, `mv -- ${quoted} ${remotePathOperand(connection, targetDir)}`, null, 120000);
  return { ok: true };
}

async function extractRemoteArchive(connectionId, remotePath, targetDir) {
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
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
    `TD_TARGET=${remotePathOperand(connection, remotePath)}`,
    `TD_LIMIT=${limit}`,
    `if [ -L "$TD_TARGET" ]; then TD_IS_LINK=1; else TD_IS_LINK=0; fi`,
    `if [ "$TD_IS_LINK" = 1 ] && [ ! -e "$TD_TARGET" ]; then printf "%s\\n" "符号链接指向的目标不存在" >&2; exit 1; fi`,
    `if [ ! -f "$TD_TARGET" ]; then printf "%s\\n" "目标不是普通文件" >&2; exit 1; fi`,
    `if stat -L -c "%s" "$TD_TARGET" >/dev/null 2>&1; then TD_STAT_STYLE=gnu; TD_SIZE=$(stat -L -c "%s" "$TD_TARGET"); if [ "$TD_IS_LINK" = 1 ]; then TD_LINK_SIZE=$(stat -c "%s" "$TD_TARGET"); fi`,
    `elif stat -L -f "%z" "$TD_TARGET" >/dev/null 2>&1; then TD_STAT_STYLE=bsd; TD_SIZE=$(stat -L -f "%z" "$TD_TARGET"); if [ "$TD_IS_LINK" = 1 ]; then TD_LINK_SIZE=$(stat -f "%z" "$TD_TARGET"); fi`,
    `else printf "%s\\n" "远程系统缺少兼容的 stat 命令" >&2; exit 1; fi`,
    `case "$TD_SIZE" in ""|*[!0-9]*) printf "%s\\n" "远程文件大小返回格式无效" >&2; exit 1;; esac`,
    `if [ "$TD_SIZE" -gt "$TD_LIMIT" ]; then if [ "$TD_IS_LINK" = 1 ]; then printf "符号链接本身为 %s B，目标文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "\${TD_LINK_SIZE:-0}" "$TD_SIZE" >&2; else printf "文件实际为 %s B，超过 ${limitMb} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限\\n" "$TD_SIZE" >&2; fi; exit 1; fi`,
    `head -c ${limit + 1} "$TD_TARGET"`
  ].join("; ");
}

function buildReadRemoteBinaryExecCommand(remotePath, maximumBytes, connection = null) {
  return buildRemotePosixCommand(buildReadRemoteBinaryCommand(remotePath, maximumBytes, connection));
}

async function readRemoteBinaryFile(connectionId, remotePath, maximumBytes = DEFAULT_MAX_OPEN_FILE_SIZE) {
  const connection = getConnection(connectionId);
  const limit = normalizeOpenFileLimit(maximumBytes);
  const body = await runRemoteCommand(connection, buildReadRemoteBinaryExecCommand(remotePath, limit, connection), null, 60000);
  if (body.length > limit) throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)} MB，不能在程序中打开；可在 SFTP 页面全局设置中调整打开上限`);
  return {content:body, size:body.length, limit};
}

async function readRemoteTextFile(connectionId, remotePath, requestedEncoding = "", maximumBytes = DEFAULT_MAX_OPEN_FILE_SIZE) {
  const connection = getConnection(connectionId);
  const {content:body, size, limit} = await readRemoteBinaryFile(connectionId, remotePath, maximumBytes);
  if (body.includes(0)) throw new Error("该文件包含二进制内容，无法安全地以文本编辑");
  const preferred = normalizeTextEncoding(requestedEncoding || connection.sftp_text_encoding || "auto");
  const decoded = decodeRemoteText(body, preferred);
  return { ...decoded, preferred_encoding: connection.sftp_text_encoding || "auto", size, limit };
}
function streamRemoteFile(connectionId, remotePath, res, req) {
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
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
  const connection = getConnection(connectionId);
  const epoch = Math.max(0, Math.floor(Number(mtimeSeconds || 0)));
  if (!epoch) return {ok:true};
  const target = remotePathOperand(connection, remotePath);
  const command = `touch -m -d @${epoch} -- ${target} 2>/dev/null || { TD_STAMP=$(date -r ${epoch} +%Y%m%d%H%M.%S 2>/dev/null) && touch -m -t "$TD_STAMP" ${target}; }`;
  await runRemote(connection, command, null, 30000);
  invalidateRemoteDirectoryCache(connectionId);
  return {ok:true};
}

module.exports = {
  listRemoteDir,
  __buildRemoteDirectoryEntriesCommand:buildRemoteDirectoryEntriesCommand,
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
