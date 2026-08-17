let workspaceTabDrag = null;
let workspaceTabSuppressClickUntil = 0;
let legacyWorkspaceTabHistory = [];
const WORKSPACE_TAB_DRAG_THRESHOLD = 5;
const ACTIVITY_BAR_WIDTH_DEFAULT = 40;
const ACTIVITY_BAR_WIDTH_MIN = 36;
const ACTIVITY_BAR_WIDTH_MAX = 64;
let activityBarWidth = ACTIVITY_BAR_WIDTH_DEFAULT;
let activityBarResize = null;
let activityBarFitFrame = 0;
const OPERATION_PANE_WIDTH_DEFAULT = 292;
const OPERATION_PANE_WIDTH_MIN = 260;
const OPERATION_PANE_WIDTH_MAX = 520;
let operationPaneWidth = OPERATION_PANE_WIDTH_DEFAULT;
let operationPaneResize = null;
const OPERATION_PANE_PRIMARY_VIEWS = ["connections", "remote", "running", "command", "import", "logs", "settings"];
const WORKSPACE_SSH_CONNECTION_TAB_KINDS = new Set(["terminal", "sftp", "forwards", "dashboard", "linux-desktop"]);
const WORKSPACE_REMOTE_CONNECTION_TAB_KINDS = new Set(["remote-desktop", "remote-terminal", "ftp"]);
const OPERATION_PANE_PINNED_STORAGE_KEY = "operationPanePinnedByViewV1";
const OPERATION_PANE_PIN_GUIDE_STORAGE_KEY = "operationPanePinGuideSeenV3";
let operationPanePinGuideShown = false;
let mobilePaneView = "explorer";
let responsiveLayoutMobile = isMobileLayout();

function clampActivityBarWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return ACTIVITY_BAR_WIDTH_DEFAULT;
  return Math.max(ACTIVITY_BAR_WIDTH_MIN, Math.min(ACTIVITY_BAR_WIDTH_MAX, Math.round(numeric)));
}

function scheduleActivityBarFit() {
  if (activityBarFitFrame) return;
  activityBarFitFrame = requestAnimationFrame(() => {
    activityBarFitFrame = 0;
    if (typeof scheduleWorkspaceChromeFit === "function") {
      scheduleWorkspaceChromeFit();
      return;
    }
    if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
    if (typeof updateWorkspaceTabScrollControls === "function") updateWorkspaceTabScrollControls();
  });
}

function syncActivityBarResizeAria() {
  const handle = document.getElementById("activityBarResize");
  if (!handle) return;
  handle.setAttribute("aria-valuemin", String(ACTIVITY_BAR_WIDTH_MIN));
  handle.setAttribute("aria-valuemax", String(ACTIVITY_BAR_WIDTH_MAX));
  handle.setAttribute("aria-valuenow", String(activityBarWidth));
}

function applyActivityBarWidth(value, options={}) {
  activityBarWidth = clampActivityBarWidth(value);
  document.documentElement.style.setProperty("--activity-bar-width", `${activityBarWidth}px`);
  syncOperationPaneNarrowState();
  if (options.persist) {
    try { localStorage.setItem("activityBarWidth", String(activityBarWidth)); } catch {}
  }
  syncActivityBarResizeAria();
  if (options.fit !== false) scheduleActivityBarFit();
  return activityBarWidth;
}

function finishActivityBarResize(event, cancelled=false) {
  const drag = activityBarResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveActivityBarResize);
  window.removeEventListener("pointerup", finishActivityBarResize);
  window.removeEventListener("pointercancel", cancelActivityBarResize);
  window.removeEventListener("blur", finishActivityBarResizeOnBlur);
  activityBarResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("activity-bar-resizing");
  applyActivityBarWidth(cancelled ? drag.startValue : activityBarWidth, {persist:!cancelled});
}

function moveActivityBarResize(event) {
  const drag = activityBarResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applyActivityBarWidth(drag.startValue + event.clientX - drag.startX);
}

function cancelActivityBarResize(event) {
  finishActivityBarResize(event, true);
}

function finishActivityBarResizeOnBlur() {
  finishActivityBarResize(null);
}

function beginActivityBarResize(event) {
  if (event.button !== 0 || isMobileLayout()) return;
  if (activityBarResize) finishActivityBarResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  activityBarResize = {
    pointerId:event.pointerId,
    startX:event.clientX,
    startValue:activityBarWidth,
    handle:event.currentTarget
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("activity-bar-resizing");
  window.addEventListener("pointermove", moveActivityBarResize, {passive:false});
  window.addEventListener("pointerup", finishActivityBarResize);
  window.addEventListener("pointercancel", cancelActivityBarResize);
  window.addEventListener("blur", finishActivityBarResizeOnBlur);
}

function handleActivityBarResizeKey(event) {
  if (isMobileLayout()) return;
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const value = event.key === "Home"
    ? ACTIVITY_BAR_WIDTH_MIN
    : event.key === "End"
      ? ACTIVITY_BAR_WIDTH_MAX
      : activityBarWidth + direction * (event.shiftKey ? 4 : 1);
  applyActivityBarWidth(value, {persist:true});
}

function initActivityBarSizing() {
  let stored = ACTIVITY_BAR_WIDTH_DEFAULT;
  try { stored = localStorage.getItem("activityBarWidth") || ACTIVITY_BAR_WIDTH_DEFAULT; } catch {}
  applyActivityBarWidth(stored, {fit:false});
  const handle = document.getElementById("activityBarResize");
  if (!handle) return;
  handle.addEventListener("pointerdown", beginActivityBarResize);
  handle.addEventListener("pointercancel", cancelActivityBarResize);
  handle.addEventListener("lostpointercapture", finishActivityBarResize);
  handle.addEventListener("dblclick", event => {
    if (isMobileLayout()) return;
    event.preventDefault();
    applyActivityBarWidth(ACTIVITY_BAR_WIDTH_DEFAULT, {persist:true});
  });
  handle.addEventListener("keydown", handleActivityBarResizeKey);
  syncActivityBarResizeAria();
}

function clampOperationPaneWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return OPERATION_PANE_WIDTH_DEFAULT;
  return Math.max(OPERATION_PANE_WIDTH_MIN, Math.min(OPERATION_PANE_WIDTH_MAX, Math.round(numeric)));
}

function syncOperationPaneNarrowState() {
  document.documentElement.classList.toggle("operation-pane-narrow", operationPaneWidth - activityBarWidth < 228);
}

function syncOperationPaneResizeAria() {
  const handle = document.getElementById("operationPaneResize");
  if (!handle) return;
  handle.setAttribute("aria-valuemin", String(OPERATION_PANE_WIDTH_MIN));
  handle.setAttribute("aria-valuemax", String(OPERATION_PANE_WIDTH_MAX));
  handle.setAttribute("aria-valuenow", String(operationPaneWidth));
}

function applyOperationPaneWidth(value, options={}) {
  operationPaneWidth = clampOperationPaneWidth(value);
  document.documentElement.style.setProperty("--operation-pane-width", `${operationPaneWidth}px`);
  syncOperationPaneNarrowState();
  syncOperationPaneResizeAria();
  if (options.persist) {
    try { localStorage.setItem("operationPaneWidth", String(operationPaneWidth)); } catch {}
  }
  if (options.fit !== false) scheduleActivityBarFit();
  return operationPaneWidth;
}

function finishOperationPaneResize(event, cancelled=false) {
  const drag = operationPaneResize;
  if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  window.removeEventListener("pointermove", moveOperationPaneResize);
  window.removeEventListener("pointerup", finishOperationPaneResize);
  window.removeEventListener("pointercancel", cancelOperationPaneResize);
  window.removeEventListener("blur", finishOperationPaneResizeOnBlur);
  operationPaneResize = null;
  try {
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  } catch {}
  document.body.classList.remove("operation-pane-resizing");
  applyOperationPaneWidth(cancelled ? drag.startValue : operationPaneWidth, {persist:!cancelled});
}

function moveOperationPaneResize(event) {
  const drag = operationPaneResize;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  applyOperationPaneWidth(drag.startValue + event.clientX - drag.startX);
}

function cancelOperationPaneResize(event) {
  finishOperationPaneResize(event, true);
}

function finishOperationPaneResizeOnBlur() {
  finishOperationPaneResize(null);
}

