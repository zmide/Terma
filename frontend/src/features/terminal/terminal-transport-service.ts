import {terminalServices} from '@/features/terminal/installed-services';
import type { TerminalSessionCoreConnection, TerminalSessionCoreSession, TerminalSessionCoreSocket } from './terminal-session-core-service';

type Disposable = { dispose(): void };
type TerminalChunk = string | Uint8Array;
export type TerminalTransportConnection = TerminalSessionCoreConnection & {
  id: number;
  terminal_encoding?: string;
  quick_token?: string;
};
export type TerminalTransportSocket = TerminalSessionCoreSocket & Pick<WebSocket, 'binaryType' | 'addEventListener' | 'removeEventListener' | 'close'>;
export type TerminalTransportSession = TerminalSessionCoreSession & {
  term: {
    onData(callback: (value: string) => void): Disposable;
    onResize(callback: (size: {cols: number; rows: number}) => void): Disposable;
  };
  socket?: TerminalTransportSocket | null;
  terminalEncoding?: string;
  quickToken?: string;
  credentialRepairPromptAttempt?: number;
  inputDisposable?: Disposable;
  resizeDisposable?: Disposable;
};

export interface TerminalTransportPort {
  openState: number;
  isCurrent(key: string, session: TerminalTransportSession): boolean;
  tr(key: string): string;
  markConnected(session: TerminalTransportSession): void;
  syncOutput(session: TerminalTransportSession): void;
  updateStatus(connection: TerminalTransportConnection, key: string, state: string): void;
  scheduleDirectory(session: TerminalTransportSession, connection: TerminalTransportConnection, key: string, delay?: number): void;
  cancelDirectory(session: TerminalTransportSession): void;
  initializeZmodem(session: TerminalTransportSession): void;
  closeZmodem(session: TerminalTransportSession): void;
  consumeZmodem(session: TerminalTransportSession, data: string | ArrayBuffer): boolean;
  prepareZmodemInput(session: TerminalTransportSession, data: string): boolean;
  takeZmodemInput(session: TerminalTransportSession, data: string): string;
  markEnded(session: TerminalTransportSession): void;
  authenticationFailure(session: TerminalTransportSession, data: string | ArrayBuffer): boolean;
  updateSmartState(key: string, data: TerminalChunk): void;
  queueOutput(session: TerminalTransportSession, data: TerminalChunk): void;
  fitMobile(): void;
  supportsReconnect(connection: TerminalTransportConnection, session: TerminalTransportSession): boolean;
  scheduleReconnect(connection: TerminalTransportConnection, key: string, session: TerminalTransportSession): void;
  repairCredentials(connection: TerminalTransportConnection, key: string): unknown;
  interceptPaste(key: string, id: number, data: string): boolean;
  ctrlActive(): boolean;
  transformInput(key: string, data: string): string;
  trackCommand(session: TerminalTransportSession, data: string): void;
  broadcastInput(key: string, outgoing: string, original: string): boolean;
  reconnectInput(data: string): boolean;
  reconnect(id: number, key: string): void;
  reportError(operation: string): void;
}

const CONTROL_PREFIX = '\0TERMA:';

