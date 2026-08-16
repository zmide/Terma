"use strict";

// Brand migration deliberately works on a staged runtime directory.  The
// caller can therefore point it at the packaged profile or at the repository
// runtime used by the unpackaged desktop and get the same merge semantics.
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");
const TRANSIENT_DATA_FILES = new Set(["web.pid", "web.url", "web.json", "shutdown.token"]);
const DATABASE_FILES = new Set(["tunnels.db", "tunnels.db-wal", "tunnels.db-shm"]);
const SECURITY_FILE = "security.json";
const SECRET_COLUMNS_BY_TABLE = {
  connections: [
    "identity_file",
    "ssh_password",
    "private_key_passphrase",
    "extra_args",
    "terminal_program_path",
    "terminal_program_args",
    "terminal_working_directory"
  ],
  remote_profiles: ["password"],
  tunnels: ["identity_file", "extra_args"]
};
const KNOWN_TABLES = new Set([
  "app_meta",
  "command_snippets",
  "connection_forwards",
  "connection_groups",
  "connections",
  "forward_templates",
  "named_workspaces",
  "remote_profiles",
  "tunnels"
]);

function migrationText(chinese, english, language = process.env.TERMA_INTERFACE_LANGUAGE) {
  return String(language || "").toLowerCase().startsWith("en") ? english : chinese;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function legacyCopyName(baseName, existingNames) {
  const fallback = migrationText("旧版项目", "Legacy item");
  const base = String(baseName || fallback).trim() || fallback;
  const format = suffix => migrationText(
    suffix > 1 ? `${base}（旧版 ${suffix}）` : `${base}（旧版）`,
    suffix > 1 ? `${base} (legacy ${suffix})` : `${base} (legacy)`
  );
  let candidate = format(1);
  let suffix = 2;
  while (existingNames.has(normalized(candidate))) candidate = format(suffix++);
  existingNames.add(normalized(candidate));
  return candidate;
}

function isLegacyCopyName(candidate, sourceName) {
  const value = String(candidate || "");
  const base = String(sourceName || "");
  return value === `${base}（旧版）`
    || (value.startsWith(`${base}（旧版 `) && value.endsWith("）"))
    || value === `${base} (legacy)`
    || (value.startsWith(`${base} (legacy `) && value.endsWith(")"));
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

function isWithin(file, root) {
  const candidate = normalizedPath(file);
  const parent = normalizedPath(root);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sqliteFile(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      return fs.readSync(fd, header, 0, header.length, 0) === header.length && header.equals(SQLITE_HEADER);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function databaseTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
}

function tableExists(db, table) {
  return databaseTables(db).includes(table);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => String(row.name));
}

function tableRows(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
}

function rowCount(db, table) {
  if (!tableExists(db, table)) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count || 0);
}

function counts(db) {
  return Object.fromEntries(databaseTables(db).map(table => [table, rowCount(db, table)]));
}

function copyFilePreservingMode(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  try { fs.chmodSync(destination, fs.statSync(source).mode & 0o777); } catch {}
}

function copyDirectory(source, destination, filter = () => true) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (!filter(sourcePath, entry)) continue;
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath, filter);
    else copyFilePreservingMode(sourcePath, destinationPath);
  }
}

function copyMissingDirectory(source, destination, filter = () => true, created = []) {
  if (!fs.existsSync(source)) return created;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (!filter(sourcePath, entry)) continue;
    if (fs.existsSync(destinationPath)) {
      if (entry.isDirectory()) copyMissingDirectory(sourcePath, destinationPath, filter, created);
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, filter);
      created.push(destinationPath);
    } else {
      copyFilePreservingMode(sourcePath, destinationPath);
      created.push(destinationPath);
    }
  }
  return created;
}

function removeCreatedFiles(created) {
  for (const item of [...created].sort((a, b) => b.length - a.length)) {
    try { fs.rmSync(item, { recursive: true, force: true }); } catch {}
  }
}

function makeTemporaryTreeRemovable(directory) {
  if (process.platform !== "win32" || !directory || !fs.existsSync(directory)) return;
  const username = String(process.env.USERNAME || "").trim();
  if (!username) return;
  const domain = String(process.env.USERDOMAIN || "").trim();
  const account = domain ? `${domain}\\${username}` : username;
  try {
    // Private-key copies intentionally inherit restrictive ACLs.  The
    // migration swap is disposable, so grant only the current user full
    // control long enough to remove that temporary tree.
    spawnSync("icacls", [directory, "/grant:r", `${account}:F`, "/T", "/C"], { encoding:"utf8", windowsHide:true, stdio:"ignore" });
  } catch {}
}

// Windows can briefly keep a copied private-key file open (usually an
// antivirus/indexer handle). Cleanup is best effort: once the staged runtime
// has passed its integrity checks, failure to remove an old swap directory
// must not roll the successful migration back.
function removeDirectoryBestEffort(directory) {
  if (!directory || !fs.existsSync(directory)) return true;
  makeTemporaryTreeRemovable(directory);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return !fs.existsSync(directory);
    } catch {
      try { fs.chmodSync(directory, 0o700); } catch {}
    }
  }
  return !fs.existsSync(directory);
}

function cloneSqlite(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try { fs.rmSync(destination, { force: true }); } catch {}
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try {
    const escaped = String(destination).replaceAll("'", "''");
    sourceDb.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    sourceDb.close();
  }
}

