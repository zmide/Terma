import {remoteServices} from '@/features/remote/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';
import { clearRemoteManagementDraft } from './connection-form-service';

export type ConnectionSaveOptions = {
  clearAfterSave?: boolean;
  connectAfterSave?: boolean;
  closeAfterSave?: boolean;
  trigger?: HTMLElement | null;
};

export type ConnectionSaveResult = {
  connectionId: number;
  generated: unknown;
};

export type ConnectionSaveService = {
  save(form: HTMLFormElement, options?: ConnectionSaveOptions): Promise<ConnectionSaveResult | null>;
};

function runInPane(port: ConnectionViewPort, action: () => unknown) {
  const inPane = port.captureWorkspacePane?.() || ((next: () => unknown) => next());
  return inPane(action);
}

export function createConnectionSaveService(port: ConnectionViewPort, linkManagement?: (typeof remoteServices)['termaRemoteManagement']['link']): ConnectionSaveService {
  let activeSave: HTMLFormElement | null = null;

  async function save(form: HTMLFormElement, options: ConnectionSaveOptions = {}) {
    if (!port.requireConfigEncryptionUnlocked(port.tr('connections:form.save_context', {defaultValue: '保存 SSH 连接'}))) return null;
    if (!form || form.dataset.saving === '1' || activeSave === form) return null;
    activeSave = form;
    form.dataset.saving = '1';
    const trigger = options.trigger || null;
    const clearAfterSave = options.clearAfterSave === true;
    const connectAfterSave = options.connectAfterSave === true;
    const closeAfterSave = options.closeAfterSave === true;
    const sourceTabKey = String(port.activeTabKey || '');
    if (trigger) port.setButtonBusy(trigger, true, port.tr('connections:form.saving', {defaultValue: '保存中...'}));
    try {
      if (!await port.ensureConnectionExtraArgsValid(form)) return null;
      const payload = port.connectionPayload(form, true);
      const remoteProfileLinkId = Number(form.dataset.remoteProfileLinkId || 0);
      const generation = !payload.id ? String(port.field(form, 'conn_remote_generation')?.value || '') : '';
      let generated: unknown = null;
      let savedConnectionId = Number(payload.id || 0);
      if (payload.id) {
        await port.api(`/api/connections/${payload.id}`, {method: 'PUT', body: JSON.stringify(payload)});
      } else {
        const saved = await port.api('/api/connections', {method: 'POST', body: JSON.stringify(payload)});
        savedConnectionId = Number(saved?.id || 0);
        if (generation && saved?.id) {
          try {
            generated = await port.api(`/api/connections/${saved.id}/remote-profiles`, {
              method: 'POST',
              body: JSON.stringify({protocol: generation})
            });
          } catch (error) {
            port.notify(port.tr('connections:form.generation_failed', {
              error: error instanceof Error ? error.message : String(error),
              defaultValue: `SSH 已保存，但其他连接生成失败：${error instanceof Error ? error.message : String(error)}`
            }), 'error');
          }
        }
      }
      if (!payload.id && Number.isSafeInteger(remoteProfileLinkId) && remoteProfileLinkId > 0 && savedConnectionId && linkManagement) {
        clearRemoteManagementDraft(form);
        try {
          const linked = await linkManagement(remoteProfileLinkId, savedConnectionId, {ssh_host: payload.ssh_host});
          if (linked === false) throw new Error(port.tr('remote:management.connection_not_found'));
        } catch (error) {
          port.notify(port.tr('connections:form.link_failed', {
            error: error instanceof Error ? error.message : String(error),
            defaultValue: `SSH 已保存，但自动关联远程连接失败：${error instanceof Error ? error.message : String(error)}`
          }), 'error');
        }
      }
      port.pendingGroup = '';
      port.groupOpen.add(payload.group_name);
      port.saveGroupState();
      await port.loadAll();
      if (connectAfterSave && savedConnectionId) {
        const sourceTab = port.tabs.find(tab => tab.key === sourceTabKey);
        if (sourceTab) {
          sourceTab.pinned = false;
          port.closeTabsByKey([sourceTabKey], sourceTabKey);
        }
        port.openTerminal(savedConnectionId);
      } else if (closeAfterSave && payload.id) {
        const sourceTab = port.tabs.find(tab => tab.key === sourceTabKey);
        if (sourceTab) {
          sourceTab.pinned = false;
          port.closeTabsByKey([sourceTabKey], sourceTabKey);
        }
      } else if (clearAfterSave && !payload.id) {
        let keyLoad: Promise<unknown> = Promise.resolve();
        runInPane(port, () => {
          if (!form.isConnected) return;
          port.resetConnectionForm(form);
          const key = form.querySelector<HTMLSelectElement>('#conn_key');
          if (key) keyLoad = Promise.resolve(port.loadKeys(undefined, key));
          port.field(form, 'conn_name')?.focus({preventScroll: true});
        });
        await keyLoad;
        const generatedCount = generation === 'all' ? Number((generated as any)?.created_count || 0) : generated ? 1 : 0;
        port.notify(generatedCount
          ? port.tr('connections:form.saved_generated_cleared', {count: generatedCount, defaultValue: `连接已保存，并生成 ${generatedCount} 个其他连接，表单已清空`})
          : port.tr('connections:form.saved_cleared', {defaultValue: '连接已保存，表单已清空'}), 'success');
      } else {
        const generatedCount = generation === 'all' ? Number((generated as any)?.created_count || 0) : generated ? 1 : 0;
        port.notify(generatedCount
          ? port.tr('connections:form.saved_generated', {count: generatedCount, defaultValue: `连接已保存，并生成 ${generatedCount} 个其他连接`})
          : port.tr('connections:form.saved', {defaultValue: '连接已保存'}), 'success');
      }
      return {connectionId: savedConnectionId, generated};
    } catch (error: any) {
      if (Array.isArray(error?.details?.issues)) port.renderConnectionExtraArgsDiagnostics(form, error.details.issues);
      const message = error instanceof Error ? error.message : String(error);
      port.notify(port.localizedTermaUiPhrase(message), 'error');
      return null;
    } finally {
      delete form.dataset.saving;
      if (trigger) port.setButtonBusy(trigger, false);
      if (activeSave === form) activeSave = null;
    }
  }

  return {save};
}

export function installConnectionSaveService(port: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionSave) {
    connectionsServices.termaConnectionSave = createConnectionSaveService(port,
      (...args) => remoteServices.termaRemoteManagement.link(...args));
  }
}



export interface InstalledFeaturesConnectionsConnectionSaveServiceServices {
  termaConnectionSave?: ConnectionSaveService;
}
