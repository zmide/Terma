function clearSftpNativeDragPointer(options={}) {
  if (!sftpNativeDragPointer) return;
  const pointer = sftpNativeDragPointer;
  clearTimeout(sftpNativeDragPointer.timer);
  document.removeEventListener("pointermove", handleSftpNativeDragPointerMove, true);
  document.removeEventListener("pointerup", handleSftpNativeDragPointerUp, true);
  document.removeEventListener("pointercancel", handleSftpNativeDragPointerCancel, true);
  if (pointer.row) {
    if (pointer.originalDraggable === null) pointer.row.removeAttribute("draggable");
    else if (pointer.originalDraggable !== undefined) pointer.row.setAttribute("draggable", pointer.originalDraggable);
  }
  sftpNativeDragPointer = null;
  if (options?.cancel !== false && pointer.nativeRequestId && !pointer.nativeStarted) {
    const request = sftpNativeDragRequests.get(pointer.nativeRequestId);
    if (request) {
      request.released = true;
      request.cancelled = true;
      sftpNativeDragRequests.delete(pointer.nativeRequestId);
    }
    window.termaDesktop?.cancelSftpDrag?.(pointer.nativeRequestId);
    clearSftpDragVisuals(pointer.row);
  }
}

function handleSftpNativeDragPointerUp(event) {
  const pointer = sftpNativeDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  // `ready` only means the native provider is armed. Until `started` arrives,
  // the OLE/AppKit drag loop has not taken ownership of the pointer, so a real
  // pointerup must cancel the pending gesture and restore the row immediately.
  if (pointer.activated && pointer.nativeStarted) return;
  clearSftpNativeDragPointer();
}

function handleSftpNativeDragPointerCancel(event) {
  const pointer = sftpNativeDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  // Windows transfers pointer capture to the OLE drag window. Chromium emits
  // pointercancel for that handoff even though the physical gesture continues.
  if (pointer.activated && pointer.nativeRequestId) return;
  clearSftpNativeDragPointer();
}

function activateSftpNativeDragPointer(pointer) {
  if (!pointer?.nativeRequestId || pointer.activated) return;
  pointer.activated = true;
  pointer.entries = selectSftpDragSource(pointer.path, pointer.name, pointer.type, pointer.sourceTabKey);
  const request = sftpNativeDragRequests.get(pointer.nativeRequestId);
  if (request) request.activated = true;
  pointer.row?.classList.remove("is-preparing-drag");
  pointer.row?.classList.add("is-dragging");
  document.body.classList.add("sftp-item-drag-active");
  showSftpDragHint(sftpDragSourceHint(), false, "", pointer.sourceTabKey);
  showSftpDragPreview(pointer.entries, pointer.lastX ?? pointer.startX, pointer.lastY ?? pointer.startY);
  window.termaDesktop?.activateSftpDrag?.(pointer.nativeRequestId);
}

function handleSftpNativeDragPointerMove(event) {
  const pointer = sftpNativeDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId || pointer.activated) return;
  pointer.lastX = Number(event.clientX);
  pointer.lastY = Number(event.clientY);
  const buttons = Number(event.buttons);
  if (Number.isFinite(buttons) && (buttons & 1) === 0) return clearSftpNativeDragPointer();
  const distance = Math.hypot(Number(event.clientX) - pointer.startX, Number(event.clientY) - pointer.startY);
  if (distance < 5) return;
  document.removeEventListener("pointermove", handleSftpNativeDragPointerMove, true);
  activateSftpNativeDragPointer(pointer);
}

function primeSftpNativeDrag(event, connectionId, path, name, type, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  const mode = sftpExternalDragMode();
  if (isMobileLayout() || event.button !== 0) return;
  if (event.target?.closest(".sftp-check,.sftp-row-actions")) return;
  clearSftpNativeDragPointer();
  const entries = sftpDragEntriesForPath(path, name, type, tabKey);
  const row = event.currentTarget;
  const pointer = {
    pointerId:event.pointerId,
    startX:Number(event.clientX),
    startY:Number(event.clientY),
    row,
    sourceTabKey:String(tabKey || ""),
    connectionId:Number(connectionId),
    path:String(path || ""),
    name:String(name || ""),
    type:String(type || "file"),
    entries,
    originalDraggable:row?.getAttribute?.("draggable") ?? null,
    timer:null,
    nativeRequestId:"",
    nativeReady:false,
    nativeStarted:false,
    activated:false
  };
  if (mode === "streaming" && sftpNativeDragStartTiming() === "pointerdown") {
    row?.setAttribute?.("draggable", "false");
    sftpNativeDragPointer = pointer;
    document.addEventListener("pointermove", handleSftpNativeDragPointerMove, true);
    document.addEventListener("pointerup", handleSftpNativeDragPointerUp, true);
    document.addEventListener("pointercancel", handleSftpNativeDragPointerCancel, true);
    pointer.nativeRequestId = startSftpNativeDrag(
      row,
      pointer.connectionId,
      entries,
      null,
      "streaming",
      {armed:true, sourceTabKey:tabKey}
    ) || "";
    if (!pointer.nativeRequestId) clearSftpNativeDragPointer({cancel:false});
    return;
  }
  if (mode !== "staged") return;
  pointer.timer = setTimeout(() => {
    if (sftpNativeDragPointer !== pointer) return;
    row?.classList.add("is-preparing-drag");
    void stageSftpNativeDrag(connectionId, entries)
      .catch(error => notify(error.message || "准备拖出文件失败", "error"))
      .finally(() => row?.classList.remove("is-preparing-drag"));
  }, 180);
  sftpNativeDragPointer = pointer;
  document.addEventListener("pointerup", handleSftpNativeDragPointerUp, true);
  document.addEventListener("pointercancel", handleSftpNativeDragPointerCancel, true);
}

