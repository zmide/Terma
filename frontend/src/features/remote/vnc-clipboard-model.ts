import type { Translate } from '../operations/operations-types';
import type { VncSession } from './vnc-types';

export const usesSshClipboard = (transport?: string) => String(transport || '').startsWith('ssh-');
export const requiresUnicodeClipboard = (text: string) => /[^\u0000-\u00ff]/.test(text);

export function rfbSupportsUnicodeClipboard(session?: VncSession) {
  const formats = session?.rfb?._clipboardServerCapabilitiesFormats;
  const actions = session?.rfb?._clipboardServerCapabilitiesActions;
  return Boolean(formats?.[1] && actions?.[0x08000000]);
}

export function normalizeVncClipboardText(text: unknown) {
  // A double backslash represents literal source text and must survive.
  return String(text ?? '').replace(/(?<!\\)\\U([0-9a-f]{8})|(?<!\\)\\u([0-9a-f]{4})/gi, (match, digits8, digits4) => {
    const point = Number.parseInt(digits4 ?? digits8, 16);
    return point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

export function supportsClipboardImage(session?: Pick<VncSession, 'clipboardTransport' | 'clipboardBridgeTool'>) {
  if (session?.clipboardTransport === 'ssh-linux-wayland') return session.clipboardBridgeTool === 'wl-clipboard';
  return session?.clipboardTransport === 'ssh-linux-x11' && session.clipboardBridgeTool === 'xclip';
}

interface PresentationPort {
  tr: Translate;
  localize(text: string): string;
  bridgeCandidate(session: VncSession): boolean;
}

export function createVncClipboardModel(port: PresentationPort) {
  const t = (key: string, options?: Record<string, unknown>) => port.tr(`remote:clipboard.${key}`, options);
  function defaultStatus(session: VncSession, helperActive: boolean) {
    if (session.clipboardBridgeError) return { label: t('helper_unavailable'), state: 'error' };
    if (session.clipboardAutoSync) return { label: t(helperActive ? 'auto_sync_ssh' : 'auto_sync'), state: 'active' };
    if (session.clipboardPermissionBlocked) return { label: t('permission_limited'), state: 'error' };
    return { label: t(helperActive ? 'ssh_helper_status' : 'manual'), state: '' };
  }
  function presentation(session: VncSession) {
    const helper = usesSshClipboard(session.clipboardTransport);
    const connection = session.clipboardBridgeConnectionName;
    const problem = port.localize(session.clipboardBridgeError || '');
    const baseline = defaultStatus(session, helper);
    const status = port.localize(session.clipboardStatusText || '') || baseline.label;
    const remoteAvailable = session.remoteClipboardAvailable;
    const bridgeCandidate = remoteAvailable ? false : port.bridgeCandidate(session);
    const images = supportsClipboardImage(session);
    const syncLabel = session.clipboardAutoSync
      ? t(session.clipboardAutoSyncImages ? 'disable_auto_sync_with_images' : 'disable_auto_sync')
      : t(session.clipboardAutoSyncImages ? 'enable_auto_sync_with_images' : 'enable_auto_sync');
    return {
      status,
      state: session.clipboardStatusState || baseline.state,
      hint: t('status_setup_hint', { status: problem || status, connection: connection ? ` · ${connection}` : '' }),
      helper, problem,
      helperLabel: helper ? t('helper_enabled_named', { connection: connection ? `: ${connection}` : '' }) : problem || t('configure_helper'),
      sync: session.clipboardAutoSync, syncLabel,
      receive: remoteAvailable || bridgeCandidate,
      receivePending: Boolean(remoteAvailable && session.remoteClipboardPending),
      receiveLabel: t(remoteAvailable ? 'read_recent_remote' : bridgeCandidate ? 'read_remote_ssh' : 'remote_not_sent'),
      images: images && session.connected,
      sendImageLabel: images ? t('send_local_image') : port.tr('common:x11.clipboard_requires_helper'),
      receiveImageLabel: images ? t('read_remote_image') : port.tr('common:x11.clipboard_requires_helper')
    };
  }
  return { presentation, normalizeText: normalizeVncClipboardText, usesSsh: usesSshClipboard,
    requiresUnicode: requiresUnicodeClipboard, rfbSupportsUnicode: rfbSupportsUnicodeClipboard, supportsImage: supportsClipboardImage };
}
