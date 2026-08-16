const LOCAL_FILES_DRAG_MIME = "application/x-terma-local-files";
const LOCAL_FILES_COMPUTER_PATH = "::computer::";
const localFileRuntimes = new Map();
const localDeliveryJobTargets = new Map();
let localFileTabSerial = 0;
let localFileInternalDrag = null;
let localFileInternalDragHandoff = null;
const LOCAL_FILES_DRAG_HANDOFF_TTL_MS = 4000;

function localFilesAvailable() {
  return Boolean(window.termaDesktop);
}

function localFilesEntryDisplayName(entry) {
  const rawName = String(entry?.name || "");
  if (entry?.type !== "drive") return rawName;
  const localDisk = rawName.match(/^本地磁盘\s*\(([A-Za-z]:)\)$/);
  if (localDisk) return tr("sftp:local_files.local_disk", {drive:localDisk[1], defaultValue:`本地磁盘 (${localDisk[1]})`});
  const fileSystem = rawName.match(/^文件系统\s*(\([^)]*\))$/);
  if (fileSystem) return tr("sftp:local_files.file_system", {root:fileSystem[1], defaultValue:`文件系统 ${fileSystem[1]}`});
  return rawName;
}

function localFilesRoot(tabKey) {
  return typeof workspaceElementForTab === "function"
    ? workspaceElementForTab(tabKey, "#view-local-files")
    : document.querySelector(`#view-local-files[data-workspace-tab-key="${CSS.escape(String(tabKey || ""))}"]`) || $("view-local-files");
}

function localFilesRuntime(tabKey) {
  const key = String(tabKey || "");
  if (!localFileRuntimes.has(key)) {
    localFileRuntimes.set(key, {path:"", location:"directory", displayPath:"", parent:"", parentKind:"none", entries:[], page:1, pageSize:50, total:0, totalPages:1, query:"", sort:"name", dir:"asc", activePath:"", anchorPath:"", loaded:false, scrollTop:0, scrollAtBottom:false, navigation:{paths:[], index:-1}});
  }
  return localFileRuntimes.get(key);
}

