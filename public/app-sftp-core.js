let sftpListResizeObserver = null;
let sftpListResizeFrame = 0;
const sftpKnownJobStatuses = new Map();
const sftpPendingDirectoryRefreshes = new Set();
const sftpDismissedFloatingJobIds = new Set();
const SFTP_ACTIVE_JOB_STATUSES = new Set(["running", "pending", "paused"]);
const SFTP_MUTATING_JOB_TYPES = new Set(["upload", "copy", "cross-copy", "move", "extract", "compress", "delete", "sync", "local-delivery"]);
const SFTP_DIRECTORY_VIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const SFTP_DIRECTORY_VIEW_CACHE_MAX_DIRECTORIES = 60;
const SFTP_DIRECTORY_VIEW_CACHE_MAX_ENTRIES = 5000;
const SFTP_DIRECTORY_SIZE_CACHE_TTL_MS = 10 * 60 * 1000;
const SFTP_DIRECTORY_SIZE_CACHE_MAX_ENTRIES = 200;
const SFTP_NATIVE_DRAG_CACHE_TTL_MS = 9 * 60 * 1000;
const SFTP_DROP_LEAVE_GRACE_MS = 90;
const SFTP_NATIVE_TARGET_MISS_GRACE_MS = 180;
const SFTP_NATIVE_DRAG_ACTIVE_TTL_MS = 2 * 60 * 1000;
const SFTP_DRAG_FEEDBACK_STALE_MS = 900;
const SFTP_INTERNAL_DRAG_MIME = "application/x-terma-sftp";
const SFTP_INTERNAL_DRAG_HANDOFF_TTL_MS = 15 * 1000;
const SFTP_MOBILE_TOOLBAR_EXPANDED_KEY = "sftpMobileToolbarExpanded";
const sftpFilenameEncodingOptions = [
  ["utf8", "UTF-8"],
  ["gb18030", "GB18030"],
  ["gbk", "GBK"],
  ["big5", "Big5"],
  ["shift_jis", "Shift_JIS"],
  ["euc-kr", "EUC-KR"],
  ["latin1", "ISO-8859-1"]
];
let sftpLatestJobs = [];
let sftpJobsRequestSeq = 0;
let sftpTaskCenterView = "current";
let sftpRecycleBinConnectionId = 0;
const sftpPendingBrowserDownloads = new Set();
const sftpDownloadNoticeRequests = new Map();
const sftpUploadRequests = new Map();
const sftpOpeningFiles = new Set();
const sftpEditorDiffBaselines = new Map();
const sftpNavigationHistories = new Map();
const sftpConnectionRequests = new Map();
const sftpConnectionVersions = new Map();
const sftpDisconnectRequests = new Map();
const sftpSessionCloseChecks = new Set();
let sftpExternalDragPreparing = null;
let sftpInternalDrag = null;
let sftpInternalDragHandoff = null;
let sftpDropDepth = 0;
let sftpDropLeaveTimer = 0;
let sftpDragFeedbackWatchdog = 0;
let sftpDragFeedbackLastActivityAt = 0;
let sftpDragFeedbackTargetKind = "";
let sftpDragFeedbackTargetKey = "";
let sftpDragFeedbackTargetSession = null;
const sftpNativeDragCache = new Map();
const sftpNativeDragArmed = new Set();
const sftpNativeDragRequests = new Map();
let sftpNativeDragPointer = null;
let sftpNativeDragFallbackNoticeShown = false;
let sftpTabDragPreviewKey = "";
let sftpTabDragPreviewTimer = 0;
const sftpTabRuntimes = new Map();
const sftpTabCounts = new Map();
let sftpActiveRuntimeKey = "";

function defaultSftpState(connectionId=0, remotePath=".") {
  return {
    path:remotePath || ".",
    entries:[],
    query:"",
    sort:"name",
    dir:"asc",
    connectionId:Number(connectionId || 0),
    selected:null,
    page:1,
    pageSize:50,
    total:0,
    totalPages:1,
    unfilteredTotal:0,
    loading:false,
    requestSeq:0
  };
}

function sftpTabIndex(tabKey, connectionId=0) {
  const key = String(tabKey || "");
  const id = Number(connectionId || tabs.find(tab => tab.key === key)?.id || 0);
  if (!id) return 1;
  const match = key.match(new RegExp(`^sftp-${id}-(\\d+)$`));
  return Math.max(1, Number(match?.[1] || 1));
}

function rememberSftpTabIndex(tabKey, connectionId=0) {
  const id = Number(connectionId || tabs.find(tab => tab.key === tabKey)?.id || 0);
  if (!id) return 1;
  const index = sftpTabIndex(tabKey, id);
  sftpTabCounts.set(id, Math.max(Number(sftpTabCounts.get(id) || 0), index));
  return index;
}

function nextSftpTabKey(connectionId) {
  const id = Number(connectionId);
  let next = Number(sftpTabCounts.get(id) || 0);
  for (const tab of tabs.filter(item => item.kind === "sftp" && Number(item.id) === id)) {
    next = Math.max(next, sftpTabIndex(tab.key, id));
  }
  let key = "";
  do {
    next += 1;
    key = `sftp-${id}-${next}`;
  } while (tabs.some(tab => tab.key === key) || sftpTabRuntimes.has(key));
  sftpTabCounts.set(id, next);
  return key;
}

function sftpDisplayTabIndex(tabKey, connectionId=0) {
  const key = String(tabKey || "");
  const id = Number(connectionId || tabs.find(tab => tab.key === key)?.id || 0);
  if (!id) return 1;
  const siblings = tabs.filter(tab => tab.kind === "sftp" && Number(tab.id) === id);
  const index = siblings.findIndex(tab => tab.key === key);
  return index >= 0 ? index + 1 : siblings.length + 1;
}

