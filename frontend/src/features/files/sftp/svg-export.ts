import { sanitizeSvgDocument, svgExportViewBox } from './svg-engine';
export type SvgBounds = { x: number; y: number; width: number; height: number };
export type SvgExportOptions = { colorMode?: string; invert?: boolean };
type ColorOptions = { blackWhiteTarget?: 'white' | 'black' };
type PaintSnapshot = Map<Element, Map<string, string>>;
export interface PdfDocument {
  addFileToVFS(name: string, binary: string): void;
  addFont(file: string, name: string, style: string, encoding: string): void;
  setFont(name: string, style: string): void;
  output(type: 'blob'): Blob;
}
export interface SvgExportPort {
  tr(key: string, values?: Record<string, unknown>): string;
  vendors(): { JsPDF?: new (options: { unit: string; orientation: string; format: number[]; compress: boolean }) => PdfDocument; convertSvg?: (source: SVGSVGElement, pdf: PdfDocument, options: { x: number; y: number; width: number; height: number; loadExternalStyleSheets: boolean }) => Promise<unknown> };
}
export function createSvgExportService(port: SvgExportPort) {
const tr = port.tr;
const sanitizeSftpSvgDocument = (markup: string) => sanitizeSvgDocument(markup, () => tr('sftp:editor.svg_parse_failed'));
const sftpSvgExportViewBox = svgExportViewBox;
function stripSftpSvgPdfFontDeclarations(root: SVGSVGElement) {
  const nodes = [root, ...root.querySelectorAll("*")];
  nodes.forEach(element => {
    element.removeAttribute("font-family");
    element.removeAttribute("font");
    const style = element.getAttribute("style");
    if (style) {
      element.setAttribute("style", style
        .replace(/(^|[;{])\s*font-family\s*:[^;}]*;?/gi, "$1")
        .replace(/(^|[;{])\s*font\s*:[^;}]*;?/gi, "$1"));
    }
  });
  root.querySelectorAll("style").forEach(style => {
    style.textContent = String(style.textContent || "")
      .replace(/(^|[;{])\s*font-family\s*:[^;}]*;?/gi, "$1")
      .replace(/(^|[;{])\s*font\s*:[^;}]*;?/gi, "$1");
  });
  return root;
}

function stripSftpSvgPdfStyles(root: SVGSVGElement) {
  root.querySelectorAll("style").forEach(style => style.remove());
  [root, ...root.querySelectorAll("*")].forEach(element => {
    element.removeAttribute("style");
    element.removeAttribute("font");
    element.removeAttribute("font-family");
  });
  return root;
}

const SFTP_SVG_PDF_FONT_NAME = "TermaNotoSansSC";
const SFTP_SVG_PDF_FONT_FILE = "NotoSansSC-Regular.ttf";
let sftpSvgPdfFontBinaryPromise: Promise<string> | null = null;

function sftpSvgPdfNeedsUnicodeFont(root: SVGSVGElement) {
  const text = [...root.querySelectorAll("text,tspan,title,desc")]
    .map(element => element.textContent || "")
    .join("");
  return /[^\u0000-\u00ff]/u.test(text);
}

function sftpSvgPdfBinaryString(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return binary;
}

async function loadSftpSvgPdfFontBinary() {
  if (!sftpSvgPdfFontBinaryPromise) {
    sftpSvgPdfFontBinaryPromise = fetch(`/fonts/${SFTP_SVG_PDF_FONT_FILE}`, {
      cache: "force-cache",
      credentials: "same-origin"
    }).then(async response => {
      if (!response.ok) throw new Error(tr("sftp:editor.pdf_font_unavailable", {defaultValue:"中文字体不可用，无法生成包含中文的 PDF"}));
      return sftpSvgPdfBinaryString(await response.arrayBuffer());
    }).catch(error => {
      sftpSvgPdfFontBinaryPromise = null;
      throw error;
    });
  }
  return sftpSvgPdfFontBinaryPromise;
}

function installSftpSvgPdfFont(pdf: PdfDocument, binary: string) {
  pdf.addFileToVFS(SFTP_SVG_PDF_FONT_FILE, binary);
  for (const style of ["normal", "bold", "italic", "bolditalic"]) {
    pdf.addFont(SFTP_SVG_PDF_FONT_FILE, SFTP_SVG_PDF_FONT_NAME, style, "Identity-H");
  }
  pdf.setFont(SFTP_SVG_PDF_FONT_NAME, "normal");
}

function forceSftpSvgPdfUnicodeFont(root: SVGSVGElement) {
  stripSftpSvgPdfFontDeclarations(root);
  root.querySelectorAll("text,tspan").forEach(element => {
    element.setAttribute("font-family", SFTP_SVG_PDF_FONT_NAME);
    element.setAttribute("font-weight", "normal");
    element.setAttribute("font-style", "normal");
  });
  return root;
}

function sftpSvgPdfNumber(value: unknown, fallback = 0) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : fallback;
}

