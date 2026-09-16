function createSftpSvgSourceLocator({getText, getAceEditor, getFallbackEditor, onHighlight}) {
  const findSourceIndex = (text, targetId, {preferReference=false, sourceElement=null} = {}) => {
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
        candidates.push({index:match.index, score});
      }
      if (!/\/\s*>$/.test(raw) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(name)) stack.push(name);
    }
    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
    return candidates[0]?.index ?? -1;
  };
  const focusSourceId = (target, options={}) => {
    const targetInfo = target && typeof target === "object" ? target : {id:target};
    const targetId = String(targetInfo.id || "").trim();
    if (!targetId) return;
    const text = String(getText?.() || "");
    let index = findSourceIndex(text, targetId, {preferReference:targetInfo.nodeName === "use" || options.preferReference, sourceElement:targetInfo.sourceElement});
    if (index < 0) index = text.indexOf(targetId);
    if (index < 0) return;
    const aceEditor = getAceEditor?.();
    const fallbackEditor = getFallbackEditor?.();
    if (aceEditor) {
      const position = aceEditor.session.getDocument().indexToPosition(index, 0);
      aceEditor.selection.moveTo(position.row, position.column);
      aceEditor.scrollToLine(position.row, true, true);
      aceEditor.focus();
    } else if (fallbackEditor) {
      fallbackEditor.focus();
      fallbackEditor.setSelectionRange(index, index + targetId.length);
    }
    onHighlight?.(targetId, {locate:true, force:true});
  };
  const idForCursor = () => {
    const text = String(getText?.() || "");
    const fallbackOffset = Number(getFallbackEditor?.()?.selectionStart || 0);
    const aceEditor = getAceEditor?.();
    const row = aceEditor?.getCursorPosition?.().row ?? text.slice(0, fallbackOffset).split("\n").length - 1;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const current = String(lines[row] || "");
    const direct = current.match(/\bid\s*=\s*["']([^"']+)["']/i) || current.match(/(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/i);
    if (direct?.[1]) return direct[1];
    for (let distance = 1; distance <= 36; distance += 1) {
      for (const index of [row - distance, row + distance]) {
        if (index < 0 || index >= lines.length) continue;
        const match = String(lines[index] || "").match(/\bid\s*=\s*["']([^"']+)["']/i) || String(lines[index] || "").match(/(?:href|xlink:href)\s*=\s*["']#([^"']+)["']/i);
        if (match?.[1]) return match[1];
      }
    }
    return "";
  };
  return {focusSourceId, idForCursor};
}
