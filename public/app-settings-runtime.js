function runtimeHostValues(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source.flatMap(item => String(item ?? "").split(/[\s,]+/)).map(item => item.trim()).filter(Boolean))];
}

function runtimePortValue(value, fallback=8088) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function normalizeWorkspaceToolbarPlacement(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const placement = candidate => ["tab", "header"].includes(candidate) ? candidate : "header";
  return {
    unsplit: {
      terminal:placement(source.unsplit?.terminal),
      sftp:placement(source.unsplit?.sftp)
    },
    split: {
      terminal:placement(source.split?.terminal),
      sftp:placement(source.split?.sftp)
    }
  };
}

function notificationDurationMs(value, fallback, nullable=false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 500 && duration <= 60000 ? duration : fallback;
}

function normalizeNotificationDisplay(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const entry = (name, fallbackDuration) => {
    const current = source[name] && typeof source[name] === "object" ? source[name] : {};
    return {
      enabled:current.enabled !== false,
      duration_ms:notificationDurationMs(current.duration_ms, fallbackDuration)
    };
  };
  const progress = source.progress && typeof source.progress === "object" ? source.progress : {};
  return {
    info:entry("info", 3500),
    success:entry("success", 3500),
    error:entry("error", 8000),
    progress:{
      enabled:progress.enabled !== false,
      success_duration_ms:notificationDurationMs(progress.success_duration_ms, null, true),
      error_duration_ms:notificationDurationMs(progress.error_duration_ms, 8000)
    }
  };
}

