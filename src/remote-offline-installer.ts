const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const zlib = require("zlib");
const { selectRemoteProbeLines } = require("./remote-probe-protocol");

const APT_PACKAGE_RE = /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?$/i;
const MAX_APT_PACKAGES = 512;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const APT_INDEX_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_APT_INDEX_BYTES = 128 * 1024 * 1024;

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function normalizeAptPackages(values) {
  const packages = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
  if (!packages.length) throw new Error("离线安装没有指定软件包");
  if (packages.length > MAX_APT_PACKAGES) throw new Error(`单次离线安装最多解析 ${MAX_APT_PACKAGES} 个软件包`);
  for (const packageName of packages) {
    if (!APT_PACKAGE_RE.test(packageName)) throw new Error(`软件包名称无效：${packageName}`);
  }
  return packages;
}

function buildAptPrintUrisCommand(packages) {
  const normalized = normalizeAptPackages(packages);
  // Do not force already installed packages back into the bundle. A host may
  // have a newer vendor or locally built package than the configured mirror;
  // uploading the older archive would turn a dependency install into an
  // unexpected downgrade during remote preflight.
  return `LC_ALL=C apt-get --print-uris --yes --download-only install ${normalized.map(shellQuote).join(" ")}`;
}

function buildAptPlatformProbeCommand() {
  return [
    "set +e",
    `terma_os_value() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | head -n 1 | sed 's/^"//;s/"$//' | tr '\\r\\n=' '   '; }`,
    `printf 'TERMA_APT_OS_ID=%s\\n' "$(terma_os_value ID)"`,
    `printf 'TERMA_APT_OS_LIKE=%s\\n' "$(terma_os_value ID_LIKE)"`,
    `printf 'TERMA_APT_CODENAME=%s\\n' "$(terma_os_value VERSION_CODENAME)"`,
    `printf 'TERMA_APT_UBUNTU_CODENAME=%s\\n' "$(terma_os_value UBUNTU_CODENAME)"`,
    `printf 'TERMA_APT_VERSION_ID=%s\\n' "$(terma_os_value VERSION_ID)"`,
    `printf 'TERMA_APT_ARCH=%s\\n' "$(dpkg --print-architecture 2>/dev/null)"`,
    "dpkg-query -W -f='TERMA_APT_INSTALLED=${binary:Package}\\t${Status}\\t${Provides}\\n' 2>/dev/null"
  ].join("\n");
}

function parseAptPlatformProbe(output) {
  const result: any = {installed:new Set(), provided:new Set()};
  for (const line of selectRemoteProbeLines(output, "APT_")) {
    const field = /^(OS_ID|OS_LIKE|CODENAME|UBUNTU_CODENAME|VERSION_ID|ARCH)=(.*)$/.exec(line);
    if (field) {
      result[field[1].toLowerCase()] = field[2].trim().toLowerCase();
      continue;
    }
    const installed = /^INSTALLED=([^\t]+)\tinstall ok installed(?:\t(.*))?$/.exec(line);
    if (!installed) continue;
    const packageName = installed[1].replace(/:[a-z0-9-]+$/i, "");
    if (packageName) result.installed.add(packageName);
    for (const provided of String(installed[2] || "").split(",")) {
      const name = provided.trim().replace(/\s*\(=.*\)$/, "").replace(/:[a-z0-9-]+$/i, "");
      if (name) result.provided.add(name);
    }
  }
  result.codename = result.ubuntu_codename || result.codename || "";
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(result.codename || "")) result.codename = "";
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(result.arch || "")) result.arch = "";
  return result;
}

function parseDebianPackageIndex(text) {
  const entries = [];
  for (const paragraph of String(text || "").split(/\n\s*\n/)) {
    const fields = new Map();
    let current = "";
    for (const rawLine of paragraph.split(/\r?\n/)) {
      if (/^[ \t]/.test(rawLine) && current) {
        fields.set(current, `${fields.get(current) || ""} ${rawLine.trim()}`.trim());
        continue;
      }
      const match = /^([^:]+):\s*(.*)$/.exec(rawLine);
      if (!match) continue;
      current = match[1].trim().toLowerCase();
      fields.set(current, match[2].trim());
    }
    const packageName = String(fields.get("package") || "").trim();
    const filename = String(fields.get("filename") || "").trim();
    if (!packageName || !filename) continue;
    entries.push({
      package:packageName,
      version:String(fields.get("version") || ""),
      architecture:String(fields.get("architecture") || ""),
      filename,
      size:Number(fields.get("size") || 0),
      sha256:String(fields.get("sha256") || "").toLowerCase(),
      // apt installs Recommends by default.  Omitting it from the offline
      // closure leaves packages such as xclip without xauth and makes
      // `apt-get --no-download` reach the network during preflight.
      depends:[
        String(fields.get("pre-depends") || ""),
        String(fields.get("depends") || ""),
        String(fields.get("recommends") || "")
      ].filter(Boolean).join(", "),
      provides:String(fields.get("provides") || "")
    });
  }
  return entries;
}

