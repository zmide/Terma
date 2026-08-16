const { buildRemotePosixCommand } = require("../remote-posix");
const { publicError, remoteOutputError } = require("../public-error");
const {
  runRemotePrivilegeCommand
} = require("../remote-privilege");
const {
  runSshCommandForConnection
} = require("../ssh");
const {
  buildRemoteX11InstallPlan,
  discoverRemoteX11Applications,
  verifyRemoteX11Application
} = require("../x11");
const {
  DETECT_SCRIPT: SSH_X11_DETECT_SCRIPT,
  buildConfigureScript: buildSshX11ConfigureScript,
  buildInteractiveConfigureCommand: buildInteractiveSshX11ConfigureCommand,
  parseDetectionOutput: parseSshX11Detection
} = require("../x11-sshd-config");
const { componentInstallCommand, componentInstallPlan } = require("../remote-component-installer");
const {
  createRemoteAdminGrant,
  releaseRemoteAdminGrant
} = require("./remote-admin-service");
const {
  remoteOfflineTasks,
  startRemoteComponentCommandTask
} = require("./remote-component-service");

const X11_CLIPBOARD_DETECT_SCRIPT = `set +e
terma_emit() { printf 'TERMA_X11_CLIPBOARD_%s=%s\\n' "$1" "$(printf '%s' "$2" | tr '\\r\\n=' '   ')"; }
td_os=$(uname -s 2>/dev/null || printf unknown)
td_platform=unknown
[ "$td_os" = Linux ] && td_platform=linux
[ "$td_os" = Darwin ] && td_platform=macos
td_package_manager=""
for td_manager in apt dnf yum pacman zypper apk; do
  if command -v "$td_manager" >/dev/null 2>&1; then td_package_manager=$td_manager; break; fi
done
td_installed=false
if command -v xclip >/dev/null 2>&1; then td_installed=true; fi
td_root=false
[ "$(id -u 2>/dev/null)" = 0 ] && td_root=true
terma_emit PLATFORM "$td_platform"
terma_emit PACKAGE_MANAGER "$td_package_manager"
terma_emit INSTALLED "$td_installed"
terma_emit ROOT "$td_root"
terma_emit DISPLAY "\${DISPLAY:-}"`;

