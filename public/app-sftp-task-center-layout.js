const SFTP_TASK_CENTER_MIN_WIDTH = 340;
const SFTP_TASK_CENTER_MIN_HEIGHT = 240;
const SFTP_TASK_CENTER_VIEWPORT_GAP = 12;
const SFTP_TASK_CENTER_SIZE_STORAGE_KEY = "sftpTaskCenterSizeV1";
let sftpTaskCenterResize = null;
let sftpTaskCenterBoundsObserver = null;
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

function persistSftpTaskCenterSize(drawer) {
  if (!drawer || isMobileLayout()) return;
  const rect = drawer.getBoundingClientRect();
  try {
    localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY, JSON.stringify({
      width:Math.round(rect.width),
      height:Math.round(rect.height)
    }));
  } catch {}
}

function clearSftpTaskCenterSizeConstraints(drawer) {
  drawer?.style.removeProperty("min-width");
  drawer?.style.removeProperty("min-height");
  drawer?.style.removeProperty("max-width");
  drawer?.style.removeProperty("max-height");
}

function restoreSftpTaskCenterSize(drawer) {
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

function sftpTaskCenterResizeBounds(drawer) {
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

function applySftpTaskCenterSize(drawer, width, height) {
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

function clampSftpTaskCenterSize(drawer, persist=true) {
  if (!drawer || drawer.hidden || isMobileLayout()) return false;
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

function ensureSftpTaskCenterBoundsMonitoring(drawer) {
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

function startSftpTaskCenterResize(event, handle=event.currentTarget) {
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

function moveSftpTaskCenterResize(event) {
  const drag = sftpTaskCenterResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applySftpTaskCenterSize(
    drag.drawer,
    drag.startWidth - (event.clientX - drag.startX),
    drag.startHeight + (event.clientY - drag.startY)
  );
}

function cancelSftpTaskCenterResize(event) {
  finishSftpTaskCenterResize(event, true);
}

function finishSftpTaskCenterResizeOnBlur() {
  finishSftpTaskCenterResize(null);
}

function finishSftpTaskCenterResize(event, cancelled=false) {
  const drag = sftpTaskCenterResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveSftpTaskCenterResize);
  window.removeEventListener("pointerup", finishSftpTaskCenterResize);
  window.removeEventListener("pointercancel", cancelSftpTaskCenterResize);
  window.removeEventListener("blur", finishSftpTaskCenterResizeOnBlur);
  sftpTaskCenterResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("sftp-task-center-resizing");
  if (cancelled) applySftpTaskCenterSize(drag.drawer, drag.startWidth, drag.startHeight);
  else persistSftpTaskCenterSize(drag.drawer);
}

function resetSftpTaskCenterSize(event) {
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

function handleSftpTaskCenterResizeKey(event) {
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
