"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-connection-duplicate-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");

const database = require("../dist/db");

const connectionFields = [
  "group_name", "ssh_host", "ssh_port", "ssh_user", "auth_type", "identity_file", "ssh_password",
  "tags", "extra_args", "autostart_forwards", "sort_order", "terminal_encoding", "terminal_font_family",
  "terminal_font_size", "terminal_mobile_font_size", "terminal_line_height", "terminal_font_weight",
  "terminal_startup_mode", "terminal_profile_name", "terminal_profile_kind", "terminal_program_path",
  "terminal_program_args", "terminal_working_directory", "terminal_program_platform", "sftp_text_encoding",
  "sftp_filename_encoding"
];
const forwardFields = [
  "mode", "service_name", "service_type", "service_note", "url_scheme", "bind_host", "bind_port",
  "target_host", "target_port"
];

function values(record, fields) {
  return Object.fromEntries(fields.map(field => [field, record[field]]));
}

try {
  const sourceId = database.insertConnection({
    name:"生产入口",
    group_name:"生产环境",
    ssh_host:"example.invalid",
    ssh_port:22022,
    ssh_user:"deploy",
    auth_type:"password",
    ssh_password:"fixture-secret",
    tags:"prod,edge",
    extra_args:"-o ServerAliveInterval=20",
    autostart_forwards:1,
    sort_order:17,
    terminal_encoding:"gb18030",
    terminal_font_family:"Consolas, monospace",
    terminal_font_size:16,
    terminal_mobile_font_size:14,
    terminal_line_height:1.4,
    terminal_font_weight:"600",
    terminal_startup_mode:"program",
    terminal_profile_name:"维护 Shell",
    terminal_profile_kind:"shell",
    terminal_program_path:"/bin/bash",
    terminal_program_args:"--login",
    terminal_working_directory:"/srv/app",
    terminal_program_platform:"posix",
    sftp_text_encoding:"gb18030",
    sftp_filename_encoding:"gbk"
  }, "");
  database.insertForward(sourceId, {
    mode:"local",
    service_name:"管理后台",
    service_type:"web",
    service_note:"仅本机访问",
    url_scheme:"https",
    bind_host:"127.0.0.1",
    bind_port:18443,
    target_host:"127.0.0.1",
    target_port:8443
  });
  database.insertForward(sourceId, {
    mode:"socks",
    service_name:"临时代理",
    service_type:"proxy",
    bind_host:"127.0.0.1",
    bind_port:11080
  });
  database.run("UPDATE connection_forwards SET pid=?,status='running',restore=1,reconnect_count=3,last_error='old error',started_at=? WHERE connection_id=?", [process.pid, Math.floor(Date.now() / 1000), sourceId]);

  const first = database.duplicateConnection(sourceId, "");
  const second = database.duplicateConnection(sourceId, "");
  const third = database.duplicateConnection(first.id, "");
  assert.equal(first.name, "生产入口（copy1）");
  assert.equal(second.name, "生产入口（copy2）");
  assert.equal(third.name, "生产入口（copy3）");

  const source = database.getConnection(sourceId);
  const sourceForwards = database.all("SELECT * FROM connection_forwards WHERE connection_id=? ORDER BY id", [sourceId]);
  for (const result of [first, second, third]) {
    const duplicate = database.getConnection(result.id);
    assert.deepEqual(values(duplicate, connectionFields), values(source, connectionFields));
    const duplicateForwards = database.all("SELECT * FROM connection_forwards WHERE connection_id=? ORDER BY id", [result.id]);
    assert.equal(duplicateForwards.length, sourceForwards.length);
    assert.deepEqual(duplicateForwards.map(item => values(item, forwardFields)), sourceForwards.map(item => values(item, forwardFields)));
    for (const forward of duplicateForwards) {
      assert.equal(forward.pid, null);
      assert.equal(forward.status, "stopped");
      assert.equal(forward.restore, 0);
      assert.equal(forward.reconnect_count, 0);
      assert.equal(forward.last_error, null);
      assert.equal(forward.started_at, null);
    }
  }
  console.log("SSH connection duplication checks passed.");
} finally {
  try { database.closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
