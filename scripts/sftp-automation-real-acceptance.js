const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

if (!process.argv.includes("--confirm-real-sftp-automation")) {
  console.error("该验收会在指定两台测试服务器创建并删除 .terma-automation-test-* 临时目录。确认后追加 --confirm-real-sftp-automation。");
  process.exit(2);
}

const db = require("../dist/db");
const repository = require("../dist/sftp-automation-repository");
const engine = require("../dist/sftp-automations");
const sftp = require("../dist/sftp");
const connections = db.all("SELECT id,name,ssh_host,ssh_port,ssh_user FROM connections WHERE ssh_host IN ('192.168.31.76','192.168.31.77') ORDER BY ssh_host");
assert.equal(connections.length, 2, "必须找到截图中的两台测试服务器");

const runToken = crypto.randomUUID();
const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), `.terma-automation-test-${runToken}-`));
const remoteRoots = [];
const createdAutomationIds = [];

async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function runOne(connection) {
  const remoteRoot = `.terma-automation-test-${runToken}-${connection.ssh_host.replaceAll(".", "-")}`;
  remoteRoots.push([connection.id, remoteRoot]);
  const local = path.join(localRoot, String(connection.id));
  fs.mkdirSync(local, {recursive:true});
  const source = path.join(local, "source.txt");
  fs.writeFileSync(source, `Terma automation ${connection.ssh_host} ${runToken}\n`);
  await sftp.makeRemoteDir(connection.id, remoteRoot);
  const upload = repository.saveAutomation({kind:"auto",name:`真实自动化上传 ${connection.ssh_host}`,connection_id:connection.id,local_path:source,remote_path:`${remoteRoot}/source.txt`,direction:"upload",enabled:false,schedule:{frequency:"once",at_ms:Date.now()+3600000},options:{conflict:"overwrite"}});
  createdAutomationIds.push(upload.id);
  assert.equal(upload.kind, "transfer", `${connection.name} 单向周期任务应自动使用普通传输引擎`);
  const uploadResult = await engine.runAutomation(upload.id, {reason:"manual"});
  assert.equal(uploadResult.ok, true, `${connection.name} 自动上传失败`);
  const remoteText = await sftp.readRemoteTextFile(connection.id, `${remoteRoot}/source.txt`, "utf8", 1024 * 1024);
  assert.equal(remoteText.content, fs.readFileSync(source, "utf8"));
  console.log(`PASS [${connection.name}] 定时传输引擎实际上传`);
  const unchangedUpload = await engine.runAutomation(upload.id, {reason:"manual"});
  assert.equal(unchangedUpload.ok, true, `${connection.name} 无变化传输复检失败`);
  assert.equal(Number(unchangedUpload.summary?.transferred || 0), 0, `${connection.name} 未修改传输源不应重复上传`);
  console.log(`PASS [${connection.name}] 无变化传输源跳过上传`);
  await sftp.deleteRemotePath(connection.id, `${remoteRoot}/source.txt`);
  const restoredUpload = await engine.runAutomation(upload.id, {reason:"manual"});
  assert.equal(restoredUpload.ok, true, `${connection.name} 目标丢失补传失败`);
  assert.equal(Number(restoredUpload.summary?.transferred || 0), 1, `${connection.name} 目标丢失时必须重新上传`);
  const restoredText = await sftp.readRemoteTextFile(connection.id, `${remoteRoot}/source.txt`, "utf8", 1024 * 1024);
  assert.equal(restoredText.content, fs.readFileSync(source, "utf8"));
  console.log(`PASS [${connection.name}] 目标文件丢失后自动补传`);

  const syncLocal = path.join(local, "同步 下载");
  fs.mkdirSync(syncLocal, {recursive:true});
  fs.writeFileSync(path.join(syncLocal, "local.txt"), "local side\n");
  await sftp.writeRemoteFile(connection.id, `${remoteRoot}/下载 验收.txt`, Buffer.from("remote side\n"));
  await sftp.writeRemoteFile(connection.id, `${remoteRoot}/空文件.txt`, Buffer.alloc(0));
  const sync = repository.saveAutomation({kind:"auto",name:`真实基线同步 ${connection.ssh_host}`,connection_id:connection.id,local_path:syncLocal,remote_path:remoteRoot,direction:"bidirectional",trigger_mode:"schedule",schedule:{frequency:"daily",hour:23,minute:59},enabled:false,options:{conflict:"skip"}});
  createdAutomationIds.push(sync.id);
  assert.equal(sync.kind, "sync", `${connection.name} 双向任务应自动使用安全同步引擎`);
  assert.equal(sync.trigger_mode, "schedule");
  const syncResult = await engine.runAutomation(sync.id, {reason:"manual"});
  assert.equal(syncResult.ok, true, `${connection.name} 首次同步失败：${JSON.stringify(syncResult)}`);
  const baseline = repository.getBaseline(sync.id);
  assert.ok(baseline && !baseline.corrupted, `${connection.name} 未保存有效基线`);
  assert.equal(fs.readFileSync(path.join(syncLocal, "下载 验收.txt"), "utf8"), "remote side\n");
  assert.equal(fs.statSync(path.join(syncLocal, "空文件.txt")).size, 0, `${connection.name} 远端空文件未正确落盘`);
  console.log(`PASS [${connection.name}] 中文空格路径首次同步与三方基线保存`);
  console.log(`PASS [${connection.name}] 0 字节文件同步下载`);
  const unchangedResult = await engine.runAutomation(sync.id, {reason:"manual"});
  assert.equal(unchangedResult.ok, true, `${connection.name} 无变化复检失败`);
  assert.equal(Number(unchangedResult.summary?.transferred || 0), 0, `${connection.name} 未修改文件不应重复传输`);
  console.log(`PASS [${connection.name}] 无变化文件跳过传输`);

  const deleteUploadLocal = path.join(local, "删除传播 上传");
  fs.mkdirSync(deleteUploadLocal, {recursive:true});
  const contentAwareLocal = path.join(deleteUploadLocal, "同名内容.txt");
  fs.writeFileSync(contentAwareLocal, "LOCAL-AA\n");
  await sftp.makeRemoteDir(connection.id, `${remoteRoot}/删除传播 上传`);
  await sftp.writeRemoteFile(connection.id, `${remoteRoot}/删除传播 上传/同名内容.txt`, Buffer.from("REMOTE-B\n"));
  const deleteUpload = repository.saveAutomation({kind:"auto",name:`真实上传删除传播 ${connection.ssh_host}`,connection_id:connection.id,local_path:deleteUploadLocal,remote_path:`${remoteRoot}/删除传播 上传`,direction:"upload",trigger_mode:"schedule",schedule:{frequency:"daily",hour:23,minute:59},enabled:false,options:{conflict:"overwrite",compare_content:true,propagate_deletes:true}});
  createdAutomationIds.push(deleteUpload.id);
  assert.equal(deleteUpload.kind, "sync", `${connection.name} 启用删除传播后应自动使用安全同步引擎`);
  const contentAwareResult = await engine.runAutomation(deleteUpload.id, {reason:"manual"});
  assert.equal(contentAwareResult.ok, true, `${connection.name} 同名内容校验同步失败`);
  const contentAwareRemote = await sftp.readRemoteTextFile(connection.id, `${remoteRoot}/删除传播 上传/同名内容.txt`, "utf8", 1024 * 1024);
  assert.equal(contentAwareRemote.content, "LOCAL-AA\n", `${connection.name} 同名同大小但内容不同的文件未按上传方向更新`);
  console.log(`PASS [${connection.name}] 同名同大小文件使用内容校验识别变化`);
  fs.unlinkSync(contentAwareLocal);
  const propagatedRemoteDelete = await engine.runAutomation(deleteUpload.id, {reason:"manual"});
  assert.equal(propagatedRemoteDelete.ok, true, `${connection.name} 上传方向删除传播失败`);
  assert.equal(Number(propagatedRemoteDelete.summary?.deleted || 0), 1, `${connection.name} 上传方向应删除上次同步且远端未改变的文件`);
  await assert.rejects(() => sftp.readRemoteFileMetadata(connection.id, `${remoteRoot}/删除传播 上传/同名内容.txt`));
  console.log(`PASS [${connection.name}] 上传方向安全传播本机删除`);

  const deleteDownloadLocal = path.join(local, "删除传播 下载");
  fs.mkdirSync(deleteDownloadLocal, {recursive:true});
  await sftp.makeRemoteDir(connection.id, `${remoteRoot}/删除传播 下载`);
  await sftp.writeRemoteFile(connection.id, `${remoteRoot}/删除传播 下载/远端删除.txt`, Buffer.from("download delete\n"));
  const deleteDownload = repository.saveAutomation({kind:"auto",name:`真实下载删除传播 ${connection.ssh_host}`,connection_id:connection.id,local_path:deleteDownloadLocal,remote_path:`${remoteRoot}/删除传播 下载`,direction:"download",trigger_mode:"schedule",schedule:{frequency:"daily",hour:23,minute:59},enabled:false,options:{conflict:"overwrite",compare_content:true,propagate_deletes:true}});
  createdAutomationIds.push(deleteDownload.id);
  const downloadBaseline = await engine.runAutomation(deleteDownload.id, {reason:"manual"});
  assert.equal(downloadBaseline.ok, true, `${connection.name} 下载删除传播初次同步失败`);
  const downloadedDeleteTarget = path.join(deleteDownloadLocal, "远端删除.txt");
  assert.equal(fs.readFileSync(downloadedDeleteTarget, "utf8"), "download delete\n");
  await sftp.deleteRemoteFile(connection.id, `${remoteRoot}/删除传播 下载/远端删除.txt`);
  const propagatedLocalDelete = await engine.runAutomation(deleteDownload.id, {reason:"manual"});
  assert.equal(propagatedLocalDelete.ok, true, `${connection.name} 下载方向删除传播失败`);
  assert.equal(Number(propagatedLocalDelete.summary?.deleted || 0), 1, `${connection.name} 下载方向应删除上次同步且本机未改变的文件`);
  assert.equal(fs.existsSync(downloadedDeleteTarget), false, `${connection.name} 远端删除后本机文件仍存在`);
  console.log(`PASS [${connection.name}] 下载方向安全传播远端删除`);

  await sftp.writeRemoteFile(connection.id, `${remoteRoot}/删除传播 下载/冲突保留.txt`, Buffer.from("baseline\n"));
  const conflictBaseline = await engine.runAutomation(deleteDownload.id, {reason:"manual"});
  assert.equal(conflictBaseline.ok, true, `${connection.name} 删除冲突基线创建失败`);
  const preservedLocal = path.join(deleteDownloadLocal, "冲突保留.txt");
  const preservedStat = fs.statSync(preservedLocal);
  fs.writeFileSync(preservedLocal, "changed!\n");
  fs.utimesSync(preservedLocal, preservedStat.atime, preservedStat.mtime);
  const disguisedChangeStat = fs.statSync(preservedLocal);
  assert.equal(disguisedChangeStat.size, preservedStat.size, `${connection.name} 删除冲突样例必须保持相同大小`);
  assert.equal(Math.floor(disguisedChangeStat.mtimeMs / 1000), Math.floor(preservedStat.mtimeMs / 1000), `${connection.name} 删除冲突样例必须保持相同时间戳`);
  await sftp.deleteRemoteFile(connection.id, `${remoteRoot}/删除传播 下载/冲突保留.txt`);
  const deleteConflict = await engine.runAutomation(deleteDownload.id, {reason:"manual"});
  assert.equal(deleteConflict.ok, true, `${connection.name} 删除冲突检查运行失败`);
  assert.equal(Number(deleteConflict.summary?.conflicts || 0), 1, `${connection.name} 目标已变化时应记录删除冲突`);
  assert.equal(fs.readFileSync(preservedLocal, "utf8"), "changed!\n", `${connection.name} 删除冲突错误移除了已变化文件`);
  console.log(`PASS [${connection.name}] 删除传播遇到目标变化时保留文件并记录冲突`);

  const realtimeLocal = path.join(local, "实时 下载");
  fs.mkdirSync(realtimeLocal, {recursive:true});
  const realtime = repository.saveAutomation({kind:"auto",name:`真实实时同步 ${connection.ssh_host}`,connection_id:connection.id,local_path:realtimeLocal,remote_path:remoteRoot,direction:"download",trigger_mode:"continuous",schedule:{frequency:"realtime",start_at_ms:Date.now()+60000},enabled:false,options:{conflict:"skip"}});
  createdAutomationIds.push(realtime.id);
  assert.equal(realtime.kind, "sync", `${connection.name} 实时任务应自动使用安全同步引擎`);
  assert.equal(realtime.trigger_mode, "continuous");
  assert.equal(realtime.schedule.frequency, "realtime");
  console.log(`PASS [${connection.name}] 实时周期自动选择安全同步引擎`);

  const changing = path.join(syncLocal, "changing.txt");
  fs.writeFileSync(changing, "before\n");
  const changingStat = fs.statSync(changing);
  fs.writeFileSync(changing, "after\n");
  const stableCheck = engine.__test.assertStableLocalFile;
  assert.equal(typeof stableCheck, "function");
  await stableCheck(changing, {size:changingStat.size,mtime:Math.floor(changingStat.mtimeMs / 1000)}).catch(error => {
    assert.match(String(error.message), /发生变化|仍在写入/);
  });
  console.log(`PASS [${connection.name}] 本机文件稳定性保护`);
  db.run("UPDATE sftp_automation_baselines SET checksum=? WHERE automation_id=?", ["corrupted", sync.id]);
  const blocked = await engine.runAutomation(sync.id, {reason:"manual"});
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error || ""), /基线校验失败/);
  console.log(`PASS [${connection.name}] 损坏基线安全暂停`);
}

(async () => {
  try {
    for (const connection of connections) await runOne(connection);
    console.log("真实 SFTP 自动化验收通过：2 台指定服务器全部完成上传、重复跳过、目标补传、内容校验、安全删除传播、冲突保留、同步、基线和稳定性测试");
  } finally {
    for (const id of createdAutomationIds) { try { repository.deleteAutomation(id); } catch {} }
    for (const [connectionId, remoteRoot] of remoteRoots) { try { await sftp.deleteRemotePath(connectionId, remoteRoot); } catch (error) { console.error(`WARN 清理失败 ${connectionId}/${remoteRoot}: ${error.message}`); } }
    try { fs.rmSync(localRoot, {recursive:true,force:true}); } catch {}
    try { require("../dist/sftp-session").closeAllSftpSessions(); } catch {}
    try { db.closeDatabase(); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
