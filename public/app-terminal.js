function terminalSessionEncoding(key, connection) {
  return terminalSessions.get(key)?.terminalEncoding || connection?.terminal_encoding || "utf8";
}

function terminalEncodingLabel(connection, key="") {
  return terminalEncodingOptions.find(([value]) => value === terminalSessionEncoding(key, connection))?.[1] || "UTF-8";
}

function terminalElementForKey(key, selector) {
  if (typeof workspaceElementForTab === "function") {
    const element = workspaceElementForTab(key, selector);
    if (element) return element;
  }
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(String(key || ""));
  const toolbarElement = document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`)?.querySelector(selector);
  if (toolbarElement) return toolbarElement;
  const session = terminalSessions.get(key);
  const pane = session?.term?.element?.closest?.(".workspace-pane");
  return pane?.querySelector(selector) || null;
}

function updateTerminalStatusForLayout(key=activeTabKey) {
  const status = terminalElementForKey(key, "#terminalStatus");
  if (!status) return;
  const address = status.dataset.connectionAddress || "";
  const state = status.dataset.connectionState || "连接中";
  status.textContent = isMobileLayout() ? `${address}${state ? ` · ${state}` : ""}` : "";
  status.title = `${address}${state ? ` · ${state}` : ""}`;
}

function syncTerminalToolbarPlacement(tabKey=activeTabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (tab?.kind !== "terminal") return;
  const pane = typeof workspaceFindPaneForTab === "function" ? workspaceFindPaneForTab(key) : null;
  const view = pane && typeof workspacePaneElement === "function"
    ? workspacePaneElement(pane.id)?.querySelector("#view-terminal")
    : $("view-terminal");
  if (!view) return;
  const mount = view.querySelector("#terminalToolbarMount");
  const escapedKey = typeof workspaceCssEscape === "function" ? workspaceCssEscape(key) : CSS.escape(key);
  const toolbar = mount?.querySelector(":scope > .terminal-toolbar")
    || document.querySelector(`.terminal-toolbar[data-workspace-tab-key="${escapedKey}"]`);
  if (!mount || !toolbar) return;
  view.dataset.workspaceTabKey = key;
  view.dataset.terminalTabKey = key;
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("terminal", key, toolbar, mount);
  if (typeof placeWorkspaceToolbar === "function") placeWorkspaceToolbar("terminal", key, toolbar, mount);
  else {
    mount.replaceChildren(toolbar);
    toolbar.hidden = false;
    toolbar.classList.remove("terminal-toolbar-header");
  }
  if (typeof syncWorkspaceToolbarHostVisibility === "function") syncWorkspaceToolbarHostVisibility();
  updateTerminalStatusForLayout(key);
  scheduleTerminalFit();
}

function updateTerminalConnectionStatus(connection, key, state="") {
  const connectionStatus = state === "已连接" ? "connected" : state === "已断开" ? "disconnected" : "connecting";
  setWorkspaceTabConnectionStatus(key, connectionStatus);
  const status = terminalElementForKey(key, "#terminalStatus");
  if (!status) return;
  status.dataset.connectionAddress = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
  status.dataset.connectionState = state;
  const dot = status.closest(".terminal-title-row")?.querySelector(".terminal-connection-dot");
  if (dot) dot.className = `terminal-connection-dot ${connectionStatus}`;
  updateTerminalStatusForLayout(key);
  updateTerminalConnectionToggle(key);
}

function updateTerminalConnectionToggle(key) {
  const session = terminalSessions.get(key);
  const button = terminalElementForKey(key, ".terminal-action-reconnect");
  if (!button) return;
  const connecting = Boolean(session?.socket && session.socket.readyState === WebSocket.CONNECTING);
  const connected = Boolean(session?.connected && session.socket?.readyState === WebSocket.OPEN);
  button.disabled = connecting;
  button.classList.toggle("is-connected", connected);
  button.title = connecting ? "正在连接" : connected ? "断开终端连接" : "重新连接终端";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = connected
    ? `${icon("link-2-off")}<span>断开</span>`
    : `${icon(connecting ? "loader-circle" : "link-2")}<span>${connecting ? "连接中" : "重连"}</span>`;
}

function terminalLatencyTone(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "pending";
  if (milliseconds < 100) return "good";
  if (milliseconds < 250) return "medium";
  return "slow";
}

function terminalLatencyText(session) {
  return Number.isFinite(session?.latencyMs) ? `${session.latencyMs} ms` : "-- ms";
}

function terminalLatencyHtml(key) {
  const session = terminalSessions.get(key);
  const latency = Number(session?.latencyMs);
  return `<span id="terminalLatency" class="terminal-latency ${terminalLatencyTone(latency)}" title="交互响应延迟：从按键发送到远端终端首次返回数据的时间" ${terminalLatencyVisible ? "" : "hidden"}>${icon("gauge")}<span>${esc(terminalLatencyText(session))}</span></span>`;
}

function updateTerminalLatencyDisplay(key) {
  const indicator = terminalElementForKey(key, "#terminalLatency");
  if (!indicator) return;
  const session = terminalSessions.get(key);
  const latency = Number(session?.latencyMs);
  indicator.hidden = !terminalLatencyVisible;
  indicator.className = `terminal-latency ${terminalLatencyTone(latency)}`;
  indicator.innerHTML = `${icon("gauge")}<span>${esc(terminalLatencyText(session))}</span>`;
  indicator.title = Number.isFinite(latency)
    ? `最近交互响应延迟 ${latency} ms；从按键发送到远端终端首次返回数据`
    : "交互响应延迟：从按键发送到远端终端首次返回数据的时间";
}

function setTerminalLatencyVisible(visible) {
  terminalLatencyVisible = Boolean(visible);
  localStorage.setItem("terminalLatencyVisible", terminalLatencyVisible ? "1" : "0");
  const input = $("terminalLatencyVisible");
  if (input) input.checked = terminalLatencyVisible;
  if (!terminalLatencyVisible) {
    for (const session of terminalSessions.values()) {
      session.latencyPendingAt = 0;
      clearTimeout(session.latencyPendingTimer);
      session.latencyPendingTimer = null;
    }
  }
  for (const key of terminalSessions.keys()) updateTerminalLatencyDisplay(key);
}

function startTerminalLatencySample(session) {
  if (!terminalLatencyVisible || !session?.connected || session.latencyPendingAt) return;
  const now = performance.now();
  if (now - Number(session.latencySampledAt || 0) < 500) return;
  session.latencyPendingAt = now;
  clearTimeout(session.latencyPendingTimer);
  session.latencyPendingTimer = setTimeout(() => {
    session.latencyPendingAt = 0;
    session.latencyPendingTimer = null;
  }, 5000);
}

function finishTerminalLatencySample(session, key) {
  const startedAt = Number(session?.latencyPendingAt || 0);
  if (!startedAt) return;
  session.latencyPendingAt = 0;
  clearTimeout(session.latencyPendingTimer);
  session.latencyPendingTimer = null;
  const sample = Math.max(0, Math.round(performance.now() - startedAt));
  if (sample > 5000) return;
  session.latencySamples = [...(session.latencySamples || []), sample].slice(-5);
  const ordered = [...session.latencySamples].sort((left, right) => left - right);
  session.latencyMs = ordered[Math.floor(ordered.length / 2)];
  session.latencySampledAt = performance.now();
  updateTerminalLatencyDisplay(key);
}

function createTerminalLogId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now()}-${String(random).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

function nextTerminalTabIndex(connectionId) {
  const id = Number(connectionId);
  const siblings = tabs.filter(tab => tab.kind === "terminal" && Number(tab.id) === id);
  let current = siblings.length ? Number(terminalCounts.get(id) || 0) : 0;
  for (const tab of siblings) {
    current = Math.max(current, Number(String(tab.key).match(new RegExp(`^terminal-${id}-(\\d+)$`))?.[1] || 0));
  }
  let next = current + 1;
  while (tabs.some(tab => tab.key === `terminal-${id}-${next}`) || terminalSessions.has(`terminal-${id}-${next}`)) next += 1;
  terminalCounts.set(id, next);
  return next;
}

function openTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const c = selectConnection(id);
  if (!c) return;
  if (updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(c.id, "terminal");
  let key = existingKey;
  let title = existingTitle;
  if (!key) {
    const next = nextTerminalTabIndex(c.id);
    key = `terminal-${c.id}-${next}`;
    title = `${c.name} · 终端${next > 1 ? ` #${next}` : ""}`;
  } else {
    const restoredIndex = Number(String(key).match(new RegExp(`^terminal-${c.id}-(\\d+)$`))?.[1] || 0);
    if (restoredIndex > 0) {
      terminalCounts.set(c.id, Math.max(terminalCounts.get(c.id) || 0, restoredIndex));
    }
  }
  const connectionAddress = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  const forwardButton = connectionToggleButton(c)
    .replace("connection-forward-toggle", "connection-forward-toggle terminal-action-forward")
    .replace("<button ", "<button onpointerdown=\"keepTerminalKeyboardClosed(event)\" ");
  const forwardListButton = `<button class="terminal-action-forward-list" type="button" title="转发列表" aria-label="转发列表" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openForwards(${c.id})">${icon("route")}<span>转发列表</span></button>`;
  const terminalView = $("view-terminal");
  terminalView.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><div class="terminal-status" id="terminalStatus" title="${esc(connectionAddress)}">${esc(connectionAddress)}</div>${terminalLatencyHtml(key)}</div><div class="actions terminal-actions"><button class="icon-button terminal-action-sftp" title="打开此连接的 SFTP" aria-label="打开此连接的 SFTP" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openSftp(${c.id})">${icon("folder-open")}<span>SFTP</span></button><button class="icon-button terminal-action-font" title="减小字体（Ctrl+滚轮）" aria-label="减小字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',-1)">${icon("minus")}</button><output class="terminal-font-size-readout" title="当前终端字号">${terminalFontSizeForCurrentLayout(c)}px</output><button class="icon-button terminal-action-font" title="增大字体（Ctrl+滚轮）" aria-label="增大字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',1)">${icon("plus")}</button><button class="terminal-dropdown-button terminal-action-display terminal-action-encoding" title="切换终端编码：${escAttr(terminalEncodingLabel(c, key))}" aria-label="切换终端编码" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalEncodingMenu(event,'${key}',${c.id})">${icon("earth")}<span>${esc(terminalEncodingLabel(c, key))}</span>${icon("chevron-down")}</button><button class="terminal-dropdown-button terminal-action-display" title="切换终端字体" aria-label="切换终端字体" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalFontMenu(event,'${key}',${c.id})">${icon("type")}<span>字体</span>${icon("chevron-down")}</button><button class="icon-button terminal-startup-button" title="终端配置" aria-label="终端配置" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalStartupSettings('${key}',${c.id})">${icon("command")}<span>配置</span></button><button class="icon-button terminal-global-settings-button" title="全局终端设置" aria-label="全局终端设置" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalGlobalSettings('${key}')">${icon("settings")}</button><button class="terminal-action-keys" title="${terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"}" aria-label="${terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalKeys('${key}')">${icon("keyboard")}<span>${terminalKeysVisible ? "隐藏快捷键" : "快捷键"}</span></button><button class="terminal-action-recent" title="最近命令" aria-label="最近命令" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showRecentTerminalCommands('${key}')">${icon("history")}<span>最近命令</span></button><button class="terminal-action-reconnect" title="重新连接终端" aria-label="重新连接终端" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalConnection(${c.id}, '${key}')">${icon("link-2")}<span>重连</span></button>${forwardListButton}${forwardButton}</div></div>${renderTerminalKeys(key)}<div id="terminalMount" class="terminal-box"></div><div class="terminal-mobile-composer"><input id="terminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入命令" onkeydown="handleMobileTerminalInput(event,'${key}')"><button class="primary icon-button" title="发送命令" onclick="sendMobileTerminalInput('${key}')">${icon("send")}</button></div>`;
  terminalView.querySelector(".terminal-startup-button")?.insertAdjacentHTML("afterend", `<button class="icon-button terminal-x11-button${c.x11_mode && c.x11_mode !== "off" ? " active" : ""}" title="X11 图形转发" aria-label="X11 图形转发" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showX11LaunchMenu(event,${c.id})">${icon("x11")}</button>`);
  if (typeof remoteDesktopJumpButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", remoteDesktopJumpButtonHtml(c.id));
  }
  if (typeof localFilesToolbarButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", localFilesToolbarButtonHtml(key));
  }
  terminalView.dataset.workspaceTabKey = key;
  terminalView.dataset.terminalTabKey = key;
  const toolbar = terminalView.querySelector(":scope > .terminal-toolbar");
  const toolbarMount = document.createElement("div");
  toolbarMount.id = "terminalToolbarMount";
  toolbar.before(toolbarMount);
  toolbarMount.appendChild(toolbar);
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("terminal", key, toolbar, toolbarMount);
  const terminalStatus = $("terminalStatus");
  terminalStatus.dataset.connectionAddress = connectionAddress;
  terminalStatus.dataset.connectionState = "连接中";
  setWorkspace(title, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "terminal", key, updateTab, true, {kind:"terminal", id:c.id});
  syncTerminalToolbarPlacement(key);
  updateTerminalStartupButton(key, c);
  attachTerminal(c, key).catch(error => {
    const mount = terminalElementForKey(key, "#terminalMount");
    if (mount) mount.innerHTML = stateView("error", "终端组件加载失败", error.message, `<button onclick="reconnectTerminal(${c.id},'${key}')">重新连接</button>`);
  });
  return key;
}

