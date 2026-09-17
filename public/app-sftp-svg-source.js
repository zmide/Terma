function scrollSftpFallbackEditorToOffset(editor, text, offset) {
  if (!editor) return false;
  const source = String(text || "");
  const index = Math.max(0, Math.min(source.length, Number(offset) || 0));
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const column = Math.max(0, index - lineStart);
  const line = source.slice(0, index).split("\n").length - 1;
  const style = globalThis.getComputedStyle?.(editor);
  const fontSize = Number.parseFloat(style?.fontSize || "14") || 14;
  const lineHeight = Number.parseFloat(style?.lineHeight || "") || fontSize * 1.45;
  const approximateCharWidth = Math.max(6, fontSize * .62);
  editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight * .4);
  editor.scrollLeft = Math.max(0, Math.min(Math.max(0, editor.scrollWidth - editor.clientWidth), column * approximateCharWidth - editor.clientWidth * .42));
  return true;
}

function createSftpSvgSourceLocator({getText, getAceEditor, getFallbackEditor, onHighlight}) {
  let aceTargetMarkerId = null;
  let aceLineMarkerId = null;
  let aceGutterRow = -1;
  let fallbackHighlightActive = false;
  const getAceRange = (start, end) => {
    const Range = globalThis.ace?.require?.("ace/range")?.Range;
    if (!Range) return null;
    return new Range(start.row, start.column, end.row, end.column);
  };
  const clearAceHighlight = aceEditor => {
    const session = aceEditor?.session;
    if (!session) return;
    if (aceTargetMarkerId !== null) {
      session.removeMarker?.(aceTargetMarkerId);
      aceTargetMarkerId = null;
    }
    if (aceLineMarkerId !== null) {
      session.removeMarker?.(aceLineMarkerId);
      aceLineMarkerId = null;
    }
    if (aceGutterRow >= 0) {
      session.removeGutterDecoration?.(aceGutterRow, "sftp-svg-source-gutter");
      aceGutterRow = -1;
    }
  };
  const highlightAceRange = (aceEditor, start, end) => {
    const session = aceEditor?.session;
    const range = getAceRange(start, end);
    if (!session || !range) return;
    clearAceHighlight(aceEditor);
    aceTargetMarkerId = session.addMarker?.(range, "sftp-svg-source-target", "text", true) ?? null;
    aceLineMarkerId = session.addMarker?.(getAceRange(start, {row:start.row, column:Math.max(1, start.column + 1)}), "sftp-svg-source-line", "fullLine", false) ?? null;
    session.addGutterDecoration?.(start.row, "sftp-svg-source-gutter");
    aceGutterRow = start.row;
  };
  const findSourceRange = (text, targetId, {preferReference=false, sourceElement=null} = {}) => {
    const wanted = String(targetId || "");
    if (!wanted) return -1;
    const candidates = [];
    const sourceAttributes = {};
    for (const name of ["x", "y", "width", "height", "transform", "class", "terminal-index", "type"]) {
      const value = sourceElement?.getAttribute?.(name);
      if (value !== null && value !== undefined) sourceAttributes[name] = String(value);
    }
    const tagExpression = /<\/?([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?>/g;
    const stack = [];
    let match;
    while ((match = tagExpression.exec(text))) {
      const raw = match[0];
      const name = String(match[1] || "").toLowerCase();
      if (raw.startsWith("</")) {
        const stackIndex = stack.lastIndexOf(name);
        if (stackIndex >= 0) stack.splice(stackIndex, stack.length - stackIndex);
        continue;
      }
      const attributes = {};
      const attributeExpression = /\b([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/gi;
      let attributeMatch;
      while ((attributeMatch = attributeExpression.exec(raw))) attributes[attributeMatch[1].toLowerCase()] = attributeMatch[3];
      const inDefinition = stack.some(tag => tag === "defs" || tag === "symbol" || tag === "metadata" || tag === "desc");
      const hasId = attributes.id === wanted;
      const hasReference = attributes.href === `#${wanted}` || attributes["xlink:href"] === `#${wanted}`;
      if ((hasId || hasReference) && !["metadata", "desc", "style", "script"].includes(name)) {
        let score = hasId ? 100 : 92;
        if (name === "use" && hasReference) score += preferReference ? 18 : 8;
        if (inDefinition) score -= 70;
        if (hasReference && sourceElement) {
          for (const [attributeName, attributeValue] of Object.entries(sourceAttributes)) {
            if (attributes[attributeName] === attributeValue) score += 6;
          }
        }
        candidates.push({index:match.index, length:raw.length, score});
      }
      if (!/\/\s*>$/.test(raw) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(name)) stack.push(name);
    }
    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    return candidates[0] ? {index:candidates[0].index, length:candidates[0].length} : null;
  };
  const focusSourceId = (target, options={}) => {
    const targetInfo = target && typeof target === "object" ? target : {id:target};
    const targetId = String(targetInfo.id || "").trim();
    if (!targetId) return;
    const text = String(getText?.() || "");
    const sourceRange = findSourceRange(text, targetId, {preferReference:targetInfo.nodeName === "use" || options.preferReference, sourceElement:targetInfo.sourceElement});
    const index = sourceRange?.index ?? text.indexOf(targetId);
    if (index < 0) return false;
    const rangeLength = Math.max(targetId.length, sourceRange?.length || 0);
    const aceEditor = getAceEditor?.();
    const fallbackEditor = getFallbackEditor?.();
    if (aceEditor) {
      const document = aceEditor.session.getDocument();
      const start = document.indexToPosition(index, 0);
      const end = document.indexToPosition(index + rangeLength, 0);
      const range = getAceRange(start, end);
      // Keep the caret at the opening tag while retaining the full range
      // selection, so existing source-to-preview navigation can still read
      // the tag from the cursor position.
      if (range) aceEditor.selection.setRange(range, true);
      else aceEditor.selection.moveTo(start.row, start.column);
      aceEditor.scrollToLine(start.row, true, true);
      aceEditor.renderer?.scrollCursorIntoView?.(start, 0.45);
      highlightAceRange(aceEditor, start, end);
      aceEditor.focus();
    } else if (fallbackEditor) {
      fallbackEditor.focus();
      fallbackEditor.setSelectionRange(index, index + rangeLength);
      scrollSftpFallbackEditorToOffset(fallbackEditor, text, index);
      fallbackEditor.classList.add("sftp-source-locate-active");
      fallbackHighlightActive = true;
    }
    onHighlight?.(targetId, {locate:options.locate !== false, force:true});
    return true;
  };
  const idForCursor = () => {
    const text = String(getText?.() || "");
    const fallbackOffset = Number(getFallbackEditor?.()?.selectionStart || 0);
    const aceEditor = getAceEditor?.();
    const acePosition = aceEditor?.getCursorPosition?.();
    const cursorOffset = acePosition && aceEditor?.session?.getDocument?.()
      ? aceEditor.session.getDocument().positionToIndex(acePosition, 0)
      : fallbackOffset;
    const row = acePosition?.row ?? text.slice(0, cursorOffset).split("\n").length - 1;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const current = String(lines[row] || "");
    const lineStart = text.lastIndexOf("\n", Math.max(0, cursorOffset - 1)) + 1;
    const column = Math.max(0, cursorOffset - lineStart);
    const targetInTag = raw => raw.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1]
      || raw.match(/(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/i)?.[1]
      || "";
    const tagStart = current.lastIndexOf("<", column);
    const tagEnd = tagStart >= 0 ? current.indexOf(">", tagStart) : -1;
    if (tagStart >= 0 && tagEnd >= column) {
      const direct = targetInTag(current.slice(tagStart, tagEnd + 1));
      if (direct) return direct;
    }
    const candidates = [];
    const attributeExpression = /\bid\s*=\s*["']([^"']+)["']|(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/gi;
    let attributeMatch;
    while ((attributeMatch = attributeExpression.exec(current))) {
      candidates.push({id:attributeMatch[1] || attributeMatch[2], distance:Math.abs(attributeMatch.index - column)});
    }
    candidates.sort((left, right) => left.distance - right.distance);
    if (candidates[0]?.id) return candidates[0].id;
    for (let distance = 1; distance <= 36; distance += 1) {
      for (const index of [row - distance, row + distance]) {
        if (index < 0 || index >= lines.length) continue;
        const match = targetInTag(String(lines[index] || ""));
        if (match) return match;
      }
    }
    return "";
  };
  const clear = () => {
    const aceEditor = getAceEditor?.();
    clearAceHighlight(aceEditor);
    const fallbackEditor = getFallbackEditor?.();
    if (fallbackHighlightActive) fallbackEditor?.classList.remove("sftp-source-locate-active");
    fallbackHighlightActive = false;
  };
  return {focusSourceId, idForCursor, clear};
}

function createSftpSvgEditorScheduler({isActive, renderPreview, syncCursor}) {
  let previewTimer = 0;
  let cursorTimer = 0;
  const render = () => {
    if (!isActive?.()) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = 0;
      if (isActive?.()) renderPreview?.();
    }, 140);
  };
  const cursor = () => {
    if (!isActive?.()) return;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      cursorTimer = 0;
      if (isActive?.()) syncCursor?.();
    }, 48);
  };
  const clear = () => {
    clearTimeout(previewTimer);
    clearTimeout(cursorTimer);
    previewTimer = 0;
    cursorTimer = 0;
  };
  return {render, cursor, clear};
}

function createSftpSvgAutoFocusController({getViewport, getStage, getTarget, getToggle, getScale, setScale, updateMarker}) {
  let focusedId = "";
  let focusToken = 0;
  const clear = () => {
    focusToken += 1;
    focusedId = "";
  };
  const cancel = () => {
    clear();
    const toggle = getToggle?.();
    if (toggle) toggle.checked = false;
  };
  const focus = id => {
    const targetId = String(id || "");
    const viewport = getViewport?.();
    const stage = getStage?.();
    if (!targetId || !viewport || !stage || !getToggle?.()?.checked) return;
    const target = getTarget?.(targetId);
    if (!target) return;
    const currentToken = ++focusToken;
    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (focusedId !== targetId) {
      const desiredFactor = Math.max(.35, Math.min(6, Math.min(
        Math.max(1, viewportRect.width * .46) / Math.max(1, targetRect.width),
        Math.max(1, viewportRect.height * .46) / Math.max(1, targetRect.height)
      )));
      const currentScale = getScale?.() || 1;
      const nextScale = Math.max(.05, Math.min(8, currentScale * desiredFactor));
      focusedId = targetId;
      if (Math.abs(nextScale - currentScale) > .001) setScale?.(nextScale);
    }
    const center = () => {
      if (currentToken !== focusToken || !getToggle?.()?.checked) return;
      const nextViewport = getViewport?.();
      const nextStage = getStage?.();
      const nextTarget = getTarget?.(targetId);
      if (!nextViewport || !nextStage || !nextTarget) return;
      const nextTargetRect = nextTarget.getBoundingClientRect();
      const stageRect = nextStage.getBoundingClientRect();
      const targetX = nextTargetRect.left - stageRect.left + nextTargetRect.width / 2;
      const targetY = nextTargetRect.top - stageRect.top + nextTargetRect.height / 2;
      const maxLeft = Math.max(0, nextViewport.scrollWidth - nextViewport.clientWidth);
      const maxTop = Math.max(0, nextViewport.scrollHeight - nextViewport.clientHeight);
      nextViewport.scrollLeft = Math.max(0, Math.min(maxLeft, targetX - nextViewport.clientWidth / 2));
      nextViewport.scrollTop = Math.max(0, Math.min(maxTop, targetY - nextViewport.clientHeight / 2));
      updateMarker?.();
    };
    center();
    requestAnimationFrame(() => requestAnimationFrame(center));
  };
  return {focus, cancel, clear};
}

function setSftpSvgPreviewSize(viewport, stage, width, height) {
  if (!viewport || !stage) return;
  const gutterWidth = Math.max(0, viewport.clientWidth);
  const gutterHeight = Math.max(0, viewport.clientHeight);
  stage.style.width = `${width + gutterWidth}px`;
  stage.style.height = `${height + gutterHeight}px`;
  const root = stage.shadowRoot?.querySelector("svg");
  if (!root) return;
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.marginLeft = `${gutterWidth / 2}px`;
  root.style.marginTop = `${gutterHeight / 2}px`;
}
