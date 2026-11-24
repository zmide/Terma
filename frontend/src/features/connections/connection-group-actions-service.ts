import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import type { ConnectionViewPort } from './connection-port';

export type ConnectionGroupActionsPort = Omit<ConnectionViewPort, 'inputModal'> & {
  inputModal(...args: any[]): Promise<unknown>;
  refreshGroupSelection?(currentName: string, nextName: string): void;
  createSshInGroup(name: string): void;
  createRemoteInGroup(name: string): void;
};

export type ConnectionGroupActionsService = {
  readonly adding: boolean;
  startAdding(): void;
  cancelAdding(): void;
  confirmAdding(name: string): void;
  rename(currentName: string): Promise<boolean>;
};

export function createConnectionGroupActionsService(port: ConnectionGroupActionsPort): ConnectionGroupActionsService {
  let adding = false;

  function startAdding() {
    if (port.primaryView !== 'connections' && port.primaryView !== 'remote') return;
    adding = true;
    port.renderConnections();
    port.$('newGroupName')?.focus();
  }

  function cancelAdding() {
    adding = false;
    port.renderConnections();
  }

  function confirmAdding(input: string) {
    if (!adding || (port.primaryView !== 'connections' && port.primaryView !== 'remote')) return;
    const name = input.trim();
    if (!name) return port.notify(port.tr('connections:groups.name_required', {defaultValue: '请输入分组名称'}), 'error');
    const remote = port.primaryView === 'remote';
    if (remote) {
      port.remoteGroupOpen.add(name);
      port.saveRemoteGroupState();
    } else {
      port.pendingGroup = name;
      port.groupOpen.add(name);
      port.saveGroupState();
    }
    cancelAdding();
    if (remote) {
      port.pendingGroup = '';
      port.createRemoteInGroup(name);
    } else port.createSshInGroup(name);
  }

  async function rename(currentName: string) {
    const name = await port.inputModal(
      port.tr('connections:groups.rename', {defaultValue: '重命名分组'}),
      port.tr('connections:groups.name_label', {defaultValue: '分组名称'}),
      currentName
    );
    const nextName = String(name || '').trim();
    if (!nextName || nextName === currentName) return false;
    const result = await port.api('/api/connection-groups/rename', {
      method: 'POST',
      body: JSON.stringify({current_name: currentName, new_name: nextName})
    }) as {group_name: string; updated?: number};
    if (port.groupOpen.delete(currentName)) port.groupOpen.add(result.group_name);
    if (port.remoteGroupOpen.delete(currentName)) port.remoteGroupOpen.add(result.group_name);
    port.saveGroupState();
    port.saveRemoteGroupState();
    await port.loadAll();
    port.refreshGroupSelection?.(currentName, result.group_name);
    port.notify(port.tr('connections:groups.renamed', {
      count: result.updated || 0,
      defaultValue: `分组已重命名，更新 ${result.updated || 0} 个连接`
    }), 'success');
    return true;
  }

  return {get adding() {return adding;}, startAdding, cancelAdding, confirmAdding, rename};
}

export function installConnectionGroupActionsService(host: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionGroups) {
    const port = Object.create(host) as ConnectionGroupActionsPort;
    port.createSshInGroup = name => connectionsServices.termaConnectionFormWorkspace.create(name);
    port.createRemoteInGroup = name => remoteServices.termaRemoteProfiles.editor.create('rdp', name);
    connectionsServices.termaConnectionGroups = createConnectionGroupActionsService(port);
  }
}



export interface InstalledFeaturesConnectionsConnectionGroupActionsServiceServices {
  termaConnectionGroups?: ConnectionGroupActionsService;
}
