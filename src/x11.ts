const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { buildRemotePosixCommand } = require("./remote-posix");
const { spawnSync } = require("node:child_process");
const { componentInstallPlan } = require("./remote-component-installer");

const X11_APPLICATION_CATALOG = [
  {id:"xterm", label:"XTerm", command:"xterm", category:"terminal", category_label:"终端", kind:"tool", mode:"untrusted"},
  {id:"konsole", label:"Konsole", command:"konsole", category:"terminal", category_label:"终端", kind:"tool", mode:"untrusted"},
  {id:"gnome-terminal", label:"GNOME Terminal", command:"gnome-terminal", category:"terminal", category_label:"终端", kind:"tool", mode:"untrusted"},
  {id:"xfce4-terminal", label:"XFCE Terminal", command:"xfce4-terminal", category:"terminal", category_label:"终端", kind:"tool", mode:"untrusted"},
  {id:"mate-terminal", label:"MATE Terminal", command:"mate-terminal", category:"terminal", category_label:"终端", kind:"tool", mode:"untrusted"},
  {id:"xclock", label:"XClock", command:"xclock", category:"tool", category_label:"小工具", kind:"tool", mode:"untrusted"},
  {id:"xeyes", label:"XEyes", command:"xeyes", category:"tool", category_label:"小工具", kind:"tool", mode:"untrusted"},
  {id:"xcalc", label:"XCalc", command:"xcalc", category:"tool", category_label:"小工具", kind:"tool", mode:"untrusted"},
  {id:"dolphin", label:"Dolphin 文件管理器", command:"dolphin", category:"file", category_label:"文件管理", kind:"tool", mode:"trusted"},
  {id:"nautilus", label:"GNOME 文件", command:"nautilus", category:"file", category_label:"文件管理", kind:"tool", mode:"trusted"},
  {id:"thunar", label:"Thunar 文件管理器", command:"thunar", category:"file", category_label:"文件管理", kind:"tool", mode:"trusted"},
  {id:"firefox", label:"Firefox", command:"firefox", category:"browser", category_label:"浏览器", kind:"tool", mode:"trusted"},
  {id:"chromium", label:"Chromium", command:"chromium", category:"browser", category_label:"浏览器", kind:"tool", mode:"trusted"},
  {id:"chromium-browser", label:"Chromium Browser", command:"chromium-browser", category:"browser", category_label:"浏览器", kind:"tool", mode:"trusted"},
  {id:"google-chrome", label:"Google Chrome", command:"google-chrome", category:"browser", category_label:"浏览器", kind:"tool", mode:"trusted"},
  {id:"plasma", label:"KDE Plasma 会话", command:"startplasma-x11", category:"desktop", category_label:"桌面会话", kind:"session", mode:"trusted"},
  {id:"gnome", label:"GNOME 会话", command:"gnome-session", category:"desktop", category_label:"桌面会话", kind:"session", mode:"trusted"},
  {id:"xfce", label:"XFCE 会话", command:"startxfce4", category:"desktop", category_label:"桌面会话", kind:"session", mode:"trusted"}
];

const X11_INSTALL_PACKAGES = {
  apt: ["xauth", "x11-apps", "xterm"],
  dnf: ["xorg-x11-xauth", "xorg-x11-apps", "xterm"],
  pacman: ["xorg-xauth", "xorg-apps", "xterm"],
  brew: ["xterm"]
};

const REMOTE_XQUARTZ_VERSION = "2.8.6";
const REMOTE_XQUARTZ_URL = `https://github.com/XQuartz/XQuartz/releases/download/XQuartz-${REMOTE_XQUARTZ_VERSION}/XQuartz-${REMOTE_XQUARTZ_VERSION}.pkg`;
const REMOTE_XQUARTZ_BYTES = 122035963;
const REMOTE_XQUARTZ_SHA256 = "9ac35a505095bfbd3009c3b4772f0c6421e2f79c4210ab908459270d1c447909";
const REMOTE_XQUARTZ_TEAM_ID = "NA574AWV7E";

