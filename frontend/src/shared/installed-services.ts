import type {InstalledEntriesAboutEmbedServices as Services0} from '@/entries/about-embed';
import type {InstalledSharedActionsActionRegistryServices as Services1} from '@/shared/actions/action-registry';
import type {InstalledSharedActionsEventRegistryServices as Services2} from '@/shared/actions/event-registry';
import type {InstalledSharedApiBridgeServices as Services3} from '@/shared/api/bridge';
import type {InstalledSharedApiPublicErrorsServices as Services4} from '@/shared/api/public-errors';
import type {InstalledSharedApiWorkspaceRequestServices as Services5} from '@/shared/api/workspace-request';
import type {InstalledSharedApplicationLifecycleServiceServices as Services6} from '@/shared/application-lifecycle-service';
import type {InstalledSharedBootstrapBackgroundServices as Services7} from '@/shared/bootstrap-background';
import type {InstalledSharedBootstrapRuntimeServices as Services8} from '@/shared/bootstrap-runtime';
import type {InstalledSharedClipboardServiceServices as Services9} from '@/shared/clipboard-service';
import type {InstalledSharedDesktopIntegrationServiceServices as Services10} from '@/shared/desktop-integration-service';
import type {InstalledSharedFormControlsServices as Services11} from '@/shared/form-controls';
import type {InstalledSharedI18nRuntimeServices as Services12} from '@/shared/i18n/runtime';
import type {InstalledSharedStateStateRegistryServices as Services13} from '@/shared/state/state-registry';
import type {InstalledSharedUiIconServiceServices as Services14} from '@/shared/ui/icon-service';
import type {InstalledSharedUiActionServiceServices as Services15} from '@/shared/ui-action-service';
import type {InstalledSharedUiSnapshotServiceServices as Services16} from '@/shared/ui-snapshot-service';
import type {InstalledSharedViewportServiceServices as Services17} from '@/shared/viewport-service';
import type {InstalledSharedWorkspaceRefreshServices as Services18} from '@/shared/workspace-refresh';

// Installed instances are owned by this domain. Factories and lifecycle hooks remain in their modules.
export type InstalledSharedServices=Services0 & Services1 & Services2 & Services3 & Services4 & Services5 & Services6 & Services7 & Services8 & Services9 & Services10 & Services11 & Services12 & Services13 & Services14 & Services15 & Services16 & Services17 & Services18;
export const sharedServices:InstalledSharedServices={} as InstalledSharedServices;
