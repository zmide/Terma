const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createXServerRuntime } = require("../desktop/xserver-runtime");

async function main() {
  if (process.platform !== "win32") throw new Error("当前真实验收脚本需要在 Windows 桌面端运行");
  const host = process.env.TERMA_X11_TEST_HOST || process.env.TUNNELDESK_X11_TEST_HOST || "";
  const user = process.env.TERMA_X11_TEST_USER || process.env.TUNNELDESK_X11_TEST_USER || "";
  const identityFile = process.env.TERMA_X11_TEST_KEY || process.env.TUNNELDESK_X11_TEST_KEY || "";
  if (!host || !user || !identityFile) throw new Error("真实 X11 验收需要设置 TERMA_X11_TEST_HOST、TERMA_X11_TEST_USER 和 TERMA_X11_TEST_KEY");
  if (!fs.existsSync(identityFile)) throw new Error("X11 测试私钥不可用");
  const trusted = process.argv.includes("--trusted");
  const verbose = process.argv.includes("--verbose");
  const runtimeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "terma-x11-real-"));
  const manager = createXServerRuntime({platform:"win32", projectRoot:path.resolve(__dirname, ".."), userDataPath:runtimeDataDir});
  try {
    const diagnostics = await manager.start();
    console.log(`Local X Server: ${diagnostics.server} ${diagnostics.display}`);
    const xauthCheck = spawnSync("xauth.exe", ["list", process.env.DISPLAY], {env:process.env, encoding:"utf8", windowsHide:true});
    console.log(`Local xauth: ${String(xauthCheck.stdout || xauthCheck.stderr || "no matching entry").trim()}`);
    const xauthLocation = process.env.TERMA_XAUTH || process.env.TUNNELDESK_XAUTH;
    const result = spawnSync("ssh.exe", [
      ...(verbose ? ["-vvv"] : []),
      "-i", identityFile,
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      ...(xauthLocation ? ["-o", `XAuthLocation=${xauthLocation}`] : []),
      trusted ? "-Y" : "-X",
      `${user}@${host}`,
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
    if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("terma-x11-real-")) fs.rmSync(resolved, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
