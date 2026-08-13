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
  const mountedTabKey = String(view.dataset.sftpTabKey || "");
  if (mountedTabKey && mountedTabKey !== tabKey) {
    const mountedRuntime = sftpTabRuntimes.get(mountedTabKey);
    if (mountedRuntime) {
      rememberSftpViewState(mountedTabKey);
      mountedRuntime.resizeObserver?.disconnect?.();
      if (mountedRuntime.resizeFrame) cancelAnimationFrame(mountedRuntime.resizeFrame);
      mountedRuntime.resizeObserver = null;
      mountedRuntime.resizeFrame = 0;
      mountedRuntime.root = null;
    }
  }
  const mountedShell = view.querySelector(":scope > .sftp-shell");
  const runtime = restoreSftpRuntimeForTab(tabKey, {connectionId, path:remotePath, activate:updateTab || tabKey === activeTabKey});
  const preserveManualDisconnect = sftpTabKeysForConnection(connectionId).some(key => sftpDisconnectedTabs.has(key));
  const c = selectConnection(id);
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
    setWorkspace(title, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:runtime.state.path, connectionStatus:preserveManualDisconnect && !updateTab ? "disconnected" : "connecting", transient:quickConnection, quick_connection:quickConnection});
    syncSftpToolbarPlacement(tabKey);
    if (cached?.viewState) restoreSftpViewState(cached.viewState, tabKey);
    refreshSftpDirectoryActions(tabKey);
    refreshSftpJobs();
    startSftpJobsTimer();
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
    void refreshActiveSftpSessionStatus(tabKey);
    return true;
  }

  const restored = Boolean(cached?.state && String(cached.state.path || ".") === String(remotePath || "."))
    && restoreCachedSftpState(cached, runtime);
  if (!restored) {
    runtime.state = {...runtime.state, connectionId, path:remotePath, entries:[], selected:null, page:1, total:0, totalPages:1, unfilteredTotal:0};
    if (sftpActiveRuntimeKey === tabKey) sftpState = runtime.state;
  }
  const displayPath = restored ? runtime.state.path : remotePath;
  view.innerHTML = `<div class="sftp-shell" data-sftp-tab-key="${escAttr(tabKey)}" ondragenter="handleSftpDragEnter(event,'${escAttr(tabKey)}')" ondragover="handleSftpDragOver(event,'${escAttr(tabKey)}')" ondragleave="handleSftpDragLeave(event,'${escAttr(tabKey)}')" ondrop="handleSftpDrop(event,'${escAttr(tabKey)}')">
    <div class="sftp-top">
      <div id="sftpToolbarMount"><div class="sftp-toolbar">
        <div class="sftp-toolbar-actions">
          <button class="icon-button sftp-action-terminal" title="打开此连接的终端" aria-label="打开此连接的终端" onclick="openTerminal(${id})">${icon("square-terminal")}</button>
          ${quickConnection ? "" : `<button class="icon-button" title="收藏当前目录" aria-label="收藏当前目录" id="sftpFavoriteToggle" onclick="toggleSftpFavorite('${escAttr(tabKey)}')">${icon("star")}</button>`}
          <button class="icon-button" title="新建文件夹" aria-label="新建文件夹" onclick="mkdirSftp('${escAttr(tabKey)}')">${icon("folder-plus")}</button>
          <button class="icon-button" title="新建文件" aria-label="新建文件" onclick="createSftpFile('${escAttr(tabKey)}')">${icon("file-plus-2")}</button>
          <button type="button" class="icon-button" title="上传文件" aria-label="上传文件" onclick="sftpElement('sftpUpload','${escAttr(tabKey)}')?.click()">${icon("upload")}</button>
          <input id="sftpUpload" type="file" multiple onchange="uploadSftpFile('${escAttr(tabKey)}')" hidden>
          <button class="icon-button" title="SFTP 回收站" aria-label="SFTP 回收站" onclick="openSftpRecycleBin('${escAttr(tabKey)}')">${icon("trash-2")}</button>
          <span id="sftpClipboardActions" class="sftp-clipboard-actions">${renderSftpClipboardActions(tabKey)}</span>
          <span class="sftp-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="搜索当前目录" aria-label="搜索当前目录" onclick="toggleSftpSearch('${escAttr(tabKey)}')">${icon("search")}</button>
          ${quickConnection ? `<span id="sftpFilenameEncodingButton" class="sftp-encoding-button" title="临时连接使用 UTF-8 文件名编码">${icon("earth")}<span>UTF-8</span></span>` : `<button id="sftpFilenameEncodingButton" class="sftp-encoding-button" title="切换 SFTP 文件名编码" aria-label="切换 SFTP 文件名编码" onclick="showSftpFilenameEncodingMenu(event,${id})">${icon("earth")}<span>${esc(sftpFilenameEncodingLabel(c))}</span>${icon("chevron-down")}</button>`}
          <button id="sftpConnectionToggle" class="icon-button sftp-connection-toggle" data-status="connecting" title="正在连接 SFTP" aria-label="正在连接 SFTP" onclick="toggleSftpConnection(${id},'${escAttr(tabKey)}')">${icon("loader-circle")}</button>
          <button class="icon-button" title="刷新目录" aria-label="刷新目录" onclick="refreshSftp({tabKey:'${escAttr(tabKey)}'})">${icon("refresh-cw")}</button>
          <button id="sftpGlobalSettingsButton" class="icon-button" title="SFTP 全局设置" aria-label="SFTP 全局设置" onclick="showSftpGlobalSettings()">${icon("settings")}</button>
        </div>
      </div></div>
      <div class="sftp-navigation-row">
        <div class="sftp-navigation-actions">
          <button id="sftpHistoryBack" class="icon-button" title="上一步" aria-label="上一步" onclick="navigateSftpHistory(-1,'${escAttr(tabKey)}')">${icon("arrow-left")}</button>
          <button id="sftpHistoryForward" class="icon-button" title="下一步" aria-label="下一步" onclick="navigateSftpHistory(1,'${escAttr(tabKey)}')">${icon("arrow-right")}</button>
          <button class="icon-button" title="上一级" aria-label="上一级" onclick="navigateSftpPath(parentRemotePath(sftpTabRuntimes.get('${escAttr(tabKey)}')?.state.path),'${escAttr(tabKey)}')">${icon("corner-left-up")}</button>
        </div>
        <div class="sftp-path-block">
          <nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径" ondblclick="showSftpPathEditor('${escAttr(tabKey)}')">${sftpBreadcrumbHtml(id, displayPath, tabKey)}</nav>
          <form id="sftpPathEditor" class="sftp-path-editor" hidden onsubmit="submitSftpPath(event,'${escAttr(tabKey)}')"><input id="sftpPathInput" aria-label="远程目录路径" value="${esc(displayPath)}"><button type="submit" class="icon-button" title="转到路径" aria-label="转到路径">${icon("corner-down-left")}</button><button type="button" class="icon-button" title="取消" aria-label="取消" onclick="hideSftpPathEditor('${escAttr(tabKey)}')">${icon("x")}</button></form>
        </div>
        <div class="sftp-navigation-end-actions">
          <button id="sftpPathEditButton" class="icon-button sftp-path-edit-button" title="手动输入目录" aria-label="手动输入目录" onclick="showSftpPathEditor('${escAttr(tabKey)}')">${icon("pencil")}</button>
          <button id="sftpMobileToolbarToggle" class="icon-button sftp-mobile-toolbar-toggle" type="button" title="展开操作按钮" aria-label="展开操作按钮" aria-controls="sftpToolbarMount" aria-expanded="false" onclick="toggleSftpMobileToolbar('${escAttr(tabKey)}')">${icon("chevron-down")}</button>
        </div>
      </div>
      <div id="sftpFavorites" class="sftp-favorites${sftpFavorites.some(item => item.connectionId === id) ? "" : " is-empty"}">${renderSftpFavorites(id, tabKey)}</div>
      <div id="sftpConnectionBanner" class="sftp-connection-banner" hidden>
        <div>${icon("link-2-off")}<span><strong>SFTP 连接已断开</strong><small class="sftp-connection-detail">当前目录仍保留，可重新连接后继续操作。</small></span></div>
        <button onclick="reconnectSftpConnection(${id},{tabKey:'${escAttr(tabKey)}'})">${icon("link-2")}<span>重新连接</span></button>
      </div>
      <div class="sftp-selection-bar" id="sftpSelectionBar" hidden>
        <div class="sftp-selected" id="sftpSelectedInfo">已选择 0 项</div>
        <div class="sftp-selection-actions">
          <button onclick="copySftpSelection('copy','${escAttr(tabKey)}')">${icon("copy")}<span>复制</span></button>
          <button onclick="copySftpSelection('move','${escAttr(tabKey)}')">${icon("folder-input")}<span>移动</span></button>
          <button onclick="downloadSftpSelection('${escAttr(tabKey)}')">${icon("download")}<span>下载</span></button>
          ${window.termaDesktop ? `<button onclick="sendSftpSelectionToDesktop('${escAttr(tabKey)}')">${icon("monitor-down")}<span>发送到桌面</span></button>` : ""}
          <button id="sftpSelectionCompress" onclick="compressSftpSelection('${escAttr(tabKey)}')">${icon("archive")}<span>压缩</span></button>
          <button id="sftpSelectionPermissions" onclick="openSftpPermissionsForSelection(null,'${escAttr(tabKey)}')">${icon("key-round")}<span>权限</span></button>
          <button id="sftpSelectionExtract" onclick="extractSftpSelection('${escAttr(tabKey)}')" hidden>${icon("archive-restore")}<span>解压</span></button>
          <button class="danger" onclick="deleteSftpSelection('${escAttr(tabKey)}')">${icon("trash-2")}<span>删除</span></button>
          <button class="icon-button" title="取消选择" aria-label="取消选择" onclick="clearSftpSelection('${escAttr(tabKey)}')">${icon("x")}</button>
        </div>
      </div>
    </div>
    <div id="sftpList" class="sftp-list" oncontextmenu="showSftpDirectoryMenu(event,'${escAttr(tabKey)}')">${restored ? "" : stateView("loading", "正在读取目录", displayPath)}</div>
    <div id="sftpDropOverlay" class="sftp-drop-overlay" data-mode="upload" aria-hidden="true" hidden></div>
    <div id="sftpFloatingSearch" class="sftp-floating-search" hidden aria-busy="false"><span class="sftp-search-status-icon" title="搜索">${icon("search")}${icon("loader-circle")}</span><input id="sftpSearch" placeholder="搜索当前目录" value="${esc(runtime.state.query)}" oninput="setSftpSearch(this.value,'${escAttr(tabKey)}')"><button class="icon-button" title="清除搜索" aria-label="清除搜索" onclick="clearSftpSearch('${escAttr(tabKey)}')">${icon("x")}</button><label class="sftp-search-recursive"><input type="checkbox" ${runtime.state.recursiveSearch ? "checked" : ""} onchange="setSftpRecursiveSearch(this.checked,'${escAttr(tabKey)}')"><span>搜索子目录</span></label></div>
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
  setWorkspace(title, sftpConnectionAddress(c), "sftp", tabKey, updateTab, true, {kind:"sftp", id:c.id, path:displayPath, connectionStatus:preserveManualDisconnect && !updateTab ? "disconnected" : "connecting", transient:quickConnection, quick_connection:quickConnection});
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
      if (!keepContents) list.innerHTML = stateView("loading", "正在读取目录", remotePath);
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
    updateSftpConnectionUi(id, "disconnected", error.message || "SFTP 连接已断开");
    const mountedList = sftpElement("sftpList", tabKey);
    if (mountedList && runtime.root?.dataset.sftpTabKey === tabKey) {
      if (keepContents) {
        if (!silent) notify(error.message || "目录同步失败", "error");
      } else {
        mountedList.innerHTML = stateView("error", "目录加载失败", error.message, `<button onclick="refreshSftp({tabKey:'${escAttr(tabKey)}'})">重试</button>`);
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
  const syncIndicator = `<div class="sftp-refresh-indicator" role="status">${icon("loader-circle")}<span>正在同步</span></div>`;
  const headColumns = sftpOrderedColumnHtml({
    name:sftpHeaderColumnHtml("name", tabKey, sortMark("name", tabKey)),
    size:sftpHeaderColumnHtml("size", tabKey, sortMark("size", tabKey)),
    mtime:sftpHeaderColumnHtml("mtime", tabKey, sortMark("mtime", tabKey)),
    access:sftpHeaderColumnHtml("access", tabKey)
  });
  const head = `<div class="sftp-head"><label class="sftp-head-check"><input id="sftpSelectAll" type="checkbox" aria-label="选择当前页全部项目" onchange="toggleSftpAll(this.checked,'${escAttr(tabKey)}')"></label>${headColumns}<span class="sftp-head-actions">操作</span>${syncIndicator}</div>`;
  const rows = entries.map(entry => {
    const fullPath = joinRemotePath(state.path, entry.name);
    const isDir = entry.type === "dir";
    const metadataKnown = entry.metadata_known !== false;
    const isLink = Boolean(entry.is_symlink);
    const linkDescription = !isLink
      ? entry.name
      : entry.link_target_missing
        ? `${entry.name} · 符号链接目标不存在`
        : isDir
          ? `${entry.name} · 符号链接到目录`
          : `${entry.name} · 符号链接目标 ${formatBytes(entry.size)}（链接本身 ${formatBytes(entry.link_size || 0)}）`;
    const mobileType = isLink ? (isDir ? "链接目录" : "链接文件") : (isDir ? "目录" : "");
    const active = state.selected?.path === fullPath;
    const columns = sftpOrderedColumnHtml({
      name:`<button class="sftp-name sftp-column-name" title="${esc(linkDescription)}" onclick="event.stopPropagation(); selectSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')"><span class="sftp-icon ${entry.type} ${sftpFileKind(entry.name)} ${isLink ? "symlink" : ""}">${sftpIcon(entry.name, isDir)}</span><span class="sftp-name-copy"><span class="sftp-file-name">${esc(entry.name)}</span><span class="sftp-mobile-meta">${mobileType ? `${mobileType} · ` : ""}${isDir ? "" : `${formatBytes(entry.size)} · `}${entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span></span></button>`,
      size:`<span class="sftp-size sftp-column-size">${!metadataKnown ? "--" : isDir ? sftpDirectorySizeButtonHtml(id, fullPath) : formatBytes(entry.size)}</span>`,
      mtime:`<span class="sftp-time sftp-column-mtime">${metadataKnown && entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span>`,
      access:`<span class="sftp-access sftp-column-access" title="${metadataKnown ? `权限 ${escAttr(entry.mode || "未知")}；所有者 ${escAttr(entry.owner || "未知")}；用户组 ${escAttr(entry.group || "未知")}` : "递归搜索结果未读取详细元数据"}"><code>${metadataKnown ? esc(entry.mode || "---") : "--"}</code><span>${metadataKnown ? esc(entry.owner || "未知") : "路径索引"}</span></span>`
    });
    return `<div class="sftp-row ${active ? "active" : ""}" draggable="${isMobileLayout() ? "false" : "true"}" onclick="selectSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondblclick="activateSftpEntry(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" oncontextmenu="showSftpEntryMenu(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" onpointerdown="primeSftpNativeDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondragstart="beginSftpItemDrag(event, ${id}, '${escAttr(fullPath)}', '${escAttr(entry.name)}', '${escAttr(entry.type)}','${escAttr(tabKey)}')" ondragend="finishSftpItemDrag(event)">
      <input class="sftp-check" type="checkbox" value="${esc(fullPath)}" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" data-mtime="${Math.max(0, Number(entry.mtime || 0))}" data-metadata-known="${metadataKnown ? "1" : "0"}" data-mode="${esc(entry.mode || "")}" data-owner="${esc(entry.owner || "")}" data-group="${esc(entry.group || "")}" aria-label="选择 ${esc(entry.name)}" onclick="handleSftpCheckboxSelection(event,'${escAttr(fullPath)}','${escAttr(tabKey)}')">
      ${columns}
      <div class="sftp-row-actions">${sftpRowActionsHtml(id, fullPath, entry.name, entry.type, tabKey)}</div>
    </div>`;
  }).join("");
  const page = Number(state.page || 1);
  const totalPages = Number(state.totalPages || 1);
  const total = Number(state.total || 0);
  const first = total ? (page - 1) * Number(state.pageSize || 50) + 1 : 0;
  const last = total ? Math.min(first + entries.length - 1, total) : 0;
  const pageSizes = [25,50,100,200].map(size => `<option value="${size}" ${size === Number(state.pageSize) ? "selected" : ""}>${size} 项</option>`).join("");
  const recursiveSummary = state.query && state.recursiveSearch ? ` · 子目录${state.recursiveSearchTruncated ? "（结果已截断）" : ""}` : "";
  const filterSummary = state.query && Number(state.unfilteredTotal || 0) !== total ? ` · 范围共 ${Number(state.unfilteredTotal || 0)} 项${recursiveSummary}` : recursiveSummary;
  const pager = `<div class="sftp-pager-dock"><div class="pager sftp-pager"><button onclick="setSftpPage(${page - 1},'${escAttr(tabKey)}')" ${page <= 1 ? "disabled" : ""}>上一页</button><span class="pager-count"><span class="sftp-scroll-cue" title="下方还有文件" aria-hidden="true">${icon("chevron-down")}</span>第 ${page}/${totalPages} 页 · ${first}-${last} / ${total}${filterSummary} · <select aria-label="每页数量" onchange="setSftpPageSize(this.value,'${escAttr(tabKey)}')">${pageSizes}</select></span><button onclick="setSftpPage(${page + 1},'${escAttr(tabKey)}')" ${page >= totalPages ? "disabled" : ""}>下一页</button></div></div>`;
  list.innerHTML = head + (rows || stateView("empty", state.query ? "没有匹配的文件" : "当前目录为空", state.query ? "换一个关键词试试。" : "可以上传文件或新建目录。")) + pager;
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
  return new Date(Number(value) * 1000).toLocaleString("zh-CN", {hour12:false});
}

function sftpDiffHtml(oldText, newText) {
  return sftpDiffViewerHtml(oldText, newText);
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

function isSftpJsonFileName(name) {
  return String(name || "").split(/[\\/]/).pop().toLowerCase().endsWith(".json");
}

function isSftpImageName(name) {
  return ["png","jpg","jpeg","gif","webp","bmp","ico","svg"].includes(String(name || "").toLowerCase().split(".").pop());
}

function sftpTextModal(title, content, size=0, limit=5*1024*1024, encoding="utf8", preferredEncoding="auto", diffOptions={}) {
  return new Promise((resolve) => {
    const modal = $("modal");
    const detectedLanguage = sftpEditorLanguageForFile(title);
    const wrapEnabled = localStorage.getItem("sftpEditorWordWrap") !== "0";
    let versions = Array.isArray(diffOptions.versions) ? diffOptions.versions.slice(0, 10) : [];
    const historyLoading = typeof diffOptions.loadVersions === "function";
    const historyOptions = versions.length
      ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
      : `<option value="">${historyLoading ? "正在读取备份..." : "没有可比较的备份"}</option>`;
    modal.innerHTML = `<div class="modal-card wide sftp-editor-modal" role="dialog" aria-modal="true"><div class="sftp-editor-head"><div><h2>${esc(title)}</h2><span>${esc(formatBytes(size))} · 上限 ${esc(formatBytes(limit))}</span></div><div class="sftp-editor-controls"><label>文本编码<select id="sftpTextEncoding">${sftpTextEncodingOptions.map(([value,label]) => `<option value="${value}" ${value === encoding ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>语言<select id="sftpEditorLanguage"><option value="auto">自动（${esc(sftpEditorLanguageLabel(detectedLanguage))}）</option>${sftpEditorLanguageOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label class="check-row compact"><input id="sftpEditorWordWrap" type="checkbox" ${wrapEnabled ? "checked" : ""}> 自动换行</label><span id="sftpEditorStats"></span></div></div><div id="sftpEditorWorkspace" class="sftp-editor-workspace"><div id="sftpTextEditor" class="sftp-code-editor" aria-label="SFTP 文本编辑器"></div><div id="sftpEditorSplit" class="sftp-editor-splitter" role="separator" aria-orientation="horizontal" aria-label="调整编辑与差异区域比例" tabindex="0" hidden></div><div id="sftpDiffPreview" class="sftp-diff-preview" hidden></div></div><div class="sftp-editor-options"><label class="check-row"><input id="sftpBackupBeforeSave" type="checkbox" checked> 保存前备份远程文件</label><label class="check-row"><input id="sftpPersistEncoding" type="checkbox" ${preferredEncoding === encoding ? "checked" : ""}> 设为此连接默认文本编码</label><label class="sftp-diff-history-control"><span>比较版本</span><select id="sftpDiffHistory" disabled>${historyOptions}</select><small id="sftpDiffHistoryCount">${historyLoading ? "正在读取备份" : `最近 ${versions.length} / 10 个备份`}</small></label></div><div class="actions"><button id="sftpTextFormatJson" hidden>${icon("braces")}<span>格式化 JSON</span></button><button id="sftpTextDiff" disabled>预览差异</button><button class="primary" id="sftpTextSave">保存 <span class="shortcut-hint">Ctrl+S</span></button><button id="sftpTextClose">关闭</button></div></div>`;
    modal.hidden = false;
    modal.onclick = null;
    let finished = false;
    const host = $("sftpTextEditor");
    const card = modal.querySelector(".sftp-editor-modal");
    const editorWorkspace = $("sftpEditorWorkspace");
    const diffSplitter = $("sftpEditorSplit");
    const diffPreview = $("sftpDiffPreview");
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
      if (pageTotal) pageTotal.textContent = `/ ${lightPageCount()} · 每段最多 256 KB`;
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
        lightPager.innerHTML = `<button type="button" class="icon-button" title="上一段" aria-label="上一段">${icon("chevron-left")}</button><label>分段 <input type="number" min="1" step="1" aria-label="当前分段"></label><span></span><button type="button" class="icon-button" title="下一段" aria-label="下一段">${icon("chevron-right")}</button>`;
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
      ace.config.set("basePath", "/vendor/ace");
      ace.config.set("useStrictCSP", true);
      aceEditor = ace.edit(host);
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
    let releaseEditorLayout = () => {};
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onModalKeyDown, true);
      releaseEditorLayout();
      try { aceEditor?.destroy(); } catch {}
      lightSource = "";
      lightPageEdits.clear();
      modal.hidden = true;
      resolve(value);
    };
    const saveButton = $("sftpTextSave");
    const selectedLanguage = () => $("sftpEditorLanguage")?.value === "auto" ? detectedLanguage : $("sftpEditorLanguage")?.value;
    const syncFormatButton = () => {
      $("sftpTextFormatJson").hidden = useLightEditor || !isSftpJsonFileName(title) || selectedLanguage() !== "json";
    };
    let contentModified = false;
    const updateStats = (force=false, providedValue=null) => {
      if (useLightEditor && contentModified && !force) {
        $("sftpEditorStats").textContent = "已修改 · 保存时检查大小";
        return true;
      }
      const initial = !contentModified;
      const value = initial && useLightEditor ? "" : (providedValue === null ? getValue() : providedValue);
      const bytes = initial ? Number(size || 0) : new Blob([value]).size;
      const tooLarge = bytes > limit;
      const stats = $("sftpEditorStats");
      const lines = initial && Number(diffOptions.lineCount) > 0 ? Number(diffOptions.lineCount) : value.split("\n").length;
      stats.textContent = `${lines} 行 · ${formatBytes(bytes)}${tooLarge ? " · 已超过上限" : ""}`;
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
      const select = $("sftpDiffHistory");
      const button = $("sftpTextDiff");
      if (!select || !button) return;
      select.innerHTML = versions.length
        ? versions.map((version, index) => `<option value="${index}">${esc(sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000))} · ${esc(formatBytes(version.size || 0))}</option>`).join("")
        : `<option value="">没有可比较的备份</option>`;
      select.disabled = useLightEditor || !versions.length;
      button.disabled = useLightEditor || !versions.length;
      const count = $("sftpDiffHistoryCount");
      if (count) count.textContent = `最近 ${versions.length} / 10 个备份`;
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
      $("sftpEditorLanguage").disabled = true;
      $("sftpEditorLanguage").title = "轻量编辑器不加载语法高亮";
      $("sftpTextDiff").title = "轻量编辑器为避免占用大量内存，不加载全文差异预览";
    }
    $("sftpTextDiff").onclick = async () => {
      if (!versions.length) return notify("没有可比较的历史备份", "info");
      const box = diffPreview;
      setSftpEditorDiffVisible(editorWorkspace, diffSplitter, box, true);
      requestAnimationFrame(() => aceEditor?.resize(true));
      const button = $("sftpTextDiff");
      const selected = Number($("sftpDiffHistory")?.value || 0);
      let comparisonContent = "";
      let oldLabel = "上一次备份";
      if (versions[selected] && typeof diffOptions.loadVersion === "function") {
        button.disabled = true;
        button.classList.add("busy");
        box.innerHTML = `<div class="sftp-diff-unavailable">${icon("loader-circle")} 正在读取历史版本...</div>`;
        refreshIcons();
        try {
          const version = versions[selected];
          const loaded = await diffOptions.loadVersion(version, encoding);
          comparisonContent = loaded?.content || "";
          oldLabel = `备份 ${sftpDiffDisplayTime(version.changed_at || Number(version.mtime || 0) * 1000)}`;
        } catch (error) {
          box.innerHTML = `<div class="sftp-diff-unavailable error">${esc(error.message || "历史版本读取失败")}</div>`;
          return;
        } finally {
          button.disabled = false;
          button.classList.remove("busy");
        }
      }
      box.innerHTML = sftpDiffViewerHtml(comparisonContent, getValue(), {oldLabel, newLabel:"当前编辑内容"});
    };
    $("sftpTextEncoding").onchange = event => {
      const nextEncoding = event.target.value;
      if (contentModified) {
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
        contentModified = true;
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
      const value = getValue();
      if (!updateStats(true, value)) return notify(`在线编辑内容不能超过 ${formatBytes(limit)}`, "error");
      finish({action:"save", content:value, changed:contentModified, backup:$("sftpBackupBeforeSave").checked, encoding:$("sftpTextEncoding").value, persist_default:$("sftpPersistEncoding").checked});
    };
    $("sftpTextClose").onclick = async () => {
      if (contentModified && !await confirmModal("当前修改尚未保存，确认关闭？", "放弃修改", "放弃修改", "继续编辑", true)) return;
      finish(null);
    };
    const onModalKeyDown = event => {
      if (event.key === "Escape") $("sftpTextClose").click();
    };
    document.addEventListener("keydown", onModalKeyDown, true);
    setTimeout(focusEditor, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => diffOptions.onReady?.()));
  });
}

async function previewSftpImage(id, path) {
  try {
    const blob = await withSftpFileOpenFeedback(id, path, async () => {
      return readSftpImageWithProgress(id, path);
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
      const data = await withSftpFileOpenFeedback(id, path, () => readSftpTextWithProgress(id, path, requestedEncoding));
      if (!data) return;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (data.is_cancelled?.()) return;
      const editorPromise = sftpTextModal(path, data.content || "", data.size || 0, data.limit || 50*1024*1024, data.encoding || "utf8", data.preferred_encoding || "auto", {
        editorKind:data.editor_kind || "ace",
        lineCount:data.line_count,
        loadVersions:() => api(`/api/connections/${id}/sftp/versions?path=${encodeURIComponent(path)}&limit=10`).catch(() => ({versions:[]})),
        onReady:() => data.progress?.finish(`已打开 · ${formatBytes(data.size || 0)}`),
        loadVersion:async (version, versionEncoding) => {
          const loaded = await readSftpTextWithProgress(id, version.path, versionEncoding);
          loaded?.progress?.finish(`已打开备份 · ${formatBytes(loaded.size || 0)}`);
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
      if (!next.changed && !(next.persist_default && data.preferred_encoding !== next.encoding)) return notify("文件内容没有变化", "info");
      await api(`/api/connections/${id}/sftp/write`, {method:"POST", body:JSON.stringify({path, content:next.content, backup:next.backup, encoding:next.encoding, persist_default:next.persist_default})});
      const connection = connections.find(item => item.id === id);
      if (connection && next.persist_default) connection.sftp_text_encoding = next.encoding;
      if (typeof queueSftpDirectoryRefresh === "function") {
        queueSftpDirectoryRefresh(id);
        flushPendingSftpDirectoryRefresh();
      }
      notify(`文件已按 ${sftpTextEncodingLabel(next.encoding)} 保存`, "success");
      return;
    }
  } catch (error) {
    notify(error.message || "读取文件失败", "error");
  }
}

function toggleSftpAll(checked, tabKey=activeTabKey) {
  sftpElements(".sftp-check", tabKey).forEach(input => { input.checked = checked; });
  updateSftpSelection(tabKey);
}

function updateSftpSelection(tabKey=activeTabKey) {
  const inputs = sftpElements(".sftp-check", tabKey);
  const count = inputs.filter(input => input.checked).length;
  const box = sftpElement("sftpSelectedInfo", tabKey);
  const bar = sftpElement("sftpSelectionBar", tabKey);
  const selectAll = sftpElement("sftpSelectAll", tabKey);
  const extract = sftpElement("sftpSelectionExtract", tabKey);
  const compress = sftpElement("sftpSelectionCompress", tabKey);
  const permissions = sftpElement("sftpSelectionPermissions", tabKey);
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
