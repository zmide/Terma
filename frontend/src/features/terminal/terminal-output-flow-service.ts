import {terminalServices} from '@/features/terminal/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {terminalViewport} from './terminal-viewport-service';
export interface TerminalOutputTerm {
  element?: Element | null;
  rows?: number;
  buffer?: {active?: {type?: string; viewportY?: number; baseY?: number}};
  hasSelection?: () => boolean;
  write(value: string | Uint8Array, callback?: () => void): void;
  refresh?(start: number, end: number): void;
}

export interface TerminalOutputFlowSession {
  key?: string;
  socket?: {readyState?: number; send(value: string): void} | null;
  term?: TerminalOutputTerm | null;
  pendingTerminalOutput?: Array<string | Uint8Array>;
  pendingTerminalOutputBytes?: number;
  terminalOutputFlowPaused?: boolean;
  terminalOutputFrame?: number;
  terminalOutputFrameKind?: string;
  terminalOutputGeneration?: number;
  terminalOutputWriting?: boolean;
  terminalOutputSequence?: number;
  terminalRedrawWindowStartedAt?: number;
  terminalRedrawCount?: number;
  terminalRedrawActiveUntil?: number;
}

export interface TerminalOutputFlowPort {
  openState: number;
  isFocused?: (session: TerminalOutputFlowSession) => boolean;
  captureAiBlock?: (session: TerminalOutputFlowSession, value: string | Uint8Array) => void;
  refreshCommandBuffer?: (session: TerminalOutputFlowSession) => void;
  finalizePendingCommand?: (session: TerminalOutputFlowSession) => void;
  finalizeAiBlock?: (session: TerminalOutputFlowSession) => void;
  fit?: () => void;
}

export const TERMINAL_OUTPUT_FRAME_BUDGET = 32 * 1024;
export const TERMINAL_OUTPUT_DRAIN_DELAY_MS = 8;
export const TERMINAL_OUTPUT_TUI_DRAIN_DELAY_MS = 32;
export const TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS = 96;
export const TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS = 24;
export const TERMINAL_OUTPUT_HIGH_WATER_MARK = 128 * 1024;
export const TERMINAL_OUTPUT_LOW_WATER_MARK = 32 * 1024;
const TERMINAL_OUTPUT_REDRAW_WINDOW_MS = 750;
const TERMINAL_OUTPUT_REDRAW_ACTIVE_MS = 1200;
const TERMINAL_OUTPUT_REDRAW_THRESHOLD = 8;
const TERMINAL_OUTPUT_REDRAW_FINAL_BYTES = new Set([0x46, 0x47, 0x48, 0x4a, 0x4b]);

function outputLength(value: string | Uint8Array | undefined) {
  return typeof value === 'string' ? value.length : Number(value?.byteLength || 0);
}

