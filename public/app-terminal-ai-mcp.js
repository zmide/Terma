/**
 * MCP discovery and explicit web-research routing for the terminal AI panel.
 * Loaded after rendering helpers and before the main terminal AI controller.
 */
let terminalAiMcpCatalogCache = {expiresAt:0, contexts:[], tools:[]};

async function terminalAiMcpContexts() {
  if (terminalAiMcpCatalogCache.expiresAt > Date.now()) return terminalAiMcpCatalogCache.contexts;
  const result = await api("/api/ai/mcp/servers");
  const servers = (Array.isArray(result?.servers) ? result.servers : []).filter(server => server?.enabled === true).slice(0, 8);
  const catalog = [];
  const discovered = await Promise.all(servers.map(async server => {
    try {
      let tools = Array.isArray(server.tools) ? server.tools.slice(0, 64) : [];
      if (!tools.length) {
        const response = await api(`/api/ai/mcp/servers/${encodeURIComponent(server.id)}/discover`, {method:"POST", body:"{}"});
        tools = Array.isArray(response?.tools) ? response.tools.slice(0, 64) : [];
      }
      tools = tools.filter((tool, index, list) => tool?.enabled !== false && tool?.name
        && list.findIndex(item => String(item?.name) === String(tool.name)) === index);
      if (!tools.length) return null;
      tools.forEach(tool => catalog.push({server_id:String(server.id), server_name:String(server.name || server.id), ...tool}));
      const lines = tools.map(tool => `- ${tool.name}: ${tool.description || ""}\n  inputSchema: ${JSON.stringify(tool.inputSchema || {})}`);
      return {source:"mcp-tools", title:`MCP ${server.name} (${server.id})`, text:`Server ID: ${server.id}\nAvailable tools:\n${lines.join("\n")}`.slice(0, 16000)};
    } catch { return null; }
  }));
  terminalAiMcpCatalogCache = {expiresAt:Date.now() + 60000, contexts:discovered.filter(Boolean), tools:catalog};
  return terminalAiMcpCatalogCache.contexts;
}

function terminalAiExplicitSearchIntent(prompt) {
  const source = String(prompt || "").trim();
  if (!source) return false;
  return /(?:网页|在线|联网|互联网|网上|网络上|搜索网页|在线搜索|联网搜索|查一下|查找|检索|搜索|web\s+search|search\s+online|look\s*up|browse|research)/i.test(source);
}

function terminalAiSearchTopic(prompt) {
  const source = String(prompt || "").trim();
  let query = source
    .replace(/^(?:请|帮我|麻烦|你)?\s*/i, "")
    .replace(/^(?:在\s*)?(?:github|git\s*hub)(?:上|中)?\s*(?:搜索一下|搜索|查找|查询|检索|搜一下|查一下)?[:：]?/i, "")
    .replace(/^(?:在网上|在线|联网|网页上|网络上)?\s*(?:搜索一下|搜索|查找|查询|检索|查一下)[:：]?/i, "")
    .trim();
  query = query.replace(/(?:帮我)?看看(?:它)?(?:是)?什么(?:东西)?[？?。！!]*$/i, "").trim() || query;
  return query || source;
}

function terminalAiCurrentProjectLookup(prompt) {
  return /^terma$/i.test(terminalAiSearchTopic(prompt));
}

function terminalAiSearchQuery(prompt) {
  const query = terminalAiSearchTopic(prompt);
  // In Terma itself, a bare product-name lookup should favor this project
  // over unrelated organizations that happen to share the same word.
  if (terminalAiCurrentProjectLookup(prompt)) return '"zmide/Terma" GitHub remote connection workspace SSH terminal SFTP';
  return query;
}

function terminalAiProjectIdentityContext(prompt) {
  if (!terminalAiCurrentProjectLookup(prompt)) return null;
  return {
    source:"application-identity",
    title:"Terma project identity",
    text:"The current application is the GitHub project zmide/Terma: a remote connection workspace for desktop and self-hosted Web environments with SSH, terminal, SFTP, remote desktop, port forwarding, and batch commands. Official source: https://github.com/zmide/Terma. Use this trusted identity to disambiguate web content from unrelated organizations also named Terma."
  };
}

