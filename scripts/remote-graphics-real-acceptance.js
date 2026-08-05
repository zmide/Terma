const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createXServerRuntime } = require("../desktop/xserver-runtime");

function readVncBanner(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port});
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("VNC 握手超时"));
    }, 5000);
    socket.once("data", data => {
      clearTimeout(timer);
      socket.destroy();
      resolve(data.toString("ascii").trim());
    });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  if (!process.argv.includes("--confirm-real-graphics")) throw new Error("真实图形主机验收需要 --confirm-real-graphics");
  const macVncBanner = await readVncBanner("192.168.31.109", 5900);
  if (!/^RFB \d{3}\.\d{3}$/.test(macVncBanner)) throw new Error(`macOS 返回了无效 VNC 握手：${macVncBanner}`);
  console.log(`macOS VNC 真实握手通过：${macVncBanner}`);

  const manager = createXServerRuntime({
    platform:"win32",
    projectRoot:path.resolve(__dirname, ".."),
    userDataPath:path.join(os.tmpdir(), "tunneldesk-graphics-acceptance")
  });
  const xdmcp = await manager.testXdmcp({host:"192.168.31.77", port:177, options:{mode:"query"}});
  console.log(`Linux XDMCP：${xdmcp.ok ? "服务可用" : `未启用（${xdmcp.message}）`}`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
