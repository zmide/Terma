const logViewerStates = new Map();

function logInlineArgument(value) {
  return `'${escAttr(String(value ?? ""))}'`;
}

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
    {label:tr("navigation:menus.clear_logs_older_than", {days:7, defaultValue:"清理 7 天前"}), icon:"calendar-minus", run:()=>clearLogsOlderThan(7)},
    {label:tr("navigation:menus.clear_logs_older_than", {days:30, defaultValue:"清理 30 天前"}), icon:"calendar-minus", run:()=>clearLogsOlderThan(30)},
    {label:tr("navigation:menus.clear_logs_older_than", {days:90, defaultValue:"清理 90 天前"}), icon:"calendar-minus", run:()=>clearLogsOlderThan(90)},
    {separator:true},
    {label:tr("navigation:menus.clear_all_logs", {defaultValue:"清空全部日志"}), icon:"trash-2", danger:true, run:()=>clearAllLogs()}
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
    const deleteLabel = tr("navigation:menus.delete_server_logs", {name:server.name, defaultValue:`删除 ${server.name} 的日志`});
    return `<div class="group log-group">
      <div class="group-head-row"><button class="group-head" data-i18n-skip title="${escAttr(server.name)}" aria-label="${escAttr(server.name)}" onclick="toggleLogOpen(${logInlineArgument(key)})"><span class="chev">${open ? "▾" : "▸"}</span>${icon("server")}<span>${esc(server.name)}</span><span class="count">${logs.length}</span></button><button class="log-group-delete danger icon-button" data-i18n-skip title="${escAttr(deleteLabel)}" aria-label="${escAttr(deleteLabel)}" onclick="deleteLogGroup(${logInlineArgument(key)})">${icon("trash-2")}</button></div>
      ${open ? renderLogItems(key, logs) : ""}
    </div>`;
  }).join("");
  const systemLabel = tr("common:auto.system_logs", {defaultValue:"系统日志"});
  const batchLabel = tr("common:auto.batch_logs", {defaultValue:"批量执行日志"});
  const deleteSystemLabel = tr("navigation:menus.delete_system_logs", {defaultValue:"删除系统日志"});
  const deleteBatchLabel = tr("navigation:menus.delete_batch_logs", {defaultValue:"删除批量日志"});
  $("connectionGroups").innerHTML = `<div class="group log-group">
    <div class="group-head-row"><button class="group-head" title="${escAttr(systemLabel)}" aria-label="${escAttr(systemLabel)}" onclick="toggleLogOpen('system')"><span class="chev">${systemOpen ? "▾" : "▸"}</span>${icon("monitor-cog")}<span>${esc(systemLabel)}</span><span class="count">${systemLogs.length}</span></button><button class="log-group-delete danger icon-button" title="${escAttr(deleteSystemLabel)}" aria-label="${escAttr(deleteSystemLabel)}" onclick="deleteLogGroup('system')">${icon("trash-2")}</button></div>
    ${systemItems}
  </div><div class="group log-group">
    <div class="group-head-row"><button class="group-head" title="${escAttr(batchLabel)}" aria-label="${escAttr(batchLabel)}" onclick="toggleLogOpen('batch')"><span class="chev">${batchOpen ? "▾" : "▸"}</span>${icon("square-terminal")}<span>${esc(batchLabel)}</span><span class="count">${batchLogs.length}</span></button><button class="log-group-delete danger icon-button" title="${escAttr(deleteBatchLabel)}" aria-label="${escAttr(deleteBatchLabel)}" onclick="deleteLogGroup('batch')">${icon("trash-2")}</button></div>
    ${batchItems}
  </div>${serverItems || stateView("empty", tr("common:auto.no_terminal_logs", {defaultValue:"暂无终端日志"}), tr("common:auto.terminal_logs_hint", {defaultValue:"打开终端或执行批量命令后，日志会按服务器保存在这里。"}))}`;
  restoreUiState(uiState);
}

function filterLogs(logs) {
  const q = logSearch.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter(log => {
    const original = String(log.label || "").toLowerCase();
    const localized = localizedLogLabel(log.label).toLowerCase();
    return original.includes(q) || localized.includes(q);
  });
}

function localizedLogLabel(value) {
  const label = String(value || tr("common:auto.logs", {defaultValue:"日志"}));
  const match = label.match(/^批量执行-(\d{1,2})月(\d{1,2})日 (\d{2}:\d{2}:\d{2})(?:（轮转 (\d+)）)?$/);
  if (!match) return label;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const language = normalizeTermaLanguage(document.documentElement.lang || "zh-CN");
  const date = language === "en-US"
    ? new Intl.DateTimeFormat("en-US", {month:"short", day:"numeric"}).format(new Date(2000, month - 1, day))
    : `${month}月${day}日`;
  const base = tr("tasks:logs.batch_label", {date, time:match[3], defaultValue:`批量执行-${date} ${match[3]}`});
  return match[4]
    ? `${base}${tr("tasks:logs.rotation_suffix", {count:Number(match[4]), defaultValue:`（轮转 ${match[4]}）`})}`
    : base;
}

function renderLogItems(key, logs) {
  const page = logPage.get(key) || 0;
  const start = page * 10;
  const visible = logs.slice(start, start + 10);
  return visible.map(log => renderLogButton(log, key)).join("") + renderPager(key, logs.length, page);
}

function terminalLogPresentation(log) {
  const label = String(log?.label || tr("common:auto.logs", {defaultValue:"日志"}));
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
  const localizedLabel = localizedLogLabel(log.label);
  const presentation = terminal ? terminalLogPresentation(log) : {title:localizedLabel, time:""};
  const deleteLabel = tr("navigation:menus.delete_log", {name:localizedLabel, defaultValue:`删除日志：${localizedLabel}`});
  return `<div class="log-row">
    <button class="log-item" data-i18n-skip title="${escAttr(localizedLabel)}" onclick="openLog(${logInlineArgument(log.path)},${logInlineArgument(log.label)})"><span class="log-item-title">${esc(presentation.title)}</span>${presentation.time ? `<span class="log-item-time">${esc(presentation.time)}</span>` : ""}</button>
    <button class="log-delete danger icon-button" data-i18n-skip title="${escAttr(deleteLabel)}" aria-label="${escAttr(deleteLabel)}" onclick="deleteLog(${logInlineArgument(log.path)})">${icon("trash-2")}</button>
  </div>`;
}

function renderPager(key, total, page) {
  if (total <= 10) return "";
  const maxPage = Math.ceil(total / 10) - 1;
  return `<div class="pager"><button ${page<=0?"disabled":""} onclick="changeLogPage(${logInlineArgument(key)},-1)">${esc(tr("common:auto.previous_page", {defaultValue:"上一页"}))}</button><span class="pager-count">${page+1}/${maxPage+1}</span><button ${page>=maxPage?"disabled":""} onclick="changeLogPage(${logInlineArgument(key)},1)">${esc(tr("common:auto.next_page", {defaultValue:"下一页"}))}</button></div>`;
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

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if (typeof primaryView !== "undefined" && primaryView === "logs") renderLogs().catch(error => notify(error.message, "error"));
  });
}
