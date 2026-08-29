import { IncomingMessage, ServerResponse } from "node:http";
import { publicError } from "../public-error";
import { publicAiSettings, redactAiText, requestAiChat, requestAiChatStream, requestAiModels } from "../services/ai-service";
import { createMcpManager, normalizeServer } from "../services/mcp-service";

interface AiRouteDependencies {
  readJson(request: IncomingMessage): Promise<any>;
  readRuntimeSettings(file: string): any;
  writeRuntimeSettings(file: string, value: any): any;
  normalizeRuntimeSettings(value: any): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  isDirectLoopbackRequest(request: IncomingMessage): boolean;
  runtimeSettingsFile: string;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

function errorMessage(error: any): string {
  return error instanceof Error ? error.message : String(error || "AI 请求失败");
}

function writeStreamEvent(response: ServerResponse, event: string, payload: unknown) {
  if (response.writableEnded) return;
  response.write(`event:${event}\ndata:${JSON.stringify(payload)}\n\n`);
}

function requireLocalMcpRequest(request: IncomingMessage, dependencies: AiRouteDependencies) {
  if (dependencies.isDesktopRequest(request) || dependencies.isDirectLoopbackRequest(request)) return;
  throw publicError("MCP_LOCAL_REQUIRED", "MCP 服务器只能由本机桌面端或服务端本机访问", {}, 403);
}

function mergeMcpHeaderPlaceholders(currentServers: any[], requestedServers: any[]): any[] {
  const existing = Array.isArray(currentServers) ? currentServers : [];
  return (Array.isArray(requestedServers) ? requestedServers : []).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    if (String(item.transport || "stdio") === "stdio") return {...item, headers:{}};
    const previous = existing.find(server => String(server?.id || "") === String(item.id || ""));
    const previousHeaders = previous?.headers && typeof previous.headers === "object" && !Array.isArray(previous.headers) ? previous.headers : {};
    if (!Object.prototype.hasOwnProperty.call(item, "headers")) return {...item, headers:{...previousHeaders}};
    const requestedHeaders = item.headers && typeof item.headers === "object" && !Array.isArray(item.headers) ? item.headers : item.headers;
    if (!requestedHeaders || typeof requestedHeaders !== "object" || Array.isArray(requestedHeaders)) return {...item, headers:requestedHeaders};
    const merged: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(requestedHeaders)) {
      if (typeof value === "string" && !value.trim()) {
        const previousName = Object.keys(previousHeaders).find(header => header.toLowerCase() === String(name).toLowerCase());
        merged[name] = previousName ? previousHeaders[previousName] : value;
      } else merged[name] = value;
    }
    return {...item, headers:merged};
  });
}

function requestAiSettings(current: any, data: any, normalizeRuntimeSettings: (value: any) => any) {
  const currentAi = current?.ai && typeof current.ai === "object" ? current.ai : {};
  const override = data?.ai && typeof data.ai === "object" && !Array.isArray(data.ai) ? data.ai : null;
  if (!override) return currentAi;
  const preparedOverride = Object.prototype.hasOwnProperty.call(override, "mcp_servers")
    ? {...override, mcp_servers:mergeMcpHeaderPlaceholders(currentAi.mcp_servers, override.mcp_servers)}
    : override;
  const merged = normalizeRuntimeSettings({ ...current, ai: { ...currentAi, ...preparedOverride } }).ai;
  // A temporary endpoint must never inherit the saved credential implicitly.
  // Settings tests can still send an explicitly entered key in the override.
  const endpointOverridden = Object.prototype.hasOwnProperty.call(preparedOverride, "endpoint")
    && String(preparedOverride.endpoint || "").trim().replace(/\/+$/, "") !== String(currentAi.endpoint || "").trim().replace(/\/+$/, "");
  const explicitKey = Object.prototype.hasOwnProperty.call(preparedOverride, "api_key")
    ? String(preparedOverride.api_key || "").trim()
    : "";
  if (endpointOverridden && !explicitKey) merged.api_key = "";
  return merged;
}

const mcpManager = createMcpManager();
function saveAiSettings(dependencies: AiRouteDependencies, current: any, ai: any) {
  const next = dependencies.normalizeRuntimeSettings({...current, ai});
  dependencies.writeRuntimeSettings(dependencies.runtimeSettingsFile, next);
  return next.ai;
}

