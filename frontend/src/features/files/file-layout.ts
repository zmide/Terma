import {filesServices} from '@/features/files/installed-services';
import {isMobileLayout} from '@/shared/browser-ui';
export interface FileLayoutPort { mobile(): boolean }
export interface EditorLayout { width: number; height: number; split: number; svgSplit: number }

export function formatSftpTime(value: number) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false});
}

export function createTaskCenterLayout(port: FileLayoutPort) {
const isMobileLayout=port.mobile;
const SFTP_TASK_CENTER_MIN_WIDTH = 340;
const SFTP_TASK_CENTER_MIN_HEIGHT = 240;
const SFTP_TASK_CENTER_VIEWPORT_GAP = 12;
const SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1";
let sftpTaskCenterResize: { drawer: HTMLElement; handle: Element | null; pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number } | null = null;
let sftpTaskCenterBoundsObserver: ResizeObserver | null = null;
let sftpTaskCenterBoundsFrame = 0;
let sftpTaskCenterWindowResizeBound = false;

function savedSftpTaskCenterSize() {
  try {
    const saved = JSON.parse(localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY) || "null");
    const width = Number(saved?.width);
    const height = Number(saved?.height);
    return Number.isFinite(width) && Number.isFinite(height) ? {width, height} : null;
  } catch {
    return null;
  }
}

function persistSftpTaskCenterSize(drawer: HTMLElement | null) {
  if (!drawer || isMobileLayout()) return;
  const rect = drawer.getBoundingClientRect();
  try {
    localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY, JSON.stringify({
      width:Math.round(rect.width),
      height:Math.round(rect.height)
    }));
  } catch {}
}

function clearSftpTaskCenterSizeConstraints(drawer: HTMLElement | null) {
  drawer?.style.removeProperty("min-width");
  drawer?.style.removeProperty("min-height");
  drawer?.style.removeProperty("max-width");
  drawer?.style.removeProperty("max-height");
}

function restoreSftpTaskCenterSize(drawer: HTMLElement | null) {
  if (!drawer) return false;
  if (isMobileLayout()) {
    drawer.style.removeProperty("width");
    drawer.style.removeProperty("height");
    clearSftpTaskCenterSizeConstraints(drawer);
    return false;
  }
  const saved = savedSftpTaskCenterSize();
  if (!saved) {
    clampSftpTaskCenterSize(drawer, false);
    return false;
  }
  const applied = applySftpTaskCenterSize(drawer, saved.width, saved.height);
  if (Math.abs(applied.width - saved.width) > 1 || Math.abs(applied.height - saved.height) > 1) {
    persistSftpTaskCenterSize(drawer);
  }
  return true;
}

function sftpTaskCenterResizeBounds(drawer: HTMLElement) {
  const rect = drawer.getBoundingClientRect();
  const contentRect = drawer.closest(".content")?.getBoundingClientRect();
  const viewportRight = Math.max(1, Number(window.innerWidth || document.documentElement.clientWidth || 1));
  const viewportBottom = Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 1));
  const clipLeft = Math.max(0, Number(contentRect?.left || 0));
  const clipRight = Math.min(viewportRight, Number(contentRect?.right || viewportRight));
  const clipBottom = Math.min(viewportBottom, Number(contentRect?.bottom || viewportBottom));
  const usableLeft = Math.min(clipRight, clipLeft + SFTP_TASK_CENTER_VIEWPORT_GAP);
  const usableRight = Math.max(usableLeft, Math.min(rect.right, clipRight - SFTP_TASK_CENTER_VIEWPORT_GAP));
  const usableBottom = Math.max(rect.top, clipBottom - SFTP_TASK_CENTER_VIEWPORT_GAP);
  const maxWidth = Math.max(1, usableRight - usableLeft);
  const maxHeight = Math.max(1, usableBottom - rect.top);
  return {
    minWidth:Math.min(SFTP_TASK_CENTER_MIN_WIDTH, maxWidth),
    minHeight:Math.min(SFTP_TASK_CENTER_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight
  };
}

