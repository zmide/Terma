function loadClosedWorkspaceTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem("closedWorkspaceTabsV1") || "[]");
    productivityState.closedTabs = Array.isArray(saved) ? saved : [];
  } catch {
    productivityState.closedTabs = [];
  }
}

function rememberClosedWorkspaceTabs(keys) {
  const closing = keys.map(key => {
    const tab = tabs.find(item => item.key === key);
    if (!tab?.kind) return null;
    const state = sftpViewStates.get(key);
    return {...tab, path:tab.kind === "sftp" ? (state?.path || tab.path || ".") : tab.path, closed_at:Date.now()};
  }).filter(Boolean);
  if (!closing.length) return;
  productivityState.closedTabs = [...closing.reverse(), ...productivityState.closedTabs.filter(item => !closing.some(tab => tab.key === item.key))].slice(0, 30);
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
}

function restoreRecentlyClosedTab() {
  loadClosedWorkspaceTabs();
  const tab = productivityState.closedTabs.shift();
  if (!tab) return notify(tr("terminal:productivity.no_closed_tab"), "info");
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
  if (Number(tab.id) && !currentConnection(Number(tab.id))) return notify(tr("terminal:productivity.connection_deleted"), "error");
  let key = tab.key;
  if (tabs.some(item => item.key === key)) key = `${key}-restored-${Date.now()}`;
  addTab(key, tab.title, tab.subtitle, tab.viewName, tab.closable !== false, {...tab, key, pinned:false});
  renderTabContent(tabs.find(item => item.key === key));
  notify(tr("terminal:productivity.tab_restored"), "success");
}

function openTerminalBroadcastPicker() {
  const terminalTabs = tabs.filter(tab => tab.kind === "terminal");
  if (terminalTabs.length < 2) return notify(tr("common:notifications.terminal_broadcast_minimum", {defaultValue:"至少打开两个终端后才能广播输入"}), "info");
  const selected = productivityState.broadcastTargets.size
    ? productivityState.broadcastTargets
    : new Set(terminalTabs.map(tab => tab.key));
  const title = tr("terminal:broadcast.title", {defaultValue:"终端广播"});
  const selectTargets = tr("terminal:broadcast.select_targets", {defaultValue:"选择要同步输入的终端"});
  const startLabel = tr("terminal:broadcast.start", {defaultValue:"开始同步"});
  const cancelLabel = tr("common:actions.cancel", {defaultValue:"取消"});
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card terminal-broadcast-modal" role="dialog" aria-modal="true" aria-labelledby="terminalBroadcastTitle"><h2 id="terminalBroadcastTitle">${esc(title)}</h2><label id="terminalBroadcastTargetLabel">${esc(selectTargets)}</label><div class="snippet-target-grid terminal-broadcast-target-grid" role="group" aria-labelledby="terminalBroadcastTargetLabel">${terminalTabs.map(tab => `<label class="checkline snippet-target-option" title="${escAttr(tab.title)}"><input name="broadcastTarget" type="checkbox" value="${escAttr(tab.key)}" aria-label="${escAttr(tab.title)}" ${selected.has(tab.key) ? "checked" : ""}><span class="snippet-target-name">${esc(tab.title)}</span></label>`).join("")}</div><div class="actions"><button class="primary" onclick="startTerminalBroadcast()" title="${escAttr(startLabel)}" aria-label="${escAttr(startLabel)}">${esc(startLabel)}</button><button onclick="closeModal()" title="${escAttr(cancelLabel)}" aria-label="${escAttr(cancelLabel)}">${esc(cancelLabel)}</button></div></div>`;
}

function startTerminalBroadcast() {
  const targets = [...document.querySelectorAll("input[name='broadcastTarget']:checked")].map(input => input.value);
  if (targets.length < 2) return notify(tr("common:notifications.terminal_sync_minimum", {defaultValue:"请至少选择两个需要同步的终端"}), "info");
  productivityState.broadcastTargets = new Set(targets);
  closeModal();
  updateTerminalBroadcastBar();
  renderTabs();
  if (targets.includes(activeTabKey) && typeof focusTerminalSession === "function") focusTerminalSession(activeTabKey);
}

function stopTerminalBroadcast() {
  productivityState.broadcastTargets.clear();
  productivityState.broadcastPaused = false;
  updateTerminalBroadcastBar();
  renderTabsPreservingTerminalFocus();
}

function isTerminalBroadcastTarget(key) {
  return productivityState.broadcastTargets.has(String(key || ""));
}

function terminalBroadcastKeys() {
  const openTerminalKeys = new Set(tabs.filter(tab => tab.kind === "terminal").map(tab => tab.key));
  return [...productivityState.broadcastTargets].filter(key => openTerminalKeys.has(key));
}

