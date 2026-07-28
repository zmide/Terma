let sftpListResizeObserver = null;
let sftpListResizeFrame = 0;
const sftpKnownJobStatuses = new Map();
const sftpPendingDirectoryRefreshes = new Set();
const sftpDismissedFloatingJobIds = new Set();
const SFTP_ACTIVE_JOB_STATUSES = new Set(["running", "pending", "paused"]);
const SFTP_MUTATING_JOB_TYPES = new Set(["upload", "copy", "cross-copy", "move", "extract", "compress", "delete"]);
const SFTP_DIRECTORY_VIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const SFTP_DIRECTORY_VIEW_CACHE_MAX_DIRECTORIES = 60;
const SFTP_DIRECTORY_VIEW_CACHE_MAX_ENTRIES = 5000;
const SFTP_DIRECTORY_SIZE_CACHE_TTL_MS = 10 * 60 * 1000;
const SFTP_DIRECTORY_SIZE_CACHE_MAX_ENTRIES = 200;
const SFTP_NATIVE_DRAG_CACHE_TTL_MS = 9 * 60 * 1000;
const SFTP_DROP_LEAVE_GRACE_MS = 90;
const SFTP_NATIVE_TARGET_MISS_GRACE_MS = 180;
const SFTP_NATIVE_DRAG_ACTIVE_TTL_MS = 2 * 60 * 1000;
const SFTP_INTERNAL_DRAG_MIME = "application/x-tunneldesk-sftp";
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
let sftpTaskNavigationSeq = 0;
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
let sftpExternalDragPreparing = null;
let sftpInternalDrag = null;
let sftpInternalDragHandoff = null;
let sftpDropDepth = 0;
let sftpDropLeaveTimer = 0;
const sftpNativeDragCache = new Map();
const sftpNativeDragArmed = new Set();
const sftpNativeDragRequests = new Map();
let sftpNativeDragPointer = null;
let sftpNativeDragFallbackNoticeShown = false;
let sftpTabDragPreviewKey = "";
let sftpTabDragPreviewTimer = 0;

if (typeof window !== "undefined") {
  window.tunnelDeskDesktop?.onSftpDragResult?.(result => handleSftpNativeDragResult(result));
  window.tunnelDeskDesktop?.onSftpDragEvent?.(event => handleSftpNativeDragEvent(event));
}

function sftpFileOpenKey(connectionId, remotePath) {
  return `${Number(connectionId)}\0${String(remotePath || "")}`;
}

