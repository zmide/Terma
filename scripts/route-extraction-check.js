"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
  const generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-generated-pdf-"));
  let configuredDirectory = "D:/Saved";
  let desktopRequest = false;
  let json = {};
  let generatedBody = Buffer.from("%PDF-1.7 fixture");
  const jobs = [
    {id:"job-1", type:"download", delivery_status:"saved", saved_path:"C:/Downloads/fixture.txt"},
    {id:"job-2", type:"download", delivery_status:"saved", saved_path:"C:/Downloads/batch"}
  ];
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
    },
    trashLocalPath:file => {
      calls.push(["trash-file", file]);
      return {trashed:file};
    }
  };
  const dependencies = {
    runtimeSettingsFile:"runtime.json",
    getDesktopIntegration:() => desktopIntegration,
    isDesktopRequest:() => desktopRequest,
    listSftpJobs:() => jobs,
    readBody:async () => generatedBody,
    readJson:async () => json,
    readRuntimeSettings:() => ({sftp_download_directory:configuredDirectory}),
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
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/delete-file", dependencies), true);
  assert.deepEqual(calls.shift(), ["trash-file", "C:/Downloads/fixture.txt"]);
  assert.deepEqual(output.sent.pop(), {data:{trashed:"C:/Downloads/fixture.txt"}, status:200});

  configuredDirectory = generatedDirectory;
  const generatedRequest = {method:"POST", headers:{"content-type":"application/pdf", "x-terma-generated-filename":encodeURIComponent("测试-彩色反转.pdf")}};
  assert.equal(await handleSftpDesktopDownloadRoutes(generatedRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  const generatedResult = output.sent.pop();
  assert.equal(generatedResult.status, 201);
  assert.equal(generatedResult.data.ok, true);
  assert.equal(generatedResult.data.filename, "测试-彩色反转.pdf");
  assert.equal(fs.readFileSync(generatedResult.data.path, "utf8"), "%PDF-1.7 fixture");
  assert.equal(await handleSftpDesktopDownloadRoutes(generatedRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  assert.equal(output.sent.pop().data.filename, "测试-彩色反转 (1).pdf");

  generatedBody = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="white"/></svg>');
  const generatedSvgRequest = {method:"POST", headers:{"content-type":"image/svg+xml; charset=utf-8", "x-terma-generated-filename":encodeURIComponent("测试-黑白反转.svg")}};
  assert.equal(await handleSftpDesktopDownloadRoutes(generatedSvgRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  const generatedSvgResult = output.sent.pop();
  assert.equal(generatedSvgResult.status, 201);
  assert.equal(generatedSvgResult.data.filename, "测试-黑白反转.svg");
  assert.match(fs.readFileSync(generatedSvgResult.data.path, "utf8"), /<svg/);

  json = {path:generatedSvgResult.data.path};
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/delete-generated", dependencies), true);
  assert.deepEqual(calls.shift(), ["trash-file", generatedSvgResult.data.path]);
  assert.deepEqual(output.sent.pop(), {data:{trashed:generatedSvgResult.data.path}, status:200});

  json = {path:path.join(generatedDirectory, "..", "outside.svg")};
  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST"}, output.response, "/api/sftp/download-settings/delete-generated", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"生成文件路径无效"}, status:400});

  assert.equal(await handleSftpDesktopDownloadRoutes({method:"POST", headers:{"content-type":"text/plain"}}, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"只允许保存 PDF 或 SVG 文件"}, status:415});
  generatedBody = Buffer.alloc(0);
  assert.equal(await handleSftpDesktopDownloadRoutes(generatedSvgRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"生成文件内容为空"}, status:400});
  generatedBody = Buffer.from("%PDF-1.7 malformed-name");
  const malformedFilenameRequest = {method:"POST", headers:{"content-type":"application/pdf", "x-terma-generated-filename":"%E0%A4%A"}};
  assert.equal(await handleSftpDesktopDownloadRoutes(malformedFilenameRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  assert.equal(output.sent.pop().data.filename, "%E0%A4%A.pdf");

  desktopRequest = false;
  assert.equal(await handleSftpDesktopDownloadRoutes(generatedRequest, output.response, "/api/sftp/download-settings/save-generated", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"生成文件保存仅能在本机桌面端使用"}, status:403});
  fs.rmSync(generatedDirectory, {recursive:true, force:true});

  desktopRequest = true;
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

async function checkConnectionRoutes() {
  const { handleConnectionRoutes } = require(path.join(root, "dist", "routes", "connection-routes.js"));
  const output = recorder();
  const calls = [];
  let json = {};
  const source = {id:7, name:"Primary"};
  const dependencies = {
    appendSystemLog:message => calls.push(["log", message]),
    clearConnectionHealthCache:id => calls.push(["clear-health", id]),
    createConfigSnapshot:reason => calls.push(["snapshot", reason]),
    defaultExtraArgs:["-o", "ConnectTimeout=8"],
    duplicateConnection:(id, args) => ({id:17, name:"Primary copy", source_id:id, args}),
    getConnection:() => source,
    getForward:id => ({id, connection_id:7, mode:"local", bind_port:6001}),
    getDesktopIntegration:() => null,
    forwardLogLabel:id => `forward-${id}`,
    isDesktopRequest:() => false,
    listConnections:() => [source],
    readJson:async () => json,
    reconfigureForward:async (id, data) => {
      calls.push(["reconfigure", id, data]);
      return {ok:true, was_running:true, restarted:true, rolled_back:false};
    },
    reorderConnections:(groupName, ids) => {
      calls.push(["reorder-connections", groupName, ids]);
      return {ok:true, connections:ids.length};
    },
    sendJson:output.sendJson
  };

  assert.equal(await handleConnectionRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleConnectionRoutes({method:"GET"}, output.response, "/api/connections", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:[source], status:200});

  assert.equal(await handleConnectionRoutes({method:"POST"}, output.response, "/api/connections/7/duplicate", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{id:17, name:"Primary copy", source_id:7, args:dependencies.defaultExtraArgs}, status:201});
  assert.match(calls.pop()[1], /Primary -> Primary copy/);

  json = {path:"/srv/app"};
  assert.equal(await handleConnectionRoutes({method:"POST"}, output.response, "/api/connections/7/external-tools/vscode", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"VS Code Remote SSH 只能在本机桌面端中使用"}, status:403});

  json = {mode:"local", bind_host:"127.0.0.1", bind_port:6002, target_host:"127.0.0.1", target_port:80};
  assert.equal(await handleConnectionRoutes({method:"PUT"}, output.response, "/api/forwards/11", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, was_running:true, restarted:true, rolled_back:false}, status:200});
  assert.deepEqual(calls.slice(-3), [
    ["reconfigure", 11, json],
    ["clear-health", 7],
    ["log", "已更新转发：forward-11"]
  ]);

  json = {group_name:"Production", ids:[7, 9]};
  assert.equal(await handleConnectionRoutes({method:"POST"}, output.response, "/api/connections/reorder", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, connections:2}, status:200});
  assert.deepEqual(calls.slice(-2), [
    ["snapshot", "调整 SSH 连接顺序前自动快照"],
    ["reorder-connections", "Production", [7, 9]]
  ]);
}

async function checkRemoteTaskRoutes() {
  const { handleRemoteTaskRoutes } = require(path.join(root, "dist", "routes", "remote-task-routes.js"));
  const output = recorder();
  const calls = [];
  let json = {};
  const connection = {id:7, name:"Linux"};
  const dependencies = {
    authorizeConnection:(_request, id) => {
      calls.push(["authorize", id]);
      return connection;
    },
    clearFinishedLinuxDesktopTasks:() => ({removed:2}),
    configureRdpServerForConnection:async () => ({ok:true, task:{id:"rdp-1"}}),
    createRemoteAdminGrant:(_connection, _data, scope) => {
      calls.push(["scope", scope]);
      return {id:"grant-1"};
    },
    deleteLinuxDesktopTask:() => true,
    detectLinuxDesktopForConnection:async () => ({platform:"linux"}),
    getConnection:() => connection,
    handoffRemotePrivilegeGrant:(_grant, start) => start(),
    issueRemoteAdminGrant:async () => ({ok:true, admin_grant_id:"grant-1"}),
    linuxDesktopTaskView:task => task,
    linuxDesktopTasks:new Map(),
    listLinuxDesktopTasks:() => [{id:"desktop-1"}],
    readJson:async () => json,
    remoteOfflineTasks:{clearFinished:() => ({removed:1}), list:() => [], remove:() => true},
    sendJson:output.sendJson,
    startLinuxDesktopInstall:(id, desktopId, action, grant, mode) => ({id:"desktop-new", connection_id:id, desktop_id:desktopId, action, grant_id:grant?.id, mode})
  };

  assert.equal(await handleRemoteTaskRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  json = {connection_id:7, scope:"host:*"};
  assert.equal(await handleRemoteTaskRoutes({method:"POST"}, output.response, "/api/admin-grants", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, admin_grant_id:"grant-1"}, status:201});

  json = {desktop_id:"xfce", mode:"install-offline"};
  assert.equal(await handleRemoteTaskRoutes({method:"POST"}, output.response, "/api/connections/7/linux-desktop/install", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{id:"desktop-new", connection_id:7, desktop_id:"xfce", action:"install", grant_id:"grant-1", mode:"offline"}, status:202});
  assert.deepEqual(calls.pop(), ["scope", "linux-desktop.install-offline"]);

  assert.equal(await handleRemoteTaskRoutes({method:"GET"}, output.response, "/api/linux-desktop/tasks/missing", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"桌面管理任务不存在或已过期"}, status:404});
}

async function checkSystemRoutes() {
  const { handleSystemRoutes } = require(path.join(root, "dist", "routes", "system-routes.js"));
  const output = recorder();
  const dependencies = {
    aboutInfo:() => ({product_name:"Terma"}),
    batchRunCommands:async ids => ({count:ids.length}),
    getDesktopIntegration:() => null,
    getStartupStatus:() => ({state:"ready"}),
    isDesktopRequest:() => false,
    listNotifications:since => [{since}],
    listSerialPorts:async () => [],
    readJson:async () => ({ids:[1, 2], command:"uptime"}),
    runtimeDiagnostics:() => ({pid:123}),
    sendJson:output.sendJson
  };

  assert.equal(await handleSystemRoutes({method:"GET"}, output.response, "/api/unknown", dependencies), false);
  assert.equal(await handleSystemRoutes({method:"GET"}, output.response, "/api/about", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{product_name:"Terma"}, status:200});
  assert.equal(await handleSystemRoutes({method:"POST"}, output.response, "/api/legacy-brand-migration", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"旧版数据迁移仅能在运行 Terma 的本机桌面版中执行"}, status:403});
  assert.equal(await handleSystemRoutes({method:"GET", url:"/api/notifications?since=42"}, output.response, "/api/notifications", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:[{since:42}], status:200});
}

async function checkLocalControlRoutes() {
  const { handleLocalControlRoutes } = require(path.join(root, "dist", "routes", "local-control-routes.js"));
  const output = recorder();
  let desktop = null;
  let loopback = false;
  let authenticated = false;
  let shutdowns = 0;
  const dependencies = {
    getDesktopIntegration:() => desktop,
    getNativeSftpDragTicket:async token => ({token}),
    hasShutdownToken:() => false,
    isAuthenticated:() => authenticated,
    isDesktopRequest:() => false,
    isDirectLoopbackRequest:() => loopback,
    releaseNativeSftpDragTicket:() => true,
    sendJson:output.sendJson,
    shutdown:() => { shutdowns += 1; },
    streamNativeSftpDragContent:async () => {}
  };

  assert.equal(await handleLocalControlRoutes({method:"GET"}, output.response, "/api/about", dependencies), false);
  assert.equal(await handleLocalControlRoutes({method:"POST"}, output.response, "/api/shutdown", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"Forbidden"}, status:403});
  assert.equal(shutdowns, 0);

  loopback = true;
  authenticated = true;
  assert.equal(await handleLocalControlRoutes({method:"POST"}, output.response, "/api/shutdown", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true}, status:200});
  assert.equal(shutdowns, 1);

  desktop = {};
  loopback = false;
  assert.equal(await handleLocalControlRoutes({method:"GET"}, output.response, "/api/sftp/native-drag/token", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{error:"原生拖出凭据只能由本机桌面端读取"}, status:403});
}