function localDeliveryPathKey(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function trackLocalDeliveryJobTarget(job, tabKey, directory) {
  const id = String(job?.id || "");
  if (!id || !tabKey) return;
  localDeliveryJobTargets.set(id, {tabKey:String(tabKey), directory:String(directory || "")});
}

function refreshLocalFilesForDeliveryJob(job) {
  const id = String(job?.id || "");
  const registered = id ? localDeliveryJobTargets.get(id) : null;
  if (id) localDeliveryJobTargets.delete(id);
  if (!job || !["done", "failed", "cancelled"].includes(String(job.status || ""))) return;
  const targets = registered ? [registered] : [...localFileRuntimes.entries()]
    .filter(([, runtime]) => localDeliveryPathKey(runtime?.path) === localDeliveryPathKey(job.target_directory))
    .map(([tabKey, runtime]) => ({tabKey, directory:runtime.path}));
  if (job.status !== "done") return;
  for (const target of targets) {
    const runtime = localFileRuntimes.get(String(target.tabKey || ""));
    if (!runtime || localDeliveryPathKey(runtime.path) !== localDeliveryPathKey(job.target_directory)) continue;
    void loadLocalFiles(String(target.tabKey), {path:runtime.path, location:runtime.location, page:runtime.page, refresh:true});
  }
}

function localFilesToolbarButtonHtml(tabKey="") {
  if (!localFilesAvailable()) return "";
  const label = tr("navigation:auto.new_local_files_tab", {defaultValue:"新建本地文件标签"});
  return `<button type="button" class="icon-button local-files-open-button" title="${escAttr(label)}" aria-label="${escAttr(label)}" data-action="local-files-new-tab" data-tab-key="${escAttr(tabKey)}">${icon("hard-drive")}</button>`;
}

function showNewLocalFilesMenu(event) {
  if (!localFilesAvailable()) return notify(tr("sftp:local_files.desktop_only", {defaultValue:"本地文件只支持桌面端"}), "info");
  const actions = [{label:tr("navigation:auto.new_tab", {defaultValue:"新建标签"}), icon:"file-plus-2", run:()=>openLocalFilesInPlacement("")}];
  if (!isMobileLayout() && typeof applyWorkspaceTabDrop === "function") {
    actions.push(
      {separator:true},
      {label:tr("navigation:auto.new_split_left", {defaultValue:"向左分屏新建"}), icon:"panel-left", run:()=>openLocalFilesInPlacement("left")},
      {label:tr("navigation:auto.new_split_right", {defaultValue:"向右分屏新建"}), icon:"panel-right", run:()=>openLocalFilesInPlacement("right")},
      {label:tr("navigation:auto.new_split_top", {defaultValue:"向上分屏新建"}), icon:"panel-top", run:()=>openLocalFilesInPlacement("top")},
      {label:tr("navigation:auto.new_split_bottom", {defaultValue:"向下分屏新建"}), icon:"panel-bottom", run:()=>openLocalFilesInPlacement("bottom")}
    );
  }
  showActionMenu(event, actions);
}

async function openLocalFilesInPlacement(splitZone="") {
  const sourcePane = typeof workspaceFindPaneForTab === "function"
    ? workspaceFindPaneForTab(activeTabKey) || workspaceFindPane(focusedPaneId)
    : null;
  const sourceActiveTabKey = sourcePane?.activeTabKey || activeTabKey;
  const sourceScrollLeft = sourcePane
    ? Number(workspacePaneElement(sourcePane.id)?.querySelector(".tabs")?.scrollLeft || 0)
    : 0;
  const key = await openLocalFiles("", true);
  if (key && splitZone && sourcePane && typeof applyWorkspaceTabDrop === "function") {
    applyWorkspaceTabDrop({key}, {paneId:sourcePane.id, zone:splitZone});
    const remainingPane = workspaceFindPane(sourcePane.id);
    if (remainingPane?.tabs.includes(sourceActiveTabKey)) {
      remainingPane.activeTabKey = sourceActiveTabKey;
      renderTabs();
      renderWorkspacePaneContent(remainingPane.id);
      const sourceTabs = workspacePaneElement(remainingPane.id)?.querySelector(".tabs");
      if (sourceTabs) sourceTabs.scrollLeft = sourceScrollLeft;
      revealWorkspaceTab(sourceActiveTabKey);
    }
  }
  return key;
}

async function openLocalFiles(requestedPath="", updateTab=true, existingKey="") {
  if (!localFilesAvailable()) {
    notify(tr("sftp:local_files.desktop_only_detail", {defaultValue:"本地文件只支持在 Terma 桌面端使用"}), "info");
    return "";
  }
  const key = existingKey || `local-files-${Date.now()}-${++localFileTabSerial}`;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const runtime = localFilesRuntime(key);
  const storedPath = requestedPath || tab?.path || runtime.path || "";
  const computer = storedPath === LOCAL_FILES_COMPUTER_PATH || tab?.localLocation === "computer" || runtime.location === "computer";
  const pathValue = computer ? "" : storedPath;
  const workspaceTitle = tr("sftp:local_files.title", {defaultValue:"本地文件"});
  const computerLabel = tr("sftp:local_files.this_computer", {defaultValue:"此电脑"});
  const systemDesktopLabel = tr("sftp:local_files.system_desktop", {defaultValue:"系统桌面"});
  const view = $("view-local-files");
  const mountedShell = view?.dataset.workspaceTabKey === key && view.querySelector(".local-files-shell");
  const mountedPathMatches = computer
    ? runtime.location === "computer"
    : runtime.location === "directory" && localDeliveryPathKey(runtime.path) === localDeliveryPathKey(pathValue);
  if (mountedShell && runtime.loaded && mountedPathMatches) {
    setWorkspace(workspaceTitle, runtime.displayPath || (computer ? computerLabel : pathValue || systemDesktopLabel), "local-files", key, updateTab, true, {
      kind:"local-files",
      path:computer ? LOCAL_FILES_COMPUTER_PATH : pathValue,
      localLocation:computer ? "computer" : "directory"
    });
    syncLocalFilesNavigationButtons(key);
    syncLocalFilesCreateButtons(key);
    return key;
  }
  runtime.location = computer ? "computer" : "directory";
  view.dataset.workspaceTabKey = key;
  view.innerHTML = `<div class="local-files-shell" data-local-files-tab-key="${escAttr(key)}" data-tab-key="${escAttr(key)}" data-dragover-action="local-files-drag-over" data-dragleave-action="local-files-drag-leave" data-drop-action="local-files-drop">
    <div class="local-files-top">
      <div class="local-files-toolbar">
        <div class="local-files-toolbar-actions">
          <button class="icon-button local-files-history-back" title="${escAttr(tr("sftp:local_files.history_back", {defaultValue:"后退"}))}" aria-label="${escAttr(tr("sftp:local_files.history_back", {defaultValue:"后退"}))}" data-action="local-files-history" data-history-direction="-1" data-tab-key="${escAttr(key)}" disabled>${icon("arrow-left")}</button>
          <button class="icon-button local-files-history-forward" title="${escAttr(tr("sftp:local_files.history_forward", {defaultValue:"前进"}))}" aria-label="${escAttr(tr("sftp:local_files.history_forward", {defaultValue:"前进"}))}" data-action="local-files-history" data-history-direction="1" data-tab-key="${escAttr(key)}" disabled>${icon("arrow-right")}</button>
          <button class="icon-button local-files-parent" title="${escAttr(tr("sftp:auto.parent_directory", {defaultValue:"上一级"}))}" aria-label="${escAttr(tr("sftp:auto.parent_directory", {defaultValue:"上一级"}))}" data-action="local-files-parent" data-tab-key="${escAttr(key)}">${icon("corner-left-up")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="${escAttr(tr("sftp:local_files.desktop", {defaultValue:"桌面"}))}" aria-label="${escAttr(tr("sftp:local_files.desktop", {defaultValue:"桌面"}))}" data-action="local-files-location" data-location="desktop" data-tab-key="${escAttr(key)}">${icon("monitor")}</button>
          <button class="icon-button" title="${escAttr(tr("sftp:local_files.downloads", {defaultValue:"下载目录"}))}" aria-label="${escAttr(tr("sftp:local_files.downloads", {defaultValue:"下载目录"}))}" data-action="local-files-location" data-location="downloads" data-tab-key="${escAttr(key)}">${icon("download")}</button>
          <button class="icon-button" title="${escAttr(tr("sftp:local_files.home", {defaultValue:"用户主目录"}))}" aria-label="${escAttr(tr("sftp:local_files.home", {defaultValue:"用户主目录"}))}" data-action="local-files-location" data-location="home" data-tab-key="${escAttr(key)}">${icon("home")}</button>
          <button class="icon-button" title="${escAttr(tr("common:auto.refresh", {defaultValue:"刷新"}))}" aria-label="${escAttr(tr("common:auto.refresh", {defaultValue:"刷新"}))}" data-action="local-files-refresh" data-tab-key="${escAttr(key)}">${icon("refresh-cw")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button local-files-create-directory" title="${escAttr(tr("common:auto.new_folder", {defaultValue:"新建文件夹"}))}" aria-label="${escAttr(tr("common:auto.new_folder", {defaultValue:"新建文件夹"}))}" data-action="local-files-create" data-entry-kind="dir" data-tab-key="${escAttr(key)}" ${computer ? "disabled" : ""}>${icon("folder-plus")}</button>
          <button class="icon-button local-files-create-file" title="${escAttr(tr("common:auto.new_file", {defaultValue:"新建文件"}))}" aria-label="${escAttr(tr("common:auto.new_file", {defaultValue:"新建文件"}))}" data-action="local-files-create" data-entry-kind="file" data-tab-key="${escAttr(key)}" ${computer ? "disabled" : ""}>${icon("file-plus-2")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="${escAttr(tr("navigation:auto.new_local_files_tab", {defaultValue:"新建本地文件标签"}))}" aria-label="${escAttr(tr("navigation:auto.new_local_files_tab", {defaultValue:"新建本地文件标签"}))}" data-action="local-files-new-tab" data-tab-key="${escAttr(key)}">${icon("plus")}</button>
        </div>
      </div>
      <div class="local-files-search-wrap">
        <div class="local-files-search">${icon("search")}<input aria-label="${escAttr(tr("sftp:auto.search_current", {defaultValue:"搜索当前目录"}))}" placeholder="${escAttr(tr("sftp:auto.search_current", {defaultValue:"搜索当前目录"}))}" value="${esc(runtime.query)}" data-input-action="local-files-search" data-tab-key="${escAttr(key)}"><button type="button" class="icon-button" title="${escAttr(tr("sftp:auto.clear_search", {defaultValue:"清除搜索"}))}" aria-label="${escAttr(tr("sftp:auto.clear_search", {defaultValue:"清除搜索"}))}" data-action="local-files-search-clear" data-tab-key="${escAttr(key)}">${icon("x")}</button></div>
      </div>
      <div class="local-files-navigation-row">
        <div class="local-files-path-block">
          <nav class="local-files-breadcrumb" aria-label="${escAttr(tr("sftp:local_files.path", {defaultValue:"本地目录路径"}))}" data-dblclick-action="local-files-path-edit" data-tab-key="${escAttr(key)}">${localFilesBreadcrumbHtml(runtime, key)}</nav>
          <form class="local-files-path-editor" hidden data-submit-action="local-files-path-submit" data-tab-key="${escAttr(key)}"><input aria-label="${escAttr(tr("sftp:local_files.path", {defaultValue:"本地目录路径"}))}" value="${esc(pathValue)}" placeholder="${escAttr(tr("sftp:local_files.path", {defaultValue:"本地目录路径"}))}"><button class="icon-button" type="submit" title="${escAttr(tr("sftp:auto.go_to_path", {defaultValue:"转到路径"}))}" aria-label="${escAttr(tr("sftp:auto.go_to_path", {defaultValue:"转到路径"}))}">${icon("corner-down-left")}</button><button type="button" class="icon-button" title="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}" aria-label="${escAttr(tr("common:actions.cancel", {defaultValue:"取消"}))}" data-action="local-files-path-cancel" data-tab-key="${escAttr(key)}">${icon("x")}</button></form>
        </div>
        <button class="icon-button local-files-path-edit-button" title="${escAttr(tr("sftp:auto.enter_path", {defaultValue:"手动输入目录"}))}" aria-label="${escAttr(tr("sftp:auto.enter_path", {defaultValue:"手动输入目录"}))}" data-action="local-files-path-edit" data-tab-key="${escAttr(key)}">${icon("pencil")}</button>
      </div>
      <div class="local-files-selection" hidden><strong>${esc(tr("sftp:local_files.selected_prefix", {defaultValue:"已选择"}))} <span>0</span> ${esc(tr("sftp:local_files.selected_suffix", {defaultValue:"项"}))}</strong><div class="local-files-selection-actions"><button type="button" data-local-files-single-action title="${escAttr(tr("common:auto.open", {defaultValue:"打开"}))}" aria-label="${escAttr(tr("common:auto.open", {defaultValue:"打开"}))}" data-action="local-files-selection-open" data-tab-key="${escAttr(key)}">${icon("folder-open")}<span>${esc(tr("common:auto.open", {defaultValue:"打开"}))}</span></button><button type="button" title="${escAttr(tr("common:auto.upload_to_sftp", {defaultValue:"上传到 SFTP"}))}" aria-label="${escAttr(tr("common:auto.upload_to_sftp", {defaultValue:"上传到 SFTP"}))}" data-action="local-files-selection-upload" data-tab-key="${escAttr(key)}">${icon("upload")}<span>${esc(tr("sftp:local_files.upload_short", {defaultValue:"上传"}))}</span></button><button type="button" title="${escAttr(tr("common:auto.copy_path", {defaultValue:"复制路径"}))}" aria-label="${escAttr(tr("common:auto.copy_path", {defaultValue:"复制路径"}))}" data-action="local-files-selection-copy" data-tab-key="${escAttr(key)}">${icon("clipboard")}<span>${esc(tr("sftp:local_files.path_short", {defaultValue:"路径"}))}</span></button><button type="button" data-local-files-single-action title="${escAttr(tr("common:auto.rename", {defaultValue:"重命名"}))}" aria-label="${escAttr(tr("common:auto.rename", {defaultValue:"重命名"}))}" data-action="local-files-selection-rename" data-tab-key="${escAttr(key)}">${icon("pencil")}<span>${esc(tr("common:auto.rename", {defaultValue:"重命名"}))}</span></button><button type="button" title="${escAttr(tr("common:actions.delete", {defaultValue:"删除"}))}" aria-label="${escAttr(tr("common:actions.delete", {defaultValue:"删除"}))}" class="danger" data-action="local-files-selection-delete" data-tab-key="${escAttr(key)}">${icon("trash-2")}<span>${esc(tr("common:actions.delete", {defaultValue:"删除"}))}</span></button><button type="button" data-local-files-single-action title="${escAttr(tr("sftp:menu.permissions", {defaultValue:"设置权限"}))}" aria-label="${escAttr(tr("sftp:menu.permissions", {defaultValue:"设置权限"}))}" data-action="local-files-selection-chmod" data-tab-key="${escAttr(key)}">${icon("key-round")}<span>${esc(tr("sftp:local_files.permissions_short", {defaultValue:"权限"}))}</span></button><button class="icon-button" title="${escAttr(tr("sftp:local_files.clear_selection", {defaultValue:"取消选择"}))}" aria-label="${escAttr(tr("sftp:local_files.clear_selection", {defaultValue:"取消选择"}))}" data-action="local-files-selection-clear" data-tab-key="${escAttr(key)}">${icon("x")}</button></div></div>
    </div>
    <div class="local-files-list" data-contextmenu-action="local-files-directory-menu" data-tab-key="${escAttr(key)}">${stateView("loading", tr("sftp:local_files.loading_directory", {defaultValue:"正在读取本地目录"}), computer ? computerLabel : pathValue || systemDesktopLabel)}</div>
    <div class="local-files-drop-overlay" hidden>${icon("download")}<strong>${esc(tr("sftp:local_files.drop_save_current", {defaultValue:"松开保存到当前本地目录"}))}</strong></div>
  </div>`;
  setWorkspace(workspaceTitle, computer ? computerLabel : pathValue || systemDesktopLabel, "local-files", key, updateTab, true, {kind:"local-files", path:computer ? LOCAL_FILES_COMPUTER_PATH : pathValue, localLocation:computer ? "computer" : "directory"});
  try {
    await loadLocalFiles(key, computer ? {location:"computer", page:runtime.page} : {path:pathValue, page:runtime.page});
    return key;
  } catch (error) {
    notify(error.message || tr("sftp:local_files.read_failed", {defaultValue:"读取本地目录失败"}), "error");
    return key;
  }
}

async function loadLocalFiles(tabKey, options={}) {
  const runtime = localFilesRuntime(tabKey);
  const root = localFilesRoot(tabKey);
  const list = root?.querySelector(".local-files-list");
  if (!root || !list) return;
  const requestedPath = options.path !== undefined ? options.path : runtime.path;
  const location = options.location || (requestedPath === LOCAL_FILES_COMPUTER_PATH ? "computer" : runtime.location);
  const sameLocation = location === runtime.location && (location === "computer" || localDeliveryPathKey(requestedPath) === localDeliveryPathKey(runtime.path));
  const preserveScroll = options.preserveScroll === true || (options.refresh === true && sameLocation);
  const scrollPosition = options.scrollPosition || (preserveScroll ? captureLocalFilesScrollPosition(tabKey, list) : null);
  const computerLabel = tr("sftp:local_files.this_computer", {defaultValue:"此电脑"});
  const systemDesktopLabel = tr("sftp:local_files.system_desktop", {defaultValue:"系统桌面"});
  const displayRequest = location === "computer" ? computerLabel : requestedPath || systemDesktopLabel;
  const params = new URLSearchParams({
    page:String(options.page || runtime.page || 1),
    page_size:String(runtime.pageSize || 50),
    query:String(runtime.query || ""),
    sort:String(runtime.sort || "name"),
    dir:String(runtime.dir || "asc")
  });
  if (location === "computer") params.set("location", "computer");
  else params.set("path", String(requestedPath || ""));
  if (!options.refresh) list.innerHTML = stateView("loading", tr("sftp:local_files.loading_directory", {defaultValue:"正在读取本地目录"}), displayRequest);
  const data = await api(`/api/local-files?${params.toString()}`);
  Object.assign(runtime, {
    path:data.path || "",
    location:data.kind === "computer" ? "computer" : "directory",
    displayPath:data.kind === "computer" ? computerLabel : data.display_path || data.path || "",
    entries:data.entries || [],
    page:Number(data.page || 1),
    pageSize:Number(data.page_size || 50),
    total:Number(data.total || 0),
    totalPages:Number(data.total_pages || 1),
    parent:data.parent || "",
    parentKind:data.parent_kind || "none",
    loaded:true
  });
  if (!runtime.entries.some(entry => String(entry.path) === String(runtime.activePath || ""))) runtime.activePath = "";
  if (!options.historyNavigation) rememberLocalFilesNavigation(tabKey);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  if (tab) {
    tab.path = runtime.location === "computer" ? LOCAL_FILES_COMPUTER_PATH : runtime.path;
    tab.localLocation = runtime.location;
    tab.subtitle = runtime.displayPath || (runtime.location === "computer" ? computerLabel : runtime.path);
  }
  const pathInput = root.querySelector(".local-files-path-editor input");
  if (pathInput) pathInput.value = runtime.path;
  const breadcrumb = root.querySelector(".local-files-breadcrumb");
  if (breadcrumb) breadcrumb.innerHTML = localFilesBreadcrumbHtml(runtime, tabKey);
  if (tabKey === activeTabKey) $("workspaceSubtitle").textContent = runtime.displayPath || (runtime.location === "computer" ? computerLabel : runtime.path);
  syncLocalFilesNavigationButtons(tabKey);
  syncLocalFilesCreateButtons(tabKey);
  renderLocalFiles(tabKey, {scrollPosition});
  saveTabsState();
}

function captureLocalFilesScrollPosition(tabKey, list=localFilesRoot(tabKey)?.querySelector(".local-files-list")) {
  const runtime = localFilesRuntime(tabKey);
  if (!list) return {top:Number(runtime.scrollTop || 0), atBottom:Boolean(runtime.scrollAtBottom)};
  const maximum = Math.max(0, Number(list.scrollHeight || 0) - Number(list.clientHeight || 0));
  const top = Math.max(0, Math.min(maximum, Number(list.scrollTop || 0)));
  const position = {top, atBottom:maximum - top <= 2};
  runtime.scrollTop = position.top;
  runtime.scrollAtBottom = position.atBottom;
  return position;
}

function captureLocalFilesScrollAnchor(tabKey, list=localFilesRoot(tabKey)?.querySelector(".local-files-list")) {
  const position = captureLocalFilesScrollPosition(tabKey, list);
  if (!list?.querySelectorAll) return position;
  const listTop = Number(list.getBoundingClientRect?.().top || 0);
  const row = [...list.querySelectorAll(".local-files-row[data-path]")]
    .find(item => Number(item.getBoundingClientRect?.().bottom || 0) > listTop + 1);
  if (!row) return position;
  return {
    ...position,
    anchorPath:String(row.dataset.path || ""),
    anchorOffset:Number(row.getBoundingClientRect?.().top || listTop) - listTop
  };
}

function restoreLocalFilesScrollPosition(tabKey, position, list=localFilesRoot(tabKey)?.querySelector(".local-files-list")) {
  if (!list || !position) return;
  const anchor = position.anchorPath && list.querySelector
    ? list.querySelector(`.local-files-row[data-path="${CSS.escape(String(position.anchorPath))}"]`)
    : null;
  if (anchor) {
    const listTop = Number(list.getBoundingClientRect?.().top || 0);
    list.scrollTop = Math.max(0, Number(list.scrollTop || 0) + Number(anchor.getBoundingClientRect?.().top || listTop) - listTop - Number(position.anchorOffset || 0));
  } else {
    const maximum = Math.max(0, Number(list.scrollHeight || 0) - Number(list.clientHeight || 0));
    list.scrollTop = Math.max(0, Math.min(maximum, Number(position.top || 0)));
  }
  captureLocalFilesScrollPosition(tabKey, list);
  syncLocalFilesScrollCue(list);
}

function renderLocalFiles(tabKey, options={}) {
  const runtime = localFilesRuntime(tabKey);
  const root = localFilesRoot(tabKey);
  const list = root?.querySelector(".local-files-list");
  if (!list) return;
  const sortMark = key => runtime.sort === key ? (runtime.dir === "asc" ? "↑" : "↓") : "";
  const columns = ["name", "size", "mtime"];
  const headColumns = typeof localFilesHeaderColumnHtml === "function"
    ? columns.map(key => localFilesHeaderColumnHtml(key, tabKey, sortMark(key))).join("")
    : columns.map(key => {
      const label = key === "name"
        ? tr("sftp:auto.name", {defaultValue:"名称"})
        : key === "size"
          ? tr("sftp:auto.size", {defaultValue:"大小"})
          : tr("sftp:auto.modified", {defaultValue:"修改时间"});
      return `<button data-action="local-files-sort" data-sort="${key}" data-tab-key="${escAttr(tabKey)}">${esc(label)}${sortMark(key) ? ` ${sortMark(key)}` : ""}</button>`;
    }).join("");
  const head = `<div class="local-files-head"><label><input type="checkbox" aria-label="${escAttr(tr("sftp:auto.select_page", {defaultValue:"选择当前页全部项目"}))}" data-change-action="local-files-select-all" data-tab-key="${escAttr(tabKey)}"></label>${headColumns}</div>`;
  const rows = runtime.entries.map(entry => {
    const isDrive = entry.type === "drive";
    const isDir = isDrive || entry.type === "dir";
    const displayName = localFilesEntryDisplayName(entry);
    const iconMarkup = isDrive ? icon("hard-drive") : sftpIcon(entry.name, isDir);
    const sizeText = isDrive && entry.size
      ? tr("common:local_files.available_space", {free:formatBytes(entry.free || 0), total:formatBytes(entry.size), defaultValue:`${formatBytes(entry.free || 0)} 可用 / ${formatBytes(entry.size)}`})
      : (isDir ? "--" : formatBytes(entry.size));
    const mobileMeta = isDrive
      ? sizeText
      : [isDir ? tr("sftp:auto.directory", {defaultValue:"目录"}) : sizeText, entry.mtime ? formatSftpTime(entry.mtime) : ""].filter(Boolean).join(" · ");
    const active = String(runtime.activePath || "") === String(entry.path);
    return `<div class="local-files-row ${isDrive ? "is-drive" : ""} ${active ? "active" : ""}" draggable="${isMobileLayout() || isDrive ? "false" : "true"}" data-path="${escAttr(entry.path)}" data-entry-type="${escAttr(entry.type)}" data-tab-key="${escAttr(tabKey)}" data-action="local-files-entry-select" data-dblclick-action="local-files-entry-activate" data-contextmenu-action="local-files-entry-menu" data-dragstart-action="local-files-entry-drag-start" data-dragend-action="local-files-entry-drag-end">
      <input class="local-files-check" type="checkbox" value="${escAttr(entry.path)}" data-name="${escAttr(entry.name)}" data-type="${escAttr(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" data-path="${escAttr(entry.path)}" data-tab-key="${escAttr(tabKey)}" data-action="local-files-entry-checkbox" data-i18n-skip aria-label="${escAttr(tr("common:local_files.select_entry", {name:displayName, defaultValue:`选择 ${displayName}`}))}" ${isDrive ? "disabled" : ""}>
      <button class="local-files-name" data-action="local-files-entry-select-stop" data-path="${escAttr(entry.path)}" data-tab-key="${escAttr(tabKey)}"><span class="sftp-icon ${isDrive ? "drive" : entry.type}">${iconMarkup}</span><span class="local-files-name-copy"><span class="local-files-file-name" data-i18n-skip>${esc(displayName)}</span><span class="local-files-mobile-meta">${esc(mobileMeta)}</span></span></button>
      <span class="local-files-size" title="${escAttr(sizeText)}">${esc(sizeText)}</span><span class="local-files-time">${entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span>
    </div>`;
  }).join("");
  const page = Number(runtime.page || 1), totalPages = Number(runtime.totalPages || 1), total = Number(runtime.total || 0);
  const first = total ? (page - 1) * Number(runtime.pageSize || 50) + 1 : 0;
  const last = total ? Math.min(first + runtime.entries.length - 1, total) : 0;
  const pageSummary = tr("sftp:auto.page_summary", {page, pages:totalPages, first, last, total, defaultValue:`第 ${page}/${totalPages} 页 · ${first}-${last} / ${total} ·`});
  const pager = `<div class="sftp-pager-dock"><div class="pager sftp-pager"><button data-action="local-files-page" data-page="${page - 1}" data-tab-key="${escAttr(tabKey)}" ${page <= 1 ? "disabled" : ""}>${esc(tr("sftp:auto.previous_page", {defaultValue:"上一页"}))}</button><span class="pager-count"><span class="sftp-scroll-cue" title="${escAttr(tr("sftp:auto.more_below", {defaultValue:"下方还有文件"}))}" aria-hidden="true">${icon("chevron-down")}</span>${esc(pageSummary)} <select aria-label="${escAttr(tr("sftp:auto.page_size", {defaultValue:"每页数量"}))}" data-change-action="local-files-page-limit" data-tab-key="${escAttr(tabKey)}">${[25,50,100,200].map(size => `<option value="${size}" ${size === Number(runtime.pageSize) ? "selected" : ""}>${esc(tr("sftp:auto.item_count", {count:size, defaultValue:`${size} 项`}))}</option>`).join("")}</select></span><button data-action="local-files-page" data-page="${page + 1}" data-tab-key="${escAttr(tabKey)}" ${page >= totalPages ? "disabled" : ""}>${esc(tr("sftp:auto.next_page", {defaultValue:"下一页"}))}</button></div></div>`;
  list.innerHTML = head + (rows || stateView("empty", runtime.query ? tr("common:local_files.no_matches", {defaultValue:"没有匹配的本地文件"}) : tr("sftp:auto.empty_directory", {defaultValue:"当前目录为空"}), runtime.path)) + pager;
  if (typeof bindLocalFilesColumnControls === "function") bindLocalFilesColumnControls(list);
  watchLocalFilesListLayout(list, tabKey);
  updateLocalFilesSelection(tabKey);
  restoreLocalFilesScrollPosition(tabKey, options.scrollPosition, list);
}

function localFileChecks(tabKey) {
  return [...(localFilesRoot(tabKey)?.querySelectorAll(".local-files-check") || [])];
}

function selectedLocalFiles(tabKey) {
  return localFileChecks(tabKey).filter(input => input.checked && !input.disabled).map(input => ({
    path:input.value,
    name:input.dataset.name || "",
    type:input.dataset.type || "file",
    size:Number(input.dataset.size || 0)
  }));
}

function updateLocalFilesSelection(tabKey) {
  const root = localFilesRoot(tabKey);
  const runtime = localFilesRuntime(tabKey);
  const selected = selectedLocalFiles(tabKey);
  const selectedPaths = new Set(selected.map(item => String(item.path)));
  const selectable = localFileChecks(tabKey).filter(input => !input.disabled);
  if (runtime.activePath && !selectedPaths.has(String(runtime.activePath))) runtime.activePath = "";
  root?.querySelectorAll(".local-files-row").forEach(row => {
    const pathValue = String(row.dataset.path || "");
    row.classList.toggle("is-selected", selectedPaths.has(pathValue));
    row.classList.toggle("active", Boolean(runtime.activePath) && pathValue === runtime.activePath);
  });
  const selectAll = root?.querySelector(".local-files-head input[type='checkbox']");
  if (selectAll) {
    selectAll.checked = selectable.length > 0 && selected.length === selectable.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < selectable.length;
    selectAll.disabled = selectable.length === 0;
  }
  const bar = root?.querySelector(".local-files-selection");
  if (bar) {
    // Keep one checked item as the focused selection; show bulk controls only
    // after the user has selected at least two entries.
    bar.hidden = selected.length < 2;
    const count = bar.querySelector("span");
    if (count) count.textContent = String(selected.length);
    bar.querySelectorAll("[data-local-files-single-action]").forEach(button => {
      button.disabled = selected.length !== 1;
    });
  }
}

function localFilesEntry(tabKey, pathValue) {
  return localFilesRuntime(tabKey).entries.find(entry => String(entry.path) === String(pathValue)) || null;
}

function localFilesMutationRefresh(tabKey) {
  return loadLocalFiles(tabKey, {path:localFilesRuntime(tabKey).path, location:localFilesRuntime(tabKey).location, page:localFilesRuntime(tabKey).page, refresh:true});
}

function localFilesSelectedPayload(tabKey) {
  return selectedLocalFiles(tabKey).map(item => ({...item, type:item.type === "drive" ? "dir" : item.type}));
}

function showLocalFileEntryMenu(event, pathValue, type, tabKey) {
  event.preventDefault();
  event.stopPropagation();
  setLocalFileActivePath(pathValue, tabKey);
  const isDir = type === "dir" || type === "drive";
  const isDrive = type === "drive";
  const wasSelected = selectedLocalFiles(tabKey).some(item => item.path === pathValue);
  if (!isDrive && !wasSelected) applyLocalFileRangeSelection({shiftKey:false, ctrlKey:false, metaKey:false, forceSingle:true}, pathValue, tabKey);
  const selected = selectedLocalFiles(tabKey);
  const useSelection = !isDrive && selected.some(item => item.path === pathValue);
  const canMutate = !isDrive;
  const selectedPaths = useSelection ? selected.map(item => item.path) : [pathValue];
  const transferEntries = useSelection ? selected : [localFilesEntry(tabKey, pathValue)].filter(Boolean);
  const selectionCount = selectedPaths.length;
  const actions = [
    isDir
      ? {label:tr("common:auto.open", {defaultValue:"打开"}), icon:"folder-open", run:() => navigateLocalFilesPath(pathValue, tabKey)}
      : {label:tr("common:local_files.open_edit", {defaultValue:"打开 / 编辑"}), icon:"file-text", run:() => api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:pathValue})}).catch(error => notify(error.message || tr("sftp:local_files.open_file_failed", {defaultValue:"打开本地文件失败"}), "error"))},
    {label:tr("common:auto.open_in_system_file_manager", {defaultValue:"在系统文件管理器中打开"}), icon:"external-link", run:() => api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:isDir ? pathValue : localFilesRuntime(tabKey).path})}).catch(error => notify(error.message || tr("sftp:local_files.open_path_failed", {defaultValue:"打开本地路径失败"}), "error"))},
    {label:selectionCount > 1 ? tr("common:local_files.copy_paths", {count:selectionCount, defaultValue:`复制 ${selectionCount} 个路径`}) : tr("common:auto.copy_path", {defaultValue:"复制路径"}), icon:"clipboard", run:() => copyText(selectedPaths.join("\n"))},
    {separator:true},
    ...(canMutate && selectionCount === 1 ? [{label:tr("common:auto.rename", {defaultValue:"重命名"}), icon:"pencil", run:() => renameLocalPath(pathValue, tabKey)}] : []),
    ...(canMutate ? [{label:selectionCount > 1 ? tr("common:local_files.delete_selected", {count:selectionCount, defaultValue:`删除已选 ${selectionCount} 项`}) : tr("common:actions.delete", {defaultValue:"删除"}), icon:"trash-2", danger:true, run:() => deleteLocalFiles(selectedPaths, tabKey)}] : []),
    ...(window.termaDesktop && canMutate ? [{label:tr("common:auto.upload_to_sftp", {defaultValue:"上传到 SFTP"}), icon:"upload", children:() => localFilesUploadActions(tabKey)}] : []),
    ...(canMutate && localFilesWorkspaceTransferActions(tabKey, transferEntries).length ? [{label:tr("sftp:menu.send_peer", {defaultValue:"发送到对端"}), icon:"send", children:() => localFilesWorkspaceTransferActions(tabKey, transferEntries)}] : []),
    ...(canMutate && selectionCount === 1 ? [{label:tr("sftp:menu.permissions", {defaultValue:"设置权限"}), icon:"key-round", run:() => chmodLocalPath(pathValue, tabKey)}] : [])
  ];
  showActionMenu(event, actions);
}

