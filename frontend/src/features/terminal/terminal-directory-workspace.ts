import {workspaceServices} from '@/features/workspace/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {applicationState} from '@/shared/application-state';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {cleanTerminalCommandText} from '@/features/terminal/terminal-prompt';
import { workspaceTabByKey } from '../workspace/workspace-dock-state';
import { effectiveTerminalStartupConfig } from './terminal-startup-state';
import { createTerminalDirectoryService, type TerminalDirectorySession } from './terminal-directory-service';

export const terminalDirectory = createTerminalDirectoryService({
  current: session => !session.key || terminalSessions.get(session.key) === session,
  resolve: (id, path) => api(`/api/connections/${id}/sftp/resolve-directory?${new URLSearchParams({path})}`),
  startup: (connection, key) => effectiveTerminalStartupConfig(connection, key),
  remember: (session, directory) => {
    const tab = workspaceTabByKey(session.key || applicationState.activeTabKey);
    if (tab?.kind === 'terminal') {
      tab.lastKnownCwd = directory;
      workspaceServices.termaWorkspacePersistence?.save();
    }
  },
  clean: command => cleanTerminalCommandText(command),
  text: (key, params) => tr(key, params)
});

export function installTerminalDirectoryWorkspace() {
  terminalServices.termaTerminalDirectory = terminalDirectory;
}



export interface InstalledFeaturesTerminalTerminalDirectoryWorkspaceServices {
  termaTerminalDirectory: typeof terminalDirectory
}
