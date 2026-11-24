/** Generated exports live independently of any editor or workspace tab. */
export interface GeneratedFileTask {
  id: string; type: 'local-generated'; status: 'done'; filename: string; label: string;
  label_i18n_key?: string; label_i18n_params?: { name: string };
  connection_id: number; connection_name: string; source_path: string;
  phase: string; current: string; current_i18n_key: string;
  progress_unit: 'percent'; progress_known: true; size: number; transferred: number; progress: 100;
  can_cancel: false; can_pause: false; can_resume: false;
  delivery_status: 'saved' | 'browser'; saved_path: string;
  created_at: number; finished_at: number; inverted: boolean; color_mode: string;
}
export interface GeneratedFileOptions {
  label?: string; connectionId?: number; connectionName?: string; sourcePath?: string;
  size?: number; contentType?: string; deliveryStatus?: string; savedPath?: string;
  inverted?: boolean; colorMode?: string;
}
interface SavedFile { path?: string; filename?: string; size?: number; delivery_mode?: string }
export interface GeneratedFilePort {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  desktop(): boolean;
  api(url: string, request?: { method: string; headers?: Record<string, string>; body: Blob | string; rawBody?: boolean }): Promise<SavedFile>;
  tr(key: string, params?: Record<string, unknown>): string;
  download(blob: Blob, filename: string): void;
  changed(tasks: GeneratedFileTask[]): void;
  notify(message: string, kind: 'error' | 'success'): void;
  confirm(): Promise<boolean>;
}
const storageKey = 'sftpGeneratedTasksV1', limit = 80;
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const string = (value: unknown) => typeof value === 'string' && !value.includes('\0') ? value : '';
export function generatedFileParent(value: string) {
  const normalized = value.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index < 0 ? normalized : index === 2 && /^[A-Za-z]:/.test(normalized) ? normalized.slice(0, 3) : normalized.slice(0, index) || normalized;
}
export function createGeneratedFileService(port: GeneratedFilePort) {
  const blobs = new Map<string, Blob>(), pending = new Set<string>();
  let tasks: GeneratedFileTask[] = [];
  const tr = port.tr;
  function restore() {
    try {
      const records: unknown = JSON.parse(port.storage.getItem(storageKey) || '[]');
      if (!Array.isArray(records)) return;
      const seen = new Set<string>();
      tasks = records.flatMap((value: unknown) => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>, id = string(item.id);
        if (!id.startsWith('local:') || id.length > 200 || seen.has(id) || item.type !== 'local-generated' || item.status !== 'done' || item.delivery_status !== 'saved' || !string(item.saved_path)) return [];
        seen.add(id);
        const filename = string(item.filename) || 'generated.pdf', size = finite(item.size);
        return [{ id, type: 'local-generated', status: 'done', filename, label: string(item.label),
          label_i18n_key: item.label_i18n_key === 'sftp:editor.generated_task' ? item.label_i18n_key : undefined,
          label_i18n_params: { name: filename }, connection_id: Number.isSafeInteger(item.connection_id) ? Number(item.connection_id) : 0,
          connection_name: string(item.connection_name), source_path: string(item.source_path), phase: '', current: '', current_i18n_key: 'sftp:editor.generated_ready',
          progress_unit: 'percent', progress_known: true, size, transferred: size, progress: 100,
          can_cancel: false, can_pause: false, can_resume: false, delivery_status: 'saved', saved_path: string(item.saved_path),
          created_at: finite(item.created_at), finished_at: finite(item.finished_at), inverted: item.inverted === true, color_mode: string(item.color_mode) || 'original'
        } satisfies GeneratedFileTask];
      }).slice(0, limit);
    } catch { tasks = []; }
  }
  restore();
  function list() { return tasks.map(task => ({ ...task, label_i18n_params: task.label_i18n_params && { ...task.label_i18n_params } })).sort((a, b) => b.finished_at - a.finished_at); }
  function persist() { try { port.storage.setItem(storageKey, JSON.stringify(tasks.filter(task => task.delivery_status === 'saved'))); } catch { /* In-memory exports remain usable when storage is full. */ } }
  function changed() { persist(); port.changed(list()); }
  function get(id: string) { return tasks.find(task => task.id === id) || null; }
  function remove(id: string) { if (pending.has(id)) return; blobs.delete(id); tasks = tasks.filter(task => task.id !== id); changed(); }
  function clear() {
    const removed = tasks.filter(task => !pending.has(task.id));
    tasks = tasks.filter(task => pending.has(task.id));
    for (const task of removed) blobs.delete(task.id);
    changed(); return removed.length;
  }
  function add(blob: Blob, filename: string, options: GeneratedFileOptions = {}) {
    const now = Date.now(), size = finite(blob.size || options.size);
    const random = globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const task: GeneratedFileTask = { id: `local:${random}`, type: 'local-generated', status: 'done', filename,
      label: options.label || tr('sftp:editor.generated_task', { name: filename }),
      label_i18n_key: options.label ? undefined : 'sftp:editor.generated_task', label_i18n_params: { name: filename },
      connection_id: options.connectionId || 0, connection_name: options.connectionName || '', source_path: options.sourcePath || '',
      phase: '', current: '', current_i18n_key: 'sftp:editor.generated_ready', progress_unit: 'percent', progress_known: true,
      size, transferred: size, progress: 100, can_cancel: false, can_pause: false, can_resume: false,
      delivery_status: options.deliveryStatus === 'saved' ? 'saved' : 'browser', saved_path: options.savedPath || '',
      created_at: now, finished_at: now, inverted: !!options.inverted, color_mode: options.colorMode || (options.inverted ? 'invert-color' : 'original') };
    tasks.unshift(task); tasks = tasks.slice(0, limit); blobs.set(task.id, blob);
    const retained = new Set(tasks.map(item => item.id));
    for (const id of blobs.keys()) if (!retained.has(id)) blobs.delete(id);
    changed(); return task;
  }
  async function saveDesktop(blob: Blob, filename: string) {
    const result = await port.api('/api/sftp/download-settings/save-generated', { method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Terma-Generated-Filename': encodeURIComponent(filename) }, body: blob, rawBody: true });
    if (!result.path) throw new Error(tr('sftp:editor.pdf_save_failed'));
    return result;
  }
  async function save(blob: Blob, filename: string, options: GeneratedFileOptions = {}) {
    if (port.desktop()) {
      try {
        const result = await saveDesktop(blob, filename);
        return add(blob, result.filename || filename, { ...options, deliveryStatus: 'saved', savedPath: result.path, size: result.size });
      } catch (error) { port.notify(tr('sftp:editor.generated_save_fallback', { reason: error instanceof Error ? error.message : String(error) }), 'error'); }
    }
    port.download(blob, filename); return add(blob, filename, { ...options, deliveryStatus: 'browser' });
  }
  async function exclusive(id: string, operation: (task: GeneratedFileTask) => Promise<void>) {
    const task = get(id); if (!task || pending.has(id)) return;
    pending.add(id);
    try { await operation(task); }
    catch (error) { port.notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { pending.delete(id); }
  }
  async function open(id: string) {
    return exclusive(id, async task => {
      if (task.delivery_status !== 'saved') {
        const blob = blobs.get(id); if (!blob) throw new Error(tr('sftp:editor.generated_unavailable'));
        if (port.desktop()) {
          try {
            const result = await saveDesktop(blob, task.filename);
            if (get(id) !== task) return;
            Object.assign(task, { delivery_status: 'saved', saved_path: result.path, filename: result.filename || task.filename }); changed();
          } catch { port.download(blob, task.filename); return; }
        } else { port.download(blob, task.filename); return; }
      }
      await port.api('/api/local-files/open', { method: 'POST', body: JSON.stringify({ path: task.saved_path }) });
    });
  }
  async function directory(id: string) {
    return exclusive(id, async task => {
      if (!task.saved_path) throw new Error(tr('sftp:editor.generated_unavailable'));
      await port.api('/api/local-files/open', { method: 'POST', body: JSON.stringify({ path: generatedFileParent(task.saved_path) }) });
    });
  }
  async function deleteFile(id: string) {
    return exclusive(id, async task => {
      if (!await port.confirm() || get(id) !== task) return;
      if (task.delivery_status === 'saved') {
        // The protected endpoint, never a renderer-provided filesystem API, authorizes this path.
        await port.api('/api/sftp/download-settings/delete-generated', { method: 'POST', body: JSON.stringify({ path: task.saved_path }) });
      }
      if (get(id) === task) { blobs.delete(id); tasks = tasks.filter(item => item !== task); changed(); port.notify(tr('sftp:editor.generated_deleted'), 'success'); }
    });
  }
  return { list, get, add, save, open, directory, deleteFile, remove, clear, pending: (id: string) => pending.has(id) };
}


export interface InstalledFeaturesFilesSftpGeneratedFileServiceServices {
  termaGeneratedFiles: {current: () => ReturnType<typeof createGeneratedFileService>; parent: typeof generatedFileParent};
}
