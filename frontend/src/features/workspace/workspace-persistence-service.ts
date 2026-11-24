import {workspaceServices} from '@/features/workspace/installed-services';
import {applicationState} from '@/shared/application-state';
import type { WorkspaceLayoutNode, WorkspaceLayoutRestoreOptions, WorkspaceLayoutService } from './workspace-layout-service';
import type { WorkspaceStateGroup, WorkspaceStateTab, createWorkspaceStateService } from './workspace-state-service';
import type { createWorkspaceGroupController } from './workspace-group-controller';

type SavePort = { save(): void; restoring(): boolean };

const storageKey = 'workspaceTabs';
const layoutVersion = 1;
const groupVersion = 1;

type WorkspaceState = ReturnType<typeof createWorkspaceStateService>;
type GroupController = ReturnType<typeof createWorkspaceGroupController>;
type RestoredGroups = ReturnType<WorkspaceState['restoreGroups']>;
type SavedTabs = ReturnType<WorkspaceState['persistableTab']>;
type GroupLayout = ReturnType<WorkspaceState['applyGroupState']>;

type LayoutSnapshot = {
  tabs: WorkspaceStateTab[];
  activeTabKey: string;
  focusedPaneId: string;
  layout: WorkspaceLayoutNode;
};

type DockedStoragePort = {
  docked(): boolean;
  current(): LayoutSnapshot & { groupId: string };
  restoreGroups(restored: RestoredGroups): void;
  clearHistory(): void;
  rollback(): () => void;
  revealActive(): void;
  options: Omit<WorkspaceLayoutRestoreOptions, 'validKeys' | 'usedKeys' | 'usedPaneIds' | 'usedSplitIds'>;
};

type WorkspaceStoragePort = {
  storage(): Pick<Storage, 'getItem' | 'setItem'>;
  current(): Pick<LayoutSnapshot, 'tabs' | 'activeTabKey'>;
  enabled(): boolean;
  pending(): boolean;
  report(error: unknown): void;
  docked: DockedStoragePort;
};

export function createWorkspacePersistenceService(port: SavePort) {
  let timer = 0;

  function canSave() {
    return !port.restoring();
  }

  function flush() {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    if (canSave()) port.save();
  }

  function schedule(delay = 80) {
    if (!canSave()) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      if (canSave()) port.save();
    }, Math.max(0, Number(delay) || 0));
  }

  function dispose() {
    flush();
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function onVisibilityChange() {
    if (document.hidden) flush();
  }

  function onPageHide(event: PageTransitionEvent) {
    if (event.persisted) flush();
    else dispose();
  }

  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return { schedule, flush, dispose };
}

export function createWorkspaceStorage(port: WorkspaceStoragePort, state: WorkspaceState, layout: WorkspaceLayoutService, groups?: GroupController) {
  const dock = port.docked;

  function persistableTabs(tabs = port.current().tabs) {
    return tabs.map(state.persistableTab).filter((item): item is NonNullable<SavedTabs> => item !== null);
  }

  function dockedSnapshot(host: DockedStoragePort, controller: GroupController) {
    const workspaceGroups = controller.serialize();
    const snapshot = host.current();
    const active = workspaceGroups.find(group => group.id === snapshot.groupId) ?? workspaceGroups[0];
    return {
      version: layoutVersion,
      workspaceGroupsVersion: groupVersion,
      activeWorkspaceGroupId: snapshot.groupId,
      workspaceGroups,
      activeTabKey: active?.activeTabKey || snapshot.activeTabKey,
      focusedPaneId: active?.focusedPaneId || snapshot.focusedPaneId,
      tabs: active?.tabs || persistableTabs(snapshot.tabs),
      layout: active?.layout || layout.serialize(snapshot.layout)
    };
  }

  function save() {
    if (port.pending()) return;
    try {
      const snapshot = dock?.docked() && groups
        ? dockedSnapshot(dock, groups)
        : {activeTabKey: port.current().activeTabKey, tabs: persistableTabs()};
      port.storage().setItem(storageKey, JSON.stringify(snapshot));
    } catch (error) {
      port.report(error);
    }
  }

  function restoreLayout(saved: unknown, validKeys: ReadonlySet<string>, usedKeys?: Set<string>, usedPaneIds?: Set<string>, usedSplitIds?: Set<string>) {
    if (!dock) return null;
    return layout.restore(saved, {...dock.options, validKeys, usedKeys, usedPaneIds, usedSplitIds});
  }

  function restoreGroupLayout(group: WorkspaceStateGroup): GroupLayout {
    const validKeys = new Set(group.tabs.map(tab => tab.key).filter((key): key is string => typeof key === 'string'));
    return state.applyGroupState(group, restoreLayout(group.layout, validKeys));
  }

  function restoreGroups(saved: unknown) {
    if (!dock || !groups) return null;
    dock.restoreGroups(state.restoreGroups(saved));
    return groups.current();
  }

  function restore() {
    if (!port.enabled() || !dock.docked() || !groups) return false;
    const rollback = dock.rollback();
    try {
      const saved: unknown = JSON.parse(port.storage().getItem(storageKey) || '{}');
      if (!saved || typeof saved !== 'object') return false;
      dock.clearHistory();
      const group = restoreGroups(saved);
      if (!group?.tabs.length) return false;
      groups.apply(group);
      groups.render();
      save();
      return true;
    } catch (error) {
      rollback();
      port.report(error);
      return false;
    }
  }

  function applyPreset(saved: Record<string, unknown>) {
    if (!dock.docked() || !groups) return false;
    dock.clearHistory();
    const active = restoreGroups(saved);
    const target = active?.tabs.length ? active : groups.firstPopulated() || active;
    if (!target?.tabs.length) return false;
    if (active?.id !== target.id) {
      groups.switchGroup(target.id, {notify: false, skipCapture: true});
    } else {
      groups.apply(target, {resetSelection: true});
      save();
      dock.revealActive();
    }
    return true;
  }

  return {save, restore, persistableTabs, restoreGroups, restoreLayout, restoreGroupLayout, applyPreset};
}

export function installWorkspacePersistenceService(port: WorkspaceStoragePort) {
  const state = workspaceServices.termaWorkspaceState;
  const layout = workspaceServices.termaWorkspaceLayout;
  if (workspaceServices.termaWorkspacePersistence || !state || !layout) return;
  const storage = createWorkspaceStorage(port, state, layout, workspaceServices.termaWorkspaceGroups);
  const schedule = createWorkspacePersistenceService({
    save: storage.save,
    restoring: () => Boolean(applicationState.restoringTabs || applicationState.workspaceRestorePending)
  });
  workspaceServices.termaWorkspacePersistence = {...schedule, ...storage};
}



export interface InstalledFeaturesWorkspaceWorkspacePersistenceServiceServices {
  termaWorkspacePersistence?: ReturnType<typeof createWorkspaceStorage> & ReturnType<typeof createWorkspacePersistenceService>;
}
