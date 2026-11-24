import {translate as tr} from '../../shared/i18n/runtime';
import {terminalAiNormalizeMarkdownEscapes,terminalAiDecodeXmlText} from './response-text';
const TERMINAL_AI_COMMAND_MAX_LENGTH=100000;
const TERMINAL_AI_INLINE_COMMAND_NAMES = new Set([
  "apt", "apt-get", "awk", "bash", "cat", "cd", "chmod", "chown", "clear", "command", "cp", "curl",
  "date", "df", "du", "docker", "echo", "env", "export", "file", "find", "findmnt", "free", "git",
  "grep", "head", "history", "hostname", "id", "ip", "journalctl", "kill", "killall", "less", "ln",
  "ls", "lsof", "mkdir", "mount", "mv", "node", "npm", "passwd", "ping", "podman", "printf", "ps",
  "pwd", "python", "python3", "read", "rm", "screen", "sed", "seq", "sh", "sleep", "sort", "ss",
  "stat", "systemctl", "tail", "tar", "test", "tmux", "top", "touch", "uname", "uptime", "wc", "wget",
  "which", "whoami", "xargs", "yarn", "yum", "zsh"
]);

export function terminalAiCommandText(value:unknown) {
  return String(value || "").slice(0, TERMINAL_AI_COMMAND_MAX_LENGTH);
}

export function terminalAiStandaloneCommandFromLine(value:unknown, options:{copy?:boolean}={}) {
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
  if (!terminalAiShellCommandLooksComplete(command)) return "";
  return terminalAiCommandText(command);
}

export function terminalAiCommandFromCodeBlock(value:unknown) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";
  const lines = source.split("\n");
  if (/^\s*\$\s+/.test(lines[0])) lines[0] = lines[0].replace(/^\s*\$\s+/, "");
  return terminalAiCommandText(lines.join("\n").trim());
}

export function terminalAiSplitShellCommands(value:unknown) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const commands: string[] = [];
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

export function terminalAiCommandsFromCodeBlock(value:unknown) {
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

export function terminalAiCommandSyntaxIssue(value:unknown) {
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

export function terminalAiShellCommandLooksComplete(value:unknown) {
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

export function terminalAiIncompleteResponseCommand(value:unknown) {
  const source = String(value || "");
  const candidates: {index:number;command:string}[] = [];
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

export function terminalAiResponseCommands(value:unknown, options:{allowIncomplete?:boolean}={}) {
  const commands: string[] = [];
  const rawCommand = (command:unknown) => addCommands(terminalAiDecodeXmlText(command));
  const addCommands = (source:unknown) => {
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

export function terminalAiAnswerThroughFirstCommand(value:unknown) {
  const source = terminalAiNormalizeMarkdownEscapes(value);
  const matches: {index:number;end:number}[] = [];
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

export function terminalAiToolCallParameters(value:unknown) {
  const parameters: Record<string,string> = {};
  const pattern = /<parameter(?:=([a-z0-9_-]+)|\s+name\s*=\s*["']?([a-z0-9_-]+)["']?)\s*>([\s\S]*?)<\/parameter>/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const name = String(match[1] || match[2] || "").toLowerCase();
    if (name) parameters[name] = terminalAiDecodeXmlText(match[3]).trim();
  }
  return parameters;
}

export function terminalAiParseToolCall(value:unknown) {
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

export function terminalAiToolCalls(value:unknown) {
  const calls: {command:string;description:string}[] = [];
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
