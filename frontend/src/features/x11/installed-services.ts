import type {InstalledFeaturesX11TerminalMenuServiceServices as Services0} from '@/features/x11/terminal-menu-service';
import type {InstalledFeaturesX11X11RuntimeServices as Services1} from '@/features/x11/x11-runtime';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledX11Services=Services0 & Services1;
export const x11Services:InstalledX11Services={} as InstalledX11Services;
