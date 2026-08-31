/**
 * Rendering and context helpers for the terminal AI panel.
 * Loaded before app-terminal-ai.js; functions resolve shared state at call time.
 */
const TERMINAL_AI_COMMAND_MAX_LENGTH = 100000;
const TERMINAL_AI_SCREEN_MAX_LINES = 240;
const TERMINAL_AI_SCREEN_MAX_CHARS = 24000;

function terminalAiCommandText(value) {
  return String(value || "").slice(0, TERMINAL_AI_COMMAND_MAX_LENGTH);
}

// Chat replies occasionally put a short command in inline Markdown instead of
// a fenced shell block. Keep the fallback intentionally narrow so ordinary
// prose such as "cat is..." does not become an executable-looking block.
const TERMINAL_AI_INLINE_COMMAND_NAMES = new Set([
  "apt", "apt-get", "awk", "bash", "cat", "cd", "chmod", "chown", "clear", "command", "cp", "curl",
  "date", "df", "du", "docker", "echo", "env", "export", "file", "find", "findmnt", "free", "git",
  "grep", "head", "history", "hostname", "id", "ip", "journalctl", "kill", "killall", "less", "ln",
  "ls", "lsof", "mkdir", "mount", "mv", "node", "npm", "passwd", "ping", "podman", "printf", "ps",
  "pwd", "python", "python3", "read", "rm", "screen", "sed", "seq", "sh", "sleep", "sort", "ss",
  "stat", "systemctl", "tail", "tar", "test", "tmux", "top", "touch", "uname", "uptime", "wc", "wget",
  "which", "whoami", "xargs", "yarn", "yum", "zsh"
]);

