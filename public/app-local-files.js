const LOCAL_FILES_DRAG_MIME = "application/x-terma-local-files";
const LOCAL_FILES_COMPUTER_PATH = "::computer::";
const localFileRuntimes = new Map();
const localDeliveryJobTargets = new Map();
let localFileTabSerial = 0;
let localFileInternalDrag = null;
let localFileInternalDragHandoff = null;
const LOCAL_FILES_DRAG_HANDOFF_TTL_MS = 4000;

function localFilesInlineArg(value) {
  return encodeURIComponent(String(value ?? "")).replace(/'/g, "%27");
}

function localFilesAvailable() {
  return Boolean(window.termaDesktop);
}

function localFilesRoot(tabKey) {
  return typeof workspaceElementForTab === "function"
    ? workspaceElementForTab(tabKey, "#view-local-files")
    : document.querySelector(`#view-local-files[data-workspace-tab-key="${CSS.escape(String(tabKey || ""))}"]`) || $("view-local-files");
}

function localFilesRuntime(tabKey) {
  const key = String(tabKey || "");
  if (!localFileRuntimes.has(key)) {
    localFileRuntimes.set(key, {path:"", location:"directory", displayPath:"", parent:"", parentKind:"none", entries:[], page:1, pageSize:50, total:0, totalPages:1, query:"", sort:"name", dir:"asc", activePath:"", anchorPath:"", navigation:{paths:[], index:-1}});
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
  return `<button type="button" class="icon-button local-files-open-button" title="新建本地文件标签" aria-label="新建本地文件标签" onclick="showNewLocalFilesMenu(event,'${escAttr(tabKey)}')">${icon("hard-drive")}</button>`;
}

function showNewLocalFilesMenu(event) {
  if (!localFilesAvailable()) return notify("本地文件只支持桌面端", "info");
  const actions = [{label:"新建标签", icon:"file-plus-2", run:()=>openLocalFilesInPlacement("")}];
  if (!isMobileLayout() && typeof applyWorkspaceTabDrop === "function") {
    actions.push(
      {separator:true},
      {label:"向左分屏新建", icon:"panel-left", run:()=>openLocalFilesInPlacement("left")},
      {label:"向右分屏新建", icon:"panel-right", run:()=>openLocalFilesInPlacement("right")},
      {label:"向上分屏新建", icon:"panel-top", run:()=>openLocalFilesInPlacement("top")},
      {label:"向下分屏新建", icon:"panel-bottom", run:()=>openLocalFilesInPlacement("bottom")}
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
    notify("本地文件只支持在 Terma 桌面端使用", "info");
    return "";
  }
  const key = existingKey || `local-files-${Date.now()}-${++localFileTabSerial}`;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const runtime = localFilesRuntime(key);
  const storedPath = requestedPath || tab?.path || runtime.path || "";
  const computer = storedPath === LOCAL_FILES_COMPUTER_PATH || tab?.localLocation === "computer" || runtime.location === "computer";
  const pathValue = computer ? "" : storedPath;
  runtime.location = computer ? "computer" : "directory";
  const view = $("view-local-files");
  view.dataset.workspaceTabKey = key;
  view.innerHTML = `<div class="local-files-shell" data-local-files-tab-key="${escAttr(key)}" ondragover="handleLocalFilesDragOver(event,'${escAttr(key)}')" ondragleave="handleLocalFilesDragLeave(event,'${escAttr(key)}')" ondrop="handleLocalFilesDrop(event,'${escAttr(key)}')">
    <div class="local-files-top">
      <div class="local-files-toolbar">
        <div class="local-files-toolbar-actions">
          <button class="icon-button local-files-history-back" title="后退" aria-label="后退" onclick="navigateLocalFilesHistory(-1,'${escAttr(key)}')" disabled>${icon("arrow-left")}</button>
          <button class="icon-button local-files-history-forward" title="前进" aria-label="前进" onclick="navigateLocalFilesHistory(1,'${escAttr(key)}')" disabled>${icon("arrow-right")}</button>
          <button class="icon-button local-files-parent" title="上一级" aria-label="上一级" onclick="navigateLocalFilesParent('${escAttr(key)}')">${icon("corner-left-up")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="桌面" aria-label="桌面" onclick="navigateLocalFilesLocation('desktop','${escAttr(key)}')">${icon("monitor")}</button>
          <button class="icon-button" title="下载目录" aria-label="下载目录" onclick="navigateLocalFilesLocation('downloads','${escAttr(key)}')">${icon("download")}</button>
          <button class="icon-button" title="用户主目录" aria-label="用户主目录" onclick="navigateLocalFilesLocation('home','${escAttr(key)}')">${icon("home")}</button>
          <button class="icon-button" title="刷新" aria-label="刷新" onclick="loadLocalFiles('${escAttr(key)}',{refresh:true})">${icon("refresh-cw")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button local-files-create-directory" title="新建文件夹" aria-label="新建文件夹" onclick="createLocalEntryFromPrompt('${escAttr(key)}','dir')" ${computer ? "disabled" : ""}>${icon("folder-plus")}</button>
          <button class="icon-button local-files-create-file" title="新建文件" aria-label="新建文件" onclick="createLocalEntryFromPrompt('${escAttr(key)}','file')" ${computer ? "disabled" : ""}>${icon("file-plus-2")}</button>
          <span class="local-files-toolbar-separator" aria-hidden="true"></span>
          <button class="icon-button" title="新建本地文件标签" aria-label="新建本地文件标签" onclick="showNewLocalFilesMenu(event,'${escAttr(key)}')">${icon("plus")}</button>
        </div>
      </div>
      <div class="local-files-search-wrap">
        <div class="local-files-search">${icon("search")}<input aria-label="搜索当前目录" placeholder="搜索当前目录" value="${esc(runtime.query)}" oninput="setLocalFilesSearch(this.value,'${escAttr(key)}')"><button type="button" class="icon-button" title="清除搜索" aria-label="清除搜索" onclick="clearLocalFilesSearch('${escAttr(key)}')">${icon("x")}</button></div>
      </div>
      <div class="local-files-navigation-row">
        <div class="local-files-path-block">
          <nav class="local-files-breadcrumb" aria-label="本地目录路径" ondblclick="showLocalFilesPathEditor('${escAttr(key)}')">${localFilesBreadcrumbHtml(runtime, key)}</nav>
          <form class="local-files-path-editor" hidden onsubmit="submitLocalFilesPath(event,'${escAttr(key)}')"><input aria-label="本地目录路径" value="${esc(pathValue)}" placeholder="本地目录路径"><button class="icon-button" type="submit" title="转到路径" aria-label="转到路径">${icon("corner-down-left")}</button><button type="button" class="icon-button" title="取消" aria-label="取消" onclick="hideLocalFilesPathEditor('${escAttr(key)}')">${icon("x")}</button></form>
        </div>
        <button class="icon-button local-files-path-edit-button" title="手动输入路径" aria-label="手动输入路径" onclick="showLocalFilesPathEditor('${escAttr(key)}')">${icon("pencil")}</button>
      </div>
      <div class="local-files-selection" hidden><strong>已选择 <span>0</span> 项</strong><div class="local-files-selection-actions"><button type="button" data-local-files-single-action title="打开" aria-label="打开" onclick="openSelectedLocalFiles('${escAttr(key)}')">${icon("folder-open")}<span>打开</span></button><button type="button" title="上传到 SFTP" aria-label="上传到 SFTP" onclick="showLocalFilesUploadMenu(event,'${escAttr(key)}')">${icon("upload")}<span>上传</span></button><button type="button" title="复制路径" aria-label="复制路径" onclick="copySelectedLocalFilePaths('${escAttr(key)}')">${icon("clipboard")}<span>路径</span></button><button type="button" data-local-files-single-action title="重命名" aria-label="重命名" onclick="renameSelectedLocalFile('${escAttr(key)}')">${icon("pencil")}<span>重命名</span></button><button type="button" title="删除" aria-label="删除" class="danger" onclick="deleteSelectedLocalFiles('${escAttr(key)}')">${icon("trash-2")}<span>删除</span></button><button type="button" data-local-files-single-action title="权限" aria-label="权限" onclick="chmodSelectedLocalFile('${escAttr(key)}')">${icon("key-round")}<span>权限</span></button><button class="icon-button" title="取消选择" aria-label="取消选择" onclick="clearLocalFilesSelection('${escAttr(key)}')">${icon("x")}</button></div></div>
    </div>
    <div class="local-files-list" oncontextmenu="showLocalFilesDirectoryMenu(event,'${escAttr(key)}')">${stateView("loading", "正在读取本地目录", computer ? "此电脑" : pathValue || "系统桌面")}</div>
    <div class="local-files-drop-overlay" hidden>${icon("download")}<strong>松开保存到当前本地目录</strong></div>
  </div>`;
  setWorkspace("本地文件", computer ? "此电脑" : pathValue || "系统桌面", "local-files", key, updateTab, true, {kind:"local-files", path:computer ? LOCAL_FILES_COMPUTER_PATH : pathValue, localLocation:computer ? "computer" : "directory"});
  try {
    await loadLocalFiles(key, computer ? {location:"computer", page:runtime.page} : {path:pathValue, page:runtime.page});
    return key;
  } catch (error) {
    notify(error.message || "读取本地目录失败", "error");
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
  const displayRequest = location === "computer" ? "此电脑" : requestedPath || "系统桌面";
  const params = new URLSearchParams({
    page:String(options.page || runtime.page || 1),
    page_size:String(runtime.pageSize || 50),
    query:String(runtime.query || ""),
    sort:String(runtime.sort || "name"),
    dir:String(runtime.dir || "asc")
  });
  if (location === "computer") params.set("location", "computer");
  else params.set("path", String(requestedPath || ""));
  if (!options.refresh) list.innerHTML = stateView("loading", "正在读取本地目录", displayRequest);
  const data = await api(`/api/local-files?${params.toString()}`);
  Object.assign(runtime, {
    path:data.path || "",
    location:data.kind === "computer" ? "computer" : "directory",
    displayPath:data.display_path || data.path || "",
    entries:data.entries || [],
    page:Number(data.page || 1),
    pageSize:Number(data.page_size || 50),
    total:Number(data.total || 0),
    totalPages:Number(data.total_pages || 1),
    parent:data.parent || "",
    parentKind:data.parent_kind || "none"
  });
  if (!runtime.entries.some(entry => String(entry.path) === String(runtime.activePath || ""))) runtime.activePath = "";
  if (!options.historyNavigation) rememberLocalFilesNavigation(tabKey);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(tabKey) : tabs.find(item => item.key === tabKey);
  if (tab) {
    tab.path = runtime.location === "computer" ? LOCAL_FILES_COMPUTER_PATH : runtime.path;
    tab.localLocation = runtime.location;
    tab.subtitle = runtime.displayPath || (runtime.location === "computer" ? "此电脑" : runtime.path);
  }
  const pathInput = root.querySelector(".local-files-path-editor input");
  if (pathInput) pathInput.value = runtime.path;
  const breadcrumb = root.querySelector(".local-files-breadcrumb");
  if (breadcrumb) breadcrumb.innerHTML = localFilesBreadcrumbHtml(runtime, tabKey);
  if (tabKey === activeTabKey) $("workspaceSubtitle").textContent = runtime.displayPath || (runtime.location === "computer" ? "此电脑" : runtime.path);
  syncLocalFilesNavigationButtons(tabKey);
  syncLocalFilesCreateButtons(tabKey);
  renderLocalFiles(tabKey);
  saveTabsState();
}

function renderLocalFiles(tabKey) {
  const runtime = localFilesRuntime(tabKey);
  const root = localFilesRoot(tabKey);
  const list = root?.querySelector(".local-files-list");
  if (!list) return;
  const head = `<div class="local-files-head"><label><input type="checkbox" aria-label="选择当前页全部项目" onchange="toggleAllLocalFiles(this.checked,'${escAttr(tabKey)}')"></label><button onclick="setLocalFilesSort('name','${escAttr(tabKey)}')">名称</button><button onclick="setLocalFilesSort('size','${escAttr(tabKey)}')">大小</button><button onclick="setLocalFilesSort('mtime','${escAttr(tabKey)}')">修改时间</button></div>`;
  const rows = runtime.entries.map(entry => {
    const isDrive = entry.type === "drive";
    const isDir = isDrive || entry.type === "dir";
    const iconMarkup = isDrive ? icon("hard-drive") : sftpIcon(entry.name, isDir);
    const sizeText = isDrive && entry.size ? `${formatBytes(entry.free || 0)} 可用 / ${formatBytes(entry.size)}` : (isDir ? "--" : formatBytes(entry.size));
    const mobileMeta = isDrive ? sizeText : (isDir ? "目录" : sizeText);
    const encodedPath = localFilesInlineArg(entry.path);
    const encodedTabKey = localFilesInlineArg(tabKey);
    const active = String(runtime.activePath || "") === String(entry.path);
    return `<div class="local-files-row ${isDrive ? "is-drive" : ""} ${active ? "active" : ""}" draggable="${isMobileLayout() || isDrive ? "false" : "true"}" data-path="${esc(entry.path)}" onclick="selectLocalFileEntry(event,decodeURIComponent('${encodedPath}'),decodeURIComponent('${encodedTabKey}'))" ondblclick="activateLocalFileEntry(event,decodeURIComponent('${encodedPath}'),'${escAttr(entry.type)}',decodeURIComponent('${encodedTabKey}'))" oncontextmenu="showLocalFileEntryMenu(event,decodeURIComponent('${encodedPath}'),'${escAttr(entry.type)}',decodeURIComponent('${encodedTabKey}'))" ondragstart="beginLocalFileDrag(event,decodeURIComponent('${encodedPath}'),decodeURIComponent('${encodedTabKey}'))" ondragend="finishLocalFileDrag()">
      <input class="local-files-check" type="checkbox" value="${esc(entry.path)}" data-name="${esc(entry.name)}" data-type="${esc(entry.type)}" data-size="${Math.max(0, Number(entry.size || 0))}" aria-label="选择 ${esc(entry.name)}" ${isDrive ? "disabled" : ""} onclick="handleLocalFileCheckboxClick(event,decodeURIComponent('${encodedPath}'),decodeURIComponent('${encodedTabKey}'))">
      <button class="local-files-name" onclick="event.stopPropagation();selectLocalFileEntry(event,decodeURIComponent('${encodedPath}'),decodeURIComponent('${encodedTabKey}'))"><span class="sftp-icon ${isDrive ? "drive" : entry.type}">${iconMarkup}</span><span class="local-files-name-copy"><span class="local-files-file-name">${esc(entry.name)}</span><span class="local-files-mobile-meta">${esc(mobileMeta)}</span></span></button>
      <span class="local-files-size" title="${escAttr(sizeText)}">${esc(sizeText)}</span><span class="local-files-time">${entry.mtime ? formatSftpTime(entry.mtime) : "--"}</span>
    </div>`;
  }).join("");
  const page = Number(runtime.page || 1), totalPages = Number(runtime.totalPages || 1), total = Number(runtime.total || 0);
  const first = total ? (page - 1) * Number(runtime.pageSize || 50) + 1 : 0;
  const last = total ? Math.min(first + runtime.entries.length - 1, total) : 0;
  const pager = `<div class="sftp-pager-dock"><div class="pager sftp-pager"><button onclick="setLocalFilesPage(${page - 1},'${escAttr(tabKey)}')" ${page <= 1 ? "disabled" : ""}>上一页</button><span class="pager-count"><span class="sftp-scroll-cue" title="下方还有文件" aria-hidden="true">${icon("chevron-down")}</span>第 ${page}/${totalPages} 页 · ${first}-${last} / ${total} · <select aria-label="每页数量" onchange="setLocalFilesPageSize(this.value,'${escAttr(tabKey)}')">${[25,50,100,200].map(size => `<option value="${size}" ${size === Number(runtime.pageSize) ? "selected" : ""}>${size} 项</option>`).join("")}</select></span><button onclick="setLocalFilesPage(${page + 1},'${escAttr(tabKey)}')" ${page >= totalPages ? "disabled" : ""}>下一页</button></div></div>`;
  list.innerHTML = head + (rows || stateView("empty", runtime.query ? "没有匹配的本地文件" : "当前目录为空", runtime.path)) + pager;
  watchLocalFilesListLayout(list, tabKey);
  updateLocalFilesSelection(tabKey);
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
  const selected = selectedLocalFiles(tabKey);
  const selectable = localFileChecks(tabKey).filter(input => !input.disabled);
  root?.querySelectorAll(".local-files-row").forEach(row => row.classList.toggle("is-selected", selected.some(item => item.path === row.dataset.path)));
  const selectAll = root?.querySelector(".local-files-head input[type='checkbox']");
  if (selectAll) {
    selectAll.checked = selectable.length > 0 && selected.length === selectable.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < selectable.length;
    selectAll.disabled = selectable.length === 0;
  }
  const bar = root?.querySelector(".local-files-selection");
  if (bar) {
    bar.hidden = selected.length === 0;
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
  const selected = selectedLocalFiles(tabKey);
  const useSelection = !isDrive && selected.some(item => item.path === pathValue);
  const canMutate = !isDrive;
  const selectedPaths = useSelection ? selected.map(item => item.path) : [pathValue];
  const selectionCount = selectedPaths.length;
  const actions = [
    isDir
      ? {label:"打开", icon:"folder-open", run:() => navigateLocalFilesPath(pathValue, tabKey)}
      : {label:"打开 / 编辑", icon:"file-text", run:() => api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:pathValue})}).catch(error => notify(error.message || "打开本地文件失败", "error"))},
    {label:"在系统文件管理器中打开", icon:"external-link", run:() => api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:isDir ? pathValue : localFilesRuntime(tabKey).path})}).catch(error => notify(error.message || "打开本地路径失败", "error"))},
    {label:selectionCount > 1 ? `复制 ${selectionCount} 个路径` : "复制路径", icon:"clipboard", run:() => copyText(selectedPaths.join("\n"))},
    {separator:true},
    ...(canMutate && selectionCount === 1 ? [{label:"重命名", icon:"pencil", run:() => renameLocalPath(pathValue, tabKey)}] : []),
    ...(canMutate ? [{label:selectionCount > 1 ? `删除已选 ${selectionCount} 项` : "删除", icon:"trash-2", danger:true, run:() => deleteLocalFiles(selectedPaths, tabKey)}] : []),
    ...(window.termaDesktop && canMutate ? [{label:"上传到 SFTP", icon:"upload", children:() => localFilesUploadActions(tabKey)}] : []),
    ...(canMutate && selectionCount === 1 ? [{label:"设置权限", icon:"key-round", run:() => chmodLocalPath(pathValue, tabKey)}] : [])
  ];
  showActionMenu(event, actions);
}

