const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { LOGIN_PROTECTION_LIMITS, LoginRateLimiter, SessionStore } = require("./auth-protection");
const { localDirectDesktopIntegrationDecision, normalizeActualListenHosts } = require("./desktop-integration-policy");
const { ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");

const SECURITY_FILE = path.join(DATA_DIR, "security.json");
ensurePrivateDirectory(DATA_DIR);
ensurePrivateFile(SECURITY_FILE);
const DEFAULT_SESSION_TTL_MINUTES = 12 * 60;
const DEFAULT_SESSION_MAX_SESSIONS = 1000;
const DEFAULT_SESSION_CLEANUP_MINUTES = 10;
const DESKTOP_TOKEN_COOKIE = "td_desktop";
const DESKTOP_BROWSER_GRANT_COOKIE = "terma_desktop_grant";
const DESKTOP_BROWSER_GRANT_DEFAULT_TTL_MS = 10 * 60 * 1000;
const DESKTOP_BROWSER_GRANT_MIN_TTL_MS = 60 * 1000;
const DESKTOP_BROWSER_GRANT_MAX_TTL_MS = 8 * 60 * 60 * 1000;
const DESKTOP_BROWSER_GRANT_SESSION_HARD_TTL_MS = 12 * 60 * 60 * 1000;
const DESKTOP_BROWSER_GRANT_SCOPES = new Set(["xserver", "remote-client"]);
const SESSION_LIMITS = {
  ttl_minutes: { min:5, max:30 * 24 * 60 },
  max_sessions: { min:1, max:10000 },
  cleanup_minutes: { min:1, max:24 * 60 }
};
const sessions = new SessionStore({
  ttlMs: DEFAULT_SESSION_TTL_MINUTES * 60 * 1000,
  maxSessions: DEFAULT_SESSION_MAX_SESSIONS
});
const loginLimiter = new LoginRateLimiter();
let securityCleanupTimer: ReturnType<typeof setInterval> | null = null;
let securityCleanupIntervalMs = 0;
let desktopAuthToken = "";
let desktopCapabilityRuntimeListenHosts: string[] = [];
const desktopBrowserGrants = new Map<string, {
  id:string;
  createdAt:number;
  expiresAt:number;
  browserSession:boolean;
  scopes:string[];
  sessionDigest:string;
}>();

class AuthenticationError extends Error {
  statusCode: number;
  retryAfterSeconds: number;

  constructor(message, statusCode = 401, retryAfterSeconds = 0) {
    super(message);
    this.name = "AuthenticationError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function defaultSettings() {
  return {
    auth_mode: "lan",
    lan_auth_enabled: true,
    allow_disable_lan_auth: false,
    password_hash: "",
    password_salt: "",
    token_hash: "",
    token_salt: "",
    encryption_enabled: false,
    encryption_state: "disabled",
    encryption_version: 3,
    encryption_salt: "",
    encryption_check: "",
    encryption_legacy_version: 0,
    encryption_legacy_salt: "",
    encryption_legacy_check: "",
    notification_mode: "on",
    secure_cookie_mode: "auto",
    trusted_proxy_enabled: false,
    trusted_proxy_addresses: [],
    local_direct_desktop_integration_enabled: false,
    allowed_hosts: [],
    session_ttl_minutes: DEFAULT_SESSION_TTL_MINUTES,
    session_max_sessions: DEFAULT_SESSION_MAX_SESSIONS,
    session_cleanup_minutes: DEFAULT_SESSION_CLEANUP_MINUTES,
    login_max_failures: 5,
    login_window_seconds: 5 * 60,
    login_lock_seconds: 5 * 60,
    global_login_protection_enabled: true,
    global_login_max_failures: 50,
    global_login_window_seconds: 5 * 60,
    global_login_lock_seconds: 60,
    updated_at: Date.now()
  };
}

function normalizeBoundedInteger(value, fallback, limits) {
  const number = Number(value);
  return Number.isInteger(number) && number >= limits.min && number <= limits.max ? number : fallback;
}

function normalizeEncryptionState(stored) {
  const enabled = Boolean(stored?.encryption_enabled);
  const requested = String(stored?.encryption_state || "");
  const state = ["disabled", "enabling", "enabled", "disabling"].includes(requested)
    ? requested
    : (enabled ? "enabled" : "disabled");
  const requestedVersion = Number(stored?.encryption_version || 1);
  const version = [1, 2, 3].includes(requestedVersion) ? requestedVersion : 1;
  const requestedLegacyVersion = Number(stored?.encryption_legacy_version || 0);
  return {
    encryption_enabled:state !== "disabled",
    encryption_state:state,
    encryption_version:state === "disabled" ? 3 : version,
    encryption_salt:String(stored?.encryption_salt || ""),
    encryption_check:String(stored?.encryption_check || ""),
    encryption_legacy_version:[1, 2].includes(requestedLegacyVersion) ? requestedLegacyVersion : 0,
    encryption_legacy_salt:String(stored?.encryption_legacy_salt || ""),
    encryption_legacy_check:String(stored?.encryption_legacy_check || "")
  };
}

function requireBoundedInteger(value, label, limits) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < limits.min || number > limits.max) {
    throw new Error(`${label}必须是 ${limits.min}-${limits.max} 之间的整数`);
  }
  return number;
}

