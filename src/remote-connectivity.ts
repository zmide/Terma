const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns");
const { normalizeRemoteHost } = require("./remote-host");

const TCP_PROTOCOLS = new Set(["rdp", "vnc"]);

function probeTcpEndpoint(host: unknown, port: unknown, timeoutMs = 2200): Promise<{ok:boolean; error:string}> {
  return new Promise(resolve => {
    let settled = false;
    const socket = net.createConnection({host:normalizeRemoteHost(host), port:Number(port || 0)});
    const finish = (ok: boolean, error = "") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ok, error:String(error || "")});
    };
    socket.setTimeout(timeoutMs, () => finish(false, "连接超时"));
    socket.once("connect", () => finish(true));
    socket.once("error", (error: any) => finish(false, error?.message || "连接失败"));
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

function probeXdmcpEndpoint(host: unknown, port: unknown, timeoutMs = 2200): Promise<{ok:boolean; responded:boolean; response:string; error:string}> {
  return new Promise(resolve => {
    const targetHost = normalizeRemoteHost(host);
    const targetPort = Number(port || 177);
    if (!targetHost || !Number.isSafeInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      resolve({ok:false, responded:false, response:"", error:"XDMCP 目标无效"});
      return;
    }
    dns.lookup(targetHost, (lookupError: any, address: string, family: number) => {
      if (lookupError || !address) {
        resolve({ok:false, responded:false, response:"", error:lookupError?.message || "主机解析失败"});
        return;
      }
      const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");
      let settled = false;
      const finish = (result: {ok:boolean; responded:boolean; response:string; error:string}) => {
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
        error:"未收到 XDMCP Query 响应"
      }), timeoutMs);
      socket.once("error", (error: any) => finish({ok:false, responded:false, response:"", error:error?.message || "XDMCP UDP 探测失败"}));
      socket.once("message", (message: Buffer) => {
        if (message.length < 6) return finish({ok:false, responded:true, response:"invalid", error:"收到无效的 XDMCP 响应"});
        const version = message.readUInt16BE(0);
        const opcode = message.readUInt16BE(2);
        const response = xdmcpResponseLabel(opcode);
        if (version !== 1) return finish({ok:false, responded:true, response, error:`收到不支持的 XDMCP 版本 ${version}`});
        if (opcode === 5) return finish({ok:true, responded:true, response, error:""});
        if (opcode === 6) return finish({ok:false, responded:true, response, error:"XDMCP 服务已响应，但当前拒绝图形登录"});
        return finish({ok:false, responded:true, response, error:`收到非预期的 XDMCP 响应 ${opcode}`});
      });
      socket.connect(targetPort, address, () => socket.send(xdmcpQueryPacket(), error => {
        if (error) finish({ok:false, responded:false, response:"", error:error.message || "XDMCP Query 发送失败"});
      }));
    });
  });
}

async function inspectRemoteProfileConnectivity(profile: any) {
  const protocol = String(profile?.protocol || "").toLowerCase();
  const host = normalizeRemoteHost(profile?.host);
  const port = Number(profile?.port || (protocol === "rdp" ? 3389 : protocol === "vnc" ? 5900 : protocol === "xdmcp" ? 177 : 0));
  if (protocol === "xdmcp") {
    if (String(profile?.options?.mode || "query").toLowerCase() === "broadcast") {
      return {protocol, host, port, supported:false, method:"xdmcp-broadcast", ok:false, responded:false, response:"", error:"XDMCP 广播模式不适用单主机 Query 探测"};
    }
    const result = await probeXdmcpEndpoint(host, port);
    return {protocol, host, port, supported:true, method:"xdmcp-query", ...result};
  }
  if (!TCP_PROTOCOLS.has(protocol)) {
    return {
      protocol,
      host,
      port,
      supported:false,
      method:"none",
      ok:false,
      error:"当前协议不支持端口探测"
    };
  }
  const result = await probeTcpEndpoint(host, port);
  return {protocol, host, port, supported:true, method:"tcp", ...result};
}

module.exports = { inspectRemoteProfileConnectivity, probeTcpEndpoint, probeXdmcpEndpoint, xdmcpQueryPacket };