const TERMINAL_AI_BUILTIN_SKILL_IDS = ["linux-diagnostics", "security-audit", "log-analysis", "service-troubleshooting", "network-diagnostics", "performance-analysis", "container-troubleshooting", "git-workflow", "incident-response", "web-research"];
const TERMINAL_AI_DEFAULT_SKILL_IDS = TERMINAL_AI_BUILTIN_SKILL_IDS.slice(0, 4);
const TERMINAL_AI_MCP_PRESETS = Object.freeze({
  "web-fetch":{name:"Web Fetch", transport:"stdio", command:"uvx", args:["mcp-server-fetch"]},
  "brave-search":{name:"Brave Search", transport:"stdio", command:"npx", args:["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]},
  github:{name:"GitHub (read-only)", transport:"stdio", command:"github-mcp-server", args:["stdio", "--read-only"]},
  playwright:{name:"Playwright", transport:"stdio", command:"npx", args:["-y", "@playwright/mcp@latest", "--headless", "--isolated"]},
  memory:{name:"Memory", transport:"stdio", command:"npx", args:["-y", "@modelcontextprotocol/server-memory"]}
});

function normalizeAiSettingsResponse(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const endpoint = String(source.endpoint || "https://api.openai.com/v1").trim() || "https://api.openai.com/v1";
  const model = String(source.model || "").trim();
  return {
    enabled:source.enabled === true,
    provider:"openai-compatible",
    endpoint:endpoint.slice(0, 2048),
    model:model.slice(0, 200),
    api_type:source.api_type === "completions" ? "completions" : "responses",
    reasoning_effort:["none", "low", "medium", "high"].includes(String(source.reasoning_effort || "").toLowerCase()) ? String(source.reasoning_effort).toLowerCase() : "none",
    deep_thinking:source.deep_thinking === true,
    timeout_seconds:Math.max(5, Math.min(300, Number(source.timeout_seconds) || 60)),
    context_tokens:Math.max(1000, Math.min(1000000, Number(source.context_tokens ?? (source.context_chars !== undefined ? Number(source.context_chars) / 4 : 1000000)) || 1000000)),
    terminal_ai_placement:source.terminal_ai_placement === "bottom" ? "bottom" : "right",
    terminal_ai_permission:["suggest", "confirm", "controlled", "full"].includes(source.terminal_ai_permission) ? source.terminal_ai_permission : "confirm",
    skills_enabled:[...new Set((Array.isArray(source.skills_enabled) ? source.skills_enabled : TERMINAL_AI_DEFAULT_SKILL_IDS).map(item => String(item || "")).filter(item => TERMINAL_AI_BUILTIN_SKILL_IDS.includes(item)))],
    user_skills:Array.isArray(source.user_skills) ? source.user_skills.map(item => ({id:String(item?.id || ""), name:String(item?.name || ""), description:String(item?.description || ""), prompt:String(item?.prompt || ""), enabled:item?.enabled !== false})).filter(item => item.id && item.name && item.prompt) : [],
    mcp_servers:Array.isArray(source.mcp_servers) ? source.mcp_servers.map(item => ({
      id:String(item?.id || ""),
      name:String(item?.name || ""),
      transport:item?.transport === "sse" ? "sse" : (["http", "streamable-http"].includes(item?.transport) ? "streamable-http" : "stdio"),
      command:String(item?.command || ""),
      args:Array.isArray(item?.args) ? item.args.map(String) : [],
      url:String(item?.url || ""),
      headers:item?.headers && typeof item.headers === "object" && !Array.isArray(item.headers) ? Object.fromEntries(Object.entries(item.headers).map(([name, value]) => [String(name), String(value ?? "")])) : {},
      enabled:item?.enabled === true,
      timeout_ms:Number(item?.timeout_ms || 30000),
      tools:Array.isArray(item?.tools) ? item.tools.map(tool => ({
        name:String(tool?.name || ""),
        description:String(tool?.description || ""),
        inputSchema:tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {},
        enabled:tool?.enabled !== false,
        requires_approval:tool?.requires_approval !== false
      })).filter(tool => tool.name) : [],
      tools_updated_at:Number(item?.tools_updated_at || 0)
    })).filter(item => item.id && item.name) : [],
    api_key_configured:source.api_key_configured === true || Boolean(source.api_key)
  };
}

let terminalAiAvailableModels = [];
let terminalAiUserSkillsDraft = [];
let terminalAiMcpServersDraft = [];
let terminalAiSettingsDraftDirty = false;
let terminalAiMcpEditorDraft = null;

function terminalAiModelOptionsHtml(current="") {
  const selected = String(current || "").trim();
  const models = [...new Set([selected, ...terminalAiAvailableModels].map(item => String(item || "").trim()).filter(Boolean))];
  return `<option value="" ${selected ? "" : "selected"}>${esc(tr("settings:ai.model_select", {defaultValue:"请选择模型"}))}</option>${models.map(model => `<option value="${escAttr(model)}" ${model === selected ? "selected" : ""}>${esc(model)}</option>`).join("")}<option value="__custom__">${esc(tr("settings:ai.model_custom", {defaultValue:"手动输入模型名称…"}))}</option>`;
}

function terminalAiModelValue() {
  const select = $("terminalAiModel");
  if (select?.value === "__custom__") return String($("terminalAiModelCustom")?.value || "").trim();
  return String(select?.value || "").trim();
}

function syncTerminalAiModelMode() {
  const select = $("terminalAiModel");
  const custom = $("terminalAiModelCustom");
  if (!select || !custom) return;
  const manual = select.value === "__custom__";
  custom.hidden = !manual;
  custom.disabled = !manual;
  if (manual) custom.focus();
}

function syncTerminalAiModelOptions(models, preferred="") {
  terminalAiAvailableModels = [...new Set((Array.isArray(models) ? models : []).map(item => String(item || "").trim()).filter(Boolean))];
  const select = $("terminalAiModel");
  if (!select) return;
  const current = String(preferred || terminalAiModelValue() || "").trim();
  select.innerHTML = terminalAiModelOptionsHtml(current);
  select.value = current && [...select.options].some(option => option.value === current) ? current : "";
  syncTerminalAiModelMode();
}

function terminalAiMcpToolsHtml(server, serverIndex) {
  const tools = Array.isArray(server?.tools) ? server.tools : [];
  if (!tools.length) return `<div class="terminal-ai-mcp-tools-empty muted">${esc(tr("settings:ai.mcp_tools_empty", {defaultValue:"尚未发现工具，点击服务器右侧的搜索按钮获取。"}))}</div>`;
  return `<details class="terminal-ai-mcp-tools"><summary><span>${icon("wrench")}<b>${esc(tr("settings:ai.mcp_tools", {defaultValue:"工具"}))}</b></span><span class="terminal-ai-mcp-tools-count">${tools.length}</span></summary><div class="terminal-ai-mcp-tool-list">${tools.map((tool, toolIndex) => {
    const schema = tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {};
    const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties).slice(0, 6) : [];
    const schemaText = properties.length ? ` · ${properties.join(", ")}` : "";
    return `<div class="terminal-ai-mcp-tool-row"><div class="terminal-ai-mcp-tool-copy"><strong>${icon(tool?.requires_approval === false ? "zap" : "shield-check")}${esc(tool.name)}</strong><small>${esc(String(tool.description || tr("settings:ai.mcp_tool_no_description", {defaultValue:"无描述"})))}${esc(schemaText)}</small></div><label class="check-row compact"><input type="checkbox" data-change-action="settings-ai-mcp-tool-enabled" data-mcp-index="${serverIndex}" data-mcp-tool-index="${toolIndex}" ${tool.enabled !== false ? "checked" : ""}>${esc(tr("settings:ai.mcp_tool_enabled", {defaultValue:"启用"}))}</label><label class="check-row compact"><input type="checkbox" data-change-action="settings-ai-mcp-tool-approval" data-mcp-index="${serverIndex}" data-mcp-tool-index="${toolIndex}" ${tool.requires_approval !== false ? "checked" : ""}>${esc(tr("settings:ai.mcp_tool_approval", {defaultValue:"调用需确认"}))}</label></div>`;
  }).join("")}</div></details>`;
}

function terminalAiMcpTransportLabel(value) {
  if (value === "sse") return "HTTP / SSE";
  if (value === "streamable-http" || value === "http") return "Streamable HTTP";
  return "stdio";
}

function terminalAiMcpRowsHtml() {
  return terminalAiMcpServersDraft.map((item, index) => `<div class="terminal-ai-mcp-row"><span>${icon("plug")}<b>${esc(item.name)}</b><small>${esc(terminalAiMcpTransportLabel(item.transport))} · ${item.enabled ? esc(tr("settings:ai.mcp_enabled", {defaultValue:"已启用"})) : esc(tr("settings:ai.mcp_disabled", {defaultValue:"已禁用"}))}</small></span><div><button type="button" class="icon-button" data-action="settings-ai-mcp-edit" data-mcp-index="${index}" title="${escAttr(tr("settings:ai.mcp_edit", {defaultValue:"编辑 MCP 服务器"}))}" aria-label="${escAttr(tr("settings:ai.mcp_edit", {defaultValue:"编辑 MCP 服务器"}))}">${icon("pencil")}</button><button type="button" class="icon-button" data-action="settings-ai-mcp-discover" data-mcp-index="${index}" title="${escAttr(tr("settings:ai.mcp_discover", {defaultValue:"发现工具"}))}" aria-label="${escAttr(tr("settings:ai.mcp_discover", {defaultValue:"发现工具"}))}">${icon("search")}</button><button type="button" class="icon-button danger" data-action="settings-ai-mcp-remove" data-mcp-index="${index}" title="${escAttr(tr("settings:ai.mcp_remove", {defaultValue:"删除 MCP 服务器"}))}" aria-label="${escAttr(tr("settings:ai.mcp_remove", {defaultValue:"删除 MCP 服务器"}))}">${icon("trash-2")}</button></div></div>`).join("");
}

function terminalAiMcpEditorHtml() {
  const draft = terminalAiMcpEditorDraft && typeof terminalAiMcpEditorDraft === "object" ? terminalAiMcpEditorDraft : {};
  const transport = draft.transport === "sse" ? "sse" : (["http", "streamable-http"].includes(draft.transport) ? "streamable-http" : "stdio");
  const remote = transport !== "stdio";
  const editing = Boolean(draft.id);
  const headers = draft.headers && typeof draft.headers === "object" && !Array.isArray(draft.headers) ? draft.headers : {};
  return `<div class="terminal-ai-mcp-editor" data-mcp-editing-id="${escAttr(draft.id || "")}"><input id="terminalAiMcpName" maxlength="120" value="${escAttr(draft.name || "")}" placeholder="${escAttr(tr("settings:ai.mcp_name", {defaultValue:"服务器名称"}))}"><select id="terminalAiMcpTransport" data-change-action="settings-ai-mcp-transport"><option value="stdio" ${transport === "stdio" ? "selected" : ""}>stdio</option><option value="sse" ${transport === "sse" ? "selected" : ""}>HTTP / SSE</option><option value="streamable-http" ${transport === "streamable-http" ? "selected" : ""}>Streamable HTTP</option></select><input id="terminalAiMcpCommand" data-mcp-transport-field="stdio" maxlength="300" value="${escAttr(draft.command || "")}" placeholder="${escAttr(tr("settings:ai.mcp_command", {defaultValue:"stdio 命令"}))}" ${remote ? "hidden disabled" : ""}><input id="terminalAiMcpUrl" data-mcp-transport-field="remote" maxlength="2048" value="${escAttr(draft.url || "")}" placeholder="${escAttr(transport === "sse" ? tr("settings:ai.mcp_sse_url", {defaultValue:"SSE 连接地址"}) : tr("settings:ai.mcp_streamable_url", {defaultValue:"Streamable HTTP 地址"}))}" ${remote ? "" : "hidden disabled"}><textarea id="terminalAiMcpArgs" data-mcp-transport-field="stdio" maxlength="10000" rows="2" spellcheck="false" placeholder="${escAttr(tr("settings:ai.mcp_args", {defaultValue:"stdio 参数（JSON 数组）"}))}" ${remote ? "hidden disabled" : ""}>${esc(JSON.stringify(Array.isArray(draft.args) ? draft.args : []))}</textarea><textarea id="terminalAiMcpHeaders" data-mcp-transport-field="remote" maxlength="16000" rows="3" spellcheck="false" placeholder='${escAttr(tr("settings:ai.mcp_headers", {defaultValue:'请求头（可选 JSON 对象，例如 {"Authorization":"Bearer …"}）'}))}' ${remote ? "" : "hidden disabled"}>${esc(Object.keys(headers).length ? JSON.stringify(headers, null, 2) : "")}</textarea><div class="terminal-ai-mcp-header-hint muted" data-mcp-transport-field="remote" ${remote ? "" : "hidden"}>${esc(tr("settings:ai.mcp_headers_hint", {defaultValue:"请求头只保存在本机；编辑时留空已有值表示保持原值，删除字段表示移除。协议请求头由 Terma 管理。"}))}</div><label class="check-row"><input id="terminalAiMcpEnabled" type="checkbox" ${draft.enabled ? "checked" : ""}> ${esc(tr("settings:ai.mcp_enable", {defaultValue:"启用服务器"}))}</label><div class="terminal-ai-mcp-editor-actions"><button type="button" data-action="settings-ai-mcp-add">${icon(editing ? "save" : "plus")}<span>${esc(editing ? tr("settings:ai.mcp_update", {defaultValue:"保存修改"}) : tr("settings:ai.mcp_add", {defaultValue:"添加服务器"}))}</span></button>${editing ? `<button type="button" data-action="settings-ai-mcp-edit-cancel">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button>` : ""}</div></div>`;
}

function syncTerminalAiMcpTransportFields() {
  const transport = ["sse", "streamable-http"].includes($("terminalAiMcpTransport")?.value) ? $("terminalAiMcpTransport").value : "stdio";
  document.querySelectorAll("[data-mcp-transport-field]").forEach(element => {
    const visible = element.dataset.mcpTransportField === (transport === "stdio" ? "stdio" : "remote");
    element.hidden = !visible;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) element.disabled = !visible;
  });
  const url = $("terminalAiMcpUrl");
  if (url) url.placeholder = transport === "sse"
    ? tr("settings:ai.mcp_sse_url", {defaultValue:"SSE 连接地址"})
    : tr("settings:ai.mcp_streamable_url", {defaultValue:"Streamable HTTP 地址"});
}

function renderTerminalAiMcpTools() {
  const list = $("terminalAiMcpList");
  if (!list) return;
  list.querySelectorAll(":scope > .terminal-ai-mcp-tools, :scope > .terminal-ai-mcp-tools-empty").forEach(item => item.remove());
  [...list.querySelectorAll(":scope > .terminal-ai-mcp-row")].forEach(row => {
    const index = Number(row.querySelector("[data-mcp-index]")?.dataset.mcpIndex);
    if (!Number.isInteger(index) || !terminalAiMcpServersDraft[index]) return;
    const actions = row.querySelector(":scope > div:last-child");
    if (actions && !actions.querySelector("[data-mcp-server-enabled]")) {
      actions.insertAdjacentHTML("afterbegin", `<label class="check-row compact"><input type="checkbox" data-change-action="settings-ai-mcp-server-enabled" data-mcp-server-enabled data-mcp-index="${index}" ${terminalAiMcpServersDraft[index].enabled ? "checked" : ""}>${esc(tr("settings:ai.mcp_enable", {defaultValue:"启用"}))}</label>`);
    }
    row.insertAdjacentHTML("afterend", terminalAiMcpToolsHtml(terminalAiMcpServersDraft[index], index));
  });
  syncTerminalAiMcpTransportFields();
}

function aiSettingsPanelHtml() {
  const ai = normalizeAiSettingsResponse(runtimeSettings?.saved?.ai || runtimeSettings?.ai);
  if (!terminalAiSettingsDraftDirty) {
    terminalAiUserSkillsDraft = ai.user_skills.map(item => ({...item}));
    terminalAiMcpServersDraft = ai.mcp_servers.map(item => ({...item}));
  }
  const keyHint = ai.api_key_configured
    ? tr("settings:ai.key_configured", {defaultValue:"已保存 API 密钥（不会显示原文）"})
    : tr("settings:ai.key_not_configured", {defaultValue:"未保存 API 密钥；本地模型通常无需密钥。"});
  return `<section class="terminal-ai-settings">
    <div class="settings-subsection-head"><div><h3>${esc(tr("settings:ai.title", {defaultValue:"终端 AI"}))}</h3></div><span class="status-pill ${ai.enabled ? "running" : "muted"}">${esc(tr(ai.enabled ? "settings:ai.enabled" : "settings:ai.disabled", {defaultValue:ai.enabled ? "已启用" : "未启用"}))}</span></div>
    <label class="check-row"><input id="terminalAiEnabled" type="checkbox" ${ai.enabled ? "checked" : ""}> ${esc(tr("settings:ai.enable", {defaultValue:"启用终端 AI"}))}</label>
    <div class="muted">${esc(tr("settings:ai.safe_hint", {defaultValue:"未启用、服务不可用或请求失败时，终端和日志仍按原流程工作。只发送你明确选择的上下文。"}))}</div>
    <div class="grid terminal-ai-settings-grid">
      <div><label for="terminalAiProvider">${esc(tr("settings:ai.provider", {defaultValue:"提供商"}))}</label><select id="terminalAiProvider" disabled><option value="openai-compatible">${esc(tr("settings:ai.provider_openai", {defaultValue:"OpenAI 兼容 API"}))}</option></select></div>
      <div><label for="terminalAiModel">${esc(tr("settings:ai.model", {defaultValue:"模型"}))}</label><div class="terminal-ai-model-row"><select id="terminalAiModel" data-change-action="settings-ai-model-mode">${terminalAiModelOptionsHtml(ai.model)}</select><button id="terminalAiModelsBtn" type="button" data-action="settings-ai-fetch-models" title="${escAttr(tr("settings:ai.fetch_models", {defaultValue:"从接口获取模型"}))}">${icon("refresh-cw")}<span>${esc(tr("settings:ai.fetch_models_short", {defaultValue:"获取"}))}</span></button></div><input id="terminalAiModelCustom" class="terminal-ai-model-custom" value="" maxlength="200" spellcheck="false" placeholder="${escAttr(tr("settings:ai.model_custom_placeholder", {defaultValue:"输入接口支持的模型名称"}))}" hidden disabled></div>
    </div>
    <div class="grid terminal-ai-settings-grid">
      <div><label for="terminalAiApiType">${esc(tr("settings:ai.api_type", {defaultValue:"接口类型"}))}</label><select id="terminalAiApiType"><option value="responses" ${ai.api_type === "responses" ? "selected" : ""}>${esc(tr("settings:ai.responses", {defaultValue:"Responses（默认）"}))}</option><option value="completions" ${ai.api_type === "completions" ? "selected" : ""}>${esc(tr("settings:ai.completions", {defaultValue:"Chat Completions"}))}</option></select></div>
      <div><label for="terminalAiPlacement">${esc(tr("settings:ai.placement", {defaultValue:"终端 AI 位置"}))}</label><select id="terminalAiPlacement"><option value="right" ${ai.terminal_ai_placement === "right" ? "selected" : ""}>${esc(tr("settings:ai.placement_right", {defaultValue:"右侧（默认）"}))}</option><option value="bottom" ${ai.terminal_ai_placement === "bottom" ? "selected" : ""}>${esc(tr("settings:ai.placement_bottom", {defaultValue:"下方"}))}</option></select></div>
    </div>
    <div class="grid terminal-ai-settings-grid terminal-ai-reasoning-settings">
      <div><label for="terminalAiReasoningEffort">${esc(tr("settings:ai.reasoning_effort", {defaultValue:"推理强度"}))}</label><select id="terminalAiReasoningEffort"><option value="none" ${ai.reasoning_effort === "none" ? "selected" : ""}>${esc(tr("settings:ai.reasoning_none", {defaultValue:"关闭"}))}</option><option value="low" ${ai.reasoning_effort === "low" ? "selected" : ""}>${esc(tr("settings:ai.reasoning_low", {defaultValue:"低"}))}</option><option value="medium" ${ai.reasoning_effort === "medium" ? "selected" : ""}>${esc(tr("settings:ai.reasoning_medium", {defaultValue:"中"}))}</option><option value="high" ${ai.reasoning_effort === "high" ? "selected" : ""}>${esc(tr("settings:ai.reasoning_high", {defaultValue:"高"}))}</option></select><small class="muted">${esc(tr("settings:ai.reasoning_current", {effort:ai.reasoning_effort, defaultValue:`当前：${ai.reasoning_effort}`}))}</small></div>
      <div><label class="check-row"><input id="terminalAiDeepThinking" type="checkbox" ${ai.deep_thinking ? "checked" : ""}> ${esc(tr("settings:ai.deep_thinking", {defaultValue:"深度思考"}))}</label><small class="muted">${esc(tr("settings:ai.deep_thinking_hint", {defaultValue:"开启后请求会优先使用高推理强度；是否生效取决于服务商。界面只显示服务商返回的推理摘要，不显示隐藏思维链。"}))}</small></div>
    </div>
    <label for="terminalAiPermission">${esc(tr("settings:ai.permission", {defaultValue:"Agent 默认执行权限"}))}</label>
     <select id="terminalAiPermission" data-change-action="settings-ai-permission" data-committed-permission="${escAttr(ai.terminal_ai_permission)}"><option value="suggest" ${ai.terminal_ai_permission === "suggest" ? "selected" : ""}>${esc(tr("settings:ai.permission_suggest", {defaultValue:"仅建议"}))}</option><option value="confirm" ${ai.terminal_ai_permission === "confirm" ? "selected" : ""}>${esc(tr("settings:ai.permission_confirm", {defaultValue:"逐步确认（默认）"}))}</option><option value="controlled" ${ai.terminal_ai_permission === "controlled" ? "selected" : ""}>${esc(tr("settings:ai.permission_controlled", {defaultValue:"受控自动"}))}</option><option value="full" ${ai.terminal_ai_permission === "full" ? "selected" : ""}>${esc(tr("settings:ai.permission_full", {defaultValue:"完全访问"}))}</option></select>
    <div class="muted">${esc(tr("settings:ai.permission_hint", {defaultValue:"受控自动只会自动运行明确的只读命令；写入、删除、提权、安装、网络和服务变更仍需实时确认。"}))}</div>
    <fieldset class="terminal-ai-skills"><legend>${esc(tr("settings:ai.skills", {defaultValue:"内置 Skills"}))}</legend><div class="terminal-ai-skills-grid">
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="linux-diagnostics" ${ai.skills_enabled.includes("linux-diagnostics") ? "checked" : ""}> ${esc(tr("settings:ai.skill_linux", {defaultValue:"Linux 诊断"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="security-audit" ${ai.skills_enabled.includes("security-audit") ? "checked" : ""}> ${esc(tr("settings:ai.skill_security", {defaultValue:"安全审计"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="log-analysis" ${ai.skills_enabled.includes("log-analysis") ? "checked" : ""}> ${esc(tr("settings:ai.skill_logs", {defaultValue:"日志分析"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="service-troubleshooting" ${ai.skills_enabled.includes("service-troubleshooting") ? "checked" : ""}> ${esc(tr("settings:ai.skill_services", {defaultValue:"服务排障"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="network-diagnostics" ${ai.skills_enabled.includes("network-diagnostics") ? "checked" : ""}> ${esc(tr("settings:ai.skill_network", {defaultValue:"网络排障"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="performance-analysis" ${ai.skills_enabled.includes("performance-analysis") ? "checked" : ""}> ${esc(tr("settings:ai.skill_performance", {defaultValue:"性能分析"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="container-troubleshooting" ${ai.skills_enabled.includes("container-troubleshooting") ? "checked" : ""}> ${esc(tr("settings:ai.skill_containers", {defaultValue:"容器排障"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="git-workflow" ${ai.skills_enabled.includes("git-workflow") ? "checked" : ""}> ${esc(tr("settings:ai.skill_git", {defaultValue:"Git 工作流"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="incident-response" ${ai.skills_enabled.includes("incident-response") ? "checked" : ""}> ${esc(tr("settings:ai.skill_incident", {defaultValue:"故障应急"}))}</label>
      <label class="check-row"><input type="checkbox" data-terminal-ai-skill="web-research" ${ai.skills_enabled.includes("web-research") ? "checked" : ""}> ${esc(tr("settings:ai.skill_web", {defaultValue:"联网检索"}))}</label>
     </div><div class="muted">${esc(tr("settings:ai.skills_hint", {defaultValue:"选中的 Skills 会作为受信任的系统工作流参与每次终端与日志 AI 请求。"}))}</div></fieldset>
     <fieldset class="terminal-ai-skills"><legend>${esc(tr("settings:ai.user_skills", {defaultValue:"用户 Skills"}))}</legend><div id="terminalAiUserSkillsList" class="terminal-ai-user-skills-list">${terminalAiUserSkillsDraft.map((item, index) => `<div class="terminal-ai-user-skill-row" data-user-skill-index="${index}"><label class="check-row"><input type="checkbox" data-user-skill-enabled ${item.enabled ? "checked" : ""}> <span>${esc(item.name)}</span></label><small>${esc(item.description || "")}</small><button type="button" class="icon-button danger" data-action="settings-ai-skill-remove" data-skill-index="${index}" title="${escAttr(tr("settings:ai.skill_remove", {defaultValue:"删除 Skill"}))}" aria-label="${escAttr(tr("settings:ai.skill_remove", {defaultValue:"删除 Skill"}))}">${icon("trash-2")}</button></div>`).join("")}</div><div class="terminal-ai-user-skill-editor"><input id="terminalAiSkillName" maxlength="120" placeholder="${escAttr(tr("settings:ai.skill_name", {defaultValue:"名称"}))}"><input id="terminalAiSkillDescription" maxlength="300" placeholder="${escAttr(tr("settings:ai.skill_description", {defaultValue:"说明（可选）"}))}"><textarea id="terminalAiSkillPrompt" maxlength="12000" rows="2" placeholder="${escAttr(tr("settings:ai.skill_prompt", {defaultValue:"提示内容"}))}"></textarea><button type="button" data-action="settings-ai-skill-add">${icon("plus")}<span>${esc(tr("settings:ai.skill_add", {defaultValue:"添加 Skill"}))}</span></button></div><div class="muted">${esc(tr("settings:ai.user_skills_hint", {defaultValue:"用户 Skill 只提供提示内容，不会获得额外命令或文件权限。"}))}</div></fieldset>
     <fieldset class="terminal-ai-skills"><legend>${esc(tr("settings:ai.mcp", {defaultValue:"MCP 服务器"}))}</legend><div class="terminal-ai-mcp-presets"><span>${esc(tr("settings:ai.mcp_presets", {defaultValue:"常用预设"}))}</span>${Object.entries(TERMINAL_AI_MCP_PRESETS).map(([id, preset]) => `<button type="button" data-action="settings-ai-mcp-preset" data-mcp-preset="${escAttr(id)}">${esc(preset.name)}</button>`).join("")}</div><div id="terminalAiMcpList" class="terminal-ai-mcp-list">${terminalAiMcpRowsHtml()}</div>${terminalAiMcpEditorHtml()}<div class="muted">${esc(tr("settings:ai.mcp_hint", {defaultValue:"MCP 服务器默认禁用；启用后仍按 Agent 权限调用。stdio、HTTP / SSE 和 Streamable HTTP 会分别使用对应连接字段；连接失败不会影响普通终端。"}))}</div></fieldset>
    <label for="terminalAiEndpoint">${esc(tr("settings:ai.endpoint", {defaultValue:"API 地址"}))}</label>
    <input id="terminalAiEndpoint" value="${escAttr(ai.endpoint)}" maxlength="2048" spellcheck="false" placeholder="https://api.openai.com/v1">
    <div class="grid terminal-ai-settings-grid">
      <div><label for="terminalAiTimeout">${esc(tr("settings:ai.timeout", {defaultValue:"请求超时（秒）"}))}</label><input id="terminalAiTimeout" type="number" min="5" max="300" step="1" value="${ai.timeout_seconds}"></div>
      <div><label for="terminalAiContextValue">${esc(tr("settings:ai.context_limit", {defaultValue:"Terma 上下文预算"}))}</label><div class="terminal-ai-context-row"><input id="terminalAiContextValue" type="number" min="1" max="1000" step="0.01" value="${ai.context_tokens >= 1000000 ? (ai.context_tokens / 1000000).toFixed(2).replace(/0+$/,"").replace(/\.$/,"") : (ai.context_tokens / 1000).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}"><select id="terminalAiContextUnit"><option value="K" ${ai.context_tokens < 1000000 ? "selected" : ""}>K</option><option value="M" ${ai.context_tokens >= 1000000 ? "selected" : ""}>M</option></select><span>tokens</span></div><div class="muted terminal-ai-context-settings-hint">${esc(tr("settings:ai.context_limit_hint", {defaultValue:"Terma 按约 4 个字符折算 1 token 限制发送的终端和附件上下文；服务商实际上下文窗口以接口为准。"}))}</div></div>
    </div>
    <label for="terminalAiApiKey">${esc(tr("settings:ai.api_key", {defaultValue:"API 密钥（可选）"}))}</label>
    <input id="terminalAiApiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${escAttr(ai.api_key_configured ? tr("settings:ai.key_keep_placeholder", {defaultValue:"留空表示保持已保存密钥"}) : tr("settings:ai.key_placeholder", {defaultValue:"仅保存在本机设置中"}))}">
    <label class="check-row"><input id="terminalAiClearKey" type="checkbox"> ${esc(tr("settings:ai.clear_key", {defaultValue:"清除已保存的 API 密钥"}))}</label>
    <div class="muted">${esc(keyHint)} ${esc(tr("settings:ai.key_storage_hint", {defaultValue:"密钥只保存在本机设置中，不会写入终端日志。"}))}</div>
    <pre id="terminalAiTestResult" class="terminal-ai-test-result" hidden></pre>
    <div class="actions"><button id="terminalAiSaveBtn" class="primary" type="button" data-action="settings-ai-save">${icon("save")}<span>${esc(tr("settings:ai.save", {defaultValue:"保存 AI 设置"}))}</span></button><button id="terminalAiTestBtn" type="button" data-action="settings-ai-test">${icon("message-circle")}<span>${esc(tr("settings:ai.test", {defaultValue:"测试（发送 hi）"}))}</span></button></div>
  </section>`;
}

function aiSettingsFormValue(options={}) {
  const endpoint = String($("terminalAiEndpoint")?.value || "").trim();
  const model = terminalAiModelValue();
  const timeout_seconds = Number($("terminalAiTimeout")?.value || 60);
  const contextValue = Number($("terminalAiContextValue")?.value || 1);
  const contextUnit = $("terminalAiContextUnit")?.value === "K" ? "K" : "M";
  const context_tokens = Math.round(contextValue * (contextUnit === "M" ? 1000000 : 1000));
  if (!endpoint) throw new Error(tr("settings:ai.endpoint_required", {defaultValue:"请填写 AI 地址"}));
  if (options.requireModel === true && !model) throw new Error(tr("settings:ai.model_required", {defaultValue:"请先选择或输入模型"}));
  if (!Number.isInteger(timeout_seconds) || timeout_seconds < 5 || timeout_seconds > 300) throw new Error(tr("settings:ai.timeout_invalid", {defaultValue:"AI 请求超时必须是 5-300 秒之间的整数"}));
  if (!Number.isFinite(contextValue) || contextValue <= 0 || context_tokens < 1000 || context_tokens > 1000000) throw new Error(tr("settings:ai.context_invalid", {defaultValue:"AI 上下文长度必须是 1K-1M tokens"}));
  const permission = ["suggest", "confirm", "controlled", "full"].includes($("terminalAiPermission")?.value) ? $("terminalAiPermission").value : "confirm";
  const skills_enabled = [...document.querySelectorAll("[data-terminal-ai-skill]:checked")].map(input => String(input.dataset.terminalAiSkill || "")).filter(Boolean);
  const reasoning_effort = ["none", "low", "medium", "high"].includes($("terminalAiReasoningEffort")?.value) ? $("terminalAiReasoningEffort").value : "none";
  const deep_thinking = Boolean($("terminalAiDeepThinking")?.checked);
  const ai = {enabled:Boolean($("terminalAiEnabled")?.checked), provider:"openai-compatible", endpoint, model, api_type:$("terminalAiApiType")?.value === "completions" ? "completions" : "responses", reasoning_effort, deep_thinking, terminal_ai_placement:$("terminalAiPlacement")?.value === "bottom" ? "bottom" : "right", terminal_ai_permission:permission, skills_enabled, user_skills:terminalAiUserSkillsDraft.map((item, index) => ({...item, enabled:document.querySelector(`[data-user-skill-index="${index}"] [data-user-skill-enabled]`)?.checked !== false})), mcp_servers:terminalAiMcpServersDraft, timeout_seconds, context_tokens};
  const apiKey = String($("terminalAiApiKey")?.value || "").trim();
  if (apiKey) ai.api_key = apiKey;
  return {ai, clear_api_key:Boolean($("terminalAiClearKey")?.checked)};
}

async function saveTerminalAiSettings() {
  const button = $("terminalAiSaveBtn");
  let payload;
  try { payload = aiSettingsFormValue(); }
  catch (error) { notify(error.message, "error"); return; }
  setButtonBusy(button, true, tr("settings:ai.saving", {defaultValue:"保存中"}));
  try {
    const result = await api("/api/ai/settings", {method:"PUT", body:JSON.stringify(payload)});
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ai:result, saved:{...(runtimeSettings?.saved || {}), ai:result}});
    if (typeof terminalAiMcpCatalogCache !== "undefined") terminalAiMcpCatalogCache = {expiresAt:0, contexts:[], tools:[]};
    terminalAiSettingsDraftDirty = false;
    terminalAiMcpEditorDraft = null;
    const input = $("terminalAiApiKey");
    if (input) input.value = "";
    const clear = $("terminalAiClearKey");
    if (clear) clear.checked = false;
    renderSettings();
    if (typeof syncTerminalAiPlacements === "function") syncTerminalAiPlacements();
    if (typeof terminalAiStates !== "undefined" && terminalAiStates instanceof Map) {
      const permission = ["suggest", "confirm", "controlled", "full"].includes(result?.terminal_ai_permission)
        ? result.terminal_ai_permission
        : payload.ai.terminal_ai_permission;
      for (const [key, state] of terminalAiStates) {
        state.permission = permission;
        if (typeof renderTerminalAiPanel === "function") renderTerminalAiPanel(key);
      }
    }
    notify(tr("settings:ai.saved", {defaultValue:"AI 设置已保存"}), "success");
  } catch (error) {
    notify(error.message || tr("settings:ai.save_failed", {defaultValue:"AI 设置保存失败"}), "error");
  } finally {
    setButtonBusy($("terminalAiSaveBtn"), false);
  }
}

