const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_LISTEN_HOSTS = ["127.0.0.1"];
const DEFAULT_LISTEN_PORT = 8088;
const MAX_PORT_FALLBACKS = 20;
const DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB = 50;
const DEFAULT_SFTP_LIGHT_EDITOR_THRESHOLD_MB = 10;
const DEFAULT_SFTP_TRANSFER_CONCURRENCY = 3;
const DEFAULT_LANGUAGE = "zh-CN";
const SUPPORTED_LANGUAGES = new Set(["zh-CN", "en-US"]);
const DEFAULT_VNC_FULLSCREEN_TOOLBAR = "always";
const VNC_FULLSCREEN_TOOLBAR_MODES = new Set(["always", "never", "edge"]);
const DEFAULT_UI_REFRESH_INTERVAL_MS = 4000;
const DEFAULT_SFTP_ACTIVE_STATUS_POLL_INTERVAL_MS = 5000;
const DEFAULT_SFTP_BACKGROUND_STATUS_POLL_INTERVAL_MS = 15000;
const DEFAULT_VNC_LOCAL_IMAGE_POLL_INTERVAL_MS = 5000;
const DEFAULT_VNC_REMOTE_IMAGE_POLL_INTERVAL_MS = 3000;
const DEFAULT_NOTIFICATION_DISPLAY = Object.freeze({
  info: Object.freeze({ enabled: true, duration_ms: 3500 }),
  success: Object.freeze({ enabled: true, duration_ms: 3500 }),
  error: Object.freeze({ enabled: true, duration_ms: 8000 }),
  progress: Object.freeze({ enabled: true, success_duration_ms: null, error_duration_ms: 8000 })
});
const SFTP_TEXT_EDITOR_MODES = new Set(["ace", "auto", "light"]);
const SFTP_DOUBLE_CLICK_FILE_ACTIONS = new Set(["internal", "external"]);
const SFTP_EXTERNAL_EDIT_SAVE_RULES = new Set(["prompt", "overwrite"]);
const DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT = Object.freeze({
  unsplit: Object.freeze({ terminal: "header", sftp: "header" }),
  split: Object.freeze({ terminal: "header", sftp: "header" })
});
const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  font_family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  font_size: 13,
  scrollback_lines: 30000,
  background_mode: "theme",
  background_color: "#0f1720",
  middle_mouse_action: "paste_clipboard",
  right_mouse_action: "context_menu",
  ctrl_left_click_moves_cursor: true,
  url_links_enabled: true,
  url_prefixes: ["http://", "https://", "ftp://", "ssh://", "telnet://"],
  url_ctrl_click: true,
  word_separators: " ()[]{}',\"`",
  shift_double_click_uses_separators: false,
  auto_copy_selection: false,
  copy_tabs_to_spaces: false,
  copy_include_trailing_newline: false,
  copy_trim_trailing_spaces: false,
  select_non_whitespace_block: false,
  multiline_paste_mode: "prompt"
});
const DEFAULT_AI_CONTEXT_TOKENS = 1000000;
const AI_CONTEXT_DEFAULT_VERSION = 1;
const AI_API_TYPES = new Set(["responses", "completions"]);
const AI_PANEL_PLACEMENTS = new Set(["right", "bottom"]);
const AI_PERMISSION_LEVELS = new Set(["suggest", "confirm", "controlled", "full"]);
const AI_REASONING_EFFORTS = new Set(["none", "low", "medium", "high"]);
const AI_DEFAULT_SKILLS = ["linux-diagnostics", "security-audit", "log-analysis", "service-troubleshooting"];
const AI_BUILTIN_SKILLS = new Set([...AI_DEFAULT_SKILLS, "network-diagnostics", "performance-analysis", "container-troubleshooting", "git-workflow", "incident-response", "web-research"]);
const AI_MAX_USER_SKILLS = 32;
const AI_MAX_MCP_SERVERS = 24;
const AI_MAX_PROVIDERS = 12;
const AI_MCP_TRANSPORTS = new Set(["stdio", "sse", "streamable-http"]);
const AI_MCP_PROTECTED_HEADERS = new Set([
  "accept", "connection", "content-length", "content-type", "host", "mcp-protocol-version",
  "mcp-session-id", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "user-agent"
]);
const DEFAULT_AI_SETTINGS = Object.freeze({
  enabled: false,
  provider: "openai-compatible",
  active_provider_id: "default",
  providers: [{id:"default", name:"默认供应商", default_name:true, provider:"openai-compatible", endpoint:"https://api.openai.com/v1", model:"", api_type:"responses", api_key:""}],
  endpoint: "https://api.openai.com/v1",
  model: "",
  api_type: "responses",
  reasoning_effort: "none",
  deep_thinking: false,
  timeout_seconds: 60,
  context_tokens: DEFAULT_AI_CONTEXT_TOKENS,
  context_default_version: AI_CONTEXT_DEFAULT_VERSION,
  terminal_ai_placement: "right",
  terminal_ai_permission: "confirm",
  skills_enabled: [...AI_DEFAULT_SKILLS],
  user_skills: [],
  mcp_servers: [],
  api_key: ""
});
const TERMINAL_MOUSE_ACTIONS = new Set(["none", "context_menu", "paste_clipboard", "open_settings", "send_enter", "paste_selection"]);
const TERMINAL_MULTILINE_PASTE_MODES = new Set(["prompt", "paste", "single_line"]);
const TERMINAL_URL_SCHEMES = new Set(["http", "https", "ftp", "ssh", "telnet"]);
const TERMINAL_BACKGROUND_MODES = new Set(["theme", "black", "white", "custom"]);
const WORKSPACE_TOOLBAR_PLACEMENTS = new Set(["tab", "header"]);

