async function ensureTerminalLibs() {
  if (TerminalClass && FitAddonClass) return;
  const errors = [];
  try {
    await loadScriptOnce("/vendor/xterm/xterm.js");
    await loadScriptOnce("/vendor/xterm/addon-fit.js");
    TerminalClass = window.Terminal || globalThis.Terminal;
    FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon || globalThis.FitAddon?.FitAddon || globalThis.FitAddon;
  } catch (error) {
    errors.push(error.message);
  }
  if (!TerminalClass || !FitAddonClass) {
    try {
      const termModule = await import("/vendor/xterm/xterm.mjs");
      const fitModule = await import("/vendor/xterm/addon-fit.mjs");
      TerminalClass = termModule.Terminal;
      FitAddonClass = fitModule.FitAddon;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!TerminalClass || !FitAddonClass) throw new Error(`xterm 组件加载失败：${errors.join("；") || "未找到 Terminal/FitAddon"}`);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`);
    if (found?.dataset.loaded === "1") return resolve();
    if (found) {
      found.addEventListener("load", resolve, { once:true });
      found.addEventListener("error", () => reject(new Error(`加载失败：${src}`)), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`加载失败：${src}`));
    document.head.appendChild(script);
  });
}

function loadRecentTerminalCommands() {
  try {
    const items = JSON.parse(localStorage.getItem("recentTerminalCommands") || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveRecentTerminalCommand(command) {
  const text = String(command || "").trim();
  if (!text || text.length > 500) return;
  recentTerminalCommands = [text, ...recentTerminalCommands.filter(item => item !== text)].slice(0, 30);
  localStorage.setItem("recentTerminalCommands", JSON.stringify(recentTerminalCommands));
}

const terminalEncodingOptions = [
  ["utf8", "UTF-8"], ["gb18030", "GB18030"], ["gbk", "GBK"], ["big5", "Big5"],
  ["shift_jis", "Shift_JIS"], ["euc-kr", "EUC-KR"], ["latin1", "ISO-8859-1"]
];
const terminalFontOptions = [
  ["ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "系统等宽"],
  ["Cascadia Mono, Cascadia Code, Consolas, monospace", "Cascadia"],
  ["JetBrains Mono, Consolas, monospace", "JetBrains Mono"],
  ["Consolas, monospace", "Consolas"],
  ["Menlo, Monaco, monospace", "Menlo / Monaco"],
  ["DejaVu Sans Mono, monospace", "DejaVu Sans Mono"],
  ["Noto Sans Mono, monospace", "Noto Sans Mono"]
];
const terminalStartupOverrides = new Map();
const terminalStartupKinds = new Set(["shell", "repl", "session", "tool", "custom"]);
const terminalStartupPlatforms = new Set(["auto", "posix", "windows"]);
let terminalStartupModalSerial = 0;
const TERMINAL_GLYPH_SAFETY_GUTTER = 3;

function createTerminalFitAddon(term) {
  const fit = new FitAddonClass();
  const proposeDimensions = fit.proposeDimensions.bind(fit);
  fit.proposeDimensions = () => {
    const dimensions = proposeDimensions();
    const element = term?.element;
    const parent = element?.parentElement;
    const renderDimensions = term?._core?._renderService?.dimensions;
    const cellWidth = Number(renderDimensions?.css?.cell?.width || 0);
    if (!dimensions || !parent || !cellWidth) return dimensions;
    const parentStyle = getComputedStyle(parent);
    const elementStyle = getComputedStyle(element);
    const cssPixels = value => Number.parseInt(value, 10) || 0;
    const scrollbarWidth = term.options.scrollback === 0 ? 0 : Number(term.options.overviewRuler?.width || 14);
    const parentWidth = Number(parent.clientWidth || cssPixels(parentStyle.width));
    const availableWidth = Math.max(0,
      parentWidth
      - cssPixels(elementStyle.paddingLeft)
      - cssPixels(elementStyle.paddingRight)
      - scrollbarWidth
    );
    const deviceCellWidth = Number(renderDimensions?.device?.cell?.width || 0);
    const projectedScreenWidth = deviceCellWidth
      ? Math.round(deviceCellWidth * dimensions.cols / Math.max(1, window.devicePixelRatio || 1))
      : Math.round(dimensions.cols * cellWidth);
    if (availableWidth - projectedScreenWidth < TERMINAL_GLYPH_SAFETY_GUTTER) {
      dimensions.cols = Math.max(2, dimensions.cols - 1);
    }
    return dimensions;
  };
  return fit;
}

function normalizeTerminalStartupConfig(value={}) {
  const mode = value.terminal_startup_mode === "program" ? "program" : "default";
  const x11Mode = ["off", "untrusted", "trusted"].includes(String(value.x11_mode || "")) ? value.x11_mode : null;
  if (mode === "default") return {
    terminal_startup_mode:"default",
    terminal_profile_name:"",
    terminal_profile_kind:"shell",
    terminal_program_path:"",
    terminal_program_args:"",
    terminal_working_directory:"",
    terminal_program_platform:"auto",
    ...(x11Mode ? {x11_mode:x11Mode} : {})
  };
  return {
    terminal_startup_mode:"program",
    terminal_profile_name:String(value.terminal_profile_name || "").trim().slice(0, 120),
    terminal_profile_kind:terminalStartupKinds.has(value.terminal_profile_kind) ? value.terminal_profile_kind : "custom",
    terminal_program_path:String(value.terminal_program_path || "").trim(),
    terminal_program_args:String(value.terminal_program_args || "").trim(),
    terminal_working_directory:String(value.terminal_working_directory || "").trim(),
    terminal_program_platform:terminalStartupPlatforms.has(value.terminal_program_platform) ? value.terminal_program_platform : "auto",
    ...(x11Mode ? {x11_mode:x11Mode} : {})
  };
}

function terminalStartupConfigForConnection(connection) {
  return normalizeTerminalStartupConfig(connection || {});
}

function effectiveTerminalStartupConfig(connection, key) {
  return terminalStartupOverrides.has(key)
    ? normalizeTerminalStartupConfig(terminalStartupOverrides.get(key))
    : terminalStartupConfigForConnection(connection);
}

function normalizeTerminalDirectoryPath(value) {
  const raw = String(value || ".").replace(/\\/g, "/").trim() || ".";
  const drive = raw.match(/^[A-Za-z]:\//)?.[0] || "";
  const absolute = raw.startsWith("/") || Boolean(drive);
  const source = drive ? raw.slice(drive.length) : (absolute ? raw.slice(1) : raw);
  const parts = [];
  for (const part of source.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  if (drive) return `${drive}${parts.join("/")}` || drive;
  if (absolute) return `/${parts.join("/")}` || "/";
  return parts.join("/") || ".";
}

function joinTerminalDirectoryPath(base, child) {
  const value = String(child || ".").replace(/\\/g, "/");
  if (value === "~" || value.startsWith("~/")) return value;
  if (/^(?:[A-Za-z]:\/|\/)/.test(value)) return normalizeTerminalDirectoryPath(value);
  const parent = String(base || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  return normalizeTerminalDirectoryPath(parent === "." ? value : `${parent}/${value}`);
}

function terminalDirectoryFromOsc7(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  try {
    if (/^file:\/\//i.test(text)) {
      const url = new URL(text);
      text = decodeURIComponent(url.pathname || "");
      if (/^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
    } else {
      text = decodeURIComponent(text);
    }
  } catch {
    return "";
  }
  return text ? normalizeTerminalDirectoryPath(text) : "";
}

function terminalDirectoryDropLabel(session) {
  return session?.currentDirectoryKnown ? String(session.currentDirectory || ".") : "当前目录";
}

function updateTerminalDropOverlay(session) {
  const overlay = session?.mount?.querySelector?.(".terminal-drop-overlay");
  if (!overlay || overlay.hidden) return;
  const label = overlay.querySelector(".terminal-drop-label");
  const action = overlay.dataset.mode === "copy" ? "复制" : "上传";
  if (label) label.textContent = `松开${action}到终端当前目录：${terminalDirectoryDropLabel(session)}`;
}

function setTerminalDropState(session, active, mode="upload") {
  const overlay = session?.mount?.querySelector?.(".terminal-drop-overlay");
  if (!overlay) return;
  if (active) {
    if (typeof noteSftpDragFeedbackActivity === "function") noteSftpDragFeedbackActivity();
    if (typeof focusSftpDragFeedbackTarget === "function") focusSftpDragFeedbackTarget("terminal", session?.key, session);
  }
  overlay.hidden = !active;
  overlay.dataset.mode = mode === "copy" ? "copy" : "upload";
  if (active) updateTerminalDropOverlay(session);
  else if (typeof releaseSftpDragFeedbackTarget === "function") releaseSftpDragFeedbackTarget("terminal", session?.key, session);
}

function terminalDataTransferHasFiles(dataTransfer) {
  if (typeof sftpDataTransferHasFiles === "function") return sftpDataTransferHasFiles(dataTransfer);
  return Boolean(dataTransfer?.files?.length || [...(dataTransfer?.items || [])].some(item => item.kind === "file"));
}

function terminalSftpDragPayload(dataTransfer) {
  return typeof activeSftpDragPayload === "function" ? activeSftpDragPayload(dataTransfer) : null;
}

function parseTerminalDirectoryCommand(command) {
  const text = cleanTerminalCommandText(command);
  if (!text || /[;&|<>]/.test(text)) return null;
  const match = text.match(/^(?:cd|chdir)(?:\s+--)?(?:\s+(.*))?$/i);
  if (!match) return null;
  let value = String(match[1] || "~").trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1).replace(/\\([\\'" ])/g, "$1");
  }
  if (!value || /[$`*?{}]/.test(value)) return null;
  return value;
}

function setTerminalCurrentDirectory(session, directory, source="tracked") {
  const normalized = normalizeTerminalDirectoryPath(directory);
  if (!normalized) return false;
  if (session.currentDirectory && session.currentDirectory !== normalized) session.previousDirectory = session.currentDirectory;
  session.currentDirectory = normalized;
  session.currentDirectoryKnown = true;
  session.currentDirectorySource = source;
  updateTerminalDropOverlay(session);
  return true;
}

async function probeTerminalDirectory(session, connection, directory, source="probe", options={}) {
  if (!session || !connection?.id) return "";
  const path = normalizeTerminalDirectoryPath(directory || session.currentDirectory || ".");
  const requestId = Number(session.directoryProbeId || 0) + 1;
  session.directoryProbeId = requestId;
  try {
    const query = new URLSearchParams({path, page:"1", page_size:"1", query:"", sort:"name", dir:"asc", refresh:"1"});
    const result = await api(`/api/connections/${connection.id}/sftp?${query.toString()}`);
    if (session.directoryProbeId !== requestId) return "";
    const resolved = String(result?.path || path);
    if (!options.preserveCurrent) setTerminalCurrentDirectory(session, resolved, source);
    if (!session.homeDirectory && !options.preserveCurrent) session.homeDirectory = resolved;
    return resolved;
  } catch {
    return "";
  }
}

async function initializeTerminalDirectory(session, connection, key) {
  const startup = effectiveTerminalStartupConfig(connection, key);
  const initial = startup.terminal_working_directory || session.currentDirectory || ".";
  const resolved = await probeTerminalDirectory(session, connection, initial, "initial");
  if (resolved && !session.homeDirectory && initial !== ".") {
    session.homeDirectory = await probeTerminalDirectory(session, connection, ".", "home", {preserveCurrent:true});
  }
  return resolved;
}

async function trackTerminalDirectoryCommand(session, connection, key, command) {
  const value = parseTerminalDirectoryCommand(command);
  if (!value) return;
  const base = session.currentDirectory || session.homeDirectory || ".";
  const target = value === "-"
    ? (session.previousDirectory || base)
    : value === "~" || value.startsWith("~/")
      ? joinTerminalDirectoryPath(session.homeDirectory || ".", value === "~" ? "." : value.slice(2))
      : joinTerminalDirectoryPath(base, value);
  await probeTerminalDirectory(session, connection, target, "cd");
}

function registerTerminalDirectoryTracking(session) {
  session.directoryOscDisposable?.dispose?.();
  session.directoryOscDisposable = null;
  try {
    session.directoryOscDisposable = session.term.parser.registerOscHandler(7, value => {
      const directory = terminalDirectoryFromOsc7(value);
      if (directory) setTerminalCurrentDirectory(session, directory, "osc7");
      return true;
    });
  } catch {
    session.directoryOscDisposable = null;
  }
}

