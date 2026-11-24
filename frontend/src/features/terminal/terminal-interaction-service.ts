import type {terminalViewport} from './terminal-viewport-service';
import type { IBufferLine, IDisposable, ILink, Terminal } from '@xterm/xterm';
import type { TerminalSettingsValues } from './terminal-settings-port';
import type { TerminalCursorCopyState } from './terminal-cursor-copy-mount';
import type { TerminalSessionCoreConnection } from './terminal-session-core-service';
import type { SessionTab } from '../session-efficiency/session-model';

export interface TerminalInteractionSession {
  key?: string;
  connection?: TerminalSessionCoreConnection | null;
  term: Terminal & { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } };
  terminalLinkHovered?: boolean;
  globalBehaviorBound?: boolean;
  globalLinkDisposable?: IDisposable;
  globalSelectionDisposable?: IDisposable;
  autoCopyTimer?: ReturnType<typeof setTimeout>;
  cursorCopyState?: TerminalCursorCopyState | null;
}

export interface TerminalInteractionPort {
  settings(): TerminalSettingsValues;
  current(session: TerminalInteractionSession): boolean;
  tab(key: string): Pick<SessionTab, 'sessionMode'> | undefined;
  apply(session: TerminalInteractionSession): void;
  mobile(): boolean;
  open(url: string): void;
  send(key: string, text: string): unknown;
  focus(key: string): void;
  format(text: string): string;
  autoCopy(text: string): Promise<void>;
  paste(key: string): unknown;
  pasteText(key: string, text: string): unknown;
  contextMenu(event: MouseEvent, key: string, connectionId: number): void;
  showSettings(key: string): void;
  image(event: ClipboardEvent): File | null;
  mayContainImage(event: ClipboardEvent, file: File | null): boolean;
  pasteImage(key: string, connectionId: number, file: File | null): unknown;
  cancelCopy(session: TerminalInteractionSession, key: string, focus: boolean): void;
  flushViewportFit(session: TerminalInteractionSession): void;
  scheduleViewportTask(callback: () => void): ReturnType<typeof terminalViewport.scheduleTask>;
  cancelViewportTask(task: ReturnType<typeof terminalViewport.scheduleTask>|undefined): void;
  changeFont(key: string, delta: number): unknown;
}

export function escapeTerminalRegex(value: unknown) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function trimTerminalUrl(value: unknown) {
  let text = String(value || '');
  while (/[.,;:!?]$/.test(text)) text = text.slice(0, -1);
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (text.endsWith(close) && text.split(close).length > text.split(open).length) text = text.slice(0, -1);
  }
  return text;
}

export function terminalStringIndexToColumn(line: IBufferLine | undefined, stringIndex: number) {
  if (!line?.getCell) return Math.max(1, stringIndex + 1);
  let offset = 0;
  for (let column = 0; column < line.length; column++) {
    const cell = line.getCell(column);
    if (cell?.getWidth?.() === 0) continue;
    const chars = cell?.getChars() || ' ';
    if (offset >= stringIndex || offset + chars.length > stringIndex) return column + 1;
    offset += chars.length;
  }
  return Math.max(1, line.length);
}

export function terminalCellAtPointer(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>,
  session: TerminalInteractionSession, mobile: boolean) {
  const screen = session.term.element?.querySelector('.xterm-screen');
  const buffer = session.term.buffer.active;
  const cell = session.term._core?._renderService?.dimensions?.css?.cell;
  if (!screen || !buffer || !cell?.width || !cell?.height) return null;
  const rect = screen.getBoundingClientRect();
  const touchOffset = mobile && event.pointerType !== 'mouse' ? Math.max(36, cell.height * 2.5) : 0;
  const column = Math.max(0, Math.min(session.term.cols - 1, Math.floor((event.clientX - rect.left) / cell.width)));
  const viewportRow = Math.max(0, Math.min(session.term.rows - 1, Math.floor((event.clientY - touchOffset - rect.top) / cell.height)));
  return { column, row: Math.max(0, Number(buffer.viewportY || 0) + viewportRow) };
}

