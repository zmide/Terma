const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DEFAULT_AI_SETTINGS, normalizeAiSettings } = require("../dist/runtime-settings");
const { publicAiSettings, redactAiText, requestAiChat, requestAiChatStream, requestAiModels } = require("../dist/services/ai-service");
const { handleAiRoutes } = require("../dist/routes/ai-routes");
const { validateMcpArguments, mcpToolRisk } = require("../dist/services/mcp-service");

function streamResponse(text, contentType="text/event-stream") {
  return new Response(text, {status:200, headers:{"content-type":contentType}});
}

function assertAgentTaskTiming(source) {
  let sequence = 0;
  const states = new Map();
  const context = {
    tr:(_key, args={}) => args.defaultValue || "",
    createTerminalLogId:() => `fixture-${++sequence}`,
    terminalAiStripControl:value => String(value || ""),
    terminalAiStateForKey:key => states.get(key) || (() => {
      const state = {agentTasks:[], blocks:[], turns:[], agentWaitingForInput:null, activeTaskId:"", open:false};
      states.set(key, state);
      return state;
    })(),
    terminalAiPersistState:() => {},
    terminalAiContextForKey:() => [],
    renderTerminalAiPanel:() => {},
    icon:() => "",
    esc:value => String(value || ""),
    escAttr:value => String(value || "")
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const task = context.terminalAiBeginTask("fixture", "检查服务状态", []);
  const step = context.terminalAiTaskPrepareAction("fixture", task.id, {kind:"command", command:"echo ok"});
  context.terminalAiTaskCompleteAction("fixture", task.id, step, "success");
  states.get("fixture").turns.push({taskId:task.id, answer:"已完成检查。服务运行正常。"});
  context.terminalAiTaskFinish("fixture", task.id);
  assert.equal(task.status, "completed");
  assert.equal(task.resultSummary, "服务运行正常。");
  assert.equal(task.steps[0].endedAt >= task.steps[0].startedAt, true);
  const firstDuration = task.durationMs;
  context.terminalAiBeginTask("fixture", task.prompt, [], task.id);
  context.terminalAiTaskMarkStopped("fixture");
  assert.equal(task.status, "stopped");
  assert.equal(task.durationMs >= firstDuration, true);
}

function assertAgentTaskDock(source) {
  let sequence = 0;
  const states = new Map();
  const context = {
    tr:(_key, args={}) => args.defaultValue || "",
    createTerminalLogId:() => "dock-" + (++sequence),
    terminalAiStripControl:value => String(value || ""),
    terminalAiStateForKey:key => states.get(key) || (() => {
      const state = {agentTasks:[], blocks:[], turns:[], agentWaitingForInput:null, activeTaskId:"", taskPlanCollapsed:false, open:true};
      states.set(key, state);
      return state;
    })(),
    terminalAiPersistState:() => {},
    renderTerminalAiPanel:() => {},
    icon:() => "",
    esc:value => String(value || ""),
    escAttr:value => String(value || ""),
    document:{documentElement:{lang:"zh-CN"}}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const task = context.terminalAiBeginTask("fixture", "检查服务", []);
  for (let index = 0; index < 12; index += 1) {
    const step = context.terminalAiTaskPrepareAction("fixture", task.id, {kind:"command", command:"echo " + (index + 1)});
    context.terminalAiTaskCompleteAction("fixture", task.id, step, "success");
  }
  const state = states.get("fixture");
  state.turns.push({taskId:task.id, answer:"最终已完成全部检查，服务正常。"});
  context.terminalAiTaskRecordAnswer("fixture", task.id, state.turns[0].answer);
  context.terminalAiTaskFinish("fixture", task.id);
  const html = context.terminalAiTaskDockHtml("fixture");
  assert.equal((html.match(/terminal-ai-task-step-number/g) || []).length, 12);
  assert.match(html, /最终已完成全部检查/);
  assert.match(html, /data-terminal-ai-task-dock-details="true"/);
}

function assertTerminalAiInteractionGuards(aiSource, renderSource) {
  const start = aiSource.indexOf("function finalizeTerminalAiActiveBlock");
  const end = aiSource.indexOf("function captureTerminalAiBlockCommand", start);
  const reviewStart = aiSource.indexOf("function terminalAiCommandTokens");
  const reviewEnd = aiSource.indexOf("function requestTerminalAiApproval", reviewStart);
  const context = {
    tr:(_key, args={}) => args.defaultValue || "",
    terminalAiStripControl:value => String(value || ""),
    terminalAiSensitivePath:value => /(?:\.ssh|id_rsa|\.env)/i.test(String(value || "")),
    terminalAiStateForKey:key => context.__state,
    terminalAiPersistState:() => {},
    renderTerminalAiPanel:() => {},
    __state:{blocks:[], agentWaitingForInput:null, open:true, mode:"chat"},
    terminalSessions:new Map()
  };
  context.terminalAiTurnUsage = () => ({available:false, input:0, output:0, total:0});
  vm.createContext(context);
  vm.runInContext(aiSource.slice(start, end), context);
  vm.runInContext(renderSource, context);
  context.icon = () => "";
  context.esc = value => String(value || "");
  context.escAttr = value => String(value || "");
  const fixtureLines = ["root@fixture:~# df -h", "/dev/test 10G 2G 8G 20% /"];
  context.terminalSessions.set("fixture", {term:{getSelection:() => "", buffer:{active:{length:fixtureLines.length, getLine:index => ({translateToString:() => fixtureLines[index] || ""})}}}});
  const automaticContext = context.terminalAiContextForKey("fixture");
  assert.equal(automaticContext.some(item => item.source === "terminal-screen" && item.text.includes("df -h")), true);
  vm.runInContext(aiSource.slice(reviewStart, reviewEnd), context);
  const encodedMarkdown = context.terminalAiNormalizeMarkdownEscapes("\\`\\`\\`sh\nprintf&#x20;'%s\\n'&#x20;'===&#x20;identity&#x20;==='\n\\`\\`\\`");
  assert.equal(encodedMarkdown, "```sh\nprintf '%s\\n' '=== identity ==='\n```");
  const encodedHtml = context.renderTerminalAiMarkdown("fixture", encodedMarkdown, {actions:false});
  assert.match(encodedHtml, /<pre class="terminal-ai-code"><code>printf '%s\\n' '=== identity ==='<\/code><\/pre>/);
  const chatRelayAnswer = context.terminalAiNormalizeChatAnswer("请在终端运行 `df -h`，运行后把输出发给我，我可以帮你分析。");
  assert.doesNotMatch(chatRelayAnswer, /把输出发给我|贴回这里|paste the output|send me the output/i);
  assert.match(chatRelayAnswer, /Terma.*自动读取最新终端内容/);
  assert.equal(context.terminalAiNormalizeChatAnswer("Terma 会自动读取终端内容，不会要求你复制或粘贴输出。"), "Terma 会自动读取终端内容，不会要求你复制或粘贴输出。");
  assert.deepEqual(Array.from(context.terminalAiResponseCommands(encodedMarkdown)), ["printf '%s\\n' '=== identity ==='"]);
  const inlineFence = "说明。\\`\\`\\`sh\nprintf '%s\\n' ok\n\\`\\`\\`";
  assert.deepEqual(Array.from(context.terminalAiResponseCommands(inlineFence)), ["printf '%s\\n' ok"]);
  const inlineFenceHtml = context.renderTerminalAiMarkdown("fixture", inlineFence, {actions:false});
  assert.match(inlineFenceHtml, /说明。<\/p><div class="terminal-ai-code-block"/);
  const shortShellFence = "说明。 ``sh\nprintf '%s\\n' ok\ndf -hT\n```";
  const shortShellFenceHtml = context.renderTerminalAiMarkdown("fixture", shortShellFence, {actions:false});
  assert.deepEqual(Array.from(context.terminalAiResponseCommands(shortShellFence)), ["printf '%s\\n' ok", "df -hT"]);
  assert.match(shortShellFenceHtml, /<span>sh<\/span><\/div><pre class="terminal-ai-code"><code>printf/);
  assert.doesNotMatch(shortShellFenceHtml, /<code><\/code>/);
  const chatInlineCommandHtml = context.renderTerminalAiMarkdown("fixture", "`df -h`", {actions:false, copy:true});
  assert.match(chatInlineCommandHtml, /terminal-ai-code-block/);
  assert.match(chatInlineCommandHtml, /data-action="terminal-ai-copy-code"/);
  assert.doesNotMatch(chatInlineCommandHtml, /terminal-ai-execute-command|terminal-ai-insert-command|terminal-ai-save-snippet/);
  const agentInlineCommandHtml = context.renderTerminalAiMarkdown("fixture", "`df -h`", {copy:true});
  assert.match(agentInlineCommandHtml, /terminal-ai-execute-command/);
  const proseWithCommandWord = context.renderTerminalAiMarkdown("fixture", "A cat is a command name", {actions:false, copy:true});
  assert.doesNotMatch(proseWithCommandWord, /terminal-ai-code-block/);
  assert.match(context.terminalAiCommandSyntaxIssue("find /opt -type f ( -name '*.sh' ) -print"), /find/);
  assert.equal(context.terminalAiCommandSyntaxIssue("find /opt -type f \\( -name '*.sh' \\) -print"), "");
  assert.match(context.terminalAiCommandSyntaxIssue("printf '--- database=%s ---\\n' \"$db\""), /printf/);
  assert.equal(context.terminalAiCommandSyntaxIssue("printf -- '--- database=%s ---\\n' \"$db\""), "");
  assert.equal(context.terminalAiCommandSyntaxIssue("printf '%s\\n' '--- database ---'"), "");
  const preflightMcp = {id:"preflight-turn", answer:"已读取资料并准备继续分析。", reasoning:"", model:"fixture", usage:null, busy:false, error:"", agentResults:[{kind:"mcp", server:"web-fetch", tool:"tavily_search", arguments:{query:"Terma"}, output:"fixture result", status:"已完成"}]};
  const preflightMcpHtml = context.terminalAiTaskAssistantHtml("fixture", {root:preflightMcp, steps:[preflightMcp], taskId:"preflight"});
  assert.ok(preflightMcpHtml.indexOf("terminal-ai-mcp-result-card") < preflightMcpHtml.indexOf("已读取资料并准备继续分析"));
  const anchoredMcp = {id:"anchored-turn", answer:"开始检查。\n<mcp_call server=\"web-fetch\" tool=\"tavily_search\">{\"query\":\"Terma\"}</mcp_call>\n工具结果已收到。", reasoning:"", model:"fixture", usage:null, busy:false, error:"", agentResults:[{kind:"mcp", server:"web-fetch", tool:"tavily_search", arguments:{query:"Terma"}, output:"anchored result", status:"已完成"}]};
  const anchoredMcpHtml = context.terminalAiTaskAssistantHtml("fixture", {root:anchoredMcp, steps:[anchoredMcp], taskId:"anchored"});
  const anchoredCardIndex = anchoredMcpHtml.indexOf("terminal-ai-mcp-result-card");
  assert.ok(anchoredCardIndex > anchoredMcpHtml.indexOf("开始检查"));
  assert.ok(anchoredCardIndex < anchoredMcpHtml.indexOf("工具结果已收到"));
  assert.equal(context.terminalAiDecodeXmlText("&amp;lt;&#x20;"), "&lt; ");
  assert.equal(context.terminalAiBlockNeedsInput({command:"rm -i 日志.txt", output:"rm: 是否删除普通文件 '日志.txt'? "}), true);
  assert.equal(context.terminalAiBlockNeedsInput({command:"sudo id", output:"[sudo] password for root: "}), true);
  assert.equal(context.terminalAiBlockNeedsInput({command:"cp source target", output:"Overwrite existing file? [y/N] "}), true);
  assert.equal(context.terminalAiBlockNeedsInput({command:"echo ok", output:"ok\nroot@Test:~# "}), false);
  const waitingBlock = {id:"waiting-block", command:"rm -i 日志.txt", output:"rm: 是否删除普通文件 '日志.txt'? "};
  context.__state.blocks = [waitingBlock];
  context.terminalAiMarkWaitingForInput("fixture", waitingBlock, {taskId:"task-1"});
  assert.equal(waitingBlock.waitingForInput, true);
  assert.equal(context.__state.agentWaitingForInput.taskId, "task-1");
  assert.equal(context.terminalAiWaitingInputCopy(context.__state).placeholder, "输入 y 或 n");
  const sshBlock = {id:"ssh-block", command:"ssh root@example.com", output:"The authenticity of host can't be established. Continue connecting (yes/no/[fingerprint])? "};
  context.__state.blocks = [sshBlock];
  context.__state.agentWaitingForInput = {blockId:sshBlock.id, command:sshBlock.command};
  assert.equal(context.terminalAiWaitingInputCopy(context.__state).placeholder, "输入 yes、no 或主机指纹");
  const passwordBlock = {id:"password-block", command:"sudo id", output:"[sudo] password for root: "};
  context.__state.blocks = [passwordBlock];
  context.__state.agentWaitingForInput = {blockId:passwordBlock.id, command:passwordBlock.command};
  assert.equal(context.terminalAiWaitingInputCopy(context.__state).placeholder, "输入密码或口令");
  const mixedSshBlock = {id:"mixed-ssh-block", command:"ssh root@example.com", output:"Continue connecting (yes/no/[fingerprint])? yes\nroot@example.com's password: "};
  context.__state.blocks = [mixedSshBlock];
  context.__state.agentWaitingForInput = {blockId:mixedSshBlock.id, command:mixedSshBlock.command};
  assert.equal(context.terminalAiWaitingInputCopy(context.__state).placeholder, "输入密码或口令");
  const review = context.terminalAiCommandReview("rm -i /tmp/demo.txt", {safe:false, reason:"risk"}, {checkpointId:"step-1"});
  assert.equal(review.files[0], "/tmp/demo.txt");
  assert.ok(review.backupCommand);
  assert.ok(review.rollbackCommand);
  const sensitive = context.terminalAiCommandReview("rm -i ~/.ssh/id_rsa", {safe:false, reason:"risk"}, {checkpointId:"step-2"});
  assert.equal(sensitive.backupCommand, "");
}

async function main() {
  const publicSettings = publicAiSettings({
    active_provider_id:"secondary",
    endpoint:"https://primary.example/v1",
    api_key:"primary-secret",
    providers:[
      {id:"primary", name:"Primary", endpoint:"https://primary.example/v1", model:"primary-model", api_key:"primary-secret"},
      {id:"secondary", name:"Secondary", endpoint:"https://secondary.example/v1", model:"secondary-model", api_key:"secondary-secret"}
    ]
  });
  assert.equal(publicSettings.active_provider_id, "secondary");
  assert.equal(publicSettings.providers[0].api_key_configured, true);
  assert.equal(publicSettings.providers[1].api_key_configured, true);
  assert.equal("api_key" in publicSettings, false);
  assert.equal("api_key" in publicSettings.providers[0], false);
  assert.equal("api_key" in publicSettings.providers[1], false);
  const terminalAiSource = [
    fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai.js"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-actions.js"), "utf8")
  ].join("\n");
  const terminalAiActionsSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-actions.js"), "utf8");
  const commandSnippetsSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-command-snippets.js"), "utf8");
  const terminalAiRenderSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-render.js"), "utf8");
  const terminalAiTasksSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-tasks.js"), "utf8");
  const terminalCommandTrackingSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-command-tracking.js"), "utf8");
  const terminalAiMcpSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-ai-mcp.js"), "utf8");
  const terminalAiSettingsSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-settings-runtime.js"), "utf8");
  const terminalAiCssSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
  const mcpServiceSource = fs.readFileSync(path.join(__dirname, "..", "src", "services", "mcp-service.ts"), "utf8");
  assert.match(terminalAiSource, /event\.key !== "Enter" \|\| event\.shiftKey/);
  assert.match(terminalAiSource, /event\.preventDefault\(\);\s*return submitTerminalAiPrompt/);
  assert.match(terminalAiSource, /function terminalAiSetMode/);
  assert.match(terminalAiSource, /mode === "chat"/);
  assert.match(terminalAiSource, /agentTask:false/);
  assert.match(terminalAiActionsSource, /chat_execution_disabled/);
  assert.match(terminalAiSource, /terminal:ai\.agent_action_missing/);
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
  assert.match(terminalAiRenderSource, /source:"terminal-screen"/);
  assert.match(terminalAiRenderSource, /TERMINAL_AI_SCREEN_MAX_LINES/);
  assert.match(terminalAiRenderSource, /callName\.toLowerCase\(\) === "mcp_call"/);
  assert.match(terminalAiRenderSource, /`\$\{tool\.server_id\}\.\$\{tool\.name\}`\.toLowerCase\(\) === serverRef\.toLowerCase\(\)/);
  assert.match(terminalAiRenderSource, /delete jsonArguments\.server/);
  for (const transport of ["stdio", "sse", "streamable-http"]) assert.equal(terminalAiSettingsSource.includes(`value="${transport}"`), true, `${transport} MCP transport is missing`);
  assert.match(terminalAiSettingsSource, /settings-ai-mcp-edit/);
  assert.match(terminalAiSettingsSource, /terminalAiMcpHeaders/);
  assert.match(terminalAiSettingsSource, /terminalAiProvidersDraft/);
  assert.match(terminalAiSettingsSource, /settings-ai-provider-switch/);
  assert.match(terminalAiSettingsSource, /settings-ai-provider-add/);
  assert.match(terminalAiSettingsSource, /settings-ai-provider-remove/);
  assert.match(terminalAiCssSource, /\.terminal-ai-settings-actions\s*\{[^}]*position:sticky/);
  assert.match(terminalAiCssSource, /\.terminal-ai-composer-popover select,\s*\n\.terminal-ai-settings select[\s\S]*background-image:url\([^)]*\) !important/);
  assert.match(terminalAiCssSource, /html\[data-theme="dark"\] \.terminal-ai-composer-popover select,[\s\S]*background-image:url\([^)]*\) !important/);
  assert.equal(terminalAiSource.includes("while (!controller.signal.aborted && state.requestId === requestId)"), true);
  assert.equal(terminalAiSource.includes("terminalAiAgentContinuationPrompt(originalPrompt, results)"), true);
 assert.match(terminalAiTasksSource, /function terminalAiTaskPlanHtml/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskDockHtml/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskCreateCheckpoint/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskResume/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskSummaryFromAnswer/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskDurationLabel/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskAttemptedCommands/);
  assert.match(terminalAiTasksSource, /function terminalAiDuplicateSummaryPrompt/);
  assert.match(terminalAiTasksSource, /function terminalAiAgentTargetContexts/);
  assert.match(terminalAiTasksSource, /function terminalAiPlatformContext/);
  assert.match(terminalAiTasksSource, /function terminalAiTaskDiagnostics/);
  assert.match(terminalAiSource, /terminalAiDuplicateSummaryPrompt/);
  assert.match(terminalAiSource, /taskStep, "skipped"/);
  assert.doesNotMatch(terminalAiSource, /repeatedCommand && turn\) turn\.error/);
  assert.match(terminalAiActionsSource, /function terminalAiSanitizeWorkflowCommand/);
  assert.match(terminalAiTasksSource, /task.durationMs/);
  assert.match(terminalAiTasksSource, /task_step_records/);
  assert.match(terminalAiTasksSource, /task_result_summary/);
 assert.match(terminalAiTasksSource, /task_recovery_prompt/);
  assert.match(terminalAiTasksSource, /TERMINAL_AI_MAX_TASK_PLAN/);
  assert.doesNotMatch(terminalAiTasksSource, /steps\.slice\(\)\.reverse\(\)\.slice\(0, 12\)/);
  assert.match(terminalAiTasksSource, /join\("\\n"\)/);
  assert.doesNotMatch(terminalAiTasksSource, /\\\\s\+|\\\\r\?\\\\n/);
  assertAgentTaskTiming(terminalAiTasksSource);
  assertAgentTaskDock(terminalAiTasksSource);
  assertTerminalAiInteractionGuards(terminalAiSource, terminalAiRenderSource);
  assert.match(terminalAiRenderSource, /terminal-ai-save-snippet/);
  assert.match(terminalAiSource, /terminal-ai-waiting-input-submit/);
  assert.match(terminalAiSource, /terminalAiWaitingInputCopy/);
  assert.match(terminalAiSource, /const executedCommands = typeof terminalAiTaskAttemptedCommands/);
  assert.match(terminalAiSource, /terminal:ai\.agent_repeated/);
  assert.match(terminalAiCssSource, /terminal-ai-waiting-input-form button\.primary > span/);
  assert.match(terminalAiSource, /function submitTerminalAiWaitingInput/);
  assert.match(terminalCommandTrackingSource, /terminalAiResumeAfterWaitingInput\(session\.key, waiting, baselineOutput\)/);
  assert.match(terminalAiRenderSource, /TERMINAL_AI_COMMAND_MAX_LENGTH = 100000/);
  assert.match(terminalAiRenderSource, /terminal-ai-block-stop/);
  assert.match(commandSnippetsSource, /function commandSnippetVariables/);
  assert.match(commandSnippetsSource, /data-snippet-preview/);
  assert.match(commandSnippetsSource, /workflow_missing_parameter/);
  assert.match(commandSnippetsSource, /workflow_types/);
  assert.match(commandSnippetsSource, /expandSnippetSteps/);
  assert.match(commandSnippetsSource, /workflow_dry_run_notice/);
  assert.match(terminalAiSource, /terminal-ai-task-dock/);
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
  assert.match(mcpServiceSource, /function validateMcpArguments/);
  assert.match(mcpServiceSource, /function mcpToolRisk/);
  assert.match(mcpServiceSource, /runWithReconnect/);
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
  assert.equal(validateMcpArguments({type:"object",properties:{port:{type:"integer"}},required:["port"],additionalProperties:false},{port:22}).valid, true);
  assert.equal(validateMcpArguments({type:"object",properties:{port:{type:"integer"}},required:["port"],additionalProperties:false},{port:"22"}).valid, false);
  assert.equal(mcpToolRisk({name:"delete_file", annotations:{destructiveHint:true}}), "write");
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
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1", reasoning_effort:"xhigh", deep_thinking:true},
      message:"xhigh test"
    });
    const xhighResponseBody = JSON.parse(requestOptions.body);
    assert.equal(xhighResponseBody.reasoning.effort, "xhigh");

    await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1", reasoning_effort:"minimal"},
      message:"minimal test"
    });
    const minimalResponseBody = JSON.parse(requestOptions.body);
    assert.equal(minimalResponseBody.reasoning.effort, "minimal");

    await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1", reasoning_effort:"max", deep_thinking:true},
      message:"max test"
    });
    const maxResponseBody = JSON.parse(requestOptions.body);
    assert.equal(maxResponseBody.reasoning.effort, "max");

    await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1", reasoning_effort:"none", deep_thinking:true},
      message:"deep thinking fallback test"
    });
    const deepThinkingBody = JSON.parse(requestOptions.body);
    assert.equal(deepThinkingBody.reasoning.effort, "high");

    const chatResult = await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-model", endpoint:"http://127.0.0.1:39001/v1"},
      apiKey:"fixture-api-key",
      message:"当前终端状态是什么？",
      contexts:[{source:"terminal", title:"fixture", text:"root@Test:~# echo ok\nok\nroot@Test:~#"}],
      locale:"zh-CN",
      permission:"confirm",
      mode:"chat"
    });
    assert.equal(chatResult.content, "Responses result");
    const chatResponseBody = JSON.parse(requestOptions.body);
    const chatSystemPrompt = String(chatResponseBody.input?.[0]?.content || "");
    assert.equal(chatSystemPrompt.includes("read-only terminal chat assistant"), true);
    assert.equal(chatSystemPrompt.includes("只读聊天模式"), true);
    assert.equal(chatSystemPrompt.includes("Do not output shell code blocks"), true);
    assert.equal(chatSystemPrompt.includes("Never ask the user to send, copy, paste, attach, quote, share, or relay terminal output"), true);
    assert.equal(chatSystemPrompt.includes("never say 'run it and send me the output'"), true);
    assert.equal(chatSystemPrompt.includes("automatically includes the latest terminal buffer"), true);
    assert.equal(chatSystemPrompt.includes("at most one complete shell code block"), false);
    assert.equal(chatSystemPrompt.includes("For the first response of a terminal task"), false);
    assert.equal(chatSystemPrompt.includes("Every command execution requires user confirmation"), false);

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

    await requestAiChat({
      settings:{...DEFAULT_AI_SETTINGS, enabled:true, model:"fixture-completions", api_type:"completions", endpoint:"http://127.0.0.1:39001/v1", reasoning_effort:"max"},
      message:"max completions test"
    });
    assert.equal(JSON.parse(requestOptions.body).reasoning_effort, "max");

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

    let savedAi = { ...DEFAULT_AI_SETTINGS, active_provider_id:"primary", providers:[
      {id:"primary", name:"Primary", endpoint:"https://primary.example/v1", model:"p-model", api_type:"responses", api_key:"primary-secret"},
      {id:"secondary", name:"Secondary", endpoint:"https://secondary.example/v1", model:"s-model", api_type:"responses", api_key:"secondary-secret"}
    ], endpoint:"https://primary.example/v1", model:"p-model", api_key:"primary-secret" };
    let persistedAi = null;
    const saveResponse = {};
    await handleAiRoutes({method:"PUT"}, saveResponse, "/api/ai/settings", {
      isDesktopRequest:() => false,
      isDirectLoopbackRequest:() => true,
      readJson:async () => ({ai:{
        enabled:true,
        active_provider_id:"secondary",
        providers:[
          {id:"primary", name:"Primary renamed", endpoint:"https://primary.example/v1", model:"p-model", api_type:"responses"},
          {id:"secondary", name:"Secondary", endpoint:"https://secondary.example/v1", model:"s-model", api_type:"responses"}
        ]
      }}),
      readRuntimeSettings:() => ({ai:savedAi}),
      writeRuntimeSettings:(_file, value) => { persistedAi = value.ai; savedAi = value.ai; },
      normalizeRuntimeSettings:value => ({...value, ai:normalizeAiSettings(value.ai)}),
      runtimeSettingsFile:"fixture",
      sendJson:(_response, value) => { saveResponse.body = value; }
    });
    assert.equal(persistedAi.active_provider_id, "secondary");
    assert.equal(persistedAi.providers.find(item => item.id === "primary").api_key, "primary-secret");
    assert.equal(persistedAi.providers.find(item => item.id === "secondary").api_key, "secondary-secret");
    assert.equal(saveResponse.body.providers.find(item => item.id === "primary").api_key_configured, true);
    assert.equal("api_key" in saveResponse.body.providers.find(item => item.id === "primary"), false);

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
