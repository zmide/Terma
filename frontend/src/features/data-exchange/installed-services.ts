import type {InstalledFeaturesDataExchangeExchangeViewsServices as Services0} from '@/features/data-exchange/ExchangeViews';
import type {InstalledFeaturesDataExchangeSshConfigDiscoveryServices as Services1} from '@/features/data-exchange/ssh-config-discovery';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledDataExchangeServices=Services0 & Services1;
export const dataExchangeServices:InstalledDataExchangeServices={} as InstalledDataExchangeServices;
