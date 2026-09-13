const TERMINAL_OUTPUT_FRAME_BUDGET = 32 * 1024;
const TERMINAL_OUTPUT_DRAIN_DELAY_MS = 8;
const TERMINAL_OUTPUT_TUI_DRAIN_DELAY_MS = 32;
const TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS = 96;
const TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS = 24;
const TERMINAL_OUTPUT_HIGH_WATER_MARK = 128 * 1024;
const TERMINAL_OUTPUT_LOW_WATER_MARK = 32 * 1024;
const TERMINAL_OUTPUT_REDRAW_WINDOW_MS = 750;
const TERMINAL_OUTPUT_REDRAW_ACTIVE_MS = 1200;
const TERMINAL_OUTPUT_REDRAW_THRESHOLD = 8;
const TERMINAL_OUTPUT_REDRAW_FINAL_BYTES = new Set([0x46, 0x47, 0x48, 0x4a, 0x4b]);

function terminalOutputAnsiRedrawCount(value) {
  const length = terminalOutputLength(value);
  if (!length) return 0;
  const codeAt = typeof value === "string" ? index => value.charCodeAt(index) : index => value[index];
  let count = 0;
  for (let index = 0; index < length - 2; index += 1) {
    if (codeAt(index) !== 0x1b || codeAt(index + 1) !== 0x5b) continue;
    let cursor = index + 2;
    while (cursor < length) {
      const code = codeAt(cursor);
      cursor += 1;
      if (code < 0x40 || code > 0x7e) continue;
      if (TERMINAL_OUTPUT_REDRAW_FINAL_BYTES.has(code)) count += 1;
      index = cursor - 1;
      break;
    }
  }
  return count;
}

function noteTerminalOutputRedraw(session, value) {
  const count = terminalOutputAnsiRedrawCount(value);
  if (!count) return;
  const now = Date.now();
  if (now - Number(session.terminalRedrawWindowStartedAt || 0) > TERMINAL_OUTPUT_REDRAW_WINDOW_MS) {
    session.terminalRedrawWindowStartedAt = now;
    session.terminalRedrawCount = 0;
  }
  session.terminalRedrawCount = Number(session.terminalRedrawCount || 0) + count;
  if (session.terminalRedrawCount >= TERMINAL_OUTPUT_REDRAW_THRESHOLD) {
    session.terminalRedrawActiveUntil = now + TERMINAL_OUTPUT_REDRAW_ACTIVE_MS;
  }
}

function terminalOutputSessionIsFocused(session) {
  const key = String(session?.key || "");
  if (!key) return true;
  if (typeof workspaceFindPaneForTab === "function") {
    const pane = workspaceFindPaneForTab(key);
    if (pane) {
      const focused = typeof focusedPaneId === "string" ? focusedPaneId : "";
      const showsTab = typeof workspacePaneShowsTab === "function"
        ? workspacePaneShowsTab(pane, key)
        : true;
      return (!focused || pane.id === focused) && showsTab;
    }
  }
  return true;
}

function scheduleTerminalOutputDrain(session) {
  if (session.terminalOutputFrame) return;
  // Terminal parsing must not depend on a compositor frame. Chromium can keep
  // document.visibilityState as visible when Electron background throttling is
  // disabled, while Windows still stops presenting frames for a minimized window.
  // Cached tabs are detached from the document, so they can use a coarser batch.
  session.terminalOutputFrameKind = "timeout";
  const hidden = Boolean(globalThis.document?.hidden);
  const buffer = session.term?.buffer?.active;
  const detached = session.term?.element && session.term.element.isConnected === false;
  const background = detached || !terminalOutputSessionIsFocused(session);
  const alternateScreen = buffer?.type === "alternate";
  const frequentRedraw = Number(session.terminalRedrawActiveUntil || 0) > Date.now();
  const viewingScrollback = Boolean(
    session.term?.hasSelection?.()
    || (buffer && Number(buffer.viewportY) < Number(buffer.baseY) - 1)
  );
  const delay = hidden || background
    ? TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS
    : viewingScrollback
      ? TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS
      : alternateScreen || frequentRedraw
        ? TERMINAL_OUTPUT_TUI_DRAIN_DELAY_MS
        : TERMINAL_OUTPUT_DRAIN_DELAY_MS;
  session.terminalOutputFrame = setTimeout(() => drainTerminalOutput(session), delay);
}

function terminalOutputLength(value) {
  return typeof value === "string" ? value.length : Number(value?.byteLength || 0);
}

function terminalOutputFlowMessage(session, paused) {
  if (!session?.socket || session.socket.readyState !== WebSocket.OPEN) return;
  if (Boolean(session.terminalOutputFlowPaused) === Boolean(paused)) return;
  try {
    session.socket.send(JSON.stringify({type:"terminal-output-flow", paused:Boolean(paused)}));
    session.terminalOutputFlowPaused = Boolean(paused);
  } catch {}
}

function syncTerminalOutputFlowForSocket(session) {
  if (!session) return;
  session.terminalOutputFlowPaused = false;
  if (Number(session.pendingTerminalOutputBytes || 0) >= TERMINAL_OUTPUT_HIGH_WATER_MARK) terminalOutputFlowMessage(session, true);
}

