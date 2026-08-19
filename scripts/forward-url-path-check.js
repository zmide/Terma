"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-forward-url-path-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TERMA_DATA_DIR, {recursive:true});

const legacyDatabase = new DatabaseSync(path.join(process.env.TERMA_DATA_DIR, "tunnels.db"));
legacyDatabase.exec(`
  CREATE TABLE connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '默认分组',
    ssh_host TEXT NOT NULL,
    ssh_port INTEGER NOT NULL DEFAULT 22,
    ssh_user TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'key',
    identity_file TEXT,
    ssh_password TEXT,
    tags TEXT,
    extra_args TEXT,
    autostart_forwards INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE connection_forwards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    service_name TEXT,
    service_type TEXT,
    service_note TEXT,
    url_scheme TEXT,
    bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
    bind_port INTEGER NOT NULL,
    target_host TEXT,
    target_port INTEGER,
    pid INTEGER,
    status TEXT NOT NULL DEFAULT 'stopped',
    restore INTEGER NOT NULL DEFAULT 0,
    reconnect_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_error_code TEXT,
    started_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE forward_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    service_name TEXT,
    service_type TEXT,
    service_note TEXT,
    url_scheme TEXT,
    bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
    bind_port INTEGER NOT NULL,
    target_host TEXT,
    target_port INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,created_at,updated_at)
  VALUES(999,'Legacy forward owner','Tests','legacy.invalid',22,'tester','key',1,1);
  INSERT INTO connection_forwards(id,connection_id,mode,url_scheme,bind_host,bind_port,target_host,target_port,created_at,updated_at)
  VALUES(901,999,'local','http','127.0.0.1',18090,'127.0.0.1',8090,1,1);
  INSERT INTO forward_templates(id,name,mode,url_scheme,bind_host,bind_port,target_host,target_port,created_at,updated_at)
  VALUES(902,'Legacy URL template','local','http','127.0.0.1',18091,'127.0.0.1',8091,1,1);
`);
legacyDatabase.close();

try {
  const database = require("../dist/db");
  const forwardColumns = database.all("PRAGMA table_info(connection_forwards)").map(row => row.name);
  const templateColumns = database.all("PRAGMA table_info(forward_templates)").map(row => row.name);
  assert.ok(forwardColumns.includes("url_path"));
  assert.ok(templateColumns.includes("url_path"));
  assert.equal(database.getForward(901).url_path, null);
  assert.equal(database.getForwardTemplate(902).url_path, null);
  const connectionId = database.insertConnection({
    name:"URL path fixture",
    group_name:"Tests",
    ssh_host:"example.invalid",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:""
  }, "");
  const forwardId = database.insertForward(connectionId, {
    mode:"local",
    service_name:"Admin",
    service_type:"web",
    url_scheme:"https",
    url_path:"admin?view=full#status",
    bind_host:"127.0.0.1",
    bind_port:18443,
    target_host:"127.0.0.1",
    target_port:8443
  });
  let forward = database.getForward(forwardId);
  assert.equal(forward.url_path, "/admin?view=full#status");
  assert.equal(database.cleanForward({...forward, url_path:"?view=full"}).url_path, "?view=full");
  assert.equal(database.cleanForward({...forward, url_path:"#status"}).url_path, "#status");

  database.updateForward(forwardId, {...forward, url_path:"/panel"});
  forward = database.getForward(forwardId);
  assert.equal(forward.url_path, "/panel");

  const templateId = database.insertForwardTemplate({
    name:"Admin template",
    mode:"local",
    service_type:"web",
    url_scheme:"http",
    url_path:"docs",
    bind_host:"127.0.0.1",
    bind_port:18080,
    target_host:"127.0.0.1",
    target_port:8080
  });
  assert.equal(database.getForwardTemplate(templateId).url_path, "/docs");

  const unsafeCases = new Map([
    ["https://example.invalid/admin", "forward_url_path_external"],
    ["//example.invalid/admin", "forward_url_path_external"],
    ["\\\\example.invalid\\admin", "forward_url_path_backslash"],
    ["admin\u0000panel", "forward_url_path_control_character"],
    ["x".repeat(2049), "forward_url_path_too_long"]
  ]);
  for (const [unsafe, expectedCode] of unsafeCases) {
    assert.throws(() => database.insertForward(connectionId, {
      mode:"local",
      url_path:unsafe,
      bind_host:"127.0.0.1",
      bind_port:19000 + unsafe.length,
      target_host:"127.0.0.1",
      target_port:8080
    }), error => error?.publicCode === expectedCode && error?.statusCode === 400);
  }

  const duplicate = database.duplicateConnection(connectionId, "");
  assert.equal(database.listConnections().find(item => item.id === duplicate.id)?.forwards?.[0]?.url_path, "/panel");
  const snapshot = database.exportConfigSnapshot();
  database.updateForward(forwardId, {...forward, url_path:"/changed"});
  database.restoreConfigSnapshot(snapshot);
  assert.equal(database.getForward(forwardId).url_path, "/panel");
  assert.equal(database.getForwardTemplate(templateId).url_path, "/docs");

  const beforeUnsafeRestore = database.exportConfigSnapshot();
  const unsafeSnapshot = structuredClone(beforeUnsafeRestore);
  unsafeSnapshot.forwards[0].url_path = "https://evil.invalid/admin";
  assert.throws(
    () => database.restoreConfigSnapshot(unsafeSnapshot),
    error => error?.publicCode === "forward_url_path_external"
  );
  assert.deepEqual(database.exportConfigSnapshot(), beforeUnsafeRestore, "无效快照必须在清空原数据库前被拒绝");
  console.log("Forward URL path checks passed: legacy migration, normalization, validation, templates, duplication, and atomic snapshot rejection.");
} finally {
  try { require("../dist/db").closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
