function nextRemoteTerminalIndex(id) {
  let next = Number(remoteTerminalCounts.get(Number(id)) || 0) + 1;
  while (tabs.some(tab => tab.key === `remote-terminal-${id}-${next}`)) next += 1;
  remoteTerminalCounts.set(Number(id), next);
  return next;
}

function openRemoteTerminal(id, updateTab=true, existingKey="", existingTitle="") {
  const profile = remoteProfileById(id);
  if (!profile || !["telnet","serial"].includes(profile.protocol)) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const next = existingKey ? 0 : nextRemoteTerminalIndex(id);
  const key = existingKey || `remote-terminal-${id}-${next}`;
  const title = existingTitle || `${profile.name}${next > 1 ? ` #${next}` : ""}`;
  const view = $("view-remote-terminal");
  view.dataset.remoteTerminalKey = key;
  const endpoint = remoteProfileEndpoint(profile);
  const reconnectTitle = tr("terminal:toolbar.reconnect", {defaultValue:"重新连接终端"});
  const connectionSettingsTitle = tr("remote:actions.connection_settings", {defaultValue:"连接设置"});
  const sendTitle = tr("remote:terminal.send", {defaultValue:"发送"});
  view.innerHTML = `<div class="terminal-toolbar"><div class="terminal-title-row"><span class="terminal-connection-dot"></span><div id="remoteTerminalStatus" class="terminal-status">${esc(tr("remote:terminal.connecting", {endpoint, defaultValue:`正在连接 ${endpoint}`}))}</div></div><div class="actions terminal-actions"><button class="icon-button" onclick="reconnectRemoteTerminal(${profile.id},'${escAttr(key)}')" title="${escAttr(reconnectTitle)}" aria-label="${escAttr(reconnectTitle)}">${icon("refresh-cw")}<span>${esc(tr("terminal:toolbar.reconnect_short", {defaultValue:"重连"}))}</span></button><button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="${escAttr(connectionSettingsTitle)}" aria-label="${escAttr(connectionSettingsTitle)}">${icon("settings-2")}</button></div></div><div id="remoteTerminalMount" class="terminal-box"></div><div class="terminal-mobile-composer"><input id="remoteTerminalMobileInput" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escAttr(tr("remote:terminal.input_placeholder", {defaultValue:"输入内容"}))}" onkeydown="if(event.key==='Enter')sendRemoteTerminalMobileInput('${escAttr(key)}')"><button class="primary icon-button" onclick="sendRemoteTerminalMobileInput('${escAttr(key)}')" title="${escAttr(sendTitle)}" aria-label="${escAttr(sendTitle)}">${icon("send")}</button></div>`;
  setWorkspace(title, `${remoteProtocolLabel(profile.protocol)} · ${endpoint}`, "remote-terminal", key, updateTab, true, {kind:"remote-terminal", id:profile.id, protocol:profile.protocol, connectionStatus:"connecting"});
  attachRemoteTerminal(profile, key).catch(error => {
    const mount = document.querySelector(`[data-remote-terminal-key="${CSS.escape(key)}"] #remoteTerminalMount`) || $("remoteTerminalMount");
    if (mount) mount.innerHTML = stateView(
      "error",
      tr("terminal:components.load_failed", {defaultValue:"终端组件加载失败"}),
      typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(error.message) : error.message,
      `<button onclick="reconnectRemoteTerminal(${profile.id},'${escAttr(key)}')">${esc(tr("terminal:toolbar.reconnect", {defaultValue:"重新连接终端"}))}</button>`
    );
  });
}

