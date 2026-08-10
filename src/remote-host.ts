const net = require("node:net");

function normalizeRemoteHost(value: unknown) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("[") || raw.endsWith("]")) {
    if (!(raw.startsWith("[") && raw.endsWith("]"))) throw new Error("目标主机的 IPv6 方括号不完整");
    const inner = raw.slice(1, -1);
    if (net.isIP(inner) !== 6) throw new Error("目标主机的方括号只能用于 IPv6 地址");
    return inner;
  }
  return raw;
}

function validateRemoteHost(value: unknown, options: {required?:boolean} = {}) {
  const host = normalizeRemoteHost(value);
  if ((options.required !== false && !host) || host.length > 255 || /[\0\r\n\t\s/@\\]/.test(host)) {
    throw new Error("请填写有效的目标主机");
  }
  if (host.includes(":") && net.isIP(host) !== 6) throw new Error("目标主机包含无效的 IPv6 地址");
  return host;
}

function formatRemoteEndpoint(hostValue: unknown, portValue: unknown) {
  const host = normalizeRemoteHost(hostValue);
  const port = Number(portValue || 0);
  const displayHost = net.isIP(host) === 6 ? `[${host}]` : host;
  return port ? `${displayHost}:${port}` : displayHost;
}

module.exports = { formatRemoteEndpoint, normalizeRemoteHost, validateRemoteHost };