function openReadOnly(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA query_only=ON");
  return db;
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function securityDescriptor(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dataDir, "security.json"), "utf8"));
    const enabled = Boolean(value?.encryption_enabled);
    const requestedVersion = Number(value?.encryption_version || (enabled ? 1 : 3));
    return {
      enabled,
      state:String(value?.encryption_state || (enabled ? "enabled" : "disabled")),
      version:[1, 2, 3].includes(requestedVersion) ? requestedVersion : 1,
      salt:String(value?.encryption_salt || ""),
      check:String(value?.encryption_check || "")
    };
  } catch {
    return { enabled:false, state:"disabled", version:3, salt:"", check:"" };
  }
}

function secretCounts(db) {
  const result = { encrypted:0, v1:0, v2:0, v3:0, plain:0 };
  for (const [table, requestedColumns] of Object.entries(SECRET_COLUMNS_BY_TABLE)) {
    if (!tableExists(db, table)) continue;
    const columns = new Set(tableColumns(db, table));
    for (const column of requestedColumns) {
      if (!columns.has(column)) continue;
      const field = quoteIdentifier(column);
      result.v1 += Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${field} LIKE 'tdenc:v1:%' OR ${field} LIKE 'termaenc:v1:%'`).get().count || 0);
      result.v2 += Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${field} LIKE 'termaenc:v2:%'`).get().count || 0);
      result.v3 += Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${field} LIKE 'termaenc:v3:%'`).get().count || 0);
      result.plain += Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${field} IS NOT NULL AND ${field}<>'' AND ${field} NOT LIKE 'tdenc:v1:%' AND ${field} NOT LIKE 'termaenc:v1:%' AND ${field} NOT LIKE 'termaenc:v2:%' AND ${field} NOT LIKE 'termaenc:v3:%'`).get().count || 0);
    }
  }
  result.encrypted = result.v1 + result.v2 + result.v3;
  return result;
}

function assertDatabaseMatchesSecurityDescriptor(db, descriptor, label) {
  const secrets = secretCounts(db);
  if (descriptor.enabled) {
    if (descriptor.state !== "enabled") throw new Error(migrationText(`${label}的配置加密仍处于切换状态，不能迁移`, `${label} configuration encryption is still transitioning and cannot be migrated`));
    if (!descriptor.salt || !descriptor.check) throw new Error(migrationText(`${label}缺少配置加密校验信息，不能迁移`, `${label} is missing configuration-encryption verification data and cannot be migrated`));
    if (secrets.plain) throw new Error(migrationText(`${label}启用了配置加密，但数据库仍包含明文敏感字段`, `${label} has configuration encryption enabled, but the database still contains plaintext sensitive fields`));
    if (descriptor.version === 1 && (secrets.v2 || secrets.v3)) throw new Error(migrationText(`${label}的配置加密版本与数据库字段不一致`, `${label} configuration-encryption version does not match its database fields`));
    if (descriptor.version === 2 && (secrets.v1 || secrets.v3)) throw new Error(migrationText(`${label}的配置加密版本与数据库字段不一致`, `${label} configuration-encryption version does not match its database fields`));
    if (descriptor.version === 3 && (secrets.v1 || secrets.v2)) throw new Error(migrationText(`${label}的配置加密版本与数据库字段不一致`, `${label} configuration-encryption version does not match its database fields`));
  } else if (secrets.encrypted) {
    throw new Error(migrationText(`${label}未启用配置加密，但数据库包含加密敏感字段`, `${label} does not have configuration encryption enabled, but its database contains encrypted sensitive fields`));
  }
  return secrets;
}

function assertSecretCompatibility(sourceDb, targetDb, sourceDataDir, targetDataDir, descriptors = {}) {
  const sourceSecurity = descriptors.source || securityDescriptor(sourceDataDir);
  const targetSecurity = descriptors.target || securityDescriptor(targetDataDir);
  const sourceSecrets = assertDatabaseMatchesSecurityDescriptor(sourceDb, sourceSecurity, migrationText("旧版数据", "Legacy data"));
  const targetSecrets = targetDb
    ? assertDatabaseMatchesSecurityDescriptor(targetDb, targetSecurity, migrationText("当前 Terma 数据", "Current Terma data"))
    : { encrypted:0, v1:0, v2:0, v3:0, plain:0 };
  const sourceEncrypted = sourceSecrets.encrypted;
  const sourcePlain = sourceSecrets.plain;
  if (targetDb && targetSecurity.enabled && targetSecrets.plain) {
    throw new Error(migrationText(
      "当前 Terma 的数据库包含未加密敏感字段，不能继续品牌迁移；请先解锁并重新启用配置加密完成修复",
      "The current Terma database contains unencrypted sensitive fields, so brand migration cannot continue. Unlock it and re-enable configuration encryption to repair the data first."
    ));
  }
  if (targetDb && !targetSecurity.enabled && targetSecrets.encrypted) {
    throw new Error(migrationText(
      "当前 Terma 未启用配置加密，但数据库包含加密字段，不能继续品牌迁移",
      "Configuration encryption is disabled in the current Terma data, but its database contains encrypted fields, so brand migration cannot continue."
    ));
  }
  if (sourceEncrypted && targetDb) {
    const sameKey = sourceSecurity.enabled && targetSecurity.enabled
      && sourceSecurity.version === targetSecurity.version
      && sourceSecurity.salt === targetSecurity.salt
      && sourceSecurity.check === targetSecurity.check;
    if (!sameKey) throw new Error(migrationText(
      "旧版数据库中的凭据使用另一套配置加密，不能直接合并；请先在旧版解锁后导出迁移包",
      "Credentials in the legacy database use a different configuration-encryption key and cannot be merged directly. Unlock the legacy app and export a migration package first."
    ));
  }
  if (targetDb && targetSecurity.enabled && sourcePlain) {
    throw new Error(migrationText(
      "当前 Terma 已启用配置加密，不能把旧版明文凭据直接写入；请先使用加密迁移包",
      "Configuration encryption is enabled in current Terma data, so legacy plaintext credentials cannot be written directly. Use an encrypted migration package first."
    ));
  }
}

