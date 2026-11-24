import { errorMessage, request, type Api, type Translate } from '../operations/operations-types';
import { normalizeVncClipboardText, requiresUnicodeClipboard, rfbSupportsUnicodeClipboard, usesSshClipboard } from './vnc-clipboard-model';
import type { createVncLocalClipboard, VncClipboardSnapshot } from './vnc-local-clipboard';
import type { VncRfb, VncSession } from './vnc-types';

interface BridgeResult {
  available?: boolean;
  text_available?: boolean;
  text?: string;
  truncated?: boolean;
  max_bytes?: number;
  transport?: string;
  connection_id?: number;
  connection_name?: string;
  tool?: string;
  resolved_by?: string;
  reason?: string;
}

interface EchoGuard { expected: string; previous: string; expires: number; operation?: number }
interface TextState {
  probe?: Promise<string>;
  localReading: boolean;
  remoteReading: boolean;
  writeRevision: number;
  writing: boolean;
  echo?: EchoGuard;
}

export interface VncClipboardTextHost {
  api: Api;
  tr: Translate;
  localize(message: string): string;
  candidate(session: VncSession): boolean;
  visible(session: VncSession): boolean;
  controls(session: VncSession): void;
  status(session: VncSession, text: string, state: string, timeout?: number): void;
  notify(text: string, kind: 'info' | 'success' | 'error'): void;
}

interface TextPort extends VncClipboardTextHost {
  current(session: VncSession): () => boolean;
  local: Pick<ReturnType<typeof createVncLocalClipboard>, 'readSnapshot' | 'writeText'>;
  observe(session: VncSession, snapshot: VncClipboardSnapshot): void;
  stop(session: VncSession): void;
  now(): number;
}

