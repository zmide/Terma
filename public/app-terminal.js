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
const defaultTerminalGlobalSettings = Object.freeze({
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
  const prefixes = (Array.isArray(source.url_prefixes) ? source.url_prefixes : String(source.url_prefixes || "").split(/[|,\s]+/))
    .map(item => String(item || "").trim()).filter(Boolean).slice(0, 10);
  return {
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
  state.cancelButton?.remove();
  if (state.status) {
    state.status.textContent = state.originalStatusText;
    state.status.title = state.originalStatusTitle;
  }
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
  const status = terminalElementForKey(key, "#terminalStatus");
  const cancelButton = document.createElement("button");
  cancelButton.className = "icon-button terminal-cursor-copy-cancel";
  cancelButton.type = "button";
  cancelButton.title = "取消光标复制";
  cancelButton.setAttribute("aria-label", "取消光标复制");
  cancelButton.innerHTML = icon("x");
  status?.after(cancelButton);
  const state = {
    mount, originalTheme, phase:"start", start:null, current:null, pointerId:null,
    scrollTimer:null, scrollDirection:0, lastPointer:null, status, cancelButton,
    originalStatusText:status?.textContent || "", originalStatusTitle:status?.title || ""
  };
  if (status) {
    status.textContent = "拖到复制起点后松手";
    status.title = "触点会取手指上方的位置；拖到边缘可滚动终端";
  }
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
      if (status) status.textContent = "拖到复制终点，松手后复制";
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
    <div class="terminal-settings-grid">
      <section class="terminal-settings-section">
        <h3>${icon("mouse-pointer-2")}鼠标</h3>
        <label>中键操作</label><select id="terminalSettingMiddleMouse">${terminalMouseActionOptionsHtml(settings.middle_mouse_action)}</select>
        <label>右键操作</label><select id="terminalSettingRightMouse">${terminalMouseActionOptionsHtml(settings.right_mouse_action)}</select>
        <label class="check-row"><input id="terminalSettingCtrlClick" type="checkbox" ${settings.ctrl_left_click_moves_cursor ? "checked" : ""}> Ctrl + 左键移动终端光标</label>
      </section>
      <section class="terminal-settings-section">
        <h3>${icon("link")}链接</h3>
        <label class="check-row"><input id="terminalSettingUrlLinks" type="checkbox" ${settings.url_links_enabled ? "checked" : ""} onchange="syncTerminalSettingsForm()"> 识别 URL 超链接</label>
        <label>URL 前缀</label><input id="terminalSettingUrlPrefixes" value="${esc(settings.url_prefixes.join(" | "))}" ${settings.url_links_enabled ? "" : "disabled"}>
        <label class="check-row"><input id="terminalSettingUrlCtrlClick" type="checkbox" ${settings.url_ctrl_click ? "checked" : ""} ${settings.url_links_enabled ? "" : "disabled"}> Ctrl + 单击打开链接</label>
      </section>
      <section class="terminal-settings-section terminal-settings-selection">
        <h3>${icon("text-select")}选择与复制</h3>
        <label>双击选择分隔符</label>
        <div class="terminal-settings-inline"><input id="terminalSettingWordSeparators" value="${esc(settings.word_separators)}"><button type="button" onclick="resetTerminalWordSeparators()">重置</button></div>
        <label class="check-row"><input id="terminalSettingShiftDoubleClick" type="checkbox" ${settings.shift_double_click_uses_separators ? "checked" : ""}> Shift + 双击时使用分隔符</label>
        <label class="check-row"><input id="terminalSettingNonWhitespaceBlock" type="checkbox" ${settings.select_non_whitespace_block ? "checked" : ""}> 双击时将连续非空白内容作为一个整体</label>
        <label class="check-row"><input id="terminalSettingAutoCopy" type="checkbox" ${settings.auto_copy_selection ? "checked" : ""}> 选中文本后自动复制</label>
        <label class="check-row"><input id="terminalSettingTabsToSpaces" type="checkbox" ${settings.copy_tabs_to_spaces ? "checked" : ""}> 复制时将制表符转换为 4 个空格</label>
        <label class="check-row"><input id="terminalSettingTrailingNewline" type="checkbox" ${settings.copy_include_trailing_newline ? "checked" : ""}> 复制时包含末尾换行</label>
        <label class="check-row"><input id="terminalSettingTrimSpaces" type="checkbox" ${settings.copy_trim_trailing_spaces ? "checked" : ""}> 复制时删除行尾空白</label>
      </section>
      <section class="terminal-settings-section">
        <h3>${icon("clipboard-paste")}粘贴</h3>
        <label>粘贴多行文本时</label>
        <select id="terminalSettingMultilinePaste">
          <option value="prompt" ${settings.multiline_paste_mode === "prompt" ? "selected" : ""}>打开可编辑命令窗口</option>
          <option value="paste" ${settings.multiline_paste_mode === "paste" ? "selected" : ""}>直接粘贴</option>
          <option value="single_line" ${settings.multiline_paste_mode === "single_line" ? "selected" : ""}>合并为一行</option>
        </select>
      </section>
    </div>
    <div class="actions terminal-settings-actions"><button type="button" onclick="resetTerminalGlobalSettingsForm()">恢复默认</button><button type="button" onclick="closeTerminalGlobalSettings('${escAttr(key)}')">取消</button><button id="terminalSettingsSave" class="primary" type="button" onclick="saveTerminalGlobalSettings('${escAttr(key)}')">${icon("save")}<span>保存全局设置</span></button></div>
  </div>`;
  modal.hidden = false;
  modal.onkeydown = event => {
    if (event.key === "Escape") closeTerminalGlobalSettings(key);
  };
  $("terminalSettingMiddleMouse")?.focus();
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
}

function resetTerminalGlobalSettingsForm() {
  fillTerminalGlobalSettingsForm(defaultTerminalGlobalSettings);
}

function terminalGlobalSettingsFormValue() {
  return {
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

function terminalEncodingLabel(connection) {
  return terminalEncodingOptions.find(([value]) => value === (connection.terminal_encoding || "utf8"))?.[1] || "UTF-8";
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
  const tab = tabs.find(item => item.key === key);
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

function openTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const c = selectConnection(id);
  if (!c) return;
  let key = existingKey;
  let title = existingTitle;
  if (!key) {
    const next = (terminalCounts.get(c.id) || 0) + 1;
    terminalCounts.set(c.id, next);
    key = `terminal-${c.id}-${next}`;
    title = `${c.name} · 终端${next > 1 ? ` #${next}` : ""}`;
  } else {
    const restoredIndex = Number(String(key).match(/-(\d+)$/)?.[1] || 1);
    terminalCounts.set(c.id, Math.max(terminalCounts.get(c.id) || 0, restoredIndex));
  }
  const connectionAddress = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  const forwardButton = connectionToggleButton(c)
    .replace("connection-forward-toggle", "connection-forward-toggle terminal-action-forward")
    .replace("<button ", "<button onpointerdown=\"keepTerminalKeyboardClosed(event)\" ");
  const terminalView = $("view-terminal");
  terminalView.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><button class="terminal-mobile-back" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="backToExplorer()">${icon("arrow-left")}<span>返回</span></button><span class="terminal-connection-dot"></span><div class="terminal-status" id="terminalStatus" title="${esc(connectionAddress)}">${esc(connectionAddress)}</div>${terminalLatencyHtml(key)}</div><div class="actions terminal-actions"><button class="icon-button terminal-action-sftp" title="打开此连接的 SFTP" aria-label="打开此连接的 SFTP" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openSftp(${c.id})">${icon("folder-open")}<span>SFTP</span></button><button class="icon-button terminal-action-font" title="减小字体（Ctrl+滚轮）" aria-label="减小字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',-1)">${icon("minus")}</button><button class="icon-button terminal-action-font" title="增大字体（Ctrl+滚轮）" aria-label="增大字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',1)">${icon("plus")}</button><button class="terminal-dropdown-button terminal-action-display" title="切换终端编码" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalEncodingMenu(event,'${key}',${c.id})">${icon("languages")}<span>${esc(terminalEncodingLabel(c))}</span>${icon("chevron-down")}</button><button class="terminal-dropdown-button terminal-action-display" title="切换终端字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalFontMenu(event,'${key}',${c.id})">${icon("type")}<span>字体</span>${icon("chevron-down")}</button><button class="icon-button terminal-global-settings-button" title="全局终端设置" aria-label="全局终端设置" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalGlobalSettings('${key}')">${icon("settings")}</button><button class="terminal-action-keys" title="${terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalKeys('${key}')">${icon("keyboard")}<span>${terminalKeysVisible ? "隐藏快捷键" : "快捷键"}</span></button><button class="terminal-action-recent" title="最近命令" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showRecentTerminalCommands('${key}')">${icon("history")}<span>最近命令</span></button><button class="terminal-action-reconnect" title="重新连接终端" aria-label="重新连接终端" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalConnection(${c.id}, '${key}')">${icon("link-2")}<span>重连</span></button>${forwardButton}</div></div>${renderTerminalKeys(key)}<div id="terminalMount" class="terminal-box"></div><div class="terminal-mobile-composer"><input id="terminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入命令" onkeydown="handleMobileTerminalInput(event,'${key}')"><button class="primary icon-button" title="发送命令" onclick="sendMobileTerminalInput('${key}')">${icon("send")}</button></div>`;
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
  attachTerminal(c, key).catch(error => {
    const mount = terminalElementForKey(key, "#terminalMount");
    if (mount) mount.innerHTML = stateView("error", "终端组件加载失败", error.message, `<button onclick="reconnectTerminal(${c.id},'${key}')">重新连接</button>`);
  });
}

async function attachTerminal(c, key) {
  const mount = $("terminalMount");
  if (!mount) return;
  await ensureTerminalGlobalSettings();
  await ensureTerminalLibs();
  let session = terminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({
      cursorBlink:true,
      convertEol:true,
      fontFamily:c.terminal_font_family || "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize:terminalFontSizeForCurrentLayout(c),
      lineHeight:Number(c.terminal_line_height) || 1,
      fontWeight:c.terminal_font_weight || "normal",
      wordSeparator:terminalWordSeparator(),
      theme:{
        background:"#0f1720",
        foreground:"#d1e7dd",
        cursor:"#ffffff",
        black:"#2e3436",
        red:"#ef4444",
        green:"#22c55e",
        yellow:"#eab308",
        blue:"#60a5fa",
        magenta:"#c084fc",
        cyan:"#2dd4bf",
        white:"#e5e7eb",
        brightBlack:"#6b7280",
        brightRed:"#f87171",
        brightGreen:"#86efac",
        brightYellow:"#fde047",
        brightBlue:"#93c5fd",
        brightMagenta:"#d8b4fe",
        brightCyan:"#67e8f9",
        brightWhite:"#ffffff"
      }
    });
    const fit = new FitAddonClass();
    term.loadAddon(fit);
    session = {term, fit, socket:null, connected:false, id:c.id, fontLayoutMobile:isMobileLayout()};
    terminalSessions.set(key, session);
  }
  session.fontLayoutMobile = isMobileLayout();
  session.mount = mount;
  session.term.options.fontSize = terminalFontSizeForCurrentLayout(c);
  if (session.term.element) mount.appendChild(session.term.element);
  else session.term.open(mount);
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
    if (!event.ctrlKey) return;
    event.preventDefault();
    changeTerminalFont(key, event.deltaY < 0 ? 1 : -1);
  }, {passive:false});
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

