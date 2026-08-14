"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function recorder() {
  const sent = [];
  return {
    response:{},
    sent,
    sendJson:(_response, data, status=200) => sent.push({data, status})
  };
}

async function checkConfigTransferRoutes() {
  const { handleConfigTransferRoutes } = require(path.join(root, "dist", "routes", "config-transfer-routes.js"));
  const calls = [];
  let json = {};
  const output = recorder();
  const dependencies = {
    defaultExtraArgs:["-o", "ConnectTimeout=8"],
    batchTest:async tunnels => ({tested:tunnels.length}),
    createConfigSnapshot:reason => calls.push(["snapshot", reason]),
    exportConfig:ids => ids ? `selected:${ids.join(",")}` : "all",
    getPart:(_contentType, body, name) => {
      calls.push(["part", body.toString("utf8"), name]);
      return {filename:"fixture.conf", data:Buffer.from("Host fixture")};
    },
    parseConfigText:text => ({count:text.length, tunnels:[]}),
    readBody:async () => Buffer.from("multipart"),
    readJson:async () => json,
    saveImported:(tunnels, extraArgs) => {
      calls.push(["save", tunnels, extraArgs]);
      return {saved:tunnels.length};
    },
    sendJson:output.sendJson
  };

  assert.equal(await handleConfigTransferRoutes({method:"GET", headers:{}}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleConfigTransferRoutes({method:"GET", headers:{}}, output.response, "/api/export/config", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{config:"all"}, status:200});

  assert.equal(await handleConfigTransferRoutes({method:"POST", headers:{"content-type":"multipart/form-data"}}, output.response, "/api/import/parse", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{count:12, tunnels:[], filename:"fixture.conf"}, status:200});
  assert.deepEqual(calls.shift(), ["part", "multipart", "config"]);

  json = {text:"Host pasted", filename:"pasted.conf"};
  assert.equal(await handleConfigTransferRoutes({method:"POST", headers:{}}, output.response, "/api/import/parse-text", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{count:11, tunnels:[], filename:"pasted.conf"}, status:200});

  json = {tunnels:[{name:"one"}, {name:"two"}]};
  assert.equal(await handleConfigTransferRoutes({method:"POST", headers:{}}, output.response, "/api/import/test", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{tested:2}, status:200});

  json = {tunnels:[{name:"fixture"}]};
  assert.equal(await handleConfigTransferRoutes({method:"POST", headers:{}}, output.response, "/api/import/save", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{saved:1}, status:201});
  assert.deepEqual(calls.shift(), ["snapshot", "批量导入前自动快照"]);
  assert.deepEqual(calls.shift(), ["save", json.tunnels, dependencies.defaultExtraArgs]);

  json = {ids:[3, 7]};
  assert.equal(await handleConfigTransferRoutes({method:"POST", headers:{}}, output.response, "/api/export/config", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{config:"selected:3,7"}, status:200});
}

async function checkSftpDesktopDownloadRoutes() {
  const { handleSftpDesktopDownloadRoutes } = require(path.join(root, "dist", "routes", "sftp-desktop-download-routes.js"));
  const output = recorder();
  const calls = [];
  let desktopRequest = false;
  let json = {};
  const jobs = [{id:"job-1", type:"download", delivery_status:"saved", saved_path:"C:/Downloads/fixture.txt"}];
  const desktopIntegration = {
    getDownloadDirectory:() => "C:/Users/demo/Downloads",
    chooseDownloadDirectory:() => "D:/Terma",
    openDownloadDirectory:directory => {
      calls.push(["open-directory", directory]);
      return {opened:directory};
    },
    openLocalPath:file => {
      calls.push(["open-file", file]);
      return {opened:file};
    }
  };
  const dependencies = {
    runtimeSettingsFile:"runtime.json",
    getDesktopIntegration:() => desktopIntegration,
    isDesktopRequest:() => desktopRequest,
    listSftpJobs:() => jobs,
    readJson:async () => json,
    readRuntimeSettings:() => ({sftp_download_directory:"D:/Saved"}),
    sendJson:output.sendJson
  };

  assert.equal(await handleSftpDesktopDownloadRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"GET"}, output.response, "/api/sftp/download-settings", dependencies), true);
  assert.equal(output.sent.pop().data.delivery_mode, "browser");

  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/choose", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"目录选择仅能在本机桌面端中使用"}, status:403});

  desktopRequest = true;
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"GET"}, output.response, "/api/sftp/download-settings", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{
    delivery_mode:"desktop",
    configured_directory:"D:/Saved",
    default_directory:"C:/Users/demo/Downloads",
    effective_directory:"D:/Saved",
    can_choose_directory:true,
    can_open_directory:true
  }, status:200});

  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/choose", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{path:"D:/Terma"}, status:200});

  json = {job_id:"job-1"};
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/open", dependencies), true);
  assert.deepEqual(calls.shift(), ["open-directory", "C:/Downloads"]);
  assert.deepEqual(output.sent.pop(), {data:{opened:"C:/Downloads"}, status:200});
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/open-file", dependencies), true);
  assert.deepEqual(calls.shift(), ["open-file", "C:/Downloads/fixture.txt"]);
  assert.deepEqual(output.sent.pop(), {data:{opened:"C:/Downloads/fixture.txt"}, status:200});

  json = {job_id:"missing"};
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/open-file", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"下载文件不存在或已被清理"}, status:404});
}

