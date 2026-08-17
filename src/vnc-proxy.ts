const {
  getConnection,
  getRemoteProfile,
  listConnections,
  repairRemoteProfileManagementConnection,
  updateRemoteProfileUsage
} = require("./db");
const { runSshCommandForConnection } = require("./ssh");
const { testVncProfile: testVncServerProfile } = require("./vnc-server-manager");
const { connectVncSocket } = require("./vnc-handshake");
const { appendSystemLog } = require("./logs");
const { WebSocketFrameParser, closeWebSocket, sendWebSocketFrame, validateWebSocketUpgrade, websocketAccept } = require("./websocket");

const sessions = new Set<any>();

function vncProfile(id) {
  const profile = getRemoteProfile(Number(id));
  if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
  return profile;
}

async function testVncProfile(id) {
  // Keep the raw TCP/RFB proxy independent while adding optional SSH-side
  // diagnostics when the profile was generated from an SSH connection.
  return testVncServerProfile(id, {
    getConnection,
    getRemoteProfile,
    listConnections,
    repairManagementConnection:(item, connectionId) => repairRemoteProfileManagementConnection(item.id, connectionId),
    updateRemoteProfileUsage,
    runSshCommandForConnection
  });
}

function closeVncSession(session, code = 1000, reason = "") {
  if (!session || session.closed) return;
  session.closed = true;
  sessions.delete(session);
  try { session.transport?.destroy?.(); } catch {}
  try { closeWebSocket(session.socket, code, reason); } catch {}
}

function handleVncUpgrade(req, socket) {
  let upgraded = false;
  let session;
  try {
    const key = validateWebSocketUpgrade(req);
    const url = new URL(req.url, "http://terma.invalid");
    const profile = vncProfile(Number(url.searchParams.get("id")));
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
      "",
      ""
    ].join("\r\n"));
    socket.setNoDelay?.(true);
    upgraded = true;
    session = {
      socket,
      profile,
      transport:null,
      closed:false,
      openedAt:Date.now(),
      clientBytes:0,
      serverBytes:0,
      initialServerBytes:0
    };
    sessions.add(session);

    const parser = new WebSocketFrameParser({maxFrameSize:16 * 1024 * 1024, maxMessageSize:32 * 1024 * 1024});
    socket.on("data", chunk => {
      try {
        parser.push(chunk, (opcode, payload) => {
          if (opcode === 8) return closeVncSession(session);
          if (opcode === 9) return sendWebSocketFrame(socket, payload, 10);
          if ((opcode === 1 || opcode === 2) && session.transport && !session.transport.destroyed) {
            session.clientBytes += payload.length;
            session.transport.write(payload);
          }
        });
      } catch (error) {
        appendSystemLog(`VNC WebSocket 数据错误：${profile.name} · ${error.message}`);
        closeVncSession(session, 1002, "VNC 数据通道错误");
      }
    });
    socket.on("close", () => closeVncSession(session));
    socket.on("error", () => closeVncSession(session));

    connectVncSocket(profile.host, Number(profile.port || 5900)).then(result => {
      const transport = result.socket;
      if (session.closed) return transport.destroy();
      session.transport = transport;
      session.initialServerBytes = result.initial_data.length;
      session.serverBytes = result.initial_data.length;
      updateRemoteProfileUsage(profile.id);
      transport.on("data", chunk => {
        session.serverBytes += chunk.length;
        sendWebSocketFrame(socket, chunk, 2);
      });
      transport.on("error", error => {
        appendSystemLog(`VNC 连接错误：${profile.name} · ${error.message}`);
        closeVncSession(session, 1011, "VNC 连接失败");
      });
      transport.on("close", () => {
        if (session.closed) return;
        const elapsedMs = Math.max(0, Date.now() - session.openedAt);
        const handshakeIncomplete = session.clientBytes === 0 || session.serverBytes <= session.initialServerBytes;
        if (handshakeIncomplete) {
          appendSystemLog(`VNC 服务在握手阶段关闭连接：${profile.name} · ${elapsedMs}ms · client=${session.clientBytes}B · server=${session.serverBytes}B`);
          return closeVncSession(session, 1011, "VNC 服务在握手期间关闭连接");
        }
        closeVncSession(session, 1000, "VNC 会话已结束");
      });
      sendWebSocketFrame(socket, result.initial_data, 2);
      transport.resume();
      appendSystemLog(`内置 VNC 会话已启动：${profile.name}`);
    }).catch(error => {
      appendSystemLog(`VNC 连接失败：${profile.name} · ${error.message}`);
      closeVncSession(session, 1011, "VNC 连接失败");
    });
  } catch (error) {
    appendSystemLog(`VNC 会话启动失败：${error.message}`);
    try {
      if (upgraded) closeVncSession(session, 1011, "VNC 会话启动失败");
      else {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.end(error.message);
      }
    } catch {}
  }
}

function closeAllVncSessions() {
  for (const session of [...sessions]) closeVncSession(session, 1001, "Terma 正在关闭");
}

module.exports = { closeAllVncSessions, handleVncUpgrade, testVncProfile };
