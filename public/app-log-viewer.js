async function openLog(path, title, updateTab=true, existingKey="", searchQuery=undefined, targetLine=0) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = existingKey || (!updateTab && currentTab?.kind === "log" ? currentTab.key : `log-${path}`);
  const sourceTitle = String(title || tr("common:log_viewer.default_title", {defaultValue:"Log"}));
  const displayTitle = typeof localizedLogLabel === "function" ? localizedLogLabel(sourceTitle) : sourceTitle;
  inPane(() => {
    setWorkspace(displayTitle, tr("common:log_viewer.workspace_title", {defaultValue:"Log viewer"}), "log", tabKey, updateTab, true, {kind:"log", path, logTitleSource:sourceTitle});
    const view = logViewerElement(tabKey);
    if (view) view.innerHTML = stateView("loading", tr("common:log_viewer.loading", {defaultValue:"Reading log"}), displayTitle);
  });
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : inPane;
  const query = searchQuery === undefined ? logSearch : String(searchQuery || "");
  const result = await loadLogWindow(path, undefined, query, targetLine);
  const render = () => {
    const matches = result.matches || [];
    const selectedIndex = Number(targetLine || result.target_line || 0) > 0
      ? matches.findIndex(match => Number(match.line) === Number(targetLine || result.target_line))
      : -1;
    const state = {
      path, title:displayTitle, sourceTitle, query, offset:result.offset, endOffset:result.end_offset,
      text:result.text || "", matches, matches_truncated:Boolean(result.matches_truncated),
      has_older:Boolean(result.has_older), has_newer:Boolean(result.has_newer),
      startLine:Number(result.start_line || 0), targetLine:Number(result.target_line || targetLine || 0),
      matchIndex:selectedIndex, detailSearchOpen:Boolean(query.trim())
    };
    logViewerStates.set(tabKey, state);
    logViewerState = state;
    renderLogViewer(state, tabKey, state.targetLine > 0 ? "target" : "end");
  };
  inTab(render);
}

function logViewerElement(tabKey=activeTabKey) {
  const key = String(tabKey || "");
  if (typeof workspaceElementForTab === "function") {
    const scoped = workspaceElementForTab(key, "#view-log");
    if (scoped) return scoped;
  }
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const paneView = pane && typeof workspacePaneElement === "function"
    ? workspacePaneElement(pane.id)?.querySelector("#view-log:not([hidden])")
    : null;
  return paneView
    || document.querySelector('.workspace-pane.focused .workspace > #view-log:not([hidden])')
    || document.querySelector('.workspace > #view-log:not([hidden])')
    || $("view-log");
}

async function loadLogWindow(path, before, searchQuery=logSearch, targetLine=0) {
  const params = new URLSearchParams({path});
  if (before !== undefined) params.set("before", String(before));
  if (Number(targetLine) > 0) params.set("line", String(Math.floor(Number(targetLine))));
  if (String(searchQuery || "").trim()) params.set("query", String(searchQuery).trim());
  if (String(searchQuery || "").trim()) params.set("max_matches", "200");
  return api(`/api/logs/read?${params.toString()}`);
}

function logViewerScrollContainer(view) {
  return view?.querySelector(".log-view") || view?.closest(".workspace") || view;
}

