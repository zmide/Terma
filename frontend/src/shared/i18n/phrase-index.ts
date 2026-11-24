import {resourceLoader} from './resource-loader';
export type LanguageResources = Record<string, Record<string, unknown> | undefined>;

interface PhraseTemplate {
  key: string;
  names: string[];
  literalLength: number;
  anchor: string;
  minLength: number;
  expression: RegExp;
  rank: number;
}

type PhraseLookup =
  | {kind: 'key'; key: string}
  | {kind: 'template'; template: PhraseTemplate; captures: string[]}
  | {kind: 'miss'};

export interface PhraseIndex {
  rebuild(resources: LanguageResources): void;
  lookup(source: string): PhraseLookup;
  candidateCount(source: string): number;
  readonly templateCount: number;
  readonly cacheSize: number;
}

export const TERMA_I18N_PHRASE_INDEX = (() => {
  const resourceNamespaces = (() => {
    const loader = resourceLoader;
    if (!loader) throw new Error('I18N_RESOURCE_LOADER_MISSING');
    return loader.namespaces;
  })();
  const phraseKeys = new Map<string, string>();
  const templates: PhraseTemplate[] = [];
  const buckets = new Map<string, PhraseTemplate[]>();
  const fallbackTemplates: PhraseTemplate[] = [];
  const cache = new Map<string, PhraseLookup>();
  const cacheLimit = 2048;
  const cacheMaxLength = 512;

  function flatten(value: unknown, prefix = '', result: Array<[string, string]> = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, next, result);
      else if (typeof child === 'string') result.push([next, child]);
    }
    return result;
  }

  function compileTemplate(value: unknown, key: string): PhraseTemplate | null {
    const source = String(value || '').trim();
    const tokenPattern = /{{-?\s*([a-z0-9_.-]+)\s*}}/gi;
    const names: string[] = [];
    const literals: string[] = [];
    let expression = '';
    let offset = 0;
    for (const match of source.matchAll(tokenPattern)) {
      const literal = source.slice(offset, match.index);
      literals.push(literal);
      expression += literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expression += '(.+?)';
      names.push(match[1]);
      offset = Number(match.index) + match[0].length;
    }
    if (!names.length) return null;

    const trailingLiteral = source.slice(offset);
    literals.push(trailingLiteral);
    expression += trailingLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const literalLength = literals.reduce((total, literal) => total + literal.length, 0);
    // Whitespace-only separators cannot distinguish UI templates from literal messages.
    if (literalLength < 2 || !literals.some(literal => literal.trim())) return null;
    const anchor = literals.reduce((longest, literal) => literal.length > longest.length ? literal : longest, '');
    return {key, names, literalLength, anchor, minLength:literalLength + names.length, expression:new RegExp(`^${expression}$`), rank:0};
  }

  function rebuild(resources: LanguageResources) {
    phraseKeys.clear();
    templates.length = 0;
    buckets.clear();
    fallbackTemplates.length = 0;
    cache.clear();

    for (const namespace of resourceNamespaces) {
      const chinese = new Map(flatten(resources?.['zh-CN']?.[namespace]));
      const english = new Map(flatten(resources?.['en-US']?.[namespace]));
      for (const [path, value] of chinese) {
        const key = `${namespace}:${path}`;
        if (value.trim() && !phraseKeys.has(value.trim())) phraseKeys.set(value.trim(), key);
        const englishValue = english.get(path);
        if (englishValue?.trim() && !phraseKeys.has(englishValue.trim())) phraseKeys.set(englishValue.trim(), key);
        for (const template of [value, englishValue]) {
          const compiled = compileTemplate(template, key);
          if (compiled) templates.push(compiled);
        }
      }
    }

    templates.sort((left, right) => (
      right.literalLength - left.literalLength
      || right.expression.source.length - left.expression.source.length
    ));
    templates.forEach((template, rank) => {
      template.rank = rank;
      if (template.anchor.length < 2) {
        fallbackTemplates.push(template);
        return;
      }
      const bucketKey = template.anchor.slice(0, 2);
      const bucket = buckets.get(bucketKey) || [];
      bucket.push(template);
      buckets.set(bucketKey, bucket);
    });
  }

  function candidates(source: string) {
    const found = new Set(fallbackTemplates);
    const visited = new Set<string>();
    for (let index = 0; index + 1 < source.length; index += 1) {
      const bucketKey = source.slice(index, index + 2);
      if (visited.has(bucketKey)) continue;
      visited.add(bucketKey);
      for (const template of buckets.get(bucketKey) || []) {
        if (source.length >= template.minLength && source.includes(template.anchor)) found.add(template);
      }
    }
    return [...found].sort((left, right) => left.rank - right.rank);
  }

  function lookup(source: string): PhraseLookup {
    if (source.length <= cacheMaxLength) {
      const cached = cache.get(source);
      if (cached) {
        cache.delete(source);
        cache.set(source, cached);
        return cached;
      }
    }

    const key = phraseKeys.get(source);
    let result: PhraseLookup = key ? {kind:'key', key} : {kind:'miss'};
    if (!key) {
      for (const template of candidates(source)) {
        const match = source.match(template.expression);
        if (match) {
          result = {kind:'template', template, captures:match.slice(1)};
          break;
        }
      }
    }

    if (source.length <= cacheMaxLength) {
      cache.delete(source);
      cache.set(source, result);
      while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
    }
    return result;
  }

  return {
    rebuild,
    lookup,
    candidateCount: (source: string) => candidates(source).length,
    get templateCount() { return templates.length; },
    get cacheSize() { return cache.size; }
  };
})();

