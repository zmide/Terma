import {terminalServices} from '@/features/terminal/installed-services';
import { terminalShortcutConfig, type TerminalShortcutConfigService } from '../../../../src/shared/terminal-shortcut-config';

export { createTerminalShortcutConfigService } from '../../../../src/shared/terminal-shortcut-config';
export type { TerminalShortcutConfigService } from '../../../../src/shared/terminal-shortcut-config';



export function installTerminalShortcutConfigService() {
  terminalServices.termaTerminalShortcuts = terminalShortcutConfig;
}

export interface InstalledFeaturesTerminalTerminalShortcutConfigServiceServices {
  termaTerminalShortcuts?: TerminalShortcutConfigService;
}