function terminalAiStandaloneCommandFromLine(value, options={}) {
  const line = String(value || "").trim();
  if (!line) return "";
  const inline = line.match(/^`([^`\n]+)`$/);
  const raw = inline ? inline[1].trim() : line;
  if (!raw || /[。！？!?]$/.test(raw)) return "";
  if (options.copy !== true) return "";
  const command = raw.replace(/^\$\s+/, "").trim();
  const first = command.match(/^(?:sudo\s+)?([a-zA-Z][a-zA-Z0-9_-]*)\b/);
  if (!first || !TERMINAL_AI_INLINE_COMMAND_NAMES.has(first[1].toLowerCase())) return "";
  // Only an explicit inline-code line is promoted unless the caller opts into
  // raw-line recovery (used by Chat, where the model is instructed not to
  // emit commands but may still return one for compatibility).
  // For unmarked lines require a command-shaped argument: an option, path, or
  // shell operator. This keeps prose such as "cat is a command name" as prose.
  if (!inline && !/(?:^|\s)-[a-zA-Z0-9]|[|;&<>$]|(?:^|\s)\//.test(command.slice(first[0].length))) return "";
  if (typeof terminalAiShellCommandLooksComplete === "function" && !terminalAiShellCommandLooksComplete(command)) return "";
  return terminalAiCommandText(command);
}

function terminalAiFormatTokens(value) {
  const count = Math.max(0, Number(value || 0));
  if (count >= 1000000) return `${Number((count / 1000000).toFixed(2))}M`;
  if (count >= 1000) return `${Number((count / 1000).toFixed(1))}K`;
  return String(Math.round(count));
}

function terminalAiTurnUsage(turn) {
  const usage = turn?.usage || {};
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  const total = Number(usage.total_tokens);
  const available = [input, output, total].some(value => Number.isFinite(value) && value > 0);
  return {
    input:available && Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0,
    output:available && Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0,
    total:available && Number.isFinite(total) ? Math.max(0, Math.round(total)) : (available ? Math.max(0, Math.round(input || 0) + Math.round(output || 0)) : 0),
    available,
    estimated:false
  };
}

function terminalAiPermissionHint(permission) {
  if (permission === "full") return tr("terminal:ai.permission_full_hint", {defaultValue:"完全访问：Agent 可自动执行所有命令，包括风险操作"});
  if (permission === "controlled") return tr("terminal:ai.permission_controlled_hint", {defaultValue:"只读命令可自动执行，风险操作仍会询问"});
  if (permission === "suggest") return tr("terminal:ai.permission_suggest_hint", {defaultValue:"只提供命令，不自动执行"});
  return tr("terminal:ai.permission_confirm_hint", {defaultValue:"每条命令执行前都要确认"});
}

function terminalAiReasoningLabel(value) {
  const effort = ["none", "low", "medium", "high"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "none";
  return tr(`settings:ai.reasoning_${effort}`, {defaultValue:effort});
}

function terminalAiPanelModelOptions(state) {
  const current = String(state?.model || terminalAiSettingsValue().model || "").trim();
  const availableModels = typeof terminalAiAvailableModels !== "undefined" && Array.isArray(terminalAiAvailableModels) ? terminalAiAvailableModels : [];
  const available = [...new Set([...(state?.modelCustom ? [] : [current]), ...availableModels].map(item => String(item || "").trim()).filter(Boolean))];
  const known = !state?.modelCustom && available.includes(current);
  return `<option value="" ${!current && !state?.modelCustom ? "selected" : ""}>${esc(tr("terminal:ai.model_select", {defaultValue:"选择模型"}))}</option>${available.map(model => `<option value="${escAttr(model)}" ${known && model === current ? "selected" : ""}>${esc(model)}</option>`).join("")}<option value="__custom__" ${state?.modelCustom || (!known && current) ? "selected" : ""}>${esc(tr("terminal:ai.model_custom", {defaultValue:"手动输入模型…"}))}</option>`;
}

function terminalAiStripControl(value) {
  return String(value || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function terminalAiDecodeNumericEntities(value) {
  return String(value || "").replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (full, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return full;
    try { return String.fromCodePoint(codePoint); } catch { return full; }
  });
}

function terminalAiWaitingInputCopy(state) {
  const waiting = state?.agentWaitingForInput || {};
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const block = blocks.find(item => String(item?.id || "") === String(waiting.blockId || ""));
  const output = terminalAiStripControl(block?.output || waiting.output || "").slice(-1600);
  const command = String(waiting.command || block?.command || "");
  const promptTail = output.split(/\n/).map(line => line.trim()).filter(Boolean).slice(-3).join("\n");
  const passwordPrompt = /(?:password|passphrase|pass phrase|密码|口令)/i.test(promptTail);
  const sshPrompt = /(?:yes\s*\/\s*no|fingerprint|continue\s+connecting|主机指纹|连接.*继续)/i.test(promptTail)
    || (!passwordPrompt && /(?:fingerprint|主机指纹)/i.test(output));
  const choicePrompt = /(?:\[[yYnN](?:\s*\/\s*[yYnN]){1,2}\]|\((?:y|n)(?:\s*\/\s*(?:y|n))?\)|\b(?:y\s*\/\s*n|Y\/n|y\/N)\b|(?:删除|覆盖|替换|确认|继续).{0,40}(?:[?？]|[yYnN]))/i.test(promptTail)
    || /(?:\brm(?:\s+-[^\s]*)*\b|--interactive|overwrite|delete|remove|confirm)/i.test(command);
  if (passwordPrompt) return {
    hint:tr("terminal:ai.waiting_input_password_hint", {defaultValue:"请按终端提示输入密码或口令。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_password_placeholder", {defaultValue:"输入密码或口令"})
  };
  if (sshPrompt) return {
    hint:tr("terminal:ai.waiting_input_ssh_hint", {defaultValue:"请按提示输入 yes、no 或完整主机指纹。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_ssh_placeholder", {defaultValue:"输入 yes、no 或主机指纹"})
  };
  if (choicePrompt) return {
    hint:tr("terminal:ai.waiting_input_choice_hint", {defaultValue:"请按终端提示输入 y 或 n。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_choice_placeholder", {defaultValue:"输入 y 或 n"})
  };
  return {
    hint:tr("terminal:ai.waiting_input_hint", {defaultValue:"请按终端提示输入内容。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_placeholder", {defaultValue:"输入终端所需内容"})
  };
}

function terminalAiDeduplicateRepeatedText(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  const trimmed = source.trim();
  if (!trimmed) return "";
  // Gateways occasionally replay the complete tool description once. Remove
  // only exact adjacent repeats so legitimate repeated list items and logs
  // remain untouched.
  if (trimmed.length % 2 === 0) {
    const half = trimmed.slice(0, trimmed.length / 2).trim();
    if (half && half === trimmed.slice(trimmed.length / 2).trim()) return half;
  }
  const paragraphs = trimmed.split(/\n{2,}/);
  const output = [];
  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized) continue;
    if (output.at(-1)?.trim() === normalized && normalized.length >= 24) continue;
    output.push(normalized);
  }
  return output.join("\n\n");
}

function terminalAiChatAutoContextHint() {
  return tr("terminal:ai.chat_auto_context_hint", {
    defaultValue:"请先在终端完成这项检查，然后直接再次提问；Terma 会自动读取最新终端内容并继续分析。"
  });
}

function terminalAiChatRelayRequest(value) {
  const source = String(value || "").trim();
  if (!source) return false;
  // Do not rewrite a sentence that is already explaining the read-only
  // boundary. Only target imperative requests to return terminal data.
  const prohibition = /(?:不要|无需|不会|不要求|禁止|never|don't|do not|without).{0,80}(?:发|发送|贴|粘贴|复制|提供|传|回传|send|paste|copy|share|provide|attach|post|relay).{0,80}(?:输出|结果|内容|日志|截图|output|result|log|screenshot)/i;
  const requestLead = /(?:请|需要|可以|将|把|运行后|执行后|完成后|再次|然后|之后|please|run|after|once|then|you should|you need|could you|can you|if you need)/i;
  if (prohibition.test(source) && !requestLead.test(source)) return false;
  const chineseData = /(?:输出|结果|内容|日志|运行结果|终端输出|终端上下文|终端信息|截图)/i.test(source);
  const chineseRelay = chineseData && /(?:发给我|发我|贴回|贴出来|粘贴(?:回来|到这里|给我)?|复制(?:回来|给我)?|发送(?:给我|到这里)?|提供(?:给我|回来|到这里)?|传给我|回传|附上|再次提供)/i.test(source)
    && requestLead.test(source);
  const englishData = /(?:output|result|terminal output|terminal context|terminal information|logs?|screenshots?)/i.test(source);
  const englishRelay = englishData && /(?:send|paste|copy|share|provide|attach|post|relay|return).{0,100}(?:back|to me|here|again|with me|output|result|terminal context|logs?|screenshots?)/i.test(source)
    && requestLead.test(source);
  return chineseRelay || englishRelay;
}

function terminalAiNormalizeChatAnswer(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  if (!source || !terminalAiChatRelayRequest(source)) {
    // Keep the fast path for normal answers and streaming deltas.
    return source;
  }
  // Split only at sentence punctuation/newlines so command paths, decimals,
  // and ordinary prose are preserved. A violating sentence is replaced as a
  // whole, preventing the model from asking for a manual copy/paste roundtrip.
  return source.replace(/[^\n。！？!?]+[。！？!?]?/g, segment => (
    terminalAiChatRelayRequest(segment) ? terminalAiChatAutoContextHint() : segment
  ));
}

function terminalAiNormalizeMarkdownEscapes(value) {
  let source = terminalAiDecodeNumericEntities(String(value || "").replace(/\r\n?/g, "\n"));
  if (!source) return "";

  // A few gateways drop one backtick from a fenced shell opener (` ``sh`)
  // while leaving the closing fence intact. Repair only a two-backtick opener
  // followed by a known shell language marker; ordinary inline Markdown stays
  // untouched.
  const shellLanguage = "(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?";
  source = source.replace(new RegExp("(?<!\\\\`)\\\\`\\\\`(?!\\\\`)(?=" + shellLanguage + "[ \\t]*\\n)", "gi"), "```");
  source = source.replace(new RegExp("(^|[^\\n`])([ \\t]*)``(?=" + shellLanguage + "[ \\t]*\\n)", "gmi"), "$1$2```");

  // Some gateways escape every backtick and then append the fence directly
  // after the preceding sentence (for example: "说明。\\`\\`\\`sh"). Split
  // those inline fences into real Markdown lines before the normal renderer
  // and command extractor inspect them.
  const lines = [];
  let inFence = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine
      .replace(/\\`(?:\\`){2}/g, "```")
      .replace(/\\`{3}/g, "```");
    let cursor = 0;
    let emitted = false;
    while (cursor <= line.length) {
      const fenceIndex = line.indexOf("```", cursor);
      if (fenceIndex < 0) {
        const remainder = line.slice(cursor);
        if (remainder || !emitted) lines.push(remainder);
        break;
      }
      const before = line.slice(cursor, fenceIndex);
      if (inFence) {
        if (before) lines.push(before);
        lines.push("```");
        inFence = false;
        emitted = true;
        cursor = fenceIndex + 3;
        continue;
      }
      if (before) lines.push(before);
      const info = line.slice(fenceIndex + 3).match(/^[^\s`]*/)?.[0] || "";
      lines.push("```" + info);
      inFence = true;
      emitted = true;
      cursor = fenceIndex + 3 + info.length;
    }
  }
  let mappedInFence = false;
  return lines.map(line => {
    const fenceCandidate = line.replace(/\\`/g, "`").replace(/^(\s*)\\(`{3})/, "$1$2");
    const fence = fenceCandidate.match(/^\s*```[^`]*$/);
    if (fence) {
      mappedInFence = !mappedInFence;
      return fenceCandidate;
    }
    if (mappedInFence) return line;
    // A few gateways escape Markdown punctuation before returning text. Decode
    // that compatibility layer in prose and code, while leaving shell
    // escapes such as \n, \t and \$ intact.
    let normalized = line.replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1");
    normalized = normalized.replace(/^(\s*\d+)\\\.\s+/, "$1. ");
    return normalized;
  }).join("\n");
}

function terminalAiBlockHtml(key, block, selectedId="", options={}) {
  const selected = String(selectedId || "") === String(block.id);
  const output = terminalAiStripControl(block.output).trim();
  const summary = output ? output.split("\n").map(line => line.trim()).filter(Boolean).slice(-2).join(" · ") : tr("terminal:ai.waiting_output", {defaultValue:"等待输出"});
  const completed = Boolean(block.completedAt);
  const waiting = Boolean(block.waitingForInput);
  const timedOut = Boolean(block.timedOutAt);
  const longCommand = String(block.command || "").length > 8000;
  const stateLabel = completed ? tr("terminal:ai.completed", {defaultValue:"已完成"}) : waiting ? tr("terminal:ai.waiting_input", {defaultValue:"等待终端输入"}) : timedOut ? tr("terminal:ai.timed_out", {defaultValue:"等待超时"}) : tr("terminal:ai.running", {defaultValue:"执行中"});
  const stateClass = completed ? "completed" : waiting || timedOut ? "waiting" : "running";
  const interrupt = !options.chatMode && !completed && !waiting ? `<button type="button" data-action="terminal-ai-block-stop" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}">${icon("square")}<span>${esc(tr("terminal:ai.stop_command", {defaultValue:"中止命令"}))}</span></button>` : "";
  const lengthHint = longCommand ? `<span class="terminal-ai-block-length">${esc(tr("terminal:ai.long_command_hint", {length:String(block.command || "").length, defaultValue:`命令较长 · ${String(block.command || "").length} 字符，失败时建议拆分为多个步骤`}))}</span>` : "";
  const actions = options.chatMode ? "" : `<div class="terminal-ai-block-actions"><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="explain">${icon("message-circle-more")}<span>${esc(tr("terminal:ai.explain", {defaultValue:"解释"}))}</span></button><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="summarize">${icon("list")}<span>${esc(tr("terminal:ai.summarize", {defaultValue:"总结"}))}</span></button><button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="fix">${icon("wrench")}<span>${esc(tr("terminal:ai.fix", {defaultValue:"修复建议"}))}</span></button>${completed || waiting || timedOut ? `<button type="button" data-action="terminal-ai-block-action" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" data-ai-action="continue">${icon("step-forward")}<span>${esc(tr("terminal:ai.continue", {defaultValue:"继续分析"}))}</span></button>` : ""}${interrupt}</div>`;
  return `<article class="terminal-ai-block${selected ? " selected" : ""}" data-terminal-ai-block-id="${escAttr(block.id)}"><div class="terminal-ai-block-head"><button class="terminal-ai-block-select" type="button" data-action="terminal-ai-select-block" data-terminal-ai-key="${escAttr(key)}" data-block-id="${escAttr(block.id)}" aria-pressed="${selected ? "true" : "false"}"><span class="terminal-ai-block-index">${icon("square-terminal")}</span><code title="${escAttr(block.command)}">${esc(block.command)}</code></button><span class="terminal-ai-block-state ${stateClass}">${esc(stateLabel)}</span></div><div class="terminal-ai-block-summary">${esc(summary)}</div>${lengthHint}${actions}</article>`;
}

function terminalAiTaskGroups(turns) {
  const groups = [];
  for (const turn of turns || []) {
    const current = groups.at(-1);
    const taskId = String(turn?.taskId || "");
    const sameTask = Boolean(current && taskId && current.taskId === taskId);
    if (!sameTask && (!turn.agentContinuation || !current)) groups.push({root:turn, steps:[], taskId:taskId || String(turn?.id || "")});
    groups.at(-1).steps.push(turn);
  }
  return groups;
}

function terminalAiMcpResultCardHtml(item) {
  const server = String(item?.server || "");
  const tool = String(item?.tool || "");
  const status = String(item?.status || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
  const argumentsText = JSON.stringify(item?.arguments && typeof item.arguments === "object" ? item.arguments : {}, null, 2);
  const output = String(item?.output || "").trim();
  return `<details class="terminal-ai-mcp-result-card"><summary>${icon("plug-zap")}<span>${esc(tr("terminal:ai.mcp_call_title", {tool, defaultValue:`调用工具 ${tool}`}))}</span><small>${esc(status)}</small></summary><div class="terminal-ai-mcp-result-body"><div class="terminal-ai-mcp-meta"><span>${esc(tr("terminal:ai.mcp_server", {defaultValue:"服务器"}))}</span><code>${esc(server)}</code><span>${esc(tr("terminal:ai.mcp_tool", {defaultValue:"工具"}))}</span><code>${esc(tool)}</code></div><div class="terminal-ai-mcp-section"><b>${esc(tr("terminal:ai.mcp_arguments", {defaultValue:"参数"}))}</b><pre>${esc(argumentsText)}</pre></div><details class="terminal-ai-mcp-output"><summary>${esc(tr("terminal:ai.mcp_result", {defaultValue:"结果（展开查看）"}))}</summary><pre>${esc(output || tr("terminal:ai.mcp_no_result", {defaultValue:"暂无结果"}))}</pre></details></div></details>`;
}

function terminalAiTaskMcpResults(steps) {
  const results = [];
  const keys = new Set();
  const identities = new Set();
  const add = item => {
    if (!item?.server || !item?.tool) return;
    const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
    const key = `${item.server}\u0000${item.tool}\u0000${JSON.stringify(args)}`;
    if (keys.has(key)) return;
    keys.add(key);
    identities.add(`${item.server}\u0000${item.tool}`);
    results.push({...item, arguments:args});
  };
  for (const step of steps || []) for (const item of (Array.isArray(step?.agentResults) ? step.agentResults : [])) add(item);
  for (const step of steps || []) for (const call of terminalAiResponseMcpCalls(step?.answer || "")) {
    const key = `${call.server}\u0000${call.tool}\u0000${JSON.stringify(call.arguments || {})}`;
    if (!keys.has(key)) add({kind:"mcp", server:call.server, tool:call.tool, arguments:call.arguments || {}, output:"", status:tr("terminal:ai.mcp_pending", {defaultValue:"等待调用"})});
  }
  // Older compatible models sometimes return a display-only Markdown marker
  // instead of Terma's structured MCP protocol. It must never execute. Show a
  // single explanatory card only when server/tool exactly matches the active
  // discovered catalog, and prefer any real result already recorded above.
  for (const step of steps || []) for (const marker of terminalAiResponseMcpMarkers(step?.answer || "")) {
    const identity = `${marker.server}\u0000${marker.tool}`;
    if (!identities.has(identity)) add({kind:"mcp-marker", server:marker.server, tool:marker.tool, arguments:{}, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})});
  }
  return results;
}