function applySftpTaskCenterSize(drawer: HTMLElement, width: number, height: number) {
  const bounds = sftpTaskCenterResizeBounds(drawer);
  const requestedWidth = Number(width);
  const requestedHeight = Number(height);
  const nextWidth = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, Number.isFinite(requestedWidth) ? requestedWidth : bounds.minWidth));
  const nextHeight = Math.max(bounds.minHeight, Math.min(bounds.maxHeight, Number.isFinite(requestedHeight) ? requestedHeight : bounds.minHeight));
  drawer.style.minWidth = `${Math.round(bounds.minWidth)}px`;
  drawer.style.minHeight = `${Math.round(bounds.minHeight)}px`;
  drawer.style.maxWidth = `${Math.round(bounds.maxWidth)}px`;
  drawer.style.maxHeight = `${Math.round(bounds.maxHeight)}px`;
  drawer.style.width = `${Math.round(nextWidth)}px`;
  drawer.style.height = `${Math.round(nextHeight)}px`;
  return {width:Math.round(nextWidth), height:Math.round(nextHeight), bounds};
}

function clampSftpTaskCenterSize(drawer: HTMLElement | null, persist=true) {
  if (!drawer || drawer.hidden) return false;
  if (isMobileLayout()) {
    restoreSftpTaskCenterSize(drawer);
    return false;
  }
  const before = drawer.getBoundingClientRect();
  const applied = applySftpTaskCenterSize(drawer, before.width, before.height);
  const changed = Math.abs(applied.width - before.width) > 1 || Math.abs(applied.height - before.height) > 1;
  if (changed && persist) persistSftpTaskCenterSize(drawer);
  return changed;
}

function scheduleSftpTaskCenterBoundsCheck() {
  if (sftpTaskCenterBoundsFrame) return;
  sftpTaskCenterBoundsFrame = requestAnimationFrame(() => {
    sftpTaskCenterBoundsFrame = 0;
    const drawer = document.getElementById("sftpTaskCenterDrawer");
    if (drawer && !drawer.hidden) clampSftpTaskCenterSize(drawer);
  });
}

function ensureSftpTaskCenterBoundsMonitoring(drawer: HTMLElement | null) {
  if (!drawer) return;
  if (!sftpTaskCenterBoundsObserver && typeof ResizeObserver === "function") {
    sftpTaskCenterBoundsObserver = new ResizeObserver(scheduleSftpTaskCenterBoundsCheck);
    const content = drawer.closest(".content");
    const topbar = drawer.closest(".topbar");
    if (content) sftpTaskCenterBoundsObserver.observe(content);
    if (topbar) sftpTaskCenterBoundsObserver.observe(topbar);
  }
  if (!sftpTaskCenterWindowResizeBound) {
    sftpTaskCenterWindowResizeBound = true;
    window.addEventListener("resize", scheduleSftpTaskCenterBoundsCheck, {passive:true});
  }
}

function startSftpTaskCenterResize(event: PointerEvent, handle: Element | null = event.currentTarget instanceof Element ? event.currentTarget : null) {
  if (event.button !== 0 || isMobileLayout()) return;
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (!drawer || drawer.hidden) return;
  if (sftpTaskCenterResize) finishSftpTaskCenterResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  const rect = drawer.getBoundingClientRect();
  sftpTaskCenterResize = {
    drawer,
    handle,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    startWidth:rect.width,
    startHeight:rect.height
  };
  try { handle?.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("sftp-task-center-resizing");
  window.addEventListener("pointermove", moveSftpTaskCenterResize, {passive:false});
  window.addEventListener("pointerup", finishSftpTaskCenterResize);
  window.addEventListener("pointercancel", cancelSftpTaskCenterResize);
  window.addEventListener("blur", finishSftpTaskCenterResizeOnBlur);
}

function moveSftpTaskCenterResize(event: PointerEvent) {
  const drag = sftpTaskCenterResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applySftpTaskCenterSize(
    drag.drawer,
    drag.startWidth - (event.clientX - drag.startX),
    drag.startHeight + (event.clientY - drag.startY)
  );
}

function cancelSftpTaskCenterResize(event: PointerEvent) {
  finishSftpTaskCenterResize(event, true);
}

function finishSftpTaskCenterResizeOnBlur() {
  finishSftpTaskCenterResize(null);
}

function finishSftpTaskCenterResize(event: PointerEvent | null, cancelled=false) {
  const drag = sftpTaskCenterResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveSftpTaskCenterResize);
  window.removeEventListener("pointerup", finishSftpTaskCenterResize);
  window.removeEventListener("pointercancel", cancelSftpTaskCenterResize);
  window.removeEventListener("blur", finishSftpTaskCenterResizeOnBlur);
  sftpTaskCenterResize = null;
  try {
    if (drag.handle?.hasPointerCapture?.(drag.pointerId)) drag.handle?.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("sftp-task-center-resizing");
  if (cancelled) applySftpTaskCenterSize(drag.drawer, drag.startWidth, drag.startHeight);
  else persistSftpTaskCenterSize(drag.drawer);
}

function resetSftpTaskCenterSize(event?: Event) {
  if (isMobileLayout()) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  clearSftpTaskCenterSizeConstraints(drawer);
  drawer?.style.removeProperty("width");
  drawer?.style.removeProperty("height");
  if (drawer && !drawer.hidden) clampSftpTaskCenterSize(drawer, false);
  try { localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY); } catch {}
}

