import {terminalServices} from '@/features/terminal/installed-services';
import { normalizeTerminalStartupConfig } from './terminal-startup-model';

type Startup = ReturnType<typeof normalizeTerminalStartupConfig>;
export const terminalStartupOverrides = new Map<string, Partial<Startup>>();

export function terminalStartupConfigForConnection(connection: unknown) {
  return {...normalizeTerminalStartupConfig(connection || {})};
}

export function effectiveTerminalStartupConfig(connection: unknown, key: string) {
  return {...normalizeTerminalStartupConfig(terminalStartupOverrides.has(key)
    ? terminalStartupOverrides.get(key) : connection || {})};
}

export function installTerminalStartupState() {
  terminalServices.termaTerminalStartupState = {
    overrides: terminalStartupOverrides, effective: effectiveTerminalStartupConfig
  };
}



export interface InstalledFeaturesTerminalTerminalStartupStateServices {
  termaTerminalStartupState: {
      overrides: typeof terminalStartupOverrides;
      effective: typeof effectiveTerminalStartupConfig;
    };
}
