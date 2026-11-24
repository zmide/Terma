import {quickServices} from '@/features/quick/installed-services';
import { backendPublicErrorParams, normalizeBackendPublicErrorCode } from '@/shared/api/public-errors';
import { deliverCompletedDownloads, saveBrowserDownload } from './browser-delivery';
import type { sendSftpUpload } from './sftp-upload-service';
import { sftpTaskProgress, type TaskRecord } from './sftp-task-model';
import type { createSftpTaskCompletion } from './sftp-task-completion';
import { createTaskLogView } from './task-log-view';
import { createTaskPresentation } from './task-presentation';
import { createTaskRuntime } from './task-runtime';

export function createTaskState() {
  return {
    jobs: [] as TaskRecord[],
    view: 'current',
    pendingDownloads: new Set<string>(),
    dismissed: new Set<string>(),
    uploads: new Map() as Parameters<typeof sendSftpUpload>[0]['requests'],
    paint: (jobs?: TaskRecord[]) => quickServices.termaQuickViews?.renderTaskCenter(jobs),
    float: () => quickServices.termaQuickViews?.renderTaskFloat()
  };
}

interface TaskWorkspacePort {
  state: ReturnType<typeof createTaskState>;
  runtime: Omit<Parameters<typeof createTaskRuntime>[0], 'completed' | 'localize'>;
  presentation: Omit<Parameters<typeof createTaskPresentation>[0], 'normalizeCode' | 'params' | 'progress' | 'tr'>;
  complete: ReturnType<typeof createSftpTaskCompletion>['complete'];
}

export function createTaskWorkspace(port: TaskWorkspacePort) {
  const presentation = createTaskPresentation({
    ...port.presentation,
    tr: port.runtime.tr,
    normalizeCode: normalizeBackendPublicErrorCode,
    params: backendPublicErrorParams,
    progress: sftpTaskProgress
  });
  const save = (id: string) => saveBrowserDownload(String(id), () => runtime.refresh());
  const runtime = createTaskRuntime({
    ...port.runtime,
    localize: presentation.text,
    completed: jobs => port.complete(jobs, list => deliverCompletedDownloads(list, {
      pending: port.state.pendingDownloads,
      save,
      saved: () => port.runtime.notify(port.runtime.tr('sftp:task_ui.browser_saved'), 'success')
    }))
  });
  return { state: port.state, runtime, presentation, logs: createTaskLogView(), save };
}



export interface InstalledFeaturesFilesSftpTaskWorkspaceServices {
  termaSftpTaskWorkspace: ReturnType<typeof createTaskWorkspace>;
}
