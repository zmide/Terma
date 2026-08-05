const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createXServerRuntime } = require("../desktop/xserver-runtime");

async function main() {
  if (process.platform !== "win32") throw new Error("当前真实验收脚本需要在 Windows 桌面端运行");
  const trusted = process.argv.includes("--trusted");
  const verbose = process.argv.includes("--verbose");
  const runtimeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-x11-real-"));
  const manager = createXServerRuntime({platform:"win32", projectRoot:path.resolve(__dirname, ".."), userDataPath:runtimeDataDir});
  try {
    const diagnostics = await manager.start();
    console.log(`Local X Server: ${diagnostics.server} ${diagnostics.display}`);
    const xauthCheck = spawnSync("xauth.exe", ["list", process.env.DISPLAY], {env:process.env, encoding:"utf8", windowsHide:true});
    console.log(`Local xauth: ${String(xauthCheck.stdout || xauthCheck.stderr || "no matching entry").trim()}`);
    const result = spawnSync("ssh.exe", [
      ...(verbose ? ["-vvv"] : []),
      "-i", "C:\\Users\\junruo\\.ssh\\id_rsa_junruo",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", `XAuthLocation=${process.env.TUNNELDESK_XAUTH}`,
      trusted ? "-Y" : "-X",
      "root@192.168.31.77",
      "printf 'REMOTE_DISPLAY=%s\\n' \"$DISPLAY\"; timeout 3 xclock"
    ], {env:process.env, encoding:"utf8", timeout:20000, windowsHide:true});
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (!/REMOTE_DISPLAY=localhost:/.test(result.stdout || "")) throw new Error("远端未获得 X11 DISPLAY");
    if (result.status !== 124) throw new Error(`xclock 未成功运行到验收超时，退出码 ${result.status}`);
    console.log(`真实 X11 验收通过：Windows 内置 X Server -> OpenSSH ${trusted ? "-Y" : "-X"} -> Linux xclock`);
  } finally {
    await manager.stop();
    const resolved = path.resolve(runtimeDataDir);
    const root = path.resolve(os.tmpdir());
    if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("tunneldesk-x11-real-")) fs.rmSync(resolved, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
