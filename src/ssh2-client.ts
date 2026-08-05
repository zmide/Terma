const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const { PassThrough } = require("node:stream");
const { Client, utils: ssh2Utils } = require("ssh2");
const socks = require("@pondwader/socks5-server");
const iconv = require("iconv-lite");
const { buildRemoteStartupCommand } = require("./terminal-startup");
const { ensureHostTrusted, verifyHostKey } = require("./ssh-host-trust");
const { splitArgs } = require("./ssh-command");
const { connectionSettings, ssh2TimingOptions } = require("./ssh-connection");
const { localX11Authorization } = require("./x11");
const { buildRemotePosixCommand } = require("./remote-posix");

const BUILTIN_OPENSSH_OPTIONS = new Set([
  "batchmode",
  "checkhostip",
  "connecttimeout",
  "globalknownhostsfile",
  "hashknownhosts",
  "serveralivecountmax",
  "serveraliveinterval",
  "stricthostkeychecking",
  "tcpkeepalive",
  "updatehostkeys",
  "userknownhostsfile"
]);
const keyCompatibilityCache = new Map();
const jumpConnectionPool = new Map();
const JUMP_IDLE_TIMEOUT_MS = 30 * 1000;

const SSH_OUTPUT_ENCODING_ALIASES = {
  "utf-8":"utf8",
  "gb-18030":"gb18030",
  gb2312:"gbk",
  cp936:"gbk",
  "shift-jis":"shift_jis",
  sjis:"shift_jis",
  euckr:"euc-kr",
  "iso-8859-1":"latin1"
};

function normalizeSshOutputEncoding(value) {
  const requested = String(value || "utf8").trim().toLowerCase();
  const normalized = SSH_OUTPUT_ENCODING_ALIASES[requested] || requested;
  return iconv.encodingExists(normalized) ? normalized : "utf8";
}

function decodeSshOutput(value, encoding = "utf8") {
  if (value === undefined || value === null) return "";
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "binary");
  return iconv.decode(bytes, normalizeSshOutputEncoding(encoding));
}

function storedConnection(id) {
  return require("./db").getConnection(Number(id));
}

function isPasswordConnection(connection) {
  return String(connection?.auth_type || "key") === "password";
}

function unsupportedOpenSshArgument(text) {
  const args = splitArgs(text);
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "");
    if (value === "-o") {
      const option = String(args[index + 1] || "");
      const name = option.split("=", 1)[0].trim().toLowerCase();
      if (!name || !BUILTIN_OPENSSH_OPTIONS.has(name)) return option || value;
      index += 1;
      continue;
    }
    if (value.startsWith("-o") && value.length > 2) {
      const name = value.slice(2).split("=", 1)[0].trim().toLowerCase();
      if (!BUILTIN_OPENSSH_OPTIONS.has(name)) return value;
      continue;
    }
    return value;
  }
  return "";
}

function privateKeyCompatibility(file, passphrase = "") {
  try {
    const stat = fs.statSync(file);
    const passphraseKey = passphrase ? crypto.createHash("sha256").update(String(passphrase)).digest("hex") : "";
    const cacheKey = `${file}\n${stat.size}\n${stat.mtimeMs}\n${passphraseKey}`;
    const cached = keyCompatibilityCache.get(cacheKey);
    if (cached) return cached;
    const parsed = ssh2Utils.parseKey(fs.readFileSync(file), passphrase || undefined);
    const error = Array.isArray(parsed) ? parsed.find((item) => item instanceof Error) : (parsed instanceof Error ? parsed : null);
    const result = error
      ? { supported: false, reason: error.message || "内置 SSH 无法解析该私钥" }
      : { supported: true, reason: "" };
    keyCompatibilityCache.clear();
    keyCompatibilityCache.set(cacheKey, result);
    return result;
  } catch (error) {
    return { supported: false, reason: error.message || "无法读取私钥" };
  }
}

