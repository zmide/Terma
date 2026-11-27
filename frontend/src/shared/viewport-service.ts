import {sharedServices} from '@/shared/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {isMobileLayout} from '@/shared/browser-ui';
import { syncResponsivePane } from '@/features/workspace/workspace-dock-runtime';

interface ViewportPort {
  document: Document;
  window: Window;
  isMobile(): boolean;
  syncResponsivePane(): void;
  fit(): void;
  cancelFit(): void;
}

interface HeightOptions {
  force?: boolean;
  preferLayout?: boolean;
}

export function createViewportService(port: ViewportPort) {
  let nativeFileDialogPending = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listeners: Array<() => void> = [];
  let revision = 0;

  function clearTimers() {
    revision++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function later(callback: () => void, delay: number) {
    const current = revision;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (current === revision) callback();
    }, delay);
    timers.add(timer);
  }

  function resetShellScroll() {
    if (!port.isMobile()) return;
    const content = port.document.querySelector<HTMLElement>('#content.mobile-show');
    if (!content) return;
    for (const shell of [content, ...content.querySelectorAll<HTMLElement>('.workspace-dock, .workspace-split, .workspace-pane')]) {
      if (shell.scrollTop) shell.scrollTop = 0;
      if (shell.scrollLeft) shell.scrollLeft = 0;
    }
  }

  function sync(options: HeightOptions = {}) {
    const visualHeight = Number(port.window.visualViewport?.height || 0);
    const layoutHeight = Number(port.window.innerHeight || 0);
    const visibleHeight = visualHeight || layoutHeight;
    const root = port.document.documentElement;
    if (visibleHeight > 0) {
      root.style.setProperty('--visible-viewport-height', `${Math.round(visibleHeight)}px`);
      root.style.setProperty('--visible-viewport-top', `${Math.max(0, Math.round(port.window.visualViewport?.offsetTop || 0))}px`);
    }
    if (nativeFileDialogPending && options.force !== true) return;
    const height = options.preferLayout ? Math.max(visualHeight, layoutHeight) : visualHeight || layoutHeight;
    if (!(height > 0)) return;
    root.style.setProperty('--app-height', `${Math.round(height)}px`);
    port.fit();
  }

  function beginFileDialog() {
    clearTimers();
    nativeFileDialogPending = true;
    later(settleFileDialog, 1400);
  }

  function settleFileDialog() {
    clearTimers();
    nativeFileDialogPending = false;
    for (const delay of [0, 80, 240, 700]) {
      later(() => {
        sync({ force: true, preferLayout: true });
        port.syncResponsivePane();
        resetShellScroll();
      }, delay);
    }
  }

  function suspend() {
    clearTimers();
    nativeFileDialogPending = false;
    port.cancelFit();
  }

  function bind() {
    if (listeners.length) return;
    const listen = (target: EventTarget | null, type: string, listener: EventListener, capture = false) => {
      if (!target) return;
      target.addEventListener(type, listener, capture);
      listeners.push(() => target.removeEventListener(type, listener, capture));
    };
    listen(port.document, 'click', event => {
      const target = event.target as Element | null;
      const input = target?.matches?.('input[type="file"]') ? target
        : target?.closest?.('.file-picker, .ftp-upload-button, .sftp-upload-button')?.querySelector('input[type="file"]');
      if (input) beginFileDialog();
    }, true);
    listen(port.document, 'change', event => {
      if ((event.target as Element | null)?.matches?.('input[type="file"]')) settleFileDialog();
    }, true);
    listen(port.window, 'focus', () => later(nativeFileDialogPending ? settleFileDialog : sync, 80));
    listen(port.window, 'pageshow', settleFileDialog);
    listen(port.window, 'pagehide', suspend);
    listen(port.window.visualViewport, 'resize', () => sync());
    listen(port.window.visualViewport, 'scroll', () => sync());
    listen(port.window, 'resize', () => { sync(); port.syncResponsivePane(); });
    listen(port.window, 'orientationchange', () => later(sync, 250));
    listen(port.window, 'focusout', () => later(sync, 120));
  }

  function dispose() {
    for (const remove of listeners) remove();
    listeners.length = 0;
    suspend();
  }

  return {
    sync, beginFileDialog, settleFileDialog, resetShellScroll, bind, dispose,
    getSnapshot: () => ({ nativeFileDialogPending, timers: timers.size, bound: listeners.length > 0 })
  };
}

export function installViewportService() {
  if (sharedServices.termaViewport) return;
  sharedServices.termaViewport = createViewportService({
    document, window,
    isMobile: () => isMobileLayout(),
    syncResponsivePane,
    fit: () => terminalServices.termaTerminalViewport.schedule(),
    cancelFit: () => terminalServices.termaTerminalViewport.cancel()
  });
}




export const beginNativeFileDialogViewport=()=>sharedServices.termaViewport.beginFileDialog();
export const resetMobileWorkspaceShellScroll=()=>sharedServices.termaViewport.resetShellScroll();
export const settleNativeFileDialogViewport=()=>sharedServices.termaViewport.settleFileDialog();
export const bindNativeFileDialogViewportRecovery=()=>sharedServices.termaViewport.bind();
export const syncViewportHeight=(...args:Parameters<(typeof sharedServices)['termaViewport']['sync']>)=>sharedServices.termaViewport.sync(...args);

export interface InstalledSharedViewportServiceServices {
  termaViewport: ReturnType<typeof createViewportService>;
}
