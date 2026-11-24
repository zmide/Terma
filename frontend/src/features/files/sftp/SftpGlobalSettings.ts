import {filesServices} from '@/features/files/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { h, render, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { runtimePreferences } from '@/features/settings/runtime-settings-model';
import { requestDownloadDirectory } from './download-location';
import '@/styles/sftp-global-settings.css';

type Api = (url: string, options?: { method?: string; body?: string }) => Promise<any>;
type Translate = (key: string, params?: Record<string, unknown>) => string;
type Notify = (message: string, kind?: string) => void;
type DownloadSettings = {
  delivery_mode?: string;
  configured_directory?: string;
  effective_directory?: string;
  default_directory?: string;
};
type SavedSettings = {
  sftp_recycle_bin_enabled?: boolean;
  sftp_max_open_file_size_mb?: number;
  sftp_text_editor_mode?: string;
  sftp_double_click_file_action?: string;
  sftp_light_editor_threshold_mb?: number;
  sftp_download_concurrency?: number;
  sftp_upload_concurrency?: number;
  sftp_external_edit_save_rule?: string;
  sftp_external_edit_backup_enabled?: boolean;
};
type RuntimeSettings = { saved?: SavedSettings } & SavedSettings;
type OpenOptions = {
  api: Api;
  tr: Translate;
  notify: Notify;
  desktop: boolean;
  runtimeSettings?: RuntimeSettings | null;
};

type Model = {
  tab: 'general' | 'editor' | 'transfer';
  saved: SavedSettings;
  download: DownloadSettings;
  busy: boolean;
  loading: boolean;
  error: string;
  externalEditorMode: string;
  externalEditorPath: string;
  externalEditorArgs: string;
  downloadDirectory: string;
  lightThreshold: string;
  saveRule: string;
  backupEnabled: boolean;
  recycleEnabled: boolean;
  maxOpenFileSize: string;
  editorMode: string;
  doubleClickAction: string;
  downloadConcurrency: string;
  uploadConcurrency: string;
};

type Owner = { modal: HTMLElement; host: HTMLElement; options: OpenOptions; trigger: HTMLElement | null; model: Model; cleanup: () => void };
let current: Owner | null = null;
let openRevision = 0;

