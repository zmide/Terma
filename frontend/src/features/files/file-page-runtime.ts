import {filesServices} from '@/features/files/installed-services';
import { createFilePageLifecycle, type FilePageLifecyclePort } from './file-page-lifecycle';
import { LocalFileService, type LocalListing } from './local-file-service';
import { captureFileScroll, restoreFileScroll } from './file-scroll';
import { installFileKeyboard } from './file-keyboard';

type Views = (typeof filesServices)['termaLocalFileViews'];
type ViewOptions = Parameters<Views['update']>[1];
type WorkspacePort = Omit<FilePageLifecyclePort, 'next' | 'state' | 'mount' | 'update' | 'load' | 'peek' | 'mounted' | 'release' | 'text'> & {
  root(key: string): HTMLElement | null;
};

interface FilePageRuntimePort {
  workspace: WorkspacePort;
  views: Views;
  list(source: 'native' | 'server', query: URLSearchParams, signal: AbortSignal): Promise<LocalListing>;
  text: ViewOptions['text'];
  bytes: ViewOptions['bytes'];
  time: ViewOptions['time'];
  fnos(): boolean;
  releaseActions(key: string): void;
}

export function createFilePageRuntime(port: FilePageRuntimePort) {
  const { workspace, views } = port;
  let serial = 0;
  const listElement = (key: string) => workspace.root(key)?.querySelector<HTMLElement>('.local-files-list') ?? null;
  const files = new LocalFileService(new Map(), {
    list: port.list,
    changed: key => update(key),
    committed: (key, state) => pages.committed(key, state),
    text: port.text,
    restore: (key, position) => {
      const state = files.states.get(key);
      if (state) restoreFileScroll(state, listElement(key), position);
    }
  });

  function options(key: string, state: ViewOptions['state']): ViewOptions {
    return {
      key, state, service: files, mobile: workspace.mobile(), fnos: port.fnos(),
      text: port.text, bytes: port.bytes, time: port.time, displayName: item => files.displayName(item)
    };
  }

  function update(key: string) {
    const state = files.states.get(key);
    if (state) views.update(key, options(key, state));
  }

  const pages = createFilePageLifecycle({
    ...workspace,
    next: source => `${source === 'native' ? 'local-files' : 'web-files'}-${Date.now()}-${++serial}`,
    state: key => files.state(key),
    mount: (target, key) => views.mount(target, options(key, files.state(key))),
    update,
    load: (key, loadOptions) => files.load(key, loadOptions),
    peek: key => files.states.get(key),
    mounted: key => Boolean(workspace.root(key)),
    text: port.text,
    release(key) {
      port.releaseActions(key);
      views.release(key);
      files.dispose(key);
    }
  });

  return {
    files, pages, update, root: workspace.root,
    viewOptions: (key: string) => options(key, files.state(key)),
    scrollAnchor(key: string) {
      const state = files.states.get(key);
      return state && captureFileScroll(state, listElement(key), true);
    },
    installKeyboard(search: Parameters<typeof installFileKeyboard>[0]['search']) {
      return installFileKeyboard({
        active() {
          const tab = workspace.tab(workspace.active());
          return tab?.kind ? { key: tab.key, kind: tab.kind } : null;
        },
        blocked: () => Boolean(document.querySelector('#modal:not([hidden]),.sftp-editor-modal:not([hidden]),.sftp-preview-modal:not([hidden])')),
        search,
        selectAll: key => files.selectAll(key, true)
      });
    }
  };
}

export type FilePageRuntime = ReturnType<typeof createFilePageRuntime>;



export interface InstalledFeaturesFilesFilePageRuntimeServices {
  termaLocalFileRuntime: FilePageRuntime;
}
