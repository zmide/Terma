function runningForwardRows() {
  const needle = String(runningFilter || "").trim().toLowerCase();
  return connections.flatMap(connection => (connection.forwards || [])
    .filter(forward => ["running", "reconnecting", "failed"].includes(String(forward.status || "")))
    .map(forward => ({connection, forward})))
    .filter(({connection, forward}) => !needle || [
      connection.name,
      connection.ssh_host,
      forwardDisplayName(forward),
      forwardText(forward),
      forward.service_note,
      forwardStatusText(forward.status)
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(needle)))
    .sort((left, right) => {
      const rank = {failed:0, reconnecting:1, running:2};
      return (rank[left.forward.status] ?? 3) - (rank[right.forward.status] ?? 3)
        || String(left.connection.name || "").localeCompare(String(right.connection.name || ""), document.documentElement.lang || "zh-CN", {numeric:true})
        || String(forwardDisplayName(left.forward)).localeCompare(String(forwardDisplayName(right.forward)), document.documentElement.lang || "zh-CN", {numeric:true});
    });
}

function renderRunningForwardRow(connection, forward, labels) {
  const access = forwardCanAccess(forward) ? forwardAccessInfo(forward) : null;
  const runtimeDetail = forwardQualityText(forward);
  const failureTime = forward.status === "failed" ? forwardEventTimeText(forward.updated_at) : "";
  const clearTitle = forward.status === "failed" ? labels.clear : labels.stop;
  return `<article class="forward-running-row" data-forward-id="${Number(forward.id)}">
    <button class="running-forward-main" data-action="running-forward-manage" data-forward-id="${Number(forward.id)}" title="${escAttr(labels.manage)}">
      <span class="running-forward-title"><strong>${esc(forwardDisplayName(forward))}</strong><span class="status-pill ${escAttr(forward.status || "stopped")}">${esc(forwardStatusText(forward.status))}</span></span>
      <span class="forward-tags"><span>${forwardModeText(forward.mode)}</span>${forward.service_type ? `<span>${serviceTypeText(forward.service_type)}</span>` : ""}</span>
      <span class="conn-meta">${esc(connection.name)} · ${forwardText(forward)}</span>
      ${failureTime ? `<span class="conn-meta">${esc(tr("connections:forwards.failed_at", {time:failureTime, defaultValue:`失败于 ${failureTime}`}))}</span>` : ""}
      ${runtimeDetail ? `<span class="conn-meta">${runtimeDetail}</span>` : ""}
      ${forward.service_note ? `<span class="conn-meta">${esc(forward.service_note)}</span>` : ""}
      ${forward.last_error ? `<span class="conn-meta error forward-error-detail">${esc(forward.last_error).slice(0,500)}</span>` : ""}
      ${access?.url ? `<code class="running-forward-url" title="${escAttr(access.url)}">${esc(access.url)}</code>` : ""}
    </button>
    <div class="running-actions">
      ${access?.url ? `<a class="open-forward-link" href="${escAttr(access.url)}" target="_blank" rel="noopener" title="${escAttr(labels.open)}" aria-label="${escAttr(labels.open)}">${icon("external-link")}<span>${esc(labels.open)}</span></a><button class="icon-button" data-action="running-forward-copy" data-copy-text="${escAttr(access.url)}" title="${escAttr(labels.copy)}" aria-label="${escAttr(labels.copy)}">${icon("copy")}</button>` : `<span class="muted running-no-url" title="${escAttr(labels.noAddress)}">${esc(labels.noAddress)}</span>`}
      <button class="icon-button" data-action="running-forward-retry" data-forward-id="${Number(forward.id)}" title="${escAttr(labels.retry)}" aria-label="${escAttr(labels.retry)}">${icon("rotate-cw")}</button>
      <button class="danger icon-button" data-action="running-forward-stop" data-forward-id="${Number(forward.id)}" title="${escAttr(clearTitle)}" aria-label="${escAttr(clearTitle)}">${icon(forward.status === "failed" ? "circle-x" : "square")}</button>
      ${forward.last_error && forward.updated_at ? `<button class="forward-error-log-link" data-action="running-forward-log" data-log-time="${Number(forward.updated_at)}" title="${escAttr(labels.failureLogs)}" aria-label="${escAttr(labels.failureLogs)}">${icon("scroll-text")}<span>${esc(labels.failureLogs)}</span></button>` : ""}
    </div>
  </article>`;
}