function syncSftpTabTitles(connectionId=0) {
  const requestedId = Number(connectionId || 0);
  const groups = new Map();
  for (const tab of tabs) {
    if (tab.kind !== "sftp") continue;
    const id = Number(tab.id || 0);
    if (requestedId && id !== requestedId) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(tab);
  }
  for (const [id, siblings] of groups) {
    const connection = connections.find(item => Number(item.id) === id);
    const fallbackName = String(siblings[0]?.title || "")
      .replace(/\s*·\s*SFTP(?:\s+#\d+)?$/, "")
      .trim();
    const baseTitle = `${connection?.name || fallbackName || "SFTP"} · SFTP`;
    siblings.forEach((tab, index) => {
      tab.title = index === 0 ? baseTitle : `${baseTitle} #${index + 1}`;
    });
  }
}

function sftpRuntimeRoot(tabKey, fallback=null) {
  const key = String(tabKey || "");
  const runtime = sftpTabRuntimes.get(key);
  if (runtime?.root?.isConnected && runtime.root.dataset.sftpTabKey === key) return runtime.root;
  const scoped = typeof workspaceElementForTab === "function"
    ? workspaceElementForTab(key, "#view-sftp")
    : null;
  const root = scoped || fallback || null;
  if (!root || String(root.dataset.sftpTabKey || "") !== key) return null;
  if (runtime) runtime.root = root;
  return root;
}

function sftpElement(id, tabKey=activeTabKey, fallbackRoot=null) {
  const key = String(tabKey || "");
  const selector = `#${CSS.escape(id)}`;
  const root = sftpRuntimeRoot(key, fallbackRoot);
  const toolbar = document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
  return root?.querySelector(selector)
    || toolbar?.querySelector(selector)
    || (typeof workspaceElementForTab === "function" ? workspaceElementForTab(key, selector) : null)
    || null;
}

function sftpPaneElement(id, tabKey=activeTabKey) {
  const key = String(tabKey || "");
  const selector = `#${CSS.escape(id)}`;
  const toolbar = document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
  const scoped = typeof workspaceElementForTab === "function"
    ? workspaceElementForTab(key, selector)
    : null;
  return scoped || toolbar?.querySelector(selector) || (key === activeTabKey ? $(id) : null);
}

function sftpElements(selector, tabKey=activeTabKey, fallbackRoot=null) {
  const root = sftpRuntimeRoot(tabKey, fallbackRoot);
  return root ? [...root.querySelectorAll(selector)] : [];
}

function sftpTabKeyFromNode(node, fallback=activeTabKey) {
  return node?.closest?.("[data-sftp-tab-key]")?.dataset?.sftpTabKey
    || node?.closest?.("#view-sftp")?.dataset?.sftpTabKey
    || String(fallback || "");
}

function ensureSftpRuntime(tabKey, connectionId=0, remotePath=".", root=null) {
  const key = String(tabKey || "");
  if (!key) return null;
  let runtime = sftpTabRuntimes.get(key);
  if (!runtime) {
    runtime = {
      tabKey:key,
      connectionId:Number(connectionId || 0),
      state:defaultSftpState(connectionId, remotePath),
      root:null,
      requestController:null,
      searchTimer:null,
      resizeObserver:null,
      resizeFrame:0
    };
    sftpTabRuntimes.set(key, runtime);
  }
  if (connectionId) runtime.connectionId = Number(connectionId);
  if (!runtime.state) runtime.state = defaultSftpState(connectionId, remotePath);
  if (root && String(root.dataset.sftpTabKey || "") === key) {
    runtime.root = root;
  }
  rememberSftpTabIndex(key, runtime.connectionId);
  return runtime;
}

function saveActiveSftpRuntime() {
  const runtime = sftpTabRuntimes.get(sftpActiveRuntimeKey);
  if (!runtime) return;
  runtime.state = sftpState;
  runtime.requestController = sftpRequestController;
  runtime.searchTimer = sftpSearchTimer;
  runtime.resizeObserver = sftpListResizeObserver;
  runtime.resizeFrame = sftpListResizeFrame;
}

function restoreSftpRuntimeForTab(tabKey, options={}) {
  const key = String(tabKey || "");
  if (!key) return null;
  const tab = tabs.find(item => item.key === key);
  const runtime = ensureSftpRuntime(
    key,
    options.connectionId || tab?.id || 0,
    options.path || tab?.path || ".",
    options.root || null
  );
  if (!runtime) return null;
  const activate = options.activate === true || key === activeTabKey;
  if (activate) {
    if (sftpActiveRuntimeKey && sftpActiveRuntimeKey !== key) saveActiveSftpRuntime();
    if (
      sftpActiveRuntimeKey === key
      && runtime.state !== sftpState
      && Number(sftpState?.connectionId || 0) === Number(runtime.connectionId || 0)
    ) runtime.state = sftpState;
    sftpActiveRuntimeKey = key;
    sftpState = runtime.state;
    sftpRequestController = runtime.requestController;
    sftpSearchTimer = runtime.searchTimer;
    sftpListResizeObserver = runtime.resizeObserver;
    sftpListResizeFrame = runtime.resizeFrame;
  }
  return runtime;
}

function commitSftpRuntime(runtime) {
  if (!runtime) return;
  if (sftpActiveRuntimeKey === runtime.tabKey) {
    runtime.state = sftpState;
    runtime.requestController = sftpRequestController;
    runtime.searchTimer = sftpSearchTimer;
    runtime.resizeObserver = sftpListResizeObserver;
    runtime.resizeFrame = sftpListResizeFrame;
  }
}

function disposeSftpRuntime(tabKey) {
  const key = String(tabKey || "");
  const runtime = sftpTabRuntimes.get(key);
  if (!runtime) return;
  runtime.requestController?.abort?.();
  clearTimeout(runtime.searchTimer);
  runtime.resizeObserver?.disconnect?.();
  if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
  sftpNavigationHistories.delete(key);
  sftpViewStates.delete(key);
  sftpPendingDirectoryRefreshes.delete(key);
  sftpTabRuntimes.delete(key);
  if (sftpActiveRuntimeKey === key) {
    sftpActiveRuntimeKey = "";
    sftpState = defaultSftpState();
    sftpRequestController = null;
    sftpSearchTimer = null;
    sftpListResizeObserver = null;
    sftpListResizeFrame = 0;
  }
}

if (typeof window !== "undefined") {
  window.termaDesktop?.onSftpDragResult?.(result => handleSftpNativeDragResult(result));
  window.termaDesktop?.onSftpDragEvent?.(event => handleSftpNativeDragEvent(event));
}

function sftpFileOpenKey(connectionId, remotePath) {
  return `${Number(connectionId)}\0${String(remotePath || "")}`;
}

function updateSftpFileOpenFeedback(connectionId, remotePath, loading) {
  for (const runtime of sftpTabRuntimes.values()) {
    sftpElements(".sftp-file-open-button", runtime.tabKey).forEach(button => {
      if (Number(button.dataset.sftpConnectionId) !== Number(connectionId) || button.dataset.sftpRemotePath !== String(remotePath || "")) return;
      const image = button.dataset.sftpOpenKind === "image";
      button.disabled = loading;
      button.classList.toggle("is-loading", loading);
      button.setAttribute("aria-busy", loading ? "true" : "false");
      button.title = loading ? "正在打开文件" : (image ? "预览图片" : "以文本打开");
      button.innerHTML = loading
        ? `${icon("loader-circle")}<span>打开中</span>`
        : `${icon(image ? "image" : "file-text")}<span>${image ? "预览" : "打开"}</span>`;
    });
  }
}

async function withSftpFileOpenFeedback(connectionId, remotePath, operation) {
  const key = sftpFileOpenKey(connectionId, remotePath);
  if (sftpOpeningFiles.has(key)) {
    notify("文件正在打开，请稍候", "info");
    return null;
  }
  sftpOpeningFiles.add(key);
  updateSftpFileOpenFeedback(connectionId, remotePath, true);
  try {
    return await operation();
  } finally {
    sftpOpeningFiles.delete(key);
    updateSftpFileOpenFeedback(connectionId, remotePath, false);
  }
}

function joinRemotePath(base, name) {
  const rawBase = String(base || ".").replace(/\\/g, "/");
  const cleanBase = rawBase === "/" ? "/" : (rawBase.replace(/\/+$/,"") || ".");
  const cleanName = String(name || "").replace(/^\/+/, "");
  if (cleanBase === "/") return `/${cleanName}`;
  return cleanBase === "." ? cleanName : `${cleanBase}/${cleanName}`;
}

function parentRemotePath(path) {
  const raw = String(path || ".").replace(/\\/g, "/");
  if (raw === "/") return "/";
  const clean = raw.replace(/\/+$/,"");
  if (!clean || clean === ".") return ".";
  const index = clean.lastIndexOf("/");
  if (index === 0 && clean.startsWith("/")) return "/";
  return index < 0 ? "." : clean.slice(0, index);
}

function normalizeSftpDirectoryCachePath(value) {
  const path = String(value || ".").replace(/\\/g, "/");
  if (path === "/") return "/";
  return path.replace(/\/+$/, "") || ".";
}

function sftpDirectoryViewCacheKey(connectionId, remotePath) {
  return `${Number(connectionId)}\0${normalizeSftpDirectoryCachePath(remotePath)}`;
}

function resolvedSftpDirectoryViewCacheKey(connectionId, remotePath) {
  const requested = sftpDirectoryViewCacheKey(connectionId, remotePath);
  return sftpDirectoryViewAliases.get(requested) || requested;
}

function removeSftpDirectoryViewCacheEntry(key) {
  sftpDirectoryViewCache.delete(key);
  for (const [alias, target] of sftpDirectoryViewAliases) {
    if (alias === key || target === key) sftpDirectoryViewAliases.delete(alias);
  }
}

function pruneSftpDirectoryViewCache(now=Date.now()) {
  for (const [key, cached] of sftpDirectoryViewCache) {
    if (now - Number(cached.lastAccess || cached.cachedAt || 0) > SFTP_DIRECTORY_VIEW_CACHE_TTL_MS) {
      removeSftpDirectoryViewCacheEntry(key);
    }
  }
  let totalEntries = [...sftpDirectoryViewCache.values()]
    .reduce((sum, cached) => sum + Number(cached.state?.entries?.length || 0), 0);
  while (
    sftpDirectoryViewCache.size > SFTP_DIRECTORY_VIEW_CACHE_MAX_DIRECTORIES
    || totalEntries > SFTP_DIRECTORY_VIEW_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = sftpDirectoryViewCache.keys().next().value;
    if (oldestKey === undefined) break;
    totalEntries -= Number(sftpDirectoryViewCache.get(oldestKey)?.state?.entries?.length || 0);
    removeSftpDirectoryViewCacheEntry(oldestKey);
  }
}

function cloneSftpDirectoryViewState(state) {
  return {
    ...state,
    entries:(state?.entries || []).map(entry => ({...entry})),
    selected:state?.selected ? {...state.selected} : null,
    loading:false
  };
}

function cloneSftpScrollState(state) {
  if (!state) return null;
  return {...state, selectedPaths:[...(state.selectedPaths || [])]};
}

function getCachedSftpDirectoryView(connectionId, remotePath) {
  pruneSftpDirectoryViewCache();
  const key = resolvedSftpDirectoryViewCacheKey(connectionId, remotePath);
  const cached = sftpDirectoryViewCache.get(key);
  if (!cached) return null;
  cached.lastAccess = Date.now();
  sftpDirectoryViewCache.delete(key);
  sftpDirectoryViewCache.set(key, cached);
  return cached;
}

function cacheSftpDirectoryView(tabKey=activeTabKey, requestedPath="", viewState=null) {
  const runtime = sftpTabRuntimes.get(String(tabKey || "")) || restoreSftpRuntimeForTab(tabKey);
  const sourceState = runtime?.state;
  if (!runtime || !Number(sourceState?.connectionId)) return null;
  if (!requestedPath) requestedPath = sourceState.path;
  if (!viewState) viewState = captureSftpViewState(tabKey);
  const now = Date.now();
  const state = cloneSftpDirectoryViewState(sourceState);
  const canonicalKey = sftpDirectoryViewCacheKey(state.connectionId, state.path);
  const requestedKey = sftpDirectoryViewCacheKey(state.connectionId, requestedPath);
  removeSftpDirectoryViewCacheEntry(canonicalKey);
  const cached = {
    needsReload:Boolean(sourceState.loading),
    state,
    viewState:cloneSftpScrollState(viewState),
    cachedAt:now,
    lastAccess:now
  };
  sftpDirectoryViewCache.set(canonicalKey, cached);
  sftpDirectoryViewAliases.set(canonicalKey, canonicalKey);
  sftpDirectoryViewAliases.set(requestedKey, canonicalKey);
  pruneSftpDirectoryViewCache(now);
  return cached;
}

function clearSftpDirectoryViewCache(tabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const connectionId = Number(sftpTabRuntimes.get(key)?.connectionId || tab?.id || 0);
  if (!connectionId) return;
  const allTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  if (allTabs.some(item => item.key !== key && item.kind === "sftp" && Number(item.id) === connectionId)) return;
  clearSftpConnectionDirectoryViewCache(connectionId);
}

function clearSftpConnectionDirectoryViewCache(connectionId) {
  const id = Number(connectionId || 0);
  if (!id) return;
  const prefix = `${id}\0`;
  for (const key of [...sftpDirectoryViewCache.keys()]) {
    if (key.startsWith(prefix)) removeSftpDirectoryViewCacheEntry(key);
  }
  for (const key of [...sftpDirectoryViewAliases.keys()]) {
    if (key.startsWith(prefix)) sftpDirectoryViewAliases.delete(key);
  }
  clearSftpDirectorySizeCache(connectionId);
}

function sftpDirectorySizeCacheKey(connectionId, remotePath) {
  return `${Number(connectionId)}\0${normalizeSftpDirectoryCachePath(remotePath)}`;
}

function pruneSftpDirectorySizeCache(now=Date.now()) {
  for (const [key, record] of sftpDirectorySizeCache) {
    if (record.status !== "loading" && now - Number(record.lastAccess || record.updatedAt || 0) > SFTP_DIRECTORY_SIZE_CACHE_TTL_MS) {
      sftpDirectorySizeCache.delete(key);
    }
  }
  while (sftpDirectorySizeCache.size > SFTP_DIRECTORY_SIZE_CACHE_MAX_ENTRIES) {
    const oldestKey = sftpDirectorySizeCache.keys().next().value;
    if (oldestKey === undefined) break;
    sftpDirectorySizeCache.delete(oldestKey);
  }
}

function getSftpDirectorySizeRecord(connectionId, remotePath) {
  pruneSftpDirectorySizeCache();
  const key = sftpDirectorySizeCacheKey(connectionId, remotePath);
  const record = sftpDirectorySizeCache.get(key);
  if (!record) return null;
  record.lastAccess = Date.now();
  sftpDirectorySizeCache.delete(key);
  sftpDirectorySizeCache.set(key, record);
  return record;
}

function setSftpDirectorySizeRecord(connectionId, remotePath, record) {
  const key = sftpDirectorySizeCacheKey(connectionId, remotePath);
  const now = Date.now();
  sftpDirectorySizeCache.delete(key);
  sftpDirectorySizeCache.set(key, {...record, updatedAt:now, lastAccess:now});
  pruneSftpDirectorySizeCache(now);
}

function clearSftpDirectorySizeCache(connectionId) {
  const prefix = `${Number(connectionId)}\0`;
  for (const key of [...sftpDirectorySizeCache.keys()]) {
    if (key.startsWith(prefix)) sftpDirectorySizeCache.delete(key);
  }
}

function sftpDirectorySizePresentation(record) {
  if (record?.status === "loading") return {
    className:"is-loading",
    label:"读取中",
    title:"正在递归读取目录实际大小",
    disabled:true,
    iconName:"loader-circle"
  };
  if (record?.status === "ready") {
    const exactBytes = String(record.sizeBytes || "0");
    return {
      className:"is-ready",
      label:formatBytes(Number(exactBytes)),
      title:`实际内容大小 ${exactBytes} 字节；点击重新读取`,
      disabled:false,
      iconName:"refresh-cw"
    };
  }
  if (record?.status === "error") return {
    className:"is-error",
    label:"重试",
    title:`读取失败：${record.error || "未知错误"}；点击重试`,
    disabled:false,
    iconName:"circle-alert"
  };
  return {
    className:"is-idle",
    label:"读取",
    title:"递归读取目录内普通文件的实际总字节数",
    disabled:false,
    iconName:"calculator"
  };
}

function sftpDirectorySizeButtonHtml(connectionId, remotePath) {
  const key = encodeURIComponent(sftpDirectorySizeCacheKey(connectionId, remotePath));
  const presentation = sftpDirectorySizePresentation(getSftpDirectorySizeRecord(connectionId, remotePath));
  return `<button class="sftp-directory-size-button ${presentation.className}" data-sftp-directory-size="${escAttr(key)}" type="button" title="${escAttr(presentation.title)}" aria-label="${escAttr(presentation.title)}" ${presentation.disabled ? "disabled" : ""} onclick="event.stopPropagation();readSftpDirectorySize(${Number(connectionId)},'${escAttr(remotePath)}')">${icon(presentation.iconName)}<span>${esc(presentation.label)}</span></button>`;
}

function syncSftpDirectorySizeButtons(connectionId, remotePath) {
  const key = encodeURIComponent(sftpDirectorySizeCacheKey(connectionId, remotePath));
  for (const runtime of sftpTabRuntimes.values()) {
    sftpElements(".sftp-directory-size-button", runtime.tabKey).forEach(button => {
      if (button.dataset.sftpDirectorySize !== key) return;
      button.outerHTML = sftpDirectorySizeButtonHtml(connectionId, remotePath);
    });
  }
}

async function readSftpDirectorySize(connectionId, remotePath) {
  const current = getSftpDirectorySizeRecord(connectionId, remotePath);
  if (current?.status === "loading") return;
  setSftpDirectorySizeRecord(connectionId, remotePath, {status:"loading"});
  syncSftpDirectorySizeButtons(connectionId, remotePath);
  try {
    const result = await api(`/api/connections/${connectionId}/sftp/directory-size`, {
      method:"POST",
      body:JSON.stringify({path:remotePath})
    });
    const sizeBytes = String(result?.size_bytes ?? result?.size ?? "");
    if (!/^\d+$/.test(sizeBytes)) throw new Error("目录大小返回格式无效");
    setSftpDirectorySizeRecord(connectionId, remotePath, {status:"ready", sizeBytes});
  } catch (error) {
    setSftpDirectorySizeRecord(connectionId, remotePath, {status:"error", error:error.message || "目录大小读取失败"});
    notify(error.message || "目录大小读取失败", "error");
  }
  syncSftpDirectorySizeButtons(connectionId, remotePath);
}

function sftpDirectoryContentSignature(state) {
  return JSON.stringify({
    path:normalizeSftpDirectoryCachePath(state?.path),
    query:String(state?.query || ""),
    sort:String(state?.sort || "name"),
    dir:String(state?.dir || "asc"),
    page:Number(state?.page || 1),
    pageSize:Number(state?.pageSize || state?.page_size || 50),
    total:Number(state?.total || 0),
    totalPages:Number(state?.totalPages || state?.total_pages || 1),
    unfilteredTotal:Number(state?.unfilteredTotal || state?.unfiltered_total || 0),
    entries:(state?.entries || []).map(entry => [
      entry.name, entry.type, Number(entry.size || 0), Number(entry.mtime || 0),
      entry.mode || "", entry.owner || "", entry.group || "",
      Boolean(entry.is_symlink), Number(entry.link_size || 0), Boolean(entry.link_target_missing)
    ])
  });
}

function sftpBreadcrumbHtml(id, remotePath, tabKey=activeTabKey) {
  const raw = String(remotePath || ".").replace(/\\/g, "/");
  const clean = raw === "/" ? "/" : (raw.replace(/\/+$/,"") || ".");
  if (clean === ".") return `<button class="crumb active" aria-current="page" onclick="navigateSftpPath('.','${escAttr(tabKey)}')">当前目录</button>`;
  const absolute = clean.startsWith("/");
  const parts = clean.split("/").filter(Boolean);
  const crumbs = absolute ? [{label:"根目录", path:"/"}] : [{label:"当前目录", path:"."}];
  let current = absolute ? "" : ".";
  for (const part of parts) {
    current = current === "." ? part : `${current.replace(/\/$/,"")}/${part}`;
    crumbs.push({label:part, path:current});
  }
  return crumbs.map((item, index) => `<button class="crumb ${index === crumbs.length - 1 ? "active" : ""}" ${index === crumbs.length - 1 ? 'aria-current="page"' : ""} title="${esc(item.path)}" onclick="navigateSftpPath('${escAttr(item.path)}','${escAttr(tabKey)}')">${esc(item.label)}</button>`).join(`<span class="crumb-sep" aria-hidden="true">${icon("chevron-right")}</span>`);
}

function renderSftpFavorites(id, tabKey=activeTabKey) {
  const items = sftpFavorites.filter(item => item.connectionId === id);
  return `<span class="sftp-favorites-label">常用目录</span>${items.length ? items.map(item => `<button onclick="navigateSftpPath('${escAttr(item.path)}','${escAttr(tabKey)}')" title="${esc(item.path)}"><span aria-hidden="true">★</span>${esc(item.name || item.path)}</button>`).join("") : `<span class="muted">收藏当前目录后可快速跳转</span>`}`;
}

function isCurrentSftpFavorite(id, path) {
  return sftpFavorites.some(item => item.connectionId === id && item.path === path);
}

function saveSftpFavorites() {
  localStorage.setItem("sftpFavorites", JSON.stringify(sftpFavorites.slice(0, 80)));
}

function sftpClipboardMatchesConnection(tabKey=activeTabKey) {
  const state = sftpTabRuntimes.get(String(tabKey || ""))?.state || sftpState;
  return Boolean(sftpClipboard?.paths?.length) && Number(sftpClipboard.connectionId) === Number(state.connectionId);
}

function sftpFilenameEncodingLabel(connection) {
  return sftpFilenameEncodingOptions.find(([value]) => value === (connection?.sftp_filename_encoding || "utf8"))?.[1] || "UTF-8";
}

function renderSftpClipboardActions(tabKey=activeTabKey) {
  if (!sftpClipboard?.paths?.length) return "";
  const count = sftpClipboard.paths.length;
  const mode = sftpClipboard.mode === "move" ? "移动" : "复制";
  const matches = sftpClipboardMatchesConnection(tabKey);
  const canPaste = matches || sftpClipboard.mode === "copy";
  const crossHost = canPaste && !matches;
  const source = sftpClipboard.connectionName ? `来源：${sftpClipboard.connectionName}` : "";
  return `<span class="sftp-clipboard-state" title="${escAttr(source || `${mode}队列 ${count} 项`)}">${icon(mode === "移动" ? "folder-input" : "copy")}<span>${mode}队列 ${count} 项</span></span><button class="primary" onclick="pasteSftpClipboard('${escAttr(tabKey)}')" ${canPaste ? "" : "disabled"} title="${escAttr(matches ? "粘贴到当前目录" : crossHost ? "从来源主机复制到当前主机" : "跨主机仅支持复制，不能移动")}">${icon(crossHost ? "network" : "clipboard-paste")}<span>${crossHost ? "跨主机复制" : "粘贴"}</span></button><button class="icon-button" title="取消复制/移动队列" aria-label="取消复制或移动队列" onclick="cancelSftpClipboard()">${icon("x")}</button>`;
}

function showSftpFilenameEncodingMenu(event, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const tabKey = sftpTabKeyFromNode(event?.currentTarget);
  const current = connection.sftp_filename_encoding || "utf8";
  showActionMenu(event, sftpFilenameEncodingOptions.map(([value, label]) => ({
    label,
    icon:value === current ? "check" : "earth",
    run:()=>applySftpFilenameEncoding(connectionId, value, label, tabKey)
  })));
}

async function applySftpFilenameEncoding(connectionId, encoding, label, tabKey=activeTabKey) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const result = await api(`/api/connections/${connectionId}/sftp-filename-encoding`, {
    method:"POST",
    body:JSON.stringify({encoding})
  });
  Object.assign(connection, result);
  for (const key of sftpTabKeysForConnection(connectionId)) {
    const labelNode = sftpElement("sftpFilenameEncodingButton", key)?.querySelector("span");
    if (labelNode) labelNode.textContent = label;
  }
  notify(`SFTP 文件名编码已切换为 ${label}`, "success");
  await Promise.all(sftpTabKeysForConnection(connectionId).map(key => {
    const runtime = sftpTabRuntimes.get(key);
    return runtime
      ? loadSftpPage({connectionId, path:runtime.state.path || ".", page:1, tabKey:key, refresh:true, keepContents:false})
      : Promise.resolve(false);
  }));
}

function refreshSftpDirectoryActions(tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const state = runtime?.state || sftpState;
  const tab = tabs.find(item => item.key === tabKey) || {id:Number(state.connectionId || 0)};
  if (!tab.id) return;
  const favoriteButton = sftpElement("sftpFavoriteToggle", tabKey);
  if (favoriteButton) {
    const active = isCurrentSftpFavorite(tab.id, state.path || ".");
    favoriteButton.classList.toggle("is-active", active);
    favoriteButton.innerHTML = icon(active ? "star-off" : "star");
    favoriteButton.title = active ? "取消收藏当前目录" : "收藏当前目录";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
  }
  const favorites = sftpElement("sftpFavorites", tabKey);
  if (favorites) {
    favorites.classList.toggle("is-empty", !sftpFavorites.some(item => item.connectionId === tab.id));
    favorites.innerHTML = renderSftpFavorites(tab.id, tabKey);
  }
  const clipboard = sftpElement("sftpClipboardActions", tabKey);
  if (clipboard) clipboard.innerHTML = renderSftpClipboardActions(tabKey);
}

function cancelSftpClipboard() {
  if (!sftpClipboard) return;
  sftpClipboard = null;
  for (const runtime of sftpTabRuntimes.values()) refreshSftpDirectoryActions(runtime.tabKey);
  notify("已取消复制/移动队列", "info");
}

async function toggleSftpFavorite(tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  const path = runtime?.state.path || ".";
  if (!tab?.id) return;
  const index = sftpFavorites.findIndex(item => item.connectionId === tab.id && item.path === path);
  if (index >= 0) {
    sftpFavorites.splice(index, 1);
    notify("已取消收藏路径", "success");
  } else {
    const name = await inputModal("收藏路径", "收藏名称", path.split("/").filter(Boolean).pop() || path);
    if (!name) return;
    sftpFavorites.unshift({connectionId:tab.id, path, name});
    notify("已收藏路径", "success");
  }
  saveSftpFavorites();
  for (const item of sftpTabRuntimes.values()) {
    if (Number(item.connectionId) === Number(tab.id)) refreshSftpDirectoryActions(item.tabKey);
  }
}

function rememberSftpViewState(tabKey=activeTabKey, requestedPath="") {
  const key = String(tabKey || "");
  const runtime = sftpTabRuntimes.get(key);
  if (!runtime) return;
  const state = runtime.state;
  if (!requestedPath) requestedPath = state.path;
  const view = sftpRuntimeRoot(key);
  if (!view?.querySelector(".sftp-shell") || view.dataset.sftpTabKey !== tabKey) return;
  const viewState = captureSftpViewState(key);
  cacheSftpDirectoryView(tabKey, requestedPath, viewState);
  sftpViewStates.set(tabKey, {
    needsReload:Boolean(state.loading),
    state:{
      ...state,
      entries:[...(state.entries || [])],
      selected:state.selected ? {...state.selected} : null,
      loading:false
    },
    viewState
  });
}

function restoreCachedSftpState(cached, runtime=restoreSftpRuntimeForTab(activeTabKey)) {
  if (!cached?.state) return false;
  const current = runtime?.state || sftpState;
  const nextRequestSeq = Math.max(Number(current.requestSeq || 0), Number(cached.state.requestSeq || 0)) + 1;
  const state = {
    ...cached.state,
    entries:[...(cached.state.entries || [])],
    selected:cached.state.selected ? {...cached.state.selected} : null,
    loading:false,
    requestSeq:nextRequestSeq
  };
  if (runtime) runtime.state = state;
  if (!runtime || sftpActiveRuntimeKey === runtime.tabKey) sftpState = state;
  return true;
}

function sftpNavigationState(tabKey=activeTabKey) {
  if (!sftpNavigationHistories.has(tabKey)) sftpNavigationHistories.set(tabKey, {paths:[], index:-1});
  return sftpNavigationHistories.get(tabKey);
}

function rememberSftpNavigation(tabKey, remotePath) {
  const navigation = sftpNavigationState(tabKey);
  const normalized = normalizeSftpDirectoryCachePath(remotePath);
  if (navigation.paths[navigation.index] === normalized) return;
  navigation.paths = navigation.paths.slice(0, navigation.index + 1);
  navigation.paths.push(normalized);
  if (navigation.paths.length > 80) navigation.paths.shift();
  navigation.index = navigation.paths.length - 1;
  syncSftpNavigationButtons(tabKey);
}

function syncSftpNavigationButtons(tabKey=activeTabKey) {
  const navigation = sftpNavigationState(tabKey);
  const previous = sftpElement("sftpHistoryBack", tabKey);
  const next = sftpElement("sftpHistoryForward", tabKey);
  if (previous) previous.disabled = navigation.index <= 0;
  if (next) next.disabled = navigation.index < 0 || navigation.index >= navigation.paths.length - 1;
}

async function navigateSftpHistory(direction, tabKey=activeTabKey) {
  restoreSftpRuntimeForTab(tabKey);
  const tab = tabs.find(item => item.key === tabKey);
  const navigation = sftpNavigationState(tabKey);
  const nextIndex = navigation.index + Number(direction || 0);
  if (!tab || nextIndex < 0 || nextIndex >= navigation.paths.length) return;
  navigation.index = nextIndex;
  syncSftpNavigationButtons(tabKey);
  await loadSftpPage({connectionId:tab.id, path:navigation.paths[nextIndex], page:1, tabKey:tab.key, historyNavigation:true});
}

async function navigateSftpPath(remotePath, tabKey=activeTabKey, options={}) {
  const key = String(tabKey || "");
  const tab = tabs.find(item => item.key === key && item.kind === "sftp");
  if (!tab) return false;
  restoreSftpRuntimeForTab(key);
  return loadSftpPage({
    ...options,
    connectionId:tab.id,
    path:String(remotePath || "."),
    page:Math.max(1, Number(options.page || 1)),
    tabKey:key
  });
}

function showSftpPathEditor(tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const breadcrumb = sftpElement("sftpBreadcrumb", tabKey);
  const form = sftpElement("sftpPathEditor", tabKey);
  const input = sftpElement("sftpPathInput", tabKey);
  const editButton = sftpElement("sftpPathEditButton", tabKey);
  if (!breadcrumb || !form || !input) return;
  breadcrumb.hidden = true;
  form.hidden = false;
  if (editButton) editButton.hidden = true;
  input.value = runtime?.state.path || ".";
  input.focus();
  input.select();
}

function hideSftpPathEditor(tabKey=activeTabKey) {
  const breadcrumb = sftpElement("sftpBreadcrumb", tabKey);
  const form = sftpElement("sftpPathEditor", tabKey);
  const editButton = sftpElement("sftpPathEditButton", tabKey);
  if (breadcrumb) breadcrumb.hidden = false;
  if (form) form.hidden = true;
  if (editButton) editButton.hidden = false;
}

function submitSftpPath(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  event?.preventDefault();
  const tab = tabs.find(item => item.key === tabKey);
  const value = sftpElement("sftpPathInput", tabKey)?.value.trim();
  hideSftpPathEditor(tabKey);
  if (tab && value) navigateSftpPath(value, tabKey);
}

function toggleSftpSearch(tabKey=activeTabKey) {
  restoreSftpRuntimeForTab(tabKey);
  const panel = sftpElement("sftpFloatingSearch", tabKey);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const input = sftpElement("sftpSearch", tabKey);
    input?.focus();
    input?.select();
  }
}

