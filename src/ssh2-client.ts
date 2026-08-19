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
const { builtinSshExtraOptions } = require("./ssh-command");
const { connectionSettings, ssh2TimingOptions } = require("./ssh-connection");
const { assertAllowedIdentityPath } = require("./identity-path");
const { localX11Authorization } = require("./x11");
const { buildRemotePosixCommand } = require("./remote-posix");
const { remoteProbeValue } = require("./remote-probe-protocol");

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

function privateKeyCompatibility(file, passphrase = "") {
  try {
    const identityFile = assertAllowedIdentityPath(String(file || ""));
    const stat = fs.statSync(identityFile);
    const passphraseKey = passphrase ? crypto.createHash("sha256").update(String(passphrase)).digest("hex") : "";
    const cacheKey = `${identityFile}\n${stat.size}\n${stat.mtimeMs}\n${passphraseKey}`;
    const cached = keyCompatibilityCache.get(cacheKey);
    if (cached) return cached;
    const parsed = ssh2Utils.parseKey(fs.readFileSync(identityFile), passphrase || undefined);
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
  let extra;
  try {
    extra = builtinSshExtraOptions(connection?.extra_args, connection);
  } catch (error) {
    return {
      supported:false,
      reason:error.message || "SSH 附加参数无效",
      issues:Array.isArray(error?.issues) ? error.issues : []
    };
  }
  if (!extra.supported) {
    return { supported: false, reason: `使用了 OpenSSH 专用参数：${extra.unsupported}` };
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
    if (!direct.supported) {
      const error:any = new Error(`密码认证不能安全回退到系统 OpenSSH：${direct.reason}。请改用结构化连接设置或移除该兼容参数`);
      error.issues = Array.isArray(direct.issues) ? direct.issues : [];
      throw error;
    }
    const jump = Number(connection?.jump_connection_id || 0) ? storedConnection(connection.jump_connection_id) : null;
    const jumpCompatibility = jump ? builtinSshCompatibility(jump) : {supported:true, reason:""};
    const error:any = new Error(`跳板连接不能安全回退到系统 OpenSSH：${jumpCompatibility.reason}。请调整跳板认证或兼容参数`);
    error.issues = Array.isArray(jumpCompatibility.issues) ? jumpCompatibility.issues : [];
    throw error;
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
  const requestedIdentityFile = String(connection?.identity_file || "").trim();
  const identityFile = requestedIdentityFile ? assertAllowedIdentityPath(requestedIdentityFile) : "";
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
  const extra = builtinSshExtraOptions(connection?.extra_args, connection);
  if (!extra.supported) throw new Error(`内置 SSH 不支持附加参数：${extra.unsupported}`);
  Object.assign(options, extra.options);
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

function normalizeSshTransportError(error, connection: any = {}) {
  if (!error) return error;
  if (error.name === "SshTransportError" || error.name === "SshHostTrustError" || /^SSH_HOST_KEY_/.test(String(error.code || ""))) return error;
  const raw = String(error?.message || error).trim();
  const searchable = `${String(error?.code || "")} ${raw}`.toLowerCase();
  let message = "";
  if (/timed out while waiting for handshake|handshake timeout|etimedout|operation timed out/.test(searchable) && !/econnreset|connection reset|connection lost|socket disconnected/.test(searchable)) {
    message = "SSH 握手超时，请检查主机地址、端口和 SSH 服务";
  } else if (/connection lost before handshake|connection reset before handshake|econnreset/.test(searchable)) {
    message = /before handshake/.test(searchable)
      ? "SSH 握手前连接已断开，请检查主机地址、端口和 SSH 服务"
      : "SSH 连接已断开，请重新连接后再试";
  } else if (/econnrefused|connection refused/.test(searchable)) {
    message = "SSH 连接被拒绝，请检查远端 SSH 服务和端口";
  } else if (/enotfound|eai_again|getaddrinfo|could not resolve hostname/.test(searchable)) {
    message = "无法解析 SSH 主机地址，请检查主机名或 DNS";
  } else if (/all configured authentication methods failed|no more authentication methods available|authentication failed|permission denied \(publickey/.test(searchable)) {
    message = "SSH 认证失败，请检查用户名、密码、私钥或代理设置";
  } else if (/no matching (?:host key|cipher|mac|key exchange)|key exchange failed|handshake failed/.test(searchable)) {
    message = "SSH 握手失败，客户端与服务器没有可兼容的算法";
  } else if (/channel open failure|administratively prohibited|unable to open channel/.test(searchable)) {
    message = "SSH 通道打开失败，请检查远端转发权限和目标地址";
  } else if (/unable to start subsystem|subsystem request failed/.test(searchable)) {
    message = "远端 SSH 子系统不可用，请检查服务器配置";
  } else if (/not connected|connection closed|socket closed|no existing session/.test(searchable)) {
    message = "SSH 连接已断开，请重新连接后再试";
  } else if (/eaddrinuse|address already in use/.test(searchable)) {
    message = "本地监听端口已被占用，请更换端口或停止占用程序";
  } else if (/eacces|access denied|permission denied.*listen/.test(searchable)) {
    message = "没有权限监听本地端口，请更换端口或检查运行权限";
  }
  if (!message) {
    if (/[\u3400-\u9fff]/u.test(raw)) return error;
    message = "SSH 连接失败，请检查连接配置、网络和远端 SSH 服务";
  }
  const normalized: any = new Error(message);
  normalized.name = "SshTransportError";
  normalized.code = message.startsWith("SSH 认证失败")
    ? "SSH_AUTHENTICATION_FAILED"
    : String(error.code || "SSH_TRANSPORT_FAILED");
  const connectionId = Number(connection?.id || 0);
  if (Number.isSafeInteger(connectionId) && connectionId !== 0) normalized.connectionId = connectionId;
  if (connection?.name) normalized.connectionName = String(connection.name);
  Object.defineProperty(normalized, "cause", {value:error, enumerable:false, configurable:true});
  normalized.host = String(connection?.ssh_host || "").trim();
  normalized.port = Number(connection?.ssh_port || 22);
  return normalized;
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
      if (!settled) finish(hostTrustError || normalizeSshTransportError(error, connection));
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
      finish(hostTrustError || normalizeSshTransportError(error, connection));
    }
  });
}

function connectPassword(connection) {
  return connectSsh(connection);
}

function spawnPasswordCommand(connection, command, options: any = {}) {
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
    const normalized = normalizeSshTransportError(error, connection);
    if (!firstError) {
      firstError = normalized;
      child.emit("error", normalized);
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
      let removeX11Handler = () => {};
      client.on("error", reportError);
      client.once("close", () => close(child.killed ? null : 255, child.killed ? "SIGTERM" : null));
      const x11Mode = ["untrusted", "trusted"].includes(String(options.x11Mode || ""))
        ? String(options.x11Mode)
        : "";
      let channelOptions = {};
      if (x11Mode) {
        const authorization = localX11Authorization(x11Mode);
        const handler = (_info, accept, rejectX11) => openBuiltinX11Channel(authorization, accept, rejectX11);
        client.on("x11", handler);
        removeX11Handler = () => client.removeListener("x11", handler);
        client.once("close", removeX11Handler);
        channelOptions = {x11:{screen:authorization.screen}};
      }
      client.exec(String(command || ""), channelOptions, (error, channel) => {
        if (error) {
          removeX11Handler();
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

function runPasswordCommand(connection, command, input = null, timeoutMs = 60000, onChunk = null, options: any = {}) {
  return new Promise((resolve) => {
    const child: any = spawnPasswordCommand(connection, command, options);
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
  "printf 'TERMA_X11_DISPLAY=%s\\n' \"$DISPLAY\"",
  "terma_xauth=$(command -v xauth 2>/dev/null || true)",
  "if [ -z \"$terma_xauth\" ]; then for terma_candidate in /opt/X11/bin/xauth /usr/X11/bin/xauth /usr/bin/xauth; do [ -x \"$terma_candidate\" ] && terma_xauth=\"$terma_candidate\" && break; done; fi",
  "printf 'TERMA_X11_XAUTH=%s\\n' \"$terma_xauth\""
].join("\n");
const BUILTIN_X11_PROBE_EXEC_COMMAND = buildRemotePosixCommand(BUILTIN_X11_PROBE_COMMAND);

function parseBuiltinX11ProbeOutput(stdout, stderr = "") {
  const display = remoteProbeValue(stdout, "DISPLAY", "X11_").trim();
  const xauthPath = remoteProbeValue(stdout, "XAUTH", "X11_").trim();
  return {
    requested:true,
    available:Boolean(display),
    display,
    xauth_path:xauthPath,
    reason:display ? (xauthPath ? "SSH X11 转发已建立" : "SSH X11 已建立，但远端缺少 xauth") : (String(stderr || "").trim() || "远端没有分配 DISPLAY")
  };
}

function probeBuiltinX11Session(client, x11Options, connection) {
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
      if (error) return finish({requested:true, available:false, display:"", xauth_path:"", reason:normalizeSshTransportError(error, connection)?.message || "远端拒绝 X11 转发"});
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
        reject(normalizeSshTransportError(error, connection));
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
          reason:normalizeSshTransportError(error, connection)?.message || "本机 X Server 不可用"
        };
      }
    }
    const openMainChannel = () => {
      const channelOptions = x11Options ? {x11:x11Options} : {};
      if (startupCommand) client.exec(startupCommand, {pty, ...channelOptions}, callback);
      else client.shell(pty, channelOptions, callback);
    };
    if (x11Options) {
      probeBuiltinX11Session(client, x11Options, connection).then((diagnostics) => {
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
      if (error) reject(normalizeSshTransportError(error, connection));
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
    client.__termaJumpClient = lease.client;
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

function reportForwardError(callback, error) {
  try { callback?.(error); } catch {}
}

function pipeForwardSocket(client, source, host, port, onConnectionError: any = () => {}) {
  client.forwardOut(
    source.remoteAddress || "127.0.0.1",
    Number(source.remotePort || 0),
    String(host || "127.0.0.1"),
    Number(port),
    (error, channel) => {
      if (error) {
        reportForwardError(onConnectionError, error);
        // A refused direct-tcpip channel is a normal per-request failure.  Do
        // not re-emit the ssh2 Error on the local socket: the requester may
        // already have closed after connecting to the listening port.
        try { source.destroy(); } catch {}
        return;
      }
      source.pipe(channel).pipe(source);
      channel.on("error", () => source.destroy());
      source.on("error", () => {
        try { channel.close?.(); } catch {}
        try { channel.destroy?.(); } catch {}
      });
    }
  );
}

async function startLocalForward(client, forward, onError, onConnectionError = onError) {
  const sockets = new Set<any>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    pipeForwardSocket(client, socket, forward.target_host, forward.target_port, onConnectionError);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(forward.bind_port), String(forward.bind_host || "127.0.0.1"), () => {
      server.removeListener("error", reject);
      server.on("error", onError);
      resolve(null);
    });
  });
  return {
    get listening() { return server.listening; },
    address: () => server.address(),
    close: () => closeForwardListener(server, sockets)
  };
}

async function startSocksForward(client, forward, onError, onConnectionError = onError) {
  const server = socks.createServer();
  server.setConnectionHandler((connection, sendStatus) => {
    client.forwardOut(
      connection.socket.remoteAddress || "127.0.0.1",
      Number(connection.socket.remotePort || 0),
      connection.destAddress,
      connection.destPort,
      (error, channel) => {
      if (error) {
        reportForwardError(onConnectionError, error);
        try { sendStatus("HOST_UNREACHABLE"); } catch {}
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
  const sockets = new Set<any>();
  listener.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.address = () => listener.address();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    server.listen(Number(forward.bind_port), String(forward.bind_host || "127.0.0.1"), () => {
      listener.removeListener("error", reject);
      listener.on("error", onError);
      resolve(null);
    });
  });
  return {
    get listening() { return listener.listening; },
    address: () => listener.address(),
    close: () => closeForwardListener(listener, sockets)
  };
}

function closeForwardListener(listener, sockets = new Set<any>()) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    };
    const timer = setTimeout(finish, 2000);
    timer.unref?.();
    for (const socket of sockets) {
      try { socket.destroy(); } catch {}
    }
    try {
      if (!listener?.listening) return finish();
      listener.close(finish);
    } catch {
      finish();
    }
  });
}

async function startRemoteForward(client, forward, onError, onConnectionError = onError) {
  const bindHost = String(forward.bind_host || "127.0.0.1");
  const bindPort = Number(forward.bind_port);
  client.on("tcp connection", (_info, accept, reject) => {
    const channel = accept();
    const socket = net.connect(Number(forward.target_port), String(forward.target_host || "127.0.0.1"));
    socket.once("connect", () => socket.pipe(channel).pipe(socket));
    socket.once("error", (error) => {
      reportForwardError(onConnectionError, error);
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
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      };
      const timer = setTimeout(finish, 2000);
      timer.unref?.();
      try { client.unforwardIn(bindHost, bindPort, finish); } catch { finish(); }
    })
  };
}

async function startPasswordForward(connection, forward, callbacks: any = {}) {
  const client: any = await connectPassword(connection);
  let closing = false;
  let clientClosed = false;
  let listener;
  let closeTask: Promise<any> | null = null;
  const onError = (error) => reportForwardError(callbacks.onError, normalizeSshTransportError(error, connection));
  const onConnectionError = (error) => reportForwardError(callbacks.onConnectionError, normalizeSshTransportError(error, connection));
  client.on("error", onError);
  client.on("close", () => {
    clientClosed = true;
    if (closing || !listener) return;
    closing = true;
    closeTask = (async () => {
      try { await Promise.resolve(listener?.close?.()).catch(() => {}); } catch {}
      callbacks.onClose?.();
    })();
  });
  try {
    if (forward.mode === "local") listener = await startLocalForward(client, forward, onError, onConnectionError);
    else if (forward.mode === "remote") listener = await startRemoteForward(client, forward, onError, onConnectionError);
    else listener = await startSocksForward(client, forward, onError, onConnectionError);
    if (clientClosed) {
      try { await Promise.resolve(listener?.close?.()).catch(() => {}); } catch {}
      throw new Error("SSH connection closed while the forward listener was starting");
    }
  } catch (error) {
    try { client.end(); } catch {}
    throw normalizeSshTransportError(error, connection);
  }
  return {
    client,
    listener,
    async close() {
      if (closeTask) return closeTask;
      closeTask = (async () => {
        closing = true;
        try { await Promise.resolve(listener?.close?.()).catch(() => {}); } catch {}
        try { client.end(); } catch {}
      })();
      return closeTask;
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
  normalizeSshTransportError,
  spawnPasswordCommand,
  shouldUseBuiltinSsh,
  sshTransportForConnection,
  startSocksForward,
  startPasswordForward
};
