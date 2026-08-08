const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DATA_DIR, LOG_DIR, DB_PATH } = require("./config");
const { decryptText, encryptText } = require("./crypto-store");
const { allowedIdentityPath, assertAllowedIdentityPath } = require("./identity-path");
const { assertSafeExtraArgs } = require("./ssh-command");
const { validateSshHost, validateSshUser } = require("./ssh-connection");
const { ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");

ensurePrivateDirectory(DATA_DIR);
ensurePrivateDirectory(LOG_DIR);
for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) ensurePrivateFile(file);

let db: any = null;

function openDatabase() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  ensurePrivateFile(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) ensurePrivateFile(file);

  db.exec(`
CREATE TABLE IF NOT EXISTS tunnels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL,
  identity_file TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  forwards TEXT,
  extra_args TEXT,
  autostart INTEGER NOT NULL DEFAULT 0,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'key',
  identity_file TEXT,
  ssh_password TEXT,
  private_key_passphrase TEXT,
  ssh_agent_mode TEXT NOT NULL DEFAULT 'auto',
  jump_connection_id INTEGER,
  connect_timeout_seconds INTEGER NOT NULL DEFAULT 10,
  keepalive_interval_seconds INTEGER NOT NULL DEFAULT 60,
  keepalive_count_max INTEGER NOT NULL DEFAULT 3,
  tcp_keepalive INTEGER NOT NULL DEFAULT 1,
  x11_mode TEXT NOT NULL DEFAULT 'off',
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  notifications_muted INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  extra_args TEXT,
  autostart_forwards INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 1,
  terminal_encoding TEXT NOT NULL DEFAULT 'utf8',
  terminal_font_family TEXT NOT NULL DEFAULT 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  terminal_font_size INTEGER NOT NULL DEFAULT 13,
  terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13,
  terminal_line_height REAL NOT NULL DEFAULT 1,
  terminal_font_weight TEXT NOT NULL DEFAULT 'normal',
  terminal_startup_mode TEXT NOT NULL DEFAULT 'default',
  terminal_profile_name TEXT NOT NULL DEFAULT '',
  terminal_profile_kind TEXT NOT NULL DEFAULT 'shell',
  terminal_program_path TEXT NOT NULL DEFAULT '',
  terminal_program_args TEXT NOT NULL DEFAULT '',
  terminal_working_directory TEXT NOT NULL DEFAULT '',
  terminal_program_platform TEXT NOT NULL DEFAULT 'auto',
  sftp_text_encoding TEXT NOT NULL DEFAULT 'auto',
  sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  tags TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connection_groups (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connection_forwards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  service_name TEXT,
  service_type TEXT,
  service_note TEXT,
  url_scheme TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  restore INTEGER NOT NULL DEFAULT 0,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS forward_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  service_name TEXT,
  service_type TEXT,
  service_note TEXT,
  url_scheme TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS command_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS named_workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  layout_json TEXT NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
  `);

  const remoteProfileSchema = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='remote_profiles'");
  if (/CHECK\s*\(\s*protocol\s+IN/i.test(String(remoteProfileSchema?.sql || ""))) {
    db.exec(`
BEGIN IMMEDIATE;
ALTER TABLE remote_profiles RENAME TO remote_profiles_legacy_protocol_check;
CREATE TABLE remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  tags TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at)
SELECT id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at
FROM remote_profiles_legacy_protocol_check;
DROP TABLE remote_profiles_legacy_protocol_check;
COMMIT;
    `);
  }

  const connectionColumns = new Set(all("PRAGMA table_info(connections)").map((row) => row.name));
  if (!connectionColumns.has("autostart_forwards")) {
    run("ALTER TABLE connections ADD COLUMN autostart_forwards INTEGER NOT NULL DEFAULT 0");
  }
  if (!connectionColumns.has("tags")) run("ALTER TABLE connections ADD COLUMN tags TEXT");
  if (!connectionColumns.has("auth_type")) run("ALTER TABLE connections ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'key'");
  if (!connectionColumns.has("ssh_password")) run("ALTER TABLE connections ADD COLUMN ssh_password TEXT");
  if (!connectionColumns.has("private_key_passphrase")) run("ALTER TABLE connections ADD COLUMN private_key_passphrase TEXT");
  if (!connectionColumns.has("ssh_agent_mode")) run("ALTER TABLE connections ADD COLUMN ssh_agent_mode TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("jump_connection_id")) run("ALTER TABLE connections ADD COLUMN jump_connection_id INTEGER");
  if (!connectionColumns.has("connect_timeout_seconds")) run("ALTER TABLE connections ADD COLUMN connect_timeout_seconds INTEGER NOT NULL DEFAULT 10");
  if (!connectionColumns.has("keepalive_interval_seconds")) run("ALTER TABLE connections ADD COLUMN keepalive_interval_seconds INTEGER NOT NULL DEFAULT 60");
  if (!connectionColumns.has("keepalive_count_max")) run("ALTER TABLE connections ADD COLUMN keepalive_count_max INTEGER NOT NULL DEFAULT 3");
  if (!connectionColumns.has("tcp_keepalive")) run("ALTER TABLE connections ADD COLUMN tcp_keepalive INTEGER NOT NULL DEFAULT 1");
  if (!connectionColumns.has("x11_mode")) run("ALTER TABLE connections ADD COLUMN x11_mode TEXT NOT NULL DEFAULT 'off'");
  if (!connectionColumns.has("favorite")) run("ALTER TABLE connections ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  if (!connectionColumns.has("last_used_at")) run("ALTER TABLE connections ADD COLUMN last_used_at INTEGER");
  if (!connectionColumns.has("notifications_muted")) run("ALTER TABLE connections ADD COLUMN notifications_muted INTEGER NOT NULL DEFAULT 0");
  if (!connectionColumns.has("sort_order")) {
    run("ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1");
  }
  if (!connectionColumns.has("terminal_encoding")) run("ALTER TABLE connections ADD COLUMN terminal_encoding TEXT NOT NULL DEFAULT 'utf8'");
  if (!connectionColumns.has("terminal_font_family")) run("ALTER TABLE connections ADD COLUMN terminal_font_family TEXT NOT NULL DEFAULT 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'");
  if (!connectionColumns.has("terminal_font_size")) run("ALTER TABLE connections ADD COLUMN terminal_font_size INTEGER NOT NULL DEFAULT 13");
  if (!connectionColumns.has("terminal_mobile_font_size")) run("ALTER TABLE connections ADD COLUMN terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13");
  if (!connectionColumns.has("terminal_line_height")) run("ALTER TABLE connections ADD COLUMN terminal_line_height REAL NOT NULL DEFAULT 1");
  if (!connectionColumns.has("terminal_font_weight")) run("ALTER TABLE connections ADD COLUMN terminal_font_weight TEXT NOT NULL DEFAULT 'normal'");
  if (!connectionColumns.has("terminal_startup_mode")) run("ALTER TABLE connections ADD COLUMN terminal_startup_mode TEXT NOT NULL DEFAULT 'default'");
  if (!connectionColumns.has("terminal_profile_name")) run("ALTER TABLE connections ADD COLUMN terminal_profile_name TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_profile_kind")) run("ALTER TABLE connections ADD COLUMN terminal_profile_kind TEXT NOT NULL DEFAULT 'shell'");
  if (!connectionColumns.has("terminal_program_path")) run("ALTER TABLE connections ADD COLUMN terminal_program_path TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_program_args")) run("ALTER TABLE connections ADD COLUMN terminal_program_args TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_working_directory")) run("ALTER TABLE connections ADD COLUMN terminal_working_directory TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_program_platform")) run("ALTER TABLE connections ADD COLUMN terminal_program_platform TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("sftp_text_encoding")) run("ALTER TABLE connections ADD COLUMN sftp_text_encoding TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("sftp_filename_encoding")) run("ALTER TABLE connections ADD COLUMN sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8'");
  const existingGroups = all("SELECT DISTINCT group_name FROM connections ORDER BY group_name COLLATE NOCASE");
  existingGroups.forEach((row, index) => run(
    "INSERT OR IGNORE INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)",
    [row.group_name, index + 1, now(), now()]
  ));
  run("UPDATE connection_forwards SET status='stopped' WHERE pid IS NULL AND status='running'");
  const forwardColumns = new Set(all("PRAGMA table_info(connection_forwards)").map((row) => row.name));
  if (!forwardColumns.has("service_name")) run("ALTER TABLE connection_forwards ADD COLUMN service_name TEXT");
  if (!forwardColumns.has("service_type")) run("ALTER TABLE connection_forwards ADD COLUMN service_type TEXT");
  if (!forwardColumns.has("service_note")) run("ALTER TABLE connection_forwards ADD COLUMN service_note TEXT");
  if (!forwardColumns.has("restore")) run("ALTER TABLE connection_forwards ADD COLUMN restore INTEGER NOT NULL DEFAULT 0");
  if (!forwardColumns.has("reconnect_count")) run("ALTER TABLE connection_forwards ADD COLUMN reconnect_count INTEGER NOT NULL DEFAULT 0");
  if (!forwardColumns.has("last_error")) run("ALTER TABLE connection_forwards ADD COLUMN last_error TEXT");
  if (!forwardColumns.has("started_at")) run("ALTER TABLE connection_forwards ADD COLUMN started_at INTEGER");
  if (!forwardColumns.has("url_scheme")) run("ALTER TABLE connection_forwards ADD COLUMN url_scheme TEXT");
  run("CREATE INDEX IF NOT EXISTS idx_connection_forwards_connection_id ON connection_forwards(connection_id,id)");
  run("CREATE INDEX IF NOT EXISTS idx_connections_group_sort ON connections(group_name,sort_order,created_at,id)");
  run("CREATE INDEX IF NOT EXISTS idx_connection_groups_sort ON connection_groups(sort_order,name)");
  run("CREATE INDEX IF NOT EXISTS idx_connections_recent ON connections(favorite,last_used_at)");
  run("CREATE INDEX IF NOT EXISTS idx_remote_profiles_group_sort ON remote_profiles(group_name,name,id)");
  run("CREATE INDEX IF NOT EXISTS idx_remote_profiles_recent ON remote_profiles(favorite,last_used_at)");
  run("CREATE INDEX IF NOT EXISTS idx_command_snippets_sort ON command_snippets(favorite,last_used_at,updated_at)");
  run("CREATE INDEX IF NOT EXISTS idx_named_workspaces_recent ON named_workspaces(last_used_at,updated_at)");
  return db;
}