function showLocalFilesDirectoryMenu(event, tabKey) {
  if (event.target?.closest?.(".local-files-row, .local-files-head, .sftp-pager, button, input, select")) return;
  event.preventDefault();
  event.stopPropagation();
  const canCreate = localFilesRuntime(tabKey).location !== "computer";
  const selectedCount = selectedLocalFiles(tabKey).length;
  showActionMenu(event, [
    ...(canCreate ? [{label:tr("common:auto.new_file", {defaultValue:"新建文件"}), icon:"file-plus-2", run:() => createLocalEntryFromPrompt(tabKey, "file")}] : []),
    ...(canCreate ? [{label:tr("common:auto.new_folder", {defaultValue:"新建文件夹"}), icon:"folder-plus", run:() => createLocalEntryFromPrompt(tabKey, "dir")}] : []),
    ...(selectedCount ? [{separator:true}, {label:tr("sftp:local_files.delete_selected_items", {defaultValue:"删除已选项目"}), icon:"trash-2", danger:true, run:() => deleteSelectedLocalFiles(tabKey)}] : []),
    {separator:true},
    {label:tr("common:auto.refresh", {defaultValue:"刷新"}), icon:"refresh-cw", run:() => localFilesMutationRefresh(tabKey)}
  ]);
}

async function createLocalEntryFromPrompt(tabKey, type) {
  if (localFilesRuntime(tabKey).location === "computer") return notify(tr("sftp:local_files.enter_directory_before_create", {defaultValue:"请先进入一个磁盘或目录后再新建项目"}), "info");
  const name = await inputModal(
    type === "dir" ? tr("common:auto.new_folder", {defaultValue:"新建文件夹"}) : tr("common:auto.new_file", {defaultValue:"新建文件"}),
    tr("sftp:operations.name_label", {defaultValue:"名称"})
  );
  if (!name) return;
  const runtime = localFilesRuntime(tabKey);
  try {
    await api("/api/local-files/create", {method:"POST", body:JSON.stringify({directory:runtime.path, name, type})});
    await localFilesMutationRefresh(tabKey);
    notify(type === "dir" ? tr("sftp:local_files.folder_created", {defaultValue:"文件夹已创建"}) : tr("sftp:local_files.file_created", {defaultValue:"文件已创建"}), "success");
  } catch (error) { notify(error.message || tr("sftp:local_files.create_failed", {defaultValue:"创建本地项目失败"}), "error"); }
}

