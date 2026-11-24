import type { DirectoryLoadOptions } from './directory-loader';

export type SftpConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export interface SftpSessionSnapshot { connected?: boolean; error?: string }
export interface SftpConnectOptions { tabKey?: string; force?: boolean; skipCredentialRepair?: boolean }
export interface SftpReconnectOptions { tabKey?: string; refresh?: boolean; silent?: boolean }
interface ConnectionRuntime {
  connectionId: number;
  requestController: AbortController | null;
  state: { path: string; page: number };
}
export interface SftpConnectionPort {
  active(): string;
  tab(key: string): { id: number; kind?: string; connectionStatus?: string } | null;
  keys(id: number): string[];
  ids(): number[];
  runtime(key: string): ConnectionRuntime | null;
  status(key: string): string;
  isDisconnected(key: string): boolean;
  disconnected(key: string, value: boolean): void;
  remember(key: string): void;
  changed(id: number, status: SftpConnectionStatus, error?: string): void;
  request(id: number, method: 'GET' | 'POST' | 'DELETE', signal?: AbortSignal): Promise<SftpSessionSnapshot>;
  authenticationFailure(error: unknown): boolean;
  repair(id: number, key: string, current: () => boolean): Promise<boolean | { saved?: boolean } | null>;
  load(options: DirectoryLoadOptions): Promise<unknown>;
  dispose(key: string): void;
  releaseQuick(id: number): void;
  clearCache(id: number): void;
  tr(key: string): string;
  error(message: string): void;
}
interface ConnectionRecord {
  revision: number;
  intent: number;
  observation: number;
  waiters: number;
  attempt: { promise: Promise<boolean>; controller: AbortController } | null;
  disconnecting: Promise<boolean> | null;
}
const messageOf = (error: unknown) => (error as { message?: string } | null)?.message || '';

