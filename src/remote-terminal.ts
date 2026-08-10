const net = require("node:net");
const iconv = require("iconv-lite");
const { getRemoteProfile, updateRemoteProfileUsage } = require("./db");
const { appendSystemLog, appendTerminalLog, createTerminalLog } = require("./logs");
const { WebSocketFrameParser, closeWebSocket, sendWebSocketFrame, validateWebSocketUpgrade, websocketAccept } = require("./websocket");
const { formatRemoteEndpoint } = require("./remote-host");

const sessions = new Set();
const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const OPT_BINARY = 0;
const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;

function serialRuntime() {
  try {
    const value = require("serialport");
    return {available:Boolean(value?.SerialPort), SerialPort:value.SerialPort, error:""};
  } catch (error) {
    return {available:false, SerialPort:null, error:error.message || String(error)};
  }
}

async function listSerialPorts() {
  const runtime = serialRuntime();
  if (!runtime.available) return {available:false, error:runtime.error, ports:[]};
  const ports = await runtime.SerialPort.list();
  return {
    available:true,
    error:"",
    ports:ports.map(item => ({
      path:String(item.path || ""),
      manufacturer:String(item.manufacturer || ""),
      serial_number:String(item.serialNumber || ""),
      vendor_id:String(item.vendorId || ""),
      product_id:String(item.productId || ""),
      friendly_name:String(item.friendlyName || item.pnpId || "")
    }))
  };
}

async function testRemoteTerminalProfile(id) {
  const profile = remoteTerminalProfile(id);
  if (profile.protocol === "telnet") {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({host:profile.host, port:Number(profile.port || 23)});
      const timer = setTimeout(() => socket.destroy(new Error("Telnet 连接超时")), 10000);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(null);
      });
      socket.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    updateRemoteProfileUsage(id);
    return {ok:true, protocol:"telnet", endpoint:formatRemoteEndpoint(profile.host, profile.port)};
  }
  const runtime = serialRuntime();
  if (!runtime.available) throw new Error(`串口组件不可用：${runtime.error || "serialport 未安装"}`);
  await new Promise((resolve, reject) => {
    const port = new runtime.SerialPort({
      path:profile.options.path,
      baudRate:Number(profile.options.baud_rate || 115200),
      autoOpen:false
    });
    port.open(error => {
      if (error) return reject(error);
      port.close(closeError => closeError ? reject(closeError) : resolve(null));
    });
  });
  updateRemoteProfileUsage(id);
  return {ok:true, protocol:"serial", endpoint:profile.options.path};
}

function remoteTerminalProfile(id) {
  const profile = getRemoteProfile(Number(id));
  if (!["telnet", "serial"].includes(profile.protocol)) throw new Error("该连接不能在终端中打开");
  return profile;
}

function terminalLogForProfile(profile, title, logId) {
  const endpoint = profile.protocol === "serial" ? profile.options.path : profile.host;
  return createTerminalLog({
    name:profile.name,
    ssh_user:profile.username || profile.protocol,
    ssh_host:endpoint,
    ssh_port:profile.port || 0
  }, title || `${profile.name} · ${profile.protocol.toUpperCase()}`, logId);
}

function emitOutput(session, data) {
  if (!data?.length) return;
  const text = Buffer.isBuffer(data) && session.decoder ? session.decoder.write(data) : data;
  if (!text?.length) return;
  appendTerminalLog(session.logFile, text);
  sendWebSocketFrame(session.socket, text, typeof text === "string" ? 1 : 2);
}

function sendTelnetCommand(session, command, option) {
  session.transport?.write(Buffer.from([IAC, command, option]));
}

function escapeTelnetBytes(buffer) {
  const chunks = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== IAC) continue;
    if (index > start) chunks.push(buffer.subarray(start, index));
    chunks.push(Buffer.from([IAC, IAC]));
    start = index + 1;
  }
  if (start < buffer.length) chunks.push(buffer.subarray(start));
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

function sendTelnetWindowSize(session, cols, rows) {
  if (!session.telnetNaws) return;
  const values = Buffer.from([(cols >> 8) & 255, cols & 255, (rows >> 8) & 255, rows & 255]);
  session.transport?.write(Buffer.concat([Buffer.from([IAC, SB, OPT_NAWS]), escapeTelnetBytes(values), Buffer.from([IAC, SE])]));
}

