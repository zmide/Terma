import {workspaceServices} from '@/features/workspace/installed-services';
import {applicationState} from '@/shared/application-state';
import {
  workspaceCssEscape, workspaceDockElement, workspaceDockState, workspaceFindPane, workspaceFindPaneForTab,
  workspaceLeaves, workspacePaneNodes
} from './workspace-dock-state';



let executingPaneId = '';

export function executionPaneId() {
  return executingPaneId;
}

export function currentWorkspacePaneId() {
  return executingPaneId || workspaceDockState.focusedPaneId || workspaceLeaves()[0]?.id || 'pane-1';
}

export function workspacePaneElement(paneId?: string) {
  if (!paneId) return null;
  return workspacePaneNodes.get(paneId)
    ?? document.querySelector<HTMLElement>(`.workspace-pane[data-pane-id="${workspaceCssEscape(paneId)}"]`);
}

export function currentWorkspaceDomScope() {
  return workspacePaneElement(currentWorkspacePaneId());
}

export function runInWorkspacePane<T>(paneId: string, action: () => T): T {
  const previous = executingPaneId;
  executingPaneId = paneId || previous || workspaceDockState.focusedPaneId;
  try {
    return action();
  } finally {
    executingPaneId = previous;
  }
}

export function captureWorkspacePane() {
  const paneId = currentWorkspacePaneId();
  return <T>(action: () => T) => {
    if (workspaceDockElement() && !workspaceFindPane(paneId)) return undefined;
    return runInWorkspacePane(paneId, action);
  };
}

export function captureWorkspaceTab(tabKey = applicationState.activeTabKey) {
  const fallbackPaneId = currentWorkspacePaneId();
  return <T>(action: () => T) => {
    if (!workspaceDockElement()) return runInWorkspacePane(fallbackPaneId, action);
    const pane = workspaceFindPaneForTab(tabKey);
    if (!pane || pane.activeTabKey !== tabKey) return undefined;
    return runInWorkspacePane(pane.id, action);
  };
}

export function workspaceElementForTab(key: string, selector: string) {
  const pane = workspaceFindPaneForTab(key);
  // The pane reuses one DOM section per view type. Only the active tab owns it.
  if (!pane || pane.activeTabKey !== key) return null;
  return workspacePaneElement(pane.id)?.querySelector<HTMLElement>(selector) ?? null;
}

const legacyPaneScope = {
  executionPaneId, currentWorkspacePaneId, currentWorkspaceDomScope,
  workspacePaneElement, workspaceElementForTab, runInWorkspacePane
};

export function installWorkspacePaneScope() {
  workspaceServices.termaWorkspacePaneScope = legacyPaneScope;
}



export interface InstalledFeaturesWorkspaceWorkspacePaneScopeServices {
  termaWorkspacePaneScope: typeof legacyPaneScope;
}
