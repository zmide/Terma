function workspaceLeaves(node=workspaceLayout, result=[]) {
  if (!node) return result;
  if (node.type === "pane") result.push(node);
  else {
    workspaceLeaves(node.first, result);
    workspaceLeaves(node.second, result);
  }
  return result;
}

function workspaceFindPane(paneId, node=workspaceLayout) {
  if (!node) return null;
  if (node.type === "pane") return node.id === paneId ? node : null;
  return workspaceFindPane(paneId, node.first) || workspaceFindPane(paneId, node.second);
}

function workspaceFindPaneForTab(key) {
  return workspaceLeaves().find(pane => pane.tabs.includes(key)) || null;
}

function workspaceFindSplit(splitId, node=workspaceLayout) {
  if (!node || node.type === "pane") return null;
  if (node.id === splitId) return node;
  return workspaceFindSplit(splitId, node.first) || workspaceFindSplit(splitId, node.second);
}

function currentWorkspacePaneId() {
  return workspaceExecutionPaneId || focusedPaneId || workspaceLeaves()[0]?.id || "pane-1";
}

function currentWorkspaceDomScope() {
  const paneId = currentWorkspacePaneId();
  return workspacePaneNodes.get(paneId)
    || document.querySelector(`.workspace-pane[data-pane-id="${workspaceCssEscape(paneId)}"]`)
    || null;
}

function workspacePaneHeaderToolsElement(paneId) {
  return workspacePaneElement(paneId)?.querySelector('[data-workspace-role="header-tools"]') || null;
}

function workspaceToolbarSettingsValue() {
  try {
    const value = runtimeSettings?.saved?.workspace_toolbar_placement
      || runtimeSettings?.workspace_toolbar_placement;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function workspaceToolbarPlacementForTab(tabKey, kind="") {
  if (isMobileLayout()) return "tab";
  const tab = tabs.find(item => item.key === tabKey);
  const toolbarKind = kind || tab?.kind || "";
  const mode = workspaceLeaves().length > 1 ? "split" : "unsplit";
  const placement = workspaceToolbarSettingsValue()?.[mode]?.[toolbarKind];
  return placement === "tab" ? "tab" : "header";
}

function workspaceToolbarMountElement(kind, tabKey) {
  const escapedKind = workspaceCssEscape(kind);
  const escapedKey = workspaceCssEscape(tabKey);
  const registered = document.querySelector(`[data-workspace-toolbar-mount="${escapedKind}"][data-workspace-tab-key="${escapedKey}"]`);
  if (registered) return registered;
  const pane = workspaceFindPaneForTab(tabKey);
  const view = workspacePaneElement(pane?.id)?.querySelector(`#view-${escapedKind}`);
  const viewKey = view?.dataset?.workspaceTabKey
    || view?.dataset?.terminalTabKey
    || view?.dataset?.sftpTabKey
    || "";
  if (!view || (viewKey && viewKey !== tabKey)) return null;
  const mountId = kind === "terminal" ? "terminalToolbarMount" : kind === "sftp" ? "sftpToolbarMount" : "";
  return mountId ? view.querySelector(`#${mountId}`) : null;
}

function registerWorkspaceToolbar(kind, tabKey, toolbar, mount) {
  if (!toolbar || !tabKey || !["terminal", "sftp"].includes(kind)) return null;
  toolbar.dataset.workspaceToolbarKind = kind;
  toolbar.dataset.workspaceTabKey = tabKey;
  if (mount) {
    mount.dataset.workspaceToolbarMount = kind;
    mount.dataset.workspaceTabKey = tabKey;
  }
  return toolbar;
}

function workspaceToolbarRecord(toolbar) {
  if (!toolbar) return null;
  const kind = toolbar.dataset.workspaceToolbarKind
    || (toolbar.classList.contains("terminal-toolbar") ? "terminal" : toolbar.classList.contains("sftp-toolbar") ? "sftp" : "");
  if (!kind) return null;
  const pane = toolbar.closest(".workspace-pane");
  const view = toolbar.closest(`#view-${kind}`);
  const mount = toolbar.closest("[data-workspace-toolbar-mount]")
    || toolbar.closest(kind === "terminal" ? "#terminalToolbarMount" : "#sftpToolbarMount");
  const tabKey = toolbar.dataset.workspaceTabKey
    || mount?.dataset?.workspaceTabKey
    || view?.dataset?.workspaceTabKey
    || view?.dataset?.terminalTabKey
    || view?.dataset?.sftpTabKey
    || workspaceFindPane(pane?.dataset?.paneId)?.activeTabKey
    || "";
  if (!tabKey) return null;
  const ownerMount = workspaceToolbarMountElement(kind, tabKey) || mount;
  registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
  return {kind, tabKey, toolbar, mount:ownerMount};
}

function workspaceToolbarDestination(kind, tabKey, mount=null) {
  const pane = workspaceFindPaneForTab(tabKey);
  const tab = tabs.find(item => item.key === tabKey);
  const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
  const tabOwnsToolbar = Boolean(tab) && (tab.kind === kind || (kind === "terminal" && tab.kind === "quick-terminal"));
  if (!pane || !tabOwnsToolbar || pane.activeTabKey !== tabKey) {
    return {host:ownerMount, visible:false, header:false};
  }
  if (isMobileLayout()) {
    return {host:ownerMount, visible:pane.id === focusedPaneId, header:false};
  }
  if (workspaceToolbarPlacementForTab(tabKey, kind) === "tab") {
    return {host:workspacePaneHeaderToolsElement(pane.id), visible:true, header:true};
  }
  if (pane.id === focusedPaneId) {
    return {host:workspaceGlobalHeaderToolsElement(), visible:true, header:true};
  }
  return {host:ownerMount, visible:false, header:false};
}

function returnWorkspaceToolbarToMount(toolbar, hidden=true) {
  const record = workspaceToolbarRecord(toolbar);
  if (!record) {
    toolbar?.remove();
    return;
  }
  if (!record.mount?.isConnected) {
    toolbar.remove();
    return;
  }
  if (record.mount && toolbar.parentElement !== record.mount) record.mount.appendChild(toolbar);
  toolbar.classList.remove("terminal-toolbar-header", "sftp-toolbar-header");
  toolbar.hidden = hidden;
}

function bindWorkspaceToolbarHorizontalScroll(toolbar) {
  const actions = toolbar?.querySelector?.(".terminal-actions, .sftp-toolbar-actions");
  if (!actions || actions.dataset.workspaceHorizontalScroll === "1") return;
  actions.dataset.workspaceHorizontalScroll = "1";
  actions.tabIndex = 0;
  actions.addEventListener("wheel", event => {
    if (actions.scrollWidth <= actions.clientWidth + 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const previous = actions.scrollLeft;
    actions.scrollLeft += delta;
    if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
  }, {passive:false});
  actions.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || actions.scrollWidth <= actions.clientWidth + 1) return;
    const previous = actions.scrollLeft;
    if (event.key === "Home") actions.scrollLeft = 0;
    else if (event.key === "End") actions.scrollLeft = actions.scrollWidth;
    else actions.scrollLeft += event.key === "ArrowLeft" ? -120 : 120;
    if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
  });
}

