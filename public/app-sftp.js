function duplicateSftpTab(sourceTabKey) {
  const sourceKey = String(sourceTabKey || "");
  const sourceTab = tabs.find(tab => tab.key === sourceKey && tab.kind === "sftp");
  const sourceRuntime = sftpTabRuntimes.get(sourceKey);
  if (!sourceTab) return false;
  return openSftp(
    sourceTab.id,
    sourceRuntime?.state.path || sourceTab.path || ".",
    true,
    nextSftpTabKey(sourceTab.id)
  );
}

async function openSftp(id, remotePath=".", updateTab=true, existingKey="", options={}) {
  if (existingKey && typeof existingKey === "object") {
    options = existingKey;
    existingKey = "";
  }
  const paneId = String(options.paneId || (typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : focusedPaneId || ""));
  // Each tab owns its own runtime/request controller.  Opening another tab
  // must not invalidate the previous tab's directory request; inactive tabs
  // continue loading into their detached view and render when activated.
  options = {...options, paneId};
  const connectionId = Number(id);
  const quickConnection = currentConnection(connectionId)?.quick_connection === true;
  if (!quickConnection && updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(connectionId, "sftp");
  const fallbackExistingKey = !updateTab && tabs.find(tab => tab.key === activeTabKey)?.kind === "sftp"
    ? activeTabKey
    : "";
  const tabKey = String(existingKey || fallbackExistingKey || nextSftpTabKey(connectionId));
  const destinationPane = typeof workspaceFindPaneForTab === "function"
    ? workspaceFindPaneForTab(tabKey) || workspaceFindPaneForTab(activeTabKey) || workspaceFindPane(focusedPaneId)
    : null;
  const destinationView = destinationPane && typeof workspacePaneElement === "function"
    ? workspacePaneElement(destinationPane.id)?.querySelector("#view-sftp")
    : null;
  const view = (typeof workspaceElementForTab === "function" ? workspaceElementForTab(tabKey, "#view-sftp") : null)
    || destinationView
    || $("view-sftp");
  if (!view) return false;
  const runtime = restoreSftpRuntimeForTab(tabKey, {connectionId, path:remotePath, activate:updateTab || tabKey === activeTabKey});
  let mountedTabKey = String(view.dataset.sftpTabKey || "");
  if (mountedTabKey && mountedTabKey !== tabKey) {
    const mountedRuntime = sftpTabRuntimes.get(mountedTabKey);
    if (mountedRuntime) {
      rememberSftpViewState(mountedTabKey);
      const mountedToolbar = mountedRuntime.toolbar
        || document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(mountedTabKey)}"]`);
      const mountedToolbarHome = view.querySelector("#sftpToolbarMount");
      if (mountedToolbar && mountedToolbarHome && !mountedToolbarHome.contains(mountedToolbar)) mountedToolbarHome.appendChild(mountedToolbar);
      mountedRuntime.resizeObserver?.disconnect?.();
      if (mountedRuntime.resizeFrame) cancelAnimationFrame(mountedRuntime.resizeFrame);
      mountedRuntime.resizeObserver = null;
      mountedRuntime.resizeFrame = 0;
      mountedRuntime.root = null;
      mountedRuntime.toolbar = mountedToolbar || null;
      const detachedView = document.createElement("div");
      while (view.firstChild) detachedView.appendChild(view.firstChild);
      mountedRuntime.detachedView = detachedView;
    } else view.replaceChildren();
  }
  if (runtime.detachedView?.childNodes?.length) {
    while (runtime.detachedView.firstChild) view.appendChild(runtime.detachedView.firstChild);
    runtime.detachedView = null;
    view.dataset.workspaceTabKey = tabKey;
    view.dataset.sftpTabKey = tabKey;
    mountedTabKey = tabKey;
    watchSftpListLayout(view.querySelector("#sftpList"), tabKey);
  }
  const mountedShell = view.querySelector(":scope > .sftp-shell");
  const preserveManualDisconnect = sftpTabKeysForConnection(connectionId).some(key => sftpDisconnectedTabs.has(key));
  const c = selectConnection(id, {render:false});
  if (!c) return;
  clearTimeout(runtime.searchTimer);
  runtime.searchTimer = null;
  const directoryCached = getCachedSftpDirectoryView(id, remotePath);
  const tabCached = updateTab ? null : sftpViewStates.get(tabKey);
  const cached = directoryCached || tabCached;
  const mountedToolbar = view.querySelector("#sftpToolbarMount > .sftp-toolbar")
    || document.querySelector(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(tabKey)}"]`);
  const mounted = mountedTabKey === tabKey
    && mountedShell?.dataset.sftpTabKey === tabKey
    && mountedToolbar?.dataset.workspaceTabKey === tabKey
    && Number(runtime.state.connectionId) === connectionId
    && (
      normalizeSftpDirectoryCachePath(runtime.state.path) === normalizeSftpDirectoryCachePath(remotePath)
      || normalizeSftpDirectoryCachePath(directoryCached?.state?.path) === normalizeSftpDirectoryCachePath(runtime.state.path)
    );
  rememberSftpTabIndex(tabKey, connectionId);
  const tabIndex = sftpDisplayTabIndex(tabKey, connectionId);
  const title = `${c.name} · SFTP${tabIndex > 1 ? ` #${tabIndex}` : ""}`;
  if (mounted) {
    runtime.root = view;
    setWorkspace(title, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:runtime.state.path, connectionStatus:preserveManualDisconnect && !updateTab ? "disconnected" : "connecting", transient:quickConnection, quick_connection:quickConnection, skipToolbarSync:true});
    if (cached?.viewState) restoreSftpViewState(cached.viewState, tabKey);
    // A tab can finish its directory request while detached from the shared
    // SFTP view.  Reattaching it must repaint the completed runtime even when
    // the activation path did not pass the optional fast flag (the legacy
    // workspace activator does not provide that option).
    if (!runtime.state.loading && Array.isArray(runtime.state.entries)) {
      const breadcrumb = sftpElement("sftpBreadcrumb", tabKey);
      const pathInput = sftpElement("sftpPathInput", tabKey);
      if (breadcrumb) breadcrumb.innerHTML = sftpBreadcrumbHtml(id, runtime.state.path || remotePath, tabKey);
      if (pathInput) pathInput.value = runtime.state.path || remotePath;
      refreshSftpDirectoryActions(tabKey);
      flushPendingSftpDirectoryRefresh(tabKey);
      const list = sftpElement("sftpList", tabKey);
      if (Number(runtime.renderedRequestSeq ?? -1) !== Number(runtime.state.requestSeq || 0) || !list?.querySelector(".sftp-head")) {
        renderSftpEntries(tabKey);
      }
    }
    if (options.fast) {
      if (preserveManualDisconnect && !updateTab) updateSftpConnectionUi(id, "disconnected");
      syncSftpToolbarPlacement(tabKey);
      refreshSftpDirectoryActions(tabKey);
      refreshSftpJobsIfStale();
      startSftpJobsTimer();
      if (preserveManualDisconnect && !updateTab) return true;
      requestAnimationFrame(() => void refreshActiveSftpSessionStatus(tabKey));
      return true;
    }
    syncSftpToolbarPlacement(tabKey);
    refreshSftpDirectoryActions(tabKey);
    const refreshBackgroundSftpUi = () => {
      refreshSftpJobsIfStale();
      startSftpJobsTimer();
    };
    if (updateTab) refreshBackgroundSftpUi();
    else requestAnimationFrame(refreshBackgroundSftpUi);
    if (preserveManualDisconnect && !updateTab) {
      updateSftpConnectionUi(id, "disconnected");
      return true;
    }
    if (updateTab) {
      return loadSftpPage({
        path:runtime.state.path,
        page:runtime.state.page,
        tabKey,
        silent:true,
        renderIfChangedOnly:true,
        paneId:options.paneId,
        activationToken:options.activationToken
      });
    }
    if (updateTab) void refreshActiveSftpSessionStatus(tabKey);
    else requestAnimationFrame(() => void refreshActiveSftpSessionStatus(tabKey));
    return true;
  }

  const restored = Boolean(cached?.state && !cached.needsReload && String(cached.state.path || ".") === String(remotePath || "."))
    && restoreCachedSftpState(cached, runtime);
  if (!restored) {
    runtime.state = {...runtime.state, connectionId, path:remotePath, entries:[], selected:null, page:1, total:0, totalPages:1, unfilteredTotal:0};
    if (sftpActiveRuntimeKey === tabKey) sftpState = runtime.state;
  }
  const displayPath = restored ? runtime.state.path : remotePath;
  const sftpText = {
    openTerminal:tr("sftp:auto.open_terminal", {defaultValue:"打开此连接的终端"}),
    favorite:tr("sftp:auto.favorite_current", {defaultValue:"收藏当前目录"}),
    newFolder:tr("sftp:menu.new_folder", {defaultValue:"新建文件夹"}),
    newFile:tr("sftp:menu.new_file", {defaultValue:"新建文件"}),
    upload:tr("sftp:auto.upload_files", {defaultValue:"上传文件"}),
    recycle:tr("sftp:auto.recycle_bin", {defaultValue:"SFTP 回收站"}),
    search:tr("sftp:auto.search_current", {defaultValue:"搜索当前目录"}),
    searchChildren:tr("sftp:auto.search_children", {defaultValue:"搜索子目录"}),
    clearSearch:tr("sftp:auto.clear_search", {defaultValue:"清除搜索"}),
    historyBack:tr("sftp:auto.history_back", {defaultValue:"上一步"}),
    historyForward:tr("sftp:auto.history_forward", {defaultValue:"下一步"}),
    parentDirectory:tr("sftp:auto.parent_directory", {defaultValue:"上一级"}),
    remotePath:tr("sftp:auto.remote_path", {defaultValue:"远程目录路径"}),
    goToPath:tr("sftp:auto.go_to_path", {defaultValue:"转到路径"}),
    enterPath:tr("sftp:auto.enter_path", {defaultValue:"手动输入目录"}),
    cancel:tr("common:actions.cancel", {defaultValue:"取消"}),
    expandActions:tr("sftp:auto.expand_actions", {defaultValue:"展开操作按钮"}),
    temporaryUtf8:tr("sftp:auto.temporary_utf8", {defaultValue:"临时连接使用 UTF-8 文件名编码"}),
    changeEncoding:tr("sftp:auto.change_filename_encoding", {defaultValue:"切换 SFTP 文件名编码"}),
    connecting:tr("sftp:auto.connecting", {defaultValue:"正在连接 SFTP"}),
    refresh:tr("sftp:auto.refresh_directory", {defaultValue:"刷新目录"}),
    settings:tr("sftp:auto.global_settings", {defaultValue:"SFTP 全局设置"})
  };
  view.innerHTML = `<div class="sftp-shell" data-sftp-tab-key="${escAttr(tabKey)}" ondragenter="handleSftpDragEnter(event,'${escAttr(tabKey)}')" ondragover="handleSftpDragOver(event,'${escAttr(tabKey)}')" ondragleave="handleSftpDragLeave(event,'${escAttr(tabKey)}')" ondrop="handleSftpDrop(event,'${escAttr(tabKey)}')">
    <div class="sftp-top">
      <div id="sftpToolbarMount"><div class="sftp-toolbar">
        <div class="sftp-toolbar-actions">
          <button class="icon-button sftp-action-terminal" title="${escAttr(sftpText.openTerminal)}" aria-label="${escAttr(sftpText.openTerminal)}" onclick="openTerminal(${id})">${icon("square-terminal")}</button>
          ${quickConnection ? "" : `<button class="icon-button" title="${escAttr(sftpText.favorite)}" aria-label="${escAttr(sftpText.favorite)}" id="sftpFavoriteToggle" onclick="toggleSftpFavorite('${escAttr(tabKey)}')">${icon("star")}</button>`}
          <button class="icon-button" title="${escAttr(sftpText.newFolder)}" aria-label="${escAttr(sftpText.newFolder)}" onclick="mkdirSftp('${escAttr(tabKey)}')">${icon("folder-plus")}</button>
          <button class="icon-button" title="${escAttr(sftpText.newFile)}" aria-label="${escAttr(sftpText.newFile)}" onclick="createSftpFile('${escAttr(tabKey)}')">${icon("file-plus-2")}</button>
          <button type="button" class="icon-button" title="${escAttr(sftpText.upload)}" aria-label="${escAttr(sftpText.upload)}" onclick="sftpElement('sftpUpload','${escAttr(tabKey)}')?.click()">${icon("upload")}</button>
          <input id="sftpUpload" type="file" multiple onchange="uploadSftpFile('${escAttr(tabKey)}')" hidden>
          <button class="icon-button" title="${escAttr(sftpText.recycle)}" aria-label="${escAttr(sftpText.recycle)}" onclick="openSftpRecycleBin('${escAttr(tabKey)}')">${icon("trash-2")}</button>
          <span id="sftpClipboardActions" class="sftp-clipboard-actions">${renderSftpClipboardActions(tabKey)}</span>
          <span class="sftp-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="${escAttr(sftpText.search)}" aria-label="${escAttr(sftpText.search)}" onclick="toggleSftpSearch('${escAttr(tabKey)}')">${icon("search")}</button>
          ${quickConnection ? `<span id="sftpFilenameEncodingButton" class="sftp-encoding-button" title="${escAttr(sftpText.temporaryUtf8)}">${icon("earth")}<span>UTF-8</span></span>` : `<button id="sftpFilenameEncodingButton" class="sftp-encoding-button" title="${escAttr(sftpText.changeEncoding)}" aria-label="${escAttr(sftpText.changeEncoding)}" onclick="showSftpFilenameEncodingMenu(event,${id})">${icon("earth")}<span>${esc(sftpFilenameEncodingLabel(c))}</span>${icon("chevron-down")}</button>`}
          <button id="sftpConnectionToggle" class="icon-button sftp-connection-toggle" data-status="connecting" title="${escAttr(sftpText.connecting)}" aria-label="${escAttr(sftpText.connecting)}" onclick="toggleSftpConnection(${id},'${escAttr(tabKey)}')">${icon("loader-circle")}</button>
          <button class="icon-button" title="${escAttr(sftpText.refresh)}" aria-label="${escAttr(sftpText.refresh)}" onclick="refreshSftp({tabKey:'${escAttr(tabKey)}'})">${icon("refresh-cw")}</button>
          <button id="sftpGlobalSettingsButton" class="icon-button" title="${escAttr(sftpText.settings)}" aria-label="${escAttr(sftpText.settings)}" onclick="showSftpGlobalSettings()">${icon("settings")}</button>
        </div>
      </div></div>
      <div class="sftp-navigation-row">
        <div class="sftp-navigation-actions">
          <button id="sftpHistoryBack" class="icon-button" title="${escAttr(sftpText.historyBack)}" aria-label="${escAttr(sftpText.historyBack)}" onclick="navigateSftpHistory(-1,'${escAttr(tabKey)}')">${icon("arrow-left")}</button>
          <button id="sftpHistoryForward" class="icon-button" title="${escAttr(sftpText.historyForward)}" aria-label="${escAttr(sftpText.historyForward)}" onclick="navigateSftpHistory(1,'${escAttr(tabKey)}')">${icon("arrow-right")}</button>
          <button class="icon-button" title="${escAttr(sftpText.parentDirectory)}" aria-label="${escAttr(sftpText.parentDirectory)}" onclick="navigateSftpPath(parentRemotePath(sftpTabRuntimes.get('${escAttr(tabKey)}')?.state.path),'${escAttr(tabKey)}')">${icon("corner-left-up")}</button>
        </div>
        <div class="sftp-path-block">
          <nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="${escAttr(sftpText.remotePath)}" ondblclick="showSftpPathEditor('${escAttr(tabKey)}')">${sftpBreadcrumbHtml(id, displayPath, tabKey)}</nav>
          <form id="sftpPathEditor" class="sftp-path-editor" hidden onsubmit="submitSftpPath(event,'${escAttr(tabKey)}')"><input id="sftpPathInput" aria-label="${escAttr(sftpText.remotePath)}" value="${esc(displayPath)}"><button type="submit" class="icon-button" title="${escAttr(sftpText.goToPath)}" aria-label="${escAttr(sftpText.goToPath)}">${icon("corner-down-left")}</button><button type="button" class="icon-button" title="${escAttr(sftpText.cancel)}" aria-label="${escAttr(sftpText.cancel)}" onclick="hideSftpPathEditor('${escAttr(tabKey)}')">${icon("x")}</button></form>
        </div>
        <div class="sftp-navigation-end-actions">
          <button id="sftpPathEditButton" class="icon-button sftp-path-edit-button" title="${escAttr(sftpText.enterPath)}" aria-label="${escAttr(sftpText.enterPath)}" onclick="showSftpPathEditor('${escAttr(tabKey)}')">${icon("pencil")}</button>
          <button id="sftpMobileToolbarToggle" class="icon-button sftp-mobile-toolbar-toggle" type="button" title="${escAttr(sftpText.expandActions)}" aria-label="${escAttr(sftpText.expandActions)}" aria-controls="sftpToolbarMount" aria-expanded="false" onclick="toggleSftpMobileToolbar('${escAttr(tabKey)}')">${icon("chevron-down")}</button>
        </div>
      </div>
      <div id="sftpFavorites" class="sftp-favorites${sftpFavorites.some(item => item.connectionId === id) ? "" : " is-empty"}">${renderSftpFavorites(id, tabKey)}</div>
      <div id="sftpConnectionBanner" class="sftp-connection-banner" hidden>
        <div>${icon("link-2-off")}<span><strong>${esc(tr("sftp:auto.connection_disconnected", {defaultValue:"SFTP 连接已断开"}))}</strong><small class="sftp-connection-detail">${esc(tr("sftp:auto.connection_preserved", {defaultValue:"当前目录仍保留，可重新连接后继续操作。"}))}</small></span></div>
        <button onclick="reconnectSftpConnection(${id},{tabKey:'${escAttr(tabKey)}'})">${icon("link-2")}<span>${esc(tr("sftp:auto.reconnect", {defaultValue:"重新连接"}))}</span></button>
      </div>
      <div class="sftp-selection-bar" id="sftpSelectionBar" hidden>
        <div class="sftp-selected" id="sftpSelectedInfo">${esc(tr("sftp:auto.selected_count", {count:0, defaultValue:"已选择 0 项"}))}</div>
        <div class="sftp-selection-actions">
          <button onclick="copySftpSelection('copy','${escAttr(tabKey)}')">${icon("copy")}<span>${esc(tr("sftp:menu.copy", {defaultValue:"复制"}))}</span></button>
          <button onclick="copySftpSelection('move','${escAttr(tabKey)}')">${icon("folder-input")}<span>${esc(tr("sftp:menu.move", {defaultValue:"移动"}))}</span></button>
          <button onclick="downloadSftpSelection('${escAttr(tabKey)}')">${icon("download")}<span>${esc(tr("sftp:menu.download", {defaultValue:"下载"}))}</span></button>
          ${window.termaDesktop ? `<button onclick="sendSftpSelectionToDesktop('${escAttr(tabKey)}')">${icon("monitor-down")}<span>${esc(tr("sftp:auto.send_to_desktop", {defaultValue:"发送到桌面"}))}</span></button>` : ""}
          <button id="sftpSelectionCompress" onclick="compressSftpSelection('${escAttr(tabKey)}')">${icon("archive")}<span>${esc(tr("sftp:menu.compress", {defaultValue:"压缩"}))}</span></button>
          <button id="sftpSelectionPermissions" onclick="openSftpPermissionsForSelection(null,'${escAttr(tabKey)}')">${icon("key-round")}<span>${esc(tr("sftp:auto.permissions", {defaultValue:"权限"}))}</span></button>
          <button id="sftpSelectionExtract" onclick="extractSftpSelection('${escAttr(tabKey)}')" hidden>${icon("archive-restore")}<span>${esc(tr("sftp:menu.extract", {defaultValue:"解压"}))}</span></button>
          <button class="danger" onclick="deleteSftpSelection('${escAttr(tabKey)}')">${icon("trash-2")}<span>${esc(tr("sftp:menu.delete", {defaultValue:"删除"}))}</span></button>
          <button class="icon-button" title="${escAttr(tr("common:auto.cancel_selection", {defaultValue:"取消选择"}))}" aria-label="${escAttr(tr("common:auto.cancel_selection", {defaultValue:"取消选择"}))}" onclick="clearSftpSelection('${escAttr(tabKey)}')">${icon("x")}</button>
        </div>
      </div>
    </div>
    <div id="sftpList" class="sftp-list" oncontextmenu="showSftpDirectoryMenu(event,'${escAttr(tabKey)}')">${restored ? "" : stateView("loading", tr("sftp:auto.loading_directory", {defaultValue:"正在读取目录"}), displayPath)}</div>
    <div id="sftpDropOverlay" class="sftp-drop-overlay" data-mode="upload" aria-hidden="true" hidden></div>
    <div id="sftpFloatingSearch" class="sftp-floating-search" hidden aria-busy="false"><span class="sftp-search-status-icon" title="${escAttr(sftpText.search)}">${icon("search")}${icon("loader-circle")}</span><input id="sftpSearch" placeholder="${escAttr(sftpText.search)}" value="${esc(runtime.state.query)}" oninput="setSftpSearch(this.value,'${escAttr(tabKey)}')"><button class="icon-button" title="${escAttr(sftpText.clearSearch)}" aria-label="${escAttr(sftpText.clearSearch)}" onclick="clearSftpSearch('${escAttr(tabKey)}')">${icon("x")}</button><label class="sftp-search-recursive"><input type="checkbox" ${runtime.state.recursiveSearch ? "checked" : ""} onchange="setSftpRecursiveSearch(this.checked,'${escAttr(tabKey)}')"><span>${esc(sftpText.searchChildren)}</span></label></div>
  </div>`;
  if (!quickConnection && typeof remoteDesktopJumpButtonHtml === "function") {
    view.querySelector("#sftpFilenameEncodingButton")?.insertAdjacentHTML("afterend", remoteDesktopJumpButtonHtml(id));
  }
  if (!quickConnection && typeof localFilesToolbarButtonHtml === "function") {
    view.querySelector(".sftp-toolbar-actions")?.insertAdjacentHTML("beforeend", localFilesToolbarButtonHtml(tabKey));
  }
  view.dataset.workspaceTabKey = tabKey;
  view.dataset.sftpTabKey = tabKey;
  const toolbarMount = view.querySelector("#sftpToolbarMount");
  const toolbar = toolbarMount?.querySelector(":scope > .sftp-toolbar");
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("sftp", tabKey, toolbar, toolbarMount);
  runtime.root = view;
  runtime.toolbar = toolbar || null;
  setWorkspace(title, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:displayPath, connectionStatus:preserveManualDisconnect && !updateTab ? "disconnected" : "connecting", transient:quickConnection, quick_connection:quickConnection, skipToolbarSync:true});
  syncSftpToolbarPlacement(tabKey);
  flushPendingSftpDirectoryRefresh(tabKey);
  restoreSftpDropFeedbackAfterRender(tabKey);
  rememberSftpNavigation(tabKey, displayPath);
  syncSftpNavigationButtons(tabKey);
  refreshSftpJobsIfStale();
  startSftpJobsTimer();
  if (preserveManualDisconnect && !updateTab) {
    updateSftpConnectionUi(id, "disconnected");
    if (restored) {
      refreshSftpDirectoryActions(tabKey);
      renderSftpEntries(tabKey);
      restoreSftpViewState(cached.viewState, tabKey);
    }
    return true;
  }
  if (restored) {
    refreshSftpDirectoryActions(tabKey);
    renderSftpEntries(tabKey);
    restoreSftpViewState(cached.viewState, tabKey);
    void refreshActiveSftpSessionStatus(tabKey);
    return true;
  }
  return loadSftpPage({path:remotePath, page:1, tabKey, paneId:options.paneId, activationToken:options.activationToken});
}

