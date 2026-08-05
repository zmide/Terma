"use strict";

const crypto = require("node:crypto");
const dgram = require("node:dgram");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { startWindowsX11WindowGuard, stopWindowsX11WindowGuard } = require("./windows-x11-window-guard");

const WINDOWS_SERVER_NAMES = ["vcxsrv.exe", "xming.exe", "xwin.exe", "x410.exe"];
const XQUARTZ_VERSION = "2.8.6";
const XQUARTZ_URL = `https://github.com/XQuartz/XQuartz/releases/download/XQuartz-${XQUARTZ_VERSION}/XQuartz-${XQUARTZ_VERSION}.pkg`;
const XQUARTZ_BYTES = 122035963;
const XQUARTZ_SHA256 = "9ac35a505095bfbd3009c3b4772f0c6421e2f79c4210ab908459270d1c447909";
const XQUARTZ_TEAM_ID = "NA574AWV7E";

function output(command, args = [], options = {}) {
  try {
    const result = spawnSync(command, args, {
      encoding:"utf8",
      windowsHide:true,
      timeout:3000,
      ...options
    });
    return result.status === 0 ? String(result.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

function parseXQuartzProcessOutput(value) {
  const commands = String(value || "").split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /(?:^|\/)Xquartz(?:\s|$)/i.test(line));
  const command = commands.find(line => /(?:^|\s):\d+(?:\.\d+)?(?=\s|$)/.test(line) && /(?:^|\s)-auth\s+/.test(line))
    || commands.find(line => /(?:^|\s):\d+(?:\.\d+)?(?=\s|$)/.test(line))
    || commands.at(-1)
    || "";
  const display = /(?:^|\s)(:\d+(?:\.\d+)?)(?=\s|$)/.exec(command)?.[1] || "";
  const rawAuthority = /(?:^|\s)-auth\s+("[^"]+"|'[^']+'|\S+)/.exec(command)?.[1] || "";
  const authorityFile = rawAuthority.replace(/^(['"])(.*)\1$/, "$2");
  return {running:Boolean(command), command, display, authorityFile};
}

function parseXQuartzProcessIds(value) {
  const ids = String(value || "").split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const command = match[2];
    const xQuartzServer = /(?:^|\s)\S*\/Xquartz(?:\s|$)/i.test(command);
    const xQuartzLauncher = /\/XQuartz\.app\/Contents\/MacOS\/X11\.bin(?:\s|$)/i.test(command);
    return xQuartzServer || xQuartzLauncher ? [Number(match[1])] : [];
  });
  return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}

function parseWindowsXServerDisplayNumbers(value) {
  const displays = String(value || "").split(/\r?\n/).flatMap(line => {
    if (!/(?:^|[\\/\s"])(?:vcxsrv|xming|xwin|x410)\.exe(?:"|\s|$)/i.test(line)) return [];
    const match = /(?:^|\s)(?::|localhost:|127\.0\.0\.1:)(\d+)(?:\.\d+)?(?=\s|$)/i.exec(line);
    return match ? [Number(match[1])] : [];
  });
  return [...new Set(displays.filter(display => Number.isInteger(display) && display >= 0))];
}

function isWindowsDisplayCollisionError(error) {
  if (error?.code === "X11_DISPLAY_COLLISION") return true;
  return /(?:MIT-MAGIC-COOKIE-1|unable to open display|server is already active|already running|duplicate display|display .* in use)/i.test(
    String(error?.message || error || "")
  );
}

async function retryWindowsDisplayLaunch(allocate, launch, maxAttempts = 33) {
  const excluded = new Set();
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const displayNumber = await allocate(excluded);
    try {
      return await launch(displayNumber);
    } catch (error) {
      lastError = error;
      if (!isWindowsDisplayCollisionError(error)) throw error;
      excluded.add(displayNumber);
    }
  }
  throw lastError || new Error("No available X11 display");
}

function wildcardXauthorityRecords(value) {
  return String(value || "").split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[0-9a-f]{4}\s+(?:[0-9a-f]+\s*)+$/i.test(line))
    .map(line => `ffff${line.slice(4)}`)
    .join("\n");
}

function existingFile(candidates) {
  return candidates.find(candidate => {
    try { return candidate && fs.statSync(candidate).isFile(); } catch { return false; }
  }) || "";
}

function existingDirectory(candidates) {
  return candidates.find(candidate => {
    try { return candidate && fs.statSync(candidate).isDirectory(); } catch { return false; }
  }) || "";
}

function commandPath(command, platform = process.platform) {
  const lookup = platform === "win32" ? "where.exe" : "which";
  return output(lookup, [command]).split(/\r?\n/).map(value => value.trim()).find(Boolean) || "";
}

function environmentKey(environment, name) {
  const expected = String(name || "").toLowerCase();
  return Object.keys(environment || {}).find(key => key.toLowerCase() === expected) || name;
}

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({host:"127.0.0.1", port, exclusive:true}, () => {
      server.close(() => resolve(true));
    });
  });
}

function canConnect(port, timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = net.createConnection({host:"127.0.0.1", port});
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readLogTail(file, maxBytes = 16000) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (!length) return "";
    const descriptor = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return "";
  }
}

function xdmcpLaunchFailureMessage(rawMessage, displayNumber) {
  const raw = String(rawMessage || "").trim();
  if (/XDMCP fatal error:\s*Session failed/i.test(raw)) {
    return `XDMCP 会话建立失败：远端已响应 UDP 177，但未能连接本机 X Server。XDMCP 还要求远端反向访问本机 TCP ${6000 + Number(displayNumber || 0)}；请检查双方直连路由和防火墙。经过 VPN、NAT 或端口映射时无法回连，可改用 VNC 或 RDP。`;
  }
  const fatal = /Fatal server error:\s*[\r\n]+(?:\(EE\)\s*)?([^\r\n]+)/i.exec(raw)?.[1]
    || /\(EE\)\s+([^\r\n]+)/i.exec(raw)?.[1]
    || raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
    || "";
  return fatal || "XDMCP 图形桌面启动失败，请确认远端已启用 XDMCP/UDP 177，并允许远端回连本机 X Server";
}