function builtinSshCompatibility(connection) {
  const unsupportedArgument = unsupportedOpenSshArgument(connection?.extra_args);
  if (unsupportedArgument) {
    return { supported: false, reason: `使用了 OpenSSH 专用参数：${unsupportedArgument}` };
  }
  if (isPasswordConnection(connection)) {
    return { supported: true, reason:["untrusted", "trusted"].includes(String(connection?.x11_mode || "off")) ? "密码认证和 X11 转发由内置 SSH 处理" : "密码认证由内置 SSH 处理" };
  }
  const settings = connectionSettings(connection);
  const agentAvailable = Boolean(process.env.SSH_AUTH_SOCK);
  if (settings.agentMode === "required") {
    return agentAvailable
      ? { supported:true, reason:"强制使用 SSH Agent" }
      : { supported:false, reason:"当前没有可用的 SSH Agent" };
  }
  const identityFile = String(connection?.identity_file || "").trim();
  if (identityFile) return privateKeyCompatibility(identityFile, connection?.private_key_passphrase || "");
  if (settings.agentMode !== "off" && agentAvailable) return { supported: true, reason: "使用 SSH Agent" };
  return { supported: false, reason: "未指定私钥，交由系统 OpenSSH 查找默认密钥或配置" };
}

function sshTransportForConnection(connection) {
  const direct = builtinSshCompatibility(connection);
  if (!direct.supported) return isPasswordConnection(connection) ? "unsupported" : "system";
  const jumpId = Number(connection?.jump_connection_id || 0);
  if (!jumpId) return "builtin";
  let jump;
  try { jump = storedConnection(jumpId); } catch { return "builtin"; }
  const jumpCompatibility = builtinSshCompatibility(jump);
  if (!jumpCompatibility.supported) return (isPasswordConnection(connection) || isPasswordConnection(jump)) ? "unsupported" : "system";
  return "builtin";
}

function shouldUseBuiltinSsh(connection) {
  const transport = sshTransportForConnection(connection);
  if (transport === "unsupported") {
    const direct = builtinSshCompatibility(connection);
    if (!direct.supported) throw new Error(`密码认证不能安全回退到系统 OpenSSH：${direct.reason}。请改用结构化连接设置或移除该兼容参数`);
    const jump = Number(connection?.jump_connection_id || 0) ? storedConnection(connection.jump_connection_id) : null;
    const jumpCompatibility = jump ? builtinSshCompatibility(jump) : {supported:true, reason:""};
    throw new Error(`跳板连接不能安全回退到系统 OpenSSH：${jumpCompatibility.reason}。请调整跳板认证或兼容参数`);
  }
  return transport === "builtin";
}

function passwordConnectOptions(connection) {
  const password = String(connection?.ssh_password || "");
  if (!password) throw new Error("该连接没有保存 SSH 密码，请编辑连接后重新输入");
  return {
    host: String(connection.ssh_host || "").trim(),
    port: Number(connection.ssh_port || 22),
    username: String(connection.ssh_user || "").trim(),
    password,
    ...ssh2TimingOptions(connection),
    authHandler: ["password", "keyboard-interactive"],
    tryKeyboard: true
  };
}

function keyConnectOptions(connection) {
  const identityFile = String(connection?.identity_file || "").trim();
  const settings = connectionSettings(connection);
  const options: any = {
    host: String(connection.ssh_host || "").trim(),
    port: Number(connection.ssh_port || 22),
    username: String(connection.ssh_user || "").trim(),
    ...ssh2TimingOptions(connection)
  };
  if (settings.agentMode !== "off" && process.env.SSH_AUTH_SOCK) options.agent = process.env.SSH_AUTH_SOCK;
  if (identityFile && settings.agentMode !== "required") {
    options.privateKey = fs.readFileSync(identityFile);
    if (connection?.private_key_passphrase) options.passphrase = String(connection.private_key_passphrase);
  }
  if (!identityFile && settings.agentMode === "off") throw new Error("SSH Agent 已关闭，但没有指定私钥");
  else if (!identityFile && !process.env.SSH_AUTH_SOCK) throw new Error("密钥连接未指定私钥，且当前没有可用的 SSH Agent");
  if (options.agent && options.privateKey) options.authHandler = ["agent", "publickey"];
  else if (options.agent) options.authHandler = ["agent"];
  else options.authHandler = ["publickey"];
  return options;
}

function connectionOptions(connection, onHostTrustError: any = () => {}, socket = null, trustOptions: any = {}) {
  const options: any = isPasswordConnection(connection) ? passwordConnectOptions(connection) : keyConnectOptions(connection);
  if (socket) options.sock = socket;
  options.hostVerifier = (rawKey) => {
    try {
      return verifyHostKey(connection, rawKey, { consume:trustOptions.consumeHostTrust !== false });
    } catch (error) {
      onHostTrustError(error);
      return false;
    }
  };
  return options;
}

