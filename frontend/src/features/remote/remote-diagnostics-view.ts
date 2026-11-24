import type {ManagementModel, ManagementOptions} from './RemoteManagementView';
import type {RemoteProfile} from './profile-model';
import type {RemoteGuideProtocol} from './install-guide-service';
import type {
  RemoteManagementDiagnostics, RdpManagementDiagnostics, VncManagementDiagnostics, XdmcpManagementDiagnostics, VncManagementOptions
} from './remote-management-model-service';
import {vncServerReady} from './management-diagnostics';

type State = HTMLElement & {
  _rdpDiagnostics?: RdpManagementDiagnostics;
  _xdmcpDiagnostics?: XdmcpManagementDiagnostics;
  _vncDiagnostics?: VncManagementDiagnostics;
  _vncLastGoodDiagnostics?: VncManagementDiagnostics;
};

export interface RemoteDiagnosticsViewPort {
  tr(key: string, params?: Record<string, unknown>): string;
  profile(id: number): RemoteProfile | undefined;
  authenticationFailure(error: {code?: unknown; message?: unknown}): boolean;
  actionKey(id: number, protocol: RemoteGuideProtocol): string;
  syncActions(key: string): void;
  taskHost(container: HTMLElement, active: boolean): void;
  query(container: HTMLElement, selector: string, fallbackId: string): HTMLElement | null;
  icons(): void;
  model(protocol: RemoteGuideProtocol, diagnostics: RemoteManagementDiagnostics, profile: RemoteProfile, key: string, options?: VncManagementOptions): ManagementModel;
  paint(container: HTMLElement, options: ManagementOptions): void;
}

export function createRemoteDiagnosticsView(port: RemoteDiagnosticsViewPort) {
  function loading(container: HTMLElement | null, protocol: RemoteGuideProtocol) {
    if (!container) return;
    const label = {rdp:'probe_rdp', vnc:'probe_vnc', xdmcp:'probe_graphical_login'}[protocol];
    port.paint(container, {model: () => ({loading: port.tr(`remote:auto.${label}`, {defaultValue:'正在探测远端服务'})})});
  }

  function present(container: HTMLElement, protocol: RemoteGuideProtocol, data: RemoteManagementDiagnostics,
    profile: RemoteProfile, key: string, options?: VncManagementOptions) {
    port.paint(container, {model: () => port.model(protocol, data, profile, key, options)});
  }

  function render(container: HTMLElement | null, protocol: RemoteGuideProtocol, diagnostics: RemoteManagementDiagnostics, id: number, key = `remote-desktop-${id}`) {
    if (!container) return;
    const state: State = container;
    const profile = port.profile(id);
    const launch = port.query(container, '#remoteDesktopLaunchButton', 'remoteDesktopLaunchButton') as HTMLButtonElement | null;
    const view = port.query(container, '#view-remote-desktop', 'view-remote-desktop');
    const available = view?.dataset.remoteClientAvailable === '1';
    const paint = (data: RemoteManagementDiagnostics, options?: VncManagementOptions) => {
      port.taskHost(container, false);
      if (profile) present(container, protocol, data, profile, key, options);
    };
    if (protocol === 'vnc') {
      if (!profile) return;
      const data = diagnostics as VncManagementDiagnostics;
      const operationError = String(data?.error || data?.operation_error || '').trim();
      if (state.dataset.remoteProfileId !== String(id)) delete state._vncLastGoodDiagnostics;
      const lastGood = state._vncLastGoodDiagnostics;
      const authFailure = operationError && port.authenticationFailure({code: data?.code, message: operationError});
      // Keep usable service information for other errors, but surface SSH repair when login fails.
      const effective = operationError && !authFailure && lastGood ? {...lastGood, operation_error: operationError} : data || {};
      if (!operationError && !effective.error) state._vncLastGoodDiagnostics = effective;
      state.dataset.remoteProfileId = String(id);
      state._vncDiagnostics = effective;
      const ready = vncServerReady(effective);
      paint(effective, {preflight: true, showConnect: false, serviceAvailable: ready});
      const blocked = (effective.endpoint_probe?.supported && !effective.endpoint_probe.ok)
        || (effective.diagnostics_available !== false && ((effective.server_session_configurable === true && !ready)
          || ['not-installed', 'stopped', 'not-listening', 'blocked'].includes(String(effective.status || '').toLowerCase())));
      if (launch && !view?.hasAttribute('data-retained-vnc')) launch.disabled = !available || Boolean(blocked);
      port.icons();
    } else if (protocol === 'rdp') {
      const data = diagnostics as RdpManagementDiagnostics;
      state._rdpDiagnostics = data;
      paint(data);
      const endpoint = data?.endpoint_probe;
      const ready = data?.xrdp_installed && data.xrdp_active && data.xrdp_listening;
      if (launch) launch.disabled = !available || (endpoint?.supported ? !endpoint.ok
        : !data?.error && data?.management_available !== false && data?.platform_supported !== false && !ready);
    } else {
      const data = diagnostics as XdmcpManagementDiagnostics;
      state._xdmcpDiagnostics = data;
      paint(data);
      if (launch) {
        launch.disabled = !available || (!data?.error && !data?.ready_for_login);
        const label = !available ? 'remote:xdmcp_status.client_required'
          : data?.error ? 'remote:xdmcp_status.probe_unavailable_launch_anyway'
          : data?.ready_for_login ? 'remote:actions.new_graphical_login' : 'remote:xdmcp_status.not_safe_to_start';
        launch.title = port.tr(label);
      }
    }
    port.syncActions(port.actionKey(id, protocol));
  }

  return {loading, render, present};
}
