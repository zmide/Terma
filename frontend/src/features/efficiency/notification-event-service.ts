import type { NotificationState } from './notification-state-service';

export interface NotificationEvent {
  id?: number | string;
  type?: string;
  title?: string;
  message?: string;
  level?: string;
  silent?: boolean;
  action?: Record<string, unknown>;
}

export interface NotificationEventState {
  lastId?: number;
  state?: Pick<NotificationState, 'lastId'>;
  accept(event: NotificationEvent): boolean;
}

export interface NotificationEventHooks {
  context(): { notificationMode?: string; updateIgnored?: boolean };
  settleSftpJob(event: NotificationEvent): void;
  refreshSftpJobs(): void | Promise<void>;
  refreshUpdateStatus(): void | Promise<void>;
  notify(text: string, level: 'info' | 'success' | 'error', options: { action?: Record<string, unknown> }): void;
  showDesktopNotification(event: NotificationEvent): void;
  persist(id: number): void;
}

export function createNotificationEventService(state: NotificationEventState, hooks: NotificationEventHooks) {
  async function handle(event: NotificationEvent | null | undefined, options: { display?: boolean; fromDesktop?: boolean } = {}) {
    if (!event || typeof event !== 'object' || !state.accept(event)) return false;
    if (event.type === 'sftp' && (event.action?.sftp_job_id || event.action?.download_job_id) && ['success', 'error'].includes(String(event.level || ''))) {
      hooks.settleSftpJob(event);
      void hooks.refreshSftpJobs();
    }
    if (event.type === 'update') await hooks.refreshUpdateStatus();
    const context = hooks.context();
    const allowed = !['off', 'muted'].includes(String(context.notificationMode || ''));
    if (options.display !== false && event.silent !== true && !(event.type === 'update' && context.updateIgnored) && allowed) {
      const level = event.level === 'error' ? 'error' : event.level === 'success' ? 'success' : 'info';
      hooks.notify(`${event.title || ''}${event.message ? `\n${event.message}` : ''}`, level, {action: event.action});
      if (!options.fromDesktop) hooks.showDesktopNotification(event);
    }
    hooks.persist(Number(state.state?.lastId ?? state.lastId ?? 0));
    return true;
  }
  return {handle};
}



export interface InstalledFeaturesEfficiencyNotificationEventServiceServices {
  termaNotificationEvents?: ReturnType<typeof createNotificationEventService>;
}
