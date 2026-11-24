import {remoteServices} from '@/features/remote/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import { chooseModal, inputModal } from '@/shared/workspace-prompts';
import { createAutomationService } from '@/features/operations/automation-service';
import { showAutomations } from '@/features/operations/AutomationViews';
import { createDirectorySyncService } from '@/features/operations/directory-sync-service';
import { createExternalEditService, type ExternalEditPort } from '@/features/operations/external-edit-service';
import { showDirectorySync, showExternalManager } from '@/features/operations/OperationsViews';
import type { Translate } from '@/features/operations/operations-types';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';

interface WorkflowPort {
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  name(id: number): string | undefined;
  target(id: number, key: string): () => boolean;
  tr: Translate;
  notify: ExternalEditPort['notify'];
  bytes(size: number): string;
}

export function createSftpWorkflow({ api, tr, notify, name, target, bytes }: WorkflowPort) {
  const desktop = () => Boolean(window.termaDesktop);
  const hidden = () => document.hidden;
  const modal = () => document.getElementById('modal');
  const modalFree = () => Boolean(modal()?.hidden ?? true);
  let external: ReturnType<typeof createExternalEditService> | undefined;
  function externalEdit() {
    return external ??= createExternalEditService({
      api, desktop, hidden, tr, notify, choose: chooseModal, input: inputModal, modalFree,
      vnc: () => remoteServices.termaVncRuntime?.renderingActive() === true,
      stored: key => localStorage.getItem(key),
      settings: () => settingsServices.termaRuntimeSettingsModel.snapshot?.saved ?? settingsServices.termaRuntimeSettingsModel.snapshot ?? {},
      compare: (...args) => filesServices.termaSftpComparisonViews!.show(...args),
      progress: (title, detail) => efficiencyServices.termaNotificationToasts!.createProgress({ title, detail, icon: 'external-link' }),
      language(listener) {
        window.addEventListener('terma:language-changed', listener);
        return () => window.removeEventListener('terma:language-changed', listener);
      },
      available(listener) {
        const root = modal();
        if (!root) return () => {};
        const observer = new MutationObserver(() => { if (root.hidden) listener(); });
        observer.observe(root, { attributes: true, attributeFilter: ['hidden'], childList: true });
        return () => observer.disconnect();
      },
      refresh(id) {
        const { directories } = filesServices.termaSftpTransferLifecycle;
        directories.enqueue(id);
        directories.flush('');
      }
    });
  }
  async function externalManager() {
    const manager = showExternalManager({ api, tr, service: externalEdit(), notify });
    await manager.ready;
    return manager;
  }
  async function chooseDirectory() {
    const result = await api<{ path?: string }>('/api/sftp/sync/choose-directory', { method: 'POST', body: '{}' });
    return String(result?.path || '');
  }
  const sync = createDirectorySyncService({
    api, desktop, tr, notify, choose: chooseDirectory, capture: target,
    pickerCurrent() {
      const root = modal(), child = root?.firstElementChild, wasHidden = root?.hidden;
      return () => root?.firstElementChild === child && root?.hidden === wasHidden;
    },
    name: id => name(id) || tr('sftp:sync.ssh_host'),
    view: (model, actions, closed) => showDirectorySync(model, actions, closed, tr, bytes),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    refreshJobs: () => filesServices.termaSftpTaskWorkspace.runtime.refresh(),
    tasks: () => filesServices.termaSftpTaskWorkspace.runtime.open()
  });
  const automation = createAutomationService({
    api, tr, desktop, hidden, notify, nativeDirectory: chooseDirectory,
    openLocal: path => api('/api/local-files/open', { method: 'POST', body: JSON.stringify({ path }) }),
    openServer: path => filesServices.termaLocalFileRuntime.pages.open(path, true, '', 'server'),
    openRemote: (id, path) => filesServices.termaSftpPage.open(id, path, true),
    view: (model, actions, closed, escape) => showAutomations(model, actions, closed, escape, tr)
  });
  return { externalEdit, externalManager, openEditor: (id: number, path: string) => externalEdit().open(id, path), sync, automation };
}



export interface InstalledFeaturesFilesSftpFileWorkflowServices {
  termaSftpWorkflow: ReturnType<typeof createSftpWorkflow>
}