function connectDirectSsh(connection, socket = null, options: any = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let hostTrustError = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      client.removeListener("ready", onReady);
      if (error) {
        try { client.end(); } catch {}
        reject(error);
      } else resolve(client);
    };
    const onReady = () => {
      try { (client as any)._sock?.setNoDelay?.(true); } catch {}
      finish();
    };
    const onError = (error) => {
      if (!settled) finish(hostTrustError || error);
    };
    client.once("ready", onReady);
    client.on("error", onError);
    if (isPasswordConnection(connection)) {
      client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, complete) => {
        const password = String(connection.ssh_password || "");
        complete((prompts || []).map(() => password));
      });
    }
    try {
      client.connect(connectionOptions(connection, (error) => { hostTrustError = error; }, socket, options));
    } catch (error) {
      finish(error);
    }
  });
}

function connectPassword(connection) {
  return connectSsh(connection);
}

function spawnPasswordCommand(connection, command) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = null;
  child.killed = false;
  child.client = null;
  child.channel = null;
  let closed = false;
  let firstError = null;
  child.on("error", () => {});

  const close = (code = null, signal = null) => {
    if (closed) return;
    closed = true;
    try { child.stdin.unpipe(); } catch {}
    try { child.stdout.end(); } catch {}
    try { child.stderr.end(); } catch {}
    try { child.client?.end(); } catch {}
    child.emit("close", code, signal);
  };

  const reportError = (error) => {
    if (!firstError) {
      firstError = error;
      child.emit("error", error);
    }
    try { child.channel?.close(); } catch {}
    try { child.client?.end(); } catch {}
    close(null);
  };

  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    try { child.channel?.close(); } catch {}
    try { child.client?.end(); } catch {}
    close(null, signal);
    return true;
  };

  queueMicrotask(async () => {
    try {
      const client: any = await connectPassword(connection);
      child.client = client;
      client.on("error", reportError);
      client.once("close", () => close(child.killed ? null : 255, child.killed ? "SIGTERM" : null));
      client.exec(String(command || ""), (error, channel) => {
        if (error) {
          reportError(error);
          return;
        }
        child.channel = channel;
        child.stdin.pipe(channel);
        channel.pipe(child.stdout);
        channel.stderr?.pipe(child.stderr);
        channel.on("error", reportError);
        channel.once("close", (code, signal) => close(code, signal));
      });
    } catch (error) {
      reportError(error);
    }
  });
  return child;
}

function runPasswordCommand(connection, command, input = null, timeoutMs = 60000, onChunk = null) {
  return new Promise((resolve) => {
    const child: any = spawnPasswordCommand(connection, command);
    const stdout: any[] = [];
    const stderr: any[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      finish(null, new Error("SSH 命令执行超时"));
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const encoding = connection?.terminal_encoding || "utf8";
      resolve({
        status,
        stdout:decodeSshOutput(Buffer.concat(stdout), encoding),
        stderr:decodeSshOutput(Buffer.concat(stderr), encoding),
        error
      });
    };
    child.stdout.on("data", (chunk) => { stdout.push(chunk); onChunk?.(chunk, "stdout"); });
    child.stderr.on("data", (chunk) => { stderr.push(chunk); onChunk?.(chunk, "stderr"); });
    child.on("error", (error) => finish(null, error));
    child.once("close", (code) => finish(code));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const BUILTIN_X11_PROBE_COMMAND = [
  "printf 'TD_X11_DISPLAY=%s\\n' \"$DISPLAY\"",
  "td_xauth=$(command -v xauth 2>/dev/null || true)",
  "if [ -z \"$td_xauth\" ]; then for td_candidate in /opt/X11/bin/xauth /usr/X11/bin/xauth /usr/bin/xauth; do [ -x \"$td_candidate\" ] && td_xauth=\"$td_candidate\" && break; done; fi",
  "printf 'TD_X11_XAUTH=%s\\n' \"$td_xauth\""
].join("\n");
const BUILTIN_X11_PROBE_EXEC_COMMAND = buildRemotePosixCommand(BUILTIN_X11_PROBE_COMMAND);

function parseBuiltinX11ProbeOutput(stdout, stderr = "") {
  const display = /^TD_X11_DISPLAY=(.*)$/m.exec(String(stdout || ""))?.[1]?.trim() || "";
  const xauthPath = /^TD_X11_XAUTH=(.*)$/m.exec(String(stdout || ""))?.[1]?.trim() || "";
  return {
    requested:true,
    available:Boolean(display),
    display,
    xauth_path:xauthPath,
    reason:display ? (xauthPath ? "SSH X11 转发已建立" : "SSH X11 已建立，但远端缺少 xauth") : (String(stderr || "").trim() || "远端没有分配 DISPLAY")
  };
}

function probeBuiltinX11Session(client, x11Options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stream: any = null;
    const finish = (diagnostics) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(diagnostics);
    };
    const timer = setTimeout(() => {
      try { stream?.close(); } catch {}
      finish({requested:true, available:false, display:"", xauth_path:"", reason:"X11 转发探测超时"});
    }, 8000);
    // The account's login shell may be csh/tcsh/fish.  Keep the X11 probe in
    // the same POSIX wrapper used by all remote diagnostics; otherwise a
    // valid xauth installation can be reported as missing even though the
    // forwarding channel is already usable.
    client.exec(BUILTIN_X11_PROBE_EXEC_COMMAND, {x11:x11Options}, (error, channel) => {
      if (error) return finish({requested:true, available:false, display:"", xauth_path:"", reason:error.message || "远端拒绝 X11 转发"});
      stream = channel;
      channel.on("data", chunk => { stdout = (stdout + chunk.toString("utf8")).slice(-8192); });
      channel.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(-8192); });
      channel.once("close", () => {
        finish(parseBuiltinX11ProbeOutput(stdout, stderr));
      });
    });
  });
}

