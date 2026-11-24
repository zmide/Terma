import {api} from '@/shared/api/workspace-request';
import { defineComponent, onBeforeUnmount, ref, shallowRef, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { runtimeHostValues, runtimePortValue, type ListenerSettings } from './runtime-settings-model';

type WebInfo = Pick<ListenerSettings, 'local_url' | 'lan_urls'> & {
  hosts?: string[];
  host?: string;
  port?: number;
};
type Diagnostics = {
  pid: number;
  platform: string;
  arch: string;
  node: string;
  data_dir?: string;
  log_dir?: string;
  web_log?: string;
  web_url?: string;
  web_info?: string | WebInfo;
  lan_urls?: string[];
  actual_hosts?: string[];
  actual_port?: number;
  pty?: { available?: boolean; operational?: boolean; error?: string; helper_exists?: boolean; helper_executable?: boolean; helper_path?: string };
};
type Addresses = { localUrl: string; lanUrls: string[] };
type Translate = (key: string, options?: Record<string, unknown>) => string;

function parseWebInfo(value: Diagnostics['web_info']): WebInfo | undefined {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as WebInfo;
  } catch { return undefined; }
  return undefined;
}

function safeRuntimeUrl(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { return ''; }
  return '';
}

function runtimeAddresses(saved: ListenerSettings | null, data?: Diagnostics, info?: WebInfo): Addresses {
  const lan = data?.lan_urls ?? info?.lan_urls;
  const values = Array.isArray(lan) ? lan : saved?.lan_urls ?? [];
  return {
    localUrl: safeRuntimeUrl(data?.web_url) || safeRuntimeUrl(info?.local_url) || safeRuntimeUrl(saved?.local_url),
    lanUrls: [...new Set(values.map(safeRuntimeUrl).filter(Boolean))]
  };
}

function diagnosePty(data: Diagnostics, tr: Translate) {
  const pty = data.pty;
  const status = pty?.operational ? tr('settings:auto.diagnostic_available')
    : pty?.available ? tr('settings:auto.diagnostic_partial')
      : tr('settings:auto.diagnostic_unavailable', {error: pty?.error || tr('settings:auto.diagnostic_optional_missing')});
  if (data.platform === 'win32') return {status, helper: 'Windows ConPTY'};
  if (data.platform !== 'darwin') return {status, helper: tr('settings:auto.diagnostic_helper_not_required')};
  if (!pty?.helper_exists) return {status, helper: tr('settings:auto.diagnostic_not_found')};
  const supported = tr(pty.helper_executable ? 'settings:auto.diagnostic_executable' : 'settings:auto.diagnostic_not_executable');
  return {status, helper: pty.helper_path ? `${supported} · ${pty.helper_path}` : supported};
}

function runtimeRows(data: Diagnostics, info: WebInfo | undefined, settings: ListenerSettings | null, addresses: Addresses, tr: Translate) {
  const hosts = runtimeHostValues(data.actual_hosts ?? info?.hosts ?? info?.host ?? settings?.effective?.listen_hosts);
  const port = runtimePortValue(data.actual_port ?? info?.port ?? settings?.effective?.listen_port);
  const pty = diagnosePty(data, tr);
  const unknown = tr('settings:auto.diagnostic_unknown');
  return [
    ['diagnostic_process', `PID ${data.pid} · ${data.platform}/${data.arch} · ${data.node}`],
    ['diagnostic_listener', `${hosts.join('、') || unknown}:${port}`],
    ['diagnostic_local_address', addresses.localUrl || tr('settings:auto.diagnostic_not_generated')],
    ['diagnostic_lan_address', addresses.lanUrls.join('，') || tr('settings:auto.diagnostic_none')],
    ['diagnostic_data_directory', data.data_dir || unknown],
    ['diagnostic_log_directory', data.log_dir || unknown],
    ['diagnostic_web_log', data.web_log || unknown],
    ['diagnostic_pty', pty.status],
    ['diagnostic_pty_helper', pty.helper]
  ];
}

function urlList(addresses: Addresses, tr: Translate) {
  const {localUrl, lanUrls} = addresses;
  const rows = lanUrls.map((url, i) => ({
    url, icon: 'network',
    label: lanUrls.length > 1 ? tr('settings:auto.lan_access_numbered', {index: i + 1}) : tr('settings:auto.lan_access')
  }));
  if (localUrl) rows.unshift({url: localUrl, icon: 'monitor', label: tr('settings:auto.local_access')});
  if (!rows.length) return <div class="runtime-empty muted">{tr('settings:auto.no_access_urls')}</div>;
  return <div class="runtime-url-list">{rows.map(({url, icon, label}) =>
    <a key={`${icon}:${url}`} class="runtime-url-row" href={url} target="_blank" rel="noopener">
      <span class="runtime-url-icon">{settingsIcon(icon)}</span>
      <span><strong>{label}</strong><small>{url}</small></span>
      {settingsIcon('external-link')}
    </a>
  )}</div>;
}

export const RuntimeDiagnostics = defineComponent({
  props: { scope: { type: Object as PropType<SettingsViewPort>, required: true } },
  setup(props) {
    const result = shallowRef<Diagnostics>();
    const loading = ref(false);
    const error = ref('');
    let request: AbortController | undefined;
    const tr: Translate = (key, options) => props.scope.tr(key, options);

    async function refresh() {
      if (request) return;
      const controller = request = new AbortController();
      loading.value = true;
      error.value = '';
      try {
        const response = await api<Diagnostics>('/api/diagnostics/runtime', {signal: controller.signal});
        if (!controller.signal.aborted) result.value = response;
      } catch (cause) {
        if (!controller.signal.aborted) error.value = errorMessage(cause, tr('settings:auto.runtime_load_failed'));
      } finally {
        request = undefined;
        loading.value = false;
      }
    }
    onBeforeUnmount(() => request?.abort());

    return () => {
      const settings: ListenerSettings | null = props.scope.runtimeSettings;
      const report = result.value;
      const info = parseWebInfo(report?.web_info);
      const addresses = runtimeAddresses(settings, report, info);
      const rows = report && runtimeRows(report, info, settings, addresses, tr);
      return <section>
        <h3>{tr('settings:auto.current_urls')}</h3>
        <div class="muted">{tr('settings:auto.current_urls_hint')}</div>
        <div id="runtimeCurrentUrls">{urlList(addresses, tr)}</div>
        <h3 class="runtime-diagnostics-title">{tr('settings:auto.runtime_diagnostics')}</h3>
        <div class="muted">{tr('settings:auto.runtime_diagnostics_hint')}</div>
        <div id="runtimeDiagnostics" class={['diagnostics-box', {error: error.value, muted: !rows}]} aria-live="polite">
          {loading.value ? tr('settings:auto.loading') : error.value || (rows
            ? <dl class="runtime-diagnostic-grid">{rows.map(([key, value]) =>
              <div key={key}><dt>{tr(`settings:auto.${key}`)}</dt><dd>{value}</dd></div>
            )}</dl> : tr('settings:auto.not_loaded'))}
        </div>
        <div class="actions">
          <TermaButton id="runtimeDiagnosticsRefresh" loading={loading.value} disabled={loading.value} onClick={refresh}>
            {settingsIcon('refresh-cw')}<span>{tr('settings:auto.refresh_diagnostics')}</span>
          </TermaButton>
        </div>
      </section>;
    };
  }
});
