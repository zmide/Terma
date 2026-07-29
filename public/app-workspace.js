let workspaceTabDrag = null;
let workspaceTabSuppressClickUntil = 0;
const WORKSPACE_TAB_DRAG_THRESHOLD = 5;
const ACTIVITY_BAR_WIDTH_DEFAULT = 40;
const ACTIVITY_BAR_WIDTH_MIN = 36;
const ACTIVITY_BAR_WIDTH_MAX = 64;
let activityBarWidth = ACTIVITY_BAR_WIDTH_DEFAULT;
let activityBarResize = null;
let activityBarFitFrame = 0;
const OPERATION_PANE_PRIMARY_VIEWS = ["connections", "running", "command", "import", "logs", "settings"];
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

function renderTabs() {
  if (typeof syncSftpTabTitles === "function") syncSftpTabTitles();
  const container = $("tabs");
  const previousScrollLeft = container.scrollLeft;
  container.innerHTML = tabs.map(tab => {
    const fullTitle = [tab.title, tab.subtitle].filter(Boolean).join(" - ");
    const connectionStatus = ["terminal", "sftp"].includes(tab.kind) ? (tab.connectionStatus || "connecting") : "";
    const connectionDot = connectionStatus ? `<span class="tab-connection-dot ${connectionStatus}" title="${connectionStatus === "connected" ? "已连接" : connectionStatus === "disconnected" ? "已断开" : "连接中"}" aria-hidden="true"></span>` : "";
    return `<button class="tab ${tab.key === activeTabKey ? "active" : ""}" data-tab-key="${escAttr(tab.key)}" data-kind="${escAttr(tab.kind || "")}" title="${esc(fullTitle)}" aria-label="${esc(tab.title)}" onpointerdown="beginWorkspaceTabDrag(event,'${escAttr(tab.key)}')" onclick="activateWorkspaceTabFromClick(event,'${escAttr(tab.key)}')" oncontextmenu="showTabContextMenu(event,'${escAttr(tab.key)}')" ondragover="handleSftpTabDragOver(event,'${escAttr(tab.key)}')" ondragleave="handleSftpTabDragLeave(event,'${escAttr(tab.key)}')" ondrop="dropSftpItemsOnTab(event,'${escAttr(tab.key)}')">${connectionDot}<span class="tab-title">${esc(tab.title)}</span>${tab.closable ? `<span class="tab-close" title="关闭标签" aria-label="关闭标签" onpointerdown="event.stopPropagation()" onclick="closeTab(event,'${escAttr(tab.key)}')">x</span>` : ""}</button>`;
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
  const ghost = document.createElement("div");
  ghost.className = "workspace-tab-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = `${icon("grip-vertical")}<span>${esc(tab?.title || drag.tab.textContent.trim())}</span>`;
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

function addTab(key, title, subtitle, viewName, closable=true, meta={}) {
  if (key !== "welcome") tabs = tabs.filter(tab => tab.key !== "welcome");
  if (key === "welcome" && tabs.some(tab => tab.key !== "welcome")) return;
  const found = tabs.find(tab => tab.key === key);
  if (found) Object.assign(found, {title, subtitle, viewName, closable, ...meta});
  else tabs.push({key, title, subtitle, viewName, closable, ...meta});
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
  dot.title = normalized === "connected" ? "已连接" : normalized === "disconnected" ? "已断开" : "连接中";
}

function renderTabContent(tab) {
  if (tab.kind === "terminal") return openTerminal(tab.id, false, tab.key, tab.title);
  if (tab.kind === "forwards") return openForwards(tab.id, false);
  if (tab.kind === "edit") return editConnection(tab.id, false);
  if (tab.kind === "import") return showImport(false);
  if (tab.kind === "log") return openLog(tab.path, tab.title, false);
  if (tab.kind === "command") return openBatchCommand(false);
  if (tab.kind === "sftp") return openSftp(tab.id, tab.path || ".", false, tab.key);
  if (tab.kind === "dashboard") return openServerDashboard(tab.id, false);
  if (tab.kind === "settings") return openSettings(false);
  return setWorkspace(tab.title, tab.subtitle, tab.viewName, tab.key, false, tab.closable);
}

function activateTab(key) {
  const tab = tabs.find(item => item.key === key);
  if (!tab) return;
  if (activeView === "sftp" && activeTabKey !== key && typeof rememberSftpViewState === "function") {
    rememberSftpViewState(activeTabKey);
  }
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
  for (const key of targets) {
    closeTerminalSession(key);
    if (String(key).startsWith("sftp-") && typeof closeSftpSession === "function") closeSftpSession(key);
    sftpDisconnectedTabs.delete(key);
    sftpViewStates.delete(key);
    if (typeof clearSftpDirectoryViewCache === "function") clearSftpDirectoryViewCache(key);
    if (key === "command") stopBatchCommand();
  }
  tabs = tabs.filter(tab => !targets.has(tab.key));
  if (!targets.has(activeTabKey)) return renderTabs();
  const previousKeys = previousTabs.map(tab => tab.key);
  const fallbackKey = [previousKeys[anchorIndex], ...previousKeys.slice(0, anchorIndex).reverse(), ...previousKeys.slice(anchorIndex + 1)]
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

function showTabContextMenu(event, key) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const tab = tabs.find(item => item.key === key);
  const index = tabs.findIndex(item => item.key === key);
  if (!tab || index < 0) return;
  const options = [
    ["向左移动", () => moveWorkspaceTab(key, -1), index > 0],
    ["向右移动", () => moveWorkspaceTab(key, 1), index < tabs.length - 1],
    ["关闭当前标签", () => closeTabsByMode("current", key), Boolean(tab.closable)],
    ["关闭其他标签", () => closeTabsByMode("others", key), tabs.some(item => item.closable && item.key !== key)],
    ["关闭右侧标签", () => closeTabsByMode("right", key), tabs.slice(index + 1).some(item => item.closable)],
    ["关闭所有标签", () => closeTabsByMode("all", key), tabs.some(item => item.closable)]
  ];
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  for (const [label, action, enabled] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
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
  return tabs.filter(tab => tab.kind).map(({key,title,subtitle,viewName,closable,kind,id,path}) => ({key,title,subtitle,viewName,closable,kind,id,path}));
}

function saveTabsState() {
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
  session.connectionAttempt = Number(session.connectionAttempt || 0) + 1;
  if (typeof cancelTerminalCursorCopy === "function") cancelTerminalCursorCopy(session, key);
  try { session.socket?.close(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  try { session.resizeObserver?.disconnect(); } catch {}
  try { session.globalLinkDisposable?.dispose(); } catch {}
  try { session.globalSelectionDisposable?.dispose(); } catch {}
  try { session.term?.dispose(); } catch {}
  clearTimeout(session.latencyPendingTimer);
  clearTimeout(session.autoCopyTimer);
  terminalSessions.delete(key);
  if (typeof terminalStartupOverrides !== "undefined") terminalStartupOverrides.delete(key);
}

function setWorkspace(title, subtitle, viewName, key=viewName, updateTab=true, closable=true, meta={}) {
  if (activeView === "sftp" && activeTabKey !== key && typeof rememberSftpViewState === "function") {
    rememberSftpViewState(activeTabKey);
  }
  if (updateTab) addTab(key, title, subtitle, viewName, closable, meta);
  $("workspaceTitle").textContent = "工作区";
  $("workspaceSubtitle").textContent = subtitle || "";
  document.querySelectorAll(".view").forEach(v => v.hidden = true);
  $(`view-${viewName}`).hidden = false;
  document.querySelector(".workspace")?.classList.toggle("terminal-workspace", viewName === "terminal");
  $("content")?.classList.toggle("terminal-content", viewName === "terminal");
  $("content")?.classList.toggle("sftp-content", viewName === "sftp");
  document.body.classList.toggle("mobile-terminal-active", isMobileLayout() && viewName === "terminal");
  activeView = viewName;
  if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement();
  if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement();
  if (isMobileLayout() && viewName !== "welcome") showMobileWorkspace();
}

function showPrimary(name, togglePane=false) {
  const shouldTogglePane = togglePane && !isMobileLayout();
  const nextPaneCollapsed = shouldTogglePane
    ? (name === primaryView ? !operationPaneCollapsed : false)
    : operationPaneCollapsed;
  primaryView = name;
  $("navConnections").classList.toggle("active", name === "connections");
  $("navImport").classList.toggle("active", name === "import");
  $("navRunning").classList.toggle("active", name === "running");
  $("navCommand").classList.toggle("active", name === "command");
  $("navLogs").classList.toggle("active", name === "logs");
  $("navSettings")?.classList.toggle("active", name === "settings");
  $("sideConnections").classList.toggle("active", name === "connections");
  $("sideImport").classList.toggle("active", name === "import");
  $("mobileConnections").classList.toggle("active", name === "connections");
  $("mobileImport").classList.toggle("active", name === "import");
  $("mobileRunning").classList.toggle("active", name === "running");
  $("mobileCommand").classList.toggle("active", name === "command");
  $("mobileLogs").classList.toggle("active", name === "logs");
  $("mobileSettings")?.classList.toggle("active", name === "settings");
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
    ? "操作区已固定；点击改为自动收起"
    : "点击工作区后自动收起；点击固定";
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
  tools.classList.remove("log-mode", "section-mode");
  if (tree) tree.hidden = ["settings", "import"].includes(primaryView);
  if (primaryView === "logs") {
    tools.classList.add("log-mode");
    tools.innerHTML = `
      <div class="search-field">${icon("search")}<input id="logSearch" placeholder="搜索日志" value="${esc(logSearch)}" oninput="setLogSearch(this.value)"></div>
      <div class="tool-row"><button onclick="openTodaySystemLog()">${icon("calendar-days")}<span>今天日志</span></button><button onclick="showLogSettings()">${icon("settings-2")}<span>日志设置</span></button></div>
      <button onclick="showLogCleanupMenu(event)">${icon("list-filter")}<span>清理日志</span></button>`;
    return;
  }
  if (primaryView === "running") {
    tools.classList.add("log-mode");
    tools.innerHTML = `<button onclick="loadAll().then(renderRunningForwards)">${icon("refresh-cw")}<span>刷新</span></button><button onclick="restoreForwards()">${icon("history")}<span>恢复上次转发</span></button>`;
    return;
  }
  if (primaryView === "command") {
    tools.classList.add("log-mode");
    tools.innerHTML = `<button class="primary" onclick="openBatchCommand()">${icon("play")}<span>批量执行</span></button><button onclick="newCommandTemplate()">${icon("plus")}<span>新增模板</span></button><button onclick="renderCommandTemplates()">${icon("refresh-cw")}<span>刷新模板</span></button>`;
    return;
  }
  if (primaryView === "import") {
    const activeSection = typeof activeImportSection === "string" ? activeImportSection : "import-source";
    const sections = [["import-source", "file-input", "SSH config 导入导出"], ["import-export", "database-backup", "数据库导入导出"], ["configSnapshots", "history", "配置快照"]];
    tools.classList.add("section-mode");
    tools.innerHTML = sections.map(([id, iconName, label]) => `<button class="${id === activeSection ? "active" : ""}" data-explorer-section="${id}" onclick="openImportSection('${id}')">${icon(iconName)}<span>${label}</span></button>`).join("");
    return;
  }
  if (primaryView === "settings") {
    const activeSection = typeof activeSettingsSection === "string" ? normalizeSettingsSection(activeSettingsSection) : "settings-general";
    const sections = [["settings-general", "settings-2", "通用设置"], ["settings-basic", "shield-check", "安全设置"], ["settings-notifications", "bell", "通知设置"], ["settings-runtime", "activity", "启动与运行"], ["settings-about", "info", "关于"]];
    const updateDotHidden = typeof shouldShowUpdateNotice === "function" && shouldShowUpdateNotice() ? "" : "hidden";
    tools.classList.add("section-mode");
    tools.innerHTML = sections.map(([id, iconName, label]) => `<button class="${id === activeSection ? "active" : ""}" data-explorer-section="${id}" onclick="openSettingsSection('${id}')">${icon(iconName)}<span>${label}</span>${id === "settings-about" ? `<i id="settingsExplorerUpdateDot" class="section-update-dot" ${updateDotHidden} aria-label="发现新版本"></i>` : ""}</button>`).join("");
    return;
  }
  tools.innerHTML = `
    <div class="search-field">${icon("search")}<input id="connectionSearch" placeholder="搜索连接、主机、用户、分组" value="${esc(connectionSearch)}" oninput="setConnectionSearch(this.value)"></div>
    <button onclick="addGroup()">${icon("folder-plus")}<span>添加分组</span></button>
    <button class="primary" onclick="newConnection()">${icon("server-cog")}<span>添加 SSH</span></button>
    <button class="${connectionBulkMode ? "active" : ""}" onclick="toggleConnectionBulkMode()">${icon(connectionBulkMode ? "check-check" : "list-checks")}<span>${connectionBulkMode ? "完成管理" : "批量管理"}</span></button>
    <button onclick="startAllForwards(this)">${icon("play")}<span>启动全部</span></button>
    <button onclick="stopAllForwardsUi(this)">${icon("square")}<span>停止全部</span></button>
    <button onclick="checkAllHealth(this)">${icon("activity")}<span>健康检查</span></button>`;
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
  document.body.classList.toggle("mobile-terminal-active", activeView === "terminal");
}

function syncResponsivePane() {
  const mobile = isMobileLayout();
  if (mobile && activityBarResize) finishActivityBarResize(null, true);
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
  $("view-welcome").innerHTML = `<div id="startupSummary"></div>${stateView("empty", "开始使用", "从左侧选择 SSH 资源、日志或导入导出；打开的内容会保留为工作区标签。", `<button class="primary" onclick="showPrimary('connections')">查看连接</button>`)}`;
  setWorkspace("开始使用", "选择左侧项目后开始操作", "welcome", "welcome", true, false);
  loadStartupSummary();
}

function renderStartupSummary(box=$("startupSummary")) {
  const s = startupSummaryStatus;
  if (!box || !s) return;
  const forwards = connections.flatMap(connection => connection.forwards || []);
  const running = forwards.filter(forward => forward.status === "running").length;
  const reconnecting = forwards.filter(forward => forward.status === "reconnecting").length;
  const failed = forwards.filter(forward => forward.status === "failed").length;
  const urls = [s.local_url, ...(s.lan_urls || [])].filter(Boolean);
  const starting = s.state === "starting";
  const warning = !starting && failed > 0;
  const title = starting ? "启动任务正在执行" : warning ? "TunnelDesk 已就绪，部分转发异常" : "TunnelDesk 已就绪";
  box.innerHTML = `<div class="startup-summary ${warning ? "warning" : "ready"}"><div><strong>${title}</strong><span>${urls.map(esc).join(" · ")}</span></div><div class="startup-counts"><span>运行中 ${running}</span>${reconnecting ? `<span>重连中 ${reconnecting}</span>` : ""}<span class="${failed ? "bad" : ""}">异常 ${failed}</span><button onclick="openTodaySystemLog()">系统日志</button></div></div>`;
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

initActivityBarSizing();