function closeSftpSearch(tabKey=activeTabKey) {
  const panel = sftpElement("sftpFloatingSearch", tabKey);
  if (panel) panel.hidden = true;
}

function clearSftpSearch(tabKey=activeTabKey) {
  restoreSftpRuntimeForTab(tabKey);
  const input = sftpElement("sftpSearch", tabKey);
  if (input) input.value = "";
  setSftpSearch("", tabKey);
  closeSftpSearch(tabKey);
}

function sftpMobileToolbarExpanded() {
  return localStorage.getItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY) === "1";
}

function syncSftpMobileToolbarState(tabKey=activeTabKey) {
  const mount = sftpElement("sftpToolbarMount", tabKey);
  const toggle = sftpElement("sftpMobileToolbarToggle", tabKey);
  const mobile = isMobileLayout();
  const expanded = !mobile || sftpMobileToolbarExpanded();
  if (mount) mount.hidden = mobile && !expanded;
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.title = expanded ? "收起操作按钮" : "展开操作按钮";
  toggle.setAttribute("aria-label", toggle.title);
  toggle.innerHTML = icon(expanded ? "chevron-up" : "chevron-down");
}

function toggleSftpMobileToolbar(tabKey=activeTabKey) {
  if (!isMobileLayout()) return;
  localStorage.setItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY, sftpMobileToolbarExpanded() ? "0" : "1");
  syncSftpMobileToolbarState(tabKey);
}

