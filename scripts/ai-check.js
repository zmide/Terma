const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_AI_SETTINGS, normalizeAiSettings } = require("../dist/runtime-settings");
const { redactAiText, requestAiChat, requestAiChatStream, requestAiModels } = require("../dist/services/ai-service");
const { handleAiRoutes } = require("../dist/routes/ai-routes");

function streamResponse(text, contentType="text/event-stream") {
  return new Response(text, {status:200, headers:{"content-type":contentType}});
}

async function main() {
  const terminalAiSource = [
    fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-actions.js"), "utf8")
  ].join("\n");
  const terminalAiRenderSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-render.js"), "utf8");
  const terminalAiMcpSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-mcp.js"), "utf8");
  const terminalAiSettingsSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-settings-runtime.js"), "utf8");
  const terminalAiCssSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
  const mcpServiceSource = fs.readFileSync(path.join(__dirname, "..", "src", "services", "mcp-service.ts"), "utf8");
  assert.match(terminalAiSource, /event\.key !== "Enter" \|\| event\.shiftKey/);
  assert.match(terminalAiSource, /event\.preventDefault\(\);\s*return submitTerminalAiPrompt/);
  for (const skill of ["network-diagnostics", "performance-analysis", "container-troubleshooting", "git-workflow", "incident-response", "web-research"]) {
    assert.equal(terminalAiSettingsSource.includes(`data-terminal-ai-skill="${skill}"`), true, `${skill} setting is missing`);
  }
  for (const preset of ["web-fetch", "brave-search", "github", "playwright", "memory"]) {
    assert.equal(terminalAiSettingsSource.includes(`${JSON.stringify(preset)}:`) || terminalAiSettingsSource.includes(`${preset}:`), true, `${preset} MCP preset is missing`);
  }
  assert.match(terminalAiSource, /terminalAiResponseMcpCalls/);
  assert.match(terminalAiMcpSource, /terminalAiExplicitSearchIntent/);
  assert.match(terminalAiMcpSource, /terminalAiSearchCallForPrompt/);
  assert.match(terminalAiMcpSource, /terminalAiProjectIdentityContext/);
  assert.match(terminalAiMcpSource, /https:\/\/github\.com\/zmide\/Terma/);
  assert.match(terminalAiSource, /searchAttempted = false/);
  assert.match(terminalAiSource, /if \(explicitSearch\)/);
  assert.match(terminalAiSource, /"terminal-selection", "terminal-block"/);
  assert.match(terminalAiRenderSource, /callName\.toLowerCase\(\) === "mcp_call"/);
  assert.match(terminalAiRenderSource, /`\$\{tool\.server_id\}\.\$\{tool\.name\}`\.toLowerCase\(\) === serverRef\.toLowerCase\(\)/);
  assert.match(terminalAiRenderSource, /delete jsonArguments\.server/);
  for (const transport of ["stdio", "sse", "streamable-http"]) assert.equal(terminalAiSettingsSource.includes(`value="${transport}"`), true, `${transport} MCP transport is missing`);
  assert.match(terminalAiSettingsSource, /settings-ai-mcp-edit/);
  assert.match(terminalAiSettingsSource, /terminalAiMcpHeaders/);
  assert.match(terminalAiCssSource, /\.terminal-ai-composer-popover select,\s*\n\.terminal-ai-settings select[\s\S]*background-image:url\([^)]*\) !important/);
  assert.match(terminalAiCssSource, /html\[data-theme="dark"\] \.terminal-ai-composer-popover select,[\s\S]*background-image:url\([^)]*\) !important/);
  assert.equal(terminalAiSource.includes("while (!controller.signal.aborted && state.requestId === requestId)"), true);
  assert.equal(terminalAiSource.includes("terminalAiAgentContinuationPrompt(originalPrompt, results)"), true);
  assert.match(terminalAiSource, /awaitingActionRecovery && terminalAiAnswerNeedsActionRecovery/);
  assert.doesNotMatch(terminalAiSource, /MAX_COMMANDS|MAX_AGENT_COMMANDS|agentCommandCount\s*>=\s*6/);
  assert.doesNotMatch(terminalAiSource, /TERMINAL_AI_COMMAND_WAIT_MS\s*=\s*60000/);
 assert.match(terminalAiRenderSource, /function terminalAiDeduplicateRepeatedText/);
  assert.match(terminalAiRenderSource, /const normalizedValue = terminalAiDeduplicateRepeatedText/);
  assert.equal(terminalAiRenderSource.includes("else if (!selected) fragments.push(renderTerminalAiMarkdown"), true);
 assert.match(terminalAiRenderSource, /exact adjacent repeats/);
  assert.match(terminalAiRenderSource, /terminal-ai-table-wrap/);
  assert.match(mcpServiceSource, /MCP-Session-Id/);
  assert.match(mcpServiceSource, /text\/event-stream/);
  assert.match(mcpServiceSource, /legacySseRequest/);
  assert.match(mcpServiceSource, /streamableHttpRequest/);
  assert.match(mcpServiceSource, /\? `\$\{command\}\.cmd` : command/);
  const aiRoutesSource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "ai-routes.ts"), "utf8");
  assert.match(aiRoutesSource, /MCP_LOCAL_REQUIRED/);
  assert.match(aiRoutesSource, /isDesktopRequest\(request\) \|\| dependencies\.isDirectLoopbackRequest\(request\)/);
  assert.match(aiRoutesSource, /tools_updated_at/);
  assert.match(aiRoutesSource, /MCP_TOOL_DISABLED/);
  const mcpRouteDependencies = {
    isDesktopRequest:() => false,
    isDirectLoopbackRequest:() => false,
    readJson:async () => ({}),
    readRuntimeSettings:() => ({ai:{...DEFAULT_AI_SETTINGS, mcp_servers:[]}}),
    writeRuntimeSettings:() => {},
    normalizeRuntimeSettings:value => value,
    runtimeSettingsFile:"fixture",
    sendJson:() => {}
  };
  await assert.rejects(
    handleAiRoutes({method:"GET"}, {}, "/api/ai/mcp/servers", mcpRouteDependencies),
    error => error?.publicCode === "mcp_local_required"
  );
  assert.equal(DEFAULT_AI_SETTINGS.context_tokens, 1000000);
  assert.equal(DEFAULT_AI_SETTINGS.api_type, "responses");
  assert.equal(DEFAULT_AI_SETTINGS.terminal_ai_placement, "right");
  assert.equal(DEFAULT_AI_SETTINGS.terminal_ai_permission, "confirm");
  assert.deepEqual(DEFAULT_AI_SETTINGS.skills_enabled, ["linux-diagnostics", "security-audit", "log-analysis", "service-troubleshooting"]);
  assert.equal(normalizeAiSettings({terminal_ai_permission:"full"}).terminal_ai_permission, "full");
  assert.equal(normalizeAiSettings({mcp_servers:[{id:"legacy",name:"Legacy",transport:"http",url:"http://127.0.0.1/mcp"}]}).mcp_servers[0].transport, "streamable-http");
  assert.deepEqual(normalizeAiSettings({mcp_servers:[{id:"sse",name:"SSE",transport:"sse",url:"http://127.0.0.1/sse",headers:{Authorization:"Bearer fixture"}}]}).mcp_servers[0].headers, {Authorization:"Bearer fixture"});
  assert.throws(() => normalizeAiSettings({mcp_servers:[{id:"sse",name:"SSE",transport:"sse",url:"http://127.0.0.1/sse",headers:{Host:"elsewhere"}}]}), /Terma/);
  assert.equal(DEFAULT_AI_SETTINGS.model, "");
  assert.deepEqual(normalizeAiSettings({}), DEFAULT_AI_SETTINGS);
  assert.equal(normalizeAiSettings({context_chars:4000}).context_tokens, 1000);
  assert.throws(() => normalizeAiSettings({endpoint:"file:///tmp/model"}), /HTTP 或 HTTPS/);
  assert.throws(() => normalizeAiSettings({endpoint:"https://user:pass@example.com/v1"}), /账号、密码/);

  const redacted = redactAiText([
    "password=local-secret",
    "Authorization: Bearer live-token-value",
    "Cookie: session=abc",
    "ssh-ed25519 AAAA-private-looking-material comment",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "private material",
    "-----END OPENSSH PRIVATE KEY-----"
  ].join("\n"));
  assert.equal(redacted.includes("local-secret"), false);
  assert.equal(redacted.includes("live-token-value"), false);
  assert.equal(redacted.includes("session=abc"), false);
  assert.equal(redacted.includes("AAAA-private-looking-material"), false);
  assert.equal(redacted.includes("private material"), false);

  const originalFetch = global.fetch;
  let requestUrl = "";
  let requestOptions = null;
  try {
    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return new Response(JSON.stringify({model:"fixture-model", output_text:"Responses result"}), {status:200, headers:{"content-type":"application/json"}});
    };
    const responseResult = await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1"},
      apiKey:"fixture-api-key",
      message:"请解释这段输出",
      contexts:[{source:"terminal", title:"fixture", text:"password=do-not-send\nAuthorization: Bearer do-not-send\n正常输出"}],
      locale:"zh-CN",
      permission:"confirm"
    });
    assert.equal(responseResult.content, "Responses result");
    assert.equal(requestUrl, "http://127.0.0.1:39001/v1/responses");
    assert.equal(requestOptions.redirect, "manual");
    assert.equal(requestOptions.headers.Authorization, "Bearer fixture-api-key");
    const responseBody = JSON.parse(requestOptions.body);
    assert.equal(Array.isArray(responseBody.input), true);
    assert.equal(responseBody.input[1].content.includes("do-not-send"), false);
    assert.equal(responseBody.input[1].content.includes("正常输出"), true);
    assert.equal(responseBody.input[1].content.includes("fixture-api-key"), false);
    assert.equal(responseBody.input[0].content.includes("Simplified Chinese"), true);
    assert.equal(responseBody.input[0].content.includes("Linux 诊断"), true);
    assert.equal(responseBody.input[0].content.includes("never stop after only a preamble"), true);
    assert.equal(responseBody.input[0].content.includes("at most one complete shell code block"), true);
    assert.equal(responseBody.input[0].content.includes("latest user message is the current task"), true);

    await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1"},
      message:"full access test",
      permission:"full"
    });
    const fullResponseBody = JSON.parse(requestOptions.body);
    assert.equal(fullResponseBody.input[0].content.includes("full access"), true);

    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return new Response(JSON.stringify({model:"fixture-completions", choices:[{message:{content:"Completions result"}}]}), {status:200, headers:{"content-type":"application/json"}});
    };
    const completionsResult = await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-completions", api_type:"completions", endpoint:"http://127.0.0.1:39001/v1"},
      message:"test"
    });
    assert.equal(completionsResult.content, "Completions result");
    assert.equal(requestUrl, "http://127.0.0.1:39001/v1/chat/completions");
    assert.equal(JSON.parse(requestOptions.body).messages[0].role, "system");

    global.fetch = async (url) => {
      requestUrl = String(url);
      return streamResponse([
        "event:delta\ndata:{\"delta\":\"Hello \"}\n\n",
        "event:delta\ndata:{\"delta\":\"stream\"}\n\n",
        "data:{\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"summary\"}\n\n",
        "event:done\ndata:{\"model\":\"stream-model\",\"usage\":{\"input_tokens\":12,\"output_tokens\":3,\"total_tokens\":15}}\n\n"
      ].join(""));
    };
    const deltas = [];
    const reasoning = [];
    const streamResult = await requestAiChatStream({settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"stream-model", endpoint:"http://127.0.0.1:39001/v1"}, message:"stream"}, (delta, kind) => (kind === "reasoning" ? reasoning : deltas).push(delta));
    assert.deepEqual(deltas, ["Hello ", "stream"]);
    assert.deepEqual(reasoning, ["summary"]);
    assert.equal(streamResult.content, "Hello stream");
    assert.equal(streamResult.model, "stream-model");
    assert.deepEqual(streamResult.usage, {input_tokens:12, output_tokens:3, total_tokens:15});
    assert.equal(requestUrl, "http://127.0.0.1:39001/v1/responses");

    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"chat\"}}]}\n\n",
      "data: [DONE]\n\n"
      ].join(""));
    };
    const completionDeltas = [];
    const completionStream = await requestAiChatStream({settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-completions", api_type:"completions", endpoint:"http://127.0.0.1:39001/v1"}, message:"stream"}, delta => completionDeltas.push(delta));
    assert.deepEqual(completionDeltas, ["chat"]);
    assert.equal(completionStream.content, "chat");
    assert.equal(JSON.parse(requestOptions.body).stream_options.include_usage, true);

    global.fetch = async (url) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({data:[{id:"model-a"},{id:"model-b"}]}), {status:200, headers:{"content-type":"application/json"}});
    };
    assert.deepEqual(await requestAiModels({settings:{...DEFAULT_AI_SETTINGS, enabled:true, endpoint:"http://127.0.0.1:39001/v1"}}), ["model-a", "model-b"]);
    assert.equal(requestUrl, "http://127.0.0.1:39001/v1/models");

    let recoveredChatAttempts = 0;
    global.fetch = async () => {
      recoveredChatAttempts += 1;
      return new Response(JSON.stringify(recoveredChatAttempts < 5
        ? {model:"fixture-model", output_text:""}
        : {model:"fixture-model", output_text:"recovered"}), {status:200, headers:{"content-type":"application/json"}});
    };
    const recoveredChat = await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1"},
      message:"retry empty response"
    });
    assert.equal(recoveredChat.content, "recovered");
    assert.equal(recoveredChatAttempts, 5);

    let recoveredModelAttempts = 0;
    global.fetch = async () => {
      recoveredModelAttempts += 1;
      return new Response(JSON.stringify({data:recoveredModelAttempts < 5 ? [] : [{id:"recovered-model"}]}), {status:200, headers:{"content-type":"application/json"}});
    };
    assert.deepEqual(await requestAiModels({settings:{...DEFAULT_AI_SETTINGS, enabled:true, endpoint:"http://127.0.0.1:39001/v1"}}), ["recovered-model"]);
    assert.equal(recoveredModelAttempts, 5);

    let routeBody = null;
    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return new Response(JSON.stringify({data:[{id:"safe-model"}]}), {status:200, headers:{"content-type":"application/json"}});
    };
    const routeRequest = {method:"POST"};
    const routeResponse = {};
    await handleAiRoutes(routeRequest, routeResponse, "/api/ai/models", {
      isDesktopRequest:() => false,
      isDirectLoopbackRequest:() => true,
      readJson:async () => ({ai:{...DEFAULT_AI_SETTINGS, enabled:true, endpoint:"http://127.0.0.1:39002/v1"}}),
      readRuntimeSettings:() => ({ai:{...DEFAULT_AI_SETTINGS, enabled:true, endpoint:"http://127.0.0.1:39001/v1", api_key:"saved-secret"}}),
      writeRuntimeSettings:() => {},
      normalizeRuntimeSettings:value => ({...value, ai:normalizeAiSettings(value.ai)}),
      runtimeSettingsFile:"fixture",
      sendJson:(_response, value) => { routeBody = value; }
    });
    assert.deepEqual(routeBody, {models:["safe-model"]});
    assert.equal(requestUrl, "http://127.0.0.1:39002/v1/models");
    assert.equal(requestOptions.headers.Authorization, undefined);

    global.fetch = async () => new Response("", {status:302, headers:{location:"https://example.com"}});
    await assert.rejects(
      requestAiChat({settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1"}, message:"test"}),
      error => error?.publicCode === "ai_redirect_blocked"
    );
  } finally {
    global.fetch = originalFetch;
  }
  console.log("AI service boundary check passed: 1M defaults, skills, redaction, streaming, five-attempt recovery, models, and redirect handling");
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {main};
