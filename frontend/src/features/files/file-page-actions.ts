import type { DelegatedActionContext, DelegatedActionHandler } from '@/shared/actions/event-registry';
import type { LocalFileService } from './local-file-service';
import type { FileScrollPosition } from './file-scroll';
import type { createFilePageLifecycle } from './file-page-lifecycle';
import type { createFileNativeActions } from './file-native-actions';
import type { createFileDeviceActions } from './file-device-actions';
import type { createFileMutationService } from './file-mutation-service';
import type { createFileMenus } from './file-menus';
import type { createLocalDrag, createLocalDrop } from './local-drag';

export interface FileActionPort {
  files(): LocalFileService;
  pages(): ReturnType<typeof createFilePageLifecycle>;
  native(): ReturnType<typeof createFileNativeActions>;
  device(): ReturnType<typeof createFileDeviceActions>;
  mutations(): ReturnType<typeof createFileMutationService>;
  menus(): ReturnType<typeof createFileMenus>;
  drag(): ReturnType<typeof createLocalDrag>;
  drop(): ReturnType<typeof createLocalDrop>;
  register(name: string, action: DelegatedActionHandler): void;
  pathEditor(key: string, editing: boolean): void;
  scrollAnchor(key: string): FileScrollPosition | undefined;
  openText(key: string, path: string): unknown;
  copy(value: string): unknown;
  error(error: unknown, fallbackKey: string): void;
}

type BoundAction = (key: string, context: DelegatedActionContext) => unknown;
const selection = (event: Event) => event instanceof MouseEvent ? event : {};
const value = ({element}: DelegatedActionContext) => element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : '';
const checked = ({element}: DelegatedActionContext) => element instanceof HTMLInputElement && element.checked;
const isWithin = (event: Event, selector: string) => event.target instanceof Element && Boolean(event.target.closest(selector));

function sharedActions(port: FileActionPort): Record<string, BoundAction> {
  const {files, drag, drop} = port;
  return {
    'drag-start': (key, {event,element,dataset}) => event instanceof DragEvent && element instanceof HTMLElement
      ? drag().begin(event,dataset.path || '',key,element) : undefined,
    'drag-over': (key, {event}) => event instanceof DragEvent && drop().over(event,key),
    drop: (key, {event}) => event instanceof DragEvent && drop().drop(event,key),
    refresh: key => files().reload(key),
    search: (key, ctx) => files().search(key,value(ctx)),
    'select-all': (key, ctx) => files().selectAll(key,checked(ctx)),
    sort: (key, {dataset}) => files().sort(key,dataset.sort || ''),
    page: (key, {dataset}) => files().page(key,Number(dataset.page || 1))
  };
}

function nativeActions(port: FileActionPort, shared: ReturnType<typeof sharedActions>): Record<string, BoundAction> {
  const {files,native,mutations,menus,drop} = port;
  const {'drag-start': startDrag, ...common} = shared;
  const select: BoundAction = (key,{event,dataset}) => {
    if (!isWithin(event,'.local-files-check')) return files().select(key,dataset.path || '',selection(event));
  };
  return {
    ...common,
    'drag-leave': (key, {event,element}) => event instanceof DragEvent && drop().leave(event,key,element),
    'entry-drag-start': startDrag!,
    history: (key, {dataset}) => files().historyMove(key,Number(dataset.historyDirection || 0)),
    parent: key => native().parent(key),
    location: (key, {dataset}) => native().location(key,dataset.location || ''),
    create: (key, {dataset}) => dataset.entryKind === 'dir' || dataset.entryKind === 'file' ? mutations().run(key,dataset.entryKind) : undefined,
    'search-clear': key => files().clearSearch(key),
    'path-edit': key => port.pathEditor(key,true),
    'path-cancel': key => port.pathEditor(key,false),
    'path-submit': async (key, {event,element}) => {
      event.preventDefault();
      const path = element.querySelector('input')?.value || '';
      port.pathEditor(key,false);
      try { await native().navigate(key,path); } catch (error) { port.error(error,'sftp:local_files.open_directory_failed'); }
    },
    'selection-open': key => native().selection(key,'open'),
    'selection-upload': (key, {event}) => menus().send(event,key),
    'selection-copy': key => native().selection(key,'copy'),
    'selection-rename': key => native().selection(key,'rename'),
    'selection-delete': key => native().selection(key,'delete'),
    'selection-chmod': key => native().selection(key,'chmod'),
    'selection-clear': key => files().clear(key),
    'directory-menu': (key, {event}) => menus().directory(event,key),
    'entry-select': select,
    'entry-select-stop': (key, ctx) => {ctx.event.stopPropagation(); return select(key,ctx);},
    'entry-activate': (key, {event,dataset}) => {event.preventDefault();event.stopPropagation();return native().activate(key,dataset.path || '');},
    'entry-menu': (key, {event,dataset}) => menus().entry(event,key,dataset.path || ''),
    'entry-checkbox': (key, ctx) => {ctx.event.stopPropagation();return files().select(key,ctx.dataset.path || '',selection(ctx.event),checked(ctx));},
    'page-limit': (key, ctx) => files().pageSize(key,Number(value(ctx)),port.scrollAnchor(key)),
    computer: key => native().navigate(key,'',true),
    path: (key, {dataset}) => native().navigate(key,dataset.path || '')
  };
}

