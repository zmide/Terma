const { getConnection, listConnections, repairRemoteProfileManagementConnection } = require("../db");
const { componentInstallCommand } = require("../remote-component-installer");
const { runSshCommandForConnection } = require("../ssh");
const {
  buildVncStartCommand,
  detectVncServer,
  validateVncServerComponent,
  vncServerStartValidation,
  vncServerStopValidation
} = require("../vnc-server-manager");
const {
  clearVncClipboardCapabilityCache,
  inspectVncClipboardHelper,
  vncClipboardHelperGuideResult
} = require("../vnc-clipboard");
const {
  createRemoteAdminGrant,
  releaseRemoteAdminGrant
} = require("./remote-admin-service");
const {
  normalizeVncRemoteCommandResult,
  remoteOfflineTasks,
  startRemoteComponentCommandTask
} = require("./remote-component-service");

async function inspectVncServerForProfile(profile) {
  return detectVncServer(profile, {
    getConnection,
    listConnections,
    repairManagementConnection:(item, connectionId) => repairRemoteProfileManagementConnection(item.id, connectionId),
    runSshCommandForConnection
  });
}

function selectedVncComponentState(diagnostics: any = {}, targetComponent = "") {
  const component = String(targetComponent || diagnostics.target_component || diagnostics.server_session_selection?.component || "").trim();
  if (!component) return null;
  return diagnostics.selected_component
    || diagnostics.component_states?.[component]
    || null;
}

function vncComponentListening(diagnostics: any = {}, targetComponent = "") {
  const state = selectedVncComponentState(diagnostics, targetComponent);
  return state ? state.listening === true : diagnostics.listening === true;
}

function waitMs(timeoutMs) {
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

async function waitForVncServerAction(profile, targetComponent, action, initial = null) {
  const starting = ["start", "restart", "enable"].includes(action);
  let latest = initial;
  const attempts = starting ? 12 : 8;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await inspectVncServerForProfile(profile);
    const state = selectedVncComponentState(latest, targetComponent);
    const ready = state ? state.listening === true : latest?.listening === true;
    const running = state ? state.running === true : latest?.service_state === "active";
    if (starting && ready) return latest;
    if (!starting && !running && !ready) return latest;
    if (starting && state && (state.service_state === "failed" || state.listener_mismatch)) return latest;
    if (attempt + 1 < attempts) await waitMs(starting ? 750 : 500);
  }
  return latest;
}

