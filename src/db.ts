const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DATA_DIR } = require("./config");
const {
  decryptText,
  encryptionState,
  encryptText,
  isCurrentEncryptedText,
  isEncryptedText,
  requireEncryptionUnlocked
} = require("./crypto-store");
const { allowedIdentityPath, assertAllowedIdentityPath } = require("./identity-path");
const { assertSafeExtraArgs, builtinSshExtraOptions } = require("./ssh-command");
const { validateSshHost, validateSshUser } = require("./ssh-connection");
const databaseCore = require("./database/core");
const { createConnectionRepository } = require("./database/connection-repository");
const { createForwardRepository } = require("./database/forward-repository");
const { createProductivityRepository } = require("./database/productivity-repository");
const { createRemoteProfileRepository } = require("./database/remote-profile-repository");
const { all, get, now, run } = databaseCore;
const db = {
  exec(sql) { return databaseCore.getDatabase().exec(sql); },
  prepare(sql) { return databaseCore.getDatabase().prepare(sql); }
};

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
  const supplied = key => Object.prototype.hasOwnProperty.call(data || {}, key);
  const inheritFlag = (key, valueKey) => {
    if (supplied(key)) return Number(data[key]) ? 1 : 0;
    if (supplied(valueKey)) return 0;
    if (existing) return Number(existing[key] ?? 1) ? 1 : 0;
    return 1;
  };
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
    terminal_font_family_inherit: inheritFlag("terminal_font_family_inherit", "terminal_font_family"),
    terminal_font_size: terminalFontSize,
    terminal_font_size_inherit: inheritFlag("terminal_font_size_inherit", "terminal_font_size"),
    terminal_mobile_font_size: terminalMobileFontSize,
    terminal_mobile_font_size_inherit: inheritFlag("terminal_mobile_font_size_inherit", "terminal_mobile_font_size"),
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
  requireEncryptionUnlocked();
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
  const extraArgsContext = {
    connect_timeout_seconds:data.connect_timeout_seconds ?? existing?.connect_timeout_seconds ?? 10,
    keepalive_interval_seconds:data.keepalive_interval_seconds ?? existing?.keepalive_interval_seconds ?? 60,
    keepalive_count_max:data.keepalive_count_max ?? existing?.keepalive_count_max ?? 3,
    tcp_keepalive:data.tcp_keepalive ?? existing?.tcp_keepalive ?? 1
  };
  assertSafeExtraArgs(extraArgs, extraArgsContext);
  const builtinExtra = builtinSshExtraOptions(extraArgs, extraArgsContext);
  if (authType === "password" && !builtinExtra.supported) {
    throw new Error(`密码 SSH 不能使用仅由系统 OpenSSH 支持的附加参数：${builtinExtra.unsupported}`);
  }
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

let forwardRepository: any = null;

const connectionRepository = createConnectionRepository({
  all,
  get,
  run,
  now,
  exec:(sql) => db.exec(sql),
  decryptText,
  encryptText,
  requireEncryptionUnlocked,
  cleanConnection,
  cleanTerminalPreferences,
  cleanTerminalStartup,
  cleanSftpTextEncoding,
  cleanSftpFilenameEncoding,
  ensureConnectionGroup,
  insertForward:(connectionId, data) => forwardRepository.insertForward(connectionId, data),
  validatePort,
  assertAllowedIdentityPath,
  allowedIdentityPath,
  pidRunning
});

forwardRepository = createForwardRepository({
  all,
  get,
  run,
  now,
  validatePort,
  getConnection:(id) => connectionRepository.getConnection(id)
});

const remoteProfileRepository = createRemoteProfileRepository({
  all,
  get,
  run,
  now,
  exec:(sql) => db.exec(sql),
  decryptText,
  encryptText,
  requireEncryptionUnlocked,
  ensureConnectionGroup,
  getConnection:(id) => connectionRepository.getConnection(id),
  validatePort,
  boundedInteger
});

const productivityRepository = createProductivityRepository({ all, get, run, now });

function cleanForward(data) { return forwardRepository.cleanForward(data); }
function listConnections() { return connectionRepository.listConnections(); }
function getConnection(id) { return connectionRepository.getConnection(id); }
function getForward(id) { return forwardRepository.getForward(id); }
function insertConnection(data, defaultExtraArgs) { return connectionRepository.insertConnection(data, defaultExtraArgs); }
function duplicateConnection(id, defaultExtraArgs) { return connectionRepository.duplicateConnection(id, defaultExtraArgs); }
function updateConnection(id, data, defaultExtraArgs) { return connectionRepository.updateConnection(id, data, defaultExtraArgs); }
function updateConnectionUsage(id, action = "open") { return connectionRepository.updateConnectionUsage(id, action); }
function updateConnectionFlags(id, data = {}) { return connectionRepository.updateConnectionFlags(id, data); }
function updateTerminalPreferences(id, data) { return connectionRepository.updateTerminalPreferences(id, data); }
function updateTerminalStartup(id, data) { return connectionRepository.updateTerminalStartup(id, data); }
function updateConnectionX11Mode(id, value) { return connectionRepository.updateConnectionX11Mode(id, value); }
function updateSftpTextEncoding(id, value) { return connectionRepository.updateSftpTextEncoding(id, value); }
function updateSftpFilenameEncoding(id, value) { return connectionRepository.updateSftpFilenameEncoding(id, value); }
function bulkUpdateConnections(connectionIds, changes = {}) { return connectionRepository.bulkUpdateConnections(connectionIds, changes); }
function renameConnectionGroup(currentName, nextName) { return connectionRepository.renameConnectionGroup(currentName, nextName); }
function reorderConnectionGroups(names) { return connectionRepository.reorderConnectionGroups(names); }
function deleteConnection(id, stopForward) { return connectionRepository.deleteConnection(id, stopForward); }