function positionLogViewerScroll(container, mode="end", previous={}) {
  if (!container) return;
  const apply = () => {
    if (!container.isConnected) return;
    if (mode === "preserve") {
      container.scrollTop = Number(previous.top || 0) + Math.max(0, container.scrollHeight - Number(previous.height || 0));
    } else if (mode === "end") {
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
  const view = logViewerElement(tabKey);
  if (!view) return;
  const scrollContainer = logViewerScrollContainer(view);
  const previousScroll = {top:scrollContainer?.scrollTop || 0, height:scrollContainer?.scrollHeight || 0};
  const matches = state.matches || [];
  const query = String(state.query ?? logSearch ?? "");
  const matchCount = matches.length;
  const matchPosition = matchCount && Number(state.matchIndex) >= 0
    ? `${Math.min(matchCount, Number(state.matchIndex) + 1)}/${matchCount}${state.matches_truncated ? "+" : ""}`
    : (query.trim() ? "0/0" : "");
  const detailSearchLabel = tr("common:log_viewer.search_current", {defaultValue:"Search this log"});
  const previousMatchLabel = tr("common:log_viewer.previous_match", {defaultValue:"Previous match"});
  const nextMatchLabel = tr("common:log_viewer.next_match", {defaultValue:"Next match"});
  const closeSearchLabel = tr("common:actions.close", {defaultValue:"Close"});
  const externalLabel = tr("common:log_viewer.open_external", {defaultValue:"Open in external editor"});
  const detailSearchOpen = state.detailSearchOpen === true;
  const detailSearch = `<div class="log-detail-search" role="search"${detailSearchOpen ? "" : " hidden"}>
    <label class="search-field">${icon("search")}<input id="logDetailSearch" type="search" autocomplete="off" spellcheck="false" value="${escAttr(query)}" placeholder="${escAttr(detailSearchLabel)}" aria-label="${escAttr(detailSearchLabel)}" data-input-action="log-detail-search" data-tab-key="${escAttr(tabKey)}"></label>
    <span class="log-detail-search-count" aria-live="polite">${esc(matchPosition)}</span>
    <div class="log-detail-search-actions"><button type="button" class="icon-button" data-action="log-detail-search-prev" data-tab-key="${escAttr(tabKey)}" title="${escAttr(previousMatchLabel)}" aria-label="${escAttr(previousMatchLabel)}" ${matchCount ? "" : "disabled"}>${icon("chevron-up")}</button><button type="button" class="icon-button" data-action="log-detail-search-next" data-tab-key="${escAttr(tabKey)}" title="${escAttr(nextMatchLabel)}" aria-label="${escAttr(nextMatchLabel)}" ${matchCount ? "" : "disabled"}>${icon("chevron-down")}</button><button type="button" class="icon-button" data-action="log-detail-search-close" data-tab-key="${escAttr(tabKey)}" title="${escAttr(closeSearchLabel)}" aria-label="${escAttr(closeSearchLabel)}">${icon("x")}</button></div>
  </div>`;
  const older = state.has_older
    ? `<div class="actions log-load-actions"><button onclick="loadOlderLog('${escAttr(tabKey)}')">${icon("chevrons-up")}${esc(tr("common:log_viewer.load_older", {defaultValue:"Load earlier content"}))}</button><span class="muted">${esc(tr("common:log_viewer.chunk_hint", {defaultValue:"Logs are read in 256 KB chunks instead of loading a large file all at once."}))}</span></div>`
    : "";
  const external = window.termaDesktop ? `<div class="actions log-view-actions"><button type="button" data-action="log-open-external" data-tab-key="${escAttr(tabKey)}" title="${escAttr(externalLabel)}">${icon("external-link")}<span>${esc(externalLabel)}</span></button></div>` : "";
  view.innerHTML = `${detailSearch}${external}${older}<pre class="log-view" data-i18n-skip>${renderLogTextLines(localizedSystemLogText(state.text || tr("common:log_display.empty", {defaultValue:"Log is empty"}), state), query, state)}</pre>`;
  refreshIcons();
  positionLogViewerScroll(logViewerScrollContainer(view), scrollMode, previousScroll);
  if (scrollMode === "target") scrollLogViewerTarget(state, view);
}

function showLogDetailSearch(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  const view = logViewerElement(tabKey);
  if (!state || !view) return null;
  state.detailSearchOpen = true;
  const search = view.querySelector(".log-detail-search");
  if (search) {
    search.hidden = false;
    search.removeAttribute("hidden");
  } else {
    renderLogViewer(state, tabKey, "preserve");
  }
  return view.querySelector("[data-input-action=\"log-detail-search\"]");
}

function hideLogDetailSearch(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  const view = logViewerElement(tabKey);
  if (!state || !view) return;
  state.detailSearchOpen = false;
  const search = view.querySelector(".log-detail-search");
  if (search) search.hidden = true;
}

function renderLogTextLines(text, query, state={}) {
  const lines = String(text || "").split("\n");
  const firstLine = Number(state.startLine || 0);
  return lines.map((line, index) => {
    const lineNumber = firstLine > 0 ? firstLine + index : 0;
    const anchor = lineNumber > 0 ? ` data-log-line="${lineNumber}"` : "";
    return `<span class="log-line"${anchor}>${highlightLogText(line, query)}</span>`;
  }).join("\n");
}

function scrollLogViewerTarget(state, view) {
  const targetLine = Number(state?.targetLine || 0);
  if (!targetLine || !view) return;
  const scroll = () => {
    const target = view.querySelector(`[data-log-line="${targetLine}"]`);
    if (target) target.scrollIntoView({block:"center", inline:"nearest"});
  };
  requestAnimationFrame(() => { scroll(); requestAnimationFrame(scroll); });
}

async function loadOlderLog(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state?.has_older) return;
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : action => action();
  const result = await loadLogWindow(state.path, state.offset, state.query);
  state.offset = result.offset;
  const loadedLines = String(result.text || "").split("\n").length - 1;
  if (state.startLine > 0 && loadedLines > 0) state.startLine = Math.max(1, state.startLine - loadedLines);
  state.text = `${result.text || ""}${state.text || ""}`;
  if (result.start_line) state.startLine = result.start_line;
  state.has_older = Boolean(result.has_older);
  state.targetLine = Number(state.targetLine || 0);
  inTab(() => {
    logViewerState = state;
    renderLogViewer(state, tabKey, "preserve");
  });
}


function highlightLogText(text, query=logSearch) {
  const escaped = esc(text);
  const q = String(query || "").trim();
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

async function loadLogViewerMatch(state, tabKey, matchIndex) {
  const matches = state?.matches || [];
  if (!state || !matches.length) return;
  const nextIndex = (Number(matchIndex) + matches.length) % matches.length;
  const match = matches[nextIndex];
  const requestId = Number(state.detailSearchRequestId || 0) + 1;
  state.detailSearchRequestId = requestId;
  const result = await loadLogWindow(state.path, undefined, state.query, match.line);
  if (state.detailSearchRequestId !== requestId || currentLogViewerState(tabKey) !== state) return;
  const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : action => action();
  inTab(() => {
    state.offset = result.offset;
    state.endOffset = result.end_offset;
    state.text = result.text || "";
    state.startLine = Number(result.start_line || 0);
    state.targetLine = Number(result.target_line || match.line || 0);
    state.matches = result.matches || matches;
    state.matches_truncated = Boolean(result.matches_truncated);
    state.matchIndex = nextIndex;
    logViewerState = state;
    renderLogViewer(state, tabKey, "target");
  });
}

async function setLogViewerSearch(value, tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state) return;
  const query = String(value || "").trim();
  const requestId = Number(state.detailSearchRequestId || 0) + 1;
  state.detailSearchRequestId = requestId;
  state.query = query;
  state.matchIndex = -1;
  state.targetLine = 0;
  if (!query) {
    state.matches = [];
    state.matches_truncated = false;
    const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : action => action();
    return inTab(() => { logViewerState = state; renderLogViewer(state, tabKey, "preserve"); });
  }
  const result = await loadLogWindow(state.path, undefined, query);
  if (state.detailSearchRequestId !== requestId || currentLogViewerState(tabKey) !== state) return;
  state.matches = result.matches || [];
  state.matches_truncated = Boolean(result.matches_truncated);
  if (state.matches.length) {
    await loadLogViewerMatch(state, tabKey, 0);
  } else {
    state.offset = result.offset;
    state.endOffset = result.end_offset;
    state.text = result.text || state.text || "";
    state.startLine = Number(result.start_line || 0);
    const inTab = typeof captureWorkspaceTab === "function" ? captureWorkspaceTab(tabKey) : action => action();
    inTab(() => { logViewerState = state; renderLogViewer(state, tabKey, "preserve"); });
  }
}

function scheduleLogViewerSearch(value, tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state) return;
  state.pendingSearchQuery = String(value || "");
}

