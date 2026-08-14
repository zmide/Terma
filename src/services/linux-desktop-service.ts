const {
  DESKTOP_IDS,
  DESKTOP_META,
  DETECT_SCRIPT: LINUX_DESKTOP_DETECT_SCRIPT,
  buildInstallScript: buildLinuxDesktopInstallScript,
  buildUninstallScript: buildLinuxDesktopUninstallScript,
  desktopInstallPlan,
  parseDetectionOutput: parseLinuxDesktopDetection
} = require("../linux-desktop-manager");
const { buildRemotePosixCommand } = require("../remote-posix");
const { componentInstallCommand } = require("../remote-component-installer");
const { packagePlan: rdpServerPackagePlan } = require("../rdp-server-manager");
const { runRemotePrivilegeCommandStreaming } = require("../remote-privilege");
const {
  getConnection
} = require("../db");
const {
  runSshCommandForConnection,
  runSshCommandForConnectionStreaming
} = require("../ssh");
const {
  createRemoteAdminGrant,
  releaseRemoteAdminGrant
} = require("./remote-admin-service");
const {
  remoteOfflineTasks,
  startRemoteComponentCommandTask
} = require("./remote-component-service");

const linuxDesktopTasks = new Map();
let linuxDesktopTaskSequence = 0;

function linuxDesktopTaskView(task) {
  return {
    id:task.id,
    connection_id:task.connection_id,
    connection_name:task.connection_name,
    desktop_id:task.desktop_id,
    desktop_label:DESKTOP_META[task.desktop_id]?.label || task.desktop_id,
    action:task.action || "install",
    action_label:task.action === "uninstall" ? "卸载" : "安装",
    mode:task.mode || "online",
    status:task.status,
    stage:task.stage,
    progress:Number(task.progress || 0),
    logs:task.logs.slice(-300),
    error:task.error || "",
    created_at:task.created_at,
    updated_at:task.updated_at,
    finished_at:task.finished_at || 0,
    diagnostics:task.diagnostics || null
  };
}

function listLinuxDesktopTasks() {
  return [...linuxDesktopTasks.values()]
    .map(linuxDesktopTaskView)
    .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0));
}

function deleteLinuxDesktopTask(taskId) {
  const task = linuxDesktopTasks.get(String(taskId || ""));
  if (!task) return false;
  if (task.status === "running") throw new Error("运行中的桌面任务不能删除");
  return linuxDesktopTasks.delete(task.id);
}

function clearFinishedLinuxDesktopTasks() {
  let removed = 0;
  for (const task of linuxDesktopTasks.values()) {
    if (!["done", "cancelled"].includes(task.status)) continue;
    linuxDesktopTasks.delete(task.id);
    removed += 1;
  }
  return {removed};
}

function appendLinuxDesktopTaskChunk(task, chunk, stream = "stdout") {
  task.partial = `${task.partial || ""}${Buffer.from(chunk || "").toString("utf8")}`;
  const lines = task.partial.split(/\r?\n/);
  task.partial = lines.pop() || "";
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const stage = /^(?:TERMA|TD)_DESKTOP_STAGE=(.*)$/.exec(line);
    if (stage) {
      task.stage = stage[1] || task.stage;
      task.progress = {prepare:12, packages:30, refresh:88, verify:94, done:100}[task.stage] ?? task.progress;
      task.updated_at = Date.now();
      continue;
    }
    const log = /^(?:TERMA|TD)_DESKTOP_LOG=(.*)$/.exec(line);
    task.logs.push({at:Date.now(), stream, text:log ? log[1] : line});
    if (task.logs.length > 400) task.logs.splice(0, task.logs.length - 400);
    task.updated_at = Date.now();
  }
}

