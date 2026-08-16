const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createDesktopStorageTransition,
  completeDesktopStorageTransition,
  finalizeDesktopStorageTransition,
  rollbackDesktopStorageTransition
} = require("../desktop/storage-migration");

const roots = [];
process.on("exit", () => {
  for (const root of roots) {
    try { fs.rmSync(root, {recursive:true, force:true}); } catch {}
  }
});

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-storage-migration-check-"));
  roots.push(root);
  return root;
}

function runtimePaths(root) {
  return {dataDir:path.join(root, "data"), sshDir:path.join(root, ".ssh")};
}

function seedRuntime(root) {
  fs.mkdirSync(path.join(root, "data", "logs"), {recursive:true});
  fs.mkdirSync(path.join(root, ".ssh"), {recursive:true});
  fs.writeFileSync(path.join(root, "data", "tunnels.db"), "database", "utf8");
  fs.writeFileSync(path.join(root, "data", "security.json"), "security", "utf8");
  fs.writeFileSync(path.join(root, "data", "logs", "today.log"), "log", "utf8");
  fs.writeFileSync(path.join(root, "data", "web.pid"), "123", "utf8");
  fs.writeFileSync(path.join(root, ".ssh", "id_ed25519"), "private-key", "utf8");
}

function copyRuntimeDirectory(sourceRoot, destinationRoot) {
  const sourceData = path.join(sourceRoot, "data");
  fs.mkdirSync(destinationRoot, {recursive:true});
  fs.cpSync(sourceData, path.join(destinationRoot, "data"), {
    recursive:true,
    filter:source => {
      const relative = path.relative(sourceData, source);
      return !relative || !new Set(["web.pid", "web.url", "web.json", "shutdown.token"]).has(relative.split(path.sep)[0]);
    }
  });
  fs.cpSync(path.join(sourceRoot, ".ssh"), path.join(destinationRoot, ".ssh"), {recursive:true});
}

function settings(root) {
  return {dataMode:"custom", customDataDir:root, minimizeToTray:true};
}

{
  const parent = temporaryRoot();
  const source = path.join(parent, "source");
  const target = path.join(parent, "target");
  seedRuntime(source);
  const transition = createDesktopStorageTransition(settings(source), settings(target), runtimePaths(source), runtimePaths(target));
  const completed = completeDesktopStorageTransition(transition, {
    copyRuntimeDirectory,
    ignoredDataEntries:["web.pid", "web.url", "web.json", "shutdown.token"]
  });
  assert.equal(completed.targetRoot, target);
  assert.equal(fs.readFileSync(path.join(target, "data", "tunnels.db"), "utf8"), "database");
  assert.equal(fs.readFileSync(path.join(target, ".ssh", "id_ed25519"), "utf8"), "private-key");
  assert.equal(fs.existsSync(path.join(target, "data", "web.pid")), false);
  assert.equal(fs.readFileSync(path.join(source, "data", "tunnels.db"), "utf8"), "database");
  assert.equal(fs.readdirSync(target).some(name => name.endsWith(".json") && name.startsWith(".terma-storage-migration-")), true);
  completeDesktopStorageTransition(transition, {copyRuntimeDirectory, ignoredDataEntries:["web.pid", "web.url", "web.json", "shutdown.token"]});
  finalizeDesktopStorageTransition(transition);
  assert.equal(fs.readdirSync(target).some(name => name.startsWith(".terma-storage-migration-")), false);
}

{
  const parent = temporaryRoot();
  const source = path.join(parent, "source");
  const target = path.join(parent, "target");
  seedRuntime(source);
  fs.mkdirSync(path.join(target, "data"), {recursive:true});
  fs.writeFileSync(path.join(target, "data", "tunnels.db"), "existing", "utf8");
  assert.throws(
    () => createDesktopStorageTransition(settings(source), settings(target), runtimePaths(source), runtimePaths(target)),
    /已经包含 data 数据/
  );
  const previousLanguage = process.env.TERMA_INTERFACE_LANGUAGE;
  process.env.TERMA_INTERFACE_LANGUAGE = "en-US";
  try {
    assert.throws(
      () => createDesktopStorageTransition(settings(source), settings(target), runtimePaths(source), runtimePaths(target)),
      /already contains data/
    );
  } finally {
    if (previousLanguage === undefined) delete process.env.TERMA_INTERFACE_LANGUAGE;
    else process.env.TERMA_INTERFACE_LANGUAGE = previousLanguage;
  }
  assert.equal(fs.readFileSync(path.join(target, "data", "tunnels.db"), "utf8"), "existing");
}

{
  const parent = temporaryRoot();
  const source = path.join(parent, "source");
  seedRuntime(source);
  const target = path.join(source, "nested-target");
  assert.throws(
    () => createDesktopStorageTransition(settings(source), settings(target), runtimePaths(source), runtimePaths(target)),
    /不能位于当前数据目录内部/
  );
}

{
  const parent = temporaryRoot();
  const source = path.join(parent, "source");
  const target = path.join(parent, "target");
  seedRuntime(source);
  const transition = createDesktopStorageTransition(settings(source), settings(target), runtimePaths(source), runtimePaths(target));
  assert.throws(
    () => completeDesktopStorageTransition(transition, {
      copyRuntimeDirectory(_sourceRoot, destinationRoot) {
        fs.mkdirSync(path.join(destinationRoot, "data"), {recursive:true});
        fs.writeFileSync(path.join(destinationRoot, "data", "tunnels.db"), "truncated", "utf8");
      },
      ignoredDataEntries:["web.pid"]
    }),
    /文件清单与原数据不一致/
  );
  rollbackDesktopStorageTransition(transition);
  assert.equal(fs.existsSync(path.join(target, "data", "tunnels.db")), false);
  assert.equal(fs.readFileSync(path.join(source, "data", "tunnels.db"), "utf8"), "database");
}

console.log("桌面数据路径迁移检查通过：停机复制、清单校验、源目录保留、冲突拒绝与失败回滚正常");