function normalizeMcpHeaders(value: any): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP 请求头必须是 JSON 对象");
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value).slice(0, 32)) {
    const name = String(rawName || "").trim();
    const headerValue = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,120}$/.test(name)) throw new Error("MCP 请求头名称无效");
    if (AI_MCP_PROTECTED_HEADERS.has(name.toLowerCase())) throw new Error(`MCP 请求头 ${name} 由 Terma 管理，不能覆盖`);
    if (!headerValue || headerValue.length > 4096 || /[\0\r\n]/.test(headerValue)) throw new Error(`MCP 请求头 ${name} 的值无效`);
    headers[name] = headerValue;
  }
  return headers;
}

function splitListenHosts(value) {
  const source = Array.isArray(value) ? value : [value];
  return source.flatMap(item => String(item ?? "").split(/[\s,]+/)).map(item => item.trim()).filter(Boolean);
}

function normalizeListenHosts(value, fallback: any = DEFAULT_LISTEN_HOSTS) {
  const hosts = [...new Set(splitListenHosts(value))];
  if (!hosts.length) {
    if (fallback === null) throw new Error("请至少选择一个监听地址");
    return normalizeListenHosts(fallback, null);
  }
  for (const host of hosts) {
    if (net.isIP(host) !== 4) throw new Error(`监听地址必须是 IPv4 地址：${host}`);
  }
  return hosts.includes("0.0.0.0") ? ["0.0.0.0"] : hosts;
}

function normalizeListenPort(value, fallback: any = DEFAULT_LISTEN_PORT) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (fallback === null) throw new Error("监听端口不能为空");
    return normalizeListenPort(fallback, null);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须是 1-65535 的整数");
  return port;
}

function normalizeTerminalUrlPrefixes(value, fallback: any = DEFAULT_TERMINAL_SETTINGS.url_prefixes) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[|,\s]+/);
  const prefixes = [...new Set(source.map(item => String(item || "").trim()).filter(Boolean))];
  const normalized = prefixes.filter(prefix => {
    const match = prefix.match(/^([a-z][a-z0-9+.-]*):\/\/$/i);
    return Boolean(match && TERMINAL_URL_SCHEMES.has(match[1].toLowerCase()));
  }).slice(0, 10);
  if (normalized.length) return normalized;
  return Array.isArray(fallback) ? [...fallback] : [...DEFAULT_TERMINAL_SETTINGS.url_prefixes];
}

