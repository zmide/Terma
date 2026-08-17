const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns");
const { normalizeRemoteHost } = require("./remote-host");

const TCP_PROTOCOLS = new Set(["rdp"]);

type ConnectivityReasonParams = Record<string, string | number | boolean>;

function connectivityReason(reasonCode: string, reasonParams: ConnectivityReasonParams = {}, rawError: unknown = "") {
  const normalizedRawError = String(rawError || "");
  return {
    reason_code:reasonCode,
    reason_params:reasonParams,
    raw_error:normalizedRawError,
    // Compatibility for callers that still read `error`: fixed UI copy never belongs here.
    error:normalizedRawError
  };
}

function probeTcpEndpoint(host: unknown, port: unknown, timeoutMs = 2200): Promise<{ok:boolean; reason_code:string; reason_params:ConnectivityReasonParams; raw_error:string; error:string}> {
  return new Promise(resolve => {
    let targetHost = "";
    try {
      targetHost = normalizeRemoteHost(host);
    } catch {
      resolve({ok:false, ...connectivityReason("tcp_target_invalid")});
      return;
    }
    const targetPort = Number(port || 0);
    if (!targetHost || !Number.isSafeInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({ok:false, ...connectivityReason("tcp_target_invalid")});
      return;
    }
    let settled = false;
    let socket: any;
    const finish = (ok: boolean, reasonCode: string, reasonParams: ConnectivityReasonParams = {}, rawError: unknown = "") => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch {}
      resolve({ok, ...connectivityReason(reasonCode, reasonParams, rawError)});
    };
    try {
      socket = net.createConnection({host:targetHost, port:targetPort});
    } catch (error: any) {
      finish(false, "tcp_failed", {}, error?.message);
      return;
    }
    socket.setTimeout(timeoutMs, () => finish(false, "tcp_timeout"));
    socket.once("connect", () => finish(true, "tcp_reachable"));
    socket.once("error", (error: any) => finish(false, "tcp_failed", {}, error?.message));
  });
}

function xdmcpQueryPacket() {
  return Buffer.from([0, 1, 0, 2, 0, 1, 0]);
}

function xdmcpResponseLabel(opcode: number) {
  if (opcode === 5) return "willing";
  if (opcode === 6) return "unwilling";
  return `opcode-${opcode}`;
}

function probeXdmcpEndpoint(host: unknown, port: unknown, timeoutMs = 2200): Promise<{ok:boolean; responded:boolean; response:string; reason_code:string; reason_params:ConnectivityReasonParams; raw_error:string; error:string}> {
  return new Promise(resolve => {
    let targetHost = "";
    try {
      targetHost = normalizeRemoteHost(host);
    } catch {
      resolve({ok:false, responded:false, response:"", ...connectivityReason("xdmcp_target_invalid")});
      return;
    }
    const targetPort = Number(port || 177);
    if (!targetHost || !Number.isSafeInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({ok:false, responded:false, response:"", ...connectivityReason("xdmcp_target_invalid")});
      return;
    }
    dns.lookup(targetHost, (lookupError: any, address: string, family: number) => {
      if (lookupError || !address) {
        resolve({ok:false, responded:false, response:"", ...connectivityReason("host_resolution_failed", {}, lookupError?.message)});
        return;
      }
      const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");
      let settled = false;
      const finish = (result: {ok:boolean; responded:boolean; response:string; reason_code:string; reason_params:ConnectivityReasonParams; raw_error:string; error:string}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        resolve(result);
      };
      const timer = setTimeout(() => finish({
        ok:false,
        responded:false,
        response:"",
        ...connectivityReason("xdmcp_no_response")
      }), timeoutMs);
      socket.once("error", (error: any) => finish({ok:false, responded:false, response:"", ...connectivityReason("xdmcp_udp_failed", {}, error?.message)}));
      socket.once("message", (message: Buffer) => {
        if (message.length < 6) return finish({ok:false, responded:true, response:"invalid", ...connectivityReason("xdmcp_response_invalid")});
        const version = message.readUInt16BE(0);
        const opcode = message.readUInt16BE(2);
        const response = xdmcpResponseLabel(opcode);
        if (version !== 1) return finish({ok:false, responded:true, response, ...connectivityReason("xdmcp_version_unsupported", {version})});
        if (opcode === 5) return finish({ok:true, responded:true, response, ...connectivityReason("xdmcp_willing")});
        if (opcode === 6) return finish({ok:false, responded:true, response, ...connectivityReason("xdmcp_login_rejected")});
        return finish({ok:false, responded:true, response, ...connectivityReason("xdmcp_opcode_unexpected", {opcode})});
      });
      socket.connect(targetPort, address, () => socket.send(xdmcpQueryPacket(), error => {
        if (error) finish({ok:false, responded:false, response:"", ...connectivityReason("xdmcp_send_failed", {}, error.message)});
      }));
    });
  });
}

async function inspectRemoteProfileConnectivity(profile: any) {
  const protocol = String(profile?.protocol || "").toLowerCase();
  let host = "";
  let hostValid = true;
  try {
    host = normalizeRemoteHost(profile?.host);
  } catch {
    host = String(profile?.host || "").trim();
    hostValid = false;
  }
  const port = Number(profile?.port || (protocol === "rdp" ? 3389 : protocol === "vnc" ? 5900 : protocol === "xdmcp" ? 177 : 0));
  if (protocol === "xdmcp") {
    if (String(profile?.options?.mode || "query").toLowerCase() === "broadcast") {
      return {protocol, host, port, supported:false, method:"xdmcp-broadcast", ok:false, responded:false, response:"", ...connectivityReason("xdmcp_broadcast_probe_unsupported")};
    }
    if (!hostValid) {
      return {protocol, host, port, supported:true, method:"xdmcp-query", ok:false, responded:false, response:"", ...connectivityReason("xdmcp_target_invalid")};
    }
    const result = await probeXdmcpEndpoint(host, port);
    return {protocol, host, port, supported:true, method:"xdmcp-query", ...result};
  }
  if (protocol === "vnc") {
    // A standalone TCP/RFB preflight is not harmless: authenticated VNC
    // servers such as TigerVNC count it as an unauthenticated attempt and can
    // temporarily blacklist the Terma host. The real VNC client connection is
    // therefore the connectivity check; SSH diagnostics remain available for
    // managed Linux profiles without touching the RFB listener.
    return {
      protocol,
      host,
      port,
      supported:false,
      method:"authenticated-vnc-session",
      ok:false,
      ...connectivityReason("vnc_authenticated_session_required")
    };
  }
  if (!TCP_PROTOCOLS.has(protocol)) {
    return {
      protocol,
      host,
      port,
      supported:false,
      method:"none",
      ok:false,
      ...connectivityReason("protocol_probe_unsupported", {protocol})
    };
  }
  if (!hostValid) {
    return {protocol, host, port, supported:true, method:"tcp", ok:false, ...connectivityReason("tcp_target_invalid")};
  }
  const result = await probeTcpEndpoint(host, port);
  return {protocol, host, port, supported:true, method:"tcp", ...result};
}

module.exports = { inspectRemoteProfileConnectivity, probeTcpEndpoint, probeXdmcpEndpoint, xdmcpQueryPacket };