function renderRunningForwards() {
  const root = $("connectionGroups");
  if (!root) return;
  const uiState = captureUiState(root);
  const labels = {
    running:tr("connections:forwards.running", {defaultValue:"运行中"}),
    reconnecting:tr("connections:forwards.reconnecting", {defaultValue:"重连中"}),
    failed:tr("connections:forwards.failed", {defaultValue:"启动失败"}),
    search:tr("connections:forward_manager.search_current", {defaultValue:"搜索正在转发和失败项"}),
    open:tr("common:auto.open", {defaultValue:"打开"}),
    copy:tr("common:auto.copy", {defaultValue:"复制"}),
    retry:tr("common:actions.retry", {defaultValue:"重试"}),
    clear:tr("common:auto.clear", {defaultValue:"清除"}),
    stop:tr("connections:actions.stop_forwards", {defaultValue:"停止转发"}),
    failureLogs:tr("common:workspace.failure_logs", {defaultValue:"失败日志"}),
    noAddress:tr("connections:forward_manager.no_running_address", {defaultValue:"当前没有可访问地址"}),
    manage:tr("connections:forward_manager.manage_rule", {defaultValue:"在转发列表中管理"})
  };
  const allCurrent = connections.flatMap(connection => (connection.forwards || [])
    .filter(forward => ["running", "reconnecting", "failed"].includes(String(forward.status || "")))
    .map(forward => ({connection, forward})));
  const rows = runningForwardRows();
  const runningCount = allCurrent.filter(({forward}) => forward.status === "running").length;
  const reconnectingCount = allCurrent.filter(({forward}) => forward.status === "reconnecting").length;
  const failedCount = allCurrent.filter(({forward}) => forward.status === "failed").length;
  root.innerHTML = `<div class="running-overview"><span title="${escAttr(`${runningCount} ${labels.running}`)}"><strong>${runningCount}</strong><span class="running-overview-label">${esc(labels.running)}</span></span><span class="${reconnectingCount ? "warning" : ""}" title="${escAttr(`${reconnectingCount} ${labels.reconnecting}`)}"><strong>${reconnectingCount}</strong><span class="running-overview-label">${esc(labels.reconnecting)}</span></span><span class="${failedCount ? "bad" : ""}" title="${escAttr(`${failedCount} ${labels.failed}`)}"><strong>${failedCount}</strong><span class="running-overview-label">${esc(labels.failed)}</span></span></div>
    <div class="running-toolbar"><label class="search-field">${icon("search")}<input id="runningFilterInput" value="${escAttr(runningFilter)}" data-input-action="running-forward-filter" placeholder="${escAttr(labels.search)}" aria-label="${escAttr(labels.search)}"></label></div>
    <div class="running-forward-list">${rows.length ? rows.map(({connection, forward}) => renderRunningForwardRow(connection, forward, labels)).join("") : stateView("empty", allCurrent.length ? tr("common:auto.no_matches", {defaultValue:"没有匹配结果"}) : tr("connections:forward_manager.no_active", {defaultValue:"当前没有正在转发或失败的规则"}), allCurrent.length ? labels.search : tr("connections:forward_manager.no_active_hint", {defaultValue:"可在右侧转发列表中启动或新增规则。"}))}</div>`;
  restoreUiState(uiState);
  refreshIcons();
}

function setRunningFilter(value) {
  runningFilter = value || "";
  localStorage.setItem("runningFilter", runningFilter);
  renderRunningForwards();
}

function toggleRunningGroup() {}
function setRunningGroupMode() {}

if (typeof registerTermaAction === "function") {
  registerTermaAction("running-forward-filter", ({element}) => setRunningFilter(element.value));
  registerTermaAction("running-forward-manage", ({element}) => openGlobalForwardManager(true, Number(element.dataset.forwardId || 0)));
  registerTermaAction("running-forward-copy", ({element}) => copyText(element.dataset.copyText || ""));
  registerTermaAction("running-forward-retry", ({element}) => retryForwardFromRunning(Number(element.dataset.forwardId || 0), element));
  registerTermaAction("running-forward-stop", ({element}) => stopForwardFromRunning(Number(element.dataset.forwardId || 0)));
  registerTermaAction("running-forward-log", ({element}) => openSystemLogAt(Number(element.dataset.logTime || 0)));
}