function normalizeRemotePlatform(value) {
  const platform = String(value || "").toLowerCase();
  if (platform.includes("darwin") || platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return platform || "unknown";
}

function shellJoin(values) {
  return values.map(value => `'${String(value).replace(/'/g, `'\\''`)}'`).join(" ");
}

function remoteXQuartzInstallCommand() {
  return [
    "set -eu",
    "td_dir=$(mktemp -d -t tunneldesk-xquartz.XXXXXX)",
    "trap 'rm -rf \"$td_dir\"' EXIT INT TERM",
    `td_pkg="$td_dir/XQuartz-${REMOTE_XQUARTZ_VERSION}.pkg"`,
    `curl -fL --retry 3 --connect-timeout 20 -o "$td_pkg" ${shellJoin([REMOTE_XQUARTZ_URL])}`,
    `test "$(stat -f %z "$td_pkg")" = "${REMOTE_XQUARTZ_BYTES}"`,
    `test "$(shasum -a 256 "$td_pkg" | awk '{print $1}')" = "${REMOTE_XQUARTZ_SHA256}"`,
    `pkgutil --check-signature "$td_pkg" | grep -q ${shellJoin([REMOTE_XQUARTZ_TEAM_ID])}`,
    "sudo /usr/sbin/installer -pkg \"$td_pkg\" -target /",
    "test -x /opt/X11/bin/xauth",
    "printf '\\nXQuartz installation verified: /opt/X11/bin/xauth\\n'"
  ].join("; ");
}

function buildRemoteX11UninstallPlan(discovery: any = {}) {
  const platform = normalizeRemotePlatform(discovery.platform);
  if (platform === "macos") {
    return {
      available:false,
      command:"",
      reason:"XQuartz 会安装系统级组件，TunnelDesk 不会在无法确认安装来源时自动删除；请使用手动卸载说明"
    };
  }
  const packageManager = String(discovery.package_manager || "none").toLowerCase();
  const packages = X11_INSTALL_PACKAGES[packageManager] || [];
  if (!packages.length || packageManager === "brew") return null;
  const args = shellJoin(packages);
  const commands = {
    apt:`td_packages=""; for td_package in ${args}; do dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_packages`,
    dnf:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || dnf remove -y $td_packages`,
    pacman:`td_packages=""; for td_package in ${args}; do pacman -Q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || pacman -R --noconfirm $td_packages`
  };
  const command = commands[packageManager] || "";
  return command ? {
    available:true,
    package_manager:packageManager,
    package_names:packages,
    command,
    warning:"卸载会移除 TunnelDesk X11 探测建议中的基础工具；其他桌面或软件也可能正在使用这些组件"
  } : null;
}

function buildRemoteX11InstallPlan(discovery: any = {}) {
  const platform = normalizeRemotePlatform(discovery.platform);
  const packageManager = String(discovery.package_manager || "none").toLowerCase();
  const packages = X11_INSTALL_PACKAGES[packageManager] || [];
  const privileged = Boolean(discovery.privileged);
  if (platform === "macos") {
    const installed = Boolean(discovery.xquartz_installed && discovery.xauth_available);
    const plan = componentInstallPlan({
      component:"x11",
      label:"X11 组件",
      online_command:installed ? "" : remoteXQuartzInstallCommand(),
      online_description:"在远端 macOS 下载并校验 XQuartz 官方安装包",
      local_offline_available:false,
      local_offline_packages:[],
      local_offline_description:"macOS 使用 XQuartz 安装流程，不适用 Linux APT/.deb 本机离线包模式",
      manual_description:"查看 macOS XQuartz、xauth 和 SSH X11 转发配置说明"
    });
    return {
      supported:!installed,
      platform,
      package_manager:"xquartz",
      packages:[`XQuartz ${REMOTE_XQUARTZ_VERSION}`],
      optional_packages:[],
      command:installed ? "" : remoteXQuartzInstallCommand(),
      optional_commands:[],
      local_offline_packages:[],
      local_offline_command:"",
      component_plan:plan,
      modes:plan.modes,
      online:plan.online,
      offline:plan.offline,
      local_offline:plan.local_offline,
      manual:plan.manual,
      uninstall:buildRemoteX11UninstallPlan(discovery),
      requires_password:!privileged,
      restart_required:true,
      xquartz_installed:Boolean(discovery.xquartz_installed),
      instructions:installed
        ? ["远端 XQuartz 与 xauth 已安装，无需重复安装。", "如果刚开启 SSH X11 转发，请重新建立 SSH 会话后再启动图形程序。"]
        : ["TunnelDesk 会下载并校验 XQuartz 官方安装包，然后调用 macOS 安装器。", "终端出现 sudo 密码提示时，请输入远端 macOS 账号密码；安装后重新检测 X11 程序。"]
    };
  }
  if (!packages.length) {
    const plan = componentInstallPlan({
      component:"x11",
      label:"X11 组件",
      local_offline_available:false,
      local_offline_description:"未识别到 Debian/Ubuntu 或兼容 APT/.deb 包管理器，无法自动解析并上传 X11 软件包依赖",
      manual_description:"查看当前发行版手动安装 xauth 与常用 X11 程序的说明"
    });
    return {
      supported:false,
      platform,
      package_manager:packageManager,
      packages:[],
      command:"",
      local_offline_packages:[],
      local_offline_command:"",
      component_plan:plan,
      modes:plan.modes,
      online:plan.online,
      offline:plan.offline,
      local_offline:plan.local_offline,
      manual:plan.manual,
      uninstall:buildRemoteX11UninstallPlan(discovery),
      requires_password:false,
      instructions:["未识别到 apt、dnf 或 pacman。请在远端终端中按系统发行版手动安装 xauth 与常用 X11 应用。"]
    };
  }
  const command = packageManager === "brew"
    ? `brew install ${shellJoin(packages)}`
    : `${privileged ? "" : "sudo "}${packageManager} ${packageManager === "pacman" ? "-S --noconfirm" : "install -y"} ${shellJoin(packages)}`;
  const optional = packageManager === "apt"
      ? [`${privileged ? "" : "sudo "}apt-get install -y firefox`]
      : packageManager === "dnf"
        ? [`${privileged ? "" : "sudo "}dnf install -y firefox`]
        : packageManager === "pacman"
          ? [`${privileged ? "" : "sudo "}pacman -S --noconfirm firefox`]
        : [];
  const localOfflineCommand = packageManager === "apt"
    ? `DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${shellJoin(packages)}`
    : "";
  const plan = componentInstallPlan({
    component:"x11",
    label:"X11 组件",
    online_command:command,
    offline_command:localOfflineCommand,
    offline_description:packageManager === "apt" ? "只使用远端 apt 缓存，不访问软件源" : "只使用远端包管理器已有缓存",
    local_offline_available:packageManager === "apt",
    local_offline_packages:packageManager === "apt" ? packages : [],
    local_offline_command:localOfflineCommand,
    local_offline_description:packageManager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：TunnelDesk 在本机下载匹配的 X11 软件包和依赖，再通过 SFTP 上传并安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${packageManager || "未识别包管理器"}，无法自动解析并上传 X11 软件包依赖`,
    manual_description:"查看当前发行版、xauth 和常用 X11 应用的安装说明"
  });
  return {
    supported:true,
    platform,
    package_manager:packageManager,
    packages,
    optional_packages:["Firefox"],
    command,
    optional_commands:optional,
    local_offline_packages:packageManager === "apt" ? packages : [],
    local_offline_command:localOfflineCommand,
    component_plan:plan,
    modes:plan.modes,
    online:plan.online,
    offline:plan.offline,
    local_offline:plan.local_offline,
    manual:plan.manual,
    uninstall:buildRemoteX11UninstallPlan(discovery),
    requires_password:!privileged && packageManager !== "brew",
    instructions:["安装过程中如果终端出现 sudo 密码提示，请在该终端输入远端 Linux 账号密码。", "安装完成后返回 X11 图形应用窗口并点击重新识别。"]
  };
}

function posixQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const X11_DISCOVERY_SCRIPT = [
  "printf 'TD_X11_APPS_V1\\n'",
  "td_platform=$(uname -s 2>/dev/null || printf unknown)",
  "printf 'PLATFORM\\t%s\\n' \"$td_platform\"",
  "td_xauth=$(command -v xauth 2>/dev/null || true)",
  "[ -n \"$td_xauth\" ] || for td_candidate in /opt/X11/bin/xauth /usr/X11/bin/xauth /usr/bin/xauth; do [ -x \"$td_candidate\" ] && td_xauth=\"$td_candidate\" && break; done",
  "printf 'XAUTH\\t%s\\n' \"$td_xauth\"",
  "td_xquartz=0; [ -d /Applications/Utilities/XQuartz.app ] || [ -d /Applications/XQuartz.app ] || [ -x /opt/X11/bin/xauth ] && td_xquartz=1",
  "printf 'XQUARTZ\\t%s\\n' \"$td_xquartz\"",
  "td_package_manager=none",
  "command -v apt-get >/dev/null 2>&1 && td_package_manager=apt",
  "command -v dnf >/dev/null 2>&1 && td_package_manager=dnf",
  "command -v pacman >/dev/null 2>&1 && td_package_manager=pacman",
  "command -v brew >/dev/null 2>&1 && td_package_manager=brew",
  "printf 'PACKAGE_MANAGER\\t%s\\n' \"$td_package_manager\"",
  "td_privileged=0; [ \"$(id -u 2>/dev/null)\" = \"0\" ] && td_privileged=1; [ \"$td_privileged\" = \"1\" ] || sudo -n true >/dev/null 2>&1 && td_privileged=1",
  "printf 'PRIVILEGED\\t%s\\n' \"$td_privileged\"",
  ...X11_APPLICATION_CATALOG.map((item) => `td_path=$(command -v ${posixQuote(item.command)} 2>/dev/null || true); [ -n \"$td_path\" ] || for td_candidate in /opt/X11/bin/${posixQuote(item.command)} /usr/X11/bin/${posixQuote(item.command)}; do [ -x \"$td_candidate\" ] && td_path=\"$td_candidate\" && break; done; [ -n \"$td_path\" ] && printf 'APP\\t${item.id}\\t%s\\n' \"$td_path\"`),
  "exit 0"
].join("\n");

function cleanProbeValue(value, maximum = 2048) {
  return String(value || "").slice(0, maximum).replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function parseX11ApplicationDiscovery(value) {
  const output = String(value || "").slice(0, 128 * 1024).replace(/\r\n?/g, "\n");
  if (!output.split("\n").some((line) => line.trim() === "TD_X11_APPS_V1")) throw new Error("远端返回了无法识别的 X11 探测结果");
  let platform = "";
  let xauth = "";
  let packageManager = "none";
  let privileged = false;
  let xquartzInstalled = false;
  const paths = new Map();
  for (const line of output.split("\n")) {
    const [kind, rawId = "", ...rest] = line.split("\t");
    const id = cleanProbeValue(rawId, 128);
    const itemValue = cleanProbeValue(rest.join("\t"));
    if (kind === "PLATFORM") platform = id || itemValue;
    else if (kind === "XAUTH") xauth = id || itemValue;
    else if (kind === "PACKAGE_MANAGER") packageManager = (id || itemValue || "none").toLowerCase();
    else if (kind === "PRIVILEGED") privileged = (id || itemValue) === "1";
    else if (kind === "XQUARTZ") xquartzInstalled = (id || itemValue) === "1";
    else if (kind === "APP" && id && itemValue && !paths.has(id)) paths.set(id, itemValue);
  }
  const applications = X11_APPLICATION_CATALOG
    .filter((item) => paths.has(item.id))
    .map((item) => ({...item, path:paths.get(item.id)}));
  return {
    ok:true,
    platform:normalizeRemotePlatform(cleanProbeValue(platform, 128)),
    xauth_available:Boolean(xauth),
    xauth_path:xauth,
    xquartz_installed:xquartzInstalled,
    package_manager:packageManager,
    privileged,
    applications,
    count:applications.length,
    warnings:xauth
      ? []
      : [normalizeRemotePlatform(platform) === "macos"
          ? "远端未安装 XQuartz，缺少 xauth 与常用 X11 程序"
          : "远端探测未找到 xauth；如果终端已获得 DISPLAY 且图形程序可以打开，可继续使用，安装 xauth 可提高授权兼容性"]
  };
}

async function discoverRemoteX11Applications(runCommand) {
  const result = await runCommand(buildRemotePosixCommand(X11_DISCOVERY_SCRIPT));
  if (result?.status !== undefined && result.status !== 0) {
    const message = `${result.stderr || result.stdout || result.error?.message || "远端 X11 应用探测失败"}`.trim();
    throw new Error(message || "远端 X11 应用探测失败");
  }
  const discovery = parseX11ApplicationDiscovery(result?.stdout ?? result);
  return {...discovery, install_plan:buildRemoteX11InstallPlan(discovery)};
}

function normalizeX11ApplicationCommand(value) {
  const command = String(value || "").trim();
  if (!command || command.length > 2048 || /[\0\r\n]/.test(command)) throw new Error("请输入有效的 X11 图形程序");
  return command;
}

async function verifyRemoteX11Application(runCommand, value) {
  const command = normalizeX11ApplicationCommand(value);
  const script = `td_path=$(command -v ${posixQuote(command)} 2>/dev/null || true); [ -n \"$td_path\" ] || for td_candidate in /opt/X11/bin/${posixQuote(command)} /usr/X11/bin/${posixQuote(command)}; do [ -x \"$td_candidate\" ] && td_path=\"$td_candidate\" && break; done; if [ -n \"$td_path\" ]; then printf 'TD_X11_APP_OK\\t%s\\n' \"$td_path\"; else printf 'TD_X11_APP_MISSING\\n'; exit 127; fi`;
  const result = await runCommand(buildRemotePosixCommand(script));
  const output = String(result?.stdout || "").replace(/\r\n?/g, "\n");
  const found = output.split("\n").find((line) => line.startsWith("TD_X11_APP_OK\t"));
  if (result?.status !== 0 || !found) {
    const detail = String(result?.stderr || result?.error?.message || "").trim();
    throw new Error(detail || `远端未安装或无法执行 ${command}`);
  }
  return {ok:true, command, path:cleanProbeValue(found.slice("TD_X11_APP_OK\t".length))};
}

function commandOutput(command, args = []) {
  try {
    const result = spawnSync(command, args, {encoding:"utf8", windowsHide:true, timeout:3000});
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

function macXQuartzState() {
  const parsed = parseXQuartzProcessOutput(commandOutput("/bin/ps", ["-ax", "-o", "command="]));
  return {
    ...parsed,
    running:parsed.running || Boolean(commandOutput("/usr/bin/pgrep", ["-x", "Xquartz"]))
  };
}

function localX11Endpoint(value = process.platform === "darwin" ? macDisplay() : process.env.DISPLAY) {
  const display = String(value || "").trim();
  if (!display) throw new Error("本机 X Server 没有提供 DISPLAY");
  const match = display.match(/^(.*):(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`无法识别本机 DISPLAY：${display}`);
  const host = String(match[1] || "");
  const displayNumber = Number(match[2]);
  const screen = Number(match[3] || 0);
  if (!Number.isInteger(displayNumber) || displayNumber < 0 || displayNumber > 65535) throw new Error(`本机 DISPLAY 编号无效：${display}`);
  if (host.startsWith("/")) return {display, display_number:displayNumber, screen, socket_path:`${host}:${displayNumber}`};
  if (process.platform !== "win32" && (!host || host === "unix")) {
    return {display, display_number:displayNumber, screen, socket_path:`/tmp/.X11-unix/X${displayNumber}`};
  }
  return {display, display_number:displayNumber, screen, host:host || "127.0.0.1", port:6000 + displayNumber};
}

function xauthExecutable() {
  const discovered = commandOutput(process.platform === "win32" ? "where" : "which", [process.platform === "win32" ? "xauth.exe" : "xauth"])
    .split(/\r?\n/)[0] || "";
  const candidates = process.platform === "darwin"
    ? [process.env.TUNNELDESK_XAUTH, discovered, "/opt/X11/bin/xauth", "/usr/X11/bin/xauth", "/usr/bin/xauth"]
    : [process.env.TUNNELDESK_XAUTH, discovered];
  return String(candidates.find(file => {
    try { return file && fs.statSync(file).isFile(); } catch { return false; }
  }) || "").trim();
}

function localX11AuthorityFile() {
  const configured = String(process.env.XAUTHORITY || "").trim();
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform !== "darwin") return "";
  const discovered = macXQuartzState().authorityFile;
  return discovered && fs.existsSync(discovered) ? discovered : "";
}

function xauthCookieFromOutput(output, displayNumber) {
  const lines = String(output || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const matching = lines.find(line => new RegExp(`:${displayNumber}(?:\\.\\d+)?(?:\\s|$)`).test(line)) || lines[0] || "";
  const cookie = matching.split(/\s+/).at(-1) || "";
  if (!/^[0-9a-f]{32}$/i.test(cookie)) throw new Error("无法读取本机 X Server 授权 Cookie");
  return Buffer.from(cookie, "hex");
}

function localX11Authorization(mode = "untrusted") {
  const diagnostics = x11RuntimeDiagnostics();
  const endpoint = localX11Endpoint(diagnostics.display);
  const xauth = xauthExecutable();
  if (!xauth) throw new Error("本机缺少 xauth，无法建立内置 X11 转发");
  let authorityFile = "";
  const sourceAuthority = localX11AuthorityFile();
  try {
    if (mode === "untrusted") {
      authorityFile = path.join(os.tmpdir(), `tunneldesk-x11-${process.pid}-${crypto.randomUUID()}`);
      if (sourceAuthority) fs.copyFileSync(sourceAuthority, authorityFile);
      const generated = spawnSync(xauth, ["-f", authorityFile, "generate", endpoint.display, ".", "untrusted", "timeout", "600"], {
        encoding:"utf8",
        windowsHide:true,
        timeout:5000,
        env:process.env
      });
      if (generated.status !== 0) throw new Error(String(generated.stderr || generated.error?.message || "无法生成受限 X11 授权").trim());
    }
    const activeAuthority = authorityFile || sourceAuthority;
    const args = activeAuthority ? ["-f", activeAuthority, "list", endpoint.display] : ["list", endpoint.display];
    let listed = spawnSync(xauth, args, {encoding:"utf8", windowsHide:true, timeout:5000, env:process.env});
    if (listed.status !== 0 || !String(listed.stdout || "").trim()) {
      const fallbackArgs = activeAuthority ? ["-f", activeAuthority, "list"] : ["list"];
      listed = spawnSync(xauth, fallbackArgs, {encoding:"utf8", windowsHide:true, timeout:5000, env:process.env});
    }
    if (listed.status !== 0) throw new Error(String(listed.stderr || listed.error?.message || "无法读取本机 X Server 授权").trim());
    return {...endpoint, mode:mode === "trusted" ? "trusted" : "untrusted", cookie:xauthCookieFromOutput(listed.stdout, endpoint.display_number)};
  } finally {
    if (authorityFile) {
      try { fs.rmSync(authorityFile, {force:true}); } catch {}
    }
  }
}

function runningWindowsXServer() {
  const output = commandOutput("tasklist.exe", ["/FO", "CSV", "/NH"]);
  const names = ["vcxsrv.exe", "xming.exe", "xwin.exe", "x410.exe"];
  return names.find(name => output.toLowerCase().includes(`\"${name}\"`)) || "";
}

function installedWindowsXServer() {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = roots.flatMap(root => [
    path.join(root, "VcXsrv", "vcxsrv.exe"),
    path.join(root, "Xming", "Xming.exe"),
    path.join(root, "X410", "X410.exe")
  ]);
  return candidates.find(file => fs.existsSync(file)) || "";
}

function macDisplay() {
  const state = macXQuartzState();
  const display = String(state.display || commandOutput("/bin/launchctl", ["getenv", "DISPLAY"]) || process.env.DISPLAY || "").trim();
  if (state.running && display) {
    process.env.DISPLAY = display;
    const xauth = xauthExecutable();
    if (xauth) process.env.TUNNELDESK_XAUTH = xauth;
    if (state.authorityFile && fs.existsSync(state.authorityFile)) process.env.XAUTHORITY = state.authorityFile;
  }
  return display;
}

function x11RuntimeDiagnostics() {
  const platform = process.platform;
  if (platform === "win32") {
    const display = String(process.env.DISPLAY || "").trim();
    const running = runningWindowsXServer();
    const installed = running || installedWindowsXServer();
    const available = Boolean(display || running);
    return {
      available,
      installed:Boolean(installed),
      running:available,
      platform,
      server:running || (installed ? path.basename(installed) : ""),
      display,
      reason:available ? "本机 X Server 已就绪" : installed ? "已找到 X Server，但尚未运行" : "未检测到 VcXsrv、Xming、X410 或 DISPLAY"
    };
  }
  if (platform === "darwin") {
    const candidates = [
      "/Applications/Utilities/XQuartz.app",
      "/Applications/XQuartz.app",
      path.join(process.env.HOME || "", "Applications", "XQuartz.app")
    ];
    const application = candidates.find(file => file && fs.existsSync(file)) || "";
    const state = macXQuartzState();
    const display = macDisplay();
    const running = state.running;
    const available = Boolean(application && running && display);
    return {
      available,
      installed:Boolean(application),
      running,
      platform,
      server:application ? "XQuartz" : "",
      display,
      authority_file:state.authorityFile || String(process.env.XAUTHORITY || ""),
      reason:available ? "XQuartz 已就绪" : application ? running ? "XQuartz 正在运行，但当前会话未识别 DISPLAY" : "已安装 XQuartz，但尚未运行" : "未安装 XQuartz"
    };
  }
  const display = String(process.env.DISPLAY || "").trim();
  const xauth = commandOutput("which", ["xauth"]);
  return {
    available:Boolean(display && xauth),
    installed:Boolean(xauth),
    running:Boolean(display),
    platform,
    server:display ? "X11/XWayland" : "",
    display,
    reason:display ? (xauth ? "X11 显示与 xauth 已就绪" : "检测到 DISPLAY，但缺少 xauth") : "当前会话没有 DISPLAY"
  };
}

function terminalX11Environment() {
  const diagnostics = x11RuntimeDiagnostics();
  if (!diagnostics.display) return {};
  const environment: any = {DISPLAY:diagnostics.display};
  const xauth = xauthExecutable();
  if (xauth) environment.TUNNELDESK_XAUTH = xauth;
  if (diagnostics.authority_file) environment.XAUTHORITY = diagnostics.authority_file;
  return environment;
}

module.exports = {
  X11_APPLICATION_CATALOG,
  X11_DISCOVERY_SCRIPT,
  REMOTE_XQUARTZ_BYTES,
  REMOTE_XQUARTZ_SHA256,
  REMOTE_XQUARTZ_URL,
  REMOTE_XQUARTZ_VERSION,
  buildRemoteX11InstallPlan,
  buildRemoteX11UninstallPlan,
  discoverRemoteX11Applications,
  localX11Authorization,
  localX11Endpoint,
  parseXQuartzProcessOutput,
  parseX11ApplicationDiscovery,
  terminalX11Environment,
  verifyRemoteX11Application,
  x11RuntimeDiagnostics
};
