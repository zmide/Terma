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

export function splitArgs(text: unknown): string[] {
  if (!text) return [];
  const args: string[] = [];
  const expression = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(String(text)))) {
    args.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'])/g, "$1"));
  }
  return args;
}

function openSshOptionName(value: unknown): string {
  return String(value || "").trim().split(/[=\s]/, 1)[0].toLowerCase();
}

function assertSafeOpenSshOption(value: unknown) {
  const option = String(value || "").trim();
  const name = openSshOptionName(option);
  const remainder = option.slice(name.length).trim();
  const optionValue = remainder.startsWith("=") ? remainder.slice(1).trim() : remainder;
  if (!name || !optionValue) throw new Error("SSH 附加参数中的 -o 缺少选项值");
  if (!ALLOWED_OPENSSH_OPTIONS.has(name)) {
    throw new Error(`SSH 附加参数只允许连接调优选项，不能使用：${name}`);
  }
  return { name, value:optionValue };
}

function requireArgument(args: string[], index: number, option: string) {
  const argument = String(args[index + 1] || "");
  if (!argument) throw new Error(`SSH 附加参数中的 -${option} 缺少参数值`);
  return argument;
}

export function assertSafeExtraArgs(text: unknown): string[] {
  if (/[\0\r\n]/.test(String(text || ""))) throw new Error("SSH 附加参数不能包含控制字符或换行");
  const args = splitArgs(text);
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "");
    if (!value.startsWith("-") || value === "-" || value === "--" || value.startsWith("--")) {
      throw new Error(`SSH 附加参数不能包含主机、命令或其他位置参数：${value || "(空)"}`);
    }
    if (value === "-o") {
      assertSafeOpenSshOption(requireArgument(args, index, "o"));
      index += 1;
      continue;
    }
    if (value.startsWith("-o")) {
      assertSafeOpenSshOption(value.slice(2));
      continue;
    }
    const option = value.slice(1, 2);
    if (ALLOWED_OPENSSH_SHORT_OPTIONS_WITH_ARGUMENT.has(option)) {
      if (value.length === 2) {
        requireArgument(args, index, option);
        index += 1;
      }
      continue;
    }
    if ([...value.slice(1)].every(item => ALLOWED_OPENSSH_SHORT_FLAGS.has(item))) continue;
    throw new Error(`SSH 附加参数不允许使用短选项：${value}`);
  }
  return args;
}

export function effectiveExtraArgs(text: unknown): string[] {
  const args = assertSafeExtraArgs(text);
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

export function builtinSshExtraOptions(text: unknown) {
  const args = assertSafeExtraArgs(text);
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
  return { supported:!unsupported, unsupported, options };
}
