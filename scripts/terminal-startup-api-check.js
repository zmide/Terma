const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const iconv = require("iconv-lite");
const { Server } = require("ssh2");

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`验证服务器提前退出，退出码 ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/about`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待终端启动配置验证服务器超时");
}

async function json(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    headers: { "Content-Type":"application/json" },
    ...options
  });
  const data = await response.json();
  return { response, data };
}

async function trustConnection(url, connectionId) {
  let result = await json(url, "/api/ssh/preflight", {
    method:"POST",
    body:JSON.stringify({connection_id:connectionId})
  });
  if (result.response.status === 409 && ["SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED"].includes(result.data.code)) {
    const accepted = await json(url, "/api/ssh/host-trust", {
      method:"POST",
      body:JSON.stringify({token:result.data.challenge.token, mode:"persist"})
    });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    result = await json(url, "/api/ssh/preflight", {
      method:"POST",
      body:JSON.stringify({connection_id:connectionId})
    });
  }
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-terminal-startup-api-"));
  const keyFile = path.join(root, "fixture-key");
  fs.writeFileSync(keyFile, "fixture", { mode:0o600 });
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const output = [];
  const requests = [];
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength:2048,
    privateKeyEncoding:{ type:"pkcs1", format:"pem" }
  });
  const sshServer = new Server({ hostKeys:[privateKey] }, client => {
    client.on("error", () => {});
    client.on("authentication", context => {
      if (context.method === "password" && context.password === "fixture-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("session", acceptSession => {
        const session = acceptSession();
        let ptyRequested = false;
        const environment = {};
        session.on("env", (acceptEnv, _rejectEnv, info) => {
          environment[info.key] = info.val;
          acceptEnv?.();
        });
        session.on("pty", acceptPty => {
          ptyRequested = true;
          acceptPty?.();
        });
        session.on("exec", (acceptExec, _rejectExec, info) => {
          requests.push({ type:"exec", command:String(info.command || ""), pty:ptyRequested, env:{...environment} });
          const channel = acceptExec();
          channel.write("__TERMA_STARTUP_WS_OK__\r\n");
          channel.exit(0);
          channel.end();
        });
        session.on("shell", acceptShell => {
          const request = { type:"shell", command:"", pty:ptyRequested, env:{...environment}, data:Buffer.alloc(0) };
          requests.push(request);
          const channel = acceptShell();
          channel.write("__TERMA_DEFAULT_WS_OK__\r\n");
          channel.on("data", chunk => {
            request.data = Buffer.concat([request.data, chunk]);
            if (!request.data.includes(iconv.encode("中文\r", "gb18030"))) return;
            channel.write(iconv.encode("__TERMA_GB18030_OK_中文__\r\n", "gb18030"));
            channel.exit(0);
            channel.end();
          });
        });
      });
    });
  });
  await new Promise((resolve, reject) => {
    sshServer.once("error", reject);
    sshServer.listen(0, "127.0.0.1", resolve);
  });
  const sshAddress = sshServer.address();
  const child = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd:path.resolve(__dirname, ".."),
    env:{
      ...process.env,
      TERMA_DATA_DIR:path.join(root, "data"),
      TERMA_SSH_DIR:path.join(root, ".ssh")
    },
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    await waitForServer(url, child);
    const created = await json(url, "/api/connections", {
      method:"POST",
      body:JSON.stringify({
        name:"Terminal startup API",
        group_name:"Test",
        ssh_host:"127.0.0.1",
        ssh_port:22,
        ssh_user:"tester",
        auth_type:"key",
        identity_file:keyFile,
        extra_args:"-o StrictHostKeyChecking=accept-new",
        terminal_startup_mode:"default"
      })
    });
    assert.equal(created.response.status, 201);
    const id = Number(created.data.id);
    assert.ok(id > 0);

    let listed = await json(url, "/api/connections");
    let connection = listed.data.find(item => item.id === id);
    assert.equal(connection.terminal_startup_mode, "default");
    assert.equal(connection.terminal_program_path, "");

    const startup = {
      terminal_startup_mode:"program",
      terminal_profile_name:"Python 3",
      terminal_profile_kind:"repl",
      terminal_program_path:"/usr/bin/python3",
      terminal_program_args:"-i",
      terminal_working_directory:"/tmp",
      terminal_program_platform:"posix"
    };
    const saved = await json(url, `/api/connections/${id}/terminal-startup`, {
      method:"POST",
      body:JSON.stringify(startup)
    });
    assert.equal(saved.response.status, 200);
    assert.deepEqual(saved.data.startup, startup);

    listed = await json(url, "/api/connections");
    connection = listed.data.find(item => item.id === id);
    assert.equal(connection.terminal_program_path, "/usr/bin/python3");
    assert.equal(connection.terminal_program_args, "-i");
    assert.equal(connection.terminal_working_directory, "/tmp");

    const ticket = await json(url, "/api/terminal/startup-tickets", {
      method:"POST",
      body:JSON.stringify({
        connection_id:id,
        startup:{
          terminal_startup_mode:"default"
        }
      })
    });
    assert.equal(ticket.response.status, 201);
    assert.match(ticket.data.token, /^[0-9a-f-]{36}$/i);
    assert.ok(ticket.data.expires_at > Date.now());

    const invalid = await json(url, `/api/connections/${id}/terminal-startup`, {
      method:"POST",
      body:JSON.stringify({ ...startup, terminal_program_args:"-i\nbad" })
    });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.data.error, /换行|一行/);

    const missingConnection = await json(url, "/api/terminal/startup-tickets", {
      method:"POST",
      body:JSON.stringify({ connection_id:999999, startup:{ terminal_startup_mode:"default" } })
    });
    assert.equal(missingConnection.response.status, 400);
    assert.match(missingConnection.data.error, /连接不存在/);

    const passwordConnection = await json(url, "/api/connections", {
      method:"POST",
      body:JSON.stringify({
        name:"Terminal startup WebSocket",
        group_name:"Test",
        ssh_host:"127.0.0.1",
        ssh_port:sshAddress.port,
        ssh_user:"tester",
        auth_type:"password",
        ssh_password:"fixture-password",
        extra_args:""
      })
    });
    assert.equal(passwordConnection.response.status, 201);
    const passwordId = Number(passwordConnection.data.id);
    await trustConnection(url, passwordId);
    const websocketTicket = await json(url, "/api/terminal/startup-tickets", {
      method:"POST",
      body:JSON.stringify({
        connection_id:passwordId,
        startup
      })
    });
    assert.equal(websocketTicket.response.status, 201);
    const websocketUrl = `${url.replace(/^http/, "ws")}/ws/terminal?id=${passwordId}&cols=80&rows=24&startup_token=${encodeURIComponent(websocketTicket.data.token)}`;
    const websocketOutput = await new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl);
      socket.binaryType = "arraybuffer";
      let text = "";
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error(`终端 WebSocket 临时启动配置验证超时：${text}`));
      }, 10000);
      socket.addEventListener("message", event => {
        text += event.data instanceof ArrayBuffer
          ? Buffer.from(event.data).toString("utf8")
          : Buffer.isBuffer(event.data) ? event.data.toString("utf8") : String(event.data || "");
        if (!text.includes("__TERMA_STARTUP_WS_OK__")) return;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        resolve(text);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`终端 WebSocket 连接失败：${text}`));
      });
    });
    assert.match(websocketOutput, /__TERMA_STARTUP_WS_OK__/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, "exec");
    assert.equal(requests[0].pty, true);
    assert.deepEqual(requests[0].env, {}, "终端编码不得通过 SSH2 修改远端 locale");
    assert.match(requests[0].command, /\/usr\/bin\/python3/);
    assert.match(requests[0].command, /'-i'/);

    const defaultWebsocketUrl = `${url.replace(/^http/, "ws")}/ws/terminal?id=${passwordId}&cols=80&rows=24`;
    const encodingSwitchOutput = await new Promise((resolve, reject) => {
      const socket = new WebSocket(defaultWebsocketUrl);
      socket.binaryType = "arraybuffer";
      let outputBytes = Buffer.alloc(0);
      let sent = false;
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error(`终端在线编码切换验证超时：${outputBytes.toString("hex")}`));
      }, 10000);
      socket.addEventListener("message", event => {
        const chunk = event.data instanceof ArrayBuffer
          ? Buffer.from(event.data)
          : Buffer.isBuffer(event.data) ? event.data : Buffer.from(String(event.data || ""), "utf8");
        outputBytes = Buffer.concat([outputBytes, chunk]);
        if (!sent && outputBytes.includes(Buffer.from("__TERMA_DEFAULT_WS_OK__", "utf8"))) {
          sent = true;
          socket.send(JSON.stringify({type:"terminal-encoding", encoding:"gb18030"}));
          socket.send("中文\r");
        }
        if (!sent || !outputBytes.includes(Buffer.from("__TERMA_GB18030_OK_", "ascii"))) return;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        resolve(outputBytes);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`终端在线编码切换 WebSocket 连接失败：${outputBytes.toString("hex")}`));
      });
    });
    assert.match(encodingSwitchOutput.toString("utf8"), /__TERMA_GB18030_OK_中文__/, "编码切换后必须在同一 WebSocket 会话双向转码");
    assert.equal(requests.length, 2, "在线编码切换不得重新建立 SSH 会话");
    assert.equal(requests[1].type, "shell");
    assert.deepEqual(requests[1].env, {}, "默认 Shell 同样不得接收 locale 注入");
    assert.ok(requests[1].data.includes(iconv.encode("中文\r", "gb18030")), "终端输入必须按在线选择的 GB18030 编码发送");
    console.log("终端启动配置 API 检查通过：永久保存、临时票据、在线编码切换及密码 SSH 的 WebSocket PTY 启动");
  } catch (error) {
    if (output.length) console.error(output.join("").slice(-12000));
    throw error;
  } finally {
    try { child.kill("SIGTERM"); } catch {}
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 3000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise(resolve => sshServer.close(() => resolve()));
    fs.rmSync(root, { recursive:true, force:true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