function savedFrom(value: RuntimeSettings | null | undefined): SavedSettings {
  return { ...(value?.saved || value || {}) };
}
function text(options: OpenOptions, key: string, params?: Record<string, unknown>) {
  return options.tr(key, params);
}
function icon(name: string): VNodeChild { return settingsIcon(name); }
function inputValue(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
function checkboxValue(event: Event) { return (event.target as HTMLInputElement).checked; }

function button(label: string, click: (event: MouseEvent) => unknown, className = '', disabled = false, glyph = '') {
  const content = glyph ? [icon(glyph), className === 'icon-button' ? null : h('span', null, label)] : label;
  return h('button', { type: 'button', class: className, disabled, title: label, 'aria-label': label, onClick: click }, content);
}

function renderView(owner: Owner) {
  const { options, model: m } = owner;
  const t = (key: string, params?: Record<string, unknown>) => text(options, key, params);
  const desktop = options.desktop && m.download.delivery_mode === 'desktop';
  const lightAuto = m.editorMode === 'auto';
  const overwrite = m.saveRule === 'overwrite';
  const tab = (key: Model['tab'], glyph: string, label: string) => h('button', {
    type: 'button', role: 'tab', class: { active: m.tab === key }, 'aria-selected': m.tab === key,
    onClick: () => { m.tab = key; paint(owner); }
  }, [icon(glyph), h('span', null, label)]);
  const section = (glyph: string, title: string, children: VNodeChild[]) => h('div', { class: 'terminal-settings-section' }, [h('h3', null, [icon(glyph), h('span', null, title)]), ...children]);
  const label = (labelText: string, control: VNodeChild) => h('label', null, [h('span', null, labelText), control]);
  const muted = (value: string) => h('div', { class: 'muted' }, value);
  const field = (id: string, value: string, type = 'text', attrs: Record<string, unknown> = {}) => h('input', { id, type, value, ...attrs });
  const select = (id: string, value: string, values: Array<[string, string]>, onChange: (event: Event) => void, attrs: Record<string, unknown> = {}) => h('select', { id, value, ...attrs, onChange }, values.map(([value, label]) => h('option', { value }, label)));
  const checkbox = (id: string, checked: boolean, onChange: (event: Event) => void, labelText: string) => h('label', { class: 'check-row' }, [h('input', { id, type: 'checkbox', checked, onChange }), h('span', null, labelText)]);
  const content: VNodeChild[] = [
    h('div', { class: 'terminal-settings-head' }, [h('div', null, [h('h2', { id: 'sftpGlobalSettingsTitle' }, t('sftp:settings.title')), h('span', null, t('sftp:settings.scope'))]), button(t('common:actions.close'), () => close(), 'icon-button', false, 'x')]),
    h('div', { class: 'terminal-settings-tabs', role: 'tablist', 'aria-label': t('sftp:settings.categories') }, [
      tab('general', 'settings-2', t('sftp:settings.general')),
      tab('editor', 'file-pen-line', t('sftp:settings.editor')),
      tab('transfer', 'arrow-left-right', t('sftp:settings.transfer'))
    ]),
    h('div', { class: 'terminal-settings-panels' }, [
      m.tab === 'general' ? h('section', { class: 'terminal-settings-panel', role: 'tabpanel' }, [
        h('div', { class: 'terminal-settings-grid' }, [
          section('trash-2', t('sftp:settings.remote_delete'), [checkbox('sftpRecycleBinEnabled', m.recycleEnabled, e => { m.recycleEnabled = checkboxValue(e); }, t('sftp:settings.recycle_first')), muted(t('sftp:settings.recycle_hint'))]),
          section('file-search', t('sftp:settings.file_open'), [label(t('sftp:settings.open_limit'), field('sftpMaxOpenFileSizeMb', m.maxOpenFileSize, 'number', { min: 1, max: 100, step: 1, onInput: (e: Event) => { m.maxOpenFileSize = inputValue(e); } })), muted(t('sftp:settings.open_limit_hint'))])
        ]),
        h('div', { class: 'warning warning-with-icon' }, [icon('triangle-alert'), h('span', null, t('sftp:settings.recycle_warning'))])
      ]) : null,
      m.tab === 'editor' ? h('section', { class: 'terminal-settings-panel', role: 'tabpanel' }, [
        h('div', { class: 'terminal-settings-grid' }, [
          section('file-code-2', t('sftp:settings.builtin_editor'), [
            label(t('sftp:settings.double_click_action', { defaultValue: '双击文件' }), select('sftpDoubleClickFileAction', m.doubleClickAction, [['internal', t('sftp:settings.double_click_internal', { defaultValue: '使用内部编辑器' })], ['external', t('sftp:settings.double_click_external', { defaultValue: '使用外部编辑器' })]], e => { m.doubleClickAction = inputValue(e); })),
            muted(t('sftp:settings.double_click_hint', { defaultValue: '外部编辑器仅在桌面版可用；Web 版会回退到内部编辑器或预览。' })),
            label(t('sftp:settings.text_editor'), select('sftpTextEditorMode', m.editorMode, [['ace', t('sftp:settings.ace_always')], ['auto', t('sftp:settings.light_auto')], ['light', t('sftp:settings.light_always')]], e => { m.editorMode = inputValue(e); paint(owner); })),
            lightAuto ? h('div', { id: 'sftpLightEditorThresholdFields' }, label(t('sftp:settings.light_threshold'), field('sftpLightEditorThresholdMb', m.lightThreshold, 'number', { min: 1, max: 100, step: 1, onInput: (e: Event) => { m.lightThreshold = inputValue(e); } }))) : null,
            muted(t('sftp:settings.light_hint'))
          ]),
          section('external-link', t('sftp:settings.external_editor'), [desktop ? [
            label(t('sftp:settings.external_editor'), select('sftpExternalEditorMode', m.externalEditorMode, [['system', t('sftp:settings.system_program')], ['vscode', t('sftp:settings.vscode')], ['custom', t('sftp:settings.custom_program')]], e => { m.externalEditorMode = inputValue(e); paint(owner); })),
            m.externalEditorMode === 'custom' ? h('div', { id: 'sftpExternalEditorCustom' }, [label(t('sftp:settings.program_path'), field('sftpExternalEditorPath', m.externalEditorPath, 'text', { placeholder: t('sftp:settings.program_path_placeholder'), onInput: (e: Event) => { m.externalEditorPath = inputValue(e); } })), label(t('sftp:settings.launch_args'), field('sftpExternalEditorArgs', m.externalEditorArgs, 'text', { placeholder: t('sftp:settings.launch_args_placeholder'), onInput: (e: Event) => { m.externalEditorArgs = inputValue(e); } }))]) : null,
            label(t('sftp:settings.save_rule'), select('sftpExternalEditSaveRule', m.saveRule, [['prompt', t('sftp:settings.save_prompt')], ['overwrite', t('sftp:settings.overwrite_remote')]], e => { m.saveRule = inputValue(e); paint(owner); })),
            overwrite ? checkbox('sftpExternalEditBackupEnabled', m.backupEnabled, e => { m.backupEnabled = checkboxValue(e); }, t('sftp:settings.backup_before_overwrite')) : null
          ] : muted(t('sftp:settings.desktop_only'))])
        ])
      ]) : null,
      m.tab === 'transfer' ? h('section', { class: 'terminal-settings-panel', role: 'tabpanel' }, [
        h('div', { class: 'terminal-settings-grid' }, [
          section('gauge', t('sftp:settings.concurrent_tasks'), [h('div', { class: 'terminal-settings-field-grid' }, [label(t('sftp:settings.simultaneous_downloads'), field('sftpDownloadConcurrency', m.downloadConcurrency, 'number', { min: 1, max: 8, step: 1, onInput: (e: Event) => { m.downloadConcurrency = inputValue(e); } })), label(t('sftp:settings.simultaneous_uploads'), field('sftpUploadConcurrency', m.uploadConcurrency, 'number', { min: 1, max: 8, step: 1, onInput: (e: Event) => { m.uploadConcurrency = inputValue(e); } }))]), muted(t('sftp:settings.concurrency_hint'))]),
          section('folder-down', t('sftp:settings.download_location'), [desktop ? [label(t('sftp:settings.auto_save_directory'), h('div', { class: 'upload-line' }, [h('input', { id: 'sftpDownloadDirectory', value: m.downloadDirectory, placeholder: t('sftp:settings.system_download_placeholder'), onInput: (e: Event) => { m.downloadDirectory = inputValue(e); } }), button(t('sftp:settings.choose_directory'), () => void chooseDirectory(owner), '', m.busy, 'folder-open')])), h('div', { id: 'sftpDownloadDirectoryEffective', class: 'muted' }, t('sftp:settings.current_save_directory', { path: m.download.effective_directory || m.download.default_directory || t('sftp:settings.system_download_directory') })), h('div', { class: 'actions compact' }, [button(t('sftp:settings.restore_default'), () => { m.downloadDirectory = ''; paint(owner); }), button(t('sftp:settings.open_directory'), () => void openDirectory(owner), '', m.busy, 'folder-open')])] : muted(t('sftp:settings.browser_download_hint'))])
        ])
      ]) : null
    ]),
    h('div', { class: 'actions terminal-settings-actions' }, [button(t('common:actions.cancel'), () => close()), button(t('sftp:settings.save'), () => void save(owner), 'primary', m.busy, 'save')])
  ];
  owner.host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  render(h('div', { class: 'modal-card terminal-settings-modal sftp-global-settings-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sftpGlobalSettingsTitle', 'aria-busy': m.busy }, content), owner.host);
}

function paint(owner: Owner) { if (current === owner) renderView(owner); }
function disposeOwner(owner: Owner) {
  current = null;
  owner.cleanup();
  render(null, owner.host);
  owner.host.remove();
}
function release() {
  openRevision += 1;
  if (current) disposeOwner(current);
}
function close() {
  const owner = current;
  if (owner?.model.busy) return;
  release();
  if (!owner) return;
  owner.modal.hidden = true;
  owner.trigger?.focus({ preventScroll: true });
}
async function chooseDirectory(owner: Owner) {
  try { const result = await owner.options.api('/api/sftp/download-settings/choose', { method: 'POST', body: '{}' }); if (result?.path) { owner.model.downloadDirectory = result.path; paint(owner); } }
  catch (error: any) { owner.options.notify(error?.message || owner.options.tr('settings:auto.directory_choose_failed'), 'error'); }
}
async function openDirectory(owner: Owner) {
  try { await requestDownloadDirectory('', owner.options.api); }
  catch (error: any) { owner.options.notify(error?.message || owner.options.tr('sftp:settings.open_directory_failed'), 'error'); }
}
function numberValue(value: string, min: number, max: number) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : null; }
async function save(owner: Owner) {
  if (current !== owner || owner.model.busy) return;
  const m = owner.model, o = owner.options;
  const max = numberValue(m.maxOpenFileSize, 1, 100), threshold = numberValue(m.lightThreshold, 1, 100), downloads = numberValue(m.downloadConcurrency, 1, 8), uploads = numberValue(m.uploadConcurrency, 1, 8);
  if (max == null) return o.notify(o.tr('sftp:settings.open_limit_invalid'), 'error');
  if (threshold == null) return o.notify(o.tr('sftp:settings.light_threshold_invalid'), 'error');
  if (downloads == null) return o.notify(o.tr('sftp:settings.download_concurrency_invalid'), 'error');
  if (uploads == null) return o.notify(o.tr('sftp:settings.upload_concurrency_invalid'), 'error');
  m.busy = true; paint(owner);
  try {
    if (o.desktop) {
      localStorage.setItem('sftpExternalEditorMode', m.externalEditorMode);
      localStorage.setItem('sftpExternalEditorPath', m.externalEditorPath.trim());
      localStorage.setItem('sftpExternalEditorArgs', m.externalEditorArgs.trim());
    }
    const result = await o.api('/api/runtime-settings', { method: 'PUT', body: JSON.stringify({
      sftp_recycle_bin_enabled: m.recycleEnabled, sftp_max_open_file_size_mb: max, sftp_text_editor_mode: m.editorMode,
      sftp_double_click_file_action: m.doubleClickAction, sftp_light_editor_threshold_mb: threshold,
      sftp_download_concurrency: downloads, sftp_upload_concurrency: uploads,
      sftp_external_edit_save_rule: m.saveRule || 'prompt', sftp_external_edit_backup_enabled: m.backupEnabled,
      ...(m.download.delivery_mode === 'desktop' ? { sftp_download_directory: m.downloadDirectory.trim() } : {})
    }) });
    if (current !== owner) return;
    m.saved = savedFrom(result);
    m.download = await o.api('/api/sftp/download-settings').catch(() => m.download);
    if (current === owner) o.notify(o.tr('settings:auto.sftp_saved'), 'success');
  } catch (error: any) {
    if (current === owner) o.notify(error?.message || o.tr('settings:auto.sftp_save_failed'), 'error');
  } finally {
    m.busy = false;
    paint(owner);
  }
}