function sftpDirectoryPageAbortError() {
  const error = new Error("SFTP directory request aborted");
  error.name = "AbortError";
  return error;
}

function awaitSftpDirectoryPageRequest(request, signal=null) {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(sftpDirectoryPageAbortError());
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(sftpDirectoryPageAbortError());
    };
    signal.addEventListener("abort", onAbort, {once:true});
    request.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

const SFTP_DIRECTORY_REQUEST_CONCURRENCY = 3;
let sftpDirectoryRequestActive = 0;
const sftpDirectoryRequestQueue = [];

function drainSftpDirectoryRequestQueue() {
  while (sftpDirectoryRequestActive < SFTP_DIRECTORY_REQUEST_CONCURRENCY && sftpDirectoryRequestQueue.length) {
    const item = sftpDirectoryRequestQueue.shift();
    if (item.signal?.aborted) {
      item.reject(sftpDirectoryPageAbortError());
      continue;
    }
    sftpDirectoryRequestActive += 1;
    Promise.resolve()
      .then(item.run)
      .then(item.resolve, item.reject)
      .finally(() => {
        sftpDirectoryRequestActive = Math.max(0, sftpDirectoryRequestActive - 1);
        drainSftpDirectoryRequestQueue();
      });
  }
}

function scheduleSftpDirectoryRequest(run, signal=null) {
  if (signal?.aborted) return Promise.reject(sftpDirectoryPageAbortError());
  return new Promise((resolve, reject) => {
    sftpDirectoryRequestQueue.push({run, signal, resolve, reject});
    drainSftpDirectoryRequestQueue();
  });
}

