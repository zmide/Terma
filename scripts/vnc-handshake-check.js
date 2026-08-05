"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const { connectVncSocket } = require("../dist/vnc-handshake");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function main() {
  const valid = net.createServer(socket => {
    socket.write("RFB ");
    setTimeout(() => socket.write("003.008\n"), 10);
  });
  const invalid = net.createServer(socket => socket.write("HTTP/1.1 200 OK\r\n"));
  const silent = net.createServer(() => {});
  try {
    const validPort = await listen(valid);
    const invalidPort = await listen(invalid);
    const silentPort = await listen(silent);

    const accepted = await connectVncSocket("127.0.0.1", validPort, 1000);
    assert.equal(accepted.banner.toString("ascii"), "RFB 003.008\n");
    assert.equal(accepted.initial_data.toString("ascii"), "RFB 003.008\n");
    accepted.socket.destroy();

    await assert.rejects(
      connectVncSocket("127.0.0.1", invalidPort, 1000),
      error => error?.code === "EVNCBANNER"
    );

    const started = Date.now();
    await assert.rejects(
      connectVncSocket("127.0.0.1", silentPort, 250),
      error => error?.code === "EVNCHANDSHAKETIMEOUT"
    );
    assert.ok(Date.now() - started < 1000, "silent ports must fail within the configured RFB deadline");
    console.log("VNC RFB handshake checks passed: valid, invalid and silent endpoints are separated");
  } finally {
    await Promise.all([valid, invalid, silent].map(close));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