async function fetchTerminalAiModels() {
  const button = $("terminalAiModelsBtn");
  let payload;
  try { payload = aiSettingsFormValue(); }
  catch (error) { notify(error.message, "error"); return; }
  setButtonBusy(button, true, tr("settings:ai.fetching_models", {defaultValue:"获取中"}));
  try {
    const result = await api("/api/ai/models", {method:"POST", body:JSON.stringify({ai:{...payload.ai, enabled:true}})});
    const models = Array.isArray(result?.models) ? result.models.map(item => String(item || "").trim()).filter(Boolean) : [];
    if (!models.length) throw new Error(tr("settings:ai.no_models", {defaultValue:"接口没有返回可用模型"}));
    syncTerminalAiModelOptions(models);
    notify(tr("settings:ai.models_loaded", {count:models.length, defaultValue:`已获取 ${models.length} 个模型`}), "success");
  } catch (error) {
    notify(error.message || tr("settings:ai.models_failed", {defaultValue:"获取模型失败"}), "error");
  } finally {
    setButtonBusy($("terminalAiModelsBtn"), false);
  }
}

async function testTerminalAiSettings() {
  const button = $("terminalAiTestBtn");
  const resultBox = $("terminalAiTestResult");
  let payload;
  try { payload = aiSettingsFormValue({requireModel:true}); }
  catch (error) { notify(error.message, "error"); return; }
  setButtonBusy(button, true, tr("settings:ai.testing", {defaultValue:"测试中"}));
  if (resultBox) { resultBox.hidden = false; resultBox.textContent = ""; }
  try {
    if (typeof streamTerminalAiRequest !== "function") throw new Error(tr("settings:ai.stream_unavailable", {defaultValue:"流式请求模块尚未加载"}));
    await streamTerminalAiRequest({message:"hi", contexts:[], mode:"agent", locale:normalizeTermaLanguage(document.documentElement.lang), permission:payload.ai.terminal_ai_permission, ai:{...payload.ai, enabled:true}}, {
      onDelta:delta => { if (resultBox) { resultBox.textContent += delta; resultBox.scrollTop = resultBox.scrollHeight; } }
    });
    notify(tr("settings:ai.test_success", {defaultValue:"AI 测试请求已完成"}), "success");
  } catch (error) {
    if (resultBox) resultBox.textContent = error.message || tr("settings:ai.test_failed", {defaultValue:"AI 测试失败"});
    notify(error.message || tr("settings:ai.test_failed", {defaultValue:"AI 测试失败"}), "error");
  } finally {
    setButtonBusy($("terminalAiTestBtn"), false);
  }
}

