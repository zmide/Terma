const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  compareVersions,
  createUpdateChecker,
  parseGitHubRepository
} = require("../dist/update-checker");

const projectRoot = path.resolve(__dirname, "..");

const temporaryRoots = [];
process.on("exit", () => {
  for (const directory of temporaryRoots) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

function temporaryProject(version = "1.0.7") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-update-check-"));
  temporaryRoots.push(root);
  const dataDir = path.join(root, "data");
  const packagePath = path.join(root, "package.json");
  fs.writeFileSync(packagePath, JSON.stringify({
    version,
    repository: { type: "git", url: "https://github.com/zmide/Terma.git" }
  }), "utf8");
  return { root, dataDir, packagePath };
}

function release(tag = "v1.0.8", overrides = {}) {
  return {
    tag_name: tag,
    name: `Terma ${tag}`,
    html_url: `https://github.com/zmide/Terma/releases/tag/${tag}`,
    published_at: "2026-07-20T00:00:00Z",
    body: "Release notes",
    draft: false,
    prerelease: false,
    assets: [{
      name: `Terma-${tag}.dmg`,
      browser_download_url: `https://example.invalid/Terma-${tag}.dmg`,
      size: 1234,
      content_type: "application/x-apple-diskimage"
    }],
    ...overrides
  };
}

function response(status, body = null, headers = {}) {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => normalizedHeaders.get(String(name).toLowerCase()) || null },
    async json() { return body; }
  };
}

async function check(name, callback) {
  await callback();
  console.log(`PASS ${name}`);
}