function placeWorkspaceToolbar(kind, tabKey, toolbar, mount=null) {
  bindWorkspaceToolbarHorizontalScroll(toolbar);
  registerWorkspaceToolbar(kind, tabKey, toolbar, mount);
  const ownerMount = mount || workspaceToolbarMountElement(kind, tabKey);
  if (ownerMount) registerWorkspaceToolbar(kind, tabKey, toolbar, ownerMount);
  const destination = workspaceToolbarDestination(kind, tabKey, ownerMount);
  const host = destination.host || ownerMount;
  if (!host) {
    toolbar.remove();
    return false;
  }
  for (const existing of [...host.querySelectorAll(":scope > .terminal-toolbar, :scope > .sftp-toolbar")]) {
    if (existing === toolbar) continue;
    const existingRecord = workspaceToolbarRecord(existing);
    if (existingRecord?.kind === kind && existingRecord.tabKey === tabKey) existing.remove();
    else returnWorkspaceToolbarToMount(existing, true);
  }
  if (toolbar.parentElement !== host) host.appendChild(toolbar);
  toolbar.hidden = !destination.visible;
  toolbar.classList.toggle("terminal-toolbar-header", destination.header && kind === "terminal");
  toolbar.classList.toggle("sftp-toolbar-header", destination.header && kind === "sftp");
  return destination.visible;
}

function syncWorkspaceToolbarHostVisibility() {
  const hosts = [
    workspaceGlobalHeaderToolsElement(),
    ...[...workspacePaneNodes.values()].map(pane => pane.querySelector('[data-workspace-role="header-tools"]'))
  ].filter(Boolean);
  for (const host of hosts) {
    host.hidden = ![...host.children].some(child => child.matches?.(".terminal-toolbar:not([hidden]), .sftp-toolbar:not([hidden])"));
  }
}

function syncWorkspaceToolbarPlacements() {
  if (!workspaceDockElement()) {
    if (typeof syncTerminalToolbarPlacement === "function") syncTerminalToolbarPlacement(activeTabKey);
    if (typeof syncSftpToolbarPlacement === "function") syncSftpToolbarPlacement(activeTabKey);
    return;
  }
  const discovered = [...document.querySelectorAll(".terminal-toolbar, .sftp-toolbar")]
    .map(workspaceToolbarRecord)
    .filter(Boolean);
  const owners = new Map();
  for (const record of discovered) {
    const owner = `${record.kind}\0${record.tabKey}`;
    const previous = owners.get(owner);
    if (!previous) {
      owners.set(owner, record);
      continue;
    }
    const previousAtMount = previous.toolbar.parentElement === previous.mount;
    const currentAtMount = record.toolbar.parentElement === record.mount;
    if (currentAtMount && !previousAtMount) {
      previous.toolbar.remove();
      owners.set(owner, record);
    } else {
      record.toolbar.remove();
    }
  }
  const records = [...owners.values()];
  const ranked = records.map(record => ({
    ...record,
    destination:workspaceToolbarDestination(record.kind, record.tabKey, record.mount)
  })).sort((left, right) => Number(left.destination.visible) - Number(right.destination.visible));
  for (const record of ranked) placeWorkspaceToolbar(record.kind, record.tabKey, record.toolbar, record.mount);
  syncWorkspaceToolbarHostVisibility();
  for (const pane of workspaceVisiblePanes()) {
    const tab = tabs.find(item => item.key === pane.activeTabKey);
    if (["terminal", "quick-terminal"].includes(tab?.kind) && typeof updateTerminalStatusForLayout === "function") updateTerminalStatusForLayout(tab.key);
    if (tab?.kind === "sftp" && typeof syncSftpMobileToolbarState === "function") syncSftpMobileToolbarState(tab.key);
  }
  if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
}

function runInWorkspacePane(paneId, action) {
  const previousPaneId = workspaceExecutionPaneId;
  workspaceExecutionPaneId = paneId || previousPaneId || focusedPaneId;
  try {
    return action();
  } finally {
    workspaceExecutionPaneId = previousPaneId;
  }
}

function captureWorkspacePane() {
  const paneId = currentWorkspacePaneId();
  return action => {
    if (workspaceDockElement() && !workspaceFindPane(paneId)) return undefined;
    return runInWorkspacePane(paneId, action);
  };
}

function captureWorkspaceTab(tabKey=activeTabKey) {
  const fallbackPaneId = currentWorkspacePaneId();
  return action => {
    if (!workspaceDockElement()) return runInWorkspacePane(fallbackPaneId, action);
    const pane = workspaceFindPaneForTab(tabKey);
    if (!pane || pane.activeTabKey !== tabKey) return undefined;
    return runInWorkspacePane(pane.id, action);
  };
}

function workspacePaneElement(paneId) {
  return workspacePaneNodes.get(paneId)
    || document.querySelector(`.workspace-pane[data-pane-id="${workspaceCssEscape(paneId)}"]`)
    || null;
}

function workspaceElementForTab(key, selector) {
  const pane = workspaceFindPaneForTab(key);
  // A pane reuses one DOM section per view, so inactive tabs must not resolve another tab's mounted controls.
  if (!pane || pane.activeTabKey !== key) return null;
  return workspacePaneElement(pane.id)?.querySelector(selector) || null;
}

function workspaceNextPaneId() {
  let id = "";
  do {
    workspacePaneSerial += 1;
    id = `pane-${workspacePaneSerial}`;
  } while (workspaceFindPane(id) || workspacePaneNodes.has(id));
  return id;
}

function workspaceNextSplitId() {
  let id = "";
  do {
    workspaceSplitSerial += 1;
    id = `split-${workspaceSplitSerial}`;
  } while (workspaceFindSplit(id));
  return id;
}

function workspaceViewsFragment(paneId) {
  const template = document.getElementById("workspaceViewsTpl");
  if (template?.content) {
    const fragment = template.content.cloneNode(true);
    fragment.querySelectorAll?.(".view").forEach(view => { view.dataset.workspacePaneId = paneId; });
    return fragment;
  }
  const fragment = document.createDocumentFragment();
  for (const name of ["welcome", "terminal", "forwards", "edit", "import", "log", "command", "sftp", "local-files", "settings", "dashboard", "remote-desktop", "remote-terminal", "ftp", "linux-desktop"]) {
    const section = document.createElement("section");
    section.id = `view-${name}`;
    section.className = "view";
    section.dataset.workspacePaneId = paneId;
    section.hidden = name !== "welcome";
    fragment.appendChild(section);
  }
  return fragment;
}

