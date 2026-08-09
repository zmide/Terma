const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const iconv = require("iconv-lite");
const { Server } = require("ssh2");
const { trustTestHost } = require("./ssh-host-trust-test-helper");

let normalizeSshTransportError;
let runPasswordCommand;
let startPasswordForward;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function availablePort() {
  const server = net.createServer();
  return listen(server).then(port => close(server).then(() => port));
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`SSH 错误隔离验证服务器提前退出，退出码 ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/about`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待 SSH 错误隔离验证服务器超时");
}

async function stopChild(child) {
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
}

async function checkHandshakeTimeoutApi() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ssh-timeout-api-"));
  const webPort = await availablePort();
  const url = `http://127.0.0.1:${webPort}`;
  const sockets = new Set();
  const silentServer = net.createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const silentPort = await listen(silentServer);
  const output = [];
  const child = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(webPort)], {
    cwd:path.resolve(__dirname, ".."),
    env:{
      ...process.env,
      TERMA_DATA_DIR:path.join(root, "data"),
      TERMA_SSH_DIR:path.join(root, ".ssh"),
      TERMA_DISABLE_UPDATE_CHECK:"1"
    },
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    await waitForServer(url, child);
    const response = await fetch(`${url}/api/test-ssh`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        auth_type:"password",
        ssh_host:"127.0.0.1",
        ssh_port:silentPort,
        ssh_user:"fixture",
        ssh_password:"fixture",
        connect_timeout_seconds:3,
        keepalive_interval_seconds:0
      })
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.ok, false);
    const visible = [data.output, data.raw_output, data.error].filter(Boolean).join("\n");
    assert.match(visible, /SSH 握手超时/);
    assert.doesNotMatch(visible, /Timed out while waiting for handshake|Connection lost before handshake/i);

    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(child.exitCode, null, `迟到 SSH 错误不应结束服务进程：${output.join("").slice(-2000)}`);
    assert.equal((await fetch(`${url}/api/about`)).status, 200, "握手超时后的 API 服务仍应可用");
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(silentServer);
    await stopChild(child);
    fs.rmSync(root, {recursive:true, force:true});
  }
}