function showLocalFilesDirectoryMenu(event, tabKey) {
  if (event.target?.closest?.(".local-files-row, .local-files-head, .sftp-pager, button, input, select")) return;
  event.preventDefault();
  event.stopPropagation();
  const canCreate = localFilesRuntime(tabKey).location !== "computer";
  showActionMenu(event, [
    ...(canCreate ? [{label:"新建文件", icon:"file-plus-2", run:() => createLocalEntryFromPrompt(tabKey, "file")}] : []),
    ...(canCreate ? [{label:"新建文件夹", icon:"folder-plus", run:() => createLocalEntryFromPrompt(tabKey, "dir")}] : []),
    ...(selectedLocalFiles(tabKey).length ? [{separator:true}, {label:"删除已选项目", icon:"trash-2", danger:true, run:() => deleteSelectedLocalFiles(tabKey)}] : []),
    {separator:true},
    {label:"刷新", icon:"refresh-cw", run:() => localFilesMutationRefresh(tabKey)}
  ]);
}

async function createLocalEntryFromPrompt(tabKey, type) {
  if (localFilesRuntime(tabKey).location === "computer") return notify("请先进入一个磁盘或目录后再新建项目", "info");
  const name = await inputModal(type === "dir" ? "新建文件夹" : "新建文件", "名称");
  if (!name) return;
  const runtime = localFilesRuntime(tabKey);
  try {
    await api("/api/local-files/create", {method:"POST", body:JSON.stringify({directory:runtime.path, name, type})});
    await localFilesMutationRefresh(tabKey);
    notify(type === "dir" ? "文件夹已创建" : "文件已创建", "success");
  } catch (error) { notify(error.message || "创建本地项目失败", "error"); }
}