async function renameLocalPath(pathValue, tabKey) {
  const entry = localFilesEntry(tabKey, pathValue);
  const name = await inputModal(tr("sftp:menu.rename", {defaultValue:"重命名"}), tr("sftp:dialogs.new_name", {defaultValue:"新名称"}), entry?.name || String(pathValue).split(/[\\/]/).pop());
  if (!name) return;
  try {
    await api("/api/local-files/rename", {method:"POST", body:JSON.stringify({path:pathValue, new_name:name})});
    await localFilesMutationRefresh(tabKey);
    notify(tr("sftp:local_files.renamed", {defaultValue:"已重命名"}), "success");
  } catch (error) { notify(error.message || tr("sftp:local_files.rename_failed", {defaultValue:"重命名失败"}), "error"); }
}

async function deleteLocalFiles(paths, tabKey) {
  const items = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!items.length) return notify(tr("sftp:local_files.select_items", {defaultValue:"请选择文件或目录"}), "info");
  if (!await confirmModal(
    tr("sftp:local_files.delete_confirm", {count:items.length, defaultValue:`确认删除 ${items.length} 个本地项目？删除后无法通过 Terma 恢复。`}),
    tr("sftp:local_files.delete_title", {defaultValue:"删除本地项目"}),
    tr("common:actions.delete", {defaultValue:"删除"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  )) return;
  try {
    await api("/api/local-files/delete", {method:"POST", body:JSON.stringify({paths:items})});
    await localFilesMutationRefresh(tabKey);
    clearLocalFilesSelection(tabKey);
    notify(tr("sftp:local_files.deleted", {count:items.length, defaultValue:`已删除 ${items.length} 个本地项目`}), "success");
  } catch (error) { notify(error.message || tr("sftp:local_files.delete_failed", {defaultValue:"删除本地项目失败"}), "error"); }
}

function deleteSelectedLocalFiles(tabKey) {
  return deleteLocalFiles(selectedLocalFiles(tabKey).map(item => item.path), tabKey);
}

async function renameSelectedLocalFile(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify(tr("sftp:local_files.rename_one_only", {defaultValue:"重命名一次只能选择一个项目"}), "info");
  return renameLocalPath(selected[0].path, tabKey);
}

async function chmodLocalPath(pathValue, tabKey) {
  if (navigator.platform?.toLowerCase().includes("win")) return notify(tr("sftp:local_files.windows_posix_unsupported", {defaultValue:"Windows 不支持 POSIX 权限设置"}), "info");
  const entry = localFilesEntry(tabKey, pathValue);
  const mode = await inputModal(
    tr("sftp:menu.permissions", {defaultValue:"设置权限"}),
    tr("sftp:local_files.permissions_example", {defaultValue:"权限（例如 644 或 755）"}),
    entry?.mode || "644"
  );
  if (!mode) return;
  try {
    await api("/api/local-files/chmod", {method:"POST", body:JSON.stringify({path:pathValue, mode})});
    await localFilesMutationRefresh(tabKey);
    notify(tr("sftp:local_files.permissions_updated", {defaultValue:"权限已更新"}), "success");
  } catch (error) { notify(error.message || tr("sftp:local_files.permissions_failed", {defaultValue:"设置权限失败"}), "error"); }
}

async function chmodSelectedLocalFile(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify(tr("sftp:local_files.permissions_one_only", {defaultValue:"设置权限一次只能选择一个项目"}), "info");
  return chmodLocalPath(selected[0].path, tabKey);
}

async function openSelectedLocalFiles(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify(tr("sftp:local_files.open_one_only", {defaultValue:"打开一次只能选择一个项目"}), "info");
  const item = selected[0];
  if (item.type === "dir" || item.type === "drive") return navigateLocalFilesPath(item.path, tabKey);
  return api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:item.path})}).catch(error => notify(error.message || tr("sftp:local_files.open_file_failed", {defaultValue:"打开本地文件失败"}), "error"));
}

