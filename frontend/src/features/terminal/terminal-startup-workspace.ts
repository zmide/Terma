import {terminalServices} from '@/features/terminal/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {confirmModal} from '@/shared/workspace-prompts';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {setButtonBusy} from '@/shared/ui-action-service';
import {isMobileLayout} from '@/shared/browser-ui';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {writeClipboardText} from '@/shared/clipboard-service';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {reconnectTerminal} from '@/features/terminal/terminal-connection-runtime';
import {terminalActionConnection} from '@/features/terminal/terminal-metadata';
import { terminalStartupOverrides, effectiveTerminalStartupConfig } from '@/features/terminal/terminal-startup-state';
import type { ManagementConnection } from '../remote/management-types';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import type { confirmModal as confirmWorkspaceModal } from '../../shared/workspace-prompts';
import type { TerminalStartupOptions } from './TerminalStartupView';
import { createTerminalStartupService, type TerminalStartupPort } from './terminal-startup-service';

type TerminalStartupWorkspace = ReturnType<typeof createTerminalStartupService> & {
  open(key: string, id: number): void;
};

export function installTerminalStartupWorkspace(): TerminalStartupWorkspace {
  if (terminalServices.termaTerminalStartup) return terminalServices.termaTerminalStartup;
  let owner: TerminalStartupOptions | null = null;
  const modal = () => document.getElementById('modal');
  const field = (id: string) => modal()?.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value || '';
  const refreshToolbar = (key: string) => terminalServices.termaTerminalToolbar?.refresh(key);
  const views = () => terminalServices.termaTerminalViews;
  const visibleOwner = () => views()?.startupOptions() === owner ? owner : null;
  const service = createTerminalStartupService({
    componentManagement: {
      options: () => owner,
      connection: id => currentConnection(id) ?? undefined,
      unlocked: label => requireConfigEncryptionUnlocked(label),
      guides: () => remoteServices.termaRemoteManagement.guides,
      tasks: () => remoteServices.termaRemoteManagement.tasks,
      prompt: async (...args) => views()?.promptStartup(...args) ?? null,
      confirmLocal: () => confirmModal(
        () => tr('terminal:session.local_confirm'), () => tr('terminal:session.title'),
        () => tr('common:actions.continue'), () => tr('common:actions.cancel'), true),
      authorize: (id, label, scope, valid) => remoteServices.termaRemoteManagement.authorize(id, label, scope, valid),
      copy: async commands => {
        await writeClipboardText(commands.join('\n\n'));
        notify(tr('remote:install.commands_copied'), 'success');
      },
      refreshTasks: () => filesServices.termaSftpTaskWorkspace.runtime.refresh()
    },
    api: (path, options) => api(path, options),
    tr: (key, params) => tr(key, params),
    notify: (message, kind) => notify(message, kind),
    connection: (key, id) => terminalActionConnection(key, id) as ReturnType<TerminalStartupPort['connection']>,
    savedConnection: id => currentConnection(id)??null,
    enqueue: (id, action) => {
      const preferences = terminalServices.termaTerminalPreferences;
      return preferences ? preferences.enqueue(id, action) : Promise.reject(new Error(tr('terminal:startup.apply_failed')));
    },
    effective: (connection, key) => effectiveTerminalStartupConfig(connection, key),
    temporary: key => terminalStartupOverrides.has(key),
    override: (key, value) => { if (value) terminalStartupOverrides.set(key, value); else terminalStartupOverrides.delete(key); },
    context: () => owner,
    isCurrent: (context, key, id) => {
      const options = visibleOwner();
      return !!options && !modal()?.hidden && options === context && options.key === key && options.connectionId === id
        && applicationState.tabs.some(tab => tab.kind === 'terminal' && tab.key === key && Number(tab.id) === id);
    },
    applying: () => Boolean(owner?.busy),
    busy: (context, value) => {
      const options = visibleOwner();
      if (!options || options !== context) return;
      options.busy = value;
      options.refresh?.();
      modal()?.setAttribute('aria-busy', String(value));
    },
    buttonBusy: (button, busy, label) => setButtonBusy(button, busy, label),
    formValue: () => ({
      terminal_startup_mode: field('terminalStartupProfile') || 'default',
      terminal_profile_name: field('terminalStartupProfileName'),
      terminal_profile_kind: field('terminalStartupKind') || 'custom',
      terminal_program_path: field('terminalStartupPath'),
      terminal_program_args: field('terminalStartupArgs'),
      terminal_working_directory: field('terminalStartupCwd'),
      terminal_program_platform: field('terminalStartupPlatform') || 'auto'
    }),
    saveDefaultChecked: () => Boolean(modal()?.querySelector<HTMLInputElement>('#terminalStartupSaveDefault')?.checked),
    refresh: () => visibleOwner()?.refresh?.(),
    close: (key, focus) => {
      if (visibleOwner()?.key !== key) return;
      owner = null;
      modal()?.removeAttribute('aria-busy');
      closeModal();
      if (focus) focusTerminalSession(key);
    },
    updateButton: refreshToolbar,
    updateButtons: id => {
      for (const tab of applicationState.tabs) {
        if (tab.kind === 'terminal' && Number(tab.id) === id) refreshToolbar(tab.key);
      }
    },
    reconnect: (id, key) => reconnectTerminal(id, key),
    mobile: () => isMobileLayout(),
    duplicate: (key, splitZone, beforeOpen) => {
      const result: {split?: boolean} = {};
      const copy = workspaceServices.termaWorkspaceTabCopy.duplicate(key, {splitZone, beforeOpen, result});
      return copy ? {key: copy, split: result.split === true} : null;
    }
  });

  function open(key: string, id: number) {
    const view = views();
    if (!view || !requireConfigEncryptionUnlocked(tr('terminal:startup.modify_title'))) return;
    const options = service.options(key, id);
    if (!options) return;
    owner = options;
    modal()?.removeAttribute('aria-busy');
    view.showStartupSettings(options);
    void options.actions.detect();
  }

  return terminalServices.termaTerminalStartup = { ...service, open };
}



export interface InstalledFeaturesTerminalTerminalStartupWorkspaceServices {
  termaTerminalStartup?: TerminalStartupWorkspace;
}