async function renameLocalPath(pathValue, tabKey) {
  const entry = localFilesEntry(tabKey, pathValue);
  const name = await inputModal("重命名", "新名称", entry?.name || String(pathValue).split(/[\\/]/).pop());
  if (!name) return;
  try {
    await api("/api/local-files/rename", {method:"POST", body:JSON.stringify({path:pathValue, new_name:name})});
    await localFilesMutationRefresh(tabKey);
    notify("已重命名", "success");
  } catch (error) { notify(error.message || "重命名失败", "error"); }
}

async function deleteLocalFiles(paths, tabKey) {
  const items = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!items.length) return notify("请选择文件或目录", "info");
  if (!await confirmModal(`确认删除 ${items.length} 个本地项目？删除后无法通过 Terma 恢复。`, "删除本地项目", "删除", "取消", true)) return;
  try {
    await api("/api/local-files/delete", {method:"POST", body:JSON.stringify({paths:items})});
    await localFilesMutationRefresh(tabKey);
    clearLocalFilesSelection(tabKey);
    notify(`已删除 ${items.length} 个本地项目`, "success");
  } catch (error) { notify(error.message || "删除本地项目失败", "error"); }
}

function deleteSelectedLocalFiles(tabKey) {
  return deleteLocalFiles(selectedLocalFiles(tabKey).map(item => item.path), tabKey);
}

