import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import type { TerminalSettingsValues } from './terminal-settings-port';
import type { TerminalViewportAnchor, TerminalViewportSession } from './terminal-viewport-service';

export interface TerminalSettingsSession extends TerminalViewportSession {
  key: string;
  connection?: {
    quick_connection?: unknown;
    terminal_font_family_inherit?: unknown;
    terminal_font_size_inherit?: unknown;
    terminal_mobile_font_size_inherit?: unknown;
  } | null;
  term?: NonNullable<TerminalViewportSession['term']> & { options: ITerminalOptions };
  mount?: HTMLElement | null;
  cursorCopyState?: { originalTheme: ITheme } | null;
}

type SettingsResponse = {
  saved?: { terminal?: unknown };
  terminal?: unknown;
};

export interface TerminalSettingsServicePort {
  api(path: string, options?: { method: string; body: string }): Promise<SettingsResponse>;
  current(): TerminalSettingsValues | null;
  defaults: TerminalSettingsValues;
  normalize(value: unknown): TerminalSettingsValues;
  commit(values: TerminalSettingsValues, response?: SettingsResponse): void;
  sessions(): Iterable<TerminalSettingsSession>;
  surfaceKeys(): Iterable<string>;
  rerenderKeys(key: string): void;
  mobile(): boolean;
  theme(values: TerminalSettingsValues): ITheme & { background: string };
  wordSeparator(values: TerminalSettingsValues): string;
  luminance(color: string): number;
  capture(session: TerminalSettingsSession): TerminalViewportAnchor | null;
  fit(session: TerminalSettingsSession, anchor: TerminalViewportAnchor): void;
  refreshToolbar(key: string): void;
  modal(): HTMLElement | null;
  show(key: string, values: TerminalSettingsValues): boolean;
  openError(): void;
}

export function createTerminalSettingsService(port: TerminalSettingsServicePort) {
  let revision = 0;
  let loading: { revision: number; promise: Promise<TerminalSettingsValues> } | null = null;
  let saving: Promise<void> = Promise.resolve();
  let openRequest = 0;
  const current = () => port.current() || port.normalize(port.defaults);

  function ensure(force = false): Promise<TerminalSettingsValues> {
    const cached = port.current();
    if (cached && !force) return Promise.resolve(cached);
    if (!force && loading?.revision === revision) return loading.promise;
    const request = ++revision;
    const promise = saving.then(() => port.api('/api/runtime-settings')).then(response => {
      const values = port.normalize(response?.saved?.terminal || response?.terminal);
      if (request !== revision) return port.current() || values;
      port.commit(values, response);
      return values;
    }).catch(() => {
      // Keep the last usable settings if a refresh fails, including during a save.
      const values = current();
      if (request === revision) port.commit(values);
      return values;
    }).finally(() => {
      if (loading?.promise === promise) loading = null;
    });
    loading = { revision: request, promise };
    return promise;
  }

  async function open(key: string): Promise<void> {
    const request = ++openRequest;
    const modal = port.modal();
    const content = modal?.firstElementChild;
    const hidden = modal?.hidden;
    const values = await ensure();
    if (request !== openRequest || port.modal() !== modal
      || modal?.firstElementChild !== content || modal?.hidden !== hidden) return;
    if (!port.show(key, values)) port.openError();
  }

  async function save(value: TerminalSettingsValues): Promise<void> {
    // Normalize before queueing so later edits cannot change an in-flight draft.
    const body = JSON.stringify({ terminal: port.normalize(value) });
    ++revision;
    const operation = saving.then(async () => {
      const response = await port.api('/api/runtime-settings', { method: 'PUT', body });
      const values = port.normalize(response?.saved?.terminal || response?.terminal);
      port.commit(values, response);
      applyAll();
    });
    // A rejected write remains visible to its caller and cannot block later writes.
    saving = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function apply(session: Omit<TerminalSettingsSession, 'key'> | null | undefined) {
    if (!session?.term) return;
    const values = current();
    const connection = session.connection;
    const options = session.term.options;
    if (connection?.quick_connection || Number(connection?.terminal_font_family_inherit || 0) === 1) {
      options.fontFamily = values.font_family;
    }
    const inheritSize = port.mobile() ? connection?.terminal_mobile_font_size_inherit : connection?.terminal_font_size_inherit;
    if (connection?.quick_connection || Number(inheritSize || 0) === 1) options.fontSize = values.font_size;
    options.scrollback = Number(values.scrollback_lines) || 30000;
    options.wordSeparator = port.wordSeparator(values);
    options.minimumContrastRatio = 4.5;
    const theme = port.theme(values);
    if (session.cursorCopyState) {
      session.cursorCopyState.originalTheme = theme;
      options.theme = { ...theme, selectionBackground: '#2563eb', selectionForeground: '#ffffff', selectionInactiveBackground: '#2563eb' };
    } else {
      options.theme = theme;
    }
    const mount = session.mount || session.term.element?.closest<HTMLElement>('.terminal-box');
    if (mount) {
      mount.style.setProperty('--terminal-background', theme.background);
      mount.style.setProperty('--terminal-color-scheme', port.luminance(theme.background) < 0.18 ? 'dark' : 'light');
    }
    try {
      session.term.refresh?.(0, Math.max(0, (session.term.rows || 0) - 1));
    } catch {
      // A disposed xterm may reject refresh while its cached surface is released.
    }
  }

  function applyAll() {
    const sessions = [...port.sessions()];
    for (const key of new Set([...port.surfaceKeys(), ...sessions.map(session => session.key)])) port.rerenderKeys(key);
    for (const session of sessions) {
      const viewport = port.capture(session);
      apply(session);
      if (viewport) port.fit(session, viewport);
      port.refreshToolbar(session.key);
    }
  }

  return { current, ensure, open, save, apply, applyAll };
}




export interface InstalledFeaturesTerminalTerminalSettingsServiceServices {
  termaTerminalSettings?: ReturnType<typeof createTerminalSettingsService>;
}
