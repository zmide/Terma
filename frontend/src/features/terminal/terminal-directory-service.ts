export interface TerminalDirectorySession {
  id?: number;
  key?: string;
  connected?: boolean;
  socket?: unknown;
  connectionAttempt?: number;
  mount?: HTMLElement | null;
  term?: {
    parser?: {registerOscHandler(code: number, callback: (value: string) => boolean): {dispose(): void}};
    onWriteParsed?(callback: () => void): {dispose(): void};
    buffer?: {active?: {type?: string; baseY: number; cursorY: number; getLine(row: number): {translateToString(trim?: boolean): string} | undefined}};
  };
  currentDirectory?: string;
  currentDirectoryKnown?: boolean;
  currentDirectorySource?: string;
  previousDirectory?: string;
  homeDirectory?: string;
  directoryProbeId?: number;
  directoryInitializationTimer?: ReturnType<typeof setTimeout> | null;
  directoryInitializationPending?: Promise<string> | null;
  directoryOscDisposable?: {dispose(): void} | null;
  directoryPromptDisposable?: {dispose(): void} | null;
}

export interface TerminalDirectoryConnection {id?: number}
export interface TerminalDirectoryPort {
  current(session: TerminalDirectorySession): boolean;
  resolve(id: number, path: string): Promise<{path?: string}>;
  startup(connection: TerminalDirectoryConnection, key: string): {terminal_working_directory?: string};
  remember(session: TerminalDirectorySession, directory: string): void;
  clean(command: string): string;
  text(key: string, params?: Record<string, unknown>): string;
}