export function createVncClipboardText(port: TextPort) {
  const states = new WeakMap<VncSession, TextState>();
  const t = (key: string, params?: Record<string, unknown>) => port.tr(`remote:clipboard.${key}`, params);
  const path = (session: VncSession) => `/api/remote-profiles/${session.profile.id}/vnc-clipboard`;

  function stateFor(session: VncSession) {
    let state = states.get(session);
    if (!state) {
      state = { localReading: false, remoteReading: false, writeRevision: 0, writing: false };
      states.set(session, state);
    }
    return state;
  }

  function lease(session: VncSession, state: TextState) {
    const current = port.current(session);
    const rfb = session.rfb;
    return () => current() && states.get(session) === state && session.rfb === rfb;
  }

  function unavailable(session?: VncSession) {
    if (!session?.rfb || !session.connected) return t('vnc_not_ready');
    if (session.profile.options?.view_only || session.rfb.viewOnly) return t('view_only_no_send');
    return '';
  }

  function storeRemote(session: VncSession, text: string | undefined, pending = false) {
    session.remoteClipboardBridgeLastSeen = text;
    session.remoteClipboardAvailable = text !== undefined;
    session.remoteClipboardPending = pending;
    session.remoteClipboardText = text ?? '';
  }

  function updateTransport(session: VncSession, result?: BridgeResult) {
    const available = Boolean(result?.available && usesSshClipboard(result.transport));
    session.clipboardTransport = available ? result?.transport : 'rfb';
    session.clipboardBridgeConnectionId = Number(result?.connection_id || (available ? 0 : session.clipboardBridgeConnectionId) || 0);
    session.clipboardBridgeConnectionName = result?.connection_name || (available ? '' : session.clipboardBridgeConnectionName) || '';
    session.clipboardBridgeTool = result?.tool || (available ? '' : session.clipboardBridgeTool) || '';
    session.clipboardBridgeResolvedBy = result?.resolved_by || (available ? '' : session.clipboardBridgeResolvedBy) || '';
    session.clipboardBridgeError = available ? '' : port.localize(result?.reason ?? '') || t('channel_unavailable');
    if (available) storeRemote(session, result?.text_available === false ? undefined : normalizeVncClipboardText(result?.text));
  }

  function transport(session: VncSession) {
    if (session.clipboardTransportChecked) return Promise.resolve(session.clipboardTransport || 'rfb');
    const state = stateFor(session);
    if (state.probe) return state.probe;
    if (!port.candidate(session)) {
      session.clipboardTransportChecked = true;
      session.clipboardTransport = 'rfb';
      return Promise.resolve('rfb');
    }
    const current = lease(session, state);
    const probe = async () => {
      try {
        const result = await request<BridgeResult>(port.api, path(session));
        if (!current()) return 'rfb';
        // The helper dialog can resolve the channel while discovery is in flight.
        if (!session.clipboardTransportChecked) updateTransport(session, result);
      } catch (error) {
        if (!current()) return 'rfb';
        if (!session.clipboardTransportChecked) {
          session.clipboardTransport = 'rfb';
          session.clipboardBridgeError = errorMessage(error, t('channel_unavailable'));
        }
      } finally {
        state.probe = undefined;
        if (current()) {
          session.clipboardTransportChecked = true;
          port.controls(session);
        }
      }
      return session.clipboardTransport || 'rfb';
    };
    state.probe = probe();
    return state.probe;
  }

  async function writeBridge(session: VncSession, state: TextState, value: string, announce: boolean) {
    const previous = normalizeVncClipboardText(session.remoteClipboardBridgeLastSeen ?? session.remoteClipboardText);
    const revision = ++state.writeRevision;
    const operation = session.clipboardRemoteOperationId;
    const current = lease(session, state);
    const relevant = () => current() && session.connected && state.writeRevision === revision
      && session.clipboardRemoteOperationId === operation;
    state.writing = true;
    try {
      await port.api(path(session), {method: 'POST', body: JSON.stringify({text: value})});
      if (!relevant()) return false;
      state.echo = {expected: value, previous, operation, expires: port.now() + 3000};
      storeRemote(session, value);
      return true;
    } catch (error) {
      if (relevant()) {
        port.status(session, t('ssh_sync_failed'), 'error');
        if (announce) port.notify(errorMessage(error, t('remote_write_failed')), 'error');
      }
      return false;
    } finally {
      if (state.writeRevision === revision) state.writing = false;
    }
  }

  function writeRfb(session: VncSession, value: string, announce: boolean) {
    if (requiresUnicodeClipboard(value) && !rfbSupportsUnicodeClipboard(session)) {
      session.clipboardPendingUnicodeText = value;
      const detail = port.localize(session.clipboardBridgeError ?? '') || t('unicode_not_negotiated');
      port.status(session, t('unicode_requires_ssh'), 'error');
      if (announce) port.notify(t('click_error_status', {detail}), 'error');
      return false;
    }
    session.rfb?.clipboardPasteFrom(value);
    return true;
  }

  async function send(session: VncSession, value: string, announce = false, allowed = () => true) {
    const reason = unavailable(session);
    if (reason) {
      if (announce) port.notify(reason, 'info');
      return false;
    }
    const state = stateFor(session);
    const current = lease(session, state);
    const viaSsh = usesSshClipboard(await transport(session));
    if (!current() || !allowed() || unavailable(session)) return false;
    const sent = viaSsh ? await writeBridge(session, state, value, announce) : writeRfb(session, value, announce);
    if (!sent || !current()) return false;
    session.clipboardLastSeenLocal = value;
    session.clipboardLastSentText = value;
    port.status(session, t(viaSsh ? 'synced_remote' : 'sent_unconfirmed'), viaSsh ? 'success' : 'warning', 2200);
    if (announce) port.notify(t(viaSsh ? 'local_synced_ssh' : 'local_sent_vnc'), viaSsh ? 'success' : 'info');
    return true;
  }

  function permissionFailed(session: VncSession, error: unknown) {
    if (!/notallowed|denied|permission|权限|不支持|unavailable/i.test(errorMessage(error, String(error)))) return;
    session.clipboardAutoSync = false;
    session.clipboardPermissionBlocked = true;
    port.stop(session);
    port.status(session, t('permission_limited'), 'error');
    if (!session.clipboardPermissionNoticeShown) {
      session.clipboardPermissionNoticeShown = true;
      port.notify(t('auto_read_failed_manual'), 'info');
    }
  }

  async function fromLocal(session: VncSession, scheduled = () => true) {
    const state = stateFor(session);
    const enabled = () => scheduled() && session.clipboardAutoSync && port.visible(session) && !unavailable(session);
    if (!enabled() || state.localReading) return false;
    const current = lease(session, state);
    state.localReading = true;
    try {
      const snapshot = await port.local.readSnapshot(false);
      if (!current() || !enabled()) return false;
      port.observe(session, snapshot);
      if (snapshot.imageAvailable || !snapshot.textAvailable || snapshot.text === session.clipboardLastSeenLocal
        || (session.remoteClipboardAvailable && snapshot.text === session.remoteClipboardText)) return false;
      return await send(session, snapshot.text, false, enabled);
    } catch (error) {
      if (current() && enabled()) permissionFailed(session, error);
      return false;
    } finally {
      state.localReading = false;
    }
  }

  async function fromRemote(session: VncSession, rfb: VncRfb, value: string) {
    const current = lease(session, stateFor(session));
    if (!current() || !session.connected || session.rfb !== rfb) return;
    const operation = (session.clipboardRemoteOperationId ?? 0) + 1;
    session.clipboardRemoteOperationId = operation;
    if (usesSshClipboard(session.clipboardTransport)) storeRemote(session, value, true);
    else {
      session.remoteClipboardAvailable = true;
      session.remoteClipboardPending = true;
      session.remoteClipboardText = value;
    }
    port.controls(session);
    const manual = () => port.status(session, t('remote_received_click'), 'warning');
    if (!session.clipboardAutoSync || !port.visible(session)) {
      manual();
      return;
    }
    const relevant = () => current() && session.connected && session.clipboardRemoteOperationId === operation;
    try {
      await port.local.writeText(value, false);
      if (!relevant()) return;
      session.clipboardLastSeenLocal = value;
      session.remoteClipboardPending = false;
      session.clipboardPermissionBlocked = false;
      port.status(session, t('synced_from_remote'), 'success', 2200);
    } catch {
      if (!relevant()) return;
      manual();
      if (!session.clipboardRemoteWriteNoticeShown) {
        session.clipboardRemoteWriteNoticeShown = true;
        port.notify(t('remote_received_manual_read'), 'info');
      }
    }
  }

  function shouldDeliver(session: VncSession, state: TextState, value: string) {
    const echo = state.echo;
    if (echo && echo.operation === session.clipboardRemoteOperationId && echo.expires > port.now()) {
      if (value === echo.previous && value !== echo.expected) return false;
      if (value === echo.expected) {
        state.echo = undefined;
        storeRemote(session, value);
        port.controls(session);
        return false;
      }
    }
    state.echo = undefined;
    if (value === session.remoteClipboardBridgeLastSeen) return false;
    if (value !== session.clipboardLastSentText) return true;
    storeRemote(session, value);
    port.controls(session);
    return false;
  }

  async function poll(session: VncSession, force = false, scheduled = () => true) {
    const state = stateFor(session);
    const enabled = () => session.connected && (force || (scheduled() && session.clipboardAutoSync && port.visible(session)));
    if (!enabled() || state.remoteReading || state.writing) return false;
    const current = lease(session, state);
    const rfb = session.rfb;
    state.remoteReading = true;
    const revision = state.writeRevision;
    const operation = session.clipboardRemoteOperationId;
    const relevant = () => enabled() && current() && !state.writing && state.writeRevision === revision
      && session.clipboardRemoteOperationId === operation;
    try {
      if (!usesSshClipboard(await transport(session)) || !relevant() || !rfb) return false;
      const result = await request<BridgeResult>(port.api, path(session));
      if (!relevant()) return false;
      if (result?.truncated) {
        port.status(session, t('remote_too_large', {size: Math.round(Number(result.max_bytes || 0) / 1024)}), 'warning');
        return false;
      }
      if (result?.text_available === false) {
        storeRemote(session, undefined);
        port.controls(session);
        return false;
      }
      const value = normalizeVncClipboardText(result?.text);
      if (!shouldDeliver(session, state, value)) return false;
      await fromRemote(session, rfb, value);
      return true;
    } catch (error) {
      if (!relevant()) return false;
      session.clipboardBridgeError = errorMessage(error, t('remote_read_failed'));
      if (force) throw error;
      return false;
    } finally {
      state.remoteReading = false;
    }
  }

  async function event(session: VncSession, rfb: VncRfb, text: string) {
    const current = lease(session, stateFor(session));
    if (!current() || session.rfb !== rfb || !session.connected) return false;
    const viaSsh = usesSshClipboard(await transport(session));
    if (!current() || !session.connected) return false;
    if (viaSsh) return poll(session, true).catch(() => false);
    await fromRemote(session, rfb, normalizeVncClipboardText(text));
    return true;
  }

  function reset(session: VncSession) {
    states.delete(session);
    session.clipboardTransport = 'rfb';
    session.clipboardTransportChecked = false;
    session.clipboardBridgeError = '';
    session.clipboardBridgeConnectionId = 0;
    session.clipboardBridgeConnectionName = '';
    session.clipboardBridgeTool = '';
    session.clipboardBridgeResolvedBy = '';
    session.remoteClipboardBridgeLastSeen = undefined;
  }

  return {transport, unavailable, send, fromLocal, fromRemote, poll, event, reset};
}
