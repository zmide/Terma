import {terminalServices} from '@/features/terminal/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {applicationState} from '@/shared/application-state';
import {currentConnection} from '@/features/connections/connection-selection';
import {terminalHistory} from './terminal-history';
import {terminalPromptStateAtRow} from './terminal-prompt';
import { terminalDirectory } from './terminal-directory-workspace';
export interface TerminalPromptState {
  row: number;
  command: string;
  cursor: number;
}

export interface TerminalPendingCommandCapture {
  row?: number;
  fallback: string;
  before: TerminalPromptState | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface TerminalCommandTrackingSession {
  key?: string;
  id?: number;
  sensitiveInput?: boolean;
  commandBuffer?: string;
  commandCursor?: number;
  commandBufferFromPaste?: boolean;
  commandBufferNeedsScreenSync?: boolean;
  commandScreenBeforeControl?: TerminalPromptState | null;
  pendingCommandCapture?: TerminalPendingCommandCapture | null;
  aiActiveBlockId?: string;
  connection?: unknown;
}

export interface TerminalCommandTrackingPort {
  promptStateAtRow(session: TerminalCommandTrackingSession, row?: number): TerminalPromptState | null;
  saveRecentCommand(command: string): void;
  captureAiCommand?(session: TerminalCommandTrackingSession, command: string, metadata: Record<string, unknown>): void;
  resolveAiWaitingInput?(session: TerminalCommandTrackingSession, input: string): boolean;
  connectionForSession?(session: TerminalCommandTrackingSession): unknown;
  trackDirectoryCommand?(session: TerminalCommandTrackingSession, connection: unknown, key: string, command: string): void | Promise<unknown>;
  activeTabKey?(): string;
}

export interface TerminalCommandTrackingService {
  trackCommand(session: TerminalCommandTrackingSession, data: string, options?: { preferCommandBuffer?: boolean; source?: string }): void;
  recordAgentCommand(session: TerminalCommandTrackingSession, command: string, metadata?: Record<string, unknown>): void;
  recordCommand(session: TerminalCommandTrackingSession, command: string, metadata?: Record<string, unknown>): void;
  markCommandScreenSync(session: TerminalCommandTrackingSession): void;
  refreshCommandBufferFromScreen(session: TerminalCommandTrackingSession, force?: boolean): boolean;
  captureCommandSubmission(session: TerminalCommandTrackingSession, fallback: string): void;
  finalizePendingCommand(session: TerminalCommandTrackingSession, force?: boolean): boolean;
}

export function createTerminalCommandTrackingService(port: TerminalCommandTrackingPort): TerminalCommandTrackingService {
  function recordCommand(session: TerminalCommandTrackingSession, command: string, metadata: Record<string, unknown> = {}) {
    const text = String(command || '').trim();
    if (!text || session.sensitiveInput) return;
    if (port.resolveAiWaitingInput?.(session, text)) return;
    port.saveRecentCommand(text);
    port.captureAiCommand?.(session, text, metadata);
    const connection = port.connectionForSession?.(session);
    if (connection) void port.trackDirectoryCommand?.(session, connection, session.key || port.activeTabKey?.() || '', text);
  }

  function recordAgentCommand(session: TerminalCommandTrackingSession, command: string, metadata: Record<string, unknown> = {}) {
    const text = String(command || '').trim();
    if (!text || session.sensitiveInput) return;
    session.commandBuffer = '';
    session.commandCursor = 0;
    session.commandBufferFromPaste = false;
    session.commandBufferNeedsScreenSync = false;
    session.commandScreenBeforeControl = null;
    recordCommand(session, text, {...metadata, agent: true});
  }

  function markCommandScreenSync(session: TerminalCommandTrackingSession) {
    session.commandScreenBeforeControl = port.promptStateAtRow(session);
    session.commandBufferNeedsScreenSync = true;
  }

  function refreshCommandBufferFromScreen(session: TerminalCommandTrackingSession, force = false) {
    if (!session.commandBufferNeedsScreenSync && !force) return false;
    const state = port.promptStateAtRow(session);
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

  function finalizePendingCommand(session: TerminalCommandTrackingSession, force = false) {
    const capture = session.pendingCommandCapture;
    if (!capture) return false;
    const state = port.promptStateAtRow(session, capture.row);
    const changed = Boolean(state?.command) && (
      !capture.before
      || state!.row !== capture.before.row
      || state!.command !== capture.before.command
      || state!.cursor !== capture.before.cursor
    );
    if (!force && !changed) return false;
    if (capture.timer) clearTimeout(capture.timer);
    session.pendingCommandCapture = null;
    session.commandBufferNeedsScreenSync = false;
    session.commandScreenBeforeControl = null;
    recordCommand(session, state?.command || capture.fallback);
    return true;
  }

  function captureCommandSubmission(session: TerminalCommandTrackingSession, fallback: string) {
    refreshCommandBufferFromScreen(session);
    const screen = port.promptStateAtRow(session);
    const command = String(session.commandBuffer || fallback || '').trim();
    if (!session.commandBufferNeedsScreenSync) {
      recordCommand(session, command || screen?.command || '');
      return;
    }
    if (session.pendingCommandCapture?.timer) clearTimeout(session.pendingCommandCapture.timer);
    const capture: TerminalPendingCommandCapture = {
      row: screen?.row,
      fallback: command,
      before: session.commandScreenBeforeControl || null,
      timer: null
    };
    capture.timer = setTimeout(() => finalizePendingCommand(session, true), 1500);
    session.pendingCommandCapture = capture;
  }

  function trackCommand(session: TerminalCommandTrackingSession, data: string, options: { preferCommandBuffer?: boolean; source?: string } = {}) {
    session.commandBuffer = session.commandBuffer || '';
    session.commandCursor = Number.isInteger(session.commandCursor) ? session.commandCursor : session.commandBuffer.length;
    const raw = String(data || '');
    if (session.sensitiveInput) {
      if (session.pendingCommandCapture?.timer) clearTimeout(session.pendingCommandCapture.timer);
      session.pendingCommandCapture = null;
      session.commandBuffer = '';
      session.commandCursor = 0;
      session.commandBufferFromPaste = false;
      session.commandBufferNeedsScreenSync = false;
      return;
    }
    if (raw.includes('\x1b')) {
      refreshCommandBufferFromScreen(session);
      markCommandScreenSync(session);
      return;
    }
    let previousWasCarriageReturn = false;
    for (const ch of raw) {
      if (ch === '\n' && previousWasCarriageReturn) {
        previousWasCarriageReturn = false;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        const buffer = session.commandBuffer.trim();
        const preferCommandBuffer = options.preferCommandBuffer === true || session.commandBufferFromPaste === true;
        if (preferCommandBuffer) recordCommand(session, buffer);
        else captureCommandSubmission(session, buffer);
        session.commandBuffer = '';
        session.commandCursor = 0;
        session.commandBufferFromPaste = false;
      } else if (ch === '\x7f' || ch === '\b') {
        refreshCommandBufferFromScreen(session);
        const cursor = Math.max(0, Math.min(session.commandBuffer.length, session.commandCursor || 0));
        if (cursor > 0) {
          session.commandBuffer = `${session.commandBuffer.slice(0, cursor - 1)}${session.commandBuffer.slice(cursor)}`;
          session.commandCursor = cursor - 1;
        }
      } else if (ch === '\x03') {
        if (session.pendingCommandCapture?.timer) clearTimeout(session.pendingCommandCapture.timer);
        session.pendingCommandCapture = null;
        session.commandBuffer = '';
        session.commandCursor = 0;
        session.commandBufferFromPaste = false;
        session.commandBufferNeedsScreenSync = false;
      } else if (ch === '\t') {
        refreshCommandBufferFromScreen(session);
        markCommandScreenSync(session);
      } else if (ch >= ' ' && ch !== '\x7f') {
        refreshCommandBufferFromScreen(session);
        const cursor = Math.max(0, Math.min(session.commandBuffer.length, session.commandCursor || 0));
        session.commandBuffer = `${session.commandBuffer.slice(0, cursor)}${ch}${session.commandBuffer.slice(cursor)}`;
        session.commandCursor = cursor + ch.length;
        if (options.source === 'paste') session.commandBufferFromPaste = true;
      }
      previousWasCarriageReturn = ch === '\r';
    }
  }

  return {trackCommand, recordAgentCommand, recordCommand, markCommandScreenSync, refreshCommandBufferFromScreen, captureCommandSubmission, finalizePendingCommand};
}



export function installTerminalCommandTrackingService() {
  terminalServices.termaTerminalCommandTracking = createTerminalCommandTrackingService({
    promptStateAtRow:terminalPromptStateAtRow,
    saveRecentCommand:terminalHistory.save,
    captureAiCommand: (session, command, metadata) => assistantServices.termaAssistant?.tracker.captureCommand(session,command,metadata),
    resolveAiWaitingInput: (session, input) => Boolean(assistantServices.termaAssistant?.interactions.resolveWaiting(session,input)),
    connectionForSession: session => session.connection || currentConnection(session.id),
    trackDirectoryCommand: (session, connection, key, command) => {
      const id = connection && typeof connection === 'object' && 'id' in connection ? connection.id : null;
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return terminalDirectory.track(session, {id}, key, command);
    },
    activeTabKey: () => applicationState.activeTabKey
  });
}

export interface InstalledFeaturesTerminalTerminalCommandTrackingServiceServices {
  termaTerminalCommandTracking?: TerminalCommandTrackingService;
}