function sftpSvgPdfViewportTransform(use: Element, referenced: Element, viewBox: number[]) {
  const x = sftpSvgPdfNumber(use.getAttribute("x"));
  const y = sftpSvgPdfNumber(use.getAttribute("y"));
  const width = sftpSvgPdfNumber(use.getAttribute("width"), viewBox[2]);
  const height = sftpSvgPdfNumber(use.getAttribute("height"), viewBox[3]);
  const preserve = String(
    use.getAttribute("preserveAspectRatio")
      || referenced.getAttribute("preserveAspectRatio")
      || "xMidYMid meet"
  ).trim();
  const tokens = preserve.split(/[\s,]+/).filter(Boolean);
  const align = tokens[0] || "xMidYMid";
  const mode = align === "none" || tokens[1] === "none"
    ? "none"
    : tokens[1] === "slice" ? "slice" : "meet";
  if (mode === "none") {
    return {
      x,
      y,
      scaleX: width / viewBox[2],
      scaleY: height / viewBox[3],
      offsetX: 0,
      offsetY: 0
    };
  }
  const scale = mode === "slice"
    ? Math.max(width / viewBox[2], height / viewBox[3])
    : Math.min(width / viewBox[2], height / viewBox[3]);
  const renderedWidth = viewBox[2] * scale;
  const renderedHeight = viewBox[3] * scale;
  const remainingX = width - renderedWidth;
  const remainingY = height - renderedHeight;
  const offsetX = align.includes("xMin") ? 0 : align.includes("xMax") ? remainingX : remainingX / 2;
  const offsetY = align.includes("YMin") ? 0 : align.includes("YMax") ? remainingY : remainingY / 2;
  return {x, y, scaleX:scale, scaleY:scale, offsetX, offsetY};
}