function handleTelnetNegotiation(session, command, option) {
  if (command === DO) {
    const supported = [OPT_BINARY, OPT_SGA, OPT_TTYPE, OPT_NAWS].includes(option);
    sendTelnetCommand(session, supported ? WILL : WONT, option);
    if (supported && option === OPT_NAWS) {
      session.telnetNaws = true;
      sendTelnetWindowSize(session, session.cols, session.rows);
    }
    return;
  }
  if (command === WILL) {
    sendTelnetCommand(session, [OPT_BINARY, OPT_ECHO, OPT_SGA].includes(option) ? DO : DONT, option);
    return;
  }
  if (command === DONT) sendTelnetCommand(session, WONT, option);
  else if (command === WONT) sendTelnetCommand(session, DONT, option);
}

function handleTelnetSubnegotiation(session, option, payload) {
  if (option !== OPT_TTYPE || payload[0] !== 1) return;
  const name = Buffer.from(String(session.profile.options.terminal_type || "xterm-256color"), "ascii");
  session.transport?.write(Buffer.concat([Buffer.from([IAC, SB, OPT_TTYPE, 0]), escapeTelnetBytes(name), Buffer.from([IAC, SE])]));
}

function consumeTelnetData(session, chunk) {
  const parser = session.telnetParser;
  const output = [];
  let data = [];
  const flush = () => {
    if (!data.length) return;
    output.push(Buffer.from(data));
    data = [];
  };
  for (const byte of chunk) {
    if (parser.state === "data") {
      if (byte === IAC) {
        flush();
        parser.state = "iac";
      } else data.push(byte);
      continue;
    }
    if (parser.state === "iac") {
      if (byte === IAC) {
        data.push(IAC);
        parser.state = "data";
      } else if ([DO, DONT, WILL, WONT].includes(byte)) {
        parser.command = byte;
        parser.state = "command";
      } else if (byte === SB) {
        parser.option = null;
        parser.sub = [];
        parser.state = "sub";
      } else parser.state = "data";
      continue;
    }
    if (parser.state === "command") {
      handleTelnetNegotiation(session, parser.command, byte);
      parser.state = "data";
      continue;
    }
    if (parser.state === "sub") {
      if (parser.option === null) parser.option = byte;
      else if (byte === IAC) parser.state = "sub-iac";
      else parser.sub.push(byte);
      continue;
    }
    if (parser.state === "sub-iac") {
      if (byte === SE) {
        handleTelnetSubnegotiation(session, parser.option, Buffer.from(parser.sub));
        parser.state = "data";
      } else {
        if (byte === IAC) parser.sub.push(IAC);
        parser.state = "sub";
      }
    }
  }
  flush();
  for (const value of output) emitOutput(session, value);
}

function connectTelnet(session) {
  const profile = session.profile;
  const socket = net.createConnection({host:profile.host, port:Number(profile.port || 23)});
  session.transport = socket;
  session.telnetParser = {state:"data", command:0, option:null, sub:[]};
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);
  socket.setTimeout(30000, () => socket.destroy(new Error("Telnet 连接超时")));
  socket.once("connect", () => {
    socket.setTimeout(0);
    updateRemoteProfileUsage(profile.id);
    emitOutput(session, `已连接到 ${formatRemoteEndpoint(profile.host, profile.port)}\r\n`);
  });
  socket.on("data", chunk => consumeTelnetData(session, chunk));
  socket.on("error", error => emitOutput(session, `\r\nTelnet 错误：${error.message}\r\n`));
  socket.on("close", () => closeRemoteTerminalSession(session, "Telnet 会话已结束"));
}

function connectSerial(session) {
  const runtime = serialRuntime();
  if (!runtime.available) throw new Error(`串口组件不可用：${runtime.error || "serialport 未安装"}`);
  const options = session.profile.options;
  const port = new runtime.SerialPort({
    path:options.path,
    baudRate:Number(options.baud_rate || 115200),
    dataBits:Number(options.data_bits || 8),
    stopBits:Number(options.stop_bits || 1),
    parity:String(options.parity || "none"),
    rtscts:Boolean(options.rts_cts),
    xon:Boolean(options.xon),
    xoff:Boolean(options.xoff),
    autoOpen:false
  });
  session.transport = port;
  port.open(error => {
    if (error) {
      emitOutput(session, `\r\n串口打开失败：${error.message}\r\n`);
      return closeRemoteTerminalSession(session);
    }
    updateRemoteProfileUsage(session.profile.id);
    emitOutput(session, `已打开串口 ${options.path} · ${options.baud_rate} baud\r\n`);
  });
  port.on("data", data => emitOutput(session, data));
  port.on("error", error => emitOutput(session, `\r\n串口错误：${error.message}\r\n`));
  port.on("close", () => closeRemoteTerminalSession(session, "串口会话已结束"));
}

