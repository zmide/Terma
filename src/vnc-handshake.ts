const net = require("node:net");

const RFB_BANNER_LENGTH = 12;
const VNC_HANDSHAKE_TIMEOUT_MS = 3500;
const VNC_HANDSHAKE_RETRY_DELAY_MS = 220;
// The banner is only accepted through the real WebSocket VNC session. Do not
// delay forwarding it: RealVNC may close a client that does not answer with
// its protocol version within a very short window.
const VNC_BANNER_STABILITY_MS = 0;

const TRANSIENT_HANDSHAKE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EVNCCLOSED",
  "EVNCHANDSHAKETIMEOUT"
]);

function handshakeError(message, code) {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function connectVncSocketOnce(host, port, timeoutMs = VNC_HANDSHAKE_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host:String(host || ""), port:Number(port || 5900)});
    let pending = Buffer.alloc(0);
    let settled = false;
    let bannerReceived = false;
    let handshakeTimer: any = null;
    let stabilityTimer: any = null;
    const finish = (result = null, error = null) => {
      if (settled) return;
      settled = true;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      if (error) {
        try { socket.destroy(); } catch {}
        reject(error);
      } else resolve(result);
    };
    const onError = error => finish(null, error);
    const onClose = () => finish(null, handshakeError(
      bannerReceived
        ? "VNC 服务在 RFB 握手开始后立即关闭了连接"
        : "VNC 服务在返回 RFB 握手前关闭了连接",
      bannerReceived ? "EVNCPREMATURECLOSE" : "EVNCCLOSED"
    ));
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
      bannerReceived = true;
      if (VNC_BANNER_STABILITY_MS > 0) {
        stabilityTimer = setTimeout(() => finish({socket, banner, initial_data:pending}), VNC_BANNER_STABILITY_MS);
      } else {
        finish({socket, banner, initial_data:pending});
      }
    };
    handshakeTimer = setTimeout(() => finish(null, handshakeError("VNC RFB 握手超时", "EVNCHANDSHAKETIMEOUT")), Math.max(250, Number(timeoutMs || VNC_HANDSHAKE_TIMEOUT_MS)));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/**
 * VNC services commonly open TCP before their RFB listener is ready. A single
 * short retry removes that startup race without masking a wrong protocol or
 * extending permanent failures for a long time.
 */
async function connectVncSocket(host, port, timeoutMs = VNC_HANDSHAKE_TIMEOUT_MS, options: any = {}): Promise<any> {
  const retries = Math.max(0, Math.min(2, Math.round(Number(options?.retries ?? 1))));
  const retryDelayMs = Math.max(0, Math.min(1000, Math.round(Number(options?.retryDelayMs ?? VNC_HANDSHAKE_RETRY_DELAY_MS))));
  let lastError: any = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await connectVncSocketOnce(host, port, timeoutMs);
    } catch (error) {
      lastError = error;
      const code = String(error?.code || "");
      if (attempt >= retries || !TRANSIENT_HANDSHAKE_CODES.has(code)) throw error;
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError || new Error("VNC RFB handshake failed");
}

module.exports = {
  RFB_BANNER_LENGTH,
  VNC_BANNER_STABILITY_MS,
  VNC_HANDSHAKE_RETRY_DELAY_MS,
  VNC_HANDSHAKE_TIMEOUT_MS,
  connectVncSocket
};
