import type { RemoteProfile, RemoteProtocol } from './profile-model';

export type RemoteClientMode = 'auto' | 'bundled' | 'embedded' | 'system';
export type RemoteClientProtocol = Extract<RemoteProtocol, 'rdp' | 'vnc' | 'xdmcp'>;
export interface RemoteClientItem { [key: string]: unknown }
export interface RemoteClientDiagnostics { [key: string]: RemoteClientItem | undefined }
export interface RemoteClientRequest { method?: string; body?: string; signal?: AbortSignal }

export interface RemoteClientPort {
  api(url: string, options?: RemoteClientRequest): Promise<unknown>;
  tr(key: string, params?: Record<string, unknown>): string;
  notify(message: string, kind: 'success' | 'info' | 'error'): void;
  ensureAuthorized(scopes: string[]): Promise<boolean>;
  setBusy(button: HTMLElement | null, busy: boolean, label?: string): void;
  profile(id: number): RemoteProfile | undefined;
  reopen(id: number): Promise<unknown> | unknown;
}

export interface RemoteClientAvailability {
  launchAllowed: boolean;
  statusAvailable: boolean;
  clientLaunchable: boolean;
}

export function normalizedVncClientMode(options: Record<string, unknown> = {}): RemoteClientMode {
  const mode = options.client_mode;
  return mode === 'auto' || mode === 'bundled' || mode === 'embedded' || mode === 'system' ? mode : 'embedded';
}

export function clientAvailability(protocol: RemoteClientProtocol, mode: RemoteClientMode, item: RemoteClientItem = {}): RemoteClientAvailability {
  const clientLaunchable = Boolean(item.available || item.launchable);
  const explicitSystem = protocol === 'vnc' && mode === 'system';
  const explicitBundled = protocol === 'vnc' && mode === 'bundled';
  const launchAllowed = protocol === 'vnc' && mode === 'embedded'
    ? true
    : protocol === 'vnc' && mode === 'auto'
      ? true
      : explicitBundled
        ? Boolean(item.bundled_available)
        : explicitSystem
          ? Object.prototype.hasOwnProperty.call(item, 'system_available') ? Boolean(item.system_available) : clientLaunchable
          : clientLaunchable;
  const statusAvailable = explicitBundled
    ? Boolean(item.bundled_available)
    : explicitSystem
      ? Object.prototype.hasOwnProperty.call(item, 'system_available') ? Boolean(item.system_available) : clientLaunchable
      : Boolean(item.available);
  return { launchAllowed, statusAvailable, clientLaunchable };
}

export function createRemoteClientService(port: RemoteClientPort) {
  let alive = true;
  let pendingDiagnostics: Promise<RemoteClientDiagnostics> | undefined;

  function diagnostics(): Promise<RemoteClientDiagnostics> {
    if (!alive) return Promise.resolve({});
    if (!pendingDiagnostics) {
      pendingDiagnostics = port.api('/api/remote-clients/diagnostics')
        .then(value => value && typeof value === 'object' ? value as RemoteClientDiagnostics : {})
        .finally(() => { pendingDiagnostics = undefined; });
    }
    return pendingDiagnostics;
  }

  async function install(profileId: number, protocol: RemoteClientProtocol, button: HTMLElement | null = null) {
    const profile = port.profile(profileId);
    if (!alive || !profile || profile.protocol !== protocol) return null;
    port.setBusy(button, true, port.tr('remote:clients.processing', { defaultValue: '处理中...' }));
    try {
      const scopes = protocol === 'xdmcp' ? ['remote-client', 'xserver'] : ['remote-client'];
      if (!await port.ensureAuthorized(scopes)) return null;
      const result = await port.api(
        protocol === 'xdmcp' ? '/api/xserver/install' : '/api/remote-clients/install',
        { method: 'POST', body: protocol === 'xdmcp' ? '{}' : JSON.stringify({ protocol }) }
      ) as { opened?: boolean; target?: string };
      if (result.opened) {
        port.notify(port.tr('remote:clients.download_page_opened', {
          target: result.target || port.tr('remote:clients.download_page', { defaultValue: '客户端下载页面' }),
          defaultValue: `已打开 ${result.target || '客户端下载页面'}，安装完成后返回 Terma 重新检测`
        }), 'info');
        return result;
      }
      if (protocol === 'xdmcp') await port.api('/api/xserver', { method: 'POST', body: '{}' });
      port.notify(port.tr('remote:clients.installed', { protocol: protocol.toUpperCase(), defaultValue: `${protocol.toUpperCase()} 客户端已安装` }), 'success');
      await port.reopen(profileId);
      return result;
    } catch (error) {
      port.notify(error instanceof Error ? error.message : port.tr('remote:clients.install_failed', { defaultValue: '客户端安装失败' }), 'error');
      return null;
    } finally {
      port.setBusy(button, false);
    }
  }

  return { diagnostics, install, dispose() { alive = false; pendingDiagnostics = undefined; } };
}
