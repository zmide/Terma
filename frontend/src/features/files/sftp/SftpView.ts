import {filesServices} from '@/features/files/installed-services';
import { Fragment, h, render, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from '@/features/settings/settings-icon';
import { createSftpInlineRenameController, type InlineRenameController } from './SftpInlineRename';
import type { SftpScrollState } from './directory-state';
import { sftpFilePresentation } from './file-kind';
import { sftpSelection, type SftpSelectionEvent } from './selection';
import { fitSftpRowActions } from './row-actions';
import '@/styles/sftp.css';

export interface SftpEntry {
  name: string; type: string; size: number; mtime?: number; mode?: string; owner?: string; group?: string;
  owner_name?: string; group_name?: string; owner_id?: string; group_id?: string;
  metadata_known?: boolean; is_symlink?: boolean; link_target_missing?: boolean; link_size?: number; path_bytes_b64?: string;
}
interface SftpState {
  path: string; entries: SftpEntry[]; selected?: { path: string; id?: number; name?: string; type?: string } | null; selectionAnchorPath?: string; query: string; recursiveSearch: boolean;
  recursiveSearchTruncated: boolean; sort: string; dir: string; page: number; pageSize: number; total: number;
  totalPages: number; unfilteredTotal: number; loading: boolean;
}
interface SftpModel {
  key: string; connectionId: number; quick: boolean; desktop: boolean; mobile: boolean; encoding: string;
  status: string; error: string; state: SftpState; selectedPaths: string[]; columns: string[];
  favorite: boolean; favorites: { name: string; path: string }[];
  clipboard: null | { count: number; moving: boolean; source: string; matches: boolean; canPaste: boolean; pending?: boolean };
  hasRemoteJump: boolean; hasLocalFiles: boolean; historyBack: boolean; historyForward: boolean; mobileToolbarExpanded?: boolean;
}
export interface SftpOptions {
  model: SftpModel;
  isCurrent?(): boolean;
  text(key: string, params?: Record<string, unknown>): string;
  bytes(size: number): string;
  time(value: number): string;
  path(name: string): string;
  isArchive(name: string): boolean;
  isImage(name: string): boolean;
  directorySize(path: string): { className: string; label: string; title: string; disabled: boolean; iconName: string; key: string };
  opening(path: string): boolean;
  run(action: string, ...args: unknown[]): unknown;
}
type ViewState = { pathEditing: boolean; pathDraft: string; searchOpen: boolean; searchDraft: string; searchBusy: boolean };
type Entry = { shell: HTMLElement; hosts: Map<string, HTMLElement>; options: SftpOptions; rename: InlineRenameController; ui: ViewState };
const views = new Map<string, Entry>();
type UnavailableText = { title: string; message: string; hint: string };
const unavailableViews = new Map<string, { target: HTMLElement; text: () => UnavailableText }>();
const parts = ['toolbar', 'navigation', 'favorites', 'banner', 'selection', 'list', 'search'] as const;
export type SftpPart = typeof parts[number];

function paintUnavailable(key: string, entry: { target: HTMLElement; text: () => UnavailableText }) {
  const text = entry.text();
  render(h('section', { class: 'sftp-unavailable-state terma-vue-root terma-sftp-root', role: 'status', 'data-sftp-unavailable': key, 'data-i18n-skip': '', 'data-theme': document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }, [
    h('span', { class: 'sftp-unavailable-icon', 'aria-hidden': 'true' }, settingsIcon('link-2-off')),
    h('h2', { class: 'sftp-unavailable-title' }, text.title),
    h('p', { class: 'sftp-unavailable-message' }, text.message),
    h('p', { class: 'sftp-unavailable-hint' }, text.hint)
  ]), entry.target);
}

function paint(entry: Entry, part: SftpPart, state?: { kind: string; detail?: string }) {
  const target = entry.hosts.get(part);
  if (!target) return;
  const active = document.activeElement instanceof HTMLElement && target.contains(document.activeElement) ? document.activeElement : null;
  const focusables = active ? [...target.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]')].filter(node => !node.hasAttribute('disabled') && node.tabIndex >= 0) : [];
  const activeIndex = active ? focusables.indexOf(active) : -1;
  const activeId = active?.id || '';
  const selection = active instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'number'].includes(active.type) ? {
    start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection
  } : null;
  const scrollTop = target.scrollTop;
  const o = entry.options, m = o.model, s = m.state;
  const t = (key: string, params?: Record<string, unknown>) => o.text(key.includes(':') ? key : `sftp:${key}`, params);
  const run = (action: string, ...args: unknown[]) => o.run(action, ...args);
  const button = (icon: string, label: string, action: (event: MouseEvent) => unknown, attrs: Record<string, unknown> = {}, text = '') =>
    h(TermaButton, { type: 'button', class: text ? '' : 'icon-button', title: label, 'aria-label': label, ...attrs, onClick: action },
      () => [settingsIcon(icon), text ? h('span', null, text) : null]);
  let content: VNodeChild;
  if (part === 'toolbar') {
    const clipboard = m.clipboard;
    const queue = clipboard ? t(clipboard.moving ? 'clipboard.move_queue' : 'clipboard.copy_queue', { count: clipboard.count }) : '';
    const statusLabel = t(m.status === 'connecting' ? 'auto.connecting' : m.status === 'connected' ? 'auto.disconnect' : 'auto.reconnect_sftp');
    content = h('div', { class: 'sftp-toolbar-actions' }, [
      button('square-terminal', t('auto.open_terminal'), () => run('terminal'), { class: 'icon-button sftp-action-terminal' }),
      !m.quick ? button(m.favorite ? 'star-off' : 'star', t(m.favorite ? 'auto.unfavorite_current' : 'auto.favorite_current'), () => run('favorite'), { id: 'sftpFavoriteToggle', class: ['icon-button', m.favorite ? 'is-active' : ''] }) : null,
      button('folder-plus', t('menu.new_folder'), () => run('mkdir')),
      button('file-plus-2', t('menu.new_file'), () => run('create')),
      button('upload', t('auto.upload_files'), () => run('chooseUpload', target.querySelector<HTMLInputElement>('#sftpUpload'))),
      h('input', { id: 'sftpUpload', type: 'file', multiple: true, hidden: true, onChange: (event: Event) => run('upload', event), onCancel: (event: Event) => run('cancelUpload', event) }),
      button('trash-2', t('auto.recycle_bin'), () => run('recycle')),
      h('span', { id: 'sftpClipboardActions', class: 'sftp-clipboard-actions' }, clipboard ? [
        h('span', { class: 'sftp-clipboard-state', title: clipboard.source ? t('clipboard.source', { name: clipboard.source }) : queue }, [settingsIcon(clipboard.moving ? 'folder-input' : 'copy'), h('span', null, queue)]),
        button(clipboard.pending ? 'loader-circle' : clipboard.matches ? 'clipboard-paste' : 'network', t(clipboard.matches ? 'clipboard.paste_current' : !clipboard.moving ? 'clipboard.copy_from_source' : 'clipboard.cross_copy_only'), () => run('paste'), { class: ['primary', clipboard.pending ? 'busy' : ''], disabled: !clipboard.canPaste, 'aria-busy': clipboard.pending || undefined }, t(clipboard.matches ? 'common:actions.paste' : 'clipboard.cross_copy')),
        button('x', t('clipboard.cancel_title'), () => run('cancelClipboard'), { 'aria-label': t('clipboard.cancel_label') })
      ] : []),
      h('span', { class: 'sftp-toolbar-separator', 'aria-hidden': 'true' }),
      button('search', t('auto.search_current'), () => searchVisibility(entry, !entry.ui.searchOpen), { id: 'sftpSearchToggle', 'aria-controls': 'sftpFloatingSearch', 'aria-expanded': entry.ui.searchOpen }),
      m.quick ? h('span', { id: 'sftpFilenameEncodingButton', class: 'sftp-encoding-button', title: t('auto.temporary_utf8') }, [settingsIcon('earth'), h('span', null, 'UTF-8')]) :
        button('earth', t('auto.change_filename_encoding'), event => run('encoding', event), { id: 'sftpFilenameEncodingButton', class: 'sftp-encoding-button' }, m.encoding),
      m.hasRemoteJump ? button('monitor', t('remote:jump.open_title'), event => run('remote', event), { class: 'icon-button workspace-jump-button remote-desktop-jump-button' }) : null,
      button(m.status === 'connected' ? 'link-2-off' : m.status === 'connecting' ? 'loader-circle' : 'link-2', statusLabel, () => run('connection'), { id: 'sftpConnectionToggle', class: 'icon-button sftp-connection-toggle', 'data-status': m.status, disabled: m.status === 'connecting' }),
      button('refresh-cw', t('auto.refresh_directory'), () => run('refresh')),
      button('settings', t('auto.global_settings'), () => run('settings'), { id: 'sftpGlobalSettingsButton' }),
      m.hasLocalFiles ? h(TermaButton, { type: 'button', class: 'icon-button local-files-open-button', title: t('navigation:auto.new_local_files_tab'), 'aria-label': t('navigation:auto.new_local_files_tab'), 'data-action': 'local-files-new-tab', 'data-tab-key': m.key }, () => settingsIcon('hard-drive')) : null
    ]);
  } else if (part === 'navigation') {
    const editing = entry.ui.pathEditing;
    const draft = editing ? entry.ui.pathDraft : s.path;
    const clean = (s.path || '.').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const absolute = clean.startsWith('/');
    const crumbs = [{ label: t(absolute ? 'auto.root_directory' : 'auto.current_directory'), path: absolute ? '/' : '.' }];
    let current = absolute ? '' : '.';
    if (clean !== '.') for (const name of clean.split('/').filter(Boolean)) {
      current = current === '.' ? name : `${current.replace(/\/$/, '')}/${name}`;
      crumbs.push({ label: name, path: current });
    }
    const expanded = !m.mobile || Boolean(m.mobileToolbarExpanded);
    const mount = entry.shell.querySelector<HTMLElement>('#sftpToolbarMount');
    if (mount) mount.hidden = !expanded;
    content = h(Fragment, null, [
      h('div', { class: 'sftp-navigation-actions' }, [
        button('arrow-left', t('auto.history_back'), () => run('history', -1), { id: 'sftpHistoryBack', disabled: !m.historyBack }),
        button('arrow-right', t('auto.history_forward'), () => run('history', 1), { id: 'sftpHistoryForward', disabled: !m.historyForward }),
        button('corner-left-up', t('auto.parent_directory'), () => run('parent'))
      ]),
      h('div', { class: 'sftp-path-block' }, [
        h('nav', { id: 'sftpBreadcrumb', class: 'sftp-breadcrumb', 'aria-label': t('auto.remote_path'), hidden: editing, onDblclick: () => pathEditor(entry, true) }, crumbs.flatMap((crumb, index) => [
          index ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, settingsIcon('chevron-right')) : null,
          h(TermaButton, { class: ['crumb', index === crumbs.length - 1 ? 'active' : ''], title: crumb.path, 'aria-current': index === crumbs.length - 1 ? 'page' : undefined, onClick: () => run('navigate', crumb.path) }, () => crumb.label)
        ])),
        h('form', { id: 'sftpPathEditor', class: 'sftp-path-editor', hidden: !editing, onSubmit: (event: Event) => { event.preventDefault(); submitPath(entry); } }, [
          h('input', { id: 'sftpPathInput', 'aria-label': t('auto.remote_path'), value: draft, onInput: (event: Event) => { entry.ui.pathDraft = (event.target as HTMLInputElement).value; }, onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); pathEditor(entry, false); } } }),
          button('corner-down-left', t('auto.go_to_path'), () => {}, { type: 'submit' }),
          button('x', t('common:actions.cancel'), () => pathEditor(entry, false))
        ])
      ]),
      h('div', { class: 'sftp-navigation-end-actions' }, [
        button('pencil', t('auto.enter_path'), () => pathEditor(entry, true), { id: 'sftpPathEditButton', class: 'icon-button sftp-path-edit-button', hidden: editing }),
        button(expanded ? 'chevron-up' : 'chevron-down', t(expanded ? 'auto.collapse_actions' : 'auto.expand_actions'), () => run('mobileToolbar'), { id: 'sftpMobileToolbarToggle', class: 'icon-button sftp-mobile-toolbar-toggle', 'aria-controls': 'sftpToolbarMount', 'aria-expanded': String(expanded) })
      ])
    ]);
  } else if (part === 'favorites') {
    target.classList.toggle('is-empty', !m.favorites.length);
    content = [h('span', { class: 'sftp-favorites-label' }, t('auto.favorites')), ...m.favorites.map(item => h(TermaButton, { key: item.path, title: item.path, onClick: () => run('navigate', item.path) }, () => [h('span', { 'aria-hidden': 'true' }, '★'), item.name || item.path])), !m.favorites.length ? h('span', { class: 'muted' }, t('auto.favorites_hint')) : null];
  } else if (part === 'banner') {
    target.hidden = m.status !== 'disconnected';
    entry.shell.classList.toggle('is-disconnected', m.status === 'disconnected');
    content = [h('div', null, [settingsIcon('link-2-off'), h('span', null, [h('strong', null, t('auto.connection_disconnected')), h('small', { class: 'sftp-connection-detail' }, m.error || t('auto.connection_preserved'))])]), button('link-2', t('auto.reconnect'), () => run('reconnect'), {}, t('auto.reconnect'))];
  } else if (part === 'selection') {
    const count = m.selectedPaths.length;
    target.hidden = count < 2;
    const action = (name: string, icon: string, label: string, attrs: Record<string, unknown> = {}) => button(icon, label, () => run(name), attrs, label);
    content = [h('div', { id: 'sftpSelectedInfo', class: 'sftp-selected' }, [h('strong', null, t('auto.selected_count', { count })), h('span', null, t('auto.selected_hint'))]),
      h('div', { class: 'sftp-selection-actions' }, [
        action('copy', 'copy', t('menu.copy')), action('move', 'folder-input', t('menu.move')), action('downloadSelection', 'download', t('menu.download')),
        m.desktop ? action('desktopSelection', 'monitor-down', t('auto.send_to_desktop')) : null,
        action('compress', 'archive', t('menu.compress'), { id: 'sftpSelectionCompress', hidden: !count }),
        action('permissions', 'key-round', t('auto.permissions'), { id: 'sftpSelectionPermissions', hidden: !count }),
        action('extract', 'archive-restore', t('menu.extract'), { id: 'sftpSelectionExtract', hidden: !(count === 1 && o.isArchive(m.selectedPaths[0] || '')) }),
        action('deleteSelection', 'trash-2', t('menu.delete'), { class: 'danger' }),
        button('x', t('common:auto.cancel_selection'), () => run('clearSelection'), { class: 'icon-button sftp-clear-selection' })
      ])];
  } else if (part === 'search') {
    target.hidden = !entry.ui.searchOpen;
    target.classList.toggle('is-searching', entry.ui.searchBusy);
    target.setAttribute('aria-busy', String(entry.ui.searchBusy));
    content = [h('span', { class: 'sftp-search-status-icon', title: t(entry.ui.searchBusy ? 'auto.searching' : 'auto.search') }, [settingsIcon('search'), settingsIcon('loader-circle')]),
      h('input', { id: 'sftpSearch', placeholder: t('auto.search_current'), value: entry.ui.searchDraft, onInput: (event: Event) => { entry.ui.searchDraft = (event.target as HTMLInputElement).value; run('searchValue', entry.ui.searchDraft); }, onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchVisibility(entry, false); } } }),
      button('x', t('auto.clear_search'), () => clearSearch(entry)),
      h('label', { class: 'sftp-search-recursive' }, [h('input', { type: 'checkbox', checked: s.recursiveSearch, onChange: (event: Event) => run('recursive', (event.target as HTMLInputElement).checked) }), h('span', null, t('auto.search_children'))])];
  } else {
    const status = state?.kind;
    if (status === 'loading' || status === 'error') {
      content = h('div', { class: `ui-state ${status}`, role: status === 'error' ? 'alert' : 'status' }, [h('span', { class: 'ui-state-icon', 'aria-hidden': 'true' }), h('strong', null, t(status === 'error' ? 'auto.directory_load_failed' : 'auto.loading_directory')), h('span', null, state?.detail || s.path), status === 'error' ? button('refresh-cw', t('common:actions.retry'), () => run('refresh'), {}, t('common:actions.retry')) : null]);
    } else {
      const selected = new Set(m.selectedPaths);
      const columnLabel = (key: string) => t(`auto.${({ name: 'name', size: 'size', mtime: 'modified', access: 'permissions_owner' } as Record<string, string>)[key]}`);
      const header = h('div', { class: 'sftp-head' }, [
        h('label', { class: 'sftp-head-check' }, h('input', { id: 'sftpSelectAll', type: 'checkbox', 'aria-label': t('auto.select_page'), checked: !!s.entries.length && selected.size === s.entries.length, indeterminate: selected.size > 0 && selected.size < s.entries.length, onChange: (event: Event) => setAllSelected(entry, (event.target as HTMLInputElement).checked) })),
        ...m.columns.map(key => h('div', { key, class: ['sftp-head-cell', `sftp-column-${key}`, ({ size: 'sftp-size', mtime: 'sftp-time', access: 'sftp-access' } as Record<string, string>)[key]], 'data-sftp-column': key, draggable: true }, [
          key !== 'access' ? h(TermaButton, { 'data-sftp-column-sort': key, 'data-sftp-tab-key': m.key }, () => [h('span', null, `${columnLabel(key)}${s.sort === key ? s.dir === 'asc' ? ' ↑' : ' ↓' : ''}`), key === 'name' ? h('small', { class: 'sftp-compact-column-labels' }, t('auto.compact_columns')) : null]) : h('span', null, columnLabel(key)),
          h('i', { class: 'sftp-column-resize', 'data-sftp-column-resize': key, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('auto.resize_columns', { column: columnLabel(key) }), tabindex: 0 })
        ])), h('span', { class: 'sftp-head-actions' }, t('auto.actions')), h('div', { class: 'sftp-refresh-indicator', role: 'status' }, [settingsIcon('loader-circle'), h('span', null, t('auto.syncing'))])
      ]);
      const rows = s.entries.map(file => {
        const path = o.path(file.name), dir = file.type === 'dir', known = file.metadata_known !== false, presentation = sftpFilePresentation(file.name, file.type), kind = presentation.kind, opening = o.opening(path), image = o.isImage(file.name);
        const principal = (value: string | undefined, type: 'owner' | 'group') => {
          const raw = String(value || '');
          if (!raw) return t('auto.unknown');
          if (!/^\d+$/.test(raw)) return raw;
          return t(type === 'owner' ? 'auto.owner_uid' : 'auto.group_gid', { id: raw });
        };
        const owner = file.owner_name || principal(file.owner, 'owner'), group = file.group_name || principal(file.group, 'group');
        const ownerDetail = file.owner_name && file.owner_id ? `${file.owner_name} (UID ${file.owner_id})` : owner;
        const groupDetail = file.group_name && file.group_id ? `${file.group_name} (GID ${file.group_id})` : group;
        const entryAction = (action: string, event?: Event) => run(action, event, file, path);
        const selection = {path, name: file.name, type: file.type};
        const description = !file.is_symlink ? file.name : t(file.link_target_missing ? 'auto.link_target_missing' : dir ? 'auto.linked_directory_name' : 'auto.linked_file_name', { name: file.name, targetSize: o.bytes(file.size), linkSize: o.bytes(file.link_size || 0) });
        const type = file.is_symlink ? t(dir ? 'auto.linked_directory' : 'auto.linked_file') : dir ? t('auto.directory') : '';
        const meta = known ? [type || (!dir ? o.bytes(file.size) : ''), file.mtime ? o.time(file.mtime) : '', file.mode || '---', [owner, group].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') : type || t('auto.path_index');
        const size = o.directorySize(path);
        const rowButton = (action: string, icon: string, label: string, attrs: Record<string, unknown> = {}) => button(icon, label, event => { event.stopPropagation(); return entryAction(action, event); }, attrs, label);
        const actionClass = (level: 'core' | 'medium' | 'wide' | 'more', extra = '') => ['sftp-row-action', `sftp-row-action-${level}`, extra];
        const columns: Record<string, VNodeChild> = {
          name: h(TermaButton, { class: 'sftp-name sftp-column-name', title: description,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              const label = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.sftp-file-name');
              if (label) entry.rename.click(label, { path, name: file.name, type: file.type });
              selectEntry(entry, event, selection);
            },
            onKeydown: (event: KeyboardEvent) => {
              if (event.key !== 'F2' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
              event.preventDefault(); event.stopPropagation();
              const label = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.sftp-file-name');
              if (label) entry.rename.begin(label, { path, name: file.name, type: file.type });
            },
            onDblclick: (event: MouseEvent) => { event.stopPropagation(); activateEntry(entry, event, selection); }
          }, () => [h('span', { class: ['sftp-icon', file.type, kind, file.is_symlink ? 'symlink' : ''] }, [settingsIcon(presentation.glyph), presentation.badge ? h('small', null, presentation.badge) : null]), h('span', { class: 'sftp-name-copy' }, [h('span', { class: 'sftp-file-name' }, file.name), h('span', { class: 'sftp-mobile-meta' }, meta)])]),
          size: h('span', { class: 'sftp-size sftp-column-size' }, !known ? '--' : dir ? button(size.iconName, size.title, event => { event.stopPropagation(); run('directorySize', path); }, { class: ['sftp-directory-size-button', size.className], 'data-sftp-directory-size': size.key, disabled: size.disabled }, size.label) : o.bytes(file.size)),
          mtime: h('span', { class: 'sftp-time sftp-column-mtime' }, known && file.mtime ? o.time(file.mtime) : '--'),
          access: h('span', { class: 'sftp-access sftp-column-access', title: known ? t('auto.permission_detail', { mode: file.mode || t('auto.unknown'), owner: ownerDetail, group: groupDetail }) : t('auto.metadata_unavailable') }, [h('code', null, known ? file.mode || '---' : '--'), h('span', null, known ? owner : t('auto.path_index'))])
        };
        return h('div', { key: path, class: ['sftp-row', s.selected?.path === path ? 'active' : '', selected.has(path) ? 'is-selected' : ''], draggable: !m.mobile,
          onClick: (event: MouseEvent) => selectEntry(entry, event, selection), onDblclick: (event: MouseEvent) => activateEntry(entry, event, selection), onContextmenu: (event: MouseEvent) => entryAction('entryMenu', event),
          onPointerdown: (event: PointerEvent) => entryAction('primeDrag', event), onDragstart: (event: DragEvent) => entryAction('drag', event), onDragend: (event: DragEvent) => run('dragEnd', event)
        }, [h('input', { class: 'sftp-check', type: 'checkbox', value: path, checked: selected.has(path), 'data-path-bytes': file.path_bytes_b64 || '', 'data-name': file.name, 'data-type': file.type, 'data-size': Math.max(0, file.size || 0), 'data-mtime': Math.max(0, file.mtime || 0), 'data-metadata-known': known ? '1' : '0', 'data-mode': file.mode || '', 'data-owner': file.owner || '', 'data-group': file.group || '', 'aria-label': t('auto.select_item', { name: file.name }), onClick: (event: MouseEvent) => { event.stopPropagation(); selectEntry(entry, event, selection, true); } }),
          ...m.columns.map(key => columns[key]), h('div', { class: 'sftp-row-actions' }, [
            rowButton(dir ? 'navigateEntry' : 'openEntry', dir ? 'folder-open' : opening ? 'loader-circle' : image ? 'image' : 'file-text', t(dir ? 'auto.open' : opening ? 'auto.opening' : image ? 'auto.preview' : 'auto.open'), { class: actionClass('core', dir ? '' : 'sftp-file-open-button'), ...(!dir ? { disabled: opening, 'aria-busy': String(opening), 'data-sftp-connection-id': m.connectionId, 'data-sftp-remote-path': path, 'data-sftp-open-kind': image ? 'image' : 'text' } : {}) }),
            image && /\.svgz?$/i.test(file.name) ? rowButton('textEntry', 'file-text', t('auto.open'), { class: actionClass('core', 'sftp-file-open-button'), 'data-sftp-connection-id': m.connectionId, 'data-sftp-remote-path': path, 'data-sftp-open-kind': 'text' }) : null,
            !dir ? rowButton('downloadEntry', 'download', t('menu.download'), { class: actionClass('medium') }) : null,
            !dir && o.isArchive(file.name) ? rowButton('extractEntry', 'archive-restore', t('menu.extract'), { class: actionClass('medium') }) : null,
            rowButton('compressEntry', 'archive', t('menu.compress'), { class: actionClass('medium') }),
            rowButton('copyEntry', 'copy', t('menu.copy'), { class: actionClass('wide') }),
            rowButton('moveEntry', 'folder-input', t('menu.move'), { class: actionClass('wide') }),
            rowButton('renameEntry', 'pencil', t('menu.rename'), { class: actionClass('medium') }),
            rowButton('permissionsEntry', 'key-round', t('auto.permissions'), { class: actionClass('wide') }),
            rowButton('deleteEntry', 'trash-2', t('menu.delete'), { class: actionClass('wide', 'danger') }),
            button('ellipsis', t('auto.more'), event => { event.stopPropagation(); entryAction('entryMenu', event); }, { class: actionClass('more'), 'aria-label': t('auto.entry_more_actions', { name: file.name }) }, t('auto.more'))
          ])]);
      });
      const page = Number(s.page || 1), pages = Number(s.totalPages || 1), total = Number(s.total || 0), first = total ? (page - 1) * Number(s.pageSize || 50) + 1 : 0, last = total ? Math.min(first + rows.length - 1, total) : 0;
      const recursive = s.query && s.recursiveSearch ? `${t('auto.recursive_suffix')}${s.recursiveSearchTruncated ? ` ${t('auto.recursive_truncated')}` : ''}` : '';
      const filter = s.query && s.unfilteredTotal !== total ? t('auto.range_total', { count: s.unfilteredTotal, recursive }) : recursive;
      content = [header, ...rows, !rows.length ? h('div', { class: 'ui-state empty' }, [h('span', { class: 'ui-state-icon', 'aria-hidden': 'true' }), h('strong', null, t(s.query ? 'auto.no_matches' : 'auto.empty_directory')), h('span', null, t(s.query ? 'auto.try_another_search' : 'auto.empty_directory_hint'))]) : null,
        h('div', { class: 'sftp-pager-dock' }, h('div', { class: 'pager sftp-pager' }, [
          h('button', { type: 'button', disabled: page <= 1, onClick: () => run('page', page - 1) }, t('auto.previous_page')),
          h('span', { class: 'pager-count' }, [h('span', { class: 'sftp-scroll-cue', title: t('auto.more_below'), 'aria-hidden': 'true' }, settingsIcon('chevron-down')), h('span', { class: 'sftp-page-summary' }, t(filter ? 'auto.page_summary_filtered' : 'auto.page_summary', { page, pages, first, last, total, filter })),
            h('select', { 'aria-label': t('auto.page_size'), value: String(s.pageSize), onChange: (event: Event) => run('pageSize', (event.target as HTMLSelectElement).value) }, [25, 50, 100, 200].map(count => h('option', { value: String(count) }, t('auto.item_count', { count })))),
            h('label', { class: 'sftp-page-jump' }, [h('span', null, t('auto.page_jump')), h('input', { type: 'number', min: 1, max: pages, value: page, 'aria-label': t('auto.page_jump'), onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); run('jumpPage', event.currentTarget); } }, onChange: (event: Event) => run('jumpPage', event.currentTarget) })])]),
          h('button', { type: 'button', disabled: page >= pages, onClick: () => run('page', page + 1) }, t('auto.next_page'))
        ]))];
    }
  }
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  render(h(Fragment, null, [content]), target);
  if (part === 'list') fitSftpRowActions(target);
  target.scrollTop = scrollTop;
  if (active) {
    const nextFocusables = [...target.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]')].filter(node => !node.hasAttribute('disabled') && node.tabIndex >= 0);
    const replacement = activeId ? target.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`) : nextFocusables[activeIndex];
    if (replacement && target.contains(replacement)) {
      replacement.focus({ preventScroll: true });
      if (selection && replacement instanceof HTMLInputElement && selection.start !== null && selection.end !== null) {
        try { replacement.setSelectionRange(selection.start, selection.end, selection.direction || undefined); } catch { /* Some input types do not expose a text selection. */ }
      }
    }
  }
}

function pathEditor(entry: Entry, visible: boolean) {
  if (visible && !entry.ui.pathEditing) entry.ui.pathDraft = entry.options.model.state.path || '.';
  entry.ui.pathEditing = visible;
  paint(entry, 'navigation');
  const control = entry.hosts.get('navigation')?.querySelector<HTMLInputElement | HTMLButtonElement>(visible ? '#sftpPathInput' : '#sftpPathEditButton');
  control?.focus({preventScroll:true});
  if (control instanceof HTMLInputElement) control.select();
}
function submitPath(entry: Entry) {
  const value = entry.ui.pathDraft.trim();
  if (!entry.ui.pathEditing || !value || value.includes('\0')) return false;
  pathEditor(entry, false);
  void entry.options.run('navigate', value);
  return true;
}
function searchVisibility(entry: Entry, visible: boolean) {
  const restoreFocus = !visible && entry.hosts.get('search')?.contains(document.activeElement);
  entry.ui.searchOpen = visible;
  paint(entry, 'search');
  entry.hosts.get('toolbar')?.querySelector('#sftpSearchToggle')?.setAttribute('aria-expanded', String(visible));
  if (visible) { const input = entry.hosts.get('search')?.querySelector<HTMLInputElement>('#sftpSearch'); input?.focus({preventScroll:true}); input?.select(); }
  else if (restoreFocus) entry.hosts.get('toolbar')?.querySelector<HTMLButtonElement>('#sftpSearchToggle')?.focus({preventScroll:true});
}
function clearSearch(entry: Entry) {
  entry.ui.searchDraft = '';
  entry.options.model.state.query = '';
  void entry.options.run('searchValue', '');
  searchVisibility(entry, false);
}

function release(key: string) {
  const entry = views.get(key);
  if (entry) {
    entry.rename.dispose();
    for (const host of entry.hosts.values()) {
      render(null, host);
      if (!entry.shell.contains(host)) host.remove();
    }
    render(null, entry.shell);
    entry.shell.remove();
    views.delete(key);
  }
  const unavailable = unavailableViews.get(key);
  if (unavailable) {
    render(null, unavailable.target);
    unavailableViews.delete(key);
  }
}

function mountedEntry(key: string) {
  const entry = views.get(key);
  // Inactive tabs may be detached from the document, but still own their shell.
  if (entry && !entry.shell.parentNode) {
    release(key);
    return undefined;
  }
  return entry;
}

function checkedInputs(entry: Entry) {
  return [...(entry.hosts.get('list')?.querySelectorAll<HTMLInputElement>('.sftp-check') || [])];
}

function selectedPaths(entry: Entry) {
  return checkedInputs(entry).filter(input => input.checked).map(input => input.value);
}

function selectedEntries(entry: Entry) {
  return checkedInputs(entry).filter(input => input.checked).map(input => ({
    path:input.value,
    name:input.dataset.name || input.value.split('/').pop() || input.value,
    type:input.dataset.type || 'file',
    mode:input.dataset.mode || '',
    owner:input.dataset.owner || '',
    group:input.dataset.group || '',
    size:Math.max(0, Number(input.dataset.size || 0)),
    mtime:Math.max(0, Number(input.dataset.mtime || 0)),
    metadataKnown:input.dataset.metadataKnown === '1',
    metadata_known:input.dataset.metadataKnown === '1',
    pathBytesB64:input.dataset.pathBytes || '',
    path_bytes_b64:input.dataset.pathBytes || ''
  }));
}

function syncSelection(entry: Entry) {
  const inputs = checkedInputs(entry), selected = inputs.filter(input => input.checked);
  entry.options.model.selectedPaths = selected.map(input => input.value);
  const list = entry.hosts.get('list');
  const chosen = new Set(entry.options.model.selectedPaths);
  list?.querySelectorAll<HTMLElement>('.sftp-row').forEach(row => {
    const input = row.querySelector<HTMLInputElement>('.sftp-check');
    row.classList.toggle('is-selected', Boolean(input && chosen.has(input.value)));
  });
  const selectAll = list?.querySelector<HTMLInputElement>('#sftpSelectAll');
  if (selectAll) {
    selectAll.checked = inputs.length > 0 && selected.length === inputs.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < inputs.length;
  }
  paint(entry, 'selection');
  return entry.options.model.selectedPaths;
}

type SelectableEntry = {path: string; name: string; type: string};

function setAllSelected(entry: Entry, checked: boolean) {
  if (entry.options.isCurrent?.() === false) return [];
  checkedInputs(entry).forEach(input => { input.checked = checked; });
  return syncSelection(entry);
}

function selectEntry(entry: Entry, event: SftpSelectionEvent, file: SelectableEntry, checkbox = false) {
  if (entry.options.isCurrent?.() === false) return [];
  const model = entry.options.model, inputs = checkedInputs(entry);
  const selection = sftpSelection(inputs.map(input => input.value), selectedPaths(entry), model.state.selectionAnchorPath || '', file.path, event, checkbox);
  model.state.selected = {id: model.connectionId, ...file};
  model.state.selectionAnchorPath = selection.anchor;
  const paths = new Set(selection.paths);
  inputs.forEach(input => {
    input.checked = paths.has(input.value);
    input.closest('.sftp-row')?.classList.toggle('active', input.value === file.path);
  });
  entry.options.run('selectionState', {...model.state.selected}, selection.anchor);
  return syncSelection(entry);
}

function activateEntry(entry: Entry, event: MouseEvent, file: SelectableEntry) {
  if (entry.options.isCurrent?.() === false) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.sftp-inline-rename-input')) return;
  entry.rename.cancel();
  if (target?.closest('.sftp-check, .sftp-row-actions')) return;
  event.preventDefault();
  event.stopPropagation();
  selectEntry(entry, event, file);
  return file.type === 'dir' ? entry.options.run('navigate', file.path) : entry.options.run('activateFile', file);
}



export function installSftpViews() {
  filesServices.termaSftpViews = {
    mount(target, options) {
      release(options.model.key);
      target.replaceChildren();
      const shell = document.createElement('div');
      shell.className = 'sftp-shell'; shell.dataset.sftpTabKey = options.model.key;
      for (const event of ['dragenter', 'dragover', 'dragleave', 'drop']) shell.addEventListener(event, value => options.run(event, value));
      const hosts = new Map<string, HTMLElement>();
      const host = (part: SftpPart, id: string, className: string, attrs: Record<string, unknown> = {}) => h('div', { id, class: `${className} terma-vue-root terma-sftp-root`, 'data-sftp-vue-part': part, 'data-i18n-skip': '', ...attrs });
      target.append(shell);
      render(h(Fragment, null, [h('div', { class: 'sftp-top' }, [
        h('div', { id: 'sftpToolbarMount' }, host('toolbar', '', 'sftp-toolbar', { 'data-workspace-tab-key': options.model.key })),
        h('div', { class: 'sftp-location-bar' }, [host('navigation', '', 'sftp-navigation-row'), host('favorites', 'sftpFavorites', 'sftp-favorites')]),
        host('search', 'sftpFloatingSearch', 'sftp-floating-search', { hidden: true, 'aria-busy': 'false' }),
        host('banner', 'sftpConnectionBanner', 'sftp-connection-banner', { hidden: true }), host('selection', 'sftpSelectionBar', 'sftp-selection-bar', { hidden: true })
      ]), host('list', 'sftpList', 'sftp-list', { onContextmenu: (event: MouseEvent) => options.run('directoryMenu', event) }),
        h('div', { id: 'sftpDropOverlay', class: 'sftp-drop-overlay', 'data-mode': 'upload', 'aria-hidden': 'true', hidden: true })]), shell);
      for (const part of parts) {
        const target = shell.querySelector<HTMLElement>(`[data-sftp-vue-part="${part}"]`);
        if (target) hosts.set(part, target);
      }
      const entry: Entry = { shell, hosts, options, rename: null as unknown as InlineRenameController, ui: {pathEditing:false, pathDraft:options.model.state.path, searchOpen:false, searchDraft:options.model.state.query, searchBusy:false} };
      entry.rename = createSftpInlineRenameController({
        mobile: () => entry.options.model.mobile,
        isSelected: path => entry.options.model.state.selected?.path === path,
        hasSingleSelection: () => entry.options.model.selectedPaths.length === 1,
        rename: async (item, next) => { await entry.options.run('inlineRename', item, next); },
        notify: message => { void entry.options.run('notify', message); },
        invalidName: () => entry.options.text('sftp:inline_rename.invalid_name'),
        ariaLabel: () => entry.options.text('sftp:dialogs.new_name'),
        conflictName: () => entry.options.text('errors:backend.sftp_rename_exists')
      });
      views.set(options.model.key, entry);
      for (const part of parts) paint(entry, part, part === 'list' ? { kind: 'loading' } : undefined);
      return true;
    },
    refresh(key, options, part, state) {
      const entry = mountedEntry(key); if (!entry) return false;
      entry.options = options;
      for (const name of part ? [part] : parts) paint(entry, name, name === 'list' ? state : undefined);
      return true;
    },
    capture(key) {
      const entry = mountedEntry(key);
      if (!entry) return null;
      const list = entry.hosts.get('list');
      return {
        scrollTop:Number(list?.scrollTop || 0),
        scrollLeft:Number(list?.scrollLeft || 0),
        selectedPaths:list ? [...list.querySelectorAll<HTMLInputElement>('.sftp-check:checked')].map(input => input.value) : [],
        activePath:entry.options.model.state.selected?.path || ''
      };
    },
    restore(key, state) {
      const entry = mountedEntry(key), list = entry?.hosts.get('list');
      if (!entry || !list || !state) return false;
      const paths = new Set(entry.options.model.state.entries.map(file => entry.options.path(file.name)));
      entry.options.model.selectedPaths = (state.selectedPaths || []).filter(path => paths.has(path));
      if (state.activePath && !paths.has(state.activePath)) entry.options.model.state.selected = null;
      paint(entry, 'selection');
      paint(entry, 'list');
      const restoreScroll = () => {
        list.scrollTop = Math.min(Number(state.scrollTop || 0), Math.max(0, list.scrollHeight - list.clientHeight));
        list.scrollLeft = Math.min(Number(state.scrollLeft || 0), Math.max(0, list.scrollWidth - list.clientWidth));
        list.classList.toggle('has-scroll-below', list.scrollHeight > list.scrollTop + list.clientHeight + 2);
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      return true;
    },
    selectedPaths(key) {
      const entry = mountedEntry(key);
      return entry ? selectedPaths(entry) : [];
    },
    selectedEntries(key) {
      const entry = mountedEntry(key);
      return entry ? selectedEntries(entry) : [];
    },
    updateSelection(key) {
      const entry = mountedEntry(key);
      return entry ? syncSelection(entry) : [];
    },
    clearSelection(key) {
      const entry = mountedEntry(key);
      if (!entry) return false;
      checkedInputs(entry).forEach(input => { input.checked = false; });
      syncSelection(entry);
      return true;
    },
    toggleAll(key, checked) {
      const entry = mountedEntry(key);
      return entry ? setAllSelected(entry, checked) : [];
    },
    select(key, connectionId, event, file) {
      const entry = mountedEntry(key);
      return entry?.options.model.connectionId === connectionId ? selectEntry(entry, event, file) : [];
    },
    pathEditor(key, visible) { const entry = mountedEntry(key); if (!entry) return false; pathEditor(entry, visible); return true; },
    submitPath(key) { const entry = mountedEntry(key); return entry ? submitPath(entry) : false; },
    search(key, action) { const entry = mountedEntry(key); if (!entry) return false; if (action === 'clear') clearSearch(entry); else searchVisibility(entry, action === 'toggle' && !entry.ui.searchOpen); return true; },
    searchBusy(key, busy) { const entry = mountedEntry(key); if (!entry) return false; entry.ui.searchBusy = busy; paint(entry, 'search'); return true; },
    unavailable(target, key, text) {
      release(key);
      target.replaceChildren();
      const entry = { target, text };
      unavailableViews.set(key, entry);
      paintUnavailable(key, entry);
      return true;
    },
    refreshUnavailable() { for (const [key, entry] of unavailableViews) paintUnavailable(key, entry); },
    release,
    isMounted: key => !!mountedEntry(key)
  };
  new MutationObserver(() => {
    for (const entry of views.values()) for (const host of entry.hosts.values()) host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    for (const [key, entry] of unavailableViews) paintUnavailable(key, entry);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export interface InstalledFeaturesFilesSftpSftpViewServices {
  termaSftpViews?: {
      mount(target: HTMLElement, options: SftpOptions): boolean;
      refresh(key: string, options: SftpOptions, part?: SftpPart, state?: { kind: string; detail?: string }): boolean;
      capture(key: string): SftpScrollState | null;
      restore(key: string, state: SftpScrollState | null): boolean;
      selectedPaths(key: string): string[];
      selectedEntries(key: string): ReturnType<typeof selectedEntries>;
      updateSelection(key: string): string[];
      clearSelection(key: string): boolean;
      toggleAll(key: string, checked: boolean): string[];
      select(key: string, connectionId: number, event: SftpSelectionEvent, file: SelectableEntry): string[];
      pathEditor(key: string, visible: boolean): boolean;
      submitPath(key: string): boolean;
      search(key: string, action: 'toggle' | 'close' | 'clear'): boolean;
      searchBusy(key: string, busy: boolean): boolean;
      unavailable(target: HTMLElement, key: string, text: () => UnavailableText): boolean;
      refreshUnavailable(): void;
      release(key: string): void;
      isMounted(key: string): boolean;
    };
}
