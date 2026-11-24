interface TermaTranslationObserverOptions {
  document: Document;
  attributes: readonly string[];
  shouldSkip: (element: Element) => boolean;
  apply: (root: Node) => void;
}

interface TermaDomTranslationOptions {
  document: Document;
  phrase(value: string): string;
  translate(key: string, options: {defaultValue: string}): string;
}

export const TERMA_I18N_OBSERVATION = (() => {
  const attributes = Object.freeze(['title', 'aria-label', 'placeholder']);
  const skipSelector = [
    'script', 'style', 'code', 'pre',
    '.xterm', '.terminal-box', '.log-content', '.log-line', '.ace_editor',
    '.sftp-name-cell', '.local-files-name-cell', '.connection-name',
    '.vnc-screen', '.vnc-viewport', '.vnc-rfb', '[data-i18n-skip]'
  ].join(',');

  function createRenderer({document, phrase, translate}: TermaDomTranslationOptions) {
    type Translation = {source: string; output: string};
    const textState = new WeakMap<Node, Translation>();
    const attributeState = new WeakMap<Element, Map<string, Translation>>();
    const shouldSkip = (element: Element | null) => Boolean(element?.closest(skipSelector));

    function applyText(node: Node) {
      if (!node.parentElement || shouldSkip(node.parentElement)) return;
      const current = node.nodeValue || '';
      const previous = textState.get(node);
      const source = previous && current === previous.output ? previous.source : current;
      const trimmed = source.trim();
      if (!trimmed) return;
      const translated = phrase(trimmed);
      if (!translated) { textState.delete(node); return; }
      const start = source.indexOf(trimmed);
      const output = source.slice(0, start) + translated + source.slice(start + trimmed.length);
      textState.set(node, {source, output});
      if (current !== output) node.nodeValue = output;
    }

    function applyAttributes(element: Element) {
      if (shouldSkip(element)) return;
      const states = attributeState.get(element) ?? new Map<string, Translation>();
      for (const attribute of attributes) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        const previous = states.get(attribute);
        const source = previous && current === previous.output ? previous.source : current;
        const output = phrase(source);
        if (!output) { states.delete(attribute); continue; }
        states.set(attribute, {source, output});
        if (current !== output) element.setAttribute(attribute, output);
      }
      if (states.size) attributeState.set(element, states);
      else attributeState.delete(element);
    }

    function applyAutomatic(root: Node = document) {
      if (root.nodeType === Node.TEXT_NODE) { applyText(root); return; }
      if (root.nodeType === Node.ELEMENT_NODE) applyAttributes(root as Element);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.TEXT_NODE) applyText(node);
        else applyAttributes(node as Element);
      }
    }

    function apply(root: Node = document) {
      const candidate = root as Partial<ParentNode>;
      const scope = candidate?.querySelectorAll ? candidate as ParentNode : document;
      for (const attribute of ['', ...attributes]) {
        const marker = attribute ? `data-i18n-${attribute}` : 'data-i18n';
        for (const element of scope.querySelectorAll(`[${marker}]`)) {
          if (element.closest('[data-i18n-skip]')) continue;
          const key = element.getAttribute(marker);
          if (!key) continue;
          const current = attribute ? element.getAttribute(attribute) : element.textContent;
          const value = translate(key, {defaultValue:current || key});
          if (attribute) element.setAttribute(attribute, value);
          else element.textContent = value;
        }
      }
      applyAutomatic(root?.nodeType ? root : document);
    }

    return {apply, applyAutomatic, shouldSkip};
  }

  function create({document, attributes, shouldSkip, apply}: TermaTranslationObserverOptions) {
    let observer: MutationObserver | undefined;

    function start() {
      if (observer || !document.body) return;

      const pending = new Set<Element>();
      let queued = false;
      const collect = (node: Node) => {
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return;
        const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
        if (element?.isConnected && !shouldSkip(element)) pending.add(element);
      };
      const current = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'childList') record.addedNodes.forEach(collect);
          else collect(record.target);
        }
        if (queued || !pending.size) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          const roots = [...pending];
          pending.clear();
          if (observer !== current) return;
          if (roots.length > 128) apply(document);
          else roots.forEach(root => { if (root.isConnected) apply(root); });
        });
      });
      current.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...attributes],
      });
      observer = current;
    }

    function stop() {
      observer?.disconnect();
      observer = undefined;
    }

    return {start, stop};
  }

  return {create, createRenderer, attributes};
})();
