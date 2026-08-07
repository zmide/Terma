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
  const macVncHost = process.env.TERMA_GRAPHICS_MAC_VNC_HOST || process.env.TUNNELDESK_GRAPHICS_MAC_VNC_HOST || "";
  const xdmcpHost = process.env.TERMA_GRAPHICS_XDMCP_HOST || process.env.TUNNELDESK_GRAPHICS_XDMCP_HOST || "";
  if (!macVncHost || !xdmcpHost) throw new Error("真实图形验收需要设置 TERMA_GRAPHICS_MAC_VNC_HOST 和 TERMA_GRAPHICS_XDMCP_HOST");
  const macVncBanner = await readVncBanner(macVncHost, 5900);
  if (!/^RFB \d{3}\.\d{3}$/.test(macVncBanner)) throw new Error(`macOS 返回了无效 VNC 握手：${macVncBanner}`);
  console.log(`macOS VNC 真实握手通过：${macVncBanner}`);

  const manager = createXServerRuntime({
    platform:"win32",
    projectRoot:path.resolve(__dirname, ".."),
    userDataPath:path.join(os.tmpdir(), "terma-graphics-acceptance")
  });
  const xdmcp = await manager.testXdmcp({host:xdmcpHost, port:177, options:{mode:"query"}});
  console.log(`Linux XDMCP：${xdmcp.ok ? "服务可用" : `未启用（${xdmcp.message}）`}`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
