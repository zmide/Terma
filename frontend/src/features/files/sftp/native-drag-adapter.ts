import { nativeDragKey, normalizeDragEntry, type DragEntry } from './drag-payload';

type Mode = 'staged' | 'streaming';
interface Target { id: number; tabKey: string; path: string; title: string; kind: 'sftp' | 'terminal' | 'local-files' }
interface Bridge {
  capabilities?: { platform?: unknown; sftpExternalDrag?: unknown; sftpNativeDragStart?: unknown;
    sftpNativeDragReason?: unknown; sftpNativeDragReasonCode?: unknown };
  startSftpDrag?(payload: unknown, requestId: string): void;
  activateSftpDrag?(requestId: string): void;
  cancelSftpDrag?(requestId: string): void;
  setSftpDragTarget?(requestId: string, target: Target | null, options: { final: boolean }): void;
}
interface Staged { files: string[]; createdAt: number; promise: Promise<Staged> | null }
interface Ports {
  bridge(): Bridge | undefined;
  stage(connectionId: number, paths: string[]): Promise<{ files?: unknown }>;
  cache: Map<string, Staged>;
  armed: Set<string>;
  ttl: number;
  now?(): number;
}
export function nativeDragSnapshot(connectionId: number, entries: unknown[]) {
  if (!Number.isSafeInteger(connectionId) || connectionId === 0 || !Array.isArray(entries) || !entries.length || entries.length > 10000) throw new Error('Invalid drag source');
  const normalized = entries.map(item => normalizeDragEntry(item));
  if (normalized.some(item => !item)) throw new Error('Invalid drag path');
  return { connectionId, entries: normalized as DragEntry[] };
}
export function nativeDragTarget(value: Record<string, unknown> | null): Target | null {
  if (!value) return null;
  const id = Number(value.id), tabKey = String(value.key || value.tabKey || ''), path = String(value.path || '.');
  if (!Number.isSafeInteger(id) || id === 0 || !tabKey || tabKey.includes('\0') || path.includes('\0')) return null;
  if (!['sftp', 'terminal', 'local-files'].includes(String(value.kind))) return null;
  return { id, tabKey, path, title: String(value.title || 'SFTP'), kind: value.kind as Target['kind'] };
}

type Text = (key: string, values?: Record<string, string>) => string;
const linuxFallbackReasons = [
  ['/dev/fuse is unavailable', 'dev_fuse_unavailable', 'dev_fuse_install_action'],
  ['cannot access /dev/fuse', 'dev_fuse_denied', 'dev_fuse_permission_action'],
  ['fusermount3 is unavailable', 'fusermount_missing', 'fusermount_install_action'],
  ['runtime directory cannot be prepared', 'runtime_directory_unwritable', 'runtime_directory_action']
] as const;
export function createNativeDragPresentation(port: {
  bridge(): Bridge | undefined; mode(): Mode | false; text: Text; notify(message: string): void;
}) {
  let shown = false;
  const text = (key: string) => port.text(`sftp:drag.${key}`);
  function fallback() {
    const capabilities = port.bridge()?.capabilities;
    if (capabilities?.platform !== 'linux' || capabilities.sftpExternalDrag !== 'staged') return null;
    const reason = String(capabilities.sftpNativeDragReason || '').trim();
    const code = String(capabilities.sftpNativeDragReasonCode || '').trim().toLowerCase();
    const normalized = reason.toLowerCase();
    const match = linuxFallbackReasons.find(([phrase]) => normalized.includes(phrase));
    if (match) return { reason: text(match[1]), action: text(match[2]) };
    if (code === 'linux_helper_missing') return { reason: text('helper_missing'), action: text('helper_reinstall_action') };
    return { reason: reason || text('fuse_missing'), action: text('fuse_check_action') };
  }
  function reportFallback() {
    const details = fallback();
    if (!details || shown) return;
    shown = true;
    port.notify(port.text('sftp:drag.linux_fallback_notice', details));
  }
  function sourceHint() {
    const mode = port.mode();
    return text(fallback() ? 'linux_compat_hint' : mode === 'streaming' ? 'streaming_hint' : mode === 'staged' ? 'staged_hint' : 'web_hint');
  }
  return { reportFallback, sourceHint };
}