function showSftpDragHint(message, target=false, action="", tabKey=activeTabKey) {
  let hint = $("sftpDragHint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "sftpDragHint";
    hint.className = "sftp-drag-hint";
    hint.setAttribute("aria-live", "polite");
    document.body.appendChild(hint);
  }
  hint.classList.toggle("is-target", Boolean(target));
  const iconName = action === "upload" ? "upload-cloud" : target ? "copy" : "move";
  const signature = `${iconName}\0${String(message || "")}`;
  if (hint.dataset.content !== signature) {
    hint.dataset.content = signature;
    hint.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  }
  const key = String(tabKey || "");
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const paneElement = pane && typeof workspacePaneElement === "function" ? workspacePaneElement(pane.id) : null;
  const focusedPane = typeof workspacePaneElement === "function" && typeof focusedPaneId !== "undefined"
    ? workspacePaneElement(focusedPaneId)
    : null;
  const visibleHost = sftpElement("sftpList", key)
    || paneElement?.querySelector("#view-sftp:not([hidden]) #sftpList")
    || focusedPane?.querySelector("#view-sftp:not([hidden]) #sftpList")
    || document.querySelector(".workspace-pane.is-focused #view-sftp:not([hidden]) #sftpList")
    || document.querySelector("#view-sftp:not([hidden]) #sftpList");
  const rect = visibleHost?.getBoundingClientRect?.();
  const viewportWidth = Math.max(0, Number(window.innerWidth || document.documentElement?.clientWidth || 0));
  const visibleLeft = Math.max(0, Number(rect?.left));
  const visibleRight = Math.min(viewportWidth, Number(rect?.right));
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  if (visibleWidth > 0) {
    const safeInset = Math.min(16, Math.max(4, visibleWidth / 8));
    hint.style.left = `${visibleLeft + visibleWidth / 2}px`;
    hint.style.maxWidth = `${Math.max(1, Math.min(520, visibleWidth - safeInset * 2))}px`;
    hint.dataset.positionTabKey = key;
  } else if (!hint.style.left) {
    // Tab switches can briefly replace the SFTP view between native motion
    // events. Preserve the last valid list-relative position during that gap.
    hint.style.left = "50%";
    hint.style.maxWidth = "min(520px,calc(100vw - 32px))";
  }
}

function showSftpDragPreview(entries, clientX, clientY) {
  const items = Array.isArray(entries) ? entries : [];
  if (!items.length) return;
  let preview = $("sftpDragPreview");
  if (!preview) {
    preview = document.createElement("div");
    preview.id = "sftpDragPreview";
    preview.className = "sftp-drag-preview";
    document.body.appendChild(preview);
  }
  const first = items[0] || {};
  const isDirectory = first.type === "dir" || first.type === "directory";
  const signature = `${isDirectory ? "folder" : "file"}\0${String(first.name || first.path || "远程项目")}\0${items.length}`;
  if (preview.dataset.content !== signature) {
    preview.dataset.content = signature;
    preview.innerHTML = `<span class="sftp-drag-preview-icon">${icon(isDirectory ? "folder" : "file")}</span><span class="sftp-drag-preview-copy"><strong>${esc(first.name || sftpPathName(first.path) || "远程项目")}</strong><small>${items.length > 1 ? `共 ${items.length} 项` : isDirectory ? "远程目录" : "远程文件"}</small></span>${items.length > 1 ? `<b>${items.length}</b>` : ""}`;
  }
  moveSftpDragPreview(clientX, clientY);
}

function moveSftpDragPreview(clientX, clientY) {
  const preview = $("sftpDragPreview");
  if (!preview) return;
  const x = Number(clientX);
  const y = Number(clientY);
  const inside = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
  preview.hidden = !inside;
  if (!inside) return;
  const width = Math.min(260, Math.max(1, window.innerWidth - 24));
  preview.style.left = `${Math.max(8, Math.min(x + 16, window.innerWidth - width - 8))}px`;
  preview.style.top = `${Math.max(8, Math.min(y + 18, window.innerHeight - 62))}px`;
}

function clearSftpDragVisuals(row) {
  cancelSftpDropLeaveClear();
  row?.classList.remove("is-dragging", "is-preparing-drag");
  document.body.classList.remove("sftp-item-drag-active");
  document.querySelectorAll(".tab.sftp-drop-target").forEach(tab => tab.classList.remove("sftp-drop-target"));
  clearSftpTabDragPreview();
  sftpDropDepth = 0;
  setSftpExternalDropState(false);
  $("sftpDragPreview")?.remove();
  document.querySelectorAll(".local-files-drop-overlay").forEach(overlay => { overlay.hidden = true; });
  if (typeof terminalSessions !== "undefined" && typeof setTerminalDropState === "function") {
    for (const session of terminalSessions.values()) {
      session.terminalDropDepth = 0;
      setTerminalDropState(session, false);
    }
  }
}

function noteSftpDragFeedbackActivity() {
  sftpDragFeedbackLastActivityAt = Date.now();
  if (sftpDragFeedbackWatchdog) return;
  sftpDragFeedbackWatchdog = setTimeout(checkSftpDragFeedbackWatchdog, SFTP_DRAG_FEEDBACK_STALE_MS + 80);
}

function hasSftpDragFeedback() {
  return Boolean(
    document.body?.classList.contains("sftp-item-drag-active")
    || document.querySelector(".sftp-drop-overlay:not([hidden]), .terminal-drop-overlay:not([hidden]), .local-files-drop-overlay:not([hidden]), #sftpDragHint, #sftpDragPreview")
    || document.querySelector(".tab.sftp-drop-target")
  );
}

function clearSftpDragFeedback() {
  if (sftpDragFeedbackWatchdog) clearTimeout(sftpDragFeedbackWatchdog);
  sftpDragFeedbackWatchdog = 0;
  sftpDragFeedbackLastActivityAt = 0;
  clearSftpDragVisuals();
}

function checkSftpDragFeedbackWatchdog() {
  sftpDragFeedbackWatchdog = 0;
  if (!hasSftpDragFeedback()) return;
  const age = Date.now() - Number(sftpDragFeedbackLastActivityAt || 0);
  if (age < SFTP_DRAG_FEEDBACK_STALE_MS) {
    sftpDragFeedbackWatchdog = setTimeout(checkSftpDragFeedbackWatchdog, SFTP_DRAG_FEEDBACK_STALE_MS - age + 80);
    return;
  }
  // Browsers do not always dispatch dragleave/dragend when the pointer is
  // released outside the window. Clear only renderer feedback here; any
  // native request or upload job remains owned by its normal completion path.
  restoreSftpDragSourceTab(sftpInternalDrag);
  clearSftpDragFeedback();
}

