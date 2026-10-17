// Mobile navigation is a view of the existing workspace tabs, never a new session.
function renderMobileWorkspaceTabs() {
  const lists = ["mobileWorkspaceTabs", "mobileExplorerTabs"].map(id => document.getElementById(id)).filter(Boolean);
  if (!isMobileLayout()) {
    for (const list of lists) list.hidden = true;
    return;
  }
  if (!lists.length) return;
  const opened = tabs.filter(tab => tab.kind !== "welcome" && tab.viewName !== "welcome");
  const label = tr("navigation:mobile.open_tabs");
  const markup = opened.map(tab => {
    const title = localizedWorkspaceTabTitle(tab);
    const presentation = workspaceTabPresentation({...tab, title});
    const status = workspaceTabConnectionStateText(tab.connectionStatus);
    const accessible = [title, status].filter(Boolean).join(" · ");
    const selected = tab.key === activeTabKey;
    const closeLabel = `${tr("navigation:auto.close_tab")} · ${title}`;
    const close = tab.closable && !tab.pinned ? `<button type="button" class="mobile-workspace-tab-close" aria-label="${escAttr(closeLabel)}" title="${escAttr(closeLabel)}" data-tab-key="${escAttr(tab.key)}" data-pointerdown-action="workspace-event-stop" data-action="workspace-tab-close">×</button>` : "";
    const dot = tab.connectionStatus ? `<span class="tab-connection-dot ${["connected", "connecting"].includes(tab.connectionStatus) ? tab.connectionStatus : "disconnected"}" aria-hidden="true"></span>` : "";
    return `<div class="mobile-workspace-tab${selected ? " active" : ""}" role="presentation"><button type="button" class="mobile-workspace-tab-main" role="tab" aria-selected="${selected}" aria-label="${escAttr(accessible)}" title="${escAttr(accessible)}" data-action="mobile-workspace-tab-activate" data-tab-key="${escAttr(tab.key)}">${dot}${presentation.icon}<span class="mobile-workspace-tab-title">${esc(presentation.title)}</span></button>${close}</div>`;
  }).join("");
  for (const list of lists) {
    list.hidden = !opened.length;
    list.setAttribute("aria-label", label);
    if (list.innerHTML !== markup) {
      const previousScroll = list.scrollLeft;
      list.innerHTML = markup;
      list.scrollLeft = previousScroll;
    }
    if (list.hidden || !list.getBoundingClientRect().width) continue;
    const active = list.querySelector('[aria-selected="true"]')?.closest(".mobile-workspace-tab");
    if (!active) continue;
    const bounds = list.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < bounds.left) list.scrollLeft -= bounds.left - item.left;
    else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
  }
}

if (typeof registerTermaAction === "function") registerTermaAction("mobile-workspace-tab-activate", ({element}) => {
  const key = element.dataset.tabKey;
  if (!tabs.some(tab => tab.key === key)) return;
  activateTab(key);
  showMobileWorkspace();
});
