import {filesServices} from '@/features/files/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {chooseModal,confirmModal} from '@/shared/workspace-prompts';
import {beginUiAction,endUiAction} from '@/shared/ui-action-service';
import {isMobileLayout} from '@/shared/browser-ui';
import { createFileConflictPrompts } from '@/features/files/file-conflict-prompts';
import type { WorkspaceTab } from '@/features/workspace/workspace-tab-runtime';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import type { chooseModal as chooseModalAlias, confirmModal as confirmModalAlias } from '@/shared/workspace-prompts';
import { sftpArchiveName } from './file-operations-workspace';
import { createSftpDownloadService, type SftpDownloadPort } from './sftp-download-service';
import { createSftpUploadService, sendSftpUpload, updateSftpUploadReceiveProgress } from './sftp-upload-service';
import type { TaskRecord } from './sftp-task-model';
import type { SftpTabRuntime } from './tab-runtime';
import { createSftpTransferController } from './transfer-controller';
import { captureSftpTransferTarget, createSftpDownloadNotice, prepareSftpUploadDirectories } from './transfer-preparation';
import type { createSftpViewWorkspace } from './view-workspace';

type ControllerPort = Parameters<typeof createSftpTransferController>[0];
type UploadTransport = typeof sendSftpUpload;
interface TransferWorkspacePort {
  tabs(): WorkspaceTab[];
  runtimes: Map<string, SftpTabRuntime>;
  view: ReturnType<typeof createSftpViewWorkspace>;
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  text: ControllerPort['tr'];
  notify: ControllerPort['notify'];
  jobs(): TaskRecord[];
  pendingDownloads: Set<string>;
  requests: Parameters<UploadTransport>[0]['requests'];
}

export function createSftpTransferWorkspace({ tabs, runtimes, view, api, text, notify, jobs, pendingDownloads, requests }: TransferWorkspacePort) {
  const conflicts = createFileConflictPrompts({ text, choose: async (...args) => await chooseModal(...args) ?? '' });
  const downloads = createSftpDownloadService();
  const uploads = createSftpUploadService();
  const firstDownload = createSftpDownloadNotice();
  const refreshJobs = () => filesServices.termaSftpTaskWorkspace.runtime.refresh();
  const start = () => filesServices.termaSftpTransferLifecycle.polling.start();
  const target: ControllerPort['target'] = (key, id, directory) => captureSftpTransferTarget({
    tabs: () => tabs().filter((tab): tab is WorkspaceTab & { kind: string } => typeof tab.kind === 'string'),
    runtime: tabKey => runtimes.get(tabKey)
  }, key, id, directory);
  const directories = (id: number, root: string, files: Parameters<ControllerPort['directories']>[2], selected: string[] = [], isCurrent = () => true) => prepareSftpUploadDirectories({
    api, isCurrent, invalidPath: () => new Error(text('sftp:transfer.invalid_upload_path'))
  }, id, root, files, selected);
  function notice(settings: Parameters<SftpDownloadPort['notice']>[0]) {
    return firstDownload.confirm({
      remembered: key => localStorage.getItem(key) === '1', remember: key => localStorage.setItem(key, '1'),
      mobile: () => isMobileLayout(), text, confirm: (...args) => confirmModal(...args)
    }, settings);
  }
  const transport = {
    send(url: string, file: File, job: Parameters<UploadTransport>[3]) {
      return sendSftpUpload({
        createXhr: () => new XMLHttpRequest(), requests,
        progress(loaded, total) {
          const current = jobs();
          if (updateSftpUploadReceiveProgress(current, String(job.id || ''), loaded, total)) filesServices.termaSftpTaskWorkspace.state.paint(current);
        },
        cancelled: () => Object.assign(new Error(text('sftp:transfer.upload_cancelled')), { cancelled: true }),
        failed: () => new Error(text('sftp:transfer.upload_connection_failed')),
        timeout: () => new Error(text('sftp:transfer.upload_timeout'))
      }, url, file, job);
    }
  };
  const track: ControllerPort['track'] = job => filesServices.termaSftpTransferLifecycle.completion.track(job);
  const downloadPort = (): SftpDownloadPort => ({ api, settings: controller.settings, notice, track: controller.track, refresh: refreshJobs, start });
  const controller: ReturnType<typeof createSftpTransferController> = createSftpTransferController({
    context(key) {
      const tab = tabs().find(item => item.key === key && item.kind === 'sftp');
      if (!tab) return null;
      const id = Number(tab.id), directory = String(runtimes.get(key)?.state.path || tab.path || '.');
      return { id, key, directory, valid: target(key, id, directory) };
    },
    target, selected: view.selectedEntries, paths: view.selectedPaths, clear: view.clearSelection,
    input: key => { const node = view.element('sftpUpload', key); return node instanceof HTMLInputElement ? node : null; },
    downloadPort, readSettings: () => api('/api/sftp/download-settings'), downloads, uploads,
    uploadPort: () => ({ api, choose: conflicts.upload, upload: (...args) => transport.send(...args), track, jobs,
      refresh: refreshJobs, start, failed: () => new Error(text('sftp:transfer.upload_failed')) }),
    concurrency: () => Number(settingsServices.termaRuntimeSettingsModel.snapshot?.saved?.sftp_upload_concurrency || 3), directories,
    refreshDirectory: key => filesServices.termaSftpFileActions.refresh(key), choose: (...args) => chooseModal(...args),
    archive: async options => await filesServices.termaSftpEntryActions.archive(options) ?? null,
    archiveName: sftpArchiveName, desktopSend: () => filesServices.termaFileTransferRuntime?.desktop,
    jobs, track, pendingDownloads, begin: (...args) => beginUiAction(...args), end: (...args) => endUiAction(...args), tr: text, notify
  });
  return { controller, conflicts, target, directories, transport };
}



export interface InstalledFeaturesFilesSftpTransferWorkspaceServices {
  termaSftpTransfers: ReturnType<typeof createSftpTransferWorkspace>
}
