"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  desktopUserDataRoot,
  isSourceProcess,
  legacyDesktopUserDataRoot,
  looksLikeTerma,
  resolveRuntimeDirectories,
  stopSourceInstances
} = require("./source-runtime-path");

const temporaryRoots = [];
process.on("exit", () => {
  for (const directory of temporaryRoots) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

function temporaryRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-source-runtime-check-"));
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
    const settingsFile = path.join(appData, "Terma", "desktop-settings.json");
    const legacySettingsFile = path.join(appData, "TunnelDesk", "desktop-settings.json");
    const base = { root: projectRoot, env: { APPDATA: appData }, platform: "win32", homeDirectory: temporaryRoot() };

    assert.equal(resolveRuntimeDirectories(base).desktopDataDir, path.join(projectRoot, "data"));
    const legacyCustomRoot = path.join(temporaryRoot(), "legacy-custom");
    writeJson(legacySettingsFile, { dataMode: "user", customDataDir: legacyCustomRoot });
    const legacyState = resolveRuntimeDirectories(base);
    assert.equal(legacyState.userDataRoot, path.join(appData, "Terma"));
    assert.equal(legacyState.desktopDataDir, path.join(projectRoot, "data"));
    assert.ok(legacyState.candidates.includes(path.join(appData, "TunnelDesk", "runtime", "data")));
    assert.ok(legacyState.candidates.includes(path.join(legacyCustomRoot, "data")));
    const customRoot = path.join(temporaryRoot(), "custom");
    writeJson(settingsFile, { dataMode: "custom", customDataDir: customRoot });
    const state = resolveRuntimeDirectories(base);
    assert.equal(state.desktopDataDir, path.join(customRoot, "data"));
    assert.ok(state.candidates.includes(path.join(projectRoot, "data")));
    assert.ok(state.candidates.includes(path.join(appData, "Terma", "runtime", "data")));
    assert.ok(state.candidates.includes(path.join(appData, "TunnelDesk", "runtime", "data")));
    assert.ok(state.candidates.includes(path.join(customRoot, "data")));
  });

  await check("Terma runtime environment names take priority while legacy names remain accepted", () => {
    const homeDirectory = temporaryRoot();
    const termaUserData = path.join(temporaryRoot(), "terma-user-data");
    const legacyOverride = path.join(temporaryRoot(), "legacy-user-data-override");
    const base = { platform:"linux", homeDirectory };

    assert.equal(desktopUserDataRoot(base), path.join(homeDirectory, ".config", "Terma"));
    assert.equal(legacyDesktopUserDataRoot(base), path.join(homeDirectory, ".config", "TunnelDesk"));
    assert.equal(desktopUserDataRoot({ ...base, env:{TUNNELDESK_USER_DATA_DIR:legacyOverride} }), legacyOverride);
    assert.equal(desktopUserDataRoot({
      ...base,
      env:{TERMA_USER_DATA_DIR:termaUserData, TUNNELDESK_USER_DATA_DIR:legacyOverride}
    }), termaUserData);
  });

  await check("web runtime follows the storage root and explicit data directory", () => {
    const projectRoot = temporaryRoot();
    const appData = path.join(temporaryRoot(), "roaming");
    const legacyStoredRoot = path.join(temporaryRoot(), "legacy-stored");
    const storedRoot = path.join(temporaryRoot(), "stored");
    writeJson(path.join(projectRoot, ".tunneldesk-storage.json"), { root: legacyStoredRoot });
    const base = { root: projectRoot, env: { APPDATA: appData }, platform: "win32", homeDirectory: temporaryRoot() };
    assert.equal(resolveRuntimeDirectories(base).webDataDir, path.join(legacyStoredRoot, "data"));
    writeJson(path.join(projectRoot, ".terma-storage.json"), { root: storedRoot });
    assert.equal(resolveRuntimeDirectories(base).webDataDir, path.join(storedRoot, "data"));
    const legacyExplicitData = path.join(temporaryRoot(), "legacy-explicit-data");
    const explicitData = path.join(temporaryRoot(), "explicit-data");
    assert.equal(resolveRuntimeDirectories({ ...base, env: { APPDATA: appData, TUNNELDESK_DATA_DIR: legacyExplicitData } }).webDataDir, legacyExplicitData);
    assert.equal(resolveRuntimeDirectories({
      ...base,
      env: { APPDATA: appData, TERMA_DATA_DIR: explicitData, TUNNELDESK_DATA_DIR: legacyExplicitData }
    }).webDataDir, explicitData);
  });

  await check("source ownership requires the current checkout server or Electron entry point", () => {
    const projectRoot = path.win32.join("C:\\Temp", "TermaSourceFixture");
    const electronPath = path.win32.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
    const serverPath = path.win32.join(projectRoot, "dist", "server.js");
    assert.equal(isSourceProcess({
      Name: "node.exe",
      CommandLine: `"C:\\node.exe" "${serverPath}"`
    }, projectRoot), true);
    assert.equal(isSourceProcess({
      Name: "electron.exe",
      ExecutablePath: electronPath,
      CommandLine: `"${electronPath}" ${projectRoot}`
    }, projectRoot), true);
    assert.equal(isSourceProcess({
      Name: "node.exe",
      CommandLine: `node kernel.js --working-dir ${projectRoot}`
    }, projectRoot), false);
    assert.equal(isSourceProcess({
      Name: "TunnelDesk.exe",
      CommandLine: '"C:\\Temp\\TunnelDesk\\TunnelDesk.exe"'
    }, projectRoot), false);
    assert.equal(looksLikeTerma({Name:"terma.exe"}), true);
    assert.equal(looksLikeTerma({Name:"TunnelDesk.exe"}), true);
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

  await check("restart refuses to terminate a packaged Terma or legacy TunnelDesk process", async () => {
    const projectRoot = temporaryRoot();
    const dataDirectory = path.join(projectRoot, "data");
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(path.join(dataDirectory, "web.pid"), "303", "utf8");
    let terminated = false;
    await assert.rejects(() => stopSourceInstances({ projectRoot, candidates: [dataDirectory] }, {
      inspectProcess: () => ({ Name: "TunnelDesk.exe", CommandLine: '"C:\\Temp\\TunnelDesk\\TunnelDesk.exe"' }),
      terminateTree: () => { terminated = true; },
      log() {}
    }), /Terma.*TunnelDesk/);
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