function bindTerminalDropUpload(session, connection, key, mount) {
  if (!mount || session.dropUploadMount === mount) return;
  if (!mount.querySelector(".terminal-drop-overlay")) {
    const overlay = document.createElement("div");
    overlay.className = "terminal-drop-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `<div class="terminal-drop-hint">${icon("upload-cloud")}<span class="terminal-drop-label">松开上传到终端当前目录</span></div>`;
    mount.appendChild(overlay);
  }
  session.dropUploadMount = mount;
  const clear = () => {
    session.terminalDropDepth = 0;
    setTerminalDropState(session, false);
  };
  mount.addEventListener("dragenter", event => {
    const drag = terminalSftpDragPayload(event.dataTransfer);
    const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event.dataTransfer) : null;
    if (!drag && !localPayload && !terminalDataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (drag || localPayload) {
      event.stopPropagation();
      if (typeof markSftpDragInsideWindow === "function") markSftpDragInsideWindow();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    session.terminalDropDepth = 1;
    setTerminalDropState(session, true, drag ? "copy" : "upload");
  });
  mount.addEventListener("dragover", event => {
    const drag = terminalSftpDragPayload(event.dataTransfer);
    const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event.dataTransfer) : null;
    if (!drag && !localPayload && !terminalDataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (drag || localPayload) {
      event.stopPropagation();
      if (typeof markSftpDragInsideWindow === "function") markSftpDragInsideWindow();
    }
    event.dataTransfer.dropEffect = "copy";
    setTerminalDropState(session, true, drag ? "copy" : "upload");
  });
  mount.addEventListener("dragleave", event => {
    if (mount.contains(event.relatedTarget)) return;
    const overlay = mount.querySelector(".terminal-drop-overlay");
    if (!terminalSftpDragPayload(event.dataTransfer) && !terminalDataTransferHasFiles(event.dataTransfer) && overlay?.hidden !== false) return;
    clear();
  });
  mount.addEventListener("drop", async event => {
    const drag = terminalSftpDragPayload(event.dataTransfer);
    const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event.dataTransfer) : null;
    if (!drag && !localPayload && !terminalDataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
    if (!session.connected) {
      if (drag && typeof finishSftpDragPayload === "function") finishSftpDragPayload(drag);
      return notify("终端尚未连接，无法接收文件", "error");
    }
    let directory = session.currentDirectoryKnown
      ? session.currentDirectory
      : await initializeTerminalDirectory(session, connection, key);
    if (!directory) {
      if (drag && typeof finishSftpDragPayload === "function") finishSftpDragPayload(drag);
      return notify("无法确认终端当前目录，请先重连终端", "error");
    }
    if (localPayload) {
      if (typeof uploadLocalFilesToSftp !== "function") return notify("当前版本不支持本地文件上传", "error");
      try {
        await uploadLocalFilesToSftp(localPayload, {kind:"terminal", id:connection.id, title:`终端：${directory}`, path:directory}, key);
      } catch (error) {
        notify(error.message || "上传本地文件到终端失败", "error");
      }
      return;
    }
    if (drag) {
      if (typeof copySftpDraggedItemsToDirectory !== "function") {
        if (typeof finishSftpDragPayload === "function") finishSftpDragPayload(drag);
        return notify("当前版本不支持 SFTP 项目拖入终端", "error");
      }
      return copySftpDraggedItemsToDirectory(drag, connection.id, directory, {title:`终端：${directory}`});
    }
    if (typeof collectDroppedFiles !== "function" || typeof uploadSftpFilesToDirectory !== "function") {
      return notify("当前版本不支持终端文件上传", "error");
    }
    try {
      const files = await collectDroppedFiles(event.dataTransfer);
      if (!files.length) throw new Error("没有找到可上传的文件");
      await uploadSftpFilesToDirectory(files, connection.id, directory);
    } catch (error) {
      notify(error.message || "终端文件上传失败", "error");
    }
  });
}

async function uploadLocalFilesToTerminalTab(payload, tab) {
  const key = String(tab?.key || "");
  const connection = currentConnection(Number(tab?.id || 0));
  const session = terminalSessions.get(key);
  if (!connection || !session?.connected) throw new Error("终端尚未连接，无法接收文件");
  const directory = session.currentDirectoryKnown
    ? session.currentDirectory
    : await initializeTerminalDirectory(session, connection, key);
  if (!directory) throw new Error("无法确认终端当前目录，请先重连终端");
  return uploadLocalFilesToSftp(payload, {kind:"terminal", id:connection.id, title:`终端：${directory}`, path:directory}, key);
}

function terminalStartupConfigLabel(config) {
  const value = normalizeTerminalStartupConfig(config);
  if (value.terminal_startup_mode === "default") return "服务器默认 Shell";
  return value.terminal_profile_name || value.terminal_program_path.split(/[\\/]/).pop() || "自定义程序";
}

function terminalStartupProfileMatches(config, profile) {
  return config.terminal_startup_mode === "program"
    && String(config.terminal_program_path || "") === String(profile.path || "")
    && String(config.terminal_program_args || "") === String(profile.args || "")
    && String(config.terminal_working_directory || "") === String(profile.working_directory || "");
}
const defaultTerminalGlobalSettings = Object.freeze({
  background_mode:"theme",
  background_color:"#0f1720",
  middle_mouse_action:"paste_clipboard",
  right_mouse_action:"context_menu",
  ctrl_left_click_moves_cursor:true,
  url_links_enabled:true,
  url_prefixes:["http://", "https://", "ftp://", "ssh://", "telnet://"],
  url_ctrl_click:true,
  word_separators:" ()[]{}',\"`",
  shift_double_click_uses_separators:false,
  auto_copy_selection:false,
  copy_tabs_to_spaces:false,
  copy_include_trailing_newline:false,
  copy_trim_trailing_spaces:false,
  select_non_whitespace_block:false,
  multiline_paste_mode:"prompt"
});
const terminalMouseActionOptions = [
  ["none", "不执行操作"],
  ["context_menu", "打开终端菜单"],
  ["paste_clipboard", "粘贴剪贴板内容"],
  ["open_settings", "打开全局终端设置"],
  ["send_enter", "发送回车"],
  ["paste_selection", "粘贴终端选区"]
];

function normalizeTerminalGlobalSettings(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const mouseActions = new Set(terminalMouseActionOptions.map(([item]) => item));
  const backgroundModes = new Set(["theme", "black", "white", "custom"]);
  const backgroundColorValue = String(source.background_color || defaultTerminalGlobalSettings.background_color).trim();
  const prefixes = (Array.isArray(source.url_prefixes) ? source.url_prefixes : String(source.url_prefixes || "").split(/[|,\s]+/))
    .map(item => String(item || "").trim()).filter(Boolean).slice(0, 10);
  return {
    background_mode:backgroundModes.has(source.background_mode) ? source.background_mode : defaultTerminalGlobalSettings.background_mode,
    background_color:/^#[0-9a-f]{6}$/i.test(backgroundColorValue) ? backgroundColorValue.toLowerCase() : defaultTerminalGlobalSettings.background_color,
    middle_mouse_action:mouseActions.has(source.middle_mouse_action) ? source.middle_mouse_action : defaultTerminalGlobalSettings.middle_mouse_action,
    right_mouse_action:mouseActions.has(source.right_mouse_action) ? source.right_mouse_action : defaultTerminalGlobalSettings.right_mouse_action,
    ctrl_left_click_moves_cursor:source.ctrl_left_click_moves_cursor !== false,
    url_links_enabled:source.url_links_enabled === undefined ? defaultTerminalGlobalSettings.url_links_enabled : source.url_links_enabled === true,
    url_prefixes:prefixes.length ? prefixes : [...defaultTerminalGlobalSettings.url_prefixes],
    url_ctrl_click:source.url_ctrl_click !== false,
    word_separators:String(source.word_separators || defaultTerminalGlobalSettings.word_separators).slice(0, 128),
    shift_double_click_uses_separators:source.shift_double_click_uses_separators === true,
    auto_copy_selection:source.auto_copy_selection === undefined ? defaultTerminalGlobalSettings.auto_copy_selection : source.auto_copy_selection === true,
    copy_tabs_to_spaces:source.copy_tabs_to_spaces === true,
    copy_include_trailing_newline:source.copy_include_trailing_newline === undefined ? defaultTerminalGlobalSettings.copy_include_trailing_newline : source.copy_include_trailing_newline === true,
    copy_trim_trailing_spaces:source.copy_trim_trailing_spaces === true,
    select_non_whitespace_block:source.select_non_whitespace_block === true,
    multiline_paste_mode:["prompt", "paste", "single_line"].includes(source.multiline_paste_mode) ? source.multiline_paste_mode : defaultTerminalGlobalSettings.multiline_paste_mode
  };
}

function terminalResolvedBackground(settings=currentTerminalGlobalSettings()) {
  const values = normalizeTerminalGlobalSettings(settings);
  if (values.background_mode === "black") return "#000000";
  if (values.background_mode === "white") return "#ffffff";
  if (values.background_mode === "custom") return values.background_color;
  return document.documentElement.dataset.theme === "dark" ? "#000000" : "#ffffff";
}

function terminalRelativeLuminance(hexColor) {
  const color = String(hexColor || "#000000").replace("#", "");
  const channels = [0, 2, 4].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function terminalContrastRatio(first, second) {
  const firstLuminance = terminalRelativeLuminance(first);
  const secondLuminance = terminalRelativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function terminalMixColor(first, second, amount) {
  const channels = color => [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  const start = channels(first);
  const end = channels(second);
  return `#${start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function terminalReadableColor(candidate, background, fallback, minimumRatio=4.5) {
  if (terminalContrastRatio(candidate, background) >= minimumRatio) return candidate;
  for (let step = 1; step <= 64; step += 1) {
    const adjusted = terminalMixColor(candidate, fallback, step / 64);
    if (terminalContrastRatio(adjusted, background) >= minimumRatio) return adjusted;
  }
  return fallback;
}

function terminalThemeForSettings(settings=currentTerminalGlobalSettings()) {
  const background = terminalResolvedBackground(settings);
  const backgroundLuminance = terminalRelativeLuminance(background);
  const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
  const blackContrast = (backgroundLuminance + 0.05) / 0.05;
  const dark = whiteContrast >= blackContrast;
  const foreground = dark ? "#ffffff" : "#000000";
  const palette = dark ? {
    black:"#2e3436", red:"#ef4444", green:"#22c55e", yellow:"#eab308",
    blue:"#60a5fa", magenta:"#c084fc", cyan:"#2dd4bf", white:"#e5e7eb",
    brightBlack:"#6b7280", brightRed:"#f87171", brightGreen:"#86efac", brightYellow:"#fde047",
    brightBlue:"#93c5fd", brightMagenta:"#d8b4fe", brightCyan:"#67e8f9", brightWhite:"#ffffff"
  } : {
    black:"#1f2937", red:"#b91c1c", green:"#15803d", yellow:"#854d0e",
    blue:"#1d4ed8", magenta:"#7e22ce", cyan:"#0f766e", white:"#d1d5db",
    brightBlack:"#4b5563", brightRed:"#dc2626", brightGreen:"#16a34a", brightYellow:"#a16207",
    brightBlue:"#2563eb", brightMagenta:"#9333ea", brightCyan:"#0891b2", brightWhite:"#f8fafc"
  };
  const readablePalette = Object.fromEntries(Object.entries(palette).map(([name, color]) => [
    name,
    terminalReadableColor(color, background, foreground)
  ]));
  return {
    background,
    foreground,
    cursor:foreground,
    cursorAccent:background,
    selectionBackground:dark ? "#2563eb99" : "#2563eb55",
    selectionForeground:foreground,
    selectionInactiveBackground:dark ? "#2563eb66" : "#2563eb33",
    scrollbarSliderBackground:dark ? "#475569" : "#cbd5e1",
    scrollbarSliderHoverBackground:dark ? "#64748b" : "#94a3b8",
    scrollbarSliderActiveBackground:dark ? "#94a3b8" : "#64748b",
    overviewRulerBorder:background,
    ...readablePalette
  };
}

function currentTerminalGlobalSettings() {
  return terminalGlobalSettings || normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
}

async function ensureTerminalGlobalSettings(force=false) {
  if (terminalGlobalSettings && !force) return terminalGlobalSettings;
  if (terminalGlobalSettingsPromise && !force) return terminalGlobalSettingsPromise;
  terminalGlobalSettingsPromise = api("/api/runtime-settings").then(result => {
    terminalGlobalSettings = normalizeTerminalGlobalSettings(result?.saved?.terminal || result?.terminal);
    if (typeof runtimeSettings !== "undefined" && runtimeSettings) runtimeSettings = {...runtimeSettings, ...result};
    return terminalGlobalSettings;
  }).catch(() => {
    terminalGlobalSettings = normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
    return terminalGlobalSettings;
  }).finally(() => { terminalGlobalSettingsPromise = null; });
  return terminalGlobalSettingsPromise;
}

function terminalWordSeparator(settings=currentTerminalGlobalSettings()) {
  return settings.select_non_whitespace_block ? " \t\r\n" : settings.word_separators;
}

function applyTerminalGlobalSettingsToSession(session) {
  if (!session?.term) return;
  session.term.options.wordSeparator = terminalWordSeparator();
  session.term.options.minimumContrastRatio = 4.5;
  const theme = terminalThemeForSettings();
  if (session.cursorCopyState) {
    session.cursorCopyState.originalTheme = theme;
    session.term.options.theme = {
      ...theme,
      selectionBackground:"#2563eb",
      selectionForeground:"#ffffff",
      selectionInactiveBackground:"#2563eb"
    };
  } else {
    session.term.options.theme = theme;
  }
  const mount = session.mount || session.term.element?.closest?.(".terminal-box");
  if (mount) {
    mount.style.setProperty("--terminal-background", theme.background);
    mount.style.setProperty("--terminal-color-scheme", terminalRelativeLuminance(theme.background) < 0.18 ? "dark" : "light");
  }
  try { session.term.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
}

function applyTerminalGlobalSettingsToSessions() {
  for (const session of terminalSessions.values()) applyTerminalGlobalSettingsToSession(session);
}

function formatTerminalCopiedText(text, settings=currentTerminalGlobalSettings()) {
  let result = String(text || "").replace(/\r\n?/g, "\n");
  if (settings.copy_tabs_to_spaces) result = result.replace(/\t/g, "    ");
  if (settings.copy_trim_trailing_spaces) result = result.split("\n").map(line => line.replace(/[ \t]+$/g, "")).join("\n");
  if (settings.copy_include_trailing_newline) {
    if (result && !result.endsWith("\n")) result += "\n";
  } else {
    result = result.replace(/\n+$/g, "");
  }
  return result;
}

function terminalSingleLinePaste(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean).join(" ");
}

function editTerminalMultilinePaste(initialText) {
  return new Promise(resolve => {
    const modal = $("modal");
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card terminal-paste-modal" role="dialog" aria-modal="true" aria-labelledby="terminalPasteTitle">
      <div class="terminal-settings-head"><div><h2 id="terminalPasteTitle">粘贴多行命令</h2><span id="terminalPasteSummary"></span></div><button id="terminalPasteClose" class="icon-button" type="button" title="关闭" aria-label="关闭">${icon("x")}</button></div>
      <label for="terminalPasteEditor">粘贴内容</label>
      <textarea id="terminalPasteEditor" class="terminal-paste-editor" spellcheck="false"></textarea>
      <div class="actions terminal-paste-actions"><button id="terminalPasteCancel" type="button">取消</button><button id="terminalPasteSingleLine" type="button">合并为一行并粘贴</button><button id="terminalPasteConfirm" class="primary" type="button">${icon("clipboard-paste")}<span>粘贴到终端</span></button></div>
    </div>`;
    modal.hidden = false;
    const editor = $("terminalPasteEditor");
    editor.value = String(initialText || "").replace(/\r\n?/g, "\n");
    const updateSummary = () => {
      const text = editor.value;
      const lines = text ? text.split("\n").length : 0;
      $("terminalPasteSummary").textContent = `${lines} 行 · ${text.length} 个字符`;
    };
    const finish = value => {
      modal.onclick = null;
      modal.onkeydown = null;
      closeModal();
      resolve(value);
    };
    const submitPaste = () => finish(editor.value);
    editor.addEventListener("input", updateSummary);
    $("terminalPasteClose").addEventListener("click", () => finish(null));
    $("terminalPasteCancel").addEventListener("click", () => finish(null));
    $("terminalPasteSingleLine").addEventListener("click", () => finish(terminalSingleLinePaste(editor.value)));
    $("terminalPasteConfirm").addEventListener("click", submitPaste);
    modal.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submitPaste();
      }
    };
    updateSummary();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

async function sendTerminalPasteText(key, text) {
  const value = String(text || "");
  if (!value) return false;
  const normalized = value.replace(/\r\n?/g, "\n");
  const lineCount = normalized.split("\n").length;
  const mode = currentTerminalGlobalSettings().multiline_paste_mode;
  if (lineCount <= 1 || mode === "paste") {
    sendTerminalData(key, value);
    return true;
  }
  if (mode === "single_line") {
    sendTerminalData(key, terminalSingleLinePaste(value));
    return true;
  }
  const edited = await editTerminalMultilinePaste(normalized);
  if (edited === null) {
    focusTerminalSession(key);
    return false;
  }
  if (!edited) {
    notify("粘贴内容为空", "info");
    focusTerminalSession(key);
    return false;
  }
  sendTerminalData(key, edited);
  return true;
}

function terminalOpenLink(text) {
  try {
    const target = new URL(String(text || ""));
    if (!new Set(["http:", "https:", "ftp:", "ssh:", "telnet:"]).has(target.protocol.toLowerCase())) return;
    window.open(target.href, "_blank", "noopener");
  } catch {}
}

function escapeTerminalRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimTerminalUrl(value) {
  let text = String(value || "");
  while (/[.,;:!?]$/.test(text)) text = text.slice(0, -1);
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (text.endsWith(close) && text.split(close).length > text.split(open).length) text = text.slice(0, -1);
  }
  return text;
}

function terminalStringIndexToColumn(line, stringIndex) {
  if (!line?.getCell) return Math.max(1, stringIndex + 1);
  let offset = 0;
  for (let column = 0; column < line.length; column += 1) {
    const cell = line.getCell(column);
    const chars = cell?.getChars?.() || "";
    if (offset >= stringIndex || offset + chars.length > stringIndex) return column + 1;
    offset += chars.length;
  }
  return Math.max(1, line.length);
}

function terminalLinksForLine(session, bufferLineNumber) {
  const settings = currentTerminalGlobalSettings();
  if (!settings.url_links_enabled) return undefined;
  const line = session.term?.buffer?.active?.getLine?.(bufferLineNumber - 1);
  const text = line?.translateToString?.(true) || "";
  if (!text) return undefined;
  const prefixes = settings.url_prefixes.map(escapeTerminalRegex).filter(Boolean);
  if (!prefixes.length) return undefined;
  const pattern = new RegExp(`(?:${prefixes.join("|")})[^\\s<>"']*`, "gi");
  const links = [];
  let match;
  while ((match = pattern.exec(text))) {
    const url = trimTerminalUrl(match[0]);
    if (!url) continue;
    const startIndex = match.index;
    const endIndex = startIndex + url.length - 1;
    links.push({
      range:{
        start:{x:terminalStringIndexToColumn(line, startIndex), y:bufferLineNumber},
        end:{x:terminalStringIndexToColumn(line, endIndex), y:bufferLineNumber}
      },
      text:url,
      decorations:{pointerCursor:true, underline:true},
      activate:event => {
        const current = currentTerminalGlobalSettings();
        if (current.url_ctrl_click && !(event.ctrlKey || event.metaKey)) return;
        terminalOpenLink(url);
      },
      hover:()=>{ session.terminalLinkHovered = true; },
      leave:()=>{ session.terminalLinkHovered = false; },
      dispose:()=>{ session.terminalLinkHovered = false; }
    });
  }
  return links.length ? links : undefined;
}

function bindTerminalSessionGlobalBehavior(session) {
  if (session.globalBehaviorBound) return;
  session.globalBehaviorBound = true;
  applyTerminalGlobalSettingsToSession(session);
  if (typeof session.term.registerLinkProvider === "function") {
    session.globalLinkDisposable = session.term.registerLinkProvider({
      provideLinks:(bufferLineNumber, callback) => callback(terminalLinksForLine(session, bufferLineNumber))
    });
  }
  if (typeof session.term.onSelectionChange === "function") {
    session.globalSelectionDisposable = session.term.onSelectionChange(() => {
      clearTimeout(session.autoCopyTimer);
      session.autoCopyTimer = setTimeout(async () => {
        if (!currentTerminalGlobalSettings().auto_copy_selection || !session.term.hasSelection?.()) return;
        const text = formatTerminalCopiedText(session.term.getSelection?.() || "");
        if (!text || !navigator.clipboard?.writeText) return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {}
      }, 80);
    });
  }
}

function moveTerminalCursorToPointer(event, session, key) {
  const settings = currentTerminalGlobalSettings();
  if (!settings.ctrl_left_click_moves_cursor || session.terminalLinkHovered) return false;
  const screen = session.term?.element?.querySelector?.(".xterm-screen");
  const buffer = session.term?.buffer?.active;
  const cell = session.term?._core?._renderService?.dimensions?.css?.cell;
  if (!screen || !buffer || !cell?.width || !cell?.height) return false;
  const rect = screen.getBoundingClientRect();
  const targetX = Math.max(0, Math.min(session.term.cols - 1, Math.floor((event.clientX - rect.left) / cell.width)));
  const targetY = Math.max(0, Math.min(session.term.rows - 1, Math.floor((event.clientY - rect.top) / cell.height)));
  const currentX = Number(buffer.cursorX || 0);
  const currentY = Number(buffer.baseY || 0) + Number(buffer.cursorY || 0) - Number(buffer.viewportY || 0);
  const vertical = targetY < currentY ? "\x1b[A".repeat(currentY - targetY) : "\x1b[B".repeat(targetY - currentY);
  const horizontal = targetX < currentX ? "\x1b[D".repeat(currentX - targetX) : "\x1b[C".repeat(targetX - currentX);
  if (vertical || horizontal) sendTerminalData(key, vertical + horizontal);
  else focusTerminalSession(key);
  return true;
}

function terminalCellAtPointer(event, session) {
  const screen = session.term?.element?.querySelector?.(".xterm-screen");
  const buffer = session.term?.buffer?.active;
  const cell = session.term?._core?._renderService?.dimensions?.css?.cell;
  if (!screen || !buffer || !cell?.width || !cell?.height) return null;
  const rect = screen.getBoundingClientRect();
  const touchOffset = isMobileLayout() && event.pointerType !== "mouse" ? Math.max(36, cell.height * 2.5) : 0;
  const column = Math.max(0, Math.min(session.term.cols - 1, Math.floor((event.clientX - rect.left) / cell.width)));
  const viewportRow = Math.max(0, Math.min(session.term.rows - 1, Math.floor((event.clientY - touchOffset - rect.top) / cell.height)));
  const row = Math.max(0, Number(buffer.viewportY || 0) + viewportRow);
  return {column, row};
}

function selectTerminalCursorRange(session, start, end) {
  if (!start || !end || typeof session.term?.select !== "function") return false;
  const columns = Math.max(1, Number(session.term.cols) || 1);
  const startOffset = start.row * columns + start.column;
  const endOffset = end.row * columns + end.column;
  const lower = Math.min(startOffset, endOffset);
  const upper = Math.max(startOffset, endOffset);
  session.term.select(lower % columns, Math.floor(lower / columns), upper - lower + 1);
  return true;
}

function cancelTerminalCursorCopy(session, key, clearSelection=true) {
  const state = session?.cursorCopyState;
  if (!state) return;
  state.mount.removeEventListener("pointerdown", state.onPointerDown, true);
  state.mount.removeEventListener("pointermove", state.onPointerMove, true);
  state.mount.removeEventListener("pointerup", state.onPointerUp, true);
  state.mount.removeEventListener("pointercancel", state.onPointerCancel, true);
  clearInterval(state.scrollTimer);
  document.removeEventListener("keydown", state.onKeyDown, true);
  state.hint?.remove();
  state.mount.classList.remove("terminal-cursor-copy-active");
  try { session.term.options.theme = state.originalTheme; } catch {}
  if (clearSelection) try { session.term.clearSelection?.(); } catch {}
  session.cursorCopyState = null;
  focusTerminalSession(key);
}

function startTerminalCursorCopy(key) {
  const session = terminalSessions.get(key);
  const mount = session?.term?.element?.closest?.(".terminal-box") || terminalElementForKey(key, "#terminalMount");
  if (!session?.term || !mount || typeof session.term.select !== "function") return notify("当前终端不支持光标复制", "error");
  cancelTerminalCursorCopy(session, key);
  const originalTheme = {...(session.term.options.theme || {})};
  session.term.options.theme = {
    ...originalTheme,
    selectionBackground:"#2563eb",
    selectionForeground:"#ffffff",
    selectionInactiveBackground:"#2563eb"
  };
  const hint = document.createElement("div");
  hint.className = "terminal-cursor-copy-hint";
  hint.setAttribute("role", "status");
  hint.setAttribute("aria-live", "polite");
  hint.title = "触摸时会选择手指上方的位置；拖到终端边缘可滚动内容";
  hint.innerHTML = `${icon("mouse-pointer-2")}<span class="terminal-cursor-copy-message">光标复制：拖到复制起点后松手</span>`;
  const message = hint.querySelector(".terminal-cursor-copy-message");
  const cancelButton = document.createElement("button");
  cancelButton.className = "icon-button terminal-cursor-copy-cancel";
  cancelButton.type = "button";
  cancelButton.title = "取消光标复制";
  cancelButton.setAttribute("aria-label", "取消光标复制");
  cancelButton.innerHTML = icon("x");
  hint.appendChild(cancelButton);
  mount.appendChild(hint);
  const state = {
    mount, originalTheme, phase:"start", start:null, current:null, pointerId:null,
    scrollTimer:null, scrollDirection:0, lastPointer:null, hint, message, cancelButton
  };
  const stopPointerEvent = event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };
  const stopAutoScroll = () => {
    state.scrollDirection = 0;
    clearInterval(state.scrollTimer);
    state.scrollTimer = null;
  };
  const updateSelection = event => {
    const point = terminalCellAtPointer(event, session);
    if (!point) return null;
    state.current = point;
    selectTerminalCursorRange(session, state.phase === "end" ? state.start : point, point);
    return point;
  };
  const updateAutoScroll = event => {
    state.lastPointer = {clientX:event.clientX, clientY:event.clientY, pointerType:event.pointerType, pointerId:event.pointerId};
    const rect = mount.getBoundingClientRect();
    const edge = Math.min(56, Math.max(34, rect.height * .1));
    const direction = event.clientY < rect.top + edge ? -1 : event.clientY > rect.bottom - edge ? 1 : 0;
    if (direction === state.scrollDirection) return;
    stopAutoScroll();
    state.scrollDirection = direction;
    if (!direction) return;
    state.scrollTimer = setInterval(() => {
      if (state.pointerId === null || !state.lastPointer) return stopAutoScroll();
      session.term.scrollLines(direction);
      updateSelection(state.lastPointer);
    }, 55);
  };
  state.onPointerDown = event => {
    const point = updateSelection(event);
    if (!point) return;
    state.pointerId = event.pointerId;
    try { mount.setPointerCapture?.(event.pointerId); } catch {}
    updateAutoScroll(event);
    stopPointerEvent(event);
  };
  state.onPointerMove = event => {
    if (state.pointerId !== event.pointerId) return;
    updateSelection(event);
    updateAutoScroll(event);
    stopPointerEvent(event);
  };
  state.onPointerUp = event => {
    if (state.pointerId !== event.pointerId) return;
    const point = updateSelection(event) || state.current;
    try { mount.releasePointerCapture?.(event.pointerId); } catch {}
    state.pointerId = null;
    stopAutoScroll();
    stopPointerEvent(event);
    if (!point) return;
    if (state.phase === "start") {
      state.start = point;
      state.phase = "end";
      if (message) message.textContent = "已选起点，请拖到复制终点后松手";
      selectTerminalCursorRange(session, point, point);
      return;
    }
    selectTerminalCursorRange(session, state.start, point);
    const text = session.term.getSelection?.() || "";
    if (!text) {
      notify("没有选中可复制的文本", "info");
      cancelTerminalCursorCopy(session, key);
      return;
    }
    Promise.resolve(copyText(formatTerminalCopiedText(text))).finally(() => cancelTerminalCursorCopy(session, key));
  };
  state.onPointerCancel = event => {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    stopAutoScroll();
    stopPointerEvent(event);
  };
  state.onKeyDown = event => {
    if (event.key === "Escape") cancelTerminalCursorCopy(session, key);
  };
  cancelButton.onpointerdown = event => event.stopPropagation();
  cancelButton.onclick = event => {
    event.stopPropagation();
    cancelTerminalCursorCopy(session, key);
  };
  mount.classList.add("terminal-cursor-copy-active");
  mount.addEventListener("pointerdown", state.onPointerDown, true);
  mount.addEventListener("pointermove", state.onPointerMove, true);
  mount.addEventListener("pointerup", state.onPointerUp, true);
  mount.addEventListener("pointercancel", state.onPointerCancel, true);
  document.addEventListener("keydown", state.onKeyDown, true);
  session.cursorCopyState = state;
}

function runTerminalMouseAction(action, event, session, key, connectionId) {
  if (action === "context_menu") showTerminalContextMenu(event, key, connectionId);
  else if (action === "paste_clipboard") pasteTerminalText(key);
  else if (action === "open_settings") showTerminalGlobalSettings(key);
  else if (action === "send_enter") sendTerminalData(key, "\r");
  else if (action === "paste_selection") sendTerminalPasteText(key, session.term.getSelection?.() || "");
}

function bindTerminalGlobalBehavior(session, key, connectionId, mount) {
  bindTerminalSessionGlobalBehavior(session);
  if (!mount || mount.terminalGlobalBehaviorBound) return;
  mount.terminalGlobalBehaviorBound = true;
  mount.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (session.cursorCopyState) return;
    if (isMobileLayout()) {
      showTerminalContextMenu(event, key, connectionId);
      return;
    }
    const action = currentTerminalGlobalSettings().right_mouse_action;
    runTerminalMouseAction(action, event, session, key, connectionId);
  }, {capture:true});
  mount.addEventListener("mousedown", event => {
    if (event.button === 1) {
      const action = currentTerminalGlobalSettings().middle_mouse_action;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      runTerminalMouseAction(action, event, session, key, connectionId);
      return;
    }
    if (event.button === 0 && event.ctrlKey && moveTerminalCursorToPointer(event, session, key)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      return;
    }
    if (event.button !== 0 || !event.shiftKey || event.detail < 2) return;
    const settings = currentTerminalGlobalSettings();
    session.term.options.wordSeparator = settings.shift_double_click_uses_separators ? settings.word_separators : " \t\r\n";
    setTimeout(() => applyTerminalGlobalSettingsToSession(session), 0);
  }, {capture:true});
  mount.addEventListener("paste", event => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    sendTerminalPasteText(key, text);
  }, {capture:true});
}

