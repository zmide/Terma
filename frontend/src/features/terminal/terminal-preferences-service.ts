import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {isMobileLayout} from '@/shared/browser-ui';
import {currentConnection} from '@/features/connections/connection-selection';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalFontFamilyForConnection,terminalFontSizeForCurrentLayout} from '@/features/terminal/terminal-metadata';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import {terminalActionConnection,terminalEncodingOptions,terminalFontOptions} from '@/features/terminal/terminal-metadata';
import type { WorkspaceRequestOptions } from '../../shared/api/workspace-request';
import { connectionStamp, type ManagementConnection } from '../remote/management-types';
import type { TerminalSettingsSession } from './terminal-settings-service';
import type { TerminalSessionCoreSocket } from './terminal-session-core-service';
import type { TerminalViewportAnchor } from './terminal-viewport-service';

export interface TerminalPreferences {
  terminal_encoding: string;
  terminal_font_family: string;
  terminal_font_family_inherit: number;
  terminal_font_size: number;
  terminal_font_size_inherit: number;
  terminal_mobile_font_size: number;
  terminal_mobile_font_size_inherit: number;
  terminal_line_height: number;
  terminal_font_weight: string;
}

type Connection = ManagementConnection & Partial<TerminalPreferences>;
type Session = Omit<TerminalSettingsSession, 'connection'> & {
  id?: number;
  connection?: Connection | null;
  socket?: TerminalSessionCoreSocket | null;
  terminalEncoding?: string;
  fontLayoutMobile?: boolean;
};

export interface TerminalPreferencesPort {
  api(path: string, options: { method: string; body: string }): Promise<TerminalPreferences>;
  connection(key: string, id: number): Connection | null;
  savedConnection(id: number): Connection | null;
  sessions(): Iterable<[string, Session]>;
  defaultFont(): string;
  fontFamily(value: Partial<TerminalPreferences>): string;
  fontSize(value: Partial<TerminalPreferences>): number;
  mobile(): boolean;
  capture(session: Session): TerminalViewportAnchor | null;
  fit(session: Session, anchor: TerminalViewportAnchor | null): void;
  refreshToolbar(key: string): void;
  encodingName(value: string): string;
  openState: number;
  tr(key: string, params?: Record<string, unknown>): string;
  notify(message: string, kind: 'success' | 'error', options?: { replaceKey?: string }): void;
  focus(key: string): void;
}

