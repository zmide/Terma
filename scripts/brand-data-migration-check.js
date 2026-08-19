"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { fileHash, mergeDatabaseFiles, mergeLegacyRuntime } = require("../desktop/brand-data-migration");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-brand-merge-check-"));
const sourceRuntime = path.join(temporaryRoot, "TunnelDesk", "runtime");
const targetRuntime = path.join(temporaryRoot, "Terma-runtime");
const backupParent = path.join(temporaryRoot, "backups");
const sourceData = path.join(sourceRuntime, "data");
const sourceSsh = path.join(sourceRuntime, ".ssh");
const targetData = path.join(targetRuntime, "data");
const targetSsh = path.join(targetRuntime, ".ssh");
const sourceDatabase = path.join(sourceData, "tunnels.db");
const targetDatabase = path.join(targetData, "tunnels.db");
const externalIdentity = path.join(temporaryRoot, "external-home", ".ssh", "id_ed25519_external");

function createSchema(file) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const db = new DatabaseSync(file);
  db.exec(`
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
  private_key_passphrase TEXT,
  extra_args TEXT,
  terminal_program_path TEXT,
  terminal_program_args TEXT,
  terminal_working_directory TEXT,
  jump_connection_id INTEGER,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE connection_groups (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE connection_forwards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  service_name TEXT,
  service_type TEXT,
  service_note TEXT,
  url_scheme TEXT,
  url_path TEXT,
  bind_host TEXT NOT NULL,
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  restore INTEGER NOT NULL DEFAULT 0,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE TABLE remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE forward_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT NOT NULL, service_name TEXT, service_type TEXT, service_note TEXT, url_scheme TEXT, url_path TEXT, bind_host TEXT, bind_port INTEGER, target_host TEXT, target_port INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE command_snippets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_name TEXT NOT NULL, command TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE named_workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', layout_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE tunnels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT NOT NULL, ssh_host TEXT NOT NULL, ssh_port INTEGER NOT NULL, ssh_user TEXT NOT NULL, identity_file TEXT, extra_args TEXT, bind_host TEXT NOT NULL, bind_port INTEGER NOT NULL, target_host TEXT, target_port INTEGER, pid INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.close();
}

function seedTarget() {
  createSchema(targetDatabase);
  const db = new DatabaseSync(targetDatabase);
  db.exec("PRAGMA foreign_keys=ON");
  db.prepare("INSERT INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)").run("当前分组", 1, 1, 1);
  db.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(1, "共享连接", "当前分组", "current.example", 2200, "current-user", "key", null, "target-visible", 1, 20);
  db.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(2, "当前独有", "当前分组", "current-only.example", 22, "root", "key", null, "current-only", 1, 20);
  db.prepare("INSERT INTO connection_forwards(id,connection_id,mode,service_name,url_scheme,url_path,bind_host,bind_port,target_host,target_port,status,restore,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(11, 1, "local", "当前名称", "http", "/current", "127.0.0.1", 6001, "127.0.0.1", 6868, "stopped", 1, 1, 20);
  db.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(21, "共享 VNC", "当前分组", "vnc", "current.example", 5900, "current-user", null, JSON.stringify({ target_only:true }), 1, 20);
  db.prepare("INSERT INTO named_workspaces(id,name,description,layout_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(31, "当前工作区", "", JSON.stringify({ version:1, tabs:[] }), 1, 20);
  db.prepare("INSERT INTO named_workspaces(id,name,description,layout_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(32, "共享工作区", "当前内容", JSON.stringify({ version:1, tabs:[] }), 1, 20);
  db.prepare("INSERT INTO forward_templates(id,name,mode,url_scheme,url_path,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(41, "旧模板", "local", "http", "/target", "127.0.0.1", 5432, "127.0.0.1", 5432, 1, 20);
  db.prepare("INSERT INTO command_snippets(id,name,group_name,command,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(51, "共享命令", "当前分组", "echo target", 1, 20);
  db.prepare("INSERT INTO tunnels(id,name,mode,ssh_host,ssh_port,ssh_user,identity_file,bind_host,bind_port,target_host,target_port,pid,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(61, "旧隧道", "local", "current.example", 22, "root", null, "127.0.0.1", 9000, "127.0.0.1", 9001, null, "stopped", 1, 20);
  db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run("shared", "target-wins");
  db.close();
  fs.mkdirSync(targetSsh, { recursive:true });
  fs.writeFileSync(path.join(targetSsh, "id_conflict"), "target key\n", "utf8");
  fs.writeFileSync(path.join(targetSsh, "id_same"), "same key\n", "utf8");
  fs.writeFileSync(path.join(targetData, "runtime-settings.json"), "{\"target\":true}", "utf8");
}

function seedSource() {
  createSchema(sourceDatabase);
  const db = new DatabaseSync(sourceDatabase);
  db.exec("PRAGMA foreign_keys=ON");
  db.prepare("INSERT INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)").run("测试", 1, 1, 1);
  db.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(101, "共享连接", "测试", "current.example", 2200, "current-user", "key", externalIdentity, "legacy-visible", 1, 10);
  db.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(102, "旧版测试连接", "测试", "test.example", 22, "root", "key", path.join(sourceSsh, "id_conflict"), "legacy-only", 1, 10);
  db.prepare("INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(103, "共享连接", "测试", "same-name-different-endpoint.example", 22, "root", "key", null, "legacy-conflict", 1, 10);
  db.prepare("INSERT INTO connection_forwards(id,connection_id,mode,service_name,url_scheme,url_path,bind_host,bind_port,target_host,target_port,status,restore,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(201, 101, "local", "旧名称", "http", "/legacy", "127.0.0.1", 6001, "127.0.0.1", 6868, "running", 0, 1, 10);
  db.prepare("INSERT INTO connection_forwards(id,connection_id,mode,service_name,url_scheme,url_path,bind_host,bind_port,target_host,target_port,status,restore,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(202, 102, "local", "测试面板", "https", "/panel", "127.0.0.1", 8888, "127.0.0.1", 8080, "running", 0, 1, 10);
  db.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(301, "共享 VNC", "测试", "vnc", "current.example", 5900, "current-user", "legacy-password", JSON.stringify({ source_only:true, source_ssh_connection_id:101 }), 1, 10);
  db.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(302, "旧版 RDP", "测试", "rdp", "test.example", 3389, "root", null, JSON.stringify({ source_ssh_connection_id:102 }), 1, 10);
  db.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(303, "共享 VNC", "测试", "vnc", "different.example", 5902, "root", null, JSON.stringify({ source_ssh_connection_id:103 }), 1, 10);
  db.prepare("INSERT INTO forward_templates(id,name,mode,url_scheme,url_path,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(401, "旧模板", "local", "http", "/source", "127.0.0.1", 3306, "127.0.0.1", 3306, 1, 10);
  db.prepare("INSERT INTO command_snippets(id,name,group_name,command,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(501, "共享命令", "当前分组", "echo source", 1, 10);
  const layout = {
    version:1,
    tabs:[{ key:"terminal-102-1", kind:"terminal", viewName:"terminal", id:102 }],
    layout:{ type:"pane", id:"pane-1", tabs:["terminal-102-1"], activeTabKey:"terminal-102-1" },
    activeTabKey:"terminal-102-1",
    running_forward_ids:[202],
    connection_refs:[{ id:102, name:"旧版测试连接" }],
    remote_profile_refs:[{ id:302, name:"旧版 RDP" }],
    forward_refs:[{ id:202, connection_id:102 }]
  };
  db.prepare("INSERT INTO named_workspaces(id,name,description,layout_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(601, "测试工作区", "", JSON.stringify(layout), 1, 10);
  db.prepare("INSERT INTO named_workspaces(id,name,description,layout_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(602, "共享工作区", "旧版内容", JSON.stringify(layout), 1, 10);
  db.prepare("INSERT INTO tunnels(id,name,mode,ssh_host,ssh_port,ssh_user,identity_file,bind_host,bind_port,target_host,target_port,pid,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(701, "旧隧道", "local", "test.example", 22, "root", path.join(sourceSsh, "id_conflict"), "127.0.0.1", 9000, "127.0.0.1", 9001, 123, "running", 1, 10);
  db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run("shared", "source-loses");
  db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run("source-only", "preserved");
  db.close();
  fs.mkdirSync(sourceSsh, { recursive:true });
  fs.writeFileSync(path.join(sourceSsh, "id_conflict"), "source key\n", "utf8");
  fs.writeFileSync(path.join(sourceSsh, "id_same"), "same key\n", "utf8");
  fs.writeFileSync(path.join(sourceData, "source-only.json"), "{\"legacy\":true}", "utf8");
}

function readDatabase(file) {
  return new DatabaseSync(file, { readOnly:true });
}

try {
  seedTarget();
  seedSource();
  const sourceHash = fileHash(sourceDatabase);
  const first = mergeLegacyRuntime({ sourceDataDir:sourceData, sourceSshDir:sourceSsh, targetDataDir:targetData, targetSshDir:targetSsh, backupParent });
  assert.ok(first.backupRoot && fs.existsSync(first.backupRoot));
  assert.deepEqual(first.cleanupPending || [], [], "successful migration must clean staging and swap directories");
  assert.equal(first.ssh.renamed, 1);
  assert.equal(first.ssh.reused, 1);
  assert.equal(fs.readFileSync(path.join(targetSsh, "id_conflict"), "utf8"), "target key\n");
  assert.equal(fs.readFileSync(path.join(targetSsh, "id_conflict-legacy"), "utf8"), "source key\n");
  assert.equal(fs.readFileSync(path.join(targetData, "runtime-settings.json"), "utf8"), "{\"target\":true}");
  assert.equal(fs.readFileSync(path.join(targetData, "source-only.json"), "utf8"), "{\"legacy\":true}");
  assert.equal(fileHash(sourceDatabase), sourceHash, "source database must remain unchanged");

  const db = readDatabase(targetDatabase);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM connections").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM connection_forwards").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM remote_profiles").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM named_workspaces").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM forward_templates").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM command_snippets").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tunnels").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM connection_groups WHERE name='测试'").get().count, 1);
  const shared = db.prepare("SELECT * FROM connections WHERE name='共享连接'").get();
  assert.equal(shared.ssh_host, "current.example");
  assert.equal(shared.ssh_user, "current-user");
  assert.equal(shared.tags, "target-visible");
  assert.equal(shared.identity_file, externalIdentity, "external identity paths must be preserved verbatim");
  const migratedConnection = db.prepare("SELECT * FROM connections WHERE name='旧版测试连接'").get();
  assert.equal(path.resolve(migratedConnection.identity_file), path.resolve(targetSsh, "id_conflict-legacy"));
  const preservedConflict = db.prepare("SELECT * FROM connections WHERE name='共享连接（旧版）'").get();
  assert.equal(preservedConflict.ssh_host, "same-name-different-endpoint.example");
  const sharedProfile = db.prepare("SELECT * FROM remote_profiles WHERE name='共享 VNC'").get();
  assert.equal(sharedProfile.host, "current.example");
  assert.equal(sharedProfile.password, "legacy-password");
  assert.deepEqual(JSON.parse(sharedProfile.options_json), { source_only:true, source_ssh_connection_id:1, target_only:true });
  assert.equal(db.prepare("SELECT host FROM remote_profiles WHERE name='共享 VNC（旧版）'").get().host, "different.example");
  assert.equal(db.prepare("SELECT bind_port FROM forward_templates WHERE name='旧模板（旧版）'").get().bind_port, 3306);
  assert.equal(db.prepare("SELECT command FROM command_snippets WHERE name='共享命令（旧版）'").get().command, "echo source");
  assert.equal(db.prepare("SELECT description FROM named_workspaces WHERE name='共享工作区（旧版）'").get().description, "旧版内容");
  assert.equal(db.prepare("SELECT ssh_host FROM tunnels WHERE name='旧隧道（旧版）'").get().ssh_host, "test.example");
  const migratedProfile = db.prepare("SELECT * FROM remote_profiles WHERE name='旧版 RDP'").get();
  assert.equal(JSON.parse(migratedProfile.options_json).source_ssh_connection_id, migratedConnection.id);
  const sharedForward = db.prepare("SELECT * FROM connection_forwards WHERE connection_id=1 AND bind_port=6001").get();
  assert.equal(sharedForward.service_name, "当前名称");
  assert.equal(sharedForward.url_path, "/current");
  const migratedForward = db.prepare("SELECT * FROM connection_forwards WHERE connection_id=?").get(migratedConnection.id);
  assert.equal(migratedForward.status, "stopped");
  assert.equal(migratedForward.url_path, "/panel");
  assert.equal(migratedForward.pid, null);
  const workspace = JSON.parse(db.prepare("SELECT layout_json FROM named_workspaces WHERE name='测试工作区'").get().layout_json);
  assert.equal(workspace.tabs[0].id, migratedConnection.id);
  assert.equal(workspace.connection_refs[0].id, migratedConnection.id);
  assert.equal(workspace.remote_profile_refs[0].id, migratedProfile.id);
  assert.equal(workspace.forward_refs[0].id, migratedForward.id);
  assert.equal(workspace.forward_refs[0].connection_id, migratedConnection.id);
  assert.equal(workspace.running_forward_ids[0], migratedForward.id);
  assert.equal(workspace.tabs[0].key, `terminal-${migratedConnection.id}-1`);
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='shared'").get().value, "target-wins");
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='source-only'").get().value, "preserved");
  db.close();

  const second = mergeLegacyRuntime({ sourceDataDir:sourceData, sourceSshDir:sourceSsh, targetDataDir:targetData, targetSshDir:targetSsh, backupParent });
  const afterSecond = readDatabase(targetDatabase);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM connections").get().count, 4);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM connection_forwards").get().count, 2);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM remote_profiles").get().count, 3);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM named_workspaces").get().count, 4);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM forward_templates").get().count, 2);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM command_snippets").get().count, 2);
  assert.equal(afterSecond.prepare("SELECT COUNT(*) AS count FROM tunnels").get().count, 2);
  afterSecond.close();
  assert.equal(second.ssh.renamed, 0);
  assert.equal(second.ssh.reused, 2);
  assert.equal(fileHash(sourceDatabase), sourceHash);

  const emptyRoot = path.join(temporaryRoot, "empty-runtime");
  const sourceOnly = mergeLegacyRuntime({
    sourceDataDir:sourceData,
    sourceSshDir:sourceSsh,
    targetDataDir:path.join(emptyRoot, "data"),
    targetSshDir:path.join(emptyRoot, ".ssh"),
    backupParent
  });
  assert.equal(sourceOnly.backupRoot, "");
  const sourceOnlyDb = readDatabase(path.join(emptyRoot, "data", "tunnels.db"));
  const sourceOnlyForward = sourceOnlyDb.prepare("SELECT pid,status,reconnect_count,last_error,started_at FROM connection_forwards WHERE id=202").get();
  assert.equal(sourceOnlyForward.pid, null);
  assert.equal(sourceOnlyForward.status, "stopped");
  assert.equal(sourceOnlyForward.reconnect_count, 0);
  assert.equal(sourceOnlyForward.last_error, null);
  assert.equal(sourceOnlyForward.started_at, null);
  sourceOnlyDb.close();

  const encryptedSourceData = path.join(temporaryRoot, "encrypted-source", "data");
  const encryptedTargetData = path.join(temporaryRoot, "encrypted-target", "data");
  const encryptedSourceDatabase = path.join(encryptedSourceData, "tunnels.db");
  const encryptedTargetDatabase = path.join(encryptedTargetData, "tunnels.db");
  createSchema(encryptedSourceDatabase);
  createSchema(encryptedTargetDatabase);
  const encryptedSource = new DatabaseSync(encryptedSourceDatabase);
  encryptedSource.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(1, "legacy-prefix", "Default", "vnc", "legacy.example", 5900, "tester", "tdenc:v1:legacy", "{}", 1, 1);
  encryptedSource.prepare("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(2, "terma-prefix", "Default", "vnc", "terma.example", 5900, "tester", "termaenc:v1:current", "{}", 1, 1);
  encryptedSource.close();
  const securitySettings = JSON.stringify({ encryption_enabled:true, encryption_salt:"shared-salt", encryption_check:"shared-check" });
  fs.writeFileSync(path.join(encryptedSourceData, "security.json"), securitySettings, "utf8");
  fs.writeFileSync(path.join(encryptedTargetData, "security.json"), securitySettings, "utf8");
  assert.doesNotThrow(() => mergeDatabaseFiles(encryptedSourceDatabase, encryptedTargetDatabase, {
    sourceDataDir:encryptedSourceData,
    targetDataDir:encryptedTargetData
  }));
  const encryptedMerged = readDatabase(encryptedTargetDatabase);
  assert.equal(encryptedMerged.prepare("SELECT COUNT(*) AS count FROM remote_profiles").get().count, 2);
  encryptedMerged.close();

  const plainFieldsSourceData = path.join(temporaryRoot, "plain-fields-source", "data");
  const plainFieldsTargetData = path.join(temporaryRoot, "plain-fields-target", "data");
  const plainFieldsSourceDatabase = path.join(plainFieldsSourceData, "tunnels.db");
  const plainFieldsTargetDatabase = path.join(plainFieldsTargetData, "tunnels.db");
  createSchema(plainFieldsSourceDatabase);
  createSchema(plainFieldsTargetDatabase);
  const plainFieldsSource = new DatabaseSync(plainFieldsSourceDatabase);
  plainFieldsSource.prepare("INSERT INTO connections(name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,extra_args,terminal_program_args,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("plain-paths", "Default", "plain.example", 22, "tester", "key", "/tmp/plain-key", "-o Compression=yes", "--plain", 1, 1);
  plainFieldsSource.close();
  fs.writeFileSync(path.join(plainFieldsTargetData, "security.json"), securitySettings, "utf8");
  assert.throws(() => mergeDatabaseFiles(plainFieldsSourceDatabase, plainFieldsTargetDatabase, {
    sourceDataDir:plainFieldsSourceData,
    targetDataDir:plainFieldsTargetData
  }), /明文凭据/);

  const contaminatedSourceRoot = path.join(temporaryRoot, "contaminated-source");
  const contaminatedTargetRoot = path.join(temporaryRoot, "contaminated-target");
  const contaminatedSourceData = path.join(contaminatedSourceRoot, "data");
  const contaminatedTargetData = path.join(contaminatedTargetRoot, "data");
  const contaminatedSourceSsh = path.join(contaminatedSourceRoot, ".ssh");
  const contaminatedTargetSsh = path.join(contaminatedTargetRoot, ".ssh");
  const contaminatedSourceDatabase = path.join(contaminatedSourceData, "tunnels.db");
  const contaminatedTargetDatabase = path.join(contaminatedTargetData, "tunnels.db");
  createSchema(contaminatedSourceDatabase);
  createSchema(contaminatedTargetDatabase);
  fs.mkdirSync(contaminatedSourceSsh, {recursive:true});
  fs.mkdirSync(contaminatedTargetSsh, {recursive:true});
  const contaminatedSource = new DatabaseSync(contaminatedSourceDatabase);
  contaminatedSource.prepare("INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("encrypted-source", "Default", "vnc", "source.example", 5900, "tester", "termaenc:v1:source", "{}", 1, 1);
  contaminatedSource.close();
  const contaminatedTarget = new DatabaseSync(contaminatedTargetDatabase);
  contaminatedTarget.prepare("INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("plain-target", "Default", "vnc", "target.example", 5900, "tester", "plain-target-password", "{}", 1, 1);
  contaminatedTarget.close();
  fs.writeFileSync(path.join(contaminatedSourceData, "security.json"), securitySettings, "utf8");
  assert.throws(() => mergeLegacyRuntime({
    sourceDataDir:contaminatedSourceData,
    sourceSshDir:contaminatedSourceSsh,
    targetDataDir:contaminatedTargetData,
    targetSshDir:contaminatedTargetSsh,
    backupParent
  }), /不能直接合并/);
  assert.equal(fs.existsSync(path.join(contaminatedTargetData, "security.json")), false, "source security.json must not become target authority during a merge");
  const contaminationCheck = readDatabase(contaminatedTargetDatabase);
  assert.equal(contaminationCheck.prepare("SELECT password FROM remote_profiles WHERE name='plain-target'").get().password, "plain-target-password");
  contaminationCheck.close();

  const sourceOnlyEncryptedRoot = path.join(temporaryRoot, "source-only-encrypted");
  const sourceOnlyEncryptedTarget = path.join(temporaryRoot, "source-only-encrypted-target");
  const sourceOnlyEncryptedData = path.join(sourceOnlyEncryptedRoot, "data");
  const sourceOnlyEncryptedSsh = path.join(sourceOnlyEncryptedRoot, ".ssh");
  createSchema(path.join(sourceOnlyEncryptedData, "tunnels.db"));
  fs.mkdirSync(sourceOnlyEncryptedSsh, {recursive:true});
  fs.writeFileSync(path.join(sourceOnlyEncryptedData, "security.json"), securitySettings, "utf8");
  mergeLegacyRuntime({
    sourceDataDir:sourceOnlyEncryptedData,
    sourceSshDir:sourceOnlyEncryptedSsh,
    targetDataDir:path.join(sourceOnlyEncryptedTarget, "data"),
    targetSshDir:path.join(sourceOnlyEncryptedTarget, ".ssh"),
    backupParent
  });
  assert.equal(
    fs.readFileSync(path.join(sourceOnlyEncryptedTarget, "data", "security.json"), "utf8"),
    securitySettings,
    "source-only migration must inherit the source security descriptor"
  );

  const inconsistentEncryptedRoot = path.join(temporaryRoot, "source-only-missing-security");
  const inconsistentEncryptedData = path.join(inconsistentEncryptedRoot, "data");
  const inconsistentEncryptedSsh = path.join(inconsistentEncryptedRoot, ".ssh");
  const inconsistentEncryptedDb = path.join(inconsistentEncryptedData, "tunnels.db");
  createSchema(inconsistentEncryptedDb);
  fs.mkdirSync(inconsistentEncryptedSsh, {recursive:true});
  const inconsistentEncrypted = new DatabaseSync(inconsistentEncryptedDb);
  inconsistentEncrypted.prepare("INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("missing-security", "Default", "vnc", "missing.example", 5900, "tester", "termaenc:v1:missing", "{}", 1, 1);
  inconsistentEncrypted.close();
  assert.throws(() => mergeLegacyRuntime({
    sourceDataDir:inconsistentEncryptedData,
    sourceSshDir:inconsistentEncryptedSsh,
    targetDataDir:path.join(temporaryRoot, "source-only-missing-security-target", "data"),
    targetSshDir:path.join(temporaryRoot, "source-only-missing-security-target", ".ssh"),
    backupParent
  }), /未启用配置加密/);

  const inconsistentPlainRoot = path.join(temporaryRoot, "source-only-plain-encrypted");
  const inconsistentPlainData = path.join(inconsistentPlainRoot, "data");
  const inconsistentPlainSsh = path.join(inconsistentPlainRoot, ".ssh");
  const inconsistentPlainDb = path.join(inconsistentPlainData, "tunnels.db");
  createSchema(inconsistentPlainDb);
  fs.mkdirSync(inconsistentPlainSsh, {recursive:true});
  const inconsistentPlain = new DatabaseSync(inconsistentPlainDb);
  inconsistentPlain.prepare("INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("plain-secret", "Default", "vnc", "plain.example", 5900, "tester", "plain-password", "{}", 1, 1);
  inconsistentPlain.close();
  fs.writeFileSync(path.join(inconsistentPlainData, "security.json"), securitySettings, "utf8");
  assert.throws(() => mergeLegacyRuntime({
    sourceDataDir:inconsistentPlainData,
    sourceSshDir:inconsistentPlainSsh,
    targetDataDir:path.join(temporaryRoot, "source-only-plain-encrypted-target", "data"),
    targetSshDir:path.join(temporaryRoot, "source-only-plain-encrypted-target", ".ssh"),
    backupParent
  }), /明文敏感字段/);

  const rollbackRoot = path.join(temporaryRoot, "rollback-runtime");
  const rollbackData = path.join(rollbackRoot, "data");
  const rollbackSsh = path.join(rollbackRoot, ".ssh");
  fs.cpSync(targetData, rollbackData, { recursive:true });
  fs.cpSync(targetSsh, rollbackSsh, { recursive:true });
  fs.writeFileSync(path.join(sourceData, "rollback-only.json"), "legacy-only\n", "utf8");
  fs.writeFileSync(path.join(sourceSsh, "id_rollback_only"), "rollback key\n", "utf8");
  fs.writeFileSync(path.join(rollbackData, "web.log"), "active log\n", "utf8");
  const rollbackDatabase = path.join(rollbackData, "tunnels.db");
  const rollbackHash = fileHash(rollbackDatabase);
  const logHandle = fs.openSync(path.join(rollbackData, "web.log"), "a");
  const originalCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = function(source, destination, ...args) {
    if (path.resolve(destination) === path.resolve(path.join(rollbackSsh, "id_rollback_only"))) {
      const injected = new Error("injected promotion failure");
      injected.code = "EACCES";
      throw injected;
    }
    return originalCopyFileSync.call(fs, source, destination, ...args);
  };
  try {
    assert.throws(() => mergeLegacyRuntime({
      sourceDataDir:sourceData,
      sourceSshDir:sourceSsh,
      targetDataDir:rollbackData,
      targetSshDir:rollbackSsh,
      backupParent
    }), /injected promotion failure/);
  } finally {
    fs.copyFileSync = originalCopyFileSync;
    fs.closeSync(logHandle);
  }
  assert.equal(fileHash(rollbackDatabase), rollbackHash, "failed promotion must restore the previous database");
  assert.equal(fs.readFileSync(path.join(rollbackData, "web.log"), "utf8"), "active log\n", "unrelated active runtime files must remain untouched");
  assert.equal(fs.existsSync(path.join(rollbackData, "rollback-only.json")), false, "files created during a failed promotion must be removed");
  assert.equal(fs.existsSync(path.join(rollbackSsh, "id_rollback_only")), false, "partially copied keys must not remain after rollback");

  const previousLanguage = process.env.TERMA_INTERFACE_LANGUAGE;
  process.env.TERMA_INTERFACE_LANGUAGE = "en-US";
  try {
    assert.throws(() => mergeLegacyRuntime({
      sourceDataDir:path.join(temporaryRoot, "missing-legacy", "data"),
      sourceSshDir:path.join(temporaryRoot, "missing-legacy", ".ssh"),
      targetDataDir:path.join(temporaryRoot, "english-target", "data"),
      targetSshDir:path.join(temporaryRoot, "english-target", ".ssh")
    }), /No valid legacy database was found/);
  } finally {
    if (previousLanguage === undefined) delete process.env.TERMA_INTERFACE_LANGUAGE;
    else process.env.TERMA_INTERFACE_LANGUAGE = previousLanguage;
  }
  console.log("Brand data migration merge checks passed.");
} finally {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { fs.rmSync(temporaryRoot, { recursive:true, force:true }); break; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
  }
}
