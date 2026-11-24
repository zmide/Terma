import {resourceLoader} from './resource-loader';
import {TERMA_I18N_PHRASE_INDEX,type LanguageResources} from './phrase-index';
import {createTermaPhraseTranslation} from './phrase-translation';
import {TERMA_I18N_OBSERVATION} from './translation-observer';
type TermaBootstrapLanguage = 'zh-CN' | 'en-US';
type TermaI18Next = import('i18next').i18n;
declare global {interface Window {i18next?:TermaI18Next}}

const TERMA_I18N_RESOURCE_LOADER=resourceLoader;
const TERMA_I18N_PHRASE_COMPATIBILITY=TERMA_I18N_PHRASE_INDEX;
const TERMA_I18N_LANGUAGES = TERMA_I18N_RESOURCE_LOADER.languages;
const TERMA_I18N_NAMESPACES = TERMA_I18N_RESOURCE_LOADER.namespaces;

let termaI18nLanguage: TermaBootstrapLanguage = "zh-CN";
export let termaI18nLanguageRevision = 0;
let termaI18nInitialized = false;
const termaI18nRenderers = new Set<(language: TermaBootstrapLanguage) => void>();
const termaPhraseTranslation = createTermaPhraseTranslation(() => termaI18nLanguage, tr, TERMA_I18N_PHRASE_COMPATIBILITY);
let termaDomTranslation: ReturnType<typeof TERMA_I18N_OBSERVATION.createRenderer> | undefined;
export function termaDomRenderer() {
  return termaDomTranslation ||= TERMA_I18N_OBSERVATION.createRenderer({document, phrase:translatedTermaPhrase, translate:tr});
}

export function normalizeTermaLanguage(value: unknown) {
  return TERMA_I18N_RESOURCE_LOADER.normalizeLanguage(value);
}

export function rememberTermaRawUiPhrase(value: unknown) { return termaPhraseTranslation.remember(value); }
export function isTermaRawUiPhrase(value: unknown) { return termaPhraseTranslation.isRaw(value); }

export async function loadTermaI18nResources() {
  return TERMA_I18N_RESOURCE_LOADER.loadAll();
}

export function currentTermaI18nResources() {
  const resources: LanguageResources = {};
  for (const language of TERMA_I18N_LANGUAGES) {
    const bundles: Record<string, unknown> = {};
    resources[language] = bundles;
    for (const namespace of TERMA_I18N_NAMESPACES) {
      const bundle = window.i18next?.getResourceBundle?.(language, namespace);
      if (bundle) bundles[namespace] = bundle;
    }
  }
  return resources;
}

export async function ensureTermaI18nResourceBundles(languages=TERMA_I18N_LANGUAGES, namespaces=TERMA_I18N_NAMESPACES) {
  if (!window.i18next) throw new Error("I18NEXT_RUNTIME_MISSING");
  const changed = await TERMA_I18N_RESOURCE_LOADER.ensureBundles(window.i18next, languages, namespaces);
  if (changed) rebuildTermaI18nPhraseIndex(currentTermaI18nResources());
  return changed;
}

export function rebuildTermaI18nPhraseIndex(resources: LanguageResources) {
  TERMA_I18N_PHRASE_COMPATIBILITY.rebuild(resources);
}

export function termaI18nSkipped(element: Element | null) { return termaDomRenderer().shouldSkip(element); }
export function translatedTermaPhrase(value: unknown) { return termaPhraseTranslation.translate(value); }
export function applyTermaAutomaticTranslations(root: Node = document) { termaDomRenderer().applyAutomatic(root?.nodeType ? root : document); }

export function tr(key: unknown, options: Record<string, unknown> = {}): string {
  const name = String(key || "");
  if (!/^(?:[a-z0-9_-]+:)?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(name)) return String(options.defaultValue || name);
  if (!termaI18nInitialized || !window.i18next) return String(options.defaultValue || name);
  return window.i18next.t(name, options);
}

export function applyTermaTranslations(root: Node = document) { termaDomRenderer().apply(root); }

export function registerTermaI18nRenderer(renderer: (language: TermaBootstrapLanguage) => void) {
  if (typeof renderer !== "function") return () => {};
  termaI18nRenderers.add(renderer);
  return () => { termaI18nRenderers.delete(renderer); };
}

export function syncTermaLanguageControls(language: unknown = termaI18nLanguage) {
  const target = normalizeTermaLanguage(language) === "zh-CN" ? "en-US" : "zh-CN";
  const targetLabel = tr(`common:languages.${target}`, {defaultValue:target === "zh-CN" ? "简体中文" : "English"});
  const label = tr("common:language.switch_to", {target:targetLabel, defaultValue:`切换到 ${targetLabel}`});
  for (const button of document.querySelectorAll<HTMLElement>(".language-toggle")) {
    if (button.closest("[data-terma-shell-owned]")) continue;
    button.dataset.language = normalizeTermaLanguage(language);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", target === "zh-CN" ? "true" : "false");
  }
}

export async function setTermaLanguage(value: unknown, options: {render?: boolean; emit?: boolean} = {}) {
  termaI18nLanguageRevision += 1;
  const language = normalizeTermaLanguage(value);
  await initializeWorkspaceI18n();
  const i18next = window.i18next;
  if (!i18next) throw new Error("I18NEXT_RUNTIME_MISSING");
  if (i18next.language !== language) await i18next.changeLanguage(language);
  termaI18nLanguage = language;
  document.documentElement.lang = language;
  const termaDesktop = window.termaDesktop as {setInterfaceLanguage?(language: TermaBootstrapLanguage): void} | undefined;
  termaDesktop?.setInterfaceLanguage?.(language);
  applyTermaTranslations(document);
  syncTermaLanguageControls(language);
  if (options.render !== false) {
    for (const renderer of [...termaI18nRenderers]) {
      try { renderer(language); } catch (error) { console.error(error); }
    }
    // Renderers can replace translated DOM with freshly generated default-language markup.
    // Apply once more synchronously so language switches never leave mixed-language controls.
    applyTermaTranslations(document);
  }
  if (options.emit !== false) window.dispatchEvent(new CustomEvent("terma:language-changed", {detail:{language}}));
  return language;
}

export let i18nReady: Promise<TermaI18Next | null> | undefined;
export function initializeWorkspaceI18n() {
  return i18nReady ||= typeof document==="undefined"?Promise.resolve(null):(async () => {
  if (!window.i18next) throw new Error("I18NEXT_RUNTIME_MISSING");
  const resources = await loadTermaI18nResources();
  rebuildTermaI18nPhraseIndex(resources);
  await window.i18next.init({
    lng:"zh-CN",
    fallbackLng:"zh-CN",
    supportedLngs:[...TERMA_I18N_LANGUAGES],
    ns:[...TERMA_I18N_NAMESPACES],
    defaultNS:"common",
    resources,
    interpolation:{escapeValue:false},
    returnEmptyString:false
  });
  termaI18nInitialized = true;
  document.documentElement.lang = termaI18nLanguage;
  applyTermaTranslations(document);
  syncTermaLanguageControls(termaI18nLanguage);
  const observer = TERMA_I18N_OBSERVATION.create({
    document, attributes: TERMA_I18N_OBSERVATION.attributes,
    shouldSkip: termaI18nSkipped, apply: applyTermaAutomaticTranslations
  });
  observer.start();
  window.addEventListener("pagehide", observer.stop);
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    applyTermaAutomaticTranslations(document);
    observer.start();
  });
  return window.i18next;
})().catch(error => {
  console.error("Terma i18n initialization failed", error);
  return null;
  });
}