function dependencyGroups(value) {
  return String(value || "").split(",").map(group => group.split("|").map(item => item.trim()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/:[a-z0-9-]+$/i, "")
    .trim()).filter(Boolean)).filter(group => group.length);
}

function aptRepositoryCandidates(platform: any = {}) {
  const codename = String(platform.codename || "").toLowerCase();
  const arch = String(platform.arch || "").toLowerCase();
  if (!codename || !arch) return [];
  const id = String(platform.os_id || "").toLowerCase();
  const like = String(platform.os_like || "").toLowerCase();
  const ubuntu = id === "ubuntu" || like.split(/\s+/).includes("ubuntu");
  if (ubuntu) {
    const primary = ["amd64", "i386"].includes(arch) ? "https://archive.ubuntu.com/ubuntu" : "https://ports.ubuntu.com/ubuntu-ports";
    return [primary, "https://old-releases.ubuntu.com/ubuntu"].map(base => ({base, suite:codename, components:["main", "universe", "restricted", "multiverse"]}));
  }
  const archiveFirst = ["squeeze", "wheezy", "jessie", "stretch", "buster"].includes(codename);
  const bases = archiveFirst
    ? ["https://archive.debian.org/debian", "https://deb.debian.org/debian"]
    : ["https://deb.debian.org/debian", "https://archive.debian.org/debian"];
  return bases.map(base => ({base, suite:codename, components:["main", "contrib", "non-free", "non-free-firmware"]}));
}

