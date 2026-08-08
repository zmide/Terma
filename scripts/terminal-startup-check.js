const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");
const { Server } = require("ssh2");

const testRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "terma-terminal-startup-runtime-"));
process.env.TERMA_DATA_DIR = path.join(testRuntimeDir, "data");
process.env.TERMA_SSH_DIR = path.join(testRuntimeDir, "ssh");

const {
  buildRemoteStartupCommand,
  consumeTerminalStartupTicket,
  createTerminalStartupTicket,
  normalizeTerminalStartup,
  purgeExpiredStartupTickets
} = require("../dist/terminal-startup");
const { buildTerminalCommand } = require("../dist/ssh");
const { openSshShell } = require("../dist/ssh2-client");
const { closeDatabase } = require("../dist/db");
const { trustTestHost } = require("./ssh-host-trust-test-helper");

let currentStage = "初始化";
function markStage(stage) {
  currentStage = stage;
}
const watchdog = setTimeout(() => {
  console.error(`终端启动配置检查超时：${currentStage}`);
  process.exit(1);
}, 20_000);

const canonicalDefault = {
  terminal_startup_mode: "default",
  terminal_profile_name: "",
  terminal_profile_kind: "shell",
  terminal_program_path: "",
  terminal_program_args: "",
  terminal_working_directory: "",
  terminal_program_platform: "auto"
};

const programConfig = {
  terminal_startup_mode: "program",
  terminal_profile_name: "Python 3",
  terminal_profile_kind: "repl",
  terminal_program_path: "/usr/bin/python3",
  terminal_program_args: "-i -q",
  terminal_working_directory: "/srv/project",
  terminal_program_platform: "posix"
};

function expectThrow(action, pattern, message) {
  assert.throws(action, pattern, message);
}

function checkNormalization() {
  assert.deepEqual(normalizeTerminalStartup(), canonicalDefault);
  assert.deepEqual(normalizeTerminalStartup({
    terminal_startup_mode: "default",
    terminal_profile_name: " should be discarded ",
    terminal_profile_kind: "repl",
    terminal_program_path: "/usr/bin/python3",
    terminal_program_args: "-i",
    terminal_working_directory: "/tmp",
    terminal_program_platform: "posix"
  }), canonicalDefault, "默认模式不得携带上一次自定义程序的残留字段");
  assert.deepEqual(normalizeTerminalStartup({
    ...programConfig,
    terminal_profile_name: "  Python 3  ",
    terminal_program_path: "  /usr/bin/python3  ",
    terminal_program_args: "  -i -q  ",
    terminal_working_directory: "  /srv/project  "
  }), programConfig, "自定义启动配置应规范化首尾空白并保留有效字段");
  assert.deepEqual(normalizeTerminalStartup({
    terminal_startup_mode: "unexpected",
    terminal_program_path: "/bin/bash"
  }), canonicalDefault, "未知启动模式必须安全回退到默认登录 Shell");

  const invalidTextCases = [
    ["配置名称换行", { ...programConfig, terminal_profile_name: "Python\n3" }],
    ["程序路径回车", { ...programConfig, terminal_program_path: "/bin/bash\r--noprofile" }],
    ["启动参数换行", { ...programConfig, terminal_program_args: "-i\n-c evil" }],
    ["工作目录换行", { ...programConfig, terminal_working_directory: "/srv\n/tmp" }],
    ["程序路径空字符", { ...programConfig, terminal_program_path: "/bin/bash\0evil" }],
    ["启动参数空字符", { ...programConfig, terminal_program_args: "-i\0-q" }]
  ];
  for (const [label, value] of invalidTextCases) {
    expectThrow(() => normalizeTerminalStartup(value), /只能填写一行|空字符/, `${label}必须被拒绝`);
  }
  expectThrow(
    () => normalizeTerminalStartup({ ...programConfig, terminal_program_path: "  " }),
    /程序完整路径/,
    "program 模式缺少程序路径必须被拒绝"
  );
}

