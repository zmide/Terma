const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const {
  blockedDownloadHost,
  aptPrintUrisUsesOnlyCachedPackages,
  buildAptCachedInstallCommand,
  aptOutputNeedsLocalResolution,
  buildAptOfflineInstallCommand,
  buildAptOfflinePreflightCommand,
  buildAptPlatformProbeCommand,
  buildAptPrintUrisCommand,
  normalizeAptPackages,
  parseAptPlatformProbe,
  parseDebianPackageIndex,
  parseAptPrintUris,
  resolveAptPackagesFromOfficialRepositories,
  shouldUseAptRepositoryFallback,
  validateDownloadUrl,
  verifyFileChecksum
} = require("../dist/remote-offline-installer");
const legacyPrefix = ["T", "D"].join("");

const parsed = parseAptPrintUris([
  "Reading package lists...",
  "'https://deb.example.test/pool/main/x/xclip/xclip_0.13-2_amd64.deb' xclip_0.13-2_amd64.deb 23328 MD5Sum:14db11fbe2d9a0722f60ef42740c1496",
  "'https://deb.example.test/pool/main/libx/libxmu/libxmu6_1.1.3-3_amd64.deb' libxmu6_1.1.3-3_amd64.deb 49200 SHA256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
].join("\n"));
assert.equal(parsed.length, 2);
assert.equal(parsed[0].filename, "xclip_0.13-2_amd64.deb");
assert.equal(parsed[0].algorithm, "md5");
assert.equal(parsed[1].algorithm, "sha256");

assert.deepEqual(normalizeAptPackages(["xclip", "x11vnc", "xclip"]), ["xclip", "x11vnc"]);
assert.throws(() => normalizeAptPackages(["xclip;id"]), /软件包名称无效/);
assert.match(buildAptPrintUrisCommand(["xclip", "x11vnc"]), /--print-uris/);
assert.match(buildAptPrintUrisCommand(["xclip", "x11vnc"]), /'xclip' 'x11vnc'/);
assert.doesNotMatch(buildAptPrintUrisCommand(["xclip", "x11vnc"]), /--reinstall/);
assert.equal(aptPrintUrisUsesOnlyCachedPackages("Need to get 0 B/987 kB of archives."), true);
assert.equal(aptPrintUrisUsesOnlyCachedPackages("Need to get 120 kB of archives."), false);
const cachedInstall = buildAptCachedInstallCommand(["xfce4", "xfce4-goodies"]);
assert.match(cachedInstall, /apt-get --no-download install -y 'xfce4' 'xfce4-goodies'/);
assert.doesNotMatch(cachedInstall, /apt-get update|--print-uris/);
assert.match(buildAptPlatformProbeCommand(), /TERMA_APT_INSTALLED=\$\{binary:Package\}/);
assert.equal(buildAptPlatformProbeCommand().includes(`${legacyPrefix}_APT_`), false);
assert.equal(shouldUseAptRepositoryFallback("E: Package 'xclip' has no installation candidate"), true);
assert.equal(shouldUseAptRepositoryFallback("E: 有几个软件包无法下载，要不运行 apt-get update 或者加上 --fix-missing 的选项再试试？"), true);
assert.equal(aptOutputNeedsLocalResolution("E: Unmet dependencies"), true);

const platform = parseAptPlatformProbe([
  "TERMA_APT_OS_ID=Linx",
  "TERMA_APT_CODENAME=buster",
  "TERMA_APT_ARCH=amd64",
  "TERMA_APT_INSTALLED=libx11-6:amd64\tinstall ok installed\t"
].join("\n"));
assert.equal(platform.os_id, "linx");
assert.equal(platform.codename, "buster");
assert.equal(platform.installed.has("libx11-6"), true);
const legacyPlatform = parseAptPlatformProbe([
  `${legacyPrefix}_APT_OS_ID=debian`,
  `${legacyPrefix}_APT_ARCH=arm64`,
  `${legacyPrefix}_APT_INSTALLED=xrdp:arm64\tinstall ok installed\t`
].join("\n"));
assert.equal(legacyPlatform.os_id, "debian");
assert.equal(legacyPlatform.arch, "arm64");
assert.equal(legacyPlatform.installed.has("xrdp"), true);

const packageIndex = [
  "Package: xclip",
  "Version: 0.13-1",
  "Architecture: amd64",
  "Depends: libc6 (>= 2.17), libx11-6",
  "Filename: pool/main/x/xclip/xclip_0.13-1_amd64.deb",
  "Size: 23220",
  `SHA256: ${"a".repeat(64)}`,
  ""
].join("\n");
assert.equal(parseDebianPackageIndex(packageIndex)[0].package, "xclip");