function updateSftpFileOpenFeedback(connectionId, remotePath, loading) {
  document.querySelectorAll(".sftp-file-open-button").forEach(button => {
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

function cacheSftpDirectoryView(tabKey=activeTabKey, requestedPath=sftpState.path, viewState=captureSftpViewState()) {
  if (!String(tabKey || "").startsWith("sftp-") || !Number(sftpState.connectionId)) return null;
  const now = Date.now();
  const state = cloneSftpDirectoryViewState(sftpState);
  const canonicalKey = sftpDirectoryViewCacheKey(state.connectionId, state.path);
  const requestedKey = sftpDirectoryViewCacheKey(state.connectionId, requestedPath);
  removeSftpDirectoryViewCacheEntry(canonicalKey);
  const cached = {
    needsReload:Boolean(sftpState.loading),
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
  const connectionId = Number(String(tabKey || "").replace(/^sftp-/, ""));
  if (!connectionId) return;
  const prefix = `${connectionId}\0`;
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
  document.querySelectorAll(".sftp-directory-size-button").forEach(button => {
    if (button.dataset.sftpDirectorySize !== key) return;
    button.outerHTML = sftpDirectorySizeButtonHtml(connectionId, remotePath);
  });
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

function sftpBreadcrumbHtml(id, remotePath) {
  const raw = String(remotePath || ".").replace(/\\/g, "/");
  const clean = raw === "/" ? "/" : (raw.replace(/\/+$/,"") || ".");
  if (clean === ".") return `<button class="crumb active" aria-current="page" onclick="openSftp(${id},'.')">当前目录</button>`;
  const absolute = clean.startsWith("/");
  const parts = clean.split("/").filter(Boolean);
  const crumbs = absolute ? [{label:"根目录", path:"/"}] : [{label:"当前目录", path:"."}];
  let current = absolute ? "" : ".";
  for (const part of parts) {
    current = current === "." ? part : `${current.replace(/\/$/,"")}/${part}`;
    crumbs.push({label:part, path:current});
  }
  return crumbs.map((item, index) => `<button class="crumb ${index === crumbs.length - 1 ? "active" : ""}" ${index === crumbs.length - 1 ? 'aria-current="page"' : ""} title="${esc(item.path)}" onclick="openSftp(${id},'${escAttr(item.path)}')">${esc(item.label)}</button>`).join(`<span class="crumb-sep" aria-hidden="true">${icon("chevron-right")}</span>`);
}

function renderSftpFavorites(id) {
  const items = sftpFavorites.filter(item => item.connectionId === id);
  return `<span class="sftp-favorites-label">常用目录</span>${items.length ? items.map(item => `<button onclick="openSftp(${id},'${escAttr(item.path)}')" title="${esc(item.path)}"><span aria-hidden="true">★</span>${esc(item.name || item.path)}</button>`).join("") : `<span class="muted">收藏当前目录后可快速跳转</span>`}`;
}

function isCurrentSftpFavorite(id, path) {
  return sftpFavorites.some(item => item.connectionId === id && item.path === path);
}

function saveSftpFavorites() {
  localStorage.setItem("sftpFavorites", JSON.stringify(sftpFavorites.slice(0, 80)));
}

function sftpClipboardMatchesConnection() {
  return Boolean(sftpClipboard?.paths?.length) && Number(sftpClipboard.connectionId) === Number(sftpState.connectionId);
}

function sftpFilenameEncodingLabel(connection) {
  return sftpFilenameEncodingOptions.find(([value]) => value === (connection?.sftp_filename_encoding || "utf8"))?.[1] || "UTF-8";
}

function renderSftpClipboardActions() {
  if (!sftpClipboard?.paths?.length) return "";
  const count = sftpClipboard.paths.length;
  const mode = sftpClipboard.mode === "move" ? "移动" : "复制";
  const matches = sftpClipboardMatchesConnection();
  const canPaste = matches || sftpClipboard.mode === "copy";
  const crossHost = canPaste && !matches;
  const source = sftpClipboard.connectionName ? `来源：${sftpClipboard.connectionName}` : "";
  return `<span class="sftp-clipboard-state" title="${escAttr(source || `${mode}队列 ${count} 项`)}">${icon(mode === "移动" ? "folder-input" : "copy")}<span>${mode}队列 ${count} 项</span></span><button class="primary" onclick="pasteSftpClipboard()" ${canPaste ? "" : "disabled"} title="${escAttr(matches ? "粘贴到当前目录" : crossHost ? "从来源主机复制到当前主机" : "跨主机仅支持复制，不能移动")}">${icon(crossHost ? "network" : "clipboard-paste")}<span>${crossHost ? "跨主机复制" : "粘贴"}</span></button><button class="icon-button" title="取消复制/移动队列" aria-label="取消复制或移动队列" onclick="cancelSftpClipboard()">${icon("x")}</button>`;
}

function showSftpFilenameEncodingMenu(event, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = connection.sftp_filename_encoding || "utf8";
  showActionMenu(event, sftpFilenameEncodingOptions.map(([value, label]) => ({
    label,
    icon:value === current ? "check" : "languages",
    run:()=>applySftpFilenameEncoding(connectionId, value, label)
  })));
}

async function applySftpFilenameEncoding(connectionId, encoding, label) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const result = await api(`/api/connections/${connectionId}/sftp-filename-encoding`, {
    method:"POST",
    body:JSON.stringify({encoding})
  });
  Object.assign(connection, result);
  const labelNode = document.querySelector("#sftpFilenameEncodingButton span");
  if (labelNode) labelNode.textContent = label;
  notify(`SFTP 文件名编码已切换为 ${label}`, "success");
  await loadSftpPage({connectionId, path:sftpState.path || ".", page:1, refresh:true, keepContents:false});
}

function refreshSftpDirectoryActions() {
  const tab = tabs.find(item => item.key === activeTabKey) || {id:Number(sftpState.connectionId || 0)};
  if (!tab.id) return;
  const favoriteButton = $("sftpFavoriteToggle");
  if (favoriteButton) {
    const active = isCurrentSftpFavorite(tab.id, sftpState.path || ".");
    favoriteButton.classList.toggle("is-active", active);
    favoriteButton.innerHTML = icon(active ? "star-off" : "star");
    favoriteButton.title = active ? "取消收藏当前目录" : "收藏当前目录";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
  }
  const favorites = $("sftpFavorites");
  if (favorites) {
    favorites.classList.toggle("is-empty", !sftpFavorites.some(item => item.connectionId === tab.id));
    favorites.innerHTML = renderSftpFavorites(tab.id);
  }
  const clipboard = $("sftpClipboardActions");
  if (clipboard) clipboard.innerHTML = renderSftpClipboardActions();
}

function cancelSftpClipboard() {
  if (!sftpClipboard) return;
  sftpClipboard = null;
  refreshSftpDirectoryActions();
  notify("已取消复制/移动队列", "info");
}

async function toggleSftpFavorite() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const path = sftpState.path || ".";
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
  refreshSftpDirectoryActions();
}

function rememberSftpViewState(tabKey=activeTabKey, requestedPath=sftpState.path) {
  if (!String(tabKey || "").startsWith("sftp-")) return;
  const view = $("view-sftp");
  if (!view?.querySelector(".sftp-shell") || view.dataset.sftpTabKey !== tabKey) return;
  const viewState = captureSftpViewState();
  cacheSftpDirectoryView(tabKey, requestedPath, viewState);
  sftpViewStates.set(tabKey, {
    needsReload:Boolean(sftpState.loading),
    state:{
      ...sftpState,
      entries:[...(sftpState.entries || [])],
      selected:sftpState.selected ? {...sftpState.selected} : null,
      loading:false
    },
    viewState
  });
}

function restoreCachedSftpState(cached) {
  if (!cached?.state) return false;
  const nextRequestSeq = Math.max(Number(sftpState.requestSeq || 0), Number(cached.state.requestSeq || 0)) + 1;
  sftpState = {
    ...cached.state,
    entries:[...(cached.state.entries || [])],
    selected:cached.state.selected ? {...cached.state.selected} : null,
    loading:false,
    requestSeq:nextRequestSeq
  };
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
  syncSftpNavigationButtons();
}

function syncSftpNavigationButtons() {
  const navigation = sftpNavigationState();
  const previous = $("sftpHistoryBack");
  const next = $("sftpHistoryForward");
  if (previous) previous.disabled = navigation.index <= 0;
  if (next) next.disabled = navigation.index < 0 || navigation.index >= navigation.paths.length - 1;
}

async function navigateSftpHistory(direction) {
  const tab = tabs.find(item => item.key === activeTabKey);
  const navigation = sftpNavigationState();
  const nextIndex = navigation.index + Number(direction || 0);
  if (!tab || nextIndex < 0 || nextIndex >= navigation.paths.length) return;
  navigation.index = nextIndex;
  syncSftpNavigationButtons();
  await loadSftpPage({connectionId:tab.id, path:navigation.paths[nextIndex], page:1, tabKey:tab.key, historyNavigation:true});
}

function showSftpPathEditor() {
  const breadcrumb = $("sftpBreadcrumb");
  const form = $("sftpPathEditor");
  const input = $("sftpPathInput");
  const editButton = $("sftpPathEditButton");
  if (!breadcrumb || !form || !input) return;
  breadcrumb.hidden = true;
  form.hidden = false;
  if (editButton) editButton.hidden = true;
  input.value = sftpState.path || ".";
  input.focus();
  input.select();
}

function hideSftpPathEditor() {
  const breadcrumb = $("sftpBreadcrumb");
  const form = $("sftpPathEditor");
  const editButton = $("sftpPathEditButton");
  if (breadcrumb) breadcrumb.hidden = false;
  if (form) form.hidden = true;
  if (editButton) editButton.hidden = false;
}

function submitSftpPath(event) {
  event?.preventDefault();
  const tab = tabs.find(item => item.key === activeTabKey);
  const value = $("sftpPathInput")?.value.trim();
  hideSftpPathEditor();
  if (tab && value) openSftp(tab.id, value);
}

function toggleSftpSearch() {
  const panel = $("sftpFloatingSearch");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const input = $("sftpSearch");
    input?.focus();
    input?.select();
  }
}

function closeSftpSearch() {
  const panel = $("sftpFloatingSearch");
  if (panel) panel.hidden = true;
}

function clearSftpSearch() {
  const input = $("sftpSearch");
  if (input) input.value = "";
  setSftpSearch("");
  closeSftpSearch();
}

function sftpMobileToolbarExpanded() {
  return localStorage.getItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY) === "1";
}

function syncSftpMobileToolbarState() {
  const mount = $("sftpToolbarMount");
  const toggle = $("sftpMobileToolbarToggle");
  const mobile = isMobileLayout();
  const expanded = !mobile || sftpMobileToolbarExpanded();
  if (mount) mount.hidden = mobile && !expanded;
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.title = expanded ? "收起操作按钮" : "展开操作按钮";
  toggle.setAttribute("aria-label", toggle.title);
  toggle.innerHTML = icon(expanded ? "chevron-up" : "chevron-down");
}

function toggleSftpMobileToolbar() {
  if (!isMobileLayout()) return;
  localStorage.setItem(SFTP_MOBILE_TOOLBAR_EXPANDED_KEY, sftpMobileToolbarExpanded() ? "0" : "1");
  syncSftpMobileToolbarState();
}

function sftpConnectionAddress(connection) {
  return `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`;
}

function syncSftpToolbarPlacement() {
  const header = $("workspaceHeaderTools");
  const mount = $("sftpToolbarMount");
  const toolbar = mount?.querySelector(":scope > .sftp-toolbar")
    || header?.querySelector(":scope > .sftp-toolbar");
  if (!header) return;
  if (activeView !== "sftp") {
    if (toolbar && mount && toolbar.parentElement !== mount) mount.replaceChildren(toolbar);
    toolbar?.classList.remove("sftp-toolbar-header");
    if (header.querySelector(":scope > .sftp-toolbar")) {
      header.replaceChildren();
      header.hidden = true;
    }
    return;
  }
  if (!mount || !toolbar) {
    header.hidden = true;
    header.replaceChildren();
    return;
  }
  if (isMobileLayout()) {
    if (toolbar.parentElement !== mount || mount.children.length !== 1) mount.replaceChildren(toolbar);
    toolbar.classList.remove("sftp-toolbar-header");
    if (header.querySelector(":scope > .sftp-toolbar")) header.replaceChildren();
    header.hidden = true;
  } else {
    if (toolbar.parentElement !== header || header.children.length !== 1) header.replaceChildren(toolbar);
    toolbar.classList.add("sftp-toolbar-header");
    header.hidden = false;
  }
  syncSftpMobileToolbarState();
}

function updateSftpConnectionUi(connectionId, status="disconnected", error="") {
  const tabKey = `sftp-${connectionId}`;
  const normalized = ["connected", "connecting", "disconnected"].includes(status) ? status : "disconnected";
  setWorkspaceTabConnectionStatus(tabKey, normalized);
  if (activeTabKey !== tabKey || activeView !== "sftp") return;
  const button = $("sftpConnectionToggle");
  const banner = $("sftpConnectionBanner");
  const shell = $("view-sftp")?.querySelector(".sftp-shell");
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

async function disconnectSftpConnection(connectionId) {
  const id = Number(connectionId);
  const tabKey = `sftp-${id}`;
  rememberSftpViewState(tabKey);
  sftpDisconnectedTabs.add(tabKey);
  sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
  sftpConnectionRequests.get(id)?.controller?.abort();
  sftpConnectionRequests.delete(id);
  if (sftpRequestController) sftpRequestController.abort();
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

async function ensureSftpConnection(connectionId, options={}) {
  const id = Number(connectionId);
  const tabKey = `sftp-${id}`;
  const disconnecting = sftpDisconnectRequests.get(id);
  if (disconnecting) await disconnecting.catch(() => {});
  const pending = sftpConnectionRequests.get(id);
  if (pending) return pending.promise;
  const tab = tabs.find(item => item.key === tabKey);
  const activeStatus = activeTabKey === tabKey ? $("sftpConnectionToggle")?.dataset.status : "";
  const status = activeStatus || tab?.connectionStatus || "disconnected";
  if (!options.force && status === "connected" && !sftpDisconnectedTabs.has(tabKey)) return true;
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
      sftpDisconnectedTabs.delete(tabKey);
      updateSftpConnectionUi(id, "connected");
      return true;
    } catch (error) {
      if (sftpConnectionVersions.get(id) === version) {
        const message = error?.name === "AbortError" ? "SFTP 连接超时，请重试" : (error.message || "SFTP 自动重连失败");
        updateSftpConnectionUi(id, "disconnected", message);
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
  const tabKey = `sftp-${id}`;
  sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
  sftpConnectionRequests.get(id)?.controller?.abort();
  sftpConnectionRequests.delete(id);
  try {
    await ensureSftpConnection(id, {force:true});
    if (options.refresh !== false && activeTabKey === tabKey && activeView === "sftp") {
      await loadSftpPage({path:sftpState.path, page:sftpState.page || 1, tabKey, refresh:true, keepContents:true, preserveView:true});
    }
    return true;
  } catch (error) {
    updateSftpConnectionUi(id, "disconnected", error.message);
    if (!options.silent) notify(error.message || "SFTP 重连失败", "error");
    return false;
  }
}

function toggleSftpConnection(connectionId) {
  const status = $("sftpConnectionToggle")?.dataset.status;
  if (status === "connected") return disconnectSftpConnection(connectionId);
  if (status === "connecting") return sftpConnectionRequests.get(Number(connectionId))?.promise || Promise.resolve(false);
  return reconnectSftpConnection(connectionId);
}

async function refreshActiveSftpSessionStatus() {
  if (activeView !== "sftp" || !sftpState.connectionId) return;
  const id = Number(sftpState.connectionId);
  try {
    const result = await api(`/api/connections/${id}/sftp/session`, {skipSftpConnect:true});
    if (!result.connected && !sftpDisconnectedTabs.has(`sftp-${id}`)) {
      await ensureSftpConnection(id, {force:true});
      return;
    }
    updateSftpConnectionUi(id, result.connected ? "connected" : "disconnected", result.error || "");
  } catch (error) {
    updateSftpConnectionUi(id, "disconnected", error.message || "SFTP 状态检查失败");
  }
}

function closeSftpSession(tabKey) {
  const id = Number(String(tabKey || "").replace(/^sftp-/, ""));
  if (!id) return;
  sftpConnectionVersions.set(id, Number(sftpConnectionVersions.get(id) || 0) + 1);
  sftpConnectionRequests.get(id)?.controller?.abort();
  sftpConnectionRequests.delete(id);
  void api(`/api/connections/${id}/sftp/session?forget=1`, {method:"DELETE", skipSftpConnect:true}).catch(() => {});
}

async function openSftp(id, remotePath=".", updateTab=true) {
  const tabKey = `sftp-${id}`;
  const preserveManualDisconnect = !updateTab && sftpDisconnectedTabs.has(tabKey);
  const view = $("view-sftp");
  const currentlyMounted = view.dataset.sftpTabKey === activeTabKey && Boolean(view.querySelector(".sftp-shell"));
  const leavingCurrentDirectory = activeView === "sftp"
    && currentlyMounted
    && (
      activeTabKey !== tabKey
      || resolvedSftpDirectoryViewCacheKey(sftpState.connectionId, sftpState.path)
        !== resolvedSftpDirectoryViewCacheKey(id, remotePath)
    );
  if (leavingCurrentDirectory) rememberSftpViewState(activeTabKey);
  const c = selectConnection(id);
  if (!c) return;
  clearTimeout(sftpSearchTimer);
  const directoryCached = getCachedSftpDirectoryView(id, remotePath);
  const tabCached = updateTab ? null : sftpViewStates.get(tabKey);
  const cached = directoryCached || tabCached;
  const mounted = view.dataset.sftpTabKey === tabKey
    && Boolean(view.querySelector(".sftp-shell"))
    && Number(sftpState.connectionId) === Number(id)
    && (
      normalizeSftpDirectoryCachePath(sftpState.path) === normalizeSftpDirectoryCachePath(remotePath)
      || normalizeSftpDirectoryCachePath(directoryCached?.state?.path) === normalizeSftpDirectoryCachePath(sftpState.path)
    );
  if (mounted) {
    setWorkspace(`${c.name} · SFTP`, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:sftpState.path, connectionStatus:sftpDisconnectedTabs.has(tabKey) ? "disconnected" : "connecting"});
    if (cached?.viewState) restoreSftpViewState(cached.viewState);
    refreshSftpDirectoryActions();
    refreshSftpJobs();
    startSftpJobsTimer();
    if (preserveManualDisconnect) {
      updateSftpConnectionUi(id, "disconnected");
      return true;
    }
    void loadSftpPage({
      path:sftpState.path,
      page:sftpState.page || 1,
      tabKey,
      refresh:true,
      keepContents:true,
      preserveView:true,
      silent:true,
      renderIfChangedOnly:true
    });
    return true;
  }

  const restored = Boolean(cached?.state && String(cached.state.path || ".") === String(remotePath || "."))
    && restoreCachedSftpState(cached);
  if (!restored) {
    sftpState = {...sftpState, connectionId:id, path:remotePath, entries:[], selected:null, page:1, total:0, totalPages:1, unfilteredTotal:0};
  }
  const displayPath = restored ? sftpState.path : remotePath;
  view.innerHTML = `<div class="sftp-shell" ondragenter="handleSftpDragEnter(event)" ondragover="handleSftpDragOver(event)" ondragleave="handleSftpDragLeave(event)" ondrop="handleSftpDrop(event)">
    <div class="sftp-top">
      <div id="sftpToolbarMount"><div class="sftp-toolbar">
        <div class="sftp-toolbar-actions">
          <button class="icon-button" title="收藏当前目录" aria-label="收藏当前目录" id="sftpFavoriteToggle" onclick="toggleSftpFavorite()">${icon("star")}</button>
          <button class="icon-button" title="新建文件夹" aria-label="新建文件夹" onclick="mkdirSftp()">${icon("folder-plus")}</button>
          <button class="icon-button" title="新建文件" aria-label="新建文件" onclick="createSftpFile()">${icon("file-plus-2")}</button>
          <button type="button" class="icon-button" title="上传文件" aria-label="上传文件" onclick="$('sftpUpload').click()">${icon("upload")}</button>
          <input id="sftpUpload" type="file" multiple onchange="uploadSftpFile()" hidden>
          <button class="icon-button" title="SFTP 回收站" aria-label="SFTP 回收站" onclick="openSftpRecycleBin()">${icon("trash-2")}</button>
          <span id="sftpClipboardActions" class="sftp-clipboard-actions">${renderSftpClipboardActions()}</span>
          <span class="sftp-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="搜索当前目录" aria-label="搜索当前目录" onclick="toggleSftpSearch()">${icon("search")}</button>
          <button id="sftpFilenameEncodingButton" class="sftp-encoding-button" title="切换 SFTP 文件名编码" onclick="showSftpFilenameEncodingMenu(event,${id})">${icon("languages")}<span>${esc(sftpFilenameEncodingLabel(c))}</span>${icon("chevron-down")}</button>
          <button class="icon-button" title="打开此连接的终端" aria-label="打开此连接的终端" onclick="openTerminal(${id})">${icon("square-terminal")}</button>
          <button id="sftpConnectionToggle" class="icon-button sftp-connection-toggle" data-status="connecting" title="正在连接 SFTP" aria-label="正在连接 SFTP" onclick="toggleSftpConnection(${id})">${icon("loader-circle")}</button>
          <button class="icon-button" title="刷新目录" aria-label="刷新目录" onclick="refreshSftp()">${icon("refresh-cw")}</button>
          <button id="sftpGlobalSettingsButton" class="icon-button" title="SFTP 全局设置" aria-label="SFTP 全局设置" onclick="showSftpGlobalSettings()">${icon("settings")}</button>
        </div>
      </div></div>
      <div class="sftp-navigation-row">
        <div class="sftp-navigation-actions">
          <button id="sftpHistoryBack" class="icon-button" title="上一步" aria-label="上一步" onclick="navigateSftpHistory(-1)">${icon("arrow-left")}</button>
          <button id="sftpHistoryForward" class="icon-button" title="下一步" aria-label="下一步" onclick="navigateSftpHistory(1)">${icon("arrow-right")}</button>
          <button class="icon-button" title="上一级" aria-label="上一级" onclick="openSftp(${id}, parentRemotePath(sftpState.path))">${icon("corner-left-up")}</button>
        </div>
        <div class="sftp-path-block">
          <nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径" ondblclick="showSftpPathEditor()">${sftpBreadcrumbHtml(id, displayPath)}</nav>
          <form id="sftpPathEditor" class="sftp-path-editor" hidden onsubmit="submitSftpPath(event)"><input id="sftpPathInput" aria-label="远程目录路径" value="${esc(displayPath)}"><button type="submit" class="icon-button" title="转到路径" aria-label="转到路径">${icon("corner-down-left")}</button><button type="button" class="icon-button" title="取消" aria-label="取消" onclick="hideSftpPathEditor()">${icon("x")}</button></form>
        </div>
        <div class="sftp-navigation-end-actions">
          <button id="sftpPathEditButton" class="icon-button sftp-path-edit-button" title="手动输入目录" aria-label="手动输入目录" onclick="showSftpPathEditor()">${icon("pencil")}</button>
          <button id="sftpMobileToolbarToggle" class="icon-button sftp-mobile-toolbar-toggle" type="button" title="展开操作按钮" aria-label="展开操作按钮" aria-controls="sftpToolbarMount" aria-expanded="false" onclick="toggleSftpMobileToolbar()">${icon("chevron-down")}</button>
        </div>
      </div>
      <div id="sftpFavorites" class="sftp-favorites${sftpFavorites.some(item => item.connectionId === id) ? "" : " is-empty"}">${renderSftpFavorites(id)}</div>
      <div id="sftpConnectionBanner" class="sftp-connection-banner" hidden>
        <div>${icon("link-2-off")}<span><strong>SFTP 连接已断开</strong><small class="sftp-connection-detail">当前目录仍保留，可重新连接后继续操作。</small></span></div>
        <button onclick="reconnectSftpConnection(${id})">${icon("link-2")}<span>重新连接</span></button>
      </div>
      <div class="sftp-selection-bar" id="sftpSelectionBar" hidden>
        <div class="sftp-selected" id="sftpSelectedInfo">已选择 0 项</div>
        <div class="sftp-selection-actions">
          <button onclick="copySftpSelection('copy')">${icon("copy")}<span>复制</span></button>
          <button onclick="copySftpSelection('move')">${icon("folder-input")}<span>移动</span></button>
          <button onclick="downloadSftpSelection()">${icon("download")}<span>下载</span></button>
          <button id="sftpSelectionCompress" onclick="compressSftpSelection()">${icon("archive")}<span>压缩</span></button>
          <button id="sftpSelectionPermissions" onclick="openSftpPermissionsForSelection()">${icon("key-round")}<span>权限</span></button>
          <button id="sftpSelectionExtract" onclick="extractSftpSelection()" hidden>${icon("archive-restore")}<span>解压</span></button>
          <button class="danger" onclick="deleteSftpSelection()">${icon("trash-2")}<span>删除</span></button>
          <button class="icon-button" title="取消选择" aria-label="取消选择" onclick="clearSftpSelection()">${icon("x")}</button>
        </div>
      </div>
    </div>
    <div id="sftpJobs" class="sftp-jobs"></div>
    <div id="sftpList" class="sftp-list" oncontextmenu="showSftpDirectoryMenu(event)">${restored ? "" : stateView("loading", "正在读取目录", displayPath)}</div>
    <div id="sftpDropOverlay" class="sftp-drop-overlay" data-mode="upload" aria-hidden="true" hidden></div>
    <div id="sftpFloatingSearch" class="sftp-floating-search" hidden>${icon("search")}<input id="sftpSearch" placeholder="搜索当前目录" value="${esc(sftpState.query)}" oninput="setSftpSearch(this.value)"><button class="icon-button" title="清除搜索" aria-label="清除搜索" onclick="clearSftpSearch()">${icon("x")}</button></div>
  </div>`;
  view.dataset.sftpTabKey = tabKey;
  setWorkspace(`${c.name} · SFTP`, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:displayPath, connectionStatus:sftpDisconnectedTabs.has(tabKey) ? "disconnected" : "connecting"});
  syncSftpToolbarPlacement();
  restoreSftpDropFeedbackAfterRender(tabKey);
  rememberSftpNavigation(tabKey, displayPath);
  syncSftpNavigationButtons();
  refreshSftpJobs();
  startSftpJobsTimer();
  if (preserveManualDisconnect) {
    updateSftpConnectionUi(id, "disconnected");
    if (restored) {
      refreshSftpDirectoryActions();
      renderSftpEntries();
      restoreSftpViewState(cached.viewState);
    }
    return true;
  }
  if (restored) {
    refreshSftpDirectoryActions();
    renderSftpEntries();
    restoreSftpViewState(cached.viewState);
    void loadSftpPage({
      path:displayPath,
      page:sftpState.page || 1,
      tabKey,
      refresh:true,
      keepContents:true,
      preserveView:true,
      silent:true,
      renderIfChangedOnly:true
    });
    return true;
  }
  return loadSftpPage({path:remotePath, page:1, tabKey});
}

async function loadSftpPage(options={}) {
  const id = Number(options.connectionId || sftpState.connectionId);
  if (!id) return false;
  const tabKey = options.tabKey || `sftp-${id}`;
  const remotePath = options.path || sftpState.path || ".";
  const requestedPage = Math.max(1, Number(options.page || sftpState.page || 1));
  const query = String(sftpState.query || "");
  const sort = ["name","size","mtime"].includes(sftpState.sort) ? sftpState.sort : "name";
  const dir = sftpState.dir === "desc" ? "desc" : "asc";
  const pageSize = [25,50,100,200].includes(Number(sftpState.pageSize)) ? Number(sftpState.pageSize) : 50;
  const list = $("sftpList");
  const sameDirectory = Number(sftpState.connectionId) === id && String(sftpState.path || ".") === String(remotePath || ".");
  const keepContents = Boolean(list?.querySelector(".sftp-head") && sameDirectory && options.keepContents !== false);
  const preserveView = Boolean(options.preserveView ?? options.refresh) && keepContents;
  const silent = Boolean(options.silent) && keepContents;

  if (sftpRequestController) sftpRequestController.abort();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  sftpRequestController = controller;
  const requestSeq = Number(sftpState.requestSeq || 0) + 1;
  sftpState = {...sftpState, loading:true, requestSeq, selected:preserveView ? sftpState.selected : null};
  if (list) {
    if (!silent) {
      list.classList.toggle("is-refreshing", keepContents);
      list.setAttribute("aria-busy", "true");
      if (!keepContents) list.innerHTML = stateView("loading", "正在读取目录", remotePath);
    }
  }

  const params = new URLSearchParams({
    path: remotePath,
    page: String(requestedPage),
    page_size: String(pageSize),
    query,
    sort,
    dir
  });
  if (options.refresh) params.set("refresh", "1");
  try {
    const data = await api(`/api/connections/${id}/sftp?${params.toString()}`, controller ? {signal:controller.signal} : {});
    if (requestSeq !== sftpState.requestSeq || activeTabKey !== tabKey || activeView !== "sftp") return false;
    const viewState = preserveView ? captureSftpViewState() : null;
    const tab = tabs.find(item => item.key === tabKey);
    if (tab) tab.path = data.path;
    const nextState = {
      ...sftpState,
      connectionId:id,
      path:data.path,
      entries:data.entries || [],
      selected:preserveView ? sftpState.selected : null,
      page:Number(data.page || 1),
      pageSize:Number(data.page_size || pageSize),
      total:Number(data.total || 0),
      totalPages:Number(data.total_pages || 1),
      unfilteredTotal:Number(data.unfiltered_total || 0),
      loading:false,
      requestSeq
    };
    const contentChanged = !options.renderIfChangedOnly
      || sftpDirectoryContentSignature(sftpState) !== sftpDirectoryContentSignature(nextState);
    sftpState = nextState;
    sftpDisconnectedTabs.delete(tabKey);
    updateSftpConnectionUi(id, "connected");
    if (!options.historyNavigation) rememberSftpNavigation(tabKey, data.path);
    else syncSftpNavigationButtons();
    if (contentChanged) {
      if ($("sftpBreadcrumb")) $("sftpBreadcrumb").innerHTML = sftpBreadcrumbHtml(id, data.path);
      if ($("sftpPathInput")) $("sftpPathInput").value = data.path;
      refreshSftpDirectoryActions();
      renderSftpEntries();
      if (viewState) restoreSftpViewState(viewState);
    }
    rememberSftpViewState(tabKey, remotePath);
    saveTabsState();
    return true;
  } catch (error) {
    if (error?.name === "AbortError" || requestSeq !== sftpState.requestSeq) return false;
    updateSftpConnectionUi(id, "disconnected", error.message || "SFTP 连接已断开");
    if (activeTabKey === tabKey && activeView === "sftp" && $("sftpList")) {
      if (keepContents) {
        if (!silent) notify(error.message || "目录同步失败", "error");
      } else {
        $("sftpList").innerHTML = stateView("error", "目录加载失败", error.message, `<button onclick="refreshSftp()">重试</button>`);
      }
    }
    return false;
  } finally {
    if (requestSeq === sftpState.requestSeq) sftpState.loading = false;
    if (sftpRequestController === controller) sftpRequestController = null;
    if (list && requestSeq === sftpState.requestSeq && !silent) {
      list.classList.remove("is-refreshing");
      list.setAttribute("aria-busy", "false");
    }
    if (requestSeq === sftpState.requestSeq) queueMicrotask(flushPendingSftpDirectoryRefresh);
  }
}

function captureSftpViewState() {
  const workspace = document.querySelector(".workspace");
  return {
    scrollTop:Number(workspace?.scrollTop || 0),
    selectedPaths:[...document.querySelectorAll("#sftpList .sftp-check:checked")].map(input => input.value),
    activePath:sftpState.selected?.path || ""
  };
}

function restoreSftpViewState(state) {
  if (!state) return;
  const selectedPaths = new Set(state.selectedPaths || []);
  document.querySelectorAll("#sftpList .sftp-check").forEach(input => { input.checked = selectedPaths.has(input.value); });
  if (state.activePath && !(sftpState.entries || []).some(entry => joinRemotePath(sftpState.path, entry.name) === state.activePath)) {
    sftpState.selected = null;
    document.querySelectorAll("#sftpList .sftp-row.active").forEach(row => row.classList.remove("active"));
  }
  updateSftpSelection();
  const workspace = document.querySelector(".workspace");
  if (!workspace) return;
  const restore = () => { workspace.scrollTop = Math.min(Number(state.scrollTop || 0), Math.max(0, workspace.scrollHeight - workspace.clientHeight)); };
  restore();
  requestAnimationFrame(restore);
}

function setSftpSearch(value) {
  sftpState.query = value || "";
  clearTimeout(sftpSearchTimer);
  sftpSearchTimer = setTimeout(() => {
    sftpState.page = 1;
    loadSftpPage({page:1});
  }, 280);
}

function setSftpSort(key) {
  clearTimeout(sftpSearchTimer);
  if (sftpState.sort === key) sftpState.dir = sftpState.dir === "asc" ? "desc" : "asc";
  else {
    sftpState.sort = key;
    sftpState.dir = "asc";
  }
  sftpState.page = 1;
  loadSftpPage({page:1});
}

function setSftpPage(page) {
  clearTimeout(sftpSearchTimer);
  const target = Math.max(1, Math.min(Number(page) || 1, Number(sftpState.totalPages || 1)));
  if (target === sftpState.page || sftpState.loading) return;
  loadSftpPage({page:target});
}

function setSftpPageSize(value) {
  clearTimeout(sftpSearchTimer);
  const pageSize = Number(value);
  if (![25,50,100,200].includes(pageSize) || pageSize === sftpState.pageSize) return;
  sftpState.pageSize = pageSize;
  sftpState.page = 1;
  loadSftpPage({page:1});
}

function sortMark(key) {
  return sftpState.sort === key ? (sftpState.dir === "asc" ? "↑" : "↓") : "";
}

function syncSftpListLayout(list=$("sftpList"), measuredWidth) {
  if (!list) return;
  const width = Number(measuredWidth) || list.getBoundingClientRect().width;
  const mobile = isMobileLayout();
  list.classList.toggle("sftp-actions-medium", width > 0 && width <= 1200);
  list.classList.toggle("sftp-actions-compact", width > 0 && width <= 1000);
  list.classList.toggle("sftp-actions-minimal", width > 0 && width <= 620);
  list.classList.toggle("sftp-actions-more-only", width > 0 && (width <= 520 || mobile));
}

function watchSftpListLayout(list) {
  sftpListResizeObserver?.disconnect();
  if (sftpListResizeFrame) cancelAnimationFrame(sftpListResizeFrame);
  syncSftpListLayout(list);
  if (typeof ResizeObserver !== "function") return;
  sftpListResizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect?.width;
    if (sftpListResizeFrame) cancelAnimationFrame(sftpListResizeFrame);
    sftpListResizeFrame = requestAnimationFrame(() => {
      sftpListResizeFrame = 0;
      if (list.isConnected) syncSftpListLayout(list, width);
    });
  });
  sftpListResizeObserver.observe(list);
}