function createWorkspacePaneElement(paneId) {
  const pane = document.createElement("section");
  pane.className = "workspace-pane";
  pane.dataset.paneId = paneId;
  pane.innerHTML = `
    <div class="workspace-pane-chrome">
      <div class="tabs-shell">
        <button class="tabs-scroll-button tabs-scroll-left" type="button" title="${escAttr(tr("navigation:auto.scroll_tabs_left", {defaultValue:"Scroll tabs left"}))}" aria-label="${escAttr(tr("navigation:auto.scroll_tabs_left", {defaultValue:"Scroll tabs left"}))}" hidden>${icon("chevron-left")}</button>
        <div class="tabs" role="tablist"></div>
        <button class="tabs-scroll-button tabs-scroll-right" type="button" title="${escAttr(tr("navigation:auto.scroll_tabs_right", {defaultValue:"Scroll tabs right"}))}" aria-label="${escAttr(tr("navigation:auto.scroll_tabs_right", {defaultValue:"Scroll tabs right"}))}" hidden>${icon("chevron-right")}</button>
        <div class="workspace-tab-insert-indicator" aria-hidden="true" hidden></div>
        <div class="workspace-tab-resizer" role="separator" aria-orientation="horizontal" aria-label="${escAttr(tr("navigation:auto.resize_tab_bar", {defaultValue:"Resize tab bar"}))}" tabindex="0" title="${escAttr(tr("navigation:auto.resize_tab_bar_hint", {defaultValue:"Drag to resize the tab bar; double-click to reset"}))}"></div>
      </div>
      <div class="workspace-header-tools" data-workspace-role="header-tools" hidden></div>
    </div>
    <div class="workspace"></div>
    <div class="workspace-pane-drop-indicator" aria-hidden="true" hidden><span></span></div>`;
  pane.querySelector(".workspace").appendChild(workspaceViewsFragment(paneId));
  pane.addEventListener("pointerdown", () => focusWorkspacePane(paneId), true);
  pane.addEventListener("focusin", () => focusWorkspacePane(paneId), true);
  const tabsNode = pane.querySelector(".tabs");
  tabsNode.addEventListener("scroll", () => updateWorkspaceTabScrollControls(paneId), {passive:true});
  tabsNode.addEventListener("wheel", event => handleWorkspaceTabsWheel(event, paneId), {passive:false});
  if (typeof ResizeObserver === "function") {
    pane._workspaceTabResizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!workspaceFindPane(paneId)) return;
        updateWorkspaceTabScrollControls(paneId);
        const activeKey = workspaceFindPane(paneId)?.activeTabKey;
        if (activeKey) revealWorkspaceTab(activeKey);
      });
    });
    pane._workspaceTabResizeObserver.observe(tabsNode);
  }
  pane.querySelector(".tabs-shell").addEventListener("contextmenu", event => {
    if (event.target.closest(".tab,button")) return;
    showWorkspaceTabsContextMenu(event);
  });
  pane.querySelector(".tabs-scroll-left").addEventListener("click", () => scrollWorkspaceTabs(-1, paneId));
  pane.querySelector(".tabs-scroll-right").addEventListener("click", () => scrollWorkspaceTabs(1, paneId));
  bindWorkspaceChromeResizeHandle(pane.querySelector(".workspace-tab-resizer"), "tabs");
  syncWorkspaceChromeResizeAria();
  workspacePaneNodes.set(paneId, pane);
  return pane;
}

function ensureWorkspacePaneElement(paneId) {
  return workspacePaneElement(paneId) || createWorkspacePaneElement(paneId);
}

function applyWorkspaceSplitGeometry(element, node) {
  const ratio = Math.max(WORKSPACE_MIN_SPLIT_RATIO, Math.min(WORKSPACE_MAX_SPLIT_RATIO, Number(node.ratio) || 0.5));
  node.ratio = ratio;
  element.style.setProperty("--workspace-split-ratio", `${ratio * 100}%`);
  const separator = element.querySelector(":scope > .workspace-splitter");
  if (separator) {
    separator.setAttribute("aria-valuemin", String(Math.round(WORKSPACE_MIN_SPLIT_RATIO * 100)));
    separator.setAttribute("aria-valuemax", String(Math.round(WORKSPACE_MAX_SPLIT_RATIO * 100)));
    separator.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
}

function buildWorkspaceLayoutNode(node) {
  if (!node || !["pane", "split"].includes(node.type)) return null;
  if (node.type === "pane") return ensureWorkspacePaneElement(node.id);
  const split = document.createElement("div");
  split.className = `workspace-split workspace-split-${node.direction}`;
  split.dataset.splitId = node.id;
  applyWorkspaceSplitGeometry(split, node);
  const first = document.createElement("div");
  first.className = "workspace-split-child workspace-split-first";
  const firstNode = buildWorkspaceLayoutNode(node.first);
  const secondNode = buildWorkspaceLayoutNode(node.second);
  if (!firstNode) return secondNode;
  if (!secondNode) return firstNode;
  first.appendChild(firstNode);
  const separator = document.createElement("div");
  separator.className = "workspace-splitter";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-orientation", node.direction === "row" ? "vertical" : "horizontal");
  separator.setAttribute("aria-label", tr("navigation:auto.resize_split", {defaultValue:"Resize split"}));
  separator.addEventListener("pointerdown", event => beginWorkspaceSplitterDrag(event, node.id));
  separator.addEventListener("dblclick", () => setWorkspaceSplitRatio(node.id, 0.5));
  separator.addEventListener("keydown", event => handleWorkspaceSplitterKey(event, node.id));
  const second = document.createElement("div");
  second.className = "workspace-split-child workspace-split-second";
  second.appendChild(secondNode);
  split.append(first, separator, second);
  applyWorkspaceSplitGeometry(split, node);
  return split;
}

function renderWorkspaceLayout() {
  const dock = workspaceDockElement();
  if (!dock) return;
  let visibleLayout = workspaceLayout;
  if (isMobileLayout()) {
    visibleLayout = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0] || workspaceLayout;
  }
  const root = buildWorkspaceLayoutNode(visibleLayout);
  if (!root) return;
  dock.replaceChildren(root);
  const livePaneIds = new Set(workspaceLeaves().map(pane => pane.id));
  for (const [paneId, pane] of workspacePaneNodes) {
    if (livePaneIds.has(paneId)) continue;
    pane._workspaceTabResizeObserver?.disconnect?.();
    pane.remove();
    workspacePaneNodes.delete(paneId);
  }
  document.body.classList.toggle("workspace-is-split", workspaceLeaves().length > 1 && !isMobileLayout());
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) updateWorkspaceTabScrollControls(pane.id);
    if (typeof scheduleTerminalFit === "function") scheduleTerminalFit();
    if (typeof syncSftpListLayout === "function") {
      for (const pane of workspaceVisiblePanes()) {
        const list = workspacePaneElement(pane.id)?.querySelector("#sftpList");
        if (list) syncSftpListLayout(list);
      }
    }
  });
}

function workspaceVisiblePanes() {
  if (!isMobileLayout()) return workspaceLeaves();
  const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  return focused ? [focused] : [];
}

function workspaceTabsForPane(pane) {
  if (isMobileLayout()) return tabs;
  const byKey = new Map(tabs.map(tab => [tab.key, tab]));
  return pane.tabs.map(key => byKey.get(key)).filter(Boolean);
}

function reconcileWorkspaceLayoutTabs() {
  const validKeys = new Set(tabs.map(tab => tab.key));
  const claimedKeys = new Set();
  for (const pane of workspaceLeaves()) {
    pane.tabs = pane.tabs.filter(key => {
      if (!validKeys.has(key) || claimedKeys.has(key)) return false;
      claimedKeys.add(key);
      return true;
    });
    if (!pane.tabs.includes(pane.activeTabKey)) pane.activeTabKey = pane.tabs[0] || "";
  }
  let targetPane = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  if (!targetPane) {
    targetPane = {type:"pane", id:workspaceNextPaneId(), tabs:[], activeTabKey:""};
    workspaceLayout = targetPane;
  }
  for (const tab of tabs) {
    if (claimedKeys.has(tab.key)) continue;
    targetPane.tabs.push(tab.key);
    claimedKeys.add(tab.key);
  }
  if (activeTabKey && targetPane.tabs.includes(activeTabKey)) targetPane.activeTabKey = activeTabKey;
  if (!targetPane.activeTabKey) targetPane.activeTabKey = targetPane.tabs[0] || "";
  normalizeWorkspaceLayoutAfterMutation(targetPane.id);
}

