const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-native-drag-check-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");
process.env.TERMA_DISABLE_UPDATE_CHECK = "1";
fs.mkdirSync(process.env.TERMA_DATA_DIR, {recursive:true});
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});
const interruptedDownloadPath = path.join(temporaryRoot, "partial-download.bin");
const interruptedUploadPath = path.join(temporaryRoot, "pending-upload.bin");
fs.writeFileSync(interruptedDownloadPath, "partial download");
fs.writeFileSync(interruptedUploadPath, "pending upload");
fs.writeFileSync(path.join(process.env.TERMA_DATA_DIR, "sftp-jobs.json"), JSON.stringify({
  jobs:[
    {
      id:"interrupted-native-drag-running",
      type:"native-drag",
      status:"running",
      transferred:26,
      speed_bps:18,
      native_drag_token:"old-token",
      native_drag_ranges:{0:{start:0,end:25}},
      created_at:12
    },
    {id:"interrupted-native-drag-pending", type:"native-drag", status:"pending", speed_bps:9, created_at:11},
    {id:"interrupted-native-drag-paused", type:"native-drag", status:"paused", speed_bps:4, created_at:10},
    {id:"completed-native-drag", type:"native-drag", status:"done", progress:100, created_at:9},
    {id:"failed-native-drag", type:"native-drag", status:"failed", error:"original failure", created_at:8},
    {id:"cancelled-native-drag", type:"native-drag", status:"cancelled", created_at:7},
    {id:"regular-download-running", type:"download", status:"running", marker:"keep", temp_path:interruptedDownloadPath, created_at:6},
    {id:"regular-upload-pending", type:"upload", status:"pending", marker:"keep", local_path:interruptedUploadPath, created_at:5},
    {id:"regular-download-paused", type:"download", status:"paused", marker:"keep", created_at:4},
    {id:"regular-upload-paused", type:"upload", status:"paused", marker:"keep", created_at:3}
  ]
}, null, 2));