function terminalMouseActionOptionsHtml(current) {
  return terminalMouseActionOptions.map(([value,label]) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`).join("");
}

async function showTerminalGlobalSettings(key=activeTabKey) {
  const settings = await ensureTerminalGlobalSettings();
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card terminal-settings-modal" role="dialog" aria-modal="true" aria-labelledby="terminalSettingsTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalSettingsTitle">全局终端设置</h2><span>应用到全部连接和终端会话</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeTerminalGlobalSettings('${escAttr(key)}')">${icon("x")}</button></div>
    <div class="terminal-settings-tabs" role="tablist" aria-label="终端设置分类">
      <button id="terminalSettingsTabAppearance" class="active" type="button" role="tab" aria-selected="true" aria-controls="terminalSettingsPanelAppearance" onclick="selectTerminalSettingsTab('appearance')">${icon("palette")}<span>外观</span></button>
      <button id="terminalSettingsTabInteraction" type="button" role="tab" aria-selected="false" aria-controls="terminalSettingsPanelInteraction" onclick="selectTerminalSettingsTab('interaction')">${icon("mouse-pointer-2")}<span>鼠标与链接</span></button>
      <button id="terminalSettingsTabClipboard" type="button" role="tab" aria-selected="false" aria-controls="terminalSettingsPanelClipboard" onclick="selectTerminalSettingsTab('clipboard')">${icon("copy")}<span>选择与粘贴</span></button>
    </div>
    <div class="terminal-settings-panels">
      <section id="terminalSettingsPanelAppearance" class="terminal-settings-panel" role="tabpanel" aria-labelledby="terminalSettingsTabAppearance">
        <div class="terminal-settings-background-layout">
          <div class="terminal-settings-section terminal-settings-background-section">
            <h3>${icon("monitor-cog")}终端背景</h3>
            <div class="terminal-background-choices" role="radiogroup" aria-label="终端背景颜色">
              <label class="terminal-background-choice"><input class="sr-only" type="radio" name="terminalSettingBackgroundMode" value="theme" ${settings.background_mode === "theme" ? "checked" : ""} onchange="syncTerminalBackgroundForm()"><span class="terminal-background-swatch terminal-background-theme"></span><span>跟随主题</span></label>
              <label class="terminal-background-choice"><input class="sr-only" type="radio" name="terminalSettingBackgroundMode" value="black" ${settings.background_mode === "black" ? "checked" : ""} onchange="syncTerminalBackgroundForm()"><span class="terminal-background-swatch terminal-background-black"></span><span>黑色</span></label>
              <label class="terminal-background-choice"><input class="sr-only" type="radio" name="terminalSettingBackgroundMode" value="white" ${settings.background_mode === "white" ? "checked" : ""} onchange="syncTerminalBackgroundForm()"><span class="terminal-background-swatch terminal-background-white"></span><span>白色</span></label>
              <label class="terminal-background-choice terminal-background-custom"><input class="sr-only" type="radio" name="terminalSettingBackgroundMode" value="custom" ${settings.background_mode === "custom" ? "checked" : ""} onchange="syncTerminalBackgroundForm()"><input id="terminalSettingBackgroundColor" class="terminal-color-picker" type="color" value="${escAttr(settings.background_color)}" title="选择自定义背景颜色" aria-label="选择自定义背景颜色" oninput="selectTerminalCustomBackground(this.value)"><span>自定义</span><output id="terminalSettingBackgroundColorValue">${esc(settings.background_color)}</output></label>
            </div>
          </div>
          <div id="terminalBackgroundPreview" class="terminal-background-preview" aria-label="终端颜色预览">
            <div><span class="terminal-preview-green">root@server</span>:<span class="terminal-preview-blue">~</span>$ ls</div>
            <div><span class="terminal-preview-blue">docs</span>&nbsp;&nbsp;<span class="terminal-preview-cyan">config.yml</span>&nbsp;&nbsp;<span class="terminal-preview-red">error.log</span></div>
            <div>$ <span class="terminal-preview-cursor">&nbsp;</span></div>
          </div>
        </div>
      </section>
      <section id="terminalSettingsPanelInteraction" class="terminal-settings-panel" role="tabpanel" aria-labelledby="terminalSettingsTabInteraction" hidden>
        <div class="terminal-settings-grid">
          <div class="terminal-settings-section">
            <h3>${icon("mouse-pointer-2")}鼠标</h3>
            <div class="terminal-settings-field-grid"><div><label>中键操作</label><select id="terminalSettingMiddleMouse">${terminalMouseActionOptionsHtml(settings.middle_mouse_action)}</select></div><div><label>右键操作</label><select id="terminalSettingRightMouse">${terminalMouseActionOptionsHtml(settings.right_mouse_action)}</select></div></div>
            <label class="check-row"><input id="terminalSettingCtrlClick" type="checkbox" ${settings.ctrl_left_click_moves_cursor ? "checked" : ""}> Ctrl + 左键移动终端光标</label>
          </div>
          <div class="terminal-settings-section">
            <h3>${icon("link")}链接</h3>
            <label class="check-row"><input id="terminalSettingUrlLinks" type="checkbox" ${settings.url_links_enabled ? "checked" : ""} onchange="syncTerminalSettingsForm()"> 识别 URL 超链接</label>
            <label>URL 前缀</label><input id="terminalSettingUrlPrefixes" value="${esc(settings.url_prefixes.join(" | "))}" ${settings.url_links_enabled ? "" : "disabled"}>
            <label class="check-row"><input id="terminalSettingUrlCtrlClick" type="checkbox" ${settings.url_ctrl_click ? "checked" : ""} ${settings.url_links_enabled ? "" : "disabled"}> Ctrl + 单击打开链接</label>
          </div>
        </div>
      </section>
      <section id="terminalSettingsPanelClipboard" class="terminal-settings-panel" role="tabpanel" aria-labelledby="terminalSettingsTabClipboard" hidden>
        <div class="terminal-settings-grid terminal-settings-clipboard-grid">
          <div class="terminal-settings-section">
            <h3>${icon("text-select")}选择</h3>
            <label>双击选择分隔符</label>
            <div class="terminal-settings-inline"><input id="terminalSettingWordSeparators" value="${esc(settings.word_separators)}"><button type="button" onclick="resetTerminalWordSeparators()">重置</button></div>
            <label class="check-row"><input id="terminalSettingShiftDoubleClick" type="checkbox" ${settings.shift_double_click_uses_separators ? "checked" : ""}> Shift + 双击时使用分隔符</label>
            <label class="check-row"><input id="terminalSettingNonWhitespaceBlock" type="checkbox" ${settings.select_non_whitespace_block ? "checked" : ""}> 连续非空白内容作为一个整体</label>
          </div>
          <div class="terminal-settings-section">
            <h3>${icon("copy")}复制</h3>
            <div class="terminal-settings-check-grid">
              <label class="check-row"><input id="terminalSettingAutoCopy" type="checkbox" ${settings.auto_copy_selection ? "checked" : ""}> 选中后自动复制</label>
              <label class="check-row"><input id="terminalSettingTabsToSpaces" type="checkbox" ${settings.copy_tabs_to_spaces ? "checked" : ""}> 制表符转为 4 个空格</label>
              <label class="check-row"><input id="terminalSettingTrailingNewline" type="checkbox" ${settings.copy_include_trailing_newline ? "checked" : ""}> 包含末尾换行</label>
              <label class="check-row"><input id="terminalSettingTrimSpaces" type="checkbox" ${settings.copy_trim_trailing_spaces ? "checked" : ""}> 删除行尾空白</label>
            </div>
          </div>
          <div class="terminal-settings-section terminal-settings-paste-section">
            <h3>${icon("clipboard-paste")}粘贴</h3>
            <label>粘贴多行文本时</label>
            <select id="terminalSettingMultilinePaste">
              <option value="prompt" ${settings.multiline_paste_mode === "prompt" ? "selected" : ""}>打开可编辑命令窗口</option>
              <option value="paste" ${settings.multiline_paste_mode === "paste" ? "selected" : ""}>直接粘贴</option>
              <option value="single_line" ${settings.multiline_paste_mode === "single_line" ? "selected" : ""}>合并为一行</option>
            </select>
          </div>
        </div>
      </section>
    </div>
    <div class="actions terminal-settings-actions"><button type="button" onclick="resetTerminalGlobalSettingsForm()">恢复默认</button><button type="button" onclick="closeTerminalGlobalSettings('${escAttr(key)}')">取消</button><button id="terminalSettingsSave" class="primary" type="button" onclick="saveTerminalGlobalSettings('${escAttr(key)}')">${icon("save")}<span>保存全局设置</span></button></div>
  </div>`;
  modal.hidden = false;
  modal.onkeydown = event => {
      if (event.key === "Escape") closeTerminalGlobalSettings(key);
  };
  syncTerminalBackgroundForm();
  $("terminalSettingsTabAppearance")?.focus();
}

function selectTerminalSettingsTab(name) {
  const selected = ["appearance", "interaction", "clipboard"].includes(name) ? name : "appearance";
  const mapping = {
    appearance:["terminalSettingsTabAppearance", "terminalSettingsPanelAppearance"],
    interaction:["terminalSettingsTabInteraction", "terminalSettingsPanelInteraction"],
    clipboard:["terminalSettingsTabClipboard", "terminalSettingsPanelClipboard"]
  };
  Object.entries(mapping).forEach(([key, [tabId, panelId]]) => {
    const active = key === selected;
    $(tabId)?.classList.toggle("active", active);
    $(tabId)?.setAttribute("aria-selected", String(active));
    if ($(panelId)) $(panelId).hidden = !active;
  });
}

function selectedTerminalBackgroundMode() {
  return document.querySelector('input[name="terminalSettingBackgroundMode"]:checked')?.value || "theme";
}

function selectTerminalCustomBackground(value) {
  const custom = document.querySelector('input[name="terminalSettingBackgroundMode"][value="custom"]');
  if (custom) custom.checked = true;
  if ($("terminalSettingBackgroundColor")) $("terminalSettingBackgroundColor").value = value;
  syncTerminalBackgroundForm();
}

function syncTerminalBackgroundForm() {
  const preview = $("terminalBackgroundPreview");
  const picker = $("terminalSettingBackgroundColor");
  if (!preview || !picker) return;
  const mode = selectedTerminalBackgroundMode();
  document.querySelectorAll(".terminal-background-choice").forEach(choice => {
    const active = choice.querySelector('input[type="radio"]')?.checked === true;
    choice.classList.toggle("active", active);
  });
  const settings = normalizeTerminalGlobalSettings({background_mode:mode, background_color:picker.value});
  const theme = terminalThemeForSettings(settings);
  preview.style.background = theme.background;
  preview.style.color = theme.foreground;
  preview.querySelector(".terminal-preview-green")?.style.setProperty("color", theme.green);
  preview.querySelector(".terminal-preview-blue")?.style.setProperty("color", theme.blue);
  preview.querySelector(".terminal-preview-cyan")?.style.setProperty("color", theme.cyan);
  preview.querySelector(".terminal-preview-red")?.style.setProperty("color", theme.red);
  preview.querySelector(".terminal-preview-cursor")?.style.setProperty("background", theme.cursor);
  if ($("terminalSettingBackgroundColorValue")) $("terminalSettingBackgroundColorValue").textContent = picker.value.toLowerCase();
}

function syncTerminalSettingsForm() {
  const enabled = Boolean($("terminalSettingUrlLinks")?.checked);
  if ($("terminalSettingUrlPrefixes")) $("terminalSettingUrlPrefixes").disabled = !enabled;
  if ($("terminalSettingUrlCtrlClick")) $("terminalSettingUrlCtrlClick").disabled = !enabled;
}

function resetTerminalWordSeparators() {
  if ($("terminalSettingWordSeparators")) $("terminalSettingWordSeparators").value = defaultTerminalGlobalSettings.word_separators;
}

function fillTerminalGlobalSettingsForm(settings) {
  const values = normalizeTerminalGlobalSettings(settings);
  const backgroundMode = document.querySelector(`input[name="terminalSettingBackgroundMode"][value="${values.background_mode}"]`);
  if (backgroundMode) backgroundMode.checked = true;
  $("terminalSettingBackgroundColor").value = values.background_color;
  $("terminalSettingMiddleMouse").value = values.middle_mouse_action;
  $("terminalSettingRightMouse").value = values.right_mouse_action;
  $("terminalSettingCtrlClick").checked = values.ctrl_left_click_moves_cursor;
  $("terminalSettingUrlLinks").checked = values.url_links_enabled;
  $("terminalSettingUrlPrefixes").value = values.url_prefixes.join(" | ");
  $("terminalSettingUrlCtrlClick").checked = values.url_ctrl_click;
  $("terminalSettingWordSeparators").value = values.word_separators;
  $("terminalSettingShiftDoubleClick").checked = values.shift_double_click_uses_separators;
  $("terminalSettingNonWhitespaceBlock").checked = values.select_non_whitespace_block;
  $("terminalSettingAutoCopy").checked = values.auto_copy_selection;
  $("terminalSettingTabsToSpaces").checked = values.copy_tabs_to_spaces;
  $("terminalSettingTrailingNewline").checked = values.copy_include_trailing_newline;
  $("terminalSettingTrimSpaces").checked = values.copy_trim_trailing_spaces;
  $("terminalSettingMultilinePaste").value = values.multiline_paste_mode;
  syncTerminalSettingsForm();
  syncTerminalBackgroundForm();
}

function resetTerminalGlobalSettingsForm() {
  fillTerminalGlobalSettingsForm(defaultTerminalGlobalSettings);
}

function terminalGlobalSettingsFormValue() {
  return {
    background_mode:selectedTerminalBackgroundMode(),
    background_color:$("terminalSettingBackgroundColor").value,
    middle_mouse_action:$("terminalSettingMiddleMouse").value,
    right_mouse_action:$("terminalSettingRightMouse").value,
    ctrl_left_click_moves_cursor:$("terminalSettingCtrlClick").checked,
    url_links_enabled:$("terminalSettingUrlLinks").checked,
    url_prefixes:$("terminalSettingUrlPrefixes").value.split(/[|,\s]+/).map(item => item.trim()).filter(Boolean),
    url_ctrl_click:$("terminalSettingUrlCtrlClick").checked,
    word_separators:$("terminalSettingWordSeparators").value,
    shift_double_click_uses_separators:$("terminalSettingShiftDoubleClick").checked,
    auto_copy_selection:$("terminalSettingAutoCopy").checked,
    copy_tabs_to_spaces:$("terminalSettingTabsToSpaces").checked,
    copy_include_trailing_newline:$("terminalSettingTrailingNewline").checked,
    copy_trim_trailing_spaces:$("terminalSettingTrimSpaces").checked,
    select_non_whitespace_block:$("terminalSettingNonWhitespaceBlock").checked,
    multiline_paste_mode:$("terminalSettingMultilinePaste").value
  };
}

async function saveTerminalGlobalSettings(key=activeTabKey) {
  const button = $("terminalSettingsSave");
  setButtonBusy(button, true, "保存中");
  try {
    const result = await api("/api/runtime-settings", {method:"PUT", body:JSON.stringify({terminal:terminalGlobalSettingsFormValue()})});
    terminalGlobalSettings = normalizeTerminalGlobalSettings(result?.saved?.terminal || result?.terminal);
    if (typeof runtimeSettings !== "undefined" && runtimeSettings) runtimeSettings = {...runtimeSettings, ...result};
    applyTerminalGlobalSettingsToSessions();
    closeTerminalGlobalSettings(key);
    notify("全局终端设置已保存", "success");
  } catch (error) {
    notify(error.message || "全局终端设置保存失败", "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function closeTerminalGlobalSettings(key=activeTabKey) {
  const modal = $("modal");
  modal.onkeydown = null;
  closeModal();
  focusTerminalSession(key);
}

function syncTerminalStartupForm() {
  const select = $("terminalStartupProfile");
  const details = $("terminalStartupProgramFields");
  if (!select || !details) return;
  details.hidden = select.value === "default";
}

function fillTerminalStartupForm(config) {
  const value = normalizeTerminalStartupConfig(config);
  $("terminalStartupProfile").value = value.terminal_startup_mode === "default" ? "default" : "custom";
  $("terminalStartupProfileName").value = value.terminal_profile_name;
  $("terminalStartupKind").value = value.terminal_profile_kind;
  $("terminalStartupPath").value = value.terminal_program_path;
  $("terminalStartupArgs").value = value.terminal_program_args;
  $("terminalStartupCwd").value = value.terminal_working_directory;
  $("terminalStartupPlatform").value = value.terminal_program_platform;
  syncTerminalStartupForm();
}

function terminalStartupFormValue() {
  const mode = $("terminalStartupProfile").value === "default" ? "default" : "program";
  const fields = [
    ["terminalStartupProfileName", "配置名称", 120],
    ["terminalStartupPath", "程序路径", 2048],
    ["terminalStartupArgs", "启动参数", 4096],
    ["terminalStartupCwd", "工作目录", 2048]
  ];
  const values = {};
  for (const [id, label, maximum] of fields) {
    const value = String($(id)?.value || "").trim();
    if (/[\r\n\0]/.test(value)) throw new Error(`${label} 只能填写一行`);
    if (value.length > maximum) throw new Error(`${label} 不能超过 ${maximum} 个字符`);
    values[id] = value;
  }
  if (mode === "program" && !values.terminalStartupPath) throw new Error("请选择启动配置，或填写程序完整路径");
  return normalizeTerminalStartupConfig({
    terminal_startup_mode:mode,
    terminal_profile_name:values.terminalStartupProfileName,
    terminal_profile_kind:$("terminalStartupKind")?.value || "custom",
    terminal_program_path:values.terminalStartupPath,
    terminal_program_args:values.terminalStartupArgs,
    terminal_working_directory:values.terminalStartupCwd,
    terminal_program_platform:$("terminalStartupPlatform")?.value || "auto"
  });
}

function terminalStartupFormDraft() {
  return normalizeTerminalStartupConfig({
    terminal_startup_mode:$("terminalStartupProfile")?.value === "default" ? "default" : "program",
    terminal_profile_name:$("terminalStartupProfileName")?.value || "",
    terminal_profile_kind:$("terminalStartupKind")?.value || "custom",
    terminal_program_path:$("terminalStartupPath")?.value || "",
    terminal_program_args:$("terminalStartupArgs")?.value || "",
    terminal_working_directory:$("terminalStartupCwd")?.value || "",
    terminal_program_platform:$("terminalStartupPlatform")?.value || "auto"
  });
}

function chooseTerminalStartupProfile() {
  const select = $("terminalStartupProfile");
  const modal = $("modal");
  if (!select || !modal) return;
  const profiles = modal._terminalStartupProfiles || [];
  if (select.value.startsWith("profile:")) {
    const profile = profiles[Number(select.value.slice(8))];
    if (profile) {
      $("terminalStartupProfileName").value = profile.label || profile.name || "";
      $("terminalStartupKind").value = terminalStartupKinds.has(profile.kind) ? profile.kind : "custom";
      $("terminalStartupPath").value = profile.path || "";
      $("terminalStartupArgs").value = profile.args || "";
      $("terminalStartupCwd").value = profile.working_directory || "";
      $("terminalStartupPlatform").value = terminalStartupPlatforms.has(profile.platform) ? profile.platform : "auto";
    }
  }
  syncTerminalStartupForm();
}

function markTerminalStartupCustom() {
  const select = $("terminalStartupProfile");
  if (select && select.value !== "default") select.value = "custom";
}

function populateTerminalStartupCapabilities(capabilities, currentConfig) {
  const select = $("terminalStartupProfile");
  const modal = $("modal");
  if (!select || !modal) return;
  const profiles = Array.isArray(capabilities?.profiles) ? capabilities.profiles : [];
  modal._terminalStartupProfiles = profiles;
  const defaultShell = capabilities?.default_shell?.label || capabilities?.default_shell?.name || "";
  const options = [
    `<option value="default">自动（服务器默认${defaultShell ? `：${esc(defaultShell)}` : "登录 Shell"}）</option>`
  ];
  const groups = [
    ["shell", "检测到的 Shell"],
    ["repl", "交互式程序"],
    ["session", "会话工具"],
    ["tool", "其他可启动工具"]
  ];
  for (const [kind, label] of groups) {
    const indexes = profiles.map((profile, index) => ({profile,index})).filter(item => item.profile.kind === kind);
    if (!indexes.length) continue;
    options.push(`<optgroup label="${escAttr(label)}">${indexes.map(({profile,index}) => `<option value="profile:${index}">${esc(profile.label || profile.name || profile.path)}${profile.is_default ? "（默认）" : ""}</option>`).join("")}</optgroup>`);
  }
  options.push(`<option value="custom">自定义程序、Shell 或命令行工具</option>`);
  select.innerHTML = options.join("");
  const matchingIndex = profiles.findIndex(profile => terminalStartupProfileMatches(currentConfig, profile));
  select.value = currentConfig.terminal_startup_mode === "default"
    ? "default"
    : matchingIndex >= 0 ? `profile:${matchingIndex}` : "custom";
  const tools = Array.isArray(capabilities?.tools) ? capabilities.tools : [];
  const summary = $("terminalStartupCapabilitySummary");
  if (summary) {
    const platform = capabilities?.platform_label || capabilities?.platform || "远端系统";
    const detected = tools.map(tool => `${tool.label || tool.name}${tool.version ? ` ${tool.version}` : ""}`);
    const warnings = Array.isArray(capabilities?.warnings) ? capabilities.warnings.filter(Boolean) : [];
    summary.className = `terminal-startup-capability ${warnings.length ? "warning" : "success"}`;
    summary.innerHTML = `<strong>${esc(platform)}${defaultShell ? ` · 默认 ${defaultShell}` : ""}</strong>${detected.length ? `<span>已检测工具：${detected.map(esc).join("、")}</span>` : ""}${warnings.length ? `<span>${warnings.map(esc).join("；")}</span>` : ""}`;
  }
  syncTerminalStartupForm();
}

function terminalStartupModalRequestIsCurrent(modal, context, requestId) {
  return $("modal") === modal
    && !modal.hidden
    && modal._terminalStartupContext === context
    && modal._terminalStartupRequestId === requestId;
}

async function refreshTerminalStartupCapabilities(connectionId, key, button=null) {
  const modal = $("modal");
  const context = modal?._terminalStartupContext;
  if (!context || modal._terminalStartupKey !== key || modal._terminalStartupConnectionId !== connectionId) return;
  const requestId = Number(modal._terminalStartupRequestId || 0) + 1;
  modal._terminalStartupRequestId = requestId;
  const status = $("terminalStartupCapabilitySummary");
  if (status) {
    status.className = "terminal-startup-capability loading";
    status.textContent = "正在只读检测远端 Shell、Python、Node 和会话工具…";
  }
  setButtonBusy(button, true, "检测中");
  try {
    const response = await api(`/api/connections/${connectionId}/terminal-capabilities`, {method:"POST", body:"{}"});
    if (!terminalStartupModalRequestIsCurrent(modal, context, requestId)) return;
    const connection = connections.find(item => item.id === connectionId);
    const current = terminalStartupFormDraft();
    populateTerminalStartupCapabilities(response.capabilities || response, current);
    if (connection && response.capabilities) connection.terminal_capabilities = response.capabilities;
  } catch (error) {
    if (!terminalStartupModalRequestIsCurrent(modal, context, requestId)) return;
    if (status) {
      status.className = "terminal-startup-capability warning";
      status.textContent = `暂时无法识别远端环境：${error.message}。仍可使用服务器默认 Shell 或手动填写。`;
    }
  } finally {
    if (terminalStartupModalRequestIsCurrent(modal, context, requestId)) setButtonBusy(button, false);
  }
}

function closeTerminalStartupSettings(key=activeTabKey, focus=true, force=false) {
  const modal = $("modal");
  if (modal._terminalStartupApplying && !force) return false;
  modal._terminalStartupRequestId = Number(modal._terminalStartupRequestId || 0) + 1;
  modal._terminalStartupContext = null;
  modal._terminalStartupKey = "";
  modal._terminalStartupConnectionId = 0;
  modal._terminalStartupApplying = false;
  modal.onkeydown = null;
  closeModal();
  if (focus) focusTerminalSession(key);
  return true;
}

function updateTerminalStartupButton(key, connection) {
  const button = terminalElementForKey(key, ".terminal-startup-button");
  if (!button) return;
  const temporary = terminalStartupOverrides.has(key);
  const label = terminalStartupConfigLabel(effectiveTerminalStartupConfig(connection, key));
  button.title = `终端配置：${label}${temporary ? "（仅当前标签）" : ""}`;
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("has-temporary-startup", temporary);
}

function updateTerminalStartupButtonsForConnection(connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  for (const tab of tabs) {
    if (tab.kind === "terminal" && Number(tab.id) === Number(connectionId)) {
      updateTerminalStartupButton(tab.key, connection);
    }
  }
}

async function saveTerminalStartupDefault(connectionId, startup) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) throw new Error("SSH 连接不存在");
  const response = await api(`/api/connections/${connectionId}/terminal-startup`, {
    method:"POST",
    body:JSON.stringify(startup)
  });
  Object.assign(connection, normalizeTerminalStartupConfig(response.startup || response));
  updateTerminalStartupButtonsForConnection(connectionId);
  return connection;
}

function setTerminalStartupModalBusy(modal, busy) {
  const card = modal?.querySelector(".terminal-startup-modal");
  if (!card) return;
  modal.setAttribute("aria-busy", busy ? "true" : "false");
  for (const control of card.querySelectorAll("button,input,select")) {
    if (busy) {
      if (!control.hasAttribute("data-terminal-startup-disabled")) {
        control.dataset.terminalStartupDisabled = control.disabled ? "1" : "0";
      }
      control.disabled = true;
    } else {
      control.disabled = control.dataset.terminalStartupDisabled === "1";
      delete control.dataset.terminalStartupDisabled;
    }
  }
  card.classList.toggle("is-busy", busy);
}

async function applyTerminalStartupSettings(key, connectionId, target, button=null, splitZone="") {
  let connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const modal = $("modal");
  const modalContext = modal?._terminalStartupContext;
  if (!modalContext || modal._terminalStartupApplying) return;
  modal._terminalStartupApplying = true;
  setTerminalStartupModalBusy(modal, true);
  setButtonBusy(button, true, target === "current" ? "正在打开" : "正在创建");
  let defaultSaved = false;
  try {
    const startup = terminalStartupFormValue();
    const saveDefault = Boolean($("terminalStartupSaveDefault")?.checked);
    if (saveDefault) {
      connection = await saveTerminalStartupDefault(connectionId, startup);
      defaultSaved = true;
    }
    if (target === "current") {
      if (saveDefault) terminalStartupOverrides.delete(key);
      else terminalStartupOverrides.set(key, startup);
      if (modal._terminalStartupContext === modalContext) closeTerminalStartupSettings(key, true, true);
      updateTerminalStartupButton(key, connection);
      reconnectTerminal(connectionId, key);
      notify(saveDefault
        ? "启动配置已保存为连接默认值，正在重新连接本终端"
        : "启动配置仅对本终端临时生效，正在重新连接", "success");
      return;
    }
    const sourceTab = tabs.find(item => item.key === key && item.kind === "terminal");
    if (!sourceTab || typeof duplicateWorkspaceTab !== "function") throw new Error("当前终端标签已关闭");
    const requestedSplit = target === "split" && !isMobileLayout();
    const duplicateResult = {};
    const duplicateKey = duplicateWorkspaceTab(key, {
      splitZone:requestedSplit ? splitZone : "",
      result:duplicateResult,
      beforeOpen:newKey => {
        if (saveDefault) terminalStartupOverrides.delete(newKey);
        else terminalStartupOverrides.set(newKey, startup);
      }
    });
    if (!duplicateKey) throw new Error("新终端标签创建失败");
    const openedInSplit = duplicateResult.split === true;
    if (modal._terminalStartupContext === modalContext) closeTerminalStartupSettings(key, false, true);
    notify(saveDefault
      ? `启动配置已保存为连接默认值，并已在${openedInSplit ? "新分屏" : "新标签"}打开`
      : `已使用临时启动配置在${openedInSplit ? "新分屏" : "新标签"}打开`, "success");
  } catch (error) {
    notify(defaultSaved
      ? `默认启动配置已保存，但打开终端失败：${error.message || "未知错误"}`
      : error.message || "终端配置应用失败", "error");
  } finally {
    setButtonBusy(button, false);
    if (modal._terminalStartupContext === modalContext) {
      modal._terminalStartupApplying = false;
      setTerminalStartupModalBusy(modal, false);
    }
  }
}

function restoreSavedTerminalStartup(key, connectionId) {
  if ($("modal")?._terminalStartupApplying) return;
  const connection = connections.find(item => item.id === connectionId);
  terminalStartupOverrides.delete(key);
  closeTerminalStartupSettings(key);
  updateTerminalStartupButton(key, connection);
  reconnectTerminal(connectionId, key);
  notify("当前标签已恢复使用 SSH 连接中保存的启动配置", "success");
}

function showTerminalStartupSettings(key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = effectiveTerminalStartupConfig(connection, key);
  const saved = terminalStartupConfigForConnection(connection);
  const temporary = terminalStartupOverrides.has(key);
  const modal = $("modal");
  const modalContext = ++terminalStartupModalSerial;
  modal.onclick = null;
  modal._terminalStartupContext = modalContext;
  modal._terminalStartupKey = key;
  modal._terminalStartupConnectionId = connectionId;
  modal._terminalStartupRequestId = 0;
  modal._terminalStartupApplying = false;
  modal.innerHTML = `<div class="modal-card wide terminal-startup-modal" role="dialog" aria-modal="true" aria-labelledby="terminalStartupTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalStartupTitle">终端配置</h2><span>${temporary ? "当前标签正在使用临时配置" : "当前使用 SSH 连接中保存的默认配置"}</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" id="terminalStartupClose">${icon("x")}</button></div>
    <div class="terminal-startup-scroll">
    <div class="terminal-startup-saved-row">
      <div class="terminal-startup-saved">SSH 连接保存值：<strong>${esc(terminalStartupConfigLabel(saved))}</strong>。已打开的终端不会自动变化。</div>
      ${temporary ? `<button id="terminalStartupRestore" type="button">${icon("rotate-ccw")}<span>恢复连接保存值</span></button>` : ""}
    </div>
    <label>启动配置<select id="terminalStartupProfile"></select></label>
    <div class="terminal-startup-capability-control">
      <div id="terminalStartupCapabilitySummary" class="terminal-startup-capability loading">等待检测远端环境</div>
      <button id="terminalStartupDetect" type="button">${icon("scan-search")}<span>重新检测</span></button>
    </div>
    <div id="terminalStartupProgramFields" class="terminal-startup-fields">
      <input id="terminalStartupKind" type="hidden" value="custom">
      <div class="grid">
        <label>配置名称<input id="terminalStartupProfileName" maxlength="120" placeholder="例如：Bash（登录模式）"></label>
        <label>远端类型<select id="terminalStartupPlatform"><option value="auto">自动识别</option><option value="posix">Linux / macOS / Unix</option><option value="windows">Windows OpenSSH</option></select></label>
      </div>
      <label>程序完整路径<input id="terminalStartupPath" maxlength="2048" spellcheck="false" placeholder="/bin/bash、/usr/bin/python3 或 C:\\Program Files\\PowerShell\\7\\pwsh.exe"></label>
      <label>启动参数<input id="terminalStartupArgs" maxlength="4096" spellcheck="false" placeholder="-l、-i 等；路径和参数请分开填写"></label>
      <label>启动工作目录（可选）<input id="terminalStartupCwd" maxlength="2048" spellcheck="false" placeholder="/srv/app 或 C:\\work"></label>
      <div class="muted">参数支持引号分组。请勿在启动参数中填写密码、令牌或私钥。</div>
    </div>
    <label class="terminal-startup-save-default">
      <input id="terminalStartupSaveDefault" type="checkbox">
      <span><strong>同时保存为该 SSH 连接的默认配置</strong><small>默认不勾选；未勾选时只对这次打开的目标标签临时生效。</small></span>
    </label>
    </div>
    <div class="actions terminal-startup-actions">
      <button id="terminalStartupCancel" type="button">取消</button>
      <button id="terminalStartupCurrent" class="primary" type="button">${icon("refresh-cw")}<span>本终端打开</span></button>
      <button id="terminalStartupNewTab" type="button">${icon("copy-plus")}<span>新标签打开</span></button>
      ${!isMobileLayout() ? `<div class="terminal-startup-split-picker">
        <button id="terminalStartupSplit" type="button" aria-haspopup="menu" title="悬浮后选择上、下、左、右分屏">${icon("panels-top-left")}<span>新标签分屏打开</span>${icon("chevron-up")}</button>
        <div class="terminal-startup-split-options" role="menu" aria-label="选择新标签分屏方向">
          <span class="terminal-startup-split-center" aria-hidden="true">${icon("panels-top-left")}</span>
          <button data-split-zone="top" type="button" role="menuitem" title="在上方分屏打开" aria-label="在上方分屏打开" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'top')">${icon("arrow-up")}</button>
          <button data-split-zone="bottom" type="button" role="menuitem" title="在下方分屏打开" aria-label="在下方分屏打开" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'bottom')">${icon("arrow-down")}</button>
          <button data-split-zone="left" type="button" role="menuitem" title="在左侧分屏打开" aria-label="在左侧分屏打开" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'left')">${icon("arrow-left")}</button>
          <button data-split-zone="right" type="button" role="menuitem" title="在右侧分屏打开" aria-label="在右侧分屏打开" onclick="applyTerminalStartupSettings('${escAttr(key)}',${connectionId},'split',this,'right')">${icon("arrow-right")}</button>
        </div>
      </div>` : ""}
    </div>
  </div>`;
  modal.hidden = false;
  modal._terminalStartupProfiles = [];
  fillTerminalStartupForm(current);
  $("terminalStartupProfile").innerHTML = `<option value="default">自动（使用服务器默认登录 Shell）</option><option value="custom">自定义程序、Shell 或命令行工具</option>`;
  $("terminalStartupProfile").value = current.terminal_startup_mode === "default" ? "default" : "custom";
  syncTerminalStartupForm();
  $("terminalStartupProfile").onchange = chooseTerminalStartupProfile;
  for (const id of ["terminalStartupProfileName", "terminalStartupPath", "terminalStartupArgs", "terminalStartupCwd", "terminalStartupPlatform"]) {
    $(id).addEventListener("input", markTerminalStartupCustom);
    $(id).addEventListener("change", markTerminalStartupCustom);
  }
  $("terminalStartupClose").onclick = () => closeTerminalStartupSettings(key);
  $("terminalStartupCancel").onclick = () => closeTerminalStartupSettings(key);
  $("terminalStartupDetect").onclick = event => refreshTerminalStartupCapabilities(connectionId, key, event.currentTarget);
  $("terminalStartupCurrent").onclick = event => applyTerminalStartupSettings(key, connectionId, "current", event.currentTarget);
  $("terminalStartupNewTab").onclick = event => applyTerminalStartupSettings(key, connectionId, "new", event.currentTarget);
  if ($("terminalStartupRestore")) $("terminalStartupRestore").onclick = () => restoreSavedTerminalStartup(key, connectionId);
  modal.onkeydown = event => {
    if (event.key === "Escape") closeTerminalStartupSettings(key);
  };
  refreshIcons();
  refreshTerminalStartupCapabilities(connectionId, key, $("terminalStartupDetect"));
  requestAnimationFrame(() => $("terminalStartupProfile")?.focus({preventScroll:true}));
}

