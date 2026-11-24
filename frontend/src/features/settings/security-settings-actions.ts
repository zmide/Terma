import {settingsServices} from '@/features/settings/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {beginUiAction,endUiAction} from '@/shared/ui-action-service';
import {applicationState} from '@/shared/application-state';
import { confirmModal, inputModal } from '@/shared/workspace-prompts';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';

type Translate = (key:string, options?:Record<string,unknown>) => string;
type Settings = {
  token_set?:boolean; encryption_enabled?:boolean; encryption_ready?:boolean;
  local_direct_desktop_integration_enabled?:boolean;trusted_proxy_enabled?:boolean;
  local_direct_desktop_integration?:{actual_listen_hosts?:string[];listen_loopback_only?:boolean;direct_loopback_request?:boolean;web_access_authorized?:boolean};
};
type Preview = {enabled:boolean;trustedProxyEnabled:boolean};
type EncryptionResult = {removed_snapshots?:number;encrypted_rows?:number;decrypted_rows?:number;key_rotated?:boolean;transition_rows?:number};

const securityPath = '/api/security';
const previewId = 'securityLocalDirectDesktopIntegrationState';
const previews = new WeakMap<HTMLElement,Preview>();

let securityRead = 0;
export async function loadSecuritySettings() {
  const read = ++securityRead;
  const before = applicationState.securitySettings;
  const result = await api<Settings>(securityPath);
  if (read === securityRead && before === applicationState.securitySettings) applicationState.securitySettings = result;
  return result;
}

export function securityIntegrationPresentation(view: HTMLElement | null, settings: Settings, tr: Translate) {
  const overrides = view ? previews.get(view) : undefined;
  const status = settings.local_direct_desktop_integration || {};
  const enabled = overrides?.enabled ?? settings.local_direct_desktop_integration_enabled;
  const trustedProxyEnabled = overrides?.trustedProxyEnabled ?? settings.trusted_proxy_enabled;
  const make = (className:string, key:string, vars?:Record<string,unknown>) => ({className,text:tr(`settings:security.desktop_integration_${key}`,vars)});
  if (!enabled) return make('', 'disabled');
  if (trustedProxyEnabled) return make('warning', 'proxy');
  if (status.listen_loopback_only === false) {
    const hosts = Array.isArray(status.actual_listen_hosts) ? status.actual_listen_hosts : [];
    return make('warning', 'non_loopback',{hosts:hosts.length ? ` (${hosts.join(', ')})` : ''});
  }
  if (status.direct_loopback_request === false) return make('warning', 'not_direct');
  if (status.web_access_authorized === false) return make('warning', 'login_required');
  return make('success', 'active');
}

function form(view: HTMLElement) {
  const field = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(id:string) => view.querySelector<T>(`#${id}`);
  const value = (id:string) => field(id)?.value ?? '';
  const integer = (id:string) => Number(value(id));
  const words = (id:string) => value(id).split(/[\s,]+/).filter(Boolean);
  const checked = (id:string) => field(id)?.checked === true;
  return {field,value,integer,words,checked};
}

export function updateSecurityIntegrationPreview(event: Event) {
  const view = (event.currentTarget as HTMLElement).closest<HTMLElement>('#view-settings');
  if (!view) return;
  const {checked} = form(view);
  previews.set(view,{enabled:checked('securityLocalDirectDesktopIntegration'),trustedProxyEnabled:checked('securityTrustedProxyEnabled')});
  settingsServices.termaRefreshVueSettings?.(view,previewId);
}

type Action = 'policy'|'session'|'password'|'token'|'enable'|'unlock'|'disable'|'logout';

function updateSecurity(body: object, path = securityPath, method = 'PUT') {
  return api<Settings>(path,{method,body:JSON.stringify(body)});
}

