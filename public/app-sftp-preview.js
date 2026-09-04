function sftpSvgNumericDimension(value, fallback) {
  const text = String(value || "").trim();
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
  const number = match ? Number(match[1]) : 0;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sftpSvgHasUnsafeCssResource(value) {
  const css = String(value || "");
  if (/@import/i.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!String(match[2] || "").trim().startsWith("#")) return true;
  }
  return false;
}

function sftpSvgEmbeddedStyleText(value) {
  return String(value || "")
    .replace(/^\s*<!\[CDATA\[/i, "")
    .replace(/\]\]>\s*$/i, "")
    .trim();
}

function sanitizeSftpSvgDocument(markup) {
  // Do not feed source <style> elements to DOMParser.  Chromium evaluates the
  // inline style while parsing the detached SVG document, before we have a
  // chance to sanitize it or attach the CSP nonce.  Besides producing a CSP
  // violation, that makes the preview noisy in the UI smoke console.  Keep
  // the CSS text separately and hoist only the sanitized rules into the
  // nonce-bearing Shadow DOM stylesheet below.
  const embeddedStyleTexts = [];
  const source = String(markup || "");
  const markupWithoutStyles = source
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, css) => {
      embeddedStyleTexts.push(String(css || ""));
      return "";
    })
    .replace(/<style\b[^>]*\/\s*>/gi, "");
  const documentNode = new DOMParser().parseFromString(markupWithoutStyles, "image/svg+xml");
  if (documentNode.querySelector("parsererror")) throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  const root = documentNode.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  root.querySelectorAll("script,foreignObject,iframe,object,embed,video,audio,animate,set,animateTransform,animateMotion").forEach(node => node.remove());
  [root, ...root.querySelectorAll("*")].forEach(element => {
    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      const embeddedRaster = element.tagName.toLowerCase() === "image" && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
      if (["href", "xlink:href"].includes(name) && value && !value.startsWith("#") && !embeddedRaster) element.removeAttribute(attribute.name);
      if (name === "style" && sftpSvgHasUnsafeCssResource(value)) element.removeAttribute(attribute.name);
    });
  });
  root.querySelectorAll("style").forEach(element => {
    if (sftpSvgHasUnsafeCssResource(element.textContent || "")) element.remove();
  });
  Object.defineProperty(root, "__termaEmbeddedStyles", {
    configurable: true,
    value: embeddedStyleTexts
      .map(sftpSvgEmbeddedStyleText)
      .filter(css => css && !sftpSvgHasUnsafeCssResource(css))
      .join("\n")
  });
  return root;
}