function terminalAiSearchCallForPrompt(prompt) {
  if (!terminalAiExplicitSearchIntent(prompt)) return null;
  const query = terminalAiSearchQuery(prompt);
  const tools = Array.isArray(terminalAiMcpCatalogCache.tools) ? terminalAiMcpCatalogCache.tools : [];
  if (terminalAiCurrentProjectLookup(prompt)) {
    // Search first for a bare “Terma” lookup. Extraction-only tools can
    // return unrelated pages with the same name; the explicit repository
    // query plus the trusted project identity context gives the model a
    // stable official result before any optional page extraction.
    const sourceTool = tools.find(tool => {
      const haystack = `${tool?.name || ""} ${tool?.description || ""}`;
      const schema = tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {};
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      return /(?:search|query|lookup|browse|web)/i.test(haystack)
        && !/(?:extract|fetch)/i.test(haystack)
        && (Object.prototype.hasOwnProperty.call(properties, "query")
          || Object.prototype.hasOwnProperty.call(properties, "q")
          || Object.prototype.hasOwnProperty.call(properties, "search_query"));
    }) || tools.find(tool => {
      const schema = tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {};
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      return /(?:extract|fetch)/i.test(`${tool?.name || ""} ${tool?.description || ""}`)
        && (Object.prototype.hasOwnProperty.call(properties, "urls") || Object.prototype.hasOwnProperty.call(properties, "url"));
    });
    if (sourceTool) {
      const properties = sourceTool.inputSchema?.properties || {};
      const args = {};
      const sourceUrl = "https://github.com/zmide/Terma";
      const extractsUrl = Object.prototype.hasOwnProperty.call(properties, "urls") || Object.prototype.hasOwnProperty.call(properties, "url");
      if (Object.prototype.hasOwnProperty.call(properties, "urls")) args.urls = [sourceUrl];
      else if (Object.prototype.hasOwnProperty.call(properties, "url")) args.url = sourceUrl;
      else {
        const queryKeys = ["query", "q", "search_query"].filter(key => Object.prototype.hasOwnProperty.call(properties, key));
        if (queryKeys.length) args[queryKeys[0]] = query;
      }
      // Extraction tools may also accept a focus question. Search tools must
      // retain the disambiguating repository query instead of having it
      // overwritten by that extraction hint.
      if (extractsUrl && Object.prototype.hasOwnProperty.call(properties, "query")) args.query = "remote connection workspace SSH terminal SFTP";
      return {server:String(sourceTool.server_id), tool:String(sourceTool.name), arguments:args, requiresApproval:sourceTool.requires_approval !== false};
    }
  }
  const candidates = tools.map(tool => {
    const haystack = `${tool.name || ""} ${tool.description || ""}`.toLowerCase();
    let score = 0;
    if (/(?:tavily|brave|bing|google|serp|web[_ -]?search|search[_ -]?web)/i.test(haystack)) score += 5;
    if (/(?:search|query|lookup|browse|web)/i.test(haystack)) score += 3;
    if (tool?.requires_approval === false) score += 1;
    return {tool, score};
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
  const selected = candidates[0]?.tool;
  if (!selected) return null;
  const schema = selected.inputSchema && typeof selected.inputSchema === "object" ? selected.inputSchema : {};
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const args = {};
  const queryKeys = ["query", "q", "search_query", "keyword", "keywords", "text", "input"].filter(key => Object.prototype.hasOwnProperty.call(properties, key));
  if (queryKeys.length) args[queryKeys[0]] = query;
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (Object.prototype.hasOwnProperty.call(args, key)) continue;
    const definition = properties[key] && typeof properties[key] === "object" ? properties[key] : {};
    if (definition.default !== undefined) args[key] = definition.default;
    else if (Array.isArray(definition.enum) && definition.enum.length) args[key] = definition.enum[0];
    else if (definition.type === "string") args[key] = query;
  }
  if (!Object.keys(args).length) args.query = query;
  return {key:`${selected.server_id}\u0000${selected.name}\u0000${JSON.stringify(args)}`, server:selected.server_id, tool:selected.name, arguments:args};
}