function terminalSessionEncoding(key, connection) {
  return terminalSessions.get(key)?.terminalEncoding || connection?.terminal_encoding || "utf8";
}

function terminalEncodingLabel(connection, key="") {
  return terminalEncodingOptions.find(([value]) => value === terminalSessionEncoding(key, connection))?.[1] || "UTF-8";
}

function terminalElementForKey(key, selector) {
  if (typeof workspaceElementForTab === "function") {
    const element = workspaceElementForTab(key, selector);
    if (element) return element;
  }
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(String(key || ""));
  const toolbarElement = document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`)?.querySelector(selector);
  if (toolbarElement) return toolbarElement;
  const session = terminalSessions.get(key);
  const pane = session?.term?.element?.closest?.(".workspace-pane");
  return pane?.querySelector(selector) || null;
}

function updateTerminalStatusForLayout(key=activeTabKey) {
  const status = terminalElementForKey(key, "#terminalStatus");
  if (!status) return;
  const address = status.dataset.connectionAddress || "";
  const state = status.dataset.connectionState || "连接中";
  status.textContent = isMobileLayout() ? `${address}${state ? ` · ${state}` : ""}` : "";
  status.title = `${address}${state ? ` · ${state}` : ""}`;
}

function syncTerminalToolbarPlacement(tabKey=activeTabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (tab?.kind !== "terminal") return;
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const view = pane && typeof workspacePaneElement === "function"
    ? workspacePaneElement(pane.id)?.querySelector("#view-terminal")
    : $("view-terminal");
  if (!view) return;
  const mount = view.querySelector("#terminalToolbarMount");
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(key);
  const toolbar = mount?.querySelector(":scope > .terminal-toolbar")
    || document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`);
  if (!mount || !toolbar) return;
  view.dataset.workspaceTabKey = key;
  view.dataset.terminalTabKey = key;
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("terminal", key, toolbar, mount);
  if (typeof placeWorkspaceToolbar === "function") placeWorkspaceToolbar("terminal", key, toolbar, mount);
  else {
    mount.replaceChildren(toolbar);
    toolbar.hidden = false;
    toolbar.classList.remove("terminal-toolbar-header");
  }
  if (typeof syncWorkspaceToolbarHostVisibility === "function") syncWorkspaceToolbarHostVisibility();
  updateTerminalStatusForLayout(key);
  scheduleTerminalFit();
}

