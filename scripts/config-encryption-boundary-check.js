const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-encryption-boundary-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength:2048,
  privateKeyEncoding:{type:"pkcs1", format:"pem"}
});
const keyFile = path.join(process.env.TERMA_SSH_DIR, "id_boundary");
fs.writeFileSync(keyFile, privateKey, {mode:0o600});

const database = require("../dist/db");
const cryptoStore = require("../dist/crypto-store");
const snapshots = require("../dist/config-snapshots");

function encrypted(value) {
  return typeof value === "string" && value.startsWith("termaenc:v1:");
}

function assertLocked(callback) {
  assert.throws(callback, error => error?.code === "ENCRYPTION_LOCKED" && error?.statusCode === 423);
}

try {
  const passwordId = database.insertConnection({
    name:"password",
    group_name:"测试",
    ssh_host:"password.example",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"password",
    ssh_password:"ssh-secret",
    extra_args:"-o Compression=yes"
  }, "");
  const keyId = database.insertConnection({
    name:"key",
    group_name:"测试",
    ssh_host:"key.example",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:keyFile,
    private_key_passphrase:"key-secret",
    extra_args:"-o Compression=yes",
    terminal_startup_mode:"program",
    terminal_profile_name:"shell",
    terminal_profile_kind:"shell",
    terminal_program_path:"/bin/bash",
    terminal_program_args:"-l",
    terminal_working_directory:"/srv",
    terminal_program_platform:"posix"
  }, "");
  const remoteId = database.insertRemoteProfile({
    name:"vnc",
    group_name:"测试",
    protocol:"vnc",
    host:"vnc.example",
    port:5900,
    username:"tester",
    password:"vnc-secret",
    options:{}
  });
  database.run(
    "INSERT INTO tunnels(name,mode,ssh_host,ssh_port,ssh_user,identity_file,bind_host,bind_port,target_host,target_port,extra_args,autostart,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ["legacy", "local", "legacy.example", 22, "tester", keyFile, "127.0.0.1", 10022, "127.0.0.1", 22, "-o Compression=yes", 0, "stopped", 1, 1]
  );
  const plaintextSnapshot = database.exportConfigSnapshot();
  snapshots.createConfigSnapshot("加密前快照");
  assert.equal(snapshots.listConfigSnapshots().length, 1);

  cryptoStore.enableEncryption("boundary-password");
  assert.ok(database.encryptStoredConnectionSecrets() >= 4);
  const rawPassword = database.get("SELECT ssh_password,extra_args FROM connections WHERE id=?", [passwordId]);
  const rawKey = database.get("SELECT identity_file,private_key_passphrase,terminal_program_path,terminal_program_args,terminal_working_directory FROM connections WHERE id=?", [keyId]);
  const rawRemote = database.get("SELECT password FROM remote_profiles WHERE id=?", [remoteId]);
  const rawTunnel = database.get("SELECT identity_file,extra_args FROM tunnels WHERE name='legacy'");
  for (const value of [...Object.values(rawPassword), ...Object.values(rawKey), ...Object.values(rawRemote), ...Object.values(rawTunnel)]) {
    assert.equal(encrypted(value), true, "every stored secret must use termaenc:v1");
  }
  assert.equal(snapshots.pruneConfigSnapshotsForCurrentEncryption(), 1);
  assert.equal(snapshots.listConfigSnapshots().length, 0);
  snapshots.createConfigSnapshot("加密快照");
  assert.equal(snapshots.pruneConfigSnapshotsForCurrentEncryption(), 0);
  assert.equal(snapshots.clearConfigSnapshots(), 1);

  cryptoStore.lockEncryption();
  assertLocked(() => database.updateConnection(passwordId, {
    name:"renamed",
    group_name:"测试",
    ssh_host:"password.example",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"password"
  }, ""));
  assertLocked(() => database.updateRemoteProfile(remoteId, {
    name:"renamed-vnc",
    protocol:"vnc",
    host:"vnc.example",
    port:5900,
    username:"tester",
    options:{}
  }));
  assertLocked(() => database.updateTerminalStartup(keyId, {terminal_startup_mode:"default"}));
  assertLocked(() => database.restoreConfigSnapshot(plaintextSnapshot));
  assert.deepEqual(database.get("SELECT ssh_password,extra_args FROM connections WHERE id=?", [passwordId]), rawPassword);

  cryptoStore.unlockEncryption("boundary-password");
  database.restoreConfigSnapshot(plaintextSnapshot);
  const restoredPassword = database.get("SELECT ssh_password,extra_args FROM connections WHERE id=?", [passwordId]);
  const restoredKey = database.get("SELECT identity_file,private_key_passphrase,terminal_program_path,terminal_program_args,terminal_working_directory FROM connections WHERE id=?", [keyId]);
  const restoredRemote = database.get("SELECT password FROM remote_profiles WHERE id=?", [remoteId]);
  for (const value of [...Object.values(restoredPassword), ...Object.values(restoredKey), ...Object.values(restoredRemote)]) {
    assert.equal(encrypted(value), true, "plaintext snapshot secrets must be re-encrypted before insertion");
  }

  assert.ok(database.decryptStoredConnectionSecrets() >= 4);
  cryptoStore.disableEncryption();
  const decryptedTunnel = database.get("SELECT identity_file,extra_args FROM tunnels WHERE name='legacy'");
  assert.equal(decryptedTunnel.identity_file, keyFile);
  assert.equal(decryptedTunnel.extra_args, "-o Compression=yes");
  console.log("配置加密边界检查通过：快照、锁定写入、旧隧道与 termaenc 重加密状态一致");
} finally {
  try { database.closeDatabase(); } catch {}
  try { cryptoStore.disableEncryption(); } catch {}
  fs.rmSync(root, {recursive:true, force:true});
}
