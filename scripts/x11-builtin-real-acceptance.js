const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createXServerRuntime } = require("../desktop/xserver-runtime");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

async function waitForStream(stream, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let exitCode = null;
    const timer = setTimeout(() => {
      try { stream.close(); } catch {}
      reject(new Error("内置 X11 真实验收超时"));
    }, timeoutMs);
    stream.on("data", chunk => { stdout = `${stdout}${chunk}`.slice(-12000); });
    stream.stderr?.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-12000); });
    stream.on("exit", code => { exitCode = code; });
    stream.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    stream.on("close", () => {
      clearTimeout(timer);
      resolve({exitCode, stdout, stderr});
    });
  });
}

async function main() {
  if (!process.argv.includes("--confirm-real-x11")) throw new Error("真实内置 X11 验收需要 --confirm-real-x11");
  const dataDir = argument("--data-dir", process.env.TUNNELDESK_DATA_DIR || "");
  const connectionId = Number(argument("--connection-id", "0"));
  const program = argument("--program", "/usr/bin/xclock");
  const programArgs = argument("--program-args", "");
  const durationSeconds = Math.max(2, Math.min(30, Number(argument("--duration", "3")) || 3));
  if (dataDir) process.env.TUNNELDESK_DATA_DIR = path.resolve(dataDir);
  if (!connectionId) throw new Error("请使用 --connection-id 指定已保存的真实 SSH 测试连接");

  const { getConnection } = require("../dist/db");
  const { openSshShell } = require("../dist/ssh2-client");
  const connection = getConnection(connectionId);
  const x11Mode = process.argv.includes("--saved-mode")
    ? String(connection.x11_mode || "off")
    : process.argv.includes("--trusted") ? "trusted" : "untrusted";
  if (x11Mode === "off") throw new Error("保存的连接没有开启默认 X11 转发");
  const runtimeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-x11-builtin-"));
  const manager = createXServerRuntime({platform:process.platform, projectRoot:path.resolve(__dirname, ".."), userDataPath:runtimeDataDir});
  let client = null;
  try {
    const diagnostics = await manager.start();
    if (!diagnostics.available) throw new Error(diagnostics.reason || "本机 X Server 未就绪");
    const result = await openSshShell({
      ...connection,
      terminal_startup_mode:"program",
      terminal_profile_name:"TunnelDesk X11 acceptance",
      terminal_profile_kind:"tool",
      terminal_program_path:"/usr/bin/timeout",
      terminal_program_args:`${durationSeconds} ${program}${programArgs ? ` ${programArgs}` : ""}`,
      terminal_working_directory:"",
      terminal_program_platform:"posix",
      x11_mode:x11Mode
    }, {term:"xterm-256color", cols:80, rows:24});
    client = result.client;
    const finished = await waitForStream(result.stream, durationSeconds * 1000 + 15000);
    if (finished.exitCode !== 124) {
      throw new Error(`内置 X11 图形程序未保持运行到验收超时，退出码 ${finished.exitCode}：${finished.stderr || finished.stdout}`);
    }
    console.log(`真实内置 X11 验收通过：保存的 ${connection.auth_type === "password" ? "密码" : "密钥"}认证 / ${x11Mode} -> ssh2 X11 -> ${diagnostics.server} -> ${program}`);
  } finally {
    try { client?.end(); } catch {}
    await manager.stop();
    const resolved = path.resolve(runtimeDataDir);
    if (resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) fs.rmSync(resolved, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
