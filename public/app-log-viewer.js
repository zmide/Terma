const logViewerSearchTimers = new Map();

function rememberLogViewerScroll(tabKey=activeTabKey) {
  const state = logViewerStates.get(String(tabKey || ""));
  const view = logViewerElement(tabKey);
  const container = logViewerScrollContainer(view);
  if (!state || !container) return;
  state.scrollTop = Number(container.scrollTop || 0);
}

function logViewerMatchIndex(state) {
  const matches = state?.matches || [];
  const activeLine = Number(state?.activeMatchLine || 0);
  if (activeLine > 0) {
    const byLine = matches.findIndex(match => Number(match?.line || 0) === activeLine);
    if (byLine >= 0) return byLine;
  }
  const index = Number(state?.matchIndex);
  return Number.isInteger(index) && index >= 0 && index < matches.length ? index : -1;
}

function logViewerActiveMatch(state) {
  const matches = state?.matches || [];
  const index = logViewerMatchIndex(state);
  const fallback = index >= 0 ? matches[index] : null;
  const line = Number(state?.activeMatchLine || fallback?.line || state?.targetLine || 0);
  if (!line) return null;
  return {
    line,
    text: state?.activeMatchText !== undefined ? String(state.activeMatchText || "") : String(fallback?.text || ""),
    index
  };
}