export function normalizeTerminalDirectoryPath(value: unknown) {
  const raw = String(value || '.').replace(/\\/g, '/').trim() || '.';
  const drive = raw.match(/^[A-Za-z]:\//)?.[0] || '';
  const absolute = raw.startsWith('/') || Boolean(drive);
  const source = drive ? raw.slice(drive.length) : absolute ? raw.slice(1) : raw;
  const parts: string[] = [];
  for (const part of source.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop();
      else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  if (drive) return `${drive}${parts.join('/')}`;
  return absolute ? `/${parts.join('/')}` : parts.join('/') || '.';
}

export function joinTerminalDirectoryPath(base: unknown, child: unknown) {
  const value = String(child || '.').replace(/\\/g, '/');
  if (value === '~' || value.startsWith('~/')) return value;
  if (/^(?:[A-Za-z]:\/|\/)/.test(value)) return normalizeTerminalDirectoryPath(value);
  const parent = String(base || '.').replace(/\\/g, '/').replace(/\/+$/, '') || '.';
  return normalizeTerminalDirectoryPath(parent === '.' ? value : `${parent}/${value}`);
}

export function terminalDirectoryFromOsc7(value: string) {
  let text = String(value || '').trim();
  if (!text) return '';
  try {
    if (/^file:\/\//i.test(text)) {
      const url = new URL(text);
      text = decodeURIComponent(url.pathname || '');
      if (/^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
    } else text = decodeURIComponent(text);
  } catch { return ''; } // Malformed remote OSC data cannot change the target.
  return text ? normalizeTerminalDirectoryPath(text) : '';
}

/** Only an actual, empty shell prompt is evidence; typed cd text is never accepted. */
export function terminalDirectoryFromPrompt(value: string) {
  const text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd();
  const path = text.match(/^[\w.+-]+@[\w.-]+:(~(?:\/[^#\r\n]*)?|\/[^#\r\n]*)[#$%]$/)?.[1]
    || text.match(/^[\w.+-]+@[\w.-]+\s+(~(?:\/[^\r\n]*)?|\/[^\r\n]*)\s[#$%]$/)?.[1]
    || text.match(/^\[[\w.+-]+@[\w.-]+\s+(~(?:\/[^#\r\n]*)?|\/[^#\r\n]*)\][#$%]$/)?.[1]
    || text.match(/^PS\s+([A-Za-z]:\\[^>\r\n]*)>$/i)?.[1];
  return path && !/[\x00-\x1f\x7f…]/.test(path) ? path : '';
}

export function createTerminalDirectoryService(port: TerminalDirectoryPort) {
  const listeners = new Set<() => void>();
  const confirmedPaths = new WeakMap<TerminalDirectorySession, {path: string; socket: unknown; attempt: number | undefined}>();
  const confirmed = (session: TerminalDirectorySession) => {
    const value = confirmedPaths.get(session);
    return value && value.socket === session.socket && value.attempt === session.connectionAttempt ? value.path : '';
  };
  const label = (session: TerminalDirectorySession) => session.currentDirectoryKnown
    ? String(session.currentDirectory || '.') : port.text('terminal:drop.current_directory');

  function refreshOverlay(session: TerminalDirectorySession) {
    const overlay = session.mount?.querySelector<HTMLElement>('.terminal-drop-overlay');
    if (!overlay || overlay.hidden) return;
    const node = overlay.querySelector('.terminal-drop-label');
    if (node) node.textContent = port.text(overlay.dataset.mode === 'copy'
      ? 'terminal:drop.copy_to_current' : 'terminal:drop.upload_to_current', {directory: label(session)});
  }

  function set(session: TerminalDirectorySession, directory: string, source = 'tracked') {
    if (!port.current(session)) return false;
    const normalized = normalizeTerminalDirectoryPath(directory);
    if (session.currentDirectory && session.currentDirectory !== normalized) session.previousDirectory = session.currentDirectory;
    session.currentDirectory = normalized;
    session.currentDirectoryKnown = true;
    session.currentDirectorySource = source;
    if (source === 'osc7' || source === 'prompt') confirmedPaths.set(session, {path: normalized, socket: session.socket, attempt: session.connectionAttempt});
    port.remember(session, normalized);
    refreshOverlay(session);
    listeners.forEach(listener => listener());
    return true;
  }

  async function probe(session: TerminalDirectorySession, connection: TerminalDirectoryConnection,
    directory: string, source = 'probe', options: {preserveCurrent?: boolean} = {}) {
    if (!connection.id || !port.current(session)) return '';
    const path = normalizeTerminalDirectoryPath(directory || session.currentDirectory || '.');
    const request = Number(session.directoryProbeId || 0) + 1;
    const socket = session.socket, attempt = session.connectionAttempt;
    session.directoryProbeId = request;
    try {
      const result = await port.resolve(connection.id, path);
      if (!port.current(session) || session.directoryProbeId !== request
        || session.socket !== socket || session.connectionAttempt !== attempt) return '';
      const resolved = String(result?.path || path);
      if (!options.preserveCurrent) set(session, resolved, source);
      if (!session.homeDirectory && path === '.' && !options.preserveCurrent) session.homeDirectory = resolved;
      return resolved;
    } catch { return ''; } // Unknown directory blocks upload; it never falls back to an unrelated target.
  }

  async function initialize(session: TerminalDirectorySession, connection: TerminalDirectoryConnection | null | undefined, key: string) {
    if (!connection || !port.current(session)) return '';
    if (session.directoryInitializationTimer) clearTimeout(session.directoryInitializationTimer);
    session.directoryInitializationTimer = null;
    if (session.directoryInitializationPending) return session.directoryInitializationPending;
    const pending = (async () => {
      const startup = port.startup(connection, key);
      const initial = startup.terminal_working_directory || session.currentDirectory || '.';
      const resolved = await probe(session, connection, initial, 'initial');
      if (resolved && !session.homeDirectory && initial !== '.') {
        session.homeDirectory = await probe(session, connection, '.', 'home', {preserveCurrent: true});
      }
      return resolved;
    })();
    session.directoryInitializationPending = pending;
    try { return await pending; }
    finally {
      if (session.directoryInitializationPending === pending) session.directoryInitializationPending = null;
    }
  }

  function cancel(session: TerminalDirectorySession | null | undefined, invalidate = false) {
    if (!session) return;
    if (session.directoryInitializationTimer) clearTimeout(session.directoryInitializationTimer);
    session.directoryInitializationTimer = null;
    if (invalidate) session.directoryProbeId = Number(session.directoryProbeId || 0) + 1;
  }

  function schedule(session: TerminalDirectorySession, connection: TerminalDirectoryConnection, key: string, delay = 900) {
    if (!port.current(session) || session.currentDirectoryKnown || session.directoryInitializationPending) return;
    cancel(session);
    const socket = session.socket, attempt = Number(session.connectionAttempt || 0);
    session.directoryInitializationTimer = setTimeout(() => {
      session.directoryInitializationTimer = null;
      if (!port.current(session) || session.socket !== socket
        || Number(session.connectionAttempt || 0) !== attempt || !session.connected || session.currentDirectoryKnown) return;
      void initialize(session, connection, key);
    }, Math.max(0, Number(delay) || 0));
  }

  function parse(command: string) {
    const text = port.clean(command);
    if (!text || /[;&|<>]/.test(text)) return null;
    const match = text.match(/^(?:cd|chdir)(?:\s+--)?(?:\s+(.*))?$/i);
    if (!match) return null;
    let value = String(match[1] || '~').trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1).replace(/\\([\\'" ])/g, '$1');
    }
    return !value || /[$`*?{}]/.test(value) ? null : value;
  }

  async function track(session: TerminalDirectorySession, connection: TerminalDirectoryConnection, key: string, command: string) {
    const value = parse(command);
    if (!value) return;
    const base = session.currentDirectory || session.homeDirectory || '.';
    const target = value === '-' ? session.previousDirectory || base
      : value === '~' || value.startsWith('~/')
        ? joinTerminalDirectoryPath(session.homeDirectory || '.', value === '~' ? '.' : value.slice(2))
        : joinTerminalDirectoryPath(base, value);
    await probe(session, connection, target, 'cd');
  }

  function register(session: TerminalDirectorySession) {
    session.directoryOscDisposable?.dispose();
    session.directoryPromptDisposable?.dispose();
    session.directoryOscDisposable = null;
    session.directoryPromptDisposable = null;
    let lastPrompt = '', promptSerial = 0;
    session.directoryPromptDisposable = session.term?.onWriteParsed?.(() => {
      if (!session.connected || !session.id || !port.current(session)) return;
      const buffer = session.term?.buffer?.active;
      if (!buffer || buffer.type === 'alternate') return;
      const value = terminalDirectoryFromPrompt(buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) || '');
      if (!value) {lastPrompt = ''; promptSerial++; return;}
      cancel(session);
      const stamp = `${session.connectionAttempt}:${value}`;
      if (lastPrompt === stamp || confirmed(session) && session.currentDirectorySource === 'osc7') return;
      lastPrompt = stamp;
      const serial = ++promptSerial;
      const socket = session.socket, attempt = session.connectionAttempt;
      void (async () => {
        if ((value === '~' || value.startsWith('~/')) && !session.homeDirectory) {
          const home = await probe(session, {id: session.id}, '.', 'home', {preserveCurrent: true});
          if (serial !== promptSerial) return;
          if (home) session.homeDirectory = home;
        }
        if (serial !== promptSerial || socket !== session.socket || attempt !== session.connectionAttempt || !port.current(session)) return;
        const path = value === '~' || value.startsWith('~/')
          ? session.homeDirectory && joinTerminalDirectoryPath(session.homeDirectory, value.slice(2) || '.')
          : value;
        if (path) await probe(session, {id: session.id}, path, 'prompt');
      })();
    }) || null;
    try {
      session.directoryOscDisposable = session.term?.parser?.registerOscHandler(7, value => {
        const directory = terminalDirectoryFromOsc7(value);
        if (directory) set(session, directory, 'osc7');
        return true;
      }) || null;
    } catch { session.directoryOscDisposable = null; } // Terminals without OSC parsing retain command/probe tracking.
  }

  return {label, refreshOverlay, set, probe, initialize, schedule, cancel, parse, track, register, confirmed,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}};
}
