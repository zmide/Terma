import {settingsServices} from '@/features/settings/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {ensureTermaI18nResourceBundles,syncTermaLanguageControls,tr} from '@/shared/i18n/workspace-bootstrap';
import {normalizeTermaLanguage} from '@/shared/i18n/ui-phrase';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { openSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { errorMessage } from '../operations/operations-types';
import type { TermaLanguage } from '../../shared/i18n/runtime';
import type { SharedApiBridge } from '../../shared/api/bridge';
import { runtimePreferences, normalizeRuntimeSettingsResponse } from './runtime-settings-model';

const onboardingVersion = 1;

type LanguageSettings = {
  settings_persisted?: boolean;
  saved?: { language?: string; language_onboarding_version?: number };
};

interface LanguageSettingsPort {
  read(): LanguageSettings | null;
  merge(value: LanguageSettings): LanguageSettings;
  request: SharedApiBridge['request'];
  language(): string;
  locales(): readonly string[];
  normalize(value: unknown): TermaLanguage;
  apply(language: TermaLanguage, options?: { emit?: boolean }): Promise<unknown>;
  loadChoices(): Promise<unknown>;
  setToggleBusy(busy: boolean): void;
  syncControls(language: TermaLanguage): void;
  openDialog(view: LanguageOnboardingView): void;
  tr(key: string, options?: Record<string, unknown>): string;
  notify(message: string): void;
}

export interface LanguageOnboardingView {
  language: TermaLanguage;
  isNew: boolean;
  initialFocus: string;
  escapeDisabled: boolean;
  submit(language: TermaLanguage): Promise<boolean>;
}

function regionFromLocale(value: string) {
  const locale = value.trim().replace(/_/g, '-');
  if (!locale) return '';
  try { return new Intl.Locale(locale).maximize().region || ''; }
  catch { return locale.split('-').slice(1).find(part => /^[a-z]{2}$/i.test(part))?.toUpperCase() || ''; }
}

export function suggestedLanguage(locales: readonly string[]): TermaLanguage {
  return locales.map(regionFromLocale).find(Boolean) === 'CN' ? 'zh-CN' : 'en-US';
}

export function createLanguageSettingsController(port: LanguageSettingsPort) {
  let saving = false;
  let toggling = false;
  let preparing: Promise<boolean> | undefined;

  async function save(language: TermaLanguage, onboarding: boolean) {
    if (saving) return false;
    saving = true;
    try {
      const body = onboarding ? { language, language_onboarding_version: onboardingVersion } : { language };
      const result = await port.request<LanguageSettings>('/api/runtime-settings', { method: 'PUT', body: JSON.stringify(body) });
      await port.apply(port.normalize(port.merge(result).saved?.language));
      return true;
    } catch (error) {
      port.notify(errorMessage(error, onboarding
        ? port.tr('settings:language_onboarding.save_failed', { lng: language })
        : port.tr('errors:language_switch')));
      return false;
    } finally { saving = false; }
  }

  async function toggle() {
    if (saving || toggling) return false;
    toggling = true;
    const current = port.normalize(port.read()?.saved?.language || port.language());
    port.setToggleBusy(true);
    try {
      const changed = await save(current === 'zh-CN' ? 'en-US' : 'zh-CN', false);
      if (!changed) port.syncControls(current);
      return changed;
    } finally {
      toggling = false;
      port.setToggleBusy(false);
    }
  }

  async function prepare() {
    const settings = port.read();
    if (Number(settings?.saved?.language_onboarding_version || 0) >= onboardingVersion) return false;
    const existing = port.normalize(settings?.saved?.language);
    const isNew = settings?.settings_persisted !== true;
    const language = isNew ? suggestedLanguage(port.locales()) : existing;
    if (isNew && language !== existing) await port.apply(language, { emit: false });
    await port.loadChoices();
    port.openDialog({
      language, isNew, initialFocus: `input[value="${language}"]`, escapeDisabled: true,
      submit: value => save(value, true)
    });
    return true;
  }

  function ensureOnboarding() {
    preparing ??= prepare().finally(() => { preparing = undefined; });
    return preparing;
  }

  return { toggle, ensureOnboarding };
}

export function installLanguageSettingsController() {
  settingsServices.termaLanguageSettings = createLanguageSettingsController({
    read: () => runtimePreferences.snapshot,
    merge: result => runtimePreferences.snapshot = normalizeRuntimeSettingsResponse({ ...runtimePreferences.snapshot, ...result }),
    request: (path, options) => api(path, options),
    language: () => document.documentElement.lang,
    locales: () => navigator.languages?.length ? navigator.languages : [navigator.language],
    normalize: value => normalizeTermaLanguage(value),
    apply: (language, options) => sharedServices.termaI18nRuntime!.setLanguage(language, options),
    loadChoices: () => ensureTermaI18nResourceBundles(['en-US', 'zh-CN'], ['common', 'settings']),
    setToggleBusy(busy) {
      for (const button of document.querySelectorAll<HTMLButtonElement>('button.language-toggle')) {
        sharedServices.termaUiActions.setButtonBusy(button, busy);
      }
    },
    syncControls: language => syncTermaLanguageControls(language),
    openDialog: view => {
      const dialog = document.querySelector<HTMLElement>('#modal');
      if (dialog?.dataset.termaSettingsDialog !== 'language-onboarding') openSettingsDialog('language-onboarding', view);
    },
    tr: (key, options) => tr(key, options),
    notify: message => notify(message, 'error')
  });
}



export interface InstalledFeaturesSettingsLanguageSettingsControllerServices {
  termaLanguageSettings: ReturnType<typeof createLanguageSettingsController>
}