async function attachTerminal(c, key) {
  const mount = $("terminalMount");
  if (!mount) return;
  await ensureTerminalGlobalSettings();
  await ensureTerminalLibs();
  let session = terminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({
      allowProposedApi:true,
      cursorBlink:true,
      convertEol:true,
      minimumContrastRatio:4.5,
      overviewRuler:{width:8},
      fontFamily:c.terminal_font_family || "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize:terminalFontSizeForCurrentLayout(c),
      lineHeight:Number(c.terminal_line_height) || 1,
      fontWeight:c.terminal_font_weight || "normal",
      wordSeparator:terminalWordSeparator(),
      theme:terminalThemeForSettings()
    });
    const fit = createTerminalFitAddon(term);
    term.loadAddon(fit);
    session = {term, fit, socket:null, connected:false, id:c.id, logId:createTerminalLogId(), terminalEncoding:c.terminal_encoding || "utf8", fontLayoutMobile:isMobileLayout(), currentDirectory:"", currentDirectoryKnown:false};
    terminalSessions.set(key, session);
    registerTerminalDirectoryTracking(session);
  }
  session.connection = c;
  session.key = key;
  session.fontLayoutMobile = isMobileLayout();
  session.mount = mount;
  session.term.options.fontSize = terminalFontSizeForCurrentLayout(c);
  applyTerminalGlobalSettingsToSession(session);
  if (session.term.element) mount.appendChild(session.term.element);
  else session.term.open(mount);
  bindTerminalDropUpload(session, c, key, mount);
  bindTerminalGlobalBehavior(session, key, c.id, mount);
  observeTerminalBox(session);
  enableTerminalTouchScroll(session);
  enableTerminalFontWheel(session, key);
  setTimeout(()=>{
    try { session.fit.fit(); } catch {}
    if (!isMobileLayout()) try { session.term.focus(); } catch {}
    if (!session.socket) connectTerminal(c, key);
    else {
      updateTerminalConnectionStatus(c, key, session.connected ? "已连接" : "已断开");
      updateTerminalLatencyDisplay(key);
    }
    scheduleTerminalFit();
  }, 0);
}