function terminalAiMcpResultIdentity(item) {
  const args = item?.arguments && typeof item.arguments === "object" ? item.arguments : {};
  return String(item?.server || "") + "\u0000" + String(item?.tool || "") + "\u0000" + JSON.stringify(args);
}

function terminalAiRenderAnswerWithMcp(key, answer, entries, used, options={}) {
  // Remove a protocol-only XML fence before locating the call. Otherwise the
  // opening and closing fence are handed to Markdown separately and become an
  // empty `xml` code block around the real MCP result card.
  const source = String(answer || "").replace(/```[^\n`]*\n\s*(<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>|<tool_call\b[^>]*>[\s\S]*?<\/tool_call>)\s*```/gi, "$1");
  const fragments = [];
  const pattern = /<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>|<tool_call\b[^>]*>[\s\S]*?<\/tool_call>|^[ \t]*(?:\*\*)?MCP\s*[·:]\s*[a-zA-Z0-9_-]{1,80}\s*\/\s*[a-zA-Z0-9_.:-]{1,120}(?:\*\*)?[ \t]*$/gmi;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) fragments.push(renderTerminalAiMarkdown(key, source.slice(last, match.index), options));
    const raw = match[0];
    const call = terminalAiResponseMcpCalls(raw)[0];
    const marker = terminalAiResponseMcpMarkers(raw)[0];
    const selected = call || marker;
    const matchingEntries = selected
      ? entries.filter(item => String(item?.server || "").toLowerCase() === String(selected.server || "").toLowerCase()
        && String(item?.tool || "").toLowerCase() === String(selected.tool || "").toLowerCase())
      : [];
    const selectedArguments = selected?.arguments && typeof selected.arguments === "object" ? selected.arguments : {};
    const argumentKey = JSON.stringify(selectedArguments);
    const entry = matchingEntries.find(item => JSON.stringify(item?.arguments && typeof item.arguments === "object" ? item.arguments : {}) === argumentKey
      && !used.has(terminalAiMcpResultIdentity(item)))
      || matchingEntries.find(item => !used.has(terminalAiMcpResultIdentity(item)));
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
        for (const duplicate of matchingEntries) used.add(terminalAiMcpResultIdentity(duplicate));
      }
    } else if (!selected) fragments.push(renderTerminalAiMarkdown(key, raw, options));
    last = match.index + raw.length;
  }
  if (last < source.length) fragments.push(renderTerminalAiMarkdown(key, source.slice(last), options));
  return fragments.join("");
}

function terminalAiTaskAssistantHtml(key, group) {
  const steps = Array.isArray(group?.steps) ? group.steps : [];
  const turn = steps.at(-1) || group?.root || {};
  const chatMode = steps.some(item => item?.mode === "chat");
  const usage = steps.reduce((sum, item) => {
    const current = terminalAiTurnUsage(item);
    if (!current.available) return sum;
    sum.available = true;
    sum.input += current.input;
    sum.output += current.output;
    return sum;
  }, {available:false, input:0, output:0});
  const metrics = usage.available
    ? tr("terminal:ai.turn_tokens", {input:terminalAiFormatTokens(usage.input), output:terminalAiFormatTokens(usage.output), defaultValue:`输入 ${terminalAiFormatTokens(usage.input)} · 输出 ${terminalAiFormatTokens(usage.output)} tokens`})
    : tr("terminal:ai.usage_unavailable", {defaultValue:"Token 用量未由模型返回"});
  const mcpEntries = terminalAiTaskMcpResults(steps);
  const usedMcp = new Set();
  const phases = steps.flatMap(item => {
    const rawAnswer = String(item?.answer || "");
    const answer = chatMode ? terminalAiNormalizeChatAnswer(rawAnswer) : rawAnswer;
    const itemMcpResults = (Array.isArray(item?.agentResults) ? item.agentResults : [])
      .filter(result => result?.kind === "mcp");
    const hasMcpAnchor = Boolean(
      terminalAiResponseMcpCalls(answer).length
      || terminalAiResponseMcpMarkers(answer).length
    );
    const renderUnanchoredMcp = () => itemMcpResults
      .filter(result => !usedMcp.has(terminalAiMcpResultIdentity(result)))
      .map(result => {
        usedMcp.add(terminalAiMcpResultIdentity(result));
        return terminalAiMcpResultCardHtml(result);
      }).join("");
    // Preflight calls happen before the model's continuation turn and have no
    // marker in its answer. Keep their result at the start of that phase;
    // anchored calls are inserted by terminalAiRenderAnswerWithMcp instead.
    const before = hasMcpAnchor ? "" : renderUnanchoredMcp();
    const rendered = answer ? terminalAiRenderAnswerWithMcp(key, answer, mcpEntries, usedMcp, {actions:!chatMode, copy:true}) : "";
    const after = hasMcpAnchor ? renderUnanchoredMcp() : "";
    const error = item?.error ? `<div class="terminal-ai-error">${icon("circle-alert")}<span>${esc(item.error)}</span></div>` : "";
    const streaming = item?.busy ? `<span class="terminal-ai-streaming">${esc(tr("terminal:ai.sending", {defaultValue:"正在生成…"}))}</span>` : "";
    if (!before && !rendered && !after && !error && !streaming) return [];
    return [`<div class="terminal-ai-response-phase" data-terminal-ai-phase-id="${escAttr(item.id || "")}">${before}${rendered}${after}${error}${streaming}</div>`];
  }).join("");
  const reasoningText = [...new Set(steps.map(item => String(item?.reasoning || "").trim()).filter(Boolean))].join("\n\n");
  const reasoning = reasoningText ? `<details class="terminal-ai-reasoning"><summary>${icon("brain")}<span>${esc(tr("terminal:ai.reasoning_summary", {defaultValue:"思考摘要"}))}</span></summary><div>${renderTerminalAiMarkdown(key, reasoningText, {actions:false})}</div></details>` : "";
  // A malformed or truncated answer can leave a recorded result without a
  // matching marker. Show it at the beginning of the transcript rather than
  // moving the tool call to the end of the assistant message.
  const orphanMcpCards = mcpEntries.filter(item => !usedMcp.has(terminalAiMcpResultIdentity(item))).map(terminalAiMcpResultCardHtml).join("");
  const notices = [...new Set(steps.map(item => String(item?.agentNotice || "").trim()).filter(Boolean))];
  const notice = notices.map(item => `<div class="terminal-ai-agent-notice">${icon("info")}<span>${esc(item)}</span></div>`).join("");
  const model = [...steps].reverse().find(item => item?.model)?.model || "";
  const hasAnswer = steps.some(item => String(item?.answer || "").trim());
  return `<div class="terminal-ai-task-step" data-terminal-ai-turn-id="${escAttr(turn.id || group?.root?.id || "")}"><div class="terminal-ai-assistant-message"><div class="terminal-ai-response-head"><span>${icon("bot")}<b>${esc(tr("terminal:ai.response", {defaultValue:"AI 回复"}))}</b></span><span>${esc(model)}</span></div><div class="terminal-ai-response-content">${orphanMcpCards}${phases}</div>${notice}${reasoning}<div class="terminal-ai-turn-footer"><span>${esc(metrics)}</span>${hasAnswer ? `<button type="button" data-action="terminal-ai-copy-response" data-terminal-ai-key="${escAttr(key)}" data-turn-id="${escAttr(turn.id)}" title="${escAttr(tr("terminal:ai.copy_response", {defaultValue:"复制回复"}))}" aria-label="${escAttr(tr("terminal:ai.copy_response", {defaultValue:"复制回复"}))}">${icon("copy")}</button>` : ""}</div></div></div>`;
}

function terminalAiTurnsHtml(key, turns) {
  return terminalAiTaskGroups(turns).map(group => `<article class="terminal-ai-task" data-terminal-ai-task-id="${escAttr(group.taskId || group.root.id)}"><div class="terminal-ai-user-message"><span>${esc(tr("terminal:ai.you", {defaultValue:"你"}))}</span><p>${esc(group.root.prompt)}</p></div><div class="terminal-ai-task-steps">${terminalAiTaskAssistantHtml(key, group)}</div></article>`).join("");
}

function terminalAiInlineMarkdown(value) {
  const tokens = [];
  let source = String(value || "");
  const hold = html => {
    const index = tokens.push(html) - 1;
    return `\u0001${index}\u0002`;
  };
  source = source.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  source = source.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_, label, href) => {
    try {
      const url = new URL(href);
      if (!["http:", "https:"].includes(url.protocol)) return `${label} (${href})`;
      return hold(`<a href="${escAttr(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
    } catch { return `${label} (${href})`; }
  });
  let html = esc(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/\u0001(\d+)\u0002/g, (_, index) => tokens[Number(index)] || "");
  return html;
}