async function checkSftpJobRoutes() {
  const { handleSftpJobRoutes } = require(path.join(root, "dist", "routes", "sftp-job-routes.js"));
  const output = recorder();
  const calls = [];
  let uploadCancelled = false;
  const sftpJobs = {
    cancelSftpJob:id => ({action:"cancel", id}),
    clearFinishedSftpJobs:() => ({cleared:"sftp"}),
    deleteSftpJob:id => ({action:"delete", id}),
    getSftpJobFile:id => {
      calls.push(["get-file", id]);
      return {name:"report 1.txt", path:"C:/cache/report-1.txt"};
    },
    listSftpJobs:() => [{id:"job-1"}],
    markSftpJobDelivered:id => calls.push(["delivered", id]),
    pauseSftpJob:id => ({action:"pause", id}),
    receiveUploadJobContent:async (id, request) => {
      calls.push(["content", id, request]);
      if (uploadCancelled) throw Object.assign(new Error("cancelled"), {code:"SFTP_UPLOAD_CANCELLED"});
      return {received:id};
    },
    resumeSftpJob:id => ({action:"resume", id})
  };
  const syncJobs = {
    cancelSyncJob:id => ({action:"cancel-sync", id}),
    clearFinishedSyncJobs:() => ({cleared:"sync"}),
    deleteSyncJob:id => ({action:"delete-sync", id}),
    getSyncJob:id => ({id, type:"sync"}),
    listSyncJobs:() => [{id:"sync-1"}],
    retrySyncJob:id => ({action:"retry-sync", id})
  };
  const dependencies = {sendJson:output.sendJson, sftpJobs, syncJobs};

  assert.equal(await handleSftpJobRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleSftpJobRoutes({method:"GET"}, output.response, "/api/sftp/jobs", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:[{id:"job-1"}], status:200});
  assert.equal(await handleSftpJobRoutes({method:"POST"}, output.response, "/api/sftp/jobs/clear-finished", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{cleared:"sftp"}, status:200});

  const uploadRequest = {method:"PUT"};
  assert.equal(await handleSftpJobRoutes(uploadRequest, output.response, "/api/sftp/jobs/job-1/content", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{received:"job-1"}, status:202});
  assert.deepEqual(calls.pop(), ["content", "job-1", uploadRequest]);
  uploadCancelled = true;
  assert.equal(await handleSftpJobRoutes(uploadRequest, output.response, "/api/sftp/jobs/job-1/content", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, status:"cancelled"}, status:409});
  uploadCancelled = false;

  for (const [pathname, method, expected] of [
    ["/api/sftp/jobs/job-1/cancel", "POST", {action:"cancel", id:"job-1"}],
    ["/api/sftp/jobs/job-1/pause", "POST", {action:"pause", id:"job-1"}],
    ["/api/sftp/jobs/job-1/resume", "POST", {action:"resume", id:"job-1"}],
    ["/api/sftp/jobs/job-1", "DELETE", {action:"delete", id:"job-1"}]
  ]) {
    assert.equal(await handleSftpJobRoutes({method}, output.response, pathname, dependencies), true);
    assert.deepEqual(output.sent.pop(), {data:expected, status:200});
  }

  const responseEvents = {};
  const streamEvents = {};
  const fetchResponse = {
    on:(event, listener) => { responseEvents[event] = listener; return fetchResponse; },
    writeHead:(status, headers) => calls.push(["headers", status, headers])
  };
  const stream = {
    on:(event, listener) => { streamEvents[event] = listener; return stream; },
    pipe:response => calls.push(["pipe", response])
  };
  const fetchDependencies = {
    ...dependencies,
    createReadStream:file => {
      calls.push(["read-stream", file]);
      return stream;
    },
    statFile:file => {
      calls.push(["stat", file]);
      return {size:42};
    }
  };
  assert.equal(await handleSftpJobRoutes({method:"GET"}, fetchResponse, "/api/sftp/jobs/job-1/fetch", fetchDependencies), true);
  assert.equal(calls.some(call => call[0] === "delivered"), false);
  responseEvents.finish();
  assert.equal(calls.some(call => call[0] === "delivered"), false);
  streamEvents.close();
  assert.equal(calls.filter(call => call[0] === "delivered").length, 1);
  assert.equal(calls.find(call => call[0] === "headers")[2]["Content-Disposition"], 'attachment; filename="report%201.txt"');

  assert.equal(await handleSftpJobRoutes({method:"GET"}, output.response, "/api/sftp/sync/jobs", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:[{id:"sync-1"}], status:200});
  assert.equal(await handleSftpJobRoutes({method:"POST"}, output.response, "/api/sftp/sync/jobs/clear-finished", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{cleared:"sync"}, status:200});
  for (const [pathname, method, expected, status] of [
    ["/api/sftp/sync/jobs/sync-1", "GET", {id:"sync-1", type:"sync"}, 200],
    ["/api/sftp/sync/jobs/sync-1", "DELETE", {action:"delete-sync", id:"sync-1"}, 200],
    ["/api/sftp/sync/jobs/sync-1/cancel", "POST", {action:"cancel-sync", id:"sync-1"}, 200],
    ["/api/sftp/sync/jobs/sync-1/retry", "POST", {action:"retry-sync", id:"sync-1"}, 202]
  ]) {
    assert.equal(await handleSftpJobRoutes({method}, output.response, pathname, dependencies), true);
    assert.deepEqual(output.sent.pop(), {data:expected, status});
  }
}

