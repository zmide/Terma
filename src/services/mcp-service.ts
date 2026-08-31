import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { publicError } from "../public-error";

type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  timeout_ms: number;
};

type McpTool = {name: string; description?: string; inputSchema?: unknown; risk?: "read" | "write" | "external"; server_id: string; server_name: string};

const MCP_TIMEOUT_MS = 30000;
const MCP_MAX_FRAME = 2_000_000;
const MCP_MAX_HEADERS = 32;
const MCP_PROTECTED_HEADERS = new Set([
  "accept", "connection", "content-length", "content-type", "host", "mcp-protocol-version",
  "mcp-session-id", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "user-agent"
]);

function text(value: unknown, limit: number): string {
  return String(value ?? "").replace(/[\0\r\n]/g, " ").trim().slice(0, limit);
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw publicError("MCP_CONFIG_INVALID", "MCP 请求头必须是 JSON 对象", {}, 400);
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value).slice(0, MCP_MAX_HEADERS)) {
    const name = String(rawName || "").trim();
    const headerValue = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,120}$/.test(name)) throw publicError("MCP_CONFIG_INVALID", "MCP 请求头名称无效", {}, 400);
    if (MCP_PROTECTED_HEADERS.has(name.toLowerCase())) throw publicError("MCP_CONFIG_INVALID", `MCP 请求头 ${name} 由 Terma 管理，不能覆盖`, {}, 400);
    if (!headerValue || headerValue.length > 4096 || /[\0\r\n]/.test(headerValue)) throw publicError("MCP_CONFIG_INVALID", `MCP 请求头 ${name} 的值无效`, {}, 400);
    headers[name] = headerValue;
  }
  return headers;
}