function normalizeTerminalSettings(value: any = {}, fallback: any = DEFAULT_TERMINAL_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_TERMINAL_SETTINGS;
  const middleMouseAction = String(source.middle_mouse_action ?? base.middle_mouse_action ?? DEFAULT_TERMINAL_SETTINGS.middle_mouse_action);
  const rightMouseAction = String(source.right_mouse_action ?? base.right_mouse_action ?? DEFAULT_TERMINAL_SETTINGS.right_mouse_action);
  const multilinePasteMode = String(source.multiline_paste_mode ?? base.multiline_paste_mode ?? DEFAULT_TERMINAL_SETTINGS.multiline_paste_mode);
  const backgroundMode = String(source.background_mode ?? base.background_mode ?? DEFAULT_TERMINAL_SETTINGS.background_mode);
  const backgroundColorValue = String(source.background_color ?? base.background_color ?? DEFAULT_TERMINAL_SETTINGS.background_color).trim();
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(backgroundColorValue)
    ? backgroundColorValue.toLowerCase()
    : DEFAULT_TERMINAL_SETTINGS.background_color;
  const wordSeparators = String(source.word_separators ?? base.word_separators ?? DEFAULT_TERMINAL_SETTINGS.word_separators).slice(0, 128);
  const fontFamily = String(source.font_family ?? base.font_family ?? DEFAULT_TERMINAL_SETTINGS.font_family).trim();
  const fontSize = Number(source.font_size ?? base.font_size ?? DEFAULT_TERMINAL_SETTINGS.font_size);
  const scrollbackLines = Number(source.scrollback_lines ?? base.scrollback_lines ?? DEFAULT_TERMINAL_SETTINGS.scrollback_lines);
  if (!fontFamily || fontFamily.length > 300 || /[\0\r\n]/.test(fontFamily)) {
    throw new Error("默认终端字体长度必须在 1-300 个字符之间，且不能包含换行");
  }
  if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 32) {
    throw new Error("默认终端字号必须是 10-32 之间的整数");
  }
  if (!Number.isInteger(scrollbackLines) || scrollbackLines < 1000 || scrollbackLines > 100000) {
    throw new Error("终端回滚行数必须是 1000-100000 之间的整数");
  }
  return {
    font_family:fontFamily,
    font_size:fontSize,
    scrollback_lines:scrollbackLines,
    background_mode: TERMINAL_BACKGROUND_MODES.has(backgroundMode) ? backgroundMode : DEFAULT_TERMINAL_SETTINGS.background_mode,
    background_color: backgroundColor,
    middle_mouse_action: TERMINAL_MOUSE_ACTIONS.has(middleMouseAction) ? middleMouseAction : DEFAULT_TERMINAL_SETTINGS.middle_mouse_action,
    right_mouse_action: TERMINAL_MOUSE_ACTIONS.has(rightMouseAction) ? rightMouseAction : DEFAULT_TERMINAL_SETTINGS.right_mouse_action,
    ctrl_left_click_moves_cursor: source.ctrl_left_click_moves_cursor === undefined ? base.ctrl_left_click_moves_cursor !== false : source.ctrl_left_click_moves_cursor === true,
    url_links_enabled: source.url_links_enabled === undefined ? base.url_links_enabled === true : source.url_links_enabled === true,
    url_prefixes: normalizeTerminalUrlPrefixes(source.url_prefixes, base.url_prefixes),
    url_ctrl_click: source.url_ctrl_click === undefined ? base.url_ctrl_click !== false : source.url_ctrl_click === true,
    word_separators: wordSeparators || DEFAULT_TERMINAL_SETTINGS.word_separators,
    shift_double_click_uses_separators: source.shift_double_click_uses_separators === undefined ? base.shift_double_click_uses_separators === true : source.shift_double_click_uses_separators === true,
    auto_copy_selection: source.auto_copy_selection === undefined ? base.auto_copy_selection !== false : source.auto_copy_selection === true,
    copy_tabs_to_spaces: source.copy_tabs_to_spaces === undefined ? base.copy_tabs_to_spaces === true : source.copy_tabs_to_spaces === true,
    copy_include_trailing_newline: source.copy_include_trailing_newline === undefined ? base.copy_include_trailing_newline !== false : source.copy_include_trailing_newline === true,
    copy_trim_trailing_spaces: source.copy_trim_trailing_spaces === undefined ? base.copy_trim_trailing_spaces === true : source.copy_trim_trailing_spaces === true,
    select_non_whitespace_block: source.select_non_whitespace_block === undefined ? base.select_non_whitespace_block === true : source.select_non_whitespace_block === true,
    multiline_paste_mode: TERMINAL_MULTILINE_PASTE_MODES.has(multilinePasteMode) ? multilinePasteMode : DEFAULT_TERMINAL_SETTINGS.multiline_paste_mode
  };
}

function normalizeAiEndpoint(value: any, fallback: any = DEFAULT_AI_SETTINGS.endpoint) {
  const endpoint = String(value ?? fallback ?? DEFAULT_AI_SETTINGS.endpoint).trim();
  if (!endpoint || endpoint.length > 2048 || /[\0\r\n]/.test(endpoint)) throw new Error("AI 服务地址无效");
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error("AI 服务地址必须是有效的 HTTP 或 HTTPS 地址"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error("AI 服务地址只能使用 HTTP 或 HTTPS，且不能包含账号、密码或片段");
  }
  return endpoint;
}

function normalizeAiProviderId(value: any, fallback: any, index: number) {
  const raw = String(value ?? fallback ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return raw || `provider-${index + 1}`;
}

function normalizeAiProvider(value: any = {}, fallback: any = {}, index = 0) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const name = String(source.name ?? base.name ?? `供应商 ${index + 1}`).replace(/[\0\r\n]/g, " ").trim().slice(0, 120) || `供应商 ${index + 1}`;
  const endpoint = normalizeAiEndpoint(source.endpoint ?? base.endpoint);
  const model = String(source.model ?? base.model ?? "").trim();
  if (model.length > 200 || /[\0\r\n]/.test(model)) throw new Error("AI 模型名称无效");
  const apiType = String(source.api_type ?? base.api_type ?? DEFAULT_AI_SETTINGS.api_type);
  const apiKey = String(source.api_key ?? base.api_key ?? "");
  if (apiKey.length > 4096 || /[\0\r\n]/.test(apiKey)) throw new Error("AI API 密钥无效");
  return {
    id:normalizeAiProviderId(source.id, base.id, index),
    name,
    default_name:source.default_name === true || base.default_name === true,
    provider:"openai-compatible",
    endpoint,
    model,
    api_type:AI_API_TYPES.has(apiType) ? apiType : DEFAULT_AI_SETTINGS.api_type,
    api_key:apiKey
  };
}