function bindTouchScroll(session: TerminalInteractionSession, box: HTMLElement,
  isCurrent: (session: TerminalInteractionSession) => boolean) {
  let lastY = 0;
  let carry = 0;
  const interactiveTarget = (event: TouchEvent) => {
    const target = event.target as (EventTarget & { closest?: (selectors: string) => Element | null }) | null;
    return target?.closest?.('button,a,input,textarea,select');
  };
  const start = (event: TouchEvent) => {
    if (!isCurrent(session) || interactiveTarget(event)) return;
    lastY = event.touches[0]?.clientY || 0;
    carry = 0;
  };
  const move = (event: TouchEvent) => {
    if (!isCurrent(session) || interactiveTarget(event)) return;
    if (session.cursorCopyState) {
      event.preventDefault();
      return;
    }
    const y = event.touches[0]?.clientY || lastY;
    carry += y - lastY;
    lastY = y;
    const lineHeight = session.term._core?._renderService?.dimensions?.css?.cell?.height || 18;
    const lines = Math.trunc(carry / lineHeight);
    if (!lines) return;
    try { session.term.scrollLines(-lines); }
    catch {
      // A final touch event can race terminal disposal.
    }
    carry -= lines * lineHeight;
    event.preventDefault();
  };
  box.addEventListener('touchstart', start, { passive: true });
  box.addEventListener('touchmove', move, { passive: false });
  return () => {
    box.removeEventListener('touchstart', start);
    box.removeEventListener('touchmove', move);
  };
}

export function selectTerminalCursorRange(session: TerminalInteractionSession,
  start: { column: number; row: number } | null, end: { column: number; row: number } | null) {
  if (!start || !end || typeof session.term.select !== 'function') return false;
  const columns = Math.max(1, Number(session.term.cols) || 1);
  const startOffset = start.row * columns + start.column;
  const endOffset = end.row * columns + end.column;
  const lower = Math.min(startOffset, endOffset);
  session.term.select(lower % columns, Math.floor(lower / columns), Math.abs(endOffset - startOffset) + 1);
  return true;
}