async function renameSelectedLocalFile(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify("重命名一次只能选择一个项目", "info");
  return renameLocalPath(selected[0].path, tabKey);
}

async function chmodLocalPath(pathValue, tabKey) {
  if (navigator.platform?.toLowerCase().includes("win")) return notify("Windows 不支持 POSIX 权限设置", "info");
  const entry = localFilesEntry(tabKey, pathValue);
  const mode = await inputModal("设置权限", "权限（例如 644 或 755）", entry?.mode || "644");
  if (!mode) return;
  try {
    await api("/api/local-files/chmod", {method:"POST", body:JSON.stringify({path:pathValue, mode})});
    await localFilesMutationRefresh(tabKey);
    notify("权限已更新", "success");
  } catch (error) { notify(error.message || "设置权限失败", "error"); }
}

async function chmodSelectedLocalFile(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify("设置权限一次只能选择一个项目", "info");
  return chmodLocalPath(selected[0].path, tabKey);
}

async function openSelectedLocalFiles(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (selected.length !== 1) return notify("打开一次只能选择一个项目", "info");
  const item = selected[0];
  if (item.type === "dir" || item.type === "drive") return navigateLocalFilesPath(item.path, tabKey);
  return api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:item.path})}).catch(error => notify(error.message || "打开本地文件失败", "error"));
}

