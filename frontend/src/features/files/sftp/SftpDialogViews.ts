import { h, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import type { SftpDialogActions, SftpDialogModel, SftpDirectoryNode } from './sftp-dialog-types';
import { sftpFilePresentation } from './file-kind';
import { SftpPrincipalPicker } from './SftpPrincipalPicker';
import { principalLabel } from './permission-principals';

export function sftpDialogView(m: SftpDialogModel, a: SftpDialogActions) {
  const t = m.tr;
  const button = (id: string, label: string, action: () => void, glyph = '', className = '', disabled = m.busy) =>
    h(TermaButton, { id, type: 'button', class: className, disabled, title: label, 'aria-label': label, onClick: action }, () => [glyph ? icon(glyph) : null, className.includes('icon-button') ? null : h('span', null, label)]);
  const input = (id: string, key: keyof SftpDialogModel, attrs: Record<string, unknown> = {}) => h('input', {
    id, value: m[key], disabled: m.busy, autocomplete: 'off', ...attrs,
    onInput: (event: Event) => a.change(key, (event.target as HTMLInputElement).value)
  });
  const check = (id: string, key: keyof SftpDialogModel, text: string) => h('label', { class: 'check-row', for: id }, [
    h('input', { id, type: 'checkbox', checked: m[key], disabled: m.busy, onChange: (event: Event) => a.change(key, (event.target as HTMLInputElement).checked) }), h('span', null, text)
  ]);
  const state = (kind: string, title: string, detail = '', retry?: () => void) => h('div', { class: ['ui-state', kind], role: kind === 'error' ? 'alert' : 'status' }, [
    icon(kind === 'loading' ? 'loader-circle' : kind === 'error' ? 'circle-alert' : 'folder'), h('strong', null, title), detail ? h('span', null, detail) : null,
    retry ? button('', t('common:actions.retry'), retry, 'refresh-cw', '', false) : null
  ]);
  const footer = (confirm: string, id: string, disabled = m.busy, danger = false) => h('div', { class: 'actions' }, [
    button(m.kind === 'permissions' ? 'sftpPermissionCancel' : m.kind === 'archive' ? 'sftpArchiveCancel' : 'modalCancelBtn', t('common:actions.cancel'), a.close), button(id, confirm, a.submit, m.busy ? 'loader-circle' : '', danger ? 'danger' : 'primary', disabled)
  ]);
  const head = (title: string, summary = '') => h('div', { class: 'sftp-modal-head' }, [h('div', null, [h('h2', { id: 'sftpDialogTitle' }, title), summary ? h('span', null, summary) : null]),
    button('sftpDialogClose', t('common:actions.close'), a.close, 'x', 'icon-button')]);
  const error = m.error ? h('div', { id: 'sftpDialogError', class: 'sftp-dialog-error', role: 'alert' }, m.error) : null;
  const confirmation = m.confirmation?.();
  const confirmationView = confirmation ? h('section', { class: 'sftp-dialog-confirmation', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sftpConfirmationTitle' }, [
    h('h2', { id: 'sftpConfirmationTitle' }, confirmation.title), h('div', { class: 'modal-message' }, confirmation.message),
    h('div', { class: 'actions' }, [button('sftpConfirmationCancel', t('common:actions.cancel'), a.cancelConfirmation), button('sftpConfirmationApply', confirmation.confirm, a.submit, '', confirmation.danger ? 'danger' : 'primary')])
  ]) : null;
  let content: VNodeChild[] = [];
  let className = '';
  if (m.kind === 'input') content = [head(t(m.titleKey)), h('label', { for: 'modalInputValue' }, t(m.labelKey)), input('modalInputValue', 'value', { 'aria-invalid': m.error ? 'true' : undefined, 'aria-describedby': m.error ? 'sftpDialogError' : undefined }), error, footer(t('common:auto.confirm'), 'modalConfirmBtn')];
  if (m.kind === 'text') {
    className = 'wide web-files-editor';
    content = [head(m.filename, m.path), h('label', {for:'fileTextContent'}, t('sftp:web_files.content')),
      h('textarea', {id:'fileTextContent', value:m.value, readonly:m.readOnly, disabled:m.busy, spellcheck:false, 'data-i18n-skip':'', 'aria-label':t('sftp:web_files.content'), 'aria-invalid':m.error?'true':undefined, 'aria-describedby':m.error?'sftpDialogError':undefined,
        onInput:(event:Event)=>a.change('value',(event.target as HTMLTextAreaElement).value)}), error,
      h('div', {class:'actions'}, [button('fileTextCancel', t('common:actions.cancel'), a.close), button('fileTextSave', t('common:actions.save'), a.submit, m.busy?'loader-circle':'save', 'primary', m.busy||m.readOnly)])];
  }
  if (m.kind === 'confirm') content = [confirmationView];
  if (m.kind === 'permissions') {
    className = 'wide sftp-permission-modal';
    const mode = /^[0-7]{3}$/.test(m.mode);
    const principalHint = (kind: 'owner' | 'group') => {
      const value = kind === 'owner' ? m.originalOwner : m.originalGroup;
      if (!value) return t('sftp:permissions_editor.blank_unchanged');
      const resolved = principalLabel(value, kind === 'owner' ? m.principals.users : m.principals.groups, kind);
      if (resolved !== value) return t(`sftp:permissions_editor.${kind}_current_name`, { value: resolved });
      const numeric = /^\d+$/.test(value);
      return t(`sftp:permissions_editor.${kind}_current_${numeric ? (kind === 'owner' ? 'uid' : 'gid') : 'name'}`, { value });
    };
    content = [head(t('sftp:menu.permissions'), t('sftp:permissions_editor.item_count', { count: m.count }) + (m.mixedMode ? t('sftp:permissions_editor.mixed_suffix') : '')),
      h('div', { class: 'sftp-permission-groups' }, ['owner', 'group', 'public'].map((prefix, index) => h('fieldset', { class: 'sftp-permission-group' }, [
        h('legend', null, t(`sftp:permissions_editor.${prefix}`)), ...[['read', 4], ['write', 2], ['execute', 1]].map(([label, bit]) => h('label', null, [
          h('input', { type: 'checkbox', disabled: m.busy, 'data-permission': `${prefix}${String(label)[0].toUpperCase()}${String(label).slice(1)}`,
            checked: Boolean((Number(m.mode[index]) || 0) & Number(bit)), onChange: (event: Event) => a.permission(prefix, Number(bit), (event.target as HTMLInputElement).checked) }), h('span', null, t(`sftp:auto.${label}`))
        ]))
      ]))),
      h('div', { class: 'sftp-permission-fields' }, [
        h('label', { for: 'sftpPermissionMode' }, [t('sftp:permissions_editor.mode'), input('sftpPermissionMode', 'mode', { inputmode: 'numeric', maxlength: 3, placeholder: t('sftp:permissions_editor.mode_example') }), h('span', null, t('sftp:permissions_editor.octal_hint'))]),
        ...(['owner', 'group'] as const).map(key => h('div', { class: 'sftp-permission-principal-field' }, [
          h('label', { for: key === 'owner' ? 'sftpPermissionOwner' : 'sftpPermissionGroup' }, t(`sftp:permissions_editor.${key}`)), h(SftpPrincipalPicker, { id: key === 'owner' ? 'sftpPermissionOwner' : 'sftpPermissionGroup', value: m[key], kind: key,
            items: key === 'owner' ? m.principals.users : m.principals.groups, disabled: m.busy, label: t(`sftp:permissions_editor.choose_${key}`),
            placeholder: t('sftp:permissions_editor.blank_unchanged'), emptyText: t(m.principalsLoading ? 'sftp:permissions_editor.accounts_loading' : 'sftp:permissions_editor.accounts_unavailable'), onChange: (value: string) => a.change(key, value) }),
          h('span', { class: 'sftp-permission-principal' }, principalHint(key))
        ]))
      ]), m.hasDirectory ? check('sftpPermissionRecursive', 'recursive', t('sftp:permissions_editor.recursive')) : null,
      h('p', { class: 'sftp-permission-note' }, t('sftp:permissions_editor.note')),
      h('div', { id: 'sftpPermissionStatus', class: ['sftp-permission-status', m.busy ? 'busy' : ''], role: 'status', 'aria-live': 'polite' }, t(m.busy ? 'sftp:permissions_editor.connecting' : 'sftp:permissions_editor.waiting')),
      error, footer(t(m.busy ? 'sftp:permissions_editor.applying' : 'common:actions.apply'), 'sftpPermissionApply', m.busy || !mode)
    ];
  }
  if (m.kind === 'archive') {
    className = 'sftp-archive-options-modal';
    const extracting = m.archiveMode === 'extract';
    const label = t(extracting ? 'sftp:menu.extract' : m.archiveMode === 'download' ? 'sftp:transfer.download_archive' : 'sftp:menu.compress');
    const nodes = (items: SftpDirectoryNode[], depth = 0): VNodeChild => items.map(node => h('div', { key: node.path, class: 'sftp-dialog-tree-node' }, [
      h('div', { class: 'sftp-dialog-tree-row', style: { paddingInlineStart: `${depth * 14}px` } }, [
        button('', t(node.expanded ? 'sftp:dialogs.collapse_directory' : 'sftp:dialogs.expand_directory', { name: node.name }), () => a.expand(node), node.loading ? 'loader-circle' : node.expanded ? 'chevron-down' : 'chevron-right', 'icon-button', m.busy || node.loading),
        button('', node.name, () => a.browse('load', node.path), 'folder', 'sftp-dialog-directory', m.busy)
      ]), node.expanded ? h('div', null, [node.error ? h('div', { class: 'sftp-dialog-error' }, node.error) : null, nodes(node.children, depth + 1)]) : null
    ]));
    content = [head(t(m.titleKey || (extracting ? 'sftp:archive.extract_title' : m.archiveMode === 'download' ? 'sftp:archive.download_title' : 'sftp:archive.compress_title')), m.path),
      h('div', { class: 'sftp-archive-form' }, [extracting ? [
        h('label', { for: 'sftpArchiveTarget' }, t('sftp:archive.target_directory')),
        h('div', { class: 'upload-line' }, [input('sftpArchiveTarget', 'target'), button('sftpArchiveBrowse', t('sftp:archive.choose_directory'), () => a.browse('toggle'), 'folder-open')]),
        h('div', { id: 'sftpArchiveBrowser', class: 'sftp-archive-browser', hidden: !m.browser }, [
          h('div', { class: 'sftp-dialog-browser-tools' }, [button('sftpArchiveBrowserRoot', t('sftp:auto.root_directory'), () => a.browse('load', '/'), 'hard-drive'),
            button('sftpArchiveBrowserParent', t('sftp:auto.parent_directory'), () => a.browse('parent'), 'corner-left-up', 'icon-button'),
            button('sftpArchiveBrowserRefresh', t('common:actions.refresh'), () => a.browse('refresh'), 'refresh-cw', 'icon-button'),
            button('sftpArchiveBrowserNew', t('sftp:operations.new_directory'), () => a.browse('new'), 'folder-plus', 'icon-button')]),
          h('code', { id: 'sftpArchiveBrowserPath' }, m.browserPath === '.' ? t('sftp:dialogs.login_directory') : m.browserPath),
          m.newDirectory ? h('div', { class: 'upload-line' }, [input('sftpArchiveNewName', 'newName', { placeholder: t('sftp:operations.directory_name') }), button('sftpArchiveNewConfirm', t('common:auto.confirm'), () => a.browse('mkdir'), 'folder-plus')]) : null,
          h('div', { id: 'sftpArchiveBrowserList', class: 'sftp-archive-browser-list' }, [m.browserLoading ? state('loading', t('sftp:auto.loading_directory')) : m.browserError ? state('error', t('sftp:archive.directory_read_failed'), m.browserError, () => a.browse('refresh')) : m.directories.length ? nodes(m.directories) : state('empty', t('sftp:archive.no_subdirectories'))]),
          button('sftpArchiveBrowserSelect', t('sftp:archive.select_current_directory'), () => a.browse('select'), 'folder-check', '', m.busy || m.browserLoading || !!m.browserError)
        ])
      ] : [h('label', { for: 'sftpArchiveFilename' }, t('sftp:dialogs.archive_name')), input('sftpArchiveFilename', 'filename')],
      h('label', { for: 'sftpArchiveEncoding' }, t('sftp:archive.filename_encoding')),
      h('select', { id: 'sftpArchiveEncoding', value: m.encoding, disabled: m.busy, onChange: (event: Event) => a.change('encoding', (event.target as HTMLSelectElement).value) }, [
        h('option', { value: 'default' }, t('sftp:archive.default_encoding')), ...m.encodings.map(([value, text]) => h('option', { value }, text))]),
      extracting ? [check('sftpArchiveOverwrite', 'overwrite', t('sftp:archive.overwrite_existing')), check('sftpArchiveNamedFolder', 'namedFolder', t('sftp:archive.extract_named_folder'))] : null
      ]), error, footer(label, 'sftpArchiveConfirm')];
  }
  if (m.kind === 'recycle') {
    className = 'wide sftp-recycle-modal';
    const data = m.recycle;
    content = [h('div', { hidden: !!confirmation }, [head(t('sftp:recycle_bin.title'), data ? t('sftp:recycle_bin.summary', { state: t(data.enabled ? 'sftp:recycle_bin.enabled' : 'sftp:recycle_bin.disabled'), count: data.total }) : m.browserLoading ? t('sftp:recycle_bin.loading_remote') : undefined),
      h('div', { id: 'sftpRecycleList', class: 'sftp-recycle-list' }, !data && m.browserLoading ? state('loading', t('sftp:recycle_bin.loading')) : !data && m.error ? state('error', t('sftp:recycle_bin.load_failed'), m.error, () => a.recycle('load')) : data?.items.length ? [
        ...data.items.map(item => h('div', { key: `${item.storage || 'terma'}:${item.id}`, class: 'sftp-recycle-item' }, [
          (() => { const file = sftpFilePresentation(item.name || item.original_path, item.type || 'file'); return h('span', { class: ['sftp-icon', 'sftp-recycle-icon', file.kind], 'data-item-type': item.type === 'dir' ? 'dir' : 'file' }, [icon(file.glyph), file.badge ? h('small', null, file.badge) : null]); })(),
          h('div', null, [h('strong', { title: item.original_path }, item.name || item.original_path), h('span', null, item.original_path), h('small', null, t('sftp:recycle_bin.deleted_at', { date: item.deleted_at ? new Date(item.deleted_at).toLocaleString(document.documentElement.lang || undefined) : t('sftp:recycle_bin.unknown_time'), legacy: item.storage === 'tunneldesk' ? t('sftp:recycle_bin.legacy_suffix') : '' }))]),
          h('div', { class: 'actions tight' }, [button('', t('sftp:recycle_bin.restore'), () => a.recycle('restore', item), 'undo-2'), button('', t('sftp:recycle_bin.permanent_delete'), () => a.recycle('delete', item), 'trash-2', 'danger')])
        ])), data.total_pages > 1 ? h('div', { class: 'pager sftp-recycle-pager' }, [button('sftpRecyclePrevious', t('common:auto.previous_page'), () => a.recycle('load', undefined, data.page - 1), '', '', m.busy || data.page <= 1), h('span', null, t('common:auto.page_of', { page: data.page, pages: data.total_pages })), button('sftpRecycleNext', t('common:auto.next_page'), () => a.recycle('load', undefined, data.page + 1), '', '', m.busy || data.page >= data.total_pages)]) : null
      ] : state('empty', t('sftp:recycle_bin.empty'), t(data?.enabled ? 'sftp:recycle_bin.empty_enabled_hint' : 'sftp:recycle_bin.empty_disabled_hint'))),
      data && m.error ? error : null,
      h('div', { class: 'actions' }, [data?.items.length ? button('sftpRecycleClear', t('sftp:recycle_bin.clear'), () => a.recycle('clear'), 'trash-2', 'danger') : null, button('', t('common:actions.refresh'), () => a.recycle('load'), 'refresh-cw'), button('sftpRecycleClose', t('common:actions.close'), a.close)])]),
      confirmationView];
  }
  return h('div', { class: ['modal-card sftp-vue-dialog', className], role: m.kind === 'confirm' ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': confirmation ? 'sftpConfirmationTitle' : 'sftpDialogTitle', 'aria-busy': m.busy }, content);
}
