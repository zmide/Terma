function installProductivityHeaderButton() {
  const host = document.getElementById("workspaceQuickActions");
  if (!document.getElementById("quickPanelButton")) {
    const button = document.createElement("button");
    button.id = "quickPanelButton";
    button.className = "icon-button quick-panel-button";
    button.title = tr("common:auto.quick_open_shortcut", {shortcut:"Ctrl+K"});
    button.setAttribute("aria-label", tr("common:auto.quick_open"));
    button.innerHTML = icon("zap");
    button.onclick = openQuickPanel;
    if (host) host.appendChild(button);
    else document.getElementById("sftpTaskCenter")?.before(button);
  }
  installXServerQuickAction(host);
}

let xServerQuickStatusTimer = 0;
let xServerQuickStatusVisibilityBound = false;

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
    button.title = tr("remote:xserver.quick_status");
    button.setAttribute("aria-label", tr("remote:xserver.quick_status"));
    button.onclick = () => openXServerManager();
    host.appendChild(button);
  }
  refreshXServerQuickAction();
  if (!xServerQuickStatusTimer) {
    const schedule = delay => {
      clearTimeout(xServerQuickStatusTimer);
      xServerQuickStatusTimer = window.setTimeout(async () => {
        if (!document.hidden) await refreshXServerQuickAction();
        schedule(30000);
      }, Math.max(0, Number(delay || 0)));
    };
    schedule(30000);
    if (!xServerQuickStatusVisibilityBound) {
      xServerQuickStatusVisibilityBound = true;
      window.addEventListener("focus", () => {
        clearTimeout(xServerQuickStatusTimer);
        xServerQuickStatusTimer = 0;
        void refreshXServerQuickAction();
        schedule(30000);
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          clearTimeout(xServerQuickStatusTimer);
          xServerQuickStatusTimer = 0;
          void refreshXServerQuickAction();
          schedule(30000);
        }
      });
    }
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
        ? tr("remote:xserver.running_unauthorized")
        : tr("remote:xserver.browser_unauthorized")
      : diagnostics?.available ? tr("remote:xserver.ready") : diagnostics?.running ? tr("remote:xserver.running") : tr("remote:xserver.stopped");
    const className = `icon-button xserver-quick-button ${state}`;
    const title = `${label}${diagnostics?.display ? ` · ${diagnostics.display}` : ""}${localDirectAuthorized ? ` · ${tr("remote:xserver.local_direct_authorized")}` : ""}${authorizationRequired ? ` · ${tr("remote:xserver.request_authorization")}` : ""}`;
    if (button.className !== className) button.className = className;
    if (button.title !== title) {
      button.title = title;
      button.setAttribute("aria-label", title);
    }
    if (!button.querySelector(".xserver-x-icon")) button.innerHTML = xServerQuickIcon();
  } catch {
    const title = tr("remote:xserver.unavailable");
    if (button.className !== "icon-button xserver-quick-button error") button.className = "icon-button xserver-quick-button error";
    if (button.title !== title) {
      button.title = title;
      button.setAttribute("aria-label", title);
    }
    if (!button.querySelector(".xserver-x-icon")) button.innerHTML = xServerQuickIcon();
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