function runtimeBackgroundIntervalMs(value, fallback) {
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1000 && interval <= 60000 ? interval : fallback;
}

function runtimeConfiguredBackgroundIntervalMs(key, fallback) {
  const saved = runtimeSettings?.saved || runtimeSettings || {};
  return runtimeBackgroundIntervalMs(saved[key], fallback);
}

function normalizeRuntimeSettingsResponse(value={}) {
  const source = value && typeof value === "object" ? value : {};
  const savedSource = source.saved && typeof source.saved === "object" ? source.saved : source;
  const effectiveSource = source.effective && typeof source.effective === "object"
    ? source.effective
    : {
        ...savedSource,
        listen_hosts:source.actual_hosts || source.effective_hosts || source.requested_hosts || savedSource.listen_hosts,
        listen_port:source.actual_port || source.effective_port || source.requested_port || savedSource.listen_port
      };
  const savedHosts = runtimeHostValues(savedSource.listen_hosts || savedSource.hosts || savedSource.host || "127.0.0.1");
  const effectiveHosts = runtimeHostValues(effectiveSource.listen_hosts || effectiveSource.hosts || effectiveSource.host || savedHosts);
  const available = [
    {address:"127.0.0.1", kind:"loopback", interface:"loopback", internal:true},
    {address:"0.0.0.0", kind:"all", interface:"all", wildcard:true}
  ];
  const known = new Set(available.map(item => item.address));
  const candidates = Array.isArray(source.available_hosts) ? source.available_hosts : [];
  for (const item of candidates) {
    const entry = typeof item === "string" ? {address:item, label:item} : (item || {});
    const address = String(entry.address || "").trim();
    if (!address || known.has(address)) continue;
    known.add(address);
    available.push({...entry, address, label:String(entry.label || `${entry.interface ? `${entry.interface} · ` : ""}${address}`)});
  }
  for (const address of [...savedHosts, ...effectiveHosts]) {
    if (!address || known.has(address)) continue;
    known.add(address);
    available.push({address, kind:"saved", interface:"saved"});
  }
  const effectivePort = runtimePortValue(effectiveSource.listen_port ?? effectiveSource.port, runtimePortValue(savedSource.listen_port ?? savedSource.port));
  const fallbackLocalHost = effectiveHosts.find(address => address.startsWith("127.")) || (effectiveHosts.includes("0.0.0.0") ? "127.0.0.1" : effectiveHosts[0]);
  const computedLocalUrl = fallbackLocalHost ? `http://${fallbackLocalHost}:${effectivePort}` : "";
  const computedLanHosts = effectiveHosts.includes("0.0.0.0")
    ? available.filter(entry => !entry.internal && !entry.wildcard && entry.address !== "0.0.0.0").map(entry => entry.address)
    : effectiveHosts.filter(address => address !== "0.0.0.0" && !address.startsWith("127."));
  const reportedLanUrls = Array.isArray(source.lan_urls)
    ? source.lan_urls
    : Array.isArray(effectiveSource.lan_urls)
      ? effectiveSource.lan_urls
      : computedLanHosts.map(address => `http://${address}:${effectivePort}`);
  const hasRuntimeData = Boolean(source.local_url || source.actual_hosts || source.effective || source.listen_hosts || source.saved);
  const savedAi = normalizeAiSettingsResponse(savedSource.ai || source.ai);
  const effectiveAi = normalizeAiSettingsResponse(effectiveSource.ai || savedAi);
  return {
    ...source,
    language:normalizeTermaLanguage(savedSource.language),
    language_onboarding_version:Math.max(0, Number(savedSource.language_onboarding_version || 0)),
    vnc_fullscreen_toolbar:["always", "never", "edge"].includes(savedSource.vnc_fullscreen_toolbar) ? savedSource.vnc_fullscreen_toolbar : "always",
    ui_refresh_interval_ms:runtimeBackgroundIntervalMs(savedSource.ui_refresh_interval_ms, 4000),
    sftp_active_status_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.sftp_active_status_poll_interval_ms, 5000),
    sftp_background_status_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.sftp_background_status_poll_interval_ms, 15000),
    vnc_local_image_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.vnc_local_image_poll_interval_ms, 5000),
    vnc_remote_image_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.vnc_remote_image_poll_interval_ms, 3000),
    settings_persisted:source.settings_persisted === true,
    sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
    notification_display: normalizeNotificationDisplay(savedSource.notification_display),
    sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
    sftp_text_editor_mode: ["ace", "auto", "light"].includes(savedSource.sftp_text_editor_mode) ? savedSource.sftp_text_editor_mode : "ace",
    sftp_double_click_file_action: ["internal", "external"].includes(savedSource.sftp_double_click_file_action) ? savedSource.sftp_double_click_file_action : "internal",
    sftp_light_editor_threshold_mb: Number(savedSource.sftp_light_editor_threshold_mb) || 10,
    sftp_external_edit_save_rule: savedSource.sftp_external_edit_save_rule === "overwrite" ? "overwrite" : "prompt",
    sftp_external_edit_backup_enabled: savedSource.sftp_external_edit_backup_enabled !== false,
    sftp_download_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_download_concurrency) || 3)),
    sftp_upload_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_upload_concurrency) || 3)),
    restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
    remote_desktop_quick_open_enabled: savedSource.remote_desktop_quick_open_enabled === true,
    vnc_quick_open_new_window: savedSource.vnc_quick_open_new_window !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(savedSource.workspace_toolbar_placement),
    ai:savedAi,
    saved: {
      ...savedSource,
      language:normalizeTermaLanguage(savedSource.language),
      language_onboarding_version:Math.max(0, Number(savedSource.language_onboarding_version || 0)),
      vnc_fullscreen_toolbar:["always", "never", "edge"].includes(savedSource.vnc_fullscreen_toolbar) ? savedSource.vnc_fullscreen_toolbar : "always",
      ui_refresh_interval_ms:runtimeBackgroundIntervalMs(savedSource.ui_refresh_interval_ms, 4000),
      sftp_active_status_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.sftp_active_status_poll_interval_ms, 5000),
      sftp_background_status_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.sftp_background_status_poll_interval_ms, 15000),
      vnc_local_image_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.vnc_local_image_poll_interval_ms, 5000),
      vnc_remote_image_poll_interval_ms:runtimeBackgroundIntervalMs(savedSource.vnc_remote_image_poll_interval_ms, 3000),
      listen_hosts: savedHosts.length ? savedHosts : ["127.0.0.1"],
      listen_port: runtimePortValue(savedSource.listen_port ?? savedSource.port),
      sftp_recycle_bin_enabled: savedSource.sftp_recycle_bin_enabled === true,
      sftp_floating_progress_enabled: savedSource.sftp_floating_progress_enabled !== false,
      notification_display: normalizeNotificationDisplay(savedSource.notification_display),
      sftp_max_open_file_size_mb: Number(savedSource.sftp_max_open_file_size_mb) || 50,
      sftp_text_editor_mode: ["ace", "auto", "light"].includes(savedSource.sftp_text_editor_mode) ? savedSource.sftp_text_editor_mode : "ace",
      sftp_double_click_file_action: ["internal", "external"].includes(savedSource.sftp_double_click_file_action) ? savedSource.sftp_double_click_file_action : "internal",
      sftp_light_editor_threshold_mb: Number(savedSource.sftp_light_editor_threshold_mb) || 10,
      sftp_external_edit_save_rule: savedSource.sftp_external_edit_save_rule === "overwrite" ? "overwrite" : "prompt",
      sftp_external_edit_backup_enabled: savedSource.sftp_external_edit_backup_enabled !== false,
      sftp_download_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_download_concurrency) || 3)),
      sftp_upload_concurrency: Math.max(1, Math.min(8, Number(savedSource.sftp_upload_concurrency) || 3)),
      sftp_download_directory: String(savedSource.sftp_download_directory || ""),
      restore_workspace_tabs: savedSource.restore_workspace_tabs !== false,
      remote_desktop_quick_open_enabled: savedSource.remote_desktop_quick_open_enabled === true,
      vnc_quick_open_new_window: savedSource.vnc_quick_open_new_window !== false,
      workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(savedSource.workspace_toolbar_placement),
      ai:savedAi
    },
    effective: {
      ...effectiveSource,
      listen_hosts: effectiveHosts.length ? effectiveHosts : ["127.0.0.1"],
      listen_port: effectivePort,
      ai:effectiveAi
    },
    available_hosts: available,
    local_url: String(source.local_url || effectiveSource.local_url || (hasRuntimeData ? computedLocalUrl : "")),
    lan_urls: hasRuntimeData ? reportedLanUrls.map(String).filter(Boolean) : [],
    restart_required: source.restart_required === true,
    error: String(source.error || "")
  };
}