function checkCommandBuilding() {
  const posixConfig = {
    terminal_startup_mode: "program",
    terminal_profile_name: "quoted",
    terminal_profile_kind: "custom",
    terminal_program_path: "/opt/My Shell/o'hara",
    terminal_program_args: "--name \"two words\" \"semi;$(touch /tmp/nope)\" \"single'quote\"",
    terminal_working_directory: "/srv/work dir/user's",
    terminal_program_platform: "posix"
  };
  assert.equal(
    buildRemoteStartupCommand(posixConfig),
    "cd -- '/srv/work dir/user'\\''s' && exec '/opt/My Shell/o'\\''hara' '--name' 'two words' 'semi;$(touch /tmp/nope)' 'single'\\''quote'",
    "POSIX 程序路径、每个参数和工作目录都必须分别安全引用"
  );

  const windowsConfig = {
    terminal_startup_mode: "program",
    terminal_profile_name: "PowerShell 7",
    terminal_profile_kind: "shell",
    terminal_program_path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    terminal_program_args: "-NoLogo -NoExit \"two words\" \"O'Brien\"",
    terminal_working_directory: "C:\\Work Dir\\O'Brien",
    terminal_program_platform: "auto"
  };
  const windowsCommand = buildRemoteStartupCommand(windowsConfig);
  const match = windowsCommand.match(/^powershell\.exe -NoLogo -NoProfile -EncodedCommand ([A-Za-z0-9+/=]+)$/);
  assert.ok(match, "Windows 启动命令必须使用 PowerShell EncodedCommand，避免路径和参数被远端 Shell 二次解析");
  assert.equal(
    Buffer.from(match[1], "base64").toString("utf16le"),
    "& { $ErrorActionPreference='Stop'; Set-Location -LiteralPath 'C:\\Work Dir\\O''Brien'; & 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' '-NoLogo' '-NoExit' 'two words' 'O''Brien'; exit $LASTEXITCODE }",
    "EncodedCommand 解码后应保留安全引用的程序、参数和工作目录"
  );
  assert.equal(buildRemoteStartupCommand(canonicalDefault), "", "默认登录 Shell 不应生成远端启动命令");
}

function checkTickets() {
  const createdAt = Date.now();
  const ticket = createTerminalStartupTicket(42, programConfig);
  assert.match(ticket.token, /^[0-9a-f-]{36}$/i);
  assert.ok(ticket.expires_at > createdAt, "临时启动票据必须有未来过期时间");
  assert.ok(ticket.expires_at - createdAt <= 60_000, "临时启动票据应保持短期有效，避免长期重放");
  assert.deepEqual(consumeTerminalStartupTicket(ticket.token, 42), {...programConfig, x11_mode:null});
  expectThrow(
    () => consumeTerminalStartupTicket(ticket.token, 42),
    /失效|重新连接/,
    "票据消费一次后必须失效"
  );

  const wrongConnectionTicket = createTerminalStartupTicket(42, programConfig);
  expectThrow(
    () => consumeTerminalStartupTicket(wrongConnectionTicket.token, 43),
    /失效|重新连接/,
    "票据不得用于其他连接 ID"
  );
  expectThrow(
    () => consumeTerminalStartupTicket(wrongConnectionTicket.token, 42),
    /失效|重新连接/,
    "连接 ID 校验失败也必须销毁票据，防止重试探测"
  );

  const expiredTicket = createTerminalStartupTicket(42, programConfig);
  purgeExpiredStartupTickets(expiredTicket.expires_at);
  expectThrow(
    () => consumeTerminalStartupTicket(expiredTicket.token, 42),
    /失效|重新连接/,
    "过期票据必须被清理"
  );
  assert.equal(consumeTerminalStartupTicket("", 42), null);
  const x11Ticket = createTerminalStartupTicket(42, {...programConfig, x11_mode:"untrusted"});
  assert.deepEqual(consumeTerminalStartupTicket(x11Ticket.token, 42), {...programConfig, x11_mode:"untrusted"});
  expectThrow(() => createTerminalStartupTicket(0, programConfig), /连接 ID/, "非法连接 ID 必须被拒绝");
}