function syncWorkspaceLegacyTabIds() {
  for (const [paneId, pane] of workspacePaneNodes) {
    const focused = paneId === focusedPaneId;
    const entries = [
      [pane.querySelector(".tabs"), "tabs"],
      [pane.querySelector(".tabs-scroll-left"), "tabsScrollLeft"],
      [pane.querySelector(".tabs-scroll-right"), "tabsScrollRight"]
    ];
    for (const [element, id] of entries) {
      if (!element) continue;
      if (focused) element.id = id;
      else element.removeAttribute("id");
    }
  }
}

function workspaceTabHtml(tab, pane) {
  const broadcastSelected = typeof isTerminalBroadcastTarget === "function" && isTerminalBroadcastTarget(tab.key);
  const multiSelected = workspaceSelectedTabKeys.has(tab.key);
  const visibleInPane = tab.key === pane.activeTabKey;
  if (visibleInPane && tab.activityState) tab.activityState = "";
  const localizedTitle = tab.kind === "local-files"
    ? tr("common:auto.local_files", {defaultValue:"Local Files"})
    : typeof localizedWorkspaceTabTitle === "function" ? localizedWorkspaceTabTitle(tab) : tab.title;
  const presentation = workspaceTabPresentation({...tab, title:localizedTitle});
  const fullTitle = [
    localizedTitle,
    typeof localizedWorkspaceTabSubtitle === "function" ? localizedWorkspaceTabSubtitle(tab) : tab.subtitle,
    broadcastSelected ? tr("navigation:auto.terminal_syncing", {defaultValue:"Terminal broadcast active"}) : "",
    multiSelected ? tr("navigation:auto.selected_for_workspace", {defaultValue:"Selected for workspace grouping"}) : ""
  ].filter(Boolean).join(" - ");
  const showsConnectionStatus = ["terminal", "quick-terminal", "sftp", "remote-terminal"].includes(tab.kind)
    || (tab.kind === "remote-desktop" && tab.protocol === "vnc");
  const connectionStatus = showsConnectionStatus ? (tab.connectionStatus || "connecting") : "";
  const connectionStateText = tr(`common:auto.${connectionStatus === "connected" ? "connected" : connectionStatus === "disconnected" ? "disconnected" : "connecting"}`, {defaultValue:connectionStatus === "connected" ? "Connected" : connectionStatus === "disconnected" ? "Disconnected" : "Connecting"});
  const connectionDot = connectionStatus
    ? `<span class="tab-connection-dot ${connectionStatus}" title="${escAttr(connectionStateText)}" aria-hidden="true"></span>`
    : "";
  const ariaLabel = `${localizedTitle}${broadcastSelected ? tr("navigation:auto.terminal_syncing_suffix", {defaultValue:", included in terminal sync"}) : ""}${multiSelected ? tr("navigation:auto.selected_suffix", {defaultValue:", selected"}) : ""}`;
  const closeText = tr("navigation:auto.close_tab", {defaultValue:"Close tab"});
  return `<button class="tab ${tab.key === pane.activeTabKey ? "active" : ""}${multiSelected ? " multi-selected" : ""}${tab.pinned ? " pinned" : ""}${broadcastSelected ? " broadcast-selected" : ""}${tab.activityState ? ` activity-${escAttr(tab.activityState)}` : ""}" role="tab" aria-selected="${tab.key === pane.activeTabKey}" aria-checked="${multiSelected}" data-tab-key="${escAttr(tab.key)}" data-kind="${escAttr(tab.kind || "")}" title="${esc(fullTitle)}" aria-label="${esc(ariaLabel)}" data-pointerdown-action="workspace-tab-drag-start" data-action="workspace-tab-activate" data-contextmenu-action="workspace-tab-menu" data-dragover-action="workspace-tab-sftp-drag-over" data-dragleave-action="workspace-tab-sftp-drag-leave" data-drop-action="workspace-tab-sftp-drop">${connectionDot}${presentation.icon}${tab.pinned ? `<span class="tab-pin" aria-hidden="true">${icon("pin")}</span>` : ""}<span class="tab-title">${esc(presentation.title)}</span>${tab.closable && !tab.pinned ? `<span class="tab-close" title="${escAttr(closeText)}" aria-label="${escAttr(closeText)}" data-tab-key="${escAttr(tab.key)}" data-pointerdown-action="workspace-event-stop" data-action="workspace-tab-close">x</span>` : ""}</button>`;
}

renderTabs = function() {
  if (!workspaceDockElement()) return legacyWorkspaceApi.renderTabs();
  if (typeof syncSftpTabTitles === "function") syncSftpTabTitles();
  reconcileWorkspaceLayoutTabs();
  renderWorkspaceLayout();
  for (const pane of workspaceVisiblePanes()) {
    const paneElement = workspacePaneElement(pane.id);
    if (!paneElement) continue;
    paneElement.classList.toggle("focused", pane.id === focusedPaneId);
    const container = paneElement.querySelector(".tabs");
    const previousScrollLeft = container.scrollLeft;
    const paneTabs = workspaceTabsForPane(pane);
    const displayPane = isMobileLayout() ? (workspaceFindPane(focusedPaneId) || pane) : pane;
    container.innerHTML = paneTabs.map(tab => workspaceTabHtml(tab, displayPane)).join("");
    container.scrollLeft = previousScrollLeft;
    updateWorkspaceTabScrollControls(pane.id);
  }
  syncWorkspaceLegacyTabIds();
  syncWorkspaceToolbarPlacements();
  renderWorkspaceGroupBar();
  requestAnimationFrame(() => {
    for (const pane of workspaceVisiblePanes()) {
      if (pane.activeTabKey) revealWorkspaceTab(pane.activeTabKey);
    }
  });
  if (!window.restoringTabs) saveTabsState();
};

updateWorkspaceTabScrollControls = function(paneId=currentWorkspacePaneId()) {
  const pane = workspacePaneElement(paneId);
  const container = pane?.querySelector(".tabs");
  const left = pane?.querySelector(".tabs-scroll-left");
  const right = pane?.querySelector(".tabs-scroll-right");
  if (!container || !left || !right) return;
  const overflowing = container.scrollWidth > container.clientWidth + 1;
  left.hidden = !overflowing;
  right.hidden = !overflowing;
  left.disabled = !overflowing || container.scrollLeft <= 1;
  right.disabled = !overflowing || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  pane.querySelector(".tabs-shell")?.classList.toggle("overflowing", overflowing);
};

scrollWorkspaceTabs = function(direction, paneId=currentWorkspacePaneId()) {
  const container = workspacePaneElement(paneId)?.querySelector(".tabs");
  if (!container) return;
  container.scrollBy({left:direction * Math.max(160, container.clientWidth * 0.7), behavior:"smooth"});
};

handleWorkspaceTabsWheel = function(event, paneId=currentWorkspacePaneId()) {
  const container = workspacePaneElement(paneId)?.querySelector(".tabs");
  if (!container || container.scrollWidth <= container.clientWidth + 1) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const canScroll = delta < 0 ? container.scrollLeft > 0 : container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
  if (!delta || !canScroll) return;
  event.preventDefault();
  container.scrollLeft += delta;
};