async function loadRuntimeSettings(refreshUi=false) {
  const inPane = captureSettingsPane();
  runtimeSettingsMessage = null;
  runtimeSettingsCheck = null;
  try {
    runtimeSettings = normalizeRuntimeSettingsResponse(await api("/api/runtime-settings"));
    const legacyQuickOpen = localStorage.getItem("remoteDesktopQuickOpen");
    remoteDesktopQuickOpen = legacyQuickOpen === null
      ? runtimeSettings.saved.remote_desktop_quick_open_enabled === true
      : legacyQuickOpen === "1";
    await setTermaLanguage(runtimeSettings.saved.language, {render:false, emit:false});
  } catch (error) {
    runtimeSettings = normalizeRuntimeSettingsResponse({error:error.message || tr("settings:auto.runtime_load_failed", {defaultValue:"监听配置加载失败"})});
  }
  if (typeof updateSftpTaskFloat === "function") updateSftpTaskFloat(typeof sftpLatestJobs === "undefined" ? [] : sftpLatestJobs);
  if (refreshUi) inPane(renderRuntimeSettingsPanel);
  return runtimeSettings;
}

async function toggleTermaLanguage() {
  const current = normalizeTermaLanguage(runtimeSettings?.saved?.language || document.documentElement.lang);
  const language = current === "zh-CN" ? "en-US" : "zh-CN";
  const buttons = [...document.querySelectorAll(".language-toggle")];
  buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({language})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    await setTermaLanguage(runtimeSettings.saved.language);
  } catch (error) {
    notify(error.message || tr("errors:language_switch", {defaultValue:"界面语言切换失败"}), "error");
    syncTermaLanguageControls(current);
  } finally {
    buttons.forEach(button => { button.disabled = false; button.removeAttribute("aria-busy"); });
  }
}

const TERMA_LANGUAGE_ONBOARDING_VERSION = 1;

function termaRegionFromLocale(value) {
  const locale = String(value || "").trim().replace(/_/g, "-");
  if (!locale) return "";
  try {
    return String(new Intl.Locale(locale).maximize().region || "").toUpperCase();
  } catch {
    const parts = locale.split("-");
    return String(parts.find((part, index) => index > 0 && /^[a-z]{2}$/i.test(part)) || "").toUpperCase();
  }
}

function suggestedTermaLanguage(locales=navigator.languages?.length ? navigator.languages : [navigator.language]) {
  const region = (Array.isArray(locales) ? locales : [locales]).map(termaRegionFromLocale).find(Boolean);
  return region === "CN" ? "zh-CN" : "en-US";
}

function closeTermaLanguageOnboarding() {
  const modal = $("modal");
  if (!modal) return;
  modal.hidden = true;
  modal.innerHTML = "";
}

