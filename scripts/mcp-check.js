"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const {createMcpManager, normalizeServer} = require("../dist/services/mcp-service");
const {handleAiRoutes} = require("../dist/routes/ai-routes");
const {publicAiSettings} = require("../dist/services/ai-service");

function requestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.once("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) { reject(error); }
    });
    request.once("error", reject);
  });
}

function mcpResult(message) {
  if (message.method === "initialize") return {protocolVersion:"2025-06-18", capabilities:{tools:{}}, serverInfo:{name:"http-fixture", version:"1"}};
  if (message.method === "tools/list") return {tools:[{name:"echo", description:"Echo fixture input", inputSchema:{type:"object", properties:{text:{type:"string"}}}}]};
  if (message.method === "tools/call") return {content:[{type:"text", text:String(message.params?.arguments?.text || "")}], isError:false};
  return {};
}

async function createHttpFixtures() {
  const sseClients = new Map();
  let nextClient = 1;
  const server = http.createServer(async (request, response) => {
    if (request.headers["x-test-auth"] !== "fixture-secret") { response.writeHead(401).end(); return; }
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/streamable") {
      const message = await requestBody(request);
      if (!Number.isFinite(Number(message.id))) { response.writeHead(202).end(); return; }
      response.writeHead(200, {"Content-Type":"application/json"});
      response.end(JSON.stringify({jsonrpc:"2.0", id:message.id, result:mcpResult(message)}));
      return;
    }
    if (request.method === "GET" && url.pathname === "/sse") {
      const client = String(nextClient++);
      response.writeHead(200, {"Content-Type":"text/event-stream", "Cache-Control":"no-cache", Connection:"keep-alive"});
      response.write(`event: endpoint\ndata: /messages?client=${client}\n\n`);
      sseClients.set(client, response);
      request.once("close", () => sseClients.delete(client));
      return;
    }
    if (request.method === "POST" && url.pathname === "/messages") {
      const message = await requestBody(request);
      response.writeHead(202).end();
      if (Number.isFinite(Number(message.id))) sseClients.get(String(url.searchParams.get("client")))?.write(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0", id:message.id, result:mcpResult(message)})}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {server, origin:`http://127.0.0.1:${server.address().port}`};
}

(async () => {
  const server = {
    id:"fixture",
    name:"Fixture MCP",
    transport:"stdio",
    command:process.execPath,
    args:[path.join(__dirname, "mcp-fixture-server.js")],
    enabled:true,
    timeout_ms:5000
  };
  const manager = createMcpManager();
  const discovered = await manager.discover(server);
  assert.equal(discovered.tools.length, 1);
  assert.equal(discovered.tools[0].name, "echo");
  const called = await manager.call(server, "echo", {text:"hello"});
  assert.equal(called.content?.[0]?.text, "hello");
  assert.equal(manager.calls()[0]?.ok, true);
  const fixtures = await createHttpFixtures();
  try {
    for (const [transport, route] of [["streamable-http", "streamable"], ["sse", "sse"]]) {
      const remote = {id:`fixture-${transport}`, name:`Fixture ${transport}`, transport, url:`${fixtures.origin}/${route}`, headers:{"X-Test-Auth":"fixture-secret"}, enabled:true, timeout_ms:5000};
      const remoteDiscovered = await manager.discover(remote);
      assert.equal(remoteDiscovered.tools[0]?.name, "echo", `${transport} should discover tools`);
      const remoteCalled = await manager.call(remote, "echo", {text:transport});
      assert.equal(remoteCalled.content?.[0]?.text, transport, `${transport} should call tools`);
    }
  } finally {
    await new Promise(resolve => fixtures.server.close(resolve));
  }
  assert.equal(normalizeServer({id:"legacy-http", name:"Legacy", transport:"http", url:"http://127.0.0.1/mcp", enabled:false}).transport, "streamable-http");
  assert.throws(() => normalizeServer({id:"bad-header", name:"Bad", transport:"sse", url:"http://127.0.0.1/sse", headers:{Host:"other"}}), /Terma/);
  const publicRemote = publicAiSettings({mcp_servers:[{id:"secret", name:"Secret", transport:"streamable-http", url:"http://127.0.0.1/mcp", headers:{Authorization:"Bearer secret"}}]});
  assert.equal(publicRemote.mcp_servers[0].headers.Authorization, "");
  assert.doesNotMatch(JSON.stringify(publicRemote), /Bearer secret/);
  let routeBody = null;
  let runtime = {ai:{mcp_servers:[server]}};
  await handleAiRoutes({method:"POST"}, {}, "/api/ai/mcp/servers/fixture/discover", {
    isDesktopRequest:() => true,
    isDirectLoopbackRequest:() => false,
    readJson:async () => ({}),
    readRuntimeSettings:() => runtime,
    writeRuntimeSettings:(_file, value) => { runtime = value; },
    normalizeRuntimeSettings:value => value,
    runtimeSettingsFile:"fixture",
    sendJson:(_response, value) => { routeBody = value; }
  });
  assert.equal(routeBody?.tools?.[0]?.name, "echo");
  assert.equal(runtime.ai.mcp_servers[0].tools[0].name, "echo");
  runtime = {ai:{mcp_servers:[{id:"remote-secret", name:"Remote secret", transport:"streamable-http", url:"http://127.0.0.1/mcp", headers:{Authorization:"Bearer saved-secret"}, enabled:false, timeout_ms:5000}]}};
  await handleAiRoutes({method:"PUT"}, {}, "/api/ai/mcp/servers/remote-secret", {
    isDesktopRequest:() => true,
    isDirectLoopbackRequest:() => false,
    readJson:async () => ({server:{id:"remote-secret", name:"Renamed", transport:"streamable-http", url:"http://127.0.0.1/mcp", headers:{Authorization:""}, enabled:false, timeout_ms:5000}}),
    readRuntimeSettings:() => runtime,
    writeRuntimeSettings:(_file, value) => { runtime = value; },
    normalizeRuntimeSettings:value => value,
    runtimeSettingsFile:"fixture",
    sendJson:(_response, value) => { routeBody = value; }
  });
  assert.equal(runtime.ai.mcp_servers[0].headers.Authorization, "Bearer saved-secret");
  assert.equal(routeBody.server.headers.Authorization, "");
  assert.doesNotMatch(JSON.stringify(routeBody), /saved-secret/);
  assert.throws(() => normalizeServer({...server, command:"node; rm -rf /"}), /Shell/);
  console.log("MCP service check passed: stdio, HTTP/SSE, Streamable HTTP, secret headers, tool calls, audit records, and command boundaries");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
