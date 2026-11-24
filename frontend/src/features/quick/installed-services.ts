import type {InstalledFeaturesQuickCommandNavigationServices as Services0} from '@/features/quick/command-navigation';
import type {InstalledFeaturesQuickNamedWorkspaceServiceServices as Services1} from '@/features/quick/named-workspace-service';
import type {InstalledFeaturesQuickNamedWorkspaceViewsServices as Services2} from '@/features/quick/NamedWorkspaceViews';
import type {InstalledFeaturesQuickQuickConnectActionsServices as Services3} from '@/features/quick/quick-connect-actions';
import type {InstalledFeaturesQuickQuickConnectSearchServiceServices as Services4} from '@/features/quick/quick-connect-search-service';
import type {InstalledFeaturesQuickQuickMountServices as Services5} from '@/features/quick/quick-mount';
import type {InstalledFeaturesQuickQuickSshServiceServices as Services6} from '@/features/quick/quick-ssh-service';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledQuickServices=Services0 & Services1 & Services2 & Services3 & Services4 & Services5 & Services6;
export const quickServices:InstalledQuickServices={} as InstalledQuickServices;