function sftpConnectionAddress(connection) {
  return `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`;
}

function syncSftpToolbarPlacement(tabKey=activeTabKey) {
  const key = String(tabKey || "");
  const tab = tabs.find(item => item.key === key);
  if (tab?.kind !== "sftp") return;
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const view = sftpRuntimeRoot(key)
    || (pane && typeof workspacePaneElement === "function" ? workspacePaneElement(pane.id)?.querySelector("#view-sftp") : null);
  if (!view || (view.dataset.sftpTabKey && view.dataset.sftpTabKey !== key)) return;
  const mount = view.querySelector("#sftpToolbarMount");
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(key);
  const toolbar = mount?.querySelector(":scope > .sftp-toolbar")
    || document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${escapedKey}"]`);
  if (!mount || !toolbar) return;
  view.dataset.workspaceTabKey = key;
  view.dataset.sftpTabKey = key;
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("sftp", key, toolbar, mount);
  if (typeof placeWorkspaceToolbar === "function") placeWorkspaceToolbar("sftp", key, toolbar, mount);
  else {
    mount.replaceChildren(toolbar);
    toolbar.hidden = false;
    toolbar.classList.remove("sftp-toolbar-header");
  }
  if (typeof syncWorkspaceToolbarHostVisibility === "function") syncWorkspaceToolbarHostVisibility();
  syncSftpMobileToolbarState(key);
}