const install = buildAptOfflineInstallCommand("/tmp/terma-offline-test_1", ["xclip", "x11vnc"]);
assert.match(install, /Dir::Etc::sourcelist=\/dev\/null/);
assert.match(install, /Dir::Etc::sourceparts=\/dev\/null/);
assert.match(install, /dpkg --unpack \"\$@\"/);
assert.match(install, /--no-download --fix-broken install -y/);
assert.match(install, /terma-offline-test_1['"]?\/\*\.deb/);
assert.doesNotMatch(install, /apt-get[^\n]*install -y \"\$@\"/);
assert.doesNotMatch(install, /apt-get update/);
const preflight = buildAptOfflinePreflightCommand("/tmp/terma-offline-test_1");
assert.match(preflight, /Dir::Etc::sourcelist=\/dev\/null/);
assert.match(preflight, /Dir::Etc::sourceparts=\/dev\/null/);
assert.match(preflight, /--no-download --simulate install -y/);
assert.match(preflight, /terma-offline-test_1['"]?\/\*\.deb/);
assert.match(preflight, /--simulate install -y \"\$@\"/);
assert.throws(() => buildAptOfflineInstallCommand("/root/packages", ["xclip"]), /目录无效/);

assert.equal(blockedDownloadHost("localhost"), true);
assert.equal(blockedDownloadHost("127.0.0.1"), true);
assert.equal(blockedDownloadHost("169.254.169.254"), true);
assert.equal(blockedDownloadHost("deb.debian.org"), false);
assert.throws(() => validateDownloadUrl("file:///etc/passwd"), /HTTP\/HTTPS/);
assert.throws(() => validateDownloadUrl("http://127.0.0.1/package.deb"), /拒绝/);

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-offline-check-"));
  const filename = path.join(directory, "sample.deb");
  fs.writeFileSync(filename, "Terma offline package check", "utf8");
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  assert.equal(await verifyFileChecksum(filename, "sha256", checksum), true);
  assert.equal(await verifyFileChecksum(filename, "sha256", "0".repeat(64)), false);
  const compressedIndex = zlib.gzipSync(Buffer.from(packageIndex));
  const fallback = await resolveAptPackagesFromOfficialRepositories(["xclip"], {
    os_id:"linx", codename:"buster", arch:"amd64", installed:new Set(["libc6", "libx11-6"]), provided:new Set()
  }, {
    async fetch_impl(url) {
      return String(url).includes("/main/")
        ? {ok:true, arrayBuffer:async () => compressedIndex}
        : {ok:false, arrayBuffer:async () => new ArrayBuffer(0)};
    }
  });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].filename, "xclip_0.13-1_amd64.deb");

  const rdpIndex = [
    "Package: xrdp",
    "Version: 0.9.17-2",
    "Architecture: amd64",
    "Filename: pool/main/x/xrdp/xrdp_0.9.17-2_amd64.deb",
    "Size: 100",
    `SHA256: ${"b".repeat(64)}`,
    "",
    "Package: xorgxrdp",
    "Version: 0.2.17-1",
    "Architecture: amd64",
    "Depends: xrdp (>= 0.9.17)",
    "Filename: pool/main/x/xorgxrdp/xorgxrdp_0.2.17-1_amd64.deb",
    "Size: 200",
    `SHA256: ${"c".repeat(64)}`,
    ""
  ].join("\n");
  const installedXrdp = await resolveAptPackagesFromOfficialRepositories(["xrdp", "xorgxrdp"], {
    os_id:"debian", codename:"buster", arch:"amd64", installed:new Set(["xrdp"]), provided:new Set()
  }, {
    async fetch_impl(url) {
      return String(url).includes("/main/")
        ? {ok:true, arrayBuffer:async () => zlib.gzipSync(Buffer.from(rdpIndex))}
        : {ok:false, arrayBuffer:async () => new ArrayBuffer(0)};
    }
  });
  assert.deepEqual(installedXrdp.map(item => item.filename), ["xorgxrdp_0.2.17-1_amd64.deb"]);
  assert.match(fallback[0].url, /^https:\/\/archive\.debian\.org\/debian\/pool\/main\/x\/xclip\//);
  const recommendIndex = [
    "Package: xclip",
    "Version: 0.13-1",
    "Architecture: amd64",
    "Depends: libc6",
    "Recommends: xauth",
    "Filename: pool/main/x/xclip/xclip_0.13-1_amd64.deb",
    "Size: 23220",
    `SHA256: ${"a".repeat(64)}`,
    "",
    "Package: xauth",
    "Version: 1.1.2-1",
    "Architecture: amd64",
    "Depends: libc6",
    "Filename: pool/main/x/xauth/xauth_1.1.2-1_amd64.deb",
    "Size: 1234",
    `SHA256: ${"b".repeat(64)}`,
    ""
  ].join("\n");
  const recommended = await resolveAptPackagesFromOfficialRepositories(["xclip"], {
    os_id:"linx", codename:"buster", arch:"amd64", installed:new Set(["libc6"]), provided:new Set()
  }, {
    async fetch_impl() {
      return {ok:true, arrayBuffer:async () => zlib.gzipSync(Buffer.from(recommendIndex))};
    }
  });
  assert.deepEqual(recommended.map(item => item.filename), ["xauth_1.1.2-1_amd64.deb", "xclip_0.13-1_amd64.deb"]);
  fs.rmSync(directory, {recursive:true, force:true});
  console.log("remote offline installer checks passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
