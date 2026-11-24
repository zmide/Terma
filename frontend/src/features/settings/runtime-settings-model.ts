import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {normalizeTermaLanguage} from '@/shared/i18n/ui-phrase';
import type { TermaLanguage } from '../../shared/i18n/runtime';
import { normalizeAiSettingsResponse } from './ai-settings-model';

type Fields = Record<string, unknown>;
type ListenerSources = { listen_hosts?: string; listen_port?: string };
export type ListenConfig = { listen_hosts: string[]; listen_port: number; sources?: ListenerSources };
export type ListenHost = { address: string; kind?: string; interface?: string; label?: string };
export type ListenerSettings = {
  saved?: ListenConfig;
  effective?: ListenConfig;
  available_hosts?: ListenHost[];
  sources?: ListenerSources;
  listen_locked?: boolean;
  restart_required?: boolean;
  local_url?: string;
  lan_urls?: string[];
  error?: string;
};

export const loopbackHost = '127.0.0.1';
export const wildcardHost = '0.0.0.0';
export type VncFullscreenToolbarMode = 'always' | 'never' | 'edge';
export function normalizeVncFullscreenToolbarMode(value: unknown): VncFullscreenToolbarMode {
  return value === 'never' || value === 'edge' ? value : 'always';
}
export const backgroundIntervals = {
  ui_refresh_interval_ms: 4000,
  sftp_active_status_poll_interval_ms: 5000,
  sftp_background_status_poll_interval_ms: 15000,
  vnc_local_image_poll_interval_ms: 5000,
  vnc_remote_image_poll_interval_ms: 3000
} as const;

const fields = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};

export function runtimeHostValues(value: unknown) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.flatMap(item => String(item ?? '').split(/[\s,]+/)).filter(Boolean))];
}

export function runtimePortValue(value: unknown, fallback = 8088) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

export function runtimeBackgroundIntervalMs(value: unknown, fallback: number) {
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1000 && interval <= 60000 ? interval : fallback;
}

export function normalizeWorkspaceToolbarPlacement(value: unknown) {
  const source = fields(value);
  const placement = (candidate: unknown) => candidate === 'tab' ? 'tab' : 'header';
  const area = (mode: string) => {
    const current = fields(source[mode]);
    return { terminal: placement(current.terminal), sftp: placement(current.sftp) };
  };
  return {unsplit: area('unsplit'), split: area('split')};
}

export function notificationDurationMs(value: unknown, fallback: number): number;
export function notificationDurationMs(value: unknown, fallback: number | null, nullable: boolean): number | null;
export function notificationDurationMs(value: unknown, fallback: number | null, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 500 && duration <= 60000 ? duration : fallback;
}

export function normalizeNotificationDisplay(value: unknown) {
  const source = fields(value);
  const entry = (name: string, fallback: number) => {
    const current = fields(source[name]);
    return { enabled: current.enabled !== false, duration_ms: notificationDurationMs(current.duration_ms, fallback) };
  };
  const progress = fields(source.progress);
  return {
    info: entry('info', 3500), success: entry('success', 3500), error: entry('error', 8000),
    progress: {
      enabled: progress.enabled !== false,
      success_duration_ms: notificationDurationMs(progress.success_duration_ms, null, true),
      error_duration_ms: notificationDurationMs(progress.error_duration_ms, 8000)
    }
  };
}

function savedPreferences(source: Fields) {
  return {
    language: normalizeTermaLanguage(source.language),
    language_onboarding_version: Math.max(0, Number(source.language_onboarding_version) || 0),
    vnc_fullscreen_toolbar: normalizeVncFullscreenToolbarMode(source.vnc_fullscreen_toolbar),
    ui_refresh_interval_ms: runtimeBackgroundIntervalMs(source.ui_refresh_interval_ms, backgroundIntervals.ui_refresh_interval_ms),
    sftp_active_status_poll_interval_ms: runtimeBackgroundIntervalMs(source.sftp_active_status_poll_interval_ms, backgroundIntervals.sftp_active_status_poll_interval_ms),
    sftp_background_status_poll_interval_ms: runtimeBackgroundIntervalMs(source.sftp_background_status_poll_interval_ms, backgroundIntervals.sftp_background_status_poll_interval_ms),
    vnc_local_image_poll_interval_ms: runtimeBackgroundIntervalMs(source.vnc_local_image_poll_interval_ms, backgroundIntervals.vnc_local_image_poll_interval_ms),
    vnc_remote_image_poll_interval_ms: runtimeBackgroundIntervalMs(source.vnc_remote_image_poll_interval_ms, backgroundIntervals.vnc_remote_image_poll_interval_ms),
    sftp_recycle_bin_enabled: source.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: source.sftp_floating_progress_enabled !== false,
    desktop_notifications_enabled: source.desktop_notifications_enabled !== false,
    notification_display: normalizeNotificationDisplay(source.notification_display),
    sftp_max_open_file_size_mb: Number(source.sftp_max_open_file_size_mb) || 50,
    sftp_text_editor_mode: source.sftp_text_editor_mode === 'auto' || source.sftp_text_editor_mode === 'light' ? source.sftp_text_editor_mode : 'ace',
    sftp_double_click_file_action: source.sftp_double_click_file_action === 'external' ? 'external' : 'internal',
    sftp_light_editor_threshold_mb: Number(source.sftp_light_editor_threshold_mb) || 10,
    sftp_external_edit_save_rule: source.sftp_external_edit_save_rule === 'overwrite' ? 'overwrite' : 'prompt',
    sftp_external_edit_backup_enabled: source.sftp_external_edit_backup_enabled !== false,
    sftp_download_concurrency: Math.max(1, Math.min(8, Number(source.sftp_download_concurrency) || 3)),
    sftp_upload_concurrency: Math.max(1, Math.min(8, Number(source.sftp_upload_concurrency) || 3)),
    restore_workspace_tabs: source.restore_workspace_tabs !== false,
    remote_desktop_quick_open_enabled: source.remote_desktop_quick_open_enabled === true,
    vnc_quick_open_new_window: source.vnc_quick_open_new_window !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(source.workspace_toolbar_placement)
  };
}