function sftpSvgPdfReferencedId(element: Element | null) {
  const href = element?.getAttribute?.("href") || element?.getAttribute?.("xlink:href") || "";
  return String(href).trim().replace(/^#/, "");
}

function sftpSvgPdfFindReferencedElement(root: Element, id: string) {
  if (!id) return null;
  return [...root.querySelectorAll("[id]")].find(element => element.getAttribute("id") === id) || null;
}

function sftpSvgPdfMakeSymbolOverflowVisible(root: SVGSVGElement) {
  root.querySelectorAll("symbol,svg").forEach(element => {
    if (element.tagName.toLowerCase() === "symbol" || element !== root) element.setAttribute("overflow", "visible");
  });
  return root;
}

function sftpSvgPdfFlattenSymbols(root: SVGSVGElement) {
  const namespace = "http://www.w3.org/2000/svg";
  const maxReplacements = 300;
  let replacements = 0;
  const uses = () => [...root.querySelectorAll("use")];
  for (let pass = 0; pass < 4; pass += 1) {
    let replacedInPass = false;
    for (const use of uses()) {
      if (replacements >= maxReplacements) break;
      const id = sftpSvgPdfReferencedId(use);
      const referenced = sftpSvgPdfFindReferencedElement(root, id);
      if (!referenced || referenced === use || referenced.closest("use")) continue;
      const referencedTag = referenced.tagName.toLowerCase();
      if (["script", "style", "defs", "metadata"].includes(referencedTag)) continue;
      const viewBox = String(referenced.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      const opensViewport = ["symbol", "svg"].includes(referencedTag)
        && viewBox.length >= 4
        && viewBox.slice(0, 4).every(Number.isFinite)
        && viewBox[2] > 0
        && viewBox[3] > 0;
      const viewport = opensViewport
        ? sftpSvgPdfViewportTransform(use, referenced, viewBox)
        : {x:sftpSvgPdfNumber(use.getAttribute("x")), y:sftpSvgPdfNumber(use.getAttribute("y")), scaleX:1, scaleY:1, offsetX:0, offsetY:0};
      const group = document.createElementNS(namespace, "g");
      for (const attribute of [...referenced.attributes]) {
        if (["id", "viewBox", "width", "height", "x", "y"].includes(attribute.name)) continue;
        group.setAttribute(attribute.name, attribute.value);
      }
      for (const attribute of ["class", "style", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "opacity", "color", "transform", "clip-path", "mask"]) {
        if (use.hasAttribute(attribute)) group.setAttribute(attribute, use.getAttribute(attribute)!);
      }
      const referencedTransform = group.getAttribute("transform");
      // The <use> transform is applied in the parent coordinate system.  Put
      // it before the symbol viewport translation/scale so rotation centers
      // are not multiplied by the instance size.
      const transformParts = [];
      if (referencedTransform) transformParts.push(referencedTransform);
      transformParts.push(`translate(${viewport.x} ${viewport.y})`);
      if (opensViewport) {
        transformParts.push(`translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.scaleX} ${viewport.scaleY}) translate(${-viewBox[0]} ${-viewBox[1]})`);
      }
      group.setAttribute("transform", transformParts.join(" "));
      if (referencedTag === "symbol" || referencedTag === "svg" || referencedTag === "g") {
        referenced.childNodes.forEach(child => group.appendChild(child.cloneNode(true)));
      } else {
        group.appendChild(referenced.cloneNode(true));
      }
      use.replaceWith(group);
      replacements += 1;
      replacedInPass = true;
    }
    if (!replacedInPass) break;
  }
  return root;
}

function sftpSvgPdfContentBounds(root: SVGSVGElement) {
  const bounds = [];
  const drawable = new Set(["path", "polyline", "polygon", "line", "rect", "circle", "ellipse", "text", "tspan", "image"]);
  for (const element of root.querySelectorAll<SVGGraphicsElement>("*")) {
    const tag = element.tagName.toLowerCase();
    if (!drawable.has(tag) || element.closest("defs")) continue;
    try {
      const box = element.getBBox({fill:true, stroke:true, markers:true, clipped:false});
      const matrix = element.getCTM?.();
      if (!matrix || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 0 || box.height < 0) continue;
      const points = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height]
      ].map(([x, y]) => ({x:matrix.a * x + matrix.c * y + matrix.e, y:matrix.b * x + matrix.d * y + matrix.f}));
      bounds.push({
        minX:Math.min(...points.map(point => point.x)),
        minY:Math.min(...points.map(point => point.y)),
        maxX:Math.max(...points.map(point => point.x)),
        maxY:Math.max(...points.map(point => point.y))
      });
    } catch {}
  }
  if (!bounds.length) return null;
  return {
    x:Math.min(...bounds.map(item => item.minX)),
    y:Math.min(...bounds.map(item => item.minY)),
    width:Math.max(...bounds.map(item => item.maxX)) - Math.min(...bounds.map(item => item.minX)),
    height:Math.max(...bounds.map(item => item.maxY)) - Math.min(...bounds.map(item => item.minY))
  };
}

function sftpSvgPdfExpandViewBox(root: SVGSVGElement, dimensions: SvgBounds) {
  const viewBox = [dimensions.x, dimensions.y, dimensions.width, dimensions.height];
  const bounds = sftpSvgPdfContentBounds(root);
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return dimensions;
  const pad = Math.max(1, Math.min(dimensions.width, dimensions.height) * 0.01);
  const minX = Math.min(viewBox[0], bounds.x - pad);
  const minY = Math.min(viewBox[1], bounds.y - pad);
  const maxX = Math.max(viewBox[0] + viewBox[2], bounds.x + bounds.width + pad);
  const maxY = Math.max(viewBox[1] + viewBox[3], bounds.y + bounds.height + pad);
  return {x:minX, y:minY, width:Math.max(1, maxX - minX), height:Math.max(1, maxY - minY)};
}

