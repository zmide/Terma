async function openLog(path, title, updateTab=true, existingKey="") {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = existingKey || (!updateTab && currentTab?.kind === "log" ? currentTab.key : `log-${path}`);
  inPane(() => {
    setWorkspace(title, "日志查看", "log", tabKey, updateTab, true, {kind:"log", path});
    $("view-log").innerHTML = stateView("loading", "正在读取日志", title);
  });
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : inPane;
  const result = await loadLogWindow(path);
  const render = () => {
    const state = {path, title, offset:result.offset, text:result.text || "", matches:result.matches || [], matches_truncated:Boolean(result.matches_truncated), has_older:Boolean(result.has_older)};
    logViewerStates.set(tabKey, state);
    logViewerState = state;
    renderLogViewer(state, tabKey, "end");
  };
  inTab(render);
}

async function loadLogWindow(path, before) {
  const params = new URLSearchParams({path, limit:String(256 * 1024)});
  if (before !== undefined) params.set("before", String(before));
  if (logSearch.trim()) params.set("query", logSearch.trim());
  return api(`/api/logs/read?${params.toString()}`);
}

function positionLogViewerScroll(container, mode="end", previous={}) {
  if (!container) return;
  const apply = () => {
    if (!container.isConnected) return;
    if (mode === "preserve") {
      container.scrollTop = Number(previous.top || 0) + Math.max(0, container.scrollHeight - Number(previous.height || 0));
    } else {
      container.scrollTop = container.scrollHeight;
    }
  };
  apply();
  requestAnimationFrame(apply);
}

function renderLogViewer(state=currentLogViewerState(), tabKey=activeTabKey, scrollMode="end") {
  if (!state) return;
  const view = $("view-log");
  const scrollContainer = view?.closest(".workspace") || view;
  const previousScroll = {top:scrollContainer?.scrollTop || 0, height:scrollContainer?.scrollHeight || 0};
  const matches = state.matches || [];
  let contexts = "";
  if (logSearch.trim()) {
    const blocks = matches.slice(0, 50).map(match => `<pre>${highlightLogText(match.text)}</pre>`).join("");
    const summary = matches.length
      ? `共显示 ${matches.length} 处命中${state.matches_truncated ? "，更多结果已省略" : ""}`
      : "正文中没有对应内容";
    contexts = `<div class="panel compact-log-context"><strong>搜索上下文</strong><span>${summary}</span>${blocks}</div>`;
  }
  const older = state.has_older
    ? `<div class="actions log-load-actions"><button onclick="loadOlderLog('${escAttr(tabKey)}')">${icon("chevrons-up")}加载更早内容</button><span class="muted">按 256 KB 分段读取，不会一次载入整个大日志。</span></div>`
    : "";
  view.innerHTML = `${older}${contexts}<pre class="log-view">${highlightLogText(state.text || "日志为空")}</pre>`;
  refreshIcons();
  positionLogViewerScroll(scrollContainer, scrollMode, previousScroll);
}

async function loadOlderLog(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state?.has_older) return;
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : action => action();
  const result = await loadLogWindow(state.path, state.offset);
  state.offset = result.offset;
  state.text = `${result.text || ""}${state.text || ""}`;
  state.has_older = Boolean(result.has_older);
  inTab(() => {
    logViewerState = state;
    renderLogViewer(state, tabKey, "preserve");
  });
}


function highlightLogText(text) {
  const escaped = esc(text);
  const q = logSearch.trim();
  if (!q) return escaped;
  const parts = q.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!parts.length) return escaped;
  return escaped.replace(new RegExp(`(${parts.join("|")})`, "gi"), `<mark>$1</mark>`);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openTodaySystemLog() {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  if (!logsData.system?.length) logsData = await api("/api/logs");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const log = (logsData.system || []).find(item => String(item.path || item.label || "").includes(today));
  if (!log) return notify("今天暂无系统日志", "info");
  inPane(() => openLog(log.path, log.label || `system-${today}`));
}

async function openSystemLogAt(timestamp) {
  const inPane = typeof captureWorkspacePane === "function" ? captureWorkspacePane() : action => action();
  const value = Number(timestamp || 0);
  const date = new Date(value > 1e12 ? value : value * 1000);
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(date.getTime())) return openTodaySystemLog();
  logsData = await api("/api/logs");
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const day = `${yyyy}-${mm}-${dd}`;
  const log = (logsData.system || []).find(item => String(item.path || item.label || "").includes(day));
  if (!log) return notify(`${yyyy}年${Number(mm)}月${Number(dd)}日没有对应系统日志`, "info");
  inPane(() => openLog(log.path, log.label || `system-${day}`));
}