async function checkSftpTransferRoutes() {
  const { handleSftpTransferRoutes } = require(path.join(root, "dist", "routes", "sftp-transfer-routes.js"));
  const output = recorder();
  const sent = [];
  let json = {};
  let cancelled = false;
  const response = {destroyed:false, writableEnded:false};
  const dependencies = {
    authorizeConnectionId:() => 7,
    getDesktopIntegration:() => null,
    invalidateRemoteDirectoryCache:() => {},
    isDesktopRequest:() => false,
    readJson:async () => json,
    readRemoteDirectorySize:async () => ({bytes:4096}),
    readRuntimeSettings:() => ({sftp_max_open_file_size_mb:8, sftp_recycle_bin_enabled:true}),
    receiveUploadJobContent:async () => {
      if (cancelled) throw Object.assign(new Error("cancelled"), {code:"SFTP_UPLOAD_CANCELLED"});
      return {ok:true};
    },
    resolveRemoteDirectory:async (_id, remotePath) => ({path:remotePath === "." ? "/home/test" : remotePath}),
    resolveRemoteUploadTarget:async (_id, _directory, filename) => ({exists:json.exists === true, name:filename, path:`/tmp/${filename}`, renamed:false}),
    runtimeSettingsFile:"runtime.json",
    safeUploadName:name => String(name).replace(/[^a-z0-9.]+/gi, "_"),
    send:(_response, status, data, headers={}) => sent.push({status, data, headers}),
    sendJson:output.sendJson,
    startUploadReceiveJob:() => ({id:"upload-1"})
  };

  assert.equal(await handleSftpTransferRoutes({method:"GET"}, response, "/api/about", dependencies), false);
  assert.equal(
    await handleSftpTransferRoutes({method:"GET", url:"/api/connections/7/sftp/resolve-directory?path=%2Fsrv%2Fdata"}, response, "/api/connections/7/sftp/resolve-directory", dependencies),
    true
  );
  assert.deepEqual(sent.pop(), {status:200, data:{path:"/srv/data"}, headers:{"Cache-Control":"no-store"}});
  assert.equal(await handleSftpTransferRoutes({method:"POST"}, response, "/api/connections/7/sftp/native-drag", dependencies), true);
  assert.deepEqual(output.sent.pop(), {
    data:{
      error:"拖出到本机只能在桌面版中使用",
      code:"SFTP_DRAG_OUT_DESKTOP_ONLY",
      error_code:"sftp_drag_out_desktop_only"
    },
    status:403
  });

  json = {filename:"report.txt", size:12, conflict:"error", exists:true};
  assert.equal(await handleSftpTransferRoutes({method:"POST"}, response, "/api/connections/7/sftp/upload-job", dependencies), true);
  assert.deepEqual(output.sent.pop(), {
    data:{
      error:"目标目录已存在同名项目",
      code:"SFTP_TARGET_CONFLICT",
      error_code:"sftp_target_conflict",
      error_params:{name:"report.txt"},
      conflict:true,
      name:"report.txt"
    },
    status:409
  });

  json = {path:"/srv"};
  assert.equal(await handleSftpTransferRoutes({method:"POST"}, response, "/api/connections/7/sftp/directory-size", dependencies), true);
  assert.deepEqual(sent.pop(), {status:200, data:{bytes:4096}, headers:{"Cache-Control":"no-store"}});

  json = {exists:false};
  cancelled = true;
  const uploadRequest = {method:"POST", url:"/api/connections/7/sftp/upload?path=/tmp", headers:{"x-file-name":"cancel.txt", "content-length":"3"}};
  assert.equal(await handleSftpTransferRoutes(uploadRequest, response, "/api/connections/7/sftp/upload", dependencies), true);
  assert.deepEqual(output.sent.pop(), {data:{ok:true, status:"cancelled", id:"upload-1"}, status:409});
}

