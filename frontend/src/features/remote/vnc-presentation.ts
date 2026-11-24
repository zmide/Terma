import type {ConnectionStatus} from './remote-desktop-workspace';
import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {VncRfb, VncSession, VncSessionPort} from './vnc-types';
import type {TerminalDisplayMenuAction} from '../terminal/TerminalDisplayMenuView';

export type VncCursorMode = 'auto' | 'show' | 'hide';
const cursorModes = ['auto', 'show', 'hide'] as const;
const isCursorMode = (mode: unknown): mode is VncCursorMode => cursorModes.some(value => value === mode);
const cursorMode = (session: VncSession) => {
  const mode = String(session.profile.options?.cursor_mode || '').trim().toLowerCase();
  return isCursorMode(mode) ? mode : 'auto';
};

function usesFramebufferCursor(session: VncSession) {
  const diagnostics = session.vncServerDiagnostics;
  const platform = String(session.remotePlatform || diagnostics?.platform || diagnostics?.os_id || '').trim().toLowerCase();
  if (!['darwin', 'mac', 'macos', 'osx'].includes(platform)) return false;
  const service = String(diagnostics?.service_unit || '').trim().toLowerCase();
  // Screen Sharing paints the cursor into the framebuffer. A known third-party
  // server can opt out; an unidentified macOS server uses the safe fallback.
  return diagnostics?.builtin !== false || service === 'com.apple.screensharing';
}

export function applyVncDisplay(session: VncSession) {
  const mode = String(session.profile.options?.display_mode || '').trim().toLowerCase();
  const original = mode === 'original', resize = mode === 'resize';
  session.viewport?.classList.toggle('vnc-display-original', original);
  session.viewport?.classList.toggle('vnc-display-resize', resize);
  if (session.rfb) {
    // Keep local scaling when a server does not support remote resize.
    session.rfb.scaleViewport = !original;
    session.rfb.resizeSession = resize;
  }
}

export function hasActiveVncRendering(sessions: Iterable<VncSession>, detached: boolean) {
  if (detached) return true;
  for (const session of sessions) {
    if (session.rfb && (session.connected || session.connecting) && session.presentation === 'viewer'
      && (session.screen.isConnected || session.workspace?.isConnected)) return true;
  }
  return false;
}

type CursorRfb = VncRfb & {_canvas?: HTMLElement; _cursor?: {_canvas?: HTMLElement}};
type PresentationPort = Pick<VncSessionPort, 'tr' | 'notify'> & {
  session(key: string): VncSession | undefined;
  saveCursor(profile: RemoteProfile, mode: VncCursorMode): Promise<RemoteProfile | false>;
  showMenu(event: MouseEvent, actions: TerminalDisplayMenuAction[]): void;
  tabStatus(key: string, state: ConnectionStatus): void;
};

export function createVncPresentation(port: PresentationPort) {
  const t = port.tr;
  const cursorLabel = (mode: VncCursorMode) => t(`remote:auto.mouse_${mode}`);

  function cursor(session: VncSession) {
    const mode = cursorMode(session);
    const hide = mode === 'hide' || (mode === 'auto' && usesFramebufferCursor(session));
    session.screen.classList.toggle('vnc-hide-local-cursor', hide);
    const rfb = session.rfb as CursorRfb | null;
    if (rfb) {
      rfb._canvas?.classList.toggle('vnc-local-cursor-target', hide);
      rfb._cursor?._canvas?.classList.toggle('vnc-local-cursor-overlay-hidden', hide);
      rfb.showDotCursor = !hide;
    }
    const button = session.workspace?.querySelector<HTMLButtonElement>('[data-vnc-cursor-mode]');
    if (!button) return;
    const state = t(hide ? 'navigation:menus.vnc_pointer_hidden' : 'navigation:menus.vnc_pointer_visible');
    const detail = mode === 'auto' ? t('navigation:menus.vnc_mouse_auto_current', {state}) : cursorLabel(mode);
    const label = t('navigation:menus.vnc_mouse_mode_detail', {detail});
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(mode !== 'auto'));
    button.classList.toggle('active', mode !== 'auto');
  }

  function menu(event: MouseEvent, key: string) {
    const owner = port.session(key);
    if (!owner) return;
    const stamp = profileStamp(owner.profile), selected = cursorMode(owner);
    const matches = () => port.session(key) === owner && profileStamp(owner.profile) === stamp;
    const icons = {auto:'sparkles', show:'mouse-pointer-2', hide:'eye-off'};
    const choice = (mode: VncCursorMode): TerminalDisplayMenuAction => ({
      label:cursorLabel(mode), icon:selected === mode ? 'circle-check' : icons[mode],
      run:async () => {
        if (!matches() || mode === selected) return;
        try {
          const saved = await port.saveCursor(owner.profile, mode);
          if (!saved || !matches()) return;
          owner.profile = saved;
          cursor(owner);
          port.notify(t('navigation:menus.vnc_mouse_mode_saved', {detail:cursorLabel(mode)}), 'success');
        } catch (error) {
          if (matches()) port.notify(error instanceof Error ? error.message : t('remote:notifications.profile_save_failed'), 'error');
        }
      }
    });
    port.showMenu(event, [choice('auto'), {separator:true, label:''}, choice('show'), choice('hide')]);
  }

  const connection = (state: string): ConnectionStatus => state === 'connected' || state === 'connecting' ? state : 'disconnected';
  function restoreStatus(session: VncSession, fallback = '') {
    const state = session.statusState || (session.statusText ? '' : 'connecting');
    if (session.status) {
      session.status.textContent = session.statusText || fallback;
      session.status.className = `vnc-status${state ? ' ' + state : ''}`;
    }
    const dot = session.workspace?.querySelector('.terminal-connection-dot');
    const value = connection(state);
    dot?.classList.toggle('connecting', value === 'connecting');
    dot?.classList.toggle('disconnected', value === 'disconnected');
  }
  function paintStatus(session: VncSession, text: string, state: string) {
    session.statusText = text;
    session.statusState = state;
    restoreStatus(session);
    port.tabStatus(session.key, connection(state));
  }

  return {cursor, menu, restoreStatus, paintStatus};
}