async function copySelectedLocalFilePaths(tabKey) {
  const selected = selectedLocalFiles(tabKey);
  if (!selected.length) return notify("请选择文件或目录", "info");
  return copyText(selected.map(item => item.path).join("\n"));
}

function localFilesUploadActions(tabKey) {
  const payload = {paths:localFilesSelectedPayload(tabKey).map(item => item.path), entries:localFilesSelectedPayload(tabKey)};
  if (!payload.paths.length) return [];
  const active = tabs.find(tab => tab.key === activeTabKey && tab.kind === "sftp");
  const targets = [];
  if (active) targets.push({label:`上传到当前 SFTP：${active.title || active.name || active.id}`, icon:"folder-up", run:() => uploadLocalFilesToSftp(payload, active, active.key)});
  for (const connection of (connections || [])) {
    if (active && Number(active.id) === Number(connection.id)) continue;
    targets.push({label:`${connection.name || connection.ssh_host} · SFTP`, icon:"server", run:() => uploadLocalFilesToSftp(payload, {kind:"sftp", id:connection.id, title:connection.name || connection.ssh_host, path:"."}, tabKey)});
  }
  return targets;
}

function showLocalFilesUploadMenu(event, tabKey) {
  const targets = localFilesUploadActions(tabKey);
  if (!selectedLocalFiles(tabKey).length) return notify("请选择要上传的文件或目录", "info");
  if (!targets.length) return notify("暂无可用的 SFTP 连接", "info");
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
    list.addEventListener("scroll", () => syncLocalFilesScrollCue(list), {passive:true});
  }
  syncLocalFilesScrollCue(list);
  requestAnimationFrame(() => syncLocalFilesScrollCue(list));
  const runtime = localFilesRuntime(tabKey);
  runtime.resizeObserver?.disconnect?.();
  if (typeof ResizeObserver === "function") {
    runtime.resizeObserver = new ResizeObserver(() => syncLocalFilesScrollCue(list));
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
  if (event.shiftKey || event.ctrlKey || event.metaKey) applyLocalFileRangeSelection(event, pathValue, tabKey);
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
  const key = localFilesInlineArg(tabKey);
  if (runtime.location === "computer") return `<button class="crumb active" type="button" aria-current="page" onclick="navigateLocalFilesComputer(decodeURIComponent('${key}'))">${icon("monitor")}<span>此电脑</span></button>`;
  const value = String(runtime.path || "");
  if (!value) return `<button class="crumb active" type="button" aria-current="page" onclick="navigateLocalFilesComputer(decodeURIComponent('${key}'))">${icon("monitor")}<span>本地文件</span></button>`;
  const isWindows = /^[A-Za-z]:[\\/]/.test(value);
  const parts = isWindows ? value.replace(/[\\/]+$/, "").split(/[\\/]/) : value.split("/");
  const crumbs = [];
  if (isWindows) {
    const drive = `${parts.shift()}\\`;
    crumbs.push(`<button class="crumb" type="button" onclick="navigateLocalFilesComputer(decodeURIComponent('${key}'))">${icon("monitor")}<span>此电脑</span></button><span class="crumb-sep">${icon("chevron-right")}</span>`);
    let current = drive;
    crumbs.push(`<button class="crumb ${parts.length ? "" : "active"}" type="button" ${parts.length ? "" : "aria-current=\"page\""} onclick="navigateLocalFilesPath(decodeURIComponent('${localFilesInlineArg(current)}'),decodeURIComponent('${key}'))"><span>${esc(current.replace(/\\$/, ""))}</span></button>`);
    for (let index = 0; index < parts.length; index += 1) {
      if (!parts[index]) continue;
      current += `${current.endsWith("\\") ? "" : "\\"}${parts[index]}`;
      crumbs.push(`<span class="crumb-sep">${icon("chevron-right")}</span><button class="crumb ${index === parts.length - 1 ? "active" : ""}" type="button" ${index === parts.length - 1 ? "aria-current=\"page\"" : ""} onclick="navigateLocalFilesPath(decodeURIComponent('${localFilesInlineArg(current)}'),decodeURIComponent('${key}'))"><span>${esc(parts[index])}</span></button>`);
    }
  } else {
    crumbs.push(`<button class="crumb ${parts.length <= 1 ? "active" : ""}" type="button" onclick="navigateLocalFilesPath('/',decodeURIComponent('${key}'))"><span>/</span></button>`);
    let current = "";
    for (let index = 0; index < parts.length; index += 1) {
      if (!parts[index]) continue;
      current += `/${parts[index]}`;
      crumbs.push(`<span class="crumb-sep">${icon("chevron-right")}</span><button class="crumb ${index === parts.length - 1 ? "active" : ""}" type="button" ${index === parts.length - 1 ? "aria-current=\"page\"" : ""} onclick="navigateLocalFilesPath(decodeURIComponent('${localFilesInlineArg(current)}'),decodeURIComponent('${key}'))"><span>${esc(parts[index])}</span></button>`);
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
  return api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:pathValue})}).catch(error => notify(error.message || "打开本地文件失败", "error"));
}

