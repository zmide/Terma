/**
 * Layout and pointer interactions for the terminal AI panel.
 * Loaded before the controller; shared state and panel helpers resolve at call time.
 */
const TERMINAL_AI_LAYOUT_STORAGE_KEY = "termaTerminalAiLayout";

function terminalAiLayoutSettings() {
  const defaults = {mode:"fixed", width:380, height:620, left:0, top:0, minimized:false};
  try {
    const saved = JSON.parse(localStorage.getItem(TERMINAL_AI_LAYOUT_STORAGE_KEY) || "{}");
    const width = Number(saved?.width);
    const height = Number(saved?.height);
    const left = Number(saved?.left);
    const top = Number(saved?.top);
    return {
      mode:saved?.mode === "floating" ? "floating" : defaults.mode,
      width:Number.isFinite(width) ? Math.max(280, Math.min(720, Math.round(width))) : defaults.width,
      height:Number.isFinite(height) ? Math.max(260, Math.min(1200, Math.round(height))) : defaults.height,
      left:Number.isFinite(left) ? Math.round(left) : defaults.left,
      top:Number.isFinite(top) ? Math.round(top) : defaults.top,
      minimized:saved?.minimized === true
    };
  } catch { return defaults; }
}

function terminalAiClampedLayout(layout) {
  const source = {...layout};
  if (source.mode !== "floating") return source;
  const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
  const viewportHeight = Math.max(1, Number(window.innerHeight) || 1);
  const panelWidth = source.minimized ? 44 : Math.max(280, Number(source.width) || 380);
  const panelHeight = source.minimized ? 44 : Math.max(260, Number(source.height) || 620);
  if (!(Number(source.left) > 0 || Number(source.top) > 0)) return source;
  source.left = Math.round(Math.max(0, Math.min(Math.max(0, viewportWidth - panelWidth), Number(source.left) || 0)));
  source.top = Math.round(Math.max(0, Math.min(Math.max(0, viewportHeight - panelHeight), Number(source.top) || 0)));
  return source;
}