function updateTerminalConnectionStatus(connection, key, state="") {
  const connectionStatus = state === "已连接" ? "connected" : state === "已断开" ? "disconnected" : "connecting";
  setWorkspaceTabConnectionStatus(key, connectionStatus);
  const status = terminalElementForKey(key, "#terminalStatus");
  if (!status) return;
  status.dataset.connectionAddress = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
  status.dataset.connectionState = state;
  const dot = status.closest(".terminal-title-row")?.querySelector(".terminal-connection-dot");
  if (dot) dot.className = `terminal-connection-dot ${connectionStatus}`;
  updateTerminalStatusForLayout(key);
  updateTerminalConnectionToggle(key);
}

function updateTerminalConnectionToggle(key) {
  const session = terminalSessions.get(key);
  const button = terminalElementForKey(key, ".terminal-action-reconnect");
  if (!button) return;
  const connecting = Boolean(session?.socket && session.socket.readyState === WebSocket.CONNECTING);
  const connected = Boolean(session?.connected && session.socket?.readyState === WebSocket.OPEN);
  button.disabled = connecting;
  button.classList.toggle("is-connected", connected);
  button.title = connecting ? "正在连接" : connected ? "断开终端连接" : "重新连接终端";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = connected
    ? `${icon("link-2-off")}<span>断开</span>`
    : `${icon(connecting ? "loader-circle" : "link-2")}<span>${connecting ? "连接中" : "重连"}</span>`;
}

