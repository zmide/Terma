import {efficiencyServices} from '@/features/efficiency/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {normalizeTermaLanguage} from '@/shared/i18n/ui-phrase';
import {toggleSettingsDesktopNotifications} from '@/features/settings/notification-settings-actions';
import type {NotificationEvent} from './notification-event-service';
export function dismissToast(target?:Element|null) {
  const id = target instanceof Element ? target.closest<HTMLElement>(".toast")?.dataset.toastId : undefined;
  if (target && !id) return;
  efficiencyServices.termaNotificationToasts?.dismiss(id);
}

export function notify(...args:Parameters<NonNullable<(typeof efficiencyServices)['termaNotificationToasts']>["notify"]>) {
  efficiencyServices.termaNotificationToasts?.notify(...args);
}

export function createProgressToast(...args:Parameters<NonNullable<(typeof efficiencyServices)['termaNotificationToasts']>["createProgress"]>) {
  return efficiencyServices.termaNotificationToasts!.createProgress(...args);
}

export function desktopNotificationEnabled() {
  return efficiencyServices.termaSystemNotifications.enabled();
}

export async function requestDesktopNotifications() {
  return toggleSettingsDesktopNotifications();

}

export function showDesktopNotification(event:NotificationEvent) {
  return efficiencyServices.termaSystemNotifications.show(event);
}

export function handleNotificationAction(action:unknown) {
  return efficiencyServices.termaSystemNotifications.handleAction(action);
}

export function currentNotificationLanguage() {
  return normalizeTermaLanguage(document.documentElement.lang || settingsServices.termaRuntimeSettingsModel?.snapshot?.saved?.language || "zh-CN");
}

export async function handleNotificationEvent(event:NotificationEvent|undefined,options:Parameters<NonNullable<(typeof efficiencyServices)['termaNotificationEvents']>["handle"]>[1]={}) {
  return efficiencyServices.termaNotificationEvents?.handle(event, options);
}

export async function pollNotifications() {
  return efficiencyServices.termaNotificationPolling?.poll();
}

export async function initializeNotificationCursor() {
  return efficiencyServices.termaNotificationPolling?.initialize();
}

