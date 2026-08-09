const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { DatabaseSync } = require("node:sqlite");
const {
  createDatabaseBundleHeader,
  DatabaseTransferStore,
  DATABASE_BUNDLE_MAGIC,
  LEGACY_DATABASE_BUNDLE_MAGIC
} = require("../dist/database-transfer");

function createFixture(root) {
  const file = path.join(root, "fixture.db");
  const database = new DatabaseSync(file);
  database.exec("CREATE TABLE connections(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO connections(name) VALUES('fixture')");
  database.close();
  return fs.readFileSync(file);
}

async function rejectStage(store, body, pattern) {
  await assert.rejects(() => store.stage(Readable.from(body), "broken.tdbackup"), pattern);
}

function createBundle(magic, metadata, database) {
  const body = Buffer.from(JSON.stringify(metadata), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([magic, size, body, database]);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-db-transfer-"));
  try {
    const fixture = createFixture(root);
    const store = new DatabaseTransferStore(root, 30 * 60 * 1000, 200 * 1024 * 1024);

    const raw = await store.stage(Readable.from(fixture), "fixture.db");
    assert.equal(raw.format, "sqlite");
    assert.equal(fs.readFileSync(raw.database_path).subarray(0, 16).toString("ascii"), "SQLite format 3\u0000");
    const taken = store.take(raw.token);
    assert.equal(taken.token, raw.token);
    assert.throws(() => store.get(raw.token), /已过期或已使用/);
    store.discard(taken);

    const security = { encryption_enabled: true, encryption_state:"enabled", encryption_version:1, encryption_salt: "salt", encryption_check: "check" };
    const header = createDatabaseBundleHeader({
      type: "terma-backup-v3",
      created_at: new Date().toISOString(),
      security
    });
    assert.equal(header.subarray(0, DATABASE_BUNDLE_MAGIC.length).equals(DATABASE_BUNDLE_MAGIC), true);
    const bundle = await store.stage(Readable.from(Buffer.concat([header, fixture])), "fixture.termabackup");
    assert.equal(bundle.format, "bundle-v3");
    assert.deepEqual(bundle.security, security);
    assert.deepEqual(fs.readFileSync(bundle.database_path), fixture);
    store.discard(bundle);

    const legacyV2 = createBundle(LEGACY_DATABASE_BUNDLE_MAGIC, {
      type: "tunneldesk-backup-v2",
      created_at: new Date().toISOString(),
      security
    }, fixture);
    const legacyV2Stage = await store.stage(Readable.from(legacyV2), "fixture.tdbackup");
    assert.equal(legacyV2Stage.format, "bundle-v2");
    assert.deepEqual(legacyV2Stage.security, security);
    assert.deepEqual(fs.readFileSync(legacyV2Stage.database_path), fixture);
    store.discard(legacyV2Stage);

    const legacy = Buffer.from(JSON.stringify({
      type: "tunneldesk-backup-v1",
      database_base64: fixture.toString("base64"),
      security
    }));
    const legacyStage = await store.stage(Readable.from(legacy), "legacy.tdbackup.json");
    assert.equal(legacyStage.format, "bundle-v1");
    assert.deepEqual(legacyStage.security, security);
    store.discard(legacyStage);

    const restoreRequest = Buffer.from(JSON.stringify({
      type: "tunneldesk-restore-request-v1",
      payload_base64: legacy.toString("base64"),
      identity_bindings: [{connection_id:1, identity_path:"~/.ssh/id_ed25519"}],
      credential_bindings: [{connection_id:1, credential:"legacy"}]
    }));
    const requestStage = await store.stage(Readable.from(restoreRequest), "legacy-request.json");
    assert.equal(requestStage.format, "request-v1");
    assert.deepEqual(requestStage.security, security);
    assert.equal(requestStage.legacy_identity_bindings.length, 1);
    assert.equal(requestStage.legacy_credential_bindings.length, 1);
    assert.deepEqual(fs.readFileSync(requestStage.database_path), fixture);
    store.discard(requestStage);

    await rejectStage(store, DATABASE_BUNDLE_MAGIC, /文件为空|头部不完整/);
    const impossibleLength = Buffer.concat([DATABASE_BUNDLE_MAGIC, Buffer.from([0x7f, 0xff, 0xff, 0xff])]);
    await rejectStage(store, impossibleLength, /元数据长度无效/);
    const invalidMetadataLength = Buffer.alloc(4);
    invalidMetadataLength.writeUInt32BE(3);
    await rejectStage(store, Buffer.concat([DATABASE_BUNDLE_MAGIC, invalidMetadataLength, Buffer.from("xxx"), fixture]), /元数据无效/);
    await rejectStage(store, Buffer.from("not a database"), /SQLite|数据库|迁移包/);

    const expiringStore = new DatabaseTransferStore(path.join(root, "expiry"), 1, 200 * 1024 * 1024);
    const expiring = await expiringStore.stage(Readable.from(fixture), "expiry.db");
    expiringStore.cleanupExpired(Date.now() + 10);
    assert.throws(() => expiringStore.get(expiring.token), /已过期或已使用/);

    console.log("数据库传输检查通过：流式暂存、二进制迁移包、旧版兼容、令牌单次使用、过期清理和损坏输入拒绝");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