openDatabase();

function now() {
  return Math.floor(Date.now() / 1000);
}

function run(sql, params = {}) {
  const stmt = db.prepare(sql);
  return Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
}

function get(sql, params = {}) {
  const stmt = db.prepare(sql);
  return Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
}

function all(sql, params = {}) {
  const stmt = db.prepare(sql);
  return Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
}

function validatePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} 必须在 1-65535 之间`);
  }
  return port;
}

function validateSortOrder(value) {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1 || order > 2147483647) {
    throw new Error("排序值必须是 1-2147483647 之间的整数");
  }
  return order;
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} 必须在 ${minimum}-${maximum} 之间`);
  }
  return number;
}

const TERMINAL_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);
const SFTP_TEXT_ENCODINGS = new Set(["auto", "utf8", "utf8bom", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);
const SFTP_FILENAME_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);
const TERMINAL_FONT_WEIGHTS = new Set(["normal", "500", "600", "bold"]);
const TERMINAL_STARTUP_MODES = new Set(["default", "program"]);
const TERMINAL_PROFILE_KINDS = new Set(["shell", "repl", "session", "tool", "custom"]);
const TERMINAL_PROGRAM_PLATFORMS = new Set(["auto", "posix", "windows"]);
const DEFAULT_TERMINAL_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function cleanTerminalPreferences(data, existing = null) {
  const terminalEncoding = String(data.terminal_encoding ?? existing?.terminal_encoding ?? "utf8").toLowerCase();
  if (!TERMINAL_ENCODINGS.has(terminalEncoding)) throw new Error("不支持的终端编码");
  const terminalFontFamily = String(data.terminal_font_family ?? existing?.terminal_font_family ?? DEFAULT_TERMINAL_FONT).trim();
  if (!terminalFontFamily || terminalFontFamily.length > 300) throw new Error("终端字体设置长度必须在 1-300 个字符之间");
  const terminalFontSize = Number(data.terminal_font_size ?? existing?.terminal_font_size ?? 13);
  if (!Number.isInteger(terminalFontSize) || terminalFontSize < 10 || terminalFontSize > 32) throw new Error("终端字号必须是 10-32 之间的整数");
  const terminalMobileFontSize = Number(data.terminal_mobile_font_size ?? existing?.terminal_mobile_font_size ?? 13);
  if (!Number.isInteger(terminalMobileFontSize) || terminalMobileFontSize < 10 || terminalMobileFontSize > 32) throw new Error("移动端终端字号必须是 10-32 之间的整数");
  const terminalLineHeight = Number(data.terminal_line_height ?? existing?.terminal_line_height ?? 1);
  if (!Number.isFinite(terminalLineHeight) || terminalLineHeight < 1 || terminalLineHeight > 2) throw new Error("终端行距必须在 1.0-2.0 之间");
  const terminalFontWeight = String(data.terminal_font_weight ?? existing?.terminal_font_weight ?? "normal").toLowerCase();
  if (!TERMINAL_FONT_WEIGHTS.has(terminalFontWeight)) throw new Error("不支持的终端字重");
  return {
    terminal_encoding: terminalEncoding,
    terminal_font_family: terminalFontFamily,
    terminal_font_size: terminalFontSize,
    terminal_mobile_font_size: terminalMobileFontSize,
    terminal_line_height: Math.round(terminalLineHeight * 10) / 10,
    terminal_font_weight: terminalFontWeight
  };
}

function cleanTerminalStartup(data: any = {}, existing: any = null) {
  const mode = String(data.terminal_startup_mode ?? existing?.terminal_startup_mode ?? "default").trim().toLowerCase();
  if (!TERMINAL_STARTUP_MODES.has(mode)) throw new Error("终端启动方式只能是 default 或 program");
  if (mode === "default") {
    return {
      terminal_startup_mode: "default",
      terminal_profile_name: "",
      terminal_profile_kind: "shell",
      terminal_program_path: "",
      terminal_program_args: "",
      terminal_working_directory: "",
      terminal_program_platform: "auto"
    };
  }

  const readValue = (key, fallback = "") => {
    if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
    const value = existing?.[key] ?? fallback;
    return ["terminal_program_path", "terminal_program_args", "terminal_working_directory"].includes(key)
      ? decryptText(value)
      : value;
  };
  const singleLine = (key, label, maximum, fallback = "") => {
    const value = String(readValue(key, fallback) ?? "").trim();
    if (value.includes("\0") || /[\r\n]/.test(value)) throw new Error(`${label}不能包含换行或空字符`);
    if (value.length > maximum) throw new Error(`${label}长度不能超过 ${maximum} 个字符`);
    return value;
  };
  const profileName = singleLine("terminal_profile_name", "终端配置名称", 120);
  const profileKind = String(readValue("terminal_profile_kind", "custom") || "custom").trim().toLowerCase();
  if (!TERMINAL_PROFILE_KINDS.has(profileKind)) throw new Error("不支持的终端配置类型");
  const programPath = singleLine("terminal_program_path", "终端启动程序路径", 2048);
  if (!programPath) throw new Error("自定义终端启动方式需要填写程序路径");
  const programArgs = singleLine("terminal_program_args", "终端启动参数", 4096);
  const workingDirectory = singleLine("terminal_working_directory", "终端启动目录", 2048);
  const platform = String(readValue("terminal_program_platform", "auto") || "auto").trim().toLowerCase();
  if (!TERMINAL_PROGRAM_PLATFORMS.has(platform)) throw new Error("不支持的终端启动平台");
  return {
    terminal_startup_mode: mode,
    terminal_profile_name: profileName,
    terminal_profile_kind: profileKind,
    terminal_program_path: programPath,
    terminal_program_args: programArgs,
    terminal_working_directory: workingDirectory,
    terminal_program_platform: platform
  };
}

function cleanSftpTextEncoding(value, fallback = "auto") {
  const encoding = String(value ?? fallback ?? "auto").toLowerCase();
  if (!SFTP_TEXT_ENCODINGS.has(encoding)) throw new Error("不支持的 SFTP 文本编码");
  return encoding;
}

function cleanSftpFilenameEncoding(value, fallback = "utf8") {
  const encoding = String(value ?? fallback ?? "utf8").toLowerCase();
  if (!SFTP_FILENAME_ENCODINGS.has(encoding)) throw new Error("不支持的 SFTP 文件名编码");
  return encoding;
}

