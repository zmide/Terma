import {terminalServices} from '@/features/terminal/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {terminalDrop} from './terminal-drop-workspace';
import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { ManagementConnection } from '../remote/management-types';
import type { TerminalPreferences } from './terminal-preferences-service';
import type { TerminalSettingsValues } from './terminal-settings-port';
import type { TerminalViewportAnchor } from './terminal-viewport-service';

type Connection = ManagementConnection & Partial<TerminalPreferences> & {
  terminal_session_mode?: string;
  terminal_session_id?: string;
  quick_token?: string;
};

export interface TerminalSurfaceSession {
  key: string;
  id: number;
  term: Terminal;
  fit: FitAddon;
  connection?: Connection;
  mount?: HTMLElement | null;
  socket: WebSocket | null;
  connected: boolean;
  sensitiveInput?: boolean;
  connectionAttempt: number;
  connectionPending: boolean;
  logId: string;
  terminalEncoding: string;
  fontLayoutMobile: boolean;
  currentDirectory: string;
  currentDirectoryKnown: boolean;
  quickToken: string;
  persistentSessionId: string;
  reconnectToken: string;
  reconnectTokenRestored: boolean;
  reconnectTokenStateHandled: boolean;
  expectingReattach: boolean;
  autoReconnectTimer: number | null;
  autoReconnectAttempts: number;
  autoReconnectPending: boolean;
  manualDisconnecting: boolean;
  observedBox?: Element | null;
  observedBoxWidth?: number;
  observedBoxHeight?: number;
  resizeObserver?: ResizeObserver | null;
}

export interface TerminalSurfacePort {
  sessions: Map<string, TerminalSurfaceSession>;
  surfaces: Map<string, HTMLElement>;
  ensureSettings(): Promise<unknown>;
  ensureLibraries(): Promise<unknown>;
  ensureZmodem(): Promise<unknown>;
  settings(): TerminalSettingsValues;
  term(options: ITerminalOptions): Terminal;
  fit(term: Terminal): FitAddon;
  token(key: string, enabled?: boolean): { token: string; restored: boolean };
  logId(): string;
  mobile(): boolean;
  active(): string;
  modalOpen(): boolean;
  mount(key: string): HTMLElement | null;
  workspaceElement(key: string, selector: string): HTMLElement | null;
  retained(mount: HTMLElement): boolean;
  connection(id: number): Connection | null;
  fontFamily(connection: Connection): string;
  fontSize(connection: Connection): number;
  wordSeparator(): string;
  theme(): ITerminalOptions['theme'];
  interrupt(term: Terminal, key: string): void;
  directory(session: TerminalSurfaceSession): void;
  apply(session: TerminalSurfaceSession): void;
  bind(session: TerminalSurfaceSession, connection: Connection, key: string, mount: HTMLElement): void;
  scheduleFit(): void;
  connect(connection: Connection, key: string): void;
  needsConnection(session: TerminalSurfaceSession): boolean;
  status(session: TerminalSurfaceSession): string;
  updateStatus(connection: Connection, key: string, state: string): void;
  capture(session: TerminalSurfaceSession): TerminalViewportAnchor | null;
  preserveFit(session: TerminalSurfaceSession, anchor: TerminalViewportAnchor | null): void;
  saveFont(connection: Connection, size: number): void;
  toolbar(key: string): void;
  error(error: unknown): void;
}

