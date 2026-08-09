const { DEFAULT_EXTRA_ARGS }: { DEFAULT_EXTRA_ARGS: string } = require("./config");

const BLOCKED_OPENSSH_OPTIONS = new Set([
  "addkeystoagent",
  "certificatefile",
  "forwardagent",
  "identityagent",
  "identityfile",
  "include",
  "knownhostscommand",
  "localcommand",
  "permitlocalcommand",
  "pkcs11provider",
  "proxycommand",
  "securitykeyprovider",
  "controlmaster",
  "controlpath",
  "controlpersist",
  "globalknownhostsfile",
  "userknownhostsfile"
]);
const BLOCKED_OPENSSH_SHORT_OPTIONS = new Set(["i", "F", "I", "A", "E", "S", "O"]);
const OPENSSH_SHORT_OPTIONS_WITH_ARGUMENT = new Set([
  "B", "b", "c", "D", "E", "e", "F", "I", "i", "J", "L", "l", "m", "O", "o", "P", "p", "Q", "R", "S", "W", "w"
]);

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

function inspectShortOptions(value: string) {
  const result: any = { blocked: "", openSshOption: null, consumesNext: false };
  if (!value.startsWith("-") || value.startsWith("--") || value === "-") return result;
  const options = value.slice(1);
  for (let offset = 0; offset < options.length; offset += 1) {
    const option = options[offset];
    if (BLOCKED_OPENSSH_SHORT_OPTIONS.has(option)) {
      result.blocked = option;
      return result;
    }
    if (!OPENSSH_SHORT_OPTIONS_WITH_ARGUMENT.has(option)) continue;
    const attached = options.slice(offset + 1);
    if (option === "o") result.openSshOption = attached;
    result.consumesNext = !attached;
    return result;
  }
  return result;
}

export function assertSafeExtraArgs(text: unknown): string[] {
  const args = splitArgs(text);
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "");
    const short = inspectShortOptions(value);
    if (short.blocked) {
      throw new Error(`SSH 附加参数不能使用本机敏感短选项 -${short.blocked}：${value}`);
    }
    if (short.openSshOption !== null) {
      const option = short.openSshOption || String(args[index + 1] || "");
      if (!option) throw new Error("SSH 附加参数中的 -o 缺少选项");
      const name = openSshOptionName(option);
      if (BLOCKED_OPENSSH_OPTIONS.has(name)) throw new Error(`SSH 附加参数不允许使用本机敏感选项：${name}`);
      if (short.consumesNext) index += 1;
      continue;
    }
    if (short.consumesNext) index += 1;
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