function terminalLatencyTone(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "pending";
  if (milliseconds < 100) return "good";
  if (milliseconds < 250) return "medium";
  return "slow";
}

function terminalLatencyText(session) {
  return Number.isFinite(session?.latencyMs) ? `${session.latencyMs} ms` : "-- ms";
}

function terminalLatencyHtml(key) {
  const session = terminalSessions.get(key);
  const latency = Number(session?.latencyMs);
  return `<span id="terminalLatency" class="terminal-latency ${terminalLatencyTone(latency)}" title="交互响应延迟：从按键发送到远端终端首次返回数据的时间" ${terminalLatencyVisible ? "" : "hidden"}>${icon("gauge")}<span>${esc(terminalLatencyText(session))}</span></span>`;
}

function updateTerminalLatencyDisplay(key) {
  const indicator = terminalElementForKey(key, "#terminalLatency");
  if (!indicator) return;
  const session = terminalSessions.get(key);
  const latency = Number(session?.latencyMs);
  indicator.hidden = !terminalLatencyVisible;
  indicator.className = `terminal-latency ${terminalLatencyTone(latency)}`;
  indicator.innerHTML = `${icon("gauge")}<span>${esc(terminalLatencyText(session))}</span>`;
  indicator.title = Number.isFinite(latency)
    ? `最近交互响应延迟 ${latency} ms；从按键发送到远端终端首次返回数据`
    : "交互响应延迟：从按键发送到远端终端首次返回数据的时间";
}

function setTerminalLatencyVisible(visible) {
  terminalLatencyVisible = Boolean(visible);
  localStorage.setItem("terminalLatencyVisible", terminalLatencyVisible ? "1" : "0");
  const input = $("terminalLatencyVisible");
  if (input) input.checked = terminalLatencyVisible;
  if (!terminalLatencyVisible) {
    for (const session of terminalSessions.values()) {
      session.latencyPendingAt = 0;
      clearTimeout(session.latencyPendingTimer);
      session.latencyPendingTimer = null;
    }
  }
  for (const key of terminalSessions.keys()) updateTerminalLatencyDisplay(key);
}

function startTerminalLatencySample(session) {
  if (!terminalLatencyVisible || !session?.connected || session.latencyPendingAt) return;
  const now = performance.now();
  if (now - Number(session.latencySampledAt || 0) < 500) return;
  session.latencyPendingAt = now;
  clearTimeout(session.latencyPendingTimer);
  session.latencyPendingTimer = setTimeout(() => {
    session.latencyPendingAt = 0;
    session.latencyPendingTimer = null;
  }, 5000);
}

function finishTerminalLatencySample(session, key) {
  const startedAt = Number(session?.latencyPendingAt || 0);
  if (!startedAt) return;
  session.latencyPendingAt = 0;
  clearTimeout(session.latencyPendingTimer);
  session.latencyPendingTimer = null;
  const sample = Math.max(0, Math.round(performance.now() - startedAt));
  if (sample > 5000) return;
  session.latencySamples = [...(session.latencySamples || []), sample].slice(-5);
  const ordered = [...session.latencySamples].sort((left, right) => left - right);
  session.latencyMs = ordered[Math.floor(ordered.length / 2)];
  session.latencySampledAt = performance.now();
  updateTerminalLatencyDisplay(key);
}

function createTerminalLogId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now()}-${String(random).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

function nextTerminalTabIndex(connectionId) {
  const id = Number(connectionId);
  const siblings = tabs.filter(tab => tab.kind === "terminal" && Number(tab.id) === id);
  let current = siblings.length ? Number(terminalCounts.get(id) || 0) : 0;
  for (const tab of siblings) {
    current = Math.max(current, Number(String(tab.key).match(new RegExp(`^terminal-${id}-(\\d+)$`))?.[1] || 0));
  }
  let next = current + 1;
  while (tabs.some(tab => tab.key === `terminal-${id}-${next}`) || terminalSessions.has(`terminal-${id}-${next}`)) next += 1;
  terminalCounts.set(id, next);
  return next;
}

function openTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const c = selectConnection(id);
  if (!c) return;
  if (updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(c.id, "terminal");
  let key = existingKey;
  let title = existingTitle;
  if (!key) {
    const next = nextTerminalTabIndex(c.id);
    key = `terminal-${c.id}-${next}`;
    title = `${c.name} · 终端${next > 1 ? ` #${next}` : ""}`;
  } else {
    const restoredIndex = Number(String(key).match(new RegExp(`^terminal-${c.id}-(\\d+)$`))?.[1] || 0);
    if (restoredIndex > 0) {
      terminalCounts.set(c.id, Math.max(terminalCounts.get(c.id) || 0, restoredIndex));
    }
  }
  const connectionAddress = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  const forwardButton = connectionToggleButton(c)
    .replace("connection-forward-toggle", "connection-forward-toggle terminal-action-forward")
    .replace("<button ", "<button onpointerdown=\"keepTerminalKeyboardClosed(event)\" ");
  const forwardListButton = `<button class="terminal-action-forward-list" type="button" title="转发列表" aria-label="转发列表" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openForwards(${c.id})">${icon("route")}<span>转发列表</span></button>`;
  const terminalView = $("view-terminal");
  terminalView.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><div class="terminal-status" id="terminalStatus" title="${esc(connectionAddress)}">${esc(connectionAddress)}</div>${terminalLatencyHtml(key)}</div><div class="actions terminal-actions"><button class="icon-button terminal-action-sftp" title="打开此连接的 SFTP" aria-label="打开此连接的 SFTP" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openSftp(${c.id})">${icon("folder-open")}<span>SFTP</span></button><button class="icon-button terminal-action-font" title="减小字体（Ctrl+滚轮）" aria-label="减小字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',-1)">${icon("minus")}</button><button class="icon-button terminal-action-font" title="增大字体（Ctrl+滚轮）" aria-label="增大字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',1)">${icon("plus")}</button><button class="terminal-dropdown-button terminal-action-display terminal-action-encoding" title="切换终端编码：${escAttr(terminalEncodingLabel(c, key))}" aria-label="切换终端编码" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalEncodingMenu(event,'${key}',${c.id})">${icon("earth")}<span>${esc(terminalEncodingLabel(c, key))}</span>${icon("chevron-down")}</button><button class="terminal-dropdown-button terminal-action-display" title="切换终端字体" aria-label="切换终端字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalFontMenu(event,'${key}',${c.id})">${icon("type")}<span>字体</span>${icon("chevron-down")}</button><button class="icon-button terminal-startup-button" title="终端配置" aria-label="终端配置" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalStartupSettings('${key}',${c.id})">${icon("command")}<span>配置</span></button><button class="icon-button terminal-global-settings-button" title="全局终端设置" aria-label="全局终端设置" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalGlobalSettings('${key}')">${icon("settings")}</button><button class="terminal-action-keys" title="${terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"}" aria-label="${terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalKeys('${key}')">${icon("keyboard")}<span>${terminalKeysVisible ? "隐藏快捷键" : "快捷键"}</span></button><button class="terminal-action-recent" title="最近命令" aria-label="最近命令" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showRecentTerminalCommands('${key}')">${icon("history")}<span>最近命令</span></button><button class="terminal-action-reconnect" title="重新连接终端" aria-label="重新连接终端" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalConnection(${c.id}, '${key}')">${icon("link-2")}<span>重连</span></button>${forwardListButton}${forwardButton}</div></div>${renderTerminalKeys(key)}<div id="terminalMount" class="terminal-box"></div><div class="terminal-mobile-composer"><input id="terminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入命令" onkeydown="handleMobileTerminalInput(event,'${key}')"><button class="primary icon-button" title="发送命令" onclick="sendMobileTerminalInput('${key}')">${icon("send")}</button></div>`;
  terminalView.querySelector(".terminal-startup-button")?.insertAdjacentHTML("afterend", `<button class="icon-button terminal-x11-button${c.x11_mode && c.x11_mode !== "off" ? " active" : ""}" title="X11 图形转发" aria-label="X11 图形转发" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showX11LaunchMenu(event,${c.id})">${icon("x11")}</button>`);
  if (typeof remoteDesktopJumpButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", remoteDesktopJumpButtonHtml(c.id));
  }
  if (typeof localFilesToolbarButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", localFilesToolbarButtonHtml(key));
  }
  terminalView.dataset.workspaceTabKey = key;
  terminalView.dataset.terminalTabKey = key;
  const toolbar = terminalView.querySelector(":scope > .terminal-toolbar");
  const toolbarMount = document.createElement("div");
  toolbarMount.id = "terminalToolbarMount";
  toolbar.before(toolbarMount);
  toolbarMount.appendChild(toolbar);
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("terminal", key, toolbar, toolbarMount);
  const terminalStatus = $("terminalStatus");
  terminalStatus.dataset.connectionAddress = connectionAddress;
  terminalStatus.dataset.connectionState = "连接中";
  setWorkspace(title, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "terminal", key, updateTab, true, {kind:"terminal", id:c.id});
  syncTerminalToolbarPlacement(key);
  updateTerminalStartupButton(key, c);
  attachTerminal(c, key).catch(error => {
    const mount = terminalElementForKey(key, "#terminalMount");
    if (mount) mount.innerHTML = stateView("error", "终端组件加载失败", error.message, `<button onclick="reconnectTerminal(${c.id},'${key}')">重新连接</button>`);
  });
  return key;
}