function enableTerminalFontWheel(session, key) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || session.fontWheelBox === box) return;
  session.fontWheelBox = box;
  box.addEventListener("wheel", event => {
    if (!event.ctrlKey) {
      flushTerminalViewportFit(session);
      return;
    }
    if (!event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    queueTerminalFontWheelChange(session, key, event.deltaY < 0 ? 1 : -1);
  }, {passive:false,capture:true});
}

function queueTerminalFontWheelChange(session, key, delta) {
  session.pendingFontWheelDelta = Math.max(-4, Math.min(4, Number(session.pendingFontWheelDelta || 0) + delta));
  if (session.pendingFontWheelTask) return;
  session.pendingFontWheelTask = scheduleTerminalViewportTask(() => {
    session.pendingFontWheelTask = null;
    const pending = Number(session.pendingFontWheelDelta || 0);
    session.pendingFontWheelDelta = 0;
    if (pending) changeTerminalFont(key, pending);
  });
}

function observeTerminalBox(session) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || typeof ResizeObserver === "undefined") return;
  if (session.observedBox === box && session.resizeObserver) return;
  session.resizeObserver?.disconnect?.();
  session.resizeObserver = new ResizeObserver(() => scheduleTerminalFit());
  session.resizeObserver.observe(box);
  session.observedBox = box;
}

function enableTerminalTouchScroll(session) {
  const box = session.term?.element?.closest?.(".terminal-box");
  if (!box || session.touchScrollBox === box) return;
  session.touchScrollBox = box;
  let lastY = 0;
  let carry = 0;
  box.addEventListener("touchstart", event => {
    if (event.target.closest?.("button,a,input,textarea,select")) return;
    lastY = event.touches[0]?.clientY || 0;
    carry = 0;
  }, {passive:true});
  box.addEventListener("touchmove", event => {
    if (event.target.closest?.("button,a,input,textarea,select")) return;
    if (session.cursorCopyState) {
      event.preventDefault();
      return;
    }
    const y = event.touches[0]?.clientY || lastY;
    const dy = y - lastY;
    lastY = y;
    carry += dy;
    const lineHeight = session.term?._core?._renderService?.dimensions?.css?.cell?.height || 18;
    const lines = Math.trunc(carry / lineHeight);
    if (lines) {
      try { session.term.scrollLines(-lines); } catch {}
      carry -= lines * lineHeight;
      event.preventDefault();
    }
  }, {passive:false});
}

