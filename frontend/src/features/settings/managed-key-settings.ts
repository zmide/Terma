import {settingsServices} from '@/features/settings/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {applicationState} from '@/shared/application-state';
import { openSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { confirmModal } from '@/shared/workspace-prompts';
import { runtimePreferences } from './runtime-settings-model';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { filenameFromPath } from '@/shared/file-path';
import { errorMessage, type Translate } from '../operations/operations-types';
import type { ManagedKey } from './managed-keys-service';

type KeyState = { items?: ManagedKey[]; error?: string; revision: number };
type KeyAction = 'properties' | 'public' | 'deploy' | 'delete';
type ScopeSettings = { manage_user_ssh_keys_enabled?: boolean };
type FieldAction = (event: MouseEvent) => Promise<void>;
export type PublicKeyDialog = { value: string; copy: FieldAction };
export type KeyPropertiesDialog = { data: ManagedKey; save: FieldAction };
export type KeyDeployDialog = { deploy: FieldAction };
export type KeyImportDialog = { pick: (event: MouseEvent) => void };

const states = new WeakMap<HTMLElement, KeyState>();
export const keyManagementText = (translate: Translate) =>
  (key: string, fallback?: string) => translate(`settings:key_management.${key}`, { defaultValue: fallback });

export function managedKeyState(root: HTMLElement | null): Readonly<KeyState> {
  return root && states.get(root) || { revision: 0 };
}

export async function loadManagedKeys(root: HTMLElement | null) {
  if (!root?.querySelector('#managedKeysList')) return;
  const previous = managedKeyState(root);
  const revision = previous.revision + 1;
  states.set(root, { ...previous, revision });
  let result: KeyState;
  try { result = { items: await settingsServices.termaManagedKeys!.list(), revision }; }
  catch (error) { result = { error: errorMessage(error, tr('settings:key_management.load_failed')), revision }; }
  if (states.get(root)?.revision !== revision || !root.isConnected) return;
  states.set(root, result);
  settingsServices.termaRefreshVueSettings?.(root, 'managedKeysList');
}

const report = (error: unknown) => notify(errorMessage(error, tr('common:auto.operation_failed')), 'error');
const fieldValue = (root: ParentNode, id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? '';

async function managedMutation(event: MouseEvent, action: string, run: (source: HTMLElement) => Promise<void>) {
  const source = event.currentTarget as HTMLElement;
  const key = `settings:keys:${action}`;
  if (!sharedServices.termaUiActions.begin(key, source)) return;
  try { await run(source); }
  catch (error) { report(error); }
  finally { sharedServices.termaUiActions.end(key, source); }
}

export async function setManageUserKeys(event: Event, root: HTMLElement | null) {
  const input = event.currentTarget as HTMLInputElement;
  if (!root || input.disabled) return;
  const key = 'settings:keys:scope';
  if (!sharedServices.termaUiActions.begin(key)) {
    input.checked = applicationState.securitySettings?.manage_user_ssh_keys_enabled === true;
    return;
  }
  const enabled = input.checked;
  input.disabled = true;
  try {
    applicationState.securitySettings = await api<ScopeSettings>('/api/security', {
      method: 'PUT', body: JSON.stringify({ manage_user_ssh_keys_enabled: enabled })
    });
    settingsServices.termaRefreshVueSettings?.(root);
    await loadManagedKeys(root);
  } catch (error) { report(error); }
  finally {
    if (input.isConnected) {
      input.disabled = runtimePreferences.snapshot?.distribution === 'fnos';
      input.checked = !input.disabled && applicationState.securitySettings?.manage_user_ssh_keys_enabled === true;
    }
    sharedServices.termaUiActions.end(key);
  }
}

function showPublicKey(value: string): void {
  const dialog: PublicKeyDialog = { value, copy: event => managedMutation(event, 'copy', async () => {
    await sharedServices.termaClipboard.write(value);
    notify(tr('settings:key_management.copied'), 'success');
  }) };
  openSettingsDialog('public-key', dialog);
}

function showProperties(root: HTMLElement, data: ManagedKey): void {
  const dialog: KeyPropertiesDialog = { data, save: event => managedMutation(event, 'properties', async source => {
    const form = source.closest('.ssh-key-properties-modal');
    if (!form) return;
    await settingsServices.termaManagedKeys!.save(data, {
      comment: fieldValue(form, 'managedKeyComment'), currentPassphrase: fieldValue(form, 'managedCurrentPassphrase'),
      newPassphrase: fieldValue(form, 'managedNewPassphrase')
    });
    if (source.isConnected) closeModal();
    await loadManagedKeys(root);
    notify(tr('settings:key_management.saved'), 'success');
  }) };
  openSettingsDialog('key-properties', dialog);
}

function showDeploy(path: string): void {
  const dialog: KeyDeployDialog = { deploy: event => managedMutation(event, 'deploy', async source => {
    const form = source.closest('.ssh-key-deploy-modal');
    const id = form ? Number(fieldValue(form, 'managedDeployConnection')) : 0;
    if (!Number.isSafeInteger(id) || id <= 0) return notify(tr('settings:key_management.select_target'), 'info');
    await settingsServices.termaManagedKeys!.deploy(id, path);
    if (source.isConnected) closeModal();
    notify(tr('settings:key_management.deployed'), 'success');
  }) };
  openSettingsDialog('key-deploy', dialog);
}

let openRevision = 0;
export async function runManagedKeyAction(action: KeyAction, item: ManagedKey, event: MouseEvent, root: HTMLElement | null) {
  if (!root) return;
  const revision = ++openRevision;
  // Send only the identity tuple, never the displayed metadata.
  const key = { path: item.path, scope: item.scope };
  if (action === 'delete') return managedMutation(event, 'delete', async source => {
    if (!await confirmModal(tr('settings:key_management.delete_confirm', { name: filenameFromPath(item.path) }),
      tr('settings:key_management.delete'), tr('common:actions.delete'), tr('common:actions.cancel'), true) || !source.isConnected) return;
    await settingsServices.termaManagedKeys!.remove(key);
    await loadManagedKeys(root);
    notify(tr('settings:key_management.deleted'), 'success');
  });
  if (action === 'deploy') return showDeploy(`${item.path}.pub`);
  const source = event.currentTarget as HTMLElement;
  const modal = document.getElementById('modal');
  const previous = modal?.firstElementChild;
  const hidden = modal?.hidden;
  const current = () => revision === openRevision && source.isConnected &&
    root.querySelector('#settings-key-management:not([hidden])')?.checkVisibility() && modal?.hidden === hidden && modal?.firstElementChild === previous;
  try {
    if (action === 'properties') {
      const data = await settingsServices.termaManagedKeys!.properties(key);
      if (current()) showProperties(root, data);
    } else {
      const value = await settingsServices.termaManagedKeys!.publicKey(key);
      if (current()) showPublicKey(value);
    }
  } catch (error) { if (current()) report(error); }
}

export function startManagedKeyImport(root: HTMLElement | null, userScope: boolean) {
  if (!root) return;
  ++openRevision;
  const pick = (scope: 'project' | 'user') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await settingsServices.termaManagedKeys!.importFile(scope, file);
        await loadManagedKeys(root);
        notify(tr('settings:key_management.imported'), 'success');
      } catch (error) { report(error); }
    };
    input.click();
  };
  if (!userScope) return pick('project');
  const dialog: KeyImportDialog = { pick(event) {
    const form = (event.currentTarget as HTMLElement).closest('.ssh-key-deploy-modal');
    const scope = form && fieldValue(form, 'managedImportScope') === 'user' ? 'user' : 'project';
    closeModal();
    pick(scope);
  } };
  openSettingsDialog('key-import', dialog);
}
