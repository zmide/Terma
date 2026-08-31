function terminalSessionEncoding(key, connection) {
  return terminalSessions.get(key)?.terminalEncoding || connection?.terminal_encoding || "utf8";
}

function terminalEncodingLabel(connection, key="") {
  return terminalEncodingOptions.find(([value]) => value === terminalSessionEncoding(key, connection))?.[1] || "UTF-8";
}

function terminalConnectionStateLabel(state="connecting") {
  if (state === "connected") return tr("terminal:connection_state.connected", {defaultValue:"已连接"});
  if (state === "reconnecting") return tr("terminal:connection_state.reconnecting", {defaultValue:"重连中"});
  if (state === "disconnected") return tr("terminal:connection_state.disconnected", {defaultValue:"已断开"});
  if (state === "authentication") return tr("terminal:connection_state.authentication", {defaultValue:"等待认证"});
  if (state === "authorization") return tr("terminal:connection_state.authorization", {defaultValue:"等待授权"});
  return tr("terminal:connection_state.connecting", {defaultValue:"连接中"});
}

const TERMINAL_AUTO_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 15000, 30000];

function terminalSessionSupportsAutoReconnect(connection, session) {
  return Boolean(session && connection && !connection.quick_connection
    && String(connection.terminal_session_mode || "none") !== "persistent"
    && session.reconnectToken
    && session.everConnected
    && !session.manualDisconnecting
    && !session.authenticationFailed
    && !session.remoteSessionEnded);
}

function cancelTerminalAutoReconnect(session) {
  if (!session) return;
  clearTimeout(session.autoReconnectTimer);
  session.autoReconnectTimer = null;
  session.autoReconnectPending = false;
}

function scheduleTerminalAutoReconnect(connection, key, session) {
  if (!terminalSessionSupportsAutoReconnect(connection, session) || session.autoReconnectTimer) return false;
  if (session.connectionPending) {
    session.autoReconnectRequested = true;
    return false;
  }
  const attempt = Number(session.autoReconnectAttempts || 0);
  if (attempt >= TERMINAL_AUTO_RECONNECT_DELAYS.length) {
    session.autoReconnectPending = false;
    updateTerminalConnectionStatus(connection, key, "disconnected");
    return false;
  }
  const delay = TERMINAL_AUTO_RECONNECT_DELAYS[attempt];
  session.autoReconnectAttempts = attempt + 1;
  session.autoReconnectPending = true;
  updateTerminalConnectionStatus(connection, key, "reconnecting");
  session.autoReconnectTimer = setTimeout(() => {
    session.autoReconnectTimer = null;
    session.autoReconnectPending = false;
    session.autoReconnectRequested = false;
    if (!terminalSessionSupportsAutoReconnect(connection, session)) return;
    void connectTerminal(connection, key, {auto:true});
  }, delay);
  return true;
}

function syncTermaTerminalComponentMessages() {
  const promptLabel = tr("terminal:a11y.prompt_label", {defaultValue:"终端输入"});
  const tooMuchOutput = tr("terminal:a11y.too_much_output", {defaultValue:"输出内容过多，无法由屏幕阅读器全部播报；请逐行导航阅读"});
  if (TerminalClass?.strings) {
    TerminalClass.strings.promptLabel = promptLabel;
    TerminalClass.strings.tooMuchOutput = tooMuchOutput;
  }
  document.querySelectorAll(".xterm-helper-textarea").forEach(element => element.setAttribute("aria-label", promptLabel));
}

