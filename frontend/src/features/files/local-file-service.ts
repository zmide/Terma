import { BrowserFileDirectory } from './browser-directory';
import type {FileScrollPosition} from './file-scroll';
import { deliveryPathKey } from './file-delivery-refresh';
import {createFileListWindow} from './file-list-window';

export interface LocalEntry {
  name: string; path: string; type: 'file' | 'dir' | 'drive'; size: number; mtime?: number;
  free?: number; mode?: string; display_path?: string; root_kind?: string;
}
export interface FileHistory { paths: string[]; index: number }
export interface LocalFileState {
  path: string; location: string; displayPath: string; parent: string; parentKind: string;
  entries: LocalEntry[]; page: number; pageSize: number; total: number; totalPages: number;
  query: string; sort: string; dir: string; activePath: string; anchorPath: string; loaded: boolean;
  scrollTop: number; scrollAtBottom: boolean; navigation: FileHistory;
  selected: Set<string>; fileSource?: 'browser' | 'server'; browserDirectory?: BrowserFileDirectory;
  platform?: string; loading: boolean; error: string; loginRequired: boolean; status: string;
  webLoading?: boolean; webRequestedPath?: string; webHistory?: FileHistory; listRevision?: number;
}
export interface LocalListing {
  path?: string; display_path?: string; kind?: string; entries: LocalEntry[];
  parent?: string; parent_kind?: string; page?: number; page_size?: number;
  total?: number; total_pages?: number; platform?: string;
}
export interface LoadOptions { path?: string; location?: string; page?: number; refresh?: boolean; historyNavigation?: boolean; preserveScroll?: boolean;scrollPosition?:FileScrollPosition;continuous?:boolean }
export interface LocalFilePorts {
  list(source: 'native' | 'server', query: URLSearchParams, signal: AbortSignal): Promise<LocalListing>;
  changed(key: string, state: LocalFileState): void;
  committed(key: string, state: LocalFileState): void;
  text(key: string, values?: Record<string, unknown>): string;
  restore?(key:string,position:FileScrollPosition):void;
}
export const LOCAL_COMPUTER_PATH = '::computer::';
const integer = (value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(max, Number(value)) : fallback;
export class LocalFileService {
  private loads = new Map<string, AbortController>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private windows = new Map<string, ReturnType<typeof createFileListWindow<LocalEntry>>>();
  private selections = new Map<string, Map<string, LocalEntry>>();
  constructor(readonly states: Map<string, LocalFileState>, private ports: LocalFilePorts) {}
  state(key: string): LocalFileState {
    let state = this.states.get(key);
    if (!state) {
      state = { path: '', location: 'directory', displayPath: '', parent: '', parentKind: 'none', entries: [], page: 1, pageSize: 50,
        total: 0, totalPages: 1, query: '', sort: 'name', dir: 'asc', activePath: '', anchorPath: '', loaded: false,
        scrollTop: 0, scrollAtBottom: false, navigation: { paths: [], index: -1 }, selected: new Set(), loading: false, error: '', loginRequired: false, status: '' };
      this.states.set(key, state);
    }
    state.selected ||= new Set();
    return state;
  }
  current(key: string, state: LocalFileState, path = state.path) { return this.states.get(key) === state && state.path === path; }
  history(state: LocalFileState) { return state.fileSource ? state.webHistory ||= { paths: [], index: -1 } : state.navigation; }
  remember(state: LocalFileState) {
    const history = this.history(state), token = !state.fileSource && state.location === 'computer' ? LOCAL_COMPUTER_PATH : state.path;
    if (history.paths[history.index] === token) return;
    history.paths = history.paths.slice(0, history.index + 1); history.paths.push(token);
    if (history.paths.length > 80) history.paths.shift(); history.index = history.paths.length - 1;
  }
  visible(state: LocalFileState) {
    if (!state.fileSource) return state.entries;
    const entries = state.entries.filter(item => !state.query || item.name.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())).sort((a, b) => {
      const directories = Number(a.type === 'file') - Number(b.type === 'file');
      const order = state.sort === 'size' ? a.size - b.size : state.sort === 'mtime' ? Number(a.mtime || 0) - Number(b.mtime || 0) : a.name.localeCompare(b.name, undefined, { numeric: true });
      return directories || (state.dir === 'desc' ? -order : order);
    });
    state.total = entries.length; state.totalPages = Math.max(1, Math.ceil(entries.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, state.totalPages));
    return entries.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  }
  window(key: string) {
    const state = this.state(key), entries = this.visible(state);
    let window = this.windows.get(key);
    if (!window) {window = createFileListWindow<LocalEntry>(); this.windows.set(key, window);}
    window.sync(`${state.fileSource || 'native'}\0${state.path}\0${state.query}\0${state.sort}\0${state.dir}\0${state.listRevision || 0}`,
      state.page, state.pageSize, state.total, entries);
    return window;
  }
  listed(key: string) {return this.window(key).loaded();}
  selected(key: string) {
    const state = this.state(key);
    let records = this.selections.get(key);
    if (!records) {records = new Map(); this.selections.set(key, records);}
    for (const item of this.listed(key)) if (item.type !== 'drive' && state.selected.has(item.path)) records.set(item.path, item);
    for (const path of records.keys()) if (!state.selected.has(path)) records.delete(path);
    return [...records.values()];
  }
  payload(key: string) {
    const state = this.states.get(key), entries = state?.fileSource ? this.selected(key) : [];
    return { sourceTabKey: key, paths: entries.map(item => item.path), entries };
  }
  openEntry(key:string,path:string,openFile:(key:string,path:string)=>unknown){
    const state=this.states.get(key),entry=state?.fileSource?this.listed(key).find(item=>item.path===path):null;
    if(!entry)return false;
    return entry.type==='file'?openFile(key,entry.path):this.load(key,{path:entry.path,location:'directory'});
  }
  displayName(entry?:Pick<LocalEntry,'name'|'type'>){
    const raw=String(entry?.name||'');if(entry?.type!=='drive')return raw;
    const disk=raw.match(/^本地磁盘\s*\(([A-Za-z]:)\)$/);if(disk)return this.ports.text('sftp:local_files.local_disk',{drive:disk[1]});
    const system=raw.match(/^文件系统\s*(\([^)]*\))$/);return system?this.ports.text('sftp:local_files.file_system',{root:system[1]}):raw;
  }
  select(key: string, path: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; forceSingle?: boolean; toggleOnly?: boolean } = {}, checked?: boolean) {
    const state = this.state(key), entries = this.listed(key).filter(item => item.type !== 'drive');
    if (!entries.some(item => item.path === path)) return;
    const anchor = entries.findIndex(item => item.path === state.anchorPath), index = entries.findIndex(item => item.path === path);
    if (event.shiftKey && anchor >= 0) {
      if (!(event.ctrlKey || event.metaKey)) state.selected.clear();
      for (const item of entries.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) state.selected.add(item.path);
    } else if (!event.forceSingle && (checked !== undefined || event.toggleOnly || event.ctrlKey || event.metaKey || state.selected.size >= 2)) {
      if (checked ?? !state.selected.has(path)) state.selected.add(path); else state.selected.delete(path);
      state.anchorPath = path;
    } else { state.selected.clear(); state.selected.add(path); state.anchorPath = path; }
    state.activePath = state.selected.has(path) ? path : ''; this.selected(key); this.ports.changed(key, state);
  }
  selectAll(key: string, checked: boolean) {
    const state = this.state(key);
    for (const item of this.listed(key)) if (item.type !== 'drive') { if (checked) state.selected.add(item.path); else state.selected.delete(item.path); }
    state.anchorPath = this.listed(key).find(item => item.type !== 'drive')?.path || ''; this.selected(key); this.ports.changed(key, state);
  }
  clear(key: string) { const state = this.state(key); state.selected.clear(); state.activePath = ''; this.ports.changed(key, state); }
  reload(key: string, options: LoadOptions = {}) {
    const state = this.states.get(key);
    return this.load(key, state?.fileSource ? { path: options.path ?? state.path, location: 'directory' } : { ...options, refresh: true });
  }
  async load(key: string, options: LoadOptions = {}) {
    const state = this.state(key); this.loads.get(key)?.abort(); clearTimeout(this.timers.get(key));
    const controller = new AbortController(); this.loads.set(key, controller);
    const source = state.fileSource, requested = options.path ?? state.path;
    const valid = () => this.loads.get(key) === controller && this.states.get(key) === state && state.fileSource === source && !controller.signal.aborted;
    const location = options.location || (requested === LOCAL_COMPUTER_PATH ? 'computer' : state.location);
    const same = deliveryPathKey(requested) === deliveryPathKey(state.path) && location === state.location;
    state.loading = true; state.webLoading = !!source; state.webRequestedPath = requested; state.error = ''; state.loginRequired = false;
    this.ports.changed(key, state);
    try {
      let data: LocalListing;
      if (source === 'browser') {
        if (!state.browserDirectory) state.browserDirectory = new BrowserFileDirectory(key => this.ports.text(`sftp:web_files.${key}`));
        if (!state.browserDirectory.name) data = { entries: [], path: '', kind: 'directory' };
        else data = await state.browserDirectory.list(requested || '/browser');
      } else {
        const params = new URLSearchParams({ page: String(options.page || state.page || 1), page_size: String(source ? 200 : state.pageSize), query: source ? '' : state.query, sort: state.sort, dir: state.dir });
        if (!source && location === 'computer') params.set('location', 'computer'); else params.set('path', requested === LOCAL_COMPUTER_PATH ? '' : requested);
        data = await this.ports.list(source || 'native', params, controller.signal);
        if (!valid()) return;
        if (source === 'server') {
          const pages = integer(data.total_pages, 1, 51); if (pages > 50) throw new Error(this.ports.text('sftp:web_files.entry_limit'));
          for (let page = 2; page <= pages; page++) {
            params.set('page', String(page)); const next = await this.ports.list('server', params, controller.signal);
            if (!valid()) return; data.entries.push(...next.entries);
          }
        }
      }
      if (!valid()) return;
      if (!Array.isArray(data.entries) || data.entries.length > 10000 || data.entries.some(item => !item || typeof item.path !== 'string' || item.path.includes('\0') || typeof item.name !== 'string' || !['file', 'dir', 'drive'].includes(item.type))) throw new Error(this.ports.text('sftp:web_files.invalid_path'));
      Object.assign(state, { path: data.path || '', displayPath: data.kind === 'computer' && !source ? this.ports.text('sftp:local_files.this_computer') : data.display_path || data.path || '',
        entries: data.entries, parent: data.parent || '', parentKind: data.parent_kind || 'none', location: data.kind === 'computer' ? 'computer' : 'directory', platform: data.platform,
        page: source ? (options.page || (same ? state.page : 1)) : Math.max(1, integer(data.page, 1)), pageSize: source ? state.pageSize : Math.max(25, integer(data.page_size, 50, 200)),
        total: integer(data.total, data.entries.length), totalPages: Math.max(1, integer(data.total_pages, 1)), loaded: true });
      state.listRevision = (state.listRevision || 0) + (options.continuous ? 0 : 1);
      if (!same) { state.selected.clear(); this.selections.delete(key); state.activePath = ''; state.scrollTop = 0; }
      if (!options.historyNavigation) this.remember(state);
      this.ports.committed(key, state);
    } catch (error) {
      if (!valid() || (error as Error)?.name === 'AbortError') return;
      state.error = (error as Error)?.message || this.ports.text('sftp:local_files.read_failed');
      state.loginRequired = (error as { publicCode?: string })?.publicCode === 'server_files_login_required';
    } finally {
      if (valid()) { state.loading = state.webLoading = false; this.loads.delete(key); this.ports.changed(key, state); if(options.preserveScroll&&options.scrollPosition)this.ports.restore?.(key,options.scrollPosition); }
    }
  }
  historyMove(key: string, direction: number) {
    const state = this.state(key), history = this.history(state), next = history.index + direction;
    if (!Number.isInteger(next) || next < 0 || next >= history.paths.length) return;
    const prior = history.index; history.index = next; const token = history.paths[next]!;
    return this.load(key, { path: token, location: token === LOCAL_COMPUTER_PATH ? 'computer' : 'directory', page: 1, historyNavigation: true }).then(() => { if (state.error && this.states.get(key) === state && history.index === next) history.index = prior; });
  }
  search(key: string, value: string) {
    if(typeof value!=='string'||value.includes('\0'))return false;
    const state = this.state(key), source=state.fileSource, path=state.path, location=state.location; state.query = value; state.page = 1; clearTimeout(this.timers.get(key));
    this.loads.get(key)?.abort();this.loads.delete(key);state.loading=state.webLoading=false;
    if (state.fileSource) this.ports.changed(key, state);
    else this.timers.set(key, setTimeout(() => { if (this.states.get(key) === state && state.fileSource===source && state.path===path && state.location===location && state.query===value) void this.load(key, { page: 1 }); }, 180));
    return true;
  }
  clearSearch(key: string) {
    const state = this.states.get(key); if (!state) return;
    clearTimeout(this.timers.get(key)); this.timers.delete(key); state.query = '';
    return this.load(key, { page: 1 });
  }
  pageSize(key:string,value:number,position?:FileScrollPosition){if(![25,50,100,200].includes(value))return;const state=this.state(key),first=(state.page-1)*state.pageSize;state.pageSize=value;if(state.fileSource){state.page=Math.floor(first/value)+1;this.ports.changed(key,state);if(position)this.ports.restore?.(key,position);return;}return this.load(key,{page:Math.floor(first/value)+1,preserveScroll:true,scrollPosition:position});}
  sort(key:string,column:string){if(!['name','size','mtime'].includes(column))return;const state=this.state(key);state.dir=state.sort===column&&state.dir==='asc'?'desc':'asc';state.sort=column;return state.fileSource?this.ports.changed(key,state):this.load(key,{page:1});}
  page(key:string,value:number){if(!Number.isInteger(value))return;const state=this.state(key),page=Math.max(1,Math.min(state.totalPages,value));if(state.fileSource){state.page=page;this.ports.changed(key,state);return;}return this.load(key,{page});}
  async scrollPage(key: string, value: number) {
    const state = this.states.get(key);
    if (!state || !Number.isInteger(value) || value < 1 || value > state.totalPages || state.loading) return false;
    if (state.fileSource) {state.page = value; this.ports.changed(key, state); return true;}
    await this.load(key, {page: value, continuous: true});
    return this.states.get(key) === state && state.page === value && !state.error;
  }
  dispose(key: string) { this.loads.get(key)?.abort(); this.loads.delete(key); clearTimeout(this.timers.get(key)); this.timers.delete(key); this.windows.delete(key); this.selections.delete(key); this.states.delete(key); }
}