function updateTerminalBroadcastBar(message="") {
  let bar = document.getElementById("terminalBroadcastBar");
  const keys = terminalBroadcastKeys();
  if (keys.length < 2) {
    productivityState.broadcastTargets.clear();
    bar?.remove();
    document.body.classList.remove("terminal-broadcast-active");
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "terminalBroadcastBar";
    bar.className = "terminal-broadcast-bar";
    const quickActions = document.getElementById("workspaceQuickActions");
    if (quickActions) quickActions.before(bar);
    else document.querySelector(".topbar")?.appendChild(bar);
  }
  productivityState.broadcastTargets = new Set(keys);
  const statusTitle = tr("terminal:broadcast.status_title", {defaultValue:"终端同步"});
  const statusMessage = message || tr("terminal:broadcast.status_message", {count:keys.length, defaultValue:`${keys.length} 个终端 · 可在任意选中终端输入`});
  const exitLabel = tr("terminal:broadcast.exit", {defaultValue:"退出终端同步"});
  const fullStatus = `${statusTitle} · ${statusMessage}`;
  bar.innerHTML = `${icon("radio")}<div class="terminal-broadcast-copy" role="status" aria-live="polite" aria-label="${escAttr(fullStatus)}" title="${escAttr(fullStatus)}"><strong>${esc(statusTitle)}</strong><span>${esc(statusMessage)}</span></div><button class="icon-button terminal-broadcast-exit" onclick="stopTerminalBroadcast()" title="${escAttr(exitLabel)}" aria-label="${escAttr(exitLabel)}">${icon("x")}</button>`;
  document.body.classList.add("terminal-broadcast-active");
  refreshIcons();
}

function sendBroadcastPayload(sourceKey, outgoing, raw="") {
  const keys = terminalBroadcastKeys();
  for (const key of keys) {
    const session = terminalSessions.get(key);
    if (session?.socket?.readyState === WebSocket.OPEN) session.socket.send(outgoing);
  }
}

function handleTerminalBroadcastInput(sourceKey, outgoing, raw) {
  const keys = terminalBroadcastKeys();
  if (!productivityState.broadcastTargets.has(sourceKey)) return false;
  if (keys.length < 2) {
    stopTerminalBroadcast();
    return false;
  }
  const sensitive = keys.some(key => terminalSessions.get(key)?.sensitiveInput);
  if (sensitive) {
    const source = terminalSessions.get(sourceKey);
    if (source?.socket?.readyState === WebSocket.OPEN) source.socket.send(outgoing);
    if (!productivityState.broadcastPaused) {
      productivityState.broadcastPaused = true;
      updateTerminalBroadcastBar(tr("terminal:broadcast.paused_hidden_input", {defaultValue:"有终端正在等待隐藏输入，已暂停同步"}));
    }
    return true;
  }
  if (productivityState.broadcastPaused) {
    productivityState.broadcastPaused = false;
    updateTerminalBroadcastBar();
  }
  const value = String(raw || "");
  const needsConfirmation = value.length > 2 && (/[\r\n]/.test(value) || (typeof commandLooksDangerous === "function" && commandLooksDangerous(value)));
  if (needsConfirmation) {
    confirmModal(
      tr("terminal:broadcast.confirm_message", {count:keys.length, value, defaultValue:`即将向 ${keys.length} 个终端发送：\n\n${value}`}),
      tr("terminal:broadcast.confirm_title", {defaultValue:"确认广播输入"}),
      tr("terminal:broadcast.send", {defaultValue:"发送"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )
      .then(accepted => {
        if (accepted) sendBroadcastPayload(sourceKey, outgoing, raw);
        if (typeof focusTerminalSession === "function") focusTerminalSession(sourceKey);
      });
  } else sendBroadcastPayload(sourceKey, outgoing, raw);
  return true;
}

function isWorkspaceTabCurrentlyVisible(key) {
  if (typeof workspaceVisiblePanes === "function") {
    return workspaceVisiblePanes().some(pane => pane.activeTabKey === key);
  }
  return activeTabKey === key;
}

function renderTabsPreservingTerminalFocus() {
  const focusedKey = activeView === "terminal" && document.activeElement?.closest?.(".xterm") ? activeTabKey : "";
  renderTabs();
  if (focusedKey && typeof focusTerminalSession === "function") focusTerminalSession(focusedKey);
}

function updateTerminalSmartState(key, chunk) {
  const session = terminalSessions.get(key);
  if (!session) return;
  let text = typeof chunk === "string" ? chunk : "";
  let hasOutput = text.length > 0;
  const bytes = chunk instanceof Uint8Array
    ? chunk
    : chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : null;
  if (bytes) {
    hasOutput = bytes.byteLength > 0;
    if (hasOutput) {
      try {
        if (!session.smartOutputDecoder) session.smartOutputDecoder = new TextDecoder("utf-8", {fatal:false});
        text = session.smartOutputDecoder.decode(bytes, {stream:true});
      } catch {
        text = "";
      }
    }
  }
  session.smartOutputTail = `${session.smartOutputTail || ""}${text}`.slice(-500);
  session.sensitiveInput = /(?:password|passphrase|口令|密码)\s*[:：]?\s*$/i.test(session.smartOutputTail);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (hasOutput && tab && !isWorkspaceTabCurrentlyVisible(key) && tab.activityState !== "output") {
    tab.activityState = "output";
    renderTabsPreservingTerminalFocus();
  }
}

function markWorkspaceTabViewed(key) {
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab?.activityState) return;
  tab.activityState = "";
}

function terminalSftpPath(key) {
  const session = terminalSessions.get(String(key || ""));
  const selected = String(session?.term?.getSelection?.() || "").trim();
  if (selected && !/\s/.test(selected) && /^(?:\/|\.{1,2}\/|~\/)/.test(selected)) return selected;
  return session?.currentDirectoryKnown ? session.currentDirectory : ".";
}

function openTerminalPathInSftp(connectionId, key) {
  const remotePath = terminalSftpPath(key);
  openSftp(Number(connectionId), remotePath, true);
}
