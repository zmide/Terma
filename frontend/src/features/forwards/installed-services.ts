import type {InstalledFeaturesForwardsForwardWorkspaceServices as Services0} from '@/features/forwards/forward-workspace';
import type {InstalledFeaturesForwardsForwardPagesServices as Services1} from '@/features/forwards/ForwardPages';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledForwardsServices=Services0 & Services1;
export const forwardsServices:InstalledForwardsServices={} as InstalledForwardsServices;
