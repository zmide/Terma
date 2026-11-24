import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { captureWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { runtimePreferences } from './runtime-settings-model';
import { errorMessage } from '../operations/operations-types';
import { safeUpdateDownloadUrl } from './update-link-model';
import type { createSettingsRequestLifecycle } from './settings-request-lifecycle';
import { updateReleaseIdentity, type UpdateDownloadStatus, type UpdateRecord, type UpdateTranslate, type UpdateViewSnapshot } from './update-status-model';
import type { createUpdateDownloadController } from './update-download-controller';
import type { createUpdateNotice } from './update-notice';
import type { SharedApiBridge } from '../../shared/api/bridge';

type Pane = (action: () => void) => void;
type RenderOptions = { checking?: boolean; deferNotes?: boolean };
type Notice = Pick<ReturnType<typeof createUpdateNotice>, 'key' | 'sync' | 'paint' | 'clearCurrentRead'>;
type Downloads = Pick<ReturnType<typeof createUpdateDownloadController>, 'probeSnapshot' | 'actionPending' | 'startPolling'>;

interface UpdatePort {
  request: SharedApiBridge['request'];
  requests: ReturnType<typeof createSettingsRequestLifecycle>;
  language(): string;
  distribution(): string | undefined;
  capturePane(): Pane;
  emit(snapshot: UpdateViewSnapshot): void;
  downloads(): Downloads;
  notice(): Notice;
  tr: UpdateTranslate;
  notify(text: string, kind: 'success' | 'info' | 'error'): void;
}

function isRecord(value: unknown): value is UpdateRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createUpdateController(port: UpdatePort) {
  const { requests, tr } = port;
  let update: UpdateRecord | null = null;
  let cacheSequence = 0;
  let ignoreSaving = false;
  let progressSequence = 0;

  const current = () => update;
  const isFnos = () => update?.download_status?.managed_by === 'fnos' || port.distribution() === 'fnos';

  function localizeError(value: unknown) {
    const message = String(value || '').trim();
    if (!message) return tr('settings:updates.check_unavailable');
    if (!port.language().toLowerCase().startsWith('en')) return message;
    if (/正式版本数据无效|返回的数据无法解析/.test(message)) return tr('settings:updates.invalid_release_data');
    if (/超时/.test(message)) return tr('settings:updates.check_timeout');
    if (/尚未发布正式版本/.test(message)) return tr('settings:updates.no_formal_release');
    if (/[\u3400-\u9fff]/.test(message)) return tr('settings:updates.github_connection_failed');
    return message;
  }

  function snapshot(options: RenderOptions = {}): UpdateViewSnapshot {
    const download = update?.download_status;
    const downloads = port.downloads();
    const probe = downloads.probeSnapshot;
    const error = (value: unknown) => value ? localizeError(value) : '';
    const releaseUrl = safeUpdateDownloadUrl(update?.release_url);
    return {
      update: update ? structuredClone(update) : null,
      checking: options.checking ?? requests.pending,
      fnos: isFnos(),
      releaseUrl: releaseUrl?.host === 'github.com' && releaseUrl.pathname.includes('/releases/') ? releaseUrl.href : '',
      probe,
      deferNotes: Boolean(options.deferNotes),
      statusError: error(update?.error),
      checkError: error(update?.check_error),
      downloadError: error(download?.state === 'failed' ? download.error : ''),
      probeError: error(probe?.error),
      ignoreSaving,
      downloadActionPending: downloads.actionPending
    };
  }

  function repaint(options?: RenderOptions) { port.emit(snapshot(options)); }

  function setProgress(status: UpdateDownloadStatus) {
    if (!update) return;
    progressSequence++;
    update = { ...update, download_status: status };
  }

  const downloadPath = '/api/updates/download/status';
  const busyPaint = { checking: true, deferNotes: true };
  const yieldRender = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  function publish(inPane: Pane, options: RenderOptions) {
    inPane(() => {
      repaint(options);
      port.notice().sync();
    });
  }

  async function loadCached() {
    if (requests.pending || ignoreSaving) return;
    const inPane = port.capturePane();
    const id = ++cacheSequence;
    const checkSequence = requests.sequence;
    const beforeProgress = progressSequence;
    try {
      const [status, download] = await Promise.all([
        port.request<UpdateRecord>('/api/updates/status'),
        port.request<UpdateDownloadStatus>(downloadPath).catch(() => null)
      ]);
      if (id !== cacheSequence || checkSequence !== requests.sequence || requests.pending || ignoreSaving) return;
      const previous = update;
      if (status === null || isRecord(status)) update = status;
      const progress = beforeProgress !== progressSequence && updateReleaseIdentity(previous) === updateReleaseIdentity(update)
        ? previous?.download_status : download;
      if (progress) setProgress(progress);
      publish(inPane, { deferNotes: true });
      if (update?.download_status?.state === 'downloading') port.downloads().startPolling(inPane);
    } catch {
      // A missed background refresh leaves the current release and progress on screen.
    }
  }

  function reportCheck(result: UpdateRecord) {
    if (result.update_ignored) return;
    const version = `v${String(result.latest_version || '').replace(/^v/i, '')}`;
    const available = result.update_available || result.republished_available;
    const key = result.republished_available ? 'republished_found' : available ? 'new_version_found' : 'already_latest';
    port.notify(tr(`settings:updates.${key}`, { version }), available ? 'info' : 'success');
  }

  async function refresh(force = false) {
    if (ignoreSaving) return;
    const request = requests.begin();
    const inPane = port.capturePane();
    const previous = update;
    inPane(() => repaint(busyPaint));
    try {
      const options = { signal: request.signal };
      const status = await port.request<UpdateRecord>(`/api/updates/check${force ? '?force=1' : ''}`, options);
      if (!request.current()) return;
      if (!isRecord(status)) throw new Error(tr('settings:updates.invalid_release_data'));
      const existingProgress = update?.download_status;
      update = { ...status, ...(existingProgress && updateReleaseIdentity(update) === updateReleaseIdentity(status) ? { download_status: existingProgress } : {}) };
      await yieldRender();
      if (!request.current()) return;
      publish(inPane, busyPaint);
      if (force) reportCheck(status);
      const beforeProgress = progressSequence;
      const download = await port.request<UpdateDownloadStatus>(downloadPath, options).catch(() => null);
      if (request.current() && download && progressSequence === beforeProgress) {
        setProgress(download);
        await yieldRender();
        if (request.current()) inPane(() => repaint(busyPaint));
      }
    } catch (error) {
      if (!request.current() || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) return;
      const message = errorMessage(error, tr('settings:updates.github_connection_failed'));
      const download = update?.download_status || previous?.download_status;
      update = { ...previous, ...(download ? { download_status: download } : {}), ...(
        previous?.latest_version ? { check_error: message } : { error: message }
      ) };
      await yieldRender();
      if (!request.current()) return;
      publish(inPane, { checking: true });
      if (force) port.notify(localizeError(message), 'error');
    } finally {
      if (request.finish()) {
        publish(inPane, { deferNotes: true });
        if (update?.download_status?.state === 'downloading') port.downloads().startPolling(inPane);
      }
    }
  }

  async function setIgnored(enabled: boolean) {
    if (ignoreSaving || requests.pending || !update?.update_available) return false;
    const inPane = port.capturePane();
    const previousVersion = port.notice().key();
    ignoreSaving = true;
    cacheSequence++;
    inPane(() => repaint());
    try {
      const status = await port.request<UpdateRecord>(`/api/updates/ignore?enabled=${enabled ? '1' : '0'}`, { method: 'POST', body: '{}' });
      if (!isRecord(status)) throw new Error(tr('settings:updates.ignore_save_failed'));
      const download = update?.download_status;
      update = { ...status, ...(download && updateReleaseIdentity(update) === updateReleaseIdentity(status) ? { download_status: download } : {}) };
      if (!enabled && previousVersion === port.notice().key()) port.notice().clearCurrentRead();
      port.notice().paint();
      port.notify(tr(enabled ? 'settings:updates.ignore_enabled' : 'settings:updates.ignore_disabled', { version: `v${port.notice().key()}` }), 'success');
      return true;
    } catch (error) {
      port.notify(errorMessage(error, tr('settings:updates.ignore_save_failed')), 'error');
      return false;
    } finally {
      ignoreSaving = false;
      inPane(() => repaint());
    }
  }

  return { current, isFnos, setProgress, snapshot, repaint, loadCached, refresh, setIgnored };
}

export function installUpdateController() {
  settingsServices.termaUpdateStatus = createUpdateController({
    request: (path, options) => api(path, options),
    requests: settingsServices.termaSettingsRequests.updates,
    language: () => document.documentElement.lang || 'zh-CN',
    distribution: () => runtimePreferences.snapshot?.distribution,
    capturePane: () => captureWorkspacePane(),
    emit: snapshot => window.dispatchEvent(new CustomEvent('terma:update-status-changed', { detail: snapshot })),
    downloads: () => settingsServices.termaUpdateDownloads,
    notice: () => settingsServices.termaUpdateNotice,
    tr: (key, options) => tr(key, options),
    notify: (message, kind) => notify(message, kind)
  });
}



export interface InstalledFeaturesSettingsUpdateControllerServices {
  termaUpdateStatus: ReturnType<typeof createUpdateController>
}
