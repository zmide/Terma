// Shared mutable state is declared here. Feature files own behavior; this file owns lifetimes.
const TERMA_STATE_OWNERS = Object.freeze({
  navigation:["activeView", "primaryView", "tabs", "activeTabKey"],
  connections:["connections", "selectedId", "connectionSearch", "connectionBulkMode", "selectedConnectionIds", "healthResults"],
  remote:["remoteProfiles", "selectedRemoteProfileId", "remoteConnectionSearch", "remoteDesktopQuickOpen"],
  terminal:["terminalSessions", "terminalCounts", "terminalFontSize", "terminalGlobalSettings", "terminalKeysVisible"],
  sftp:["sftpState", "sftpClipboard", "sftpViewStates", "sftpFavorites", "sftpJobsTimer"],
  settings:["securitySettings", "operationPaneCollapsed", "operationPanePinnedByView"],
  logs:["logsData", "logSearch", "logViewerState", "logPage"]
});

const $ = id => {
  const scope = typeof currentWorkspaceDomScope === "function"
    ? currentWorkspaceDomScope()
    : null;
  return scope?.querySelector(`#${CSS.escape(id)}`)
    || document.getElementById(id);
};
let connections = [], selectedId = null, activeView = "welcome", primaryView = "connections";
let remoteProfiles = [], selectedRemoteProfileId = null;
let importState = {tunnels: [], missing_keys: []};
const groupOpen = loadGroupState();
const remoteGroupOpen = loadRemoteGroupState();
const remoteHostOpen = loadRemoteHostState();
const runningOpen = loadRunningState();
const logOpen = loadLogState();
const logPage = new Map();
let logsData = {system: [], connections: []};
let pendingGroup = "";
let tabs = [];
let activeTabKey = "";
const terminalSessions = new Map();
const terminalCounts = new Map();
let terminalLatencyVisible = localStorage.getItem("terminalLatencyVisible") !== "0";
let TerminalClass = null;
let FitAddonClass = null;
let addingGroup = false;
let pendingGroupSelectValue = "";
let terminalFontSize = Number(localStorage.getItem("terminalFontSize") || 13);
let terminalGlobalSettings = null;
let terminalGlobalSettingsPromise = null;
let refreshInFlight = false;
let connectionSearch = localStorage.getItem("connectionSearch") || "";
let remoteConnectionSearch = localStorage.getItem("remoteConnectionSearch") || "";
let remoteDesktopQuickOpen = localStorage.getItem("remoteDesktopQuickOpen") === "1";
let connectionBulkMode = false;
const selectedConnectionIds = new Set();
let logSearch = "";
let logViewerState = null;
let logSearchTimer = null;
const healthResults = new Map();
if (!localStorage.getItem("terminalKeysDefaultCollapsedV2")) {
  localStorage.setItem("terminalKeysVisible", "0");
  localStorage.setItem("terminalKeysDefaultCollapsedV2", "1");
}
let terminalKeysVisible = localStorage.getItem("terminalKeysVisible") === "1";
let terminalCtrlArmed = false;
let terminalCtrlLocked = false;
const connectionVirtual = { rowHeight: 118, buffer: 8, scrollTop: 0 };
let commandTemplates = [];
let editingTemplateId = "";
let editingForwardId = 0;
let editingForwardTemplateId = "";
let forwardTemplates = [];
let runningGroupMode = localStorage.getItem("runningGroupMode") || "server";
let sftpClipboard = null;
let sftpState = { path: ".", entries: [], query: "", sort: "name", dir: "asc", connectionId: 0, selected: null, page: 1, pageSize: 50, total: 0, totalPages: 1, unfilteredTotal: 0, loading: false, requestSeq: 0 };
const sftpDisconnectedTabs = new Set();
const sftpViewStates = new Map();
const sftpDirectoryViewCache = new Map();
const sftpDirectoryViewAliases = new Map();
const sftpDirectorySizeCache = new Map();
let sftpSearchTimer = null;
let sftpRequestController = null;
let sftpFavorites = JSON.parse(localStorage.getItem("sftpFavorites") || "[]");
let operationPaneCollapsed = localStorage.getItem("operationPaneCollapsed") === "1";
let operationPanePinnedByView = loadOperationPanePinnedState();
let runningFilter = localStorage.getItem("runningFilter") || "";
let securitySettings = null;
let startupSummaryStatus = null;
let sftpJobsTimer = null;
let lastNotificationId = Number(localStorage.getItem("lastNotificationId") || 0);
let notificationCursorInitialized = false;
let notificationCursorPromise = null;
let recentTerminalCommands = loadRecentTerminalCommands();

window.TermaState = Object.freeze({
  owners:TERMA_STATE_OWNERS,
  snapshot:() => ({
    navigation:{ activeView, primaryView, activeTabKey, tabCount:tabs.length },
    connections:{ selectedId, count:connections.length, search:connectionSearch, bulk:connectionBulkMode },
    remote:{ selectedId:selectedRemoteProfileId, count:remoteProfiles.length, search:remoteConnectionSearch },
    terminal:{ sessions:terminalSessions.size, fontSize:terminalFontSize },
    sftp:{ connectionId:sftpState.connectionId, path:sftpState.path, jobsTimer:Boolean(sftpJobsTimer) },
    settings:{ encryptionEnabled:Boolean(securitySettings?.encryption_enabled) }
  })
});
