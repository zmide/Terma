import {filesServices} from '@/features/files/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import { chooseModal } from '@/shared/workspace-prompts';
import type { WorkspaceTab } from '@/features/workspace/workspace-tab-runtime';
import type { DirectoryLoadOptions } from './directory-loader';
import { joinRemotePath } from './directory-state';
import { createSftpFileOperations, selectedPermissionMetadata, type SftpOperationContext } from './file-operations';
import { createSftpCopyService, type SftpClipboard, type SftpCopyEntry, type SftpCopyPort } from './sftp-copy-service';
import type { SftpConfirmation, SftpDialogText } from './sftp-dialog-types';
import type { SftpTabRuntime } from './tab-runtime';
import type { createSftpViewWorkspace } from './view-workspace';

interface FileOperationsWorkspacePort {
  tabs(): WorkspaceTab[];
  runtimes: Map<string, SftpTabRuntime>;
  view: ReturnType<typeof createSftpViewWorkspace>;
  tr: SftpDialogText;
  notify: Parameters<typeof createSftpFileOperations>[0]['notify'];
  api<T>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
}

const archiveSuffix = /\.(?:tar\.gz|tgz|zip|tar)$/i;
export const isSftpArchive = (name: string) => archiveSuffix.test(name);
const fileName = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'archive';
export const sftpArchiveBaseName = (path: string) => fileName(path).replace(archiveSuffix, '') || 'archive';
export function sftpArchiveName(entries: { path: string }[]) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return entries.length === 1 ? `${fileName(entries[0].path)}.tar.gz` : `archive-${stamp}.tar.gz`;
}

export function sftpDeleteConfirmation(tr: SftpDialogText, enabled: boolean | null, count: number, remotePath: string): SftpConfirmation {
  const path = remotePath ? `\n${remotePath}` : '';
  if (enabled === true) return { title: tr('sftp:operations.recycle_title'), message: tr('sftp:operations.recycle_message', { count, path }),
    confirm: tr('sftp:operations.recycle_confirm'), danger: false };
  if (enabled === false) return { title: tr('sftp:operations.permanent_delete_title'), message: tr('sftp:operations.permanent_delete_message', { count, path }),
    confirm: tr('sftp:operations.permanent_delete_confirm'), danger: true };
  return { title: tr('sftp:operations.delete_title'), message: tr('sftp:operations.delete_message', { count, path }),
    confirm: tr('sftp:operations.continue'), danger: true };
}

