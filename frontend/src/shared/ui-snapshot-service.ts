import {sharedServices} from '@/shared/installed-services';
type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface UiSnapshot {
  activeId: string;
  activeName: string;
  activeValue?: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection?: 'forward' | 'backward' | 'none';
  treeScrollTop: number;
  workspaceScrollTop: number;
  openDetails: string[];
}

interface UiSnapshotPort {
  document: Document;
  element(id: string): HTMLElement | null;
  workspace(): HTMLElement | null;
}

function editable(element: Element | null): element is Editable {
  return Boolean(element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

function selectable(element: Editable): element is HTMLInputElement | HTMLTextAreaElement {
  return element.tagName === 'TEXTAREA'
    || (element.tagName === 'INPUT' && ['text', 'search', 'url', 'tel', 'password'].includes((element as HTMLInputElement).type));
}

export function createUiSnapshotService(port: UiSnapshotPort) {
  function capture(root: ParentNode = port.document): UiSnapshot {
    const active = port.document.activeElement;
    const field = editable(active) ? active : null;
    const selection = field && selectable(field) ? field : null;
    return {
      activeId: field?.id || '',
      activeName: field?.getAttribute('name') || '',
      activeValue: field?.closest('[data-terma-managed-fields]') || field?.tagName === 'INPUT' && field.type === 'file'
        ? undefined : field?.value,
      selectionStart: selection?.selectionStart ?? null,
      selectionEnd: selection?.selectionEnd ?? null,
      selectionDirection: selection?.selectionDirection || undefined,
      treeScrollTop: port.element('connectionGroups')?.scrollTop || 0,
      workspaceScrollTop: port.workspace()?.scrollTop || 0,
      openDetails: [...root.querySelectorAll<HTMLDetailsElement>('details[id]')].filter(item => item.open).map(item => item.id)
    };
  }

  function restore(state: UiSnapshot | null | undefined) {
    if (!state) return;
    for (const id of state.openDetails || []) {
      const detail = port.element(id);
      if (detail?.tagName === 'DETAILS') (detail as HTMLDetailsElement).open = true;
    }
    if (state.activeId) {
      const next = port.element(state.activeId)
        || (state.activeName ? port.document.getElementsByName(state.activeName)[0] : null);
      if (editable(next)) {
        if (state.activeValue !== undefined && !(next.tagName === 'INPUT' && next.type === 'file') && next.value !== state.activeValue) {
          next.value = state.activeValue;
        }
        next.focus({ preventScroll: true });
        if (state.selectionStart !== null && selectable(next)) {
          next.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart, state.selectionDirection);
        }
      }
    }
    const tree = port.element('connectionGroups'), workspace = port.workspace();
    if (tree) tree.scrollTop = state.treeScrollTop || 0;
    if (workspace) workspace.scrollTop = state.workspaceScrollTop || 0;
  }

  return { capture, restore };
}

export function installUiSnapshotService(port:Pick<UiSnapshotPort,'element'|'workspace'>) {
  sharedServices.termaUiSnapshots ??= createUiSnapshotService({
    document,
    element: id => port.element(id),
    workspace: () => port.workspace()
  });
}




export const captureUiState=(...args:Parameters<(typeof sharedServices)['termaUiSnapshots']['capture']>)=>sharedServices.termaUiSnapshots.capture(...args);
export const restoreUiState=(...args:Parameters<(typeof sharedServices)['termaUiSnapshots']['restore']>)=>sharedServices.termaUiSnapshots.restore(...args);

export interface InstalledSharedUiSnapshotServiceServices {
  termaUiSnapshots: ReturnType<typeof createUiSnapshotService>;
}
