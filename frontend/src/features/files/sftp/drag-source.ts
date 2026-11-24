import { createDragHandoff } from './drag-handoff';
import { hasInternalPayload, readDragPayload, type DragEntry, type DragTransfer } from './drag-payload';
import { joinRemotePath, type SftpDirectoryState } from './directory-state';
import type { BrowserDrag, DragTab } from './browser-drag-runtime';

type NativeSource = BrowserDrag & {
  released?: boolean; activated?: boolean; lastActivityAt?: number; createdAt?: number;
};
interface Port {
  state(key: string): Pick<SftpDirectoryState, 'path' | 'entries' | 'connectionId'> | undefined;
  selected(key: string): DragEntry[];
  select(key: string, id: number, path: string, name: string, type: string, preserve: boolean): void;
  internal(): BrowserDrag | null;
  requests(): Iterable<NativeSource>;
  tab(key: string): DragTab | undefined;
  expired(): void;
}

const NATIVE_DRAG_ACTIVE_TTL = 2 * 60 * 1000;
export function nativeDragRequestIsActive(request?: Partial<NativeSource> | null, now = Date.now()) {
  return Boolean(request && !request.released && (request.activated || request.nativeStarted)
    && now - Number(request.lastActivityAt || request.createdAt || now) <= NATIVE_DRAG_ACTIVE_TTL);
}

export function createDragSource(port: Port) {
  const handoff = createDragHandoff({ expired: port.expired });

  function entries(path: string, name: string, type: string, key: string, select = false): DragEntry[] {
    const state = port.state(key);
    if (select) {
      const preserve = port.selected(key).some(item => item.path === path);
      port.select(key, Number(state?.connectionId || 0), path, name, type, preserve);
    }
    const selected = port.selected(key);
    if (selected.some(item => item.path === path)) return selected;
    const listed = state?.entries.find(item => joinRemotePath(state.path, item.name) === path);
    return [{ path, name, type, size: Math.max(0, Number(listed?.size || 0)),
      mtime: Math.max(0, Number(listed?.mtime || 0)), metadataKnown: Boolean(listed) }];
  }

  function active(transfer?: DragTransfer | null): BrowserDrag | null {
    const internal = port.internal();
    const hasInternal = !transfer || hasInternalPayload(transfer);
    if (internal && hasInternal) return internal;
    const pending = handoff.read();
    if (pending && hasInternal) return pending;
    const restored = readDragPayload(transfer);
    if (restored) return restored;
    for (const request of [...port.requests()].reverse()) {
      if (nativeDragRequestIsActive(request) && Number.isInteger(Number(request.connectionId))
        && Array.isArray(request.entries) && request.entries.length) return request;
    }
    return null;
  }

  function crossTarget(drag: BrowserDrag | null, key: string) {
    const target = port.tab(key);
    return drag && target?.kind === 'sftp' && String(target.key || '') !== String(drag.sourceTabKey || '') ? target : null;
  }

  return { entries, active, crossTarget, handoff };
}
