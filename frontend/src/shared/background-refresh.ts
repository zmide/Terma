export interface BackgroundRefreshPort {
  refreshUiState(options?: { force?: boolean }): void | Promise<unknown>;
  pollNotifications?: () => void | Promise<void>;
  refreshIntervalMs?: () => number;
  isDesktop?: () => boolean;
}

export interface BackgroundRefreshTimerApi {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface BackgroundRefreshPage {
  hidden?: boolean;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
}

export interface BackgroundRefreshService {
  start(): void;
  stop(): void;
  get running(): boolean;
}

const FOREGROUND_NOTIFICATION_POLL_MS = 1200;
const BACKGROUND_NOTIFICATION_POLL_MS = 15000;
const DEFAULT_REFRESH_INTERVAL_MS = 4000;
const BACKGROUND_REFRESH_INTERVAL_MS = 15000;

const positiveInterval = (value: unknown, fallback: number) => {
  const interval = Number(value);
  return Number.isFinite(interval) && interval > 0 ? interval : fallback;
};

export function createBackgroundRefreshService(
  port: BackgroundRefreshPort,
  page: BackgroundRefreshPage = document,
  timers?: BackgroundRefreshTimerApi
): BackgroundRefreshService {
  const timerApi: BackgroundRefreshTimerApi = timers || {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: timer => window.clearTimeout(timer as number)
  };
  let started = false;
  let refreshTimer: unknown = null;
  let notificationTimer: unknown = null;
  const initialTimers = new Set<unknown>();

  const isHidden = () => page.hidden === true;
  const isDesktop = () => port.isDesktop?.() === true;
  const refreshIntervalMs = () => positiveInterval(port.refreshIntervalMs?.(), DEFAULT_REFRESH_INTERVAL_MS);
  const clear = (timer: unknown) => {
    if (timer !== null) timerApi.clearTimeout(timer);
    return null;
  };
  const scheduleRefresh = (delay: number) => {
    refreshTimer = clear(refreshTimer);
    if (!started) return;
    refreshTimer = timerApi.setTimeout(() => {
      refreshTimer = null;
      void (async () => {
        try {
          if (!isHidden()) await port.refreshUiState?.();
        } finally {
          scheduleRefresh(isHidden() ? BACKGROUND_REFRESH_INTERVAL_MS : refreshIntervalMs());
        }
      })();
    }, Math.max(0, Number(delay || 0)));
  };
  const scheduleNotifications = (delay: number) => {
    notificationTimer = clear(notificationTimer);
    if (!started || isDesktop() || !port.pollNotifications) return;
    notificationTimer = timerApi.setTimeout(() => {
      notificationTimer = null;
      void (async () => {
        try {
          if (!isHidden()) await port.pollNotifications?.();
        } finally {
          scheduleNotifications(isHidden() ? BACKGROUND_NOTIFICATION_POLL_MS : FOREGROUND_NOTIFICATION_POLL_MS);
        }
      })();
    }, Math.max(0, Number(delay || 0)));
  };
  const scheduleInitial = (delay: number, force: boolean) => {
    const timer = timerApi.setTimeout(() => {
      initialTimers.delete(timer);
      if (!started || isHidden()) return;
      void port.refreshUiState?.({ force });
    }, delay);
    initialTimers.add(timer);
  };
  const onVisibilityChange: EventListener = () => {
    if (!started || isHidden()) return;
    void port.refreshUiState?.();
    if (!isDesktop()) void port.pollNotifications?.();
    scheduleRefresh(refreshIntervalMs());
    scheduleNotifications(FOREGROUND_NOTIFICATION_POLL_MS);
  };

  return {
    start() {
      if (started) return;
      started = true;
      page.addEventListener?.('visibilitychange', onVisibilityChange);
      scheduleInitial(800, true);
      scheduleInitial(2500, false);
      scheduleRefresh(refreshIntervalMs());
      scheduleNotifications(FOREGROUND_NOTIFICATION_POLL_MS);
    },
    stop() {
      if (!started && refreshTimer === null && notificationTimer === null) return;
      started = false;
      refreshTimer = clear(refreshTimer);
      notificationTimer = clear(notificationTimer);
      for (const timer of initialTimers) timerApi.clearTimeout(timer);
      initialTimers.clear();
      page.removeEventListener?.('visibilitychange', onVisibilityChange);
    },
    get running() { return started; }
  };
}