function insertForward(connectionId, data) { return forwardRepository.insertForward(connectionId, data); }
function updateForward(id, data) { return forwardRepository.updateForward(id, data); }
function deleteForward(id, stopForward) { return forwardRepository.deleteForward(id, stopForward); }
function listForwardTemplates() { return forwardRepository.listForwardTemplates(); }
function insertForwardTemplate(data) { return forwardRepository.insertForwardTemplate(data); }
function updateForwardTemplate(id, data) { return forwardRepository.updateForwardTemplate(id, data); }
function deleteForwardTemplate(id) { return forwardRepository.deleteForwardTemplate(id); }
function getForwardTemplate(id) { return forwardRepository.getForwardTemplate(id); }
function applyForwardTemplate(templateId, connectionIds) { return forwardRepository.applyForwardTemplate(templateId, connectionIds); }
function ensureBuiltinForwardTemplates() { return forwardRepository.ensureBuiltinForwardTemplates(); }

function cleanRemoteProfile(data, existing = null) { return remoteProfileRepository.cleanRemoteProfile(data, existing); }
function listRemoteProfiles() { return remoteProfileRepository.listRemoteProfiles(); }
function getRemoteProfile(id) { return remoteProfileRepository.getRemoteProfile(id); }
function insertRemoteProfile(data) { return remoteProfileRepository.insertRemoteProfile(data); }
function createRemoteProfileFromConnection(connectionId, protocol) { return remoteProfileRepository.createRemoteProfileFromConnection(connectionId, protocol); }
function createAllRemoteProfilesFromConnection(connectionId) { return remoteProfileRepository.createAllRemoteProfilesFromConnection(connectionId); }
function updateRemoteProfile(id, data) { return remoteProfileRepository.updateRemoteProfile(id, data); }
function getVncProfileCredential(id) { return remoteProfileRepository.getVncProfileCredential(id); }
function updateVncProfileCredential(id, value) { return remoteProfileRepository.updateVncProfileCredential(id, value); }
function duplicateRemoteProfile(id) { return remoteProfileRepository.duplicateRemoteProfile(id); }
function deleteRemoteProfile(id) { return remoteProfileRepository.deleteRemoteProfile(id); }
function updateRemoteProfileUsage(id) { return remoteProfileRepository.updateRemoteProfileUsage(id); }
function updateRemoteProfileFlags(id, data) { return remoteProfileRepository.updateRemoteProfileFlags(id, data); }

function listCommandSnippets() { return productivityRepository.listCommandSnippets(); }
function insertCommandSnippet(data) { return productivityRepository.insertCommandSnippet(data); }
function updateCommandSnippet(id, data) { return productivityRepository.updateCommandSnippet(id, data); }
function deleteCommandSnippet(id) { return productivityRepository.deleteCommandSnippet(id); }
function useCommandSnippet(id) { return productivityRepository.useCommandSnippet(id); }
function listNamedWorkspaces() { return productivityRepository.listNamedWorkspaces(); }
function insertNamedWorkspace(data) { return productivityRepository.insertNamedWorkspace(data); }
function updateNamedWorkspace(id, data) { return productivityRepository.updateNamedWorkspace(id, data); }
function duplicateNamedWorkspace(id) { return productivityRepository.duplicateNamedWorkspace(id); }
function useNamedWorkspace(id) { return productivityRepository.useNamedWorkspace(id); }
function deleteNamedWorkspace(id) { return productivityRepository.deleteNamedWorkspace(id); }

