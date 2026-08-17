"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const x11 = require("x11");
const { PNG_SIGNATURE, createX11ClipboardImageBridge } = require("../desktop/x11-clipboard-image-bridge");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function internAtom(X, name) {
  return new Promise((resolve, reject) => X.InternAtom(false, name, (error, atom) => error ? reject(error) : resolve(Number(atom))));
}

function connect(display, authCookie) {
  return new Promise((resolve, reject) => {
    const client = x11.createClient({
      display,
      auth:{name:authCookie.length ? "MIT-MAGIC-COOKIE-1" : "", data:authCookie.toString("latin1")},
      shm:false
    }, (error, displayInfo) => error ? reject(error) : resolve(displayInfo));
    client.on("error", () => {});
  });
}

async function readClipboardImage(display, authCookie) {
  const displayInfo = await connect(display, authCookie);
  const X = displayInfo.client;
  const requestor = X.AllocID();
  X.CreateWindow(requestor, displayInfo.screen[0].root, 0, 0, 1, 1, 0, 0, 0, 0, {});
  const [clipboard, imagePng, property] = await Promise.all([
    internAtom(X, "CLIPBOARD"),
    internAtom(X, "image/png"),
    internAtom(X, "TERMA_X11_CLIPBOARD_ACCEPTANCE")
  ]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for image/png SelectionNotify")), 5000);
    X.on("event", event => {
      if (event?.name !== "SelectionNotify" || event.requestor !== requestor || event.target !== imagePng) return;
      if (!event.property) {
        clearTimeout(timeout);
        reject(new Error("The X11 clipboard owner refused image/png"));
        return;
      }
      X.GetProperty(1, requestor, property, imagePng, 0, 8 * 1024 * 1024, (error, result) => {
        clearTimeout(timeout);
        try { X.DestroyWindow(requestor); } catch {}
        try { X.stream?.destroy?.(); } catch {}
        if (error) reject(error);
        else resolve(result?.data || Buffer.alloc(0));
      });
    });
    X.ConvertSelection(requestor, clipboard, imagePng, property, 0);
  });
}

async function clipboardOwner(display, authCookie) {
  const displayInfo = await connect(display, authCookie);
  const X = displayInfo.client;
  const clipboard = await internAtom(X, "CLIPBOARD");
  return new Promise((resolve, reject) => X.GetSelectionOwner(clipboard, (error, owner) => {
    try { X.stream?.destroy?.(); } catch {}
    if (error) reject(error);
    else resolve(Number(owner || 0));
  }));
}

async function main() {
  if (!process.argv.includes("--confirm-real-x11-clipboard")) {
    throw new Error("Refusing to use the active X Server without --confirm-real-x11-clipboard");
  }
  const display = argument("--display") || process.env.DISPLAY || "127.0.0.1:0.0";
  const authority = argument("--authority") || process.env.XAUTHORITY || "";
  const xauth = argument("--xauth") || path.join(__dirname, "..", "runtime", "xserver", "win32", "xauth.exe");
  let authCookie = Buffer.alloc(0);
  if (authority) {
    const result = spawnSync(xauth, ["-f", authority, "list", display], {encoding:"utf8", windowsHide:true, timeout:5000});
    const cookie = String(result.stdout || "").trim().split(/\s+/).at(-1) || "";
    if (!/^[0-9a-f]{32}$/i.test(cookie)) throw new Error("Unable to read the active X Server cookie");
    authCookie = Buffer.from(cookie, "hex");
  }
  if (process.argv.includes("--read-only")) {
    const owner = await clipboardOwner(display, authCookie);
    const received = await readClipboardImage(display, authCookie).catch(error => {
      error.message = `${error.message}; owner=0x${owner.toString(16)}`;
      throw error;
    });
    assert.ok(received.length >= PNG_SIGNATURE.length && received.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
    console.log(`真实 X11 图片剪贴板读取通过：${display} owner=0x${owner.toString(16)} 当前提供 ${received.length} 字节 image/png`);
    return;
  }
  const expected = Buffer.concat([PNG_SIGNATURE, Buffer.from("TERMA_X11_REAL_ACCEPTANCE")]);
  const bridge = createX11ClipboardImageBridge({display, authCookie, readClipboardPng:() => expected});
  try {
    assert.equal(await bridge.start(), true);
    const received = await readClipboardImage(display, authCookie);
    assert.deepEqual(received, expected);
    console.log(`真实 X11 图片剪贴板验收通过：${display} 已返回 ${received.length} 字节 image/png`);
  } finally {
    bridge.stop();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
