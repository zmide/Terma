import {x11Services} from '@/features/x11/installed-services';
import {normalizedVncClientMode, type RemoteClientProtocol} from './client-service';
import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {createRemoteWorkspaceScope} from './remote-workspace-scope';
import type {createRemoteDesktopService} from './remote-desktop-service';
import type {createRemoteDesktopPresentation} from './remote-desktop-presentation';
import type {createRemoteDiagnosticsView} from './remote-diagnostics-view';
import type {VncReservation} from './vnc-window-service';
import type {VncOpenScope,VncSession} from './vnc-types';
import type {
  RemoteDesktopAction, RemoteDesktopLaunchOptions, RemoteDesktopLaunchState, RemoteWorkspaceJumpActions
} from './RemoteDesktopViews';

type WorkspaceView = HTMLElement & {
  __termaRemoteDesktopAuthorizationRefresh?: (id: number) => unknown;
  __termaRemoteDesktopRefresh?: () => void;
};
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
type DesktopProfile = RemoteProfile & {id: number; protocol: RemoteClientProtocol};

export interface DesktopWorkspaceHost {
  profile(id: number): RemoteProfile | undefined;
  select(profile: DesktopProfile, reveal: boolean): void;
  endpoint(profile: RemoteProfile): string;
  metadata(protocol: RemoteClientProtocol): {label: string; icon: string};
  show(profile: DesktopProfile, key: string, updateTab: boolean, status?: ConnectionStatus): void;
  view(): WorkspaceView | null;
  jumpActions(profile: RemoteProfile): RemoteWorkspaceJumpActions | null;
  sharedVnc(profile: RemoteProfile): RemoteProfile | undefined | null;
  quickOpen(): boolean;
  newWindowOnQuickOpen(): boolean;
  edit(id: number): void;
  markDisconnected(key: string): void;
  refreshIcons(): void;
}

interface DesktopWorkspacePort extends DesktopWorkspaceHost {
  tr(key: string, params?: Record<string, unknown>): string;
  scope: ReturnType<typeof createRemoteWorkspaceScope>;
  prepare: ReturnType<typeof createRemoteDesktopService>['prepare'];
  status: ReturnType<typeof createRemoteDesktopPresentation>['status'];
  diagnostics(): Pick<ReturnType<typeof createRemoteDiagnosticsView>, 'render' | 'loading'>;
  managementConnectionId(profile: RemoteProfile): number;
  manageLinuxDesktop(id: number): void;
  render(view: HTMLElement, options: RemoteDesktopLaunchOptions): void;
  update(view: HTMLElement, state: RemoteDesktopLaunchState): void;
  release(container: HTMLElement): void;
  session(key: string): VncSession | undefined;
  showManagement(id: number, key: string): unknown;
  mountVnc(profile: RemoteProfile, key: string): unknown;
  reserve(id: number): VncReservation | null;
  cancel(reservation: VncReservation | null): void;
  detach(id: number, key: string, options?: {closeDetectionTab: boolean; browserReservation: VncReservation | null}): Promise<boolean>;
  openVnc(id: number, key: string, button?: HTMLButtonElement): unknown;
  closeVncSession(key: string): void;
  setBusy(button: HTMLButtonElement, busy: boolean, label?: string): void;
  notify(message: string, kind: 'success'): void;
  launch(id: number, key: string, button?: HTMLButtonElement): unknown;
  install(id: number, protocol: RemoteClientProtocol, button: HTMLButtonElement): unknown;
  inspect(id: number, protocol: RemoteClientProtocol, button: HTMLButtonElement): unknown;
  guide(id: number, protocol: RemoteClientProtocol): unknown;
}

function desktopProfile(profile: RemoteProfile | undefined): profile is DesktopProfile {
  return Boolean(profile && typeof profile.id === 'number' && ['rdp', 'vnc', 'xdmcp'].includes(profile.protocol));
}

