const TERMINAL_OUTPUT_FRAME_BUDGET = 32 * 1024;
const TERMINAL_OUTPUT_DRAIN_DELAY_MS = 8;
const TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS = 48;
const TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS = 24;
const TERMINAL_OUTPUT_HIGH_WATER_MARK = 128 * 1024;
const TERMINAL_OUTPUT_LOW_WATER_MARK = 32 * 1024;

function scheduleTerminalOutputDrain(session) {
  if (session.terminalOutputFrame) return;
  // Terminal parsing must not depend on a compositor frame. Chromium can keep
  // document.visibilityState as visible when Electron background throttling is
  // disabled, while Windows still stops presenting frames for a minimized window.
  session.terminalOutputFrameKind = "timeout";
  const hidden = Boolean(globalThis.document?.hidden);
  const buffer = session.term?.buffer?.active;
  const viewingScrollback = Boolean(
    session.term?.hasSelection?.()
    || (buffer && Number(buffer.viewportY) < Number(buffer.baseY) - 1)
  );
  const delay = hidden
    ? TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS
    : viewingScrollback
      ? TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS
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
      if (typeof refreshTerminalCommandBufferFromScreen === "function") refreshTerminalCommandBufferFromScreen(session);
      if (typeof finalizePendingTerminalCommand === "function") finalizePendingTerminalCommand(session);
      if (typeof finalizeTerminalAiBlockFromScreen === "function") finalizeTerminalAiBlockFromScreen(session);
      if (session.pendingTerminalOutput?.length) scheduleTerminalOutputDrain(session);
    });
  } catch {
    session.terminalOutputWriting = false;
    if (session.pendingTerminalOutput.length) scheduleTerminalOutputDrain(session);
  }
}

function queueTerminalOutput(session, output) {
  if (!session?.term || (typeof output !== "string" && !(output instanceof Uint8Array))) return;
  if (!output.length && !output.byteLength) return;
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