function ensureConnectionGroup(name) {
  const groupName = String(name || "").trim();
  if (!groupName) return;
  const next = Number(get("SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM connection_groups")?.value || 1);
  run("INSERT OR IGNORE INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [groupName, next, now(), now()]);
}

function pidRunning(pid) {
  if (typeof pid === "boolean" || Array.isArray(pid)) return false;
  const id = Number(pid);
  if (!Number.isSafeInteger(id) || id <= 1) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function cleanConnection(data, defaultExtraArgs, existing = null) {
  for (const key of ["name", "ssh_host", "ssh_user"]) {
    if (!data[key]) throw new Error(`缺少字段: ${key}`);
  }
  const authType = String(data.auth_type || existing?.auth_type || "key") === "password" ? "password" : "key";
  if (authType === "key" && data.identity_file) {
    data.identity_file = assertAllowedIdentityPath(String(data.identity_file));
  }
  if (authType === "key" && data.identity_file && !fs.existsSync(data.identity_file)) {
    throw new Error("私钥路径不存在");
  }
  const terminalStartup = cleanTerminalStartup(data, existing);
  const submittedPassword = String(data.ssh_password || "");
  const password = authType === "password"
    ? (submittedPassword || (existing?.ssh_password ? decryptText(existing.ssh_password) : ""))
    : "";
  if (authType === "password" && !password) throw new Error("密码登录需要填写 SSH 密码");
  const extraArgs = String(data.extra_args || defaultExtraArgs).trim();
  assertSafeExtraArgs(extraArgs);
  const submittedPassphrase = String(data.private_key_passphrase || "");
  const keepExistingPassphrase = !data.clear_private_key_passphrase && existing?.private_key_passphrase;
  const privateKeyPassphrase = authType === "key"
    ? (submittedPassphrase || (keepExistingPassphrase ? decryptText(existing.private_key_passphrase) : ""))
    : "";
  const agentMode = new Set(["auto", "off", "required"]).has(String(data.ssh_agent_mode || existing?.ssh_agent_mode || "auto"))
    ? String(data.ssh_agent_mode || existing?.ssh_agent_mode || "auto")
    : "auto";
  const x11Mode = String(data.x11_mode ?? existing?.x11_mode ?? "off").trim().toLowerCase();
  if (!["off", "untrusted", "trusted"].includes(x11Mode)) throw new Error("X11 转发模式无效");
  const jumpConnectionId = Number(data.jump_connection_id || 0) || null;
  if (jumpConnectionId) {
    const jump = get("SELECT id,jump_connection_id FROM connections WHERE id=?", [jumpConnectionId]);
    if (!jump) throw new Error("选择的跳板连接不存在");
    if (Number(existing?.id || data.id || 0) === jumpConnectionId) throw new Error("连接不能把自己设为跳板");
    if (jump.jump_connection_id) throw new Error("当前仅支持单级跳板，请选择不依赖其他跳板的连接");
  }
  const sshHost = validateSshHost(data.ssh_host);
  const sshUser = validateSshUser(data.ssh_user);
  return {
    name: String(data.name).trim(),
    group_name: String(data.group_name || "默认分组").trim() || "默认分组",
    ssh_host: sshHost,
    ssh_port: validatePort(data.ssh_port || 22, "SSH 端口"),
    ssh_user: sshUser,
    auth_type: authType,
    identity_file: authType === "key" && data.identity_file ? encryptText(String(data.identity_file).trim()) : null,
    ssh_password: password ? encryptText(password) : null,
    private_key_passphrase: privateKeyPassphrase ? encryptText(privateKeyPassphrase) : null,
    ssh_agent_mode: agentMode,
    jump_connection_id: jumpConnectionId,
    connect_timeout_seconds: boundedInteger(data.connect_timeout_seconds, existing?.connect_timeout_seconds || 10, 3, 120, "连接超时"),
    keepalive_interval_seconds: boundedInteger(data.keepalive_interval_seconds, existing?.keepalive_interval_seconds ?? 60, 0, 300, "保活间隔"),
    keepalive_count_max: boundedInteger(data.keepalive_count_max, existing?.keepalive_count_max || 3, 1, 20, "保活次数"),
    tcp_keepalive: Number(data.tcp_keepalive ?? existing?.tcp_keepalive ?? 1) ? 1 : 0,
    x11_mode:x11Mode,
    favorite: Number(data.favorite ?? existing?.favorite ?? 0) ? 1 : 0,
    notifications_muted: Number(data.notifications_muted ?? existing?.notifications_muted ?? 0) ? 1 : 0,
    tags: String(data.tags || "").split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean).join(","),
    extra_args: encryptText(extraArgs),
    autostart_forwards: Number(data.autostart_forwards || 0) ? 1 : 0,
    sort_order: validateSortOrder(data.sort_order ?? existing?.sort_order ?? 1),
    ...cleanTerminalPreferences(data, existing),
    ...terminalStartup,
    terminal_program_path: encryptText(terminalStartup.terminal_program_path),
    terminal_program_args: encryptText(terminalStartup.terminal_program_args),
    terminal_working_directory: encryptText(terminalStartup.terminal_working_directory),
    sftp_text_encoding: cleanSftpTextEncoding(data.sftp_text_encoding, existing?.sftp_text_encoding),
    sftp_filename_encoding: cleanSftpFilenameEncoding(data.sftp_filename_encoding, existing?.sftp_filename_encoding)
  };
}

function cleanForward(data) {
  if (!["local", "remote", "socks"].includes(data.mode)) {
    throw new Error("转发类型只能是 local、remote 或 socks");
  }
  const item = {
    mode: data.mode,
    service_name: String(data.service_name || "").trim() || null,
    service_type: String(data.service_type || "").trim() || null,
    service_note: String(data.service_note || "").trim() || null,
    url_scheme: ["", "http", "https"].includes(String(data.url_scheme || "")) ? String(data.url_scheme || "") || null : null,
    bind_host: String(data.bind_host || "127.0.0.1").trim(),
    bind_port: validatePort(data.bind_port, "监听端口"),
    target_host: String(data.target_host || "127.0.0.1").trim(),
    target_port: data.target_port
  };
  if (item.mode === "socks") {
    item.target_host = null;
    item.target_port = null;
  } else {
    item.target_port = validatePort(item.target_port, "目标端口");
  }
  return item;
}

const IDENTITY_FILE_UNSAFE_MESSAGE = "私钥已不在安全目录，请编辑连接并导入 Terma 密钥目录或用户 ~/.ssh 顶层。";

function connectionIdentityFileState(authType, identityFile, cache = new Map()) {
  if (String(authType || "key") !== "key" || !String(identityFile || "").trim()) {
    return { identity_file_status:"none", identity_file_message:"" };
  }
  const resolved = path.resolve(String(identityFile));
  const cacheKey = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, allowedIdentityPath(resolved)
      ? { identity_file_status:"ready", identity_file_message:"" }
      : { identity_file_status:"unsafe", identity_file_message:IDENTITY_FILE_UNSAFE_MESSAGE });
  }
  return cache.get(cacheKey);
}

function listConnections() {
  const rows = all(`SELECT connections.*, connection_groups.sort_order AS group_sort_order
    FROM connections LEFT JOIN connection_groups ON connection_groups.name=connections.group_name
    ORDER BY COALESCE(connection_groups.sort_order,2147483647), connections.sort_order, connections.name COLLATE NOCASE, connections.created_at, connections.id`)
    .sort((a, b) => Number(a.group_sort_order ?? 2147483647) - Number(b.group_sort_order ?? 2147483647)
      || Number(a.sort_order || 1) - Number(b.sort_order || 1)
      || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", {numeric:true, sensitivity:"base"})
      || Number(a.created_at || 0) - Number(b.created_at || 0)
      || Number(a.id) - Number(b.id));
  const forwardsByConnection = new Map();
  for (const forward of all("SELECT * FROM connection_forwards ORDER BY connection_id,id")) {
    const item = {
      ...forward,
      status: forward.pid && pidRunning(forward.pid)
        ? "running"
        : forward.status === "running" && !forward.pid
          ? "running"
          : ["failed", "reconnecting"].includes(forward.status)
            ? forward.status
            : "stopped",
      pid: forward.pid && pidRunning(forward.pid) ? forward.pid : null
    };
    if (!forwardsByConnection.has(forward.connection_id)) forwardsByConnection.set(forward.connection_id, []);
    forwardsByConnection.get(forward.connection_id).push(item);
  }
  const identityStateCache = new Map();
  return rows.map((conn) => {
    const identityFile = decryptText(conn.identity_file);
    const identityState = connectionIdentityFileState(conn.auth_type, identityFile, identityStateCache);
    return {
      ...conn,
      identity_file: identityFile,
      ...identityState,
      ssh_password: undefined,
      has_password: Boolean(conn.ssh_password),
      private_key_passphrase: undefined,
      has_private_key_passphrase: Boolean(conn.private_key_passphrase),
      extra_args: decryptText(conn.extra_args),
      terminal_program_path: decryptText(conn.terminal_program_path),
      terminal_program_args: decryptText(conn.terminal_program_args),
      terminal_working_directory: decryptText(conn.terminal_working_directory),
      forwards: forwardsByConnection.get(conn.id) || []
    };
  });
}

