import {sharedServices} from '@/shared/installed-services';
export interface BootstrapBackgroundPort {
  startAutoRefresh?: () => void | Promise<void>;
  pollNotifications?: () => void | Promise<void>;
  refreshSftpJobs?: () => void | Promise<void>;
  startSftpJobsTimer?: () => void | Promise<void>;
  initProductivityFeatures?: () => void | Promise<void>;
  stopAutoRefresh?: () => void | Promise<void>;
  stopSftpJobsTimer?: () => void | Promise<void>;
  stopProductivityFeatures?: () => void | Promise<void>;
}

export interface BootstrapBackgroundSnapshot {
  started: boolean;
  detached: boolean;
  changedAt: number;
}

export interface BootstrapBackgroundLifecycleHost {
  addEventListener?: (type: 'pagehide' | 'pageshow', listener: EventListener) => void;
  removeEventListener?: (type: 'pagehide' | 'pageshow', listener: EventListener) => void;
}

export interface BootstrapBackgroundService {
  getSnapshot(): BootstrapBackgroundSnapshot;
  start(port: BootstrapBackgroundPort, options?: { detached?: boolean }): Promise<void>;
  stop(): Promise<void>;
  bindLifecycle(host?: BootstrapBackgroundLifecycleHost): void;
  unbindLifecycle(): void;
}

export function createBootstrapBackgroundService(): BootstrapBackgroundService {
  let snapshot: BootstrapBackgroundSnapshot = {
    started: false,
    detached: false,
    changedAt: Date.now()
  };
  let startPromise: Promise<void> | null = null;
  let activePort: BootstrapBackgroundPort | null = null;
  let lastPort: BootstrapBackgroundPort | null = null;
  let lastOptions: { detached?: boolean } = {};
  let lifecycleHost: BootstrapBackgroundLifecycleHost | null = null;
  let lifecycleWasRunning = false;
  let lifecycleStopPromise: Promise<void> | null = null;

  const update = (next: Partial<BootstrapBackgroundSnapshot>) => {
    snapshot = { ...snapshot, ...next, changedAt: Date.now() };
  };

  const onPageHide: EventListener = () => {
    if (snapshot.started || startPromise) lifecycleWasRunning = true;
    if (!lifecycleWasRunning || lifecycleStopPromise) return;
    lifecycleStopPromise = stop().finally(() => { lifecycleStopPromise = null; });
  };

  const onPageShow: EventListener = () => {
    if (!lifecycleWasRunning || snapshot.started || startPromise || !lastPort) return;
    void (async () => {
      await lifecycleStopPromise;
      if (!lifecycleWasRunning || snapshot.started || startPromise || !lastPort) return;
      lifecycleWasRunning = false;
      await start(lastPort, lastOptions);
    })();
  };

  const bindLifecycle = (host?: BootstrapBackgroundLifecycleHost) => {
    if (lifecycleHost === host) return;
    if (lifecycleHost) {
      lifecycleHost.removeEventListener?.('pagehide', onPageHide);
      lifecycleHost.removeEventListener?.('pageshow', onPageShow);
    }
    lifecycleHost = host || null;
    lifecycleHost?.addEventListener?.('pagehide', onPageHide);
    lifecycleHost?.addEventListener?.('pageshow', onPageShow);
  };

  const unbindLifecycle = () => bindLifecycle();

  async function start(port: BootstrapBackgroundPort, options: { detached?: boolean } = {}) {
    if (snapshot.started) return;
    if (startPromise) return startPromise;
    lastPort = port;
    lastOptions = { detached: options.detached === true };
    activePort = port;
    const detached = options.detached === true;
    update({ detached });
    if (detached) {
      update({ started: true });
      return;
    }
    startPromise = (async () => {
      await port.startAutoRefresh?.();
      await port.pollNotifications?.();
      await port.refreshSftpJobs?.();
      await port.startSftpJobsTimer?.();
      await port.initProductivityFeatures?.();
      update({ started: true });
    })();
    try {
      await startPromise;
    } catch (error) {
      startPromise = null;
      activePort = null;
      update({ started: false });
      throw error;
    }
  }

  async function stop() {
    if (!snapshot.started && !startPromise) return;
    await startPromise;
    startPromise = null;
    const port = activePort;
    await port?.stopAutoRefresh?.();
    await port?.stopSftpJobsTimer?.();
    await port?.stopProductivityFeatures?.();
    activePort = null;
    update({ started: false, detached: false });
  }

  return {
    getSnapshot: () => ({ ...snapshot }),
    start,
    stop,
    bindLifecycle,
    unbindLifecycle
  };
}

export function installBootstrapBackgroundService(): BootstrapBackgroundService {
  if (sharedServices.termaBootstrapBackground) return sharedServices.termaBootstrapBackground;
  const service = createBootstrapBackgroundService();
  sharedServices.termaBootstrapBackground = service;
  window.dispatchEvent(new CustomEvent('terma-bootstrap-background-ready'));
  return service;
}



export interface InstalledSharedBootstrapBackgroundServices {
  termaBootstrapBackground?: BootstrapBackgroundService;
}