function remapNumber(value, map) {
  const number = Number(value);
  if (!Number.isFinite(number) || !map.has(number)) return value;
  return map.get(number);
}

function rewriteNestedIds(value, maps) {
  if (Array.isArray(value)) return value.map(item => rewriteNestedIds(item, maps));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLocaleLowerCase();
    let next = rewriteNestedIds(item, maps);
    if (typeof item === "number" || /^\d+$/.test(String(item || ""))) {
      if (lower === "connection_id" || lower === "connectionid" || lower === "source_ssh_connection_id" || lower === "ssh_connection_id") next = remapNumber(item, maps.connections);
      else if (lower === "remote_profile_id" || lower === "profile_id" || lower === "remoteprofileid") next = remapNumber(item, maps.remoteProfiles);
      else if (lower === "forward_id" || lower === "forwardid") next = remapNumber(item, maps.forwards);
    }
    output[key] = next;
  }
  return output;
}

function rewriteRemoteOptions(value, maps) {
  return JSON.stringify(rewriteNestedIds(parseObject(value), maps));
}

function sourceIdentityPath(value, sourceSshDir, identityMap) {
  const text = String(value || "");
  if (!text) return text;
  const resolved = path.resolve(text);
  if (identityMap.has(normalizedPath(resolved))) return identityMap.get(normalizedPath(resolved));
  if (isWithin(resolved, sourceSshDir)) {
    const relative = path.relative(sourceSshDir, resolved);
    const mapped = identityMap.get(normalizedPath(resolved));
    return mapped || path.join(path.resolve(sourceSshDir), relative);
  }
  return text;
}

function insertRow(db, table, sourceRow, options = {}) {
  const columns = tableColumns(db, table);
  const omit = new Set(options.omit || ["id"]);
  const selected = columns.filter(column => !omit.has(column) && Object.prototype.hasOwnProperty.call(sourceRow, column));
  if (!selected.length) return 0;
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${selected.map(quoteIdentifier).join(",")}) VALUES (${selected.map(() => "?").join(",")})`;
  const result = db.prepare(sql).run(...selected.map(column => sourceRow[column]));
  return Number(result.lastInsertRowid || 0);
}

function updateRow(db, table, id, fields) {
  const columns = tableColumns(db, table).filter(column => Object.prototype.hasOwnProperty.call(fields, column));
  if (!columns.length) return;
  db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${columns.map(column => `${quoteIdentifier(column)}=?`).join(",")} WHERE id=?`).run(...columns.map(column => fields[column]), id);
}

function mergeConnectionGroups(targetDb, sourceDb, summary) {
  const targetRows = tableRows(targetDb, "connection_groups");
  const index = new Map(targetRows.map(row => [normalized(row.name), row.name]));
  const map = new Map();
  for (const row of tableRows(sourceDb, "connection_groups")) {
    const key = normalized(row.name);
    if (index.has(key)) map.set(String(row.name), index.get(key));
    else {
      const inserted = insertRow(targetDb, "connection_groups", row, { omit: [] });
      if (!inserted && !tableExists(targetDb, "connection_groups")) throw new Error(migrationText("目标数据库缺少 connection_groups 表", "The target database is missing the connection_groups table"));
      index.set(key, row.name);
      map.set(String(row.name), row.name);
      summary.inserted.connection_groups += 1;
    }
  }
  return map;
}

function connectionKey(row) {
  return [normalized(row.name), normalized(row.ssh_host), Number(row.ssh_port || 22), normalized(row.ssh_user)].join("\u0001");
}

function connectionEndpointKey(row) {
  return [normalized(row.ssh_host), Number(row.ssh_port || 22), normalized(row.ssh_user)].join("\u0001");
}

function mergeConnections(targetDb, sourceDb, groupMap, identityMapper, summary) {
  const targetRows = tableRows(targetDb, "connections");
  const index = new Map();
  for (const row of targetRows) if (!index.has(connectionKey(row))) index.set(connectionKey(row), row);
  const existingNames = new Set(targetRows.map(row => normalized(row.name)));
  const map = new Map();
  const pendingJump = [];
  for (const row of tableRows(sourceDb, "connections")) {
    const key = connectionKey(row);
    const existing = index.get(key) || targetRows.find(targetRow => (
      connectionEndpointKey(targetRow) === connectionEndpointKey(row)
      && isLegacyCopyName(targetRow.name, row.name)
    ));
    if (existing) {
      map.set(Number(row.id), Number(existing.id));
      const fields = {};
      if (!String(existing.identity_file || "").trim() && String(row.identity_file || "").trim()) fields.identity_file = identityMapper(row.identity_file);
      if (!String(existing.ssh_password || "").trim() && String(row.ssh_password || "").trim()) fields.ssh_password = row.ssh_password;
      if (!String(existing.private_key_passphrase || "").trim() && String(row.private_key_passphrase || "").trim()) fields.private_key_passphrase = row.private_key_passphrase;
      if (fields.identity_file && !String(existing.auth_type || "").trim()) fields.auth_type = row.auth_type;
      if (Object.keys(fields).length) updateRow(targetDb, "connections", existing.id, fields);
      if (existing.jump_connection_id == null && row.jump_connection_id != null) pendingJump.push([Number(existing.id), Number(row.jump_connection_id)]);
      summary.matched.connections += 1;
      continue;
    }
    const copy = { ...row };
    delete copy.id;
    if (existingNames.has(normalized(copy.name))) copy.name = legacyCopyName(copy.name, existingNames);
    else existingNames.add(normalized(copy.name));
    copy.group_name = groupMap.get(String(row.group_name)) || row.group_name;
    copy.identity_file = identityMapper(row.identity_file);
    copy.jump_connection_id = null;
    // Runtime state never crosses an application restart.
    const insertedId = insertRow(targetDb, "connections", copy);
    if (!insertedId) throw new Error(migrationText(`无法迁移连接：${row.name || row.id}`, `Could not migrate connection: ${row.name || row.id}`));
    index.set(key, { ...copy, id: insertedId });
    map.set(Number(row.id), insertedId);
    if (row.jump_connection_id != null) pendingJump.push([insertedId, Number(row.jump_connection_id)]);
    summary.inserted.connections += 1;
  }
  for (const [targetId, sourceJumpId] of pendingJump) {
    const mapped = map.get(sourceJumpId);
    if (mapped) updateRow(targetDb, "connections", targetId, { jump_connection_id: mapped });
  }
  return map;
}

