"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForJson(url, child, output, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`打包应用提前退出（${child.exitCode}）\n${output.join("").slice(-8000)}`);
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`等待打包应用启动超时\n${output.join("").slice(-8000)}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function removeTemporaryDirectory(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(directory, {recursive:true, force:true});
      return;
    } catch (error) {
      if (!new Set(["EBUSY", "EPERM", "ENOTEMPTY"]).has(error?.code) || attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

async function main() {
  const executable = path.resolve(process.argv[2] || "");
  if (!process.argv.includes("--confirm-packaged-smoke")) {
    throw new Error("打包应用启动检查需要 --confirm-packaged-smoke");
  }
  if (!fs.existsSync(executable)) throw new Error(`打包应用不存在：${executable}`);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "terma-packaged-smoke-"));
  fs.writeFileSync(path.join(userData, "desktop-settings.json"), JSON.stringify({
    dataMode:"user",
    customDataDir:"",
    openAtLogin:false,
    minimizeToTray:false,
    startMinimizedToTray:false,
    showStartupNotification:false,
    xServerAutoStart:false
  }, null, 2));
  const port = await reservePort();
  const args = [
    `--user-data-dir=${userData}`,
    "--host", "127.0.0.1",
    "--port", String(port)
  ];
  if (process.platform === "linux" && process.argv.includes("--no-sandbox")) args.unshift("--no-sandbox");
  const output = [];
  const child = spawn(executable, args, {
    env:{...process.env},
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    const base = `http://127.0.0.1:${port}`;
    const about = await waitForJson(`${base}/api/about`, child, output);
    const xserver = await waitForJson(`${base}/api/xserver`, child, output);
    const productName = about.product_name || about.name;
    if (productName !== "Terma") {
      throw new Error(`包内 about 接口异常：${JSON.stringify({product_name:about.product_name, name:about.name, version:about.version})}`);
    }
    if (!Object.prototype.hasOwnProperty.call(xserver, "available")) {
      throw new Error(`包内 X Server 诊断异常：${JSON.stringify(xserver)}`);
    }
    await fetch(`${base}/api/shutdown`, {method:"POST"}).catch(() => {});
    if (!await waitForExit(child, 10000)) {
      child.kill();
      await waitForExit(child, 5000);
    }
    console.log(`打包应用启动检查通过：${productName} v${about.version}，X Server 模式 ${xserver.mode || "none"}`);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await waitForExit(child, 5000);
    }
    await removeTemporaryDirectory(userData);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
