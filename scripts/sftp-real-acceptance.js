const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { DatabaseSync } = require("node:sqlite");

const CONFIRMATION_FLAG = "--confirm-real-sftp";
const TEST_GROUP = "测试";
const TEST_PREFIX = ".tunneldesk-test-";
const JOB_TIMEOUT_MS = 120000;

if (!process.argv.includes(CONFIRMATION_FLAG)) {
  console.error(`真实 SFTP 验收会在“${TEST_GROUP}”分组的服务器上创建并删除临时文件。`);
  console.error(`确认后请运行：node scripts/sftp-real-acceptance.js ${CONFIRMATION_FLAG}`);
  process.exit(2);
}

function databaseCandidates() {
  if (process.env.TUNNELDESK_DATA_DIR) return [path.resolve(process.env.TUNNELDESK_DATA_DIR)];
  const platform = process.platform === "win32"
    ? [path.join(process.env.APPDATA || "", "TunnelDesk", "runtime", "data")]
    : process.platform === "darwin"
      ? [path.join(os.homedir(), "Library", "Application Support", "TunnelDesk", "runtime", "data")]
      : [path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "TunnelDesk", "runtime", "data")];
  return [...new Set([...platform, path.resolve(__dirname, "..", "data")].filter(Boolean))];
}

function inspectDatabase(directory) {
  const databaseFile = path.join(directory, "tunnels.db");
  if (!fs.existsSync(databaseFile)) return null;
  let database;
  try {
    database = new DatabaseSync(databaseFile, { readOnly:true });
    const connections = database.prepare(
      "SELECT id,name,group_name,auth_type FROM connections WHERE group_name=? ORDER BY sort_order,name COLLATE NOCASE,created_at,id"
    ).all(TEST_GROUP);
    const realNames = connections.filter(item => ["测试", "测试1", "测试2"].includes(String(item.name))).length;
    const fixtures = connections.filter(item => String(item.name).startsWith("fixture-")).length;
    return { directory, connections, score:realNames * 100 + connections.length - fixtures * 1000 };
  } catch {
    return null;
  } finally {
    try { database?.close(); } catch {}
  }
}

function selectDataDirectory() {
  const choices = databaseCandidates().map(inspectDatabase).filter(Boolean).filter(item => item.connections.length);
  choices.sort((left, right) => right.score - left.score);
  if (!choices.length || choices[0].score < 0) throw new Error(`没有找到“${TEST_GROUP}”分组的真实测试连接`);
  return choices[0].directory;
}

const selectedDataDirectory = selectDataDirectory();
process.env.TUNNELDESK_DATA_DIR = selectedDataDirectory;
if (!process.env.TUNNELDESK_SSH_DIR) process.env.TUNNELDESK_SSH_DIR = path.join(path.dirname(selectedDataDirectory), ".ssh");

const database = require("../dist/db");
const sftp = require("../dist/sftp");
const jobs = require("../dist/sftp-jobs");
const sessions = require("../dist/sftp-session");

