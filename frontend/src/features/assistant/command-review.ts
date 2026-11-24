import {translate as tr} from '../../shared/i18n/runtime';
import type {CommandRisk} from './terminal-command-service';
import {terminalAiSplitShellCommands} from './response-commands';

export function terminalAiCommandTokens(command:unknown) {
  const source = String(command || "").trim();
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  for (const character of source) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ""; }
      continue;
    }
    token += character;
  }
  if (quote) return [];
  if (token) tokens.push(token);
  return tokens;
}

export function terminalAiReadOnlyFilePath(command:unknown) {
  const tokens = terminalAiCommandTokens(command);
  const executable = (tokens[0] || "").split(/[\\/]/).pop()?.replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase()||'';
  const args = tokens.slice(1);
  const paths: string[] = [];
  const takeNumericOption = (index:number, token:string) => {
    if (/^(?:-n|-c|--lines|--bytes)$/i.test(token) && /^\d+$/.test(args[index + 1] || "")) return 1;
    return 0;
  };
  if (["cat", "head", "tail"].includes(executable)) {
    let optionsEnded = false;
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!optionsEnded && token === "--") { optionsEnded = true; continue; }
      if (!optionsEnded && executable === "cat" && (/^-[AbenstuvET]+$/.test(token) || /^--(?:number|number-nonblank|squeeze-blank|show-ends|show-tabs|show-nonprinting|show-all)$/.test(token))) continue;
      if (!optionsEnded && ["head", "tail"].includes(executable)) {
        if (/^(?:-q|-v|--quiet|--silent|--verbose)$/i.test(token) || /^-\d+$/.test(token) || /^--(?:lines|bytes)=\d+$/i.test(token)) continue;
        const consumed = takeNumericOption(index, token);
        if (consumed) { index += consumed; continue; }
        if (/^(?:-f|-F|--follow|--retry|--pid)/i.test(token)) return "";
      }
      if (!optionsEnded && token.startsWith("-")) return "";
      paths.push(token);
    }
  } else if (["get-content", "gc"].includes(executable)) {
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (/^-(?:literalpath|path)$/i.test(token)) {
        if (!args[index + 1]) return "";
        paths.push(args[index + 1]);
        index += 1;
        continue;
      }
      if (/^-(?:tail|totalcount|head|readcount)$/i.test(token) && /^\d+$/.test(args[index + 1] || "")) { index += 1; continue; }
      if (/^-(?:raw|wait)$/i.test(token)) {
        if (/^-wait$/i.test(token)) return "";
        continue;
      }
      if (token.startsWith("-")) return "";
      paths.push(token);
    }
  } else if (executable === "type") {
    paths.push(...args);
  } else {
    return "";
  }
  if (paths.length !== 1 || !paths[0] || /[*?\[\]{}]/.test(paths[0])) return "";
  return paths[0];
}

