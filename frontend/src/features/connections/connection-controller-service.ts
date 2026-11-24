import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';

export type ConnectionControllerRecord = {
  id: number;
  name?: string;
  group_name?: string;
};

export type ConnectionControllerPort = {
  connections: ConnectionControllerRecord[];
  quickConnectionsById?: Map<number, ConnectionControllerRecord>;
  selectedId: unknown;
  groupOpen: Set<string>;
  defaultGroup: string;
  saveGroupState(): void;
  renderConnections(): void;
  syncSelectedConnectionRow(id: number): void;
  api(url: string, options?: {method?: string; body?: string}): Promise<any>;
  tr(key: string, values?: Record<string, unknown>): string;
  confirmModal(message: string, title: string, confirmLabel: string, cancelLabel: string, danger?: boolean): Promise<boolean>;
  captureWorkspacePane?(): (action: () => unknown) => unknown;
  loadAll(): Promise<unknown>;
  renderWelcome(): unknown;
  notify(message: string, kind?: string): void;
};

export type ConnectionControllerService = {
  current(id?: unknown): ConnectionControllerRecord | undefined;
  select(id: unknown, options?: {render?: boolean; reveal?: boolean}): ConnectionControllerRecord | undefined;
  remove(id: number): Promise<unknown>;
  duplicate(id: number): Promise<unknown>;
};

function fallbackPane(action: () => unknown) {
  return action();
}

export function createConnectionControllerService(port: ConnectionControllerPort): ConnectionControllerService {
  function quickConnection(id: unknown) {
    const connectionId = Number(id);
    return port.quickConnectionsById?.get(connectionId);
  }

  function current(id: unknown = port.selectedId) {
    return quickConnection(id) || port.connections.find(connection => connection.id === Number(id));
  }

  function select(id: unknown, {render = true, reveal = true}: {render?: boolean; reveal?: boolean} = {}) {
    const quick = quickConnection(id);
    if (quick) return quick;
    port.selectedId = id;
    const connection = current();
    if (connection && reveal) {
      port.syncSelectedConnectionRow(connection.id);
      const wasOpen = port.groupOpen.has(String(connection.group_name || port.defaultGroup));
      port.groupOpen.add(String(connection.group_name || port.defaultGroup));
      if (!wasOpen) port.saveGroupState();
    }
    if (render) port.renderConnections();
    return connection;
  }

  async function remove(id: number) {
    const inPane = port.captureWorkspacePane?.() || fallbackPane;
    const connection = current(id);
    const name = connection?.name || id;
    if (!await port.confirmModal(
      port.tr('connections:dialogs.delete_ssh_message', {name, defaultValue: `删除连接 ${name} 及其所有转发？`}),
      port.tr('connections:dialogs.delete_ssh_title', {defaultValue: '删除 SSH 连接'}),
      port.tr('common:actions.delete', {defaultValue: '删除'}),
      port.tr('common:actions.cancel', {defaultValue: '取消'}),
      true
    )) return null;
    await port.api(`/api/connections/${id}`, {method: 'DELETE'});
    if (Number(port.selectedId) === Number(id)) port.selectedId = null;
    await port.loadAll();
    inPane(() => port.renderWelcome());
    port.notify(port.tr('connections:notifications.ssh_deleted', {defaultValue: '已删除连接'}), 'success');
    return true;
  }

  async function duplicate(id: number) {
    const source = current(id);
    const result = await port.api(`/api/connections/${id}/duplicate`, {method: 'POST'});
    port.groupOpen.add(source?.group_name || port.defaultGroup);
    port.saveGroupState();
    await port.loadAll();
    port.notify(port.tr('connections:notifications.duplicated', {name: result.name, defaultValue: `已复制为 ${result.name}`}), 'success');
    return result;
  }

  return {current, select, remove, duplicate};
}

export function installConnectionControllerService(host: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionController) {
    connectionsServices.termaConnectionController = createConnectionControllerService(host);
  }
}




export interface InstalledFeaturesConnectionsConnectionControllerServiceServices {
  termaConnectionController?: ConnectionControllerService;
}