async function openLog(path, title, updateTab=true, existingKey="", searchQuery=undefined, targetLine=0) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const currentTab = tabs.find(tab => tab.key === activeTabKey);
  const tabKey = existingKey || (!updateTab && currentTab?.kind === "log" ? currentTab.key : `log-${path}`);
  const sourceTitle = String(title || tr("common:log_viewer.default_title", {defaultValue:"Log"}));
  const displayTitle = typeof localizedLogLabel === "function" ? localizedLogLabel(sourceTitle) : sourceTitle;
  const cached = logViewerStates.get(tabKey);
  const canRestore = !updateTab && searchQuery === undefined && !Number(targetLine || 0)
    && cached && Object.prototype.hasOwnProperty.call(cached, "text")
    && String(cached.path || "") === String(path || "");
  if (canRestore) {
    inPane(() => {
      setWorkspace(displayTitle, tr("common:log_viewer.workspace_title", {defaultValue:"Log viewer"}), "log", tabKey, false, true, {kind:"log", path, logTitleSource:sourceTitle});
      logViewerState = cached;
      cached.sourceTitle = sourceTitle;
      cached.title = displayTitle;
      const view = logViewerElement(tabKey);
      if (view?.dataset.logTabKey === String(tabKey) && view.querySelector(".log-view")) {
        positionLogViewerScroll(logViewerScrollContainer(view), "restore", {top:Number(cached.scrollTop || 0)});
      } else {
        renderLogViewer(cached, tabKey, "restore");
      }
    });
    return;
  }
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
      matchIndex:selectedIndex, activeMatchLine:selectedIndex >= 0 ? Number(matches[selectedIndex]?.line || 0) : 0,
      activeMatchText:selectedIndex >= 0 ? String(matches[selectedIndex]?.text || "") : "",
      detailSearchOpen:Boolean(query.trim()), scrollTop:0
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
    if (mode === "restore") {
      container.scrollTop = Number(previous.top || 0);
    } else if (mode === "preserve") {
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
  const targetScrollRequestId = Number(state.targetScrollRequestId || 0) + 1;
  state.targetScrollRequestId = targetScrollRequestId;
  view.dataset.logTabKey = String(tabKey || "");
  const scrollContainer = logViewerScrollContainer(view);
  const previousScroll = {top:scrollContainer?.scrollTop || 0, height:scrollContainer?.scrollHeight || 0};
  const focusedSearch = document.activeElement?.matches?.("[data-input-action=\"log-detail-search\"]")
    && document.activeElement.dataset.tabKey === String(tabKey);
  const searchSelection = focusedSearch
    ? {start:Number(document.activeElement.selectionStart || 0), end:Number(document.activeElement.selectionEnd || 0)}
    : null;
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
  const aiLabel = tr("terminal:ai.log_open", {defaultValue:"使用 AI 分析日志"});
  const detailSearchOpen = state.detailSearchOpen === true;
  const detailSearch = `<div class="log-detail-search" role="search"${detailSearchOpen ? "" : " hidden"}>
    <label class="search-field">${icon("search")}<input id="logDetailSearch" type="search" autocomplete="off" spellcheck="false" value="${escAttr(query)}" placeholder="${escAttr(detailSearchLabel)}" aria-label="${escAttr(detailSearchLabel)}" data-input-action="log-detail-search" data-tab-key="${escAttr(tabKey)}"></label>
    <span class="log-detail-search-count" aria-live="polite">${esc(matchPosition)}</span>
    <div class="log-detail-search-actions"><button type="button" class="icon-button" data-action="log-detail-search-prev" data-tab-key="${escAttr(tabKey)}" title="${escAttr(previousMatchLabel)}" aria-label="${escAttr(previousMatchLabel)}" ${matchCount ? "" : "disabled"}>${icon("chevron-up")}</button><button type="button" class="icon-button" data-action="log-detail-search-next" data-tab-key="${escAttr(tabKey)}" title="${escAttr(nextMatchLabel)}" aria-label="${escAttr(nextMatchLabel)}" ${matchCount ? "" : "disabled"}>${icon("chevron-down")}</button><button type="button" class="icon-button" data-action="log-detail-search-close" data-tab-key="${escAttr(tabKey)}" title="${escAttr(closeSearchLabel)}" aria-label="${escAttr(closeSearchLabel)}">${icon("x")}</button></div>
  </div>`;
  const older = state.has_older
    ? `<div class="actions log-load-actions"><button onclick="loadOlderLog('${escAttr(tabKey)}')">${icon("chevrons-up")}${esc(tr("common:log_viewer.load_older", {defaultValue:"Load earlier content"}))}</button><span class="muted">${esc(tr("common:log_viewer.chunk_hint", {defaultValue:"Logs are read in 256 KB chunks instead of loading a large file all at once."}))}</span></div>`
    : "";
  const logActions = `<div class="actions log-view-actions"><button type="button" data-action="log-ai-open" data-tab-key="${escAttr(tabKey)}" title="${escAttr(aiLabel)}">${icon("sparkles")}<span>${esc(aiLabel)}</span></button>${window.termaDesktop ? `<button type="button" data-action="log-open-external" data-tab-key="${escAttr(tabKey)}" title="${escAttr(externalLabel)}">${icon("external-link")}<span>${esc(externalLabel)}</span></button>` : ""}</div>`;
  view.innerHTML = `${detailSearch}${logActions}${older}<pre class="log-view" data-i18n-skip>${renderLogTextLines(localizedSystemLogText(state.text || tr("common:log_display.empty", {defaultValue:"Log is empty"}), state), query, state)}</pre>`;
  refreshIcons();
  const nextScroll = scrollMode === "restore" ? {top:Number(state.scrollTop || 0), height:previousScroll.height} : previousScroll;
  const nextContainer = logViewerScrollContainer(view);
  positionLogViewerScroll(nextContainer, scrollMode, nextScroll);
  nextContainer?.addEventListener("scroll", () => { state.scrollTop = Number(nextContainer.scrollTop || 0); }, {passive:true});
  if (focusedSearch) {
    requestAnimationFrame(() => {
      const input = logViewerElement(tabKey)?.querySelector("[data-input-action=\"log-detail-search\"]");
      if (!input) return;
      input.focus({preventScroll:true});
      if (searchSelection) {
        const end = Math.min(input.value.length, searchSelection.end);
        const start = Math.min(end, searchSelection.start);
        try { input.setSelectionRange(start, end); } catch {}
      }
    });
  }
  if (scrollMode === "target") scrollLogViewerTarget(state, view, targetScrollRequestId);
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
  const selectedMatch = logViewerActiveMatch(state);
  const currentLine = Number(selectedMatch?.line || 0);
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lineHasQuery = line => terms.length > 0 && terms.some(term => String(line || "").toLowerCase().includes(term));
  const matchingLineIndexes = lines.map((line, index) => lineHasQuery(line) ? index : -1).filter(index => index >= 0);
  const normalizeMatchText = value => String(value || "").replace(/\s+/g, " ").trim();
  const matchTargetText = match => {
    if (!match?.text || !match?.line) return "";
    const prefix = `${match.line}:`;
    const row = String(match.text).split(/\\r?\\n/).find(value => value.startsWith(prefix));
    return normalizeMatchText(row ? row.slice(prefix.length) : "");
  };
  const targetText = normalizeMatchText(matchTargetText(selectedMatch));
  let currentIndex = currentLine > 0 && firstLine > 0 ? currentLine - firstLine : -1;
  if (targetText) {
    const targetLineIndexes = lines.map((line, index) => lineHasQuery(line) && normalizeMatchText(line).includes(targetText) ? index : -1).filter(index => index >= 0);
    const activeIndex = Number(selectedMatch?.index ?? logViewerMatchIndex(state));
    const sameTextOrdinal = activeIndex >= 0
      ? (state.matches || []).slice(0, activeIndex + 1).map(matchTargetText).filter(value => value === targetText).length - 1
      : 0;
    if (targetLineIndexes.length) currentIndex = targetLineIndexes[Math.max(0, Math.min(targetLineIndexes.length - 1, sameTextOrdinal))];
  }
  if (currentIndex < 0 || currentIndex >= lines.length || !lineHasQuery(lines[currentIndex])) {
    currentIndex = -1;
  }
  if (currentIndex < 0 && matchingLineIndexes.length) {
    const visibleOrdinal = Number(selectedMatch?.index ?? state.matchIndex);
    currentIndex = Number.isInteger(visibleOrdinal) && visibleOrdinal >= 0 && visibleOrdinal < matchingLineIndexes.length
      ? matchingLineIndexes[visibleOrdinal]
      : matchingLineIndexes[matchingLineIndexes.length - 1];
  }
  return lines.map((line, index) => {
    const lineNumber = firstLine > 0 ? firstLine + index : 0;
    const anchor = lineNumber > 0 ? ` data-log-line="${lineNumber}"` : "";
    const current = index === currentIndex;
    const currentAttr = current ? ` data-log-current="true"` : "";
    return `<span class="log-line"${anchor}${currentAttr}>${highlightLogText(line, query, current)}</span>`;
  }).join("\n");
}

