import {batchServices} from '@/features/batch/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {snippetsServices} from '@/features/snippets/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {applicationState} from '@/shared/application-state';
import {setTermaLanguage,tr} from '@/shared/i18n/workspace-bootstrap';
import {preferredTheme,applyTheme} from '@/shared/theme-runtime';
import {syncViewportHeight,bindNativeFileDialogViewportRecovery} from '@/shared/viewport-service';
import {hideActionMenu} from '@/shared/action-menu';
import {refreshIcons} from '@/shared/ui/icon-service';
import {isMobileLayout} from '@/shared/browser-ui';
import {pollNotifications,notify} from '@/features/efficiency/notification-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import { syncResponsivePane } from '@/features/workspace/workspace-dock-runtime';
import { installWorkspaceShell } from '@/features/workspace/workspace-shell-controller';
import { runtimePreferences } from '@/features/settings/runtime-settings-model';
import type {TerminalOutputFlowSession} from '../features/terminal/terminal-output-flow-service';
import {installApplicationLifecycleService, type ApplicationDesktopEvents} from './application-lifecycle-service';
import {installBootstrapRuntime} from './bootstrap-runtime';
import {installBootstrapBackgroundService, type BootstrapBackgroundPort} from './bootstrap-background';
import {createWorkspaceRestoreService, type WorkspaceRestorePort} from './workspace-restore';

interface WorkspaceTaskLifecycle {
  refresh(): Promise<unknown>;
  close(): void;
  start(): void;
  stop(): void;
}

function bindWorkspaceEvents(tasks: WorkspaceTaskLifecycle) {
  const dismissMenus = () => {hideActionMenu(); batchServices.termaBatch.hideContext(); filesServices.termaSftpEntryActions.menu.close(); workspaceServices.termaWorkspaceTabActions?.hideMenu();};
  document.addEventListener('contextmenu', event => batchServices.termaBatch.context(event));
  document.getElementById('modal')?.addEventListener('click', event => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', event => {
    dismissMenus();
    if (!(event.target instanceof Element) || !event.target.closest('#sftpTaskCenter')) tasks.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    dismissMenus();
    tasks.close();
  });
  document.addEventListener('scroll', () => {if (!isMobileLayout()) hideActionMenu();}, true);
}

function startApplicationLifecycle() {
  installApplicationLifecycleService({
    window, document,
    desktop: () => window.termaDesktop as ApplicationDesktopEvents | undefined,
    refreshTerminals: () => terminalServices.termaTerminalOutputFlow?.resumeSessions(terminalSessions.values()),
    syncVncClipboard: () => remoteServices.termaVncRuntime?.syncImagesAfterFocus(),
    openRemoteProfile(id) {
      if (!remoteServices.termaRemoteProfiles) return false;
      remoteServices.termaRemoteProfiles.editor.edit(id);
      return true;
    },
    notifyDragError: message => notify(message || tr('sftp:drag.native_start_failed', {defaultValue: '无法启动系统拖拽'}), 'error')
  }).start();
}

function startProductivity() {
  efficiencyServices.termaEfficiency.palette.ensure();
  sessionEfficiencyServices.termaSessionEfficiency.history.load();
  quickServices.termaQuickViews?.renderQuickHeader();
  if (document.getElementById('workspaceQuickActions')) x11Services.termaX11.manager.poll();
  efficiencyServices.termaEfficiency.keyboard();
  void snippetsServices.termaSnippets.service.load();
  // The workspace service retains its current list if the startup request fails.
  void quickServices.termaNamedWorkspacePresets.list().catch(() => {});
  void dataExchangeServices.termaSshConfigDiscovery.firstUse();
  refreshIcons();
}

async function initializeShell(tasks: WorkspaceTaskLifecycle) {
  await sharedServices.termaI18nRuntime?.ready();
  installWorkspaceShell();
  applicationState.workspaceRestorePending = true;
  applyTheme(preferredTheme());
  connectionsServices.termaConnectionViews?.renderExplorerTools();
  void settingsServices.termaUpdateStatus.loadCached();
  syncViewportHeight();
  bindNativeFileDialogViewportRecovery();
  startApplicationLifecycle();
  applicationState.restoringTabs = true;
  try {connectionsServices.termaConnectionViews?.renderWelcome();} finally {applicationState.restoringTabs = false;}
  bindWorkspaceEvents(tasks);
  refreshIcons();
  efficiencyServices.termaSystemNotifications.bindDesktop();
  const backgroundPort: BootstrapBackgroundPort = {
    startAutoRefresh: () => sharedServices.termaWorkspaceRefresh.start(),
    stopAutoRefresh: () => sharedServices.termaWorkspaceRefresh.stop(),
    pollNotifications: window.termaDesktop ? undefined : () => pollNotifications(),
    async refreshSftpJobs() {await tasks.refresh();},
    startSftpJobsTimer: tasks.start, stopSftpJobsTimer: tasks.stop, initProductivityFeatures: startProductivity
  };
  const background = installBootstrapBackgroundService();
  await background.start(backgroundPort, {detached: Boolean(remoteServices.termaVncDetached)});
  background.bindLifecycle(window);
}

function restoreWorkspace(detachedProfileId: number) {
  return createWorkspaceRestoreService({
    detached: () => Boolean(remoteServices.termaVncDetached), detachedProfileId: () => detachedProfileId,
    savedLanguage: () => runtimePreferences.snapshot?.saved?.language, documentLanguage: () => document.documentElement.lang,
    setLanguage: async (language, options) => {await setTermaLanguage(language, options);},
    async initDetachedVnc(id) {await remoteServices.termaVncRuntime.windows.init(id);},
    async ensureLanguageOnboarding() { await settingsServices.termaLanguageSettings.ensureOnboarding(); },
    restoreTabs() {
      const persistence = workspaceServices.termaWorkspacePersistence;
      if (!persistence) throw new Error('Workspace persistence is unavailable');
      return persistence.restore();
    },
    renderWelcome: () => connectionsServices.termaConnectionViews?.renderWelcome(), saveTabs: () => workspaceServices.termaWorkspacePersistence?.save(), syncResponsivePane,
    setRestorePending: value => {applicationState.workspaceRestorePending = value;},
    setRestoring: value => {applicationState.restoringTabs = value;}
  }).restore();
}

export async function startWorkspace(tasks: WorkspaceTaskLifecycle) {
  if (!document.getElementById('view-welcome')) return;
  const detachedProfileId = Number(document.documentElement.dataset.termaVncProfileId || 0);
  remoteServices.termaVncDetached = detachedProfileId > 0;
  const runtime = installBootstrapRuntime();
  try {
    await runtime.run({
      async waitForWorkspace() {
        if (!workspaceServices.termaWorkspaceViews) {
          await new Promise<void>(resolve => window.addEventListener('terma-workspace-views-ready', () => resolve(), {once: true}));
        }
      },
      initializeShell: () => initializeShell(tasks),
      async loadData() {
        const initialLanguage = document.documentElement.lang;
        await Promise.all([sharedServices.termaWorkspaceRefresh.load(), settingsServices.termaRuntimeReader.load()]);
        if (document.documentElement.lang !== initialLanguage) {
          connectionsServices.termaConnectionViews?.renderExplorerTools();
          connectionsServices.termaConnectionViews?.renderConnections();
        }
      },
      async restore() {await restoreWorkspace(detachedProfileId);}
    });
  } catch (cause) {
    applicationState.workspaceRestorePending = false;
    const message = cause instanceof Error ? cause.message : String(cause);
    runtime.mark('failed', {message});
    notify(message, 'error');
  }
}