function bindSftpDragFeedbackLifecycle() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__termaSftpDragFeedbackLifecycleBound) return;
  window.__termaSftpDragFeedbackLifecycleBound = true;
  const finishBrowserDrag = event => {
    const drag = sftpInternalDrag;
    if (drag && !drag.nativeStarted) {
      if (!drag.dropAccepted) restoreSftpDragSourceTab(drag);
      resetSftpItemDrag(event?.target || drag.row);
    } else {
      restoreSftpDragSourceTab();
    }
    setTimeout(() => clearSftpDragFeedback(), 0);
  };
  const clearAfterDrop = () => setTimeout(() => {
    const drag = sftpInternalDrag;
    if (drag && !drag.nativeStarted && !drag.dropAccepted) {
      restoreSftpDragSourceTab(drag);
      resetSftpItemDrag(drag.row);
    } else if (!drag) {
      restoreSftpDragSourceTab();
    }
    clearSftpDragFeedback();
  }, 0);
  document.addEventListener("dragend", finishBrowserDrag, true);
  window.addEventListener("dragend", finishBrowserDrag, true);
  document.addEventListener("drop", clearAfterDrop, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      restoreSftpDragSourceTab(sftpInternalDrag);
      clearSftpDragFeedback();
    }
  });
  window.addEventListener("blur", () => {
    // A native SFTP drag can briefly change focus while the OS owns it. Keep
    // its live feedback until motion stops; ordinary browser drags can clear.
    const nativeActive = [...sftpNativeDragRequests.values()].some(request => sftpNativeDragRequestIsActive(request));
    if (nativeActive) noteSftpDragFeedbackActivity();
    else {
      restoreSftpDragSourceTab(sftpInternalDrag);
      clearSftpDragFeedback();
    }
  });
  window.addEventListener("resize", () => {
    // Fixed SFTP overlays otherwise retain their old screen coordinates.
    if (hasSftpDragFeedback()) requestAnimationFrame(() => clearSftpDragFeedback());
  });
}

bindSftpDragFeedbackLifecycle();

function clearSftpTabDragPreview() {
  if (sftpTabDragPreviewTimer) clearTimeout(sftpTabDragPreviewTimer);
  sftpTabDragPreviewTimer = 0;
  sftpTabDragPreviewKey = "";
}

function beginSftpTabDragPreviewSession(drag, tabKey) {
  if (!drag) return null;
  const sourceTabKey = String(drag.sourceTabKey || "");
  if (!sourceTabKey) return null;
  if (!sftpTabDragPreviewSession || sftpTabDragPreviewSession.drag !== drag || sftpTabDragPreviewSession.sourceTabKey !== sourceTabKey) {
    sftpTabDragPreviewSession = {
      drag,
      sourceTabKey,
      previewTabKey:String(tabKey || ""),
      accepted:false,
      acceptedTabKey:"",
      invalidTargetTimer:0,
      lastValidTargetAt:Date.now(),
      startedAt:Date.now()
    };
  } else {
    sftpTabDragPreviewSession.previewTabKey = String(tabKey || "");
  }
  return sftpTabDragPreviewSession;
}

