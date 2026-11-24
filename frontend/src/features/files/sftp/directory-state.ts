export interface SftpEntry {
  name: string; type: string; size: number; mtime?: number; mode?: string; owner?: string; group?: string;
  metadata_known?: boolean; is_symlink?: boolean; link_target_missing?: boolean; link_size?: number; path_bytes_b64?: string;
}
export interface SftpSelection { path: string; name?: string; type?: string; id?:number }
export interface SftpDirectoryState {
  path: string; entries: SftpEntry[]; connectionId: number; selected: SftpSelection | null;
  query: string; recursiveSearch: boolean; recursiveSearchTruncated: boolean; sort: string; dir: string;
  page: number; pageSize: number; total: number; totalPages: number; unfilteredTotal: number; loading: boolean; requestSeq: number;
  paged?:boolean;selectionAnchorPath?:string;
}
export interface SftpScrollState { scrollTop?: number; scrollLeft?: number; selectedPaths?: string[]; activePath?: string; anchorPath?: string; anchorOffset?: number }
export interface SftpDirectoryPage { path: string; entries: SftpEntry[]; page?: number; page_size?: number; total?: number; total_pages?: number; unfiltered_total?: number; recursive_search_truncated?: boolean; recursive?: boolean;truncated?:boolean;paged?:boolean;sort?:string;dir?:string }
export function joinRemotePath(base: string, name: string) {
  const raw = String(base || '.').replace(/\\/g, '/');
  const clean = raw === '/' ? '/' : raw.replace(/\/+$/, '') || '.';
  const child = String(name || '').replace(/^\/+/, '');
  return clean === '/' ? `/${child}` : clean === '.' ? child : `${clean}/${child}`;
}
export function parentRemotePath(value: string) {
  const raw = String(value || '.').replace(/\\/g, '/');
  if (raw === '/') return '/';
  const clean = raw.replace(/\/+$/, '');
  if (!clean || clean === '.') return '.';
  const index = clean.lastIndexOf('/');
  return index === 0 ? '/' : index < 0 ? '.' : clean.slice(0, index);
}
export function directoryPath(value: string) { const path = String(value || '.').replace(/\\/g, '/'); return path === '/' ? '/' : path.replace(/\/+$/, '') || '.'; }
export const directoryKey = (connectionId: number, path: string) => `${Number(connectionId)}\0${directoryPath(path)}`;
export function cloneDirectoryState(state: SftpDirectoryState): SftpDirectoryState {
  return {...state, entries:state.entries.map(entry => ({...entry})), selected:state.selected ? {...state.selected} : null, loading:false};
}
export function cloneScrollState(state: SftpScrollState | null) { return state ? {...state, selectedPaths:[...(state.selectedPaths || [])]} : null; }
export function directorySignature(state: Partial<SftpDirectoryState & SftpDirectoryPage>) {
  return JSON.stringify({path:directoryPath(state.path || '.'), query:String(state.query || ''), recursiveSearch:!!state.recursiveSearch,
    recursiveSearchTruncated:!!state.recursiveSearchTruncated, sort:state.sort || 'name', dir:state.dir || 'asc', page:state.page || 1,
    pageSize:state.pageSize || state.page_size || 50, total:state.total || 0, totalPages:state.totalPages || state.total_pages || 1,
    unfilteredTotal:state.unfilteredTotal || state.unfiltered_total || 0,
    entries:(state.entries || []).map(e=>[e.name,e.type,Number(e.size || 0),Number(e.mtime || 0),e.mode || '',e.owner || '',e.group || '',!!e.is_symlink,Number(e.link_size || 0),!!e.link_target_missing,e.metadata_known !== false])});
}
