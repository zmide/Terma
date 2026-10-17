export type OriginFailure = "request_origin_forbidden" | "request_origin_protocol_mismatch";

interface HostAuthority { hostname: string; port: number | null }
interface OriginPolicyInput {
  origin: unknown;
  host: HostAuthority | null;
  protocol: string;
  checkProtocol: boolean;
  parseAuthority: (value: string) => HostAuthority | null;
}

// Only the scheme comparison is optional. Host and public port remain bound to
// the browser origin; forwarding headers never gain trust through this option.
export function requestOriginFailure(input: OriginPolicyInput): OriginFailure | null {
  if (typeof input.origin !== "string" || !input.origin || !input.host) return "request_origin_forbidden";
  try {
    const parsed = new URL(input.origin);
    if (!["http:", "https:"].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "request_origin_forbidden";
    const originHost = input.parseAuthority(parsed.host);
    if (!originHost || originHost.hostname !== input.host.hostname) return "request_origin_forbidden";
    const originPort = originHost.port || (parsed.protocol === "https:" ? 443 : 80);
    const publicProtocol = input.checkProtocol ? input.protocol : parsed.protocol;
    const requestPort = input.host.port || (publicProtocol === "https:" ? 443 : 80);
    // Report a scheme mismatch only after rejecting other origin differences.
    if (input.checkProtocol && parsed.protocol !== input.protocol) {
      const matchingPublicPort = input.host.port || (parsed.protocol === "https:" ? 443 : 80);
      return matchingPublicPort === originPort ? "request_origin_protocol_mismatch" : "request_origin_forbidden";
    }
    return originPort === requestPort ? null : "request_origin_forbidden";
  } catch { return "request_origin_forbidden"; }
}