function webActions(port: FileActionPort, shared: ReturnType<typeof sharedActions>): Record<string, BoundAction> {
  const {files,device,mutations,menus} = port;
  const open = (key: string, path: string) => files().openEntry(key,path,port.openText);
  return {
    ...shared,
    choose: key => device().choose(key),
    'choose-readonly': key => device().choose(key,true),
    parent: key => files().load(key,{path:files().state(key).parent,location:'directory'}),
    back: key => files().historyMove(key,-1),
    forward: key => files().historyMove(key,1),
    path: key => device().path(key),
    'copy-path': key => port.copy(files().state(key).displayPath),
    roots: key => files().load(key,{path:files().state(key).fileSource === 'browser' ? '/browser' : '',location:'directory'}),
    mkdir: key => mutations().run(key,'dir'),
    create: key => mutations().run(key,'file'),
    rename: key => mutations().run(key,'rename',[...files().state(key).selected]),
    delete: key => mutations().run(key,'delete',[...files().state(key).selected]),
    upload: key => device().upload(key),
    download: key => device().download(key),
    send: (key, {event}) => menus().send(event,key),
    select: (key, {event,dataset}) => {if (!isWithin(event,'button,input')) return files().select(key,dataset.path || '',{});},
    check: (key, ctx) => {ctx.event.stopPropagation();return files().select(key,ctx.dataset.path || '',{},checked(ctx));},
    'row-open': (key, {event,dataset}) => {event.stopPropagation();return open(key,dataset.path || '');},
    open: (key, {dataset}) => open(key,dataset.path || ''),
    menu: (key, {event,dataset}) => menus().entry(event,key,dataset.path || ''),
    'directory-menu': (key, {event}) => menus().directory(event,key),
    'page-limit': (key, ctx) => files().pageSize(key,Number(value(ctx)))
  };
}

export function registerFilePageActions(port: FileActionPort) {
  const shared = sharedActions(port);
  port.register('local-files-new-tab', ({event}) => port.pages().menu(event));
  port.register('local-files-entry-drag-end', () => port.drag().finish());
  port.register('web-files-new', ({event}) => port.pages().menu(event,false));
  const bind = (prefix: string, actions: Record<string, BoundAction>, web: boolean) => {
    for (const [name, action] of Object.entries(actions)) {
      port.register(prefix + name, context => {
        const key = context.dataset.tabKey;
        const state = key && port.files().states.get(key);
        if (!key || !state || Boolean(state.fileSource) !== web) return;
        if (!web) return action(key,context);
        try {
          return Promise.resolve(action(key,context)).catch(error => port.error(error,'sftp:web_files.transfer_failed'));
        } catch (error) { return port.error(error,'sftp:web_files.transfer_failed'); }
      });
    }
  };
  bind('local-files-',nativeActions(port,shared),false);
  bind('web-files-',webActions(port,shared),true);
}
