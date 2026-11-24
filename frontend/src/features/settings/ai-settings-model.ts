type Fields = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;
const fields = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const aiDefaultEndpoint = 'https://api.openai.com/v1';
export const aiSkills = ['linux-diagnostics', 'security-audit', 'log-analysis', 'service-troubleshooting',
  'network-diagnostics', 'performance-analysis', 'container-troubleshooting', 'git-workflow', 'incident-response', 'web-research'] as const;
export const aiReasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const aiPermissions = ['suggest', 'confirm', 'controlled', 'full'] as const;
const toolRisks = ['read', 'write', 'external'] as const;

function choose<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find(option => option === value) ?? fallback;
}

export function aiApiType(value: unknown) { return value === 'completions' ? 'completions' : 'responses'; }
export function aiMcpTransport(value: unknown): 'stdio' | 'sse' | 'streamable-http' {
  return value === 'sse' ? 'sse' : value === 'http' || value === 'streamable-http' ? 'streamable-http' : 'stdio';
}

export function aiDefaultProviderName(count: number, translate?: Translate) {
  const defaultValue = `Provider ${count}`;
  return translate?.('settings:ai.provider_default_name', {count, defaultValue}) ?? defaultValue;
}

function providerViews(source: Fields, translate?: Translate) {
  const endpoint = String(source.endpoint || aiDefaultEndpoint).trim() || aiDefaultEndpoint;
  const providers = list(source.providers).map((value, index) => {
    const item = fields(value);
    const fallbackName = aiDefaultProviderName(index + 1, translate);
    return {
      id: String(item.id || `provider-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80),
      name: item.default_name === true ? fallbackName : String(item.name || fallbackName).replace(/[\0\r\n]/g, ' ').trim().slice(0, 120) || fallbackName,
      default_name: item.default_name === true, provider: 'openai-compatible',
      endpoint: String(item.endpoint || endpoint).trim().slice(0, 2048), model: String(item.model || '').trim().slice(0, 200),
      api_type: aiApiType(item.api_type), api_key_configured: item.api_key_configured === true || Boolean(item.api_key),
      ...(item.api_key ? {api_key: String(item.api_key)} : {})
    };
  }).filter(item => item.id && item.endpoint);
  if (!providers.length) providers.push({
    id:'default', name:aiDefaultProviderName(1, translate), provider:'openai-compatible', endpoint,
    model:String(source.model || '').trim(), api_type:aiApiType(source.api_type),
    api_key_configured:source.api_key_configured === true || Boolean(source.api_key), default_name:true
  });
  return providers;
}

export function normalizeMcpServers(value: unknown) {
  return list(value).map(entry => {
    const item = fields(entry);
    return {
      id: String(item.id || ''), name: String(item.name || ''), transport: aiMcpTransport(item.transport),
      command: String(item.command || ''), args: list(item.args).map(String), url: String(item.url || ''),
      headers: Object.fromEntries(Object.entries(fields(item.headers)).map(([name, content]) => [name, String(content ?? '')])),
      enabled: item.enabled === true, timeout_ms: Number(item.timeout_ms || 30000),
      tools: list(item.tools).map(entry => {
        const tool = fields(entry);
        return {name:String(tool.name || ''), description:String(tool.description || ''),
          inputSchema:tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {},
          risk:choose(toolRisks, String(tool.risk), 'read'), enabled:tool.enabled !== false,
          requires_approval:tool.requires_approval !== false};
      }).filter(tool => tool.name),
      tools_updated_at: Number(item.tools_updated_at || 0)
    };
  }).filter(item => item.id && item.name);
}

export function normalizeAiSettingsResponse(value: unknown, translate?: Translate) {
  const source = fields(value);
  const providers = providerViews(source, translate);
  const activeProvider = providers.find(item => item.id === String(source.active_provider_id || '')) ?? providers[0];
  const skills = Array.isArray(source.skills_enabled) ? source.skills_enabled : aiSkills.slice(0, 4);
  return {
    enabled:source.enabled === true, provider:activeProvider.provider, active_provider_id:activeProvider.id, providers,
    endpoint:activeProvider.endpoint, model:activeProvider.model, api_type:activeProvider.api_type,
    reasoning_effort:choose(aiReasoningEfforts, String(source.reasoning_effort || '').toLowerCase(), 'none'),
    deep_thinking:source.deep_thinking === true,
    timeout_seconds:Math.max(5, Math.min(300, Number(source.timeout_seconds) || 60)),
    context_tokens:Math.max(1000, Math.min(1000000, Number(source.context_tokens ?? (source.context_chars !== undefined ? Number(source.context_chars) / 4 : 1000000)) || 1000000)),
    terminal_ai_placement:source.terminal_ai_placement === 'bottom' ? 'bottom' as const : 'right' as const,
    terminal_ai_permission:choose(aiPermissions, source.terminal_ai_permission, 'confirm'),
    skills_enabled:[...new Set(skills.flatMap(value => aiSkills.filter(skill => skill === String(value || ''))))],
    user_skills:list(source.user_skills).map(entry => {
      const item = fields(entry);
      return {id:String(item.id || ''), name:String(item.name || ''), description:String(item.description || ''), prompt:String(item.prompt || ''), enabled:item.enabled !== false};
    }).filter(item => item.id && item.name && item.prompt),
    mcp_servers:normalizeMcpServers(source.mcp_servers),
    api_key_configured:activeProvider.api_key_configured || Boolean(source.api_key)
  };
}