export async function stageNativeDrag(adapter: ReturnType<typeof createNativeDragAdapter>, id: number, entries: DragEntry[], text: Text) {
  try { return await adapter.stage(id, entries); }
  catch (error) {
    if (error instanceof Error && /^Invalid (?:staged files|drag source|drag path)$/.test(error.message)) {
      throw new Error(text('sftp:drag.no_files'));
    }
    throw error;
  }
}

export function createNativeDragAdapter(port: Ports) {
  const now = () => port.now?.() ?? Date.now();
  const mode = (): Mode | false => {
    const bridge = port.bridge(), value = bridge?.capabilities?.sftpExternalDrag;
    return (value === 'staged' || value === 'streaming') && typeof bridge?.startSftpDrag === 'function' ? value : false;
  };
  const cleanup = (at = now()) => {
    for (const [key, item] of port.cache) if (!item.promise && at - item.createdAt > port.ttl) { port.cache.delete(key); port.armed.delete(key); }
  };
  const cached = (id: number, entries: DragEntry[]) => {
    cleanup();
    const item = port.cache.get(nativeDragKey(id, entries));
    return item?.files.length && now() - item.createdAt <= port.ttl ? item : null;
  };
  const stage = (id: number, entries: DragEntry[]): Promise<Staged> => {
    const snapshot = nativeDragSnapshot(id, entries), key = nativeDragKey(id, snapshot.entries);
    cleanup();
    const ready = cached(id, snapshot.entries);
    if (ready) return Promise.resolve(ready);
    const pending = port.cache.get(key)?.promise;
    if (pending) return pending;
    const item: Staged = { files: [], createdAt: 0, promise: null };
    item.promise = Promise.resolve().then(() => port.stage(id, snapshot.entries.map(entry => entry.path))).then(result => {
      if (!Array.isArray(result.files) || !result.files.length || result.files.some(file => typeof file !== 'string' || !file || file.includes('\0'))) throw new Error('Invalid staged files');
      const ready: Staged = { files: [...result.files], createdAt: now(), promise: null };
      // Clearing the cache during a request must not repopulate it with a late result.
      if (port.cache.get(key) === item) port.cache.set(key, ready);
      return ready;
    }).catch(error => { if (port.cache.get(key) === item) port.cache.delete(key); throw error; });
    port.cache.set(key, item);
    return item.promise;
  };
  const start = (requested: Mode, id: number, entries: DragEntry[], files: string[], sourceTabKey: string, requestId: string) => {
    const bridge = port.bridge();
    if (mode() !== requested || !bridge?.startSftpDrag || !requestId) throw new Error('Native drag unavailable');
    const snapshot = nativeDragSnapshot(id, entries);
    if (requested === 'staged' && (!files.length || files.some(file => typeof file !== 'string' || !file || file.includes('\0')))) throw new Error('Invalid staged files');
    bridge.startSftpDrag(requested === 'streaming' ? { ...snapshot, sourceTabKey } : [...files], requestId);
  };
  return { mode, cleanup, cached, stage, start,
    timing: () => port.bridge()?.capabilities?.sftpNativeDragStart === 'pointerdown' ? 'pointerdown' : 'leave-window',
    activate: (id: string) => port.bridge()?.activateSftpDrag?.(id),
    cancel: (id: string) => port.bridge()?.cancelSftpDrag?.(id),
    target: (id: string, value: Record<string, unknown> | null, final: boolean) => port.bridge()?.setSftpDragTarget?.(id, nativeDragTarget(value), { final })
  };
}
