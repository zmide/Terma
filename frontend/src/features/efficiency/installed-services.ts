import type {InstalledFeaturesEfficiencyEfficiencyRuntimeServices as Services0} from '@/features/efficiency/efficiency-runtime';
import type {InstalledFeaturesEfficiencyNotificationEventServiceServices as Services1} from '@/features/efficiency/notification-event-service';
import type {InstalledFeaturesEfficiencyNotificationPollingServiceServices as Services2} from '@/features/efficiency/notification-polling-service';
import type {InstalledFeaturesEfficiencyNotificationStateServiceServices as Services3} from '@/features/efficiency/notification-state-service';
import type {InstalledFeaturesEfficiencyNotificationToastViewServices as Services4} from '@/features/efficiency/NotificationToastView';
import type {InstalledFeaturesEfficiencySystemNotificationServiceServices as Services5} from '@/features/efficiency/system-notification-service';
import type {InstalledFeaturesEfficiencyTerminalActivityServiceServices as Services6} from '@/features/efficiency/terminal-activity-service';
import type {InstalledFeaturesEfficiencyTerminalBroadcastServiceServices as Services7} from '@/features/efficiency/terminal-broadcast-service';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledEfficiencyServices=Services0 & Services1 & Services2 & Services3 & Services4 & Services5 & Services6 & Services7;
export const efficiencyServices:InstalledEfficiencyServices={} as InstalledEfficiencyServices;