function normalizeAiSettings(value: any = {}, fallback: any = DEFAULT_AI_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_AI_SETTINGS;
  const legacyEndpoint = normalizeAiEndpoint(source.endpoint ?? base.endpoint);
  const legacyModel = String(source.model ?? base.model ?? DEFAULT_AI_SETTINGS.model).trim();
  if (legacyModel.length > 200 || /[\0\r\n]/.test(legacyModel)) throw new Error("AI 模型名称无效");
  const timeout = Number(source.timeout_seconds ?? base.timeout_seconds ?? DEFAULT_AI_SETTINGS.timeout_seconds);
  if (!Number.isInteger(timeout) || timeout < 5 || timeout > 300) throw new Error("AI 请求超时必须是 5-300 秒之间的整数");
  const legacyContextChars = source.context_tokens === undefined && source.context_chars !== undefined
    ? Math.round(Number(source.context_chars) / 4)
    : undefined;
  const contextTokens = Number(source.context_tokens ?? legacyContextChars ?? base.context_tokens ?? DEFAULT_AI_SETTINGS.context_tokens);
  if (!Number.isInteger(contextTokens) || contextTokens < 1000 || contextTokens > DEFAULT_AI_CONTEXT_TOKENS) throw new Error("AI 上下文长度必须是 1000-1000000 之间的整数");
  const apiType = String(source.api_type ?? base.api_type ?? DEFAULT_AI_SETTINGS.api_type);
  const reasoningEffort = String(source.reasoning_effort ?? base.reasoning_effort ?? DEFAULT_AI_SETTINGS.reasoning_effort).trim().toLowerCase();
  const deepThinking = source.deep_thinking === undefined ? base.deep_thinking === true : source.deep_thinking === true;
  const placement = String(source.terminal_ai_placement ?? base.terminal_ai_placement ?? DEFAULT_AI_SETTINGS.terminal_ai_placement);
  const permission = String(source.terminal_ai_permission ?? base.terminal_ai_permission ?? DEFAULT_AI_SETTINGS.terminal_ai_permission);
  const skillSource = Array.isArray(source.skills_enabled) ? source.skills_enabled : (Array.isArray(base.skills_enabled) ? base.skills_enabled : DEFAULT_AI_SETTINGS.skills_enabled);
  const skillsEnabled = [...new Set(skillSource.map((item: any) => String(item || "").trim()).filter((item: string) => AI_BUILTIN_SKILLS.has(item)))];
  const apiKey = String(source.api_key ?? base.api_key ?? "");
  if (apiKey.length > 4096 || /[\0\r\n]/.test(apiKey)) throw new Error("AI API 密钥无效");
  const baseProviders = Array.isArray(base.providers) ? base.providers : [];
  const sourceHasProviders = Array.isArray(source.providers);
  const requestedActiveId = String(source.active_provider_id ?? base.active_provider_id ?? "").trim();
  let providerCandidates: any[];
  if (sourceHasProviders) {
    const legacySingleProvider = source.providers.length === 1 && String(source.providers[0]?.id || "") === "default";
    providerCandidates = source.providers.map((item: any) => {
      if (String(item?.id || "") !== requestedActiveId) return item;
      const merged = {...item};
      for (const key of ["endpoint", "model", "api_type", "api_key"]) {
        if ((legacySingleProvider || !Object.prototype.hasOwnProperty.call(merged, key)) && Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key];
      }
      return merged;
    });
  } else if (baseProviders.length) {
    const baseActiveId = requestedActiveId || String(baseProviders[0]?.id || "");
    providerCandidates = baseProviders.map((item: any) => String(item?.id || "") === baseActiveId
      ? {...item, endpoint:source.endpoint ?? item.endpoint, model:source.model ?? item.model, api_type:source.api_type ?? item.api_type, api_key:source.api_key ?? item.api_key}
      : item);
  } else {
    providerCandidates = [{id:requestedActiveId || "default", name:"默认供应商", default_name:true, endpoint:legacyEndpoint, model:legacyModel, api_type:apiType, api_key:apiKey}];
  }
  const providers: any[] = [];
  const providerIds = new Set<string>();
  providerCandidates.slice(0, AI_MAX_PROVIDERS).forEach((item: any, index: number) => {
    const fallbackProvider = baseProviders.find((candidate: any) => String(candidate?.id || "") === String(item?.id || ""));
    const provider = normalizeAiProvider(item, fallbackProvider, index);
    if (providerIds.has(provider.id)) provider.id = `provider-${index + 1}`;
    if (providerIds.has(provider.id)) return;
    providerIds.add(provider.id);
    providers.push(provider);
  });
  if (!providers.length) providers.push(normalizeAiProvider({id:"default", name:"默认供应商", default_name:true, endpoint:legacyEndpoint, model:legacyModel, api_type:apiType, api_key:apiKey}, {}, 0));
  const activeProvider = providers.find(item => item.id === requestedActiveId) || providers[0];
  const userSkills = (Array.isArray(source.user_skills) ? source.user_skills : (Array.isArray(base.user_skills) ? base.user_skills : []))
    .slice(0, AI_MAX_USER_SKILLS).flatMap((item: any) => {
      const id = String(item?.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
      const name = String(item?.name || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 120);
      const description = String(item?.description || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 300);
      const prompt = String(item?.prompt || "").replace(/\0/g, "").trim().slice(0, 12000);
      return id && name && prompt ? [{id, name, description, prompt, enabled:item?.enabled !== false, updated_at:Number(item?.updated_at || Date.now())}] : [];
    });
  const mcpServers = (Array.isArray(source.mcp_servers) ? source.mcp_servers : (Array.isArray(base.mcp_servers) ? base.mcp_servers : []))
    .slice(0, AI_MAX_MCP_SERVERS).flatMap((item: any) => {
      const id = String(item?.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
      const name = String(item?.name || id).replace(/[\0\r\n]/g, " ").trim().slice(0, 120);
      const requestedTransport = item?.transport === "http" ? "streamable-http" : String(item?.transport || "stdio");
      const transport = AI_MCP_TRANSPORTS.has(requestedTransport) ? requestedTransport : "stdio";
      const command = String(item?.command || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 300);
      const args = Array.isArray(item?.args) ? item.args.map((arg: any) => String(arg || "").replace(/[\0\r\n]/g, " ").slice(0, 300)).filter(Boolean).slice(0, 32) : [];
      const url = String(item?.url || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 2048);
      const headers = transport === "stdio" ? {} : normalizeMcpHeaders(item?.headers);
      const tools = Array.isArray(item?.tools) ? item.tools.slice(0, 128).flatMap((tool: any) => {
        const toolName = String(tool?.name || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 120);
        if (!toolName || !/^[a-zA-Z0-9_.:-]+$/.test(toolName)) return [];
        const description = String(tool?.description || "").replace(/[\0\r\n]/g, " ").trim().slice(0, 500);
        const inputSchema = tool?.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) ? tool.inputSchema : {};
        const risk = ["read", "write", "external"].includes(String(tool?.risk)) ? String(tool.risk) : "read";
        return [{name:toolName, description, inputSchema, risk, enabled:tool?.enabled !== false, requires_approval:tool?.requires_approval !== false}];
      }) : [];
      const toolsUpdatedAt = Number(item?.tools_updated_at || 0);
      return id && name && ((transport === "stdio" && command) || (transport !== "stdio" && url)) ? [{id, name, transport, command, args, url, headers, enabled:item?.enabled === true, timeout_ms:Number(item?.timeout_ms || 30000), tools, tools_updated_at:Number.isFinite(toolsUpdatedAt) ? Math.max(0, Math.round(toolsUpdatedAt)) : 0}] : [];
    });
  return {
    enabled: source.enabled === undefined ? base.enabled !== false : source.enabled === true,
    provider: activeProvider.provider,
    active_provider_id: activeProvider.id,
    providers,
    endpoint:activeProvider.endpoint,
    model:activeProvider.model,
    api_type:activeProvider.api_type,
    reasoning_effort: AI_REASONING_EFFORTS.has(reasoningEffort) ? reasoningEffort : DEFAULT_AI_SETTINGS.reasoning_effort,
    deep_thinking: deepThinking,
    timeout_seconds: timeout,
    context_tokens: contextTokens,
    context_default_version: AI_CONTEXT_DEFAULT_VERSION,
    terminal_ai_placement: AI_PANEL_PLACEMENTS.has(placement) ? placement : DEFAULT_AI_SETTINGS.terminal_ai_placement,
    terminal_ai_permission: AI_PERMISSION_LEVELS.has(permission) ? permission : DEFAULT_AI_SETTINGS.terminal_ai_permission,
    skills_enabled: skillsEnabled,
    user_skills: userSkills,
    mcp_servers: mcpServers,
    api_key:activeProvider.api_key
  };
}

function normalizeWorkspaceToolbarPlacement(value: any = {}, fallback: any = DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT;
  const normalizePlacement = (candidate, defaultValue) => {
    const placement = String(candidate ?? defaultValue ?? "header");
    return WORKSPACE_TOOLBAR_PLACEMENTS.has(placement) ? placement : "header";
  };
  return {
    unsplit: {
      terminal: normalizePlacement(source.unsplit?.terminal, base.unsplit?.terminal),
      sftp: normalizePlacement(source.unsplit?.sftp, base.unsplit?.sftp)
    },
    split: {
      terminal: normalizePlacement(source.split?.terminal, base.split?.terminal),
      sftp: normalizePlacement(source.split?.sftp, base.split?.sftp)
    }
  };
}

function normalizeNotificationDuration(value, fallback, options: any = {}) {
  if (options.nullable && value === null) return null;
  if (options.nullable && (value === undefined || String(value).trim() === "")) {
    return fallback === null || fallback === undefined ? null : normalizeNotificationDuration(fallback, null, options);
  }
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const duration = Number(candidate);
  if (!Number.isInteger(duration) || duration < 500 || duration > 60000) {
    throw new Error("通知显示时长必须是 0.5-60 秒之间的毫秒整数");
  }
  return duration;
}

function normalizeNotificationDisplay(value: any = {}, fallback: any = DEFAULT_NOTIFICATION_DISPLAY) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_NOTIFICATION_DISPLAY;
  const category = (name, defaultValue) => {
    const current = source[name] && typeof source[name] === "object" ? source[name] : {};
    const previous = base[name] && typeof base[name] === "object" ? base[name] : defaultValue;
    return { current, previous };
  };
  const info = category("info", DEFAULT_NOTIFICATION_DISPLAY.info);
  const success = category("success", DEFAULT_NOTIFICATION_DISPLAY.success);
  const error = category("error", DEFAULT_NOTIFICATION_DISPLAY.error);
  const progress = category("progress", DEFAULT_NOTIFICATION_DISPLAY.progress);
  return {
    info: {
      enabled: info.current.enabled === undefined ? info.previous.enabled !== false : info.current.enabled !== false,
      duration_ms: normalizeNotificationDuration(info.current.duration_ms, info.previous.duration_ms)
    },
    success: {
      enabled: success.current.enabled === undefined ? success.previous.enabled !== false : success.current.enabled !== false,
      duration_ms: normalizeNotificationDuration(success.current.duration_ms, success.previous.duration_ms)
    },
    error: {
      enabled: error.current.enabled === undefined ? error.previous.enabled !== false : error.current.enabled !== false,
      duration_ms: normalizeNotificationDuration(error.current.duration_ms, error.previous.duration_ms)
    },
    progress: {
      enabled: progress.current.enabled === undefined ? progress.previous.enabled !== false : progress.current.enabled !== false,
      success_duration_ms: normalizeNotificationDuration(
        progress.current.success_duration_ms,
        progress.previous.success_duration_ms,
        { nullable:true }
      ),
      error_duration_ms: normalizeNotificationDuration(progress.current.error_duration_ms, progress.previous.error_duration_ms)
    }
  };
}

