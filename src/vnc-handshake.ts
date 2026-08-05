const net = require("node:net");

const RFB_BANNER_LENGTH = 12;
const VNC_HANDSHAKE_TIMEOUT_MS = 3500;

function handshakeError(message, code) {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function connectVncSocket(host, port, timeoutMs = VNC_HANDSHAKE_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host:String(host || ""), port:Number(port || 5900)});
    let pending = Buffer.alloc(0);
    let settled = false;
    const finish = (result = null, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      if (error) {
        try { socket.destroy(); } catch {}
        reject(error);
      } else resolve(result);
    };
    const onError = error => finish(null, error);
    const onClose = () => finish(null, handshakeError("VNC 服务在返回 RFB 握手前关闭了连接", "EVNCCLOSED"));
    const onData = chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < RFB_BANNER_LENGTH) return;
      const banner = pending.subarray(0, RFB_BANNER_LENGTH);
      if (!/^RFB \d{3}\.\d{3}\n$/.test(banner.toString("ascii"))) {
        return finish(null, handshakeError("远端端口没有返回有效的 VNC RFB 握手", "EVNCBANNER"));
      }
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
      socket.pause();
      finish({socket, banner, initial_data:pending});
    };
    const timer = setTimeout(() => finish(null, handshakeError("VNC RFB 握手超时", "EVNCHANDSHAKETIMEOUT")), Math.max(250, Number(timeoutMs || VNC_HANDSHAKE_TIMEOUT_MS)));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

module.exports = {
  RFB_BANNER_LENGTH,
  VNC_HANDSHAKE_TIMEOUT_MS,
  connectVncSocket
};