function handleSftpTaskCenterResizeKey(event: KeyboardEvent) {
  if (isMobileLayout()) return;
  if (event.key === "Home") return resetSftpTaskCenterSize(event);
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const drawer = document.getElementById("sftpTaskCenterDrawer");
  if (!drawer) return;
  const rect = drawer.getBoundingClientRect();
  const step = event.shiftKey ? 32 : 16;
  const width = rect.width + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0);
  const height = rect.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
  applySftpTaskCenterSize(drawer, width, height);
  persistSftpTaskCenterSize(drawer);
}

return {savedSftpTaskCenterSize,persistSftpTaskCenterSize,clearSftpTaskCenterSizeConstraints,restoreSftpTaskCenterSize,sftpTaskCenterResizeBounds,applySftpTaskCenterSize,clampSftpTaskCenterSize,scheduleSftpTaskCenterBoundsCheck,ensureSftpTaskCenterBoundsMonitoring,startSftpTaskCenterResize,moveSftpTaskCenterResize,cancelSftpTaskCenterResize,finishSftpTaskCenterResizeOnBlur,finishSftpTaskCenterResize,resetSftpTaskCenterSize,handleSftpTaskCenterResizeKey};
}
export function createEditorLayout(port: FileLayoutPort) {
const isMobileLayout=port.mobile;
const SFTP_EDITOR_LAYOUT_STORAGE_KEY = "termaSftpEditorLayoutV1";

function readSftpEditorLayout() {
  let value: Partial<EditorLayout> = {};
  try { value = JSON.parse(localStorage.getItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY) || "{}"); } catch {}
  return {
    width:Math.max(760, Math.min(1600, Number(value.width) || 1180)),
    height:Math.max(560, Math.min(1100, Number(value.height) || 820)),
    split:Math.max(28, Math.min(76, Number(value.split) || 58)),
    svgSplit:Math.max(24, Math.min(76, Number(value.svgSplit) || 50))
  };
}

function writeSftpEditorLayout(value: Partial<EditorLayout>) {
  const current = readSftpEditorLayout();
  const supplied = {...current, ...value};
  const next = {
    width:Math.max(760, Math.min(1600, Number(supplied.width) || current.width)),
    height:Math.max(560, Math.min(1100, Number(supplied.height) || current.height)),
    split:Math.max(28, Math.min(76, Number(supplied.split) || current.split)),
    svgSplit:Math.max(24, Math.min(76, Number(supplied.svgSplit) || current.svgSplit))
  };
  localStorage.setItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function bindSftpSvgEditorLayout(workspace: HTMLElement | null, splitter: HTMLElement | null, onResize=()=>{}) {
  if (!workspace || !splitter) return () => {};
  const layout = readSftpEditorLayout();
  workspace.style.setProperty("--sftp-svg-preview-split", `${layout.svgSplit}%`);
  let resizing: {handle: HTMLElement; pointerId: number} | null = null;
  const updateSplit = (event: PointerEvent) => {
    if (!resizing) return;
    const rect = workspace.getBoundingClientRect();
    const compact = rect.width <= 760;
    const span = compact ? rect.height : rect.width;
    const start = compact ? rect.top : rect.left;
    const position = compact ? event.clientY : event.clientX;
    const split = Math.max(24, Math.min(76, ((position - start) / Math.max(1, span)) * 100));
    workspace.style.setProperty("--sftp-svg-preview-split", `${split}%`);
    workspace.dataset.svgSplit = String(split);
    onResize();
  };
  const finishResize = () => {
    if (!resizing) return;
    const handle = resizing.handle;
    const pointerId = resizing.pointerId;
    resizing = null;
    document.body.classList.remove("sftp-editor-svg-split-resizing");
    document.removeEventListener("pointermove", updateSplit);
    document.removeEventListener("pointerup", finishResize);
    document.removeEventListener("pointercancel", finishResize);
    writeSftpEditorLayout({svgSplit:Number(workspace.dataset.svgSplit) || layout.svgSplit});
    try { handle?.releasePointerCapture?.(pointerId); } catch {}
  };
  const startResize = (event: PointerEvent) => {
    if (event.button !== 0 || !workspace.classList.contains("showing-svg-preview")) return;
    event.preventDefault();
    resizing = {handle:splitter, pointerId:event.pointerId};
    document.body.classList.add("sftp-editor-svg-split-resizing");
    try { splitter.setPointerCapture?.(event.pointerId); } catch {}
    document.addEventListener("pointermove", updateSplit);
    document.addEventListener("pointerup", finishResize);
    document.addEventListener("pointercancel", finishResize);
  };
  splitter.addEventListener("pointerdown", startResize);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!workspace.classList.contains("showing-svg-preview")) return;
    if (![`ArrowLeft`,`ArrowRight`,`ArrowUp`,`ArrowDown`].includes(event.key)) return;
    event.preventDefault();
    const compact = workspace.getBoundingClientRect().width <= 760;
    const direction = compact ? (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0) : (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
    if (!direction) return;
    const next = Math.max(24, Math.min(76, Number(workspace.dataset.svgSplit || layout.svgSplit) + direction * 2));
    workspace.dataset.svgSplit = String(next);
    workspace.style.setProperty("--sftp-svg-preview-split", `${next}%`);
    writeSftpEditorLayout({svgSplit:next});
    onResize();
  };
  splitter.addEventListener("keydown", onKeyDown);
  return () => {
    if (resizing) finishResize();
    splitter.removeEventListener("pointerdown", startResize);
    splitter.removeEventListener("keydown", onKeyDown);
  };
}