function buildModel(options: OpenOptions, runtime: RuntimeSettings, download: DownloadSettings): Model {
  const saved = savedFrom(runtime);
  return {
    tab: 'general', saved, download, busy: false, loading: false, error: '',
    externalEditorMode: localStorage.getItem('sftpExternalEditorMode') || 'system',
    externalEditorPath: localStorage.getItem('sftpExternalEditorPath') || '',
    externalEditorArgs: localStorage.getItem('sftpExternalEditorArgs') || '',
    downloadDirectory: download.configured_directory || '',
    lightThreshold: String(saved.sftp_light_editor_threshold_mb || 10),
    saveRule: saved.sftp_external_edit_save_rule === 'overwrite' ? 'overwrite' : 'prompt',
    backupEnabled: saved.sftp_external_edit_backup_enabled !== false,
    recycleEnabled: saved.sftp_recycle_bin_enabled === true,
    maxOpenFileSize: String(saved.sftp_max_open_file_size_mb || 50),
    editorMode: ['auto', 'light'].includes(saved.sftp_text_editor_mode || '') ? String(saved.sftp_text_editor_mode) : 'ace',
    doubleClickAction: saved.sftp_double_click_file_action === 'external' ? 'external' : 'internal',
    downloadConcurrency: String(saved.sftp_download_concurrency || 3),
    uploadConcurrency: String(saved.sftp_upload_concurrency || 3)
  };
}