async function waitForStableProcess(processHandle, timeoutMs = 1800) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    if (!processHandle || processHandle.exitCode !== null) return false;
    await delay(100);
  }
  return Boolean(processHandle && processHandle.exitCode === null);
}

async function terminateTrackedXdmcpChildren(children, reservedDisplays, options = {}) {
  const platform = options.platform || process.platform;
  const runtimeSpawnSync = options.spawnSync || spawnSync;
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 2500));
  const entries = [...children.entries()];
  if (!entries.length) return 0;

  for (const [processHandle] of entries) {
    if (processHandle?.exitCode !== null) continue;
    try { processHandle.kill(); } catch {}
  }
  let deadline = Date.now() + timeoutMs;
  while (entries.some(([processHandle]) => processHandle?.exitCode === null) && Date.now() < deadline) await delay(50);

  if (platform === "win32") {
    for (const [processHandle] of entries) {
      if (processHandle?.exitCode !== null || !Number.isInteger(processHandle?.pid) || processHandle.pid <= 0) continue;
      try {
        runtimeSpawnSync("taskkill.exe", ["/PID", String(processHandle.pid), "/T", "/F"], {
          encoding:"utf8",
          windowsHide:true,
          timeout:5000
        });
      } catch {}
    }
    deadline = Date.now() + 1000;
    while (entries.some(([processHandle]) => processHandle?.exitCode === null) && Date.now() < deadline) await delay(50);
  } else if (platform === "darwin") {
    for (const [processHandle] of entries) {
      if (processHandle?.exitCode !== null) continue;
      try { processHandle.kill("SIGKILL"); } catch {}
    }
    deadline = Date.now() + 500;
    while (entries.some(([processHandle]) => processHandle?.exitCode === null) && Date.now() < deadline) await delay(50);
  }

  for (const [processHandle, displayNumber] of entries) {
    children.delete(processHandle);
    reservedDisplays.delete(displayNumber);
  }
  return entries.length;
}

function readXdmcpText(buffer, offset) {
  if (offset + 2 > buffer.length) return {value:"", offset:buffer.length};
  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  const end = Math.min(buffer.length, start + length);
  return {value:buffer.subarray(start, end).toString("utf8"), offset:end};
}

