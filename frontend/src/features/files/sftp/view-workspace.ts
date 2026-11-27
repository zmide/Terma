import {filesServices} from '@/features/files/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {isMobileLayout} from '@/shared/browser-ui';
import {showActionMenu} from '@/shared/action-menu';
import {notify} from '@/features/efficiency/notification-actions';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {openTerminal} from '@/features/terminal/terminal-page';
import { workspaceElementForTab } from '@/features/workspace/workspace-pane-scope';
import { isSftpArchive } from './file-operations-workspace';
import type { DirectoryLoadOptions } from './directory-loader';
import { directoryKey, joinRemotePath, parentRemotePath, type SftpScrollState, type SftpSelection } from './directory-state';
import { formatSftpTime } from '../file-layout';
import { sftpFileKind } from './file-kind';
import type { SftpMenuEvent } from './SftpMenuViews';
import type { SftpPageConnection } from './page-lifecycle';
import type { SftpOptions, SftpEntry, SftpPart } from './SftpView';
import type { createSftpTabRuntime, SftpTabRuntime } from './tab-runtime';
import type { createSftpViewState } from './view-state';

import type { SftpClipboard } from './sftp-copy-service';
import {embeddedSftpViews} from './embedded-views';
interface ViewPort {
  tabs: ReturnType<typeof createSftpTabRuntime>;
  runtimes: Map<string, SftpTabRuntime>;
  viewState: ReturnType<typeof createSftpViewState>;
  text: SftpOptions['text'];
  bytes: SftpOptions['bytes'];
  clipboard(): SftpClipboard | null;
}
interface Action { label: string; icon: string; run(): unknown }
type ViewEntry = Pick<SftpEntry, 'name' | 'type'> & { path: string };
type Callbacks = Record<string, (...args: never[]) => unknown>;

export function sftpConnectionAddress(connection: SftpPageConnection) {
  return `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`;
}