function normalizeLanguage(value, fallback = DEFAULT_LANGUAGE) {
  const language = String(value === undefined || value === null ? fallback : value).trim();
  return SUPPORTED_LANGUAGES.has(language) ? language : DEFAULT_LANGUAGE;
}

function normalizeBackgroundInterval(value, fallback, label) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const interval = Number(candidate);
  if (!Number.isInteger(interval) || interval < 1000 || interval > 60000) {
    throw new Error(`${label}必须是 1-60 秒之间的毫秒整数`);
  }
  return interval;
}

function normalizeRuntimeSettings(value: any = {}, fallback: any = {}) {
  const hostsValue = value.listen_hosts !== undefined ? value.listen_hosts
    : (value.hosts !== undefined ? value.hosts : value.host);
  const portValue = value.listen_port !== undefined ? value.listen_port : value.port;
  return {
    schema_version: 21,
    language: normalizeLanguage(value.language, fallback.language),
    language_onboarding_version: Math.max(0, Math.min(1, Number.isInteger(Number(value.language_onboarding_version ?? fallback.language_onboarding_version))
      ? Number(value.language_onboarding_version ?? fallback.language_onboarding_version)
      : 0)),
    vnc_fullscreen_toolbar: VNC_FULLSCREEN_TOOLBAR_MODES.has(String(value.vnc_fullscreen_toolbar ?? fallback.vnc_fullscreen_toolbar ?? DEFAULT_VNC_FULLSCREEN_TOOLBAR))
      ? String(value.vnc_fullscreen_toolbar ?? fallback.vnc_fullscreen_toolbar ?? DEFAULT_VNC_FULLSCREEN_TOOLBAR)
      : DEFAULT_VNC_FULLSCREEN_TOOLBAR,
    ui_refresh_interval_ms: normalizeBackgroundInterval(
      value.ui_refresh_interval_ms,
      fallback.ui_refresh_interval_ms ?? DEFAULT_UI_REFRESH_INTERVAL_MS,
      "全局数据检查间隔"
    ),
    sftp_active_status_poll_interval_ms: normalizeBackgroundInterval(
      value.sftp_active_status_poll_interval_ms,
      fallback.sftp_active_status_poll_interval_ms ?? DEFAULT_SFTP_ACTIVE_STATUS_POLL_INTERVAL_MS,
      "SFTP 当前标签状态检查间隔"
    ),
    sftp_background_status_poll_interval_ms: normalizeBackgroundInterval(
      value.sftp_background_status_poll_interval_ms,
      fallback.sftp_background_status_poll_interval_ms ?? DEFAULT_SFTP_BACKGROUND_STATUS_POLL_INTERVAL_MS,
      "SFTP 后台标签状态检查间隔"
    ),
    vnc_local_image_poll_interval_ms: normalizeBackgroundInterval(
      value.vnc_local_image_poll_interval_ms,
      fallback.vnc_local_image_poll_interval_ms ?? DEFAULT_VNC_LOCAL_IMAGE_POLL_INTERVAL_MS,
      "VNC 本机图片检查间隔"
    ),
    vnc_remote_image_poll_interval_ms: normalizeBackgroundInterval(
      value.vnc_remote_image_poll_interval_ms,
      fallback.vnc_remote_image_poll_interval_ms ?? DEFAULT_VNC_REMOTE_IMAGE_POLL_INTERVAL_MS,
      "VNC 远端图片检查间隔"
    ),
    listen_hosts: normalizeListenHosts(hostsValue, hostsValue === undefined ? (fallback.listen_hosts ?? DEFAULT_LISTEN_HOSTS) : null),
    listen_port: normalizeListenPort(portValue, portValue === undefined ? (fallback.listen_port ?? DEFAULT_LISTEN_PORT) : null),
    sftp_recycle_bin_enabled: value.sftp_recycle_bin_enabled === undefined
      ? fallback.sftp_recycle_bin_enabled === true
      : value.sftp_recycle_bin_enabled === true,
    sftp_floating_progress_enabled: value.sftp_floating_progress_enabled === undefined
      ? fallback.sftp_floating_progress_enabled !== false
      : value.sftp_floating_progress_enabled !== false,
    notification_display: normalizeNotificationDisplay(
      value.notification_display,
      fallback.notification_display
    ),
    sftp_max_open_file_size_mb: normalizeSftpMaxOpenFileSize(
      value.sftp_max_open_file_size_mb,
      fallback.sftp_max_open_file_size_mb
    ),
    sftp_text_editor_mode: normalizeSftpTextEditorMode(
      value.sftp_text_editor_mode,
      fallback.sftp_text_editor_mode
    ),
    sftp_double_click_file_action: normalizeSftpDoubleClickFileAction(
      value.sftp_double_click_file_action,
      fallback.sftp_double_click_file_action
    ),
    sftp_light_editor_threshold_mb: normalizeSftpLightEditorThreshold(
      value.sftp_light_editor_threshold_mb,
      fallback.sftp_light_editor_threshold_mb
    ),
    sftp_external_edit_save_rule: normalizeSftpExternalEditSaveRule(
      value.sftp_external_edit_save_rule,
      fallback.sftp_external_edit_save_rule
    ),
    sftp_external_edit_backup_enabled: value.sftp_external_edit_backup_enabled === undefined
      ? fallback.sftp_external_edit_backup_enabled !== false
      : value.sftp_external_edit_backup_enabled !== false,
    sftp_download_concurrency: normalizeSftpTransferConcurrency(
      value.sftp_download_concurrency,
      fallback.sftp_download_concurrency
    ),
    sftp_upload_concurrency: normalizeSftpTransferConcurrency(
      value.sftp_upload_concurrency,
      fallback.sftp_upload_concurrency
    ),
    sftp_download_directory: normalizeSftpDownloadDirectory(
      value.sftp_download_directory,
      fallback.sftp_download_directory
    ),
    restore_workspace_tabs: value.restore_workspace_tabs === undefined
      ? fallback.restore_workspace_tabs !== false
      : value.restore_workspace_tabs !== false,
    remote_desktop_quick_open_enabled: value.remote_desktop_quick_open_enabled === undefined
      ? fallback.remote_desktop_quick_open_enabled === true
      : value.remote_desktop_quick_open_enabled === true,
    vnc_quick_open_new_window: value.vnc_quick_open_new_window === undefined
      ? fallback.vnc_quick_open_new_window !== false
      : value.vnc_quick_open_new_window !== false,
    workspace_toolbar_placement: normalizeWorkspaceToolbarPlacement(
      value.workspace_toolbar_placement,
      fallback.workspace_toolbar_placement
    ),
    terminal: normalizeTerminalSettings(value.terminal, fallback.terminal),
    ai: normalizeAiSettings(value.ai, fallback.ai)
  };
}

