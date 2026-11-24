import type { i18n } from 'i18next';
import type { AboutInfo } from '@/app/AboutPage';
import type { DesktopSettings } from './desktop-storage-controller';

// Explicit compatibility boundary to existing settings services. Views own their DOM.
export interface SettingsViewPort {
  activeSettingsSection: string;
  loadState?: { loading?: boolean; error?: string };
  openSettings: (updateTab?: boolean) => Promise<void>;
  aboutI18n: i18n;
  updateSnapshot?: unknown;
  desktopSettings: DesktopSettings | null;
  runtimeSettings: any;
  tr: (...args: any[]) => any;
  saveDesktopSettings: (...args: any[]) => any;
  saveWebStorageSettings: (...args: any[]) => any;
  syncDesktopCustomDataMode: (...args: any[]) => any;
  chooseDesktopDataDirectory: (...args: any[]) => any;
  openStorageDirectoryBrowser: (...args: any[]) => any;
  chooseDesktopVncClient: (...args: any[]) => any;
  securitySettings: any;
  formatBytes: (...args: any[]) => any;
  settingsRoot: HTMLElement | null;
  aboutSettings?: AboutInfo;
}
