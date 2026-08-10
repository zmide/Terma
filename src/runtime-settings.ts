const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_LISTEN_HOSTS = ["127.0.0.1"];
const DEFAULT_LISTEN_PORT = 8088;
const MAX_PORT_FALLBACKS = 20;
const DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB = 50;
const DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT = Object.freeze({
  unsplit: Object.freeze({ terminal: "header", sftp: "header" }),
  split: Object.freeze({ terminal: "header", sftp: "header" })
});
const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  font_family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  font_size: 13,
  background_mode: "theme",
  background_color: "#0f1720",
  middle_mouse_action: "paste_clipboard",
  right_mouse_action: "context_menu",
  ctrl_left_click_moves_cursor: true,
  url_links_enabled: true,
  url_prefixes: ["http://", "https://", "ftp://", "ssh://", "telnet://"],
  url_ctrl_click: true,
  word_separators: " ()[]{}',\"`",
  shift_double_click_uses_separators: false,
  auto_copy_selection: false,
  copy_tabs_to_spaces: false,
  copy_include_trailing_newline: false,
  copy_trim_trailing_spaces: false,
  select_non_whitespace_block: false,
  multiline_paste_mode: "prompt"
});
const TERMINAL_MOUSE_ACTIONS = new Set(["none", "context_menu", "paste_clipboard", "open_settings", "send_enter", "paste_selection"]);
const TERMINAL_MULTILINE_PASTE_MODES = new Set(["prompt", "paste", "single_line"]);
const TERMINAL_URL_SCHEMES = new Set(["http", "https", "ftp", "ssh", "telnet"]);
const TERMINAL_BACKGROUND_MODES = new Set(["theme", "black", "white", "custom"]);
const WORKSPACE_TOOLBAR_PLACEMENTS = new Set(["tab", "header"]);

function splitListenHosts(value) {
  const source = Array.isArray(value) ? value : [value];
  return source.flatMap(item => String(item ?? "").split(/[\s,]+/)).map(item => item.trim()).filter(Boolean);
}

function normalizeListenHosts(value, fallback: any = DEFAULT_LISTEN_HOSTS) {
  const hosts = [...new Set(splitListenHosts(value))];
  if (!hosts.length) {
    if (fallback === null) throw new Error("请至少选择一个监听地址");
    return normalizeListenHosts(fallback, null);
  }
  for (const host of hosts) {
    if (net.isIP(host) !== 4) throw new Error(`监听地址必须是 IPv4 地址：${host}`);
  }
  return hosts.includes("0.0.0.0") ? ["0.0.0.0"] : hosts;
}

function normalizeListenPort(value, fallback: any = DEFAULT_LISTEN_PORT) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (fallback === null) throw new Error("监听端口不能为空");
    return normalizeListenPort(fallback, null);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须是 1-65535 的整数");
  return port;
}

function normalizeTerminalUrlPrefixes(value, fallback: any = DEFAULT_TERMINAL_SETTINGS.url_prefixes) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[|,\s]+/);
  const prefixes = [...new Set(source.map(item => String(item || "").trim()).filter(Boolean))];
  const normalized = prefixes.filter(prefix => {
    const match = prefix.match(/^([a-z][a-z0-9+.-]*):\/\/$/i);
    return Boolean(match && TERMINAL_URL_SCHEMES.has(match[1].toLowerCase()));
  }).slice(0, 10);
  if (normalized.length) return normalized;
  return Array.isArray(fallback) ? [...fallback] : [...DEFAULT_TERMINAL_SETTINGS.url_prefixes];
}