async function moveLogViewerSearch(delta, tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state) return;
  const input = logViewerElement(tabKey)?.querySelector("[data-input-action=\"log-detail-search\"]");
  const value = input ? input.value : (state.pendingSearchQuery ?? state.query);
  if (String(value).trim() !== String(state.query || "").trim()) await setLogViewerSearch(value, tabKey);
  if (!state.matches?.length) return;
  const current = Number(state.matchIndex);
  const step = Number(delta || 0);
  const base = Number.isInteger(current) && current >= 0 ? current : (step < 0 ? 0 : -1);
  await loadLogViewerMatch(state, tabKey, base + step);
}

async function openLogInExternalEditor(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state?.path) return;
  const mode = localStorage.getItem("sftpExternalEditorMode") || "system";
  const editor = {mode};
  if (mode === "custom") {
    editor.path = localStorage.getItem("sftpExternalEditorPath") || "";
    const rawArgs = localStorage.getItem("sftpExternalEditorArgs") || "";
    try { editor.args = JSON.parse(rawArgs); } catch { editor.args = rawArgs.match(/"[^" ]+"|\S+/g)?.map(value => value.replace(/^"|"$/g, "")) || []; }
  }
  try { await api("/api/logs/open-external", {method:"POST", body:JSON.stringify({path:state.path, editor})}); notify(tr("common:log_viewer.open_external", {defaultValue:"Opened in external editor"}), "success"); }
  catch (error) { notify(error.message || tr("common:log_viewer.open_external_failed", {defaultValue:"Unable to open external editor"}), "error"); }
}