function tabStatus(session: VncSession | undefined): ConnectionStatus {
  if (session?.connected || session?.statusState === 'connected') return 'connected';
  if (session?.connecting || session?.statusState === 'connecting') return 'connecting';
  return 'disconnected';
}

export function createRemoteDesktopWorkspace(port: DesktopWorkspacePort) {
  const {tr, scope} = port;
  function retainedState(session: VncSession): RemoteDesktopLaunchState {
    const live = Boolean(session.connected || session.connecting);
    return {
      retainedVnc: true,
      statusClass: live ? 'success' : 'warning',
      statusText: tr(live ? 'remote:vnc_status.embedded_running' : 'remote:vnc_status.embedded_disconnected'),
      actions: {
        remoteDesktopLaunchButton: {disabled: false, label: tr('remote:vnc_status.reenter'), title: tr('remote:vnc_status.reenter_embedded_title')},
        remoteDesktopCloseButton: {hidden: false, disabled: false}
      }
    };
  }
  function captureVncOpen(id: number, key: string): VncOpenScope {
    const view = port.view();
    const owner = view && scope.begin(id, key, view);
    return {
      current: () => !!owner && Boolean(scope.view(owner)),
      showMissingDesktop: profile => {
        if (!view || !owner || !desktopProfile(profile) || profile.id !== id || profile.protocol !== 'vnc') return;
        const stamp = profileStamp(profile), sshId = port.managementConnectionId(profile);
        const owned = () => {
          const current = port.profile(id);
          return !!scope.view(owner) && !!current && profileStamp(current) === stamp;
        };
        const paint = () => scope.paint(owner, target => {
          if (!owned()) return;
          const diagnostics = target.querySelector<HTMLElement>('#vncServerState');
          if (diagnostics) port.release(diagnostics);
          port.render(target, {
            profileId: id, protocol: 'vnc', name: profile.name || '', endpoint: port.endpoint(profile), icon: port.metadata('vnc').icon,
            actions: [
              {id: 'remoteDesktopManageLinuxButton', icon: 'monitor-cog', kind: 'primary', label: tr('remote:diagnostics.open_linux_desktop_manager'),
                onClick: () => {if (owned()) port.manageLinuxDesktop(port.managementConnectionId(profile) === sshId ? sshId : 0);}},
              {id: 'remoteDesktopEditButton', icon: 'settings-2', label: tr('remote:actions.connection_settings'),
                onClick: () => {if (owned()) port.edit(id);}}
            ],
            jumpActions: null, help: tr('remote:management.reopen_after_desktop_install'), authorizationPort: {tr}, showDiagnostics: false,
            state: {statusClass: 'warning', statusText: tr('remote:diagnostics.linux_desktop_missing', {protocol: 'VNC'}), clientAvailable: false}
          });
        });
        view.__termaRemoteDesktopRefresh = paint;
        delete view.__termaRemoteDesktopAuthorizationRefresh;
        paint();
      }
    };
  }
  function render(target: HTMLElement, profile: DesktopProfile, key: string, session: VncSession | undefined,
    embeddedVnc: boolean, usesTigerVnc: boolean, state: RemoteDesktopLaunchState, ownsView: () => boolean) {
    const {protocol, id} = profile;
    const meta = port.metadata(protocol);
    const launch = (button?: HTMLButtonElement) => embeddedVnc ? port.openVnc(id, key, button) : port.launch(id, key, button);
    const launchLabel = protocol === 'xdmcp' ? tr('remote:actions.new_graphical_login')
      : embeddedVnc ? tr('remote:actions.open_embedded_vnc')
        : usesTigerVnc ? tr('remote:actions.open_bundled_tigervnc') : tr('remote:actions.open_client', {protocol: meta.label});
    const button = (event: MouseEvent) => event.currentTarget as HTMLButtonElement;
    const actions: RemoteDesktopAction[] = [{
      id: 'remoteDesktopLaunchButton',
      icon: protocol === 'xdmcp' ? 'panels-top-left' : embeddedVnc || usesTigerVnc ? 'monitor-play' : 'external-link',
      kind: 'primary', label: launchLabel, disabled: true, onClick: event => launch(button(event))
    }];
    if (embeddedVnc) actions.push(
      {id: 'remoteDesktopNewWindowButton', icon: 'panel-top-open', label: tr('remote:vnc_ui.open_new_window'), onClick: () => port.detach(id, key)},
      {id: 'remoteDesktopCloseButton', icon: 'monitor-off', label: tr('common:actions.close_desktop'), hidden: true,
        onClick: async event => {
          const control = button(event);
          if (!ownsView() || !session?.workspace || port.session(key) !== session || control.disabled) return;
          port.setBusy(control, true, tr('remote:vnc_ui.closing'));
          try {
            port.closeVncSession(key);
            port.markDisconnected(key);
            port.notify(tr('remote:vnc_ui.embedded_closed'), 'success');
            return await open(id, false, true);
          } finally {
            if (control.isConnected) port.setBusy(control, false);
          }
        }}
    );
    actions.push(
      {id: 'remoteDesktopInstallButton', icon: 'download', label: tr('remote:auto.install_client'), hidden: true,
        onClick: event => port.install(id, protocol, button(event))},
      {id: 'remoteDesktopXServerButton', icon: 'monitor-up', label: tr('remote:auto.install_xquartz'), hidden: true, onClick: () => x11Services.termaX11.openManager()}
    );
    const sharedVncId = protocol === 'xdmcp' ? port.sharedVnc(profile)?.id : undefined;
    if (sharedVncId) actions.push({icon: 'monitor', label: tr('remote:auto.shared_vnc'), onClick: () => open(sharedVncId)});
    actions.push(
      {id: 'remoteDesktopDetectButton', icon: 'scan-search', label: tr('common:actions.detect_again'), onClick: event => port.inspect(id, protocol, button(event))},
      {id: 'remoteDesktopSetupGuideButton', icon: 'book-open-check', label: tr('remote:auto.setup_guide'), onClick: () => port.guide(id, protocol)},
      {id: 'remoteDesktopEditButton', icon: 'settings-2', label: tr('remote:actions.connection_settings'), onClick: () => port.edit(id)}
    );
    const mode = tr(embeddedVnc ? 'remote:auto.embedded_novnc' : usesTigerVnc ? 'remote:auto.bundled_tigervnc' : 'remote:auto.system');
    port.render(target, {
      profileId: id, protocol, name: profile.name || '', endpoint: port.endpoint(profile), icon: meta.icon, actions,
      jumpActions: port.jumpActions(profile), help: tr(`remote:auto.${protocol}_launch_help`, {mode}),
      state, authorizationPort: {tr}
    });
  }

  async function open(id: number, updateTab = true, showManagement = false, options: {forceLaunch?: boolean} = {}): Promise<unknown> {
    const profile = port.profile(id);
    if (!desktopProfile(profile)) return;
    const {protocol} = profile;
    const key = `remote-desktop-${id}`;
    const vncClientMode = normalizedVncClientMode(profile.options);
    const embeddedVnc = protocol === 'vnc' && vncClientMode === 'embedded';
    const session = protocol === 'vnc' ? port.session(key) : undefined;
    port.select(profile, updateTab);
    port.show(profile, key, updateTab, protocol === 'vnc' ? tabStatus(session) : undefined);
    if (!showManagement && session?.workspace && (session.connected || session.connecting)) {
      return session.presentation === 'management' ? port.showManagement(id, key) : port.mountVnc(profile, key);
    }
    const view = port.view();
    if (!view) return;
    // Reserve the browser window within the initiating click, before any asynchronous probe.
    const reservation = updateTab && !showManagement && embeddedVnc && port.quickOpen() && port.newWindowOnQuickOpen()
      ? port.reserve(id) : null;
    let committed = false;
    const renderScope = scope.begin(id, key, view);
    const stamp = profileStamp(profile);
    const isCurrentProfile = () => {
      const current = port.profile(id);
      return !!current && profileStamp(current) === stamp;
    };
    view.__termaRemoteDesktopAuthorizationRefresh = profileId => profileId === id && isCurrentProfile()
      ? scope.paint(renderScope, () => open(id, false, true)) : undefined;

    const detection = `#${protocol}ServerState`;
    const meta = port.metadata(protocol);
    const usesTigerVnc = protocol === 'vnc' && (vncClientMode === 'bundled' || vncClientMode === 'auto');
    const client = embeddedVnc ? tr('remote:capabilities.embedded_novnc')
      : usesTigerVnc ? tr('remote:capabilities.bundled_tigervnc') : meta.label;
    const ownsView = () => isCurrentProfile() && Boolean(scope.view(renderScope));
    const retained = embeddedVnc && session?.workspace ? session : null;
    if (retained) retained.presentation = 'management';
    const withRetainedState = (patch: RemoteDesktopLaunchState) => {
      if (!retained || port.session(key) !== retained) return patch;
      const current = retainedState(retained);
      return {...patch, ...current, actions: {...patch.actions, ...current.actions}};
    };
    let state = withRetainedState({statusText: tr('remote:auto.check_local_client', {client}), clientAvailable: false});
    const update = (target: HTMLElement, patch: RemoteDesktopLaunchState) => {
      const projected = withRetainedState(patch);
      state = {...state, ...projected, actions: {...state.actions, ...projected.actions}};
      port.update(target, projected);
    };
    let refreshStatus = () => {};
    view.__termaRemoteDesktopRefresh = () => scope.paint(renderScope, target => {
      if (!isCurrentProfile()) return;
      render(target, profile, key, session, embeddedVnc, usesTigerVnc, withRetainedState(state), ownsView);
      refreshStatus();
    });
    render(view, profile, key, session, embeddedVnc, usesTigerVnc, state, ownsView);
    const container = view.querySelector<HTMLElement>(detection);
    if (container) {
      port.release(container);
      port.diagnostics().loading(container, protocol);
    }
    port.refreshIcons();

    try {
      const prepareOptions = {embeddedVnc, managedRdp: protocol === 'rdp', managedVnc: protocol === 'vnc',
        vncClientMode, managementConnectionId: port.managementConnectionId(profile)};
      const result = await port.prepare(profile, prepareOptions);
      await scope.paint(renderScope, async target => {
        if (!isCurrentProfile() || !target.querySelector('#remoteDesktopStatus')) return;
        const scopes = protocol === 'xdmcp' ? ['remote-client', 'xserver'] : ['remote-client'];
        const authorization = embeddedVnc ? null : {
          status: result.diagnostics, scopes, refreshTarget: 'remote-profile', remoteProfileId: id
        };
        refreshStatus = () => {
          const {statusText, statusClass} = port.status(protocol, prepareOptions, result);
          update(target, {statusText, statusClass});
        };
        if (protocol === 'xdmcp' && result.serverState) port.diagnostics().render(target.querySelector(detection), protocol, result.serverState, id, key);
        update(target, {...port.status(protocol, prepareOptions, result), authorization});
        if (protocol !== 'xdmcp' && result.serverState) port.diagnostics().render(target.querySelector(detection), protocol, result.serverState, id, key);
        const shouldLaunch = updateTab && ((port.quickOpen() && result.launchReady) || (options.forceLaunch === true && result.forceLaunchReady));
        if (!shouldLaunch) return;
        if (embeddedVnc && port.newWindowOnQuickOpen()) committed = await port.detach(id, key, {closeDetectionTab: true, browserReservation: reservation});
        else if (embeddedVnc) await port.openVnc(id, key);
        else await port.launch(id, key);
      });
    } catch (error) {
      scope.paint(renderScope, target => {
        if (isCurrentProfile() && target.querySelector('#remoteDesktopStatus')) update(target, {
          statusClass: 'error',
          statusText: error instanceof Error ? error.message : tr('remote:diagnostics.port_probe_failed')
        });
      });
    } finally {
      if (!committed) port.cancel(reservation);
    }
  }
  return {open, captureVncOpen};
}
