interface RefreshRuntime { tabKey: string; connectionId: number }
interface RefreshState { loading: boolean; mounted: boolean; disconnected: boolean }
export interface DirectoryRefreshPort {
  runtimes(): Iterable<RefreshRuntime>;
  state(key: string): RefreshState | null;
  refresh(key: string): Promise<unknown>;
  failed(error: unknown): void;
}

/** Mutation notifications coalesce per tab; disconnected tabs never reconnect in the background. */
export function createDirectoryRefreshQueue(port: DirectoryRefreshPort) {
  const pending = new Set<string>();
  let preferred = '', active = '', timer: ReturnType<typeof setTimeout> | null = null;
  function enqueue(id: number) {
    if (!Number.isSafeInteger(id) || !id) return;
    for (const runtime of port.runtimes()) {
      if (runtime.connectionId === id && !port.state(runtime.tabKey)?.disconnected) pending.add(runtime.tabKey);
    }
  }
  function flush(key = '') {
    if (key && pending.has(key)) preferred = key;
    if (!pending.size || active || timer !== null) return;
    timer = setTimeout(() => { timer = null; void run(); }, 0);
  }
  async function run() {
    if (active) return;
    const keys = preferred ? [preferred, ...[...pending].filter(key => key !== preferred)] : [...pending];
    preferred = '';
    const key = keys.find(key => {
      if (!pending.has(key)) return false;
      const state = port.state(key);
      if (!state || state.disconnected) { pending.delete(key); return false; }
      return !state.loading && state.mounted;
    });
    if (!key) return;
    pending.delete(key);
    active = key;
    try { await port.refresh(key); }
    catch (error) { port.failed(error); }
    finally { active = ''; flush(); }
  }
  function release(key: string) {
    pending.delete(key);
    if (preferred === key) preferred = '';
    if (!pending.size && timer !== null) { clearTimeout(timer); timer = null; }
  }
  return { enqueue, flush, release, pending: (key: string) => pending.has(key), get running() { return active; } };
}
