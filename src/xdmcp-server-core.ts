const path = require("node:path");

function shellQuote(value: any) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeHost(value: any) {
  let host = String(value || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (host.startsWith("::ffff:")) host = host.slice(7);
  return host;
}

function resolveManagementConnection(profile: any, dependencies: any) {
  const requested = Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
  if (requested) return dependencies.getConnection(requested);
  const host = normalizeHost(profile?.host);
  const matches = dependencies.listConnections()
    .filter((item: any) => normalizeHost(item.ssh_host) === host)
    .sort((a: any, b: any) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || Number(a.id) - Number(b.id));
  const protocol = String(profile?.protocol || "远程").toUpperCase();
  if (!matches.length) {
    const error: any = new Error(`没有找到同主机的 SSH 管理连接；${protocol} 仍可按协议能力连接，Linux 服务管理和深度诊断需要另行关联 SSH`);
    error.code = "REMOTE_MANAGEMENT_SSH_REQUIRED";
    throw error;
  }
  if (matches.length > 1) {
    const error: any = new Error(`找到多个同主机 SSH 连接，请在 ${protocol} 连接设置中明确选择 SSH 管理连接`);
    error.code = "REMOTE_MANAGEMENT_SSH_AMBIGUOUS";
    throw error;
  }
  return dependencies.getConnection(Number(matches[0].id));
}

function normalizeDisplay(value: any) {
  return String(value || "").trim().toLowerCase().replace(/\.0$/, "");
}

function resolveSessionManagerTarget(target: any, sessions: any[]) {
  const executable = path.basename(String(target || "")).toLowerCase();
  if (!executable) return null;
  const aliases = executable === "startplasma-x11"
    ? ["plasma", "plasma-x11", "kde-plasma-kf5"]
    : executable === "startxfce4" || executable === "xfce4-session"
      ? ["xfce", "xfce4"]
      : executable === "mate-session"
        ? ["mate"]
        : executable === "gnome-session"
          ? ["gnome-xorg", "gnome"]
          : executable === "startlxde"
            ? ["lxde"]
            : executable === "startlxqt" || executable === "lxqt-session"
              ? ["lxqt"]
              : [];
  return aliases.map(id => sessions.find((item: any) => item.id === id)).find(Boolean) || null;
}

module.exports = { normalizeDisplay, normalizeHost, resolveManagementConnection, resolveSessionManagerTarget, shellQuote };
