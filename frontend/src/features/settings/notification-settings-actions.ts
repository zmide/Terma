import {quickServices} from '@/features/quick/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {applicationState} from '@/shared/application-state';
import { reactive } from 'vue';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { errorMessage } from '../operations/operations-types';
import { runtimePreferences, normalizeRuntimeSettingsResponse, notificationDurationMs, type normalizeNotificationDisplay } from './runtime-settings-model';

type Runtime = ReturnType<typeof normalizeRuntimeSettingsResponse>;
type Translate = (key: string, options?: Record<string,unknown>) => string;
type Display = ReturnType<typeof normalizeNotificationDisplay>;
type DisplayWrite = Omit<Display,'progress'> & {progress: {enabled:boolean;success_duration_ms:number|null;error_duration_ms:number|null}};
type Mode = 'on' | 'muted' | 'off';

export const notificationActions = reactive({saving:false, toggling:false, revision:0});
export const notificationMode = (value: unknown): Mode => value === 'muted' || value === 'off' ? value : 'on';
export function parseNotificationSeconds(value: string, tr: Translate): number;
export function parseNotificationSeconds(value: string, tr: Translate, nullable: true): number | null;
export function parseNotificationSeconds(value: string, tr: Translate, nullable = false) {
  if (!value.trim() && nullable) return null;
  const seconds = Number(value);
  const duration = notificationDurationMs(Math.round(seconds * 1000), null, false);
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 60 || duration === null) throw Error(tr('settings:auto.notification_duration_invalid'));
  return duration;
}

export async function saveNotificationSettings(read: () => {mode:Mode; display:DisplayWrite; floating:boolean}, tr: Translate) {
  if (notificationActions.saving || notificationActions.toggling) return false;
  notificationActions.saving = true;
  try {
    const {mode,display,floating} = read();
    const [security, runtime] = await Promise.allSettled([
      api<NonNullable<typeof applicationState.securitySettings>>('/api/security', {method:'PUT',body:JSON.stringify({notification_mode:mode})}),
      api<Partial<Runtime>>('/api/runtime-settings', {method:'PUT',body:JSON.stringify({notification_display:display,sftp_floating_progress_enabled:floating})})
    ]);
    if (security.status === 'fulfilled') applicationState.securitySettings = security.value;
    if (runtime.status === 'fulfilled') {
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({...runtimePreferences.snapshot,...runtime.value});
      quickServices.termaQuickViews?.renderTaskFloat();
    }
    if (security.status === 'rejected') throw security.reason;
    if (runtime.status === 'rejected') throw runtime.reason;
    notify(tr(mode === 'on' ? 'settings:auto.notification_saved' : `settings:security.notifications_${mode}`), 'success');
    return true;
  } catch (error) {
    notify(errorMessage(error,tr('settings:auto.notification_save_failed')), 'error');
    return false;
  } finally { notificationActions.saving = false; }
}

export function toggleSettingsDesktopNotifications() {
  if (notificationActions.saving) return;
  return efficiencyServices.termaSystemNotifications.toggle({
    busy(value) {notificationActions.toggling = value;},
    refresh() {notificationActions.revision++;},
    async save(enabled) {
      const value = await api<Partial<Runtime>>('/api/runtime-settings',{method:'PUT',body:JSON.stringify({desktop_notifications_enabled:enabled})});
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({...runtimePreferences.snapshot,...value});
    }
  });
}
