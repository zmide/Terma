const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {EventEmitter} = require("node:events");
const {PassThrough} = require("node:stream");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-transfer-concurrency-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TERMA_DATA_DIR, {recursive:true});
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});

function writeLimits(download, upload) {
  fs.writeFileSync(path.join(process.env.TERMA_DATA_DIR, "runtime-settings.json"), JSON.stringify({
    schema_version:11,
    sftp_download_concurrency:download,
    sftp_upload_concurrency:upload
  }), "utf8");
}

function fakeRemoteChild(command) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (signal="SIGTERM") => {
    if (child.killed) return true;
    child.killed = true;
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, signal);
    return true;
  };
  if (String(command).includes("wc -c")) {
    setImmediate(() => {
      if (child.killed) return;
      child.stdout.end("1024");
      child.stderr.end();
      child.emit("close", 0, null);
    });
  }
  return child;
}

function counts(jobs, ids) {
  const states = jobs.listSftpJobs().filter(job => ids.includes(job.id));
  return {
    running:states.filter(job => job.status === "running").length,
    pending:states.filter(job => job.status === "pending").length
  };
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

async function main() {
  writeLimits(2, 2);
  const db = require("../dist/db");
  const dbModule = require.cache[require.resolve("../dist/db")];
  const originalGetConnection = dbModule.exports.getConnection;
  dbModule.exports.getConnection = id => Number(id) === 99201 ? {
    id:99201, name:"concurrency-check", ssh_host:"127.0.0.1", ssh_port:22,
    ssh_user:"smoke", auth_type:"password", ssh_password:"smoke", sftp_filename_encoding:"utf8"
  } : originalGetConnection(id);
  const sessions = require("../dist/sftp-session");
  const sessionModule = require.cache[require.resolve("../dist/sftp-session")];
  const originalSpawn = sessionModule.exports.spawnSftpSessionCommand;
  sessionModule.exports.spawnSftpSessionCommand = (_connection, command) => fakeRemoteChild(command);
  const jobs = require("../dist/sftp-jobs");
  const ids = [];
  try {
    const uploadIds = Array.from({length:4}, (_, index) => {
      const localPath = path.join(temporaryRoot, `upload-${index}.bin`);
      fs.writeFileSync(localPath, Buffer.alloc(1024, index));
      const job = jobs.startUploadJob(99201, localPath, `/tmp/upload-${index}.bin`, 1024);
      ids.push(job.id);
      return job.id;
    });
    assert.deepEqual(counts(jobs, uploadIds), {running:2, pending:2});
    jobs.cancelSftpJob(uploadIds[0]);
    await waitUntil(() => counts(jobs, uploadIds).running === 2 && counts(jobs, uploadIds).pending === 1, "取消后未放行下一个上传任务");
    writeLimits(2, 3);
    jobs.refreshSftpTransferQueues();
    await waitUntil(() => counts(jobs, uploadIds).running === 3 && counts(jobs, uploadIds).pending === 0, "提高上传并发后未立即放行排队任务");
    for (const id of uploadIds) if (["running", "pending"].includes(jobs.listSftpJobs().find(job => job.id === id)?.status)) jobs.cancelSftpJob(id);

    writeLimits(2, 3);
    jobs.refreshSftpTransferQueues();
    const downloadIds = Array.from({length:4}, (_, index) => {
      const job = jobs.startDownloadJob(99201, `/tmp/download-${index}.bin`, {deliveryMode:"browser"});
      ids.push(job.id);
      return job.id;
    });
    assert.deepEqual(counts(jobs, downloadIds), {running:2, pending:2});
    writeLimits(3, 3);
    jobs.refreshSftpTransferQueues();
    await waitUntil(() => counts(jobs, downloadIds).running === 3 && counts(jobs, downloadIds).pending === 1, "提高下载并发后未立即放行排队任务");
    console.log("SFTP transfer concurrency check passed.");
  } finally {
    for (const id of ids) {
      try {
        const state = jobs.listSftpJobs().find(job => job.id === id)?.status;
        if (["running", "pending", "paused"].includes(state)) jobs.cancelSftpJob(id);
      } catch {}
    }
    sessionModule.exports.spawnSftpSessionCommand = originalSpawn;
    try { db.closeDatabase(); } catch {}
    try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