export function terminalAiReadOnlyFind(command:unknown) {
  let text = String(command || "").trim();
  if (!/^find(?:\s|$)/i.test(text)) return "";
  // Only discard stderr; other shell operators remain blocked below.
  text = text.replace(/\s+2>\s*\/dev\/null\s*$/i, "").trim();
  const tokens = terminalAiCommandTokens(text);
  if (!tokens.length || tokens[0].toLowerCase() !== "find") return "";
  const args = tokens.slice(1);
  if (!args.length) return "";
  const path = args.shift();
  if (!path || path.startsWith("-")) return "";
  let hasPredicate = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index].toLowerCase()||'';
    if (["-maxdepth", "-mindepth"].includes(token)) {
      if (!/^\d+$/.test(args[index + 1] || "")) return "";
      index += 1;
      continue;
    }
    if (token === "-type") {
      if (!/^[fdl]$/i.test(String(args[index + 1] || ""))) return "";
      hasPredicate = true;
      index += 1;
      continue;
    }
    if (["-name", "-iname"].includes(token)) {
      const pattern = args[index + 1] || "";
      if (!pattern || /[;|&<>`$()]/.test(pattern)) return "";
      hasPredicate = true;
      index += 1;
      continue;
    }
    if (token === "-print") { hasPredicate = true; continue; }
    if (["-depth", "-xdev", "-mount", "-noleaf"].includes(token)) continue;
    // Explicitly reject actions and arbitrary expression/composition syntax.
    return "";
  }
  return hasPredicate ? path : "";
}

export function terminalAiSensitivePath(path:unknown) {
  const normalized = String(path || "").trim().replace(/\\/g, "/").toLowerCase()||'';
  return /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube)(?:\/|$)/.test(normalized)
    || /(?:^|[\/._-])(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|authorized_keys|known_hosts|credentials?|secrets?|tokens?|passwords?|passwd|shadow)(?:$|[\/._-])/i.test(normalized)
    || /(?:^|\/)\.env(?:\.|$)/i.test(normalized)
    || /\.(?:pem|p12|pfx|key|kdbx)$/i.test(normalized);
}

export function terminalAiPromptMentionsPath(prompt:unknown,path:unknown) {
  const source = String(prompt || "").toLowerCase().replace(/\\/g, "/");
  const normalized = String(path || "").trim().toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9._~/:+-])${escaped}(?=$|[^a-z0-9._~/:+-])`, "i").test(source);
}

export function terminalAiCommandRisk(command:unknown, context:{userPrompt?:string}={}):CommandRisk {
  const text = String(command || "").trim();
  if (!text || /[\r\n]/.test(text)) return {safe:false, reason:tr("terminal:ai.risk_multiline", {defaultValue:"多行命令需要人工确认"})};
  if (/(?:^|\s)(?:sudo|doas|runas|su)(?:\s|$)/i.test(text)) return {safe:false, reason:tr("terminal:ai.risk_privilege", {defaultValue:"命令会提升权限"})};
  const findPath = terminalAiReadOnlyFind(text);
  if (findPath) return {safe:true, reason:"", path:findPath};
  const stderrOnly = text.replace(/\s+2>\s*\/dev\/null\b/gi, "").trim();
  if (stderrOnly !== text && !stderrOnly) return {safe:true, reason:""};
  if (/(?:\$\(|`)/.test(stderrOnly)) return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含命令替换"})};
  if (/(?:&&|\|\||[;&])/.test(stderrOnly)) {
    const parts = terminalAiSplitShellCommands(stderrOnly);
    if (parts.length > 1 && parts.every(part => terminalAiCommandRisk(part, context).safe)) return {safe:true, reason:""};
    return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含组合执行或重定向"})};
  }
  if (/[<>]/.test(stderrOnly)) return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含重定向"})};
  if (/\|/.test(stderrOnly)) {
    const parts = stderrOnly.split("|").map(item => item.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(part => terminalAiCommandRisk(part, context).safe)) return {safe:true, reason:""};
    return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含组合执行或重定向"})};
  }
  const commandTokens = terminalAiCommandTokens(text);
  if (commandTokens.slice(1).some(token => terminalAiSensitivePath(token))) return {safe:false, reason:tr("terminal:ai.risk_sensitive", {defaultValue:"命令会读取密钥、凭据或其他敏感文件"})};
  const executable = (text.match(/^["']?([^"'\s]+)/)?.[1] || "").split(/[\\/]/).pop()?.replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase()||'';
  if (["rm", "del", "erase", "rmdir", "remove-item", "mv", "move", "cp", "copy", "chmod", "chown", "kill", "pkill", "taskkill", "sc", "dnf", "yum", "pacman", "apk", "brew", "winget", "choco", "pip", "npm", "pnpm", "yarn", "curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "ssh", "scp", "sftp", "rsync", "docker", "podman", "kubectl", "terraform"].includes(executable)) return {safe:false, reason:tr("terminal:ai.risk_change", {defaultValue:"命令可能修改系统、访问网络或改变远端状态"})};
  const readPath = terminalAiReadOnlyFilePath(text);
  if (readPath) {
    if (terminalAiSensitivePath(readPath)) return {safe:false, reason:tr("terminal:ai.risk_sensitive", {defaultValue:"命令会读取密钥、凭据或其他敏感文件"}), path:readPath};
    return {safe:true, reason:"", path:readPath};
  }
  const safe = [
    /^(?:pwd|whoami|date|uptime|id|get-location)$/i,
    /^uname(?:\s+-(?:a|s|r|m|n|v|o))?$/i,
    /^(?:hostname|hostnamectl|ls|dir|get-childitem|df|free|ps|top|vmstat|iostat|stat|file|du|ip|ss|netstat|grep|egrep|fgrep|sed|awk|cut|sort|uniq|wc|head|tail|cat|echo|printf|true|false|which|whereis|type|mount|lsblk|lscpu|last|who|w|journalctl|dmesg)(?:\s|$)/i,
    /^(?:systemctl\s+(?:is-active|is-enabled|status|show|cat|list-units|list-sockets|list-timers)\b|service\s+\S+\s+status\b)/i,
    /^(?:dpkg\s+-l|rpm\s+-qa|apt-cache\s+(?:policy|show)|nft\s+(?:list|show)\b|iptables\s+-[LSnv])/i,
    /^git\s+(?:status|diff|log|show|branch|tag|remote|rev-parse|describe)(?:\s|$)/i
  ].some(pattern => pattern.test(text));
  return {safe, reason:safe ? "" : tr("terminal:ai.risk_unknown", {defaultValue:"该命令不在只读自动执行清单中"})};
}

export function terminalAiShellQuote(value:unknown) {
  const text = String(value || "");
  if (text.startsWith("~/")) return `"$HOME/${text.slice(2).replace(/[`"\\$]/g, "\\$&")}"`;
  return "'" + text.replace(/'/g, "'\\\"'\\\"'") + "'";
}

export function terminalAiCommandReview(command:unknown,risk:Partial<CommandRisk>={},options:{checkpointId?:string}={}) {
  const text = String(command || "").trim();
  const steps = terminalAiSplitShellCommands(text).filter(Boolean).slice(0, 12);
  const tokens = terminalAiCommandTokens(text);
  const executable = String(tokens[0] || "").split(/[\\/]/).pop()?.replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase()||'';
  const files = new Set<string>();
  const services = new Set<string>();
  const addFile = (value:unknown) => {
    const item = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    if (!item || item === "." || item === ".." || item.startsWith("-") || /[*?\[\]{}$()`;]/.test(item)) return;
    if (/^(?:true|false|yes|no|on|off)$/i.test(item)) return;
    files.add(item);
  };
  for (const match of text.matchAll(/(?:>>?|<)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)) addFile(match[1] || match[2] || match[3]);
  const args = tokens.slice(1).filter(token => token !== "--" && !token.startsWith("-"));
  if (["rm", "del", "erase", "rmdir", "remove-item", "mv", "move", "cp", "copy", "chmod", "chown", "mkdir", "md", "touch", "tee"].includes(executable)) args.forEach(addFile);
  if (["sed", "perl", "python", "python3", "powershell", "pwsh"].includes(executable) && /(?:^|\s)(?:-i|--in-place|set-content|out-file|add-content)(?:\s|$)/i.test(text)) args.slice(-2).forEach(addFile);
  if (/\b(?:systemctl|service)\s+(?:enable|disable|start|stop|restart|reload|mask|unmask)\b/i.test(text)) {
    const service = text.match(/\b(?:systemctl|service)\s+(?:enable|disable|start|stop|restart|reload|mask|unmask)\s+([^\s;&|]+)/i)?.[1];
    if (service) services.add(service);
  }
  const packageChange = text.match(/\b(?:apt(?:-get)?|dnf|yum|pacman|zypper|apk|brew|winget|choco|npm|pnpm|yarn|pip)\s+(?:install|remove|uninstall|erase|upgrade|update)\b([^;&|]*)/i)?.[1];
  const packages = packageChange ? packageChange.trim().split(/\s+/).filter(item => item && !item.startsWith("-")).slice(0, 12) : [];
  const kind = services.size ? "service" : packages.length ? "package" : files.size ? "file" : "system";
  const fileList = [...files].slice(0, 8);
  const checkpointId = String(options.checkpointId || "pending").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "pending";
  const sensitive = fileList.some(item => terminalAiSensitivePath(item));
  const unsafeBackupPath = fileList.some(item => /^(?:\/$|~\/?$|\/(?:etc|var|usr|home|root|tmp|opt|bin|sbin|proc|sys|dev)\/?$)/i.test(item));
  const backupSupported = Boolean(fileList.length && fileList.length <= 8 && !sensitive && !unsafeBackupPath && !risk.safe);
  const backupDirectory = `~/.terma/checkpoints/${checkpointId}`;
  const backupCommand = backupSupported
    ? `set -eu; d=\"$HOME/.terma/checkpoints/${checkpointId}\"; mkdir -p \"$d\"; ${fileList.map((item, index) => `if [ -e ${terminalAiShellQuote(item)} ] || [ -L ${terminalAiShellQuote(item)} ]; then cp -a ${terminalAiShellQuote(item)} \"$d/item-${index}\"; else : > \"$d/item-${index}.absent\"; fi`).join("; ")}; printf '%s\\n' ${fileList.map((item, index) => `${index}:${item}`).map(terminalAiShellQuote).join(" ")} > \"$d/manifest\"; printf '%s\\n' TERMA_CHECKPOINT_READY`
    : "";
  const rollbackCommand = backupSupported
    ? `set -eu; d=\"$HOME/.terma/checkpoints/${checkpointId}\"; ${fileList.map((item, index) => `if [ -e \"$d/item-${index}.absent\" ]; then rm -rf -- ${terminalAiShellQuote(item)}; elif [ -e \"$d/item-${index}\" ] || [ -L \"$d/item-${index}\" ]; then rm -rf -- ${terminalAiShellQuote(item)}; cp -a \"$d/item-${index}\" ${terminalAiShellQuote(item)}; fi`).join("; ")}; printf '%s\\n' TERMA_CHECKPOINT_ROLLED_BACK`
    : "";
  return {
    kind,
    ...terminalAiCommandReviewCopy(kind,backupSupported ? "pending" : sensitive ? "sensitive-skipped" : unsafeBackupPath ? "unsafe-skipped" : "unavailable"),
    steps,
    files:fileList,
    services:[...services].slice(0, 8),
    packages,
    backupCommand,
    rollbackCommand,
    backupDirectory:backupSupported ? backupDirectory : "",
    backupStatus:backupSupported ? "pending" : (sensitive ? "sensitive-skipped" : unsafeBackupPath ? "unsafe-skipped" : "unavailable"),
    risk:String(risk.reason || "").slice(0, 240)
  };
}

export function terminalAiCommandReviewCopy(kind:string,backupStatus:string) {
  const impact = kind === "file"
    ? tr("terminal:ai.review_file_impact", {defaultValue:"会修改或删除远端文件"})
    : kind === "service"
      ? tr("terminal:ai.review_service_impact", {defaultValue:"会改变远端服务状态"})
      : kind === "package"
        ? tr("terminal:ai.review_package_impact", {defaultValue:"会安装、升级或移除软件包"})
        : tr("terminal:ai.review_system_impact", {defaultValue:"可能改变系统或访问外部资源"});
  return {impact,
    backupNote:backupStatus === "sensitive-skipped"
      ? tr("terminal:ai.review_sensitive_backup", {defaultValue:"检测到敏感路径，不自动复制远端文件内容"})
      : backupStatus === "unsafe-skipped"
        ? tr("terminal:ai.review_unsafe_backup", {defaultValue:"路径范围过大或过于危险，不自动复制远端内容"})
      : backupStatus === "pending" || backupStatus === "ready"
        ? tr("terminal:ai.review_backup_ready", {defaultValue:"执行前会先创建远端检查点备份"})
        : tr("terminal:ai.review_backup_unavailable", {defaultValue:"当前命令无法自动生成可靠的文件备份"}),
    residual:(kind === "file" ? [tr("terminal:ai.review_residual_files", {defaultValue:"重新检查文件内容和权限"})] : kind === "service" ? [tr("terminal:ai.review_residual_service", {defaultValue:"重新检查服务状态和监听端口"})] : kind === "package" ? [tr("terminal:ai.review_residual_package", {defaultValue:"重新检查软件包版本和依赖状态"})] : [tr("terminal:ai.review_residual_system", {defaultValue:"重新检查关键系统状态和命令输出"})]),
  };
}
