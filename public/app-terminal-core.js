function syncTermaTerminalComponentMessages() {
  const promptLabel = tr("terminal:a11y.prompt_label", {defaultValue:"终端输入"});
  const tooMuchOutput = tr("terminal:a11y.too_much_output", {defaultValue:"输出内容过多，无法由屏幕阅读器全部播报；请逐行导航阅读"});
  if (TerminalClass?.strings) {
    TerminalClass.strings.promptLabel = promptLabel;
    TerminalClass.strings.tooMuchOutput = tooMuchOutput;
  }
  document.querySelectorAll(".xterm-helper-textarea").forEach(element => element.setAttribute("aria-label", promptLabel));
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(syncTermaTerminalComponentMessages);

async function ensureTerminalLibs() {
  if (TerminalClass && FitAddonClass) {
    syncTermaTerminalComponentMessages();
    return;
  }
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
  if (!TerminalClass || !FitAddonClass) {
    const error = errors.join("; ") || tr("terminal:components.runtime_missing", {defaultValue:"未找到 Terminal/FitAddon"});
    throw new Error(tr("terminal:components.xterm_load_failed", {error, defaultValue:`xterm 组件加载失败：${error}`}));
  }
  syncTermaTerminalComponentMessages();
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`);
    if (found?.dataset.loaded === "1") return resolve();
    if (found) {
      found.addEventListener("load", resolve, { once:true });
      found.addEventListener("error", () => reject(new Error(tr("terminal:components.script_load_failed", {source:src, defaultValue:`组件脚本加载失败：${src}`}))), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(tr("terminal:components.script_load_failed", {source:src, defaultValue:`组件脚本加载失败：${src}`})));
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
  ["ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", tr("terminal:display.system_font", {defaultValue:"系统等宽"})],
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
  return session?.currentDirectoryKnown ? String(session.currentDirectory || ".") : tr("terminal:drop.current_directory", {defaultValue:"当前目录"});
}

function updateTerminalDropOverlay(session) {
  const overlay = session?.mount?.querySelector?.(".terminal-drop-overlay");
  if (!overlay || overlay.hidden) return;
  const label = overlay.querySelector(".terminal-drop-label");
  const directory = terminalDirectoryDropLabel(session);
  if (label) label.textContent = tr(overlay.dataset.mode === "copy" ? "terminal:drop.copy_to_current" : "terminal:drop.upload_to_current", {
    directory,
    defaultValue:overlay.dataset.mode === "copy" ? `松开复制到终端当前目录：${directory}` : `松开上传到终端当前目录：${directory}`
  });
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
    overlay.innerHTML = `<div class="terminal-drop-hint">${icon("upload-cloud")}<span class="terminal-drop-label">${esc(tr("terminal:drop.upload_hint", {defaultValue:"松开上传到终端当前目录"}))}</span></div>`;
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
      return notify(tr("terminal:drop.not_connected", {defaultValue:"终端尚未连接，无法接收文件"}), "error");
    }
    let directory = session.currentDirectoryKnown
      ? session.currentDirectory
      : await initializeTerminalDirectory(session, connection, key);
    if (!directory) {
      if (drag && typeof finishSftpDragPayload === "function") finishSftpDragPayload(drag);
      return notify(tr("terminal:drop.directory_unknown", {defaultValue:"无法确认终端当前目录，请先重连终端"}), "error");
    }
    if (localPayload) {
      if (typeof uploadLocalFilesToSftp !== "function") return notify(tr("terminal:drop.local_upload_unavailable", {defaultValue:"当前版本不支持本地文件上传"}), "error");
      try {
        await uploadLocalFilesToSftp(localPayload, {kind:"terminal", id:connection.id, title:tr("terminal:drop.target_title", {directory, defaultValue:`终端：${directory}`}), path:directory}, key);
      } catch (error) {
        notify(error.message || tr("terminal:drop.local_upload_failed", {defaultValue:"上传本地文件到终端失败"}), "error");
      }
      return;
    }
    if (drag) {
      if (typeof markSftpDragDropAccepted === "function") markSftpDragDropAccepted(drag, key);
      if (typeof copySftpDraggedItemsToDirectory !== "function") {
        if (typeof finishSftpDragPayload === "function") finishSftpDragPayload(drag);
        return notify(tr("terminal:drop.sftp_drop_unavailable", {defaultValue:"当前版本不支持 SFTP 项目拖入终端"}), "error");
      }
      return copySftpDraggedItemsToDirectory(drag, connection.id, directory, {title:tr("terminal:drop.target_title", {directory, defaultValue:`终端：${directory}`}), tabKey:key});
    }
    if (typeof collectDroppedFiles !== "function" || typeof uploadSftpFilesToDirectory !== "function") {
      return notify(tr("terminal:drop.upload_unavailable", {defaultValue:"当前版本不支持终端文件上传"}), "error");
    }
    try {
      const files = await collectDroppedFiles(event.dataTransfer);
      if (!files.length) throw new Error(tr("terminal:drop.no_upload_files", {defaultValue:"没有找到可上传的文件"}));
      await uploadSftpFilesToDirectory(files, connection.id, directory);
    } catch (error) {
      notify(error.message || tr("terminal:drop.upload_failed", {defaultValue:"终端文件上传失败"}), "error");
    }
  });
}

async function uploadLocalFilesToTerminalTab(payload, tab) {
  const key = String(tab?.key || "");
  const connection = currentConnection(Number(tab?.id || 0));
  const session = terminalSessions.get(key);
  if (!connection || !session?.connected) throw new Error(tr("terminal:drop.not_connected", {defaultValue:"终端尚未连接，无法接收文件"}));
  const directory = session.currentDirectoryKnown
    ? session.currentDirectory
    : await initializeTerminalDirectory(session, connection, key);
  if (!directory) throw new Error(tr("terminal:drop.directory_unknown", {defaultValue:"无法确认终端当前目录，请先重连终端"}));
  return uploadLocalFilesToSftp(payload, {kind:"terminal", id:connection.id, title:tr("terminal:drop.target_title", {directory, defaultValue:`终端：${directory}`}), path:directory}, key);
}

function terminalStartupConfigLabel(config) {
  const value = normalizeTerminalStartupConfig(config);
  if (value.terminal_startup_mode === "default") return tr("terminal:startup.server_default_shell", {defaultValue:"服务器默认 Shell"});
  return value.terminal_profile_name || value.terminal_program_path.split(/[\\/]/).pop() || tr("terminal:startup.custom_program", {defaultValue:"自定义程序"});
}

function terminalStartupProfileMatches(config, profile) {
  return config.terminal_startup_mode === "program"
    && String(config.terminal_program_path || "") === String(profile.path || "")
    && String(config.terminal_program_args || "") === String(profile.args || "")
    && String(config.terminal_working_directory || "") === String(profile.working_directory || "");
}