async function checkBackupRestoreRoutes() {
  const { handleBackupRestoreRoutes } = require(path.join(root, "dist", "routes", "backup-restore-routes.js"));
  const output = recorder();
  const snapshotCalls = [];
  const snapshotDependencies = {
    clearConnectionHealthCache:() => snapshotCalls.push("clear"),
    createConfigSnapshot:reason => snapshotCalls.push(`snapshot:${reason}`),
    readJson:async () => ({}),
    requireEncryptionUnlocked:() => snapshotCalls.push("unlock"),
    restoreConfigSnapshotById:id => {
      snapshotCalls.push(`restore:${id}`);
      return {ok:true};
    },
    sendJson:output.sendJson,
    stopAllForwards:() => snapshotCalls.push("stop")
  };
  assert.equal(await handleBackupRestoreRoutes({method:"GET"}, output.response, "/api/about", snapshotDependencies), false);
  assert.equal(await handleBackupRestoreRoutes({method:"POST"}, output.response, "/api/config-snapshots/snapshot-1/restore", snapshotDependencies), true);
  assert.deepEqual(snapshotCalls, ["unlock", "snapshot:回滚前自动快照", "stop", "restore:snapshot-1", "clear"]);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-route-restore-"));
  const databasePath = path.join(temporary, "terma.db");
  const stagedPath = path.join(temporary, "staged.db");
  fs.writeFileSync(databasePath, "original", "utf8");
  fs.writeFileSync(stagedPath, "replacement", "utf8");
  const calls = [];
  let reopenCount = 0;
  const stage = {
    token:"restore-1",
    database_path:stagedPath,
    format:"sqlite",
    security:null,
    legacy_credential_bindings:[],
    legacy_identity_bindings:[]
  };
  const dependencies = {
    clearConnectionHealthCache:() => calls.push("clear"),
    closeDatabase:() => calls.push("close"),
    createConfigSnapshot:reason => calls.push(`snapshot:${reason}`),
    databaseTransferStore:{
      take:token => {
        calls.push(`take:${token}`);
        return stage;
      },
      discard:item => calls.push(`discard:${item.token || item}`)
    },
    dbPath:databasePath,
    ensurePrivateFile:file => calls.push(`private:${path.basename(file)}`),
    lockEncryption:() => calls.push("lock"),
    normalizeRestoredCredentials:() => {
      calls.push("normalize");
      return {missing:[], unresolved:[], encrypted:[], mappings:[], encrypted_fields:0};
    },
    readJson:async () => ({restore_token:"restore-1", credential_bindings:[], identity_bindings:[]}),
    readSecuritySettings:() => ({encryption_enabled:false}),
    reconcileEncryptionStateAtStartup:() => calls.push("reconcile"),
    reopenDatabase:() => {
      reopenCount += 1;
      calls.push(`reopen:${reopenCount}`);
      if (reopenCount === 1) throw new Error("reopen failed");
    },
    requireEncryptionUnlocked:() => calls.push("unlock"),
    sendJson:output.sendJson,
    stopAllForwards:() => calls.push("stop"),
    writeSecuritySettings:settings => calls.push(`security:${Boolean(settings.encryption_enabled)}`)
  };

  await assert.rejects(
    handleBackupRestoreRoutes({method:"POST"}, output.response, "/api/restore/database", dependencies),
    /reopen failed/
  );
  assert.equal(fs.readFileSync(databasePath, "utf8"), "original");
  assert.deepEqual(calls.slice(0, 7), ["unlock", "take:restore-1", "normalize", "snapshot:恢复数据库前自动快照", "stop", "close", calls[6]]);
  assert.match(calls[6], /^private:terma\.db\.bak-/);
  assert.deepEqual(calls.slice(-5), ["close", "security:false", "lock", "reopen:2", "discard:restore-1"]);
  fs.rmSync(temporary, {recursive:true, force:true});
}

Promise.all([
  checkConfigTransferRoutes(),
  checkSftpDesktopDownloadRoutes(),
  checkSftpJobRoutes(),
  checkCommandResourceRoutes(),
  checkForwardTemplateRoutes(),
  checkConnectionRoutes(),
  checkRemoteTaskRoutes(),
  checkSystemRoutes(),
  checkLocalControlRoutes(),
  checkSftpTransferRoutes(),
  checkBackupRestoreRoutes()
])
  .then(() => console.log("路由拆分检查通过：连接、系统、远程任务、SFTP、备份恢复及既有领域路由保持接口与安全边界"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