function renderSftpEntries() {
  const list = $("sftpList");
  if (!list) return;
  const entries = sftpState.entries || [];
  const id = sftpState.connectionId;
  const head = `<div class="sftp-head"><label><input id="sftpSelectAll" type="checkbox" aria-label="选择当前页全部项目" onchange="toggleSftpAll(this.checked)"></label><button onclick="setSftpSort('name')">名称 ${sortMark("name")}</button><button class="sftp-size" onclick="setSftpSort('size')">大小 ${sortMark("size")}</button><button class="sftp-time" onclick="setSftpSort('mtime')">修改时间 ${sortMark("mtime")}</button><span class="sftp-access">权限 / 所有者</span><span class="sftp-head-actions">操作</span></div>`;
  const rows = entries.map(entry => {
    const fullPath = joinRemotePath(sftpState.path, entry.name);
    const isDir = entry.type === "dir";
    const isLink = Boolean(entry.is_symlink);
    const linkDescription = !isLink
      ? entry.name
      : entry.link_target_missing
        ? `${entry.name} · 符号链接目标不存在`
        : isDir
          ? `${entry.name} · 符号链接到目录`
          : `${entry.name} · 符号链接目标 ${formatBytes(entry.size)}（链接本身 ${formatBytes(entry.link_size || 0)}）`;
    const mobileType = isLink ? (isDir ? "链接目录" : "链接文件") : (isDir ? "目录" : "");
    const active = sftpState.selected?.path === fullPath;
    return `<div class="sftp-row ${active ? "active" : ""}" draggable="${isMobileLayout() ? "false" : "true"}" onclick="selectSftpEntry(${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')" ondblclick="activateSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')" oncontextmenu="showSftpEntryMenu(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')" onpointerdown="primeSftpNativeDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')" ondragstart="beginSftpItemDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')" ondragend="finishSftpItemDrag(event)">
      <input class="sftp-check" type="checkbox" value="${esc(fullPath)}" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" data-mtime="${Math.max(0, Number(entry.mtime || 0))}" data-metadata-known="1" data-mode="${esc(entry.mode || "")}" data-owner="${esc(entry.owner || "")}" data-group="${esc(entry.group || "")}" aria-label="选择 ${esc(entry.name)}" onclick="event.stopPropagation()" onchange="updateSftpSelection()">
      <button class="sftp-name" title="${esc(linkDescription)}" onclick="event.stopPropagation(); selectSftpEntry(${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}')"><span class="sftp-icon ${entry.type} ${sftpFileKind(entry.name)} ${isLink ? "symlink" : ""}">${sftpIcon(entry.name, isDir)}</span><span class="sftp-name-copy"><span class="sftp-file-name">${esc(entry.name)}</span><span class="sftp-mobile-meta">${mobileType ? `${mobileType} · ` : ""}${isDir ? "" : `${formatBytes(entry.size)} · `}${entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span></span></button>
      <span class="sftp-size">${isDir ? sftpDirectorySizeButtonHtml(id, fullPath) : formatBytes(entry.size)}</span>
      <span class="sftp-time">${entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span>
      <span class="sftp-access" title="权限 ${esc(entry.mode || "未知")}；所有者 ${esc(entry.owner || "未知")}；用户组 ${esc(entry.group || "未知")}"><code>${esc(entry.mode || "---")}</code><span>${esc(entry.owner || "未知")}</span></span>
      <div class="sftp-row-actions">${sftpRowActionsHtml(id, fullPath, entry.name, entry.type)}</div>
    </div>`;
  }).join("");
  const page = Number(sftpState.page || 1);
  const totalPages = Number(sftpState.totalPages || 1);
  const total = Number(sftpState.total || 0);
  const first = total ? (page - 1) * Number(sftpState.pageSize || 50) + 1 : 0;
  const last = total ? Math.min(first + entries.length - 1, total) : 0;
  const pageSizes = [25,50,100,200].map(size => `<option value="${size}" ${size === Number(sftpState.pageSize) ? "selected" : ""}>${size} 项</option>`).join("");
  const filterSummary = sftpState.query && Number(sftpState.unfilteredTotal || 0) !== total ? ` · 目录共 ${Number(sftpState.unfilteredTotal || 0)} 项` : "";
  const pager = `<div class="pager sftp-pager"><button onclick="setSftpPage(${page - 1})" ${page <= 1 ? "disabled" : ""}>上一页</button><span class="pager-count">第 ${page}/${totalPages} 页 · ${first}-${last} / ${total}${filterSummary} · <select aria-label="每页数量" onchange="setSftpPageSize(this.value)">${pageSizes}</select></span><button onclick="setSftpPage(${page + 1})" ${page >= totalPages ? "disabled" : ""}>下一页</button></div>`;
  list.innerHTML = head + (rows || stateView("empty", sftpState.query ? "没有匹配的文件" : "当前目录为空", sftpState.query ? "换一个关键词试试。" : "可以上传文件或新建目录。")) + pager;
  watchSftpListLayout(list);
  updateSftpSelection();
}

function fileTypeLabel(name) {
  const ext = String(name || "").replace(/^\./, "").split(".").pop()?.toUpperCase() || "FILE";
  return ext.length > 5 ? "FILE" : ext;
}

function sftpFileKind(name) {
  const lower = String(name || "").toLowerCase();
  const ext = lower.replace(/^\./, "").split(".").pop() || "";
  if (["sh","bash","zsh","fish","bat","cmd","ps1"].includes(ext) || [".bashrc",".profile",".zshrc"].includes(lower)) return "script";
  if (["json","yaml","yml","toml","xml","ini","conf","cfg","env","properties"].includes(ext)) return "config";
  if (["js","jsx","ts","tsx","css","html","py","go","rs","java","c","cpp","h","sql","php","rb"].includes(ext)) return "code";
  if (["md","txt","rtf"].includes(ext)) return "text";
  if (["log","out"].includes(ext)) return "log";
  if (["zip","gz","tgz","tar","rar","7z","xz","bz2"].includes(ext)) return "archive";
  if (["png","jpg","jpeg","gif","webp","bmp","svg","ico"].includes(ext)) return "image";
  if (["mp4","mkv","avi","mov","mp3","wav","flac"].includes(ext)) return "media";
  if (["csv","tsv","db","sqlite","sqlite3"].includes(ext)) return "data";
  if (["pdf","doc","docx","xls","xlsx","ppt","pptx"].includes(ext)) return "document";
  return "file";
}

function sftpIcon(name, isDir=false) {
  if (isDir) return icon("folder");
  const ext = fileTypeLabel(name);
  const icons = {script:"terminal-square", config:"braces", code:"file-code-2", text:"file-text", log:"scroll-text", archive:"file-archive", image:"image", media:"file-play", data:"database", document:"file-text", file:"file"};
  return `${icon(icons[sftpFileKind(name)] || "file")}<small>${esc(ext)}</small>`;
}

function formatSftpTime(value) {
  return new Date(Number(value) * 1000).toLocaleString("zh-CN", {hour12:false});
}

function sftpDiffHtml(oldText, newText) {
  const oldLines = String(oldText || "").split("\n");
  const newLines = String(newText || "").split("\n");
  const max = Math.max(oldLines.length, newLines.length);
  const rows = [];
  for (let i = 0; i < max; i++) {
    if (oldLines[i] === newLines[i]) continue;
    if (typeof oldLines[i] !== "undefined") rows.push(`<div class="diff-line removed"><b>-</b><code>${esc(oldLines[i]) || " "}</code></div>`);
    if (typeof newLines[i] !== "undefined") rows.push(`<div class="diff-line added"><b>+</b><code>${esc(newLines[i]) || " "}</code></div>`);
    if (rows.length > 180) {
      rows.push(`<div class="diff-line"><b>...</b><code>差异较多，仅显示前 180 行变化</code></div>`);
      break;
    }
  }
  return rows.length ? rows.join("") : `<div class="muted">没有内容变化。</div>`;
}

const sftpTextEncodingOptions = [
  ["utf8","UTF-8"], ["utf8bom","UTF-8 BOM"], ["gb18030","GB18030"], ["gbk","GBK"],
  ["big5","Big5"], ["shift_jis","Shift_JIS"], ["euc-kr","EUC-KR"], ["latin1","ISO-8859-1"]
];

function sftpTextEncodingLabel(value) {
  return sftpTextEncodingOptions.find(([encoding]) => encoding === value)?.[1] || String(value || "UTF-8");
}

const sftpEditorLanguageOptions = [
  ["plain_text","纯文本"], ["yaml","YAML"], ["json","JSON"], ["xml","XML"], ["ini","INI / 配置"],
  ["properties","Properties"], ["toml","TOML"], ["sh","Shell"], ["batchfile","BAT / CMD"], ["powershell","PowerShell"],
  ["javascript","JavaScript"], ["typescript","TypeScript"], ["html","HTML"], ["css","CSS"], ["java","Java"],
  ["c_cpp","C / C++"], ["csharp","C#"], ["python","Python"], ["golang","Go"], ["rust","Rust"],
  ["sql","SQL"], ["markdown","Markdown"], ["dockerfile","Dockerfile"], ["nginx","Nginx"]
];

function sftpEditorLanguageForFile(filename) {
  const basename = String(filename || "").split(/[\\/]/).pop().toLowerCase();
  const extension = basename.includes(".") ? basename.split(".").pop() : "";
  if (["dockerfile","containerfile"].includes(basename)) return "dockerfile";
  if (["makefile","gnumakefile"].includes(basename)) return "sh";
  if ([".bashrc",".bash_profile",".profile",".zshrc",".zprofile",".env"].includes(basename)) return basename === ".env" ? "properties" : "sh";
  if (["yaml","yml"].includes(extension)) return "yaml";
  if (["json","json5"].includes(extension)) return "json";
  if (["xml","svg","plist"].includes(extension)) return "xml";
  if (["ini","conf","cfg","cnf","editorconfig"].includes(extension) || basename.endsWith(".conf")) return basename.includes("nginx") ? "nginx" : "ini";
  if (["properties","env"].includes(extension)) return "properties";
  if (extension === "toml") return "toml";
  if (["sh","bash","zsh","fish"].includes(extension)) return "sh";
  if (["bat","cmd"].includes(extension)) return "batchfile";
  if (["ps1","psm1","psd1"].includes(extension)) return "powershell";
  if (["js","jsx","mjs","cjs"].includes(extension)) return "javascript";
  if (["ts","tsx","mts","cts"].includes(extension)) return "typescript";
  if (["html","htm","vue"].includes(extension)) return "html";
  if (["css","scss","less"].includes(extension)) return "css";
  if (["java","gradle"].includes(extension)) return "java";
  if (["c","h","cc","cpp","cxx","hpp"].includes(extension)) return "c_cpp";
  if (extension === "cs") return "csharp";
  if (["py","pyw"].includes(extension)) return "python";
  if (extension === "go") return "golang";
  if (extension === "rs") return "rust";
  if (["sql","mysql","pgsql"].includes(extension)) return "sql";
  if (["md","markdown","mdown"].includes(extension)) return "markdown";
  return "plain_text";
}

function sftpEditorLanguageLabel(value) {
  return sftpEditorLanguageOptions.find(([mode]) => mode === value)?.[1] || "纯文本";
}

function isSftpImageName(name) {
  return ["png","jpg","jpeg","gif","webp","bmp","ico","svg"].includes(String(name || "").toLowerCase().split(".").pop());
}

function sftpTextModal(title, content, size=0, limit=5*1024*1024, encoding="utf8", preferredEncoding="auto", comparisonContent=content) {
  return new Promise((resolve) => {
    const modal = $("modal");
    const detectedLanguage = sftpEditorLanguageForFile(title);
    const wrapEnabled = localStorage.getItem("sftpEditorWordWrap") !== "0";
    modal.innerHTML = `<div class="modal-card wide sftp-editor-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(title)}</h2><span>${esc(formatBytes(size))} · 上限 ${esc(formatBytes(limit))}</span></div><div class="sftp-editor-controls"><label>文本编码<select id="sftpTextEncoding">${sftpTextEncodingOptions.map(([value,label]) => `<option value="${value}" ${value === encoding ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>语言<select id="sftpEditorLanguage"><option value="auto">自动（${esc(sftpEditorLanguageLabel(detectedLanguage))}）</option>${sftpEditorLanguageOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="check-row compact"><input id="sftpEditorWordWrap" type="checkbox" ${wrapEnabled ? "checked" : ""}> 自动换行</label><span id="sftpEditorStats"></span></div></div><div id="sftpTextEditor" class="sftp-code-editor" aria-label="SFTP 文本编辑器"></div><div id="sftpDiffPreview" class="diff-preview" hidden></div><div class="sftp-editor-options"><label class="check-row"><input id="sftpBackupBeforeSave" type="checkbox" checked> 保存前备份远程文件</label><label class="check-row"><input id="sftpPersistEncoding" type="checkbox" ${preferredEncoding === encoding ? "checked" : ""}> 设为此连接默认文本编码</label></div><div class="actions"><button id="sftpTextFormatJson" hidden>${icon("braces")}<span>格式化 JSON</span></button><button id="sftpTextDiff">预览差异</button><button class="primary" id="sftpTextSave">保存 <span class="shortcut-hint">Ctrl+S</span></button><button id="sftpTextClose">关闭</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    let finished = false;
    const host = $("sftpTextEditor");
    let aceEditor = null;
    let fallbackEditor = null;
    if (window.ace?.edit) {
      ace.config.set("basePath", "/vendor/ace");
      aceEditor = ace.edit(host);
      aceEditor.setTheme(document.documentElement.dataset.theme === "dark" ? "ace/theme/tomorrow_night" : "ace/theme/textmate");
      aceEditor.session.setMode(`ace/mode/${detectedLanguage}`);
      aceEditor.session.setUseWrapMode(wrapEnabled);
      aceEditor.setValue(content, -1);
      aceEditor.setOptions({fontSize:"14px", showPrintMargin:false, useSoftTabs:true, tabSize:2, wrapBehavioursEnabled:true});
    } else {
      fallbackEditor = document.createElement("textarea");
      fallbackEditor.className = "text-editor code-editor";
      fallbackEditor.spellcheck = false;
      fallbackEditor.value = content;
      host.replaceWith(fallbackEditor);
    }
    const getValue = () => aceEditor ? aceEditor.getValue() : fallbackEditor.value;
    const setValue = value => aceEditor ? aceEditor.setValue(value, -1) : (fallbackEditor.value = value);
    const focusEditor = () => aceEditor ? aceEditor.focus() : fallbackEditor.focus();
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onModalKeyDown, true);
      try { aceEditor?.destroy(); } catch {}
      modal.hidden = true;
      resolve(value);
    };
    const saveButton = $("sftpTextSave");
    const selectedLanguage = () => $("sftpEditorLanguage")?.value === "auto" ? detectedLanguage : $("sftpEditorLanguage")?.value;
    const syncFormatButton = () => { $("sftpTextFormatJson").hidden = selectedLanguage() !== "json"; };
    const updateStats = () => {
      const value = getValue();
      const bytes = new Blob([value]).size;
      const tooLarge = bytes > limit;
      const stats = $("sftpEditorStats");
      stats.textContent = `${value.split("\n").length} 行 · ${formatBytes(bytes)}${tooLarge ? " · 已超过上限" : ""}`;
      stats.classList.toggle("limit-exceeded", tooLarge);
      saveButton.disabled = tooLarge;
      return !tooLarge;
    };
    updateStats();
    syncFormatButton();
    if (aceEditor) {
      aceEditor.session.on("change", updateStats);
      aceEditor.commands.addCommand({name:"saveSftpFile", bindKey:{win:"Ctrl-S",mac:"Command-S"}, exec:()=>saveButton.click()});
    } else fallbackEditor.addEventListener("input", updateStats);
    $("sftpTextDiff").onclick = () => {
      const box = $("sftpDiffPreview");
      box.hidden = false;
      box.innerHTML = sftpDiffHtml(comparisonContent, getValue());
    };
    $("sftpTextEncoding").onchange = event => {
      const nextEncoding = event.target.value;
      if (getValue() !== content) {
        event.target.value = encoding;
        notify("请先保存或放弃当前修改，再切换文本编码", "info");
        return;
      }
      finish({action:"encoding", encoding:nextEncoding});
    };
    $("sftpEditorLanguage").onchange = event => {
      const language = event.target.value === "auto" ? detectedLanguage : event.target.value;
      aceEditor?.session.setMode(`ace/mode/${language}`);
      syncFormatButton();
      focusEditor();
    };
    $("sftpTextFormatJson").onclick = () => {
      try {
        const parsed = JSON.parse(getValue().replace(/^\uFEFF/, ""));
        setValue(JSON.stringify(parsed, null, 2));
        updateStats();
        focusEditor();
        notify("JSON 已格式化", "success");
      } catch (error) {
        notify(`JSON 格式错误：${error.message || error}`, "error");
      }
    };
    $("sftpEditorWordWrap").onchange = event => {
      localStorage.setItem("sftpEditorWordWrap", event.target.checked ? "1" : "0");
      aceEditor?.session.setUseWrapMode(event.target.checked);
      if (fallbackEditor) fallbackEditor.style.whiteSpace = event.target.checked ? "pre-wrap" : "pre";
      focusEditor();
    };
    $("sftpTextSave").onclick = () => {
      if (!updateStats()) return notify(`在线编辑内容不能超过 ${formatBytes(limit)}`, "error");
      finish({action:"save", content:getValue(), backup:$("sftpBackupBeforeSave").checked, encoding:$("sftpTextEncoding").value, persist_default:$("sftpPersistEncoding").checked});
    };
    $("sftpTextClose").onclick = async () => {
      if (getValue() !== content && !await confirmModal("当前修改尚未保存，确认关闭？", "放弃修改", "放弃修改", "继续编辑", true)) return;
      finish(null);
    };
    const onModalKeyDown = event => {
      if (event.key === "Escape") $("sftpTextClose").click();
    };
    document.addEventListener("keydown", onModalKeyDown, true);
    setTimeout(focusEditor, 0);
  });
}

