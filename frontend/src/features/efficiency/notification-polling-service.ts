import type { NotificationEvent } from './notification-event-service';
import type { createNotificationStateService } from './notification-state-service';

interface NotificationPollingPort {
  request(path: string): Promise<unknown>;
  language(): string;
  handle(event: NotificationEvent): Promise<unknown>;
  persist(id: number): void;
}

export function createNotificationPollingService(state: ReturnType<typeof createNotificationStateService>, port: NotificationPollingPort) {
  let cursorPromise: Promise<void> | null = null;
  let lastError: unknown = null;
  function events(value: unknown): NotificationEvent[] {
    if (!Array.isArray(value)) throw new TypeError('Invalid notification response');
    return value.filter(item => item && typeof item === 'object');
  }
  function initialize() {
    if (state.state.cursorInitialized) return Promise.resolve();
    if (cursorPromise) return cursorPromise;
    if (!state.beginCursor()) return Promise.resolve();
    cursorPromise = Promise.resolve().then(async () => {
      try {
        const received = events(await port.request(`/api/notifications?since=0&language=${encodeURIComponent(port.language())}`));
        state.finishCursor(received);
        port.persist(state.state.lastId);
        lastError = null;
      } catch (error) {
        state.cancelCursor();
        lastError = error;
        throw error;
      } finally { cursorPromise = null; }
    });
    return cursorPromise;
  }
  async function poll() {
    if (!state.beginPoll()) return;
    try {
      if (!state.state.cursorInitialized) { await initialize(); return; }
      const received = events(await port.request(`/api/notifications?since=${encodeURIComponent(state.state.lastId)}&language=${encodeURIComponent(port.language())}`));
      for (const event of received) await port.handle(event);
      lastError = null;
    } catch (error) {
      lastError = error;
    } finally { state.endPoll(); }
  }
  return { initialize, poll, get lastError() { return lastError; } };
}



export interface InstalledFeaturesEfficiencyNotificationPollingServiceServices {
  termaNotificationPollingContext?: () => Omit<NotificationPollingPort, 'persist'>;
  termaNotificationPolling?: ReturnType<typeof createNotificationPollingService>;
}