async function attachTerminal(c, key) {
  const mount = $("terminalMount");
  if (!mount) return;
  await ensureTerminalGlobalSettings();
  await ensureTerminalLibs();
  let session = terminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({
      allowProposedApi:true,
      cursorBlink:true,
      convertEol:true,
      minimumContrastRatio:4.5,
      overviewRuler:{width:8},
      fontFamily:c.terminal_font_family || "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize:terminalFontSizeForCurrentLayout(c),
      lineHeight:Number(c.terminal_line_height) || 1,
      fontWeight:c.terminal_font_weight || "normal",
      wordSeparator:terminalWordSeparator(),
      theme:terminalThemeForSettings()
    });
    const fit = createTerminalFitAddon(term);
    term.loadAddon(fit);
    session = {term, fit, socket:null, connected:false, id:c.id, logId:createTerminalLogId(), terminalEncoding:c.terminal_encoding || "utf8", fontLayoutMobile:isMobileLayout(), currentDirectory:"", currentDirectoryKnown:false};
    terminalSessions.set(key, session);
    registerTerminalDirectoryTracking(session);
  }
  session.connection = c;
  session.key = key;
  session.fontLayoutMobile = isMobileLayout();
  session.mount = mount;
  session.term.options.fontSize = terminalFontSizeForCurrentLayout(c);
  applyTerminalGlobalSettingsToSession(session);
  if (session.term.element) mount.appendChild(session.term.element);
  else session.term.open(mount);
  bindTerminalDropUpload(session, c, key, mount);
  bindTerminalGlobalBehavior(session, key, c.id, mount);
  observeTerminalBox(session);
  enableTerminalTouchScroll(session);
  enableTerminalFontWheel(session, key);
  setTimeout(()=>{
    try { session.fit.fit(); } catch {}
    if (!isMobileLayout()) try { session.term.focus(); } catch {}
    if (!session.socket) connectTerminal(c, key);
    else {
      updateTerminalConnectionStatus(c, key, session.connected ? "已连接" : "已断开");
      updateTerminalLatencyDisplay(key);
    }
    scheduleTerminalFit();
  }, 0);
}

function enableTerminalFontWheel(session, key) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || session.fontWheelBox === box) return;
  session.fontWheelBox = box;
  box.addEventListener("wheel", event => {
    if (!event.ctrlKey) {
      flushTerminalViewportFit(session);
      return;
    }
    if (!event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    queueTerminalFontWheelChange(session, key, event.deltaY < 0 ? 1 : -1);
  }, {passive:false,capture:true});
}

function queueTerminalFontWheelChange(session, key, delta) {
  session.pendingFontWheelDelta = Math.max(-4, Math.min(4, Number(session.pendingFontWheelDelta || 0) + delta));
  if (session.pendingFontWheelTask) return;
  session.pendingFontWheelTask = scheduleTerminalViewportTask(() => {
    session.pendingFontWheelTask = null;
    const pending = Number(session.pendingFontWheelDelta || 0);
    session.pendingFontWheelDelta = 0;
    if (pending) changeTerminalFont(key, pending);
  });
}

function observeTerminalBox(session) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || typeof ResizeObserver === "undefined") return;
  if (session.observedBox === box && session.resizeObserver) return;
  session.resizeObserver?.disconnect?.();
  session.resizeObserver = new ResizeObserver(() => scheduleTerminalFit());
  session.resizeObserver.observe(box);
  session.observedBox = box;
}

function enableTerminalTouchScroll(session) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || session.touchScrollBox === box) return;
  session.touchScrollBox = box;
  let lastY = 0;
  let carry = 0;
  box.addEventListener("touchstart", event => {
    if (event.target.closest?.("button,a,input,textarea,select")) return;
    lastY = event.touches[0]?.clientY || 0;
    carry = 0;
  }, {passive:true});
  box.addEventListener("touchmove", event => {
    if (event.target.closest?.("button,a,input,textarea,select")) return;
    if (session.cursorCopyState) {
      event.preventDefault();
      return;
    }
    const y = event.touches[0]?.clientY || lastY;
    const dy = y - lastY;
    lastY = y;
    carry += dy;
    const lineHeight = session.term?._core?._renderService?.dimensions?.css?.cell?.height || 18;
    const lines = Math.trunc(carry / lineHeight);
    if (lines) {
      try { session.term.scrollLines(-lines); } catch {}
      carry -= lines * lineHeight;
      event.preventDefault();
    }
  }, {passive:false});
}

function handleMobileTerminalInput(event, key) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  sendMobileTerminalInput(key);
}

function sendMobileTerminalInput(key) {
  const input = $("terminalMobileInput");
  const command = String(input?.value || "");
  if (!command.trim()) return;
  const session = terminalSessions.get(key);
  const connection = session ? currentConnection(session.id) : null;
  if (session && connection) void trackTerminalDirectoryCommand(session, connection, key, command);
  if (typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
  sendTerminalData(key, `${command}\r`);
  saveRecentTerminalCommand(command);
  input.value = "";
  input.focus();
}

function renderTerminalKeys(key) {
  return `<div id="terminalKeys" class="terminal-keys ${terminalKeysVisible ? "" : "hidden"}">
    ${["Esc","Tab","/","-","|","~"].map(label => `<button onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','${escAttr(label)}')">${esc(label)}</button>`).join("")}
    <span class="terminal-arrow-pad"><button class="arrow-up" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↑')">↑</button><button class="arrow-left" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','←')">←</button><button class="arrow-down" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↓')">↓</button><button class="arrow-right" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','→')">→</button></span>
    <button class="${terminalCtrlArmed || terminalCtrlLocked ? "active" : ""}" title="Ctrl 一次：下一个字母按 Ctrl 组合键发送" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="armTerminalCtrl(event)">Ctrl一次</button>
    <button class="${terminalCtrlLocked ? "active" : ""}" title="Ctrl 锁定：连续发送 Ctrl 组合键，再点一次关闭" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleCtrlLock()">Ctrl锁</button>
    ${["C","D","L","A","E","R","Z"].map(label => `<button onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendCtrlCombo('${key}','${label}')">^${label}</button>`).join("")}
  </div>`;
}

function rerenderTerminalKeys(key=activeTabKey) {
  const box = $("terminalKeys");
  if (!box) return;
  const left = box.scrollLeft;
  box.outerHTML = renderTerminalKeys(key);
  const next = $("terminalKeys");
  if (next) next.scrollLeft = left;
}

function toggleTerminalKeys(key) {
  terminalKeysVisible = !terminalKeysVisible;
  localStorage.setItem("terminalKeysVisible", terminalKeysVisible ? "1" : "0");
  openTerminal(currentConnection()?.id || selectedId, false, key, tabs.find(tab => tab.key === key)?.title || "");
}

function armTerminalCtrl() {
  terminalCtrlArmed = !terminalCtrlArmed;
  rerenderTerminalKeys();
}

function toggleCtrlLock() {
  terminalCtrlLocked = !terminalCtrlLocked;
  terminalCtrlArmed = false;
  rerenderTerminalKeys();
}

function terminalSequence(label) {
  return {Esc:"\x1b", Tab:"\t", "↑":"\x1b[A", "↓":"\x1b[B", "→":"\x1b[C", "←":"\x1b[D"}[label] || label;
}

function terminalReconnectInput(data) {
  return ["\r", "\n", "\r\n"].includes(String(data || ""));
}

function sendTerminalData(key, data, options={}) {
  const session = terminalSessions.get(key);
  if (!session) return false;
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    if (terminalReconnectInput(data)) {
      if (session.socket?.readyState !== WebSocket.CONNECTING) reconnectTerminal(session.id, key);
      return true;
    }
    notify("终端尚未连接", "error");
    return false;
  }
  startTerminalLatencySample(session);
  session.socket.send(data);
  const shouldFocus = options.focus ?? !isMobileLayout();
  if (shouldFocus) try { session.term.focus(); } catch {}
  return true;
}

function transformTerminalInputForCtrl(key, data) {
  if (!(terminalCtrlArmed || terminalCtrlLocked)) return data;
  if (!/^[A-Za-z]$/.test(data)) return data;
  const code = data.toUpperCase().charCodeAt(0) - 64;
  if (code < 1 || code > 26) return data;
  if (!terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
  return String.fromCharCode(code);
}

function sendTerminalKey(key, label) {
  if ((terminalCtrlArmed || terminalCtrlLocked) && /^[A-Za-z]$/.test(label)) {
    sendCtrlCombo(key, label);
    return;
  }
  sendTerminalData(key, terminalSequence(label));
  if (terminalCtrlArmed && !terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
}

function sendCtrlCombo(key, letter) {
  const code = String(letter).toUpperCase().charCodeAt(0) - 64;
  if (code < 1 || code > 26) return;
  sendTerminalData(key, String.fromCharCode(code));
  if (!terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
}

function showRecentTerminalCommands(key) {
  const items = recentTerminalCommands.slice(0, 80);
  if (!items.length) return notify("暂无最近命令", "info");
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card wide"><h2>最近命令</h2><div class="muted">序号 1 为最近一次执行</div><div class="recent-command-list">${items.map((cmd, index) => `<button data-index="${index}"><span class="recent-command-index">${index + 1}</span><code>${esc(cmd)}</code></button>`).join("")}</div><div class="actions"><button id="recentCommandClear" class="danger">清空</button><button id="recentCommandClose">关闭</button></div></div>`;
  modal.hidden = false;
  modal.querySelectorAll(".recent-command-list button").forEach(button => {
    button.onclick = () => {
      const cmd = items[Number(button.dataset.index)];
      modal.hidden = true;
      sendTerminalData(key, `${cmd}\r`);
    };
  });
  $("recentCommandClear").onclick = () => {
    recentTerminalCommands = [];
    localStorage.removeItem("recentTerminalCommands");
    modal.hidden = true;
    notify("最近命令已清空", "success");
    focusTerminalSession(key);
  };
  $("recentCommandClose").onclick = () => {
    modal.hidden = true;
    focusTerminalSession(key);
  };
}

function cleanTerminalCommandText(text) {
  return String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trim();
}

function currentTerminalPromptCommand(session) {
  try {
    const buffer = session.term?.buffer?.active;
    const row = buffer?.baseY + buffer?.cursorY;
    const line = buffer?.getLine(row)?.translateToString(true) || "";
    const text = cleanTerminalCommandText(line);
    const markers = ["# ", "$ ", "% ", "> "];
    let index = -1;
    for (const marker of markers) index = Math.max(index, text.lastIndexOf(marker));
    return index >= 0 ? text.slice(index + 2).trim() : "";
  } catch {
    return "";
  }
}

function terminalFontSizeField() {
  return isMobileLayout() ? "terminal_mobile_font_size" : "terminal_font_size";
}

function terminalFontSizeForCurrentLayout(connection) {
  return Number(connection?.[terminalFontSizeField()]) || 13;
}

function captureTerminalViewport(session) {
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return null;
  const viewportY = Number(buffer.viewportY ?? buffer.ydisp ?? 0);
  const baseY = Number(buffer.baseY ?? buffer.ybase ?? 0);
  return {
    viewportY:Math.max(0, viewportY),
    atBottom:viewportY >= Math.max(0, baseY)
  };
}

function scrollTerminalToLineImmediately(term, line) {
  const viewport = term?._core?._viewport;
  if (typeof viewport?.scrollToLine === "function") {
    viewport.scrollToLine(line, true);
    return;
  }
  term?.scrollToLine?.(line);
}

function scheduleTerminalViewportTask(callback) {
  if (typeof requestAnimationFrame === "function") {
    return {frame:requestAnimationFrame(callback)};
  }
  return {timer:setTimeout(callback, 0)};
}

function cancelTerminalViewportTask(task) {
  if (!task) return;
  if (task.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(task.frame);
  if (task.timer) clearTimeout(task.timer);
}

function terminalViewportPixelDrift(term, target) {
  const viewport = term?._core?._viewport;
  const scrollableElement = viewport?._scrollableElement;
  const cellHeight = Number(term?._core?._renderService?.dimensions?.css?.cell?.height || 0);
  if (!scrollableElement || !cellHeight) return false;
  const expected = target * cellHeight;
  const current = Number(scrollableElement.getScrollPosition?.()?.scrollTop);
  const future = Number(scrollableElement._scrollable?.getFutureScrollPosition?.()?.scrollTop);
  return [current, future].some(value => Number.isFinite(value) && Math.abs(value - expected) > 0.75);
}

function restoreTerminalViewport(session, anchor) {
  const term = session?.term;
  const buffer = term?.buffer?.active;
  if (!term || !buffer || !anchor) return;
  const baseY = Math.max(0, Number(buffer.baseY ?? buffer.ybase ?? 0));
  const target = anchor.atBottom
    ? baseY
    : Math.max(0, Math.min(baseY, Number(anchor.viewportY) || 0));
  const current = Math.max(0, Number(buffer.viewportY ?? buffer.ydisp ?? 0));
  if (Math.abs(current - target) < 0.5 && !terminalViewportPixelDrift(term, target)) return;
  try {
    scrollTerminalToLineImmediately(term, target);
  } catch {}
}

function runPendingTerminalViewportFit(session) {
  const anchor = session?.terminalViewportFitAnchor;
  if (!session?.term || !session.fit || !anchor) return;
  cancelTerminalViewportTask(session.terminalViewportFitTask);
  session.terminalViewportFitTask = null;
  session.terminalViewportFitAnchor = null;
  try { session.fit.fit(); } catch {}
  try { session.term.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
  restoreTerminalViewport(session, anchor);
  cancelTerminalViewportTask(session.terminalViewportRestoreTask);
  session.terminalViewportRestoreTask = scheduleTerminalViewportTask(() => {
    session.terminalViewportRestoreTask = null;
    restoreTerminalViewport(session, anchor);
  });
}

function fitTerminalPreservingViewport(session, anchor=captureTerminalViewport(session)) {
  if (!session?.term || !session.fit || !anchor) return;
  if (!session.terminalViewportFitAnchor) session.terminalViewportFitAnchor = anchor;
  if (session.terminalViewportFitTask) return;
  session.terminalViewportFitTask = scheduleTerminalViewportTask(() => runPendingTerminalViewportFit(session));
}

function flushTerminalViewportFit(session) {
  if (session?.terminalViewportFitTask) runPendingTerminalViewportFit(session);
  cancelTerminalViewportTask(session?.terminalViewportRestoreTask);
  if (session) session.terminalViewportRestoreTask = null;
}

function syncTerminalResponsiveFontSizes() {
  const mobile = isMobileLayout();
  for (const session of terminalSessions.values()) {
    if (!session?.term?.options) continue;
    if (session.fontLayoutMobile === mobile) continue;
    const connection = connections.find(item => item.id === session.id);
    if (!connection) continue;
    const viewport = captureTerminalViewport(session);
    session.fontLayoutMobile = mobile;
    session.term.options.fontSize = terminalFontSizeForCurrentLayout(connection);
    fitTerminalPreservingViewport(session, viewport);
  }
}

function changeTerminalFont(key, delta) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const viewport = captureTerminalViewport(session);
  const size = Math.max(10, Math.min(32, Number(session.term.options.fontSize || 13) + delta));
  session.term.options.fontSize = size;
  const connection = connections.find(item => item.id === session.id);
  if (connection) {
    connection[terminalFontSizeField()] = size;
    scheduleTerminalPreferencesSave(connection);
  }
  fitTerminalPreservingViewport(session, viewport);
  focusTerminalSession(key);
}

const terminalPreferencesSaveTimers = new Map();

function scheduleTerminalPreferencesSave(connection) {
  clearTimeout(terminalPreferencesSaveTimers.get(connection.id));
  terminalPreferencesSaveTimers.set(connection.id, setTimeout(() => {
    terminalPreferencesSaveTimers.delete(connection.id);
    api(`/api/connections/${connection.id}/terminal-preferences`, {
      method:"POST",
      body:JSON.stringify({
        terminal_encoding:connection.terminal_encoding || "utf8",
        terminal_font_family:connection.terminal_font_family,
        terminal_font_size:connection.terminal_font_size,
        terminal_mobile_font_size:connection.terminal_mobile_font_size,
        terminal_line_height:connection.terminal_line_height ?? 1,
        terminal_font_weight:connection.terminal_font_weight || "normal"
      })
    }).catch(error => notify(`终端设置保存失败：${error.message}`, "error"));
  }, 300));
}

function focusTerminalSession(key) {
  const session = terminalSessions.get(key);
  setTimeout(() => {
    try { session?.term.focus(); } catch {}
  }, 0);
}

function showTerminalEncodingMenu(event, key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = terminalSessionEncoding(key, connection);
  showActionMenu(event, terminalEncodingOptions.map(([value,label]) => ({
    label,
    icon:value === current ? "check" : "earth",
    run:()=>applyTerminalPreferences(key, connectionId, {terminal_encoding:value}, `编码已切换为 ${label}`)
  })));
}

function showTerminalFontMenu(event, key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = connection.terminal_font_family || terminalFontOptions[0][0];
  const currentLineHeight = Number(connection.terminal_line_height) || 1;
  const currentWeight = connection.terminal_font_weight || "normal";
  showActionMenu(event, [
    ...terminalFontOptions.map(([value,label]) => ({
      label,
      icon:value === current ? "check" : "type",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_family:value}, `终端字体已切换为 ${label}`)
    })),
    {separator:true},
    {label:"自定义字体…", icon:"pencil", run:()=>setCustomTerminalFont(key, connectionId)},
    {separator:true},
    ...[[1,"紧凑行距 1.0"],[1.2,"行距 1.2"],[1.4,"行距 1.4"],[1.6,"宽松行距 1.6"]].map(([value,label]) => ({
      label,
      icon:Number(value) === currentLineHeight ? "check" : "between-horizontal-start",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_line_height:Number(value)}, `终端${label}已保存`)
    })),
    {separator:true},
    ...[["normal","常规字重"],["500","中等字重"],["600","半粗字重"],["bold","粗体"]].map(([value,label]) => ({
      label,
      icon:value === currentWeight ? "check" : "bold",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_weight:value}, `终端${label}已保存`)
    })),
    {separator:true},
    {label:"恢复终端显示默认值", icon:"rotate-ccw", run:()=>resetTerminalDisplayPreferences(key, connectionId)}
  ]);
}