function accountTerminalOutputConsumed(session, amount) {
  session.pendingTerminalOutputBytes = Math.max(0, Number(session.pendingTerminalOutputBytes || 0) - Math.max(0, Number(amount || 0)));
  if (session.terminalOutputFlowPaused && session.pendingTerminalOutputBytes <= TERMINAL_OUTPUT_LOW_WATER_MARK) {
    terminalOutputFlowMessage(session, false);
  }
}

function takeTerminalOutputChunk(session, budget) {
  const first = session.pendingTerminalOutput[0];
  const binary = first instanceof Uint8Array;
  const chunks = [];
  let used = 0;
  while (session.pendingTerminalOutput.length && used < budget) {
    const chunk = session.pendingTerminalOutput[0];
    if ((chunk instanceof Uint8Array) !== binary) break;
    const remaining = budget - used;
    const length = terminalOutputLength(chunk);
    if (length <= remaining) {
      chunks.push(session.pendingTerminalOutput.shift());
      used += length;
      accountTerminalOutputConsumed(session, length);
      continue;
    }
    chunks.push(chunk.slice(0, remaining));
    session.pendingTerminalOutput[0] = chunk.slice(remaining);
    used += remaining;
    accountTerminalOutputConsumed(session, remaining);
    break;
  }
  if (!binary) return chunks.join("");
  if (chunks.length === 1) return chunks[0];
  const merged = new Uint8Array(used);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function drainTerminalOutput(session) {
  session.terminalOutputFrame = 0;
  session.terminalOutputFrameKind = "";
  if (!session.term || session.terminalOutputWriting || !session.pendingTerminalOutput?.length) return;
  const chunk = takeTerminalOutputChunk(session, TERMINAL_OUTPUT_FRAME_BUDGET);
  if (!terminalOutputLength(chunk)) {
    if (session.pendingTerminalOutput.length) scheduleTerminalOutputDrain(session);
    return;
  }
  const generation = Number(session.terminalOutputGeneration || 0);
  session.terminalOutputWriting = true;
  try {
    session.term.write(chunk, () => {
      if (Number(session.terminalOutputGeneration || 0) !== generation) return;
      session.terminalOutputWriting = false;
      if (session.pendingTerminalOutput?.length) {
        scheduleTerminalOutputDrain(session);
        return;
      }
      if (typeof refreshTerminalCommandBufferFromScreen === "function") refreshTerminalCommandBufferFromScreen(session);
      if (typeof finalizePendingTerminalCommand === "function") finalizePendingTerminalCommand(session);
      if (typeof finalizeTerminalAiBlockFromScreen === "function") finalizeTerminalAiBlockFromScreen(session);
    });
  } catch {
    session.terminalOutputWriting = false;
    if (session.pendingTerminalOutput.length) scheduleTerminalOutputDrain(session);
  }
}

function queueTerminalOutput(session, output) {
  if (!session?.term || (typeof output !== "string" && !(output instanceof Uint8Array))) return;
  if (!output.length && !output.byteLength) return;
  noteTerminalOutputRedraw(session, output);
  session.terminalOutputSequence = Number(session.terminalOutputSequence || 0) + 1;
  if (typeof captureTerminalAiBlockOutput === "function") captureTerminalAiBlockOutput(session, output);
  if (!session.pendingTerminalOutput) session.pendingTerminalOutput = [];
  session.pendingTerminalOutput.push(output);
  session.pendingTerminalOutputBytes = Number(session.pendingTerminalOutputBytes || 0) + terminalOutputLength(output);
  if (session.pendingTerminalOutputBytes >= TERMINAL_OUTPUT_HIGH_WATER_MARK) terminalOutputFlowMessage(session, true);
  scheduleTerminalOutputDrain(session);
}

function refreshTerminalSessionsAfterWindowResume() {
  for (const session of terminalSessions.values()) {
    if (session.pendingTerminalOutput?.length && !session.terminalOutputWriting) {
      if (session.terminalOutputFrame) {
        if (session.terminalOutputFrameKind === "animation") cancelAnimationFrame(session.terminalOutputFrame);
        else clearTimeout(session.terminalOutputFrame);
      }
      session.terminalOutputFrame = 0;
      session.terminalOutputFrameKind = "";
      drainTerminalOutput(session);
    }
    try { session.term?.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
  }
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function cancelTerminalOutputQueue(session) {
  if (!session) return;
  if (session.terminalOutputFrame) {
    if (session.terminalOutputFrameKind === "timeout") clearTimeout(session.terminalOutputFrame);
    else cancelAnimationFrame(session.terminalOutputFrame);
  }
  session.terminalOutputFrame = 0;
  session.terminalOutputFrameKind = "";
  session.terminalOutputGeneration = Number(session.terminalOutputGeneration || 0) + 1;
  session.terminalOutputWriting = false;
  session.pendingTerminalOutput = [];
  session.pendingTerminalOutputBytes = 0;
  session.terminalOutputFlowPaused = false;
}