function requestSftpDirectoryPage(connectionId, params, signal=null) {
  const requestPath = `/api/connections/${Number(connectionId)}/sftp?${params.toString()}`;
  let request = sftpDirectoryPageRequests.get(requestPath);
  if (!request) {
    request = scheduleSftpDirectoryRequest(() => api(requestPath)).finally(() => {
      if (sftpDirectoryPageRequests.get(requestPath) === request) sftpDirectoryPageRequests.delete(requestPath);
    });
    sftpDirectoryPageRequests.set(requestPath, request);
  }
  return awaitSftpDirectoryPageRequest(request, signal);
}

async function loadSftpPage(options={}) {
  const tabKey = String(options.tabKey || activeTabKey || "");
  const tab = tabs.find(item => item.key === tabKey);
  const id = Number(options.connectionId || sftpTabRuntimes.get(tabKey)?.connectionId || tab?.id || 0);
  if (!id) return false;
  const runtime = ensureSftpRuntime(tabKey, id, options.path || tab?.path || ".");
  if (!runtime) return false;
  const currentState = runtime.state;
  const remotePath = options.path || currentState.path || ".";
  const requestedPage = Math.max(1, Number(options.page || currentState.page || 1));
  const query = String(currentState.query || "");
  const recursiveSearch = Boolean(currentState.recursiveSearch && query.trim());
  const sort = ["name","size","mtime"].includes(currentState.sort) ? currentState.sort : "name";
  const dir = currentState.dir === "desc" ? "desc" : "asc";
  const pageSize = [25,50,100,200].includes(Number(currentState.pageSize)) ? Number(currentState.pageSize) : 50;
  const list = sftpElement("sftpList", tabKey);
  const hadDirectoryView = Boolean(list?.querySelector(".sftp-head"));
  const previousViewState = hadDirectoryView ? captureSftpViewState(tabKey) : null;
  const sameDirectory = Number(currentState.connectionId) === id && String(currentState.path || ".") === String(remotePath || ".");
  const keepContents = Boolean(list?.querySelector(".sftp-head") && sameDirectory && options.keepContents !== false);
  const preserveView = Boolean(options.preserveView ?? options.refresh) && keepContents;
  const silent = Boolean(options.silent) && keepContents;

  runtime.requestController?.abort?.();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  runtime.requestController = controller;
  const requestSeq = Number(currentState.requestSeq || 0) + 1;
  runtime.state = {...currentState, loading:true, requestSeq, selected:preserveView ? currentState.selected : null};
  if (sftpActiveRuntimeKey === tabKey) {
    sftpState = runtime.state;
    sftpRequestController = controller;
  }
  if (list) {
    if (!silent) {
      list.classList.toggle("is-refreshing", keepContents);
      list.setAttribute("aria-busy", "true");
      if (!keepContents) list.innerHTML = stateView("loading", tr("sftp:auto.loading_directory"), remotePath);
    }
  }
  if (query) syncSftpSearchFeedback(tabKey, true);

  const params = new URLSearchParams({
    path: remotePath,
    page: String(requestedPage),
    page_size: String(pageSize),
    query,
    sort,
    dir
  });
  if (recursiveSearch) params.set("recursive", "1");
  if (options.refresh) params.set("refresh", "1");
  try {
    const data = await requestSftpDirectoryPage(id, params, controller?.signal || null);
    if (!sftpTabRuntimes.has(tabKey) || requestSeq !== runtime.state.requestSeq) return false;
    const mounted = runtime.root?.isConnected && runtime.root.dataset.sftpTabKey === tabKey;
    const viewState = preserveView && mounted ? captureSftpViewState(tabKey) : null;
    if (tab) tab.path = data.path;
    const nextState = {
      ...runtime.state,
      connectionId:id,
      path:data.path,
      entries:(data.entries || []).map(entry => ({...entry})),
      selected:preserveView ? runtime.state.selected : null,
      page:Number(data.page || 1),
      pageSize:Number(data.page_size || pageSize),
      total:Number(data.total || 0),
      totalPages:Number(data.total_pages || 1),
      unfilteredTotal:Number(data.unfiltered_total || 0),
      recursiveSearch:Boolean(currentState.recursiveSearch),
      recursiveSearchTruncated:Boolean(data.truncated),
      paged:Boolean(data.paged),
      sort:["name","size","mtime"].includes(data.sort) ? data.sort : sort,
      dir:data.dir === "desc" ? "desc" : dir,
      loading:false,
      requestSeq
    };
    const contentChanged = !options.renderIfChangedOnly
      || sftpDirectoryContentSignature(runtime.state) !== sftpDirectoryContentSignature(nextState);
    runtime.state = nextState;
    if (!contentChanged) runtime.renderedRequestSeq = requestSeq;
    if (sftpActiveRuntimeKey === tabKey) sftpState = nextState;
    for (const key of sftpTabKeysForConnection(id)) sftpDisconnectedTabs.delete(key);
    updateSftpConnectionUi(id, "connected");
    if (!options.historyNavigation) rememberSftpNavigation(tabKey, data.path);
    else syncSftpNavigationButtons(tabKey);
    if (contentChanged && mounted) {
      const breadcrumb = sftpElement("sftpBreadcrumb", tabKey);
      const pathInput = sftpElement("sftpPathInput", tabKey);
      if (breadcrumb) breadcrumb.innerHTML = sftpBreadcrumbHtml(id, data.path, tabKey);
      if (pathInput) pathInput.value = data.path;
      refreshSftpDirectoryActions(tabKey);
      renderSftpEntries(tabKey);
      if (viewState) restoreSftpViewState(viewState, tabKey);
    }
    rememberSftpViewState(tabKey, remotePath);
    if (typeof scheduleTabsStateSave === "function") scheduleTabsStateSave();
    else saveTabsState();
    return true;
  } catch (error) {
    if (error?.name === "AbortError" || requestSeq !== runtime.state.requestSeq) return false;
    if (error?.code === "SSH_CREDENTIAL_REPAIR_REDIRECTED") return false;
    const directoryAccessError = [
      "SFTP_DIRECTORY_PERMISSION_DENIED",
      "SFTP_DIRECTORY_NOT_FOUND",
      "SFTP_DIRECTORY_ACCESS_FAILED"
    ].includes(String(error?.code || ""));
    runtime.state = {...currentState, loading:false, requestSeq};
    if (sftpActiveRuntimeKey === tabKey) sftpState = runtime.state;
    if (tab) tab.path = currentState.path;
    updateSftpConnectionUi(id, directoryAccessError ? "connected" : "disconnected", error.message || tr("sftp:auto.connection_disconnected"));
    const mountedList = sftpElement("sftpList", tabKey);
    if (mountedList && runtime.root?.dataset.sftpTabKey === tabKey) {
      if (hadDirectoryView) {
        const breadcrumb = sftpElement("sftpBreadcrumb", tabKey);
        const pathInput = sftpElement("sftpPathInput", tabKey);
        if (breadcrumb) breadcrumb.innerHTML = sftpBreadcrumbHtml(id, currentState.path || ".", tabKey);
        if (pathInput) pathInput.value = currentState.path || ".";
        refreshSftpDirectoryActions(tabKey);
        renderSftpEntries(tabKey);
        if (previousViewState) restoreSftpViewState(previousViewState, tabKey);
        if (!silent) notify(error.message || tr("sftp:auto.directory_sync_failed"), "error");
      } else {
        mountedList.innerHTML = stateView("error", tr("sftp:auto.directory_load_failed"), error.message, `<button onclick="refreshSftp({tabKey:'${escAttr(tabKey)}'})">${esc(tr("common:actions.retry"))}</button>`);
      }
    }
    return false;
  } finally {
    if (requestSeq === runtime.state.requestSeq) runtime.state.loading = false;
    if (runtime.requestController === controller) runtime.requestController = null;
    if (sftpActiveRuntimeKey === tabKey) {
      sftpState = runtime.state;
      sftpRequestController = runtime.requestController;
    }
    if (list && requestSeq === runtime.state.requestSeq && !silent) {
      list.classList.remove("is-refreshing");
      list.setAttribute("aria-busy", "false");
    }
    if (requestSeq === runtime.state.requestSeq) syncSftpSearchFeedback(tabKey, false);
    if (requestSeq === runtime.state.requestSeq) queueMicrotask(() => flushPendingSftpDirectoryRefresh(tabKey));
  }
}

