const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-db-reopen-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TUNNELDESK_DATA_DIR, {recursive:true});
const legacy = new DatabaseSync(path.join(process.env.TUNNELDESK_DATA_DIR, "tunnels.db"));
legacy.exec(`CREATE TABLE connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT '默认分组',
  ssh_host TEXT NOT NULL, ssh_port INTEGER NOT NULL DEFAULT 22, ssh_user TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'key', identity_file TEXT, ssh_password TEXT, tags TEXT, extra_args TEXT,
  autostart_forwards INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);`);
const legacyInsert = legacy.prepare("INSERT INTO connections(name,group_name,ssh_host,ssh_port,ssh_user,auth_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
legacyInsert.run("legacy-z", "测试", "z.invalid", 22, "root", "key", 1, 1);
legacyInsert.run("legacy-a", "测试", "a.invalid", 22, "root", "key", 2, 2);
legacy.close();

const database = require("../dist/db");
let cryptoStore = null;

function assertStartup(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(actual?.[key], value, key);
}

try {
  const migrated = database.listConnections();
  assert.deepEqual(migrated.map(item => item.sort_order), [1, 1]);
  assert.deepEqual(migrated.map(item => item.name), ["legacy-a", "legacy-z"]);
  assert.deepEqual(migrated.map(item => [item.terminal_line_height, item.terminal_font_weight]), [[1, "normal"], [1, "normal"]]);
  assert.deepEqual(migrated.map(item => [
    item.terminal_startup_mode,
    item.terminal_profile_name,
    item.terminal_profile_kind,
    item.terminal_program_path,
    item.terminal_program_args,
    item.terminal_working_directory,
    item.terminal_program_platform
  ]), [
    ["default", "", "shell", "", "", "", "auto"],
    ["default", "", "shell", "", "", "", "auto"]
  ]);
  const id = database.insertConnection({
    name: "reopen-check",
    group_name: "测试",
    ssh_host: "example.invalid",
    ssh_port: 22,
    ssh_user: "root",
    auth_type: "key",
    identity_file: ""
  }, "");
  assert.ok(id > 0);
  assert.deepEqual(database.listConnections().map(item => item.name), ["legacy-a", "legacy-z", "reopen-check"]);
  const display = database.updateTerminalPreferences(id, {
    terminal_encoding: "gb18030",
    terminal_font_family: "Cascadia Mono, monospace",
    terminal_font_size: 16,
    terminal_mobile_font_size: 18,
    terminal_line_height: 1.4,
    terminal_font_weight: "600"
  });
  assert.deepEqual(display, {
    terminal_encoding: "gb18030",
    terminal_font_family: "Cascadia Mono, monospace",
    terminal_font_size: 16,
    terminal_mobile_font_size: 18,
    terminal_line_height: 1.4,
    terminal_font_weight: "600"
  });
  const startup = database.updateTerminalStartup(id, {
    terminal_startup_mode: "program",
    terminal_profile_name: "Python 3",
    terminal_profile_kind: "repl",
    terminal_program_path: "/usr/bin/python3",
    terminal_program_args: "-i",
    terminal_working_directory: "/srv",
    terminal_program_platform: "posix"
  });
  assert.deepEqual(startup, {
    terminal_startup_mode: "program",
    terminal_profile_name: "Python 3",
    terminal_profile_kind: "repl",
    terminal_program_path: "/usr/bin/python3",
    terminal_program_args: "-i",
    terminal_working_directory: "/srv",
    terminal_program_platform: "posix"
  });
  assertStartup(database.getConnection(id), startup);
  cryptoStore = require("../dist/crypto-store");
  cryptoStore.enableEncryption("reopen-check-secret");
  assert.ok(database.encryptStoredConnectionSecrets() >= 1);
  const storedStartup = database.get("SELECT terminal_program_path,terminal_program_args,terminal_working_directory FROM connections WHERE id=?", [id]);
  assert.match(storedStartup.terminal_program_path, /^tdenc:v1:/);
  assert.match(storedStartup.terminal_program_args, /^tdenc:v1:/);
  assert.match(storedStartup.terminal_working_directory, /^tdenc:v1:/);
  assertStartup(database.getConnection(id), startup);
  assert.throws(
    () => database.updateTerminalStartup(id, { terminal_startup_mode: "program", terminal_program_path: "" }),
    /程序路径/
  );
  assert.throws(
    () => database.updateTerminalStartup(id, { terminal_startup_mode: "program", terminal_program_args: "-i\n--inspect" }),
    /不能包含换行/
  );
  assert.throws(() => database.updateTerminalPreferences(id, { terminal_line_height: 2.5 }), /行距/);
  const snapshot = database.exportConfigSnapshot();
  database.updateTerminalPreferences(id, { terminal_line_height:1.6, terminal_font_weight:"bold" });
  database.updateTerminalStartup(id, { terminal_startup_mode: "default" });
  database.restoreConfigSnapshot(snapshot);
  assert.equal(database.getConnection(id).terminal_line_height, 1.4);
  assert.equal(database.getConnection(id).terminal_font_weight, "600");
  assert.equal(database.getConnection(id).terminal_mobile_font_size, 18);
  assertStartup(database.getConnection(id), startup);
  const legacySnapshot = structuredClone(snapshot);
  for (const connection of legacySnapshot.connections) {
    delete connection.terminal_startup_mode;
    delete connection.terminal_profile_name;
    delete connection.terminal_profile_kind;
    delete connection.terminal_program_path;
    delete connection.terminal_program_args;
    delete connection.terminal_working_directory;
    delete connection.terminal_program_platform;
  }
  database.restoreConfigSnapshot(legacySnapshot);
  assertStartup(database.getConnection(id), {
    terminal_startup_mode: "default",
    terminal_profile_name: "",
    terminal_profile_kind: "shell",
    terminal_program_path: "",
    terminal_program_args: "",
    terminal_working_directory: "",
    terminal_program_platform: "auto"
  });
  database.restoreConfigSnapshot(snapshot);
  assertStartup(database.getConnection(id), startup);
  database.updateConnection(2, {...database.getConnection(2), sort_order:2}, "");
  assert.deepEqual(database.listConnections().map(item => item.name), ["legacy-z", "reopen-check", "legacy-a"]);
  database.closeDatabase();
  database.reopenDatabase();
  const restored = database.listConnections().find(item => item.id === id);
  assert.equal(restored?.name, "reopen-check");
  assert.equal(restored?.identity_file, null);
  assert.equal(restored?.sort_order, 1);
  assert.equal(restored?.terminal_line_height, 1.4);
  assert.equal(restored?.terminal_font_weight, "600");
  assertStartup(restored, startup);
  console.log("Database close/reopen and connection ordering passed.");
} finally {
  try { database.closeDatabase(); } catch {}
  try { cryptoStore?.disableEncryption(); } catch {}
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
