import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';

type DragState = {
  group: HTMLElement;
  originalNames: string[];
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout>;
  renderPending?: boolean;
};

export type ConnectionGroupDragPort = Omit<ConnectionViewPort, 'saveConnectionGroupOrder'> & {
  saveConnectionGroupOrder(names: string[]): Promise<void>;
};

export type ConnectionGroupDragService = {
  begin(event: PointerEvent, groupName: string): void;
  isClickSuppressed(): boolean;
};

export function createConnectionGroupDragService(port: ConnectionGroupDragPort): ConnectionGroupDragService {
  let clickSuppressedUntil = 0;

  function root() {
    return port.$('connectionGroups') as HTMLElement | null;
  }

  function names() {
    return [...(root()?.querySelectorAll<HTMLElement>('.group[data-group-name]') || [])]
      .map(item => decodeURIComponent(item.dataset.groupName || ''));
  }

  function searching() {
    return port.primaryView === 'remote' ? port.remoteConnectionSearch : port.connectionSearch;
  }

  function begin(event: PointerEvent, groupName: string) {
    if (searching() || event.button > 0) return;
    const container = root();
    const group = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.group');
    if (!container || !group) return;
    const originalNames = names();
    const state: DragState = {
      group,
      originalNames,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      timer: setTimeout(() => {
        if (port.connectionGroupDrag !== state) return;
        state.active = true;
        state.group.classList.add('group-dragging');
        document.body.classList.add('connection-group-drag-active');
        try {(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);} catch {}
      }, 450)
    };
    port.connectionGroupDrag = state;

    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
    };
    const move = (moveEvent: PointerEvent) => {
      if (port.connectionGroupDrag !== state || moveEvent.pointerId !== state.pointerId) return;
      if (!state.active && Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) > 8) {
        clearTimeout(state.timer);
        port.connectionGroupDrag = null;
        cleanup();
        return;
      }
      if (!state.active) return;
      moveEvent.preventDefault();
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('.group');
      const parent = target?.parentElement;
      if (target && parent && target !== state.group && parent === state.group.parentElement) {
        const rect = target.getBoundingClientRect();
        parent.insertBefore(state.group, moveEvent.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
      }
      const rect = container.getBoundingClientRect();
      if (moveEvent.clientY < rect.top + 40) container.scrollBy({top: -14});
      else if (moveEvent.clientY > rect.bottom - 40) container.scrollBy({top: 14});
    };
    const finish = async (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== state.pointerId) return;
      clearTimeout(state.timer);
      cleanup();
      if (!state.active) {
        port.connectionGroupDrag = null;
        if (state.renderPending) port.renderConnections();
        return;
      }
      state.group.classList.remove('group-dragging');
      document.body.classList.remove('connection-group-drag-active');
      clickSuppressedUntil = Date.now() + 500;
      port.connectionGroupDrag = null;
      try {
        await port.saveConnectionGroupOrder(names());
        port.notify(port.tr('connections:groups.order_saved', {defaultValue: '分组顺序已保存'}), 'success');
      } catch (error: any) {
        port.notify(port.localizedTermaUiPhrase(error?.message || String(error)), 'error');
        await port.loadAll();
      }
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== state.pointerId) return;
      clearTimeout(state.timer);
      cleanup();
      state.group.classList.remove('group-dragging');
      document.body.classList.remove('connection-group-drag-active');
      port.connectionGroupDrag = null;
      const nodes = new Map([...container.querySelectorAll<HTMLElement>('.group[data-group-name]')]
        .map(item => [decodeURIComponent(item.dataset.groupName || ''), item]));
      for (const name of state.originalNames) {
        const node = nodes.get(name);
        if (node) container.appendChild(node);
      }
      if (state.renderPending) port.renderConnections();
    };
    document.addEventListener('pointermove', move, {passive: false});
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
  }

  return {begin, isClickSuppressed: () => Date.now() < clickSuppressedUntil};
}

export function installConnectionGroupDragService(host: ConnectionGroupDragPort) {
  if (!connectionsServices.termaConnectionGroupDrag) {
    connectionsServices.termaConnectionGroupDrag = createConnectionGroupDragService(host);
  }
}



export interface InstalledFeaturesConnectionsConnectionGroupDragServiceServices {
  termaConnectionGroupDrag?: ConnectionGroupDragService;
}