function normalizeServer(value: any): McpServerConfig {
  const source = value && typeof value === "object" ? value : {};
  // `http` was the value used before the UI distinguished the two remote
  // transports. Preserve existing installations by treating it as the MCP
  // Streamable HTTP transport.
  const transport = source.transport === "sse"
    ? "sse"
    : ["http", "streamable-http"].includes(source.transport)
      ? "streamable-http"
      : "stdio";
  const id = text(source.id || randomUUID(), 80).replace(/[^a-zA-Z0-9_-]/g, "-") || randomUUID();
  const name = text(source.name || id, 120);
  const timeout = Number(source.timeout_ms || MCP_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw publicError("MCP_CONFIG_INVALID", "MCP 超时时间必须是 1-120 秒", {}, 400);
  if (transport === "stdio") {
    const command = text(source.command, 300);
    if (!command || /[;&|<>`$()]/.test(command)) throw publicError("MCP_CONFIG_INVALID", "MCP stdio 命令无效，不能包含 Shell 运算符", {}, 400);
    const args = Array.isArray(source.args) ? source.args.map((item: any) => text(item, 300)).filter(Boolean).slice(0, 32) : [];
    return {id, name, transport, command, args, enabled:source.enabled === true, timeout_ms:timeout};
  }
  const url = text(source.url, 2048);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw publicError("MCP_CONFIG_INVALID", "MCP HTTP 地址无效", {}, 400); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw publicError("MCP_CONFIG_INVALID", "MCP HTTP 地址只能使用 HTTP 或 HTTPS，且不能包含凭据", {}, 400);
  return {id, name, transport, url:parsed.href, headers:normalizeHeaders(source.headers), enabled:source.enabled === true, timeout_ms:timeout};
}

function mcpToolRisk(tool: any): "read" | "write" | "external" {
  const annotations = tool?.annotations && typeof tool.annotations === "object" ? tool.annotations : {};
  if (annotations.readOnlyHint === true || annotations.read_only === true) return "read";
  if (annotations.destructiveHint === true || annotations.destructive === true) return "write";
  const name = `${tool?.name || ""} ${tool?.description || ""}`;
  if (/(?:delete|remove|write|update|create|install|restart|stop|kill|send|publish|修改|删除|写入|安装|重启)/i.test(name)) return "write";
  return /(?:http|web|search|fetch|browser|网络|网页|搜索)/i.test(name) ? "external" : "read";
}

function validateMcpArguments(schema: any, value: unknown, path = "$"): {valid: boolean; errors: string[]} {
  const errors: string[] = [];
  const visit = (definition: any, current: any, location: string, depth: number) => {
    if (depth > 8) { errors.push(`${location}: schema nesting is too deep`); return; }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return;
    if (Array.isArray(definition.enum) && definition.enum.length && !definition.enum.some(item => JSON.stringify(item) === JSON.stringify(current))) errors.push(`${location}: value is not allowed`);
    const type = String(definition.type || "");
    if (type === "object" || definition.properties) {
      if (!current || typeof current !== "object" || Array.isArray(current)) { errors.push(`${location}: expected an object`); return; }
      const properties = definition.properties && typeof definition.properties === "object" && !Array.isArray(definition.properties) ? definition.properties : {};
      if (Object.keys(current).length > 64) errors.push(`${location}: too many properties`);
      for (const required of Array.isArray(definition.required) ? definition.required.slice(0, 64) : []) if (typeof required === "string" && !Object.prototype.hasOwnProperty.call(current, required)) errors.push(`${location}.${required}: required`);
      for (const [key, child] of Object.entries(current)) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") { errors.push(`${location}.${key}: invalid property`); continue; }
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          if (definition.additionalProperties === false) errors.push(`${location}.${key}: unknown property`);
          continue;
        }
        visit(properties[key], child, `${location}.${key}`, depth + 1);
      }
      return;
    }
    if (type === "array") {
      if (!Array.isArray(current)) { errors.push(`${location}: expected an array`); return; }
      if (current.length > 256) errors.push(`${location}: array is too long`);
      current.slice(0, 256).forEach((item, index) => visit(definition.items, item, `${location}[${index}]`, depth + 1));
      return;
    }
    if (type === "string" && typeof current !== "string") errors.push(`${location}: expected a string`);
    if (type === "number" && (typeof current !== "number" || !Number.isFinite(current))) errors.push(`${location}: expected a number`);
    if (type === "integer" && (!Number.isInteger(current))) errors.push(`${location}: expected an integer`);
    if (type === "boolean" && typeof current !== "boolean") errors.push(`${location}: expected a boolean`);
    if (typeof current === "string" && Number.isFinite(Number(definition.maxLength)) && current.length > Number(definition.maxLength)) errors.push(`${location}: string is too long`);
  };
  visit(schema, value, path, 0);
  return {valid:errors.length === 0, errors:errors.slice(0, 8)};
}

function jsonRpcRequest(id: number, method: string, params: unknown = {}) {
  return JSON.stringify({jsonrpc:"2.0", id, method, params});
}

function frameMessage(payload: string): string {
  return `${payload}\n`;
}

function executableCommand(command: string): string {
  if (process.platform !== "win32") return command;
  return /^(?:npm|npx|pnpm|yarn)$/i.test(command) ? `${command}.cmd` : command;
}

function parseFrames(buffer: string): {messages: any[]; rest: string} {
  const messages: any[] = [];
  let rest = buffer;
  while (rest.length) {
    if (!/^content-length\s*:/i.test(rest)) {
      const lineEnd = rest.indexOf("\n");
      if (lineEnd < 0) break;
      const line = rest.slice(0, lineEnd).replace(/^\uFEFF/, "").trim();
      rest = rest.slice(lineEnd + 1);
      if (!line) continue;
      try { messages.push(JSON.parse(line)); } catch {}
      continue;
    }
    const headerEnd = rest.indexOf("\r\n\r\n");
    const newlineHeaderEnd = rest.indexOf("\n\n");
    const end = headerEnd >= 0 && (newlineHeaderEnd < 0 || headerEnd < newlineHeaderEnd) ? headerEnd : newlineHeaderEnd;
    if (end < 0) break;
    const header = rest.slice(0, end);
    const match = header.match(/content-length\s*:\s*(\d+)/i);
    if (!match) {
      const lineEnd = rest.indexOf("\n");
      if (lineEnd < 0) break;
      rest = rest.slice(lineEnd + 1);
      continue;
    }
    const bodyStart = end + (headerEnd === end ? 4 : 2);
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length < 0 || length > MCP_MAX_FRAME || Buffer.byteLength(rest.slice(bodyStart), "utf8") < length) break;
    const body = Buffer.from(rest.slice(bodyStart), "utf8").subarray(0, length).toString("utf8");
    rest = Buffer.from(rest.slice(bodyStart), "utf8").subarray(length).toString("utf8");
    try { messages.push(JSON.parse(body)); } catch {}
  }
  return {messages, rest};
}

async function stdioRequest(server: McpServerConfig, requests: Array<{method: string; params?: unknown}>): Promise<any[]> {
  const child = spawn(executableCommand(server.command!), server.args || [], {shell:false, windowsHide:true, stdio:["pipe", "pipe", "pipe"]});
  let timeout: NodeJS.Timeout;
  let buffer = "";
  let nextId = 1;
  const pending = new Map<number, (value: any) => void>();
  const rejectors = new Map<number, (error: Error) => void>();
  const results: any[] = [];
  const waitFor = (id: number) => new Promise<any>((resolve, reject) => { pending.set(id, resolve); rejectors.set(id, reject); });
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    const parsed = parseFrames(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      if (Number.isFinite(Number(message?.id)) && pending.has(Number(message.id))) {
        pending.get(Number(message.id))?.(message);
        pending.delete(Number(message.id));
        rejectors.delete(Number(message.id));
      }
    }
  });
  const failure = new Promise<never>((_, reject) => {
    child.once("error", error => reject(error instanceof Error ? error : new Error(String(error))));
    child.once("exit", code => reject(new Error(code === null ? "MCP 进程已终止" : `MCP 进程已退出（${code}）`)));
  });
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill();
      reject(new Error("MCP 请求超时"));
    }, server.timeout_ms);
  });
  try {
    for (const request of requests) {
      const id = nextId++;
      child.stdin.write(frameMessage(jsonRpcRequest(id, request.method, request.params || {})));
      const response = await Promise.race([waitFor(id), failure, timedOut]);
      if (response?.error) throw new Error(text(response.error.message || "MCP 请求失败", 500));
      results.push(response?.result || {});
      if (request.method === "initialize") child.stdin.write(frameMessage(JSON.stringify({jsonrpc:"2.0", method:"notifications/initialized", params:{}})));
    }
    return results;
  } finally {
    clearTimeout(timeout!);
    child.kill();
    for (const reject of rejectors.values()) reject(new Error("MCP 进程已关闭"));
  }
}

function protocolHeaders(server: McpServerConfig, fixed: Record<string, string>): Record<string, string> {
  return {...(server.headers || {}), ...fixed};
}

function ssePayloads(raw: string): Array<{event: string; data: string}> {
  return raw.split(/\r?\n\r?\n/).flatMap(frame => {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{event, data:data.join("\n")}] : [];
  });
}

async function streamableHttpRequest(server: McpServerConfig, requests: Array<{method: string; params?: unknown}>): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), server.timeout_ms);
  let id = 1;
  let sessionId = "";
  const results: any[] = [];
  const send = async (payload: string, expectResult=true) => {
    const headers = protocolHeaders(server, {"Content-Type":"application/json", Accept:"application/json, text/event-stream", "MCP-Protocol-Version":"2025-06-18", "User-Agent":"Terma"});
    if (sessionId) headers["MCP-Session-Id"] = sessionId;
    const response = await fetch(server.url!, {method:"POST", redirect:"manual", headers, body:payload, signal:controller.signal});
    if (response.status >= 300 && response.status < 400) throw new Error("MCP HTTP 重定向已阻止");
    if (!response.ok && !(response.status === 202 && !expectResult)) throw new Error(`MCP HTTP 请求失败（${response.status}）`);
    sessionId = response.headers.get("mcp-session-id") || sessionId;
    if (!expectResult || response.status === 202) return {};
    const raw = await response.text();
    const contentType = response.headers.get("content-type") || "";
    let payloadValue: any = null;
    if (contentType.includes("text/event-stream")) {
      const events = ssePayloads(raw).flatMap(event => {
        if (!event.data || event.data === "[DONE]") return [];
        try { return [JSON.parse(event.data)]; } catch { return []; }
      });
      payloadValue = events.find(item => Number(item?.id) > 0) || events.at(-1) || null;
    } else {
      try { payloadValue = JSON.parse(raw); } catch {}
    }
    if (!payloadValue) throw new Error("MCP HTTP 返回了无法解析的响应");
    if (payloadValue?.error) throw new Error(text(payloadValue.error.message || "MCP 请求失败", 500));
    return payloadValue?.result || {};
  };
  try {
    for (const request of requests) {
      results.push(await send(jsonRpcRequest(id++, request.method, request.params || {})));
      if (request.method === "initialize") await send(JSON.stringify({jsonrpc:"2.0", method:"notifications/initialized", params:{}}), false);
    }
    return results;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("MCP 请求超时");
    throw error;
  } finally { clearTimeout(timer); }
}

async function legacySseRequest(server: McpServerConfig, requests: Array<{method: string; params?: unknown}>): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), server.timeout_ms);
  const pending = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void}>();
  let endpointResolve!: (value: URL) => void;
  let endpointReject!: (error: Error) => void;
  const endpointPromise = new Promise<URL>((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
  let endpointSettled = false;
  const fail = (error: Error) => {
    if (!endpointSettled) { endpointSettled = true; endpointReject(error); }
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  let readerTask: Promise<void> | null = null;
  try {
    const response = await fetch(server.url!, {
      method:"GET",
      redirect:"manual",
      headers:protocolHeaders(server, {Accept:"text/event-stream", "User-Agent":"Terma"}),
      signal:controller.signal
    });
    if (response.status >= 300 && response.status < 400) throw new Error("MCP SSE 重定向已阻止");
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/event-stream") || !response.body) throw new Error(`MCP SSE 连接失败（${response.status}）`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    readerTask = (async () => {
      let buffer = "";
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), {stream:!chunk.done});
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const event of ssePayloads(frames.join("\n\n"))) {
          if (event.event === "endpoint") {
            const endpoint = new URL(event.data, server.url!);
            if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.origin !== new URL(server.url!).origin || endpoint.username || endpoint.password || endpoint.hash) {
              throw new Error("MCP SSE 消息地址必须与服务器同源");
            }
            if (!endpointSettled) { endpointSettled = true; endpointResolve(endpoint); }
            continue;
          }
          if (!event.data || event.data === "[DONE]") continue;
          let message: any = null;
          try { message = JSON.parse(event.data); } catch { continue; }
          const id = Number(message?.id);
          const waiter = pending.get(id);
          if (Number.isFinite(id) && waiter) {
            pending.delete(id);
            if (message?.error) waiter.reject(new Error(text(message.error.message || "MCP 请求失败", 500)));
            else waiter.resolve(message?.result || {});
          }
        }
        if (chunk.done) break;
      }
      if (!controller.signal.aborted) throw new Error("MCP SSE 连接已关闭");
    })().catch(error => fail(error instanceof Error ? error : new Error(String(error))));
    const endpoint = await endpointPromise;
    const post = async (payload: string) => {
      const postResponse = await fetch(endpoint, {
        method:"POST",
        redirect:"manual",
        headers:protocolHeaders(server, {"Content-Type":"application/json", Accept:"application/json", "User-Agent":"Terma"}),
        body:payload,
        signal:controller.signal
      });
      if (postResponse.status >= 300 && postResponse.status < 400) throw new Error("MCP SSE 消息重定向已阻止");
      if (!postResponse.ok) throw new Error(`MCP SSE 消息发送失败（${postResponse.status}）`);
    };
    const results: any[] = [];
    let nextId = 1;
    for (const request of requests) {
      const id = nextId++;
      const result = new Promise<any>((resolve, reject) => pending.set(id, {resolve, reject}));
      await post(jsonRpcRequest(id, request.method, request.params || {}));
      results.push(await result);
      if (request.method === "initialize") await post(JSON.stringify({jsonrpc:"2.0", method:"notifications/initialized", params:{}}));
    }
    return results;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("MCP 请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    fail(new Error("MCP SSE 连接已关闭"));
    await readerTask?.catch(() => {});
  }
}

function requestForTransport(server: McpServerConfig) {
  if (server.transport === "stdio") return stdioRequest;
  return server.transport === "sse" ? legacySseRequest : streamableHttpRequest;
}

export function createMcpManager() {
  const calls: Array<{server_id: string; tool: string; at: number; ok: boolean; error?: string}> = [];
  async function discover(serverInput: any): Promise<{server: McpServerConfig; tools: McpTool[]}> {
    const server = normalizeServer(serverInput);
    if (!server.enabled) throw publicError("MCP_DISABLED", "MCP 服务器未启用", {}, 409);
    const request = requestForTransport(server);
    const results = await request(server, [
      {method:"initialize", params:{protocolVersion:"2025-06-18", capabilities:{}, clientInfo:{name:"Terma", version:"1.0"}}},
      {method:"tools/list", params:{}}
    ]);
    const rawTools = Array.isArray(results.at(-1)?.tools) ? results.at(-1).tools : [];
    const tools = rawTools.slice(0, 128).flatMap((tool: any) => {
      const name = text(tool?.name, 120);
      return name ? [{name, description:text(tool?.description, 500), inputSchema:tool?.inputSchema || {}, risk:mcpToolRisk(tool), server_id:server.id, server_name:server.name}] : [];
    });
    return {server, tools};
  }
  async function call(serverInput: any, toolName: string, argumentsValue: unknown = {}) {
    const server = normalizeServer(serverInput);
    if (!server.enabled) throw publicError("MCP_DISABLED", "MCP 服务器未启用", {}, 409);
    const tool = text(toolName, 120);
    if (!tool || !/^[a-zA-Z0-9_.:-]+$/.test(tool)) throw publicError("MCP_TOOL_INVALID", "MCP 工具名称无效", {}, 400);
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) throw publicError("MCP_ARGUMENTS_INVALID", "MCP 工具参数必须是 JSON 对象", {}, 400);
    const request = requestForTransport(server);
    const runWithReconnect = async () => {
      let lastError: any;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return await request(server, [{method:"initialize", params:{protocolVersion:"2025-06-18", capabilities:{}, clientInfo:{name:"Terma", version:"1.0"}}}, {method:"tools/call", params:{name:tool, arguments:argumentsValue}}]); }
        catch (error) { lastError = error; if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 80)); }
      }
      throw lastError;
    };
    try {
      const result = await runWithReconnect();
      calls.unshift({server_id:server.id, tool, at:Date.now(), ok:true});
      return result.at(-1) || {};
    } catch (error: any) {
      calls.unshift({server_id:server.id, tool, at:Date.now(), ok:false, error:text(error?.message || error, 300)});
      throw error;
    } finally { calls.splice(100); }
  }
  return {discover, call, calls:() => calls.slice()};
}

export { normalizeServer, mcpToolRisk, validateMcpArguments };
