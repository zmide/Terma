import {filesServices} from '@/features/files/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {refreshIcons} from '@/shared/ui/icon-service';
import {notify} from '@/features/efficiency/notification-actions';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {openTerminal,openQuickTerminal} from '@/features/terminal/terminal-page';
import {resumeQuickTerminalWithTicket} from '@/features/terminal/terminal-connection-runtime';
import {sshAuthenticationFailure} from '@/features/connections/connection-credential-model';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import type { QuickConnectionSearchRecord, QuickViewHost } from './quick-port';
import type { QuickHeaderPort } from './QuickHeader';
import type { TaskCenterPort } from './TaskCenter';
import { formatFileBytes } from '@/shared/format-file-bytes';
import { sftpTaskCollections, sftpTaskCenterProgress, sftpTaskQueue, sftpTaskProgress } from '../files/sftp/sftp-task-model';
import { canPauseSftpTask, canResumeSftpTask, canCancelSftpTask } from '../files/sftp/sftp-task-service';

type X11PanelHost = Pick<QuickViewHost, 'tr' | 'sshAuthenticationFailure' | 'localizedTermaUiPhrase'>;
export const quickX11PanelHost: X11PanelHost = {
  tr: (key, options) => tr(key, options),
  sshAuthenticationFailure: error => sshAuthenticationFailure(error),
  localizedTermaUiPhrase: message => localizedTermaUiPhrase(message)
};

export function openQuickSavedTerminal(id: number) {
  return openTerminal(id);
}

type QuickTaskViewHost = Omit<TaskCenterPort, 'tr' |
  'sftpLatestJobs' | 'sftpTaskCenterView' | 'SFTP_ACTIVE_JOB_STATUSES' | 'sftpDismissedFloatingJobIds'>;

export function createQuickTaskViewHost(): QuickTaskViewHost {
  return {
    formatBytes: value => formatFileBytes(value),
    sftpJobProgress: sftpTaskProgress,
    localizedSftpJobText: (text, key) => filesServices.termaSftpTaskWorkspace.presentation.text(text, key),
    sftpJobStatus: (status, phase) => filesServices.termaSftpTaskWorkspace.presentation.status(status, phase),
    sftpJobProgressLabel: (job, progress) => filesServices.termaSftpTaskWorkspace.presentation.progressLabel(job, progress),
    openSftpGeneratedTaskFile: id => filesServices.termaGeneratedFiles.current().open(id),
    openSftpGeneratedTaskDirectory: id => filesServices.termaGeneratedFiles.current().directory(id),
    deleteSftpGeneratedTaskFile: id => filesServices.termaGeneratedFiles.current().deleteFile(id),
    retryCompletedSftpDownload: (id, button) => filesServices.termaSftpTransfers.controller.again(id, button instanceof HTMLElement ? button : null),
    saveSftpJobFile: id => filesServices.termaSftpTaskWorkspace.save(id),
    localizedSftpJobIssue: (job, field) => filesServices.termaSftpTaskWorkspace.presentation.issue(job, field),
    ensureSftpTaskLogViewState: id => filesServices.termaSftpTaskWorkspace.logs.ensure(id),
    sftpTaskCollections,
    sftpTaskCenterProgress,
    sftpTransferQueueJobs: sftpTaskQueue,
    sftpTransferJobCanPause: canPauseSftpTask,
    sftpTransferJobCanResume: canResumeSftpTask,
    sftpTransferJobCanCancel: canCancelSftpTask,
    captureSftpTaskLogViewStates: root => filesServices.termaSftpTaskWorkspace.logs.capture(root),
    bindSftpTaskLogViewStates: root => filesServices.termaSftpTaskWorkspace.logs.bind(root),
    sftpFloatingProgressEnabled: () => filesServices.termaSftpTaskWorkspace.runtime.floating(),
    sftpFloatingJobDetail: job => filesServices.termaSftpTaskWorkspace.presentation.detail(job),
    dismissSftpTaskFloat: () => filesServices.termaSftpTaskWorkspace.runtime.dismiss(),
    muteSftpTaskFloat: () => filesServices.termaSftpTaskWorkspace.runtime.mute(),
    sftpJobDisplayLabel: job => filesServices.termaSftpTaskWorkspace.presentation.label(job)
  };
}

export function createQuickViewHost(): QuickViewHost & Pick<QuickHeaderPort, 'openQuickPanel' | 'openSftpAutomationManager' | 'openTerminalSessionManager'> {
  return {
    ...quickX11PanelHost,
    get connections() { return applicationState.connections; },
    $: id => $(id),
    refreshIcons: () => refreshIcons(),
    closeModal: () => closeModal(),
    api: (path, options) => api(path, options),
    notify: (message, kind) => notify(message, kind),
    openSavedTerminal: openQuickSavedTerminal,
    newSshConnection: () => connectionsServices.termaConnectionFormWorkspace.create(),
    quickSessionId: key => Number(terminalSessions.get(key)?.connection?.id || 0),
    openQuickTerminal: (connection, token) => openQuickTerminal(connection, token),
    resumeQuickTerminal: (key, connection, token) => resumeQuickTerminalWithTicket(key, connection, token),
    localizedIdentityFileLabel: (identity, options) => localizedIdentityFileLabel(identity, options),
    syncUiActionControls: (key, busy) => sharedServices.termaUiActions.syncControls(key, busy),
    isUiActionInFlight: key => sharedServices.termaUiActions.isInFlight(key),
    closeQuickPanel: () => efficiencyServices.termaEfficiency.palette.close(),
    openQuickPanel: () => efficiencyServices.termaEfficiency.palette.open(),
    openSftpAutomationManager: () => filesServices.termaSftpWorkflow.automation.manager(),
    openTerminalSessionManager: () => sessionEfficiencyServices.termaSessionEfficiency.open(),
    setButtonBusy: (button, busy, message) => sharedServices.termaUiActions.setButtonBusy(button, busy, message)
  };
}
