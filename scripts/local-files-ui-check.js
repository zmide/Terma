"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const localUiSource = fs.readFileSync(path.join(root, "public", "app-local-files.js"), "utf8");
const sftpUiSource = readFrontendDomain(root, "sftp");
const terminalUiSource = readFrontendDomain(root, "terminal");
const css = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    toggle(value, force) {
      const enabled = force === undefined ? !values.has(value) : Boolean(force);
      if (enabled) values.add(value);
      else values.delete(value);
      return enabled;
    }
  };
}

function createLocalFilesUiModel() {
  const checks = ["C:\\work\\alpha.txt", "C:\\work\\beta.txt", "C:\\work\\gamma.txt"].map((value, index) => ({
    value,
    checked:false,
    disabled:false,
    dataset:{name:path.win32.basename(value), type:"file", size:String(index + 1)}
  }));
  const rows = checks.map(input => ({dataset:{path:input.value}, classList:createClassList()}));
  const selectionCount = {textContent:""};
  const singleActionButtons = [{disabled:false}, {disabled:false}, {disabled:false}];
  const selectionBar = {
    hidden:true,
    querySelector:selector => selector === "span" ? selectionCount : null,
    querySelectorAll:selector => selector === "[data-local-files-single-action]" ? singleActionButtons : []
  };
  const selectAll = {checked:false, indeterminate:false, disabled:false};
  const list = {
    dataset:{},
    classList:createClassList(),
    scrollHeight:360,
    scrollTop:0,
    clientHeight:120,
    innerHTML:"",
    addEventListener() {}
  };
  const view = {
    dataset:{workspaceTabKey:""},
    innerHTML:"",
    querySelector(selector) {
      return selector === ".local-files-shell" && this.innerHTML ? {} : null;
    }
  };
  const rootElement = {
    querySelector(selector) {
      if (selector === ".local-files-list") return list;
      if (selector === ".local-files-head input[type='checkbox']") return selectAll;
      if (selector === ".local-files-selection") return selectionBar;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".local-files-check") return checks;
      if (selector === ".local-files-row") return rows;
      return [];
    }
  };
  const apiCalls = [];
  const conflictCalls = [];
  const trackedJobs = [];
  const notifications = [];
  const workspaceCalls = [];
  let capturedMenu = [];
  let conflictChoice = "rename";
  let localReceiveChoice = "rename";

  const sandbox = {
    console,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Array,
    URLSearchParams,
    CSS:{escape:value => String(value)},
    window:{termaDesktop:true},
    document:{querySelector:() => null, querySelectorAll:() => [], getElementById:() => null},
    navigator:{platform:"Win32"},
    tabs:[{key:"sftp-main", kind:"sftp", id:7, title:"主机 A"}],
    connections:[{id:7, name:"主机 A", ssh_host:"host-a.invalid"}],
    activeTabKey:"sftp-main",
    focusedPaneId:"",
    sftpTabRuntimes:new Map([["sftp-main", {state:{path:"/srv/uploads"}}]]),
    renderTabContent() {},
    closeTabsByKey() {},
    workspaceElementForTab:() => rootElement,
    workspaceTabByKey:key => sandbox.tabs.find(tab => tab.key === key) || null,
    $:id => id === "view-local-files" ? view : null,
    icon:name => `<i data-icon="${name}"></i>`,
    esc:value => String(value ?? ""),
    escAttr:value => String(value ?? ""),
    isMobileLayout:() => false,
    notify(message, type) { notifications.push({message, type}); },
    showActionMenu(_event, actions) { capturedMenu = actions; },
    stateView:() => "",
    sftpIcon:() => "",
    formatBytes:value => `${value} B`,
    formatSftpTime:value => String(value),
    requestAnimationFrame(callback) { callback(); return 1; },
    setWorkspace(...args) { workspaceCalls.push(args); },
    saveTabsState() {},
    copyText() {},
    inputModal:async () => "",
    confirmModal:async () => false,
    chooseModal:async () => localReceiveChoice,
    trackSftpMutationJob(job) { trackedJobs.push(job); },
    refreshSftpJobs() {},
    startSftpJobsTimer() {},
    sftpConflictChoice:async (...args) => {
      conflictCalls.push(args);
      return conflictChoice;
    },
    activeSftpDragPayload:() => null,
    finishSftpDragPayload() {},
    api:async (url, options = {}) => {
      apiCalls.push({url, options});
      return {jobs:[{id:`job-${apiCalls.length}`}], count:2};
    }
  };
  sandbox.globalThis = sandbox;

  const exposed = `${localUiSource}\n;globalThis.__localFilesUiModel = {
  localFilesRuntime,
    openLocalFiles,
    updateLocalFilesSelection,
    applyLocalFileRangeSelection,
    selectLocalFileEntry,
    createLocalEntryFromPrompt,
    clearLocalFilesSelection,
    showLocalFileEntryMenu,
    showLocalFilesDirectoryMenu,
    beginLocalFileDrag,
    finishLocalFileDrag,
    readLocalFileDragPayload,
    uploadLocalFilesToSftp,
    localFilesReceiveConflictChoice,
    copySftpDraggedItemsToLocalTab,
    captureLocalFilesScrollPosition,
    captureLocalFilesScrollAnchor,
    restoreLocalFilesScrollPosition,
    setLocalFilesPageSize,
    renderLocalFiles,
    syncLocalFilesScrollCue
  };`;
  vm.runInNewContext(exposed, sandbox, {filename:"public/app-local-files.js", timeout:5000});

  return {
    model:sandbox.__localFilesUiModel,
    sandbox,
    checks,
    rows,
    selectionBar,
    selectionCount,
    singleActionButtons,
    selectAll,
    list,
    apiCalls,
    conflictCalls,
    trackedJobs,
    notifications,
    view,
    workspaceCalls,
    getMenu:() => capturedMenu,
    setConflictChoice:value => { conflictChoice = value; },
    setLocalReceiveChoice:value => { localReceiveChoice = value; }
  };
}

