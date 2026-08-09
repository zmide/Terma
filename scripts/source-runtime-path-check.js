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

  await check("source launchers reject incompatible Node runtimes before dependency installation", () => {
    const windowsStart = fs.readFileSync(path.resolve(__dirname, "..", "start.bat"), "utf8");
    const posixStart = fs.readFileSync(path.resolve(__dirname, "..", "start.sh"), "utf8");
    const runtimeCheck = fs.readFileSync(path.resolve(__dirname, "node-runtime-check.js"), "utf8");
    assert.ok(windowsStart.indexOf("node-runtime-check.js") < windowsStart.indexOf("dependency-state.js"));
    assert.ok(posixStart.indexOf("select_node_runtime || exit 1") < posixStart.indexOf("dependency-state.js"));
    assert.match(runtimeCheck, /minimumMajor = 22/);
    assert.match(runtimeCheck, /require\("node:sqlite"\)/);
    assert.match(posixStart, /terma-test-toolchain\/current\/bin/);
    assert.match(posixStart, /\.local\/opt\/node-current\/bin/);
    assert.match(windowsStart, /api\/auth\/status/);
    assert.match(posixStart, /api\/auth\/status/);
    assert.doesNotMatch(windowsStart, /TrimEnd\('\/'\) \+ '\/api\/connections'/);
    assert.doesNotMatch(posixStart, /API_URL="\$\{1%\/\}\/api\/connections"/);
  });

  await check("Linux and macOS source launchers wait in the selected runtime and surface early exits", () => {
    const startScript = fs.readFileSync(path.resolve(__dirname, "..", "start.sh"), "utf8");
    const stopScript = fs.readFileSync(path.resolve(__dirname, "..", "stop.sh"), "utf8");
    assert.match(startScript, /source-runtime-path\.js --desktop-data-dir/);
    assert.match(startScript, /source-runtime-path\.js --web-data-dir/);
    assert.match(startScript, /TERMA_START_PRINT_PID=1 node scripts\/start-detached\.js desktop/);
    assert.match(startScript, /TERMA_START_PRINT_PID=1 node scripts\/start-detached\.js web/);
    assert.match(startScript, /! pid_is_running "\$STARTED_PID"/);
    assert.match(startScript, /print_startup_diagnostics/);
    assert.match(startScript, /DESKTOP_ARGS="--no-sandbox \$DESKTOP_ARGS"/);
    assert.match(startScript, /Another Terma installation is already using this runtime/);
    assert.match(startScript, /start-detached\.js web "\$@"/);
    assert.match(startScript, /check_existing_instance "\$WEB_DATA_DIR" "\$PROJECT_DATA_DIR"/);
    assert.doesNotMatch(startScript, /for DATA_CANDIDATE in "\$DESKTOP_DATA_DIR" "\$WEB_DATA_DIR" "\$PROJECT_DATA_DIR"; do\s+rm -f/);
    assert.match(stopScript, /source-runtime-path\.js --desktop-data-dir/);
    assert.match(stopScript, /source-runtime-path\.js --web-data-dir/);
    assert.match(stopScript, /Skipped another Terma installation/);
    assert.match(stopScript, /\$ROOT_DIR\/node_modules\/electron/);
    assert.doesNotMatch(stopScript, /for pattern in .*"Terma".*"TunnelDesk"/);
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
    const base = { platform:"linux", homeDirectory, env:{} };

    assert.equal(desktopUserDataRoot(base), path.join(homeDirectory, ".config", "Terma"));
    assert.equal(legacyDesktopUserDataRoot(base), path.join(homeDirectory, ".config", "TunnelDesk"));
    const xdgConfigHome = temporaryRoot();
    assert.equal(
      desktopUserDataRoot({ ...base, env:{ XDG_CONFIG_HOME:xdgConfigHome } }),
      path.join(xdgConfigHome, "Terma")
    );
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
    const shutdownToken = "source-runtime-shutdown-token-1234567890";
    for (const directory of [firstData, secondData]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "web.pid"), "101", "utf8");
      fs.writeFileSync(path.join(directory, "web.url"), "http://127.0.0.1:8088", "utf8");
      writeJson(path.join(directory, "web.json"), { pid: 101 });
      fs.writeFileSync(path.join(directory, "shutdown.token"), shutdownToken, "utf8");
    }
    const gracefulRequests = [];
    const terminated = [];
    const result = await stopSourceInstances({ projectRoot, candidates: [firstData, secondData] }, {
      inspectProcess: pid => pid === 101 ? {
        Name: "node.exe",
        CommandLine: `node ${path.join(projectRoot, "dist", "server.js")}`
      } : null,
      gracefulShutdown: async (url, timeout, token) => { gracefulRequests.push({url, timeout, token}); return true; },
      waitForExit: async () => true,
      terminateTree: pid => { terminated.push(pid); return true; },
      log() {}
    });
    assert.equal(result.stopped, 1);
    assert.deepEqual(gracefulRequests, [{url:"http://127.0.0.1:8088", timeout:5000, token:shutdownToken}]);
    assert.deepEqual(terminated, []);
    for (const directory of [firstData, secondData]) {
      for (const name of ["web.pid", "web.url", "web.json", "shutdown.token"]) assert.equal(fs.existsSync(path.join(directory, name)), false);
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