export function createSftpViewWorkspace({ tabs, runtimes, viewState, text, bytes, clipboard: readClipboard }: ViewPort) {
  const installed = filesServices.termaSftpViews;
  if (!installed) throw new Error('SFTP views must be installed before wiring the workspace');
  const views: NonNullable<(typeof filesServices)['termaSftpViews']> = installed;
  const currentKey = (key = applicationState.activeTabKey) => String(key || '');
  const root = (key: string, fallback: HTMLElement | null = null) => tabs.root(currentKey(key), fallback);
  function element(id: string, key = applicationState.activeTabKey, fallback: HTMLElement | null = null) {
    key = currentKey(key);
    const selector = `#${CSS.escape(id)}`;
    const toolbar = document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
    return root(key, fallback)?.querySelector<HTMLElement>(selector) || toolbar?.querySelector<HTMLElement>(selector) || workspaceElementForTab(key, selector);
  }
  const selectedPaths = (key = applicationState.activeTabKey) => views.selectedPaths(currentKey(key));
  const selectedEntries = (key = applicationState.activeTabKey) => views.selectedEntries(currentKey(key));
  const clearSelection = (key = applicationState.activeTabKey) => views.clearSelection(currentKey(key));
  function showEncodingMenu(event: SftpMenuEvent, id: number) {
    const connection = currentConnection(id), preferences = filesServices.termaSftpPreferences;
    if (!connection) return;
    showActionMenu(event, preferences.options.map(([value, label]) => ({ label,
      icon: value === (connection.sftp_filename_encoding || 'utf8') ? 'check' : 'earth', run: () => preferences.encoding(id, value) })));
  }
  function navigate(path: string, key = applicationState.activeTabKey, options: DirectoryLoadOptions = {}) {
    tabs.restore(currentKey(key));
    return filesServices.termaSftpDirectoryWorkspace.navigation.navigatePath(currentKey(key), path, options);
  }
  function refreshDirectoryActions(key = applicationState.activeTabKey) {
    refresh(key, 'toolbar');
    refresh(key, 'favorites');
  }
  const cancelClipboard = () => filesServices.termaSftpFileActions.cancel();
  function options(key: string): SftpOptions | null {
    const runtime = runtimes.get(key);
    if (!runtime) return null;
    const state = runtime.state, id = Number(runtime.connectionId || state.connectionId);
    const connection = currentConnection(id);
    const clipboard = readClipboard();
    const matches = Number(clipboard?.connectionId) === id;
    const { navigation: directory, cache } = filesServices.termaSftpDirectoryWorkspace;
    const navigation = directory.historyState(key);
    const preferences = filesServices.termaSftpPreferences, preview = filesServices.termaSftpPreviewRuntime;
    const relations = remoteServices.termaRemoteDesktop.relations;
    const { menu } = filesServices.termaSftpEntryActions;
    const { drag, events } = filesServices.termaSftpDragWorkspace;
    const quick = connection?.quick_connection === true, desktop = Boolean(window.termaDesktop);
    const isCurrent = () => runtimes.get(key) === runtime;
    const isImage = preview.editor.isSftpImageName;
    const open = (entry: Pick<ViewEntry, 'name'>, path: string) => isImage(entry.name) ? preview.image(id, path) : preview.text(id, path);
    const { controller: transfer } = filesServices.termaSftpTransfers;
    const files = filesServices.termaSftpFileActions, operations = files.operations;
    const handlers = {
      selectionState(selected: SftpSelection | null, anchor: string) { runtime.state.selected = selected; runtime.state.selectionAnchorPath = anchor; },
      terminal: () => openTerminal(id), favorite: () => preferences.toggle(key), mkdir: () => operations.mkdir(key), create: () => operations.createFile(key),
      upload: (event: Event) => transfer.uploadInput(key, event?.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined), recycle: () => filesServices.termaSftpRecycle.open(key),
      chooseUpload: (input: HTMLInputElement) => transfer.pick(key, input),
      cancelUpload: (event: Event) => transfer.cancelPicker(key, event?.currentTarget instanceof HTMLInputElement ? event.currentTarget : null),
      paste: () => operations.paste(key), cancelClipboard,
      encoding: (event: SftpMenuEvent) => showEncodingMenu(event, id),
      remote: (event: Parameters<typeof relations.jumpFromSsh>[0]) => relations.jumpFromSsh(event, id),
      connection: () => filesServices.termaSftpConnection.toggle(id, key), reconnect: () => filesServices.termaSftpConnection.reconnect(id, { tabKey: key }),
      refresh: () => files.refresh(key), settings: () => filesServices.termaSftpGlobalSettings?.open(),
      history: (direction: number) => directory.navigateHistory(key, direction), parent: () => navigate(parentRemotePath(runtime.state.path), key),
      navigate: (path: string) => navigate(path, key), mobileToolbar: () => { if (isMobileLayout()) preferences.toggleMobile(key); },
      copy: () => files.copySelection(key, 'copy'), move: () => files.copySelection(key, 'move'),
      downloadSelection: () => transfer.selection(key), desktopSelection: () => transfer.desktop(key),
      compress: () => operations.compress(key), permissions: () => operations.permissions(key),
      extract: () => files.extractSelection(key), deleteSelection: () => files.removeSelection(key), clearSelection: () => clearSelection(key),
      searchValue: (value: string) => directory.search(key, value), recursive: (enabled: boolean) => directory.recursive(key, enabled),
      directorySize: (path: string) => cache.readSize(id, path), dragEnd: drag.browser.finish,
      navigateEntry: (_event: Event, _entry: ViewEntry, path: string) => navigate(path, key),
      openEntry: (_event: Event, entry: ViewEntry, path: string) => open(entry, path),
      activateFile(entry: ViewEntry) {
        const settings = settingsServices.termaRuntimeSettingsModel.snapshot;
        const doubleClick = (settings?.saved || settings)?.sftp_double_click_file_action;
        return doubleClick === 'external' && desktop ? filesServices.termaSftpWorkflow.openEditor(id, entry.path) : open(entry, entry.path);
      },
      textEntry: (_event: Event, _entry: ViewEntry, path: string) => preview.text(id, path),
      downloadEntry: (_event: Event, entry: ViewEntry, path: string) => transfer.download(id, path, entry.type === 'dir' ? 'dir' : 'file'),
      renameEntry: (_event: Event, entry: ViewEntry, path: string) => operations.rename(key, id, path, entry.name),
      deleteEntry: (_event: Event, _entry: ViewEntry, path: string) => operations.remove(key, id, [path]),
      inlineRename: (entry: ViewEntry | null, next: string) => operations.inlineRename(key, id, String(entry?.path || ''), next),
      notify: (message: string) => notify(message, 'error'),
      copyEntry: (_event: Event, _entry: ViewEntry, path: string) => files.copyEntry(key, path, 'copy'),
      moveEntry: (_event: Event, _entry: ViewEntry, path: string) => files.copyEntry(key, path, 'move'),
      compressEntry: (_event: Event, _entry: ViewEntry, path: string) => files.compressEntry(key, id, path),
      extractEntry: (_event: Event, _entry: ViewEntry, path: string) => operations.extract(key, id, path),
      permissionsEntry: (_event: Event, _entry: ViewEntry, path: string) => operations.permissions(key, [path]),
      page: (value: number) => directory.page(key, value), pageSize: (size: number) => directory.pageSize(key, Number(size)), jumpPage: (value: unknown) => directory.jump(key, value),
      scrollPage: (page: number) => filesServices.termaSftpDirectoryWorkspace.loader.load({tabKey: key, page, continuous: true, preserveView: true, keepContents: true}),
      entryMenu: (event: SftpMenuEvent, entry: ViewEntry, path: string) => menu.entry(event, key, id, { path, name: entry.name, type: entry.type }),
      primeDrag: (event: Parameters<typeof drag.prime>[0], entry: ViewEntry, path: string) => drag.prime(event, id, path, entry.name, entry.type, key),
      drag: (event: Parameters<typeof drag.begin>[0], entry: ViewEntry, path: string) => drag.begin(event, id, path, entry.name, entry.type, key),
      directoryMenu: (event: SftpMenuEvent) => menu.directory(event, key), dragenter: (event: Parameters<typeof events.enter>[0]) => events.enter(event, key),
      dragover: (event: Parameters<typeof events.over>[0]) => events.over(event, key),
      dragleave: (event: Parameters<typeof events.leave>[0]) => events.leave(event, key),
      drop: (event: Parameters<typeof events.drop>[0]) => events.drop(event, key)
    } satisfies Callbacks;
    const pending = Boolean(clipboard && files.copy.isPending(key));
    return {
      model: { key, connectionId: id, quick, desktop, mobile: isMobileLayout(), encoding: preferences.label(connection || undefined),
        status: runtime.vueStatus || 'connecting', error: runtime.vueError || '', state: { ...state, entries: [...state.entries] }, selectedPaths: selectedPaths(key),
        columns: filesServices.termaSftpColumns.readSftpColumnLayout().order, favorite: preferences.has(id, state.path || '.'), favorites: preferences.snapshot(id),
        clipboard: clipboard ? { count: clipboard.paths.length, moving: clipboard.mode === 'move', source: clipboard.connectionName || '', matches, pending,
          canPaste: (matches || clipboard.mode === 'copy') && !pending } : null,
        mobileToolbarExpanded: preferences.mobileExpanded(), hasRemoteJump: !quick && relations.desktopsForSsh(id).length > 0, hasLocalFiles: !quick,
        historyBack: navigation.index > 0, historyForward: navigation.index >= 0 && navigation.index < navigation.paths.length - 1 },
      text, bytes, time: formatSftpTime, path: name => joinRemotePath(runtime.state.path, name), isArchive: isSftpArchive, isImage, isCurrent,
      directorySize: path => ({ ...cache.presentation(cache.getSize(id, path)), key: encodeURIComponent(directoryKey(id, path)) }),
      opening: path => viewState.isOpening(id, path),
      run(action, ...args) {
        if (!isCurrent() || !Object.hasOwn(handlers, action)) return;
        embeddedSftpViews.get(key)?.beforeAction(action);
        return (handlers as Callbacks)[action]?.(...args as never[]);
      }
    };
  }
  function mount(view: HTMLElement, key: string) {
    const current = options(key);
    return Boolean(current && views.mount(view, current));
  }
  function refresh(key: string, part?: SftpPart, list?: SftpTabRuntime['vueListState']) {
    if (!views.isMounted(key)) return false;
    const current = options(key);
    return current ? views.refresh(key, current, part || undefined, list || undefined) : false;
  }
  function render(key = applicationState.activeTabKey) {
    const runtime = tabs.restore(key), target = root(key);
    if (!runtime || !target || (!views.isMounted(key) && !mount(target, key))) return false;
    if (!refresh(key, 'list', runtime.vueListState)) return false;
    runtime.renderedRequestSeq = Number(runtime.state.requestSeq || 0);
    const list = element('sftpList', key), columns = filesServices.termaSftpColumns;
    if (list) {
      list.dataset.sftpTabKey = key;
      columns.bindSftpColumnControls(list);
      columns.watchSftpListLayout(list, key);
      views.updateSelection(key);
    }
    return true;
  }
  function language() {
    for (const runtime of runtimes.values()) {
      if (!views.isMounted(runtime.tabKey)) continue;
      for (const part of (['toolbar', 'navigation', 'favorites', 'banner', 'selection', 'search'] as const)) refresh(runtime.tabKey, part);
      refresh(runtime.tabKey, 'list', runtime.vueListState);
    }
    views.refreshUnavailable();
  }
  return { root, element, mount, refresh, render, language, selectedPaths, selectedEntries, clearSelection,
    options, navigate, cancelClipboard, refreshDirectoryActions, showEncodingMenu,
    matchesClipboard(key = applicationState.activeTabKey) {
      const clipboard = readClipboard();
      return Boolean(clipboard?.paths.length) && Number(clipboard?.connectionId) === Number(runtimes.get(currentKey(key))?.state.connectionId);
    },
    searchBusy: (key = applicationState.activeTabKey, searching = false) => views.searchBusy(currentKey(key), Boolean(searching)),
    refreshSizes(id: number) { for (const runtime of runtimes.values()) if (Number(runtime.connectionId) === Number(id)) refresh(runtime.tabKey, 'list'); },
    unavailable: (view: HTMLElement, key: string) => views.unavailable(view, currentKey(key), () => ({
      title: text('sftp:unavailable.title'), message: text('sftp:unavailable.message'), hint: text('sftp:unavailable.hint') })),
    capture: (key = applicationState.activeTabKey) => views.capture(currentKey(key)),
    restore: (state: SftpScrollState | null, key = applicationState.activeTabKey) => views.restore(currentKey(key), state) };
}



export interface InstalledFeaturesFilesSftpViewWorkspaceServices {
  termaSftpView: ReturnType<typeof createSftpViewWorkspace>
}