function handleMobileTerminalInput(event, key) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  sendMobileTerminalInput(key);
}

function sendMobileTerminalInput(key) {
  const input = $("terminalMobileInput");
  const command = String(input?.value || "");
  if (!command.trim()) return;
  const session = terminalSessions.get(key);
  const connection = session ? currentConnection(session.id) : null;
  if (session && connection) void trackTerminalDirectoryCommand(session, connection, key, command);
  if (typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
  sendTerminalData(key, `${command}\r`);
  saveRecentTerminalCommand(command);
  input.value = "";
  input.focus();
}

function renderTerminalKeys(key) {
  return `<div id="terminalKeys" class="terminal-keys ${terminalKeysVisible ? "" : "hidden"}">
    ${["Esc","Tab","/","-","|","~"].map(label => `<button onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','${escAttr(label)}')">${esc(label)}</button>`).join("")}
    <span class="terminal-arrow-pad"><button class="arrow-up" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↑')">↑</button><button class="arrow-left" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','←')">←</button><button class="arrow-down" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↓')">↓</button><button class="arrow-right" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','→')">→</button></span>
    <button class="${terminalCtrlArmed || terminalCtrlLocked ? "active" : ""}" title="Ctrl 一次：下一个字母按 Ctrl 组合键发送" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="armTerminalCtrl(event)">Ctrl一次</button>
    <button class="${terminalCtrlLocked ? "active" : ""}" title="Ctrl 锁定：连续发送 Ctrl 组合键，再点一次关闭" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleCtrlLock()">Ctrl锁</button>
    ${["C","D","L","A","E","R","Z"].map(label => `<button onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendCtrlCombo('${key}','${label}')">^${label}</button>`).join("")}
  </div>`;
}

function rerenderTerminalKeys(key=activeTabKey) {
  const box = $("terminalKeys");
  if (!box) return;
  const left = box.scrollLeft;
  box.outerHTML = renderTerminalKeys(key);
  const next = $("terminalKeys");
  if (next) next.scrollLeft = left;
}

function toggleTerminalKeys(key) {
  terminalKeysVisible = !terminalKeysVisible;
  localStorage.setItem("terminalKeysVisible", terminalKeysVisible ? "1" : "0");
  openTerminal(currentConnection()?.id || selectedId, false, key, tabs.find(tab => tab.key === key)?.title || "");
}

function armTerminalCtrl() {
  terminalCtrlArmed = !terminalCtrlArmed;
  rerenderTerminalKeys();
}

function toggleCtrlLock() {
  terminalCtrlLocked = !terminalCtrlLocked;
  terminalCtrlArmed = false;
  rerenderTerminalKeys();
}

function terminalSequence(label) {
  return {Esc:"\x1b", Tab:"\t", "↑":"\x1b[A", "↓":"\x1b[B", "→":"\x1b[C", "←":"\x1b[D"}[label] || label;
}

function terminalReconnectInput(data) {
  return ["\r", "\n", "\r\n"].includes(String(data || ""));
}

function sendTerminalData(key, data, options={}) {
  const session = terminalSessions.get(key);
  if (!session) return false;
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    if (terminalReconnectInput(data)) {
      if (session.socket?.readyState !== WebSocket.CONNECTING) reconnectTerminal(session.id, key);
      return true;
    }
    notify("终端尚未连接", "error");
    return false;
  }
  startTerminalLatencySample(session);
  session.socket.send(data);
  const shouldFocus = options.focus ?? !isMobileLayout();
  if (shouldFocus) try { session.term.focus(); } catch {}
  return true;
}

function transformTerminalInputForCtrl(key, data) {
  if (!(terminalCtrlArmed || terminalCtrlLocked)) return data;
  if (!/^[A-Za-z]$/.test(data)) return data;
  const code = data.toUpperCase().charCodeAt(0) - 64;
  if (code < 1 || code > 26) return data;
  if (!terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
  return String.fromCharCode(code);
}

function sendTerminalKey(key, label) {
  if ((terminalCtrlArmed || terminalCtrlLocked) && /^[A-Za-z]$/.test(label)) {
    sendCtrlCombo(key, label);
    return;
  }
  sendTerminalData(key, terminalSequence(label));
  if (terminalCtrlArmed && !terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
}

function sendCtrlCombo(key, letter) {
  const code = String(letter).toUpperCase().charCodeAt(0) - 64;
  if (code < 1 || code > 26) return;
  sendTerminalData(key, String.fromCharCode(code));
  if (!terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
}

function showRecentTerminalCommands(key) {
  const items = recentTerminalCommands.slice(0, 80);
  if (!items.length) return notify("暂无最近命令", "info");
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card wide"><h2>最近命令</h2><div class="muted">序号 1 为最近一次执行</div><div class="recent-command-list">${items.map((cmd, index) => `<button data-index="${index}"><span class="recent-command-index">${index + 1}</span><code>${esc(cmd)}</code></button>`).join("")}</div><div class="actions"><button id="recentCommandClear" class="danger">清空</button><button id="recentCommandClose">关闭</button></div></div>`;
  modal.hidden = false;
  modal.querySelectorAll(".recent-command-list button").forEach(button => {
    button.onclick = () => {
      const cmd = items[Number(button.dataset.index)];
      modal.hidden = true;
      sendTerminalData(key, `${cmd}\r`);
    };
  });
  $("recentCommandClear").onclick = () => {
    recentTerminalCommands = [];
    localStorage.removeItem("recentTerminalCommands");
    modal.hidden = true;
    notify("最近命令已清空", "success");
    focusTerminalSession(key);
  };
  $("recentCommandClose").onclick = () => {
    modal.hidden = true;
    focusTerminalSession(key);
  };
}

function cleanTerminalCommandText(text) {
  return String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trim();
}

