import {sharedServices} from '@/shared/installed-services';
export interface ApplicationDesktopEvents {
  onSftpDragError?(callback: (message: unknown) => void): () => void;
  onRemoteProfileSettings?(callback: (id: unknown) => void): () => void;
}

interface ApplicationLifecyclePort {
  window: Window;
  document: Document;
  desktop(): ApplicationDesktopEvents | undefined;
  refreshTerminals(): unknown;
  syncVncClipboard(): unknown;
  openRemoteProfile(id: number): boolean;
  notifyDragError(message: string): void;
}

export function createApplicationLifecycleService(port: ApplicationLifecyclePort) {
  let active = false, bound = false, revision = 0, lastFailure = '';
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let clipboardTimer: ReturnType<typeof setTimeout> | undefined;
  let profileTimer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let desktopBound = false, desktopRevision = 0;
  const pendingProfiles = new Set<number>();
  const subscriptions: Array<() => void> = [];
  const listeners: Array<() => void> = [];

  function attempt(operation: string, callback: () => unknown) {
    try {
      void Promise.resolve(callback()).catch(() => { lastFailure = operation; });
    } catch {
      lastFailure = operation;
    }
  }

  function cancelResume() {
    clearTimeout(resumeTimer);
    clearTimeout(clipboardTimer);
    if (frame !== undefined) port.window.cancelAnimationFrame(frame);
    resumeTimer = clipboardTimer = undefined;
    frame = undefined;
  }

  function scheduleResume() {
    if (!active) return;
    cancelResume();
    const current = revision;
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined;
      if (!active || current !== revision) return;
      attempt('terminal-refresh', port.refreshTerminals);
      frame = port.window.requestAnimationFrame(() => {
        frame = undefined;
        if (active && current === revision) attempt('terminal-refresh', port.refreshTerminals);
      });
      clipboardTimer = setTimeout(() => {
        clipboardTimer = undefined;
        if (active && current === revision) attempt('vnc-clipboard', port.syncVncClipboard);
      }, 120);
    }, 0);
  }

  function flushProfiles() {
    profileTimer = undefined;
    if (!active) return;
    for (const id of pendingProfiles) {
      try {
        if (port.openRemoteProfile(id)) pendingProfiles.delete(id);
      } catch {
        pendingProfiles.delete(id);
        lastFailure = 'remote-profile';
      }
    }
    if (pendingProfiles.size) profileTimer = setTimeout(flushProfiles, 50);
  }

  function queueProfile(value: unknown) {
    if (!active || !['number', 'string'].includes(typeof value)) return;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    pendingProfiles.add(id);
    if (profileTimer === undefined) flushProfiles();
  }

  function unbindDesktop() {
    desktopRevision++;
    for (const remove of subscriptions.splice(0)) attempt('desktop-unsubscribe', remove);
    desktopBound = false;
  }

  function bindDesktop() {
    if (!active || desktopBound) return;
    const desktop = port.desktop();
    if (!desktop) return;
    const current = revision;
    const desktopCurrent = desktopRevision;
    try {
      const drag = desktop.onSftpDragError?.(message => {
        if (active && current === revision && desktopCurrent === desktopRevision) attempt('drag-error', () => port.notifyDragError(typeof message === 'string' ? message : ''));
      });
      if (drag) subscriptions.push(drag);
      const profile = desktop.onRemoteProfileSettings?.(id => {
        if (active && current === revision && desktopCurrent === desktopRevision) queueProfile(id);
      });
      if (profile) subscriptions.push(profile);
      desktopBound = true;
    } catch {
      unbindDesktop();
      lastFailure = 'desktop-subscribe';
    }
  }

  function suspend() {
    active = false;
    revision++;
    cancelResume();
    clearTimeout(profileTimer);
    profileTimer = undefined;
    pendingProfiles.clear();
    unbindDesktop();
  }

  function resume() {
    if (!bound) return;
    active = true;
    bindDesktop();
    scheduleResume();
  }

  function start() {
    if (bound) return;
    bound = active = true;
    const listen = (target: EventTarget, name: string, callback: EventListener) => {
      target.addEventListener(name, callback);
      listeners.push(() => target.removeEventListener(name, callback));
    };
    listen(port.window, 'message', event => {
      const message=event as MessageEvent;
      if(message.origin!==port.window.location.origin || !message.source || message.source===port.window) return;
      try {if((message.source as Window).opener!==port.window)return;} catch {return;}
      const data:unknown=message.data;
      if(data && typeof data==='object' && 'type' in data && data.type==='terma:remote-profile-settings' && 'profileId' in data) queueProfile(data.profileId);
    });
    listen(port.window, 'focus', scheduleResume);
    listen(port.window, 'pageshow', resume);
    listen(port.window, 'pagehide', suspend);
    listen(port.document, 'visibilitychange', () => { if (!port.document.hidden) scheduleResume(); });
    bindDesktop();
  }

  function dispose() {
    suspend();
    for (const remove of listeners.splice(0)) remove();
    bound = false;
  }

  return {
    start, scheduleResume, suspend, resume, dispose,
    status: () => ({active, bound, desktopBound, pendingProfiles: pendingProfiles.size,
      timers: Number(resumeTimer !== undefined) + Number(clipboardTimer !== undefined) + Number(profileTimer !== undefined),
      framePending: frame !== undefined, lastFailure})
  };
}

export function installApplicationLifecycleService(port: ApplicationLifecyclePort) {
  return sharedServices.termaApplicationLifecycle ??= createApplicationLifecycleService(port);
}



export interface InstalledSharedApplicationLifecycleServiceServices {
  termaApplicationLifecycle?: ReturnType<typeof createApplicationLifecycleService>;
}
