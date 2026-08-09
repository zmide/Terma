const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { UPDATE_DOWNLOAD_ROUTES, selectUpdateAsset, UpdateInstaller } = require("../dist/update-installer");

function digest(body) {
  return `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
}

function release(asset) {
  return { current_version: "1.1.5", latest_version: "1.2.0", update_available: true, assets: [asset] };
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function response(body, options = {}) {
  const contentType = options.contentType || "application/octet-stream";
  const responseHeaders = {
    ...(options.headers || {}),
    "content-type": contentType
  };
  return {
    ok: options.ok !== false,
    status: options.status || (options.ok === false ? 500 : 200),
    body: body === null ? null : Readable.from([Buffer.from(body || "")]),
    headers: {
      get(name) { return responseHeaders[String(name || "").toLowerCase()] || null; }
    }
  };
}

function redirectResponse(location, status = 302) {
  return response(null, {status, body:null, headers:{location}});
}

function hangingResponse(onCancel) {
  return {
    ok: true,
    status: 200,
    body: {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}),
          return: async () => {
            onCancel();
            return { done:true, value:undefined };
          }
        };
      }
    },
    headers: { get: () => "application/octet-stream" }
  };
}

function requestHeader(options, name) {
  const headers = options?.headers;
  if (typeof headers?.get === "function") return headers.get(name);
  const key = Object.keys(headers || {}).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function routeForUrl(url, sourceUrl) {
  return UPDATE_DOWNLOAD_ROUTES.find(route => (route.prefix ? `${route.prefix}${sourceUrl}` : sourceUrl) === url);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-update-installer-"));
  try {
    const windowsAssets = [
      { name:"Terma-1.2.0-windows-x64-portable.exe" },
      { name:"Terma-1.2.0-windows-x64-installer.exe" }
    ];
    assert.equal(selectUpdateAsset(windowsAssets, "win32", "x64", "installer").name.endsWith("-installer.exe"), true);
    assert.equal(selectUpdateAsset(windowsAssets, "win32", "x64", "portable").name.endsWith("-portable.exe"), true);
    assert.throws(
      () => selectUpdateAsset([windowsAssets[1]], "win32", "x64", "portable"),
      /没有适用于/
    );
    assert.equal(selectUpdateAsset([{ name:"Terma-1.2.0-windows-x64-setup.exe" }], "win32", "x64").name.endsWith("-setup.exe"), true);
    assert.equal(selectUpdateAsset([{ name:"Terma-1.2.0-macos-arm64.dmg" }], "darwin", "arm64").name.endsWith(".dmg"), true);
    assert.equal(selectUpdateAsset([{ name:"Terma-1.2.0-linux-x86_64.AppImage" }], "linux", "x64").name.endsWith(".AppImage"), true);
    assert.deepEqual(
      UPDATE_DOWNLOAD_ROUTES.map(route => route.prefix),
      [
        "",
        "https://ghfast.top/",
        "https://v6.gh-proxy.org/",
        "https://hk.gh-proxy.org/",
        "https://cdn.gh-proxy.org/",
        "https://edgeone.gh-proxy.org/"
      ]
    );

    const portablePreview = new UpdateInstaller(path.join(root, "portable-preview"), {
      platform:"win32",
      arch:"x64",
      windowsPackageType:"portable"
    }).status({ latest_version:"1.2.0", update_available:true, assets:windowsAssets });
    assert.equal(portablePreview.selected_asset_name.endsWith("-portable.exe"), true);
    assert.equal(portablePreview.package_type, "portable");
    const previousPortableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
    process.env.PORTABLE_EXECUTABLE_DIR = root;
    try {
      const autoPortablePreview = new UpdateInstaller(path.join(root, "auto-portable-preview"), {
        platform:"win32",
        arch:"x64"
      }).status({ latest_version:"1.2.0", update_available:true, assets:windowsAssets });
      assert.equal(autoPortablePreview.package_type, "portable");
    } finally {
      if (previousPortableDirectory === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
      else process.env.PORTABLE_EXECUTABLE_DIR = previousPortableDirectory;
    }

    const body = Buffer.from("signed-update-fixture");
    const asset = {
      name: "Terma-1.2.0-windows-x64-installer.exe",
      url: "https://github.com/zmide/Terma/releases/download/v1.2.0/Terma.exe",
      size: body.length,
      digest: digest(body)
    };
    const installer = new UpdateInstaller(root, {
      platform: "win32",
      arch: "x64",
      fetch: async () => response(body)
    });
    const downloaded = await installer.download(release(asset));
    assert.equal(downloaded.state, "downloaded");
    assert.equal(downloaded.progress_percent, 100);
    assert.equal(downloaded.package_type, "installer");
    assert.equal(fs.readFileSync(downloaded.file, "utf8"), body.toString());
    assert.equal((await installer.verifyDownloaded()).state, "downloaded");
    const portableAsset = {
      ...asset,
      name: "Terma-1.2.0-windows-x64-portable.exe"
    };
    const currentRelease = {
      latest_version: "1.2.0",
      update_available: true,
      assets: [asset, portableAsset]
    };
    const portableUsingSameData = new UpdateInstaller(root, {
      platform: "win32",
      arch: "x64",
      windowsPackageType: "portable"
    });
    const portableStatus = portableUsingSameData.status(currentRelease);
    assert.equal(portableStatus.state, "idle");
    assert.equal(portableStatus.selected_asset_name, portableAsset.name);
    assert.equal(portableStatus.package_type, "portable");
    await assert.rejects(() => portableUsingSameData.verifyDownloaded(currentRelease), /没有已下载/);
    assert.equal(installer.status(currentRelease).state, "downloaded");
    assert.equal((await installer.verifyDownloaded(currentRelease)).package_type, "installer");

    const cleanupRoot = path.join(root, "cleanup");
    const cleanupInstaller = new UpdateInstaller(cleanupRoot, {
      platform: "win32",
      arch: "x64",
      windowsPackageType: "installer",
      fetch: async () => response(body)
    });
    const cleanupDownload = await cleanupInstaller.download(release(asset));
    assert.deepEqual(
      cleanupInstaller.cleanupInstalledPackage("1.1.9"),
      { matched:false, removed:false, retry:false }
    );
    assert.equal(fs.existsSync(cleanupDownload.file), true);
    assert.deepEqual(
      cleanupInstaller.cleanupInstalledPackage("v1.2.0"),
      { matched:true, removed:true, retry:false }
    );
    assert.equal(fs.existsSync(cleanupDownload.file), false);
    assert.equal(cleanupInstaller.status().state, "idle");

    const portableCleanupRoot = path.join(root, "portable-cleanup");
    const portableCleanup = new UpdateInstaller(portableCleanupRoot, {
      platform: "win32",
      arch: "x64",
      windowsPackageType: "portable",
      fetch: async () => response(body)
    });
    const portableCleanupDownload = await portableCleanup.download(release(portableAsset));
    assert.deepEqual(
      portableCleanup.cleanupInstalledPackage("1.2.0"),
      { matched:false, removed:false, retry:false }
    );
    assert.equal(fs.existsSync(portableCleanupDownload.file), true);

    fs.appendFileSync(downloaded.file, "tampered");
    await assert.rejects(() => installer.verifyDownloaded(), /校验失败/);

    const missingDigest = new UpdateInstaller(path.join(root, "missing"), {
      platform: "win32",
      arch: "x64",
      fetch: async () => response(body)
    });
    await assert.rejects(() => missingDigest.download(release({...asset, digest:""})), /未提供.*SHA-256/);

    const incomplete = new UpdateInstaller(path.join(root, "incomplete"), {
      platform: "win32",
      arch: "x64",
      fetch: async () => response("wrong")
    });
    await assert.rejects(() => incomplete.download(release(asset)), /不完整/);

    const mismatch = new UpdateInstaller(path.join(root, "mismatch"), {
      platform: "win32",
      arch: "x64",
      fetch: async () => response(Buffer.alloc(body.length, 0x78))
    });
    await assert.rejects(() => mismatch.download(release(asset)), /SHA-256 校验失败/);

    const untrusted = new UpdateInstaller(path.join(root, "untrusted"), { platform:"win32", arch:"x64" });
    await assert.rejects(() => untrusted.download(release({...asset, url:"https://example.invalid/update.exe"})), /不是受信任/);
    await assert.rejects(() => untrusted.download(release({...asset, url:"https://token:secret@github.com/zmide/Terma/releases/download/v1.2.0/Terma.exe"})), /不是受信任/);
    await assert.rejects(() => untrusted.download(release({...asset, url:"https://github.com/zmide/Terma/archive/refs/tags/v1.2.0.zip"})), /不是有效的 GitHub Release/);
    await assert.rejects(() => untrusted.download(release({...asset, url:"https://github.com/zmide/Terma/releases/download/v1.2.0/Terma.exe?token=private"})), /不是受信任/);

    const redirectBody = Buffer.alloc(64 * 1024, 0x52);
    const redirectAsset = {
      ...asset,
      size:redirectBody.length,
      digest:digest(redirectBody)
    };
    for (const redirectStatus of [302, 307]) {
      const seen = [];
      const redirectInstaller = new UpdateInstaller(path.join(root, `redirect-${redirectStatus}`), {
        platform:"win32",
        arch:"x64",
        probeBytes:64 * 1024,
        fetch: async url => {
          const current = String(url);
          if (current.startsWith("https://objects.githubusercontent.com/")) return response(redirectBody);
          seen.push(current);
          return redirectResponse("https://objects.githubusercontent.com/terma/redirect-fixture.exe", redirectStatus);
        }
      });
      const redirected = await redirectInstaller.download(release(redirectAsset));
      assert.equal(redirected.state, "downloaded");
      assert.ok(seen.length > 0, `应跟随 ${redirectStatus} 重定向`);
      assert.equal(fs.readFileSync(redirected.file).equals(redirectBody), true);
    }

    const invalidRedirectInstaller = new UpdateInstaller(path.join(root, "redirect-invalid-host"), {
      platform:"win32",
      arch:"x64",
      probeBytes:64 * 1024,
      fetch: async () => redirectResponse("https://evil.example.invalid/update.exe")
    });
    await assert.rejects(
      () => invalidRedirectInstaller.download(release(redirectAsset)),
      /所有下载线路均失败/
    );

    const httpRedirectInstaller = new UpdateInstaller(path.join(root, "redirect-http"), {
      platform:"win32",
      arch:"x64",
      probeBytes:64 * 1024,
      fetch: async () => redirectResponse("http://github.com/zmide/Terma/releases/download/v1.2.0/Terma.exe")
    });
    await assert.rejects(
      () => httpRedirectInstaller.download(release(redirectAsset)),
      /所有下载线路均失败/
    );

    const tooManyRedirectInstaller = new UpdateInstaller(path.join(root, "redirect-too-many"), {
      platform:"win32",
      arch:"x64",
      probeBytes:64 * 1024,
      fetch: async url => {
        const current = String(url);
        const match = current.match(/redirect-hop-(\d+)/);
        const next = match ? Number(match[1]) + 1 : 1;
        return redirectResponse(`https://github.com/zmide/Terma/releases/download/v1.2.0/redirect-hop-${next}`);
      }
    });
    await assert.rejects(
      () => tooManyRedirectInstaller.download(release(redirectAsset)),
      /重定向次数过多/
    );

    const staleRoot = path.join(root, "stale-failure");
    fs.mkdirSync(path.join(staleRoot, "updates"), { recursive: true });
    fs.writeFileSync(path.join(staleRoot, "updates", "state.json"), JSON.stringify({
      schema_version: 1,
      state: "failed",
      version: "1.2.0",
      asset_name: asset.name,
      selected_asset_name: asset.name,
      platform: "win32",
      arch: "x64",
      package_type: "installer",
      error: "fetch failed"
    }));
    const staleInstaller = new UpdateInstaller(staleRoot, { platform:"win32", arch:"x64" });
    const upToDate = staleInstaller.status({
      current_version: "1.2.0",
      latest_version: "v1.2.0",
      update_available: false,
      assets: []
    });
    assert.equal(upToDate.state, "idle");
    assert.equal(upToDate.error, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(staleRoot, "updates", "state.json"), "utf8")).state, "idle");

    const staleDownloadedRoot = path.join(root, "stale-downloaded");
    const staleDownloadedDirectory = path.join(staleDownloadedRoot, "updates");
    const staleDownloadedFile = path.join(staleDownloadedDirectory, asset.name);
    fs.mkdirSync(staleDownloadedDirectory, { recursive: true });
    fs.writeFileSync(staleDownloadedFile, body);
    fs.writeFileSync(path.join(staleDownloadedDirectory, "state.json"), JSON.stringify({
      schema_version: 1,
      state: "downloaded",
      version: "1.2.0",
      asset_name: asset.name,
      selected_asset_name: asset.name,
      file: staleDownloadedFile,
      digest: asset.digest,
      platform: "win32",
      arch: "x64",
      package_type: "installer"
    }));
    const staleDownloadedInstaller = new UpdateInstaller(staleDownloadedRoot, { platform:"win32", arch:"x64" });
    assert.equal(staleDownloadedInstaller.status({
      current_version: "1.2.0",
      latest_version: "1.2.0",
      update_available: false,
      assets: []
    }).state, "idle");

    const routedBody = Buffer.alloc(96 * 1024, 0x5a);
    const routedAsset = {
      ...asset,
      size: routedBody.length,
      digest: digest(routedBody)
    };
    const probeDelays = new Map([
      ["ghfast", 5],
      ["gh-proxy-edgeone", 30],
      ["direct", 60],
      ["gh-proxy-v6", 90],
      ["gh-proxy-hk", 120],
      ["gh-proxy-cdn", 150]
    ]);
    const probeIds = [];
    const downloadIds = [];
    let activeProbes = 0;
    let maxActiveProbes = 0;
    let hungRouteCancelled = false;
    const routedInstaller = new UpdateInstaller(path.join(root, "routed"), {
      platform: "win32",
      arch: "x64",
      probeTimeoutMs: 250,
      downloadIdleTimeoutMs: 250,
      fetch: async (url, options) => {
        const route = routeForUrl(String(url), routedAsset.url);
        assert.ok(route, `未知下载线路：${url}`);
        if (requestHeader(options, "range")) {
          probeIds.push(route.id);
          activeProbes += 1;
          maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
          try {
            if (route.id === "gh-proxy-cdn") {
              await new Promise((_, reject) => options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              }, { once:true }));
            }
            await sleep(probeDelays.get(route.id));
            return response(routedBody);
          } finally {
            activeProbes -= 1;
          }
        }
        downloadIds.push(route.id);
        if (route.id === "ghfast") return hangingResponse(() => { hungRouteCancelled = true; });
        return response(routedBody);
      }
    });
    const routedDownloadPromise = routedInstaller.download(release(routedAsset));
    assert.equal(routedInstaller.status(release(routedAsset)).phase, "probing");
    const routedDownload = await routedDownloadPromise;
    assert.deepEqual([...new Set(probeIds)].sort(), UPDATE_DOWNLOAD_ROUTES.map(route => route.id).sort());
    assert.equal(maxActiveProbes, UPDATE_DOWNLOAD_ROUTES.length);
    assert.deepEqual(downloadIds.slice(0, 2), ["ghfast", "gh-proxy-edgeone"]);
    assert.equal(routedDownload.source_id, "gh-proxy-edgeone");
    assert.equal(routedDownload.source_label, "edgeone.gh-proxy.org");
    assert.equal(hungRouteCancelled, true);
    assert.equal(routedDownload.probe_results.length, UPDATE_DOWNLOAD_ROUTES.length);
    assert.equal(routedDownload.probe_results.find(item => item.id === "ghfast").available, true);
    assert.deepEqual(
      {
        available: routedDownload.probe_results.find(item => item.id === "gh-proxy-cdn").available,
        error: routedDownload.probe_results.find(item => item.id === "gh-proxy-cdn").error
      },
      { available:false, error:"测速超时" }
    );
    assert.equal(fs.readFileSync(routedDownload.file).equals(routedBody), true);
    assert.equal(fs.readdirSync(path.dirname(routedDownload.file)).some(name => name.includes(".part-")), false);

    const htmlInstaller = new UpdateInstaller(path.join(root, "html-response"), {
      platform: "win32",
      arch: "x64",
      fetch: async () => response("<!doctype html><title>proxy error</title>", { contentType:"application/octet-stream" })
    });
    await assert.rejects(() => htmlInstaller.download(release(asset)), /返回了网页而不是安装包/);

    console.log("更新安装包检查通过：平台/架构/便携类型选包、升级后旧错误清理、六线路并行测速与失败换线、进度状态、GitHub HTTPS、HTML 拒绝、大小与 SHA-256 校验、篡改拒绝");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