function rewriteConnectionSecrets(transform) {
  db.exec("BEGIN IMMEDIATE");
  try {
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
    const tunnelRows = all("SELECT id,identity_file,extra_args FROM tunnels");
    const updateTunnel = db.prepare("UPDATE tunnels SET identity_file=?,extra_args=?,updated_at=? WHERE id=?");
    for (const row of tunnelRows) {
      const identityFile = row.identity_file ? transform(row.identity_file) : row.identity_file;
      const extraArgs = row.extra_args ? transform(row.extra_args) : row.extra_args;
      if (identityFile !== row.identity_file || extraArgs !== row.extra_args) {
        updateTunnel.run(identityFile, extraArgs, now(), row.id);
        changed += 1;
      }
    }
    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function encryptStoredConnectionSecrets() {
  return rewriteConnectionSecrets((value) => {
    if (isCurrentEncryptedText(value)) return value;
    return isEncryptedText(value) ? encryptText(decryptText(value)) : encryptText(value);
  });
}

function decryptStoredConnectionSecrets() {
  return rewriteConnectionSecrets((value) => isEncryptedText(value) ? decryptText(value) : value);
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

const SNAPSHOT_CONNECTION_SECRET_COLUMNS = [
  "identity_file",
  "ssh_password",
  "private_key_passphrase",
  "extra_args",
  "terminal_program_path",
  "terminal_program_args",
  "terminal_working_directory"
];

function normalizeSnapshotSecret(value, label, state) {
  if (value == null || value === "") return value;
  if (!state.enabled) {
    if (isEncryptedText(value)) throw new Error(`配置快照包含当前实例无法解密的字段：${label}`);
    return value;
  }
  let plain = value;
  if (isEncryptedText(value)) {
    try {
      plain = decryptText(value);
    } catch {
      throw new Error(`配置快照包含无法使用当前主密钥验证的字段：${label}`);
    }
  }
  return encryptText(plain);
}

function restoreConfigSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.forwards) || !Array.isArray(snapshot.forward_templates)) throw new Error("配置快照格式无效");
  const state = encryptionState();
  if (state.enabled) requireEncryptionUnlocked();
  const restoredConnections = snapshot.connections.map((source) => {
    const row = { ...source };
    for (const column of SNAPSHOT_CONNECTION_SECRET_COLUMNS) {
      row[column] = normalizeSnapshotSecret(row[column], `connections.${column}`, state);
    }
    return row;
  });
  const restoredRemoteProfiles = (snapshot.remote_profiles || []).map((source) => ({
    ...source,
    password:normalizeSnapshotSecret(source.password, "remote_profiles.password", state)
  }));
  db.exec("BEGIN IMMEDIATE");
  try {
    run("DELETE FROM connection_forwards");
    run("DELETE FROM connections");
    run("DELETE FROM remote_profiles");
    run("DELETE FROM connection_groups");
    run("DELETE FROM forward_templates");
    run("DELETE FROM command_snippets");
    run("DELETE FROM named_workspaces");
    const groups = Array.isArray(snapshot.connection_groups) ? snapshot.connection_groups : [...new Set(restoredConnections.map((row) => row.group_name))].map((name,index) => ({name,sort_order:index+1,created_at:now(),updated_at:now()}));
    for (const row of groups) run("INSERT INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [row.name,row.sort_order,row.created_at,row.updated_at]);
    for (const row of restoredConnections) {
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
        "INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,ssh_password,private_key_passphrase,ssh_agent_mode,jump_connection_id,connect_timeout_seconds,keepalive_interval_seconds,keepalive_count_max,tcp_keepalive,x11_mode,favorite,last_used_at,notifications_muted,tags,extra_args,autostart_forwards,sort_order,terminal_encoding,terminal_font_family,terminal_font_family_inherit,terminal_font_size,terminal_font_size_inherit,terminal_mobile_font_size,terminal_mobile_font_size_inherit,terminal_line_height,terminal_font_weight,terminal_startup_mode,terminal_profile_name,terminal_profile_kind,terminal_program_path,terminal_program_args,terminal_working_directory,terminal_program_platform,sftp_text_encoding,sftp_filename_encoding,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          Number(row.terminal_font_family_inherit ?? (row.terminal_font_family && row.terminal_font_family !== DEFAULT_TERMINAL_FONT ? 0 : 1)) ? 1 : 0,
          Number(row.terminal_font_size) || 13,
          Number(row.terminal_font_size_inherit ?? (Number(row.terminal_font_size || 13) === 13 ? 1 : 0)) ? 1 : 0,
          Number(row.terminal_mobile_font_size) || 13,
          Number(row.terminal_mobile_font_size_inherit ?? (Number(row.terminal_mobile_font_size || 13) === 13 ? 1 : 0)) ? 1 : 0,
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
    for (const row of restoredRemoteProfiles) {
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
  return { ok:true, connections:restoredConnections.length, remote_profiles:restoredRemoteProfiles.length, forwards:snapshot.forwards.length, templates:snapshot.forward_templates.length, snippets:(snapshot.command_snippets || []).length, workspaces:(snapshot.named_workspaces || []).length };
}

ensureBuiltinForwardTemplates();

function closeDatabase() {
  databaseCore.closeDatabase();
}

function reopenDatabase() {
  databaseCore.reopenDatabase();
  ensureBuiltinForwardTemplates();
  return databaseCore.getDatabase();
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
  get db() { return databaseCore.getDatabase(); },
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