function sftpDragTargetNode(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function isValidSftpInternalDragTarget(target) {
  const node = sftpDragTargetNode(target);
  if (!node) return false;
  const tabNode = node.closest?.(".tab[data-tab-key]");
  if (tabNode) {
    if (sftpTabDragPreviewSession && String(tabNode.dataset.tabKey || "") === String(sftpTabDragPreviewSession.sourceTabKey || "")) return false;
    const tab = typeof workspaceTabByKey === "function"
      ? workspaceTabByKey(tabNode.dataset.tabKey)
      : tabs.find(item => item.key === tabNode.dataset.tabKey);
    return Boolean(tab && ["sftp", "terminal", "local-files"].includes(tab.kind));
  }
  return Boolean(node.closest?.(".sftp-shell, .terminal-box, .terminal-drop-overlay, .sftp-drop-overlay, .local-files-shell, .local-files-drop-overlay"));
}

function scheduleSftpInvalidPreviewRestore() {
  const session = sftpTabDragPreviewSession;
  if (!session || session.accepted) return;
  if (session.invalidTargetTimer) clearTimeout(session.invalidTargetTimer);
  session.invalidTargetTimer = setTimeout(() => {
    session.invalidTargetTimer = 0;
    if (sftpTabDragPreviewSession !== session || session.accepted) return;
    const elapsed = Date.now() - Number(session.lastValidTargetAt || 0);
    if (elapsed < 35) {
      scheduleSftpInvalidPreviewRestore();
      return;
    }
    restoreSftpDragSourceTab(session.drag);
  }, 45);
}

function clearSftpTabDragPreviewSession(drag=null) {
  const session = sftpTabDragPreviewSession;
  if (!session) return;
  if (session.invalidTargetTimer) clearTimeout(session.invalidTargetTimer);
  if (!drag || session.drag === drag || session.sourceTabKey === String(drag.sourceTabKey || "")) sftpTabDragPreviewSession = null;
}

function markSftpDragDropAccepted(drag, targetTabKey="") {
  if (!drag) return;
  drag.dropAccepted = true;
  drag.acceptedTabKey = String(targetTabKey || "");
  const session = sftpTabDragPreviewSession;
  if (session && (session.drag === drag || session.sourceTabKey === String(drag.sourceTabKey || ""))) {
    session.accepted = true;
    session.acceptedTabKey = String(targetTabKey || "");
    sftpTabDragPreviewSession = null;
  }
}

function restoreSftpDragSourceTab(drag) {
  const session = sftpTabDragPreviewSession;
  if (drag?.dropAccepted || session?.accepted) return;
  if (!drag?.previewActivated && !session) return;
  const sourceTabKey = String(drag?.sourceTabKey || session?.sourceTabKey || "");
  if (sourceTabKey && activeTabKey !== sourceTabKey && tabs.some(tab => tab.key === sourceTabKey)) activateTab(sourceTabKey);
  clearSftpTabDragPreviewSession(drag);
}

function scheduleSftpTabDragPreview(tabKey, options={}) {
  if (activeTabKey === tabKey || (sftpTabDragPreviewKey === tabKey && sftpTabDragPreviewTimer)) return;
  clearSftpTabDragPreview();
  sftpTabDragPreviewKey = tabKey;
  const preview = () => {
    sftpTabDragPreviewTimer = 0;
    const drag = activeSftpDragPayload();
    const target = tabs.find(tab => tab.key === tabKey);
    if (!drag || !["sftp", "terminal"].includes(target?.kind) || String(target.key || "") === String(drag.sourceTabKey || "")) return clearSftpTabDragPreview();
    beginSftpTabDragPreviewSession(drag, tabKey);
    drag.previewActivated = true;
    drag.previewTabKey = tabKey;
    activateTab(tabKey);
    requestAnimationFrame(() => {
      const activeDrag = activeSftpDragPayload();
      const currentTarget = tabs.find(tab => tab.key === tabKey);
      if (!activeDrag || activeTabKey !== tabKey || !["sftp", "terminal"].includes(currentTarget?.kind) || String(currentTarget.key || "") === String(activeDrag.sourceTabKey || "")) {
        clearSftpTabDragPreview();
        return;
      }
      const node = [...document.querySelectorAll(".tab[data-tab-key]")].find(tab => tab.dataset.tabKey === tabKey);
      node?.classList.add("sftp-drop-target");
      showSftpDragHint(`松开复制到 ${currentTarget.kind === "terminal" ? "终端当前目录" : currentTarget.title}`, true, "copy", tabKey);
    });
  };
  if (options.immediate) {
    preview();
    return;
  }
  sftpTabDragPreviewTimer = setTimeout(preview, 120);
}

function resetSftpItemDrag(row) {
  document.removeEventListener("dragenter", handleSftpDocumentDragOver, true);
  document.removeEventListener("dragleave", handleSftpDocumentDragLeave, true);
  document.removeEventListener("dragover", handleSftpDocumentDragOver, true);
  if (sftpInternalDrag?.leaveWindowTimer) clearTimeout(sftpInternalDrag.leaveWindowTimer);
  clearSftpDragVisuals(row || sftpInternalDrag?.row);
  sftpExternalDragPreparing = null;
  sftpInternalDrag = null;
}

function markSftpDragInsideWindow() {
  const drag = sftpInternalDrag;
  if (!drag) return;
  if (drag.leaveWindowTimer) clearTimeout(drag.leaveWindowTimer);
  drag.leaveWindowTimer = 0;
  drag.leftWindow = false;
}

function handleSftpDocumentDragOver(event) {
  markSftpDragInsideWindow();
  const session = sftpTabDragPreviewSession;
  if (!session || session.accepted) return;
  if (isValidSftpInternalDragTarget(event?.target)) {
    session.lastTargetKind = "valid";
    session.lastValidTargetAt = Date.now();
    if (session.invalidTargetTimer) {
      clearTimeout(session.invalidTargetTimer);
      session.invalidTargetTimer = 0;
    }
    return;
  }
  session.lastTargetKind = "invalid";
  restoreSftpDragSourceTab(session.drag);
}

function finishSftpDragPayload(drag) {
  if (!drag) return;
  clearSftpInternalDragHandoff();
  if (sftpInternalDrag === drag) {
    resetSftpItemDrag(drag.row);
    return;
  }
  for (const [requestId, request] of sftpNativeDragRequests) {
    if (request !== drag) continue;
    sftpNativeDragRequests.delete(requestId);
    clearSftpDragVisuals(request.row);
    return;
  }
  clearSftpDragVisuals(drag.row);
}

function handleSftpDocumentDragLeave(event) {
  if (!sftpInternalDrag || event.relatedTarget) return;
  const outsideWindow = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  if (!outsideWindow) return;
  const drag = sftpInternalDrag;
  if (drag.leaveWindowTimer) clearTimeout(drag.leaveWindowTimer);
  drag.leaveWindowTimer = setTimeout(() => {
    if (sftpInternalDrag !== drag) return;
    drag.leaveWindowTimer = 0;
    drag.leftWindow = true;
    const mode = sftpExternalDragMode();
    if (mode === "streaming" && !drag.nativeStarted) {
      startSftpNativeDrag(drag.row, drag.connectionId, drag.entries, null, "streaming");
      return;
    }
    if (mode === "staged" && !drag.nativeStarted) {
      showSftpDragHint(drag.nativeFiles?.length
        ? "内容已准备好；松开后再次拖动可保存到本机"
        : "正在准备拖出内容；完成后再次拖动可保存到本机");
      return;
    }
    showSftpDragHint("Web 版不能拖到系统；跨主机复制请拖到另一台 SFTP 标签");
  }, 80);
}

function beginSftpItemDrag(event, connectionId, path, name, type, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (isMobileLayout()) return event.preventDefault();
  clearSftpInternalDragHandoff();
  clearSftpTabDragPreviewSession();
  const pointerArmedRequest = sftpNativeDragPointer?.row === event.currentTarget
    ? sftpNativeDragPointer.nativeRequestId
    : "";
  if (pointerArmedRequest) {
    event.preventDefault();
    activateSftpNativeDragPointer(sftpNativeDragPointer);
    return;
  }
  const activeNativeRequest = [...sftpNativeDragRequests.values()].some(
    request => request?.row === event.currentTarget && sftpNativeDragRequestIsActive(request)
  );
  if (activeNativeRequest) {
    event.preventDefault();
    return;
  }
  clearSftpNativeDragPointer();
  const entries = selectSftpDragSource(path, name, type, tabKey);
  const externalDragMode = sftpExternalDragMode();
  if (externalDragMode === "staged") showSftpNativeDragFallbackNotice();
  const cached = externalDragMode === "staged" ? cachedSftpNativeDrag(connectionId, entries) : null;
  const nativeKey = sftpNativeDragKey(connectionId, entries);
  if (externalDragMode === "staged" && cached && sftpNativeDragArmed.has(nativeKey)) {
    event.preventDefault();
    startSftpNativeDrag(event.currentTarget, connectionId, entries, cached, "staged", {sourceTabKey:tabKey});
    return;
  }
  const drag = {connectionId:Number(connectionId), entries, sourceTabKey:String(tabKey || ""), row:event.currentTarget, browserDragEnded:false, leftWindow:false, leaveWindowTimer:0, nativeFiles:cached?.files || null, nativeStarted:false, previewActivated:false, previewTabKey:"", dropAccepted:false, acceptedTabKey:""};
  sftpInternalDrag = drag;
  event.currentTarget?.addEventListener("dragend", () => {
    if (sftpInternalDrag !== drag || drag.nativeStarted) return;
    if (!drag.dropAccepted) restoreSftpDragSourceTab(drag);
    resetSftpItemDrag(drag.row);
  }, {once:true});
  document.addEventListener("dragenter", handleSftpDocumentDragOver, true);
  document.addEventListener("dragleave", handleSftpDocumentDragLeave, true);
  document.addEventListener("dragover", handleSftpDocumentDragOver, true);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(SFTP_INTERNAL_DRAG_MIME, serializeSftpDragPayload(connectionId, entries, tabKey));
  event.currentTarget?.classList.add("is-dragging");
  document.body.classList.add("sftp-item-drag-active");
  showSftpDragHint(sftpDragSourceHint(), false, "", tabKey);
  if (externalDragMode === "staged" && !cached?.files?.length) {
    void prepareSftpNativeDrag(connectionId, entries, event.currentTarget);
  }
}

function startSftpNativeDrag(row, connectionId, entries, cached, mode=sftpExternalDragMode(), options={}) {
  if (mode !== "staged" && mode !== "streaming") return "";
  const key = sftpNativeDragKey(connectionId, entries);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (mode === "staged") sftpNativeDragArmed.delete(key);
  const request = {
    key,
    mode,
    row,
    sourceTabKey:String(options.sourceTabKey || sftpTabKeyFromNode(row) || ""),
    connectionId:Number(connectionId),
    entries:entries.map(item => ({
      path:item.path,
      name:item.name,
      type:item.type,
      size:Math.max(0, Number(item.size || 0)),
      mtime:Math.max(0, Number(item.mtime || 0)),
      metadataKnown:Boolean(item.metadataKnown)
    })),
    files:mode === "staged" ? [...(cached?.files || [])] : [],
    activated:!options.armed,
    nativeReady:false,
    createdAt:Date.now(),
    lastActivityAt:Date.now()
  };
  sftpNativeDragRequests.set(requestId, request);
  if (sftpInternalDrag?.row === row) sftpInternalDrag.nativeStarted = true;
  if (!options.armed) {
    document.body.classList.add("sftp-item-drag-active");
    showSftpDragHint(sftpDragSourceHint(), false, "", request.sourceTabKey);
  }
  try {
    const payload = mode === "streaming"
      ? {connectionId:Number(connectionId), entries:request.entries, sourceTabKey:request.sourceTabKey}
      : request.files;
    window.termaDesktop.startSftpDrag(payload, requestId);
    return requestId;
  } catch (error) {
    sftpNativeDragRequests.delete(requestId);
    if (mode === "staged") sftpNativeDragArmed.add(key);
    if (sftpInternalDrag?.row === row) sftpInternalDrag.nativeStarted = false;
    clearSftpDragVisuals(row);
    notify(error.message || "无法启动系统拖拽", "error");
    return "";
  }
}

function updateSftpNativeDragTarget(requestId, request, target, options={}) {
  const normalized = target ? {
    id:Number(target.id),
    tabKey:String(target.key || target.tabKey || ""),
    path:String(target.path || "."),
    title:String(target.title || "SFTP"),
    kind:target.kind === "terminal" ? "terminal" : target.kind === "local-files" ? "local-files" : "sftp"
  } : null;
  const key = normalized ? `${normalized.kind}\0${normalized.id}\0${normalized.tabKey}\0${normalized.path}` : "";
  if (normalized) request.nativeTargetMissedAt = 0;
  if (request.nativeTargetKey === key && !options.final) return;
  request.nativeTargetKey = key;
  request.nativeTarget = normalized;
  window.termaDesktop?.setSftpDragTarget?.(requestId, normalized, {final:Boolean(options.final)});
}

function showSftpNativeDragTargetFeedback(target) {
  if (!target) return;
  if (target.kind === "terminal") {
    for (const candidate of terminalSessions.values()) {
      if (candidate?.key !== target.tabKey && typeof setTerminalDropState === "function") setTerminalDropState(candidate, false);
    }
    const session = terminalSessions.get(String(target.tabKey || ""));
    if (session && typeof setTerminalDropState === "function") setTerminalDropState(session, true, "copy");
    return;
  }
  if (target.kind === "local-files") {
    const overlay = localFilesRoot(String(target.tabKey || ""))?.querySelector(".local-files-drop-overlay");
    if (overlay) overlay.hidden = false;
    showSftpDragHint(`松开保存到 ${target.title}`, true, "copy", target.tabKey);
    return;
  }
  const state = sftpTabRuntimes.get(String(target.tabKey || ""))?.state;
  if (state && Number(state.connectionId) === Number(target.id)) {
    setSftpExternalDropState(true, {title:`松开复制到 ${target.title}`, path:target.path || state.path || ".", tabKey:target.tabKey});
  } else {
    showSftpDragHint(`松开复制到 ${target.title}`, true, "copy", target.tabKey);
  }
}

function syncSftpNativeDragTargetAt(requestId, request, clientX, clientY, options={}) {
  const hasPosition = Number.isFinite(clientX) && Number.isFinite(clientY);
  const insideWindow = hasPosition
    && Number(clientX) >= 0
    && Number(clientY) >= 0
    && Number(clientX) <= window.innerWidth
    && Number(clientY) <= window.innerHeight;
  const now = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const node = hasPosition ? document.elementFromPoint(Number(clientX), Number(clientY)) : null;
  const tabNode = node?.closest?.(".tab[data-kind='sftp'], .tab[data-kind='local-files']");
  let target = tabNode ? tabs.find(tab => tab.key === tabNode.dataset.tabKey) : null;
  if (!target && node?.closest?.(".sftp-shell")) {
    const shellTabKey = sftpTabKeyFromNode(node, "");
    const shellTab = tabs.find(tab => tab.key === shellTabKey);
    if (shellTab?.kind === "sftp") target = shellTab;
  }
  if (!target && node?.closest?.(".local-files-shell")) {
    const shellTabKey = node.closest(".local-files-shell")?.dataset?.localFilesTabKey || "";
    const shellTab = tabs.find(tab => tab.key === shellTabKey);
    const state = localFileRuntimes.get(String(shellTabKey || ""));
    if (shellTab?.kind === "local-files") {
      target = {
        kind:"local-files",
        id:1,
        key:String(shellTab.key),
        path:String(state?.path || shellTab.path || ""),
        title:`本地文件：${state?.path || shellTab.path || "桌面"}`
      };
    }
  }
  if (!target && node) {
    const terminalSession = [...terminalSessions.values()].find(session => session?.mount?.contains?.(node));
    if (terminalSession?.connected && terminalSession.currentDirectoryKnown) {
      target = {
        kind:"terminal",
        id:Number(terminalSession.id),
        key:String(terminalSession.key || ""),
        path:String(terminalSession.currentDirectory || "."),
        title:`终端：${terminalDirectoryDropLabel(terminalSession)}`
      };
    }
  }
  if (target && String(target.key || "") !== String(request.sourceTabKey || "")) {
    document.querySelectorAll(".tab.sftp-drop-target").forEach(tab => tab.classList.remove("sftp-drop-target"));
    if (["sftp", "local-files"].includes(target.kind)) {
      tabNode?.classList.add("sftp-drop-target");
      if (!options.final && tabNode && target.key !== activeTabKey) scheduleSftpTabDragPreview(target.key);
    }
    const targetState = target.kind === "sftp" ? sftpTabRuntimes.get(target.key)?.state : null;
    const directory = target.kind === "sftp" && Number(targetState?.connectionId) === Number(target.id)
      ? targetState.path
      : target.path || ".";
    const resolvedTarget = {...target, path:directory};
    request.nativeTargetSeenAt = now;
    updateSftpNativeDragTarget(requestId, request, resolvedTarget, options);
    if (!options.final) showSftpNativeDragTargetFeedback(request.nativeTarget);
    return resolvedTarget;
  }
  const transientFinalNode = !node || node === document.body || node === document.documentElement || Boolean(node?.closest?.("#view-sftp"));
  if (
    options.final
    && insideWindow
    && transientFinalNode
    && request.nativeTarget
    && sftpTabKeyFromNode(node, activeTabKey) === request.nativeTarget.tabKey
    && now - Number(request.nativeTargetSeenAt || 0) < SFTP_NATIVE_TARGET_MISS_GRACE_MS
  ) {
    request.nativeTargetMissedAt = 0;
    updateSftpNativeDragTarget(requestId, request, request.nativeTarget, options);
    return request.nativeTarget;
  }
  if (!options.final && request.nativeTarget) {
    if (!request.nativeTargetMissedAt) request.nativeTargetMissedAt = now;
    if (now - request.nativeTargetMissedAt < SFTP_NATIVE_TARGET_MISS_GRACE_MS) {
      showSftpNativeDragTargetFeedback(request.nativeTarget);
      return request.nativeTarget;
    }
  }
  request.nativeTargetMissedAt = 0;
  document.querySelectorAll(".tab.sftp-drop-target").forEach(tab => tab.classList.remove("sftp-drop-target"));
  clearSftpTabDragPreview();
  if (typeof setTerminalDropState === "function") {
    for (const session of terminalSessions.values()) setTerminalDropState(session, false);
  }
  setSftpExternalDropState(false, {keepHint:true});
  updateSftpNativeDragTarget(requestId, request, null, options);
  if (!options.final) {
    // Native pointer coordinates can briefly move across the window boundary
    // while Windows transfers ownership to OLE. Keep one stable fallback copy
    // instead of alternating two messages on every motion event.
    showSftpDragHint(sftpDragSourceHint(), false, "", request.sourceTabKey);
  }
  return null;
}

function handleSftpNativeDragEvent(event) {
  const requestId = String(event?.requestId || "");
  const request = sftpNativeDragRequests.get(requestId);
  if (!request) return;
  request.lastActivityAt = Date.now();
  if (["started", "motion", "released"].includes(event.type)) noteSftpDragFeedbackActivity();
  if (event.type === "transferStarted") {
    refreshSftpJobs();
    return;
  }
  if (event.type === "ready") {
    request.nativeReady = true;
    if (sftpNativeDragPointer?.nativeRequestId === requestId) sftpNativeDragPointer.nativeReady = true;
    if (request.activated) window.termaDesktop?.activateSftpDrag?.(requestId);
    return;
  }
  if (event.type === "started") {
    request.nativeStarted = true;
    if (sftpNativeDragPointer?.nativeRequestId === requestId) {
      sftpNativeDragPointer.nativeStarted = true;
      clearSftpNativeDragPointer({cancel:false});
    }
    showSftpDragPreview(request.entries, event.clientX, event.clientY);
    return;
  }
  if (event.type === "released") {
    syncSftpNativeDragTargetAt(requestId, request, event.clientX, event.clientY, {final:true});
    request.released = true;
    if (sftpNativeDragPointer?.nativeRequestId === requestId) {
      clearSftpNativeDragPointer({cancel:false});
    }
    if (sftpInternalDrag?.row === request.row && sftpInternalDrag.nativeStarted) {
      document.removeEventListener("dragleave", handleSftpDocumentDragLeave, true);
      document.removeEventListener("dragover", handleSftpDocumentDragOver, true);
      if (sftpInternalDrag.leaveWindowTimer) clearTimeout(sftpInternalDrag.leaveWindowTimer);
      sftpInternalDrag = null;
      sftpExternalDragPreparing = null;
    }
    clearSftpDragVisuals(request.row);
    setTimeout(() => refreshSftpJobs(), 250);
    return;
  }
  if (event.type !== "motion" || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
  moveSftpDragPreview(event.clientX, event.clientY);
  syncSftpNativeDragTargetAt(requestId, request, event.clientX, event.clientY);
}

async function handleSftpNativeDragResult(result) {
  const requestId = String(result?.requestId || "");
  const request = sftpNativeDragRequests.get(requestId);
  if (!request) return;
  if (sftpNativeDragPointer?.nativeRequestId === requestId) clearSftpNativeDragPointer({cancel:false});
  const internalTarget = result?.internalTarget;
  if (result?.ok && internalTarget?.kind === "local-files") {
    const localTarget = typeof workspaceTabByKey === "function"
      ? workspaceTabByKey(internalTarget.tabKey)
      : tabs.find(tab => tab.kind === "local-files" && tab.key === internalTarget.tabKey);
    if (localTarget && typeof copySftpDraggedItemsToLocalTab === "function") {
      localTarget.path = String(internalTarget.path || localTarget.path || "");
      await copySftpDraggedItemsToLocalTab(request, localTarget);
      return;
    }
  }
  const allTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  const target = internalTarget?.kind !== "terminal" && internalTarget
    ? allTabs.find(tab => tab.kind === "sftp" && tab.key === internalTarget.tabKey)
      || allTabs.find(tab => tab.kind === "sftp" && Number(tab.id) === Number(internalTarget.id))
    : null;
  if (result?.ok && internalTarget?.kind === "terminal") {
    const session = terminalSessions.get(String(internalTarget.tabKey || ""));
    if (session && typeof setTerminalDropState === "function") setTerminalDropState(session, false);
    await copySftpDraggedItemsToDirectory(request, Number(internalTarget.id), String(internalTarget.path || "."), {
      title:`终端：${internalTarget.path || "当前目录"}`
    });
    return;
  }
  if (result?.ok && target && String(target.key || "") !== String(request.sourceTabKey || "")) {
    target.path = String(internalTarget.path || target.path || ".");
    await copySftpDraggedItemsToTarget(request, target);
    return;
  }
  sftpNativeDragRequests.delete(requestId);
  if (sftpInternalDrag?.row === request.row && sftpInternalDrag.nativeStarted) {
    document.removeEventListener("dragleave", handleSftpDocumentDragLeave, true);
    document.removeEventListener("dragover", handleSftpDocumentDragOver, true);
    if (sftpInternalDrag.leaveWindowTimer) clearTimeout(sftpInternalDrag.leaveWindowTimer);
    sftpInternalDrag = null;
    sftpExternalDragPreparing = null;
  }
  clearSftpDragVisuals(request.row);
  refreshSftpJobs();
  if (result?.ok) {
    if (request.mode === "staged") {
      sftpNativeDragArmed.delete(request.key);
      sftpNativeDragCache.delete(request.key);
    }
    const renamedItems = Array.isArray(result?.renamedItems)
      ? result.renamedItems.filter(item => item?.savedName)
      : [];
    if (renamedItems.length) {
      const names = renamedItems.slice(0, 3).map(item => item.savedName).join("、");
      const suffix = renamedItems.length > 3 ? ` 等 ${renamedItems.length} 项` : "";
      notify(`目标目录存在同名项目，Finder 已自动保存为：${names}${suffix}`, "info");
    }
    return;
  }
  if (request.mode === "staged") sftpNativeDragArmed.add(request.key);
  if (/取消/.test(String(result?.message || ""))) return;
  notify(result?.message || "无法启动系统拖拽，请再次拖动重试", "error");
}

async function prepareSftpNativeDrag(connectionId, entries, row) {
  if (sftpExternalDragMode() !== "staged" || !entries.length) return;
  const token = Symbol("sftp-external-drag");
  sftpExternalDragPreparing = token;
  row?.classList.add("is-preparing-drag");
  try {
    const staged = await stageSftpNativeDrag(connectionId, entries);
    if (sftpExternalDragPreparing !== token || !sftpInternalDrag) return;
    sftpInternalDrag.nativeFiles = staged.files || [];
    if (sftpInternalDrag.leftWindow) {
      sftpNativeDragArmed.add(sftpNativeDragKey(connectionId, entries));
      if (sftpInternalDrag.browserDragEnded) notify("拖出内容已准备好，请再次拖动", "info");
      else showSftpDragHint("已准备好；松开后再次拖动可保存到外部");
    } else if (!sftpInternalDrag.browserDragEnded) {
      showSftpDragHint("拖到其他 SFTP 标签可跨主机复制");
    }
  } catch (error) {
    if (sftpExternalDragPreparing === token) notify(error.message || "准备拖出文件失败", "error");
  } finally {
    row?.classList.remove("is-preparing-drag");
    if (sftpExternalDragPreparing === token) sftpExternalDragPreparing = null;
    if (sftpInternalDrag?.browserDragEnded) resetSftpItemDrag(row);
  }
}

function finishSftpItemDrag(event) {
  const drag = sftpInternalDrag;
  if (drag?.nativeStarted) {
    document.removeEventListener("dragleave", handleSftpDocumentDragLeave, true);
    document.removeEventListener("dragover", handleSftpDocumentDragOver, true);
    if (drag.leaveWindowTimer) clearTimeout(drag.leaveWindowTimer);
    sftpInternalDrag = null;
    sftpExternalDragPreparing = null;
    return;
  }
  const previewTarget = tabs.find(tab => tab.key === activeTabKey);
  const preserveForCrossHostDrop = Boolean(
    drag
    && sftpDataTransferHasInternalPayload(event?.dataTransfer)
    && previewTarget?.kind === "sftp"
    && Number(previewTarget.id) !== Number(drag.connectionId)
    && (event?.dataTransfer?.dropEffect === "copy" || sftpDropDepth > 0)
  );
  if (preserveForCrossHostDrop) {
    const payload = {
      connectionId:drag.connectionId,
      entries:drag.entries,
      sourceTabKey:drag.sourceTabKey
    };
    resetSftpItemDrag(event?.currentTarget);
    if (rememberSftpInternalDragHandoff(payload)) {
      const targetState = sftpTabRuntimes.get(previewTarget.key)?.state;
      const directory = Number(targetState?.connectionId) === Number(previewTarget.id) ? targetState.path : previewTarget.path || ".";
      setSftpExternalDropState(true, {title:`松开复制到 ${previewTarget.title}`, path:directory, tabKey:previewTarget.key});
    }
    return;
  }
  const outsideWindow = Boolean(drag?.leftWindow);
  if (sftpExternalDragMode() === "staged" && drag?.nativeFiles?.length && outsideWindow) {
    sftpNativeDragArmed.add(sftpNativeDragKey(drag.connectionId, drag.entries));
    notify("拖出内容已准备好，请再次拖动", "info");
  }
  if (sftpExternalDragMode() === "staged" && drag && sftpExternalDragPreparing && outsideWindow) {
    drag.browserDragEnded = true;
    clearSftpDragVisuals(event?.currentTarget);
    return;
  }
  restoreSftpDragSourceTab(drag);
  resetSftpItemDrag(event?.currentTarget);
}

function handleSftpTabDragOver(event, tabKey, tabElement=event.currentTarget) {
  const target = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(tab => tab.key === tabKey);
  const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event?.dataTransfer) : null;
  if (localPayload && ["sftp", "terminal"].includes(target?.kind)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    tabElement?.classList.add("sftp-drop-target");
    showSftpDragHint(`松开上传到 ${target.kind === "terminal" ? "终端当前目录" : target.title}`, true, "upload", tabKey);
    scheduleSftpTabDragPreview(tabKey, {immediate:target.kind === "terminal"});
    return;
  }
  const drag = activeSftpDragPayload(event?.dataTransfer);
  if (!drag || !["sftp", "terminal", "local-files"].includes(target?.kind) || String(target.key || "") === String(drag.sourceTabKey || "")) return;
  markSftpDragInsideWindow();
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  tabElement?.classList.add("sftp-drop-target");
  showSftpDragHint(`松开复制到 ${target.kind === "terminal" ? "终端当前目录" : target.title}`, true, "copy", tabKey);
  scheduleSftpTabDragPreview(tabKey, {immediate:target.kind === "terminal"});
}

function handleSftpTabDragLeave(event, tabElement=event.currentTarget) {
  if (!tabElement?.contains(event.relatedTarget)) {
    tabElement?.classList.remove("sftp-drop-target");
    const session = sftpTabDragPreviewSession;
    if (session
      && String(session.previewTabKey || "") === String(tabElement?.dataset?.tabKey || "")
      && event.relatedTarget
      && !isValidSftpInternalDragTarget(event.relatedTarget)) {
      restoreSftpDragSourceTab(session.drag);
      return;
    }
    if (activeTabKey !== tabElement?.dataset?.tabKey) clearSftpTabDragPreview();
  }
}

async function sftpConflictChoice(connectionId, directory, entries, labels={}) {
  const plan = await api(`/api/connections/${connectionId}/sftp/upload-plan`, {
    method:"POST",
    body:JSON.stringify({path:directory, filenames:entries.map(item => item.name)})
  });
  const conflicts = (plan.items || []).filter(item => item.exists);
  if (!conflicts.length) return "error";
  const preview = conflicts.slice(0, 6).map(item => item.name).join("、");
  return chooseModal(labels.title || "发现同名项目", `${preview}${conflicts.length > 6 ? ` 等 ${conflicts.length} 项` : ""}`, [
    {label:labels.overwrite || "覆盖同名项目", value:"overwrite", className:"danger"},
    {label:labels.rename || "自动改名", value:"rename", className:"primary"},
    {label:"取消", value:"cancel"}
  ]);
}

async function dropSftpItemsOnTab(event, tabKey, tabElement=event.currentTarget) {
  const localPayload = typeof readLocalFileDragPayload === "function" ? readLocalFileDragPayload(event?.dataTransfer) : null;
  const drag = activeSftpDragPayload(event?.dataTransfer);
  const target = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(tab => tab.key === tabKey);
  tabElement?.classList.remove("sftp-drop-target");
  if (localPayload && ["sftp", "terminal"].includes(target?.kind)) {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (target.kind === "terminal" && typeof uploadLocalFilesToTerminalTab === "function") await uploadLocalFilesToTerminalTab(localPayload, target);
      else await uploadLocalFilesToSftp(localPayload, target, tabKey);
    }
    catch (error) { notify(error.message || "上传本地文件失败", "error"); }
    return;
  }
  if (!drag || !["sftp", "terminal", "local-files"].includes(target?.kind) || String(target.key || "") === String(drag.sourceTabKey || "")) return;
  event.preventDefault();
  event.stopPropagation();
  markSftpDragDropAccepted(drag, tabKey);
  if (activeTabKey !== tabKey) activateTab(tabKey);
  if (target.kind === "terminal") {
    try { await copySftpDraggedItemsToTerminalTab(drag, target); }
    catch (error) { notify(error.message || "复制远程文件到终端失败", "error"); }
    return;
  }
  if (target.kind === "local-files") {
    try { await copySftpDraggedItemsToLocalTab(drag, target); }
    catch (error) { notify(error.message || "保存远程文件失败", "error"); }
    return;
  }
  await copySftpDraggedItemsToTarget(drag, target);
}