function currentTerminalPromptCommand(session) {
  try {
    const buffer = session.term?.buffer?.active;
    const row = buffer?.baseY + buffer?.cursorY;
    const line = buffer?.getLine(row)?.translateToString(true) || "";
    const text = cleanTerminalCommandText(line);
    const markers = ["# ", "$ ", "% ", "> "];
    let index = -1;
    for (const marker of markers) index = Math.max(index, text.lastIndexOf(marker));
    return index >= 0 ? text.slice(index + 2).trim() : "";
  } catch {
    return "";
  }
}

function terminalFontSizeField() {
  return isMobileLayout() ? "terminal_mobile_font_size" : "terminal_font_size";
}

function terminalFontSizeForCurrentLayout(connection) {
  return Number(connection?.[terminalFontSizeField()]) || 13;
}

function captureTerminalViewport(session) {
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return null;
  const viewportY = Number(buffer.viewportY ?? buffer.ydisp ?? 0);
  const baseY = Number(buffer.baseY ?? buffer.ybase ?? 0);
  return {
    viewportY:Math.max(0, viewportY),
    atBottom:viewportY >= Math.max(0, baseY)
  };
}

function scrollTerminalToLineImmediately(term, line) {
  const viewport = term?._core?._viewport;
  if (typeof viewport?.scrollToLine === "function") {
    viewport.scrollToLine(line, true);
    return;
  }
  term?.scrollToLine?.(line);
}

function scheduleTerminalViewportTask(callback) {
  if (typeof requestAnimationFrame === "function") {
    return {frame:requestAnimationFrame(callback)};
  }
  return {timer:setTimeout(callback, 0)};
}

function cancelTerminalViewportTask(task) {
  if (!task) return;
  if (task.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(task.frame);
  if (task.timer) clearTimeout(task.timer);
}

function terminalViewportPixelDrift(term, target) {
  const viewport = term?._core?._viewport;
  const scrollableElement = viewport?._scrollableElement;
  const cellHeight = Number(term?._core?._renderService?.dimensions?.css?.cell?.height || 0);
  if (!scrollableElement || !cellHeight) return false;
  const expected = target * cellHeight;
  const current = Number(scrollableElement.getScrollPosition?.()?.scrollTop);
  const future = Number(scrollableElement._scrollable?.getFutureScrollPosition?.()?.scrollTop);
  return [current, future].some(value => Number.isFinite(value) && Math.abs(value - expected) > 0.75);
}

function restoreTerminalViewport(session, anchor) {
  const term = session?.term;
  const buffer = term?.buffer?.active;
  if (!term || !buffer || !anchor) return;
  const baseY = Math.max(0, Number(buffer.baseY ?? buffer.ybase ?? 0));
  const target = anchor.atBottom
    ? baseY
    : Math.max(0, Math.min(baseY, Number(anchor.viewportY) || 0));
  const current = Math.max(0, Number(buffer.viewportY ?? buffer.ydisp ?? 0));
  if (Math.abs(current - target) < 0.5 && !terminalViewportPixelDrift(term, target)) return;
  try {
    scrollTerminalToLineImmediately(term, target);
  } catch {}
}

function runPendingTerminalViewportFit(session) {
  const anchor = session?.terminalViewportFitAnchor;
  if (!session?.term || !session.fit || !anchor) return;
  cancelTerminalViewportTask(session.terminalViewportFitTask);
  session.terminalViewportFitTask = null;
  session.terminalViewportFitAnchor = null;
  try { session.fit.fit(); } catch {}
  try { session.term.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
  restoreTerminalViewport(session, anchor);
  cancelTerminalViewportTask(session.terminalViewportRestoreTask);
  session.terminalViewportRestoreTask = scheduleTerminalViewportTask(() => {
    session.terminalViewportRestoreTask = null;
    restoreTerminalViewport(session, anchor);
  });
}

function fitTerminalPreservingViewport(session, anchor=captureTerminalViewport(session)) {
  if (!session?.term || !session.fit || !anchor) return;
  if (!session.terminalViewportFitAnchor) session.terminalViewportFitAnchor = anchor;
  if (session.terminalViewportFitTask) return;
  session.terminalViewportFitTask = scheduleTerminalViewportTask(() => runPendingTerminalViewportFit(session));
}

function flushTerminalViewportFit(session) {
  if (session?.terminalViewportFitTask) runPendingTerminalViewportFit(session);
  cancelTerminalViewportTask(session?.terminalViewportRestoreTask);
  if (session) session.terminalViewportRestoreTask = null;
}

function syncTerminalResponsiveFontSizes() {
  const mobile = isMobileLayout();
  for (const session of terminalSessions.values()) {
    if (!session?.term?.options) continue;
    if (session.fontLayoutMobile === mobile) continue;
    const connection = connections.find(item => item.id === session.id);
    if (!connection) continue;
    const viewport = captureTerminalViewport(session);
    session.fontLayoutMobile = mobile;
    session.term.options.fontSize = terminalFontSizeForCurrentLayout(connection);
    fitTerminalPreservingViewport(session, viewport);
  }
}

function changeTerminalFont(key, delta) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const viewport = captureTerminalViewport(session);
  const size = Math.max(10, Math.min(32, Number(session.term.options.fontSize || 13) + delta));
  session.term.options.fontSize = size;
  const readout = terminalElementForKey(key, ".terminal-font-size-readout");
  if (readout) readout.textContent = `${size}px`;
  const connection = connections.find(item => item.id === session.id);
  if (connection) {
    connection[terminalFontSizeField()] = size;
    scheduleTerminalPreferencesSave(connection);
  }
  fitTerminalPreservingViewport(session, viewport);
  focusTerminalSession(key);
}

const terminalPreferencesSaveTimers = new Map();

function scheduleTerminalPreferencesSave(connection) {
  clearTimeout(terminalPreferencesSaveTimers.get(connection.id));
  terminalPreferencesSaveTimers.set(connection.id, setTimeout(() => {
    terminalPreferencesSaveTimers.delete(connection.id);
    api(`/api/connections/${connection.id}/terminal-preferences`, {
      method:"POST",
      body:JSON.stringify({
        terminal_encoding:connection.terminal_encoding || "utf8",
        terminal_font_family:connection.terminal_font_family,
        terminal_font_size:connection.terminal_font_size,
        terminal_mobile_font_size:connection.terminal_mobile_font_size,
        terminal_line_height:connection.terminal_line_height ?? 1,
        terminal_font_weight:connection.terminal_font_weight || "normal"
      })
    }).catch(error => notify(`终端设置保存失败：${error.message}`, "error"));
  }, 300));
}

function focusTerminalSession(key) {
  const session = terminalSessions.get(key);
  setTimeout(() => {
    try { session?.term.focus(); } catch {}
  }, 0);
}

function showTerminalEncodingMenu(event, key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = terminalSessionEncoding(key, connection);
  showActionMenu(event, terminalEncodingOptions.map(([value,label]) => ({
    label,
    icon:value === current ? "check" : "earth",
    run:()=>applyTerminalPreferences(key, connectionId, {terminal_encoding:value}, `编码已切换为 ${label}`)
  })));
}

function showTerminalFontMenu(event, key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const current = connection.terminal_font_family || terminalFontOptions[0][0];
  const currentLineHeight = Number(connection.terminal_line_height) || 1;
  const currentWeight = connection.terminal_font_weight || "normal";
  showActionMenu(event, [
    ...terminalFontOptions.map(([value,label]) => ({
      label,
      icon:value === current ? "check" : "type",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_family:value}, `终端字体已切换为 ${label}`)
    })),
    {separator:true},
    {label:"自定义字体…", icon:"pencil", run:()=>setCustomTerminalFont(key, connectionId)},
    {separator:true},
    ...[[1,"紧凑行距 1.0"],[1.2,"行距 1.2"],[1.4,"行距 1.4"],[1.6,"宽松行距 1.6"]].map(([value,label]) => ({
      label,
      icon:Number(value) === currentLineHeight ? "check" : "between-horizontal-start",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_line_height:Number(value)}, `终端${label}已保存`)
    })),
    {separator:true},
    ...[["normal","常规字重"],["500","中等字重"],["600","半粗字重"],["bold","粗体"]].map(([value,label]) => ({
      label,
      icon:value === currentWeight ? "check" : "bold",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_weight:value}, `终端${label}已保存`)
    })),
    {separator:true},
    {label:"恢复终端显示默认值", icon:"rotate-ccw", run:()=>resetTerminalDisplayPreferences(key, connectionId)}
  ]);
}

