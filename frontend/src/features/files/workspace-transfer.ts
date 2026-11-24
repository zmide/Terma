import type { FileTransferPayload } from './file-transfer-service';
import type { SftpMenuAction } from './sftp/SftpMenuViews';
export interface TransferTab { key: string; kind: string; id?: number; title?: string; name?: string; subtitle?: string }
export interface TransferEntry { path: string; name: string; type: string }
export type LocalTransferPayload = FileTransferPayload & {sourceTabKey: string};
export interface TransferDirectory { location?: string; path?: string; displayPath?: string; page?: number }
export interface WorkspaceTransferPort {
  mobile(): boolean;
  sourcePane(key: string): { id: string } | undefined;
  leaves(): Array<{ id: string; activeTabKey: string }>;
  tab(key: string): TransferTab | undefined;
  title(tab: TransferTab): string;
  directory(key: string): TransferDirectory | undefined;
  webSource(key: string): boolean;
  connected(key: string): boolean;
  pathKey(path?: string): string;
  tr(key: string, values?: Record<string, unknown>): string;
  plan(paths: string[], target: string): Promise<{ items: Array<{ exists?: boolean; name: string }> }>;
  copy(paths: string[], target: string, conflict: string): Promise<{ count?: number }>;
  choose(title: string, preview: string, actions: Array<{ label: string; value: string; className?: string }>): Promise<string>;
  reload(key: string, directory: TransferDirectory): Promise<unknown>;
  notify(text: string): void;
  selected(key: string): TransferEntry[];
  localTo(payload: LocalTransferPayload, target: TransferTab, kind: 'terminal' | 'sftp'): unknown;
  remoteTo(payload: { sourceTabKey: string; connectionId: number; entries: TransferEntry[] }, target: TransferTab): unknown;
}

export function createWorkspaceTransfer(port: WorkspaceTransferPort) {
  const tr = port.tr;
  function peers(key: string, kinds = ['terminal', 'sftp', 'local-files']) {
    if (port.mobile()) return [];
    const source = port.sourcePane(key), leaves = port.leaves();
    if (!source || leaves.length < 2) return [];
    return leaves.filter(pane => pane.id !== source.id).flatMap(pane => {
      const tab = port.tab(pane.activeTabKey);
      return tab && kinds.includes(tab.kind) ? [{ pane, tab }] : [];
    });
  }
  const unwrap = (value: TransferTab | { tab: TransferTab }) => 'tab' in value ? value.tab : value;
  function label(value: TransferTab | { tab: TransferTab }) {
    const tab = unwrap(value), name = port.title(tab) || tab.name || tab.id || '';
    if (tab.kind === 'terminal') return tr('navigation:transfer.terminal_target', { name });
    if (tab.kind === 'sftp') return tr('navigation:transfer.sftp_target', { name });
    const directory = port.directory(tab.key);
    return tr('navigation:transfer.local_files_target', { path: directory?.displayPath || directory?.path || tab.subtitle || tab.title || tr('common:auto.directory') });
  }
  function localReady(source: string, value: TransferTab | { tab: TransferTab }) {
    const tab = unwrap(value);
    if (port.webSource(source)) return tab.kind === 'sftp' && Number(tab.id) > 0;
    if (tab.kind === 'sftp') return Number(tab.id) > 0;
    if (tab.kind === 'terminal') return port.connected(tab.key);
    const target = port.directory(tab.key);
    return tab.kind === 'local-files' && target?.location === 'directory' && Boolean(target.path)
      && port.pathKey(target.path) !== port.pathKey(port.directory(source)?.path);
  }
  async function copyLocal(payload: LocalTransferPayload, target: TransferTab) {
    if (port.webSource(payload.sourceTabKey) || port.webSource(target.key)) throw new Error(tr('sftp:web_files.cross_local_unavailable'));
    if (!payload.paths.length || target.kind !== 'local-files') return;
    const directory = port.directory(target.key);
    if (directory?.location !== 'directory' || !directory.path) throw new Error(tr('navigation:transfer.open_target_directory'));
    // Freeze target before any conflict prompt; a pane may navigate during the prompt.
    const targetPath = directory.path, snapshot = { ...directory }, paths = [...payload.paths];
    const plan = await port.plan(paths, targetPath), conflicts = plan.items.filter(item => item.exists);
    let conflict = 'error';
    if (conflicts.length) {
      const preview = conflicts.slice(0, 6).map(item => item.name).join(tr('navigation:transfer.item_separator'))
        + (conflicts.length > 6 ? tr('navigation:transfer.more_items', { count: conflicts.length }) : '');
      conflict = await port.choose(tr('navigation:transfer.local_conflict_title'), preview, [
        { label: tr('common:auto.overwrite'), value: 'overwrite', className: 'danger' },
        { label: tr('common:auto.auto_rename'), value: 'rename', className: 'primary' },
        { label: tr('common:actions.cancel'), value: 'cancel' }
      ]);
    }
    if (!['error', 'overwrite', 'rename'].includes(conflict)) return;
    const result = await port.copy(paths, targetPath, conflict);
    if (port.directory(target.key)?.path === targetPath) await port.reload(target.key, snapshot);
    port.notify(tr('navigation:transfer.sent_items', { count: result.count || paths.length, target: snapshot.displayPath || targetPath }));
  }
  function sendLocal(payload: LocalTransferPayload, target: TransferTab) {
    if (target.kind === 'terminal' || target.kind === 'sftp') return port.localTo(payload, target, target.kind);
    if (target.kind === 'local-files') return copyLocal(payload, target);
  }
  function action(tab: TransferTab, run: () => unknown): SftpMenuAction {
    return { label: tr('navigation:transfer.send_to_target', { target: label(tab) }), icon: tab.kind === 'terminal' ? 'terminal' : tab.kind === 'sftp' ? 'server' : 'folder-copy', run };
  }
  function localActions(key: string, payload: LocalTransferPayload) {
    return payload.paths.length ? peers(key).map(peer => peer.tab).filter(tab => localReady(key, tab)).map(tab => action(tab, () => sendLocal(payload, tab))) : [];
  }
  function entries(key: string, path: string, name?: string, type?: string) {
    const selected = port.selected(key);
    return selected.some(item => item.path === path) ? selected.map(item => ({ ...item })) : [{ path, name: name || path.split('/').pop() || tr('navigation:transfer.item'), type: type || 'file' }];
  }
  function sendRemote(key: string, id: number, selected: TransferEntry[], tab: TransferTab) {
    if (selected.length) return port.remoteTo({ sourceTabKey: key, connectionId: id, entries: selected.map(item => ({ ...item })) }, tab);
  }
  function remoteActions(key: string, id: number, path: string, name?: string, type?: string) {
    const selected = entries(key, path, name, type);
    return peers(key).map(peer => peer.tab).filter(tab => {
      if (tab.kind === 'terminal') return port.connected(tab.key);
      if (tab.kind === 'local-files') { const directory = port.directory(tab.key); return directory?.location === 'directory' && Boolean(directory.path); }
      return Number(tab.id) > 0;
    }).map(tab => action(tab, () => sendRemote(key, id, selected, tab)));
  }
  return { peers, label, localReady, copyLocal, sendLocal, localActions, entries, sendRemote, remoteActions };
}


export interface InstalledFeaturesFilesWorkspaceTransferServices {
  termaWorkspaceTransfer: {current: () => ReturnType<typeof createWorkspaceTransfer>};
}