export function createTerminalInteractionService(port: TerminalInteractionPort) {
  type Binding = { key: string; mount?: HTMLElement; remove?: () => void; resetTimer?: ReturnType<typeof setTimeout> };
  type WheelBinding = { key: string; box: HTMLElement; connection?: TerminalSessionCoreConnection | null; remove: () => void };
  const bindings = new Map<TerminalInteractionSession, Binding>();
  const wheels = new Map<TerminalInteractionSession, WheelBinding>();
  const mounts = new WeakMap<HTMLElement, TerminalInteractionSession>();

  function releaseWheel(session: TerminalInteractionSession) {
    const binding = wheels.get(session);
    if (!binding) return;
    wheels.delete(session);
    binding.remove();
  }

  function enableWheel(session: TerminalInteractionSession, key: string, connection = session.connection) {
    const box = session.term.element?.closest<HTMLElement>('.terminal-box');
    if (!box) return;
    const existing = wheels.get(session);
    if (existing?.box === box && existing.key === key) {
      existing.connection = connection;
      return;
    }
    releaseWheel(session);
    let pendingDelta = 0;
    let task: ReturnType<typeof terminalViewport.scheduleTask>|undefined;
    let taskPending = false;
    const wheel = (event: WheelEvent) => {
      if (!port.current(session)) return;
      if (!event.ctrlKey) {
        port.flushViewportFit(session);
        const currentConnection = session.connection || wheels.get(session)?.connection;
        if (String(port.tab(key)?.sessionMode || currentConnection?.terminal_session_mode || 'none') !== 'persistent') return;
        const delta = Number(event.deltaY || 0);
        if (!Number.isFinite(delta) || !delta) return;
        event.preventDefault();
        event.stopPropagation();
        const lines = Math.max(-12, Math.min(12, Math.round(delta / 28) || (delta > 0 ? 1 : -1)));
        try { session.term.scrollLines(lines); }
        catch {
          // A final wheel event can race terminal disposal.
        }
        return;
      }
      if (!event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      pendingDelta = Math.max(-4, Math.min(4, pendingDelta + (event.deltaY < 0 ? 1 : -1)));
      if (taskPending) return;
      taskPending = true;
      task = port.scheduleViewportTask(() => {
        taskPending = false;
        task = undefined;
        const delta = pendingDelta;
        pendingDelta = 0;
        if (delta && port.current(session)) port.changeFont(key, delta);
      });
    };
    box.addEventListener('wheel', wheel, { passive: false, capture: true });
    wheels.set(session, {
      key, box, connection,
      remove: () => {
        box.removeEventListener('wheel', wheel, true);
        if (taskPending) port.cancelViewportTask(task);
        task = undefined;
        taskPending = false;
        pendingDelta = 0;
      }
    });
  }

  function open(text: unknown) {
    let target: URL;
    try { target = new URL(String(text || '')); } catch { return; }
    if (!['http:', 'https:', 'ftp:', 'ssh:', 'telnet:'].includes(target.protocol.toLowerCase())) return;
    port.open(target.href);
  }

  function links(session: TerminalInteractionSession, bufferLineNumber: number): ILink[] | undefined {
    const settings = port.settings();
    if (!settings.url_links_enabled) return;
    const line = session.term.buffer?.active?.getLine(bufferLineNumber - 1);
    const text = line?.translateToString(true) || '';
    const prefixes = settings.url_prefixes.map(escapeTerminalRegex).filter(Boolean);
    if (!text || !prefixes.length) return;
    const pattern = new RegExp(`(?:${prefixes.join('|')})[^\\s<>"']*`, 'gi');
    const result: ILink[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const url = trimTerminalUrl(match[0]);
      if (!url) continue;
      result.push({
        range: {
          start: { x: terminalStringIndexToColumn(line, match.index), y: bufferLineNumber },
          end: { x: terminalStringIndexToColumn(line, match.index + url.length - 1), y: bufferLineNumber }
        },
        text: url, decorations: { pointerCursor: true, underline: true },
        activate: event => {
          const current = port.settings();
          if (!port.current(session) || !current.url_links_enabled) return;
          if (current.url_ctrl_click && !(event.ctrlKey || event.metaKey)) return;
          open(url);
        },
        hover: () => { if (port.current(session)) session.terminalLinkHovered = true; },
        leave: () => { session.terminalLinkHovered = false; },
        dispose: () => { session.terminalLinkHovered = false; }
      });
    }
    return result.length ? result : undefined;
  }

  function bindSession(session: TerminalInteractionSession) {
    if (bindings.has(session)) return;
    bindings.set(session, { key: session.key || '' });
    session.globalBehaviorBound = true;
    port.apply(session);
    session.globalLinkDisposable = session.term.registerLinkProvider?.({
      provideLinks: (number, callback) => callback(port.current(session) ? links(session, number) : undefined)
    });
    session.globalSelectionDisposable = session.term.onSelectionChange?.(() => {
      clearTimeout(session.autoCopyTimer);
      session.autoCopyTimer = setTimeout(() => {
        if (!port.current(session) || !port.settings().auto_copy_selection || !session.term.hasSelection?.()) return;
        const text = port.format(session.term.getSelection() || '');
        if (text) void port.autoCopy(text);
      }, 80);
    });
  }

  function moveCursor(event: MouseEvent, session: TerminalInteractionSession, key: string) {
    if (!port.current(session) || !port.settings().ctrl_left_click_moves_cursor || session.terminalLinkHovered) return false;
    const point = terminalCellAtPointer({ clientX: event.clientX, clientY: event.clientY, pointerType: 'mouse' }, session, false);
    if (!point) return false;
    const buffer = session.term.buffer.active;
    const targetY = point.row - Number(buffer.viewportY || 0);
    const currentY = Number(buffer.baseY || 0) + Number(buffer.cursorY || 0) - Number(buffer.viewportY || 0);
    const currentX = Number(buffer.cursorX || 0);
    const vertical = targetY < currentY ? '\x1b[A'.repeat(currentY - targetY) : '\x1b[B'.repeat(targetY - currentY);
    const horizontal = point.column < currentX ? '\x1b[D'.repeat(currentX - point.column) : '\x1b[C'.repeat(point.column - currentX);
    if (vertical || horizontal) port.send(key, vertical + horizontal);
    else port.focus(key);
    return true;
  }

  function mouse(action: string, event: MouseEvent, session: TerminalInteractionSession, key: string, connectionId: number) {
    if (!port.current(session)) return;
    if (action === 'context_menu') port.contextMenu(event, key, connectionId);
    else if (action === 'paste_clipboard') port.paste(key);
    else if (action === 'open_settings') port.showSettings(key);
    else if (action === 'send_enter') port.send(key, '\r');
    else if (action === 'paste_selection') port.pasteText(key, session.term.getSelection?.() || '');
  }

  function stop(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function bind(session: TerminalInteractionSession, key: string, connectionId: number, mount?: HTMLElement | null) {
    bindSession(session);
    const binding = bindings.get(session)!;
    if (!mount) return;
    if (binding.mount === mount) {
      enableWheel(session, key);
      return;
    }
    const previous = mounts.get(mount);
    if (previous && previous !== session) release(previous);
    binding.remove?.();
    binding.key = key;
    binding.mount = mount;
    mounts.set(mount, session);
    const context = (event: MouseEvent) => {
      if (!port.current(session)) return;
      stop(event);
      if (session.cursorCopyState) return;
      mouse(port.mobile() ? 'context_menu' : port.settings().right_mouse_action, event, session, key, connectionId);
    };
    const down = (event: MouseEvent) => {
      if (!port.current(session) || session.cursorCopyState) return;
      if (event.button === 1) {
        stop(event);
        mouse(port.settings().middle_mouse_action, event, session, key, connectionId);
      } else if (event.button === 0 && event.ctrlKey && moveCursor(event, session, key)) stop(event);
      else if (event.button === 0 && event.shiftKey && event.detail >= 2) {
        const settings = port.settings();
        session.term.options.wordSeparator = settings.shift_double_click_uses_separators ? settings.word_separators : ' \t\r\n';
        clearTimeout(binding.resetTimer);
        binding.resetTimer = setTimeout(() => { if (port.current(session)) port.apply(session); }, 0);
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (!port.current(session)) return;
      const text = event.clipboardData?.getData('text/plain') || '';
      const file = port.image(event);
      if (!text && !port.mayContainImage(event, file)) return;
      stop(event);
      if (text) port.pasteText(key, text);
      else port.pasteImage(key, connectionId, file);
    };
    const scrollBox = session.term.element?.closest<HTMLElement>('.terminal-box');
    const removeTouchScroll = scrollBox ? bindTouchScroll(session, scrollBox, port.current) : () => {};
    mount.addEventListener('contextmenu', context, true);
    mount.addEventListener('mousedown', down, true);
    mount.addEventListener('paste', paste, true);
    binding.remove = () => {
      mount.removeEventListener('contextmenu', context, true);
      mount.removeEventListener('mousedown', down, true);
      mount.removeEventListener('paste', paste, true);
      removeTouchScroll();
      releaseWheel(session);
      mounts.delete(mount);
    };
    enableWheel(session, key);
  }

  function release(session: TerminalInteractionSession) {
    const binding = bindings.get(session);
    releaseWheel(session);
    if (!binding) return;
    bindings.delete(session);
    binding.remove?.();
    clearTimeout(binding.resetTimer);
    clearTimeout(session.autoCopyTimer);
    port.cancelCopy(session, binding.key, false);
    session.globalLinkDisposable?.dispose();
    session.globalSelectionDisposable?.dispose();
    session.globalLinkDisposable = undefined;
    session.globalSelectionDisposable = undefined;
    session.terminalLinkHovered = false;
    session.globalBehaviorBound = false;
  }

  return { open, links, bindSession, bind, release, enableFontWheel: enableWheel,
    enablePersistentWheel: (session: TerminalInteractionSession, connection: TerminalSessionCoreConnection) =>
      enableWheel(session, session.key || '', connection),
    moveCursor, mouse,
    escape: escapeTerminalRegex, trim: trimTerminalUrl, column: terminalStringIndexToColumn,
    cell: (event: PointerEvent, session: TerminalInteractionSession) => terminalCellAtPointer(event, session, port.mobile()),
    select: selectTerminalCursorRange };
}



export interface InstalledFeaturesTerminalTerminalInteractionServiceServices {
  termaTerminalInteraction?: ReturnType<typeof createTerminalInteractionService>;
}