function sftpTabKeysForConnection(connectionId) {
  const id = Number(connectionId);
  const allTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  return allTabs.filter(tab => tab.kind === "sftp" && Number(tab.id) === id).map(tab => tab.key);
}

function updateSftpConnectionUi(connectionId, status="disconnected", error="") {
  const id = Number(connectionId);
  const normalized = ["connected", "connecting", "disconnected"].includes(status) ? status : "disconnected";
  const keys = sftpTabKeysForConnection(id);
  for (const tabKey of keys) {
    setWorkspaceTabConnectionStatus(tabKey, normalized);
    const button = sftpElement("sftpConnectionToggle", tabKey);
    const banner = sftpElement("sftpConnectionBanner", tabKey);
    const shell = sftpRuntimeRoot(tabKey)?.querySelector(".sftp-shell");
    const connected = normalized === "connected";
    const connecting = normalized === "connecting";
    shell?.classList.toggle("is-disconnected", !connected && !connecting);
    if (button) {
      button.dataset.status = normalized;
      button.disabled = connecting;
      button.title = connecting ? "正在连接 SFTP" : connected ? "断开 SFTP 连接" : "重新连接 SFTP";
      button.setAttribute("aria-label", button.title);
      button.innerHTML = connected
        ? icon("link-2-off")
        : icon(connecting ? "loader-circle" : "link-2");
    }
    if (banner) {
      banner.hidden = connected || connecting;
      const detail = banner.querySelector(".sftp-connection-detail");
      if (detail) detail.textContent = error || "当前目录仍保留，可重新连接后继续操作。";
    }
  }
}

