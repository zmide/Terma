import {createWorkspaceLayoutService, type WorkspaceLayoutNode} from '../workspace/workspace-layout-service';
import {applyTabDrop, type WorkspaceDropTarget} from '../workspace/workspace-drag-service';

export type PanelKind = 'commands' | 'files' | 'terminal' | 'performance';
export type PanelRegion = 'bottom' | 'right';
export interface PanelTab {key: string; kind: PanelKind}
export interface PanelLayout {
  version: 1;
  position: 'bottom' | 'right';
  height: number;
  width: number;
  tabs: PanelTab[];
  layout: WorkspaceLayoutNode | null;
  rightLayout: WorkspaceLayoutNode | null;
  focusedPaneId: string;
}
export interface PanelPreset {id: string; name: string; value: PanelLayout}
export interface PanelPreferences {version: 1; visible: boolean; current: PanelLayout; presets: PanelPreset[]; defaultId: string}
export const panelLayout = createWorkspaceLayoutService();
export const panelKinds: PanelKind[] = ['commands', 'files', 'terminal', 'performance'];
export const panelLimits = {tabs: 12, presets: 16, height: [28, 700], width: [260, 1000]} as const;
export const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isFinite(Number(value)) ? Math.round(Math.max(min, Math.min(max, Number(value)))) : fallback;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function freshPanelLayout(types: PanelKind[] = panelKinds): PanelLayout {
  const tabs = [...new Set([...types, ...panelKinds])].map((kind, index): PanelTab => ({key: `panel-tab-${index + 1}`, kind}));
  const layout: WorkspaceLayoutNode = {type: 'pane', id: 'panel-pane-1', tabs: tabs.map(tab => tab.key), activeTabKey: tabs[0].key};
  return {version: 1, position: 'bottom', height: 220, width: 380, tabs, layout, rightLayout: null, focusedPaneId: 'panel-pane-1'};
}

/** A whitelist also keeps session text, commands and secrets out of saved layouts. */
export function cleanPanelLayout(input: unknown): PanelLayout {
  const value = record(input);
  if (value.version !== 1) return freshPanelLayout();
  const seen = new Set<string>(), types = new Set<PanelKind>(), tabs: PanelTab[] = [];
  for (const item of (Array.isArray(value.tabs) ? value.tabs : []).slice(0, panelLimits.tabs)) {
    const tab = record(item);
    if (typeof tab.key !== 'string' || !/^panel-tab-[\w-]{1,80}$/.test(tab.key) || seen.has(tab.key)
      || !panelKinds.includes(tab.kind as PanelKind) || types.has(tab.kind as PanelKind)) continue;
    seen.add(tab.key);
    types.add(tab.kind as PanelKind);
    tabs.push({key: tab.key, kind: tab.kind as PanelKind});
  }
  if (!tabs.length) return freshPanelLayout();
  let serial = 0;
  const usedKeys = new Set<string>(), usedPaneIds = new Set<string>(), usedSplitIds = new Set<string>();
  const options = {validKeys: seen, usedKeys, usedPaneIds, usedSplitIds, maxDepth: 8, maxNodes: 31,
    nextPaneId: () => `panel-pane-restored-${++serial}`, nextSplitId: () => `panel-split-restored-${++serial}`};
  const legacyRight = !Object.hasOwn(value, 'rightLayout') && value.position === 'right';
  let layout = panelLayout.restore(legacyRight ? null : value.layout, options);
  const rightLayout = panelLayout.restore(legacyRight ? value.layout : value.rightLayout, options);
  for (const kind of panelKinds) {
    if (types.has(kind)) continue;
    let key = `panel-tab-default-${kind}`;
    while (seen.has(key)) key = `panel-tab-default-${kind}-${++serial}`;
    tabs.push({key, kind}); seen.add(key);
  }
  const unassigned = tabs.filter(tab => !usedKeys.has(tab.key));
  if (unassigned.length) {
    if (!layout) layout = {type: 'pane', id: options.nextPaneId(), tabs: [], activeTabKey: ''};
    const first = panelLayout.leaves(layout)[0];
    first.tabs.push(...unassigned.map(tab => tab.key));
    if (!first.activeTabKey) first.activeTabKey = first.tabs[0];
  }
  const leaves = [...panelLayout.leaves(layout), ...panelLayout.leaves(rightLayout)];
  const focusedPaneId = leaves.find(pane => pane.id === value.focusedPaneId)?.id || leaves[0]?.id || '';
  return {version: 1, position: value.position === 'right' ? 'right' : 'bottom',
    height: bounded(value.height, ...panelLimits.height, 220), width: bounded(value.width, ...panelLimits.width, 380),
    tabs, layout, rightLayout, focusedPaneId};
}

