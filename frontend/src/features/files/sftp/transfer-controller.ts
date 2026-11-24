import type { TaskRecord } from './sftp-task-model';
import type { SftpDownloadPort, SftpDownloadSelectionPort, createSftpDownloadService } from './sftp-download-service';
import type { SftpUploadPort, createSftpUploadService } from './sftp-upload-service';

type Job = Partial<TaskRecord>;
type Entry = { path: string; name?: string; type?: string; [key: string]: unknown };
type Text = string | (() => string);
type Files = Parameters<ReturnType<typeof createSftpUploadService>['submit']>[1];
type Options = NonNullable<Parameters<ReturnType<typeof createSftpUploadService>['submit']>[2]> & { tabKey?: string; isCurrent?: () => boolean };
export interface SftpUploadInput { files: FileList | readonly File[] | null; value: string; click(): void }
interface Context { key: string; id: number; directory: string; valid(): boolean }
interface TransferPort {
  context(key: string): Context | null;
  target(key: string, id: number, directory: string): () => boolean;
  selected(key: string): Entry[]; paths(key: string): string[]; clear(key: string): void; input(key: string): SftpUploadInput | null;
  downloadPort(): SftpDownloadPort;
  readSettings: SftpDownloadPort['settings'];
  downloads: Pick<ReturnType<typeof createSftpDownloadService>, 'download' | 'selection' | 'again' | 'desktopSelection'>;
  uploads: Pick<ReturnType<typeof createSftpUploadService>, 'submit'>;
  uploadPort(): Omit<SftpUploadPort, 'key' | 'connectionId' | 'directory' | 'concurrency' | 'isCurrent' | 'directories' | 'clear'>;
  concurrency(): number;
  directories(id: number, path: string, files: Files, directories: string[], valid: () => boolean): Promise<void>;
  refreshDirectory(key: string): unknown;
  choose(title: Text, message: Text, actions: { label: Text; value: string; className?: string }[]): Promise<unknown>;
  archive(options: { mode: string; tabKey: string; connectionId: number; titleKey: string; title: string; filename: string }): Promise<{ filename?: string; encoding?: string } | null>;
  archiveName(entries: Entry[]): string; desktopSend(): ((id: number, paths: string[]) => Promise<unknown>) | undefined;
  jobs(): Job[]; track(job: Job): void; pendingDownloads: Set<string>;
  begin(key: string, button: HTMLElement | null, text: Text): boolean; end(key: string, button: HTMLElement | null): void;
  tr(key: string, values?: Record<string, unknown>): string; notify(message: string, kind: string): void;
}
const pathsEqual = (a: readonly Entry[], b: readonly Entry[]) => a.length === b.length && a.every((item, index) => item.path === b[index]?.path);
const sameFiles = (input: SftpUploadInput, files: readonly File[]) => input.files?.length === files.length && Array.from(input.files || []).every((file, index) => file === files[index]);
export function createSftpTransferController(port: TransferPort) {
  const pickers = new WeakMap<SftpUploadInput, { key: string; context: Context }>();
  const fail = (error: unknown, key: string) => { port.notify(error instanceof Error ? error.message : port.tr(key), 'error'); return false; };
  const settings = () => port.readSettings().catch(() => ({ delivery_mode: 'browser' }));
  async function download(id: number, path: string, type = 'file') {
    try { return await port.downloads.download(port.downloadPort(), id, path, type); }
    catch (error) { return fail(error, 'sftp:transfer.download_failed'); }
  }
  async function again(id: string, button: HTMLElement | null = null) {
    const job = port.jobs().find(item => String(item.id) === id);
    if (!job || job.type !== 'download') { port.notify(port.tr('sftp:transfer.download_job_missing'), 'error'); return false; }
    const key = `sftp-task:download-again:${id}`;
    if (!port.begin(key, button, () => port.tr('sftp:transfer.preparing'))) return false;
    try { return await port.downloads.again(port.downloadPort(), job); }
    catch (error) { return fail(error, 'sftp:transfer.redownload_failed'); }
    finally { port.end(key, button); }
  }
  async function selection(key: string) {
    const context = port.context(key), entries = port.selected(key).map(item => ({ ...item }));
    if (!context || !entries.length) { port.notify(port.tr('sftp:transfer.select_download_items'), 'info'); return false; }
    const selectionPort: SftpDownloadSelectionPort = { ...port.downloadPort(), key, isCurrent: context.valid,
      choose: (settings, count) => port.choose(() => port.tr('sftp:transfer.batch_download_title'),
        () => port.tr(settings.delivery_mode !== 'desktop' ? 'sftp:transfer.batch_download_browser' : 'sftp:transfer.batch_download_desktop', { count }), [
          { label: () => port.tr('sftp:transfer.download_separately'), value: 'separate', className: 'primary' },
          { label: () => port.tr('sftp:transfer.download_archive'), value: 'archive' }, { label: () => port.tr('common:actions.cancel'), value: '' }
        ]),
      archive: () => port.archive({ mode: 'download', tabKey: key, connectionId: context.id, titleKey: 'sftp:transfer.batch_download_title', title: port.tr('sftp:transfer.batch_download_title'), filename: port.archiveName(entries) }),
      clear: () => { if (context.valid() && pathsEqual(port.selected(key), entries)) port.clear(key); },
      notify: mode => port.notify(port.tr(mode === 'separate' ? 'sftp:transfer.downloading_selected' : 'sftp:transfer.creating_archive'), 'info')
    };
    try { return await port.downloads.selection(selectionPort, context.id, entries); }
    catch (error) { return fail(error, 'sftp:transfer.batch_download_failed'); }
  }
  async function desktop(key: string) {
    const context = port.context(key), send = port.desktopSend(), paths = [...port.paths(key)];
    if (!context || !send || !paths.length) return false;
    try { return await port.downloads.desktopSelection({ key, isCurrent: context.valid, send,
      clear: snapshot => { if (context.valid() && pathsEqual(port.paths(key).map(path => ({ path })), snapshot.map(path => ({ path })))) port.clear(key); }
    }, context.id, paths); }
    catch (error) { return fail(error, 'sftp:transfer.send_desktop_failed'); }
  }
  async function submit(inputFiles: (File | Files[number])[], id: number, root = '.', options: Options = {}) {
    if (!Array.isArray(inputFiles)) return false;
    const key = String(options.tabKey || ''), directory = String(root || '.'), input = port.input(key), selected = Array.from(input?.files || []);
    const current = options.isCurrent || port.target(key, id, directory);
    const files = inputFiles.filter(Boolean).map(item => 'file' in item ? { ...item } : { file: item, relativePath: item.webkitRelativePath || item.name });
    return port.uploads.submit({ ...port.uploadPort(), key, connectionId: id, directory, concurrency: port.concurrency(), isCurrent: current,
      directories: async (items, directories) => { await port.directories(id, directory, items, directories, current); if (!items.length && current()) await port.refreshDirectory(key); },
      clear: () => { if (input && selected.length && port.input(key) === input && sameFiles(input, selected)) input.value = ''; }
    }, files, options);
  }
  function pick(key: string, input = port.input(key)) {
    const context = port.context(key);
    if (!input || !context?.valid() || port.input(key) !== input || pickers.has(input)) return false;
    pickers.set(input, { key, context });
    try { input.value = ''; input.click(); return true; }
    catch (error) { pickers.delete(input); return fail(error, 'sftp:transfer.upload_failed'); }
  }
  function cancelPicker(key: string, input = port.input(key)) { if (input && pickers.get(input)?.key === key) pickers.delete(input); }
  async function uploadFiles(files: (File | Files[number])[], key: string) {
    const context = port.context(key); if (!context?.valid()) return false;
    return submit(files, context.id, context.directory, { tabKey: key, isCurrent: context.valid });
  }
  async function uploadInput(key: string, input = port.input(key)) {
    if (!input) return false;
    const captured = pickers.get(input); pickers.delete(input);
    const files = Array.from(input.files || []); if (!files.length) return false;
    const context = captured?.context || port.context(key);
    if ((captured && captured.key !== key) || !context?.valid() || port.input(key) !== input) {
      if (port.input(key) === input && sameFiles(input, files)) input.value = '';
      port.notify(port.tr('sftp:transfer.upload_target_changed'), 'info'); return false;
    }
    try { return await submit(files, context.id, context.directory, { tabKey: key, isCurrent: context.valid }); }
    catch (error) { return fail(error, 'sftp:transfer.upload_failed'); }
  }
  function track(job: Job) { port.track(job); if (job?.delivery_mode === 'browser' && job.id) port.pendingDownloads.add(job.id); return job; }
  return { settings, download, again, selection, desktop, submit, uploadFiles, uploadInput, pick, cancelPicker, track };
}