function forwardKey(row, connectionId) {
  return [connectionId, row.mode, row.bind_host, row.bind_port, row.target_host, row.target_port].map(value => String(value ?? "")).join("\u0001");
}

function mergeForwards(targetDb, sourceDb, connectionMap, summary) {
  const targetRows = tableRows(targetDb, "connection_forwards");
  const index = new Map();
  for (const row of targetRows) if (!index.has(forwardKey(row, row.connection_id))) index.set(forwardKey(row, row.connection_id), row);
  const map = new Map();
  for (const row of tableRows(sourceDb, "connection_forwards")) {
    const mappedConnectionId = connectionMap.get(Number(row.connection_id));
    if (!mappedConnectionId) throw new Error(migrationText(`转发 ${row.id} 找不到对应连接`, `Forward ${row.id} has no matching connection`));
    const key = forwardKey(row, mappedConnectionId);
    const existing = index.get(key);
    if (existing) {
      map.set(Number(row.id), Number(existing.id));
      summary.matched.connection_forwards += 1;
      continue;
    }
    const copy = { ...row };
    delete copy.id;
    copy.connection_id = mappedConnectionId;
    copy.pid = null;
    copy.status = "stopped";
    copy.reconnect_count = 0;
    copy.last_error = null;
    copy.last_error_code = null;
    copy.started_at = null;
    const insertedId = insertRow(targetDb, "connection_forwards", copy);
    if (!insertedId) throw new Error(migrationText(`无法迁移转发：${row.id}`, `Could not migrate forward: ${row.id}`));
    index.set(key, { ...copy, id: insertedId });
    map.set(Number(row.id), insertedId);
    summary.inserted.connection_forwards += 1;
  }
  return map;
}

function mergeNamedRows(targetDb, sourceDb, table, keyFunction, transform, summary, options = {}) {
  const targetRows = tableRows(targetDb, table);
  const index = new Map();
  for (const row of targetRows) if (!index.has(keyFunction(row))) index.set(keyFunction(row), row);
  const existingNames = new Set(targetRows.map(row => normalized(row.name)));
  const map = new Map();
  for (const row of tableRows(sourceDb, table)) {
    const copy = transform({ ...row });
    const key = keyFunction(copy);
    const existing = index.get(key) || (options.contentKey ? targetRows.find(targetRow => (
      isLegacyCopyName(targetRow.name, row.name)
      && options.contentKey(targetRow) === options.contentKey(copy)
    )) : null);
    if (existing) {
      if (row.id != null) map.set(Number(row.id), Number(existing.id));
      summary.matched[table] += 1;
      continue;
    }
    const sourceId = row.id;
    delete copy.id;
    if (options.preserveNameConflicts !== false && Object.prototype.hasOwnProperty.call(copy, "name")) {
      if (existingNames.has(normalized(copy.name))) copy.name = legacyCopyName(copy.name, existingNames);
      else existingNames.add(normalized(copy.name));
    }
    const insertedId = insertRow(targetDb, table, copy);
    if (!insertedId && table !== "app_meta") throw new Error(migrationText(`无法迁移 ${table}：${row.name || row.id}`, `Could not migrate ${table}: ${row.name || row.id}`));
    const actualId = insertedId || row.id;
    index.set(key, { ...copy, id: actualId });
    if (sourceId != null) map.set(Number(sourceId), Number(actualId));
    summary.inserted[table] += 1;
  }
  return map;
}

function workspaceTransform(row, maps) {
  const copy = { ...row };
  if (copy.layout_json) copy.layout_json = JSON.stringify(rewriteWorkspaceLayout(parseObject(copy.layout_json), maps));
  return copy;
}

