import type {InstalledFeaturesSettingsAboutMountServices as Services0} from '@/features/settings/about-mount';
import type {InstalledFeaturesSettingsDesktopStorageControllerServices as Services1} from '@/features/settings/desktop-storage-controller';
import type {InstalledFeaturesSettingsKeyWizardServiceServices as Services2} from '@/features/settings/key-wizard-service';
import type {InstalledFeaturesSettingsLanguageSettingsControllerServices as Services3} from '@/features/settings/language-settings-controller';
import type {InstalledFeaturesSettingsManagedKeysServiceServices as Services4} from '@/features/settings/managed-keys-service';
import type {InstalledFeaturesSettingsProgramCacheControllerServices as Services5} from '@/features/settings/program-cache-controller';
import type {InstalledFeaturesSettingsRuntimeSettingsModelServices as Services6} from '@/features/settings/runtime-settings-model';
import type {InstalledFeaturesSettingsRuntimeSettingsReaderServices as Services7} from '@/features/settings/runtime-settings-reader';
import type {InstalledFeaturesSettingsSettingsMountServices as Services8} from '@/features/settings/settings-mount';
import type {InstalledFeaturesSettingsSettingsNavigationControllerServices as Services9} from '@/features/settings/settings-navigation-controller';
import type {InstalledFeaturesSettingsSettingsRequestLifecycleServices as Services10} from '@/features/settings/settings-request-lifecycle';
import type {InstalledFeaturesSettingsSettingsServiceServices as Services11} from '@/features/settings/settings-service';
import type {InstalledFeaturesSettingsTrustedHostsControllerServices as Services12} from '@/features/settings/trusted-hosts-controller';
import type {InstalledFeaturesSettingsUpdateControllerServices as Services13} from '@/features/settings/update-controller';
import type {InstalledFeaturesSettingsUpdateDownloadControllerServices as Services14} from '@/features/settings/update-download-controller';
import type {InstalledFeaturesSettingsUpdateNoticeServices as Services15} from '@/features/settings/update-notice';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledSettingsServices=Services0 & Services1 & Services2 & Services3 & Services4 & Services5 & Services6 & Services7 & Services8 & Services9 & Services10 & Services11 & Services12 & Services13 & Services14 & Services15;
export const settingsServices:InstalledSettingsServices={} as InstalledSettingsServices;
