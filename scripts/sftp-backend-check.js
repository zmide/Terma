const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-backend-check-"));
const dataDir = path.join(temporaryRoot, "data");
const sshDir = path.join(temporaryRoot, ".ssh");
const runtimeSettingsFile = path.join(dataDir, "runtime-settings.json");
process.env.TERMA_DATA_DIR = dataDir;
process.env.TERMA_SSH_DIR = sshDir;
process.env.TERMA_DISABLE_UPDATE_CHECK = "1";
fs.mkdirSync(dataDir, {recursive:true});
fs.mkdirSync(sshDir, {recursive:true});

function writeMaximumSize(megabytes) {
  fs.writeFileSync(runtimeSettingsFile, JSON.stringify({sftp_max_open_file_size_mb:megabytes}), "utf8");
}

function ageDirectory(directory, ageMs) {
  const date = new Date(Date.now() - ageMs);
  fs.utimesSync(directory, date, date);
}

async function main() {
  writeMaximumSize(1);
  const server = require("../dist/server");
  const session = require("../dist/sftp-session");
  const jobs = require("../dist/sftp-jobs");
  const db = require("../dist/db");
  try {
    const exact = server.prepareSftpWriteContent("a".repeat(1024 * 1024), "utf8");
    assert.equal(exact.content.length, 1024 * 1024);
    assert.equal(exact.maximum_bytes, 1024 * 1024);
    assert.throws(
      () => server.prepareSftpWriteContent("a".repeat(1024 * 1024 + 1), "utf8"),
      /1 MB/,
      "write validation must use the configured byte limit"
    );

    const gbExact = server.prepareSftpWriteContent("中".repeat(512 * 1024), "gb18030");
    assert.equal(gbExact.content.length, 1024 * 1024, "the limit must be checked after text encoding");
    assert.throws(() => server.prepareSftpWriteContent("中".repeat(512 * 1024 + 1), "gb18030"), /1 MB/);

    writeMaximumSize(2);
    const reread = server.prepareSftpWriteContent("a".repeat(1536 * 1024), "utf8");
    assert.equal(reread.maximum_bytes, 2 * 1024 * 1024, "runtime settings must be reread without restarting");

    const dragRoot = path.join(dataDir, "sftp-drag");
    const oldDirectory = path.join(dragRoot, "old-stage");
    const recentDirectory = path.join(dragRoot, "recent-stage");
    fs.mkdirSync(path.join(oldDirectory, "nested"), {recursive:true});
    fs.mkdirSync(recentDirectory, {recursive:true});
    fs.writeFileSync(path.join(oldDirectory, "nested", "old.bin"), Buffer.alloc(17));
    fs.writeFileSync(path.join(recentDirectory, "recent.bin"), Buffer.alloc(23));
    ageDirectory(oldDirectory, 30 * 60 * 1000);

    const dragBefore = session.sftpDragCacheInfo();
    assert.deepEqual(
      {bytes:dragBefore.bytes, files:dragBefore.files, reclaimable_bytes:dragBefore.reclaimable_bytes, reclaimable_files:dragBefore.reclaimable_files},
      {bytes:40, files:2, reclaimable_bytes:40, reclaimable_files:2},
      "completed drag staging must be recursively counted as user-reclaimable cache"
    );
    const combinedBefore = jobs.sftpCacheInfo();
    assert.equal(combinedBefore.drag.bytes, 40);
    assert.equal(combinedBefore.bytes >= combinedBefore.drag.bytes, true);

    const firstClear = jobs.clearSftpCache();
    assert.equal(fs.existsSync(oldDirectory), false, "reclaimable drag staging must be cleared");
    assert.equal(fs.existsSync(recentDirectory), false, "an explicit clear must also remove recently completed drag staging");
    assert.equal(firstClear.drag.bytes, 0);

    const overwrite = jobs.__buildCrossCopyOverwriteCommand(
      {sftp_filename_encoding:"utf8"},
      "/tmp/target",
      ["one.txt", "directory"]
    );
    assert.match(overwrite, /tar -xf - -C "\$td_tmp\/incoming"/);
    assert.match(overwrite, /td_rollback/);
    assert.match(overwrite, /td_committed=1/);
    assert.equal(/rm -rf -- '\.\/one\.txt' && tar -xf -/.test(overwrite), false, "existing targets must not be deleted before transfer completes");

    console.log("SFTP backend behavior check passed.");
  } finally {
    session.closeAllSftpSessions();
    try { db.closeDatabase(); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
});
