import type { TaskRecord } from './sftp-task-model';
type Job = Partial<TaskRecord>;
type FileItem = { file: File; relativePath?: string };
type UploadItem = FileItem & { relativePath: string; filename: string; directory: string };
type Request = { method: string; body?: string };
export interface SftpUploadPort {
  key: string; connectionId: number; directory: string; concurrency: number;
  isCurrent(): boolean;
  api(url: string, request: Request): Promise<Job & { items?: { exists?: boolean; name?: string; filename?: string }[] }>;
  directories(files: FileItem[], directories: string[]): Promise<void>;
  choose(collisions: { name?: string; filename?: string }[]): Promise<unknown>;
  upload(url: string, file: File, job: Job): Promise<Job>;
  track(job: Job): void;
  jobs(): Job[];
  refresh(): Promise<Job[]>;
  start(): void;
  clear(): void;
  failed(): Error;
}
const validPath = (path: string) => path.length > 0 && !path.includes('\0');
const join = (root: string, relative: string) => {
  const raw = root.replace(/\\/g, '/'), base = raw === '/' ? '/' : raw.replace(/\/+$/, '') || '.';
  return base === '/' ? `/${relative}` : base === '.' ? relative : `${base}/${relative}`;
};
export function normalizeSftpUploadPath(value: string, fallback = 'upload') {
  const parts = String(value || fallback).replace(/\\/g, '/').split('/').map(part => part.trim()).filter(part => part && part !== '.' && part !== '..');
  return parts.join('/') || fallback;
}
export function createSftpUploadService() {
  const pending = new Set<string>();
  async function submit(port: SftpUploadPort, input: FileItem[], options: { directories?: string[]; private?: boolean; conflict?: string } = {}) {
    const files = input.filter(item => item?.file).map(item => {
      const relativePath = normalizeSftpUploadPath(item.relativePath || item.file.webkitRelativePath || item.file.name, item.file.name);
      const parts = relativePath.split('/');
      const filename = parts.pop() || item.file.name;
      return { file: item.file, relativePath, filename, directory: parts.length ? join(port.directory, parts.join('/')) : port.directory } as UploadItem;
    });
    const directories = [...(options.directories || [])];
    if (!Number.isSafeInteger(port.connectionId) || port.connectionId === 0 || !validPath(port.directory) || !port.isCurrent() || (!files.length && !directories.length) ||
      files.some(item => !validPath(item.relativePath) || !Number.isFinite(item.file.size) || item.file.size < 0) || directories.some(item => item.includes('\0'))) return false;
    const key = JSON.stringify([port.key, port.connectionId, port.directory, files.map(item => [item.relativePath, item.file.size, item.file.lastModified]), directories]);
    if (pending.has(key)) return false;
    pending.add(key);
    const uploads: { item: UploadItem; started: Job }[] = [];
    let sending = false;
    const cancelCreated = () => Promise.allSettled(uploads.map(({ started }) => port.api(`/api/sftp/jobs/${encodeURIComponent(started.id || '')}/cancel`, { method: 'POST' })));
    try {
      if (!files.length) {
        await port.directories(files, directories);
        return port.isCurrent();
      }
      const groups = new Map<string, UploadItem[]>();
      for (const item of files) groups.set(item.directory, [...(groups.get(item.directory) || []), item]);
      const collisions: { name?: string; filename?: string }[] = [];
      for (const [directory, items] of groups) for (let offset = 0; offset < items.length; offset += 200) {
        if (!port.isCurrent()) return false;
        const plan = await port.api(`/api/connections/${port.connectionId}/sftp/upload-plan`, { method: 'POST', body: JSON.stringify({ path: directory, filenames: items.slice(offset, offset + 200).map(item => item.filename) }) });
        for (const item of plan.items || []) if (item.exists) collisions.push(item);
      }
      if (!port.isCurrent()) return false;
      const conflict = options.conflict || await port.choose(collisions);
      if (!port.isCurrent() || !['error', 'overwrite', 'rename'].includes(String(conflict))) return false;
      await port.directories(files, directories);
      if (!port.isCurrent()) return false;
      for (const item of files) {
        if (!port.isCurrent()) { await cancelCreated(); return false; }
        const started = await port.api(`/api/connections/${port.connectionId}/sftp/upload-job`, { method: 'POST', body: JSON.stringify({ path: item.directory, filename: item.filename, conflict, size: item.file.size, private: options.private === true }) });
        if (!started.id) throw port.failed();
        uploads.push({ item, started });
        port.track(started);
      }
      if (!port.isCurrent()) { await cancelCreated(); return false; }
      await port.refresh();
      if (!port.isCurrent()) { await cancelCreated(); return false; }
      port.start();
      sending = true;
      let next = 0;
      const errors: unknown[] = [];
      const limit = Number.isFinite(port.concurrency) ? Math.max(1, Math.min(8, Math.floor(port.concurrency))) : 3;
      await Promise.all(Array.from({ length: Math.min(limit, uploads.length) }, async () => {
        while (next < uploads.length) {
          const { item, started } = uploads[next++];
          try {
            const current = port.jobs().find(job => String(job.id) === String(started.id));
            if (current?.status === 'cancelled' || current?.phase === 'cancelling') continue;
            const result = await port.upload(`/api/sftp/jobs/${encodeURIComponent(started.id || '')}/content`, item.file, started);
            port.track(result);
          } catch (error) {
            const latest = await port.refresh().catch(() => port.jobs());
            if ((error as { cancelled?: boolean })?.cancelled || latest.find(job => String(job.id) === String(started.id))?.status === 'cancelled') continue;
            errors.push(error);
          }
        }
      }));
      if (errors.length) throw errors[0];
      return true;
    } catch (error) {
      if (!sending) await cancelCreated();
      throw error;
    } finally {
      pending.delete(key);
      port.clear();
      await port.refresh();
    }
  }
  return { submit };
}

