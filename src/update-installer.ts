import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  digest?: string;
  content_type?: string;
}

export interface UpdateRelease {
  current_version?: string;
  latest_version: string;
  update_available: boolean;
  assets: UpdateAsset[];
}

export interface UpdateDownloadProbeResult {
  id: string;
  label: string;
  available: boolean;
  elapsed_ms?: number;
  bytes_per_second?: number;
  error?: string;
}

export interface UpdateDownloadState {
  schema_version: number;
  state: "idle" | "downloading" | "downloaded" | "failed";
  version?: string;
  asset_name?: string;
  selected_asset_name?: string;
  selected_asset_size?: number;
  file?: string;
  size?: number;
  bytes_downloaded?: number;
  progress_percent?: number;
  phase?: "probing" | "downloading" | "verifying";
  source_id?: string;
  source_label?: string;
  source_speed_bytes_per_second?: number;
  probe_results?: UpdateDownloadProbeResult[];
  digest?: string;
  downloaded_at?: string;
  error?: string;
  platform?: string;
  arch?: string;
  package_type?: string;
}

export interface UpdateCleanupResult {
  matched: boolean;
  removed: boolean;
  retry: boolean;
}

interface UpdateInstallerOptions {
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  windowsPackageType?: "installer" | "portable";
  probeBytes?: number;
  probeTimeoutMs?: number;
  downloadIdleTimeoutMs?: number;
}

interface UpdateDownloadRoute {
  id: string;
  label: string;
  prefix: string;
}

interface RankedUpdateDownloadRoute extends UpdateDownloadRoute {
  url: string;
  probe: UpdateDownloadProbeResult;
}

export const UPDATE_DOWNLOAD_ROUTES: readonly UpdateDownloadRoute[] = Object.freeze([
  { id:"direct", label:"直连", prefix:"" },
  { id:"ghfast", label:"ghfast.top", prefix:"https://ghfast.top/" },
  { id:"gh-proxy-v6", label:"v6.gh-proxy.org", prefix:"https://v6.gh-proxy.org/" },
  { id:"gh-proxy-hk", label:"hk.gh-proxy.org", prefix:"https://hk.gh-proxy.org/" },
  { id:"gh-proxy-cdn", label:"cdn.gh-proxy.org", prefix:"https://cdn.gh-proxy.org/" },
  { id:"gh-proxy-edgeone", label:"edgeone.gh-proxy.org", prefix:"https://edgeone.gh-proxy.org/" }
]);

const DEFAULT_UPDATE_PROBE_BYTES = 256 * 1024;
const DEFAULT_UPDATE_PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const TRUSTED_GITHUB_ASSET_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com"
]);

function normalizeVersion(value: unknown): string {
  return String(value || "").trim().replace(/^v/i, "");
}

function trustedGitHubAssetUrl(value: string): URL {
  const source = new URL(value);
  if (
    source.protocol !== "https:"
    || !TRUSTED_GITHUB_ASSET_HOSTS.has(source.hostname)
    || source.username
    || source.password
    || source.search
    || source.hash
  ) {
    throw new Error("更新下载地址不是受信任的 GitHub HTTPS 地址");
  }
  if (source.hostname === "github.com") {
    const segments = source.pathname.split("/").filter(Boolean);
    if (segments.length < 6 || segments[2] !== "releases" || segments[3] !== "download") {
      throw new Error("更新下载地址不是有效的 GitHub Release 产物地址");
    }
  }
  return source;
}

function routeDownloadUrl(route: UpdateDownloadRoute, source: URL): string {
  if (!route.prefix) return source.href;
  const prefix = new URL(route.prefix);
  if (prefix.protocol !== "https:" || prefix.username || prefix.password || prefix.search || prefix.hash) {
    throw new Error(`更新加速线路 ${route.label} 配置无效`);
  }
  return `${prefix.href}${source.href}`;
}

function responseContentType(response: Response): string {
  try { return String(response.headers?.get("content-type") || "").toLowerCase(); }
  catch { return ""; }
}

function appendResponsePrefix(current: Buffer, chunk: Buffer): Buffer {
  if (current.length >= 512) return current;
  return Buffer.concat([current, chunk.subarray(0, 512 - current.length)]);
}

function responseLooksLikeHtml(prefix: Buffer): boolean {
  const text = prefix.toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return /^<!doctype\s+html(?:\s|>)|^<html(?:\s|>)/.test(text);
}

