import {efficiencyServices} from '@/features/efficiency/installed-services';
import type { NotificationEvent } from './notification-event-service';

interface DesktopNotificationBridge {
  onNotification?(callback: (payload: {event?: NotificationEvent; display?: boolean}) => void): () => void;
  onNotificationAction?(callback: (action: unknown) => void): () => void;
}

interface NotificationSettingsAction {
  busy(value: boolean): void;
  refresh(): void;
  save(enabled: boolean): Promise<void>;
}

interface SystemNotificationPort {
  browser(): typeof Notification | null;
  desktop(): DesktopNotificationBridge | undefined;
  appEnabled(): boolean;
  text(key: string): string;
  notify(message: string, kind: 'success' | 'info' | 'error'): void;
  focus(): void;
  location(): string;
  activateTab(key: string): unknown;
  openForwards(id: number): unknown;
  openSftp(id: number): unknown;
  openLog(path: string, title: string): unknown;
  openUrl(url: string): void;
  handleEvent(event: NotificationEvent | undefined, options: {fromDesktop: true; display: boolean}): Promise<unknown>;
}

export function createSystemNotificationService(port: SystemNotificationPort) {
  let active = true;
  let bound = false;
  let revision = 0;
  let lastFailure = '';
  let permissionRequest: Promise<NotificationPermission> | undefined;
  let settingsRequest: Promise<boolean> | undefined;
  const subscriptions: (() => void)[] = [];
  const notifications = new Set<Notification>();
  const failed = (operation: string) => { lastFailure = operation; };

  function enabled() {
    return port.browser()?.permission === 'granted' && port.appEnabled();
  }

  function permissionText() {
    const browser = port.browser();
    if (!browser) return port.text('settings:auto.notifications_unsupported');
    if (browser.permission === 'granted') return port.text(port.appEnabled()
      ? 'settings:auto.notifications_authorized_enabled' : 'settings:auto.notifications_authorized_disabled');
    return port.text(browser.permission === 'denied'
      ? 'settings:auto.notifications_denied_detail' : 'settings:auto.notifications_page_only');
  }

  function toggleLabel() {
    return port.text(enabled() ? 'settings:auto.disable_desktop_notifications' : 'settings:auto.enable_desktop_notifications');
  }

  function requestPermission() {
    if (permissionRequest) return permissionRequest;
    const browser = port.browser();
    if (!active || !browser) return Promise.resolve<NotificationPermission>('denied');
    if (browser.permission !== 'default') return Promise.resolve(browser.permission);
    const work = browser.requestPermission();
    permissionRequest = work;
    void work.finally(() => { if (permissionRequest === work) permissionRequest = undefined; }).catch(() => failed('permission'));
    return work;
  }

  async function request() {
    if (!active) return false;
    if (!port.browser()) {
      port.notify(port.text('common:notifications.browser_notifications_unsupported'), 'info');
      return false;
    }
    const started = revision;
    try {
      const granted = await requestPermission() === 'granted';
      if (!active || started !== revision) return false;
      port.notify(port.text(granted
        ? 'common:notifications.exact.desktop_notifications_enabled' : 'common:notifications.desktop_notifications_denied'), granted ? 'success' : 'info');
      return granted;
    } catch {
      failed('permission');
      if (active && started === revision) port.notify(port.text('settings:auto.notification_save_failed'), 'error');
      return false;
    }
  }

  async function saveToggle(action: NotificationSettingsAction) {
    const browser = port.browser();
    if (!active) return false;
    if (!browser || browser.permission === 'denied') {
      port.notify(port.text(browser ? 'settings:auto.notifications_denied_detail' : 'common:notifications.browser_notifications_unsupported'), 'info');
      return false;
    }
    const started = revision;
    action.busy(true);
    try {
      const wasGranted = browser.permission === 'granted';
      const permission = await requestPermission();
      if (!active || started !== revision) return false;
      if (permission !== 'granted') {
        port.notify(port.text('common:notifications.desktop_notifications_denied'), 'info');
        return false;
      }
      const next = wasGranted ? !port.appEnabled() : true;
      await action.save(next);
      if (!active || started !== revision) return false;
      port.notify(port.text(next ? 'settings:auto.desktop_notifications_enabled' : 'settings:auto.desktop_notifications_disabled'), 'success');
      return true;
    } catch (error) {
      failed('settings');
      const message = error instanceof Error ? error.message : '';
      if (active && started === revision) port.notify(message || port.text('settings:auto.notification_save_failed'), 'error');
      return false;
    } finally {
      action.busy(false);
      if (active && started === revision) action.refresh();
    }
  }

  function toggle(action: NotificationSettingsAction) {
    if (settingsRequest) return settingsRequest;
    const work = saveToggle(action);
    settingsRequest = work;
    void work.finally(() => { if (settingsRequest === work) settingsRequest = undefined; }).catch(() => failed('settings'));
    return work;
  }

  function handleAction(value: unknown) {
    if (!active || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const action = value as Record<string, unknown>;
    const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
    const id = typeof action.connection_id === 'number' || typeof action.connection_id === 'string'
      ? Number(action.connection_id) : 0;
    let result: unknown;
    try {
      if (action.type === 'tab' && text(action.key)) result = port.activateTab(action.key);
      else if (action.view === 'forwards' || action.view === 'sftp') {
        if (!Number.isSafeInteger(id) || id <= 0) return false;
        result = action.view === 'forwards' ? port.openForwards(id) : port.openSftp(id);
      } else if (action.view === 'log' && text(action.path)) {
        result = port.openLog(action.path, text(action.title) ? action.title : port.text('common:log_viewer.default_title'));
      } else if (text(action.url)) {
        const target = new URL(action.url, port.location());
        if (target.protocol !== 'https:' || target.hostname !== 'github.com' || target.username || target.password) return false;
        port.openUrl(target.href);
      } else return false;
      void Promise.resolve(result).catch(() => failed('action'));
      return true;
    } catch {
      failed('action');
      return false;
    }
  }

  function show(event: NotificationEvent & {key?: string}) {
    const browser = port.browser();
    if (!active || !browser || !enabled() || !event || typeof event !== 'object') return false;
    try {
      const options = {
        body: event.message || '', tag: event.key || String(event.id || Date.now()), renotify: false
      };
      const notification = new browser(event.title || 'Terma', options);
      const started = revision;
      const action = event.action ? {...event.action} : undefined;
      let closed = false;
      notifications.add(notification);
      notification.onclose = () => { closed = true; notification.onclick = null; notifications.delete(notification); };
      notification.onclick = () => {
        if (closed) return;
        closed = true;
        try {
          if (active && started === revision) {
            port.focus();
            handleAction(action);
          }
        } catch {
          failed('action');
        } finally {
          notification.onclick = null;
          notifications.delete(notification);
          notification.close();
        }
      };
      return true;
    } catch {
      failed('display');
      return false;
    }
  }

  function dispose() {
    active = false;
    bound = false;
    revision++;
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe(); } catch { failed('subscription'); }
    }
    for (const notification of notifications) {
      notification.onclick = null;
      notification.onclose = null;
      try { notification.close(); } catch { failed('display'); }
    }
    notifications.clear();
  }

  function bindDesktop() {
    if (bound || !active) return;
    const desktop = port.desktop();
    if (!desktop) return;
    bound = true;
    const started = revision;
    try {
      const events = desktop.onNotification?.(payload => {
        if (!active || started !== revision) return;
        void port.handleEvent(payload?.event, {fromDesktop: true, display: payload?.display !== false}).catch(() => failed('event'));
      });
      if (events) subscriptions.push(events);
      const actions = desktop.onNotificationAction?.(action => {
        if (active && started === revision) handleAction(action);
      });
      if (actions) subscriptions.push(actions);
    } catch {
      dispose();
      failed('subscription');
    }
  }

  return {
    appEnabled: () => port.appEnabled(),
    enabled, permissionText, toggleLabel, requestPermission, request, toggle, show, handleAction, bindDesktop, dispose,
    resume() { active = true; bindDesktop(); },
    status: () => ({active, bound, notifications: notifications.size, lastFailure})
  };
}

export function installSystemNotifications(port:SystemNotificationPort) {
  if (efficiencyServices.termaSystemNotifications) return;
  const service = createSystemNotificationService(port);
  efficiencyServices.termaSystemNotifications = service;
  window.addEventListener('pagehide', () => service.dispose());
  window.addEventListener('pageshow', () => service.resume());
}



export interface InstalledFeaturesEfficiencySystemNotificationServiceServices {
  termaSystemNotifications: ReturnType<typeof createSystemNotificationService>;
}
