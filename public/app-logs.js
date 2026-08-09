const logViewerStates = new Map();

function currentLogViewerState(tabKey=activeTabKey) {
  return logViewerStates.get(String(tabKey || "")) || logViewerState;
}

function disposeLogViewerState(tabKey) {
  logViewerStates.delete(String(tabKey || ""));
}

function setLogSearch(value) {
  logSearch = value || "";
  renderLogs().catch(e=>notify(e.message,"error"));
  clearTimeout(logSearchTimer);
  const tabKey = activeTabKey;
  const state = currentLogViewerState();
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  if (state?.path && activeView === "log") {
    logSearchTimer = setTimeout(() => inPane(() => openLog(state.path, state.title, false, tabKey).catch(e=>notify(e.message,"error"))), 250);
  }
}

function showLogCleanupMenu(event) {
  showActionMenu(event, [
    {label:"清理 7 天前", icon:"calendar-minus", run:()=>clearLogsOlderThan(7)},
    {label:"清理 30 天前", icon:"calendar-minus", run:()=>clearLogsOlderThan(30)},
    {label:"清理 90 天前", icon:"calendar-minus", run:()=>clearLogsOlderThan(90)},
    {separator:true},
    {label:"清空全部日志", icon:"trash-2", danger:true, run:()=>clearAllLogs()}
  ]);
}

async function renderLogs(){
  const uiState = captureUiState($("connectionGroups") || document);
  logsData = await api("/api/logs");
  const systemOpen = logOpen.has("system");
  const systemLogs = filterLogs(logsData.system || []);
  const systemItems = systemOpen ? renderLogItems("system", systemLogs) : "";
  const batchOpen = logOpen.has("batch");
  const batchLogs = filterLogs(logsData.batch || []);
  const batchItems = batchOpen ? renderLogItems("batch", batchLogs) : "";
  const serverItems = (logsData.connections || []).map(server => {
    const key = `server:${server.name}`;
    const open = logOpen.has(key);
    const logs = filterLogs(server.logs || []);
    return `<div class="group log-group">
      <div class="group-head-row"><button class="group-head" onclick="toggleLogOpen('${escAttr(key)}')"><span class="chev">${open ? "▾" : "▸"}</span>${icon("server")}<span>${esc(server.name)}</span><span class="count">${logs.length}</span></button><button class="log-group-delete danger icon-button" title="删除该服务器日志" onclick="deleteLogGroup('${escAttr(key)}')">${icon("trash-2")}</button></div>
      ${open ? renderLogItems(key, logs) : ""}
    </div>`;
  }).join("");
  $("connectionGroups").innerHTML = `<div class="group log-group">
    <div class="group-head-row"><button class="group-head" onclick="toggleLogOpen('system')"><span class="chev">${systemOpen ? "▾" : "▸"}</span>${icon("monitor-cog")}<span>系统日志</span><span class="count">${systemLogs.length}</span></button><button class="log-group-delete danger icon-button" title="删除系统日志" onclick="deleteLogGroup('system')">${icon("trash-2")}</button></div>
    ${systemItems}
  </div><div class="group log-group">
    <div class="group-head-row"><button class="group-head" onclick="toggleLogOpen('batch')"><span class="chev">${batchOpen ? "▾" : "▸"}</span>${icon("square-terminal")}<span>批量执行日志</span><span class="count">${batchLogs.length}</span></button><button class="log-group-delete danger icon-button" title="删除批量日志" onclick="deleteLogGroup('batch')">${icon("trash-2")}</button></div>
    ${batchItems}
  </div>${serverItems || stateView("empty", "暂无终端日志", "打开终端或执行批量命令后，日志会按服务器保存在这里。")}`;
  restoreUiState(uiState);
}

function filterLogs(logs) {
  const q = logSearch.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter(log => String(log.label || "").toLowerCase().includes(q));
}

function renderLogItems(key, logs) {
  const page = logPage.get(key) || 0;
  const start = page * 10;
  const visible = logs.slice(start, start + 10);
  return visible.map(log => renderLogButton(log, key)).join("") + renderPager(key, logs.length, page);
}

function terminalLogPresentation(log) {
  const label = String(log?.label || "日志");
  const match = label.match(/^(.*)-(\d{4})年(\d+)月(\d+)日 (\d{2}):(\d{2}):(\d{2})(.*)$/);
  if (!match) return {title:label, time:""};
  const pad = value => String(value).padStart(2, "0");
  return {
    title:match[1],
    time:`${match[2]}-${pad(match[3])}-${pad(match[4])} ${match[5]}:${match[6]}:${match[7]}${match[8] || ""}`
  };
}

function renderLogButton(log, key="") {
  const terminal = String(key).startsWith("server:");
  const presentation = terminal ? terminalLogPresentation(log) : {title:String(log.label || "日志"), time:""};
  return `<div class="log-row">
    <button class="log-item" title="${escAttr(log.label)}" onclick="openLog('${escAttr(log.path)}','${escAttr(log.label)}')"><span class="log-item-title">${esc(presentation.title)}</span>${presentation.time ? `<span class="log-item-time">${esc(presentation.time)}</span>` : ""}</button>
    <button class="log-delete danger icon-button" title="删除日志" onclick="deleteLog('${escAttr(log.path)}')">${icon("trash-2")}</button>
  </div>`;
}

function renderPager(key, total, page) {
  if (total <= 10) return "";
  const maxPage = Math.ceil(total / 10) - 1;
  return `<div class="pager"><button ${page<=0?"disabled":""} onclick="changeLogPage('${escAttr(key)}',-1)">上一页</button><span class="pager-count">${page+1}/${maxPage+1}</span><button ${page>=maxPage?"disabled":""} onclick="changeLogPage('${escAttr(key)}',1)">下一页</button></div>`;
}

function toggleLogOpen(key) {
  if (logOpen.has(key)) logOpen.delete(key);
  else logOpen.add(key);
  saveLogState();
  renderLogs().catch(e=>notify(e.message,"error"));
}

function changeLogPage(key, delta) {
  const next = Math.max(0, (logPage.get(key) || 0) + delta);
  logPage.set(key, next);
  renderLogs().catch(e=>notify(e.message,"error"));
}
