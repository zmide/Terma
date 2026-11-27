import type {HostPerformanceSnapshot} from '../../../../src/services/host-performance-types';
export type {HostPerformanceSnapshot} from '../../../../src/services/host-performance-types';
export interface PerformanceSampleState {snapshot?: HostPerformanceSnapshot; error: boolean; loading: boolean}
interface SamplerPort {
  request(id: number, signal: AbortSignal): Promise<HostPerformanceSnapshot>;
  now?(): number;
}
export function createPerformanceSampler(port: SamplerPort) {
  type Sample = PerformanceSampleState & {controller?: AbortController; timer?: ReturnType<typeof setTimeout>; last: number};
  const records = new Map<number, Sample>();
  const watchers = new Map<string, {id: number; active: boolean; changed: () => void}>();
  const now = port.now || Date.now;
  const active = (id: number) => [...watchers.values()].some(w => w.id === id && w.active);
  const publish = (id: number) => {for (const w of watchers.values()) if (w.id === id) w.changed();};
  function update(id: number) {
    const sample = records.get(id); if (!sample) return;
    if (!active(id)) {
      clearTimeout(sample.timer); sample.timer = undefined; sample.controller?.abort(); return;
    }
    if (sample.controller || sample.timer || sample.snapshot?.supported === false) return;
    const wait = Math.max(0, 2000 - (now() - sample.last));
    sample.timer = setTimeout(() => {sample.timer = undefined; void collect(id, sample);}, wait);
  }
  async function collect(id: number, sample: Sample) {
    if (!active(id) || records.get(id) !== sample) return;
    const controller = new AbortController();
    sample.controller = controller; sample.loading = true; sample.last = now(); publish(id);
    try {
      const snapshot = await port.request(id, controller.signal);
      if (sample.controller !== controller || controller.signal.aborted) return;
      sample.snapshot = snapshot; sample.error = false;
    } catch {
      if (!controller.signal.aborted) sample.error = true;
    } finally {
      if (sample.controller === controller) {
        sample.controller = undefined; sample.loading = false; publish(id); update(id);
      }
    }
  }
  return {
    watch(key: string, id: number, enabled: boolean, changed: () => void) {
      const previous = watchers.get(key);
      watchers.set(key, {id, active: enabled, changed});
      if (!records.has(id)) records.set(id, {last: 0, loading: false, error: false});
      if (previous && previous.id !== id) update(previous.id);
      update(id); return records.get(id)! as PerformanceSampleState;
    },
    release(key: string) {
      const previous = watchers.get(key); watchers.delete(key);
      if (!previous) return;
      update(previous.id);
      if (![...watchers.values()].some(w => w.id === previous.id)) {
        const record = records.get(previous.id); record?.controller?.abort();
        clearTimeout(record?.timer); records.delete(previous.id);
      }
    },
    dispose() {
      watchers.clear();
      for (const record of records.values()) {clearTimeout(record.timer); record.controller?.abort();}
      records.clear();
    }
  };
}
