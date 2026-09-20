const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {EventEmitter} = require("node:events");
const {PassThrough, Readable} = require("node:stream");
const {decodeRemotePosixCommand} = require("./remote-posix-test-helper");

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

const downloadablePayloads = new Map();

function fakeRemoteChild(command) {
  const decodedCommand = decodeRemotePosixCommand(command);
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
  const fixture = [...downloadablePayloads.entries()].find(([remotePath]) => decodedCommand.includes(remotePath));
  if (decodedCommand.includes("wc -c")) {
    setImmediate(() => {
      if (child.killed) return;
      child.stdout.end(String(fixture ? fixture[1].length : 1024));
      child.stderr.end();
      child.emit("close", 0, null);
    });
  } else if (fixture && (decodedCommand.includes("cat --") || decodedCommand.includes("tail -c"))) {
    setImmediate(() => {
      if (child.killed) return;
      child.stdout.end(fixture[1]);
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
  const originalDeliver = sessionModule.exports.deliverSftpPaths;
  let localDeliverySignal = null;
  sessionModule.exports.spawnSftpSessionCommand = (_connection, command) => fakeRemoteChild(command);
  sessionModule.exports.deliverSftpPaths = (_connectionId, _paths, _targetDirectory, _conflictMode, progress={}) => new Promise((resolve, reject) => {
    localDeliverySignal = progress.signal || null;
    const abort = () => reject(Object.assign(new Error("cancelled"), {name:"AbortError"}));
    if (localDeliverySignal?.aborted) return abort();
    localDeliverySignal?.addEventListener("abort", abort, {once:true});
  });
  const jobs = require("../dist/sftp-jobs");
  const ids = [];
  const originalRename = fs.promises.rename;
  const originalCreateReadStream = fs.createReadStream;
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
    for (const id of downloadIds) if (["running", "pending"].includes(jobs.listSftpJobs().find(job => job.id === id)?.status)) jobs.cancelSftpJob(id);

    const localDelivery = jobs.startLocalDeliveryJob(99201, ["/tmp/a.bin", "/tmp/b.bin"], temporaryRoot, "rename");
    ids.push(localDelivery.id);
    await waitUntil(() => jobs.listSftpJobs().find(job => job.id === localDelivery.id)?.status === "running", "本机分别下载任务未开始");
    assert.equal(jobs.listSftpJobs().find(job => job.id === localDelivery.id)?.can_cancel, true, "本机分别下载任务必须可取消");
    jobs.cancelSftpJob(localDelivery.id);
    await waitUntil(() => jobs.listSftpJobs().find(job => job.id === localDelivery.id)?.status === "cancelled", "本机分别下载任务未进入取消状态");
    assert.equal(localDeliverySignal?.aborted, true, "取消本机分别下载必须中止底层递归 SFTP 读取");

    writeLimits(1, 3);
    jobs.refreshSftpTransferQueues();
    const autoSaveRemotePath = "/tmp/auto-save.bin";
    const autoSavePayload = Buffer.alloc(768 * 1024, 0x5a);
    downloadablePayloads.set(autoSaveRemotePath, autoSavePayload);
    const autoSaveDirectory = path.join(temporaryRoot, "auto-save");
    fs.mkdirSync(autoSaveDirectory, {recursive:true});
    fs.promises.rename = async (source, target) => {
      if (path.basename(String(target)) === "auto-save.bin") {
        const error = new Error("cross-device move");
        error.code = "EXDEV";
        throw error;
      }
      if (path.basename(String(target)) === "save-failure.bin") {
        const error = new Error("save denied");
        error.code = "EACCES";
        throw error;
      }
      return originalRename(source, target);
    };
    fs.createReadStream = (source, options) => {
      if (String(source).includes("auto-save.bin")) {
        const content = fs.readFileSync(source);
        let offset = 0;
        let pending = false;
        return new Readable({
          read() {
            if (pending || this.destroyed) return;
            pending = true;
            setTimeout(() => {
              pending = false;
              if (this.destroyed) return;
              if (offset >= content.length) {
                this.push(null);
                return;
              }
              const next = Math.min(content.length, offset + 16 * 1024);
              this.push(content.subarray(offset, next));
              offset = next;
            }, 8);
          }
        });
      }
      return originalCreateReadStream(source, options);
    };

    const saving = jobs.startDownloadJob(99201, autoSaveRemotePath, {
      deliveryMode:"desktop",
      autoSaveDirectory:autoSaveDirectory
    });
    ids.push(saving.id);
    const autoSaveTarget = path.join(autoSaveDirectory, "auto-save.bin");
    await waitUntil(() => {
      const job = jobs.listSftpJobs().find(item => item.id === saving.id);
      return job?.status === "running" && job.phase === "system-saving" && fs.existsSync(autoSaveTarget) && fs.statSync(autoSaveTarget).size > 0;
    }, "跨磁盘自动保存未进入可取消的 system-saving 阶段");
    const queuedBehindSave = jobs.startDownloadJob(99201, "/tmp/queued-behind-save.bin", {deliveryMode:"browser"});
    ids.push(queuedBehindSave.id);
    assert.equal(jobs.listSftpJobs().find(job => job.id === queuedBehindSave.id)?.status, "pending", "自动保存期间必须继续占用下载并发名额");
    assert.equal(jobs.refreshSftpTransferQueues().download.active, 1, "自动保存期间不能提前释放下载并发名额");
    const cancelling = jobs.cancelSftpJob(saving.id);
    assert.equal(cancelling.phase, "cancelling", "取消自动保存时必须等待异步复制清理完成");
    await waitUntil(() => jobs.listSftpJobs().find(job => job.id === saving.id)?.status === "cancelled", "自动保存取消后未进入终态");
    assert.equal(fs.existsSync(autoSaveTarget), false, "取消跨磁盘自动保存后不能留下部分目标文件");
    assert.equal(jobs.listSftpJobs().find(job => job.id === saving.id)?.delivery_status, "cancelled", "异步保存回调不能把已取消任务覆盖为完成");
    await waitUntil(() => jobs.listSftpJobs().find(job => job.id === queuedBehindSave.id)?.status === "running", "自动保存清理完成后未释放下载并发名额");
    jobs.cancelSftpJob(queuedBehindSave.id);

    const failedSaveRemotePath = "/tmp/save-failure.bin";
    downloadablePayloads.set(failedSaveRemotePath, Buffer.alloc(32 * 1024, 0x33));
    const failedSave = jobs.startDownloadJob(99201, failedSaveRemotePath, {
      deliveryMode:"desktop",
      autoSaveDirectory:autoSaveDirectory
    });
    ids.push(failedSave.id);
    await waitUntil(() => {
      const job = jobs.listSftpJobs().find(item => item.id === failedSave.id);
      return job?.status === "done" && job.delivery_status === "failed";
    }, "自动保存失败后任务未正确结束");
    assert.equal(jobs.refreshSftpTransferQueues().download.active, 0, "自动保存失败后必须准确释放一次下载并发名额");
    console.log("SFTP transfer concurrency check passed.");
  } finally {
    for (const id of ids) {
      try {
        const state = jobs.listSftpJobs().find(job => job.id === id)?.status;
        if (["running", "pending", "paused"].includes(state)) jobs.cancelSftpJob(id);
      } catch {}
    }
    sessionModule.exports.spawnSftpSessionCommand = originalSpawn;
    sessionModule.exports.deliverSftpPaths = originalDeliver;
    fs.promises.rename = originalRename;
    fs.createReadStream = originalCreateReadStream;
    try { db.closeDatabase(); } catch {}
    try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
