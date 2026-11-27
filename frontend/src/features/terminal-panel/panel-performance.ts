import {paintPanelPerformance, releasePanelPerformance, type PanelPerformanceState} from './PanelPerformanceView';
import type {createPerformanceSampler} from './performance-sampler';
import type {PanelTarget} from './PanelView';

export function createPanelPerformance(key: string, sampler: ReturnType<typeof createPerformanceSampler>, text: (key: string) => string) {
  let host: HTMLElement | null = null, target: PanelTarget | null = null;
  const state: PanelPerformanceState = {connected: false, savedTarget: false, sort: 'cpu', sample: {error: false, loading: false}};
  function paint() {
    if (host) paintPanelPerformance(host, state, text,
      column => {state.sort = column; paint();});
  }
  function sync(element: HTMLElement | null, next: PanelTarget | null, shown: boolean) {
    if (host && host !== element) releasePanelPerformance(host);
    if (target?.connectionId !== next?.connectionId) {sampler.release(key); state.sample = {error: false, loading: false};}
    host = element; target = next; state.connected = Boolean(next?.connected);
    state.savedTarget = Boolean(next && next.connectionId > 0);
    if (next && next.connectionId > 0) state.sample = sampler.watch(key, next.connectionId,
      shown && state.connected, paint);
    else sampler.release(key);
    paint();
  }
  return {sync, state, unmount() {sync(null, target, false);},
    dispose() {sampler.release(key); if (host) releasePanelPerformance(host); host = null;}};
}
