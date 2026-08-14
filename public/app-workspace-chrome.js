function workspaceGlobalHeaderToolsElement() {
  return document.getElementById("workspaceGlobalHeaderTools");
}

function clampWorkspaceChromeHeight(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function storedWorkspaceChromeHeight(key, min, max, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null || stored === ""
      ? fallback
      : clampWorkspaceChromeHeight(stored, min, max, fallback);
  } catch {
    return fallback;
  }
}

function scaledWorkspaceChromeValue(height, defaultHeight, base, slope, min, max) {
  return Math.max(min, Math.min(max, base + (height - defaultHeight) * slope));
}

function scheduleWorkspaceChromeFit() {
  if (workspaceChromeFitFrame || workspaceChromeFitTimer) return;
  if (workspaceChromeResize) {
    const now = globalThis.performance?.now?.() ?? Date.now();
    const remaining = Math.max(0, 64 - (now - workspaceChromeLastFitAt));
    if (remaining > 0) {
      workspaceChromeFitTimer = setTimeout(() => {
        workspaceChromeFitTimer = 0;
        scheduleWorkspaceChromeFit();
      }, remaining);
      return;
    }
  }
  workspaceChromeFitFrame = requestAnimationFrame(() => {
    workspaceChromeFitFrame = 0;
    workspaceChromeLastFitAt = globalThis.performance?.now?.() ?? Date.now();
    if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
    for (const pane of workspaceVisiblePanes()) {
      updateWorkspaceTabScrollControls(pane.id);
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
    }
    if (typeof syncSftpListLayout === "function") {
      for (const pane of workspaceVisiblePanes()) {
        const list = workspacePaneElement(pane.id)?.querySelector("#sftpList");
        if (list) syncSftpListLayout(list);
      }
    }
  });
}

function syncWorkspaceChromeResizeAria() {
  const headerHandle = document.getElementById("workspaceHeaderResize");
  if (headerHandle) {
    headerHandle.setAttribute("aria-valuemin", String(WORKSPACE_HEADER_HEIGHT_MIN));
    headerHandle.setAttribute("aria-valuemax", String(WORKSPACE_HEADER_HEIGHT_MAX));
    headerHandle.setAttribute("aria-valuenow", String(workspaceHeaderHeight));
  }
  document.querySelectorAll(".workspace-tab-resizer").forEach(handle => {
    handle.setAttribute("aria-valuemin", String(WORKSPACE_TAB_HEIGHT_MIN));
    handle.setAttribute("aria-valuemax", String(WORKSPACE_TAB_HEIGHT_MAX));
    handle.setAttribute("aria-valuenow", String(workspaceTabHeight));
  });
}

function applyWorkspaceHeaderHeight(value, options={}) {
  workspaceHeaderHeight = clampWorkspaceChromeHeight(
    value,
    WORKSPACE_HEADER_HEIGHT_MIN,
    WORKSPACE_HEADER_HEIGHT_MAX,
    WORKSPACE_HEADER_HEIGHT_DEFAULT
  );
  const root = document.documentElement;
  if (root?.style) {
    root.style.setProperty("--workspace-header-height", `${workspaceHeaderHeight}px`);
    root.style.setProperty("--workspace-header-title-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 14, .2, 12, 18).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-subtitle-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 10, .12, 9, 13).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-control-height", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 30, .27, 27, 36).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-control-font-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 12, .1, 11, 14).toFixed(2)}px`);
    root.style.setProperty("--workspace-header-icon-size", `${scaledWorkspaceChromeValue(workspaceHeaderHeight, 42, 14, .13, 13, 17).toFixed(2)}px`);
  }
  if (options.persist) {
    try { localStorage.setItem("workspaceHeaderHeight", String(workspaceHeaderHeight)); } catch {}
  }
  syncWorkspaceChromeResizeAria();
  if (options.fit !== false) scheduleWorkspaceChromeFit();
  return workspaceHeaderHeight;
}

function applyWorkspaceTabHeight(value, options={}) {
  workspaceTabHeight = clampWorkspaceChromeHeight(
    value,
    WORKSPACE_TAB_HEIGHT_MIN,
    WORKSPACE_TAB_HEIGHT_MAX,
    WORKSPACE_TAB_HEIGHT_DEFAULT
  );
  const root = document.documentElement;
  if (root?.style) {
    root.style.setProperty("--workspace-tab-height", `${workspaceTabHeight}px`);
    root.style.setProperty("--workspace-tab-font-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 12, .18, 10.5, 15).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-dot-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 7, .1, 6, 9).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-close-size", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 18, .2, 16, 22).toFixed(2)}px`);
    root.style.setProperty("--workspace-tab-horizontal-padding", `${scaledWorkspaceChromeValue(workspaceTabHeight, 32, 8, .2, 6, 11).toFixed(2)}px`);
  }
  if (options.persist) {
    try { localStorage.setItem("workspaceTabHeight", String(workspaceTabHeight)); } catch {}
  }
  syncWorkspaceChromeResizeAria();
  if (options.fit !== false) scheduleWorkspaceChromeFit();
  return workspaceTabHeight;
}

function workspaceChromeResizeValue(kind) {
  return kind === "header" ? workspaceHeaderHeight : workspaceTabHeight;
}

function applyWorkspaceChromeResizeValue(kind, value, options={}) {
  return kind === "header"
    ? applyWorkspaceHeaderHeight(value, options)
    : applyWorkspaceTabHeight(value, options);
}