function shouldFallbackFromX11(diagnostics) {
  return Boolean(diagnostics?.requested && diagnostics.available !== true);
}

async function openPasswordShell(connection, options: any = {}) {
  const client: any = await connectSsh(connection);
  return new Promise((resolve, reject) => {
    const pty = {
      term: options.term || "xterm-256color",
      cols: Math.max(2, Number(options.cols || 80)),
      rows: Math.max(1, Number(options.rows || 24))
    };
    let removeX11Handler = () => {};
    let x11Diagnostics = null;
    const callback = (error, stream) => {
      if (error) {
        removeX11Handler();
        try { client.end(); } catch {}
        reject(error);
        return;
      }
      resolve({ client, stream, x11Diagnostics });
    };
    const startupCommand = buildRemoteStartupCommand(connection);
    const x11Mode = ["untrusted", "trusted"].includes(String(connection?.x11_mode || "off")) ? connection.x11_mode : "";
    let x11Options = null;
    if (x11Mode) {
      try {
        const authorization = localX11Authorization(x11Mode);
        const handler = (_info, accept, rejectX11) => openBuiltinX11Channel(authorization, accept, rejectX11);
        client.on("x11", handler);
        removeX11Handler = () => client.removeListener("x11", handler);
        client.once("close", removeX11Handler);
        x11Options = {screen:authorization.screen};
      } catch (error) {
        x11Diagnostics = {
          requested:true,
          available:false,
          display:"",
          xauth_path:"",
          reason:error?.message || "本机 X Server 不可用"
        };
      }
    }
    const openMainChannel = () => {
      const channelOptions = x11Options ? {x11:x11Options} : {};
      if (startupCommand) client.exec(startupCommand, {pty, ...channelOptions}, callback);
      else client.shell(pty, channelOptions, callback);
    };
    if (x11Options) {
      probeBuiltinX11Session(client, x11Options).then((diagnostics) => {
        x11Diagnostics = diagnostics;
        if (shouldFallbackFromX11(diagnostics)) {
          removeX11Handler();
          x11Options = null;
        }
        openMainChannel();
      });
    } else openMainChannel();
  });
}

function rewriteX11Authorization(channel, socket, cookie) {
  let pending = Buffer.alloc(0);
  const fail = (message) => {
    try { channel.close(); } catch {}
    try { socket.destroy(new Error(message)); } catch {}
  };
  const onData = (chunk) => {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    if (pending.length < 12) return;
    const littleEndian = pending[0] === 0x6c;
    const bigEndian = pending[0] === 0x42;
    if (!littleEndian && !bigEndian) return fail("X11 客户端握手字节序无效");
    const readUInt16 = littleEndian ? Buffer.prototype.readUInt16LE : Buffer.prototype.readUInt16BE;
    const protocolLength = readUInt16.call(pending, 6);
    const cookieLength = readUInt16.call(pending, 8);
    const protocolPadded = (protocolLength + 3) & ~3;
    const cookiePadded = (cookieLength + 3) & ~3;
    const total = 12 + protocolPadded + cookiePadded;
    if (total > 64 * 1024) return fail("X11 客户端握手过大");
    if (pending.length < total) return;
    const protocol = pending.subarray(12, 12 + protocolLength).toString("ascii");
    if (protocol !== "MIT-MAGIC-COOKIE-1" || cookieLength !== cookie.length) return fail("X11 授权协议不兼容");
    cookie.copy(pending, 12 + protocolPadded);
    channel.removeListener("data", onData);
    if (!socket.write(pending)) channel.pause?.();
    socket.once("drain", () => channel.resume?.());
    channel.pipe(socket);
  };
  channel.on("data", onData);
  socket.pipe(channel);
  channel.on("error", () => socket.destroy());
  socket.on("error", () => { try { channel.close(); } catch {} });
}

