const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runSshCommandForConnection } = require("../dist/ssh");
const { configureXdmcpServer, detectXdmcpServer } = require("../dist/xdmcp-manager");
const { createXServerRuntime } = require("../desktop/xserver-runtime");
const { trustTestHost } = require("./ssh-host-trust-test-helper");

const HOST = process.env.TERMA_XDMCP_TEST_HOST || process.env.TUNNELDESK_XDMCP_TEST_HOST || "";
const USER = process.env.TERMA_XDMCP_TEST_USER || process.env.TUNNELDESK_XDMCP_TEST_USER || "";
const IDENTITY_FILE = process.env.TERMA_XDMCP_TEST_KEY || process.env.TUNNELDESK_XDMCP_TEST_KEY || "";

function createDependencies() {
  if (!HOST || !USER || !IDENTITY_FILE) throw new Error("真实 XDMCP 验收需要设置 TERMA_XDMCP_TEST_HOST、TERMA_XDMCP_TEST_USER 和 TERMA_XDMCP_TEST_KEY");
  if (!fs.existsSync(IDENTITY_FILE)) throw new Error("XDMCP 测试私钥不可用");
  const connection = {
    id:1,
    name:"Linux 图形测试机",
    ssh_host:HOST,
    ssh_port:22,
    ssh_user:USER,
    identity_file:IDENTITY_FILE,
    ssh_agent_mode:"off",
    extra_args:""
  };
  return {
    connection,
    dependencies:{
      getConnection:id => {
        if (Number(id) !== connection.id) throw new Error("XDMCP 测试连接不存在");
        return connection;
      },
      listConnections:() => [connection],
      runSshCommandForConnection
    }
  };
}

function displayDiagnostics(diagnostics) {
  return {
    os:diagnostics.os_id,
    manager:diagnostics.manager_label,
    service:diagnostics.service,
    privileged:diagnostics.privileged,
    enabled:diagnostics.enabled,
    udp_177_listening:diagnostics.listening,
    firewall:diagnostics.firewall,
    sessions:diagnostics.sessions,
    recommended_action:diagnostics.action,
    warning:diagnostics.warning
  };
}

async function main() {
  if (!process.argv.includes("--confirm-real-xdmcp")) {
    throw new Error("真实 XDMCP 验收需要 --confirm-real-xdmcp");
  }
  const { connection, dependencies } = createDependencies();
  await trustTestHost(connection, "persist");
  const profile = {host:HOST, port:177, options:{ssh_connection_id:1, mode:"query"}};
  let diagnostics = await detectXdmcpServer(profile, dependencies);
  console.log("XDMCP 自动探测：", JSON.stringify(displayDiagnostics(diagnostics), null, 2));

  if (process.argv.includes("--configure")) {
    if (!process.argv.includes("--confirm-switch-display-manager")) {
      throw new Error("配置或切换显示管理器还需要 --confirm-switch-display-manager");
    }
    if (!diagnostics.privileged) throw new Error("测试连接没有 root 或免密码 sudo 权限");
    const action = diagnostics.action === "install-lightdm" ? "install-lightdm" : "enable";
    const configured = await configureXdmcpServer(profile, {
      action,
      restart:true,
      confirmation:"XDMCP_TRUSTED_LAN"
    }, dependencies);
    diagnostics = configured.after;
    console.log("XDMCP 配置后：", JSON.stringify(displayDiagnostics(diagnostics), null, 2));
  }

  const runtime = createXServerRuntime({
    platform:"win32",
    projectRoot:path.resolve(__dirname, ".."),
    userDataPath:path.join(os.tmpdir(), "terma-xdmcp-real-acceptance")
  });
  const networkProbe = await runtime.testXdmcp({host:HOST, port:177, options:{mode:"query"}});
  console.log("Windows XDMCP 网络探测：", JSON.stringify(networkProbe, null, 2));
  if (diagnostics.listening && !networkProbe.ok) {
    throw new Error(`远端已监听 UDP 177，但 Windows XDMCP 探测失败：${networkProbe.message || "未知错误"}`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
