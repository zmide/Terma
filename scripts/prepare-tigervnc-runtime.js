"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const VERSION = "1.16.2";
const SOURCE_ROOT = "https://downloads.sourceforge.net/tigervnc";
const RELEASES = Object.freeze({
  win32: {
    arch: "x64",
    file: `vncviewer64-${VERSION}.exe`,
    url: `${SOURCE_ROOT}/vncviewer64-${VERSION}.exe`,
    bytes: 24072224,
    sha256: "58396d99556026da6b906c9ed51ad6cb5c840cc3fb65e53653c52ca5a80bfad9"
  },
  darwin: {
    arch: "universal",
    file: `TigerVNC-${VERSION}.dmg`,
    url: `${SOURCE_ROOT}/TigerVNC-${VERSION}.dmg`,
    bytes: 6845311,
    sha256: "aa0ef07e4ebe4f068cbf1118273459b5b616177cb6abf15a538af018ebfb5933"
  },
  linux: {
    arch: "x64",
    file: `tigervnc-${VERSION}.x86_64.tar.gz`,
    url: `${SOURCE_ROOT}/tigervnc-${VERSION}.x86_64.tar.gz`,
    bytes: 15042988,
    sha256: "5b70c84baefc09a030cfc78315c34ccb55b2a0dde4092b7da67a1962c5f0dea6"
  }
});

const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "runtime", "tigervnc");
const manifestName = "terma-tigervnc.json";

function platformRelease(platform = process.platform, arch = process.arch) {
  const release = RELEASES[platform];
  if (!release) return null;
  if (platform === "win32" && arch !== "x64") throw new Error(`TigerVNC bundled viewer supports Windows x64 only (got ${arch})`);
  if (platform === "linux" && arch !== "x64") throw new Error(`TigerVNC bundled viewer supports Linux x64 only (got ${arch})`);
  return release;
}

function targetDirectory(platform = process.platform, arch = process.arch) {
  const release = platformRelease(platform, arch);
  return release ? path.join(runtimeRoot, `${platform}-${release.arch}`) : "";
}

function runtimeFiles(platform = process.platform, arch = process.arch) {
  const directory = targetDirectory(platform, arch);
  return {
    directory,
    executable: platform === "darwin"
      ? path.join(directory, "TigerVNC.app", "Contents", "MacOS", "vncviewer")
      : path.join(directory, platform === "win32" ? "vncviewer.exe" : "vncviewer"),
    manifest: path.join(directory, manifestName),
    license: path.join(directory, "TIGERVNC_LICENSE.txt")
  };
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifiedRuntime(platform = process.platform, arch = process.arch) {
  const release = platformRelease(platform, arch);
  if (!release) return false;
  const files = runtimeFiles(platform, arch);
  try {
    if (!fs.statSync(files.executable).isFile() || fs.statSync(files.executable).size <= 0) return false;
    const manifest = JSON.parse(fs.readFileSync(files.manifest, "utf8"));
    return manifest.name === "TigerVNC Viewer"
      && manifest.version === VERSION
      && manifest.platform === platform
      && manifest.arch === release.arch
      && manifest.source_sha256 === release.sha256
      && manifest.executable_sha256 === fileSha256(files.executable);
  } catch {
    return false;
  }
}

function removeTarget(platform = process.platform, arch = process.arch) {
  const directory = targetDirectory(platform, arch);
  if (!directory || !isWithin(runtimeRoot, directory)) throw new Error(`Refusing to remove unsafe TigerVNC path: ${directory}`);
  fs.rmSync(directory, {recursive:true, force:true});
}

function downloadOnce(destination, url, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers:{"User-Agent":"Terma-TigerVNC-Build", "Accept-Encoding":"identity"}
    }, response => {
      const status = Number(response.statusCode || 0);
      const redirect = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && redirect) {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error("TigerVNC download failed: too many redirects"));
        let next;
        try { next = new URL(redirect, url); } catch (error) { return reject(new Error(`TigerVNC download failed: invalid redirect (${error.message})`)); }
        if (next.protocol === "http:") next.protocol = "https:";
        if (next.protocol !== "https:") return reject(new Error(`TigerVNC download refused non-HTTPS redirect: ${next.protocol}`));
        return downloadOnce(destination, next, redirectsLeft - 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`TigerVNC download failed: HTTP ${status}`));
      }
      pipeline(response, fs.createWriteStream(destination, {flags:"wx"})).then(resolve, reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error("TigerVNC download timed out")));
    request.on("error", reject);
  });
}

async function downloadRelease(destination, release) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(destination, {force:true});
      await downloadOnce(destination, release.url);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(destination, {force:true});
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function verifyDownload(file, release) {
  const bytes = fs.statSync(file).size;
  const sha256 = fileSha256(file);
  if (bytes !== release.bytes) throw new Error(`TigerVNC ${release.file} size mismatch: expected ${release.bytes}, got ${bytes}`);
  if (sha256 !== release.sha256) throw new Error(`TigerVNC ${release.file} SHA-256 mismatch: expected ${release.sha256}, got ${sha256}`);
}

function copyLicense(sourceRoot, target) {
  const candidates = [
    path.join(sourceRoot, "usr", "share", "doc", "tigervnc", "LICENCE.TXT"),
    path.join(sourceRoot, "Contents", "Resources", "LICENSE.txt"),
    path.join(sourceRoot, "Contents", "Resources", "LICENSE")
  ];
  const source = candidates.find(file => fs.existsSync(file));
  fs.writeFileSync(target, source ? fs.readFileSync(source) : "TigerVNC is distributed under the GNU GPL v2.0 or later.\n", "utf8");
}

