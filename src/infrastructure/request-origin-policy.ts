import net from "node:net";

export type OriginFailure = "request_origin_forbidden" | "request_origin_protocol_mismatch";
type OriginReason = "invalid_origin" | "hostname_mismatch" | "port_mismatch" | "protocol_mismatch";
interface OriginRejection {
  code: OriginFailure;
  params: {reason: OriginReason; request_host?: string; source_origin?: string};
}

interface HostAuthority { hostname: string; port: number | null }
interface OriginPolicyInput {
  origin: unknown;
  host: HostAuthority | null;
  protocol: string;
  checkProtocol: boolean;
  parseAuthority: (value: string) => HostAuthority | null;
}

// Bare hosts explicitly approve HTTPS on any port. Legacy complete origins keep
// their exact port scope. Never infer grants from Origin or forwarding headers.
export function validateFnosRelayOrigins(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.trim().split(/[\s,]+/).filter(Boolean) : null;
  if (!entries || entries.length > 16) throw new Error("Enter up to 16 relay domains or IPs");
  const origins = entries.map(entry => {
    if (typeof entry !== "string" || entry.length > 512) throw new Error("Invalid HTTPS relay origin");
    const exactOrigin = /^https:\/\//i.test(entry);
    const bareIpv6 = net.isIP(entry) === 6;
    if (!exactOrigin && (/[\s/\\@?#%*]/.test(entry)
      || (entry.includes(":") && !bareIpv6 && !/^\[[\da-f:]+\]$/i.test(entry)))) {
      throw new Error("Enter a domain or IP without a scheme, port or path");
    }
    let parsed: URL;
    try { parsed = new URL(exactOrigin ? entry : `https://${bareIpv6 ? `[${entry}]` : entry}`); }
    catch { throw new Error("Invalid HTTPS relay origin"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/"
      || parsed.search || parsed.hash || parsed.port === "0" || !parsed.hostname || parsed.hostname.includes("*")
      || (exactOrigin && !/^https:\/\/[^/\\\s?#]+\/?$/i.test(entry))) throw new Error("Use a trusted HTTPS relay without a path, credentials or wildcard");
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!net.isIP(hostname) && (hostname.length > 253
      || hostname.split(".").some(label => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label)))) {
      throw new Error("Invalid relay hostname");
    }
    return exactOrigin ? parsed.origin : parsed.hostname.replace(/\.$/, "");
  });
  return [...new Set(origins)];
}

export function fnosRelayOriginAllowed(origin: unknown, grants: unknown): boolean {
  if (typeof origin !== "string") return false;
  try {
    const parsed = new URL(origin);
    // Origin is a serialized origin, never a URL with a path or credentials.
    if (parsed.protocol !== "https:" || parsed.port === "0" || parsed.origin !== origin) return false;
    const entries = validateFnosRelayOrigins(grants);
    return entries.includes(origin) || entries.includes(parsed.hostname.replace(/\.$/, ""));
  } catch { return false; }
}

// Only the scheme comparison is optional. Host and public port remain bound to
// the browser origin; forwarding headers never gain trust through this option.
export function inspectRequestOrigin(input: OriginPolicyInput): OriginRejection | null {
  const params: OriginRejection['params'] = {reason:"invalid_origin"};
  if (input.host) params.request_host = `${input.host.hostname}${input.host.port ? `:${input.host.port}` : ""}`;
  const reject = (reason: OriginReason): OriginRejection => ({
    code:reason === "protocol_mismatch" ? "request_origin_protocol_mismatch" : "request_origin_forbidden",
    params:{...params, reason}
  });
  if (typeof input.origin !== "string" || !input.origin || !input.host) return reject("invalid_origin");
  try {
    const parsed = new URL(input.origin);
    if (!["http:", "https:"].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return reject("invalid_origin");
    const originHost = input.parseAuthority(parsed.host);
    if (!originHost) return reject("invalid_origin");
    // Report only a parsed HTTP origin: never reflect credentials, paths or queries.
    params.source_origin = parsed.origin;
    if (originHost.hostname !== input.host.hostname) return reject("hostname_mismatch");
    const originPort = originHost.port || (parsed.protocol === "https:" ? 443 : 80);
    const publicProtocol = input.checkProtocol ? input.protocol : parsed.protocol;
    const requestPort = input.host.port || (publicProtocol === "https:" ? 443 : 80);
    // Report a scheme mismatch only after rejecting other origin differences.
    if (input.checkProtocol && parsed.protocol !== input.protocol) {
      const matchingPublicPort = input.host.port || (parsed.protocol === "https:" ? 443 : 80);
      return reject(matchingPublicPort === originPort ? "protocol_mismatch" : "port_mismatch");
    }
    return originPort === requestPort ? null : reject("port_mismatch");
  } catch { return reject("invalid_origin"); }
}

export function requestOriginFailure(input: OriginPolicyInput): OriginFailure | null {
  return inspectRequestOrigin(input)?.code || null;
}
