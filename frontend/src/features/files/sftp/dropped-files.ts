import {filesServices} from '@/features/files/installed-services';
export interface DroppedFile { file: File; relativePath: string }
interface DropEntry { name: string; isFile?: boolean; isDirectory?: boolean; file?(resolve: (file: File) => void, reject: (error: Error) => void): void; createReader?(): { readEntries(resolve: (entries: DropEntry[]) => void, reject: (error: Error) => void): void } }
interface DropTransfer { items?: ArrayLike<{ kind?: string; webkitGetAsEntry?(): DropEntry | null; getAsFile?(): File | null }>; files?: ArrayLike<File> }
export function normalizeDroppedPath(value: string, fallback = 'upload') {
  const path = String(value || fallback).replace(/\\/g, '/');
  const parts = path.split('/').filter(part => part && part !== '.');
  if (!parts.length && !fallback && !path) return '';
  if (!parts.length || parts.some(part => part === '..' || part.includes('\0')) || path.startsWith('/') || /^[a-z]:/i.test(path)) throw new Error('invalid_upload_path');
  return parts.join('/');
}
export async function collectDroppedFiles(transfer: DropTransfer, signal?: AbortSignal): Promise<DroppedFile[]> {
  const output: DroppedFile[] = [], visited = new Set<DropEntry>(); let count = 0;
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); if (++count > 20000) throw new Error('upload_entry_limit'); };
  const read = <T>(operation: (resolve: (value: T) => void, reject: (error: Error) => void) => void) => new Promise<T>((resolve, reject) => {
    const abort = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    const finish = (done: () => void) => { signal?.removeEventListener('abort', abort); done(); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    try { operation(value => finish(() => resolve(value)), error => finish(() => reject(error))); }
    catch (error) { finish(() => reject(error)); }
  });
  const visit = async (entry: DropEntry, prefix = '', depth = 0): Promise<void> => {
    check(); if (depth > 64 || visited.has(entry)) throw new Error('invalid_upload_directory'); visited.add(entry);
    if (entry.isFile && entry.file) {
      const file = await read<File>((resolve, reject) => entry.file!(resolve, reject));
      check(); output.push({ file, relativePath: normalizeDroppedPath(prefix + file.name, file.name) });
    } else if (entry.isDirectory && entry.createReader) {
      const path = normalizeDroppedPath(prefix + entry.name) + '/', reader = entry.createReader();
      while (true) {
        check(); const batch = await read<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, path, depth + 1);
      }
    }
  };
  const items = Array.from(transfer?.items || []);
  // Chromium only grants entry access during the drop callback; snapshot before awaiting.
  const sources = items.filter(item => !item.kind || item.kind === 'file').map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() }));
  if (sources.some(source => source.entry || source.file)) for (const source of sources) {
    if (source.entry) await visit(source.entry);
    else if (source.file) { check(); output.push({ file: source.file, relativePath: normalizeDroppedPath(source.file.webkitRelativePath || source.file.name, source.file.name) }); }
  }
  else for (const file of Array.from(transfer?.files || [])) { check(); output.push({ file, relativePath: normalizeDroppedPath(file.webkitRelativePath || file.name, file.name) }); }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return output;
}
export function installDroppedFiles() { filesServices.termaDroppedFiles = { collectDroppedFiles, normalizeDroppedPath }; }


export interface InstalledFeaturesFilesSftpDroppedFilesServices {
  termaDroppedFiles: { collectDroppedFiles: typeof collectDroppedFiles; normalizeDroppedPath: typeof normalizeDroppedPath }
}