revealWorkspaceTab = function(key) {
  requestAnimationFrame(() => {
    const pane = workspaceFindPaneForTab(key) || workspaceFindPane(focusedPaneId);
    const container = workspacePaneElement(pane?.id)?.querySelector(".tabs");
    const tabNode = container ? [...container.querySelectorAll(".tab")].find(item => item.dataset.tabKey === key) : null;
    if (!container || !tabNode) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = tabNode.getBoundingClientRect();
    const margin = Math.min(6, Math.max(2, container.clientWidth * 0.02));
    if (tabRect.left < containerRect.left + margin) {
      container.scrollLeft = Math.max(0, container.scrollLeft - (containerRect.left + margin - tabRect.left));
    } else if (tabRect.right > containerRect.right - margin) {
      container.scrollLeft = Math.min(container.scrollWidth - container.clientWidth, container.scrollLeft + (tabRect.right - containerRect.right + margin));
    }
    updateWorkspaceTabScrollControls(pane.id);
  });
};

function saveFocusedSftpPaneState() {
  const pane = workspaceFindPane(focusedPaneId);
  const tab = tabs.find(item => item.key === pane?.activeTabKey);
  if (tab?.kind === "sftp" && typeof rememberSftpViewState === "function") {
    try { rememberSftpViewState(tab.key); } catch {}
  }
}

function focusWorkspacePane(paneId) {
  const pane = workspaceFindPane(paneId);
  if (!pane) return;
  const wasFocused = focusedPaneId === paneId;
  if (!wasFocused) saveFocusedSftpPaneState();
  focusedPaneId = paneId;
  const tab = tabs.find(item => item.key === pane.activeTabKey);
  if (tab) {
    rememberWorkspacePaneTab(pane, tab.key, tab.key);
    activeTabKey = tab.key;
    activeView = tab.viewName || tab.kind || "welcome";
    const connectionId = Number(tab.id);
    if (Number.isInteger(connectionId) && connectionId > 0 && typeof selectedId !== "undefined" && selectedId !== connectionId) {
      if (typeof selectConnection === "function") selectConnection(connectionId);
      else selectedId = connectionId;
    }
    if (typeof restoreSftpRuntimeForTab === "function" && tab.kind === "sftp") restoreSftpRuntimeForTab(tab.key);
    const subtitle = document.getElementById("workspaceSubtitle");
    if (subtitle) subtitle.textContent = tab.subtitle || "";
    revealWorkspaceTab(tab.key);
  }
  if (wasFocused) return;
  syncFocusedWorkspaceClasses();
  for (const node of workspacePaneNodes.values()) node.classList.toggle("focused", node.dataset.paneId === focusedPaneId);
  syncWorkspaceLegacyTabIds();
  syncWorkspaceToolbarPlacements();
  saveTabsState();
}

function syncFocusedWorkspaceClasses() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const viewName = tab?.viewName || tab?.kind || activeView || "welcome";
  const content = document.getElementById("content");
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  content?.classList.toggle("terminal-content", terminalLike);
  content?.classList.toggle("sftp-content", viewName === "sftp");
  document.body.classList.toggle("mobile-terminal-active", isMobileLayout() && terminalLike);
}

function workspaceReplacePaneWithSplit(targetPaneId, splitNode, node=workspaceLayout) {
  if (node.type === "pane") return node.id === targetPaneId ? splitNode : node;
  node.first = workspaceReplacePaneWithSplit(targetPaneId, splitNode, node.first);
  node.second = workspaceReplacePaneWithSplit(targetPaneId, splitNode, node.second);
  return node;
}

function pruneWorkspaceLayout(node=workspaceLayout) {
  if (!node) return null;
  if (node.type === "pane") return node.tabs.length ? node : null;
  node.first = pruneWorkspaceLayout(node.first);
  node.second = pruneWorkspaceLayout(node.second);
  if (!node.first) return node.second;
  if (!node.second) return node.first;
  return node;
}

function normalizeWorkspaceLayoutAfterMutation(preferredPaneId="") {
  workspaceLayout = pruneWorkspaceLayout(workspaceLayout);
  if (!workspaceLayout) {
    const paneId = preferredPaneId || workspaceNextPaneId();
    workspaceLayout = {type:"pane", id:paneId, tabs:[], activeTabKey:""};
  }
  const leaves = workspaceLeaves();
  const byKey = new Map(tabs.map(tab => [tab.key, tab]));
  const assigned = new Set();
  for (const pane of leaves) {
    pane.tabs = pane.tabs.filter(key => {
      if (!byKey.has(key) || assigned.has(key)) return false;
      assigned.add(key);
      return true;
    });
    if (!pane.tabs.includes(pane.activeTabKey)) pane.activeTabKey = pane.tabs[0] || "";
  }
  const preferred = workspaceFindPane(preferredPaneId)
    || workspaceFindPane(focusedPaneId)
    || leaves[0];
  for (const tab of tabs) {
    if (assigned.has(tab.key)) continue;
    preferred.tabs.push(tab.key);
    assigned.add(tab.key);
  }
  if (!preferred.activeTabKey && preferred.tabs.length) preferred.activeTabKey = preferred.tabs[0];
  if (!workspaceFindPane(focusedPaneId)) focusedPaneId = preferred.id;
  const order = workspaceLeaves().flatMap(pane => pane.tabs);
  tabs = order.map(key => byKey.get(key)).filter(Boolean);
  const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  if (focused?.activeTabKey) activeTabKey = focused.activeTabKey;
}

function setPaneActiveKey(pane, key) {
  if (!pane || !pane.tabs.includes(key)) return;
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  if (pane.id === focusedPaneId) activeTabKey = key;
}

addTab = function(key, title, subtitle, viewName, closable=true, meta={}) {
  if (key !== "welcome") {
    tabs = tabs.filter(tab => tab.key !== "welcome");
    for (const pane of workspaceLeaves()) {
      pane.tabs = pane.tabs.filter(tabKey => tabKey !== "welcome");
      if (pane.activeTabKey === "welcome") pane.activeTabKey = pane.tabs[0] || "";
    }
    normalizeWorkspaceLayoutAfterMutation(focusedPaneId);
  }
  if (key === "welcome" && tabs.some(tab => tab.key !== "welcome")) return;
  let pane = workspaceFindPaneForTab(key)
    || workspaceFindPane(workspaceExecutionPaneId)
    || workspaceFindPane(focusedPaneId)
    || workspaceLeaves()[0];
  const insertionAnchorKey = pane?.activeTabKey || activeTabKey;
  let found = tabs.find(tab => tab.key === key);
  if (found) Object.assign(found, {title, subtitle, viewName, closable, ...meta});
  else {
    found = {key, title, subtitle, viewName, closable, ...meta};
    const insertion = tabs.findIndex(tab => tab.key === insertionAnchorKey);
    tabs.splice(insertion >= 0 ? insertion + 1 : tabs.length, 0, found);
  }
  pane = workspaceFindPaneForTab(key) || pane || workspaceLeaves()[0];
  if (!pane.tabs.includes(key)) {
    const insertion = pane.tabs.indexOf(insertionAnchorKey);
    pane.tabs.splice(insertion >= 0 ? insertion + 1 : pane.tabs.length, 0, key);
  }
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  focusedPaneId = pane.id;
  activeTabKey = key;
  activeView = viewName;
  renderTabs();
  revealWorkspaceTab(key);
};

