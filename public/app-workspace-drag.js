function showWorkspaceTabsContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `${icon("combine")}<span>${esc(tr("navigation:auto.combine_workspace", {defaultValue:"Combine into workspace"}))}</span>`;
  button.disabled = tabs.length < 2;
  button.onclick = () => beginWorkspaceGroupSelection();
  menu.appendChild(button);
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
}

function workspaceClearDropIndicators() {
  for (const pane of workspacePaneNodes.values()) {
    const indicator = pane.querySelector(".workspace-pane-drop-indicator");
    if (indicator) {
      indicator.hidden = true;
      indicator.dataset.zone = "";
    }
    const insertion = pane.querySelector(".workspace-tab-insert-indicator");
    if (insertion) insertion.hidden = true;
  }
  workspaceTabDropTarget = null;
}

function workspaceDropZoneAtPoint(pane, clientX, clientY) {
  const tabsShell = pane.querySelector(".tabs-shell");
  const tabsRect = tabsShell?.getBoundingClientRect();
  if (tabsRect && clientY >= tabsRect.top && clientY <= tabsRect.bottom) {
    const candidates = [...tabsShell.querySelectorAll(".tab:not(.tab-dragging)")];
    const index = candidates.findIndex(tab => clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2);
    return {zone:"tabs", index:index < 0 ? candidates.length : index};
  }
  const workspace = pane.querySelector(".workspace");
  const rect = workspace?.getBoundingClientRect();
  if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  if (isMobileLayout()) return {zone:"center", index:null};
  const distances = [
    ["left", (clientX - rect.left) / Math.max(1, rect.width)],
    ["right", (rect.right - clientX) / Math.max(1, rect.width)],
    ["top", (clientY - rect.top) / Math.max(1, rect.height)],
    ["bottom", (rect.bottom - clientY) / Math.max(1, rect.height)]
  ].sort((left, right) => left[1] - right[1]);
  return {zone:distances[0][1] <= 0.36 ? distances[0][0] : "center", index:null};
}

function showWorkspaceTabInsertionIndicator(paneElement, index) {
  const shell = paneElement.querySelector(".tabs-shell");
  const tabsNode = paneElement.querySelector(".tabs");
  const insertion = paneElement.querySelector(".workspace-tab-insert-indicator");
  if (!shell || !tabsNode || !insertion) return;
  const candidates = [...tabsNode.querySelectorAll(".tab:not(.tab-dragging)")];
  const boundedIndex = Math.max(0, Math.min(candidates.length, Number(index) || 0));
  const shellRect = shell.getBoundingClientRect();
  const tabsRect = tabsNode.getBoundingClientRect();
  const anchorRect = boundedIndex < candidates.length
    ? candidates[boundedIndex].getBoundingClientRect()
    : candidates.at(-1)?.getBoundingClientRect();
  const clientX = boundedIndex < candidates.length
    ? anchorRect?.left ?? tabsRect.left
    : anchorRect?.right ?? tabsRect.left;
  const clampedX = Math.max(tabsRect.left, Math.min(tabsRect.right, clientX));
  insertion.style.left = `${clampedX - shellRect.left}px`;
  insertion.hidden = false;
}

function updateWorkspaceTabDropTarget(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const paneElement = element?.closest?.(".workspace-pane");
  if (!paneElement) return workspaceClearDropIndicators();
  const paneId = paneElement.dataset.paneId;
  const target = workspaceDropZoneAtPoint(paneElement, clientX, clientY);
  if (!target) return workspaceClearDropIndicators();
  for (const [otherPaneId, otherPane] of workspacePaneNodes) {
    if (otherPaneId === paneId) continue;
    const otherIndicator = otherPane.querySelector(".workspace-pane-drop-indicator");
    if (!otherIndicator) continue;
    otherIndicator.hidden = true;
    otherIndicator.dataset.zone = "";
    const otherInsertion = otherPane.querySelector(".workspace-tab-insert-indicator");
    if (otherInsertion) otherInsertion.hidden = true;
  }
  workspaceTabDropTarget = {paneId, ...target};
  const indicator = paneElement.querySelector(".workspace-pane-drop-indicator");
  if (!indicator) return;
  const insertion = paneElement.querySelector(".workspace-tab-insert-indicator");
  if (target.zone === "tabs") {
    indicator.hidden = true;
    indicator.dataset.zone = "";
    showWorkspaceTabInsertionIndicator(paneElement, target.index);
    return;
  }
  if (insertion) insertion.hidden = true;
  indicator.hidden = false;
  indicator.dataset.zone = target.zone;
  const labels = {
    left:tr("navigation:auto.drop_left", {defaultValue:"Drop in a split on the left"}),
    right:tr("navigation:auto.drop_right", {defaultValue:"Drop in a split on the right"}),
    top:tr("navigation:auto.drop_top", {defaultValue:"Drop in a split above"}),
    bottom:tr("navigation:auto.drop_bottom", {defaultValue:"Drop in a split below"}),
    center:tr("navigation:auto.drop_center", {defaultValue:"Move to this pane"})
  };
  indicator.querySelector("span").textContent = labels[target.zone] || "";
}

