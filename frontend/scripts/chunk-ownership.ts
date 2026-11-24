type ModuleGraph = {
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): { importedIds: readonly string[] } | null;
};

/**
 * Keep a source cycle in one chunk, then pack contiguous portions of the
 * dependency order. Grouping whole feature directories can create a chunk
 * cycle even when the source modules form an acyclic graph.
 */
export function createChunkOwnership(
  graph: ModuleGraph,
  feature: (id: string) => string | undefined
): Map<string, string> {
  const ids = [...graph.getModuleIds()].filter(id => feature(id));
  const included = new Set(ids);
  const edges = new Map(ids.map(id => [
    id, (graph.getModuleInfo(id)?.importedIds || []).filter(target => included.has(target))
  ]));
  const sequence = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  let next = 0;
  function visit(id: string) {
    sequence.set(id, next); low.set(id, next++);
    stack.push(id); active.add(id);
    for (const target of edges.get(id) || []) {
      if (!sequence.has(target)) {
        visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target)) {
        low.set(id, Math.min(low.get(id)!, sequence.get(target)!));
      }
    }
    if (low.get(id) !== sequence.get(id)) return;
    const component: string[] = [];
    let target: string;
    do { target = stack.pop()!; active.delete(target); component.push(target); } while (target !== id);
    components.push(component.sort());
  }
  ids.sort().forEach(id => { if (!sequence.has(id)) visit(id); });
  const owners = new Map(components.flatMap((group, index) => group.map(id => [id, index] as const)));
  const pending = new Map(components.map((group, index) => [
    index, new Set(group.flatMap(id => edges.get(id) || []).map(id => owners.get(id)!).filter(owner => owner !== index))
  ]));
  const labels = components.map(group => feature(group[0])!);
  const counts = new Map<string, number>(), result = new Map<string, string>();
  let previous = '', chunk = '', members = 0;
  while (pending.size) {
    const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([index]) => index);
    if (!ready.length) throw new Error('Unable to order frontend chunks');
    const candidate = ready.find(index => labels[index] === previous) ?? ready[0];
    const label = labels[candidate], group = components[candidate];
    // A bounded number of modules per chunk also prevents broad shared groups
    // from swallowing the complete application as new owners are migrated.
    if (label !== previous || members + group.length > 24) {
      const count = (counts.get(label) || 0) + 1;
      counts.set(label, count); chunk = count === 1 ? label : `${label}-${count}`; members = 0;
    }
    previous = label; members += group.length;
    for (const id of group) result.set(id, chunk);
    pending.delete(candidate);
    for (const dependencies of pending.values()) dependencies.delete(candidate);
  }
  return result;
}