function rewriteWorkspaceLayout(layout, maps) {
  const output = rewriteNestedIds(layout, maps);
  const profileKinds = new Set(["rdp", "vnc", "xdmcp", "ftp", "telnet", "remote"]);
  const keyMap = new Map();
  if (Array.isArray(output.tabs)) {
    output.tabs = output.tabs.map(tab => {
      if (!tab || typeof tab !== "object") return tab;
      const oldId = Number(tab.id);
      const remote = profileKinds.has(String(tab.kind || tab.viewName || "").toLocaleLowerCase());
      const map = remote ? maps.remoteProfiles : maps.connections;
      const nextId = Number.isFinite(oldId) ? remapNumber(oldId, map) : tab.id;
      const oldKey = String(tab.key || "");
      let nextKey = oldKey;
      if (Number.isFinite(oldId) && nextId !== oldId) {
        nextKey = oldKey.replace(new RegExp(`-${oldId}(?=-|$)`, "g"), `-${nextId}`);
        if (nextKey === oldKey) nextKey = oldKey.replace(String(oldId), String(nextId));
      }
      if (oldKey) keyMap.set(oldKey, nextKey);
      return { ...tab, id: nextId, key: nextKey };
    });
    const remapKey = value => keyMap.get(String(value)) || value;
    output.activeTabKey = remapKey(output.activeTabKey);
    if (output.layout && typeof output.layout === "object") {
      output.layout = { ...output.layout, activeTabKey:remapKey(output.layout.activeTabKey), tabs:Array.isArray(output.layout.tabs) ? output.layout.tabs.map(remapKey) : output.layout.tabs };
    }
  }
  if (Array.isArray(output.running_forward_ids)) output.running_forward_ids = output.running_forward_ids.map(id => remapNumber(id, maps.forwards));
  if (Array.isArray(output.connection_refs)) output.connection_refs = output.connection_refs.map(item => ({ ...item, id:remapNumber(item.id, maps.connections) }));
  if (Array.isArray(output.remote_profile_refs)) output.remote_profile_refs = output.remote_profile_refs.map(item => ({ ...item, id:remapNumber(item.id, maps.remoteProfiles) }));
  if (Array.isArray(output.forward_refs)) output.forward_refs = output.forward_refs.map(item => ({ ...item, id:remapNumber(item.id, maps.forwards), connection_id:remapNumber(item.connection_id, maps.connections) }));
  return output;
}

function assertKnownTables(sourceDb, targetDb) {
  const unsupported = databaseTables(sourceDb).filter(table => !KNOWN_TABLES.has(table) && rowCount(sourceDb, table) > 0);
  if (!unsupported.length) return;
  const targetUnsupported = unsupported.filter(table => !tableExists(targetDb, table));
  const tables = targetUnsupported.concat(unsupported.filter(table => !targetUnsupported.includes(table))).join(", ");
  throw new Error(migrationText(`旧数据包含无法安全合并的表：${tables}`, `Legacy data contains tables that cannot be merged safely: ${tables}`));
}

