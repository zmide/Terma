async function openLog(path, title, updateTab=true, existingKey="") {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = existingKey || (!updateTab && currentTab?.kind === "log" ? currentTab.key : `log-${path}`);
  const sourceTitle = String(title || tr("common:log_viewer.default_title", {defaultValue:"Log"}));
  const displayTitle = typeof localizedLogLabel === "function" ? localizedLogLabel(sourceTitle) : sourceTitle;
  inPane(() => {
    setWorkspace(displayTitle, tr("common:log_viewer.workspace_title", {defaultValue:"Log viewer"}), "log", tabKey, updateTab, true, {kind:"log", path, logTitleSource:sourceTitle});
    $("view-log").innerHTML = stateView("loading", tr("common:log_viewer.loading", {defaultValue:"Reading log"}), displayTitle);
  });
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : inPane;
  const result = await loadLogWindow(path);
  const render = () => {
    const state = {path, title:displayTitle, sourceTitle, offset:result.offset, text:result.text || "", matches:result.matches || [], matches_truncated:Boolean(result.matches_truncated), has_older:Boolean(result.has_older)};
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

function localizedSystemLogText(value, state) {
  const source = String(value || "");
  const language = normalizeTermaLanguage(document.documentElement.lang || "zh-CN");
  if (language !== "en-US" || !String(state?.sourceTitle || state?.title || "").startsWith("system-")) return source;
  return source.split("\n").map(line => {
    const timestamp = line.match(/^(\[[^\]]+\]\s*)(.*)$/);
    const prefix = timestamp?.[1] || "";
    let body = timestamp?.[2] ?? line;
    let eventPrefix = "";
    if (/^\u901a\u77e5\uff1a\s*/iu.test(body)) {
      body = body.replace(/^\u901a\u77e5\uff1a\s*/iu, "");
      eventPrefix = `${tr("common:log_display.notification", {defaultValue:"Notification"})}: `;
    }
    return `${prefix}${eventPrefix}${localizedTermaUiPhrase(body)}`;
  }).join("\n");
}

function renderLogViewer(state=currentLogViewerState(), tabKey=activeTabKey, scrollMode="end") {
  if (!state) return;
  const view = $("view-log");
  const scrollContainer = view?.closest(".workspace") || view;
  const previousScroll = {top:scrollContainer?.scrollTop || 0, height:scrollContainer?.scrollHeight || 0};
  const matches = state.matches || [];
  let contexts = "";
  if (logSearch.trim()) {
    const blocks = matches.slice(0, 50).map(match => `<pre>${highlightLogText(localizedSystemLogText(match.text, state))}</pre>`).join("");
    const summary = matches.length
      ? (state.matches_truncated
        ? tr("common:log_viewer.matches_truncated", {count:matches.length, defaultValue:"Showing {{count}} matches; more results were omitted"})
        : tr("common:log_viewer.matches", {count:matches.length, defaultValue:"Showing {{count}} matches"}))
      : tr("common:log_viewer.no_matches", {defaultValue:"No matching content was found in the log"});
    contexts = `<div class="panel compact-log-context"><strong>${esc(tr("common:log_viewer.search_context", {defaultValue:"Search context"}))}</strong><span>${esc(summary)}</span>${blocks}</div>`;
  }
  const older = state.has_older
    ? `<div class="actions log-load-actions"><button onclick="loadOlderLog('${escAttr(tabKey)}')">${icon("chevrons-up")}${esc(tr("common:log_viewer.load_older", {defaultValue:"Load earlier content"}))}</button><span class="muted">${esc(tr("common:log_viewer.chunk_hint", {defaultValue:"Logs are read in 256 KB chunks instead of loading a large file all at once."}))}</span></div>`
    : "";
  view.innerHTML = `${older}${contexts}<pre class="log-view" data-i18n-skip>${highlightLogText(localizedSystemLogText(state.text || tr("common:log_display.empty", {defaultValue:"Log is empty"}), state))}</pre>`;
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
  if (!log) return notify(tr("common:notifications.no_system_log_today", {defaultValue:"There is no system log for today"}), "info");
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
  if (!log) {
    const language = normalizeTermaLanguage(document.documentElement.lang || "zh-CN");
    const formattedDate = new Intl.DateTimeFormat(language, {year:"numeric", month:"long", day:"numeric"}).format(date);
    return notify(tr("common:log_viewer.no_system_log_date", {date:formattedDate, defaultValue:"There is no system log for {{date}}"}), "info");
  }
  inPane(() => openLog(log.path, log.label || `system-${day}`));
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if (typeof renderLogs === "function" && $("connectionGroups")) renderLogs().catch(() => {});
    let changed = false;
    for (const tab of tabs) {
      if (tab.kind !== "log") continue;
      const state = logViewerStates.get(tab.key);
      const source = tab.logTitleSource || state?.sourceTitle || tab.title;
      const title = typeof localizedLogLabel === "function" ? localizedLogLabel(source) : source;
      tab.logTitleSource = source;
      if (tab.title !== title) {
        tab.title = title;
        changed = true;
      }
      if (state) {
        state.sourceTitle = source;
        state.title = title;
        if (typeof activeView !== "undefined" && activeView === "log" && tab.key === activeTabKey) renderLogViewer(state, tab.key, "preserve");
      }
    }
    if (changed) {
      renderTabs();
      saveTabsState();
    }
  });
}