async function configureVncServerForProfile(profile, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall", "start", "stop", "restart", "enable", "disable"].includes(action)) throw new Error("VNC 服务操作无效");
  const before = await inspectVncServerForProfile(profile);
  const targetComponent = String(before.server_session_selection?.component || before.selected_component?.key || "").trim();
  const targetComponentLabel = String(before.selected_component?.label || "VNC 服务");
  if (action === "guide") return {
    ok:true,
    action,
    before,
    after:before,
    guide:before.guide,
    install_plan:before.install_plan || null,
    uninstall_plan:before.uninstall_plan || null,
    service_actions:before.service_actions || {}
  };
  const connectionId = Number(before.ssh_connection?.id || profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0);
  if (!connectionId) throw new Error("该 VNC 连接没有关联的 SSH 管理连接，无法执行远程操作");
  const connection = getConnection(connectionId);
  let command = "";
  let mode = action;
  if (action === "install-local-offline") {
    const localPlan = before.install_plan?.local_offline || before.package_plan?.local_offline;
    const packages = localPlan?.package_names || before.package_plan?.local_offline_packages || [];
    if (before.platform !== "linux" || before.package_manager !== "apt" || !localPlan?.available || !packages.length) {
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || before.platform || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
  } else if (action === "install" || action === "install-offline") {
    mode = action === "install-offline" ? "offline" : "online";
    const selected = componentInstallCommand(before.install_plan, mode)
      || (mode === "online" ? componentInstallCommand(before.install_plan, "install") : null);
    command = String(selected?.command || before.package_plan?.[mode === "offline" ? "offline_command" : "command"] || "").trim();
    if (!command) throw new Error(action === "install-offline" ? "远端没有可用的 VNC 离线缓存包，请改用在线安装或手动说明" : "当前 Linux 发行版没有可用的在线安装方案，请打开手动安装说明");
  } else if (["start", "restart", "enable"].includes(action)) {
    const savedPassword = String(data.vnc_password || data.password || profile.password || "");
    const startPlan = before.start_plan || null;
    const supportsNoPassword = startPlan?.supports_no_password === true;
    const allowNoPassword = data.allow_no_password === true;
    if (allowNoPassword && !supportsNoPassword) {
      throw new Error("当前 VNC 服务方案不支持明确的无密码模式");
    }
    const hasRemotePasswordFile = Boolean(String(before.password_file || "").trim());
    if (!savedPassword && !hasRemotePasswordFile && !allowNoPassword && (supportsNoPassword || startPlan?.requires_vnc_password === true)) {
      throw new Error("请先输入 VNC 密码，再配置并启动服务");
    }
    command = startPlan
      ? buildVncStartCommand(before, savedPassword, {allow_no_password:allowNoPassword})
      : "";
    if (!command) throw new Error(before.start_plan?.requires_vnc_password ? "请先在 VNC 连接设置中保存连接密码，再配置并启动服务" : "没有检测到可自动配置/启动的 VNC 服务方案，请打开手动配置说明");
    mode = "service";
  } else if (["stop", "disable"].includes(action)) {
    const selected = before.service_actions?.[action] || before.package_plan?.service_actions?.[action];
    command = String(selected?.command || "").trim();
    if (!selected?.available || !command) throw new Error(selected?.reason || `没有检测到可自动${action === "stop" ? "停止" : "禁用"}的 VNC 服务`);
    mode = "service";
  } else if (action === "uninstall") {
    const selected = before.uninstall_plan || before.package_plan?.uninstall;
    command = String(selected?.command || "").trim();
    if (!selected?.available || !command) throw new Error(selected?.reason || "当前主机没有可安全自动执行的 VNC 卸载方案，请查看手动说明");
    mode = "uninstall";
  }
  const grant = createRemoteAdminGrant(connection, data, `vnc.server.${action}`);
  if (!before.privileged && !grant) throw new Error("此操作需要临时管理员授权");
  if (action === "install-local-offline") {
    const localPlan = before.install_plan?.local_offline || before.package_plan?.local_offline;
    const packages = localPlan?.package_names || before.package_plan?.local_offline_packages || [];
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"vnc-server",
        component_label:targetComponentLabel,
        resource_key:`vnc-server:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(before.privileged),
        scope:"vnc.server.install-local-offline",
        verify:() => inspectVncServerForProfile(profile),
        validate:after => targetComponent
          ? validateVncServerComponent(after, targetComponent, true)
          : Boolean(after?.installed) || "VNC 离线安装已结束，但远端仍未检测到 VNC Server",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode:"local-offline", before, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const actionLabels = {
    install:"在线安装", "install-offline":"使用远端缓存安装", uninstall:"卸载",
    start:"启动", stop:"停止", restart:"重新启动", enable:"启用并启动", disable:"停止并禁用"
  };
  const task = startRemoteComponentCommandTask({
    connection,
    component:"vnc-server",
    componentLabel:targetComponentLabel,
    resourceKey:`vnc-server:${Number(connection.id || 0)}`,
    action,
    actionLabel:actionLabels[action] || action,
    mode,
    command,
    before,
    grant,
    scope:`vnc.server.${action}`,
    timeoutMs:action === "install" || action === "install-offline" || action === "uninstall" ? 20 * 60 * 1000 : 120000,
    directRoot:Boolean(before.root),
    normalizeResult:normalizeVncRemoteCommandResult,
    verify:() => ["start", "restart", "enable", "stop", "disable"].includes(action)
      ? waitForVncServerAction(profile, targetComponent, action)
      : inspectVncServerForProfile(profile),
    validate:after => {
      if (action === "install" || action === "install-offline") return targetComponent
        ? validateVncServerComponent(after, targetComponent, true)
        : Boolean(after?.installed) || "VNC 安装命令已结束，但远端仍未检测到 VNC Server";
      if (action === "uninstall") return targetComponent
        ? validateVncServerComponent(after, targetComponent, false)
        : !after?.installed || "VNC 卸载命令已结束，但远端仍检测到 VNC Server";
      if (["start", "restart", "enable"].includes(action)) return targetComponent
        ? vncServerStartValidation(after, targetComponent)
        : vncComponentListening(after, targetComponent) || "VNC 服务命令已结束，但目标端口仍未监听";
      return targetComponent
        ? vncServerStopValidation(after, targetComponent)
        : !vncComponentListening(after, targetComponent) || "VNC 服务命令已结束，但目标端口仍在监听";
    }
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:before.install_plan || null,
    uninstall_plan:before.uninstall_plan || null,
    service_actions:before.service_actions || {},
    task,
    temporary_authorization:Boolean(grant),
    guide:before.guide
  };
}

async function inspectVncClipboardHelperForProfile(profile) {
  clearVncClipboardCapabilityCache();
  return inspectVncClipboardHelper(profile, {
    getConnection,
    listConnections,
    repairManagementConnection:(item, connectionId) => repairRemoteProfileManagementConnection(item.id, connectionId),
    runSshCommandForConnection
  });
}

async function configureVncClipboardHelperForProfile(profile, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall"].includes(action)) throw new Error("剪贴板辅助工具操作无效");
  const requestedConnectionId = Number(data.connection_id || 0);
  const inspectionProfile = requestedConnectionId > 0
    ? {...profile, options:{...(profile.options || {}), source_ssh_connection_id:requestedConnectionId}}
    : profile;
  const before = await inspectVncClipboardHelperForProfile(inspectionProfile);
  if (action === "guide") return vncClipboardHelperGuideResult(before);
  const uninstalling = action === "uninstall";
  if (before.platform === "macos") throw new Error(uninstalling
    ? "macOS 的 pbcopy/pbpaste 是系统自带工具，Terma 不提供卸载"
    : "macOS 已自带 pbcopy/pbpaste，无需安装；请按检查说明确认图形登录会话和剪贴板权限");
  if (before.platform !== "linux") throw new Error(`尚未识别到 Linux 远端，无法自动${uninstalling ? "卸载" : "安装"}剪贴板辅助工具`);
  const connectionId = Number(before.connection_id || 0);
  if (!connectionId) throw new Error("VNC 连接没有可用的 SSH 剪贴板辅助连接");
  const connection = getConnection(connectionId);
  const mode = uninstalling ? "uninstall" : action === "install-local-offline" ? "local-offline" : action === "install-offline" ? "offline" : "online";
  const selected = uninstalling
    ? before.uninstall_plan || before.install_plan?.uninstall
    : componentInstallCommand(before.install_plan, mode);
  if (mode === "local-offline" && before.install_plan?.local_offline?.available !== true) {
    throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
  }
  if (uninstalling) {
    if (!before.available) throw new Error("当前没有检测到可卸载的 Linux 剪贴板辅助工具");
    if (!selected?.available || !String(selected.command || "").trim()) throw new Error(selected?.reason || "当前系统没有可安全自动执行的剪贴板辅助卸载方案");
  } else if (!selected?.command && !selected?.package_names?.length) {
    throw new Error("当前系统没有可用的此类安装方案，请查看手动安装说明");
  }
  const grant = createRemoteAdminGrant(connection, data, `vnc.clipboard-helper.${action}`);
  if (!before.root && !grant) throw new Error(`${uninstalling ? "卸载" : "安装"}剪贴板辅助工具需要临时管理员授权`);
  if (mode === "local-offline") {
    const packages = selected.package_names || [];
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"vnc-clipboard-helper",
        component_label:"Unicode 剪贴板辅助工具",
        resource_key:`vnc-clipboard-helper:${Number(connection.id || 0)}`,
        packages,
        package_alternatives:before.install_plan?.package_alternatives || [],
        grant,
        elevate:true,
        direct_root:Boolean(before.root),
        before,
        scope:"vnc.clipboard-helper.install-local-offline",
        verify:async () => {
          clearVncClipboardCapabilityCache();
          return inspectVncClipboardHelperForProfile(inspectionProfile);
        },
        validate:after => Boolean(after?.available) || "剪贴板辅助工具安装命令已结束，但重新探测后仍不可用",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode, before, install_plan:before.install_plan, uninstall_plan:before.uninstall_plan || null, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const task = startRemoteComponentCommandTask({
    connection,
    component:"vnc-clipboard-helper",
    componentLabel:"Unicode 剪贴板辅助工具",
    resourceKey:`vnc-clipboard-helper:${Number(connection.id || 0)}`,
    action,
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode,
    command:selected.command,
    before,
    grant,
    scope:`vnc.clipboard-helper.${action}`,
    directRoot:Boolean(before.root),
    verify:async () => {
      clearVncClipboardCapabilityCache();
      return inspectVncClipboardHelperForProfile(inspectionProfile);
    },
    validate:after => uninstalling
      ? !after?.available || "剪贴板辅助工具卸载命令已结束，但重新探测后仍可用"
      : Boolean(after?.available) || "剪贴板辅助工具安装命令已结束，但重新探测后仍不可用"
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:before.install_plan,
    uninstall_plan:before.uninstall_plan || before.install_plan?.uninstall || null,
    task,
    temporary_authorization:Boolean(grant)
  };
}

module.exports = {
  configureVncClipboardHelperForProfile,
  configureVncServerForProfile,
  inspectVncClipboardHelperForProfile,
  inspectVncServerForProfile
};
