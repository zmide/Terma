import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { readonly, ref } from 'vue';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';
import { runtimePreferences, normalizeRuntimeSettingsResponse } from './runtime-settings-model';

type RuntimeSettings = ReturnType<typeof normalizeRuntimeSettingsResponse>;
type WorkspaceWrite = { remote_desktop_quick_open_enabled: boolean };
const storageKey = 'remoteDesktopQuickOpen';

function legacyValue() {
  try { return localStorage.getItem(storageKey); }
  catch { return null; }
}

const enabled = ref(legacyValue() === '1');
const pendingWrites = ref(0);
let target: boolean | undefined;
let queue: Promise<unknown> = Promise.resolve();
let revision = 0;

export function saveWorkspacePreferences<T extends WorkspaceWrite>(payload: T) {
  target = payload.remote_desktop_quick_open_enabled;
  pendingWrites.value += 1;
  const operation = queue.then(async () => {
    const previousLanguage = runtimePreferences.snapshot?.saved.language;
    try {
      const result = await api<Partial<RuntimeSettings>>('/api/runtime-settings', {
        method: 'PUT', body: JSON.stringify(payload)
      });
      const language = runtimePreferences.snapshot?.saved.language;
      const saved = language && language !== previousLanguage ? {...result.saved, language} : result.saved;
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({...runtimePreferences.snapshot, ...result, saved: saved ?? runtimePreferences.snapshot?.saved});
      enabled.value = runtimePreferences.snapshot.saved.remote_desktop_quick_open_enabled;
      revision += 1;
      try { localStorage.removeItem(storageKey); } catch { /* Keep the successfully saved preference active. */ }
      return enabled.value;
    } finally {
      pendingWrites.value -= 1;
      if (!pendingWrites.value) target = undefined;
    }
  });
  queue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function toggle() {
  try {
    const value = await saveWorkspacePreferences({remote_desktop_quick_open_enabled: !(target ?? enabled.value)});
    notify(tr(value ? 'remote:auto.quick_open_enabled_notice' : 'remote:auto.quick_open_disabled_notice'), 'info');
  } catch (error) {
    notify(errorMessage(error, tr('settings:auto.workspace_save_failed')), 'error');
  }
}

export const remoteQuickOpen = {
  enabled: readonly(enabled),
  pendingWrites: readonly(pendingWrites),
  revision: () => revision,
  applyLoaded(value: boolean) {
    const legacy = legacyValue();
    enabled.value = legacy === null ? value : legacy === '1';
  },
  toggle
};
