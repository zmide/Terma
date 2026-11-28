import type {TerminalSurfaceSession} from './terminal-surface-service';
import type {TerminalInteractionSession} from './terminal-interaction-service';
import type {TerminalConnection, TerminalConnectionSession} from './terminal-connection-service';
import type {TerminalOutputFlowSession} from './terminal-output-flow-service';
import type {TerminalCommandTrackingSession} from './terminal-command-tracking-service';
import type {TerminalDirectorySession} from './terminal-directory-service';
import type {TerminalSettingsSession} from './terminal-settings-service';
import type {ZmodemRuntimeSession} from './terminal-zmodem-types';
import type {TrackingSession} from '../assistant/terminal-ai-tracker';
import type {ManagementConnection} from '../remote/management-types';
import type {TerminalPreferences} from './terminal-preferences-service';
import type {TerminalStartupConfig} from './TerminalStartupView';

// One live engine record is shared by the existing domain services.
export type TerminalSession = TerminalSurfaceSession & TerminalInteractionSession
  & TerminalConnectionSession & TerminalOutputFlowSession & TerminalCommandTrackingSession
  & TerminalDirectorySession & TerminalSettingsSession & ZmodemRuntimeSession & TrackingSession
  & {connection: TerminalConnection & ManagementConnection
      & Partial<TerminalPreferences & TerminalStartupConfig> & Record<string, unknown>};

export function createTerminalSessionState() {
  return {
    terminalSessions: new Map<string, TerminalSession>(),
    terminalSurfaceCache: new Map<string, HTMLElement>(),
    terminalCounts: new Map<number, number>(),
    auxiliaryTerminalOwners: new Map<string, string>(),
  };
}

export const {terminalSessions, terminalSurfaceCache, terminalCounts, auxiliaryTerminalOwners} = createTerminalSessionState();

export function registerAuxiliaryTerminalSession(key: string, ownerKey: string) {
  if (!key || !ownerKey || key === ownerKey) return false;
  auxiliaryTerminalOwners.set(key, ownerKey);
  return true;
}

export function releaseAuxiliaryTerminalSession(key: string) {
  auxiliaryTerminalOwners.delete(key);
}

export function auxiliaryTerminalOwner(key: string) {
  return auxiliaryTerminalOwners.get(key) || '';
}

export function terminalSessionHasWorkspaceOwner(key: string, hasWorkspaceTab: (key: string) => boolean) {
  if (hasWorkspaceTab(key)) return true;
  const owner = auxiliaryTerminalOwner(key);
  return Boolean(owner) && hasWorkspaceTab(owner);
}