export function createTerminalTransportService(port: TerminalTransportPort) {
  const bindings = new WeakMap<TerminalTransportSession, Disposable>();

  function release(session: TerminalTransportSession) {
    bindings.get(session)?.dispose();
  }

  function bind(connection: TerminalTransportConnection, key: string, session: TerminalTransportSession,
    socket: TerminalTransportSocket, attempt: number) {
    release(session);
    let disposed = false;
    let opened = false;
    let closed = false;
    const listeners: Array<[string, EventListener]> = [];
    const disposables: Disposable[] = [];
    const current = () => !disposed && session.socket === socket && port.isCurrent(key, session);
    const active = () => !closed && current();
    const output = (translationKey: string) => port.queueOutput(session, `\r\n${port.tr(translationKey)}\r\n`);
    const binding = {
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const [name, listener] of listeners) socket.removeEventListener(name, listener);
        for (const disposable of disposables) {
          try { disposable.dispose(); }
          catch { port.reportError('dispose'); }
        }
        if (session.inputDisposable === disposables[0]) session.inputDisposable = undefined;
        if (session.resizeDisposable === disposables[1]) session.resizeDisposable = undefined;
        if (bindings.get(session) === binding) bindings.delete(session);
      }
    };
    const listen = (name: string, listener: EventListener) => {
      socket.addEventListener(name, listener);
      listeners.push([name, listener]);
    };
    const send = (value: string) => {
      try { socket.send(value); }
      catch { if (current()) output('terminal:system.websocket_failed'); }
    };

    function controlMessage(data: string) {
      let control: unknown;
      try { control = JSON.parse(data.slice(CONTROL_PREFIX.length)); }
      catch { return; } // Reserved malformed control frames must never reach the terminal.
      if (!control || typeof control !== 'object' || Array.isArray(control)) return;
      const message = control as Record<string, unknown>;
      if (message.type !== 'terminal-session' || typeof message.state !== 'string') return;
      session.serverSessionState = message.state;
      if (message.state === 'reconnected') {
        session.reconnectTokenRestored = false;
        session.reconnectTokenStateHandled = true;
        session.expectingReattach = false;
        session.remoteSessionEnded = false;
      } else if (message.state === 'ended') {
        session.remoteSessionEnded = true;
        port.markEnded(session);
      } else if (message.state === 'created' && (session.reconnectTokenRestored || session.expectingReattach)
        && !session.reconnectTokenStateHandled) {
        session.reconnectTokenStateHandled = true;
        session.expectingReattach = false;
        output('terminal:system.reconnect_expired');
      }
    }

    function message(event: Event) {
      if (!active()) return;
      const data: unknown = (event as MessageEvent).data;
      if (typeof data === 'string' && data.startsWith(CONTROL_PREFIX)) {
        controlMessage(data);
        return;
      }
      if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) return;
      if (port.authenticationFailure(session, data)) session.authenticationFailed = true;
      const terminalOutput = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      port.updateSmartState(key, terminalOutput);
      if (!port.consumeZmodem(session, data)) {
        port.queueOutput(session, terminalOutput);
        port.scheduleDirectory(session, connection, key);
      }
      port.fitMobile();
    }

    function close() {
      if (!active()) return;
      closed = true;
      session.connected = false;
      if (session.remoteSessionEnded) port.markEnded(session);
      port.cancelDirectory(session);
      port.closeZmodem(session);
      const reconnect = port.supportsReconnect(connection, session) && !session.remoteSessionEnded;
      if (reconnect) session.expectingReattach = true;
      if (!reconnect || Number(session.autoReconnectAttempts || 0) === 0) {
        output(reconnect ? 'terminal:system.closed_auto_reconnect' : 'terminal:system.closed_reconnect');
      }
      if (reconnect) port.scheduleReconnect(connection, key, session);
      else port.updateStatus(connection, key, 'disconnected');
      if (connection.quick_connection && !opened && !session.authenticationFailed) {
        session.quickToken = '';
        connection.quick_token = '';
        output('terminal:system.quick_credentials_expired');
      }
      if (session.authenticationFailed && session.credentialRepairPromptAttempt !== attempt) {
        session.credentialRepairPromptAttempt = attempt;
        output(connection.quick_connection ? 'terminal:system.quick_auth_repair_opening' : 'terminal:system.auth_repair_opening');
        queueMicrotask(() => {
          if (!current() || session.connectionAttempt !== attempt) return;
          try {
            Promise.resolve(port.repairCredentials(connection, key)).catch(() => port.reportError('credentials'));
          } catch { port.reportError('credentials'); }
        });
      }
    }

    bindings.set(session, binding);
    session.socket = socket;
    socket.binaryType = 'arraybuffer';
    try {
      port.initializeZmodem(session);
      listen('open', () => {
        if (!active()) return;
        opened = true;
        port.markConnected(session);
        port.syncOutput(session);
        send(JSON.stringify({type: 'terminal-encoding', encoding: session.terminalEncoding || connection.terminal_encoding || 'utf8'}));
        port.updateStatus(connection, key, 'connected');
        port.scheduleDirectory(session, connection, key, 1200);
      });
      listen('message', message);
      listen('close', close);
      listen('error', () => { if (active()) output('terminal:system.websocket_failed'); });
      session.inputDisposable = session.term.onData(data => {
        if (!current() || port.prepareZmodemInput(session, data)) return;
        const prepared = port.takeZmodemInput(session, data);
        if (port.interceptPaste(key, connection.id, prepared)) return;
        const beforeCtrl = port.ctrlActive();
        const outgoing = port.transformInput(key, prepared);
        if (!beforeCtrl) port.trackCommand(session, data);
        if (!closed && socket.readyState === port.openState) {
          if (!port.broadcastInput(key, outgoing, data)) send(outgoing);
        } else if (port.reconnectInput(data)) port.reconnect(connection.id, key);
      });
      disposables.push(session.inputDisposable);
      session.resizeDisposable = session.term.onResize(size => {
        if (active() && socket.readyState === port.openState) send(JSON.stringify({type: 'resize', cols: size.cols, rows: size.rows}));
      });
      disposables.push(session.resizeDisposable);
    } catch (error) {
      binding.dispose();
      throw error;
    }
    return binding;
  }

  return {bind, release};
}

export function installTerminalTransportService(port:TerminalTransportPort) {
  if (terminalServices.termaTerminalTransport) return terminalServices.termaTerminalTransport;
  terminalServices.termaTerminalTransport = createTerminalTransportService(port);
}



export interface InstalledFeaturesTerminalTerminalTransportServiceServices {
  termaTerminalTransport?: ReturnType<typeof createTerminalTransportService>;
}