export function createSftpFileOperationsWorkspace({ tabs, runtimes, view, tr, notify, api }: FileOperationsWorkspacePort) {
  const copy = createSftpCopyService();
  const clipboard = { value: null as SftpClipboard | null };
  const tab = (key: string) => tabs().find(item => item.key === key);
  const listed = (key: string, path: string, target: string) => filesServices.termaSftpViews?.listedEntry?.(key, target)
    || runtimes.get(key)?.state.entries.find(entry => joinRemotePath(path, entry.name) === target);
  const refreshViews = () => { for (const key of runtimes.keys()) view.refreshDirectoryActions(key); };
  const clearClipboard = () => { clipboard.value = null; };
  function validName(value: string, label: string) {
    const name = value.trim();
    if (!name || name === '.' || name === '..' || /[\\/\0\r\n]/.test(name)) {
      notify(tr('sftp:operations.invalid_child_name', { label }), 'error');
      return false;
    }
    return true;
  }
  function refresh(key: string, options: DirectoryLoadOptions = {}) {
    const runtime = runtimes.get(key), owner = tab(key);
    if (runtime?.searchTimer != null) clearTimeout(runtime.searchTimer);
    if (owner?.kind !== 'sftp') return;
    return filesServices.termaSftpDirectoryWorkspace.loader.load({ connectionId: owner.id, path: runtime?.state.path || owner.path || '.',
      page: runtime?.state.page || 1, refresh: true, preserveView: true, ...options, tabKey: key });
  }
  function copyPort(key: string, id: number, directory: string, valid = () => true): SftpCopyPort {
    const current = filesServices.termaSftpTransfers.target(key, id, directory);
    const isCurrent = () => current() && valid();
    return { key, connectionId: id, directory, isCurrent, api, conflict: (entries, labels) => copy.chooseConflict({ api, choose: chooseModal, tr, isCurrent }, id, directory, entries, labels),
      track: job => filesServices.termaSftpTransferLifecycle.completion.track(job), refresh: () => { void filesServices.termaSftpTaskWorkspace.runtime.refresh(); },
      changed: refreshViews, clear: snapshot => { if (clipboard.value === snapshot) clearClipboard(); }, notify, tr };
  }
  function setClipboard(mode: 'copy' | 'move', entries: SftpCopyEntry[], id: number, name = '') {
    const next = copy.createClipboard(mode, id, name, entries);
    if (!next) return false;
    clipboard.value = next;
    refreshViews();
    notify(tr('sftp:operations.clipboard_saved', { action: tr(mode === 'move' ? 'sftp:clipboard.move' : 'sftp:clipboard.copy') }), 'success');
    return true;
  }
  const cancel = () => copy.cancel({ get: () => clipboard.value, clear: clearClipboard, keys: () => runtimes.keys(), refresh: view.refreshDirectoryActions, tr, notify });
  function context(key: string, id = 0): SftpOperationContext | null {
    const runtime = runtimes.get(key), owner = tab(key);
    if (!runtime || !owner || (id && id !== Number(owner.id))) return null;
    const path = runtime.state.path || '.', connectionId = Number(owner.id);
    return { tabKey: key, connectionId, path, valid: filesServices.termaSftpTransfers.target(key, connectionId, path) };
  }
  async function recycleEnabled() {
    const settings = settingsServices.termaRuntimeSettingsModel;
    if (typeof settings.snapshot?.saved?.sftp_recycle_bin_enabled === 'boolean') return settings.snapshot.saved.sftp_recycle_bin_enabled;
    try {
      settings.snapshot = settings.normalize(await api('/api/runtime-settings'));
      return settings.snapshot.saved.sftp_recycle_bin_enabled;
    } catch { return null; }
  }
  const operations = createSftpFileOperations({
    context, tr, notify, api,
    async input(context, kind, value = '', apply) {
      const titles = { file: 'sftp:operations.new_file', directory: 'sftp:operations.new_directory', rename: 'sftp:menu.rename' };
      const labels = { file: 'sftp:operations.file_name', directory: 'sftp:operations.directory_name', rename: 'sftp:dialogs.new_name' };
      if (kind !== 'rename') return await filesServices.termaSftpEntryActions.nameDialog(context, titles[kind], labels[kind], value) ?? null;
      return await filesServices.termaSftpDialogs?.input({ tr, titleKey: titles[kind], labelKey: labels[kind], value, valid: context.valid, apply,
        validate: name => validName(name, tr(labels[kind])), errorText: error => {
          const code = (error as { publicCode?: string } | null)?.publicCode, message = error instanceof Error ? error.message : '';
          return code ? tr(`errors:backend.${code}`, { defaultValue: message }) : message || tr('errors:backend.request_failed');
        } }) ?? null;
    },
    async confirm(context, kind, count, path = '') {
      return kind === 'delete' && await filesServices.termaSftpEntryActions.confirmDelete(await recycleEnabled(), count, path, context);
    },
    selected: ({ tabKey }) => view.selectedEntries(tabKey),
    entry({ tabKey, path }, target) {
      const entry = listed(tabKey, path, target);
      return entry ? { ...entry, path: target, size: Number(entry.size || 0), metadataKnown: entry.metadata_known !== false, pathBytesB64: entry.path_bytes_b64 || '' } : null;
    },
    track(job) { filesServices.termaSftpTransferLifecycle.completion.track(job); void filesServices.termaSftpTaskWorkspace.runtime.refresh(); },
    refresh: ({ tabKey }) => { void refresh(tabKey); },
    async archive({ tabKey, connectionId }, options) {
      const answer = await filesServices.termaSftpEntryActions.archive({ ...options, tabKey, connectionId });
      return answer ? { ...answer, target: answer.target ?? options.target } : null;
    },
    permissions: ({ tabKey }, entries) => filesServices.termaSftpEntryActions.permissions(tabKey, entries, selectedPermissionMetadata(entries)),
    archiveName: sftpArchiveName, fileName, validName,
    setClipboard: ({ tabKey, connectionId }, mode, entries) => {
      const owner = tab(tabKey);
      return setClipboard(mode, entries, connectionId, owner?.title);
    },
    clipboard: () => clipboard.value, paste: ({ tabKey, connectionId, path }) => copy.paste(copyPort(tabKey, connectionId, path), clipboard.value),
    cancelClipboard: cancel, pathBytes: ({ tabKey, path }, target) => listed(tabKey, path, target)?.path_bytes_b64 || ''
  });
  function copySelection(key: string, mode: 'copy' | 'move') {
    const runtime = runtimes.get(key), owner = tab(key), entries = view.selectedEntries(key);
    if (!entries.length) return notify(tr('sftp:operations.select_items'), 'info');
    return setClipboard(mode, entries, Number(runtime?.state.connectionId || owner?.id || 0), owner?.title);
  }
  function copyEntry(key: string, path: string, mode: 'copy' | 'move') {
    const state = runtimes.get(key)?.state, owner = tab(key);
    const entry = state ? listed(key, state.path, path) : undefined;
    return setClipboard(mode, [{ path, name: entry?.name || fileName(path), type: entry?.type || 'file',
      size: Math.max(0, Number(entry?.size || 0)), mtime: Math.max(0, Number(entry?.mtime || 0)), metadataKnown: Boolean(entry) }],
      Number(state?.connectionId || owner?.id || 0), owner?.title);
  }
  function removeSelection(key: string) {
    const owner = tab(key);
    if (owner) return operations.remove(key, Number(owner.id));
  }
  function extractSelection(key: string) {
    const owner = tab(key), paths = view.selectedPaths(key);
    if (!owner || paths.length !== 1) return notify(tr('sftp:operations.select_archive'), 'info');
    return operations.extract(key, Number(owner.id), paths[0]);
  }
  function compressEntry(key: string, id: number, path: string) {
    if (Number(runtimes.get(key)?.connectionId) === id) return operations.compress(key, [path]);
  }
  return { operations, copy, clipboard, copyPort, isArchive: isSftpArchive, refresh, validName, setClipboard, cancel, copySelection, copyEntry, removeSelection, extractSelection, compressEntry };
}



export interface InstalledFeaturesFilesSftpFileOperationsWorkspaceServices {
  termaSftpFileActions: ReturnType<typeof createSftpFileOperationsWorkspace>
}
