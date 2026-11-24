import {sharedServices} from '@/shared/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import { errorMessage, type Api } from '../../operations/operations-types';

export type DownloadLocationAction = 'open-file' | 'open-directory' | 'delete-file';

export function requestDownloadDirectory(jobId = '', request: Api = sharedServices.termaWorkspaceRequest) {
  return request('/api/sftp/download-settings/open', {method: 'POST', body: JSON.stringify({job_id: jobId})});
}

export async function runDownloadLocationAction(action: DownloadLocationAction, jobId: string, button: HTMLElement | null = null) {
  const file = action !== 'open-directory';
  const key = `sftp-task:${action}:${jobId}`;
  const actions = sharedServices.termaUiActions;
  const text = tr!;
  const alert = efficiencyServices.termaNotificationToasts;
  if (file && !actions.begin(key, button)) return;
  try {
    if (file) await sharedServices.termaWorkspaceRequest(`/api/sftp/download-settings/${action}`, {
      method: 'POST', body: JSON.stringify({job_id: jobId})
    });
    else await requestDownloadDirectory(jobId);
    if (action === 'delete-file') alert?.notify(text('sftp:menu.downloaded_file_deleted', {defaultValue: '已删除下载文件'}), 'success');
  } catch (error) {
    const fallback = action === 'delete-file'
      ? text('sftp:menu.downloaded_file_delete_failed', {defaultValue: '删除下载文件失败'})
      : text(file ? 'sftp:settings.open_file_failed' : 'sftp:settings.open_directory_failed');
    alert?.notify(localizedTermaUiPhrase(errorMessage(error, '') || fallback), 'error');
  } finally {
    if (file) actions.end(key, button);
  }
}
