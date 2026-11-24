import type {TerminalDisplayMenuAction} from '../terminal/TerminalDisplayMenuView';
import type {RemoteDesktopAction, RemoteWorkspaceJumpActions} from './RemoteDesktopViews';
import {connectionStamp, profileStamp, type ManagementConnection} from './management-types';
import type {RemoteProfile, RemoteProtocol} from './profile-model';

export function normalizeRelatedHost(value: unknown) {
  let host = String(value || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host.replace(/\.$/, '').replace(/^::ffff:/, '');
}

export interface RemoteProfileRelationsPort {
  profiles(): RemoteProfile[];
  connection(id: number): ManagementConnection | undefined;
  managementConnectionId(profile: RemoteProfile): number;
  tr(key: string, params?: Record<string, unknown>): string;
  protocolLabel(protocol: RemoteProtocol): string;
  protocolIcon(protocol: RemoteProtocol): string;
  notify(message: string, kind: 'info'): void;
  showMenu(event: MouseEvent, actions: TerminalDisplayMenuAction[]): void;
  open(profile: RemoteProfile): unknown;
  terminal(connectionId: number): unknown;
  sftp(connectionId: number): unknown;
}

const graphical = (profile: RemoteProfile) => ['rdp', 'vnc', 'xdmcp'].includes(profile.protocol);

export function createRemoteProfileRelations(port: RemoteProfileRelationsPort) {
  const t = (key: string, params?: Record<string, unknown>) => port.tr(`remote:actions.${key}`, params);

  function forSsh(id: number) {
    const host = normalizeRelatedHost(port.connection(id)?.ssh_host);
    return host ? port.profiles().filter(profile => profile.protocol !== 'serial' && normalizeRelatedHost(profile.host) === host) : [];
  }

  const desktopsForSsh = (id: number) => forSsh(id).filter(graphical);

  function alternatives(profile: RemoteProfile) {
    const source = port.managementConnectionId(profile), host = normalizeRelatedHost(profile.host);
    return port.profiles().filter(candidate => Number(candidate.id) !== Number(profile.id) && graphical(candidate) && (source
      ? port.managementConnectionId(candidate) === source
      : !!host && normalizeRelatedHost(candidate.host) === host));
  }

  function sharedVnc(profile: RemoteProfile) {
    const host = normalizeRelatedHost(profile.host);
    return host ? port.profiles().find(item => item.protocol === 'vnc' && normalizeRelatedHost(item.host) === host) : undefined;
  }

  function actions(profiles: RemoteProfile[], current: () => RemoteProfile[]): TerminalDisplayMenuAction[] {
    return profiles.map(profile => {
      const stamp = profileStamp(profile);
      return {label: t('open_profile', {protocol: port.protocolLabel(profile.protocol), name: profile.name || ''}),
        icon: port.protocolIcon(profile.protocol), run: () => {
          const target = current().find(candidate => profileStamp(candidate) === stamp);
          if (target) port.open(target);
        }};
    });
  }

  function jumpFromSsh(event: MouseEvent, id: number) {
    const profiles = desktopsForSsh(id);
    if (!profiles.length) return port.notify(port.tr('remote:management.no_linked_desktop'), 'info');
    if (profiles.length === 1) return port.open(profiles[0]!);
    port.showMenu(event, actions(profiles, () => desktopsForSsh(id)));
  }

  function workspaceActions(profile: RemoteProfile): RemoteWorkspaceJumpActions {
    const sshId = port.managementConnectionId(profile), profiles = alternatives(profile);
    const ssh = sshId ? port.connection(sshId) : undefined;
    const sshStamp = ssh && connectionStamp(ssh);
    const stamp = profileStamp(profile);
    const currentProfile = () => port.profiles().find(candidate => profileStamp(candidate) === stamp);
    const stillLinked = () => {
      const current = currentProfile(), connection = port.connection(sshId);
      return current && port.managementConnectionId(current) === sshId && connection && connectionStamp(connection) === sshStamp;
    };
    const action = (icon: string, label: string, onClick: RemoteDesktopAction['onClick'], className = ''): RemoteDesktopAction =>
      ({icon, label, onClick, iconOnly: true, className: `workspace-jump-button ${className}`.trim()});
    return {label: t('linked_workspace'), actions: [
      ...(ssh ? [
        action('square-terminal', t('open_linked_terminal'), () => {if (stillLinked()) port.terminal(sshId);}),
        action('folder-open', t('open_linked_sftp'), () => {if (stillLinked()) port.sftp(sshId);})
      ] : []),
      {...action('monitor-up', profiles.length ? t('switch_other_desktops', {count: profiles.length}) : t('no_other_desktops'), event => {
        const origin = currentProfile();
        if (!origin) return;
        const current = () => {
          const owner = currentProfile();
          return owner ? alternatives(owner) : [];
        };
        const targets = current();
        if (targets.length) port.showMenu(event, actions(targets, current));
      }, 'remote-desktop-switch-button'), disabled: !profiles.length}
    ]};
  }

  return {normalizeHost: normalizeRelatedHost, desktopsForSsh, alternatives, sharedVnc, jumpFromSsh, workspaceActions,
    actionsForSsh: (id: number) => actions(forSsh(id), () => forSsh(id))};
}