async function previewSftpImage(id, path) {
  try {
    const blob = await withSftpFileOpenFeedback(id, path, async () => {
      await ensureSftpConnection(id);
      const response = await fetch(`/api/connections/${id}/sftp/preview-image?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        let message = "图片预览失败";
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      return response.blob();
    });
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const modal = $("modal");
    modal.innerHTML = `<div class="modal-card wide sftp-image-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(path.split(/[\\/]/).pop() || path)}</h2><span>${esc(formatBytes(blob.size))}</span></div><button id="sftpImageClose" class="icon-button" type="button" title="关闭" aria-label="关闭">${icon("x")}</button></div><div class="sftp-image-preview"><img src="${escAttr(objectUrl)}" alt="${escAttr(path)}"></div><div class="actions"><button onclick="downloadSftp(${id},'${escAttr(path)}')">${icon("download")}<span>下载</span></button><button id="sftpImageCloseBottom">关闭</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    const close = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      URL.revokeObjectURL(objectUrl);
      modal.hidden = true;
    };
    const onKeyDown = event => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown, true);
    $("sftpImageClose").onclick = close;
    $("sftpImageCloseBottom").onclick = close;
    $("sftpImageClose").focus();
  } catch (error) {
    notify(error.message || "图片预览失败", "error");
  }
}

async function previewSftpText(id, path) {
  try {
    let requestedEncoding = "";
    while (true) {
      const suffix = requestedEncoding ? `&encoding=${encodeURIComponent(requestedEncoding)}` : "";
      const data = await withSftpFileOpenFeedback(id, path, () => api(`/api/connections/${id}/sftp/read?path=${encodeURIComponent(path)}${suffix}`));
      if (!data) return;
      const baselineKey = sftpFileOpenKey(id, path);
      const comparisonContent = sftpEditorDiffBaselines.has(baselineKey) ? sftpEditorDiffBaselines.get(baselineKey) : (data.content || "");
      const next = await sftpTextModal(path, data.content || "", data.size || 0, data.limit || 5*1024*1024, data.encoding || "utf8", data.preferred_encoding || "auto", comparisonContent);
      if (next === null) return;
      if (next.action === "encoding") {
        requestedEncoding = next.encoding;
        continue;
      }
      if (next.content === (data.content || "") && !(next.persist_default && data.preferred_encoding !== next.encoding)) return notify("文件内容没有变化", "info");
      await api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, persist_default:next.persist_default})});
      sftpEditorDiffBaselines.set(baselineKey, data.content || "");
      const connection = connections.find(item => item.id === id);
      if (connection && next.persist_default) connection.sftp_text_encoding = next.encoding;
      notify(`文件已按 ${sftpTextEncodingLabel(next.encoding)} 保存`, "success");
      return;
    }
  } catch (error) {
    notify(error.message || "读取文件失败", "error");
  }
}

function toggleSftpAll(checked) {
  document.querySelectorAll(".sftp-check").forEach(input => { input.checked = checked; });
  updateSftpSelection();
}

function updateSftpSelection() {
  const inputs = [...document.querySelectorAll(".sftp-check")];
  const count = inputs.filter(input => input.checked).length;
  const box = $("sftpSelectedInfo");
  const bar = $("sftpSelectionBar");
  const selectAll = $("sftpSelectAll");
  const extract = $("sftpSelectionExtract");
  const compress = $("sftpSelectionCompress");
  const permissions = $("sftpSelectionPermissions");
  if (box) box.innerHTML = `<strong>已选择 ${count} 项</strong><span>可批量操作当前页项目</span>`;
  if (bar) bar.hidden = count === 0;
  if (selectAll) {
    selectAll.checked = inputs.length > 0 && count === inputs.length;
    selectAll.indeterminate = count > 0 && count < inputs.length;
  }
  if (extract) extract.hidden = !(count === 1 && isArchiveName(inputs.find(input => input.checked)?.value));
  if (compress) compress.hidden = count === 0;
  if (permissions) permissions.hidden = count === 0;
  inputs.forEach(input => input.closest(".sftp-row")?.classList.toggle("is-selected", input.checked));
}

function clearSftpSelection() {
  document.querySelectorAll(".sftp-check").forEach(input => { input.checked = false; });
  updateSftpSelection();
}

function selectedSftpPaths() {
  return [...document.querySelectorAll(".sftp-check:checked")].map(input => input.value);
}

function selectedSftpEntries() {
  return [...document.querySelectorAll(".sftp-check:checked")].map(input => ({
    path: input.value,
    name: input.dataset.name || input.value.split("/").pop() || input.value,
    type: input.dataset.type || "file",
    size: Math.max(0, Number(input.dataset.size || 0)),
    mtime: Math.max(0, Number(input.dataset.mtime || 0)),
    metadataKnown: input.dataset.metadataKnown === "1",
    mode: input.dataset.mode || "",
    owner: input.dataset.owner || "",
    group: input.dataset.group || ""
  }));
}

function sftpDragEntriesForPath(path, name, type) {
  const selected = selectedSftpEntries();
  if (selected.some(item => item.path === path)) return selected;
  const listed = (sftpState.entries || []).find(item => joinRemotePath(sftpState.path, item.name) === path);
  return [{
    path,
    name,
    type,
    size:Math.max(0, Number(listed?.size || 0)),
    mtime:Math.max(0, Number(listed?.mtime || 0)),
    metadataKnown:Boolean(listed)
  }];
}

function sftpNativeDragKey(connectionId, entries) {
  const paths = [...new Set(entries.map(item => String(item.path || "")).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return `${Number(connectionId)}\0${paths.join("\0")}`;
}

function sftpExternalDragMode() {
  const mode = window.tunnelDeskDesktop?.capabilities?.sftpExternalDrag;
  if ((mode === "staged" || mode === "streaming") && typeof window.tunnelDeskDesktop?.startSftpDrag === "function") return mode;
  return false;
}

function sftpNativeDragStartTiming() {
  return window.tunnelDeskDesktop?.capabilities?.sftpNativeDragStart === "pointerdown"
    ? "pointerdown"
    : "leave-window";
}

function sftpNativeDragFallbackInfo() {
  const capabilities = window.tunnelDeskDesktop?.capabilities;
  if (capabilities?.platform !== "linux" || capabilities?.sftpExternalDrag !== "staged") return null;
  const reason = String(capabilities.sftpNativeDragReason || "").trim();
  const normalizedReason = reason.toLowerCase();
  let reasonText = reason || "系统缺少 FUSE3 运行环境";
  let action = "请检查系统 FUSE3 运行环境后重启 TunnelDesk";
  if (normalizedReason.includes("/dev/fuse is unavailable")) {
    reasonText = "系统没有提供 /dev/fuse";
    action = "请安装 FUSE3 并启用 FUSE 内核设备；容器或沙箱中还需向应用开放 /dev/fuse";
  } else if (normalizedReason.includes("cannot access /dev/fuse")) {
    reasonText = "当前用户无权访问 /dev/fuse";
    action = "请按当前发行版的方式授予 FUSE 设备访问权限，重新登录后再启动 TunnelDesk";
  } else if (normalizedReason.includes("fusermount3 is unavailable")) {
    reasonText = "系统没有安装 FUSE3（fusermount3）";
    action = "请安装 fuse3 运行包后重启 TunnelDesk";
  } else if (normalizedReason.includes("runtime directory cannot be prepared")) {
    reasonText = "当前用户的运行目录不可写";
    action = "请检查 XDG_RUNTIME_DIR 权限后重启 TunnelDesk";
  } else if (normalizedReason.includes("辅助程序尚未安装")) {
    reasonText = "安装包中缺少 Linux 拖出组件";
    action = "请重新安装完整的 TunnelDesk 桌面版";
  }
  return {
    reason:reasonText,
    action,
    hint:"Linux 当前使用兼容拖出；跨主机可直接拖动，保存到本机需准备完成后再拖一次"
  };
}

function showSftpNativeDragFallbackNotice() {
  const fallback = sftpNativeDragFallbackInfo();
  if (!fallback || sftpNativeDragFallbackNoticeShown) return;
  sftpNativeDragFallbackNoticeShown = true;
  notify(
    `Linux 一次拖出当前不可用\n${fallback.reason}。${fallback.action}。当前仍可使用兼容拖出，准备完成后再拖一次即可。`,
    "info"
  );
}

function sftpDragSourceHint() {
  const mode = sftpExternalDragMode();
  const fallback = sftpNativeDragFallbackInfo();
  if (fallback) return fallback.hint;
  if (mode === "streaming") return "拖到其他 SFTP 标签可跨主机复制；拖出窗口可直接保存到本机";
  if (mode === "staged") return "拖到其他 SFTP 标签可跨主机复制；拖出窗口可准备下载到本机";
  return "Web 版仅支持拖到其他 SFTP 标签跨主机复制；保存到本机请使用“下载”";
}

function cleanupSftpNativeDragCache(now=Date.now()) {
  for (const [key, cached] of sftpNativeDragCache) {
    if (!cached.promise && now - Number(cached.createdAt || 0) > SFTP_NATIVE_DRAG_CACHE_TTL_MS) {
      sftpNativeDragCache.delete(key);
      sftpNativeDragArmed.delete(key);
    }
  }
}

function stageSftpNativeDrag(connectionId, entries) {
  cleanupSftpNativeDragCache();
  const key = sftpNativeDragKey(connectionId, entries);
  const cached = sftpNativeDragCache.get(key);
  if (cached?.files?.length && Date.now() - Number(cached.createdAt || 0) <= SFTP_NATIVE_DRAG_CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }
  if (cached?.promise) return cached.promise;
  const request = api(`/api/connections/${connectionId}/sftp/stage-drag`, {
    method:"POST",
    body:JSON.stringify({paths:entries.map(item => item.path)})
  }).then(staged => {
    const result = {files:Array.isArray(staged.files) ? staged.files : [], createdAt:Date.now(), promise:null};
    if (!result.files.length) throw new Error("没有可拖出的文件");
    sftpNativeDragCache.set(key, result);
    return result;
  }).catch(error => {
    sftpNativeDragCache.delete(key);
    throw error;
  });
  sftpNativeDragCache.set(key, {files:[], createdAt:0, promise:request});
  return request;
}

function cachedSftpNativeDrag(connectionId, entries) {
  cleanupSftpNativeDragCache();
  const key = sftpNativeDragKey(connectionId, entries);
  const cached = sftpNativeDragCache.get(key);
  return cached?.files?.length && Date.now() - Number(cached.createdAt || 0) <= SFTP_NATIVE_DRAG_CACHE_TTL_MS ? cached : null;
}

function sftpNativeDragRequestIsActive(request, now=Date.now()) {
  return Boolean(
    request
    && !request.released
    && (request.activated || request.nativeStarted)
    && now - Number(request.lastActivityAt || request.createdAt || now) <= SFTP_NATIVE_DRAG_ACTIVE_TTL_MS
  );
}

function sftpDataTransferTypes(dataTransfer) {
  return Array.from(dataTransfer?.types || []).map(type => String(type || "").toLowerCase());
}

function sftpDataTransferHasInternalPayload(dataTransfer) {
  return sftpDataTransferTypes(dataTransfer).includes(SFTP_INTERNAL_DRAG_MIME);
}

function normalizeSftpDragPayloadEntry(item, fallbackPath="") {
  const path = String(item?.path || fallbackPath || "");
  if (!path) return null;
  const cleanPath = path.replace(/\/+$/, "");
  const fallbackName = cleanPath.split("/").pop() || path;
  return {
    path,
    name:String(item?.name || fallbackName),
    type:String(item?.type || "file"),
    size:Math.max(0, Number(item?.size || 0)),
    mtime:Math.max(0, Number(item?.mtime || 0)),
    metadataKnown:Boolean(item?.metadataKnown)
  };
}

function serializeSftpDragPayload(connectionId, entries, sourceTabKey="") {
  return JSON.stringify({
    connectionId:Number(connectionId),
    sourceTabKey:String(sourceTabKey || ""),
    entries:(entries || []).map(item => normalizeSftpDragPayloadEntry(item)).filter(Boolean)
  });
}

function readSftpDragPayload(dataTransfer) {
  if (!sftpDataTransferHasInternalPayload(dataTransfer) || typeof dataTransfer?.getData !== "function") return null;
  try {
    const raw = dataTransfer.getData(SFTP_INTERNAL_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const connectionId = Number(parsed?.connectionId);
    const sourceEntries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : (Array.isArray(parsed?.paths) ? parsed.paths.map(path => ({path})) : []);
    const entries = sourceEntries.map(item => normalizeSftpDragPayloadEntry(item, item?.path || item)).filter(Boolean);
    if (!Number.isInteger(connectionId) || connectionId <= 0 || !entries.length) return null;
    return {
      connectionId,
      entries,
      sourceTabKey:String(parsed?.sourceTabKey || ""),
      row:null,
      restoredFromDataTransfer:true
    };
  } catch {
    return null;
  }
}

function currentSftpInternalDragHandoff(now=Date.now()) {
  if (!sftpInternalDragHandoff) return null;
  if (Number(sftpInternalDragHandoff.expiresAt || 0) > now) return sftpInternalDragHandoff;
  sftpInternalDragHandoff = null;
  return null;
}

function rememberSftpInternalDragHandoff(drag) {
  if (!drag || !Array.isArray(drag.entries) || !drag.entries.length) return null;
  const handoff = {
    connectionId:Number(drag.connectionId),
    entries:drag.entries.map(item => normalizeSftpDragPayloadEntry(item)).filter(Boolean),
    sourceTabKey:String(drag.sourceTabKey || ""),
    row:null,
    handedOffAt:Date.now(),
    expiresAt:Date.now() + SFTP_INTERNAL_DRAG_HANDOFF_TTL_MS
  };
  if (!Number.isInteger(handoff.connectionId) || handoff.connectionId <= 0 || !handoff.entries.length) return null;
  sftpInternalDragHandoff = handoff;
  setTimeout(() => {
    if (sftpInternalDragHandoff === handoff && Number(handoff.expiresAt || 0) <= Date.now()) {
      sftpInternalDragHandoff = null;
      setSftpExternalDropState(false);
    }
  }, SFTP_INTERNAL_DRAG_HANDOFF_TTL_MS + 50);
  return handoff;
}

function clearSftpInternalDragHandoff() {
  sftpInternalDragHandoff = null;
}

function activeSftpDragPayload(dataTransfer=null) {
  if (sftpInternalDrag && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))) return sftpInternalDrag;
  const handoff = currentSftpInternalDragHandoff();
  if (handoff && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))) return handoff;
  if (dataTransfer && sftpDataTransferHasInternalPayload(dataTransfer)) {
    const restored = readSftpDragPayload(dataTransfer);
    if (restored) return restored;
  }
  const requests = [...sftpNativeDragRequests.values()];
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (!sftpNativeDragRequestIsActive(request)) continue;
    if (Number.isInteger(Number(request?.connectionId)) && Array.isArray(request?.entries) && request.entries.length) return request;
  }
  return null;
}

function activeSftpCrossDropTarget(drag=activeSftpDragPayload()) {
  const target = tabs.find(tab => tab.key === activeTabKey);
  if (!drag || target?.kind !== "sftp" || Number(target.id) === Number(drag.connectionId)) return null;
  return target;
}

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
    window.tunnelDeskDesktop?.cancelSftpDrag?.(pointer.nativeRequestId);
    clearSftpDragVisuals(pointer.row);
  }
}