function normalizeSftpDownloadDirectory(value, fallback = "") {
  const directory = String(value === undefined || value === null ? (fallback || "") : value).trim();
  if (directory.includes("\0") || directory.length > 4096) throw new Error("SFTP 下载目录无效");
  return directory;
}

function normalizeSftpMaxOpenFileSize(value, fallback = DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const size = Number(candidate);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("SFTP 文件打开上限必须是 1-100 MB 的整数");
  return size;
}

function normalizeSftpTextEditorMode(value, fallback = "ace") {
  const mode = String(value === undefined || value === null ? (fallback || "ace") : value).trim().toLowerCase();
  return SFTP_TEXT_EDITOR_MODES.has(mode) ? mode : "ace";
}

function normalizeSftpDoubleClickFileAction(value, fallback = "internal") {
  const action = String(value === undefined || value === null ? (fallback || "internal") : value).trim().toLowerCase();
  return SFTP_DOUBLE_CLICK_FILE_ACTIONS.has(action) ? action : "internal";
}

function normalizeSftpLightEditorThreshold(value, fallback = DEFAULT_SFTP_LIGHT_EDITOR_THRESHOLD_MB) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const size = Number(candidate);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("SFTP 轻量编辑器阈值必须是 1-100 MB 的整数");
  return size;
}