function createXServerRuntime(options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..");
  const resourcesPath = options.resourcesPath || process.resourcesPath || "";
  const appIsPackaged = Boolean(options.appIsPackaged);
  const runtimeDataDir = options.runtimeDataDir || path.join(options.userDataPath || projectRoot, "xserver");
  let child = null;
  const xdmcpChildren = new Map();
  const reservedDisplayNumbers = new Set();
  let managedDisplay = "";
  let authorityFile = "";
  let lastError = "";
  let macStartedByTunnelDesk = false;
  let windowsWindowGuard = null;

  function bundledWindowsExecutable() {
    return existingFile([
      appIsPackaged && resourcesPath ? path.join(resourcesPath, "xserver", "vcxsrv.exe") : "",
      path.join(projectRoot, "runtime", "xserver", "win32", "vcxsrv.exe")
    ]);
  }

  function installedWindowsExecutable() {
    const programFiles = [environment.ProgramFiles, environment["ProgramFiles(x86)"], environment.LOCALAPPDATA].filter(Boolean);
    return existingFile(programFiles.flatMap(root => [
      path.join(root, "VcXsrv", "vcxsrv.exe"),
      path.join(root, "Xming", "Xming.exe"),
      path.join(root, "X410", "X410.exe")
    ]));
  }

  function windowsProcess() {
    const tasklist = output("tasklist.exe", ["/FO", "CSV", "/NH"]);
    const lower = tasklist.toLowerCase();
    return WINDOWS_SERVER_NAMES.find(name => lower.includes(`\"${name}\"`)) || "";
  }

  function windowsDisplayNumbers() {
    const command = [
      "$names = @('vcxsrv.exe','xming.exe','xwin.exe','x410.exe')",
      "Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name.ToLowerInvariant() } | ForEach-Object { $_.CommandLine }"
    ].join("; ");
    return new Set(parseWindowsXServerDisplayNumbers(output("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command
    ], {timeout:5000})));
  }

  function xQuartzApplication() {
    return existingDirectory([
      "/Applications/Utilities/XQuartz.app",
      "/Applications/XQuartz.app",
      path.join(environment.HOME || "", "Applications", "XQuartz.app")
    ]);
  }

  function xQuartzProcessState() {
    const parsed = parseXQuartzProcessOutput(output("/bin/ps", ["-ax", "-o", "command="]));
    return {
      ...parsed,
      running:parsed.running || Boolean(output("/usr/bin/pgrep", ["-x", "Xquartz"]))
    };
  }

  function killXQuartzProcesses(signal) {
    const ids = parseXQuartzProcessIds(output("/bin/ps", ["-ax", "-o", "pid=,command="]));
    for (const pid of ids) {
      try {
        spawnSync("/bin/kill", [`-${signal}`, String(pid)], {
          encoding:"utf8",
          timeout:3000,
          windowsHide:true
        });
      } catch {}
    }
    return ids.length;
  }

  function applyXQuartzEnvironment(state) {
    if (!state?.running || !state.display) return;
    environment.DISPLAY = state.display;
    const xauth = existingFile(["/opt/X11/bin/xauth", "/usr/X11/bin/xauth", "/usr/bin/xauth"]);
    if (xauth) environment.TUNNELDESK_XAUTH = xauth;
    if (state.authorityFile && fs.existsSync(state.authorityFile)) environment.XAUTHORITY = state.authorityFile;
  }

  function linuxXdmcpExecutable() {
    return existingFile([
      "/usr/bin/Xephyr",
      "/usr/local/bin/Xephyr",
      "/usr/bin/Xnest",
      "/usr/local/bin/Xnest",
      commandPath("Xephyr", platform),
      commandPath("Xnest", platform)
    ]);
  }

  function macXdmcpExecutable() {
    return existingFile([
      "/opt/X11/bin/Xephyr",
      "/usr/X11/bin/Xephyr",
      commandPath("Xephyr", platform)
    ]);
  }

  function linuxPackageManager() {
    return ["apt-get", "dnf", "pacman"].find(value => commandPath(value, platform)) || "";
  }

  function diagnostics() {
    if (platform === "win32") {
      const bundled = bundledWindowsExecutable();
      const system = installedWindowsExecutable();
      const executable = bundled || system;
      const processName = child && child.exitCode === null ? path.basename(executable || "vcxsrv.exe") : windowsProcess();
      const display = managedDisplay || String(environment.DISPLAY || "").trim();
      const running = Boolean(processName);
      return {
        platform,
        available:Boolean(running && display),
        installed:Boolean(executable),
        running,
        managed:Boolean(child && child.exitCode === null),
        can_start:Boolean(executable && !(child && child.exitCode === null)),
        can_stop:Boolean(child && child.exitCode === null),
        xdmcp_available:Boolean(executable),
        mode:bundled ? "bundled" : system ? "system" : "missing",
        server:processName || (executable ? path.basename(executable) : ""),
        executable,
        display,
        reason:lastError || (running && display
          ? "X Server 已就绪"
          : running
            ? "检测到 X Server，但 DISPLAY 未就绪"
            : executable
              ? "X Server 已安装，可由 TunnelDesk 启动"
              : "当前安装包不包含 X Server 运行时")
      };
    }
    if (platform === "darwin") {
      const application = xQuartzApplication();
      const state = xQuartzProcessState();
      const running = state.running;
      const display = String(state.display || output("/bin/launchctl", ["getenv", "DISPLAY"]) || environment.DISPLAY || "").trim();
      const authority = String(state.authorityFile || environment.XAUTHORITY || "").trim();
      const xdmcpClient = macXdmcpExecutable();
      if (running && display) applyXQuartzEnvironment({...state, display, authorityFile:authority});
      return {
        platform,
        available:Boolean(application && running && display),
        installed:Boolean(application),
        running,
        managed:Boolean(macStartedByTunnelDesk && running),
        can_start:Boolean(application && !running),
        can_stop:Boolean(running),
        can_install:Boolean(!application || !xdmcpClient),
        xdmcp_available:Boolean(application && xdmcpClient),
        xdmcp_client:xdmcpClient,
        mode:application ? "system" : "missing",
        server:application ? "XQuartz" : "",
        executable:application,
        display,
        authority_file:authority,
        reason:lastError || (application
          ? running && display ? "XQuartz 已就绪" : running ? "XQuartz 正在运行，但尚未识别 DISPLAY" : "XQuartz 可由 TunnelDesk 启动"
          : "未安装 XQuartz")
      };
    }
    const display = String(environment.DISPLAY || "").trim();
    const xauth = output("which", ["xauth"]);
    const xdmcpClient = linuxXdmcpExecutable();
    const freeRdpClient = commandPath("xfreerdp3", platform) || commandPath("xfreerdp", platform) || commandPath("wlfreerdp", platform);
    const packageManager = linuxPackageManager();
    return {
      platform,
      available:Boolean(display && xauth),
      installed:Boolean(xauth),
      running:Boolean(display),
      managed:false,
      can_start:false,
      can_stop:false,
      can_install:Boolean(packageManager && (!xdmcpClient || !freeRdpClient || !xauth)),
      xdmcp_available:Boolean(display && xauth && xdmcpClient),
      xdmcp_client:xdmcpClient,
      rdp_client:freeRdpClient,
      package_manager:packageManager,
      mode:display ? "native" : "missing",
      server:display ? "X.Org/Xwayland" : "",
      executable:xauth,
      display,
      reason:lastError || (display
        ? xauth
          ? xdmcpClient
            ? "X11 显示、xauth 和 Xephyr 已就绪"
            : "X11 已就绪，但缺少 Xephyr；可安装 Linux 图形组件"
          : "检测到 DISPLAY，但缺少 xauth"
        : "当前桌面会话没有 DISPLAY")
    };
  }

  async function waitForDisplayPort(displayNumber, timeoutMs = 8000, processHandle = child) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await canConnect(6000 + displayNumber, 350)) return true;
      if (processHandle && processHandle.exitCode !== null) break;
      await delay(180);
    }
    return false;
  }

  async function waitForUntrustedXauth(display, xauth, sourceAuthorityFile = authorityFile, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let errorText = "";
    while (Date.now() < deadline) {
      const probeFile = path.join(runtimeDataDir, `xauth-probe-${process.pid}-${Date.now()}`);
      try {
        if (sourceAuthorityFile && fs.existsSync(sourceAuthorityFile)) fs.copyFileSync(sourceAuthorityFile, probeFile);
      } catch {}
      const result = spawnSync(xauth, ["-f", probeFile, "generate", display, ".", "untrusted", "timeout", "60"], {
        encoding:"utf8",
        windowsHide:true,
        timeout:2500,
        env:{...environment, DISPLAY:display, XAUTHORITY:probeFile}
      });
      try { fs.rmSync(probeFile, {force:true}); } catch {}
      if (result.status === 0) return true;
      errorText = String(result.stderr || result.error?.message || "").trim();
      await delay(180);
    }
    throw new Error(errorText || "受限 X11 安全 Cookie 初始化失败");
  }

  async function availableDisplayNumber(excluded = new Set()) {
    const activeX11Processes = platform === "win32" ? "" : output("/bin/ps", ["-ax", "-o", "command="]);
    const activeWindowsDisplays = platform === "win32" ? windowsDisplayNumbers() : new Set();
    for (let candidate = 0; candidate <= 32; candidate += 1) {
      if (excluded.has(candidate)) continue;
      if (reservedDisplayNumbers.has(candidate)) continue;
      if (activeWindowsDisplays.has(candidate)) continue;
      if (platform !== "win32" && fs.existsSync(`/tmp/.X11-unix/X${candidate}`)) continue;
      if (platform !== "win32" && new RegExp(`(?:^|\\s)(?:\\S*\/)?(?:Xquartz|Xephyr|Xnest)\\s+:${candidate}(?:\\.\\d+)?(?=\\s|$)`, "im").test(activeX11Processes)) continue;
      const port = 6000 + candidate;
      if (await canConnect(port, 250)) continue;
      if (platform !== "win32" || await isPortFree(port)) return candidate;
    }
    throw new Error("没有可用的 X11 显示端口");
  }

  async function waitForNestedDisplay(displayNumber, processHandle, timeoutMs = 12000) {
    const socket = `/tmp/.X11-unix/X${displayNumber}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (processHandle && processHandle.exitCode !== null) break;
      if (fs.existsSync(socket)) return true;
      await delay(180);
    }
    return false;
  }

  async function installLinuxGraphicsComponents() {
    if (platform !== "linux") throw new Error("Linux 图形组件安装仅适用于 Linux 桌面版");
    const manager = linuxPackageManager();
    if (!manager) throw new Error("未检测到 apt-get、dnf 或 pacman，无法自动安装 Linux 图形组件");
    const missing = [];
    if (!linuxXdmcpExecutable()) missing.push(manager === "apt-get" ? "xserver-xephyr" : manager === "dnf" ? "xorg-x11-server-Xephyr" : "xorg-server-xephyr");
    if (!commandPath("xfreerdp3", platform) && !commandPath("xfreerdp", platform) && !commandPath("wlfreerdp", platform)) missing.push(manager === "apt-get" ? "freerdp2-x11" : "freerdp");
    if (!commandPath("xauth", platform)) missing.push(manager === "apt-get" ? "xauth" : "xorg-x11-xauth");
    if (!missing.length) return {ok:true, already_installed:true, diagnostics:diagnostics()};
    const args = manager === "apt-get"
      ? ["install", "-y", ...missing]
      : manager === "dnf"
        ? ["install", "-y", ...missing]
        : ["-S", "--noconfirm", ...missing];
    let command = manager;
    let commandArgs = args;
    if (process.getuid?.() !== 0) {
      if (commandPath("pkexec")) {
        command = "pkexec";
        commandArgs = [manager, ...args];
      } else if (commandPath("sudo")) {
        command = "sudo";
        commandArgs = ["-n", manager, ...args];
      } else {
        throw new Error("安装 Linux 图形组件需要 root、pkexec 或免密 sudo 权限");
      }
    }
    const result = await new Promise((resolve, reject) => {
      const childProcess = spawn(command, commandArgs, {
        stdio:["ignore", "pipe", "pipe"],
        env:{...environment, DEBIAN_FRONTEND:"noninteractive"}
      });
      let outputText = "";
      childProcess.stdout?.on("data", chunk => { outputText = (outputText + chunk.toString()).slice(-12000); });
      childProcess.stderr?.on("data", chunk => { outputText = (outputText + chunk.toString()).slice(-12000); });
      childProcess.once("error", reject);
      childProcess.once("close", code => code === 0 ? resolve(outputText) : reject(new Error(outputText.trim() || `安装命令退出 ${code}`)));
    });
    return {ok:true, installed:missing, output:String(result || "").trim(), diagnostics:diagnostics()};
  }

  async function startWindowsDisplay(executable, displayNumber) {
    fs.mkdirSync(runtimeDataDir, {recursive:true});
    const attemptAuthorityFile = path.join(runtimeDataDir, `authority-${process.pid}-${displayNumber}`);
    try { fs.rmSync(attemptAuthorityFile, {force:true}); } catch {}
    const cookie = crypto.randomBytes(16).toString("hex");
    const xauth = existingFile([path.join(path.dirname(executable), "xauth.exe")]);
    if (!xauth) throw new Error("X Server 运行时缺少 xauth.exe");
    let authResult = null;
    for (const displayName of [`:${displayNumber}`, `localhost:${displayNumber}`, `127.0.0.1:${displayNumber}`]) {
      authResult = spawnSync(xauth, ["-f", attemptAuthorityFile, "add", displayName, ".", cookie], {
        encoding:"utf8",
        windowsHide:true,
        timeout:5000
      });
      if (authResult.status !== 0) break;
    }
    if (authResult?.status !== 0 || !fs.existsSync(attemptAuthorityFile)) {
      throw new Error(`Xauthority 生成失败：${String(authResult?.stderr || authResult?.error?.message || "xauth 返回错误").trim()}`);
    }
    const numericAuthority = spawnSync(xauth, ["-f", attemptAuthorityFile, "nlist"], {
      encoding:"utf8",
      windowsHide:true,
      timeout:5000
    });
    const wildcardAuthority = wildcardXauthorityRecords(numericAuthority.stdout);
    const wildcardResult = wildcardAuthority ? spawnSync(xauth, ["-f", attemptAuthorityFile, "nmerge", "-"], {
      encoding:"utf8",
      windowsHide:true,
      timeout:5000,
      input:`${wildcardAuthority}\n`
    }) : null;
    if (numericAuthority.status !== 0 || !wildcardAuthority || wildcardResult?.status !== 0) {
      throw new Error(`Xauthority TCP 记录生成失败：${String(
        wildcardResult?.stderr || numericAuthority.stderr || wildcardResult?.error?.message || numericAuthority.error?.message || "xauth 返回错误"
      ).trim()}`);
    }

    const display = `127.0.0.1:${displayNumber}.0`;
    const runtimeDirectory = path.dirname(executable);
    const pathKey = environmentKey(environment, "PATH");
    const currentPath = String(environment[pathKey] || "");
    const pathEntries = currentPath.split(path.delimiter);
    const runtimePath = pathEntries.some(item => item.toLowerCase() === runtimeDirectory.toLowerCase())
      ? currentPath
      : `${runtimeDirectory}${path.delimiter}${currentPath}`;
    const launchEnvironment = {
      ...environment,
      [pathKey]:runtimePath,
      DISPLAY:display,
      XAUTHORITY:attemptAuthorityFile,
      TUNNELDESK_XAUTH:xauth
    };
    let launchError = "";
    let launchStderr = "";
    const processHandle = spawn(executable, [
      `:${displayNumber}`,
      "-multiwindow",
      // Keep VcXsrv's standard multiwindow composition path enabled. The
      // companion Windows window guard independently keeps native captions
      // reachable when an X11 client later positions itself at (0, 0).
      "-compositewm",
      "-swcursor",
      "-lesspointer",
      "-clipboard",
      // Allow the native Windows WGL path when the application and display
      // driver support it. Remote clients may still choose software rendering,
      // but -nowgl would unnecessarily disable the accelerated path entirely.
      "-wgl",
      "-dpi", "96",
      "-silent-dup-error",
      "+extension", "SECURITY",
      "-listen", "tcp",
      "-auth", attemptAuthorityFile
    ], {detached:false, stdio:["ignore", "ignore", "pipe"], windowsHide:true, env:launchEnvironment});
    processHandle.stderr?.on("data", chunk => { launchStderr = (launchStderr + chunk.toString()).slice(-8000); });
    processHandle.once("error", error => { launchError = error.message; });

    try {
      if (!await waitForDisplayPort(displayNumber, 8000, processHandle)) {
        if (processHandle.exitCode !== null && !launchError) {
          const collision = new Error(`X11 display :${displayNumber} is already in use`);
          collision.code = "X11_DISPLAY_COLLISION";
          throw collision;
        }
        throw new Error(launchError || launchStderr.trim() || "X Server 启动超时");
      }
      // VcXsrv opens the TCP listener before its auth/security extensions finish initializing.
      await waitForUntrustedXauth(display, xauth, attemptAuthorityFile);
      if (processHandle.exitCode !== null) {
        const collision = new Error(`X11 display :${displayNumber} exited during startup`);
        collision.code = "X11_DISPLAY_COLLISION";
        throw collision;
      }
    } catch (error) {
      try { if (processHandle.exitCode === null) processHandle.kill(); } catch {}
      const deadline = Date.now() + 2500;
      while (processHandle.exitCode === null && Date.now() < deadline) await delay(50);
      try { fs.rmSync(attemptAuthorityFile, {force:true}); } catch {}
      throw error;
    }

    child = processHandle;
    const windowGuard = startWindowsX11WindowGuard(processHandle, {environment});
    windowsWindowGuard = windowGuard;
    authorityFile = attemptAuthorityFile;
    managedDisplay = display;
    lastError = "";
    environment[pathKey] = runtimePath;
    environment.DISPLAY = display;
    environment.XAUTHORITY = attemptAuthorityFile;
    environment.TUNNELDESK_XAUTH = xauth;
    processHandle.once("exit", () => {
      if (windowsWindowGuard === windowGuard) {
        stopWindowsX11WindowGuard(windowGuard);
        windowsWindowGuard = null;
      }
      if (child !== processHandle) return;
      child = null;
      managedDisplay = "";
      if (environment.DISPLAY === display) delete environment.DISPLAY;
      if (environment.XAUTHORITY === attemptAuthorityFile) delete environment.XAUTHORITY;
      if (environment.TUNNELDESK_XAUTH === xauth) delete environment.TUNNELDESK_XAUTH;
    });
    return diagnostics();
  }

  async function startWindows() {
    const current = diagnostics();
    if (current.available) return current;
    const executable = current.executable;
    if (!executable) throw new Error("当前安装包未包含 X Server 运行时");
    return retryWindowsDisplayLaunch(
      excluded => availableDisplayNumber(excluded),
      displayNumber => startWindowsDisplay(executable, displayNumber)
    );
  }

  async function startMac() {
    const current = diagnostics();
    if (current.available) return current;
    if (!current.executable) throw new Error("未安装 XQuartz");
    const result = spawnSync("/usr/bin/open", ["-gj", current.executable], {encoding:"utf8", timeout:5000});
    if (result.status !== 0) throw new Error(String(result.stderr || "XQuartz 启动失败").trim());
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const next = diagnostics();
      if (next.available) {
        macStartedByTunnelDesk = true;
        return diagnostics();
      }
      await delay(200);
    }
    throw new Error("XQuartz 已启动，但没有找到可用的 DISPLAY");
  }

  async function stopMac(force = false) {
    const current = diagnostics();
    if (!current.running) return current;
    if (!force && !macStartedByTunnelDesk) return current;
    const result = spawnSync("/usr/bin/osascript", ["-e", 'tell application "XQuartz" to quit'], {
      encoding:"utf8",
      timeout:8000,
      windowsHide:true
    });
    if (result.status !== 0 && !force) throw new Error(String(result.stderr || "XQuartz 停止失败").trim());
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!xQuartzProcessState().running) break;
      await delay(150);
    }
    if (force && xQuartzProcessState().running) {
      killXQuartzProcesses("TERM");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (!xQuartzProcessState().running) break;
        await delay(150);
      }
    }
    if (force && xQuartzProcessState().running) {
      killXQuartzProcesses("KILL");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (!xQuartzProcessState().running) break;
        await delay(100);
      }
    }
    if (xQuartzProcessState().running) throw new Error("XQuartz 未能在限定时间内停止");
    macStartedByTunnelDesk = false;
    delete environment.DISPLAY;
    delete environment.XAUTHORITY;
    delete environment.TUNNELDESK_XAUTH;
    return diagnostics();
  }

  function verifyXQuartzPackage(file) {
    const bytes = fs.statSync(file).size;
    if (bytes !== XQUARTZ_BYTES) throw new Error(`XQuartz 安装包大小校验失败：${bytes}`);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (hash !== XQUARTZ_SHA256) throw new Error("XQuartz 安装包 SHA-256 校验失败");
    const signature = spawnSync("/usr/sbin/pkgutil", ["--check-signature", file], {
      encoding:"utf8",
      timeout:15000,
      windowsHide:true
    });
    const signatureText = `${signature.stdout || ""}\n${signature.stderr || ""}`;
    if (signature.status !== 0 || !signatureText.includes(XQUARTZ_TEAM_ID) || !/Notarization:\s*trusted/i.test(signatureText)) {
      throw new Error("XQuartz 安装包不是受信任的官方签名");
    }
    return {bytes, sha256:hash, team_id:XQUARTZ_TEAM_ID};
  }

  async function downloadXQuartzPackage() {
    fs.mkdirSync(runtimeDataDir, {recursive:true});
    const file = path.join(runtimeDataDir, `XQuartz-${XQUARTZ_VERSION}.pkg`);
    try {
      verifyXQuartzPackage(file);
      return file;
    } catch {
      try { fs.rmSync(file, {force:true}); } catch {}
    }
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      const response = await fetch(XQUARTZ_URL, {headers:{"User-Agent":"TunnelDesk-XQuartz-Installer"}, redirect:"follow"});
      if (!response.ok || !response.body) throw new Error(`XQuartz 下载失败：HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, {flags:"wx"}));
      verifyXQuartzPackage(temporary);
      fs.renameSync(temporary, file);
      return file;
    } finally {
      try { fs.rmSync(temporary, {force:true}); } catch {}
    }
  }

  async function installXQuartz() {
    if (platform !== "darwin") throw new Error("XQuartz 安装仅适用于 macOS 桌面版");
    const current = diagnostics();
    if (current.installed && current.xdmcp_client) return {ok:true, already_installed:true, diagnostics:current};
    const installer = await downloadXQuartzPackage();
    verifyXQuartzPackage(installer);
    const command = `/usr/sbin/installer -pkg ${JSON.stringify(installer)} -target /`;
    await new Promise((resolve, reject) => {
      const processHandle = spawn("/usr/bin/osascript", ["-e", `do shell script ${JSON.stringify(command)} with administrator privileges`], {
        stdio:["ignore", "pipe", "pipe"],
        windowsHide:true
      });
      let stderr = "";
      processHandle.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      processHandle.once("error", reject);
      processHandle.once("close", code => {
        if (code === 0) resolve(null);
        else reject(new Error(stderr.trim() || "XQuartz 安装被取消或失败"));
      });
    });
    const installed = diagnostics();
    if (!installed.installed) throw new Error("安装命令已完成，但没有检测到 XQuartz");
    try { fs.rmSync(installer, {force:true}); } catch {}
    return {ok:true, version:XQUARTZ_VERSION, restart_required:true, diagnostics:installed};
  }

  async function start() {
    lastError = "";
    try {
      if (platform === "win32") return await startWindows();
      if (platform === "darwin") return await startMac();
      const current = diagnostics();
      if (!current.available) throw new Error(current.reason);
      return current;
    } catch (error) {
      lastError = error?.message || String(error);
      throw error;
    }
  }

  async function stop(options = {}) {
    if (platform === "darwin") {
      await terminateTrackedXdmcpChildren(xdmcpChildren, reservedDisplayNumbers, {platform});
      return stopMac(Boolean(options.force));
    }
    if (platform === "win32") {
      await terminateTrackedXdmcpChildren(xdmcpChildren, reservedDisplayNumbers, {platform});
      const activeWindowGuard = windowsWindowGuard;
      windowsWindowGuard = null;
      stopWindowsX11WindowGuard(activeWindowGuard);
    }
    const active = child;
    child = null;
    if (active && active.exitCode === null) {
      try { active.kill(); } catch {}
      const deadline = Date.now() + 2500;
      while (active.exitCode === null && Date.now() < deadline) await delay(50);
    }
    const display = managedDisplay;
    managedDisplay = "";
    if (display && environment.DISPLAY === display) delete environment.DISPLAY;
    if (authorityFile && environment.XAUTHORITY === authorityFile) delete environment.XAUTHORITY;
    if (platform === "win32" && environment.TUNNELDESK_XAUTH) delete environment.TUNNELDESK_XAUTH;
    if (authorityFile) {
      try { fs.rmSync(authorityFile, {force:true}); } catch {}
    }
    authorityFile = "";
    return diagnostics();
  }

  async function openLinuxXdmcp(profile = {}) {
    const current = diagnostics();
    if (!current.display || !current.xdmcp_client) {
      throw new Error(current.display
        ? "Linux XDMCP 需要安装 Xephyr；请在 X Server 管理中安装 Linux 图形组件"
        : "Linux 当前桌面会话没有 DISPLAY，请从图形桌面启动 TunnelDesk");
    }
    const mode = new Set(["query", "indirect", "broadcast"]).has(String(profile.options?.mode))
      ? String(profile.options.mode)
      : "query";
    const host = String(profile.host || "").trim();
    if (mode !== "broadcast" && (!host || host.includes("\0") || /[\r\n]/.test(host))) throw new Error("XDMCP 目标主机无效");
    const port = Number(profile.port || 177);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("XDMCP 端口无效");
    const displayNumber = await availableDisplayNumber();
    const windowMode = profile.options?.window_mode === "fullscreen" ? "fullscreen" : "windowed";
    const width = Math.max(640, Math.min(7680, Number(profile.options?.width || 1440)));
    const height = Math.max(480, Math.min(4320, Number(profile.options?.height || 900)));
    const args = [`:${displayNumber}`];
    if (mode === "broadcast") args.push("-broadcast");
    else args.push(mode === "indirect" ? "-indirect" : "-query", host);
    args.push("-port", String(port));
    if (windowMode === "fullscreen") args.push("-fullscreen");
    else args.push("-screen", `${Math.round(width)}x${Math.round(height)}`);
    args.push("-terminate");
    const processHandle = spawn(current.xdmcp_client, args, {
      detached:false,
      stdio:["ignore", "pipe", "pipe"],
      windowsHide:true,
      env:environment
    });
    reservedDisplayNumbers.add(displayNumber);
    xdmcpChildren.set(processHandle, displayNumber);
    let launchError = "";
    processHandle.stderr?.on("data", chunk => { launchError = (launchError + chunk.toString()).slice(-8000); });
    processHandle.once("error", error => { launchError = error.message; });
    processHandle.once("exit", () => {
      reservedDisplayNumbers.delete(displayNumber);
      xdmcpChildren.delete(processHandle);
    });
    if (!await waitForNestedDisplay(displayNumber, processHandle)) {
      try { processHandle.kill(); } catch {}
      throw new Error(launchError.trim() || "Linux XDMCP 图形桌面启动超时，请确认服务器已启用 XDMCP/UDP 177");
    }
    return {
      ok:true,
      protocol:"xdmcp",
      client:path.basename(current.xdmcp_client),
      display:`:${displayNumber}.0`,
      pid:processHandle.pid,
      mode
    };
  }

  async function waitForMacXephyr(displayNumber, processHandle, timeoutMs = 12000) {
    const xwininfo = existingFile(["/opt/X11/bin/xwininfo", "/usr/X11/bin/xwininfo", commandPath("xwininfo", platform)]);
    const marker = `Xephyr on :${displayNumber}.0`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (processHandle && processHandle.exitCode !== null) break;
      if (xwininfo && output(xwininfo, ["-root", "-tree"], {env:environment}).includes(marker)) return true;
      await delay(180);
    }
    return false;
  }

  async function openMacXdmcp(profile = {}) {
    let current = diagnostics();
    if (!current.installed || !current.xdmcp_client) {
      throw new Error("macOS XDMCP 需要安装 XQuartz；请在当前页面安装后重试");
    }
    if (!current.available) current = await startMac();
    const mode = new Set(["query", "indirect", "broadcast"]).has(String(profile.options?.mode))
      ? String(profile.options.mode)
      : "query";
    const host = String(profile.host || "").trim();
    if (mode !== "broadcast" && (!host || host.includes("\0") || /[\r\n]/.test(host))) throw new Error("XDMCP 目标主机无效");
    const port = Number(profile.port || 177);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("XDMCP 端口无效");
    const displayNumber = await availableDisplayNumber();
    const windowMode = profile.options?.window_mode === "fullscreen" ? "fullscreen" : "windowed";
    const width = Math.max(640, Math.min(7680, Number(profile.options?.width || 1440)));
    const height = Math.max(480, Math.min(4320, Number(profile.options?.height || 900)));
    const args = [`:${displayNumber}`];
    if (mode === "broadcast") args.push("-broadcast");
    else args.push(mode === "indirect" ? "-indirect" : "-query", host);
    args.push("-port", String(port));
    if (windowMode === "fullscreen") args.push("-fullscreen");
    else args.push("-screen", `${Math.round(width)}x${Math.round(height)}`);
    args.push("-terminate");
    const processHandle = spawn(current.xdmcp_client, args, {
      detached:false,
      stdio:["ignore", "pipe", "pipe"],
      windowsHide:true,
      env:environment
    });
    reservedDisplayNumbers.add(displayNumber);
    xdmcpChildren.set(processHandle, displayNumber);
    let launchError = "";
    processHandle.stderr?.on("data", chunk => { launchError = (launchError + chunk.toString()).slice(-8000); });
    processHandle.once("error", error => { launchError = error.message; });
    processHandle.once("exit", () => {
      reservedDisplayNumbers.delete(displayNumber);
      xdmcpChildren.delete(processHandle);
    });
    if (!await waitForMacXephyr(displayNumber, processHandle)) {
      try { processHandle.kill(); } catch {}
      throw new Error(launchError.trim() || "macOS XDMCP 图形桌面启动超时，请确认远端已启用 XDMCP/UDP 177");
    }
    return {
      ok:true,
      protocol:"xdmcp",
      client:"TunnelDesk 内置 XDMCP（XQuartz）",
      display:`:${displayNumber}.0`,
      pid:processHandle.pid,
      mode
    };
  }

  async function openXdmcp(profile = {}) {
    if (platform === "linux") return openLinuxXdmcp(profile);
    if (platform === "darwin") return openMacXdmcp(profile);
    if (platform !== "win32") throw new Error("当前桌面版暂不支持 XDMCP 图形桌面");
    const executable = bundledWindowsExecutable() || installedWindowsExecutable();
    if (!executable) throw new Error("当前安装包未包含 X Server 运行时");
    const mode = new Set(["query", "indirect", "broadcast"]).has(String(profile.options?.mode))
      ? String(profile.options.mode)
      : "query";
    const host = String(profile.host || "").trim();
    if (mode !== "broadcast" && (!host || host.includes("\0") || /[\r\n]/.test(host))) throw new Error("XDMCP 目标主机无效");
    const port = Number(profile.port || 177);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("XDMCP 端口无效");
    const displayNumber = await availableDisplayNumber();
    const windowMode = profile.options?.window_mode === "fullscreen" ? "fullscreen" : "windowed";
    const width = Math.max(640, Math.min(7680, Number(profile.options?.width || 1440)));
    const height = Math.max(480, Math.min(4320, Number(profile.options?.height || 900)));
    const localAddress = String(profile.options?.local_address || "").trim();
    if (localAddress.includes("\0") || /[\r\n]/.test(localAddress)) throw new Error("XDMCP 本地地址无效");
    fs.mkdirSync(runtimeDataDir, {recursive:true});
    const launchLogFile = path.join(runtimeDataDir, `xdmcp-${process.pid}-${displayNumber}-${Date.now()}.log`);
    const args = [
      `:${displayNumber}`,
      mode === "broadcast" ? "-broadcast" : mode === "indirect" ? "-indirect" : "-query",
      ...(mode === "broadcast" ? [] : [host]),
      "-port", String(port),
      ...(localAddress ? ["-from", localAddress] : []),
      ...(windowMode === "fullscreen" ? ["-fullscreen"] : ["-screen", "0", `${Math.round(width)}x${Math.round(height)}`]),
      "-swcursor",
      "-lesspointer",
      "-clipboard",
      "-dpi", "96",
      "-silent-dup-error",
      "-once",
      "-terminate", "5",
      "-listen", "tcp",
      "-logfile", launchLogFile,
      "-logverbose", "3"
    ];
    const processHandle = spawn(executable, args, {
      detached:false,
      stdio:"ignore",
      windowsHide:false,
      env:environment
    });
    reservedDisplayNumbers.add(displayNumber);
    xdmcpChildren.set(processHandle, displayNumber);
    let launchError = "";
    processHandle.once("error", error => { launchError = error.message; });
    processHandle.once("exit", () => {
      launchError = launchError || readLogTail(launchLogFile);
      reservedDisplayNumbers.delete(displayNumber);
      xdmcpChildren.delete(processHandle);
      const cleanupTimer = setTimeout(() => {
        try { fs.rmSync(launchLogFile, {force:true}); } catch {}
      }, 30000);
      cleanupTimer.unref?.();
    });
    if (!await waitForDisplayPort(displayNumber, 8000, processHandle)) {
      try { processHandle.kill(); } catch {}
      launchError = launchError || readLogTail(launchLogFile);
      throw new Error(xdmcpLaunchFailureMessage(launchError, displayNumber));
    }
    if (!await waitForStableProcess(processHandle)) {
      launchError = launchError || readLogTail(launchLogFile);
      throw new Error(xdmcpLaunchFailureMessage(launchError, displayNumber));
    }
    return {
      ok:true,
      protocol:"xdmcp",
      client:bundledWindowsExecutable() ? "TunnelDesk 内置 X Server" : path.basename(executable),
      display:`127.0.0.1:${displayNumber}.0`,
      pid:processHandle.pid,
      mode
    };
  }

  async function testXdmcp(profile = {}) {
    const executable = platform === "win32"
      ? bundledWindowsExecutable() || installedWindowsExecutable()
      : platform === "linux"
        ? linuxXdmcpExecutable()
        : platform === "darwin"
          ? macXdmcpExecutable()
          : "";
    if (!executable) return {ok:false, protocol:"xdmcp", message:platform === "linux" ? "未安装 Xephyr，请在 X Server 管理中安装 Linux 图形组件" : platform === "darwin" ? "未安装 XQuartz，请在 X Server 管理中安装后重试" : "当前安装包未包含 X Server 运行时"};
    const mode = new Set(["query", "indirect", "broadcast"]).has(String(profile.options?.mode))
      ? String(profile.options.mode)
      : "query";
    const host = mode === "broadcast" ? "255.255.255.255" : String(profile.host || "").trim();
    const port = Number(profile.port || 177);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return {ok:false, protocol:"xdmcp", message:"XDMCP 目标地址无效"};
    return new Promise(resolve => {
      const socket = dgram.createSocket("udp4");
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        resolve(result);
      };
      const timer = setTimeout(() => finish({ok:false, protocol:"xdmcp", message:"XDMCP 服务未响应，请确认显示管理器已启用 XDMCP/UDP 177"}), 2500);
      socket.once("error", error => finish({ok:false, protocol:"xdmcp", message:error.message}));
      socket.on("message", message => {
        if (message.length < 6 || message.readUInt16BE(0) !== 1) return;
        const opcode = message.readUInt16BE(2);
        if (![5, 6].includes(opcode)) return;
        let offset = 6;
        if (opcode === 5) offset = readXdmcpText(message, offset).offset;
        const hostname = readXdmcpText(message, offset);
        const status = readXdmcpText(message, hostname.offset);
        finish({
          ok:opcode === 5,
          protocol:"xdmcp",
          client:platform === "win32" && bundledWindowsExecutable()
            ? "TunnelDesk 内置 X Server"
            : platform === "darwin"
              ? "TunnelDesk 内置 XDMCP（XQuartz）"
              : path.basename(executable),
          hostname:hostname.value,
          message:status.value || (opcode === 5 ? "XDMCP 服务可用" : "XDMCP 服务拒绝连接")
        });
      });
      socket.bind(0, "0.0.0.0", () => {
        if (mode === "broadcast") socket.setBroadcast(true);
        const packet = Buffer.alloc(7);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(mode === "broadcast" ? 1 : mode === "indirect" ? 3 : 2, 2);
        packet.writeUInt16BE(1, 4);
        packet[6] = 0;
        socket.send(packet, port, host, error => {
          if (error) finish({ok:false, protocol:"xdmcp", message:error.message});
        });
      });
    });
  }

  async function dispose() {
    await stop();
    await terminateTrackedXdmcpChildren(xdmcpChildren, reservedDisplayNumbers, {platform});
  }

  return { diagnostics, start, stop, installXQuartz, installLinuxGraphicsComponents, openXdmcp, testXdmcp, dispose };
}

module.exports = {
  createXServerRuntime,
  environmentKey,
  terminateTrackedXdmcpChildren,
  parseWindowsXServerDisplayNumbers,
  xdmcpLaunchFailureMessage,
  isWindowsDisplayCollisionError,
  retryWindowsDisplayLaunch,
  wildcardXauthorityRecords,
  parseXQuartzProcessIds,
  parseXQuartzProcessOutput,
  XQUARTZ_BYTES,
  XQUARTZ_SHA256,
  XQUARTZ_TEAM_ID,
  XQUARTZ_URL,
  XQUARTZ_VERSION
};
