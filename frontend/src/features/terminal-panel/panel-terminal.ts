import {h, render, type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {showActionMenu} from '@/shared/action-menu';
import {settingsIcon as icon} from '../settings/settings-icon';
import {confirmWorkspaceClose} from '../workspace/WorkspaceCloseDialog';
import type {WorkspaceLayoutNode} from '../workspace/workspace-layout-service';
import {createLocalTerminalGroups} from './panel-terminal-model';
import {createLocalTerminalSession, type LocalBridge, type LocalProfile} from './panel-terminal-session';
import type {PanelTarget} from './PanelView';

const text = (key: string) => tr(`terminal:panel.${key}`);
export function createPanelTerminal(tabKey: string, changed: () => void) {
  const bridge = window.termaDesktop as LocalBridge | undefined, available = typeof bridge?.startLocalTerminal === 'function';
  const windows = bridge?.capabilities?.platform === 'win32', groups = createLocalTerminalGroups();
  const sessions = new Map<string, ReturnType<typeof createLocalTerminalSession>>();
  const container = document.createElement('div'); container.className = 'panel-terminal-workspace';
  let host: HTMLElement | null = null, disposed = false, initialized = false, failed = false;
  let cancelResize: (() => void) | null = null;
  let listWidth = 180;
  let profiles: LocalProfile[] = [{id: windows ? 'powershell' : 'shell', label: windows ? 'PowerShell' : text('local_shell')}];
  const selected = () => sessions.get(groups.focused);
  function update() {if (!disposed) {paint(); changed();}}
  function create(profile = profiles[0], split: 'row' | 'column' | null = null, elevated = false) {
    if (!available || disposed || sessions.size >= 12 || !profile) return;
    const session = createLocalTerminalSession(bridge!, profile, elevated, update);
    sessions.set(session.state.key, session); groups.add(session.state.key, split);
    update(); void session.start();
  }
  async function remove(key: string) {
    const session = sessions.get(key); if (!session) return;
    if (session.state.running || session.state.pending) {
      const modal = document.getElementById('modal'); if (!modal) return;
      if (!await confirmWorkspaceClose(modal, [{title: session.state.profile.label, status: 'connected', persistent: false}], tr)) return;
    }
    if (disposed || sessions.get(key) !== session) return;
    try {await session.dispose(); sessions.delete(key); groups.remove(key);}
    catch {failed = true;}
    update();
  }
  function resize(event: PointerEvent | KeyboardEvent, node?: Extract<WorkspaceLayoutNode, {type: 'split'}>) {
    const element = event.currentTarget as HTMLElement, bounds = element.parentElement!.getBoundingClientRect();
    const original = node ? node.ratio : listWidth;
    const change = (delta: number) => {
      if (node) node.ratio = Math.max(0.15, Math.min(0.85, original + delta));
      else {
        const width = Math.max(36, Math.min(Math.max(36, Math.min(360, bounds.width * 0.55)), original - delta));
        listWidth = width < 72 ? 36 : width;
      }
      paint();
    };
    if (event instanceof KeyboardEvent) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      change((['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (node ? 0.05 : 40)); return;
    }
    if (event.button) return;
    event.preventDefault();
    cancelResize?.();
    const horizontal = !node || node.direction === 'row', start = horizontal ? event.clientX : event.clientY;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const position = horizontal ? next.clientX : next.clientY;
      change(node ? (position - start) / (horizontal ? bounds.width : bounds.height) : position - start);
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      cancelResize?.();
    };
    cancelResize = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true); cancelResize = null;
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }
  function layoutView(node: WorkspaceLayoutNode): VNodeChild {
    if (node.type === 'split') return h('div', {key: node.id, class: ['panel-terminal-split', node.direction],
      style: {'--local-ratio': `${node.ratio * 100}%`}}, [layoutView(node.first),
      h('div', {class: 'panel-terminal-divider', role: 'separator', tabindex: 0, 'aria-label': text('resize_split'),
        'aria-orientation': node.direction === 'row' ? 'vertical' : 'horizontal', 'aria-valuemin': 15, 'aria-valuemax': 85,
        'aria-valuenow': Math.round(node.ratio * 100), onPointerdown: (event: PointerEvent) => resize(event, node),
        onKeydown: (event: KeyboardEvent) => resize(event, node)}), layoutView(node.second)]);
    const session = sessions.get(node.activeTabKey);
    return h('div', {key: node.id, class: ['panel-terminal-pane', {focused: groups.focused === node.activeTabKey}],
      'data-local-pane': node.activeTabKey, onPointerdown: () => {
        if (groups.focused !== node.activeTabKey) {groups.select(node.activeTabKey); update();}
      }}, [
      h('div', {class: 'panel-terminal-mount', onVnodeMounted: vnode => {
        if (session && vnode.el instanceof HTMLElement) {vnode.el.append(session.element); session.refit();}
      }, onVnodeUpdated: vnode => {
        if (session && vnode.el instanceof HTMLElement && session.element.parentElement !== vnode.el) vnode.el.append(session.element);
        session?.refit();
      }}),
      session?.state.failed ? h('div', {role: 'alert', class: 'terminal-panel-notice'}, text('local_terminal_failed')) : null,
      session && !session.state.running && !session.state.pending ? h('div', {class: 'panel-terminal-exited'}, text('terminal_exited')) : null
    ]);
  }
  function paint() {
    if (!host || disposed) return;
    if (container.parentElement !== host) host.replaceChildren(container);
    const group = groups.current();
    render(available ? h('div', {class: 'panel-terminal-body'}, [
      h('div', {class: 'panel-terminal-groups'}, group ? [layoutView(group.layout)] :
        [h(TermaButton, {'data-panel-start-terminal': tabKey, onClick: () => create()}, () => text('start_local_terminal'))]),
      sessions.size > 1 ? h('div', {class: 'panel-terminal-list-resizer', role: 'separator', tabindex: 0,
        'aria-label': text('resize_terminal_list'), 'aria-orientation': 'vertical',
        'aria-valuemin': 36, 'aria-valuemax': 360, 'aria-valuenow': Math.round(listWidth),
        onPointerdown: (event: PointerEvent) => resize(event), onKeydown: (event: KeyboardEvent) => resize(event)}) : null,
      sessions.size > 1 ? h('div', {class: ['panel-terminal-instances', {'icons-only': listWidth === 36}],
        style: {'--terminal-list-width': `${listWidth}px`}, role: 'list', 'aria-label': text('terminal_instances')},
        groups.groups.flatMap(group => groups.keys(group.layout).map((key, index) => {
          const session = sessions.get(key)!;
          return h('div', {key, role: 'listitem', class: ['panel-terminal-instance', {active: key === groups.focused, nested: index > 0}],
            'data-local-instance': key}, [h('button', {type: 'button', 'aria-pressed': key === groups.focused,
              title: session.state.profile.label, onClick: () => {groups.select(key); update(); session.focus();}},
              [icon(session.state.profile.id === 'git-bash' ? 'git-branch' : session.state.profile.id === 'cmd' ? 'terminal' : 'square-terminal'),
                h('span', null, session.state.profile.label), session.state.elevated ? icon('shield') : null]),
              h(TermaButton, {class: 'icon-button', title: text('split_terminal'), 'aria-label': text('split_terminal'),
                onClick: () => {groups.select(key); create(session.state.profile, 'row');}}, () => icon('columns-2')),
              h(TermaButton, {class: 'icon-button', title: text('close_terminal'), 'aria-label': text('close_terminal'),
                onClick: () => {void remove(key);}}, () => icon('trash-2'))]);
        }))) : null,
      failed ? h('span', {class: 'terminal-panel-notice', role: 'alert'}, text('local_terminal_failed')) : null
    ]) : h('p', {class: 'terminal-panel-empty'}, text('local_desktop_required')), container);
  }
  function controls() {
    if (!available) return null;
    const session = selected();
    const button = (key: string, glyph: string, run: (event: MouseEvent) => unknown, disabled = false) =>
      h(TermaButton, {class: 'icon-button', title: text(key), 'aria-label': text(key), 'data-local-action': key, disabled, onClick: run}, () => icon(glyph));
    return h('div', {class: 'panel-terminal-tools'}, [
      button('new_terminal', 'plus', () => create(), sessions.size >= 12),
      button('terminal_profiles', 'chevron-down', event => showActionMenu(event, [
        ...profiles.map(profile => ({label: profile.label, icon: 'square-terminal', run: () => create(profile)})),
        ...(windows ? [{separator: true as const}, {label: text('administrator'), icon: 'shield', run: () => create(profiles[0], null, true)}] : [])
      ])),
      sessions.size === 1 && session ? h('span', {class: 'panel-terminal-profile', title: session.state.profile.label},
        [icon('square-terminal'), session.state.profile.label]) : null,
      button('split_terminal', 'columns-2', () => create(session?.state.profile, 'row'), !session || sessions.size >= 12),
      button('close_terminal', 'trash-2', () => {if (session) void remove(session.state.key);}, !session)
    ]);
  }
  function focus() {
    const session = selected();
    if (session?.focus()) return true;
    const startButton = host?.querySelector<HTMLElement>(`[data-panel-start-terminal="${CSS.escape(tabKey)}"]`);
    startButton?.focus({preventScroll: true});
    return Boolean(startButton && document.activeElement === startButton);
  }
  return {key: tabKey, controls, focus,
    sync(element: HTMLElement | null, _next: PanelTarget | null, visible = true) {
      host = element; for (const session of sessions.values()) session.theme();
      paint();
      if (host && visible && available && !initialized) {
        initialized = true; create();
        void bridge!.localTerminalProfiles?.().then(result => {
          if (!disposed && Array.isArray(result) && result.length) {profiles = result.slice(0, 20); update();}
        }).catch(() => {failed = true; update();});
      }
    },
    dispose() {
      disposed = true; cancelResize?.(); render(null, container);
      for (const session of sessions.values()) void session.dispose().catch(() => console.warn('Local terminal cleanup failed'));
      sessions.clear(); container.remove(); host = null;
    }};
}
