import {filesServices} from '@/features/files/installed-services';
/** Renderer-only capability: handles never enter workspace storage or host requests. */
export interface BrowserEntry { name: string; path: string; type: 'dir' | 'file'; size: number; mtime: number }
export interface BrowserFileHandle {
  kind: 'file'; name: string; getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}
export interface BrowserDirectoryHandle {
  kind: 'directory'; name: string;
  queryPermission?(options: { mode: 'readwrite' }): Promise<string>;
  entries(): AsyncIterableIterator<[string, BrowserFileHandle | BrowserDirectoryHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
type Mutation = { directory?: string; name?: string; type?: string; paths?: string[]; path?: string; new_name?: string };
export type CollectedFiles = Array<{ file: File; relativePath: string }> & { directories: string[] };
const errorName = (error: unknown) => (error as { name?: string })?.name;
export class BrowserFileDirectory {
  handle: BrowserDirectoryHandle | null = null;
  files: File[] = [];
  name = '';
  writable = false;
  private revision = 0;
  constructor(private tr: (key: string) => string) {}
  async choose(mode = 'auto') {
    const revision = ++this.revision;
    if (mode !== 'readonly' && window.isSecureContext && window.showDirectoryPicker) {
      let handle: BrowserDirectoryHandle;
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' }); }
      catch (error) { if (['SecurityError', 'NotAllowedError'].includes(errorName(error) || '')) throw new Error(this.tr('folder_restricted')); throw error; }
      if (revision !== this.revision) return;
      this.handle = handle; this.name = handle.name; this.files = []; this.writable = true; return;
    }
    const files = await new Promise<File[] | null>(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.webkitdirectory = true; input.multiple = true; input.hidden = true;
      document.body.appendChild(input);
      const finish = (value: File[] | null) => { input.remove(); resolve(value); };
      input.addEventListener('change', () => finish(Array.from(input.files || [])), { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true }); input.click();
    });
    if (!files || revision !== this.revision) return;
    this.files = files; this.handle = null; this.writable = false;
    this.name = files[0]?.webkitRelativePath?.split('/')[0] || '';
  }
  parts(value: string) {
    const parts = String(value || '/browser').split('/');
    if (parts.shift() !== '' || parts.shift() !== 'browser' || parts.some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error(this.tr('invalid_path'));
    return parts;
  }
  private snapshot() {
    const handle = this.handle, files = this.files, name = this.name;
    const current = () => { if (this.handle !== handle || this.files !== files || this.name !== name) throw new DOMException('Directory changed', 'AbortError'); };
    return { handle, files, name, current };
  }
  private async resolveDirectory(handle: BrowserDirectoryHandle | null, value: string) {
    if (!handle) throw new Error(this.tr('choose_folder'));
    let directory = handle;
    for (const part of this.parts(value)) directory = await directory.getDirectoryHandle(part);
    return directory;
  }
  async directory(value: string) { return this.resolveDirectory(this.handle, value); }
  async file(value: string) {
    const scope = this.snapshot(), parts = this.parts(value), name = parts.pop();
    if (!name) throw new Error(this.tr('invalid_path'));
    if (!scope.handle) {
      const relative = [scope.name, ...parts, name].join('/'), file = scope.files.find(item => item.webkitRelativePath === relative);
      if (!file) throw new Error(this.tr('invalid_path')); return file;
    }
    const directory = await this.resolveDirectory(scope.handle, '/browser' + (parts.length ? '/' + parts.join('/') : ''));
    const file = await (await directory.getFileHandle(name)).getFile(); scope.current(); return file;
  }
  async list(value = '/browser') {
    const scope = this.snapshot(), parts = this.parts(value), entries: BrowserEntry[] = [];
    if (scope.handle) {
      const directory = await this.resolveDirectory(scope.handle, value);
      for await (const [name, item] of directory.entries()) {
        scope.current(); this.validateName(name);
        const file = item.kind === 'file' ? await item.getFile() : null;
        entries.push({ name, path: value + '/' + name, type: item.kind === 'directory' ? 'dir' : 'file', size: file?.size || 0, mtime: Math.floor((file?.lastModified || 0) / 1000) });
        if (entries.length > 10000) throw new Error(this.tr('entry_limit'));
      }
    } else {
      const prefix = [scope.name, ...parts].join('/') + '/', seen = new Set<string>();
      for (const file of scope.files) {
        if (!file.webkitRelativePath.startsWith(prefix)) continue;
        const rest = file.webkitRelativePath.slice(prefix.length), name = rest.split('/')[0];
        if (!name || seen.has(name)) continue; this.validateName(name); seen.add(name);
        entries.push({ name, path: value + '/' + name, type: rest.includes('/') ? 'dir' : 'file', size: rest.includes('/') ? 0 : file.size, mtime: Math.floor(file.lastModified / 1000) });
        if (entries.length > 10000) throw new Error(this.tr('entry_limit'));
      }
    }
    scope.current();
    return { path: value, display_path: [scope.name, ...parts].join('/'), entries, parent: parts.length ? value.slice(0, value.lastIndexOf('/')) : '', kind: 'directory' };
  }
  async writeAllowed() {
    const scope = this.snapshot();
    if (!this.writable || !scope.handle || (scope.handle.queryPermission && await scope.handle.queryPermission({ mode: 'readwrite' }) !== 'granted')) throw new Error(this.tr('readonly_hint'));
    scope.current(); return scope.handle;
  }
  validateName(value: string) {
    const name = String(value || '');
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error(this.tr('invalid_path')); return name;
  }
  receiveName(value: string, platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent) {
    let name = this.validateName(value).normalize('NFC');
    if (/win/i.test(platform)) {
      name = name.replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/g, '');
      if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
    }
    while (new TextEncoder().encode(name).length > 240) name = Array.from(name).slice(0, -1).join('');
    return name && name !== '.' && name !== '..' ? name : 'download';
  }
  numberedName(name: string, number: number) { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(0, dot) + ' (' + number + ')' + name.slice(dot) : name + ' (' + number + ')'; }
  async mutate(action: string, data: Mutation) {
    const scope = this.snapshot(), root = await this.writeAllowed(); scope.current();
    if (action === 'create') {
      const directory = await this.resolveDirectory(root, data.directory || ''), name = this.validateName(data.name || ''); scope.current();
      for (const kind of ['file', 'directory']) {
        try { if (kind === 'file') await directory.getFileHandle(name); else await directory.getDirectoryHandle(name); throw new Error(this.tr('exists')); }
        catch (error) { if (errorName(error) !== 'NotFoundError') throw error; }
      }
      scope.current();
      if (data.type === 'dir') await directory.getDirectoryHandle(name, { create: true });
      else { const writer = await (await directory.getFileHandle(name, { create: true })).createWritable(); await writer.close(); }
      return;
    }
    if (action === 'delete') {
      const paths = (data.paths || []).map(value => { const parts = this.parts(value), name = parts.pop(); if (!name) throw new Error(this.tr('invalid_path')); return { name, directory: '/browser' + (parts.length ? '/' + parts.join('/') : '') }; });
      for (const item of paths) { scope.current(); await (await this.resolveDirectory(root, item.directory)).removeEntry(item.name, { recursive: true }); }
      return;
    }
    if (action !== 'rename') throw new Error(this.tr('invalid_path'));
    const path = data.path || '', parts = this.parts(path), oldName = parts.pop(), newName = this.validateName(data.new_name || '');
    if (!oldName) throw new Error(this.tr('invalid_path')); if (oldName === newName) return;
    const file = await this.file(path), directoryPath = '/browser' + (parts.length ? '/' + parts.join('/') : ''); scope.current();
    await this.mutate('create', { directory: directoryPath, name: newName, type: 'file' });
    const directory = await this.resolveDirectory(root, directoryPath);
    try {
      scope.current(); const writer = await (await directory.getFileHandle(newName)).createWritable();
      try { await writer.write(file); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
      scope.current(); await directory.removeEntry(oldName);
    } catch (error) { await directory.removeEntry(newName).catch(() => {}); throw error; }
  }
  async write(value: string, content: FileSystemWriteChunkType) {
    const scope = this.snapshot(), root = await this.writeAllowed(), parts = this.parts(value), name = parts.pop();
    if (!name) throw new Error(this.tr('invalid_path'));
    const directory = await this.resolveDirectory(root, '/browser' + (parts.length ? '/' + parts.join('/') : '')); scope.current();
    const writer = await (await directory.getFileHandle(name)).createWritable();
    try { await writer.write(content); scope.current(); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  async collect(entries: BrowserEntry[], signal?: AbortSignal): Promise<CollectedFiles> {
    const scope = this.snapshot(), result = Object.assign([] as Array<{ file: File; relativePath: string }>, { directories: [] as string[] }); let count = 0;
    const walk = async (entry: BrowserEntry, relative: string) => {
      scope.current(); signal?.throwIfAborted(); this.validateName(entry.name);
      if (++count > 1000) throw new Error(this.tr('transfer_limit'));
      if (entry.type === 'dir') { result.directories.push(relative); for (const child of (await this.list(entry.path)).entries) await walk(child, relative + '/' + child.name); }
      else result.push({ file: await this.file(entry.path), relativePath: relative });
    };
    for (const entry of entries || []) await walk(entry, entry.name);
    scope.current(); signal?.throwIfAborted(); return result;
  }
}
export function installBrowserDirectory() { filesServices.termaBrowserFiles = { Directory: BrowserFileDirectory }; }
declare global { interface Window {
  showDirectoryPicker?: (options: { mode: 'readwrite'; startIn: 'documents' }) => Promise<BrowserDirectoryHandle>;
} }

export interface InstalledFeaturesFilesBrowserDirectoryServices {
  termaBrowserFiles?: { Directory: typeof BrowserFileDirectory };
}
