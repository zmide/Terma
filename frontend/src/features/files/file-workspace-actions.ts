import {filesServices} from '@/features/files/installed-services';
import { createFileDeviceActions } from './file-device-actions';
import { createFileMenus } from './file-menus';
import { createFileMutationService } from './file-mutation-service';
import { createFileNativeActions } from './file-native-actions';
import { createFileTextService } from './file-text-service';
import type { FileActionPort } from './file-page-actions';
import type { FilePageRuntime } from './file-page-runtime';
import type { createFileWorkspaceTransfers } from './file-workspace-transfers';
import type { LocalFileState } from './local-file-service';
import type { ApiRequestOptions } from '@/shared/api/client';
import { errorMessage } from '@/features/operations/operations-types';

type Dialogs = NonNullable<(typeof filesServices)['termaSftpDialogs']>;
interface FileWorkspaceActionHost {
  request<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;
  text(key: string, options?: Record<string, unknown>): string;
  notify(message: string, level: 'info' | 'success' | 'error'): void;
  responseError(response: Response): Promise<Error>;
  desktop(): boolean;
  windows(): boolean;
  dialogs: Pick<Dialogs, 'confirm' | 'input' | 'text'>;
  menus: Pick<Parameters<typeof createFileMenus>[0], 'active' | 'connections' | 'peers' | 'show'>;
  editPath: FileActionPort['pathEditor'];
  prompt: Parameters<typeof createFileDeviceActions>[0]['input'];
  copy: FileActionPort['copy'];
}