function normalizeSftpExternalEditSaveRule(value, fallback = "prompt") {
  const rule = String(value === undefined || value === null ? (fallback || "prompt") : value).trim().toLowerCase();
  return SFTP_EXTERNAL_EDIT_SAVE_RULES.has(rule) ? rule : "prompt";
}

function normalizeSftpTransferConcurrency(value, fallback = DEFAULT_SFTP_TRANSFER_CONCURRENCY) {
  const candidate = value === undefined || value === null || String(value).trim() === "" ? fallback : value;
  const concurrency = Number(candidate);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("SFTP 传输并发数必须是 1-8 的整数");
  return concurrency;
}

function readRuntimeSettings(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Number(parsed.schema_version || 0) < 8 && Number(parsed.sftp_max_open_file_size_mb) === 5) {
      parsed.sftp_max_open_file_size_mb = DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB;
    }
    if (
      parsed.ai
      && typeof parsed.ai === "object"
      && Number(parsed.ai.context_default_version || 0) < AI_CONTEXT_DEFAULT_VERSION
      && Number(parsed.ai.context_tokens) === 4000
    ) {
      parsed.ai.context_tokens = DEFAULT_AI_CONTEXT_TOKENS;
    }
    return normalizeRuntimeSettings(parsed);
  } catch {
    return normalizeRuntimeSettings();
  }
}

