function bounded(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) return fallback;
  return number;
}

function connectionSettings(connection) {
  return {
    connectTimeoutSeconds:bounded(connection?.connect_timeout_seconds, 10, 3, 120),
    keepaliveIntervalSeconds:bounded(connection?.keepalive_interval_seconds, 60, 0, 300),
    keepaliveCountMax:bounded(connection?.keepalive_count_max, 3, 1, 20),
    tcpKeepalive:Number(connection?.tcp_keepalive ?? 1) !== 0,
    agentMode:new Set(["auto", "off", "required"]).has(String(connection?.ssh_agent_mode || "auto"))
      ? String(connection?.ssh_agent_mode || "auto")
      : "auto"
  };
}

function ssh2TimingOptions(connection) {
  const settings = connectionSettings(connection);
  return {
    readyTimeout:settings.connectTimeoutSeconds * 1000,
    keepaliveInterval:settings.keepaliveIntervalSeconds * 1000,
    keepaliveCountMax:settings.keepaliveCountMax
  };
}

function structuredOpenSshArgs(connection) {
  const settings = connectionSettings(connection);
  return [
    "-o", `ConnectTimeout=${settings.connectTimeoutSeconds}`,
    "-o", `ServerAliveInterval=${settings.keepaliveIntervalSeconds}`,
    "-o", `ServerAliveCountMax=${settings.keepaliveCountMax}`,
    "-o", `TCPKeepAlive=${settings.tcpKeepalive ? "yes" : "no"}`
  ];
}

function sshTarget(connection) {
  const host = String(connection?.ssh_host || "").trim();
  const port = Number(connection?.ssh_port || 22);
  const user = String(connection?.ssh_user || "").trim();
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  return {
    host,
    port,
    user,
    label:`${user}@${formattedHost}:${port}`,
    destination:`${user}@${host}`
  };
}

function proxyJumpArgument(connection) {
  const target = sshTarget(connection);
  return `${target.user}@${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
}

module.exports = {
  connectionSettings,
  proxyJumpArgument,
  ssh2TimingOptions,
  sshTarget,
  structuredOpenSshArgs
};
