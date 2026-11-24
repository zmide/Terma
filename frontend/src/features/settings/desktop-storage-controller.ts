import {settingsServices} from '@/features/settings/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {apiErrorFromResponse} from '@/shared/api/public-errors';
import {notify} from '@/features/efficiency/notification-actions';
import {$} from '@/shared/workspace-dom';
import { captureWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { openSettingsDialog, refreshSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { chooseModal, confirmModal } from '@/shared/workspace-prompts';
import { errorMessage } from '../operations/operations-types';
import type { WorkspaceRequestOptions } from '../../shared/api/workspace-request';

export interface DesktopSettings {
  available?: boolean;
  base_dir?: string;
  storage_management_available?: boolean;
  project_mode_available?: boolean;
  paths?: {dataDir?: string; sshDir?: string};
  storage?: {root?: string; data_dir?: string};
  settings?: Partial<Omit<DesktopStorageDraft, 'migrateData'>>;
  xserver?: {display?: string; available?: boolean; installed?: boolean};
  vnc_client?: {configured_path?: string; available?: boolean; requires_selection?: boolean; client?: string; executable?: string};
}

interface DesktopStorageDraft {
  dataMode: string;
  customDataDir: string;
  migrateData: boolean;
  openAtLogin: boolean;
  minimizeToTray: boolean;
  startMinimizedToTray: boolean;
  showStartupNotification: boolean;
  xServerAutoStart: boolean;
}

interface DirectoryListing {
  current: string;
  parent: string;
  roots: {name: string; path: string}[];
  directories: {name: string; path: string}[];
}

let desktopSettings: DesktopSettings | null = null;
let desktopRead = 0;

const endpoint = '/api/desktop-settings';
const saveKey = 'settings:storage:save';
const input = (id: string) => $(id) as HTMLInputElement | null;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const post = {method: 'POST', body: '{}'};
const report = (error: unknown, fallback: string) => notify(errorMessage(error, '') || tr(fallback), 'error');

async function load() {
  const read = ++desktopRead;
  const value = await api<DesktopSettings>(endpoint).catch(() => ({available: false}));
  if (read === desktopRead) desktopSettings = value;
  return desktopSettings;
}

async function openStorageDirectoryBrowser(startPath = '', field = input('webStorageRoot')) {
  const modal = $('modal');
  if (!modal || !field) return;
  const requested = startPath || field.value.trim() || desktopSettings?.storage?.root || desktopSettings?.base_dir || '';
  const origin = modal.firstElementChild, wasHidden = modal.hidden;
  const request = settingsServices.termaSettingsRequests.directory.begin();
  const current = () => request.current() && field.isConnected && field.checkVisibility()
    && modal.firstElementChild === origin && modal.hidden === wasHidden;
  try {
    const listing = await api<DirectoryListing>(`/api/storage/directories?path=${encodeURIComponent(requested)}`, {signal: request.signal});
    if (!current()) return;
    const values = {
      listing,
      navigate: (path: string) => openStorageDirectoryBrowser(path, field),
      select: () => {
        if (field.isConnected && field.checkVisibility()) field.value = listing.current;
        closeModal();
      }
    };
    if (modal.dataset.termaSettingsDialog === 'directory') refreshSettingsDialog(values);
    else openSettingsDialog('directory', values);
  } catch (error) {
    if (current() && (error as Error | null)?.name !== 'AbortError') report(error, 'settings:auto.directory_read_failed');
  } finally { request.finish(); }
}

export async function waitForStorageRestart(expectedDataDir: string | undefined, port = {fetch, delay, reload: () => location.reload()}) {
  await port.delay(900);
  for (let attempt = 0; attempt < 60; attempt++) {
    let response: Response | undefined;
    try { response = await port.fetch(`${endpoint}?restart=${Date.now()}`, {cache: 'no-store', signal: AbortSignal.timeout(2000)}); }
    catch { /* The old process can disconnect before the new process listens. */ }
    if (response?.ok) {
      const value = await response.json().catch(() => null) as DesktopSettings | null;
      const actual = value?.storage?.data_dir || value?.paths?.dataDir || '';
      if (value && (!expectedDataDir || actual === expectedDataDir)) { port.reload(); return; }
    } else if (response && response.status >= 400 && response.status < 500 && ![404, 409].includes(response.status)) {
      throw await apiErrorFromResponse(response, tr('settings:auto.restart_timeout'));
    }
    await port.delay(500);
  }
  throw new Error(tr('settings:auto.restart_timeout'));
}

async function saveWebStorageSettings(button: HTMLElement | null = null) {
  const actions = sharedServices.termaUiActions;
  if (actions.isInFlight(saveKey)) return;
  const root = input('webStorageRoot')?.value.trim() || '';
  const migrate = Boolean(input('webStorageMigrate')?.checked);
  if (!root) return notify(tr('settings:auto.choose_runtime_root'), 'error');
  if (!await confirmModal(tr('settings:storage.web_change_confirm'), tr('settings:auto.change_data_path'), tr('settings:auto.save_restart'), tr('common:actions.cancel'), true)) return;
  if (!actions.begin(saveKey, button, tr('settings:storage.saving'))) return;
  try {
    const result = await api<{data_dir?: string}>(endpoint, {method: 'PUT', body: JSON.stringify({root, migrate})});
    notify(tr('settings:auto.data_path_saved'), 'success');
    await waitForStorageRestart(result.data_dir);
  } catch (error) { report(error, 'settings:auto.data_path_failed'); }
  finally { actions.end(saveKey, button); }
}

function syncDesktopCustomDataMode() {
  const box = $('desktopCustomDataBox');
  if (box) box.hidden = input('desktopDataMode')?.value !== 'custom';
}

async function chooseDesktopDataDirectory() {
  const inPane = captureWorkspacePane();
  try {
    const result = await api<{path?: string}>(`${endpoint}/choose-data-dir`, post);
    inPane(() => {
      const field = input('desktopCustomDataDir');
      if (result.path && field) field.value = result.path;
    });
  } catch (error) { report(error, 'settings:auto.directory_choose_failed'); }
}

async function chooseDesktopVncClient() {
  const target = $('view-settings');
  try {
    const result = await api<{path?: string}>(`${endpoint}/choose-vnc-client`, post);
    if (!result.path) return;
    await load();
    if (target?.isConnected) settingsServices.termaRefreshVueSettings?.(target, 'desktopBehaviorPanel');
    notify(tr('settings:auto.vnc_client_saved_notice', {defaultValue: '系统 VNC 客户端路径已保存到 Terma 设置'}), 'success');
  } catch (error) { report(error, 'settings:auto.vnc_client_choose_failed'); }
}

function readDraft(): DesktopStorageDraft | null {
  const mode = input('desktopDataMode'), custom = input('desktopCustomDataDir');
  if (!mode || !custom) return null;
  return {
    dataMode: mode.value, customDataDir: custom.value.trim(), migrateData: false,
    openAtLogin: Boolean(input('desktopOpenAtLogin')?.checked),
    minimizeToTray: Boolean(input('desktopMinimizeToTray')?.checked),
    startMinimizedToTray: Boolean(input('desktopStartMinimized')?.checked),
    showStartupNotification: Boolean(input('desktopStartupNotification')?.checked),
    xServerAutoStart: Boolean(input('desktopXServerAutoStart')?.checked)
  };
}

async function saveDesktopSettings(button = $('desktopSettingsSaveBtn')) {
  const actions = sharedServices.termaUiActions;
  if (actions.isInFlight(saveKey)) return;
  const draft = readDraft();
  if (!draft) return;
  const current = desktopSettings?.settings;
  if (draft.dataMode !== (current?.dataMode || '')
      || (draft.dataMode === 'custom' && draft.customDataDir !== (current?.customDataDir || '').trim())) {
    const choice = await chooseModal(tr('settings:auto.change_data_path'), tr('settings:storage.migration_question'), [
      {label: tr('settings:auto.migrate_restart'), value: 'migrate', className: 'primary'},
      {label: tr('settings:auto.switch_restart'), value: 'switch'},
      {label: tr('common:actions.cancel'), value: 'cancel'}
    ]);
    if (choice !== 'migrate' && choice !== 'switch') return;
    draft.migrateData = choice === 'migrate';
  }
  if (!actions.begin(saveKey, button, tr('settings:storage.saving'))) return;
  try {
    const result = await api<{migration_requested?: boolean; restart_required?: boolean}>(endpoint, {method: 'PUT', body: JSON.stringify(draft)});
    notify(tr(result.migration_requested ? 'settings:auto.migrating_data' : 'settings:auto.desktop_settings_restarting'), 'success');
    if (!result.restart_required) actions.end(saveKey, button);
  } catch (error) {
    actions.end(saveKey, button);
    report(error, 'settings:auto.desktop_settings_failed');
  }
}

const controller = {
  get snapshot() { return desktopSettings; },
  set snapshot(value) { desktopSettings = value; desktopRead++; },
  load, openStorageDirectoryBrowser, saveWebStorageSettings, syncDesktopCustomDataMode,
  chooseDesktopDataDirectory, chooseDesktopVncClient, saveDesktopSettings
};

export function installDesktopStorageController() { settingsServices.termaDesktopStorage = controller; }



export interface InstalledFeaturesSettingsDesktopStorageControllerServices {
  termaDesktopStorage: typeof controller
}
