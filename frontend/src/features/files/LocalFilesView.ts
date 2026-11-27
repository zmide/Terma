import {filesServices} from '@/features/files/installed-services';
import { h, render, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from '@/features/settings/settings-icon';
import type { LocalEntry, LocalFileService, LocalFileState } from './local-file-service';
import { bindFileColumns } from './file-columns';
import { bindFileScroll } from './file-scroll';
import '@/styles/local-files.css';
import '@/styles/file-list-window.css';

interface Options {
  key: string; service: LocalFileService; state: LocalFileState; mobile: boolean; fnos: boolean;
  text(key: string, values?: Record<string, unknown>): string;
  bytes(size: number): string; time(value: number): string; displayName(entry: LocalEntry): string;
}
interface View { host: HTMLElement; options: Options; cleanup: () => void; editing: boolean; pathDraft: string; lastPath: string; listIdentity?: string;
  frame: number; pendingPage: number; blockedPage: number }
const views = new Map<string, View>();
function paint(view: View) {
  const o = view.options, s = o.state, key = o.key, web = !!s.fileSource, browser = s.fileSource === 'browser';
  const t = o.text, wt = (name: string, values?: Record<string, unknown>) => t(`sftp:web_files.${name}`, values);
  const source = browser ? wt('browser') : wt('server');
  const roots = wt(browser ? 'selected_root' : o.fnos ? 'authorized_roots' : 'device_roots');
  const choosing = browser && !s.browserDirectory?.name, writable = !browser || !!s.browserDirectory?.writable;
  const canWrite = writable && s.location !== 'computer' && !!s.path;
  const history = o.service.history(s), window = o.service.window(key), entries = o.service.listed(key), selected = o.service.selected(key);
  const identity = `${s.fileSource || 'native'}\0${s.path}\0${s.query}\0${s.sort}\0${s.dir}`;
  const list = view.host.querySelector<HTMLElement>('.local-files-list');
  const scroll = view.listIdentity === identity ? list?.scrollTop ?? s.scrollTop : 0;
  if (view.listIdentity !== identity) {s.scrollTop = 0; view.blockedPage = 0; view.listIdentity = identity;}
  const rowHeight = list ? Number.parseFloat(getComputedStyle(list).getPropertyValue('--file-row-height')) || 36 : 36;
  const range = window.range(scroll, list?.clientHeight || 400, rowHeight);
  const attrs = (action: string, data: Record<string, unknown> = {}, event = 'action') => ({ [`data-${event}`]: `${web ? 'web-files' : 'local-files'}-${action}`, 'data-tab-key': key, ...data });
  const button = (action: string, icon: string, label: string, data: Record<string, unknown> = {}, text = false) => h(TermaButton, {
    type: 'button', class: text ? '' : 'icon-button', title: label, 'aria-label': label, ...attrs(action), ...data
  }, () => [settingsIcon(icon), text ? h('span', null, label) : null]);
  const native = (action: string, glyph: string, label: string, data: Record<string, unknown> = {}, text = false) => button(action, glyph, t(label), data, text);
  const separator = () => h('span', { class: 'local-files-toolbar-separator', 'aria-hidden': 'true' });
  const search = () => h('div', { class: web ? 'web-files-search' : 'local-files-search' }, [settingsIcon('search'), h('input', {
    value: s.query, placeholder: t('sftp:auto.search_current'), 'aria-label': t('sftp:auto.search_current'), ...attrs('search', {}, 'input-action')
  }), !web ? native('search-clear', 'x', 'sftp:auto.clear_search') : null]);
  const toolbar: VNodeChild[] = web ? [
    browser ? button('choose', 'folder-open', wt('choose_folder'), {}, true) : null,
    browser ? button('choose-readonly', 'folder-open', wt('choose_readonly'), {}, true) : null,
    native('refresh', 'refresh-cw', 'common:auto.refresh'),
    native('mkdir', 'folder-plus', 'common:auto.new_folder', { disabled: !canWrite }),
    native('create', 'file-plus-2', 'common:auto.new_file', { disabled: !canWrite }),
    button('upload', 'upload', wt('upload_here'), { disabled: !canWrite }),
    native('new', 'plus', 'navigation:auto.new_local_files_tab')
  ] : [
    native('history', 'arrow-left', 'sftp:local_files.history_back', { class: 'icon-button local-files-history-back', 'data-history-direction': -1, disabled: history.index <= 0 }),
    native('history', 'arrow-right', 'sftp:local_files.history_forward', { class: 'icon-button local-files-history-forward', 'data-history-direction': 1, disabled: history.index >= history.paths.length - 1 }),
    native('parent', 'corner-left-up', 'sftp:auto.parent_directory', { class: 'icon-button local-files-parent', disabled: !s.parent && s.parentKind !== 'computer' }), separator(),
    native('location', 'monitor', 'sftp:local_files.desktop', { 'data-location': 'desktop' }),
    native('location', 'download', 'sftp:local_files.downloads', { 'data-location': 'downloads' }),
    native('location', 'home', 'sftp:local_files.home', { 'data-location': 'home' }), native('refresh', 'refresh-cw', 'common:auto.refresh'), separator(),
    native('create', 'folder-plus', 'common:auto.new_folder', { class: 'icon-button local-files-create-directory', 'data-entry-kind': 'dir', disabled: !canWrite }),
    native('create', 'file-plus-2', 'common:auto.new_file', { class: 'icon-button local-files-create-file', 'data-entry-kind': 'file', disabled: !canWrite }), separator(),
    native('new-tab', 'plus', 'navigation:auto.new_local_files_tab')
  ];
  const breadcrumbs: { label: string; path: string; computer?: boolean }[] = [];
  if (s.location === 'computer') breadcrumbs.push({ label: t('sftp:local_files.this_computer'), path: '', computer: true });
  else if (/^[A-Za-z]:[\\/]/.test(s.path)) {
    breadcrumbs.push({ label: t('sftp:local_files.this_computer'), path: '', computer: true });
    const parts = s.path.replace(/[\\/]+$/, '').split(/[\\/]/); let path = `${parts.shift()}\\`;
    breadcrumbs.push({ label: path, path });
    for (const part of parts) { path += (path.endsWith('\\') ? '' : '\\') + part; breadcrumbs.push({ label: part, path }); }
  } else {
    breadcrumbs.push({ label: '/', path: '/' }); let path = '';
    for (const part of s.path.split('/').filter(Boolean)) { path += `/${part}`; breadcrumbs.push({ label: part, path }); }
  }
  const nav = web ? h('div', { class: 'web-files-navigation' }, [
    button('back', 'arrow-left', wt('back'), { disabled: history.index <= 0 }),
    button('forward', 'arrow-right', wt('forward'), { disabled: history.index >= history.paths.length - 1 }),
    native('parent', 'corner-left-up', 'sftp:auto.parent_directory', { disabled: !s.path || s.path === '/browser' }), button('roots', 'hard-drive', roots),
    h('div', { class: 'web-files-address' }, [settingsIcon('folder-open'), button('path', '', s.displayPath || (browser ? wt('choose_folder') : roots), { class: 'web-files-path', disabled: !s.path }, true), native('copy-path', 'copy', 'sftp:menu.copy_path', { disabled: !s.path })]), search()
  ]) : h('div', { class: 'local-files-navigation-row' }, [h('div', { class: 'local-files-path-block' }, [
    h('nav', { class: 'local-files-breadcrumb', 'aria-label': t('sftp:local_files.path'), hidden: view.editing, ...attrs('path-edit', {}, 'dblclick-action') }, breadcrumbs.flatMap((crumb, index) => [
      index ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, settingsIcon('chevron-right')) : null,
      button(crumb.computer ? 'computer' : 'path', '', crumb.label, { class: ['crumb', index === breadcrumbs.length - 1 ? 'active' : ''], 'data-path': crumb.path, 'aria-current': index === breadcrumbs.length - 1 ? 'page' : undefined }, true)
    ])), h('form', { class: 'local-files-path-editor', hidden: !view.editing, ...attrs('path-submit', {}, 'submit-action') }, [
      h('input', { value: view.pathDraft, 'aria-label': t('sftp:local_files.path'), onInput: (event: Event) => { view.pathDraft = (event.target as HTMLInputElement).value; } }),
      h(TermaButton, { type: 'submit', class: 'icon-button', title: t('sftp:auto.go_to_path'), 'aria-label': t('sftp:auto.go_to_path') }, () => [settingsIcon('corner-down-left')]), native('path-cancel', 'x', 'common:actions.cancel')
    ])]), native('path-edit', 'pencil', 'sftp:auto.enter_path', { class: 'icon-button local-files-path-edit-button', hidden: view.editing })]);
  const actions = web ? [
    native('send', 'upload', 'common:auto.upload_to_sftp', {}, true), native('download', 'download', 'sftp:menu.download', {}, true),
    native('rename', 'pencil', 'common:auto.rename', { disabled: !canWrite || selected.length !== 1 }, true), native('delete', 'trash-2', 'common:actions.delete', { class: 'danger', disabled: !canWrite }, true)
  ] : [
    native('selection-open', 'folder-open', 'common:auto.open', { disabled: selected.length !== 1, 'data-local-files-single-action': '' }, true),
    native('selection-upload', 'upload', 'common:auto.upload_to_sftp', {}, true), native('selection-copy', 'clipboard', 'common:auto.copy_path', {}, true),
    native('selection-rename', 'pencil', 'common:auto.rename', { disabled: selected.length !== 1, 'data-local-files-single-action': '' }, true),
    native('selection-delete', 'trash-2', 'common:actions.delete', { class: 'danger' }, true),
    native('selection-chmod', 'key-round', 'sftp:menu.permissions', { disabled: selected.length !== 1, 'data-local-files-single-action': '' }, true), native('selection-clear', 'x', 'sftp:local_files.clear_selection')
  ];
  const head = h('div', { class: 'local-files-head' }, [h('label', null, h('input', {
    type: 'checkbox', checked: entries.some(item => item.type !== 'drive') && entries.filter(item => item.type !== 'drive').every(item => s.selected.has(item.path)),
    indeterminate: entries.some(item => s.selected.has(item.path)) && !entries.filter(item => item.type !== 'drive').every(item => s.selected.has(item.path)),
    disabled: !entries.some(item => item.type !== 'drive'), 'aria-label': t('sftp:auto.select_loaded'), ...attrs('select-all', {}, 'change-action')
  })), ...['name', 'size', 'mtime'].map((column, index) => h('div', { class: `local-files-head-cell local-files-column-${column}`, 'data-local-files-column': column }, [
    button('sort', '', `${t(`sftp:auto.${column === 'mtime' ? 'modified' : column}`)}${s.sort === column ? s.dir === 'desc' ? ' ↓' : ' ↑' : ''}`, { 'data-sort': column }, true),
    index < 2 ? h('i', { class: 'local-files-column-resize', 'data-local-files-column-resize': column, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('sftp:auto.resize_columns', { column: t(`sftp:auto.${column}`) }), tabindex: 0 }) : null
  ]))]);
  const rows = range.items.map(({index, value: entry}) => {
    if (!entry) return h('div', {key: `pending-${index}`, class: 'file-list-pending', 'aria-hidden': true});
    const drive = entry.type === 'drive', dir = entry.type !== 'file', name = web && entry.root_kind === 'workspace' ? wt('workspace_folder') : o.displayName(entry);
    const size = drive && entry.size ? t('common:local_files.available_space', { free: o.bytes(entry.free || 0), total: o.bytes(entry.size) }) : dir ? '--' : o.bytes(entry.size);
    const meta = drive ? entry.display_path || size : [dir ? t('sftp:auto.directory') : size, entry.mtime ? o.time(entry.mtime) : ''].filter(Boolean).join(' · ');
    const data = { 'data-path': entry.path, 'data-entry-type': entry.type };
    return h('div', { key: entry.path, class: ['local-files-row', drive ? 'is-drive' : '', s.activePath === entry.path ? 'active' : '', s.selected.has(entry.path) ? 'is-selected' : ''], ...data,
      draggable: !o.mobile && !drive, ...attrs(web ? 'select' : 'entry-select'),
      ...attrs(web ? 'open' : 'entry-activate', {}, 'dblclick-action'), ...attrs(web ? 'menu' : 'entry-menu', {}, 'contextmenu-action'),
      ...attrs(web ? 'drag-start' : 'entry-drag-start', {}, 'dragstart-action'), 'data-dragend-action': 'local-files-entry-drag-end'
    }, [h('input', { class: 'local-files-check', type: 'checkbox', value: entry.path, checked: s.selected.has(entry.path), disabled: drive,
      'data-name': entry.name, 'data-type': entry.type, 'data-size': entry.size, ...data, 'aria-label': t('common:local_files.select_entry', { name }), ...attrs(web ? 'check' : 'entry-checkbox') }),
      h(TermaButton, { class: 'local-files-name', ...data, ...attrs(web ? 'row-open' : 'entry-select-stop') }, () => [h('span', { class: ['sftp-icon', entry.type] }, settingsIcon(drive ? 'hard-drive' : dir ? 'folder' : 'file')), h('span', { class: 'local-files-name-copy' }, [h('span', { class: 'local-files-file-name', 'data-i18n-skip': '' }, name), h('span', { class: ['local-files-mobile-meta', web && drive ? 'web-files-root-path' : ''] }, meta)])]),
      h('span', { class: 'local-files-size', title: size }, size), h('span', { class: 'local-files-time' }, entry.mtime ? o.time(entry.mtime) : '--')]);
  });
  const empty = choosing ? wt('choose_folder') : s.query ? t('common:local_files.no_matches') : t('sftp:auto.empty_directory');
  const listState = (kind: string, label: string, detail = '') => h('div', { class: `ui-state ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [h('span', { class: 'ui-state-icon' }), h('strong', null, label), h('span', null, detail),
    kind === 'error' ? native('refresh', 'refresh-cw', 'common:actions.retry', {}, true) : null,
    s.loginRequired ? h('a', { href: '/login' }, wt('sign_in')) : null]);
  const status = h('div', {class: 'file-list-status', role: 'status'}, [
    s.error && s.loaded ? h('span', {class: 'file-list-error', role: 'alert', title: s.error}, s.error) : null,
    h('span', null, t('sftp:auto.continuous_count', {first: s.total ? range.first + 1 : 0, last: range.last, total: s.total})),
    view.blockedPage ? h(TermaButton, {class: 'icon-button', title: t('common:actions.retry'), 'aria-label': t('common:actions.retry'),
      onClick: () => {view.blockedPage = 0; schedule(view);}}, () => settingsIcon('refresh-cw')) : null
  ]);
  view.lastPath = s.path;
  render(h('div', { class: ['local-files-shell terma-vue-root terma-local-files-root', web ? 'web-files-shell' : ''], 'data-theme': document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    'data-source': s.fileSource, 'data-i18n-skip': '', 'data-local-files-tab-key': key,
    ...attrs('drag-over', {}, 'dragover-action'), ...attrs('drop', {}, 'drop-action'), ...(!web ? attrs('drag-leave', {}, 'dragleave-action') : {})
  }, [h('div', { class: 'local-files-top' }, [
    web ? h('div', { class: 'web-files-header' }, [h('div', { class: 'web-files-origin' }, [h('span', { class: 'web-files-source-icon' }, settingsIcon(browser ? 'laptop' : 'server')), h('div', null, [h('div', { class: 'web-files-source-line' }, [h('strong', null, source), h('span', { class: 'web-files-mode', 'data-writable': writable }, wt(choosing ? 'not_selected' : writable ? 'read_write' : 'read_only'))]), h('span', { class: 'muted web-files-hint' }, wt(!browser ? o.fnos ? 'server_hint' : 'server_standard_hint' : choosing ? 'choose_hint' : writable ? 'browser_hint' : 'readonly_hint'))])]), h('div', { class: 'local-files-toolbar' }, h('div', { class: 'local-files-toolbar-actions' }, toolbar))]) : h('div', { class: 'local-files-toolbar' }, h('div', { class: 'local-files-toolbar-actions' }, toolbar)),
    !web ? h('div', { class: 'local-files-search-wrap' }, search()) : null, nav,
    h('div', { class: ['local-files-selection', web ? 'web-files-selection' : ''], hidden: selected.length < (web ? 1 : 2) }, [h('strong', null, [web ? wt('selected', { count: selected.length }) : t('sftp:local_files.selected_prefix'), h('span', null, web ? '' : String(selected.length)), web ? '' : t('sftp:local_files.selected_suffix')]), h('div', { class: 'local-files-selection-actions' }, actions)])]),
    h('div', { class: 'local-files-list', role: 'region', 'aria-label': web ? source : t('sftp:local_files.title'), 'aria-busy': String(s.loading), ...attrs('directory-menu', {}, 'contextmenu-action'), onScroll: (event: Event) => {
      s.scrollTop = (event.target as HTMLElement).scrollTop; view.blockedPage = 0; schedule(view);
    } },
      s.error && !s.loaded ? listState('error', s.error) : s.loading && !s.loaded ? listState('loading', t('sftp:local_files.loading_directory'), s.displayPath) : [
        head, h('div', {class: 'file-list-spacer', style: {height: `${range.top}px`}, 'aria-hidden': true}),
        rows.length ? rows : listState('empty', empty, choosing ? wt('browser_hint') : ''),
        h('div', {class: 'file-list-spacer', style: {height: `${range.bottom}px`}, 'aria-hidden': true}), status
      ]),
    web ? h('div', { class: 'web-files-status', role: 'status' }, s.status) : h('div', { class: 'local-files-drop-overlay', hidden: true }, [settingsIcon('download'), h('strong', null, t('sftp:local_files.drop_save_current'))])
  ]), view.host);
  const next = view.host.querySelector<HTMLElement>('.local-files-list'); if (next) next.scrollTop = scroll;
  if (range.missingPage && !s.loading && !view.pendingPage && view.blockedPage !== range.missingPage && next?.isConnected && next.getClientRects().length) {
    view.pendingPage = range.missingPage;
    queueMicrotask(() => {
      if (!view.host.isConnected) {view.pendingPage = 0; return;}
      void o.service.scrollPage(key, range.missingPage).then(success => {
        if (!success) view.blockedPage = range.missingPage;
      }).catch(() => {view.blockedPage = range.missingPage;}).finally(() => {view.pendingPage = 0; schedule(view);});
    });
  }
}
function schedule(view: View) {
  if (view.frame || !view.host.isConnected) return;
  view.frame = requestAnimationFrame(() => {view.frame = 0; if (view.host.isConnected) paint(view);});
}
export function installLocalFilesView() {
  filesServices.termaLocalFileViews = {
    mount(target, options) {
      for (const [key, existing] of views) if (target.contains(existing.host)) this.release(key);
      this.release(options.key); target.replaceChildren(); const host = document.createElement('div'); host.className = 'terma-local-files-mount'; target.append(host);
      const view: View = { host, options, cleanup: () => {}, editing: false, pathDraft: options.state.path, lastPath: options.state.path,
        frame: 0, pendingPage: 0, blockedPage: 0 }; views.set(options.key, view); paint(view);
      const observer = new ResizeObserver(() => schedule(view)), list = host.querySelector('.local-files-list');
      if (list) observer.observe(list);
      const columns=bindFileColumns(host),scroll=bindFileScroll(host,()=>view.options.state);
      view.cleanup=()=>{columns();scroll();observer.disconnect();if(view.frame)cancelAnimationFrame(view.frame);};return true;
    },
    update(key, options) { const view = views.get(key); if (!view || !view.host.isConnected) return false; view.options = options; paint(view); return true; },
    pathEditor(key, editing) { const view = views.get(key); if (!view) return; view.editing = editing; if (editing) view.pathDraft = view.options.state.path; paint(view); if (editing) { const input = view.host.querySelector<HTMLInputElement>('.local-files-path-editor input'); input?.focus(); input?.select(); } },
    release(key) { const view = views.get(key); if (!view) return; view.cleanup(); render(null, view.host); view.host.remove(); views.delete(key); }
  };
  new MutationObserver(() => { for (const view of views.values()) paint(view); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}


export interface InstalledFeaturesFilesLocalFilesViewServices {
  termaLocalFileViews: { mount(target: HTMLElement, options: Options): boolean; update(key: string, options: Options): boolean; pathEditor(key: string, editing: boolean): void; release(key: string): void }
}