function installLogKeyboardShortcuts() {
  if (typeof document === "undefined" || window.__termaLogKeyboardShortcutsInstalled) return;
  window.__termaLogKeyboardShortcutsInstalled = true;
  document.addEventListener("keydown", event => {
    const target = event.target;
    if (target?.matches?.("[data-input-action=\"log-detail-search\"]") && event.key === "Enter") {
      event.preventDefault();
      void setLogViewerSearch(target.value, target.dataset.tabKey || activeTabKey);
      return;
    }
    if (String(event.key || "").toLowerCase() === "escape") {
      const tab = tabs.find(item => item.key === activeTabKey);
      if (tab?.kind === "log" && currentLogViewerState(activeTabKey)?.detailSearchOpen) {
        hideLogDetailSearch(activeTabKey);
        return;
      }
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key || "").toLowerCase() !== "f") return;
    const tab = tabs.find(item => item.key === activeTabKey);
    if (tab?.kind !== "log" || !(typeof $("modal")?.hidden === "boolean" ? $("modal").hidden : true)) return;
    event.preventDefault();
    event.stopPropagation();
    requestAnimationFrame(() => {
      const input = showLogDetailSearch(activeTabKey);
      input?.focus({preventScroll:true});
      input?.select?.();
    });
  }, true);
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("log-detail-search", ({element}) => scheduleLogViewerSearch(element.value, element.dataset.tabKey || activeTabKey));
  registerTermaAction("log-detail-search-prev", ({element}) => { void moveLogViewerSearch(-1, element.dataset.tabKey || activeTabKey); });
  registerTermaAction("log-detail-search-next", ({element}) => { void moveLogViewerSearch(1, element.dataset.tabKey || activeTabKey); });
  registerTermaAction("log-open-external", ({element}) => { void openLogInExternalEditor(element.dataset.tabKey || activeTabKey); });
  registerTermaAction("log-detail-search-close", ({element}) => hideLogDetailSearch(element.dataset.tabKey || activeTabKey));
}

installLogKeyboardShortcuts();

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