function checkSystemSshCommand() {
  const connection = {
    ssh_host: "example.test",
    ssh_port: 2222,
    ssh_user: "tester",
    auth_type: "password"
  };
  const defaultArgs = buildTerminalCommand({ ...connection, ...canonicalDefault });
  assert.deepEqual(defaultArgs.slice(-3), ["-l", "tester", "example.test"]);
  assert.ok(!defaultArgs.includes(""), "默认模式不得追加空启动命令");
  assert.ok(defaultArgs.includes("SendEnv=-*"), "终端编码只控制客户端转码，必须清除 OpenSSH 配置继承的 locale 转发");

const legacyEncodingArgs = buildTerminalCommand({...connection, ...canonicalDefault, terminal_encoding:"gbk"});
  assert.ok(legacyEncodingArgs.includes("SendEnv=-*"), "GBK/GB18030 终端同样不得发送远端 locale");

  const terminalUi = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal.js"), "utf8");
  assert.match(terminalUi, /socket\.send\(JSON\.stringify\(\{type:"terminal-encoding", encoding:settings\.terminal_encoding\}\)\)/, "切换终端编码必须在线通知当前会话转码器");
  assert.doesNotMatch(terminalUi, /previousEncoding !== settings\.terminal_encoding[\s\S]*?reconnectTerminal\(/, "切换终端编码不得断开或重连 SSH 会话");
  assert.match(terminalUi, /terminalSessions\.get\(key\)\?\.terminalEncoding/, "每个终端标签必须保留自己的运行时编码");
  assert.match(terminalUi, /encoding=\$\{encodeURIComponent\(session\.terminalEncoding/, "重连必须在握手阶段沿用当前标签的运行时编码");

  const programArgs = buildTerminalCommand({ ...connection, ...programConfig });
  const expectedStartup = buildRemoteStartupCommand(programConfig);
  assert.equal(programArgs.length, defaultArgs.length + 3);
  const remoteCommandIndex = programArgs.indexOf("RemoteCommand=none");
  assert.ok(remoteCommandIndex > 0, "program 模式必须禁用用户 SSH 配置中已有的 RemoteCommand");
  assert.deepEqual(programArgs.slice(-4, -1), ["-l", "tester", "example.test"]);
  assert.equal(programArgs.at(-1), expectedStartup, "program 模式必须在 SSH 目标之后追加且只追加一条远端命令");

  const conflictingArgs = buildTerminalCommand({
    ...connection,
    ...programConfig,
    extra_args: "-o RemoteCommand=/usr/bin/old-command"
  });
  assert.ok(
    conflictingArgs.indexOf("RemoteCommand=none") < conflictingArgs.indexOf("RemoteCommand=/usr/bin/old-command"),
    "命令行禁用值必须先于连接额外参数，确保 OpenSSH 使用 Terma 当前选择的启动程序"
  );
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { server.closeAllConnections?.(); } catch {}
      finish();
    }, 2000);
    try {
      server.close(finish);
      server.closeAllConnections?.();
    } catch {
      finish();
    }
  });
}

function waitFor(condition, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(message));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

async function verifyPortReusable(port) {
  if (!port) return;
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await closeServer(probe);
}

