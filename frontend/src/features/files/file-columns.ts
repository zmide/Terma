const keys = ['name', 'size', 'mtime'] as const;
type Key = typeof keys[number];
const defaults = { name: 2.45, size: .98, mtime: 1.28 }, minimum = { name: 160, size: 96, mtime: 112 };
const storageKey = 'termaLocalFilesColumnLayoutV1';
export function normalizeFileColumns(value: unknown): Record<Key, number> {
  const supplied = (value as { weights?: Partial<Record<Key, unknown>> })?.weights;
  return Object.fromEntries(keys.map(key => [key, Math.round(Math.max(.2, Math.min(8, Number.isFinite(Number(supplied?.[key])) ? Number(supplied?.[key]) : defaults[key])) * 1000) / 1000])) as Record<Key, number>;
}
function read() { try { return normalizeFileColumns(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { return { ...defaults }; } }
export function bindFileColumns(host: HTMLElement) {
  let dragCleanup = () => {}, disposed = false, width = 0;
  const visible = (list: HTMLElement): Key[] => list.clientWidth <= 760 ? ['name', 'size'] : [...keys];
  const apply = () => { const list = host.querySelector<HTMLElement>('.local-files-list'); if (!list || disposed) return; const weights = read(),shown=visible(list); list.style.setProperty('--local-grid-columns', [list.clientWidth <= 760 ? '28px' : '24px', ...shown.map(key => `minmax(0,${weights[key]}fr)`)].join(' '));list.querySelectorAll<HTMLElement>('[data-local-files-column-resize]').forEach(handle=>{const index=shown.indexOf(handle.dataset.localFilesColumnResize as Key);handle.hidden=index<0||index===shown.length-1;}); width = list.clientWidth; };
  const resize = (list: HTMLElement, key: Key, delta: number, initial?: Map<Key, number>) => {
    const shown = visible(list), index = shown.indexOf(key), next = shown[index + 1]; if (!next) return;
    const sizes = initial || new Map(shown.map(column => [column, list.querySelector<HTMLElement>(`[data-local-files-column="${column}"]`)?.getBoundingClientRect().width || 0]));
    const total = (sizes.get(key) || 0) + (sizes.get(next) || 0); if (!total) return;
    const minA = list.clientWidth <= 760 ? 84 : minimum[key], minB = list.clientWidth <= 760 ? 64 : minimum[next];
    const first = Math.max(Math.min(minA, total / 2), Math.min(total - Math.min(minB, total / 2), (sizes.get(key) || 0) + delta));
    const previous = read(), combined = previous[key] + previous[next]; previous[key] = combined * first / total; previous[next] = combined - previous[key];
    try { localStorage.setItem(storageKey, JSON.stringify({ weights: previous })); } catch { /* Resizing remains usable when browser storage is full. */ }
    list.style.setProperty('--local-grid-columns', [list.clientWidth <= 760 ? '28px' : '24px', ...shown.map(column => `${column === key ? first : column === next ? total - first : sizes.get(column) || 0}px`)].join(' '));
  };
  const down = (event: PointerEvent) => {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-local-files-column-resize]'), list = handle?.closest<HTMLElement>('.local-files-list'), key = handle?.dataset.localFilesColumnResize as Key;
    if (!list || !keys.includes(key) || event.button !== 0 || !visible(list).includes(keys[keys.indexOf(key) + 1]!)) return;
    event.preventDefault(); event.stopPropagation(); dragCleanup(); const x = event.clientX, shown = visible(list), initial = new Map(shown.map(column => [column, list.querySelector<HTMLElement>(`[data-local-files-column="${column}"]`)?.getBoundingClientRect().width || 0]));
    const move = (value: PointerEvent) => { if (value.pointerId === event.pointerId) resize(list, key, value.clientX - x, initial); };
    const end = (value: PointerEvent) => { if (value.pointerId === event.pointerId) dragCleanup(); };
    dragCleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); document.body.classList.remove('is-resizing-columns'); dragCleanup = () => {}; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); document.body.classList.add('is-resizing-columns');
  };
  const keyboard = (event: KeyboardEvent) => { const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-local-files-column-resize]'), list = handle?.closest<HTMLElement>('.local-files-list'), key = handle?.dataset.localFilesColumnResize as Key; if (!list || !keys.includes(key) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); resize(list, key, event.key === 'ArrowLeft' ? -16 : 16); };
  host.addEventListener('pointerdown', down); host.addEventListener('keydown', keyboard);
  const observer = new ResizeObserver(() => { const list = host.querySelector<HTMLElement>('.local-files-list'); if (list && list.clientWidth !== width) apply(); }); observer.observe(host); apply();
  return () => { disposed = true; dragCleanup(); observer.disconnect(); host.removeEventListener('pointerdown', down); host.removeEventListener('keydown', keyboard); };
}