function menuEvent({blank = false} = {}) {
  return {
    clientX:20,
    clientY:20,
    preventDefault() {},
    stopPropagation() {},
    target:{closest:() => blank ? null : null}
  };
}

async function main() {
  assert.match(sftpUiSource, /function selectSftpEntry[\s\S]*?if \(!event\?\.preserveSelection\) applySftpRangeSelection/, "SFTP 单击条目必须同步复选框，右键已选项则保留现有多选");
  const state = createLocalFilesUiModel();
  const {model, sandbox, checks, rows, selectionBar, selectionCount, singleActionButtons, selectAll, list, view, workspaceCalls} = state;
  const runtime = model.localFilesRuntime("local-main");
  runtime.entries = checks.map((input, index) => ({
    path:input.value,
    name:input.dataset.name,
    type:"file",
    size:index + 1,
    mtime:0
  }));

  runtime.path = "C:\\work";
  runtime.location = "directory";
  runtime.displayPath = "C:\\work";
  runtime.loaded = true;
  view.dataset.workspaceTabKey = "local-main";
  view.innerHTML = '<div class="local-files-shell"></div>';
  const apiCallsBeforeReuse = state.apiCalls.length;
  await model.openLocalFiles("C:\\work", false, "local-main");
  assert.equal(state.apiCalls.length, apiCallsBeforeReuse, "分屏重新挂载同一本地文件标签不得重复读取目录");
  assert.equal(view.innerHTML, '<div class="local-files-shell"></div>', "分屏重新挂载同一本地文件标签不得重建现有视图");
  assert.ok(workspaceCalls.length > 0, "分屏重新挂载同一本地文件标签仍必须同步工作区活动视图");

  model.selectLocalFileEntry({shiftKey:false, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[0].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [true, false, false], "普通单击文件名必须勾选当前项目");
  assert.equal(runtime.activePath, checks[0].value, "普通单击必须保留当前焦点项目");
  assert.equal(selectionBar.hidden, true, "只勾选一个项目不得显示批量操作栏");

  checks[0].checked = true;
  runtime.anchorPath = checks[0].value;
  model.updateLocalFilesSelection("local-main");
  assert.ok(singleActionButtons.every(button => !button.disabled), "点击复选框单选时打开/重命名/权限按钮必须可用");
  model.selectLocalFileEntry({shiftKey:false, ctrlKey:true, metaKey:false, target:{closest:() => null}}, checks[2].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [true, false, true], "Ctrl/Cmd 点击文件名必须增量多选");
  assert.equal(selectionBar.hidden, false);
  assert.equal(selectionCount.textContent, "2");
  assert.equal(selectAll.indeterminate, true);
  assert.ok(singleActionButtons.every(button => button.disabled), "多选时仅支持单项的打开/重命名/权限按钮必须禁用");
  assert.deepEqual(rows.map(row => row.classList.contains("is-selected")), [true, false, true]);

  model.selectLocalFileEntry({shiftKey:false, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[1].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [true, true, true], "已有多个勾选项时点击未选文件名必须追加选择");
  model.selectLocalFileEntry({shiftKey:false, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[1].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [true, false, true], "已有多个勾选项时再次点击文件名必须取消该项");
  model.selectLocalFileEntry({shiftKey:false, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[0].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, false, true], "已有两个勾选项时点击其中一项必须允许取消选择");
  model.selectLocalFileEntry({shiftKey:false, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[1].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, true, false], "只剩一个勾选项时点击其他文件名必须切换为单选");
  checks[0].checked = true;
  checks[1].checked = false;
  checks[2].checked = true;
  runtime.anchorPath = checks[2].value;
  model.updateLocalFilesSelection("local-main");

  const selectionBeforeContextMenu = checks.map(input => input.checked);
  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, checks[1].dataset.name, "file", "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, true, false], "右键未选中项目必须切换为单选，和 SFTP 保持一致");

  checks.forEach((input, index) => { input.checked = selectionBeforeContextMenu[index]; });
  runtime.anchorPath = checks[2].value;
  model.updateLocalFilesSelection("local-main");

  model.selectLocalFileEntry({shiftKey:true, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[1].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, true, true], "Shift 点击必须选择锚点到当前项的连续范围");
  assert.equal(selectionCount.textContent, "2");

  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, checks[1].dataset.name, "file", "local-main");
  const multiFileMenu = state.getMenu();
  const multiFileMenuLabels = multiFileMenu.filter(item => !item.separator).map(item => item.label);
  for (const label of ["打开 / 编辑", "在系统文件管理器中打开", "复制 2 个路径", "删除已选 2 项", "上传到 SFTP"]) {
    assert.ok(multiFileMenuLabels.includes(label), `本地文件多选右键菜单缺少“${label}”`);
  }
  assert.equal(multiFileMenuLabels.includes("重命名"), false, "多选右键菜单不得提供单项重命名");
  assert.equal(multiFileMenuLabels.includes("设置权限"), false, "多选右键菜单不得提供单项权限编辑");

  const uploadSubmenu = multiFileMenu.find(item => item.label === "上传到 SFTP");
  assert.equal(typeof uploadSubmenu?.children, "function", "上传入口必须使用可展开的二级菜单");
  const uploadTargets = uploadSubmenu.children();
  assert.ok(uploadTargets.some(item => item.label.includes("当前 SFTP")), "上传二级菜单必须包含当前 SFTP 目标");
  assert.equal(uploadTargets.length, 1, "当前 SFTP 与连接列表指向同一主机时不得重复显示目标");

  model.applyLocalFileRangeSelection({shiftKey:false, ctrlKey:false, metaKey:false}, checks[1].value, "local-main");
  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, checks[1].dataset.name, "file", "local-main");
  const fileMenuLabels = state.getMenu().filter(item => !item.separator).map(item => item.label);
  for (const label of ["打开 / 编辑", "在系统文件管理器中打开", "复制路径", "重命名", "删除", "上传到 SFTP", "设置权限"]) {
    assert.ok(fileMenuLabels.includes(label), `本地文件右键菜单缺少“${label}”`);
  }
  model.applyLocalFileRangeSelection({shiftKey:false, ctrlKey:true, metaKey:false}, checks[2].value, "local-main");

  model.showLocalFilesDirectoryMenu(menuEvent({blank:true}), "local-main");
  const blankMenuLabels = state.getMenu().filter(item => !item.separator).map(item => item.label);
  for (const label of ["新建文件", "新建文件夹", "删除已选项目", "刷新"]) {
    assert.ok(blankMenuLabels.includes(label), `本地文件空白区域右键菜单缺少“${label}”`);
  }

  sandbox.inputModal = async () => "new-item";
  await model.createLocalEntryFromPrompt("local-main", "dir");
  await model.createLocalEntryFromPrompt("local-main", "file");
  const createCalls = state.apiCalls.filter(call => call.url === "/api/local-files/create").map(call => JSON.parse(call.options.body));
  assert.deepEqual(createCalls.map(call => call.type), ["dir", "file"], "工具栏新建文件夹和文件必须复用本地创建接口");
  assert.ok(localUiSource.includes('local-files-create-directory') && localUiSource.includes('data-entry-kind="dir"') && localUiSource.includes('registerTermaAction("local-files-create"'), "本地文件工具栏必须提供新建文件夹按钮");
  assert.ok(localUiSource.includes('local-files-create-file') && localUiSource.includes('data-entry-kind="file"') && localUiSource.includes('createLocalEntryFromPrompt(element.dataset.tabKey, element.dataset.entryKind)'), "本地文件工具栏必须提供新建文件按钮");

  const dragData = new Map();
  const dataTransfer = {
    effectAllowed:"none",
    get types() { return [...dragData.keys()]; },
    setData(type, value) { dragData.set(type, String(value)); },
    getData(type) { return dragData.get(type) || ""; }
  };
  const dragRow = {classList:createClassList()};
  model.beginLocalFileDrag({dataTransfer, currentTarget:dragRow, preventDefault() {}}, checks[1].value, "local-main");
  assert.equal(dataTransfer.effectAllowed, "copy");
  assert.equal(dragRow.classList.contains("is-dragging"), true, "本地拖拽源行必须进入拖拽反馈状态");
  const dragPayload = model.readLocalFileDragPayload(dataTransfer);
  assert.deepEqual(Array.from(dragPayload.paths), [checks[1].value, checks[2].value], "拖拽必须携带当前多选集合");
  assert.equal(dragData.get("text/plain"), `${checks[1].value}\n${checks[2].value}`);
  model.finishLocalFileDrag({immediate:true});
  checks.forEach(input => { input.checked = false; });
  const unselectedDragData = new Map();
  const unselectedDragTransfer = {
    effectAllowed:"none",
    get types() { return [...unselectedDragData.keys()]; },
    setData(type, value) { unselectedDragData.set(type, String(value)); },
    getData(type) { return unselectedDragData.get(type) || ""; }
  };
  const unselectedDragRow = {classList:createClassList()};
  model.beginLocalFileDrag({dataTransfer:unselectedDragTransfer, currentTarget:unselectedDragRow, preventDefault() {}}, checks[0].value, "local-main");
  assert.deepEqual(Array.from(model.readLocalFileDragPayload(unselectedDragTransfer).paths), [checks[0].value], "未勾选项目直接拖动时必须先成为单项选择");
  assert.equal(checks[0].checked, true, "未勾选项目直接拖动时必须勾选对应复选框");
  assert.deepEqual(rows.map(row => row.classList.contains("is-selected")), [true, false, false], "拖动未选项目时行背景必须与复选框同步");
  assert.deepEqual(rows.map(row => row.classList.contains("active")), [true, false, false], "拖动未选项目时旧活动行必须清除且拖动项成为活动行");
  model.finishLocalFileDrag({immediate:true});
  checks[0].checked = false;
  checks[1].checked = true;
  checks[2].checked = true;
  model.updateLocalFilesSelection("local-main");
  runtime.entries = checks.map((input, index) => ({
    path:input.value,
    name:input.dataset.name,
    type:"file",
    size:index + 1,
    mtime:0
  }));
  model.renderLocalFiles("local-main");
  assert.match(list.innerHTML, /class="local-files-row[^>]*draggable="true"[^>]*data-dragstart-action="local-files-entry-drag-start"/, "本地文件行必须作为唯一的拖拽源");
  assert.doesNotMatch(list.innerHTML, /class="local-files-name"[^>]*draggable=/, "文件名按钮不能再成为嵌套拖拽源");
  model.beginLocalFileDrag({dataTransfer, currentTarget:dragRow, preventDefault() {}}, checks[1].value, "local-main");

  const protectedDataTransfer = {
    types:["text/plain", "application/x-terma-local-files"],
    getData() { return ""; }
  };
  const protectedPayload = model.readLocalFileDragPayload(protectedDataTransfer);
  assert.deepEqual(Array.from(protectedPayload.paths), [checks[1].value, checks[2].value], "dragover 受保护阶段必须从当前本地拖拽缓存恢复载荷");
  const strippedDataTransfer = {
    types:["text/plain"],
    getData() { return ""; }
  };
  const strippedPayload = model.readLocalFileDragPayload(strippedDataTransfer);
  assert.deepEqual(Array.from(strippedPayload.paths), [checks[1].value, checks[2].value], "Electron 隐藏自定义 MIME 时仍必须保留当前内部拖拽载荷");
  model.finishLocalFileDrag({type:"dragend"});
  assert.deepEqual(Array.from(model.readLocalFileDragPayload(protectedDataTransfer).paths), [checks[1].value, checks[2].value], "Electron 提前触发 dragend 时必须短暂保留当前内部拖拽载荷");
  model.finishLocalFileDrag({immediate:true});
  assert.equal(model.readLocalFileDragPayload(protectedDataTransfer), null, "完成 drop 后必须清理本地载荷，避免污染下一次外部拖拽");
  model.beginLocalFileDrag({dataTransfer, currentTarget:dragRow, preventDefault() {}}, checks[1].value, "local-main");

  await model.uploadLocalFilesToSftp(dragPayload, {kind:"sftp", id:7, key:"sftp-main", title:"主机 A"}, "sftp-main");
  let uploadCall = state.apiCalls.at(-1);
  let uploadBody = JSON.parse(uploadCall.options.body);
  assert.equal(uploadCall.url, "/api/local-files/upload");
  assert.equal(uploadBody.target, "/srv/uploads", "拖入 SFTP 必须上传到该标签当前目录");
  assert.equal(uploadBody.conflict, "rename", "本地上传必须沿用覆盖/改名/取消冲突选择");
  assert.deepEqual(uploadBody.paths, Array.from(dragPayload.paths));

  await model.uploadLocalFilesToSftp(dragPayload, {kind:"terminal", id:7, title:"终端", path:"/home/operator/project"}, "terminal-main");
  uploadCall = state.apiCalls.at(-1);
  uploadBody = JSON.parse(uploadCall.options.body);
  assert.equal(uploadBody.target, "/home/operator/project", "拖入终端必须上传到探测到的终端当前目录");
  assert.equal(uploadBody.connection_id, 7);
  assert.equal(state.conflictCalls.length, 2);
  assert.equal(state.trackedJobs.length, 2);

  const callsBeforeCancel = state.apiCalls.length;
  state.setConflictChoice("cancel");
  await model.uploadLocalFilesToSftp(dragPayload, {kind:"terminal", id:7, title:"终端", path:"/tmp"}, "terminal-main");
  assert.equal(state.apiCalls.length, callsBeforeCancel, "冲突对话框选择取消后不得创建上传任务");

  runtime.path = "C:\\work";
  sandbox.api = async (url, options = {}) => {
    state.apiCalls.push({url, options});
    if (url === "/api/local-files/receive-plan") return {items:[{name:"alpha.txt", exists:true}]};
    if (url === "/api/local-files/receive") return {id:"local-delivery-1", type:"local-delivery", status:"pending", target_directory:"C:\\work"};
    if (url.startsWith("/api/local-files?")) return {kind:"directory", path:runtime.path, display_path:runtime.path, parent:"C:\\", parent_kind:"directory", entries:[], page:1, page_size:50, total:0, total_pages:1};
    return {};
  };
  const remoteDrag = {connectionId:7, entries:[{path:"/srv/alpha.txt", name:"alpha.txt"}]};
  await model.copySftpDraggedItemsToLocalTab(remoteDrag, {key:"local-main", kind:"local-files", path:runtime.path});
  const receiveCall = state.apiCalls.findLast(call => call.url === "/api/local-files/receive");
  assert.ok(receiveCall, "远端拖入本地标签必须创建保存请求");
  assert.equal(JSON.parse(receiveCall.options.body).conflict, "rename", "同名项目选择自动重命名后必须把策略传给后端");
  assert.ok(state.trackedJobs.some(job => job?.id === "local-delivery-1" && job?.type === "local-delivery"), "远端拖入本地标签必须把后台任务交给任务中心跟踪");

  const receiveCallsBeforeCancel = state.apiCalls.filter(call => call.url === "/api/local-files/receive").length;
  state.setLocalReceiveChoice("cancel");
  await model.copySftpDraggedItemsToLocalTab(remoteDrag, {key:"local-main", kind:"local-files", path:runtime.path});
  assert.equal(state.apiCalls.filter(call => call.url === "/api/local-files/receive").length, receiveCallsBeforeCancel, "远端拖入本地标签选择取消后不得保存文件");

  Object.assign(runtime, {page:1, pageSize:50, total:75, totalPages:2});
  model.renderLocalFiles("local-main");
  assert.match(list.innerHTML, /class="sftp-pager-dock"/);
  assert.match(list.innerHTML, /class="pager sftp-pager"/);
  assert.match(list.innerHTML, /<span class="pager-count">[\s\S]*?<select aria-label="每页数量" data-change-action="local-files-page-limit"/);
  assert.match(list.innerHTML, /<option value="50" selected>50 项<\/option>/);
  assert.match(list.innerHTML, /class="sftp-scroll-cue"[^>]*title="下方还有文件"/);
  assert.doesNotMatch(list.innerHTML, /class="local-files-page-size"/, "本地分页应直接复用 SFTP 的原生 select 结构");
  assert.equal(list.classList.contains("has-scroll-below"), true);
  list.scrollTop = list.scrollHeight - list.clientHeight;
  model.syncLocalFilesScrollCue(list);
  assert.equal(list.classList.contains("has-scroll-below"), false, "滚动到底部后下方文件提示必须消失");

  runtime.page = 2;
  runtime.pageSize = 50;
  runtime.total = 160;
  runtime.totalPages = 4;
  list.scrollHeight = 540;
  list.clientHeight = 120;
  list.scrollTop = 420;
  let requestedPageSize = 0;
  let requestedPage = 0;
  sandbox.api = async url => {
    const query = new URL(url, "http://localhost").searchParams;
    requestedPageSize = Number(query.get("page_size") || 0);
    requestedPage = Number(query.get("page") || 0);
    return {kind:"directory", path:runtime.path, display_path:runtime.path, parent:"C:\\", parent_kind:"directory", entries:runtime.entries, page:requestedPage, page_size:requestedPageSize, total:160, total_pages:Math.ceil(160 / requestedPageSize)};
  };
  await model.setLocalFilesPageSize(100, "local-main");
  assert.equal(requestedPageSize, 100, "修改每页数量必须使用新的分页大小重新读取目录");
  assert.equal(requestedPage, 1, "修改每页数量后必须让原页首项目仍落在新的页码范围内");
  assert.equal(list.scrollTop, 420, "分页数量改变但无法取得 DOM 锚点时不得把列表强行跳到新列表底部");

  model.clearLocalFilesSelection("local-main");
  assert.equal(selectionBar.hidden, true);
  assert.deepEqual(checks.map(input => input.checked), [false, false, false]);

  assert.match(localUiSource, /class="local-files-selection" hidden>[\s\S]*openSelectedLocalFiles[\s\S]*showLocalFilesUploadMenu[\s\S]*copySelectedLocalFilePaths[\s\S]*renameSelectedLocalFile[\s\S]*deleteSelectedLocalFiles[\s\S]*chmodSelectedLocalFile/);
  assert.match(localUiSource, /class="local-files-row[\s\S]*?data-dragstart-action="local-files-entry-drag-start" data-dragend-action="local-files-entry-drag-end"/);
  assert.doesNotMatch(localUiSource, /class="local-files-name" draggable=/, "本地文件名按钮不能和整行竞争拖拽事件");
  assert.match(localUiSource, /registerTermaAction\("local-files-entry-drag-start"[\s\S]*beginLocalFileDrag/);
  assert.match(localUiSource, /captureLocalFilesScrollAnchor[\s\S]*?anchorPath[\s\S]*?anchorOffset/, "改分页数量时必须使用可视行锚点恢复位置");
  assert.match(localUiSource, /localFilesWorkspaceTransferActions[\s\S]*?发送到对端/, "本地文件右键菜单必须提供分屏对端发送入口");
  assert.match(localUiSource, /showSftpDragPreview\(entries, event\.clientX, event\.clientY\)/, "本地多选拖拽必须复用 SFTP 的预览浮层和数量角标");
  assert.match(localUiSource, /document\.getElementById\?\.\("sftpDragPreview"\)/, "拖拽清理必须兼容轻量 DOM smoke 沙盒");
  assert.match(sftpUiSource, /async function handleSftpDrop\([\s\S]*?readLocalFileDragPayload\(event\?\.dataTransfer\)[\s\S]*?uploadLocalFilesToSftp\(localPayload, target, tabKey\)/);
  assert.match(sftpUiSource, /async function dropSftpItemsOnTab\([\s\S]*?readLocalFileDragPayload\(event\?\.dataTransfer\)[\s\S]*?uploadLocalFilesToSftp\(localPayload, target, tabKey\)/);
  assert.match(sftpUiSource, /function handleSftpTabDragOver\([\s\S]*?workspaceTabByKey\(tabKey\)/, "分屏标签拖入必须通过工作区模型解析目标标签");
  assert.match(sftpUiSource, /function handleLocalFileDragOverSftp\([\s\S]*?workspaceTabByKey\(tabKey\)/, "分屏 SFTP 内容区拖入必须通过工作区模型解析目标标签");
  assert.match(terminalUiSource, /mount\.addEventListener\("drop", async event => \{[\s\S]*?readLocalFileDragPayload\(event\.dataTransfer\)[\s\S]*?session\.currentDirectoryKnown[\s\S]*?initializeTerminalDirectory\(session, connection, key\)[\s\S]*?uploadLocalFilesToSftp\(localPayload, \{kind:"terminal", id:connection\.id, title:`终端：\$\{directory\}`, path:directory\}, key\)/);
  assert.match(sftpUiSource, /<span class="pager-count">[\s\S]*?<select aria-label="每页数量" onchange="setSftpPageSize/);

  assert.match(css, /\.local-files-list > \.sftp-pager-dock \{[^}]*position:sticky;[^}]*bottom:0;/);
  assert.match(css, /\.local-files-column-resize::before \{[^}]*background:var\(--column-divider/, "本地文件列调整竖线必须使用统一分隔线颜色");
  const localColumnsSource = fs.readFileSync(path.join(root, "public", "app-local-files-columns.js"), "utf8");
  assert.doesNotMatch(localColumnsSource, /bindLocalFilesColumnControls\(list\)[\s\S]*?isMobileLayout\(\)/, "窄窗口和触摸屏电脑不能禁用本地文件列拖动");
  assert.match(localColumnsSource, /visibleLocalFilesColumnKeys[\s\S]*?\["name", "size"\]/, "窄窗口必须按可见的名称和大小列计算拖动边界");
  assert.match(localColumnsSource, /document\.addEventListener\("pointermove", move\)/, "列拖动必须在文档级持续跟踪指针");
  assert.doesNotMatch(css, /\.local-files-head-cell \{[^}]*border-right:/, "本地文件表头不得与拖动手柄重复绘制分隔线");
  assert.doesNotMatch(css, /\.sftp-head-cell \{[^}]*border-right:/, "SFTP 表头不得与拖动手柄重复绘制分隔线");
  assert.match(css, /\.sftp-pager select \{[^}]*min-height:28px;[^}]*padding:3px 28px 3px 8px;/);
  assert.doesNotMatch(css, /\.local-files-page-size/, "本地分页不得保留一套独立于 SFTP 的选择器样式");
  assert.match(css, /@container local-files-view \(max-width:520px\) \{[\s\S]*?\.local-files-list > \.sftp-pager-dock > \.sftp-pager \{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);/);

  console.log("本地文件交互检查通过：右键菜单、多选、SFTP/终端拖入上传、冲突处理和分页样式正常");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
