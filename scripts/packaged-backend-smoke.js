"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

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

async function main() {
  if (!process.argv.includes("--confirm-packaged-backend")) {
    throw new Error("包内后端检查需要 --confirm-packaged-backend");
  }
  const archive = path.resolve(process.argv[2] || "");
  if (!fs.existsSync(archive)) throw new Error(`app.asar 不存在：${archive}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-packaged-backend-"));
  process.env.TERMA_DATA_DIR = path.join(temporary, "data");
  process.env.TERMA_SSH_DIR = path.join(temporary, "ssh");
  const metadata = require(path.join(archive, "package.json"));
  const serverModule = require(path.join(archive, "dist", "server.js"));
  const port = await reservePort();
  const started = serverModule.startServer(
    serverModule.parseArgs(["--host", "127.0.0.1", "--port", String(port)]),
    {exitOnShutdown:false}
  );
  try {
    await started.ready;
    const response = await fetch(`http://127.0.0.1:${port}/api/about`);
    const about = await response.json();
    if (!response.ok || about.product_name !== "Terma" || about.version !== metadata.version) {
      throw new Error(`包内后端信息异常：${JSON.stringify({status:response.status, product_name:about.product_name, version:about.version})}`);
    }
    if (process.platform === "darwin") {
      const addon = require(path.join(`${archive}.unpacked`, "native", "macos-sftp-drag", "prebuilds", `darwin-${process.arch}`, "terma_macos_sftp_drag.node"));
      if (!addon || typeof addon !== "object") throw new Error("macOS 原生拖拽模块加载失败");
    }
    console.log(`包内后端检查通过：${about.product_name} v${about.version} · ${process.platform}-${process.arch}`);
  } finally {
    await started.shutdown();
    fs.rmSync(temporary, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