function sftpSvgExportViewBox(root) {
  const values = String(root?.getAttribute?.("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const valid = values.length >= 4
    && values.slice(0, 4).every(Number.isFinite)
    && values[2] > 0
    && values[3] > 0;
  const width = valid ? values[2] : sftpSvgNumericDimension(root?.getAttribute?.("width"), 1024);
  const height = valid ? values[3] : sftpSvgNumericDimension(root?.getAttribute?.("height"), 768);
  return {
    x: valid ? values[0] : 0,
    y: valid ? values[1] : 0,
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function stripSftpSvgPdfFontDeclarations(root) {
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

function stripSftpSvgPdfStyles(root) {
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
let sftpSvgPdfFontBinaryPromise = null;

function sftpSvgPdfNeedsUnicodeFont(root) {
  const text = [...root.querySelectorAll("text,tspan,title,desc")]
    .map(element => element.textContent || "")
    .join("");
  return /[^\u0000-\u00ff]/u.test(text);
}

function sftpSvgPdfBinaryString(buffer) {
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

function installSftpSvgPdfFont(pdf, binary) {
  pdf.addFileToVFS(SFTP_SVG_PDF_FONT_FILE, binary);
  for (const style of ["normal", "bold", "italic", "bolditalic"]) {
    pdf.addFont(SFTP_SVG_PDF_FONT_FILE, SFTP_SVG_PDF_FONT_NAME, style, "Identity-H");
  }
  pdf.setFont(SFTP_SVG_PDF_FONT_NAME, "normal");
}

function forceSftpSvgPdfUnicodeFont(root) {
  stripSftpSvgPdfFontDeclarations(root);
  root.querySelectorAll("text,tspan").forEach(element => {
    element.setAttribute("font-family", SFTP_SVG_PDF_FONT_NAME);
    element.setAttribute("font-weight", "normal");
    element.setAttribute("font-style", "normal");
  });
  return root;
}

function sftpSvgPdfNumber(value, fallback=0) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : fallback;
}

function sftpSvgPdfViewportTransform(use, referenced, viewBox) {
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

function sftpSvgPdfReferencedId(element) {
  const href = element?.getAttribute?.("href") || element?.getAttribute?.("xlink:href") || "";
  return String(href).trim().replace(/^#/, "");
}

function sftpSvgPdfFindReferencedElement(root, id) {
  if (!id) return null;
  return [...root.querySelectorAll("[id]")].find(element => element.getAttribute("id") === id) || null;
}

function sftpSvgPdfMakeSymbolOverflowVisible(root) {
  root.querySelectorAll("symbol,svg").forEach(element => {
    if (element.tagName.toLowerCase() === "symbol" || element !== root) element.setAttribute("overflow", "visible");
  });
  return root;
}

function sftpSvgPdfFlattenSymbols(root) {
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
        if (use.hasAttribute(attribute)) group.setAttribute(attribute, use.getAttribute(attribute));
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

function sftpSvgPdfContentBounds(root) {
  const bounds = [];
  const drawable = new Set(["path", "polyline", "polygon", "line", "rect", "circle", "ellipse", "text", "tspan", "image"]);
  for (const element of root.querySelectorAll("*")) {
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

function sftpSvgPdfExpandViewBox(root, dimensions) {
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

function sftpSvgColorMode(options = {}) {
  const requested = typeof options === "string" ? options : options.colorMode;
  if (SFTP_SVG_COLOR_MODES.has(requested)) return requested;
  return options?.invert ? "invert-color" : "original";
}

function sftpSvgColorModeSuffix(mode) {
  if (mode === "invert-mono") return "-inverted-mono";
  if (mode === "invert-bw") return "-inverted-bw";
  if (mode === "invert-color") return "-inverted-color";
  return "";
}

function sftpSvgColorModeFilter(mode) {
  if (mode === "invert-color") return "invert(1)";
  return "";
}

function sftpSvgPdfResolveColor(source) {
  const key = String(source || "").trim();
  if (!key || sftpSvgPdfColorResolutionCache.has(key)) return sftpSvgPdfColorResolutionCache.get(key) || "";
  let resolved = "";
  try {
    if (globalThis.CSS?.supports?.("color", key) && globalThis.document?.createElement) {
      sftpSvgPdfColorProbe ||= document.createElementNS("http://www.w3.org/1999/xhtml", "canvas").getContext("2d", {willReadFrequently:true});
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

function sftpSvgPdfParseColor(value) {
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
    const channel = item => String(item).endsWith("%") ? Math.round(Math.max(0, Math.min(100, parseFloat(item))) * 2.55) : Math.round(Math.max(0, Math.min(255, parseFloat(item))));
    r = channel(parts[0]);
    g = channel(parts[1]);
    b = channel(parts[2]);
    if (parts[3] !== undefined) a = String(parts[3]).endsWith("%") ? Math.max(0, Math.min(1, parseFloat(parts[3]) / 100)) : Math.max(0, Math.min(1, parseFloat(parts[3])));
  }
  return {r, g, b, a, important};
}

function sftpSvgPdfInvertColor(value, mode = "invert-color", options = {}) {
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

function sftpSvgPdfInvertCss(value, mode = "invert-color", optionResolver = null) {
  return String(value || "").replace(/((fill|stroke|stop-color|flood-color|lighting-color|solid-color|color|background-color)\s*:\s*)([^;}\n]+)/gi, (_match, prefix, property, color) => {
    const options = typeof optionResolver === "function" ? optionResolver(property.toLowerCase(), color) : {};
    return `${prefix}${sftpSvgPdfInvertColor(color, mode, options)}`;
  });
}

function sftpSvgPdfPaintSnapshot(root) {
  const colorAttributes = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "solid-color", "color", "background-color"]);
  const snapshot = new Map();
  [root, ...root.querySelectorAll("*")].forEach(element => {
    const paints = new Map();
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

function sftpSvgPdfIsNearWhite(value) {
  const parsed = sftpSvgPdfParseColor(value);
  return Boolean(parsed && parsed.a > .05 && Math.min(parsed.r, parsed.g, parsed.b) >= 240);
}

function sftpSvgPdfIsDarkSurface(value) {
  const parsed = sftpSvgPdfParseColor(value);
  return Boolean(parsed && parsed.a > .05 && Math.min(parsed.r, parsed.g, parsed.b) < 240);
}

function sftpSvgPdfElementBounds(element) {
  if (!element) return null;
  const tag = element.tagName?.toLowerCase();
  const numeric = name => sftpSvgPdfNumber(element.getAttribute(name), 0);
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
      const box = element.isConnected && typeof element.getBBox === "function" ? element.getBBox() : null;
      if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
      return {x:box.x, y:box.y, width:Math.max(0, box.width), height:Math.max(0, box.height)};
    } catch {
      return null;
    }
  }
  return {x, y, width, height};
}

function sftpSvgPdfBoundsOverlapDetail(detailBounds, surfaceBounds) {
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

function sftpSvgPdfBackgroundElements(root, snapshot) {
  const dimensions = sftpSvgExportViewBox(root);
  const toleranceX = Math.max(1, dimensions.width * .01);
  const toleranceY = Math.max(1, dimensions.height * .01);
  const backgroundElements = new Set();
  const hasBackgroundName = element => {
    for (let current = element; current && current !== root; current = current.parentElement) {
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

function sftpSvgPdfHasLocalDarkSurface(element, property, snapshot, root) {
  const ownPaints = snapshot.get(element) || new Map();
  // Keep white details only when the same SVG element has a real dark fill.
  // Looking at nearby siblings or ancestors is too broad for CAD symbols:
  // a tiny black arrow next to a white transformer outline must not make the
  // entire outline white on the new white canvas.
  return [...ownPaints]
    .some(([name, value]) => name !== property && ["fill", "background-color"].includes(name) && sftpSvgPdfIsDarkSurface(value));
}

function sftpSvgPdfInvertColors(root, mode = "invert-color") {
  const colorAttributes = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "solid-color", "color", "background-color"]);
  const paintSnapshot = mode === "invert-bw" ? sftpSvgPdfPaintSnapshot(root) : null;
  const backgroundElements = paintSnapshot ? sftpSvgPdfBackgroundElements(root, paintSnapshot) : new Set();
  const colorOptions = (element, property, color) => {
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

async function createSftpSvgPdfBlob(blob, options = {}) {
  const JsPDF = window.jspdf?.jsPDF;
  const convertSvg = window.svg2pdf?.svg2pdf;
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
  const render = async source => {
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
    const firstSource = needsUnicodeFont ? forceSftpSvgPdfUnicodeFont(svg.cloneNode(true)) : svg;
    try {
      return await render(firstSource);
    } catch (error) {
      if (!/parse error/i.test(String(error?.message || error))) throw error;
      try {
        const compatibleSource = stripSftpSvgPdfFontDeclarations(svg.cloneNode(true));
        if (needsUnicodeFont) forceSftpSvgPdfUnicodeFont(compatibleSource);
        return await render(compatibleSource);
      } catch (compatibilityError) {
        if (!/parse error/i.test(String(compatibilityError?.message || compatibilityError))) throw compatibilityError;
        const styleFreeSource = stripSftpSvgPdfStyles(svg.cloneNode(true));
        if (needsUnicodeFont) forceSftpSvgPdfUnicodeFont(styleFreeSource);
        return await render(styleFreeSource);
      }
    }
  } catch (error) {
    if (/parse error/i.test(String(error?.message || error))) {
      throw new Error(tr("sftp:editor.pdf_unsupported_svg", {defaultValue:"此 SVG 含有 PDF 转换器不支持的路径或样式语法"}));
    }
    throw error;
  } finally {
    host.remove();
  }
}

async function createSftpSvgDownloadBlob(blob, options = {}) {
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

function triggerSftpGeneratedDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

async function downloadSftpSvgAsPdf(id, path, sourceBlob=null, options = {}) {
  try {
    const blob = sourceBlob || await withSftpFileOpenFeedback(id, path, () => readSftpImageWithProgress(id, path));
    if (!blob) return false;
    notify(tr("sftp:editor.exporting_pdf", {defaultValue:"正在导出 SVG PDF..."}), "info");
    const colorMode = sftpSvgColorMode(options);
    const inverted = colorMode !== "original";
    const pdfBlob = await createSftpSvgPdfBlob(blob, {colorMode});
    const sourceName = String(path || "svg").split(/[\\/]/).pop() || "svg";
    const filename = sourceName.replace(/\.svg$/i, "") + sftpSvgColorModeSuffix(colorMode) + ".pdf";
    const task = typeof saveSftpGeneratedFileTask === "function"
      ? await saveSftpGeneratedFileTask(pdfBlob, filename, {
          label:tr("sftp:editor.generated_task", {name:filename, defaultValue:`SVG 转 PDF：${filename}`}),
          connectionId:id,
          connectionName:connections.find(item => Number(item.id) === Number(id))?.name || "",
          sourcePath:path,
          inverted,
          colorMode
        })
      : (triggerSftpGeneratedDownload(pdfBlob, filename), null);
    const saved = task?.delivery_status === "saved" && task?.saved_path;
    notify(saved
      ? `${tr("sftp:editor.pdf_exported_to_tasks", {defaultValue:"SVG PDF 已保存"})}\n${tr("tasks:notifications.saved_to", {path:task.saved_path, defaultValue:`已保存到 ${task.saved_path}`})}`
      : tr("sftp:editor.pdf_exported", {defaultValue:"SVG PDF 已生成并开始下载"}), "success", saved ? {
        action:{generated_task_id:task.id, can_open_file:true, can_open_directory:true, can_delete_file:true}
      } : {});
    return task || true;
  } catch (error) {
    notify(error.message || tr("sftp:editor.pdf_export_failed", {defaultValue:"SVG 转 PDF 失败"}), "error");
    return false;
  }
}

async function downloadSftpSvgWithColorMode(id, path, sourceBlob, colorMode) {
  if (colorMode === "original") return downloadSftp(id, path);
  try {
    notify(tr("sftp:editor.exporting_svg", {defaultValue:"正在生成反色 SVG..."}), "info");
    const svgBlob = await createSftpSvgDownloadBlob(sourceBlob, {colorMode});
    const sourceName = String(path || "svg").split(/[\\/]/).pop() || "svg";
    const filename = sourceName.replace(/\.svg$/i, "") + sftpSvgColorModeSuffix(colorMode) + ".svg";
    const task = typeof saveSftpGeneratedFileTask === "function"
      ? await saveSftpGeneratedFileTask(svgBlob, filename, {
          label:tr("sftp:editor.generated_svg_task", {name:filename, defaultValue:`处理后的 SVG：${filename}`}),
          connectionId:id,
          connectionName:connections.find(item => Number(item.id) === Number(id))?.name || "",
          sourcePath:path,
          inverted:true,
          colorMode
        })
      : (triggerSftpGeneratedDownload(svgBlob, filename), null);
    const saved = task?.delivery_status === "saved" && task?.saved_path;
    notify(saved
      ? `${tr("sftp:editor.svg_exported_to_tasks", {defaultValue:"处理后的 SVG 已保存"})}\n${tr("tasks:notifications.saved_to", {path:task.saved_path, defaultValue:`已保存到 ${task.saved_path}`})}`
      : tr("sftp:editor.svg_exported", {defaultValue:"处理后的 SVG 已生成并开始下载"}), "success", saved ? {
        action:{generated_task_id:task.id, can_open_file:true, can_open_directory:true, can_delete_file:true}
      } : {});
    return task || true;
  } catch (error) {
    notify(error.message || tr("sftp:editor.svg_export_failed", {defaultValue:"反色 SVG 生成失败"}), "error");
    return false;
  }
}

async function previewSftpImage(id, path) {
  let objectUrl = "";
  let modal = null;
  try {
    const blob = await withSftpFileOpenFeedback(id, path, () => readSftpImageWithProgress(id, path));
    if (!blob) return;
    objectUrl = URL.createObjectURL(blob);
    modal = $("modal");
    const closeLabel = tr("sftp:editor.close", {defaultValue:"关闭"});
    const isSvg = /\.svg$/i.test(String(path || "")) || String(blob.type || "").toLowerCase() === "image/svg+xml";
    const searchLabel = tr("sftp:editor.svg_search", {defaultValue:"搜索 SVG 属性或文本"});
    const searchPreviousLabel = tr("sftp:editor.search_previous", {defaultValue:"上一个匹配"});
    const searchNextLabel = tr("sftp:editor.search_next", {defaultValue:"下一个匹配"});
    const zoomOutLabel = tr("sftp:editor.zoom_out", {defaultValue:"缩小"});
    const zoomInLabel = tr("sftp:editor.zoom_in", {defaultValue:"放大"});
    const zoomResetLabel = tr("sftp:editor.zoom_reset", {defaultValue:"适应窗口"});
    const invertLabel = tr("sftp:editor.invert_colors", {defaultValue:"反色"});
    const originalColorsLabel = tr("sftp:editor.color_mode_original", {defaultValue:"正色"});
    const monochromeInvertLabel = tr("sftp:editor.color_mode_invert_mono", {defaultValue:"黑白反转"});
    const blackWhiteModeLabel = tr("sftp:editor.color_mode_invert_bw", {defaultValue:"黑白模式"});
    const colorInvertLabel = tr("sftp:editor.color_mode_invert_color", {defaultValue:"全局反转"});
    const colorModeControl = isSvg
      ? `<label class="sftp-svg-color-mode"><span class="sftp-svg-color-mode-label">${icon("contrast")}<span>${esc(invertLabel)}</span></span><select id="sftpImageColorMode" title="${escAttr(invertLabel)}" aria-label="${escAttr(invertLabel)}"><option value="original">${esc(originalColorsLabel)}</option><option value="invert-mono">${esc(monochromeInvertLabel)}</option><option value="invert-bw">${esc(blackWhiteModeLabel)}</option><option value="invert-color">${esc(colorInvertLabel)}</option></select></label>`
      : "";
    modal.innerHTML = `<div class="modal-card wide sftp-image-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(path.split(/[\\/]/).pop() || path)}</h2><span>${esc(formatBytes(blob.size))}</span></div><div class="sftp-image-tools"><button id="sftpImageZoomOut" class="icon-button" type="button" title="${escAttr(zoomOutLabel)}" aria-label="${escAttr(zoomOutLabel)}">${icon("minus")}</button><span id="sftpImageZoomValue" class="sftp-image-zoom-value">100%</span><button id="sftpImageZoomReset" class="icon-button" type="button" title="${escAttr(zoomResetLabel)}" aria-label="${escAttr(zoomResetLabel)}">${icon("maximize-2")}</button><button id="sftpImageZoomIn" class="icon-button" type="button" title="${escAttr(zoomInLabel)}" aria-label="${escAttr(zoomInLabel)}">${icon("plus")}</button>${colorModeControl}${isSvg ? `<div class="sftp-svg-search"><div class="sftp-svg-search-controls"><label><span class="sr-only">${esc(searchLabel)}</span><input id="sftpSvgSearch" type="search" placeholder="${escAttr(searchLabel)}" autocomplete="off"></label><button id="sftpSvgSearchPrevious" class="icon-button" type="button" title="${escAttr(searchPreviousLabel)}" aria-label="${escAttr(searchPreviousLabel)}">${icon("arrow-up")}</button><button id="sftpSvgSearchNext" class="icon-button" type="button" title="${escAttr(searchNextLabel)}" aria-label="${escAttr(searchNextLabel)}">${icon("arrow-down")}</button></div><span id="sftpSvgSearchCount" aria-live="polite"></span></div>` : ""}<button id="sftpImageClose" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div></div><div id="sftpImageViewport" class="sftp-image-preview"><div id="sftpImageStageShell" class="sftp-image-stage-shell"><div id="sftpImageStage" class="sftp-image-stage"></div></div></div><div class="actions">${isSvg ? `<button id="sftpImageExportPdf">${icon("file-code-2")}<span>${esc(tr("sftp:editor.export_pdf", {defaultValue:"导出 PDF"}))}</span></button>` : ""}<button id="sftpImageDownload">${icon("download")}<span>${esc(tr("sftp:menu.download", {defaultValue:"下载"}))}</span></button><button id="sftpImageCloseBottom">${esc(closeLabel)}</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    const imageCard = modal.querySelector(".sftp-image-modal");
    const fullscreenLabel = tr("sftp:editor.fullscreen", {defaultValue:"全屏"});
    const exitFullscreenLabel = tr("sftp:editor.exit_fullscreen", {defaultValue:"退出全屏"});
    const fullscreenButton = document.createElement("button");
    fullscreenButton.id = "sftpImageFullscreen";
    fullscreenButton.className = "icon-button";
    fullscreenButton.type = "button";
    $("sftpImageClose")?.before(fullscreenButton);
    const syncFullscreen = enabled => {
      imageCard?.classList.toggle("is-fullscreen", enabled);
      fullscreenButton.title = enabled ? exitFullscreenLabel : fullscreenLabel;
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
      fullscreenButton.innerHTML = icon(enabled ? "minimize-2" : "maximize");
      localStorage.setItem("sftpImagePreviewFullscreen", enabled ? "1" : "0");
      refreshIcons();
    };
    syncFullscreen(localStorage.getItem("sftpImagePreviewFullscreen") === "1");
    const viewport = $("sftpImageViewport");
    const shell = $("sftpImageStageShell");
    const stage = $("sftpImageStage");
    let root = null;
    let svgOriginalRoot = null;
    let baseWidth = 1;
    let baseHeight = 1;
    let colorMode = "original";
    let syncSvgPreviewStyle = () => {};
    if (isSvg) {
      const sanitizedRoot = sanitizeSftpSvgDocument(await blob.text());
      const embeddedStyles = String(sanitizedRoot.__termaEmbeddedStyles || "");
      const viewBox = String(sanitizedRoot.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      const sourceViewBoxValid = viewBox.length >= 4
        && viewBox.slice(0, 4).every(Number.isFinite)
        && viewBox[2] > 0
        && viewBox[3] > 0;
      const viewX = sourceViewBoxValid ? viewBox[0] : 0;
      const viewY = sourceViewBoxValid ? viewBox[1] : 0;
      const viewWidth = sourceViewBoxValid ? viewBox[2] : 1024;
      const viewHeight = sourceViewBoxValid ? viewBox[3] : 768;
      const coordinateExtent = String(sanitizedRoot.getAttribute("coordinateExtent") || "")
        .trim().split(/[\s,]+/).map(Number);
      const coordinateExtentValid = coordinateExtent.length >= 4
        && coordinateExtent.slice(0, 4).every(Number.isFinite)
        && coordinateExtent[2] > coordinateExtent[0]
        && coordinateExtent[3] > coordinateExtent[1];
      baseWidth = sftpSvgNumericDimension(sanitizedRoot.getAttribute("width"), viewWidth);
      baseHeight = sftpSvgNumericDimension(sanitizedRoot.getAttribute("height"), viewHeight);
      if (!sanitizedRoot.getAttribute("height") && sanitizedRoot.getAttribute("width") && viewWidth > 0) baseHeight = baseWidth * viewHeight / viewWidth;
      root = document.importNode(sanitizedRoot, true);
      if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
      root.setAttribute("preserveAspectRatio", root.getAttribute("preserveAspectRatio") || "xMidYMid meet");
      root.removeAttribute("width");
      root.removeAttribute("height");
      root.style.width = `${baseWidth}px`;
      root.style.height = `${baseHeight}px`;
      root.style.display = "block";
      root.style.overflow = "visible";
      root.setAttribute("overflow", "visible");
      const shadow = stage.attachShadow({mode:"open"});
      const previewStyle = document.createElement("style");
      // Chromium does not activate <style> nodes kept inside an imported SVG
      // when that SVG is mounted in a ShadowRoot.  Hoist the already-sanitized
      // rules into the shadow stylesheet so class-based strokes/fills and
      // symbol overflow behave exactly like the source SVG.
      const searchHighlightStyle = ".sftp-svg-search-current{filter:drop-shadow(0 0 4px #ff3158) drop-shadow(0 0 8px #ffd43b)}";
      syncSvgPreviewStyle = mode => {
        previewStyle.textContent = `${mode === "original" ? embeddedStyles : sftpSvgPdfInvertCss(embeddedStyles, mode)}\n${searchHighlightStyle}`;
      };
      syncSvgPreviewStyle("original");
      shadow.append(previewStyle, root);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        // Large diagram SVGs often contain thousands of <use>/<symbol> nodes.
        // A full getBBox() walk is both slow and unreliable for those files;
        // prefer the producer-provided coordinateExtent and keep one stable
        // intrinsic size so fitting cannot repeatedly shrink the preview.
        const useCount = root.querySelectorAll("use,symbol").length;
        // A producer-provided viewBox is the authoritative drawing canvas.
        // Chromium's getBBox() is not reliable for large <use>/<symbol>
        // diagrams and can return a partial box, which makes the whole image
        // appear shrunk or drops controls/lines.  Only measure simple SVGs
        // that do not provide a valid viewBox of their own.
        const shouldMeasureBounds = !sourceViewBoxValid
          && blob.size < 1_500_000
          && useCount < 120;
        const contentBounds = shouldMeasureBounds
          ? (() => {
              try { return root.getBBox({fill:true, stroke:true, markers:true, clipped:false}); }
              catch { try { return root.getBBox(); } catch { return null; } }
            })()
          : null;
        const extent = coordinateExtentValid
          ? {x:coordinateExtent[0], y:coordinateExtent[1], width:coordinateExtent[2] - coordinateExtent[0], height:coordinateExtent[3] - coordinateExtent[1]}
          : contentBounds;
        if (!sourceViewBoxValid && extent && Number.isFinite(extent.width) && extent.width > 0 && extent.height > 0) {
          const padding = Math.max(1, Math.min(viewWidth, viewHeight) * .01);
          const minX = Math.min(viewX, extent.x) - padding;
          const minY = Math.min(viewY, extent.y) - padding;
          const maxX = Math.max(viewX + viewWidth, extent.x + extent.width) + padding;
          const maxY = Math.max(viewY + viewHeight, extent.y + extent.height) + padding;
          const expandedWidth = Math.max(1, maxX - minX);
          const expandedHeight = Math.max(1, maxY - minY);
          if (expandedWidth > viewWidth * 1.002 || expandedHeight > viewHeight * 1.002 || minX < viewX || minY < viewY) {
            root.setAttribute("viewBox", `${minX} ${minY} ${expandedWidth} ${expandedHeight}`);
            const displayRatio = Math.max(0.0001, baseWidth / baseHeight);
            const contentRatio = expandedWidth / expandedHeight;
            if (contentRatio > displayRatio) baseHeight = baseWidth / contentRatio;
            else baseWidth = baseHeight * contentRatio;
            root.style.width = `${baseWidth}px`;
            root.style.height = `${baseHeight}px`;
          }
        }
      } catch {}
      svgOriginalRoot = root.cloneNode(true);
    } else {
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = path;
      image.draggable = false;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      baseWidth = Math.max(1, Number(image.naturalWidth || 1024));
      baseHeight = Math.max(1, Number(image.naturalHeight || 768));
      image.style.width = `${baseWidth}px`;
      image.style.height = `${baseHeight}px`;
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      stage.appendChild(image);
    }
    const syncSvgColorMode = nextMode => {
      colorMode = sftpSvgColorMode(nextMode);
      syncSvgPreviewStyle(colorMode);
      if (isSvg && root && svgOriginalRoot && colorMode !== "original") {
        const replacement = svgOriginalRoot.cloneNode(true);
        sftpSvgPdfInvertColors(replacement, colorMode);
        root.replaceWith(replacement);
        root = replacement;
        stage.style.filter = "";
      } else if (isSvg && root && svgOriginalRoot && colorMode === "original" && root !== svgOriginalRoot) {
        const replacement = svgOriginalRoot.cloneNode(true);
        root.replaceWith(replacement);
        root = replacement;
        stage.style.filter = "";
      } else {
        stage.style.filter = sftpSvgColorModeFilter(colorMode);
      }
      const select = $("sftpImageColorMode");
      if (select) select.value = colorMode;
    };
    syncSvgColorMode("original");
    stage.style.width = `${baseWidth}px`;
    stage.style.height = `${baseHeight}px`;
    let scale = 1;
    let fitMode = true;
    let suppressResizeUntil = 0;
    let svgMatches = [];
    let svgMatchIndex = -1;
    let svgSearchQuery = "";
    let colorModeChangeSequence = 0;
    const matchMarker = document.createElement("div");
    matchMarker.className = "sftp-svg-match-marker";
    matchMarker.hidden = true;
    shell.appendChild(matchMarker);
    const updateZoom = (next, anchor=null) => {
      if (!Number.isFinite(next) || next <= 0) return;
      const viewportRect = viewport.getBoundingClientRect();
      const anchorX = Number.isFinite(anchor?.clientX) ? anchor.clientX : viewportRect.left + viewport.clientWidth / 2;
      const anchorY = Number.isFinite(anchor?.clientY) ? anchor.clientY : viewportRect.top + viewport.clientHeight / 2;
      const stageRectBefore = stage.getBoundingClientRect();
      const documentX = (anchorX - stageRectBefore.left) / scale;
      const documentY = (anchorY - stageRectBefore.top) / scale;
      scale = Math.max(0.05, next);
      shell.style.width = `${Math.max(1, baseWidth * scale)}px`;
      shell.style.height = `${Math.max(1, baseHeight * scale)}px`;
      stage.style.transform = `scale(${scale})`;
      $("sftpImageZoomValue").textContent = `${Math.round(scale * 100)}%`;
      const stageRectAfter = stage.getBoundingClientRect();
      viewport.scrollLeft += stageRectAfter.left + documentX * scale - anchorX;
      viewport.scrollTop += stageRectAfter.top + documentY * scale - anchorY;
      requestAnimationFrame(() => updateSvgMatchMarker());
    };
    const fit = () => {
      fitMode = true;
      const availableWidth = Math.max(120, viewport.clientWidth - 28);
      const availableHeight = Math.max(120, viewport.clientHeight - 28);
      const nextScale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
      suppressResizeUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 180;
      updateZoom(Math.max(0.05, nextScale));
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
        viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
      });
    };
    const svgElementDocumentBounds = element => {
      if (!element?.getBoundingClientRect) return null;
      const stageRect = stage.getBoundingClientRect();
      try {
        if (typeof element.getBBox === "function" && typeof element.getScreenCTM === "function") {
          const box = element.getBBox();
          const matrix = element.getScreenCTM();
          if (matrix && Number.isFinite(box.width) && Number.isFinite(box.height)) {
            const corners = [
              new DOMPoint(box.x, box.y),
              new DOMPoint(box.x + box.width, box.y),
              new DOMPoint(box.x, box.y + box.height),
              new DOMPoint(box.x + box.width, box.y + box.height)
            ].map(point => point.matrixTransform(matrix));
            const left = Math.min(...corners.map(point => point.x));
            const right = Math.max(...corners.map(point => point.x));
            const top = Math.min(...corners.map(point => point.y));
            const bottom = Math.max(...corners.map(point => point.y));
            return {x:(left - stageRect.left) / scale, y:(top - stageRect.top) / scale, width:Math.max(1, (right - left) / scale), height:Math.max(1, (bottom - top) / scale)};
          }
        }
      } catch {}
      const elementRect = element.getBoundingClientRect();
      return {x:(elementRect.left - stageRect.left) / scale, y:(elementRect.top - stageRect.top) / scale, width:Math.max(1, elementRect.width / scale), height:Math.max(1, elementRect.height / scale)};
    };
    const updateSvgMatchMarker = () => {
      if (!root || svgMatchIndex < 0 || !svgMatches[svgMatchIndex]) {
        matchMarker.hidden = true;
        return;
      }
      const current = svgMatches[svgMatchIndex];
      const bounds = svgElementDocumentBounds(current);
      if (!bounds) return;
      const left = bounds.x * scale;
      const top = bounds.y * scale;
      matchMarker.hidden = false;
      matchMarker.style.left = `${Math.max(0, left)}px`;
      matchMarker.style.top = `${Math.max(0, top)}px`;
      matchMarker.style.width = `${Math.max(6, bounds.width * scale)}px`;
      matchMarker.style.height = `${Math.max(6, bounds.height * scale)}px`;
      matchMarker.dataset.match = `${svgMatchIndex + 1}/${svgMatches.length}`;
      const tag = String(current.localName || current.tagName || "element").toLowerCase();
      const id = String(current.getAttribute?.("id") || "").trim();
      const compactNumber = value => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "?";
      matchMarker.dataset.label = `${tag}${id ? `#${id}` : ""} ${compactNumber(bounds.width)} × ${compactNumber(bounds.height)}`;
    };
    const svgDrawableTags = new Set(["g", "use", "path", "polyline", "polygon", "line", "rect", "circle", "ellipse", "text", "image"]);
    const svgGroupHasDrawable = group => [...group.querySelectorAll("use,path,polyline,polygon,line,rect,circle,ellipse,text,image")]
      .some(node => !node.closest("defs"));
    const svgSearchTarget = source => {
      let fallbackGroup = null;
      let current = source;
      while (current && current !== root) {
        const tag = String(current.tagName || "").toLowerCase();
        if (tag === "g" && svgGroupHasDrawable(current)) {
          if (!fallbackGroup) fallbackGroup = current;
          if (current.hasAttribute("id")) return current;
        }
        current = current.parentElement;
      }
      if (fallbackGroup) return fallbackGroup;
      const sourceTag = String(source?.tagName || "").toLowerCase();
      return svgDrawableTags.has(sourceTag) && !source.closest("defs") ? source : null;
    };
    const svgSearchSourceText = element => {
      const attributes = [...(element?.attributes || [])]
        .map(attribute => `${attribute.name}=${attribute.value}`).join(" ");
      const directText = [...(element?.childNodes || [])]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || "").join(" ");
      return `${element?.tagName || ""} ${attributes} ${directText}`.toLowerCase();
    };
    const focusSvgMatch = element => {
      const bounds = svgElementDocumentBounds(element);
      if (!bounds) return;
      fitMode = false;
      const contextWidth = Math.max(720, bounds.width * 3);
      const contextHeight = Math.max(300, bounds.height * 3);
      const targetScale = Math.max(0.05, Math.min(4,
        (viewport.clientWidth * 0.86) / contextWidth,
        (viewport.clientHeight * 0.78) / contextHeight
      ));
      updateZoom(targetScale);
      requestAnimationFrame(() => {
        const centerX = (bounds.x + bounds.width / 2) * scale;
        const centerY = (bounds.y + bounds.height / 2) * scale;
        viewport.scrollLeft = Math.max(0, centerX - viewport.clientWidth / 2 + 12);
        viewport.scrollTop = Math.max(0, centerY - viewport.clientHeight / 2 + 12);
        updateSvgMatchMarker();
      });
    };
    const updateSvgSearch = (direction = 1, options = {}) => {
      if (!root) return;
      const query = String($("sftpSvgSearch")?.value || "").trim().toLowerCase();
      root.querySelectorAll(".sftp-svg-search-current").forEach(element => element.classList.remove("sftp-svg-search-current"));
      if (!query) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        $("sftpSvgSearchCount").textContent = "";
        matchMarker.hidden = true;
        if (options.fitEmpty !== false) fit();
        return;
      }
      if (query !== svgSearchQuery) {
        svgSearchQuery = query;
        svgMatchIndex = -1;
        const targets = new Set();
        const exactTargets = new Set();
        for (const source of root.querySelectorAll("*")) {
          if (source.closest("defs") || !svgSearchSourceText(source).includes(query)) continue;
          const sourceTag = String(source.localName || source.tagName || "").toLowerCase();
          if (source.closest("metadata") && /(?:glink_ref|layer_ref)$/.test(sourceTag)) continue;
          const target = svgSearchTarget(source);
          if (!target) continue;
          targets.add(target);
          if (String(target.getAttribute("id") || "").trim().toLowerCase() === query) exactTargets.add(target);
        }
        svgMatches = [...(exactTargets.size ? exactTargets : targets)];
      }
      if (!svgMatches.length) {
        svgMatchIndex = -1;
        $("sftpSvgSearchCount").textContent = tr("sftp:editor.svg_search_empty", {defaultValue:"无匹配"});
        return;
      }
      const preferredIndex = options.preferredId
        ? svgMatches.findIndex(element => String(element.getAttribute?.("id") || "") === options.preferredId)
        : -1;
      svgMatchIndex = preferredIndex >= 0
        ? preferredIndex
        : (svgMatchIndex + direction + svgMatches.length) % svgMatches.length;
      const current = svgMatches[svgMatchIndex];
      current.classList.add("sftp-svg-search-current");
      if (options.focus !== false) focusSvgMatch(current);
      else requestAnimationFrame(() => updateSvgMatchMarker());
      $("sftpSvgSearchCount").textContent = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const onWheel = event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      fitMode = false;
      updateZoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {clientX:event.clientX, clientY:event.clientY});
    };
    const onKeyDown = event => {
      if (!modal.contains(event.target) && !modal.contains(document.activeElement)) return;
      if (event.key === "Escape") return close();
      if (isSvg && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        $("sftpSvgSearch")?.focus();
        $("sftpSvgSearch")?.select();
      }
      if (isSvg && event.target?.id === "sftpSvgSearch" && event.key === "Enter") {
        event.preventDefault();
        updateSvgSearch(event.shiftKey ? -1 : 1);
      }
    };
    let panState = null;
    const onPanMove = event => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.clientX);
      viewport.scrollTop = panState.scrollTop - (event.clientY - panState.clientY);
    };
    const stopPan = event => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      panState = null;
      viewport.classList.remove("is-panning");
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
    };
    const startPan = event => {
      if (event.button !== 0 || event.target.closest("input,button,label")) return;
      panState = {pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, scrollLeft:viewport.scrollLeft, scrollTop:viewport.scrollTop};
      viewport.classList.add("is-panning");
      document.addEventListener("pointermove", onPanMove);
      document.addEventListener("pointerup", stopPan);
      document.addEventListener("pointercancel", stopPan);
      event.preventDefault();
    };
    let resizeFrame = 0;
    let observedWidth = 0;
    let observedHeight = 0;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const width = Math.round(rect?.width || 0);
      const height = Math.round(rect?.height || 0);
      if (Math.abs(width - observedWidth) < 2 && Math.abs(height - observedHeight) < 2) return;
      observedWidth = width;
      observedHeight = height;
      if ((typeof performance !== "undefined" ? performance.now() : Date.now()) < suppressResizeUntil) return;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (fitMode) fit();
        else updateSvgMatchMarker();
      });
    }) : null;
    const close = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", startPan);
      resizeObserver?.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      URL.revokeObjectURL(objectUrl);
      modal.hidden = true;
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    viewport.addEventListener("wheel", onWheel, {passive:false});
    viewport.addEventListener("pointerdown", startPan);
    resizeObserver?.observe(imageCard);
    document.addEventListener("keydown", onKeyDown, true);
    $("sftpImageZoomOut").onclick = () => { fitMode = false; updateZoom(scale / 1.25); };
    $("sftpImageZoomIn").onclick = () => { fitMode = false; updateZoom(scale * 1.25); };
    $("sftpImageZoomReset").onclick = fit;
    fullscreenButton.onclick = () => {
      syncFullscreen(!imageCard.classList.contains("is-fullscreen"));
      requestAnimationFrame(() => requestAnimationFrame(() => fitMode ? fit() : updateSvgMatchMarker()));
    };
    $("sftpSvgSearch")?.addEventListener("input", () => { svgMatchIndex = -1; updateSvgSearch(1); });
    $("sftpSvgSearchPrevious")?.addEventListener("click", () => updateSvgSearch(-1));
    $("sftpSvgSearchNext")?.addEventListener("click", () => updateSvgSearch(1));
    $("sftpImageColorMode")?.addEventListener("change", event => {
      const changeSequence = ++colorModeChangeSequence;
      const activeMatchId = svgMatches[svgMatchIndex]?.getAttribute?.("id") || "";
      const preservedView = {
        scale,
        fitMode,
        scrollLeft:viewport.scrollLeft,
        scrollTop:viewport.scrollTop,
        searchQuery:String($("sftpSvgSearch")?.value || "").trim().toLowerCase()
      };
      syncSvgColorMode(event.target.value);
      // Rebuild search targets after replacing the SVG root for a vector color
      // transform; references to the previous DOM tree are no longer usable.
      if (isSvg) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        updateSvgSearch(1, {focus:false, fitEmpty:false, preferredId:activeMatchId});
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (changeSequence !== colorModeChangeSequence) return;
          const currentSearchQuery = String($("sftpSvgSearch")?.value || "").trim().toLowerCase();
          if (currentSearchQuery !== preservedView.searchQuery) {
            if (!currentSearchQuery) fit();
            else updateSvgMatchMarker();
            return;
          }
          fitMode = preservedView.fitMode;
          if (Math.abs(scale - preservedView.scale) > .001) updateZoom(preservedView.scale);
          viewport.scrollLeft = preservedView.scrollLeft;
          viewport.scrollTop = preservedView.scrollTop;
          updateSvgMatchMarker();
        }));
      }
    });
    $("sftpImageExportPdf")?.addEventListener("click", () => downloadSftpSvgAsPdf(id, path, blob, {colorMode}));
    $("sftpImageDownload").onclick = () => isSvg ? downloadSftpSvgWithColorMode(id, path, blob, colorMode) : downloadSftp(id, path);
    $("sftpImageClose").onclick = close;
    $("sftpImageCloseBottom").onclick = close;
    $("sftpImageClose").focus();
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
    notify(error.message || tr("sftp:editor.image_preview_failed", {defaultValue:"图片预览失败"}), "error");
  }
}

async function previewSftpText(id, path) {
  const editorKey = typeof sftpTextEditorOpenKey === "function" ? sftpTextEditorOpenKey(id, path) : "";
  if (editorKey && typeof activateSftpTextEditor === "function" && activateSftpTextEditor(editorKey)) return;
  try {
    const editorConnection = connections.find(item => Number(item.id) === Number(id));
    let requestedEncoding = "";
    while (true) {
      const data = await withSftpFileOpenFeedback(id, path, () => readSftpTextWithProgress(id, path, requestedEncoding));
      if (!data) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (data.is_cancelled?.()) return;
      const editorPromise = sftpTextModal(path, data.content || "", data.size || 0, data.limit || 50*1024*1024, data.encoding || "utf8", data.preferred_encoding || "auto", {
        editorKey,
        editorKind:data.editor_kind || "ace",
        lineCount:data.line_count,
        lineEnding:data.line_ending,
        finalNewline:data.final_newline,
        bom:data.bom,
        serverName:editorConnection?.name || String(id),
        sourceLabel:`${editorConnection?.name || id} · ${path}`,
        onSave:next => api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, line_ending:next.line_ending, persist_default:next.persist_default})}),
        loadVersions:() => api(`/api/connections/${id}/sftp/versions?path=${encodeURIComponent(path)}&limit=10`).catch(() => ({versions:[]})),
        onReady:() => data.progress?.finish(tr("sftp:editor.opened", {size:formatBytes(data.size || 0), defaultValue:`已打开 · ${formatBytes(data.size || 0)}`})),
        loadVersion:async (version, versionEncoding) => {
          const loaded = await readSftpTextWithProgress(id, version.path, versionEncoding);
          loaded?.progress?.finish(tr("sftp:editor.opened_backup", {size:formatBytes(loaded.size || 0), defaultValue:`已打开备份 · ${formatBytes(loaded.size || 0)}`}));
          return loaded;
        }
      });
      data.content = "";
      const next = await editorPromise;
      if (next === null) return;
      if (next.action === "encoding") {
        requestedEncoding = next.encoding;
        continue;
      }
      if (!next.changed && !(next.persist_default && data.preferred_encoding !== next.encoding)) return notify(tr("sftp:editor.no_changes", {defaultValue:"文件内容没有变化"}), "info");
      const saved = next.savedResult || await api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, line_ending:next.line_ending, persist_default:next.persist_default})});
      const savedEncoding = saved?.encoding || next.encoding;
      if (editorConnection && next.persist_default) editorConnection.sftp_text_encoding = savedEncoding;
      if (typeof queueSftpDirectoryRefresh === "function") {
        queueSftpDirectoryRefresh(id);
        flushPendingSftpDirectoryRefresh();
      }
      notify((saved?.normalized_script || next.normalized_script) && (saved?.line_ending || next.line_ending) === "lf"
        ? tr("sftp:editor.saved_shell_script", {encoding:sftpTextEncodingLabel(savedEncoding), defaultValue:`脚本已按 ${sftpTextEncodingLabel(savedEncoding)}、Unix LF、无 BOM 保存`})
        : tr("sftp:editor.saved_with_encoding_and_line_ending", {encoding:sftpTextEncodingLabel(savedEncoding), lineEnding:sftpTextLineEndingLabel(saved?.line_ending || next.line_ending), defaultValue:`文件已按 ${sftpTextEncodingLabel(savedEncoding)}、${sftpTextLineEndingLabel(saved?.line_ending || next.line_ending)} 保存`}), "success");
      return;
    }
  } catch (error) {
    notify(error.message || tr("sftp:editor.remote_read_failed", {defaultValue:"读取文件失败"}), "error");
  }
}