function captureSftpViewState(tabKey=activeTabKey) {
  const runtime = sftpTabRuntimes.get(String(tabKey || ""));
  const root = sftpRuntimeRoot(tabKey);
  const scrollTarget = root?.querySelector("#sftpList") || root?.closest(".workspace");
  return {
    scrollTop:Number(scrollTarget?.scrollTop || 0),
    selectedPaths:sftpElements("#sftpList .sftp-check:checked", tabKey).map(input => input.value),
    activePath:runtime?.state.selected?.path || ""
  };
}

function restoreSftpViewState(state, tabKey=activeTabKey) {
  if (!state) return;
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  const selectedPaths = new Set(state.selectedPaths || []);
  sftpElements("#sftpList .sftp-check", tabKey).forEach(input => { input.checked = selectedPaths.has(input.value); });
  if (state.activePath && !(runtime.state.entries || []).some(entry => joinRemotePath(runtime.state.path, entry.name) === state.activePath)) {
    runtime.state.selected = null;
    sftpElements("#sftpList .sftp-row.active", tabKey).forEach(row => row.classList.remove("active"));
  }
  updateSftpSelection(tabKey);
  const root = sftpRuntimeRoot(tabKey);
  const scrollTarget = root?.querySelector("#sftpList") || root?.closest(".workspace");
  if (!scrollTarget) return;
  const restore = () => {
    scrollTarget.scrollTop = Math.min(Number(state.scrollTop || 0), Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight));
    syncSftpListScrollCue(scrollTarget);
  };
  restore();
  requestAnimationFrame(restore);
}