function sendTerminalData(key, data, options={}) {
  const session = terminalSessions.get(key);
  if (!session?.socket || session.socket.readyState !== WebSocket.OPEN) return notify("终端尚未连接", "error");
  startTerminalLatencySample(session);
  session.socket.send(data);
  const shouldFocus = options.focus ?? !isMobileLayout();
  if (shouldFocus) try { session.term.focus(); } catch {}
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
  modal.innerHTML = `<div class="modal-card wide"><h2>最近命令</h2><div class="recent-command-list">${items.map((cmd, index) => `<button data-index="${index}"><code>${esc(cmd)}</code></button>`).join("")}</div><div class="actions"><button id="recentCommandClear" class="danger">清空</button><button id="recentCommandClose">关闭</button></div></div>`;
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
  };
  $("recentCommandClose").onclick = () => { modal.hidden = true; };
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
    const markers = ["# ", "$ ", "> "];
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

function syncTerminalResponsiveFontSizes() {
  const mobile = isMobileLayout();
  for (const session of terminalSessions.values()) {
    if (session.fontLayoutMobile === mobile) continue;
    const connection = connections.find(item => item.id === session.id);
    if (!connection) continue;
    session.fontLayoutMobile = mobile;
    session.term.options.fontSize = terminalFontSizeForCurrentLayout(connection);
    setTimeout(() => { try { session.fit.fit(); } catch {} }, 0);
  }
}

