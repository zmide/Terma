const net = require("node:net");

const LOCAL_DIRECT_DESKTOP_SCOPES = Object.freeze(["xserver", "remote-client"]);
const LOCAL_DIRECT_DESKTOP_SCOPE_SET = new Set(LOCAL_DIRECT_DESKTOP_SCOPES);

function normalizeListenHost(value) {
  const host = String(value || "").trim().toLowerCase().split("%")[0];
  return host.startsWith("::ffff:") ? host.slice(7) : host;
}

function isLoopbackListenHost(value) {
  const host = normalizeListenHost(value);
  if (host === "localhost" || host === "::1") return true;
  if (net.isIP(host) !== 4) return false;
  return Number(host.split(".")[0]) === 127;
}

function normalizeActualListenHosts(value) {
  const hosts = (Array.isArray(value) ? value : [value])
    .flatMap(item => String(item || "").split(/[\s,]+/))
    .map(normalizeListenHost)
    .filter(Boolean);
  return [...new Set(hosts)];
}

function localDirectDesktopIntegrationDecision(options: any = {}) {
  const actualListenHosts = normalizeActualListenHosts(options.actualListenHosts);
  const requestedScope = String(options.scope || "").trim().toLowerCase();
  const listenLoopbackOnly = actualListenHosts.length > 0 && actualListenHosts.every(isLoopbackListenHost);
  const base = {
    enabled:Boolean(options.enabled),
    available:false,
    authorized:false,
    scopes:[...LOCAL_DIRECT_DESKTOP_SCOPES],
    actual_listen_hosts:actualListenHosts,
    listen_loopback_only:listenLoopbackOnly,
    direct_loopback_request:Boolean(options.directLoopbackRequest),
    web_session_authenticated:Boolean(options.authenticatedWebSession),
    web_access_authorized:Boolean(options.webAccessAuthorized),
    blocked_reason:""
  };
  if (!base.enabled) return {...base, blocked_reason:"disabled"};
  if (options.trustedProxyEnabled) return {...base, blocked_reason:"trusted-proxy-enabled"};
  if (!actualListenHosts.length) return {...base, blocked_reason:"listen-state-unavailable"};
  if (!listenLoopbackOnly) return {...base, blocked_reason:"non-loopback-listener"};
  if (!options.directLoopbackRequest) return {...base, blocked_reason:"request-not-direct-loopback"};
  if (!options.webAccessAuthorized) return {...base, available:true, blocked_reason:"web-auth-required"};
  if (requestedScope && !LOCAL_DIRECT_DESKTOP_SCOPE_SET.has(requestedScope)) {
    return {...base, available:true, blocked_reason:"scope-not-allowed"};
  }
  return {...base, available:true, authorized:true};
}

module.exports = {
  LOCAL_DIRECT_DESKTOP_SCOPES,
  isLoopbackListenHost,
  localDirectDesktopIntegrationDecision,
  normalizeActualListenHosts
};
