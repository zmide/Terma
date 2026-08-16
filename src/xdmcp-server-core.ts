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
  const host = normalizeHost(profile?.host);
  const connections = dependencies.listConnections();
  const requestedConnection = requested
    ? connections.find((item: any) => Number(item.id) === requested)
    : null;
  const protocol = String(profile?.protocol || "远程").toUpperCase();
  if (requestedConnection) {
    if (normalizeHost(requestedConnection.ssh_host) !== host) {
      const error: any = new Error(`已关联的 SSH 管理连接与 ${protocol} 主机不一致，请重新选择同主机的 SSH 管理连接`);
      error.code = "REMOTE_MANAGEMENT_SSH_HOST_MISMATCH";
      error.remoteProfileId = Number(profile?.id || 0);
      throw error;
    }
    return dependencies.getConnection(requested);
  }
  const matches = connections
    .filter((item: any) => normalizeHost(item.ssh_host) === host)
    .sort((a: any, b: any) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || Number(a.id) - Number(b.id));
  if (!matches.length) {
    const error: any = new Error(requested
      ? `已关联的 SSH 管理连接不存在，请为 ${protocol} 重新选择同主机的 SSH 管理连接`
      : `没有找到同主机的 SSH 管理连接；${protocol} 仍可按协议能力连接，Linux 服务管理和深度诊断需要另行关联 SSH`);
    error.code = requested ? "REMOTE_MANAGEMENT_SSH_STALE" : "REMOTE_MANAGEMENT_SSH_REQUIRED";
    error.remoteProfileId = Number(profile?.id || 0);
    throw error;
  }
  if (matches.length > 1) {
    const error: any = new Error(`找到多个同主机 SSH 连接，请在 ${protocol} 连接设置中明确选择 SSH 管理连接`);
    error.code = "REMOTE_MANAGEMENT_SSH_AMBIGUOUS";
    error.remoteProfileId = Number(profile?.id || 0);
    throw error;
  }
  const resolvedId = Number(matches[0].id);
  if (requested && typeof dependencies.repairManagementConnection === "function") {
    dependencies.repairManagementConnection(profile, resolvedId);
  }
  return dependencies.getConnection(resolvedId);
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