function clampTerminalAiLayoutsToViewport() {
  const current = terminalAiLayoutSettings();
  const next = terminalAiClampedLayout(current);
  if (next.left === current.left && next.top === current.top) return;
  try { localStorage.setItem(TERMINAL_AI_LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const [key] of terminalAiStates) renderTerminalAiPanel(key);
}

function updateTerminalAiLayout(key, patch={}) {
  const current = terminalAiLayoutSettings();
  const next = {...current, ...patch};
  try { localStorage.setItem(TERMINAL_AI_LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const [panelKey] of terminalAiStates) renderTerminalAiPanel(panelKey);
  if (key && !terminalAiStates.has(String(key))) renderTerminalAiPanel(key);
}

function applyTerminalAiLayout(key) {
  const panel = terminalAiElementForKey(key);
  if (!panel) return terminalAiLayoutSettings();
  const layout = terminalAiClampedLayout(terminalAiLayoutSettings());
  panel.style.setProperty("--terminal-ai-width", `${layout.width}px`);
  panel.style.setProperty("--terminal-ai-height", `${layout.height}px`);
  if (layout.mode === "floating") {
    const explicitPosition = layout.left > 0 || layout.top > 0;
    panel.style.left = explicitPosition ? `${layout.left}px` : "";
    panel.style.top = explicitPosition ? `${layout.top}px` : "";
    panel.style.right = explicitPosition ? "auto" : "16px";
    panel.style.bottom = explicitPosition ? "auto" : "16px";
  } else {
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
  }
  panel.classList.toggle("terminal-ai-layout-floating", layout.mode === "floating");
  panel.classList.toggle("terminal-ai-layout-fixed", layout.mode !== "floating");
  panel.classList.toggle("terminal-ai-fixed-bottom", layout.mode !== "floating" && terminalAiPlacement() !== "right");
  panel.classList.toggle("is-minimized", layout.minimized);
  const mode = panel.querySelector(`[data-change-action="terminal-ai-layout-mode"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (mode) mode.value = layout.mode;
  const minimize = panel.querySelector(`[data-action="terminal-ai-minimize"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (minimize) {
    minimize.innerHTML = icon(layout.minimized ? "bot" : "minus");
    minimize.title = layout.minimized ? tr("terminal:ai.restore", {defaultValue:"恢复 AI 面板"}) : tr("terminal:ai.minimize", {defaultValue:"最小化 AI 面板"});
    minimize.setAttribute("aria-label", minimize.title);
  }
  return layout;
}

let terminalAiPointerState = null;

function terminalAiBeginPointer(event, mode) {
  const panel = event.target?.closest?.(".terminal-ai-panel");
  if (!panel || panel.hidden) return;
  if (mode === "drag" && event.target?.closest?.("button,select,input,textarea,a")) return;
  const key = panel.dataset.terminalAiKey || "";
  const layout = terminalAiLayoutSettings();
  if (mode === "drag" && layout.mode !== "floating") return;
  const rect = panel.getBoundingClientRect();
  const turns = panel.querySelector(`[data-terminal-ai-turns="${CSS.escape(String(key))}"]`);
  const scrollAnchor = turns ? {
    top:Number(turns.scrollTop || 0),
    bottom:Math.max(0, Number(turns.scrollHeight || 0) - Number(turns.clientHeight || 0) - Number(turns.scrollTop || 0)),
    wasNearBottom:Math.max(0, Number(turns.scrollHeight || 0) - Number(turns.clientHeight || 0) - Number(turns.scrollTop || 0)) < 48
  } : null;
  if (mode === "floating-resize" && layout.mode === "floating") {
    layout.left = Math.max(0, Math.round(rect.left));
    layout.top = Math.max(0, Math.round(rect.top));
  }
  terminalAiPointerState = {mode, key, startX:event.clientX, startY:event.clientY, rect, layout, scrollAnchor};
  panel.classList.add("is-pointer-active");
  event.preventDefault();
  event.stopPropagation();
}

function terminalAiMovePointer(event) {
  const active = terminalAiPointerState;
  if (!active) return;
  const dx = event.clientX - active.startX;
  const dy = event.clientY - active.startY;
  if (active.mode === "drag") {
    const width = active.rect.width;
    const height = active.rect.height;
    const maxLeft = Math.max(0, window.innerWidth - width - 8);
    const maxTop = Math.max(0, window.innerHeight - height - 8);
    updateTerminalAiLayout(active.key, {
      left:Math.round(Math.max(0, Math.min(maxLeft, active.rect.left + dx))),
      top:Math.round(Math.max(0, Math.min(maxTop, active.rect.top + dy)))
    });
  } else {
    const bottomFixed = active.mode === "fixed-resize" && terminalAiPlacement() !== "right";
    const floating = active.mode === "floating-resize";
    const nextWidth = Math.max(280, Math.min(720, Math.round(active.rect.width + (floating ? dx : -dx))));
    const maxFloatingHeight = Math.max(260, Math.min(1200, Math.round(window.innerHeight - active.rect.top)));
    const nextHeight = Math.max(260, Math.min(bottomFixed ? 1200 : (floating ? maxFloatingHeight : 900), Math.round(bottomFixed ? active.rect.height - dy : active.rect.height + dy)));
    updateTerminalAiLayout(active.key, bottomFixed
      ? {height:nextHeight}
      : floating
        ? {left:active.layout.left, top:active.layout.top, width:nextWidth, height:nextHeight}
        : {width:nextWidth, height:nextHeight});
  }
  const anchored = active.scrollAnchor;
  const movedTurns = terminalAiElementForKey(active.key)?.querySelector(`[data-terminal-ai-turns="${CSS.escape(String(active.key))}"]`);
  if (movedTurns && anchored) {
    movedTurns.scrollTop = anchored.wasNearBottom
      ? movedTurns.scrollHeight
      : Math.min(anchored.top, Math.max(0, movedTurns.scrollHeight - movedTurns.clientHeight));
  }
  event.preventDefault();
}

function terminalAiEndPointer() {
  const panel = terminalAiPointerState ? terminalAiElementForKey(terminalAiPointerState.key) : null;
  panel?.classList.remove("is-pointer-active");
  terminalAiPointerState = null;
}

document.addEventListener("pointermove", terminalAiMovePointer, {passive:false});
document.addEventListener("pointerup", terminalAiEndPointer);
document.addEventListener("pointercancel", terminalAiEndPointer);
window.addEventListener("resize", clampTerminalAiLayoutsToViewport, {passive:true});