function availableHosts(value: unknown, persisted: string[]) {
  const available: Array<ListenHost & { internal?: boolean; wildcard?: boolean }> = [
    {address: loopbackHost, kind: 'loopback', interface: 'loopback', internal: true},
    {address: wildcardHost, kind: 'all', interface: 'all', wildcard: true}
  ];
  const known = new Set(available.map(item => item.address));
  for (const valueItem of Array.isArray(value) ? value : []) {
    const item = typeof valueItem === 'string' ? {address: valueItem, label: valueItem} : fields(valueItem);
    const address = String(item.address || '').trim();
    if (!address || known.has(address)) continue;
    known.add(address);
    available.push({...item, address, label: String(item.label || `${item.interface ? `${item.interface} · ` : ''}${address}`)});
  }
  for (const address of persisted) {
    if (known.has(address)) continue;
    known.add(address);
    available.push({address, kind: 'saved', interface: 'saved'});
  }
  return available;
}

export function normalizeRuntimeSettingsResponse(value: unknown) {
  const source = fields(value);
  const saved = source.saved && typeof source.saved === 'object' ? fields(source.saved) : source;
  const effective = source.effective && typeof source.effective === 'object' ? fields(source.effective) : {
    ...saved,
    listen_hosts: source.actual_hosts || source.effective_hosts || source.requested_hosts || saved.listen_hosts,
    listen_port: source.actual_port || source.effective_port || source.requested_port || saved.listen_port
  } as Fields;
  const savedHosts = runtimeHostValues(saved.listen_hosts || saved.hosts || saved.host || loopbackHost);
  const effectiveHosts = runtimeHostValues(effective.listen_hosts || effective.hosts || effective.host || savedHosts);
  const available = availableHosts(source.available_hosts, [...savedHosts, ...effectiveHosts]);
  const savedPort = runtimePortValue(saved.listen_port ?? saved.port);
  const effectivePort = runtimePortValue(effective.listen_port ?? effective.port, savedPort);
  const all = effectiveHosts.includes(wildcardHost);
  const fallbackLocal = effectiveHosts.find(address => address.startsWith('127.')) || (all ? loopbackHost : effectiveHosts[0]);
  const lanHosts = all ? available.filter(entry => !entry.internal && !entry.wildcard).map(entry => entry.address)
    : effectiveHosts.filter(address => !address.startsWith('127.'));
  const reportedLan = Array.isArray(source.lan_urls) ? source.lan_urls : Array.isArray(effective.lan_urls) ? effective.lan_urls
    : lanHosts.map(address => `http://${address}:${effectivePort}`);
  const hasRuntime = Boolean(source.local_url || source.actual_hosts || source.effective || source.listen_hosts || source.saved);
  const preferences = savedPreferences(saved);
  const translate = typeof window === 'undefined' ? undefined : tr;
  const ai = normalizeAiSettingsResponse(saved.ai || source.ai, translate);
  return {
    ...source, ...preferences, ai,
    settings_persisted: source.settings_persisted === true,
    saved: {
      ...saved, ...preferences, ai, listen_hosts: savedHosts.length ? savedHosts : [loopbackHost], listen_port: savedPort,
      sftp_download_directory: String(saved.sftp_download_directory || '')
    },
    effective: {
      ...effective, ai: normalizeAiSettingsResponse(effective.ai || ai, translate), listen_hosts: effectiveHosts.length ? effectiveHosts : [loopbackHost],
      listen_port: effectivePort
    },
    available_hosts: available,
    local_url: String(source.local_url || effective.local_url || (hasRuntime && fallbackLocal ? `http://${fallbackLocal}:${effectivePort}` : '')),
    lan_urls: hasRuntime ? reportedLan.map(String).filter(Boolean) : [],
    restart_required: source.restart_required === true,
    error: String(source.error || '')
  };
}

export type RuntimeSettingsSnapshot = ReturnType<typeof normalizeRuntimeSettingsResponse> & {
  distribution?: string;
  listen_locked?: boolean;
};

export const runtimePreferences: { snapshot: RuntimeSettingsSnapshot | null } = {snapshot: null};

export function runtimeConfiguredBackgroundIntervalMs(key: string, fallback: number) {
  const current = runtimePreferences.snapshot;
  return runtimeBackgroundIntervalMs(fields(current?.saved || current)[key], fallback);
}

export function installRuntimeSettingsModel() {
  settingsServices.termaRuntimeSettingsModel = runtimeSettingsModel;
}

const runtimeSettingsModel = {
  normalize: normalizeRuntimeSettingsResponse, interval: runtimeConfiguredBackgroundIntervalMs,
  get snapshot() { return runtimePreferences.snapshot; },
  set snapshot(value) { runtimePreferences.snapshot = value; }
};



export interface InstalledFeaturesSettingsRuntimeSettingsModelServices {
  termaRuntimeSettingsModel: typeof runtimeSettingsModel
}