function mountDmg(file) {
  const result = spawnSync("hdiutil", ["attach", file, "-nobrowse", "-readonly", "-plist"], {encoding:"utf8"});
  if (result.error || result.status !== 0) throw new Error(`TigerVNC DMG mount failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  const matches = [...String(result.stdout || "").matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)];
  const mountPoint = matches.map(match => match[1]).find(value => fs.existsSync(value));
  if (!mountPoint) throw new Error("TigerVNC DMG mount did not return a usable mount point");
  return mountPoint;
}

function findDirectory(root, predicate) {
  if (!fs.existsSync(root)) return "";
  for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && predicate(full, entry.name)) return full;
    if (entry.isDirectory()) {
      const nested = findDirectory(full, predicate);
      if (nested) return nested;
    }
  }
  return "";
}

function extractMacDmg(archive, target) {
  const mountPoint = mountDmg(archive);
  try {
    const app = findDirectory(mountPoint, (_file, name) => /tigervnc.*\.app$/i.test(name));
    if (!app) throw new Error("TigerVNC DMG does not contain a Viewer.app bundle");
    fs.cpSync(app, path.join(target, "TigerVNC.app"), {recursive:true});
    fs.chmodSync(path.join(target, "TigerVNC.app", "Contents", "MacOS", "vncviewer"), 0o755);
    copyLicense(path.join(target, "TigerVNC.app"), path.join(target, "TIGERVNC_LICENSE.txt"));
  } finally {
    spawnSync("hdiutil", ["detach", mountPoint, "-force"], {encoding:"utf8", stdio:"pipe"});
  }
}

function extractLinuxArchive(archive, target) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-tigervnc-"));
  try {
    const result = spawnSync("tar", ["-xzf", archive, "-C", temporary], {encoding:"utf8", stdio:"pipe"});
    if (result.error || result.status !== 0) throw new Error(`TigerVNC Linux archive extraction failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
    const executable = findDirectory(temporary, (_file, name) => name === "bin")
      ? path.join(findDirectory(temporary, (_file, name) => name === "bin"), "vncviewer")
      : "";
    if (!executable || !fs.existsSync(executable)) throw new Error("TigerVNC Linux archive does not contain usr/bin/vncviewer");
    fs.copyFileSync(executable, path.join(target, "vncviewer"));
    fs.chmodSync(path.join(target, "vncviewer"), 0o755);
    const sourceRoot = path.dirname(path.dirname(path.dirname(executable)));
    copyLicense(sourceRoot, path.join(target, "TIGERVNC_LICENSE.txt"));
  } finally {
    fs.rmSync(temporary, {recursive:true, force:true});
  }
}

async function prepare(platform = process.platform, arch = process.arch) {
  const release = platformRelease(platform, arch);
  if (!release) {
    console.log(`TigerVNC bundled runtime is not prepared for ${platform}; noVNC/system fallback remains available.`);
    return;
  }
  if (verifiedRuntime(platform, arch)) {
    console.log(`Verified bundled TigerVNC ${VERSION}: ${runtimeFiles(platform, arch).executable}`);
    return;
  }
  const files = runtimeFiles(platform, arch);
  removeTarget(platform, arch);
  fs.mkdirSync(files.directory, {recursive:true});
  const archive = path.join(os.tmpdir(), `terma-tigervnc-${VERSION}-${process.pid}-${Date.now()}${platform === "darwin" ? ".dmg" : platform === "win32" ? ".exe" : ".tar.gz"}`);
  try {
    console.log(`Downloading TigerVNC ${VERSION} from SourceForge...`);
    await downloadRelease(archive, release);
    verifyDownload(archive, release);
    if (platform === "win32") {
      fs.copyFileSync(archive, files.executable);
      copyLicense(projectRoot, files.license);
    } else if (platform === "darwin") extractMacDmg(archive, files.directory);
    else extractLinuxArchive(archive, files.directory);
    fs.writeFileSync(files.manifest, `${JSON.stringify({
      name:"TigerVNC Viewer",
      version:VERSION,
      platform,
      arch:release.arch,
      source:release.url,
      source_sha256:release.sha256,
      source_bytes:release.bytes,
      executable: path.relative(files.directory, files.executable).replaceAll(path.sep, "/"),
      executable_sha256:fileSha256(files.executable),
      prepared_at:new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    console.log(`Prepared bundled TigerVNC ${VERSION}: ${files.directory}`);
  } catch (error) {
    removeTarget(platform, arch);
    throw error;
  } finally {
    try { fs.rmSync(archive, {force:true}); } catch {}
  }
}

if (require.main === module) {
  if (process.argv.includes("--diagnose")) {
    if (!verifiedRuntime()) {
      console.error(`Bundled TigerVNC ${VERSION} is not prepared: ${targetDirectory() || "unsupported platform"}`);
      process.exitCode = 1;
    } else console.log(`Bundled TigerVNC ${VERSION} is ready: ${runtimeFiles().executable}`);
  } else prepare().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
}

module.exports = {
  RELEASES,
  SOURCE_ROOT,
  VERSION,
  downloadRelease,
  fileSha256,
  manifestName,
  platformRelease,
  runtimeFiles,
  targetDirectory,
  verifiedRuntime
};
