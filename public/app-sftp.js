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
    if (options.fast) {
      if (preserveManualDisconnect && !updateTab) updateSftpConnectionUi(id, "disconnected");
      requestAnimationFrame(() => {
        if (!sftpTabRuntimes.has(tabKey)) return;
        syncSftpToolbarPlacement(tabKey);
        refreshSftpDirectoryActions(tabKey);
        refreshSftpJobs();
        startSftpJobsTimer();
        if (preserveManualDisconnect && !updateTab) return;
        void refreshActiveSftpSessionStatus(tabKey);
      });
      return true;
    }
    syncSftpToolbarPlacement(tabKey);
    refreshSftpDirectoryActions(tabKey);
    const refreshBackgroundSftpUi = () => {
      refreshSftpJobs();
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
        renderIfChangedOnly:true
      });
    }
    if (updateTab) void refreshActiveSftpSessionStatus(tabKey);
    else requestAnimationFrame(() => void refreshActiveSftpSessionStatus(tabKey));
    return true;
  }

  const restored = Boolean(cached?.state && String(cached.state.path || ".") === String(remotePath || "."))
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
  restoreSftpDropFeedbackAfterRender(tabKey);
  rememberSftpNavigation(tabKey, displayPath);
  syncSftpNavigationButtons(tabKey);
  refreshSftpJobs();
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
  return loadSftpPage({path:remotePath, page:1, tabKey});
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
    const data = await api(`/api/connections/${id}/sftp?${params.toString()}`, controller ? {signal:controller.signal} : {});
    if (!sftpTabRuntimes.has(tabKey) || requestSeq !== runtime.state.requestSeq) return false;
    const mounted = runtime.root?.isConnected && runtime.root.dataset.sftpTabKey === tabKey;
    const viewState = preserveView && mounted ? captureSftpViewState(tabKey) : null;
    if (tab) tab.path = data.path;
    const nextState = {
      ...runtime.state,
      connectionId:id,
      path:data.path,
      entries:data.entries || [],
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
    saveTabsState();
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
  if (target === runtime.state.page || runtime.state.loading) return;
  loadSftpPage({page:target, tabKey});
}