export function createSftpConnectionService(port: SftpConnectionPort) {
  const records = new Map<number, ConnectionRecord>();
  const closing = new Set<number>();
  const validId = (id: number) => Number.isSafeInteger(id) && id !== 0;
  function recordFor(id: number) {
    let record = records.get(id);
    if (!record) {
      record = { revision: 0, intent: 0, observation: 0, waiters: 0, attempt: null, disconnecting: null };
      records.set(id, record);
    }
    return record;
  }
  const current = (id: number, record: ConnectionRecord, revision: number) => records.get(id) === record && record.revision === revision;
  function invalidate(record: ConnectionRecord) {
    record.revision++;
    record.intent++;
    record.observation++;
    record.attempt?.controller.abort();
    record.attempt = null;
  }
  function tabKey(id: number, requested = '') {
    for (const key of [requested, port.active(), ...port.keys(id)]) {
      const tab = key && port.tab(key);
      if (tab && tab.kind === 'sftp' && Number(tab.id) === id) return key;
    }
    return '';
  }
  function deleteSession(id: number, record: ConnectionRecord, reportError: boolean) {
    if (record.disconnecting) return record.disconnecting;
    const request = Promise.resolve().then(() => port.request(id, 'DELETE')).then(() => true, error => {
      if (reportError) port.error(messageOf(error) || port.tr('sftp:auto.disconnect_failed'));
      return false;
    }).finally(() => {
      if (record.disconnecting === request) record.disconnecting = null;
    });
    record.disconnecting = request;
    return request;
  }
  async function disconnect(id: number) {
    if (!validId(id)) return false;
    const record = recordFor(id);
    for (const key of port.keys(id)) {
      port.remember(key);
      port.disconnected(key, true);
      const runtime = port.runtime(key);
      runtime?.requestController?.abort();
      if (runtime) runtime.requestController = null;
    }
    invalidate(record);
    port.changed(id, 'disconnected');
    return deleteSession(id, record, true);
  }
  async function ensure(id: number, options: SftpConnectOptions = {}): Promise<boolean> {
    if (!validId(id)) return false;
    const key = tabKey(id, options.tabKey), record = recordFor(id), beforeWait = record.intent;
    // A new operation may reconnect after DELETE completes. An older waiter
    // must not reopen a session after a later explicit disconnect or close.
    if (record.disconnecting) {
      record.waiters++;
      try { await record.disconnecting; } finally { record.waiters--; }
      if (records.get(id) !== record || record.intent !== beforeWait) return false;
    }
    if (record.attempt) return record.attempt.promise;
    const manuallyDisconnected = port.keys(id).some(port.isDisconnected);
    if (!options.force && key && port.status(key) === 'connected' && !manuallyDisconnected) return true;
    const revision = ++record.revision;
    record.observation++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    port.changed(id, 'connecting');
    const request = Promise.resolve().then(async () => {
      try {
        if (!current(id, record, revision)) return false;
        await port.request(id, 'POST', controller.signal);
        if (!current(id, record, revision)) return false;
        for (const key of port.keys(id)) port.disconnected(key, false);
        port.changed(id, 'connected');
        return true;
      } catch (error) {
        if (!current(id, record, revision)) return false;
        clearTimeout(timeout);
        const message = (error as Error)?.name === 'AbortError'
          ? port.tr('sftp:auto.connection_timeout') : messageOf(error) || port.tr('sftp:auto.auto_reconnect_failed');
        port.changed(id, 'disconnected', message);
        if (id > 0 && !options.skipCredentialRepair && port.authenticationFailure(error)) {
          if (record.attempt?.promise === request) record.attempt = null;
          const intent = record.intent;
          const repairCurrent = () => records.get(id) === record && record.intent === intent;
          const repaired = await port.repair(id, key, repairCurrent);
          if (!repairCurrent()) return false;
          if (typeof repaired === 'object' && repaired?.saved) {
            return records.get(id) === record && port.status(key) === 'connected' && !port.keys(id).some(port.isDisconnected);
          }
          if (!current(id, record, revision)) return false;
          if (repaired) {
            throw Object.assign(new Error(port.tr('sftp:auto.temporary_credentials_used')), { code: 'SSH_CREDENTIAL_REPAIR_REDIRECTED' });
          }
        }
        if (!current(id, record, revision)) return false;
        throw error;
      } finally {
        clearTimeout(timeout);
        if (record.attempt?.promise === request) record.attempt = null;
      }
    });
    record.attempt = { promise: request, controller };
    return request;
  }
  async function reconnect(id: number, options: SftpReconnectOptions = {}) {
    if (!validId(id)) return false;
    const key = tabKey(id, options.tabKey), record = recordFor(id);
    invalidate(record);
    const revision = record.revision + 1;
    try {
      if (!await ensure(id, { force: true, tabKey: key })) return false;
      const runtime = port.runtime(key);
      if (options.refresh !== false && runtime && runtime.connectionId === id && port.tab(key)?.id === id) {
        await port.load({ path: runtime.state.path, page: runtime.state.page || 1, tabKey: key, refresh: true, keepContents: true, preserveView: true });
      }
      return true;
    } catch (error) {
      if ((error as { code?: string })?.code === 'SSH_CREDENTIAL_REPAIR_REDIRECTED') return true;
      if (!current(id, record, revision)) return false;
      port.changed(id, 'disconnected', messageOf(error));
      if (!options.silent) port.error(messageOf(error) || port.tr('sftp:auto.reconnect_failed'));
      return false;
    }
  }
  function toggle(id: number, requested = '') {
    const key = tabKey(id, requested), status = port.status(key);
    if (status === 'connected') return disconnect(id);
    if (status === 'connecting') return records.get(id)?.attempt?.promise || Promise.resolve(false);
    return reconnect(id, { tabKey: key });
  }
  async function refresh(requested = '') {
    const ids = requested ? [Number(port.runtime(requested)?.connectionId || port.tab(requested)?.id || 0)] : port.ids();
    for (const id of new Set(ids.filter(validId))) {
      const record = recordFor(id);
      if (record.attempt || record.disconnecting) continue;
      const revision = record.revision, observation = ++record.observation;
      const fresh = () => current(id, record, revision) && record.observation === observation && !record.attempt && !record.disconnecting;
      try {
        const result = await port.request(id, 'GET');
        if (fresh()) {
          const connected = !!result.connected && !port.keys(id).some(port.isDisconnected);
          port.changed(id, connected ? 'connected' : 'disconnected', result.error || '');
        }
      } catch (error) {
        if (fresh()) port.changed(id, 'disconnected', messageOf(error) || port.tr('sftp:auto.status_check_failed'));
      }
    }
  }
  function close(key: string) {
    const id = Number(port.runtime(key)?.connectionId || port.tab(key)?.id || 0);
    if (!validId(id)) return;
    port.dispose(key);
    if (id < 0) queueMicrotask(() => port.releaseQuick(id));
    if (closing.has(id)) return;
    closing.add(id);
    queueMicrotask(() => {
      closing.delete(id);
      if (port.keys(id).length) return;
      port.clearCache(id);
      const record = recordFor(id);
      invalidate(record);
      const revision = record.revision;
      void deleteSession(id, record, false).then(() => {
        if (current(id, record, revision) && !record.attempt && !record.waiters && !port.keys(id).length) records.delete(id);
      });
    });
  }
  return { ensure, disconnect, reconnect, toggle, refresh, close,
    pending: (id: number) => !!(records.get(id)?.attempt || records.get(id)?.disconnecting) };
}



export interface InstalledFeaturesFilesSftpConnectionServiceServices {
  termaSftpConnection: ReturnType<typeof createSftpConnectionService> & {
      keys(id: number): string[];
      paint(id: number, status?: string, error?: string): void;
    };
}