async function copySelectedLocalFilePaths(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (!selected.length) return notify(tr("sftp:local_files.select_items", {defaultValue:"请选择文件或目录"}), "info");
  return copyText(selected.map(item => item.path).join("\n"));
}

function localFilesUploadActions(tabKey) {
  const payload = {paths:localFilesSelectedPayload(tabKey).map(item => item.path), entries:localFilesSelectedPayload(tabKey)};
  if (!payload.paths.length) return [];
  const active = tabs.find(tab => tab.key === activeTabKey && tab.kind === "sftp");
  const targets = [];
  if (active) {
    const name = active.title || active.name || active.id || "";
    targets.push({label:tr("navigation:transfer.upload_current_sftp", {name, defaultValue:`上传到当前 SFTP：${name}`}), icon:"folder-up", run:() => uploadLocalFilesToSftp(payload, active, active.key)});
  }
  for (const connection of (connections || [])) {
    if (active && Number(active.id) === Number(connection.id)) continue;
    const name = connection.name || connection.ssh_host || "";
    targets.push({label:tr("navigation:transfer.sftp_connection", {name, defaultValue:`${name} · SFTP`}), icon:"server", run:() => uploadLocalFilesToSftp(payload, {kind:"sftp", id:connection.id, title:name, path:"."}, tabKey)});
  }
  return targets;
}

function localFilesWorkspaceTransferActions(tabKey, entries=localFilesSelectedPayload(tabKey)) {
  const payload = {paths:entries.map(item => item.path), entries};
  return typeof workspaceLocalFilesTransferActions === "function"
    ? workspaceLocalFilesTransferActions(tabKey, payload)
    : [];
}

function showLocalFilesUploadMenu(event, tabKey) {
  const targets = localFilesUploadActions(tabKey);
  if (!selectedLocalFiles(tabKey).length) return notify(tr("navigation:transfer.select_upload_items", {defaultValue:"请选择要上传的文件或目录"}), "info");
  if (!targets.length) return notify(tr("navigation:transfer.no_sftp_targets", {defaultValue:"暂无可用的 SFTP 连接"}), "info");
  showActionMenu(event, targets);
}

function syncLocalFilesScrollCue(list) {
  if (!list) return;
  list.classList.toggle("has-scroll-below", list.scrollHeight - list.scrollTop - list.clientHeight > 2);
}

function watchLocalFilesListLayout(list, tabKey) {
  if (!list) return;
  if (list.dataset.localScrollCueBound !== "1") {
    list.dataset.localScrollCueBound = "1";
    list.addEventListener("scroll", () => {
      captureLocalFilesScrollPosition(tabKey, list);
      syncLocalFilesScrollCue(list);
    }, {passive:true});
  }
  syncLocalFilesScrollCue(list);
  requestAnimationFrame(() => syncLocalFilesScrollCue(list));
  const runtime = localFilesRuntime(tabKey);
  runtime.resizeObserver?.disconnect?.();
  if (typeof ResizeObserver === "function") {
    runtime.resizeObserver = new ResizeObserver(() => {
      if (typeof syncLocalFilesColumnControls === "function") syncLocalFilesColumnControls(list);
      syncLocalFilesScrollCue(list);
    });
    runtime.resizeObserver.observe(list);
  }
}

function applyLocalFileRangeSelection(event, pathValue, tabKey, toggleOnly=false) {
  const runtime = localFilesRuntime(tabKey);
  const checks = localFileChecks(tabKey);
  const currentIndex = checks.findIndex(input => input.value === pathValue);
  if (currentIndex < 0) return;
  if (event.shiftKey && runtime.anchorPath) {
    const anchorIndex = checks.findIndex(input => input.value === runtime.anchorPath);
    if (anchorIndex >= 0) {
      if (!event.ctrlKey && !event.metaKey) checks.forEach(input => { input.checked = false; });
      const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) checks[index].checked = true;
      updateLocalFilesSelection(tabKey);
      return;
    }
  }
  const input = checks[currentIndex];
  if (input.disabled) return;
  if (toggleOnly || event.ctrlKey || event.metaKey) input.checked = !input.checked;
  else if (!event.forceSingle && checks.filter(item => item.checked).length >= 2) input.checked = !input.checked;
  else {
    checks.forEach(item => { item.checked = item === input; });
  }
  runtime.anchorPath = pathValue;
  updateLocalFilesSelection(tabKey);
}

function setLocalFileActivePath(pathValue, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  runtime.activePath = String(pathValue || "");
  localFilesRoot(tabKey)?.querySelectorAll(".local-files-row").forEach(row => {
    row.classList.toggle("active", String(row.dataset.path || "") === runtime.activePath);
  });
}

