const fs = require("node:fs");
const { decryptText, encryptText, requireEncryptionUnlocked } = require("../crypto-store");
const { allowedIdentityPath, assertAllowedIdentityPath } = require("../identity-path");
const { assertSafeExtraArgs, builtinSshExtraOptions } = require("../ssh-command");
const { validateSshHost, validateSshUser } = require("../ssh-connection");
const databaseCore = require("./core");
const { get, now, run } = databaseCore;
function validatePort(value: any, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} 必须在 1-65535 之间`);
  }
  return port;
}

function validateSortOrder(value: any): number {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1 || order > 2147483647) {
    throw new Error("排序值必须是 1-2147483647 之间的整数");
  }
  return order;
}

function boundedInteger(value: any, fallback: any, minimum: number, maximum: number, label: string): number {
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

function cleanTerminalPreferences(data: any, existing: any = null): any {
  const supplied = (key: string) => Object.prototype.hasOwnProperty.call(data || {}, key);
  const inheritFlag = (key: string, valueKey: string) => {
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

  const readValue = (key: string, fallback: any = "") => {
    if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
    const value = existing?.[key] ?? fallback;
    return ["terminal_program_path", "terminal_program_args", "terminal_working_directory"].includes(key)
      ? decryptText(value)
      : value;
  };
  const singleLine = (key: string, label: string, maximum: number, fallback: any = "") => {
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

function cleanSftpTextEncoding(value: any, fallback: any = "auto"): string {
  const encoding = String(value ?? fallback ?? "auto").toLowerCase();
  if (!SFTP_TEXT_ENCODINGS.has(encoding)) throw new Error("不支持的 SFTP 文本编码");
  return encoding;
}

function cleanSftpFilenameEncoding(value: any, fallback: any = "utf8"): string {
  const encoding = String(value ?? fallback ?? "utf8").toLowerCase();
  if (!SFTP_FILENAME_ENCODINGS.has(encoding)) throw new Error("不支持的 SFTP 文件名编码");
  return encoding;
}

function ensureConnectionGroup(name: any): void {
  const groupName = String(name || "").trim();
  if (!groupName) return;
  const next = Number(get("SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM connection_groups")?.value || 1);
  run("INSERT OR IGNORE INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [groupName, next, now(), now()]);
}

function pidRunning(pid: any): boolean {
  if (typeof pid === "boolean" || Array.isArray(pid)) return false;
  const id = Number(pid);
  if (!Number.isSafeInteger(id) || id <= 1) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

function cleanConnection(data: any, defaultExtraArgs: any, existing: any = null): any {
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
    tags: String(data.tags || "").split(/[,，\s]+/).map((item: string) => item.trim()).filter(Boolean).join(","),
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
module.exports = {
  DEFAULT_TERMINAL_FONT,
  TERMINAL_PROFILE_KINDS,
  TERMINAL_PROGRAM_PLATFORMS,
  TERMINAL_STARTUP_MODES,
  allowedIdentityPath,
  assertAllowedIdentityPath,
  boundedInteger,
  cleanConnection,
  cleanSftpFilenameEncoding,
  cleanSftpTextEncoding,
  cleanTerminalPreferences,
  cleanTerminalStartup,
  ensureConnectionGroup,
  pidRunning,
  validatePort,
  validateSortOrder
};
