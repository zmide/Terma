const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { LoginRateLimiter, SessionStore } = require("./auth-protection");

const SECURITY_FILE = path.join(DATA_DIR, "security.json");
const DEFAULT_SESSION_TTL_MINUTES = 12 * 60;
const DEFAULT_SESSION_MAX_SESSIONS = 1000;
const DEFAULT_SESSION_CLEANUP_MINUTES = 10;
const DESKTOP_TOKEN_COOKIE = "td_desktop";
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
    encryption_salt: "",
    encryption_check: "",
    notification_mode: "on",
    secure_cookie_mode: "auto",
    trusted_proxy_enabled: false,
    trusted_proxy_addresses: [],
    allowed_hosts: [],
    session_ttl_minutes: DEFAULT_SESSION_TTL_MINUTES,
    session_max_sessions: DEFAULT_SESSION_MAX_SESSIONS,
    session_cleanup_minutes: DEFAULT_SESSION_CLEANUP_MINUTES,
    updated_at: Date.now()
  };
}

function normalizeBoundedInteger(value, fallback, limits) {
  const number = Number(value);
  return Number.isInteger(number) && number >= limits.min && number <= limits.max ? number : fallback;
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

function readSecuritySettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(SECURITY_FILE, "utf8"));
    return {
      ...defaultSettings(),
      ...stored,
      secure_cookie_mode: ["auto", "always", "never"].includes(String(stored?.secure_cookie_mode)) ? String(stored.secure_cookie_mode) : "auto",
      trusted_proxy_addresses: normalizeTrustedProxyAddresses(stored?.trusted_proxy_addresses),
      allowed_hosts: normalizeAllowedHosts(stored?.allowed_hosts),
      session_ttl_minutes: normalizeBoundedInteger(stored?.session_ttl_minutes, DEFAULT_SESSION_TTL_MINUTES, SESSION_LIMITS.ttl_minutes),
      session_max_sessions: normalizeBoundedInteger(stored?.session_max_sessions, DEFAULT_SESSION_MAX_SESSIONS, SESSION_LIMITS.max_sessions),
      session_cleanup_minutes: normalizeBoundedInteger(stored?.session_cleanup_minutes, DEFAULT_SESSION_CLEANUP_MINUTES, SESSION_LIMITS.cleanup_minutes)
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
    notification_mode: ["on", "muted", "off"].includes(String(settings.notification_mode)) ? settings.notification_mode : "on",
    secure_cookie_mode: settings.secure_cookie_mode,
    trusted_proxy_enabled: Boolean(settings.trusted_proxy_enabled),
    trusted_proxy_addresses: settings.trusted_proxy_addresses,
    allowed_hosts: settings.allowed_hosts,
    login_protection: {
      max_failures: loginLimiter.options.maxFailures,
      window_seconds: Math.floor(loginLimiter.options.windowMs / 1000),
      lock_seconds: Math.floor(loginLimiter.options.lockMs / 1000)
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

function writeSecuritySettings(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const merged = { ...readSecuritySettings(), ...next, updated_at: Date.now() };
  fs.writeFileSync(SECURITY_FILE, JSON.stringify(merged, null, 2));
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
  if (["lan", "always", "off"].includes(String(data.auth_mode || ""))) next.auth_mode = String(data.auth_mode);
  if (typeof data.lan_auth_enabled !== "undefined") next.lan_auth_enabled = Boolean(data.lan_auth_enabled);
  if (typeof data.allow_disable_lan_auth !== "undefined") next.allow_disable_lan_auth = Boolean(data.allow_disable_lan_auth);
  if (["on", "muted", "off"].includes(String(data.notification_mode || ""))) next.notification_mode = String(data.notification_mode);
  if (["auto", "always", "never"].includes(String(data.secure_cookie_mode || ""))) next.secure_cookie_mode = String(data.secure_cookie_mode);
  if (typeof data.trusted_proxy_enabled !== "undefined") next.trusted_proxy_enabled = Boolean(data.trusted_proxy_enabled);
  if (typeof data.trusted_proxy_addresses !== "undefined") next.trusted_proxy_addresses = normalizeTrustedProxyAddresses(data.trusted_proxy_addresses);
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
    allowed_hosts: [],
    session_ttl_minutes: DEFAULT_SESSION_TTL_MINUTES,
    session_max_sessions: DEFAULT_SESSION_MAX_SESSIONS,
    session_cleanup_minutes: DEFAULT_SESSION_CLEANUP_MINUTES
  });
  sessions.clear();
  loginLimiter.clear();
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
  if (settings.auth_mode === "off") return false;
  if (settings.auth_mode === "always") return true;
  if (isTrustedProxyRequest(req, settings)) return true;
  if (isLocalRequest(req) && (hasProxyForwardingHeaders(req) || !isLocalHostAuthority(req))) return true;
  if (isLocalRequest(req) && settings.lan_auth_enabled && hasConfiguredCredential(settings)) return true;
  return Boolean(settings.lan_auth_enabled) && (isLanListening(req) || !isLocalRequest(req));
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
  desktopAuthToken = String(token || "").trim();
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
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function securityDiagnostics() {
  return {
    sessions: sessions.size(),
    login_sources: loginLimiter.size()
  };
}

function applySessionManagementSettings(settings) {
  sessions.configure({
    ttlMs: normalizeBoundedInteger(settings?.session_ttl_minutes, DEFAULT_SESSION_TTL_MINUTES, SESSION_LIMITS.ttl_minutes) * 60 * 1000,
    maxSessions: normalizeBoundedInteger(settings?.session_max_sessions, DEFAULT_SESSION_MAX_SESSIONS, SESSION_LIMITS.max_sessions)
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
  }, intervalMs);
  securityCleanupTimer.unref?.();
}

applySessionManagementSettings(readSecuritySettings());

module.exports = {
  AuthenticationError,
  authRequired,
  createSession,
  isAuthenticated,
  isDesktopRequest,
  isLocalRequest,
  isDirectLoopbackRequest,
  hostAllowed,
  isRequestSecure,
  login,
  logout,
  publicSecuritySettings,
  readSecuritySettings,
  requestSourceAddress,
  resetWebAccessSecurity,
  sameOrigin,
  webSocketOriginAllowed,
  secureHeaders,
  securityDiagnostics,
  sessionCookie,
  setDesktopAuthToken,
  setPassword,
  setToken,
  updateSecurityOptions,
  verifySecret,
  writeSecuritySettings
};
