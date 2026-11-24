import type {InstalledFeaturesSessionEfficiencySessionRuntimeServices as Services0} from '@/features/session-efficiency/session-runtime';
import type {InstalledFeaturesSessionEfficiencyTerminalBroadcastWorkspaceServices as Services1} from '@/features/session-efficiency/terminal-broadcast-workspace';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledSessionEfficiencyServices=Services0 & Services1;
export const sessionEfficiencyServices:InstalledSessionEfficiencyServices={} as InstalledSessionEfficiencyServices;