async function checkCommandResourceRoutes() {
  const { handleCommandResourceRoutes } = require(path.join(root, "dist", "routes", "command-resource-routes.js"));
  const output = recorder();
  const calls = [];
  let json = {};
  const operation = name => (...args) => {
    calls.push([name, ...args]);
    return {operation:name, args};
  };
  const operations = {
    deleteCommandSnippet:operation("delete-command-snippet"),
    deleteCommandTemplate:operation("delete-command-template"),
    deleteNamedWorkspace:operation("delete-named-workspace"),
    duplicateNamedWorkspace:operation("duplicate-named-workspace"),
    insertCommandSnippet:operation("insert-command-snippet"),
    insertNamedWorkspace:operation("insert-named-workspace"),
    listCommandSnippets:operation("list-command-snippets"),
    listCommandTemplates:operation("list-command-templates"),
    listNamedWorkspaces:operation("list-named-workspaces"),
    saveCommandTemplate:operation("save-command-template"),
    updateCommandSnippet:operation("update-command-snippet"),
    updateCommandTemplate:operation("update-command-template"),
    updateNamedWorkspace:operation("update-named-workspace"),
    useCommandSnippet:operation("use-command-snippet"),
    useNamedWorkspace:operation("use-named-workspace")
  };
  const dependencies = {
    operations,
    readJson:async () => json,
    sendJson:output.sendJson
  };

  assert.equal(await handleCommandResourceRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  for (const [pathname, operationName] of [
    ["/api/command-snippets", "list-command-snippets"],
    ["/api/named-workspaces", "list-named-workspaces"],
    ["/api/command-templates", "list-command-templates"]
  ]) {
    assert.equal(await handleCommandResourceRoutes({method:"GET"}, output.response, pathname, dependencies), true);
    assert.equal(output.sent.pop().data.operation, operationName);
  }

  json = {name:"fixture"};
  for (const [pathname, operationName] of [
    ["/api/command-snippets", "insert-command-snippet"],
    ["/api/named-workspaces", "insert-named-workspace"],
    ["/api/command-templates", "save-command-template"]
  ]) {
    assert.equal(await handleCommandResourceRoutes({method:"POST"}, output.response, pathname, dependencies), true);
    assert.deepEqual(output.sent.pop(), {data:{operation:operationName, args:[json]}, status:201});
  }

  const detailChecks = [
    ["PUT", "/api/command-snippets/snippet-1", "update-command-snippet", 200],
    ["DELETE", "/api/command-snippets/snippet-1", "delete-command-snippet", 200],
    ["POST", "/api/command-snippets/snippet-1/use", "use-command-snippet", 200],
    ["PUT", "/api/named-workspaces/workspace-1", "update-named-workspace", 200],
    ["DELETE", "/api/named-workspaces/workspace-1", "delete-named-workspace", 200],
    ["POST", "/api/named-workspaces/workspace-1/duplicate", "duplicate-named-workspace", 201],
    ["POST", "/api/named-workspaces/workspace-1/use", "use-named-workspace", 200],
    ["PUT", "/api/command-templates/template-1", "update-command-template", 200],
    ["DELETE", "/api/command-templates/template-1", "delete-command-template", 200]
  ];
  for (const [method, pathname, operationName, status] of detailChecks) {
    assert.equal(await handleCommandResourceRoutes({method}, output.response, pathname, dependencies), true);
    const sent = output.sent.pop();
    assert.equal(sent.data.operation, operationName);
    assert.equal(sent.status, status);
  }
  assert.equal(calls.length, 15, "每个命令资源路由必须只调用一次对应操作");
}

async function checkForwardTemplateRoutes() {
  const { handleForwardTemplateRoutes } = require(path.join(root, "dist", "routes", "forward-template-routes.js"));
  const output = recorder();
  const calls = [];
  let json = {};
  const operations = {
    listForwardTemplates:() => {
      calls.push(["list"]);
      return [{id:1, name:"Web"}];
    },
    insertForwardTemplate:data => {
      calls.push(["insert", data]);
      return 17;
    },
    updateForwardTemplate:(id, data) => calls.push(["update", id, data]),
    deleteForwardTemplate:id => calls.push(["delete", id]),
    applyForwardTemplate:(id, connectionIds) => {
      calls.push(["apply", id, connectionIds]);
      return {ok:true, created:[101, 102]};
    }
  };
  const dependencies = {
    createConfigSnapshot:reason => calls.push(["snapshot", reason]),
    operations,
    readJson:async () => json,
    sendJson:output.sendJson
  };

  assert.equal(await handleForwardTemplateRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleForwardTemplateRoutes({method:"GET"}, output.response, "/api/forward-templates", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:[{id:1, name:"Web"}], status:200});

  json = {name:"Database", mode:"local"};
  assert.equal(await handleForwardTemplateRoutes({method:"POST"}, output.response, "/api/forward-templates", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{id:17}, status:201});

  json = {name:"Updated", mode:"socks"};
  assert.equal(await handleForwardTemplateRoutes({method:"PUT"}, output.response, "/api/forward-templates/17", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true}, status:200});

  assert.equal(await handleForwardTemplateRoutes({method:"DELETE"}, output.response, "/api/forward-templates/17", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true}, status:200});

  json = {connection_ids:[3, 9]};
  assert.equal(await handleForwardTemplateRoutes({method:"POST"}, output.response, "/api/forward-templates/17/apply", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, created:[101, 102]}, status:200});
  assert.deepEqual(calls, [
    ["list"],
    ["insert", {name:"Database", mode:"local"}],
    ["update", "17", {name:"Updated", mode:"socks"}],
    ["delete", "17"],
    ["snapshot", "批量应用转发模板前自动快照"],
    ["apply", "17", [3, 9]]
  ]);
}

Promise.all([checkConfigTransferRoutes(), checkSftpDesktopDownloadRoutes(), checkSftpJobRoutes(), checkCommandResourceRoutes(), checkForwardTemplateRoutes()])
  .then(() => console.log("路由拆分检查通过：配置传输、SFTP 下载与任务、命令资源及转发模板保持原接口行为"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
