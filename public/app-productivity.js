function installProductivityHeaderButton() {
  const host = document.getElementById("workspaceQuickActions");
  if (!document.getElementById("quickPanelButton")) {
    const button = document.createElement("button");
    button.id = "quickPanelButton";
    button.className = "icon-button quick-panel-button";
    button.title = "快速打开（Ctrl+K）";
    button.setAttribute("aria-label", "快速打开");
    button.innerHTML = icon("zap");
    button.onclick = openQuickPanel;
    if (host) host.appendChild(button);
    else document.getElementById("sftpTaskCenter")?.before(button);
  }
  installXServerQuickAction(host);
}

let xServerQuickStatusTimer = 0;

function xServerQuickIcon() {
  return '<svg class="xserver-x-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.8" ry="5.2" transform="rotate(-10 12 12)"></ellipse><path d="M7.5 5.5 16.5 18.5M16.5 5.5 7.5 18.5"></path></svg>';
}

function installXServerQuickAction(host = document.getElementById("workspaceQuickActions")) {
  if (!host || typeof openXServerManager !== "function") return;
  let button = document.getElementById("xServerQuickButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "xServerQuickButton";
    button.className = "icon-button xserver-quick-button";
    button.title = "X Server 状态";
    button.setAttribute("aria-label", "X Server 状态");
    button.onclick = () => openXServerManager();
    host.appendChild(button);
  }
  refreshXServerQuickAction();
  if (!xServerQuickStatusTimer) {
    xServerQuickStatusTimer = window.setInterval(() => {
      if (!document.hidden) refreshXServerQuickAction();
    }, 8000);
  }
}

async function refreshXServerQuickAction() {
  const button = document.getElementById("xServerQuickButton");
  if (!button) return;
  try {
    const diagnostics = await api("/api/xserver");
    const authorizationRequired = Boolean(diagnostics?.authorization_required);
    const localDirectAuthorized = diagnostics?.authorization_kind === "local-direct";
    const state = diagnostics?.available && !authorizationRequired ? "ready" : diagnostics?.running || authorizationRequired ? "warning" : "error";
    const label = authorizationRequired
      ? diagnostics?.available || diagnostics?.running
        ? "X Server 已运行，当前浏览器未授权"
        : "当前浏览器未获得 X Server 授权"
      : diagnostics?.available ? "X Server 已就绪" : diagnostics?.running ? "X Server 正在运行" : "X Server 未启动";
    button.className = `icon-button xserver-quick-button ${state}`;
    button.title = `${label}${diagnostics?.display ? ` · ${diagnostics.display}` : ""}${localDirectAuthorized ? " · 本机直连自动授权" : ""}${authorizationRequired ? " · 点击申请授权" : ""}`;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = xServerQuickIcon();
    refreshIcons();
  } catch {
    button.className = "icon-button xserver-quick-button error";
    button.title = "X Server 状态不可用";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = xServerQuickIcon();
    refreshIcons();
  }
}

function installProductivityKeyboard() {
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openQuickPanel();
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      restoreRecentlyClosedTab();
    } else if (event.key === "Escape" && productivityState.broadcastTargets.size >= 2) {
      stopTerminalBroadcast();
    }
  });
}

function installProductivityTabHooks() {
  const originalActivateTab = activateTab;
  activateTab = function(key) {
    markWorkspaceTabViewed(key);
    return originalActivateTab(key);
  };
  const originalCloseTabsByKey = closeTabsByKey;
  closeTabsByKey = function(keys, anchorKey="") {
    const result = originalCloseTabsByKey(keys, anchorKey);
    if (!productivityState.broadcastTargets.size) return result;
    const remaining = terminalBroadcastKeys();
    if (remaining.length < 2) stopTerminalBroadcast();
    else if (remaining.length !== productivityState.broadcastTargets.size) {
      productivityState.broadcastTargets = new Set(remaining);
      updateTerminalBroadcastBar();
    }
    return result;
  };
}

function initProductivityFeatures() {
  ensureTermaActions();
  loadClosedWorkspaceTabs();
  installProductivityHeaderButton();
  installProductivityKeyboard();
  installProductivityTabHooks();
  loadCommandSnippets();
  loadNamedWorkspaces();
  detectSshConfigOnFirstUse();
  refreshIcons();
}