function redrawCount(value: string | Uint8Array) {
  const length = outputLength(value);
  if (!length) return 0;
  const codeAt = typeof value === 'string' ? (index: number) => value.charCodeAt(index) : (index: number) => value[index];
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

function noteRedraw(session: TerminalOutputFlowSession, value: string | Uint8Array) {
  const count = redrawCount(value);
  if (!count) return;
  const now = Date.now();
  if (now - Number(session.terminalRedrawWindowStartedAt || 0) > TERMINAL_OUTPUT_REDRAW_WINDOW_MS) {
    session.terminalRedrawWindowStartedAt = now;
    session.terminalRedrawCount = 0;
  }
  session.terminalRedrawCount = Number(session.terminalRedrawCount || 0) + count;
  if (session.terminalRedrawCount >= TERMINAL_OUTPUT_REDRAW_THRESHOLD) session.terminalRedrawActiveUntil = now + TERMINAL_OUTPUT_REDRAW_ACTIVE_MS;
}

export function createTerminalOutputFlowService(port: TerminalOutputFlowPort = {openState: 1}) {
  function message(session: TerminalOutputFlowSession | null | undefined, paused: boolean) {
    if (!session?.socket || session.socket.readyState !== port.openState) return false;
    if (Boolean(session.terminalOutputFlowPaused) === Boolean(paused)) return false;
    try {
      session.socket.send(JSON.stringify({type: 'terminal-output-flow', paused: Boolean(paused)}));
      session.terminalOutputFlowPaused = Boolean(paused);
      return true;
    } catch { return false; }
  }

  function sync(session: TerminalOutputFlowSession | null | undefined) {
    if (!session) return;
    session.terminalOutputFlowPaused = false;
    if (Number(session.pendingTerminalOutputBytes || 0) >= TERMINAL_OUTPUT_HIGH_WATER_MARK) message(session, true);
  }

  function consumed(session: TerminalOutputFlowSession | null | undefined, amount: number) {
    if (!session) return;
    session.pendingTerminalOutputBytes = Math.max(0, Number(session.pendingTerminalOutputBytes || 0) - Math.max(0, Number(amount || 0)));
    if (session.terminalOutputFlowPaused && session.pendingTerminalOutputBytes <= TERMINAL_OUTPUT_LOW_WATER_MARK) message(session, false);
  }

  function isFocused(session: TerminalOutputFlowSession) {
    return port.isFocused ? port.isFocused(session) : true;
  }

  function schedule(session: TerminalOutputFlowSession) {
    if (session.terminalOutputFrame) return;
    session.terminalOutputFrameKind = 'timeout';
    const hidden = Boolean(globalThis.document?.hidden);
    const buffer = session.term?.buffer?.active;
    const detached = session.term?.element && session.term.element.isConnected === false;
    const background = detached || !isFocused(session);
    const alternateScreen = buffer?.type === 'alternate';
    const frequentRedraw = Number(session.terminalRedrawActiveUntil || 0) > Date.now();
    const viewingScrollback = Boolean(session.term?.hasSelection?.() || (buffer && Number(buffer.viewportY) < Number(buffer.baseY) - 1));
    const delay = hidden || background
      ? TERMINAL_OUTPUT_BACKGROUND_DRAIN_DELAY_MS
      : viewingScrollback
        ? TERMINAL_OUTPUT_SCROLLBACK_DRAIN_DELAY_MS
        : alternateScreen || frequentRedraw
          ? TERMINAL_OUTPUT_TUI_DRAIN_DELAY_MS
          : TERMINAL_OUTPUT_DRAIN_DELAY_MS;
    session.terminalOutputFrame = globalThis.setTimeout(() => drain(session), delay) as unknown as number;
  }

  function take(session: TerminalOutputFlowSession, budget: number) {
    const pending = session.pendingTerminalOutput || [];
    const first = pending[0];
    const binary = first instanceof Uint8Array;
    const chunks: Array<string | Uint8Array> = [];
    let used = 0;
    while (pending.length && used < budget) {
      const chunk = pending[0];
      if ((chunk instanceof Uint8Array) !== binary) break;
      const remaining = budget - used;
      const length = outputLength(chunk);
      if (length <= remaining) {
        chunks.push(pending.shift()!);
        used += length;
        consumed(session, length);
        continue;
      }
      chunks.push(typeof chunk === 'string' ? chunk.slice(0, remaining) : chunk.slice(0, remaining));
      pending[0] = typeof chunk === 'string' ? chunk.slice(remaining) : chunk.slice(remaining);
      used += remaining;
      consumed(session, remaining);
      break;
    }
    if (!binary) return chunks.join('');
    if (chunks.length === 1) return chunks[0];
    const merged = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array)) continue;
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  function drain(session: TerminalOutputFlowSession) {
    session.terminalOutputFrame = 0;
    session.terminalOutputFrameKind = '';
    if (!session.term || session.terminalOutputWriting || !session.pendingTerminalOutput?.length) return;
    const chunk = take(session, TERMINAL_OUTPUT_FRAME_BUDGET);
    if (!outputLength(chunk)) {
      if (session.pendingTerminalOutput.length) schedule(session);
      return;
    }
    const generation = Number(session.terminalOutputGeneration || 0);
    session.terminalOutputWriting = true;
    try {
      session.term.write(chunk, () => {
        if (Number(session.terminalOutputGeneration || 0) !== generation) return;
        session.terminalOutputWriting = false;
        if (session.pendingTerminalOutput?.length) {
          schedule(session);
          return;
        }
        port.refreshCommandBuffer?.(session);
        port.finalizePendingCommand?.(session);
        port.finalizeAiBlock?.(session);
      });
    } catch {
      session.terminalOutputWriting = false;
      if (session.pendingTerminalOutput.length) schedule(session);
    }
  }

  function queue(session: TerminalOutputFlowSession | null | undefined, value: string | Uint8Array) {
    if (!session?.term || (typeof value !== 'string' && !(value instanceof Uint8Array))) return;
    if (!outputLength(value)) return;
    noteRedraw(session, value);
    session.terminalOutputSequence = Number(session.terminalOutputSequence || 0) + 1;
    port.captureAiBlock?.(session, value);
    if (!session.pendingTerminalOutput) session.pendingTerminalOutput = [];
    session.pendingTerminalOutput.push(value);
    session.pendingTerminalOutputBytes = Number(session.pendingTerminalOutputBytes || 0) + outputLength(value);
    if (session.pendingTerminalOutputBytes >= TERMINAL_OUTPUT_HIGH_WATER_MARK) message(session, true);
    schedule(session);
  }

  function cancel(session: TerminalOutputFlowSession | null | undefined) {
    if (!session) return;
    if (session.terminalOutputFrame) {
      if (session.terminalOutputFrameKind === 'timeout') globalThis.clearTimeout(session.terminalOutputFrame);
      else globalThis.cancelAnimationFrame(session.terminalOutputFrame);
    }
    session.terminalOutputFrame = 0;
    session.terminalOutputFrameKind = '';
    session.terminalOutputGeneration = Number(session.terminalOutputGeneration || 0) + 1;
    session.terminalOutputWriting = false;
    session.pendingTerminalOutput = [];
    session.pendingTerminalOutputBytes = 0;
    session.terminalOutputFlowPaused = false;
  }

  function resume(session: TerminalOutputFlowSession | null | undefined) {
    if (!session?.pendingTerminalOutput?.length || session.terminalOutputWriting) return;
    resumeSessions([session]);
  }

  function resumeSessions(sessions: Iterable<TerminalOutputFlowSession>) {
    for (const session of sessions) {
      if (session.pendingTerminalOutput?.length && !session.terminalOutputWriting) {
        if (session.terminalOutputFrame) {
          if (session.terminalOutputFrameKind === 'animation') globalThis.cancelAnimationFrame(session.terminalOutputFrame);
          else globalThis.clearTimeout(session.terminalOutputFrame);
        }
        session.terminalOutputFrame = 0;
        session.terminalOutputFrameKind = '';
        drain(session);
      }
      try { session.term?.refresh?.(0, Math.max(0, Number(session.term.rows || 0) - 1)); } catch {}
    }
    port.fit?.();
  }

  return {message, sync, consumed, schedule, drain, queue, cancel, resume, resumeSessions};
}

export function installTerminalOutputFlowService(isFocused: NonNullable<TerminalOutputFlowPort['isFocused']>) {
  terminalServices.termaTerminalOutputFlow = createTerminalOutputFlowService({
    openState: typeof WebSocket === 'undefined' ? 1 : WebSocket.OPEN,
    isFocused,
    captureAiBlock: (session,value)=>assistantServices.termaAssistant?.tracker.captureOutput(session,value),
    refreshCommandBuffer: (...args) => terminalServices.termaTerminalCommandTracking?.refreshCommandBufferFromScreen(...args),
    finalizePendingCommand: (...args) => terminalServices.termaTerminalCommandTracking?.finalizePendingCommand(...args),
    finalizeAiBlock: session=>{assistantServices.termaAssistant?.tracker.fromScreen(session);},
    fit: () => terminalViewport.schedule()
  });
}



export interface InstalledFeaturesTerminalTerminalOutputFlowServiceServices {
  termaTerminalOutputFlow?: ReturnType<typeof createTerminalOutputFlowService>;
}