async function main() {
try {
  const database = require("../dist/db");
  const ssh2Client = require("../dist/ssh2-client");
  const remoteEntries = new Map([
    ["/root/report.txt", {type:"file", content:Buffer.from("promised report", "utf8")}],
    ["/root/slow.bin", {type:"file", content:Buffer.alloc(1024 * 1024, 0x53)}],
    ["/root/kernel-link", {type:"symlink", linkSize:27, targetType:"file", content:Buffer.alloc(8192, 0x4b)}],
    ["/root/folder", {type:"directory"}],
    ["/root/folder/nested.txt", {type:"file", content:Buffer.from("nested promise", "utf8")}]
  ]);
  let delayedLstatPath = "";
  let releaseDelayedLstat = null;
  let markDelayedLstatStarted = null;
  let slowReadStream = null;
  let markSlowReadStarted = null;
  let endedSftpChannels = 0;
  const lstatCounts = new Map();
  database.getConnection = () => ({
    id:123,
    ssh_host:"fixture.invalid",
    ssh_port:22,
    ssh_user:"root",
    auth_type:"password",
    ssh_password:"fixture"
  });
  ssh2Client.connectSsh = async () => {
    const client = new EventEmitter();
    client.end = () => {};
    client.sftp = (callback) => callback(null, {
      lstat(remotePath, done) {
        const entry = remoteEntries.get(remotePath);
        lstatCounts.set(remotePath, Number(lstatCounts.get(remotePath) || 0) + 1);
        const finish = () => {
          if (!entry) return done(Object.assign(new Error("not found"), {code:2}));
          done(null, {
            size:entry.type === "symlink" ? entry.linkSize : entry.content?.length || 0,
            mtime:1700000000,
            mode:entry.type === "directory" ? 0o40755 : 0o100644,
            isDirectory:() => entry.type === "directory",
            isSymbolicLink:() => entry.type === "symlink"
          });
        };
        if (remotePath === delayedLstatPath && releaseDelayedLstat) {
          markDelayedLstatStarted?.();
          releaseDelayedLstat.then(finish);
          return;
        }
        finish();
      },
      stat(remotePath, done) {
        const entry = remoteEntries.get(remotePath);
        if (!entry) return done(Object.assign(new Error("not found"), {code:2}));
        const directory = entry.type === "directory" || entry.targetType === "directory";
        done(null, {
          size:directory ? 0 : entry.content?.length || 0,
          mtime:1700000000,
          mode:directory ? 0o40755 : 0o100644,
          isDirectory:() => directory,
          isSymbolicLink:() => false
        });
      },
      readdir(remotePath, done) {
        if (remotePath !== "/root/folder") return done(null, []);
        done(null, [{filename:"nested.txt"}]);
      },
      fastGet(remotePath, localPath, _options, done) {
        const entry = remoteEntries.get(remotePath);
        if (!entry?.content) return done(new Error("not a file"));
        fs.mkdirSync(path.dirname(localPath), {recursive:true});
        fs.writeFileSync(localPath, entry.content);
        done(null);
      },
      createReadStream(remotePath) {
        const entry = remoteEntries.get(remotePath);
        if (!entry?.content) throw new Error("not a file");
        if (remotePath === "/root/slow.bin") {
          slowReadStream = new PassThrough();
          queueMicrotask(() => {
            slowReadStream.write(entry.content.subarray(0, 64 * 1024));
            markSlowReadStarted?.();
          });
          return slowReadStream;
        }
        return Readable.from(entry.content);
      },
      end() { endedSftpChannels += 1; }
    });
    return client;
  };

  const session = require("../dist/sftp-session");
  const server = require("../dist/server");
  const jobs = require("../dist/sftp-jobs");

  const restoredJobs = jobs.listSftpJobs();
  for (const status of ["running", "pending", "paused"]) {
    const interruptedJob = restoredJobs.find(item => item.id === `interrupted-native-drag-${status}`);
    assert.equal(interruptedJob.status, "failed", `a ${status} native drag must not survive a restart`);
    assert.match(interruptedJob.error, /已重启/);
    assert.equal(interruptedJob.speed_bps, 0);
    assert.equal(Number.isFinite(interruptedJob.finished_at), true);
  }
  assert.equal(restoredJobs.find(item => item.id === "completed-native-drag").status, "done");
  assert.equal(restoredJobs.find(item => item.id === "failed-native-drag").error, "original failure");
  assert.equal(restoredJobs.find(item => item.id === "cancelled-native-drag").status, "cancelled");
  for (const id of [
    "regular-download-running",
    "regular-upload-pending",
    "regular-download-paused",
    "regular-upload-paused"
  ]) {
    assert.equal(restoredJobs.find(item => item.id === id).marker, "keep");
    assert.equal(restoredJobs.find(item => item.id === id).status, "failed", "no running task can survive a process restart");
    assert.equal(restoredJobs.find(item => item.id === id).can_resume, false);
    assert.match(restoredJobs.find(item => item.id === id).error, /重启/);
  }
  assert.equal(fs.existsSync(interruptedDownloadPath), false, "an interrupted download cache must be removed");
  assert.equal(restoredJobs.find(item => item.id === "regular-upload-pending").local_path_owned, false);
  assert.equal(fs.existsSync(interruptedUploadPath), true, "an unmarked interrupted upload source must be preserved");
  assert.deepEqual(jobs.cancelSftpJob("regular-download-running"), {ok:true, status:"failed"}, "cancelling a recovered job must be idempotent");
  assert.equal(restoredJobs.some(item => "native_drag_token" in item || "native_drag_ranges" in item), false);

  const jobsFile = path.join(process.env.TERMA_DATA_DIR, "sftp-jobs.json");
  const firstPersistedText = fs.readFileSync(jobsFile, "utf8");
  const persistedJobs = JSON.parse(firstPersistedText).jobs;
  assert.equal(persistedJobs.find(item => item.id === "interrupted-native-drag-running").status, "failed");
  assert.equal(persistedJobs.some(item => ["running", "pending", "paused"].includes(item.status)), false);
  assert.equal(persistedJobs.some(item => "native_drag_token" in item || "native_drag_ranges" in item), false);
  assert.deepEqual(jobs.listSftpJobs(), restoredJobs, "restored native drag history must be idempotent");
  assert.equal(fs.readFileSync(jobsFile, "utf8"), firstPersistedText, "a second history read must not rewrite the migrated file");

  assert.equal(session.__portableDragEntryName("report.txt", "win32"), "report.txt");
  assert.equal(session.__portableDragEntryName("a:b?.txt", "win32"), "a_b_.txt");
  assert.equal(session.__portableDragEntryName("CON", "win32"), "_CON");
  assert.equal(session.__portableDragEntryName("../name", "linux"), ".._name");

  assert.deepEqual(
    session.__normalizedNativeDragPaths(["/root/a", "/root/a/child", "/root/b", "/root/b"]),
    ["/root/a", "/root/b"],
    "nested and duplicate selections must not create duplicate descriptors"
  );
  assert.throws(() => session.__normalizedNativeDragPaths([]), /最多拖出/);
  assert.throws(() => session.__normalizedNativeDragPaths(["bad\0path"]), /路径无效/);

  const reserved = session.reserveNativeSftpDragTicket(123, ["/root/report.txt", "/root/CON"], {
    platform:"win32",
    entries:[
      {path:"/root/report.txt", name:"report.txt", type:"file"},
      {path:"/root/CON", name:"CON", type:"directory"}
    ]
  });
  assert.equal(reserved.ready, false);
  assert.equal(reserved.token.length >= 40, true);
  assert.equal(reserved.expires_at - reserved.created_at >= 65 * 60 * 1000, true);
  assert.deepEqual(
    reserved.top_level.map(item => ({id:item.id, name:item.name, type:item.type})),
    [
      {id:"0", name:"report.txt", type:"file"},
      {id:"1", name:"_CON", type:"directory"}
    ]
  );
  assert.equal(reserved.delivered_count, 0);
  assert.equal(reserved.delivery_complete, false);

  const promiseDirectory = path.join(temporaryRoot, "finder-target");
  fs.mkdirSync(promiseDirectory);
  const promiseTarget = path.join(promiseDirectory, "report.txt");
  assert.deepEqual(
    session.__validateNativeSftpDragTarget("report.txt", promiseTarget, promiseDirectory),
    {
      directory:path.resolve(promiseDirectory),
      target:path.resolve(promiseTarget),
      name:"report.txt",
      promisedName:"report.txt",
      renamed:false
    }
  );
  assert.deepEqual(
    session.__validateNativeSftpDragTarget("report.txt", path.join(promiseDirectory, "report 2.txt"), promiseDirectory),
    {
      directory:path.resolve(promiseDirectory),
      target:path.resolve(path.join(promiseDirectory, "report 2.txt")),
      name:"report 2.txt",
      promisedName:"report.txt",
      renamed:true
    }
  );
  assert.equal(
    session.__validateNativeSftpDragTarget("résumé.txt", path.join(promiseDirectory, "résumé.txt"), promiseDirectory).renamed,
    false,
    "Finder supplied Unicode names must be compared canonically"
  );
  assert.throws(
    () => session.__validateNativeSftpDragTarget("escaped.txt", path.join(promiseDirectory, "..", "escaped.txt"), promiseDirectory),
    /不在指定目录内/
  );
  assert.throws(
    () => session.__validateNativeSftpDragTarget("report.txt", "report.txt", promiseDirectory),
    /目标路径无效/
  );
  fs.writeFileSync(promiseTarget, "occupied");
  assert.throws(
    () => session.__validateNativeSftpDragTarget("report.txt", promiseTarget, promiseDirectory),
    /目标路径已存在/
  );
  assert.equal(session.releaseNativeSftpDragTicket(reserved.token), true);
  assert.equal(session.releaseNativeSftpDragTicket(reserved.token), false);

  const perConnectionTickets = Array.from({length:9}, (_, index) => (
    session.reserveNativeSftpDragTicket(7001, ["/root/report.txt"], {
      platform:"darwin",
      entries:[{path:"/root/report.txt", name:`report-${index}.txt`, type:"file"}]
    })
  ));
  assert.equal(
    session.releaseNativeSftpDragTicket(perConnectionTickets[0].token),
    false,
    "the oldest unfinished ticket must be evicted at the per-connection limit"
  );
  for (const ticket of perConnectionTickets.slice(1)) session.releaseNativeSftpDragTicket(ticket.token);

  const globalTickets = Array.from({length:65}, (_, index) => (
    session.reserveNativeSftpDragTicket(8000 + index, ["/root/report.txt"], {
      platform:"linux",
      entries:[{path:"/root/report.txt", name:`global-${index}.txt`, type:"file"}]
    })
  ));
  assert.equal(
    session.releaseNativeSftpDragTicket(globalTickets[0].token),
    false,
    "the oldest unfinished ticket must be evicted at the global limit"
  );
  for (const ticket of globalTickets.slice(1)) session.releaseNativeSftpDragTicket(ticket.token);

  let resolveDelayedLstat;
  releaseDelayedLstat = new Promise(resolve => { resolveDelayedLstat = resolve; });
  const delayedLstatStarted = new Promise(resolve => { markDelayedLstatStarted = resolve; });
  delayedLstatPath = "/root/folder";
  lstatCounts.clear();
  const concurrentTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt", "/root/folder"], {
    platform:"linux",
    entries:[
      {path:"/root/report.txt", name:"report.txt", type:"file"},
      {path:"/root/folder", name:"folder", type:"directory"}
    ]
  });
  const firstManifest = session.getNativeSftpDragTicket(concurrentTicket.token);
  await delayedLstatStarted;
  let secondManifestSettled = false;
  const secondManifest = session.getNativeSftpDragTicket(concurrentTicket.token).then(result => {
    secondManifestSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondManifestSettled, false, "a concurrent manifest request must wait instead of observing partial entries");
  resolveDelayedLstat();
  const [firstManifestResult, secondManifestResult] = await Promise.all([firstManifest, secondManifest]);
  assert.equal(firstManifestResult.ready, true);
  assert.equal(secondManifestResult.ready, true);
  assert.deepEqual(firstManifestResult.entries, secondManifestResult.entries);
  assert.deepEqual(
    firstManifestResult.entries.map(entry => entry.relative_path),
    ["report.txt", "folder", "folder/nested.txt"]
  );
  assert.equal(lstatCounts.get("/root/report.txt"), 1);
  assert.equal(lstatCounts.get("/root/folder"), 1);
  assert.equal(lstatCounts.get("/root/folder/nested.txt"), 1);
  delayedLstatPath = "";
  releaseDelayedLstat = null;
  markDelayedLstatStarted = null;
  assert.equal(session.releaseNativeSftpDragTicket(concurrentTicket.token), true);

  let resolveCancelledLstat;
  releaseDelayedLstat = new Promise(resolve => { resolveCancelledLstat = resolve; });
  const cancelledLstatStarted = new Promise(resolve => { markDelayedLstatStarted = resolve; });
  delayedLstatPath = "/root/folder";
  lstatCounts.clear();
  const cancelledManifestTicket = session.reserveNativeSftpDragTicket(123, ["/root/folder"], {
    platform:"win32",
    entries:[{path:"/root/folder", name:"folder", type:"directory"}]
  });
  const cancelledDirectoryManifestPromise = session.getNativeSftpDragTicket(cancelledManifestTicket.token);
  await cancelledLstatStarted;
  const endedBeforeManifestCancel = endedSftpChannels;
  assert.equal(session.releaseNativeSftpDragTicket(cancelledManifestTicket.token), true);
  assert.equal(
    endedSftpChannels,
    endedBeforeManifestCancel + 1,
    "cancelling a pending directory drag must close its dedicated manifest channel immediately"
  );
  resolveCancelledLstat();
  await assert.rejects(
    cancelledDirectoryManifestPromise,
    error => error?.code === "SFTP_NATIVE_DRAG_CANCELLED",
    "a cancelled directory manifest must terminate as cancellation"
  );
  assert.equal(
    endedSftpChannels,
    endedBeforeManifestCancel + 1,
    "the cancelled manifest channel must be closed exactly once"
  );
  assert.equal(
    lstatCounts.has("/root/folder/nested.txt"),
    false,
    "cancelled directory enumeration must not continue into descendants"
  );
  delayedLstatPath = "";
  releaseDelayedLstat = null;
  markDelayedLstatStarted = null;

  const symlinkTicket = session.reserveNativeSftpDragTicket(123, ["/root/kernel-link"], {
    platform:"win32",
    entries:[{path:"/root/kernel-link", name:"vmlinuz", type:"file", size:27, metadataKnown:true}]
  });
  const symlinkManifest = await session.getNativeSftpDragTicket(symlinkTicket.token);
  assert.equal(symlinkManifest.top_level[0].size, 8192, "top-level drag metadata must use the symlink target size");
  assert.equal(symlinkManifest.top_level[0].is_symlink, true);
  assert.equal(symlinkManifest.top_level[0].link_size, 27);
  assert.equal(symlinkManifest.entries[0].size, 8192);
  assert.equal(symlinkManifest.entries[0].is_symlink, true);
  assert.equal(symlinkManifest.entries[0].link_size, 27);
  const symlinkRead = await session.openNativeSftpDragTicketFile(symlinkTicket.token, 0, {start:0, end:8191});
  let symlinkBytes = 0;
  for await (const chunk of symlinkRead.stream) symlinkBytes += chunk.length;
  assert.equal(symlinkBytes, 8192, "native drag must not truncate a symlink target to the link text length");
  assert.equal(session.releaseNativeSftpDragTicket(symlinkTicket.token), true);

  const retryTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt", "/root/retry.txt"], {
    platform:"win32",
    entries:[
      {path:"/root/report.txt", name:"report.txt", type:"file"},
      {path:"/root/retry.txt", name:"retry.txt", type:"file"}
    ]
  });
  await assert.rejects(() => session.getNativeSftpDragTicket(retryTicket.token), /not found/);
  remoteEntries.set("/root/retry.txt", {type:"file", content:Buffer.from("retry complete", "utf8")});
  const retriedManifest = await session.getNativeSftpDragTicket(retryTicket.token);
  assert.equal(retriedManifest.ready, true);
  assert.deepEqual(
    retriedManifest.entries.map(entry => entry.relative_path),
    ["report.txt", "retry.txt"],
    "a failed build must keep entries unpublished so the next request can rebuild the complete manifest"
  );
  remoteEntries.delete("/root/retry.txt");
  assert.equal(session.releaseNativeSftpDragTicket(retryTicket.token), true);

  const deliveryTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt", "/root/folder"], {
    platform:"darwin",
    entries:[
      {path:"/root/report.txt", name:"report.txt", type:"file"},
      {path:"/root/folder", name:"folder", type:"directory"}
    ]
  });
  const renamedReportPath = path.join(promiseDirectory, "delivered-report.txt");
  const deliveredReport = await session.deliverNativeSftpDragTicketItem(
    deliveryTicket.token,
    deliveryTicket.top_level[0].id,
    renamedReportPath,
    promiseDirectory
  );
  assert.equal(deliveredReport.name, "delivered-report.txt");
  assert.equal(deliveredReport.promised_name, "report.txt");
  assert.equal(deliveredReport.renamed, true, "Finder may supply a unique name for an existing promised item");
  assert.equal(fs.readFileSync(renamedReportPath, "utf8"), "promised report");
  const reportTarget = path.join(promiseDirectory, "report.txt");
  fs.rmSync(reportTarget, {force:true});
  const reportResult = await session.deliverNativeSftpDragTicketItem(
    deliveryTicket.token,
    deliveryTicket.top_level[0].id,
    reportTarget,
    promiseDirectory
  );
  assert.equal(reportResult.complete, false);
  assert.equal(fs.readFileSync(reportTarget, "utf8"), "promised report");
  assert.equal((await session.getNativeSftpDragTicket(deliveryTicket.token)).delivered_count, 1);
  const folderTarget = path.join(promiseDirectory, "folder");
  const folderResult = await session.deliverNativeSftpDragTicketItem(
    deliveryTicket.token,
    deliveryTicket.top_level[1].id,
    folderTarget,
    promiseDirectory
  );
  assert.equal(folderResult.complete, true);
  assert.equal(fs.readFileSync(path.join(folderTarget, "nested.txt"), "utf8"), "nested promise");
  assert.equal((await session.getNativeSftpDragTicket(deliveryTicket.token)).delivered_count, 2);
  assert.equal(session.releaseNativeSftpDragTicket(deliveryTicket.token), true);

  const renamedDirectoryTicket = session.reserveNativeSftpDragTicket(123, ["/root/folder"], {
    platform:"darwin",
    entries:[{path:"/root/folder", name:"folder", type:"directory"}]
  });
  const renamedDirectoryTarget = path.join(promiseDirectory, "folder 2");
  const renamedDirectoryResult = await session.deliverNativeSftpDragTicketItem(
    renamedDirectoryTicket.token,
    renamedDirectoryTicket.top_level[0].id,
    renamedDirectoryTarget,
    promiseDirectory
  );
  assert.equal(renamedDirectoryResult.promised_name, "folder");
  assert.equal(renamedDirectoryResult.name, "folder 2");
  assert.equal(renamedDirectoryResult.renamed, true);
  assert.equal(fs.readFileSync(path.join(renamedDirectoryTarget, "nested.txt"), "utf8"), "nested promise");
  assert.equal(session.releaseNativeSftpDragTicket(renamedDirectoryTicket.token), true);

  const cancelledPromiseTicket = session.reserveNativeSftpDragTicket(123, ["/root/slow.bin"], {
    platform:"darwin",
    entries:[{path:"/root/slow.bin", name:"slow.bin", type:"file", size:1024 * 1024, metadataKnown:true}]
  });
  const cancelledPromiseTarget = path.join(promiseDirectory, "slow.bin");
  const abortController = new AbortController();
  const slowReadStarted = new Promise(resolve => { markSlowReadStarted = resolve; });
  const cancelledPromiseDelivery = session.deliverNativeSftpDragTicketItem(
    cancelledPromiseTicket.token,
    cancelledPromiseTicket.top_level[0].id,
    cancelledPromiseTarget,
    promiseDirectory,
    {signal:abortController.signal}
  );
  await slowReadStarted;
  for (let attempt = 0; attempt < 50 && !fs.existsSync(cancelledPromiseTarget); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(cancelledPromiseTarget), true, "the macOS Promise fixture must begin writing before cancellation");
  abortController.abort();
  await assert.rejects(cancelledPromiseDelivery, error => error?.code === "SFTP_NATIVE_DRAG_CANCELLED");
  assert.equal(slowReadStream?.destroyed, true, "cancelling a File Promise must stop the active remote SFTP stream");
  assert.equal(fs.existsSync(cancelledPromiseTarget), false, "cancelling a File Promise must remove its partial target");
  assert.equal((await session.getNativeSftpDragTicket(cancelledPromiseTicket.token)).delivered_count, 0);
  assert.equal(session.releaseNativeSftpDragTicket(cancelledPromiseTicket.token), true);
  slowReadStream = null;
  markSlowReadStarted = null;

  assert.deepEqual(server.__nativeDragByteRange("", 10), {start:0, end:9, partial:false});
  assert.deepEqual(server.__nativeDragByteRange("bytes=2-5", 10), {start:2, end:5, partial:true});
  assert.deepEqual(server.__nativeDragByteRange("bytes=8-", 10), {start:8, end:9, partial:true});
  assert.equal(server.__nativeDragByteRange("bytes=10-", 10), null);
  assert.equal(server.__nativeDragByteRange("items=0-1", 10), null);

  const ranges = [];
  assert.equal(jobs.__addUniqueByteRange(ranges, 0, 9), 10);
  assert.equal(jobs.__addUniqueByteRange(ranges, 5, 14), 5);
  assert.equal(jobs.__addUniqueByteRange(ranges, 20, 29), 10);
  assert.equal(jobs.__addUniqueByteRange(ranges, 15, 19), 5);
  assert.deepEqual(ranges, [[0, 29]], "overlapping Range requests must count each byte once");

  const taskTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"win32",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const taskManifest = await session.getNativeSftpDragTicket(taskTicket.token);
  const task = jobs.beginNativeSftpDragJob(taskTicket.token, taskManifest);
  const firstTaskStream = Readable.from([Buffer.alloc(8)]);
  jobs.trackNativeSftpDragStream(taskTicket.token, 0, {stream:firstTaskStream, start:0});
  for await (const _chunk of firstTaskStream) {}
  const overlappingTaskStream = Readable.from([Buffer.alloc(8)]);
  jobs.trackNativeSftpDragStream(taskTicket.token, 0, {stream:overlappingTaskStream, start:4});
  for await (const _chunk of overlappingTaskStream) {}
  const runningTask = jobs.listSftpJobs().find(item => item.id === task.id);
  assert.equal(runningTask.type, "native-drag");
  assert.equal(runningTask.status, "running");
  assert.equal(runningTask.transferred, 12, "task progress must ignore overlapping Range bytes");
  assert.equal("native_drag_token" in runningTask, false, "native drag credentials must stay internal");
  assert.equal("native_drag_ranges" in runningTask, false, "Range bookkeeping must stay internal");
  assert.deepEqual(
    jobs.finishNativeSftpDragJob(taskTicket.token, "done"),
    {ok:true, status:"cancelled"},
    "a target that stops reading early must not be reported as a completed download"
  );
  const finishedTask = jobs.listSftpJobs().find(item => item.id === task.id);
  assert.equal(finishedTask.status, "cancelled");
  assert.equal(finishedTask.progress, 80);
  assert.equal(finishedTask.transferred, 12);
  assert.match(finishedTask.error, /未读取完整/);
  assert.deepEqual(
    jobs.beginNativeSftpDragJob(taskTicket.token, taskManifest),
    {id:"", status:"discarded"},
    "late reads must not recreate a completed native drag task"
  );
  assert.equal(session.releaseNativeSftpDragTicket(taskTicket.token), true);

  const completeTaskTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"linux",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const completeTaskManifest = await session.getNativeSftpDragTicket(completeTaskTicket.token);
  const completeTask = jobs.beginNativeSftpDragJob(completeTaskTicket.token, completeTaskManifest);
  const completeTaskStream = Readable.from([Buffer.alloc(Buffer.byteLength("promised report"))]);
  jobs.trackNativeSftpDragStream(completeTaskTicket.token, 0, {stream:completeTaskStream, start:0});
  for await (const _chunk of completeTaskStream) {}
  assert.deepEqual(jobs.finishNativeSftpDragJob(completeTaskTicket.token, "done"), {ok:true, status:"done"});
  const completedTask = jobs.listSftpJobs().find(item => item.id === completeTask.id);
  assert.equal(completedTask.status, "done");
  assert.equal(completedTask.progress, 100);
  assert.equal(completedTask.transferred, Buffer.byteLength("promised report"));
  assert.equal(session.releaseNativeSftpDragTicket(completeTaskTicket.token), true);

  const macPromiseSize = Buffer.byteLength("promised report");
  const macProgressTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"darwin",
    entries:[{
      path:"/root/report.txt",
      name:"mac-progress.txt",
      type:"file",
      size:macPromiseSize,
      metadataKnown:true
    }]
  });
  const macProgressTask = jobs.beginNativeSftpDragJob(macProgressTicket.token, macProgressTicket);
  const pendingMacProgress = jobs.listSftpJobs().find(item => item.id === macProgressTask.id);
  assert.equal(pendingMacProgress.size, macPromiseSize, "a macOS File Promise must use known top-level file metadata before manifest expansion");
  assert.equal(pendingMacProgress.size_known, true);
  assert.equal(pendingMacProgress.progress_known, true);
  let reportedMacBytes = 0;
  const macProgressTarget = path.join(promiseDirectory, "mac-progress.txt");
  await session.deliverNativeSftpDragTicketItem(
    macProgressTicket.token,
    macProgressTicket.top_level[0].id,
    macProgressTarget,
    promiseDirectory,
    {
      onProgress(bytes) {
        reportedMacBytes += bytes;
        jobs.recordNativeSftpDragBytes(macProgressTicket.token, bytes);
      }
    }
  );
  const runningMacProgress = jobs.listSftpJobs().find(item => item.id === macProgressTask.id);
  assert.equal(reportedMacBytes, macPromiseSize, "macOS direct writes must report every downloaded byte");
  assert.equal(runningMacProgress.transferred, macPromiseSize);
  assert.equal(runningMacProgress.progress, 99, "an active native drag stays below 100% until Finder confirms completion");
  assert.deepEqual(jobs.finishNativeSftpDragJob(macProgressTicket.token, "done"), {ok:true, status:"done"});
  assert.equal(jobs.listSftpJobs().find(item => item.id === macProgressTask.id).progress, 100);
  assert.equal(session.releaseNativeSftpDragTicket(macProgressTicket.token), true);

  const macDirectoryTicket = session.reserveNativeSftpDragTicket(123, ["/root/folder"], {
    platform:"darwin",
    entries:[{path:"/root/folder", name:"mac-folder", type:"directory", size:0, metadataKnown:true}]
  });
  const macDirectoryTask = jobs.beginNativeSftpDragJob(macDirectoryTicket.token, macDirectoryTicket);
  const pendingMacDirectory = jobs.listSftpJobs().find(item => item.id === macDirectoryTask.id);
  assert.equal(pendingMacDirectory.size, 0);
  assert.equal(pendingMacDirectory.size_known, false, "a directory stays indeterminate until its recursive manifest size is known");
  assert.equal(pendingMacDirectory.progress_known, false);
  assert.deepEqual(jobs.discardNativeSftpDragJob(macDirectoryTicket.token), {ok:true, status:"discarded"});
  assert.equal(session.releaseNativeSftpDragTicket(macDirectoryTicket.token), true);

  const internalTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"win32",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const internalManifest = await session.getNativeSftpDragTicket(internalTicket.token);
  const internalTask = jobs.beginNativeSftpDragJob(internalTicket.token, internalManifest);
  const internalTaskStream = new (require("node:stream").PassThrough)();
  jobs.trackNativeSftpDragStream(internalTicket.token, 0, {stream:internalTaskStream, start:0});
  assert.deepEqual(jobs.discardNativeSftpDragJob(internalTicket.token), {ok:true, status:"discarded"});
  assert.equal(internalTaskStream.destroyed, true, "an internal SFTP drop must stop accidental local extraction");
  assert.equal(jobs.listSftpJobs().some(item => item.id === internalTask.id), false, "an internal SFTP drop must not leave a local drag task");
  assert.equal((await session.getNativeSftpDragTicket(internalTicket.token)).token, internalTicket.token, "the desktop session owns ticket cleanup after discarding the task");
  assert.equal(session.releaseNativeSftpDragTicket(internalTicket.token), true);

  const lateReadTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"win32",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const lateReadManifest = await session.getNativeSftpDragTicket(lateReadTicket.token);
  assert.deepEqual(jobs.discardNativeSftpDragJob(lateReadTicket.token), {ok:true, status:"discarded"});
  assert.deepEqual(
    jobs.beginNativeSftpDragJob(lateReadTicket.token, lateReadManifest),
    {id:"", status:"discarded"},
    "a late Windows content request must not recreate a local drag task after an internal drop"
  );
  assert.equal(
    jobs.listSftpJobs().some(item => item.native_drag_token === lateReadTicket.token),
    false,
    "discarded internal drags must not appear as local downloads"
  );
  assert.equal(session.releaseNativeSftpDragTicket(lateReadTicket.token), true);

  const cancelledTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"win32",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const cancelledManifest = await session.getNativeSftpDragTicket(cancelledTicket.token);
  const cancelledTask = jobs.beginNativeSftpDragJob(cancelledTicket.token, cancelledManifest);
  const activeTaskStream = new (require("node:stream").PassThrough)();
  jobs.trackNativeSftpDragStream(cancelledTicket.token, 0, {stream:activeTaskStream, start:0});
  const cancelledNativeTokens = [];
  jobs.setNativeSftpDragCancelHandler(token => {
    cancelledNativeTokens.push(token);
    return true;
  });
  assert.deepEqual(
    jobs.cancelSftpJob(cancelledTask.id),
    {ok:true, status:"running", phase:"cancelling", can_cancel:false},
    "accepted native cancellation must wait for the target's terminal callback"
  );
  jobs.setNativeSftpDragCancelHandler(null);
  assert.deepEqual(cancelledNativeTokens, [cancelledTicket.token], "cancelling the task must notify the native drag helper exactly once");
  assert.equal(activeTaskStream.destroyed, false, "accepted cancellation must not turn an in-flight target read into an I/O fault");
  assert.equal((await session.getNativeSftpDragTicket(cancelledTicket.token)).token, cancelledTicket.token, "ticket must remain valid until native cancellation is confirmed");
  const cancellingState = jobs.listSftpJobs().find(item => item.id === cancelledTask.id);
  assert.equal(cancellingState.status, "running");
  assert.equal(cancellingState.phase, "cancelling");
  assert.equal(cancellingState.can_cancel, false);
  assert.deepEqual(jobs.finishNativeSftpDragJob(cancelledTicket.token, "cancelled"), {ok:true, status:"cancelled"});
  assert.equal(activeTaskStream.destroyed, true, "the terminal cancellation callback may now close remaining SFTP streams");
  assert.equal(session.releaseNativeSftpDragTicket(cancelledTicket.token), true, "the desktop session releases the ticket after terminal cancellation");
  assert.equal(jobs.listSftpJobs().find(item => item.id === cancelledTask.id).status, "cancelled");

  const rejectedTicket = session.reserveNativeSftpDragTicket(123, ["/root/report.txt"], {
    platform:"darwin",
    entries:[{path:"/root/report.txt", name:"report.txt", type:"file"}]
  });
  const rejectedManifest = await session.getNativeSftpDragTicket(rejectedTicket.token);
  const rejectedTask = jobs.beginNativeSftpDragJob(rejectedTicket.token, rejectedManifest);
  const rejectedStream = new (require("node:stream").PassThrough)();
  jobs.trackNativeSftpDragStream(rejectedTicket.token, 0, {stream:rejectedStream, start:0});
  jobs.setNativeSftpDragCancelHandler(() => false);
  const rejectedResult = jobs.cancelSftpJob(rejectedTask.id);
  jobs.setNativeSftpDragCancelHandler(null);
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejectedResult.code, "NATIVE_DRAG_CANCEL_REJECTED");
  assert.equal(rejectedStream.destroyed, false, "a rejected native cancellation must leave the target read intact");
  assert.equal((await session.getNativeSftpDragTicket(rejectedTicket.token)).token, rejectedTicket.token);
  assert.equal(jobs.listSftpJobs().find(item => item.id === rejectedTask.id).status, "running");
  assert.deepEqual(jobs.finishNativeSftpDragJob(rejectedTicket.token, "cancelled"), {ok:true, status:"cancelled"});
  assert.equal(session.releaseNativeSftpDragTicket(rejectedTicket.token), true);

  console.log("SFTP native drag ticket check passed.");
} finally {
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