function submitLocalFilesPath(event, tabKey) {
  event.preventDefault();
  const value = event.currentTarget.querySelector("input")?.value || "";
  hideLocalFilesPathEditor(tabKey);
  return navigateLocalFilesPath(value, tabKey).catch(error => notify(error.message || "打开本地目录失败", "error"));
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
  localFileChecks(tabKey).forEach(input => { if (!input.disabled) input.checked = Boolean(checked); });
  updateLocalFilesSelection(tabKey);
}

function setLocalFilesPageSize(value, tabKey) {
  const runtime = localFilesRuntime(tabKey);
  runtime.pageSize = Math.max(25, Math.min(200, Number(value || 50)));
  return loadLocalFiles(tabKey, {page:1});
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

function beginLocalFileDrag(event, pathValue, tabKey) {
  let entries = selectedLocalFiles(tabKey);
  if (!entries.some(item => item.path === pathValue)) {
    const runtimeEntry = localFilesRuntime(tabKey).entries.find(item => item.path === pathValue);
    entries = runtimeEntry ? [runtimeEntry] : [];
  }
  if (!entries.length) return event.preventDefault();
  const payload = {sourceTabKey:String(tabKey || ""), paths:entries.map(item => String(item.path)), entries};
  localFileInternalDrag = payload;
  localFileInternalDragHandoff = null;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(LOCAL_FILES_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", entries.map(item => item.path).join("\n"));
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
}

function bindLocalFileDragLifecycle() {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function" || document.__termaLocalFileDragLifecycleBound) return;
  document.__termaLocalFileDragLifecycleBound = true;
  document.addEventListener("dragend", event => finishLocalFileDrag(event), true);
  document.addEventListener("drop", () => setTimeout(() => finishLocalFileDrag({immediate:true}), 0), true);
}

bindLocalFileDragLifecycle();

async function uploadLocalFilesToSftp(payload, target, tabKey="") {
  if (!payload?.paths?.length || !["sftp", "terminal"].includes(String(target?.kind || ""))) return;
  const runtime = target.kind === "sftp" ? sftpTabRuntimes.get(String(target.key || tabKey || "")) : null;
  const directory = runtime?.state.path || target.path || ".";
  const conflict = typeof sftpConflictChoice === "function"
    ? await sftpConflictChoice(Number(target.id), directory, payload.entries || [], {title:`${target.title || "目标目录"}存在同名项目`})
    : "error";
  if (conflict === "cancel") return;
  const result = await api("/api/local-files/upload", {method:"POST", body:JSON.stringify({connection_id:Number(target.id), paths:payload.paths, target:directory, conflict})});
  for (const job of result.jobs || []) trackSftpMutationJob(job);
  refreshSftpJobs();
  notify(`已开始上传 ${result.count || payload.paths.length} 个项目到 ${directory}`, "success");
}

async function localFilesReceiveConflictChoice(directory, entries) {
  const paths = (entries || []).map(item => String(item?.path || "")).filter(Boolean);
  const plan = await api("/api/local-files/receive-plan", {
    method:"POST",
    body:JSON.stringify({paths, target:directory})
  });
  const conflicts = (plan.items || []).filter(item => item.exists);
  if (!conflicts.length) return "error";
  const preview = conflicts.slice(0, 6).map(item => item.name).join("、");
  return chooseModal("本地目录存在同名项目", `${preview}${conflicts.length > 6 ? ` 等 ${conflicts.length} 项` : ""}`, [
    {label:"覆盖", value:"overwrite", className:"danger"},
    {label:"自动重命名", value:"rename", className:"primary"},
    {label:"取消", value:"cancel"}
  ]);
}

async function copySftpDraggedItemsToLocalTab(drag, target) {
  if (!drag?.entries?.length || target?.kind !== "local-files") return;
  finishSftpDragPayload(drag);
  const runtime = localFilesRuntime(target.key);
  if (runtime.location === "computer") throw new Error("请先打开一个本地磁盘或目录，再保存远程文件");
  const directory = runtime.path || target.path || "";
  const conflict = await localFilesReceiveConflictChoice(directory, drag.entries);
  if (conflict === "cancel") return;
  const job = await api("/api/local-files/receive", {method:"POST", body:JSON.stringify({connection_id:Number(drag.connectionId), paths:drag.entries.map(item => item.path), target:directory, conflict})});
  trackLocalDeliveryJobTarget(job, target.key, directory);
  trackSftpMutationJob(job);
  await refreshSftpJobs();
  startSftpJobsTimer();
  notify(`后台传输已开始：${drag.entries.length} 个项目到 ${directory}`, "info");
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

function handleLocalFilesDragLeave(event, tabKey) {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
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
    notify(error.message || "保存远程文件失败", "error");
  }
}

async function sendSftpPathsToDesktop(connectionId, paths) {
  if (!paths?.length) return;
  const job = await api("/api/local-files/receive-desktop", {method:"POST", body:JSON.stringify({connection_id:Number(connectionId), paths})});
  trackSftpMutationJob(job);
  await refreshSftpJobs();
  startSftpJobsTimer();
  notify(`后台传输已开始：${paths.length} 个项目到桌面`, "info");
  return job;
}

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
