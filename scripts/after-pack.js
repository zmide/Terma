"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { assertNativeArchitecture } = require("./native-binary-check");

function resourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources"
    );
  }
  return path.join(context.appOutDir, "resources");
}

function verifyMacIcon(context) {
  const appDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const plistPath = path.join(appDir, "Contents", "Info.plist");
  const iconPath = path.join(appDir, "Contents", "Resources", "icon.icns");
  const plist = fs.readFileSync(plistPath, "utf8");
  if (!/<key>CFBundleIconFile<\/key>\s*<string>icon\.icns<\/string>/.test(plist)) {
    throw new Error(`macOS bundle does not declare icon.icns: ${plistPath}`);
  }
  if (!fs.existsSync(iconPath) || fs.readFileSync(iconPath).subarray(0, 4).toString("ascii") !== "icns") {
    throw new Error(`macOS bundle icon is missing or invalid: ${iconPath}`);
  }
  console.log(`Verified macOS bundle icon: ${iconPath}`);
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function buildArchName(arch) {
  const names = {
    0: "ia32",
    1: "x64",
    2: "armv7l",
    3: "arm64",
    4: "universal"
  };
  return typeof arch === "string" ? arch : names[arch];
}

function verifyFile(file, label) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`${label} is missing or empty: ${file}`);
  }
  console.log(`Verified ${label}: ${file}`);
}

function verifyNativeSftpDrag(context) {
  const resources = resourcesDir(context);
  const arch = buildArchName(context.arch);
  if (!arch) throw new Error(`Unknown electron-builder architecture: ${context.arch}`);

  if (context.electronPlatformName === "win32") {
    const addon = path.join(
        resources,
        "app.asar.unpacked",
        "native",
        "win-sftp-drag",
        "prebuilds",
        `win32-${arch}`,
        "win_sftp_drag.node"
      );
    verifyFile(addon, `Windows ${arch} SFTP native drag addon`);
    assertNativeArchitecture(addon, arch, "Windows SFTP native drag addon");
    return;
  }

  if (context.electronPlatformName === "darwin") {
    const addon = path.join(
        resources,
        "app.asar.unpacked",
        "native",
        "macos-sftp-drag",
        "prebuilds",
        `darwin-${arch}`,
        "tunneldesk_macos_sftp_drag.node"
      );
    verifyFile(addon, `macOS ${arch} SFTP native drag addon`);
    assertNativeArchitecture(addon, arch, "macOS SFTP native drag addon");
    return;
  }

  if (context.electronPlatformName === "linux") {
    const helper = path.join(resources, "native", "tunneldesk-linux-sftp-dragfs");
    verifyFile(helper, `Linux ${arch} SFTP native drag helper`);
    assertNativeArchitecture(helper, arch, "Linux SFTP native drag helper");
    fs.chmodSync(helper, 0o755);
    const result = childProcess.spawnSync(helper, ["--version"], {
      encoding: "utf8",
      stdio: "pipe"
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Packaged Linux SFTP native drag helper cannot run: ` +
        `${result.error?.message || result.stderr || `exit ${result.status}`}`
      );
    }
    console.log(`Verified executable Linux SFTP native drag helper: ${String(result.stdout).trim()}`);
  }
}

function verifyBundledXServer(context) {
  if (context.electronPlatformName !== "win32") return;
  const runtime = path.join(resourcesDir(context), "xserver");
  verifyFile(path.join(runtime, "vcxsrv.exe"), "Windows bundled X Server");
  verifyFile(path.join(runtime, "xauth.exe"), "Windows bundled xauth");
  verifyFile(path.join(runtime, "tunneldesk-runtime.json"), "Windows bundled X Server manifest");
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "darwin") verifyMacIcon(context);
  verifyNativeSftpDrag(context);
  verifyBundledXServer(context);
  if (!["darwin", "linux"].includes(context.electronPlatformName)) return;

  const nodePtyDir = path.join(resourcesDir(context), "app.asar.unpacked", "node_modules", "node-pty");
  const helpers = walk(nodePtyDir).filter(file => path.basename(file) === "spawn-helper");
  if (!helpers.length) {
    const message = `node-pty spawn-helper not found under ${nodePtyDir}`;
    if (context.electronPlatformName === "darwin") throw new Error(message);
    console.warn(`${message}; PTY fallback remains available.`);
    return;
  }

  for (const helper of helpers) {
    try {
      fs.chmodSync(helper, 0o755);
      console.log(`Prepared executable node-pty helper: ${helper}`);
    } catch (error) {
      if (context.electronPlatformName === "darwin") throw error;
      console.warn(`Could not mark node-pty helper executable: ${helper}: ${error.message}`);
    }
  }
};