function terminalAiCommandFromCodeBlock(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";
  const lines = source.split("\n");
  if (/^\s*\$\s+/.test(lines[0])) lines[0] = lines[0].replace(/^\s*\$\s+/, "");
  return terminalAiCommandText(lines.join("\n").trim());
}

function terminalAiSplitShellCommands(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const commands = [];
  let current = "";
  let quote = "";
  let escaped = false;
  const flush = () => {
    const command = current.trim().replace(/^\$\s*/, "");
    if (command) commands.push(terminalAiCommandText(command));
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\") { current += char; escaped = true; continue; }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === "\n" || char === ";" || (char === "&" && source[index + 1] === "&") || (char === "|" && source[index + 1] === "|")) {
      flush();
      if (char === "&" || char === "|") index += 1;
      continue;
    }
    current += char;
  }
  flush();
  return commands;
}

function terminalAiCommandsFromCodeBlock(value) {
  const source = terminalAiCommandFromCodeBlock(value);
  if (!source) return [];
  const lines = source.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const hasScriptSyntax = lines.some(line => /^(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function)\b/.test(line)
    || /(?:&&|\|\||[|;&<>]|\$\(|`|\\\s*$)/.test(line));
  // Keep a real script together, but retain the established UX for a block
  // that is plainly just several independent one-line commands.
  return lines.length > 1 && !hasScriptSyntax
    ? lines.map(line => terminalAiCommandText(line))
    : [source];
}

function terminalAiCommandSyntaxIssue(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  // `find` groups must escape parentheses for POSIX shells. Models often
  // emit `find ... -type f ( -name ... )`, which makes bash exit with code 2
  // before the Agent can inspect any result.
  if (/^find(?:\s|$)/i.test(source)
    && /\s\(\s*-(?:name|iname|path|type)\b/i.test(source)
    && !/\\\(\s*-(?:name|iname|path|type)\b/i.test(source)) {
    return tr("terminal:ai.command_syntax_find", {defaultValue:"find 条件分组缺少转义括号，命令未发送；请改为使用 \\( 和 \\)"});
  }
  // Bash treats a printf format beginning with `-` as an option unless the
  // `--` separator is present. Reject the common generated form before it can
  // terminate an otherwise valid diagnostic script with exit code 2.
  if (/(?:^|[;|&\n])\s*printf\s+(?!--|-(?:v\b|\s))(['"])-/m.test(source)) {
    return tr("terminal:ai.command_syntax_printf", {defaultValue:"printf 格式字符串以 - 开头，命令未发送；请改为使用 printf -- '--- ...' 或 printf '%s\\n' '--- ...'"});
  }
  return "";
}

function terminalAiDecodeXmlText(value) {
  return String(value || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (full, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return full;
      try { return String.fromCodePoint(codePoint); } catch { return full; }
    });
}

function terminalAiToolCallParameters(value) {
  const parameters = {};
  const pattern = /<parameter(?:=([a-z0-9_-]+)|\s+name\s*=\s*["']?([a-z0-9_-]+)["']?)\s*>([\s\S]*?)<\/parameter>/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const name = String(match[1] || match[2] || "").toLowerCase();
    if (name) parameters[name] = terminalAiDecodeXmlText(match[3]).trim();
  }
  return parameters;
}

function terminalAiParseToolCall(value) {
  const source = String(value || "");
  const functionMatch = source.match(/<function\s*=\s*([a-z0-9_-]+)\s*>/i)
    || source.match(/<function[^>]*>\s*([a-z0-9_-]+)\s*<\/function>/i);
  const functionName = String(functionMatch?.[1] || "").toLowerCase();
  // Some OpenAI-compatible models ignore the requested fenced-shell format
  // and emit their native terminal tool name instead. Keep this allowlist
  // narrow: execution still goes through Terma's normal risk and permission
  // checks, while arbitrary provider function names remain inert.
  if (!["terminal", "exec_command", "shell"].includes(functionName)) return null;
  const parameters = terminalAiToolCallParameters(source);
  const action = String(parameters.action || "").toLowerCase();
  const command = terminalAiCommandFromCodeBlock(parameters.command || "");
  if ((action && !["execute", "run"].includes(action)) || !command) return null;
  return {command, description:String(parameters.description || "").trim().slice(0, 300)};
}

function terminalAiToolCalls(value) {
  const calls = [];
  const source = String(value || "");
  const wrapped = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = wrapped.exec(source))) {
    const call = terminalAiParseToolCall(match[1]);
    if (call && !calls.some(item => item.command === call.command)) calls.push(call);
  }
  const loose = /<function\s*=\s*(?:terminal|exec_command|shell)\s*>([\s\S]*?)<\/function>/gi;
  while ((match = loose.exec(source))) {
    const call = terminalAiParseToolCall(match[0]);
    if (call && !calls.some(item => item.command === call.command)) calls.push(call);
  }
  return calls;
}

function terminalAiResponseMcpCalls(value) {
  const calls = [];
  const pattern = /<mcp_call\b([^>]*)>([\s\S]*?)<\/mcp_call>/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const attributes = match[1] || "";
    const server = terminalAiDecodeXmlText(attributes.match(/\bserver\s*=\s*["']([^"']+)["']/i)?.[1] || "").trim();
    const tool = terminalAiDecodeXmlText(attributes.match(/\btool\s*=\s*["']([^"']+)["']/i)?.[1] || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(server) || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(tool)) continue;
    let argumentsValue = {};
    try { argumentsValue = JSON.parse(terminalAiDecodeXmlText(match[2]).trim() || "{}"); } catch { continue; }
    if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) continue;
    const key = `${server}\u0000${tool}\u0000${JSON.stringify(argumentsValue)}`;
    if (!calls.some(item => item.key === key)) calls.push({key, server, tool, arguments:argumentsValue, index:match.index});
  }
  // A number of OpenAI-compatible models emit their native XML or JSON
  // function wrapper even when the prompt asks for Terma's explicit
  // <mcp_call> block. Accept it only when the function name uniquely matches
  // a discovered, enabled MCP tool; arbitrary provider functions stay inert.
  const catalog = typeof terminalAiMcpCatalogCache !== "undefined" && Array.isArray(terminalAiMcpCatalogCache.tools) ? terminalAiMcpCatalogCache.tools : [];
  const addCatalogCall = (selected, argumentsValue, index) => {
    if (!selected || !argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return;
    const key = `${selected.server_id}\u0000${selected.name}\u0000${JSON.stringify(argumentsValue)}`;
    if (!calls.some(item => item.key === key)) calls.push({key, server:String(selected.server_id), tool:String(selected.name), arguments:argumentsValue, index});
  };
  const wrapped = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  while ((match = wrapped.exec(String(value || "")))) {
    const body = terminalAiDecodeXmlText(match[1] || "").trim();
    let jsonCall = null;
    try { jsonCall = JSON.parse(body); } catch {}
    if (jsonCall && typeof jsonCall === "object" && !Array.isArray(jsonCall)) {
      const callName = String(jsonCall.name || jsonCall.function || "");
      let jsonArguments = jsonCall.arguments;
      if (typeof jsonArguments === "string") {
        try { jsonArguments = JSON.parse(jsonArguments); } catch { jsonArguments = {}; }
      }
      jsonArguments = jsonArguments && typeof jsonArguments === "object" && !Array.isArray(jsonArguments) ? {...jsonArguments} : {};
      let selected = null;
      if (callName.toLowerCase() === "mcp_call") {
        const serverRef = String(jsonArguments.server || "");
        const toolRef = String(jsonArguments.tool || "");
        selected = catalog.find(tool => `${tool.server_id}.${tool.name}`.toLowerCase() === serverRef.toLowerCase())
          || catalog.find(tool => String(tool.server_id).toLowerCase() === serverRef.toLowerCase() && String(tool.name).toLowerCase() === toolRef.toLowerCase());
        delete jsonArguments.server;
        delete jsonArguments.tool;
        if (jsonArguments.arguments && typeof jsonArguments.arguments === "object" && !Array.isArray(jsonArguments.arguments)) jsonArguments = jsonArguments.arguments;
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
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const rawParameters = terminalAiToolCallParameters(body);
    const argumentsValue = {};
    for (const [name, raw] of Object.entries(rawParameters)) {
      const definition = properties[name] && typeof properties[name] === "object" ? properties[name] : {};
      if (["number", "integer", "boolean", "array", "object"].includes(definition.type)) {
        try { argumentsValue[name] = JSON.parse(raw); } catch { argumentsValue[name] = raw; }
      } else argumentsValue[name] = raw;
    }
    addCatalogCall(selected, argumentsValue, match.index);
  }
  return calls;
}

function terminalAiResponseMcpMarkers(value) {
  const catalog = typeof terminalAiMcpCatalogCache !== "undefined" && Array.isArray(terminalAiMcpCatalogCache.tools)
    ? terminalAiMcpCatalogCache.tools
    : [];
  if (!catalog.length) return [];
  const markers = [];
  const pattern = /^[ \t]*(?:\*\*)?MCP\s*[·:]\s*([a-zA-Z0-9_-]{1,80})\s*\/\s*([a-zA-Z0-9_.:-]{1,120})(?:\*\*)?[ \t]*$/gmi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const server = String(match[1] || "");
    const tool = String(match[2] || "");
    const selected = catalog.find(item => item?.enabled !== false
      && String(item?.server_id || "").toLowerCase() === server.toLowerCase()
      && String(item?.name || "").toLowerCase() === tool.toLowerCase());
    if (!selected) continue;
    const key = `${selected.server_id}\u0000${selected.name}`;
    if (!markers.some(item => item.key === key)) markers.push({key, server:String(selected.server_id), tool:String(selected.name), index:match.index});
  }
  return markers;
}

function terminalAiUnsupportedToolName(value) {
  const source = String(value || "");
  const functionName = source.match(/<function\s*=\s*([a-z0-9_.:-]+)/i)?.[1]
    || source.match(/"(?:name|function)"\s*:\s*"([^"]+)"/i)?.[1]
    || source.match(/<mcp_call\b[^>]*\btool\s*=\s*["']([^"']+)/i)?.[1]
    || "unknown";
  return String(functionName).slice(0, 120);
}

function terminalAiUnsupportedToolMessage(value) {
  const name = terminalAiUnsupportedToolName(value);
  return tr("terminal:ai.unsupported_tool_detail", {
    name,
    defaultValue:`未执行工具调用：${name}。原因：该工具未匹配已发现且启用的 Terma 工具，或参数格式不合法。请重新发现并启用对应 MCP 工具，或切换兼容模型后重试。`
  });
}

function terminalAiNormalizeToolCalls(value) {
  const source = String(value || "");
  const renderCall = (full, body) => {
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

function terminalAiCodeBlockHtml(key, code, language="", options={}) {
  const normalizedLanguage = String(language || "").toLowerCase();
  const shell = !normalizedLanguage || ["shell", "bash", "sh", "zsh", "console", "powershell", "pwsh", "cmd"].includes(normalizedLanguage);
  const command = shell ? terminalAiCommandFromCodeBlock(code) : "";
  const snippetCommand = shell ? terminalAiCommandText(String(code || "").replace(/\r\n?/g, "\n").trim()) : "";
  const state = terminalAiStateForKey(key);
  const actionButtons = [];
  const showActions = options.actions !== false;
  const showCopy = options.copy === true || showActions;
  if (showCopy) actionButtons.push(`<button type="button" data-action="terminal-ai-copy-code" data-code="${escAttr(code)}">${icon("copy")}<span>${esc(tr("terminal:ai.copy_command", {defaultValue:"复制"}))}</span></button>`);
  if (showActions) {
    if (command) actionButtons.push(`<button type="button" data-action="terminal-ai-insert-command" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(command)}">${icon("arrow-down-to-line")}<span>${esc(tr("terminal:ai.insert_command", {defaultValue:"放入终端"}))}</span></button>${state.permission !== "suggest" ? `<button type="button" class="primary" data-action="terminal-ai-execute-command" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(command)}">${icon("play")}<span>${esc(tr("terminal:ai.execute_command", {defaultValue:"执行"}))}</span></button>` : ""}`);
    if (snippetCommand) actionButtons.push(`<button type="button" data-action="terminal-ai-save-snippet" data-terminal-ai-key="${escAttr(key)}" data-command="${escAttr(snippetCommand)}">${icon("bookmark-plus")}<span>${esc(tr("terminal:ai.save_as_snippet", {defaultValue:"保存为命令片段"}))}</span></button>`);
  }
  const actions = actionButtons.length ? `<div class="terminal-ai-code-actions">${actionButtons.join("")}</div>` : "";
  return `<div class="terminal-ai-code-block"><div class="terminal-ai-code-head"><span>${esc(language || (shell ? "shell" : "code"))}</span></div><pre class="terminal-ai-code"><code>${esc(code)}</code></pre>${actions}</div>`;
}

