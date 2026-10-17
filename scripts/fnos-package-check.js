"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function verifyPackage(directory, arch) {
  const read = name => fs.readFileSync(path.join(directory, name), "utf8");
  const manifest = Object.fromEntries(read("manifest").split(/\r?\n/).filter(line => line.includes("=")).map(line => line.split(/=(.*)/s).slice(0, 2).map(value => value.trim())));
  const pkg = JSON.parse(read("app/server/package.json"));
  assert.equal(manifest.appname, "terma");
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.platform, arch === "x64" ? "x86" : "arm");
  assert.equal(pkg.termaDistribution, "fnos");
  assert.equal(pkg.termaFnosArchitecture, arch);
  assert.equal(manifest.service_port, "8088");
  assert.equal(manifest.install_dep_apps, "nodejs_v22");
  assert.match(manifest.desc, /data:image\/jpeg,%/);
  assert.equal((manifest.desc.match(/<img /g) || []).length, 4, "Desktop and mobile screenshots must all be included");
  assert.match(manifest.desc, /noVNC/, "The installed introduction must include browser VNC");
  assert.equal(manifest.desc.startsWith("<p>"), true, "Description quotes must not become visible text");
  assert.equal(manifest.desc.endsWith("</p>"), true, "Introduction must not be truncated");
  assert.equal(manifest.desc.includes(";"), false, "fnOS's INI parser truncates descriptions at semicolons");
  assert.equal(manifest.desc.includes("@DESCRIPTION@"), false);
  assert.equal(manifest.desc.includes("https://"), false, "Introduction images must work without external requests");
  for (const wizard of ["install", "config", "uninstall"]) JSON.parse(read(`wizard/${wizard}`));
  for (const name of ["config_init", "config_callback"]) assert.ok(fs.existsSync(path.join(directory, "cmd", name)));
  assert.equal(JSON.parse(read("config/privilege")).defaults["run-as"], "package");
  assert.equal(manifest.disable_authorization_path, "false");
  assert.deepEqual(JSON.parse(read("config/resource")), {"data-share":{"shares":[{"name":"terma/files"}]}});
  const entry = JSON.parse(read("app/ui/config"))[".url"]["terma.main"];
  assert.equal(entry.type, "url");
  assert.equal(entry.allUsers, false);
  assert.equal(entry.port, manifest.service_port);
  for (const [name, size] of [["ICON.PNG", 64], ["ICON_256.PNG", 256], ["app/ui/images/icon_64.png", 64], ["app/ui/images/icon_256.png", 256]]) {
    const png = fs.readFileSync(path.join(directory, name));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  for (const name of ["data", ".ssh", ".terma-storage.json", "desktop", ".git"]) {
    assert.equal(fs.existsSync(path.join(directory, "app", "server", name)), false, `Private or desktop path was packaged: ${name}`);
  }
  assert.equal(fs.existsSync(path.join(directory, "app/server/node_modules/electron")), false);
  assert.ok(fs.existsSync(path.join(directory,"app/server/node_modules/@novnc/novnc/core/rfb.js")), "Bundled browser VNC is missing");
  for (const name of ["dist/server.js", "public/index.html", "LICENSE", "THIRD_PARTY_NOTICES.md", "scripts/fnos-initialize.js", "scripts/fnos-config.js", "scripts/fnos-process.js"]) {
    assert.ok(fs.existsSync(path.join(directory, "app/server", name)), name);
  }
  for (const name of fs.readdirSync(path.join(directory, "cmd"))) {
    assert.equal(read(path.join("cmd", name)).includes("\r"), false, "Lifecycle scripts must use LF");
  }
  console.log(`fnOS package structure verified (${arch})`);
}

if (require.main === module) verifyPackage(path.resolve(process.argv[2]), process.argv[3]);
module.exports = {verifyPackage};