export function createFileWorkspaceActions(page: FilePageRuntime, transfers: ReturnType<typeof createFileWorkspaceTransfers>, host: FileWorkspaceActionHost) {
  const { files } = page;
  const { text, notify, request, desktop, copy } = host;
  const state = (key: string) => files.states.get(key);
  const webState = (key: string) => {
    const current = state(key);
    return current?.fileSource ? current : null;
  };
  const webText = (key: string) => text(`sftp:web_files.${key}`);
  const errorText = (error: unknown, fallback: string) => {
    if (typeof error === 'object' && error && 'publicCode' in error && typeof error.publicCode === 'string' && error.publicCode) {
      const {details} = error as {details?: {error_params?: Record<string, unknown>}};
      return text(`errors:backend.${error.publicCode}`, {...details?.error_params, defaultValue:errorMessage(error, fallback)});
    }
    return errorMessage(error, fallback);
  };
  const reload = (key: string, current: LocalFileState) => files.reload(key, {path:current.path, location:current.location, page:current.page});
  const loadWeb = (key: string, path: string) => files.load(key, {path, location:'directory'});
  const openSystem = (path: string) => request('/api/local-files/open', {method:'POST', body:JSON.stringify({path})});
  function focusEntry(key: string, path: string) {
    const current = state(key);
    if (!current) return;
    current.activePath = path;
    page.update(key);
  }

  const mutations = createFileMutationService({
    context(key) {
      const current = state(key);
      if (!current) return null;
      const {fileSource, browserDirectory, path, location} = current;
      const source = fileSource ?? 'native';
      if (source === 'native' && !desktop()) return null;
      const writable = Boolean(path) && location !== 'computer' && (source !== 'browser' || Boolean(browserDirectory?.writable));
      return {
        path, source, writable, windows: source === 'native' && host.windows(), entries: current.entries.map(item => ({...item})),
        valid: () => state(key) === current && current.fileSource === fileSource && current.path === path && current.location === location
          && (source !== 'browser' || current.browserDirectory === browserDirectory && Boolean(browserDirectory?.writable) === writable),
        async write({action, ...body}) {
          if (source === 'browser' && browserDirectory) await browserDirectory.mutate(action, body);
          else if (source !== 'browser') {
            await request(`/api/${source === 'native' ? 'local-files' : 'server-files'}/${action}`, {method:'POST', body:JSON.stringify(body)});
          }
        },
        refresh: () => reload(key, current),
        clear: () => files.clear(key)
      };
    },
    text, notify, input: host.dialogs.input, confirm: host.dialogs.confirm,
    error: error => errorText(error, text('errors:backend.request_failed'))
  });

  const native = createFileNativeActions({
    states: files.states, desktop, selected: key => files.selected(key),
    load: (key, options) => files.load(key, options), hidePath: key => host.editPath(key, false),
    select: focusEntry, open: openSystem, locations: () => request('/api/local-files/locations'),
    mutate: mutations.run, copy, text, notify
  });
  const device = createFileDeviceActions({
    context(key) {
      const current = webState(key), scope = transfers.context(key);
      if (!current || !scope) return null;
      return {state:current, source:scope.source, path:scope.path, displayPath:current.displayPath, valid:scope.valid, load:path => loadWeb(key, path)};
    },
    selected: key => files.payload(key).entries,
    input: host.prompt,
    resolve: path => request('/api/server-files/resolve?' + new URLSearchParams({path})),
    pick: () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', () => resolve(Array.from(input.files || [])), {once:true});
      input.addEventListener('cancel', () => resolve([]), {once:true});
      input.click();
    }),
    async upload(path, file, signal) {
      const response = await fetch('/api/server-files/upload-content?' + new URLSearchParams({path, name:file.name}), {
        method:'POST', body:file, credentials:'same-origin', signal
      });
      if (!response.ok) throw await host.responseError(response);
    },
    deliver(name, source) {
      const anchor = document.createElement('a');
      anchor.download = name;
      const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : '';
      anchor.href = objectUrl || String(source);
      anchor.click();
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    },
    text, notify
  });
  const textEditor = createFileTextService({
    context(key, path) {
      const current = webState(key);
      if (!current) return null;
      const entry = current.entries.find(item => item.path === path && item.type === 'file');
      const {fileSource:source, browserDirectory:directory, path:parent} = current;
      if (!entry || (source !== 'server' && !directory)) return null;
      const writable = source === 'server' || Boolean(directory?.writable);
      return {
        name:entry.name, path, writable,
        valid: () => webState(key) === current && current.fileSource === source && current.path === parent
          && current.entries.some(item => item.path === path && item.type === 'file')
          && (source === 'server' || current.browserDirectory === directory && Boolean(directory?.writable) === writable),
        async read() {
          if (source === 'server') return (await request<{content:string}>('/api/server-files/text?' + new URLSearchParams({path}))).content;
          const file = await directory!.file(path);
          if (file.size > 1024 * 1024) throw new Error(webText('text_limit'));
          return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
        },
        async write(content) {
          if (source === 'browser') await directory!.write(path, content);
          else await request('/api/server-files/text', {method:'POST', body:JSON.stringify({path, content})});
        },
        refresh: () => loadWeb(key, parent)
      };
    },
    show: host.dialogs.text, text,
    error: error => errorText(error, webText('text_limit')),
    notify: message => notify(message, 'error')
  });
  const openWeb = (key: string, path: string) => files.openEntry(key, path, textEditor.open);
  const menus = createFileMenus({
    ...host.menus,
    context(key) {
      const current = state(key), scope = transfers.context(key);
      return current && scope ? {state: current, valid: scope.valid} : null;
    },
    selected: key => files.selected(key), select: (key, path) => files.select(key, path, {forceSingle:true}),
    desktop, text,
    run(action, key, paths) {
      const current = state(key);
      if (!current) return;
      if (action === 'open') return current.fileSource ? openWeb(key, paths[0] ?? '') : native.activate(key, paths[0] ?? '');
      if (action === 'system') {
        const entry = current.entries.find(item => item.path === paths[0]);
        return openSystem(entry && entry.type !== 'file' ? entry.path : current.path)
          .catch(error => notify(errorMessage(error, text('sftp:local_files.open_path_failed')), 'error'));
      }
      if (action === 'copy') return copy(paths.join('\n'));
      if (action === 'refresh') return files.reload(key);
      return mutations.run(key, action === 'permissions' ? 'chmod' : action, paths);
    },
    upload: transfers.upload, notify: message => notify(message, 'info')
  });
  return {
    native, device, mutations, menus, openText: textEditor.open,
    release: device.dispose,
    actionError(error: unknown, fallback: string) {
      if (error && (error as {name?: string}).name === 'AbortError') return;
      notify(errorMessage(error, text(fallback)), 'error');
    }
  };
}