function renderTerminalAiMarkdown(key, value, options={}) {
  // Protocol-only fences can arrive as an empty XML block after a gateway
  // strips the MCP payload. Remove them before line parsing so the transcript
  // never shows a blank code panel above the real tool card.
  const normalizedValue = terminalAiDeduplicateRepeatedText(terminalAiNormalizeToolCalls(terminalAiNormalizeMarkdownEscapes(value)))
    .replace(/```[^\n`]*\n\s*```/g, "\n");
  const lines = normalizedValue.split("\n");
  const html = [];
  let paragraph = [];
  let list = "";
  let listItems = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(terminalAiInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<${list}>${listItems.map(item => `<li>${terminalAiInlineMarkdown(item)}</li>`).join("")}</${list}>`);
    list = "";
    listItems = [];
  };
  const splitTableRow = line => {
    const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let current = "";
    let escaped = false;
    for (const char of source) {
      if (escaped) { current += char; escaped = false; continue; }
      if (char === "\\") { current += char; escaped = true; continue; }
      if (char === "|") { cells.push(current.trim()); current = ""; continue; }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  const isTableDivider = line => splitTableRow(line).length > 0 && splitTableRow(line).every(cell => /^:?-{3,}:?$/.test(cell));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([^\s`]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) { code.push(lines[index]); index += 1; }
      html.push(terminalAiCodeBlockHtml(key, code.join("\n"), fence[1], options));
      continue;
    }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      const divider = splitTableRow(lines[index + 1]);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      const align = divider.map(cell => /^:\-+\:$/.test(cell) ? "center" : /^:/.test(cell) ? "left" : /:$/.test(cell) ? "right" : "");
      const cellHtml = (cell, tag, cellIndex) => {
        const style = align[cellIndex] ? ` style="text-align:${align[cellIndex]}"` : "";
        return `<${tag}${style}>${terminalAiInlineMarkdown(cell || "")}</${tag}>`;
      };
      html.push(`<div class="terminal-ai-table-wrap"><table class="terminal-ai-table"><thead><tr>${headers.map((cell, cellIndex) => cellHtml(cell, "th", cellIndex)).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cellIndex) => cellHtml(row[cellIndex] || "", "td", cellIndex)).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const standaloneCommand = terminalAiStandaloneCommandFromLine(line, options);
    if (standaloneCommand) {
      flushParagraph();
      flushList();
      html.push(terminalAiCodeBlockHtml(key, standaloneCommand, "shell", {...options, copy:true}));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); html.push(`<h${heading[1].length + 2}>${terminalAiInlineMarkdown(heading[2])}</h${heading[1].length + 2}>`); continue; }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const nextList = ordered ? "ol" : "ul";
      if (list && list !== nextList) flushList();
      list = nextList;
      listItems.push((ordered || unordered)[1]);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); flushList(); html.push(`<blockquote>${terminalAiInlineMarkdown(quote[1])}</blockquote>`); continue; }
    if (/^\s*(?:---+|___+)\s*$/.test(line)) { flushParagraph(); flushList(); html.push("<hr>"); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return html.join("");
}

