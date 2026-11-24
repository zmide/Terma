import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';

export type ConnectionBulkActionsService = {
  apply(): Promise<void>;
  remove(): Promise<void>;
};

function fieldValue(port: ConnectionViewPort, id: string) {
  return (port.$(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
}

export function createConnectionBulkActionsService(port: ConnectionViewPort): ConnectionBulkActionsService {
  async function apply() {
    const changes: Record<string, unknown> = {};
    const setGroup = Boolean((port.$('bulkSetGroup') as HTMLInputElement | null)?.checked);
    const setPort = Boolean((port.$('bulkSetPort') as HTMLInputElement | null)?.checked);
    const setAuth = Boolean((port.$('bulkSetAuth') as HTMLInputElement | null)?.checked);
    if (setGroup) changes.group_name = fieldValue(port, 'bulkGroup').trim();
    if (setPort) changes.ssh_port = Number(fieldValue(port, 'bulkPort'));
    if (setAuth) {
      const password = fieldValue(port, 'bulkAuthType') === 'password';
      changes.auth = password
        ? {type: 'password', password: fieldValue(port, 'bulkPassword')}
        : {type: 'key', identity_file: fieldValue(port, 'bulkIdentity')};
    }
    if (!Object.keys(changes).length) {
      port.notify(port.tr('connections:list.bulk_select_field', {defaultValue: '请至少勾选一项批量设置'}), 'info');
      return;
    }
    try {
      const result = await port.api('/api/connections/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ids: [...port.selectedConnectionIds], changes})
      });
      port.closeModal?.();
      port.selectedConnectionIds.clear();
      await port.loadAll();
      port.notify(port.tr('connections:list.bulk_updated', {
        count: result.updated || 0,
        defaultValue: `已更新 ${result.updated || 0} 个 SSH 连接`
      }), 'success');
    } catch (error: any) {
      port.notify(port.localizedTermaUiPhrase(error?.message || String(error)), 'error');
    } finally {
      const password = port.$('bulkPassword') as HTMLInputElement | null;
      if (password) password.value = '';
    }
  }

  async function remove() {
    const ids = [...port.selectedConnectionIds];
    if (!ids.length) {
      port.notify(port.tr('connections:list.select_ssh', {defaultValue: '请选择 SSH 连接'}), 'info');
      return;
    }
    try {
      port.closeModal?.();
      const result = await port.api('/api/connections/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ids})
      });
      if (ids.includes(Number(port.selectedId))) port.selectedId = null;
      port.selectedConnectionIds.clear();
      await port.loadAll();
      port.notify(port.tr('connections:list.bulk_deleted', {
        count: result.deleted || ids.length,
        defaultValue: `已删除 ${result.deleted || ids.length} 个 SSH 连接`
      }), 'success');
    } catch (error: any) {
      port.notify(port.localizedTermaUiPhrase(error?.message || String(error)), 'error');
    }
  }

  return {apply, remove};
}

export function installConnectionBulkActionsService(host: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionBulkActions) {
    connectionsServices.termaConnectionBulkActions = createConnectionBulkActionsService(host);
  }
}



export interface InstalledFeaturesConnectionsConnectionBulkActionsServiceServices {
  termaConnectionBulkActions?: ConnectionBulkActionsService;
}