function parkTerminalSurface(view) {
  const key = String(view?.dataset?.terminalTabKey || "");
  const surface = terminalSurfaceCache.get(key);
  const mount = surface?.querySelector("#terminalToolbarMount");
  if (!key || !surface || !mount) return;
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(key);
  const toolbar = document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`)
    || surface.querySelector(".terminal-toolbar");
  if (!toolbar) return;
  if (toolbar.parentElement !== mount) mount.appendChild(toolbar);
  toolbar.hidden = true;
  toolbar.classList.remove("terminal-toolbar-header");
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
const TERMINAL_RECONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

function terminalReconnectStorageKey(key) {
  return `terma:terminal-reconnect:${String(key || "")}`;
}

function terminalReconnectTokenForKey(key, enabled=true) {
  if (!enabled) return {token:"", restored:false};
  const storageKey = terminalReconnectStorageKey(key);
  try {
    const existing = String(sessionStorage.getItem(storageKey) || "");
    if (TERMINAL_RECONNECT_TOKEN_PATTERN.test(existing)) return {token:existing, restored:true};
  } catch {}
  let token = "";
  try {
    if (globalThis.crypto?.randomUUID) token = globalThis.crypto.randomUUID();
    else if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(24);
      globalThis.crypto.getRandomValues(bytes);
      token = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {}
  if (!TERMINAL_RECONNECT_TOKEN_PATTERN.test(token)) token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try { sessionStorage.setItem(storageKey, token); } catch {}
  return {token, restored:false};
}

function forgetTerminalReconnectToken(key) {
  try { sessionStorage.removeItem(terminalReconnectStorageKey(key)); } catch {}
}

function prepareTerminalSessionClose(session, key="", options={}) {
  if (!session) return;
  session.manualDisconnecting = true;
  cancelTerminalAutoReconnect(session);
  session.autoReconnectAttempts = 0;
  session.autoReconnectRequested = false;
  const socket = session.socket;
  if (socket?.readyState === WebSocket.OPEN) {
    try { socket.send(JSON.stringify({type:"terminal-detach"})); } catch {}
  }
  if (options.forgetToken && key) forgetTerminalReconnectToken(key);
}

function enableTerminalPersistentWheelScroll(session, connection) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || session.persistentWheelBox === box) return;
  session.persistentWheelBox = box;
  box.addEventListener("wheel", event => {
    const tab = typeof workspaceTabByKey === "function"
      ? workspaceTabByKey(session.key)
      : tabs.find(item => item.key === session.key);
    const currentConnection = session.connection || connection;
    if (event.ctrlKey || String(tab?.sessionMode || currentConnection?.terminal_session_mode || "none") !== "persistent") return;
    const delta = Number(event.deltaY || 0);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const lines = Math.max(-12, Math.min(12, Math.round(delta / 28) || (delta > 0 ? 1 : -1)));
    try { session.term.scrollLines(lines); } catch {}
  }, {passive:false, capture:true});
}

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

function terminalSessionBackendForStartup(config) {
  const value = normalizeTerminalStartupConfig(config || {});
  if (value.terminal_startup_mode !== "program" || value.terminal_profile_kind !== "session") return "";
  const name = String(value.terminal_program_path || "").split(/[\\/]/).pop()?.replace(/\.exe$/i, "").toLowerCase();
  return name === "tmux" || name === "screen" ? name : "";
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

function bindTerminalInterruptKey(term, key) {
  if (typeof term?.attachCustomKeyEventHandler !== "function") return;
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== "keydown" || event.repeat || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || String(event.key || "").toLowerCase() !== "c") return true;
    if (term.hasSelection?.()) return true;
    event.preventDefault();
    sendTerminalData(key, "\x03", {focus:false});
    return false;
  });
}

function terminalViewForKey(key="") {
  const pane = typeof workspaceFindPaneForTab === "function"
    ? workspaceFindPaneForTab(key)
      || (typeof workspaceFindPane === "function" ? workspaceFindPane(workspaceExecutionPaneId) : null)
      || (typeof workspaceFindPane === "function" ? workspaceFindPane(focusedPaneId) : null)
    : null;
  const paneView = pane && typeof workspacePaneElement === "function"
    ? workspacePaneElement(pane.id)?.querySelector("#view-terminal")
    : null;
  return paneView || $("view-terminal");
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
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(session.key || activeTabKey) : tabs.find(item => item.key === (session.key || activeTabKey));
  if (tab?.kind === "terminal") {
    tab.lastKnownCwd = normalized;
    if (typeof saveTabsState === "function") saveTabsState();
  }
  updateTerminalDropOverlay(session);
  return true;
}

async function probeTerminalDirectory(session, connection, directory, source="probe", options={}) {
  if (!session || !connection?.id) return "";
  const path = normalizeTerminalDirectoryPath(directory || session.currentDirectory || ".");
  const requestId = Number(session.directoryProbeId || 0) + 1;
  session.directoryProbeId = requestId;
  try {
    const query = new URLSearchParams({path});
    const result = await api(`/api/connections/${connection.id}/sftp/resolve-directory?${query.toString()}`);
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
  if (!session || !connection) return "";
  clearTimeout(session.directoryInitializationTimer);
  session.directoryInitializationTimer = null;
  if (session.directoryInitializationPending) return session.directoryInitializationPending;
  const pending = (async () => {
    const startup = effectiveTerminalStartupConfig(connection, key);
    const initial = startup.terminal_working_directory || session.currentDirectory || ".";
    const resolved = await probeTerminalDirectory(session, connection, initial, "initial");
    if (resolved && !session.homeDirectory && initial !== ".") {
      session.homeDirectory = await probeTerminalDirectory(session, connection, ".", "home", {preserveCurrent:true});
    }
    return resolved;
  })();
  session.directoryInitializationPending = pending;
  try {
    return await pending;
  } finally {
    if (session.directoryInitializationPending === pending) session.directoryInitializationPending = null;
  }
}

function scheduleTerminalDirectoryInitialization(session, connection, key, delay=900) {
  if (!session || !connection || session.currentDirectoryKnown || session.directoryInitializationPending) return;
  clearTimeout(session.directoryInitializationTimer);
  const socket = session.socket;
  const attempt = Number(session.connectionAttempt || 0);
  session.directoryInitializationTimer = setTimeout(() => {
    session.directoryInitializationTimer = null;
    if (session.socket !== socket || Number(session.connectionAttempt || 0) !== attempt || !session.connected) return;
    void initializeTerminalDirectory(session, connection, key);
  }, Math.max(0, Number(delay) || 0));
}

function cancelTerminalDirectoryInitialization(session, invalidate=false) {
  if (!session) return;
  clearTimeout(session.directoryInitializationTimer);
  session.directoryInitializationTimer = null;
  if (invalidate) session.directoryProbeId = Number(session.directoryProbeId || 0) + 1;
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
async function connectTerminalAttempt(c, key, session, attempt) {
  const quick = Boolean(c.quick_connection);
  if (quick && !String(session.quickToken || c.quick_token || "")) {
    updateTerminalConnectionStatus(c, key, "authentication");
    session.term.writeln(`\r\n${tr("terminal:system.quick_credentials_expired_connect", {defaultValue:"[临时连接凭据已失效，请重新认证后连接]"})}\r\n`);
    if ($("modal")?.dataset.quickSshAuth !== "1") {
      void startQuickSshConnection({user:c.ssh_user, host:c.ssh_host, port:c.ssh_port}, {reconnectKey:key, authType:c.auth_type});
    }
    return;
  }
  session.authenticationFailed = false;
  session.authenticationFailureWindow = "";
  if (typeof cancelTerminalDirectoryInitialization === "function") cancelTerminalDirectoryInitialization(session, true);
  const previousSocket = session.socket;
  session.socket = null;
  if (typeof closeTerminalZmodem === "function") closeTerminalZmodem(session);
  try { previousSocket?.close(); } catch {}
  try { session.inputDisposable?.dispose(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const title = tab?.title || tr("terminal:tabs.session", {name:c.name, suffix:"", defaultValue:`${c.name} · 终端`});
  session.connected = false;
  session.currentDirectory = "";
  session.currentDirectoryKnown = false;
  session.previousDirectory = "";
  session.homeDirectory = "";
  updateTerminalConnectionStatus(c, key, "connecting");
  const endpoint = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  session.term.writeln(tr("terminal:system.connecting", {endpoint, defaultValue:`连接 ${endpoint} ...`}));
  if (!quick) try {
    await api("/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection_id:c.id})
    });
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    session.term.writeln(`\r\n${error.code === "SSH_HOST_TRUST_CANCELLED"
      ? tr("terminal:system.host_trust_cancelled", {defaultValue:"[已取消连接]"})
      : tr("terminal:system.host_trust_failed", {error:error.message, defaultValue:`[SSH 主机身份校验失败：${error.message}]`})}`);
    updateTerminalConnectionStatus(c, key, "disconnected");
    if (error.code !== "SSH_HOST_TRUST_CANCELLED") notify(error.message || tr("terminal:notifications.host_trust_failed", {defaultValue:"SSH 主机身份校验失败"}), "error");
    if (session.everConnected && error.code !== "SSH_HOST_TRUST_CANCELLED" && !["SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED"].includes(error.code)) {
      session.autoReconnectRequested = true;
    }
    return;
  }
  let startupToken = "";
  const startupOverride = terminalStartupOverrides.has(key) ? terminalStartupOverrides.get(key) : null;
  let effectiveX11Mode = String(startupOverride?.x11_mode || c.x11_mode || "off");
  const explicitX11Request = ["trusted", "untrusted"].includes(String(startupOverride?.x11_mode || ""));
  try {
    if (!quick && (startupOverride || ["trusted", "untrusted"].includes(effectiveX11Mode))) {
      const ticket = await api("/api/terminal/startup-tickets", {
        method:"POST",
        body:JSON.stringify({
          connection_id:c.id,
          startup:startupOverride || {}
        })
      });
      startupToken = ticket.token || "";
    }
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    if (error.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED" && !explicitX11Request) {
      try {
        const fallbackTicket = await api("/api/terminal/startup-tickets", {
          method:"POST",
          body:JSON.stringify({
            connection_id:c.id,
            startup:{...(startupOverride || {}), x11_mode:"off"}
          })
        });
        startupToken = fallbackTicket.token || "";
        effectiveX11Mode = "off";
        session.term.writeln(`\r\n${tr("terminal:system.x11_fallback", {defaultValue:"[X11] 当前浏览器没有桌面集成授权，已自动降级为普通 SSH 终端。"})}`);
        notify(tr("terminal:notifications.x11_fallback", {defaultValue:"X11 未授权，本终端已自动改用普通 SSH"}), "info");
      } catch (fallbackError) {
        session.term.writeln(`\r\n${tr("terminal:system.ssh_fallback_failed", {error:fallbackError.message, defaultValue:`[普通 SSH 降级失败：${fallbackError.message}]`})}`);
        updateTerminalConnectionStatus(c, key, "disconnected");
        notify(fallbackError.message || tr("terminal:notifications.ssh_fallback_failed", {defaultValue:"普通 SSH 降级失败"}), "error");
        return;
      }
    } else if (error.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED") {
      session.term.writeln(`\r\n[X11] ${error.message}`);
      session.term.writeln(tr("terminal:system.x11_authorization_hint", {defaultValue:"[请在 X Server 窗口选择授权时长并申请授权，完成后点击重连]"}));
      updateTerminalConnectionStatus(c, key, "authorization");
      notify(error.message || tr("terminal:notifications.x11_authorization_required", {defaultValue:"当前浏览器没有 X11 桌面集成授权"}), "error");
      if (typeof openXServerManager === "function") {
        try { await openXServerManager(c.id, key); }
        catch {}
      }
      return;
    } else {
      session.term.writeln(`\r\n${tr("terminal:system.startup_prepare_failed", {error:error.message, defaultValue:`[临时启动配置准备失败：${error.message}]`})}`);
      updateTerminalConnectionStatus(c, key, "disconnected");
      notify(error.message || tr("terminal:notifications.startup_prepare_failed", {defaultValue:"临时启动配置准备失败"}), "error");
      return;
    }
  }
  if (
    session.connectionAttempt !== attempt
    || terminalSessions.get(key) !== session
    || !(typeof workspaceHasTabKey === "function" ? workspaceHasTabKey(key) : tabs.some(item => item.key === key))
  ) return;
  const startupQuery = startupToken ? `&startup_token=${encodeURIComponent(startupToken)}` : "";
  const logQuery = session.logId ? `&log_id=${encodeURIComponent(session.logId)}` : "";
  const encodingQuery = `&encoding=${encodeURIComponent(session.terminalEncoding || c.terminal_encoding || "utf8")}`;
  const quickToken = quick ? String(session.quickToken || c.quick_token || "") : "";
  const connectionQuery = quick ? `quick_token=${encodeURIComponent(quickToken)}` : `id=${encodeURIComponent(c.id)}`;
  const reconnectTokenQuery = !quick && session.reconnectToken
    ? `&reconnect_token=${encodeURIComponent(session.reconnectToken)}`
    : "";
  const quickX11Query = quick ? `&x11_mode=${encodeURIComponent(effectiveX11Mode)}` : "";
  const replayLines = Math.max(100, Math.min(10000, Math.floor(Number(currentTerminalGlobalSettings().scrollback_lines) || 30000)));
  const sessionModeQuery = !quick && String(c.terminal_session_mode || "none") === "persistent" ? `&session_mode=persistent&session_backend=${encodeURIComponent(c.terminal_session_backend || "auto")}&session_id=${encodeURIComponent(String(c.terminal_session_id || ""))}&session_replay=${session.everConnected ? "0" : "1"}&session_replay_lines=${replayLines}` : "";
  const languageQuery = `&language=${encodeURIComponent(normalizeTermaLanguage(document.documentElement.lang))}`;
  session.effectiveX11Mode = effectiveX11Mode;
  const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal?${connectionQuery}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}${encodingQuery}${logQuery}${startupQuery}${quickX11Query}${sessionModeQuery}${reconnectTokenQuery}${languageQuery}`);
  socket.binaryType = "arraybuffer";
  let socketOpened = false;
  session.socket = socket;
  if (typeof initializeTerminalZmodem === "function") initializeTerminalZmodem(session);
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    socketOpened = true;
    session.connected = true;
    session.everConnected = true;
    session.autoReconnectAttempts = 0;
    session.autoReconnectPending = false;
    session.remoteSessionEnded = false;
    session.serverSessionState = "connected";
    if (typeof syncTerminalOutputFlowForSocket === "function") syncTerminalOutputFlowForSocket(session);
    socket.send(JSON.stringify({type:"terminal-encoding", encoding:session.terminalEncoding || c.terminal_encoding || "utf8"}));
    updateTerminalConnectionStatus(c, key, "connected");
    if (typeof scheduleTerminalDirectoryInitialization === "function") scheduleTerminalDirectoryInitialization(session, c, key, 1200);
  });
  socket.addEventListener("message", event => {
    if (session.socket !== socket) return;
    if (typeof event.data === "string" && event.data.startsWith("\0TERMA:")) {
      try {
        const control = JSON.parse(event.data.slice("\0TERMA:".length));
        if (control?.type === "terminal-session") {
          session.serverSessionState = String(control.state || "");
          if (control.state === "reconnected") {
            session.reconnectTokenRestored = false;
            session.reconnectTokenStateHandled = true;
            session.expectingReattach = false;
            session.remoteSessionEnded = false;
          } else if (control.state === "ended") {
            session.remoteSessionEnded = true;
            if (typeof terminalAiMarkSessionEnded === "function") terminalAiMarkSessionEnded(session);
          } else if (control.state === "created" && (session.reconnectTokenRestored || session.expectingReattach) && !session.reconnectTokenStateHandled) {
            session.reconnectTokenStateHandled = true;
            session.expectingReattach = false;
            queueTerminalOutput(session, `\r\n${tr("terminal:system.reconnect_expired", {defaultValue:"[原普通 Shell 已过期，已新建普通 Shell]"})}\r\n`);
          }
        }
      } catch {}
      return;
    }
    finishTerminalLatencySample(session, key);
    if (terminalAuthenticationFailureChunk(session, event.data)) session.authenticationFailed = true;
    const terminalOutput = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    if (typeof updateTerminalSmartState === "function") updateTerminalSmartState(key, terminalOutput);
    if (typeof consumeTerminalZmodemOutput === "function" && consumeTerminalZmodemOutput(session, event.data)) {
      if (isMobileLayout()) scheduleTerminalFit();
      return;
    }
    queueTerminalOutput(session, terminalOutput);
    if (typeof scheduleTerminalDirectoryInitialization === "function") scheduleTerminalDirectoryInitialization(session, c, key);
    if (isMobileLayout()) scheduleTerminalFit();
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.connected = false;
    if (session.remoteSessionEnded && typeof terminalAiMarkSessionEnded === "function") terminalAiMarkSessionEnded(session);
    if (typeof cancelTerminalDirectoryInitialization === "function") cancelTerminalDirectoryInitialization(session, true);
    if (typeof closeTerminalZmodem === "function") closeTerminalZmodem(session);
    session.latencyPendingAt = 0;
    clearTimeout(session.latencyPendingTimer);
    const autoReconnect = terminalSessionSupportsAutoReconnect(c, session) && !session.remoteSessionEnded;
    const announceAutoReconnect = autoReconnect && Number(session.autoReconnectAttempts || 0) === 0;
    if (autoReconnect) session.expectingReattach = true;
    if (!autoReconnect || announceAutoReconnect) {
      queueTerminalOutput(session, `\r\n${tr(autoReconnect ? "terminal:system.closed_auto_reconnect" : "terminal:system.closed_reconnect", {defaultValue:autoReconnect ? "[连接已关闭，正在自动重连]" : "[连接已关闭，按 Enter 重新连接]"})}\r\n`);
    }
    if (autoReconnect) scheduleTerminalAutoReconnect(c, key, session);
    else updateTerminalConnectionStatus(c, key, "disconnected");
    if (quick && !socketOpened && !session.authenticationFailed) {
      session.quickToken = "";
      c.quick_token = "";
      queueTerminalOutput(session, `${tr("terminal:system.quick_credentials_expired", {defaultValue:"[临时连接凭据已失效，请重新认证]"})}\r\n`);
    }
    if (session.authenticationFailed && session.credentialRepairPromptAttempt !== attempt) {
      session.credentialRepairPromptAttempt = attempt;
      queueTerminalOutput(session, quick
        ? `${tr("terminal:system.quick_auth_repair_opening", {defaultValue:"[SSH 认证失败，正在打开临时凭据修复窗口]"})}\r\n`
        : `${tr("terminal:system.auth_repair_opening", {defaultValue:"[SSH 认证失败，正在打开凭据修复窗口]"})}\r\n`);
      queueMicrotask(() => {
        if (terminalSessions.get(key) !== session) return;
        if (typeof workspaceHasTabKey === "function" && !workspaceHasTabKey(key)) return;
        void repairTerminalCredentials(c, key);
      });
    }
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) queueTerminalOutput(session, `\r\n${tr("terminal:system.websocket_failed", {defaultValue:"[WebSocket 连接失败]"})}\r\n`);
  });
  session.inputDisposable = session.term.onData(data => {
    if (typeof terminalZmodemPrepareInput === "function" && terminalZmodemPrepareInput(session, data)) return;
    const preparedData = typeof terminalZmodemTakePreparedInput === "function" ? terminalZmodemTakePreparedInput(session, data) : data;
    if (typeof interceptTerminalClipboardCtrlVInput === "function" && interceptTerminalClipboardCtrlVInput(key, c.id, preparedData)) return;
    const beforeCtrl = terminalCtrlArmed || terminalCtrlLocked;
    const outgoing = transformTerminalInputForCtrl(key, preparedData);
    if (!beforeCtrl) trackTerminalCommand(session, data);
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