function handleSftpNativeDragPointerUp(event) {
  const pointer = sftpNativeDragPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  if (pointer.activated && (pointer.nativeReady || pointer.nativeStarted)) return;
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
  const request = sftpNativeDragRequests.get(pointer.nativeRequestId);
  if (request) request.activated = true;
  pointer.row?.classList.remove("is-preparing-drag");
  pointer.row?.classList.add("is-dragging");
  document.body.classList.add("sftp-item-drag-active");
  showSftpDragHint(sftpDragSourceHint());
  showSftpDragPreview(pointer.entries, pointer.lastX ?? pointer.startX, pointer.lastY ?? pointer.startY);
  window.tunnelDeskDesktop?.activateSftpDrag?.(pointer.nativeRequestId);
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

function primeSftpNativeDrag(event, connectionId, path, name, type) {
  const mode = sftpExternalDragMode();
  if (isMobileLayout() || event.button !== 0) return;
  if (event.target?.closest(".sftp-check,.sftp-row-actions")) return;
  clearSftpNativeDragPointer();
  const entries = sftpDragEntriesForPath(path, name, type);
  const row = event.currentTarget;
  const pointer = {
    pointerId:event.pointerId,
    startX:Number(event.clientX),
    startY:Number(event.clientY),
    row,
    connectionId:Number(connectionId),
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
      {armed:true}
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

function showSftpDragHint(message, target=false, action="") {
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
  const visibleHost = $("sftpList") || document.querySelector(".sftp-shell");
  const rect = visibleHost?.getBoundingClientRect?.();
  const viewportWidth = Math.max(0, Number(window.innerWidth || document.documentElement?.clientWidth || 0));
  const visibleLeft = Math.max(0, Number(rect?.left || 0));
  const visibleRight = Math.min(viewportWidth, Number(rect?.right || viewportWidth));
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  if (visibleWidth > 0) {
    const safeInset = Math.min(16, Math.max(4, visibleWidth / 8));
    hint.style.left = `${visibleLeft + visibleWidth / 2}px`;
    hint.style.maxWidth = `${Math.max(1, Math.min(520, visibleWidth - safeInset * 2))}px`;
  } else {
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
}

function clearSftpTabDragPreview() {
  if (sftpTabDragPreviewTimer) clearTimeout(sftpTabDragPreviewTimer);
  sftpTabDragPreviewTimer = 0;
  sftpTabDragPreviewKey = "";
}

function scheduleSftpTabDragPreview(tabKey) {
  if (activeTabKey === tabKey || (sftpTabDragPreviewKey === tabKey && sftpTabDragPreviewTimer)) return;
  clearSftpTabDragPreview();
  sftpTabDragPreviewKey = tabKey;
  sftpTabDragPreviewTimer = setTimeout(() => {
    sftpTabDragPreviewTimer = 0;
    const drag = activeSftpDragPayload();
    const target = tabs.find(tab => tab.key === tabKey);
    if (!drag || target?.kind !== "sftp" || Number(target.id) === Number(drag.connectionId)) return clearSftpTabDragPreview();
    activateTab(tabKey);
    requestAnimationFrame(() => {
      const activeDrag = activeSftpDragPayload();
      const currentTarget = tabs.find(tab => tab.key === tabKey);
      if (!activeDrag || activeTabKey !== tabKey || currentTarget?.kind !== "sftp" || Number(currentTarget.id) === Number(activeDrag.connectionId)) {
        clearSftpTabDragPreview();
        return;
      }
      const node = [...$("tabs").querySelectorAll(".tab")].find(tab => tab.dataset.tabKey === tabKey);
      node?.classList.add("sftp-drop-target");
      showSftpDragHint(`松开复制到 ${currentTarget.title}`, true);
    });
  }, 160);
}

function resetSftpItemDrag(row) {
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

function handleSftpDocumentDragOver() {
  markSftpDragInsideWindow();
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

function beginSftpItemDrag(event, connectionId, path, name, type) {
  if (isMobileLayout()) return event.preventDefault();
  clearSftpInternalDragHandoff();
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
  const entries = sftpDragEntriesForPath(path, name, type);
  const externalDragMode = sftpExternalDragMode();
  if (externalDragMode === "staged") showSftpNativeDragFallbackNotice();
  const cached = externalDragMode === "staged" ? cachedSftpNativeDrag(connectionId, entries) : null;
  const nativeKey = sftpNativeDragKey(connectionId, entries);
  if (externalDragMode === "staged" && cached && sftpNativeDragArmed.has(nativeKey)) {
    event.preventDefault();
    startSftpNativeDrag(event.currentTarget, connectionId, entries, cached, "staged");
    return;
  }
  sftpInternalDrag = {connectionId:Number(connectionId), entries, sourceTabKey:activeTabKey, row:event.currentTarget, browserDragEnded:false, leftWindow:false, leaveWindowTimer:0, nativeFiles:cached?.files || null, nativeStarted:false};
  document.addEventListener("dragleave", handleSftpDocumentDragLeave, true);
  document.addEventListener("dragover", handleSftpDocumentDragOver, true);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(SFTP_INTERNAL_DRAG_MIME, serializeSftpDragPayload(connectionId, entries, activeTabKey));
  event.currentTarget?.classList.add("is-dragging");
  document.body.classList.add("sftp-item-drag-active");
  showSftpDragHint(sftpDragSourceHint());
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
    showSftpDragHint(sftpDragSourceHint());
  }
  try {
    const payload = mode === "streaming"
      ? {connectionId:Number(connectionId), entries:request.entries}
      : request.files;
    window.tunnelDeskDesktop.startSftpDrag(payload, requestId);
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
    title:String(target.title || "SFTP")
  } : null;
  const key = normalized ? `${normalized.id}\0${normalized.tabKey}\0${normalized.path}` : "";
  if (normalized) request.nativeTargetMissedAt = 0;
  if (request.nativeTargetKey === key && !options.final) return;
  request.nativeTargetKey = key;
  request.nativeTarget = normalized;
  window.tunnelDeskDesktop?.setSftpDragTarget?.(requestId, normalized, {final:Boolean(options.final)});
}

function showSftpNativeDragTargetFeedback(target) {
  if (!target) return;
  if (target.tabKey === activeTabKey && Number(sftpState.connectionId) === Number(target.id)) {
    setSftpExternalDropState(true, {title:`松开复制到 ${target.title}`, path:target.path || sftpState.path || "."});
  } else {
    showSftpDragHint(`松开复制到 ${target.title}`, true);
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
  const tabNode = node?.closest?.(".tab[data-kind='sftp']");
  let target = tabNode ? tabs.find(tab => tab.key === tabNode.dataset.tabKey) : null;
  if (!target && node?.closest?.(".sftp-shell")) {
    const active = tabs.find(tab => tab.key === activeTabKey);
    if (active?.kind === "sftp") target = active;
  }
  if (target?.kind === "sftp" && Number(target.id) !== Number(request.connectionId)) {
    document.querySelectorAll(".tab.sftp-drop-target").forEach(tab => tab.classList.remove("sftp-drop-target"));
    tabNode?.classList.add("sftp-drop-target");
    if (!options.final && tabNode && target.key !== activeTabKey) scheduleSftpTabDragPreview(target.key);
    const directory = target.key === activeTabKey && Number(sftpState.connectionId) === Number(target.id)
      ? sftpState.path
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
    && activeTabKey === request.nativeTarget.tabKey
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
  setSftpExternalDropState(false, {keepHint:true});
  updateSftpNativeDragTarget(requestId, request, null, options);
  if (!options.final) {
    // Native pointer coordinates can briefly move across the window boundary
    // while Windows transfers ownership to OLE. Keep one stable fallback copy
    // instead of alternating two messages on every motion event.
    showSftpDragHint(sftpDragSourceHint());
  }
  return null;
}

function handleSftpNativeDragEvent(event) {
  const requestId = String(event?.requestId || "");
  const request = sftpNativeDragRequests.get(requestId);
  if (!request) return;
  request.lastActivityAt = Date.now();
  if (event.type === "transferStarted") {
    refreshSftpJobs();
    return;
  }
  if (event.type === "ready") {
    request.nativeReady = true;
    if (sftpNativeDragPointer?.nativeRequestId === requestId) sftpNativeDragPointer.nativeReady = true;
    if (request.activated) window.tunnelDeskDesktop?.activateSftpDrag?.(requestId);
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
  const target = internalTarget
    ? tabs.find(tab => tab.kind === "sftp" && Number(tab.id) === Number(internalTarget.id))
    : null;
  if (result?.ok && target && Number(target.id) !== Number(request.connectionId)) {
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
      const directory = Number(sftpState.connectionId) === Number(previewTarget.id) ? sftpState.path : previewTarget.path || ".";
      setSftpExternalDropState(true, {title:`松开复制到 ${previewTarget.title}`, path:directory});
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
  resetSftpItemDrag(event?.currentTarget);
}

function handleSftpTabDragOver(event, tabKey) {
  const target = tabs.find(tab => tab.key === tabKey);
  const drag = activeSftpDragPayload(event?.dataTransfer);
  if (!drag || target?.kind !== "sftp" || Number(target.id) === Number(drag.connectionId)) return;
  markSftpDragInsideWindow();
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  event.currentTarget?.classList.add("sftp-drop-target");
  showSftpDragHint(`松开复制到 ${target.title}`, true);
  scheduleSftpTabDragPreview(tabKey);
}

function handleSftpTabDragLeave(event) {
  if (!event.currentTarget?.contains(event.relatedTarget)) {
    event.currentTarget?.classList.remove("sftp-drop-target");
    if (activeTabKey !== event.currentTarget?.dataset?.tabKey) clearSftpTabDragPreview();
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

async function dropSftpItemsOnTab(event, tabKey) {
  const drag = activeSftpDragPayload(event?.dataTransfer);
  const target = tabs.find(tab => tab.key === tabKey);
  event.currentTarget?.classList.remove("sftp-drop-target");
  if (!drag || target?.kind !== "sftp" || Number(target.id) === Number(drag.connectionId)) return;
  event.preventDefault();
  event.stopPropagation();
  await copySftpDraggedItemsToTarget(drag, target);
}

async function copySftpDraggedItemsToTarget(drag, target) {
  if (!drag || target?.kind !== "sftp" || Number(target.id) === Number(drag.connectionId)) return;
  sftpExternalDragPreparing = null;
  const directory = activeTabKey === target.key && Number(sftpState.connectionId) === Number(target.id)
    ? sftpState.path
    : target.path || ".";
  const dragKey = sftpNativeDragKey(drag.connectionId, drag.entries || []);
  const nativeRequests = [...sftpNativeDragRequests.entries()].reverse();
  for (const [requestId, request] of nativeRequests) {
    if (Number(request?.connectionId) !== Number(drag.connectionId)) continue;
    if (sftpNativeDragKey(request.connectionId, request.entries || []) !== dragKey) continue;
    updateSftpNativeDragTarget(requestId, request, {...target, path:directory}, {final:true});
    break;
  }
  finishSftpDragPayload(drag);
  showSftpDragHint(`正在检查 ${target.title} 并准备复制`, true);
  const pendingHint = $("sftpDragHint");
  try {
    const conflict = await sftpConflictChoice(target.id, directory, drag.entries, {title:"目标 SFTP 存在同名项目"});
    if (conflict === "cancel") return;
    const job = await api(`/api/connections/${drag.connectionId}/sftp/cross-copy`, {
      method:"POST",
      body:JSON.stringify({paths:drag.entries.map(item => item.path), entries:drag.entries, target_connection_id:Number(target.id), target:directory, conflict})
    });
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "跨 SFTP 标签复制失败", "error");
  } finally {
    if ($("sftpDragHint") === pendingHint) pendingHint?.remove();
  }
}

function isArchiveName(name) {
  return /\.(zip|tar|tar\.gz|tgz)$/i.test(String(name || ""));
}

function selectSftpEntry(id, path, name, type) {
  sftpState.selected = { id, path, name, type };
  document.querySelectorAll(".sftp-row").forEach(row => row.classList.remove("active"));
  const input = [...document.querySelectorAll(".sftp-check")].find(item => item.value === path);
  if (input) input.closest(".sftp-row")?.classList.add("active");
}

function activateSftpEntry(event, id, path, name, type) {
  if (event?.target?.closest(".sftp-check, .sftp-row-actions")) return;
  event?.preventDefault();
  event?.stopPropagation();
  selectSftpEntry(id, path, name, type);
  if (type === "dir") return openSftp(id, path);
  return isSftpImageName(name) ? previewSftpImage(id, path) : previewSftpText(id, path);
}

function sftpRowActionsHtml(id, path, name, type) {
  const isDir = type === "dir";
  const archive = !isDir && isArchiveName(name);
  return [
    isDir
      ? `<button class="sftp-row-action sftp-row-action-core" title="打开目录" onclick="event.stopPropagation();openSftp(${id},'${escAttr(path)}')">${icon("folder-open")}<span>打开</span></button>`
      : isSftpImageName(name)
        ? `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${id}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="image" title="预览图片" onclick="event.stopPropagation();previewSftpImage(${id},'${escAttr(path)}')">${icon("image")}<span>预览</span></button>`
        : `<button class="sftp-row-action sftp-row-action-core sftp-file-open-button" data-sftp-connection-id="${id}" data-sftp-remote-path="${esc(path)}" data-sftp-open-kind="text" title="以文本打开" onclick="event.stopPropagation();previewSftpText(${id},'${escAttr(path)}')">${icon("file-text")}<span>打开</span></button>`,
    !isDir ? `<button class="sftp-row-action sftp-row-action-medium" title="下载" onclick="event.stopPropagation();downloadSftp(${id},'${escAttr(path)}')">${icon("download")}<span>下载</span></button>` : "",
    archive ? `<button class="sftp-row-action sftp-row-action-medium" title="解压" onclick="event.stopPropagation();extractSingleSftp(${id},'${escAttr(path)}')">${icon("archive-restore")}<span>解压</span></button>` : "",
    `<button class="sftp-row-action sftp-row-action-medium" title="压缩" onclick="event.stopPropagation();compressSingleSftp(${id},'${escAttr(path)}')">${icon("archive")}<span>压缩</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="复制" onclick="event.stopPropagation();copySingleSftp('${escAttr(path)}','copy')">${icon("copy")}<span>复制</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="移动" onclick="event.stopPropagation();copySingleSftp('${escAttr(path)}','move')">${icon("folder-input")}<span>移动</span></button>`,
    `<button class="sftp-row-action sftp-row-action-medium" title="重命名" onclick="event.stopPropagation();renameSftp(${id},'${escAttr(path)}','${escAttr(name)}')">${icon("pencil")}<span>重命名</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide" title="设置权限" onclick="event.stopPropagation();openSftpPermissionsForSelection(['${escAttr(path)}'])">${icon("key-round")}<span>权限</span></button>`,
    `<button class="sftp-row-action sftp-row-action-wide danger" title="删除" onclick="event.stopPropagation();deleteSftp(${id},'${escAttr(path)}')">${icon("trash-2")}<span>删除</span></button>`,
    `<button class="sftp-row-action sftp-row-action-more" title="更多操作" aria-label="${esc(name)}的更多操作" onclick="showSftpEntryMenu(event, ${id},'${escAttr(path)}','${escAttr(name)}','${escAttr(type)}')">${icon("ellipsis")}<span>更多</span></button>`
  ].filter(Boolean).join("");
}

function refreshSftp(options={}) {
  clearTimeout(sftpSearchTimer);
  const tab = tabs.find(item => item.key === activeTabKey);
  if (tab?.kind === "sftp") return loadSftpPage({connectionId:tab.id, path:sftpState.path || tab.path || ".", page:sftpState.page || 1, tabKey:tab.key, refresh:true, preserveView:true, ...options});
}

async function mkdirSftp() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const name = await inputModal("新建目录", "目录名称", "");
  if (!tab || !name) return;
  if (!isValidSftpChildName(name, "目录名")) return;
  try {
    await api(`/api/connections/${tab.id}/sftp/mkdir`, {method:"POST", body:JSON.stringify({path:joinRemotePath(sftpState.path || ".", name)})});
    notify("目录已创建", "success");
    refreshSftp();
  } catch (error) {
    notify(error.message || "新建目录失败", "error");
  }
}

function isValidSftpChildName(value, label = "名称") {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.includes("\0")) {
    notify(`${label}不能包含路径分隔符或特殊目录名`, "error");
    return false;
  }
  return true;
}

async function createSftpFile() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const name = await inputModal("新建文件", "文件名", "");
  if (!tab || !name || !isValidSftpChildName(name, "文件名")) return;
  const remotePath = joinRemotePath(sftpState.path || ".", name);
  try {
    await api(`/api/connections/${tab.id}/sftp/create-file`, {method:"POST", body:JSON.stringify({path:remotePath})});
    notify("文件已创建", "success");
    await refreshSftp();
  } catch (error) {
    notify(error.message || "新建文件失败", "error");
  }
}

async function renameSftp(id, from, oldName) {
  const name = await inputModal("重命名", "新名称", oldName);
  if (!name) return;
  await api(`/api/connections/${id}/sftp/rename`, {method:"POST", body:JSON.stringify({from, to:joinRemotePath(parentRemotePath(from), name)})});
  refreshSftp();
}

async function currentSftpRecycleBinEnabled() {
  if (runtimeSettings?.saved && typeof runtimeSettings.saved.sftp_recycle_bin_enabled === "boolean") {
    return runtimeSettings.saved.sftp_recycle_bin_enabled;
  }
  try {
    runtimeSettings = normalizeRuntimeSettingsResponse(await api("/api/runtime-settings"));
    return runtimeSettings.saved.sftp_recycle_bin_enabled;
  } catch {
    return null;
  }
}

function sftpDeleteConfirmation(enabled, count, remotePath="") {
  const itemText = count === 1 ? "该远程项目" : `选中的 ${count} 个远程项目`;
  if (enabled === true) return {
    title:"移入回收站",
    message:`将${itemText}移入回收站？${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"移入回收站",
    danger:false
  };
  if (enabled === false) return {
    title:"永久删除远程项目",
    message:`回收站未开启，将永久删除${itemText}且无法恢复。${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"永久删除",
    danger:true
  };
  return {
    title:"删除远程项目",
    message:`删除${itemText}？系统将按当前回收站设置处理。${remotePath ? `\n${remotePath}` : ""}`,
    confirm:"继续",
    danger:true
  };
}

async function deleteSftp(id, path) {
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), 1, path);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, "取消", confirmation.danger)) return;
  const job = await api(`/api/connections/${id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths:[path]})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function deleteSftpSelection() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const paths = selectedSftpPaths();
  if (!tab || !paths.length) return notify("请选择文件或目录", "info");
  const confirmation = sftpDeleteConfirmation(await currentSftpRecycleBinEnabled(), paths.length);
  if (!await confirmModal(confirmation.message, confirmation.title, confirmation.confirm, "取消", confirmation.danger)) return;
  const job = await api(`/api/connections/${tab.id}/sftp/delete`, {method:"POST", body:JSON.stringify({paths})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function copySftpSelection(mode) {
  const entries = selectedSftpEntries();
  if (!entries.length) return notify("请选择文件或目录", "info");
  const tab = tabs.find(item => item.key === activeTabKey);
  sftpClipboard = {mode, paths:entries.map(item => item.path), entries, connectionId:Number(sftpState.connectionId), connectionName:tab?.title || tab?.name || ""};
  refreshSftpDirectoryActions();
  notify(`${mode === "move" ? "移动" : "复制"}队列已保存，进入目标目录后点击粘贴`, "success");
}

function copySingleSftp(path, mode) {
  const tab = tabs.find(item => item.key === activeTabKey);
  const listed = (sftpState.entries || []).find(item => joinRemotePath(sftpState.path, item.name) === path);
  const entries = [{
    path,
    name:listed?.name || sftpPathName(path),
    type:listed?.type || "file",
    size:Math.max(0, Number(listed?.size || 0)),
    mtime:Math.max(0, Number(listed?.mtime || 0)),
    metadataKnown:Boolean(listed)
  }];
  sftpClipboard = { mode, paths:[path], entries, connectionId:Number(sftpState.connectionId), connectionName:tab?.title || tab?.name || "" };
  refreshSftpDirectoryActions();
  notify(`${mode === "move" ? "移动" : "复制"}队列已保存，进入目标目录后点击粘贴`, "success");
}

async function pasteSftpClipboard() {
  const tab = tabs.find(item => item.key === activeTabKey);
  if (!tab || !sftpClipboard?.paths?.length) return notify("剪贴板为空", "info");
  const sameConnection = sftpClipboardMatchesConnection();
  if (!sameConnection && sftpClipboard.mode !== "copy") return notify("跨主机只支持复制，不能移动", "error");
  const endpoint = sftpClipboard.mode === "move" ? "move" : "copy";
  try {
    const sourceConnectionId = Number(sftpClipboard.connectionId);
    const target = sftpState.path || ".";
    let conflict = "error";
    if (!sameConnection) {
      const entries = sftpClipboard.paths.map(path => ({path, name:sftpPathName(path)}));
      conflict = await sftpConflictChoice(Number(tab.id), target, entries, {title:"目标 SFTP 存在同名项目"});
      if (conflict === "cancel") return;
    }
    const requestUrl = sameConnection
      ? `/api/connections/${tab.id}/sftp/${endpoint}`
      : `/api/connections/${sourceConnectionId}/sftp/cross-copy`;
    const requestBody = sameConnection
      ? {paths:sftpClipboard.paths, target, background:true}
      : {paths:sftpClipboard.paths, entries:sftpClipboard.entries || [], target_connection_id:Number(tab.id), target, conflict};
    const job = await api(requestUrl, {method:"POST", body:JSON.stringify(requestBody)});
    trackSftpMutationJob(job);
    sftpClipboard = null;
    refreshSftpDirectoryActions();
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "粘贴失败", "error");
  }
}

async function extractSftpSelection() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const paths = selectedSftpPaths();
  if (!tab || paths.length !== 1) return notify("请选择一个压缩包", "info");
  const job = await api(`/api/connections/${tab.id}/sftp/extract`, {method:"POST", body:JSON.stringify({path:paths[0], target:sftpState.path || ".", background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

function sftpPathName(remotePath) {
  return String(remotePath || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "archive";
}

function defaultSftpArchiveName(entries) {
  if (entries.length === 1) return `${sftpPathName(entries[0].path)}.tar.gz`;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `archive-${stamp}.tar.gz`;
}

async function compressSftpSelection() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const entries = selectedSftpEntries();
  if (!tab || !entries.length) return notify("请选择要压缩的文件或目录", "info");
  const name = await inputModal("压缩选中项目", "压缩包名称（自动使用 tar.gz）", defaultSftpArchiveName(entries));
  if (!name) return;
  try {
    const job = await api(`/api/connections/${tab.id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), target:sftpState.path || ".", filename:name})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "压缩任务创建失败", "error");
  }
}

function normalizePermissionMode(value) {
  const mode = String(value ?? "").trim();
  return /^[0-7]{3}$/.test(mode) ? mode : "";
}

function permissionModeToChecks(value) {
  const mode = normalizePermissionMode(value);
  const digits = mode ? mode.split("").map(Number) : [0, 0, 0];
  return {
    ownerRead: Boolean(digits[0] & 4), ownerWrite: Boolean(digits[0] & 2), ownerExecute: Boolean(digits[0] & 1),
    groupRead: Boolean(digits[1] & 4), groupWrite: Boolean(digits[1] & 2), groupExecute: Boolean(digits[1] & 1),
    publicRead: Boolean(digits[2] & 4), publicWrite: Boolean(digits[2] & 2), publicExecute: Boolean(digits[2] & 1)
  };
}

function permissionChecksToMode(checks) {
  const digit = (read, write, execute) => (read ? 4 : 0) + (write ? 2 : 0) + (execute ? 1 : 0);
  return `${digit(checks.ownerRead, checks.ownerWrite, checks.ownerExecute)}${digit(checks.groupRead, checks.groupWrite, checks.groupExecute)}${digit(checks.publicRead, checks.publicWrite, checks.publicExecute)}`;
}

function selectedSftpPermissionMetadata(entries) {
  const modes = entries.map(item => normalizePermissionMode(item.mode)).filter(Boolean);
  const owners = entries.map(item => item.owner).filter(Boolean);
  const groups = entries.map(item => item.group).filter(Boolean);
  return {
    mode: modes.length === entries.length && modes.every(item => item === modes[0]) ? modes[0] : "",
    owner: owners.length === entries.length && owners.every(item => item === owners[0]) ? owners[0] : "",
    group: groups.length === entries.length && groups.every(item => item === groups[0]) ? groups[0] : "",
    mixedMode: modes.length > 1 && new Set(modes).size > 1,
    hasDirectory: entries.some(item => item.type === "dir")
  };
}

function permissionFieldsetHtml(title, prefix, checks) {
  return `<fieldset class="sftp-permission-group"><legend>${title}</legend><label><input type="checkbox" data-permission="${prefix}Read" ${checks[`${prefix}Read`] ? "checked" : ""}>读取</label><label><input type="checkbox" data-permission="${prefix}Write" ${checks[`${prefix}Write`] ? "checked" : ""}>写入</label><label><input type="checkbox" data-permission="${prefix}Execute" ${checks[`${prefix}Execute`] ? "checked" : ""}>执行</label></fieldset>`;
}

function openSftpPermissionsForSelection(paths = null) {
  const selected = paths ? paths.map(path => ({path, name:sftpPathName(path)})) : selectedSftpEntries();
  if (!selected.length) return notify("请选择要设置权限的文件或目录", "info");
  const entries = selected.map(item => {
    const known = (sftpState.entries || []).find(entry => joinRemotePath(sftpState.path, entry.name) === item.path);
    return {...item, mode:item.mode || known?.mode || "", owner:item.owner || known?.owner || "", group:item.group || known?.group || "", type:item.type || known?.type || "file"};
  });
  const metadata = selectedSftpPermissionMetadata(entries);
  const modal = $("modal");
  modal.onclick = null;
  const mode = metadata.mode;
  const checks = permissionModeToChecks(mode);
  modal.innerHTML = `<div class="modal-card wide sftp-permission-modal" role="dialog" aria-modal="true" aria-labelledby="sftpPermissionTitle"><div class="sftp-permission-head"><div><h2 id="sftpPermissionTitle">设置权限</h2><span>${entries.length} 个项目${metadata.mixedMode ? " · 当前权限不一致，请输入新的权限值" : ""}</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" id="sftpPermissionClose">${icon("x")}</button></div><div class="sftp-permission-groups">${permissionFieldsetHtml("所有者", "owner", checks)}${permissionFieldsetHtml("用户组", "group", checks)}${permissionFieldsetHtml("公共", "public", checks)}</div><div class="sftp-permission-fields"><label>权限值<input id="sftpPermissionMode" inputmode="numeric" maxlength="3" value="${esc(mode)}" placeholder="例如 755"><span>三位八进制数字</span></label><label>所有者<input id="sftpPermissionOwner" value="${esc(metadata.owner)}" placeholder="多个值，留空不修改" autocomplete="off"><span>留空表示不修改</span></label><label>用户组<input id="sftpPermissionGroup" value="${esc(metadata.group)}" placeholder="多个值，留空不修改" autocomplete="off"><span>留空表示不修改</span></label></div>${metadata.hasDirectory ? `<label class="check-row sftp-permission-recursive"><input id="sftpPermissionRecursive" type="checkbox">应用到目录内的子目录和文件</label>` : ""}<p class="sftp-permission-note">修改所有者或用户组需要远端账号具备相应权限；不会自动使用 sudo。只修改权限值时可将这两个字段留空。</p><div id="sftpPermissionStatus" class="sftp-permission-status" role="status" aria-live="polite">等待应用</div><div class="actions"><button id="sftpPermissionCancel">取消</button><button class="primary" id="sftpPermissionApply">应用</button></div></div>`;
  modal.hidden = false;
  const modeInput = $("sftpPermissionMode");
  const apply = $("sftpPermissionApply");
  const syncChecks = () => {
    const next = normalizePermissionMode(modeInput.value);
    apply.disabled = !next;
    if (!next) return;
    const nextChecks = permissionModeToChecks(next);
    modal.querySelectorAll("[data-permission]").forEach(input => { input.checked = Boolean(nextChecks[input.dataset.permission]); });
  };
  const syncMode = () => {
    const next = {};
    modal.querySelectorAll("[data-permission]").forEach(input => { next[input.dataset.permission] = input.checked; });
    modeInput.value = permissionChecksToMode(next);
    apply.disabled = false;
  };
  modal.querySelectorAll("[data-permission]").forEach(input => input.addEventListener("change", syncMode));
  modeInput.addEventListener("input", syncChecks);
  syncChecks();
  let busy = false;
  const applyIdleHtml = apply.innerHTML;
  const status = $("sftpPermissionStatus");
  const setBusy = (value, message = "") => {
    busy = value;
    modal.querySelectorAll("input, button").forEach(control => { control.disabled = value; });
    apply.setAttribute("aria-busy", value ? "true" : "false");
    apply.innerHTML = value ? `${icon("loader-circle")}<span>正在应用</span>` : applyIdleHtml;
    apply.classList.toggle("is-loading", value);
    status.className = `sftp-permission-status${value ? " busy" : ""}`;
    status.textContent = message || (value ? "正在连接远程服务器并修改权限…" : "等待应用");
    if (!value) syncChecks();
  };
  const close = (force = false) => {
    if (busy && !force) return;
    modal.hidden = true;
    modal.onclick = null;
    modal.innerHTML = "";
  };
  $("sftpPermissionClose").onclick = () => close();
  $("sftpPermissionCancel").onclick = () => close();
  apply.onclick = async () => {
    if (busy) return;
    const nextMode = normalizePermissionMode(modeInput.value);
    if (!nextMode) return notify("权限值必须是三位八进制数字，例如 755", "error");
    try {
      const ownerInput = $("sftpPermissionOwner");
      const groupInput = $("sftpPermissionGroup");
      const owner = ownerInput.value.trim() && ownerInput.value.trim() !== metadata.owner ? ownerInput.value.trim() : "";
      const group = groupInput.value.trim() && groupInput.value.trim() !== metadata.group ? groupInput.value.trim() : "";
      setBusy(true);
      await api(`/api/connections/${sftpState.connectionId}/sftp/permissions`, {method:"POST", body:JSON.stringify({paths:entries.map(item => item.path), mode:nextMode, owner, group, recursive:Boolean($("sftpPermissionRecursive")?.checked)})});
      close(true);
      notify("权限修改完成", "success");
      refreshSftp();
    } catch (error) {
      const message = error.message || "权限修改失败";
      setBusy(false, `修改失败：${message}`);
      status.classList.add("error");
      notify(message, "error");
    }
  };
  if (!mode) modeInput.focus();
}

function startSftpJobsTimer() {
  if (sftpJobsTimer) return;
  sftpJobsTimer = setInterval(() => {
    if (!document.hidden) refreshSftpJobs();
    void refreshActiveSftpSessionStatus();
  }, 3000);
}

function sftpJobProgress(job) {
  const size = Math.max(0, Number(job?.size || 0));
  const known = job?.progress_known === true || job?.size_known === true || size > 0;
  if (!known) return null;
  const transferred = Math.max(0, Math.min(size, Number(job?.transferred || 0)));
  const calculated = size ? transferred / size * 100 : 0;
  const explicit = Number(job?.progress);
  let percent = Number.isFinite(explicit) ? explicit : calculated;
  if (["running", "pending", "paused"].includes(job?.status) && percent >= 100) percent = 99;
  if (job?.status === "done") percent = 100;
  return {
    size,
    transferred,
    percent:Math.max(0, Math.min(100, percent)),
    weightable:size > 0 && !job?.two_stage_upload
  };
}

function sftpJobProgressLabel(job, progress) {
  if (!progress) return "";
  return `${job?.progress_estimated ? "约 " : ""}${Math.round(progress.percent)}%`;
}

function sftpFloatingJobDetail(job) {
  const progress = sftpJobProgress(job);
  const speed = job.status === "running" ? Number(job.speed_bps || 0) : 0;
  const transferred = Math.max(0, Number(job.transferred || 0));
  const size = Math.max(0, Number(job.size || 0));
  const amount = job.progress_unit === "items" && size
    ? `已处理 ${Math.min(size, transferred)} / ${size} 项`
    : progress
      ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.size)}`
      : "";
  return [job.connection_name || "", sftpJobStatus(job.status, job.phase), amount, speed ? `${formatBytes(speed)}/s` : "", sftpJobProgressLabel(job, progress)]
    .filter(Boolean)
    .join(" · ");
}

function dismissSftpTaskFloat() {
  for (const job of sftpLatestJobs.filter(item => SFTP_ACTIVE_JOB_STATUSES.has(item.status))) {
    if (job.id) sftpDismissedFloatingJobIds.add(String(job.id));
  }
  const box = $("sftpTaskFloat");
  if (box) box.hidden = true;
}

async function openSftpTaskList(event) {
  if (event?.target?.closest?.(".sftp-task-float-actions")) return;
  event?.preventDefault?.();
  const job = sftpLatestJobs.find(item => SFTP_ACTIVE_JOB_STATUSES.has(item.status));
  const connectionId = Number(job?.connection_id || sftpState.connectionId || 0);
  if (!connectionId || !connections.some(item => Number(item.id) === connectionId)) {
    return notify("任务对应的 SSH 连接已不存在", "error");
  }
  const tab = tabs.find(item => item.kind === "sftp" && Number(item.id) === connectionId);
  const tabKey = `sftp-${connectionId}`;
  const navigationSeq = ++sftpTaskNavigationSeq;
  const opening = Promise.resolve(openSftp(connectionId, tab?.path || ".")).catch(() => false);
  await Promise.resolve();
  if (navigationSeq !== sftpTaskNavigationSeq || activeView !== "sftp" || activeTabKey !== tabKey) return;
  await refreshSftpJobs();
  if (navigationSeq !== sftpTaskNavigationSeq || activeView !== "sftp" || activeTabKey !== tabKey) return;
  const box = $("sftpJobs");
  if (!box || $("view-sftp")?.dataset.sftpTabKey !== tabKey) return;
  const drawer = box?.querySelector("details");
  if (drawer) drawer.open = true;
  const workspace = box.closest(".workspace");
  if (workspace) workspace.scrollTo({top:0, behavior:"auto"});
  else box.scrollIntoView({block:"nearest", behavior:"auto"});
  void opening;
}

function updateSftpTaskFloat(jobs) {
  const box = $("sftpTaskFloat");
  if (!box) return;
  const active = jobs.filter(job => SFTP_ACTIVE_JOB_STATUSES.has(job.status));
  const activeIds = new Set(active.map(job => String(job.id || "")).filter(Boolean));
  for (const id of [...sftpDismissedFloatingJobIds]) {
    if (!activeIds.has(id)) sftpDismissedFloatingJobIds.delete(id);
  }
  if (!active.length) {
    box.hidden = true;
    box.innerHTML = "";
    delete box.dataset.statusIcon;
    return;
  }
  if (!active.some(job => !sftpDismissedFloatingJobIds.has(String(job.id || "")))) {
    box.hidden = true;
    return;
  }

  const progressRows = active.map(sftpJobProgress);
  const determinate = progressRows.every(Boolean);
  const progressUnits = new Set(active.map(job => job.progress_unit || "bytes"));
  const totalSize = determinate ? progressRows.reduce((total, item) => total + item.size, 0) : 0;
  const weighted = determinate && progressUnits.size === 1 && totalSize > 0 && progressRows.every(item => item.weightable);
  const percent = !determinate
    ? 0
    : weighted
      ? progressRows.reduce((total, item) => total + item.percent * item.size, 0) / totalSize
      : progressRows.reduce((total, item) => total + item.percent, 0) / progressRows.length;
  const totalSpeed = active.reduce((total, job) => total + (job.status === "running" ? Math.max(0, Number(job.speed_bps || 0)) : 0), 0);
  const title = active.length === 1 ? (active[0].label || "SFTP 任务") : `${active.length} 个 SFTP 任务`;
  const detail = active.length === 1
    ? sftpFloatingJobDetail(active[0])
    : [
        `${active.filter(job => job.status === "running").length} 项执行中`,
        active.some(job => job.status === "pending") ? `${active.filter(job => job.status === "pending").length} 项准备中` : "",
        active.some(job => job.status === "paused") ? `${active.filter(job => job.status === "paused").length} 项已暂停` : "",
        totalSpeed ? `${formatBytes(totalSpeed)}/s` : "",
        determinate ? `${active.some(job => job.progress_estimated) ? "约 " : ""}${Math.round(percent)}%` : ""
      ].filter(Boolean).join(" · ");
  const singleCancelable = active.length === 1 && SFTP_ACTIVE_JOB_STATUSES.has(active[0].status)
    && active[0].can_cancel !== false
    && !(active[0].type === "upload" && active[0].phase === "committing");
  if (!box.querySelector(".sftp-task-float-head")) {
    box.innerHTML = `<div class="sftp-task-float-head"><button type="button" class="sftp-task-float-open" title="查看 SFTP 任务列表"><span class="sftp-task-float-icon"></span><span class="sftp-task-float-copy"><strong class="sftp-task-float-title"></strong><span class="sftp-task-float-detail"></span></span></button><span class="sftp-task-float-actions"><button type="button" class="icon-button sftp-task-float-cancel" onclick="event.stopPropagation();cancelSftpJob(this.dataset.jobId)" title="取消任务" aria-label="取消任务" hidden>${icon("square")}</button><button type="button" class="icon-button sftp-task-float-close" onclick="event.stopPropagation();dismissSftpTaskFloat()" title="关闭任务进度" aria-label="关闭任务进度">${icon("x")}</button></span></div><div class="progress" role="progressbar" aria-label="SFTP 任务进度"><i></i></div>`;
  }
  const hasRunning = active.some(job => job.status === "running");
  const statusIcon = box.querySelector(".sftp-task-float-icon");
  const statusIconKind = hasRunning ? "running" : "paused";
  if (statusIcon && box.dataset.statusIcon !== statusIconKind) {
    statusIcon.innerHTML = hasRunning
      ? `<span class="sftp-task-spinner" aria-hidden="true"></span>`
      : icon("pause");
    box.dataset.statusIcon = statusIconKind;
  }
  const titleNode = box.querySelector(".sftp-task-float-title");
  const detailNode = box.querySelector(".sftp-task-float-detail");
  if (titleNode) titleNode.textContent = title;
  if (detailNode) detailNode.textContent = detail;
  const cancelButton = box.querySelector(".sftp-task-float-cancel");
  if (cancelButton) {
    cancelButton.hidden = !singleCancelable;
    cancelButton.dataset.jobId = singleCancelable ? String(active[0].id || "") : "";
  }
  const progress = box.querySelector(".progress");
  const progressBar = progress?.querySelector("i");
  if (progress) {
    progress.classList.toggle("indeterminate", !determinate);
    if (determinate) {
      progress.setAttribute("aria-valuenow", String(Math.round(percent)));
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
    } else {
      progress.removeAttribute("aria-valuenow");
      progress.removeAttribute("aria-valuemin");
      progress.removeAttribute("aria-valuemax");
    }
  }
  if (progressBar) progressBar.style.width = determinate ? `${percent}%` : "";
  box.hidden = false;
}

function trackSftpMutationJob(job) {
  if (job?.id) sftpKnownJobStatuses.set(String(job.id), String(job.status || "running"));
}

function completedSftpMutationForCurrentView(jobs) {
  let shouldRefresh = false;
  const visibleIds = new Set();
  for (const job of jobs) {
    const id = String(job.id || "");
    if (!id) continue;
    visibleIds.add(id);
    const previous = sftpKnownJobStatuses.get(id);
    if (previous && previous !== job.status && ["done", "cancelled", "failed"].includes(job.status) && SFTP_MUTATING_JOB_TYPES.has(job.type) && Number(job.connection_id) === Number(sftpState.connectionId)) {
      shouldRefresh = true;
    }
    sftpKnownJobStatuses.set(id, String(job.status || ""));
  }
  for (const id of [...sftpKnownJobStatuses.keys()]) {
    if (!visibleIds.has(id) && sftpKnownJobStatuses.size > 80) sftpKnownJobStatuses.delete(id);
  }
  return shouldRefresh;
}

function flushPendingSftpDirectoryRefresh() {
  const connectionId = Number(sftpState.connectionId || 0);
  if (!connectionId || sftpState.loading || activeView !== "sftp" || !sftpPendingDirectoryRefreshes.has(connectionId)) return;
  sftpPendingDirectoryRefreshes.delete(connectionId);
  refreshSftp();
}

async function refreshSftpJobs() {
  const box = $("sftpJobs");
  const requestSeq = ++sftpJobsRequestSeq;
  const jobs = await api("/api/sftp/jobs").catch(() => []);
  if (requestSeq !== sftpJobsRequestSeq) return sftpLatestJobs;
  const readyBrowserDownload = jobs.find(job => job.status === "done"
    && job.type === "download"
    && sftpPendingBrowserDownloads.has(job.id));
  if (readyBrowserDownload) {
    sftpPendingBrowserDownloads.delete(readyBrowserDownload.id);
    saveSftpJobFile(readyBrowserDownload.id);
    notify("下载完成，已交给当前设备的浏览器保存", "success");
  }
  sftpLatestJobs = jobs;
  updateSftpTaskFloat(jobs);
  const refreshDirectory = completedSftpMutationForCurrentView(jobs);
  if (refreshDirectory) {
    sftpPendingDirectoryRefreshes.add(Number(sftpState.connectionId));
    flushPendingSftpDirectoryRefresh();
  }
  if (!box) return jobs;
  const current = jobs.filter(job => ["running", "pending", "paused", "failed"].includes(job.status)
    || (job.status === "done" && job.type === "download" && job.delivery_status === "failed")).slice(0, 8);
  const history = jobs.filter(job => ["done", "cancelled"].includes(job.status));
  const wasOpen = box.querySelector("details")?.open;
  const hasActive = jobs.some(job => ["running", "pending", "paused"].includes(job.status));
  const failedCount = current.filter(job => job.status === "failed").length;
  const activeCount = current.length - failedCount;
  const summary = [activeCount ? `${activeCount} 项进行中` : "", failedCount ? `${failedCount} 项失败` : ""].filter(Boolean).join(" · ") || "没有进行中或失败的任务";
  box.classList.toggle("is-empty", !current.length);
  box.innerHTML = `<details class="sftp-task-drawer" ${(wasOpen || hasActive || failedCount) ? "open" : ""}><summary><span>${icon(hasActive ? "loader-circle" : failedCount ? "circle-alert" : "list-checks")}<strong>SFTP 任务</strong><small>${summary}</small></span><span class="sftp-task-summary-actions"><button type="button" onclick="event.preventDefault();event.stopPropagation();showSftpJobHistory()" ${history.length ? "" : "disabled"}>${icon("history")}<span>历史记录</span>${history.length ? `<small>${history.length}</small>` : ""}</button><span class="task-drawer-chevron">${icon("chevron-down")}</span></span></summary><div class="sftp-task-body">${current.length ? current.map(renderSftpJob).join("") : `<div class="sftp-task-empty">没有进行中或失败的任务</div>`}</div></details>`;
  if (jobs.some(job => job.status === "running")) startSftpJobsTimer();
  if ($("sftpJobHistoryList")) renderSftpJobHistoryModal();
  return jobs;
}

function renderSftpJob(job) {
  const done = job.status === "done";
  const running = job.status === "running";
  const paused = job.status === "paused";
  const pending = job.status === "pending";
  const cancelable = (running || paused || pending)
    && job.can_cancel !== false
    && !(job.type === "upload" && job.phase === "committing");
  const deletable = ["paused", "failed", "done", "cancelled"].includes(job.status);
  const resumable = Boolean(job.can_resume);
  const progressInfo = sftpJobProgress(job);
  const progress = progressInfo?.percent || 0;
  const speed = running ? Number(job.speed_bps || 0) : Number(job.average_bps || 0);
  const amount = job.progress_unit === "items" && job.size
    ? `已处理 ${Math.min(Number(job.size), Number(job.transferred || 0))} / ${Number(job.size)} 项`
    : job.size
      ? `${formatBytes(job.transferred || 0)} / ${formatBytes(job.size)}`
      : formatBytes(job.transferred || 0);
  const detail = [sftpJobStatus(job.status, job.phase), amount, speed ? `${formatBytes(speed)}/s${running ? "" : " 平均"}` : "", sftpJobProgressLabel(job, progressInfo)].filter(Boolean).join(" · ");
  const progressBar = ["running", "pending", "paused", "done", "failed"].includes(job.status) && progressInfo ? `<div class="progress" aria-label="${Math.round(progress)}%"><i style="width:${progress}%"></i></div>` : "";
  let downloadAction = "";
  if (done && job.type === "download" && job.delivery_status === "saved") {
    downloadAction = `<button class="primary" onclick="openSftpDownloadDirectory()">${icon("folder-open")}<span>打开目录</span></button>`;
  } else if (done && job.type === "download" && ["delivered", "expired", "cache_cleared"].includes(job.delivery_status)) {
    downloadAction = `<button onclick="downloadSftp(${Number(job.connection_id)},'${escAttr(job.remote_path || "")}')">${icon("download")}<span>再次下载</span></button>`;
  } else if (done && job.type === "download") {
    downloadAction = `<button class="primary" onclick="saveSftpJobFile('${escAttr(job.id)}')">${icon("download")}<span>保存到本机</span></button>`;
  }
  const resumeBtn = resumable && (job.type === "download" || job.type === "upload") ? `<button class="${job.status === "failed" ? "primary" : ""}" onclick="resumeSftpJob('${escAttr(job.id)}')">${job.status === "failed" ? "重试" : "继续"}</button>` : "";
  const pauseBtn = running && job.can_pause !== false && (job.type === "download" || job.type === "upload") ? `<button onclick="pauseSftpJob('${escAttr(job.id)}')">暂停</button>` : "";
  const cancelBtn = cancelable ? `<button onclick="cancelSftpJob('${escAttr(job.id)}')">取消</button>` : "";
  const deleteBtn = deletable ? `<button class="danger" onclick="deleteSftpJob('${escAttr(job.id)}')">删除</button>` : "";
  const finishedAt = job.finished_at ? `<time datetime="${escAttr(new Date(job.finished_at).toISOString())}">${esc(new Date(job.finished_at).toLocaleString())}</time>` : "";
  const deliveryText = job.saved_path ? `<span class="sftp-job-delivery">已保存到 ${esc(job.saved_path)}</span>` : "";
  const deliveryError = job.delivery_error ? `<div class="sftp-job-error"><strong>自动保存失败</strong><span>${esc(job.delivery_error).slice(0,500)}</span></div>` : "";
  return `<div class="sftp-job ${escAttr(job.status)}"><div><strong>${esc(job.label || job.type)}</strong><span>${esc(job.connection_name || "")} · ${esc(detail)}${finishedAt ? ` · ${finishedAt}` : ""}</span>${deliveryText}${progressBar}${deliveryError}${job.error ? `<div class="sftp-job-error"><strong>失败原因</strong><span>${esc(job.error).slice(0,500)}</span></div>` : ""}</div><div class="actions tight">${downloadAction}${resumeBtn}${pauseBtn}${cancelBtn}${deleteBtn}</div></div>`;
}

function closeSftpJobHistory() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
}

function renderSftpJobHistoryModal() {
  const modal = $("modal");
  if (!modal || !$("sftpJobHistoryList")) return;
  const history = sftpLatestJobs.filter(job => ["done", "cancelled"].includes(job.status));
  const list = $("sftpJobHistoryList");
  list.innerHTML = history.length ? history.map(renderSftpJob).join("") : `<div class="sftp-task-empty">暂无已完成或已取消的任务</div>`;
  const count = $("sftpJobHistoryCount");
  if (count) count.textContent = `${history.length} 条记录`;
  const clear = $("sftpJobHistoryClear");
  if (clear) clear.hidden = !history.length;
}

async function showSftpJobHistory() {
  if (!sftpLatestJobs.length) sftpLatestJobs = await api("/api/sftp/jobs").catch(() => []);
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card wide sftp-history-modal" role="dialog" aria-modal="true" aria-labelledby="sftpJobHistoryTitle"><div class="sftp-modal-head"><div><h2 id="sftpJobHistoryTitle">SFTP 任务历史</h2><span id="sftpJobHistoryCount"></span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeSftpJobHistory()">${icon("x")}</button></div><div id="sftpJobHistoryList" class="sftp-history-list"></div><div class="actions"><button id="sftpJobHistoryClear" class="danger" type="button" onclick="clearFinishedSftpJobs()">${icon("trash-2")}<span>清空历史</span></button><button type="button" onclick="closeSftpJobHistory()">关闭</button></div></div>`;
  modal.hidden = false;
  renderSftpJobHistoryModal();
}

