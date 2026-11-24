import type { TaskRecord } from './sftp-task-model';
type Job = Partial<TaskRecord>;
type Settings = { delivery_mode?: string; effective_directory?: string };
type Entry = { path: string; type?: string };
type Archive = { filename?: string; encoding?: string };
type Request = { method: string; body: string };
export interface SftpDownloadPort {
  api(url: string, request: Request): Promise<Job & { jobs?: Job[] }>;
  settings(): Promise<Settings>;
  notice(settings: Settings): Promise<boolean>;
  track(job: Job): void;
  refresh(): Promise<unknown>;
  start(): void;
}
export interface SftpDownloadSelectionPort extends SftpDownloadPort {
  key: string;
  isCurrent(): boolean;
  choose(settings: Settings, count: number): Promise<unknown>;
  archive(): Promise<Archive | null>;
  clear(): void;
  notify(mode: 'separate' | 'archive', count: number, desktop: boolean): void;
}
interface DesktopSelectionPort {
  key: string;
  isCurrent(): boolean;
  send(connectionId: number, paths: string[]): Promise<unknown>;
  clear(paths: readonly string[]): void;
}

const validId = (id: number) => Number.isSafeInteger(id) && id !== 0;
const validPath = (path: string) => typeof path === 'string' && path.length > 0 && !path.includes('\0');

export function createSftpDownloadService() {
  const pending = new Set<string>();
  async function queue(port: SftpDownloadPort, connectionId: number, path: string, type = 'file') {
    if (!validId(connectionId) || !validPath(path)) return null;
    const directory = type === 'dir';
    const job = await port.api(`/api/connections/${connectionId}/sftp/${directory ? 'download-batch' : 'download'}`, {
      method: 'POST', body: JSON.stringify(directory ? { paths: [path], mode: 'archive' } : { path })
    });
    port.track(job);
    return job;
  }
  async function download(port: SftpDownloadPort, connectionId: number, path: string, type = 'file') {
    const key = `file:${connectionId}:${type}:${path}`;
    if (!validId(connectionId) || !validPath(path) || pending.has(key)) return false;
    pending.add(key);
    try {
      if (!await port.notice(await port.settings())) return false;
      await queue(port, connectionId, path, type);
      await port.refresh();
      port.start();
      return true;
    } finally { pending.delete(key); }
  }
  async function selection(port: SftpDownloadSelectionPort, connectionId: number, entries: Entry[]) {
    const key = `selection:${port.key}`;
    const snapshot = entries.map(item => ({ path: item.path, type: item.type }));
    if (!validId(connectionId) || !snapshot.length || snapshot.some(item => !validPath(item.path)) || !port.isCurrent() || pending.has(key)) return false;
    pending.add(key);
    let submitted = false;
    try {
      const settings = await port.settings();
      if (!port.isCurrent()) return false;
      const mode = await port.choose(settings, snapshot.length);
      if (!['separate', 'archive'].includes(String(mode)) || !port.isCurrent() || !await port.notice(settings) || !port.isCurrent()) return false;
      const archive = mode === 'archive' ? await port.archive() : null;
      if (!port.isCurrent() || (mode === 'archive' && !archive)) return false;
      const desktop = settings.delivery_mode === 'desktop';
      port.notify(mode as 'separate' | 'archive', snapshot.length, desktop);
      if (mode === 'separate' && !desktop) {
        for (const item of snapshot) {
          // A submitted background job outlives its source tab. Do not start new jobs for a replaced target.
          if (!port.isCurrent()) break;
          await queue(port, connectionId, item.path, item.type);
          submitted = true;
        }
      } else {
        const result = await port.api(`/api/connections/${connectionId}/sftp/download-batch`, {
          method: 'POST', body: JSON.stringify({ paths: snapshot.map(item => item.path), mode, filename: archive?.filename, encoding: archive?.encoding })
        });
        const jobs = mode === 'separate' && Array.isArray(result.jobs) ? result.jobs : [result];
        jobs.forEach(job => port.track(job));
        submitted = true;
      }
      if (submitted && port.isCurrent()) port.clear();
      return submitted;
    } finally {
      pending.delete(key);
      if (submitted) { await port.refresh(); port.start(); }
    }
  }
  async function again(port: SftpDownloadPort, original: Job) {
    const job: Job = { ...original, archive_source_paths: Array.isArray(original.archive_source_paths) ? [...original.archive_source_paths] : [] };
    const id = Number(job.connection_id), key = `again:${job.id}`;
    if (!validId(id) || job.type !== 'download' || pending.has(key)) return false;
    const paths = job.archive_source_paths as string[];
    const archive = job.archive_download && paths.length > 0;
    if (archive ? paths.some(path => typeof path !== 'string' || !validPath(path)) : !validPath(String(job.remote_path || ''))) return false;
    pending.add(key);
    try {
      if (!await port.notice(await port.settings())) return false;
      if (archive) {
        port.track(await port.api(`/api/connections/${id}/sftp/download-batch`, { method: 'POST', body: JSON.stringify({ paths, mode: 'archive', filename: job.download_name || '', encoding: job.archive_filename_encoding || 'default' }) }));
      } else await queue(port, id, String(job.remote_path), 'file');
      await port.refresh();
      port.start();
      return true;
    } finally { pending.delete(key); }
  }
  async function desktopSelection(port: DesktopSelectionPort, connectionId: number, selected: readonly string[]) {
    const paths = [...selected], key = `desktop:${port.key}`;
    if (!validId(connectionId) || !paths.length || paths.some(path => !validPath(path)) || !port.isCurrent() || pending.has(key)) return false;
    pending.add(key);
    try {
      await port.send(connectionId, paths);
      if (port.isCurrent()) port.clear(paths);
      return true;
    } finally { pending.delete(key); }
  }
  return { queue, download, selection, again, desktopSelection, isPending: (key: string) => pending.has(key) };
}
