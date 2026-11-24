import {connectionsServices} from '@/features/connections/installed-services';
import type { TerminalDisplayMenuAction } from '../terminal/TerminalDisplayMenuView';

export interface ConnectionMenuPort {
  connection(id: number): { x11_mode?: string } | undefined;
  tr(key: string): string;
  open(event: MouseEvent, actions: () => TerminalDisplayMenuAction[]): unknown;
  sftp(id: number): unknown;
  dashboard(id: number): unknown;
  health(id: number): unknown;
  x11(id: number): TerminalDisplayMenuAction[];
  remoteOpen(id: number): TerminalDisplayMenuAction[];
  remoteCreate(id: number): TerminalDisplayMenuAction[];
  duplicate(id: number): unknown;
  edit(id: number): unknown;
  remove(id: number): unknown;
  groups(): string[];
  rename(group: string): unknown;
  move(group: string, delta: -1 | 1): unknown;
}

export function createConnectionMenuService(port: ConnectionMenuPort) {
  function actions(id: number, remoteOpenActions?: TerminalDisplayMenuAction[]): TerminalDisplayMenuAction[] {
    const connection = port.connection(id);
    if (!connection) return [];
    const remoteOpen = remoteOpenActions ?? port.remoteOpen(id);
    return [
      { key: 'sftp', label: port.tr('connections:actions.sftp_files'), icon: 'folder-open', run: () => port.sftp(id) },
      { key: 'dashboard', label: port.tr('connections:actions.server_dashboard'), icon: 'gauge', run: () => port.dashboard(id) },
      { key: 'health', label: port.tr('connections:actions.health_check'), icon: 'activity', run: () => port.health(id) },
      {
        key: 'x11',
        label: port.tr(connection.x11_mode && connection.x11_mode !== 'off'
          ? 'connections:actions.x11_terminal_enabled'
          : 'connections:actions.x11_terminal'),
        icon: 'x11',
        children: () => port.x11(id)
      },
      ...(remoteOpen.length ? [{
        key: 'open-remote', label: port.tr('connections:actions.open_other_connections'),
        icon: 'external-link', children: () => remoteOpen
      }] : []),
      { key: 'create-remote', label: port.tr('connections:actions.generate_other_connections'), icon: 'plug-zap', children: () => port.remoteCreate(id) },
      { separator: true, label: '' },
      { key: 'duplicate', label: port.tr('connections:actions.duplicate'), icon: 'copy', run: () => port.duplicate(id) },
      { key: 'edit', label: port.tr('connections:actions.edit'), icon: 'pencil', run: () => port.edit(id) },
      { key: 'delete', label: port.tr('connections:actions.delete'), icon: 'trash-2', danger: true, run: () => port.remove(id) }
    ];
  }

  function groupActions(group: string): TerminalDisplayMenuAction[] {
    const groups = port.groups();
    const index = groups.indexOf(group);
    return [
      { key: 'rename', label: port.tr('connections:groups.rename'), icon: 'pencil', run: () => port.rename(group) },
      { separator: true, label: '' },
      ...(index > 0 ? [{
        key: 'move-up', label: port.tr('connections:groups.move_up'), icon: 'arrow-up', run: () => port.move(group, -1)
      }] : []),
      ...(index >= 0 && index < groups.length - 1 ? [{
        key: 'move-down', label: port.tr('connections:groups.move_down'), icon: 'arrow-down', run: () => port.move(group, 1)
      }] : [])
    ];
  }

  function open(event: MouseEvent, id: number) {
    if (!port.connection(id)) return;
    // Keep the opened submenu's targets and indices stable during a refresh.
    const remoteOpen = port.remoteOpen(id);
    return port.open(event, () => actions(id, remoteOpen));
  }

  function openGroup(event: MouseEvent, group: string) {
    return port.open(event, () => groupActions(group));
  }

  return { actions, groupActions, open, openGroup };
}



export function installConnectionMenuService(port: ConnectionMenuPort) {
  if (connectionsServices.termaConnectionMenu) return;
  connectionsServices.termaConnectionMenu = createConnectionMenuService(port);
}

export interface InstalledFeaturesConnectionsConnectionMenuServiceServices {
  termaConnectionMenu?: ReturnType<typeof createConnectionMenuService>;
}