async function attachRemoteTerminal(profile, key) {
  await ensureTerminalLibs();
  const view = $("view-remote-terminal");
  const mount = $("remoteTerminalMount");
  if (!view || !mount) return;
  let session = remoteTerminalSessions.get(key);
  if (!session) {
    const term = new TerminalClass({cursorBlink:true,convertEol:true,fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",fontSize:Number(localStorage.getItem("terminalFontSize") || 13),theme:typeof terminalThemeForSettings === "function" ? terminalThemeForSettings() : undefined});
    const fit = new FitAddonClass();
    term.loadAddon(fit);
    session = {key,profile,term,fit,socket:null,connected:false,logId:createTerminalLogId(),resizeObserver:null};
    remoteTerminalSessions.set(key, session);
    term.onData(data => {
      if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(data);
    });
  }
  session.profile = profile;
  session.mount = mount;
  view.dataset.remoteTerminalKey = key;
  if (session.term.element) mount.appendChild(session.term.element);
  else session.term.open(mount);
  session.resizeObserver?.disconnect?.();
  session.resizeObserver = new ResizeObserver(() => {
    try { session.fit.fit(); } catch {}
    if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({type:"resize",cols:session.term.cols,rows:session.term.rows}));
  });
  session.resizeObserver.observe(mount);
  setTimeout(() => {
    try { session.fit.fit(); session.term.focus(); } catch {}
    if (!session.socket || session.socket.readyState >= WebSocket.CLOSING) connectRemoteTerminal(profile, key);
  }, 0);
}

function connectRemoteTerminal(profile, key) {
  const session = remoteTerminalSessions.get(key);
  if (!session) return;
  try { session.socket?.close(); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const language = typeof normalizeTermaLanguage === "function"
    ? normalizeTermaLanguage(document.documentElement.lang || "zh-CN")
    : "zh-CN";
  const socket = new WebSocket(`${protocol}://${location.host}/ws/remote-terminal?id=${profile.id}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${encodeURIComponent(profile.name)}&log_id=${encodeURIComponent(session.logId)}&language=${encodeURIComponent(language)}`);
  socket.binaryType = "arraybuffer";
  session.socket = socket;
  session.connected = false;
  const status = $("remoteTerminalStatus");
  if (status) status.textContent = tr("remote:terminal.connecting", {endpoint:remoteProfileEndpoint(profile), defaultValue:`正在连接 ${remoteProfileEndpoint(profile)}`});
  setWorkspaceTabConnectionStatus(key, "connecting");
  socket.onopen = () => {
    if (session.socket !== socket) return;
    session.connected = true;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = tr("remote:terminal.connected", {endpoint:remoteProfileEndpoint(profile), defaultValue:`已连接 ${remoteProfileEndpoint(profile)}`});
    setWorkspaceTabConnectionStatus(key, "connected");
    socket.send(JSON.stringify({type:"resize",cols:session.term.cols,rows:session.term.rows}));
    session.term.focus();
  };
  socket.onmessage = async event => {
    if (session.socket !== socket) return;
    if (event.data instanceof Blob) session.term.write(new Uint8Array(await event.data.arrayBuffer()));
    else if (event.data instanceof ArrayBuffer) session.term.write(new Uint8Array(event.data));
    else session.term.write(String(event.data));
  };
  socket.onerror = () => {
    if (session.socket !== socket) return;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = tr("remote:terminal.connection_error", {defaultValue:"连接错误"});
  };
  socket.onclose = () => {
    if (session.socket !== socket) return;
    session.connected = false;
    session.socket = null;
    const node = $("remoteTerminalStatus");
    if (node) node.textContent = tr("remote:terminal.disconnected_reconnect", {defaultValue:"已断开，点击重连"});
    setWorkspaceTabConnectionStatus(key, "disconnected");
  };
}

function reconnectRemoteTerminal(id, key) {
  const profile = remoteProfileById(id);
  const session = remoteTerminalSessions.get(key);
  if (!profile || !session) return openRemoteTerminal(id, false, key);
  session.term.write(`\r\n${tr("remote:terminal.reconnecting_notice", {defaultValue:"正在重新连接..."})}\r\n`);
  connectRemoteTerminal(profile, key);
}

function sendRemoteTerminalMobileInput(key) {
  const input = $("remoteTerminalMobileInput");
  const session = remoteTerminalSessions.get(key);
  if (!input || !session?.socket || session.socket.readyState !== WebSocket.OPEN) return;
  session.socket.send(`${input.value}\r`);
  input.value = "";
}

function closeRemoteProtocolSession(key) {
  const vnc = vncSessions.get(key);
  if (vnc) {
    if (vncFullscreenSessionKey === key) {
      vncFullscreenSessionKey = "";
      vnc.viewport?.classList.remove("vnc-fullscreen-active");
      document.documentElement.classList.remove("vnc-fullscreen-document");
      if (document.fullscreenElement === document.documentElement) void document.exitFullscreen?.().catch(() => {});
    }
    vnc.connectionRevision = Number(vnc.connectionRevision || 0) + 1;
    stopVncClipboardPolling(vnc);
    resetVncClipboardBridgeWriteState(vnc);
    if (vnc.clipboardStatusTimer) clearTimeout(vnc.clipboardStatusTimer);
    try { vnc.rfb?.disconnect?.(); } catch {}
    vncSessions.delete(key);
  }
  const session = remoteTerminalSessions.get(key);
  if (!session) return;
  try { session.socket?.close(); } catch {}
  try { session.resizeObserver?.disconnect(); } catch {}
  try { session.term?.dispose(); } catch {}
  remoteTerminalSessions.delete(key);
}
