import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

const { DATA_DIR, RUNTIME_SETTINGS_FILE } = require("../config");
const security = require("../security");
const { normalizeListenHosts, readRuntimeSettings, writeRuntimeSettings } = require("../runtime-settings");
const rollbackFile = path.join(DATA_DIR, "fnos-config-rollback.json");

function fields(value: unknown): string[] {
  return String(value ?? "").trim().split(/[\s,]+/).filter(Boolean);
}

export function validateFnosConfiguration(input: Record<string, unknown>) {
  const current = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
  const existing = security.readSecuritySettings();
  const password = String(input.password ?? "");
  const confirmation = String(input.confirmation ?? "");
  if ((password || confirmation) && (password.length < 12 || password.length > 4096 || password.includes("\0") || password !== confirmation)) {
    throw new Error("新密码至少 12 个字符且两次输入必须一致 / Use matching passwords of at least 12 characters");
  }
  const local = new Set(["0.0.0.0", "127.0.0.1"]);
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === "IPv4") local.add(entry.address);
  const resetNetwork = input.reset_network === true || input.reset_network === "true";
  const protocolChoice = String(input.origin_protocol_check ?? "keep").trim();
  if (!["", "keep", "true", "false"].includes(protocolChoice)) {
    throw new Error("协议校验请选择保持、开启或关闭 / Choose keep, enabled or disabled for protocol checking");
  }
  const checkProtocol = protocolChoice === "false" ? false : protocolChoice === "true" || resetNetwork ? true : existing.origin_protocol_check_enabled;
  const listenHosts = String(input.listen_hosts ?? "").trim()
    ? normalizeListenHosts(input.listen_hosts, null)
    : resetNetwork ? ["0.0.0.0"] : (current.listen_hosts || ["0.0.0.0"]);
  if (listenHosts.some((host: string) => !local.has(host))) throw new Error("监听地址必须是本机网卡 IPv4 地址，不能填写来源网段 / Enter a local IPv4 interface address, not a client subnet");
  const allowedHosts = String(input.allowed_hosts ?? "").trim()
    ? security.validateAllowedHosts(input.allowed_hosts)
    : resetNetwork ? [] : existing.allowed_hosts;
  const trustedProxies: string[] = String(input.trusted_proxies ?? "").trim()
    ? [...new Set(fields(input.trusted_proxies))]
    : resetNetwork ? [] : existing.trusted_proxy_addresses;
  if (trustedProxies.length > 32 || trustedProxies.some(address => !net.isIP(address) || ["0.0.0.0", "::"].includes(address))) {
    throw new Error("可信代理必须是最多 32 个具体 IP 地址 / Enter up to 32 specific proxy IP addresses");
  }
  return {
    password,
    runtime:{...current, listen_hosts:listenHosts, listen_port:8088},
    security:{allowed_hosts:allowedHosts, trusted_proxy_addresses:trustedProxies, trusted_proxy_enabled:trustedProxies.length > 0,
      origin_protocol_check_enabled:checkProtocol,
      auth_mode:"always", lan_auth_enabled:true, allow_disable_lan_auth:false,
      local_direct_desktop_integration_enabled:false, manage_user_ssh_keys_enabled:false}
  };
}

function privateWrite(file: string, value: unknown): void {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("Invalid private configuration path");
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(value, null, 2)); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function applyFnosConfiguration(input: Record<string, unknown>): void {
  const next = validateFnosConfiguration(input);
  if (fs.existsSync(rollbackFile)) throw new Error("请先恢复上一次中断的配置 / Recover the interrupted configuration first");
  privateWrite(rollbackFile, {security:security.readSecuritySettings(), runtime:readRuntimeSettings(RUNTIME_SETTINGS_FILE)});
  try {
    security.updateSecurityOptions(next.security);
    if (next.password) security.setPassword(next.password);
    writeRuntimeSettings(RUNTIME_SETTINGS_FILE, next.runtime);
    fs.chmodSync(RUNTIME_SETTINGS_FILE, 0o600);
  } catch (error) { rollbackFnosConfiguration(); throw error; }
}

export function rollbackFnosConfiguration(): void {
  if (!fs.existsSync(rollbackFile)) return;
  if (fs.lstatSync(rollbackFile).isSymbolicLink()) throw new Error("Invalid private rollback path");
  const snapshot = JSON.parse(fs.readFileSync(rollbackFile, "utf8"));
  if (!snapshot.security || !snapshot.runtime) throw new Error("Invalid configuration rollback record");
  security.writeSecuritySettings(snapshot.security);
  writeRuntimeSettings(RUNTIME_SETTINGS_FILE, snapshot.runtime);
  fs.chmodSync(RUNTIME_SETTINGS_FILE, 0o600);
  fs.unlinkSync(rollbackFile);
}

export function commitFnosConfiguration(): void {
  if (fs.existsSync(rollbackFile)) fs.unlinkSync(rollbackFile);
}

export function fnosListenHosts(): string[] {
  return normalizeListenHosts(readRuntimeSettings(RUNTIME_SETTINGS_FILE).listen_hosts, ["0.0.0.0"]);
}
