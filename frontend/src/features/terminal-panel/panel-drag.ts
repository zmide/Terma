import {createWorkspaceTabDrag, workspaceTabInsertion} from '../workspace/workspace-tab-drag';
import type {WorkspaceDropTarget} from '../workspace/workspace-drag-service';
import {type PanelRegion, type createPanelModel} from './panel-model';
import {hideActionMenu} from '@/shared/action-menu';

export function createPanelDrag(model: ReturnType<typeof createPanelModel>, text: (key: string) => string,
  workspace: {canOpen(key: string): boolean; open(key: string, paneId: string): void}) {
  let target: WorkspaceDropTarget | null = null;
  let regionTarget: PanelRegion | null = null;
  let workspacePane = '', sourceKey = '';
  let workspaceMarker: HTMLElement | null = null;
  const root = () => document.getElementById('terminalPanelWorkspace');
  const paneElement = (id: string) => root()?.querySelector<HTMLElement>(`[data-panel-pane="${CSS.escape(id)}"]`) || null;
  const clear = () => {
    target = null; regionTarget = null; workspacePane = '';
    workspaceMarker?.classList.remove('panel-sftp-copy-target'); workspaceMarker = null;
    const regionDrop = root()?.querySelector<HTMLElement>('[data-panel-region-drop]');
    if (regionDrop) regionDrop.hidden = true;
    root()?.querySelectorAll<HTMLElement>('[data-panel-drop]').forEach(node => {node.hidden = true;});
    root()?.querySelectorAll<HTMLElement>('[data-panel-insert]').forEach(node => {node.hidden = true;});
  };
  const drag = createWorkspaceTabDrag({
    context: () => 'utility-panel',
    mobile: () => innerWidth <= 760, selectionMode: () => false,
    source: key => {
      const pane = model.findPaneForTab(key);
      const tab = root()?.querySelector<HTMLElement>(`[data-panel-tab-shell="${CSS.escape(key)}"]`);
      return pane && tab ? {paneId: pane.id, activeTabKey: pane.activeTabKey, tab} : null;
    },
    activateSource: (key, source) => {
      sourceKey = key;
      if (model.regionForPane(source.paneId) === 'bottom') model.activate(source.paneId, key);
    },
    presentation: key => ({icon: '', title: text(model.current().tabs.find(tab => tab.key === key)?.kind || 'title')}),
    hideMenu: hideActionMenu, render: model.publish
  }, {
    scrollArea(id) {
      const tabs = paneElement(target?.paneId || id)?.querySelector<HTMLElement>('.terminal-panel-tabs');
      return tabs ? {tabs, shell: tabs} : null;
    },
    clear,
    update(x, y) {
      clear();
      const element = document.elementFromPoint(x, y);
      const strip = element?.closest<HTMLElement>('#workspaceDock .tabs-shell');
      if (strip && workspace.canOpen(sourceKey)) {
        workspacePane = strip.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId || '';
        if (workspacePane) {workspaceMarker = strip; strip.classList.add('panel-sftp-copy-target'); return strip;}
      }
      const panel = root(), bounds = panel?.getBoundingClientRect();
      if (!panel || !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
      const pane = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-panel-pane]');
      if (!pane || !panel.contains(pane)) {
        const region = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-panel-region]')?.dataset.panelRegion;
        regionTarget = region === 'bottom' || region === 'right' ? region
          : innerWidth > 760 && x > bounds.right - Math.min(100, bounds.width * 0.2) ? 'right'
          : y > bounds.bottom - 60 ? 'bottom' : null;
        if (!regionTarget) return null;
        const marker = panel.querySelector<HTMLElement>('[data-panel-region-drop]')!;
        marker.dataset.region = regionTarget; marker.hidden = false;
        return marker;
      }
      if (model.regionForPane(pane.dataset.panelPane || '') === 'right') {
        target = {paneId: pane.dataset.panelPane, zone: 'tabs'};
        const marker = pane.querySelector<HTMLElement>('[data-panel-drop]')!;
        marker.dataset.zone = 'center'; marker.hidden = false; return marker;
      }
      const tabs = pane.querySelector<HTMLElement>('.terminal-panel-tabs')!;
      const tabRect = tabs.getBoundingClientRect(), rect = pane.getBoundingClientRect();
      if (y <= tabRect.bottom) {
        const insertion = workspaceTabInsertion(tabs, x, '.terminal-panel-tab:not(.tab-dragging)');
        target = {paneId: pane.dataset.panelPane, zone: 'tabs', index: insertion.index};
        const marker = pane.querySelector<HTMLElement>('[data-panel-insert]')!;
        const end = insertion.before?.getBoundingClientRect().left
          ?? [...tabs.querySelectorAll<HTMLElement>('.terminal-panel-tab')].at(-1)?.getBoundingClientRect().right ?? tabRect.left;
        marker.style.left = `${Math.max(0, Math.min(tabRect.width - 1, end - tabRect.left)) + tabs.scrollLeft}px`;
        marker.hidden = false;
        return null;
      }
      const distances = [['left', (x - rect.left) / rect.width], ['right', (rect.right - x) / rect.width],
        ['top', (y - tabRect.bottom) / Math.max(1, rect.bottom - tabRect.bottom)], ['bottom', (rect.bottom - y) / rect.height]] as const;
      const nearest = [...distances].sort((a, b) => a[1] - b[1])[0];
      target = {paneId: pane.dataset.panelPane, zone: innerWidth > 760 && nearest[1] < 0.28 ? nearest[0] : 'center'};
      const marker = pane.querySelector<HTMLElement>('[data-panel-drop]')!;
      marker.dataset.zone = target.zone; marker.hidden = false;
      return marker;
    },
    apply: key => {
      if (workspacePane && workspace.canOpen(key)) {workspace.open(key, workspacePane); return true;}
      return regionTarget ? model.dock(key, regionTarget) : Boolean(target && model.move(key, target));
    }
  });
  return drag;
}