function selectLocalFileEntry(event, pathValue, tabKey) {
  if (event.target?.closest?.(".local-files-check")) return;
  setLocalFileActivePath(pathValue, tabKey);
  applyLocalFileRangeSelection(event, pathValue, tabKey);
}

function handleLocalFileCheckboxClick(event, pathValue, tabKey) {
  event.stopPropagation();
  const runtime = localFilesRuntime(tabKey);
  const checks = localFileChecks(tabKey);
  if (event.shiftKey && runtime.anchorPath) {
    const currentIndex = checks.findIndex(input => input.value === pathValue);
    const anchorIndex = checks.findIndex(input => input.value === runtime.anchorPath);
    if (currentIndex >= 0 && anchorIndex >= 0) {
      if (!event.ctrlKey && !event.metaKey) checks.forEach(input => { input.checked = false; });
      const [start, end] = anchorIndex < currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) checks[index].checked = true;
    }
  } else {
    runtime.anchorPath = pathValue;
  }
  updateLocalFilesSelection(tabKey);
}

function clearLocalFilesSelection(tabKey) {
  localFileChecks(tabKey).forEach(input => { input.checked = false; });
  updateLocalFilesSelection(tabKey);
}

function installLocalFilesKeyboardShortcuts() {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof document.addEventListener !== "function" || window.__termaLocalFilesKeyboardShortcutsInstalled) return;
  window.__termaLocalFilesKeyboardShortcutsInstalled = true;
  document.addEventListener("keydown", event => {
    const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(activeTabKey) : tabs.find(item => item.key === activeTabKey);
    const modal = document.getElementById("modal");
    const editable = event.target?.closest?.("input, textarea, select, [contenteditable='true']");
    if (tab?.kind !== "local-files" || editable || (modal && !modal.hidden)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      toggleAllLocalFiles(true, activeTabKey);
    }
  }, true);
}

installLocalFilesKeyboardShortcuts();

function localFilesNavigationState(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  if (!runtime.navigation) runtime.navigation = {paths:[], index:-1};
  return runtime.navigation;
}

function localFilesNavigationToken(runtime) {
  return runtime.location === "computer" ? LOCAL_FILES_COMPUTER_PATH : runtime.path || "";
}

function rememberLocalFilesNavigation(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const navigation = localFilesNavigationState(tabKey);
  const token = localFilesNavigationToken(runtime);
  if (navigation.paths[navigation.index] === token) return;
  navigation.paths = navigation.paths.slice(0, navigation.index + 1);
  navigation.paths.push(token);
  if (navigation.paths.length > 80) navigation.paths.shift();
  navigation.index = navigation.paths.length - 1;
}

function syncLocalFilesNavigationButtons(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const navigation = localFilesNavigationState(tabKey);
  const root = localFilesRoot(tabKey);
  const back = root?.querySelector(".local-files-history-back");
  const forward = root?.querySelector(".local-files-history-forward");
  const parent = root?.querySelector(".local-files-parent");
  if (back) back.disabled = navigation.index <= 0;
  if (forward) forward.disabled = navigation.index < 0 || navigation.index >= navigation.paths.length - 1;
  if (parent) parent.disabled = !runtime.parent && runtime.parentKind !== "computer";
}

function syncLocalFilesCreateButtons(tabKey) {
  const disabled = localFilesRuntime(tabKey).location === "computer";
  const root = localFilesRoot(tabKey);
  for (const button of root?.querySelectorAll(".local-files-create-directory, .local-files-create-file") || []) {
    button.disabled = disabled;
  }
}

function localFilesBreadcrumbHtml(runtime, tabKey) {
  const key = escAttr(tabKey);
  const computerLabel = tr("sftp:local_files.this_computer", {defaultValue:"此电脑"});
  const localFilesLabel = tr("sftp:local_files.title", {defaultValue:"本地文件"});
  if (runtime.location === "computer") return `<button class="crumb active" type="button" aria-current="page" data-action="local-files-computer" data-tab-key="${key}">${icon("monitor")}<span>${esc(computerLabel)}</span></button>`;
  const value = String(runtime.path || "");
  if (!value) return `<button class="crumb active" type="button" aria-current="page" data-action="local-files-computer" data-tab-key="${key}">${icon("monitor")}<span>${esc(localFilesLabel)}</span></button>`;
  const isWindows = /^[A-Za-z]:[\\/]/.test(value);
  const parts = isWindows ? value.replace(/[\\/]+$/, "").split(/[\\/]/) : value.split("/");
  const crumbs = [];
  if (isWindows) {
    const drive = `${parts.shift()}\\`;
    crumbs.push(`<button class="crumb" type="button" data-action="local-files-computer" data-tab-key="${key}">${icon("monitor")}<span>${esc(computerLabel)}</span></button><span class="crumb-sep">${icon("chevron-right")}</span>`);
    let current = drive;
    crumbs.push(`<button class="crumb ${parts.length ? "" : "active"}" type="button" ${parts.length ? "" : "aria-current=\"page\""} data-action="local-files-path" data-path="${escAttr(current)}" data-tab-key="${key}"><span data-i18n-skip>${esc(current.replace(/\\$/, ""))}</span></button>`);
    for (let index = 0; index < parts.length; index += 1) {
      if (!parts[index]) continue;
      current += `${current.endsWith("\\") ? "" : "\\"}${parts[index]}`;
      crumbs.push(`<span class="crumb-sep">${icon("chevron-right")}</span><button class="crumb ${index === parts.length - 1 ? "active" : ""}" type="button" ${index === parts.length - 1 ? "aria-current=\"page\"" : ""} data-action="local-files-path" data-path="${escAttr(current)}" data-tab-key="${key}"><span data-i18n-skip>${esc(parts[index])}</span></button>`);
    }
  } else {
    crumbs.push(`<button class="crumb ${parts.length <= 1 ? "active" : ""}" type="button" data-action="local-files-path" data-path="/" data-tab-key="${key}"><span>/</span></button>`);
    let current = "";
    for (let index = 0; index < parts.length; index += 1) {
      if (!parts[index]) continue;
      current += `/${parts[index]}`;
      crumbs.push(`<span class="crumb-sep">${icon("chevron-right")}</span><button class="crumb ${index === parts.length - 1 ? "active" : ""}" type="button" ${index === parts.length - 1 ? "aria-current=\"page\"" : ""} data-action="local-files-path" data-path="${escAttr(current)}" data-tab-key="${key}"><span data-i18n-skip>${esc(parts[index])}</span></button>`);
    }
  }
  return crumbs.join("");
}

function showLocalFilesPathEditor(tabKey) {
  const root = localFilesRoot(tabKey);
  const breadcrumb = root?.querySelector(".local-files-breadcrumb");
  const editor = root?.querySelector(".local-files-path-editor");
  const input = editor?.querySelector("input");
  if (!breadcrumb || !editor || !input) return;
  breadcrumb.hidden = true;
  editor.hidden = false;
  input.value = localFilesRuntime(tabKey).path || "";
  input.focus();
  input.select();
}

function hideLocalFilesPathEditor(tabKey) {
  const root = localFilesRoot(tabKey);
  const breadcrumb = root?.querySelector(".local-files-breadcrumb");
  const editor = root?.querySelector(".local-files-path-editor");
  if (breadcrumb) breadcrumb.hidden = false;
  if (editor) editor.hidden = true;
}

function navigateLocalFilesComputer(tabKey) {
  hideLocalFilesPathEditor(tabKey);
  return loadLocalFiles(tabKey, {location:"computer", path:"", page:1});
}

function navigateLocalFilesPath(pathValue, tabKey) {
  hideLocalFilesPathEditor(tabKey);
  return loadLocalFiles(tabKey, {path:pathValue, location:"directory", page:1});
}

function navigateLocalFilesHistory(direction, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const navigation = localFilesNavigationState(tabKey);
  const nextIndex = navigation.index + Number(direction || 0);
  if (nextIndex < 0 || nextIndex >= navigation.paths.length) return;
  navigation.index = nextIndex;
  const token = navigation.paths[nextIndex];
  return token === LOCAL_FILES_COMPUTER_PATH
    ? loadLocalFiles(tabKey, {location:"computer", path:"", page:1, historyNavigation:true})
    : loadLocalFiles(tabKey, {location:"directory", path:token, page:1, historyNavigation:true});
}

function activateLocalFileEntry(event, pathValue, type, tabKey) {
  event.preventDefault();
  event.stopPropagation();
  setLocalFileActivePath(pathValue, tabKey);
  if (type === "dir" || type === "drive") return navigateLocalFilesPath(pathValue, tabKey);
  return api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:pathValue})}).catch(error => notify(error.message || tr("sftp:local_files.open_file_failed", {defaultValue:"打开本地文件失败"}), "error"));
}

function submitLocalFilesPath(event, tabKey, form=event.currentTarget) {
  event.preventDefault();
  const value = form?.querySelector("input")?.value || "";
  hideLocalFilesPathEditor(tabKey);
  return navigateLocalFilesPath(value, tabKey).catch(error => notify(error.message || tr("sftp:local_files.open_directory_failed", {defaultValue:"打开本地目录失败"}), "error"));
}

async function navigateLocalFilesLocation(name, tabKey) {
  const locations = await api("/api/local-files/locations");
  return navigateLocalFilesPath(locations[name] || locations.desktop, tabKey);
}