function openBuiltinX11Channel(authorization, accept, reject) {
  const connectOptions = authorization.socket_path
    ? {path:authorization.socket_path}
    : {host:authorization.host, port:authorization.port};
  const socket = net.createConnection(connectOptions);
  let accepted = false;
  socket.once("connect", () => {
    try {
      const channel = accept();
      accepted = true;
      rewriteX11Authorization(channel, socket, authorization.cookie);
    } catch (error) {
      socket.destroy();
      try { reject(); } catch {}
    }
  });
  socket.once("error", () => {
    if (!accepted) {
      try { reject(); } catch {}
    }
  });
}

function openJumpSocket(client, connection) {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, String(connection.ssh_host || ""), Number(connection.ssh_port || 22), (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

async function acquireJumpConnection(jump) {
  const key = Number(jump.id);
  let entry: any = jumpConnectionPool.get(key);
  if (!entry) {
    entry = {client:null, promise:null, refs:0, idleTimer:null};
    entry.promise = connectDirectSsh(jump).then((client: any) => {
      entry.client = client;
      client.once("close", () => {
        if (jumpConnectionPool.get(key) === entry) jumpConnectionPool.delete(key);
        clearTimeout(entry.idleTimer);
      });
      return client;
    }).catch(error => {
      if (jumpConnectionPool.get(key) === entry) jumpConnectionPool.delete(key);
      throw error;
    });
    jumpConnectionPool.set(key, entry);
  }
  clearTimeout(entry.idleTimer);
  const client = entry.client || await entry.promise;
  entry.refs += 1;
  let released = false;
  return {
    client,
    release() {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs) return;
      clearTimeout(entry.idleTimer);
      entry.idleTimer = setTimeout(() => {
        if (entry.refs || jumpConnectionPool.get(key) !== entry) return;
        jumpConnectionPool.delete(key);
        try { entry.client?.end(); } catch {}
      }, JUMP_IDLE_TIMEOUT_MS);
      entry.idleTimer.unref?.();
    }
  };
}

function closeJumpConnectionPool() {
  for (const entry of jumpConnectionPool.values()) {
    clearTimeout(entry.idleTimer);
    try { entry.client?.end(); } catch {}
  }
  jumpConnectionPool.clear();
}

async function connectSsh(connection) {
  const jumpId = Number(connection?.jump_connection_id || 0);
  if (!jumpId) return connectDirectSsh(connection);
  const jump = storedConnection(jumpId);
  if (jump.jump_connection_id) throw new Error("当前仅支持单级跳板连接");
  const lease: any = await acquireJumpConnection(jump);
  try {
    const socket: any = await openJumpSocket(lease.client, connection);
    const client: any = await connectDirectSsh(connection, socket);
    client.__tunneldeskJumpClient = lease.client;
    client.once("close", lease.release);
    return client;
  } catch (error) {
    lease.release();
    throw error;
  }
}

async function ensureConnectionHostTrusted(connection) {
  const jumpId = Number(connection?.jump_connection_id || 0);
  if (!jumpId) return ensureHostTrusted(connection);
  const jump = storedConnection(jumpId);
  if (jump.jump_connection_id) throw new Error("当前仅支持单级跳板连接");
  await ensureHostTrusted(jump);
  const jumpClient: any = await connectDirectSsh(jump, null, { consumeHostTrust:false });
  try {
    const socket = await openJumpSocket(jumpClient, connection);
    return await ensureHostTrusted(connection, { sock:socket });
  } finally {
    try { jumpClient.end(); } catch {}
  }
}

function openSshShell(connection, options: any = {}) {
  return openPasswordShell(connection, options);
}

function pipeForwardSocket(client, source, host, port, onError: any = () => {}) {
  client.forwardOut(
    source.remoteAddress || "127.0.0.1",
    Number(source.remotePort || 0),
    String(host || "127.0.0.1"),
    Number(port),
    (error, channel) => {
      if (error) {
        onError(error);
        try { source.destroy(error); } catch {}
        return;
      }
      source.pipe(channel).pipe(source);
      channel.on("error", () => source.destroy());
      source.on("error", () => channel.close());
    }
  );
}

async function startLocalForward(client, forward, onError) {
  const server = net.createServer((socket) => {
    pipeForwardSocket(client, socket, forward.target_host, forward.target_port, onError);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(forward.bind_port), String(forward.bind_host || "127.0.0.1"), () => {
      server.removeListener("error", reject);
      server.on("error", onError);
      resolve(null);
    });
  });
  return server;
}

