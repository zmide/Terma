import {filesServices} from '@/features/files/installed-services';
import {copyText} from '@/shared/clipboard-service';
import { confirmModal, inputModal } from '@/shared/workspace-prompts';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import { joinRemotePath, parentRemotePath } from './directory-state';
import { isSftpArchive, sftpArchiveBaseName, sftpDeleteConfirmation } from './file-operations-workspace';
import { createSftpMenuActions } from './menu-actions';
import { createSftpPermissionService } from './permission-service';
import type { installSftpPreviewWorkspace } from './preview-workspace';
import type { SftpDialogText, SftpDirectory } from './sftp-dialog-types';
import type { createSftpTabRuntime } from './tab-runtime';

interface ArchiveOptions {
  connectionId: number; tabKey?: string; mode?: string; filename?: string;
  target?: string; path?: string; encoding?: string; titleKey?: string;
}
interface EntryActionsPort {
  tabs: ReturnType<typeof createSftpTabRuntime>;
  preview: ReturnType<typeof installSftpPreviewWorkspace>;
  connections(): { id: number | string; sftp_filename_encoding?: string }[];
  activeKey(): string;
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  text: SftpDialogText;
  notify(message: string, kind: string): void;
}

export function createSftpEntryActions({ tabs, preview, connections, activeKey, api, text: tr, notify }: EntryActionsPort) {
  const menu = createSftpMenuActions({
    context(key, id = 0) {
      const context = tabs.dialogContext(key, id);
      if (!context) return null;
      return { key, connectionId: Number(context.tab.id), path: context.path,
        valid: () => context.valid() && (context.runtime.state.path || '.') === context.path };
    },
    text: tr, desktop: () => Boolean(window.termaDesktop),
    isImage: preview.editor.isSftpImageName, isArchive: isSftpArchive,
    clipboard: () => filesServices.termaSftpFileActions.clipboard.value?.mode || null,
    select({ key, connectionId }, file) {
      const views = filesServices.termaSftpViews;
      views?.select(key, connectionId, { preserveSelection: views.selectedPaths(key).includes(file.path), forceSingle: true }, file);
    },
    peers: ({ key, connectionId }, file) => filesServices.termaWorkspaceTransfer.current().remoteActions(key, connectionId, file.path, file.name, file.type),
    navigate: ({ key }, path) => filesServices.termaSftpView.navigate(path, key),
    entry(action, { connectionId: id, key }, { path, name, type }) {
      const files = filesServices.termaSftpFileActions, operations = files.operations;
      switch (action) {
        case 'image': return preview.image(id, path);
        case 'text': return preview.text(id, path);
        case 'external': return filesServices.termaSftpWorkflow.openEditor(id, path);
        case 'sync': return filesServices.termaSftpWorkflow.sync.open(id, path, key);
        case 'download': return filesServices.termaSftpTransfers.controller.download(id, path, type === 'dir' ? 'dir' : 'file');
        case 'pdf': return preview.pdf(id, path);
        case 'desktop': return filesServices.termaFileTransferRuntime.desktop(id, [path]);
        case 'extract': return operations.extract(key, id, path);
        case 'compress': return files.compressEntry(key, id, path);
        case 'copyPath': return copyText(path);
        case 'copy': case 'move': return files.copyEntry(key, path, action);
        case 'rename': return operations.rename(key, id, path, name);
        case 'permissions': return operations.permissions(key, [path]);
        case 'delete': return operations.remove(key, id, [path]);
      }
    },
    directory(action, { key, connectionId, path }) {
      const files = filesServices.termaSftpFileActions, operations = files.operations;
      switch (action) {
        case 'file': return operations.createFile(key);
        case 'directory': return operations.mkdir(key);
        case 'upload': return filesServices.termaSftpTransfers.controller.pick(key);
        case 'sync': return filesServices.termaSftpWorkflow.sync.open(connectionId, path, key);
        case 'paste': return operations.paste(key);
        case 'refresh': return files.refresh(key);
      }
    },
    show: (event, actions) => filesServices.termaSftpMenus?.show(event, actions),
    close: () => filesServices.termaSftpMenus?.release()
  });
  const permissions = createSftpPermissionService({
    tr, api, notify,
    context(key) {
      const context = tabs.dialogContext(key);
      return context && { connectionId: Number(context.tab.id), valid: context.valid };
    },
    open: options => filesServices.termaSftpDialogs?.permissions(options),
    refresh: key => { void filesServices.termaSftpFileActions.refresh(key); }
  });
  function nameDialog(context: { valid(): boolean } | null, titleKey: string, labelKey: string, value = '') {
    return filesServices.termaSftpDialogs?.input({ tr, titleKey, labelKey, value, valid: context?.valid,
      validate: name => filesServices.termaSftpFileActions.validName(name, tr(labelKey)) }) ?? inputModal(tr(titleKey), tr(labelKey), value);
  }
  function confirmDelete(enabled: boolean | null, count: number, path = '', context?: { valid(): boolean }) {
    const content = () => sftpDeleteConfirmation(tr, enabled, count, path);
    if (filesServices.termaSftpDialogs) return filesServices.termaSftpDialogs.confirm({ tr, content, valid: context?.valid });
    const item = content();
    return confirmModal(item.message, item.title, item.confirm, tr('common:actions.cancel'), item.danger);
  }
  function archive(options: ArchiveOptions) {
    const connectionId = Number(options.connectionId);
    const connection = connections().find(item => Number(item.id) === connectionId);
    const context = tabs.dialogContext(String(options.tabKey || activeKey()), connectionId);
    const valid = context?.valid || (() => Number.isSafeInteger(connectionId) && connectionId > 0 && !!connection && connections().includes(connection));
    const filename = String(options.filename || 'archive.tar.gz');
    return filesServices.termaSftpDialogs?.archive({ tr, valid, mode: String(options.mode || 'compress'), filename,
      target: String(options.target || '.'), path: String(options.path || ''), titleKey: options.titleKey || '',
      encoding: String(options.encoding || connection?.sftp_filename_encoding || 'utf8').toLowerCase(),
      encodings: filesServices.termaSftpPreferences.options, folderName: sftpArchiveBaseName(options.path || filename),
      parent: parentRemotePath, join: joinRemotePath,
      async list(path) {
        if (!valid()) throw new Error(tr('sftp:archive.directory_read_failed'));
        const params = new URLSearchParams({ path, page: '1', page_size: '200', sort: 'name', dir: 'asc' });
        return api<SftpDirectory>(`/api/connections/${connectionId}/sftp?${params}`);
      },
      async mkdir(path, name) {
        if (!valid()) return;
        const label = tr('sftp:operations.directory_label');
        if (!filesServices.termaSftpFileActions.validName(name, label)) throw new Error(tr('sftp:operations.invalid_child_name', { label }));
        await api(`/api/connections/${connectionId}/sftp/mkdir`, { method: 'POST', body: JSON.stringify({ path: joinRemotePath(path, name) }) });
      }
    });
  }
  return { menu, nameDialog, confirmDelete, permissions: permissions.open, archive };
}



export interface InstalledFeaturesFilesSftpEntryActionsWorkspaceServices {
  termaSftpEntryActions: ReturnType<typeof createSftpEntryActions>
}