function writeRuntimeSettings(filePath, value) {
  const normalized = normalizeRuntimeSettings(value);
  const result = { ...normalized, updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return result;
}

function resolveRuntimeSettings(filePath, env: any = process.env) {
  const persisted = readRuntimeSettings(filePath);
  let listenHosts = persisted.listen_hosts;
  let listenPort = persisted.listen_port;
  let hostsSource = fs.existsSync(filePath) ? "file" : "default";
  let portSource = hostsSource;
  const envHosts = String(env.TUNNEL_WEB_HOSTS || env.TUNNEL_WEB_HOST || "").trim();
  const envPort = String(env.TUNNEL_WEB_PORT || "").trim();
  if (envHosts) {
    listenHosts = normalizeListenHosts(envHosts, null);
    hostsSource = "env";
  }
  if (envPort) {
    listenPort = normalizeListenPort(envPort, null);
    portSource = "env";
  }
  return {
    listen_hosts: listenHosts,
    listen_port: listenPort,
    sources: { listen_hosts: hostsSource, listen_port: portSource }
  };
}

function isLoopbackHost(host) {
  const parts = String(host || "").split(".").map(Number);
  return parts.length === 4 && parts[0] === 127 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
}

function availableListenHosts(interfaces: any = os.networkInterfaces()) {
  const out: any[] = [
    { address: "127.0.0.1", interface: "loopback", label: "仅本机", internal: true },
    { address: "0.0.0.0", interface: "all", label: "所有 IPv4 网卡", wildcard: true, internal: false }
  ];
  const seen = new Set(out.map(item => item.address));
  for (const [name, items] of Object.entries(interfaces || {}) as any) {
    for (const item of items || []) {
      if (item.family !== "IPv4" || item.internal || seen.has(item.address)) continue;
      seen.add(item.address);
      out.push({ address: item.address, interface: name, label: `${name} · ${item.address}`, internal: false });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_LANGUAGE,
  DEFAULT_VNC_FULLSCREEN_TOOLBAR,
  VNC_FULLSCREEN_TOOLBAR_MODES,
  DEFAULT_UI_REFRESH_INTERVAL_MS,
  DEFAULT_SFTP_ACTIVE_STATUS_POLL_INTERVAL_MS,
  DEFAULT_SFTP_BACKGROUND_STATUS_POLL_INTERVAL_MS,
  DEFAULT_VNC_LOCAL_IMAGE_POLL_INTERVAL_MS,
  DEFAULT_VNC_REMOTE_IMAGE_POLL_INTERVAL_MS,
  DEFAULT_NOTIFICATION_DISPLAY,
  DEFAULT_TERMINAL_SETTINGS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_WORKSPACE_TOOLBAR_PLACEMENT,
  DEFAULT_SFTP_MAX_OPEN_FILE_SIZE_MB,
  DEFAULT_SFTP_LIGHT_EDITOR_THRESHOLD_MB,
  DEFAULT_SFTP_TRANSFER_CONCURRENCY,
  DEFAULT_LISTEN_HOSTS,
  DEFAULT_LISTEN_PORT,
  MAX_PORT_FALLBACKS,
  availableListenHosts,
  isLoopbackHost,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeLanguage,
  normalizeNotificationDisplay,
  normalizeRuntimeSettings,
  normalizeSftpDownloadDirectory,
  normalizeSftpExternalEditSaveRule,
  normalizeSftpDoubleClickFileAction,
  normalizeSftpLightEditorThreshold,
  normalizeSftpMaxOpenFileSize,
  normalizeSftpTextEditorMode,
  normalizeTerminalSettings,
  normalizeAiSettings,
  normalizeWorkspaceToolbarPlacement,
  readRuntimeSettings,
  resolveRuntimeSettings,
  splitListenHosts,
  writeRuntimeSettings
};
