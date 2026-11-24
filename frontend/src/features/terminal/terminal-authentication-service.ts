export type TerminalAuthenticationConnection = {
  id?: number;
  quick_connection?: unknown;
  quick_token?: string;
  ssh_user?: string;
  ssh_host?: string;
  ssh_port?: number;
  auth_type?: string;
  [key: string]: unknown;
};

export type TerminalAuthenticationSession = {
  quickToken?: string;
  connection?: TerminalAuthenticationConnection;
  authenticationFailureWindow?: string;
  [key: string]: unknown;
};

export interface TerminalAuthenticationPort {
  tr(key: string, params?: Record<string, unknown>): string;
  authenticationFailure?(value: string): boolean;
  isQuickAuthOpen?(): boolean;
  api?(url: string, options: Record<string, unknown>): Promise<unknown>;
  startQuickSshConnection?(target: {user?: string; host?: string; port?: number}, options: Record<string, unknown>): Promise<unknown> | unknown;
  repairSshCredentials?(id: number, options: {
    context: string;
    onSaved(saved: TerminalAuthenticationConnection): Promise<void>;
    onTemporary(connection: TerminalAuthenticationConnection, token: string): Promise<void>;
  }): Promise<unknown> | unknown;
  reconnectTerminal?(id: number, key: string): unknown;
  resumeQuickTerminalWithTicket?(key: string, connection: TerminalAuthenticationConnection, token: string): unknown;
}

function textFromChunk(value: unknown) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(value)); }
    catch { return ''; }
  }
  return '';
}

export function createTerminalAuthenticationService(port: TerminalAuthenticationPort) {
  function authenticationFailureChunk(session: TerminalAuthenticationSession, value: unknown) {
    if (!port.authenticationFailure) return false;
    session.authenticationFailureWindow = `${session.authenticationFailureWindow || ''}${textFromChunk(value)}`.slice(-1200);
    return port.authenticationFailure(session.authenticationFailureWindow);
  }

  async function repair(connection: TerminalAuthenticationConnection, key: string,
    session: TerminalAuthenticationSession | null | undefined,
    currentSession: () => TerminalAuthenticationSession | null | undefined) {
    if (!session || currentSession() !== session) return false;
    if (connection.quick_connection) {
      if (port.isQuickAuthOpen?.()) return false;
      const staleToken = String(session.quickToken || connection.quick_token || '');
      session.quickToken = '';
      connection.quick_token = '';
      if (staleToken && port.api) {
        void port.api('/api/terminal/quick-tickets', {
          method: 'DELETE',
          body: JSON.stringify({ token: staleToken }),
          skipSftpConnect: true,
          skipHostTrustPrompt: true
        }).catch(() => {});
      }
      if (!port.startQuickSshConnection) return false;
      return await port.startQuickSshConnection({
        user: connection.ssh_user,
        host: connection.ssh_host,
        port: connection.ssh_port
      }, {
        reconnectKey: key,
        authType: connection.auth_type,
        repair: true
      });
    }
    const id = Number(connection.id);
    if (!Number.isSafeInteger(id) || id < 1 || !port.repairSshCredentials) return false;
    return await port.repairSshCredentials(id, {
      context: port.tr('terminal:authentication.context', { defaultValue: '终端认证失败' }),
      onSaved: async savedConnection => {
        const activeSession = currentSession();
        const savedId = Number(savedConnection.id);
        if (activeSession !== session || !Number.isSafeInteger(savedId) || savedId < 1) return;
        activeSession.connection = savedConnection;
        activeSession.id = savedId;
        port.reconnectTerminal?.(savedId, key);
      },
      onTemporary: async (temporaryConnection, token) => {
        if (currentSession() !== session || !port.resumeQuickTerminalWithTicket) return;
        port.resumeQuickTerminalWithTicket(key, temporaryConnection, token);
      }
    });
  }

  return { authenticationFailureChunk, repair };
}