setWorkspaceTabConnectionStatus = function(key, status) {
  const normalized = ["connected", "disconnected", "connecting"].includes(status) ? status : "disconnected";
  const matchingTabs = workspaceTabsByKey(key);
  if (!matchingTabs.length) return;
  for (const tab of matchingTabs) tab.connectionStatus = normalized;
  document.querySelectorAll(`.workspace-pane .tab[data-tab-key="${workspaceCssEscape(key)}"] .tab-connection-dot`).forEach(dot => {
    dot.className = `tab-connection-dot ${normalized}`;
    dot.title = tr(`common:auto.${normalized === "connected" ? "connected" : normalized === "disconnected" ? "disconnected" : "connecting"}`, {defaultValue:normalized === "connected" ? "Connected" : normalized === "disconnected" ? "Disconnected" : "Connecting"});
  });
};

renderTabContent = function(tab) {
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
};

function renderWorkspacePaneContent(paneId) {
  if (!workspaceDockElement()) return null;
  if (isMobileLayout() && paneId !== focusedPaneId) return null;
  const pane = workspaceFindPane(paneId);
  const tab = tabs.find(item => item.key === pane?.activeTabKey);
  if (!pane || !tab) return null;
  const previousExecutionPane = workspaceExecutionPaneId;
  const previousActiveKey = activeTabKey;
  const previousActiveView = activeView;
  workspaceExecutionPaneId = paneId;
  activeTabKey = tab.key;
  activeView = tab.viewName || tab.kind || "welcome";
  try {
    const result = renderTabContent(tab);
    if (result?.catch) {
      result.catch(error => {
        const previousPane = workspaceExecutionPaneId;
        workspaceExecutionPaneId = paneId;
        try { notify(error.message || String(error), "error"); }
        finally { workspaceExecutionPaneId = previousPane; }
      });
    }
    return result;
  } finally {
    workspaceExecutionPaneId = previousExecutionPane;
    if (paneId !== focusedPaneId) {
      activeTabKey = previousActiveKey;
      activeView = previousActiveView;
    }
  }
}

activateTab = function(key) {
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  if (!tab || !pane) return;
  const previousTab = tabs.find(item => item.key === pane.activeTabKey);
  if (previousTab?.kind === "command" && previousTab.key !== key && typeof rememberBatchCommandDraft === "function") {
    runInWorkspacePane(pane.id, () => rememberBatchCommandDraft(currentBatchRoot(), previousTab.key));
  }
  saveFocusedSftpPaneState();
  focusedPaneId = pane.id;
  rememberWorkspacePaneTab(pane, key, pane.activeTabKey);
  pane.activeTabKey = key;
  activeTabKey = key;
  activeView = tab.viewName || tab.kind || "welcome";
  if (typeof restoreSftpRuntimeForTab === "function" && tab.kind === "sftp") restoreSftpRuntimeForTab(tab.key);
  renderTabs();
  revealWorkspaceTab(key);
  renderWorkspacePaneContent(pane.id);
  syncFocusedWorkspaceClasses();
  syncWorkspaceToolbarPlacements();
};

setWorkspace = function(title, subtitle, viewName, key=viewName, updateTab=true, closable=true, meta={}) {
  if (!workspaceDockElement()) return legacyWorkspaceApi.setWorkspace(title, subtitle, viewName, key, updateTab, closable, meta);
  const existingPane = workspaceFindPaneForTab(activeTabKey) || workspaceFindPaneForTab(key);
  const paneId = workspaceExecutionPaneId || existingPane?.id || focusedPaneId;
  if (updateTab) addTab(key, title, subtitle, viewName, closable, meta);
  const resolvedPaneId = workspaceExecutionPaneId || workspaceFindPaneForTab(activeTabKey)?.id || paneId;
  const pane = ensureWorkspacePaneElement(resolvedPaneId);
  const workspace = pane.querySelector(".workspace");
  const view = workspace.querySelector(`#view-${workspaceCssEscape(viewName)}`);
  workspace.querySelectorAll(":scope > .view").forEach(item => { item.hidden = true; });
  if (view) view.hidden = false;
  pane.dataset.activeView = viewName;
  const terminalLike = ["terminal", "remote-terminal"].includes(viewName);
  workspace.classList.toggle("terminal-workspace", terminalLike);
  pane.classList.toggle("terminal-pane", terminalLike);
  pane.classList.toggle("sftp-pane", viewName === "sftp");
  if (resolvedPaneId === focusedPaneId) {
    const heading = document.getElementById("workspaceTitle");
    const description = document.getElementById("workspaceSubtitle");
    if (heading) heading.textContent = tr("navigation:auto.workspace", {defaultValue:"Workspace"});
    if (description) description.textContent = subtitle || "";
    activeView = viewName;
    if (typeof syncWorkspaceDocumentTitle === "function") syncWorkspaceDocumentTitle(title, subtitle, viewName, key, meta);
    syncFocusedWorkspaceClasses();
  }
  const previousExecutionPane = workspaceExecutionPaneId;
  workspaceExecutionPaneId = resolvedPaneId;
  try {
    syncWorkspaceToolbarPlacements();
  } finally {
    workspaceExecutionPaneId = previousExecutionPane;
  }
  if (isMobileLayout() && viewName !== "welcome" && resolvedPaneId === focusedPaneId && !window.restoringTabs) showMobileWorkspace();
};

closeTab = function(event, key) {
  event.stopPropagation();
  void requestCloseTabsByKey([key], key);
};

function workspaceTabNeedsCloseConfirmation(tab) {
  if (!tab) return false;
  if (tab.kind === "remote-desktop" && tab.protocol !== "vnc") return false;
  if (["connected", "connecting"].includes(tab.connectionStatus)) return true;
  if (tab.connectionStatus === "disconnected") return false;
  const socketIsActive = socket => socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState);
  if (socketIsActive(terminalSessions.get(tab.key)?.socket)) return true;
  if (typeof remoteTerminalSessions !== "undefined" && socketIsActive(remoteTerminalSessions.get(tab.key)?.socket)) return true;
  if (typeof vncSessions !== "undefined") {
    const session = vncSessions.get(tab.key);
    if (session?.connected || session?.connecting || ["connected", "connecting"].includes(session?.statusState)) return true;
  }
  return false;
}

