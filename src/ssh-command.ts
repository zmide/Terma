const { DEFAULT_EXTRA_ARGS }: { DEFAULT_EXTRA_ARGS: string } = require("./config");

const ALLOWED_OPENSSH_OPTIONS = new Set([
  "addressfamily",
  "ciphers",
  "compression",
  "connecttimeout",
  "hostkeyalgorithms",
  "ipqos",
  "kexalgorithms",
  "loglevel",
  "macs",
  "obscurekeystroketiming",
  "passwordauthentication",
  "preferredauthentications",
  "pubkeyacceptedalgorithms",
  "pubkeyauthentication",
  "rekeylimit",
  "requiredrsasize",
  "serveralivecountmax",
  "serveraliveinterval",
  "tcpkeepalive",
  "warnweakcrypto"
]);
const ALLOWED_OPENSSH_SHORT_FLAGS = new Set(["4", "6", "C", "q", "v"]);
const ALLOWED_OPENSSH_SHORT_OPTIONS_WITH_ARGUMENT = new Set(["c", "m"]);

const STRUCTURED_OPENSSH_OPTIONS: Record<string, {label:string, field:string, format?:(value: unknown) => string}> = {
  connecttimeout:{label:"连接超时（秒）", field:"connect_timeout_seconds"},
  serveraliveinterval:{label:"保活间隔（秒）", field:"keepalive_interval_seconds"},
  serveralivecountmax:{label:"连续无响应次数", field:"keepalive_count_max"},
  tcpkeepalive:{
    label:"TCP KeepAlive",
    field:"tcp_keepalive",
    format:value => Number(value) ? "开启" : "关闭"
  }
};

export interface ExtraArgsInspectionContext {
  connect_timeout_seconds?: unknown;
  keepalive_interval_seconds?: unknown;
  keepalive_count_max?: unknown;
  tcp_keepalive?: unknown;
}

export interface ExtraArgsIssue {
  severity:"error" | "warning";
  code:string;
  line:number;
  column:number;
  start:number;
  end:number;
  token:string;
  option:string;
  message:string;
  suggestion:string;
}

interface ExtraArgToken {
  value:string;
  start:number;
  end:number;
  line:number;
  column:number;
}

function issue(
  severity:ExtraArgsIssue["severity"],
  code:string,
  token:Partial<ExtraArgToken> = {},
  details:Partial<ExtraArgsIssue> = {}
): ExtraArgsIssue {
  return {
    severity,
    code,
    line:Number(token.line || details.line || 1),
    column:Number(token.column || details.column || 1),
    start:Number(token.start ?? details.start ?? 0),
    end:Number(token.end ?? details.end ?? token.start ?? details.start ?? 0),
    token:String(token.value ?? details.token ?? ""),
    option:String(details.option || ""),
    message:String(details.message || "SSH 附加参数无效"),
    suggestion:String(details.suggestion || "")
  };
}

