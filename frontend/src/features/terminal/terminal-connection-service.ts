import {terminalServices} from '@/features/terminal/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import type { PublicApiError } from '../../shared/api/public-errors';
import type { TerminalTransportConnection, TerminalTransportSession, TerminalTransportSocket } from './terminal-transport-service';

export type TerminalConnection = TerminalTransportConnection & {
  name: string;
  ssh_user: string;
  ssh_host: string;
  ssh_port: number;
  auth_type?: string;
  x11_mode?: string;
  terminal_session_backend?: string;
  terminal_session_id?: string;
};
export type TerminalConnectionSession = TerminalTransportSession & {
  term: TerminalTransportSession['term'] & {writeln(value: string): void; cols?: number; rows?: number};
  logId?: string;
};
type StartupOverride = Record<string, unknown> & {x11_mode?: string};
type StartupTicket = {token?: string};
type Startup = {token: string; x11Mode: string};

export interface TerminalConnectionPort {
  isCurrent(key: string, session: TerminalConnectionSession): boolean;
  api(path: string, options: {method: string; body: string}): Promise<StartupTicket>;
  tr(key: string, options?: Record<string, unknown>): string;
  notify(message: string, kind: 'error' | 'info'): void;
  updateStatus(connection: TerminalConnection, key: string, state: string): void;
  quickAuthentication(connection: TerminalConnection, key: string): void;
  cancelDirectory(session: TerminalConnectionSession): void;
  closeZmodem(session: TerminalConnectionSession): void;
  releaseTransport(session: TerminalConnectionSession): void;
  bindTransport(connection: TerminalConnection, key: string, session: TerminalConnectionSession, socket: TerminalTransportSocket, attempt: number): void;
  openSocket(url: string): TerminalTransportSocket;
  closeSocket(socket: TerminalTransportSocket): void;
  title(key: string): string;
  startupOverride(key: string): StartupOverride | null;
  scrollbackLines(): unknown;
  location(): {protocol: string; host: string};
  language(): string;
  openXServer(connectionId: number, key: string): Promise<unknown>;
  reportError(operation: string): void;
}

function errorDetails(cause: unknown) {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<PublicApiError>;
  return {code: typeof error.code === 'string' ? error.code : '', message: typeof error.message === 'string' ? error.message : ''};
}

