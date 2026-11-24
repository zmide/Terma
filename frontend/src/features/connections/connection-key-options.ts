import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {apiErrorFromResponse} from '@/shared/api/public-errors';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import type {ConnectionCredentialIdentity} from './ConnectionCredentialDialog';
import { connectionFormIdentityWarning } from './connection-identity-warning';

const requests = new WeakMap<HTMLSelectElement, object>();

export async function loadConnectionKeys(selected: string | undefined, select: HTMLSelectElement) {
  const request = {};
  requests.set(select, request);
  try {
    const keys = await api<ConnectionCredentialIdentity[]>('/api/identity-files');
    if (!select.isConnected || requests.get(select) !== request) return;
    const form = select.form;
    const current = selected ?? select.value;
    const allowed = Boolean(current) && keys.some(key => String(key.path || '') === current);
    const hadUnsafe = select.selectedOptions[0]?.dataset.legacyUnsafe === '1';
    const showUnsafe = !allowed && Boolean(connectionFormIdentityWarning(form)) && (selected !== undefined ? Boolean(current) : hadUnsafe);
    const none = new Option(tr('connections:auto.no_private_key'), '');
    none.dataset.i18n = 'connections:auto.no_private_key';
    const options = [none, ...keys.map(key => new Option(localizedIdentityFileLabel(key, {permission: true}), String(key.path || '')))];
    if (showUnsafe) {
      const unsafe = new Option(tr('connections:identity.legacy_invalid'), '', true, true);
      unsafe.disabled = true;
      unsafe.dataset.i18n = 'connections:identity.legacy_invalid';
      unsafe.dataset.legacyUnsafe = '1';
      options.unshift(unsafe);
    }
    select.replaceChildren(...options);
    if (showUnsafe) select.selectedIndex = 0;
    else select.value = allowed ? current : '';
    connectionsServices.termaConnectionFormActions?.rememberIdentityOptions(select, keys);
    if (form) void connectionsServices.termaConnectionFormActions?.renderKeyStatus(form);
  } catch (error) {
    if (select.isConnected && requests.get(select) === request) throw error;
  } finally {
    if (requests.get(select) === request) requests.delete(select);
  }
}

export async function uploadConnectionKey(file: File): Promise<{path: string; name: string}> {
  const body = new FormData();
  body.append('key', file);
  const result = await fetch('/api/identity-files', {method:'POST', body});
  if (!result.ok) throw await apiErrorFromResponse(result, tr('connections:credentials.upload_failed'));
  return result.json();
}
