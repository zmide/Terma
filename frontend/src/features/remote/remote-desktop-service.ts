import type { RemoteProfile } from './profile-model';
import { vncServerReady } from './management-diagnostics';
import {
  clientAvailability,
  normalizedVncClientMode,
  type RemoteClientDiagnostics,
  type RemoteClientItem,
  type RemoteClientMode,
  type RemoteClientProtocol
} from './client-service';

export interface RemoteDesktopPort {
  tr(key: string, params?: Record<string, unknown>): string;
  clientDiagnostics(): Promise<RemoteClientDiagnostics>;
  inspect(profileId: number, protocol: RemoteClientProtocol, button?: HTMLButtonElement): Promise<RemoteClientItem>;
  inspectLinux(profile: RemoteProfile): Promise<RemoteClientItem | null>;
  managementConnectionId(profile: RemoteProfile): number;
}

export interface RemoteDesktopPrepareOptions {
  embeddedVnc: boolean;
  managedRdp: boolean;
  managedVnc: boolean;
  vncClientMode: RemoteClientMode;
  managementConnectionId: number;
}

export interface RemoteDesktopPrepareResult {
  diagnostics: RemoteClientDiagnostics;
  serverState: RemoteClientItem;
  desktopDiagnostics: RemoteClientItem | null;
  item: RemoteClientItem;
  clientLaunchable: boolean;
  launchAllowed: boolean;
  statusAvailable: boolean;
  rdpEndpointReady: boolean;
  vncEndpointBlocked: boolean;
  vncServiceBlocked: boolean;
  vncReadyForLaunch: boolean;
  xdmcpDirectReady: boolean;
  forceLaunchReady: boolean;
  launchReady: boolean;
}

const clientProtocols: RemoteClientProtocol[] = ['rdp', 'vnc'];

function protocolFailure(port: RemoteDesktopPort, protocol: RemoteClientProtocol, error: unknown, connectionId: number): RemoteClientItem {
  const message = error instanceof Error ? error.message : '';
  const code = String((error as { code?: unknown })?.code || '');
  return {
    error: message || port.tr(`remote:${protocol === 'rdp' ? 'rdp_status' : 'vnc_status'}.probe_failed`, {
      defaultValue: `${protocol.toUpperCase()} 服务探测失败`
    }),
    code,
    connectionId
  };
}

export function createRemoteDesktopService(port: RemoteDesktopPort) {
  async function prepare(profile: RemoteProfile, options: RemoteDesktopPrepareOptions): Promise<RemoteDesktopPrepareResult> {
    const protocol = profile.protocol as RemoteClientProtocol;
    const serverStatePromise: Promise<RemoteClientItem> = profile.protocol === 'xdmcp'
      ? port.inspect(Number(profile.id), 'xdmcp').catch(error => protocolFailure(port, 'xdmcp', error, options.managementConnectionId))
      : profile.protocol === 'rdp'
        ? port.inspect(Number(profile.id), 'rdp').catch(error => protocolFailure(port, 'rdp', error, 0))
        : port.inspect(Number(profile.id), 'vnc').catch(error => protocolFailure(port, 'vnc', error, 0));
    const embeddedDiagnostics: RemoteClientDiagnostics = {
      vnc: {
        available: true,
        launchable: true,
        client: port.tr('remote:clients.terma_embedded_vnc', { defaultValue: 'Terma 内置 noVNC' })
      }
    };
    const [diagnostics, serverState, desktopDiagnostics] = await Promise.all([
      options.embeddedVnc
        ? Promise.resolve(embeddedDiagnostics)
        : port.clientDiagnostics(),
      serverStatePromise,
      options.managedVnc && options.managementConnectionId
        ? port.inspectLinux(profile)
        : Promise.resolve(null)
    ]);

    const item = diagnostics[profile.protocol] || {};
    const availability = options.embeddedVnc
      ? { clientLaunchable: true, launchAllowed: true, statusAvailable: true }
      : clientProtocols.includes(protocol)
        ? clientAvailability(protocol, options.vncClientMode, item)
        : { clientLaunchable: Boolean(item.available || item.launchable), launchAllowed: Boolean(item.available || item.launchable), statusAvailable: Boolean(item.available) };
    const vncStatus = String(serverState?.status || '').toLowerCase();
    const endpointProbe = (serverState.endpoint_probe || {}) as { supported?: boolean; ok?: boolean };
    const vncEndpointBlocked = options.managedVnc
      && endpointProbe.supported
      && !endpointProbe.ok;
    const vncServiceBlocked = Boolean(vncEndpointBlocked || (
      options.managedVnc
      && serverState?.diagnostics_available !== false
      && !vncServerReady(serverState)
      && (serverState?.server_session_configurable === true
        || ['not-installed', 'stopped', 'not-listening', 'blocked'].includes(vncStatus))
    ));
    const rdpEndpointReady = !options.managedRdp
      || !endpointProbe.supported
      || Boolean(endpointProbe.ok);
    const vncReadyForLaunch = !options.managedVnc
      || serverState?.diagnostics_available === false
      || !vncServiceBlocked;
    const xdmcpDirectReady = profile.protocol !== 'xdmcp'
      || Boolean(serverState?.ready_for_login)
      || serverState?.management_available === false
      || Boolean(serverState?.error)
      || Boolean(endpointProbe.ok);
    const forceLaunchReady = availability.launchAllowed
      && xdmcpDirectReady
      && rdpEndpointReady
      && (!options.managedVnc || !vncEndpointBlocked);
    const launchReady = availability.launchAllowed
      && xdmcpDirectReady
      && rdpEndpointReady
      && vncReadyForLaunch;
    return {
      diagnostics,
      serverState,
      desktopDiagnostics,
      item,
      clientLaunchable: availability.clientLaunchable,
      launchAllowed: availability.launchAllowed,
      statusAvailable: availability.statusAvailable,
      rdpEndpointReady,
      vncEndpointBlocked: Boolean(vncEndpointBlocked),
      vncServiceBlocked,
      vncReadyForLaunch,
      xdmcpDirectReady,
      forceLaunchReady,
      launchReady
    };
  }

  return { prepare };
}