async function setCustomTerminalFont(key, connectionId) {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  const value = await inputModal("自定义终端字体", "字体名称或字体栈", connection.terminal_font_family || terminalFontOptions[0][0]);
  if (value) await applyTerminalPreferences(key, connectionId, {terminal_font_family:value}, "自定义终端字体已保存");
  else focusTerminalSession(key);
}

async function resetTerminalDisplayPreferences(key, connectionId) {
  await applyTerminalPreferences(key, connectionId, {
    terminal_font_family:terminalFontOptions[0][0],
    [terminalFontSizeField()]:13,
    terminal_line_height:1,
    terminal_font_weight:"normal"
  }, "终端字体、字号、行距和字重已恢复默认");
}

async function applyTerminalPreferences(key, connectionId, changes, successText="终端设置已保存") {
  const connection = connections.find(item => item.id === connectionId);
  if (!connection) return;
  try {
    const settings = await api(`/api/connections/${connectionId}/terminal-preferences`, {
      method:"POST",
      body:JSON.stringify({
        terminal_encoding:changes.terminal_encoding ?? connection.terminal_encoding ?? "utf8",
        terminal_font_family:changes.terminal_font_family ?? connection.terminal_font_family ?? terminalFontOptions[0][0],
        terminal_font_size:changes.terminal_font_size ?? connection.terminal_font_size ?? 13,
        terminal_mobile_font_size:changes.terminal_mobile_font_size ?? connection.terminal_mobile_font_size ?? 13,
        terminal_line_height:changes.terminal_line_height ?? connection.terminal_line_height ?? 1,
        terminal_font_weight:changes.terminal_font_weight ?? connection.terminal_font_weight ?? "normal"
      })
    });
    Object.assign(connection, settings);
    for (const [sessionKey, activeSession] of terminalSessions) {
      if (activeSession.id !== connectionId) continue;
      const viewport = captureTerminalViewport(activeSession);
      activeSession.term.options.fontFamily = settings.terminal_font_family;
      activeSession.term.options.fontSize = terminalFontSizeForCurrentLayout(settings);
      activeSession.fontLayoutMobile = isMobileLayout();
      activeSession.term.options.lineHeight = settings.terminal_line_height;
      activeSession.term.options.fontWeight = settings.terminal_font_weight;
      const readout = terminalElementForKey(sessionKey, ".terminal-font-size-readout");
      if (readout) readout.textContent = `${terminalFontSizeForCurrentLayout(settings)}px`;
      fitTerminalPreservingViewport(activeSession, viewport);
      const encodingButton = terminalElementForKey(sessionKey, ".terminal-action-encoding span");
      if (encodingButton) encodingButton.textContent = terminalEncodingLabel(connection, sessionKey);
    }
    if (changes.terminal_encoding !== undefined) {
      const activeSession = terminalSessions.get(key);
      if (activeSession?.id === connectionId) {
        activeSession.terminalEncoding = settings.terminal_encoding;
        const socket = activeSession.socket;
        const sendEncoding = () => {
          if (activeSession.socket !== socket || activeSession.terminalEncoding !== settings.terminal_encoding) return;
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:"terminal-encoding", encoding:settings.terminal_encoding}));
        };
        if (socket?.readyState === WebSocket.OPEN) sendEncoding();
      }
    }
    notify(successText, "success");
  } finally {
    focusTerminalSession(key);
  }
}

function terminalBufferText(session) {
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return "";
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  return lines.join("\n").replace(/\s+$/, "");
}

