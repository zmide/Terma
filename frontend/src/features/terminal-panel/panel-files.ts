import {h} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {settingsIcon as icon} from '../settings/settings-icon';
import {filesServices} from '../files/installed-services';
import {embeddedSftpViews, type EmbeddedSftpView} from '../files/sftp/embedded-views';
import {terminalSessions} from '../terminal/terminal-session-state';
import {terminalDirectory} from '../terminal/terminal-directory-workspace';
import type {PanelTarget} from './PanelView';

const text = (key: string) => tr(`terminal:panel.${key}`);
const manualNavigation = new Set(['navigate', 'navigateEntry', 'history', 'parent']);

/** Hosts the main file view and operations without adding a saved workspace tab. */
export function createPanelFiles(key: string, changed: () => void) {
  const container = document.createElement('div'); container.className = 'panel-files sftp-embedded';
  const root = document.createElement('div'); root.className = 'sftp-embedded-view'; root.dataset.sftpTabKey = key;
  container.append(root);
  let host: HTMLElement | null = null, target: PanelTarget | null = null, visible = false, initialized = false;
  let sourceKey = '', socket: unknown, attempt: number | undefined, embedded: EmbeddedSftpView | null = null;
  let appearance = '';
  const state = {following: true, confirmed: ''};
  const runtime = () => embedded ? filesServices.termaSftpTabs.runtime.restore(key) : null;
  function invalidate() {
    const current = runtime();
    current?.requestController?.abort();
    if (current) {current.requestController = null; current.state.requestSeq++; current.state.loading = false;}
  }
  function release() {
    if (!embedded) return;
    filesServices.termaSftpTabs.runtime.dispose(key);
    if (embeddedSftpViews.get(key) === embedded) embeddedSftpViews.delete(key);
    embedded = null; initialized = false; appearance = ''; root.replaceChildren();
  }
  async function browse(path: string, manual = true) {
    if (!visible || !embedded || path.includes('\0') || path.length > 8192) return;
    if (manual) {state.following = false; changed();}
    return filesServices.termaSftpDirectoryWorkspace.navigation.navigatePath(key, path, {page: 1});
  }
  function controls() {
    const button = (action: string, glyph: string, run: () => void, disabled = false) => h(TermaButton, {
      class: 'icon-button', title: text(action), 'aria-label': text(action), 'data-panel-files-action': action, disabled, onClick: run
    }, () => icon(glyph));
    return h('div', {class: 'panel-files-tools'}, [
      button(state.following ? 'pause_follow' : 'resume_follow', state.following ? 'pause' : 'play', () => {
        state.following = !state.following; changed();
        if (state.following && state.confirmed) void browse(state.confirmed, false);
      }),
      button('current_directory', 'locate-fixed', () => {
        state.following = true; changed(); if (state.confirmed) void browse(state.confirmed, false);
      }, !state.confirmed)
    ]);
  }
  function focus() {
    const control = root.querySelector<HTMLElement>('.sftp-row.active .sftp-name, .sftp-row.is-selected .sftp-name')
      || root.querySelector<HTMLElement>('.sftp-row .sftp-name')
      || root.querySelector<HTMLElement>('#sftpBreadcrumb [aria-current="page"]');
    control?.focus({preventScroll: true});
    return Boolean(control && document.activeElement === control);
  }
  function sync(element: HTMLElement | null, next: PanelTarget | null, shown: boolean) {
    host = element;
    if (host && container.parentElement !== host) host.replaceChildren(container);
    const session = next?.key ? terminalSessions.get(next.key) : undefined;
    const changedTarget = target?.connectionId !== next?.connectionId || sourceKey !== (next?.key || '');
    if (changedTarget) {invalidate(); release(); state.confirmed = ''; state.following = true;}
    else if (socket !== session?.socket || attempt !== session?.connectionAttempt) invalidate();
    target = next; sourceKey = next?.key || ''; socket = session?.socket; attempt = session?.connectionAttempt;
    const wasVisible = visible;
    visible = shown && Boolean(host?.isConnected);
    if (!visible) invalidate();
    if (next && !embedded) {
      embedded = {tab: {key, id: next.connectionId, kind: 'sftp', embedded: true, path: '.', title: next.label},
        root, beforeAction(action) {if (manualNavigation.has(action)) {state.following = false; changed();}},
        focus() {host?.closest<HTMLElement>('[data-panel-pane]')?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));}};
      embeddedSftpViews.set(key, embedded);
      filesServices.termaSftpTabs.runtime.restore(key, {connectionId: next.connectionId, root});
      filesServices.termaSftpView.mount(root, key);
    }
    if (!next) {root.textContent = text('no_session'); return;}
    const current = runtime();
    const confirmed = session?.connected ? terminalDirectory.confirmed(session) : '';
    const newDirectory = Boolean(confirmed && confirmed !== state.confirmed);
    state.confirmed = confirmed || '';
    if (current) {
      const nextAppearance = `${document.documentElement.lang}:${document.documentElement.dataset.theme}`;
      if (appearance !== nextAppearance) {
        appearance = nextAppearance;
        filesServices.termaSftpView.refresh(key);
      }
      container.dataset.panelFilesPath = current.state.path;
    }
    if (visible && ((state.following && (newDirectory || !wasVisible && confirmed !== current?.state.path)) || !initialized)) {
      initialized = true;
      void browse(state.following && confirmed ? confirmed : current?.state.path || '.', false);
    }
  }
  return {sync, state, controls, browse, focus,
    unmount() {invalidate(); visible = false; host = null;},
    dispose() {invalidate(); release(); container.remove(); host = null; visible = false;}
  };
}
