import { createFileDeliveryRefresh } from './file-delivery-refresh';
import { createFileTransferService, type FileTransferPort, type FileTransferPayload, type FileTransferTarget } from './file-transfer-service';
import { createLocalDrag, createLocalDrop } from './local-drag';
import type { BrowserDrag } from './sftp/browser-drag-runtime';
import type { FilePageRuntime } from './file-page-runtime';
import type { createSftpDragRuntime } from './sftp/drag-runtime';

interface TransferWorkspacePort {
  transfer: Omit<FileTransferPort, 'context' | 'track'>;
  tab(key: string): FileTransferTarget | undefined;
  drag(): ReturnType<typeof createSftpDragRuntime>;
  track: FileTransferPort['track'];
  directoryError(error: unknown): void;
  dropError(message: string): void;
}

export function createFileWorkspaceTransfers(page: FilePageRuntime, port: TransferWorkspacePort) {
  const { files } = page;
  const state = (key: string) => files.states.get(key);
  const delivery = createFileDeliveryRefresh({
    states: () => files.states.entries(),
    load: (key, {path, location, page}) => files.reload(key, {path, location, page}),
    failed: port.directoryError
  });
  const transfers = createFileTransferService({
    ...port.transfer,
    context(key) {
      const current = state(key);
      if (!current) return null;
      const {path, location, browserDirectory: browser, fileSource} = current;
      const source = fileSource || 'native';
      const handle = browser?.handle, filesSnapshot = browser?.files, name = browser?.name;
      return {
        source, path, location, browser,
        valid() {
          return state(key) === current && current.fileSource === fileSource && current.path === path && current.location === location
            && (!current.webLoading || current.webRequestedPath === path)
            && (source !== 'browser' || current.browserDirectory === browser && browser?.handle === handle
              && browser?.files === filesSnapshot && browser?.name === name);
        },
        refresh: () => files.reload(key, {path, location, page: current.page}),
        status(message) { current.status = message; page.update(key); }
      };
    },
    track(job, key, directory) {
      if (key) delivery.track(job, key, directory || '');
      port.track(job);
    }
  });
  const localDrag = createLocalDrag({
    pick(key, path) {
      const current = state(key);
      if (!current) return [];
      current.activePath = path;
      if (!files.selected(key).some(entry => entry.path === path)) files.select(key, path, {forceSingle:true});
      else page.update(key);
      return files.selected(key);
    },
    preview: (entries, x, y) => port.drag().feedbackView.showPreview(entries, x, y),
    move: (x, y) => port.drag().feedbackView.movePreview(x, y),
    clear() {
      document.body?.classList.remove('local-files-item-drag-active');
      document.querySelectorAll('.local-files-row.is-dragging').forEach(row => row.classList.remove('is-dragging'));
      port.drag().feedbackView.removePreview();
    }
  });
  function receive(drag: BrowserDrag | null, target: FileTransferTarget | undefined) {
    if (drag) port.drag().browser.finishPayload(drag);
    return transfers.receive(drag, target);
  }

  const drop = createLocalDrop({
    payload: data => port.drag().source.active(data),
    location: key => state(key)?.location,
    overlay: key => page.root(key)?.querySelector<HTMLElement>('.local-files-drop-overlay') ?? null,
    activity: () => port.drag().feedback.activity(),
    tab: port.tab, receive,
    text: port.transfer.text, notify: port.dropError
  });
  function upload(payload: FileTransferPayload, target: FileTransferTarget, key = '') {
    const tab = port.tab(key);
    return transfers.upload(payload, {...target, key: target.key || (tab?.kind === 'sftp' || tab?.kind === 'terminal' ? key : '')});
  }
  return {
    context: transfers.context, drag: localDrag, drop, delivery, receive, upload, desktop: transfers.desktop,
    release(key: string) { delivery.release(key); transfers.dispose(key); }
  };
}



export interface InstalledFeaturesFilesFileWorkspaceTransfersServices {
  termaFileTransferRuntime: ReturnType<typeof createFileWorkspaceTransfers>;
}