function setSftpSearch(value, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  runtime.state.query = value || "";
  syncSftpSearchFeedback(tabKey, true);
  clearTimeout(runtime.searchTimer);
  runtime.searchTimer = setTimeout(() => {
    if (!sftpTabRuntimes.has(tabKey)) return;
    runtime.state.page = 1;
    loadSftpPage({page:1, tabKey});
  }, 420);
  if (sftpActiveRuntimeKey === tabKey) {
    sftpState = runtime.state;
    sftpSearchTimer = runtime.searchTimer;
  }
}

function setSftpSort(key, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  clearTimeout(runtime.searchTimer);
  if (runtime.state.sort === key) runtime.state.dir = runtime.state.dir === "asc" ? "desc" : "asc";
  else {
    runtime.state.sort = key;
    runtime.state.dir = "asc";
  }
  runtime.state.page = 1;
  loadSftpPage({page:1, tabKey});
}

function setSftpPage(page, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  clearTimeout(runtime.searchTimer);
  const target = Math.max(1, Math.min(Number(page) || 1, Number(runtime.state.totalPages || 1)));
  if (target === runtime.state.page && !runtime.state.loading) return;
  loadSftpPage({page:target, tabKey});
}

function jumpSftpPage(input, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  const value = Number(input?.value ?? input);
  if (!Number.isFinite(value)) return;
  const target = Math.max(1, Math.min(Math.trunc(value), Number(runtime.state.totalPages || 1)));
  if (input && typeof input === "object" && "value" in input) input.value = String(target);
  setSftpPage(target, tabKey);
}

