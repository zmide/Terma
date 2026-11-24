import {translate as tr} from '../../shared/i18n/runtime';
import type {McpTool} from './mcp-service';
import {terminalAiDecodeXmlText,terminalAiNormalizeMarkdownEscapes} from './response-text';
import {terminalAiToolCallParameters,terminalAiParseToolCall,terminalAiResponseCommands} from './response-commands';
type CatalogTool=McpTool & {enabled?:boolean};
export interface ResponseMcpCall {key:string;server:string;tool:string;arguments:Record<string,unknown>;index:number}
export interface ResponseMcpMarker {key:string;server:string;tool:string;index:number}
export function createResponseTools(catalogTools:()=>readonly CatalogTool[]) {
function terminalAiResponseMcpCalls(value:unknown) {
  const calls:ResponseMcpCall[] = [];
  const pattern = /<mcp_call\b([^>]*)>([\s\S]*?)<\/mcp_call>/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const attributes = match[1] || "";
    const server = terminalAiDecodeXmlText(attributes.match(/\bserver\s*=\s*["']([^"']+)["']/i)?.[1] || "").trim();
    const tool = terminalAiDecodeXmlText(attributes.match(/\btool\s*=\s*["']([^"']+)["']/i)?.[1] || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(server) || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(tool)) continue;
    let argumentsValue:Record<string,unknown> = {};
    try { argumentsValue = JSON.parse(terminalAiDecodeXmlText(match[2]).trim() || "{}"); } catch { continue; }
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) continue;
    const key = `${server}\u0000${tool}\u0000${JSON.stringify(argumentsValue)}`;
    if (!calls.some(item => item.key === key)) calls.push({key, server, tool, arguments:argumentsValue, index:match.index});
  }
  // A number of OpenAI-compatible models emit their native XML or JSON
  // function wrapper even when the prompt asks for Terma's explicit
  // <mcp_call> block. Accept it only when the function name uniquely matches
  // a discovered, enabled MCP tool; arbitrary provider functions stay inert.
  const catalog = catalogTools();
  const addCatalogCall = (selected:CatalogTool|null, argumentsValue:Record<string,unknown>, index:number) => {
    if (!selected || !argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return;
    const key = `${selected.serverId}\u0000${selected.name}\u0000${JSON.stringify(argumentsValue)}`;
    if (!calls.some(item => item.key === key)) calls.push({key, server:String(selected.serverId), tool:String(selected.name), arguments:argumentsValue, index});
  };
  const wrapped = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  while ((match = wrapped.exec(String(value || "")))) {
    const body = terminalAiDecodeXmlText(match[1] || "").trim();
    let jsonCall:Record<string,unknown>|null = null;
    try { jsonCall = JSON.parse(body); } catch { /* XML tool wrappers are parsed below. */ }
    if (jsonCall && typeof jsonCall === "object" && !Array.isArray(jsonCall)) {
      const callName = String(jsonCall.name || jsonCall.function || "");
      let parsedArguments:unknown = jsonCall.arguments;
      if (typeof parsedArguments === "string") {
        try { parsedArguments = JSON.parse(parsedArguments); } catch { continue; }
      }
      if (parsedArguments != null && (typeof parsedArguments !== "object" || Array.isArray(parsedArguments))) continue;
      let jsonArguments:Record<string,unknown> = parsedArguments ? {...parsedArguments as Record<string,unknown>} : {};
      let selected:CatalogTool|null = null;
      if (callName.toLowerCase() === "mcp_call") {
        const serverRef = String(jsonArguments.server || "");
        const toolRef = String(jsonArguments.tool || "");
        selected = catalog.find(tool => `${tool.serverId}.${tool.name}`.toLowerCase() === serverRef.toLowerCase())
          || catalog.find(tool => String(tool.serverId).toLowerCase() === serverRef.toLowerCase() && String(tool.name).toLowerCase() === toolRef.toLowerCase()) || null;
        delete jsonArguments.server;
        delete jsonArguments.tool;
        if (jsonArguments.arguments && typeof jsonArguments.arguments === "object" && !Array.isArray(jsonArguments.arguments)) jsonArguments = jsonArguments.arguments as Record<string,unknown>;
      } else {
        const matches = catalog.filter(tool => String(tool?.name || "").toLowerCase() === callName.toLowerCase());
        if (matches.length === 1) selected = matches[0];
      }
      if (selected) { addCatalogCall(selected, jsonArguments, match.index); continue; }
    }
    const functionMatch = body.match(/<function\s*=\s*([a-z0-9_.:-]+)\s*>/i)
      || body.match(/<function[^>]*>\s*([a-z0-9_.:-]+)\s*(?:<\/function>|>)/i);
    const functionName = String(functionMatch?.[1] || "");
    if (!functionName || ["terminal", "exec_command", "shell"].includes(functionName.toLowerCase())) continue;
    const matches = catalog.filter(tool => String(tool?.name || "").toLowerCase() === functionName.toLowerCase());
    if (matches.length !== 1) continue;
    const selected = matches[0];
    const schema = selected.inputSchema && typeof selected.inputSchema === "object" ? selected.inputSchema : {};
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties) ? schema.properties as Record<string,unknown> : {};
    const rawParameters = terminalAiToolCallParameters(body);
    const argumentsValue:Record<string,unknown> = {};
    for (const [name, raw] of Object.entries(rawParameters)) {
      const definition = properties[name] && typeof properties[name] === "object" ? properties[name] as Record<string,unknown> : {};
      if (["number", "integer", "boolean", "array", "object"].includes(String(definition.type))) {
        try { argumentsValue[name] = JSON.parse(raw); } catch { argumentsValue[name] = raw; }
      } else argumentsValue[name] = raw;
    }
    addCatalogCall(selected, argumentsValue, match.index);
  }
  return calls;
}