async function savePolicy(view: HTMLElement, tr: Translate) {
  const {field,value,integer,words,checked} = form(view);
  const auth_mode = value('securityAuthMode');
  if (!['off','lan','always'].includes(auth_mode)) return false;
  const body = {auth_mode,lan_auth_enabled:auth_mode !== 'off',secure_cookie_mode:value('securitySecureCookieMode') || 'auto',
    origin_protocol_check_enabled:field('securityOriginProtocolCheck')?.checked !== false,
    trusted_proxy_enabled:checked('securityTrustedProxyEnabled'),trusted_proxy_addresses:words('securityTrustedProxyAddresses'),
    local_direct_desktop_integration_enabled:checked('securityLocalDirectDesktopIntegration'),allowed_hosts:words('securityAllowedHosts'),
    login_max_failures:integer('securityLoginMaxFailures'),login_window_seconds:integer('securityLoginWindowSeconds'),login_lock_seconds:integer('securityLoginLockSeconds'),
    global_login_protection_enabled:checked('securityGlobalLoginProtectionEnabled'),global_login_max_failures:integer('securityGlobalLoginMaxFailures'),
    global_login_window_seconds:integer('securityGlobalLoginWindowSeconds'),global_login_lock_seconds:integer('securityGlobalLoginLockSeconds')};
  const confirm_unsafe = auth_mode === 'off' && await confirmModal(tr('settings:security.disable_lan_password_confirm'),tr('settings:auto.high_risk'),
    tr('settings:security.confirm_disable'),tr('common:actions.cancel'),true);
  if (auth_mode === 'off' && (!confirm_unsafe || !view.isConnected)) return false;
  applicationState.securitySettings = await updateSecurity({...body,confirm_unsafe});
  return true;
}

async function changeEncryption(action: 'enable'|'unlock'|'disable', view:HTMLElement, tr:Translate) {
  const control = form(view).field('securityMasterPassword');
  const password = control?.value ?? '';
  if (action === 'disable') {
    if (applicationState.securitySettings?.encryption_enabled && !password) throw Error(tr('settings:security.master_password_required'));
    if (!await confirmModal(tr('settings:security.disable_encryption_confirm'),tr('settings:security.disable_encryption_title'),
      tr('settings:security.decrypt_disable'),tr('common:actions.cancel'),true) || !view.isConnected) return '';
  }
  const result = await api<EncryptionResult>(`${securityPath}/encryption/${action}`,{method:'POST',body:JSON.stringify({password})});
  if (control?.value === password) control.value = '';
  await loadSecuritySettings();
  if (action === 'unlock') return tr(result.key_rotated ? 'settings:security.encryption_rotated' : result.transition_rows ?
    'settings:security.encryption_repaired' : 'settings:security.encryption_unlocked',{rows:result.transition_rows || 0});
  const snapshots = result.removed_snapshots ? tr('settings:security.snapshots_removed',{count:result.removed_snapshots}) : '';
  return action === 'enable' ? tr('settings:security.encryption_enabled',{rows:result.encrypted_rows || 0,snapshots})
    : tr('settings:security.encryption_disabled',{rows:result.decrypted_rows || 0,snapshots});
}

export async function runSecuritySettingsAction(action: Action, event: MouseEvent, tr: Translate) {
  const button = event.currentTarget as HTMLElement;
  const view = button.closest<HTMLElement>('#view-settings');
  const key = 'settings:security:save';
  if (!view || !beginUiAction(key,button,() => tr('settings:auto.saving'))) return;
  const repaint = () => { if (view.isConnected) settingsServices.termaRefreshVueSettings?.(view); };
  try {
    let message = '';
    if (action === 'policy') {
      if (!await savePolicy(view,tr)) return;
      message = tr('settings:security.policy_saved');
    } else if (action === 'session') {
      const {integer} = form(view);
      applicationState.securitySettings = await updateSecurity({session_ttl_minutes:integer('securitySessionTtlMinutes'),
        session_max_sessions:integer('securitySessionMaxSessions'),session_cleanup_minutes:integer('securitySessionCleanupMinutes')});
      message = tr('settings:security.session_saved');
    } else if (action === 'password') {
      const control = form(view).field('securityPassword');
      const password = control?.value ?? '';
      applicationState.securitySettings = await updateSecurity({password},`${securityPath}/password`,'POST');
      if (control?.value === password) control.value = '';
      message = tr('settings:auto.web_password_saved');
    } else if (action === 'token') {
      if (applicationState.securitySettings?.token_set && (!await confirmModal(tr('settings:security.regenerate_token_confirm'),tr('settings:auto.regenerate_token'),
        tr('settings:security.continue'),tr('common:actions.cancel'),true) || !view.isConnected)) return;
      const {token, ...settings} = await api<Settings & {token?:string}>(`${securityPath}/token`,{method:'POST',body:'{}'});
      applicationState.securitySettings = settings;
      repaint();
      if (view.isConnected && token) await inputModal(tr('settings:auto.token_once'),tr('settings:auto.token_save'),token);
      message = tr('settings:auto.token_generated');
    } else if (action === 'logout') {
      await api('/api/auth/logout',{method:'POST'});
      location.assign('/login');
      return;
    } else {
      message = await changeEncryption(action,view,tr);
    }
    if (message) {repaint();notify(message,'success');}
  } catch (error) {
    notify(errorMessage(error,tr('common:auto.operation_failed')),'error');
  } finally {endUiAction(key,button);}
}