async function disconnectSftpConnection(connectionId, tabKey=activeTabKey) {
  const id = Number(connectionId);
  const keys = sftpTabKeysForConnection(id);
  for (const key of keys) {
    rememberSftpViewState(key);
    sftpDisconnectedTabs.add(key);
    const runtime = sftpTabRuntimes.get(key);
    runtime?.requestController?.abort?.();
    if (runtime) runtime.requestController = null;
  }
  sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
  sftpConnectionRequests.get(id)?.controller?.abort();
  sftpConnectionRequests.delete(id);
  updateSftpConnectionUi(id, "disconnected");
  const existing = sftpDisconnectRequests.get(id);
  if (existing) return existing;
  const request = api(`/api/connections/${id}/sftp/session?forget=1`, {method:"DELETE", skipSftpConnect:true})
    .catch(error => {
      notify(error.message || "断开 SFTP 连接失败", "error");
      throw error;
    })
    .finally(() => {
      if (sftpDisconnectRequests.get(id) === request) sftpDisconnectRequests.delete(id);
    });
  sftpDisconnectRequests.set(id, request);
  try {
    return await request;
  } catch { return false; }
}

async function openTemporarySftpCredentialSession(connectionId, tabKey, temporaryConnection) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const remotePath = runtime?.state?.path || tabs.find(tab => tab.key === tabKey)?.path || ".";
  await api(`/api/connections/${Number(connectionId)}/sftp/session?forget=1`, {
    method:"DELETE",
    skipSftpConnect:true
  }).catch(() => {});
  await openSftp(temporaryConnection.id, remotePath, true, tabKey);
}

