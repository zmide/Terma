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

function sanitizeSftpSvgDocument(markup) {
  const documentNode = new DOMParser().parseFromString(String(markup || ""), "image/svg+xml");
  if (documentNode.querySelector("parsererror")) throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  const root = documentNode.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  root.querySelectorAll("script,foreignObject,iframe,object,embed,video,audio").forEach(node => node.remove());
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
  return root;
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
    modal.innerHTML = `<div class="modal-card wide sftp-image-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(path.split(/[\\/]/).pop() || path)}</h2><span>${esc(formatBytes(blob.size))}</span></div><div class="sftp-image-tools"><button id="sftpImageZoomOut" class="icon-button" type="button" title="${escAttr(zoomOutLabel)}" aria-label="${escAttr(zoomOutLabel)}">${icon("minus")}</button><span id="sftpImageZoomValue" class="sftp-image-zoom-value">100%</span><button id="sftpImageZoomReset" class="icon-button" type="button" title="${escAttr(zoomResetLabel)}" aria-label="${escAttr(zoomResetLabel)}">${icon("maximize-2")}</button><button id="sftpImageZoomIn" class="icon-button" type="button" title="${escAttr(zoomInLabel)}" aria-label="${escAttr(zoomInLabel)}">${icon("plus")}</button>${isSvg ? `<div class="sftp-svg-search"><label><span class="sr-only">${esc(searchLabel)}</span><input id="sftpSvgSearch" type="search" placeholder="${escAttr(searchLabel)}" autocomplete="off"></label><span id="sftpSvgSearchCount" aria-live="polite"></span><button id="sftpSvgSearchPrevious" class="icon-button" type="button" title="${escAttr(searchPreviousLabel)}" aria-label="${escAttr(searchPreviousLabel)}">${icon("arrow-up")}</button><button id="sftpSvgSearchNext" class="icon-button" type="button" title="${escAttr(searchNextLabel)}" aria-label="${escAttr(searchNextLabel)}">${icon("arrow-down")}</button></div>` : ""}<button id="sftpImageClose" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div></div><div id="sftpImageViewport" class="sftp-image-preview"><div id="sftpImageStageShell" class="sftp-image-stage-shell"><div id="sftpImageStage" class="sftp-image-stage"></div></div></div><div class="actions"><button onclick="downloadSftp(${id},'${escAttr(path)}')">${icon("download")}<span>${esc(tr("sftp:menu.download", {defaultValue:"下载"}))}</span></button><button id="sftpImageCloseBottom">${esc(closeLabel)}</button></div></div>`;
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
    let baseWidth = 1;
    let baseHeight = 1;
    if (isSvg) {
      const sanitizedRoot = sanitizeSftpSvgDocument(await blob.text());
      const viewBox = String(sanitizedRoot.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      const viewX = Number.isFinite(viewBox[0]) ? viewBox[0] : 0;
      const viewY = Number.isFinite(viewBox[1]) ? viewBox[1] : 0;
      const viewWidth = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 1024;
      const viewHeight = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 768;
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
      previewStyle.textContent = `.sftp-svg-search-current{filter:drop-shadow(0 0 4px #ff3158) drop-shadow(0 0 8px #ffd43b)}`;
      shadow.append(previewStyle, root);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        let contentBounds = null;
        try {
          contentBounds = root.getBBox({fill:true, stroke:true, markers:true, clipped:false});
        } catch {
          contentBounds = root.getBBox();
        }
        if (contentBounds && Number.isFinite(contentBounds.width) && contentBounds.width > 0 && contentBounds.height > 0) {
          const padding = Math.max(1, Math.min(viewWidth, viewHeight) * .01);
          const minX = Math.min(viewX, contentBounds.x) - padding;
          const minY = Math.min(viewY, contentBounds.y) - padding;
          const maxX = Math.max(viewX + viewWidth, contentBounds.x + contentBounds.width) + padding;
          const maxY = Math.max(viewY + viewHeight, contentBounds.y + contentBounds.height) + padding;
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
    stage.style.width = `${baseWidth}px`;
    stage.style.height = `${baseHeight}px`;
    let scale = 1;
    let fitMode = true;
    let svgMatches = [];
    let svgMatchIndex = -1;
    let svgSearchQuery = "";
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
      const bounds = svgElementDocumentBounds(svgMatches[svgMatchIndex]);
      if (!bounds) return;
      const centerX = (bounds.x + bounds.width / 2) * scale;
      const centerY = (bounds.y + bounds.height / 2) * scale;
      const markerSize = 18;
      matchMarker.hidden = false;
      matchMarker.style.left = `${Math.max(0, centerX - markerSize / 2)}px`;
      matchMarker.style.top = `${Math.max(0, centerY - markerSize / 2)}px`;
      matchMarker.style.width = `${markerSize}px`;
      matchMarker.style.height = `${markerSize}px`;
      matchMarker.dataset.match = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const focusSvgMatch = element => {
      const bounds = svgElementDocumentBounds(element);
      if (!bounds) return;
      fitMode = false;
      const targetScale = Math.max(0.05, Math.min(6,
        (viewport.clientWidth * 0.55) / Math.max(bounds.width, 24),
        (viewport.clientHeight * 0.55) / Math.max(bounds.height, 24)
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
    const updateSvgSearch = (direction = 1) => {
      if (!root) return;
      const query = String($("sftpSvgSearch")?.value || "").trim().toLowerCase();
      root.querySelectorAll(".sftp-svg-search-current").forEach(element => element.classList.remove("sftp-svg-search-current"));
      if (!query) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        $("sftpSvgSearchCount").textContent = "";
        return;
      }
      if (query !== svgSearchQuery) {
        svgSearchQuery = query;
        svgMatchIndex = -1;
        const candidates = [root, ...root.querySelectorAll("*")];
        svgMatches = candidates.filter(element => {
          const attributes = [...element.attributes].map(attribute => `${attribute.name}=${attribute.value}`).join(" ");
          const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || "").join(" ");
          return `${element.tagName} ${attributes} ${directText}`.toLowerCase().includes(query);
        });
      }
      if (!svgMatches.length) {
        svgMatchIndex = -1;
        $("sftpSvgSearchCount").textContent = tr("sftp:editor.svg_search_empty", {defaultValue:"无匹配"});
        return;
      }
      svgMatchIndex = (svgMatchIndex + direction + svgMatches.length) % svgMatches.length;
      const current = svgMatches[svgMatchIndex];
      current.classList.add("sftp-svg-search-current");
      focusSvgMatch(current);
      $("sftpSvgSearchCount").textContent = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const onWheel = event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      fitMode = false;
      updateZoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {clientX:event.clientX, clientY:event.clientY});
    };
    const onKeyDown = event => {
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
  try {
    const editorConnection = connections.find(item => Number(item.id) === Number(id));
    let requestedEncoding = "";
    while (true) {
      const data = await withSftpFileOpenFeedback(id, path, () => readSftpTextWithProgress(id, path, requestedEncoding));
      if (!data) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (data.is_cancelled?.()) return;
      const editorPromise = sftpTextModal(path, data.content || "", data.size || 0, data.limit || 50*1024*1024, data.encoding || "utf8", data.preferred_encoding || "auto", {
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
      const connection = connections.find(item => item.id === id);
      const savedEncoding = saved?.encoding || next.encoding;
      if (connection && next.persist_default) connection.sftp_text_encoding = savedEncoding;
      if (typeof queueSftpDirectoryRefresh === "function") {
        queueSftpDirectoryRefresh(id);
        flushPendingSftpDirectoryRefresh();
      }
      notify(saved?.normalized_script || next.normalized_script
        ? tr("sftp:editor.saved_shell_script", {encoding:sftpTextEncodingLabel(savedEncoding), defaultValue:`脚本已按 ${sftpTextEncodingLabel(savedEncoding)}、Unix LF、无 BOM 保存`})
        : tr("sftp:editor.saved_with_encoding", {encoding:sftpTextEncodingLabel(savedEncoding), defaultValue:`文件已按 ${sftpTextEncodingLabel(savedEncoding)} 保存`}), "success");
      return;
    }
  } catch (error) {
    notify(error.message || tr("sftp:editor.remote_read_failed", {defaultValue:"读取文件失败"}), "error");
  }
}

