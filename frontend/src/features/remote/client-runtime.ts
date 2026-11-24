import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {$} from '@/shared/workspace-dom';
import { createRemoteClientService, clientAvailability, normalizedVncClientMode, type RemoteClientProtocol, type RemoteClientMode } from './client-service';
import { createRemoteLaunchService, type RemoteLaunchPort } from './launch-service';
import { remoteManagementHost } from './remote-host';



const clientPort: RemoteLaunchPort = {
  api: remoteManagementHost.api, tr: remoteManagementHost.tr, notify: remoteManagementHost.notify,
  profile: remoteManagementHost.profile,
  ensureAuthorized: scopes => sharedServices.termaDesktopIntegration.ensure(scopes),
  setBusy: (button, busy, label) => sharedServices.termaUiActions.setButtonBusy(button, busy, label),
  reopen: id => remoteServices.termaRemoteDesktop.open(id, false),
  clientReason: (item, diagnostics, protocol) => remoteServices.termaRemoteDesktop.presentation.reason(item, diagnostics, protocol),
  setStatus(state, message) {
    const status = $('remoteDesktopStatus');
    if (!status) return;
    status.className = `connection-test-status ${state}`;
    status.textContent = message;
  },
  managementConnectionId: profile => remoteServices.termaRemoteManagement.connectionId(profile),
  readXdmcp: id => remoteManagementHost.api(`/api/remote-profiles/${Number(id)}/xdmcp/server`) as ReturnType<RemoteLaunchPort['readXdmcp']>,
  cleanupXdmcp: id => remoteServices.termaRemoteManagement.protocol.operate(id, 'xdmcp', 'cleanup-sessions')
};

export function installRemoteClientRuntime() {
  let feature: ReturnType<typeof createRemoteClientService> | undefined;
  let launcher: ReturnType<typeof createRemoteLaunchService> | undefined;
  const current = () => feature ||= createRemoteClientService(clientPort);
  const currentLauncher = () => launcher ||= createRemoteLaunchService(clientPort, current());
  remoteServices.termaRemoteClients = {
    diagnostics: () => current().diagnostics(),
    install: (id, protocol, button) => current().install(id, protocol, button),
    launch: (id, key, button, clientModeOverride, temporaryCredentials) => currentLauncher().launch(id, key, button, clientModeOverride, temporaryCredentials),
    clientAvailability,
    normalizedVncClientMode,
    dispose: () => {
      launcher?.dispose();
      feature?.dispose();
    }
  };
  window.addEventListener('beforeunload', () => {
    launcher?.dispose();
    feature?.dispose();
  }, { once: true });
}



export interface InstalledFeaturesRemoteClientRuntimeServices {
  termaRemoteClients: {
      diagnostics(): Promise<import('./client-service').RemoteClientDiagnostics>;
      install(id: number, protocol: RemoteClientProtocol, button?: HTMLElement | null): Promise<unknown>;
      launch(id: number, key?: string, button?: HTMLElement | null, clientModeOverride?: string, temporaryCredentials?: Record<string, unknown>): Promise<unknown>;
      clientAvailability: typeof clientAvailability;
      normalizedVncClientMode(options?: Record<string, unknown>): RemoteClientMode;
      dispose(): void;
    };
}