function terminalAiShellCommandLooksComplete(value) {
  const source = String(value || "").trim();
  if (!source || /(?:&&|\|\||\||\\|(?:\d*>>?|<)\s*\/?)\s*$/.test(source)) return false;
  let quote = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
  }
  return !quote && !escaped;
}

function terminalAiIncompleteResponseCommand(value) {
  const source = String(value || "");
  const candidates = [];
  const fencePattern = /```(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?\s*\n/gi;
  let fence;
  while ((fence = fencePattern.exec(source))) {
    const tail = source.slice(fencePattern.lastIndex);
    if (!tail.includes("```")) candidates.push({index:fence.index, command:terminalAiCommandFromCodeBlock(tail)});
  }
  const commandStart = source.toLowerCase().lastIndexOf("<command");
  if (commandStart >= 0) {
    const bodyStart = source.indexOf(">", commandStart);
    const tail = bodyStart >= 0 ? source.slice(bodyStart + 1) : "";
    if (bodyStart >= 0 && !tail.toLowerCase().includes("</command>")) candidates.push({index:commandStart, command:terminalAiCommandFromCodeBlock(terminalAiDecodeXmlText(tail))});
  }
  const lower = source.toLowerCase();
  const terminalFunctionStart = ["<function=terminal>", "<function=exec_command>", "<function=shell>"]
    .reduce((latest, marker) => Math.max(latest, lower.lastIndexOf(marker)), -1);
  const commandParameterStart = lower.lastIndexOf("<parameter=command>");
  if (terminalFunctionStart >= 0 && commandParameterStart > terminalFunctionStart && !lower.slice(terminalFunctionStart).includes("</function>")) {
    const bodyStart = commandParameterStart + "<parameter=command>".length;
    const body = source.slice(bodyStart).split(/<\/parameter>/i)[0];
    candidates.push({index:commandParameterStart, command:terminalAiCommandFromCodeBlock(terminalAiDecodeXmlText(body))});
  }
  const candidate = candidates.filter(item => terminalAiShellCommandLooksComplete(item.command)).sort((left, right) => right.index - left.index)[0];
  return candidate?.command || "";
}