function setSftpPageSize(value, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  clearTimeout(runtime.searchTimer);
  const pageSize = Number(value);
  if (![25,50,100,200].includes(pageSize) || pageSize === runtime.state.pageSize) return;
  runtime.state.pageSize = pageSize;
  runtime.state.page = 1;
  const list = sftpElement("sftpList", tabKey);
  const selector = list?.querySelector(".sftp-pager select");
  if (selector) selector.value = String(pageSize);
  loadSftpPage({page:1, tabKey});
}

function sortMark(key, tabKey=activeTabKey) {
  const state = sftpTabRuntimes.get(String(tabKey || ""))?.state || sftpState;
  return state.sort === key ? (state.dir === "asc" ? "↑" : "↓") : "";
}

function syncSftpListLayout(list=sftpElement("sftpList"), measuredWidth) {
  if (!list) return;
  const width = Number(measuredWidth) || list.getBoundingClientRect().width;
  const lockedWidth = Number(list.dataset.sftpPixelColumnsWidth || 0);
  if (lockedWidth > 0 && Math.abs(width - lockedWidth) > 1 && typeof releaseSftpPixelColumnLayout === "function") releaseSftpPixelColumnLayout(list);
  const mobile = isMobileLayout();
  list.classList.toggle("sftp-actions-medium", width > 0 && width <= 1200);
  list.classList.toggle("sftp-actions-compact", width > 0 && width <= 1000);
  list.classList.toggle("sftp-actions-minimal", width > 0 && width <= 620);
  list.classList.toggle("sftp-actions-more-only", width > 0 && (width <= 520 || mobile));
  if (typeof applySftpColumnLayout === "function") applySftpColumnLayout(list);
}

function syncSftpListScrollCue(list=sftpElement("sftpList")) {
  if (!list) return;
  const hasMoreBelow = list.scrollHeight - list.scrollTop - list.clientHeight > 2;
  list.classList.toggle("has-scroll-below", hasMoreBelow);
}

function watchSftpListLayout(list, tabKey=activeTabKey) {
  const runtime = ensureSftpRuntime(tabKey, tabs.find(tab => tab.key === tabKey)?.id || 0);
  if (!runtime) return;
  runtime.resizeObserver?.disconnect();
  if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
  syncSftpListLayout(list);
  if (list.dataset.sftpScrollCueBound !== "1") {
    list.dataset.sftpScrollCueBound = "1";
    list.addEventListener("scroll", () => syncSftpListScrollCue(list), {passive:true});
  }
  syncSftpListScrollCue(list);
  requestAnimationFrame(() => syncSftpListScrollCue(list));
  if (typeof ResizeObserver !== "function") return;
  runtime.resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect?.width;
    if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
    runtime.resizeFrame = requestAnimationFrame(() => {
      runtime.resizeFrame = 0;
      if (list.isConnected) {
        syncSftpListLayout(list, width);
        syncSftpListScrollCue(list);
      }
    });
  });
  runtime.resizeObserver.observe(list);
  if (sftpActiveRuntimeKey === tabKey) {
    sftpListResizeObserver = runtime.resizeObserver;
    sftpListResizeFrame = runtime.resizeFrame;
  }
}

