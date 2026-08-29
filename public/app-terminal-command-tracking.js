function trackTerminalCommand(session, data, options={}) {
  session.commandBuffer = session.commandBuffer || "";
  session.commandCursor = Number.isInteger(session.commandCursor) ? session.commandCursor : session.commandBuffer.length;
  const raw = String(data || "");
  if (session.sensitiveInput) {
    clearTimeout(session.pendingCommandCapture?.timer);
    session.pendingCommandCapture = null;
    session.commandBuffer = "";
    session.commandCursor = 0;
    session.commandBufferFromPaste = false;
    session.commandBufferNeedsScreenSync = false;
    return;
  }
  if (raw.includes("\x1b")) {
    refreshTerminalCommandBufferFromScreen(session);
    markTerminalCommandScreenSync(session);
    return;
  }
  let previousWasCarriageReturn = false;
  for (const ch of raw) {
    if (ch === "\n" && previousWasCarriageReturn) {
      previousWasCarriageReturn = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const buffer = session.commandBuffer.trim();
      const preferCommandBuffer = options.preferCommandBuffer === true || session.commandBufferFromPaste === true;
      if (preferCommandBuffer) recordTerminalCommand(session, buffer);
      else captureTerminalCommandSubmission(session, buffer);
      session.commandBuffer = "";
      session.commandCursor = 0;
      session.commandBufferFromPaste = false;
    } else if (ch === "\x7f" || ch === "\b") {
      refreshTerminalCommandBufferFromScreen(session);
      const cursor = Math.max(0, Math.min(session.commandBuffer.length, session.commandCursor));
      if (cursor > 0) {
        session.commandBuffer = `${session.commandBuffer.slice(0, cursor - 1)}${session.commandBuffer.slice(cursor)}`;
        session.commandCursor = cursor - 1;
      }
    } else if (ch === "\x03") {
      clearTimeout(session.pendingCommandCapture?.timer);
      session.pendingCommandCapture = null;
      session.commandBuffer = "";
      session.commandCursor = 0;
      session.commandBufferFromPaste = false;
      session.commandBufferNeedsScreenSync = false;
    } else if (ch === "\t") {
      refreshTerminalCommandBufferFromScreen(session);
      markTerminalCommandScreenSync(session);
    } else if (ch >= " " && ch !== "\x7f") {
      refreshTerminalCommandBufferFromScreen(session);
      const cursor = Math.max(0, Math.min(session.commandBuffer.length, session.commandCursor));
      session.commandBuffer = `${session.commandBuffer.slice(0, cursor)}${ch}${session.commandBuffer.slice(cursor)}`;
      session.commandCursor = cursor + ch.length;
      if (options.source === "paste") session.commandBufferFromPaste = true;
    }
    previousWasCarriageReturn = ch === "\r";
  }
}

function recordTerminalCommand(session, command) {
  const text = String(command || "").trim();
  if (typeof resolveTerminalAiWaitingInput === "function" && resolveTerminalAiWaitingInput(session, text)) return;
  saveRecentTerminalCommand(text);
  if (typeof captureTerminalAiBlockCommand === "function") captureTerminalAiBlockCommand(session, text);
  const connection = currentConnection(session.id);
  if (connection) void trackTerminalDirectoryCommand(session, connection, session.key || activeTabKey, text);
}

function resolveTerminalAiWaitingInput(session, input) {
  if (!session || !String(input || "").trim() || typeof terminalAiStateForKey !== "function") return false;
  const state = terminalAiStateForKey(session.key);
  const waiting = state.agentWaitingForInput;
  if (!waiting || String(waiting.blockId || "") !== String(session.aiActiveBlockId || "")) return false;
  const block = state.blocks.find(item => String(item.id) === String(waiting.blockId));
  if (block) {
    block.waitingForInput = false;
    block.inputProvidedAt = Date.now();
    block.inputProvided = String(input).slice(0, 200);
  }
  state.agentWaitingForInput = null;
  terminalAiPersistState(session.key, state);
  if (state.open) renderTerminalAiPanel(session.key);
  return true;
}

function markTerminalCommandScreenSync(session) {
  session.commandScreenBeforeControl = terminalPromptStateAtRow(session);
  session.commandBufferNeedsScreenSync = true;
}

function refreshTerminalCommandBufferFromScreen(session, force=false) {
  if (!session.commandBufferNeedsScreenSync && !force) return false;
  const state = terminalPromptStateAtRow(session);
  if (!state) return false;
  const before = session.commandScreenBeforeControl;
  const changed = force
    || !before
    || state.row !== before.row
    || state.command !== before.command
    || state.cursor !== before.cursor;
  if (!changed) return false;
  session.commandBuffer = state.command;
  session.commandCursor = state.cursor;
  session.commandBufferNeedsScreenSync = false;
  session.commandScreenBeforeControl = null;
  return true;
}

function captureTerminalCommandSubmission(session, fallback) {
  refreshTerminalCommandBufferFromScreen(session);
  const screen = terminalPromptStateAtRow(session);
  const command = String(session.commandBuffer || fallback || "").trim();
  if (!session.commandBufferNeedsScreenSync) {
    recordTerminalCommand(session, command || screen?.command || "");
    return;
  }
  clearTimeout(session.pendingCommandCapture?.timer);
  const capture = {
    row:screen?.row,
    fallback:command,
    before:session.commandScreenBeforeControl,
    timer:null
  };
  capture.timer = setTimeout(() => finalizePendingTerminalCommand(session, true), 1500);
  session.pendingCommandCapture = capture;
}

function finalizePendingTerminalCommand(session, force=false) {
  const capture = session?.pendingCommandCapture;
  if (!capture) return false;
  const state = terminalPromptStateAtRow(session, capture.row);
  const changed = Boolean(state?.command) && (
    !capture.before
    || state.row !== capture.before.row
    || state.command !== capture.before.command
    || state.cursor !== capture.before.cursor
  );
  if (!force && !changed) return false;
  clearTimeout(capture.timer);
  session.pendingCommandCapture = null;
  session.commandBufferNeedsScreenSync = false;
  session.commandScreenBeforeControl = null;
  recordTerminalCommand(session, state?.command || capture.fallback);
  return true;
}
