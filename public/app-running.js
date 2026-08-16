function renderRunningForwards() {
  const uiState = captureUiState($("connectionGroups") || document);
  const labels = {
    running:tr("connections:forwards.running", {defaultValue:"运行中"}),
    reconnecting:tr("connections:forwards.reconnecting", {defaultValue:"重连中"}),
    failed:tr("connections:forwards.failed", {defaultValue:"启动失败"}),
    search:tr("common:auto.search", {defaultValue:"搜索"}),
    rule:tr("connections:forwards.rule", {defaultValue:"转发规则"}),
    server:tr("common:auto.server", {defaultValue:"服务器"}),
    port:tr("common:auto.port", {defaultValue:"端口"}),
    type:tr("common:auto.type", {defaultValue:"类型"}),
    status:tr("common:auto.status", {defaultValue:"状态"}),
    open:tr("common:auto.open", {defaultValue:"打开"}),
    copy:tr("common:auto.copy", {defaultValue:"复制"}),
    retry:tr("common:actions.retry", {defaultValue:"重试"}),
    clear:tr("common:auto.clear", {defaultValue:"清除"}),
    stop:tr("connections:actions.stop_forwards", {defaultValue:"停止转发"}),
    failureLogs:tr("common:workspace.failure_logs", {defaultValue:"失败日志"}),
    noAddress:tr("connections:forwards.no_address", {defaultValue:"无可打开地址"})
  };
  const filterLabel = `${labels.search}: ${labels.rule} · ${labels.server} · ${labels.port}`;
  const rows = connections.flatMap(connection => (connection.forwards || [])
    .filter(forward => forward.status === "running" || forward.status === "reconnecting" || forward.status === "failed")
    .map(forward => ({connection, forward})));
  const filter = runningFilter.trim().toLowerCase();
  const visibleRows = rows.filter(({connection, forward}) => {
    if (!filter) return true;
    return [connection.name, connection.ssh_host, forwardDisplayName(forward), forwardText(forward), forward.service_note, forwardStatusText(forward.status)]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(filter));
  });
  const groups = new Map();
  for (const row of visibleRows) {
    const key = runningGroupMode === "type" ? serviceTypeText(row.forward.service_type || row.forward.mode) : (runningGroupMode === "status" ? forwardStatusText(row.forward.status) : row.connection.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const key of groups.keys()) if (!localStorage.getItem("openRunningGroups")) runningOpen.add(key);
  saveRunningState();
  const runningCount = rows.filter(({forward}) => forward.status === "running").length;
  const reconnectingCount = rows.filter(({forward}) => forward.status === "reconnecting").length;
  const failedCount = rows.filter(({forward}) => forward.status === "failed").length;
  $("connectionGroups").innerHTML = `<div class="running-overview"><span title="${escAttr(`${runningCount} ${labels.running}`)}" aria-label="${escAttr(`${runningCount} ${labels.running}`)}"><strong>${runningCount}</strong><span class="running-overview-label">${esc(labels.running)}</span></span><span class="${reconnectingCount ? "warning" : ""}" title="${escAttr(`${reconnectingCount} ${labels.reconnecting}`)}" aria-label="${escAttr(`${reconnectingCount} ${labels.reconnecting}`)}"><strong>${reconnectingCount}</strong><span class="running-overview-label">${esc(labels.reconnecting)}</span></span><span class="${failedCount ? "bad" : ""}" title="${escAttr(`${failedCount} ${labels.failed}`)}" aria-label="${escAttr(`${failedCount} ${labels.failed}`)}"><strong>${failedCount}</strong><span class="running-overview-label">${esc(labels.failed)}</span></span></div><div class="running-toolbar"><div class="search-field" title="${escAttr(filterLabel)}">${icon("search")}<input id="runningFilterInput" placeholder="${escAttr(labels.search)}" aria-label="${escAttr(filterLabel)}" value="${escAttr(runningFilter)}" oninput="setRunningFilter(this.value)"></div><button class="${runningGroupMode === "server" ? "active" : ""}" title="${escAttr(labels.server)}" aria-label="${escAttr(labels.server)}" onclick="setRunningGroupMode('server')">${esc(labels.server)}</button><button class="${runningGroupMode === "type" ? "active" : ""}" title="${escAttr(labels.type)}" aria-label="${escAttr(labels.type)}" onclick="setRunningGroupMode('type')">${esc(labels.type)}</button><button class="${runningGroupMode === "status" ? "active" : ""}" title="${escAttr(labels.status)}" aria-label="${escAttr(labels.status)}" onclick="setRunningGroupMode('status')">${esc(labels.status)}</button></div>` +
    [...groups.entries()].map(([title, items]) => {
      const open = runningOpen.has(title);
      return `<div class="group">
    <button class="group-head" title="${escAttr(title)}" aria-label="${escAttr(title)}" onclick="toggleRunningGroup(decodeURIComponent('${encodeURIComponent(title)}'))"><span class="chev">${open ? "▾" : "▸"}</span><span>${esc(title)}</span><span class="count">${items.length}</span></button>
    ${open ? items.map(({connection, forward}) => {
      const access = forwardAccessInfo(forward);
      const runtimeDetail = forwardQualityText(forward);
      const failureTime = forward.status === "failed" ? forwardEventTimeText(forward.updated_at) : "";
      const clearTitle = forward.status === "failed" ? labels.clear : labels.stop;
      const displayName = forwardDisplayName(forward);
      return `<div class="forward-running-row">
      <div>
        <div class="conn-name" title="${escAttr(displayName)}">${esc(displayName)}</div>
        <div class="forward-tags"><span>${forwardModeText(forward.mode)}</span>${forward.service_type ? `<span>${serviceTypeText(forward.service_type)}</span>` : ""}</div>
        <div class="conn-meta">${esc(connection.name)} · ${forwardText(forward)}</div>
        <div class="forward-running-state"><span class="status-pill ${escAttr(forward.status || "stopped")}">${forwardStatusText(forward.status)}</span>${failureTime ? `<span>${esc(tr("connections:forwards.failed_at", {time:failureTime, defaultValue:`失败于 ${failureTime}`}))}</span>` : ""}</div>
        ${runtimeDetail ? `<div class="conn-meta">${runtimeDetail}</div>` : ""}
        ${forward.last_error ? `<div class="conn-meta error forward-error-detail">${esc(forward.last_error).slice(0,500)}</div>${forward.updated_at ? `<button class="forward-error-log-link" title="${escAttr(labels.failureLogs)}" aria-label="${escAttr(labels.failureLogs)}" onclick="openSystemLogAt(${Number(forward.updated_at)})">${icon("scroll-text")}<span>${esc(labels.failureLogs)}</span></button>` : ""}` : ""}
        ${forward.service_note ? `<div class="conn-meta">${esc(forward.service_note)}</div>` : ""}
        ${forwardAccessHtml(access)}
      </div>
      <div class="running-actions">${access.url ? `<a class="open-forward-link" href="${escAttr(access.url)}" target="_blank" rel="noopener" title="${escAttr(labels.open)}" aria-label="${escAttr(labels.open)}">${icon("external-link")}<span>${esc(labels.open)}</span></a><button class="icon-button" title="${escAttr(labels.copy)}" aria-label="${escAttr(labels.copy)}" onclick="copyText('${escAttr(access.url)}')">${icon("copy")}</button>` : `<span class="muted running-no-url" title="${escAttr(labels.noAddress)}">${esc(labels.noAddress)}</span>`}<button class="icon-button" title="${escAttr(labels.retry)}" aria-label="${escAttr(labels.retry)}" onclick="retryForwardFromRunning(${forward.id},this)">${icon("rotate-cw")}</button><button class="danger icon-button" title="${escAttr(clearTitle)}" aria-label="${escAttr(clearTitle)}" onclick="stopForwardFromRunning(${forward.id})">${icon(forward.status === "failed" ? "circle-x" : "square")}</button></div>
    </div>`;
    }).join("") : ""}
  </div>`;
    }).join("") || stateView(
      "empty",
      rows.length ? tr("common:auto.no_matches", {defaultValue:"没有匹配结果"}) : tr("connections:forwards.empty", {defaultValue:"暂无转发规则"}),
      rows.length ? filterLabel : tr("connections:forwards.empty_hint", {defaultValue:"添加并启动转发后会显示在这里。"})
    );
  restoreUiState(uiState);
}

function setRunningFilter(value) {
  runningFilter = value || "";
  localStorage.setItem("runningFilter", runningFilter);
  renderRunningForwards();
}

function toggleRunningGroup(name) {
  if (runningOpen.has(name)) runningOpen.delete(name);
  else runningOpen.add(name);
  saveRunningState();
  renderRunningForwards();
}

function setRunningGroupMode(mode) {
  runningGroupMode = mode;
  localStorage.setItem("runningGroupMode", mode);
  renderRunningForwards();
}