function scheduleWorkspaceTabDockAutoScroll() {
  const drag = workspaceTabDrag;
  if (!drag?.dragging || drag.autoScrollFrame) return;
  drag.autoScrollFrame = requestAnimationFrame(updateWorkspaceTabDockAutoScroll);
}

function updateWorkspaceTabDockAutoScroll() {
  const drag = workspaceTabDrag;
  if (!drag?.dragging) return;
  drag.autoScrollFrame = 0;
  const target = workspaceTabDropTarget;
  const pane = workspacePaneElement(target?.paneId || drag.sourcePaneId);
  const container = pane?.querySelector(".tabs");
  const shell = pane?.querySelector(".tabs-shell");
  const rect = container?.getBoundingClientRect();
  const shellRect = shell?.getBoundingClientRect();
  if (container && rect && shellRect && drag.pointerY >= shellRect.top && drag.pointerY <= shellRect.bottom) {
    const edge = Math.min(42, Math.max(20, rect.width / 5));
    let amount = 0;
    if (drag.pointerX < rect.left + edge) amount = -10;
    else if (drag.pointerX > rect.right - edge) amount = 10;
    if (amount) {
      const previous = container.scrollLeft;
      container.scrollLeft += amount;
      if (container.scrollLeft !== previous) updateWorkspaceTabDropTarget(drag.pointerX, drag.pointerY);
    }
  }
  scheduleWorkspaceTabDockAutoScroll();
}

activateWorkspaceTabFromClick = function(event, key) {
  if (Date.now() < workspaceTabSuppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (workspaceGroupSelectionMode || (event.ctrlKey || event.metaKey) && !isMobileLayout()) {
    event.preventDefault();
    event.stopPropagation();
    toggleWorkspaceTabSelection(key);
    return;
  }
  clearWorkspaceTabSelection({render:false});
  activateTab(key);
};

beginWorkspaceTabDrag = function(event, key, tabElement=null) {
  if (event.button !== 0 || event.target.closest(".tab-close")) return;
  if (workspaceGroupSelectionMode) return;
  if (event.ctrlKey || event.metaKey) return;
  if (workspaceTabDrag) finishWorkspaceTabDrag(null, true);
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return;
  const sourceActiveTabKey = pane.activeTabKey;
  if (pane.activeTabKey !== key || focusedPaneId !== pane.id) activateTab(key);
  const tabNode = tabElement?.closest?.(".tab")
    || workspacePaneElement(pane.id)?.querySelector(`.tab[data-tab-key="${workspaceCssEscape(key)}"]`);
  if (!tabNode) return;
  workspaceTabDrag = {
    key,
    sourcePaneId:pane.id,
    sourceActiveTabKey,
    tab:tabNode,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    pointerX:event.clientX,
    pointerY:event.clientY,
    pointerType:event.pointerType || "",
    dragging:false,
    ghost:null,
    autoScrollFrame:0
  };
  try { tabNode.setPointerCapture?.(event.pointerId); } catch {}
  window.addEventListener("pointermove", moveWorkspaceTabDrag, {passive:false});
  window.addEventListener("pointerup", endWorkspaceTabDrag);
  window.addEventListener("pointercancel", cancelWorkspaceTabDrag);
  window.addEventListener("keydown", handleWorkspaceTabDragKeydown);
};

function refreshWorkspaceDraggedTab(drag) {
  const pane = workspaceFindPaneForTab(drag?.key);
  const liveTab = pane
    ? workspacePaneElement(pane.id)?.querySelector(`.tab[data-tab-key="${workspaceCssEscape(drag.key)}"]`)
    : null;
  if (!liveTab || liveTab === drag.tab) return;
  drag.tab.classList.remove("tab-dragging");
  drag.tab.removeAttribute("aria-grabbed");
  drag.tab = liveTab;
  if (drag.dragging) {
    liveTab.classList.add("tab-dragging");
    liveTab.setAttribute("aria-grabbed", "true");
  }
}

moveWorkspaceTabDrag = function(event) {
  const drag = workspaceTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  refreshWorkspaceDraggedTab(drag);
  drag.pointerX = event.clientX;
  drag.pointerY = event.clientY;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.dragging) {
    if (Math.hypot(deltaX, deltaY) < WORKSPACE_TAB_DRAG_THRESHOLD) return;
    if (isMobileLayout() && drag.pointerType === "touch" && Math.abs(deltaY) > Math.abs(deltaX)) {
      return finishWorkspaceTabDrag(event, true);
    }
    drag.dragging = true;
    drag.tab.classList.add("tab-dragging");
    drag.tab.setAttribute("aria-grabbed", "true");
    document.body.classList.add("workspace-tab-drag-active");
    createWorkspaceTabDragGhost(drag);
    hideTabContextMenu();
    scheduleWorkspaceTabDockAutoScroll();
  }
  event.preventDefault();
  updateWorkspaceTabDragGhost(event.clientX, event.clientY);
  updateWorkspaceTabDropTarget(event.clientX, event.clientY);
};

