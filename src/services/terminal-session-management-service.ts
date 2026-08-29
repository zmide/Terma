const { buildRemotePosixCommand } = require("../remote-posix");
const { publicError, remoteOutputError } = require("../public-error");
const { runSshCommandForConnection } = require("../ssh");
const { componentInstallCommand, componentInstallPlan } = require("../remote-component-installer");
const { createRemoteAdminGrant, releaseRemoteAdminGrant } = require("./remote-admin-service");
const { remoteOfflineTasks, startRemoteComponentCommandTask } = require("./remote-component-service");

const DETECT_SCRIPT = `set +e
terma_emit() { printf 'TERMA_SESSION_%s=%s\\n' "$1" "$(printf '%s' "$2" | tr '\\r\\n=' '   ')"; }
td_os=$(uname -s 2>/dev/null || printf unknown)
td_platform=unknown
[ "$td_os" = Linux ] && td_platform=linux
[ "$td_os" = Darwin ] && td_platform=macos
td_manager=""
for td_name in apt dnf yum pacman zypper apk brew; do command -v "$td_name" >/dev/null 2>&1 && { td_manager=$td_name; break; }; done
td_root=false
[ "$(id -u 2>/dev/null)" = 0 ] && td_root=true
terma_emit PLATFORM "$td_platform"
terma_emit PACKAGE_MANAGER "$td_manager"
terma_emit ROOT "$td_root"
for td_component in tmux screen; do
  td_installed=false
  td_version=""
  td_active=0
  td_terma_active=0
  td_prefix=SCREEN
  [ "$td_component" = tmux ] && td_prefix=TMUX
  if command -v "$td_component" >/dev/null 2>&1; then td_installed=true; td_version=$("$td_component" -V 2>/dev/null | head -n 1); fi
  if [ "$td_component" = tmux ] && [ "$td_installed" = true ]; then
    td_active=$(tmux list-sessions -F '#S' 2>/dev/null | sed '/^$/d' | wc -l | tr -d ' ')
    td_terma_active=$(tmux list-sessions -F '#S' 2>/dev/null | grep '^terma-' | wc -l | tr -d ' ')
  fi
  if [ "$td_component" = screen ] && [ "$td_installed" = true ]; then
    td_active=$(screen -ls 2>/dev/null | grep -E '^[[:space:]]*[0-9]+\.[^[:space:]]+[[:space:]]+\((Detached|Attached)\)' | wc -l | tr -d ' ')
    td_terma_active=$(screen -ls 2>/dev/null | grep -E '\.terma-[A-Za-z0-9_-]+[[:space:]]' | wc -l | tr -d ' ')
  fi
  terma_emit "\${td_prefix}_INSTALLED" "$td_installed"
  terma_emit "\${td_prefix}_VERSION" "$td_version"
  terma_emit "\${td_prefix}_ACTIVE" "$td_active"
  terma_emit "\${td_prefix}_TERMA_ACTIVE" "$td_terma_active"
done`;

const COMPONENTS = {
  tmux:{label:"tmux 会话管理器", package:"tmux", manual:"在远端安装 tmux，并确保登录用户可以执行 tmux"},
  screen:{label:"GNU screen 会话管理器", package:"screen", manual:"在远端安装 GNU screen，并确保登录用户可以执行 screen"}
};