function normalizeTrustedProxyAddresses(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(items.map(normalizeSocketAddress).filter(item => net.isIP(item)))].slice(0, 32);
}

function parseHostAuthority(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw.length > 255 || /[\s\\/@]/.test(raw)) return null;
  let hostname = raw;
  let port = "";
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    if (close < 0) return null;
    hostname = raw.slice(1, close);
    const suffix = raw.slice(close + 1);
    if (suffix && !/^:\\d+$/.test(suffix)) return null;
    port = suffix.slice(1);
  } else {
    const colonCount = (raw.match(/:/g) || []).length;
    if (colonCount === 1) {
      const index = raw.lastIndexOf(":");
      hostname = raw.slice(0, index);
      port = raw.slice(index + 1);
      if (!hostname || !port) return null;
    } else if (colonCount > 1) {
      hostname = raw;
    }
  }
  hostname = normalizeSocketAddress(hostname).replace(/\.$/, "");
  if (!hostname || (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))) return null;
  if (net.isIP(hostname) !== 4 && net.isIP(hostname) !== 6 && !/^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_])?$/.test(hostname)) return null;
  return { hostname, port: port ? Number(port) : null };
}

function formatHostAuthority(value) {
  if (!value) return "";
  const hostname = net.isIP(value.hostname) === 6 ? `[${value.hostname}]` : value.hostname;
  return `${hostname}${value.port ? `:${value.port}` : ""}`;
}

function normalizeAllowedHosts(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(items.map(item => parseHostAuthority(item)).filter(Boolean).map(formatHostAuthority))].slice(0, 64);
}

function requireAllowedHosts(value) {
  const items = (Array.isArray(value) ? value : String(value || "").split(/[\s,]+/))
    .map(item => String(item || "").trim())
    .filter(Boolean);
  if (items.length > 64 || items.some(item => !parseHostAuthority(item))) {
    throw new Error("允许的 Host 必须是精确主机名或 IP，可选填写 1-65535 端口，不能包含协议和路径");
  }
  return [...new Set(items.map(item => formatHostAuthority(parseHostAuthority(item))))];
}

function normalizeAuthMode(stored) {
  const requested = String(stored?.auth_mode || "");
  if (requested === "lan" && stored?.lan_auth_enabled === false) return "off";
  if (!["lan", "always", "off"].includes(requested) && stored?.lan_auth_enabled === false) return "off";
  return ["lan", "always", "off"].includes(requested) ? requested : "lan";
}

function readSecuritySettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(SECURITY_FILE, "utf8"));
    const authMode = normalizeAuthMode(stored);
    return {
      ...defaultSettings(),
      ...stored,
      auth_mode:authMode,
      lan_auth_enabled:authMode !== "off",
      ...normalizeEncryptionState(stored),
      secure_cookie_mode: ["auto", "always", "never"].includes(String(stored?.secure_cookie_mode)) ? String(stored.secure_cookie_mode) : "auto",
      local_direct_desktop_integration_enabled: stored?.local_direct_desktop_integration_enabled === true,
      trusted_proxy_addresses: normalizeTrustedProxyAddresses(stored?.trusted_proxy_addresses),
      allowed_hosts: normalizeAllowedHosts(stored?.allowed_hosts),
      session_ttl_minutes: normalizeBoundedInteger(stored?.session_ttl_minutes, DEFAULT_SESSION_TTL_MINUTES, SESSION_LIMITS.ttl_minutes),
      session_max_sessions: normalizeBoundedInteger(stored?.session_max_sessions, DEFAULT_SESSION_MAX_SESSIONS, SESSION_LIMITS.max_sessions),
      session_cleanup_minutes: normalizeBoundedInteger(stored?.session_cleanup_minutes, DEFAULT_SESSION_CLEANUP_MINUTES, SESSION_LIMITS.cleanup_minutes),
      login_max_failures: normalizeBoundedInteger(stored?.login_max_failures, 5, LOGIN_PROTECTION_LIMITS.maxFailures),
      login_window_seconds: normalizeBoundedInteger(stored?.login_window_seconds, 5 * 60, LOGIN_PROTECTION_LIMITS.windowSeconds),
      login_lock_seconds: normalizeBoundedInteger(stored?.login_lock_seconds, 5 * 60, LOGIN_PROTECTION_LIMITS.lockSeconds),
      global_login_protection_enabled: stored?.global_login_protection_enabled !== false,
      global_login_max_failures: normalizeBoundedInteger(stored?.global_login_max_failures, 50, { ...LOGIN_PROTECTION_LIMITS.globalMaxFailures, min:1 }),
      global_login_window_seconds: normalizeBoundedInteger(stored?.global_login_window_seconds, 5 * 60, LOGIN_PROTECTION_LIMITS.globalWindowSeconds),
      global_login_lock_seconds: normalizeBoundedInteger(stored?.global_login_lock_seconds, 60, LOGIN_PROTECTION_LIMITS.globalLockSeconds)
    };
  } catch {
    return defaultSettings();
  }
}

