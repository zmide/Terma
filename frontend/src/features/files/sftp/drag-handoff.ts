import {filesServices} from '@/features/files/installed-services';
import { normalizeDragEntry, type DragEntry } from './drag-payload';

interface Handoff {
  connectionId: number;
  entries: DragEntry[];
  sourceTabKey: string;
  row: null;
  handedOffAt: number;
  expiresAt: number;
}
interface Port {
  expired(): void;
  now?(): number;
  schedule?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel?(timer: ReturnType<typeof setTimeout>): void;
}
const TTL = 15_000;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Keeps the source snapshot alive while Chromium hands a pointer drag to native drag. */
export function createDragHandoff(port: Port) {
  let current: Handoff | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const now = () => port.now?.() ?? Date.now();
  const clear = () => {
    if (timer !== null) (port.cancel ?? clearTimeout)(timer);
    timer = null;
    current = null;
  };
  const read = (at = now()) => {
    if (current && current.expiresAt <= at) {
      clear();
      port.expired();
    }
    return current;
  };
  const remember = (value: unknown) => {
    const source = record(value), connectionId = Number(source.connectionId);
    const sourceTabKey = String(source.sourceTabKey || '');
    if (!Number.isSafeInteger(connectionId) || connectionId === 0 || sourceTabKey.length > 16384 || sourceTabKey.includes('\0')) return null;
    if (!Array.isArray(source.entries) || !source.entries.length || source.entries.length > 10000) return null;
    const entries = source.entries.map(item => normalizeDragEntry(item));
    if (entries.some(item => !item)) return null;
    clear();
    const handedOffAt = now();
    const snapshot: Handoff = { connectionId, entries: entries as DragEntry[], sourceTabKey, row: null, handedOffAt, expiresAt: handedOffAt + TTL };
    current = snapshot;
    timer = (port.schedule ?? setTimeout)(() => {
      if (current === snapshot) read();
    }, TTL + 50);
    return snapshot;
  };
  return { read, remember, clear, dispose: clear };
}

export function installDragHandoff() { filesServices.termaDragHandoff = { create: createDragHandoff }; }


export interface InstalledFeaturesFilesSftpDragHandoffServices {
  termaDragHandoff: { create: typeof createDragHandoff }
}
