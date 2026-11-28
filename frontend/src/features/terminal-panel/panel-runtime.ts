import {applicationState} from '@/shared/application-state';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {terminalSessions, type TerminalSession} from '../terminal/terminal-session-state';
import {terminalViewport} from '../terminal/terminal-viewport-service';
import {paintPanel, releasePanel, type PanelTarget, type PanelViewPort} from './PanelView';
import {bounded, cleanPanelPreferences, createPanelModel, panelKindsForContext, panelLayout, panelLimits, projectPanelLayout, type PanelRegion, type PanelTab} from './panel-model';
import {createPanelContents} from './panel-contents';
import {terminalDirectory} from '../terminal/terminal-directory-workspace';
import '@/styles/terminal-panel.css';
import {createPanelDrag} from './panel-drag';
import {filesServices} from '../files/installed-services';
import {activateTab, focusWorkspacePane} from '../workspace/workspace-dock-runtime';
import {openTerminal} from '../terminal/terminal-page';
import {notify} from '../efficiency/notification-actions';

const storageKey = 'termaTerminalPanelV1';
const text = (key: string, params?: Record<string, unknown>) => tr(`terminal:panel.${key}`, params);

function readPreferences() {
  try {
    const value = localStorage.getItem(storageKey);
    return cleanPanelPreferences(value && value.length < 131072 ? JSON.parse(value) : null, {
      visible: localStorage.getItem('terminalQuickCommandsVisible'),
      height: localStorage.getItem('terminalQuickCommandsHeight')
    });
  } catch {return cleanPanelPreferences(null);}
}

