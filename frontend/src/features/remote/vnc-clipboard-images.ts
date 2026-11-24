import { errorMessage, type Translate } from '../operations/operations-types';
import { supportsClipboardImage } from './vnc-clipboard-model';
import type { createVncLocalClipboard, VncClipboardSnapshot } from './vnc-local-clipboard';
import type { VncSession } from './vnc-types';

interface ImageState {
  localReading: boolean;
  remoteReading: boolean;
  localHash: string;
  remoteHash: string;
  observedRevision: string;
  deliveredRevision: string;
  writes: number;
  reads: number;
}

interface ImageMetadata { available?: boolean; sha256?: string; too_large?: boolean; bytes?: number; max_bytes?: number }
type ImageRequest = { method?: string; headers?: Record<string, string>; body?: ArrayBuffer; responseType?: 'json' | 'arrayBuffer' };
export interface VncClipboardImageHost {
  tr: Translate;
  api<T>(url: string, options?: ImageRequest): Promise<T>;
  transport(session: VncSession): Promise<string>;
  unavailable(session?: VncSession): string;
  visible(session: VncSession): boolean;
  notify(text: string, kind: 'info' | 'success' | 'error'): void;
  status(session: VncSession, text: string, state: string, timeout?: number): void;
}

interface ImagePort extends VncClipboardImageHost {
  local: ReturnType<typeof createVncLocalClipboard>;
  session(key: string): VncSession | undefined;
  current(session: VncSession): () => boolean;
}