export function cleanPanelPreferences(input: unknown, legacy: {visible?: string | null; height?: string | null} = {}): PanelPreferences {
  const value = record(input), presets: PanelPreset[] = [], ids = new Set<string>();
  for (const item of (Array.isArray(value.presets) ? value.presets : []).slice(0, panelLimits.presets)) {
    const preset = record(item);
    if (typeof preset.id !== 'string' || !/^preset-[\w-]{1,80}$/.test(preset.id) || ids.has(preset.id)
      || typeof preset.name !== 'string' || !preset.name.trim()) continue;
    ids.add(preset.id);
    presets.push({id: preset.id, name: preset.name.trim().slice(0, 80), value: cleanPanelLayout(preset.value)});
  }
  const current = cleanPanelLayout(value.current);
  if (value.version !== 1 && legacy.height) current.height = bounded(Number(legacy.height) + 64, ...panelLimits.height, 220);
  return {version: 1, visible: value.version === 1 ? value.visible === true : legacy.visible === '1',
    current, presets, defaultId: typeof value.defaultId === 'string' && ids.has(value.defaultId) ? value.defaultId : ''};
}

export function createPanelModel(preferences: PanelPreferences, changed: () => void) {
  const state = {preferences, maximized: false, maximizedRegion: 'bottom' as PanelRegion,
    presetsOpen: false, presetDraft: '', notice: '', revision: 0, collapsedRight: new Set<string>()};
  let serial = Date.now();
  const current = () => state.preferences.current;
  const publish = () => {
    if (!(state.maximizedRegion === 'right' ? current().rightLayout : current().layout)) state.maximized = false;
    state.revision++; changed();
  };
  const layout = (region: PanelRegion) => region === 'right' ? current().rightLayout : current().layout;
  const setLayout = (region: PanelRegion, value: WorkspaceLayoutNode | null) => {
    if (region === 'right') current().rightLayout = value; else current().layout = value;
  };
  const leaves = () => [...panelLayout.leaves(current().layout), ...panelLayout.leaves(current().rightLayout)];
  const findPane = (id: string) => leaves().find(pane => pane.id === id) || null;
  const findPaneForTab = (key: string) => leaves().find(pane => pane.tabs.includes(key)) || null;
  const regionForPane = (id: string): PanelRegion => panelLayout.findPane(id, current().rightLayout) ? 'right' : 'bottom';
  const pane = () => findPane(current().focusedPaneId) || leaves()[0];
  function add(kind: PanelKind, split?: 'row' | 'column') {
    const tab = current().tabs.find(tab => tab.kind === kind), target = pane();
    if (!tab || !target) return false;
    if (split) move(tab.key, {paneId: target.id, zone: split === 'row' ? 'right' : 'bottom'});
    else activate(findPaneForTab(tab.key)!.id, tab.key);
    return tab.key;
  }
  function close(key: string) {
    const source = findPaneForTab(key);
    return source && regionForPane(source.id) === 'right' ? dock(key, 'bottom') : false;
  }
  function activate(paneId: string, key: string) {
    const target = findPane(paneId);
    if (!target?.tabs.includes(key)) return;
    current().focusedPaneId = paneId; current().position = regionForPane(paneId); target.activeTabKey = key;
    state.collapsedRight.delete(key); publish();
  }
  function toggleSection(paneId: string, key: string) {
    if (!findPane(paneId)?.tabs.includes(key) || regionForPane(paneId) !== 'right') return;
    if (state.collapsedRight.has(key)) activate(paneId, key);
    else {state.collapsedRight.add(key); publish();}
  }
  function restore(value: unknown) {
    const next = cleanPanelLayout(value), keys = new Map(next.tabs.map(tab =>
      [tab.key, current().tabs.find(existing => existing.kind === tab.kind)?.key || tab.key]));
    for (const pane of [...panelLayout.leaves(next.layout), ...panelLayout.leaves(next.rightLayout)]) {
      pane.tabs = pane.tabs.map(key => keys.get(key)!); pane.activeTabKey = keys.get(pane.activeTabKey)!;
    }
    next.tabs = next.tabs.map(tab => ({...tab, key: keys.get(tab.key)!}));
    state.preferences.current = next; state.maximized = false; state.collapsedRight.clear(); publish();
  }
  function savePreset() {
    const name = state.presetDraft.trim().slice(0, 80);
    if (!name || state.preferences.presets.length >= panelLimits.presets) return false;
    const id = `preset-${++serial}`;
    state.preferences.presets.push({id, name, value: cleanPanelLayout(current())});
    state.presetDraft = ''; publish(); return id;
  }
  function renamePreset(id: string) {
    const preset = state.preferences.presets.find(item => item.id === id), name = state.presetDraft.trim().slice(0, 80);
    if (!preset || !name) return;
    preset.name = name; state.presetDraft = ''; publish();
  }
  function deletePreset(id: string) {
    state.preferences.presets = state.preferences.presets.filter(item => item.id !== id);
    if (state.preferences.defaultId === id) state.preferences.defaultId = '';
    publish();
  }
  function move(key: string, target: WorkspaceDropTarget) {
    const source = findPaneForTab(key), destination = target.paneId ? findPane(target.paneId) : null;
    if (!source || !destination) return false;
    const region = regionForPane(destination.id);
    if (regionForPane(source.id) !== region) {
      remove(key);
      const receiver = findPane(destination.id)!;
      receiver.tabs.push(key); receiver.activeTabKey = key;
    }
    return applyTabDrop({
      findPaneForTab, findPane,
      nextPaneId: () => `panel-pane-${++serial}`, nextSplitId: () => `panel-split-${++serial}`,
      replacePaneWithSplit: (id, split) => panelLayout.replacePaneWithSplit(id, split, layout(region)!),
      setLayout: value => setLayout(region, value),
      normalize: () => {
        setLayout(region, panelLayout.prune(layout(region)));
      },
      setFocusedPane: id => {current().focusedPaneId = id; current().position = region;},
      setActiveTab: () => {}, setActiveView: () => {}, tab: key => current().tabs.find(tab => tab.key === key) || null,
      renderTabs: () => {}, renderPaneContent: () => {}, revealTab: () => {}, syncFocused: () => {}, syncToolbars: publish
    }, {key, sourceActiveTabKey: source?.activeTabKey}, target);
  }
  function remove(key: string) {
    const allowed = new Set(current().tabs.filter(tab => tab.key !== key).map(tab => tab.key));
    current().layout = panelLayout.filter(current().layout, allowed);
    current().rightLayout = panelLayout.filter(current().rightLayout, allowed);
  }
  function dock(key: string, region: PanelRegion) {
    const source = findPaneForTab(key);
    if (!source) return false;
    state.collapsedRight.delete(key);
    const destination = panelLayout.leaves(layout(region))[0];
    if (destination) return move(key, {paneId: destination.id, zone: 'tabs'});
    remove(key);
    const next = {type: 'pane' as const, id: `panel-pane-${++serial}`, tabs: [key], activeTabKey: key};
    setLayout(region, next); current().focusedPaneId = next.id; current().position = region; publish();
    return true;
  }
  function returnRight() {
    const keys = panelLayout.leaves(current().rightLayout).flatMap(pane => pane.tabs);
    keys.forEach(key => dock(key, 'bottom'));
  }
  return {state, current, pane, layout, leaves, findPane, findPaneForTab, regionForPane, add, close, activate, toggleSection, restore,
    publish, savePreset, renamePreset, deletePreset, move, dock, returnRight};
}
