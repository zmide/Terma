import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { captureWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { confirmModal } from '@/shared/workspace-prompts';
import { errorMessage } from '../operations/operations-types';
import { updateManualLinksAllowed } from './update-link-model';
import { isVerifiedUpdatePackage, updateReleaseIdentity as releaseIdentity, type UpdateConfirmation, type UpdateDownloadStatus, type UpdateProbe, type UpdateRecord, type UpdateTranslate } from './update-status-model';
import type { SharedApiBridge } from '../../shared/api/bridge';

type Pane = (action: () => void) => void;
interface DownloadPort {
  request: SharedApiBridge['request'];
  getUpdate(): UpdateRecord | null;
  setProgress(status: UpdateDownloadStatus): void;
  isFnos(): boolean;
  capturePane(): Pane;
  repaint(): void;
  confirm: UpdateConfirmation;
  tr: UpdateTranslate;
  notify(message: string, kind: 'success' | 'error'): void;
}

type ProbeRequestResult = UpdateProbe & { asset_name?: string; asset_url?: string };
const progressPath = '/api/updates/download/status';
const post = { method: 'POST', body: '{}' };

function routeKey(update: UpdateRecord | null) {
  if (!updateManualLinksAllowed(update)) return '';
  const dl = update?.download_status;
  const url = dl?.download_links?.find(link => link?.id === 'direct')?.url;
  return url && dl?.download_asset_name ? JSON.stringify([dl.download_asset_name, url]) : '';
}

export function createUpdateDownloadController(port: DownloadPort) {
  const { tr } = port;
  let probeSnapshot: (UpdateProbe & { key: string }) | null = null;
  let probing = false;
  let downloading = false;
  let actionPending = false;
  let opening = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let read: AbortController | undefined;
  let pollingEpoch = 0;

  async function probe() {
    const key = routeKey(port.getUpdate());
    if (!key || probing) return;
    const inPane = port.capturePane();
    probing = true;
    probeSnapshot = { key, running: true, results: [] };
    inPane(port.repaint);
    try {
      const result = await port.request<ProbeRequestResult>('/api/updates/download/probe', post);
      const resultKey = JSON.stringify([result?.asset_name, result?.asset_url]);
      probeSnapshot = key === resultKey && key === routeKey(port.getUpdate())
        ? { key, running: false, results: Array.isArray(result.results) ? result.results : [] } : null;
    } catch (error) {
      probeSnapshot = { key, running: false, results: [], error: errorMessage(error, String(error)) };
    } finally {
      probing = false;
      inPane(port.repaint);
    }
  }

  function stopPolling() {
    pollingEpoch++;
    if (poll !== undefined) clearInterval(poll);
    poll = undefined;
    read?.abort();
    read = undefined;
  }

  function startPolling(inPane = port.capturePane()) {
    if (poll !== undefined || port.isFnos()) return;
    const epoch = ++pollingEpoch;
    const key = releaseIdentity(port.getUpdate());
    poll = setInterval(async () => {
      if (key !== releaseIdentity(port.getUpdate())) { stopPolling(); return; }
      if (read) return;
      const request = read = new AbortController();
      try {
        const status = await port.request<UpdateDownloadStatus>(progressPath, { signal: request.signal });
        if (epoch !== pollingEpoch || request.signal.aborted || key !== releaseIdentity(port.getUpdate())) return;
        port.setProgress(status);
        inPane(port.repaint);
        if (!actionPending && status.state !== 'downloading') stopPolling();
      } catch {
        // A temporary progress failure is retried by the next tick; the download owns its final result.
      } finally {
        if (read === request) read = undefined;
      }
    }, 500);
  }

  async function download(redownload = false, confirmAction = port.confirm) {
    const update = port.getUpdate();
    if (!update || port.isFnos() || downloading || !(update.update_available || update.republished_available)
      || update.download_status?.state === 'downloading') return;
    downloading = true;
    const inPane = port.capturePane();
    const key = releaseIdentity(update);
    const current = () => key === releaseIdentity(port.getUpdate()) && !port.isFnos();
    try {
      const latestVersion = String(update.latest_version || '').trim().replace(/^v/i, '');
      const targetVersion = latestVersion ? `v${latestVersion}` : tr('settings:updates.current_unknown');
      if (!await confirmAction(
        tr(redownload ? 'settings:updates.redownload_confirm' : update.republished_available ? 'settings:updates.republished_confirm' : 'settings:updates.download_confirm', { version: targetVersion }),
        tr(redownload ? 'settings:auto.update_redownload_action' : 'settings:auto.update_download_verify'),
        tr(redownload ? 'settings:auto.update_redownload' : 'settings:auto.update_start'), tr('common:actions.cancel')
      ) || !current()) return;
      actionPending = true;
      inPane(port.repaint);
      const request = port.request<UpdateDownloadStatus>('/api/updates/download', post);
      startPolling(inPane);
      const result = await request;
      if (!current()) return;
      port.setProgress(result);
      port.notify(tr('settings:updates.package_verified'), 'success');
    } catch (error) {
      if (!current()) return;
      const message = errorMessage(error, tr('settings:updates.unknown_error'));
      if (actionPending) {
        const status = await port.request<UpdateDownloadStatus>(progressPath).catch(() => null);
        if (!current()) return;
        port.setProgress(status || { ...port.getUpdate()?.download_status, state: 'failed', error: message });
      }
      port.notify(message, 'error');
    } finally {
      if (actionPending) {
        stopPolling();
        actionPending = false;
        inPane(port.repaint);
      }
      downloading = false;
    }
  }

  function openTarget(directory: boolean) {
    const update = port.getUpdate();
    const status = update?.download_status;
    if (!update || !status || port.isFnos() || !isVerifiedUpdatePackage(update, status)) return null;
    const portable = status.package_type === 'portable';
    const folder = directory || portable;
    if (folder ? !status.can_open_directory : !status.can_open) return null;
    return { portable, folder, key: JSON.stringify([releaseIdentity(update), status.asset_name, status.digest, status.package_type, folder]) };
  }

  async function open(directory: boolean, confirmAction = port.confirm) {
    const target = openTarget(directory);
    if (!target || opening) return;
    opening = true;
    try {
      const { folder, portable } = target;
      const message = folder ? portable ? 'settings:updates.open_portable_directory_confirm' : 'settings:updates.open_installer_directory_confirm' : 'settings:updates.open_package_confirm';
      if (!await confirmAction(tr(message), tr(folder ? 'settings:auto.update_open_download' : 'settings:auto.update_open_package'),
        tr(folder ? 'settings:updates.open_directory' : 'settings:updates.open_package'), tr('common:actions.cancel')) || target.key !== openTarget(directory)?.key) return;
      await port.request(folder ? '/api/updates/open-directory' : '/api/updates/open', post);
      port.notify(tr(folder ? portable ? 'settings:updates.portable_directory_opened' : 'settings:updates.directory_opened' : 'settings:updates.package_opened'), 'success');
    } catch (error) {
      port.notify(errorMessage(error, tr('settings:updates.unknown_error')), 'error');
    } finally { opening = false; }
  }

  return {
    get probeSnapshot(): UpdateProbe | null {
      return probeSnapshot && probeSnapshot.key === routeKey(port.getUpdate()) ? probeSnapshot : null;
    },
    get actionPending() { return actionPending; },
    probe, download, startPolling, stopPolling,
    openPackage: (confirm?: UpdateConfirmation) => open(false, confirm),
    openDirectory: (confirm?: UpdateConfirmation) => open(true, confirm)
  };
}

export function installUpdateDownloads() {
  settingsServices.termaUpdateDownloads = createUpdateDownloadController({
    request: (path, options) => api(path, options),
    getUpdate: () => settingsServices.termaUpdateStatus.current(),
    setProgress: status => settingsServices.termaUpdateStatus.setProgress(status),
    isFnos: () => settingsServices.termaUpdateStatus.isFnos(),
    capturePane: () => captureWorkspacePane(), repaint: () => settingsServices.termaUpdateStatus.repaint(),
    confirm: (...args) => confirmModal(...args), tr: (key, options) => tr(key, options), notify: (message, kind) => notify(message, kind)
  });
}



export interface InstalledFeaturesSettingsUpdateDownloadControllerServices {
  termaUpdateDownloads: ReturnType<typeof createUpdateDownloadController>
}
