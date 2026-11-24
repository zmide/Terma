import {forwardsServices} from '@/features/forwards/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {api} from '@/shared/api/workspace-request';
import {pollNotifications} from '@/features/efficiency/notification-actions';
import {applicationState} from '@/shared/application-state';
import {createWorkspaceDataRefresh, type AppDataSnapshot, type DataRefreshOptions} from './data-refresh';
import {createUiStateRefreshService} from './ui-state-refresh';
import {createBackgroundRefreshService} from './background-refresh';
import { backgroundIntervals, runtimeConfiguredBackgroundIntervalMs } from '../features/settings/runtime-settings-model';

function editingSettings() {
  const field = document.activeElement;
  return applicationState.activeView === 'settings' && !!field && ['INPUT', 'TEXTAREA', 'SELECT'].includes(field.tagName);
}

function createWorkspaceRefresh() {
  const data = createWorkspaceDataRefresh({
    request: url => api(url),
    readCurrent: () => ({connections:applicationState.connections, remoteProfiles:applicationState.remoteProfiles, forwardTemplates:applicationState.forwardTemplates, security: applicationState.securitySettings}),
    editingSettings,
    commit(snapshot) {
      applicationState.connections = snapshot.connections as typeof applicationState.connections;
      applicationState.remoteProfiles = snapshot.remoteProfiles as typeof applicationState.remoteProfiles;
      applicationState.forwardTemplates = snapshot.forwardTemplates as typeof applicationState.forwardTemplates;
      if (!editingSettings()) applicationState.securitySettings = snapshot.security as typeof applicationState.securitySettings;
    },
    primaryView: () => applicationState.primaryView, activeView: () => applicationState.activeView,
    renderForwards: () => forwardsServices.termaForwardPages?.refresh(),
    renderRunning: () => forwardsServices.termaForwardWorkspace.renderRunning(),
    renderConnections: () => connectionsServices.termaConnectionViews?.renderConnections(), renderWelcome: () => connectionsServices.termaConnectionViews?.renderStartupSummary()
  });
  const revision = createUiStateRefreshService({
    requestRevision: () => api('/api/ui-state/revision'), reload: () => data.load({silent: true}),
    isHidden: () => document.hidden
  });
  const operationData = (silent: boolean) => Promise.all([
    applicationState.primaryView === 'logs' ? logsServices.termaLogList?.service().load({silent}) : undefined,
    !silent || applicationState.primaryView === 'command' || applicationState.activeView === 'command' ? batchServices.termaBatch?.templates().load({silent}) : undefined
  ]);
  const background = createBackgroundRefreshService({
    refreshUiState: options => Promise.all([revision.check(options), operationData(true)]),
    pollNotifications: () => pollNotifications(),
    refreshIntervalMs: () => runtimeConfiguredBackgroundIntervalMs('ui_refresh_interval_ms', backgroundIntervals.ui_refresh_interval_ms),
    isDesktop: () => Boolean(window.termaDesktop)
  });
  return {
    load: (options?: DataRefreshOptions) => data.load(options),
    get loading() {return data.getSnapshot().inFlight;},
    refresh: () => Promise.all([data.load(), operationData(false)]),
    start: () => background.start(), stop: () => background.stop()
  };
}

export function installWorkspaceRefresh() {
  sharedServices.termaWorkspaceRefresh ??= createWorkspaceRefresh();
}



export interface InstalledSharedWorkspaceRefreshServices {
  termaWorkspaceRefresh: ReturnType<typeof createWorkspaceRefresh>;
}
