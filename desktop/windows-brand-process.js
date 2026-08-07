"use strict";

const path = require("node:path");

const CURRENT_APP_USER_MODEL_ID = "com.zmide.terma";
const LEGACY_APP_USER_MODEL_ID = "com.zmide.tunneldesk";

function commandLineOption(commandLine, optionName) {
  const escapedName = String(optionName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)--${escapedName}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i")
    .exec(String(commandLine || ""));
  return match ? String(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function normalizedWindowsPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.win32.normalize(raw).replace(/[\\/]+$/, "").toLowerCase();
}

function sameWindowsPath(left, right) {
  const normalizedLeft = normalizedWindowsPath(left);
  const normalizedRight = normalizedWindowsPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isLegacyBrandWindowsProcess(processInfo, options = {}) {
  const processId = Number(processInfo?.ProcessId || 0);
  if (Number(options.currentPid || 0) > 0 && processId === Number(options.currentPid)) return false;

  const name = String(processInfo?.Name || "").trim().toLowerCase();
  if (name === "terma.exe") return false;
  if (name === "tunneldesk.exe") return true;
  if (name !== "electron.exe") return false;

  const commandLine = String(processInfo?.CommandLine || "");
  const userDataDir = commandLineOption(commandLine, "user-data-dir");
  const appUserModelId = commandLineOption(commandLine, "app-user-model-id").trim().toLowerCase();
  if (sameWindowsPath(userDataDir, options.currentUserData) || appUserModelId === CURRENT_APP_USER_MODEL_ID) return false;
  return sameWindowsPath(userDataDir, options.legacyUserData) || appUserModelId === LEGACY_APP_USER_MODEL_ID;
}

function listWindowsBrandProcesses(spawnSync) {
  const command = [
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe' OR Name = 'TunnelDesk.exe' OR Name = 'terma.exe'\" -ErrorAction SilentlyContinue |",
    "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine);",
    "ConvertTo-Json -Compress -InputObject $items"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding:"utf8",
    windowsHide:true,
    timeout:5000,
    maxBuffer:1024 * 1024
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(String(result.stdout).replace(/^\uFEFF/, "").trim());
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(item => item && typeof item === "object");
  } catch {
    return [];
  }
}

function legacyBrandWindowsAppRunning(options = {}) {
  const spawnSync = options.spawnSync;
  if (typeof spawnSync !== "function") return false;
  try {
    const tasklist = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq TunnelDesk.exe", "/NH"], {
      windowsHide:true,
      encoding:"utf8"
    });
    if (tasklist.status === 0 && /TunnelDesk\.exe/i.test(String(tasklist.stdout || ""))) return true;
  } catch {}

  try {
    return listWindowsBrandProcesses(spawnSync).some(processInfo => isLegacyBrandWindowsProcess(processInfo, options));
  } catch {
    return false;
  }
}

module.exports = {
  commandLineOption,
  isLegacyBrandWindowsProcess,
  legacyBrandWindowsAppRunning,
  listWindowsBrandProcesses
};