function parseDetection(output, connection) {
  const values = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^TERMA_SESSION_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  const platform = String(values.get("PLATFORM") || "unknown").toLowerCase();
  const manager = String(values.get("PACKAGE_MANAGER") || "").toLowerCase();
  const root = String(values.get("ROOT") || "").toLowerCase() === "true";
  const components = {};
  for (const [id, definition] of Object.entries(COMPONENTS)) {
    const installed = String(values.get(`${id.toUpperCase()}_INSTALLED`) || "").toLowerCase() === "true";
    const version = String(values.get(`${id.toUpperCase()}_VERSION`) || "").trim();
    const activeSessions = Math.max(0, Number(values.get(`${id.toUpperCase()}_ACTIVE`) || 0) || 0);
    const termaActiveSessions = Math.max(0, Number(values.get(`${id.toUpperCase()}_TERMA_ACTIVE`) || 0) || 0);
    const online = {
      apt:`DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${definition.package}`,
      dnf:`dnf install -y ${definition.package}`,
      yum:`yum install -y ${definition.package}`,
      pacman:`pacman -S --noconfirm ${definition.package}`,
      zypper:`zypper --non-interactive install ${definition.package}`,
      apk:`apk add ${definition.package}`,
      brew:`brew install ${definition.package}`
    }[manager] || "";
    const offline = {
      apt:`DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${definition.package}`,
      dnf:`dnf --cacheonly install -y ${definition.package}`,
      yum:`yum -C install -y ${definition.package}`,
      pacman:`pacman -S --noconfirm --cachedir /var/cache/pacman/pkg ${definition.package}`,
      zypper:`zypper --non-interactive --no-refresh install ${definition.package}`,
      apk:`apk add --no-network ${definition.package}`
    }[manager] || "";
    const uninstall = {
      apt:`dpkg-query -W -f='\${Status}' ${definition.package} 2>/dev/null | grep -q 'install ok installed' && DEBIAN_FRONTEND=noninteractive apt-get purge -y ${definition.package} || true`,
      dnf:`rpm -q ${definition.package} >/dev/null 2>&1 && dnf remove -y ${definition.package} || true`,
      yum:`rpm -q ${definition.package} >/dev/null 2>&1 && yum remove -y ${definition.package} || true`,
      pacman:`pacman -Q ${definition.package} >/dev/null 2>&1 && pacman -R --noconfirm ${definition.package} || true`,
      zypper:`rpm -q ${definition.package} >/dev/null 2>&1 && zypper --non-interactive remove ${definition.package} || true`,
      apk:`apk info -e ${definition.package} >/dev/null 2>&1 && apk del ${definition.package} || true`,
      brew:`brew list --formula ${definition.package} >/dev/null 2>&1 && brew uninstall ${definition.package} || true`
    }[manager] || "";
    components[id] = {
      id,
      label:definition.label,
      installed,
      version,
      active_sessions:activeSessions,
      terma_active_sessions:termaActiveSessions,
      install_plan:componentInstallPlan({
        component:`terminal-session-${id}`,
        label:definition.label,
        online_command:online,
        online_description:`使用远端 ${manager || "软件包管理器"} 安装 ${definition.package}`,
        offline_command:offline,
        offline_description:"仅使用远端软件包缓存，不访问软件源",
        local_offline_available:platform === "linux" && manager === "apt",
        local_offline_packages:platform === "linux" && manager === "apt" ? [definition.package] : [],
        local_offline_description:manager === "apt"
          ? "本机下载匹配的软件包及依赖，通过 SFTP 上传到远端安装"
          : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}`,
        manual_description:definition.manual
      }),
      uninstall_plan:{available:installed && Boolean(uninstall), command:uninstall, package_manager:manager, package_names:installed ? [definition.package] : []}
    };
  }
  return {
    ok:true,
    platform,
    package_manager:manager,
    root,
    supported:platform === "linux" || platform === "macos",
    components,
    connection:{id:Number(connection?.id || 0), name:String(connection?.name || ""), host:String(connection?.ssh_host || ""), user:String(connection?.ssh_user || "")}
  };
}

async function inspectTerminalSessionComponentsForConnection(connection) {
  const result = await runSshCommandForConnection({...connection, x11_mode:"off"}, buildRemotePosixCommand(DETECT_SCRIPT), 12000);
  if (result?.status !== 0) {
    const output = `${result?.stderr || ""}${result?.stdout || ""}${result?.error ? result.error.message : ""}`.trim();
    if (output) throw remoteOutputError(output);
    throw publicError("TERMINAL_SESSION_PROBE_FAILED", "远程终端会话组件探测失败");
  }
  return parseDetection(result.stdout, connection);
}

async function configureTerminalSessionComponentForConnection(connection, data: any = {}) {
  const component = String(data.component || "").trim().toLowerCase();
  const definition = COMPONENTS[component];
  if (!definition) throw publicError("TERMINAL_SESSION_COMPONENT_INVALID", "只能管理 tmux 或 screen");
  const action = String(data.action || "install").trim().toLowerCase();
  if (!["install", "install-offline", "install-local-offline", "uninstall"].includes(action)) throw publicError("TERMINAL_SESSION_ACTION_INVALID", "终端会话组件操作无效");
  const before = await inspectTerminalSessionComponentsForConnection(connection);
  const current = before.components[component];
  const uninstalling = action === "uninstall";
  if (uninstalling && !current.installed) throw publicError("TERMINAL_SESSION_COMPONENT_NOT_INSTALLED", `${definition.label} 当前未安装`);
  if (uninstalling && Number(current.active_sessions || 0) > 0) {
    throw publicError("TERMINAL_SESSION_COMPONENT_IN_USE", `${definition.label} 仍有 ${current.active_sessions} 个活动会话，其中 ${current.terma_active_sessions || 0} 个由 Terma 管理；请先在对应工具中处理这些会话`);
  }
  const mode = uninstalling ? "uninstall" : action === "install-local-offline" ? "local-offline" : action === "install-offline" ? "offline" : "online";
  const selected = uninstalling ? current.uninstall_plan : componentInstallCommand(current.install_plan, mode);
  if (!selected?.command && mode !== "local-offline") throw publicError("TERMINAL_SESSION_INSTALL_UNAVAILABLE", "当前系统没有可用的自动管理方案，请查看手动安装说明");
  const grant = createRemoteAdminGrant(connection, data, `terminal-session.${component}.${action}`);
  if (!before.root && !grant) {
    releaseRemoteAdminGrant(grant);
    throw publicError("TERMINAL_SESSION_ADMIN_REQUIRED", `${uninstalling ? "卸载" : "安装"} ${definition.label} 需要临时管理员授权`);
  }
  if (mode === "local-offline") {
    const localPlan = current.install_plan.local_offline;
    if (!localPlan?.available || before.package_manager !== "apt") {
      releaseRemoteAdminGrant(grant);
      throw publicError("TERMINAL_SESSION_LOCAL_OFFLINE_UNSUPPORTED", "本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统");
    }
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:`terminal-session-${component}`,
        component_label:definition.label,
        resource_key:`terminal-session:${Number(connection.id || 0)}:${component}`,
        packages:localPlan.package_names || [definition.package],
        grant,
        elevate:true,
        direct_root:Boolean(before.root),
        scope:`terminal-session.${component}.install-local-offline`,
        verify:() => inspectTerminalSessionComponentsForConnection(connection),
        validate:after => Boolean(after?.components?.[component]?.installed) || `${definition.label} 离线安装结束后仍未检测到`,
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode, component, before, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const task = startRemoteComponentCommandTask({
    connection,
    component:`terminal-session-${component}`,
    componentLabel:definition.label,
    resourceKey:`terminal-session:${Number(connection.id || 0)}:${component}`,
    action,
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode,
    command:selected.command,
    before,
    grant,
    scope:`terminal-session.${component}.${action}`,
    directRoot:Boolean(before.root),
    verify:() => inspectTerminalSessionComponentsForConnection(connection),
    validate:after => uninstalling
      ? !after?.components?.[component]?.installed || `${definition.label} 卸载后仍被检测到`
      : Boolean(after?.components?.[component]?.installed) || `${definition.label} 安装后仍未被检测到`
  });
  return {ok:true, action, mode, component, before, task, temporary_authorization:Boolean(grant)};
}

module.exports = {
  configureTerminalSessionComponentForConnection,
  inspectTerminalSessionComponentsForConnection,
  parseTerminalSessionComponentDetection:parseDetection
};