function renderSftpEntries(tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const state = runtime?.state;
  const list = sftpElement("sftpList", tabKey);
  if (!list) return;
  const entries = state.entries || [];
  const id = state.connectionId;
  const syncIndicator = `<div class="sftp-refresh-indicator" role="status">${icon("loader-circle")}<span>${esc(tr("sftp:auto.syncing"))}</span></div>`;
  const headColumns = sftpOrderedColumnHtml({
    name:sftpHeaderColumnHtml("name", tabKey, sortMark("name", tabKey)),
    size:sftpHeaderColumnHtml("size", tabKey, sortMark("size", tabKey)),
    mtime:sftpHeaderColumnHtml("mtime", tabKey, sortMark("mtime", tabKey)),
    access:sftpHeaderColumnHtml("access", tabKey)
  });
  const head = `<div class="sftp-head"><label class="sftp-head-check"><input id="sftpSelectAll" type="checkbox" aria-label="${escAttr(tr("sftp:auto.select_page"))}" onchange="toggleSftpAll(this.checked,'${escAttr(tabKey)}')"></label>${headColumns}<span class="sftp-head-actions">${esc(tr("sftp:auto.actions"))}</span>${syncIndicator}</div>`;
  const rows = entries.map(entry => {
    const fullPath = joinRemotePath(state.path, entry.name);
    const isDir = entry.type === "dir";
    const metadataKnown = entry.metadata_known !== false;
    const isLink = Boolean(entry.is_symlink);
    const linkDescription = !isLink
      ? entry.name
      : entry.link_target_missing
        ? tr("sftp:auto.link_target_missing", {name:entry.name})
        : isDir
          ? tr("sftp:auto.linked_directory_name", {name:entry.name})
          : tr("sftp:auto.linked_file_name", {name:entry.name, targetSize:formatBytes(entry.size), linkSize:formatBytes(entry.link_size || 0)});
    const mobileType = isLink ? (isDir ? tr("sftp:auto.linked_directory") : tr("sftp:auto.linked_file")) : (isDir ? tr("sftp:auto.directory") : "");
    const mobileMeta = metadataKnown
      ? [
        mobileType || (!isDir ? formatBytes(entry.size) : ""),
        entry.mtime ? formatSftpTime(entry.mtime) : "",
        entry.mode || "---",
        [entry.owner, entry.group].filter(Boolean).join(":")
      ].filter(Boolean).join(" · ")
      : mobileType || tr("sftp:auto.path_index");
    const active = state.selected?.path === fullPath;
    const columns = sftpOrderedColumnHtml({
      name:`<button class="sftp-name sftp-column-name" title="${esc(linkDescription)}" onclick="event.stopPropagation(); selectSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')"><span class="sftp-icon ${entry.type} ${sftpFileKind(entry.name)} ${isLink ? "symlink" : ""}">${sftpIcon(entry.name, isDir)}</span><span class="sftp-name-copy"><span class="sftp-file-name">${esc(entry.name)}</span><span class="sftp-mobile-meta">${esc(mobileMeta)}</span></span></button>`,
      size:`<span class="sftp-size sftp-column-size">${!metadataKnown ? "--" : isDir ? sftpDirectorySizeButtonHtml(id, fullPath) : formatBytes(entry.size)}</span>`,
      mtime:`<span class="sftp-time sftp-column-mtime">${metadataKnown && entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span>`,
      access:`<span class="sftp-access sftp-column-access" title="${metadataKnown ? escAttr(tr("sftp:auto.permission_detail", {mode:entry.mode || tr("sftp:auto.unknown"), owner:entry.owner || tr("sftp:auto.unknown"), group:entry.group || tr("sftp:auto.unknown")})) : escAttr(tr("sftp:auto.metadata_unavailable"))}"><code>${metadataKnown ? esc(entry.mode || "---") : "--"}</code><span>${metadataKnown ? esc(entry.owner || tr("sftp:auto.unknown")) : esc(tr("sftp:auto.path_index"))}</span></span>`
    });
    return `<div class="sftp-row ${active ? "active" : ""}" draggable="${isMobileLayout() ? "false" : "true"}" onclick="selectSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondblclick="activateSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" oncontextmenu="showSftpEntryMenu(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" onpointerdown="primeSftpNativeDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondragstart="beginSftpItemDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondragend="finishSftpItemDrag(event)">
      <input class="sftp-check" type="checkbox" value="${esc(fullPath)}" data-path-bytes="${escAttr(entry.path_bytes_b64 || "")}" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" data-mtime="${Math.max(0, Number(entry.mtime || 0))}" data-metadata-known="${metadataKnown ? "1" : "0"}" data-mode="${esc(entry.mode || "")}" data-owner="${esc(entry.owner || "")}" data-group="${esc(entry.group || "")}" aria-label="${escAttr(tr("sftp:auto.select_item", {name:entry.name}))}" onclick="handleSftpCheckboxSelection(event,'${escAttr(fullPath)}','${escAttr(tabKey)}')">
      ${columns}
      <div class="sftp-row-actions">${sftpRowActionsHtml(id, fullPath, entry.name, entry.type, tabKey)}</div>
    </div>`;
  }).join("");
  const page = Number(state.page || 1);
  const totalPages = Number(state.totalPages || 1);
  const total = Number(state.total || 0);
  const first = total ? (page - 1) * Number(state.pageSize || 50) + 1 : 0;
  const last = total ? Math.min(first + entries.length - 1, total) : 0;
  const pageSizes = [25,50,100,200].map(size => `<option value="${size}" ${size === Number(state.pageSize) ? "selected" : ""}>${esc(tr("sftp:auto.item_count", {count:size}))}</option>`).join("");
  const recursiveSummary = state.query && state.recursiveSearch
    ? `${tr("sftp:auto.recursive_suffix")}${state.recursiveSearchTruncated ? ` ${tr("sftp:auto.recursive_truncated")}` : ""}`
    : "";
  const filterSummary = state.query && Number(state.unfilteredTotal || 0) !== total ? tr("sftp:auto.range_total", {count:Number(state.unfilteredTotal || 0), recursive:recursiveSummary}) : recursiveSummary;
  const pageSummaryKey = filterSummary ? "sftp:auto.page_summary_filtered" : "sftp:auto.page_summary";
  const pager = `<div class="sftp-pager-dock"><div class="pager sftp-pager"><button onclick="setSftpPage(${page - 1},'${escAttr(tabKey)}')" ${page <= 1 ? "disabled" : ""}>${esc(tr("sftp:auto.previous_page"))}</button><span class="pager-count"><span class="sftp-scroll-cue" title="${escAttr(tr("sftp:auto.more_below"))}" aria-hidden="true">${icon("chevron-down")}</span><span class="sftp-page-summary">${esc(tr(pageSummaryKey, {page,pages:totalPages,first,last,total,filter:filterSummary}))}</span><select aria-label="${escAttr(tr("sftp:auto.page_size"))}" onchange="setSftpPageSize(this.value,'${escAttr(tabKey)}')">${pageSizes}</select><label class="sftp-page-jump"><span>${esc(tr("sftp:auto.page_jump"))}</span><input type="number" min="1" max="${totalPages}" value="${page}" aria-label="${escAttr(tr("sftp:auto.page_jump"))}" onkeydown="if(event.key==='Enter'){event.preventDefault();jumpSftpPage(this,'${escAttr(tabKey)}')}" onchange="jumpSftpPage(this,'${escAttr(tabKey)}')"></label></span><button onclick="setSftpPage(${page + 1},'${escAttr(tabKey)}')" ${page >= totalPages ? "disabled" : ""}>${esc(tr("sftp:auto.next_page"))}</button></div></div>`;
  list.innerHTML = head + (rows || stateView("empty", state.query ? tr("sftp:auto.no_matches") : tr("sftp:auto.empty_directory"), state.query ? tr("sftp:auto.try_another_search") : tr("sftp:auto.empty_directory_hint"))) + pager;
  list.dataset.sftpTabKey = String(tabKey || "");
  runtime.renderedRequestSeq = Number(state.requestSeq || 0);
  if (typeof bindSftpColumnControls === "function") bindSftpColumnControls(list);
  watchSftpListLayout(list, tabKey);
  updateSftpSelection(tabKey);
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
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) return "--";
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString(document.documentElement.lang || "zh-CN", {hour12:false});
}