export function createTerminalSurfaceService(port: TerminalSurfacePort) {
  const attaching = new Map<string, symbol>();
  const initializers = new Map<string, ReturnType<typeof setTimeout>>();
  const focusTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function build(view: HTMLElement, key: string, content: { assistant: string; quick: string }) {
    const surface = document.createElement('div');
    surface.className = 'terminal-tab-surface';
    surface.dataset.terminalTabKey = key;
    const toolbarMount = document.createElement('div');
    toolbarMount.id = 'terminalToolbarMount';
    const toolbar = document.createElement('div');
    toolbar.className = 'terminal-toolbar';
    toolbar.dataset.workspaceTabKey = key;
    toolbar.dataset.terminalTabKey = key;
    toolbarMount.appendChild(toolbar);
    surface.appendChild(toolbarMount);
    const keys = terminalServices.termaTerminalKeysService?.createHost(key);
    if (keys) surface.appendChild(keys);
    const row = document.createElement('div');
    row.className = 'terminal-main-row';
    const mount = document.createElement('div');
    mount.id = 'terminalMount';
    mount.className = 'terminal-box';
    mount.dataset.i18nSkip = 'true';
    row.appendChild(mount);
    row.insertAdjacentHTML('beforeend', content.assistant);
    surface.appendChild(row);
    surface.insertAdjacentHTML('beforeend', content.quick);
    const composer = document.createElement('div');
    composer.className = 'terminal-mobile-composer';
    composer.dataset.terminalComposer = '';
    composer.dataset.terminalTabKey = key;
    surface.appendChild(composer);
    port.surfaces.set(key, surface);
    view.replaceChildren(surface);
    view.dataset.workspaceTabKey = key;
    view.dataset.terminalTabKey = key;
    return surface;
  }

  function element(key: string, selector: string): HTMLElement | null {
    const owned = port.workspaceElement(key, selector) || port.surfaces.get(key)?.querySelector<HTMLElement>(selector);
    if (owned) return owned;
    const toolbar = document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
    const control = toolbar?.querySelector<HTMLElement>(selector);
    if (control) return control;
    const pane = port.sessions.get(key)?.term?.element?.closest('.workspace-pane');
    return pane?.querySelector<HTMLElement>(selector) || null;
  }

  function park(view: HTMLElement | null | undefined) {
    const key = String(view?.dataset.terminalTabKey || '');
    const surface = port.surfaces.get(key);
    const mount = surface?.querySelector('#terminalToolbarMount');
    if (!key || !surface || !mount) return;
    const toolbar = [...document.querySelectorAll<HTMLElement>('.terminal-toolbar[data-workspace-tab-key]')]
      .find(element => element.dataset.workspaceTabKey === key) || surface.querySelector<HTMLElement>('.terminal-toolbar');
    if (!toolbar) return;
    if (toolbar.parentElement !== mount) mount.appendChild(toolbar);
    toolbar.hidden = true;
    toolbar.classList.remove('terminal-toolbar-header');
  }

  function current(session: TerminalSurfaceSession, mount = session.mount) {
    return port.sessions.get(session.key) === session && !!mount
      && (mount.isConnected || port.retained(mount)) && port.mount(session.key) === mount;
  }

  function observe(session: TerminalSurfaceSession) {
    const box = session.term.element?.closest('.terminal-box');
    if (!box || typeof ResizeObserver === 'undefined') return;
    if (session.observedBox === box && session.resizeObserver) return;
    session.resizeObserver?.disconnect();
    session.resizeObserver = new ResizeObserver(entries => {
      if (!current(session) || session.observedBox !== box) return;
      const rect = entries[0]?.contentRect;
      const width = Math.floor(Number(rect?.width || 0));
      const height = Math.floor(Number(rect?.height || 0));
      if (width > 0 && height > 0 && session.observedBoxWidth === width && session.observedBoxHeight === height) return;
      session.observedBoxWidth = width;
      session.observedBoxHeight = height;
      port.scheduleFit();
    });
    session.observedBox = box;
    session.resizeObserver.observe(box);
  }

  function createSession(connection: Connection, key: string): TerminalSurfaceSession {
    const term = port.term({
      allowProposedApi: true, cursorBlink: true, convertEol: false,
      scrollback: Number(port.settings().scrollback_lines) || 30000,
      minimumContrastRatio: 4.5, overviewRuler: { width: 8 },
      fontFamily: port.fontFamily(connection), fontSize: port.fontSize(connection),
      lineHeight: Number(connection.terminal_line_height) || 1,
      fontWeight: connection.terminal_font_weight as ITerminalOptions['fontWeight'] || 'normal',
      wordSeparator: port.wordSeparator(), theme: port.theme()
    });
    const fit = port.fit(term);
    try { term.loadAddon(fit); }
    catch (error) { term.dispose(); throw error; }
    const token = port.token(key, !connection.quick_connection && String(connection.terminal_session_mode || 'none') !== 'persistent');
    const session: TerminalSurfaceSession = {
      key, id: connection.id, term, fit, socket: null, connected: false, connectionAttempt: 0, connectionPending: false,
      logId: port.logId(), terminalEncoding: connection.terminal_encoding || 'utf8', fontLayoutMobile: port.mobile(),
      currentDirectory: '', currentDirectoryKnown: false,
      quickToken: connection.quick_connection ? String(connection.quick_token || '') : '',
      persistentSessionId: String(connection.terminal_session_id || ''),
      reconnectToken: token.token, reconnectTokenRestored: token.restored, reconnectTokenStateHandled: false,
      expectingReattach: false, autoReconnectTimer: null, autoReconnectAttempts: 0,
      autoReconnectPending: false, manualDisconnecting: false
    };
    port.sessions.set(key, session);
    port.interrupt(term, key);
    port.directory(session);
    return session;
  }

  async function attach(connection: Connection, key: string, mount: HTMLElement | null) {
    if (!mount) return;
    const request = Symbol(key);
    attaching.set(key, request);
    const valid = () => attaching.get(key) === request
      && (mount.isConnected || port.retained(mount)) && port.mount(key) === mount;
    try {
      await port.ensureSettings();
      if (!valid()) return;
      await port.ensureLibraries();
      if (!valid()) return;
      try { await port.ensureZmodem(); } catch (error) { port.error(error); }
      if (!valid()) return;
      const session = port.sessions.get(key) || createSession(connection, key);
      session.connection = connection;
      session.key = key;
      if (!session.reconnectToken && !connection.quick_connection && String(connection.terminal_session_mode || 'none') !== 'persistent') {
        const token = port.token(key);
        session.reconnectToken = token.token;
        session.reconnectTokenRestored = token.restored;
        session.reconnectTokenStateHandled = false;
        session.expectingReattach = false;
      }
      session.manualDisconnecting = false;
      session.fontLayoutMobile = port.mobile();
      session.mount = mount;
      mount.classList.toggle('terminal-persistent', String(connection.terminal_session_mode || 'none') === 'persistent'
        && Boolean(String(connection.terminal_session_id || '').trim()));
      session.term.options.fontSize = port.fontSize(connection);
      port.apply(session);
      if (session.term.element) mount.appendChild(session.term.element);
      else session.term.open(mount);
      port.bind(session, connection, key, mount);
      observe(session);
      const previous = initializers.get(key);
      if (previous != null) clearTimeout(previous);
      const timer = setTimeout(() => {
        if (initializers.get(key) !== timer) return;
        initializers.delete(key);
        if (!current(session, mount)) return;
        try { session.fit.fit(); } catch (error) { port.error(error); }
        try { session.term.refresh(0, Math.max(0, session.term.rows - 1)); } catch (error) { port.error(error); }
        focus(key);
        if (port.needsConnection(session)) port.connect(connection, key);
        else port.updateStatus(connection, key, port.status(session));
        port.scheduleFit();
      }, 0);
      initializers.set(key, timer);
    } finally {
      if (attaching.get(key) === request) attaching.delete(key);
    }
  }

  function focus(key: string) {
    const previous = focusTimers.get(key);
    if (previous != null) clearTimeout(previous);
    const session = port.sessions.get(key);
    if (!session) return;
    const timer = setTimeout(() => {
      if (focusTimers.get(key) !== timer) return;
      focusTimers.delete(key);
      if (port.mobile() || port.active() !== key || port.modalOpen() || !session.mount?.isConnected || !current(session)) return;
      try { session.term.focus(); } catch (error) { port.error(error); }
    }, 0);
    focusTimers.set(key, timer);
  }

  function syncFonts() {
    const mobile = port.mobile();
    for (const session of port.sessions.values()) {
      if (session.fontLayoutMobile === mobile) continue;
      const connection = session.connection || port.connection(session.id);
      if (!connection) continue;
      const anchor = port.capture(session);
      session.fontLayoutMobile = mobile;
      session.term.options.fontSize = port.fontSize(connection);
      port.preserveFit(session, anchor);
    }
  }

  function changeFont(key: string, delta: number) {
    const session = port.sessions.get(key);
    if (!session || !Number.isFinite(delta)) return;
    const anchor = port.capture(session);
    const size = Math.max(10, Math.min(32, Number(session.term.options.fontSize || 13) + delta));
    session.term.options.fontSize = size;
    const connection = session.connection || port.connection(session.id);
    if (connection) port.saveFont(connection, size);
    port.preserveFit(session, anchor);
    port.toolbar(key);
    focus(key);
  }

  function release(key: string) {
    attaching.delete(key);
    for (const timers of [initializers, focusTimers]) {
      const timer = timers.get(key);
      if (timer != null) clearTimeout(timer);
      timers.delete(key);
    }
    const session = port.sessions.get(key);
    if(session)terminalDrop.release(session);
    session?.resizeObserver?.disconnect();
    if (session) { session.resizeObserver = null; session.observedBox = null; }
  }

  function openSelectedSftp(connectionId: number, key: string) {
    const session = port.sessions.get(key);
    const selected = session?.term?.getSelection?.().trim() || '';
    const pathSelection = selected && !/\s/.test(selected) && /^(?:\/|\.{1,2}\/|~\/)/.test(selected);
    const path = pathSelection ? selected : session?.currentDirectoryKnown ? session.currentDirectory : '.';
    return filesServices.termaSftpPage.open(connectionId, path, true);
  }

  return { build, element, park, attach, observe, focus, syncFonts, changeFont, release, openSelectedSftp };
}

export function installTerminalSurfaceService(port:TerminalSurfacePort) {
  terminalServices.termaTerminalSurface = createTerminalSurfaceService(port);
}



export interface InstalledFeaturesTerminalTerminalSurfaceServiceServices {
  termaTerminalSurface: ReturnType<typeof createTerminalSurfaceService>;
}