function publicSecuritySettings(req = null) {
  const settings = readSecuritySettings();
  sessions.cleanup();
  return {
    auth_mode: settings.auth_mode,
    lan_auth_enabled: Boolean(settings.lan_auth_enabled),
    allow_disable_lan_auth: Boolean(settings.allow_disable_lan_auth),
    password_set: Boolean(settings.password_hash),
    token_set: Boolean(settings.token_hash),
    encryption_enabled: Boolean(settings.encryption_enabled),
    encryption_state: settings.encryption_state,
    encryption_version: settings.encryption_version,
    notification_mode: ["on", "muted", "off"].includes(String(settings.notification_mode)) ? settings.notification_mode : "on",
    secure_cookie_mode: settings.secure_cookie_mode,
    trusted_proxy_enabled: Boolean(settings.trusted_proxy_enabled),
    trusted_proxy_addresses: settings.trusted_proxy_addresses,
    local_direct_desktop_integration_enabled: Boolean(settings.local_direct_desktop_integration_enabled),
    local_direct_desktop_integration: localDirectDesktopIntegrationStatus(req),
    allowed_hosts: settings.allowed_hosts,
    login_protection: {
      max_failures: loginLimiter.options.maxFailures,
      window_seconds: Math.floor(loginLimiter.options.windowMs / 1000),
      lock_seconds: Math.floor(loginLimiter.options.lockMs / 1000),
      global_enabled: loginLimiter.options.globalMaxFailures > 0,
      global_max_failures: loginLimiter.options.globalMaxFailures,
      global_window_seconds: Math.floor(loginLimiter.options.globalWindowMs / 1000),
      global_lock_seconds: Math.floor(loginLimiter.options.globalLockMs / 1000),
      limits: LOGIN_PROTECTION_LIMITS
    },
    session_management: {
      ttl_minutes: settings.session_ttl_minutes,
      max_sessions: settings.session_max_sessions,
      cleanup_minutes: settings.session_cleanup_minutes,
      limits: SESSION_LIMITS
    },
    active_sessions: sessions.size(),
    auth_required: req ? authRequired(req) : null,
    request_secure: req ? isRequestSecure(req) : null
  };
}

function publicAuthStatus(req = null) {
  const settings = readSecuritySettings();
  return {
    password_set: Boolean(settings.password_hash),
    token_set: Boolean(settings.token_hash),
    auth_required: req ? authRequired(req) : null,
    request_secure: req ? isRequestSecure(req) : null
  };
}