function closeTerminalSessionText(key) {
  const modal = $("modal");
  modal.onclick = null;
  modal.onkeydown = null;
  modal.hidden = true;
  modal.innerHTML = "";
  focusTerminalSession(key);
}

function showTerminalSessionText(key) {
  const session = terminalSessions.get(key);
  if (!session) return notify("终端会话不存在", "error");
  const text = formatTerminalCopiedText(terminalBufferText(session));
  if (!text) return notify("终端暂无可复制内容", "info");
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card terminal-session-text-modal" role="dialog" aria-modal="true" aria-labelledby="terminalSessionTextTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalSessionTextTitle">选择文本</h2><span>${text.split("\n").length} 行 · ${text.length} 个字符</span></div><button id="terminalSessionTextClose" class="icon-button" type="button" title="关闭" aria-label="关闭">${icon("x")}</button></div>
    <textarea id="terminalSessionTextEditor" class="terminal-session-text-editor" readonly spellcheck="false" aria-label="整个终端会话文本"></textarea>
    <div class="actions terminal-session-text-actions"><button id="terminalSessionTextCancel" type="button">关闭</button><button id="terminalSessionTextCopy" class="primary" type="button">${icon("copy-check")}<span>复制全部</span></button></div>
  </div>`;
  modal.hidden = false;
  const editor = $("terminalSessionTextEditor");
  editor.value = text;
  $("terminalSessionTextClose").onclick = () => closeTerminalSessionText(key);
  $("terminalSessionTextCancel").onclick = () => closeTerminalSessionText(key);
  $("terminalSessionTextCopy").onclick = async () => {
    if (await copyText(editor.value)) closeTerminalSessionText(key);
  };
  modal.onkeydown = event => {
    if (event.key === "Escape") closeTerminalSessionText(key);
  };
  editor.focus({preventScroll:true});
  editor.scrollTop = editor.scrollHeight;
}

async function copyTerminalText(key) {
  const session = terminalSessions.get(key);
  if (!session) return notify("终端会话不存在", "error");
  const text = session.term.hasSelection?.() ? session.term.getSelection() : "";
  if (!text) return notify("请先选择终端文本", "info");
  await copyText(formatTerminalCopiedText(text));
}

async function pasteTerminalText(key) {
  let text = "";
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
    text = await navigator.clipboard.readText();
  } catch {
    notify("无法直接读取剪贴板，请在编辑框中使用系统粘贴", "info");
    text = await editTerminalMultilinePaste("");
    if (text === null) {
      focusTerminalSession(key);
      return false;
    }
  }
  if (!text) return notify("剪贴板中没有文本", "info");
  return sendTerminalPasteText(key, text);
}

function showTerminalContextMenu(event, key, connectionId) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const mobile = isMobileLayout();
  showActionMenu(event, [
    ...(!mobile ? [{label:"复制选中", icon:"copy", run:()=>copyTerminalText(key)}] : []),
    {label:"光标复制", icon:"mouse-pointer-2", run:()=>startTerminalCursorCopy(key)},
    {label:"会话复制", icon:"copy-check", run:()=>showTerminalSessionText(key)},
    {label:"粘贴", icon:"clipboard-paste", run:()=>pasteTerminalText(key)},
    {separator:true},
    {label:"清屏", icon:"eraser", run:()=>{ session.term.clear(); session.term.focus(); }},
    {label:"滚动到底部", icon:"arrow-down-to-line", run:()=>session.term.scrollToBottom()},
    {label:session.term.getSelection?.().trim() ? "在 SFTP 打开选中路径" : "在 SFTP 打开当前目录", icon:"folder-open", run:()=>openTerminalPathInSftp(connectionId, key)},
    {separator:true},
    {label:"终端配置", icon:"command", run:()=>showTerminalStartupSettings(key, connectionId)},
    {label:session.connected ? "断开连接" : "重新连接", icon:session.connected ? "link-2-off" : "link-2", run:()=>toggleTerminalConnection(connectionId, key)},
    ...(!mobile ? [{separator:true}, {label:"全局终端设置", icon:"settings", run:()=>showTerminalGlobalSettings(key)}] : [])
  ]);
}

async function connectTerminal(c, key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const attempt = Number(session.connectionAttempt || 0) + 1;
  session.connectionAttempt = attempt;
  const previousSocket = session.socket;
  session.socket = null;
  try { previousSocket?.close(); } catch {}
  try { session.inputDisposable?.dispose(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const title = tab?.title || `${c.name} · 终端`;
  session.connected = false;
  session.currentDirectory = "";
  session.currentDirectoryKnown = false;
  session.previousDirectory = "";
  session.homeDirectory = "";
  updateTerminalConnectionStatus(c, key, "连接中");
  session.term.writeln(`连接 ${c.ssh_user}@${c.ssh_host}:${c.ssh_port} ...`);
  try {
    await api("/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection_id:c.id})
    });
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    session.term.writeln(`\r\n[${error.code === "SSH_HOST_TRUST_CANCELLED" ? "已取消连接" : `SSH 主机身份校验失败：${error.message}`}]`);
    updateTerminalConnectionStatus(c, key, "已断开");
    if (error.code !== "SSH_HOST_TRUST_CANCELLED") notify(error.message || "SSH 主机身份校验失败", "error");
    return;
  }
  let startupToken = "";
  const startupOverride = terminalStartupOverrides.has(key) ? terminalStartupOverrides.get(key) : null;
  const effectiveX11Mode = String(startupOverride?.x11_mode || c.x11_mode || "off");
  const explicitX11Request = ["trusted", "untrusted"].includes(String(startupOverride?.x11_mode || ""));
  try {
    if (startupOverride || ["trusted", "untrusted"].includes(effectiveX11Mode)) {
      const ticket = await api("/api/terminal/startup-tickets", {
        method:"POST",
        body:JSON.stringify({
          connection_id:c.id,
          startup:startupOverride || {}
        })
      });
      startupToken = ticket.token || "";
    }
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    if (error.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED" && !explicitX11Request) {
      try {
        const fallbackTicket = await api("/api/terminal/startup-tickets", {
          method:"POST",
          body:JSON.stringify({
            connection_id:c.id,
            startup:{...(startupOverride || {}), x11_mode:"off"}
          })
        });
        startupToken = fallbackTicket.token || "";
        session.term.writeln("\r\n[X11] 当前浏览器没有桌面集成授权，已自动降级为普通 SSH 终端。");
        notify("X11 未授权，本终端已自动改用普通 SSH", "info");
      } catch (fallbackError) {
        session.term.writeln(`\r\n[普通 SSH 降级失败：${fallbackError.message}]`);
        updateTerminalConnectionStatus(c, key, "已断开");
        notify(fallbackError.message || "普通 SSH 降级失败", "error");
        return;
      }
    } else if (error.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED") {
      session.term.writeln(`\r\n[X11] ${error.message}`);
      session.term.writeln("[请在 X Server 窗口选择授权时长并申请授权，完成后点击重连]");
      updateTerminalConnectionStatus(c, key, "等待授权");
      notify(error.message || "当前浏览器没有 X11 桌面集成授权", "error");
      if (typeof openXServerManager === "function") {
        try { await openXServerManager(); }
        catch {}
      }
      return;
    } else {
      session.term.writeln(`\r\n[临时启动配置准备失败：${error.message}]`);
      updateTerminalConnectionStatus(c, key, "已断开");
      notify(error.message || "临时启动配置准备失败", "error");
      return;
    }
  }
  if (
    session.connectionAttempt !== attempt
    || terminalSessions.get(key) !== session
    || !(typeof workspaceHasTabKey === "function" ? workspaceHasTabKey(key) : tabs.some(item => item.key === key))
  ) return;
  const startupQuery = startupToken ? `&startup_token=${encodeURIComponent(startupToken)}` : "";
  const logQuery = session.logId ? `&log_id=${encodeURIComponent(session.logId)}` : "";
  const encodingQuery = `&encoding=${encodeURIComponent(session.terminalEncoding || c.terminal_encoding || "utf8")}`;
  const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal?id=${encodeURIComponent(c.id)}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}${encodingQuery}${logQuery}${startupQuery}`);
  socket.binaryType = "arraybuffer";
  session.socket = socket;
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    session.connected = true;
    socket.send(JSON.stringify({type:"terminal-encoding", encoding:session.terminalEncoding || c.terminal_encoding || "utf8"}));
    updateTerminalConnectionStatus(c, key, "已连接");
    void initializeTerminalDirectory(session, c, key);
  });
  socket.addEventListener("message", event => {
    if (session.socket !== socket) return;
    finishTerminalLatencySample(session, key);
    const terminalOutput = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    session.term.write(terminalOutput);
    if (typeof updateTerminalSmartState === "function") updateTerminalSmartState(key, typeof event.data === "string" ? event.data : "");
    if (isMobileLayout()) scheduleTerminalFit();
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.connected = false;
    session.latencyPendingAt = 0;
    clearTimeout(session.latencyPendingTimer);
    session.term.writeln("\r\n[连接已关闭，按 Enter 重新连接]");
    updateTerminalConnectionStatus(c, key, "已断开");
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) session.term.writeln("\r\n[WebSocket 连接失败]");
  });
  session.inputDisposable = session.term.onData(data => {
    const beforeCtrl = terminalCtrlArmed || terminalCtrlLocked;
    const outgoing = transformTerminalInputForCtrl(key, data);
    if (!beforeCtrl) trackTerminalCommand(session, data);
    if ((data.includes("\r") || data.includes("\n")) && typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
    if (socket.readyState === WebSocket.OPEN) {
      startTerminalLatencySample(session);
      if (!(typeof handleTerminalBroadcastInput === "function" && handleTerminalBroadcastInput(key, outgoing, data))) socket.send(outgoing);
    } else if (terminalReconnectInput(data) && session.socket === socket) {
      reconnectTerminal(c.id, key);
    }
  });
  session.resizeDisposable = session.term.onResize(size => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:"resize", cols:size.cols, rows:size.rows}));
  });
}