function closeSftpRecycleBin() {
  const modal = $("modal");
  modal.hidden = true;
  modal.onclick = null;
  modal.innerHTML = "";
  sftpRecycleBinConnectionId = 0;
}

function sftpRecycleItemHtml(connectionId, item) {
  const deletedAt = item.deleted_at ? new Date(item.deleted_at).toLocaleString() : "时间未知";
  return `<div class="sftp-recycle-item"><span class="sftp-recycle-icon ${escAttr(item.type)}">${icon(item.type === "dir" ? "folder" : "file")}</span><div><strong title="${escAttr(item.original_path)}">${esc(item.name || item.original_path)}</strong><span>${esc(item.original_path)}</span><small>删除于 ${esc(deletedAt)}</small></div><div class="actions tight"><button type="button" onclick="restoreSftpRecycleItem(${connectionId},'${escAttr(item.id)}')">${icon("undo-2")}<span>恢复</span></button><button class="danger" type="button" onclick="deleteSftpRecycleItem(${connectionId},'${escAttr(item.id)}','${escAttr(item.name || item.original_path)}')">${icon("trash-2")}<span>永久删除</span></button></div></div>`;
}

async function openSftpRecycleBin() {
  const tab = tabs.find(item => item.key === activeTabKey);
  const connectionId = Number(tab?.id || sftpState.connectionId);
  if (!connectionId) return;
  sftpRecycleBinConnectionId = connectionId;
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card wide sftp-recycle-modal" role="dialog" aria-modal="true" aria-labelledby="sftpRecycleTitle"><div class="sftp-modal-head"><div><h2 id="sftpRecycleTitle">SFTP 回收站</h2><span id="sftpRecycleSummary">正在读取远端回收站</span></div><button class="icon-button" type="button" title="关闭" aria-label="关闭" onclick="closeSftpRecycleBin()">${icon("x")}</button></div><div id="sftpRecycleList" class="sftp-recycle-list">${stateView("loading", "正在读取回收站")}</div><div class="actions"><button id="sftpRecycleClear" class="danger" type="button" hidden onclick="clearSftpRecycleBin(${connectionId})">${icon("trash-2")}<span>清空回收站</span></button><button type="button" onclick="closeSftpRecycleBin()">关闭</button></div></div>`;
  modal.hidden = false;
  try {
    const data = await api(`/api/connections/${connectionId}/sftp/trash`);
    if (sftpRecycleBinConnectionId !== connectionId || !$("sftpRecycleList")) return;
    const items = data.items || [];
    $("sftpRecycleSummary").textContent = `${data.enabled ? "已开启" : "当前关闭"} · ${items.length} 个项目`;
    $("sftpRecycleList").innerHTML = items.length
      ? items.map(item => sftpRecycleItemHtml(connectionId, item)).join("")
      : stateView("empty", "回收站为空", data.enabled ? "删除的远程项目会保存在这里。" : "可在 SFTP 页面右上角的全局设置中开启回收站。");
    $("sftpRecycleClear").hidden = !items.length;
  } catch (error) {
    if ($("sftpRecycleList")) $("sftpRecycleList").innerHTML = stateView("error", "回收站读取失败", error.message, `<button onclick="openSftpRecycleBin()">重试</button>`);
  }
}