function workspaceChromeResizeDefault(kind) {
  return kind === "header" ? WORKSPACE_HEADER_HEIGHT_DEFAULT : WORKSPACE_TAB_HEIGHT_DEFAULT;
}

function beginWorkspaceChromeResize(event, kind) {
  if (event.button !== 0 || isMobileLayout()) return;
  if (workspaceChromeResize) endWorkspaceChromeResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  workspaceChromeResize = {
    kind,
    pointerId:event.pointerId,
    startY:event.clientY,
    startValue:workspaceChromeResizeValue(kind),
    handle:event.currentTarget
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("workspace-chrome-resizing", kind === "header" ? "workspace-header-resizing" : "workspace-tab-resizing");
  window.addEventListener("pointermove", moveWorkspaceChromeResize, {passive:false});
  window.addEventListener("pointerup", endWorkspaceChromeResize);
  window.addEventListener("pointercancel", cancelWorkspaceChromeResize);
  window.addEventListener("blur", finishWorkspaceChromeResizeOnBlur);
}

function moveWorkspaceChromeResize(event) {
  const drag = workspaceChromeResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applyWorkspaceChromeResizeValue(drag.kind, drag.startValue + event.clientY - drag.startY);
}

function cancelWorkspaceChromeResize(event) {
  endWorkspaceChromeResize(event, true);
}

function finishWorkspaceChromeResizeOnBlur() {
  endWorkspaceChromeResize(null);
}

function finishWorkspaceChromeResizeOnLostCapture(event) {
  endWorkspaceChromeResize(event);
}

function endWorkspaceChromeResize(event, cancelled=false) {
  const drag = workspaceChromeResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveWorkspaceChromeResize);
  window.removeEventListener("pointerup", endWorkspaceChromeResize);
  window.removeEventListener("pointercancel", cancelWorkspaceChromeResize);
  window.removeEventListener("blur", finishWorkspaceChromeResizeOnBlur);
  workspaceChromeResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("workspace-chrome-resizing", "workspace-header-resizing", "workspace-tab-resizing");
  if (workspaceChromeFitTimer) {
    clearTimeout(workspaceChromeFitTimer);
    workspaceChromeFitTimer = 0;
  }
  applyWorkspaceChromeResizeValue(drag.kind, cancelled ? drag.startValue : workspaceChromeResizeValue(drag.kind), {
    persist:!cancelled
  });
}

function resetWorkspaceChromeSize(event, kind) {
  if (isMobileLayout()) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  applyWorkspaceChromeResizeValue(kind, workspaceChromeResizeDefault(kind), {persist:true});
}

function handleWorkspaceChromeResizeKey(event, kind) {
  if (isMobileLayout()) return;
  const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!direction && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const rangeValue = event.key === "Home"
    ? (kind === "header" ? WORKSPACE_HEADER_HEIGHT_MIN : WORKSPACE_TAB_HEIGHT_MIN)
    : event.key === "End"
      ? (kind === "header" ? WORKSPACE_HEADER_HEIGHT_MAX : WORKSPACE_TAB_HEIGHT_MAX)
      : workspaceChromeResizeValue(kind) + direction * (event.shiftKey ? 4 : 1);
  applyWorkspaceChromeResizeValue(kind, rangeValue, {persist:true});
}

function bindWorkspaceChromeResizeHandle(handle, kind) {
  if (!handle || handle.dataset.workspaceResizeBound === "1") return;
  handle.dataset.workspaceResizeBound = "1";
  handle.setAttribute("aria-valuemin", String(kind === "header" ? WORKSPACE_HEADER_HEIGHT_MIN : WORKSPACE_TAB_HEIGHT_MIN));
  handle.setAttribute("aria-valuemax", String(kind === "header" ? WORKSPACE_HEADER_HEIGHT_MAX : WORKSPACE_TAB_HEIGHT_MAX));
  handle.setAttribute("aria-valuenow", String(workspaceChromeResizeValue(kind)));
  handle.addEventListener("pointerdown", event => beginWorkspaceChromeResize(event, kind));
  handle.addEventListener("lostpointercapture", finishWorkspaceChromeResizeOnLostCapture);
  handle.addEventListener("dblclick", event => resetWorkspaceChromeSize(event, kind));
  handle.addEventListener("keydown", event => handleWorkspaceChromeResizeKey(event, kind));
}

function initWorkspaceChromeSizing() {
  workspaceHeaderHeight = storedWorkspaceChromeHeight(
    "workspaceHeaderHeight",
    WORKSPACE_HEADER_HEIGHT_MIN,
    WORKSPACE_HEADER_HEIGHT_MAX,
    WORKSPACE_HEADER_HEIGHT_DEFAULT
  );
  workspaceTabHeight = storedWorkspaceChromeHeight(
    "workspaceTabHeight",
    WORKSPACE_TAB_HEIGHT_MIN,
    WORKSPACE_TAB_HEIGHT_MAX,
    WORKSPACE_TAB_HEIGHT_DEFAULT
  );
  applyWorkspaceHeaderHeight(workspaceHeaderHeight, {fit:false});
  applyWorkspaceTabHeight(workspaceTabHeight, {fit:false});
  bindWorkspaceChromeResizeHandle(document.getElementById("workspaceHeaderResize"), "header");
  document.querySelectorAll(".workspace-tab-resizer").forEach(handle => bindWorkspaceChromeResizeHandle(handle, "tabs"));
  syncWorkspaceChromeResizeAria();
}
