const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-restore-encryption-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
fs.mkdirSync(process.env.TERMA_SSH_DIR, { recursive:true });

const security = require("../dist/security");
const cryptoStore = require("../dist/crypto-store");
const { createStorageRestoreHelpers } = require("../dist/storage-restore");

const password = "terma-test-master-password";
const keyPath = path.join(process.env.TERMA_SSH_DIR, "id_test");
fs.writeFileSync(keyPath, "fixture-private-key", { encoding:"utf8", mode:0o600 });

function encrypted(value) {
  return typeof value === "string" && value.startsWith("tdenc:v1:");
}

try {
  security.resetWebAccessSecurity();
  cryptoStore.enableEncryption(password);
  const fixture = path.join(root, "plaintext.db");
  const database = new DatabaseSync(fixture);
  database.exec(`
    CREATE TABLE connections(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      ssh_host TEXT NOT NULL,
      ssh_port INTEGER NOT NULL,
      ssh_user TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      identity_file TEXT,
      ssh_password TEXT,
      private_key_passphrase TEXT,
      extra_args TEXT,
      terminal_program_path TEXT,
      terminal_program_args TEXT,
      terminal_working_directory TEXT,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
  `);
  database.prepare(`
    INSERT INTO connections(
      id,name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,ssh_password,
      private_key_passphrase,extra_args,terminal_program_path,terminal_program_args,
      terminal_working_directory
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1, "key fixture", "key.example", 22, "tester", "key", "/old/id_test", null,
    "key-passphrase", "-o Compression=yes", "/bin/bash", "-lc", "/tmp"
  );
  database.prepare(`
    INSERT INTO connections(
      id,name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,ssh_password,
      private_key_passphrase,extra_args,terminal_program_path,terminal_program_args,
      terminal_working_directory
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    2, "password fixture", "password.example", 22, "tester", "password", null, "plain-password",
    null, "", "", "", ""
  );
  database.close();

  const helpers = createStorageRestoreHelpers({
    BASE_DIR:root,
    DATA_DIR:process.env.TERMA_DATA_DIR,
    PROJECT_SSH_DIR:process.env.TERMA_SSH_DIR,
    RUNTIME_ROOT:root,
    STORAGE_SETTINGS_FILE:path.join(root, "storage.json"),
    encryptionReady:cryptoStore.encryptionReady,
    encryptText:cryptoStore.encryptText,
    listIdentityFiles:() => [{path:keyPath}],
    readSecuritySettings:security.readSecuritySettings,
    validateSortOrder:value => Math.max(1, Number(value) || 1),
    getDesktopIntegration:() => null,
    getArgs:() => ({ requested_hosts:["127.0.0.1"], requested_port:8088 }),
    requestShutdown:async () => {}
  });

  cryptoStore.lockEncryption();
  assert.throws(
    () => helpers.normalizeRestoredCredentials(fixture, [{connection_id:1, identity_path:keyPath}], [], false, true),
    /请先解锁主密码/
  );
  cryptoStore.unlockEncryption(password);
  const result = helpers.normalizeRestoredCredentials(
    fixture,
    [{connection_id:1, identity_path:keyPath}],
    [],
    false,
    true
  );
  assert.ok(result.encrypted_fields >= 7);

  const restored = new DatabaseSync(fixture);
  const keyRow = restored.prepare("SELECT * FROM connections WHERE id=1").get();
  const passwordRow = restored.prepare("SELECT * FROM connections WHERE id=2").get();
  for (const field of ["identity_file", "private_key_passphrase", "extra_args", "terminal_program_path", "terminal_program_args", "terminal_working_directory"]) {
    assert.equal(encrypted(keyRow[field]), true, `恢复后的 ${field} 必须加密`);
  }
  assert.equal(encrypted(passwordRow.ssh_password), true, "恢复后的 SSH 密码必须加密");
  restored.close();
  console.log("配置加密恢复回归通过：未解锁拒绝恢复，解锁后原始 SQLite 敏感字段全部使用 tdenc:v1");
} finally {
  try { cryptoStore.lockEncryption(); } catch {}
  fs.rmSync(root, { recursive:true, force:true });
}
