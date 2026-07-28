"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isSourceProcess, resolveRuntimeDirectories, stopSourceInstances } = require("./source-runtime-path");

const temporaryRoots = [];
process.on("exit", () => {
  for (const directory of temporaryRoots) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

function temporaryRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-source-runtime-check-"));
  temporaryRoots.push(directory);
  return directory;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

async function check(name, callback) {
  await callback();
  console.log(`PASS ${name}`);
}

(async () => {
  await check("Windows source start restarts before build and waits in the selected runtime", () => {
    const startScript = fs.readFileSync(path.resolve(__dirname, "..", "start.bat"), "utf8");
    const stopIndex = startScript.indexOf("source-runtime-path.js --stop");
    const dependencyIndex = startScript.indexOf("dependency-state.js");
    const nativeBuildIndex = startScript.indexOf("npm run native:build:if-needed");
    const desktopStartIndex = startScript.indexOf("call :start_desktop_detached");
    assert.ok(stopIndex >= 0 && stopIndex < dependencyIndex);
    assert.ok(nativeBuildIndex > dependencyIndex && nativeBuildIndex < desktopStartIndex);
    assert.match(startScript, /call :set_runtime_files desktop/);
    assert.match(startScript, /call :set_runtime_files web/);
    assert.doesNotMatch(startScript, /call :check_existing_instance/);
    assert.doesNotMatch(startScript, /call stop\.bat/i);
  });

  await check("desktop runtime follows project, user, and custom storage settings", () => {
    const projectRoot = temporaryRoot();
    const appData = path.join(temporaryRoot(), "roaming");
    const settingsFile = path.join(appData, "TunnelDesk", "desktop-settings.json");
    const base = { root: projectRoot, env: { APPDATA: appData }, platform: "win32", homeDirectory: temporaryRoot() };

    assert.equal(resolveRuntimeDirectories(base).desktopDataDir, path.join(projectRoot, "data"));
    writeJson(settingsFile, { dataMode: "user" });
    assert.equal(resolveRuntimeDirectories(base).desktopDataDir, path.join(appData, "TunnelDesk", "runtime", "data"));
    const customRoot = path.join(temporaryRoot(), "custom");
    writeJson(settingsFile, { dataMode: "custom", customDataDir: customRoot });
    const state = resolveRuntimeDirectories(base);
    assert.equal(state.desktopDataDir, path.join(customRoot, "data"));
    assert.ok(state.candidates.includes(path.join(projectRoot, "data")));
    assert.ok(state.candidates.includes(path.join(appData, "TunnelDesk", "runtime", "data")));
    assert.ok(state.candidates.includes(path.join(customRoot, "data")));
  });

  await check("web runtime follows the storage root and explicit data directory", () => {
    const projectRoot = temporaryRoot();
    const appData = path.join(temporaryRoot(), "roaming");
    const storedRoot = path.join(temporaryRoot(), "stored");
    writeJson(path.join(projectRoot, ".tunneldesk-storage.json"), { root: storedRoot });
    const base = { root: projectRoot, env: { APPDATA: appData }, platform: "win32", homeDirectory: temporaryRoot() };
    assert.equal(resolveRuntimeDirectories(base).webDataDir, path.join(storedRoot, "data"));
    const explicitData = path.join(temporaryRoot(), "explicit-data");
    assert.equal(resolveRuntimeDirectories({ ...base, env: { APPDATA: appData, TUNNELDESK_DATA_DIR: explicitData } }).webDataDir, explicitData);
  });

  await check("source ownership requires the current checkout server or Electron entry point", () => {
    const projectRoot = "E:\\github\\tunneldesk";
    assert.equal(isSourceProcess({
      Name: "node.exe",
      CommandLine: '"C:\\node.exe" "E:\\github\\tunneldesk\\dist\\server.js"'
    }, projectRoot), true);
    assert.equal(isSourceProcess({
      Name: "electron.exe",
      ExecutablePath: "E:\\github\\tunneldesk\\node_modules\\electron\\dist\\electron.exe",
      CommandLine: '"E:\\github\\tunneldesk\\node_modules\\electron\\dist\\electron.exe" E:\\github\\tunneldesk'
    }, projectRoot), true);
    assert.equal(isSourceProcess({
      Name: "node.exe",
      CommandLine: 'node kernel.js --working-dir E:\\github\\tunneldesk'
    }, projectRoot), false);
    assert.equal(isSourceProcess({
      Name: "TunnelDesk.exe",
      CommandLine: '"D:\\Program Files\\TunnelDesk\\TunnelDesk.exe"'
    }, projectRoot), false);
  });

  await check("restart stops one source process once and clears every matching runtime marker", async () => {
    const projectRoot = temporaryRoot();
    const firstData = path.join(projectRoot, "data");
    const secondData = path.join(temporaryRoot(), "data");
    for (const directory of [firstData, secondData]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "web.pid"), "101", "utf8");
      fs.writeFileSync(path.join(directory, "web.url"), "http://127.0.0.1:8088", "utf8");
      writeJson(path.join(directory, "web.json"), { pid: 101 });
    }
    const gracefulUrls = [];
    const terminated = [];
    const result = await stopSourceInstances({ projectRoot, candidates: [firstData, secondData] }, {
      inspectProcess: pid => pid === 101 ? {
        Name: "node.exe",
        CommandLine: `node ${path.join(projectRoot, "dist", "server.js")}`
      } : null,
      gracefulShutdown: async url => { gracefulUrls.push(url); return true; },
      waitForExit: async () => true,
      terminateTree: pid => { terminated.push(pid); return true; },
      log() {}
    });
    assert.equal(result.stopped, 1);
    assert.deepEqual(gracefulUrls, ["http://127.0.0.1:8088"]);
    assert.deepEqual(terminated, []);
    for (const directory of [firstData, secondData]) {
      for (const name of ["web.pid", "web.url", "web.json"]) assert.equal(fs.existsSync(path.join(directory, name)), false);
    }
  });

  await check("restart refuses to terminate a packaged or unrelated TunnelDesk process", async () => {
    const projectRoot = temporaryRoot();
    const dataDirectory = path.join(projectRoot, "data");
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(path.join(dataDirectory, "web.pid"), "303", "utf8");
    let terminated = false;
    await assert.rejects(() => stopSourceInstances({ projectRoot, candidates: [dataDirectory] }, {
      inspectProcess: () => ({ Name: "TunnelDesk.exe", CommandLine: '"D:\\Program Files\\TunnelDesk\\TunnelDesk.exe"' }),
      terminateTree: () => { terminated = true; },
      log() {}
    }), /another TunnelDesk process/);
    assert.equal(terminated, false);
    assert.equal(fs.existsSync(path.join(dataDirectory, "web.pid")), true);
  });

  await check("restart does not terminate a process that reused the old PID", async () => {
    const projectRoot = temporaryRoot();
    const dataDirectory = path.join(projectRoot, "data");
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(path.join(dataDirectory, "web.pid"), "404", "utf8");
    let inspections = 0;
    let terminated = false;
    await stopSourceInstances({ projectRoot, candidates: [dataDirectory] }, {
      inspectProcess: () => {
        inspections += 1;
        if (inspections === 1) return { Name: "node.exe", CommandLine: `node ${path.join(projectRoot, "dist", "server.js")}` };
        return { Name: "node.exe", CommandLine: "node unrelated-worker.js" };
      },
      gracefulShutdown: async () => true,
      terminateTree: () => { terminated = true; },
      log() {}
    });
    assert.equal(terminated, false);
  });

  console.log("Source runtime path checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