function normalizeHash(hash: unknown) {
  const value = String(hash || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(value) ? value : '';
}

export function createVncClipboardImages(port: ImagePort) {
  const states = new WeakMap<VncSession, ImageState>();
  const t = (key: string, params?: Record<string, unknown>) => port.tr(`remote:clipboard.${key}`, params);
  const path = (session: VncSession) => `/api/remote-profiles/${session.profile.id}/vnc-clipboard/image`;
  const automatic = (session: VncSession) => Boolean(session.clipboardAutoSync && session.clipboardAutoSyncImages
    && !port.unavailable(session) && port.visible(session));

  function stateFor(session: VncSession) {
    let state = states.get(session);
    if (!state) {
      state = { localReading: false, remoteReading: false, localHash: '', remoteHash: '', observedRevision: '',
        deliveredRevision: '', writes: 0, reads: 0 };
      states.set(session, state);
    }
    return state;
  }

  function lease(session: VncSession, state: ImageState) {
    const current = port.current(session);
    const { rfb, clipboardRemoteOperationId } = session;
    return () => current() && states.get(session) === state && session.rfb === rfb
      && session.clipboardRemoteOperationId === clipboardRemoteOperationId && !port.unavailable(session);
  }

  function ready(key: string, announce: boolean) {
    const session = port.session(key);
    const reason = port.unavailable(session);
    if (reason && announce) port.notify(reason, 'info');
    return reason ? undefined : session;
  }

  async function hasTransport(session: VncSession, current: () => boolean, manual = false) {
    if (!current()) return false;
    const clipboardTransport = await port.transport(session);
    if (!current()) return false;
    const available = supportsClipboardImage({ clipboardTransport, clipboardBridgeTool: session.clipboardBridgeTool });
    if (!available && manual) throw new Error(t('image_requires_helper'));
    return available;
  }

  async function dispatchImage(session: VncSession, state: ImageState, current: () => boolean,
    bytes: Uint8Array<ArrayBuffer>, hash: string, announce: boolean) {
    if (!current()) return false;
    const write = ++state.writes;
    const result = await port.api<{sha256?: string}>(path(session), {
      method: 'POST', headers: {'Content-Type': 'image/png'},
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), responseType: 'json'
    });
    if (!current() || write !== state.writes) return false;
    state.localHash = hash;
    state.remoteHash = normalizeHash(result?.sha256) || hash;
    port.status(session, t('image_synced_remote'), 'success', 2600);
    if (announce) port.notify(t('local_image_synced'), 'success');
    return true;
  }

  async function sendBytes(session: VncSession, value: unknown, announce = false) {
    const state = stateFor(session);
    const current = lease(session, state);
    if (!await hasTransport(session, current, true)) return false;
    const bytes = port.local.imageBytes(value);
    const hash = await port.local.imageHash(bytes);
    return dispatchImage(session, state, current, bytes, hash, announce);
  }

  async function send(key: string, announce = false) {
    const session = ready(key, announce);
    if (!session) return false;
    const state = stateFor(session);
    const current = lease(session, state);
    try {
      const bytes = await port.local.readImage();
      if (!current()) return false;
      if (!bytes) {
        if (announce) port.notify(t('local_png_missing'), 'info');
        return false;
      }
      return await sendBytes(session, bytes, announce);
    } catch (error) {
      if (!current()) return false;
      port.status(session, t('image_sync_failed'), 'error');
      if (announce) port.notify(errorMessage(error, t('local_image_send_failed')), 'error');
      return false;
    }
  }

  async function fromLocal(session: VncSession, metadata?: VncClipboardSnapshot) {
    if (!automatic(session)) return false;
    const state = stateFor(session);
    if (state.localReading) return false;
    const owner = lease(session, state);
    const current = () => owner() && automatic(session);
    state.localReading = true;
    try {
      if (!await hasTransport(session, current)) return false;
      const observed = metadata || await port.local.readSnapshot(false);
      if (!current()) return false;
      const revision = state.observedRevision = observed.imageRevision;
      if (!observed.imageAvailable) {
        state.localHash = '';
        state.deliveredRevision = revision;
        return false;
      }
      if (revision && revision === state.deliveredRevision) return false;
      const snapshot = await port.local.readSnapshot(true);
      if (!current()) return false;
      const snapshotRevision = snapshot.imageRevision || revision;
      if (!snapshot.imageAvailable || !snapshot.image) {
        state.localHash = '';
        state.deliveredRevision = snapshotRevision;
        return false;
      }
      const hash = await port.local.imageHash(snapshot.image);
      if (!current()) return false;
      if (hash === state.localHash || hash === state.remoteHash) {
        state.deliveredRevision = snapshotRevision;
        return false;
      }
      const sent = await dispatchImage(session, state, current, snapshot.image, hash, false);
      if (sent) state.deliveredRevision = snapshotRevision;
      return sent;
    } catch (error) {
      if (current()) port.status(session, errorMessage(error, t('image_sync_failed')), 'error', 3200);
      return false;
    } finally { state.localReading = false; }
  }

  async function changedRemoteHash(session: VncSession, state: ImageState, current: () => boolean) {
    const metadata = await port.api<ImageMetadata>(`${path(session)}/metadata`);
    if (!current()) return '';
    if (metadata?.too_large) {
      const size = Math.max(1, Math.ceil(Number(metadata.bytes || metadata.max_bytes || 0) / (1024 * 1024)));
      port.status(session, t('remote_image_too_large', { size }), 'warning');
      return '';
    }
    if (!metadata?.available) {
      state.remoteHash = '';
      return '';
    }
    const hash = normalizeHash(metadata.sha256);
    if (!hash || hash === state.remoteHash) return '';
    if (hash === state.localHash) {
      state.remoteHash = hash;
      return '';
    }
    return hash;
  }

  async function fromRemote(session: VncSession, mode: 'automatic' | 'manual' | 'force', announce = false) {
    const state = stateFor(session);
    const manual = mode === 'manual';
    if ((state.remoteReading && !manual) || (mode === 'automatic' && !automatic(session))) return false;
    const read = ++state.reads;
    const writes = state.writes;
    const owner = lease(session, state);
    const current = () => owner() && read === state.reads && writes === state.writes && (mode !== 'automatic' || automatic(session));
    state.remoteReading = true;
    try {
      if (!await hasTransport(session, current, manual)) return false;
      const expected = manual ? '' : await changedRemoteHash(session, state, current);
      if ((!manual && !expected) || !current()) return false;
      const result = await port.api<{data: ArrayBuffer}>(path(session), { responseType: 'arrayBuffer' });
      if (!current()) return false;
      const bytes = port.local.imageBytes(result.data);
      const hash = await port.local.imageHash(bytes);
      if ((expected && expected !== hash) || !current()) return false;
      await port.local.writeImage(bytes);
      if (!current()) return false;
      state.remoteHash = hash;
      state.localHash = hash;
      port.status(session, t(manual ? 'remote_image_read' : 'image_synced_from_remote'), 'success', 2600);
      if (announce) port.notify(t('remote_image_written'), 'success');
      return true;
    } catch (error) {
      if (!current()) return false;
      if (mode === 'force') throw error;
      if (manual) {
        port.status(session, t('remote_image_read_failed'), 'error');
        if (announce) port.notify(errorMessage(error, t('remote_clipboard_image_failed')), 'error');
      }
      return false;
    } finally { if (read === state.reads) state.remoteReading = false; }
  }

  return {
    send, sendBytes, automatic, fromLocal,
    receive(key: string, announce = false) {
      const session = ready(key, announce);
      return session ? fromRemote(session, 'manual', announce) : Promise.resolve(false);
    },
    poll: (session: VncSession, force = false) => fromRemote(session, force ? 'force' : 'automatic'),
    observe(session: VncSession, snapshot: VncClipboardSnapshot) {
      const state = stateFor(session);
      if (!snapshot.imageAvailable) {
        state.localHash = '';
        state.observedRevision = '';
      } else if (automatic(session) && (!snapshot.imageRevision || snapshot.imageRevision !== state.observedRevision)) {
        void fromLocal(session, snapshot);
      }
    },
    reset(session: VncSession) { states.delete(session); }
  };
}