function parseX11ClipboardHelperDetection(output, connection) {
  const guideText = (key: string, params: any = {}) => ({i18n_key:`common:x11.${key}`, params});
  const values = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^TERMA_X11_CLIPBOARD_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  const platform = String(values.get("PLATFORM") || "unknown").toLowerCase();
  const manager = String(values.get("PACKAGE_MANAGER") || "").toLowerCase();
  const installed = String(values.get("INSTALLED") || "").toLowerCase() === "true";
  const root = String(values.get("ROOT") || "").toLowerCase() === "true";
  const onlineCommands = {
    apt:"DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y xclip",
    dnf:"dnf install -y xclip",
    yum:"yum install -y xclip",
    pacman:"pacman -S --noconfirm xclip",
    zypper:"zypper --non-interactive install xclip",
    apk:"apk add xclip"
  };
  const offlineCommands = {
    apt:"DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y xclip",
    dnf:"dnf --cacheonly install -y xclip",
    yum:"yum -C install -y xclip",
    pacman:"pacman -S --noconfirm --cachedir /var/cache/pacman/pkg xclip"
  };
  const uninstallCommands = {
    apt:"dpkg-query -W -f='${Status}' xclip 2>/dev/null | grep -q 'install ok installed' && DEBIAN_FRONTEND=noninteractive apt-get purge -y xclip || true",
    dnf:"rpm -q xclip >/dev/null 2>&1 && dnf remove -y xclip || true",
    yum:"rpm -q xclip >/dev/null 2>&1 && yum remove -y xclip || true",
    pacman:"pacman -Q xclip >/dev/null 2>&1 && pacman -R --noconfirm xclip || true",
    zypper:"rpm -q xclip >/dev/null 2>&1 && zypper --non-interactive remove xclip || true",
    apk:"apk info -e xclip >/dev/null 2>&1 && apk del xclip || true"
  };
  const installPlan = componentInstallPlan({
    component:"x11-clipboard-helper",
    label:"X11 图片剪贴板辅助",
    online_command:onlineCommands[manager] || "",
    online_description:`使用远端 ${manager || "软件包管理器"} 安装 xclip`,
    offline_command:offlineCommands[manager] || "",
    offline_description:"仅使用远端软件包缓存，不访问软件源",
    local_offline_available:platform === "linux" && manager === "apt",
    local_offline_packages:platform === "linux" && manager === "apt" ? ["xclip"] : [],
    local_offline_description:manager === "apt"
      ? "本机下载 xclip 及依赖，通过 SFTP 上传到远端后安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}`,
    manual_description:"查看 X11 转发、DISPLAY、xclip 和权限检查步骤"
  });
  const uninstall = {
    available:platform === "linux" && installed && Boolean(uninstallCommands[manager]),
    command:uninstallCommands[manager] || "",
    package_manager:manager,
    package_names:installed ? ["xclip"] : [],
    reason_code:platform !== "linux"
      ? "x11_clipboard_remote_not_linux"
      : installed
        ? uninstallCommands[manager] ? "" : "x11_clipboard_uninstall_method_unavailable"
        : "x11_clipboard_not_installed",
    reason_params:manager ? { package_manager:manager } : {},
    reason:platform !== "linux"
      ? "当前远端不是 Linux，Terma 不会安装或卸载 xclip"
      : installed
        ? uninstallCommands[manager] ? "" : "当前软件包管理器没有可安全自动卸载 xclip 的方案"
        : "当前没有检测到 xclip"
  };
  const guide = {
    title:guideText("clipboard_guide_title"),
    summary:guideText("clipboard_guide_summary"),
    steps:[
      guideText("clipboard_guide_xserver"),
      guideText("clipboard_guide_display"),
      guideText("clipboard_guide_verify"),
      guideText("clipboard_guide_uninstall_warning")
    ],
    commands:["command -v xclip", "printf test | xclip -selection clipboard -i", "xclip -selection clipboard -o -target image/png > /tmp/clipboard.png"]
  };
  return {
    ok:true,
    available:installed,
    installed,
    platform,
    package_manager:manager,
    root,
    display:String(values.get("DISPLAY") || ""),
    connection:{id:Number(connection?.id || 0), name:String(connection?.name || ""), host:String(connection?.ssh_host || ""), user:String(connection?.ssh_user || "")},
    install_plan:installPlan,
    uninstall_plan:uninstall,
    guide,
    reason_code:platform !== "linux"
      ? "x11_clipboard_remote_not_linux"
      : installed ? "x11_clipboard_ready" : "x11_clipboard_not_installed",
    reason_params:{},
    reason:platform !== "linux" ? "当前远端不是 Linux" : installed ? "" : "远端尚未安装 xclip；安装后可从 X11 转发终端粘贴图片"
  };
}

async function inspectX11ClipboardHelperForConnection(connection) {
  const result = await runSshCommandForConnection({...connection, x11_mode:"off"}, buildRemotePosixCommand(X11_CLIPBOARD_DETECT_SCRIPT), 12000);
  if (result?.status !== 0) {
    const output = `${result?.stderr || ""}${result?.stdout || ""}${result?.error ? result.error.message : ""}`.trim();
    if (output) throw remoteOutputError(output);
    throw publicError("X11_CLIPBOARD_PROBE_FAILED", "X11 图片剪贴板辅助探测失败");
  }
  return parseX11ClipboardHelperDetection(result.stdout, connection);
}

function validateX11ClipboardInstallSelection(before, mode, selected, uninstalling = false) {
  if (uninstalling) {
    if (!before.installed) throw publicError("X11_CLIPBOARD_NOT_INSTALLED", "当前远端没有安装 xclip");
    if (!selected?.available || !selected.command) throw publicError("X11_CLIPBOARD_UNINSTALL_UNAVAILABLE", selected?.reason || "当前系统没有可安全自动卸载 xclip 的方案");
    return true;
  }
  if (mode === "local-offline") {
    if (before.install_plan?.local_offline?.available !== true) throw publicError("X11_CLIPBOARD_LOCAL_OFFLINE_UNSUPPORTED", "本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统");
    return true;
  }
  if (!selected?.command) throw publicError("X11_CLIPBOARD_INSTALL_UNAVAILABLE", "当前系统没有可用的 xclip 安装方案，请查看手动安装说明");
  return true;
}