function sftpDiffHtml(oldText, newText) {
  return sftpDiffViewerHtml(oldText, newText);
}

function toggleSftpAll(checked, tabKey=activeTabKey) {
  const inputs = sftpElements(".sftp-check", tabKey);
  inputs.forEach(input => { input.checked = checked; });
  if (checked) {
    const runtime = restoreSftpRuntimeForTab(tabKey);
    if (runtime) runtime.state.selectionAnchorPath = inputs[0]?.value || "";
  }
  updateSftpSelection(tabKey);
}

function updateSftpSelection(tabKey=activeTabKey) {
  const inputs = sftpElements(".sftp-check", tabKey);
  const runtime = restoreSftpRuntimeForTab(tabKey);
  const selectedPaths = new Set(inputs.filter(input => input.checked).map(input => String(input.value)));
  const count = inputs.filter(input => input.checked).length;
  const box = sftpElement("sftpSelectedInfo", tabKey);
  const bar = sftpElement("sftpSelectionBar", tabKey);
  const selectAll = sftpElement("sftpSelectAll", tabKey);
  const extract = sftpElement("sftpSelectionExtract", tabKey);
  const compress = sftpElement("sftpSelectionCompress", tabKey);
  const permissions = sftpElement("sftpSelectionPermissions", tabKey);
  if (box) box.innerHTML = `<strong>${esc(tr("sftp:auto.selected_count", {count}))}</strong><span>${esc(tr("sftp:auto.selected_hint"))}</span>`;
  if (bar) bar.hidden = count < 2;
  if (selectAll) {
    selectAll.checked = inputs.length > 0 && count === inputs.length;
    selectAll.indeterminate = count > 0 && count < inputs.length;
  }
  if (extract) extract.hidden = !(count === 1 && isArchiveName(inputs.find(input => input.checked)?.value));
  if (compress) compress.hidden = count === 0;
  if (permissions) permissions.hidden = count === 0;
  if (runtime?.state.selected?.path && !selectedPaths.has(String(runtime.state.selected.path))) runtime.state.selected = null;
  inputs.forEach(input => {
    const row = input.closest(".sftp-row");
    row?.classList.toggle("is-selected", input.checked);
    row?.classList.toggle("active", Boolean(runtime?.state.selected?.path) && String(input.value) === String(runtime.state.selected.path));
  });
  if (sftpActiveRuntimeKey === tabKey && runtime) sftpState = runtime.state;
}

function clearSftpSelection(tabKey=activeTabKey) {
  sftpElements(".sftp-check", tabKey).forEach(input => { input.checked = false; });
  updateSftpSelection(tabKey);
}

function selectedSftpPaths(tabKey=activeTabKey) {
  return sftpElements(".sftp-check:checked", tabKey).map(input => input.value);
}

function selectedSftpEntries(tabKey=activeTabKey) {
  return sftpElements(".sftp-check:checked", tabKey).map(input => ({
    path: input.value,
    pathBytesB64: input.dataset.pathBytes || "",
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

function installSftpKeyboardShortcuts() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__termaSftpKeyboardShortcutsInstalled) return;
  window.__termaSftpKeyboardShortcutsInstalled = true;
  document.addEventListener("keydown", event => {
    const insideFloatingEditor = event.target?.closest?.(".sftp-editor-floating-root")
      || document.activeElement?.closest?.(".sftp-editor-floating-root");
    if (insideFloatingEditor) return;
    const tab = tabs.find(item => item.key === activeTabKey);
    const taskDrawer = document.getElementById("sftpTaskCenterDrawer");
    if (tab?.kind !== "sftp" || !$("modal")?.hidden || (taskDrawer && !taskDrawer.hidden)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      const panel = sftpElement("sftpFloatingSearch", activeTabKey);
      if (panel?.hidden) toggleSftpSearch(activeTabKey);
      else {
        const input = sftpElement("sftpSearch", activeTabKey);
        input?.focus();
        input?.select();
      }
      return;
    }
    const editable = event.target?.closest?.("input, textarea, select, [contenteditable='true']");
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a" && !editable) {
      event.preventDefault();
      event.stopPropagation();
      toggleSftpAll(true, activeTabKey);
      return;
    }
    if (event.key === "Escape") {
      const panel = sftpElement("sftpFloatingSearch", activeTabKey);
      if (!panel?.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeSftpSearch(activeTabKey);
        sftpRuntimeRoot(activeTabKey)?.focus?.({preventScroll:true});
      }
    }
  }, true);
}

installSftpKeyboardShortcuts();

function setSftpRecursiveSearch(enabled, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime) return;
  runtime.state.recursiveSearch = Boolean(enabled);
  runtime.state.page = 1;
  clearTimeout(runtime.searchTimer);
  syncSftpSearchFeedback(tabKey, Boolean(runtime.state.query));
  runtime.searchTimer = setTimeout(() => loadSftpPage({page:1, tabKey}), 0);
  if (sftpActiveRuntimeKey === tabKey) {
    sftpState = runtime.state;
    sftpSearchTimer = runtime.searchTimer;
  }
}
