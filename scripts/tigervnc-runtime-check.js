"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");
const runtime = require("./prepare-tigervnc-runtime");

const source = fs.readFileSync(path.join(__dirname, "prepare-tigervnc-runtime.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "remote-clients.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");

assert.equal(runtime.VERSION, "1.16.2");
assert.deepEqual(runtime.RELEASES.win32, {
  arch:"x64",
  file:"vncviewer64-1.16.2.exe",
  url:"https://downloads.sourceforge.net/tigervnc/vncviewer64-1.16.2.exe",
  bytes:24072224,
  sha256:"58396d99556026da6b906c9ed51ad6cb5c840cc3fb65e53653c52ca5a80bfad9"
});
assert.equal(runtime.RELEASES.darwin.bytes, 6845311);
assert.equal(runtime.RELEASES.linux.bytes, 15042988);
assert.match(source, /next\.protocol === "http:"/);
assert.match(source, /next\.protocol !== "https:"/);
assert.match(source, /attempt <= 3/);
assert.match(source, /source_sha256/);
assert.match(source, /executable_sha256/);
assert.match(source, /hdiutil/);
assert.match(source, /tar/);
assert.equal(runtime.targetDirectory("win32", "x64"), path.join(path.resolve(__dirname, ".."), "runtime", "tigervnc", "win32-x64"));
assert.throws(() => runtime.platformRelease("win32", "ia32"), /x64 only/);
assert.equal(runtime.platformRelease("freebsd", "x64"), null);
assert.match(adapterSource, /getBundledVncRuntime/);
assert.match(adapterSource, /fallback_chain:\["bundled-tigervnc", "system"\]/);
assert.match(adapterSource, /requestedSystem/);
assert.match(mainSource, /process\.resourcesPath, "tigervnc"/);
assert.ok(packageJson.scripts["vnc:prepare"]);
assert.ok(packageJson.build.win.extraResources.some(item => item.from === "runtime/tigervnc/win32-x64"));
assert.ok(packageJson.build.mac.extraResources.some(item => item.from === "runtime/tigervnc/darwin-universal"));
assert.ok(packageJson.build.linux.extraResources.some(item => item.from === "runtime/tigervnc/linux-x64"));
console.log("TigerVNC runtime checks passed");
