import type { CompletionJob } from './sftp-task-completion';
type Text = string | (() => string);
type Translate = (key: string, params?: Record<string, unknown>) => string;
export type SftpCopyEntry = {
  path: string; name?: string; type?: string; size?: number; mtime?: number; metadataKnown?: boolean;
  pathBytesB64?: string;
};
export type SftpClipboard = {
  mode: 'copy' | 'move'; paths: string[]; entries?: SftpCopyEntry[]; connectionId: number; connectionName: string;
};
type Response = CompletionJob & { items?: { name: string; exists?: boolean }[]; [key: string]: unknown };
type Request = { method: string; body: string };
export type SftpConflictLabels = { title?: Text; overwrite?: Text; rename?: Text };
export interface SftpConflictPort {
  api(url: string, options: Request): Promise<Response>;
  choose(title: Text, message: Text, actions: { label: Text; value: string; className?: string }[]): Promise<unknown>;
  tr: Translate;
  isCurrent?(): boolean;
}
export interface SftpCopyPort {
  key: string; connectionId: number; directory: string;
  isCurrent(): boolean;
  api(url: string, options: Request): Promise<Response>;
  conflict(entries: SftpCopyEntry[], labels: SftpConflictLabels): Promise<unknown>;
  track(job: Response): void;
  refresh(): void;
  changed(): void;
  clear(clipboard: SftpClipboard): void;
  notify(message: string, type: 'info' | 'error'): void;
  tr: Translate;
}
interface ClipboardCancelPort {
  get():SftpClipboard|null;clear():void;keys():Iterable<string>;refresh(key:string):void;
  tr:Translate;notify(message:string,kind:'info'):void;
}

// Negative IDs identify existing temporary sessions; the server owns their scope.
const validId = (id: number) => Number.isSafeInteger(id) && id !== 0;
const validPath = (path: string) => typeof path === 'string' && path.length > 0 && !path.includes('\0');
const basename = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'archive';

export function createSftpClipboard(mode: 'copy' | 'move', connectionId: number, connectionName: string, entries: SftpCopyEntry[]): SftpClipboard | null {
  if (!['copy', 'move'].includes(mode) || !validId(connectionId) || !entries.length || entries.some(item => !validPath(item.path))) return null;
  const snapshot = entries.map(item => ({ ...item }));
  return { mode, connectionId, connectionName, paths: snapshot.map(item => item.path), entries: snapshot };
}

export async function chooseSftpConflict(port: SftpConflictPort, connectionId: number, directory: string, entries: SftpCopyEntry[], labels: SftpConflictLabels = {}) {
  if (!validId(connectionId) || !validPath(directory) || port.isCurrent?.() === false) return 'cancel';
  const plan = await port.api(`/api/connections/${connectionId}/sftp/upload-plan`, {
    method: 'POST', body: JSON.stringify({ path: directory, filenames: entries.map(item => item.name || basename(item.path)) })
  });
  if (port.isCurrent?.() === false) return 'cancel';
  const conflicts = (plan.items || []).filter(item => item.exists);
  if (!conflicts.length) return 'error';
  const choice = await port.choose(labels.title || (() => port.tr('sftp:transfer.same_name_title')), () => {
    const preview = conflicts.slice(0, 6).map(item => item.name).join(port.tr('sftp:drag.item_separator'));
    return preview + (conflicts.length > 6 ? port.tr('sftp:drag.more_items', { count: conflicts.length }) : '');
  }, [
    { label: labels.overwrite || (() => port.tr('sftp:transfer.overwrite_same_name')), value: 'overwrite', className: 'danger' },
    { label: labels.rename || (() => port.tr('sftp:transfer.auto_rename')), value: 'rename', className: 'primary' },
    { label: () => port.tr('common:actions.cancel'), value: 'cancel' }
  ]);
  return port.isCurrent?.() !== false && ['overwrite', 'rename'].includes(String(choice)) ? String(choice) : 'cancel';
}

export function createSftpCopyService() {
  const pending = new Set<string>();
  const pendingKey = (port: SftpCopyPort) => port.key || `${port.connectionId}:${port.directory}`;
  const valid = (port: SftpCopyPort) => validId(port.connectionId) && validPath(port.directory) && port.isCurrent();
  const snapshot = (clipboard: SftpClipboard) => {
    if (!clipboard?.paths?.length) return null;
    const entries = clipboard.paths.map(path => ({ ...clipboard.entries?.find(item => item.path === path), path }));
    return createSftpClipboard(clipboard.mode, Number(clipboard.connectionId), clipboard.connectionName || '', entries);
  };
  async function submit(port: SftpCopyPort, source: SftpClipboard, crossCopy: boolean, labels: SftpConflictLabels, clear = false) {
    const key = pendingKey(port);
    const queued = snapshot(source);
    if (!queued || !valid(port) || pending.has(key)) return false;
    pending.add(key);
    try {
      port.changed();
      const conflict = crossCopy ? await port.conflict(queued.entries || [], labels) : 'error';
      if (!valid(port) || (crossCopy && !['error', 'overwrite', 'rename'].includes(String(conflict)))) return false;
      const url = crossCopy ? `/api/connections/${queued.connectionId}/sftp/cross-copy`
        : `/api/connections/${port.connectionId}/sftp/${queued.mode}`;
      const body = crossCopy
        ? { paths: queued.paths, entries: queued.entries || [], target_connection_id: port.connectionId, target: port.directory, conflict }
        : { paths: queued.paths, target: port.directory, background: true };
      const job = await port.api(url, { method: 'POST', body: JSON.stringify(body) });
      // Once submitted, the job remains visible even if its originating tab closes.
      port.track(job);
      if (clear) port.clear(source);
      port.refresh();
      return true;
    } catch (error) {
      port.notify(error instanceof Error ? error.message : port.tr(clear ? 'sftp:operations.paste_failed' : 'sftp:drag.copy_failed'), 'error');
      return false;
    } finally {
      pending.delete(key);
      port.changed();
    }
  }
  return {
    createClipboard: createSftpClipboard,
    cancel(port:ClipboardCancelPort){
      if(!port.get())return false;
      port.clear();for(const key of port.keys())port.refresh(key);
      port.notify(port.tr('sftp:clipboard.cancelled'),'info');return true;
    },
    chooseConflict: chooseSftpConflict,
    isPending: (key: string) => pending.has(key),
    async paste(port: SftpCopyPort, clipboard: SftpClipboard | null) {
      if (!clipboard?.paths?.length) { port.notify(port.tr('sftp:operations.clipboard_empty'), 'info'); return false; }
      const crossCopy = Number(clipboard.connectionId) !== port.connectionId;
      if (crossCopy && clipboard.mode !== 'copy') { port.notify(port.tr('sftp:clipboard.cross_copy_only'), 'error'); return false; }
      return submit(port, clipboard, crossCopy, { title: () => port.tr('sftp:operations.target_same_name') }, true);
    },
    copy(port: SftpCopyPort, sourceConnectionId: number, entries: SftpCopyEntry[], labels: SftpConflictLabels = {}) {
      const clipboard = createSftpClipboard('copy', sourceConnectionId, '', entries);
      return clipboard ? submit(port, clipboard, true, labels) : Promise.resolve(false);
    }
  };
}