function responseBodyIterator(body: unknown): AsyncIterator<Uint8Array> {
  const asyncIterable = body as AsyncIterable<Uint8Array>;
  if (typeof asyncIterable?.[Symbol.asyncIterator] === "function") return asyncIterable[Symbol.asyncIterator]();
  const stream = body as ReadableStream<Uint8Array>;
  if (typeof stream?.getReader !== "function") throw new Error("下载响应不支持流式读取");
  const reader = stream.getReader();
  return {
    next: () => reader.read(),
    return: async () => {
      try { await reader.cancel(); } finally { reader.releaseLock(); }
      return { done: true, value: undefined };
    }
  };
}

async function closeResponseIterator(iterator: AsyncIterator<Uint8Array> | null): Promise<void> {
  if (typeof iterator?.return !== "function") return;
  try { await iterator.return(); } catch {}
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "连接超时";
  return error instanceof Error ? error.message : String(error);
}

function safeAssetName(value: string): string {
  const name = path.basename(String(value || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  if (!name || name === "." || name === "..") throw new Error("更新产物名称无效");
  return name;
}

function platformAssetScore(
  asset: UpdateAsset,
  platform: NodeJS.Platform,
  arch: string,
  windowsPackageType: "installer" | "portable"
): number {
  const name = asset.name.toLowerCase();
  const normalizedArch = arch === "x64" ? ["x64", "x86_64", "amd64"] : arch === "arm64" ? ["arm64", "aarch64"] : [arch];
  const hasArch = normalizedArch.some(value => name.includes(value));
  if (!hasArch) return -1;
  if (platform === "win32") {
    if (!name.endsWith(".exe") || !name.includes("windows")) return -1;
    const isInstaller = name.includes("installer") || name.includes("setup");
    const isPortable = name.includes("portable");
    if (windowsPackageType === "portable") return isPortable ? 100 : isInstaller ? -1 : 1;
    return isInstaller ? 100 : isPortable ? -1 : 1;
  }
  if (platform === "darwin") {
    if (!name.includes("macos")) return -1;
    return name.endsWith(".dmg") ? 100 : name.endsWith(".zip") ? 50 : -1;
  }
  if (platform === "linux") {
    if (!name.includes("linux")) return -1;
    if (name.endsWith(".appimage")) return 100;
    if (name.endsWith(".deb")) return 80;
    if (name.endsWith(".rpm")) return 60;
  }
  return -1;
}

export function selectUpdateAsset(
  assets: UpdateAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  windowsPackageType: "installer" | "portable" = "installer"
): UpdateAsset {
  const selected = [...(Array.isArray(assets) ? assets : [])]
    .map(asset => ({ asset, score: platformAssetScore(asset, platform, arch, windowsPackageType) }))
    .filter(item => item.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.asset;
  if (!selected) throw new Error(`当前 Release 没有适用于 ${platform}/${arch} 的安装产物`);
  return selected;
}

function packageTypeForAsset(asset: UpdateAsset, platform: NodeJS.Platform): string {
  const name = asset.name.toLowerCase();
  if (platform === "win32") return name.includes("portable") ? "portable" : "installer";
  if (name.endsWith(".dmg")) return "dmg";
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".appimage")) return "appimage";
  if (name.endsWith(".deb")) return "deb";
  if (name.endsWith(".rpm")) return "rpm";
  return path.extname(name).replace(/^\./, "") || "unknown";
}

function parseSha256(value: string): string {
  const match = String(value || "").trim().match(/^sha256:([a-f0-9]{64})$/i);
  if (!match) throw new Error("GitHub Release 未提供可验证的 SHA-256 摘要，已拒绝下载");
  return match[1].toLowerCase();
}

function readState(file: string): UpdateDownloadState {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as UpdateDownloadState;
    return value && typeof value === "object" ? value : { schema_version: 1, state: "idle" };
  } catch {
    return { schema_version: 1, state: "idle" };
  }
}

function writeState(file: string, value: UpdateDownloadState): UpdateDownloadState {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return value;
}

export class UpdateInstaller {
  private readonly directory: string;
  private readonly stateFile: string;
  private readonly fetchImpl: typeof fetch;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly windowsPackageType: "installer" | "portable";
  private readonly probeBytes: number;
  private readonly probeTimeoutMs: number;
  private readonly downloadIdleTimeoutMs: number;
  private inFlight: Promise<UpdateDownloadState> | null = null;
  private liveState: UpdateDownloadState | null = null;

