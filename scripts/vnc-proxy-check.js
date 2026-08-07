const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-vnc-proxy-"));
process.env.TERMA_DATA_DIR = temporary;
let db;
let proxy;
let fixture;
let gateway;

function maskedBinary(payload) {
  const body = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  const encoded = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]));
  return Buffer.concat([Buffer.from([0x82, 0x80 | body.length]), mask, encoded]);
}

function serverBinaryPayload(frame) {
  assert.equal(frame[0] & 0x0f, 2);
  const length = frame[1] & 0x7f;
  assert.ok(length < 126);
  return frame.subarray(2, 2 + length);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function run() {
  db = require("../dist/db");
  proxy = require("../dist/vnc-proxy");
  let targetReceivedResolve;
  const targetReceived = new Promise(resolve => { targetReceivedResolve = resolve; });
  fixture = net.createServer(socket => {
    socket.write("RFB 003.008\n");
    socket.once("data", data => targetReceivedResolve(data));
  });
  const targetPort = await listen(fixture);
  const profileId = db.insertRemoteProfile({name:"VNC proxy fixture", protocol:"vnc", host:"127.0.0.1", port:targetPort});
  gateway = http.createServer();
  gateway.on("upgrade", proxy.handleVncUpgrade);
  const gatewayPort = await listen(gateway);

  const client = net.createConnection({host:"127.0.0.1", port:gatewayPort});
  const websocketKey = crypto.randomBytes(16).toString("base64");
  client.write([
    `GET /ws/vnc?id=${profileId} HTTP/1.1`,
    `Host: 127.0.0.1:${gatewayPort}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${websocketKey}`,
    "",
    ""
  ].join("\r\n"));

  let pending = Buffer.alloc(0);
  const bannerFrame = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("VNC proxy handshake timeout")), 5000);
    client.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      const headerEnd = pending.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headers = pending.subarray(0, headerEnd).toString("utf8");
      assert.match(headers, /^HTTP\/1\.1 101 /);
      const frame = pending.subarray(headerEnd + 4);
      if (frame.length < 14) return;
      clearTimeout(timer);
      resolve(frame);
    });
    client.once("error", reject);
  });
  assert.equal(serverBinaryPayload(bannerFrame).toString(), "RFB 003.008\n");
  client.write(maskedBinary("client-to-vnc"));
  assert.equal((await targetReceived).toString(), "client-to-vnc");
  client.destroy();
  console.log("VNC 代理检查通过：WebSocket 握手与 RFB 双向二进制透传");
}

run().finally(async () => {
  try { proxy?.closeAllVncSessions(); } catch {}
  await Promise.all([fixture, gateway].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  try { db?.closeDatabase(); } catch {}
  const resolved = path.resolve(temporary);
  const root = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("terma-vnc-proxy-")) fs.rmSync(resolved, {recursive:true, force:true});
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