export async function handleAiRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: AiRouteDependencies
): Promise<boolean> {
  if (request.method === "GET" && pathname === "/api/ai/settings") {
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    dependencies.sendJson(response, publicAiSettings(settings.ai));
    return true;
  }
  if (request.method === "PUT" && pathname === "/api/ai/settings") {
    const data = await dependencies.readJson(request);
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const currentAi = current.ai || {};
    const source = data?.ai && typeof data.ai === "object" ? data.ai : (data || {});
    const preparedSource = Object.prototype.hasOwnProperty.call(source, "mcp_servers")
      ? {...source, mcp_servers:mergeMcpHeaderPlaceholders(currentAi.mcp_servers, source.mcp_servers)}
      : source;
    if (Object.prototype.hasOwnProperty.call(preparedSource, "mcp_servers")
      && !dependencies.isDesktopRequest(request)
      && !dependencies.isDirectLoopbackRequest(request)) {
      const currentMcp = dependencies.normalizeRuntimeSettings(current).ai?.mcp_servers || [];
      const requestedMcp = dependencies.normalizeRuntimeSettings({...current, ai:{...currentAi, mcp_servers:preparedSource.mcp_servers}}).ai?.mcp_servers || [];
      if (JSON.stringify(requestedMcp) !== JSON.stringify(currentMcp)) {
        throw publicError("MCP_LOCAL_REQUIRED", "MCP 服务器只能由本机桌面端或服务端本机修改", {}, 403);
      }
    }
    const hasKey = Object.prototype.hasOwnProperty.call(preparedSource, "api_key");
    const clearKey = data?.clear_api_key === true || preparedSource.clear_api_key === true;
    let apiKey = String(currentAi.api_key || "");
    if (clearKey) apiKey = "";
    if (hasKey && String(preparedSource.api_key || "").trim()) apiKey = String(preparedSource.api_key).trim();
    const nextAi = dependencies.normalizeRuntimeSettings({
      ...current,
      ai:{
        ...currentAi,
        ...preparedSource,
        api_key:apiKey
      }
    }).ai;
    dependencies.writeRuntimeSettings(dependencies.runtimeSettingsFile, dependencies.normalizeRuntimeSettings({...current, ai:nextAi}));
    dependencies.sendJson(response, publicAiSettings(nextAi));
    return true;
  }
  if (request.method === "GET" && pathname === "/api/ai/skills") {
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    dependencies.sendJson(response, {skills:publicAiSettings(settings.ai).user_skills || []});
    return true;
  }
  if ((request.method === "POST" && pathname === "/api/ai/skills") || (request.method === "PUT" && pathname.startsWith("/api/ai/skills/"))) {
    const data = await dependencies.readJson(request);
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const skill = data?.skill && typeof data.skill === "object" ? data.skill : data;
    const pathId = request.method === "PUT" ? decodeURIComponent(pathname.slice("/api/ai/skills/".length)) : "";
    const id = String(pathId || skill?.id || skill?.name || "skill").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || `skill-${Date.now()}`;
    const existing = Array.isArray(current.ai?.user_skills) ? current.ai.user_skills : [];
    const nextSkills = [...existing.filter((item: any) => String(item?.id) !== id), {...skill, id, enabled:skill?.enabled !== false, updated_at:Date.now()}];
    const ai = saveAiSettings(dependencies, current, {...current.ai, user_skills:nextSkills});
    dependencies.sendJson(response, {skill:publicAiSettings(ai).user_skills.find((item: any) => item.id === id)});
    return true;
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/ai/skills/")) {
    const id = decodeURIComponent(pathname.slice("/api/ai/skills/".length));
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const nextSkills = (Array.isArray(current.ai?.user_skills) ? current.ai.user_skills : []).filter((item: any) => String(item?.id) !== id);
    const ai = saveAiSettings(dependencies, current, {...current.ai, user_skills:nextSkills});
    dependencies.sendJson(response, {skills:publicAiSettings(ai).user_skills});
    return true;
  }
  if (request.method === "GET" && pathname === "/api/ai/mcp/servers") {
    requireLocalMcpRequest(request, dependencies);
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    dependencies.sendJson(response, {servers:publicAiSettings(settings.ai).mcp_servers || [], calls:mcpManager.calls()});
    return true;
  }
  if ((request.method === "POST" && pathname === "/api/ai/mcp/servers") || (request.method === "PUT" && pathname.startsWith("/api/ai/mcp/servers/"))) {
    requireLocalMcpRequest(request, dependencies);
    const data = await dependencies.readJson(request);
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const pathId = request.method === "PUT" ? decodeURIComponent(pathname.slice("/api/ai/mcp/servers/".length)) : "";
    const existing = Array.isArray(current.ai?.mcp_servers) ? current.ai.mcp_servers : [];
    const supplied = data?.server && typeof data.server === "object" ? data.server : data;
    const mergedInput = mergeMcpHeaderPlaceholders(existing, [{...supplied, ...(pathId ? {id:pathId} : {})}])[0];
    const server = normalizeServer(mergedInput);
    const previous = existing.find((item: any) => String(item?.id) === server.id);
    const mergedServer = {
      ...server,
      tools:Array.isArray(supplied?.tools) ? supplied.tools : (previous?.tools || []),
      tools_updated_at:Number(supplied?.tools_updated_at || previous?.tools_updated_at || 0)
    };
    const nextServers = previous
      ? existing.map((item: any) => String(item?.id) === server.id ? mergedServer : item)
      : [...existing, mergedServer];
    const ai = saveAiSettings(dependencies, current, {...current.ai, mcp_servers:nextServers});
    dependencies.sendJson(response, {server:publicAiSettings(ai).mcp_servers.find((item: any) => item.id === server.id)});
    return true;
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/ai/mcp/servers/")) {
    requireLocalMcpRequest(request, dependencies);
    const id = decodeURIComponent(pathname.slice("/api/ai/mcp/servers/".length));
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const ai = saveAiSettings(dependencies, current, {...current.ai, mcp_servers:(Array.isArray(current.ai?.mcp_servers) ? current.ai.mcp_servers : []).filter((item: any) => String(item?.id) !== id)});
    dependencies.sendJson(response, {servers:publicAiSettings(ai).mcp_servers});
    return true;
  }
  if (request.method === "POST" && pathname.startsWith("/api/ai/mcp/servers/") && pathname.endsWith("/discover")) {
    requireLocalMcpRequest(request, dependencies);
    const id = decodeURIComponent(pathname.slice("/api/ai/mcp/servers/".length, -"/discover".length));
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const server = (Array.isArray(settings.ai?.mcp_servers) ? settings.ai.mcp_servers : []).find((item: any) => String(item?.id) === id);
    if (!server) throw publicError("MCP_NOT_FOUND", "MCP 服务器不存在", {}, 404);
    // Discovery is an explicit local setup action and may inspect a server
    // before the user enables it for Agent calls. Keep the saved enabled flag
    // unchanged; only the discovery probe is temporarily allowed to connect.
    const discovered = await mcpManager.discover({...server, enabled:true});
    const currentServers = Array.isArray(settings.ai?.mcp_servers) ? settings.ai.mcp_servers : [];
    const nextServers = currentServers.map((item: any) => String(item?.id) === id
      ? {...item, tools:discovered.tools.map((tool: any) => ({
        name:tool.name,
        description:tool.description || "",
        inputSchema:tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) ? tool.inputSchema : {},
        enabled:tool?.enabled !== false,
        requires_approval:tool?.requires_approval !== false
      })), tools_updated_at:Date.now()}
      : item);
    const ai = saveAiSettings(dependencies, settings, {...settings.ai, mcp_servers:nextServers});
    const savedServer = publicAiSettings(ai).mcp_servers.find((item: any) => String(item.id) === id);
    dependencies.sendJson(response, {server:savedServer, tools:savedServer?.tools || discovered.tools});
    return true;
  }
  if (request.method === "POST" && pathname === "/api/ai/mcp/call") {
    requireLocalMcpRequest(request, dependencies);
    const data = await dependencies.readJson(request);
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const server = (Array.isArray(settings.ai?.mcp_servers) ? settings.ai.mcp_servers : []).find((item: any) => String(item?.id) === String(data?.server_id || ""));
    if (!server) throw publicError("MCP_NOT_FOUND", "MCP 服务器不存在", {}, 404);
    const configuredTool = Array.isArray(server.tools) ? server.tools.find((tool: any) => String(tool?.name) === String(data?.tool || "")) : null;
    if (configuredTool?.enabled === false) throw publicError("MCP_TOOL_DISABLED", "MCP 工具已禁用", {}, 409);
    dependencies.sendJson(response, await mcpManager.call(server, data?.tool, data?.arguments));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/ai/models") {
    const data = await dependencies.readJson(request);
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const settings = requestAiSettings(current, data, dependencies.normalizeRuntimeSettings);
    try {
      dependencies.sendJson(response, {models:await requestAiModels({settings, apiKey:String(settings.api_key || "")})});
    } catch (error) {
      if ((error as any)?.publicCode) throw error;
      throw publicError("AI_REQUEST_FAILED", "AI 请求失败", {detail:redactAiText(errorMessage(error), 300)}, 502);
    }
    return true;
  }
  if (request.method === "POST" && pathname === "/api/ai/chat") {
    const data = await dependencies.readJson(request);
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const settings = requestAiSettings(current, data, dependencies.normalizeRuntimeSettings);
    const apiKey = String(settings.api_key || "");
    if (data?.stream !== false) {
      response.writeHead(200, {"Content-Type":"text/event-stream; charset=utf-8", "Cache-Control":"no-cache, no-transform", Connection:"keep-alive", "X-Accel-Buffering":"no"});
      const abortController = new AbortController();
      request.once("aborted", () => abortController.abort());
      try {
        const result = await requestAiChatStream({settings, apiKey, message:data?.message, contexts:data?.contexts, history:data?.history, locale:data?.locale, permission:data?.permission, signal:abortController.signal}, (delta, kind) => writeStreamEvent(response, kind === "reasoning" ? "reasoning" : "delta", {delta}));
        writeStreamEvent(response, "done", {model:result.model, usage:result.usage});
      } catch (error) {
        if (!abortController.signal.aborted) writeStreamEvent(response, "error", {error:errorMessage(error), error_code:String((error as any)?.publicCode || "AI_REQUEST_FAILED")});
      } finally {
        if (!response.writableEnded) response.end();
      }
      return true;
    }
    try {
      dependencies.sendJson(response, await requestAiChat({
        settings,
        apiKey,
        message:data?.message,
        contexts:data?.contexts,
        history:data?.history,
        locale:data?.locale,
        permission:data?.permission
      }));
    } catch (error) {
      if ((error as any)?.publicCode) throw error;
      throw publicError("AI_REQUEST_FAILED", "AI 请求失败", {detail:redactAiText(errorMessage(error), 300)}, 502);
    }
    return true;
  }
  return false;
}
