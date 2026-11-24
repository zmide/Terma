import {terminalServices} from '@/features/terminal/installed-services';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import type { TerminalOutputFlowSession, TerminalOutputTerm } from './terminal-output-flow-service';
import type { FitAddon } from '@xterm/addon-fit';

type ViewportTask = { frame?: number; timer?: ReturnType<typeof setTimeout> };
type ViewportTerm = TerminalOutputTerm & {
  element?: HTMLElement | null;
  options?: { scrollback?: number; overviewRuler?: { width?: number } };
  buffer?: { active?: { viewportY?: number; baseY?: number; ydisp?: number; ybase?: number } };
  scrollToLine?(line: number): void;
  _core?: {
    _bufferService?: { scrollLines(lines: number): void };
    _viewport?: {
      scrollToLine?(line: number, immediate: boolean): void;
      _scrollableElement?: {
        getScrollPosition?(): { scrollTop?: number };
        _scrollable?: { getFutureScrollPosition?(): { scrollTop?: number } };
      };
    };
    _renderService?: { dimensions?: {
      css?: { cell?: { width?: number; height?: number } };
      device?: { cell?: { width?: number } };
    } };
  };
};

export interface TerminalViewportAnchor {
  viewportY: number;
  atBottom: boolean;
}

export interface TerminalViewportSession extends TerminalOutputFlowSession {
  term?: ViewportTerm | null;
  fit?: { fit(): void };
  lastBoxHeight?: number;
  terminalFitWidth?: number;
  terminalFitHeight?: number;
  terminalViewportFitTask?: ViewportTask | null;
  terminalViewportRestoreTask?: ViewportTask | null;
  terminalViewportFitAnchor?: TerminalViewportAnchor | null;
}

export interface TerminalViewportPort {
  sessions(): Iterable<TerminalViewportSession>;
  capture(session: TerminalViewportSession): TerminalViewportAnchor | null;
  fitPreservingViewport?(session: TerminalViewportSession, anchor: TerminalViewportAnchor): void;
  restore?(session: TerminalViewportSession, anchor: TerminalViewportAnchor | null): void;
  error(error: unknown): void;
}

type Anchors = Map<TerminalViewportSession, TerminalViewportAnchor>;
type FitOptions = { force?: boolean };
const TERMINAL_GLYPH_SAFETY_GUTTER = 3;

