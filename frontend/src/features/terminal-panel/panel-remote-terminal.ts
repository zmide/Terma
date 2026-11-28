import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as icon} from '../settings/settings-icon';
import {connectionsServices} from '../connections/installed-services';
import {terminalServices} from '../terminal/installed-services';
import {terminalSessions, registerAuxiliaryTerminalSession, releaseAuxiliaryTerminalSession, type TerminalSession} from '../terminal/terminal-session-state';
import {closeTerminalSession} from '../terminal/terminal-session-lifecycle';
import {connectTerminal, disconnectTerminal} from '../terminal/terminal-connection-runtime';
import {terminalViewport} from '../terminal/terminal-viewport-service';
import {workspaceTabByKey} from '../workspace/workspace-dock-state';
import type {PanelTarget} from './PanelView';

/** Owns one ordinary SSH surface per SFTP tab, using the existing terminal engine. */
export function createPanelRemoteTerminal(changed: () => void, text: (key: string) => string, open: (connectionId: number) => void) {
  const surfaces = new Map<string, {key: string; connectionId: number; element: HTMLElement; pending: boolean; failed: boolean}>();
  let host: HTMLElement | null = null, target: PanelTarget | null = null, disposed = false;
  const selected = () => target ? surfaces.get(target.key) : undefined;
  function release(owner: string, surface: {key: string}) {
    closeTerminalSession(surface.key);
    releaseAuxiliaryTerminalSession(surface.key);
    surfaces.delete(owner);
  }
  function prune() {
    for (const [owner, surface] of surfaces) if (!workspaceTabByKey(owner)) {
      release(owner, surface);
    }
  }
  async function start() {
    const source = target;
    if (!source || disposed || !host) return;
    const connection = connectionsServices.termaConnectionController?.current(source.connectionId) as TerminalSession['connection'] | undefined;
    if (!connection) return;
    let surface = surfaces.get(source.key);
    if (surface && surface.connectionId !== source.connectionId) {
      closeTerminalSession(surface.key); surfaces.delete(source.key); surface = undefined;
    }
    if (!surface) {
      const element = document.createElement('div'); element.className = 'panel-remote-terminal';
      surface = {key: `panel-remote-${source.key}`, connectionId: source.connectionId, element, pending: false, failed: false};
      registerAuxiliaryTerminalSession(surface.key, source.key);
      surfaces.set(source.key, surface);
      terminalServices.termaTerminalSurface.build(element, surface.key, {assistant: '', quick: ''});
    }
    if (surface.element.parentElement !== host) host.replaceChildren(surface.element);
    if (surface.pending) return;
    if (surface.failed) return;
    if (terminalSessions.has(surface.key)) return;
    surface.pending = true; surface.failed = false;
    try {
      await terminalServices.termaTerminalSurface.attach({...connection, terminal_session_mode: 'none', terminal_session_id: ''},
        surface.key, surface.element.querySelector<HTMLElement>('#terminalMount'));
      if (target?.key === source.key && document.activeElement === host && host?.checkVisibility()) focus();
    } catch {
      if (!disposed && surfaces.get(source.key) === surface) surface.failed = true;
    } finally {
      surface.pending = false;
      if (!disposed) changed();
    }
  }
  function controls() {
    const surface = selected(), session = surface && terminalSessions.get(surface.key);
    const button = (label: string, glyph: string, run: () => unknown, disabled = false) =>
      h(TermaButton, {class: 'icon-button', title: text(label), 'aria-label': text(label),
        'data-remote-terminal-action': label, disabled, onClick: run}, () => icon(glyph));
    return h('div', {class: 'panel-terminal-tools'}, [
      button(session?.connected ? 'disconnect_terminal' : 'reconnect_terminal', session?.connected ? 'link-2-off' : 'link-2', () => {
        if (session?.connected) disconnectTerminal(session.key);
        else if (session) void connectTerminal(session.connection, session.key);
        else {if (surface) surface.failed = false; void start();}
      }, !target || surface?.pending || session?.connectionPending),
      button('remote_terminal_open', 'external-link', () => {if (target) open(target.connectionId);}, !target),
      surface?.failed ? h('span', {class: 'terminal-panel-notice', role: 'alert'}, text('terminal_failed')) : null
    ]);
  }
  function focus() {
    const surface = selected(), session = surface && terminalSessions.get(surface.key);
    if (!session?.term.element) return false;
    session.term.focus();
    return session.term.element.contains(document.activeElement);
  }
  return {controls, focus, reconcile: prune,
    sync(element: HTMLElement | null, next: PanelTarget | null, visible: boolean) {
      host = element; target = next; prune();
      if (!host) return;
      const surface = selected();
      if (surface && surface.element.parentElement !== host) host.replaceChildren(surface.element);
      if (visible) {void start(); terminalViewport.schedule();}
    },
    dispose() {
      disposed = true;
      for (const [owner, surface] of surfaces) release(owner, surface);
      host = null; target = null;
    }
  };
}