function terminalAiResponseCommands(value, options={}) {
  const commands = [];
  const rawCommand = command => addCommands(terminalAiDecodeXmlText(command));
  const addCommands = source => {
    for (const command of terminalAiCommandsFromCodeBlock(source)) {
      if (command && !commands.includes(command)) commands.push(command);
    }
  };
  const normalizedValue = terminalAiNormalizeMarkdownEscapes(value);
  terminalAiToolCalls(normalizedValue).forEach(item => addCommands(item.command));
  const xmlPattern = /<command(?:\s[^>]*)?>([\s\S]*?)<\/command>/gi;
  let xmlMatch;
  while ((xmlMatch = xmlPattern.exec(normalizedValue))) rawCommand(xmlMatch[1]);
  const pattern = /```(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?\s*\n([\s\S]*?)```/gi;
  let match;
  while ((match = pattern.exec(normalizedValue))) {
    addCommands(match[1]);
  }
  if (!commands.length && options.allowIncomplete === true) {
    const recovered = terminalAiIncompleteResponseCommand(normalizedValue);
    if (recovered) commands.push(recovered);
  }
  return commands;
}

function terminalAiCompleteRecoveredCommandAnswer(value, command) {
  const source = terminalAiNormalizeMarkdownEscapes(value);
  const fencePattern = /```(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?\s*\n/gi;
  let lastFence = null;
  let match;
  while ((match = fencePattern.exec(source))) lastFence = {bodyStart:fencePattern.lastIndex};
  if (lastFence && !source.slice(lastFence.bodyStart).includes("```")) return `${source.replace(/\s+$/, "")}\n\`\`\``;
  const visible = terminalAiNormalizeToolCalls(source).trim();
  if (terminalAiResponseCommands(visible).includes(String(command || "").trim())) return visible;
  return `${visible ? `${visible}\n\n` : ""}\`\`\`shell\n${String(command || "").trim()}\n\`\`\``;
}

