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

function isRecoverableTerminalTab(tab) {
  return Boolean(tab?.kind === "terminal"
    && String(tab.sessionMode || "none") === "persistent"
    && String(tab.persistentSessionId || "").trim());
}

function recoverableTerminalIdentity(tab) {
  if (!tab) return "";
  return `${Number(tab.id || 0)}\u0000${String(tab.persistentSessionId || "").trim()}`;
}

function loadRecoverableTerminalRecords() {
  loadClosedWorkspaceTabs();
  const records = [];
  const seen = new Set();
  for (const tab of tabs.filter(isRecoverableTerminalTab)) {
    const identity = recoverableTerminalIdentity(tab);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    records.push({tab, open:true, identity});
  }
  for (const tab of productivityState.closedTabs.filter(isRecoverableTerminalTab)) {
    const identity = recoverableTerminalIdentity(tab);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    records.push({tab, open:false, identity});
  }
  return records;
}

function removeClosedRecoverableTerminalRecord(record) {
  const identity = record?.identity || recoverableTerminalIdentity(record?.tab);
  if (!identity) return;
  productivityState.closedTabs = productivityState.closedTabs.filter(tab => recoverableTerminalIdentity(tab) !== identity);
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
}

function recoverableTerminalStatus(record) {
  if (record?.open) {
    const tab = tabs.find(item => item.key === record.tab.key);
    const status = tab?.connectionStatus || "disconnected";
    return tr(`terminal:session.manager.status_${status}`, {
      defaultValue:status === "connected" ? "已连接" : status === "connecting" ? "连接中" : "已断开"
    });
  }
  return tr("terminal:session.manager.status_closed", {defaultValue:"标签已关闭，会话仍在远端运行"});
}

function recoverableTerminalConnectionLabel(tab) {
  const connection = currentConnection(Number(tab?.id || 0));
  if (connection) return `${connection.ssh_user || ""}@${connection.ssh_host || ""}:${connection.ssh_port || 22}`;
  return tr("terminal:session.manager.connection_missing", {defaultValue:"连接已删除"});
}

async function restoreRecoverableTerminalRecord(record) {
  if (!record?.tab) return;
  if (record.open) {
    activateTab(record.tab.key);
    focusTerminalSession(record.tab.key);
    closeModal();
    return;
  }
  const connection = currentConnection(Number(record.tab.id || 0));
  if (!connection) return notify(tr("terminal:session.manager.connection_missing", {defaultValue:"SSH 连接不存在，无法恢复会话"}), "error");
  let key = String(record.tab.key || `terminal-${connection.id}-restored`);
  if (tabs.some(item => item.key === key)) key = `${key}-restored-${Date.now()}`;
  const restoredTab = {...record.tab, key, pinned:false, connectionStatus:"disconnected"};
  removeClosedRecoverableTerminalRecord(record);
  addTab(key, restoredTab.title || `${connection.name || connection.ssh_host} · Terminal`, restoredTab.subtitle || `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`, "terminal", restoredTab.closable !== false, restoredTab);
  renderTabContent(restoredTab);
  closeModal();
  notify(tr("terminal:session.manager.restored", {defaultValue:"可恢复会话已重新打开"}), "success");
}

async function terminateRecoverableTerminalRecord(record) {
  if (!record?.tab) return;
  const confirmed = await confirmModal(
    tr("terminal:session.terminate_confirm", {defaultValue:"终止远端可恢复会话？其中的进程和终端历史将被清除。"}),
    tr("terminal:session.manager.terminate_title", {defaultValue:"终止可恢复会话"}),
    tr("terminal:session.manager.terminate", {defaultValue:"终止并清理"}),
    tr("common:actions.cancel", {defaultValue:"取消"}),
    true
  );
  if (!confirmed) return;
  try {
    if (record.open) {
      const ok = await terminateTerminalPersistence(record.tab.key, {skipConfirm:true});
      if (!ok) return;
    } else {
      await terminateTerminalPersistenceRecord(record.tab);
      removeClosedRecoverableTerminalRecord(record);
      notify(tr("terminal:session.terminated", {defaultValue:"远端可恢复会话已终止"}), "success");
    }
    saveTabsState();
    openTerminalSessionManager();
  } catch (error) {
    notify(error.message || tr("terminal:session.terminate_failed", {defaultValue:"终止远端会话失败"}), "error");
  }
}