export function createTerminalConnectionService(port: TerminalConnectionPort) {
  const current = (key: string, session: TerminalConnectionSession, attempt: number) =>
    session.connectionAttempt === attempt && port.isCurrent(key, session);

  async function preflight(connection: TerminalConnection, key: string, session: TerminalConnectionSession, attempt: number) {
    if (connection.quick_connection) return true;
    try {
      await port.api('/api/ssh/preflight', {method: 'POST', body: JSON.stringify({connection_id: connection.id})});
      return current(key, session, attempt);
    } catch (cause) {
      if (!current(key, session, attempt)) return false;
      const error = errorDetails(cause);
      const cancelled = error.code === 'SSH_HOST_TRUST_CANCELLED';
      session.term.writeln(`\r\n${port.tr(cancelled ? 'terminal:system.host_trust_cancelled' : 'terminal:system.host_trust_failed', {error: error.message})}`);
      port.updateStatus(connection, key, 'disconnected');
      if (!cancelled) port.notify(error.message || port.tr('terminal:notifications.host_trust_failed'), 'error');
      if (session.everConnected && !cancelled && !['SSH_HOST_KEY_UNKNOWN', 'SSH_HOST_KEY_CHANGED'].includes(error.code)) session.autoReconnectRequested = true;
      return false;
    }
  }

  async function prepareStartup(connection: TerminalConnection, key: string, session: TerminalConnectionSession, attempt: number): Promise<Startup | null> {
    const source = port.startupOverride(key);
    const override = source ? {...source} : null;
    const x11Mode = String(override?.x11_mode || connection.x11_mode || 'off');
    if (connection.quick_connection || (!override && !['trusted', 'untrusted'].includes(x11Mode))) return {token: '', x11Mode};
    const ticket = (startup: StartupOverride) => port.api('/api/terminal/startup-tickets', {
      method: 'POST', body: JSON.stringify({connection_id: connection.id, startup})
    });
    try {
      const result = await ticket(override || {});
      return current(key, session, attempt) ? {token: result.token || '', x11Mode} : null;
    } catch (cause) {
      if (!current(key, session, attempt)) return null;
      const error = errorDetails(cause);
      if (error.code !== 'DESKTOP_INTEGRATION_AUTH_REQUIRED') {
        session.term.writeln(`\r\n${port.tr('terminal:system.startup_prepare_failed', {error: error.message})}`);
        port.updateStatus(connection, key, 'disconnected');
        port.notify(error.message || port.tr('terminal:notifications.startup_prepare_failed'), 'error');
        return null;
      }
      if (['trusted', 'untrusted'].includes(String(override?.x11_mode || ''))) {
        session.term.writeln(`\r\n[X11] ${error.message}`);
        session.term.writeln(port.tr('terminal:system.x11_authorization_hint'));
        port.updateStatus(connection, key, 'authorization');
        port.notify(error.message || port.tr('terminal:notifications.x11_authorization_required'), 'error');
        try { await port.openXServer(connection.id, key); }
        catch { if (current(key, session, attempt)) port.reportError('x11-authorization'); }
        return null;
      }
      try {
        const result = await ticket({...override, x11_mode: 'off'});
        if (!current(key, session, attempt)) return null;
        session.term.writeln(`\r\n${port.tr('terminal:system.x11_fallback')}`);
        port.notify(port.tr('terminal:notifications.x11_fallback'), 'info');
        return {token: result.token || '', x11Mode: 'off'};
      } catch (fallbackCause) {
        if (!current(key, session, attempt)) return null;
        const fallbackError = errorDetails(fallbackCause);
        session.term.writeln(`\r\n${port.tr('terminal:system.ssh_fallback_failed', {error: fallbackError.message})}`);
        port.updateStatus(connection, key, 'disconnected');
        port.notify(fallbackError.message || port.tr('terminal:notifications.ssh_fallback_failed'), 'error');
        return null;
      }
    }
  }

  function socketUrl(connection: TerminalConnection, key: string, session: TerminalConnectionSession, startup: Startup) {
    const quick = Boolean(connection.quick_connection);
    const location = port.location();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const title = port.title(key) || port.tr('terminal:tabs.session', {name: connection.name, suffix: ''});
    const connectionQuery = quick ? `quick_token=${encodeURIComponent(String(session.quickToken || connection.quick_token || ''))}` : `id=${encodeURIComponent(connection.id)}`;
    const startupQuery = startup.token ? `&startup_token=${encodeURIComponent(startup.token)}` : '';
    const logQuery = session.logId ? `&log_id=${encodeURIComponent(session.logId)}` : '';
    const encodingQuery = `&encoding=${encodeURIComponent(session.terminalEncoding || connection.terminal_encoding || 'utf8')}`;
    const reconnectQuery = !quick && session.reconnectToken ? `&reconnect_token=${encodeURIComponent(session.reconnectToken)}` : '';
    const quickX11Query = quick ? `&x11_mode=${encodeURIComponent(startup.x11Mode)}` : '';
    const replayLines = Math.max(100, Math.min(10000, Math.floor(Number(port.scrollbackLines()) || 30000)));
    const sessionQuery = !quick && String(connection.terminal_session_mode || 'none') === 'persistent'
      ? `&session_mode=persistent&session_backend=${encodeURIComponent(connection.terminal_session_backend || 'auto')}&session_id=${encodeURIComponent(String(connection.terminal_session_id || ''))}&session_replay=${session.everConnected ? '0' : '1'}&session_replay_lines=${replayLines}` : '';
    return `${protocol}://${location.host}/ws/terminal?${connectionQuery}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}${encodingQuery}${logQuery}${startupQuery}${quickX11Query}${sessionQuery}${reconnectQuery}&language=${encodeURIComponent(port.language())}`;
  }

  async function connect(connection: TerminalConnection, key: string, session: TerminalConnectionSession, attempt: number) {
    if (!current(key, session, attempt)) return;
    if (connection.quick_connection && !String(session.quickToken || connection.quick_token || '')) {
      port.updateStatus(connection, key, 'authentication');
      session.term.writeln(`\r\n${port.tr('terminal:system.quick_credentials_expired_connect')}\r\n`);
      port.quickAuthentication(connection, key);
      return;
    }
    session.authenticationFailed = false;
    session.authenticationFailureWindow = '';
    port.cancelDirectory(session);
    const previousSocket = session.socket;
    session.socket = null;
    port.releaseTransport(session);
    port.closeZmodem(session);
    try { if (previousSocket) port.closeSocket(previousSocket); }
    catch { port.reportError('socket-close'); }
    for (const disposable of [session.inputDisposable, session.resizeDisposable]) {
      try { disposable?.dispose(); }
      catch { port.reportError('subscription-dispose'); }
    }
    session.inputDisposable = undefined;
    session.resizeDisposable = undefined;
    session.connected = false;
    session.currentDirectory = '';
    session.currentDirectoryKnown = false;
    session.previousDirectory = '';
    session.homeDirectory = '';
    port.updateStatus(connection, key, 'connecting');
    const endpoint = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
    session.term.writeln(port.tr('terminal:system.connecting', {endpoint}));
    if (!await preflight(connection, key, session, attempt) || !current(key, session, attempt)) return;
    const startup = await prepareStartup(connection, key, session, attempt);
    if (!startup || !current(key, session, attempt)) return;
    session.effectiveX11Mode = startup.x11Mode;
    const socket = port.openSocket(socketUrl(connection, key, session, startup));
    try { port.bindTransport(connection, key, session, socket, attempt); }
    catch (error) {
      try { port.closeSocket(socket); }
      catch { port.reportError('unbound-socket-close'); }
      throw error;
    }
  }

  return {connect};
}

export function installTerminalConnectionService(port:Omit<TerminalConnectionPort, 'openXServer'>) {
  if (terminalServices.termaTerminalConnection) return terminalServices.termaTerminalConnection;
  terminalServices.termaTerminalConnection = createTerminalConnectionService({
    ...port,
    openXServer: (id, key) => x11Services.termaX11.openManager(id, key)
  });
}



export interface InstalledFeaturesTerminalTerminalConnectionServiceServices {
  termaTerminalConnection?: ReturnType<typeof createTerminalConnectionService>;
}
