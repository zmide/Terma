const crypto = require("node:crypto");
const { splitArgs } = require("./ssh-command");

const STARTUP_MODES = new Set(["default", "program"]);
const STARTUP_KINDS = new Set(["shell", "repl", "session", "tool", "custom"]);
const STARTUP_PLATFORMS = new Set(["auto", "posix", "windows"]);
const STARTUP_TICKET_TTL_MS = 45 * 1000;
type TerminalStartupMode = "default" | "program";
type TerminalStartupKind = "shell" | "repl" | "session" | "tool" | "custom";
type TerminalStartupPlatform = "auto" | "posix" | "windows";

interface TerminalStartupConfig {
  terminal_startup_mode: TerminalStartupMode;
  terminal_profile_name: string;
  terminal_profile_kind: TerminalStartupKind;
  terminal_program_path: string;
  terminal_program_args: string;
  terminal_working_directory: string;
  terminal_program_platform: TerminalStartupPlatform;
}

interface StartupTicket {
  connection_id: number;
  startup: TerminalStartupConfig;
  expires_at: number;
}

const startupTickets = new Map<string, StartupTicket>();

function cleanStartupText(value: unknown, label: string, maximumLength: number): string {
  const text = String(value || "").trim();
  if (text.includes("\0") || /[\r\n]/.test(text)) throw new Error(`${label} 只能填写一行，且不能包含空字符`);
  if (text.length > maximumLength) throw new Error(`${label} 不能超过 ${maximumLength} 个字符`);
  return text;
}

function normalizeTerminalStartup(value: any = {}): TerminalStartupConfig {
  const mode: TerminalStartupMode = STARTUP_MODES.has(String(value?.terminal_startup_mode || ""))
    ? value.terminal_startup_mode
    : "default";
  const kind: TerminalStartupKind = STARTUP_KINDS.has(String(value?.terminal_profile_kind || ""))
    ? value.terminal_profile_kind
    : "custom";
  const platform: TerminalStartupPlatform = STARTUP_PLATFORMS.has(String(value?.terminal_program_platform || ""))
    ? value.terminal_program_platform
    : "auto";
  const normalized = {
    terminal_startup_mode: mode,
    terminal_profile_name: cleanStartupText(value.terminal_profile_name, "配置名称", 120),
    terminal_profile_kind: kind,
    terminal_program_path: cleanStartupText(value.terminal_program_path, "程序路径", 2048),
    terminal_program_args: cleanStartupText(value.terminal_program_args, "启动参数", 4096),
    terminal_working_directory: cleanStartupText(value.terminal_working_directory, "工作目录", 2048),
    terminal_program_platform: platform
  };
  if (normalized.terminal_startup_mode === "default") {
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
  if (!normalized.terminal_program_path) throw new Error("请选择启动配置，或填写程序完整路径");
  return normalized;
}

function posixQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inferredStartupPlatform(config: TerminalStartupConfig): Exclude<TerminalStartupPlatform, "auto"> {
  if (config.terminal_program_platform !== "auto") return config.terminal_program_platform;
  const executable = String(config.terminal_program_path || "");
  if (/^[A-Za-z]:[\\/]/.test(executable) || executable.includes("\\") || /\.(?:exe|cmd|bat|ps1)$/i.test(executable)) return "windows";
  return "posix";
}

function buildPosixStartupCommand(config: TerminalStartupConfig): string {
  const executable = posixQuote(config.terminal_program_path);
  const args = splitArgs(config.terminal_program_args).map(posixQuote);
  const launch = ["exec", executable, ...args].join(" ");
  return config.terminal_working_directory
    ? `cd -- ${posixQuote(config.terminal_working_directory)} && ${launch}`
    : launch;
}

function buildWindowsStartupCommand(config: TerminalStartupConfig): string {
  const executable = powershellQuote(config.terminal_program_path);
  const args = splitArgs(config.terminal_program_args).map(powershellQuote);
  const commands = [
    "$ErrorActionPreference='Stop'",
    ...(config.terminal_working_directory
      ? [`Set-Location -LiteralPath ${powershellQuote(config.terminal_working_directory)}`]
      : []),
    `& ${executable}${args.length ? ` ${args.join(" ")}` : ""}`,
    "exit $LASTEXITCODE"
  ];
  const script = `& { ${commands.join("; ")} }`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `powershell.exe -NoLogo -NoProfile -EncodedCommand ${encoded}`;
}

function buildRemoteStartupCommand(value: any = {}): string {
  const config = normalizeTerminalStartup(value);
  if (config.terminal_startup_mode === "default") return "";
  return inferredStartupPlatform(config) === "windows"
    ? buildWindowsStartupCommand(config)
    : buildPosixStartupCommand(config);
}

function mergeTerminalStartup(connection: any, override: any = null): any {
  if (!override) return { ...connection, ...normalizeTerminalStartup(connection) };
  return { ...connection, ...normalizeTerminalStartup(override) };
}

function purgeExpiredStartupTickets(now = Date.now()): void {
  for (const [token, item] of startupTickets) {
    if (item.expires_at <= now) startupTickets.delete(token);
  }
}

function createTerminalStartupTicket(connectionId: unknown, override: unknown): { token: string; expires_at: number } {
  const id = Number(connectionId);
  if (!Number.isInteger(id) || id < 1) throw new Error("连接 ID 无效");
  const startup = normalizeTerminalStartup(override);
  purgeExpiredStartupTickets();
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + STARTUP_TICKET_TTL_MS;
  startupTickets.set(token, { connection_id: id, startup, expires_at: expiresAt });
  return { token, expires_at: expiresAt };
}

function consumeTerminalStartupTicket(token: unknown, connectionId: unknown): TerminalStartupConfig | null {
  const cleanToken = String(token || "");
  if (!cleanToken) return null;
  purgeExpiredStartupTickets();
  const item = startupTickets.get(cleanToken);
  startupTickets.delete(cleanToken);
  if (!item || item.connection_id !== Number(connectionId)) throw new Error("终端临时启动配置已失效，请重新连接");
  return item.startup;
}

module.exports = {
  buildRemoteStartupCommand,
  consumeTerminalStartupTicket,
  createTerminalStartupTicket,
  inferredStartupPlatform,
  mergeTerminalStartup,
  normalizeTerminalStartup,
  purgeExpiredStartupTickets
};