function writeSecuritySettings(next) {
  ensurePrivateDirectory(DATA_DIR);
  const merged = { ...readSecuritySettings(), ...next, updated_at: Date.now() };
  const temporary = `${SECURITY_FILE}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let handle = null;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, JSON.stringify(merged, null, 2), "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    ensurePrivateFile(temporary);
    fs.renameSync(temporary, SECURITY_FILE);
    ensurePrivateFile(SECURITY_FILE);
  } catch (error) {
    if (handle !== null) try { fs.closeSync(handle); } catch {}
    try { fs.rmSync(temporary, { force:true }); } catch {}
    throw error;
  }
  applySessionManagementSettings(merged);
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  if (!String(secret || "")) throw new Error("密码不能为空");
  const hash = crypto.scryptSync(String(secret), salt, 32).toString("hex");
  return { salt, hash };
}

function verifySecret(secret, hash, salt) {
  if (!secret || !hash || !salt) return false;
  const actual = crypto.scryptSync(String(secret), salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function setPassword(password) {
  if (String(password || "").length < 8) throw new Error("密码至少 8 位");
  const item = hashSecret(password);
  writeSecuritySettings({ password_hash: item.hash, password_salt: item.salt });
  sessions.clear();
  loginLimiter.clear();
}

function setToken(token = crypto.randomBytes(32).toString("base64url")) {
  const item = hashSecret(token);
  writeSecuritySettings({ token_hash: item.hash, token_salt: item.salt });
  sessions.clear();
  loginLimiter.clear();
  return token;
}

function updateSecurityOptions(data) {
  const next: any = {};
  const requestedAuthMode = String(data.auth_mode || "");
  if (["lan", "always", "off"].includes(requestedAuthMode)) {
    next.auth_mode = requestedAuthMode;
    next.lan_auth_enabled = requestedAuthMode !== "off";
  } else if (typeof data.lan_auth_enabled !== "undefined") {
    next.lan_auth_enabled = Boolean(data.lan_auth_enabled);
    if (!next.lan_auth_enabled) next.auth_mode = "off";
    else if (readSecuritySettings().auth_mode === "off") next.auth_mode = "lan";
  }
  if (typeof data.allow_disable_lan_auth !== "undefined") next.allow_disable_lan_auth = Boolean(data.allow_disable_lan_auth);
  if (["on", "muted", "off"].includes(String(data.notification_mode || ""))) next.notification_mode = String(data.notification_mode);
  if (["auto", "always", "never"].includes(String(data.secure_cookie_mode || ""))) next.secure_cookie_mode = String(data.secure_cookie_mode);
  if (typeof data.trusted_proxy_enabled !== "undefined") next.trusted_proxy_enabled = Boolean(data.trusted_proxy_enabled);
  if (typeof data.trusted_proxy_addresses !== "undefined") next.trusted_proxy_addresses = normalizeTrustedProxyAddresses(data.trusted_proxy_addresses);
  if (typeof data.local_direct_desktop_integration_enabled !== "undefined") {
    next.local_direct_desktop_integration_enabled = Boolean(data.local_direct_desktop_integration_enabled);
  }
  if (typeof data.allowed_hosts !== "undefined") next.allowed_hosts = requireAllowedHosts(data.allowed_hosts);
  if (typeof data.session_ttl_minutes !== "undefined") {
    next.session_ttl_minutes = requireBoundedInteger(data.session_ttl_minutes, "会话有效期", SESSION_LIMITS.ttl_minutes);
  }
  if (typeof data.session_max_sessions !== "undefined") {
    next.session_max_sessions = requireBoundedInteger(data.session_max_sessions, "最大会话数", SESSION_LIMITS.max_sessions);
  }
  if (typeof data.session_cleanup_minutes !== "undefined") {
    next.session_cleanup_minutes = requireBoundedInteger(data.session_cleanup_minutes, "清理间隔", SESSION_LIMITS.cleanup_minutes);
  }
  if (typeof data.login_max_failures !== "undefined") next.login_max_failures = requireBoundedInteger(data.login_max_failures, "单来源失败次数", LOGIN_PROTECTION_LIMITS.maxFailures);
  if (typeof data.login_window_seconds !== "undefined") next.login_window_seconds = requireBoundedInteger(data.login_window_seconds, "单来源统计窗口", LOGIN_PROTECTION_LIMITS.windowSeconds);
  if (typeof data.login_lock_seconds !== "undefined") next.login_lock_seconds = requireBoundedInteger(data.login_lock_seconds, "单来源锁定时间", LOGIN_PROTECTION_LIMITS.lockSeconds);
  if (typeof data.global_login_protection_enabled !== "undefined") next.global_login_protection_enabled = Boolean(data.global_login_protection_enabled);
  if (typeof data.global_login_max_failures !== "undefined") next.global_login_max_failures = requireBoundedInteger(data.global_login_max_failures, "全局失败次数", { ...LOGIN_PROTECTION_LIMITS.globalMaxFailures, min:1 });
  if (typeof data.global_login_window_seconds !== "undefined") next.global_login_window_seconds = requireBoundedInteger(data.global_login_window_seconds, "全局统计窗口", LOGIN_PROTECTION_LIMITS.globalWindowSeconds);
  if (typeof data.global_login_lock_seconds !== "undefined") next.global_login_lock_seconds = requireBoundedInteger(data.global_login_lock_seconds, "全局锁定时间", LOGIN_PROTECTION_LIMITS.globalLockSeconds);
  const merged = { ...readSecuritySettings(), ...next };
  if (merged.trusted_proxy_enabled && !merged.trusted_proxy_addresses.length) {
    throw new Error("启用可信反向代理前至少填写一个代理 IP 地址");
  }
  if (next.auth_mode === "off" || next.lan_auth_enabled === false) {
    if (!data.confirm_unsafe) throw new Error("关闭局域网密码需要确认风险");
  }
  writeSecuritySettings(next);
  return publicSecuritySettings();
}

function resetWebAccessSecurity() {
  writeSecuritySettings({
    auth_mode: "lan",
    lan_auth_enabled: true,
    allow_disable_lan_auth: false,
    password_hash: "",
    password_salt: "",
    token_hash: "",
    token_salt: "",
    secure_cookie_mode: "auto",
    trusted_proxy_enabled: false,
    trusted_proxy_addresses: [],
    local_direct_desktop_integration_enabled: false,
    allowed_hosts: [],
    session_ttl_minutes: DEFAULT_SESSION_TTL_MINUTES,
    session_max_sessions: DEFAULT_SESSION_MAX_SESSIONS,
    session_cleanup_minutes: DEFAULT_SESSION_CLEANUP_MINUTES,
    login_max_failures: 5,
    login_window_seconds: 5 * 60,
    login_lock_seconds: 5 * 60,
    global_login_protection_enabled: true,
    global_login_max_failures: 50,
    global_login_window_seconds: 5 * 60,
    global_login_lock_seconds: 60
  });
  sessions.clear();
  loginLimiter.clear();
  desktopBrowserGrants.clear();
}

function normalizeSocketAddress(value) {
  const address = String(value || "").trim().toLowerCase().split("%")[0];
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopbackAddress(value) {
  const address = normalizeSocketAddress(value);
  if (address === "::1") return true;
  if (net.isIP(address) !== 4) return false;
  return Number(address.split(".")[0]) === 127;
}

function isLocalRequest(req) {
  return isLoopbackAddress(req.socket.remoteAddress);
}

function isDirectLoopbackRequest(req) {
  return isLocalRequest(req) && isLocalHostAuthority(req) && !hasProxyForwardingHeaders(req);
}

function isLanListening(req) {
  const address = normalizeSocketAddress(req.socket.localAddress);
  return Boolean(address) && !isLoopbackAddress(address);
}

function localHostnames() {
  const hostname = String(os.hostname() || "").trim().toLowerCase().replace(/\.$/, "");
  const short = hostname.split(".")[0];
  return new Set([hostname, short, short ? `${short}.local` : ""].filter(Boolean));
}

function isLocalHostAuthority(req) {
  const host = requestHost(req);
  if (!host) return false;
  const localAddress = normalizeSocketAddress(req.socket.localAddress);
  if (host.hostname === localAddress) return true;
  if (isLoopbackAddress(localAddress) && (host.hostname === "localhost" || isLoopbackAddress(host.hostname))) return true;
  return localHostnames().has(host.hostname);
}

function hasProxyForwardingHeaders(req) {
  return ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]
    .some(name => String(req.headers[name] || "").trim());
}

function hasConfiguredCredential(settings = readSecuritySettings()) {
  const envToken = process.env.TERMA_AUTH_TOKEN || process.env.TUNNELDESK_AUTH_TOKEN || "";
  return Boolean(
    (settings.password_hash && settings.password_salt)
    || (settings.token_hash && settings.token_salt)
    || envToken
  );
}

function isTrustedProxyRequest(req, settings = readSecuritySettings()) {
  if (!settings.trusted_proxy_enabled) return false;
  const remote = normalizeSocketAddress(req.socket.remoteAddress);
  return settings.trusted_proxy_addresses.includes(remote);
}

function requestSourceAddress(req) {
  return requestSourceAddressInfo(req).address;
}

function requestSourceAddressInfo(req) {
  const settings = readSecuritySettings();
  if (isTrustedProxyRequest(req, settings)) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(item => normalizeSocketAddress(item)).filter(item => net.isIP(item));
    if (forwarded.length) return { address: forwarded[forwarded.length - 1], forwarded: true, valid: true };
    return { address: normalizeSocketAddress(req.socket.remoteAddress) || "unknown", forwarded: true, valid: false };
  }
  return { address: normalizeSocketAddress(req.socket.remoteAddress) || "unknown", forwarded: false, valid: true };
}

function requestProtocol(req) {
  if (req.socket?.encrypted) return "https:";
  const settings = readSecuritySettings();
  if (!isTrustedProxyRequest(req, settings)) return "http:";
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwarded === "https" ? "https:" : "http:";
}

function isRequestSecure(req) {
  const settings = readSecuritySettings();
  if (settings.secure_cookie_mode === "always") return true;
  if (settings.secure_cookie_mode === "never") return false;
  return requestProtocol(req) === "https:";
}

function authRequired(req) {
  const settings = readSecuritySettings();
  if (settings.auth_mode === "off" || settings.lan_auth_enabled === false) return false;
  if (settings.auth_mode === "always") return true;
  if (isTrustedProxyRequest(req, settings)) return true;
  return !isDirectLoopbackRequest(req);
}

function parseCookies(header) {
  const out: any = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    try {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {}
  }
  return out;
}

function sessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie || "").td_session;
  if (!token) return null;
  return sessions.get(token);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function constantTimeSecretEqual(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestDesktopToken(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return String(req.headers["x-terma-desktop-token"] || req.headers["x-tunneldesk-desktop-token"] || cookies[DESKTOP_TOKEN_COOKIE] || "").trim();
}

function hasDesktopToken(req) {
  return Boolean(desktopAuthToken) && constantTimeSecretEqual(requestDesktopToken(req), desktopAuthToken);
}

function desktopBrowserGrantDigest(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function authenticatedWebSessionToken(req) {
  const token = String(parseCookies(req.headers.cookie || "").td_session || "").trim();
  return token && sessions.get(token) ? token : "";
}

function authenticatedWebSession(req) {
  const token = String(parseCookies(req.headers.cookie || "").td_session || "").trim();
  const record = token ? sessions.get(token) : null;
  return record ? { token, record } : null;
}

function requestAuthenticationBinding(req) {
  const desktopToken = requestDesktopToken(req);
  if (desktopToken && hasDesktopToken(req)) {
    return "desktop:" + crypto.createHash("sha256").update(desktopToken).digest("hex");
  }
  const sessionToken = authenticatedWebSessionToken(req);
  if (sessionToken) {
    return "session:" + crypto.createHash("sha256").update(sessionToken).digest("hex");
  }
  if (!isAuthenticated(req)) return "";
  const source = requestSourceAddress(req);
  const host = String(req.headers.host || "").trim().toLowerCase();
  return "request:" + crypto.createHash("sha256").update(source + "\n" + host).digest("hex");
}

function cleanupDesktopBrowserGrants(now = Date.now()) {
  for (const [digest, grant] of desktopBrowserGrants) {
    if (grant.expiresAt > 0 && grant.expiresAt <= now) desktopBrowserGrants.delete(digest);
  }
}

function desktopBrowserGrantFromRequest(req) {
  if (!isDirectLoopbackRequest(req)) return null;
  const sessionToken = authenticatedWebSessionToken(req);
  if (!sessionToken) return null;
  const token = String(parseCookies(req.headers.cookie || "")[DESKTOP_BROWSER_GRANT_COOKIE] || "").trim();
  if (!token) return null;
  cleanupDesktopBrowserGrants();
  const digest = desktopBrowserGrantDigest(token);
  const grant = desktopBrowserGrants.get(digest) || null;
  if (!grant || (grant.expiresAt > 0 && grant.expiresAt <= Date.now())) {
    desktopBrowserGrants.delete(digest);
    return null;
  }
  if (grant.sessionDigest !== desktopBrowserGrantDigest(sessionToken)) return null;
  return { digest, grant };
}

function hasAuthenticatedWebSession(req) {
  return Boolean(authenticatedWebSessionToken(req));
}

function setDesktopCapabilityRuntimeListenHosts(hosts) {
  desktopCapabilityRuntimeListenHosts = normalizeActualListenHosts(hosts);
  return [...desktopCapabilityRuntimeListenHosts];
}

function localDirectDesktopIntegrationStatus(req = null, scope = "") {
  const settings = readSecuritySettings();
  const authenticatedWebSession = Boolean(req && hasAuthenticatedWebSession(req));
  const webAccessAuthorized = Boolean(req && (authenticatedWebSession || !authRequired(req)));
  return localDirectDesktopIntegrationDecision({
    enabled:settings.local_direct_desktop_integration_enabled,
    trustedProxyEnabled:settings.trusted_proxy_enabled,
    actualListenHosts:desktopCapabilityRuntimeListenHosts,
    directLoopbackRequest:Boolean(req && isDirectLoopbackRequest(req)),
    authenticatedWebSession,
    webAccessAuthorized,
    scope
  });
}

function isDesktopCapabilityRequest(req, scope = "") {
  if (hasDesktopToken(req)) return true;
  const record = desktopBrowserGrantFromRequest(req);
  const requested = String(scope || "").trim().toLowerCase();
  if (record && (!requested || record.grant.scopes.includes(requested))) return true;
  return localDirectDesktopIntegrationStatus(req, requested).authorized;
}

function createDesktopBrowserGrant(req, scopes = ["xserver", "remote-client"], ttlOrOptions: any = DESKTOP_BROWSER_GRANT_DEFAULT_TTL_MS) {
  if (!isDirectLoopbackRequest(req)) throw new AuthenticationError("桌面集成临时授权只允许本机浏览器申请", 403);
  const session = authenticatedWebSession(req);
  if (!session) throw new AuthenticationError("请先使用 Web 密码或访问 Token 登录，再申请桌面集成授权", 401);
  const normalizedScopes = [...new Set((Array.isArray(scopes) ? scopes : [])
    .map(value => String(value || "").trim().toLowerCase())
    .filter(value => DESKTOP_BROWSER_GRANT_SCOPES.has(value)))];
  if (!normalizedScopes.length) throw new AuthenticationError("没有可授予的桌面集成能力", 400);
  const existing = desktopBrowserGrantFromRequest(req);
  const options = ttlOrOptions && typeof ttlOrOptions === "object" ? ttlOrOptions : {};
  const browserSession = options.browserSession === true || options.mode === "browser-session";
  const requestedDuration = typeof ttlOrOptions === "number"
    ? ttlOrOptions
    : Number(options.ttlMs ?? options.durationMs ?? DESKTOP_BROWSER_GRANT_DEFAULT_TTL_MS);
  const token = existing
    ? String(parseCookies(req.headers.cookie || "")[DESKTOP_BROWSER_GRANT_COOKIE] || "")
    : crypto.randomBytes(32).toString("base64url");
  const createdAt = Date.now();
  const duration = Math.max(
    DESKTOP_BROWSER_GRANT_MIN_TTL_MS,
    Math.min(DESKTOP_BROWSER_GRANT_MAX_TTL_MS, requestedDuration || DESKTOP_BROWSER_GRANT_DEFAULT_TTL_MS)
  );
  const grant = {
    id:existing?.grant.id || crypto.randomUUID(),
    createdAt,
    expiresAt:browserSession
      ? Math.min(session.record.expiresAt, createdAt + DESKTOP_BROWSER_GRANT_SESSION_HARD_TTL_MS)
      : createdAt + duration,
    browserSession,
    scopes:normalizedScopes,
    sessionDigest:desktopBrowserGrantDigest(session.token)
  };
  desktopBrowserGrants.set(existing?.digest || desktopBrowserGrantDigest(token), grant);
  return { token, ...grant, maxAgeSeconds:browserSession ? null : Math.ceil(duration / 1000) };
}

function desktopBrowserGrantCookie(req, token, maxAgeSeconds: number | null = Math.ceil(DESKTOP_BROWSER_GRANT_DEFAULT_TTL_MS / 1000)) {
  const secure = isRequestSecure(req) ? "; Secure" : "";
  const maxAge = maxAgeSeconds === null
    ? ""
    : `; Max-Age=${Math.max(0, Math.min(Math.ceil(DESKTOP_BROWSER_GRANT_MAX_TTL_MS / 1000), Number(maxAgeSeconds) || 0))}`;
  return `${DESKTOP_BROWSER_GRANT_COOKIE}=${encodeURIComponent(token || "")}; HttpOnly; SameSite=Strict; Path=/${maxAge}${secure}`;
}

function desktopBrowserGrantStatus(req) {
  const record = desktopBrowserGrantFromRequest(req);
  if (!record) return { authorized:false, grant_id:"", browser_session:false, scopes:[], expires_at:0, remaining_seconds:0 };
  return {
    authorized:true,
    grant_id:record.grant.id,
    browser_session:record.grant.browserSession,
    scopes:[...record.grant.scopes],
    expires_at:record.grant.expiresAt,
    remaining_seconds:record.grant.expiresAt > 0
      ? Math.max(0, Math.ceil((record.grant.expiresAt - Date.now()) / 1000))
      : 0
  };
}

function revokeDesktopBrowserGrant(req) {
  const record = desktopBrowserGrantFromRequest(req);
  if (!record) return false;
  return desktopBrowserGrants.delete(record.digest);
}

function hasExplicitCredential(req) {
  if (sessionFromRequest(req) || hasDesktopToken(req)) return true;
  const settings = readSecuritySettings();
  const envToken = process.env.TERMA_AUTH_TOKEN || process.env.TUNNELDESK_AUTH_TOKEN || "";
  const provided = bearerToken(req) || String(req.headers["x-terma-token"] || req.headers["x-tunneldesk-token"] || "");
  if (constantTimeSecretEqual(provided, envToken)) return true;
  return Boolean(provided && verifySecret(provided, settings.token_hash, settings.token_salt));
}

function isAuthenticated(req) {
  if (hasDesktopToken(req)) return true;
  if (!authRequired(req)) return true;
  return hasExplicitCredential(req);
}

function login(password, req) {
  const source = requestSourceAddress(req);
  const check = loginLimiter.check(source);
  if (!check.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(check.retryAfterMs / 1000));
    throw new AuthenticationError(`登录尝试过多，请在 ${retryAfterSeconds} 秒后重试`, 429, retryAfterSeconds);
  }
  const settings = readSecuritySettings();
  const envToken = process.env.TERMA_AUTH_TOKEN || process.env.TUNNELDESK_AUTH_TOKEN || "";
  const passwordAccepted = verifySecret(password, settings.password_hash, settings.password_salt);
  const tokenAccepted = constantTimeSecretEqual(password, envToken) || verifySecret(password, settings.token_hash, settings.token_salt);
  if (!hasConfiguredCredential(settings)) throw new AuthenticationError("尚未设置 Web 密码或访问 Token", 400);
  if (!passwordAccepted && !tokenAccepted) {
    const result = loginLimiter.recordFailure(source);
    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      throw new AuthenticationError(`密码或 Token 不正确，登录已暂时锁定 ${retryAfterSeconds} 秒`, 429, retryAfterSeconds);
    }
    throw new AuthenticationError("密码或 Token 不正确", 401);
  }
  loginLimiter.recordSuccess(source);
  return sessions.create();
}

function createSession() {
  return sessions.create();
}

function logout(req) {
  revokeDesktopBrowserGrant(req);
  const token = parseCookies(req.headers.cookie || "").td_session;
  if (token) sessions.delete(token);
}

function sessionCookie(req, token, maxAge = null) {
  const secure = isRequestSecure(req) ? "; Secure" : "";
  const effectiveMaxAge = maxAge === null || typeof maxAge === "undefined"
    ? Math.floor(sessions.options.ttlMs / 1000)
    : Math.max(0, Number(maxAge) || 0);
  return `td_session=${encodeURIComponent(token || "")}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${effectiveMaxAge}${secure}`;
}

function setDesktopAuthToken(token = "") {
  const next = String(token || "").trim();
  if (next !== desktopAuthToken) desktopBrowserGrants.clear();
  desktopAuthToken = next;
  return desktopAuthToken;
}

function isDesktopRequest(req) {
  return hasDesktopToken(req);
}

function requestHost(req) {
  return parseHostAuthority(req.headers.host || "");
}

function hostMatchesAllowed(host, allowed) {
  const candidate = parseHostAuthority(host);
  const entry = parseHostAuthority(allowed);
  if (!candidate || !entry || candidate.hostname !== entry.hostname) return false;
  return !entry.port || entry.port === candidate.port;
}

function hostAllowed(req) {
  const host = requestHost(req);
  if (!host) return false;
  const settings = readSecuritySettings();
  if (settings.allowed_hosts.some(item => hostMatchesAllowed(formatHostAuthority(host), item))) return true;
  return isLocalHostAuthority(req);
}

function sameOrigin(req, options: any = {}) {
  if (!hostAllowed(req)) return false;
  const origin = req.headers.origin;
  if (!origin) return options.websocket ? (isDirectLoopbackRequest(req) || hasExplicitCredential(req)) : true;
  if (String(origin).trim().toLowerCase() === "null") return false;
  try {
    const parsed = new URL(String(origin));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    const protocol = requestProtocol(req);
    if (parsed.protocol !== protocol) return false;
    const originHost = parseHostAuthority(parsed.host);
    const requestHostValue = requestHost(req);
    if (!originHost || !requestHostValue) return false;
    const originPort = originHost.port || (parsed.protocol === "https:" ? 443 : 80);
    const requestPort = requestHostValue.port || (protocol === "https:" ? 443 : 80);
    return originHost.hostname === requestHostValue.hostname && originPort === requestPort;
  } catch {
    return false;
  }
}

function webSocketOriginAllowed(req) {
  return sameOrigin(req, { websocket: true });
}

function secureHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; script-src-attr 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function securityDiagnostics() {
  cleanupDesktopBrowserGrants();
  return {
    sessions: sessions.size(),
    login_sources: loginLimiter.size(),
    desktop_browser_grants:desktopBrowserGrants.size
  };
}

function applySessionManagementSettings(settings) {
  sessions.configure({
    ttlMs: normalizeBoundedInteger(settings?.session_ttl_minutes, DEFAULT_SESSION_TTL_MINUTES, SESSION_LIMITS.ttl_minutes) * 60 * 1000,
    maxSessions: normalizeBoundedInteger(settings?.session_max_sessions, DEFAULT_SESSION_MAX_SESSIONS, SESSION_LIMITS.max_sessions)
  });
  loginLimiter.configure({
    maxFailures: Number(settings?.login_max_failures || 5),
    windowMs: Number(settings?.login_window_seconds || 5 * 60) * 1000,
    lockMs: Number(settings?.login_lock_seconds || 5 * 60) * 1000,
    globalMaxFailures: settings?.global_login_protection_enabled === false ? 0 : Number(settings?.global_login_max_failures || 50),
    globalWindowMs: Number(settings?.global_login_window_seconds || 5 * 60) * 1000,
    globalLockMs: Number(settings?.global_login_lock_seconds || 60) * 1000
  });
  const intervalMs = normalizeBoundedInteger(
    settings?.session_cleanup_minutes,
    DEFAULT_SESSION_CLEANUP_MINUTES,
    SESSION_LIMITS.cleanup_minutes
  ) * 60 * 1000;
  if (securityCleanupTimer && intervalMs === securityCleanupIntervalMs) return;
  if (securityCleanupTimer) clearInterval(securityCleanupTimer);
  securityCleanupIntervalMs = intervalMs;
  securityCleanupTimer = setInterval(() => {
    sessions.cleanup();
    loginLimiter.cleanup();
    cleanupDesktopBrowserGrants();
  }, intervalMs);
  securityCleanupTimer.unref?.();
}

applySessionManagementSettings(readSecuritySettings());

module.exports = {
  AuthenticationError,
  authRequired,
  createSession,
  createDesktopBrowserGrant,
  desktopBrowserGrantCookie,
  desktopBrowserGrantStatus,
  isAuthenticated,
  isDesktopRequest,
  isDesktopCapabilityRequest,
  localDirectDesktopIntegrationStatus,
  hasAuthenticatedWebSession,
  isLocalRequest,
  isDirectLoopbackRequest,
  hostAllowed,
  isRequestSecure,
  login,
  logout,
  publicSecuritySettings,
  publicAuthStatus,
  requestAuthenticationBinding,
  readSecuritySettings,
  requestSourceAddress,
  resetWebAccessSecurity,
  revokeDesktopBrowserGrant,
  sameOrigin,
  webSocketOriginAllowed,
  secureHeaders,
  securityDiagnostics,
  sessionCookie,
  setDesktopAuthToken,
  setDesktopCapabilityRuntimeListenHosts,
  setPassword,
  setToken,
  updateSecurityOptions,
  verifySecret,
  writeSecuritySettings
};