function applyWorkspaceTabDrop(drag, target) {
  const sourcePane = workspaceFindPaneForTab(drag.key);
  const targetPane = workspaceFindPane(target?.paneId);
  if (!sourcePane || !targetPane || !target) return false;
  const edgeDrop = ["left", "right", "top", "bottom"].includes(target.zone);
  if (edgeDrop && sourcePane.id === targetPane.id && sourcePane.tabs.length <= 1) return false;
  const sourceIndex = sourcePane.tabs.indexOf(drag.key);
  if (sourceIndex < 0) return false;
  sourcePane.tabs.splice(sourceIndex, 1);
  if (!sourcePane.tabs.includes(sourcePane.activeTabKey)) {
    // When the dragged tab was active, prefer the tab immediately to its left.
    // Falling back to the same index would select the tab that followed it,
    // unexpectedly switching a terminal pane after opening a split.
    const previousTab = sourcePane.tabs[sourceIndex - 1] || "";
    const rememberedActive = drag.sourceActiveTabKey && drag.sourceActiveTabKey !== drag.key && sourcePane.tabs.includes(drag.sourceActiveTabKey)
      ? drag.sourceActiveTabKey
      : "";
    const activeFallback = drag.sourceActiveTabKey === drag.key ? previousTab : "";
    sourcePane.activeTabKey = rememberedActive || activeFallback || sourcePane.tabs[Math.min(sourceIndex, sourcePane.tabs.length - 1)] || sourcePane.tabs.at(-1) || "";
  }

  let destinationPane = targetPane;
  if (edgeDrop) {
    const newPane = {type:"pane", id:workspaceNextPaneId(), tabs:[drag.key], activeTabKey:drag.key};
    const newFirst = ["left", "top"].includes(target.zone);
    const split = {
      type:"split",
      id:workspaceNextSplitId(),
      direction:["left", "right"].includes(target.zone) ? "row" : "column",
      ratio:0.5,
      first:newFirst ? newPane : targetPane,
      second:newFirst ? targetPane : newPane
    };
    workspaceLayout = workspaceReplacePaneWithSplit(targetPane.id, split);
    destinationPane = newPane;
  } else {
    let insertion = Number.isInteger(target.index) ? target.index : targetPane.tabs.length;
    insertion = Math.max(0, Math.min(targetPane.tabs.length, insertion));
    targetPane.tabs.splice(insertion, 0, drag.key);
    targetPane.activeTabKey = drag.key;
  }
  normalizeWorkspaceLayoutAfterMutation(destinationPane.id);
  focusedPaneId = destinationPane.id;
  activeTabKey = drag.key;
  const tab = tabs.find(item => item.key === drag.key);
  activeView = tab?.viewName || tab?.kind || "welcome";
  renderTabs({rebuildLayout:true});
  const sourceAfter = workspaceFindPane(sourcePane.id);
  if (sourceAfter?.activeTabKey && sourceAfter.id !== destinationPane.id) renderWorkspacePaneContent(sourceAfter.id);
  renderWorkspacePaneContent(destinationPane.id);
  revealWorkspaceTab(drag.key);
  syncFocusedWorkspaceClasses();
  return true;
}