async function setCustomTerminalFont(key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const value = await inputModal("自定义终端字体", "字体名称或字体栈", connection.terminal_font_family || terminalFontOptions[0][0]);
  if (value) await applyTerminalPreferences(key, connectionId, {terminal_font_family:value}, "自定义终端字体已保存");
  else focusTerminalSession(key);
}

async function resetTerminalDisplayPreferences(key, connectionId) {
  await applyTerminalPreferences(key, connectionId, {
    terminal_font_family:terminalFontOptions[0][0],
    [terminalFontSizeField()]:13,
    terminal_line_height:1,
    terminal_font_weight:"normal"
  }, "终端字体、字号、行距和字重已恢复默认");
}

async function applyTerminalPreferences(key, connectionId, changes, successText="终端设置已保存") {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  try {
    const settings = await api(`/api/connections/${connectionId}/terminal-preferences`, {
      method:"POST",
      body:JSON.stringify({
        terminal_encoding:changes.terminal_encoding ?? connection.terminal_encoding ?? "utf8",
        terminal_font_family:changes.terminal_font_family ?? connection.terminal_font_family ?? terminalFontOptions[0][0],
        terminal_font_size:changes.terminal_font_size ?? connection.terminal_font_size ?? 13,
        terminal_mobile_font_size:changes.terminal_mobile_font_size ?? connection.terminal_mobile_font_size ?? 13,
        terminal_line_height:changes.terminal_line_height ?? connection.terminal_line_height ?? 1,
        terminal_font_weight:changes.terminal_font_weight ?? connection.terminal_font_weight ?? "normal"
      })
    });
    Object.assign(connection, settings);
    for (const [sessionKey, activeSession] of terminalSessions) {
      if (activeSession.id !== connectionId) continue;
      const viewport = captureTerminalViewport(activeSession);
      activeSession.term.options.fontFamily = settings.terminal_font_family;
      activeSession.term.options.fontSize = terminalFontSizeForCurrentLayout(settings);
      activeSession.fontLayoutMobile = isMobileLayout();
      activeSession.term.options.lineHeight = settings.terminal_line_height;
      activeSession.term.options.fontWeight = settings.terminal_font_weight;
      fitTerminalPreservingViewport(activeSession, viewport);
      const encodingButton = terminalElementForKey(sessionKey, ".terminal-action-encoding span");
      if (encodingButton) encodingButton.textContent = terminalEncodingLabel(connection, sessionKey);
    }
    if (changes.terminal_encoding !== undefined) {
      const activeSession = terminalSessions.get(key);
      if (activeSession?.id === connectionId) {
        activeSession.terminalEncoding = settings.terminal_encoding;
        const socket = activeSession.socket;
        const sendEncoding = () => {
          if (activeSession.socket !== socket || activeSession.terminalEncoding !== settings.terminal_encoding) return;
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:"terminal-encoding", encoding:settings.terminal_encoding}));
        };
        if (socket?.readyState === WebSocket.OPEN) sendEncoding();
      }
    }
    notify(successText, "success");
  } finally {
    focusTerminalSession(key);
  }
}

function terminalBufferText(session) {
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return "";
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  return lines.join("\n").replace(/\s+$/, "");
}

function closeTerminalSessionText(key) {
  const modal = $("modal");
  modal.onclick = null;
  modal.onkeydown = null;
  modal.hidden = true;
  modal.innerHTML = "";
  focusTerminalSession(key);
}

function showTerminalSessionText(key) {
  const session = terminalSessions.get(key);
  if (!session) return notify("终端会话不存在", "error");
  const text = formatTerminalCopiedText(terminalBufferText(session));
  if (!text) return notify("终端暂无可复制内容", "info");
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card terminal-session-text-modal" role="dialog" aria-modal="true" aria-labelledby="terminalSessionTextTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalSessionTextTitle">选择文本</h2><span>${text.split("\n").length} 行 · ${text.length} 个字符</span></div><button id="terminalSessionTextClose" class="icon-button" type="button" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <textarea id="terminalSessionTextEditor" class="terminal-session-text-editor" readonly spellcheck="false" aria-label="整个终端会话文本"></textarea>
    <div class="actions terminal-session-text-actions"><button id="terminalSessionTextCancel" type="button">关闭</button><button id="terminalSessionTextCopy" class="primary" type="button">${icon("copy-check")}<span>复制全部</span></button></div>
  </div>`;
  modal.hidden = false;
  const editor = $("terminalSessionTextEditor");
  editor.value = text;
  $("terminalSessionTextClose").onclick = () => closeTerminalSessionText(key);
  $("terminalSessionTextCancel").onclick = () => closeTerminalSessionText(key);
  $("terminalSessionTextCopy").onclick = async () => {
    if (await copyText(editor.value)) closeTerminalSessionText(key);
  };
  modal.onkeydown = event => {
    if (event.key === "Escape") closeTerminalSessionText(key);
  };
  editor.focus({preventScroll:true});
  editor.scrollTop = editor.scrollHeight;
}

async function copyTerminalText(key) {
  const session = terminalSessions.get(key);
  if (!session) return notify("终端会话不存在", "error");
  const text = session.term.hasSelection?.() ? session.term.getSelection() : "";
  if (!text) return notify("请先选择终端文本", "info");
  await copyText(formatTerminalCopiedText(text));
}

async function pasteTerminalText(key) {
  let text = "";
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
    text = await navigator.clipboard.readText();
  } catch {
    notify("无法直接读取剪贴板，请在编辑框中使用系统粘贴", "info");
    text = await editTerminalMultilinePaste("");
    if (text === null) {
      focusTerminalSession(key);
      return false;
    }
  }
  if (!text) return notify("剪贴板中没有文本", "info");
  return sendTerminalPasteText(key, text);
}

function showTerminalContextMenu(event, key, connectionId) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const mobile = isMobileLayout();
  showActionMenu(event, [
    ...(!mobile ? [{label:"复制选中", icon:"copy", run:()=>copyTerminalText(key)}] : []),
    {label:"光标复制", icon:"mouse-pointer-2", run:()=>startTerminalCursorCopy(key)},
    {label:"会话复制", icon:"copy-check", run:()=>showTerminalSessionText(key)},
    {label:"粘贴", icon:"clipboard-paste", run:()=>pasteTerminalText(key)},
    {separator:true},
    {label:"清屏", icon:"eraser", run:()=>{ session.term.clear(); session.term.focus(); }},
    {label:"滚动到底部", icon:"arrow-down-to-line", run:()=>session.term.scrollToBottom()},
    {label:session.term.getSelection?.().trim() ? "在 SFTP 打开选中路径" : "在 SFTP 打开当前目录", icon:"folder-open", run:()=>openTerminalPathInSftp(connectionId, key)},
    {separator:true},
    {label:"终端配置", icon:"command", run:()=>showTerminalStartupSettings(key, connectionId)},
    {label:session.connected ? "断开连接" : "重新连接", icon:session.connected ? "link-2-off" : "link-2", run:()=>toggleTerminalConnection(connectionId, key)},
    ...(!mobile ? [{separator:true}, {label:"全局终端设置", icon:"settings", run:()=>showTerminalGlobalSettings(key)}] : [])
  ]);
}

async function connectTerminal(c, key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const attempt = Number(session.connectionAttempt || 0) + 1;
  session.connectionAttempt = attempt;
  const previousSocket = session.socket;
  session.socket = null;
  try { previousSocket?.close(); } catch {}
  try { session.inputDisposable?.dispose(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const title = tab?.title || `${c.name} · 终端`;
  session.connected = false;
  session.currentDirectory = "";
  session.currentDirectoryKnown = false;
  session.previousDirectory = "";
  session.homeDirectory = "";
  updateTerminalConnectionStatus(c, key, "连接中");
  session.term.writeln(`连接 ${c.ssh_user}@${c.ssh_host}:${c.ssh_port} ...`);
  try {
    await api("/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection_id:c.id})
    });
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    session.term.writeln(`\r\n[${error.code === "SSH_HOST_TRUST_CANCELLED" ? "已取消连接" : `SSH 主机身份校验失败：${error.message}`}]`);
    updateTerminalConnectionStatus(c, key, "已断开");
    if (error.code !== "SSH_HOST_TRUST_CANCELLED") notify(error.message || "SSH 主机身份校验失败", "error");
    return;
  }
  let startupToken = "";
  try {
    if (terminalStartupOverrides.has(key)) {
      const ticket = await api("/api/terminal/startup-tickets", {
        method:"POST",
        body:JSON.stringify({
          connection_id:c.id,
          startup:terminalStartupOverrides.get(key)
        })
      });
      startupToken = ticket.token || "";
    }
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    session.term.writeln(`\r\n[临时启动配置准备失败：${error.message}]`);
    updateTerminalConnectionStatus(c, key, "已断开");
    notify(error.message || "临时启动配置准备失败", "error");
    return;
  }
  if (
    session.connectionAttempt !== attempt
    || terminalSessions.get(key) !== session
    || !(typeof workspaceHasTabKey === "function" ? workspaceHasTabKey(key) : tabs.some(item => item.key === key))
  ) return;
  const startupQuery = startupToken ? `&startup_token=${encodeURIComponent(startupToken)}` : "";
  const logQuery = session.logId ? `&log_id=${encodeURIComponent(session.logId)}` : "";
  const encodingQuery = `&encoding=${encodeURIComponent(session.terminalEncoding || c.terminal_encoding || "utf8")}`;
  const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal?id=${encodeURIComponent(c.id)}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}${encodingQuery}${logQuery}${startupQuery}`);
  socket.binaryType = "arraybuffer";
  session.socket = socket;
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    session.connected = true;
    socket.send(JSON.stringify({type:"terminal-encoding", encoding:session.terminalEncoding || c.terminal_encoding || "utf8"}));
    updateTerminalConnectionStatus(c, key, "已连接");
    void initializeTerminalDirectory(session, c, key);
  });
  socket.addEventListener("message", event => {
    if (session.socket !== socket) return;
    finishTerminalLatencySample(session, key);
    const terminalOutput = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    session.term.write(terminalOutput);
    if (typeof updateTerminalSmartState === "function") updateTerminalSmartState(key, typeof event.data === "string" ? event.data : "");
    if (isMobileLayout()) scheduleTerminalFit();
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.connected = false;
    session.latencyPendingAt = 0;
    clearTimeout(session.latencyPendingTimer);
    session.term.writeln("\r\n[连接已关闭，按 Enter 重新连接]");
    updateTerminalConnectionStatus(c, key, "已断开");
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) session.term.writeln("\r\n[WebSocket 连接失败]");
  });
  session.inputDisposable = session.term.onData(data => {
    const beforeCtrl = terminalCtrlArmed || terminalCtrlLocked;
    const outgoing = transformTerminalInputForCtrl(key, data);
    if (!beforeCtrl) trackTerminalCommand(session, data);
    if ((data.includes("\r") || data.includes("\n")) && typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
    if (socket.readyState === WebSocket.OPEN) {
      startTerminalLatencySample(session);
      if (!(typeof handleTerminalBroadcastInput === "function" && handleTerminalBroadcastInput(key, outgoing, data))) socket.send(outgoing);
    } else if (terminalReconnectInput(data) && session.socket === socket) {
      reconnectTerminal(c.id, key);
    }
  });
  session.resizeDisposable = session.term.onResize(size => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:"resize", cols:size.cols, rows:size.rows}));
  });
}

function trackTerminalCommand(session, data) {
  session.commandBuffer = session.commandBuffer || "";
  const raw = String(data || "");
  if (raw.includes("\x1b")) return;
  for (const ch of String(data || "")) {
    if (ch === "\r" || ch === "\n") {
      const command = currentTerminalPromptCommand(session) || session.commandBuffer;
      saveRecentTerminalCommand(command);
      const connection = currentConnection(session.id);
      if (connection) void trackTerminalDirectoryCommand(session, connection, session.key || activeTabKey, command);
      session.commandBuffer = "";
    } else if (ch === "\x7f" || ch === "\b") {
      session.commandBuffer = session.commandBuffer.slice(0, -1);
    } else if (ch === "\x03") {
      session.commandBuffer = "";
    } else if (ch === "\t") {
      session.commandBuffer = "";
    } else if (ch >= " " && ch !== "\x7f") {
      session.commandBuffer += ch;
    }
  }
}

function reconnectTerminal(id, key=`terminal-${id}-1`) {
  const c = currentConnection(id);
  if (!c) return;
  const session = terminalSessions.get(key);
  if (session) session.term.reset();
  connectTerminal(c, key);
  focusTerminalSession(key);
}

function disconnectTerminal(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  session.connectionAttempt = Number(session.connectionAttempt || 0) + 1;
  const socket = session.socket;
  session.connected = false;
  session.latencyPendingAt = 0;
  clearTimeout(session.latencyPendingTimer);
  try { socket?.close(1000, "user disconnect"); } catch {}
  updateTerminalConnectionStatus(currentConnection(session.id), key, "已断开");
  focusTerminalSession(key);
}

function toggleTerminalConnection(id, key=`terminal-${id}-1`) {
  const session = terminalSessions.get(key);
  if (session?.connected || session?.socket?.readyState === WebSocket.CONNECTING) disconnectTerminal(key);
  else reconnectTerminal(id, key);
}