  constructor(dataDirectory: string, options: UpdateInstallerOptions = {}) {
    this.directory = path.join(dataDirectory, "updates");
    this.stateFile = path.join(this.directory, "state.json");
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.windowsPackageType = options.windowsPackageType
      || (this.platform === "win32" && String(process.env.PORTABLE_EXECUTABLE_DIR || "").trim() ? "portable" : "installer");
    this.probeBytes = Math.max(64 * 1024, Math.min(1024 * 1024, Number(options.probeBytes) || DEFAULT_UPDATE_PROBE_BYTES));
    this.probeTimeoutMs = Math.max(250, Math.min(30_000, Number(options.probeTimeoutMs) || DEFAULT_UPDATE_PROBE_TIMEOUT_MS));
    this.downloadIdleTimeoutMs = Math.max(250, Math.min(120_000, Number(options.downloadIdleTimeoutMs) || DEFAULT_UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS));
    if (typeof this.fetchImpl !== "function") throw new Error("当前运行环境不支持更新下载");
  }

  status(release?: UpdateRelease): UpdateDownloadState {
    let state = this.liveState ? { ...this.liveState } : readState(this.stateFile);
    let selected: UpdateAsset | null = null;
    let selectedPackageType = "";
    const currentVersion = normalizeVersion(release?.current_version);
    const latestVersion = normalizeVersion(release?.latest_version);
    const runningWithoutUpdate = Boolean(currentVersion && latestVersion && release?.update_available === false);
    if (state.state !== "idle" && runningWithoutUpdate && !this.inFlight) {
      state = writeState(this.stateFile, {
        schema_version: 1,
        state: "idle",
        platform: this.platform,
        arch: this.arch,
        package_type: this.windowsPackageType
      });
      this.liveState = state;
    }
    if (release?.update_available) {
      try {
        selected = selectUpdateAsset(release.assets, this.platform, this.arch, this.windowsPackageType);
        selectedPackageType = packageTypeForAsset(selected, this.platform);
      } catch {}
    }
    if (state.state !== "idle" && selected) {
      const stateAssetName = String(state.asset_name || state.selected_asset_name || "");
      const stateVersion = normalizeVersion(state.version);
      const releaseVersion = normalizeVersion(release?.latest_version);
      const matchesCurrentTarget = stateAssetName === selected.name
        && stateVersion === releaseVersion
        && state.platform === this.platform
        && state.arch === this.arch
        && state.package_type === selectedPackageType;
      if (!matchesCurrentTarget) {
        state = { schema_version: 1, state: "idle" };
      }
    }
    if (state.state === "downloading" && !this.inFlight && !this.liveState) {
      state = writeState(this.stateFile, {
        ...state,
        state: "failed",
        error: "上次更新下载被中断，请重新下载"
      });
    }
    if (state.state === "downloaded" && (!state.file || !fs.existsSync(state.file))) {
      state = writeState(this.stateFile, { schema_version: 1, state: "idle" });
      this.liveState = state;
    }
    const result: UpdateDownloadState = {
      ...state,
      platform: this.platform,
      arch: this.arch
    };
    if (release?.update_available) {
      try {
        selected ||= selectUpdateAsset(release.assets, this.platform, this.arch, this.windowsPackageType);
        result.selected_asset_name = selected.name;
        result.selected_asset_size = selected.size;
        result.package_type = selectedPackageType || packageTypeForAsset(selected, this.platform);
      } catch (error) {
        if (!result.error) result.error = error instanceof Error ? error.message : String(error);
      }
    }
    return result;
  }