function normalizeTerminalSettings(value: any = {}, fallback: any = DEFAULT_TERMINAL_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_TERMINAL_SETTINGS;
  const middleMouseAction = String(source.middle_mouse_action ?? base.middle_mouse_action ?? DEFAULT_TERMINAL_SETTINGS.middle_mouse_action);
  const rightMouseAction = String(source.right_mouse_action ?? base.right_mouse_action ?? DEFAULT_TERMINAL_SETTINGS.right_mouse_action);
  const multilinePasteMode = String(source.multiline_paste_mode ?? base.multiline_paste_mode ?? DEFAULT_TERMINAL_SETTINGS.multiline_paste_mode);
  const backgroundMode = String(source.background_mode ?? base.background_mode ?? DEFAULT_TERMINAL_SETTINGS.background_mode);
  const backgroundColorValue = String(source.background_color ?? base.background_color ?? DEFAULT_TERMINAL_SETTINGS.background_color).trim();
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(backgroundColorValue)
    ? backgroundColorValue.toLowerCase()
    : DEFAULT_TERMINAL_SETTINGS.background_color;
  const wordSeparators = String(source.word_separators ?? base.word_separators ?? DEFAULT_TERMINAL_SETTINGS.word_separators).slice(0, 128);
  const fontFamily = String(source.font_family ?? base.font_family ?? DEFAULT_TERMINAL_SETTINGS.font_family).trim();
  const fontSize = Number(source.font_size ?? base.font_size ?? DEFAULT_TERMINAL_SETTINGS.font_size);
  if (!fontFamily || fontFamily.length > 300 || /[\0\r\n]/.test(fontFamily)) {
    throw new Error("默认终端字体长度必须在 1-300 个字符之间，且不能包含换行");
  }
  if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 32) {
    throw new Error("默认终端字号必须是 10-32 之间的整数");
  }
  return {
    font_family:fontFamily,
    font_size:fontSize,
    background_mode: TERMINAL_BACKGROUND_MODES.has(backgroundMode) ? backgroundMode : DEFAULT_TERMINAL_SETTINGS.background_mode,
    background_color: backgroundColor,
    middle_mouse_action: TERMINAL_MOUSE_ACTIONS.has(middleMouseAction) ? middleMouseAction : DEFAULT_TERMINAL_SETTINGS.middle_mouse_action,
    right_mouse_action: TERMINAL_MOUSE_ACTIONS.has(rightMouseAction) ? rightMouseAction : DEFAULT_TERMINAL_SETTINGS.right_mouse_action,
    ctrl_left_click_moves_cursor: source.ctrl_left_click_moves_cursor === undefined ? base.ctrl_left_click_moves_cursor !== false : source.ctrl_left_click_moves_cursor === true,
    url_links_enabled: source.url_links_enabled === undefined ? base.url_links_enabled === true : source.url_links_enabled === true,
    url_prefixes: normalizeTerminalUrlPrefixes(source.url_prefixes, base.url_prefixes),
    url_ctrl_click: source.url_ctrl_click === undefined ? base.url_ctrl_click !== false : source.url_ctrl_click === true,
    word_separators: wordSeparators || DEFAULT_TERMINAL_SETTINGS.word_separators,
    shift_double_click_uses_separators: source.shift_double_click_uses_separators === undefined ? base.shift_double_click_uses_separators === true : source.shift_double_click_uses_separators === true,
    auto_copy_selection: source.auto_copy_selection === undefined ? base.auto_copy_selection !== false : source.auto_copy_selection === true,
    copy_tabs_to_spaces: source.copy_tabs_to_spaces === undefined ? base.copy_tabs_to_spaces === true : source.copy_tabs_to_spaces === true,
    copy_include_trailing_newline: source.copy_include_trailing_newline === undefined ? base.copy_include_trailing_newline !== false : source.copy_include_trailing_newline === true,
    copy_trim_trailing_spaces: source.copy_trim_trailing_spaces === undefined ? base.copy_trim_trailing_spaces === true : source.copy_trim_trailing_spaces === true,
    select_non_whitespace_block: source.select_non_whitespace_block === undefined ? base.select_non_whitespace_block === true : source.select_non_whitespace_block === true,
    multiline_paste_mode: TERMINAL_MULTILINE_PASTE_MODES.has(multilinePasteMode) ? multilinePasteMode : DEFAULT_TERMINAL_SETTINGS.multiline_paste_mode
  };
}

function normalizeWorkspaceToolbarPlacement(value: any = {}, fallback: any = DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT;
  const normalizePlacement = (candidate, defaultValue) => {
    const placement = String(candidate ?? defaultValue ?? "header");
    return WORKSPACE_TOOLBAR_PLACEMENTS.has(placement) ? placement : "header";
  };
  return {
    unsplit: {
      terminal: normalizePlacement(source.unsplit?.terminal, base.unsplit?.terminal),
      sftp: normalizePlacement(source.unsplit?.sftp, base.unsplit?.sftp)
    },
    split: {
      terminal: normalizePlacement(source.split?.terminal, base.split?.terminal),
      sftp: normalizePlacement(source.split?.sftp, base.split?.sftp)
    }
  };
}