function beginOperationPaneResize(event) {
  if (event.button !== 0 || isMobileLayout() || operationPaneCollapsed) return;
  if (operationPaneResize) finishOperationPaneResize(null, true);
  event.preventDefault();
  event.stopPropagation();
  operationPaneResize = {
    pointerId:event.pointerId,
    startX:event.clientX,
    startValue:operationPaneWidth,
    handle:event.currentTarget
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
  document.body.classList.add("operation-pane-resizing");
  window.addEventListener("pointermove", moveOperationPaneResize, {passive:false});
  window.addEventListener("pointerup", finishOperationPaneResize);
  window.addEventListener("pointercancel", cancelOperationPaneResize);
  window.addEventListener("blur", finishOperationPaneResizeOnBlur);
}

function handleOperationPaneResizeKey(event) {
  if (isMobileLayout() || operationPaneCollapsed) return;
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const value = event.key === "Home"
    ? OPERATION_PANE_WIDTH_MIN
    : event.key === "End"
      ? OPERATION_PANE_WIDTH_MAX
      : operationPaneWidth + direction * (event.shiftKey ? 16 : 4);
  applyOperationPaneWidth(value, {persist:true});
}

function initOperationPaneSizing() {
  let stored = OPERATION_PANE_WIDTH_DEFAULT;
  try { stored = localStorage.getItem("operationPaneWidth") || OPERATION_PANE_WIDTH_DEFAULT; } catch {}
  applyOperationPaneWidth(stored, {fit:false});
  const handle = document.getElementById("operationPaneResize");
  if (!handle) return;
  handle.addEventListener("pointerdown", beginOperationPaneResize);
  handle.addEventListener("pointercancel", cancelOperationPaneResize);
  handle.addEventListener("lostpointercapture", finishOperationPaneResize);
  handle.addEventListener("dblclick", event => {
    if (isMobileLayout()) return;
    event.preventDefault();
    applyOperationPaneWidth(OPERATION_PANE_WIDTH_DEFAULT, {persist:true});
  });
  handle.addEventListener("keydown", handleOperationPaneResizeKey);
  syncOperationPaneResizeAria();
}

function workspaceTabPresentation(tab) {
  const title = String(tab?.title || tr("navigation:auto.tab", {defaultValue:"标签"}));
  const savedProtocol = String(tab?.protocol || "").toLowerCase();
  const inferredProtocol = savedProtocol || (title.match(/\s*·\s*(RDP|VNC|XDMCP)\s*$/i)?.[1] || "").toLowerCase();
  const remoteDesktopProtocol = {
    rdp:{label:"RDP", letter:"R", marker:/\s*·\s*RDP\s*$/i},
    vnc:{label:"VNC", letter:"V", marker:/\s*·\s*VNC\s*$/i},
    xdmcp:{label:"XDMCP", letter:"X", marker:/\s*·\s*XDMCP\s*$/i}
  }[inferredProtocol];
  if (tab?.kind === "remote-desktop" && remoteDesktopProtocol) {
    const compactTitle = title.replace(remoteDesktopProtocol.marker, "").trim() || title;
    return {
      title:compactTitle,
      icon:`<span class="tab-kind-icon remote-desktop remote-protocol-${escAttr(inferredProtocol)}" aria-hidden="true">${icon("monitor")}<span class="tab-protocol-letter">${remoteDesktopProtocol.letter}</span></span>`
    };
  }
  const remoteIcons = {"remote-terminal":"square-terminal", "remote-desktop":"monitor", ftp:"folder-sync", "local-files":"hard-drive"};
  if (remoteIcons[tab?.kind]) return {title, icon:`<span class="tab-kind-icon ${escAttr(tab.kind)}" aria-hidden="true">${icon(remoteIcons[tab.kind])}</span>`};
  if (!["terminal", "quick-terminal", "sftp"].includes(tab?.kind)) return {title, icon:""};
  const terminal = ["terminal", "quick-terminal"].includes(tab.kind);
  const marker = terminal
    ? /\s*·\s*(?:终端|Terminal)(?=\s*(?:#\d+|·|$))/i
    : /\s*·\s*SFTP(?=\s*(?:#\d+|·|$))/i;
  return {
    title:title.replace(marker, "").trim(),
    icon:`<span class="tab-kind-icon ${tab.kind}${terminal ? " terminal" : ""}" aria-hidden="true">${icon(terminal ? "square-terminal" : "folder-open")}</span>`
  };
}

function localizedWorkspaceTabTitle(tab) {
  const title = String(tab?.title || "");
  if (tab?.key === "welcome") return tr("common:workspace.welcome_title", {defaultValue:"开始使用"});
  if (tab?.kind === "import") return tr("navigation:auto.import_export", {defaultValue:"导入导出"});
  if (tab?.kind === "settings") return tr("settings:title", {defaultValue:"设置"});
  if (tab?.kind === "command") return tr("terminal:batch.title", {defaultValue:"批量执行"});
  const terminalMarker = /\s*·\s*(?:终端|Terminal)(?=\s*(?:#\d+|·|$))/i;
  const quickTerminalMarker = /\s*·\s*(?:快速终端|Quick terminal)(?=\s*(?:#\d+|·|$))/i;
  const editMarker = /\s*·\s*(?:编辑|Edit)$/i;
  const forwardsMarker = /\s*·\s*(?:转发列表|Forwarding list)$/i;
  const dashboardMarker = /\s*·\s*(?:仪表盘|Dashboard)$/i;
  if (tab?.kind === "quick-terminal" && quickTerminalMarker.test(title)) {
    return title.replace(quickTerminalMarker, ` · ${tr("terminal:tabs.quick_generic", {defaultValue:"快速终端"})}`);
  }
  if (["terminal", "quick-terminal", "remote-terminal"].includes(tab?.kind) && terminalMarker.test(title)) {
    return title.replace(terminalMarker, ` · ${tr("navigation:auto.terminal", {defaultValue:"终端"})}`);
  }
  if (["edit", "remote-edit"].includes(tab?.kind) && editMarker.test(title)) {
    return title.replace(editMarker, ` · ${tr("common:actions.edit", {defaultValue:"编辑"})}`);
  }
  if (tab?.kind === "forwards" && forwardsMarker.test(title)) {
    return title.replace(forwardsMarker, ` · ${tr("navigation:auto.forward_list", {defaultValue:"转发列表"})}`);
  }
  if (tab?.kind === "dashboard" && dashboardMarker.test(title)) {
    const name = title.replace(dashboardMarker, "").trim();
    return tr("connections:health.dashboard_title", {name, defaultValue:`${name} · 仪表盘`});
  }
  return title;
}

function localizedWorkspaceTabSubtitle(tab) {
  const subtitle = String(tab?.subtitle || "");
  return typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(subtitle) : subtitle;
}

function workspaceTabConnectionStateText(status) {
  if (!status) return "";
  const normalized = status === "connected" ? "connected" : status === "disconnected" ? "disconnected" : "connecting";
  return tr(`common:auto.${normalized}`, {
    defaultValue:normalized === "connected" ? "已连接" : normalized === "disconnected" ? "已断开" : "连接中"
  });
}

function renderTabs() {
  if (typeof syncSftpTabTitles === "function") syncSftpTabTitles();
  const container = $("tabs");
  const previousScrollLeft = container.scrollLeft;
  container.innerHTML = tabs.map(tab => {
    const localizedTitle = localizedWorkspaceTabTitle(tab);
    const presentation = workspaceTabPresentation({...tab, title:localizedTitle});
    const fullTitle = [localizedTitle, localizedWorkspaceTabSubtitle(tab)].filter(Boolean).join(" - ");
    const showsConnectionStatus = ["terminal", "quick-terminal", "sftp", "remote-terminal"].includes(tab.kind)
      || (tab.kind === "remote-desktop" && tab.protocol === "vnc");
    const connectionStatus = showsConnectionStatus ? (tab.connectionStatus || "connecting") : "";
    const connectionStateText = workspaceTabConnectionStateText(connectionStatus);
    const connectionDot = connectionStatus ? `<span class="tab-connection-dot ${connectionStatus}" title="${escAttr(connectionStateText)}" aria-hidden="true"></span>` : "";
    const closeText = tr("navigation:auto.close_tab", {defaultValue:"关闭标签"});
    const accessibleLabel = [localizedTitle, connectionStateText].filter(Boolean).join(" · ");
    return `<button class="tab ${tab.key === activeTabKey ? "active" : ""}" data-tab-key="${escAttr(tab.key)}" data-kind="${escAttr(tab.kind || "")}" title="${escAttr(fullTitle)}" aria-label="${escAttr(accessibleLabel)}" data-pointerdown-action="workspace-tab-drag-start" data-action="workspace-tab-activate" data-contextmenu-action="workspace-tab-menu" data-dragover-action="workspace-tab-sftp-drag-over" data-dragleave-action="workspace-tab-sftp-drag-leave" data-drop-action="workspace-tab-sftp-drop">${connectionDot}${presentation.icon}<span class="tab-title">${esc(presentation.title)}</span>${tab.closable ? `<span class="tab-close" title="${escAttr(closeText)}" aria-label="${escAttr(closeText)}" data-tab-key="${escAttr(tab.key)}" data-pointerdown-action="workspace-event-stop" data-action="workspace-tab-close">x</span>` : ""}</button>`;
  }).join("");
  container.scrollLeft = previousScrollLeft;
  requestAnimationFrame(updateWorkspaceTabScrollControls);
  if (!window.restoringTabs) saveTabsState();
}

function updateWorkspaceTabScrollControls() {
  const container = document.getElementById("tabs");
  const left = document.getElementById("tabsScrollLeft");
  const right = document.getElementById("tabsScrollRight");
  if (!container || !left || !right) return;
  const availableWidth = container.closest(".tabs-shell")?.clientWidth || container.clientWidth;
  const overflowing = container.scrollWidth > availableWidth + 1;
  left.hidden = !overflowing;
  right.hidden = !overflowing;
  left.disabled = !overflowing || container.scrollLeft <= 1;
  right.disabled = !overflowing || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  document.querySelector(".tabs-shell")?.classList.toggle("overflowing", overflowing);
}

function scrollWorkspaceTabs(direction) {
  const container = $("tabs");
  if (!container) return;
  container.scrollBy({left:direction * Math.max(160, container.clientWidth * .7), behavior:"smooth"});
}

function handleWorkspaceTabsWheel(event) {
  const container = $("tabs");
  if (!container || container.scrollWidth <= container.clientWidth + 1) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const canScroll = delta < 0 ? container.scrollLeft > 0 : container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
  if (!delta || !canScroll) return;
  event.preventDefault();
  container.scrollLeft += delta;
}

function revealWorkspaceTab(key) {
  requestAnimationFrame(() => {
    const container = $("tabs");
    const tab = [...container.querySelectorAll(".tab")].find(item => item.dataset.tabKey === key);
    if (!tab) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.left < containerRect.left) container.scrollLeft -= containerRect.left - tabRect.left;
    else if (tabRect.right > containerRect.right) container.scrollLeft += tabRect.right - containerRect.right;
    updateWorkspaceTabScrollControls();
  });
}

window.addEventListener("resize", () => requestAnimationFrame(updateWorkspaceTabScrollControls));

function activateWorkspaceTabFromClick(event, key) {
  if (Date.now() < workspaceTabSuppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  activateTab(key);
}

function beginWorkspaceTabDrag(event, key) {
  if (event.button !== 0 || event.target.closest(".tab-close")) return;
  if (workspaceTabDrag) finishWorkspaceTabDrag(null, true);
  if (activeTabKey !== key) activateTab(key);
  const tab = [...$("tabs").querySelectorAll(".tab")].find(item => item.dataset.tabKey === key);
  if (!tab) return;
  workspaceTabDrag = {
    key,
    tab,
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    pointerX:event.clientX,
    pointerY:event.clientY,
    dragging:false,
    ghost:null,
    autoScrollFrame:0
  };
  try { tab.setPointerCapture?.(event.pointerId); } catch {}
  window.addEventListener("pointermove", moveWorkspaceTabDrag, {passive:false});
  window.addEventListener("pointerup", endWorkspaceTabDrag);
  window.addEventListener("pointercancel", cancelWorkspaceTabDrag);
  window.addEventListener("keydown", handleWorkspaceTabDragKeydown);
}

function moveWorkspaceTabDrag(event) {
  const drag = workspaceTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.pointerX = event.clientX;
  drag.pointerY = event.clientY;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (!drag.dragging) {
    if (Math.abs(deltaX) < WORKSPACE_TAB_DRAG_THRESHOLD && Math.abs(deltaY) < WORKSPACE_TAB_DRAG_THRESHOLD) return;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return finishWorkspaceTabDrag(event, true);
    drag.dragging = true;
    drag.tab.classList.add("tab-dragging");
    drag.tab.setAttribute("aria-grabbed", "true");
    document.body.classList.add("workspace-tab-drag-active");
    createWorkspaceTabDragGhost(drag);
    hideTabContextMenu();
    scheduleWorkspaceTabAutoScroll();
  }
  event.preventDefault();
  updateWorkspaceTabDragGhost(event.clientX, event.clientY);
  reorderWorkspaceTabElement(event.clientX);
}

function createWorkspaceTabDragGhost(drag) {
  const tab = tabs.find(item => item.key === drag.key);
  const presentation = workspaceTabPresentation({...tab, title:localizedWorkspaceTabTitle(tab)});
  const ghost = document.createElement("div");
  ghost.className = "workspace-tab-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = `${presentation.icon || icon("grip-vertical")}<span>${esc(presentation.title || drag.tab.textContent.trim())}</span>`;
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  updateWorkspaceTabDragGhost(drag.pointerX, drag.pointerY);
}

function updateWorkspaceTabDragGhost(clientX, clientY) {
  const ghost = workspaceTabDrag?.ghost;
  if (!ghost) return;
  const rect = ghost.getBoundingClientRect();
  const gap = 12;
  const left = Math.max(8, Math.min(clientX - rect.width / 2, window.innerWidth - rect.width - 8));
  const preferredTop = clientY - rect.height - gap;
  const top = preferredTop >= 8 ? preferredTop : Math.min(clientY + gap, window.innerHeight - rect.height - 8);
  ghost.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
}

function reorderWorkspaceTabElement(clientX) {
  const drag = workspaceTabDrag;
  const container = $("tabs");
  if (!drag?.dragging || !container) return;
  const siblings = [...container.querySelectorAll(".tab:not(.tab-dragging)")];
  const before = siblings.find(tab => {
    const rect = tab.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  if (before) container.insertBefore(drag.tab, before);
  else container.appendChild(drag.tab);
}

function scheduleWorkspaceTabAutoScroll() {
  const drag = workspaceTabDrag;
  if (!drag?.dragging || drag.autoScrollFrame) return;
  drag.autoScrollFrame = requestAnimationFrame(updateWorkspaceTabAutoScroll);
}

function updateWorkspaceTabAutoScroll() {
  const drag = workspaceTabDrag;
  const container = $("tabs");
  if (!drag?.dragging || !container) return;
  drag.autoScrollFrame = 0;
  const rect = container.getBoundingClientRect();
  const edge = Math.min(42, rect.width / 4);
  let amount = 0;
  if (drag.pointerX < rect.left + edge) amount = -10;
  else if (drag.pointerX > rect.right - edge) amount = 10;
  if (amount) {
    const previous = container.scrollLeft;
    container.scrollLeft += amount;
    if (container.scrollLeft !== previous) reorderWorkspaceTabElement(drag.pointerX);
  }
  scheduleWorkspaceTabAutoScroll();
}

function endWorkspaceTabDrag(event) {
  finishWorkspaceTabDrag(event, false);
}

function cancelWorkspaceTabDrag(event) {
  finishWorkspaceTabDrag(event, true);
}

function handleWorkspaceTabDragKeydown(event) {
  if (event.key === "Escape") finishWorkspaceTabDrag(null, true);
}

function finishWorkspaceTabDrag(event, cancelled) {
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
  document.body.classList.remove("workspace-tab-drag-active");
  drag.ghost?.remove();
  const dragged = drag.dragging;
  if (dragged && !cancelled) {
    const order = [...$("tabs").querySelectorAll(".tab")].map(tab => tab.dataset.tabKey);
    const byKey = new Map(tabs.map(tab => [tab.key, tab]));
    if (order.length === tabs.length && order.every(key => byKey.has(key))) tabs = order.map(key => byKey.get(key));
  }
  workspaceTabDrag = null;
  workspaceTabSuppressClickUntil = Date.now() + 350;
  if (!dragged) return;
  renderTabs();
  [...$("tabs").querySelectorAll(".tab")].find(tab => tab.dataset.tabKey === drag.key)?.focus({preventScroll:true});
}

function moveWorkspaceTab(key, offset) {
  const index = tabs.findIndex(tab => tab.key === key);
  const target = Math.max(0, Math.min(tabs.length - 1, index + offset));
  if (index < 0 || target === index) return hideTabContextMenu();
  const [tab] = tabs.splice(index, 1);
  tabs.splice(target, 0, tab);
  hideTabContextMenu();
  renderTabs();
  [...$("tabs").querySelectorAll(".tab")].find(item => item.dataset.tabKey === key)?.focus({preventScroll:true});
}

function rememberLegacyWorkspaceTab(key, previousKey=activeTabKey) {
  const available = new Set(tabs.map(tab => tab.key));
  legacyWorkspaceTabHistory = legacyWorkspaceTabHistory.filter(tabKey => available.has(tabKey) && tabKey !== previousKey && tabKey !== key);
  if (previousKey && previousKey !== key && available.has(previousKey)) legacyWorkspaceTabHistory.push(previousKey);
  if (key && available.has(key)) legacyWorkspaceTabHistory.push(key);
}

function recentLegacyWorkspaceTab(excludedKeys) {
  const available = new Set(tabs.map(tab => tab.key));
  legacyWorkspaceTabHistory = legacyWorkspaceTabHistory.filter(key => available.has(key));
  for (let index = legacyWorkspaceTabHistory.length - 1; index >= 0; index -= 1) {
    const key = legacyWorkspaceTabHistory[index];
    if (!excludedKeys.has(key)) return key;
  }
  return "";
}

function addTab(key, title, subtitle, viewName, closable=true, meta={}) {
  const previousKey = activeTabKey;
  if (key !== "welcome") tabs = tabs.filter(tab => tab.key !== "welcome");
  if (key === "welcome" && tabs.some(tab => tab.key !== "welcome")) return;
  const found = tabs.find(tab => tab.key === key);
  if (found) Object.assign(found, {title, subtitle, viewName, closable, ...meta});
  else {
    const insertion = tabs.findIndex(tab => tab.key === previousKey);
    tabs.splice(insertion >= 0 ? insertion + 1 : tabs.length, 0, {key, title, subtitle, viewName, closable, ...meta});
  }
  rememberLegacyWorkspaceTab(key, previousKey);
  activeTabKey = key;
  renderTabs();
  revealWorkspaceTab(key);
}

function setWorkspaceTabConnectionStatus(key, status) {
  const normalized = ["connected", "disconnected", "connecting"].includes(status) ? status : "disconnected";
  const tab = tabs.find(item => item.key === key);
  if (!tab) return;
  tab.connectionStatus = normalized;
  const node = [...$("tabs").querySelectorAll(".tab")].find(item => item.dataset.tabKey === key);
  const dot = node?.querySelector(".tab-connection-dot");
  if (!dot) return renderTabs();
  dot.className = `tab-connection-dot ${normalized}`;
  const connectionStateText = workspaceTabConnectionStateText(normalized);
  dot.title = connectionStateText;
  node.setAttribute("aria-label", [localizedWorkspaceTabTitle(tab), connectionStateText].filter(Boolean).join(" · "));
}

function renderTabContent(tab) {
  if (tab.kind === "terminal") return openTerminal(tab.id, false, tab.key, tab.title);
  if (tab.kind === "quick-terminal") return restoreQuickTerminalTab(tab);
  if (tab.kind === "forwards") return openForwards(tab.id, false);
  if (tab.kind === "edit") return editConnection(tab.id, false);
  if (tab.kind === "import") return showImport(false);
  if (tab.kind === "log") return openLog(tab.path, tab.title, false);
  if (tab.kind === "command") return openBatchCommand(false);
  if (tab.kind === "sftp") return openSftp(tab.id, tab.path || ".", false, tab.key);
  if (tab.kind === "dashboard") return openServerDashboard(tab.id, false);
  if (tab.kind === "remote-edit") return tab.id ? editRemoteProfile(tab.id, false) : newRemoteProfile(tab.protocol || "rdp");
  if (tab.kind === "remote-desktop") return openRemoteDesktop(tab.id, false);
  if (tab.kind === "linux-desktop") {
    const connectionId = Number(tab.id || String(tab.key || "").match(/^linux-desktop-(\d+)$/)?.[1] || 0);
    return openLinuxDesktopManager(connectionId, false);
  }
  if (tab.kind === "remote-terminal") return openRemoteTerminal(tab.id, false, tab.key, tab.title);
  if (tab.kind === "ftp") return openFtpProfile(tab.id, tab.path || "/", false, tab.key);
  if (tab.kind === "settings") return openSettings(false);
  return setWorkspace(tab.title, tab.subtitle, tab.viewName, tab.key, false, tab.closable);
}

function activateTab(key) {
  const tab = tabs.find(item => item.key === key);
  if (!tab) return;
  const previousTab = tabs.find(item => item.key === activeTabKey);
  if (previousTab?.kind === "command" && previousTab.key !== key && typeof rememberBatchCommandDraft === "function") {
    rememberBatchCommandDraft(currentBatchRoot(), previousTab.key);
  }
  if (activeView === "sftp" && activeTabKey !== key && typeof rememberSftpViewState === "function") {
    rememberSftpViewState(activeTabKey);
  }
  rememberLegacyWorkspaceTab(key, activeTabKey);
  activeTabKey = key;
  renderTabs();
  revealWorkspaceTab(key);
  renderTabContent(tab);
}

function closeTab(event, key) {
  event.stopPropagation();
  closeTabsByKey([key], key);
}

function closeTabsByKey(keys, anchorKey="") {
  const targets = new Set(keys);
  const previousTabs = [...tabs];
  const anchorIndex = Math.max(0, previousTabs.findIndex(tab => tab.key === anchorKey));
  const recentKey = targets.has(activeTabKey) ? recentLegacyWorkspaceTab(targets) : "";
  for (const key of targets) {
    closeTerminalSession(key);
    if (typeof closeRemoteProtocolSession === "function") closeRemoteProtocolSession(key);
    if (typeof ftpProfileStates !== "undefined") ftpProfileStates.delete(key);
    if (String(key).startsWith("sftp-") && typeof closeSftpSession === "function") closeSftpSession(key);
    sftpDisconnectedTabs.delete(key);
    sftpViewStates.delete(key);
    if (typeof clearSftpDirectoryViewCache === "function") clearSftpDirectoryViewCache(key);
    if (key === "command") {
      stopBatchCommand(key);
      if (typeof resetBatchCommandDraft === "function") resetBatchCommandDraft(key);
    }
  }
  tabs = tabs.filter(tab => !targets.has(tab.key));
  legacyWorkspaceTabHistory = legacyWorkspaceTabHistory.filter(key => tabs.some(tab => tab.key === key));
  if (!targets.has(activeTabKey)) return renderTabs();
  const previousKeys = previousTabs.map(tab => tab.key);
  const fallbackKey = [recentKey, previousKeys[anchorIndex], ...previousKeys.slice(0, anchorIndex).reverse(), ...previousKeys.slice(anchorIndex + 1)]
    .find(key => !targets.has(key) && tabs.some(tab => tab.key === key));
  if (fallbackKey) activateTab(fallbackKey);
  else renderWelcome();
}

function closeTabsByMode(mode, key) {
  const index = tabs.findIndex(tab => tab.key === key);
  if (index < 0) return;
  const closable = tabs.filter(tab => tab.closable);
  let targets = [];
  if (mode === "current") targets = closable.filter(tab => tab.key === key);
  if (mode === "others") targets = closable.filter(tab => tab.key !== key);
  if (mode === "right") targets = tabs.slice(index + 1).filter(tab => tab.closable);
  if (mode === "all") targets = closable;
  hideTabContextMenu();
  if (targets.length) closeTabsByKey(targets.map(tab => tab.key), key);
}

function hideTabContextMenu() {
  $("tabContextMenu")?.remove();
}

function workspaceTabConnectionEditAction(tab) {
  const id = Number(tab?.id || 0);
  if (!Number.isInteger(id) || id <= 0 || tab?.quick_connection || tab?.transient) return null;
  if (WORKSPACE_SSH_CONNECTION_TAB_KINDS.has(tab.kind)) return () => editConnection(id);
  if (WORKSPACE_REMOTE_CONNECTION_TAB_KINDS.has(tab.kind)) return () => editRemoteProfile(id);
  return null;
}

function showTabContextMenu(event, key) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const tab = tabs.find(item => item.key === key);
  const index = tabs.findIndex(item => item.key === key);
  if (!tab || index < 0) return;
  const editConnectionAction = workspaceTabConnectionEditAction(tab);
  const options = [
    ...(editConnectionAction ? [[tr("common:command_palette.edit_connection", {defaultValue:"编辑连接"}), () => { hideTabContextMenu(); editConnectionAction(); }, true]] : []),
    [tr("common:auto.move_left", {defaultValue:"向左移动"}), () => moveWorkspaceTab(key, -1), index > 0],
    [tr("common:auto.move_right", {defaultValue:"向右移动"}), () => moveWorkspaceTab(key, 1), index < tabs.length - 1],
    [tr("common:auto.close_current_tab", {defaultValue:"关闭当前标签"}), () => closeTabsByMode("current", key), Boolean(tab.closable)],
    [tr("common:auto.close_other_tabs", {defaultValue:"关闭其他标签"}), () => closeTabsByMode("others", key), tabs.some(item => item.closable && item.key !== key)],
    [tr("common:auto.close_right_tabs", {defaultValue:"关闭右侧标签"}), () => closeTabsByMode("right", key), tabs.slice(index + 1).some(item => item.closable)],
    [tr("common:auto.close_all_tabs", {defaultValue:"关闭所有标签"}), () => closeTabsByMode("all", key), tabs.some(item => item.closable)]
  ];
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  menu.setAttribute("role", "menu");
  for (const [label, action, enabled] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("role", "menuitem");
    button.disabled = !enabled;
    button.onclick = action;
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
}

function persistableTabs() {
  return tabs.filter(tab => tab.kind && !tab.transient && tab.kind !== "quick-terminal").map(({key,title,subtitle,viewName,closable,kind,id,path,protocol}) => ({key,title,subtitle,viewName,closable,kind,id,path,protocol}));
}

function saveTabsState() {
  if (window.workspaceRestorePending) return;
  try {
    localStorage.setItem("workspaceTabs", JSON.stringify({activeTabKey, tabs:persistableTabs()}));
  } catch {}
}

function restoreTabsState() {
  try {
    if (runtimeSettings?.saved?.restore_workspace_tabs === false) return false;
    const saved = JSON.parse(localStorage.getItem("workspaceTabs") || "{}");
    const restored = (saved.tabs || []).filter(tab => tab.kind);
    if (!restored.length) return false;
    window.restoringTabs = true;
    tabs = restored;
    activeTabKey = restored.some(tab => tab.key === saved.activeTabKey) ? saved.activeTabKey : restored[0].key;
    legacyWorkspaceTabHistory = activeTabKey ? [activeTabKey] : [];
    renderTabs();
    revealWorkspaceTab(activeTabKey);
    renderTabContent(tabs.find(tab => tab.key === activeTabKey) || tabs[0]);
    window.restoringTabs = false;
    saveTabsState();
    return true;
  } catch {
    window.restoringTabs = false;
    return false;
  }
}

function closeTerminalSession(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const quickConnectionId = session.connection?.quick_connection ? Number(session.connection.id || 0) : 0;
  session.connectionAttempt = Number(session.connectionAttempt || 0) + 1;
  if (typeof cancelTerminalCursorCopy === "function") cancelTerminalCursorCopy(session, key);
  if (typeof closeTerminalZmodem === "function") closeTerminalZmodem(session);
  try { session.socket?.close(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  try { session.resizeObserver?.disconnect(); } catch {}
  try { session.globalLinkDisposable?.dispose(); } catch {}
  try { session.globalSelectionDisposable?.dispose(); } catch {}
  if (typeof cancelTerminalOutputQueue === "function") cancelTerminalOutputQueue(session);
  try { session.term?.dispose(); } catch {}
  clearTimeout(session.latencyPendingTimer);
  clearTimeout(session.autoCopyTimer);
  terminalSessions.delete(key);
  if (typeof quickTerminalConnections !== "undefined") quickTerminalConnections.delete(key);
  if (typeof terminalStartupOverrides !== "undefined") terminalStartupOverrides.delete(key);
  if (quickConnectionId < 0 && typeof releaseQuickConnectionIfUnused === "function") {
    queueMicrotask(() => releaseQuickConnectionIfUnused(quickConnectionId));
  }
}

function workspaceDocumentEndpoint(subtitle="") {
  const value = String(subtitle || "").trim();
  if (!value) return "";
  const resource = value.includes("·") ? value.split("·").at(-1).trim() : value;
  const address = resource.includes("@") ? resource.slice(resource.lastIndexOf("@") + 1) : resource;
  return address.replace(/^\w+:\/\//, "").replace(/\/$/, "");
}

function workspaceDocumentResourceIdentity(value="") {
  let identity = String(value || "").trim().toLowerCase().replace(/^\w+:\/\//, "").replace(/\/$/, "");
  if (identity.includes("@")) identity = identity.slice(identity.lastIndexOf("@") + 1);
  if (/^\[[^\]]+\](?::\d+)?$/.test(identity)) return identity.replace(/^\[|\](?::\d+)?$/g, "");
  if ((identity.match(/:/g) || []).length === 1) identity = identity.replace(/:\d+$/, "");
  return identity;
}

function syncWorkspaceDocumentTitle(title, subtitle, viewName, key=viewName, meta={}) {
  const tab = tabs.find(item => item.key === key) || {};
  const kind = String(meta.kind || tab.kind || viewName || "");
  const protocol = String(meta.protocol || tab.protocol || "").toUpperCase();
  const label = {
    terminal:tr("navigation:auto.terminal", {defaultValue:"终端"}),
    "remote-terminal":tr("navigation:auto.terminal", {defaultValue:"终端"}),
    sftp:"SFTP",
    ftp:"FTP",
    "remote-desktop":protocol || tr("remote:auto.remote_desktop", {defaultValue:"远程桌面"})
  }[kind] || "";
  const endpoint = workspaceDocumentEndpoint(subtitle || tab.subtitle || "");
  const resource = workspaceTabPresentation({...tab, ...meta, kind, protocol:protocol.toLowerCase(), title:String(title || tab.title || "").trim()}).title.trim();
  const uniqueResource = resource
    && workspaceDocumentResourceIdentity(resource) !== workspaceDocumentResourceIdentity(endpoint)
    && resource.toLowerCase() !== label.toLowerCase()
    ? resource
    : "";
  const parts = ["Terma", endpoint, label, uniqueResource].filter(Boolean);
  document.title = parts.join(" · ");
  window.termaDesktop?.setWindowTitle?.(document.title);
}

function setWorkspace(title, subtitle, viewName, key=viewName, updateTab=true, closable=true, meta={}) {
  if (activeView === "sftp" && activeTabKey !== key && typeof rememberSftpViewState === "function") {
    rememberSftpViewState(activeTabKey);
  }
  if (updateTab) addTab(key, title, subtitle, viewName, closable, meta);
  $("workspaceTitle").textContent = tr("navigation:auto.workspace", {defaultValue:"工作区"});
  $("workspaceSubtitle").textContent = subtitle || "";
  document.querySelectorAll(".view").forEach(v => v.hidden = true);
  $(`view-${viewName}`).hidden = false;
  document.querySelector(".workspace")?.classList.toggle("terminal-workspace", viewName === "terminal");
  $("content")?.classList.toggle("terminal-content", ["terminal","remote-terminal"].includes(viewName));
  $("content")?.classList.toggle("sftp-content", ["sftp","ftp"].includes(viewName));
  document.body.classList.toggle("mobile-terminal-active", isMobileLayout() && ["terminal","remote-terminal"].includes(viewName));
  activeView = viewName;
  syncWorkspaceDocumentTitle(title, subtitle, viewName, key, meta);
  if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement();
  if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement();
  if (isMobileLayout() && viewName !== "welcome" && !window.restoringTabs) showMobileWorkspace();
}

function showPrimary(name, togglePane=false) {
  const shouldTogglePane = togglePane && !isMobileLayout();
  const nextPaneCollapsed = shouldTogglePane
    ? (name === primaryView ? !operationPaneCollapsed : false)
    : operationPaneCollapsed;
  primaryView = name;
  $("navConnections").classList.toggle("active", name === "connections");
  $("navRemote")?.classList.toggle("active", name === "remote");
  $("navImport").classList.toggle("active", name === "import");
  $("navRunning").classList.toggle("active", name === "running");
  $("navCommand").classList.toggle("active", name === "command");
  $("navLogs").classList.toggle("active", name === "logs");
  $("navSettings")?.classList.toggle("active", name === "settings");
  $("sideConnections").classList.toggle("active", name === "connections");
  $("sideRemote")?.classList.toggle("active", name === "remote");
  $("sideImport").classList.toggle("active", name === "import");
  $("mobileConnections").classList.toggle("active", name === "connections");
  $("mobileRemote")?.classList.toggle("active", name === "remote");
  $("mobileImport").classList.toggle("active", name === "import");
  $("mobileRunning").classList.toggle("active", name === "running");
  $("mobileCommand").classList.toggle("active", name === "command");
  $("mobileLogs").classList.toggle("active", name === "logs");
  $("mobileSettings")?.classList.toggle("active", name === "settings");
  if (typeof syncTermaLiquidNavigation === "function") syncTermaLiquidNavigation();
  if (shouldTogglePane) setOperationPaneCollapsed(nextPaneCollapsed);
  renderExplorerTools();
  if (name === "import") {
    if (isMobileLayout()) showMobileExplorer();
    else if (activeView !== "import") showImport();
    else showImportSection(activeImportSection, {moveToWorkspace:false});
  } else if (name === "running") {
    if (isMobileLayout()) showMobileExplorer();
    renderRunningForwards();
  } else if (name === "command") {
    renderCommandTemplates().catch(e=>notify(e.message,"error"));
    if (isMobileLayout()) showMobileExplorer();
    else openBatchCommand();
  } else if (name === "logs") {
    if (isMobileLayout()) showMobileExplorer();
    renderLogs().catch(e=>notify(e.message,"error"));
  } else if (name === "settings") {
    if (isMobileLayout()) showMobileExplorer();
    else if (activeView !== "settings") openSettings();
    else showSettingsSection(activeSettingsSection, {moveToWorkspace:false});
  } else {
    if (isMobileLayout()) showMobileExplorer();
    else document.querySelector(".left-pane").classList.remove("mobile-hide");
    renderConnections();
  }
}

function setExplorerSectionActive(sectionId) {
  document.querySelectorAll("#explorerTools [data-explorer-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.explorerSection === sectionId);
  });
  if (typeof syncTermaLiquidNavigation === "function") syncTermaLiquidNavigation();
}

function loadOperationPanePinnedState() {
  let stored = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(OPERATION_PANE_PINNED_STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
  } catch {}
  return Object.fromEntries(OPERATION_PANE_PRIMARY_VIEWS.map(name => [name, stored[name] !== false]));
}

function saveOperationPanePinnedState() {
  const stored = Object.fromEntries(OPERATION_PANE_PRIMARY_VIEWS.map(name => [name, operationPanePinnedByView?.[name] !== false]));
  try { localStorage.setItem(OPERATION_PANE_PINNED_STORAGE_KEY, JSON.stringify(stored)); } catch {}
}

function isOperationPanePinned(name=primaryView) {
  if (!OPERATION_PANE_PRIMARY_VIEWS.includes(name)) return true;
  return operationPanePinnedByView?.[name] !== false;
}

function dismissOperationPanePinGuide() {
  const guide = document.getElementById("operationPanePinGuide");
  if (guide) guide.hidden = true;
}

function positionOperationPanePinGuide() {
  const guide = document.getElementById("operationPanePinGuide");
  const button = document.getElementById("operationPanePin");
  if (!guide || !button || guide.hidden) return;
  const guideRect = guide.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const anchor = buttonRect.left + buttonRect.width / 2 - guideRect.left;
  const clamped = Math.max(18, Math.min(guideRect.width - 18, anchor));
  guide.style.setProperty("--operation-pane-pin-guide-anchor", `${clamped}px`);
}

function maybeShowOperationPanePinGuide() {
  if (operationPanePinGuideShown || isMobileLayout() || operationPaneCollapsed) return;
  try {
    if (localStorage.getItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY) === "1") return;
  } catch {}
  const guide = document.getElementById("operationPanePinGuide");
  if (!guide) return;
  operationPanePinGuideShown = true;
  guide.hidden = false;
  positionOperationPanePinGuide();
  requestAnimationFrame(positionOperationPanePinGuide);
  try { localStorage.setItem(OPERATION_PANE_PIN_GUIDE_STORAGE_KEY, "1"); } catch {}
}

function syncOperationPanePinButton() {
  const button = document.getElementById("operationPanePin");
  if (!button) return;
  const pinned = isOperationPanePinned();
  const iconName = pinned ? "pin" : "pin-off";
  const label = pinned
    ? tr("common:auto.operation_pane_pinned", {defaultValue:"操作区已固定；点击改为自动收起"})
    : tr("common:workspace.operation_pane_auto_collapse", {defaultValue:"点击工作区后自动收起；点击固定"});
  if (button.dataset.icon !== iconName) {
    button.dataset.icon = iconName;
    button.innerHTML = icon(iconName);
  }
  button.classList.toggle("is-pinned", pinned);
  button.setAttribute("aria-pressed", pinned ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.title = label;
  positionOperationPanePinGuide();
}

function setOperationPanePinned(pinned, name=primaryView) {
  if (!OPERATION_PANE_PRIMARY_VIEWS.includes(name)) return;
  operationPanePinnedByView[name] = Boolean(pinned);
  saveOperationPanePinnedState();
  dismissOperationPanePinGuide();
  syncOperationPanePinButton();
}

function toggleOperationPanePinned() {
  setOperationPanePinned(!isOperationPanePinned());
}

function handleOperationPaneContentClick(event) {
  if (isMobileLayout() || event.button !== 0) return;
  dismissOperationPanePinGuide();
  if (!operationPaneCollapsed && !isOperationPanePinned()) setOperationPaneCollapsed(true);
}

function initOperationPaneBehavior() {
  const content = document.getElementById("content");
  if (!content || content.dataset.operationPaneBehaviorBound === "1") return;
  content.dataset.operationPaneBehaviorBound = "1";
  content.addEventListener("click", handleOperationPaneContentClick, true);
  window.addEventListener("resize", positionOperationPanePinGuide);
}

function syncOperationPaneState() {
  const mobile = isMobileLayout();
  const collapsed = operationPaneCollapsed && !mobile;
  document.querySelector(".app")?.classList.toggle("operation-pane-collapsed", collapsed);
  document.querySelectorAll(".activity-top > button").forEach(button => {
    if (button.classList.contains("active")) button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    else button.removeAttribute("aria-expanded");
  });
  syncOperationPanePinButton();
  if (mobile || collapsed) dismissOperationPanePinGuide();
  else maybeShowOperationPanePinGuide();
}

function setOperationPaneCollapsed(collapsed) {
  operationPaneCollapsed = Boolean(collapsed);
  localStorage.setItem("operationPaneCollapsed", operationPaneCollapsed ? "1" : "0");
  syncOperationPaneState();
  scheduleTerminalFit();
}

function renderExplorerTools() {
  const tools = $("explorerTools");
  const tree = $("connectionGroups");
  syncOperationPaneState();
  tools.classList.remove("log-mode", "section-mode", "connection-mode", "compact-mode");
  if (tree) tree.hidden = ["settings", "import"].includes(primaryView);
  if (primaryView === "logs") {
    tools.classList.add("compact-mode");
    const logSearchLabel = tr("common:workspace.search_logs", {defaultValue:"搜索日志"});
    const logSettingsLabel = tr("common:workspace.log_settings", {defaultValue:"日志设置"});
    const logCleanupLabel = tr("common:workspace.cleanup_logs", {defaultValue:"清理日志"});
    tools.innerHTML = `
      <div class="search-field">${icon("search")}<input id="logSearch" placeholder="${escAttr(logSearchLabel)}" value="${esc(logSearch)}" data-input-action="workspace-log-search"></div>
      <div class="explorer-action-strip three-actions">
        <button class="primary explorer-main-action" data-action="workspace-log-today">${icon("calendar-days")}<span>${esc(tr("common:auto.today_logs", {defaultValue:"今日日志"}))}</span></button>
        <button class="icon-button" data-action="workspace-log-settings" title="${escAttr(logSettingsLabel)}" aria-label="${escAttr(logSettingsLabel)}">${icon("settings-2")}</button>
        <button class="icon-button" data-action="workspace-log-cleanup" title="${escAttr(logCleanupLabel)}" aria-label="${escAttr(logCleanupLabel)}">${icon("list-filter")}</button>
      </div>`;
    return;
  }
  if (primaryView === "running") {
    tools.classList.add("compact-mode");
    const refreshLabel = tr("common:auto.refresh_status", {defaultValue:"刷新状态"});
    const restoreLabel = tr("connections:auto.restore_forwards", {defaultValue:"恢复转发"});
    tools.innerHTML = `<div class="explorer-action-strip two-actions running-explorer-actions"><button class="primary" data-action="workspace-running-refresh" title="${escAttr(refreshLabel)}" aria-label="${escAttr(refreshLabel)}">${icon("refresh-cw")}<span>${esc(refreshLabel)}</span></button><button data-action="workspace-forwards-restore" title="${escAttr(restoreLabel)}" aria-label="${escAttr(restoreLabel)}">${icon("history")}<span>${esc(restoreLabel)}</span></button></div>`;
    return;
  }
  if (primaryView === "command") {
    tools.classList.add("compact-mode");
    const addTemplateLabel = tr("terminal:auto.add_template", {defaultValue:"新增模板"});
    const refreshTemplatesLabel = tr("common:workspace.refresh_templates", {defaultValue:"刷新模板"});
    tools.innerHTML = `<div class="explorer-action-strip three-actions"><button class="primary explorer-main-action" data-action="workspace-batch-open">${icon("play")}<span>${esc(tr("terminal:batch.title", {defaultValue:"批量执行"}))}</span></button><button class="icon-button" data-action="workspace-command-template-new" title="${escAttr(addTemplateLabel)}" aria-label="${escAttr(addTemplateLabel)}">${icon("plus")}</button><button class="icon-button" data-action="workspace-command-template-refresh" title="${escAttr(refreshTemplatesLabel)}" aria-label="${escAttr(refreshTemplatesLabel)}">${icon("refresh-cw")}</button></div>`;
    return;
  }
  if (primaryView === "import") {
    const activeSection = typeof activeImportSection === "string" ? activeImportSection : "import-source";
    const sections = [["import-source", "file-input", "settings:auto.ssh_config_import_export", "SSH config 导入导出"], ["import-export", "database-backup", "settings:auto.database_import_export", "数据库导入导出"], ["configSnapshots", "history", "settings:auto.config_snapshots", "配置快照"]];
    tools.classList.add("section-mode");
    tools.innerHTML = sections.map(([id, iconName, key, defaultValue]) => `<button class="${id === activeSection ? "active" : ""}" data-explorer-section="${id}" data-action="workspace-import-section">${icon(iconName)}<span>${esc(tr(key, {defaultValue}))}</span></button>`).join("");
    return;
  }
  if (primaryView === "settings") {
    const activeSection = typeof activeSettingsSection === "string" ? normalizeSettingsSection(activeSettingsSection) : "settings-general";
    const sections = [
      ["settings-general", "settings-2", "common:auto.general_settings", "通用设置"],
      ["settings-basic", "shield-check", "common:auto.security", "安全设置"],
      ["settings-notifications", "bell", "common:auto.notification_settings", "通知设置"],
      ["settings-runtime", "activity", "common:auto.startup_runtime", "启动与运行"],
      ["settings-cache", "hard-drive", "common:auto.cache_management", "缓存管理"],
      ["settings-about", "info", "common:auto.about", "关于"]
    ];
    const updateDotHidden = typeof shouldShowUpdateNotice === "function" && shouldShowUpdateNotice() ? "" : "hidden";
    tools.classList.add("section-mode");
    tools.innerHTML = sections.map(([id, iconName, key, defaultValue]) => `<button class="${id === activeSection ? "active" : ""}" data-explorer-section="${id}" data-action="workspace-settings-section">${icon(iconName)}<span>${esc(tr(key, {defaultValue}))}</span>${id === "settings-about" ? `<i id="settingsExplorerUpdateDot" class="section-update-dot" ${updateDotHidden} aria-label="${escAttr(tr("common:auto.new_version", {defaultValue:"发现新版本"}))}"></i>` : ""}</button>`).join("");
    return;
  }
  if (primaryView === "remote") {
    tools.classList.add("connection-mode", "remote-connection-mode");
    const linuxDesktopLabel = tr("remote:linux_desktop.title", {defaultValue:"Linux 桌面管理"});
    const remoteSearchLabel = tr("common:workspace.search_remote_connections", {defaultValue:"搜索其他连接、协议、主机、分组"});
    const addGroupLabel = tr("common:auto.add_group", {defaultValue:"添加分组"});
    const remoteActionsLabel = tr("common:workspace.remote_connection_actions", {defaultValue:"其他连接操作"});
    const linuxDesktopManagerButton = `<button class="icon-button" data-action="workspace-linux-desktop" title="${escAttr(linuxDesktopLabel)}" aria-label="${escAttr(linuxDesktopLabel)}">${icon("monitor-cog")}</button>`;
    const quickOpenTitle = tr(remoteDesktopQuickOpen ? "remote:auto.quick_open_enabled_title" : "remote:auto.quick_open_disabled_title", {
      defaultValue:remoteDesktopQuickOpen ? "快捷打开：已开启，探测通过后自动打开远程桌面" : "快捷打开：已关闭，只进入探测界面"
    });
    const quickOpenButton = `<button class="icon-button${remoteDesktopQuickOpen ? " active" : ""}" data-action="workspace-remote-quick-open" title="${escAttr(quickOpenTitle)}" aria-label="${escAttr(tr("common:auto.quick_open_remote_desktop", {defaultValue:"快捷打开远程桌面"}))}" aria-pressed="${remoteDesktopQuickOpen ? "true" : "false"}" aria-busy="${remoteDesktopQuickOpenTogglePending > 0 ? "true" : "false"}">${icon("zap")}</button>`;
    tools.innerHTML = `
      <div class="search-field">${icon("search")}<input id="remoteConnectionSearch" placeholder="${escAttr(remoteSearchLabel)}" value="${esc(remoteConnectionSearch)}" data-input-action="workspace-remote-search"></div>
      <div class="explorer-action-strip connection-action-strip">
        <button class="primary explorer-main-action" data-action="workspace-remote-add">${icon("plus")}<span>${esc(tr("remote:auto.add_connection", {defaultValue:"添加连接"}))}</span></button>
        <button class="icon-button" data-action="workspace-group-add" title="${escAttr(addGroupLabel)}" aria-label="${escAttr(addGroupLabel)}">${icon("folder-plus")}</button>
        ${quickOpenButton}
        <button class="icon-button" data-action="workspace-remote-menu" title="${escAttr(remoteActionsLabel)}" aria-label="${escAttr(remoteActionsLabel)}">${icon("ellipsis")}</button>
      </div>`;
    tools.querySelector(".connection-action-strip")?.insertAdjacentHTML("beforeend", linuxDesktopManagerButton);
    return;
  }
  tools.classList.add("connection-mode");
  const connectionSearchLabel = tr("common:workspace.search_ssh_connections", {defaultValue:"搜索连接、主机、用户、分组"});
  const addGroupLabel = tr("common:auto.add_group", {defaultValue:"添加分组"});
  const bulkLabel = tr(connectionBulkMode ? "common:workspace.finish_bulk_management" : "common:workspace.bulk_management", {defaultValue:connectionBulkMode ? "完成批量管理" : "批量管理"});
  const connectionActionsLabel = tr("common:workspace.connection_list_actions", {defaultValue:"连接列表操作"});
  tools.innerHTML = `
    <div class="search-field">${icon("search")}<input id="connectionSearch" placeholder="${escAttr(connectionSearchLabel)}" value="${esc(connectionSearch)}" data-input-action="workspace-connection-search"></div>
    <div class="explorer-action-strip connection-action-strip">
      <button class="primary explorer-main-action" data-action="workspace-connection-new">${icon("plus")}<span>${esc(tr("common:auto.add_ssh", {defaultValue:"添加 SSH"}))}</span></button>
      <button class="icon-button" data-action="workspace-group-add" title="${escAttr(addGroupLabel)}" aria-label="${escAttr(addGroupLabel)}">${icon("folder-plus")}</button>
      <button class="icon-button${connectionBulkMode ? " active" : ""}" data-action="workspace-connection-bulk" title="${escAttr(bulkLabel)}" aria-label="${escAttr(bulkLabel)}">${icon(connectionBulkMode ? "check-check" : "list-checks")}</button>
      <button class="icon-button" data-action="workspace-connection-menu" title="${escAttr(connectionActionsLabel)}" aria-label="${escAttr(connectionActionsLabel)}">${icon("ellipsis")}</button>
    </div>`;
}

let remoteDesktopQuickOpenToggleQueue = Promise.resolve();
let remoteDesktopQuickOpenToggleTarget = null;
let remoteDesktopQuickOpenTogglePending = 0;

async function toggleRemoteDesktopQuickOpen() {
  const nextValue = !(remoteDesktopQuickOpenToggleTarget ?? remoteDesktopQuickOpen);
  remoteDesktopQuickOpenToggleTarget = nextValue;
  remoteDesktopQuickOpenTogglePending += 1;
  renderExplorerTools();
  const operation = remoteDesktopQuickOpenToggleQueue.then(async () => {
    try {
      const result = await api("/api/runtime-settings", {
        method:"PUT",
        body:JSON.stringify({remote_desktop_quick_open_enabled:nextValue})
      });
      runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
      remoteDesktopQuickOpen = runtimeSettings.saved.remote_desktop_quick_open_enabled === true;
      localStorage.removeItem("remoteDesktopQuickOpen");
      notify(tr(remoteDesktopQuickOpen ? "remote:auto.quick_open_enabled_notice" : "remote:auto.quick_open_disabled_notice", {
        defaultValue:remoteDesktopQuickOpen
          ? "已开启快捷打开：远程桌面探测通过后会自动启动"
          : "已关闭快捷打开：远程桌面默认停留在探测界面"
      }), "info");
      return remoteDesktopQuickOpen;
    } catch (error) {
      notify(error.message || tr("settings:auto.workspace_save_failed", {defaultValue:"工作区设置保存失败"}), "error");
      return remoteDesktopQuickOpen;
    } finally {
      remoteDesktopQuickOpenTogglePending = Math.max(0, remoteDesktopQuickOpenTogglePending - 1);
      if (!remoteDesktopQuickOpenTogglePending) remoteDesktopQuickOpenToggleTarget = null;
      renderExplorerTools();
    }
  });
  remoteDesktopQuickOpenToggleQueue = operation.catch(() => {});
  return operation;
}

function showConnectionExplorerMenu(event) {
  showActionMenu(event, [
    {label:tr("common:auto.start_all_forwards", {defaultValue:"启动全部转发"}), icon:"play", run:()=>startAllForwards()},
    {label:tr("common:auto.stop_all_forwards", {defaultValue:"停止全部转发"}), icon:"square", run:()=>stopAllForwardsUi()},
    {separator:true},
    {label:tr("connections:groups.check_all", {defaultValue:"检查全部连接"}), icon:"activity", run:()=>checkAllHealth()}
  ]);
}

function backToExplorer() {
  showMobileExplorer();
}

function showMobileExplorer() {
  mobilePaneView = "explorer";
  document.querySelector(".left-pane").classList.remove("mobile-hide");
  $("content").classList.remove("mobile-show");
  document.body.classList.remove("mobile-terminal-active");
}

function showMobileWorkspace() {
  mobilePaneView = "workspace";
  document.querySelector(".left-pane").classList.add("mobile-hide");
  $("content").classList.add("mobile-show");
  document.body.classList.toggle("mobile-terminal-active", ["terminal","remote-terminal"].includes(activeView));
}

function syncResponsivePane() {
  const mobile = isMobileLayout();
  if (mobile && activityBarResize) finishActivityBarResize(null, true);
  if (mobile && operationPaneResize) finishOperationPaneResize(null, true);
  syncOperationPaneState();
  if (typeof syncTerminalResponsiveFontSizes === "function") syncTerminalResponsiveFontSizes();
  if (!mobile) {
    responsiveLayoutMobile = false;
    document.querySelector(".left-pane")?.classList.remove("mobile-hide");
    $("content")?.classList.remove("mobile-show");
    document.body.classList.remove("mobile-terminal-active");
    if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement();
    if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement();
    return;
  }
  if (responsiveLayoutMobile === false) mobilePaneView = activeView === "welcome" ? "explorer" : "workspace";
  responsiveLayoutMobile = true;
  if (mobilePaneView === "workspace") showMobileWorkspace();
  else showMobileExplorer();
  if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement();
  if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement();
}

function renderWelcome() {
  const title = tr("common:workspace.welcome_title", {defaultValue:"开始使用"});
  $("view-welcome").innerHTML = `<div id="startupSummary"></div>${stateView("empty", title, tr("common:workspace.welcome_hint", {defaultValue:"从左侧选择 SSH 资源、日志或导入导出；打开的内容会保留为工作区标签。"}), `<button class="primary" data-action="workspace-show-connections">${esc(tr("common:workspace.view_connections", {defaultValue:"查看连接"}))}</button>`)}`;
  setWorkspace(title, tr("common:workspace.welcome_subtitle", {defaultValue:"选择左侧项目后开始操作"}), "welcome", "welcome", true, false, {kind:"welcome"});
  loadStartupSummary();
}

function renderStartupSummary(box=$("startupSummary")) {
  const s = startupSummaryStatus;
  if (!box || !s) return;
  const forwards = connections.flatMap(connection => connection.forwards || []);
  const running = forwards.filter(forward => forward.status === "running").length;
  const reconnecting = forwards.filter(forward => forward.status === "reconnecting").length;
  const failed = forwards.filter(forward => forward.status === "failed").length;
  const latestFailed = forwards.filter(forward => forward.status === "failed").sort((a,b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
  const urls = [s.local_url, ...(s.lan_urls || [])].filter(Boolean);
  const starting = s.state === "starting";
  const warning = !starting && failed > 0;
  const title = starting
    ? tr("common:workspace.startup_running", {defaultValue:"启动任务正在执行"})
    : warning
      ? tr("common:workspace.ready_with_failures", {defaultValue:"Terma 已就绪，存在启动失败的转发"})
      : tr("common:workspace.ready", {defaultValue:"Terma 已就绪"});
  const logTimestamp = Number(latestFailed?.updated_at || 0);
  const runningLabel = tr("common:workspace.running_label", {defaultValue:"运行中"});
  const reconnectingLabel = tr("common:workspace.reconnecting_label", {defaultValue:"重连中"});
  const failedLabel = tr("common:workspace.startup_failed_label", {defaultValue:"启动失败"});
  box.innerHTML = `<div class="startup-summary ${warning ? "warning" : "ready"}"><div><strong>${esc(title)}</strong><span>${urls.map(esc).join(" · ")}</span></div><div class="startup-counts"><span class="startup-count-card" data-startup-state="running"><strong>${running}</strong><small>${esc(runningLabel)}</small></span>${reconnecting ? `<span class="startup-count-card" data-startup-state="reconnecting"><strong>${reconnecting}</strong><small>${esc(reconnectingLabel)}</small></span>` : ""}${failed ? `<button class="startup-status-button bad" data-startup-state="failed" data-action="workspace-show-running" title="${escAttr(tr("common:workspace.view_startup_failures", {defaultValue:"查看启动失败的转发"}))}"><strong>${failed}</strong><small>${esc(failedLabel)}</small></button>` : `<span class="startup-count-card" data-startup-state="failed"><strong>0</strong><small>${esc(failedLabel)}</small></span>`}<button class="startup-log-button" data-action="workspace-startup-log" data-log-timestamp="${logTimestamp}">${esc(tr(failed ? "common:workspace.failure_logs" : "common:workspace.system_logs", {defaultValue:failed ? "失败日志" : "系统日志"}))}</button></div></div>`;
}

async function loadStartupSummary(box=$("startupSummary")) {
  if (!box?.isConnected) return;
  try {
    startupSummaryStatus = await api("/api/startup-status");
    if (!box.isConnected) return;
    renderStartupSummary(box);
    if (startupSummaryStatus.state === "starting") setTimeout(() => loadStartupSummary(box), 1200);
  } catch { box.innerHTML = ""; }
}

if (typeof registerTermaAction === "function") {
registerTermaAction("workspace-event-stop", ({event}) => event.stopPropagation());
registerTermaAction("workspace-tab-drag-start", ({event, element}) => beginWorkspaceTabDrag(event, element.dataset.tabKey, element));
registerTermaAction("workspace-tab-activate", ({event, element}) => activateWorkspaceTabFromClick(event, element.dataset.tabKey));
registerTermaAction("workspace-tab-menu", ({event, element}) => showTabContextMenu(event, element.dataset.tabKey));
registerTermaAction("workspace-tab-sftp-drag-over", ({event, element}) => handleSftpTabDragOver(event, element.dataset.tabKey, element));
registerTermaAction("workspace-tab-sftp-drag-leave", ({event, element}) => handleSftpTabDragLeave(event, element));
registerTermaAction("workspace-tab-sftp-drop", ({event, element}) => dropSftpItemsOnTab(event, element.dataset.tabKey, element));
registerTermaAction("workspace-tab-close", ({event, element}) => closeTab(event, element.dataset.tabKey));
registerTermaAction("workspace-log-search", ({element}) => setLogSearch(element.value));
registerTermaAction("workspace-log-today", () => openTodaySystemLog());
registerTermaAction("workspace-log-settings", () => showLogSettings());
registerTermaAction("workspace-log-cleanup", ({event}) => showLogCleanupMenu(event));
registerTermaAction("workspace-running-refresh", () => loadAll().then(renderRunningForwards));
registerTermaAction("workspace-forwards-restore", () => restoreForwards());
registerTermaAction("workspace-batch-open", () => openBatchCommand());
registerTermaAction("workspace-command-template-new", () => newCommandTemplate());
registerTermaAction("workspace-command-template-refresh", () => renderCommandTemplates());
registerTermaAction("workspace-import-section", ({element}) => openImportSection(element.dataset.explorerSection));
registerTermaAction("workspace-settings-section", ({element}) => openSettingsSection(element.dataset.explorerSection));
registerTermaAction("workspace-linux-desktop", () => openLinuxDesktopManager());
registerTermaAction("workspace-remote-quick-open", () => toggleRemoteDesktopQuickOpen());
registerTermaAction("workspace-remote-search", ({element}) => setRemoteConnectionSearch(element.value));
registerTermaAction("workspace-remote-add", ({event}) => openAddRemoteConnectionMenu(event));
registerTermaAction("workspace-group-add", () => addGroup());
registerTermaAction("workspace-remote-menu", ({event}) => showRemoteExplorerMenu(event));
registerTermaAction("workspace-connection-search", ({element}) => setConnectionSearch(element.value));
registerTermaAction("workspace-connection-new", () => newConnection());
registerTermaAction("workspace-connection-bulk", () => toggleConnectionBulkMode());
registerTermaAction("workspace-connection-menu", ({event}) => showConnectionExplorerMenu(event));
registerTermaAction("workspace-show-connections", () => showPrimary("connections"));
registerTermaAction("workspace-show-running", () => showPrimary("running", true));
registerTermaAction("workspace-startup-log", ({element}) => {
  const timestamp = Number(element.dataset.logTimestamp || 0);
  return timestamp ? openSystemLogAt(timestamp) : openTodaySystemLog();
});
}

initActivityBarSizing();
initOperationPaneSizing();
