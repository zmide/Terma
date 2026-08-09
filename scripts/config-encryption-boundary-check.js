const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-encryption-boundary-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength:2048,
  privateKeyEncoding:{type:"pkcs1", format:"pem"}
});
const keyFile = path.join(process.env.TERMA_SSH_DIR, "id_boundary");
fs.writeFileSync(keyFile, privateKey, {mode:0o600});

const database = require("../dist/db");
const cryptoStore = require("../dist/crypto-store");
const securityStore = require("../dist/security");
const snapshots = require("../dist/config-snapshots");

function encrypted(value) {
  return typeof value === "string" && value.startsWith("termaenc:v3:");
}

function legacyEncrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `termaenc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

function assertVerifierCannotDecrypt(ciphertext, verifier) {
  const [, , ivText, tagText, dataText] = String(ciphertext).split(":");
  const candidate = Buffer.from(String(verifier || ""), "base64url");
  assert.equal(candidate.length, 32);
  assert.throws(() => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivText, "base64url"));
    decipher.setAAD(Buffer.from("Terma configuration secret v3", "utf8"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]);
  });
}

function deriveSubkey(rootKey, info) {
  return Buffer.from(crypto.hkdfSync("sha256", rootKey, Buffer.alloc(0), Buffer.from(info, "utf8"), 32));
}

function v2KeyMaterial(rootKey) {
  const verifyKey = deriveSubkey(rootKey, "terma-config-verifier-v2");
  return {
    encryptionKey:deriveSubkey(rootKey, "terma-config-encryption-v2"),
    verifier:crypto.createHmac("sha256", verifyKey).update("Terma configuration encryption v2").digest("base64url")
  };
}

function encryptAead(prefix, value, key, aad = null) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${prefix}${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

function assertKeyCannotDecrypt(ciphertext, key, aad) {
  const [, , ivText, tagText, dataText] = String(ciphertext).split(":");
  assert.throws(() => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]);
  });
}

function assertLocked(callback) {
  assert.throws(callback, error => error?.code === "ENCRYPTION_LOCKED" && error?.statusCode === 423);
}

function assertTransitionLocked(callback) {
  assert.throws(callback, error => error?.code === "ENCRYPTION_TRANSITION_PENDING" && error?.statusCode === 423);
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
  assert.equal(cryptoStore.encryptionState().state, "enabling");
  cryptoStore.lockEncryption();
  assertTransitionLocked(() => cryptoStore.requireEncryptionUnlocked());
  assertTransitionLocked(() => database.getConnection(passwordId));
  cryptoStore.unlockEncryption("boundary-password");
  assert.ok(database.encryptStoredConnectionSecrets() >= 4);
  cryptoStore.completeEncryptionEnable();
  assert.equal(cryptoStore.encryptionState().state, "enabled");
  const rawPassword = database.get("SELECT ssh_password,extra_args FROM connections WHERE id=?", [passwordId]);
  const rawKey = database.get("SELECT identity_file,private_key_passphrase,terminal_program_path,terminal_program_args,terminal_working_directory FROM connections WHERE id=?", [keyId]);
  const rawRemote = database.get("SELECT password FROM remote_profiles WHERE id=?", [remoteId]);
  const rawTunnel = database.get("SELECT identity_file,extra_args FROM tunnels WHERE name='legacy'");
  for (const value of [...Object.values(rawPassword), ...Object.values(rawKey), ...Object.values(rawRemote), ...Object.values(rawTunnel)]) {
    assert.equal(encrypted(value), true, "every stored secret must use termaenc:v3");
  }
  const security = securityStore.readSecuritySettings();
  assert.equal(security.encryption_version, 3);
  assert.notEqual(security.encryption_check, crypto.scryptSync("boundary-password", security.encryption_salt, 32).toString("hex"));
  assertVerifierCannotDecrypt(rawPassword.ssh_password, security.encryption_check);
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

  cryptoStore.beginDisableEncryption();
  assert.equal(cryptoStore.encryptionState().state, "disabling");
  cryptoStore.lockEncryption();
  assertTransitionLocked(() => cryptoStore.requireEncryptionUnlocked());
  cryptoStore.unlockEncryption("boundary-password");
  assert.ok(database.decryptStoredConnectionSecrets() >= 4);
  cryptoStore.disableEncryption();
  const decryptedTunnel = database.get("SELECT identity_file,extra_args FROM tunnels WHERE name='legacy'");
  assert.equal(decryptedTunnel.identity_file, keyFile);
  assert.equal(decryptedTunnel.extra_args, "-o Compression=yes");

  const legacyPassword = "legacy-boundary-password";
  const legacySalt = crypto.randomBytes(16).toString("hex");
  const legacyKey = crypto.scryptSync(legacyPassword, legacySalt, 32);
  database.run("UPDATE connections SET ssh_password=? WHERE id=?", [legacyEncrypt("legacy-secret", legacyKey), passwordId]);
  securityStore.writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabled",
    encryption_version:1,
    encryption_salt:legacySalt,
    encryption_check:legacyKey.toString("hex"),
    encryption_legacy_version:0,
    encryption_legacy_salt:"",
    encryption_legacy_check:""
  });
  cryptoStore.lockEncryption();
  assert.equal(cryptoStore.encryptionState().upgrade_required, true);
  assert.throws(() => cryptoStore.prepareEncryptionUpgrade(legacyPassword), /解锁/);
  cryptoStore.unlockEncryption(legacyPassword);
  assert.equal(cryptoStore.prepareEncryptionUpgrade(legacyPassword), true);
  const rotatingV1 = securityStore.readSecuritySettings();
  assert.equal(rotatingV1.encryption_version, 3);
  assert.equal(rotatingV1.encryption_state, "enabling");
  assert.notEqual(rotatingV1.encryption_salt, legacySalt);
  assert.equal(rotatingV1.encryption_legacy_version, 1);
  assert.equal(rotatingV1.encryption_legacy_salt, legacySalt);
  cryptoStore.lockEncryption();
  cryptoStore.unlockEncryption(legacyPassword);
  assert.equal(cryptoStore.prepareEncryptionUpgrade(legacyPassword), true);
  assert.ok(database.encryptStoredConnectionSecrets() >= 1);
  cryptoStore.completeEncryptionEnable();
  const upgraded = database.get("SELECT ssh_password FROM connections WHERE id=?", [passwordId]).ssh_password;
  assert.match(upgraded, /^termaenc:v3:/);
  assert.equal(cryptoStore.decryptText(upgraded), "legacy-secret");
  assertKeyCannotDecrypt(upgraded, deriveSubkey(legacyKey, "terma-config-encryption-v3"), "Terma configuration secret v3");
  cryptoStore.beginDisableEncryption();
  database.decryptStoredConnectionSecrets();
  cryptoStore.disableEncryption();

  const v2Password = "existing-v2-boundary-password";
  const v2Salt = crypto.randomBytes(16).toString("hex");
  const v2RootKey = crypto.scryptSync(v2Password, v2Salt, 32);
  const v2Material = v2KeyMaterial(v2RootKey);
  database.run("UPDATE connections SET ssh_password=? WHERE id=?", [encryptAead("termaenc:v2:", "v2-secret", v2Material.encryptionKey, "Terma configuration secret v2"), passwordId]);
  securityStore.writeSecuritySettings({
    encryption_enabled:true,
    encryption_state:"enabled",
    encryption_version:2,
    encryption_salt:v2Salt,
    encryption_check:v2Material.verifier,
    encryption_legacy_version:0,
    encryption_legacy_salt:"",
    encryption_legacy_check:""
  });
  cryptoStore.lockEncryption();
  cryptoStore.unlockEncryption(v2Password);
  assert.equal(cryptoStore.prepareEncryptionUpgrade(v2Password), true);
  const rotatingV2 = securityStore.readSecuritySettings();
  assert.notEqual(rotatingV2.encryption_salt, v2Salt);
  assert.equal(rotatingV2.encryption_legacy_version, 2);
  assert.ok(database.encryptStoredConnectionSecrets() >= 1);
  cryptoStore.completeEncryptionEnable();
  const upgradedV2 = database.get("SELECT ssh_password FROM connections WHERE id=?", [passwordId]).ssh_password;
  assert.match(upgradedV2, /^termaenc:v3:/);
  assert.equal(cryptoStore.decryptText(upgradedV2), "v2-secret");
  assertKeyCannotDecrypt(upgradedV2, deriveSubkey(v2RootKey, "terma-config-encryption-v3"), "Terma configuration secret v3");
  cryptoStore.beginDisableEncryption();
  database.decryptStoredConnectionSecrets();
  cryptoStore.disableEncryption();
  console.log("配置加密边界检查通过：v3 verifier 与密钥分离，v1/v2 必须输入主密码并使用新 salt 完成密钥轮换");
} finally {
  try { database.closeDatabase(); } catch {}
  try { cryptoStore.disableEncryption(); } catch {}
  fs.rmSync(root, {recursive:true, force:true});
}
