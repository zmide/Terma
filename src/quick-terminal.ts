const crypto = require("node:crypto");
const { assertAllowedIdentityPath } = require("./identity-path");
const { validateSshHost, validateSshUser } = require("./ssh-connection");

const QUICK_TERMINAL_TICKET_TTL_MS = 12 * 60 * 60 * 1000;
const QUICK_TERMINAL_TICKET_LIMIT = 128;
const tickets = new Map<string, any>();
const ticketTokensByConnectionId = new Map<number, string>();

function clearQuickTerminalSecret(item: any): void {
  if (!item?.connection) return;
  item.connection.ssh_password = "";
  item.connection.private_key_passphrase = "";
  item.connection.identity_file = "";
}

function removeQuickTerminalTicket(token: string, item: any): void {
  clearQuickTerminalSecret(item);
  tickets.delete(token);
  if (Number.isSafeInteger(item?.connection?.id)) {
    ticketTokensByConnectionId.delete(Number(item.connection.id));
  }
}

function purgeExpiredQuickTerminalTickets(now = Date.now()): void {
  for (const [token, item] of tickets) {
    if (Number(item?.expires_at || 0) > now) continue;
    removeQuickTerminalTicket(token, item);
  }
  while (tickets.size >= QUICK_TERMINAL_TICKET_LIMIT) {
    const oldest = tickets.entries().next().value;
    if (!oldest) break;
    removeQuickTerminalTicket(oldest[0], oldest[1]);
  }
}

function nextQuickConnectionId(): number {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = -(crypto.randomBytes(6).readUIntBE(0, 6) + 1);
    if (!ticketTokensByConnectionId.has(id)) return id;
  }
  throw new Error("无法分配临时连接标识");
}

function boundedSecret(value: unknown, label: string, required = false): string {
  const secret = String(value ?? "");
  if (secret.includes("\0") || secret.length > 4096) throw new Error(label + "无效");
  if (required && !secret) throw new Error("请填写" + label);
  return secret;
}

function quickTerminalPort(value: unknown): number {
  const port = Number(value ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH 端口必须在 1-65535 之间");
  return port;
}

function normalizeQuickTerminalConnection(value: any = {}): any {
  const host = validateSshHost(value.ssh_host);
  const user = validateSshUser(value.ssh_user);
  const port = quickTerminalPort(value.ssh_port);
  const authType = String(value.auth_type || "") === "password" ? "password" : "key";
  const identityFile = authType === "key" ? assertAllowedIdentityPath(value.identity_file) : "";
  const sshPassword = authType === "password" ? boundedSecret(value.ssh_password, "SSH 密码", true) : "";
  const privateKeyPassphrase = authType === "key"
    ? boundedSecret(value.private_key_passphrase, "私钥口令")
    : "";
  const labelHost = host.includes(":") ? "[" + host + "]" : host;
  return {
    id:nextQuickConnectionId(),
    name:String(value.name || (user + "@" + labelHost)).trim().slice(0, 255) || (user + "@" + labelHost),
    group_name:"",
    ssh_host:host,
    ssh_port:port,
    ssh_user:user,
    auth_type:authType,
    identity_file:identityFile,
    ssh_password:sshPassword,
    private_key_passphrase:privateKeyPassphrase,
    ssh_agent_mode:"off",
    jump_connection_id:null,
    connect_timeout_seconds:10,
    keepalive_interval_seconds:60,
    keepalive_count_max:3,
    tcp_keepalive:1,
    x11_mode:"off",
    extra_args:"",
    terminal_encoding:"utf8",
    sftp_filename_encoding:"utf8",
    sftp_text_encoding:"utf8",
    terminal_startup_mode:"default",
    terminal_profile_name:"",
    terminal_profile_kind:"shell",
    terminal_program_path:"",
    terminal_program_args:"",
    terminal_working_directory:"",
    terminal_program_platform:"auto",
    quick_connection:true
  };
}

function publicQuickTerminalConnection(connection: any): any {
  return {
    id:connection.id,
    name:connection.name,
    ssh_host:connection.ssh_host,
    ssh_port:connection.ssh_port,
    ssh_user:connection.ssh_user,
    auth_type:connection.auth_type,
    terminal_encoding:connection.terminal_encoding,
    sftp_filename_encoding:connection.sftp_filename_encoding,
    sftp_text_encoding:connection.sftp_text_encoding,
    quick_connection:true
  };
}

function createQuickTerminalTicket(value: unknown, requestBinding: unknown): any {
  const binding = String(requestBinding || "");
  if (!binding) throw new Error("当前请求不能创建快速连接");
  const connection = normalizeQuickTerminalConnection(value);
  purgeExpiredQuickTerminalTickets();
  const requestedConnectionId = Number((value as any)?.quick_connection_id || 0);
  if (
    Number.isSafeInteger(requestedConnectionId)
    && requestedConnectionId < 0
    && !ticketTokensByConnectionId.has(requestedConnectionId)
  ) {
    connection.id = requestedConnectionId;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + QUICK_TERMINAL_TICKET_TTL_MS;
  tickets.set(token, {connection, request_binding:binding, expires_at:expiresAt});
  ticketTokensByConnectionId.set(connection.id, token);
  return {
    token,
    expires_at:expiresAt,
    connection:publicQuickTerminalConnection(connection)
  };
}

function consumeQuickTerminalTicket(token: unknown, requestBinding: unknown): any {
  const cleanToken = String(token || "");
  purgeExpiredQuickTerminalTickets();
  const item = tickets.get(cleanToken);
  if (!item || item.expires_at <= Date.now() || item.request_binding !== String(requestBinding || "")) {
    throw new Error("快速连接凭据已失效，请重新输入认证信息");
  }
  return {...item.connection};
}

function authorizeQuickConnectionId(connectionIdValue: unknown, token: unknown, requestBinding: unknown): any {
  const connectionId = Number(connectionIdValue);
  if (!Number.isSafeInteger(connectionId) || connectionId >= 0) throw new Error("临时连接标识无效");
  const connection = consumeQuickTerminalTicket(token, requestBinding);
  if (Number(connection.id) !== connectionId) throw new Error("临时连接标识不匹配");
  return connection;
}

function resolveQuickConnectionById(id: unknown): any {
  const connectionId = Number(id);
  if (!Number.isSafeInteger(connectionId) || connectionId >= 0) return null;
  purgeExpiredQuickTerminalTickets();
  const token = ticketTokensByConnectionId.get(connectionId);
  const item = token ? tickets.get(token) : null;
  return item ? {...item.connection} : null;
}

function revokeQuickTerminalTicket(token: unknown, requestBinding: unknown): any {
  const cleanToken = String(token || "");
  purgeExpiredQuickTerminalTickets();
  const item = tickets.get(cleanToken);
  if (!item || item.request_binding !== String(requestBinding || "")) {
    return {ok:false, connection_id:0};
  }
  const connectionId = Number(item.connection?.id || 0);
  removeQuickTerminalTicket(cleanToken, item);
  return {ok:true, connection_id:connectionId};
}

module.exports = {
  QUICK_TERMINAL_TICKET_TTL_MS,
  authorizeQuickConnectionId,
  consumeQuickTerminalTicket,
  createQuickTerminalTicket,
  normalizeQuickTerminalConnection,
  purgeExpiredQuickTerminalTickets,
  resolveQuickConnectionById,
  revokeQuickTerminalTicket
};