async function startSocksForward(client, forward, onError) {
  const server = socks.createServer();
  server.setConnectionHandler((connection, sendStatus) => {
    client.forwardOut(
      connection.socket.remoteAddress || "127.0.0.1",
      Number(connection.socket.remotePort || 0),
      connection.destAddress,
      connection.destPort,
      (error, channel) => {
      if (error) {
        onError(error);
        sendStatus("HOST_UNREACHABLE");
        return;
      }
      const socket = connection.socket;
      sendStatus("REQUEST_GRANTED");
      socket.pipe(channel).pipe(socket);
      channel.on("error", () => socket.destroy());
      channel.on("close", () => socket.destroy());
      channel.on("end", () => socket.end());
      socket.on("error", () => {
        try { channel.close?.(); } catch {}
        try { channel.destroy?.(); } catch {}
      });
      socket.on("close", () => {
        try { channel.close?.(); } catch {}
        try { channel.destroy?.(); } catch {}
      });
      }
    );
  });
  const listener = server.server;
  server.address = () => listener.address();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    server.listen(Number(forward.bind_port), String(forward.bind_host || "127.0.0.1"), () => {
      listener.removeListener("error", reject);
      listener.on("error", onError);
      resolve(null);
    });
  });
  return server;
}

async function startRemoteForward(client, forward, onError) {
  const bindHost = String(forward.bind_host || "127.0.0.1");
  const bindPort = Number(forward.bind_port);
  client.on("tcp connection", (_info, accept, reject) => {
    const channel = accept();
    const socket = net.connect(Number(forward.target_port), String(forward.target_host || "127.0.0.1"));
    socket.once("connect", () => socket.pipe(channel).pipe(socket));
    socket.once("error", (error) => {
      onError(error);
      try { channel.close(); } catch {}
      try { reject(); } catch {}
    });
    channel.on("error", () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    client.forwardIn(bindHost, bindPort, (error) => error ? reject(error) : resolve(null));
  });
  return {
    close: () => new Promise((resolve) => {
      client.unforwardIn(bindHost, bindPort, () => resolve(null));
    })
  };
}

async function startPasswordForward(connection, forward, callbacks: any = {}) {
  const client: any = await connectPassword(connection);
  let closing = false;
  const onError = (error) => callbacks.onError?.(error);
  client.on("error", onError);
  client.on("close", () => {
    if (!closing) callbacks.onClose?.();
  });
  let listener;
  try {
    if (forward.mode === "local") listener = await startLocalForward(client, forward, onError);
    else if (forward.mode === "remote") listener = await startRemoteForward(client, forward, onError);
    else listener = await startSocksForward(client, forward, onError);
  } catch (error) {
    try { client.end(); } catch {}
    throw error;
  }
  return {
    client,
    listener,
    async close() {
      closing = true;
      try {
        const result = listener?.close?.();
        if (result && typeof result.then === "function") await result.catch(() => {});
      } catch {}
      try { client.end(); } catch {}
    }
  };
}

module.exports = {
  BUILTIN_X11_PROBE_COMMAND,
  BUILTIN_X11_PROBE_EXEC_COMMAND,
  builtinSshCompatibility,
  closeJumpConnectionPool,
  connectSsh,
  connectPassword,
  ensureConnectionHostTrusted,
  isPasswordConnection,
  openSshShell,
  openPasswordShell,
  parseBuiltinX11ProbeOutput,
  shouldFallbackFromX11,
  runPasswordCommand,
  normalizeSshOutputEncoding,
  decodeSshOutput,
  spawnPasswordCommand,
  shouldUseBuiltinSsh,
  sshTransportForConnection,
  startSocksForward,
  startPasswordForward
};
