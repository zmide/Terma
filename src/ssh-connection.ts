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

function validateSshUser(value) {
  const user = String(value ?? "").trim();
  if (!user || user.length > 255 || user.startsWith("-") || /[\0\r\n\t\s@,:/\\]/.test(user)) {
    throw new Error("SSH 用户名无效：不能包含选项前缀、控制字符或目标分隔符");
  }
  return user;
}

function validateSshHost(value) {
  let host = String(value ?? "").trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host || host.length > 255 || host.startsWith("-") || /[\0\r\n\t\s@/\\]/.test(host)) {
    throw new Error("SSH 主机地址无效：不能包含选项前缀、控制字符或路径分隔符");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new Error("SSH 主机地址格式无效");
  return host;
}

function sshTarget(connection) {
  const host = validateSshHost(connection?.ssh_host);
  const port = Number(connection?.ssh_port || 22);
  const user = validateSshUser(connection?.ssh_user);
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  return {
    host,
    port,
    user,
    label:`${user}@${formattedHost}:${port}`,
    destination:`${user}@${host}`
  };
}

function sshDestinationArgs(connection) {
  const target = sshTarget(connection);
  return ["-l", target.user, target.host];
}

function proxyJumpArgument(connection) {
  const target = sshTarget(connection);
  return `${target.user}@${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
}

module.exports = {
  connectionSettings,
  proxyJumpArgument,
  sshDestinationArgs,
  ssh2TimingOptions,
  sshTarget,
  structuredOpenSshArgs,
  validateSshHost,
  validateSshUser
};
