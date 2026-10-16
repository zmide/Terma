"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript-legacy");

function functions(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert(declaration, `Missing ${name}`);
    return declaration.getText(source);
  }).join("\n");
}
const refreshes = [];
const runtimes = new Map([
  ["desktop", {path:"C:\\Files"}],
  ["device", {fileSource:"server", path:"/drive/Files", displayPath:"C:\\Files"}],
  ["alias", {fileSource:"server", path:"/workspace", displayPath:"c:/files/"}],
  ["away", {fileSource:"server", path:"/drive/Other", displayPath:"C:\\Other"}],
  ["navigating", {fileSource:"server", path:"/drive/Files", displayPath:"C:\\Files", webLoading:true, webRequestedPath:"/drive/Other"}],
  ["browser", {fileSource:"browser", path:"/browser", displayPath:"Files"}]
]);
const context = vm.createContext({
  localFileRuntimes:runtimes, localDeliveryJobTargets:new Map(), sftpKnownJobStatuses:new Map(), sftpLatestJobs:[],
  SFTP_ACTIVE_JOB_STATUSES:new Set(["pending","running"]), SFTP_MUTATING_JOB_TYPES:new Set(["upload","local-delivery"]),
  sftpPendingBrowserDownloads:new Set(),
  loadLocalFiles:key => refreshes.push(key), loadWebFiles:key => refreshes.push(key),
  webFilesRuntime:key => runtimes.get(key)?.fileSource ? runtimes.get(key) : null,
  queueSftpDirectoryRefresh:() => {}, flushPendingSftpDirectoryRefresh:() => {}, updateSftpTaskCenter:() => {}
});
vm.runInContext(functions("public/app-local-files.js", ["localDeliveryPathKey", "localDeliveryJobDirectory", "trackLocalDeliveryJobTarget", "refreshLocalFilesForDeliveryJob"]), context);
const web = fs.readFileSync("public/app-web-files.js", "utf8");
vm.runInContext(web.slice(web.indexOf("const refreshWebFilesForJobBase="), web.indexOf("function navigateWebFilesHistory")), context);
vm.runInContext(functions("public/app-sftp-tasks.js", ["trackSftpMutationJob", "settleSftpJobFromNotification", "completedSftpMutationForCurrentView"]), context);
vm.runInContext(functions("public/app-sftp-transfer.js", ["trackSftpBrowserDownload"]), context);

for (const type of ["local-delivery", "download"]) {
  refreshes.length = 0;
  const running = {id:type, type, status:"running", connection_id:9};
  context.sftpLatestJobs = [running];
  context.trackSftpMutationJob(running);
  context.trackLocalDeliveryJobTarget(running, "device", "/drive/Files");
  context.refreshLocalFilesForDeliveryJob(running);
  assert(context.localDeliveryJobTargets.has(type), "An in-progress poll must retain the registered destination");
  assert(context.settleSftpJobFromNotification({level:"success",action:{sftp_job_id:type}}));
  assert.equal(refreshes.length, 0, "A notification without authoritative save metadata must wait for the poll");
  const done = {...running, status:"done", delivery_status:"saved", saved_path:type === "download" ? "C:\\Files\\a (1).txt" : "C:\\Files", target_directory:type === "local-delivery" ? "C:\\Files" : undefined};
  context.completedSftpMutationForCurrentView([done]);
  assert.deepEqual(refreshes.sort(), ["alias", "desktop", "device"], "Refresh every matching physical destination, without navigating other panes");
  assert.equal(context.localDeliveryJobTargets.has(type), false);
  context.completedSftpMutationForCurrentView([done]);
  assert.equal(refreshes.length, 3, "Repeated completed polls must not repeatedly refresh directories");
}
refreshes.length = 0;
context.trackSftpBrowserDownload({id:"fast", type:"download", status:"done",delivery_mode:"desktop"});
context.completedSftpMutationForCurrentView([{id:"fast",type:"download",status:"done",delivery_status:"saved",saved_path:"C:/Files/fast.txt"}]);
assert.equal(refreshes.length, 3, "A download completed before its initial response must still refresh");
refreshes.length = 0;
context.completedSftpMutationForCurrentView([{id:"history",type:"download",status:"done",delivery_status:"saved",saved_path:"C:/Files/history.txt"}]);
assert.equal(refreshes.length, 0, "Initial history must not trigger an unsolicited refresh");
context.trackSftpMutationJob({id:"failed",status:"running"});
context.trackLocalDeliveryJobTarget({id:"failed"}, "device", "/drive/Files");
context.completedSftpMutationForCurrentView([{id:"failed",type:"local-delivery",status:"failed",target_directory:"C:/Files"}]);
assert.equal(refreshes.length, 0);
assert.equal(context.localDeliveryJobTargets.has("failed"), false);
assert.notEqual(context.localDeliveryPathKey("/Files"), context.localDeliveryPathKey("/files"));
assert.equal(context.localDeliveryPathKey("C:\\Files\\"), context.localDeliveryPathKey("c:/files"));
assert.equal(context.localDeliveryPathKey("\\\\Server\\Files\\"), context.localDeliveryPathKey("//server/files"));
console.log("Local delivery refresh passed: notification-first order, fast completion, physical aliases, multiple panes, navigation, history and failures");