async function fetchAptIndex(url, options: any = {}) {
  const fetchImpl = options.fetch_impl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeout_ms || APT_INDEX_TIMEOUT_MS));
  try {
    const response = await fetchImpl(url, {signal:controller.signal, headers:{"User-Agent":"Terma offline installer"}});
    if (!response?.ok) return null;
    const compressed = Buffer.from(await response.arrayBuffer());
    const content = zlib.gunzipSync(compressed, {maxOutputLength:MAX_APT_INDEX_BYTES});
    return parseDebianPackageIndex(content.toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

function resolveRepositoryEntries(packages, platform, entries, repositoryBase) {
  const byName = new Map();
  const providers = new Map();
  for (const entry of entries) {
    if (!byName.has(entry.package)) byName.set(entry.package, entry);
    for (const provided of String(entry.provides || "").split(",")) {
      const name = provided.trim().replace(/\s*\(=.*\)$/, "");
      if (name && !providers.has(name)) providers.set(name, entry);
    }
  }
  const installed = platform.installed instanceof Set ? platform.installed : new Set();
  const installedProvides = platform.provided instanceof Set ? platform.provided : new Set();
  const requested = normalizeAptPackages(packages);
  const selected = new Map();
  const visiting = new Set();
  function include(packageName, direct = false) {
    const normalized = String(packageName || "").replace(/:[a-z0-9-]+$/i, "");
    if (installed.has(normalized) || installedProvides.has(normalized)) return;
    if (selected.has(normalized) || visiting.has(normalized)) return;
    const entry = byName.get(normalized) || providers.get(normalized);
    if (!entry) throw new Error(`官方软件源索引中没有找到依赖：${normalized}`);
    visiting.add(normalized);
    for (const group of dependencyGroups(entry.depends)) {
      if (group.some(name => installed.has(name) || installedProvides.has(name) || selected.has(name))) continue;
      const candidate = group.find(name => byName.has(name) || providers.has(name));
      if (!candidate) throw new Error(`官方软件源索引中没有找到依赖：${group.join(" 或 ")}`);
      include(candidate, false);
    }
    visiting.delete(normalized);
    selected.set(entry.package, entry);
  }
  for (const packageName of requested) include(packageName, true);
  return [...selected.values()].map(entry => ({
    url:new URL(entry.filename, `${repositoryBase.replace(/\/$/, "")}/`).toString(),
    filename:safePackageFilename(entry.filename),
    size:Number(entry.size || 0),
    algorithm:entry.sha256 ? "sha256" : "",
    checksum:entry.sha256 || ""
  }));
}

async function resolveAptPackagesFromOfficialRepositories(packages, platform: any = {}, options: any = {}) {
  const normalized = normalizeAptPackages(packages);
  const repositories = aptRepositoryCandidates(platform);
  if (!repositories.length) throw new Error("无法从远端识别 Debian/Ubuntu 版本和架构，不能由本机刷新离线软件包索引");
  let lastError = null;
  for (const repository of repositories) {
    const entries = [];
    for (const component of repository.components) {
      const url = `${repository.base}/dists/${repository.suite}/${component}/binary-${platform.arch}/Packages.gz`;
      options.onIndex?.({url, component, repository:repository.base});
      let parsed = null;
      try { parsed = await fetchAptIndex(url, options); } catch (error) { lastError = error; }
      if (!parsed?.length) continue;
      entries.push(...parsed);
      try { return resolveRepositoryEntries(normalized, platform, entries, repository.base); }
      catch (error) { lastError = error; }
    }
  }
  throw new Error(lastError?.message || `官方 Debian/Ubuntu 软件源没有找到：${normalized.join(", ")}`);
}

function shouldUseAptRepositoryFallback(output) {
  const text = String(output || "");
  // A remote apt cache can be stale even when the requested package exists.
  // Treat index, mirror and partial-download failures as recoverable: the
  // caller can identify the remote platform and resolve the bundle locally.
  return /no installation candidate|unable to locate package|is not available|has no installation candidate|failed to fetch|some files failed to download|some packages? (?:could not|cannot) be downloaded|could not download|cannot download|you may want to run .*apt(?:-get)? update|run apt(?:-get)? update|--fix-missing|hash sum mismatch|temporary failure resolving|could(?:n't| not) connect|connection failed|network is unreachable|no release file|does not have a release file|404 not found|无法下载|无法获取|不能下载|有几个软件包无法下载|软件包.*无法下载|运行.*apt(?:-get)? update|fix-missing/i.test(text);
}

function aptOutputNeedsLocalResolution(output) {
  const text = String(output || "");
  return shouldUseAptRepositoryFallback(text)
    || /没有返回可下载的软件包地址|没有找到可下载|no (?:download|uri|package) (?:was )?found|unmet dependencies|依赖关系|无法解析软件包/i.test(text);
}

function safePackageFilename(value) {
  const name = path.basename(String(value || "")).replace(/[^a-zA-Z0-9+._~-]/g, "_");
  if (!name || !name.endsWith(".deb")) throw new Error(`无法识别离线软件包文件名：${value || "未知"}`);
  return name;
}

function parseAptPrintUris(output) {
  const packages = [];
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^'([^']+)'\s+(\S+)\s+(\d+)(?:\s+([A-Za-z0-9]+):([A-Fa-f0-9]+))?/.exec(line);
    if (!match) continue;
    const url = new URL(match[1]);
    if (!/^https?:$/.test(url.protocol)) throw new Error(`离线软件包地址协议不受支持：${url.protocol}`);
    const filename = safePackageFilename(match[2] || decodeURIComponent(path.basename(url.pathname)));
    const size = Number(match[3] || 0);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`离线软件包大小无效：${filename}`);
    const hashKind = String(match[4] || "").toLowerCase();
    const algorithm = hashKind === "sha256" ? "sha256" : hashKind === "sha512" ? "sha512" : hashKind === "md5sum" ? "md5" : "";
    packages.push({url:url.toString(), filename, size, algorithm, checksum:String(match[5] || "").toLowerCase()});
  }
  if (!packages.length) throw new Error("远端 apt 没有返回可下载的软件包地址；请先更新远端软件源索引，或使用导入离线包/手动说明");
  const seen = new Set();
  return packages.filter(item => {
    const key = `${item.filename}\n${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockedDownloadHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (/^127\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return false;
}

function validateDownloadUrl(value) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error(`仅支持 HTTP/HTTPS 离线软件包地址：${url.protocol}`);
  if (url.username || url.password) throw new Error("离线软件包地址不能包含账号或密码");
  if (blockedDownloadHost(url.hostname)) throw new Error(`为避免访问本机敏感服务，已拒绝离线软件包地址：${url.hostname}`);
  return url;
}

async function downloadPackage(item, directory, options: any = {}) {
  const target = path.join(directory, safePackageFilename(item.filename));
  const expectedSize = Math.max(0, Number(item.size || 0));
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if ((!expectedSize || stat.size === expectedSize) && await verifyFileChecksum(target, item.algorithm, item.checksum)) {
      options.onProgress?.({phase:"download", filename:item.filename, bytes:stat.size, total:expectedSize || stat.size, cached:true});
      return target;
    }
    fs.rmSync(target, {force:true});
  }
  let current = validateDownloadUrl(item.url);
  let response;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeout_ms || DOWNLOAD_TIMEOUT_MS));
    try {
      response = await fetch(current, {redirect:"manual", signal:controller.signal, headers:{"User-Agent":"Terma offline installer"}});
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error(`软件下载重定向缺少目标地址：${current.hostname}`);
    current = validateDownloadUrl(new URL(location, current).toString());
    response.body?.cancel?.().catch?.(() => {});
    if (redirects === MAX_REDIRECTS) throw new Error(`软件下载重定向次数过多：${item.filename}`);
  }
  if (!response?.ok || !response.body) throw new Error(`本机下载 ${item.filename} 失败：HTTP ${response?.status || "未知"}`);
  fs.mkdirSync(directory, {recursive:true});
  const partial = `${target}.part-${crypto.randomBytes(6).toString("hex")}`;
  let downloaded = 0;
  const counter = new (require("stream").Transform)({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length;
      options.onProgress?.({phase:"download", filename:item.filename, bytes:downloaded, total:expectedSize});
      callback(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(partial, {flags:"wx"}));
    if (expectedSize && downloaded !== expectedSize) throw new Error(`软件下载不完整：${item.filename}，应为 ${expectedSize} 字节，实际 ${downloaded} 字节`);
    if (!await verifyFileChecksum(partial, item.algorithm, item.checksum)) throw new Error(`软件包校验失败：${item.filename}`);
    fs.renameSync(partial, target);
    return target;
  } catch (error) {
    fs.rmSync(partial, {force:true});
    throw error;
  }
}

async function verifyFileChecksum(filename, algorithm, expected) {
  if (!algorithm || !expected) return true;
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(filename), hash);
  return hash.digest("hex").toLowerCase() === String(expected).toLowerCase();
}

async function downloadAptBundle(items, options: any = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), "terma-offline-"));
  fs.mkdirSync(directory, {recursive:true});
  const files = [];
  for (const item of items) files.push(await downloadPackage(item, directory, options));
  return {directory, files, bytes:files.reduce((total, filename) => total + fs.statSync(filename).size, 0)};
}

function buildAptOfflineInstallCommand(remoteDirectory, packages) {
  const directory = String(remoteDirectory || "").trim();
  if (!/^\/tmp\/terma-offline-[a-zA-Z0-9_-]+$/.test(directory)) throw new Error("远端离线安装目录无效");
  const normalized = normalizeAptPackages(packages);
  return [
    "set -eu",
    `test -d ${shellQuote(directory)}`,
    `set -- ${shellQuote(directory)}/*.deb`,
    "test -f \"$1\"",
    // Apt can simulate absolute local .deb arguments but, on some releases,
    // rewrites them to basenames before the real dpkg invocation.  Unpack the
    // uploaded archives with dpkg first, then let apt configure the already
    // unpacked dependency set without consulting or downloading from sources.
    `LC_ALL=C dpkg --unpack "$@"`,
    `LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::sourcelist=/dev/null -o Dir::Etc::sourceparts=/dev/null --no-download --fix-broken install -y`,
    `dpkg-query -W -f='\${Package} \${Status}\\n' ${normalized.map(shellQuote).join(" ")}`
  ].join("\n");
}

function buildAptOfflinePreflightCommand(remoteDirectory) {
  const directory = String(remoteDirectory || "").trim();
  if (!/^\/tmp\/terma-offline-[a-zA-Z0-9_-]+$/.test(directory)) throw new Error("远端离线安装目录无效");
  return [
    "set +e",
    `test -d ${shellQuote(directory)}`,
    `set -- ${shellQuote(directory)}/*.deb`,
    "test -f \"$1\"",
    // Simulate with the package sources disabled.  Apt then resolves against
    // the local .deb arguments and packages already installed on the host;
    // missing archives fail here instead of being downloaded during install.
    `LC_ALL=C DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::sourcelist=/dev/null -o Dir::Etc::sourceparts=/dev/null --no-download --simulate install -y "$@"`
  ].join("\n");
}

module.exports = {
  aptOutputNeedsLocalResolution,
  blockedDownloadHost,
  buildAptOfflineInstallCommand,
  buildAptOfflinePreflightCommand,
  buildAptPlatformProbeCommand,
  buildAptPrintUrisCommand,
  downloadAptBundle,
  normalizeAptPackages,
  parseAptPlatformProbe,
  parseDebianPackageIndex,
  parseAptPrintUris,
  resolveAptPackagesFromOfficialRepositories,
  shouldUseAptRepositoryFallback,
  validateDownloadUrl,
  verifyFileChecksum
};
