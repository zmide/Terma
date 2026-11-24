import {settingsServices} from '@/features/settings/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { computed, ref, shallowRef, watch } from 'vue';
import { errorMessage } from '../operations/operations-types';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { runtimePreferences, loopbackHost, wildcardHost, runtimePortValue, normalizeRuntimeSettingsResponse, type ListenConfig, type ListenerSettings } from './runtime-settings-model';

const defaultHosts = [loopbackHost];
type PortCheck = {
  available?: boolean;
  occupied_by_current?: boolean;
  current?: boolean;
  requested_port?: number;
  listen_port?: number;
  suggested_port?: number;
  code?: string;
  error?: string;
};
type Feedback = { type: 'error'; text: string } | { type: 'success' };
type Translate = (key: string, options?: Record<string, unknown>) => string;

export function useRuntimeListener(read: () => ListenerSettings | null, tr: Translate) {
  const data = shallowRef(read());
  const hosts = ref([...(data.value?.saved?.listen_hosts ?? defaultHosts)]);
  const port = ref(String(data.value?.saved?.listen_port ?? runtimePortValue(undefined)));
  const wildcard = computed(() => hosts.value.includes(wildcardHost));
  const busy = ref<'check' | 'save' | 'reload'>();
  const checkResult = shallowRef<PortCheck>();
  const feedback = shallowRef<Feedback>();
  let revision = 0;

  function clearFeedback() {
    revision++;
    checkResult.value = undefined;
    feedback.value = undefined;
  }

  function sync(next: ListenerSettings | null, reset = false) {
    const saved = next?.saved;
    const previous = data.value?.saved;
    data.value = next;
    if (!reset && saved?.listen_port === previous?.listen_port
      && String(saved?.listen_hosts) === String(previous?.listen_hosts)) return;
    hosts.value = [...(saved?.listen_hosts ?? defaultHosts)];
    port.value = String(saved?.listen_port ?? runtimePortValue(undefined));
    clearFeedback();
  }
  watch(read, next => sync(next));

  function selectHost(address: string, selected: boolean) {
    if (!selected) hosts.value = hosts.value.filter(host => host !== address);
    else if (address === wildcardHost) hosts.value = [address];
    else hosts.value = [...new Set([...hosts.value.filter(host => host !== wildcardHost), address])];
    clearFeedback();
  }

  function changePort(value: string) {
    port.value = value;
    clearFeedback();
  }

  function payload(): ListenConfig {
    const listen_port = runtimePortValue(port.value, 0);
    if (!hosts.value.length) throw Error(tr('settings:auto.select_listen_address'));
    if (!listen_port) throw Error(tr('settings:auto.invalid_listen_port'));
    return { listen_hosts: [...hosts.value], listen_port };
  }

  async function check() {
    if (busy.value || data.value?.listen_locked) return;
    clearFeedback();
    const request = revision;
    busy.value = 'check';
    try {
      const result = await api<PortCheck>('/api/runtime-settings/check', {method: 'POST', body: JSON.stringify(payload())});
      if (request === revision) checkResult.value = result;
    } catch (error) {
      if (request === revision) checkResult.value = { error: errorMessage(error, tr('settings:auto.port_check_failed')) };
    } finally { busy.value = undefined; }
  }

  async function save() {
    if (busy.value || data.value?.listen_locked) return;
    clearFeedback();
    busy.value = 'save';
    try {
      const input = payload();
      const result = await api<ListenerSettings>('/api/runtime-settings', {method: 'PUT', body: JSON.stringify(input)});
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({
        ...runtimePreferences.snapshot,
        ...result,
        saved: result.saved ?? input,
        restart_required: result.restart_required !== false
      });
      sync(runtimePreferences.snapshot, true);
      feedback.value = { type: 'success' };
      notify(tr('settings:auto.listener_saved_notice'), 'success');
    } catch (error) {
      feedback.value = { type: 'error', text: errorMessage(error, tr('settings:auto.listener_save_failed')) };
    } finally { busy.value = undefined; }
  }

  async function reload() {
    if (busy.value) return;
    busy.value = 'reload';
    try { sync(await settingsServices.termaRuntimeReader.load(true), true); }
    finally { busy.value = undefined; }
  }

  return { data, hosts, port, wildcard, busy, checkResult, feedback, selectHost, changePort, check, save, reload };
}

export type RuntimeListener = ReturnType<typeof useRuntimeListener>;
