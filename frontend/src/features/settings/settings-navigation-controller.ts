import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import { currentWorkspaceDomScope, captureWorkspaceTab } from '@/features/workspace/workspace-pane-scope';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { loadManagedKeys } from './managed-key-settings';

export const settingsSections = [
  ['settings-general', 'settings-2', 'settings:sections.general', 'common:auto.general_settings'],
  ['settings-ai', 'sparkles', 'settings:sections.ai'],
  ['settings-basic', 'shield-check', 'settings:sections.security', 'common:auto.security'],
  ['settings-key-management', 'key-round', 'settings:sections.key_management'],
  ['settings-notifications', 'bell', 'settings:sections.notifications', 'common:auto.notification_settings'],
  ['settings-runtime', 'activity', 'settings:sections.runtime', 'common:auto.startup_runtime'],
  ['settings-cache', 'hard-drive', 'settings:sections.cache', 'common:auto.cache_management'],
  ['settings-about', 'info', 'settings:sections.about', 'common:auto.about']
] as const;

type SettingsSection = typeof settingsSections[number][0];
type PaneScope = (action: () => void) => void;
type SelectionOptions = { moveToWorkspace?: boolean };
interface NavigationPort {
  capturePane(): PaneScope;
  activitySequence(): number;
  inSettings(): boolean;
  openSettings(): Promise<void>;
  paintSelection(id: SettingsSection, options: SelectionOptions): void;
  tr(key: string): string;
}

function sectionEntry(id: string) {
  return settingsSections.find(([key]) => key === (id === 'settings-advanced' ? 'settings-basic' : id)) ?? settingsSections[0];
}

export function createSettingsNavigation(port: NavigationPort) {
  let section: SettingsSection = 'settings-general';
  let request = 0;

  function show(id: string = section, options: SelectionOptions = {}) {
    section = sectionEntry(id)[0];
    port.paintSelection(section, options);
  }

  async function open(id: string) {
    const activity = port.activitySequence();
    const selection = ++request;
    section = sectionEntry(id)[0];
    const opening = port.inSettings() ? null : port.openSettings();
    const inPane = port.capturePane();
    if (opening) await opening;
    if (selection !== request || activity !== port.activitySequence() || !port.inSettings()) return;
    inPane(() => show());
  }

  return { get section() { return section; }, show, open, label: (id: string = section) => port.tr(sectionEntry(id)[2]) };
}

export function installSettingsNavigation(openSettings: () => Promise<void>) {
  settingsServices.termaSettingsNavigation = createSettingsNavigation({
    capturePane: () => captureWorkspaceTab(applicationState.activeTabKey), activitySequence: workspaceShell.activitySequence,
    inSettings: () => applicationState.activeView === 'settings', openSettings: () => openSettings(), tr: key => tr(key),
    paintSelection(id, {moveToWorkspace = true}) {
      const target = $('view-settings');
      if (target) settingsServices.termaRefreshVueSettings?.(target);
      const tools = $('explorerTools');
      if (tools?.dataset.termaSettingsOwned) settingsServices.termaRefreshVueSettings?.(tools);
      if (applicationState.activeView === 'settings' && $('workspaceSubtitle')) workspaceShell.setHeading(tr(sectionEntry(id)[2]));
      if (id === 'settings-about') settingsServices.termaUpdateNotice.markRead();
      if (moveToWorkspace) {
        (currentWorkspaceDomScope() ?? document).querySelector('.workspace')?.scrollTo?.({top: 0, behavior: 'auto'});
        if (isMobileLayout()) workspaceShell.showMobileWorkspace();
      }
      if (id === 'settings-key-management') void loadManagedKeys($('view-settings'));
    }
  });
}



export interface InstalledFeaturesSettingsSettingsNavigationControllerServices {
  termaSettingsNavigation: ReturnType<typeof createSettingsNavigation>
}