function navigateLocalFilesParent(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  if (runtime.parentKind === "computer") return navigateLocalFilesComputer(tabKey);
  if (runtime.parent) return navigateLocalFilesPath(runtime.parent, tabKey);
}

function toggleAllLocalFiles(checked, tabKey) {
  const checks = localFileChecks(tabKey);
  checks.forEach(input => { if (!input.disabled) input.checked = Boolean(checked); });
  if (checked) localFilesRuntime(tabKey).anchorPath = checks.find(input => !input.disabled)?.value || "";
  updateLocalFilesSelection(tabKey);
}

function setLocalFilesPageSize(value, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const scrollPosition = captureLocalFilesScrollAnchor(tabKey);
  const firstItemIndex = Math.max(0, Number(runtime.page || 1) - 1) * Number(runtime.pageSize || 50);
  runtime.pageSize = Math.max(25, Math.min(200, Number(value || 50)));
  return loadLocalFiles(tabKey, {
    page:Math.floor(firstItemIndex / runtime.pageSize) + 1,
    preserveScroll:true,
    scrollPosition
  });
}

function setLocalFilesSearch(value, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  runtime.query = String(value || "");
  clearTimeout(runtime.searchTimer);
  runtime.searchTimer = setTimeout(() => loadLocalFiles(tabKey, {page:1}).catch(error => notify(error.message, "error")), 180);
}

function clearLocalFilesSearch(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  runtime.query = "";
  const input = localFilesRoot(tabKey)?.querySelector(".local-files-search input");
  if (input) input.value = "";
  return loadLocalFiles(tabKey, {page:1});
}

function setLocalFilesSort(sort, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  runtime.dir = runtime.sort === sort && runtime.dir === "asc" ? "desc" : "asc";
  runtime.sort = sort;
  return loadLocalFiles(tabKey, {page:1});
}

function setLocalFilesPage(page, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const next = Math.max(1, Math.min(runtime.totalPages, Number(page || 1)));
  return loadLocalFiles(tabKey, {page:next});
}

