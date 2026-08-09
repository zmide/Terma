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
