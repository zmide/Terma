import type { TerminalDisplayMenuAction } from '../terminal/TerminalDisplayMenuView';
import type { X11Connection, X11Session } from './x11-types';

type X11MenuActions = () => TerminalDisplayMenuAction[];

export interface X11TerminalMenuPort {
  connection(key: string, id: number): X11Connection | null | undefined;
  session(key: string): X11Session | undefined;
  tr(key: string): string;
  open(event: MouseEvent, actions: X11MenuActions): unknown;
  launch(id: number): unknown;
  temporary(id: number, mode: string): unknown;
  quick(key: string, mode: string): unknown;
  manager(id: number, key?: string): unknown;
  current(id: number, mode: string, key: string): unknown;
  nextTerminal(id: number, mode: string): unknown;
  nextStart(id: number, mode: string): unknown;
}

export function createX11TerminalMenuService(port: X11TerminalMenuPort) {
  const t = (key: string) => port.tr(key);

  function scopes(id: number, mode: string, key = ''): TerminalDisplayMenuAction[] {
    return [
      { key: 'current-terminal', label: t('terminal:x11_menu.current_terminal'), icon: 'refresh-cw', run: () => port.current(id, mode, key) },
      { key: 'new-terminal', label: t('terminal:x11_menu.new_terminal'), icon: 'square-terminal', run: () => port.nextTerminal(id, mode) },
      { key: 'next-start', label: t('terminal:x11_menu.next_start'), icon: 'save', run: () => port.nextStart(id, mode) }
    ];
  }

  function actions(id: number, key = ''): TerminalDisplayMenuAction[] {
    const connection = port.connection(key, id);
    if (!connection) return [];
    return [
      { key: 'launch-app', label: t('terminal:x11_menu.launch_app'), icon: 'panels-top-left', run: () => port.launch(id) },
      { separator: true, label: '' },
      { key: 'temporary-untrusted', label: t('terminal:x11_menu.temporary_untrusted'), icon: 'x11', run: () => port.temporary(id, 'untrusted') },
      { key: 'temporary-trusted', label: t('terminal:x11_menu.temporary_trusted'), icon: 'badge-check', run: () => port.temporary(id, 'trusted') },
      { separator: true, label: '' },
      { key: 'xserver-manager', label: t('common:x11.manager'), icon: 'x11', run: () => port.manager(id) },
      { separator: true, label: '' },
      { key: 'default-untrusted', label: t('terminal:x11_menu.default_untrusted'), icon: 'shield-check', children: () => scopes(id, 'untrusted', key) },
      { key: 'default-trusted', label: t('terminal:x11_menu.default_trusted'), icon: 'badge-check', children: () => scopes(id, 'trusted', key) },
      ...(connection.x11_mode !== 'off'
        ? [{ key: 'disable-default', label: t('terminal:x11_menu.disable_default'), icon: 'x', children: () => scopes(id, 'off', key) }]
        : [])
    ];
  }

  function quickActions(key: string, id: number): TerminalDisplayMenuAction[] {
    return [
      { key: 'quick-untrusted', label: t('terminal:x11_menu.temporary_untrusted'), icon: 'x11', run: () => port.quick(key, 'untrusted') },
      { key: 'quick-trusted', label: t('terminal:x11_menu.temporary_trusted'), icon: 'badge-check', run: () => port.quick(key, 'trusted') },
      { separator: true, label: '' },
      { key: 'quick-manager', label: t('common:x11.manager'), icon: 'x11', run: () => port.manager(id, key) }
    ];
  }

  function open(event: MouseEvent, id: number, key = '') {
    if (!port.connection(key, id)) return;
    return port.open(event, () => actions(id, key));
  }

  function openQuick(event: MouseEvent, key: string) {
    const tabKey = String(key || '');
    const session = port.session(tabKey);
    if (!session?.connection?.quick_connection) return;
    const id = Number(session.connection.id || 0);
    return port.open(event, () => quickActions(tabKey, id));
  }

  return { actions, scopes, open, openQuick };
}



export interface InstalledFeaturesX11TerminalMenuServiceServices {
  termaX11TerminalMenu?: ReturnType<typeof createX11TerminalMenuService>;
}
