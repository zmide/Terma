export type TermaResourceLanguage = 'zh-CN' | 'en-US';
type TermaResourceNamespace = 'common' | 'navigation' | 'settings' | 'connections' | 'terminal' | 'sftp' | 'tasks' | 'remote' | 'errors' | 'login';
type TermaLocaleResource = Record<string, unknown>;

interface ResourceBundlePort {
  hasResourceBundle(language: TermaResourceLanguage, namespace: TermaResourceNamespace): boolean;
  addResourceBundle(language: TermaResourceLanguage, namespace: TermaResourceNamespace, resource: TermaLocaleResource, deep: true, overwrite: true): void;
}

export interface TermaResourceLoader {
  readonly languages: readonly TermaResourceLanguage[];
  readonly namespaces: readonly TermaResourceNamespace[];
  normalizeLanguage(value: unknown): TermaResourceLanguage;
  loadResource(language: TermaResourceLanguage, namespace: TermaResourceNamespace): Promise<TermaLocaleResource>;
  loadAll(): Promise<Record<TermaResourceLanguage, Record<TermaResourceNamespace, TermaLocaleResource>>>;
  ensureBundles(
    port: ResourceBundlePort,
    languages?: readonly unknown[],
    namespaces?: readonly unknown[]
  ): Promise<boolean>;
}

export const resourceLoader:TermaResourceLoader=(() => {
  const languages = Object.freeze(['zh-CN', 'en-US'] as const);
  const namespaces = Object.freeze([
    'common', 'navigation', 'settings', 'connections', 'terminal',
    'sftp', 'tasks', 'remote', 'errors', 'login'
  ] as const);
  const namespaceSet = new Set<string>(namespaces);
  const inFlight = new Map<string, Promise<TermaLocaleResource>>();

  const normalizeLanguage = (value: unknown): TermaResourceLanguage =>
    languages.includes(String(value || '') as TermaResourceLanguage) ? String(value) as TermaResourceLanguage : 'zh-CN';

  const isNamespace = (value: unknown): value is TermaResourceNamespace =>
    typeof value === 'string' && namespaceSet.has(value);

  const loadResource = (language: TermaResourceLanguage, namespace: TermaResourceNamespace): Promise<TermaLocaleResource> => {
    if (!languages.includes(language) || !isNamespace(namespace)) {
      return Promise.reject(new Error('I18N_RESOURCE_UNSUPPORTED_REQUEST'));
    }
    const key = `${language}/${namespace}`;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = Promise.resolve()
      .then(() => {
        const url = `/locales/${encodeURIComponent(language)}/${encodeURIComponent(namespace)}.json`;
        return (window as Window & { fetch: typeof fetch }).fetch(url, {cache: 'no-store'});
      })
      .then(async response => {
        if (!response.ok) throw new Error(`I18N_RESOURCE_LOAD_FAILED: ${language}/${namespace}`);
        return await response.json() as TermaLocaleResource;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  };

  const loadAll = async (): Promise<Record<TermaResourceLanguage, Record<TermaResourceNamespace, TermaLocaleResource>>> => {
    const resources = {} as Record<TermaResourceLanguage, Record<TermaResourceNamespace, TermaLocaleResource>>;
    await Promise.all(languages.map(async language => {
      const languageResources = {} as Record<TermaResourceNamespace, TermaLocaleResource>;
      resources[language] = languageResources;
      await Promise.all(namespaces.map(async namespace => {
        languageResources[namespace] = await loadResource(language, namespace);
      }));
    }));
    return resources;
  };

  const ensureBundles: TermaResourceLoader['ensureBundles'] = async (
    port,
    requestedLanguages = languages,
    requestedNamespaces = namespaces
  ) => {
    const selectedLanguages = [...new Set(requestedLanguages.map(normalizeLanguage))];
    const selectedNamespaces = [...new Set(requestedNamespaces.filter(isNamespace))];
    const missing: Array<{language: TermaResourceLanguage; namespace: TermaResourceNamespace}> = [];

    for (const language of selectedLanguages) {
      for (const namespace of selectedNamespaces) {
        if (!port.hasResourceBundle(language, namespace)) missing.push({language, namespace});
      }
    }
    if (missing.length === 0) return false;

    await Promise.all(missing.map(async ({language, namespace}) => {
      const resource = await loadResource(language, namespace);
      port.addResourceBundle(language, namespace, resource, true, true);
    }));
    return true;
  };

  const loader: TermaResourceLoader = Object.freeze({
    languages,
    namespaces,
    normalizeLanguage,
    loadResource,
    loadAll,
    ensureBundles
  });

  return loader;
})();