function openTerminalSessionManager() {
  const modal = $("modal");
  if (!modal) return;
  const records = loadRecoverableTerminalRecords();
  const title = tr("terminal:session.manager.title", {defaultValue:"可恢复终端会话"});
  const subtitle = tr("terminal:session.manager.subtitle", {count:records.length, defaultValue:`管理可恢复远端会话（${records.length}）`});
  const empty = tr("terminal:session.manager.empty", {defaultValue:"当前没有可恢复的远端终端会话"});
  modal.onclick = null;
  modal.onkeydown = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeModal();
  };
  modal.innerHTML = `<div class="modal-card productivity-manager terminal-session-manager" role="dialog" aria-modal="true" aria-labelledby="terminalSessionManagerTitle">
    <div class="productivity-manager-head"><div><h2 id="terminalSessionManagerTitle">${esc(title)}</h2><span>${esc(subtitle)}</span></div><button id="terminalSessionManagerClose" class="icon-button" type="button" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div>
    <div class="productivity-list terminal-session-manager-list">${records.length ? records.map((record, index) => {
      const tab = record.tab;
      const openLabel = record.open ? tr("terminal:session.manager.open_active", {defaultValue:"定位"}) : tr("terminal:session.manager.open", {defaultValue:"重新打开"});
      const status = recoverableTerminalStatus(record);
      const backend = String(tab.sessionBackend || "auto").toLowerCase();
      const connectionLabel = recoverableTerminalConnectionLabel(tab);
      const canOpen = Boolean(currentConnection(Number(tab.id || 0)));
      const compactStatus = record.open ? status : tr("terminal:session.manager.status_remote", {defaultValue:"远端运行"});
      const backendLabel = tr("terminal:session.manager.backend", {backend, defaultValue:`后端：${backend}`});
      const terminateLabel = tr("terminal:session.manager.terminate", {defaultValue:"终止并清理"});
      return `<div class="productivity-row terminal-session-manager-row" data-session-manager-index="${index}"><span class="terminal-session-manager-icon" aria-hidden="true">${icon(record.open ? "terminal" : "history")}</span><div class="terminal-session-manager-copy"><div class="terminal-session-manager-title"><strong>${esc(tab.title || tr("common:dialogs.unnamed_tab", {defaultValue:"未命名标签"}))}</strong><span class="terminal-session-manager-status ${record.open ? "open" : "remote"}" title="${escAttr(status)}">${esc(compactStatus)}</span></div><small>${esc(connectionLabel)} · ${esc(backendLabel)}</small></div><div class="actions"><button type="button" class="icon-button terminal-session-manager-open" data-index="${index}" ${canOpen ? "" : "disabled"} title="${escAttr(openLabel)}" aria-label="${escAttr(openLabel)}">${icon(record.open ? "focus" : "folder-open")}</button><button type="button" class="icon-button danger terminal-session-manager-terminate" data-index="${index}" title="${escAttr(terminateLabel)}" aria-label="${escAttr(terminateLabel)}">${icon("x-circle")}</button></div></div>`;
    }).join("") : `<div class="ui-state empty"><span class="ui-state-icon" aria-hidden="true"></span><strong>${esc(empty)}</strong></div>`}</div>
    <div class="actions"><button id="terminalSessionManagerRefresh" type="button">${icon("refresh-cw")}<span>${esc(tr("common:actions.refresh", {defaultValue:"刷新"}))}</span></button><button id="terminalSessionManagerDone" class="primary" type="button">${esc(tr("common:actions.done", {defaultValue:"完成"}))}</button></div>
  </div>`;
  modal.hidden = false;
  $("terminalSessionManagerClose").onclick = closeModal;
  $("terminalSessionManagerDone").onclick = closeModal;
  $("terminalSessionManagerRefresh").onclick = openTerminalSessionManager;
  modal.querySelectorAll(".terminal-session-manager-open").forEach(button => {
    button.onclick = () => restoreRecoverableTerminalRecord(records[Number(button.dataset.index)]);
  });
  modal.querySelectorAll(".terminal-session-manager-terminate").forEach(button => {
    button.onclick = () => terminateRecoverableTerminalRecord(records[Number(button.dataset.index)]);
  });
  $("terminalSessionManagerDone")?.focus();
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