(async () => {
  await check("startup forces one update check while settings keeps the cached check path", async () => {
    const runtimeSource = fs.readFileSync(path.join(projectRoot, "src", "server-runtime.ts"), "utf8");
    const settingsSource = fs.readFileSync(path.join(projectRoot, "public", "app-settings-updates.js"), "utf8");
    assert.match(runtimeSource, /updateChecker\.check\(\{force:true\}\)/);
    assert.match(runtimeSource, /}, 10 \* 1000\);/);
    assert.match(settingsSource, /`\/api\/updates\/check\$\{force \? "\?force=1" : ""\}`/);
  });

  await check("settings checks cancel stale requests and render unchanged release notes without blocking", async () => {
    const settingsSource = fs.readFileSync(path.join(projectRoot, "public", "app-settings-updates.js"), "utf8");
    const settingsCoreSource = fs.readFileSync(path.join(projectRoot, "public", "app-settings-core.js"), "utf8");
    assert.match(settingsSource, /updateStatusAbortController\?\.abort\(\)/);
    assert.match(settingsSource, /requestSequence !== updateStatusRefreshSequence/);
    assert.match(settingsSource, /yieldBeforeUpdateRender\(\)/);
    assert.match(settingsSource, /currentNotes\._updateNotesKey === nextNotesKey/);
    assert.match(settingsSource, /nextNotes\._updateNotesKey = nextNotesKey/);
    assert.match(settingsSource, /checking:options\.checking \?\? updateStatusChecking/);
    assert.match(settingsSource, /renderDeferredUpdateReleaseNotes/);
    assert.match(settingsSource, /await nextUpdateNotesFrame\(\)/);
    assert.match(settingsSource, /updateStatusChecking = true/);
    assert.match(settingsSource, /previousDownloadStatus/);
    assert.match(settingsSource, /download_status:previousDownloadStatus/);
    assert.match(settingsSource, /previousUpdateStatus\?\.latest_version/);
    assert.match(settingsSource, /check_error:message/);
    assert.match(settingsSource, /renderUpdateStatus\(\{deferNotes:true, checking:true\}\)/);
    assert.match(settingsSource, /updateStatusChecking = false/);
    assert.match(settingsSource, /renderUpdateStatus\(\{deferNotes:true, checking:false\}\)/);
    assert.match(settingsCoreSource, /const refreshSequence = updateStatusRefreshSequence/);
    assert.match(settingsCoreSource, /refreshSequence !== updateStatusRefreshSequence \|\| updateStatusChecking \|\| updateStatusAbortController/);
    assert.match(settingsCoreSource, /renderUpdateStatus\(\{deferNotes:true\}\)/);
  });

  await check("republished update confirmation interpolates the target version", async () => {
    const settingsSource = fs.readFileSync(path.join(projectRoot, "public", "app-settings-updates.js"), "utf8");
    assert.match(settingsSource, /const targetVersion = latestVersion \? `v\$\{latestVersion\}` : tr\("settings:updates\.current_unknown"\)/);
    assert.match(settingsSource, /"settings:updates\.republished_confirm"[\s\S]{0,160}\{version:targetVersion\}/);
  });

  await check("update cache disk writes stay asynchronous during checks", async () => {
    const checkerSource = fs.readFileSync(path.join(projectRoot, "src", "update-checker.ts"), "utf8");
    assert.match(checkerSource, /let cacheMemory = readJson\(cachePath, \{\}\) \|\| \{\}/);
    assert.match(checkerSource, /await saveCacheAsync\(cache\)/);
    assert.match(checkerSource, /cacheWriteQueue = cacheWriteQueue[\s\S]*\.then\(async \(\) =>/);
    assert.match(checkerSource, /if \(generation === cacheWriteGeneration\) cacheMemory = cacheCommitted/);
  });

  await check("semantic versions handle prefixes, numeric fields, and prereleases", async () => {
    assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.0", "v1.0.0"), 0);
    assert.equal(compareVersions("1.0.0", "1.0.0-rc.9"), 1);
    assert.equal(compareVersions("1.0.0-rc.10", "1.0.0-rc.2"), 1);
    assert.equal(compareVersions("1.0.0-beta", "1.0.0-rc"), -1);
    assert.equal(compareVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
    assert.throws(() => compareVersions("latest", "1.0.0"), /无法比较版本号/);
  });

  await check("GitHub repository formats are normalized", async () => {
    assert.deepEqual(parseGitHubRepository("git@github.com:zmide/Terma.git"), { owner: "zmide", repo: "Terma" });
    assert.deepEqual(parseGitHubRepository({ url: "git+https://github.com/zmide/Terma.git" }), { owner: "zmide", repo: "Terma" });
  });

  await check("successful checks send GitHub headers and use the six-hour cache", async () => {
    const project = temporaryProject();
    let now = Date.parse("2026-07-20T01:00:00Z");
    const requests = [];
    const checker = createUpdateChecker({
      ...project,
      now: () => now,
      fetch: async (url, options) => {
        requests.push({ url, options });
        const tags = ["v1.0.8", "v1.0.7", "v1.0.6", "v1.0.5", "v1.0.4", "v1.0.3", "v1.0.2", "v1.0.1", "v1.0.0", "v0.9.2", "v0.9.1", "v0.9.0"];
        const releases = tags.map((tag, index) => release(tag, { body:index ? `Previous release notes ${index}` : "Release notes" }));
        return response(200, releases, { etag: '"release-1.0.8"' });
      }
    });
    const first = await checker.check();
    assert.equal(first.current_version, "1.0.7");
    assert.equal(first.latest_version, "1.0.8");
    assert.equal(first.update_available, true);
    assert.equal(first.from_cache, false);
    assert.equal(first.assets[0].name, "Terma-v1.0.8.dmg");
    assert.deepEqual(first.release_notes.map(item => item.version), ["1.0.8", "1.0.7", "1.0.6", "1.0.5", "1.0.4", "1.0.3", "1.0.2", "1.0.1", "1.0.0", "0.9.2"]);
    assert.equal(first.release_notes.length, 10);
    assert.equal(first.release_notes[1].notes, "Previous release notes 1");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /repos\/zmide\/Terma\/releases\?per_page=10$/);
    assert.equal(requests[0].options.headers.Accept, "application/vnd.github+json");
    assert.equal(requests[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.match(requests[0].options.headers["User-Agent"], /^Terma\/1\.0\.7$/);
    now += 5 * 60 * 60 * 1000;
    const second = await checker.check();
    assert.equal(second.from_cache, true);
    assert.equal(requests.length, 1);
    assert.equal(fs.existsSync(path.join(project.dataDir, "update-check.json")), true);
    const cache = JSON.parse(fs.readFileSync(path.join(project.dataDir, "update-check.json"), "utf8"));
    assert.equal(cache.schema_version, 5);
    assert.equal(cache.repository_key, "zmide/terma");
  });

  await check("renamed repositories invalidate legacy release caches and ETags", async () => {
    const project = temporaryProject("1.3.0");
    fs.mkdirSync(project.dataDir, { recursive: true });
    fs.writeFileSync(path.join(project.dataDir, "update-check.json"), JSON.stringify({
      schema_version: 2,
      checked_at_ms: Date.parse("2026-08-07T01:00:00Z"),
      etag: '"legacy-tunneldesk-release"',
      result: {
        current_version: "1.2.1",
        latest_version: "1.2.1",
        update_available: false,
        release_url: "https://github.com/zmide/tunneldesk/releases/tag/v1.2.1",
        name: "TunnelDesk v1.2.1",
        published_at: "2026-08-01T00:00:00Z",
        notes: "Legacy release",
        release_notes: [],
        assets: [],
        checked_at: "2026-08-07T01:00:00.000Z",
        from_cache: true,
        source: "github"
      }
    }), "utf8");
    const requests = [];
    const checker = createUpdateChecker({
      ...project,
      now: () => Date.parse("2026-08-07T02:00:00Z"),
      fetch: async (url, options) => {
        requests.push({ url, options });
        return response(200, release("v1.3.1"), { etag: '"terma-release"' });
      }
    });
    assert.equal(checker.status(), null);
    const result = await checker.check();
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /repos\/zmide\/Terma\/releases\?per_page=10$/);
    assert.equal(requests[0].options.headers["If-None-Match"], undefined);
    assert.equal(result.latest_version, "1.3.1");
    assert.equal(result.release_url, "https://github.com/zmide/Terma/releases/tag/v1.3.1");
  });

  await check("forced checks revalidate cached releases with ETag and accept 304", async () => {
    const project = temporaryProject();
    let now = Date.parse("2026-07-20T02:00:00Z");
    const requests = [];
    const checker = createUpdateChecker({
      ...project,
      now: () => now,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return requests.length === 1
          ? response(200, release(), { etag: '"release-etag"' })
          : response(304);
      }
    });
    await checker.check();
    now += 1000;
    const result = await checker.check({ force: true });
    assert.equal(result.from_cache, true);
    assert.equal(result.checked_at, new Date(now).toISOString());
    assert.equal(requests[1].options.headers["If-None-Match"], '"release-etag"');
  });

  await check("status reads only cached releases and recomputes the current version after an app upgrade", async () => {
    const project = temporaryProject("1.0.7");
    let requests = 0;
    const first = createUpdateChecker({
      ...project,
      fetch: async () => {
        requests += 1;
        return response(200, release("v1.0.8"), { etag: '"release-1.0.8"' });
      }
    });
    assert.equal(first.status(), null);
    assert.equal((await first.check()).update_available, true);
    assert.equal(requests, 1);

    const cached = first.status();
    assert.equal(cached.from_cache, true);
    assert.equal(cached.current_version, "1.0.7");
    assert.equal(cached.latest_version, "1.0.8");
    assert.equal(cached.update_available, true);
    assert.equal(requests, 1, "status must not request GitHub");

    const packageInfo = JSON.parse(fs.readFileSync(project.packagePath, "utf8"));
    fs.writeFileSync(project.packagePath, JSON.stringify({ ...packageInfo, version: "1.0.8" }), "utf8");
    const upgraded = createUpdateChecker({
      ...project,
      fetch: async () => {
        requests += 1;
        throw new Error("status must not request GitHub");
      }
    });
    const result = upgraded.status();
    assert.equal(result.from_cache, true);
    assert.equal(result.current_version, "1.0.8");
    assert.equal(result.latest_version, "1.0.8");
    assert.equal(result.update_available, false);
    assert.equal(requests, 1);
  });

  await check("timeouts and network failures are reported in Chinese", async () => {
    const timeoutProject = temporaryProject();
    const timeoutChecker = createUpdateChecker({
      ...timeoutProject,
      timeoutMs: 20,
      fetch: () => new Promise(() => {})
    });
    await assert.rejects(timeoutChecker.check({ force: true }), /检查更新超时，请稍后重试/);

    const networkProject = temporaryProject();
    const networkChecker = createUpdateChecker({
      ...networkProject,
      fetch: async () => { throw new Error("socket closed"); }
    });
    await assert.rejects(networkChecker.check({ force: true }), /无法连接 GitHub 检查更新：socket closed/);

    const httpProject = temporaryProject();
    const httpChecker = createUpdateChecker({
      ...httpProject,
      fetch: async () => response(403)
    });
    await assert.rejects(httpChecker.check({ force: true }), /GitHub 更新检查失败（HTTP 403）/);
  });

  await check("only formal latest releases are accepted", async () => {
    const project = temporaryProject();
    const checker = createUpdateChecker({
      ...project,
      fetch: async () => response(200, release("v1.1.0-rc.1", { prerelease: true }))
    });
    await assert.rejects(checker.check({ force: true }), /正式版本数据无效/);
  });

  await check("update notifications are persisted once per latest version", async () => {
    const project = temporaryProject();
    const notified = [];
    const first = createUpdateChecker({
      ...project,
      fetch: async () => response(200, release("v1.0.8")),
      onUpdate: result => notified.push(result.latest_version)
    });
    await first.check({ force: true });
    assert.deepEqual(notified, ["1.0.8"]);

    const restarted = createUpdateChecker({
      ...project,
      fetch: async () => response(200, release("v1.0.8")),
      onUpdate: result => notified.push(result.latest_version)
    });
    await restarted.check({ force: true });
    assert.deepEqual(notified, ["1.0.8"]);

    const newer = createUpdateChecker({
      ...project,
      fetch: async () => response(200, release("v1.0.9")),
      onUpdate: result => notified.push(result.latest_version)
    });
    await newer.check({ force: true });
    assert.deepEqual(notified, ["1.0.8", "1.0.9"]);
    const state = JSON.parse(fs.readFileSync(path.join(project.dataDir, "update-check.json"), "utf8"));
    assert.equal(state.notified_latest_version, "1.0.9");
  });

  await check("same-version republished releases are surfaced and notified once", async () => {
    const project = temporaryProject("1.0.8");
    const packageInfo = JSON.parse(fs.readFileSync(project.packagePath, "utf8"));
    fs.writeFileSync(project.packagePath, JSON.stringify({ ...packageInfo, releaseRevision: 1 }), "utf8");
    const notified = [];
    const body = "<!-- terma-release-revision: 2 -->\n\nRefreshed build";
    const checker = createUpdateChecker({
      ...project,
      fetch: async () => response(200, [release("v1.0.8", { body })]),
      onUpdate: result => notified.push({ version:result.latest_version, republished:result.republished_available, revision:result.release_revision })
    });
    const result = await checker.check({ force: true });
    assert.equal(result.update_available, false);
    assert.equal(result.republished_available, true);
    assert.equal(result.release_revision, 2);
    assert.deepEqual(notified, [{version:"1.0.8", republished:true, revision:2}]);
    const restarted = createUpdateChecker({
      ...project,
      fetch: async () => response(200, [release("v1.0.8", { body })]),
      onUpdate: value => notified.push({ version:value.latest_version, republished:value.republished_available, revision:value.release_revision })
    });
    const second = await restarted.check({ force: true });
    assert.equal(second.republished_available, true);
    assert.equal(notified.length, 1);
  });

  await check("ignored version suppresses update notifications and expires for a newer version", async () => {
    const project = temporaryProject();
    const setup = createUpdateChecker({
      ...project,
      fetch: async () => response(200, [release("v1.0.8"), release("v1.0.7")])
    });
    await setup.check({ force: true });
    const ignored = await setup.setIgnoredCurrentVersion(true);
    assert.equal(ignored.update_ignored, true);
    assert.equal(ignored.ignored_version, "1.0.8");

    const notified = [];
    const sameVersion = createUpdateChecker({
      ...project,
      fetch: async () => response(200, [release("v1.0.8"), release("v1.0.7")]),
      onUpdate: result => notified.push(result.latest_version)
    });
    const sameStatus = await sameVersion.check({ force: true });
    assert.equal(sameStatus.update_ignored, true);
    assert.deepEqual(notified, []);

    const newer = createUpdateChecker({
      ...project,
      fetch: async () => response(200, [release("v1.0.9"), release("v1.0.8")]),
      onUpdate: result => notified.push(result.latest_version)
    });
    const newerStatus = await newer.check({ force: true });
    assert.equal(newerStatus.update_ignored, false);
    assert.equal(newerStatus.ignored_version, "1.0.8");
    assert.deepEqual(newerStatus.release_notes.map(item => item.version), ["1.0.9", "1.0.8"]);
    assert.deepEqual(notified, ["1.0.9"]);
    const cleared = await newer.setIgnoredCurrentVersion(false);
    assert.equal(cleared.ignored_version, "");
  });

  await check("ignore changes remain durable while an earlier cache write is in flight", async () => {
    const project = temporaryProject();
    const originalWriteFile = fs.promises.writeFile;
    let releaseFirstWrite;
    let announceFirstWrite;
    const firstWriteStarted = new Promise(resolve => { announceFirstWrite = resolve; });
    const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
    let delayed = false;
    fs.promises.writeFile = async function(...args) {
      if (!delayed) {
        delayed = true;
        announceFirstWrite();
        await firstWriteGate;
      }
      return originalWriteFile.apply(this, args);
    };
    try {
      const checker = createUpdateChecker({
        ...project,
        fetch: async () => response(200, [release("v1.0.8")])
      });
      const checkPromise = checker.check({force:true});
      await firstWriteStarted;
      const ignorePromise = checker.setIgnoredCurrentVersion(true);
      releaseFirstWrite();
      await Promise.all([checkPromise, ignorePromise]);

      const restarted = createUpdateChecker({
        ...project,
        fetch: async () => response(200, [release("v1.0.8")])
      });
      const status = restarted.status();
      assert.equal(status.update_ignored, true);
      assert.equal(status.ignored_version, "1.0.8");
    } finally {
      releaseFirstWrite?.();
      fs.promises.writeFile = originalWriteFile;
    }
  });

  await check("failed cache writes roll back the visible in-memory state", async () => {
    const project = temporaryProject();
    const originalWriteFile = fs.promises.writeFile;
    fs.promises.writeFile = async () => { throw new Error("disk denied"); };
    try {
      const checker = createUpdateChecker({
        ...project,
        fetch: async () => response(200, [release("v1.0.8")])
      });
      await assert.rejects(checker.check({force:true}), /disk denied/);
      assert.equal(checker.status(), null);
    } finally {
      fs.promises.writeFile = originalWriteFile;
    }
  });

  console.log("GitHub Releases update checker passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