function confirmWorkspaceConnectedTabClose(tabsToClose) {
  return new Promise(resolve => {
    const modal = $("modal");
    const multiple = tabsToClose.length > 1;
    const currentTabTitle = tabsToClose[0].title || tr("common:dialogs.current_tab", {defaultValue:"Current tab"});
    const currentStatus = tr(`common:auto.${tabsToClose[0].connectionStatus === "connecting" ? "connecting" : "connected"}`, {
      defaultValue:tabsToClose[0].connectionStatus === "connecting" ? "Connecting" : "Connected"
    });
    const message = multiple
      ? tr("common:dialogs.connected_tabs_many", {
        count:tabsToClose.length,
        defaultValue:`${tabsToClose.length} tabs are still connected or connecting. Closing them will disconnect their sessions. Continue?`
      })
      : tr("common:dialogs.connected_tab_one", {
        title:currentTabTitle,
        status:currentStatus,
        defaultValue:`“${currentTabTitle}” is still ${currentStatus}. Closing it will disconnect the session. Continue?`
      });
    const items = multiple
      ? `<ul class="workspace-close-tabs-list">${tabsToClose.map(tab => `<li><strong data-i18n-skip>${esc(tab.title || tr("common:dialogs.unnamed_tab", {defaultValue:"Unnamed tab"}))}</strong><span>${esc(tr(`common:auto.${tab.connectionStatus === "connecting" ? "connecting" : "connected"}`, {defaultValue:tab.connectionStatus === "connecting" ? "Connecting" : "Connected"}))}</span></li>`).join("")}</ul>`
      : "";
    const finish = value => {
      modal.onclick = null;
      modal.onkeydown = null;
      modal.hidden = true;
      modal.innerHTML = "";
      resolve(value);
    };
    modal.onclick = null;
    modal.innerHTML = `<div class="modal-card workspace-close-tabs-modal" role="alertdialog" aria-modal="true" aria-labelledby="workspaceCloseTabsTitle" aria-describedby="workspaceCloseTabsMessage">
      <h2 id="workspaceCloseTabsTitle">${esc(tr("common:dialogs.connected_tabs_title", {defaultValue:"Close connected tabs?"}))}</h2>
      <div id="workspaceCloseTabsMessage" class="modal-message">${esc(message)}</div>
      ${items}
      <div class="actions"><button id="workspaceCloseTabsCancel" type="button">${esc(tr("common:actions.cancel", {defaultValue:"Cancel"}))}</button><button id="workspaceCloseTabsConfirm" class="danger" type="button">${icon("link-2-off")}<span>${esc(tr("common:dialogs.disconnect_close", {defaultValue:"Disconnect and close"}))}</span></button></div>
    </div>`;
    modal.hidden = false;
    $("workspaceCloseTabsCancel").onclick = () => finish(false);
    $("workspaceCloseTabsConfirm").onclick = () => finish(true);
    modal.onkeydown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };
    $("workspaceCloseTabsCancel").focus();
  });
}

requestCloseTabsByKey = async function(keys, anchorKey="") {
  const activeTabs = [...new Set(keys)]
    .map(key => tabs.find(tab => tab.key === key))
    .filter(tab => tab?.closable && !tab.pinned && workspaceTabNeedsCloseConfirmation(tab));
  if (activeTabs.length && !await confirmWorkspaceConnectedTabClose(activeTabs)) return;
  closeTabsByKey(keys, anchorKey);
};

closeTabsByKey = function(keys, anchorKey="") {
  const targets = new Set(keys.filter(key => !tabs.find(item => item.key === key)?.pinned));
  if (!targets.size) {
    if (keys.length) notify(tr("common:notifications.pinned_tabs_close", {defaultValue:"Unpin pinned tabs before closing them"}), "info");
    return;
  }
  if (typeof rememberClosedWorkspaceTabs === "function") rememberClosedWorkspaceTabs([...targets]);
  const anchorPane = workspaceFindPaneForTab(anchorKey) || workspaceFindPane(focusedPaneId);
  for (const key of targets) {
    const tab = tabs.find(item => item.key === key);
    closeTerminalSession(key);
    if (typeof closeRemoteProtocolSession === "function") closeRemoteProtocolSession(key);
    if (typeof ftpProfileStates !== "undefined") ftpProfileStates.delete(key);
    if (tab?.kind === "sftp" && typeof closeSftpSession === "function") closeSftpSession(key);
    if (tab?.kind === "log" && typeof disposeLogViewerState === "function") disposeLogViewerState(key);
    sftpDisconnectedTabs.delete(key);
    sftpViewStates.delete(key);
    if (typeof clearSftpDirectoryViewCache === "function") clearSftpDirectoryViewCache(key);
    if (tab?.kind === "command") {
      stopBatchCommand(key);
      if (typeof resetBatchCommandDraft === "function") resetBatchCommandDraft(key);
    }
  }
  tabs = tabs.filter(tab => !targets.has(tab.key));
  for (const pane of workspaceLeaves()) {
    const previousIndex = Math.max(0, pane.tabs.findIndex(key => targets.has(key)));
    const recentKey = targets.has(pane.activeTabKey) ? recentWorkspacePaneTab(pane, targets) : "";
    pane.tabs = pane.tabs.filter(key => !targets.has(key));
    if (!pane.tabs.includes(pane.activeTabKey)) {
      pane.activeTabKey = recentKey || pane.tabs[Math.min(previousIndex, pane.tabs.length - 1)] || pane.tabs.at(-1) || "";
    }
    trimWorkspacePaneTabHistory(pane);
    if (pane.activeTabKey) rememberWorkspacePaneTab(pane, pane.activeTabKey, pane.activeTabKey);
  }
  normalizeWorkspaceLayoutAfterMutation(anchorPane?.id || focusedPaneId);
  const focusedPane = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
  focusedPaneId = focusedPane.id;
  activeTabKey = focusedPane.activeTabKey || "";
  renderTabs();
  if (activeTabKey) {
    const tab = tabs.find(item => item.key === activeTabKey);
    activeView = tab?.viewName || tab?.kind || "welcome";
    renderWorkspacePaneContent(focusedPane.id);
  } else renderWelcome();
};

closeTabsByMode = function(mode, key) {
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return;
  const paneTabs = pane.tabs.map(tabKey => tabs.find(tab => tab.key === tabKey)).filter(Boolean);
  const index = paneTabs.findIndex(tab => tab.key === key);
  const closable = paneTabs.filter(tab => tab.closable);
  let targets = [];
  if (mode === "current") targets = closable.filter(tab => tab.key === key);
  if (mode === "others") targets = closable.filter(tab => tab.key !== key);
  if (mode === "right") targets = paneTabs.slice(index + 1).filter(tab => tab.closable);
  if (mode === "all") targets = closable;
  hideTabContextMenu();
  if (targets.length) void requestCloseTabsByKey(targets.map(tab => tab.key), key);
};

moveWorkspaceTab = function(key, offset) {
  const pane = workspaceFindPaneForTab(key);
  if (!pane) return hideTabContextMenu();
  const index = pane.tabs.indexOf(key);
  const target = Math.max(0, Math.min(pane.tabs.length - 1, index + offset));
  if (index < 0 || target === index) return hideTabContextMenu();
  pane.tabs.splice(index, 1);
  pane.tabs.splice(target, 0, key);
  normalizeWorkspaceLayoutAfterMutation(pane.id);
  hideTabContextMenu();
  renderTabs();
  revealWorkspaceTab(key);
};

function nextWorkspaceTabCopyKey(tab) {
  const base = String(tab?.key || tab?.kind || "tab").replace(/-copy-\d+$/, "");
  let key = "";
  do {
    workspaceTabCopySerial += 1;
    key = `${base}-copy-${workspaceTabCopySerial}`;
  } while (tabs.some(item => item.key === key));
  return key;
}

function workspaceTabCopyTitle(tab) {
  if (tab?.kind === "local-files") return tr("common:auto.local_files", {defaultValue:"Local Files"});
  const copySuffix = tr("common:workspace.copy_suffix", {defaultValue:" · Copy"});
  let base = String(tab?.title || tr("navigation:auto.tab", {defaultValue:"Tab"}));
  const suffixIndex = base.lastIndexOf(copySuffix);
  if (suffixIndex >= 0 && /^(?: \d+)?$/.test(base.slice(suffixIndex + copySuffix.length))) {
    base = base.slice(0, suffixIndex);
  }
  const copyCount = tabs.filter(item => String(item.title || "").startsWith(`${base}${copySuffix}`)).length + 1;
  return tr(copyCount > 1 ? "common:workspace.copy_title_numbered" : "common:workspace.copy_title", {
    base,
    count:copyCount,
    defaultValue:copyCount > 1 ? `${base} · Copy ${copyCount}` : `${base} · Copy`
  });
}