function normalizeRuntimeSettings(value: any = {}, fallback: any = {}) {
  const hostsValue = value.listen_hosts !== undefined ? value.listen_hosts
    : (value.hosts !== undefined ? value.hosts : value.host);
  const portValue = value.listen_port !== undefined ? value.listen_port : value.port;
  return {
    schema_version: 9,
    listen_hosts: normalizeListenHosts(hostsValue, hostsValue === undefined ? (fallback.listen_hosts ?? DEFAULT_LISTEN_HOSTS) : null),
    listen_port: normalizeListenPort(portValue, portValue === undefined ? (fallback.listen_port ?? DEFAULT_LISTEN_PORT) : null),
    sftp_recycle_bin_enabled: value.sftp_recycle_bin_enabled === undefined
      ? fallback.sftp_recycle_bin_enabled === true
      : value.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: value.sftp_floating_progress_enabled === undefined
      ? fallback.sftp_floating_progress_enabled !== false
      : value.sftp_floating_progress_enabled !== false,
    sftp_max_open_file_size_mb: normalizeSftpMaxOpenFileSize(
      value.sftp_max_open_file_size_mb,
      fallback.sftp_max_open_file_size_mb
    ),
    sftp_download_directory: normalizeSftpDownloadDirectory(
      value.sftp_download_directory,
      fallback.sftp_download_directory
    ),
    restore_workspace_tabs: value.restore_workspace_tabs === undefined
      ? fallback.restore_workspace_tabs !== false
      : value.restore_workspace_tabs !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(
      value.workspace_toolbar_placement,
      fallback.workspace_toolbar_placement
    ),
    terminal: normalizeTerminalSettings(value.terminal, fallback.terminal)
  };
}

function normalizeSftpDownloadDirectory(value, fallback = "") {
  const directory = String(value === undefined || value === null ? (fallback || "") : value).trim();
  if (directory.includes("\0") || directory.length > 4096) throw new Error("SFTP 下载目录无效");
  return directory;
}

function normalizeSftpMaxOpenFileSize(value, fallback = DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const size = Number(candidate);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("SFTP 文件打开上限必须是 1-100 MB 的整数");
  return size;
}

function readRuntimeSettings(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Number(parsed.schema_version || 0) < 8 && Number(parsed.sftp_max_open_file_size_mb) === 5) {
      parsed.sftp_max_open_file_size_mb = DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB;
    }
    return normalizeRuntimeSettings(parsed);
  } catch {
    return normalizeRuntimeSettings();
  }
}

function writeRuntimeSettings(filePath, value) {
  const normalized = normalizeRuntimeSettings(value);
  const result = { ...normalized, updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return result;
}

function resolveRuntimeSettings(filePath, env: any = process.env) {
  const persisted = readRuntimeSettings(filePath);
  let listenHosts = persisted.listen_hosts;
  let listenPort = persisted.listen_port;
  let hostsSource = fs.existsSync(filePath) ? "file" : "default";
  let portSource = hostsSource;
  const envHosts = String(env.TUNNEL_WEB_HOSTS || env.TUNNEL_WEB_HOST || "").trim();
  const envPort = String(env.TUNNEL_WEB_PORT || "").trim();
  if (envHosts) {
    listenHosts = normalizeListenHosts(envHosts, null);
    hostsSource = "env";
  }
  if (envPort) {
    listenPort = normalizeListenPort(envPort, null);
    portSource = "env";
  }
  return {
    listen_hosts: listenHosts,
    listen_port: listenPort,
    sources: { listen_hosts: hostsSource, listen_port: portSource }
  };
}

function isLoopbackHost(host) {
  const parts = String(host || "").split(".").map(Number);
  return parts.length === 4 && parts[0] === 127 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
}

function availableListenHosts(interfaces: any = os.networkInterfaces()) {
  const out: any[] = [
    { address: "127.0.0.1", interface: "loopback", label: "仅本机", internal: true },
    { address: "0.0.0.0", interface: "all", label: "所有 IPv4 网卡", wildcard: true, internal: false }
  ];
  const seen = new Set(out.map(item => item.address));
  for (const [name, items] of Object.entries(interfaces || {}) as any) {
    for (const item of items || []) {
      if (item.family !== "IPv4" || item.internal || seen.has(item.address)) continue;
      seen.add(item.address);
      out.push({ address: item.address, interface: name, label: `${name} · ${item.address}`, internal: false });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_TERMINAL_SETTINGS,
  DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT,
  DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB,
  DEFAULT_LISTEN_HOSTS,
  DEFAULT_LISTEN_PORT,
  MAX_PORT_FALLBACKS,
  availableListenHosts,
  isLoopbackHost,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeRuntimeSettings,
  normalizeSftpDownloadDirectory,
  normalizeSftpMaxOpenFileSize,
  normalizeTerminalSettings,
  normalizeWorkspaceToolbarPlacement,
  readRuntimeSettings,
  resolveRuntimeSettings,
  splitListenHosts,
  writeRuntimeSettings
};