async function repairSftpCredentials(connectionId, tabKey) {
  if (typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(connectionId, {
    context:"SFTP 认证失败",
    onSaved:async () => ensureSftpConnection(connectionId, {
      force:true,
      tabKey,
      skipCredentialRepair:true
    }),
    onTemporary:async temporaryConnection => openTemporarySftpCredentialSession(
      connectionId,
      tabKey,
      temporaryConnection
    )
  });
}

async function ensureSftpConnection(connectionId, options={}) {
  const id = Number(connectionId);
  const tabKey = String(options.tabKey || activeTabKey || sftpTabKeysForConnection(id)[0] || "");
  const disconnecting = sftpDisconnectRequests.get(id);
  if (disconnecting) await disconnecting.catch(() => {});
  const pending = sftpConnectionRequests.get(id);
  if (pending) return pending.promise;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  const activeStatus = sftpElement("sftpConnectionToggle", tabKey)?.dataset.status || "";
  const status = activeStatus || tab?.connectionStatus || "disconnected";
  const manuallyDisconnected = sftpTabKeysForConnection(id).some(key => sftpDisconnectedTabs.has(key));
  if (!options.force && status === "connected" && !manuallyDisconnected) return true;
  const version = Number(sftpConnectionVersions.get(id) || 0) + 1;
  sftpConnectionVersions.set(id, version);
  updateSftpConnectionUi(id, "connecting");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let request;
  request = (async () => {
    try {
      await api(`/api/connections/${id}/sftp/session`, {method:"POST", body:"{}", signal:controller.signal, skipSftpConnect:true});
      if (sftpConnectionVersions.get(id) !== version) return false;
      for (const key of sftpTabKeysForConnection(id)) sftpDisconnectedTabs.delete(key);
      updateSftpConnectionUi(id, "connected");
      return true;
    } catch (error) {
      if (sftpConnectionVersions.get(id) === version) {
        const message = error?.name === "AbortError" ? "SFTP 连接超时，请重试" : (error.message || "SFTP 自动重连失败");
        updateSftpConnectionUi(id, "disconnected", message);
      }
      if (
        id > 0
        && !options.skipCredentialRepair
        && typeof sshAuthenticationFailure === "function"
        && sshAuthenticationFailure(error)
      ) {
        if (sftpConnectionRequests.get(id)?.promise === request) sftpConnectionRequests.delete(id);
        const repaired = await repairSftpCredentials(id, tabKey);
        if (repaired?.saved) return true;
        if (repaired) {
          const redirected = new Error("已改用临时 SFTP 凭据");
          redirected.code = "SSH_CREDENTIAL_REPAIR_REDIRECTED";
          throw redirected;
        }
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (sftpConnectionRequests.get(id)?.promise === request) sftpConnectionRequests.delete(id);
    }
  })();
  sftpConnectionRequests.set(id, {version, promise:request, controller});
  return request;
}

async function reconnectSftpConnection(connectionId, options={}) {
  const id = Number(connectionId);
  const tabKey = String(options.tabKey || activeTabKey || sftpTabKeysForConnection(id)[0] || "");
  sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
  sftpConnectionRequests.get(id)?.controller?.abort();
  sftpConnectionRequests.delete(id);
  try {
    await ensureSftpConnection(id, {force:true, tabKey});
    const runtime = sftpTabRuntimes.get(tabKey);
    if (options.refresh !== false && runtime) {
      await loadSftpPage({path:runtime.state.path, page:runtime.state.page || 1, tabKey, refresh:true, keepContents:true, preserveView:true});
    }
    return true;
  } catch (error) {
    if (error?.code === "SSH_CREDENTIAL_REPAIR_REDIRECTED") return true;
    updateSftpConnectionUi(id, "disconnected", error.message);
    if (!options.silent) notify(error.message || "SFTP 重连失败", "error");
    return false;
  }
}

function toggleSftpConnection(connectionId, tabKey=activeTabKey) {
  const status = sftpElement("sftpConnectionToggle", tabKey)?.dataset.status;
  if (status === "connected") return disconnectSftpConnection(connectionId, tabKey);
  if (status === "connecting") return sftpConnectionRequests.get(Number(connectionId))?.promise || Promise.resolve(false);
  return reconnectSftpConnection(connectionId, {tabKey});
}

async function refreshActiveSftpSessionStatus(tabKey="") {
  const requested = String(tabKey || "");
  const ids = requested
    ? [Number(sftpTabRuntimes.get(requested)?.connectionId || tabs.find(tab => tab.key === requested)?.id || 0)]
    : [...new Set([...sftpTabRuntimes.values()].map(runtime => Number(runtime.connectionId)).filter(Boolean))];
  for (const id of ids.filter(Boolean)) {
    try {
      const result = await api(`/api/connections/${id}/sftp/session`, {skipSftpConnect:true});
      const manuallyDisconnected = sftpTabKeysForConnection(id).some(key => sftpDisconnectedTabs.has(key));
      if (!result.connected && !manuallyDisconnected) {
        await ensureSftpConnection(id, {force:true, tabKey:sftpTabKeysForConnection(id)[0]});
        continue;
      }
      updateSftpConnectionUi(id, result.connected ? "connected" : "disconnected", result.error || "");
    } catch (error) {
      updateSftpConnectionUi(id, "disconnected", error.message || "SFTP 状态检查失败");
    }
  }
}

function closeSftpSession(tabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const id = Number(sftpTabRuntimes.get(key)?.connectionId || tab?.id || 0);
  if (!id) return;
  disposeSftpRuntime(key);
  if (id < 0 && typeof releaseQuickConnectionIfUnused === "function") {
    queueMicrotask(() => releaseQuickConnectionIfUnused(id));
  }
  if (sftpSessionCloseChecks.has(id)) return;
  sftpSessionCloseChecks.add(id);
  queueMicrotask(() => {
    sftpSessionCloseChecks.delete(id);
    const allTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
    if (allTabs.some(item => item.kind === "sftp" && Number(item.id) === id)) return;
    clearSftpConnectionDirectoryViewCache(id);
    sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
    sftpConnectionRequests.get(id)?.controller?.abort();
    sftpConnectionRequests.delete(id);
    void api(`/api/connections/${id}/sftp/session?forget=1`, {method:"DELETE", skipSftpConnect:true}).catch(() => {});
  });
}
