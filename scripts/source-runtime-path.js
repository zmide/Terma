"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const TRANSIENT_RUNTIME_FILES = ["web.pid", "web.url", "web.json", "shutdown.token"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function desktopUserDataRoot({ env = process.env, platform = process.platform, homeDirectory = os.homedir() } = {}) {
  if (env.TERMA_USER_DATA_DIR || env.TUNNELDESK_USER_DATA_DIR) return path.resolve(env.TERMA_USER_DATA_DIR || env.TUNNELDESK_USER_DATA_DIR);
  if (platform === "win32") return path.join(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"), "Terma");
  if (platform === "darwin") return path.join(homeDirectory, "Library", "Application Support", "Terma");
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config"), "Terma");
}

function legacyDesktopUserDataRoot({ env = process.env, platform = process.platform, homeDirectory = os.homedir() } = {}) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(homeDirectory, "AppData", "Roaming"), "TunnelDesk");
  if (platform === "darwin") return path.join(homeDirectory, "Library", "Application Support", "TunnelDesk");
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config"), "TunnelDesk");
}

function uniqueDirectories(directories, platform = process.platform) {
  const seen = new Set();
  return directories.filter(directory => {
    if (!directory) return false;
    const resolved = path.resolve(directory);
    const key = platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(directory => path.resolve(directory));
}

function resolveRuntimeDirectories(options = {}) {
  const projectRoot = path.resolve(options.root || root);
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const userDataRoot = desktopUserDataRoot({
    env,
    platform,
    homeDirectory: options.homeDirectory || os.homedir()
  });
  const legacyUserDataRoot = legacyDesktopUserDataRoot({
    env,
    platform,
    homeDirectory: options.homeDirectory || os.homedir()
  });
  // A source checkout must follow Terma's own settings.  The legacy settings
  // file remains a stop/scan candidate, but must not redirect a fresh Terma
  // launch to an empty renamed profile before the brand migration runs.
  const settings = readJson(path.join(userDataRoot, "desktop-settings.json")) || {};
  const legacySettings = readJson(path.join(legacyUserDataRoot, "desktop-settings.json")) || {};
  const customRoot = String(settings.customDataDir || "").trim();
  const customDataDir = customRoot ? path.join(path.resolve(projectRoot, customRoot), "data") : "";
  const legacyCustomRoot = String(legacySettings.customDataDir || "").trim();
  const legacyCustomDataDir = legacyCustomRoot ? path.join(path.resolve(projectRoot, legacyCustomRoot), "data") : "";
  const projectDataDir = path.join(projectRoot, "data");
  const userDataDir = path.join(userDataRoot, "runtime", "data");
  const desktopDataDir = settings.dataMode === "custom" && customDataDir
    ? customDataDir
    : settings.dataMode === "user"
      ? userDataDir
      : projectDataDir;

  const storageSettings = readJson(path.join(projectRoot, ".terma-storage.json"))
    || readJson(path.join(projectRoot, ".tunneldesk-storage.json"))
    || {};
  const storedRoot = path.isAbsolute(String(storageSettings.root || ""))
    ? path.resolve(String(storageSettings.root))
    : "";
  const webDataOverride = env.TERMA_DATA_DIR || env.TUNNELDESK_DATA_DIR;
  const webDataDir = webDataOverride
    ? path.resolve(webDataOverride)
    : storedRoot
      ? path.join(storedRoot, "data")
      : projectDataDir;

  return {
    projectRoot,
    userDataRoot,
    desktopDataDir,
    webDataDir,
    candidates: uniqueDirectories([
      desktopDataDir,
      projectDataDir,
      userDataDir,
      customDataDir,
      legacyCustomDataDir,
      webDataDir,
      webDataOverride,
      path.join(legacyUserDataRoot, "runtime", "data")
    ], platform)
  };
}

function inspectWindowsProcess(pid) {
  const command = [
    "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "' -ErrorAction SilentlyContinue;",
    "if($null -eq $p){exit 3};",
    "$p | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return null;
  try {
    return JSON.parse(String(result.stdout).replace(/^\uFEFF/, "").trim());
  } catch {
    return null;
  }
}

function normalizedCommand(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function normalizedProjectRoot(value) {
  const raw = String(value || "").trim();
  const resolved = /^[a-z]:[\\/]/i.test(raw) ? raw : path.resolve(raw);
  return normalizedCommand(resolved).replace(/\/$/, "");
}

function isSourceProcess(processInfo, projectRoot) {
  const name = String(processInfo?.Name || "").toLowerCase();
  const commandLine = normalizedCommand(processInfo?.CommandLine);
  const executablePath = normalizedCommand(processInfo?.ExecutablePath);
  const normalizedRoot = normalizedProjectRoot(projectRoot);
  if (name === "node.exe") return commandLine.includes(`${normalizedRoot}/dist/server.js`);
  if (name !== "electron.exe") return false;
  return executablePath.startsWith(`${normalizedRoot}/node_modules/electron/`)
    && (commandLine.includes(`\"${normalizedRoot}\"`) || commandLine.includes(` ${normalizedRoot} `) || commandLine.endsWith(` ${normalizedRoot}`));
}

function looksLikeTerma(processInfo) {
  const name = String(processInfo?.Name || "").toLowerCase();
  const commandLine = normalizedCommand(processInfo?.CommandLine);
  if (name === "terma.exe" || name === "tunneldesk.exe") return true;
  if (name === "node.exe") return /(?:^|[\s\"'])[^\s\"']*dist\/server\.js(?:[\s\"']|$)/i.test(commandLine);
  return name === "electron.exe" && (commandLine.includes("terma") || commandLine.includes("tunneldesk"));
}

function readRuntimePid(dataDirectory) {
  const pidFile = path.join(dataDirectory, "web.pid");
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) return { pid: 0, pidFile };
    return { pid: Number(raw), pidFile };
  } catch {
    return { pid: 0, pidFile };
  }
}

function cleanupRuntimeFiles(dataDirectory, expectedPid = 0) {
  if (expectedPid) {
    const current = readRuntimePid(dataDirectory).pid;
    if (current && current !== expectedPid) return;
  }
  for (const name of TRANSIENT_RUNTIME_FILES) {
    try { fs.rmSync(path.join(dataDirectory, name), { force: true }); } catch {}
  }
}

function verifiedRuntimeUrl(dataDirectory, pid) {
  try {
    const info = readJson(path.join(dataDirectory, "web.json"));
    if (Number(info?.pid) !== Number(pid)) return "";
    const value = fs.readFileSync(path.join(dataDirectory, "web.url"), "utf8").trim();
    const url = new URL(value);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function readShutdownToken(dataDirectory) {
  try {
    const token = fs.readFileSync(path.join(dataDirectory, "shutdown.token"), "utf8").trim();
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : "";
  } catch {
    return "";
  }
}

function requestGracefulShutdown(baseUrl, timeoutMs = 5000, shutdownToken = "") {
  if (!baseUrl) return Promise.resolve(false);
  return new Promise(resolve => {
    const url = new URL("/api/shutdown", `${baseUrl}/`);
    const transport = url.protocol === "https:" ? https : http;
    const headers = shutdownToken ? {"X-Terma-Shutdown-Token":shutdownToken} : {};
    const request = transport.request(url, { method: "POST", timeout: timeoutMs, headers }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });
    request.on("timeout", () => request.destroy(new Error("shutdown request timed out")));
    request.on("error", () => resolve(false));
    request.end();
  });
}

function terminateWindowsProcessTree(pid) {
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForProcessExit(pid, inspectProcess = inspectWindowsProcess, timeoutMs = 8000, isSameProcess = Boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isSameProcess(inspectProcess(pid))) return true;
    await delay(100);
  }
  return !isSameProcess(inspectProcess(pid));
}

async function stopSourceInstances(runtimeState, dependencies = {}) {
  const inspectProcess = dependencies.inspectProcess || inspectWindowsProcess;
  const gracefulShutdown = dependencies.gracefulShutdown || requestGracefulShutdown;
  const terminateTree = dependencies.terminateTree || terminateWindowsProcessTree;
  const waitForExit = dependencies.waitForExit || ((pid, timeoutMs) => waitForProcessExit(
    pid,
    inspectProcess,
    timeoutMs,
    processInfo => isSourceProcess(processInfo, runtimeState.projectRoot)
  ));
  const log = dependencies.log || console.log;
  const instances = new Map();
  const conflicts = [];

  for (const dataDirectory of runtimeState.candidates) {
    const { pid } = readRuntimePid(dataDirectory);
    if (!pid) {
      if (fs.existsSync(path.join(dataDirectory, "web.pid"))) cleanupRuntimeFiles(dataDirectory);
      continue;
    }
    const processInfo = inspectProcess(pid);
    if (!processInfo) {
      cleanupRuntimeFiles(dataDirectory, pid);
      continue;
    }
    if (!isSourceProcess(processInfo, runtimeState.projectRoot)) {
      if (looksLikeTerma(processInfo)) conflicts.push({ pid, dataDirectory });
      else cleanupRuntimeFiles(dataDirectory, pid);
      continue;
    }
    const instance = instances.get(pid) || { pid, directories: [], controls: [] };
    instance.directories.push(dataDirectory);
    const url = verifiedRuntimeUrl(dataDirectory, pid);
    if (url) instance.controls.push({url, token:readShutdownToken(dataDirectory)});
    instances.set(pid, instance);
  }

  if (conflicts.length) {
    const conflict = conflicts[0];
    throw new Error(`运行目录正被另一个 Terma 或旧版 TunnelDesk 进程使用（pid=${conflict.pid}）：${conflict.dataDirectory}`);
  }

  for (const instance of instances.values()) {
    log(`正在停止当前 Terma 源码实例，pid=${instance.pid}...`);
    if (instance.controls.length) {
      const control = instance.controls[0];
      await gracefulShutdown(control.url, 5000, control.token);
    }
    let stopped = await waitForExit(instance.pid, 8000);
    if (!stopped) {
      if (!isSourceProcess(inspectProcess(instance.pid), runtimeState.projectRoot)) {
        stopped = true;
      } else {
        terminateTree(instance.pid);
        stopped = await waitForExit(instance.pid, 5000);
      }
    }
    if (!stopped) throw new Error(`无法停止当前 Terma 源码实例，pid=${instance.pid}`);
    for (const dataDirectory of instance.directories) cleanupRuntimeFiles(dataDirectory, instance.pid);
    log(`已停止当前 Terma 源码实例，pid=${instance.pid}。`);
  }

  return { stopped: instances.size };
}

async function main() {
  const runtimeState = resolveRuntimeDirectories();
  const command = process.argv[2];
  if (command === "--desktop-data-dir") return void process.stdout.write(runtimeState.desktopDataDir);
  if (command === "--web-data-dir") return void process.stdout.write(runtimeState.webDataDir);
  if (command === "--stop") return void await stopSourceInstances(runtimeState);
  throw new Error("Usage: node scripts/source-runtime-path.js --desktop-data-dir|--web-data-dir|--stop");
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  cleanupRuntimeFiles,
  desktopUserDataRoot,
  legacyDesktopUserDataRoot,
  isSourceProcess,
  looksLikeTerma,
  resolveRuntimeDirectories,
  stopSourceInstances,
  verifiedRuntimeUrl
};
