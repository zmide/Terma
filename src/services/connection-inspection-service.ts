const { getConnection, listConnections } = require("../db");
const { buildRemotePosixCommand } = require("../remote-posix");
const { discoverRemoteTerminalCapabilities } = require("../ssh-capabilities");
const { runSshCommandForConnection } = require("../ssh");

function forwardLogLabel(id) {
  const forwardId = Number(id);
  for (const connection of listConnections()) {
    const forward = (connection.forwards || []).find(item => item.id === forwardId);
    if (!forward) continue;
    const target = forward.mode === "socks"
      ? `${forward.bind_host}:${forward.bind_port}`
      : `${forward.bind_host}:${forward.bind_port} -> ${forward.target_host}:${forward.target_port}`;
    return `${connection.name} / ${forward.service_name || target}`;
  }
  return `转发规则 ${forwardId}`;
}

async function inspectServer(connectionId) {
  const connection = getConnection(Number(connectionId));
  const script = [
    "printf '## system\\n'",
    "(uname -a 2>/dev/null || true)",
    "printf '\\n## os\\n'",
    "(cat /etc/os-release 2>/dev/null | sed -n '1,6p' || true)",
    "printf '\\n## uptime\\n'",
    "(uptime 2>/dev/null || true)",
    "printf '\\n## memory\\n'",
    "(free -h 2>/dev/null || vm_stat 2>/dev/null || true)",
    "printf '\\n## disk\\n'",
    "(df -h 2>/dev/null | sed -n '1,12p' || true)",
    "printf '\\n## ports\\n'",
    "(ss -tuln 2>/dev/null | sed -n '1,12p' || netstat -tuln 2>/dev/null | sed -n '1,12p' || true)"
  ].join("\n");
  const result: any = await runSshCommandForConnection(connection, buildRemotePosixCommand(script), 20000);
  const output = `${result.stdout || ""}${result.stderr || ""}${result.error ? result.error.message : ""}`.trim();
  return {
    id:connection.id,
    name:connection.name,
    ok:result.status === 0,
    exit_code:result.status,
    checked_at:Date.now(),
    output:output || (result.status === 0 ? "巡检完成，无输出" : `巡检失败，退出码 ${result.status}`)
  };
}

async function terminalCapabilitiesForConnection(connection) {
  return discoverRemoteTerminalCapabilities(
    async command => runSshCommandForConnection(connection, command, 10000),
    {timeoutMs:9000}
  );
}

module.exports = {
  forwardLogLabel,
  inspectServer,
  terminalCapabilitiesForConnection
};
