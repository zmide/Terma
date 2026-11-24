import {sharedServices} from '@/shared/installed-services';
import * as workspaceLanguage from './workspace-bootstrap';
export type TermaLanguage = 'zh-CN' | 'en-US';

export interface I18nRuntimeSource {
  getLanguage?: () => string;
  ready?: Promise<unknown> | (() => Promise<unknown>);
  translate?: (key: string, options?: Record<string, unknown>) => string;
  setLanguage?: (language: TermaLanguage, options?: Record<string, unknown>) => Promise<string> | string;
  apply?: (root?: ParentNode) => void;
  registerRenderer?: (renderer: (language: TermaLanguage) => void) => (() => void);
}

export interface I18nRuntime {
  readonly supportedLanguages: readonly TermaLanguage[];
  getLanguage(): TermaLanguage;
  ready(): Promise<unknown>;
  translate(key: string, options?: Record<string, unknown>): string;
  setLanguage(language: TermaLanguage, options?: Record<string, unknown>): Promise<TermaLanguage>;
  apply(root?: ParentNode): void;
  registerRenderer(renderer: (language: TermaLanguage) => void): () => void;
  subscribe(listener: (language: TermaLanguage) => void): () => void;
}

const SUPPORTED_LANGUAGES = Object.freeze(['zh-CN', 'en-US'] as const);

function normalizeLanguage(value: unknown): TermaLanguage {
  return String(value || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

export function createI18nRuntime(source: I18nRuntimeSource = {}): I18nRuntime {
  const listeners = new Set<(language: TermaLanguage) => void>();
  const renderers = new Set<(language: TermaLanguage) => void>();
  let language = normalizeLanguage(source.getLanguage?.());
  let readyPromise: Promise<unknown> | undefined;
  const ready = () => {
    if (!readyPromise) {
      const candidate = typeof source.ready === 'function' ? source.ready() : source.ready;
      readyPromise = Promise.resolve(candidate ?? undefined);
    }
    return readyPromise;
  };
  const registerRenderer = (renderer: (nextLanguage: TermaLanguage) => void) => {
    if (typeof renderer !== 'function') return () => {};
    renderers.add(renderer);
    const unregisterLegacy = source.registerRenderer?.(renderer) || (() => {});
    return () => {
      renderers.delete(renderer);
      unregisterLegacy();
    };
  };
  const setLanguage = async (nextLanguage: TermaLanguage, options: Record<string, unknown> = {}) => {
    await ready();
    const normalized = normalizeLanguage(nextLanguage);
    const result = await source.setLanguage?.(normalized, options);
    language = normalizeLanguage(result || normalized);
    if (!source.setLanguage) {
      for (const renderer of [...renderers]) renderer(language);
      for (const listener of [...listeners]) listener(language);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = language;
        window.dispatchEvent(new CustomEvent('terma:language-changed', { detail: { language } }));
      }
    }
    return language;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('terma:language-changed', event => {
      const detail = (event as CustomEvent<{ language?: string }>).detail;
      language = normalizeLanguage(detail?.language || source.getLanguage?.());
      for (const listener of [...listeners]) listener(language);
    });
  }
  return {
    supportedLanguages: SUPPORTED_LANGUAGES,
    getLanguage: () => normalizeLanguage(source.getLanguage?.() || language),
    ready,
    translate: (key, options = {}) => source.translate?.(key, options) ?? String(options.defaultValue || key),
    setLanguage,
    apply: root => source.apply?.(root),
    registerRenderer,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}



export function installI18nRuntime(): I18nRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  if (sharedServices.termaI18nRuntime) return sharedServices.termaI18nRuntime;
  const source: I18nRuntimeSource = {
    getLanguage: () => document.documentElement.lang,
    ready: workspaceLanguage.initializeWorkspaceI18n(),
    translate: workspaceLanguage.tr,
    setLanguage: workspaceLanguage.setTermaLanguage,
    apply: root=>workspaceLanguage.applyTermaTranslations(root as Node|undefined),
    registerRenderer: workspaceLanguage.registerTermaI18nRenderer
  };
  const runtime = createI18nRuntime(source);
  sharedServices.termaI18nRuntime = runtime;
  window.dispatchEvent(new CustomEvent('terma-i18n-runtime-ready'));
  return runtime;
}

export function translate(key:string,options:Record<string,unknown>={}):string {
  return workspaceLanguage.tr(key,options);
}

export interface InstalledSharedI18nRuntimeServices {
  termaI18nRuntime?: I18nRuntime;
}
