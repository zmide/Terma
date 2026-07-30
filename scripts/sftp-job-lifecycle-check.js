const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-sftp-job-lifecycle-check-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TUNNELDESK_DATA_DIR, { recursive:true });
fs.mkdirSync(process.env.TUNNELDESK_SSH_DIR, { recursive:true });

const children = [];

function fakeRemoteChild(command) {
  const child = new EventEmitter();
  child.command = String(command || "");
  child.stdin = new PassThrough({ highWaterMark:1024 });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (signal = "SIGTERM") => {
    if (child.killed) return true;
    child.killed = true;
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, signal);
    setImmediate(() => child.emit("error", new Error(`late ${signal}`)));
    return true;
  };
  children.push(child);
  if (child.command.includes("wc -c")) {
    setTimeout(() => {
      if (child.killed) return;
      child.stdout.write(child.command.includes(".tunneldesk-upload-") ? "0" : "1048576");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    }, 40);
  }
  return child;
}

function waitForJob(jobs, id, expectedStatus) {
  const deadline = Date.now() + 3000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const job = jobs.listSftpJobs().find(item => item.id === id);
      if (job?.status === expectedStatus) return resolve(job);
      if (Date.now() >= deadline) return reject(new Error(`job ${id} did not reach ${expectedStatus}; current=${job?.status || "missing"}; commands=${children.slice(-4).map(item => item.command).join(" | ")}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 80));
}

async function main() {
  const db = require("../dist/db");
  const dbModule = require.cache[require.resolve("../dist/db")];
  const connection = {
    id:99104,
    name:"job-lifecycle-check",
    ssh_host:"127.0.0.1",
    ssh_port:22,
    ssh_user:"smoke",
    auth_type:"password",
    ssh_password:"smoke",
    sftp_filename_encoding:"utf8"
  };
  const targetConnection = {...connection, id:connection.id + 1, name:"job-lifecycle-target"};
  const originalGetConnection = dbModule.exports.getConnection;
  dbModule.exports.getConnection = id => Number(id) === connection.id
    ? connection
    : Number(id) === targetConnection.id
      ? targetConnection
      : originalGetConnection(id);

  const sessions = require("../dist/sftp-session");
  const sessionModule = require.cache[require.resolve("../dist/sftp-session")];
  const originalSpawn = sessionModule.exports.spawnSftpSessionCommand;
  sessionModule.exports.spawnSftpSessionCommand = (_connection, command) => fakeRemoteChild(command);
  const jobs = require("../dist/sftp-jobs");
  const notifications = require("../dist/notifications");
  const jobIds = [];

  const uploadLocal = path.join(temporaryRoot, "upload.bin");
  const cancelledLocal = path.join(temporaryRoot, "cancelled.bin");
  const atomicLocal = path.join(temporaryRoot, "atomic.bin");
  fs.writeFileSync(uploadLocal, Buffer.alloc(1024 * 1024, 0x41));
  fs.writeFileSync(cancelledLocal, Buffer.alloc(1024 * 1024, 0x42));
  fs.writeFileSync(atomicLocal, Buffer.alloc(32 * 1024, 0x45));

  try {
    const upload = jobs.startUploadJob(connection.id, uploadLocal, "/tmp/upload.bin", fs.statSync(uploadLocal).size);
    jobIds.push(upload.id);
    const initialUploadState = jobs.listSftpJobs().find(item => item.id === upload.id);
    assert.match(initialUploadState.remote_temp_path, /^\/tmp\/\.tunneldesk-upload-[0-9a-f-]+\.part$/i);
    assert.ok(children.at(-1).command.includes(initialUploadState.remote_temp_path), "upload bytes must target the remote temporary path");
    assert.ok(!children.at(-1).command.includes("cat > '/tmp/upload.bin'"), "upload must not truncate the final path before commit");
    assert.throws(() => jobs.deleteSftpJob(upload.id), /请先暂停或取消运行中的任务/);

    jobs.pauseSftpJob(upload.id);
    await settle();
    let paused = jobs.listSftpJobs().find(item => item.id === upload.id);
    assert.equal(paused.status, "paused");
    assert.equal(paused.error, "");
    assert.equal(paused.finished_at, null);

    jobs.resumeSftpJob(upload.id);
    await waitForJob(jobs, upload.id, "running");
    jobs.pauseSftpJob(upload.id);
    await settle();
    paused = jobs.listSftpJobs().find(item => item.id === upload.id);
    assert.equal(paused.status, "paused", "late resume-upload events must not replace the paused state");
    assert.equal(paused.error, "");
    jobs.deleteSftpJob(upload.id);
    assert.equal(jobs.listSftpJobs().some(item => item.id === upload.id), false);
    assert.equal(fs.existsSync(uploadLocal), false, "deleting a paused upload must remove its staged local file");

    const cancelled = jobs.startUploadJob(connection.id, cancelledLocal, "/tmp/cancelled.bin", fs.statSync(cancelledLocal).size);
    jobIds.push(cancelled.id);
    jobs.cancelSftpJob(cancelled.id);
    await settle();
    const cancelledState = jobs.listSftpJobs().find(item => item.id === cancelled.id);
    assert.equal(cancelledState.status, "cancelled", "late upload events must not replace the cancelled state");
    assert.equal(cancelledState.error, "用户已取消");
    assert.ok(children.some(child => child.command.includes("rm -f") && child.command.includes(cancelledState.remote_temp_path)), "cancel must clean the remote temporary upload");
    jobs.deleteSftpJob(cancelled.id);

    const atomic = jobs.startUploadJob(connection.id, atomicLocal, "/tmp/atomic.bin", fs.statSync(atomicLocal).size);
    jobIds.push(atomic.id);
    const writeChild = children.at(-1);
    writeChild.stdin.resume();
    await new Promise(resolve => writeChild.stdin.once("finish", resolve));
    writeChild.stdout.end();
    writeChild.stderr.end();
    writeChild.emit("close", 0, null);
    await new Promise(resolve => setImmediate(resolve));
    const committing = jobs.listSftpJobs().find(item => item.id === atomic.id);
    assert.equal(committing.phase, "committing");
    const commitChild = children.at(-1);
    assert.ok(commitChild.command.includes("mv -f --"), "completed overwrite upload must atomically replace the final path");
    assert.ok(commitChild.command.includes(committing.remote_temp_path));
    assert.ok(commitChild.command.includes("/tmp/atomic.bin"));
    commitChild.stdout.end();
    commitChild.stderr.end();
    commitChild.emit("close", 0, null);
    await waitForJob(jobs, atomic.id, "done");
    jobs.deleteSftpJob(atomic.id);

    const receivedPayload = Buffer.alloc(384 * 1024, 0x43);
    const receiving = jobs.startUploadReceiveJob(connection.id, "/tmp/received.bin", "received.bin", receivedPayload.length);
    jobIds.push(receiving.id);
    const receiveRequest = new PassThrough();
    receiveRequest.headers = {"content-length":String(receivedPayload.length)};
    const receiveResultPromise = jobs.receiveUploadJobContent(receiving.id, receiveRequest);
    receiveRequest.end(receivedPayload);
    const receivedResult = await receiveResultPromise;
    assert.equal(receivedResult.id, receiving.id, "receiving and remote upload must retain one job id");
    assert.equal(receivedResult.phase, "uploading");
    const receivedState = jobs.listSftpJobs().find(item => item.id === receiving.id);
    assert.equal(receivedState.received_bytes, receivedPayload.length);
    assert.equal(receivedState.progress, 50, "two-stage uploads must continue at 50% instead of resetting to zero");
    assert.equal(receivedState.progress_known, true);
    assert.equal(receivedState.staged_complete, true);
    assert.equal(receivedState.can_pause, true);
    assert.equal(fs.statSync(receivedState.local_path).size, receivedPayload.length);
    jobs.pauseSftpJob(receiving.id);
    jobs.deleteSftpJob(receiving.id);

    const partialPayload = Buffer.alloc(128 * 1024, 0x44);
    const cancelledReceive = jobs.startUploadReceiveJob(connection.id, "/tmp/cancel-receive.bin", "cancel-receive.bin", receivedPayload.length);
    jobIds.push(cancelledReceive.id);
    const cancelledRequest = new PassThrough();
    cancelledRequest.headers = {"content-length":String(receivedPayload.length)};
    const cancelledReceivePromise = jobs.receiveUploadJobContent(cancelledReceive.id, cancelledRequest);
    const cancelledReceiveAssertion = assert.rejects(cancelledReceivePromise, error => error?.code === "SFTP_UPLOAD_CANCELLED");
    cancelledRequest.write(partialPayload);
    await new Promise(resolve => setTimeout(resolve, 20));
    const cancelledReceivePath = jobs.listSftpJobs().find(item => item.id === cancelledReceive.id).local_path;
    jobs.cancelSftpJob(cancelledReceive.id);
    await cancelledReceiveAssertion;
    assert.equal(cancelledRequest.destroyed, true, "cancelling a receiving upload must terminate its request stream");
    assert.equal(fs.existsSync(cancelledReceivePath), false, "cancelling a receiving upload must delete its staged file");
    assert.equal(jobs.listSftpJobs().find(item => item.id === cancelledReceive.id).status, "cancelled");
    jobs.deleteSftpJob(cancelledReceive.id);

    const incomplete = jobs.startUploadReceiveJob(connection.id, "/tmp/incomplete.bin", "incomplete.bin", receivedPayload.length);
    jobIds.push(incomplete.id);
    const incompleteRequest = new PassThrough();
    incompleteRequest.headers = {"content-length":String(receivedPayload.length)};
    const incompletePromise = jobs.receiveUploadJobContent(incomplete.id, incompleteRequest);
    incompleteRequest.end(partialPayload);
    await assert.rejects(incompletePromise, /文件接收不完整/);
    const incompleteState = jobs.listSftpJobs().find(item => item.id === incomplete.id);
    assert.equal(incompleteState.status, "failed");
    assert.equal(incompleteState.can_resume, false, "an incomplete receiving-stage upload must not be resumable");
    assert.equal(fs.existsSync(incompleteState.local_path), false);
    jobs.deleteSftpJob(incomplete.id);

    const pending = jobs.startDownloadJob(connection.id, "/tmp/pending.bin", { deliveryMode:"browser" });
    jobIds.push(pending.id);
    assert.throws(() => jobs.deleteSftpJob(pending.id), /请先暂停或取消运行中的任务/);
    jobs.pauseSftpJob(pending.id);
    await settle();
    const pendingPaused = jobs.listSftpJobs().find(item => item.id === pending.id);
    assert.equal(pendingPaused.status, "paused", "a pending download must not start after it has been paused");
    jobs.deleteSftpJob(pending.id);

    const download = jobs.startDownloadJob(connection.id, "/tmp/download.bin", { deliveryMode:"browser" });
    jobIds.push(download.id);
    await waitForJob(jobs, download.id, "running");
    jobs.pauseSftpJob(download.id);
    await settle();
    const pausedDownload = jobs.listSftpJobs().find(item => item.id === download.id);
    assert.equal(pausedDownload.status, "paused", "late download events must not replace the paused state");
    assert.equal(pausedDownload.error, "");
    const downloadArtifact = pausedDownload.temp_path;
    jobs.deleteSftpJob(download.id);
    assert.equal(jobs.listSftpJobs().some(item => item.id === download.id), false);
    assert.equal(fs.existsSync(downloadArtifact), false, "deleting a paused download must remove its cached file");

    const copy = jobs.copyJob(connection.id, ["/tmp/copy-a", "/tmp/copy-b"], "/tmp/target");
    jobIds.push(copy.id);
    const copyChild = children.at(-1);
    const marker = copyChild.command.match(/(__TUNNELDESK_JOB_[a-f0-9]+__:)/i)?.[1];
    assert.ok(marker, "copy jobs must include a private progress marker");
    copyChild.stdout.write(`${marker}1\n`);
    await new Promise(resolve => setImmediate(resolve));
    const partialCopy = jobs.listSftpJobs().find(item => item.id === copy.id);
    assert.equal(partialCopy.progress_unit, "items");
    assert.equal(partialCopy.transferred, 1);
    assert.equal(partialCopy.size, 2);
    assert.equal(partialCopy.progress, 50);
    copyChild.stdout.end(`${marker}2\n`);
    copyChild.stderr.end();
    copyChild.emit("close", 0, null);
    await waitForJob(jobs, copy.id, "done");
    jobs.deleteSftpJob(copy.id);

    const crossCopy = jobs.crossCopyJob(
      connection.id,
      targetConnection.id,
      ["/tmp/cross-copy.bin"],
      "/tmp/target",
      "error",
      [{path:"/tmp/cross-copy.bin", type:"file", size:1024, metadataKnown:true}]
    );
    jobIds.push(crossCopy.id);
    const crossSource = children.at(-2);
    const crossTarget = children.at(-1);
    crossTarget.stdin.resume();
    crossSource.stdout.write(Buffer.alloc(512, 0x46));
    await new Promise(resolve => setImmediate(resolve));
    const partialCrossCopy = jobs.listSftpJobs().find(item => item.id === crossCopy.id);
    assert.equal(partialCrossCopy.size, 1024);
    assert.equal(partialCrossCopy.progress_known, true);
    assert.equal(partialCrossCopy.progress_estimated, true);
    assert.equal(partialCrossCopy.progress, 50);
    crossSource.stdout.end(Buffer.alloc(512, 0x47));
    crossSource.stderr.end();
    crossTarget.stdout.end();
    crossTarget.stderr.end();
    crossSource.emit("close", 0, null);
    crossTarget.emit("close", 0, null);
    const completedCrossCopy = await waitForJob(jobs, crossCopy.id, "done");
    assert.equal(completedCrossCopy.progress, 100);
    jobs.deleteSftpJob(crossCopy.id);

    const sameHostCopy = jobs.crossCopyJob(
      connection.id,
      connection.id,
      ["/tmp/same-host.bin"],
      "/tmp/other-target",
      "rename",
      [{path:"/tmp/same-host.bin", type:"file", size:256, metadataKnown:true}]
    );
    jobIds.push(sameHostCopy.id);
    const sameHostSource = children.at(-2);
    const sameHostTarget = children.at(-1);
    assert.match(sameHostTarget.command, /while \[ -e "\$td_target" \]/, "same-host copies must preserve automatic rename behavior");
    sameHostTarget.stdin.resume();
    sameHostSource.stdout.end(Buffer.alloc(256, 0x48));
    sameHostSource.stderr.end();
    sameHostTarget.stdout.end();
    sameHostTarget.stderr.end();
    sameHostSource.emit("close", 0, null);
    sameHostTarget.emit("close", 0, null);
    const completedSameHostCopy = await waitForJob(jobs, sameHostCopy.id, "done");
    assert.equal(completedSameHostCopy.connection_id, connection.id);
    assert.equal(completedSameHostCopy.progress, 100);
    jobs.deleteSftpJob(sameHostCopy.id);

    assert.throws(() => jobs.crossCopyJob(
      connection.id,
      connection.id,
      ["/tmp/source-dir"],
      "/tmp/source-dir/nested",
      "error",
      [{path:"/tmp/source-dir", type:"directory", size:0, metadataKnown:false}]
    ), /自身或其子目录/);

    const failures = notifications.listNotifications(0).filter(item => /SFTP (上传|下载)失败/.test(String(item.title || "")));
    assert.deepEqual(failures, [], "pause and cancel must not emit transfer-failure notifications");
    console.log("SFTP job lifecycle check passed.");
  } finally {
    sessionModule.exports.spawnSftpSessionCommand = originalSpawn;
    for (const id of jobIds) {
      try {
        const current = jobs.listSftpJobs().find(item => item.id === id);
        if (current && ["running", "pending", "paused"].includes(current.status)) jobs.cancelSftpJob(id);
      } catch {}
      try { jobs.deleteSftpJob(id); } catch {}
    }
    for (const child of children) {
      try { child.kill("SIGTERM"); } catch {}
    }
    try { db.closeDatabase(); } catch {}
    try { fs.rmSync(temporaryRoot, { recursive:true, force:true }); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
