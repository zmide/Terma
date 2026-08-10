"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProgramCacheManager } = require("../dist/program-cache");
const { createRemoteOfflineTaskManager } = require("../dist/remote-offline-tasks");
const { createRemoteClientAdapter } = require("../desktop/remote-clients");
const { createXServerRuntime } = require("../desktop/xserver-runtime");

function category(bytes, reclaimable = bytes, busy = false) {
  return {bytes, files:bytes ? 1 : 0, reclaimable_bytes:reclaimable, reclaimable_files:reclaimable ? 1 : 0, busy};
}

function checkProgramCacheAggregation() {
  const cleared = [];
  const manager = createProgramCacheManager({
    sftpCacheInfo:() => ({downloads:category(10), uploads:category(20, 0, true), drag:category(30)}),
    clearSftpCache:name => cleared.push(name),
    updateCacheInfo:() => category(40, 40, false),
    clearUpdateCache:() => cleared.push("updates"),
    remoteComponentCacheInfo:() => category(50),
    clearRemoteComponentCache:() => cleared.push("remote_components"),
    desktopCacheInfo:() => ({local_installers:category(60)}),
    clearDesktopCache:name => cleared.push(name)
  });
  const view = manager.view();
  assert.equal(view.bytes, 210);
  assert.equal(view.reclaimable_bytes, 190);
  assert.equal(view.retained_bytes, 20);
  manager.clear("remote_components");
  assert.deepEqual(cleared, ["remote_components"]);
  assert.throws(() => manager.clear("../../outside"), /未知的缓存分类/);
}

function checkRemoteComponentResiduals() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-program-cache-"));
  try {
    const stale = path.join(root, "remote-component-100-1-1");
    const unrelated = path.join(root, "user-content");
    fs.mkdirSync(stale, {recursive:true});
    fs.mkdirSync(unrelated, {recursive:true});
    fs.writeFileSync(path.join(stale, "package.deb"), Buffer.alloc(17));
    fs.writeFileSync(path.join(unrelated, "keep.txt"), "keep");
    const manager = createRemoteOfflineTaskManager({data_dir:root});
    assert.equal(manager.cacheInfo().bytes, 17);
    manager.clearCache();
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
}

function checkDesktopInstallerCaches() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-desktop-cache-"));
  try {
    const remoteClientDirectory = path.join(root, "remote-client");
    fs.mkdirSync(remoteClientDirectory, {recursive:true});
    fs.writeFileSync(path.join(remoteClientDirectory, "WindowsApp.pkg"), Buffer.alloc(19));
    const adapter = createRemoteClientAdapter({platform:"darwin", dataDir:root});
    assert.equal(adapter.cacheInfo().bytes, 19);
    adapter.clearCache();
    assert.equal(fs.existsSync(path.join(remoteClientDirectory, "WindowsApp.pkg")), false);

    const xserverDirectory = path.join(root, "xserver");
    fs.mkdirSync(xserverDirectory, {recursive:true});
    fs.writeFileSync(path.join(xserverDirectory, "XQuartz-2.8.6.pkg"), Buffer.alloc(23));
    const xserver = createXServerRuntime({platform:"darwin", runtimeDataDir:xserverDirectory});
    assert.equal(xserver.cacheInfo().bytes, 23);
    xserver.clearCache();
    assert.equal(fs.existsSync(path.join(xserverDirectory, "XQuartz-2.8.6.pkg")), false);
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
}

checkProgramCacheAggregation();
checkRemoteComponentResiduals();
checkDesktopInstallerCaches();
console.log("程序缓存分类、残留目录边界与本机安装包清理检查通过");
