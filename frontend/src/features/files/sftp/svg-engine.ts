import {filesServices} from '@/features/files/installed-services';
export type SanitizedSvg = SVGSVGElement & { __termaEmbeddedStyles: string };
export function svgNumericDimension(value: unknown, fallback: number) {
  const match = String(value || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i), number = match ? Number(match[1]) : 0;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
export function svgHasUnsafeCssResource(value: unknown) {
  // Resolve CSS escapes/comments before checking resource functions and imports.
  const css = String(value || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\(?:\r\n|\r|\n|\f)/g, '').replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_all, hex, escaped) => hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16)) || 0xfffd) : escaped);
  if (/@import|(?:expression|image-set|image|cross-fade)\s*\(|-moz-binding|behavior\s*:/i.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!String(match[2] || '').trim().startsWith('#')) return true;
  return false;
}
export function sanitizeSvgDocument(markup: string, parseError: () => string): SanitizedSvg {
  const styles: string[] = [];
  // Styles are extracted before DOMParser, then only safe rules are hoisted to the shadow stylesheet.
  const source = String(markup || '').replace(/<(?:[\w.-]+:)?style\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?style\s*>/gi, (_all, css) => { styles.push(String(css)); return ''; }).replace(/<(?:[\w.-]+:)?style\b[^>]*\/\s*>/gi, '');
  let parsed = new DOMParser().parseFromString(source, 'image/svg+xml'), root = parsed.documentElement;
  if (parsed.querySelector('parsererror') || root?.localName !== 'svg') throw new Error(parseError());
  if (!root.namespaceURI) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    parsed = new DOMParser().parseFromString(new XMLSerializer().serializeToString(root), 'image/svg+xml'); root = parsed.documentElement;
  }
  if (root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error(parseError());
  const forbidden = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'video', 'audio', 'animate', 'set', 'animatetransform', 'animatemotion', 'style']);
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (forbidden.has(element.localName.toLowerCase()) || element.namespaceURI === 'http://www.w3.org/1999/xhtml') { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value.trim();
      const raster = element.localName === 'image' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
      if (name.startsWith('on') || name === 'xml:base'
        || (attribute.localName.toLowerCase() === 'href' && value && !value.startsWith('#') && !raster)
        || svgHasUnsafeCssResource(value)) element.removeAttribute(attribute.name);
    }
  }
  Object.defineProperty(root, '__termaEmbeddedStyles', { configurable: true, value: styles.map(css => css.replace(/^\s*<!\[CDATA\[/i, '').replace(/\]\]>\s*$/i, '').trim()).filter(css => css && !svgHasUnsafeCssResource(css)).join('\n') });
  return root as unknown as SanitizedSvg;
}
export function svgExportViewBox(root: Element) {
  const values = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const valid = values.length >= 4 && values.slice(0, 4).every(Number.isFinite) && values[2] > 0 && values[3] > 0;
  return { x: valid ? values[0] : 0, y: valid ? values[1] : 0, width: Math.max(1, valid ? values[2] : svgNumericDimension(root.getAttribute('width'), 1024)), height: Math.max(1, valid ? values[3] : svgNumericDimension(root.getAttribute('height'), 768)) };
}
export function installSvgEngine() { filesServices.termaSvgEngine = { svgNumericDimension, svgHasUnsafeCssResource, sanitizeSvgDocument, svgExportViewBox }; }


export interface InstalledFeaturesFilesSftpSvgEngineServices {
  termaSvgEngine: { svgNumericDimension: typeof svgNumericDimension; svgHasUnsafeCssResource: typeof svgHasUnsafeCssResource; sanitizeSvgDocument: typeof sanitizeSvgDocument; svgExportViewBox: typeof svgExportViewBox }
}