function mergeDatabaseFiles(sourceFile, targetFile, options = {}) {
  if (!sqliteFile(sourceFile)) throw new Error(migrationText(`旧数据库不是有效 SQLite 文件：${sourceFile}`, `The legacy database is not a valid SQLite file: ${sourceFile}`));
  if (targetFile && fs.existsSync(targetFile) && !sqliteFile(targetFile)) throw new Error(migrationText(`当前数据库不是有效 SQLite 文件：${targetFile}`, `The current database is not a valid SQLite file: ${targetFile}`));
  const summary = {
    before: {},
    source: {},
    after: {},
    inserted: Object.fromEntries([...KNOWN_TABLES].map(table => [table, 0])),
    matched: Object.fromEntries([...KNOWN_TABLES].map(table => [table, 0])),
    identity_files: { copied:0, reused:0, renamed:0 }
  };
  const sourceDb = openReadOnly(sourceFile);
  let targetDb = null;
  try {
    const sourceIntegrity = sourceDb.prepare("PRAGMA integrity_check").get();
    if (String(sourceIntegrity?.integrity_check || "").toLowerCase() !== "ok") throw new Error(migrationText("旧数据库完整性检查失败", "Legacy database integrity check failed"));
    if (sourceDb.prepare("PRAGMA foreign_key_check").all().length) throw new Error(migrationText("旧数据库存在外键错误", "The legacy database contains foreign-key errors"));
    summary.source = counts(sourceDb);
    if (targetFile && fs.existsSync(targetFile)) targetDb = new DatabaseSync(targetFile);
    else {
      cloneSqlite(sourceFile, targetFile);
      targetDb = new DatabaseSync(targetFile);
      summary.after = counts(targetDb);
      return { summary, sourceOnly:true };
    }
    targetDb.exec("PRAGMA foreign_keys=ON");
    summary.before = counts(targetDb);
    assertKnownTables(sourceDb, targetDb);
    assertSecretCompatibility(
      sourceDb,
      targetDb,
      options.sourceDataDir || path.dirname(sourceFile),
      options.targetDataDir || path.dirname(targetFile),
      { source:options.sourceSecurity, target:options.targetSecurity }
    );
    targetDb.exec("BEGIN IMMEDIATE");
    try {
      const groups = mergeConnectionGroups(targetDb, sourceDb, summary);
      const identityMapper = options.identityMapper || (value => value);
      const connections = mergeConnections(targetDb, sourceDb, groups, identityMapper, summary);
      const forwards = mergeForwards(targetDb, sourceDb, connections, summary);
      const maps = { connections, forwards, remoteProfiles:new Map() };
      const templateContentKey = row => [row.mode,row.bind_host,row.bind_port,row.target_host,row.target_port,row.service_name,row.service_type,row.url_scheme].map(value => String(value ?? "")).join("\u0001");
      mergeNamedRows(targetDb, sourceDb, "forward_templates", row => `${normalized(row.name)}\u0001${templateContentKey(row)}`, row => row, summary, { contentKey:templateContentKey });
      const snippetContentKey = row => `${normalized(row.group_name)}\u0001${String(row.command || "")}`;
      mergeNamedRows(targetDb, sourceDb, "command_snippets", row => `${normalized(row.name)}\u0001${snippetContentKey(row)}`, row => ({ ...row, group_name:groups.get(String(row.group_name)) || row.group_name }), summary, { contentKey:snippetContentKey });
      const remoteContentKey = row => [normalized(row.protocol),normalized(row.host),Number(row.port || 0),normalized(row.username)].join("\u0001");
      maps.remoteProfiles = mergeNamedRows(targetDb, sourceDb, "remote_profiles", row => `${normalized(row.name)}\u0001${remoteContentKey(row)}`, row => ({ ...row, group_name:groups.get(String(row.group_name)) || row.group_name, options_json:rewriteRemoteOptions(row.options_json, maps) }), summary, { contentKey:remoteContentKey });
      if (connections.size !== rowCount(sourceDb, "connections")) throw new Error(migrationText("旧 SSH 连接未全部建立合并映射", "Not all legacy SSH connections received merge mappings"));
      if (forwards.size !== rowCount(sourceDb, "connection_forwards")) throw new Error(migrationText("旧端口转发未全部建立合并映射", "Not all legacy port forwards received merge mappings"));
      if (maps.remoteProfiles.size !== rowCount(sourceDb, "remote_profiles")) throw new Error(migrationText("旧远程配置未全部建立合并映射", "Not all legacy remote profiles received merge mappings"));
      // Fill credential/options gaps on profiles with the target row kept as
      // the visible source of truth.
      for (const sourceRow of tableRows(sourceDb, "remote_profiles")) {
        const targetId = maps.remoteProfiles.get(Number(sourceRow.id));
        const targetRow = targetId ? targetDb.prepare("SELECT * FROM remote_profiles WHERE id=?").get(targetId) : null;
        if (!targetRow) continue;
        const fields = {};
        if (!String(targetRow.password || "").trim() && String(sourceRow.password || "").trim()) fields.password = sourceRow.password;
        const mergedOptions = { ...parseObject(rewriteRemoteOptions(sourceRow.options_json, maps)), ...parseObject(targetRow.options_json) };
        if (JSON.stringify(mergedOptions) !== String(targetRow.options_json || "{}")) fields.options_json = JSON.stringify(mergedOptions);
        if (Object.keys(fields).length) updateRow(targetDb, "remote_profiles", targetRow.id, fields);
      }
      const tunnelContentKey = row => [row.mode,normalized(row.ssh_host),Number(row.ssh_port || 22),normalized(row.ssh_user),row.bind_host,row.bind_port,row.target_host,row.target_port].map(value => String(value ?? "")).join("\u0001");
      mergeNamedRows(targetDb, sourceDb, "tunnels", row => `${normalized(row.name)}\u0001${tunnelContentKey(row)}`, row => ({ ...row, identity_file:identityMapper(row.identity_file), pid:null, status:"stopped" }), summary, { contentKey:tunnelContentKey });
      const workspaceContentKey = row => `${String(row.description || "")}\u0001${String(row.layout_json || "")}`;
      mergeNamedRows(targetDb, sourceDb, "named_workspaces", row => `${normalized(row.name)}\u0001${workspaceContentKey(row)}`, row => workspaceTransform(row, maps), summary, { contentKey:workspaceContentKey });
      for (const row of tableRows(sourceDb, "app_meta")) {
        const exists = targetDb.prepare("SELECT 1 AS found FROM app_meta WHERE key=?").get(row.key);
        if (!exists) {
          insertRow(targetDb, "app_meta", row, { omit:[] });
          summary.inserted.app_meta += 1;
        } else summary.matched.app_meta += 1;
      }
      targetDb.exec("COMMIT");
    } catch (error) {
      try { targetDb.exec("ROLLBACK"); } catch {}
      throw error;
    }
    targetDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const integrity = targetDb.prepare("PRAGMA integrity_check").get();
    if (String(integrity?.integrity_check || "").toLowerCase() !== "ok") throw new Error(migrationText("合并后的数据库完整性检查失败", "Merged database integrity check failed"));
    if (targetDb.prepare("PRAGMA foreign_key_check").all().length) throw new Error(migrationText("合并后的数据库存在外键错误", "The merged database contains foreign-key errors"));
    summary.after = counts(targetDb);
    for (const table of KNOWN_TABLES) {
      const expected = Number(summary.before[table] || 0) + Number(summary.inserted[table] || 0);
      const actual = Number(summary.after[table] || 0);
      if (actual !== expected) throw new Error(migrationText(
        `数据库表 ${table} 合并计数异常：预期 ${expected}，实际 ${actual}`,
        `Merged row count for database table ${table} is invalid: expected ${expected}, got ${actual}`
      ));
    }
    return { summary, sourceOnly:false };
  } finally {
    try { sourceDb.close(); } catch {}
    try { targetDb?.close(); } catch {}
  }
}

function mergeSshDirectories(sourceSshDir, targetSshDir, options = {}) {
  const summary = { copied:0, reused:0, renamed:0, files:[] };
  const identityMap = new Map();
  if (!fs.existsSync(sourceSshDir)) return { summary, identityMap };
  fs.mkdirSync(targetSshDir, { recursive:true });
  const files = [];
  const walk = (root, current = root) => {
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(root, full);
      else files.push({ full, relative:path.relative(root, full) });
    }
  };
  walk(sourceSshDir);
  const finalTargetDir = path.resolve(options.finalTargetDir || targetSshDir);
  for (const item of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    const original = path.join(targetSshDir, item.relative);
    let destination = original;
    if (fs.existsSync(destination)) {
      if (fileHash(destination) === fileHash(item.full)) {
        summary.reused += 1;
      } else {
        const parsed = path.parse(item.relative);
        let suffix = 0;
        do {
          suffix += 1;
          const stem = `${parsed.name}-legacy${suffix === 1 ? "" : `-${suffix}`}`;
          destination = path.join(targetSshDir, parsed.dir, `${stem}${parsed.ext}`);
        } while (fs.existsSync(destination) && fileHash(destination) !== fileHash(item.full));
        if (fs.existsSync(destination)) summary.reused += 1;
        else {
          copyFilePreservingMode(item.full, destination);
          summary.renamed += 1;
        }
      }
    } else {
      copyFilePreservingMode(item.full, destination);
      summary.copied += 1;
    }
    const relativeDestination = path.relative(targetSshDir, destination);
    const finalDestination = path.resolve(finalTargetDir, relativeDestination);
    identityMap.set(normalizedPath(item.full), finalDestination);
    summary.files.push({ source:item.full, destination:finalDestination, relative:relativeDestination, hash:fileHash(item.full) });
  }
  return { summary, identityMap };
}

