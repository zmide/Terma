interface CredentialTab { id: number; kind?: string; path?: string }
interface CredentialRuntime { connectionId: number; state: { path?: string } }
type RepairResult = boolean | { saved?: boolean } | null;
export interface SftpCredentialRepairPort {
  tab(key: string): CredentialTab | null;
  runtime(key: string): CredentialRuntime | null;
  prompt(id: number, options: {
    context: string;
    onSaved(): Promise<boolean>;
    onTemporary(connection: { id: number }): Promise<unknown>;
  }): Promise<RepairResult>;
  forget(id: number): Promise<unknown>;
  connect(id: number, key: string): Promise<boolean>;
  open(id: number, path: string, key: string): Promise<unknown>;
  release(id: number): void;
  tr(key: string): string;
}

export function createSftpCredentialRepair(port: SftpCredentialRepairPort) {
  async function repair(id: number, key: string, current: () => boolean = () => true): Promise<RepairResult> {
    const tab = port.tab(key), runtime = port.runtime(key);
    if (!Number.isSafeInteger(id) || id < 1 || tab?.kind !== 'sftp' || tab.id !== id) return false;
    const owns = () => current() && port.tab(key) === tab && port.runtime(key) === runtime
      && tab.kind === 'sftp' && tab.id === id && (!runtime || runtime.connectionId === id);
    if (!owns()) return false;
    let cancelled = false;
    const authorized = () => {
      if (owns()) return true;
      cancelled = true;
      return false;
    };
    const result = await port.prompt(id, {
      context: port.tr('sftp:auto.authentication_failed'),
      onSaved: async () => authorized() && port.connect(id, key),
      onTemporary: async connection => {
        if (!Number.isSafeInteger(connection.id) || connection.id >= 0) { cancelled = true; return false; }
        if (!authorized()) { port.release(connection.id); return false; }
        const path = runtime?.state.path || tab.path || '.';
        await port.forget(id).catch(() => {});
        if (!authorized()) { port.release(connection.id); return false; }
        try { return await port.open(connection.id, path, key); }
        catch (error) { port.release(connection.id); throw error; }
      },
    });
    return cancelled ? false : result;
  }
  return { repair };
}