function workspaceTerminalCopyIdentity(tab) {
  if (tab?.kind !== "terminal") return null;
  const connectionId = Number(tab.id || 0);
  if (!connectionId) return null;
  let index;
  if (typeof nextTerminalTabIndex === "function") index = nextTerminalTabIndex(connectionId);
  else {
    index = tabs.reduce((maximum, item) => {
      if (item.kind !== "terminal" || Number(item.id) !== connectionId) return maximum;
      const match = String(item.key || "").match(new RegExp(`^terminal-${connectionId}-(\\d+)$`));
      return Math.max(maximum, Number(match?.[1] || 0));
    }, 0) + 1;
  }
  const connection = typeof currentConnection === "function" ? currentConnection(connectionId) : null;
  const terminalLabel = tr("common:auto.terminal", {defaultValue:"Terminal"});
  const fallbackBase = String(tab.title || terminalLabel).replace(/\s+#\d+$/, "");
  const baseTitle = connection?.name ? `${connection.name} · ${terminalLabel}` : fallbackBase;
  return {
    key:`terminal-${connectionId}-${index}`,
    title:index > 1 ? `${baseTitle} #${index}` : baseTitle
  };
}

function addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle) {
  const {
    key:ignoredKey,
    title:ignoredTitle,
    subtitle,
    viewName,
    closable,
    ...meta
  } = tab;
  addTab(duplicateKey, duplicateTitle, subtitle, viewName, closable !== false, meta);
}

function duplicateWorkspaceTab(key, options={}) {
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  if (!tab || !pane) return "";
  hideTabContextMenu();
  focusedPaneId = pane.id;
  setPaneActiveKey(pane, key);
  activeView = tab.viewName || tab.kind || "welcome";
  const terminalIdentity = workspaceTerminalCopyIdentity(tab);
  const duplicateKey = terminalIdentity?.key || nextWorkspaceTabCopyKey(tab);
  const duplicateTitle = terminalIdentity?.title || workspaceTabCopyTitle(tab);
  if (typeof options.beforeOpen === "function") {
    options.beforeOpen(duplicateKey, duplicateTitle, tab);
  } else if (
    tab.kind === "terminal"
    && typeof terminalStartupOverrides !== "undefined"
    && terminalStartupOverrides.has(key)
  ) {
    terminalStartupOverrides.set(duplicateKey, terminalStartupOverrides.get(key));
  }
  const splitZone = !isMobileLayout() && ["left", "right", "top", "bottom"].includes(options.splitZone)
    ? options.splitZone
    : "";
  if (splitZone) {
    addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle);
    const openedInSplit = applyWorkspaceTabDrop(
      {key:duplicateKey},
      {paneId:pane.id, zone:splitZone}
    );
    if (!openedInSplit) activateTab(duplicateKey);
    if (options.result && typeof options.result === "object") {
      Object.assign(options.result, {key:duplicateKey, opened:true, split:Boolean(openedInSplit)});
    }
    return duplicateKey;
  }
  if (tab.kind === "terminal") {
    const openedKey = openTerminal(tab.id, true, duplicateKey, duplicateTitle);
    if (!openedKey) {
      if (typeof terminalStartupOverrides !== "undefined") terminalStartupOverrides.delete(duplicateKey);
      if (options.result && typeof options.result === "object") {
        Object.assign(options.result, {key:"", opened:false, split:false});
      }
      return "";
    }
    if (options.result && typeof options.result === "object") {
      Object.assign(options.result, {key:duplicateKey, opened:true, split:false});
    }
    return duplicateKey;
  }
  if (tab.kind === "sftp") {
    if (typeof duplicateSftpTab === "function") return duplicateSftpTab(key);
    return openSftp(tab.id, tab.path || ".", true, duplicateKey);
  }
  if (tab.kind === "local-files" && typeof openLocalFiles === "function") {
    return openLocalFiles(tab.path || "", true, duplicateKey);
  }
  addWorkspaceTabCopy(tab, duplicateKey, duplicateTitle);
  renderWorkspacePaneContent(pane.id);
  return duplicateKey;
};

function workspaceCanDuplicateTab(tab) {
  return Boolean(tab?.kind);
}

function toggleWorkspaceTabPinned(key) {
  const tab = tabs.find(item => item.key === key);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  hideTabContextMenu();
  renderTabs();
  saveTabsState();
}

showTabContextMenu = function(event, key) {
  event.preventDefault();
  event.stopPropagation();
  hideTabContextMenu();
  const tab = tabs.find(item => item.key === key);
  const pane = workspaceFindPaneForTab(key);
  const paneTabs = pane?.tabs || [];
  const index = paneTabs.indexOf(key);
  if (!tab || !pane || index < 0) return;
  focusWorkspacePane(pane.id);
  const options = [
    [tr("navigation:auto.combine_workspace", {defaultValue:"Combine into workspace"}), () => beginWorkspaceGroupSelection(key), true, "combine"],
    [tr(tab.pinned ? "common:auto.unpin_tab" : "common:auto.pin_tab", {defaultValue:tab.pinned ? "Unpin tab" : "Pin tab"}), () => toggleWorkspaceTabPinned(key), true, "pin"],
    ...(tab.kind === "terminal" ? [[tr(tab.notificationsMuted ? "navigation:auto.enable_tab_notifications" : "navigation:auto.mute_tab_notifications", {defaultValue:tab.notificationsMuted ? "Enable notifications for this tab" : "Mute notifications for this tab"}), () => toggleTabNotifications(key), true, tab.notificationsMuted ? "bell" : "bell-off"]] : []),
    [tr("common:auto.duplicate_tab", {defaultValue:"Duplicate tab"}), () => duplicateWorkspaceTab(key), workspaceCanDuplicateTab(tab), "copy"],
    [tr("common:auto.move_left", {defaultValue:"Move left"}), () => moveWorkspaceTab(key, -1), index > 0, "arrow-left"],
    [tr("common:auto.move_right", {defaultValue:"Move right"}), () => moveWorkspaceTab(key, 1), index < paneTabs.length - 1, "arrow-right"],
    [tr("common:auto.close_current_tab", {defaultValue:"Close current tab"}), () => closeTabsByMode("current", key), Boolean(tab.closable && !tab.pinned), "x"],
    [tr("common:auto.close_other_tabs", {defaultValue:"Close other tabs"}), () => closeTabsByMode("others", key), paneTabs.some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned && tabKey !== key), "circle-x"],
    [tr("common:auto.close_right_tabs", {defaultValue:"Close tabs to the right"}), () => closeTabsByMode("right", key), paneTabs.slice(index + 1).some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned), "panel-right-close"],
    [tr("navigation:auto.close_pane_tabs", {defaultValue:"Close tabs in this pane"}), () => closeTabsByMode("all", key), paneTabs.some(tabKey => tabs.find(item => item.key === tabKey)?.closable && !tabs.find(item => item.key === tabKey)?.pinned), "panel-top-close"]
  ];
  const menu = document.createElement("div");
  menu.id = "tabContextMenu";
  menu.className = "context-menu tab-context-menu";
  for (const [label, action, enabled, iconName] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `${icon(iconName)}<span>${esc(label)}</span>`;
    button.disabled = !enabled;
    button.onclick = action;
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
};
