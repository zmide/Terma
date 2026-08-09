(() => {
  const nonce = document.querySelector('meta[name="terma-csp-nonce"]')?.content || "";
  if (!nonce) return;

  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function createElementWithNonce(name, options) {
    const element = originalCreateElement.call(this, name, options);
    if (String(name).toLowerCase() === "style") element.setAttribute("nonce", nonce);
    return element;
  };

  const originalCreateElementNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function createElementNSWithNonce(namespace, name, options) {
    const element = originalCreateElementNS.call(this, namespace, name, options);
    if (String(name).toLowerCase() === "style") element.setAttribute("nonce", nonce);
    return element;
  };
})();
