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
  const state = terminalConnectionStateLabel(status.dataset.connectionState || "connecting");
  status.textContent = isMobileLayout() ? `${address}${state ? ` · ${state}` : ""}` : "";
  status.title = `${address}${state ? ` · ${state}` : ""}`;
}

function syncTerminalToolbarPlacement(tabKey=activeTabKey) {
  const key = String(tabKey || "");
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  if (!tab || !["terminal", "quick-terminal"].includes(tab.kind)) return;
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

function terminalConnectionStateLabel(state="connecting") {
  if (state === "connected") return tr("terminal:connection_state.connected", {defaultValue:"已连接"});
  if (state === "disconnected") return tr("terminal:connection_state.disconnected", {defaultValue:"已断开"});
  if (state === "authentication") return tr("terminal:connection_state.authentication", {defaultValue:"等待认证"});
  if (state === "authorization") return tr("terminal:connection_state.authorization", {defaultValue:"等待授权"});
  return tr("terminal:connection_state.connecting", {defaultValue:"连接中"});
}

function updateTerminalConnectionStatus(connection, key, state="connecting") {
  const normalizedState = ["connected", "disconnected", "authentication", "authorization"].includes(state) ? state : "connecting";
  const connectionStatus = normalizedState === "connected" ? "connected" : normalizedState === "disconnected" ? "disconnected" : "connecting";
  setWorkspaceTabConnectionStatus(key, connectionStatus);
  const status = terminalElementForKey(key, "#terminalStatus");
  if (!status) return;
  status.dataset.connectionAddress = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
  status.dataset.connectionState = normalizedState;
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
  button.title = tr(connecting ? "terminal:toolbar.connecting" : connected ? "terminal:toolbar.disconnect" : "terminal:toolbar.reconnect", {
    defaultValue:connecting ? "正在连接" : connected ? "断开终端连接" : "重新连接终端"
  });
  button.setAttribute("aria-label", button.title);
  button.innerHTML = connected
    ? `${icon("link-2-off")}<span>${esc(tr("terminal:toolbar.disconnect_short", {defaultValue:"断开"}))}</span>`
    : `${icon(connecting ? "loader-circle" : "link-2")}<span>${esc(tr(connecting ? "terminal:toolbar.connecting_short" : "terminal:toolbar.reconnect_short", {defaultValue:connecting ? "连接中" : "重连"}))}</span>`;
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
  const hint = tr("terminal:latency.hint", {defaultValue:"交互响应延迟：从按键发送到远端终端首次返回数据的时间"});
  return `<span id="terminalLatency" class="terminal-latency ${terminalLatencyTone(latency)}" title="${escAttr(hint)}" aria-label="${escAttr(hint)}" ${terminalLatencyVisible ? "" : "hidden"}>${icon("gauge")}<span>${esc(terminalLatencyText(session))}</span></span>`;
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
    ? tr("terminal:latency.latest", {latency, defaultValue:`最近交互响应延迟 ${latency} ms；从按键发送到远端终端首次返回数据`})
    : tr("terminal:latency.hint", {defaultValue:"交互响应延迟：从按键发送到远端终端首次返回数据的时间"});
  indicator.setAttribute("aria-label", indicator.title);
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

const quickTerminalConnections = new Map();
const quickConnectionsById = new Map();

function quickConnectionRequestToken(connectionId) {
  return String(quickConnectionsById.get(Number(connectionId))?.quick_token || "");
}

function quickConnectionRequestHeaders(connectionId, headers={}) {
  const token = quickConnectionRequestToken(connectionId);
  return token ? {...headers, "X-Terma-Quick-Connection":token} : headers;
}

function quickConnectionStillUsed(connectionId) {
  const id = Number(connectionId);
  const allTabs = typeof workspaceAllTabs === "function" ? workspaceAllTabs() : tabs;
  return allTabs.some(tab => Number(tab.id) === id && Boolean(tab.quick_connection || tab.kind === "quick-terminal"));
}

function releaseQuickConnectionIfUnused(connectionId) {
  const id = Number(connectionId);
  if (id >= 0 || quickConnectionStillUsed(id)) return;
  const connection = quickConnectionsById.get(id);
  const token = String(connection?.quick_token || "");
  quickConnectionsById.delete(id);
  if (!token) return;
  void api("/api/terminal/quick-tickets", {
    method:"DELETE",
    body:JSON.stringify({token}),
    skipSftpConnect:true,
    skipHostTrustPrompt:true
  }).catch(() => {});
}

function openTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const c = selectConnection(id);
  if (!c) return;
  if (!c.quick_connection && updateTab && typeof noteConnectionUsage === "function") noteConnectionUsage(c.id, "terminal");
  return openTerminalConnection(c, updateTab, existingKey, existingTitle);
}

function openQuickTerminal(connection, quickToken, updateTab=true, existingKey="", existingTitle="") {
  const c = {
    ...connection,
    id:Number(connection?.id || 0),
    quick_connection:true,
    quick_token:String(quickToken || ""),
    terminal_encoding:connection?.terminal_encoding || "utf8",
    terminal_font_family_inherit:1,
    terminal_font_size_inherit:1,
    terminal_mobile_font_size_inherit:1,
    terminal_line_height:1,
    terminal_font_weight:"normal",
    x11_mode:["trusted", "untrusted"].includes(String(connection?.x11_mode || "")) ? connection.x11_mode : "off"
  };
  if (!Number.isSafeInteger(c.id) || c.id >= 0) throw new Error(tr("terminal:errors.invalid_quick_connection_id", {defaultValue:"临时连接标识无效"}));
  const key = existingKey || `quick-terminal-${createTerminalLogId()}`;
  quickTerminalConnections.set(key, c);
  if (!quickConnectionsById.has(c.id)) quickConnectionsById.set(c.id, c);
  return openTerminalConnection(c, updateTab, key, existingTitle || tr("terminal:tabs.quick", {name:c.name, defaultValue:`${c.name} · 快速终端`}));
}

function restoreQuickTerminalTab(tab) {
  const connection = quickTerminalConnections.get(tab?.key) || terminalSessions.get(tab?.key)?.connection;
  if (!connection) return renderWelcome();
  return openTerminalConnection(connection, false, tab.key, tab.title || tr("terminal:tabs.quick_generic", {defaultValue:"快速终端"}));
}

function openTerminalConnection(c, updateTab=true, existingKey="", existingTitle="") {
  const quick = Boolean(c.quick_connection);
  let key = existingKey;
  let title = existingTitle;
  if (!key) {
    const next = nextTerminalTabIndex(c.id);
    key = `terminal-${c.id}-${next}`;
    const suffix = next > 1 ? ` #${next}` : "";
    title = tr("terminal:tabs.session", {name:c.name, suffix, defaultValue:`${c.name} · 终端${suffix}`});
  } else {
    const restoredIndex = Number(String(key).match(new RegExp(`^terminal-${c.id}-(\\d+)$`))?.[1] || 0);
    if (restoredIndex > 0) {
      terminalCounts.set(c.id, Math.max(terminalCounts.get(c.id) || 0, restoredIndex));
    }
  }
  const connectionAddress = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  const forwardButton = quick ? "" : connectionToggleButton(c)
    .replace("connection-forward-toggle", "connection-forward-toggle terminal-action-forward")
    .replace("<button ", "<button onpointerdown=\"keepTerminalKeyboardClosed(event)\" ");
  const forwardListText = tr("terminal:toolbar.forward_list", {defaultValue:"转发列表"});
  const openSftpText = tr("terminal:toolbar.open_sftp", {defaultValue:"打开此连接的 SFTP"});
  const encodingLabel = terminalEncodingLabel(c, key);
  const changeEncodingText = tr("terminal:toolbar.change_encoding", {encoding:encodingLabel, defaultValue:`切换终端编码：${encodingLabel}`});
  const changeFontText = tr("terminal:toolbar.change_font", {defaultValue:"切换终端字体"});
  const fontText = tr("terminal:toolbar.font", {defaultValue:"字体"});
  const startupText = tr("terminal:toolbar.startup", {defaultValue:"终端配置"});
  const configText = tr("terminal:toolbar.config", {defaultValue:"配置"});
  const forwardListButton = quick ? "" : `<button class="terminal-action-forward-list" type="button" title="${escAttr(forwardListText)}" aria-label="${escAttr(forwardListText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openForwards(${c.id})">${icon("route")}<span>${esc(forwardListText)}</span></button>`;
  const savedConnectionActions = `<button class="icon-button terminal-action-sftp" title="${escAttr(openSftpText)}" aria-label="${escAttr(openSftpText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="openSftp(${c.id})">${icon("folder-open")}<span>SFTP</span></button>`;
  const savedDisplayActions = `<button class="terminal-dropdown-button terminal-action-display terminal-action-encoding" title="${escAttr(changeEncodingText)}" aria-label="${escAttr(tr("terminal:toolbar.change_encoding_short", {defaultValue:"切换终端编码"}))}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalEncodingMenu(event,'${key}',${c.id})">${icon("earth")}<span>${esc(encodingLabel)}</span>${icon("chevron-down")}</button><button class="terminal-dropdown-button terminal-action-display" title="${escAttr(changeFontText)}" aria-label="${escAttr(changeFontText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalFontMenu(event,'${key}',${c.id})">${icon("type")}<span>${esc(fontText)}</span>${icon("chevron-down")}</button>${quick ? "" : `<button class="icon-button terminal-startup-button" title="${escAttr(startupText)}" aria-label="${escAttr(startupText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalStartupSettings('${key}',${c.id})">${icon("command")}<span>${esc(configText)}</span></button>`}`;
  const quickCommandButton = typeof terminalQuickCommandToolbarButton === "function" ? terminalQuickCommandToolbarButton(key) : "";
  const quickCommandBar = typeof renderTerminalQuickCommandBar === "function" ? renderTerminalQuickCommandBar(key) : "";
  const terminalView = $("view-terminal");
  const decreaseFontText = tr("terminal:toolbar.decrease_font", {defaultValue:"减小字体"});
  const increaseFontText = tr("terminal:toolbar.increase_font", {defaultValue:"增大字体"});
  const globalSettingsText = tr("terminal:toolbar.global_settings", {defaultValue:"全局终端设置"});
  const toggleKeysText = tr(terminalKeysVisible ? "terminal:toolbar.hide_shortcuts" : "terminal:toolbar.show_shortcuts", {defaultValue:terminalKeysVisible ? "隐藏快捷键" : "显示快捷键"});
  const shortcutText = tr(terminalKeysVisible ? "terminal:toolbar.hide_shortcuts_short" : "terminal:toolbar.shortcuts", {defaultValue:terminalKeysVisible ? "隐藏快捷键" : "快捷键"});
  const recentText = tr("terminal:toolbar.recent_commands", {defaultValue:"最近命令"});
  const reconnectText = tr("terminal:toolbar.reconnect", {defaultValue:"重新连接终端"});
  const reconnectShortText = tr("terminal:toolbar.reconnect_short", {defaultValue:"重连"});
  const commandPlaceholder = tr("terminal:toolbar.command_placeholder", {defaultValue:"输入命令"});
  const sendText = tr("terminal:toolbar.send_command", {defaultValue:"发送命令"});
  terminalView.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><div class="terminal-status" id="terminalStatus" title="${esc(connectionAddress)}">${esc(connectionAddress)}</div>${quick ? `<span class="terminal-quick-badge">${esc(tr("terminal:toolbar.temporary", {defaultValue:"临时"}))}</span>` : ""}${terminalLatencyHtml(key)}</div><div class="actions terminal-actions">${savedConnectionActions}<button class="icon-button terminal-action-font" title="${escAttr(tr("terminal:toolbar.decrease_font_hint", {defaultValue:"减小字体（Ctrl+滚轮）"}))}" aria-label="${escAttr(decreaseFontText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',-1)">${icon("minus")}</button><output class="terminal-font-size-readout" title="${escAttr(tr("terminal:toolbar.current_font_size", {defaultValue:"当前终端字号"}))}">${terminalFontSizeForCurrentLayout(c)}px</output><button class="icon-button terminal-action-font" title="${escAttr(tr("terminal:toolbar.increase_font_hint", {defaultValue:"增大字体（Ctrl+滚轮）"}))}" aria-label="${escAttr(increaseFontText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="changeTerminalFont('${key}',1)">${icon("plus")}</button>${savedDisplayActions}<button class="icon-button terminal-global-settings-button" title="${escAttr(globalSettingsText)}" aria-label="${escAttr(globalSettingsText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalGlobalSettings('${key}')">${icon("settings")}</button><button class="terminal-action-keys" title="${escAttr(toggleKeysText)}" aria-label="${escAttr(toggleKeysText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalKeys('${key}')">${icon("keyboard")}<span>${esc(shortcutText)}</span></button>${quickCommandButton}<button class="terminal-action-recent" title="${escAttr(recentText)}" aria-label="${escAttr(recentText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showRecentTerminalCommands('${key}')">${icon("history")}<span>${esc(recentText)}</span></button><button class="terminal-action-reconnect" title="${escAttr(reconnectText)}" aria-label="${escAttr(reconnectText)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleTerminalConnection(${c.id}, '${key}')">${icon("link-2")}<span>${esc(reconnectShortText)}</span></button>${forwardListButton}${forwardButton}</div></div>${renderTerminalKeys(key)}<div id="terminalMount" class="terminal-box" data-i18n-skip="true"></div>${quickCommandBar}<div class="terminal-mobile-composer"><input id="terminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escAttr(commandPlaceholder)}" onkeydown="handleMobileTerminalInput(event,'${key}')"><button class="primary icon-button" title="${escAttr(sendText)}" aria-label="${escAttr(sendText)}" onclick="sendMobileTerminalInput('${key}')">${icon("send")}</button></div>`;
  const sftpToolbarButton = terminalView.querySelector(".terminal-action-sftp");
  if (sftpToolbarButton) {
    sftpToolbarButton.innerHTML = `${icon("folder-sync")}<span>SFTP</span>`;
    sftpToolbarButton.title = tr("terminal:toolbar.open_sftp_manager", {defaultValue:"打开此连接的 SFTP 文件管理"});
    sftpToolbarButton.setAttribute("aria-label", sftpToolbarButton.title);
  }
  const x11Anchor = terminalView.querySelector(".terminal-startup-button") || [...terminalView.querySelectorAll(".terminal-action-display")].at(-1);
  const x11Text = tr("terminal:toolbar.x11", {defaultValue:"X11 图形转发"});
  x11Anchor?.insertAdjacentHTML("afterend", `<button class="icon-button terminal-x11-button${c.x11_mode && c.x11_mode !== "off" ? " active" : ""}" title="${escAttr(x11Text)}" aria-label="${escAttr(x11Text)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="${quick ? `showQuickX11LaunchMenu(event,'${key}')` : `showX11LaunchMenu(event,${c.id},'${key}')`}">${icon("x11")}</button>`);
  if (!quick && typeof remoteDesktopJumpButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", remoteDesktopJumpButtonHtml(c.id));
  }
  if (!quick && typeof localFilesToolbarButtonHtml === "function") {
    terminalView.querySelector(".terminal-action-sftp")?.insertAdjacentHTML("afterend", localFilesToolbarButtonHtml(key));
  }
  terminalView.dataset.workspaceTabKey = key;
  terminalView.dataset.terminalTabKey = key;
  if (typeof mountTerminalQuickCommandBar === "function") mountTerminalQuickCommandBar(key, terminalView);
  const toolbar = terminalView.querySelector(":scope > .terminal-toolbar");
  const toolbarMount = document.createElement("div");
  toolbarMount.id = "terminalToolbarMount";
  toolbar.before(toolbarMount);
  toolbarMount.appendChild(toolbar);
  if (typeof registerWorkspaceToolbar === "function") registerWorkspaceToolbar("terminal", key, toolbar, toolbarMount);
  const terminalStatus = $("terminalStatus");
  terminalStatus.dataset.connectionAddress = connectionAddress;
  terminalStatus.dataset.connectionState = "connecting";
  setWorkspace(title, `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`, "terminal", key, updateTab, true, {kind:quick ? "quick-terminal" : "terminal", id:c.id, connectionStatus:"connecting", transient:quick, quick_connection:quick});
  syncTerminalToolbarPlacement(key);
  if (!quick) updateTerminalStartupButton(key, c);
  attachTerminal(c, key).catch(error => {
    const mount = terminalElementForKey(key, "#terminalMount");
    if (mount) mount.innerHTML = stateView(
      "error",
      tr("terminal:components.load_failed", {defaultValue:"终端组件加载失败"}),
      error.message,
      `<button onclick="reconnectTerminal(${c.id},'${key}')">${esc(tr("terminal:toolbar.reconnect", {defaultValue:"重新连接"}))}</button>`
    );
  });
  return key;
}

async function attachTerminal(c, key) {
  const mount = $("terminalMount");
  if (!mount) return;
  await ensureTerminalGlobalSettings();
  await ensureTerminalLibs();
  try { await ensureTerminalZmodemLibrary(); } catch {}
  let session = terminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({
      allowProposedApi:true,
      cursorBlink:true,
      convertEol:true,
      minimumContrastRatio:4.5,
      overviewRuler:{width:8},
      fontFamily:terminalFontFamilyForConnection(c),
      fontSize:terminalFontSizeForCurrentLayout(c),
      lineHeight:Number(c.terminal_line_height) || 1,
      fontWeight:c.terminal_font_weight || "normal",
      wordSeparator:terminalWordSeparator(),
      theme:terminalThemeForSettings()
    });
    const fit = createTerminalFitAddon(term);
    term.loadAddon(fit);
    session = {term, fit, socket:null, connected:false, id:c.id, logId:createTerminalLogId(), terminalEncoding:c.terminal_encoding || "utf8", fontLayoutMobile:isMobileLayout(), currentDirectory:"", currentDirectoryKnown:false, quickToken:c.quick_connection ? String(c.quick_token || "") : ""};
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
    try { session.term.refresh?.(0, Math.max(0, session.term.rows - 1)); } catch {}
    if (!isMobileLayout()) try { session.term.focus(); } catch {}
    if (!session.socket) connectTerminal(c, key);
    else {
      updateTerminalConnectionStatus(c, key, session.connected ? "connected" : "disconnected");
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
  const ctrlOnceTitle = tr("terminal:keys.ctrl_once_hint", {defaultValue:"Ctrl 一次：下一个字母按 Ctrl 组合键发送"});
  const ctrlOnceLabel = tr("terminal:keys.ctrl_once", {defaultValue:"Ctrl一次"});
  const ctrlLockTitle = tr("terminal:keys.ctrl_lock_hint", {defaultValue:"Ctrl 锁定：连续发送 Ctrl 组合键，再点一次关闭"});
  const ctrlLockLabel = tr("terminal:keys.ctrl_lock", {defaultValue:"Ctrl锁"});
  return `<div id="terminalKeys" class="terminal-keys ${terminalKeysVisible ? "" : "hidden"}">
    ${["Esc","Tab","/","-","|","~"].map(label => `<button onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','${escAttr(label)}')">${esc(label)}</button>`).join("")}
    <span class="terminal-arrow-pad"><button class="arrow-up" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↑')">↑</button><button class="arrow-left" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','←')">←</button><button class="arrow-down" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','↓')">↓</button><button class="arrow-right" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalKey('${key}','→')">→</button></span>
    <button class="${terminalCtrlArmed || terminalCtrlLocked ? "active" : ""}" title="${escAttr(ctrlOnceTitle)}" aria-label="${escAttr(ctrlOnceTitle)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="armTerminalCtrl(event)">${esc(ctrlOnceLabel)}</button>
    <button class="${terminalCtrlLocked ? "active" : ""}" title="${escAttr(ctrlLockTitle)}" aria-label="${escAttr(ctrlLockTitle)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleCtrlLock()">${esc(ctrlLockLabel)}</button>
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
    notify(tr("terminal:notifications.not_connected", {defaultValue:"终端尚未连接"}), "error");
    return false;
  }
  if (typeof terminalZmodemPrepareInput === "function" && terminalZmodemPrepareInput(session, data)) return true;
  const preparedData = typeof terminalZmodemTakePreparedInput === "function" ? terminalZmodemTakePreparedInput(session, data) : data;
  startTerminalLatencySample(session);
  session.socket.send(preparedData);
  if (options.trackCommand === true) trackTerminalCommand(session, preparedData, {preferCommandBuffer:true, source:"paste"});
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
  if (!items.length) return notify(tr("terminal:recent.empty", {defaultValue:"暂无最近命令"}), "info");
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card wide"><h2>${esc(tr("terminal:recent.title", {defaultValue:"最近命令"}))}</h2><div class="muted">${esc(tr("terminal:recent.newest_first", {defaultValue:"序号 1 为最近一次执行"}))}</div><div class="recent-command-list">${items.map((cmd, index) => `<button data-index="${index}"><span class="recent-command-index">${index + 1}</span><code>${esc(cmd)}</code></button>`).join("")}</div><div class="actions"><button id="recentCommandClear" class="danger">${esc(tr("common:actions.clear", {defaultValue:"清空"}))}</button><button id="recentCommandClose">${esc(tr("common:actions.close", {defaultValue:"关闭"}))}</button></div></div>`;
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
    notify(tr("terminal:recent.cleared", {defaultValue:"最近命令已清空"}), "success");
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

function terminalPromptStateAtRow(session, requestedRow=null) {
  try {
    const buffer = session.term?.buffer?.active;
    const currentRow = Number(buffer?.baseY || 0) + Number(buffer?.cursorY || 0);
    const row = Number.isInteger(requestedRow) ? requestedRow : currentRow;
    const line = buffer?.getLine(row)?.translateToString(true) || "";
    const text = cleanTerminalCommandText(line);
    const markers = ["# ", "$ ", "% ", "> ", "]: "];
    let index = -1;
    let promptMarker = "";
    for (const marker of markers) {
      const markerIndex = text.lastIndexOf(marker);
      if (markerIndex > index) {
        index = markerIndex;
        promptMarker = marker;
      }
    }
    if (index < 0) return null;
    const start = index + promptMarker.length;
    const command = text.slice(start).trimEnd();
    const cursorColumn = row === currentRow ? Number(buffer?.cursorX || 0) : text.length;
    return {
      row,
      command,
      cursor:Math.max(0, Math.min(command.length, cursorColumn - start))
    };
  } catch {
    return null;
  }
}

function currentTerminalPromptCommand(session) {
  return terminalPromptStateAtRow(session)?.command.trim() || "";
}

function terminalFontSizeField() {
  return isMobileLayout() ? "terminal_mobile_font_size" : "terminal_font_size";
}

function terminalFontSizeInheritField() {
  return isMobileLayout() ? "terminal_mobile_font_size_inherit" : "terminal_font_size_inherit";
}

function terminalFontFamilyForConnection(connection) {
  if (connection?.quick_connection || Number(connection?.terminal_font_family_inherit || 0) === 1) {
    return currentTerminalGlobalSettings().font_family;
  }
  return connection?.terminal_font_family || currentTerminalGlobalSettings().font_family;
}

function terminalFontSizeForCurrentLayout(connection) {
  if (connection?.quick_connection || Number(connection?.[terminalFontSizeInheritField()] || 0) === 1) {
    return currentTerminalGlobalSettings().font_size;
  }
  return Number(connection?.[terminalFontSizeField()]) || currentTerminalGlobalSettings().font_size;
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
    const connection = session.connection || connections.find(item => item.id === session.id);
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
  const connection = session.connection || currentConnection(session.id);
  if (connection) {
    connection[terminalFontSizeField()] = size;
    connection[terminalFontSizeInheritField()] = 0;
    scheduleTerminalPreferencesSave(connection);
  }
  fitTerminalPreservingViewport(session, viewport);
  focusTerminalSession(key);
}

const terminalPreferencesSaveTimers = new Map();

function scheduleTerminalPreferencesSave(connection) {
  if (connection?.quick_connection) return;
  clearTimeout(terminalPreferencesSaveTimers.get(connection.id));
  terminalPreferencesSaveTimers.set(connection.id, setTimeout(() => {
    terminalPreferencesSaveTimers.delete(connection.id);
    api(`/api/connections/${connection.id}/terminal-preferences`, {
      method:"POST",
      body:JSON.stringify({
        terminal_encoding:connection.terminal_encoding || "utf8",
        terminal_font_family:connection.terminal_font_family,
        terminal_font_family_inherit:connection.terminal_font_family_inherit,
        terminal_font_size:connection.terminal_font_size,
        terminal_font_size_inherit:connection.terminal_font_size_inherit,
        terminal_mobile_font_size:connection.terminal_mobile_font_size,
        terminal_mobile_font_size_inherit:connection.terminal_mobile_font_size_inherit,
        terminal_line_height:connection.terminal_line_height ?? 1,
        terminal_font_weight:connection.terminal_font_weight || "normal"
      })
    }).catch(error => notify(tr("terminal:notifications.settings_save_failed", {error:error.message, defaultValue:`终端设置保存失败：${error.message}`}), "error"));
  }, 300));
}

function focusTerminalSession(key) {
  const session = terminalSessions.get(key);
  setTimeout(() => {
    try { session?.term.focus(); } catch {}
  }, 0);
}

function showTerminalEncodingMenu(event, key, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const current = terminalSessionEncoding(key, connection);
  showActionMenu(event, terminalEncodingOptions.map(([value,label]) => ({
    label,
    icon:value === current ? "check" : "earth",
    run:()=>applyTerminalPreferences(key, connectionId, {terminal_encoding:value}, tr("terminal:notifications.encoding_changed", {encoding:label, defaultValue:`编码已切换为 ${label}`}))
  })));
}

function showTerminalFontMenu(event, key, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const current = terminalFontFamilyForConnection(connection);
  const currentLineHeight = Number(connection.terminal_line_height) || 1;
  const currentWeight = connection.terminal_font_weight || "normal";
  showActionMenu(event, [
    ...terminalFontOptions.map(([value,label]) => ({
      label,
      icon:value === current ? "check" : "type",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_family:value, terminal_font_family_inherit:0}, tr("terminal:notifications.font_changed", {font:label, defaultValue:`终端字体已切换为 ${label}`}))
    })),
    {separator:true},
    {label:tr("terminal:display.custom_font", {defaultValue:"自定义字体…"}), icon:"pencil", run:()=>setCustomTerminalFont(key, connectionId)},
    {separator:true},
    ...[[1,"compact"],[1.2,"normal"],[1.4,"relaxed"],[1.6,"wide"]].map(([value,labelKey]) => ({
      label:tr(`terminal:display.line_height_${labelKey}`, {value, defaultValue:value === 1 ? "紧凑行距 1.0" : value === 1.6 ? "宽松行距 1.6" : `行距 ${value}`}),
      icon:Number(value) === currentLineHeight ? "check" : "between-horizontal-start",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_line_height:Number(value)}, tr("terminal:notifications.line_height_saved", {value, defaultValue:`终端行距 ${value} 已保存`}))
    })),
    {separator:true},
    ...[["normal","normal"],["500","medium"],["600","semibold"],["bold","bold"]].map(([value,labelKey]) => ({
      label:tr(`terminal:display.weight_${labelKey}`, {defaultValue:labelKey === "normal" ? "常规字重" : labelKey === "medium" ? "中等字重" : labelKey === "semibold" ? "半粗字重" : "粗体"}),
      icon:value === currentWeight ? "check" : "bold",
      run:()=>applyTerminalPreferences(key, connectionId, {terminal_font_weight:value}, tr("terminal:notifications.font_weight_saved", {weight:tr(`terminal:display.weight_${labelKey}`), defaultValue:`终端字重已保存`}))
    })),
    {separator:true},
    {label:tr("terminal:display.reset", {defaultValue:"恢复终端显示默认值"}), icon:"rotate-ccw", run:()=>resetTerminalDisplayPreferences(key, connectionId)}
  ]);
}

async function setCustomTerminalFont(key, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  const value = await inputModal(
    tr("terminal:display.custom_font_title", {defaultValue:"自定义终端字体"}),
    tr("terminal:display.custom_font_label", {defaultValue:"字体名称或字体栈"}),
    connection.terminal_font_family || terminalFontOptions[0][0]
  );
  if (value) await applyTerminalPreferences(key, connectionId, {terminal_font_family:value, terminal_font_family_inherit:0}, tr("terminal:notifications.custom_font_saved", {defaultValue:"自定义终端字体已保存"}));
  else focusTerminalSession(key);
}

async function resetTerminalDisplayPreferences(key, connectionId) {
  await applyTerminalPreferences(key, connectionId, {
    terminal_font_family_inherit:1,
    terminal_font_size_inherit:1,
    terminal_mobile_font_size_inherit:1,
    terminal_line_height:1,
    terminal_font_weight:"normal"
  }, tr("terminal:notifications.display_reset", {defaultValue:"终端字体和字号已恢复使用全局默认，行距与字重已重置"}));
}

async function applyTerminalPreferences(key, connectionId, changes, successText="") {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  try {
    const nextSettings = {
        terminal_encoding:changes.terminal_encoding ?? connection.terminal_encoding ?? "utf8",
        terminal_font_family:changes.terminal_font_family ?? connection.terminal_font_family ?? terminalFontOptions[0][0],
        terminal_font_family_inherit:changes.terminal_font_family_inherit ?? connection.terminal_font_family_inherit ?? 1,
        terminal_font_size:changes.terminal_font_size ?? connection.terminal_font_size ?? 13,
        terminal_font_size_inherit:changes.terminal_font_size_inherit ?? connection.terminal_font_size_inherit ?? 1,
        terminal_mobile_font_size:changes.terminal_mobile_font_size ?? connection.terminal_mobile_font_size ?? 13,
        terminal_mobile_font_size_inherit:changes.terminal_mobile_font_size_inherit ?? connection.terminal_mobile_font_size_inherit ?? 1,
        terminal_line_height:changes.terminal_line_height ?? connection.terminal_line_height ?? 1,
        terminal_font_weight:changes.terminal_font_weight ?? connection.terminal_font_weight ?? "normal"
    };
    const settings = connection.quick_connection
      ? {...connection, ...nextSettings}
      : await api(`/api/connections/${connectionId}/terminal-preferences`, {
          method:"POST",
          body:JSON.stringify(nextSettings)
        });
    Object.assign(connection, settings);
    for (const [sessionKey, activeSession] of terminalSessions) {
      if (activeSession.id !== connectionId) continue;
      const viewport = captureTerminalViewport(activeSession);
      activeSession.term.options.fontFamily = terminalFontFamilyForConnection(settings);
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
    notify(connection.quick_connection
      ? tr("terminal:notifications.quick_preferences_applied", {defaultValue:"已应用到当前临时连接"})
      : successText || tr("terminal:notifications.settings_saved", {defaultValue:"终端设置已保存"}), "success");
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
  if (!session) return notify(tr("terminal:notifications.session_missing", {defaultValue:"终端会话不存在"}), "error");
  const text = formatTerminalCopiedText(terminalBufferText(session));
  if (!text) return notify(tr("terminal:notifications.no_copy_content", {defaultValue:"终端暂无可复制内容"}), "info");
  const closeText = tr("common:actions.close", {defaultValue:"关闭"});
  const summaryText = tr("terminal:session_copy.summary", {lines:text.split("\n").length, characters:text.length, defaultValue:`${text.split("\n").length} 行 · ${text.length} 个字符`});
  const modal = $("modal");
  modal.onclick = null;
  modal.innerHTML = `<div class="modal-card terminal-session-text-modal" role="dialog" aria-modal="true" aria-labelledby="terminalSessionTextTitle">
    <div class="terminal-settings-head"><div><h2 id="terminalSessionTextTitle">${esc(tr("terminal:session_copy.title", {defaultValue:"选择文本"}))}</h2><span>${esc(summaryText)}</span></div><button id="terminalSessionTextClose" class="icon-button" type="button" title="${escAttr(closeText)}" aria-label="${escAttr(closeText)}">${icon("x")}</button></div>
    <textarea id="terminalSessionTextEditor" class="terminal-session-text-editor" readonly spellcheck="false" aria-label="${escAttr(tr("terminal:session_copy.full_text", {defaultValue:"整个终端会话文本"}))}"></textarea>
    <div class="actions terminal-session-text-actions"><button id="terminalSessionTextCancel" type="button">${esc(closeText)}</button><button id="terminalSessionTextCopy" class="primary" type="button">${icon("copy-check")}<span>${esc(tr("terminal:session_copy.copy_all", {defaultValue:"复制全部"}))}</span></button></div>
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
  if (!session) return notify(tr("terminal:notifications.session_missing", {defaultValue:"终端会话不存在"}), "error");
  const text = session.term.hasSelection?.() ? session.term.getSelection() : "";
  if (!text) return notify(tr("terminal:notifications.select_text_first", {defaultValue:"请先选择终端文本"}), "info");
  await copyText(formatTerminalCopiedText(text));
}

async function pasteTerminalText(key) {
  let text = "";
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
    text = await navigator.clipboard.readText();
  } catch {
    if (typeof window.termaDesktop?.readClipboardImage === "function" && typeof handleTerminalClipboardImagePaste === "function") {
      return handleTerminalClipboardImagePaste(key);
    }
    notify(tr("terminal:notifications.clipboard_read_fallback", {defaultValue:"无法直接读取剪贴板，请在编辑框中使用系统粘贴"}), "info");
    text = await editTerminalMultilinePaste("");
    if (text === null) {
      focusTerminalSession(key);
      return false;
    }
  }
  if (!text && typeof handleTerminalClipboardImagePaste === "function") return handleTerminalClipboardImagePaste(key);
  if (!text) return notify(tr("terminal:notifications.clipboard_no_text", {defaultValue:"剪贴板中没有文本"}), "info");
  return sendTerminalPasteText(key, text);
}

function showTerminalContextMenu(event, key, connectionId) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const mobile = isMobileLayout();
  const quick = Boolean(session.connection?.quick_connection);
  showActionMenu(event, [
    ...(!mobile ? [{label:tr("terminal:context_menu.copy_selection", {defaultValue:"复制选中"}), icon:"copy", run:()=>copyTerminalText(key)}] : []),
    {label:tr("terminal:context_menu.cursor_copy", {defaultValue:"光标复制"}), icon:"mouse-pointer-2", run:()=>startTerminalCursorCopy(key)},
    {label:tr("terminal:context_menu.session_copy", {defaultValue:"会话复制"}), icon:"copy-check", run:()=>showTerminalSessionText(key)},
    {label:tr("terminal:context_menu.paste", {defaultValue:"粘贴"}), icon:"clipboard-paste", run:()=>pasteTerminalText(key)},
    {separator:true},
    {label:tr("terminal:context_menu.clear", {defaultValue:"清屏"}), icon:"eraser", run:()=>{ session.term.clear(); session.term.focus(); }},
    {label:tr("terminal:context_menu.scroll_bottom", {defaultValue:"滚动到底部"}), icon:"arrow-down-to-line", run:()=>session.term.scrollToBottom()},
    {label:tr(session.term.getSelection?.().trim() ? "terminal:context_menu.open_selected_sftp" : "terminal:context_menu.open_current_sftp", {defaultValue:session.term.getSelection?.().trim() ? "在 SFTP 打开选中路径" : "在 SFTP 打开当前目录"}), icon:"folder-open", run:()=>openTerminalPathInSftp(connectionId, key)},
    ...(!quick ? [{separator:true}, {label:tr("terminal:context_menu.startup", {defaultValue:"终端配置"}), icon:"command", run:()=>showTerminalStartupSettings(key, connectionId)}] : [{separator:true}]),
    {label:tr(session.connected ? "terminal:context_menu.disconnect" : "terminal:context_menu.reconnect", {defaultValue:session.connected ? "断开连接" : "重新连接"}), icon:session.connected ? "link-2-off" : "link-2", run:()=>toggleTerminalConnection(connectionId, key)},
    ...(!mobile ? [{separator:true}, {label:tr("terminal:context_menu.global_settings", {defaultValue:"全局终端设置"}), icon:"settings", run:()=>showTerminalGlobalSettings(key)}] : [])
  ]);
}

function terminalAuthenticationFailureChunk(session, value) {
  if (typeof sshAuthenticationFailure !== "function") return false;
  let text = "";
  if (typeof value === "string") text = value;
  else if (value instanceof ArrayBuffer) {
    try { text = new TextDecoder("utf-8", {fatal:false}).decode(new Uint8Array(value)); }
    catch {}
  }
  session.authenticationFailureWindow = `${session.authenticationFailureWindow || ""}${text}`.slice(-1200);
  return sshAuthenticationFailure(session.authenticationFailureWindow);
}

async function repairTerminalCredentials(connection, key) {
  const session = terminalSessions.get(key);
  if (!session) return false;
  if (connection.quick_connection) {
    if ($("modal")?.dataset.quickSshAuth === "1") return false;
    const staleToken = String(session.quickToken || connection.quick_token || "");
    session.quickToken = "";
    connection.quick_token = "";
    if (staleToken) {
      void api("/api/terminal/quick-tickets", {
        method:"DELETE",
        body:JSON.stringify({token:staleToken}),
        skipSftpConnect:true,
        skipHostTrustPrompt:true
      }).catch(() => {});
    }
    return startQuickSshConnection({
      user:connection.ssh_user,
      host:connection.ssh_host,
      port:connection.ssh_port
    }, {
      reconnectKey:key,
      authType:connection.auth_type,
      repair:true
    });
  }
  if (typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(connection.id, {
    context:tr("terminal:authentication.context", {defaultValue:"终端认证失败"}),
    onSaved:async savedConnection => {
      const activeSession = terminalSessions.get(key);
      if (!activeSession) return;
      activeSession.connection = savedConnection;
      activeSession.id = savedConnection.id;
      reconnectTerminal(savedConnection.id, key);
    },
    onTemporary:async (temporaryConnection, token) => {
      if (!terminalSessions.has(key)) return;
      resumeQuickTerminalWithTicket(key, temporaryConnection, token);
    }
  });
}

async function connectTerminal(c, key) {
  const session = terminalSessions.get(key);
  if (!session) return;
  const quick = Boolean(c.quick_connection);
  if (quick && !String(session.quickToken || c.quick_token || "")) {
    updateTerminalConnectionStatus(c, key, "authentication");
    session.term.writeln(`\r\n${tr("terminal:system.quick_credentials_expired_connect", {defaultValue:"[临时连接凭据已失效，请重新认证后连接]"})}\r\n`);
    if ($("modal")?.dataset.quickSshAuth !== "1") {
      void startQuickSshConnection({user:c.ssh_user, host:c.ssh_host, port:c.ssh_port}, {reconnectKey:key, authType:c.auth_type});
    }
    return;
  }
  const attempt = Number(session.connectionAttempt || 0) + 1;
  session.connectionAttempt = attempt;
  session.authenticationFailed = false;
  session.authenticationFailureWindow = "";
  const previousSocket = session.socket;
  session.socket = null;
  if (typeof closeTerminalZmodem === "function") closeTerminalZmodem(session);
  try { previousSocket?.close(); } catch {}
  try { session.inputDisposable?.dispose(); } catch {}
  try { session.resizeDisposable?.dispose(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
  const title = tab?.title || tr("terminal:tabs.session", {name:c.name, suffix:"", defaultValue:`${c.name} · 终端`});
  session.connected = false;
  session.currentDirectory = "";
  session.currentDirectoryKnown = false;
  session.previousDirectory = "";
  session.homeDirectory = "";
  updateTerminalConnectionStatus(c, key, "connecting");
  const endpoint = `${c.ssh_user}@${c.ssh_host}:${c.ssh_port}`;
  session.term.writeln(tr("terminal:system.connecting", {endpoint, defaultValue:`连接 ${endpoint} ...`}));
  if (!quick) try {
    await api("/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection_id:c.id})
    });
  } catch (error) {
    if (session.connectionAttempt !== attempt || terminalSessions.get(key) !== session) return;
    session.term.writeln(`\r\n${error.code === "SSH_HOST_TRUST_CANCELLED"
      ? tr("terminal:system.host_trust_cancelled", {defaultValue:"[已取消连接]"})
      : tr("terminal:system.host_trust_failed", {error:error.message, defaultValue:`[SSH 主机身份校验失败：${error.message}]`})}`);
    updateTerminalConnectionStatus(c, key, "disconnected");
    if (error.code !== "SSH_HOST_TRUST_CANCELLED") notify(error.message || tr("terminal:notifications.host_trust_failed", {defaultValue:"SSH 主机身份校验失败"}), "error");
    return;
  }
  let startupToken = "";
  const startupOverride = terminalStartupOverrides.has(key) ? terminalStartupOverrides.get(key) : null;
  let effectiveX11Mode = String(startupOverride?.x11_mode || c.x11_mode || "off");
  const explicitX11Request = ["trusted", "untrusted"].includes(String(startupOverride?.x11_mode || ""));
  try {
    if (!quick && (startupOverride || ["trusted", "untrusted"].includes(effectiveX11Mode))) {
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
        effectiveX11Mode = "off";
        session.term.writeln(`\r\n${tr("terminal:system.x11_fallback", {defaultValue:"[X11] 当前浏览器没有桌面集成授权，已自动降级为普通 SSH 终端。"})}`);
        notify(tr("terminal:notifications.x11_fallback", {defaultValue:"X11 未授权，本终端已自动改用普通 SSH"}), "info");
      } catch (fallbackError) {
        session.term.writeln(`\r\n${tr("terminal:system.ssh_fallback_failed", {error:fallbackError.message, defaultValue:`[普通 SSH 降级失败：${fallbackError.message}]`})}`);
        updateTerminalConnectionStatus(c, key, "disconnected");
        notify(fallbackError.message || tr("terminal:notifications.ssh_fallback_failed", {defaultValue:"普通 SSH 降级失败"}), "error");
        return;
      }
    } else if (error.code === "DESKTOP_INTEGRATION_AUTH_REQUIRED") {
      session.term.writeln(`\r\n[X11] ${error.message}`);
      session.term.writeln(tr("terminal:system.x11_authorization_hint", {defaultValue:"[请在 X Server 窗口选择授权时长并申请授权，完成后点击重连]"}));
      updateTerminalConnectionStatus(c, key, "authorization");
      notify(error.message || tr("terminal:notifications.x11_authorization_required", {defaultValue:"当前浏览器没有 X11 桌面集成授权"}), "error");
      if (typeof openXServerManager === "function") {
        try { await openXServerManager(c.id, key); }
        catch {}
      }
      return;
    } else {
      session.term.writeln(`\r\n${tr("terminal:system.startup_prepare_failed", {error:error.message, defaultValue:`[临时启动配置准备失败：${error.message}]`})}`);
      updateTerminalConnectionStatus(c, key, "disconnected");
      notify(error.message || tr("terminal:notifications.startup_prepare_failed", {defaultValue:"临时启动配置准备失败"}), "error");
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
  const quickToken = quick ? String(session.quickToken || c.quick_token || "") : "";
  const connectionQuery = quick ? `quick_token=${encodeURIComponent(quickToken)}` : `id=${encodeURIComponent(c.id)}`;
  const quickX11Query = quick ? `&x11_mode=${encodeURIComponent(effectiveX11Mode)}` : "";
  const languageQuery = `&language=${encodeURIComponent(normalizeTermaLanguage(document.documentElement.lang))}`;
  session.effectiveX11Mode = effectiveX11Mode;
  const socket = new WebSocket(`${protocol}://${location.host}/ws/terminal?${connectionQuery}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(title)}${encodingQuery}${logQuery}${startupQuery}${quickX11Query}${languageQuery}`);
  socket.binaryType = "arraybuffer";
  let socketOpened = false;
  session.socket = socket;
  if (typeof initializeTerminalZmodem === "function") initializeTerminalZmodem(session);
  socket.addEventListener("open", () => {
    if (session.socket !== socket) return;
    socketOpened = true;
    session.connected = true;
    socket.send(JSON.stringify({type:"terminal-encoding", encoding:session.terminalEncoding || c.terminal_encoding || "utf8"}));
    updateTerminalConnectionStatus(c, key, "connected");
    void initializeTerminalDirectory(session, c, key);
  });
  socket.addEventListener("message", event => {
    if (session.socket !== socket) return;
    finishTerminalLatencySample(session, key);
    if (terminalAuthenticationFailureChunk(session, event.data)) session.authenticationFailed = true;
    const terminalOutput = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    if (typeof updateTerminalSmartState === "function") updateTerminalSmartState(key, terminalOutput);
    if (typeof consumeTerminalZmodemOutput === "function" && consumeTerminalZmodemOutput(session, event.data)) {
      if (isMobileLayout()) scheduleTerminalFit();
      return;
    }
    queueTerminalOutput(session, terminalOutput);
    if (isMobileLayout()) scheduleTerminalFit();
  });
  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.connected = false;
    if (typeof closeTerminalZmodem === "function") closeTerminalZmodem(session);
    session.latencyPendingAt = 0;
    clearTimeout(session.latencyPendingTimer);
    queueTerminalOutput(session, `\r\n${tr("terminal:system.closed_reconnect", {defaultValue:"[连接已关闭，按 Enter 重新连接]"})}\r\n`);
    updateTerminalConnectionStatus(c, key, "disconnected");
    if (quick && !socketOpened && !session.authenticationFailed) {
      session.quickToken = "";
      c.quick_token = "";
      queueTerminalOutput(session, `${tr("terminal:system.quick_credentials_expired", {defaultValue:"[临时连接凭据已失效，请重新认证]"})}\r\n`);
    }
    if (session.authenticationFailed && session.credentialRepairPromptAttempt !== attempt) {
      session.credentialRepairPromptAttempt = attempt;
      queueTerminalOutput(session, quick
        ? `${tr("terminal:system.quick_auth_repair_opening", {defaultValue:"[SSH 认证失败，正在打开临时凭据修复窗口]"})}\r\n`
        : `${tr("terminal:system.auth_repair_opening", {defaultValue:"[SSH 认证失败，正在打开凭据修复窗口]"})}\r\n`);
      queueMicrotask(() => {
        if (terminalSessions.get(key) !== session) return;
        if (typeof workspaceHasTabKey === "function" && !workspaceHasTabKey(key)) return;
        void repairTerminalCredentials(c, key);
      });
    }
  });
  socket.addEventListener("error", () => {
    if (session.socket === socket) queueTerminalOutput(session, `\r\n${tr("terminal:system.websocket_failed", {defaultValue:"[WebSocket 连接失败]"})}\r\n`);
  });
  session.inputDisposable = session.term.onData(data => {
    if (typeof terminalZmodemPrepareInput === "function" && terminalZmodemPrepareInput(session, data)) return;
    const preparedData = typeof terminalZmodemTakePreparedInput === "function" ? terminalZmodemTakePreparedInput(session, data) : data;
    if (typeof interceptTerminalClipboardCtrlVInput === "function" && interceptTerminalClipboardCtrlVInput(key, c.id, preparedData)) return;
    const beforeCtrl = terminalCtrlArmed || terminalCtrlLocked;
    const outgoing = transformTerminalInputForCtrl(key, preparedData);
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

function reconnectTerminal(id, key=`terminal-${id}-1`) {
  const session = terminalSessions.get(key);
  const c = session?.connection || currentConnection(id);
  if (!c) return;
  if (session) session.term.writeln(`\r\n${tr("terminal:system.reconnecting_preserved", {defaultValue:"[正在重新连接，以上终端内容已保留]"})}\r\n`);
  connectTerminal(c, key);
  focusTerminalSession(key);
}

function resumeQuickTerminalWithTicket(key, connection, token) {
  const session = terminalSessions.get(key);
  if (!session) return openQuickTerminal(connection, token);
  const next = {
    ...session.connection,
    ...connection,
    id:Number(connection?.id || session.connection?.id || 0),
    quick_connection:true,
    quick_token:String(token || ""),
    terminal_font_family_inherit:1,
    terminal_font_size_inherit:1,
    terminal_mobile_font_size_inherit:1
  };
  const previousId = Number(session.connection?.id || 0);
  if (!Number.isSafeInteger(next.id) || next.id >= 0) throw new Error(tr("terminal:errors.invalid_quick_connection_id", {defaultValue:"临时连接标识无效"}));
  session.connection = next;
  session.id = next.id;
  session.quickToken = String(token || "");
  if (previousId < 0 && previousId !== next.id) quickConnectionsById.delete(previousId);
  quickConnectionsById.set(next.id, next);
  quickTerminalConnections.set(key, next);
  session.term.writeln(`\r\n${tr("terminal:system.reconnecting_preserved", {defaultValue:"[正在重新连接，以上终端内容已保留]"})}\r\n`);
  connectTerminal(next, key);
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
  updateTerminalConnectionStatus(session.connection || currentConnection(session.id), key, "disconnected");
  focusTerminalSession(key);
}

function toggleTerminalConnection(id, key=`terminal-${id}-1`) {
  const session = terminalSessions.get(key);
  if (session?.connected || session?.socket?.readyState === WebSocket.CONNECTING) disconnectTerminal(key);
  else reconnectTerminal(id, key);
}
