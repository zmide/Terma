import {settingsServices} from '@/features/settings/installed-services';
import { h } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';
import type { SettingsViewPort } from './settings-port';
import { settingsSections } from './settings-navigation-controller';

export function renderSettingsNavigation(scope: SettingsViewPort) {
  return settingsSections.map(([id, glyph, heading, key = heading]) => h(TermaButton, {
    key: id,
    class: { active: scope.activeSettingsSection === id },
    'data-explorer-section': id,
    'aria-current': scope.activeSettingsSection === id ? 'page' : undefined,
    onClick: (event: MouseEvent) => { event.stopPropagation(); void settingsServices.termaSettingsNavigation.open(id); }
  }, () => [settingsIcon(glyph), <span>{scope.tr(key)}</span>, id === 'settings-about'
    ? <i id="settingsExplorerUpdateDot" class="section-update-dot" hidden={!settingsServices.termaUpdateNotice.visible()} aria-label={scope.tr('common:auto.new_version')} />
    : null]));
}
