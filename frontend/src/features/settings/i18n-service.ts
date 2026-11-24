import { createI18nRuntime, installI18nRuntime } from '../../shared/i18n/runtime';

export type { I18nRuntime, I18nRuntimeSource, TermaLanguage } from '../../shared/i18n/runtime';

export function installSettingsI18n() {
  return installI18nRuntime();
}

export { createI18nRuntime };
