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
