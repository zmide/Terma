const OUTPUT_LIMIT = 128 * 1024;
const VALUE_LIMIT = 2048;
const DEFAULT_TIMEOUT_MS = 7000;
const { buildRemotePosixCommand } = require("./remote-posix");

export type TerminalProfileKind = "shell" | "repl" | "session" | "tool";
export type TerminalProfilePlatform = "posix" | "windows";

export interface RemoteTerminalProfile {
  id: string;
  kind: TerminalProfileKind;
  label: string;
  path: string;
  args: string;
  platform: TerminalProfilePlatform;
  is_default: boolean;
}

export interface RemoteTerminalTool {
  id: string;
  label: string;
  path: string;
}

export interface RemoteDefaultShell {
  name: string;
  label: string;
  path: string;
  source: string;
}

export interface RemoteTerminalCapabilities {
  platform: "linux" | "macos" | "windows" | "unix" | "unknown";
  platform_label: string;
  default_shell: RemoteDefaultShell | null;
  profiles: RemoteTerminalProfile[];
  tools: RemoteTerminalTool[];
  warnings: string[];
}

export type RemoteCommandResult =
  | string
  | Buffer
  | { stdout?: string | Buffer | null }
  | null
  | undefined;

export type RemoteCommandRunner = (command: string) => Promise<RemoteCommandResult> | RemoteCommandResult;

export interface DiscoverRemoteTerminalOptions {
  timeoutMs?: number;
}

// This harmless command is intentionally run before the longer POSIX script.
// Sending shell redirections to a Windows OpenSSH server whose default shell is
// cmd.exe can be misinterpreted, so the detailed script is only sent after uname
// has positively identified a Unix-like host.
export const PLATFORM_CAPABILITY_PROBE = "uname -s";

const POSIX_SCRIPT = String.raw`
td_line() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }
td_os="$(uname -s 2>/dev/null || printf unknown)"
td_line TD_CAPS_V1 "" ""
td_line PLATFORM "$td_os" ""
td_user="$(id -un 2>/dev/null || printf '')"
td_shell=""
td_source=""
if [ "$td_os" = Darwin ] && command -v dscl >/dev/null 2>&1 && [ -n "$td_user" ]; then
  td_shell="$(dscl . -read "/Users/$td_user" UserShell 2>/dev/null | sed -n 's/^UserShell:[[:space:]]*//p' | head -n 1)"
  [ -n "$td_shell" ] && td_source=directory_service
fi
if [ -z "$td_shell" ] && command -v getent >/dev/null 2>&1 && [ -n "$td_user" ]; then
  td_record="$(getent passwd "$td_user" 2>/dev/null | head -n 1)"
  td_shell="$(printf '%s\n' "$td_record" | awk -F: '{print $NF}')"
  [ -n "$td_shell" ] && td_source=passwd
fi
if [ -z "$td_shell" ] && [ -n "$td_user" ]; then
  td_record="$(id -P "$td_user" 2>/dev/null | head -n 1)"
  td_shell="$(printf '%s\n' "$td_record" | awk -F: '{print $NF}')"
  [ -n "$td_shell" ] && td_source=passwd
fi
if [ -z "$td_shell" ] && [ -n "$SHELL" ]; then
  td_shell="$SHELL"
  td_source=environment
fi
td_line DEFAULT_SHELL "$td_shell" "$td_source"
if [ -r /etc/shells ]; then
  while IFS= read -r td_path; do
    case "$td_path" in
      /*/sh|/*/bash|/*/zsh|/*/fish|/*/ksh|/*/dash|/*/ash|/*/csh|/*/tcsh)
        td_name="$(basename "$td_path")"
        td_line SHELL "$td_name" "$td_path"
        ;;
    esac
  done < /etc/shells
fi
for td_name in sh bash zsh fish ksh dash ash csh tcsh python3 python node deno bun tmux screen copilot git gh; do
  td_path="$(command -v "$td_name" 2>/dev/null || printf '')"
  case "$td_path" in
    /*) td_line EXEC "$td_name" "$td_path" ;;
  esac
done
`;

export const POSIX_CAPABILITY_PROBE = buildRemotePosixCommand(POSIX_SCRIPT);