function terminalAiAnswerThroughFirstCommand(value) {
  const source = terminalAiNormalizeMarkdownEscapes(value);
  const matches = [];
  const patterns = [
    /<command(?:\s[^>]*)?>[\s\S]*?<\/command>/i,
    /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/i,
    /<mcp_call\b[^>]*>[\s\S]*?<\/mcp_call>/i,
    /```(?:shell|bash|sh|zsh|console|powershell|pwsh|cmd)?\s*\n[\s\S]*?```/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) matches.push({index:match.index, end:match.index + match[0].length});
  }
  if (!matches.length) return source;
  matches.sort((left, right) => left.index - right.index);
  return source.slice(0, matches[0].end);
}

function terminalAiCurrentBufferText(session) {
  if (session?.sensitiveInput) return "";
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return "";
  const length = Math.max(0, Number(buffer.length) || 0);
  const start = Math.max(0, length - TERMINAL_AI_SCREEN_MAX_LINES);
  const lines = [];
  for (let index = start; index < length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  let text = lines.join("\n").replace(/\s+$/, "");
  if (text.length > TERMINAL_AI_SCREEN_MAX_CHARS) {
    text = `[... ${tr("terminal:ai.current_context_older", {defaultValue:"更早的终端内容已省略"})} ...]\n${text.slice(-TERMINAL_AI_SCREEN_MAX_CHARS)}`;
  }
  return terminalAiRedactAttachment(text);
}

function terminalAiContextForKey(key, modeOverride="") {
  const state = terminalAiStateForKey(key);
  const session = terminalSessions.get(key);
  const selected = session?.term?.getSelection?.().trim() || "";
  const contexts = [];
  if (selected) contexts.push({source:"terminal-selection", title:tr("terminal:ai.selected_context", {defaultValue:"已选终端内容"}), text:terminalAiRedactAttachment(selected)});
  const screenText = (modeOverride === "chat" || state.mode === "chat") ? terminalAiCurrentBufferText(session) : "";
  if (screenText) contexts.push({source:"terminal-screen", title:tr("terminal:ai.current_context", {defaultValue:"当前终端内容"}), text:screenText});
  const block = state.blocks.find(item => String(item.id) === String(state.selectedBlockId));
  if (block && !selected && !screenText) contexts.push({source:"terminal-block", title:block.command, text:`$ ${block.command}\n${terminalAiStripControl(block.output || "")}`});
  contexts.push(...(state.attachments || []).map(item => ({source:"attachment", title:item.name, text:item.text})));
  return contexts.slice(0, 8);
}

function terminalAiRedactAttachment(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/(authorization)\s*[:=]\s*[^\r\n]*/gi, "$1: [REDACTED]")
    .replace(/(password|passwd|passphrase|token|secret|api[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(ssh-(?:rsa|ed25519|ecdsa)|-----BEGIN)[^\r\n]*/gi, "[REDACTED KEY]")
    .slice(0, 120000);
}

async function addTerminalAiAttachments(key, files) {
  const state = terminalAiStateForKey(key);
  for (const file of Array.from(files || []).slice(0, 8 - state.attachments.length)) {
    try {
      const text = terminalAiRedactAttachment(await file.text());
      if (text.trim()) state.attachments.push({name:String(file.name || "attachment").slice(0, 160), text});
    } catch {}
  }
  renderTerminalAiPanel(key);
}
