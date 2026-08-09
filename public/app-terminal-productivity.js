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
  if (!tab) return notify("没有可恢复的已关闭标签", "info");
  localStorage.setItem("closedWorkspaceTabsV1", JSON.stringify(productivityState.closedTabs));
  if (Number(tab.id) && !currentConnection(Number(tab.id))) return notify("原连接已删除，无法恢复这个标签", "error");
  let key = tab.key;
  if (tabs.some(item => item.key === key)) key = `${key}-restored-${Date.now()}`;
  addTab(key, tab.title, tab.subtitle, tab.viewName, tab.closable !== false, {...tab, key, pinned:false});
  renderTabContent(tabs.find(item => item.key === key));
  notify("已恢复最近关闭的标签", "success");
}

function openTerminalBroadcastPicker() {
  const terminalTabs = tabs.filter(tab => tab.kind === "terminal");
  if (terminalTabs.length < 2) return notify("至少打开两个终端后才能广播输入", "info");
  const selected = productivityState.broadcastTargets.size
    ? productivityState.broadcastTargets
    : new Set(terminalTabs.map(tab => tab.key));
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-card"><h2>终端广播</h2><label>选择要同步输入的终端</label><div class="snippet-target-grid">${terminalTabs.map(tab => `<label class="checkline"><input name="broadcastTarget" type="checkbox" value="${escAttr(tab.key)}" ${selected.has(tab.key) ? "checked" : ""}>${esc(tab.title)}</label>`).join("")}</div><div class="actions"><button class="primary" onclick="startTerminalBroadcast()">开始同步</button><button onclick="closeModal()">取消</button></div></div>`;
}

function startTerminalBroadcast() {
  const targets = [...document.querySelectorAll("input[name='broadcastTarget']:checked")].map(input => input.value);
  if (targets.length < 2) return notify("请至少选择两个需要同步的终端", "info");
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
  bar.innerHTML = `${icon("radio")}<strong>终端同步</strong><span>${esc(message || `${keys.length} 个终端 · 可在任意选中终端输入`)}</span><button class="icon-button terminal-broadcast-exit" onclick="stopTerminalBroadcast()" title="退出终端同步" aria-label="退出终端同步">${icon("x")}</button>`;
  document.body.classList.add("terminal-broadcast-active");
  refreshIcons();
}

function sendBroadcastPayload(sourceKey, outgoing, raw="") {
  const keys = terminalBroadcastKeys();
  for (const key of keys) {
    const session = terminalSessions.get(key);
    if (key !== sourceKey && /[\r\n]/.test(raw) && typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
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
      updateTerminalBroadcastBar("有终端正在等待隐藏输入，已暂停同步");
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
    confirmModal(`即将向 ${keys.length} 个终端发送：\n\n${value}`, "确认广播输入", "发送", "取消", true)
      .then(accepted => {
        if (accepted) sendBroadcastPayload(sourceKey, outgoing, raw);
        if (typeof focusTerminalSession === "function") focusTerminalSession(sourceKey);
      });
  } else sendBroadcastPayload(sourceKey, outgoing, raw);
  return true;
}

function noteTerminalCommandStarted(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  session.smartCommandStartedAt = Date.now();
  session.smartHadOutput = false;
  clearTimeout(session.smartCompletionTimer);
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
  const text = typeof chunk === "string" ? chunk : "";
  session.smartOutputTail = `${session.smartOutputTail || ""}${text}`.slice(-500);
  session.sensitiveInput = /(?:password|passphrase|口令|密码)\s*[:：]?\s*$/i.test(session.smartOutputTail);
  if (text) session.smartHadOutput = true;
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (tab && !isWorkspaceTabCurrentlyVisible(key) && tab.activityState !== "output") {
    tab.activityState = "output";
    renderTabsPreservingTerminalFocus();
  }
  const oscComplete = /\x1b\]133;D(?:;\d+)?(?:\x07|\x1b\\)/.test(text);
  if (oscComplete) return markTerminalCommandComplete(key, "shell");
  if (!session.smartCommandStartedAt || !session.smartHadOutput) return;
  clearTimeout(session.smartCompletionTimer);
  session.smartCompletionTimer = setTimeout(() => markTerminalCommandComplete(key, "idle"), 1400);
}

function markTerminalCommandComplete(key, source="idle") {
  const session = terminalSessions.get(key);
  if (!session?.smartCommandStartedAt) return;
  const elapsed = Date.now() - session.smartCommandStartedAt;
  session.smartCommandStartedAt = 0;
  clearTimeout(session.smartCompletionTimer);
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab || isWorkspaceTabCurrentlyVisible(key)) return;
  tab.activityState = "complete";
  renderTabsPreservingTerminalFocus();
  const connection = currentConnection(session.id);
  if (elapsed >= 5000 && !connection?.notifications_muted && !tab.notificationsMuted) {
    const event = {title:"命令已完成", message:`${tab.title} · ${Math.max(1, Math.round(elapsed / 1000))} 秒`, action:{type:"tab", key}};
    notify(event.message, "success");
    if (typeof showDesktopNotification === "function") showDesktopNotification(event);
  }
}

function markWorkspaceTabViewed(key) {
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab?.activityState) return;
  tab.activityState = "";
}

async function toggleConnectionNotifications(id) {
  const connection = currentConnection(Number(id));
  if (!connection) return;
  const muted = connection.notifications_muted ? 0 : 1;
  await api(`/api/connections/${id}/flags`, {method:"POST", body:JSON.stringify({favorite:Number(connection.favorite || 0), notifications_muted:muted})});
  connection.notifications_muted = muted;
  notify(muted ? "已静音此连接的命令完成通知" : "已开启此连接的命令完成通知", "success");
}

function toggleTabNotifications(key) {
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab || tab.kind !== "terminal") return;
  tab.notificationsMuted = !tab.notificationsMuted;
  if (typeof hideTabContextMenu === "function") hideTabContextMenu();
  saveTabsState();
  renderTabs();
  notify(tab.notificationsMuted ? "已静音此终端标签的命令完成通知" : "已开启此终端标签的命令完成通知", "success");
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
