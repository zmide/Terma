import type { TerminalDisplayMenuAction } from '../terminal/TerminalDisplayMenuView';
import { createRemoteProfilePresentation, remoteProtocols, type RemoteProtocol } from './profile-model';
import type { ListProfile, RemoteListPort, createRemoteListService } from './profile-list-service';

export interface RemoteProfileMenuPort {
  open(profile: ListProfile): unknown;
  edit(id: number): unknown;
  test(id: number): unknown;
  create(protocol: RemoteProtocol, group?: string): unknown;
  menu(event: MouseEvent, actions: TerminalDisplayMenuAction[]): void;
}

export function createRemoteProfileMenus(port: RemoteListPort & RemoteProfileMenuPort, service: ReturnType<typeof createRemoteListService>) {
  const separator: TerminalDisplayMenuAction = {label: '', separator: true};
  const t = (key: string) => port.tr(`remote:actions.${key}`);
  const presentation = createRemoteProfilePresentation(port.tr);
  function add(event: MouseEvent) {
    port.menu(event, remoteProtocols.map(protocol => ({label:presentation.label(protocol),
      icon:presentation.icon(protocol),run:() => port.create(protocol)})));
  }
  function fromSsh(id: number): TerminalDisplayMenuAction[] {
    if (!port.connection(id)) return [];
    return [
      {label: t('generate_all'), icon: 'layers-3', run: () => service.generate(id, 'all')},
      separator,
      ...remoteProtocols.filter(protocol => protocol !== 'serial').map(protocol => ({
        label: port.tr('remote:actions.generate_protocol', {protocol: presentation.label(protocol)}),
        icon: presentation.icon(protocol), run: () => service.generate(id, protocol)
      })),
      separator,
      {label: t('serial_device_required'), icon: presentation.icon('serial'), run: () => {
        const connection = port.connection(id);
        if (!connection) return;
        port.showRemote();
        return port.create('serial', connection.group_name);
      }}
    ];
  }

  function show(event: MouseEvent, id: number) {
    const profile = port.profile(id);
    if (!profile) return;
    port.menu(event, [
      {label: presentation.action(profile.protocol), icon: presentation.icon(profile.protocol), run: () => {
        const current = port.profile(id);
        if (current?.protocol === profile.protocol) return port.open(current);
      }},
      {label: t('test'), icon: 'activity', run: () => port.test(id)},
      separator,
      {label: t('duplicate'), icon: 'copy', run: () => service.duplicate(id)},
      {label: t('edit'), icon: 'pencil', run: () => port.edit(id)},
      {label: t('delete'), icon: 'trash-2', danger: true, run: () => service.remove(id)}
    ]);
  }
  return {add, fromSsh, show};
}
