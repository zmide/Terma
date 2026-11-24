import {translate as tr} from '../../shared/i18n/runtime';

export function terminalAiStripControl(value:unknown) {
  return String(value || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function terminalAiDecodeNumericEntities(value:unknown) {
  return String(value || "").replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (full, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return full;
    try { return String.fromCodePoint(codePoint); } catch { return full; }
  });
}

export function terminalAiDeduplicateRepeatedText(value:unknown) {
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
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized) continue;
    if (output.at(-1)?.trim() === normalized && normalized.length >= 24) continue;
    output.push(normalized);
  }
  return output.join("\n\n");
}

export function terminalAiChatAutoContextHint() {
  return tr("terminal:ai.chat_auto_context_hint", {
    defaultValue:"请先在终端完成这项检查，然后直接再次提问；Terma 会自动读取最新终端内容并继续分析。"
  });
}

export function terminalAiChatRelayRequest(value:unknown) {
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

export function terminalAiNormalizeChatAnswer(value:unknown) {
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

export function terminalAiNormalizeMarkdownEscapes(value:unknown) {
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
  const lines: string[] = [];
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

export function terminalAiDecodeXmlText(value:unknown) {
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

export function terminalAiRedactAttachment(value:unknown) {
  return String(value || "")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/(authorization)\s*[:=]\s*[^\r\n]*/gi, "$1: [REDACTED]")
    .replace(/(password|passwd|passphrase|token|secret|api[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(ssh-(?:rsa|ed25519|ecdsa)|-----BEGIN)[^\r\n]*/gi, "[REDACTED KEY]")
    .slice(0, 120000);
}
