import type { SftpDirectoryState } from './directory-state';

export interface SftpTabRuntime {
  tabKey: string;
  connectionId: number;
  state: SftpDirectoryState;
  root: HTMLElement | null;
  requestController: AbortController | null;
  searchTimer: number | null;
  resizeObserver: ResizeObserver | null;
  resizeFrame: number;
  toolbar: HTMLElement | null;
  detachedView: HTMLElement | null;
  renderedRequestSeq: number;
  vueListState: { kind: string; detail?: string } | null;
  vueStatus?: string;
  vueError?: string;
}
interface SftpTab { key: string; kind?: string; id?: number; path?: string; title?: string }
interface RuntimePort {
  runtimes: Map<string, SftpTabRuntime>;
  counts: Map<number, number>;
  tabs(): SftpTab[];
  pageSize(): number;
  connectionName(id: number): string;
  root(key: string): HTMLElement | null;
  releaseView(key: string): void;
  releaseState(key: string): void;
}
export interface RestoreRuntimeOptions { connectionId?: number; path?: string; root?: HTMLElement | null; }

/** A tab owns its directory, pending read, layout observers and detached surface. */
export function createSftpTabRuntime(port: RuntimePort) {
  function initial(id = 0, path = '.'): SftpDirectoryState {
    return { path: path || '.', entries: [], query: '', recursiveSearch: false, recursiveSearchTruncated: false,
      sort: 'name', dir: 'asc', connectionId: Number(id || 0), selected: null, page: 1,
      pageSize: [25, 50, 100, 200].includes(port.pageSize()) ? port.pageSize() : 50,
      total: 0, totalPages: 1, unfilteredTotal: 0, loading: false, requestSeq: 0 };
  }
  function index(key: string, id = 0) {
    id = Number(id || port.tabs().find(tab => tab.key === key)?.id || 0);
    if (!id) return 1;
    const prefix = `sftp-${id}-`, suffix = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    return /^\d+$/.test(suffix) ? Math.max(1, Number(suffix)) : 1;
  }
  function remember(key: string, id = 0) {
    id = Number(id || port.tabs().find(tab => tab.key === key)?.id || 0);
    const value = index(key, id);
    if (id) port.counts.set(id, Math.max(port.counts.get(id) || 0, value));
    return value;
  }
  function next(id: number) {
    let value = port.counts.get(id) || 0;
    for (const tab of port.tabs()) if (tab.kind === 'sftp' && Number(tab.id) === id) value = Math.max(value, index(tab.key, id));
    let key: string;
    do { key = `sftp-${id}-${++value}`; } while (port.tabs().some(tab => tab.key === key) || port.runtimes.has(key));
    port.counts.set(id, value);
    return key;
  }
  function displayIndex(key: string, id = 0) {
    id = Number(id || port.tabs().find(tab => tab.key === key)?.id || 0);
    if (!id) return 1;
    const siblings = port.tabs().filter(tab => tab.kind === 'sftp' && Number(tab.id) === id);
    const found = siblings.findIndex(tab => tab.key === key);
    return found >= 0 ? found + 1 : siblings.length + 1;
  }
  function titles(requested = 0) {
    const groups = new Map<number, SftpTab[]>();
    for (const tab of port.tabs()) {
      const id = Number(tab.id || 0);
      if (tab.kind !== 'sftp' || (requested && id !== requested)) continue;
      const siblings = groups.get(id) || [];
      siblings.push(tab); groups.set(id, siblings);
    }
    for (const [id, siblings] of groups) {
      const fallback = (siblings[0]?.title || '').replace(/\s*·\s*SFTP(?:\s+#\d+)?$/, '').trim();
      const base = `${port.connectionName(id) || fallback || 'SFTP'} · SFTP`;
      siblings.forEach((tab, i) => { tab.title = i ? `${base} #${i + 1}` : base; });
    }
  }
  function root(key: string, fallback: HTMLElement | null = null) {
    const runtime = port.runtimes.get(key);
    if (runtime?.root?.isConnected && runtime.root.dataset.sftpTabKey === key) return runtime.root;
    const element = port.root(key) || fallback;
    if (!element || element.dataset.sftpTabKey !== key) return null;
    if (runtime) runtime.root = element;
    return element;
  }
  function ensure(key: string, id = 0, path = '.', element: HTMLElement | null = null) {
    if (!key) return null;
    let runtime = port.runtimes.get(key);
    if (!runtime) {
      runtime = { tabKey: key, connectionId: id, state: initial(id, path), root: null, requestController: null,
        searchTimer: null, resizeObserver: null, resizeFrame: 0, toolbar: null, detachedView: null,
        renderedRequestSeq: -1, vueListState: null };
      port.runtimes.set(key, runtime);
    }
    if (id) runtime.connectionId = id;
    if (element?.dataset.sftpTabKey === key) runtime.root = element;
    remember(key, runtime.connectionId);
    return runtime;
  }
  function restore(key: string, options: RestoreRuntimeOptions = {}) {
    const tab = port.tabs().find(tab => tab.key === key);
    return ensure(key, options.connectionId || tab?.id || 0, options.path || tab?.path || '.', options.root);
  }
  function dialogContext(key: string, expectedConnection = 0) {
    const runtime = port.runtimes.get(key);
    const tab = port.tabs().find(item => item.key === key);
    if (!runtime || !tab || (expectedConnection && Number(tab.id) !== expectedConnection)) return null;
    return { runtime, tab, path: runtime.state.path || '.',
      valid: () => port.runtimes.get(key) === runtime && port.tabs().includes(tab) && Number(runtime.state.connectionId) === Number(tab.id) };
  }
  function dispose(key: string) {
    const runtime = port.runtimes.get(key);
    if (!runtime) return;
    port.releaseView(key);
    runtime.requestController?.abort();
    if (runtime.searchTimer !== null) clearTimeout(runtime.searchTimer);
    runtime.resizeObserver?.disconnect();
    if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
    runtime.detachedView = null; runtime.toolbar = null; runtime.root = null;
    port.releaseState(key); port.runtimes.delete(key);
  }
  return { initial, index, remember, next, displayIndex, titles, root, ensure, restore, dialogContext, dispose };
}

export const sftpTabRuntimes=new Map<string,SftpTabRuntime>();
