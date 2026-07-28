"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertNativeArchitecture } = require("./native-binary-check");

const root = path.resolve(__dirname, "..");

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function assertFiles(label, files, predicate, expectedCount = 1) {
  const matches = files.filter(predicate);
  const usable = matches.filter(file => fs.statSync(file).size > 0);
  if (usable.length < expectedCount) {
    throw new Error(
      `${label} verification failed: expected at least ${expectedCount}, found ${usable.length}.`
    );
  }
  console.log(`${label} verified:\n${usable.map(file => `  ${file}`).join("\n")}`);
  return usable;
}

function assertArchitecture(files, architecture, label) {
  for (const file of files) {
    assertNativeArchitecture(file, architecture, label);
  }
  return files;
}

function verifySource(platform) {
  const nativeRoot = path.join(root, "native");
  const files = walk(nativeRoot);
  if (platform === "windows") {
    return assertArchitecture(assertFiles("Windows native drag addon", files, file =>
      file.endsWith(path.join("prebuilds", "win32-x64", "win_sftp_drag.node"))
    ), "x64", "Windows native drag addon");
  }
  if (platform === "macos") {
    const x64 = assertArchitecture(assertFiles("macOS x64 native drag addon", files, file =>
      file.endsWith(path.join(
        "prebuilds", "darwin-x64", "tunneldesk_macos_sftp_drag.node"
      ))
    ), "x64", "macOS native drag addon");
    const arm64 = assertArchitecture(assertFiles("macOS arm64 native drag addon", files, file =>
      file.endsWith(path.join(
        "prebuilds", "darwin-arm64", "tunneldesk_macos_sftp_drag.node"
      ))
    ), "arm64", "macOS native drag addon");
    return [...x64, ...arm64];
  }
  if (platform === "linux") {
    return assertArchitecture(assertFiles("Linux native drag helper", files, file =>
      file.endsWith(path.join(
        "prebuilds", `linux-${process.arch}`, "tunneldesk-linux-sftp-dragfs"
      ))
    ), process.arch, "Linux native drag helper");
  }
  throw new Error(`Unknown native SFTP drag platform: ${platform}`);
}

function verifyPackaged(platform, directory) {
  const files = walk(directory);
  if (platform === "windows") {
    return assertArchitecture(assertFiles("Packaged Windows native drag addon", files, file =>
      file.endsWith("win_sftp_drag.node") &&
      file.includes(`${path.sep}app.asar.unpacked${path.sep}native${path.sep}`)
    ), "x64", "Packaged Windows native drag addon");
  }
  if (platform === "macos") {
    const x64 = assertArchitecture(assertFiles("Packaged macOS x64 native drag addon", files, file =>
      file.endsWith("tunneldesk_macos_sftp_drag.node") &&
      file.includes(`${path.sep}darwin-x64${path.sep}`)
    ), "x64", "Packaged macOS native drag addon");
    const arm64 = assertArchitecture(assertFiles("Packaged macOS arm64 native drag addon", files, file =>
      file.endsWith("tunneldesk_macos_sftp_drag.node") &&
      file.includes(`${path.sep}darwin-arm64${path.sep}`)
    ), "arm64", "Packaged macOS native drag addon");
    return [...x64, ...arm64];
  }
  if (platform === "linux") {
    return assertArchitecture(assertFiles("Packaged Linux native drag helper", files, file =>
      path.basename(file) === "tunneldesk-linux-sftp-dragfs" &&
      file.includes(`${path.sep}resources${path.sep}native${path.sep}`)
    ), process.arch, "Packaged Linux native drag helper");
  }
  throw new Error(`Unknown native SFTP drag platform: ${platform}`);
}

if (require.main === module) {
  const platform = String(process.argv[2] || "").toLowerCase();
  const mode = String(process.argv[3] || "packaged").toLowerCase();
  if (!["windows", "macos", "linux"].includes(platform)) {
    throw new Error("Usage: node scripts/native-sftp-drag-artifacts-check.js <windows|macos|linux> [source|packaged] [directory]");
  }
  if (mode === "source") {
    verifySource(platform);
  } else if (mode === "packaged") {
    verifyPackaged(platform, path.resolve(root, process.argv[4] || "release"));
  } else {
    throw new Error(`Unknown verification mode: ${mode}`);
  }
}

module.exports = { walk, verifySource, verifyPackaged };
