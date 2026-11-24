import {workspaceServices} from '@/features/workspace/installed-services';
import {isMobileLayout,cssEscape} from '@/shared/browser-ui';
import type { WorkspaceLayoutNode, WorkspacePaneNode } from './workspace-layout-service';
import type { WorkspaceStateGroup, WorkspaceStateTab } from './workspace-state-service';
import type { WorkspaceTab } from './workspace-tab-runtime';

export const WORKSPACE_MIN_SPLIT_RATIO = 0.15;
export const WORKSPACE_MAX_SPLIT_RATIO = 0.85;
export const WORKSPACE_MAX_RESTORE_DEPTH = 64;
export const WORKSPACE_MAX_RESTORE_NODES = 256;
export const WORKSPACE_GROUP_MAIN_ID = 'workspace-main';
export const workspacePaneNodes = new Map<string, HTMLElement>();

export const workspaceDockState = {
  workspacePaneSerial: 1,
  workspaceSplitSerial: 0,
  focusedPaneId: 'pane-1',
  workspaceLayout: {type: 'pane', id: 'pane-1', tabs: [], activeTabKey: ''} as WorkspaceLayoutNode,
  workspaceGroupSerial: 0,
  activeWorkspaceGroupId: WORKSPACE_GROUP_MAIN_ID,
  workspaceGroups: [{
    id: WORKSPACE_GROUP_MAIN_ID, name: '', tabs: [], layout: null, activeTabKey: '', focusedPaneId: 'pane-1'
  }] as WorkspaceStateGroup[]
};

let history: ReturnType<NonNullable<(typeof workspaceServices)['termaWorkspaceState']>['createPaneHistory']> | undefined;
export function workspacePaneHistoryService() {
  return history ||= workspaceServices.termaWorkspaceState!.createPaneHistory(() => workspaceDockState.activeWorkspaceGroupId);
}

export function workspaceCssEscape(value: string) {
  if (typeof cssEscape === 'function') return cssEscape(value);
  if (globalThis.CSS) return CSS.escape(String(value || ''));
  return String(value || '').replace(/["\\]/g, '\\$&');
}

export function workspaceDockElement() {
  return document.getElementById('workspaceDock');
}

export function workspaceAllTabs(): WorkspaceTab[] {
  return workspaceServices.termaWorkspaceGroups!.tabs().filter(isWorkspaceTab);
}

export function workspaceTabByKey(key: string): WorkspaceTab | null {
  const tab = workspaceServices.termaWorkspaceGroups!.tabByKey(String(key || ''));
  return isWorkspaceTab(tab) ? tab : null;
}

export function isWorkspaceTab(value: unknown): value is WorkspaceStateTab & WorkspaceTab {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Record<string, unknown>;
  if (typeof tab.key !== 'string' || !tab.key) return false;
  for (const name of ['kind', 'title', 'subtitle', 'viewName', 'protocol', 'path', 'activityState', 'connectionStatus',
    'sessionMode', 'sessionBackend', 'persistentSessionId', 'logTitleSource'] as const) {
    if (tab[name] !== undefined && typeof tab[name] !== 'string') return false;
  }
  for (const name of ['closable', 'pinned', 'quick_connection', 'transient'] as const) {
    if (tab[name] !== undefined && typeof tab[name] !== 'boolean') return false;
  }
  return (tab.id === undefined || (typeof tab.id === 'number' && Number.isFinite(tab.id)))
    && (tab.fileSource === undefined || tab.fileSource === 'browser' || tab.fileSource === 'server');
}

export function workspaceHasTabKey(key: string) {
  return Boolean(workspaceTabByKey(key));
}

export function workspaceLeaves(node: WorkspaceLayoutNode | null = workspaceDockState.workspaceLayout, result: WorkspacePaneNode[] = []) {
  if (!node) return result;
  return workspaceServices.termaWorkspaceLayout!.leaves(node, result);
}

export function workspaceFindPane(paneId: string, node: WorkspaceLayoutNode | null = workspaceDockState.workspaceLayout) {
  return workspaceServices.termaWorkspaceLayout!.findPane(paneId, node);
}

export function workspaceFindPaneForTab(key: string) {
  return workspaceServices.termaWorkspaceLayout!.findPaneForTab(key, workspaceDockState.workspaceLayout);
}

export function workspaceFindSplit(splitId: string, node: WorkspaceLayoutNode | null = workspaceDockState.workspaceLayout) {
  return workspaceServices.termaWorkspaceLayout!.findSplit(splitId, node);
}

export function workspaceNextPaneId(reservedIds: Iterable<string> = []) {
  const occupiedIds = new Set([...workspacePaneNodes.keys(), ...reservedIds]);
  const allocation = workspaceServices.termaWorkspaceLayout!.allocateId('pane', workspaceDockState.workspaceLayout, occupiedIds, workspaceDockState.workspacePaneSerial);
  workspaceDockState.workspacePaneSerial = allocation.serial;
  return allocation.id;
}

export function workspaceNextSplitId(reservedIds: ReadonlySet<string> = new Set()) {
  const allocation = workspaceServices.termaWorkspaceLayout!.allocateId('split', workspaceDockState.workspaceLayout, reservedIds, workspaceDockState.workspaceSplitSerial);
  workspaceDockState.workspaceSplitSerial = allocation.serial;
  return allocation.id;
}

export function workspaceVisiblePanes() {
  if (!isMobileLayout()) return workspaceLeaves();
  const focused = workspaceFindPane(workspaceDockState.focusedPaneId) || workspaceLeaves()[0];
  return focused ? [focused] : [];
}
