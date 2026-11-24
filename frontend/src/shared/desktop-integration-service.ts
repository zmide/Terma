import {sharedServices} from '@/shared/installed-services';
import type { EventRegistry } from './actions/event-registry';

export type DesktopIntegrationScope = 'xserver' | 'remote-client';

export interface DesktopIntegrationStatus {
  native_desktop?: boolean;
  desktop_backend_available?: boolean;
  can_request_authorization?: boolean;
  web_session_authenticated?: boolean;
  approved?: boolean;
  authorized?: boolean;
  authorization_kind?: string;
  authorization_browser_session?: boolean;
  authorization_expires_at?: number;
  scopes?: string[];
}

export interface DesktopAuthorizationOptions {
  authorizationMode?: string;
  durationMinutes?: number;
  silent?: boolean;
}

interface DesktopIntegrationPort {
  api(url: string, options?: {method: string; body: string}): Promise<unknown>;
  tr(key: string, params?: Record<string, unknown>): string;
  notify(message: string, kind: 'success' | 'info' | 'error'): void;
}

interface DesktopIntegrationActionPort extends DesktopIntegrationPort {
  busy(button: HTMLButtonElement, busy: boolean, text?: string): void;
  refreshXServer(): unknown;
  refreshProfile(id: number, from: HTMLButtonElement): unknown;
}

export function normalizeDesktopIntegrationScopes(scopes: unknown): DesktopIntegrationScope[] {
  const values = Array.isArray(scopes) ? scopes : [scopes];
  return [...new Set(values.map(value => String(value || '').trim().toLowerCase())
    .filter((value): value is DesktopIntegrationScope => value === 'xserver' || value === 'remote-client'))];
}

export function desktopIntegrationExpiryText(tr: DesktopIntegrationPort['tr'], status?: DesktopIntegrationStatus | null) {
  if (status?.authorization_browser_session) return tr('remote:desktop_authorization.browser_session_expiry');
  const expiresAt = Number(status?.authorization_expires_at || 0);
  if (!expiresAt) return '';
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60000));
  return remaining > 0 ? tr('remote:desktop_authorization.expires_in', {count:remaining}) : tr('remote:desktop_authorization.expired');
}

export function createDesktopIntegrationService(port: DesktopIntegrationPort) {
  let alive = true;
  let cache: DesktopIntegrationStatus | null = null;
  let revision = 0;
  let pendingAuthorization: {key: string; work: Promise<DesktopIntegrationStatus | null>} | undefined;

  function duration(options: DesktopAuthorizationOptions = {}) {
    const authorizationMode = options.authorizationMode === 'browser-session' ? 'browser-session' : 'timed';
    if (authorizationMode === 'browser-session') return {authorizationMode, durationMinutes: 0};
    const durationMinutes = Number(options.durationMinutes ?? 10);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
      throw new Error(port.tr('remote:desktop_authorization.duration_invalid'));
    }
    return {authorizationMode, durationMinutes};
  }

  function authorized(status: DesktopIntegrationStatus, scopes: DesktopIntegrationScope[]) {
    return scopes.length > 0 && Boolean(status.native_desktop || scopes.every(scope => status.scopes?.includes(scope)));
  }

  async function status(force = false): Promise<DesktopIntegrationStatus> {
    if (!alive) return {};
    if (!force && cache) return cache;
    const started = revision;
    const value = await port.api('/api/desktop-integration/status') as DesktopIntegrationStatus;
    if (!alive || started !== revision) return {};
    cache = value;
    return value;
  }

  async function authorize(scopes: DesktopIntegrationScope[], options: DesktopAuthorizationOptions) {
    const selectedDuration = duration(options);
    const started = revision;
    const current = await status(true);
    if (!alive || started !== revision) return null;
    if (authorized(current, scopes)) return current;
    if (!current.desktop_backend_available) {
      if (!options.silent) port.notify(port.tr('remote:desktop_authorization.desktop_unavailable'), 'error');
      return null;
    }
    if (!current.can_request_authorization) {
      const message = current.web_session_authenticated
        ? 'remote:desktop_authorization.local_only'
        : 'remote:desktop_authorization.login_first';
      if (!options.silent) port.notify(port.tr(message), 'error');
      return null;
    }
    const result = await port.api('/api/desktop-integration/authorize', {
      method: 'POST',
      body: JSON.stringify({
        scopes,
        authorization_mode: selectedDuration.authorizationMode,
        duration_minutes: selectedDuration.durationMinutes
      })
    }) as DesktopIntegrationStatus;
    if (!alive || started !== revision) return null;
    cache = result;
    if (!result.approved || !result.authorized || !authorized(result, scopes)) {
      if (!options.silent) port.notify(port.tr('remote:desktop_authorization.not_granted'), 'info');
      return null;
    }
    if (!options.silent) port.notify(selectedDuration.authorizationMode === 'browser-session'
      ? port.tr('remote:desktop_authorization.browser_session_granted')
      : port.tr('remote:desktop_authorization.granted_minutes', {count: selectedDuration.durationMinutes}), 'success');
    return result;
  }

  async function request(scopes: unknown = ['xserver', 'remote-client'], options: DesktopAuthorizationOptions = {}) {
    const normalizedScopes = normalizeDesktopIntegrationScopes(scopes);
    if (!normalizedScopes.length) throw new Error(port.tr('remote:desktop_authorization.no_scopes'));
    duration(options);
    if (!alive) return null;
    const key = JSON.stringify([normalizedScopes.slice().sort(), options.authorizationMode, options.durationMinutes, options.silent]);
    if (pendingAuthorization) {
      if (pendingAuthorization.key === key) return pendingAuthorization.work;
      await pendingAuthorization.work;
      return request(normalizedScopes, options);
    }
    const work = authorize(normalizedScopes, options);
    pendingAuthorization = {key, work};
    try {
      return await work;
    } finally {
      if (pendingAuthorization?.work === work) pendingAuthorization = undefined;
    }
  }

  async function revoke(options: DesktopAuthorizationOptions = {}) {
    if (!alive) return null;
    // Finish a pending confirmation before revoking so it cannot grant after this DELETE.
    const pending = pendingAuthorization?.work;
    if (pending) await pending.catch(() => undefined);
    if (!alive) return null;
    revision += 1;
    cache = null;
    const result = await port.api('/api/desktop-integration/authorize', {method: 'DELETE', body: '{}'});
    if (alive && !options.silent) port.notify(port.tr('remote:desktop_authorization.revoked'), 'success');
    return result;
  }

  async function ensure(scopes: unknown, options: DesktopAuthorizationOptions = {}) {
    const normalizedScopes = normalizeDesktopIntegrationScopes(scopes);
    if (!normalizedScopes.length) throw new Error(port.tr('remote:desktop_authorization.no_scopes'));
    const current = await status(true);
    if (!alive) return false;
    return authorized(current, normalizedScopes) || Boolean(await request(normalizedScopes, options));
  }

  return {
    status, request, revoke, ensure, duration,
    expiryText: (status?: DesktopIntegrationStatus | null) => desktopIntegrationExpiryText(port.tr,status),
    normalizeScopes: normalizeDesktopIntegrationScopes,
    dispose() { alive = false; revision += 1; cache = null; }
  };
}