const WINDOWS_POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference='SilentlyContinue'
function O([string]$a,[string]$b,[string]$c){[Console]::Out.WriteLine($a+[char]9+$b+[char]9+$c)}
O 'TD_CAPS_V1' '' ''
O 'PLATFORM' 'windows' ''
$d=(Get-ItemProperty 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -ErrorAction SilentlyContinue).DefaultShell
$s='openssh_registry'
if(!$d){$d=$env:ComSpec;$s='comspec'}
if($d){$d=[Environment]::ExpandEnvironmentVariables([string]$d)}
O 'DEFAULT_SHELL' $d $s
$n=@('cmd','powershell','pwsh','bash','python3','python','py','node','deno','bun','tmux','screen','copilot','git','gh','wsl')
foreach($x in $n){$c=Get-Command $x -CommandType Application,ExternalScript -ErrorAction SilentlyContinue|Select-Object -First 1;if($c){O 'EXEC' $x ([string]$c.Source)}}
$r=@('HKLM:\SOFTWARE\GitForWindows','HKLM:\SOFTWARE\WOW6432Node\GitForWindows','HKCU:\SOFTWARE\GitForWindows')
$seen=@{}
foreach($k in $r){$p=(Get-ItemProperty $k -Name InstallPath -ErrorAction SilentlyContinue).InstallPath;if($p -and !$seen.ContainsKey($p)){$seen[$p]=$true;O 'GIT_INSTALL' 'git' ([string]$p);foreach($q in @('bin\bash.exe','usr\bin\bash.exe')){$b=Join-Path $p $q;if([IO.File]::Exists($b)){O 'EXEC' 'git-bash' $b}}}}
`;

const WINDOWS_ENCODED_SCRIPT = Buffer.from(WINDOWS_POWERSHELL_SCRIPT, "utf16le").toString("base64");
export const WINDOWS_POWERSHELL_PROBE =
  `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${WINDOWS_ENCODED_SCRIPT}`;
export const WINDOWS_PWSH_PROBE =
  `pwsh.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${WINDOWS_ENCODED_SCRIPT}`;

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "ksh", "dash", "ash", "csh", "tcsh", "cmd", "powershell", "pwsh"]);
const POSIX_SHELL_ORDER = ["sh", "bash", "zsh", "fish", "ksh", "dash", "ash", "csh", "tcsh"];
const WINDOWS_SHELL_ORDER = ["cmd", "powershell", "pwsh", "git-bash", "bash"];
const REPL_ORDER = ["python3", "python", "py", "node", "deno", "bun"];
const SESSION_ORDER = ["tmux", "screen"];
const PROFILE_TOOL_ORDER = ["copilot"];
const ORDINARY_TOOL_ORDER = ["git", "gh", "wsl"];

const LABELS: Record<string, string> = {
  sh: "POSIX sh",
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  ksh: "KornShell",
  dash: "Dash",
  ash: "Almquist Shell",
  csh: "C Shell",
  tcsh: "TENEX C Shell",
  cmd: "命令提示符（CMD）",
  powershell: "Windows PowerShell",
  pwsh: "PowerShell",
  "git-bash": "Git Bash",
  python3: "Python 3",
  python: "Python",
  py: "Python Launcher",
  node: "Node.js",
  deno: "Deno",
  bun: "Bun",
  tmux: "tmux",
  screen: "GNU Screen",
  copilot: "GitHub Copilot CLI",
  git: "Git",
  gh: "GitHub CLI",
  wsl: "WSL"
};

const PROFILE_ARGS: Record<string, string> = {
  sh: "-l",
  bash: "-l",
  zsh: "-l",
  fish: "-l",
  ksh: "-l",
  dash: "-l",
  ash: "-l",
  csh: "-l",
  tcsh: "-l",
  cmd: "/Q",
  powershell: "-NoLogo",
  pwsh: "-NoLogo",
  "git-bash": "--login -i",
  python3: "-i",
  python: "-i",
  py: "-i",
  node: "-i",
  deno: "repl",
  bun: "repl",
  tmux: "new-session -A -s tunneldesk",
  screen: "-xRR tunneldesk"
};

interface ParsedProbe {
  rawPlatform: string;
  defaultPath: string;
  defaultSource: string;
  executables: Map<string, string>;
  shellPaths: Map<string, string>;
  gitInstallPaths: string[];
}

function cleanOutput(value: unknown): string {
  let text: string;
  if (Buffer.isBuffer(value)) text = value.toString("utf8");
  else if (typeof value === "string") text = value;
  else if (value && typeof value === "object" && "stdout" in value) {
    const stdout = (value as { stdout?: string | Buffer | null }).stdout;
    text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout || "");
  } else {
    text = "";
  }
  return text
    .slice(0, OUTPUT_LIMIT)
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function cleanValue(value: unknown): string {
  return String(value || "")
    .slice(0, VALUE_LIMIT)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

function parseTaggedOutput(value: unknown): ParsedProbe | null {
  const output = cleanOutput(value);
  if (!output.split("\n").some((line) => line.split("\t")[0].trim() === "TD_CAPS_V1")) return null;
  const parsed: ParsedProbe = {
    rawPlatform: "",
    defaultPath: "",
    defaultSource: "",
    executables: new Map(),
    shellPaths: new Map(),
    gitInstallPaths: []
  };
  for (const rawLine of output.split("\n")) {
    const [rawKind, rawName = "", ...rawRest] = rawLine.split("\t");
    const kind = cleanValue(rawKind);
    const name = cleanValue(rawName).toLowerCase();
    const value = cleanValue(rawRest.join("\t"));
    if (kind === "PLATFORM") {
      parsed.rawPlatform = cleanValue(rawName || value);
    } else if (kind === "DEFAULT_SHELL") {
      parsed.defaultPath = cleanValue(rawName);
      parsed.defaultSource = value;
    } else if (kind === "EXEC" && name && value && !parsed.executables.has(name)) {
      parsed.executables.set(name, value);
    } else if (kind === "SHELL" && name && value && !parsed.shellPaths.has(name)) {
      parsed.shellPaths.set(name, value);
    } else if (kind === "GIT_INSTALL" && value) {
      parsed.gitInstallPaths.push(value);
    }
  }
  return parsed;
}

function platformInfo(rawPlatform: string): Pick<RemoteTerminalCapabilities, "platform" | "platform_label"> {
  const raw = cleanValue(rawPlatform);
  if (/^linux$/i.test(raw)) return { platform: "linux", platform_label: "Linux" };
  if (/^darwin$/i.test(raw)) return { platform: "macos", platform_label: "macOS" };
  if (/^(windows|win32)$/i.test(raw)) return { platform: "windows", platform_label: "Windows" };
  if (/^(mingw|msys|cygwin)/i.test(raw)) return { platform: "windows", platform_label: "Windows" };
  if (raw && !/^unknown$/i.test(raw)) return { platform: "unix", platform_label: raw };
  return { platform: "unknown", platform_label: "未知" };
}

function executableName(file: string): string {
  const normalized = cleanValue(file).replace(/[\\/]+$/, "");
  const base = normalized.split(/[\\/]/).pop() || "";
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

function normalizedPath(file: string, platform: TerminalProfilePlatform): string {
  const normalized = cleanValue(file).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return platform === "windows" ? normalized.toLowerCase() : normalized;
}

function isInsideGitForWindows(candidate: string, roots: string[]): boolean {
  const file = normalizedPath(candidate, "windows");
  return roots.some((root) => {
    const base = normalizedPath(root, "windows");
    return file === `${base}/bin/bash.exe` || file === `${base}/usr/bin/bash.exe`;
  });
}

function profileKind(id: string): TerminalProfileKind | null {
  if (SHELLS.has(id) || id === "git-bash") return "shell";
  if (REPL_ORDER.includes(id)) return "repl";
  if (SESSION_ORDER.includes(id)) return "session";
  if (PROFILE_TOOL_ORDER.includes(id)) return "tool";
  return null;
}

function profileLabel(id: string): string {
  return LABELS[id] || id;
}

function profileIdForDefault(file: string, platform: TerminalProfilePlatform, gitRoots: string[]): string {
  const name = executableName(file);
  if (platform === "windows" && name === "bash" && isInsideGitForWindows(file, gitRoots)) return "git-bash";
  return SHELLS.has(name) ? name : "default-shell";
}

function sameExecutable(left: string, right: string, platform: TerminalProfilePlatform): boolean {
  return Boolean(left && right && normalizedPath(left, platform) === normalizedPath(right, platform));
}

function buildCapabilities(parsed: ParsedProbe): RemoteTerminalCapabilities {
  const info = platformInfo(parsed.rawPlatform);
  const profilePlatform: TerminalProfilePlatform = info.platform === "windows" ? "windows" : "posix";
  const warnings: string[] = [];
  const paths = new Map<string, string>();

  for (const [name, file] of parsed.shellPaths) {
    if (SHELLS.has(name)) paths.set(name, file);
  }
  for (const [name, file] of parsed.executables) {
    if (!paths.has(name)) paths.set(name, file);
  }

  if (profilePlatform === "windows") {
    const gitBashCandidates = [paths.get("git-bash"), paths.get("bash")].filter(Boolean) as string[];
    const verifiedGitBash = gitBashCandidates.find((file) => isInsideGitForWindows(file, parsed.gitInstallPaths));
    if (verifiedGitBash) {
      paths.set("git-bash", verifiedGitBash);
      if (sameExecutable(paths.get("bash") || "", verifiedGitBash, "windows")) paths.delete("bash");
    } else if (paths.has("git-bash")) {
      if (!paths.has("bash")) paths.set("bash", paths.get("git-bash") as string);
      paths.delete("git-bash");
    }
  } else {
    paths.delete("git-bash");
  }

  let defaultShell: RemoteDefaultShell | null = null;
  let defaultId = "";
  if (parsed.defaultPath) {
    defaultId = profileIdForDefault(parsed.defaultPath, profilePlatform, parsed.gitInstallPaths);
    defaultShell = {
      name: defaultId === "default-shell" ? executableName(parsed.defaultPath) || "shell" : defaultId,
      label: defaultId === "default-shell"
        ? executableName(parsed.defaultPath) || "默认登录 Shell"
        : profileLabel(defaultId),
      path: parsed.defaultPath,
      source: parsed.defaultSource || "unknown"
    };
    if (defaultId === "default-shell") paths.set(defaultId, parsed.defaultPath);
    else paths.set(defaultId, parsed.defaultPath);
  } else {
    warnings.push("未能读取远端账户的默认登录 Shell，仍可手动填写启动程序。");
  }

  const shellOrder = profilePlatform === "windows" ? WINDOWS_SHELL_ORDER : POSIX_SHELL_ORDER;
  const order = [...shellOrder, ...REPL_ORDER, ...SESSION_ORDER, ...PROFILE_TOOL_ORDER, "default-shell"];
  const profiles: RemoteTerminalProfile[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const file = paths.get(id);
    const kind = profileKind(id) || (id === "default-shell" ? "shell" : null);
    if (!file || !kind) continue;
    const pathKey = normalizedPath(file, profilePlatform);
    const key = `${kind}:${pathKey}:${PROFILE_ARGS[id] || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({
      id,
      kind,
      label: id === "default-shell" ? defaultShell?.label || "默认登录 Shell" : profileLabel(id),
      path: file,
      args: PROFILE_ARGS[id] || "",
      platform: profilePlatform,
      is_default: sameExecutable(file, parsed.defaultPath, profilePlatform)
    });
  }
  profiles.sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    return order.indexOf(left.id) - order.indexOf(right.id);
  });

  const tools: RemoteTerminalTool[] = [];
  for (const id of ORDINARY_TOOL_ORDER) {
    const file = paths.get(id);
    if (!file) continue;
    tools.push({ id, label: profileLabel(id), path: file });
  }

  return {
    ...info,
    default_shell: defaultShell,
    profiles,
    tools,
    warnings
  };
}

