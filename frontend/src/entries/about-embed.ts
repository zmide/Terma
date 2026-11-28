import {settingsServices} from '@/features/settings/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {sftpTabRuntimes} from '@/features/files/sftp/tab-runtime';
import {rememberTermaRawUiPhrase,tr} from '@/shared/i18n/workspace-bootstrap';
import {apiErrorFromResponse} from '@/shared/api/public-errors';
import {createProgressToast} from '@/features/efficiency/notification-actions';
import {isMobileLayout} from '@/shared/browser-ui';
import {copyText} from '@/shared/clipboard-service';
import {localizedTermaUiPhrase,normalizeTermaLanguage} from '@/shared/i18n/ui-phrase';
import {notify,handleNotificationEvent,currentNotificationLanguage,showDesktopNotification} from '@/features/efficiency/notification-actions';
import {api} from '@/shared/api/workspace-request';
import {setButtonBusy} from '@/shared/ui-action-service';
import {activateTab} from '@/features/workspace/workspace-dock-runtime';
import {installThemeRuntime} from '@/shared/theme-runtime';
import {applicationState} from '@/shared/application-state';
import {$} from '@/shared/workspace-dom';
import {currentConnection} from '@/features/connections/connection-selection';
import {selectConnection} from '@/features/connections/connection-selection';
import {noteConnectionUsage} from '@/features/connections/connection-selection';
import {terminalSurfacePort} from '@/features/terminal/terminal-surface-workspace';
import * as terminalInputActions from '@/features/terminal/terminal-input-actions';
import * as terminalConnectionRuntime from '@/features/terminal/terminal-connection-runtime';
import {repairSshCredentials} from '@/features/connections/ssh-credential-runtime';
import {terminalTransportPort,terminalConnectionPort} from '@/features/terminal/terminal-transport-workspace';
import {createTerminalImagePastePort} from '@/features/terminal/terminal-image-workspace';
import {terminalSessions,terminalSurfaceCache,terminalCounts} from '@/features/terminal/terminal-session-state';
import {quickConnectionRequestToken,quickConnectionRequestHeaders,releaseQuickConnectionIfUnused} from '@/features/terminal/terminal-quick-registry';
import {uploadLocalFilesToTerminalTab} from '@/features/terminal/terminal-drop-workspace';
import {installTerminalLibraryMessages} from '@/features/terminal/terminal-libraries';
import { installTerminalDirectoryWorkspace } from '@/features/terminal/terminal-directory-workspace';
import { installTerminalStartupState } from '@/features/terminal/terminal-startup-state';
import { setWorkspace, setWorkspaceTabConnectionStatus } from '@/features/workspace/workspace-dock-runtime';
import { workspaceAllTabs, workspaceDockState, workspaceFindPane, workspaceFindPaneForTab, workspaceLeaves, workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { currentWorkspacePaneId, workspacePaneElement, workspaceElementForTab, installWorkspacePaneScope } from '@/features/workspace/workspace-pane-scope';
import { localizedWorkspaceTabTitle } from '@/features/workspace/workspace-tab-presentation';
import { normalizeDragEntry } from '@/features/files/sftp/drag-payload';
import { formatFileBytes as formatBytes } from '@/shared/format-file-bytes';
import { installOperations } from '@/features/operations/operations-mount';
import { installExchangeViews } from '@/features/data-exchange/ExchangeViews';
import { installAboutMount } from '@/features/settings/about-mount';
import { installUpdateDownloads } from '@/features/settings/update-download-controller';
import { installUpdateNotice } from '@/features/settings/update-notice';
import { installUpdateController } from '@/features/settings/update-controller';
import { createAboutI18n } from '@/shared/about-i18n';
import '@/styles/themes/kumo.scss';
import '@/styles/about.css';
import { installSettingsViews } from '@/features/settings/settings-mount';
import { installSettingsDialogs, openSettingsDialog, unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { installKeyWizard } from '@/features/settings/key-wizard-service';
import { installDesktopStorageController } from '@/features/settings/desktop-storage-controller';
import { installSshConfigDiscovery } from '@/features/data-exchange/ssh-config-discovery';
import { installManagedKeysService } from '@/features/settings/managed-keys-service';
import { createSshHostTrustDialogService } from '@/features/settings/ssh-host-trust-dialog-service';
import { installEventRegistry } from '@/shared/actions/event-registry';
import { installPublicErrors } from '@/shared/api/public-errors';
import { installWorkspaceRequest } from '@/shared/api/workspace-request';
import { installClipboardService } from '@/shared/clipboard-service';
import { installIconService } from '@/shared/ui/icon-service';
import { installFormControls } from '@/shared/form-controls';
import { installDialogWindows } from '@/shared/dialog-window';
import { installUiActionService } from '@/shared/ui-action-service';
import { installUiSnapshotService } from '@/shared/ui-snapshot-service';
import { installViewportService } from '@/shared/viewport-service';
import { installTerminalViewportService } from '@/features/terminal/terminal-viewport-service';
import { installTerminalSurfaceService } from '@/features/terminal/terminal-surface-service';
import { installActionRegistry } from '@/shared/actions/action-registry';
import { installStateRegistry } from '@/shared/state/state-registry';
import { installSettingsI18n } from '@/features/settings/i18n-service';
import { installLanguageSettingsController } from '@/features/settings/language-settings-controller';
import { installRuntimeSettingsReader } from '@/features/settings/runtime-settings-reader';
import { installRuntimeSettingsModel, normalizeRuntimeSettingsResponse, runtimePreferences } from '@/features/settings/runtime-settings-model';
import { refreshWorkspaceLanguage } from '@/features/workspace/workspace-language';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { startWorkspace } from '@/shared/workspace-bootstrap';
import { installHoverTooltips } from '@/shared/hover-tooltips';
import { installDesktopIntegrationService } from '@/shared/desktop-integration-service';
import { installWorkspaceRefresh } from '@/shared/workspace-refresh';
import { registerStaticActions } from '@/shared/static-action-registry';
import {
  namedWorkspaceHost, registerMobileWorkspaceAction, workspaceChromeHost, workspaceDockedStorageHost, workspaceDragHost,
  workspaceFilePageHost, workspaceGroupHost, workspaceMobileHost, workspaceStorageHost, workspaceTabActionsHost, workspaceTabCopyHost, workspaceTabRuntimeHost, workspaceToolbarHost
} from '@/features/workspace/workspace-host';
import { installWorkspaceToolbarPlacement } from '@/features/workspace/workspace-toolbar-placement';
import { installWorkspaceViews } from '@/features/workspace/workspace-mount';
import { installWorkspaceDockRuntime, mountWorkspaceDock } from '@/features/workspace/workspace-dock-runtime';
import { installWorkspaceChromeService } from '@/features/workspace/workspace-chrome-service';
import { installWorkspacePersistenceService } from '@/features/workspace/workspace-persistence-service';
import { installNamedWorkspaceService } from '@/features/quick/named-workspace-service';
import { installWorkspaceDragService } from '@/features/workspace/workspace-drag-service';
import { installWorkspaceLayoutService } from '@/features/workspace/workspace-layout-service';
import { installWorkspaceMobileService } from '@/features/workspace/workspace-mobile-service';
import { installWorkspaceTabActions } from '@/features/workspace/workspace-tab-actions';
import { installWorkspaceTabCopy } from '@/features/workspace/workspace-tab-copy';
import { installWorkspaceTabRuntime } from '@/features/workspace/workspace-tab-runtime';
import { installWorkspaceStateService } from '@/features/workspace/workspace-state-service';
import { installWorkspaceGroupController } from '@/features/workspace/workspace-group-controller';
import { installQuickViews } from '@/features/quick/quick-mount';
import { installConnectionViews, submitConnectionGroup } from '@/features/connections/connection-mount';
import { connectionMenuHost, connectionViewHost } from '@/features/connections/connection-host';
import { uploadConnectionKey } from '@/features/connections/connection-key-options';
import { closeWorkspaceModal } from '@/features/workspace/workspace-modal-host';
import { chooseModal, confirmModal, inputModal, installWorkspacePrompts } from '@/shared/workspace-prompts';
import { installConnectionFormWorkspace, seedRemoteConnectionForm, openNewConnectionForm } from '@/features/connections/connection-form-workspace';
import { installConnectionListService } from '@/features/connections/connection-list-service';
import { installConnectionMenuService } from '@/features/connections/connection-menu-service';
import { openConnectionDashboard } from '@/features/connections/connection-dashboard';
import { installConnectionBulkActionsService } from '@/features/connections/connection-bulk-actions-service';
import { installConnectionGroupActionsService } from '@/features/connections/connection-group-actions-service';
import { installConnectionGroupDragService } from '@/features/connections/connection-group-drag-service';
import { installConnectionValidationService } from '@/features/connections/connection-validation-service';
import { installConnectionValidationActionsService } from '@/features/connections/connection-validation-actions-service';
import { installConnectionHealthRuntime } from '@/features/connections/connection-health-runtime';
import { installConnectionTerminalService } from '@/features/connections/connection-terminal-service';
import { installConnectionCredentialService } from '@/features/connections/connection-credential-service';
import { installConnectionControllerService } from '@/features/connections/connection-controller-service';
import { installConnectionSaveService } from '@/features/connections/connection-save-service';
import { installConnectionFormActionsService } from '@/features/connections/connection-form-actions-service';
import { installRemoteViews } from '@/features/remote/RemoteFtpView';
import { installTerminalDialogs } from '@/features/terminal/terminal-dialog-mount';
import { installTerminalControls } from '@/features/terminal/terminal-controls-mount';
import { installTerminalZmodemView } from '@/features/terminal/terminal-zmodem-mount';
import { installTerminalImagePasteService } from '@/features/terminal/terminal-image-paste-service';
import { installTerminalInputWorkspace } from '@/features/terminal/terminal-input-workspace';
import { installTerminalToolbar } from '@/features/terminal/terminal-toolbar-mount';
import { installTerminalOutputFlowService } from '@/features/terminal/terminal-output-flow-service';
import { terminalOutputSessionIsFocused } from '@/features/terminal/terminal-session-lifecycle';
import { installTerminalSessionCoreService } from '@/features/terminal/terminal-session-core-service';
import { installTerminalTransportService } from '@/features/terminal/terminal-transport-service';
import { installTerminalConnectionService } from '@/features/terminal/terminal-connection-service';
import { installTerminalStartupWorkspace } from '@/features/terminal/terminal-startup-workspace';
import { installTerminalZmodemWorkspace } from '@/features/terminal/terminal-zmodem-workspace';
import { installTerminalToolbarScrollService } from '@/features/terminal/terminal-toolbar-scroll-service';
import { installTerminalCommandTrackingService } from '@/features/terminal/terminal-command-tracking-service';
import { installTerminalShortcutConfigService } from '@/features/terminal/terminal-shortcut-config-service';
import { installTerminalKeysService } from '@/features/terminal/terminal-keys-service';
import { installTerminalToolbarService } from '@/features/terminal/terminal-toolbar-service';
import { installTerminalSettingsWorkspace } from '@/features/terminal/terminal-settings-host';
import { installTerminalPreferencesService } from '@/features/terminal/terminal-preferences-service';
import { installTerminalBroadcastService } from '@/features/efficiency/terminal-broadcast-service';
import { installNotificationStateService } from '@/features/efficiency/notification-state-service';
import { createNotificationEventService } from '@/features/efficiency/notification-event-service';
import { createNotificationPollingService } from '@/features/efficiency/notification-polling-service';
import { installNotificationToasts } from '@/features/efficiency/NotificationToastView';
import { installSystemNotifications } from '@/features/efficiency/system-notification-service';
import { installTerminalActivityService } from '@/features/efficiency/terminal-activity-service';
import { installTerminalBroadcastWorkspace } from '@/features/session-efficiency/terminal-broadcast-workspace';
import { installSftpViews } from '@/features/files/sftp/SftpView';
import { installSftpGlobalSettings } from '@/features/files/sftp/SftpGlobalSettings';
import { createSftpPreferences } from '@/features/files/sftp/preferences';
import { createSftpViewState } from '@/features/files/sftp/view-state';
import { registerFilePageActions } from '@/features/files/file-page-actions';
import { createFilePageRuntime } from '@/features/files/file-page-runtime';
import { createFileWorkspaceActions } from '@/features/files/file-workspace-actions';
import { createFileWorkspaceTransfers } from '@/features/files/file-workspace-transfers';
import { installFileDeliveryRefresh } from '@/features/files/file-delivery-refresh';
import type { FileTransferEntry, FileTransferPort } from '@/features/files/file-transfer-service';
import type { WorkspaceTab } from '@/features/workspace/workspace-tab-runtime';
import { errorMessage } from '@/features/operations/operations-types';
import type { LocalListing } from '@/features/files/local-file-service';
import { formatSftpTime } from '@/features/files/file-layout';
import { createSftpPageLifecycle, type SftpPageConnection } from '@/features/files/sftp/page-lifecycle';
import { installSftpDialogs } from '@/features/files/sftp/sftp-dialog-mount';
import { installSftpMenuViews } from '@/features/files/sftp/SftpMenuViews';
import { createSftpEntryActions } from '@/features/files/sftp/entry-actions-workspace';
import { createSftpViewWorkspace, sftpConnectionAddress } from '@/features/files/sftp/view-workspace';
import { createSftpRecycleService } from '@/features/files/sftp/recycle-service';
import { installSftpComparisonViews } from '@/features/files/sftp/SftpComparisonViews';
import { installSftpPreviewViews } from '@/features/files/sftp/SftpPreviewShell';
import { installSftpEditorViews } from '@/features/files/sftp/SftpEditorShell';
import { createSftpWorkflow } from '@/features/files/sftp/file-workflow';
import { createSftpFileOperationsWorkspace } from '@/features/files/sftp/file-operations-workspace';
import { createSftpTransferWorkspace } from '@/features/files/sftp/transfer-workspace';
import { abortSftpUpload } from '@/features/files/sftp/sftp-upload-service';
import { installSftpTaskService } from '@/features/files/sftp/sftp-task-service';
import { createSftpDirectoryWorkspace } from '@/features/files/sftp/directory-workspace';
import { createSftpTabRuntime, type SftpTabRuntime } from '@/features/files/sftp/tab-runtime';
import {embeddedSftpViews, sftpWorkspaceTabs, sftpWorkspaceTab} from '@/features/files/sftp/embedded-views';
import type { SftpScrollState } from '@/features/files/sftp/directory-state';
import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import { createSftpTransferLifecycle } from '@/features/files/sftp/transfer-lifecycle';
import { createTaskState, createTaskWorkspace } from '@/features/files/sftp/task-workspace';
import { sftpActiveStatuses } from '@/features/files/sftp/sftp-task-model';
import { installTaskActions } from '@/features/files/sftp/task-actions';
import { createGeneratedFileService, generatedFileParent } from '@/features/files/sftp/generated-file-service';
import { installBrowserDirectory } from '@/features/files/browser-directory';
import { createFileOpenService, type FileOpenPort } from '@/features/files/sftp/file-open-service';
import { installLocalFilesView } from '@/features/files/LocalFilesView';
import { createSftpDragWorkspace } from '@/features/files/sftp/drag-workspace';
import { installDragPayload } from '@/features/files/sftp/drag-payload';
import { installDragHandoff } from '@/features/files/sftp/drag-handoff';
import { installDroppedFiles } from '@/features/files/sftp/dropped-files';
import { installSvgSource } from '@/features/files/sftp/svg-source';
import { installSvgEngine } from '@/features/files/sftp/svg-engine';
import { installEditorDocument } from '@/features/files/sftp/editor-document';
import { installFileLayouts } from '@/features/files/file-layout';
import { installFileNavigation } from '@/features/files/file-navigation';
import { createWorkspaceTransfer, type TransferTab, type WorkspaceTransferPort } from '@/features/files/workspace-transfer';
import { createSftpColumns, SFTP_COLUMN_LAYOUT_STORAGE_KEY } from '@/features/files/sftp/column-layout';
import { installSftpPreviewWorkspace } from '@/features/files/sftp/preview-workspace';
import { installAceLocalization } from '@/features/files/sftp/editor-ace-localization';
import { installPreviewModel } from '@/features/files/sftp/preview-model';
import { createSftpConnectionService, type SftpConnectionStatus } from '@/features/files/sftp/connection-service';
import { sshAuthenticationFailure } from '@/features/connections/connection-credential-model';
import { createSftpCredentialRepair, type SftpCredentialRepairPort } from '@/features/files/sftp/credential-repair';
import { installSftpFileKind } from '@/features/files/sftp/file-kind';
import SftpOpenWorker from '@/features/files/sftp/sftp-open-worker?worker&inline';
import '@/styles/interactions.css';







const sftpTabCounts = new Map<number, number>();






installWorkspaceDockRuntime();
const events = installEventRegistry(({
  unregistered: action => console.error(tr("errors:events.unregistered", {action, defaultValue:`未注册的 Terma 界面 action：${action}`})),
  error: error => {
    if (typeof notify === "function") notify(error instanceof Error ? error.message : String(error), "error");
    else console.error(error);
  }
}));
events.register('connection-group-save', submitConnectionGroup);

registerMobileWorkspaceAction(events);
installPublicErrors({
  language:() => {
    const language = globalThis.document?.documentElement?.lang || window.i18next?.resolvedLanguage || "zh-CN";
    return typeof normalizeTermaLanguage === "function" ? normalizeTermaLanguage(language) : String(language);
  },
  hasTranslation:(key,language) => Boolean(window.i18next?.exists?.(key,{lng:language,fallbackLng:false})),
  translate:(key,options) => tr(key,options),
  preserve:source => typeof rememberTermaRawUiPhrase === "function" ? rememberTermaRawUiPhrase(source) : source,
  legacyMessage:value => typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(value) : String(value || "")
});
const sshHostTrust = createSshHostTrustDialogService({
  mount: values => openSettingsDialog('host-trust', { ...values }),
  close() {
    const target = document.getElementById('modal');
    if (target?.dataset.termaSettingsDialog !== 'host-trust') return;
    unmountSettingsDialog();
    target.hidden = true;
  }
});
installWorkspacePaneScope();
installWorkspaceRequest({
  fetch: (...args) => fetch(...args),
  tr: (key, options) => tr(key, options),
  quickToken: id => quickConnectionRequestToken(id),
  refreshTrustedHosts: () => settingsServices.termaTrustedHosts.load(),
  extraArgsError: details => connectionsServices.termaConnectionValidationService?.formatError(details) ?? "",
  requireLogin: () => { location.href = "/login"; }
}, sshHostTrust.open, id => sftpConnection.ensure(id));
installClipboardService({
  nativeWriter:() => {
    const desktop = window.termaDesktop as {writeClipboardText?(text:string):Promise<unknown>}|undefined;
    return typeof desktop?.writeClipboardText === "function" ? text => desktop.writeClipboardText!(text) : null;
  },
  browserWriter:() => {
    const clipboard = navigator.clipboard;
    return typeof clipboard?.writeText === "function" ? text => clipboard.writeText(text) : null;
  },
  document:() => document,
  text:key => tr(key),
  notify:(message,kind) => notify(message,kind)
});
installStateRegistry({
  owners:{navigation:['activeView','primaryView','tabs','activeTabKey'],connections:['connections','selectedId'],
    remote:['remoteProfiles','selectedRemoteProfileId'],terminal:['terminalGlobalSettings','terminalKeysVisible'],
    sftp:['sftpJobsTimer'],settings:['securitySettings'],logs:['logsData','logSearch']},
  snapshot:()=>{
    const current=sftpTabRuntimes.get(applicationState.activeTabKey);
    return {
      navigation:{activeView:applicationState.activeView,primaryView:applicationState.primaryView,activeTabKey:applicationState.activeTabKey,tabCount:applicationState.tabs.length},
      connections:{selectedId:applicationState.selectedId,count:applicationState.connections.length,search:applicationState.connectionSearch,bulk:applicationState.connectionBulkMode},
      remote:{selectedId:applicationState.selectedRemoteProfileId,count:applicationState.remoteProfiles.length,search:remoteServices.termaRemoteList?.getSearch()||''},
      terminal:{sessions:terminalSessions.size,fontSize:applicationState.terminalFontSize},
      sftp:{connectionId:current?.state.connectionId||0,path:current?.state.path||'.',jobsTimer:Boolean(applicationState.sftpJobsTimer)},
      settings:{encryptionEnabled:Boolean(applicationState.securitySettings?.encryption_enabled)}
    };
  }
});
installSettingsI18n();
installIconService();
installFormControls();
installThemeRuntime();
const mainDialog = document.getElementById('modal');
if (mainDialog) installDialogWindows(mainDialog, { palette: true });
installHoverTooltips();
installUiActionService();
installUiSnapshotService({
  element: id => $(id),
  workspace: () => workspaceServices.termaWorkspacePaneScope?.currentWorkspaceDomScope()?.querySelector(".workspace") || document.querySelector(".workspace")
});
installTerminalViewportService();
installTerminalLibraryMessages();
installTerminalSurfaceService(terminalSurfacePort);
installViewportService();
installDesktopIntegrationService(({
  api:(...args) => api(...args), tr:(...args) => tr(...args), notify:(...args) => notify(...args), busy:(...args) => setButtonBusy(...args),
  refreshXServer:() => x11Services.termaX11.manager.refresh(),
  refreshProfile:(id,button) => (button.closest('#view-remote-desktop') as (HTMLElement & {__termaRemoteDesktopAuthorizationRefresh?(id:number):unknown})|null)?.__termaRemoteDesktopAuthorizationRefresh?.(id)
}));
installRuntimeSettingsModel();
installWorkspaceRefresh();
installTerminalImagePasteService(createTerminalImagePastePort);
installTerminalOutputFlowService(terminalOutputSessionIsFocused);
installTerminalSessionCoreService({
  openState:WebSocket.OPEN,closedState:WebSocket.CLOSED,storage:window.sessionStorage,crypto:globalThis.crypto,
  updateStatus:terminalConnectionRuntime.updateTerminalConnectionStatus,
  connect:(_connection,key,options)=>{
    const session=terminalSessions.get(key);
    if(session)void terminalConnectionRuntime.connectTerminal(session.connection,key,options);
  }
});
installTerminalTransportService(terminalTransportPort);
installTerminalConnectionService(terminalConnectionPort);
installTerminalStartupState();
installTerminalStartupWorkspace();
installTerminalDirectoryWorkspace();
installTerminalZmodemWorkspace();
installTerminalToolbarScrollService();
installTerminalCommandTrackingService();
installTerminalShortcutConfigService();
installTerminalSettingsWorkspace();
installTerminalInputWorkspace();
installTerminalPreferencesService();
installTerminalKeysService();
installTerminalToolbarService();
installTerminalBroadcastService();
installNotificationStateService();
installNotificationToasts(() => ({
  preferences:settingsServices.termaRuntimeSettingsModel?.snapshot?.saved?.notification_display,
  localize:localizedTermaUiPhrase
}));
installSystemNotifications({
  browser:() => typeof Notification === "undefined" ? null : Notification,
  desktop:() => window.termaDesktop as ReturnType<Parameters<typeof import('@/features/efficiency/system-notification-service').createSystemNotificationService>[0]['desktop']>,
  appEnabled:() => settingsServices.termaRuntimeSettingsModel?.snapshot?.saved?.desktop_notifications_enabled !== false,
  text:key => tr(key),
  notify:(...args) => notify(...args),
  focus:() => window.focus(),
  location:() => location.href,
  activateTab:key => activateTab(key),
  openForwards:id => forwardsServices.termaForwardWorkspace.openConnection(id),
  openSftp:id => filesServices.termaSftpPage.open(id),
  openLog:(path, title) => logsServices.termaLogReader.feature().service.open(path, title),
  openUrl:url => window.open(url, "_blank", "noopener"),
  handleEvent:(event, options) => handleNotificationEvent(event, options)
});
installTerminalActivityService();
installTerminalBroadcastWorkspace();
efficiencyServices.termaNotificationEvents = createNotificationEventService(efficiencyServices.termaNotificationState!, {
  context:()=>({notificationMode:applicationState.securitySettings?.notification_mode,updateIgnored:Boolean(settingsServices.termaUpdateStatus?.current()?.update_ignored)}),
  settleSftpJob: event => { sftpTransfers.completion.settle(event); },
  refreshSftpJobs: async () => { await taskWorkspace.runtime.refresh(); },
  refreshUpdateStatus: () => settingsServices.termaUpdateStatus.loadCached(),
  notify: (text, level, options) => notify?.(text, level, options),
  showDesktopNotification: event => showDesktopNotification?.(event),
  persist: id => localStorage.setItem('lastNotificationId', String(id))
});
efficiencyServices.termaNotificationPolling = createNotificationPollingService(efficiencyServices.termaNotificationState!, {
  request:path=>api(path),
  language:currentNotificationLanguage,
  handle:event=>handleNotificationEvent(event),
  persist: id => localStorage.setItem('lastNotificationId', String(id))
});
installOperations(events, seedRemoteConnectionForm, {
  refresh: () => taskWorkspace.runtime.refresh(),
  open: event => taskWorkspace.runtime.open(event)
});
installExchangeViews(uploadConnectionKey);
installActionRegistry();
installSftpTaskService();
installBrowserDirectory();
installLocalFilesView();
installDragPayload();
installDragHandoff();
installDroppedFiles();
installSvgSource();
installSvgEngine();
installEditorDocument();
installFileLayouts();
installAceLocalization();
installPreviewModel();
installSftpFileKind();
const i18n = await createAboutI18n();
installManagedKeysService();
installSettingsDialogs(closeWorkspaceModal);
installWorkspacePrompts( {
  open: openSettingsDialog,
  close: closeWorkspaceModal,
  page(key, open) {
    const navigation = quickServices.termaCommandNavigation;
    return navigation ? navigation.page(key, open) as ReturnType<typeof open> : open();
  },
  text: (key, options) => tr(key, options),
  phrase: text => localizedTermaUiPhrase(text),
  selectInput: () => document.querySelector<HTMLInputElement>('#modalInputValue')?.select()
});
installRuntimeSettingsReader();
installLanguageSettingsController();
installDesktopStorageController();
installKeyWizard();
installSshConfigDiscovery();
installUpdateController();
installUpdateDownloads();
installUpdateNotice();
installSettingsViews(i18n, () => sftpDirectory.cache.clear());
const taskState = createTaskState();
installQuickViews(taskState);
const filePages = createFilePageRuntime({
  workspace: workspaceFilePageHost(),
  views: filesServices.termaLocalFileViews,
  list: (source, query, signal) => api<LocalListing>(
    `${source === 'server' ? '/api/server-files' : '/api/local-files'}?${query}`, { signal }
  ),
  text: (key, values) => tr(key, {...values, defaultValue:key}),
  bytes: formatBytes,
  time: formatSftpTime,
  fnos: () => settingsServices.termaRuntimeSettingsModel.snapshot?.distribution === 'fnos',
  releaseActions(key) { fileTransfers.release(key); fileActions.release(key); }
});
filesServices.termaLocalFileRuntime = filePages;
installWorkspaceChromeService(workspaceChromeHost());
installWorkspaceDragService(workspaceDragHost());
installWorkspaceLayoutService();
installWorkspaceToolbarPlacement(workspaceToolbarHost());
installWorkspaceMobileService(workspaceMobileHost());
installWorkspaceStateService();
installWorkspaceTabRuntime(workspaceTabRuntimeHost(filePages.pages));
installWorkspaceTabCopy(workspaceTabCopyHost(filePages.pages));
installWorkspaceTabActions(workspaceTabActionsHost());
installWorkspaceGroupController(workspaceGroupHost());
installWorkspacePersistenceService(workspaceStorageHost(workspaceDockedStorageHost()));
installNamedWorkspaceService(namedWorkspaceHost());
workspaceServices.termaWorkspaceShell = workspaceShell;
installWorkspaceViews();
mountWorkspaceDock();
const connectionHost = connectionViewHost();
installConnectionViews(connectionHost);
installConnectionListService(connectionHost);
installConnectionMenuService(connectionMenuHost(openConnectionDashboard));
installConnectionBulkActionsService(connectionHost);
installConnectionGroupActionsService(connectionHost);
installConnectionGroupDragService(connectionHost);
installConnectionFormWorkspace();
installConnectionValidationService();
installConnectionValidationActionsService(connectionHost);
installConnectionTerminalService();
installConnectionCredentialService();
installConnectionControllerService(connectionHost);
installConnectionSaveService(connectionHost);
installConnectionFormActionsService(connectionHost);
installConnectionHealthRuntime(connectionHost);
installRemoteViews();
installTerminalDialogs();
installTerminalToolbar();
installTerminalControls();
installTerminalZmodemView();
installSftpViews();
installSftpGlobalSettings();
installFileDeliveryRefresh();
installSftpDialogs();
installSftpMenuViews();
const fileText: FileTransferPort['text'] = (key, values) => tr(key, values);
const fileNotice = (message: string, level: 'info' | 'success' | 'error') => notify?.(message, level);
const sftpTransfers = createSftpTransferLifecycle({
  directories: {
    runtimes: () => sftpTabRuntimes.values(),
    state(key) {
      const runtime = sftpTabRuntimes.get(key);
      return runtime ? {
        loading: Boolean(runtime.state.loading), mounted: Boolean(sftpTabs.root(key)?.isConnected),
        disconnected: applicationState.sftpDisconnectedTabs.has(key)
      } : null;
    },
    refresh: async key => await sftpFileActions.refresh(key),
    failed: error => fileNotice(errorMessage(error, fileText('sftp:auto.directory_sync_failed')), 'error')
  },
  polling: {
    timerChanged: timer => { applicationState.sftpJobsTimer = timer; },
    lastJobsPollAt: () => taskWorkspace.runtime.lastPoll,
    state: () => ({
      hidden: document.hidden,
      hasActiveJobs: taskState.jobs.some(job => sftpActiveStatuses.has(job.status ?? '')),
      drawerOpen: document.getElementById('sftpTaskCenterDrawer')?.hidden === false,
      vncRendering: remoteServices.termaVncRuntime?.renderingActive() === true,
      activeSessionKey: applicationState.tabs.find(tab => tab.key === applicationState.activeTabKey && tab.kind === 'sftp')?.key,
      activeSessionInterval: settingsServices.termaRuntimeSettingsModel.interval('sftp_active_status_poll_interval_ms', 5000),
      allSessionsInterval: settingsServices.termaRuntimeSettingsModel.interval('sftp_background_status_poll_interval_ms', 15000)
    }),
    refreshJobs: age => taskWorkspace.runtime.stale(age),
    refreshSessions: key => sftpConnection.refresh(key)
  },
  jobs: () => taskState.jobs,
  localDelivery: job => fileTransfers.delivery.refresh(job),
  changed: () => taskState.paint()
});
filesServices.termaSftpTransferLifecycle = sftpTransfers;
const sftpTabs = createSftpTabRuntime({
  runtimes: sftpTabRuntimes,
  counts: sftpTabCounts,
  tabs: sftpWorkspaceTabs,
  pageSize: () => Number(localStorage.getItem('sftpPageSize')),
  connectionName: id => applicationState.connections.find(connection => Number(connection.id) === id)?.name || '',
  root: key => embeddedSftpViews.get(key)?.root || workspaceElementForTab(key, '#view-sftp'),
  releaseView: key => filesServices.termaSftpViews?.release(key),
  releaseState(key) {
    sftpDirectory.navigation.release(key);
    sftpViewState.release(key);
    sftpTransfers.directories.release(key);
  }
});
const sftpDragWorkspace = createSftpDragWorkspace({
  tabs: sftpTabs, runtimes: sftpTabRuntimes, api: (url, options) => api(url, options),
  text: fileText, notify: (...args) => notify?.(...args)
});
filesServices.termaSftpDragWorkspace = sftpDragWorkspace;
const sftpViewState = createSftpViewState({
  runtime: key => sftpTabRuntimes.get(key),
  root: sftpTabs.root,
  capture: key => sftpView.capture(key),
  cache: (key, path, state) => sftpDirectory.cache.cache(key, path, state),
  runtimes: () => sftpTabRuntimes.values(),
  paint: key => sftpView.refresh(key, 'list')
});
filesServices.termaSftpTabs = { runtime: sftpTabs, view: sftpViewState };
const sftpView = createSftpViewWorkspace({ tabs: sftpTabs, runtimes: sftpTabRuntimes, viewState: sftpViewState, text: fileText, bytes: formatBytes, clipboard: () => sftpFileActions.clipboard.value });
const sftpFileTransfers = createSftpTransferWorkspace({
  tabs: sftpWorkspaceTabs, runtimes: sftpTabRuntimes, view: sftpView, api: (url, options) => api(url, options),
  text: fileText, notify: fileNotice, jobs: () => taskState.jobs, pendingDownloads: taskState.pendingDownloads, requests: taskState.uploads
});
filesServices.termaSftpTransfers = sftpFileTransfers;
const sftpFileActions = createSftpFileOperationsWorkspace({
  tabs: sftpWorkspaceTabs, runtimes: sftpTabRuntimes, view: sftpView, api: (url, options) => api(url, options), tr: fileText, notify: fileNotice
});
filesServices.termaSftpFileActions = sftpFileActions;
const sftpWorkflow = createSftpWorkflow({
  api: (url, options) => api(url, options), name: id => currentConnection(id)?.name,
  target(id, key) {
    const runtime = sftpTabRuntimes.get(key), tab = sftpWorkspaceTab(key);
    return sftpFileTransfers.target(key, id, String(runtime?.state.path || tab?.path || '.'));
  },
  tr: fileText, notify: fileNotice, bytes: formatBytes
});
filesServices.termaSftpWorkflow = sftpWorkflow;
events.register('sftp-automation-open', () => sftpWorkflow.automation.manager());
filesServices.termaSftpView = sftpView;
const sftpDirectory = createSftpDirectoryWorkspace({
  cache: {
    state: key => (sftpTabRuntimes.get(key) || sftpTabs.restore(key))?.state ?? null,
    capture: key => sftpView.capture(key),
    connection: key => Number(sftpTabRuntimes.get(key)?.connectionId || sftpWorkspaceTab(key)?.id || 0),
    siblings: (key, id) => sftpWorkspaceTabs().some(tab => tab.key !== key && tab.kind === 'sftp' && Number(tab.id) === id),
    readSize: (id, path) => api(`/api/connections/${id}/sftp/directory-size`, {method:'POST', body:JSON.stringify({path})}),
    changed: id => sftpView.refreshSizes(id),
    tr: fileText,
    localize: localizedTermaUiPhrase,
    bytes: formatBytes,
    error: message => fileNotice(message, 'error')
  },
  http: { read: (url, signal) => api(url, {signal}) },
  loader: {
    active: () => applicationState.activeTabKey,
    tab: key => sftpWorkspaceTabs().find((tab): tab is WorkspaceTab & {id:number} => tab.key === key && typeof tab.id === 'number') ?? null,
    runtime: key => sftpTabRuntimes.get(key) ?? null,
    ensure: sftpTabs.ensure,
    capture: key => sftpView.capture(key),
    restore: (view, key) => sftpView.restore(view, key),
    list: key => sftpView.element('sftpList', key),
    render(key, part) {
      if (part === 'navigation') sftpView.refresh(key, 'navigation');
      else if (part === 'actions') sftpView.refreshDirectoryActions(key);
      else sftpView.render(key);
    },
    session: id => api(`/api/connections/${id}/sftp/session`, {skipSftpConnect:true}),
    connected: (id, status, error) => paintSftpConnection(id, status, error),
    remember: sftpViewState.remember,
    saveTabs: () => workspaceServices.termaWorkspacePersistence?.schedule(),
    search: (key, loading) => sftpView.searchBusy(key, loading),
    flush: key => sftpTransfers.directories.flush(key),
    tr: fileText,
    error: message => fileNotice(message, 'error')
  },
  navigation: {
    restore: sftpTabs.restore,
    runtime: key => sftpTabRuntimes.get(key) ?? null,
    tab: key => {
      const tab = sftpWorkspaceTabs().find(item => item.key === key && item.kind === 'sftp');
      return tab && typeof tab.id === 'number' ? {id:tab.id, kind:tab.kind} : null;
    },
    pageSize: value => localStorage.setItem('sftpPageSize', String(value)),
    changed: key => sftpView.refresh(key, 'navigation'),
    filtersChanged(key) {
      sftpView.searchBusy(key, false);
      sftpView.refresh(key, 'search');
    },
    error: message => fileNotice(message, 'error')
  }
});
filesServices.termaSftpDirectoryWorkspace = sftpDirectory;
installFileNavigation({
  tab(key) {
    const kind = workspaceTabByKey(key)?.kind;
    return kind ? {kind} : undefined;
  },
  navigate: (kind, direction, key) => kind === 'sftp' ? sftpDirectory.navigation.navigateHistory(key, direction) : filePages.files.historyMove(key, direction),
  error: error => fileNotice(errorMessage(error, String(error)), 'error')
});
const sftpTab = (key: string) => {
  const tab = sftpWorkspaceTab(key);
  return tab?.kind === 'sftp' && typeof tab.id === 'number' ? tab as WorkspaceTab & {id:number} : null;
};
const sftpTabKeys = (id: number) => sftpWorkspaceTabs().filter(tab => tab.kind === 'sftp' && Number(tab.id) === id).map(tab => tab.key);
function paintSftpConnection(id: number, status = 'disconnected', error = '') {
  const state = status === 'connected' || status === 'connecting' ? status : 'disconnected';
  for (const key of sftpTabKeys(id)) {
    const embedded = embeddedSftpViews.get(key);
    if (embedded) embedded.tab.connectionStatus = state;
    else setWorkspaceTabConnectionStatus(key, state);
    const runtime = sftpTabRuntimes.get(key);
    if (runtime) {
      runtime.vueStatus = state;
      runtime.vueError = error;
    }
    sftpView.refresh(key, 'toolbar');
    sftpView.refresh(key, 'banner');
  }
  window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));
}
const sftpRepair = createSftpCredentialRepair({
  tab: sftpTab,
  runtime: key => sftpTabRuntimes.get(key) ?? null,
  prompt: (id, options) => repairSshCredentials(id, options),
  forget: id => api(`/api/connections/${id}/sftp/session?forget=1`, {method:'DELETE', skipSftpConnect:true}),
  connect: (id, tabKey) => sftpConnection.ensure(id, {force:true, tabKey, skipCredentialRepair:true}),
  open: (id, path, key) => sftpPage.open(id, path, true, key),
  release: id => releaseQuickConnectionIfUnused(id),
  tr: fileText
});
const sftpConnection = createSftpConnectionService({
  active: () => applicationState.activeTabKey,
  tab: sftpTab,
  keys: sftpTabKeys,
  ids: () => [...new Set(Array.from(sftpTabRuntimes.values(), runtime => runtime.connectionId).filter(Boolean))],
  runtime: key => sftpTabRuntimes.get(key) ?? null,
  status: key => sftpView.element('sftpConnectionToggle', key)?.dataset.status || sftpTab(key)?.connectionStatus || 'disconnected',
  isDisconnected: key => applicationState.sftpDisconnectedTabs.has(key),
  disconnected(key, value) {
    if (value) {
      applicationState.sftpDisconnectedTabs.add(key);
      sftpTransfers.directories.release(key);
    } else applicationState.sftpDisconnectedTabs.delete(key);
  },
  remember: sftpViewState.remember,
  changed: paintSftpConnection,
  request: (id, method, signal) => api(`/api/connections/${id}/sftp/session${method === 'DELETE' ? '?forget=1' : ''}`, {
    method, signal, skipSftpConnect: true, ...(method === 'POST' ? {body:'{}'} : {})
  }),
  authenticationFailure: sshAuthenticationFailure,
  repair: sftpRepair.repair,
  load: options => sftpDirectory.loader.load(options),
  dispose: sftpTabs.dispose,
  releaseQuick: id => releaseQuickConnectionIfUnused(id),
  clearCache: id => sftpDirectory.cache.clearConnection(id),
  tr: fileText,
  error: message => fileNotice(message, 'error')
});
filesServices.termaSftpConnection = Object.assign(sftpConnection, { keys: sftpTabKeys, paint: paintSftpConnection });
filesServices.termaFileOpen = createFileOpenService({
  tr: fileText,
  formatBytes,
  ensure: id => sftpConnection.ensure(id),
  fetch: (url, options) => window.fetch(url, options),
  headers: id => typeof quickConnectionRequestHeaders === 'function' ? quickConnectionRequestHeaders(id) : {},
  responseError: async response => (await apiErrorFromResponse(response, fileText('sftp:editor.remote_read_failed'))).message,
  progress: createProgressToast,
  worker: () => new SftpOpenWorker(),
  preferredEncoding: id => (currentConnection(id) || applicationState.connections.find(connection => Number(connection.id) === id))?.sftp_text_encoding || 'auto',
  settings: () => settingsServices.termaRuntimeSettingsModel.snapshot?.saved || {}
});
const generatedFiles = createGeneratedFileService({
  storage: localStorage,
  desktop: () => Boolean(window.termaDesktop),
  api: (path, options) => api(path, options),
  tr: fileText,
  download: (blob, filename) => filesServices.termaSftpPreviewRuntime.download(blob, filename),
  confirm: () => confirmModal(fileText('sftp:editor.generated_delete_confirm'), fileText('tasks:dialogs.delete_title'), fileText('common:actions.delete'), fileText('common:actions.cancel'), true),
  notify: fileNotice,
  changed(tasks) {
    taskState.jobs = [...taskState.jobs.filter(task => task.type !== 'local-generated'), ...tasks];
    taskState.paint();
  }
});
filesServices.termaGeneratedFiles = { current: () => generatedFiles, parent: generatedFileParent };
const taskWorkspace = createTaskWorkspace({
  state: taskState,
  runtime: {
    api: url => api(url),
    desktop: () => Boolean(window.termaDesktop),
    generated: generatedFiles.list,
    now: Date.now,
    tr: fileText,
    connectionName: id => applicationState.connections.find(item => Number(item.id) === id)?.name || '',
    jobs: () => taskState.jobs,
    publish: jobs => { taskState.jobs = jobs; },
    paint: taskState.paint,
    float: taskState.float,
    start: () => sftpTransfers.polling.start(),
    view: value => { taskState.view = value; },
    finishResize: () => filesServices.termaFileLayouts.taskCenter.finishSftpTaskCenterResize(null),
    monitor: drawer => filesServices.termaFileLayouts.taskCenter.ensureSftpTaskCenterBoundsMonitoring(drawer),
    restoreSize: drawer => filesServices.termaFileLayouts.taskCenter.restoreSftpTaskCenterSize(drawer),
    dismissed: taskState.dismissed,
    confirm: confirmModal,
    floating: () => runtimePreferences.snapshot !== null && runtimePreferences.snapshot?.saved?.sftp_floating_progress_enabled !== false,
    async saveFloating() {
      const result = await api<Record<string, unknown>>('/api/runtime-settings', {
        method: 'PUT', body: JSON.stringify({sftp_floating_progress_enabled: false})
      });
      runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({...runtimePreferences.snapshot, ...result});
    },
    notify: fileNotice
  },
  presentation: {
    localize: localizedTermaUiPhrase,
    raw: rememberTermaRawUiPhrase,
    language: () => normalizeTermaLanguage(document.documentElement.lang || window.i18next?.resolvedLanguage || 'zh-CN'),
    exists: (key, language) => Boolean(window.i18next?.exists(key, {lng: language, fallbackLng: false})),
    bytes: formatBytes
  },
  complete: sftpTransfers.completion.complete
});
filesServices.termaSftpTaskWorkspace = taskWorkspace;
installTaskActions({
  api: (url, options) => api(url, options),
  jobs: () => taskState.jobs,
  text: fileText,
  message: taskWorkspace.presentation.message,
  notify: fileNotice,
  confirm: confirmModal,
  refresh: () => taskWorkspace.runtime.refresh(),
  abortUpload: key => abortSftpUpload(taskState.uploads, key),
  paint: taskState.paint
});
registerStaticActions(events, openNewConnectionForm, { runtime: taskWorkspace.runtime, view: () => taskState.view });
const fileTransfers = createFileWorkspaceTransfers(filePages, {
  tab: key => sftpWorkspaceTab(key) ?? undefined,
  drag: () => sftpDragWorkspace.drag,
  track: job => sftpTransfers.completion.track(job),
  directoryError: error => fileNotice(errorMessage(error, fileText('sftp:auto.directory_sync_failed')), 'error'),
  dropError: message => fileNotice(message, 'error'),
  transfer: {
    target(target) {
      if (target.kind && target.kind !== 'sftp' && target.kind !== 'terminal') return null;
      const key = target.key || '', id = Number(target.id);
      const tab = sftpWorkspaceTab(key), runtime = sftpTabRuntimes.get(key);
      const directory = runtime?.state.path || target.path || '.';
      return {id, directory, valid: () => !key || (!tab || applicationState.tabs.includes(tab) && Number(tab.id) === id)
        && (!runtime || sftpTabRuntimes.get(key) === runtime && runtime.state.path === directory)};
    },
    request: (url, body, signal) => api(url, {method:'POST', body:JSON.stringify(body), signal}),
    list: (id, path, page, signal) => api(`/api/connections/${id}/sftp?` + new URLSearchParams({path, page:String(page), page_size:'200'}), {signal}),
    fetch: (id, path, signal) => fetch(`/api/connections/${id}/sftp/download?` + new URLSearchParams({path}), {signal, credentials:'same-origin'}),
    responseError: response => sharedServices.termaPublicErrors.fromResponse(response, fileText('sftp:web_files.transfer_failed')),
    conflict: (id, path, entries, title) => sftpFileTransfers.conflicts.upload(entries),
    choose: (items, source) => sftpFileTransfers.conflicts.receive(items, source === 'native' ? 'native' : 'web'),
    upload: (files, id, path, tabKey, directories) => sftpFileTransfers.controller.submit(files, id, path, {tabKey, directories}),
    download: (id, path, type) => sftpFileTransfers.controller.download(id, path, type),
    refreshJobs: () => taskWorkspace.runtime.refresh(),
    startJobs: () => sftpTransfers.polling.start(),
    text: fileText,
    notify: fileNotice
  }
});
filesServices.termaFileTransferRuntime = fileTransfers;
const workspaceTransfer = createWorkspaceTransfer({
  mobile: isMobileLayout,
  sourcePane: key => workspaceFindPaneForTab(key) ?? undefined,
  leaves: workspaceLeaves,
  tab(key) {
    const tab = workspaceTabByKey(key);
    return tab?.kind ? { ...tab, kind: tab.kind } : undefined;
  },
  title: tab => localizedWorkspaceTabTitle(workspaceTabByKey(tab.key) ?? {key: tab.key}),
  directory: key => filePages.files.states.get(key),
  webSource: key => Boolean(filePages.files.states.get(key)?.fileSource),
  connected: key => Boolean(terminalSessions.get(key)?.connected),
  pathKey: filesServices.termaFileDeliveryRefresh.pathKey,
  tr: fileText,
  plan: (paths, target) => api('/api/local-files/copy-plan', {method: 'POST', body: JSON.stringify({paths, target})}),
  copy: (paths, target, conflict) => api('/api/local-files/copy', {method: 'POST', body: JSON.stringify({paths, target, conflict})}),
  choose: async (...args) => await chooseModal(...args) ?? 'cancel',
  reload: (key, directory) => filePages.files.reload(key, directory),
  notify: message => fileNotice(message, 'success'),
  selected: sftpView.selectedEntries,
  localTo: (payload, target, kind) => kind === 'terminal' ? uploadLocalFilesToTerminalTab(payload, target) : fileTransfers.upload(payload, target, target.key),
  remoteTo(payload, target) {
    const entries = payload.entries.map(entry => normalizeDragEntry(entry)).filter(entry => entry !== null);
    if (!entries.length) return;
    const drag = {...payload, entries};
    if (target.kind !== 'sftp' && target.kind !== 'terminal') return fileTransfers.receive(drag, target);
    const destination = {...target, id: Number(target.id)};
    return target.kind === 'terminal' ? sftpDragWorkspace.drag.destinations.terminal(drag, destination) : sftpDragWorkspace.drag.destinations.remote(drag, destination);
  }
});
filesServices.termaWorkspaceTransfer = { current: () => workspaceTransfer };
const fileActions = createFileWorkspaceActions(filePages, fileTransfers, {
  request: (path, options) => api(path, options),
  responseError: response => sharedServices.termaPublicErrors.fromResponse(response),
  text: fileText,
  notify: fileNotice,
  desktop: () => Boolean(window.termaDesktop),
  windows: () => navigator.platform.toLowerCase().includes('win'),
  dialogs: filesServices.termaSftpDialogs!,
  menus: {
    active() {
      const tab = workspaceTabByKey(applicationState.activeTabKey);
      return tab ? {...tab, id: Number(tab.id)} : undefined;
    },
    connections: () => applicationState.connections,
    peers: (key, entries) => workspaceTransfer.localActions(key, {sourceTabKey:key, paths:entries.map(entry => entry.path), entries}),
    show: (event, actions) => filesServices.termaSftpMenus?.show(event, actions)
  },
  editPath: (key, editing) => filesServices.termaLocalFileViews.pathEditor(key, editing),
  prompt: inputModal,
  copy: text => copyText(text)
});
registerFilePageActions({
  native: () => fileActions.native,
  device: () => fileActions.device,
  mutations: () => fileActions.mutations,
  menus: () => fileActions.menus,
  drag: () => fileTransfers.drag,
  drop: () => fileTransfers.drop,
  openText: fileActions.openText,
  copy: text => copyText(text),
  error: fileActions.actionError,
  files: () => filePages.files,
  pages: () => filePages.pages,
  register: events.register,
  pathEditor: (key, editing) => filesServices.termaLocalFileViews.pathEditor(key, editing),
  scrollAnchor: filePages.scrollAnchor
});
filePages.installKeyboard((key, action) => filesServices.termaSftpViews?.search(key, action));
fileTransfers.drag.bind();
const sftpColumns = createSftpColumns({
  activeKey: () => applicationState.activeTabKey,
  exists: key => sftpTabRuntimes.has(key),
  render: key => sftpView.render(key),
  sort: (column, key) => sftpDirectory.navigation.sort(key, column),
  mobile: () => isMobileLayout(),
  runtime: key => sftpTabRuntimes.get(key) ?? null,
  ensureRuntime: key => sftpTabs.restore(key)
});
filesServices.termaSftpColumns = Object.assign(sftpColumns, {storageKey: SFTP_COLUMN_LAYOUT_STORAGE_KEY} as const);
const refreshSftpNavigation = (key: string) => sftpView.refresh(key, 'navigation');
filesServices.termaSftpPreferences = createSftpPreferences({
  storage: localStorage,
  directory(key) {
    const runtime = sftpTabRuntimes.get(key);
    if (!runtime) return null;
    const {connectionId: id, state: {path}} = runtime;
    return {id, path, valid: () => sftpTabRuntimes.get(key) === runtime && runtime.connectionId === id && runtime.state.path === path};
  },
  connection: id => applicationState.connections.find(item => Number(item.id) === id),
  keys: sftpTabKeys,
  encoding: (id, encoding) => api(`/api/connections/${id}/sftp-filename-encoding`, {method:'POST', body:JSON.stringify({encoding})}),
  reloadDirectory(key, connectionId) {
    const runtime = sftpTabRuntimes.get(key);
    return runtime ? sftpDirectory.loader.load({connectionId, path:runtime.state.path || '.', page:1, tabKey:key, refresh:true, keepContents:false}) : Promise.resolve(false);
  },
  changed(key) {
    sftpView.refreshDirectoryActions(key);
    refreshSftpNavigation(key);
  },
  prompt: (titleKey, labelKey, value) => Promise.resolve(filesServices.termaSftpDialogs?.input({tr: fileText, titleKey, labelKey, value})),
  text: fileText,
  notify: message => fileNotice(message, 'success')
});
function sftpPageView(key: string) {
  const pane = workspaceFindPaneForTab(key) || workspaceFindPaneForTab(applicationState.activeTabKey) || workspaceFindPane(workspaceDockState.focusedPaneId);
  return workspaceElementForTab(key, '#view-sftp') || (pane && workspacePaneElement(pane.id)?.querySelector<HTMLElement>('#view-sftp')) || $('view-sftp');
}
const sftpPage: ReturnType<typeof createSftpPageLifecycle> = createSftpPageLifecycle({
  active: () => applicationState.activeTabKey,
  isSftp: key => workspaceTabByKey(key)?.kind === 'sftp',
  pane: () => currentWorkspacePaneId() || workspaceDockState.focusedPaneId || '',
  next: sftpTabs.next,
  tab(key) {
    const tab = workspaceTabByKey(key);
    return tab?.kind === 'sftp' && typeof tab.id === 'number' ? {id:tab.id, kind:tab.kind, path:tab.path} : undefined;
  },
  openTab: (id, path, key) => sftpPage.open(id, path, true, key),
  connection: id => currentConnection(id)??null,
  select: (id, reveal) => selectConnection(id, {render:false, reveal})??null,
  usage: id => noteConnectionUsage(id, 'sftp'),
  view: sftpPageView,
  runtime: key => sftpTabRuntimes.get(key),
  restore: sftpTabs.restore,
  remember: sftpViewState.remember,
  watch: sftpColumns.watchSftpListLayout,
  disconnected: id => sftpTabKeys(id).some(key => applicationState.sftpDisconnectedTabs.has(key)),
  directory: sftpDirectory.cache.get,
  cached: sftpViewState.cached,
  restoreCache: sftpViewState.restore,
  rememberIndex: sftpTabs.remember,
  index: sftpTabs.displayIndex,
  workspace(title, connection, key, update, path, disconnected) {
    const quick = connection.quick_connection === true;
    setWorkspace(title, sftpConnectionAddress(connection), 'sftp', key, update, true, {
      kind:'sftp', id:connection.id, path, connectionStatus:disconnected ? 'disconnected' : 'connecting',
      transient:quick, quick_connection:quick, skipToolbarSync:true
    });
  },
  unavailable(key, id, path) {
    const tab = workspaceTabByKey(key);
    if (!tab || tab.kind !== 'sftp' || Number(tab.id) !== id) return false;
    const view = sftpPageView(key);
    if (!view || !sftpView.unavailable(view, key)) return false;
    setWorkspace(tab.title ?? '', tab.subtitle ?? '', 'sftp', key, false, tab.closable !== false, {
      kind:'sftp', id, path, connectionStatus:'disconnected', skipToolbarSync:true
    });
    return true;
  },
  scroll: (state, key) => sftpView.restore(state, key),
  paint(key, part) {
    if (part === 'list') sftpView.render(key);
    else if (part === 'actions') sftpView.refreshDirectoryActions(key);
    else refreshSftpNavigation(key);
  },
  flush: sftpTransfers.directories.flush,
  list: key => sftpView.element('sftpList', key),
  toolbar: key => sftpPage.toolbar(key),
  jobs() {
    void taskWorkspace.runtime.stale();
    sftpTransfers.polling.start();
  },
  session: key => sftpConnection.refresh(key),
  status: id => paintSftpConnection(id, 'disconnected'),
  load: options => sftpDirectory.loader.load(options),
  mount: (view, key) => sftpView.mount(view, key),
  register: (key, toolbar, mount) => workspaceServices.termaWorkspaceToolbar?.register('sftp', key, toolbar, mount),
  feedback: sftpDragWorkspace.browserDrop.restore,
  history: sftpDirectory.navigation.remember,
  place: (key, toolbar, mount) => workspaceServices.termaWorkspaceToolbar?.place('sftp', key, toolbar, mount),
  visibility: () => workspaceServices.termaWorkspaceToolbar?.visibility(),
  mobile: refreshSftpNavigation
});
filesServices.termaSftpPage = sftpPage;
filesServices.termaSftpRecycle = createSftpRecycleService({
  context(key) {
    const context = sftpTabs.dialogContext(key);
    return context && {key, connectionId:Number(context.tab.id), valid:context.valid};
  },
  api: (url, options) => api(url, options),
  show: options => { filesServices.termaSftpDialogs?.recycle(options); },
  close: () => { filesServices.termaSftpDialogs?.release(); },
  text: fileText,
  notify: message => fileNotice(message, 'success'),
  refresh(id) {
    sftpTransfers.directories.enqueue(id);
    sftpTransfers.directories.flush('');
  }
});
installSftpComparisonViews();
installSftpPreviewViews();
installSftpEditorViews();
const sftpPreview = installSftpPreviewWorkspace({
  api: (url, options) => api(url, options), text: fileText, bytes: formatBytes,
  notify: (message, level, options) => notify?.(message, level, options),
  connection: id => applicationState.connections.find(item => Number(item.id) === id) ?? null,
  openFile: filesServices.termaFileOpen, opening: sftpViewState.opening,
  refresh(id) {
    sftpTransfers.directories.enqueue(id);
    sftpTransfers.directories.flush('');
  },
  generated: generatedFiles.save,
  download: (id, path) => sftpFileTransfers.controller.download(id, path)
});
filesServices.termaSftpEntryActions = createSftpEntryActions({
  tabs: sftpTabs, preview: sftpPreview, connections: () => applicationState.connections, activeKey: () => applicationState.activeTabKey,
  api: (url, options) => api(url, options), text: fileText, notify: (message, kind) => notify?.(message, kind)
});
sftpDragWorkspace.bind();
installAboutMount(i18n, target => workspaceServices.termaWorkspaceViews?.retains(target) === true);
sharedServices.termaI18nRuntime?.registerRenderer(sftpView.language);
sharedServices.termaI18nRuntime?.registerRenderer(filePages.pages.language);
sharedServices.termaI18nRuntime?.registerRenderer(refreshWorkspaceLanguage);
void startWorkspace({
  refresh: () => taskWorkspace.runtime.refresh(),
  close: taskWorkspace.runtime.close,
  start: sftpTransfers.polling.start,
  stop: sftpTransfers.polling.stop
});


export interface InstalledEntriesAboutEmbedServices {
  termaNotificationEventContext?: () => {notificationMode?: string; updateIgnored?: boolean};
}