const runId = crypto.randomUUID();
const remoteRoot = `./${TEST_PREFIX}${runId}`;
const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}${runId}-`));
const trackedJobs = new Set();
const stagedDirectories = new Set();
const results = [];

function record(connection, step, status, detail = "") {
  const entry = { connection, step, status, detail };
  results.push(entry);
  const suffix = detail ? `：${detail}` : "";
  console.log(`${status === "passed" ? "PASS" : status === "skipped" ? "SKIP" : "FAIL"} [${connection}] ${step}${suffix}`);
}

function safeError(error) {
  const text = String(error?.message || error || "未知错误").replace(/[\r\n]+/g, " ").trim();
  return text.replace(/(?:password|private\s*key|passphrase)\s*[:=]\s*\S+/gi, "$1=[已隐藏]").slice(0, 240);
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

function remoteJoin(...parts) {
  return path.posix.join(...parts);
}

function assertSafeRemoteRoot(value) {
  const name = path.posix.basename(String(value || ""));
  assert.match(name, /^\.tunneldesk-test-[0-9a-f-]{36}$/i, "拒绝清理非验收临时目录");
}

function removeLocalDirectory(directory) {
  const resolved = path.resolve(directory);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!path.basename(resolved).startsWith(TEST_PREFIX) || path.relative(temporaryRoot, resolved).startsWith("..")) {
    throw new Error("拒绝清理非验收本地临时目录");
  }
  fs.rmSync(resolved, { recursive:true, force:true });
}

async function waitForJob(id, timeoutMs = JOB_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (!job) throw new Error("验收任务记录意外消失");
    if (job.status === "done") return job;
    if (["failed", "cancelled"].includes(job.status)) throw new Error(job.error || job.stderr || `任务状态为 ${job.status}`);
    await pause(150);
  }
  try { jobs.cancelSftpJob(id); } catch {}
  throw new Error("验收任务等待超时");
}

async function waitForUploadProgress(id, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (!job) throw new Error("上传任务记录意外消失");
    if (job.status === "done") throw new Error("上传完成过快，未能进入取消验收阶段");
    if (job.status === "failed") throw new Error(job.error || job.stderr || "上传任务失败");
    if (job.status === "running" && job.phase === "uploading" && Number(job.transferred || 0) > 0) return job;
    await pause(5);
  }
  throw new Error("上传任务未进入可取消阶段");
}

async function waitForJobStatus(id, expectedStatus, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.listSftpJobs().find(item => item.id === id);
    if (job?.status === expectedStatus) return job;
    if (job?.status === "failed") throw new Error(job.error || job.stderr || "任务失败");
    await pause(20);
  }
  throw new Error(`任务未进入 ${expectedStatus} 状态`);
}

async function runTrackedJob(start) {
  const created = start();
  trackedJobs.add(created.id);
  return waitForJob(created.id);
}

async function ensureReadableConnection(connection) {
  await sessions.connectSftpSession(connection.id, { explicit:true, force:true });
  await sftp.listRemoteDir(connection.id, ".", { refresh:true, page_size:10 });
}

async function verifyTransparentReconnect(connection) {
  await ensureReadableConnection(connection);
  sessions.disconnectSftpSession(connection.id, { remember:true });
  assert.equal(sessions.sftpSessionStatus(connection.id).connected, false);
  await sftp.listRemoteDir(connection.id, ".", { refresh:true, page_size:10 });
  assert.equal(sessions.sftpSessionStatus(connection.id).connected, true);
}

async function verifyPerHost(connection) {
  const name = String(connection.name || `connection-${connection.id}`);
  await verifyTransparentReconnect(connection);
  record(name, "手动断开后的操作自动重连", "passed");

  const sourceDir = remoteJoin(remoteRoot, "source");
  const copyDir = remoteJoin(remoteRoot, "copied");
  const moveDir = remoteJoin(remoteRoot, "moved");
  await sftp.makeRemoteDir(connection.id, sourceDir);
  await sftp.makeRemoteDir(connection.id, copyDir);
  await sftp.makeRemoteDir(connection.id, moveDir);
  const emptyPath = remoteJoin(remoteRoot, "empty.txt");
  await sftp.createRemoteFile(connection.id, emptyPath);
  await sftp.renameRemotePath(connection.id, emptyPath, remoteJoin(remoteRoot, "renamed.txt"));
  record(name, "新建目录、文件及重命名", "passed");

  const largeText = `${"TunnelDesk SFTP acceptance 0123456789\n".repeat(21000)}END\n`;
  assert.ok(Buffer.byteLength(largeText) > 512 * 1024);
  const largePath = remoteJoin(sourceDir, "large.txt");
  await sftp.writeRemoteFile(connection.id, largePath, Buffer.from(largeText, "utf8"));
  const largeRead = await sftp.readRemoteTextFile(connection.id, largePath, "utf8", 2 * 1024 * 1024);
  assert.equal(largeRead.content, largeText);
  record(name, "大于 512 KB 的文本写入、读取和内容校验", "passed", `${Buffer.byteLength(largeText)} bytes`);

  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const imagePath = remoteJoin(remoteRoot, "pixel.png");
  await sftp.writeRemoteFile(connection.id, imagePath, imageBytes);
  const imageRead = await sftp.readRemoteBinaryFile(connection.id, imagePath, 1024 * 1024);
  assert.equal(digest(imageRead.content), digest(imageBytes));
  record(name, "图片二进制写入、读取和哈希校验", "passed");

  const nestedPath = remoteJoin(sourceDir, "nested.txt");
  await sftp.writeRemoteFile(connection.id, nestedPath, Buffer.from("copy-and-move", "utf8"));
  await sftp.copyRemotePaths(connection.id, [nestedPath], copyDir);
  assert.equal((await sftp.readRemoteTextFile(connection.id, remoteJoin(copyDir, "nested.txt"), "utf8")).content, "copy-and-move");
  await sftp.moveRemotePaths(connection.id, [remoteJoin(copyDir, "nested.txt")], moveDir);
  assert.equal((await sftp.readRemoteTextFile(connection.id, remoteJoin(moveDir, "nested.txt"), "utf8")).content, "copy-and-move");
  record(name, "同主机复制和移动", "passed");

  const uploadBytes = crypto.randomBytes(640 * 1024);
  const uploadLocal = path.join(localRoot, `${connection.id}-upload.bin`);
  fs.writeFileSync(uploadLocal, uploadBytes);
  const uploadPath = remoteJoin(remoteRoot, "uploaded.bin");
  await runTrackedJob(() => jobs.startUploadJob(connection.id, uploadLocal, uploadPath, uploadBytes.length));
  const uploaded = await sftp.readRemoteBinaryFile(connection.id, uploadPath, 2 * 1024 * 1024);
  assert.equal(digest(uploaded.content), digest(uploadBytes));
  record(name, "后台上传任务", "passed", `${uploadBytes.length} bytes`);

  const receivedUploadBytes = crypto.randomBytes(384 * 1024);
  const receivedUploadPath = remoteJoin(remoteRoot, "received-upload.bin");
  const receiving = jobs.startUploadReceiveJob(connection.id, receivedUploadPath, "received-upload.bin", receivedUploadBytes.length);
  trackedJobs.add(receiving.id);
  const receiveRequest = new PassThrough();
  receiveRequest.headers = {"content-length":String(receivedUploadBytes.length)};
  const transitioned = jobs.receiveUploadJobContent(receiving.id, receiveRequest);
  receiveRequest.end(receivedUploadBytes);
  const uploading = await transitioned;
  assert.equal(uploading.id, receiving.id);
  assert.equal(uploading.phase, "uploading");
  await waitForJob(receiving.id);
  const receivedUpload = await sftp.readRemoteBinaryFile(connection.id, receivedUploadPath, 1024 * 1024);
  assert.equal(digest(receivedUpload.content), digest(receivedUploadBytes));
  record(name, "本机接收与远端上传使用同一后台任务", "passed", `${receivedUploadBytes.length} bytes`);

  const cancellableBytes = Buffer.alloc(32 * 1024 * 1024, 0x46);
  const cancellableLocal = path.join(localRoot, `${connection.id}-cancel-upload.bin`);
  const cancellablePath = remoteJoin(remoteRoot, "cancel-upload.bin");
  fs.writeFileSync(cancellableLocal, cancellableBytes);
  const cancellable = jobs.startUploadJob(connection.id, cancellableLocal, cancellablePath, cancellableBytes.length);
  trackedJobs.add(cancellable.id);
  const cancellableProgress = await waitForUploadProgress(cancellable.id);
  const uploadingList = await sftp.listRemoteDir(connection.id, remoteRoot, {refresh:true, page_size:1000});
  assert.ok(!(uploadingList.entries || []).some(item => item.name.startsWith(".tunneldesk-upload-")), "目录列表不应显示上传暂存文件");
  jobs.cancelSftpJob(cancellable.id);
  await waitForJobStatus(cancellable.id, "cancelled");
  await pause(700);
  const cancelledPlan = await sftp.planRemoteUploads(connection.id, remoteRoot, ["cancel-upload.bin"]);
  assert.equal(cancelledPlan.items[0].exists, false, "取消上传后不应留下最终文件");
  const cancelledTemporaryPlan = await sftp.planRemoteUploads(connection.id, remoteRoot, [path.posix.basename(cancellableProgress.remote_temp_path)]);
  assert.equal(cancelledTemporaryPlan.items[0].exists, false, "取消上传后不应留下远端暂存文件");
  record(name, "上传中途取消不留下同名文件", "passed");

  const overwritePath = remoteJoin(remoteRoot, "cancel-overwrite.txt");
  const originalOverwriteContent = Buffer.from("original-content-must-survive-cancel", "utf8");
  await sftp.writeRemoteFile(connection.id, overwritePath, originalOverwriteContent);
  const overwriteLocal = path.join(localRoot, `${connection.id}-cancel-overwrite.bin`);
  fs.writeFileSync(overwriteLocal, cancellableBytes);
  const overwrite = jobs.startUploadJob(connection.id, overwriteLocal, overwritePath, cancellableBytes.length);
  trackedJobs.add(overwrite.id);
  await waitForUploadProgress(overwrite.id);
  jobs.cancelSftpJob(overwrite.id);
  await waitForJobStatus(overwrite.id, "cancelled");
  await pause(700);
  const preserved = await sftp.readRemoteBinaryFile(connection.id, overwritePath, 1024 * 1024);
  assert.equal(digest(preserved.content), digest(originalOverwriteContent), "取消覆盖上传不得损坏原文件");
  record(name, "取消覆盖上传保留原文件", "passed");

  const downloadedJob = await runTrackedJob(() => jobs.startDownloadJob(connection.id, uploadPath, { deliveryMode:"browser" }));
  const downloadedFile = jobs.getSftpJobFile(downloadedJob.id);
  assert.equal(digest(fs.readFileSync(downloadedFile.path)), digest(uploadBytes));
  record(name, "后台下载任务及缓存内容校验", "passed");

  const staged = await sessions.stageSftpPaths(connection.id, [imagePath, sourceDir]);
  stagedDirectories.add(staged.directory);
  const stagedImage = staged.files.find(file => path.basename(file) === "pixel.png");
  const stagedSource = staged.files.find(file => path.basename(file) === "source");
  assert.ok(stagedImage && stagedSource);
  assert.equal(digest(fs.readFileSync(stagedImage)), digest(imageBytes));
  assert.equal(fs.readFileSync(path.join(stagedSource, "nested.txt"), "utf8"), "copy-and-move");
  record(name, "原生拖出前的文件与目录暂存", "passed");

  const nativeTicket = await sessions.createNativeSftpDragTicket(connection.id, [imagePath, sourceDir], {
    platform:process.platform,
    entries:[
      {path:imagePath, name:"pixel.png", type:"file"},
      {path:sourceDir, name:"source", type:"directory"}
    ]
  });
  const nativeImageEntry = nativeTicket.entries.find(entry => entry.relative_path === "pixel.png");
  const nativeNestedEntry = nativeTicket.entries.find(entry => entry.relative_path === "source/nested.txt");
  assert.ok(nativeImageEntry && nativeNestedEntry);
  const nativeImageRead = await sessions.openNativeSftpDragTicketFile(nativeTicket.token, nativeImageEntry.index);
  assert.equal(digest(await readAll(nativeImageRead.stream)), digest(imageBytes));
  const nativeNestedRead = await sessions.openNativeSftpDragTicketFile(nativeTicket.token, nativeNestedEntry.index, {start:5, end:12});
  assert.equal((await readAll(nativeNestedRead.stream)).toString("utf8"), "and-move");
  const nativePromiseDirectory = path.join(localRoot, `${connection.id}-native-promise`);
  fs.mkdirSync(nativePromiseDirectory);
  const nativeImageItem = nativeTicket.top_level.find(item => item.name === "pixel.png");
  const nativeSourceItem = nativeTicket.top_level.find(item => item.name === "source");
  assert.ok(nativeImageItem && nativeSourceItem);
  const nativeImageDelivery = await sessions.deliverNativeSftpDragTicketItem(
    nativeTicket.token,
    nativeImageItem.id,
    path.join(nativePromiseDirectory, nativeImageItem.name),
    nativePromiseDirectory
  );
  assert.equal(nativeImageDelivery.complete, false);
  assert.equal(digest(fs.readFileSync(path.join(nativePromiseDirectory, "pixel.png"))), digest(imageBytes));
  assert.equal((await sessions.getNativeSftpDragTicket(nativeTicket.token)).delivered_count, 1);
  const nativeSourceDelivery = await sessions.deliverNativeSftpDragTicketItem(
    nativeTicket.token,
    nativeSourceItem.id,
    path.join(nativePromiseDirectory, nativeSourceItem.name),
    nativePromiseDirectory
  );
  assert.equal(nativeSourceDelivery.complete, true);
  assert.equal(fs.readFileSync(path.join(nativePromiseDirectory, "source", "nested.txt"), "utf8"), "copy-and-move");
  assert.equal((await sessions.getNativeSftpDragTicket(nativeTicket.token)).delivered_count, 2);
  assert.equal(sessions.releaseNativeSftpDragTicket(nativeTicket.token), true);
  record(name, "原生拖出清单、按需读取及随机区间", "passed");

  const deliveryDirectory = path.join(localRoot, `${connection.id}-delivered`);
  const delivered = await sessions.deliverSftpPaths(connection.id, [imagePath, sourceDir], deliveryDirectory);
  assert.equal(delivered.files.length, 2);
  assert.equal(digest(fs.readFileSync(path.join(deliveryDirectory, "pixel.png"))), digest(imageBytes));
  assert.equal(fs.readFileSync(path.join(deliveryDirectory, "source", "nested.txt"), "utf8"), "copy-and-move");
  record(name, "文件与目录分别下载到本机目录", "passed");

  const recyclePath = remoteJoin(remoteRoot, "recycle.txt");
  await sftp.writeRemoteFile(connection.id, recyclePath, Buffer.from("recycle-restore-delete", "utf8"));
  const recycled = await sftp.recycleRemotePath(connection.id, recyclePath);
  assert.ok((await sftp.listRemoteRecycleItems(connection.id)).some(item => item.id === recycled.id));
  await sftp.restoreRemoteRecycleItem(connection.id, recycled.id);
  assert.equal((await sftp.readRemoteTextFile(connection.id, recyclePath, "utf8")).content, "recycle-restore-delete");
  const recycledAgain = await sftp.recycleRemotePath(connection.id, recyclePath);
  await sftp.deleteRemoteRecycleItem(connection.id, recycledAgain.id);
  assert.ok(!(await sftp.listRemoteRecycleItems(connection.id)).some(item => item.id === recycledAgain.id));
  record(name, "回收站移入、恢复和永久删除", "passed");

  const rootListing = await sftp.listRemoteDir(connection.id, remoteRoot, { refresh:true, page_size:100 });
  assert.ok(rootListing.items?.length || rootListing.entries?.length);
  const rootSize = await sftp.readRemoteDirectorySize(connection.id, remoteRoot);
  assert.ok(BigInt(rootSize.size_bytes) >= BigInt(uploadBytes.length));
  record(name, "目录列表及递归大小读取", "passed");
}

async function verifyCrossHost(source, target) {
  const label = `${source.name} -> ${target.name}`;
  await sftp.makeRemoteDir(source.id, remoteRoot);
  await sftp.makeRemoteDir(target.id, remoteRoot);
  const sourceNormal = remoteJoin(remoteRoot, "cross-normal.txt");
  const sourceDirectory = remoteJoin(remoteRoot, "cross-directory");
  await sftp.writeRemoteFile(source.id, sourceNormal, Buffer.from("cross-normal", "utf8"));
  await sftp.makeRemoteDir(source.id, sourceDirectory);
  await sftp.writeRemoteFile(source.id, remoteJoin(sourceDirectory, "nested.txt"), Buffer.from("cross-directory", "utf8"));
  await runTrackedJob(() => jobs.crossCopyJob(source.id, target.id, [sourceNormal, sourceDirectory], remoteRoot, "error"));
  assert.equal((await sftp.readRemoteTextFile(target.id, remoteJoin(remoteRoot, "cross-normal.txt"), "utf8")).content, "cross-normal");
  assert.equal((await sftp.readRemoteTextFile(target.id, remoteJoin(remoteRoot, "cross-directory", "nested.txt"), "utf8")).content, "cross-directory");
  record(label, "跨主机复制文件和目录", "passed");

  const conflictPath = remoteJoin(remoteRoot, "conflict.txt");
  await sftp.writeRemoteFile(source.id, conflictPath, Buffer.from("source-conflict", "utf8"));
  await sftp.writeRemoteFile(target.id, conflictPath, Buffer.from("target-original", "utf8"));
  await runTrackedJob(() => jobs.crossCopyJob(source.id, target.id, [conflictPath], remoteRoot, "rename"));
  assert.equal((await sftp.readRemoteTextFile(target.id, conflictPath, "utf8")).content, "target-original");
  assert.equal((await sftp.readRemoteTextFile(target.id, remoteJoin(remoteRoot, "conflict (1).txt"), "utf8")).content, "source-conflict");
  record(label, "跨主机同名冲突自动改名", "passed");

  const overwritePath = remoteJoin(remoteRoot, "overwrite.txt");
  await sftp.writeRemoteFile(source.id, overwritePath, Buffer.from("source-overwrite", "utf8"));
  await sftp.writeRemoteFile(target.id, overwritePath, Buffer.from("target-before-overwrite", "utf8"));
  await runTrackedJob(() => jobs.crossCopyJob(source.id, target.id, [overwritePath], remoteRoot, "overwrite"));
  assert.equal((await sftp.readRemoteTextFile(target.id, overwritePath, "utf8")).content, "source-overwrite");
  record(label, "跨主机同名冲突覆盖", "passed");
}

async function cleanConnection(connection) {
  assertSafeRemoteRoot(remoteRoot);
  try {
    await sessions.connectSftpSession(connection.id, { explicit:true, force:true });
    const recycleItems = await sftp.listRemoteRecycleItems(connection.id);
    for (const item of recycleItems) {
      const original = String(item.original_path || "");
      if (original === remoteRoot || original.startsWith(`${remoteRoot}/`)) {
        try { await sftp.deleteRemoteRecycleItem(connection.id, item.id); } catch {}
      }
    }
    await sftp.deleteRemotePath(connection.id, remoteRoot);
    const parent = await sftp.listRemoteDir(connection.id, ".", { refresh:true, page_size:1000 });
    const entries = parent.items || parent.entries || [];
    assert.ok(!entries.some(item => item.name === path.posix.basename(remoteRoot)), "远端临时目录仍然存在");
    return true;
  } catch {
    return false;
  }
}

async function cleanup(connections) {
  for (const id of trackedJobs) {
    try {
      const current = jobs.listSftpJobs().find(item => item.id === id);
      if (current && ["running", "pending", "paused"].includes(current.status)) jobs.cancelSftpJob(id);
    } catch {}
    try { jobs.deleteSftpJob(id); } catch {}
  }
  for (const directory of stagedDirectories) {
    try {
      const expectedRoot = path.resolve(selectedDataDirectory, "sftp-drag");
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) === expectedRoot) fs.rmSync(resolved, { recursive:true, force:true });
    } catch {}
  }
  const cleanupResults = [];
  for (const connection of connections) cleanupResults.push({ name:connection.name, clean:await cleanConnection(connection) });
  sessions.closeAllSftpSessions();
  try { removeLocalDirectory(localRoot); } catch {}
  try { database.closeDatabase(); } catch {}
  return cleanupResults;
}

async function main() {
  const candidates = database.listConnections().filter(item => item.group_name === TEST_GROUP && !String(item.name).startsWith("fixture-"));
  if (!candidates.length) throw new Error(`“${TEST_GROUP}”分组中没有可用于真实验收的连接`);
  console.log(`真实 SFTP 验收开始：${candidates.map(item => item.name).join("、")}`);
  const usable = [];
  for (const connection of candidates) {
    try {
      await ensureReadableConnection(connection);
      usable.push(connection);
      record(connection.name, "连接可用性", "passed");
    } catch (error) {
      record(connection.name, "连接可用性", "failed", safeError(error));
    }
  }
  if (!usable.length) throw new Error("真实测试连接当前均不可用");

  let primaryError = null;
  try {
    for (const connection of usable) {
      try {
        await verifyPerHost(connection);
      } catch (error) {
        record(connection.name, "单主机完整验收", "failed", safeError(error));
        primaryError ||= error;
      }
    }
    if (usable.length >= 2) {
      try {
        await verifyCrossHost(usable[0], usable[1]);
      } catch (error) {
        record(`${usable[0].name} -> ${usable[1].name}`, "跨主机完整验收", "failed", safeError(error));
        primaryError ||= error;
      }
    } else {
      record("跨主机", "跨主机复制", "skipped", "只有一个可用测试连接");
    }
  } finally {
    const cleanupResults = await cleanup(usable);
    for (const item of cleanupResults) record(item.name, "远端和本地临时残留清理", item.clean ? "passed" : "failed");
    if (cleanupResults.some(item => !item.clean)) primaryError ||= new Error("部分测试机的临时残留未能确认清理");
  }

  const failed = results.filter(item => item.status === "failed");
  console.log(`真实 SFTP 验收结束：通过 ${results.filter(item => item.status === "passed").length}，失败 ${failed.length}，跳过 ${results.filter(item => item.status === "skipped").length}`);
  if (primaryError || failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`真实 SFTP 验收无法继续：${safeError(error)}`);
  try { await cleanup([]); } catch {}
  process.exitCode = 1;
});
