const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`UI 验证服务器提前退出，退出码 ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/about`, {signal:AbortSignal.timeout(2000)})).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待 UI 验证服务器启动超时");
}

function runElectron(environment) {
  return new Promise((resolve, reject) => {
    const executable = require("electron");
    const args = [];
    if (process.platform === "linux" && environment.TERMA_UI_NO_SANDBOX === "1") {
      args.push("--no-sandbox");
    }
    args.push(path.join(__dirname, "ui-smoke-electron.js"));
    const child = spawn(executable, args, {
      cwd: path.resolve(__dirname, ".."),
      env: environment,
      stdio: "inherit",
      windowsHide: true
    });
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const smokeTimeoutMs = Math.max(180000, Number(environment.TERMA_UI_SMOKE_TIMEOUT_MS) || 300000);
    const harnessTimeoutMs = smokeTimeoutMs + 60000;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`UI 冒烟超过 ${Math.round(harnessTimeoutMs / 60000)} 分钟仍未结束，已终止 Electron 测试进程`));
    }, harnessTimeoutMs);
    child.once("error", finish(reject));
    child.once("close", finish(code => code === 0 ? resolve() : reject(new Error(`UI 冒烟退出码 ${code}`))));
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ui-smoke-"));
  const dataDirectory = path.join(root, "data");
  fs.mkdirSync(dataDirectory, {recursive:true});
  fs.writeFileSync(path.join(dataDirectory, "runtime-settings.json"), JSON.stringify({
    language:"zh-CN",
    language_onboarding_version:1
  }), "utf8");
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const serverOutput = [];
  const server = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      TERMA_DATA_DIR: dataDirectory,
      TERMA_SSH_DIR: path.join(root, ".ssh")
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  server.stdout.on("data", chunk => serverOutput.push(chunk.toString()));
  server.stderr.on("data", chunk => serverOutput.push(chunk.toString()));
  try {
    await waitForServer(url, server);
    const environment = {
      ...process.env,
      TERMA_CHECK_URL:url,
      TERMA_UI_USER_DATA:path.join(root, "electron-user-data")
    };
    await runElectron(environment);
  } catch (error) {
    if (serverOutput.length) console.error(serverOutput.join("").slice(-12000));
    throw error;
  } finally {
    try { server.kill("SIGTERM"); } catch {}
    await new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try { server.kill("SIGKILL"); } catch {}
        resolve();
      }, 3000);
      server.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
    } catch (error) {
      console.warn(`UI 冒烟临时目录稍后由系统清理：${error.message || error}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
