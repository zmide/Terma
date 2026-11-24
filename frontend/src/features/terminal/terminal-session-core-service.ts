import {terminalServices} from '@/features/terminal/installed-services';
export type TerminalSessionCoreConnection = {
  quick_connection?: unknown;
  terminal_session_mode?: unknown;
};

export type TerminalSessionCoreSocket = {
  readyState?: number;
  send(value: string): void;
};

export type TerminalSessionCoreSession = {
  reconnectToken?: string;
  everConnected?: boolean;
  manualDisconnecting?: boolean;
  authenticationFailed?: boolean;
  remoteSessionEnded?: boolean;
  connectionPending?: boolean;
  autoReconnectTimer?: number | null;
  autoReconnectAttempts?: number;
  autoReconnectPending?: boolean;
  autoReconnectRequested?: boolean;
  socket?: TerminalSessionCoreSocket | null;
  connectionAttempt?: number;
  [key: string]: unknown;
};

export type TerminalSessionCorePort = {
  openState: number;
  closedState?: number;
  updateStatus?: (connection: TerminalSessionCoreConnection, key: string, state: string) => void;
  connect?: (connection: TerminalSessionCoreConnection, key: string, options: {auto: boolean}) => void;
  storage?: Storage;
  crypto?: Crypto;
};

export const TERMINAL_AUTO_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 15000, 30000] as const;
const TERMINAL_RECONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

export function createTerminalSessionCoreService(port: TerminalSessionCorePort = {openState: 1}) {
  function supportsAutoReconnect(connection: TerminalSessionCoreConnection | null | undefined, session: TerminalSessionCoreSession | null | undefined) {
    return Boolean(session && connection && !connection.quick_connection
      && String(connection.terminal_session_mode || 'none') !== 'persistent'
      && session.reconnectToken
      && session.everConnected
      && !session.manualDisconnecting
      && !session.authenticationFailed
      && !session.remoteSessionEnded);
  }

  function cancelAutoReconnect(session: TerminalSessionCoreSession | null | undefined) {
    if (!session) return;
    if (session.autoReconnectTimer) globalThis.clearTimeout(session.autoReconnectTimer);
    session.autoReconnectTimer = null;
    session.autoReconnectPending = false;
  }

  function scheduleAutoReconnect(connection: TerminalSessionCoreConnection, key: string, session: TerminalSessionCoreSession) {
    if (!supportsAutoReconnect(connection, session) || session.autoReconnectTimer) return false;
    if (session.connectionPending) {
      session.autoReconnectRequested = true;
      return false;
    }
    const attempt = Number(session.autoReconnectAttempts || 0);
    if (attempt >= TERMINAL_AUTO_RECONNECT_DELAYS.length) {
      session.autoReconnectPending = false;
      port.updateStatus?.(connection, key, 'disconnected');
      return false;
    }
    const delay = TERMINAL_AUTO_RECONNECT_DELAYS[attempt];
    session.autoReconnectAttempts = attempt + 1;
    session.autoReconnectPending = true;
    port.updateStatus?.(connection, key, 'reconnecting');
    session.autoReconnectTimer = globalThis.setTimeout(() => {
      session.autoReconnectTimer = null;
      session.autoReconnectPending = false;
      session.autoReconnectRequested = false;
      if (!supportsAutoReconnect(connection, session)) return;
      port.connect?.(connection, key, {auto: true});
    }, delay) as unknown as number;
    return true;
  }

  function tokenForKey(key: string, enabled = true) {
    if (!enabled) return {token: '', restored: false};
    const storageKey = `terma:terminal-reconnect:${String(key || '')}`;
    try {
      const existing = String(port.storage?.getItem(storageKey) || '');
      if (TERMINAL_RECONNECT_TOKEN_PATTERN.test(existing)) return {token: existing, restored: true};
    } catch {}
    let token = '';
    try {
      if (port.crypto?.randomUUID) token = port.crypto.randomUUID();
      else if (port.crypto?.getRandomValues) {
        const bytes = new Uint8Array(24);
        port.crypto.getRandomValues(bytes);
        token = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    if (!TERMINAL_RECONNECT_TOKEN_PATTERN.test(token)) token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    try { port.storage?.setItem(storageKey, token); } catch {}
    return {token, restored: false};
  }

  function forgetToken(key: string) {
    try { port.storage?.removeItem(`terma:terminal-reconnect:${String(key || '')}`); } catch {}
  }

  function prepareClose(session: TerminalSessionCoreSession | null | undefined, key = '', options: {forgetToken?: boolean} = {}) {
    if (!session) return;
    session.manualDisconnecting = true;
    cancelAutoReconnect(session);
    session.autoReconnectAttempts = 0;
    session.autoReconnectRequested = false;
    if (session.socket?.readyState === port.openState) {
      try { session.socket.send(JSON.stringify({type: 'terminal-detach'})); } catch {}
    }
    if (options.forgetToken && key) forgetToken(key);
  }

  function beginConnection(session: TerminalSessionCoreSession | null | undefined, options: {auto?: boolean; initial?: boolean} = {}) {
    if (!session) return 0;
    if (!options.auto) {
      cancelAutoReconnect(session);
      session.autoReconnectAttempts = 0;
      session.autoReconnectRequested = false;
      session.manualDisconnecting = false;
      session.remoteSessionEnded = false;
      if (!options.initial) {
        session.reconnectTokenStateHandled = true;
        session.expectingReattach = false;
      }
    }
    const attempt = Number(session.connectionAttempt || 0) + 1;
    session.connectionAttempt = attempt;
    session.connectionPending = true;
    return attempt;
  }

  function finishConnection(connection: TerminalSessionCoreConnection, key: string, session: TerminalSessionCoreSession | null | undefined,
    attempt: number, options: {auto?: boolean; isCurrent?: () => boolean} = {}) {
    if (!session || session.connectionAttempt !== attempt || (options.isCurrent && !options.isCurrent())) return;
    session.connectionPending = false;
    const closedState = port.closedState ?? 3;
    if (options.auto && (!session.socket || session.socket.readyState === closedState)
      && session.autoReconnectRequested && supportsAutoReconnect(connection, session)) {
      session.autoReconnectRequested = false;
      scheduleAutoReconnect(connection, key, session);
    }
  }

  function markConnected(session: TerminalSessionCoreSession | null | undefined) {
    if (!session) return;
    session.connected = true;
    session.everConnected = true;
    session.autoReconnectAttempts = 0;
    session.autoReconnectPending = false;
    session.remoteSessionEnded = false;
    session.serverSessionState = 'connected';
  }

  return {
    supportsAutoReconnect,
    cancelAutoReconnect,
    scheduleAutoReconnect,
    tokenForKey,
    forgetToken,
    prepareClose,
    beginConnection,
    finishConnection,
    markConnected
  };
}

export function installTerminalSessionCoreService(port:TerminalSessionCorePort) {
  if(!terminalServices.termaTerminalSessionCore)terminalServices.termaTerminalSessionCore=createTerminalSessionCoreService(port);
}



export interface InstalledFeaturesTerminalTerminalSessionCoreServiceServices {
  termaTerminalSessionCore?: ReturnType<typeof createTerminalSessionCoreService>;
}
