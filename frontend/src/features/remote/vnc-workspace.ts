import {remoteServices} from '@/features/remote/installed-services';
import type {RemoteVncWorkspaceOptions} from './RemoteDesktopViews';
import type {createVncPresentation} from './vnc-presentation';
import type {createVncClipboardModel} from './vnc-clipboard-model';
import type {createRemoteDiagnosticsView} from './remote-diagnostics-view';
import type {VncDiagnostics, VncSession, VncSessionPort} from './vnc-types';
import type {ProtocolDiagnostics} from './protocol-service';
import {vncServerReady} from './management-diagnostics';

type VncHelpState = NonNullable<VncSession['helpState']>;
export type VncWorkspaceTarget = HTMLElement & {__termaRemoteDesktopRefresh?: () => void};
type ViewerActions = Omit<RemoteVncWorkspaceOptions['actions'], 'ctrlAltDelete'>;
type Guard = <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => void;
type VncWorkspacePort = Pick<VncSessionPort, 'tr' | 'notify' | 'controls' | 'display' | 'endpoint'> & {
  presentation: Pick<ReturnType<typeof createVncPresentation>, 'cursor' | 'restoreStatus'>;
  clipboard: ReturnType<typeof createVncClipboardModel>['presentation'];
  session(key: string): VncSession | undefined;
  jumpActions: (typeof remoteServices)['termaRemoteDesktop']['relations']['workspaceActions'];
  detached(): boolean;
  activeView(): VncWorkspaceTarget | null;
  renderView(target: HTMLElement, options: RemoteVncWorkspaceOptions): void;
  releaseView(target: HTMLElement): void;
  presentDiagnostics: ReturnType<typeof createRemoteDiagnosticsView>['present'];
  actions(session: VncSession, detached: boolean, guard: Guard): ViewerActions;
  afterHelp(profileId: number): void;
  icons(): void;
};

