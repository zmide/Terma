"use strict";
const assert = require("node:assert/strict");
const vm = require('node:vm');
const {loadFrontendService}=require('./frontend-service-test-helper');

const refreshes = [];
const runtimes = new Map([
  ["desktop", {path:"C:\\Files"}],
  ["device", {fileSource:"server", path:"/drive/Files", displayPath:"C:\\Files"}],
  ["alias", {fileSource:"server", path:"/workspace", displayPath:"c:/files/"}],
  ["away", {fileSource:"server", path:"/drive/Other", displayPath:"C:\\Other"}],
  ["navigating", {fileSource:"server", path:"/drive/Files", displayPath:"C:\\Files", webLoading:true, webRequestedPath:"/drive/Other"}],
  ["native-navigating", {path:"C:\\Files",loading:true,webRequestedPath:"C:\\Other"}],
  ["browser", {fileSource:"browser", path:"/browser", displayPath:"Files"}]
]);
const context = vm.createContext({ sftpKnownJobStatuses:new Map(), sftpLatestJobs:[],
  SFTP_ACTIVE_JOB_STATUSES:new Set(["pending","running"]), SFTP_MUTATING_JOB_TYPES:new Set(["upload","local-delivery"]),
  sftpPendingBrowserDownloads:new Set(),
  queueSftpDirectoryRefresh:() => {}, flushPendingSftpDirectoryRefresh:() => {}, updateSftpTaskCenter:() => {}
});
const delivery=loadFrontendService('frontend/src/features/files/file-delivery-refresh.ts');
const owner=delivery.createFileDeliveryRefresh({states:()=>runtimes.entries(),load:key=>refreshes.push(key),failed:error=>{throw error;}});
const {createSftpTransferLifecycle}=loadFrontendService('frontend/src/features/files/sftp/transfer-lifecycle.ts',{window:{},document:{}});
const lifecycle=createSftpTransferLifecycle({
  jobs:()=>context.sftpLatestJobs,localDelivery:owner.refresh,changed:()=>{},polling:{},
  directories:{runtimes:()=>[],state:()=>null,refresh:()=>Promise.resolve(),failed:error=>{throw error;}}
});
context.window={termaSftpTransferLifecycle:lifecycle};
const transfers=loadFrontendService('frontend/src/features/files/sftp/transfer-controller.ts').createSftpTransferController({
  track:job=>lifecycle.completion.track(job),pendingDownloads:context.sftpPendingBrowserDownloads
});

for (const type of ["local-delivery", "download"]) {
  refreshes.length = 0;
  const running = {id:type, type, status:"running", connection_id:9};
  context.sftpLatestJobs = [running];
  lifecycle.completion.track(running);
  owner.track(running, "device", "/drive/Files");
  owner.refresh(running);
  assert(owner.targets.has(type), "An in-progress poll must retain the registered destination");
  assert(lifecycle.completion.settle({level:"success",action:{sftp_job_id:type}}));
  assert.equal(refreshes.length, 0, "A notification without authoritative save metadata must wait for the poll");
  const done = {...running, status:"done", delivery_status:"saved", saved_path:type === "download" ? "C:\\Files\\a (1).txt" : "C:\\Files", target_directory:type === "local-delivery" ? "C:\\Files" : undefined};
  lifecycle.completion.observe([done]);
  assert.deepEqual(refreshes.sort(), ["alias", "desktop", "device"], "Refresh every matching physical destination, without navigating other panes");
  assert.equal(owner.targets.has(type), false);
  lifecycle.completion.observe([done]);
  assert.equal(refreshes.length, 3, "Repeated completed polls must not repeatedly refresh directories");
}
refreshes.length = 0;
transfers.track({id:"fast", type:"download", status:"done",delivery_mode:"desktop"});
lifecycle.completion.observe([{id:"fast",type:"download",status:"done",delivery_status:"saved",saved_path:"C:/Files/fast.txt"}]);
assert.equal(refreshes.length, 3, "A download completed before its initial response must still refresh");
refreshes.length = 0;
lifecycle.completion.observe([{id:"history",type:"download",status:"done",delivery_status:"saved",saved_path:"C:/Files/history.txt"}]);
assert.equal(refreshes.length, 0, "Initial history must not trigger an unsolicited refresh");
lifecycle.completion.track({id:"failed",status:"running"});
owner.track({id:"failed"}, "device", "/drive/Files");
lifecycle.completion.observe([{id:"failed",type:"local-delivery",status:"failed",target_directory:"C:/Files"}]);
assert.equal(refreshes.length, 0);
assert.equal(owner.targets.has("failed"), false);
assert.notEqual(delivery.deliveryPathKey("/Files"), delivery.deliveryPathKey("/files"));
assert.equal(delivery.deliveryPathKey("C:\\Files\\"), delivery.deliveryPathKey("c:/files"));
assert.equal(delivery.deliveryPathKey("\\\\Server\\Files\\"), delivery.deliveryPathKey("//server/files"));
console.log("Local delivery refresh passed: notification-first order, fast completion, physical aliases, multiple panes, navigation, history and failures");