export function installSftpGlobalSettings() {
  filesServices.termaSftpGlobalSettings = {
    open: async (options: OpenOptions = {api, tr, notify, desktop: Boolean(window.termaDesktop), runtimeSettings: runtimePreferences.snapshot}) => {
      const modal = document.getElementById('modal');
      if (!modal || current?.model.busy) return;
      close();
      const revision = ++openRevision;
      const initialChild = modal.firstChild;
      const initialHidden = modal.hidden;
      const ownsRequest = () => revision === openRevision && modal.isConnected
        && modal.firstChild === initialChild && modal.hidden === initialHidden;
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const runtime = options.runtimeSettings || await options.api('/api/runtime-settings').catch(() => ({ saved: {} }));
      if (!ownsRequest()) return;
      const download = await options.api('/api/sftp/download-settings').catch(() => ({ delivery_mode: 'browser' }));
      if (!ownsRequest()) return;
      unmountSettingsDialog();
      workspaceServices.termaWorkspaceViews?.unmountDialog();
      const host = document.createElement('div'); host.className = 'terma-vue-root terma-sftp-settings-root'; host.setAttribute('data-i18n-skip', '');
      modal.replaceChildren(host); modal.hidden = false;
      const model = buildModel(options, runtime, download);
      const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
      const languageChanged = () => paint(owner);
      const observer = new MutationObserver(() => {
        if (current === owner && (modal.hidden || host.parentElement !== modal)) release();
      });
      modal.addEventListener('keydown', keydown); window.addEventListener('terma:language-changed', languageChanged); observer.observe(modal, { attributes: true, attributeFilter: ['hidden'], childList: true });
      const owner: Owner = { modal, host, options, trigger, model, cleanup: () => { modal.removeEventListener('keydown', keydown); window.removeEventListener('terma:language-changed', languageChanged); observer.disconnect(); } };
      current = owner; paint(owner); queueMicrotask(() => host.querySelector<HTMLElement>('input,select,button')?.focus());
    },
    close,
    release
  };
}



export interface InstalledFeaturesFilesSftpSftpGlobalSettingsServices {
  termaSftpGlobalSettings?: { open(options?: OpenOptions): Promise<void>; close(): void; release(): void }
}
