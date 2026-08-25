"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const { connectVncSocket, VNC_BANNER_STABILITY_MS } = require("../dist/vnc-handshake");

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
    assert.equal(VNC_BANNER_STABILITY_MS, 0, "real VNC sessions must forward the banner without an artificial delay");
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

    let transientAttempts = 0;
    const transient = net.createServer(socket => {
      transientAttempts += 1;
      if (transientAttempts === 1) return socket.destroy();
      socket.write("RFB 003.008\n");
    });
    const transientPort = await listen(transient);
    const retried = await connectVncSocket("127.0.0.1", transientPort, 250, {retries:1, retryDelayMs:10});
    assert.equal(retried.banner.toString("ascii"), "RFB 003.008\n");
    retried.socket.destroy();
    await close(transient);

    let rejectedAttempts = 0;
    const rejected = net.createServer(socket => {
      rejectedAttempts += 1;
      socket.end("RFB 003.003\n");
    });
    const rejectedPort = await listen(rejected);
    const immediatelyClosed = await connectVncSocket("127.0.0.1", rejectedPort, 500, {retries:1, retryDelayMs:10});
    assert.equal(immediatelyClosed.banner.toString("ascii"), "RFB 003.003\n");
    immediatelyClosed.socket.destroy();
    assert.equal(rejectedAttempts, 1, "an immediate post-banner close must not trigger another unauthenticated VNC attempt");
    assert.equal(VNC_BANNER_STABILITY_MS, 0, "real VNC sessions must not wait for an artificial banner stability delay");
    await close(rejected);
    console.log("VNC RFB handshake checks passed: valid, invalid, silent, transient and immediate-close endpoints are separated");
  } finally {
    await Promise.all([valid, invalid, silent].map(close));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