export function createTerminalPanelRuntime() {
  let host: HTMLElement | null = null, shell: HTMLElement | null = null, divider: HTMLElement | null = null;
  let rightHost: HTMLElement | null = null, rightDivider: HTMLElement | null = null;
  let frame = 0, disposed = false, dragging: (() => void) | null = null, contextKey = '';
  const activeTab = () => applicationState.tabs.find(item => item.key === applicationState.activeTabKey);
  const model = createPanelModel(readPreferences(), changed);
  const current = model.current;
  const contents = createPanelContents(refresh, text, openRemoteTerminal);
  const fileTarget = (key: string) => {
    const tab = current().tabs.find(tab => tab.key === key && tab.kind === 'files');
    return tab ? target(tab) : null;
  };
  const tabDrag = createPanelDrag(model, text, {
    canOpen: key => Boolean(fileTarget(key)),
    open(key, paneId) {
      const source = fileTarget(key); if (!source) return;
      const runtime = filesServices.termaSftpTabs.runtime.restore(key);
      const path = runtime?.connectionId === source.connectionId ? runtime.state.path
        : terminalDirectory.confirmed(terminalSessions.get(source.key)!) || '.';
      focusWorkspacePane(paneId);
      void Promise.resolve(filesServices.termaSftpPage.open(source.connectionId, path, true, '', {paneId}))
        .catch(error => notify(error instanceof Error ? error.message : text('save_failed'), 'error'));
    }
  });

  function sessionLabel(key: string, session: TerminalSession) {
    const name = session.connection?.name || session.connection?.ssh_host || text('terminal');
    const title = applicationState.tabs.find(item => item.key === key)?.title || text('terminal');
    return title === name ? name : `${name} · ${title}`;
  }
  const visibleKinds = () => panelKindsForContext(activeTab()?.kind);
  const visibleLayout = (region: PanelRegion) => projectPanelLayout(model.layout(region), current().tabs, visibleKinds());
  function target(_tab: PanelTab): PanelTarget | null {
    const tab = activeTab();
    if (tab?.kind === 'sftp' && Number(tab.id)) {
      return {key: tab.key, connectionId: Number(tab.id), connected: tab.connectionStatus === 'connected', label: tab.title || text('files')};
    }
    if (!tab || !['terminal', 'quick-terminal'].includes(tab.kind || '')) return null;
    const key = contextKey;
    const session = terminalSessions.get(key);
    if (session) {
      return {key, connectionId: session.id, connected: session.connected,
        label: sessionLabel(key, session)};
    }
    return null;
  }
  function openRemoteTerminal(connectionId: number) {
    const existing = applicationState.tabs.find(tab => ['terminal', 'quick-terminal'].includes(tab.kind || '')
      && Number(tab.id) === connectionId);
    if (existing) return activateTab(existing.key);
    return openTerminal(connectionId);
  }

  function ensure() {
    if (host?.isConnected) return true;
    const dock = document.getElementById('workspaceDock');
    if (!dock?.parentElement) return false;
    shell = document.createElement('div'); shell.className = 'terminal-panel-workspace';
    shell.id = 'terminalPanelWorkspace';
    dock.parentElement.insertBefore(shell, dock);
    const primary = document.createElement('div'); primary.className = 'terminal-panel-primary';
    shell.append(primary); primary.appendChild(dock);
    divider = document.createElement('div'); divider.className = 'terminal-panel-resizer'; divider.tabIndex = 0;
    divider.setAttribute('role', 'separator'); divider.dataset.panelResize = '';
    divider.addEventListener('pointerdown', event => resize(event, undefined, 'bottom'));
    divider.addEventListener('keydown', event => resize(event, undefined, 'bottom'));
    host = document.createElement('aside'); host.id = 'terminalPanel'; host.className = 'terminal-panel';
    host.dataset.panelRegion = 'bottom'; primary.append(divider, host);
    rightDivider = document.createElement('div'); rightDivider.className = 'terminal-panel-resizer right';
    rightDivider.tabIndex = 0; rightDivider.setAttribute('role', 'separator'); rightDivider.dataset.panelResize = 'right';
    rightDivider.addEventListener('pointerdown', event => resize(event, undefined, 'right'));
    rightDivider.addEventListener('keydown', event => resize(event, undefined, 'right'));
    rightHost = document.createElement('aside'); rightHost.id = 'terminalPanelRight';
    rightHost.className = 'terminal-panel terminal-panel-right'; rightHost.dataset.panelRegion = 'right';
    const drop = document.createElement('div'); drop.className = 'terminal-panel-region-drop';
    drop.dataset.panelRegionDrop = ''; drop.hidden = true; drop.setAttribute('aria-hidden', 'true');
    shell.append(rightDivider, rightHost, drop);
    return true;
  }

  function refresh() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {frame = 0; paint();});
  }
  function changed() {
    contents.reconcile(current().tabs);
    try {
      localStorage.setItem(storageKey, JSON.stringify(model.state.preferences));
      localStorage.setItem('terminalQuickCommandsVisible', model.state.preferences.visible ? '1' : '0');
      model.state.notice = '';
    } catch {model.state.notice = text('save_failed');}
    refresh();
    terminalViewport.schedule();
  }
  function release(key: string, element: HTMLElement) {
    contents.release(key, element);
  }
  function focus(tab: PanelTab, paneId: string, region: PanelRegion) {
    requestAnimationFrame(() => {
      if (disposed) return;
      const pane = panelLayout.findPane(paneId, visibleLayout(region));
      if (pane?.activeTabKey !== tab.key || region === 'right' && model.state.collapsedRight.has(tab.key)) return;
      const element = (region === 'bottom' ? host : rightHost)?.querySelector<HTMLElement>(
        `[data-panel-content="${CSS.escape(tab.key)}"]`
      );
      if (element?.checkVisibility()) contents.focus(tab);
    });
  }
  function content(tab: PanelTab, element: HTMLElement) {
    const savedPane = model.findPaneForTab(tab.key), region = savedPane ? model.regionForPane(savedPane.id) : 'bottom';
    const layout = visibleLayout(region), pane = panelLayout.findPaneForTab(tab.key, layout);
    const focused = panelLayout.leaves(layout).find(item => item.id === current().focusedPaneId)
      || panelLayout.leaves(layout)[0];
    const shown = !document.hidden && model.state.preferences.visible
      && (!model.state.maximized || model.state.maximizedRegion === region)
      && (region === 'right' ? !model.state.collapsedRight.has(tab.key)
        : (model.state.maximized || current().height > 28) && pane?.activeTabKey === tab.key)
      && (region === 'right' || innerWidth > 760 || pane?.id === focused?.id);
    contents.mount(tab, element, target(tab), Boolean(shown));
  }
  function paint() {
    if (disposed || !ensure() || !shell || !host || !divider || !rightHost || !rightDivider) return;
    const visible = model.state.preferences.visible;
    if (!visibleLayout(model.state.maximizedRegion)) model.state.maximized = false;
    shell.dataset.panelPosition = current().position;
    shell.classList.toggle('panel-open', visible);
    shell.classList.toggle('panel-maximized', visible && model.state.maximized);
    shell.dataset.panelMaximizedRegion = model.state.maximizedRegion;
    host.classList.toggle('panel-collapsed', !model.state.maximized && current().height <= 28);
    shell.style.setProperty('--terminal-panel-height', `${current().height}px`);
    shell.style.setProperty('--terminal-panel-width', `${current().width}px`);
    for (const region of ['bottom', 'right'] as const) {
      const element = region === 'bottom' ? host : rightHost, handle = region === 'bottom' ? divider : rightDivider;
      element.hidden = !visible || !visibleLayout(region) || model.state.maximized && model.state.maximizedRegion !== region;
      handle.hidden = element.hidden || model.state.maximized;
      handle.setAttribute('aria-label', text('resize'));
      handle.setAttribute('aria-orientation', region === 'right' && innerWidth > 760 ? 'vertical' : 'horizontal');
      element.setAttribute('aria-label', text(region === 'bottom' ? 'title' : 'right_title'));
      element.dataset.theme = document.documentElement.dataset.theme;
      const port: PanelViewPort = {text, target, visibleKinds, content, focus, release, tools: contents.controls, resize: (event, id) => resize(event, id, region),
        toggle: region === 'right' ? model.returnRight : () => toggle(), restore: model.restore,
        drag: tabDrag.begin, suppressClick: tabDrag.suppressClick,
        dock: () => {
          const pane = panelLayout.leaves(visibleLayout(region)).find(item => item.id === current().focusedPaneId)
            || panelLayout.leaves(visibleLayout(region))[0];
          if (pane) model.dock(pane.activeTabKey, region === 'bottom' ? 'right' : 'bottom');
        }, close: key => {model.close(key);}};
      paintPanel(element, model, port, region);
    }
    for (const button of document.querySelectorAll<HTMLElement>('[data-terminal-quick-command-toggle],#terminalPanelToggleButton')) {
      button.classList.toggle('active', visible); button.setAttribute('aria-pressed', String(visible));
      button.title = text(visible ? 'hide' : 'show'); button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-controls', 'terminalPanelWorkspace');
    }
  }

  function resize(event: PointerEvent | KeyboardEvent, splitId?: string, region: PanelRegion = 'bottom') {
    const node = splitId ? panelLayout.findSplit(splitId, model.layout(region)) : null;
    const horizontal = node ? node.direction === 'row' : region === 'right' && innerWidth > 760;
    const update = (delta: number) => {
      if (node) node.ratio = Math.max(0.2, Math.min(0.8, node.ratio + delta));
      else if (horizontal) current().width = bounded(current().width + delta, ...panelLimits.width, 380);
      else current().height = bounded(current().height + delta, ...panelLimits.height, 220);
      model.publish();
    };
    if (event instanceof KeyboardEvent) {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const sign = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
      update(node ? sign * 0.05 : -sign * 16); return;
    }
    if (event.button !== 0 || dragging) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement, pointer = event.pointerId;
    const bounds = (node ? handle.parentElement : shell)?.getBoundingClientRect();
    if (!bounds) return;
    let previous = horizontal ? event.clientX : event.clientY;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const coordinate = horizontal ? next.clientX : next.clientY, delta = coordinate - previous;
      previous = coordinate;
      update(node ? delta / (horizontal ? bounds.width : bounds.height) : -delta);
    };
    const finish = (next: PointerEvent) => {if (next.pointerId === pointer) dragging?.();};
    dragging = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      document.body.classList.remove('terminal-panel-resizing'); dragging = null;
    };
    document.body.classList.add('terminal-panel-resizing');
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }
  function context() {
    const tab = activeTab();
    contextKey = tab && ['terminal', 'quick-terminal'].includes(tab.kind || '') ? tab.key : '';
    contents.reconcile(current().tabs);
    refresh();
  }
  function toggle(key = '') {
    context();
    if (key && key === applicationState.activeTabKey && terminalSessions.has(key)) contextKey = key;
    model.state.preferences.visible = !model.state.preferences.visible;
    model.publish();
  }
  function visibility() {
    // Background documents may suspend animation frames; stop network work immediately.
    if (document.hidden) {if (frame) cancelAnimationFrame(frame); frame = 0; paint();}
    else refresh();
  }
  const events = ['terma:workspace-target-changed', 'terma:terminal-toolbar-ready', 'terma:language-changed'];
  events.forEach(name => window.addEventListener(name, context));
  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', visibility);
  const unsubscribe = terminalDirectory.subscribe(refresh);
  const theme = new MutationObserver(refresh);
  theme.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  context();
  return {model, target, refresh, toggle, visible: () => model.state.preferences.visible,
    dispose() {
      disposed = true; if (frame) cancelAnimationFrame(frame); dragging?.(); tabDrag.dispose();
      events.forEach(name => window.removeEventListener(name, context)); window.removeEventListener('resize', refresh);
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe(); theme.disconnect(); contents.dispose();
      if (host) releasePanel(host);
      if (rightHost) releasePanel(rightHost);
      const dock = document.getElementById('workspaceDock');
      if (shell?.parentElement && dock) shell.parentElement.insertBefore(dock, shell);
      shell?.remove(); host = null; shell = null;
    }};
}

let installed: ReturnType<typeof createTerminalPanelRuntime> | undefined;
export const terminalPanel = {
  install: () => installed ||= createTerminalPanelRuntime(),
  toggle: (key = '') => installed?.toggle(key),
  refresh: () => installed?.refresh(),
  visible: () => installed?.visible() ?? false,
  get model() {return installed?.model;},
  dispose() {installed?.dispose(); installed = undefined;}
};
