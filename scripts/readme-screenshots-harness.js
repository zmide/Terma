const fs = require("node:fs");
const crypto = require("node:crypto");
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
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`README 截图服务提前退出，退出码 ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/about`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待 README 截图服务启动超时");
}

function runElectron(environment) {
  return new Promise((resolve, reject) => {
    const executable = require("electron");
    const child = spawn(executable, [path.join(__dirname, "readme-screenshots-electron.js")], {
      cwd:path.resolve(__dirname, ".."),
      env:environment,
      stdio:"inherit",
      windowsHide:true
    });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`README 截图退出码 ${code}`)));
  });
}

function verifyScreenshots(output) {
  const names = [
    "desktop-overview.png",
    "desktop-terminal.png",
    "desktop-remote.png",
    "desktop-sftp.png",
    "desktop-linux-management.png",
    "desktop-forwarding.png"
  ];
  const hashes = names.map(name => {
    const filename = path.join(output, name);
    if (!fs.existsSync(filename)) throw new Error(`README screenshot missing: ${name}`);
    return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  });
  if (new Set(hashes).size !== hashes.length) {
    throw new Error("README screenshots unexpectedly contain duplicate frames");
  }
}

function verifyLocaleScreenshots(output, locale) {
  verifyScreenshots(path.join(output, locale));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-readme-screenshots-"));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const output = path.resolve(__dirname, "..", ".github", "assets", "screenshots");
  const serverOutput = [];
  const server = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd:path.resolve(__dirname, ".."),
    env:{
      ...process.env,
      TERMA_DATA_DIR:path.join(root, "data"),
      TERMA_SSH_DIR:path.join(root, ".ssh")
    },
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  server.stdout.on("data", chunk => serverOutput.push(chunk.toString()));
  server.stderr.on("data", chunk => serverOutput.push(chunk.toString()));
  try {
    await waitForServer(url, server);
    for (const locale of ["en-US", "zh-CN"]) {
      const localeOutput = path.join(output, locale);
      await runElectron({
        ...process.env,
        TERMA_README_SCREENSHOT_URL:url,
        TERMA_README_SCREENSHOT_DIR:localeOutput,
        TERMA_README_SCREENSHOT_USER_DATA:path.join(root, `electron-user-data-${locale}`),
        TERMA_README_SCREENSHOT_LANGUAGE:locale
      });
      verifyLocaleScreenshots(output, locale);
    }
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
    fs.rmSync(root, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