function terminalAiResponseMcpMarkers(value:unknown) {
  const catalog = catalogTools();
  if (!catalog.length) return [];
  const markers:ResponseMcpMarker[] = [];
  const pattern = /^[ \t]*(?:\*\*)?MCP\s*[·:]\s*([a-zA-Z0-9_-]{1,80})\s*\/\s*([a-zA-Z0-9_.:-]{1,120})(?:\*\*)?[ \t]*$/gmi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const server = String(match[1] || "");
    const tool = String(match[2] || "");
    const selected = catalog.find(item => item?.enabled !== false
      && String(item?.serverId || "").toLowerCase() === server.toLowerCase()
      && String(item?.name || "").toLowerCase() === tool.toLowerCase());
    if (!selected) continue;
    const key = `${selected.serverId}\u0000${selected.name}`;
    if (!markers.some(item => item.key === key)) markers.push({key, server:String(selected.serverId), tool:String(selected.name), index:match.index});
  }
  return markers;
}

function terminalAiUnsupportedToolName(value:unknown) {
  const source = String(value || "");
  const functionName = source.match(/<function\s*=\s*([a-z0-9_.:-]+)/i)?.[1]
    || source.match(/"(?:name|function)"\s*:\s*"([^"]+)"/i)?.[1]
    || source.match(/<mcp_call\b[^>]*\btool\s*=\s*["']([^"']+)/i)?.[1]
    || "unknown";
  return String(functionName).slice(0, 120);
}

function terminalAiUnsupportedToolMessage(value:unknown) {
  const name = terminalAiUnsupportedToolName(value);
  return tr("terminal:ai.unsupported_tool_detail", {
    name,
    defaultValue:`未执行工具调用：${name}。原因：该工具未匹配已发现且启用的 Terma 工具，或参数格式不合法。请重新发现并启用对应 MCP 工具，或切换兼容模型后重试。`
  });
}

function terminalAiNormalizeToolCalls(value:unknown) {
  const source = String(value || "");
  const renderCall = (full:string, body:string) => {
    const mcpCall = terminalAiResponseMcpCalls(full)[0];
    // MCP calls are rendered once by terminalAiTaskMcpResults as an
    // expandable card. Do not leave a textual marker behind: models often
    // wrap the protocol block in an xml fence, which otherwise exposes the
    // old `**MCP · ...**` placeholder as if it were an answer.
    if (mcpCall) return "\n";
    const call = terminalAiParseToolCall(body || full);
    if (!call) return `\n${terminalAiUnsupportedToolMessage(body || full)}\n`;
    const label = call.description ? `${call.description}\n\n` : "";
    return `${label}\n\`\`\`shell\n${call.command}\n\`\`\``;
  };
  // Remove protocol-only fences before normalizing their contents. This
  // handles gateways that emit `<mcp_call>` inside ```xml ... ``` and keeps
  // the user-facing transcript limited to the card below the answer.
  let normalized = source.replace(/```[^\n`]*\n\s*(<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>)\s*```/gi, full => {
    return terminalAiResponseMcpCalls(full).length ? "\n" : full;
  });
  // Some older gateways wrap their Markdown MCP placeholder in an XML fence.
  // Remove protocol-only fences and standalone markers after verifying them
  // against the discovered catalog. Marker recognition is display-only and
  // is deliberately separate from terminalAiResponseMcpCalls, which can lead
  // to real execution in Agent mode.
  normalized = normalized.replace(/```[^\n`]*\n([\s\S]*?)```/g, (full, body) => {
    if (!terminalAiResponseMcpMarkers(body).length) return full;
    const remainder = String(body || "").replace(/^[ \t]*(?:\*\*)?MCP\s*[·:]\s*[a-zA-Z0-9_-]{1,80}\s*\/\s*[a-zA-Z0-9_.:-]{1,120}(?:\*\*)?[ \t]*$/gmi, "").trim();
    return remainder ? full : "\n";
  });
  normalized = normalized.replace(/^[ \t]*(?:\*\*)?MCP\s*[·:]\s*[a-zA-Z0-9_-]{1,80}\s*\/\s*[a-zA-Z0-9_.:-]{1,120}(?:\*\*)?[ \t]*$/gmi, full => {
    return terminalAiResponseMcpMarkers(full).length ? "\n" : full;
  });
  normalized = normalized.replace(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi, renderCall);
  normalized = normalized.replace(/<function\s*=\s*(?:terminal|exec_command|shell)\s*>([\s\S]*?)<\/function>/gi, full => renderCall(full, full));
  // Some OpenAI-compatible gateways emit a simple XML command wrapper instead
  // of a tool call. Convert it to the same user-facing shell block and never
  // expose the protocol tags in the answer.
  normalized = normalized.replace(/<command(?:\s[^>]*)?>([\s\S]*?)<\/command>/gi, (_, command) => `\n\`\`\`shell\n${terminalAiDecodeXmlText(command).trim()}\n\`\`\``);
  normalized = normalized.replace(/<mcp_call\b([^>]*)>([\s\S]*?)<\/mcp_call>/gi, full => {
    const call = terminalAiResponseMcpCalls(full)[0];
    return call ? "\n" : `\n${terminalAiUnsupportedToolMessage(full)}\n`;
  });
  // Do not expose incomplete or unsupported provider protocol fragments while a stream is still arriving.
  return normalized.replace(/<tool_call\b[\s\S]*$/i, "").replace(/<function\s*=\s*terminal\b[\s\S]*$/i, "").replace(/<command\b[\s\S]*$/i, "").replace(/<mcp_call\b[\s\S]*$/i, "");
}

function terminalAiCompleteRecoveredCommandAnswer(value:unknown, command:unknown) {
  const source = terminalAiNormalizeMarkdownEscapes(value);
  const fencePattern = /```(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?\s*\n/gi;
  let lastFence:{bodyStart:number}|null = null;
  let match;
  while ((match = fencePattern.exec(source))) lastFence = {bodyStart:fencePattern.lastIndex};
  if (lastFence && !source.slice(lastFence.bodyStart).includes("```")) return `${source.replace(/\s+$/, "")}\n\`\`\``;
  const visible = terminalAiNormalizeToolCalls(source).trim();
  if (terminalAiResponseCommands(visible).includes(String(command || "").trim())) return visible;
  return `${visible ? `${visible}\n\n` : ""}\`\`\`shell\n${String(command || "").trim()}\n\`\`\``;
}
return {terminalAiResponseMcpCalls,terminalAiResponseMcpMarkers,terminalAiUnsupportedToolName,terminalAiUnsupportedToolMessage,terminalAiNormalizeToolCalls,terminalAiCompleteRecoveredCommandAnswer};
}