function jumpSftpPage(input, tabKey=activeTabKey) {
  const runtime = restoreSftpRuntimeForTab(tabKey);
  if (!runtime || runtime.state.loading) return;
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
      <input class="sftp-check" type="checkbox" value="${esc(fullPath)}" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" data-mtime="${Math.max(0, Number(entry.mtime || 0))}" data-metadata-known="${metadataKnown ? "1" : "0"}" data-mode="${esc(entry.mode || "")}" data-owner="${esc(entry.owner || "")}" data-group="${esc(entry.group || "")}" aria-label="${escAttr(tr("sftp:auto.select_item", {name:entry.name}))}" onclick="handleSftpCheckboxSelection(event,'${escAttr(fullPath)}','${escAttr(tabKey)}')">
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

const sftpTextEncodingOptions = [
  ["utf8","UTF-8"], ["utf8bom","UTF-8 BOM"], ["gb18030","GB18030"], ["gbk","GBK"],
  ["big5","Big5"], ["shift_jis","Shift_JIS"], ["euc-kr","EUC-KR"], ["latin1","ISO-8859-1"]
];

function sftpTextLineEndingOptions() {
  return [
    ["lf",tr("sftp:editor.line_ending_lf", {defaultValue:"LF (Unix/Linux)"})],
    ["crlf",tr("sftp:editor.line_ending_crlf", {defaultValue:"CRLF (Windows)"})],
    ["cr",tr("sftp:editor.line_ending_cr", {defaultValue:"CR (Classic Mac)"})]
  ];
}

function sftpTextEncodingLabel(value) {
  return sftpTextEncodingOptions.find(([encoding]) => encoding === value)?.[1] || String(value || "UTF-8");
}

function sftpTextLineEnding(value) {
  return ["lf", "crlf", "cr"].includes(value) ? value : "lf";
}

function isSftpUnixScript(title, content="") {
  const basename = String(title || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  if (/\.(?:sh|bash|zsh|ksh|dash|fish)$/.test(basename)) return true;
  if ([".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile", ".kshrc"].includes(basename)) return true;
  return /^\uFEFF?#!/.test(String(content || ""));
}

function prepareSftpEditorSave(title, content, encoding="utf8", lineEnding="lf") {
  const originalContent = String(content || "");
  const originalEncoding = String(encoding || "utf8");
  const unixScript = isSftpUnixScript(title, originalContent);
  const selectedLineEnding = unixScript ? "lf" : sftpTextLineEnding(lineEnding);
  let value = (unixScript ? originalContent.replace(/^\uFEFF/, "") : originalContent).replace(/\r\n|\r|\n/g, "\n");
  if (selectedLineEnding === "crlf") value = value.replace(/\n/g, "\r\n");
  else if (selectedLineEnding === "cr") value = value.replace(/\n/g, "\r");
  if (unixScript && value && !value.endsWith("\n")) value += "\n";
  const selectedEncoding = unixScript && originalEncoding === "utf8bom" ? "utf8" : originalEncoding;
  return {
    content:value,
    encoding:selectedEncoding,
    lineEnding:selectedLineEnding,
    unixScript,
    changed:value !== originalContent || selectedEncoding !== originalEncoding || selectedLineEnding !== sftpTextLineEnding(lineEnding)
  };
}

function sftpEditorByteMeasurement(content, encoding="utf8") {
  const selectedEncoding = String(encoding || "utf8").toLowerCase();
  const exact = selectedEncoding === "utf8" || selectedEncoding === "utf8bom";
  const bytes = new Blob([String(content || "")]).size + (selectedEncoding === "utf8bom" ? 3 : 0);
  return {bytes, exact};
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
  if (value === "plain_text") return tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
  if (value === "ini") return tr("sftp:editor.ini_configuration", {defaultValue:"INI / 配置"});
  return sftpEditorLanguageOptions.find(([mode]) => mode === value)?.[1] || tr("sftp:editor.plain_text", {defaultValue:"纯文本"});
}

function isSftpJsonFileName(name) {
  return String(name || "").split(/[\\/]/).pop().toLowerCase().endsWith(".json");
}

function isSftpImageName(name) {
  return ["png","jpg","jpeg","gif","webp","bmp","ico","svg"].includes(String(name || "").toLowerCase().split(".").pop());
}

function termaAceMessages() {
  const messageKeys = {
    "autocomplete.popup.aria-roledescription":"autocomplete_suggestions",
    "autocomplete.popup.aria-label":"autocomplete_suggestions",
    "autocomplete.popup.item.aria-roledescription":"item",
    "autocomplete.loading":"loading",
    "editor.scroller.aria-roledescription":"editor_role",
    "editor.scroller.aria-label":"editor_content",
    "editor.gutter.aria-roledescription":"gutter_role",
    "editor.gutter.aria-label":"gutter",
    "error-marker.good-state":"looks_good",
    "prompt.recently-used":"recently_used",
    "prompt.other-commands":"other_commands",
    "prompt.no-matching-commands":"no_matching_commands",
    "search-box.find.placeholder":"find_placeholder",
    "search-box.find-all.text":"find_all",
    "search-box.replace.placeholder":"replace_placeholder",
    "search-box.replace-next.text":"replace",
    "search-box.replace-all.text":"replace_all",
    "search-box.toggle-replace.title":"toggle_replace",
    "search-box.toggle-regexp.title":"regexp_search",
    "search-box.toggle-case.title":"case_sensitive",
    "search-box.toggle-whole-word.title":"whole_word",
    "search-box.toggle-in-selection.title":"in_selection",
    "search-box.search-counter":"search_counter",
    "text-input.aria-roledescription":"text_input_role",
    "text-input.aria-label":"cursor_row",
    "gutter.code-folding.range.aria-label":"fold_range",
    "gutter.code-folding.closed.aria-label":"fold_range",
    "gutter.code-folding.open.aria-label":"fold_row",
    "gutter.code-folding.closed.title":"unfold",
    "gutter.code-folding.open.title":"fold",
    "gutter.annotation.aria-label.error":"annotation_error",
    "gutter.annotation.aria-label.warning":"annotation_warning",
    "gutter.annotation.aria-label.info":"annotation_info",
    "inline-fold.closed.title":"unfold",
    "gutter-tooltip.aria-label.error.singular":"error_singular",
    "gutter-tooltip.aria-label.error.plural":"error_plural",
    "gutter-tooltip.aria-label.warning.singular":"warning_singular",
    "gutter-tooltip.aria-label.warning.plural":"warning_plural",
    "gutter-tooltip.aria-label.info.singular":"info_singular",
    "gutter-tooltip.aria-label.info.plural":"info_plural",
    "gutter.annotation.aria-label.security":"annotation_security",
    "gutter.annotation.aria-label.hint":"annotation_hint",
    "gutter-tooltip.aria-label.security.singular":"security_singular",
    "gutter-tooltip.aria-label.security.plural":"security_plural",
    "gutter-tooltip.aria-label.hint.singular":"hint_singular",
    "gutter-tooltip.aria-label.hint.plural":"hint_plural",
    "editor.tooltip.disable-editing":"editing_disabled"
  };
  return Object.fromEntries(Object.entries(messageKeys).map(([aceKey, resourceKey]) => [aceKey, tr(`sftp:ace.${resourceKey}`)]));
}

function syncTermaAceEditorChrome(editor, messages) {
  if (!editor) return;
  const renderer = editor.renderer;
  renderer?.updateFull?.(true);
  if (renderer?.enableKeyboardAccessibility) {
    renderer.scroller?.setAttribute("aria-roledescription", messages["editor.scroller.aria-roledescription"]);
    renderer.scroller?.setAttribute("aria-label", messages["editor.scroller.aria-label"]);
    renderer.$gutter?.setAttribute("aria-roledescription", messages["editor.gutter.aria-roledescription"]);
    renderer.$gutter?.setAttribute("aria-label", messages["editor.gutter.aria-label"]);
    editor.textInput?.setAriaOptions?.({setLabel:true});
  }
  editor.searchBox?.updateCounter?.();
}

function syncTermaAceLocalization(root=document) {
  const messages = termaAceMessages();
  window.ace?.config?.setMessages?.(messages, {placeholders:"dollarSigns"});
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(".ace_search").forEach(search => {
    const findInput = search.querySelector(".ace_search_form .ace_search_field");
    const replaceInput = search.querySelector(".ace_replace_form .ace_search_field");
    if (findInput) findInput.placeholder = messages["search-box.find.placeholder"];
    if (replaceInput) replaceInput.placeholder = messages["search-box.replace.placeholder"];
    const values = [
      ["[action='findAll']", "search-box.find-all.text", "textContent"],
      ["[action='replaceAndFindNext']", "search-box.replace-next.text", "textContent"],
      ["[action='replaceAll']", "search-box.replace-all.text", "textContent"],
      ["[action='toggleReplace']", "search-box.toggle-replace.title", "title"],
      ["[action='toggleRegexpMode']", "search-box.toggle-regexp.title", "title"],
      ["[action='toggleCaseSensitive']", "search-box.toggle-case.title", "title"],
      ["[action='toggleWholeWords']", "search-box.toggle-whole-word.title", "title"],
      ["[action='searchInSelection']", "search-box.toggle-in-selection.title", "title"]
    ];
    values.forEach(([selector, key, property]) => {
      const element = search.querySelector(selector);
      if (element) element[property] = messages[key];
    });
  });
  const hosts = [];
  if (scope?.matches?.(".sftp-code-editor")) hosts.push(scope);
  hosts.push(...scope.querySelectorAll(".sftp-code-editor"));
  hosts.forEach(host => syncTermaAceEditorChrome(host.__termaAceEditor, messages));
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => syncTermaAceLocalization());

function sftpFloatingEditorLayer() {
  let layer = document.querySelector(".sftp-editor-floating-root");
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "sftp-editor-floating-root";
  layer.innerHTML = `<div class="sftp-editor-floating-shelf" role="list"></div>`;
  document.body.appendChild(layer);
  return layer;
}

function refreshSftpFloatingEditorShelfLabels(layer=document.querySelector(".sftp-editor-floating-root")) {
  if (!layer) return;
  const windows = [...layer.querySelectorAll(".sftp-editor-floating-window")];
  const duplicateCounts = windows.reduce((counts, item) => {
    const name = String(item.dataset.fileName || "");
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());
  for (const item of layer.querySelectorAll(".sftp-editor-shelf-item")) {
    const name = String(item.dataset.fileName || "");
    const server = String(item.dataset.serverName || "");
    const label = duplicateCounts.get(name) > 1 && server ? `${server} · ${name}` : name;
    item.title = String(item.dataset.sourceLabel || label);
    item.setAttribute("aria-label", item.title);
    const text = item.querySelector("span");
    if (text) text.textContent = label;
  }
}

function sftpFloatingEditorShelfItem(layer, metadata, restore) {
  const shelf = layer.querySelector(".sftp-editor-floating-shelf");
  if (!shelf) return null;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "sftp-editor-shelf-item";
  item.dataset.fileName = metadata.fileName;
  item.dataset.serverName = metadata.serverName;
  item.dataset.sourceLabel = metadata.sourceLabel;
  item.innerHTML = `${icon("file-code-2")}<span>${esc(metadata.fileName)}</span>`;
  item.onclick = restore;
  shelf.appendChild(item);
  refreshSftpFloatingEditorShelfLabels(layer);
  return item;
}

function sftpTextModal(title, content, size=0, limit=5*1024*1024, encoding="utf8", preferredEncoding="auto", diffOptions={}) {
  return new Promise((resolve) => {
    const floatingLayer = sftpFloatingEditorLayer();
    const modal = document.createElement("div");
    const fileName = String(title || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(title || "");
    const serverName = String(diffOptions.serverName || "");
    const sourceLabel = String(diffOptions.sourceLabel || [serverName, title].filter(Boolean).join(" · "));
    modal.className = "sftp-editor-floating-window";
    modal.dataset.editorId = `sftp-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    modal.dataset.fileName = fileName;
    modal.dataset.serverName = serverName;
    modal.dataset.sourceLabel = sourceLabel;
    floatingLayer.appendChild(modal);
    refreshSftpFloatingEditorShelfLabels(floatingLayer);
    const detectedLanguage = sftpEditorLanguageForFile(title);
    const unixScript = isSftpUnixScript(title, content);
    const scriptNeedsFormatRepair = unixScript && Boolean(
      diffOptions.bom
      || (diffOptions.lineEnding && diffOptions.lineEnding !== "lf")
      || (content && diffOptions.finalNewline === false)
    );
    if (unixScript && encoding === "utf8bom") encoding = "utf8";
    const initialLineEnding = unixScript ? "lf" : sftpTextLineEnding(diffOptions.lineEnding || "lf");
    const wrapEnabled = localStorage.getItem("sftpEditorWordWrap") !== "0";
    let versions = Array.isArray(diffOptions.versions) ? diffOptions.versions.slice(0, 10) : [];
    const historyLoading = typeof diffOptions.loadVersions === "function";
    const historyOptions = versions.length
      ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
      : `<option value="">${esc(tr(historyLoading ? "sftp:editor.loading_backups" : "sftp:editor.no_comparable_backups", {defaultValue:historyLoading ? "正在读取备份..." : "没有可比较的备份"}))}</option>`;
    const initialLines = Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : Math.max(1, String(content || "").split("\n").length);
    const fileLimit = `${tr("sftp:editor.line_count", {count:initialLines, defaultValue:`${initialLines} 行`})} · ${tr("sftp:editor.file_limit", {size:formatBytes(size), limit:formatBytes(limit), defaultValue:`${formatBytes(size)} · 上限 ${formatBytes(limit)}`})}`;
    const searchLabel = tr("sftp:editor.search_text", {defaultValue:"搜索文本"});
    const previousLabel = tr("sftp:editor.search_previous", {defaultValue:"上一个匹配"});
    const nextLabel = tr("sftp:editor.search_next", {defaultValue:"下一个匹配"});
    const minimizeLabel = tr("sftp:editor.minimize", {defaultValue:"最小化"});
    const fullscreenLabel = tr("sftp:editor.fullscreen", {defaultValue:"全屏"});
    const closeLabel = tr("sftp:editor.close", {defaultValue:"关闭"});
    modal.innerHTML = `<div class="modal-card wide sftp-editor-modal floating" role="dialog" aria-modal="false"><div class="sftp-editor-head"><div class="sftp-editor-title"><h2>${esc(fileName)}</h2>${sourceLabel ? `<small class="sftp-editor-source" title="${escAttr(sourceLabel)}">${esc(sourceLabel)}</small>` : ""}<span id="sftpEditorStats">${esc(fileLimit)}</span></div><div class="sftp-editor-head-actions"><div class="sftp-editor-controls"><label>${esc(tr("sftp:editor.text_encoding", {defaultValue:"文本编码"}))}<select id="sftpTextEncoding">${sftpTextEncodingOptions.map(([value,label]) => `<option value="${value}" ${value === encoding ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>${esc(tr("sftp:editor.line_ending", {defaultValue:"换行符"}))}<select id="sftpLineEnding" ${unixScript ? "disabled" : ""}>${sftpTextLineEndingOptions().map(([value,label]) => `<option value="${value}" ${value === initialLineEnding ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label><label>${esc(tr("sftp:editor.language", {defaultValue:"语言"}))}<select id="sftpEditorLanguage"><option value="auto">${esc(tr("sftp:editor.automatic_language", {language:sftpEditorLanguageLabel(detectedLanguage), defaultValue:`自动（${sftpEditorLanguageLabel(detectedLanguage)}）`}))}</option>${sftpEditorLanguageOptions.map(([value]) => `<option value="${value}">${esc(sftpEditorLanguageLabel(value))}</option>`).join("")}</select></label><label class="check-row compact"><input id="sftpEditorWordWrap" type="checkbox" ${wrapEnabled ? "checked" : ""}> ${esc(tr("sftp:editor.word_wrap", {defaultValue:"自动换行"}))}</label></div><div class="sftp-editor-window-controls"><button id="sftpEditorSearchToggle" class="icon-button" type="button" title="${escAttr(searchLabel)}" aria-label="${escAttr(searchLabel)}">${icon("search")}</button><button id="sftpEditorMinimize" class="icon-button" type="button" title="${escAttr(minimizeLabel)}" aria-label="${escAttr(minimizeLabel)}">${icon("minus")}</button><button id="sftpEditorFullscreen" class="icon-button" type="button" title="${escAttr(fullscreenLabel)}" aria-label="${escAttr(fullscreenLabel)}">${icon("maximize")}</button><button id="sftpEditorCloseTop" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div></div></div><div id="sftpEditorWorkspace" class="sftp-editor-workspace"><div id="sftpEditorSearchBar" class="sftp-editor-search-bar" hidden><input id="sftpEditorSearchInput" type="search" placeholder="${escAttr(searchLabel)}" autocomplete="off"><span id="sftpEditorSearchCount" aria-live="polite"></span><button id="sftpEditorSearchPrevious" class="icon-button" type="button" title="${escAttr(previousLabel)}" aria-label="${escAttr(previousLabel)}">${icon("arrow-up")}</button><button id="sftpEditorSearchNext" class="icon-button" type="button" title="${escAttr(nextLabel)}" aria-label="${escAttr(nextLabel)}">${icon("arrow-down")}</button><button id="sftpEditorSearchClose" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div><div id="sftpTextEditor" class="sftp-code-editor" aria-label="${escAttr(tr("sftp:editor.editor_aria", {defaultValue:"SFTP 文本编辑器"}))}"></div><div id="sftpEditorSplit" class="sftp-editor-splitter" role="separator" aria-orientation="horizontal" aria-label="${escAttr(tr("sftp:editor.resize_diff_aria", {defaultValue:"调整编辑与差异区域比例"}))}" tabindex="0" hidden></div><div id="sftpDiffPreview" class="sftp-diff-preview" hidden></div></div><div class="sftp-editor-options"><label class="check-row"><input id="sftpBackupBeforeSave" type="checkbox" checked> ${esc(tr("sftp:editor.backup_before_save", {defaultValue:"保存前备份远程文件"}))}</label><label class="check-row"><input id="sftpPersistEncoding" type="checkbox" ${preferredEncoding === encoding ? "checked" : ""}> ${esc(tr("sftp:editor.persist_encoding", {defaultValue:"设为此连接默认文本编码"}))}</label><label class="sftp-diff-history-control"><span>${esc(tr("sftp:editor.compare_version", {defaultValue:"比较版本"}))}</span><select id="sftpDiffHistory" disabled>${historyOptions}</select><small id="sftpDiffHistoryCount">${esc(historyLoading ? tr("sftp:editor.loading_backups", {defaultValue:"正在读取备份..."}) : tr("sftp:editor.recent_backups", {count:versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`}))}</small></label></div><div class="actions"><button id="sftpTextFormatJson" hidden>${icon("braces")}<span>${esc(tr("sftp:editor.format_json", {defaultValue:"格式化 JSON"}))}</span></button><button id="sftpTextDiff" disabled>${esc(tr("sftp:editor.preview_diff", {defaultValue:"预览差异"}))}</button><button class="primary" id="sftpTextSave">${esc(tr("sftp:editor.save", {defaultValue:"保存"}))} <span class="shortcut-hint">Ctrl+S</span></button><button id="sftpTextClose">${esc(closeLabel)}</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    let finished = false;
    const getEditor = selector => modal.querySelector(selector);
    const titleBox = getEditor(".sftp-editor-title");
    const editorSaveStatus = document.createElement("small");
    editorSaveStatus.className = "sftp-editor-save-status";
    editorSaveStatus.hidden = true;
    titleBox?.appendChild(editorSaveStatus);
    const host = getEditor("#sftpTextEditor");
    const card = modal.querySelector(".sftp-editor-modal");
    let editorShelfItem = null;
    let releaseFloatingEditor = () => {};
    if (card) {
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%,-50%)";
      const minimizeButton = getEditor("#sftpEditorMinimize");
      const fullscreenButton = getEditor("#sftpEditorFullscreen");
      let restoredGeometry = null;
      const nextZIndex = () => {
        const next = Math.max(1, Number(floatingLayer.dataset.editorZIndex || 1) + 1);
        floatingLayer.dataset.editorZIndex = String(next);
        card.style.zIndex = String(next);
      };
      const restoreFloatingEditor = () => {
        card.hidden = false;
        editorShelfItem?.remove();
        editorShelfItem = null;
        refreshSftpFloatingEditorShelfLabels(floatingLayer);
        nextZIndex();
        requestAnimationFrame(() => {
          aceEditor?.resize(true);
          focusEditor();
        });
      };
      minimizeButton.onclick = event => {
        event.stopPropagation();
        card.hidden = true;
        editorShelfItem = sftpFloatingEditorShelfItem(floatingLayer, {fileName, serverName, sourceLabel}, restoreFloatingEditor);
        refreshIcons();
      };
      const syncFullscreen = enabled => {
        if (enabled && !card.classList.contains("is-fullscreen")) {
          const rect = card.getBoundingClientRect();
          restoredGeometry = {left:rect.left, top:rect.top, width:rect.width, height:rect.height};
        }
        card.classList.toggle("is-fullscreen", enabled);
        if (enabled) {
          card.style.removeProperty("left");
          card.style.removeProperty("top");
          card.style.removeProperty("width");
          card.style.removeProperty("height");
          card.style.removeProperty("transform");
        } else if (restoredGeometry) {
          card.style.left = `${restoredGeometry.left}px`;
          card.style.top = `${restoredGeometry.top}px`;
          card.style.width = `${restoredGeometry.width}px`;
          card.style.height = `${restoredGeometry.height}px`;
          card.style.transform = "none";
        } else {
          card.style.left = "50%";
          card.style.top = "50%";
          card.style.transform = "translate(-50%,-50%)";
        }
        const label = tr(enabled ? "sftp:editor.exit_fullscreen" : "sftp:editor.fullscreen", {defaultValue:enabled ? "退出全屏" : "全屏"});
        fullscreenButton.title = label;
        fullscreenButton.setAttribute("aria-label", label);
        fullscreenButton.innerHTML = icon(enabled ? "minimize-2" : "maximize");
        localStorage.setItem("sftpTextEditorFullscreen", enabled ? "1" : "0");
        requestAnimationFrame(() => aceEditor?.resize(true));
      };
      fullscreenButton.onclick = event => {
        event.stopPropagation();
        syncFullscreen(!card.classList.contains("is-fullscreen"));
      };
      card.addEventListener("pointerdown", nextZIndex);
      nextZIndex();
      const dragHandle = getEditor(".sftp-editor-head");
      dragHandle?.classList.add("sftp-editor-drag-handle");
      let dragState = null;
      const clampCard = () => {
        if (card.hidden || card.classList.contains("is-fullscreen")) return;
        const rect = card.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - Math.min(rect.width, window.innerWidth - 16) - 8, rect.left));
        const top = Math.max(8, Math.min(window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8, rect.top));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
      };
      const moveFloatingEditor = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        card.style.left = `${dragState.left + event.clientX - dragState.clientX}px`;
        card.style.top = `${dragState.top + event.clientY - dragState.clientY}px`;
        clampCard();
      };
      const stopFloatingEditorDrag = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        dragState = null;
        document.removeEventListener("pointermove", moveFloatingEditor);
        document.removeEventListener("pointerup", stopFloatingEditorDrag);
        document.removeEventListener("pointercancel", stopFloatingEditorDrag);
      };
      dragHandle?.addEventListener("pointerdown", event => {
        if (event.button !== 0 || card.classList.contains("is-fullscreen") || event.target.closest("button,input,select,label,textarea")) return;
        const rect = card.getBoundingClientRect();
        card.style.transform = "none";
        card.style.left = `${rect.left}px`;
        card.style.top = `${rect.top}px`;
        dragState = {pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, left:rect.left, top:rect.top};
        document.addEventListener("pointermove", moveFloatingEditor);
        document.addEventListener("pointerup", stopFloatingEditorDrag);
        document.addEventListener("pointercancel", stopFloatingEditorDrag);
        event.preventDefault();
      });
      window.addEventListener("resize", clampCard);
      releaseFloatingEditor = () => {
        window.removeEventListener("resize", clampCard);
        document.removeEventListener("pointermove", moveFloatingEditor);
        document.removeEventListener("pointerup", stopFloatingEditorDrag);
        document.removeEventListener("pointercancel", stopFloatingEditorDrag);
        editorShelfItem?.remove();
        editorShelfItem = null;
        refreshSftpFloatingEditorShelfLabels(floatingLayer);
      };
      syncFullscreen(localStorage.getItem("sftpTextEditorFullscreen") === "1");
    }
    const editorWorkspace = getEditor("#sftpEditorWorkspace");
    const diffSplitter = getEditor("#sftpEditorSplit");
    const diffPreview = getEditor("#sftpDiffPreview");
    let aceEditor = null;
    let fallbackEditor = null;
    const useLightEditor = diffOptions.editorKind === "light";
    const lightPageChars = 256 * 1024;
    let lightSource = "";
    let lightPageOffsets = [0, 0];
    let lightPageIndex = 0;
    const lightPageEdits = new Map();
    let lightPager = null;
    const rebuildLightPageOffsets = () => {
      lightPageOffsets = [0];
      let offset = 0;
      while (offset < lightSource.length) {
        let next = Math.min(lightSource.length, offset + lightPageChars);
        if (next < lightSource.length && /[\uD800-\uDBFF]/.test(lightSource.charAt(next - 1)) && /[\uDC00-\uDFFF]/.test(lightSource.charAt(next))) next -= 1;
        lightPageOffsets.push(next);
        offset = next;
      }
      if (lightPageOffsets.length === 1) lightPageOffsets.push(0);
    };
    const lightPageCount = () => Math.max(1, lightPageOffsets.length - 1);
    const lightOriginalPage = index => lightSource.slice(lightPageOffsets[index], lightPageOffsets[index + 1]);
    const lightPageValue = index => lightPageEdits.has(index) ? lightPageEdits.get(index) : lightOriginalPage(index);
    const commitLightPage = () => {
      if (!useLightEditor || !fallbackEditor) return;
      const value = fallbackEditor.value;
      if (value === lightOriginalPage(lightPageIndex)) lightPageEdits.delete(lightPageIndex);
      else lightPageEdits.set(lightPageIndex, value);
    };
    const renderLightPage = index => {
      if (!useLightEditor || !fallbackEditor) return;
      commitLightPage();
      lightPageIndex = Math.max(0, Math.min(lightPageCount() - 1, Number(index || 0)));
      fallbackEditor.value = lightPageValue(lightPageIndex);
      const pageNumber = lightPager?.querySelector("input");
      const pageTotal = lightPager?.querySelector("span");
      const buttons = lightPager?.querySelectorAll("button") || [];
      if (pageNumber) {
        pageNumber.value = String(lightPageIndex + 1);
        pageNumber.max = String(lightPageCount());
      }
      if (pageTotal) pageTotal.textContent = tr("sftp:editor.segment_summary", {count:lightPageCount(), defaultValue:`/ ${lightPageCount()} · 每段最多 256 KB`});
      if (buttons[0]) buttons[0].disabled = lightPageIndex === 0;
      if (buttons[1]) buttons[1].disabled = lightPageIndex >= lightPageCount() - 1;
      fallbackEditor.scrollTop = 0;
      fallbackEditor.scrollLeft = 0;
    };
    const useFallbackEditor = () => {
      fallbackEditor = document.createElement("textarea");
      fallbackEditor.className = "text-editor code-editor";
      fallbackEditor.spellcheck = false;
      if (useLightEditor) {
        lightSource = content;
        rebuildLightPageOffsets();
        const shell = document.createElement("div");
        shell.className = "sftp-light-editor-shell";
        lightPager = document.createElement("div");
        lightPager.className = "sftp-light-editor-pager";
        const previousSegment = tr("sftp:editor.previous_segment", {defaultValue:"上一段"});
        const nextSegment = tr("sftp:editor.next_segment", {defaultValue:"下一段"});
        lightPager.innerHTML = `<button type="button" class="icon-button" title="${escAttr(previousSegment)}" aria-label="${escAttr(previousSegment)}">${icon("chevron-left")}</button><label>${esc(tr("sftp:editor.segment", {defaultValue:"分段"}))} <input type="number" min="1" step="1" aria-label="${escAttr(tr("sftp:editor.current_segment", {defaultValue:"当前分段"}))}"></label><span></span><button type="button" class="icon-button" title="${escAttr(nextSegment)}" aria-label="${escAttr(nextSegment)}">${icon("chevron-right")}</button>`;
        shell.append(fallbackEditor, lightPager);
        host.replaceWith(shell);
        const buttons = lightPager.querySelectorAll("button");
        buttons[0].onclick = () => renderLightPage(lightPageIndex - 1);
        buttons[1].onclick = () => renderLightPage(lightPageIndex + 1);
        lightPager.querySelector("input").onchange = event => renderLightPage(Number(event.target.value || 1) - 1);
        fallbackEditor.value = lightOriginalPage(0);
        renderLightPage(0);
      } else {
        fallbackEditor.value = content;
        host.replaceWith(fallbackEditor);
      }
    };
    if (window.ace?.edit && !useLightEditor) {
      syncTermaAceLocalization();
      ace.config.set("basePath", "/vendor/ace");
      ace.config.set("useStrictCSP", true);
      aceEditor = ace.edit(host);
      host.__termaAceEditor = aceEditor;
      aceEditor.setTheme(document.documentElement.dataset.theme === "dark" ? "ace/theme/tomorrow_night" : "ace/theme/textmate");
      aceEditor.session.setMode(`ace/mode/${detectedLanguage}`);
      aceEditor.session.setUseWrapMode(wrapEnabled);
      aceEditor.setValue(content, -1);
      aceEditor.setOptions({fontSize:"14px", showPrintMargin:false, useSoftTabs:true, tabSize:2, wrapBehavioursEnabled:true});
      const scroller = host.querySelector(".ace_scroller");
      const stylesReady = getComputedStyle(host).position === "relative" && scroller && getComputedStyle(scroller).position === "absolute";
      if (!stylesReady) {
        try { aceEditor.destroy(); } catch {}
        aceEditor = null;
        useFallbackEditor();
      } else requestAnimationFrame(() => aceEditor?.resize(true));
    } else {
      useFallbackEditor();
    }
    content = "";
    const getValue = () => {
      if (aceEditor) return aceEditor.getValue();
      if (!useLightEditor) return fallbackEditor.value;
      commitLightPage();
      if (!lightPageEdits.size) return lightSource;
      const pages = [];
      for (let index = 0; index < lightPageCount(); index += 1) pages.push(lightPageValue(index));
      return pages.join("");
    };
    const setValue = value => {
      if (aceEditor) return aceEditor.setValue(value, -1);
      if (!useLightEditor) return (fallbackEditor.value = value);
      lightSource = String(value || "");
      lightPageEdits.clear();
      lightPageIndex = 0;
      rebuildLightPageOffsets();
      renderLightPage(0);
    };
    const focusEditor = () => aceEditor ? aceEditor.focus() : fallbackEditor.focus();
    const searchBar = getEditor("#sftpEditorSearchBar");
    const searchInput = getEditor("#sftpEditorSearchInput");
    const searchCount = getEditor("#sftpEditorSearchCount");
    let editorSearchQuery = "";
    let editorSearchMatches = [];
    let editorSearchIndex = -1;
    const closeEditorSearch = () => {
      searchBar.hidden = true;
      focusEditor();
    };
    const openEditorSearch = () => {
      searchBar.hidden = false;
      searchInput.focus();
      searchInput.select();
    };
    const editorSearchSource = () => aceEditor ? aceEditor.getValue() : String(fallbackEditor?.value || "");
    const rebuildEditorSearchMatches = () => {
      const query = String(searchInput.value || "");
      if (query === editorSearchQuery) return;
      editorSearchQuery = query;
      editorSearchMatches = [];
      editorSearchIndex = -1;
      if (!query) return;
      const source = editorSearchSource().toLocaleLowerCase();
      const needle = query.toLocaleLowerCase();
      let offset = 0;
      while (editorSearchMatches.length < 10000) {
        const index = source.indexOf(needle, offset);
        if (index < 0) break;
        editorSearchMatches.push(index);
        offset = index + Math.max(1, needle.length);
      }
    };
    const selectEditorSearchMatch = index => {
      const query = String(searchInput.value || "");
      if (!query || index < 0) return;
      const start = editorSearchMatches[index];
      const end = start + query.length;
      if (aceEditor) {
        const Range = ace.require("ace/range").Range;
        const document = aceEditor.session.getDocument();
        const startPosition = document.indexToPosition(start, 0);
        const endPosition = document.indexToPosition(end, 0);
        aceEditor.selection.setRange(new Range(startPosition.row, startPosition.column, endPosition.row, endPosition.column), false);
        aceEditor.scrollToLine(startPosition.row, true, true);
        aceEditor.focus();
      } else {
        fallbackEditor.focus();
        fallbackEditor.setSelectionRange(start, end);
        const line = editorSearchSource().slice(0, start).split("\n").length - 1;
        fallbackEditor.scrollTop = Math.max(0, line * 20 - fallbackEditor.clientHeight / 2);
      }
    };
    const stepEditorSearch = direction => {
      rebuildEditorSearchMatches();
      if (!editorSearchMatches.length) {
        editorSearchIndex = -1;
        searchCount.textContent = searchInput.value ? tr("sftp:editor.search_empty", {defaultValue:"无匹配"}) : "";
        return;
      }
      editorSearchIndex = (editorSearchIndex + direction + editorSearchMatches.length) % editorSearchMatches.length;
      searchCount.textContent = `${editorSearchIndex + 1}/${editorSearchMatches.length}`;
      selectEditorSearchMatch(editorSearchIndex);
    };
    let releaseEditorLayout = () => {};
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onModalKeyDown, true);
      releaseEditorLayout();
      releaseFloatingEditor();
      try { aceEditor?.destroy(); } catch {}
      lightSource = "";
      lightPageEdits.clear();
      modal.remove();
      if (!floatingLayer.querySelector(".sftp-editor-floating-window")) floatingLayer.remove();
      else refreshSftpFloatingEditorShelfLabels(floatingLayer);
      resolve(value);
    };
    const saveButton = getEditor("#sftpTextSave");
    const selectedLanguage = () => getEditor("#sftpEditorLanguage")?.value === "auto" ? detectedLanguage : getEditor("#sftpEditorLanguage")?.value;
    const syncFormatButton = () => {
      getEditor("#sftpTextFormatJson").hidden = useLightEditor || !isSftpJsonFileName(title) || selectedLanguage() !== "json";
    };
    let contentModified = false;
    const updateStats = (force=false, providedValue=null, providedEncoding="") => {
      if (useLightEditor && contentModified && !force) {
        getEditor("#sftpEditorStats").textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        getEditor("#sftpEditorStats").classList.remove("limit-exceeded");
        saveButton.disabled = false;
        return true;
      }
      const initial = !contentModified && providedValue === null;
      const value = initial && useLightEditor ? "" : (providedValue === null ? getValue() : providedValue);
      const measurement = initial
        ? {bytes:Number(size || 0), exact:true}
        : sftpEditorByteMeasurement(value, providedEncoding || getEditor("#sftpTextEncoding")?.value || encoding);
      if (!measurement.exact) {
        const stats = getEditor("#sftpEditorStats");
        stats.textContent = tr("sftp:editor.modified_check_size", {defaultValue:"已修改 · 保存时检查大小"});
        stats.classList.remove("limit-exceeded");
        saveButton.disabled = false;
        return true;
      }
      const bytes = measurement.bytes;
      const tooLarge = bytes > limit;
      const stats = getEditor("#sftpEditorStats");
      const lines = initial && Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : value.split("\n").length;
      const limitSuffix = tooLarge ? tr("sftp:editor.limit_exceeded_suffix", {defaultValue:" · 已超过上限"}) : "";
      stats.textContent = tr("sftp:editor.statistics", {lines, size:formatBytes(bytes), limit:limitSuffix, defaultValue:`${lines} 行 · ${formatBytes(bytes)}${limitSuffix}`});
      stats.classList.toggle("limit-exceeded", tooLarge);
      saveButton.disabled = tooLarge;
      return !tooLarge;
    };
    updateStats();
    syncFormatButton();
    if (aceEditor) {
      aceEditor.session.on("change", () => { contentModified = true; updateStats(); });
      aceEditor.commands.addCommand({name:"saveSftpFile", bindKey:{win:"Ctrl-S",mac:"Command-S"}, exec:()=>saveButton.click()});
    } else fallbackEditor.addEventListener("input", () => {
      if (useLightEditor) {
        commitLightPage();
        contentModified = lightPageEdits.size > 0;
      } else contentModified = true;
      updateStats();
    });
    releaseEditorLayout = bindSftpEditorLayout(card, editorWorkspace, diffSplitter, () => aceEditor?.resize(true));
    const syncHistoryControls = () => {
      const select = getEditor("#sftpDiffHistory");
      const button = getEditor("#sftpTextDiff");
      if (!select || !button) return;
      select.innerHTML = versions.length
        ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
        : `<option value="">${esc(tr("sftp:editor.no_comparable_backups", {defaultValue:"没有可比较的备份"}))}</option>`;
      select.disabled = useLightEditor || !versions.length;
      button.disabled = useLightEditor || !versions.length;
      const count = getEditor("#sftpDiffHistoryCount");
      if (count) count.textContent = tr("sftp:editor.recent_backups", {count:versions.length, defaultValue:`最近 ${versions.length} / 10 个备份`});
    };
    if (historyLoading) {
      Promise.resolve().then(() => diffOptions.loadVersions()).then(result => {
        if (finished) return;
        versions = Array.isArray(result?.versions) ? result.versions.slice(0, 10) : [];
        syncHistoryControls();
      }).catch(() => {
        if (finished) return;
        versions = [];
        syncHistoryControls();
      });
    } else syncHistoryControls();
    if (useLightEditor) {
      getEditor("#sftpEditorLanguage").disabled = true;
      getEditor("#sftpEditorLanguage").title = tr("sftp:editor.light_no_highlight", {defaultValue:"轻量编辑器不加载语法高亮"});
      getEditor("#sftpTextDiff").title = tr("sftp:editor.light_no_diff", {defaultValue:"轻量编辑器为避免占用大量内存，不加载全文差异预览"});
    }
    getEditor("#sftpTextDiff").onclick = async () => {
      if (!versions.length) return notify(tr("sftp:editor.no_history", {defaultValue:"没有可比较的历史备份"}), "info");
      const box = diffPreview;
      setSftpEditorDiffVisible(editorWorkspace, diffSplitter, box, true);
      requestAnimationFrame(() => aceEditor?.resize(true));
      const button = getEditor("#sftpTextDiff");
      const selected = Number(getEditor("#sftpDiffHistory")?.value || 0);
      let comparisonContent = "";
      let oldLabel = tr("sftp:editor.previous_backup", {defaultValue:"上一次备份"});
      if (versions[selected] && typeof diffOptions.loadVersion === "function") {
        button.disabled = true;
        button.classList.add("busy");
        box.innerHTML = `<div class="sftp-diff-unavailable">${icon("loader-circle")} ${esc(tr("sftp:editor.reading_history", {defaultValue:"正在读取历史版本..."}))}</div>`;
        refreshIcons();
        try {
          const version = versions[selected];
          const loaded = await diffOptions.loadVersion(version, encoding);
          comparisonContent = loaded?.content || "";
          oldLabel = tr("sftp:editor.backup_label", {time:sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000), defaultValue:`备份 ${sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000)}`});
        } catch (error) {
          box.innerHTML = `<div class="sftp-diff-unavailable error">${esc(error.message || tr("sftp:editor.history_read_failed", {defaultValue:"历史版本读取失败"}))}</div>`;
          return;
        } finally {
          button.disabled = false;
          button.classList.remove("busy");
        }
      }
      box.innerHTML = sftpDiffViewerHtml(comparisonContent, getValue(), {oldLabel, newLabel:tr("sftp:editor.current_content", {defaultValue:"当前编辑内容"})});
    };
    getEditor("#sftpTextEncoding").onchange = event => {
      const nextEncoding = event.target.value;
      if (contentModified) {
        event.target.value = encoding;
        notify(tr("sftp:editor.switch_encoding_blocked", {defaultValue:"请先保存或放弃当前修改，再切换文本编码"}), "info");
        return;
      }
      finish({action:"encoding", encoding:nextEncoding});
    };
    getEditor("#sftpEditorLanguage").onchange = event => {
      const language = event.target.value === "auto" ? detectedLanguage : event.target.value;
      aceEditor?.session.setMode(`ace/mode/${language}`);
      syncFormatButton();
      focusEditor();
    };
    getEditor("#sftpTextFormatJson").onclick = () => {
      try {
        const parsed = JSON.parse(getValue().replace(/^\uFEFF/, ""));
        setValue(JSON.stringify(parsed, null, 2));
        contentModified = true;
        updateStats();
        focusEditor();
        notify(tr("sftp:editor.json_formatted", {defaultValue:"JSON 已格式化"}), "success");
      } catch (error) {
        notify(tr("sftp:editor.json_error", {error:error.message || error, defaultValue:`JSON 格式错误：${error.message || error}`}), "error");
      }
    };
    getEditor("#sftpEditorWordWrap").onchange = event => {
      localStorage.setItem("sftpEditorWordWrap", event.target.checked ? "1" : "0");
      aceEditor?.session.setUseWrapMode(event.target.checked);
      if (fallbackEditor) fallbackEditor.style.whiteSpace = event.target.checked ? "pre-wrap" : "pre";
      focusEditor();
    };
    getEditor("#sftpEditorSearchToggle").onclick = openEditorSearch;
    getEditor("#sftpEditorSearchPrevious").onclick = () => stepEditorSearch(-1);
    getEditor("#sftpEditorSearchNext").onclick = () => stepEditorSearch(1);
    getEditor("#sftpEditorSearchClose").onclick = closeEditorSearch;
    searchInput.addEventListener("input", () => {
      editorSearchQuery = "";
      stepEditorSearch(1);
    });
    searchInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      stepEditorSearch(event.shiftKey ? -1 : 1);
    });
    getEditor("#sftpTextSave").onclick = async () => {
      const value = getValue();
      const prepared = prepareSftpEditorSave(title, value, getEditor("#sftpTextEncoding").value, getEditor("#sftpLineEnding").value);
      if (!updateStats(true, prepared.content, prepared.encoding)) return notify(tr("sftp:editor.content_too_large", {limit:formatBytes(limit), defaultValue:`在线编辑内容不能超过 ${formatBytes(limit)}`}), "error");
      const payload = {action:"save", content:prepared.content, changed:contentModified || prepared.changed || scriptNeedsFormatRepair, backup:getEditor("#sftpBackupBeforeSave").checked, encoding:prepared.encoding, line_ending:prepared.lineEnding, normalized_script:prepared.unixScript, persist_default:getEditor("#sftpPersistEncoding").checked};
      if (typeof diffOptions.onSave !== "function" || (!payload.changed && !(payload.persist_default && preferredEncoding !== payload.encoding))) return finish(payload);
      saveButton.disabled = true;
      saveButton.classList.add("busy");
      editorSaveStatus.hidden = false;
      editorSaveStatus.classList.remove("error", "success");
      editorSaveStatus.textContent = tr("sftp:editor.saving_remote", {defaultValue:"正在保存到远端..."});
      try {
        const savedResult = await diffOptions.onSave(payload);
        contentModified = false;
        editorSaveStatus.classList.add("success");
        editorSaveStatus.textContent = tr("sftp:editor.saved_remote", {defaultValue:"已保存到远端"});
        finish({...payload, savedResult});
      } catch (error) {
        editorSaveStatus.classList.add("error");
        editorSaveStatus.textContent = tr("sftp:editor.save_waiting_reconnect", {defaultValue:"保存失败，内容仍在窗口中；重连后可再次保存"});
        notify(error.message || tr("sftp:editor.remote_save_failed", {defaultValue:"保存到远端失败，编辑内容已保留"}), "error");
      } finally {
        if (!finished) {
          saveButton.disabled = false;
          saveButton.classList.remove("busy");
        }
      }
    };
    getEditor("#sftpTextClose").onclick = async () => {
      if (contentModified && !await confirmModal(
        tr("sftp:editor.unsaved_confirm", {defaultValue:"当前修改尚未保存，确认关闭？"}),
        tr("sftp:editor.discard_title", {defaultValue:"放弃修改"}),
        tr("sftp:editor.discard", {defaultValue:"放弃修改"}),
        tr("sftp:editor.continue_editing", {defaultValue:"继续编辑"}),
        true
      )) return;
      finish(null);
    };
    getEditor("#sftpEditorCloseTop").onclick = () => getEditor("#sftpTextClose").click();
    const onModalKeyDown = event => {
      if (!modal.contains(event.target) && !modal.contains(document.activeElement)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openEditorSearch();
        return;
      }
      if (event.key === "Escape" && !searchBar.hidden) {
        event.preventDefault();
        closeEditorSearch();
      } else if (event.key === "Escape") getEditor("#sftpTextClose").click();
    };
    document.addEventListener("keydown", onModalKeyDown, true);
    setTimeout(focusEditor, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => diffOptions.onReady?.()));
  });
}

function sftpSvgNumericDimension(value, fallback) {
  const text = String(value || "").trim();
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
  const number = match ? Number(match[1]) : 0;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sftpSvgHasUnsafeCssResource(value) {
  const css = String(value || "");
  if (/@import/i.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!String(match[2] || "").trim().startsWith("#")) return true;
  }
  return false;
}

function sanitizeSftpSvgDocument(markup) {
  const documentNode = new DOMParser().parseFromString(String(markup || ""), "image/svg+xml");
  if (documentNode.querySelector("parsererror")) throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  const root = documentNode.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") throw new Error(tr("sftp:editor.svg_parse_failed", {defaultValue:"SVG 内容无法解析"}));
  root.querySelectorAll("script,foreignObject,iframe,object,embed,video,audio").forEach(node => node.remove());
  [root, ...root.querySelectorAll("*")].forEach(element => {
    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      const embeddedRaster = element.tagName.toLowerCase() === "image" && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
      if (["href", "xlink:href"].includes(name) && value && !value.startsWith("#") && !embeddedRaster) element.removeAttribute(attribute.name);
      if (name === "style" && sftpSvgHasUnsafeCssResource(value)) element.removeAttribute(attribute.name);
    });
  });
  root.querySelectorAll("style").forEach(element => {
    if (sftpSvgHasUnsafeCssResource(element.textContent || "")) element.remove();
  });
  return root;
}

async function previewSftpImage(id, path) {
  let objectUrl = "";
  let modal = null;
  try {
    const blob = await withSftpFileOpenFeedback(id, path, () => readSftpImageWithProgress(id, path));
    if (!blob) return;
    objectUrl = URL.createObjectURL(blob);
    modal = $("modal");
    const closeLabel = tr("sftp:editor.close", {defaultValue:"关闭"});
    const isSvg = /\.svg$/i.test(String(path || "")) || String(blob.type || "").toLowerCase() === "image/svg+xml";
    const searchLabel = tr("sftp:editor.svg_search", {defaultValue:"搜索 SVG 属性或文本"});
    const searchPreviousLabel = tr("sftp:editor.search_previous", {defaultValue:"上一个匹配"});
    const searchNextLabel = tr("sftp:editor.search_next", {defaultValue:"下一个匹配"});
    const zoomOutLabel = tr("sftp:editor.zoom_out", {defaultValue:"缩小"});
    const zoomInLabel = tr("sftp:editor.zoom_in", {defaultValue:"放大"});
    const zoomResetLabel = tr("sftp:editor.zoom_reset", {defaultValue:"适应窗口"});
    modal.innerHTML = `<div class="modal-card wide sftp-image-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(path.split(/[\\/]/).pop() || path)}</h2><span>${esc(formatBytes(blob.size))}</span></div><div class="sftp-image-tools"><button id="sftpImageZoomOut" class="icon-button" type="button" title="${escAttr(zoomOutLabel)}" aria-label="${escAttr(zoomOutLabel)}">${icon("minus")}</button><span id="sftpImageZoomValue" class="sftp-image-zoom-value">100%</span><button id="sftpImageZoomReset" class="icon-button" type="button" title="${escAttr(zoomResetLabel)}" aria-label="${escAttr(zoomResetLabel)}">${icon("maximize-2")}</button><button id="sftpImageZoomIn" class="icon-button" type="button" title="${escAttr(zoomInLabel)}" aria-label="${escAttr(zoomInLabel)}">${icon("plus")}</button>${isSvg ? `<div class="sftp-svg-search"><label><span class="sr-only">${esc(searchLabel)}</span><input id="sftpSvgSearch" type="search" placeholder="${escAttr(searchLabel)}" autocomplete="off"></label><span id="sftpSvgSearchCount" aria-live="polite"></span><button id="sftpSvgSearchPrevious" class="icon-button" type="button" title="${escAttr(searchPreviousLabel)}" aria-label="${escAttr(searchPreviousLabel)}">${icon("arrow-up")}</button><button id="sftpSvgSearchNext" class="icon-button" type="button" title="${escAttr(searchNextLabel)}" aria-label="${escAttr(searchNextLabel)}">${icon("arrow-down")}</button></div>` : ""}<button id="sftpImageClose" class="icon-button" type="button" title="${escAttr(closeLabel)}" aria-label="${escAttr(closeLabel)}">${icon("x")}</button></div></div><div id="sftpImageViewport" class="sftp-image-preview"><div id="sftpImageStageShell" class="sftp-image-stage-shell"><div id="sftpImageStage" class="sftp-image-stage"></div></div></div><div class="actions"><button onclick="downloadSftp(${id},'${escAttr(path)}')">${icon("download")}<span>${esc(tr("sftp:menu.download", {defaultValue:"下载"}))}</span></button><button id="sftpImageCloseBottom">${esc(closeLabel)}</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    const imageCard = modal.querySelector(".sftp-image-modal");
    const fullscreenLabel = tr("sftp:editor.fullscreen", {defaultValue:"全屏"});
    const exitFullscreenLabel = tr("sftp:editor.exit_fullscreen", {defaultValue:"退出全屏"});
    const fullscreenButton = document.createElement("button");
    fullscreenButton.id = "sftpImageFullscreen";
    fullscreenButton.className = "icon-button";
    fullscreenButton.type = "button";
    $("sftpImageClose")?.before(fullscreenButton);
    const syncFullscreen = enabled => {
      imageCard?.classList.toggle("is-fullscreen", enabled);
      fullscreenButton.title = enabled ? exitFullscreenLabel : fullscreenLabel;
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
      fullscreenButton.innerHTML = icon(enabled ? "minimize-2" : "maximize");
      localStorage.setItem("sftpImagePreviewFullscreen", enabled ? "1" : "0");
      refreshIcons();
    };
    syncFullscreen(localStorage.getItem("sftpImagePreviewFullscreen") === "1");
    const viewport = $("sftpImageViewport");
    const shell = $("sftpImageStageShell");
    const stage = $("sftpImageStage");
    let root = null;
    let baseWidth = 1;
    let baseHeight = 1;
    if (isSvg) {
      const sanitizedRoot = sanitizeSftpSvgDocument(await blob.text());
      const viewBox = String(sanitizedRoot.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      const viewX = Number.isFinite(viewBox[0]) ? viewBox[0] : 0;
      const viewY = Number.isFinite(viewBox[1]) ? viewBox[1] : 0;
      const viewWidth = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 1024;
      const viewHeight = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 768;
      baseWidth = sftpSvgNumericDimension(sanitizedRoot.getAttribute("width"), viewWidth);
      baseHeight = sftpSvgNumericDimension(sanitizedRoot.getAttribute("height"), viewHeight);
      if (!sanitizedRoot.getAttribute("height") && sanitizedRoot.getAttribute("width") && viewWidth > 0) baseHeight = baseWidth * viewHeight / viewWidth;
      root = document.importNode(sanitizedRoot, true);
      if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `${viewX} ${viewY} ${viewWidth} ${viewHeight}`);
      root.setAttribute("preserveAspectRatio", root.getAttribute("preserveAspectRatio") || "xMidYMid meet");
      root.removeAttribute("width");
      root.removeAttribute("height");
      root.style.width = `${baseWidth}px`;
      root.style.height = `${baseHeight}px`;
      root.style.display = "block";
      root.style.overflow = "visible";
      root.setAttribute("overflow", "visible");
      const shadow = stage.attachShadow({mode:"open"});
      const previewStyle = document.createElement("style");
      previewStyle.textContent = `.sftp-svg-search-current{filter:drop-shadow(0 0 4px #ff3158) drop-shadow(0 0 8px #ffd43b)}`;
      shadow.append(previewStyle, root);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        let contentBounds = null;
        try {
          contentBounds = root.getBBox({fill:true, stroke:true, markers:true, clipped:false});
        } catch {
          contentBounds = root.getBBox();
        }
        if (contentBounds && Number.isFinite(contentBounds.width) && contentBounds.width > 0 && contentBounds.height > 0) {
          const padding = Math.max(1, Math.min(viewWidth, viewHeight) * .01);
          const minX = Math.min(viewX, contentBounds.x) - padding;
          const minY = Math.min(viewY, contentBounds.y) - padding;
          const maxX = Math.max(viewX + viewWidth, contentBounds.x + contentBounds.width) + padding;
          const maxY = Math.max(viewY + viewHeight, contentBounds.y + contentBounds.height) + padding;
          const expandedWidth = Math.max(1, maxX - minX);
          const expandedHeight = Math.max(1, maxY - minY);
          if (expandedWidth > viewWidth * 1.002 || expandedHeight > viewHeight * 1.002 || minX < viewX || minY < viewY) {
            root.setAttribute("viewBox", `${minX} ${minY} ${expandedWidth} ${expandedHeight}`);
            const displayRatio = Math.max(0.0001, baseWidth / baseHeight);
            const contentRatio = expandedWidth / expandedHeight;
            if (contentRatio > displayRatio) baseHeight = baseWidth / contentRatio;
            else baseWidth = baseHeight * contentRatio;
            root.style.width = `${baseWidth}px`;
            root.style.height = `${baseHeight}px`;
          }
        }
      } catch {}
    } else {
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = path;
      image.draggable = false;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      baseWidth = Math.max(1, Number(image.naturalWidth || 1024));
      baseHeight = Math.max(1, Number(image.naturalHeight || 768));
      image.style.width = `${baseWidth}px`;
      image.style.height = `${baseHeight}px`;
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      stage.appendChild(image);
    }
    stage.style.width = `${baseWidth}px`;
    stage.style.height = `${baseHeight}px`;
    let scale = 1;
    let fitMode = true;
    let svgMatches = [];
    let svgMatchIndex = -1;
    let svgSearchQuery = "";
    const matchMarker = document.createElement("div");
    matchMarker.className = "sftp-svg-match-marker";
    matchMarker.hidden = true;
    shell.appendChild(matchMarker);
    const updateZoom = (next, anchor=null) => {
      if (!Number.isFinite(next) || next <= 0) return;
      const viewportRect = viewport.getBoundingClientRect();
      const anchorX = Number.isFinite(anchor?.clientX) ? anchor.clientX : viewportRect.left + viewport.clientWidth / 2;
      const anchorY = Number.isFinite(anchor?.clientY) ? anchor.clientY : viewportRect.top + viewport.clientHeight / 2;
      const stageRectBefore = stage.getBoundingClientRect();
      const documentX = (anchorX - stageRectBefore.left) / scale;
      const documentY = (anchorY - stageRectBefore.top) / scale;
      scale = Math.max(0.05, next);
      shell.style.width = `${Math.max(1, baseWidth * scale)}px`;
      shell.style.height = `${Math.max(1, baseHeight * scale)}px`;
      stage.style.transform = `scale(${scale})`;
      $("sftpImageZoomValue").textContent = `${Math.round(scale * 100)}%`;
      const stageRectAfter = stage.getBoundingClientRect();
      viewport.scrollLeft += stageRectAfter.left + documentX * scale - anchorX;
      viewport.scrollTop += stageRectAfter.top + documentY * scale - anchorY;
      requestAnimationFrame(() => updateSvgMatchMarker());
    };
    const fit = () => {
      fitMode = true;
      const availableWidth = Math.max(120, viewport.clientWidth - 28);
      const availableHeight = Math.max(120, viewport.clientHeight - 28);
      const nextScale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
      updateZoom(Math.max(0.05, nextScale));
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
        viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
      });
    };
    const svgElementDocumentBounds = element => {
      if (!element?.getBoundingClientRect) return null;
      const stageRect = stage.getBoundingClientRect();
      try {
        if (typeof element.getBBox === "function" && typeof element.getScreenCTM === "function") {
          const box = element.getBBox();
          const matrix = element.getScreenCTM();
          if (matrix && Number.isFinite(box.width) && Number.isFinite(box.height)) {
            const corners = [
              new DOMPoint(box.x, box.y),
              new DOMPoint(box.x + box.width, box.y),
              new DOMPoint(box.x, box.y + box.height),
              new DOMPoint(box.x + box.width, box.y + box.height)
            ].map(point => point.matrixTransform(matrix));
            const left = Math.min(...corners.map(point => point.x));
            const right = Math.max(...corners.map(point => point.x));
            const top = Math.min(...corners.map(point => point.y));
            const bottom = Math.max(...corners.map(point => point.y));
            return {x:(left - stageRect.left) / scale, y:(top - stageRect.top) / scale, width:Math.max(1, (right - left) / scale), height:Math.max(1, (bottom - top) / scale)};
          }
        }
      } catch {}
      const elementRect = element.getBoundingClientRect();
      return {x:(elementRect.left - stageRect.left) / scale, y:(elementRect.top - stageRect.top) / scale, width:Math.max(1, elementRect.width / scale), height:Math.max(1, elementRect.height / scale)};
    };
    const updateSvgMatchMarker = () => {
      if (!root || svgMatchIndex < 0 || !svgMatches[svgMatchIndex]) {
        matchMarker.hidden = true;
        return;
      }
      const bounds = svgElementDocumentBounds(svgMatches[svgMatchIndex]);
      if (!bounds) return;
      const centerX = (bounds.x + bounds.width / 2) * scale;
      const centerY = (bounds.y + bounds.height / 2) * scale;
      const markerSize = 18;
      matchMarker.hidden = false;
      matchMarker.style.left = `${Math.max(0, centerX - markerSize / 2)}px`;
      matchMarker.style.top = `${Math.max(0, centerY - markerSize / 2)}px`;
      matchMarker.style.width = `${markerSize}px`;
      matchMarker.style.height = `${markerSize}px`;
      matchMarker.dataset.match = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const focusSvgMatch = element => {
      const bounds = svgElementDocumentBounds(element);
      if (!bounds) return;
      fitMode = false;
      const targetScale = Math.max(0.05, Math.min(6,
        (viewport.clientWidth * 0.55) / Math.max(bounds.width, 24),
        (viewport.clientHeight * 0.55) / Math.max(bounds.height, 24)
      ));
      updateZoom(targetScale);
      requestAnimationFrame(() => {
        const centerX = (bounds.x + bounds.width / 2) * scale;
        const centerY = (bounds.y + bounds.height / 2) * scale;
        viewport.scrollLeft = Math.max(0, centerX - viewport.clientWidth / 2 + 12);
        viewport.scrollTop = Math.max(0, centerY - viewport.clientHeight / 2 + 12);
        updateSvgMatchMarker();
      });
    };
    const updateSvgSearch = (direction = 1) => {
      if (!root) return;
      const query = String($("sftpSvgSearch")?.value || "").trim().toLowerCase();
      root.querySelectorAll(".sftp-svg-search-current").forEach(element => element.classList.remove("sftp-svg-search-current"));
      if (!query) {
        svgMatches = [];
        svgMatchIndex = -1;
        svgSearchQuery = "";
        $("sftpSvgSearchCount").textContent = "";
        return;
      }
      if (query !== svgSearchQuery) {
        svgSearchQuery = query;
        svgMatchIndex = -1;
        const candidates = [root, ...root.querySelectorAll("*")];
        svgMatches = candidates.filter(element => {
          const attributes = [...element.attributes].map(attribute => `${attribute.name}=${attribute.value}`).join(" ");
          const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || "").join(" ");
          return `${element.tagName} ${attributes} ${directText}`.toLowerCase().includes(query);
        });
      }
      if (!svgMatches.length) {
        svgMatchIndex = -1;
        $("sftpSvgSearchCount").textContent = tr("sftp:editor.svg_search_empty", {defaultValue:"无匹配"});
        return;
      }
      svgMatchIndex = (svgMatchIndex + direction + svgMatches.length) % svgMatches.length;
      const current = svgMatches[svgMatchIndex];
      current.classList.add("sftp-svg-search-current");
      focusSvgMatch(current);
      $("sftpSvgSearchCount").textContent = `${svgMatchIndex + 1}/${svgMatches.length}`;
    };
    const onWheel = event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      fitMode = false;
      updateZoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {clientX:event.clientX, clientY:event.clientY});
    };
    const onKeyDown = event => {
      if (event.key === "Escape") return close();
      if (isSvg && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        $("sftpSvgSearch")?.focus();
        $("sftpSvgSearch")?.select();
      }
      if (isSvg && event.target?.id === "sftpSvgSearch" && event.key === "Enter") {
        event.preventDefault();
        updateSvgSearch(event.shiftKey ? -1 : 1);
      }
    };
    let panState = null;
    const onPanMove = event => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.clientX);
      viewport.scrollTop = panState.scrollTop - (event.clientY - panState.clientY);
    };
    const stopPan = event => {
      if (!panState || event.pointerId !== panState.pointerId) return;
      panState = null;
      viewport.classList.remove("is-panning");
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
    };
    const startPan = event => {
      if (event.button !== 0 || event.target.closest("input,button,label")) return;
      panState = {pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, scrollLeft:viewport.scrollLeft, scrollTop:viewport.scrollTop};
      viewport.classList.add("is-panning");
      document.addEventListener("pointermove", onPanMove);
      document.addEventListener("pointerup", stopPan);
      document.addEventListener("pointercancel", stopPan);
      event.preventDefault();
    };
    let resizeFrame = 0;
    let observedWidth = 0;
    let observedHeight = 0;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const width = Math.round(rect?.width || 0);
      const height = Math.round(rect?.height || 0);
      if (Math.abs(width - observedWidth) < 2 && Math.abs(height - observedHeight) < 2) return;
      observedWidth = width;
      observedHeight = height;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (fitMode) fit();
        else updateSvgMatchMarker();
      });
    }) : null;
    const close = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointermove", onPanMove);
      document.removeEventListener("pointerup", stopPan);
      document.removeEventListener("pointercancel", stopPan);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", startPan);
      resizeObserver?.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      URL.revokeObjectURL(objectUrl);
      modal.hidden = true;
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    viewport.addEventListener("wheel", onWheel, {passive:false});
    viewport.addEventListener("pointerdown", startPan);
    resizeObserver?.observe(imageCard);
    document.addEventListener("keydown", onKeyDown, true);
    $("sftpImageZoomOut").onclick = () => { fitMode = false; updateZoom(scale / 1.25); };
    $("sftpImageZoomIn").onclick = () => { fitMode = false; updateZoom(scale * 1.25); };
    $("sftpImageZoomReset").onclick = fit;
    fullscreenButton.onclick = () => {
      syncFullscreen(!imageCard.classList.contains("is-fullscreen"));
      requestAnimationFrame(() => requestAnimationFrame(() => fitMode ? fit() : updateSvgMatchMarker()));
    };
    $("sftpSvgSearch")?.addEventListener("input", () => { svgMatchIndex = -1; updateSvgSearch(1); });
    $("sftpSvgSearchPrevious")?.addEventListener("click", () => updateSvgSearch(-1));
    $("sftpSvgSearchNext")?.addEventListener("click", () => updateSvgSearch(1));
    $("sftpImageClose").onclick = close;
    $("sftpImageCloseBottom").onclick = close;
    $("sftpImageClose").focus();
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
    notify(error.message || tr("sftp:editor.image_preview_failed", {defaultValue:"图片预览失败"}), "error");
  }
}

