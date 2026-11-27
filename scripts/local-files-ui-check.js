"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require('./frontend-service-test-helper');

const root = path.resolve(__dirname, "..");
const fileActionsSource=fs.readFileSync(path.join(root,'frontend/src/features/files/file-page-actions.ts'),'utf8');
const localViewSource=fs.readFileSync(path.join(root,'frontend/src/features/files/LocalFilesView.ts'),'utf8');
const sftpUiSource = fs.readFileSync(path.join(root,"frontend/src/entries/about-embed.ts"),"utf8");
const workspaceUiSource = fs.readFileSync(path.join(root, "frontend/src/shared/static-action-registry.ts"), "utf8");
const sftpVueViewSource = fs.readFileSync(path.join(root, "frontend", "src", "features", "files", "sftp", "SftpView.ts"), "utf8");
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
    getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[],
    addEventListener() {}
  };
  const view = {
    dataset:{workspaceTabKey:""},
    innerHTML:"",
    querySelector(selector) {
      return selector === ".local-files-shell" && this.innerHTML ? {classList:createClassList(['terma-local-files-root'])} : null;
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
    window:{termaDesktop:true,termaRuntimeSettingsModel:{snapshot:{}}},
    webFilesRuntime:()=>null,
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
    registerTermaAction() {},
    $:id => id === "view-local-files" ? view : null,
    icon:name => `<i data-icon="${name}"></i>`,
    esc:value => String(value ?? ""),
    escAttr:value => String(value ?? ""),
    tr:(key, options={}) => options.defaultValue || ({...require('../public/locales/zh-CN/common.json').auto}[key.split(':auto.')[1]]) || (()=>{const [ns,parts]=key.split(':');let value=require('../public/locales/zh-CN/'+ns+'.json');for(const part of parts.split('.'))value=value?.[part];return typeof value==='string'?value.replace(/{{(\w+)}}/g,(_,name)=>String(options[name]??'')):key;})(),
    isMobileLayout:() => false,
    notify(message, type) { notifications.push({message, type}); },
    showActionMenu(_event, actions) { capturedMenu = actions; },
    stateView:() => "",
    sftpIcon:() => "",
    sftpDragService:()=>({feedbackView:{showPreview(){},movePreview(){},removePreview(){}}, source:{active:()=>null}, browser:{finishPayload(){}}, feedback:{activity(){}}}),
    formatBytes:value => `${value} B`,
    formatSftpTime:value => String(value),
    requestAnimationFrame(callback) { callback(); return 1; },
    setWorkspace(...args) { workspaceCalls.push(args); },
    saveTabsState() {},
    copyText() {},
    inputModal:async () => "",
    confirmModal:async () => false,
    chooseModal:async () => localReceiveChoice,
    sftpTaskCompletionService:() => ({track(job) { trackedJobs.push(job); }}),
    startSftpJobsTimer() {},
    sftpConflictChoice:async (...args) => {
      conflictCalls.push(args);
      return conflictChoice;
    },
    activeSftpDragPayload:() => null,
    finishSftpDragPayload() {},
    api:async (url, options = {}) => {
      apiCalls.push({url, options});
      if(url.startsWith('/api/local-files?')){const params=new URLSearchParams(url.split('?')[1]);return {path:params.get('path')||'C:\\work',kind:'directory',entries:checks.map(input=>({path:input.value,name:input.dataset.name,type:'file',size:Number(input.dataset.size)})),page:Number(params.get('page')||1),page_size:Number(params.get('page_size')||50),total:checks.length,total_pages:1};}
      return {jobs:[{id:`job-${apiCalls.length}`}], count:2};
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.workspaceTabByKey = key => sandbox.tabs.find(item => item.key === key);
  sandbox.window.addEventListener=()=>{};
  sandbox.window.termaSftpMenus={show(_event,actions){capturedMenu=typeof actions==='function'?actions():actions;}};
  Object.assign(sandbox,{workspaceFindPaneForTab:()=>null,workspaceFindPane:()=>null,workspacePaneElement:()=>null});
  const transfer = loadFrontendService('frontend/src/features/files/workspace-transfer.ts').createWorkspaceTransfer({
    mobile: sandbox.isMobileLayout,
    sourcePane: sandbox.workspaceFindPaneForTab,
    leaves: () => [],
    tr: sandbox.tr
  });
  sandbox.window.termaWorkspaceTransfer = {current: () => transfer};
  const fileScroll=loadFrontendService('frontend/src/features/files/file-scroll.ts');
  sandbox.window.termaLocalFileViews={
    update(_key,options){const state=options.state;checks.forEach(input=>input.checked=state.selected.has(input.value));rows.forEach(row=>{row.classList.toggle('is-selected',state.selected.has(row.dataset.path));row.classList.toggle('active',state.activePath===row.dataset.path);});const selected=checks.filter(input=>input.checked&&!input.disabled);selectionBar.hidden=selected.length<2;selectionCount.textContent=String(selected.length);singleActionButtons.forEach(button=>button.disabled=selected.length!==1);selectAll.checked=selected.length===checks.length;selectAll.indeterminate=selected.length>0&&selected.length<checks.length;fileScroll.fileScrollCue(list);return true;},
    mount(){throw new Error('A reused Vue shell must not be mounted again');},pathEditor(){}
  };
  const conflictPrompts=loadFrontendService('frontend/src/features/files/file-conflict-prompts.ts');
  sandbox.fileConflictPromptsService=()=>conflictPrompts.createFileConflictPrompts({text:sandbox.tr,choose:sandbox.chooseModal});
  sandbox.window.termaSftpDialogs={
    input:async options=>{const value=await sandbox.inputModal(options.tr(options.titleKey),options.tr(options.labelKey),options.value);if(value)await options.apply?.(value);return value;},
    confirm:async options=>sandbox.confirmModal(options.content().message)
  };

  const {createFilePageRuntime}=loadFrontendService('frontend/src/features/files/file-page-runtime.ts', {document:sandbox.document});
  sandbox.window.termaLocalFileRuntime=createFilePageRuntime({
    workspace: {
      native: () => Boolean(sandbox.window.termaDesktop), mobile: sandbox.isMobileLayout,
      active: () => sandbox.activeTabKey, tab: sandbox.workspaceTabByKey, view: () => view,
      tabs: () => sandbox.tabs, root: sandbox.workspaceElementForTab, persist: () => {},
      workspace: (key,title,subtitle,update,options) => sandbox.setWorkspace(title,subtitle,'local-files',key,update,true,options)
    },
    views: sandbox.window.termaLocalFileViews,
    list: (_source, query, signal) => sandbox.api('/api/local-files?'+query, {signal}),
    text: (key, values) => sandbox.tr(key, {...values, defaultValue:key}),
    bytes: sandbox.formatBytes, time: sandbox.formatSftpTime, fnos: () => false,
    releaseActions() {}
  });
  sandbox.fileScrollCue=fileScroll.fileScrollCue;

  const runtime = sandbox.window.termaLocalFileRuntime;
  const { files, pages } = runtime;
  const globals = {document:sandbox.document,window:sandbox.window,Element:class Element{}};
  const {createFileWorkspaceTransfers}=loadFrontendService('frontend/src/features/files/file-workspace-transfers.ts',globals);
  const transfers=createFileWorkspaceTransfers(runtime,{
    tab:sandbox.workspaceTabByKey,drag:sandbox.sftpDragService,track:job=>trackedJobs.push(job),
    directoryError:error=>{throw error;},dropError:message=>sandbox.notify(message,'error'),
    transfer:{
      target(target){return {id:Number(target.id),directory:sandbox.sftpTabRuntimes.get(target.key)?.state.path||target.path||'.',valid:()=>true};},
      request:(url,body,signal)=>sandbox.api(url,{method:'POST',body:JSON.stringify(body),signal}),
      conflict:(id,path,entries,title)=>sandbox.sftpConflictChoice(id,path,entries,title?{title}:{}),
      choose:(items,source)=>sandbox.fileConflictPromptsService().receive(items,source==='native'?'native':'web'),
      refreshJobs:()=>{},startJobs:sandbox.startSftpJobsTimer,text:sandbox.tr,notify:sandbox.notify
    }
  });
  const {createFileWorkspaceActions}=loadFrontendService('frontend/src/features/files/file-workspace-actions.ts',globals);
  const actions=createFileWorkspaceActions(runtime,transfers,{
    request:(...args)=>sandbox.api(...args),text:sandbox.tr,notify:sandbox.notify,desktop:()=>Boolean(sandbox.window.termaDesktop),windows:()=>true,
    dialogs:sandbox.window.termaSftpDialogs,editPath:()=>{},prompt:(...args)=>sandbox.inputModal(...args),copy:sandbox.copyText,
    menus:{
      active:()=>sandbox.workspaceTabByKey(sandbox.activeTabKey),connections:()=>sandbox.connections,
      peers:(key,entries)=>sandbox.window.termaWorkspaceTransfer.current().localActions(key,{sourceTabKey:key,paths:entries.map(entry=>entry.path),entries}),
      show:sandbox.window.termaSftpMenus.show
    }
  });
  const selectLocalFileEntry=(event,path,key)=>files.select(key,path,event);
  const model={
    localFilesRuntime:key=>files.state(key), openLocalFiles:pages.open,
    applyLocalFileRangeSelection:selectLocalFileEntry,selectLocalFileEntry,
    createLocalEntryFromPrompt:actions.mutations.run,clearLocalFilesSelection:key=>files.clear(key),
    showLocalFileEntryMenu:(event,path,_type,key)=>actions.menus.entry(event,key,path),showLocalFilesDirectoryMenu:actions.menus.directory,
    beginLocalFileDrag:(event,path,key)=>transfers.drag.begin(event,path,key,event.currentTarget),
    finishLocalFileDrag:transfers.drag.finish,readLocalFileDragPayload:transfers.drag.read,
    uploadLocalFilesToSftp:transfers.upload,copySftpDraggedItemsToLocalTab:transfers.receive,
    setLocalFilesPageSize:(value,key)=>files.pageSize(key,value,runtime.scrollAnchor(key)),
    renderLocalFiles:runtime.update,syncLocalFilesScrollCue:fileScroll.fileScrollCue
  };

  return {
    model,
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
  assert.match(sftpVueViewSource, /onClick: \(event: MouseEvent\) => selectEntry\(entry, event, selection\)/, "SFTP 行选择由当前标签的 Vue 视图直接处理");
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
  runtime.selected=new Set(checks.filter(input=>input.checked).map(input=>input.value));model.renderLocalFiles("local-main");
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
  runtime.selected=new Set(checks.filter(input=>input.checked).map(input=>input.value));model.renderLocalFiles("local-main");

  const selectionBeforeContextMenu = checks.map(input => input.checked);
  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, "file", "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, true, false], "右键未选中项目必须切换为单选，和 SFTP 保持一致");

  checks.forEach((input, index) => { input.checked = selectionBeforeContextMenu[index]; });
  runtime.anchorPath = checks[2].value;
  runtime.selected=new Set(checks.filter(input=>input.checked).map(input=>input.value));model.renderLocalFiles("local-main");

  model.selectLocalFileEntry({shiftKey:true, ctrlKey:false, metaKey:false, target:{closest:() => null}}, checks[1].value, "local-main");
  assert.deepEqual(checks.map(input => input.checked), [false, true, true], "Shift 点击必须选择锚点到当前项的连续范围");
  assert.equal(selectionCount.textContent, "2");

  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, "file", "local-main");
  const multiFileMenu = state.getMenu();
  const multiFileMenuLabels = multiFileMenu.filter(item => !item.separator).map(item => item.label);
  for (const label of ["打开 / 编辑", "在系统文件管理器中打开", "复制 2 个路径", "删除已选 2 项", "上传到 SFTP"]) {
    assert.ok(multiFileMenuLabels.includes(label), `本地文件多选右键菜单缺少“${label}”`);
  }
  assert.equal(multiFileMenuLabels.includes("重命名"), false, "多选右键菜单不得提供单项重命名");
  assert.equal(multiFileMenuLabels.includes("设置权限"), false, "多选右键菜单不得提供单项权限编辑");

  const uploadSubmenu = multiFileMenu.find(item => item.label === "上传到 SFTP");
  assert.ok(Array.isArray(uploadSubmenu?.children), "Vue 上传入口必须使用可展开的二级菜单");
  const uploadTargets = uploadSubmenu.children;
  assert.ok(uploadTargets.some(item => item.label.includes("当前 SFTP")), "上传二级菜单必须包含当前 SFTP 目标");
  assert.equal(uploadTargets.length, 1, "当前 SFTP 与连接列表指向同一主机时不得重复显示目标");

  model.applyLocalFileRangeSelection({shiftKey:false, ctrlKey:false, metaKey:false}, checks[1].value, "local-main");
  model.showLocalFileEntryMenu(menuEvent(), checks[1].value, "file", "local-main");
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
  assert.ok(localViewSource.includes('local-files-create-directory') && localViewSource.includes("'data-entry-kind': 'dir'") && fileActionsSource.includes("mutations().run(key,dataset.entryKind)"), "本地文件工具栏必须提供新建文件夹按钮");
  assert.ok(localViewSource.includes('local-files-create-file') && localViewSource.includes("'data-entry-kind': 'file'") && fileActionsSource.includes("mutations().run(key,dataset.entryKind)"), "本地文件工具栏必须提供新建文件按钮");

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
  runtime.selected=new Set(checks.filter(input=>input.checked).map(input=>input.value));model.renderLocalFiles("local-main");
  runtime.entries = checks.map((input, index) => ({
    path:input.value,
    name:input.dataset.name,
    type:"file",
    size:index + 1,
    mtime:0
  }));
  model.renderLocalFiles("local-main");
  assert.match(localViewSource, /draggable: !o.mobile && !drive/,'Vue 文件行必须作为拖拽源');
  assert.match(localViewSource, /entry-drag-start/,'Vue 文件行必须保留拖拽入口');
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
  assert.match(localViewSource, /class: 'file-list-status'/);
  assert.doesNotMatch(localViewSource, /class: 'sftp-pager-dock'/);
  assert.match(localViewSource, /window\.range\(scroll/);
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

  for(const action of ['selection-open','selection-upload','selection-copy','selection-rename','selection-delete','selection-chmod'])assert(localViewSource.includes(action));
  assert.match(localViewSource, /entry-drag-start[\s\S]*entry-drag-end/);
  assert.match(fileActionsSource, /'entry-drag-start': startDrag/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/file-scroll.ts'),'utf8'),/anchorPath[\s\S]*anchorOffset/,'TS 滚动状态保留可视行锚点');
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/files/file-menus.ts'),'utf8'),/port\.peers\(key,entries\)/, "TS 菜单使用已捕获的源标签和文件列表");
  const destinations=fs.readFileSync(path.join(root,'frontend/src/features/files/sftp/drag-destinations.ts'),'utf8');
  assert.match(destinations,/port\.localPayload\(event\.dataTransfer\)/);
  assert.match(destinations,/await port\.localUpload\(local,tab,key\)/,'标签投递保留工作区目标');
  assert.match(workspaceUiSource,/'workspace-tab-sftp-drag-over':[\s\S]*?termaSftpDragWorkspace\.drag\.destinations\.over/);
  assert.match(sftpUiSource,/tab\(key\) \{\s*const tab = workspaceTabByKey\(key\)/,'分屏目标从完整工作区模型解析');
  const terminalDropOwner=fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-drop-service.ts"),"utf8");
  assert.match(terminalDropOwner, /session\.currentDirectoryKnown[\s\S]*?port\.initialize\(/);
  assert.match(sftpVueViewSource, /class: 'file-list-status'/, "SFTP 使用紧凑连续滚动状态条");
  assert.match(sftpVueViewSource, /run\('scrollPage', window\.missingPage\)/, "滚动只请求缺失的数据页");

  assert.match(css, /\.local-files-list > \.sftp-pager-dock \{[^}]*position:sticky;[^}]*bottom:0;/);
  assert.match(css, /\.local-files-column-resize::before \{[^}]*background:var\(--column-divider/, "本地文件列调整竖线必须使用统一分隔线颜色");
  const localColumnsSource = fs.readFileSync(path.join(root, 'frontend/src/features/files/file-columns.ts'), 'utf8');
  assert.doesNotMatch(localColumnsSource,/isMobileLayout\(\)/,'窄窗口不能禁用列拖动');
  assert.match(localColumnsSource,/list.clientWidth <= 760 \? \['name', 'size'\]/,'窄窗口使用实际可见列计算边界');
  assert.match(localColumnsSource,/window.addEventListener\('pointermove', move\)/,'列拖动持续跟踪指针');
  assert.doesNotMatch(css, /\.local-files-head-cell \{[^}]*border-right:/, "本地文件表头不得与拖动手柄重复绘制分隔线");
  assert.doesNotMatch(css, /\.sftp-head-cell \{[^}]*border-right:/, "SFTP 表头不得与拖动手柄重复绘制分隔线");
  assert.match(css, /\.sftp-pager select \{[^}]*min-height:28px;[^}]*padding:3px 28px 3px 8px;/);
  assert.match(css, /\.sftp-file-name \{[^}]*display:block;[^}]*line-height:1\.45;/, "SFTP 文件名必须使用明确的块级行盒，避免下划线被字体基线裁剪");
  assert.match(css, /\.local-files-file-name \{[^}]*display:block;[^}]*line-height:1\.45;/, "本地文件名必须使用明确的块级行盒，和 SFTP 保持一致");
  assert.doesNotMatch(css, /\.local-files-page-size/, "本地分页不得保留一套独立于 SFTP 的选择器样式");
  assert.match(css, /@container local-files-view \(max-width:520px\) \{[\s\S]*?\.local-files-list > \.sftp-pager-dock > \.sftp-pager \{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);/);

  console.log("本地文件交互检查通过：右键菜单、多选、SFTP/终端拖入上传、冲突处理和分页样式正常");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