export function createTerminalViewportService(port: TerminalViewportPort) {
  let pendingAnchors: Anchors | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let revision = 0;

  function captureSession(session: TerminalViewportSession | null | undefined): TerminalViewportAnchor | null {
    const buffer = session?.term?.buffer?.active;
    if (!buffer) return null;
    const viewportY = Number(buffer.viewportY ?? buffer.ydisp ?? 0);
    const baseY = Number(buffer.baseY ?? buffer.ybase ?? 0);
    return { viewportY: Math.max(0, viewportY), atBottom: viewportY >= Math.max(0, baseY) };
  }

  function scrollToLine(term: ViewportTerm | null | undefined, line: number) {
    const viewport = term?._core?._viewport;
    if (typeof viewport?.scrollToLine !== 'function') {
      term?.scrollToLine?.(line);
      return;
    }
    const buffer = term?.buffer?.active;
    const delta = line - Number(buffer?.viewportY ?? buffer?.ydisp ?? line);
    // Font changes can leave the pixels aligned without emitting a scroll event.
    // Reconcile through the engine service so buffer events and user-scroll state stay intact.
    if (delta && term?._core?._bufferService) {
      term._core._bufferService.scrollLines(delta);
      term.refresh?.(0, Math.max(0, Number(term.rows || 0) - 1));
    }
    viewport.scrollToLine(line, true);
  }

  function pixelDrift(term: ViewportTerm | null | undefined, target: number) {
    const scrollable = term?._core?._viewport?._scrollableElement;
    const cellHeight = Number(term?._core?._renderService?.dimensions?.css?.cell?.height || 0);
    if (!scrollable || !cellHeight) return false;
    const expected = target * cellHeight;
    const current = Number(scrollable.getScrollPosition?.()?.scrollTop);
    const future = Number(scrollable._scrollable?.getFutureScrollPosition?.()?.scrollTop);
    return [current, future].some(value => Number.isFinite(value) && Math.abs(value - expected) > 0.75);
  }

  function restoreSession(session: TerminalViewportSession | null | undefined, anchor: TerminalViewportAnchor | null) {
    const term = session?.term;
    const buffer = term?.buffer?.active;
    if (!term || !buffer || !anchor) return;
    const baseY = Math.max(0, Number(buffer.baseY ?? buffer.ybase ?? 0));
    const target = anchor.atBottom ? baseY : Math.max(0, Math.min(baseY, Number(anchor.viewportY) || 0));
    const current = Math.max(0, Number(buffer.viewportY ?? buffer.ydisp ?? 0));
    if (Math.abs(current - target) < 0.5 && !pixelDrift(term, target)) return;
    try { scrollToLine(term, target); } catch (error) { port.error(error); }
  }

  function scheduleTask(callback: () => void): ViewportTask {
    if (typeof requestAnimationFrame === 'function') return { frame: requestAnimationFrame(callback) };
    return { timer: setTimeout(callback, 0) };
  }

  function cancelTask(task: ViewportTask | null | undefined) {
    if (task?.frame != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(task.frame);
    if (task?.timer != null) clearTimeout(task.timer);
  }

  function runSessionFit(session: TerminalViewportSession) {
    const anchor = session.terminalViewportFitAnchor;
    if (!session.term || !session.fit || !anchor) return;
    cancelTask(session.terminalViewportFitTask);
    session.terminalViewportFitTask = null;
    session.terminalViewportFitAnchor = null;
    try { session.fit.fit(); } catch (error) { port.error(error); }
    try { session.term.refresh?.(0, Math.max(0, Number(session.term.rows || 0) - 1)); }
    catch (error) { port.error(error); }
    restoreSession(session, anchor);
    cancelTask(session.terminalViewportRestoreTask);
    const task = scheduleTask(() => {
      if (session.terminalViewportRestoreTask !== task) return;
      session.terminalViewportRestoreTask = null;
      restoreSession(session, anchor);
    });
    session.terminalViewportRestoreTask = task;
  }

  function fitSession(session: TerminalViewportSession | null | undefined, anchor = captureSession(session)) {
    if (!session?.term || !session.fit || !anchor) return;
    session.terminalViewportFitAnchor ||= anchor;
    if (session.terminalViewportFitTask) return;
    const task = scheduleTask(() => {
      if (session.terminalViewportFitTask === task) runSessionFit(session);
    });
    session.terminalViewportFitTask = task;
  }

  function cancelSession(session: TerminalViewportSession | null | undefined) {
    if (!session) return;
    cancelTask(session.terminalViewportFitTask);
    cancelTask(session.terminalViewportRestoreTask);
    session.terminalViewportFitTask = null;
    session.terminalViewportRestoreTask = null;
    session.terminalViewportFitAnchor = null;
    pendingAnchors?.delete(session);
  }

  function flushSession(session: TerminalViewportSession | null | undefined) {
    if (!session) return;
    if (session.terminalViewportFitTask) runSessionFit(session);
    cancelSession(session);
  }

  function adaptFitAddon(term: ViewportTerm, addon: FitAddon) {
    const propose = addon.proposeDimensions.bind(addon);
    addon.proposeDimensions = () => {
      const dimensions = propose();
      const element = term.element;
      const parent = element?.parentElement;
      const render = term._core?._renderService?.dimensions;
      const cellWidth = Number(render?.css?.cell?.width || 0);
      if (!dimensions || !parent || !element || !cellWidth) return dimensions;
      const parentStyle = getComputedStyle(parent);
      const elementStyle = getComputedStyle(element);
      const cssPixels = (value: string) => Number.parseInt(value, 10) || 0;
      const scrollbarWidth = term.options?.scrollback === 0 ? 0 : Number(term.options?.overviewRuler?.width || 14);
      const availableWidth = Math.max(0, Number(parent.clientWidth || cssPixels(parentStyle.width))
        - cssPixels(elementStyle.paddingLeft) - cssPixels(elementStyle.paddingRight) - scrollbarWidth);
      const deviceCellWidth = Number(render?.device?.cell?.width || 0);
      const projectedWidth = deviceCellWidth
        ? Math.round(deviceCellWidth * dimensions.cols / Math.max(1, window.devicePixelRatio || 1))
        : Math.round(dimensions.cols * cellWidth);
      if (availableWidth - projectedWidth < TERMINAL_GLYPH_SAFETY_GUTTER) dimensions.cols = Math.max(2, dimensions.cols - 1);
      return dimensions;
    };
    return addon;
  }

  function capture(): Anchors {
    const anchors: Anchors = new Map();
    for (const session of port.sessions()) {
      if (!session.term?.element?.closest('.terminal-box')?.isConnected) continue;
      const anchor = port.capture(session);
      if (anchor) anchors.set(session, anchor);
    }
    return anchors;
  }

  function remember(anchors: Anchors): Anchors {
    if (!anchors.size) return pendingAnchors || new Map();
    pendingAnchors ||= new Map();
    for (const [session, anchor] of anchors) {
      if (!pendingAnchors.has(session) && anchor) pendingAnchors.set(session, anchor);
    }
    return pendingAnchors;
  }

  function fit(anchors: Anchors | null = null, options: FitOptions = {}) {
    for (const session of port.sessions()) {
      const element = session.term?.element;
      const box = element?.closest<HTMLElement>('.terminal-box');
      if (!box?.isConnected || !element) continue;
      box.style.minHeight = '0px';
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const width = Math.floor(rect.width), height = Math.floor(rect.height);
      const heightStyle = `${height}px`;
      if (Number(session.terminalFitWidth || 0) === width
        && Number(session.terminalFitHeight || 0) === height
        && element.style.height === heightStyle && options.force !== true) continue;
      const anchor = anchors?.get(session) || port.capture(session);
      session.lastBoxHeight = rect.height;
      session.terminalFitWidth = width;
      session.terminalFitHeight = height;
      element.style.height = heightStyle;
      if (port.fitPreservingViewport && anchor) {
        port.fitPreservingViewport(session, anchor);
      } else {
        try { session.fit?.fit(); } catch (error) { port.error(error); }
        try { session.term?.refresh?.(0, Math.max(0, Number(session.term.rows || 0) - 1)); }
        catch (error) { port.error(error); }
        port.restore?.(session, anchor);
      }
    }
  }

  function clearTimers() {
    revision++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function schedule(options: FitOptions & { anchors?: Anchors } = {}) {
    const anchors = remember(options.anchors instanceof Map ? options.anchors : capture());
    fit(anchors, { force: options.force === true });
    clearTimers();
    const current = revision;
    for (const delay of [80, 240, 700]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (current !== revision) return;
        fit(anchors);
        if (delay === 700 && pendingAnchors === anchors) pendingAnchors = null;
      }, delay);
      timers.add(timer);
    }
  }

  function cancel() {
    clearTimers();
    pendingAnchors?.clear();
    pendingAnchors = null;
  }

  return {
    capture, remember, fit, schedule, cancel,
    captureSession, scrollToLine, pixelDrift, restoreSession, scheduleTask, cancelTask,
    fitSession, runSessionFit, flushSession, cancelSession, adaptFitAddon,
    release: (session: TerminalViewportSession) => pendingAnchors?.delete(session),
    getSnapshot: () => ({ pendingSessions: pendingAnchors?.size || 0, timers: timers.size })
  };
}
export const terminalViewport:ReturnType<typeof createTerminalViewportService>=createTerminalViewportService({
 sessions:()=>terminalSessions.values(),
 capture:session=>terminalViewport.captureSession(session),
 fitPreservingViewport:(session,anchor)=>terminalViewport.fitSession(session,anchor),
 restore:(session,anchor)=>terminalViewport.restoreSession(session,anchor),
 error:error=>console.warn('Terminal viewport layout failed',error)
});
export function installTerminalViewportService() {
  if (!terminalServices.termaTerminalViewport) {
    terminalServices.termaTerminalViewport = terminalViewport;
  }
}



export interface InstalledFeaturesTerminalTerminalViewportServiceServices {
  termaTerminalViewport: ReturnType<typeof createTerminalViewportService>;
}
