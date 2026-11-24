import type { SftpDialogText, SftpRecycleItem, SftpRecycleOptions, SftpRecyclePage } from './sftp-dialog-types';

interface RecycleContext { key: string; connectionId: number; valid(): boolean }
interface RecyclePort {
  context(key: string): RecycleContext | null;
  api(url: string, options?: {method: string; body: string}): Promise<unknown>;
  show(options: SftpRecycleOptions): void;
  close(): void;
  text: SftpDialogText;
  notify(message: string): void;
  refresh(connectionId: number): void;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const positive = (value: unknown, fallback = 1) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const storage = (item: SftpRecycleItem) => item.storage === 'tunneldesk' ? 'tunneldesk' : 'terma';

/** Each dialog keeps its originating connection and invalidates all callbacks on disposal. */
export function createSftpRecycleService(port: RecyclePort) {
  let current: {context: RecycleContext; closed: boolean} | null = null;
  function open(key: string) {
    const context = port.context(key);
    if (!context?.valid() || !Number.isSafeInteger(context.connectionId) || !context.connectionId) return;
    if (current) current.closed = true;
    const session = {context, closed: false}; current = session;
    const valid = () => current === session && !session.closed && context.valid();
    const requireValid = () => { if (!valid()) throw new DOMException('Recycle dialog closed', 'AbortError'); };
    const endpoint = `/api/connections/${context.connectionId}/sftp/trash`;
    let revision = 0;
    let items: SftpRecycleItem[] = [];
    const itemBody = (item: SftpRecycleItem) => {
      requireValid();
      if (!items.includes(item)) throw new DOMException('Recycle item expired', 'AbortError');
      return JSON.stringify({id: item.id, storage: storage(item)});
    };
    port.show({tr: port.text, page: 1, valid,
      dispose() { session.closed = true; items = []; if (current === session) current = null; },
      async load(page) {
        requireValid(); const token = ++revision, target = positive(page);
        const data = record(await port.api(`${endpoint}?page=${target}&page_size=50`));
        requireValid();
        const normalized: SftpRecycleItem[] = Array.isArray(data.items) ? data.items.flatMap(value => {
          const item = record(value);
          if (typeof item.id !== 'string' || !item.id || /[\0\r\n]/.test(item.id) || typeof item.original_path !== 'string') return [];
          return [{id: item.id, original_path: item.original_path, name: typeof item.name === 'string' ? item.name : undefined,
            type: item.type === 'dir' ? 'dir' : 'file', storage: item.storage === 'tunneldesk' ? 'tunneldesk' : 'terma',
            deleted_at: typeof item.deleted_at === 'string' ? item.deleted_at : undefined}];
        }) : [];
        if (token !== revision) throw new DOMException('Recycle page superseded', 'AbortError');
        items = normalized;
        const total = Number(data.total);
        const result: SftpRecyclePage = {items, page: positive(data.page, target), total: Number.isSafeInteger(total) && total >= 0 ? total : items.length,
          total_pages: positive(data.total_pages), enabled: data.enabled === true};
        return result;
      },
      async restore(item) {
        const result = record(await port.api(`${endpoint}/restore`, {method: 'POST', body: itemBody(item)}));
        if (!valid()) return;
        port.notify(port.text('sftp:recycle_bin.restored', {path: typeof result.original_path === 'string' ? result.original_path : item.original_path}));
        port.refresh(context.connectionId);
      },
      async remove(item) {
        await port.api(`${endpoint}/delete`, {method: 'POST', body: itemBody(item)});
        if (valid()) port.notify(port.text('sftp:recycle_bin.deleted'));
      },
      async clear() {
        requireValid();
        await port.api(`${endpoint}/clear`, {method: 'POST', body: '{}'});
        if (valid()) port.notify(port.text('sftp:recycle_bin.cleared'));
      }
    });
  }
  return {open, close() { if (!current) return; current.closed = true; current = null; port.close(); }};
}


export interface InstalledFeaturesFilesSftpRecycleServiceServices {
  termaSftpRecycle: ReturnType<typeof createSftpRecycleService>
}