function dataFileFilter(file, entry) {
  const relative = String(file).split(path.sep).at(-1) || "";
  return relative !== SECURITY_FILE && !TRANSIENT_DATA_FILES.has(relative) && !DATABASE_FILES.has(relative) && !/^tunnels\.db\.bak/i.test(relative) && !/^offline-(task|install)/i.test(relative);
}

function mergeLegacyRuntime(options = {}) {
  const sourceDataDir = path.resolve(options.sourceDataDir);
  const sourceSshDir = path.resolve(options.sourceSshDir);
  const targetDataDir = path.resolve(options.targetDataDir);
  const targetSshDir = path.resolve(options.targetSshDir);
  const sourceDb = path.join(sourceDataDir, "tunnels.db");
  const targetDb = path.join(targetDataDir, "tunnels.db");
  if (!sqliteFile(sourceDb)) throw new Error(migrationText(`未发现有效的旧版数据库：${sourceDb}`, `No valid legacy database was found: ${sourceDb}`));
  const targetExists = fs.existsSync(targetDb);
  const sourceSecurity = securityDescriptor(sourceDataDir);
  const targetSecurity = securityDescriptor(targetDataDir);
  const sourceSecurityFile = path.join(sourceDataDir, SECURITY_FILE);
  const targetSecurityFile = path.join(targetDataDir, SECURITY_FILE);
  const runtimeRoot = path.dirname(targetDataDir);
  if (path.dirname(targetSshDir) !== runtimeRoot) throw new Error(migrationText("数据目录和密钥目录必须属于同一个运行目录", "The data and key directories must belong to the same runtime directory"));
  fs.mkdirSync(runtimeRoot, { recursive:true });
  const staging = path.join(runtimeRoot, `.terma-brand-migration-staging-${process.pid}-${Date.now()}`);
  const swap = path.join(runtimeRoot, `.terma-brand-migration-swap-${process.pid}-${Date.now()}`);
  let backupRoot = "";
  const createdTargetEntries = [];
  const movedDatabaseFiles = [];
  let promotedDatabase = false;
  let securityPromotion = null;
  try {
    fs.mkdirSync(staging, { recursive:true });
    const stageData = path.join(staging, "data");
    const stageSsh = path.join(staging, ".ssh");
    if (fs.existsSync(targetDataDir)) copyDirectory(targetDataDir, stageData, dataFileFilter);
    if (fs.existsSync(targetSshDir)) copyDirectory(targetSshDir, stageSsh);
    copyMissingDirectory(sourceDataDir, stageData, dataFileFilter);
    const stagedDb = path.join(stageData, "tunnels.db");
    let mergeResult;
    if (targetExists) {
      if (!sqliteFile(targetDb)) throw new Error(migrationText(`当前数据库不是有效 SQLite 文件：${targetDb}`, `The current database is not a valid SQLite file: ${targetDb}`));
      cloneSqlite(targetDb, stagedDb);
      const sshMerge = mergeSshDirectories(sourceSshDir, stageSsh, { finalTargetDir:targetSshDir });
      const identityMapper = value => sourceIdentityPath(value, sourceSshDir, sshMerge.identityMap);
      mergeResult = mergeDatabaseFiles(sourceDb, stagedDb, {
        identityMapper,
        sourceSecurity,
        targetSecurity
      });
      mergeResult.ssh = sshMerge.summary;
    } else {
      const sourceValidationDb = openReadOnly(sourceDb);
      try {
        assertDatabaseMatchesSecurityDescriptor(sourceValidationDb, sourceSecurity, migrationText("旧版数据", "Legacy data"));
      } finally {
        sourceValidationDb.close();
      }
      cloneSqlite(sourceDb, stagedDb);
      const sshMerge = mergeSshDirectories(sourceSshDir, stageSsh, { finalTargetDir:targetSshDir });
      const identityMapper = value => sourceIdentityPath(value, sourceSshDir, sshMerge.identityMap);
      // The source-only clone has all rows already; rewrite paths and validate
      // it through the same SQLite integrity checks used by the merge path.
      const db = new DatabaseSync(stagedDb);
      db.exec("PRAGMA foreign_keys=ON");
      for (const row of tableRows(db, "connections")) {
        if (row.identity_file) updateRow(db, "connections", row.id, { identity_file:identityMapper(row.identity_file) });
      }
      for (const row of tableRows(db, "connection_forwards")) {
        updateRow(db, "connection_forwards", row.id, { pid:null, status:"stopped", reconnect_count:0, last_error:null, last_error_code:null, started_at:null });
      }
      for (const row of tableRows(db, "tunnels")) {
        if (row.identity_file) updateRow(db, "tunnels", row.id, { identity_file:identityMapper(row.identity_file), pid:null, status:"stopped" });
      }
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const integrity = db.prepare("PRAGMA integrity_check").get();
      if (String(integrity?.integrity_check || "").toLowerCase() !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error(migrationText("旧数据库完整性检查失败", "Legacy database integrity check failed"));
      const sourceReadOnly = openReadOnly(sourceDb);
      const sourceCounts = counts(sourceReadOnly);
      sourceReadOnly.close();
      const afterCounts = counts(db);
      db.close();
      mergeResult = { summary:{ before:{}, source:sourceCounts, after:afterCounts, inserted:sourceCounts, matched:{}, identity_files:sshMerge.summary }, sourceOnly:true, ssh:sshMerge.summary };
    }
    // Keep the active data and .ssh directories in place. Source launches keep
    // web.log open inside data/, and Windows refuses to rename that directory.
    // Only the closed SQLite files need an atomic swap; every other file is
    // merged as a missing entry after the staged database is promoted.
    const hasTarget = fs.existsSync(targetDataDir) || fs.existsSync(targetSshDir);
    if (hasTarget) {
      backupRoot = options.backupParent
        ? path.join(path.resolve(options.backupParent), `.terma-brand-migration-backup-${Date.now()}`)
        : path.join(runtimeRoot, `.terma-brand-migration-backup-${Date.now()}`);
      fs.mkdirSync(backupRoot, { recursive:true });
      if (fs.existsSync(targetDataDir)) copyDirectory(targetDataDir, path.join(backupRoot, "data"));
      if (fs.existsSync(targetSshDir)) copyDirectory(targetSshDir, path.join(backupRoot, ".ssh"));
      fs.writeFileSync(path.join(backupRoot, "manifest.json"), JSON.stringify({ sourceDataDir, targetDataDir, targetSshDir, created_at:new Date().toISOString() }, null, 2), "utf8");
    }
    fs.mkdirSync(targetDataDir, { recursive:true });
    fs.mkdirSync(targetSshDir, { recursive:true });
    fs.mkdirSync(path.join(swap, "data"), { recursive:true });
    for (const name of DATABASE_FILES) {
      const current = path.join(targetDataDir, name);
      if (!fs.existsSync(current)) continue;
      const previous = path.join(swap, "data", name);
      fs.renameSync(current, previous);
      movedDatabaseFiles.push({ current, previous });
    }
    fs.renameSync(stagedDb, targetDb);
    promotedDatabase = true;
    copyMissingDirectory(stageData, targetDataDir, dataFileFilter, createdTargetEntries);
    if (fs.existsSync(stageSsh)) copyMissingDirectory(stageSsh, targetSshDir, () => true, createdTargetEntries);
    for (const file of mergeResult.ssh?.files || []) {
      if (!fs.existsSync(file.destination) || fileHash(file.destination) !== file.hash) throw new Error(migrationText(
        `迁移后的密钥校验失败：${path.basename(file.destination)}`,
        `Migrated key verification failed: ${path.basename(file.destination)}`
      ));
    }
    if (!targetExists) {
      securityPromotion = fs.existsSync(targetSecurityFile)
        ? { existed:true, content:fs.readFileSync(targetSecurityFile), mode:fs.statSync(targetSecurityFile).mode & 0o777 }
        : { existed:false, content:null, mode:0o600 };
      if (fs.existsSync(sourceSecurityFile)) copyFilePreservingMode(sourceSecurityFile, targetSecurityFile);
      else if (fs.existsSync(targetSecurityFile)) fs.rmSync(targetSecurityFile, {force:true});
    }
    const cleanupPending = [];
    if (!removeDirectoryBestEffort(swap)) cleanupPending.push(swap);
    if (!removeDirectoryBestEffort(staging)) cleanupPending.push(staging);
    return { backupRoot, cleanupPending, ...mergeResult };
  } catch (error) {
    try { fs.rmSync(staging, { recursive:true, force:true }); } catch {}
    // Roll back only entries touched by promotion.  The active runtime
    // directories can contain open log files, so removing or renaming the
    // whole directory is unsafe on Windows and can destroy unrelated files.
    try {
      if (securityPromotion) {
        if (securityPromotion.existed) {
          fs.writeFileSync(targetSecurityFile, securityPromotion.content, {mode:securityPromotion.mode});
          try { fs.chmodSync(targetSecurityFile, securityPromotion.mode); } catch {}
        } else fs.rmSync(targetSecurityFile, {force:true});
      }
      if (promotedDatabase) fs.rmSync(targetDb, { force:true });
      for (const item of movedDatabaseFiles.slice().reverse()) {
        if (!fs.existsSync(item.previous)) continue;
        if (fs.existsSync(item.current)) fs.rmSync(item.current, { force:true });
        fs.renameSync(item.previous, item.current);
      }
      for (const entry of createdTargetEntries.slice().reverse()) {
        try {
          if (fs.existsSync(entry)) fs.rmSync(entry, { recursive:true, force:true });
        } catch {}
      }
    } catch {}
    try { fs.rmSync(swap, { recursive:true, force:true }); } catch {}
    if (backupRoot) error.migrationBackup = backupRoot;
    throw error;
  }
}

function copyLegacyProfileMissing(sourceRoot, targetRoot) {
  const excluded = new Set(["runtime", "Cache", "Code Cache", "DawnCache", "GPUCache", "GrShaderCache", "ShaderCache", "Crashpad", "blob_storage", "Dictionaries", "updates"]);
  const created = [];
  if (!fs.existsSync(sourceRoot)) return created;
  fs.mkdirSync(targetRoot, { recursive:true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes:true })) {
    if (excluded.has(entry.name) || entry.name === "desktop-settings.json" || /^Singleton|^LOCK$/i.test(entry.name)) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (fs.existsSync(target)) continue;
    if (entry.isDirectory()) copyDirectory(source, target);
    else copyFilePreservingMode(source, target);
    created.push(target);
  }
  return created;
}

module.exports = {
  counts,
  fileHash,
  mergeDatabaseFiles,
  mergeLegacyRuntime,
  mergeSshDirectories,
  copyLegacyProfileMissing,
  removeCreatedFiles,
  sqliteFile
};
