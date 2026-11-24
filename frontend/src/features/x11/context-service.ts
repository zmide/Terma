import type {X11Port, X11Session} from './x11-types';

export interface X11ContextPort extends Pick<X11Port, 'connection'> {
  activeKey(): string;
  session(key: string): X11Session | null | undefined;
  tab(key: string): {id?: number; kind?: string} | null | undefined;
  managementConnectionId(profileId: number): number;
}

export function createX11ContextService(port: X11ContextPort) {
  function active() {
    const terminalKey = String(port.activeKey() || '');
    const connection = port.session(terminalKey)?.connection;
    if (connection) return {connectionId: Number(connection.id || 0), terminalKey};
    const tab = port.tab(terminalKey);
    if (tab?.kind === 'remote-desktop') {
      return {connectionId: Number(port.managementConnectionId(Number(tab.id || 0)) || 0), terminalKey: ''};
    }
    const connectionId = Number(tab?.id || 0);
    const sshOwned = ['terminal', 'quick-terminal', 'sftp', 'edit', 'linux-desktop'].includes(String(tab?.kind || ''));
    return {connectionId: sshOwned && port.connection(connectionId) ? connectionId : 0, terminalKey: ''};
  }

  function terminalKey(connectionId: number, preferredKey = ''): string {
    return [String(preferredKey || ''), String(port.activeKey() || '')].find(key => {
      const session = port.session(key);
      return session && !session.connection?.quick_connection && Number(session.id) === Number(connectionId);
    }) || '';
  }

  return {active, terminalKey};
}