async function restoreSftpRecycleItem(connectionId, id) {
  try {
    const result = await api(`/api/connections/${connectionId}/sftp/trash/restore`, {method:"POST", body:JSON.stringify({id})});
    notify(`已恢复：${result.original_path || "远程项目"}`, "success");
    sftpPendingDirectoryRefreshes.add(Number(connectionId));
    flushPendingSftpDirectoryRefresh();
  } catch (error) {
    notify(error.message || "恢复失败", "error");
  }
  openSftpRecycleBin();
}

async function deleteSftpRecycleItem(connectionId, id, name) {
  if (!await confirmModal(`永久删除回收站中的项目且无法恢复？\n${name}`, "永久删除", "永久删除", "取消", true)) return openSftpRecycleBin();
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/delete`, {method:"POST", body:JSON.stringify({id})});
    notify("回收站项目已永久删除", "success");
  } catch (error) {
    notify(error.message || "永久删除失败", "error");
  }
  openSftpRecycleBin();
}

async function clearSftpRecycleBin(connectionId) {
  if (!await confirmModal("永久删除当前服务器回收站内的全部项目？此操作无法撤销。", "清空 SFTP 回收站", "全部永久删除", "取消", true)) return openSftpRecycleBin();
  try {
    await api(`/api/connections/${connectionId}/sftp/trash/clear`, {method:"POST", body:"{}"});
    notify("SFTP 回收站已清空", "success");
  } catch (error) {
    notify(error.message || "清空回收站失败", "error");
  }
  openSftpRecycleBin();
}

function sftpJobStatus(status, phase="") {
  if (status === "running" && phase === "receiving") return "正在准备上传";
  if (status === "running" && phase === "uploading") return "正在上传到远端";
  if (status === "running" && phase === "committing") return "正在完成";
  if (status === "running" && phase === "system-saving") return "正在保存到本机";
  if (status === "running" && phase === "cancelling") return "正在停止";
  if (status === "pending" && phase === "resuming") return "正在继续";
  return {pending:"准备中", running:"执行中", done:"完成", failed:"失败", cancelled:"已取消", paused:"已暂停"}[status] || status;
}

async function cancelSftpJob(id) {
  const key = String(id || "");
  const upload = sftpUploadRequests.get(key);
  if (upload) upload.cancelled = true;
  try {
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/cancel`, {method:"POST"});
    if (result?.ok === false) notify(result.message || "停止请求未被接受，任务仍在继续", "info");
  } finally {
    try { upload?.xhr?.abort(); } catch {}
  }
  await refreshSftpJobs();
}

async function pauseSftpJob(id) {
  await api(`/api/sftp/jobs/${encodeURIComponent(id)}/pause`, {method:"POST"});
  refreshSftpJobs();
}

async function resumeSftpJob(id) {
  try {
    const result = await api(`/api/sftp/jobs/${encodeURIComponent(id)}/resume`, {method:"POST"});
    if (result && result.error) return notify(result.error, "error");
    notify("SFTP 任务已重新开始", "success");
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "重试任务失败", "error");
  }
}

async function deleteSftpJob(id) {
  if (!await confirmModal("删除该任务记录？","删除 SFTP 任务","删除","取消", true)) return;
  await api(`/api/sftp/jobs/${encodeURIComponent(id)}`, {method:"DELETE"});
  await refreshSftpJobs();
}

function saveSftpJobFile(id) {
  const a = document.createElement("a");
  a.href = `/api/sftp/jobs/${encodeURIComponent(id)}/fetch`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
  setTimeout(() => refreshSftpJobs(), 1500);
}

async function extractSingleSftp(id, path) {
  const job = await api(`/api/connections/${id}/sftp/extract`, {method:"POST", body:JSON.stringify({path, target:sftpState.path || ".", background:true})});
  trackSftpMutationJob(job);
  refreshSftpJobs();
}

async function compressSingleSftp(id, path) {
  const name = await inputModal("压缩远程项目", "压缩包名称（自动使用 tar.gz）", `${sftpPathName(path)}.tar.gz`);
  if (!name) return;
  try {
    const job = await api(`/api/connections/${id}/sftp/compress`, {method:"POST", body:JSON.stringify({paths:[path], target:sftpState.path || ".", filename:name})});
    trackSftpMutationJob(job);
    refreshSftpJobs();
  } catch (error) {
    notify(error.message || "压缩任务创建失败", "error");
  }
}

function openSftpActionSheet() {
  const actions = [
    { label: "复制选中", value: "copy" },
    { label: "移动选中", value: "move" },
    ...(sftpClipboardMatchesConnection() ? [{ label: "粘贴到当前目录", value: "paste" }] : []),
    ...(sftpClipboard?.paths?.length ? [{ label: "取消复制/移动队列", value: "cancelClipboard" }] : []),
    { label: "下载选中", value: "download" },
    { label: "压缩选中", value: "compress" },
    { label: "设置权限", value: "permissions" },
    { label: "解压选中压缩包", value: "extract" },
    { label: "删除选中", value: "delete", className: "danger" },
    { label: "取消", value: "" }
  ];
  chooseModal("SFTP 操作", "选择要执行的文件操作。", actions).then(value => {
    if (value === "copy" || value === "move") copySftpSelection(value);
    if (value === "paste") pasteSftpClipboard();
    if (value === "cancelClipboard") cancelSftpClipboard();
    if (value === "download") downloadSftpSelection();
    if (value === "compress") compressSftpSelection();
    if (value === "permissions") openSftpPermissionsForSelection();
    if (value === "extract") extractSftpSelection();
    if (value === "delete") deleteSftpSelection();
  });
}

async function clearFinishedSftpJobs() {
  if (!await confirmModal("清空全部已完成和已取消的 SFTP 任务记录？失败记录会保留。", "清空任务历史", "清空历史", "取消", true)) return;
  const result = await api("/api/sftp/jobs/clear-finished", {method:"POST"});
  notify(`已清理 ${result.removed || 0} 条 SFTP 历史任务`, "success");
  await refreshSftpJobs();
}

async function getSftpDownloadSettings() {
  return api("/api/sftp/download-settings").catch(() => ({delivery_mode:"browser"}));
}

async function confirmSftpDownloadNotice(downloadSettings) {
  const desktop = downloadSettings?.delivery_mode === "desktop";
  const noticeKey = desktop ? "sftpDesktopDownloadNoticeV1" : "sftpBrowserDownloadNoticeV1";
  if (localStorage.getItem(noticeKey) === "1") return true;
  if (sftpDownloadNoticeRequests.has(noticeKey)) return sftpDownloadNoticeRequests.get(noticeKey);
  const request = (async () => {
    const message = desktop
      ? `下载完成后会自动保存到：\n${downloadSettings.effective_directory || "系统下载目录"}\n\n之后可在 SFTP 全局设置中修改。`
      : `下载完成后会由浏览器保存到当前${isMobileLayout() ? "手机" : "设备"}的下载目录。\n\n浏览器可能会询问保存位置或拦截多个文件下载。`;
    const accepted = await confirmModal(message, "首次下载提示", "继续下载", "取消");
    if (accepted) localStorage.setItem(noticeKey, "1");
    return accepted;
  })();
  sftpDownloadNoticeRequests.set(noticeKey, request);
  try {
    return await request;
  } finally {
    sftpDownloadNoticeRequests.delete(noticeKey);
  }
}

function trackSftpBrowserDownload(result) {
  if (result?.delivery_mode === "browser" && result.id) sftpPendingBrowserDownloads.add(result.id);
  return result;
}

function queueSftpDownload(id, path, type="file") {
  if (type === "dir") {
    return api(`/api/connections/${id}/sftp/download-batch`, {
      method:"POST",
      body:JSON.stringify({paths:[path], mode:"archive"})
    }).then(trackSftpBrowserDownload);
  }
  return api(`/api/connections/${id}/sftp/download`, {
    method:"POST",
    body:JSON.stringify({path})
  }).then(trackSftpBrowserDownload);
}

async function downloadSftp(id, path, type="file") {
  try {
    const downloadSettings = await getSftpDownloadSettings();
    if (!await confirmSftpDownloadNotice(downloadSettings)) return false;
    await queueSftpDownload(id, path, type);
    await refreshSftpJobs();
    startSftpJobsTimer();
    return true;
  } catch (error) {
    notify(error.message || "下载失败", "error");
    return false;
  }
}

function downloadWithProgress(url, onProgress, fallbackName="download") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)), event.loaded);
      else onProgress(-1, event.loaded || 0);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const reader = new FileReader();
        reader.onload = () => {
          try { reject(new Error(JSON.parse(String(reader.result || "")).error || xhr.statusText || "下载失败")); }
          catch { reject(new Error(xhr.statusText || "下载失败")); }
        };
        reader.onerror = () => reject(new Error(xhr.statusText || "下载失败"));
        reader.readAsText(xhr.response);
        return;
      }
      const link = document.createElement("a");
      const disposition = xhr.getResponseHeader("Content-Disposition") || "";
      const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
      link.download = match ? decodeURIComponent(match[1]) : fallbackName;
      link.href = URL.createObjectURL(xhr.response);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 1000);
      resolve();
    };
    xhr.onerror = () => reject(new Error("下载连接失败：可能是 TunnelDesk 服务重启或网络中断。"));
    xhr.send();
  });
}