export function sendSftpUpload(port: { createXhr(): XMLHttpRequest; requests: Map<string, { xhr: XMLHttpRequest; cancelled: boolean }>; progress(loaded: number, total: number): void; cancelled(): Error; failed(): Error; timeout(): Error }, url: string, body: File, job: Job): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = port.createXhr();
    const id = String(job.id || '');
    const request = { xhr, cancelled: false };
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (port.requests.get(id) === request) port.requests.delete(id);
      callback();
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    port.requests.set(id, request);
    xhr.upload.onprogress = event => { if (event.lengthComputable) port.progress(event.loaded, event.total); };
    xhr.onload = () => {
      let data: Job;
      try { data = JSON.parse(xhr.responseText || '{}'); }
      catch { return finish(() => reject(port.failed())); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return finish(() => reject(port.failed()));
      if (xhr.status >= 200 && xhr.status < 300) return finish(() => resolve(data));
      finish(() => reject(data.status === 'cancelled' ? port.cancelled() : new Error(typeof data.error === 'string' ? data.error : xhr.statusText || port.failed().message)));
    };
    xhr.onerror = () => finish(() => reject(request.cancelled ? port.cancelled() : port.failed()));
    xhr.onabort = () => finish(() => reject(port.cancelled()));
    xhr.ontimeout = () => finish(() => reject(port.timeout()));
    try { xhr.send(body); } catch (error) { finish(() => reject(error)); }
  });
}
/** Receiving is the first half of a two-stage upload; late browser events cannot regress remote or terminal states. */
export function updateSftpUploadReceiveProgress(jobs: Job[], id: string, loaded: number, total: number) {
  const existing = id ? jobs.find(job => String(job.id) === id) : null;
  if (!existing || existing.status !== 'running' || existing.phase !== 'receiving') return false;
  const size = Number(total || existing.size || 0), received = Number(loaded || 0);
  existing.size = Number.isFinite(size) ? Math.max(0, size) : 0;
  existing.transferred = Number.isFinite(received) ? Math.max(0, received) : 0;
  existing.received_bytes = existing.transferred;
  existing.size_known = true;
  existing.progress_known = true;
  existing.two_stage_upload = true;
  existing.progress = existing.size ? Math.min(50, Math.round(Number(existing.transferred) / Number(existing.size) * 50)) : 50;
  return true;
}
export function abortSftpUpload(requests: Map<string, { cancelled?: boolean; xhr?: { abort(): void } }>, id: string) {
  const request = requests.get(id); if (!request) return false;
  request.cancelled = true; try { request.xhr?.abort(); } catch {}
  return true;
}
