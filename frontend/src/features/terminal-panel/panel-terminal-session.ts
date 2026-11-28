import type {Terminal} from '@xterm/xterm';
import type {FitAddon} from '@xterm/addon-fit';
import {terminalLibraries} from '../terminal/terminal-libraries';
import {terminalServices} from '../terminal/installed-services';

export interface LocalProfile {id: string; label: string}
export interface LocalBridge {
  capabilities?: {platform?: string};
  localTerminalProfiles?(): Promise<LocalProfile[]>;
  startLocalTerminal(options: {id: string; profile: string; elevated: boolean; cols: number; rows: number}): Promise<unknown>;
  writeLocalTerminal(id: string, data: string): Promise<unknown>;
  resizeLocalTerminal(id: string, cols: number, rows: number): Promise<unknown>;
  closeLocalTerminal(id: string): Promise<unknown>;
  onLocalTerminal(callback: (event: {id: string; type: string; data?: string; pty?: boolean}) => void): () => void;
}

/** One PTY and one xterm survive tool moves, group switches and pane rebuilds. */
export function createLocalTerminalSession(bridge: LocalBridge, profile: LocalProfile, elevated: boolean, changed: () => void) {
  const key = crypto.randomUUID(), element = document.createElement('div');
  element.className = 'panel-local-terminal'; element.dataset.i18nSkip = ''; element.dataset.localSession = key;
  let term: Terminal | null = null, fit: FitAddon | null = null, disposed = false, started = false;
  const state = {key, profile, elevated, pending: false, running: false, failed: false};
  const fail = () => {state.failed = true; changed();};
  const off = bridge.onLocalTerminal(event => {
    if (disposed || event.id !== key) return;
    if (event.type === 'data' && typeof event.data === 'string') term?.write(event.data);
    if (event.type === 'ready') {state.running = true; state.pending = false; refit();}
    if (event.type === 'exit' || event.type === 'error') {
      state.running = false; state.pending = false; state.failed = event.type === 'error';
    }
    if (event.type !== 'data') changed();
  });
  const observer = new ResizeObserver(refit); observer.observe(element);
  function refit() {
    if (!element.checkVisibility() || !fit || !term || disposed) return;
    requestAnimationFrame(() => {
      if (!element.checkVisibility() || !fit || !term || disposed) return;
      try {fit.fit();} catch { /* A reparented terminal is fitted on its next visible layout. */ }
    });
  }
  async function start() {
    if (started || disposed) return;
    started = true; state.pending = true; changed();
    try {
      await terminalLibraries.ensure();
      if (disposed) return;
      const settings = terminalServices.termaTerminalSettings?.current();
      term = terminalLibraries.terminal({cursorBlink: true, fontSize: 12, scrollback: 5000,
        fontFamily: 'Cascadia Mono, Consolas, monospace',
        theme: settings ? terminalServices.termaTerminalSettingsModel!.theme(settings) : undefined});
      fit = terminalLibraries.fit(); term.loadAddon(fit); term.open(element); refit();
      term.onData(data => {if (state.running) void bridge.writeLocalTerminal(key, data).catch(fail);});
      term.onResize(size => {if (state.running) void bridge.resizeLocalTerminal(key, size.cols, size.rows).catch(fail);});
      await bridge.startLocalTerminal({id: key, profile: profile.id, elevated, cols: term.cols, rows: term.rows});
      if (disposed) {await bridge.closeLocalTerminal(key); return;}
      refit(); term.focus();
    } catch {state.pending = false; state.failed = true; changed();}
  }
  async function close() {
    if (!started) return;
    try {await bridge.closeLocalTerminal(key);}
    catch (error) {if (!String(error).includes('LOCAL_TERMINAL_NOT_FOUND')) throw error;}
  }
  return {state, element, start, refit,
    focus() {refit(); term?.focus(); return Boolean(term);},
    theme() {
      const settings = terminalServices.termaTerminalSettings?.current();
      if (term && settings) term.options.theme = terminalServices.termaTerminalSettingsModel!.theme(settings);
    },
    async dispose() {
      disposed = true; off(); observer.disconnect();
      await close().finally(() => {term?.dispose(); element.remove();});
    }};
}
