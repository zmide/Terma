const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-remote-migration-"));
process.env.TERMA_DATA_DIR = temporary;

let db;
try {
  const legacy = new DatabaseSync(path.join(temporary, "tunnels.db"));
  legacy.exec(`
CREATE TABLE remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL CHECK(protocol IN ('rdp', 'vnc', 'ftp', 'telnet', 'serial')),
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  tags TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at)
VALUES('legacy-vnc','迁移测试','vnc','127.0.0.1',5900,'',NULL,1,123,'desktop','{"client_mode":"system","quality":6}',100,101);
  `);
  legacy.close();

  db = require("../dist/db");
  const migrated = db.getRemoteProfile(1);
  assert.equal(migrated.name, "legacy-vnc");
  assert.equal(migrated.favorite, 1);
  assert.equal(migrated.options.client_mode, "system");
  assert.equal(migrated.options.quality, 6);
  assert.equal(migrated.options.auto_sync_images, true, "旧 VNC 配置应默认启用图片双向自动同步");
  const schema = db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='remote_profiles'");
  assert.doesNotMatch(schema.sql, /CHECK\s*\(\s*protocol\s+IN/i);

  const xdmcpId = db.insertRemoteProfile({
    name:"xdmcp-after-migration",
    group_name:"迁移测试",
    protocol:"xdmcp",
    host:"192.168.31.77",
    port:177,
    options:{mode:"query", window_mode:"fullscreen"}
  });
  assert.equal(db.getRemoteProfile(xdmcpId).protocol, "xdmcp");
  assert.equal(db.getRemoteProfile(xdmcpId).options.ssh_connection_id, 0);
  console.log("远程协议迁移检查通过：旧配置无损保留并可新增 XDMCP");
} finally {
  try { db?.closeDatabase(); } catch {}
  const resolved = path.resolve(temporary);
  const root = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("terma-remote-migration-")) {
    fs.rmSync(resolved, {recursive:true, force:true});
  }
}