async function checkSsh2Requests() {
  markStage("SSH2 生成测试主机密钥");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" }
  });

  const requests = [];
  const serverConnections = new Set();
  const clientResources = [];
  let server = null;
  let port = 0;
  let mainError = null;
  const input = Buffer.from("a\x7f\x1b[A\x1b[B\x1b[C\x1b[D");

  try {
    markStage("SSH2 启动本地服务器");
    server = new Server({ hostKeys: [privateKey] }, (connection) => {
      serverConnections.add(connection);
      connection.on("error", () => {});
      connection.once("close", () => serverConnections.delete(connection));
      connection.on("authentication", context => {
        if (context.method === "password" && context.username === "test" && context.password === "test-password") {
          context.accept();
        } else {
          context.reject();
        }
      });
      connection.on("ready", () => {
        connection.on("session", acceptSession => {
          const session = acceptSession();
          const request = { type: "", command: "", pty: null, env: {}, data: Buffer.alloc(0) };
          requests.push(request);
          session.on("env", (acceptEnv, _rejectEnv, info) => {
            request.env[info.key] = info.val;
            acceptEnv?.();
          });
          session.on("pty", (acceptPty, _rejectPty, info) => {
            request.pty = info;
            acceptPty?.();
          });
          session.on("shell", acceptShell => {
            request.type = "shell";
            const channel = acceptShell();
            channel.on("data", chunk => {
              request.data = Buffer.concat([request.data, chunk]);
              if (request.data.length >= input.length) channel.end();
            });
          });
          session.on("exec", (acceptExec, _rejectExec, info) => {
            request.type = "exec";
            request.command = info.command;
            const channel = acceptExec();
            channel.on("data", chunk => {
              request.data = Buffer.concat([request.data, chunk]);
              if (request.data.length >= input.length) channel.end();
            });
          });
        });
      });
    });
    port = await listen(server);
    markStage("SSH2 打开默认 shell");
    const baseConnection = {
      auth_type: "password",
      ssh_host: "127.0.0.1",
      ssh_port: port,
      ssh_user: "test",
      ssh_password: "test-password"
    };
    await trustTestHost(baseConnection);

    const defaultResource = await openSshShell(
      { ...baseConnection, ...canonicalDefault },
      { term: "xterm-256color", cols: 101, rows: 31 }
    );
    clientResources.push(defaultResource);
    markStage("SSH2 写入默认 shell");
    assert.equal(defaultResource.stream.write(input), true, "默认 Shell 的 PTY 输入流应可写");
    await waitFor(
      () => requests[0]?.type === "shell" && requests[0].data.length >= input.length,
      "默认 Shell 请求或按键写入验证超时"
    );
    assert.equal(requests[0].type, "shell", "default 模式必须发送 SSH shell 请求");
    assert.equal(requests[0].command, "");
    assert.equal(requests[0].pty?.term, "xterm-256color");
    assert.equal(requests[0].pty?.cols, 101);
    assert.equal(requests[0].pty?.rows, 31);
    assert.deepEqual(requests[0].env, {}, "内置 SSH 的 UTF-8 PTY 不得注入远端 locale");
    assert.deepEqual(requests[0].data.subarray(0, input.length), input);
    try { defaultResource.stream.end(); } catch {}
    try { defaultResource.client.end(); } catch {}

    markStage("SSH2 打开 program exec");
    const expectedProgramCommand = buildRemoteStartupCommand(programConfig);
    const programResource = await openSshShell(
      { ...baseConnection, ...programConfig },
      { term: "xterm-256color", cols: 119, rows: 41 }
    );
    clientResources.push(programResource);
    markStage("SSH2 写入 program exec");
    assert.equal(programResource.stream.write(input), true, "program 模式的 PTY exec 输入流应可写");
    await waitFor(
      () => requests[1]?.type === "exec" && requests[1].data.length >= input.length,
      "带 PTY 的 exec 请求或按键写入验证超时"
    );
    assert.equal(requests[1].type, "exec", "program 模式必须发送 SSH exec 请求");
    assert.equal(requests[1].command, expectedProgramCommand, "SSH2 exec 命令必须与统一命令构造器完全一致");
    assert.equal(requests[1].pty?.term, "xterm-256color", "program 模式 exec 必须携带 PTY");
    assert.equal(requests[1].pty?.cols, 119);
    assert.equal(requests[1].pty?.rows, 41);
    assert.deepEqual(requests[1].env, {}, "带 PTY 的自定义程序也不得注入远端 locale");
    assert.deepEqual(requests[1].data.subarray(0, input.length), input);

    markStage("SSH2 打开旧编码 shell");
    const legacyResource = await openSshShell(
      { ...baseConnection, ...canonicalDefault, terminal_encoding:"gbk" },
      { term:"xterm-256color", cols:80, rows:24 }
    );
    clientResources.push(legacyResource);
    legacyResource.stream.end();
    await waitFor(() => requests[2]?.type === "shell", "旧编码 Shell 请求验证超时");
    assert.deepEqual(requests[2].env, {}, "GBK/GB18030 等旧编码 PTY 不得注入 UTF-8 locale");
  } catch (error) {
    mainError = error;
  } finally {
    markStage("SSH2 清理客户端资源");
    for (const resource of clientResources) {
      try { resource.stream?.close(); } catch {}
      try { resource.stream?.end(); } catch {}
      try { resource.client?.end(); } catch {}
      try { resource.client?._sock?.destroy(); } catch {}
    }
    markStage("SSH2 清理服务端连接");
    for (const connection of serverConnections) {
      try { connection.end(); } catch {}
      try { connection._sock?.destroy(); } catch {}
    }
    markStage("SSH2 关闭监听端口");
    try {
      await closeServer(server);
    } catch (error) {
      mainError ||= error;
    }
    markStage("SSH2 监听端口已关闭");
  }

  assert.equal(server?.address?.(), null, "本地 SSH 测试服务器必须关闭");
  markStage("SSH2 验证端口释放");
  await verifyPortReusable(port);
  if (mainError) throw mainError;
}

async function main() {
  markStage("规范化");
  console.log("检查终端启动配置规范化...");
  checkNormalization();
  markStage("远端启动命令");
  console.log("检查远端启动命令安全引用...");
  checkCommandBuilding();
  markStage("一次性票据");
  console.log("检查短期一次性启动票据...");
  checkTickets();
  markStage("系统 SSH 参数");
  console.log("检查系统 SSH 启动参数...");
  checkSystemSshCommand();
  markStage("SSH2 shell/PTY exec");
  console.log("检查 SSH2 shell/PTY exec 请求...");
  await checkSsh2Requests();
  markStage("完成");
  console.log("终端启动配置检查通过：规范化、安全引用、一次性票据、系统 SSH 与 SSH2 PTY 启动路径");
}

async function run() {
  let failure = null;
  try {
    await main();
  } catch (error) {
    failure = error;
  } finally {
    markStage("关闭测试数据库");
    try { closeDatabase(); } catch (error) { failure ||= error; }
    markStage("清理测试运行目录");
    try { fs.rmSync(testRuntimeDir, { recursive: true, force: true }); } catch (error) { failure ||= error; }
    markStage("核对测试运行目录");
    try {
      assert.equal(fs.existsSync(testRuntimeDir), false, "终端启动配置测试数据库和临时目录必须清理");
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) throw failure;
}

run().then(() => {
  clearTimeout(watchdog);
}).catch(error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exitCode = 1;
});
