import type {InstalledFeaturesLogsLogListViewsServices as Services0} from '@/features/logs/LogListViews';
import type {InstalledFeaturesLogsLogMaintenanceViewsServices as Services1} from '@/features/logs/LogMaintenanceViews';
import type {InstalledFeaturesLogsLogReaderViewsServices as Services2} from '@/features/logs/LogReaderViews';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledLogsServices=Services0 & Services1 & Services2;
export const logsServices:InstalledLogsServices={} as InstalledLogsServices;