export function createVncWorkspace(port: VncWorkspacePort) {
  const tracked = new Map<VncSession, () => void>();
  const mountOwners = new WeakMap<HTMLElement, object>();
  const t = (key: string) => port.tr(`remote:vnc_ui.${key}`);
  const connecting = (session: VncSession) => port.tr('remote:vnc_ui.connecting_endpoint', {endpoint:port.endpoint(session.profile)});

  function options(session: VncSession, detached: boolean, active: () => boolean): RemoteVncWorkspaceOptions {
    const {key, profile} = session, clipboard = port.clipboard(session);
    const guard: Guard = action => (...args) => {if (active()) action(...args);};
    return {profileId:Number(profile.id), key, detached, statusLabel:session.statusText || connecting(session),
      clipboardLabel:clipboard.status, clipboardHelperEnabled:true, clipboardSyncEnabled:clipboard.sync,
      clipboardReceiveEnabled:clipboard.receive, clipboardImageEnabled:clipboard.images,
      jumpActions:detached ? null : port.jumpActions(profile),
      labels:{back:t('back_management'), ctrlAltDelete:t('send_ctrl_alt_delete'), clipboardHelper:clipboard.helperLabel,
        clipboardHelperShort:port.tr('remote:clipboard.helper_short'), clipboardSync:clipboard.syncLabel,
        clipboardSend:port.tr('remote:clipboard.send_local'), clipboardSendImage:clipboard.sendImageLabel,
        clipboardReceive:clipboard.receiveLabel, clipboardReceiveImage:clipboard.receiveImageLabel,
        cursorMode:t('cursor_auto'), fullscreen:t('enter_fullscreen'), newWindow:t('open_new_window'),
        closeWindow:t('close_new_window'), serviceManagement:t('service_management'),
        reconnect:port.tr('remote:vnc_status.reconnect'), systemClient:t('use_system_client'),
        settings:port.tr('remote:actions.connection_settings')},
      actions:{...port.actions(session, detached, guard), ctrlAltDelete:guard(() => {
        if (session.rfb) session.rfb.sendCtrlAltDel();
        else port.notify(port.tr('remote:clipboard.vnc_not_connected'), 'info');
      })}};
  }

  function track(session: VncSession) {
    if (tracked.has(session)) return;
    const {screen} = session, mark = () => {session.lastInteractionAt = Date.now();};
    const types = ['pointerdown', 'pointermove', 'wheel', 'keydown'];
    for (const type of types) screen.addEventListener(type, mark, {passive:true});
    tracked.set(session, () => {for (const type of types) screen.removeEventListener(type, mark);});
  }

  function paintHelp(session: VncSession, state: VncHelpState) {
    if (!session.help) return;
    const {diagnostics, serviceAvailable, detail, connectionAttempt} = state;
    port.presentDiagnostics(session.help, 'vnc', diagnostics || {platform:session.remotePlatform}, session.profile, session.key,
      {connectionAttempt, connectionHelp:true, serviceAvailable, detail});
    session.help.hidden = false;
    port.icons();
    port.afterHelp(Number(session.profile.id));
  }

  function showHelp(session: VncSession, available: boolean, detail: string, diagnostics: VncDiagnostics | null, connectionAttempt = true) {
    if (port.session(session.key) !== session) return;
    const state = session.helpState = {serviceAvailable:available, detail, diagnostics, connectionAttempt};
    if (diagnostics) {
      session.vncServerDiagnostics = diagnostics;
      session.remotePlatform = diagnostics.platform || diagnostics.os_id || session.remotePlatform;
      port.presentation.cursor(session);
    }
    paintHelp(session, state);
  }

  function hideHelp(session: VncSession) {
    session.helpState = null;
    if (session.help) {
      session.help.hidden = true;
      port.releaseView(session.help);
      session.help.replaceChildren();
    }
  }

  function managementViewer(key: string) {
    const session = port.session(key);
    if (!session) return undefined;
    const target = session.help;
    return {
      target,
      initial: session.helpState?.diagnostics,
      render(container: HTMLElement | null, diagnostics: ProtocolDiagnostics) {
        if (port.session(key) !== session) return Boolean(target && container === target);
        const data = diagnostics as VncDiagnostics;
        if (target && container === target) {
          if (session.help === target) showHelp(session, vncServerReady(data), '', data, false);
          return true;
        }
        session.vncServerDiagnostics = data;
        session.remotePlatform = data.platform || session.remotePlatform;
        port.presentation.cursor(session);
        return false;
      }
    };
  }

  function render(session: VncSession, target = port.activeView(), detached = port.detached()) {
    if (!target || port.session(session.key) !== session) return;
    const mount = {};
    mountOwners.set(target, mount);
    let owner: HTMLElement | null = null;
    port.renderView(target, options(session, detached, () => port.session(session.key) === session &&
      session.presentation === 'viewer' && mountOwners.get(target) === mount && owner === session.workspace &&
      owner?.dataset.vncKey === session.key && owner.isConnected));
    owner = session.workspace = target.querySelector<HTMLElement>('.vnc-workspace');
    session.viewport = owner?.querySelector<HTMLElement>('#vncViewport');
    if (session.viewport && session.screen.parentElement !== session.viewport) session.viewport.appendChild(session.screen);
    track(session);
    port.display(session);
    port.presentation.cursor(session);
    session.status = owner?.querySelector<HTMLElement>('#vncStatus');
    session.help = session.viewport?.querySelector<HTMLElement>('#vncConnectionHelp') || null;
    if (session.helpState) paintHelp(session, session.helpState);
    port.presentation.restoreStatus(session, connecting(session));
    port.controls(session);
    port.icons();
  }

  function refresh(target = port.activeView(), detached = port.detached()) {
    const workspace = target?.querySelector<HTMLElement>('.vnc-workspace');
    if (!workspace) return target?.__termaRemoteDesktopRefresh?.();
    const session = port.session(workspace.dataset.vncKey || '');
    if (session?.workspace === workspace && session.presentation === 'viewer') render(session, target, detached);
  }

  function release(session: VncSession) {
    tracked.get(session)?.();
    tracked.delete(session);
  }

  return {render, refresh, showHelp, hideHelp, managementViewer, release};
}