async function previewSftpText(id, path) {
  try {
    const editorConnection = connections.find(item => Number(item.id) === Number(id));
    let requestedEncoding = "";
    while (true) {
      const data = await withSftpFileOpenFeedback(id, path, () => readSftpTextWithProgress(id, path, requestedEncoding));
      if (!data) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (data.is_cancelled?.()) return;
      const editorPromise = sftpTextModal(path, data.content || "", data.size || 0, data.limit || 50*1024*1024, data.encoding || "utf8", data.preferred_encoding || "auto", {
        editorKind:data.editor_kind || "ace",
        lineCount:data.line_count,
        lineEnding:data.line_ending,
        finalNewline:data.final_newline,
        bom:data.bom,
        serverName:editorConnection?.name || String(id),
        sourceLabel:`${editorConnection?.name || id} · ${path}`,
        onSave:next => api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, line_ending:next.line_ending, persist_default:next.persist_default})}),
        loadVersions:() => api(`/api/connections/${id}/sftp/versions?path=${encodeURIComponent(path)}&limit=10`).catch(() => ({versions:[]})),
        onReady:() => data.progress?.finish(tr("sftp:editor.opened", {size:formatBytes(data.size || 0), defaultValue:`已打开 · ${formatBytes(data.size || 0)}`})),
        loadVersion:async (version, versionEncoding) => {
          const loaded = await readSftpTextWithProgress(id, version.path, versionEncoding);
          loaded?.progress?.finish(tr("sftp:editor.opened_backup", {size:formatBytes(loaded.size || 0), defaultValue:`已打开备份 · ${formatBytes(loaded.size || 0)}`}));
          return loaded;
        }
      });
      data.content = "";
      const next = await editorPromise;
      if (next === null) return;
      if (next.action === "encoding") {
        requestedEncoding = next.encoding;
        continue;
      }
      if (!next.changed && !(next.persist_default && data.preferred_encoding !== next.encoding)) return notify(tr("sftp:editor.no_changes", {defaultValue:"文件内容没有变化"}), "info");
      const saved = next.savedResult || await api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, line_ending:next.line_ending, persist_default:next.persist_default})});
      const connection = connections.find(item => item.id === id);
      const savedEncoding = saved?.encoding || next.encoding;
      if (connection && next.persist_default) connection.sftp_text_encoding = savedEncoding;
      if (typeof queueSftpDirectoryRefresh === "function") {
        queueSftpDirectoryRefresh(id);
        flushPendingSftpDirectoryRefresh();
      }
      notify(saved?.normalized_script || next.normalized_script
        ? tr("sftp:editor.saved_shell_script", {encoding:sftpTextEncodingLabel(savedEncoding), defaultValue:`脚本已按 ${sftpTextEncodingLabel(savedEncoding)}、Unix LF、无 BOM 保存`})
        : tr("sftp:editor.saved_with_encoding", {encoding:sftpTextEncodingLabel(savedEncoding), defaultValue:`文件已按 ${sftpTextEncodingLabel(savedEncoding)} 保存`}), "success");
      return;
    }
  } catch (error) {
    notify(error.message || tr("sftp:editor.remote_read_failed", {defaultValue:"读取文件失败"}), "error");
  }
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
