import {terminalAiStripControl,terminalAiNormalizeChatAnswer,terminalAiDeduplicateRepeatedText,terminalAiNormalizeMarkdownEscapes} from './response-text';
import {terminalAiCommandFromCodeBlock,terminalAiCommandText,terminalAiStandaloneCommandFromLine} from './response-commands';
import type {createResponseTools} from './response-tools';
// Display templates are compiled to Vue nodes by markup-view.
export interface MarkupPort {
tools:ReturnType<typeof createResponseTools>;
tr:(...args:any[])=>any;
esc:(...args:any[])=>any;
escAttr:(...args:any[])=>any;
icon:(...args:any[])=>any;
terminalAiSettingsValue:(...args:any[])=>any;
terminalAiStateForKey:(...args:any[])=>any;
terminalAiLayoutSettings:(...args:any[])=>any;
terminalAiModeHint:(...args:any[])=>any;
terminalAiAvailableModels:string[];
}
export function createMarkupRenderers(port:MarkupPort){const {tr,esc,escAttr,icon,terminalAiSettingsValue,terminalAiStateForKey,terminalAiLayoutSettings,terminalAiModeHint,terminalAiAvailableModels}=port;
const {terminalAiResponseMcpCalls,terminalAiResponseMcpMarkers,terminalAiNormalizeToolCalls}=port.tools;
function terminalAiFormatTokens(value: any): any {
    const count: any = Math.max(0, Number(value || 0));
    if (count >= 1000000)
        return `${Number((count / 1000000).toFixed(2))}M`;
    if (count >= 1000)
        return `${Number((count / 1000).toFixed(1))}K`;
    return String(Math.round(count));
}
function terminalAiTurnUsage(turn: any): any {
    const usage: any = turn?.usage || {};
    const input: any = Number(usage.input_tokens);
    const output: any = Number(usage.output_tokens);
    const total: any = Number(usage.total_tokens);
    const available: any = [input, output, total].some((value: any) => Number.isFinite(value) && value > 0);
    return {
        input: available && Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0,
        output: available && Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0,
        total: available && Number.isFinite(total) ? Math.max(0, Math.round(total)) : (available ? Math.max(0, Math.round(input || 0) + Math.round(output || 0)) : 0),
        available,
        estimated: false
    };
}
function terminalAiPermissionHint(permission: any): any {
    if (permission === "full")
        return tr("terminal:ai.permission_full_hint", { defaultValue: "完全访问：Agent 可自动执行所有命令，包括风险操作" });
    if (permission === "controlled")
        return tr("terminal:ai.permission_controlled_hint", { defaultValue: "只读命令可自动执行，风险操作仍会询问" });
    if (permission === "suggest")
        return tr("terminal:ai.permission_suggest_hint", { defaultValue: "只提供命令，不自动执行" });
    return tr("terminal:ai.permission_confirm_hint", { defaultValue: "每条命令执行前都要确认" });
}
function terminalAiReasoningLabel(value: any): any {
    const effort: any = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "none";
    return tr(`settings:ai.reasoning_${effort}`, { defaultValue: effort });
}
function terminalAiPanelModelOptions(state: any): any {
    const current: any = String(state?.model || terminalAiSettingsValue().model || "").trim();
    const availableModels: any = typeof terminalAiAvailableModels !== "undefined" && Array.isArray(terminalAiAvailableModels) ? terminalAiAvailableModels : [];
    const available: any = [...new Set([...(state?.modelCustom ? [] : [current]), ...availableModels].map((item: any) => String(item || "").trim()).filter(Boolean))];
    const known: any = !state?.modelCustom && available.includes(current);
    return `<option value="" ${!current && !state?.modelCustom ? "selected" : ""}>${esc(tr("terminal:ai.model_select", { defaultValue: "选择模型" }))}</option>${available.map((model: any) => `<option value="${escAttr(model)}" ${known && model === current ? "selected" : ""}>${esc(model)}</option>`).join("")}<option value="__custom__" ${state?.modelCustom || (!known && current) ? "selected" : ""}>${esc(tr("terminal:ai.model_custom", { defaultValue: "手动输入模型…" }))}</option>`;
}
function terminalAiBlockHtml(key: any, block: any, selectedId: any = "", options: any = {}): any {
    const selected: any = String(selectedId || "") === String(block.id);
    const output: any = terminalAiStripControl(block.output).trim();
    const summary: any = output ? output.split("\n").map((line: any) => line.trim()).filter(Boolean).slice(-2).join(" · ") : tr("terminal:ai.waiting_output", { defaultValue: "等待输出" });
    const completed: any = Boolean(block.completedAt);
    const waiting: any = Boolean(block.waitingForInput);
    const timedOut: any = Boolean(block.timedOutAt);
    const longCommand: any = String(block.command || "").length > 8000;
    const stateLabel: any = completed ? tr("terminal:ai.completed", { defaultValue: "已完成" }) : waiting ? tr("terminal:ai.waiting_input", { defaultValue: "等待终端输入" }) : timedOut ? tr("terminal:ai.timed_out", { defaultValue: "等待超时" }) : tr("terminal:ai.running", { defaultValue: "执行中" });
    const stateClass: any = completed ? "completed" : waiting || timedOut ? "waiting" : "running";
    const interrupt: any = !options.chatMode && !completed && !waiting ? `<button type="button" data-action="terminal-ai-block-stop" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}">${icon("square")}<span>${esc(tr("terminal:ai.stop_command", { defaultValue: "中止命令" }))}</span></button>` : "";
    const lengthHint: any = longCommand ? `<span class="terminal-ai-block-length">${esc(tr("terminal:ai.long_command_hint", { length: String(block.command || "").length, defaultValue: `命令较长 · ${String(block.command || "").length} 字符，失败时建议拆分为多个步骤` }))}</span>` : "";
    const actions: any = options.chatMode ? "" : `<div class="terminal-ai-block-actions"><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="explain">${icon("message-circle-more")}<span>${esc(tr("terminal:ai.explain", { defaultValue: "解释" }))}</span></button><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="summarize">${icon("list")}<span>${esc(tr("terminal:ai.summarize", { defaultValue: "总结" }))}</span></button><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="fix">${icon("wrench")}<span>${esc(tr("terminal:ai.fix", { defaultValue: "修复建议" }))}</span></button>${completed || waiting || timedOut ? `<button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="continue">${icon("step-forward")}<span>${esc(tr("terminal:ai.continue", { defaultValue: "继续分析" }))}</span></button>` : ""}${interrupt}</div>`;
    return `<article class="terminal-ai-block${selected ? " selected" : ""}" data-terminal-ai-block-id="${escAttr(block.id)}"><div class="terminal-ai-block-head"><button class="terminal-ai-block-select" type="button" data-action="terminal-ai-select-block" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" aria-pressed="${selected ? "true" : "false"}"><span class="terminal-ai-block-index">${icon("square-terminal")}</span><code title="${escAttr(block.command)}">${esc(block.command)}</code></button><span class="terminal-ai-block-state ${stateClass}">${esc(stateLabel)}</span></div><div class="terminal-ai-block-summary">${esc(summary)}</div>${lengthHint}${actions}</article>`;
}
function terminalAiTaskGroups(turns: any): any {
    const groups: any = [];
    for (const turn of turns || []) {
        const current: any = groups.at(-1);
        const taskId: any = String(turn?.taskId || "");
        const sameTask: any = Boolean(current && taskId && current.taskId === taskId);
        if (!sameTask && (!turn.agentContinuation || !current))
            groups.push({ root: turn, steps: [], taskId: taskId || String(turn?.id || "") });
        groups.at(-1).steps.push(turn);
    }
    return groups;
}
function terminalAiMcpResultCardHtml(item: any): any {
    const server: any = String(item?.server || "");
    const tool: any = String(item?.tool || "");
    const status: any = String(item?.status || tr("terminal:ai.agent_not_executed", { defaultValue: "未执行" }));
    const argumentsText: any = JSON.stringify(item?.arguments && typeof item.arguments === "object" ? item.arguments : {}, null, 2);
    const output: any = String(item?.output || "").trim();
    return `<details class="terminal-ai-mcp-result-card"><summary>${icon("plug-zap")}<span>${esc(tr("terminal:ai.mcp_call_title", { tool, defaultValue: `调用工具 ${tool}` }))}</span><small>${esc(status)}</small></summary><div class="terminal-ai-mcp-result-body"><div class="terminal-ai-mcp-meta"><span>${esc(tr("terminal:ai.mcp_server", { defaultValue: "服务器" }))}</span><code>${esc(server)}</code><span>${esc(tr("terminal:ai.mcp_tool", { defaultValue: "工具" }))}</span><code>${esc(tool)}</code></div><div class="terminal-ai-mcp-section"><b>${esc(tr("terminal:ai.mcp_arguments", { defaultValue: "参数" }))}</b><pre>${esc(argumentsText)}</pre></div><details class="terminal-ai-mcp-output"><summary>${esc(tr("terminal:ai.mcp_result", { defaultValue: "结果（展开查看）" }))}</summary><pre>${esc(output || tr("terminal:ai.mcp_no_result", { defaultValue: "暂无结果" }))}</pre></details></div></details>`;
}
function terminalAiTaskMcpResults(steps: any): any {
    const results: any = [];
    const keys: any = new Set();
    const identities: any = new Set();
    const add: any = (item: any) => {
        if (!item?.server || !item?.tool)
            return;
        const args: any = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
        const key: any = `${item.server}\u0000${item.tool}\u0000${JSON.stringify(args)}`;
        if (keys.has(key))
            return;
        keys.add(key);
        identities.add(`${item.server}\u0000${item.tool}`);
        results.push({ ...item, arguments: args });
    };
    for (const step of steps || [])
        for (const item of (Array.isArray(step?.agentResults) ? step.agentResults : []))
            add(item);
    for (const step of steps || [])
        for (const call of terminalAiResponseMcpCalls(step?.answer || "")) {
            const key: any = `${call.server}\u0000${call.tool}\u0000${JSON.stringify(call.arguments || {})}`;
            if (!keys.has(key))
                add({ kind: "mcp", server: call.server, tool: call.tool, arguments: call.arguments || {}, output: "", status: tr("terminal:ai.mcp_pending", { defaultValue: "等待调用" }) });
        }
    // Older compatible models sometimes return a display-only Markdown marker
    // instead of Terma's structured MCP protocol. It must never execute. Show a
    // single explanatory card only when server/tool exactly matches the active
    // discovered catalog, and prefer any real result already recorded above.
    for (const step of steps || [])
        for (const marker of terminalAiResponseMcpMarkers(step?.answer || "")) {
            const identity: any = `${marker.server}\u0000${marker.tool}`;
            if (!identities.has(identity))
                add({ kind: "mcp-marker", server: marker.server, tool: marker.tool, arguments: {}, output: "", status: tr("terminal:ai.agent_not_executed", { defaultValue: "未执行" }) });
        }
    return results;
}
function terminalAiMcpResultIdentity(item: any): any {
    const args: any = item?.arguments && typeof item.arguments === "object" ? item.arguments : {};
    return String(item?.server || "") + "\u0000" + String(item?.tool || "") + "\u0000" + JSON.stringify(args);
}
function terminalAiRenderAnswerWithMcp(key: any, answer: any, entries: any, used: any, options: any = {}): any {
    // Remove a protocol-only XML fence before locating the call. Otherwise the
    // opening and closing fence are handed to Markdown separately and become an
    // empty `xml` code block around the real MCP result card.
    const source: any = String(answer || "").replace(/```[^\n`]*\n\s*(<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>|<tool_call\b[^>]*>[\s\S]*?<\/tool_call>)\s*```/gi, "$1");
    const fragments: any = [];
    const pattern: any = /<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>|<tool_call\b[^>]*>[\s\S]*?<\/tool_call>|^[ \t]*(?:\*\*)?MCP\s*[·:]\s*[a-zA-Z0-9_-]{1,80}\s*\/\s*[a-zA-Z0-9_.:-]{1,120}(?:\*\*)?[ \t]*$/gmi;
    let last: any = 0;
    let match;
    while ((match = pattern.exec(source))) {
        if (match.index > last)
            fragments.push(renderTerminalAiMarkdown(key, source.slice(last, match.index), options));
        const raw: any = match[0];
        const call: any = terminalAiResponseMcpCalls(raw)[0];
        const marker: any = terminalAiResponseMcpMarkers(raw)[0];
        const selected: any = call || marker;
        const matchingEntries: any = selected
            ? entries.filter((item: any) => String(item?.server || "").toLowerCase() === String(selected.server || "").toLowerCase()
                && String(item?.tool || "").toLowerCase() === String(selected.tool || "").toLowerCase())
            : [];
        const selectedArguments: any = selected?.arguments && typeof selected.arguments === "object" ? selected.arguments : {};
        const argumentKey: any = JSON.stringify(selectedArguments);
        const entry: any = matchingEntries.find((item: any) => JSON.stringify(item?.arguments && typeof item.arguments === "object" ? item.arguments : {}) === argumentKey
            && !used.has(terminalAiMcpResultIdentity(item)))
            || matchingEntries.find((item: any) => !used.has(terminalAiMcpResultIdentity(item)));
        if (entry) {
            fragments.push(terminalAiMcpResultCardHtml(entry));
            used.add(terminalAiMcpResultIdentity(entry));
            // A display-only `MCP · server / tool` marker carries no arguments.
            // Gateways may have recorded the same compatibility call in several
            // continuation turns; consume all matching entries so the leftovers are
            // not appended as duplicate cards below the answer. Explicit MCP calls
            // keep argument-sensitive entries and can legitimately render more than
            // one result for the same tool.
            if (!call && marker && !Object.keys(selectedArguments).length) {
                for (const duplicate of matchingEntries)
                    used.add(terminalAiMcpResultIdentity(duplicate));
            }
        }
        else if (!selected)
            fragments.push(renderTerminalAiMarkdown(key, raw, options));
        last = match.index + raw.length;
    }
    if (last < source.length)
        fragments.push(renderTerminalAiMarkdown(key, source.slice(last), options));
    return fragments.join("");
}
function terminalAiTaskAssistantHtml(key: any, group: any): any {
    const steps: any = Array.isArray(group?.steps) ? group.steps : [];
    const turn: any = steps.at(-1) || group?.root || {};
    const chatMode: any = steps.some((item: any) => item?.mode === "chat");
    const usage: any = steps.reduce((sum: any, item: any) => {
        const current: any = terminalAiTurnUsage(item);
        if (!current.available)
            return sum;
        sum.available = true;
        sum.input += current.input;
        sum.output += current.output;
        return sum;
    }, { available: false, input: 0, output: 0 });
    const metrics: any = usage.available
        ? tr("terminal:ai.turn_tokens", { input: terminalAiFormatTokens(usage.input), output: terminalAiFormatTokens(usage.output), defaultValue: `输入 ${terminalAiFormatTokens(usage.input)} · 输出 ${terminalAiFormatTokens(usage.output)} tokens` })
        : tr("terminal:ai.usage_unavailable", { defaultValue: "Token 用量未由模型返回" });
    const mcpEntries: any = terminalAiTaskMcpResults(steps);
    const usedMcp: any = new Set();
    const phases: any = steps.flatMap((item: any) => {
        const rawAnswer: any = String(item?.answer || "");
        const answer: any = chatMode ? terminalAiNormalizeChatAnswer(rawAnswer) : rawAnswer;
        const itemMcpResults: any = (Array.isArray(item?.agentResults) ? item.agentResults : [])
            .filter((result: any) => result?.kind === "mcp");
        const hasMcpAnchor: any = Boolean(terminalAiResponseMcpCalls(answer).length
            || terminalAiResponseMcpMarkers(answer).length);
        const renderUnanchoredMcp: any = () => itemMcpResults
            .filter((result: any) => !usedMcp.has(terminalAiMcpResultIdentity(result)))
            .map((result: any) => {
            usedMcp.add(terminalAiMcpResultIdentity(result));
            return terminalAiMcpResultCardHtml(result);
        }).join("");
        // Preflight calls happen before the model's continuation turn and have no
        // marker in its answer. Keep their result at the start of that phase;
        // anchored calls are inserted by terminalAiRenderAnswerWithMcp instead.
        const before: any = hasMcpAnchor ? "" : renderUnanchoredMcp();
        const rendered: any = answer ? terminalAiRenderAnswerWithMcp(key, answer, mcpEntries, usedMcp, { actions: !chatMode, copy: true }) : "";
        const after: any = hasMcpAnchor ? renderUnanchoredMcp() : "";
        const error: any = item?.error ? `<div class="terminal-ai-error">${icon("circle-alert")}<span>${esc(item.error)}</span></div>` : "";
        const streaming: any = item?.busy ? `<span class="terminal-ai-streaming">${esc(tr("terminal:ai.sending", { defaultValue: "正在生成…" }))}</span>` : "";
        if (!before && !rendered && !after && !error && !streaming)
            return [];
        return [`<div class="terminal-ai-response-phase" data-terminal-ai-phase-id="${escAttr(item.id || "")}">${before}${rendered}${after}${error}${streaming}</div>`];
    }).join("");
    const reasoningText: any = [...new Set(steps.map((item: any) => String(item?.reasoning || "").trim()).filter(Boolean))].join("\n\n");
    const reasoning: any = reasoningText ? `<details class="terminal-ai-reasoning"><summary>${icon("brain")}<span>${esc(tr("terminal:ai.reasoning_summary", { defaultValue: "思考摘要" }))}</span></summary><div>${renderTerminalAiMarkdown(key, reasoningText, { actions: false })}</div></details>` : "";
    // A malformed or truncated answer can leave a recorded result without a
    // matching marker. Show it at the beginning of the transcript rather than
    // moving the tool call to the end of the assistant message.
    const orphanMcpCards: any = mcpEntries.filter((item: any) => !usedMcp.has(terminalAiMcpResultIdentity(item))).map(terminalAiMcpResultCardHtml).join("");
    const notices: any = [...new Set(steps.map((item: any) => String(item?.agentNotice || "").trim()).filter(Boolean))];
    const notice: any = notices.map((item: any) => `<div class="terminal-ai-agent-notice">${icon("info")}<span>${esc(item)}</span></div>`).join("");
    const model: any = [...steps].reverse().find((item: any) => item?.model)?.model || "";
    const hasAnswer: any = steps.some((item: any) => String(item?.answer || "").trim());
    return `<div class="terminal-ai-task-step" data-terminal-ai-turn-id="${escAttr(turn.id || group?.root?.id || "")}"><div class="terminal-ai-assistant-message"><div class="terminal-ai-response-head"><span>${icon("bot")}<b>${esc(tr("terminal:ai.response", { defaultValue: "AI 回复" }))}</b></span><span>${esc(model)}</span></div><div class="terminal-ai-response-content">${orphanMcpCards}${phases}</div>${notice}${reasoning}<div class="terminal-ai-turn-footer"><span>${esc(metrics)}</span>${hasAnswer ? `<button type="button" data-action="terminal-ai-copy-response" data-terminal-ai-key="${escAttr(key)}" data-turn-id="${escAttr(turn.id)}" title="${escAttr(tr("terminal:ai.copy_response", { defaultValue: "复制回复" }))}" aria-label="${escAttr(tr("terminal:ai.copy_response", { defaultValue: "复制回复" }))}">${icon("copy")}</button>` : ""}</div></div></div>`;
}
function terminalAiTurnsHtml(key: any, turns: any): any {
    return terminalAiTaskGroups(turns).map((group: any) => `<article class="terminal-ai-task" data-terminal-ai-task-id="${escAttr(group.taskId || group.root.id)}"><div class="terminal-ai-user-message"><span>${esc(tr("terminal:ai.you", { defaultValue: "你" }))}</span><p>${esc(group.root.prompt)}</p></div><div class="terminal-ai-task-steps">${terminalAiTaskAssistantHtml(key, group)}</div></article>`).join("");
}
function terminalAiInlineMarkdown(value: any): any {
    const tokens: any = [];
    let source: any = String(value || "");
    const hold: any = (html: any) => {
        const index: any = tokens.push(html) - 1;
        return `\u0001${index}\u0002`;
    };
    source = source.replace(/`([^`\n]+)`/g, (_: any, code: any) => hold(`<code>${esc(code)}</code>`));
    source = source.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_: any, label: any, href: any) => {
        try {
            const url: any = new URL(href);
            if (!["http:", "https:"].includes(url.protocol))
                return `${label} (${href})`;
            return hold(`<a href="${escAttr(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
        }
        catch {
            return `${label} (${href})`;
        }
    });
    let html: any = esc(source)
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/\u0001(\d+)\u0002/g, (_: any, index: any) => tokens[Number(index)] || "");
    return html;
}
function terminalAiCodeBlockHtml(key: any, code: any, language: any = "", options: any = {}): any {
    const normalizedLanguage: any = String(language || "").toLowerCase();
    const shell: any = !normalizedLanguage || ["shell", "bash", "sh", "zsh", "console", "powershell", "pwsh", "cmd"].includes(normalizedLanguage);
    const command: any = shell ? terminalAiCommandFromCodeBlock(code) : "";
    const snippetCommand: any = shell ? terminalAiCommandText(String(code || "").replace(/\r\n?/g, "\n").trim()) : "";
    const state: any = terminalAiStateForKey(key);
    const actionButtons: any = [];
    const showActions: any = options.actions !== false;
    const showCopy: any = options.copy === true || showActions;
    if (showCopy)
        actionButtons.push(`<button type="button" data-action="terminal-ai-copy-code" data-code="${escAttr(code)}">${icon("copy")}<span>${esc(tr("terminal:ai.copy_command", { defaultValue: "复制" }))}</span></button>`);
    if (showActions) {
        if (command)
            actionButtons.push(`<button type="button" data-action="terminal-ai-insert-command" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(command)}">${icon("arrow-down-to-line")}<span>${esc(tr("terminal:ai.insert_command", { defaultValue: "放入终端" }))}</span></button>${state.permission !== "suggest" ? `<button type="button" class="primary" data-action="terminal-ai-execute-command" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(command)}">${icon("play")}<span>${esc(tr("terminal:ai.execute_command", { defaultValue: "执行" }))}</span></button>` : ""}`);
        if (snippetCommand)
            actionButtons.push(`<button type="button" data-action="terminal-ai-save-snippet" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(snippetCommand)}">${icon("bookmark-plus")}<span>${esc(tr("terminal:ai.save_as_snippet", { defaultValue: "保存为命令片段" }))}</span></button>`);
    }
    const actions: any = actionButtons.length ? `<div class="terminal-ai-code-actions">${actionButtons.join("")}</div>` : "";
    return `<div class="terminal-ai-code-block"><div class="terminal-ai-code-head"><span>${esc(language || (shell ? "shell" : "code"))}</span></div><pre class="terminal-ai-code"><code>${esc(code)}</code></pre>${actions}</div>`;
}
function renderTerminalAiMarkdown(key: any, value: any, options: any = {}): any {
    // Protocol-only fences can arrive as an empty XML block after a gateway
    // strips the MCP payload. Remove them before line parsing so the transcript
    // never shows a blank code panel above the real tool card.
    const normalizedValue: any = terminalAiDeduplicateRepeatedText(terminalAiNormalizeToolCalls(terminalAiNormalizeMarkdownEscapes(value)))
        .replace(/```[^\n`]*\n\s*```/g, "\n");
    const lines: any = normalizedValue.split("\n");
    const html: any = [];
    let paragraph: any = [];
    let list: any = "";
    let listItems: any = [];
    const flushParagraph: any = () => {
        if (!paragraph.length)
            return;
        html.push(`<p>${paragraph.map(terminalAiInlineMarkdown).join("<br>")}</p>`);
        paragraph = [];
    };
    const flushList: any = () => {
        if (!listItems.length)
            return;
        html.push(`<${list}>${listItems.map((item: any) => `<li>${terminalAiInlineMarkdown(item)}</li>`).join("")}</${list}>`);
        list = "";
        listItems = [];
    };
    const splitTableRow: any = (line: any) => {
        const source: any = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
        const cells: any = [];
        let current: any = "";
        let escaped: any = false;
        for (const char of source) {
            if (escaped) {
                current += char;
                escaped = false;
                continue;
            }
            if (char === "\\") {
                current += char;
                escaped = true;
                continue;
            }
            if (char === "|") {
                cells.push(current.trim());
                current = "";
                continue;
            }
            current += char;
        }
        cells.push(current.trim());
        return cells;
    };
    const isTableDivider: any = (line: any) => splitTableRow(line).length > 0 && splitTableRow(line).every((cell: any) => /^:?-{3,}:?$/.test(cell));
    for (let index: any = 0; index < lines.length; index += 1) {
        const line: any = lines[index];
        const fence: any = line.match(/^```([^\s`]*)\s*$/);
        if (fence) {
            flushParagraph();
            flushList();
            const code: any = [];
            index += 1;
            while (index < lines.length && !/^```\s*$/.test(lines[index])) {
                code.push(lines[index]);
                index += 1;
            }
            html.push(terminalAiCodeBlockHtml(key, code.join("\n"), fence[1], options));
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }
        if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
            flushParagraph();
            flushList();
            const headers: any = splitTableRow(line);
            const divider: any = splitTableRow(lines[index + 1]);
            const rows: any = [];
            index += 2;
            while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
                rows.push(splitTableRow(lines[index]));
                index += 1;
            }
            index -= 1;
            const align: any = divider.map((cell: any) => /^:\-+\:$/.test(cell) ? "center" : /^:/.test(cell) ? "left" : /:$/.test(cell) ? "right" : "");
            const cellHtml: any = (cell: any, tag: any, cellIndex: any) => {
                const style: any = align[cellIndex] ? ` style="text-align:${align[cellIndex]}"` : "";
                return `<${tag}${style}>${terminalAiInlineMarkdown(cell || "")}</${tag}>`;
            };
            html.push(`<div class="terminal-ai-table-wrap"><table class="terminal-ai-table"><thead><tr>${headers.map((cell: any, cellIndex: any) => cellHtml(cell, "th", cellIndex)).join("")}</tr></thead><tbody>${rows.map((row: any) => `<tr>${headers.map((_: any, cellIndex: any) => cellHtml(row[cellIndex] || "", "td", cellIndex)).join("")}</tr>`).join("")}</tbody></table></div>`);
            continue;
        }
        const standaloneCommand: any = terminalAiStandaloneCommandFromLine(line, options);
        if (standaloneCommand) {
            flushParagraph();
            flushList();
            html.push(terminalAiCodeBlockHtml(key, standaloneCommand, "shell", { ...options, copy: true }));
            continue;
        }
        const heading: any = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            flushList();
            html.push(`<h${heading[1].length + 2}>${terminalAiInlineMarkdown(heading[2])}</h${heading[1].length + 2}>`);
            continue;
        }
        const ordered: any = line.match(/^\s*\d+[.)]\s+(.+)$/);
        const unordered: any = line.match(/^\s*[-+*]\s+(.+)$/);
        if (ordered || unordered) {
            flushParagraph();
            const nextList: any = ordered ? "ol" : "ul";
            if (list && list !== nextList)
                flushList();
            list = nextList;
            listItems.push((ordered || unordered)[1]);
            continue;
        }
        const quote: any = line.match(/^>\s?(.*)$/);
        if (quote) {
            flushParagraph();
            flushList();
            html.push(`<blockquote>${terminalAiInlineMarkdown(quote[1])}</blockquote>`);
            continue;
        }
        if (/^\s*(?:---+|___+)\s*$/.test(line)) {
            flushParagraph();
            flushList();
            html.push("<hr>");
            continue;
        }
        paragraph.push(line);
    }
    flushParagraph();
    flushList();
    return html.join("");
}
function terminalAiPanelHtml(key: any): any {
    const state: any = terminalAiStateForKey(key);
    const layout: any = terminalAiLayoutSettings();
    const chatMode: any = state.mode === "chat";
    return `<section class="terminal-ai-panel${state.open ? " is-open" : ""}${chatMode ? " terminal-ai-mode-chat" : " terminal-ai-mode-agent"}" data-terminal-ai-key="${escAttr(key)}"${state.open ? "" : " hidden"}>
    <div class="terminal-ai-head" data-pointerdown-action="terminal-ai-drag"><div class="terminal-ai-title"><span class="terminal-ai-mark">${icon("bot")}</span><div class="terminal-ai-title-copy"><strong>${esc(tr("terminal:ai.title", { defaultValue: "终端 AI" }))}</strong><div class="terminal-ai-title-meta"><span data-terminal-ai-session-title="${escAttr(key)}">${esc(state.sessionTitle || tr("terminal:ai.new_session", { defaultValue: "新会话" }))}</span><small data-terminal-ai-session-usage="${escAttr(key)}"></small></div></div></div><div class="terminal-ai-head-actions"><button class="icon-button" type="button" data-action="terminal-ai-new-session" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.new_session", { defaultValue: "新建会话" }))}" aria-label="${escAttr(tr("terminal:ai.new_session", { defaultValue: "新建会话" }))}">${icon("plus")}</button><button class="icon-button" type="button" data-action="terminal-ai-history" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.history_title", { defaultValue: "AI 会话历史" }))}" aria-label="${escAttr(tr("terminal:ai.history_title", { defaultValue: "AI 会话历史" }))}">${icon("history")}</button><button class="icon-button" type="button" data-action="terminal-ai-minimize" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(layout.minimized ? tr("terminal:ai.restore", { defaultValue: "恢复 AI 面板" }) : tr("terminal:ai.minimize", { defaultValue: "最小化 AI 面板" }))}" aria-label="${escAttr(layout.minimized ? tr("terminal:ai.restore", { defaultValue: "恢复 AI 面板" }) : tr("terminal:ai.minimize", { defaultValue: "最小化 AI 面板" }))}">${icon(layout.minimized ? "bot" : "minus")}</button><button class="icon-button" type="button" data-action="terminal-ai-close" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.close", { defaultValue: "关闭终端 AI" }))}" aria-label="${escAttr(tr("terminal:ai.close", { defaultValue: "关闭终端 AI" }))}">${icon("x")}</button></div></div>
    <div class="terminal-ai-mode-row"><div class="terminal-ai-mode-switch" role="tablist" aria-label="${escAttr(tr("terminal:ai.mode", { defaultValue: "AI 模式" }))}"><button class="terminal-ai-mode-option${chatMode ? " active" : ""}" type="button" role="tab" aria-selected="${chatMode ? "true" : "false"}" data-action="terminal-ai-mode" data-terminal-ai-mode="chat" data-terminal-ai-key="${escAttr(key)}">${icon("message-circle")}<span>${esc(tr("terminal:ai.mode_chat", { defaultValue: "聊天" }))}</span></button><button class="terminal-ai-mode-option${chatMode ? "" : " active"}" type="button" role="tab" aria-selected="${chatMode ? "false" : "true"}" data-action="terminal-ai-mode" data-terminal-ai-mode="agent" data-terminal-ai-key="${escAttr(key)}">${icon("bot")}<span>${esc(tr("terminal:ai.mode_agent", { defaultValue: "Agent" }))}</span></button></div><span class="terminal-ai-mode-hint" data-terminal-ai-mode-hint="${escAttr(key)}">${esc(terminalAiModeHint(state.mode))}</span></div>
    <div class="terminal-ai-body" data-terminal-ai-body="${escAttr(key)}">
      <details class="terminal-ai-blocks-wrap"${chatMode ? " hidden" : ""}><summary><span>${icon("square-terminal")}<b>${esc(tr("terminal:ai.blocks", { defaultValue: "命令记录" }))}</b></span><span class="terminal-ai-block-count" data-terminal-ai-count="${escAttr(key)}">${state.blocks.length}</span></summary><div class="terminal-ai-blocks" data-terminal-ai-blocks="${escAttr(key)}"></div></details>
      <div class="terminal-ai-turns" data-terminal-ai-turns="${escAttr(key)}"></div>
      <div class="terminal-ai-approval-slot" data-terminal-ai-approval="${escAttr(key)}"${chatMode ? " hidden" : ""}></div>
      <div class="terminal-ai-attachments" data-terminal-ai-attachments="${escAttr(key)}"></div><input class="terminal-ai-attachment-input" type="file" multiple hidden accept=".txt,.log,.json,.csv,.md,.markdown,.sh,.bash,.conf,.ini,.yaml,.yml,.xml,.ts,.js,.tsx,.jsx,.html,.css" data-change-action="terminal-ai-attachments-select" data-terminal-ai-key="${escAttr(key)}">
      <div class="terminal-ai-task-dock" data-terminal-ai-task-dock="${escAttr(key)}" hidden></div>
      <form class="terminal-ai-composer" data-submit-action="terminal-ai-submit" data-terminal-ai-key="${escAttr(key)}">
        <textarea data-terminal-ai-prompt="${escAttr(key)}" data-keydown-action="terminal-ai-prompt-keydown" data-terminal-ai-key="${escAttr(key)}" rows="3" maxlength="6000" placeholder="${escAttr(chatMode ? tr("terminal:ai.chat_prompt_placeholder", { defaultValue: "询问当前终端内容，AI 只读回答…" }) : tr("terminal:ai.prompt_placeholder", { defaultValue: "描述任务，或让 AI 检查、排错并给出下一步…" }))}"></textarea>
        <div class="terminal-ai-compose-actions">
          <div class="terminal-ai-compose-config">
            <details class="terminal-ai-composer-settings">
              <summary title="${escAttr(tr("terminal:ai.composer_settings", { defaultValue: "模型与推理设置" }))}"><span data-terminal-ai-composer-model="${escAttr(key)}">${esc(state.model || tr("terminal:ai.model_unselected", { defaultValue: "未选择模型" }))}</span><small data-terminal-ai-composer-reasoning="${escAttr(key)}">${esc(terminalAiReasoningLabel(state.reasoning_effort))}</small>${icon("chevron-up")}</summary>
              <div class="terminal-ai-composer-popover">
                <div class="terminal-ai-popover-row terminal-ai-model-control"><label for="terminalAiModel-${escAttr(key)}">${esc(tr("terminal:ai.model", { defaultValue: "模型" }))}</label><select id="terminalAiModel-${escAttr(key)}" data-change-action="terminal-ai-model" data-terminal-ai-key="${escAttr(key)}">${terminalAiPanelModelOptions(state)}</select><input class="terminal-ai-model-custom" data-input-action="terminal-ai-model-custom" data-terminal-ai-key="${escAttr(key)}" value="${esc(state.model || "")}" placeholder="${escAttr(tr("terminal:ai.model_custom_placeholder", { defaultValue: "手动输入模型名称" }))}" hidden disabled></div>
                <div class="terminal-ai-popover-row"><label for="terminalAiReasoning-${escAttr(key)}">${esc(tr("terminal:ai.reasoning_effort", { defaultValue: "推理强度" }))}</label><select id="terminalAiReasoning-${escAttr(key)}" data-change-action="terminal-ai-reasoning" data-terminal-ai-key="${escAttr(key)}"><option value="none">${esc(tr("settings:ai.reasoning_none", { defaultValue: "关闭" }))}</option><option value="minimal">${esc(tr("settings:ai.reasoning_minimal", { defaultValue: "最低" }))}</option><option value="low">${esc(tr("settings:ai.reasoning_low", { defaultValue: "低" }))}</option><option value="medium">${esc(tr("settings:ai.reasoning_medium", { defaultValue: "中" }))}</option><option value="high">${esc(tr("settings:ai.reasoning_high", { defaultValue: "高" }))}</option><option value="xhigh">${esc(tr("settings:ai.reasoning_xhigh", { defaultValue: "极高" }))}</option><option value="max">${esc(tr("settings:ai.reasoning_max", { defaultValue: "最大" }))}</option></select></div>
                <details class="terminal-ai-composer-advanced"><summary><span>${esc(tr("terminal:ai.advanced", { defaultValue: "高级" }))}</span>${icon("chevron-down")}</summary><div>
                  <div class="terminal-ai-popover-row terminal-ai-permission-row" data-terminal-ai-permission-row="${escAttr(key)}"><label for="terminalAiPermission-${escAttr(key)}">${esc(tr("terminal:ai.permission", { defaultValue: "执行权限" }))}</label><select id="terminalAiPermission-${escAttr(key)}" data-change-action="terminal-ai-permission" data-terminal-ai-key="${escAttr(key)}"><option value="suggest">${esc(tr("terminal:ai.permission_suggest", { defaultValue: "仅建议" }))}</option><option value="confirm">${esc(tr("terminal:ai.permission_confirm", { defaultValue: "逐步确认" }))}</option><option value="controlled">${esc(tr("terminal:ai.permission_controlled", { defaultValue: "受控自动" }))}</option><option value="full">${esc(tr("terminal:ai.permission_full", { defaultValue: "完全访问" }))}</option></select><span class="terminal-ai-control-hint" data-terminal-ai-permission-hint="${escAttr(key)}"></span></div>
                  <div class="terminal-ai-popover-row"><label for="terminalAiLayout-${escAttr(key)}">${esc(tr("terminal:ai.layout", { defaultValue: "布局" }))}</label><select id="terminalAiLayout-${escAttr(key)}" data-change-action="terminal-ai-layout-mode" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.layout_hint", { defaultValue: "拖动标题栏移动，拖动边界调整大小" }))}"><option value="fixed" ${layout.mode === "fixed" ? "selected" : ""}>${esc(tr("terminal:ai.layout_fixed", { defaultValue: "固定" }))}</option><option value="floating" ${layout.mode === "floating" ? "selected" : ""}>${esc(tr("terminal:ai.layout_floating", { defaultValue: "悬浮" }))}</option></select></div>
                </div></details>
              </div>
            </details>
            <label class="terminal-ai-deep-toggle"><input type="checkbox" data-change-action="terminal-ai-deep-thinking" data-terminal-ai-key="${escAttr(key)}" ${state.deep_thinking ? "checked" : ""}>${icon("brain")}<span>${esc(tr("terminal:ai.deep_thinking", { defaultValue: "深度思考" }))}</span></label>
            <span class="terminal-ai-ai-status sr-only" data-terminal-ai-ai-status="${escAttr(key)}"></span>
          </div>
          <div class="terminal-ai-compose-buttons"><button class="icon-button" type="button" data-action="terminal-ai-attachment-open" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.add_attachment", { defaultValue: "添加上下文附件" }))}" aria-label="${escAttr(tr("terminal:ai.add_attachment", { defaultValue: "添加上下文附件" }))}">${icon("paperclip")}</button><button type="button" data-action="terminal-ai-stop" data-terminal-ai-key="${escAttr(key)}" data-terminal-ai-stop="${escAttr(key)}" hidden>${icon("square")}<span>${esc(tr("terminal:ai.stop", { defaultValue: "停止" }))}</span></button><button class="primary icon-button terminal-ai-send-button" type="submit" data-terminal-ai-send="${escAttr(key)}" title="${escAttr(tr("terminal:ai.send", { defaultValue: "发送" }))}" aria-label="${escAttr(tr("terminal:ai.send", { defaultValue: "发送" }))}">${icon("arrow-up")}<span class="sr-only">${esc(tr("terminal:ai.send", { defaultValue: "发送" }))}</span></button></div>
        </div>
        <span class="terminal-ai-context-note" data-terminal-ai-context-note="${escAttr(key)}"></span>
      </form>
    </div><span class="terminal-ai-fixed-resizer" data-pointerdown-action="terminal-ai-resize" data-terminal-ai-key="${escAttr(key)}" aria-hidden="true"></span><span class="terminal-ai-floating-resizer" data-pointerdown-action="terminal-ai-resize" data-terminal-ai-key="${escAttr(key)}" aria-hidden="true"></span>
  </section>`;
}

return {terminalAiFormatTokens,terminalAiTurnUsage,terminalAiPermissionHint,terminalAiReasoningLabel,terminalAiPanelModelOptions,terminalAiBlockHtml,terminalAiTaskGroups,terminalAiMcpResultCardHtml,terminalAiTaskMcpResults,terminalAiMcpResultIdentity,terminalAiRenderAnswerWithMcp,terminalAiTaskAssistantHtml,terminalAiTurnsHtml,terminalAiInlineMarkdown,terminalAiCodeBlockHtml,renderTerminalAiMarkdown,terminalAiPanelHtml};
}
