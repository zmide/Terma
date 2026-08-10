const TERMINAL_OUTPUT_FRAME_BUDGET = 128 * 1024;

function scheduleTerminalOutputDrain(session) {
  if (session.terminalOutputFrame) return;
  if (document.hidden) {
    session.terminalOutputFrameKind = "timeout";
    session.terminalOutputFrame = setTimeout(() => drainTerminalOutput(session), 16);
    return;
  }
  session.terminalOutputFrameKind = "animation";
  session.terminalOutputFrame = requestAnimationFrame(() => drainTerminalOutput(session));
}

function terminalOutputLength(value) {
  return typeof value === "string" ? value.length : Number(value?.byteLength || 0);
}

function takeTerminalOutputChunk(session, budget) {
  const chunk = session.pendingTerminalOutput[0];
  const length = terminalOutputLength(chunk);
  if (length <= budget) {
    session.pendingTerminalOutput.shift();
    return chunk;
  }
  const head = chunk.slice(0, budget);
  session.pendingTerminalOutput[0] = chunk.slice(budget);
  return head;
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
  if (!session.pendingTerminalOutput) session.pendingTerminalOutput = [];
  session.pendingTerminalOutput.push(output);
  scheduleTerminalOutputDrain(session);
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
}