export function registerDesktopIntegrationActions(port: DesktopIntegrationActionPort, service: ReturnType<typeof createDesktopIntegrationService>, registry: EventRegistry) {
  function selection(button: HTMLButtonElement) {
    const panel = button.closest('.desktop-integration-authorization');
    const value = panel?.querySelector<HTMLSelectElement>('[data-role="desktop-integration-duration"]')?.value || '10';
    if (value === 'browser-session') return service.duration({authorizationMode:value});
    const minutes = value === 'custom' ? panel?.querySelector<HTMLInputElement>('[data-role="desktop-integration-custom-minutes"]')?.value : value;
    return service.duration({durationMinutes:Number(minutes || 0)});
  }
  function refresh(button: HTMLButtonElement) {
    if (!button.isConnected) return;
    const target = button.dataset.refreshTarget;
    if (target === 'xserver') return port.refreshXServer();
    const id = Number(button.dataset.remoteProfileId);
    if (target === 'remote-profile' && Number.isSafeInteger(id) && id > 0) return port.refreshProfile(id,button);
  }
  async function act(element: Element, revoke: boolean) {
    if (!(element instanceof HTMLButtonElement) || !element.isConnected || element.disabled) return;
    const options = revoke ? undefined : selection(element);
    port.busy(element,true,port.tr(revoke ? 'remote:desktop_authorization.revoking' : 'remote:desktop_authorization.waiting_confirmation'));
    try {
      if (revoke) { await service.revoke(); await refresh(element); }
      else if (await service.request(String(element.dataset.scopes || '').split(','),options)) await refresh(element);
    } finally { if (element.isConnected) port.busy(element,false); }
  }
  registry.register('desktop-integration-authorize', ({element}) => act(element,false));
  registry.register('desktop-integration-revoke', ({element}) => act(element,true));
}

export function installDesktopIntegrationService(port:DesktopIntegrationActionPort) {
  const service = sharedServices.termaDesktopIntegration = createDesktopIntegrationService(port);
  if (sharedServices.termaEventRegistry) registerDesktopIntegrationActions(port,service,sharedServices.termaEventRegistry);
  window.addEventListener('beforeunload', service.dispose, {once:true});
}




export interface InstalledSharedDesktopIntegrationServiceServices {
  termaDesktopIntegration: ReturnType<typeof createDesktopIntegrationService>;
}
