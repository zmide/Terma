const { buildRemotePosixCommand } = require("../remote-posix");
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
const { componentInstallCommand } = require("../remote-component-installer");
const {
  createRemoteAdminGrant,
  releaseRemoteAdminGrant
} = require("./remote-admin-service");
const {
  remoteOfflineTasks,
  startRemoteComponentCommandTask
} = require("./remote-component-service");

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
    throw new Error("X11 组件安装操作无效");
  }
  if (["install-local-offline", "local-offline", "offline-local"].includes(action)) {
    const localPlan = plan.local_offline || plan.component_plan?.local_offline || {};
    const packages = localPlan.package_names || plan.local_offline_packages || [];
    if (!localPlan.available || !packages.length || plan.platform !== "linux" || plan.package_manager !== "apt") {
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${plan.package_manager || planResult.discovery?.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
    const grant = createRemoteAdminGrant(connection, data, "x11.remote-install-local-offline");
    if (!planResult.discovery?.privileged && !grant) throw new Error("此操作需要临时管理员授权");
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
    if (uninstalling) throw new Error(selected?.reason || "当前远端没有可安全自动执行的 X11 卸载方案，请查看手动说明");
    throw new Error(mode === "offline" ? "远端没有可用的 X11 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明" : "当前远端没有可自动执行的 X11 安装命令");
  }
  const grantScope = uninstalling ? "x11.remote-uninstall" : mode === "offline" ? "x11.remote-install-offline" : "x11.remote-install";
  const grant = createRemoteAdminGrant(connection, data, grantScope);
  if ((uninstalling || plan.requires_password) && !planResult.discovery?.privileged && !grant) throw new Error(`${uninstalling ? "卸载" : "安装"}远端 X11 组件需要临时管理员授权`);
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
    throw new Error(output || "SSH X11 转发配置探测失败");
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
  if (!["enable", "disable"].includes(String(action || ""))) throw new Error("SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw new Error("远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw new Error("修改 sshd_config 需要 root 或免密 sudo 权限；可以使用临时管理员授权");
  const commandConnection = { ...connection, x11_mode:"off" };
  const result = grant
    ? await runRemotePrivilegeCommand(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), {grant_id:grant.id, scope:"x11.sshd-config", timeout_ms:30000})
    : await runSshCommandForConnection(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), 30000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    throw new Error(output || `SSH X11 转发${action === "enable" ? "开启" : "关闭"}失败`);
  }
  const after = await detectSshX11ForConnection(connection);
  const expected = action === "enable";
  if (after.enabled !== expected) throw new Error(`sshd_config 已修改，但 sshd 的实际 X11 转发状态仍为${after.enabled ? "开启" : "关闭"}`);
  return { before, after, output:`${result.stdout || ""}${result.stderr || ""}`.trim(), temporary_authorization:Boolean(grant) };
}

async function startSshX11ConfigurationTask(connection, action, grant = null) {
  if (!["enable", "disable"].includes(String(action || ""))) throw new Error("SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw new Error("远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw new Error("修改 sshd_config 需要 root、免密 sudo 或临时管理员授权");
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
  configureSshX11ForConnection,
  detectSshX11ForConnection,
  installX11ApplicationsForConnection,
  startSshX11ConfigurationTask,
  verifyX11ApplicationForConnection,
  x11ApplicationsForConnection,
  x11InstallPlanForConnection
};