async function detectLinuxDesktopForConnection(connection) {
  const result = await runSshCommandForConnection(connection, buildRemotePosixCommand(LINUX_DESKTOP_DETECT_SCRIPT), 30000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    throw new Error(output || "Linux 桌面探测失败");
  }
  const diagnostics = parseLinuxDesktopDetection(result.stdout);
  diagnostics.connection = {id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user};
  diagnostics.installable_desktops = DESKTOP_IDS.filter(id => Boolean(desktopInstallPlan({...diagnostics, requested_desktop:id})));
  diagnostics.desktop_install_plans = Object.fromEntries(DESKTOP_IDS.map(id => [id, desktopInstallPlan({...diagnostics, requested_desktop:id})]).filter(([, plan]) => Boolean(plan)));
  diagnostics.rdp_install_plan = rdpServerPackagePlan(diagnostics);
  diagnostics.desktop_catalog = DESKTOP_IDS.map(id => ({id, ...(DESKTOP_META[id] || {})}));
  return diagnostics;
}

async function configureRdpServerForConnection(connection, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall", "start", "stop", "restart", "enable", "disable"].includes(action)) throw new Error("RDP 服务操作无效");
  const before = await detectLinuxDesktopForConnection(connection);
  const plan = before.rdp_install_plan || rdpServerPackagePlan(before);
  if (action === "guide") return {
    ok:true,
    action,
    before,
    after:before,
    install_plan:plan?.install_plan || plan?.component_plan || null,
    uninstall_plan:plan?.uninstall || null,
    service_actions:plan?.service_actions || {},
    package_plan:plan
  };
  if (!before.platform_supported || !plan) throw new Error("当前 SSH 主机不是支持自动管理 RDP 服务的 Linux 系统");
  const grantScope = `rdp.server.${action}`;
  const grant = createRemoteAdminGrant(connection, data, grantScope);
  if (!before.privileged && !grant) throw new Error("此操作需要临时管理员授权");
  if (action === "install-local-offline") {
    const localPlan = plan.local_offline || plan.install_plan?.local_offline || plan.component_plan?.local_offline;
    const packages = localPlan?.package_names || plan.local_offline_packages || [];
    if (!localPlan?.available || before.package_manager !== "apt" || !packages.length) {
      releaseRemoteAdminGrant(grant);
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"rdp-server",
        component_label:"RDP 服务",
        resource_key:`rdp-server:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(before.privileged),
        scope:"rdp.server.install-local-offline",
        verify:() => detectLinuxDesktopForConnection(connection),
        validate:after => Boolean(after?.xrdp_installed) || "RDP 离线安装已结束，但远端仍未检测到 xrdp",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode:"local-offline", before, install_plan:plan.install_plan || plan.component_plan, package_plan:plan, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const installing = action === "install" || action === "install-offline";
  const mode = action === "install-offline" ? "offline" : action === "uninstall" ? "uninstall" : "service";
  const selected = installing
    ? componentInstallCommand(plan.install_plan || plan.component_plan || plan, mode) || componentInstallCommand(plan, mode)
    : action === "uninstall"
      ? plan.uninstall
      : plan.service_actions?.[action];
  const command = String(selected?.command || (installing ? plan[mode === "offline" ? "offline_command" : "online_command"] || plan.command : "") || "").trim();
  if (!command) {
    releaseRemoteAdminGrant(grant);
    if (action === "uninstall") throw new Error("当前发行版没有可安全自动执行的 RDP 卸载方案，请查看手动说明");
    if (!installing) throw new Error(`当前主机没有可执行的 RDP ${action}方案`);
    throw new Error(action === "install-offline" ? "远端没有可用的 RDP 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明" : "当前发行版没有可用的 RDP 在线安装方案");
  }
  const actionLabels = {
    install:"在线安装", "install-offline":"使用远端缓存安装", uninstall:"卸载",
    start:"启动", stop:"停止", restart:"重新启动", enable:"启用并启动", disable:"停止并禁用"
  };
  const task = startRemoteComponentCommandTask({
    connection,
    component:"rdp-server",
    componentLabel:"RDP 服务",
    resourceKey:`rdp-server:${Number(connection.id || 0)}`,
    action,
    actionLabel:actionLabels[action] || action,
    mode,
    command,
    before,
    grant,
    scope:grantScope,
    verify:() => detectLinuxDesktopForConnection(connection),
    validate:after => {
      if (installing) return Boolean(after?.xrdp_installed) || "RDP 安装命令已结束，但远端仍未检测到 xrdp";
      if (action === "uninstall") return !after?.xrdp_installed || "RDP 卸载命令已结束，但远端仍检测到 xrdp";
      if (["start", "restart", "enable"].includes(action)) return Boolean(after?.xrdp_active || after?.xrdp_listening) || "RDP 服务命令已结束，但服务仍未运行";
      return !after?.xrdp_active && !after?.xrdp_listening || "RDP 服务命令已结束，但服务仍在运行";
    }
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:plan.install_plan || plan.component_plan,
    uninstall_plan:plan.uninstall || null,
    service_actions:plan.service_actions || {},
    package_plan:plan,
    task,
    temporary_authorization:Boolean(grant)
  };
}

function startLinuxDesktopInstall(connectionId, desktopId, action = "install", grant = null, mode = "online") {
  const connection = getConnection(Number(connectionId));
  const requested = String(desktopId || "").toLowerCase();
  const operation = action === "uninstall" ? "uninstall" : "install";
  const normalizedMode = operation === "install" && String(mode || "online").toLowerCase() === "offline"
    ? "offline"
    : operation === "install" && ["local-offline", "install-local-offline", "offline-local"].includes(String(mode || "").toLowerCase())
      ? "local-offline"
      : "online";
  const localOffline = normalizedMode === "local-offline";
  if (!DESKTOP_IDS.includes(requested)) throw new Error("Linux 桌面类型无效");
  const runningTask = [...linuxDesktopTasks.values()].find(item => Number(item.connection_id || 0) === Number(connection.id || 0) && item.status === "running");
  if (runningTask) {
    const error: any = new Error("该 SSH 主机已有 Linux 桌面任务正在执行，请等待完成后再试");
    error.code = "REMOTE_TASK_CONFLICT";
    error.statusCode = 409;
    error.task = linuxDesktopTaskView(runningTask);
    throw error;
  }
  const task = {
    id:`linux-desktop-${Date.now()}-${++linuxDesktopTaskSequence}`,
    connection_id:connection.id,
    connection_name:connection.name,
    desktop_id:requested,
    action:operation,
    status:"running",
    stage:"prepare",
    progress:5,
    logs:[{at:Date.now(), stream:"system", text:`开始${operation === "uninstall" ? "卸载" : "安装"} ${DESKTOP_META[requested]?.label || requested}`}],
    error:"",
    created_at:Date.now(),
    updated_at:Date.now(),
    finished_at:0,
    partial:"",
    remote_task_id:"",
    diagnostics:null,
    admin_grant_id:grant?.id || "",
    mode:operation === "uninstall" ? "uninstall" : normalizedMode
  };
  linuxDesktopTasks.set(task.id, task);
  void (async () => {
    let delegatedGrant = false;
    try {
      const before = await detectLinuxDesktopForConnection(connection);
      task.diagnostics = before;
      if (!before.platform_supported) throw new Error("当前连接不是 Linux 主机");
      if (!before.privileged && !grant) throw new Error("操作桌面需要 root 或免密码 sudo 权限；可以使用临时管理员授权");
      if (operation === "uninstall" && !before.desktops.some(item => item.id === requested)) throw new Error("当前没有检测到该桌面环境，无法卸载");
      if (localOffline) {
        const installPlan = before.desktop_install_plans?.[requested] || desktopInstallPlan({...before, requested_desktop:requested});
        const localPlan = installPlan?.local_offline || installPlan?.component_plan?.local_offline;
        const packages = localPlan?.package_names || installPlan?.local_offline_packages || [];
        if (!localPlan?.available || before.package_manager !== "apt" || !packages.length) throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
        const remoteTask = remoteOfflineTasks.startAptInstall({
          connection,
          component:`linux-desktop-${requested}`,
          component_label:`Linux 桌面 · ${DESKTOP_META[requested]?.label || requested}`,
          packages,
          grant,
          direct_root:Boolean(before.privileged),
          scope:"linux-desktop.install-local-offline",
          release_grant:releaseRemoteAdminGrant
        });
        delegatedGrant = true;
        task.remote_task_id = remoteTask.id;
        for (;;) {
          const snapshot = remoteOfflineTasks.list().find(item => String(item.id) === String(remoteTask.id));
          if (!snapshot) throw new Error("远端组件离线任务不存在或已过期");
          task.stage = snapshot.stage || task.stage;
          task.progress = Number(snapshot.progress || task.progress);
          task.logs = Array.isArray(snapshot.logs) ? snapshot.logs.slice(-400) : task.logs;
          task.error = snapshot.error || "";
          task.updated_at = Date.now();
          if (snapshot.status === "done") break;
          if (snapshot.status === "failed") throw new Error(snapshot.error || "Linux 桌面本机离线安装失败");
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        task.stage = "verify";
        task.progress = 94;
        task.logs.push({at:Date.now(), stream:"system", text:"软件包安装完成，正在重新探测桌面会话"});
        const afterOffline = await detectLinuxDesktopForConnection(connection);
        task.diagnostics = afterOffline;
        if (!afterOffline.desktops.some(item => item.id === requested)) throw new Error(`${DESKTOP_META[requested]?.label || requested} 离线安装已结束，但未检测到可用桌面会话`);
        task.stage = "done";
        task.progress = 100;
        task.status = "done";
        task.logs.push({at:Date.now(), stream:"system", text:"本机离线安装完成，桌面列表已重新探测"});
        return;
      }
      const privilegedDiagnostics = grant && !before.privileged ? {...before, privileged:true} : before;
      const script = operation === "uninstall" ? buildLinuxDesktopUninstallScript(privilegedDiagnostics, requested) : buildLinuxDesktopInstallScript(privilegedDiagnostics, requested, normalizedMode);
      const installScope = operation === "uninstall" ? "linux-desktop.uninstall" : normalizedMode === "offline" ? "linux-desktop.install-offline" : "linux-desktop.install";
      const result = grant
        ? await runRemotePrivilegeCommandStreaming(connection, buildRemotePosixCommand(script), {grant_id:grant.id, scope:installScope, timeout_ms:20 * 60 * 1000}, (chunk, stream) => appendLinuxDesktopTaskChunk(task, chunk, stream))
        : await runSshCommandForConnectionStreaming(connection, buildRemotePosixCommand(script), 20 * 60 * 1000, (chunk, stream) => appendLinuxDesktopTaskChunk(task, chunk, stream));
      if (task.partial) appendLinuxDesktopTaskChunk(task, "\n", "stdout");
      if (result.status !== 0) throw new Error(`${result.stderr || result.stdout || result.error?.message || `远端${operation === "uninstall" ? "卸载" : "安装"}退出码 ${result.status}`}`.trim());
      task.stage = "verify";
      task.progress = 94;
      task.logs.push({at:Date.now(), stream:"system", text:"正在验证远端桌面会话状态"});
      const after = await detectLinuxDesktopForConnection(connection);
      task.diagnostics = after;
      const stillDetected = after.desktops.some(item => item.id === requested);
      if (operation === "install" && !stillDetected) throw new Error(`${DESKTOP_META[requested]?.label || requested} 安装命令已结束，但未检测到可用桌面会话`);
      if (operation === "uninstall" && stillDetected) throw new Error(`${DESKTOP_META[requested]?.label || requested} 卸载未完成，远端仍存在对应桌面核心程序或会话`);
      task.stage = "done";
      task.progress = 100;
      task.status = "done";
      task.logs.push({at:Date.now(), stream:"system", text:`${operation === "uninstall" ? "卸载" : "安装"}完成，桌面列表已重新探测`});
    } catch (error) {
      task.status = "failed";
      task.error = error.message || String(error);
      task.logs.push({at:Date.now(), stream:"error", text:task.error});
    } finally {
      if (!delegatedGrant) releaseRemoteAdminGrant(grant);
      task.finished_at = Date.now();
      task.updated_at = task.finished_at;
      setTimeout(() => linuxDesktopTasks.delete(task.id), 60 * 60 * 1000).unref?.();
    }
  })();
  return linuxDesktopTaskView(task);
}

module.exports = {
  clearFinishedLinuxDesktopTasks,
  configureRdpServerForConnection,
  deleteLinuxDesktopTask,
  detectLinuxDesktopForConnection,
  linuxDesktopTaskView,
  linuxDesktopTasks,
  listLinuxDesktopTasks,
  startLinuxDesktopInstall
};
