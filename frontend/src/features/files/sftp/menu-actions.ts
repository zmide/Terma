import type { SftpMenuAction, SftpMenuEvent } from './SftpMenuViews';

export interface SftpMenuContext { key: string; connectionId: number; path: string; valid(): boolean }
export interface SftpMenuEntry { path: string; name: string; type: string }
type EntryAction = 'image' | 'text' | 'external' | 'sync' | 'download' | 'pdf' | 'desktop' | 'extract' | 'compress' | 'copyPath' | 'copy' | 'move' | 'rename' | 'permissions' | 'delete';
type DirectoryAction = 'file' | 'directory' | 'upload' | 'sync' | 'paste' | 'refresh';
export interface SftpMenuPort {
  context(key: string, id?: number): SftpMenuContext | null;
  text(key: string): string;
  desktop(): boolean;
  isImage(name: string): boolean;
  isArchive(name: string): boolean;
  clipboard(): 'copy' | 'move' | null;
  select(context: SftpMenuContext, entry: SftpMenuEntry): void;
  peers(context: SftpMenuContext, entry: SftpMenuEntry): SftpMenuAction[];
  navigate(context: SftpMenuContext, path: string): unknown;
  entry(action: EntryAction, context: SftpMenuContext, entry: SftpMenuEntry): unknown;
  directory(action: DirectoryAction, context: SftpMenuContext): unknown;
  show(event: SftpMenuEvent, actions: () => SftpMenuAction[]): void;
  close(): void;
}

// Menus retain their originating tab; changing focus never retargets an action.
export function createSftpMenuActions(port: SftpMenuPort) {
  const guard = (context: SftpMenuContext, run: () => unknown) => () => context.valid() ? run() : undefined;
  const separator = (): SftpMenuAction => ({ label: '', separator: true });
  const label = (key: string) => port.text(`sftp:menu.${key}`);
  function entry(event: SftpMenuEvent, key: string, id: number, file: SftpMenuEntry) {
    const context = port.context(key, id);
    if (!context?.valid()) return;
    port.select(context, file);
    const isDirectory = file.type === 'dir', svg = !isDirectory && /\.svgz?$/i.test(file.name);
    const action = (name: EntryAction, text: string, icon: string, danger = false): SftpMenuAction => ({
      label: label(text), icon, danger, run: guard(context, () => port.entry(name, context, file))
    });
    const directory = (name: DirectoryAction, text: string, icon: string): SftpMenuAction => ({
      label: label(text), icon, run: guard(context, () => port.directory(name, context))
    });
    const guardPeers = (actions: SftpMenuAction[]): SftpMenuAction[] => actions.map(item => ({
      ...item, run: item.run ? guard(context, item.run) : undefined,
      children: item.children ? guardPeers(item.children) : undefined
    }));
    port.show(event, () => {
      if (!context.valid()) return [];
      const peers = guardPeers(port.peers(context, file));
      return [
        isDirectory ? {label: label('open'), icon: 'folder-open', run: guard(context, () => port.navigate(context, file.path))}
          : port.isImage(file.name) ? action('image', 'preview_image', 'image') : action('text', 'open_as_text', 'file-text'),
        ...(svg ? [action('text', 'open_as_text', 'file-text')] : []),
        ...(!isDirectory && port.desktop() ? [action('external', 'external_editor', 'external-link')] : []),
        ...(isDirectory && port.desktop() ? [action('sync', 'compare_local', 'refresh-cw')] : []),
        action('download', 'download', 'download'),
        ...(svg ? [action('pdf', 'convert_svg_pdf', 'file-code-2')] : []),
        ...(port.desktop() ? [action('desktop', 'send_desktop', 'monitor-down')] : []),
        ...(peers.length ? [{label: label('send_peer'), icon: 'send', children: peers}] : []),
        ...(!isDirectory && port.isArchive(file.name) ? [action('extract', 'extract', 'archive-restore')] : []),
        action('compress', 'compress', 'archive'), separator(),
        action('copyPath', 'copy_path', 'clipboard'), action('copy', 'copy', 'copy'),
        action('move', 'move', 'folder-input'), action('rename', 'rename', 'pencil'),
        action('permissions', 'permissions', 'key-round'), separator(),
        directory('file', 'new_file', 'file-plus-2'), directory('directory', 'new_folder', 'folder-plus'),
        separator(), action('delete', 'delete', 'trash-2', true)
      ];
    });
  }
  function directory(event: SftpMenuEvent, key: string) {
    if (event.target instanceof Element && event.target.closest('.sftp-row, .sftp-head, .pager, button, input, select')) return;
    const context = port.context(key);
    if (!context?.valid()) return;
    const action = (name: DirectoryAction, text: string, icon: string): SftpMenuAction => ({
      label: label(text), icon, run: guard(context, () => port.directory(name, context))
    });
    port.show(event, () => {
      if (!context.valid()) return [];
      const clipboard = port.clipboard();
      return [action('file', 'new_file', 'file-plus-2'), action('directory', 'new_folder', 'folder-plus'),
        action('upload', 'upload_items', 'upload'),
        ...(port.desktop() ? [action('sync', 'compare_local', 'refresh-cw')] : []),
        ...(clipboard ? [action('paste', clipboard === 'move' ? 'move_here' : 'paste_here', 'clipboard-paste')] : []),
        separator(), action('refresh', 'refresh', 'refresh-cw')];
    });
  }
  return {entry, directory, close: port.close};
}