function trackTerminalCommand(session, data) {
  session.commandBuffer = session.commandBuffer || "";
  const raw = String(data || "");
  if (raw.includes("\x1b")) return;
  for (const ch of String(data || "")) {
    if (ch === "\r" || ch === "\n") {
      const command = currentTerminalPromptCommand(session) || session.commandBuffer;
      saveRecentTerminalCommand(command);
      const connection = currentConnection(session.id);
      if (connection) void trackTerminalDirectoryCommand(session, connection, session.key || activeTabKey, command);
      session.commandBuffer = "";
    } else if (ch === "\x7f" || ch === "\b") {
      session.commandBuffer = session.commandBuffer.slice(0, -1);
    } else if (ch === "\x03") {
      session.commandBuffer = "";
    } else if (ch === "\t") {
      session.commandBuffer = "";
    } else if (ch >= " " && ch !== "\x7f") {
      session.commandBuffer += ch;
    }
  }
}

function reconnectTerminal(id, key=`terminal-${id}-1`) {
  const c = currentConnection(id);
  if (!c) return;
  const session = terminalSessions.get(key);
  if (session) session.term.reset();
  connectTerminal(c, key);
  focusTerminalSession(key);
}

function disconnectTerminal(key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  session.connectionAttempt = Number(session.connectionAttempt || 0) + 1;
  const socket = session.socket;
  session.connected = false;
  session.latencyPendingAt = 0;
  clearTimeout(session.latencyPendingTimer);
  try { socket?.close(1000, "user disconnect"); } catch {}
  updateTerminalConnectionStatus(currentConnection(session.id), key, "已断开");
  focusTerminalSession(key);
}

function toggleTerminalConnection(id, key=`terminal-${id}-1`) {
  const session = terminalSessions.get(key);
  if (session?.connected || session?.socket?.readyState === WebSocket.CONNECTING) disconnectTerminal(key);
  else reconnectTerminal(id, key);
}
