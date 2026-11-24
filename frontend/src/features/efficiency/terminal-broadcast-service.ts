import {efficiencyServices} from '@/features/efficiency/installed-services';
export interface TerminalBroadcastState { targets: Set<string>; paused: boolean }

export function createTerminalBroadcastService() {
  const state: TerminalBroadcastState = {targets: new Set(), paused: false};
  function setTargets(values: readonly string[]) {
    const next = new Set(values.map(value => String(value || '')).filter(Boolean));
    const unchanged = next.size === state.targets.size && [...next].every(value => state.targets.has(value));
    state.targets = next;
    if (!unchanged) state.paused = false;
    return [...state.targets];
  }
  function clear() { state.targets.clear(); state.paused = false; }
  function openTargets(openKeys: Iterable<string>) {
    const open = new Set([...openKeys].map(value => String(value || '')));
    return [...state.targets].filter(key => open.has(key));
  }
  function isTarget(key: string) { return state.targets.has(String(key || '')); }
  function active(openKeys: Iterable<string>) { return openTargets(openKeys).length >= 2; }
  function setPaused(value: boolean) { state.paused = Boolean(value); }
  return {state,setTargets,clear,openTargets,isTarget,active,setPaused};
}

export function installTerminalBroadcastService() {
  if (!efficiencyServices.termaTerminalBroadcast) efficiencyServices.termaTerminalBroadcast = createTerminalBroadcastService();
}



export interface InstalledFeaturesEfficiencyTerminalBroadcastServiceServices {
  termaTerminalBroadcast?: ReturnType<typeof createTerminalBroadcastService>;
}