function changeTerminalFont(key, delta) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const size = Math.max(10, Math.min(32, Number(session.term.options.fontSize || 13) + delta));
  session.term.options.fontSize = size;
  const connection = connections.find(item => item.id === session.id);
  if (connection) {
    connection[terminalFontSizeField()] = size;
    scheduleTerminalPreferencesSave(connection);
  }
  setTimeout(() => { try { session.fit.fit(); } catch {} }, 0);
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
  const current = connection.terminal_encoding || "utf8";
  showActionMenu(event, terminalEncodingOptions.map(([value,label]) => ({
    label,
    icon:value === current ? "check" : "languages",
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
    for (const activeSession of terminalSessions.values()) {
      if (activeSession.id !== connectionId) continue;
      activeSession.term.options.fontFamily = settings.terminal_font_family;
      activeSession.term.options.fontSize = terminalFontSizeForCurrentLayout(settings);
      activeSession.fontLayoutMobile = isMobileLayout();
      activeSession.term.options.lineHeight = settings.terminal_line_height;
      activeSession.term.options.fontWeight = settings.terminal_font_weight;
      if (activeSession.socket?.readyState === WebSocket.OPEN) {
        activeSession.socket.send(JSON.stringify({type:"terminal-encoding", encoding:settings.terminal_encoding}));
      }
      setTimeout(() => { try { activeSession.fit.fit(); } catch {} }, 0);
    }
    const encodingButton = document.querySelector(`button[onclick*="showTerminalEncodingMenu"][onclick*="'${key}'"] span`);
    if (encodingButton) encodingButton.textContent = terminalEncodingLabel(connection);
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
    {separator:true},
    {label:session.connected ? "断开连接" : "重新连接", icon:session.connected ? "link-2-off" : "link-2", run:()=>toggleTerminalConnection(connectionId, key)},
    ...(!mobile ? [{separator:true}, {label:"全局终端设置", icon:"settings", run:()=>showTerminalGlobalSettings(key)}] : [])
  ]);
}

function connectTerminal(c, key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const previousSocket = session.socket;
  session.socket = null;
  try { previousSocket?.close(); } catch {}
  try { session.inputDisposable?.dispose(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const tab = tabs.find(item => item.key === key);
  const title = tab?.title || `${c.name} · 终端`;
  const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal?id=${encodeURIComponent(c.id)}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}`);
  socket.binaryType = "arraybuffer";
  session.socket = socket;
  session.connected = false;
  updateTerminalConnectionStatus(c, key, "连接中");
  session.term.writeln(`连接 ${c.ssh_user}@${c.ssh_host}:${c.ssh_port} ...`);
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    session.connected = true;
    updateTerminalConnectionStatus(c, key, "已连接");
  });
  socket.addEventListener("message", event => {
    if (session.socket !== socket) return;
    finishTerminalLatencySample(session, key);
    session.term.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);
    if (isMobileLayout()) scheduleTerminalFit();
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.connected = false;
    session.latencyPendingAt = 0;
    clearTimeout(session.latencyPendingTimer);
    session.term.writeln("\r\n[连接已关闭]");
    updateTerminalConnectionStatus(c, key, "已断开");
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) session.term.writeln("\r\n[WebSocket 连接失败]");
  });
  session.inputDisposable = session.term.onData(data => {
    const beforeCtrl = terminalCtrlArmed || terminalCtrlLocked;
    const outgoing = transformTerminalInputForCtrl(key, data);
    if (!beforeCtrl) trackTerminalCommand(session, data);
    if (socket.readyState === WebSocket.OPEN) {
      startTerminalLatencySample(session);
      socket.send(outgoing);
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
      saveRecentTerminalCommand(currentTerminalPromptCommand(session) || session.commandBuffer);
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
}

function disconnectTerminal(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const socket = session.socket;
  session.connected = false;
  session.latencyPendingAt = 0;
  clearTimeout(session.latencyPendingTimer);
  try { socket?.close(1000, "user disconnect"); } catch {}
  updateTerminalConnectionStatus(currentConnection(session.id), key, "已断开");
}

function toggleTerminalConnection(id, key=`terminal-${id}-1`) {
  const session = terminalSessions.get(key);
  if (session?.connected || session?.socket?.readyState === WebSocket.CONNECTING) disconnectTerminal(key);
  else reconnectTerminal(id, key);
}