function tokenizeExtraArgs(value: unknown) {
  const text = String(value || "");
  const tokens:ExtraArgToken[] = [];
  const issues:ExtraArgsIssue[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let current = "";
  let start = -1;
  let startLine = 1;
  let startColumn = 1;
  let quote = "";

  const begin = () => {
    if (start >= 0) return;
    start = index;
    startLine = line;
    startColumn = column;
  };
  const finish = (end=index) => {
    if (start < 0) return;
    tokens.push({value:current, start, end, line:startLine, column:startColumn});
    current = "";
    start = -1;
  };
  const advance = (character:string) => {
    index += 1;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
  };

  while (index < text.length) {
    const character = text[index];
    const code = character.charCodeAt(0);
    if ((code < 32 && character !== "\t" && character !== "\r" && character !== "\n") || code === 127) {
      begin();
      issues.push(issue("error", "SSH_EXTRA_ARGS_CONTROL_CHARACTER", {
        value:character,
        start:index,
        end:index + 1,
        line,
        column
      }, {
        message:"包含不可见控制字符",
        suggestion:"删除该字符；换行和 Tab 可以正常用于排版。"
      }));
      advance(character);
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (quote) {
        issues.push(issue("error", "SSH_EXTRA_ARGS_QUOTE_SPANS_LINES", {
          value:text.slice(start, index),
          start,
          end:index,
          line:startLine,
          column:startColumn
        }, {
          message:"引号内容不能跨行",
          suggestion:`请在第 ${startLine} 行结束 ${quote} 引号，或把参数值写在同一行。`
        }));
        quote = "";
      }
      finish(index);
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (!quote && /\s/.test(character)) {
      finish(index);
      advance(character);
      continue;
    }
    begin();
    if (character === "\\" && (text[index + 1] === "\"" || text[index + 1] === "'" || text[index + 1] === "\\")) {
      const next = text[index + 1];
      current += next;
      advance(character);
      advance(next);
      continue;
    }
    if (character === "\"" || character === "'") {
      if (!quote) quote = character;
      else if (quote === character) quote = "";
      else current += character;
      advance(character);
      continue;
    }
    current += character;
    advance(character);
  }
  if (quote) {
    issues.push(issue("error", "SSH_EXTRA_ARGS_UNCLOSED_QUOTE", {
      value:text.slice(start),
      start,
      end:text.length,
      line:startLine,
      column:startColumn
    }, {
      message:`缺少结束的 ${quote} 引号`,
      suggestion:"补全引号，或删除不需要的引号。"
    }));
  }
  finish(text.length);
  return {text, tokens, issues};
}

export function splitArgs(text: unknown): string[] {
  return tokenizeExtraArgs(text).tokens.map(token => token.value);
}

function openSshOptionName(value: unknown): string {
  return String(value || "").trim().split(/[=\s]/, 1)[0].toLowerCase();
}

function parsedOpenSshOption(value: unknown) {
  const option = String(value || "").trim();
  const rawName = String(option.split(/[=\s]/, 1)[0] || "");
  const name = rawName.toLowerCase();
  const remainder = option.slice(rawName.length).trim();
  const optionValue = remainder.startsWith("=") ? remainder.slice(1).trim() : remainder;
  return {name, rawName, value:optionValue};
}

function structuredOptionWarning(name:string, token:ExtraArgToken, context:ExtraArgsInspectionContext) {
  const meta = STRUCTURED_OPENSSH_OPTIONS[name];
  if (!meta) return null;
  const current = context[meta.field as keyof ExtraArgsInspectionContext];
  const currentText = current === undefined || current === null || current === ""
    ? ""
    : `（当前：${meta.format ? meta.format(current) : String(current)}）`;
  return issue("warning", "SSH_EXTRA_ARGS_DUPLICATES_STRUCTURED_FIELD", token, {
    option:meta.label,
    message:`与上方“${meta.label}”设置重复${currentText}`,
    suggestion:"删除这一项并使用上方结构化设置，避免两处数值不一致。"
  });
}

function inspectOpenSshOption(
  optionToken:ExtraArgToken,
  issueToken:ExtraArgToken,
  context:ExtraArgsInspectionContext,
  issues:ExtraArgsIssue[]
) {
  const parsed = parsedOpenSshOption(optionToken.value);
  const rangeToken = {...issueToken, end:optionToken.end, value:optionToken.value};
  if (!parsed.name || !parsed.value) {
    issues.push(issue("error", "SSH_EXTRA_ARGS_MISSING_OPTION_VALUE", rangeToken, {
      option:parsed.rawName || "-o",
      message:"-o 缺少选项名称或参数值",
      suggestion:"使用 -o Option=value，例如 -o Compression=yes。"
    }));
    return;
  }
  if (parsed.name === "stricthostkeychecking") {
    issues.push(issue("error", "SSH_EXTRA_ARGS_HOST_TRUST_MANAGED", rangeToken, {
      option:parsed.rawName,
      message:"SSH 主机指纹信任由 Terma 管理，不能在附加参数中覆盖",
      suggestion:"删除这一项；首次连接时在 Terma 的指纹确认窗口中选择仅本次信任或信任并保存。"
    }));
    return;
  }
  if (!ALLOWED_OPENSSH_OPTIONS.has(parsed.name)) {
    issues.push(issue("error", "SSH_EXTRA_ARGS_OPTION_NOT_ALLOWED", rangeToken, {
      option:parsed.rawName,
      message:`不允许使用 OpenSSH 选项 ${parsed.rawName}`,
      suggestion:"这里只能填写算法、压缩、超时等连接调优项；主机、凭据、转发和本机能力请使用 Terma 的对应设置。"
    }));
    return;
  }
  const warning = structuredOptionWarning(parsed.name, rangeToken, context);
  if (warning) issues.push(warning);
}

export function inspectExtraArgs(text: unknown, context:ExtraArgsInspectionContext = {}) {
  const parsed = tokenizeExtraArgs(text);
  const issues = [...parsed.issues];
  const args = parsed.tokens.map(token => token.value);
  for (let index = 0; index < parsed.tokens.length; index += 1) {
    const token = parsed.tokens[index];
    const value = token.value;
    if (!value.startsWith("-") || value === "-" || value === "--" || value.startsWith("--")) {
      issues.push(issue("error", "SSH_EXTRA_ARGS_POSITIONAL_TOKEN", token, {
        message:`不能包含主机、命令或其他位置参数：${value || "(空)"}`,
        suggestion:"每一项都必须是允许的 OpenSSH 调优选项；删除独立主机名、命令和 --。"
      }));
      continue;
    }
    if (value === "-o") {
      const optionToken = parsed.tokens[index + 1];
      if (!optionToken) {
        issues.push(issue("error", "SSH_EXTRA_ARGS_MISSING_ARGUMENT", token, {
          option:"-o",
          message:"-o 缺少参数值",
          suggestion:"在 -o 后填写 Option=value。"
        }));
      } else {
        inspectOpenSshOption(optionToken, token, context, issues);
        index += 1;
      }
      continue;
    }
    if (value.startsWith("-o")) {
      inspectOpenSshOption({...token, value:value.slice(2)}, token, context, issues);
      continue;
    }
    const option = value.slice(1, 2);
    if (ALLOWED_OPENSSH_SHORT_OPTIONS_WITH_ARGUMENT.has(option)) {
      if (value.length === 2) {
        const argument = parsed.tokens[index + 1];
        if (!argument) {
          issues.push(issue("error", "SSH_EXTRA_ARGS_MISSING_ARGUMENT", token, {
            option:`-${option}`,
            message:`-${option} 缺少参数值`,
            suggestion:`请在 -${option} 后填写算法列表。`
          }));
        } else index += 1;
      }
      continue;
    }
    if ([...value.slice(1)].every(item => ALLOWED_OPENSSH_SHORT_FLAGS.has(item))) continue;
    issues.push(issue("error", "SSH_EXTRA_ARGS_SHORT_OPTION_NOT_ALLOWED", token, {
      option:value,
      message:`不允许使用短选项 ${value}`,
      suggestion:"请删除该选项，或使用连接设置中已经提供的对应功能。"
    }));
  }
  issues.sort((left, right) => left.start - right.start || (left.severity === "error" ? -1 : 1));
  return {ok:!issues.some(item => item.severity === "error"), args, issues};
}

function extraArgsError(issues:ExtraArgsIssue[]) {
  const errors = issues.filter(item => item.severity === "error");
  const rendered = issues.map(item => {
    const label = item.option || item.token || "附加参数";
    const prefix = item.severity === "warning" ? "提醒" : "问题";
    return `第 ${item.line} 行 · ${label}（${prefix}）：${item.message}${item.suggestion ? `；建议：${item.suggestion}` : ""}`;
  });
  const error:any = new Error(`SSH 附加参数有 ${errors.length} 处需要修正：\n${rendered.join("\n")}`);
  error.code = "SSH_EXTRA_ARGS_INVALID";
  error.issues = issues;
  return error;
}

export function assertSafeExtraArgs(text: unknown, context:ExtraArgsInspectionContext = {}): string[] {
  const inspection = inspectExtraArgs(text, context);
  if (!inspection.ok) throw extraArgsError(inspection.issues);
  return inspection.args;
}

function assertSafeOpenSshOption(value: unknown) {
  const parsed = parsedOpenSshOption(value);
  if (!parsed.name || !parsed.value) throw new Error("SSH 附加参数中的 -o 缺少选项值");
  if (!ALLOWED_OPENSSH_OPTIONS.has(parsed.name)) {
    throw new Error(`SSH 附加参数只允许连接调优选项，不能使用：${parsed.name}`);
  }
  return {name:parsed.name, value:parsed.value};
}

export function effectiveExtraArgs(text: unknown, context:ExtraArgsInspectionContext = {}): string[] {
  const args = assertSafeExtraArgs(text, context);
  const joined = args.join(" ").toLowerCase();
  const defaults = splitArgs(DEFAULT_EXTRA_ARGS);
  for (let index = 0; index < defaults.length; index += 1) {
    if (defaults[index] === "-o" && defaults[index + 1]) {
      const name = defaults[index + 1].split("=")[0].toLowerCase();
      if (!joined.includes(name)) args.push("-o", defaults[index + 1]);
    }
  }
  return args;
}

function simpleAlgorithmList(value: string) {
  const text = String(value || "").trim();
  if (!text || /^[+^-]/.test(text) || /[*?!]/.test(text)) return null;
  const items = text.split(",").map(item => item.trim()).filter(Boolean);
  return items.length && items.every(item => /^[A-Za-z0-9@._+-]+$/.test(item)) ? items : null;
}

export function builtinSshExtraOptions(text: unknown, context:ExtraArgsInspectionContext = {}) {
  const args = assertSafeExtraArgs(text, context);
  const options: any = {};
  let unsupported = "";
  const applyOption = (nameValue: unknown, optionValue: unknown, source: string) => {
    const name = String(nameValue || "").toLowerCase();
    const value = String(optionValue || "").trim();
    if (["connecttimeout", "loglevel", "serveralivecountmax", "serveraliveinterval", "tcpkeepalive"].includes(name)) return;
    if (name === "compression") {
      if (/^(?:yes|true|on|1)$/i.test(value)) options.algorithms = { ...(options.algorithms || {}), compress:["zlib@openssh.com", "zlib", "none"] };
      else if (/^(?:no|false|off|0)$/i.test(value)) options.algorithms = { ...(options.algorithms || {}), compress:["none"] };
      else unsupported ||= source;
      return;
    }
    if (name === "addressfamily") {
      if (value.toLowerCase() === "inet") Object.assign(options, {forceIPv4:true, forceIPv6:false});
      else if (value.toLowerCase() === "inet6") Object.assign(options, {forceIPv4:false, forceIPv6:true});
      else if (value.toLowerCase() === "any") Object.assign(options, {forceIPv4:false, forceIPv6:false});
      else unsupported ||= source;
      return;
    }
    const algorithmKey = {
      ciphers:"cipher",
      macs:"hmac",
      kexalgorithms:"kex",
      hostkeyalgorithms:"serverHostKey"
    }[name];
    if (algorithmKey) {
      const algorithms = simpleAlgorithmList(value);
      if (!algorithms) unsupported ||= source;
      else options.algorithms = { ...(options.algorithms || {}), [algorithmKey]:algorithms };
      return;
    }
    unsupported ||= source;
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "");
    if (token === "-o") {
      const option = assertSafeOpenSshOption(args[index + 1]);
      applyOption(option.name, option.value, String(args[index + 1] || token));
      index += 1;
      continue;
    }
    if (token.startsWith("-o")) {
      const option = assertSafeOpenSshOption(token.slice(2));
      applyOption(option.name, option.value, token);
      continue;
    }
    const short = token.slice(1);
    for (let offset = 0; offset < short.length; offset += 1) {
      const option = short[offset];
      if (option === "4") Object.assign(options, {forceIPv4:true, forceIPv6:false});
      else if (option === "6") Object.assign(options, {forceIPv4:false, forceIPv6:true});
      else if (option === "C") options.algorithms = { ...(options.algorithms || {}), compress:["zlib@openssh.com", "zlib", "none"] };
      else if (["q", "v"].includes(option)) continue;
      else if (["c", "m"].includes(option)) {
        const attached = short.slice(offset + 1);
        const argument = attached || String(args[index + 1] || "");
        applyOption(option === "c" ? "ciphers" : "macs", argument, token);
        if (!attached) index += 1;
        break;
      }
    }
  }
  return {supported:!unsupported, unsupported, options};
}
