import type { createSvgExportService } from './svg-export';
import { sanitizeSvgDocument, svgNumericDimension } from './svg-engine';
import { createPreviewFrames } from './preview-frames';
import type { OpenProgress } from './file-open-service';
import { createPreviewModel } from './preview-model';
export interface PreviewOptions { content?: string; preserveUnsaved?: boolean; modified?: boolean; limit?: number; encoding?: string; preferredEncoding?: string; lineEnding?: string; finalNewline?: boolean; needsFormatRepair?: boolean }
export interface PreviewEditorOptions { initialContent?: string; initialSize?: number; initialLimit?: number; initialEncoding?: string; initialPreferredEncoding?: string; initialLineEnding?: string; initialFinalNewline?: boolean; initialNeedsFormatRepair?: boolean; initialModified?: boolean; forceNewEditor?: boolean; svgMode?: string }
export interface PreviewPort {
  host(): HTMLElement | null;
  image(id:number,path:string,onRead:(progress:OpenProgress)=>void): Promise<Blob|null>;
  bytes(size:number): string;
  release(host:HTMLElement): void;
  text(id:number,path:string,options:PreviewEditorOptions): unknown;
  download(id:number,path:string): unknown;
  pdf(id:number,path:string,blob:Blob,options:{colorMode:string}): unknown;
  svgDownload(id:number,path:string,blob:Blob,colorMode:string): unknown;
  svg: ReturnType<typeof createSvgExportService>;
  tr(key:string,values?:Record<string,unknown>): string;
  icon(name:string): string;
  refreshIcons(): void;
  error(message:string): void;
}
export function createImagePreview(port: PreviewPort) {
const { tr, icon, refreshIcons }=port;
const {sftpSvgColorMode,sftpSvgPdfInvertCss,sftpSvgPdfInvertColors,sftpSvgColorModeFilter}=port.svg;
const sanitizeSftpSvgDocument=(source:string)=>sanitizeSvgDocument(source,()=>tr('sftp:editor.svg_parse_failed'));
const sftpSvgNumericDimension=svgNumericDimension;
const mountSftpImagePreviewView=createPreviewModel({tr,bytes:port.bytes}).mount;
const downloadSftpSvgAsPdf=port.pdf,downloadSftpSvgWithColorMode=port.svgDownload,downloadSftp=port.download,previewSftpText=port.text;
let generation = 0;
let disposeCurrent: (() => void) | null = null;
async function previewSftpImage(id: number, path: string, previewOptions: PreviewOptions={}) {
  disposeCurrent?.();
  disposeCurrent = null;
  const owner = ++generation;
  let objectUrl = "";
  let failedHost: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;
  let opening: OpenProgress | undefined;
  const active = () => owner === generation;
  const frames = createPreviewFrames(active);
  const frame = frames.schedule;
  try {
    const hasInlineContent = Object.prototype.hasOwnProperty.call(previewOptions || {}, "content");
    const blob = hasInlineContent
      ? new Blob([String(previewOptions.content || "")], {type:"image/svg+xml"})
      : await port.image(id, path, progress => { opening = progress; });
    if (!blob || !active()) return;
    const modal = port.host();
    if (!modal) return;
    objectUrl = URL.createObjectURL(blob);
    const find = <T extends HTMLElement=HTMLElement>(id:string) => modal.querySelector<T>(`#${CSS.escape(id)}`);
    const get = <T extends HTMLElement=HTMLElement>(id:string):T => {
      const node = find<T>(id);
      if (!node) throw new Error('Missing preview control: '+id);
      return node;
    };
    failedHost=modal;
    const isSvg = /\.svg$/i.test(String(path || "")) || String(blob.type || "").toLowerCase() === "image/svg+xml";
    mountSftpImagePreviewView(modal, path, blob, isSvg);
    const imageCard = modal.querySelector<HTMLElement>(".sftp-image-modal")!;
    const ownsView = () => modal.contains(imageCard);
    const hostObserver = new MutationObserver(() => { if (!ownsView()) cleanup?.(); });
    const release = () => {
      if (!active()) return;
      generation++;
      frames.dispose();
      hostObserver.disconnect();
      URL.revokeObjectURL(objectUrl);
      if (ownsView()) modal.hidden = true;
      port.release(imageCard);
    };
    cleanup = disposeCurrent = release;
    hostObserver.observe(modal, {childList:true});
    if (imageCard.parentElement) hostObserver.observe(imageCard.parentElement, {childList:true});
    modal.hidden = false;
    modal.onclick = null;
    const fullscreenButton = get<HTMLButtonElement>('sftpImageFullscreen');
    const syncFullscreen = (enabled: boolean) => {
      imageCard?.classList.toggle("is-fullscreen", enabled);
      fullscreenButton.title = tr(enabled ? "sftp:editor.exit_fullscreen" : "sftp:editor.fullscreen");
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
      fullscreenButton.innerHTML = icon(enabled ? "minimize-2" : "maximize");
      localStorage.setItem("sftpImagePreviewFullscreen", enabled ? "1" : "0");
      refreshIcons();
    };
    syncFullscreen(localStorage.getItem("sftpImagePreviewFullscreen") === "1");
    const viewport = get("sftpImageViewport");
    const shell = get("sftpImageStageShell");
    const stage = get("sftpImageStage");
    let root: SVGSVGElement | null = null;
    let svgOriginalRoot: SVGSVGElement | null = null;
    let baseWidth = 1;
    let baseHeight = 1;
    let colorMode = "original";
    let svgSourceContent = "";
    let syncSvgPreviewStyle = (_mode: string) => {};
    if (isSvg) {
      svgSourceContent = await blob.text();
      if (!active()) { URL.revokeObjectURL(objectUrl); return; }
      const sanitizedRoot = sanitizeSftpSvgDocument(svgSourceContent);
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
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!active()) { URL.revokeObjectURL(objectUrl); return; }
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
      svgOriginalRoot = root.cloneNode(true) as SVGSVGElement;
    } else {
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = path;
      image.draggable = false;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
      if (!active()) return;
      baseWidth = Math.max(1, Number(image.naturalWidth || 1024));
      baseHeight = Math.max(1, Number(image.naturalHeight || 768));
      image.style.width = `${baseWidth}px`;
      image.style.height = `${baseHeight}px`;
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      stage.appendChild(image);
    }
    const syncSvgColorMode = (nextMode: string) => {
      colorMode = sftpSvgColorMode(nextMode);
      syncSvgPreviewStyle(colorMode);
      if (isSvg && root && svgOriginalRoot && colorMode !== "original") {
        const replacement = svgOriginalRoot.cloneNode(true) as SVGSVGElement;
        sftpSvgPdfInvertColors(replacement, colorMode);
        root.replaceWith(replacement);
        root = replacement;
        stage.style.filter = "";
      } else if (isSvg && root && svgOriginalRoot && colorMode === "original" && root !== svgOriginalRoot) {
        const replacement = svgOriginalRoot.cloneNode(true) as SVGSVGElement;
        root.replaceWith(replacement);
        root = replacement;
        stage.style.filter = "";
      } else {
        stage.style.filter = sftpSvgColorModeFilter(colorMode);
      }
      const select = find<HTMLSelectElement>("sftpImageColorMode");
      if (select) select.value = colorMode;
    };
    syncSvgColorMode("original");
    stage.style.width = `${baseWidth}px`;
    stage.style.height = `${baseHeight}px`;
    let scale = 1;
    let fitMode = true;
    let suppressResizeUntil = 0;
    let svgMatches: Element[] = [];
    let svgMatchIndex = -1;
    let svgSearchQuery = "";
    let colorModeChangeSequence = 0;
    const matchMarker = document.createElement("div");
    matchMarker.className = "sftp-svg-match-marker";
    matchMarker.hidden = true;
    shell.appendChild(matchMarker);
    const updateZoom = (next: number, anchor: {clientX:number;clientY:number} | null=null) => {
      if (!Number.isFinite(next) || next <= 0) return;
      const viewportRect = viewport.getBoundingClientRect();
      const anchorX = Number.isFinite(anchor?.clientX) ? anchor!.clientX : viewportRect.left + viewport.clientWidth / 2;
      const anchorY = Number.isFinite(anchor?.clientY) ? anchor!.clientY : viewportRect.top + viewport.clientHeight / 2;
      const stageRectBefore = stage.getBoundingClientRect();
      const documentX = (anchorX - stageRectBefore.left) / scale;
      const documentY = (anchorY - stageRectBefore.top) / scale;
      scale = Math.max(0.05, next);
      shell.style.width = `${Math.max(1, baseWidth * scale)}px`;
      shell.style.height = `${Math.max(1, baseHeight * scale)}px`;
      stage.style.transform = `scale(${scale})`;
      get("sftpImageZoomValue").textContent = `${Math.round(scale * 100)}%`;
      const stageRectAfter = stage.getBoundingClientRect();
      viewport.scrollLeft += stageRectAfter.left + documentX * scale - anchorX;
      viewport.scrollTop += stageRectAfter.top + documentY * scale - anchorY;
      frame(() => updateSvgMatchMarker());
    };
    const fit = () => {
      fitMode = true;
      const availableWidth = Math.max(120, viewport.clientWidth - 28);
      const availableHeight = Math.max(120, viewport.clientHeight - 28);
      const nextScale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
      suppressResizeUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 180;
      updateZoom(Math.max(0.05, nextScale));
      frame(() => {
        viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
        viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
      });
    };
    const svgElementDocumentBounds = (element: Element) => {
      if (!element?.getBoundingClientRect) return null;
      const stageRect = stage.getBoundingClientRect();
      try {
        if (element instanceof SVGGraphicsElement) {
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
      const compactNumber = (value: number) => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "?";
      matchMarker.dataset.label = `${tag}${id ? `#${id}` : ""} ${compactNumber(bounds.width)} × ${compactNumber(bounds.height)}`;
    };
    const svgDrawableTags = new Set(["g", "use", "path", "polyline", "polygon", "line", "rect", "circle", "ellipse", "text", "image"]);
    const svgGroupHasDrawable = (group: Element) => [...group.querySelectorAll("use,path,polyline,polygon,line,rect,circle,ellipse,text,image")]
      .some(node => !node.closest("defs"));
    const svgSearchTarget = (source: Element) => {
      let fallbackGroup: Element | null = null;
      let current: Element | null = source;
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
    const svgSearchSourceText = (element: Element) => {
      const attributes = [...(element?.attributes || [])]
        .map(attribute => `${attribute.name}=${attribute.value}`).join(" ");
      const directText = [...(element?.childNodes || [])]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || "").join(" ");
      return `${element?.tagName || ""} ${attributes} ${directText}`.toLowerCase();
    };
    const focusSvgMatch = (element: Element) => {
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
      frame(() => {
        const centerX = (bounds.x + bounds.width / 2) * scale;
        const centerY = (bounds.y + bounds.height / 2) * scale;
        viewport.scrollLeft = Math.max(0, centerX - viewport.clientWidth / 2 + 12);
        viewport.scrollTop = Math.max(0, centerY - viewport.clientHeight / 2 + 12);
        updateSvgMatchMarker();
      });
    };
    const updateSvgSearch = (direction = 1, options: {fitEmpty?:boolean;preferredId?:string;focus?:boolean} = {}) => {
      if (!root) return;
      const query = String(get<HTMLInputElement>("sftpSvgSearch")?.value || "").trim().toLowerCase();
      root.querySelectorAll(".sftp-svg-search-current").forEach(element => element.classList.remove("sftp-svg-search-current"));
      if (!query) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        get("sftpSvgSearchCount").textContent = "";
        matchMarker.hidden = true;
        if (options.fitEmpty !== false) fit();
        return;
      }
      if (query !== svgSearchQuery) {
        svgSearchQuery = query;
        svgMatchIndex = -1;
        const targets = new Set<Element>();
        const exactTargets = new Set<Element>();
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
        get("sftpSvgSearchCount").textContent = tr("sftp:editor.svg_search_empty", {defaultValue:"无匹配"});
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
      else frame(() => updateSvgMatchMarker());
      get("sftpSvgSearchCount").textContent = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      fitMode = false;
      updateZoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {clientX:event.clientX, clientY:event.clientY});
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.contains(event.target instanceof Node ? event.target : null) && !modal.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        return requestClose();
      }
      if (isSvg && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        get<HTMLInputElement>("sftpSvgSearch")?.focus();
        get<HTMLInputElement>("sftpSvgSearch")?.select();
      }
      if (isSvg && (event.target instanceof Element ? event.target.id : "") === "sftpSvgSearch" && event.key === "Enter") {
        event.preventDefault();
        updateSvgSearch(event.shiftKey ? -1 : 1);
      }
    };
    let panState: {pointerId:number;clientX:number;clientY:number;scrollLeft:number;scrollTop:number} | null = null;
    const onPanMove = (event: PointerEvent) => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.clientX);
      viewport.scrollTop = panState.scrollTop - (event.clientY - panState.clientY);
    };
    const stopPan = (event: PointerEvent) => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      panState = null;
      viewport.classList.remove("is-panning");
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
    };
    const startPan = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("input,button,label"))) return;
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
      if (resizeFrame) frames.cancel(resizeFrame);
      resizeFrame = frame(() => {
        resizeFrame = 0;
        if (fitMode) fit();
        else updateSvgMatchMarker();
      });
    }) : null;
    const close = () => {
      if (!active()) return;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", startPan);
      resizeObserver?.disconnect();
      release();
      disposeCurrent = null;
    };
    cleanup = close;
    disposeCurrent = close;
    frame(() => frame(fit));
    viewport.addEventListener("wheel", onWheel, {passive:false});
    viewport.addEventListener("pointerdown", startPan);
    resizeObserver?.observe(imageCard);
    document.addEventListener("keydown", onKeyDown, true);
    get("sftpImageZoomOut").onclick = () => { fitMode = false; updateZoom(scale / 1.25); };
    get("sftpImageZoomIn").onclick = () => { fitMode = false; updateZoom(scale * 1.25); };
    get("sftpImageZoomReset").onclick = fit;
    fullscreenButton.onclick = () => {
      syncFullscreen(!imageCard.classList.contains("is-fullscreen"));
      frame(() => frame(() => fitMode ? fit() : updateSvgMatchMarker()));
    };
    const openSvgEditorMode = (mode: string) => {
      if (!isSvg || !["edit", "split"].includes(mode)) return;
      // When the preview was opened from an unsaved editor, the inline content
      // is the source of truth. Do not depend on a Blob.text() round-trip here;
      // keeping the exact string also preserves edits appended after the SVG
      // root (comments, processing instructions, and editor markers).
      const hasEditorContent = Object.prototype.hasOwnProperty.call(previewOptions || {}, "content"), source = hasEditorContent ? String(previewOptions.content || "") : "";
      const preserveUnsaved = previewOptions.preserveUnsaved === true
        || (hasEditorContent && previewOptions.modified === true);
      close();
      window.setTimeout(() => {
        previewSftpText(id, path, {
          ...(hasEditorContent ? {
            initialContent:source,
            initialSize:blob.size,
            initialLimit:previewOptions.limit,
            initialEncoding:previewOptions.encoding || "utf8",
            initialPreferredEncoding:previewOptions.preferredEncoding,
            initialLineEnding:previewOptions.lineEnding,
            initialFinalNewline:previewOptions.finalNewline,
            initialNeedsFormatRepair:previewOptions.needsFormatRepair === true,
            initialModified:previewOptions.modified === true
          } : {}),
          forceNewEditor:preserveUnsaved,
          svgMode:mode
        });
      }, 0);
    };
    const requestClose = () => previewOptions.modified === true && isSvg
      ? openSvgEditorMode("edit")
      : close();
    find<HTMLSelectElement>("sftpImageViewMode")?.addEventListener("change", event => {
      const mode = String((event.currentTarget as HTMLSelectElement).value || "preview");
      if (mode === "preview") return;
      (event.currentTarget as HTMLSelectElement).value = "preview";
      openSvgEditorMode(mode);
    });
    find<HTMLInputElement>("sftpSvgSearch")?.addEventListener("input", () => { svgMatchIndex = -1; updateSvgSearch(1); });
    find("sftpSvgSearchPrevious")?.addEventListener("click", () => updateSvgSearch(-1));
    find("sftpSvgSearchNext")?.addEventListener("click", () => updateSvgSearch(1));
    find<HTMLSelectElement>("sftpImageColorMode")?.addEventListener("change", event => {
      const changeSequence = ++colorModeChangeSequence;
      const activeMatchId = svgMatches[svgMatchIndex]?.getAttribute?.("id") || "";
      const preservedView = {
        scale,
        fitMode,
        scrollLeft:viewport.scrollLeft,
        scrollTop:viewport.scrollTop,
        searchQuery:String(get<HTMLInputElement>("sftpSvgSearch")?.value || "").trim().toLowerCase()
      };
      syncSvgColorMode((event.currentTarget as HTMLSelectElement).value);
      // Rebuild search targets after replacing the SVG root for a vector color
      // transform; references to the previous DOM tree are no longer usable.
      if (isSvg) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        updateSvgSearch(1, {focus:false, fitEmpty:false, preferredId:activeMatchId});
        frame(() => frame(() => {
          if (changeSequence !== colorModeChangeSequence) return;
          const currentSearchQuery = String(get<HTMLInputElement>("sftpSvgSearch")?.value || "").trim().toLowerCase();
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
    find("sftpImageExportPdf")?.addEventListener("click", () => downloadSftpSvgAsPdf(id, path, blob, {colorMode}));
    get("sftpImageDownload").onclick = () => isSvg ? downloadSftpSvgWithColorMode(id, path, blob, colorMode) : downloadSftp(id, path);
    get("sftpImageClose").onclick = requestClose;
    get("sftpImageCloseBottom").onclick = requestClose;
    get("sftpImageClose").focus();
  } catch (error) {
    const report = active();
    cleanup?.();
    frames.dispose();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (active() && failedHost) { failedHost.hidden = true; port.release(failedHost); }
    opening?.complete();
    opening = undefined;
    if (report) port.error(error instanceof Error ? error.message : tr("sftp:editor.image_preview_failed"));
  } finally {
    opening?.complete();
  }
}


return {preview:previewSftpImage, dispose(){disposeCurrent?.();generation++;}};
}
