"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "build-native-sftp-drag.js"), "utf8");
const official = "https://electronjs.org/headers";
const mirror = "https://npmmirror.com/mirrors/electron";

function buildFixture({platform="win32", args=[], env={}, fault=()=>null, current=false, invalidOutput=false} = {}) {
  const calls = [];
  const copies = [];
  const warnings = [];
  const errors = [];
  const fakeProcess = {platform, arch:"x64", execPath:process.execPath, argv:["node", "build", ...args], env};
  const fakeFs = {
    existsSync:()=>true,
    statSync:file=>({size:1, mtimeMs:current && String(file).includes("prebuilds") ? 20 : 10}),
    readdirSync:()=>[],
    mkdirSync() {},
    copyFileSync:(from, to)=>copies.push({from, to}),
    chmodSync() {}
  };
  vm.runInNewContext(source, {
    __dirname,
    __filename:path.join(__dirname, "build-native-sftp-drag.js"),
    process:fakeProcess,
    console:{log() {}, warn:value=>warnings.push(value), error:value=>errors.push(value)},
    require(id) {
      if (id === "node:fs") return fakeFs;
      if (id === "node:path") return path;
      if (id === "node:child_process") return {
        spawnSync(command, commandArgs, options) {
          const call = {command, args:Array.from(commandArgs), options};
          calls.push(call);
          return fault(call) || {status:0, stdout:"fixture", stderr:""};
        }
      };
      if (id === "./native-binary-check") return {
        assertNativeArchitecture() {
          if (invalidOutput) throw new Error("fixture: wrong binary architecture");
        }
      };
      if (id === path.join(root, "package.json")) return {devDependencies:{electron:"44.7.0"}};
      throw new Error(`Unexpected fixture import: ${id}`);
    }
  }, {filename:"build-native-sftp-drag.js"});
  return {calls, copies, warnings, errors, exitCode:fakeProcess.exitCode || 0};
}

function headerCalls(fixture) {
  return fixture.calls.filter(call=>call.args[1] === "install");
}

function compileCalls(fixture) {
  return fixture.calls.filter(call=>call.args[1] === "rebuild");
}