function connection(port) {
  return {
    auth_type: "password",
    ssh_host: "127.0.0.1",
    ssh_port: port,
    ssh_user: "test",
    ssh_password: "test-password"
  };
}

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ssh2-error-isolation-"));
  const fixtureSshRoot = path.join(fixtureRoot, ".ssh");
  const previousSshDir = process.env.TERMA_SSH_DIR;
  fs.mkdirSync(fixtureSshRoot, { recursive: true });
  process.env.TERMA_SSH_DIR = fixtureSshRoot;
  ({ normalizeSshTransportError, runPasswordCommand, startPasswordForward } = require("../dist/ssh2-client"));
  assert.equal(
    normalizeSshTransportError(new Error("Timed out while waiting for handshake"), {ssh_host:"example.com", ssh_port:22}).message,
    "SSH 握手超时，请检查主机地址、端口和 SSH 服务"
  );
  assert.equal(
    normalizeSshTransportError(new Error("Connection lost before handshake"), {ssh_host:"example.com", ssh_port:22}).message,
    "SSH 握手前连接已断开，请检查主机地址、端口和 SSH 服务"
  );
  assert.equal(
    normalizeSshTransportError(new Error("Unexpected ssh2 transport detail"), {ssh_host:"example.com", ssh_port:22}).message,
    "SSH 连接失败，请检查连接配置、网络和远端 SSH 服务"
  );
  assert.doesNotMatch(
    JSON.stringify(normalizeSshTransportError(new Error("Unexpected ssh2 transport detail"), {ssh_host:"example.com", ssh_port:22})),
    /Unexpected ssh2 transport detail/i,
    "归一化错误的 cause 不得把 ssh2 原始详情序列化到 API"
  );
  await checkHandshakeTimeoutApi();
  let uncaught = null;
  let unhandled = null;
  const onUncaught = (error) => { uncaught = error; };
  const onUnhandled = (error) => { unhandled = error; };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);

  const rejectingServer = net.createServer((socket) => socket.destroy());
  const rejectingPort = await listen(rejectingServer);
  const failed = await runPasswordCommand(connection(rejectingPort), "true", null, 3000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await close(rejectingServer);
  assert.equal(failed.status, null);
  assert.ok(failed.error, "握手失败应返回普通错误结果");
  assert.equal(uncaught, null, `握手失败不应触发未捕获异常：${uncaught?.message || ""}`);
  assert.equal(unhandled, null, `握手失败不应触发未处理拒绝：${unhandled?.message || ""}`);

  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sshServer = new Server({
    hostKeys: [privateKey.export({type:"pkcs1", format:"pem"})]
  }, (client) => {
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "test" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("tcpip", (_accept, reject) => reject());
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.write(iconv.encode("安装完成\n", "gbk"));
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  const sshPort = await listen(sshServer);
  const encodedConnection = {...connection(sshPort), terminal_encoding:"gbk"};
  await trustTestHost(encodedConnection, "once");
  const succeeded = await runPasswordCommand(encodedConnection, "true", null, 3000);
  await trustTestHost(encodedConnection, "once");
  let forwardErrors = 0;
  let requestErrors = 0;
  const managedForward = await startPasswordForward(encodedConnection, {
    mode:"local",
    bind_host:"127.0.0.1",
    bind_port:0,
    target_host:"127.0.0.1",
    target_port:9999
  }, {
    onError() { forwardErrors += 1; },
    onConnectionError() { requestErrors += 1; }
  });
  const refusedSocket = net.connect(managedForward.listener.address().port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待 SSH 转发拒绝结果超时")), 3000);
    const finish = () => { clearTimeout(timer); resolve(); };
    refusedSocket.once("error", finish);
    refusedSocket.once("close", finish);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(requestErrors, 1, "远端目标拒绝应作为单次转发请求错误上报");
  assert.equal(forwardErrors, 0, "远端目标拒绝不应把整个转发监听器标记为故障");
  assert.equal(managedForward.listener.listening, true, "单次目标拒绝后本地转发监听器应继续工作");
  assert.equal(uncaught, null, `转发目标拒绝不应触发未捕获异常：${uncaught?.message || ""}`);
  assert.equal(unhandled, null, `转发目标拒绝不应触发未处理拒绝：${unhandled?.message || ""}`);
  await managedForward.close();
  await close(sshServer);

  const encryptedKeyPath = path.join(fixtureSshRoot, "id_rsa_fixture");
  const passphrase = "terma-test-passphrase";
  fs.writeFileSync(encryptedKeyPath, privateKey.export({
    type:"pkcs1",
    format:"pem",
    cipher:"aes-256-cbc",
    passphrase
  }));
  const keyServer = new Server({
    hostKeys: [privateKey.export({type:"pkcs1", format:"pem"})]
  }, (client) => {
    client.on("authentication", (context) => {
      if (context.method === "publickey" && context.username === "key-test") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  const keyPort = await listen(keyServer);
  const keyConnection = {
    auth_type:"key",
    ssh_host:"127.0.0.1",
    ssh_port:keyPort,
    ssh_user:"key-test",
    identity_file:encryptedKeyPath,
    private_key_passphrase:passphrase,
    ssh_agent_mode:"off"
  };
  await trustTestHost(keyConnection, "once");
  const keySucceeded = await runPasswordCommand(keyConnection, "true", null, 3000);
  await close(keyServer);
  fs.rmSync(fixtureRoot, {recursive:true, force:true});
  if (previousSshDir === undefined) delete process.env.TERMA_SSH_DIR;
  else process.env.TERMA_SSH_DIR = previousSshDir;

  process.removeListener("uncaughtException", onUncaught);
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(succeeded.status, 0, succeeded.error?.message || succeeded.stderr || "后续 SSH 测试应成功");
  assert.equal(succeeded.stdout, "安装完成\n", "普通 SSH 命令输出必须按连接编码解码");
  assert.equal(keySucceeded.status, 0, keySucceeded.error?.message || keySucceeded.stderr || "加密私钥口令连接应成功");
  assert.equal(uncaught, null);
  assert.equal(unhandled, null);
  console.log("SSH2 认证检查通过：握手和转发通道拒绝可隔离，密码和加密私钥口令连接均可建立");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
