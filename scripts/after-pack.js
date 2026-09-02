"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { assertNativeArchitecture } = require("./native-binary-check");
const { VERSION: TIGERVNC_VERSION } = require("./prepare-tigervnc-runtime");
const { verifyMacIconPadding } = require("./mac-icon-padding-check");

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
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-icon-"));
  try {
    const iconsetPath = path.join(temporaryRoot, "Terma.iconset");
    const extraction = childProcess.spawnSync(
      "/usr/bin/iconutil",
      ["-c", "iconset", iconPath, "-o", iconsetPath],
      { encoding: "utf8", stdio: "pipe" }
    );
    if (extraction.error || extraction.status !== 0) {
      throw new Error(
        `Could not inspect macOS bundle icon: ` +
        `${extraction.error?.message || extraction.stderr || `exit ${extraction.status}`}`
      );
    }
    verifyMacIconPadding(path.join(iconsetPath, "icon_512x512@2x.png"));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
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
        "terma_macos_sftp_drag.node"
      );
    verifyFile(addon, `macOS ${arch} SFTP native drag addon`);
    assertNativeArchitecture(addon, arch, "macOS SFTP native drag addon");
    return;
  }

  if (context.electronPlatformName === "linux") {
    const helper = path.join(resources, "native", "terma-linux-sftp-dragfs");
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
  verifyFile(path.join(runtime, "terma-runtime.json"), "Windows bundled X Server manifest");
  if (fs.existsSync(path.join(runtime, "tunneldesk-runtime.json"))) {
    throw new Error("Windows bundled X Server contains the legacy TunnelDesk manifest");
  }
}

function verifyBundledTigerVnc(context) {
  const platform = context.electronPlatformName;
  const runtime = path.join(resourcesDir(context), "tigervnc");
  const executable = platform === "darwin"
    ? path.join(runtime, "TigerVNC.app", "Contents", "MacOS", "vncviewer")
    : path.join(runtime, platform === "win32" ? "vncviewer.exe" : "vncviewer");
  const manifestPath = path.join(runtime, "terma-tigervnc.json");
  verifyFile(executable, `${platform} bundled TigerVNC Viewer`);
  verifyFile(manifestPath, `${platform} bundled TigerVNC manifest`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const relativeExecutable = path.relative(runtime, executable).replaceAll(path.sep, "/");
  const executableSha256 = crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
  if (manifest.name !== "TigerVNC Viewer" || manifest.version !== TIGERVNC_VERSION || manifest.platform !== platform) {
    throw new Error(`Bundled TigerVNC manifest identity mismatch: ${manifestPath}`);
  }
  if (manifest.executable !== relativeExecutable || manifest.executable_sha256 !== executableSha256) {
    throw new Error(`Bundled TigerVNC manifest does not match its executable: ${manifestPath}`);
  }
  if (platform !== "win32") fs.chmodSync(executable, 0o755);
  const arch = buildArchName(context.arch);
  if (arch && arch !== "universal") {
    assertNativeArchitecture(executable, arch, `${platform} bundled TigerVNC Viewer`);
  }
  if (fs.existsSync(path.join(runtime, "tunneldesk-tigervnc.json"))) {
    throw new Error(`Bundled TigerVNC runtime contains a legacy manifest: ${runtime}`);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "darwin") verifyMacIcon(context);
  verifyNativeSftpDrag(context);
  verifyBundledXServer(context);
  verifyBundledTigerVnc(context);
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