function beginLocalFileDrag(event, pathValue, tabKey, sourceRow=null) {
  setLocalFileActivePath(pathValue, tabKey);
  let entries = selectedLocalFiles(tabKey);
  if (!entries.some(item => item.path === pathValue)) {
    applyLocalFileRangeSelection({shiftKey:false, ctrlKey:false, metaKey:false, forceSingle:true}, pathValue, tabKey);
    entries = selectedLocalFiles(tabKey);
  }
  if (!entries.length) return event.preventDefault();
  const payload = {sourceTabKey:String(tabKey || ""), paths:entries.map(item => String(item.path)), entries};
  localFileInternalDrag = payload;
  localFileInternalDragHandoff = null;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(LOCAL_FILES_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", entries.map(item => item.path).join("\n"));
  const row = sourceRow || event.currentTarget?.closest?.(".local-files-row") || event.currentTarget || event.target?.closest?.(".local-files-row");
  row?.classList?.add("is-dragging");
  document.body?.classList.add("local-files-item-drag-active");
  if (typeof showSftpDragPreview === "function") showSftpDragPreview(entries, event.clientX, event.clientY);
}

function localFileDataTransferHasPayload(dataTransfer) {
  return Array.from(dataTransfer?.types || []).some(type => String(type || "").toLowerCase() === LOCAL_FILES_DRAG_MIME);
}

function normalizeLocalFileDragPayload(value) {
  const paths = Array.isArray(value?.paths) ? value.paths.map(String).filter(Boolean) : [];
  if (!paths.length) return null;
  return {
    ...value,
    sourceTabKey:String(value?.sourceTabKey || ""),
    paths,
    entries:Array.isArray(value?.entries) ? value.entries : paths.map(pathValue => ({path:pathValue, name:pathValue.split(/[\\/]/).pop()}))
  };
}

function readLocalFileDragPayload(dataTransfer=null) {
  // Electron/Chromium may expose only text/plain while an internal drag crosses
  // split panes. The renderer-owned payload remains authoritative until dragend.
  const handoff = localFileInternalDragHandoff?.expiresAt > Date.now() ? localFileInternalDragHandoff.payload : null;
  if (localFileInternalDragHandoff && !handoff) localFileInternalDragHandoff = null;
  const retained = localFileInternalDrag || handoff;
  const plainText = typeof dataTransfer?.getData === "function" ? String(dataTransfer.getData("text/plain") || "") : "";
  const retainedText = retained?.paths?.map(String).join("\n") || "";
  const matchesRetainedText = Boolean(retained && plainText && plainText.replace(/\r\n/g, "\n") === retainedText.replace(/\r\n/g, "\n"));
  const hasPayload = Boolean(localFileInternalDrag)
    || (dataTransfer ? localFileDataTransferHasPayload(dataTransfer) : false)
    || matchesRetainedText;
  if (!hasPayload) return null;
  try {
    const raw = typeof dataTransfer?.getData === "function" ? dataTransfer.getData(LOCAL_FILES_DRAG_MIME) : "";
    const parsed = raw ? normalizeLocalFileDragPayload(JSON.parse(raw)) : null;
    if (parsed) return parsed;
  } catch {}
  // Chromium protects drag data during dragenter/dragover. The MIME type is
  // still visible, so retain the payload created by this renderer until drop.
  return retained && hasPayload ? normalizeLocalFileDragPayload(retained) : null;
}

function finishLocalFileDrag(eventOrOptions={}) {
  const immediate = Boolean(eventOrOptions?.immediate);
  if (!immediate && localFileInternalDrag) {
    localFileInternalDragHandoff = {
      payload:normalizeLocalFileDragPayload(localFileInternalDrag),
      expiresAt:Date.now() + LOCAL_FILES_DRAG_HANDOFF_TTL_MS
    };
  }
  localFileInternalDrag = null;
  if (immediate) localFileInternalDragHandoff = null;
  document.body?.classList.remove("local-files-item-drag-active");
  document.querySelectorAll?.(".local-files-row.is-dragging").forEach(row => row.classList.remove("is-dragging"));
  document.getElementById?.("sftpDragPreview")?.remove();
}

function bindLocalFileDragLifecycle() {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function" || document.__termaLocalFileDragLifecycleBound) return;
  document.__termaLocalFileDragLifecycleBound = true;
  document.addEventListener("dragover", event => {
    if (!localFileInternalDrag) return;
    if (typeof moveSftpDragPreview === "function") moveSftpDragPreview(event.clientX, event.clientY);
  }, true);
  document.addEventListener("dragend", event => finishLocalFileDrag(event), true);
  document.addEventListener("drop", () => setTimeout(() => finishLocalFileDrag({immediate:true}), 0), true);
}

bindLocalFileDragLifecycle();

async function uploadLocalFilesToSftp(payload, target, tabKey="") {
  if (!payload?.paths?.length || !["sftp", "terminal"].includes(String(target?.kind || ""))) return;
  const runtime = target.kind === "sftp" ? sftpTabRuntimes.get(String(target.key || tabKey || "")) : null;
  const directory = runtime?.state.path || target.path || ".";
  const targetName = target.title || tr("navigation:transfer.target_directory", {defaultValue:"目标目录"});
  const conflict = typeof sftpConflictChoice === "function"
    ? await sftpConflictChoice(Number(target.id), directory, payload.entries || [], {title:tr("navigation:transfer.target_conflict_title", {target:targetName, defaultValue:`${targetName}存在同名项目`})})
    : "error";
  if (conflict === "cancel") return;
  const result = await api("/api/local-files/upload", {method:"POST", body:JSON.stringify({connection_id:Number(target.id), paths:payload.paths, target:directory, conflict})});
  for (const job of result.jobs || []) trackSftpMutationJob(job);
  refreshSftpJobs();
  notify(tr("navigation:transfer.upload_started", {count:result.count || payload.paths.length, target:directory, defaultValue:`已开始上传 ${result.count || payload.paths.length} 个项目到 ${directory}`}), "success");
}

async function localFilesReceiveConflictChoice(directory, entries) {
  const paths = (entries || []).map(item => String(item?.path || "")).filter(Boolean);
  const plan = await api("/api/local-files/receive-plan", {
    method:"POST",
    body:JSON.stringify({paths, target:directory})
  });
  const conflicts = (plan.items || []).filter(item => item.exists);
  if (!conflicts.length) return "error";
  const preview = conflicts.slice(0, 6).map(item => item.name).join(tr("navigation:transfer.item_separator", {defaultValue:"、"}));
  const more = conflicts.length > 6 ? tr("navigation:transfer.more_items", {count:conflicts.length, defaultValue:` 等 ${conflicts.length} 项`}) : "";
  return chooseModal(tr("navigation:transfer.local_conflict_title", {defaultValue:"本地目录存在同名项目"}), `${preview}${more}`, [
    {label:tr("common:auto.overwrite", {defaultValue:"覆盖"}), value:"overwrite", className:"danger"},
    {label:tr("common:auto.auto_rename", {defaultValue:"自动重命名"}), value:"rename", className:"primary"},
    {label:tr("common:actions.cancel", {defaultValue:"取消"}), value:"cancel"}
  ]);
}

async function copySftpDraggedItemsToLocalTab(drag, target) {
  if (!drag?.entries?.length || target?.kind !== "local-files") return;
  finishSftpDragPayload(drag);
  const runtime = localFilesRuntime(target.key);
  if (runtime.location === "computer") throw new Error(tr("navigation:transfer.open_local_directory", {defaultValue:"请先打开一个本地磁盘或目录，再保存远程文件"}));
  const directory = runtime.path || target.path || "";
  const conflict = await localFilesReceiveConflictChoice(directory, drag.entries);
  if (conflict === "cancel") return;
  const job = await api("/api/local-files/receive", {method:"POST", body:JSON.stringify({connection_id:Number(drag.connectionId), paths:drag.entries.map(item => item.path), target:directory, conflict})});
  trackLocalDeliveryJobTarget(job, target.key, directory);
  trackSftpMutationJob(job);
  await refreshSftpJobs();
  startSftpJobsTimer();
  notify(tr(drag.entries.length === 1 ? "common:notifications.background_transfer_target_one" : "common:notifications.background_transfer_target_other", {count:drag.entries.length, target:directory, defaultValue:`后台传输已开始：${drag.entries.length} 个项目到 ${directory}`}), "info");
}

function handleLocalFilesDragOver(event, tabKey) {
  const drag = activeSftpDragPayload(event.dataTransfer);
  if (!drag || localFilesRuntime(tabKey).location === "computer") return;
  if (typeof noteSftpDragFeedbackActivity === "function") noteSftpDragFeedbackActivity();
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
  localFilesRoot(tabKey)?.querySelector(".local-files-drop-overlay")?.removeAttribute("hidden");
}

function handleLocalFilesDragLeave(event, tabKey, root=event.currentTarget) {
  if (root?.contains(event.relatedTarget)) return;
  const overlay = localFilesRoot(tabKey)?.querySelector(".local-files-drop-overlay");
  if (overlay) overlay.hidden = true;
}

async function handleLocalFilesDrop(event, tabKey) {
  const drag = activeSftpDragPayload(event.dataTransfer);
  const overlay = localFilesRoot(tabKey)?.querySelector(".local-files-drop-overlay");
  if (overlay) overlay.hidden = true;
  if (!drag) return;
  event.preventDefault();
  event.stopPropagation();
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  try {
    await copySftpDraggedItemsToLocalTab(drag, tab);
  } catch (error) {
    notify(error.message || tr("sftp:local_files.save_remote_failed", {defaultValue:"保存远程文件失败"}), "error");
  }
}

async function sendSftpPathsToDesktop(connectionId, paths) {
  if (!paths?.length) return;
  const job = await api("/api/local-files/receive-desktop", {method:"POST", body:JSON.stringify({connection_id:Number(connectionId), paths})});
  trackSftpMutationJob(job);
  await refreshSftpJobs();
  startSftpJobsTimer();
  notify(tr(paths.length === 1 ? "common:notifications.background_transfer_desktop_one" : "common:notifications.background_transfer_desktop_other", {count:paths.length, defaultValue:`后台传输已开始：${paths.length} 个项目到桌面`}), "info");
  return job;
}

function syncLocalFilesLanguage() {
  if (typeof tabs === "undefined" || !Array.isArray(tabs)) return;
  const title = tr("sftp:local_files.title", {defaultValue:"本地文件"});
  const computerLabel = tr("sftp:local_files.this_computer", {defaultValue:"此电脑"});
  for (const tab of tabs) {
    if (tab?.kind !== "local-files") continue;
    const runtime = localFileRuntimes.get(String(tab.key || ""));
    tab.title = title;
    if (!runtime) continue;
    if (runtime.location === "computer") runtime.displayPath = computerLabel;
    tab.subtitle = runtime.displayPath || runtime.path || (runtime.location === "computer" ? computerLabel : "");
    const root = localFilesRoot(tab.key);
    if (!root) continue;
    const breadcrumb = root.querySelector(".local-files-breadcrumb");
    if (breadcrumb) breadcrumb.innerHTML = localFilesBreadcrumbHtml(runtime, tab.key);
    root.querySelectorAll(".local-files-row[data-path]").forEach(row => {
      const entry = localFilesEntry(tab.key, row.dataset.path);
      if (!entry) return;
      const displayName = localFilesEntryDisplayName(entry);
      const name = row.querySelector(".local-files-file-name");
      const checkbox = row.querySelector(".local-files-check");
      if (name) name.textContent = displayName;
      if (checkbox) checkbox.setAttribute("aria-label", tr("common:local_files.select_entry", {name:displayName, defaultValue:`选择 ${displayName}`}));
    });
    if (typeof activeTabKey !== "undefined" && tab.key === activeTabKey) {
      const subtitle = $("workspaceSubtitle");
      if (subtitle) subtitle.textContent = tab.subtitle;
    }
  }
  if (typeof renderTabs === "function") renderTabs();
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(syncLocalFilesLanguage);

const renderLocalFilesTabContentBase = renderTabContent;
renderTabContent = function(tab) {
  if (tab?.kind === "local-files") return openLocalFiles(tab.path || "", false, tab.key);
  return renderLocalFilesTabContentBase(tab);
};

const closeLocalFilesTabsBase = closeTabsByKey;
closeTabsByKey = function(keys, anchorKey="") {
  for (const key of keys || []) localFileRuntimes.delete(String(key));
  return closeLocalFilesTabsBase(keys, anchorKey);
};

if (typeof registerTermaAction === "function") {
registerTermaAction("local-files-new-tab", ({event}) => showNewLocalFilesMenu(event));
registerTermaAction("local-files-drag-over", ({event, element}) => handleLocalFilesDragOver(event, element.dataset.tabKey));
registerTermaAction("local-files-drag-leave", ({event, element}) => handleLocalFilesDragLeave(event, element.dataset.tabKey, element));
registerTermaAction("local-files-drop", ({event, element}) => handleLocalFilesDrop(event, element.dataset.tabKey));
registerTermaAction("local-files-history", ({element}) => navigateLocalFilesHistory(Number(element.dataset.historyDirection || 0), element.dataset.tabKey));
registerTermaAction("local-files-parent", ({element}) => navigateLocalFilesParent(element.dataset.tabKey));
registerTermaAction("local-files-location", ({element}) => navigateLocalFilesLocation(element.dataset.location, element.dataset.tabKey));
registerTermaAction("local-files-refresh", ({element}) => loadLocalFiles(element.dataset.tabKey, {refresh:true}));
registerTermaAction("local-files-create", ({element}) => createLocalEntryFromPrompt(element.dataset.tabKey, element.dataset.entryKind));
registerTermaAction("local-files-search", ({element}) => setLocalFilesSearch(element.value, element.dataset.tabKey));
registerTermaAction("local-files-search-clear", ({element}) => clearLocalFilesSearch(element.dataset.tabKey));
registerTermaAction("local-files-path-edit", ({element}) => showLocalFilesPathEditor(element.dataset.tabKey));
registerTermaAction("local-files-path-submit", ({event, element}) => submitLocalFilesPath(event, element.dataset.tabKey, element));
registerTermaAction("local-files-path-cancel", ({element}) => hideLocalFilesPathEditor(element.dataset.tabKey));
registerTermaAction("local-files-selection-open", ({element}) => openSelectedLocalFiles(element.dataset.tabKey));
registerTermaAction("local-files-selection-upload", ({event, element}) => showLocalFilesUploadMenu(event, element.dataset.tabKey));
registerTermaAction("local-files-selection-copy", ({element}) => copySelectedLocalFilePaths(element.dataset.tabKey));
registerTermaAction("local-files-selection-rename", ({element}) => renameSelectedLocalFile(element.dataset.tabKey));
registerTermaAction("local-files-selection-delete", ({element}) => deleteSelectedLocalFiles(element.dataset.tabKey));
registerTermaAction("local-files-selection-chmod", ({element}) => chmodSelectedLocalFile(element.dataset.tabKey));
registerTermaAction("local-files-selection-clear", ({element}) => clearLocalFilesSelection(element.dataset.tabKey));
registerTermaAction("local-files-directory-menu", ({event, element}) => showLocalFilesDirectoryMenu(event, element.dataset.tabKey));
registerTermaAction("local-files-select-all", ({element}) => toggleAllLocalFiles(element.checked, element.dataset.tabKey));
registerTermaAction("local-files-sort", ({element}) => setLocalFilesSort(element.dataset.sort, element.dataset.tabKey));
registerTermaAction("local-files-entry-select", ({event, element}) => selectLocalFileEntry(event, element.dataset.path, element.dataset.tabKey));
registerTermaAction("local-files-entry-select-stop", ({event, element}) => {
  event.stopPropagation();
  return selectLocalFileEntry(event, element.dataset.path, element.dataset.tabKey);
});
registerTermaAction("local-files-entry-activate", ({event, element}) => activateLocalFileEntry(event, element.dataset.path, element.dataset.entryType, element.dataset.tabKey));
registerTermaAction("local-files-entry-menu", ({event, element}) => showLocalFileEntryMenu(event, element.dataset.path, element.dataset.entryType, element.dataset.tabKey));
registerTermaAction("local-files-entry-drag-start", ({event, element}) => beginLocalFileDrag(event, element.dataset.path, element.dataset.tabKey, element));
registerTermaAction("local-files-entry-drag-end", () => finishLocalFileDrag());
registerTermaAction("local-files-entry-checkbox", ({event, element}) => handleLocalFileCheckboxClick(event, element.dataset.path, element.dataset.tabKey));
registerTermaAction("local-files-page", ({element}) => setLocalFilesPage(Number(element.dataset.page || 1), element.dataset.tabKey));
registerTermaAction("local-files-page-limit", ({element}) => setLocalFilesPageSize(element.value, element.dataset.tabKey));
registerTermaAction("local-files-computer", ({element}) => navigateLocalFilesComputer(element.dataset.tabKey));
registerTermaAction("local-files-path", ({element}) => navigateLocalFilesPath(element.dataset.path, element.dataset.tabKey));
}