function normalizeDroppedRelativePath(value, fallback="upload") {
  const parts = String(value || fallback).replace(/\\/g, "/").split("/")
    .map(part => part.trim()).filter(part => part && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

async function downloadSftpSelection() {
  const tab = tabs.find(item => item.key === activeTabKey && item.kind === "sftp");
  const entries = selectedSftpEntries();
  if (!tab || !entries.length) return notify("请选择要下载的文件或目录", "info");
  try {
    const settings = await getSftpDownloadSettings();
    const browser = settings.delivery_mode !== "desktop";
    const mode = await chooseModal("批量下载", browser
      ? `已选择 ${entries.length} 项。分别下载会逐项交给当前设备；其中目录会各自打包为 tar.gz。`
      : `已选择 ${entries.length} 项。分别下载会保留文件夹结构，打包下载会生成 tar.gz 文件。`, [
      {label:"分别下载", value:"separate", className:"primary"},
      {label:"打包下载", value:"archive"},
      {label:"取消", value:""}
    ]);
    if (!mode || !await confirmSftpDownloadNotice(settings)) return;
    notify(mode === "separate" ? "正在下载选中项目…" : "正在创建下载压缩包…", "info");
    if (mode === "separate" && browser) {
      for (const entry of entries) await queueSftpDownload(tab.id, entry.path, entry.type);
    } else {
      const result = await api(`/api/connections/${tab.id}/sftp/download-batch`, {
        method:"POST",
        body:JSON.stringify({paths:entries.map(item => item.path), mode})
      });
      trackSftpBrowserDownload(result);
      if (mode === "separate") notify(`已保存 ${result.files?.length || entries.length} 项到下载目录`, "success");
    }
    clearSftpSelection();
    await refreshSftpJobs();
    startSftpJobsTimer();
  } catch (error) {
    notify(error.message || "批量下载失败", "error");
  }
}

function readDroppedFileEntry(entry, prefix="") {
  return new Promise((resolve, reject) => {
    entry.file(file => resolve([{file, relativePath:normalizeDroppedRelativePath(`${prefix}${file.name}`, file.name)}]), reject);
  });
}

async function readDroppedDirectoryEntry(entry, prefix="") {
  const directoryPrefix = `${prefix}${entry.name}/`;
  const reader = entry.createReader();
  const entries = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const nested = [];
  for (const child of entries) nested.push(...await readDroppedEntry(child, directoryPrefix));
  return nested;
}

function readDroppedEntry(entry, prefix="") {
  if (entry?.isFile) return readDroppedFileEntry(entry, prefix);
  if (entry?.isDirectory) return readDroppedDirectoryEntry(entry, prefix);
  return Promise.resolve([]);
}

async function collectDroppedFiles(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) {
    const files = [];
    for (const entry of entries) files.push(...await readDroppedEntry(entry));
    return files;
  }
  return [...(dataTransfer?.files || [])].map(file => ({file, relativePath:normalizeDroppedRelativePath(file.webkitRelativePath || file.name, file.name)}));
}

function setSftpExternalDropState(active, options={}) {
  if (active) cancelSftpDropLeaveClear();
  const shell = document.querySelector(".sftp-shell");
  const overlay = $("sftpDropOverlay");
  shell?.classList.toggle("is-drag-over", Boolean(active));
  if (!overlay) return;
  overlay.hidden = !active;
  if (!active) {
    overlay.removeAttribute("style");
    overlay.dataset.mode = "upload";
    if (!options.keepHint) $("sftpDragHint")?.remove();
    return;
  }
  const crossHost = sftpOwnDragActive();
  overlay.dataset.mode = crossHost ? "copy" : "upload";
  const path = options.path || sftpState.path || ".";
  const message = crossHost
    ? options.title || `松开复制到 ${path}`
    : options.title || `松开上传到 ${path}`;
  showSftpDragHint(message, true, crossHost ? "copy" : "upload");
  const visibleHost = $("sftpList") || shell;
  const rect = visibleHost?.getBoundingClientRect?.();
  if (!rect) return;
  const stickyTopRect = shell?.querySelector?.(".sftp-top")?.getBoundingClientRect?.();
  const unobscuredTop = Math.max(0, Number(stickyTopRect?.bottom || 0) + 4);
  const left = Math.max(0, rect.left);
  const top = Math.max(unobscuredTop, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) {
    overlay.hidden = true;
    return;
  }
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${Math.max(0, right - left)}px`;
  overlay.style.height = `${Math.max(0, bottom - top)}px`;
}

function cancelSftpDropLeaveClear() {
  if (!sftpDropLeaveTimer) return;
  clearTimeout(sftpDropLeaveTimer);
  sftpDropLeaveTimer = 0;
}

function scheduleSftpDropLeaveClear(options={}) {
  cancelSftpDropLeaveClear();
  sftpDropLeaveTimer = setTimeout(() => {
    sftpDropLeaveTimer = 0;
    if (sftpDropDepth > 0) return;
    setSftpExternalDropState(false, options);
  }, SFTP_DROP_LEAVE_GRACE_MS);
}

function sftpDragTransitionStaysInside(event) {
  const shell = event?.currentTarget;
  const related = event?.relatedTarget;
  if (!shell?.contains || !related) return false;
  try {
    return shell.contains(related);
  } catch {
    return false;
  }
}

function restoreSftpDropFeedbackAfterRender(tabKey) {
  const drag = activeSftpDragPayload();
  const target = activeSftpCrossDropTarget(drag);
  if (!drag || !target || target.key !== tabKey) return;
  const directory = Number(sftpState.connectionId) === Number(target.id) ? sftpState.path : target.path || ".";
  setSftpExternalDropState(true, {title:`松开复制到 ${target.title}`, path:directory});
}

function sftpDataTransferHasFiles(dataTransfer) {
  const types = sftpDataTransferTypes(dataTransfer);
  if (types.includes("files")) return true;
  if (Number(dataTransfer?.files?.length || 0) > 0) return true;
  if (Array.from(dataTransfer?.items || []).some(item => item.kind === "file")) return true;
  const desktopPlatform = String(window.tunnelDeskDesktop?.capabilities?.platform || "");
  return Boolean(desktopPlatform && types.includes("text/uri-list"));
}

function sftpOwnDragActive(dataTransfer=null) {
  const internalActive = Boolean(
    sftpInternalDrag
    && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))
  );
  const handoffActive = Boolean(
    currentSftpInternalDragHandoff()
    && (!dataTransfer || sftpDataTransferHasInternalPayload(dataTransfer))
  );
  const nativeActive = [...sftpNativeDragRequests.values()].some(request => sftpNativeDragRequestIsActive(request));
  return internalActive || handoffActive || nativeActive;
}

function clearStaleSftpInternalDragForExternalDrop(dataTransfer) {
  if (sftpDataTransferHasInternalPayload(dataTransfer) || !sftpDataTransferHasFiles(dataTransfer)) return;
  clearSftpInternalDragHandoff();
  if (!sftpInternalDrag) return;
  if ([...sftpNativeDragRequests.values()].some(request => sftpNativeDragRequestIsActive(request))) return;
  resetSftpItemDrag(sftpInternalDrag.row);
}

function suppressSftpOwnDrop(event) {
  if (!sftpOwnDragActive(event?.dataTransfer)) return false;
  cancelSftpDropLeaveClear();
  event.preventDefault();
  event.stopPropagation?.();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  sftpDropDepth = 0;
  setSftpExternalDropState(false);
  return true;
}

function handleSftpOwnDragOver(event, enter=false) {
  const drag = activeSftpDragPayload(event?.dataTransfer);
  if (!drag) return false;
  markSftpDragInsideWindow();
  event.preventDefault();
  event.stopPropagation?.();
  const target = activeSftpCrossDropTarget(drag);
  if (event.dataTransfer) event.dataTransfer.dropEffect = target ? "copy" : "none";
  if (target) {
    if (enter) sftpDropDepth += 1;
    const directory = Number(sftpState.connectionId) === Number(target.id) ? sftpState.path : target.path || ".";
    setSftpExternalDropState(true, {title:`松开复制到 ${target.title}`, path:directory});
  } else {
    sftpDropDepth = 0;
    setSftpExternalDropState(false, {keepHint:true});
    showSftpDragHint(sftpDragSourceHint());
  }
  return true;
}

function handleSftpDragEnter(event) {
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  const insideTransition = sftpDragTransitionStaysInside(event);
  if (handleSftpOwnDragOver(event, !insideTransition)) return;
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event);
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  if (!insideTransition) sftpDropDepth += 1;
  setSftpExternalDropState(true);
}

function handleSftpDragOver(event) {
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  if (handleSftpOwnDragOver(event)) return;
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event);
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setSftpExternalDropState(true);
}

function handleSftpDragLeave(event) {
  if (sftpDragTransitionStaysInside(event)) return;
  if (activeSftpDragPayload(event.dataTransfer)) {
    sftpDropDepth = Math.max(0, sftpDropDepth - 1);
    if (!sftpDropDepth) scheduleSftpDropLeaveClear({keepHint:true});
    return;
  }
  if (sftpOwnDragActive(event.dataTransfer)) return suppressSftpOwnDrop(event);
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  sftpDropDepth = Math.max(0, sftpDropDepth - 1);
  if (!sftpDropDepth) scheduleSftpDropLeaveClear();
}

async function handleSftpDrop(event) {
  clearStaleSftpInternalDragForExternalDrop(event.dataTransfer);
  const drag = activeSftpDragPayload(event.dataTransfer);
  if (drag) {
    event.preventDefault();
    event.stopPropagation?.();
    const target = activeSftpCrossDropTarget(drag);
    cancelSftpDropLeaveClear();
    sftpDropDepth = 0;
    setSftpExternalDropState(false);
    if (target) await copySftpDraggedItemsToTarget(drag, target);
    else finishSftpDragPayload(drag);
    return;
  }
  if (suppressSftpOwnDrop(event)) return;
  if (!sftpDataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  cancelSftpDropLeaveClear();
  sftpDropDepth = 0;
  setSftpExternalDropState(false);
  try {
    const files = await collectDroppedFiles(event.dataTransfer);
    if (!files.length) throw new Error("没有找到可上传的文件");
    await uploadSftpFiles(files);
  } catch (error) {
    notify(error.message || "读取拖入文件失败", "error");
  }
}

async function createRemoteUploadDirectories(connectionId, root, files) {
  const directories = new Set();
  for (const item of files) {
    const parts = normalizeDroppedRelativePath(item.relativePath, item.file.name).split("/");
    parts.pop();
    let current = String(root || ".");
    for (const part of parts) {
      current = joinRemotePath(current, part);
      directories.add(current);
    }
  }
  for (const directory of directories) {
    await api(`/api/connections/${connectionId}/sftp/mkdir`, {method:"POST", body:JSON.stringify({path:directory})}).catch(error => {
      if (!/exist|存在/i.test(String(error?.message || ""))) throw error;
    });
  }
}

async function chooseSftpUploadConflict(collisions) {
  if (!collisions.length) return "error";
  const preview = collisions.slice(0, 6).map(item => item.filename).join("\n");
  const extra = collisions.length > 6 ? `\n等 ${collisions.length} 个同名项` : "";
  return chooseModal("发现同名文件", `${preview}${extra}\n\n请选择本次上传的处理方式。`, [
    {label:"覆盖同名文件", value:"overwrite", className:"danger"},
    {label:"自动改名", value:"rename"},
    {label:"取消上传", value:""}
  ]);
}

async function uploadSftpFiles(inputFiles) {
  const tab = tabs.find(item => item.key === activeTabKey && item.kind === "sftp");
  if (!tab) return;
  const files = inputFiles.map(item => item?.file ? item : ({file:item, relativePath:item?.webkitRelativePath || item?.name}))
    .filter(item => item.file).map(item => ({...item, relativePath:normalizeDroppedRelativePath(item.relativePath, item.file.name)}));
  if (!files.length) return;
  const root = sftpState.path || ".";
  await createRemoteUploadDirectories(tab.id, root, files);
  const groups = new Map();
  for (const item of files) {
    const parts = item.relativePath.split("/");
    const filename = parts.pop() || item.file.name;
    const directory = parts.length ? joinRemotePath(root, parts.join("/")) : root;
    if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory).push({...item, filename, directory});
  }
  const collisions = [];
  for (const [directory, items] of groups) {
    for (let offset = 0; offset < items.length; offset += 200) {
      const plan = await api(`/api/connections/${tab.id}/sftp/upload-plan`, {
        method:"POST",
        body:JSON.stringify({path:directory, filenames:items.slice(offset, offset + 200).map(item => item.filename)})
      });
      for (const item of plan.items || []) if (item.exists) collisions.push(item);
    }
  }
  const conflict = await chooseSftpUploadConflict(collisions);
  if (collisions.length && !conflict) return;
  try {
    for (const item of files) {
      const parts = item.relativePath.split("/");
      const filename = parts.pop() || item.file.name;
      const directory = parts.length ? joinRemotePath(root, parts.join("/")) : root;
      const started = await api(`/api/connections/${tab.id}/sftp/upload-job`, {
        method:"POST",
        body:JSON.stringify({path:directory, filename, conflict:conflict || "error", size:Number(item.file.size || 0)})
      });
      trackSftpMutationJob(started);
      await refreshSftpJobs();
      startSftpJobsTimer();
      try {
        const job = await uploadWithProgress(`/api/sftp/jobs/${encodeURIComponent(started.id)}/content`, item.file, started);
        trackSftpMutationJob(job);
      } catch (error) {
        const latest = await refreshSftpJobs();
        const state = latest.find(job => String(job.id) === String(started.id));
        if (error?.cancelled || state?.status === "cancelled") continue;
        throw error;
      }
    }
  } finally {
    const input = $("sftpUpload");
    if (input) input.value = "";
    refreshSftpJobs();
  }
}

async function uploadSftpFile() {
  const input = $("sftpUpload");
  const files = [...(input?.files || [])].map(file => ({file, relativePath:file.webkitRelativePath || file.name}));
  if (!files.length) return;
  try {
    await uploadSftpFiles(files);
  } catch (error) {
    notify(error.message || "上传失败", "error");
  }
}

function uploadCancelledError() {
  const error = new Error("上传已取消");
  error.cancelled = true;
  return error;
}

function updateUploadReceiveProgress(job, loaded, total) {
  const id = String(job?.id || "");
  if (!id) return;
  const existing = sftpLatestJobs.find(item => String(item.id) === id);
  if (!existing || existing.status !== "running" || existing.phase !== "receiving") return;
  existing.size = Math.max(0, Number(total || existing.size || 0));
  existing.transferred = Math.max(0, Number(loaded || 0));
  existing.received_bytes = existing.transferred;
  existing.size_known = true;
  existing.progress_known = true;
  existing.two_stage_upload = true;
  existing.progress = existing.size ? Math.min(50, Math.round(existing.transferred / existing.size * 50)) : 50;
  updateSftpTaskFloat(sftpLatestJobs);
}

function uploadWithProgress(url, body, job) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const id = String(job?.id || "");
    const request = {xhr, cancelled:false};
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (sftpUploadRequests.get(id) === request) sftpUploadRequests.delete(id);
      callback();
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    sftpUploadRequests.set(id, request);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) updateUploadReceiveProgress(job, event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return finish(() => resolve(JSON.parse(xhr.responseText || "{}")));
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (data.status === "cancelled") return finish(() => reject(uploadCancelledError()));
        finish(() => reject(new Error(data.error || xhr.statusText || "上传失败")));
      } catch {
        finish(() => reject(new Error(xhr.responseText || xhr.statusText || "上传失败")));
      }
    };
    xhr.onerror = () => finish(() => reject(request.cancelled ? uploadCancelledError() : new Error("上传连接失败：可能是 TunnelDesk 服务重启或网络中断。")));
    xhr.onabort = () => finish(() => reject(uploadCancelledError()));
    xhr.ontimeout = () => finish(() => reject(new Error("上传连接超时")));
    xhr.send(body);
  });
}

function formatBytes(size) {
  const n = Number(size || 0);
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function hideSftpContextMenu() {
  $("sftpContextMenu")?.remove();
}

function showSftpEntryMenu(event, id, path, name, type) {
  const isDir = type === "dir";
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const menuEvent = {
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    clientX: event.clientX || rect?.right || 8,
    clientY: event.clientY || rect?.bottom || 8
  };
  showActionMenu(menuEvent, [
    isDir
      ? {label:"打开", icon:"folder-open", run:()=>openSftp(id, path)}
      : isSftpImageName(name)
        ? {label:"预览图片", icon:"image", run:()=>previewSftpImage(id, path)}
        : {label:"以文本打开", icon:"file-text", run:()=>previewSftpText(id, path)},
    {label:"下载", icon:"download", run:()=>downloadSftp(id, path, isDir ? "dir" : "file")},
    ...(!isDir && isArchiveName(name) ? [{label:"解压", icon:"archive-restore", run:()=>extractSingleSftp(id, path)}] : []),
    {label:"压缩", icon:"archive", run:()=>compressSingleSftp(id, path)},
    {separator:true},
    {label:"复制路径", icon:"clipboard", run:()=>copyText(path)},
    {label:"复制", icon:"copy", run:()=>copySingleSftp(path, "copy")},
    {label:"移动", icon:"folder-input", run:()=>copySingleSftp(path, "move")},
    {label:"重命名", icon:"pencil", run:()=>renameSftp(id, path, name)},
    {label:"设置权限", icon:"key-round", run:()=>openSftpPermissionsForSelection([path])},
    {separator:true},
    {label:"新建文件", icon:"file-plus-2", run:()=>createSftpFile()},
    {label:"新建文件夹", icon:"folder-plus", run:()=>mkdirSftp()},
    {separator:true},
    {label:"删除", icon:"trash-2", danger:true, run:()=>deleteSftp(id, path)}
  ]);
}

function showSftpDirectoryMenu(event) {
  if (event.target?.closest?.(".sftp-row, .sftp-head, .pager, button, input, select")) return;
  event.preventDefault();
  event.stopPropagation();
  showActionMenu(event, [
    {label:"新建文件", icon:"file-plus-2", run:()=>createSftpFile()},
    {label:"新建文件夹", icon:"folder-plus", run:()=>mkdirSftp()},
    {label:"上传文件或文件夹", icon:"upload", run:()=>document.getElementById("sftpUpload")?.click()},
    ...(sftpClipboard ? [{label:sftpClipboard.mode === "move" ? "移动到此处" : "粘贴到此处", icon:"clipboard-paste", run:()=>pasteSftpClipboard()}] : []),
    {separator:true},
    {label:"刷新", icon:"refresh-cw", run:()=>refreshSftp({refresh:true})}
  ]);
}