function checkNativeBuildFallback() {
  const failedHeaders = call=>call.args[1] === "install" ? {status:1} : null;
  for (const required of [false, true]) {
    const args = required ? ["--required"] : [];
    const downloadFailure = buildFixture({args, fault:failedHeaders});
    assert.equal(downloadFailure.exitCode, required ? 1 : 0);
    assert.equal(headerCalls(downloadFailure).length, 2);
    assert.equal(compileCalls(downloadFailure).length, 0);
    assert.equal(downloadFailure.copies.length, 0, "failed preparation must preserve the last successful addon");
    assert.equal(downloadFailure.errors.length, required ? 1 : 0);
    if (!required) assert.match(downloadFailure.warnings.join("\n"), /Desktop startup will continue/);

    for (const platform of ["win32", "darwin", "linux"]) {
      const compilerFailure = buildFixture({platform, args, fault:call=>
        call.args[1] === "rebuild" || call.command === "cmake" ? {status:2} : null});
      assert.equal(compilerFailure.exitCode, required ? 1 : 0, `${platform} compiler failure`);
      assert.equal(compilerFailure.copies.length, 0);
      assert.equal(headerCalls(compilerFailure).length, platform === "linux" ? 0 : 1,
        "compiler failure must not retry compilation using another header source");
    }

    const spawnFailure = buildFixture({args, fault:call=>call.args[1] === "install"
      ? {error:new Error("fixture: executable unavailable"), status:null} : null});
    assert.equal(spawnFailure.exitCode, required ? 1 : 0);
    const wrongOutput = buildFixture({args, invalidOutput:true});
    assert.equal(wrongOutput.exitCode, required ? 1 : 0);
    assert.equal(wrongOutput.copies.length, 0);
  }

  const recovered = buildFixture({fault:call=>call.args[1] === "install" &&
    call.args.includes(`--dist-url=${official}`) ? {status:1} : null});
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.copies.length, 1);
  assert.equal(compileCalls(recovered).length, 1);
  assert.ok(compileCalls(recovered)[0].args.includes(`--dist-url=${mirror}`));
  assert.ok(recovered.warnings.some(message=>message.includes("Trying headers mirror")));
  for (const call of headerCalls(recovered)) {
    assert.ok(call.args.includes("--ensure"));
    assert.equal(call.options.timeout, 120_000);
    assert.equal(call.options.windowsHide, true);
    assert.ok(call.args.includes(`--dist-url=${call.options.env.npm_package_config_node_gyp_dist_url}`));
    assert.equal(call.options.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  }

  const custom = "https://headers.example.test/electron";
  const configured = buildFixture({env:{TERMA_ELECTRON_HEADERS_URL:custom}, fault:failedHeaders});
  assert.equal(headerCalls(configured).length, 1, "explicit download sources must not silently fall back");
  assert.ok(headerCalls(configured)[0].args.includes(`--dist-url=${custom}`));
  assert.equal(compileCalls(configured).length, 0);
  const genericNode = buildFixture({env:{
    npm_config_disturl:"https://npmmirror.com/mirrors/node",
    npm_package_config_node_gyp_dist_url:"https://nodejs.org/dist",
    npm_package_config_node_gyp_target:"22.21.1",
    npm_package_config_node_gyp_arch:"ia32"
  }});
  for (const call of [...headerCalls(genericNode), ...compileCalls(genericNode)]) {
    assert.equal(call.options.env.npm_package_config_node_gyp_dist_url, official);
    assert.equal(call.options.env.npm_package_config_node_gyp_target, "44.7.0");
    assert.equal(call.options.env.npm_package_config_node_gyp_arch, "x64");
  }
  const customPriority = buildFixture({env:{TERMA_ELECTRON_HEADERS_URL:mirror, npm_config_dist_url:official}});
  assert.ok(headerCalls(customPriority)[0].args.includes(`--dist-url=${mirror}`));
  assert.equal(compileCalls(customPriority)[0].options.env.npm_config_dist_url, mirror);

  for (const setting of ["npm_config_nodedir", "npm_package_config_node_gyp_nodedir"]) {
    const local = buildFixture({env:{[setting]:"/local/electron/headers"}});
    assert.equal(headerCalls(local).length, 0, "local header configuration must not access the network");
    assert.equal(compileCalls(local).length, 1);
    assert.equal(compileCalls(local)[0].options.env[setting], "/local/electron/headers", "the inherited setting is not overridden");
  }
  const cached = buildFixture({current:true, args:["--if-needed", "--current-arch"]});
  assert.equal(cached.calls.length, 0);
  assert.equal(cached.exitCode, 0);
  const diagnosed = buildFixture({args:["--diagnose"]});
  assert.equal(headerCalls(diagnosed).length, 0);
  assert.equal(compileCalls(diagnosed).length, 0);
  const mac = buildFixture({platform:"darwin"});
  assert.equal(mac.copies.length, 2);
  assert.ok(headerCalls(mac)[1].args.includes("--arch=arm64"));

  checkLauncherFallback();
  console.log("native SFTP build fallback checks passed");
}

function checkLauncherFallback() {
  const windows = fs.readFileSync(path.join(root, "start.bat"), "utf8");
  const posix = fs.readFileSync(path.join(root, "start.sh"), "utf8");
  const block = windows.match(/call npm run native:build:if-needed\r?\n[\s\S]*?call :start_desktop_detached/);
  assert.ok(block);
  assert.doesNotMatch(block[0], /goto failed/);
  assert.match(block[0], /if errorlevel 1 echo Native SFTP drag build failed/);
  assert.match(posix, /npm run native:build:if-needed \|\| echo/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const command of ["package", "dist"]) assert.match(pkg.scripts[command], /native:build:required/);
  assert.match(pkg.scripts["native:build:required"], /--required/);

  if (process.platform !== "win32") return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-native-start-check-"));
  try {
    const file = path.join(directory, "fallback.bat");
    const body = block[0].replace("call npm run native:build:if-needed", "call :failed_build");
    fs.writeFileSync(file, `@echo off\r\n${body}\r\nexit /b %errorlevel%\r\n` +
      ":failed_build\r\nexit /b 1\r\n:start_desktop_detached\r\necho DESKTOP_ATTEMPT\r\nexit /b 0\r\n");
    const result = childProcess.spawnSync("cmd.exe", ["/d", "/c", file], {encoding:"utf8", windowsHide:true});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Native SFTP drag build failed/);
    assert.match(result.stdout, /DESKTOP_ATTEMPT/);
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
}

if (require.main === module) checkNativeBuildFallback();
module.exports = {checkNativeBuildFallback};
