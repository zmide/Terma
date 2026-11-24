import {tr} from '@/shared/i18n/workspace-bootstrap';
import {saveRemoteGroupState} from '@/shared/expanded-groups';
import {applicationState} from '@/shared/application-state';
import type {RemoteProfile} from './profile-model';
import {normalizeRelatedHost} from './profile-relations';
import { DEFAULT_CONNECTION_GROUP } from '@/shared/connection-group';

type HostProfile = Pick<RemoteProfile, 'id' | 'group_name' | 'protocol' | 'host' | 'options'>;
type HostConnection = {id?: number; name?: string; ssh_host?: string};
interface HostGroupsPort {
  defaultGroup(): string;
  connections(): readonly HostConnection[];
  getSaved(): string | null;
  save(value: string): void;
  expandGroup(name: string): void;
  translate(key: string, defaultValue: string): string;
}

export function createProfileHostGroups(port: HostGroupsPort) {
  let expanded: Set<string> | undefined;
  let selected: number | null = null;

  function openHosts() {
    if (expanded) return expanded;
    try {
      const values: unknown = JSON.parse(port.getSaved() || '[]');
      return expanded = new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []);
    } catch {
      return expanded = new Set();
    }
  }

  function key(profile: HostProfile) {
    const group = String(profile.group_name || port.defaultGroup()).trim() || port.defaultGroup();
    if (profile.protocol === 'serial') return JSON.stringify(['serial', group, String(profile.options?.path || 'local').trim().toLowerCase()]);
    return JSON.stringify(['host', group, normalizeRelatedHost(profile.host) || 'unknown']);
  }

  function label(profile: HostProfile) {
    if (profile.protocol === 'serial') return String(profile.options?.path || port.translate('connections:list.local_serial', '本机串口'));
    const host = normalizeRelatedHost(profile.host);
    const sourceId = Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0);
    const matches = (connection: HostConnection) => normalizeRelatedHost(connection.ssh_host) === host;
    const candidates = port.connections();
    const match = candidates.find(connection => Number(connection.id) === sourceId && matches(connection)) || candidates.find(matches);
    return String(match?.name || profile.host || '').trim() || port.translate('connections:list.host_not_set', '未设置主机');
  }

  function toggle(hostKey: string) {
    const opened = openHosts();
    if (!opened.delete(hostKey)) opened.add(hostKey);
    port.save(JSON.stringify([...opened]));
  }

  function reveal(profile: HostProfile | null) {
    selected = profile?.id ?? null;
    if (!profile) return;
    port.expandGroup(profile.group_name || port.defaultGroup());
    const opened = openHosts();
    opened.add(key(profile));
    port.save(JSON.stringify([...opened]));
  }

  return {key, label, isOpen: (hostKey: string) => openHosts().has(hostKey), toggle, reveal,
    isSelected: (profileId: number) => selected === profileId,
    clearSelection: (profileId: number) => {if (selected === profileId) selected = null;}};
}

const storageKey = 'openRemoteHostsV2';
export const profileHostGroups = createProfileHostGroups({
  defaultGroup: () => DEFAULT_CONNECTION_GROUP,
  connections: () => applicationState.connections,
  getSaved: () => localStorage.getItem(storageKey),
  save: value => localStorage.setItem(storageKey, value),
  expandGroup(name) {applicationState.remoteGroupOpen.add(name); saveRemoteGroupState();},
  translate: (key, defaultValue) => tr(key, {defaultValue}),
});
