import type {InstalledFeaturesRemoteClientRuntimeServices as Services0} from '@/features/remote/client-runtime';
import type {InstalledFeaturesRemoteManagementRuntimeServices as Services1} from '@/features/remote/management-runtime';
import type {InstalledFeaturesRemoteProfileListRuntimeServices as Services2} from '@/features/remote/profile-list-runtime';
import type {InstalledFeaturesRemoteProfileRuntimeServices as Services3} from '@/features/remote/profile-runtime';
import type {InstalledFeaturesRemoteRemoteDesktopRuntimeServices as Services4} from '@/features/remote/remote-desktop-runtime';
import type {InstalledFeaturesRemoteRemoteFtpViewServices as Services5} from '@/features/remote/RemoteFtpView';
import type {InstalledFeaturesRemoteTransportRuntimeServices as Services6} from '@/features/remote/transport-runtime';
import type {InstalledFeaturesRemoteVncRuntimeServices as Services7} from '@/features/remote/vnc-runtime';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledRemoteServices=Services0 & Services1 & Services2 & Services3 & Services4 & Services5 & Services6 & Services7;
export const remoteServices:InstalledRemoteServices={} as InstalledRemoteServices;
