(() => {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="terma-csp-nonce"]')?.content || "";
  if (!nonce) return;

  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function createElementWithNonce(
    this: Document,
    name: string,
    options?: ElementCreationOptions
  ) {
    const element = originalCreateElement.call(this, name, options);
    if (String(name).toLowerCase() === "style") element.setAttribute("nonce", nonce);
    return element;
  } as typeof originalCreateElement;

  const originalCreateElementNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function createElementNSWithNonce(
    this: Document,
    namespace: string | null,
    name: string,
    options?: string | ElementCreationOptions
  ) {
    const element = originalCreateElementNS.call(this, namespace, name, options);
    if (String(name).toLowerCase() === "style") element.setAttribute("nonce", nonce);
    return element;
  } as typeof originalCreateElementNS;
})();
