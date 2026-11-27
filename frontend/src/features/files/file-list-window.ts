/** Bounded page cache and viewport geometry shared by remote and local file views. */
export function createFileListWindow<T>() {
  const pages = new Map<number, T[]>();
  let identity = '', size = 200, total = 0;
  function sync(next: string, page: number, pageSize: number, count: number, entries: readonly T[]) {
    const limit = Math.max(1, Math.trunc(pageSize) || 200);
    if (identity !== next || limit !== size) {pages.clear(); identity = next; size = limit;}
    total = Math.max(0, Math.trunc(count) || 0);
    pages.set(Math.max(1, Math.trunc(page) || 1), [...entries].slice(0, size));
  }
  function range(top: number, height: number, rowHeight: number) {
    const row = Math.max(1, rowHeight), first = Math.max(0, Math.min(Math.max(0, total - 1), Math.floor(top / row)));
    const start = Math.max(0, first - 8), end = Math.min(total, Math.max(start, first + Math.ceil(height / row) + 8));
    const currentPage = Math.floor(first / size) + 1;
    if (pages.size > 5) {
      const farthest = [...pages.keys()].sort((a, b) => Math.abs(b - currentPage) - Math.abs(a - currentPage));
      for (const page of farthest.slice(0, pages.size - 5)) pages.delete(page);
    }
    const items: {index: number; value: T | null}[] = [];
    let missingPage = 0;
    for (let index = start; index < end; index++) {
      const page = Math.floor(index / size) + 1, value = pages.get(page)?.[index % size] || null;
      items.push({index, value});
      if (!value && !missingPage) missingPage = page;
    }
    return {items, top: start * row, bottom: (total - end) * row, missingPage, first, last: Math.min(total, first + Math.ceil(height / row))};
  }
  function loaded() {return [...pages].sort(([a], [b]) => a - b).flatMap(([, entries]) => entries);}
  return {sync, range, loaded, clear() {pages.clear(); identity = ''; total = 0;}, pageCount: () => pages.size};
}