export function createTerminalPreferencesService(port: TerminalPreferencesPort) {
  const queues = new Map<number, Promise<void>>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function enqueue<T>(connectionId: number, operation: () => Promise<T>): Promise<T> {
    const id = Number(connectionId);
    if (!Number.isSafeInteger(id) || !id) return Promise.reject(new Error('Invalid terminal preference connection'));
    const next = (queues.get(id) || Promise.resolve()).then(operation);
    const tracked = next.then(() => undefined, () => undefined).finally(() => {
      if (queues.get(id) === tracked) queues.delete(id);
    });
    queues.set(id, tracked);
    return next;
  }

  function cancelPending(connectionId: number) {
    const id = Number(connectionId);
    clearTimeout(timers.get(id));
    timers.delete(id);
  }

  function displayValues(connection: Partial<TerminalPreferences>) {
    return {
      terminal_font_family: connection.terminal_font_family,
      terminal_font_family_inherit: connection.terminal_font_family_inherit,
      terminal_font_size: connection.terminal_font_size,
      terminal_font_size_inherit: connection.terminal_font_size_inherit,
      terminal_mobile_font_size: connection.terminal_mobile_font_size,
      terminal_mobile_font_size_inherit: connection.terminal_mobile_font_size_inherit,
      terminal_line_height: connection.terminal_line_height ?? 1,
      terminal_font_weight: connection.terminal_font_weight || 'normal'
    };
  }

  function schedule(connection: Connection | null | undefined) {
    if (!connection || connection.quick_connection || !Number.isSafeInteger(connection.id) || connection.id <= 0) return;
    const id = connection.id, stamp = connectionStamp(connection);
    cancelPending(id);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      void enqueue(id, async () => {
        const latest = port.savedConnection(id);
        if (!latest || connectionStamp(latest) !== stamp) return;
        // The endpoint merges omitted encoding with its row, preserving newer encoding saves.
        const settings = await port.api(`/api/connections/${id}/terminal-preferences`, {
          method: 'POST', body: JSON.stringify(displayValues(latest))
        });
        const current = port.savedConnection(id);
        if (!current || connectionStamp(current) !== stamp) return;
        Object.assign(latest, settings);
        if (current !== latest) Object.assign(current, settings);
      }).catch(cause => {
        const current = port.savedConnection(id);
        if (!current || connectionStamp(current) !== stamp) return;
        const error = cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '';
        port.notify(port.tr('terminal:notifications.settings_save_failed', {error}), 'error');
      });
    }, 300));
  }

  function apply(key: string, connectionId: number, changes: Partial<TerminalPreferences>, successText = '') {
    const id = Number(connectionId), connection = port.connection(key, id);
    if (!connection || connection.id !== id) return Promise.resolve();
    const stamp = connectionStamp(connection), snapshot = {...changes};
    return enqueue(id, () => applyNow(key, id, stamp, snapshot, successText));
  }

  async function applyNow(key: string, id: number, stamp: string, changes: Partial<TerminalPreferences>, successText: string) {
    const connection = port.connection(key, id);
    if (!connection || connection.id !== id || connectionStamp(connection) !== stamp) return;
    try {
      const values: TerminalPreferences = {
        terminal_encoding: changes.terminal_encoding ?? connection.terminal_encoding ?? 'utf8',
        terminal_font_family: changes.terminal_font_family ?? connection.terminal_font_family ?? port.defaultFont(),
        terminal_font_family_inherit: changes.terminal_font_family_inherit ?? connection.terminal_font_family_inherit ?? 1,
        terminal_font_size: changes.terminal_font_size ?? connection.terminal_font_size ?? 13,
        terminal_font_size_inherit: changes.terminal_font_size_inherit ?? connection.terminal_font_size_inherit ?? 1,
        terminal_mobile_font_size: changes.terminal_mobile_font_size ?? connection.terminal_mobile_font_size ?? 13,
        terminal_mobile_font_size_inherit: changes.terminal_mobile_font_size_inherit ?? connection.terminal_mobile_font_size_inherit ?? 1,
        terminal_line_height: changes.terminal_line_height ?? connection.terminal_line_height ?? 1,
        terminal_font_weight: changes.terminal_font_weight ?? connection.terminal_font_weight ?? 'normal'
      };
      const settings = connection.quick_connection ? {...connection, ...values} : await port.api(`/api/connections/${id}/terminal-preferences`, {
        method: 'POST', body: JSON.stringify(values)
      });
      const current = connection.quick_connection ? port.connection(key, id) : port.savedConnection(id);
      if (!current || connectionStamp(current) !== stamp) return;
      Object.assign(connection, settings);
      if (current !== connection) Object.assign(current, settings);
      applySessions(id, stamp, current, settings, changes.terminal_encoding !== undefined);
      const origin = port.connection(key, id);
      if (!origin || connectionStamp(origin) !== stamp) return;
      const encoding = changes.terminal_encoding !== undefined ? port.encodingName(settings.terminal_encoding) : '';
      const message = connection.quick_connection ? port.tr('terminal:notifications.quick_preferences_applied')
        : encoding ? port.tr('terminal:notifications.encoding_changed', {encoding})
        : successText || port.tr('terminal:notifications.settings_saved');
      port.notify(message, 'success', encoding ? {replaceKey: `terminal-encoding-${id}`} : {});
    } finally {
      const current = port.connection(key, id);
      if (current && connectionStamp(current) === stamp) port.focus(key);
    }
  }

  function applySessions(id: number, stamp: string, current: Connection, settings: TerminalPreferences, encodingChanged: boolean) {
    for (const [key, session] of port.sessions()) {
      if (Number(session.id ?? session.connection?.id) !== id || !session.term) continue;
      if (session.connection && connectionStamp(session.connection) !== stamp) continue;
      if (session.connection) Object.assign(session.connection, settings);
      session.connection = current;
      const viewport = port.capture(session), options = session.term.options;
      options.fontFamily = port.fontFamily(settings);
      options.fontSize = port.fontSize(settings);
      session.fontLayoutMobile = port.mobile();
      options.lineHeight = settings.terminal_line_height;
      options.fontWeight = settings.terminal_font_weight as NonNullable<typeof options.fontWeight>;
      if (encodingChanged) session.terminalEncoding = settings.terminal_encoding;
      port.refreshToolbar(key);
      port.fit(session, viewport);
      const socket = session.socket;
      if (encodingChanged && socket?.readyState === port.openState) {
        try {
          socket.send(JSON.stringify({type: 'terminal-encoding', encoding: settings.terminal_encoding}));
        } catch {
          // A socket closed during application keeps the saved encoding for reconnection.
        }
      }
    }
  }

  return { enqueue, schedule, cancelPending, apply };
}



export function installTerminalPreferencesService() {
  if (terminalServices.termaTerminalPreferences) return terminalServices.termaTerminalPreferences;
  return terminalServices.termaTerminalPreferences = createTerminalPreferencesService({
    api: (path, options) => api(path, options),
    connection: (key, id) => terminalActionConnection(key, id),
    savedConnection: id => currentConnection(id)??null,
    sessions: () => terminalSessions.entries(),
    defaultFont: () => terminalFontOptions[0][0],
    fontFamily: value => terminalFontFamilyForConnection(value),
    fontSize: value => terminalFontSizeForCurrentLayout(value),
    mobile: () => isMobileLayout(),
    capture: session => terminalViewport.captureSession(session),
    fit: (session, anchor) => terminalViewport.fitSession(session, anchor),
    refreshToolbar: key => terminalServices.termaTerminalToolbar?.refresh(key),
    encodingName: value => terminalEncodingOptions.find(([encoding]) => encoding === value)?.[1] || value,
    openState: WebSocket.OPEN,
    tr: (key, params) => tr(key, params),
    notify: (message, kind, options) => notify(message, kind, options),
    focus: key => focusTerminalSession(key)
  });
}

export interface InstalledFeaturesTerminalTerminalPreferencesServiceServices {
  termaTerminalPreferences?: ReturnType<typeof createTerminalPreferencesService>;
}
