"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const VERSION = "21.1.10.0";
const DOWNLOAD_URL = "https://master.dl.sourceforge.net/project/vcxsrv/vcxsrv/21.1.10/vcxsrv-64.21.1.10.0.installer.exe?viasf=1";
const SHA256 = "f0bdc3f17a2a4c09172c7d0f9dd6b2b3f95b1fdbb2794bd8ffda474c636cced3";
const EXPECTED_BYTES = 41781489;
const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "runtime", "xserver");
const targetDirectory = path.join(runtimeRoot, "win32");
const MANIFEST_NAME = "terma-runtime.json";
const LEGACY_MANIFEST_NAME = "tunneldesk-runtime.json";

function runtimeFiles(directory = targetDirectory) {
  return {
    executable:path.join(directory, "vcxsrv.exe"),
    xauth:path.join(directory, "xauth.exe"),
    manifest:path.join(directory, MANIFEST_NAME),
    legacyManifest:path.join(directory, LEGACY_MANIFEST_NAME)
  };
}

const {
  executable,
  manifest:manifestFile,
  legacyManifest:legacyManifestFile
} = runtimeFiles();

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function verifiedRuntime(directory = targetDirectory) {
  const files = runtimeFiles(directory);
  try {
    if (fs.statSync(files.executable).size <= 0 || fs.statSync(files.xauth).size <= 0) return false;
    let selectedManifest = "";
    for (const candidate of [files.manifest, files.legacyManifest]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (manifest.version === VERSION && manifest.sha256 === SHA256) {
          selectedManifest = candidate;
          break;
        }
      } catch {}
    }
    if (!selectedManifest) return false;
    if (selectedManifest === files.legacyManifest) {
      fs.copyFileSync(files.legacyManifest, files.manifest);
    }
    if (fs.existsSync(files.legacyManifest)) {
      fs.rmSync(files.legacyManifest, {force:true});
    }
    return true;
  } catch {
    return false;
  }
}

function removeTarget() {
  if (!isWithin(runtimeRoot, targetDirectory)) throw new Error(`Refusing to remove unsafe X Server path: ${targetDirectory}`);
  fs.rmSync(targetDirectory, {recursive:true, force:true});
}

function downloadInstallerOnce(destination, url = DOWNLOAD_URL, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers:{"User-Agent":"Terma-XServer-Build", "Accept-Encoding":"identity"}
    }, response => {
      const status = Number(response.statusCode || 0);
      const redirect = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && redirect) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("VcXsrv download failed: too many redirects"));
          return;
        }
        let nextUrl;
        try { nextUrl = new URL(redirect, url); } catch (error) {
          reject(new Error(`VcXsrv download failed: invalid redirect (${error.message})`));
          return;
        }
        if (nextUrl.protocol === "http:") nextUrl.protocol = "https:";
        if (nextUrl.protocol !== "https:") {
          reject(new Error(`VcXsrv download refused non-HTTPS redirect: ${nextUrl.protocol}`));
          return;
        }
        downloadInstallerOnce(destination, nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`VcXsrv download failed: HTTP ${status}`));
        return;
      }
      pipeline(response, fs.createWriteStream(destination, {flags:"wx"})).then(resolve, reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error("VcXsrv download timed out")));
    request.on("error", reject);
  });
}

async function downloadInstaller(destination) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(destination, {force:true});
      await downloadInstallerOnce(destination);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(destination, {force:true});
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

function verifyInstaller(file) {
  const bytes = fs.statSync(file).size;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (bytes !== EXPECTED_BYTES) throw new Error(`VcXsrv installer size mismatch: expected ${EXPECTED_BYTES}, got ${bytes}`);
  if (hash !== SHA256) throw new Error(`VcXsrv installer SHA-256 mismatch: expected ${SHA256}, got ${hash}`);
}

async function prepare() {
  if (process.platform !== "win32") {
    console.log("X Server bundled runtime is only prepared for Windows; current platform uses its native X11 stack.");
    return;
  }
  if (verifiedRuntime()) {
    console.log(`Verified bundled VcXsrv ${VERSION}: ${executable}`);
    return;
  }
  removeTarget();
  fs.mkdirSync(runtimeRoot, {recursive:true});
  const installer = path.join(os.tmpdir(), `terma-vcxsrv-${VERSION}-${process.pid}-${Date.now()}.exe`);
  try {
    console.log(`Downloading VcXsrv ${VERSION} from SourceForge...`);
    await downloadInstaller(installer);
    verifyInstaller(installer);
    fs.mkdirSync(targetDirectory, {recursive:true});
    let result = spawnSync(installer, ["/S", `/D=${targetDirectory}`], {
      encoding:"utf8",
      windowsHide:true,
      timeout:180000
    });
    if (result.error?.code === "EACCES") {
      result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$process = Start-Process -FilePath $env:TERMA_XSERVER_INSTALLER -ArgumentList @('/S',('/D=' + $env:TERMA_XSERVER_TARGET)) -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode"
      ], {
        encoding:"utf8",
        windowsHide:true,
        timeout:180000,
        env:{...process.env, TERMA_XSERVER_INSTALLER:installer, TERMA_XSERVER_TARGET:targetDirectory}
      });
    }
    if (result.error || result.status !== 0) {
      throw new Error(`VcXsrv extraction failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
    }
    if (!fs.existsSync(executable) || !fs.existsSync(path.join(targetDirectory, "xauth.exe"))) {
      throw new Error("VcXsrv extraction did not produce vcxsrv.exe and xauth.exe");
    }
    fs.writeFileSync(manifestFile, `${JSON.stringify({
      name:"VcXsrv",
      version:VERSION,
      source:DOWNLOAD_URL,
      corresponding_source:"https://github.com/marchaesen/vcxsrv/tree/21.1.10",
      sha256:SHA256,
      prepared_at:new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    console.log(`Prepared bundled VcXsrv ${VERSION}: ${targetDirectory}`);
  } catch (error) {
    removeTarget();
    throw error;
  } finally {
    try { fs.rmSync(installer, {force:true}); } catch {}
  }
}

if (require.main === module) {
  if (process.argv.includes("--diagnose")) {
    if (!verifiedRuntime()) {
      console.error(`Bundled VcXsrv ${VERSION} is not prepared: ${targetDirectory}`);
      process.exitCode = 1;
    } else {
      console.log(`Bundled VcXsrv ${VERSION} is ready: ${executable}`);
    }
  } else {
    prepare().catch(error => {
      console.error(error.stack || error.message || String(error));
      process.exitCode = 1;
    });
  }
}

module.exports = {
  DOWNLOAD_URL,
  downloadInstaller,
  EXPECTED_BYTES,
  LEGACY_MANIFEST_NAME,
  MANIFEST_NAME,
  SHA256,
  VERSION,
  runtimeFiles,
  targetDirectory,
  verifiedRuntime
};
