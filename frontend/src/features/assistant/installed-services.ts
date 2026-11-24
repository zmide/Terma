import type {InstalledFeaturesAssistantAssistantRuntimeServices as Services0} from '@/features/assistant/assistant-runtime';
import type {InstalledFeaturesAssistantPlatformAdapterServiceServices as Services1} from '@/features/assistant/platform-adapter-service';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledAssistantServices=Services0 & Services1;
export const assistantServices:InstalledAssistantServices={} as InstalledAssistantServices;