function scrollLogViewerTarget(state, view, requestId=Number(state?.targetScrollRequestId || 0)) {
  const targetLine = Number(state?.targetLine || 0);
  if (!targetLine || !view) return;
  const container = logViewerScrollContainer(view);
  if (!container) return;
  const isCurrentRequest = () => Number(state?.targetScrollRequestId || 0) === Number(requestId) && container.isConnected && view.isConnected;
  const scroll = () => {
    if (!isCurrentRequest()) return;
    const target = view.querySelector('[data-log-current="true"]') || view.querySelector(`[data-log-line="${targetLine}"]`);
    if (!target) return;
    const marker = target.querySelector("mark.log-search-current") || target;
    const rects = marker.getClientRects?.() || [];
    const rect = [...rects].find(item => item.width > 0 && item.height > 0) || marker.getBoundingClientRect();
    if (!rect || !rect.height || !container.clientHeight) return;
    const containerRect = container.getBoundingClientRect();
    const targetCenter = rect.top + rect.height / 2;
    const containerCenter = containerRect.top + container.clientHeight / 2;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextScrollTop = container.scrollTop + targetCenter - containerCenter;
    container.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
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


function highlightLogText(text, query=logSearch, current=false) {
  const escaped = esc(text);
  const q = String(query || "").trim();
  if (!q) return escaped;
  const parts = q.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!parts.length) return escaped;
  let currentApplied = false;
  return escaped.replace(new RegExp(`(${parts.join("|")})`, "gi"), match => {
    const active = current && !currentApplied;
    currentApplied ||= active;
    return `<mark${active ? ` class="log-search-current"` : ""}>${match}</mark>`;
  });
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
    state.activeMatchLine = Number(match.line || 0);
    state.activeMatchText = String(match.text || "");
    logViewerState = state;
    renderLogViewer(state, tabKey, "target");
  });
}

async function setLogViewerSearch(value, tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  if (!state) return;
  clearTimeout(logViewerSearchTimers.get(String(tabKey || "")) || 0);
  logViewerSearchTimers.delete(String(tabKey || ""));
  const query = String(value || "").trim();
  const requestId = Number(state.detailSearchRequestId || 0) + 1;
  state.detailSearchRequestId = requestId;
  state.query = query;
  state.matchIndex = -1;
  state.activeMatchLine = 0;
  state.activeMatchText = "";
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
  const key = String(tabKey || "");
  clearTimeout(logViewerSearchTimers.get(key) || 0);
  const timer = setTimeout(() => {
    logViewerSearchTimers.delete(key);
    void setLogViewerSearch(state.pendingSearchQuery, tabKey);
  }, 180);
  logViewerSearchTimers.set(key, timer);
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