async function confirmTermaLanguageOnboarding(button=null) {
  const selected = $("modal")?.querySelector('input[name="terma-onboarding-language"]:checked')?.value;
  const language = normalizeTermaLanguage(selected || runtimeSettings?.saved?.language);
  if (button) setButtonBusy(button, true, tr("settings:language_onboarding.saving", {
    lng:language,
    defaultValue:language === "zh-CN" ? "正在保存..." : "Saving..."
  }));
  try {
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({language, language_onboarding_version:TERMA_LANGUAGE_ONBOARDING_VERSION})
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    await setTermaLanguage(runtimeSettings.saved.language);
    closeTermaLanguageOnboarding();
    return true;
  } catch (error) {
    notify(error.message || tr("settings:language_onboarding.save_failed", {
      lng:language,
      defaultValue:language === "zh-CN" ? "语言设置保存失败" : "Failed to save language"
    }), "error");
    return false;
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function termaLanguageOnboardingCopy(language, isNew) {
  const selectedLanguage = normalizeTermaLanguage(language);
  const chinese = selectedLanguage === "zh-CN";
  return {
    title:tr("settings:language_onboarding.title", {
      lng:selectedLanguage,
      defaultValue:chinese ? "选择界面语言" : "Choose your language"
    }),
    message:tr(isNew ? "settings:language_onboarding.new_user_message" : "settings:language_onboarding.existing_user_message", {
      lng:selectedLanguage,
      defaultValue:chinese
        ? (isNew ? "Terma 已按当前设备地区预选语言，进入前可以修改。" : "请选择要继续使用的 Terma 界面语言。")
        : (isNew ? "Terma selected a default from this device's region. You can change it before entering." : "Choose the Terma interface language to continue.")
    }),
    switchHint:tr("settings:language_onboarding.switch_hint", {
      lng:selectedLanguage,
      defaultValue:chinese ? "之后可随时通过语言按钮切换。" : "You can switch languages at any time from the language button."
    }),
    continueLabel:tr("settings:language_onboarding.continue", {
      lng:selectedLanguage,
      defaultValue:chinese ? "继续" : "Continue"
    })
  };
}

function updateTermaLanguageOnboarding(language) {
  const form = $("modal")?.querySelector(".language-onboarding");
  if (!form) return false;
  const selectedLanguage = normalizeTermaLanguage(language);
  const selectedInput = form.querySelector(`input[name="terma-onboarding-language"][value="${selectedLanguage}"]`);
  if (selectedInput) selectedInput.checked = true;
  form.querySelectorAll(".language-onboarding-option").forEach(item => {
    item.classList.toggle("selected", item.contains(selectedInput));
  });
  const copy = termaLanguageOnboardingCopy(selectedLanguage, form.dataset.newUser === "true");
  const title = form.querySelector("#languageOnboardingTitle");
  const message = form.querySelector(".language-onboarding-message");
  const switchHint = form.querySelector(".language-onboarding-note");
  const continueButton = form.querySelector('button[type="submit"]');
  if (title) title.textContent = copy.title;
  if (message) message.textContent = copy.message;
  if (switchHint) switchHint.textContent = copy.switchHint;
  if (continueButton) continueButton.textContent = copy.continueLabel;
  form.lang = selectedLanguage;
  return true;
}

async function ensureTermaLanguageOnboarding() {
  if (Number(runtimeSettings?.saved?.language_onboarding_version || 0) >= TERMA_LANGUAGE_ONBOARDING_VERSION) return false;
  const existingLanguage = normalizeTermaLanguage(runtimeSettings?.saved?.language);
  const suggestedLanguage = runtimeSettings?.settings_persisted ? existingLanguage : suggestedTermaLanguage();
  if (!runtimeSettings?.settings_persisted && suggestedLanguage !== existingLanguage) {
    await setTermaLanguage(suggestedLanguage, {emit:false});
  }
  // The two choices are self-identifying: English stays English and the
  // Simplified Chinese choice stays Chinese, even on a fresh English startup.
  await ensureTermaI18nResourceBundles(["en-US", "zh-CN"], ["common", "settings"]);
  const modal = $("modal");
  if (!modal) return false;
  const isNew = runtimeSettings?.settings_persisted !== true;
  const englishDetail = tr("settings:language_onboarding.english_detail", {lng:"en-US", defaultValue:"Default outside mainland China"});
  const chineseName = tr("common:languages.zh-CN", {lng:"zh-CN", defaultValue:"简体中文"});
  const chineseDetail = tr("settings:language_onboarding.chinese_detail", {lng:"zh-CN", defaultValue:"中国大陆默认"});
  modal.innerHTML = `<form class="modal-card language-onboarding" data-i18n-skip data-new-user="${isNew}" role="dialog" aria-modal="true" aria-labelledby="languageOnboardingTitle" onsubmit="event.preventDefault();confirmTermaLanguageOnboarding(this.querySelector('button[type=submit]'))">
    <div class="language-onboarding-mark">T</div>
    <div class="language-onboarding-copy">
      <h2 id="languageOnboardingTitle"></h2>
      <p class="language-onboarding-message"></p>
    </div>
    <div class="language-onboarding-options">
      <label class="language-onboarding-option"><input type="radio" name="terma-onboarding-language" value="en-US" onchange="updateTermaLanguageOnboarding(this.value)"><span><strong>English</strong><small>${esc(englishDetail)}</small></span></label>
      <label class="language-onboarding-option"><input type="radio" name="terma-onboarding-language" value="zh-CN" onchange="updateTermaLanguageOnboarding(this.value)"><span><strong>${esc(chineseName)}</strong><small>${esc(chineseDetail)}</small></span></label>
    </div>
    <div class="language-onboarding-note"></div>
    <div class="actions"><button class="primary" type="submit"></button></div>
  </form>`;
  updateTermaLanguageOnboarding(suggestedLanguage);
  modal.hidden = false;
  modal.onclick = null;
  refreshIcons();
  return true;
}

function safeRuntimeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function runtimeUrlListHtml(data=runtimeSettings) {
  const localUrl = safeRuntimeUrl(data?.local_url);
  const lanUrls = [...new Set((data?.lan_urls || []).map(safeRuntimeUrl).filter(Boolean))];
  const rows = [];
  if (localUrl) rows.push({label:tr("settings:auto.local_access", {defaultValue:"本机访问"}), url:localUrl, icon:"monitor"});
  lanUrls.forEach((url, index) => rows.push({
    label:lanUrls.length > 1
      ? tr("settings:auto.lan_access_numbered", {index:index + 1, defaultValue:`局域网 ${index + 1}`})
      : tr("settings:auto.lan_access", {defaultValue:"局域网访问"}),
    url,
    icon:"network"
  }));
  if (!rows.length) return `<div class="runtime-empty muted">${esc(tr("settings:auto.no_access_urls", {defaultValue:"当前进程尚未报告可用访问地址，请刷新运行诊断。"}))}</div>`;
  return `<div class="runtime-url-list">${rows.map(row => `<a class="runtime-url-row" href="${escAttr(row.url)}" target="_blank" rel="noopener"><span class="runtime-url-icon">${icon(row.icon)}</span><span><strong>${esc(row.label)}</strong><small>${esc(row.url)}</small></span>${icon("external-link")}</a>`).join("")}</div>`;
}

function runtimeInterfaceLabel(value) {
  const source = String(value || "").trim();
  if (/^(?:以太网|ethernet)$/i.test(source)) return tr("settings:auto.ethernet", {defaultValue:"以太网"});
  if (/^(?:无线网络连接|无线局域网|wi-?fi|wlan)$/i.test(source)) return tr("settings:auto.wifi", {defaultValue:"Wi-Fi"});
  return source;
}

function runtimeHostEntryLabel(entry, address) {
  if (address === "127.0.0.1" || entry.kind === "loopback" || entry.interface === "loopback") return tr("settings:auto.local_only", {defaultValue:"仅本机"});
  if (address === "0.0.0.0" || entry.kind === "all" || entry.interface === "all") return tr("settings:auto.all_ipv4", {defaultValue:"所有 IPv4 网卡"});
  if (entry.kind === "saved" || entry.interface === "saved") return tr("settings:auto.current_config_address", {address, defaultValue:`当前配置 · ${address}`});
  const interfaceLabel = runtimeInterfaceLabel(entry.interface);
  return interfaceLabel ? `${interfaceLabel} · ${address}` : String(entry.label || address);
}

function runtimeHostOptionsHtml(data=runtimeSettings) {
  const selected = new Set(data?.saved?.listen_hosts || ["127.0.0.1"]);
  return (data?.available_hosts || []).map(entry => {
    const address = String(entry.address || "");
    const wildcard = address === "0.0.0.0";
    const detail = wildcard
      ? tr("settings:auto.all_ipv4_hint", {defaultValue:"包含当前及以后出现的所有 IPv4 网卡"})
      : address === "127.0.0.1"
        ? tr("settings:auto.local_only_hint", {defaultValue:"仅本机可访问（只能从运行 Terma 的本机访问）"})
        : entry.interface && entry.interface !== "saved"
          ? tr("settings:auto.interface_binding", {interface:runtimeInterfaceLabel(entry.interface), defaultValue:`${runtimeInterfaceLabel(entry.interface)} · 仅绑定此网卡地址`})
          : tr("settings:auto.address_binding", {defaultValue:"仅绑定此网卡地址"});
    return `<label class="runtime-host-option ${wildcard ? "wildcard" : ""}" data-runtime-host-option="${escAttr(address)}">
      <input type="checkbox" name="runtimeListenHost" value="${escAttr(address)}" ${selected.has(address) ? "checked" : ""} onchange="syncRuntimeHostOptions(this)">
      <span><strong>${esc(runtimeHostEntryLabel(entry, address))}</strong><small>${esc(detail)}</small></span>
      <code>${esc(address)}</code>
    </label>`;
  }).join("");
}

function runtimeFeedbackHtml() {
  if (runtimeSettingsMessage) {
    const type = runtimeSettingsMessage.type || "info";
    const symbol = type === "success" ? "check-circle-2" : type === "error" ? "circle-alert" : "info";
    return `<div class="runtime-feedback ${escAttr(type)}">${icon(symbol)}<span>${esc(runtimeSettingsMessage.text)}</span></div>`;
  }
  const result = runtimeSettingsCheck;
  if (!result) return "";
  const requestedPort = result.requested_port || result.listen_port || $("runtimeListenPort")?.value || "";
  if (result.error && result.available !== false) return `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(result.error)}</span></div>`;
  if (result.available && (result.occupied_by_current || result.current)) {
    return `<div class="runtime-feedback info">${icon("info")}<span>${esc(tr("settings:auto.port_current", {port:requestedPort, defaultValue:`端口 ${requestedPort} 正由当前 Terma 使用；保存后仍需重启才能应用新的监听地址。`}))}</span></div>`;
  }
  if (result.available) return `<div class="runtime-feedback success">${icon("check-circle-2")}<span>${esc(tr("settings:auto.port_available", {port:requestedPort, defaultValue:`端口 ${requestedPort} 可用，可以保存此监听配置。`}))}</span></div>`;
  const suggestion = runtimePortValue(result.suggested_port, 0);
  const reason = result.code === "EADDRINUSE" || /address already in use|eaddrinuse/i.test(result.error || "")
    ? tr("settings:auto.port_in_use_reason", {defaultValue:"该端口已被其他程序占用。"})
    : result.code === "EACCES" || /permission denied|eacces/i.test(result.error || "")
      ? tr("settings:auto.port_denied_reason", {defaultValue:"当前账号无权绑定该端口。"})
      : result.error
        ? tr("settings:auto.port_check_reason", {error:result.error, defaultValue:`检查失败：${result.error}`})
        : tr("settings:auto.port_unbindable_reason", {defaultValue:"该端口无法绑定。"});
  const suggestionText = suggestion
    ? tr("settings:auto.port_suggestion", {port:suggestion, defaultValue:` 可尝试端口 ${suggestion}。`})
    : tr("settings:auto.port_try_another", {defaultValue:" 请换一个端口后重试。"});
  const unavailable = tr("settings:auto.port_unavailable", {port:requestedPort, reason, suggestion:suggestionText, defaultValue:`端口 ${requestedPort} 不可用。${reason}${suggestionText}`});
  return `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(unavailable)}</span>${suggestion ? `<button type="button" onclick="useRuntimeSuggestedPort(${suggestion})">${esc(tr("settings:auto.use_port", {port:suggestion, defaultValue:`使用 ${suggestion}`}))}</button>` : ""}</div>`;
}

function runtimeSettingsPanelHtml(data=runtimeSettings) {
  const saved = data?.saved || {listen_hosts:["127.0.0.1"], listen_port:8088};
  const effective = data?.effective || saved;
  const savedText = `${(saved.listen_hosts || []).join("、")}:${saved.listen_port}`;
  const effectiveText = `${(effective.listen_hosts || []).join("、")}:${effective.listen_port}`;
  const overridden = data?.sources?.listen_hosts === "env" || data?.sources?.listen_port === "env" || effective.sources?.listen_hosts === "env" || effective.sources?.listen_port === "env";
  return `<div class="runtime-settings-panel">
    ${data?.error ? `<div class="runtime-feedback error">${icon("circle-alert")}<span>${esc(tr("settings:auto.listener_load_failed", {error:data.error, defaultValue:`监听配置加载失败：${data.error}。其他设置不受影响，可以稍后重新加载。`}))}</span><button type="button" onclick="loadRuntimeSettings(true)">${esc(tr("settings:auto.reload", {defaultValue:"重新加载"}))}</button></div>` : ""}
    <div class="runtime-config-summary">
      <div><span>${esc(tr("settings:auto.actual_listener", {defaultValue:"当前实际监听"}))}</span><strong>${esc(effectiveText)}</strong></div>
      <div><span>${esc(tr("settings:auto.saved_config", {defaultValue:"已保存配置"}))}</span><strong>${esc(savedText)}</strong></div>
      ${data?.restart_required ? `<span class="status-pill reconnecting">${esc(tr("settings:auto.restart_pending", {defaultValue:"等待重启"}))}</span>` : `<span class="status-pill running">${esc(tr("settings:auto.effective", {defaultValue:"已生效"}))}</span>`}
    </div>
    ${overridden ? `<div class="warning">${esc(tr("settings:auto.runtime_override_warning", {defaultValue:"当前进程使用环境变量或启动参数覆盖监听配置。保存仍会写入配置文件，但重启时若继续传入覆盖项，将优先使用覆盖值。"}))}</div>` : ""}
    <fieldset class="runtime-host-fieldset">
      <legend>${esc(tr("settings:auto.listen_addresses", {defaultValue:"监听地址（可多选）"}))}</legend>
      <div class="runtime-host-options">${runtimeHostOptionsHtml(data)}</div>
      <div id="runtimeWildcardHint" class="muted" hidden>${esc(tr("settings:auto.wildcard_selected_hint", {defaultValue:"已选择所有 IPv4 网卡；其他地址已折叠，取消勾选后可按网卡选择。"}))}</div>
    </fieldset>
    <div class="runtime-port-field">
      <label for="runtimeListenPort">${esc(tr("settings:auto.listen_port", {defaultValue:"监听端口"}))}</label>
      <input id="runtimeListenPort" type="number" inputmode="numeric" min="1" max="65535" step="1" value="${escAttr(saved.listen_port)}" oninput="clearRuntimeSettingsFeedback()">
      <span>${esc(tr("settings:auto.listen_port_hint", {defaultValue:"允许填写 1-65535。保存不会中断当前连接，重启 Terma 后生效。"}))}</span>
    </div>
    <div class="runtime-security-note">${icon("shield-alert")}<div><strong>${esc(tr("settings:auto.lan_auth_warning_title", {defaultValue:"局域网访问前先确认认证策略"}))}</strong><span>${esc(tr("settings:auto.lan_auth_warning", {defaultValue:"选择指定网卡 IP 或 0.0.0.0 后，同一网络中的设备可能访问 Terma。建议保留 Web 密码并使用“仅非本机访问时校验密码”或“所有浏览器访问都校验密码”。0.0.0.0 表示所有 IPv4 网卡，不只代表某一个局域网地址。"}))}</span></div></div>
    <div class="actions runtime-config-actions"><button id="runtimeCheckBtn" type="button" onclick="checkRuntimeSettings()">${icon("scan-search")}<span>${esc(tr("settings:auto.check_port", {defaultValue:"检查占用"}))}</span></button><button id="runtimeSaveBtn" class="primary" type="button" onclick="saveRuntimeSettings()">${icon("save")}<span>${esc(tr("settings:auto.save_listener", {defaultValue:"保存监听配置"}))}</span></button></div>
    <div id="runtimeSettingsFeedback">${runtimeFeedbackHtml()}</div>
  </div>`;
}

function renderRuntimeSettingsPanel() {
  const panel = $("runtimeSettingsPanel");
  if (panel) panel.innerHTML = runtimeSettingsPanelHtml();
  const urls = $("runtimeCurrentUrls");
  if (urls) urls.innerHTML = runtimeUrlListHtml();
  syncRuntimeHostOptions();
}

function renderRuntimeSettingsFeedback() {
  const area = $("runtimeSettingsFeedback");
  if (area) area.innerHTML = runtimeFeedbackHtml();
}

function clearRuntimeSettingsFeedback() {
  runtimeSettingsCheck = null;
  runtimeSettingsMessage = null;
  renderRuntimeSettingsFeedback();
}

function syncRuntimeHostOptions(source=null) {
  const options = [...settingsQueryAll('[name="runtimeListenHost"]')];
  if (!options.length) return;
  const wildcard = options.find(input => input.value === "0.0.0.0");
  if (source?.value === "0.0.0.0" && source.checked) {
    options.filter(input => input !== wildcard).forEach(input => { input.checked = false; });
  } else if (source?.value !== "0.0.0.0" && source?.checked && wildcard) {
    wildcard.checked = false;
  }
  const collapseOthers = Boolean(wildcard?.checked);
  options.filter(input => input !== wildcard).forEach(input => {
    const row = input.closest(".runtime-host-option");
    if (row) row.hidden = collapseOthers;
  });
  const hint = $("runtimeWildcardHint");
  if (hint) hint.hidden = !collapseOthers;
  if (source) clearRuntimeSettingsFeedback();
}

function runtimeSettingsFormValue() {
  const listen_hosts = [...settingsQueryAll('[name="runtimeListenHost"]:checked')].map(input => input.value);
  const listen_port = Number($("runtimeListenPort")?.value);
  if (!listen_hosts.length) throw new Error(tr("settings:auto.select_listen_address", {defaultValue:"请至少选择一个监听地址"}));
  if (!Number.isInteger(listen_port) || listen_port < 1 || listen_port > 65535) throw new Error(tr("settings:auto.invalid_listen_port", {defaultValue:"监听端口必须是 1-65535 的整数"}));
  return {listen_hosts, listen_port};
}

async function checkRuntimeSettings() {
  const inPane = captureSettingsPane();
  let payload;
  try {
    payload = runtimeSettingsFormValue();
  } catch (error) {
    runtimeSettingsCheck = {error:error.message};
    renderRuntimeSettingsFeedback();
    return;
  }
  const button = $("runtimeCheckBtn");
  setButtonBusy(button, true, tr("settings:auto.checking", {defaultValue:"检查中"}));
  runtimeSettingsMessage = null;
  try {
    runtimeSettingsCheck = await api("/api/runtime-settings/check", {method:"POST", body:JSON.stringify(payload)});
  } catch (error) {
    runtimeSettingsCheck = {error:error.message || tr("settings:auto.port_check_failed", {defaultValue:"端口占用检查失败"})};
  } finally {
    inPane(() => {
      setButtonBusy(button, false);
      renderRuntimeSettingsFeedback();
    });
  }
}

function useRuntimeSuggestedPort(port) {
  const input = $("runtimeListenPort");
  if (input) input.value = runtimePortValue(port);
  clearRuntimeSettingsFeedback();
  input?.focus();
}

async function saveRuntimeSettings() {
  const inPane = captureSettingsPane();
  let payload;
  try {
    payload = runtimeSettingsFormValue();
  } catch (error) {
    runtimeSettingsMessage = {type:"error", text:error.message};
    renderRuntimeSettingsFeedback();
    return;
  }
  const button = $("runtimeSaveBtn");
  setButtonBusy(button, true, tr("settings:auto.saving", {defaultValue:"保存中"}));
  try {
    const result = await api("/api/runtime-settings", {method:"PUT", body:JSON.stringify(payload)});
    runtimeSettings = normalizeRuntimeSettingsResponse({
      ...runtimeSettings,
      ...result,
      available_hosts:result.available_hosts || runtimeSettings?.available_hosts,
      saved:result.saved || payload,
      effective:result.effective || runtimeSettings?.effective,
      restart_required:result.restart_required !== false
    });
    runtimeSettingsCheck = null;
    runtimeSettingsMessage = {type:"success", text:tr("settings:auto.listener_saved_detail", {defaultValue:"监听配置已保存。当前服务不会立即断开，请重启 Terma 后应用新的地址和端口。"})};
    inPane(renderRuntimeSettingsPanel);
    notify(tr("settings:auto.listener_saved_notice", {defaultValue:"监听配置已保存，重启 Terma 后生效"}), "success");
  } catch (error) {
    runtimeSettingsMessage = {type:"error", text:error.message || tr("settings:auto.listener_save_failed", {defaultValue:"监听配置保存失败"})};
    inPane(renderRuntimeSettingsFeedback);
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

function workspaceToolbarPlacementFormValue() {
  return {
    unsplit: {
      terminal:$('toolbarPlacementUnsplitTerminal')?.value || "header",
      sftp:$('toolbarPlacementUnsplitSftp')?.value || "header"
    },
    split: {
      terminal:$('toolbarPlacementSplitTerminal')?.value || "header",
      sftp:$('toolbarPlacementSplitSftp')?.value || "header"
    }
  };
}

function syncWorkspaceToolbarPlacementInputs(value) {
  const normalized = normalizeWorkspaceToolbarPlacement(value);
  const fields = {
    toolbarPlacementUnsplitTerminal:normalized.unsplit.terminal,
    toolbarPlacementUnsplitSftp:normalized.unsplit.sftp,
    toolbarPlacementSplitTerminal:normalized.split.terminal,
    toolbarPlacementSplitSftp:normalized.split.sftp
  };
  for (const [id, placement] of Object.entries(fields)) {
    const input = $(id);
    if (input) input.value = placement;
  }
}

const BACKGROUND_INTERVAL_FIELDS = Object.freeze({
  generalUiRefreshIntervalSeconds:["ui_refresh_interval_ms", 4000],
  generalSftpActiveStatusIntervalSeconds:["sftp_active_status_poll_interval_ms", 5000],
  generalSftpBackgroundStatusIntervalSeconds:["sftp_background_status_poll_interval_ms", 15000],
  generalVncLocalImageIntervalSeconds:["vnc_local_image_poll_interval_ms", 5000],
  generalVncRemoteImageIntervalSeconds:["vnc_remote_image_poll_interval_ms", 3000]
});

function runtimeBackgroundIntervalSeconds(key, fallbackMs) {
  return runtimeConfiguredBackgroundIntervalMs(key, fallbackMs) / 1000;
}

function backgroundPollingSettingsFormValue() {
  const result = {};
  for (const [id, [key, fallbackMs]] of Object.entries(BACKGROUND_INTERVAL_FIELDS)) {
    const input = $(id);
    const seconds = Number(input?.value ?? fallbackMs / 1000);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
      throw new Error(tr("settings:background_refresh.interval_invalid", {defaultValue:"刷新间隔必须是 1-60 秒之间的整数。"}));
    }
    result[key] = seconds * 1000;
  }
  return result;
}

function syncBackgroundPollingInputs(value=runtimeSettings?.saved) {
  const saved = value || {};
  for (const [id, [key, fallbackMs]] of Object.entries(BACKGROUND_INTERVAL_FIELDS)) {
    const input = $(id);
    if (input) input.value = String(runtimeBackgroundIntervalMs(saved[key], fallbackMs) / 1000);
  }
}

async function saveWorkspaceSettings() {
  const inPane = captureSettingsPane();
  const input = $("restoreWorkspaceTabs");
  const button = $("restoreWorkspaceTabsSave");
  if (!input || !button) return;
  setButtonBusy(button, true, tr("settings:auto.saving", {defaultValue:"保存中"}));
  try {
    const workspace_toolbar_placement = workspaceToolbarPlacementFormValue();
    const backgroundIntervals = backgroundPollingSettingsFormValue();
    const vnc_fullscreen_toolbar = ["always", "never", "edge"].includes($("generalVncFullscreenToolbar")?.value)
      ? $("generalVncFullscreenToolbar").value
      : "always";
    const remote_desktop_quick_open_enabled = $("generalRemoteDesktopQuickOpen")?.checked === true;
    const vnc_quick_open_new_window = $("generalVncQuickOpenNewWindow")?.checked !== false;
    const result = await api("/api/runtime-settings", {
      method:"PUT",
      body:JSON.stringify({
        restore_workspace_tabs:input.checked,
        remote_desktop_quick_open_enabled,
        vnc_quick_open_new_window,
        workspace_toolbar_placement,
        vnc_fullscreen_toolbar,
        ...backgroundIntervals
      })
    });
    runtimeSettings = normalizeRuntimeSettingsResponse({...runtimeSettings, ...result});
    remoteDesktopQuickOpen = runtimeSettings.saved.remote_desktop_quick_open_enabled === true;
    localStorage.removeItem("remoteDesktopQuickOpen");
    await setTermaLanguage(runtimeSettings.saved.language);
    inPane(() => {
      renderSettings();
      if (typeof syncWorkspaceToolbarPlacements === "function") syncWorkspaceToolbarPlacements();
      if (typeof refreshVncClipboardImagePollingIntervals === "function") refreshVncClipboardImagePollingIntervals();
    });
    notify(tr("settings:auto.workspace_saved", {defaultValue:"工作区设置已保存"}), "success");
  } catch (error) {
    inPane(() => {
      input.checked = runtimeSettings?.saved?.restore_workspace_tabs !== false;
      syncWorkspaceToolbarPlacementInputs(runtimeSettings?.saved?.workspace_toolbar_placement);
      const vncToolbar = $("generalVncFullscreenToolbar");
      if (vncToolbar) vncToolbar.value = runtimeSettings?.saved?.vnc_fullscreen_toolbar || "always";
      const quickOpen = $("generalRemoteDesktopQuickOpen");
      if (quickOpen) quickOpen.checked = remoteDesktopQuickOpen;
      const newWindow = $("generalVncQuickOpenNewWindow");
      if (newWindow) newWindow.checked = runtimeSettings?.saved?.vnc_quick_open_new_window !== false;
      syncBackgroundPollingInputs(runtimeSettings?.saved);
    });
    notify(error.message || tr("settings:auto.workspace_save_failed", {defaultValue:"工作区设置保存失败"}), "error");
  } finally {
    inPane(() => setButtonBusy(button, false));
  }
}

async function saveWorkspaceRestoreSetting() {
  return saveWorkspaceSettings();
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("settings-ai-model-mode", () => syncTerminalAiModelMode());
  registerTermaAction("settings-ai-permission", async ({element}) => {
    const allowed = ["suggest", "confirm", "controlled", "full"];
    const next = allowed.includes(element.value) ? element.value : "confirm";
    const previous = allowed.includes(element.dataset.committedPermission) ? element.dataset.committedPermission : "confirm";
    if (next !== "full") {
      element.dataset.committedPermission = next;
      return;
    }
    const confirmed = await confirmModal(
      tr("settings:ai.permission_full_warning", {defaultValue:"完全访问会允许 Agent 直接执行删除、写入、提权、安装、网络和服务变更等任何命令。仅在你完全信任当前任务和模型时启用。是否继续？"}),
      tr("settings:ai.permission_full_title", {defaultValue:"启用完全访问"}),
      tr("settings:ai.permission_full_enable", {defaultValue:"继续启用"}),
      tr("common:actions.cancel", {defaultValue:"取消"})
    );
    if (confirmed) element.dataset.committedPermission = "full";
    else element.value = previous;
  });
  registerTermaAction("settings-ai-fetch-models", () => fetchTerminalAiModels());
  registerTermaAction("settings-ai-skill-add", () => {
    const name = String($("terminalAiSkillName")?.value || "").trim();
    const description = String($("terminalAiSkillDescription")?.value || "").trim();
    const prompt = String($("terminalAiSkillPrompt")?.value || "").trim();
    if (!name || !prompt) return notify(tr("settings:ai.skill_required", {defaultValue:"请填写 Skill 名称和提示内容"}), "error");
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill"}-${Date.now().toString(36)}`;
    terminalAiUserSkillsDraft.push({id, name:name.slice(0, 120), description:description.slice(0, 300), prompt:prompt.slice(0, 12000), enabled:true, updated_at:Date.now()});
    terminalAiSettingsDraftDirty = true;
    renderSettings();
  });
  registerTermaAction("settings-ai-skill-remove", ({element}) => {
    terminalAiUserSkillsDraft.splice(Number(element.dataset.skillIndex || 0), 1);
    terminalAiSettingsDraftDirty = true;
    renderSettings();
  });
  registerTermaAction("settings-ai-mcp-add", async ({element}) => {
    const name = String($("terminalAiMcpName")?.value || "").trim();
    const transportValue = $("terminalAiMcpTransport")?.value;
    const transport = ["sse", "streamable-http"].includes(transportValue) ? transportValue : "stdio";
    const command = String($("terminalAiMcpCommand")?.value || "").trim();
    const url = String($("terminalAiMcpUrl")?.value || "").trim();
    if (!name || (transport === "stdio" ? !command : !url)) return notify(tr("settings:ai.mcp_required", {defaultValue:"请填写 MCP 名称和连接地址"}), "error");
    let args = [];
    if (transport === "stdio") {
      try {
        const rawArgs = String($("terminalAiMcpArgs")?.value || "").trim();
        args = rawArgs ? JSON.parse(rawArgs) : [];
        if (!Array.isArray(args) || args.some(item => typeof item !== "string")) throw new Error("invalid");
      } catch {
        return notify(tr("settings:ai.mcp_args_invalid", {defaultValue:"stdio 参数必须是 JSON 字符串数组"}), "error");
      }
    }
    let headers = {};
    if (transport !== "stdio") {
      try {
        const rawHeaders = String($("terminalAiMcpHeaders")?.value || "").trim();
        headers = rawHeaders ? JSON.parse(rawHeaders) : {};
        if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.keys(headers).length > 32 || Object.values(headers).some(value => typeof value !== "string")) throw new Error("invalid");
      } catch {
        return notify(tr("settings:ai.mcp_headers_invalid", {defaultValue:"请求头必须是键和值均为字符串的 JSON 对象"}), "error");
      }
    }
    const editingId = String(document.querySelector(".terminal-ai-mcp-editor")?.dataset.mcpEditingId || "");
    const id = editingId || `mcp-${Date.now().toString(36)}`;
    const server = {id, name:name.slice(0, 120), transport, command:transport === "stdio" ? command : "", args:transport === "stdio" ? args.slice(0, 32) : [], url:transport !== "stdio" ? url : "", headers:transport !== "stdio" ? headers : {}, enabled:Boolean($("terminalAiMcpEnabled")?.checked), timeout_ms:Number(terminalAiMcpEditorDraft?.timeout_ms || 30000)};
    setButtonBusy(element, true);
    try {
      const result = await api(editingId ? `/api/ai/mcp/servers/${encodeURIComponent(editingId)}` : "/api/ai/mcp/servers", {method:editingId ? "PUT" : "POST", body:JSON.stringify({server})});
      const savedServer = result?.server && typeof result.server === "object" ? result.server : server;
      const previousIndex = terminalAiMcpServersDraft.findIndex(item => String(item.id) === String(savedServer.id));
      if (previousIndex >= 0) terminalAiMcpServersDraft.splice(previousIndex, 1, savedServer);
      else terminalAiMcpServersDraft.push(savedServer);
      terminalAiMcpEditorDraft = null;
      terminalAiSettingsDraftDirty = true;
      renderSettings();
      notify(tr(editingId ? "settings:ai.mcp_updated" : "settings:ai.mcp_saved", {defaultValue:editingId ? "MCP 服务器修改已保存" : "MCP 服务器已保存，现在可以发现工具"}), "success");
    } catch (error) {
      notify(error.message || tr("settings:ai.mcp_save_failed", {defaultValue:"MCP 服务器保存失败"}), "error");
    } finally {
      setButtonBusy(element, false);
    }
  });
  registerTermaAction("settings-ai-mcp-preset", ({element}) => {
    const preset = TERMINAL_AI_MCP_PRESETS[String(element.dataset.mcpPreset || "")];
    if (!preset) return;
    if ($("terminalAiMcpName")) $("terminalAiMcpName").value = preset.name;
    if ($("terminalAiMcpTransport")) $("terminalAiMcpTransport").value = preset.transport;
    if ($("terminalAiMcpCommand")) $("terminalAiMcpCommand").value = preset.command || "";
    if ($("terminalAiMcpUrl")) $("terminalAiMcpUrl").value = preset.url || "";
    if ($("terminalAiMcpArgs")) $("terminalAiMcpArgs").value = JSON.stringify(preset.args || []);
    if ($("terminalAiMcpHeaders")) $("terminalAiMcpHeaders").value = "";
    syncTerminalAiMcpTransportFields();
    $("terminalAiMcpName")?.focus();
  });
  registerTermaAction("settings-ai-mcp-transport", () => syncTerminalAiMcpTransportFields());
  registerTermaAction("settings-ai-mcp-edit", ({element}) => {
    const server = terminalAiMcpServersDraft[Number(element.dataset.mcpIndex || 0)];
    if (!server) return;
    terminalAiMcpEditorDraft = {...server, args:Array.isArray(server.args) ? [...server.args] : [], headers:server.headers && typeof server.headers === "object" ? {...server.headers} : {}};
    terminalAiSettingsDraftDirty = true;
    renderSettings();
    $("terminalAiMcpName")?.focus();
  });
  registerTermaAction("settings-ai-mcp-edit-cancel", () => {
    terminalAiMcpEditorDraft = null;
    renderSettings();
  });
  registerTermaAction("settings-ai-mcp-discover", async ({element}) => {
    const serverIndex = Number(element.dataset.mcpIndex || 0);
    const server = terminalAiMcpServersDraft[serverIndex];
    if (!server) return;
    setButtonBusy(element, true);
    try {
      // Discovery is also the explicit save step for a newly added server.
      // This keeps registration and tool discovery as two visible operations.
      await api(`/api/ai/mcp/servers/${encodeURIComponent(server.id)}`, {method:"PUT", body:JSON.stringify({server})});
      const result = await api(`/api/ai/mcp/servers/${encodeURIComponent(server.id)}/discover`, {method:"POST", body:"{}"});
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      const discoveredServer = result?.server && typeof result.server === "object" ? result.server : {};
      terminalAiMcpServersDraft[serverIndex] = {...server, ...discoveredServer, tools:tools.map(tool => ({
        name:String(tool?.name || ""),
        description:String(tool?.description || ""),
        inputSchema:tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {},
        enabled:tool?.enabled !== false,
        requires_approval:tool?.requires_approval !== false
      })).filter(tool => tool.name), tools_updated_at:Number(discoveredServer.tools_updated_at || Date.now())};
      terminalAiSettingsDraftDirty = true;
      renderSettings();
      notify(tr("settings:ai.mcp_discovered", {count:tools.length, defaultValue:`已发现 ${tools.length} 个工具`}), "success");
    } catch (error) {
      notify(error.message || tr("settings:ai.mcp_discover_failed", {defaultValue:"MCP 工具发现失败"}), "error");
    } finally { setButtonBusy(element, false); }
  });
  registerTermaAction("settings-ai-mcp-remove", ({element}) => {
    const removed = terminalAiMcpServersDraft.splice(Number(element.dataset.mcpIndex || 0), 1)[0];
    if (removed && String(terminalAiMcpEditorDraft?.id || "") === String(removed.id || "")) terminalAiMcpEditorDraft = null;
    terminalAiSettingsDraftDirty = true;
    renderSettings();
  });
  registerTermaAction("settings-ai-mcp-tool-enabled", ({element}) => {
    const server = terminalAiMcpServersDraft[Number(element.dataset.mcpIndex || 0)];
    const tool = server?.tools?.[Number(element.dataset.mcpToolIndex || 0)];
    if (!tool) return;
    tool.enabled = element.checked === true;
    terminalAiSettingsDraftDirty = true;
  });
  registerTermaAction("settings-ai-mcp-tool-approval", ({element}) => {
    const server = terminalAiMcpServersDraft[Number(element.dataset.mcpIndex || 0)];
    const tool = server?.tools?.[Number(element.dataset.mcpToolIndex || 0)];
    if (!tool) return;
    tool.requires_approval = element.checked !== false;
    terminalAiSettingsDraftDirty = true;
  });
  registerTermaAction("settings-ai-mcp-server-enabled", ({element}) => {
    const server = terminalAiMcpServersDraft[Number(element.dataset.mcpIndex || 0)];
    if (!server) return;
    server.enabled = element.checked === true;
    terminalAiSettingsDraftDirty = true;
  });
  registerTermaAction("settings-ai-save", () => saveTerminalAiSettings());
  registerTermaAction("settings-ai-test", () => testTerminalAiSettings());
}