function applySftpEditorLayout(card: HTMLElement | null, workspace: HTMLElement | null) {
  const layout = readSftpEditorLayout();
  workspace?.style.setProperty("--sftp-editor-split", `${layout.split}%`);
  if (!card || isMobileLayout()) return layout;
  card.style.width = `${Math.min(layout.width, window.innerWidth - 32)}px`;
  card.style.height = `${Math.min(layout.height, window.innerHeight - 32)}px`;
  return layout;
}

function bindSftpEditorLayout(card: HTMLElement, workspace: HTMLElement, splitter: HTMLElement | null, onResize=()=>{}) {
  applySftpEditorLayout(card, workspace);
  let saveTimer = 0;
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    onResize();
    if (isMobileLayout()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeSftpEditorLayout({width:card.offsetWidth, height:card.offsetHeight}), 120);
  }) : null;
  observer?.observe(card);
  splitter?.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !workspace.classList.contains("showing-diff")) return;
    event.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const handle = splitter;
    document.body.classList.add("sftp-editor-split-resizing");
    try { handle.setPointerCapture?.(event.pointerId); } catch {}
    const move = (moveEvent: PointerEvent) => {
      const split = Math.max(28, Math.min(76, ((moveEvent.clientY - rect.top) / Math.max(1, rect.height)) * 100));
      workspace.style.setProperty("--sftp-editor-split", `${split}%`);
      workspace.dataset.split = String(split);
      onResize();
    };
    const finish = () => {
      document.body.classList.remove("sftp-editor-split-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      writeSftpEditorLayout({split:Number(workspace.dataset.split) || readSftpEditorLayout().split});
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
  return () => {
    clearTimeout(saveTimer);
    observer?.disconnect();
  };
}

function setSftpEditorDiffVisible(workspace: HTMLElement | null, splitter: HTMLElement | null, preview: HTMLElement | null, visible: boolean) {
  workspace?.classList.toggle("showing-diff", Boolean(visible));
  if (splitter) splitter.hidden = !visible;
  if (preview) preview.hidden = !visible;
}


return {readSftpEditorLayout,writeSftpEditorLayout,bindSftpSvgEditorLayout,applySftpEditorLayout,bindSftpEditorLayout,setSftpEditorDiffVisible};
}
let taskCenterOwner: ReturnType<typeof createTaskCenterLayout> | undefined;
export function installFileLayouts(){
  taskCenterOwner ||= createTaskCenterLayout({mobile:()=>isMobileLayout?.() ?? false});
  filesServices.termaFileLayouts={createTaskCenter:createTaskCenterLayout,createEditor:createEditorLayout,taskCenter:taskCenterOwner};
}


export interface InstalledFeaturesFilesFileLayoutServices {
  termaFileLayouts: {createTaskCenter:typeof createTaskCenterLayout;createEditor:typeof createEditorLayout;taskCenter:ReturnType<typeof createTaskCenterLayout>}
}