export function parsePosixCapabilityOutput(value: unknown): RemoteTerminalCapabilities | null {
  const parsed = parseTaggedOutput(value);
  if (!parsed) return null;
  const info = platformInfo(parsed.rawPlatform);
  if (!["linux", "macos", "unix", "windows"].includes(info.platform)) return null;
  return buildCapabilities(parsed);
}

export function parseWindowsCapabilityOutput(value: unknown): RemoteTerminalCapabilities | null {
  const parsed = parseTaggedOutput(value);
  if (!parsed || platformInfo(parsed.rawPlatform).platform !== "windows") return null;
  return buildCapabilities(parsed);
}

async function runWithTimeout(
  runCommand: RemoteCommandRunner,
  command: string,
  timeoutMs: number
): Promise<RemoteCommandResult> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => runCommand(command)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("capability probe timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unknownCapabilities(): RemoteTerminalCapabilities {
  return {
    platform: "unknown",
    platform_label: "未知",
    default_shell: null,
    profiles: [],
    tools: [],
    warnings: ["SSH 已连接，但无法识别远端终端环境；可以继续使用默认登录 Shell，或手动填写启动程序。"]
  };
}

export async function discoverRemoteTerminalCapabilities(
  runCommand: RemoteCommandRunner,
  options: DiscoverRemoteTerminalOptions = {}
): Promise<RemoteTerminalCapabilities> {
  if (typeof runCommand !== "function") throw new TypeError("runCommand must be a function");
  const timeoutMs = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  let posixResult: RemoteTerminalCapabilities | null = null;

  try {
    const platformLines = cleanOutput(
      await runWithTimeout(runCommand, PLATFORM_CAPABILITY_PROBE, timeoutMs)
    ).split("\n").map(cleanValue).filter(Boolean);
    const platform = platformInfo(platformLines.find((line) =>
      /^(linux|darwin|freebsd|openbsd|netbsd|sunos|aix|mingw|msys|cygwin)/i.test(line)
    ) || "");
    if (platform.platform !== "unknown" && platform.platform !== "windows") {
      posixResult = parsePosixCapabilityOutput(
        await runWithTimeout(runCommand, POSIX_CAPABILITY_PROBE, timeoutMs)
      );
      if (posixResult && posixResult.platform !== "windows") return posixResult;
    }
  } catch {}

  for (const command of [WINDOWS_POWERSHELL_PROBE, WINDOWS_PWSH_PROBE]) {
    try {
      const windowsResult = parseWindowsCapabilityOutput(await runWithTimeout(runCommand, command, timeoutMs));
      if (windowsResult) return windowsResult;
    } catch {}
  }

  if (posixResult) {
    posixResult.warnings.push("已检测到 Windows 兼容终端，但未能读取完整的 Windows 启动程序列表。");
    return posixResult;
  }
  return unknownCapabilities();
}