const REMOTE_PROTOCOLS = new Set(["rdp", "vnc", "xdmcp", "ftp", "telnet", "serial"]);
const REMOTE_DEFAULT_PORTS = { rdp:3389, vnc:5900, xdmcp:177, ftp:21, telnet:23 };
const REMOTE_TERMINAL_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function parseRemoteOptions(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanRemoteOptions(protocol, source = {}) {
  const value: any = parseRemoteOptions(source);
  const bool = (key, fallback = false) => Boolean(value[key] ?? fallback);
  const text = (key, fallback = "", maximum = 2048) => {
    const result = String(value[key] ?? fallback).trim();
    if (result.includes("\0") || /[\r\n]/.test(result) || result.length > maximum) throw new Error(`${key} 配置无效`);
    return result;
  };
  const integer = (key, fallback, minimum, maximum) => boundedInteger(value[key], fallback, minimum, maximum, key);
  const sourceSshId = integer("source_ssh_connection_id", 0, 0, 2147483647);
  const withSource = (options) => sourceSshId ? {...options, source_ssh_connection_id:sourceSshId} : options;
  if (protocol === "rdp") {
    const legacyFullscreen = Object.prototype.hasOwnProperty.call(value, "fullscreen") ? bool("fullscreen") : null;
    const displayMode = new Set(["dynamic", "fullscreen", "fixed"]).has(String(value.display_mode))
      ? String(value.display_mode)
      : legacyFullscreen === true
        ? "fullscreen"
        : legacyFullscreen === false
          ? "fixed"
          : "dynamic";
    return withSource({
      domain:text("domain", "", 255),
      display_mode:displayMode,
      // Keep the legacy field synchronized for older desktop builds that may
      // read a profile created by a newer backend.
      fullscreen:displayMode === "fullscreen",
      width:integer("width", 1440, 640, 8192),
      height:integer("height", 900, 480, 8192),
      admin_session:bool("admin_session"),
      clipboard:bool("clipboard", true),
      audio:new Set(["local", "remote", "off"]).has(String(value.audio)) ? String(value.audio) : "local"
    });
  }
  if (protocol === "vnc") {
    const serverSessionMode = new Set(["auto", "shared", "virtual"]).has(String(value.server_session_mode))
      ? String(value.server_session_mode)
      : "auto";
    const serverDisplay = text("server_display", "", 32);
    if (serverDisplay && !/^:[0-9]+(?:\.[0-9]+)?$/.test(serverDisplay)) throw new Error("VNC 服务端显示编号无效");
    return withSource({
      client_mode:new Set(["auto", "embedded", "system"]).has(String(value.client_mode)) ? String(value.client_mode) : "auto",
      cursor_mode:new Set(["auto", "show", "hide"]).has(String(value.cursor_mode)) ? String(value.cursor_mode) : "auto",
      display_mode:new Set(["scale", "original", "resize"]).has(String(value.display_mode)) ? String(value.display_mode) : "scale",
      server_session_mode:serverSessionMode,
      server_display:serverSessionMode === "shared" ? serverDisplay : "",
      view_only:bool("view_only"),
      shared:bool("shared", true),
      quality:integer("quality", 8, 0, 9)
    });
  }
  if (protocol === "xdmcp") {
    const rawWindowMode = String(value.window_mode || "");
    const windowMode = new Set(["resizable", "fullscreen", "fixed"]).has(rawWindowMode)
      ? rawWindowMode
      : rawWindowMode === "windowed"
        ? "fixed"
        : "resizable";
    return withSource({
      mode:new Set(["query", "indirect", "broadcast"]).has(String(value.mode)) ? String(value.mode) : "query",
      window_mode:windowMode,
      width:integer("width", 1440, 640, 8192),
      height:integer("height", 900, 480, 8192),
      local_address:text("local_address", "", 255),
      ssh_connection_id:integer("ssh_connection_id", 0, 0, 2147483647)
    });
  }
  if (protocol === "ftp") return withSource({
    secure:new Set(["none", "explicit", "implicit"]).has(String(value.secure)) ? String(value.secure) : "none",
    passive:bool("passive", true),
    reject_unauthorized:bool("reject_unauthorized", true),
    base_path:text("base_path", "/", 2048) || "/"
  });
  if (protocol === "telnet") {
    const encoding = String(value.encoding || "utf8").toLowerCase();
    if (!REMOTE_TERMINAL_ENCODINGS.has(encoding)) throw new Error("不支持的 Telnet 编码");
    return withSource({ terminal_type:text("terminal_type", "xterm-256color", 80) || "xterm-256color", encoding });
  }
  const encoding = String(value.encoding || "utf8").toLowerCase();
  if (!REMOTE_TERMINAL_ENCODINGS.has(encoding)) throw new Error("不支持的串口编码");
  const dataBits = Number(value.data_bits || 8);
  const stopBits = Number(value.stop_bits || 1);
  const parity = String(value.parity || "none").toLowerCase();
  if (![5, 6, 7, 8].includes(dataBits)) throw new Error("串口数据位无效");
  if (![1, 1.5, 2].includes(stopBits)) throw new Error("串口停止位无效");
  if (!["none", "even", "odd", "mark", "space"].includes(parity)) throw new Error("串口校验位无效");
  return withSource({
    path:text("path", "", 1024),
    baud_rate:integer("baud_rate", 115200, 50, 4000000),
    data_bits:dataBits,
    stop_bits:stopBits,
    parity,
    rts_cts:bool("rts_cts"),
    xon:bool("xon"),
    xoff:bool("xoff"),
    encoding
  });
}

function cleanRemoteProfile(data, existing = null) {
  const protocol = String(data.protocol || existing?.protocol || "").trim().toLowerCase();
  if (!REMOTE_PROTOCOLS.has(protocol)) throw new Error("不支持的远程连接协议");
  const name = String(data.name || existing?.name || "").trim();
  if (!name || name.length > 120) throw new Error("连接名称长度必须在 1-120 个字符之间");
  const options = cleanRemoteOptions(protocol, data.options ?? existing?.options_json);
  const requiresHost = protocol !== "serial" && !(protocol === "xdmcp" && options.mode === "broadcast");
  const host = protocol === "serial" ? "" : String(data.host ?? existing?.host ?? "").trim();
  if ((requiresHost && !host) || host.length > 255 || /[\0\r\n]/.test(host)) throw new Error("请填写有效的目标主机");
  const submittedPassword = Object.prototype.hasOwnProperty.call(data, "password") ? String(data.password || "") : "";
  const keepExistingPassword = !data.clear_password && existing?.password;
  const password = submittedPassword || (keepExistingPassword ? decryptText(existing.password) : "");
  if (password.length > 4096) throw new Error("密码长度不能超过 4096 个字符");
  if (protocol === "serial" && !options.path) throw new Error("请选择串口设备");
  return {
    name,
    group_name:String(data.group_name || existing?.group_name || "默认分组").trim() || "默认分组",
    protocol,
    host,
    port:protocol === "serial" ? null : validatePort(data.port || existing?.port || REMOTE_DEFAULT_PORTS[protocol], `${protocol.toUpperCase()} 端口`),
    username:String(data.username ?? existing?.username ?? "").trim().slice(0, 255),
    password:password ? encryptText(password) : null,
    favorite:Number(data.favorite ?? existing?.favorite ?? 0) ? 1 : 0,
    tags:String(data.tags ?? existing?.tags ?? "").split(/[,，\s]+/).map(item => item.trim()).filter(Boolean).join(","),
    options_json:JSON.stringify(options)
  };
}

function remoteProfileView(row, includeSecret = false) {
  const options = cleanRemoteOptions(String(row.protocol), row.options_json);
  return {
    ...row,
    kind:"remote",
    options,
    options_json:undefined,
    password:includeSecret ? decryptText(row.password) : undefined,
    has_password:Boolean(row.password)
  };
}

function listRemoteProfiles() {
  return all(`SELECT remote_profiles.*, connection_groups.sort_order AS group_sort_order
    FROM remote_profiles LEFT JOIN connection_groups ON connection_groups.name=remote_profiles.group_name
    ORDER BY COALESCE(connection_groups.sort_order,2147483647), remote_profiles.name COLLATE NOCASE, remote_profiles.created_at, remote_profiles.id`)
    .map(row => remoteProfileView(row));
}

function getRemoteProfile(id) {
  const row = get("SELECT * FROM remote_profiles WHERE id=?", [Number(id)]);
  if (!row) throw new Error("远程连接不存在");
  return remoteProfileView(row, true);
}

function insertRemoteProfile(data) {
  const item = cleanRemoteProfile(data);
  ensureConnectionGroup(item.group_name);
  const ts = now();
  const result = run(`INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?)`, [item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,item.tags,item.options_json,ts,ts]);
  return Number(result.lastInsertRowid);
}

function createRemoteProfileFromConnection(connectionId, protocolValue) {
  const protocol = String(protocolValue || "").trim().toLowerCase();
  if (!REMOTE_PROTOCOLS.has(protocol) || protocol === "serial") throw new Error("该协议不能从 SSH 连接生成");
  const connection = getConnection(connectionId);
  const existing = listRemoteProfiles().find(profile => profile.protocol === protocol
    && Number(profile.options?.source_ssh_connection_id || 0) === Number(connection.id));
  if (existing) return {id:existing.id, name:existing.name, protocol, created:false};
  const labels = {rdp:"RDP", vnc:"VNC", xdmcp:"XDMCP", ftp:"FTP", telnet:"Telnet"};
  const baseName = `${connection.name} · ${labels[protocol] || protocol.toUpperCase()}`.slice(0, 120);
  const names = new Set(listRemoteProfiles().map(profile => String(profile.name || "").toLocaleLowerCase()));
  let name = baseName;
  let suffix = 2;
  while (names.has(name.toLocaleLowerCase())) {
    const ending = `（${suffix}）`;
    name = `${baseName.slice(0, Math.max(1, 120 - ending.length))}${ending}`;
    suffix += 1;
  }
  const options = {
    source_ssh_connection_id:Number(connection.id),
    ...(protocol === "xdmcp" ? {ssh_connection_id:Number(connection.id)} : {})
  };
  const id = insertRemoteProfile({
    protocol,
    name,
    group_name:connection.group_name || "默认分组",
    host:connection.ssh_host,
    port:REMOTE_DEFAULT_PORTS[protocol],
    username:["vnc", "ftp"].includes(protocol) ? connection.ssh_user : "",
    password:"",
    tags:connection.tags || "",
    options
  });
  return {id, name, protocol, created:true};
}

function createAllRemoteProfilesFromConnection(connectionId) {
  const protocols = ["rdp", "vnc", "xdmcp", "ftp", "telnet"];
  db.exec("BEGIN IMMEDIATE");
  try {
    const results = protocols.map(protocol => createRemoteProfileFromConnection(connectionId, protocol));
    db.exec("COMMIT");
    return {
      results,
      created_count:results.filter(item => item.created).length,
      existing_count:results.filter(item => !item.created).length
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function updateRemoteProfile(id, data) {
  const existing = get("SELECT * FROM remote_profiles WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("远程连接不存在");
  const item = cleanRemoteProfile(data, existing);
  ensureConnectionGroup(item.group_name);
  run(`UPDATE remote_profiles SET name=?,group_name=?,protocol=?,host=?,port=?,username=?,password=?,favorite=?,tags=?,options_json=?,updated_at=? WHERE id=?`,
    [item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,item.tags,item.options_json,now(),Number(id)]);
  return getRemoteProfile(id);
}

function getVncProfileCredential(id) {
  const profile = getRemoteProfile(id);
  if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
  return {has_password:Boolean(profile.password), password:String(profile.password || "")};
}

function updateVncProfileCredential(id, value) {
  const profile = getRemoteProfile(id);
  if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
  const password = String(value || "");
  if (password.length > 4096) throw new Error("VNC 密码长度不能超过 4096 个字符");
  run("UPDATE remote_profiles SET password=?,updated_at=? WHERE id=?", [password ? encryptText(password) : null,now(),Number(id)]);
  return {ok:true, has_password:Boolean(password)};
}

function duplicateRemoteProfile(id) {
  const source = getRemoteProfile(id);
  const base = String(source.name || "连接").replace(/\s*(?:（copy\d+）|\(copy\d+\))$/i, "").trim() || "连接";
  const existing = new Set(all("SELECT name FROM remote_profiles").map(item => String(item.name || "").toLocaleLowerCase()));
  let index = 1;
  while (existing.has(`${base}（copy${index}）`.toLocaleLowerCase())) index += 1;
  const name = `${base}（copy${index}）`;
  const profileId = insertRemoteProfile({...source, name, password:source.password || "", options:source.options});
  return {id:profileId, name};
}

function deleteRemoteProfile(id) {
  const result = run("DELETE FROM remote_profiles WHERE id=?", [Number(id)]);
  if (!result.changes) throw new Error("远程连接不存在");
  return {ok:true};
}

function updateRemoteProfileUsage(id) {
  getRemoteProfile(id);
  run("UPDATE remote_profiles SET last_used_at=?,updated_at=? WHERE id=?", [now(),now(),Number(id)]);
  return {ok:true};
}

function updateRemoteProfileFlags(id, data) {
  const profile = getRemoteProfile(id);
  const favorite = data.favorite === undefined ? Number(profile.favorite || 0) : Number(data.favorite || 0) ? 1 : 0;
  run("UPDATE remote_profiles SET favorite=?,updated_at=? WHERE id=?", [favorite,now(),Number(id)]);
  return {ok:true, favorite:Boolean(favorite)};
}

function getConnection(id) {
  const row = get("SELECT * FROM connections WHERE id = ?", [Number(id)]);
  if (!row) throw new Error("连接不存在");
  return {
    ...row,
    identity_file: decryptText(row.identity_file),
    ssh_password: decryptText(row.ssh_password),
    private_key_passphrase: decryptText(row.private_key_passphrase),
    extra_args: decryptText(row.extra_args),
    terminal_program_path: decryptText(row.terminal_program_path),
    terminal_program_args: decryptText(row.terminal_program_args),
    terminal_working_directory: decryptText(row.terminal_working_directory)
  };
}

function getForward(id) {
  const row = get("SELECT * FROM connection_forwards WHERE id = ?", [Number(id)]);
  if (!row) throw new Error("转发不存在");
  return row;
}

function insertConnection(data, defaultExtraArgs) {
  const item = cleanConnection(data, defaultExtraArgs);
  ensureConnectionGroup(item.group_name);
  const ts = now();
  const result = run(
    `INSERT INTO connections
     (name, group_name, ssh_host, ssh_port, ssh_user, auth_type, identity_file, ssh_password, private_key_passphrase, ssh_agent_mode, jump_connection_id, connect_timeout_seconds, keepalive_interval_seconds, keepalive_count_max, tcp_keepalive, x11_mode, favorite, last_used_at, notifications_muted, tags, extra_args, autostart_forwards, sort_order, terminal_encoding, terminal_font_family, terminal_font_size, terminal_mobile_font_size, terminal_line_height, terminal_font_weight, terminal_startup_mode, terminal_profile_name, terminal_profile_kind, terminal_program_path, terminal_program_args, terminal_working_directory, terminal_program_platform, sftp_text_encoding, sftp_filename_encoding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.name, item.group_name, item.ssh_host, item.ssh_port, item.ssh_user, item.auth_type, item.identity_file, item.ssh_password, item.private_key_passphrase, item.ssh_agent_mode, item.jump_connection_id, item.connect_timeout_seconds, item.keepalive_interval_seconds, item.keepalive_count_max, item.tcp_keepalive, item.x11_mode, item.favorite, null, item.notifications_muted, item.tags, item.extra_args, item.autostart_forwards, item.sort_order, item.terminal_encoding, item.terminal_font_family, item.terminal_font_size, item.terminal_mobile_font_size, item.terminal_line_height, item.terminal_font_weight, item.terminal_startup_mode, item.terminal_profile_name, item.terminal_profile_kind, item.terminal_program_path, item.terminal_program_args, item.terminal_working_directory, item.terminal_program_platform, item.sftp_text_encoding, item.sftp_filename_encoding, ts, ts]
  );
  return Number(result.lastInsertRowid);
}

function nextConnectionCopyName(name) {
  const source = String(name || "").trim();
  const base = source.replace(/\s*(?:（copy\d+）|\(copy\d+\))$/i, "").trim() || source || "SSH";
  const existing = new Set(all("SELECT name FROM connections").map((item) => String(item.name || "").toLocaleLowerCase()));
  let index = 1;
  while (existing.has(`${base}（copy${index}）`.toLocaleLowerCase())) index += 1;
  return `${base}（copy${index}）`;
}

function duplicateConnection(id, defaultExtraArgs) {
  const source = getConnection(id);
  const name = nextConnectionCopyName(source.name);
  const forwards = all("SELECT * FROM connection_forwards WHERE connection_id=? ORDER BY id", [Number(id)]);
  db.exec("BEGIN IMMEDIATE");
  try {
    const connectionId = insertConnection({ ...source, name }, defaultExtraArgs);
    for (const forward of forwards) insertForward(connectionId, forward);
    db.exec("COMMIT");
    return { id: connectionId, name, forwards: forwards.length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function updateConnection(id, data, defaultExtraArgs) {
  const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("连接不存在");
  const item = cleanConnection(data, defaultExtraArgs, existing);
  ensureConnectionGroup(item.group_name);
  run(
    `UPDATE connections SET name=?, group_name=?, ssh_host=?, ssh_port=?, ssh_user=?, auth_type=?, identity_file=?, ssh_password=?, private_key_passphrase=?, ssh_agent_mode=?, jump_connection_id=?, connect_timeout_seconds=?, keepalive_interval_seconds=?, keepalive_count_max=?, tcp_keepalive=?, x11_mode=?, favorite=?, notifications_muted=?, tags=?, extra_args=?, autostart_forwards=?, sort_order=?, terminal_encoding=?, terminal_font_family=?, terminal_font_size=?, terminal_mobile_font_size=?, terminal_line_height=?, terminal_font_weight=?, terminal_startup_mode=?, terminal_profile_name=?, terminal_profile_kind=?, terminal_program_path=?, terminal_program_args=?, terminal_working_directory=?, terminal_program_platform=?, sftp_text_encoding=?, sftp_filename_encoding=?, updated_at=? WHERE id=?`,
    [item.name, item.group_name, item.ssh_host, item.ssh_port, item.ssh_user, item.auth_type, item.identity_file, item.ssh_password, item.private_key_passphrase, item.ssh_agent_mode, item.jump_connection_id, item.connect_timeout_seconds, item.keepalive_interval_seconds, item.keepalive_count_max, item.tcp_keepalive, item.x11_mode, item.favorite, item.notifications_muted, item.tags, item.extra_args, item.autostart_forwards, item.sort_order, item.terminal_encoding, item.terminal_font_family, item.terminal_font_size, item.terminal_mobile_font_size, item.terminal_line_height, item.terminal_font_weight, item.terminal_startup_mode, item.terminal_profile_name, item.terminal_profile_kind, item.terminal_program_path, item.terminal_program_args, item.terminal_working_directory, item.terminal_program_platform, item.sftp_text_encoding, item.sftp_filename_encoding, now(), Number(id)]
  );
}

function updateConnectionUsage(id, action = "open") {
  getConnection(id);
  run("UPDATE connections SET last_used_at=?,updated_at=CASE WHEN ?='edit' THEN ? ELSE updated_at END WHERE id=?", [now(), String(action), now(), Number(id)]);
  return { ok:true, last_used_at:now() };
}

function updateConnectionFlags(id, data: any = {}) {
  getConnection(id);
  const favorite = Number(data.favorite || 0) ? 1 : 0;
  const notificationsMuted = Number(data.notifications_muted || 0) ? 1 : 0;
  run("UPDATE connections SET favorite=?,notifications_muted=?,updated_at=? WHERE id=?", [favorite, notificationsMuted, now(), Number(id)]);
  return { favorite, notifications_muted:notificationsMuted };
}

function updateTerminalPreferences(id, data) {
  const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("连接不存在");
  const item = cleanTerminalPreferences(data, existing);
  run("UPDATE connections SET terminal_encoding=?,terminal_font_family=?,terminal_font_size=?,terminal_mobile_font_size=?,terminal_line_height=?,terminal_font_weight=?,updated_at=? WHERE id=?",
    [item.terminal_encoding, item.terminal_font_family, item.terminal_font_size, item.terminal_mobile_font_size, item.terminal_line_height, item.terminal_font_weight, now(), Number(id)]);
  return item;
}

function updateTerminalStartup(id, data) {
  const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("连接不存在");
  const item = cleanTerminalStartup(data, existing);
  run(
    "UPDATE connections SET terminal_startup_mode=?,terminal_profile_name=?,terminal_profile_kind=?,terminal_program_path=?,terminal_program_args=?,terminal_working_directory=?,terminal_program_platform=?,updated_at=? WHERE id=?",
    [
      item.terminal_startup_mode,
      item.terminal_profile_name,
      item.terminal_profile_kind,
      encryptText(item.terminal_program_path),
      encryptText(item.terminal_program_args),
      encryptText(item.terminal_working_directory),
      item.terminal_program_platform,
      now(),
      Number(id)
    ]
  );
  return item;
}

function updateConnectionX11Mode(id, value) {
  const existing = get("SELECT id FROM connections WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("连接不存在");
  const mode = String(value || "off").trim().toLowerCase();
  if (!["off", "untrusted", "trusted"].includes(mode)) throw new Error("X11 转发模式无效");
  run("UPDATE connections SET x11_mode=?,updated_at=? WHERE id=?", [mode,now(),Number(id)]);
  return {ok:true,x11_mode:mode};
}

function updateSftpTextEncoding(id, value) {
  getConnection(id);
  const encoding = cleanSftpTextEncoding(value);
  run("UPDATE connections SET sftp_text_encoding=?,updated_at=? WHERE id=?", [encoding, now(), Number(id)]);
  return { sftp_text_encoding: encoding };
}

function updateSftpFilenameEncoding(id, value) {
  getConnection(id);
  const encoding = cleanSftpFilenameEncoding(value);
  run("UPDATE connections SET sftp_filename_encoding=?,updated_at=? WHERE id=?", [encoding, now(), Number(id)]);
  return { sftp_filename_encoding: encoding };
}

function bulkUpdateConnections(connectionIds, changes: any = {}) {
  const ids = [...new Set((connectionIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error("请选择要修改的 SSH 连接");
  if (ids.length > 500) throw new Error("单次最多批量修改 500 个 SSH 连接");

  const assignments = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(changes, "group_name")) {
    const groupName = String(changes.group_name || "").trim();
    if (!groupName || groupName.length > 100) throw new Error("分组名称长度必须在 1-100 个字符之间");
    assignments.push("group_name=?");
    values.push(groupName);
    ensureConnectionGroup(groupName);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "ssh_port")) {
    assignments.push("ssh_port=?");
    values.push(validatePort(changes.ssh_port, "SSH 端口"));
  }
  if (changes.auth) {
    const authType = String(changes.auth.type || "");
    if (authType === "password") {
      const password = String(changes.auth.password || "");
      if (!password || password.length > 4096) throw new Error("SSH 密码长度必须在 1-4096 个字符之间");
      assignments.push("auth_type=?", "identity_file=?", "ssh_password=?");
      values.push("password", null, encryptText(password));
    } else if (authType === "key") {
      const identityFile = assertAllowedIdentityPath(String(changes.auth.identity_file || ""));
      if (!identityFile || !fs.existsSync(identityFile)) throw new Error("请选择存在的私钥文件");
      assignments.push("auth_type=?", "identity_file=?", "ssh_password=?");
      values.push("key", encryptText(identityFile), null);
    } else {
      throw new Error("不支持的认证方式");
    }
  }
  if (!assignments.length) throw new Error("请至少选择一项批量设置");

  const placeholders = ids.map(() => "?").join(",");
  const existing = all(`SELECT id FROM connections WHERE id IN (${placeholders})`, ids);
  if (existing.length !== ids.length) throw new Error("部分 SSH 连接不存在，请刷新后重试");
  db.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = now();
    for (const id of ids) {
      run(`UPDATE connections SET ${assignments.join(", ")}, updated_at=? WHERE id=?`, [...values, timestamp, id]);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, updated: ids.length };
}

function renameConnectionGroup(currentName, nextName) {
  const source = String(currentName || "").trim();
  const target = String(nextName || "").trim();
  if (!source || source.length > 100 || !target || target.length > 100) {
    throw new Error("分组名称长度必须在 1-100 个字符之间");
  }
  const existing = get("SELECT (SELECT COUNT(*) FROM connections WHERE group_name=?)+(SELECT COUNT(*) FROM remote_profiles WHERE group_name=?) AS count", [source, source]);
  if (!Number(existing?.count)) throw new Error("分组不存在，请刷新后重试");
  if (source === target) return { ok: true, updated: 0, group_name: target };
  const conflict = get("SELECT 1 AS found FROM connections WHERE group_name=? UNION ALL SELECT 1 AS found FROM remote_profiles WHERE group_name=? LIMIT 1", [target, target]);
  if (conflict) throw new Error("该分组名称已存在，请使用其他名称");
  const result = run("UPDATE connections SET group_name=?, updated_at=? WHERE group_name=?", [target, now(), source]);
  const remoteResult = run("UPDATE remote_profiles SET group_name=?, updated_at=? WHERE group_name=?", [target, now(), source]);
  run("DELETE FROM connection_groups WHERE name=?", [target]);
  run("UPDATE connection_groups SET name=?,updated_at=? WHERE name=?", [target, now(), source]);
  return { ok: true, updated: Number(result?.changes || 0) + Number(remoteResult?.changes || 0), group_name: target };
}

function reorderConnectionGroups(names) {
  const requested = [...new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean))];
  const active = all("SELECT group_name FROM connections UNION SELECT group_name FROM remote_profiles").map((row) => row.group_name);
  if (requested.length !== active.length || active.some((name) => !requested.includes(name))) throw new Error("分组列表已变化，请刷新后重试");
  db.exec("BEGIN IMMEDIATE");
  try {
    requested.forEach((name, index) => {
      ensureConnectionGroup(name);
      run("UPDATE connection_groups SET sort_order=?,updated_at=? WHERE name=?", [index + 1, now(), name]);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, groups: requested.length };
}

function isEncryptedText(value) {
  return String(value || "").startsWith("tdenc:v1:");
}

function rewriteConnectionSecrets(transform) {
  const rows = all("SELECT id, identity_file, ssh_password, private_key_passphrase, extra_args, terminal_program_path, terminal_program_args, terminal_working_directory FROM connections");
  const update = db.prepare("UPDATE connections SET identity_file=?, ssh_password=?, private_key_passphrase=?, extra_args=?, terminal_program_path=?, terminal_program_args=?, terminal_working_directory=?, updated_at=? WHERE id=?");
  let changed = 0;
  for (const row of rows) {
    const identityFile = row.identity_file ? transform(row.identity_file) : row.identity_file;
    const sshPassword = row.ssh_password ? transform(row.ssh_password) : row.ssh_password;
    const privateKeyPassphrase = row.private_key_passphrase ? transform(row.private_key_passphrase) : row.private_key_passphrase;
    const extraArgs = row.extra_args ? transform(row.extra_args) : row.extra_args;
    const terminalProgramPath = row.terminal_program_path ? transform(row.terminal_program_path) : row.terminal_program_path;
    const terminalProgramArgs = row.terminal_program_args ? transform(row.terminal_program_args) : row.terminal_program_args;
    const terminalWorkingDirectory = row.terminal_working_directory ? transform(row.terminal_working_directory) : row.terminal_working_directory;
    if (
      identityFile !== row.identity_file
      || sshPassword !== row.ssh_password
      || privateKeyPassphrase !== row.private_key_passphrase
      || extraArgs !== row.extra_args
      || terminalProgramPath !== row.terminal_program_path
      || terminalProgramArgs !== row.terminal_program_args
      || terminalWorkingDirectory !== row.terminal_working_directory
    ) {
      update.run(identityFile, sshPassword, privateKeyPassphrase, extraArgs, terminalProgramPath, terminalProgramArgs, terminalWorkingDirectory, now(), row.id);
      changed += 1;
    }
  }
  const remoteRows = all("SELECT id,password FROM remote_profiles");
  const updateRemote = db.prepare("UPDATE remote_profiles SET password=?,updated_at=? WHERE id=?");
  for (const row of remoteRows) {
    const password = row.password ? transform(row.password) : row.password;
    if (password !== row.password) {
      updateRemote.run(password, now(), row.id);
      changed += 1;
    }
  }
  return changed;
}

function encryptStoredConnectionSecrets() {
  return rewriteConnectionSecrets((value) => isEncryptedText(value) ? value : encryptText(value));
}

function decryptStoredConnectionSecrets() {
  return rewriteConnectionSecrets((value) => isEncryptedText(value) ? decryptText(value) : value);
}

function insertForward(connectionId, data) {
  getConnection(connectionId);
  const item = cleanForward(data);
  const ts = now();
  const result = run(
    `INSERT INTO connection_forwards
     (connection_id, mode, service_name, service_type, service_note, url_scheme, bind_host, bind_port, target_host, target_port, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(connectionId), item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.bind_host, item.bind_port, item.target_host, item.target_port, ts, ts]
  );
  return Number(result.lastInsertRowid);
}

function updateForward(id, data) {
  getForward(id);
  const item = cleanForward(data);
  run(
    `UPDATE connection_forwards
     SET mode=?, service_name=?, service_type=?, service_note=?, url_scheme=?, bind_host=?, bind_port=?, target_host=?, target_port=?, updated_at=?
     WHERE id=?`,
    [item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.bind_host, item.bind_port, item.target_host, item.target_port, now(), Number(id)]
  );
}

function deleteConnection(id, stopForward) {
  for (const forward of all("SELECT id FROM connection_forwards WHERE connection_id=?", [Number(id)])) {
    stopForward(forward.id);
  }
  run("DELETE FROM connection_forwards WHERE connection_id=?", [Number(id)]);
  run("UPDATE connections SET jump_connection_id=NULL WHERE jump_connection_id=?", [Number(id)]);
  run("DELETE FROM connections WHERE id=?", [Number(id)]);
}

function deleteForward(id, stopForward) {
  stopForward(id);
  run("DELETE FROM connection_forwards WHERE id=?", [Number(id)]);
}

function listForwardTemplates() {
  return all("SELECT * FROM forward_templates ORDER BY name, id");
}

function cleanForwardTemplate(data) {
  const item = cleanForward(data);
  const name = String(data.name || "").trim();
  if (!name) throw new Error("缺少模板名称");
  return { name, ...item };
}

function insertForwardTemplate(data) {
  const item = cleanForwardTemplate(data);
  const ts = now();
  const result = run(
    `INSERT INTO forward_templates
     (name, mode, service_name, service_type, service_note, url_scheme, bind_host, bind_port, target_host, target_port, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.name, item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.bind_host, item.bind_port, item.target_host, item.target_port, ts, ts]
  );
  return Number(result.lastInsertRowid);
}

function updateForwardTemplate(id, data) {
  const item = cleanForwardTemplate(data);
  run(
    `UPDATE forward_templates
     SET name=?, mode=?, service_name=?, service_type=?, service_note=?, url_scheme=?, bind_host=?, bind_port=?, target_host=?, target_port=?, updated_at=?
     WHERE id=?`,
    [item.name, item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.bind_host, item.bind_port, item.target_host, item.target_port, now(), Number(id)]
  );
}

function deleteForwardTemplate(id) {
  run("DELETE FROM forward_templates WHERE id=?", [Number(id)]);
}

function getForwardTemplate(id) {
  const row = get("SELECT * FROM forward_templates WHERE id=?", [Number(id)]);
  if (!row) throw new Error("转发模板不存在");
  return row;
}

function applyForwardTemplate(templateId, connectionIds) {
  const template = getForwardTemplate(templateId);
  const ids = [...new Set((connectionIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new Error("请选择要应用的连接");
  const created = [];
  for (const connectionId of ids) {
    getConnection(connectionId);
    created.push(insertForward(connectionId, template));
  }
  return { ok: true, created };
}

function ensureBuiltinForwardTemplates() {
  if (get("SELECT value FROM app_meta WHERE key='builtin_forward_templates_v1'")) return;
  const templates = [
    { name:"Web HTTP", mode:"local", service_name:"Web", service_type:"web", url_scheme:"http", bind_host:"127.0.0.1", bind_port:8080, target_host:"127.0.0.1", target_port:80 },
    { name:"MySQL", mode:"local", service_name:"MySQL", service_type:"mysql", bind_host:"127.0.0.1", bind_port:3306, target_host:"127.0.0.1", target_port:3306 },
    { name:"Redis", mode:"local", service_name:"Redis", service_type:"redis", bind_host:"127.0.0.1", bind_port:6379, target_host:"127.0.0.1", target_port:6379 },
    { name:"Memcached", mode:"local", service_name:"Memcached", service_type:"other", bind_host:"127.0.0.1", bind_port:11211, target_host:"127.0.0.1", target_port:11211 },
    { name:"SSH", mode:"local", service_name:"SSH", service_type:"ssh", bind_host:"127.0.0.1", bind_port:2222, target_host:"127.0.0.1", target_port:22 },
    { name:"SOCKS5", mode:"socks", service_name:"SOCKS5", service_type:"socks", bind_host:"127.0.0.1", bind_port:1080, target_host:"", target_port:null }
  ];
  for (const template of templates) insertForwardTemplate(template);
  run("INSERT OR REPLACE INTO app_meta(key,value) VALUES('builtin_forward_templates_v1',?)", [String(Date.now())]);
}

function cleanCommandSnippet(data: any = {}, existing: any = null) {
  const name = String(data.name ?? existing?.name ?? "").trim();
  const command = String(data.command ?? existing?.command ?? "").replace(/\r\n?/g, "\n").trim();
  if (!name) throw new Error("命令片段需要名称");
  if (!command) throw new Error("命令片段不能为空");
  if (name.length > 120) throw new Error("命令片段名称不能超过 120 个字符");
  if (command.length > 100000) throw new Error("命令片段内容过长");
  return {
    name,
    group_name:String(data.group_name ?? existing?.group_name ?? "默认分组").trim() || "默认分组",
    command,
    description:String(data.description ?? existing?.description ?? "").trim().slice(0, 1000),
    tags:String(data.tags ?? existing?.tags ?? "").split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean).join(","),
    favorite:Number(data.favorite ?? existing?.favorite ?? 0) ? 1 : 0
  };
}

function listCommandSnippets() {
  return all(`SELECT * FROM command_snippets
    ORDER BY favorite DESC, COALESCE(last_used_at,0) DESC, group_name COLLATE NOCASE, name COLLATE NOCASE, id`);
}

function insertCommandSnippet(data) {
  const item = cleanCommandSnippet(data);
  const ts = now();
  const result = run(
    "INSERT INTO command_snippets(name,group_name,command,description,tags,favorite,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?)",
    [item.name,item.group_name,item.command,item.description,item.tags,item.favorite,ts,ts]
  );
  return { id:Number(result.lastInsertRowid), ...item, last_used_at:null, created_at:ts, updated_at:ts };
}

function updateCommandSnippet(id, data) {
  const existing = get("SELECT * FROM command_snippets WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("命令片段不存在");
  const item = cleanCommandSnippet(data, existing);
  const updatedAt = now();
  run("UPDATE command_snippets SET name=?,group_name=?,command=?,description=?,tags=?,favorite=?,updated_at=? WHERE id=?",
    [item.name,item.group_name,item.command,item.description,item.tags,item.favorite,updatedAt,Number(id)]);
  return { ...existing, ...item, id:Number(id), updated_at:updatedAt };
}

function deleteCommandSnippet(id) {
  const result = run("DELETE FROM command_snippets WHERE id=?", [Number(id)]);
  if (!result.changes) throw new Error("命令片段不存在");
  return { ok:true };
}

function useCommandSnippet(id) {
  const item = get("SELECT * FROM command_snippets WHERE id=?", [Number(id)]);
  if (!item) throw new Error("命令片段不存在");
  const usedAt = now();
  run("UPDATE command_snippets SET last_used_at=? WHERE id=?", [usedAt,Number(id)]);
  return { ...item, last_used_at:usedAt };
}

function cleanNamedWorkspace(data: any = {}, existing: any = null) {
  const name = String(data.name ?? existing?.name ?? "").trim();
  if (!name) throw new Error("工作区需要名称");
  if (name.length > 120) throw new Error("工作区名称不能超过 120 个字符");
  let layout;
  try {
    layout = typeof data.layout === "string"
      ? JSON.parse(data.layout)
      : (data.layout ?? JSON.parse(existing?.layout_json || "{}"));
  } catch {
    throw new Error("工作区内容格式无效");
  }
  const layoutJson = JSON.stringify(layout);
  if (!layout || !Array.isArray(layout.tabs)) throw new Error("工作区缺少标签信息");
  if (Buffer.byteLength(layoutJson, "utf8") > 2 * 1024 * 1024) throw new Error("工作区内容不能超过 2 MB");
  return {
    name,
    description:String(data.description ?? existing?.description ?? "").trim().slice(0, 1000),
    layout_json:layoutJson
  };
}

function workspaceView(row) {
  if (!row) return null;
  let layout = {};
  try { layout = JSON.parse(row.layout_json); } catch {}
  const { layout_json, ...rest } = row;
  return { ...rest, layout };
}

function listNamedWorkspaces() {
  return all("SELECT * FROM named_workspaces ORDER BY COALESCE(last_used_at,0) DESC, updated_at DESC, name COLLATE NOCASE").map(workspaceView);
}

function insertNamedWorkspace(data) {
  const item = cleanNamedWorkspace(data);
  const ts = now();
  try {
    const result = run("INSERT INTO named_workspaces(name,description,layout_json,last_used_at,created_at,updated_at) VALUES(?,?,?,NULL,?,?)",
      [item.name,item.description,item.layout_json,ts,ts]);
    return workspaceView({ id:Number(result.lastInsertRowid), ...item, last_used_at:null, created_at:ts, updated_at:ts });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) throw new Error("已存在同名工作区");
    throw error;
  }
}

function updateNamedWorkspace(id, data) {
  const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("命名工作区不存在");
  const item = cleanNamedWorkspace(data, existing);
  const updatedAt = now();
  try {
    run("UPDATE named_workspaces SET name=?,description=?,layout_json=?,updated_at=? WHERE id=?",
      [item.name,item.description,item.layout_json,updatedAt,Number(id)]);
    return workspaceView({ ...existing, ...item, id:Number(id), updated_at:updatedAt });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) throw new Error("已存在同名工作区");
    throw error;
  }
}

function duplicateNamedWorkspace(id) {
  const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("命名工作区不存在");
  const names = new Set(all("SELECT name FROM named_workspaces").map((item) => String(item.name).toLocaleLowerCase()));
  const base = String(existing.name).replace(/\s*\(\d+\)$/u, "").trim();
  let index = 1;
  while (names.has(`${base} (${index})`.toLocaleLowerCase())) index += 1;
  return insertNamedWorkspace({ name:`${base} (${index})`, description:existing.description, layout:JSON.parse(existing.layout_json) });
}

function useNamedWorkspace(id) {
  const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
  if (!existing) throw new Error("命名工作区不存在");
  const usedAt = now();
  run("UPDATE named_workspaces SET last_used_at=? WHERE id=?", [usedAt,Number(id)]);
  return workspaceView({ ...existing, last_used_at:usedAt });
}

function deleteNamedWorkspace(id) {
  const result = run("DELETE FROM named_workspaces WHERE id=?", [Number(id)]);
  if (!result.changes) throw new Error("命名工作区不存在");
  return { ok:true };
}

function exportConfigSnapshot() {
  return {
    version: 1,
    connections: all("SELECT * FROM connections ORDER BY id"),
    remote_profiles: all("SELECT * FROM remote_profiles ORDER BY id"),
    connection_groups: all("SELECT * FROM connection_groups ORDER BY sort_order,name"),
    forwards: all("SELECT * FROM connection_forwards ORDER BY id").map(row => ({...row, pid:null, status:"stopped", restore:0, reconnect_count:0, started_at:null})),
    forward_templates: all("SELECT * FROM forward_templates ORDER BY id"),
    command_snippets: all("SELECT * FROM command_snippets ORDER BY id"),
    named_workspaces: all("SELECT * FROM named_workspaces ORDER BY id")
  };
}

function restoreConfigSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.forwards) || !Array.isArray(snapshot.forward_templates)) throw new Error("配置快照格式无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM connection_forwards");
    run("DELETE FROM connections");
    run("DELETE FROM remote_profiles");
    run("DELETE FROM connection_groups");
    run("DELETE FROM forward_templates");
    run("DELETE FROM command_snippets");
    run("DELETE FROM named_workspaces");
    const groups = Array.isArray(snapshot.connection_groups) ? snapshot.connection_groups : [...new Set(snapshot.connections.map((row) => row.group_name))].map((name,index) => ({name,sort_order:index+1,created_at:now(),updated_at:now()}));
    for (const row of groups) run("INSERT INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [row.name,row.sort_order,row.created_at,row.updated_at]);
    for (const row of snapshot.connections) {
      const startupMode = TERMINAL_STARTUP_MODES.has(String(row.terminal_startup_mode || ""))
        ? String(row.terminal_startup_mode)
        : "default";
      const profileKind = TERMINAL_PROFILE_KINDS.has(String(row.terminal_profile_kind || ""))
        ? String(row.terminal_profile_kind)
        : "shell";
      const programPlatform = TERMINAL_PROGRAM_PLATFORMS.has(String(row.terminal_program_platform || ""))
        ? String(row.terminal_program_platform)
        : "auto";
      run(
        "INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,ssh_password,private_key_passphrase,ssh_agent_mode,jump_connection_id,connect_timeout_seconds,keepalive_interval_seconds,keepalive_count_max,tcp_keepalive,x11_mode,favorite,last_used_at,notifications_muted,tags,extra_args,autostart_forwards,sort_order,terminal_encoding,terminal_font_family,terminal_font_size,terminal_mobile_font_size,terminal_line_height,terminal_font_weight,terminal_startup_mode,terminal_profile_name,terminal_profile_kind,terminal_program_path,terminal_program_args,terminal_working_directory,terminal_program_platform,sftp_text_encoding,sftp_filename_encoding,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          row.id,
          row.name,
          row.group_name,
          row.ssh_host,
          row.ssh_port,
          row.ssh_user,
          row.auth_type || "key",
          row.identity_file,
          row.ssh_password || null,
          row.private_key_passphrase || null,
          new Set(["auto","off","required"]).has(row.ssh_agent_mode) ? row.ssh_agent_mode : "auto",
          row.jump_connection_id || null,
          Number(row.connect_timeout_seconds) || 10,
          Number.isInteger(Number(row.keepalive_interval_seconds)) ? Number(row.keepalive_interval_seconds) : 60,
          Number(row.keepalive_count_max) || 3,
          Number(row.tcp_keepalive ?? 1) ? 1 : 0,
          ["off","untrusted","trusted"].includes(String(row.x11_mode || "")) ? row.x11_mode : "off",
          Number(row.favorite || 0) ? 1 : 0,
          row.last_used_at || null,
          Number(row.notifications_muted || 0) ? 1 : 0,
          row.tags,
          row.extra_args,
          row.autostart_forwards,
          Number.isInteger(Number(row.sort_order)) && Number(row.sort_order) > 0 ? Number(row.sort_order) : 1,
          row.terminal_encoding || "utf8",
          row.terminal_font_family || DEFAULT_TERMINAL_FONT,
          Number(row.terminal_font_size) || 13,
          Number(row.terminal_mobile_font_size) || 13,
          Number(row.terminal_line_height) || 1,
          row.terminal_font_weight || "normal",
          startupMode,
          row.terminal_profile_name || "",
          profileKind,
          row.terminal_program_path || "",
          row.terminal_program_args || "",
          row.terminal_working_directory || "",
          programPlatform,
          row.sftp_text_encoding || "auto",
          row.sftp_filename_encoding || "utf8",
          row.created_at,
          row.updated_at
        ]
      );
    }
    for (const row of snapshot.remote_profiles || []) {
      const item = cleanRemoteProfile({
        ...row,
        password:row.password ? decryptText(row.password) : "",
        options:row.options_json
      });
      run("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        row.id,item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,row.last_used_at || null,item.tags,item.options_json,row.created_at || now(),row.updated_at || now()
      ]);
    }
    for (const row of snapshot.forwards) run("INSERT INTO connection_forwards(id,connection_id,mode,service_name,service_type,service_note,url_scheme,bind_host,bind_port,target_host,target_port,pid,status,restore,reconnect_count,last_error,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.connection_id,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.bind_host,row.bind_port,row.target_host,row.target_port,null,"stopped",0,0,row.last_error || null,null,row.created_at,row.updated_at]);
    for (const row of snapshot.forward_templates) run("INSERT INTO forward_templates(id,name,mode,service_name,service_type,service_note,url_scheme,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.bind_host,row.bind_port,row.target_host,row.target_port,row.created_at,row.updated_at]);
    for (const row of snapshot.command_snippets || []) run("INSERT INTO command_snippets(id,name,group_name,command,description,tags,favorite,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.group_name || "默认分组",row.command,row.description || "",row.tags || "",Number(row.favorite || 0) ? 1 : 0,row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
    for (const row of snapshot.named_workspaces || []) run("INSERT INTO named_workspaces(id,name,description,layout_json,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [row.id,row.name,row.description || "",row.layout_json || "{}",row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok:true, connections:snapshot.connections.length, remote_profiles:(snapshot.remote_profiles || []).length, forwards:snapshot.forwards.length, templates:snapshot.forward_templates.length, snippets:(snapshot.command_snippets || []).length, workspaces:(snapshot.named_workspaces || []).length };
}

ensureBuiltinForwardTemplates();

function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}

function reopenDatabase() {
  closeDatabase();
  openDatabase();
  ensureBuiltinForwardTemplates();
  return db;
}

function exportDatabaseFile(includePasswords = false) {
  const temporary = path.join(DATA_DIR, `database-export-${process.pid}-${Date.now()}.db`);
  let exportedDb = null;
  try {
    db.exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`);
    if (!includePasswords) {
      exportedDb = new DatabaseSync(temporary);
      const table = exportedDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'").get();
      if (table) {
        const columns = new Set(exportedDb.prepare("PRAGMA table_info(connections)").all().map((item) => item.name));
        if (columns.has("ssh_password")) exportedDb.exec("UPDATE connections SET ssh_password=NULL");
        if (columns.has("private_key_passphrase")) exportedDb.exec("UPDATE connections SET private_key_passphrase=NULL");
      }
      const remoteTable = exportedDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='remote_profiles'").get();
      if (remoteTable) exportedDb.exec("UPDATE remote_profiles SET password=NULL");
      exportedDb.close();
      exportedDb = null;
    }
    return {
      path: temporary,
      size: fs.statSync(temporary).size,
      cleanup() {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      }
    };
  } catch (error) {
    try { exportedDb?.close(); } catch {}
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function exportDatabaseBuffer(includePasswords = false) {
  const exported = exportDatabaseFile(includePasswords);
  try {
    return fs.readFileSync(exported.path);
  } finally {
    exported.cleanup();
  }
}

module.exports = {
  get db() { return db; },
  now,
  run,
  get,
  all,
  validatePort,
  validateSortOrder,
  pidRunning,
  cleanConnection,
  cleanTerminalStartup,
  cleanForward,
  listConnections,
  listRemoteProfiles,
  getRemoteProfile,
  insertRemoteProfile,
  createRemoteProfileFromConnection,
  createAllRemoteProfilesFromConnection,
  updateRemoteProfile,
  getVncProfileCredential,
  updateVncProfileCredential,
  duplicateRemoteProfile,
  deleteRemoteProfile,
  updateRemoteProfileUsage,
  updateRemoteProfileFlags,
  getConnection,
  getForward,
  insertConnection,
  duplicateConnection,
  updateConnection,
  updateConnectionUsage,
  updateConnectionFlags,
  updateTerminalPreferences,
  updateTerminalStartup,
  updateConnectionX11Mode,
  updateSftpTextEncoding,
  updateSftpFilenameEncoding,
  bulkUpdateConnections,
  renameConnectionGroup,
  reorderConnectionGroups,
  encryptStoredConnectionSecrets,
  decryptStoredConnectionSecrets,
  insertForward,
  updateForward,
  deleteConnection,
  deleteForward,
  listCommandSnippets,
  insertCommandSnippet,
  updateCommandSnippet,
  deleteCommandSnippet,
  useCommandSnippet,
  listNamedWorkspaces,
  insertNamedWorkspace,
  updateNamedWorkspace,
  duplicateNamedWorkspace,
  useNamedWorkspace,
  deleteNamedWorkspace,
  listForwardTemplates,
  insertForwardTemplate,
  updateForwardTemplate,
  deleteForwardTemplate,
  getForwardTemplate,
  applyForwardTemplate,
  exportConfigSnapshot,
  restoreConfigSnapshot,
  ensureBuiltinForwardTemplates,
  closeDatabase,
  reopenDatabase,
  exportDatabaseFile,
  exportDatabaseBuffer
};