async function copySftpDraggedItemsToTerminalTab(drag, tab) {
  const key = String(tab?.key || "");
  const connection = currentConnection(Number(tab?.id || 0));
  const session = terminalSessions.get(key);
  if (!connection || !session?.connected) throw new Error("终端尚未连接，无法接收文件");
  const directory = session.currentDirectoryKnown
    ? session.currentDirectory
    : await initializeTerminalDirectory(session, connection, key);
  if (!directory) throw new Error("无法确认终端当前目录，请先重连终端");
  return copySftpDraggedItemsToDirectory(drag, connection.id, directory, {title:`终端：${directory}`, tabKey:key});
}

async function copySftpDraggedItemsToTarget(drag, target) {
  if (!drag || target?.kind !== "sftp" || String(target.key || "") === String(drag.sourceTabKey || "")) return;
  sftpExternalDragPreparing = null;
  const targetState = sftpTabRuntimes.get(target.key)?.state;
  const directory = Number(targetState?.connectionId) === Number(target.id)
    ? targetState.path
    : target.path || ".";
  const dragKey = sftpNativeDragKey(drag.connectionId, drag.entries || []);
  const nativeRequests = [...sftpNativeDragRequests.entries()].reverse();
  for (const [requestId, request] of nativeRequests) {
    if (Number(request?.connectionId) !== Number(drag.connectionId)) continue;
    if (sftpNativeDragKey(request.connectionId, request.entries || []) !== dragKey) continue;
    updateSftpNativeDragTarget(requestId, request, {...target, path:directory}, {final:true});
    break;
  }
  return copySftpDraggedItemsToDirectory(drag, Number(target.id), directory, {title:target.title, tabKey:target.key});
}

async function copySftpDraggedItemsToDirectory(drag, targetConnectionId, directory, options={}) {
  if (!drag?.entries?.length || !Number.isInteger(Number(targetConnectionId)) || Number(targetConnectionId) <= 0) return;
  markSftpDragDropAccepted(drag, options.tabKey || "");
  sftpExternalDragPreparing = null;
  finishSftpDragPayload(drag);
  const title = String(options.title || "目标目录");
  const tabKey = String(options.tabKey || "");
  showSftpDragHint(`正在检查 ${title} 并准备复制`, true, "copy", tabKey);
  const pendingHint = $("sftpDragHint");
  try {
    const conflict = await sftpConflictChoice(Number(targetConnectionId), directory, drag.entries, {title:`${title}存在同名项目`});
    if (conflict === "cancel") return;
    const job = await api(`/api/connections/${drag.connectionId}/sftp/cross-copy`, {
      method:"POST",
      body:JSON.stringify({paths:drag.entries.map(item => item.path), entries:drag.entries, target_connection_id:Number(targetConnectionId), target:directory, conflict})
    });
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "SFTP 项目复制失败", "error");
  } finally {
    if ($("sftpDragHint") === pendingHint) pendingHint?.remove();
  }
}
