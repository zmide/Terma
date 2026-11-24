import {filesServices} from '@/features/files/installed-services';
export const INTERNAL_DRAG_MIME = 'application/x-terma-sftp';
export interface DragEntry { path: string; name: string; type: string; size: number; mtime: number; metadataKnown: boolean }
export interface DragPayload { connectionId: number; entries: DragEntry[]; sourceTabKey: string; row: null; restoredFromDataTransfer: true }
export interface DragTransfer { types?: ArrayLike<string>; getData?(type: string): string }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export function normalizeDragEntry(value: unknown, fallbackPath = ''): DragEntry | null {
  const item = record(value), path = String(item.path || fallbackPath || '');
  if (!path || path.length > 16384 || path.includes('\0')) return null;
  const name = String(item.name || path.replace(/\/+$/, '').split('/').pop() || path);
  if (name.includes('\0')) return null;
  return { path, name, type: String(item.type || 'file'), size: finite(item.size), mtime: finite(item.mtime), metadataKnown: Boolean(item.metadataKnown) };
}
export function transferTypes(transfer?: DragTransfer | null) { return Array.from(transfer?.types || []).map(type => String(type).toLowerCase()); }
export function hasInternalPayload(transfer?: DragTransfer | null) { return transferTypes(transfer).includes(INTERNAL_DRAG_MIME); }
export function serializeDragPayload(connectionId: number, entries: unknown[], sourceTabKey = '') {
  return JSON.stringify({ connectionId: Number(connectionId), sourceTabKey: String(sourceTabKey), entries: entries.map(item => normalizeDragEntry(item)).filter(Boolean) });
}
export function readDragPayload(transfer?: DragTransfer | null): DragPayload | null {
  if (!hasInternalPayload(transfer) || !transfer?.getData) return null;
  try {
    const raw = transfer.getData(INTERNAL_DRAG_MIME);
    if (!raw || raw.length > 2 * 1024 * 1024) return null;
    const parsed = record(JSON.parse(raw)), connectionId = Number(parsed.connectionId);
    const source = Array.isArray(parsed.entries) ? parsed.entries : Array.isArray(parsed.paths) ? parsed.paths.map(path => ({ path })) : [];
    if (!Number.isSafeInteger(connectionId) || connectionId === 0 || !source.length || source.length > 10000) return null;
    const entries = source.map(item => normalizeDragEntry(item, typeof item === 'string' ? item : ''));
    if (entries.some(item => !item)) return null;
    return { connectionId, entries: entries as DragEntry[], sourceTabKey: String(parsed.sourceTabKey || ''), row: null, restoredFromDataTransfer: true };
  } catch { return null; }
}
export function nativeDragKey(connectionId: number, entries: DragEntry[]) { return `${Number(connectionId)}\0${[...new Set(entries.map(item => item.path).filter(Boolean))].sort((a, b) => a.localeCompare(b)).join('\0')}`; }
export function installDragPayload() { filesServices.termaDragPayload = { normalizeDragEntry, transferTypes, hasInternalPayload, serializeDragPayload, readDragPayload, nativeDragKey }; }


export interface InstalledFeaturesFilesSftpDragPayloadServices {
  termaDragPayload: { normalizeDragEntry: typeof normalizeDragEntry; transferTypes: typeof transferTypes; hasInternalPayload: typeof hasInternalPayload; serializeDragPayload: typeof serializeDragPayload; readDragPayload: typeof readDragPayload; nativeDragKey: typeof nativeDragKey }
}