const sftpSvgPdfColorResolutionCache = new Map();
let sftpSvgPdfColorProbe = null;
const SFTP_SVG_COLOR_MODES = new Set(["original", "invert-mono", "invert-bw", "invert-color"]);

function sftpSvgColorMode(options: SvgExportOptions | string = {}) {
  const requested = typeof options === "string" ? options : options.colorMode;
  if (requested && SFTP_SVG_COLOR_MODES.has(requested)) return requested;
  return (typeof options === "object" && options?.invert) ? "invert-color" : "original";
}

function sftpSvgColorModeSuffix(mode: string) {
  if (mode === "invert-mono") return "-inverted-mono";
  if (mode === "invert-bw") return "-inverted-bw";
  if (mode === "invert-color") return "-inverted-color";
  return "";
}

function sftpSvgColorModeFilter(mode: string) {
  if (mode === "invert-color") return "invert(1)";
  return "";
}

function sftpSvgPdfResolveColor(source: string) {
  const key = String(source || "").trim();
  if (!key || sftpSvgPdfColorResolutionCache.has(key)) return sftpSvgPdfColorResolutionCache.get(key) || "";
  let resolved = "";
  try {
    if (globalThis.CSS?.supports?.("color", key)) {
      sftpSvgPdfColorProbe ||= document.createElement("canvas").getContext("2d", {willReadFrequently:true});
      if (sftpSvgPdfColorProbe) {
        sftpSvgPdfColorProbe.clearRect(0, 0, 1, 1);
        sftpSvgPdfColorProbe.fillStyle = key;
        sftpSvgPdfColorProbe.fillRect(0, 0, 1, 1);
        const pixel = sftpSvgPdfColorProbe.getImageData(0, 0, 1, 1).data;
        resolved = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${Number((pixel[3] / 255).toFixed(4))})`;
      }
    }
  } catch {}
  sftpSvgPdfColorResolutionCache.set(key, resolved);
  return resolved;
}

function sftpSvgPdfParseColor(value: string | null | undefined): { r: number; g: number; b: number; a: number; important: string } | null {
  const raw = String(value || "").trim();
  const important = /\s*!important\s*$/i.test(raw) ? " !important" : "";
  const source = raw.replace(/\s*!important\s*$/i, "").trim();
  if (!source || /^(?:none|transparent|currentColor|inherit|initial|unset|context-[\w-]+)$/i.test(source) || /^url\s*\(/i.test(source)) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 1;
  const hex = source.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      r = parseInt(digits[0] + digits[0], 16);
      g = parseInt(digits[1] + digits[1], 16);
      b = parseInt(digits[2] + digits[2], 16);
      if (digits.length === 4) a = parseInt(digits[3] + digits[3], 16) / 255;
    } else if (digits.length === 6 || digits.length === 8) {
      r = parseInt(digits.slice(0, 2), 16);
      g = parseInt(digits.slice(2, 4), 16);
      b = parseInt(digits.slice(4, 6), 16);
      if (digits.length === 8) a = parseInt(digits.slice(6, 8), 16) / 255;
    } else return null;
  } else {
    const rgb = source.match(/^rgba?\(\s*([^)]*)\)$/i);
    if (!rgb) {
      const resolved = sftpSvgPdfResolveColor(source);
      const parsed = resolved ? sftpSvgPdfParseColor(resolved) : null;
      return parsed ? {...parsed, important} : null;
    }
    const parts = rgb[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (item: string) => String(item).endsWith("%") ? Math.round(Math.max(0, Math.min(100, parseFloat(item))) * 2.55) : Math.round(Math.max(0, Math.min(255, parseFloat(item))));
    r = channel(parts[0]);
    g = channel(parts[1]);
    b = channel(parts[2]);
    if (parts[3] !== undefined) a = String(parts[3]).endsWith("%") ? Math.max(0, Math.min(1, parseFloat(parts[3]) / 100)) : Math.max(0, Math.min(1, parseFloat(parts[3])));
  }
  return {r, g, b, a, important};
}

function sftpSvgPdfInvertColor(value: string, mode = "invert-color", options: ColorOptions = {}) {
  if (mode === "original") return value;
  const parsed = sftpSvgPdfParseColor(value);
  if (!parsed) return value;
  const {r, g, b, a, important} = parsed;
  const grayscale = Math.round(.2126 * r + .7152 * g + .0722 * b);
  if (mode === "invert-mono" && Math.max(r, g, b) - Math.min(r, g, b) > 1) return value;
  const binary = mode === "invert-bw"
    ? (options.blackWhiteTarget === "white" ? 255 : 0)
    : (grayscale >= 128 ? 0 : 255);
  const channels = ["invert-mono", "invert-bw"].includes(mode) ? `${binary}, ${binary}, ${binary}` : `${255 - r}, ${255 - g}, ${255 - b}`;
  return (a < 1 ? `rgba(${channels}, ${Number(a.toFixed(4))})` : `rgb(${channels})`) + important;
}

function sftpSvgPdfInvertCss(value: string, mode = "invert-color", optionResolver: ((property: string, color: string) => ColorOptions) | null = null) {
  return String(value || "").replace(/((fill|stroke|stop-color|flood-color|lighting-color|solid-color|color|background-color)\s*:\s*)([^;}\n]+)/gi, (_match, prefix, property, color) => {
    const options = typeof optionResolver === "function" ? optionResolver(property.toLowerCase(), color) : {};
    return `${prefix}${sftpSvgPdfInvertColor(color, mode, options)}`;
  });
}

function sftpSvgPdfPaintSnapshot(root: SVGSVGElement) {
  const colorAttributes = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "solid-color", "color", "background-color"]);
  const snapshot: PaintSnapshot = new Map();
  [root, ...root.querySelectorAll("*")].forEach(element => {
    const paints = new Map<string, string>();
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (colorAttributes.has(name)) paints.set(name, attribute.value);
    }
    const style = element.getAttribute("style");
    if (style) {
      style.replace(/(?:^|;)\s*(fill|stroke|stop-color|flood-color|lighting-color|solid-color|color|background-color)\s*:\s*([^;}\n]+)/gi, (_match, property, color) => {
        paints.set(property.toLowerCase(), color);
        return _match;
      });
    }
    snapshot.set(element, paints);
  });
  return snapshot;
}

function sftpSvgPdfIsNearWhite(value: string) {
  const parsed = sftpSvgPdfParseColor(value);
  return Boolean(parsed && parsed.a > .05 && Math.min(parsed.r, parsed.g, parsed.b) >= 240);
}

function sftpSvgPdfIsDarkSurface(value: string) {
  const parsed = sftpSvgPdfParseColor(value);
  return Boolean(parsed && parsed.a > .05 && Math.min(parsed.r, parsed.g, parsed.b) < 240);
}

function sftpSvgPdfElementBounds(element: Element | null) {
  if (!element) return null;
  const tag = element.tagName?.toLowerCase();
  const numeric = (name: string) => sftpSvgPdfNumber(element.getAttribute(name), 0);
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  if (tag === "rect" || tag === "image" || tag === "use") {
    x = numeric("x");
    y = numeric("y");
    width = Math.max(0, numeric("width"));
    height = Math.max(0, numeric("height"));
  } else if (tag === "circle") {
    const radius = Math.max(0, numeric("r"));
    x = numeric("cx") - radius;
    y = numeric("cy") - radius;
    width = radius * 2;
    height = radius * 2;
  } else if (tag === "ellipse") {
    const radiusX = Math.max(0, numeric("rx"));
    const radiusY = Math.max(0, numeric("ry"));
    x = numeric("cx") - radiusX;
    y = numeric("cy") - radiusY;
    width = radiusX * 2;
    height = radiusY * 2;
  } else if (tag === "line") {
    const x1 = numeric("x1");
    const y1 = numeric("y1");
    const x2 = numeric("x2");
    const y2 = numeric("y2");
    x = Math.min(x1, x2);
    y = Math.min(y1, y2);
    width = Math.abs(x2 - x1);
    height = Math.abs(y2 - y1);
  } else if (["polygon", "polyline"].includes(tag)) {
    const values = String(element.getAttribute("points") || "").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    const points = [];
    for (let index = 0; index + 1 < values.length; index += 2) points.push({x:values[index], y:values[index + 1]});
    if (!points.length) return null;
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    x = minX;
    y = minY;
    width = maxX - minX;
    height = maxY - minY;
  } else {
    try {
      const box = element.isConnected && element instanceof SVGGraphicsElement ? element.getBBox() : null;
      if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
      return {x:box.x, y:box.y, width:Math.max(0, box.width), height:Math.max(0, box.height)};
    } catch {
      return null;
    }
  }
  return {x, y, width, height};
}

function sftpSvgPdfBoundsOverlapDetail(detailBounds: SvgBounds | null, surfaceBounds: SvgBounds | null) {
  if (!detailBounds || !surfaceBounds || surfaceBounds.width <= 0 || surfaceBounds.height <= 0) return false;
  const padding = Math.max(.05, Math.min(surfaceBounds.width, surfaceBounds.height) * .03);
  const centerX = detailBounds.x + detailBounds.width / 2;
  const centerY = detailBounds.y + detailBounds.height / 2;
  const centerInside = centerX >= surfaceBounds.x - padding
    && centerX <= surfaceBounds.x + surfaceBounds.width + padding
    && centerY >= surfaceBounds.y - padding
    && centerY <= surfaceBounds.y + surfaceBounds.height + padding;
  if (centerInside) return true;
  if (detailBounds.width <= 0 || detailBounds.height <= 0) return false;
  const overlapWidth = Math.max(0, Math.min(detailBounds.x + detailBounds.width, surfaceBounds.x + surfaceBounds.width) - Math.max(detailBounds.x, surfaceBounds.x));
  const overlapHeight = Math.max(0, Math.min(detailBounds.y + detailBounds.height, surfaceBounds.y + surfaceBounds.height) - Math.max(detailBounds.y, surfaceBounds.y));
  return overlapWidth * overlapHeight >= detailBounds.width * detailBounds.height * .5;
}

function sftpSvgPdfBackgroundElements(root: SVGSVGElement, snapshot: PaintSnapshot) {
  const dimensions = sftpSvgExportViewBox(root);
  const toleranceX = Math.max(1, dimensions.width * .01);
  const toleranceY = Math.max(1, dimensions.height * .01);
  const backgroundElements = new Set<Element>();
  const hasBackgroundName = (element: Element) => {
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) {
      if (current.tagName?.toLowerCase() === "defs") return false;
      const marker = `${current.id || ""} ${current.getAttribute?.("class") || ""}`;
      if (/back[\s_-]*ground|canvas[\s_-]*(?:bg|background)|page[\s_-]*(?:bg|background)/i.test(marker)) return true;
    }
    return false;
  };
  [root, ...root.querySelectorAll("*")].forEach(element => {
    const paints = snapshot.get(element);
    if (!paints?.size) return;
    const tag = element.tagName?.toLowerCase();
    const hasSolidBackgroundPaint = Boolean(sftpSvgPdfParseColor(paints.get("fill") || paints.get("background-color")));
    const insideDefs = element !== root && Boolean(element.closest?.("defs"));
    const coversCanvas = !insideDefs && hasSolidBackgroundPaint && tag === "rect"
      && sftpSvgPdfNumber(element.getAttribute("x"), 0) <= dimensions.x + toleranceX
      && sftpSvgPdfNumber(element.getAttribute("y"), 0) <= dimensions.y + toleranceY
      && sftpSvgPdfNumber(element.getAttribute("width"), 0) >= dimensions.width - toleranceX * 2
      && sftpSvgPdfNumber(element.getAttribute("height"), 0) >= dimensions.height - toleranceY * 2;
    if ((hasSolidBackgroundPaint && hasBackgroundName(element)) || coversCanvas || (element === root && paints.has("background-color"))) backgroundElements.add(element);
  });
  return backgroundElements;
}

function sftpSvgPdfHasLocalDarkSurface(element: Element, property: string, snapshot: PaintSnapshot | null, root: SVGSVGElement) {
  const ownPaints = snapshot?.get(element) || new Map();
  // Keep white details only when the same SVG element has a real dark fill.
  // Looking at nearby siblings or ancestors is too broad for CAD symbols:
  // a tiny black arrow next to a white transformer outline must not make the
  // entire outline white on the new white canvas.
  return [...ownPaints]
    .some(([name, value]) => name !== property && ["fill", "background-color"].includes(name) && sftpSvgPdfIsDarkSurface(value));
}

function sftpSvgPdfInvertColors(root: SVGSVGElement, mode = "invert-color") {
  const colorAttributes = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "solid-color", "color", "background-color"]);
  const paintSnapshot = mode === "invert-bw" ? sftpSvgPdfPaintSnapshot(root) : null;
  const backgroundElements = paintSnapshot ? sftpSvgPdfBackgroundElements(root, paintSnapshot) : new Set();
  const colorOptions = (element: Element, property: string, color: string): ColorOptions => {
    if (mode !== "invert-bw") return {};
    if (backgroundElements.has(element)) return {blackWhiteTarget:"white"};
    const preserveWhiteDetail = sftpSvgPdfIsNearWhite(color) && sftpSvgPdfHasLocalDarkSurface(element, property, paintSnapshot, root);
    return {blackWhiteTarget:preserveWhiteDetail ? "white" : "black"};
  };
  [root, ...root.querySelectorAll("*")].forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (colorAttributes.has(name)) element.setAttribute(attribute.name, sftpSvgPdfInvertColor(attribute.value, mode, colorOptions(element, name, attribute.value)));
      if (name === "style") element.setAttribute(attribute.name, sftpSvgPdfInvertCss(attribute.value, mode, (property, color) => colorOptions(element, property, color)));
    }
  });
  root.querySelectorAll("style").forEach(style => { style.textContent = sftpSvgPdfInvertCss(style.textContent || "", mode); });
  return root;
}

async function createSftpSvgPdfBlob(blob: Blob, options: SvgExportOptions = {}) {
  const { JsPDF, convertSvg } = port.vendors();
  if (typeof JsPDF !== "function" || typeof convertSvg !== "function") {
    throw new Error(tr("sftp:editor.pdf_conversion_unavailable", {defaultValue:"SVG 转 PDF 组件不可用，请重新加载 Terma"}));
  }
  const sanitizedRoot = sanitizeSftpSvgDocument(await blob.text());
  const needsUnicodeFont = sftpSvgPdfNeedsUnicodeFont(sanitizedRoot);
  const unicodeFontBinary = needsUnicodeFont ? await loadSftpSvgPdfFontBinary() : "";
  const dimensions = sftpSvgExportViewBox(sanitizedRoot);
  const svg = document.importNode(sanitizedRoot, true);
  sftpSvgPdfMakeSymbolOverflowVisible(svg);
  sftpSvgPdfFlattenSymbols(svg);
  const namespace = "http://www.w3.org/2000/svg";
  svg.setAttribute("xmlns", namespace);
  svg.setAttribute("viewBox", `${dimensions.x} ${dimensions.y} ${dimensions.width} ${dimensions.height}`);
  svg.setAttribute("width", `${dimensions.width}px`);
  svg.setAttribute("height", `${dimensions.height}px`);
  const embeddedStyles = String(sanitizedRoot.__termaEmbeddedStyles || "");
  if (embeddedStyles) {
    const style = document.createElementNS(namespace, "style");
    style.textContent = embeddedStyles;
    svg.insertBefore(style, svg.firstChild);
  }
  const colorMode = sftpSvgColorMode(options);
  if (colorMode !== "original") sftpSvgPdfInvertColors(svg, colorMode);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:-100000px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden";
  host.appendChild(svg);
  document.body.appendChild(host);
  const exportDimensions = sftpSvgPdfExpandViewBox(svg, dimensions);
  svg.setAttribute("viewBox", `${exportDimensions.x} ${exportDimensions.y} ${exportDimensions.width} ${exportDimensions.height}`);
  svg.setAttribute("width", `${exportDimensions.width}px`);
  svg.setAttribute("height", `${exportDimensions.height}px`);
  const render = async (source: SVGSVGElement) => {
    const pdf = new JsPDF({
      unit: "pt",
      orientation: exportDimensions.width >= exportDimensions.height ? "landscape" : "portrait",
      format: [exportDimensions.width, exportDimensions.height],
      compress: true
    });
    if (unicodeFontBinary) installSftpSvgPdfFont(pdf, unicodeFontBinary);
    await convertSvg(source, pdf, {
      x: 0,
      y: 0,
      width: exportDimensions.width,
      height: exportDimensions.height,
      loadExternalStyleSheets: false
    });
    return pdf.output("blob");
  };
  try {
    const firstSource = needsUnicodeFont ? forceSftpSvgPdfUnicodeFont((svg.cloneNode(true) as SVGSVGElement)) : svg;
    try {
      return await render(firstSource);
    } catch (error) {
      if (!/parse error/i.test(String(error instanceof Error ? error.message : error))) throw error;
      try {
        const compatibleSource = stripSftpSvgPdfFontDeclarations((svg.cloneNode(true) as SVGSVGElement));
        if (needsUnicodeFont) forceSftpSvgPdfUnicodeFont(compatibleSource);
        return await render(compatibleSource);
      } catch (compatibilityError) {
        if (!/parse error/i.test(String(compatibilityError instanceof Error ? compatibilityError.message : compatibilityError))) throw compatibilityError;
        const styleFreeSource = stripSftpSvgPdfStyles((svg.cloneNode(true) as SVGSVGElement));
        if (needsUnicodeFont) forceSftpSvgPdfUnicodeFont(styleFreeSource);
        return await render(styleFreeSource);
      }
    }
  } catch (error) {
    if (/parse error/i.test(String(error instanceof Error ? error.message : error))) {
      throw new Error(tr("sftp:editor.pdf_unsupported_svg", {defaultValue:"此 SVG 含有 PDF 转换器不支持的路径或样式语法"}));
    }
    throw error;
  } finally {
    host.remove();
  }
}

async function createSftpSvgDownloadBlob(blob: Blob, options: SvgExportOptions = {}) {
  const sanitizedRoot = sanitizeSftpSvgDocument(await blob.text());
  const svg = document.importNode(sanitizedRoot, true);
  const namespace = "http://www.w3.org/2000/svg";
  svg.setAttribute("xmlns", namespace);
  const embeddedStyles = String(sanitizedRoot.__termaEmbeddedStyles || "");
  if (embeddedStyles) {
    const style = document.createElementNS(namespace, "style");
    style.textContent = embeddedStyles;
    svg.insertBefore(style, svg.firstChild);
  }
  const colorMode = sftpSvgColorMode(options);
  if (colorMode !== "original") sftpSvgPdfInvertColors(svg, colorMode);
  const markup = new XMLSerializer().serializeToString(svg);
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], {type:"image/svg+xml"});
}


return { stripSftpSvgPdfFontDeclarations, stripSftpSvgPdfStyles, sftpSvgPdfNeedsUnicodeFont, sftpSvgPdfBinaryString, installSftpSvgPdfFont, forceSftpSvgPdfUnicodeFont, sftpSvgPdfNumber, sftpSvgPdfViewportTransform, sftpSvgPdfReferencedId, sftpSvgPdfFindReferencedElement, sftpSvgPdfMakeSymbolOverflowVisible, sftpSvgPdfFlattenSymbols, sftpSvgPdfContentBounds, sftpSvgPdfExpandViewBox, sftpSvgColorMode, sftpSvgColorModeSuffix, sftpSvgColorModeFilter, sftpSvgPdfResolveColor, sftpSvgPdfParseColor, sftpSvgPdfInvertColor, sftpSvgPdfInvertCss, sftpSvgPdfPaintSnapshot, sftpSvgPdfIsNearWhite, sftpSvgPdfIsDarkSurface, sftpSvgPdfElementBounds, sftpSvgPdfBoundsOverlapDetail, sftpSvgPdfBackgroundElements, sftpSvgPdfHasLocalDarkSurface, sftpSvgPdfInvertColors, createSftpSvgPdfBlob, createSftpSvgDownloadBlob };
}