async function configureX11ClipboardHelperForConnection(connection, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall"].includes(action)) throw publicError("X11_CLIPBOARD_ACTION_INVALID", "X11 图片剪贴板辅助操作无效");
  const before = await inspectX11ClipboardHelperForConnection(connection);
  if (action === "guide") return before;
  if (before.platform !== "linux") throw publicError("X11_CLIPBOARD_LINUX_ONLY", "xclip 仅支持 Linux X11 远端", { platform:before.platform });
  const uninstalling = action === "uninstall";
  const mode = uninstalling ? "uninstall" : action === "install-local-offline" ? "local-offline" : action === "install-offline" ? "offline" : "online";
  const selected = uninstalling ? before.uninstall_plan : componentInstallCommand(before.install_plan, mode);
  validateX11ClipboardInstallSelection(before, mode, selected, uninstalling);
  const grant = createRemoteAdminGrant(connection, data, `x11.clipboard.${action}`);
  if (!before.root && !grant) {
    throw publicError(
      uninstalling ? "X11_CLIPBOARD_UNINSTALL_ADMIN_REQUIRED" : "X11_CLIPBOARD_INSTALL_ADMIN_REQUIRED",
      `${uninstalling ? "卸载" : "安装"} xclip 需要临时管理员授权`
    );
  }
  if (mode === "local-offline") {
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"x11-clipboard-helper",
        component_label:"X11 图片剪贴板辅助",
        resource_key:`x11-clipboard:${Number(connection.id || 0)}`,
        packages:before.install_plan.local_offline.package_names || ["xclip"],
        grant,
        elevate:true,
        direct_root:Boolean(before.root),
        scope:"x11.clipboard.install-local-offline",
        verify:() => inspectX11ClipboardHelperForConnection(connection),
        validate:after => Boolean(after?.installed) || "xclip 离线安装已结束，但重新探测后仍未安装",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode, before, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const task = startRemoteComponentCommandTask({
    connection,
    component:"x11-clipboard-helper",
    componentLabel:"X11 图片剪贴板辅助",
    resourceKey:`x11-clipboard:${Number(connection.id || 0)}`,
    action,
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode,
    command:selected.command,
    before,
    grant,
    scope:`x11.clipboard.${action}`,
    timeoutMs:20 * 60 * 1000,
    directRoot:Boolean(before.root),
    verify:() => inspectX11ClipboardHelperForConnection(connection),
    validate:after => uninstalling
      ? !after?.installed || "xclip 卸载命令已结束，但重新探测后仍已安装"
      : Boolean(after?.installed) || "xclip 安装命令已结束，但重新探测后仍未安装"
  });
  return {ok:true, action, mode, before, task, temporary_authorization:Boolean(grant)};
}

async function x11ApplicationsForConnection(connection) {
  return discoverRemoteX11Applications(
    async command => runSshCommandForConnection(connection, command, 12000)
  );
}

async function x11InstallPlanForConnection(connection) {
  const discovery = await x11ApplicationsForConnection(connection);
  return {
    discovery,
    install_plan:discovery.install_plan || buildRemoteX11InstallPlan(discovery)
  };
}

function removeKnownSudoWrappers(command) {
  return String(command || "")
    .replace(/\bsudo\s+(?=(?:\/usr\/sbin\/installer|apt-get\b|dnf\b|pacman\b|yum\b|zypper\b))/g, "");
}

async function installX11ApplicationsForConnection(connection, data: any = {}) {
  const planResult = await x11InstallPlanForConnection(connection);
  const plan = planResult.install_plan || planResult.discovery?.install_plan || {};
  const action = String(data?.action || "install").trim().toLowerCase();
  if (!["install", "install-offline", "install-local-offline", "online", "offline", "local-offline", "offline-local", "uninstall"].includes(action)) {
    throw publicError("X11_COMPONENT_ACTION_INVALID", "X11 组件安装操作无效");
  }
  if (["install-local-offline", "local-offline", "offline-local"].includes(action)) {
    const localPlan = plan.local_offline || plan.component_plan?.local_offline || {};
    const packages = localPlan.package_names || plan.local_offline_packages || [];
    if (!localPlan.available || !packages.length || plan.platform !== "linux" || plan.package_manager !== "apt") {
      const manager = plan.package_manager || planResult.discovery?.package_manager || "non-apt";
      throw publicError("X11_COMPONENT_LOCAL_OFFLINE_UNSUPPORTED", `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager}，请返回选择其他可用方式`, { manager });
    }
    const grant = createRemoteAdminGrant(connection, data, "x11.remote-install-local-offline");
    if (!planResult.discovery?.privileged && !grant) throw publicError("X11_COMPONENT_INSTALL_ADMIN_REQUIRED", "此操作需要临时管理员授权");
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"x11",
        component_label:"X11 组件",
        resource_key:`x11-components:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(planResult.discovery?.privileged),
        scope:"x11.remote-install-local-offline",
        verify:() => x11ApplicationsForConnection(connection),
        validate:after => Boolean(after?.xauth_available) || "X11 离线安装已结束，但远端仍未检测到 xauth",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action:"install-local-offline", mode:"local-offline", discovery:planResult.discovery, install_plan:plan, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const uninstalling = action === "uninstall";
  const mode = ["install-offline", "offline"].includes(action) ? "offline" : "online";
  const selected = uninstalling ? plan.uninstall : componentInstallCommand(plan.component_plan || plan, mode)
    || (mode === "online" ? componentInstallCommand(plan.component_plan || plan, "install") : null);
  const command = String(selected?.command || (uninstalling ? "" : mode === "online" ? plan.command : plan.offline_command) || "").trim();
  if (!command) {
    if (uninstalling) throw publicError("X11_COMPONENT_UNINSTALL_UNAVAILABLE", selected?.reason || "当前远端没有可安全自动执行的 X11 卸载方案，请查看手动说明");
    throw publicError(
      mode === "offline" ? "X11_COMPONENT_OFFLINE_CACHE_UNAVAILABLE" : "X11_COMPONENT_INSTALL_UNAVAILABLE",
      mode === "offline" ? "远端没有可用的 X11 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明" : "当前远端没有可自动执行的 X11 安装命令"
    );
  }
  const grantScope = uninstalling ? "x11.remote-uninstall" : mode === "offline" ? "x11.remote-install-offline" : "x11.remote-install";
  const grant = createRemoteAdminGrant(connection, data, grantScope);
  if ((uninstalling || plan.requires_password) && !planResult.discovery?.privileged && !grant) {
    throw publicError(
      uninstalling ? "X11_COMPONENT_UNINSTALL_ADMIN_REQUIRED" : "X11_COMPONENT_INSTALL_ADMIN_REQUIRED",
      `${uninstalling ? "卸载" : "安装"}远端 X11 组件需要临时管理员授权`
    );
  }
  const task = startRemoteComponentCommandTask({
    connection,
    component:"x11",
    componentLabel:"X11 组件",
    resourceKey:`x11-components:${Number(connection.id || 0)}`,
    action:uninstalling ? "uninstall" : mode === "offline" ? "install-offline" : "install",
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode:uninstalling ? "uninstall" : mode,
    command,
    before:planResult.discovery,
    grant,
    scope:grantScope,
    directRoot:Boolean(planResult.discovery?.privileged),
    normalizeCommand:value => grant ? removeKnownSudoWrappers(value) : value,
    verify:() => x11ApplicationsForConnection(connection),
    validate:after => uninstalling
      ? !after?.xauth_available || "X11 卸载命令已结束，但远端仍检测到 xauth"
      : Boolean(after?.xauth_available) || "X11 安装命令已结束，但远端仍未检测到 xauth"
  });
  return {ok:true, action:task.action, mode:task.mode, discovery:planResult.discovery, install_plan:plan, task, temporary_authorization:Boolean(grant)};
}

async function detectSshX11ForConnection(connection) {
  const probeConnection = { ...connection, x11_mode:"off" };
  const result = await runSshCommandForConnection(probeConnection, buildRemotePosixCommand(SSH_X11_DETECT_SCRIPT), 15000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    if (output) throw remoteOutputError(output);
    throw publicError("SSH_X11_PROBE_FAILED", "SSH X11 转发配置探测失败");
  }
  const diagnostics = parseSshX11Detection(result.stdout);
  return {
    ...diagnostics,
    terminal_commands:diagnostics.can_terminal_manage ? {
      enable:buildInteractiveSshX11ConfigureCommand("enable"),
      disable:buildInteractiveSshX11ConfigureCommand("disable")
    } : {},
    connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user}
  };
}

async function configureSshX11ForConnection(connection, action, grant = null) {
  if (!["enable", "disable"].includes(String(action || ""))) throw publicError("SSH_X11_ACTION_INVALID", "SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw publicError("SSH_X11_CONFIG_NOT_FOUND", "远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw publicError("SSH_X11_ADMIN_REQUIRED", "修改 sshd_config 需要 root 或免密 sudo 权限；可以使用临时管理员授权");
  const commandConnection = { ...connection, x11_mode:"off" };
  const result = grant
    ? await runRemotePrivilegeCommand(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), {grant_id:grant.id, scope:"x11.sshd-config", timeout_ms:30000})
    : await runSshCommandForConnection(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), 30000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    if (output) throw remoteOutputError(output);
    throw publicError(action === "enable" ? "SSH_X11_ENABLE_FAILED" : "SSH_X11_DISABLE_FAILED", `SSH X11 转发${action === "enable" ? "开启" : "关闭"}失败`);
  }
  const after = await detectSshX11ForConnection(connection);
  const expected = action === "enable";
  if (after.enabled !== expected) throw publicError("SSH_X11_STATE_MISMATCH", `sshd_config 已修改，但 sshd 的实际 X11 转发状态仍为${after.enabled ? "开启" : "关闭"}`, { enabled:Boolean(after.enabled) });
  return { before, after, output:`${result.stdout || ""}${result.stderr || ""}`.trim(), temporary_authorization:Boolean(grant) };
}

async function startSshX11ConfigurationTask(connection, action, grant = null) {
  if (!["enable", "disable"].includes(String(action || ""))) throw publicError("SSH_X11_ACTION_INVALID", "SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw publicError("SSH_X11_CONFIG_NOT_FOUND", "远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw publicError("SSH_X11_ADMIN_REQUIRED", "修改 sshd_config 需要 root、免密 sudo 或临时管理员授权");
  const expected = action === "enable";
  const task = startRemoteComponentCommandTask({
    connection:{...connection, x11_mode:"off"},
    component:"x11-forwarding",
    componentLabel:"SSH X11 转发",
    resourceKey:`x11-forwarding:${Number(connection.id || 0)}`,
    action,
    actionLabel:expected ? "开启" : "关闭",
    mode:"service",
    command:buildSshX11ConfigureScript(action),
    before,
    grant,
    scope:"x11.sshd-config",
    timeoutMs:30000,
    verify:() => detectSshX11ForConnection(connection),
    validate:after => after?.enabled === expected || `sshd_config 已修改，但 SSH X11 转发仍为${after?.enabled ? "开启" : "关闭"}`
  });
  return {ok:true, action, before, task, temporary_authorization:Boolean(grant)};
}

async function verifyX11ApplicationForConnection(connection, command) {
  return verifyRemoteX11Application(
    async script => runSshCommandForConnection(connection, script, 12000),
    command
  );
}

module.exports = {
  X11_CLIPBOARD_DETECT_SCRIPT,
  configureX11ClipboardHelperForConnection,
  configureSshX11ForConnection,
  detectSshX11ForConnection,
  inspectX11ClipboardHelperForConnection,
  parseX11ClipboardHelperDetection,
  validateX11ClipboardInstallSelection,
  installX11ApplicationsForConnection,
  startSshX11ConfigurationTask,
  verifyX11ApplicationForConnection,
  x11ApplicationsForConnection,
  x11InstallPlanForConnection
};
