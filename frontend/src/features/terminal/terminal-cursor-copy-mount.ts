import { Fragment, h, render } from 'vue';
import type { ITheme } from '@xterm/xterm';
import { settingsIcon } from '../settings/settings-icon';
import { selectTerminalCursorRange, terminalCellAtPointer, type TerminalInteractionSession } from './terminal-interaction-service';

type Point = { column: number; row: number };
export interface TerminalCursorCopyState {
  originalTheme: ITheme;
  phase: 'start' | 'end';
  cancel(clearSelection?: boolean, focus?: boolean): void;
}

export interface TerminalCursorCopyPort {
  session(key: string): TerminalInteractionSession | undefined;
  mount(key: string, session: TerminalInteractionSession): HTMLElement | null;
  capture(key: string): { isCurrent(): boolean };
  focus(key: string): void;
  mobile(): boolean;
  copy(text: string): Promise<unknown>;
  format(text: string): string;
  tr(key: string): string;
  notify(message: string, type: 'error' | 'info'): void;
}

export function createTerminalCursorCopyMount(port: TerminalCursorCopyPort) {
  function cancel(session: TerminalInteractionSession | undefined, key: string, clearSelection = true, focus = true) {
    session?.cursorCopyState?.cancel(clearSelection, focus);
  }

  function start(key: string) {
    const session = port.session(key);
    const mount = session && port.mount(key, session);
    if (!session?.term || !mount || typeof session.term.select !== 'function') {
      return port.notify(port.tr('terminal:settings.cursor_copy_unsupported'), 'error');
    }
    cancel(session, key);
    const owner = port.capture(key);
    const hint = document.createElement('div');
    hint.className = 'terminal-cursor-copy-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.setAttribute('data-i18n-skip', '');
    let startPoint: Point | null = null;
    let current: Point | null = null;
    let pointerId: number | null = null;
    let capturedPointer: number | null = null;
    let scrollTimer: ReturnType<typeof setInterval> | undefined;
    let scrollDirection = 0;
    let lastPointer: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'> | null = null;
    let copying = false;
    const state: TerminalCursorCopyState = {
      originalTheme: { ...(session.term.options.theme || {}) }, phase: 'start',
      cancel(clearSelection = true, focus = true) {
        if (session.cursorCopyState !== state) return;
        mount.removeEventListener('pointerdown', down, true);
        mount.removeEventListener('pointermove', move, true);
        mount.removeEventListener('pointerup', up, true);
        mount.removeEventListener('pointercancel', cancelled, true);
        document.removeEventListener('keydown', keyDown, true);
        window.removeEventListener('terma:language-changed', refresh);
        stopScroll();
        if (capturedPointer !== null && mount.hasPointerCapture?.(capturedPointer)) mount.releasePointerCapture(capturedPointer);
        render(null, hint);
        hint.remove();
        mount.classList.remove('terminal-cursor-copy-active');
        session.term.options.theme = state.originalTheme;
        if (clearSelection) session.term.clearSelection?.();
        session.cursorCopyState = null;
        if (focus) port.focus(key);
      }
    };
    function refresh() {
      hint.title = port.tr('terminal:settings.cursor_copy_touch_hint');
      render(h(Fragment, null, [
        settingsIcon('mouse-pointer-2'),
        h('span', { class: 'terminal-cursor-copy-message' }, port.tr(state.phase === 'start'
          ? 'terminal:settings.cursor_copy_start' : 'terminal:settings.cursor_copy_end')),
        h('button', {
          class: 'icon-button terminal-cursor-copy-cancel', type: 'button',
          title: port.tr('terminal:settings.cursor_copy_cancel'), 'aria-label': port.tr('terminal:settings.cursor_copy_cancel'),
          onPointerdown: (event: PointerEvent) => event.stopPropagation(),
          onClick: (event: MouseEvent) => { event.stopPropagation(); state.cancel(); }
        }, [settingsIcon('x')])
      ]), hint);
    }
    function stop(event: Event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    function stopScroll() {
      scrollDirection = 0;
      clearInterval(scrollTimer);
      scrollTimer = undefined;
    }
    function update(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>) {
      const point = terminalCellAtPointer(event, session!, port.mobile());
      if (!point) return null;
      current = point;
      selectTerminalCursorRange(session!, state.phase === 'end' ? startPoint : point, point);
      return point;
    }
    function scroll(event: PointerEvent) {
      lastPointer = { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType };
      const rect = mount!.getBoundingClientRect();
      const edge = Math.min(56, Math.max(34, rect.height * .1));
      const direction = event.clientY < rect.top + edge ? -1 : event.clientY > rect.bottom - edge ? 1 : 0;
      if (direction === scrollDirection) return;
      stopScroll();
      scrollDirection = direction;
      if (!direction) return;
      scrollTimer = setInterval(() => {
        if (!owner.isCurrent()) return state.cancel(true, false);
        if (pointerId === null || !lastPointer) return stopScroll();
        session!.term.scrollLines(direction);
        update(lastPointer);
      }, 55);
    }
    function down(event: PointerEvent) {
      if ((event.target as Element)?.closest?.('.terminal-cursor-copy-cancel') || copying) return;
      if (!owner.isCurrent()) return state.cancel(true, false);
      if (!update(event)) return;
      pointerId = event.pointerId;
      try {
        mount!.setPointerCapture?.(event.pointerId);
        capturedPointer = mount!.hasPointerCapture?.(event.pointerId) ? event.pointerId : null;
      } catch {
        // Selection can continue within the mount when pointer capture is unavailable.
        capturedPointer = null;
      }
      scroll(event);
      stop(event);
    }
    function move(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      if (!owner.isCurrent()) return state.cancel(true, false);
      update(event);
      scroll(event);
      stop(event);
    }
    function up(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      if (!owner.isCurrent()) return state.cancel(true, false);
      const point = update(event) || current;
      if (capturedPointer !== null && mount!.hasPointerCapture?.(capturedPointer)) mount!.releasePointerCapture(capturedPointer);
      capturedPointer = null;
      pointerId = null;
      stopScroll();
      stop(event);
      if (!point) return;
      if (state.phase === 'start') {
        startPoint = point;
        state.phase = 'end';
        refresh();
        selectTerminalCursorRange(session!, point, point);
        return;
      }
      selectTerminalCursorRange(session!, startPoint, point);
      const text = session!.term.getSelection?.() || '';
      if (!text) {
        port.notify(port.tr('terminal:settings.cursor_copy_empty'), 'info');
        return state.cancel();
      }
      copying = true;
      void port.copy(port.format(text)).catch(() => {
        if (owner.isCurrent() && session!.cursorCopyState === state) port.notify(port.tr('terminal:settings.save_failed'), 'error');
      }).finally(() => {
        if (session!.cursorCopyState === state) state.cancel(true, owner.isCurrent());
      });
    }
    function cancelled(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      stopScroll();
      stop(event);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') state.cancel();
    }
    session.cursorCopyState = state;
    session.term.options.theme = { ...state.originalTheme,
      selectionBackground: '#2563eb', selectionForeground: '#ffffff', selectionInactiveBackground: '#2563eb' };
    refresh();
    mount.appendChild(hint);
    mount.classList.add('terminal-cursor-copy-active');
    mount.addEventListener('pointerdown', down, true);
    mount.addEventListener('pointermove', move, true);
    mount.addEventListener('pointerup', up, true);
    mount.addEventListener('pointercancel', cancelled, true);
    document.addEventListener('keydown', keyDown, true);
    window.addEventListener('terma:language-changed', refresh);
  }
  return { start, cancel };
}



export interface InstalledFeaturesTerminalTerminalCursorCopyMountServices {
  termaTerminalCursorCopy?: ReturnType<typeof createTerminalCursorCopyMount>;
}