function writeRemoteTerminalInput(session, payload) {
  const text = payload.toString("utf8");
  if (text.startsWith("{")) {
    try {
      const message = JSON.parse(text);
      if (message?.type === "resize") {
        session.cols = Math.max(2, Number(message.cols) || 80);
        session.rows = Math.max(1, Number(message.rows) || 24);
        if (session.profile.protocol === "telnet") sendTelnetWindowSize(session, session.cols, session.rows);
        return;
      }
    } catch {}
  }
  const encoded = session.encoding === "utf8" ? Buffer.from(payload) : iconv.encode(text, session.encoding);
  session.transport?.write(session.profile.protocol === "telnet" ? escapeTelnetBytes(encoded) : encoded);
}

function handleRemoteTerminalUpgrade(req, socket) {
  let upgraded = false;
  try {
    const key = validateWebSocketUpgrade(req);
    const url = new URL(req.url, "http://terma.invalid");
    const profile = remoteTerminalProfile(Number(url.searchParams.get("id")));
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
    const log = terminalLogForProfile(profile, url.searchParams.get("title") || "", url.searchParams.get("log_id") || "");
    const encoding = String(profile.options.encoding || "utf8");
    const session: any = {
      socket,
      profile,
      transport:null,
      logFile:log.fullPath,
      encoding,
      decoder:encoding === "utf8" ? null : iconv.getDecoder(encoding),
      cols:Math.max(2, Number(url.searchParams.get("cols")) || 80),
      rows:Math.max(1, Number(url.searchParams.get("rows")) || 24),
      closed:false
    };
    sessions.add(session);
    if (profile.protocol === "telnet") connectTelnet(session);
    else connectSerial(session);
    const parser = new WebSocketFrameParser({maxFrameSize:1024 * 1024, maxMessageSize:2 * 1024 * 1024});
    socket.on("data", chunk => {
      try {
        parser.push(chunk, (opcode, payload) => {
          if (opcode === 8) return closeRemoteTerminalSession(session);
          if (opcode === 9) return sendWebSocketFrame(socket, payload, 10);
          if (opcode === 1 || opcode === 2) writeRemoteTerminalInput(session, payload);
        });
      } catch (error) {
        emitOutput(session, `\r\nWebSocket 错误：${error.message}\r\n`);
        closeRemoteTerminalSession(session);
      }
    });
    socket.on("close", () => closeRemoteTerminalSession(session));
    socket.on("error", () => closeRemoteTerminalSession(session));
    appendSystemLog(`${profile.protocol.toUpperCase()} 终端已启动：${profile.name}`);
  } catch (error) {
    appendSystemLog(`远程终端启动失败：${error.message}`);
    try {
      if (upgraded) {
        sendWebSocketFrame(socket, `\r\n终端启动失败：${error.message}\r\n`);
        closeWebSocket(socket, 1011, "终端启动失败");
      } else {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.end(error.message);
      }
    } catch {}
  }
}

function closeRemoteTerminalSession(session, message = "") {
  if (!session || session.closed) return;
  session.closed = true;
  sessions.delete(session);
  if (message) {
    try { emitOutput(session, `\r\n${message}\r\n`); } catch {}
  }
  try {
    const trailing = session.decoder?.end?.();
    if (trailing) emitOutput(session, trailing);
  } catch {}
  try { session.transport?.destroy?.(); } catch {}
  try { session.transport?.close?.(() => {}); } catch {}
  try { closeWebSocket(session.socket); } catch {}
}

function closeAllRemoteTerminals() {
  for (const session of [...sessions]) closeRemoteTerminalSession(session);
}

module.exports = { closeAllRemoteTerminals, handleRemoteTerminalUpgrade, listSerialPorts, serialRuntime, testRemoteTerminalProfile };
