import {authenticationFailure, profilePayload, type ProfileDraft, type ProfilePayload, type RemoteProfile} from './profile-model';
export interface RemoteRequest {method?: string; body?: string; signal?: AbortSignal}
export interface RemoteServicePort {
  api(url: string, options?: RemoteRequest): Promise<unknown>;
  tr(key: string, options?: Record<string, unknown>): string;
  notify(message: string, kind: 'success' | 'info' | 'error'): void;
  unlocked(context: string): boolean;
}
export type SaveAction = 'save' | 'close' | 'open' | 'clear';
export interface ProfileEditorPort extends RemoteServicePort {
  defaultGroup: string;
  refreshSaved(id: number, group: string, invalidateVnc: boolean): Promise<void>;
  complete(id: number, action: SaveAction): void;
  localize(message: string): string;
}
export interface SerialPort {path: string; manufacturer?: string; friendly_name?: string}
export function createProfileEditorService(profile: RemoteProfile, draft: () => ProfileDraft, port: ProfileEditorPort, paint: () => void) {
  const state = {saving:false, scanning:false, ports:[] as SerialPort[], error:'', errorKey:''};
  let alive = true, scanVersion = 0;
  const requests = new Set<AbortController>();
  const call = async (url: string, options: RemoteRequest = {}) => {
    const controller = new AbortController(); requests.add(controller);
    try {return await port.api(url, {...options, signal:controller.signal});} finally {requests.delete(controller);}
  };
  async function save(action: SaveAction = 'save') {
    if (!alive || state.saving || !port.unlocked(port.tr('remote:auto.save_connection'))) return false;
    const payload = profilePayload(draft(), profile, port.defaultGroup);
    if (payload.protocol === 'rdp' && payload.options.allow_password_transfer && !payload.clear_password && !payload.username && (payload.password || profile.has_password)) {
      state.errorKey = 'remote:notifications.rdp_username_required'; state.error = port.tr(state.errorKey); paint(); return false;
    }
    state.saving = true; state.error = ''; state.errorKey = ''; paint();
    try {
      const id = Number(profile.id || 0);
      const saved = await call(id ? `/api/remote-profiles/${id}` : '/api/remote-profiles', {method:id ? 'PUT' : 'POST', body:JSON.stringify(payload)}) as {id?: number};
      if (!alive) return false;
      const savedId = Number(id || saved?.id || 0);
      draft().remote_password = ''; draft().remote_clear_password = false;
      await port.refreshSaved(savedId, payload.group_name, payload.protocol === 'vnc' && id > 0 && (payload.clear_password || Boolean(payload.password)));
      if (!alive) return false;
      port.complete(savedId, action);
      if (action === 'save' || action === 'clear') port.notify(port.tr(action === 'clear' && !id ? 'remote:notifications.profile_saved_continue' : 'remote:notifications.profile_saved'), 'success');
      return true;
    } catch (error) {
      if (alive) {state.error = error instanceof Error ? error.message : port.tr('remote:notifications.profile_save_failed'); port.notify(state.error, 'error');}
      return false;
    } finally {payload.password = ''; if (alive) {state.saving = false; paint();}}
  }
  async function scan() {
    if (!alive || state.scanning) return {ports:state.ports};
    const version = ++scanVersion; state.scanning = true; paint();
    try {
      const result = await call('/api/serial/ports') as {available?: boolean; error?: string; ports?: SerialPort[]};
      if (!alive || version !== scanVersion) return {ports:[]};
      state.ports = Array.isArray(result.ports) ? result.ports.filter(item => typeof item.path === 'string') : [];
      if (!result.available) port.notify(result.error ? port.localize(result.error) : port.tr('remote:notifications.serial_unavailable'), 'error');
      else if (!state.ports.length) port.notify(port.tr('remote:notifications.serial_none'), 'info');
      return {ports:state.ports};
    } catch (error) {if (alive && version === scanVersion) port.notify(error instanceof Error ? error.message : port.tr('remote:notifications.serial_unavailable'), 'error'); return {ports:[]};}
    finally {if (alive && version === scanVersion) {state.scanning = false; paint();}}
  }
  return {state, save, scan, dispose() {alive = false; scanVersion++; requests.forEach(request => request.abort()); requests.clear(); draft().remote_password = '';}};
}
export function credentialPayload(profile: RemoteProfile, username: string, password: string, port: number, defaultGroup: string): Omit<ProfilePayload, 'clear_password'> {
  return {protocol:profile.protocol, name:profile.name || '', group_name:profile.group_name || defaultGroup, host:profile.host || '', port, username, password, tags:profile.tags || '', options:{...profile.options}};
}
export interface ProfileTestPort extends RemoteServicePort {
  profile(id: number): RemoteProfile | undefined;
  localize(message: string): string;
  repair(id: number, retry: () => Promise<unknown>, current: () => boolean): Promise<unknown>;
}
export function createProfileTestService(port: ProfileTestPort) {
  const pending = new Map<number, Promise<unknown>>();
  async function execute(id: number, skipRepair: boolean, current: () => boolean): Promise<unknown> {
    try {
      const result = await port.api(`/api/remote-profiles/${id}/test`, {method:'POST', body:'{}'}) as {ok?: boolean; message?: string; reason_code?: string};
      if (!current()) return result;
      const key = result.reason_code === 'vnc_service_ready_authentication_pending' ? 'remote:notifications.vnc_service_ready_authentication_pending'
        : result.reason_code === 'vnc_authenticated_session_required' ? 'remote:notifications.vnc_authenticated_session_required' : '';
      const fallback = port.tr(result.ok ? 'remote:notifications.test_passed' : 'remote:notifications.test_failed');
      port.notify(key ? port.tr(key) : result.message ? port.localize(result.message) : fallback, result.reason_code === 'vnc_authenticated_session_required' ? 'info' : result.ok ? 'success' : 'error');
      return result;
    } catch (error) {
      if (!current()) return null;
      if (!skipRepair && port.profile(id)?.protocol === 'ftp' && authenticationFailure(error, 'ftp')) return port.repair(id, () => execute(id, true, current), current);
      throw error;
    }
  }
  return {test(id: number, skipRepair = false, current: () => boolean = () => true) {
    if (!Number.isSafeInteger(id) || id < 1) return Promise.reject(new Error('Invalid remote profile'));
    if (!current() || !port.unlocked(port.tr('remote:actions.test'))) return Promise.resolve(null);
    const existing = pending.get(id); if (existing) return existing;
    const operation = execute(id, skipRepair, current).finally(() => {pending.delete(id);}); pending.set(id, operation); return operation;
  }};
}