  download(release: UpdateRelease): Promise<UpdateDownloadState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performDownload(release).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async verifyDownloaded(release?: UpdateRelease): Promise<UpdateDownloadState> {
    if (release && (!release.update_available || !release.latest_version)) {
      throw new Error("当前没有可打开的新版本安装包");
    }
    const state = this.status(release);
    if (state.state !== "downloaded" || !state.file || !state.digest) throw new Error("没有已下载并校验的更新安装包");
    const root = path.resolve(this.directory);
    const resolved = path.resolve(state.file);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("更新安装包路径无效");
    const expected = parseSha256(state.digest);
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(resolved)) hash.update(chunk);
    const actual = hash.digest("hex");
    if (actual !== expected) throw new Error("更新安装包校验失败，文件可能已被修改");
    return state;
  }

  cleanupInstalledPackage(currentVersion: string): UpdateCleanupResult {
    const state = readState(this.stateFile);
    const normalizedCurrentVersion = String(currentVersion || "").trim().replace(/^v/i, "");
    const normalizedDownloadedVersion = String(state.version || "").trim().replace(/^v/i, "");
    const matched = this.platform === "win32"
      && this.windowsPackageType === "installer"
      && state.state === "downloaded"
      && state.package_type === "installer"
      && Boolean(normalizedCurrentVersion)
      && normalizedDownloadedVersion === normalizedCurrentVersion;
    if (!matched) return { matched: false, removed: false, retry: false };

    const root = path.resolve(this.directory);
    const resolved = path.resolve(String(state.file || ""));
    const relative = path.relative(root, resolved);
    if (!state.file || !relative || relative.startsWith("..") || path.isAbsolute(relative) || !/\.exe$/i.test(resolved)) {
      const cleared = writeState(this.stateFile, {
        schema_version: 1,
        state: "idle",
        platform: this.platform,
        arch: this.arch,
        package_type: this.windowsPackageType
      });
      this.liveState = cleared;
      return { matched: true, removed: false, retry: false };
    }

    try {
      fs.rmSync(resolved, { force: true });
      const cleared = writeState(this.stateFile, {
        schema_version: 1,
        state: "idle",
        platform: this.platform,
        arch: this.arch,
        package_type: this.windowsPackageType
      });
      this.liveState = cleared;
      return { matched: true, removed: true, retry: false };
    } catch {
      return { matched: true, removed: false, retry: true };
    }
  }

  cacheInfo() {
    let bytes = 0;
    let files = 0;
    try {
      for (const entry of fs.readdirSync(this.directory, {withFileTypes:true})) {
        if (!entry.isFile() || entry.name === path.basename(this.stateFile)) continue;
        bytes += fs.statSync(path.join(this.directory, entry.name)).size;
        files += 1;
      }
    } catch {}
    const state = this.status();
    return {bytes, files, busy:Boolean(this.inFlight || state.state === "downloading"), state:state.state};
  }

  clearCache() {
    const state = this.status();
    if (this.inFlight || state.state === "downloading") throw new Error("更新正在下载，暂时不能清理更新缓存");
    try {
      for (const entry of fs.readdirSync(this.directory, {withFileTypes:true})) {
        if (entry.name === path.basename(this.stateFile)) continue;
        fs.rmSync(path.join(this.directory, entry.name), {recursive:true, force:true});
      }
    } catch {}
    const idle = writeState(this.stateFile, {
      schema_version:1,
      state:"idle",
      platform:this.platform,
      arch:this.arch,
      package_type:this.windowsPackageType
    });
    this.liveState = idle;
    return this.cacheInfo();
  }

  private async probeDownloadRoute(
    route: UpdateDownloadRoute,
    source: URL,
    release: UpdateRelease,
    asset: UpdateAsset
  ): Promise<RankedUpdateDownloadRoute> {
    const url = routeDownloadUrl(route, source);
    const targetBytes = Math.min(asset.size, this.probeBytes);
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    let iterator: AsyncIterator<Uint8Array> | null = null;
    let timeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("测速超时"));
      }, this.probeTimeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetchImpl(url, {
          method: "GET",
          headers: {
            "User-Agent": `TunnelDesk/${release.latest_version}`,
            "Accept": "application/octet-stream",
            "Range": `bytes=0-${Math.max(0, targetBytes - 1)}`,
            "Cache-Control": "no-cache"
          },
          redirect: "follow",
          signal: controller.signal
        }),
        timeoutPromise
      ]);
      if (controller.signal.aborted) throw new Error("测速超时");
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status || "未知"}`);
      if (responseContentType(response).includes("text/html")) throw new Error("返回了网页而不是安装包");
      let bytes = 0;
      let prefix: Buffer = Buffer.alloc(0);
      iterator = responseBodyIterator(response.body);
      while (bytes < targetBytes) {
        const result = await Promise.race([iterator.next(), timeoutPromise]);
        if (result.done) break;
        if (controller.signal.aborted) throw new Error("测速超时");
        const chunk = Buffer.from(result.value);
        prefix = appendResponsePrefix(prefix, chunk);
        if (responseLooksLikeHtml(prefix)) throw new Error("返回了网页而不是安装包");
        bytes += chunk.length;
      }
      if (bytes < targetBytes) throw new Error(`测速数据不足（${bytes}/${targetBytes} 字节）`);
      const elapsedMs = Math.max(1, Date.now() - startedAt);
      const measuredBytes = Math.min(bytes, targetBytes);
      return {
        ...route,
        url,
        probe: {
          id: route.id,
          label: route.label,
          available: true,
          elapsed_ms: elapsedMs,
          bytes_per_second: Math.max(1, Math.floor(measuredBytes * 1000 / elapsedMs))
        }
      };
    } catch (error) {
      return {
        ...route,
        url,
        probe: {
          id: route.id,
          label: route.label,
          available: false,
          elapsed_ms: Math.max(1, Date.now() - startedAt),
          error: timedOut || controller.signal.aborted ? "测速超时" : errorMessage(error)
        }
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      await closeResponseIterator(iterator);
    }
  }

  private async rankDownloadRoutes(
    source: URL,
    release: UpdateRelease,
    asset: UpdateAsset
  ): Promise<{ routes: RankedUpdateDownloadRoute[]; probes: UpdateDownloadProbeResult[] }> {
    const measured = await Promise.all(UPDATE_DOWNLOAD_ROUTES.map(route => this.probeDownloadRoute(route, source, release, asset)));
    const successful = measured
      .filter(item => item.probe.available)
      .sort((left, right) => Number(right.probe.bytes_per_second || 0) - Number(left.probe.bytes_per_second || 0));
    const successfulIds = new Set(successful.map(item => item.id));
    const fallback = measured.filter(item => !successfulIds.has(item.id));
    return { routes:[...successful, ...fallback], probes:measured.map(item => item.probe) };
  }

  private async downloadFromRoute(
    route: RankedUpdateDownloadRoute,
    release: UpdateRelease,
    asset: UpdateAsset,
    expectedDigest: string,
    temporary: string
  ): Promise<number> {
    const controller = new AbortController();
    let timedOut = false;
    let iterator: AsyncIterator<Uint8Array> | null = null;
    const withIdleTimeout = async <T>(operation: PromiseLike<T>): Promise<T> => {
      let timeout: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("连接长时间无数据"));
        }, this.downloadIdleTimeoutMs);
      });
      try {
        return await Promise.race([Promise.resolve(operation), timeoutPromise]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    try {
      const response = await withIdleTimeout(this.fetchImpl(route.url, {
        method: "GET",
        headers: { "User-Agent": `TunnelDesk/${release.latest_version}`, "Accept": "application/octet-stream" },
        redirect: "follow",
        signal: controller.signal
      }));
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status || "未知"}`);
      if (responseContentType(response).includes("text/html")) throw new Error("返回了网页而不是安装包");
      const hash = crypto.createHash("sha256");
      let bytes = 0;
      let prefix: Buffer = Buffer.alloc(0);
      iterator = responseBodyIterator(response.body);
      const output = await fs.promises.open(temporary, "w");
      try {
        while (true) {
          const result = await withIdleTimeout(iterator.next());
          if (result.done) break;
          const chunk = Buffer.from(result.value);
          prefix = appendResponsePrefix(prefix, chunk);
          if (responseLooksLikeHtml(prefix)) throw new Error("返回了网页而不是安装包");
          bytes += chunk.length;
          if (bytes > asset.size) throw new Error("下载大小超过 Release 声明值");
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const result = await output.write(chunk, offset, chunk.length - offset, null);
            if (result.bytesWritten <= 0) throw new Error("更新安装包写入失败");
            offset += result.bytesWritten;
          }
          if (this.liveState) {
            this.liveState.bytes_downloaded = bytes;
            this.liveState.progress_percent = Math.min(99, Math.floor(bytes / asset.size * 100));
          }
        }
      } finally {
        await output.close();
      }
      if (this.liveState) this.liveState.phase = "verifying";
      if (bytes !== asset.size) throw new Error(`下载不完整：应为 ${asset.size} 字节，实际 ${bytes} 字节`);
      if (hash.digest("hex") !== expectedDigest) throw new Error("SHA-256 校验失败");
      return bytes;
    } catch (error) {
      if (timedOut || controller.signal.aborted) throw new Error("连接长时间无数据，已切换其他线路");
      throw error;
    } finally {
      controller.abort();
      await closeResponseIterator(iterator);
    }
  }

  private async performDownload(release: UpdateRelease): Promise<UpdateDownloadState> {
    if (!release?.update_available || !release.latest_version) throw new Error("当前没有可下载的新版本");
    const asset = selectUpdateAsset(release.assets, this.platform, this.arch, this.windowsPackageType);
    const expectedDigest = parseSha256(String(asset.digest || ""));
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 4 * 1024 * 1024 * 1024) {
      throw new Error("更新产物大小无效");
    }
    const source = trustedGitHubAssetUrl(asset.url);
    fs.mkdirSync(this.directory, { recursive: true });
    const filename = safeAssetName(asset.name);
    const target = path.join(this.directory, filename);
    try {
      for (const entry of fs.readdirSync(this.directory)) {
        if (entry.startsWith(`${filename}.part-`)) fs.rmSync(path.join(this.directory, entry), { force: true });
      }
    } catch {}
    const packageType = packageTypeForAsset(asset, this.platform);
    this.liveState = {
      schema_version: 1,
      state: "downloading",
      phase: "probing",
      version: release.latest_version,
      asset_name: filename,
      selected_asset_name: filename,
      selected_asset_size: asset.size,
      size: asset.size,
      bytes_downloaded: 0,
      progress_percent: 0,
      digest: String(asset.digest),
      platform: this.platform,
      arch: this.arch,
      package_type: packageType,
      probe_results: []
    };
    writeState(this.stateFile, this.liveState);

    let probes: UpdateDownloadProbeResult[] = [];
    let currentRoute: RankedUpdateDownloadRoute | null = null;
    const routeErrors: string[] = [];
    try {
      const ranked = await this.rankDownloadRoutes(source, release, asset);
      probes = ranked.probes;
      for (const route of ranked.routes) {
        currentRoute = route;
        const temporary = `${target}.part-${process.pid}-${route.id}`;
        if (this.liveState) {
          Object.assign(this.liveState, {
            phase: "downloading",
            source_id: route.id,
            source_label: route.label,
            source_speed_bytes_per_second: route.probe.bytes_per_second,
            probe_results: probes,
            bytes_downloaded: 0,
            progress_percent: 0
          });
          writeState(this.stateFile, this.liveState);
        }
        try {
          const bytes = await this.downloadFromRoute(route, release, asset, expectedDigest, temporary);
          fs.rmSync(target, { force: true });
          fs.renameSync(temporary, target);
          if (this.platform === "linux" && /\.appimage$/i.test(target)) {
            try { fs.chmodSync(target, 0o755); } catch {}
          }
          const completed = writeState(this.stateFile, {
            schema_version: 1,
            state: "downloaded",
            version: release.latest_version,
            asset_name: filename,
            selected_asset_name: filename,
            selected_asset_size: asset.size,
            file: target,
            size: bytes,
            bytes_downloaded: bytes,
            progress_percent: 100,
            source_id: route.id,
            source_label: route.label,
            source_speed_bytes_per_second: route.probe.bytes_per_second,
            probe_results: probes,
            digest: String(asset.digest),
            downloaded_at: new Date().toISOString(),
            platform: this.platform,
            arch: this.arch,
            package_type: packageType
          });
          this.liveState = completed;
          return completed;
        } catch (error) {
          try { fs.rmSync(temporary, { force: true }); } catch {}
          routeErrors.push(`${route.label}：${errorMessage(error).slice(0, 160)}`);
        }
      }
      throw new Error(`所有下载线路均失败：${routeErrors.join("；")}`);
    } catch (error) {
      const message = errorMessage(error);
      const failed = writeState(this.stateFile, {
        schema_version: 1,
        state: "failed",
        version: release.latest_version,
        asset_name: filename,
        selected_asset_name: filename,
        selected_asset_size: asset.size,
        size: asset.size,
        bytes_downloaded: this.liveState?.bytes_downloaded || 0,
        progress_percent: this.liveState?.progress_percent || 0,
        source_id: currentRoute?.id,
        source_label: currentRoute?.label,
        source_speed_bytes_per_second: currentRoute?.probe.bytes_per_second,
        probe_results: probes,
        platform: this.platform,
        arch: this.arch,
        package_type: packageType,
        error: message
      });
      this.liveState = failed;
      throw new Error(message);
    }
  }
}