finishWorkspaceTabDrag = function(event, cancelled) {
  const drag = workspaceTabDrag;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  window.removeEventListener("pointermove", moveWorkspaceTabDrag);
  window.removeEventListener("pointerup", endWorkspaceTabDrag);
  window.removeEventListener("pointercancel", cancelWorkspaceTabDrag);
  window.removeEventListener("keydown", handleWorkspaceTabDragKeydown);
  if (drag.autoScrollFrame) cancelAnimationFrame(drag.autoScrollFrame);
  try {
    if (drag.tab.hasPointerCapture?.(drag.pointerId)) drag.tab.releasePointerCapture(drag.pointerId);
  } catch {}
  const target = workspaceTabDropTarget;
  document.body.classList.remove("workspace-tab-drag-active");
  drag.tab.classList.remove("tab-dragging");
  drag.tab.removeAttribute("aria-grabbed");
  drag.ghost?.remove();
  workspaceClearDropIndicators();
  const dragged = drag.dragging;
  workspaceTabDrag = null;
  workspaceTabSuppressClickUntil = Date.now() + 350;
  if (!dragged) return;
  const applied = !cancelled && applyWorkspaceTabDrop(drag, target);
  if (!applied) renderTabs();
};

function beginWorkspaceSplitterDrag(event, splitId) {
  if (event.button !== 0 || isMobileLayout()) return;
  const split = workspaceFindSplit(splitId);
  const element = event.currentTarget.closest(".workspace-split");
  if (!split || !element) return;
  event.preventDefault();
  workspaceSplitterDrag = {splitId, pointerId:event.pointerId, element, separator:event.currentTarget};
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("workspace-split-resizing", split.direction === "row" ? "workspace-split-resizing-row" : "workspace-split-resizing-column");
  window.addEventListener("pointermove", moveWorkspaceSplitterDrag, {passive:false});
  window.addEventListener("pointerup", endWorkspaceSplitterDrag);
  window.addEventListener("pointercancel", endWorkspaceSplitterDrag);
}

function moveWorkspaceSplitterDrag(event) {
  const drag = workspaceSplitterDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const split = workspaceFindSplit(drag.splitId);
  if (!split) return;
  const rect = drag.element.getBoundingClientRect();
  const raw = split.direction === "row"
    ? (event.clientX - rect.left) / Math.max(1, rect.width)
    : (event.clientY - rect.top) / Math.max(1, rect.height);
  split.ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, raw));
  applyWorkspaceSplitGeometry(drag.element, split);
  event.preventDefault();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function endWorkspaceSplitterDrag(event) {
  const drag = workspaceSplitterDrag;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveWorkspaceSplitterDrag);
  window.removeEventListener("pointerup", endWorkspaceSplitterDrag);
  window.removeEventListener("pointercancel", endWorkspaceSplitterDrag);
  try {
    if (drag.separator.hasPointerCapture?.(drag.pointerId)) drag.separator.releasePointerCapture(drag.pointerId);
  } catch {}
  workspaceSplitterDrag = null;
  document.body.classList.remove("workspace-split-resizing", "workspace-split-resizing-row", "workspace-split-resizing-column");
  saveTabsState();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function setWorkspaceSplitRatio(splitId, ratio) {
  const split = workspaceFindSplit(splitId);
  if (!split) return;
  split.ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, ratio));
  const element = document.querySelector(`.workspace-split[data-split-id="${workspaceCssEscape(splitId)}"]`);
  if (element) applyWorkspaceSplitGeometry(element, split);
  saveTabsState();
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function handleWorkspaceSplitterKey(event, splitId) {
  const split = workspaceFindSplit(splitId);
  if (!split) return;
  const relevant = split.direction === "row" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (!relevant.includes(event.key)) return;
  event.preventDefault();
  const decrease = ["ArrowLeft", "ArrowUp"].includes(event.key);
  setWorkspaceSplitRatio(splitId, split.ratio + (decrease ? -0.025 : 0.025));
}
