const path = require("node:path");
const { buildRemotePosixCommand } = require("./remote-posix");
const { componentInstallCommand, componentInstallPlan } = require("./remote-component-installer");
const { packagePlan: rdpPackagePlan } = require("./rdp-server-manager");

const DETECT_SCRIPT = String.raw`set +e
# The command is executed through the account's default shell (often zsh).
# Enumerate desktop files with find instead of a shell pathname glob. This
# keeps empty macOS/Linux directories from aborting under zsh NO_MATCH while
# still returning real X11 sessions when they exist.
td_clean() { printf '%s' "$1" | tr '\r\n=' '   '; }
td_emit() { printf 'TD_%s=%s\n' "$1" "$(td_clean "$2")"; }

td_os_id=""
td_os_like=""
if [ -r /etc/os-release ]; then
  td_os_id=$(sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"')
  td_os_like=$(sed -n 's/^ID_LIKE=//p' /etc/os-release | head -n 1 | tr -d '"')
fi
if [ -z "$td_os_id" ]; then
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) td_os_id=macos ; td_os_like=darwin ;;
    Linux) td_os_id=linux ;;
  esac
fi
td_service=$(basename "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null)" 2>/dev/null | sed 's/\.service$//')
if [ -z "$td_service" ] && [ -r /etc/X11/default-display-manager ]; then
  td_service=$(basename "$(cat /etc/X11/default-display-manager 2>/dev/null)")
fi
case "$td_service" in
  gdm|gdm3) td_manager=gdm ;;
  lightdm) td_manager=lightdm ;;
  sddm) td_manager=sddm ;;
  xdm) td_manager=xdm ;;
  *) td_manager=unknown ;;
esac

td_manager_version=""
td_gdm_xdmcp_capable=0
if [ "$td_manager" = "gdm" ]; then
  td_gdm_command=$(command -v "$td_service" 2>/dev/null || command -v gdm 2>/dev/null || command -v gdm3 2>/dev/null || true)
  if [ -n "$td_gdm_command" ]; then
    td_manager_version=$("$td_gdm_command" --version 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+([.][0-9]+)+/) { value=$i; sub(/[^0-9.].*$/, "", value); print value; exit } }')
  fi
  td_gdm_major=${"$"}{td_manager_version%%.*}
  case "$td_gdm_major" in
    ''|*[!0-9]*) ;;
    *) [ "$td_gdm_major" -lt 50 ] && td_gdm_xdmcp_capable=1 ;;
  esac
fi

td_package_manager=none
command -v apt-get >/dev/null 2>&1 && td_package_manager=apt
command -v dnf >/dev/null 2>&1 && td_package_manager=dnf
command -v pacman >/dev/null 2>&1 && td_package_manager=pacman

td_root=0
[ "$(id -u 2>/dev/null)" = "0" ] && td_root=1
td_sudo=0
[ "$td_root" = "1" ] || sudo -n true >/dev/null 2>&1 && td_sudo=1

td_enabled=0
td_config=""
td_configured_session=""
if [ "$td_manager" = "lightdm" ]; then
  td_config=/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf
  if lightdm --show-config 2>&1 | awk '
    /^[[:space:]]*\[XDMCPServer\]/{inside=1;next}
    /^[[:space:]]*\[/{inside=0}
    inside && /^[[:space:]]*([[:upper:]][[:space:]]+)?enabled[[:space:]]*=[[:space:]]*(true|yes|1)[[:space:]]*$/ {found=1}
    END{exit found?0:1}
  '; then td_enabled=1; fi
  td_configured_session=$(lightdm --show-config 2>&1 | awk '
    /^[[:space:]]*\[Seat:\*\]/{inside=1;next}
    /^[[:space:]]*\[/{inside=0}
    inside {
      line=$0
      sub(/^[[:space:]]*[A-Z][[:space:]]+/, "", line)
      if (line ~ /^[[:space:]]*user-session[[:space:]]*=/) {
        sub(/^[^=]*=[[:space:]]*/, "", line)
        print line
        exit
      }
    }
  ')
elif [ "$td_manager" = "gdm" ]; then
  for td_candidate in /etc/gdm/custom.conf /etc/gdm3/custom.conf /etc/gdm3/daemon.conf; do
    [ -f "$td_candidate" ] && td_config=$td_candidate && break
  done
  if [ -n "$td_config" ] && awk '
    /^\[xdmcp\]/{inside=1;next}
    /^\[/{inside=0}
    inside && /^[[:space:]]*Enable[[:space:]]*=[[:space:]]*(true|yes|1)[[:space:]]*$/ {found=1}
    END{exit found?0:1}
  ' "$td_config" 2>/dev/null; then td_enabled=1; fi
fi

td_listening=0
if command -v ss >/dev/null 2>&1; then
  ss -H -lun 2>/dev/null | awk '$4 ~ /:177$/ {found=1} END{exit found?0:1}' && td_listening=1
elif command -v netstat >/dev/null 2>&1; then
  netstat -lun 2>/dev/null | awk '$4 ~ /:177$/ {found=1} END{exit found?0:1}' && td_listening=1
fi

td_firewall=none
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then td_firewall=ufw-active; fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -qi running; then td_firewall=firewalld-active; fi
td_firewall_managed=0
[ -f /var/lib/tunneldesk/xdmcp-firewall-owner ] && td_firewall_managed=1
td_lightdm_managed=0
td_lightdm_previous_service=""
td_lightdm_backup=""
td_lightdm_owner=/var/lib/tunneldesk/xdmcp-lightdm-owner
if [ -r "$td_lightdm_owner" ]; then
  td_lightdm_previous_service=$(sed -n 's/^previous_service=//p' "$td_lightdm_owner" | head -n 1)
  td_lightdm_backup=$(sed -n 's/^backup=//p' "$td_lightdm_owner" | head -n 1)
  td_lightdm_managed=1
elif [ "$td_manager" = lightdm ]; then
  td_lightdm_backup=$(find /etc/X11 -maxdepth 1 -type f -name 'default-display-manager.tunneldesk-backup-*' -print 2>/dev/null | sort | tail -n 1)
  if [ -n "$td_lightdm_backup" ] && [ -r "$td_lightdm_backup" ]; then
    td_lightdm_previous_service=$(basename "$(cat "$td_lightdm_backup" 2>/dev/null)")
    td_lightdm_previous_service=${"$"}{td_lightdm_previous_service%.service}
    [ "$td_lightdm_previous_service" = lightdm ] || td_lightdm_managed=1
  fi
fi

td_login_user=$(id -un 2>/dev/null || true)
td_login_home=$(getent passwd "$td_login_user" 2>/dev/null | cut -d: -f6)
td_saved_session=""
if [ -n "$td_login_home" ] && [ -r "$td_login_home/.dmrc" ]; then
  td_saved_session=$(sed -n 's/^[[:space:]]*Session[[:space:]]*=[[:space:]]*//p' "$td_login_home/.dmrc" | head -n 1)
fi
td_session_manager_target=""
if [ -e /usr/bin/x-session-manager ]; then
  td_session_manager_target=$(readlink -f /usr/bin/x-session-manager 2>/dev/null || true)
fi
td_xrdp_installed=0
td_xrdp_xfce_configured=0
if command -v xrdp >/dev/null 2>&1; then
  td_xrdp_installed=1
  if [ -r /etc/xrdp/startwm.sh ] && grep -Eiq 'dbus-run-session[[:space:]]+--[[:space:]]+startxfce4' /etc/xrdp/startwm.sh; then
    td_xrdp_xfce_configured=1
  fi
fi

td_login_uid=$(id -u "$td_login_user" 2>/dev/null || id -u 2>/dev/null)
if command -v loginctl >/dev/null 2>&1; then
  for td_session_id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    td_session_uid=$(loginctl show-session "$td_session_id" -p User --value 2>/dev/null || true)
    [ "$td_session_uid" = "$td_login_uid" ] || continue
    td_session_type=$(loginctl show-session "$td_session_id" -p Type --value 2>/dev/null || true)
    case "$td_session_type" in x11|wayland) ;; *) continue ;; esac
    td_session_class=$(loginctl show-session "$td_session_id" -p Class --value 2>/dev/null || true)
    [ "$td_session_class" = user ] || continue
    td_session_service=$(loginctl show-session "$td_session_id" -p Service --value 2>/dev/null)
    td_session_display=$(loginctl show-session "$td_session_id" -p Display --value 2>/dev/null)
    td_session_seat=$(loginctl show-session "$td_session_id" -p Seat --value 2>/dev/null)
    td_session_desktop=$(loginctl show-session "$td_session_id" -p Desktop --value 2>/dev/null)
    td_session_state=$(loginctl show-session "$td_session_id" -p State --value 2>/dev/null || true)
    td_emit GRAPHICAL_SESSION "$td_session_id|$td_session_service|$td_session_display|$td_session_seat|$td_session_desktop|$td_session_state"
  done
fi

td_plasma_display=""
for td_process_name in plasmashell kwin_x11 ksmserver; do
  td_process_pid=$(pgrep -u "$td_login_uid" -x "$td_process_name" 2>/dev/null | head -n 1)
  [ -n "$td_process_pid" ] || continue
  td_plasma_display=$(tr '\0' '\n' < "/proc/$td_process_pid/environ" 2>/dev/null | sed -n 's/^DISPLAY=//p' | head -n 1)
  [ -n "$td_plasma_display" ] && break
done

td_emit OS_ID "$td_os_id"
td_emit OS_LIKE "$td_os_like"
td_emit MANAGER "$td_manager"
td_emit MANAGER_VERSION "$td_manager_version"
td_emit GDM_XDMCP_CAPABLE "$td_gdm_xdmcp_capable"
td_emit SERVICE "$td_service"
td_emit PACKAGE_MANAGER "$td_package_manager"
td_emit PRIVILEGED "$([ "$td_root" = 1 ] || [ "$td_sudo" = 1 ] && printf 1 || printf 0)"
td_emit CONFIG "$td_config"
td_emit ENABLED "$td_enabled"
td_emit LISTENING "$td_listening"
td_emit FIREWALL "$td_firewall"
td_emit FIREWALL_MANAGED "$td_firewall_managed"
td_emit LIGHTDM_MANAGED "$td_lightdm_managed"
td_emit LIGHTDM_PREVIOUS_SERVICE "$td_lightdm_previous_service"
td_emit LIGHTDM_BACKUP "$td_lightdm_backup"
td_emit CONFIGURED_SESSION "$td_configured_session"
td_emit SAVED_SESSION "$td_saved_session"
td_emit SESSION_MANAGER_TARGET "$td_session_manager_target"
td_emit XRDP_INSTALLED "$td_xrdp_installed"
td_emit XRDP_XFCE_CONFIGURED "$td_xrdp_xfce_configured"
td_emit LOGIN_USER "$td_login_user"
td_emit PLASMA_DISPLAY "$td_plasma_display"
if [ -d /usr/share/xsessions ]; then
  find /usr/share/xsessions -maxdepth 1 -type f -name '*.desktop' -print 2>/dev/null | while IFS= read -r td_file; do
    [ -n "$td_file" ] || continue
    td_name=$(sed -n 's/^Name=//p' "$td_file" | head -n 1)
    [ -n "$td_name" ] || td_name=$(basename "$td_file" .desktop)
    td_emit SESSION "$(basename "$td_file" .desktop)|$td_name"
  done
fi
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (host.startsWith("::ffff:")) host = host.slice(7);
  return host;
}

function resolveManagementConnection(profile, dependencies) {
  const requested = Number(profile?.options?.ssh_connection_id || 0);
  if (requested) return dependencies.getConnection(requested);
  const host = normalizeHost(profile?.host);
  const matches = dependencies.listConnections()
    .filter(item => normalizeHost(item.ssh_host) === host)
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || Number(a.id) - Number(b.id));
  if (!matches.length) throw new Error("没有找到同主机的 SSH 连接，请先在 XDMCP 设置中选择 SSH 管理连接");
  if (matches.length > 1) throw new Error("找到多个同主机 SSH 连接，请在 XDMCP 设置中明确选择用于管理的连接");
  return dependencies.getConnection(Number(matches[0].id));
}

function normalizeDisplay(value) {
  return String(value || "").trim().toLowerCase().replace(/\.0$/, "");
}

function resolveSessionManagerTarget(target, sessions) {
  const executable = path.basename(String(target || "")).toLowerCase();
  if (!executable) return null;
  const aliases = executable === "startplasma-x11"
    ? ["plasma", "plasma-x11", "kde-plasma-kf5"]
    : executable === "startxfce4" || executable === "xfce4-session"
      ? ["xfce", "xfce4"]
      : executable === "mate-session"
        ? ["mate"]
        : executable === "gnome-session"
          ? ["gnome-xorg", "gnome"]
          : executable === "startlxde"
            ? ["lxde"]
            : executable === "startlxqt" || executable === "lxqt-session"
              ? ["lxqt"]
              : [];
  return aliases.map(id => sessions.find(item => item.id === id)).find(Boolean) || null;
}

function xdmcpPackagePlan(diagnostics: any = {}, actionValue = "install-lightdm") {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const action = String(actionValue || "install-lightdm").toLowerCase().replace(/-(?:local-)?offline$/, "");
  const packagesByAction = {
    "install-lightdm": {
      apt:["lightdm", "lightdm-gtk-greeter"],
      dnf:["lightdm", "lightdm-gtk-greeter"],
      pacman:["lightdm", "lightdm-gtk-greeter"]
    },
    "install-xfce": {
      apt:["xfce4", "dbus-x11"],
      dnf:["xfce4", "dbus-x11"],
      pacman:["xfce4", "dbus"]
    },
    "install-rdp": {
      apt:["xrdp", "xorgxrdp"],
      dnf:["xrdp", "xorgxrdp"],
      pacman:["xrdp"]
    }
  };
  const packages = packagesByAction[action]?.[manager] || [];
  if (!packages.length) return null;
  const args = packages.map(item => `'${String(item).replace(/'/g, `'\\''`)}'`).join(" ");
  const onlineCommand = action === "install-xfce" && manager === "dnf"
    ? "dnf group install -y 'Xfce' && dnf install -y 'dbus-x11'"
    : action === "install-xfce" && manager === "pacman"
      ? "pacman -S --noconfirm 'xfce4' 'dbus'"
      : manager === "apt"
        ? `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${args}`
        : manager === "dnf"
          ? `dnf install -y ${args}`
          : manager === "pacman"
            ? `pacman -S --noconfirm ${args}`
            : "";
  const offlineCommand = manager === "apt"
    ? `DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${args}`
    : "";
  const component = componentInstallPlan({
    component:`xdmcp-${action}`,
    label:action === "install-xfce" ? "XDMCP 兼容桌面" : action === "install-rdp" ? "RDP 服务" : "LightDM XDMCP 服务",
    online_command:onlineCommand,
    offline_command:offlineCommand,
    offline_description:"只使用远端包管理器已经缓存的软件包，不访问软件源",
    local_offline_available:manager === "apt",
    local_offline_packages:manager === "apt" ? packages : [],
    local_offline_command:manager === "apt" ? offlineCommand : "",
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：TunnelDesk 在本机下载匹配的软件包和依赖，再通过 SFTP 上传并安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}，无法自动解析并上传 XDMCP 组件依赖`,
    manual_description:"查看当前系统对应的 XDMCP、桌面会话和服务配置说明"
  });
  const result: any = {
    action,
    package_manager:manager,
    packages,
    package_names:packages,
    command:onlineCommand,
    online_command:onlineCommand,
    offline_command:offlineCommand,
    local_offline_packages:manager === "apt" ? packages : [],
    local_offline_command:manager === "apt" ? offlineCommand : "",
    component_plan:component,
    install_plan:component,
    modes:component.modes,
    online:component.online,
    offline:component.offline,
    local_offline:component.local_offline,
    manual:component.manual,
    uninstall:action === "install-lightdm" ? lightdmUninstallPlan(diagnostics) : null
  };
  return result;
}

function lightdmUninstallPlan(diagnostics: any = {}) {
  if (diagnostics.platform_unsupported) return {available:false, command:"", reason:"macOS 不提供 LightDM XDMCP 服务"};
  if (String(diagnostics.manager || "").toLowerCase() !== "lightdm") return {available:false, command:"", reason:"当前显示管理器不是 LightDM，无需卸载 LightDM XDMCP 服务"};
  const previousService = String(diagnostics.lightdm_previous_service || "").trim().replace(/\.service$/, "");
  const backup = String(diagnostics.lightdm_backup || "").trim();
  const safePrevious = /^[A-Za-z0-9_.@-]+$/.test(previousService) && previousService !== "lightdm";
  const safeBackup = /^\/etc\/X11\/default-display-manager\.tunneldesk-backup-[0-9]+$/.test(backup);
  if (!diagnostics.lightdm_managed || !safePrevious || !safeBackup) {
    return {
      available:false,
      command:"",
      reason:"未找到 TunnelDesk 切换 LightDM 前保存的显示管理器信息，不能安全自动卸载；请使用手动说明切换显示管理器"
    };
  }
  if (String(diagnostics.package_manager || "").toLowerCase() !== "apt") {
    return {available:false, command:"", reason:"当前仅支持安全自动卸载由 TunnelDesk 在 Debian/Ubuntu 上切换的 LightDM"};
  }
  const serviceUnit = `${previousService}.service`;
  const command = rootWrapper(String.raw`set -eu
rm -f /etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf
${firewallConfigurationScript(diagnostics.firewall, false)}
systemctl disable --now lightdm.service 2>/dev/null || true
td_packages=""
for td_package in lightdm lightdm-gtk-greeter; do
  dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_packages="$td_packages $td_package" || true
done
[ -z "$td_packages" ] || DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_packages
cp -a ${shellQuote(backup)} /etc/X11/default-display-manager
systemctl daemon-reload
systemctl enable --force ${shellQuote(serviceUnit)}
systemctl restart ${shellQuote(serviceUnit)}
rm -f /var/lib/tunneldesk/xdmcp-lightdm-owner
printf 'TD_UNINSTALLED=lightdm\nTD_RESTORED_DISPLAY_MANAGER=%s\n' ${shellQuote(previousService)}
`);
  return {
    available:true,
    command,
    previous_service:previousService,
    warning:`卸载会停止 LightDM、恢复 ${previousService} 并中断当前图形登录会话；SSH 连接不受影响`
  };
}

function parseDetectionOutput(output) {
  const values = new Map();
  const sessions = [];
  const graphicalSessions = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^TD_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    if (match[1] === "SESSION") {
      const separator = match[2].indexOf("|");
      sessions.push({id:separator < 0 ? match[2] : match[2].slice(0, separator), name:separator < 0 ? match[2] : match[2].slice(separator + 1)});
    } else if (match[1] === "GRAPHICAL_SESSION") {
      const [id="", service="", display="", seat="", desktop="", state=""] = match[2].split("|");
      if (id) graphicalSessions.push({id, service, display, seat, desktop, state});
    } else values.set(match[1], match[2]);
  }
  const osId = String(values.get("OS_ID") || "").toLowerCase();
  const osLike = String(values.get("OS_LIKE") || "").toLowerCase();
  const macos = osId === "macos" || osLike === "darwin";
  const manager = values.get("MANAGER") || "unknown";
  const managerVersion = values.get("MANAGER_VERSION") || "";
  const gdmXdmcpCapable = manager === "gdm" && values.get("GDM_XDMCP_CAPABLE") === "1";
  const packageManager = values.get("PACKAGE_MANAGER") || "none";
  const supported = !macos && (manager === "lightdm" || gdmXdmcpCapable);
  const replacementAvailable = packageManager === "apt" && (manager === "sddm" || (manager === "gdm" && !gdmXdmcpCapable));
  const enabled = values.get("ENABLED") === "1";
  const listening = values.get("LISTENING") === "1";
  const loginUser = values.get("LOGIN_USER") || "";
  const usableSessions = sessions.filter(item => !["default", "lightdm-xsession"].includes(item.id));
  const sessionPriority = ["plasma", "xfce", "xfce4", "mate", "gnome", "gnome-xorg", "lxde", "lxqt"];
  const standardPreferred = sessionPriority.map(id => usableSessions.find(item => item.id === id)).find(Boolean) || usableSessions[0] || null;
  const safeRootPriority = ["xfce", "xfce4", "mate", "lxde", "lxqt"];
  const safeRootSession = safeRootPriority.map(id => usableSessions.find(item => item.id === id)).find(Boolean) || null;
  const preferredSession = loginUser === "root" ? safeRootSession || standardPreferred : standardPreferred;
  const configuredSession = values.get("CONFIGURED_SESSION") || "";
  const savedSession = values.get("SAVED_SESSION") || "";
  const sessionManagerTarget = values.get("SESSION_MANAGER_TARGET") || "";
  const savedSessionIsGeneric = ["default", "lightdm-xsession"].includes(savedSession);
  const savedSessionExists = !savedSession || sessions.some(item => item.id === savedSession);
  const resolvedGenericSession = savedSessionIsGeneric ? resolveSessionManagerTarget(sessionManagerTarget, sessions) : null;
  const explicitSavedSession = savedSession && !savedSessionIsGeneric ? sessions.find(item => item.id === savedSession) || null : null;
  const resolvedSavedSession = resolvedGenericSession || explicitSavedSession;
  const resolvedSavedSessionLabel = resolvedSavedSession
    ? savedSessionIsGeneric
      ? `${savedSession || "default"} -> ${resolvedSavedSession.name || resolvedSavedSession.id}`
      : resolvedSavedSession.name || resolvedSavedSession.id
    : "";
  const rootSessionNeedsRepair = loginUser === "root" && Boolean(safeRootSession)
    && resolvedSavedSession?.id !== safeRootSession.id;
  const sessionNeedsRepair = manager === "lightdm" && Boolean(preferredSession)
    && ((savedSessionIsGeneric ? !resolvedGenericSession : !savedSessionExists) || rootSessionNeedsRepair);
  const plasmaSession = [resolvedSavedSession?.id, preferredSession?.id, configuredSession, savedSession]
    .some(value => String(value || "").toLowerCase().includes("plasma"));
  const rootPlasmaRisk = loginUser === "root" && !safeRootSession && plasmaSession;
  const xrdpInstalled = values.get("XRDP_INSTALLED") === "1";
  const xrdpXfceConfigured = values.get("XRDP_XFCE_CONFIGURED") === "1";
  const hasXfceSession = usableSessions.some(item => ["xfce", "xfce4"].includes(item.id));
  const xrdpNeedsRepair = xrdpInstalled && hasXfceSession && !xrdpXfceConfigured;
  const plasmaDisplay = values.get("PLASMA_DISPLAY") || "";
  const normalizedPlasmaDisplay = normalizeDisplay(plasmaDisplay);
  const activeGraphicalSessions = graphicalSessions.filter(item => !["closing", "dead"].includes(String(item.state || "").toLowerCase()));
  const remoteGraphicalSessions = activeGraphicalSessions.filter(item => !item.seat);
  const localGraphicalSessions = activeGraphicalSessions.filter(item => Boolean(item.seat));
  const matchingGraphicalSessions = normalizedPlasmaDisplay
    ? activeGraphicalSessions.filter(item => normalizeDisplay(item.display) === normalizedPlasmaDisplay)
    : [];
  const matchingRemoteGraphicalSessions = matchingGraphicalSessions.filter(item => !item.seat);
  const matchingLocalGraphicalSessions = matchingGraphicalSessions.filter(item => Boolean(item.seat));
  const sessionConflict = plasmaSession && matchingGraphicalSessions.length > 0;
  const canCleanupRemoteSessions = sessionConflict && matchingRemoteGraphicalSessions.length > 0 && matchingLocalGraphicalSessions.length === 0;
  const canInstallXfce = !macos && manager === "lightdm" && ["apt", "dnf", "pacman"].includes(packageManager);
  const privileged = values.get("PRIVILEGED") === "1";
  const needsDesktopInstall = !macos && (!usableSessions.length || rootPlasmaRisk);
  const detectedAction = macos
    ? "unsupported"
    : sessionConflict && canCleanupRemoteSessions
      ? "cleanup-sessions"
      : xrdpNeedsRepair
        ? "repair-xrdp"
      : needsDesktopInstall && canInstallXfce
        ? "install-xfce"
        : listening
          ? sessionNeedsRepair
            ? "repair-session"
            : "ready"
          : enabled && supported ? "restart" : supported ? "enable" : replacementAvailable ? "install-lightdm" : "manual";
  const action = !privileged && detectedAction !== "ready" && detectedAction !== "unsupported"
    ? "manual"
    : detectedAction;
  const result: any = {
    os_id:osId,
    os_like:osLike,
    platform_unsupported:macos,
    manager,
    manager_label:macos ? "macOS" : manager === "gdm" ? "GDM" : manager === "lightdm" ? "LightDM" : manager === "sddm" ? "SDDM" : manager === "xdm" ? "XDM" : "未知",
    manager_version:managerVersion,
    gdm_xdmcp_capable:gdmXdmcpCapable,
    service:values.get("SERVICE") || "",
    package_manager:packageManager,
    privileged,
    config_file:values.get("CONFIG") || "",
    enabled,
    listening,
    firewall:values.get("FIREWALL") || "none",
    firewall_managed:values.get("FIREWALL_MANAGED") === "1",
    lightdm_managed:values.get("LIGHTDM_MANAGED") === "1",
    lightdm_previous_service:values.get("LIGHTDM_PREVIOUS_SERVICE") || "",
    lightdm_backup:values.get("LIGHTDM_BACKUP") || "",
    sessions,
    usable_sessions:usableSessions,
    has_x11_session:Boolean(usableSessions.length),
    preferred_session:preferredSession,
    configured_session:configuredSession,
    saved_session:savedSession,
    session_manager_target:sessionManagerTarget,
    resolved_saved_session:resolvedSavedSession,
    resolved_saved_session_label:resolvedSavedSessionLabel,
    session_needs_repair:sessionNeedsRepair,
    root_plasma_risk:rootPlasmaRisk,
    xrdp_installed:xrdpInstalled,
    xrdp_xfce_configured:xrdpXfceConfigured,
    xrdp_needs_repair:xrdpNeedsRepair,
    root_session_needs_repair:rootSessionNeedsRepair,
    login_user:values.get("LOGIN_USER") || "",
    graphical_sessions:graphicalSessions,
    active_graphical_sessions:activeGraphicalSessions,
    remote_graphical_sessions:remoteGraphicalSessions,
    local_graphical_sessions:localGraphicalSessions,
    matching_graphical_sessions:matchingGraphicalSessions,
    matching_remote_graphical_sessions:matchingRemoteGraphicalSessions,
    matching_local_graphical_sessions:matchingLocalGraphicalSessions,
    plasma_display:plasmaDisplay,
    session_conflict:sessionConflict,
    can_cleanup_remote_sessions:canCleanupRemoteSessions,
    can_install_xfce:canInstallXfce,
    needs_desktop_install:needsDesktopInstall,
    ready_for_login:Boolean(listening && usableSessions.length && !rootPlasmaRisk && !sessionConflict && !sessionNeedsRepair && !macos),
    desktop_selection:"login-screen",
    supported,
    replacement_available:replacementAvailable,
    action,
    required_action:detectedAction,
    warning:macos
      ? "macOS 不提供可由 TunnelDesk 配置的 XDMCP 图形登录服务。请使用 VNC 共享桌面，或通过 SSH X11 打开单个图形程序。"
      : !privileged && action === "manual"
      ? "当前 SSH 管理账号没有 root 或免密 sudo 权限。可点击操作按钮输入一次性管理员账号、密码、私钥或 SSH Agent，也可以在终端中手动执行。"
      : sessionConflict
      ? matchingLocalGraphicalSessions.length
        ? `账号 ${values.get("LOGIN_USER") || "当前管理账号"} 已在本地桌面运行 Plasma（${plasmaDisplay}），同账号再次登录 XDMCP 可能只显示壁纸。请先注销本地桌面或改用另一个账号。`
        : `检测到 ${matchingRemoteGraphicalSessions.length} 个同账号远程图形会话，Plasma 仍绑定在 ${plasmaDisplay}；可先结束这些会话，再启动新的 XDMCP 桌面。`
      : rootPlasmaRisk
      ? "当前使用 root 账号启动 Plasma X11，KDE 会话容易因 DBus/KDE 运行时冲突黑屏。建议安装并切换到 XFCE 等轻量 X11 会话，或使用普通桌面账号。"
      : !usableSessions.length
      ? listening
        ? "XDMCP 已启用且 UDP 177 正在监听，但远端没有可启动的 X11 桌面会话；直接登录通常会得到黑屏。请先安装 XFCE、Plasma X11 或其他 X11 桌面。"
        : enabled
          ? "XDMCP 配置已经写入，但 UDP 177 尚未监听；同时远端没有可启动的 X11 桌面会话。请先安装桌面，再应用并重启显示管理器。"
          : "XDMCP 尚未启用、UDP 177 未监听，并且远端没有可启动的 X11 桌面会话。请先安装桌面，再启用 XDMCP 服务。"
      : sessionNeedsRepair
      ? `管理账号保存的桌面会话 ${savedSession || "default"} 无法启动完整桌面，可由 TunnelDesk 自动改为 ${preferredSession?.name || preferredSession?.id}。`
      : manager === "sddm"
      ? "当前 SDDM 不提供 XDMCP 服务端；Debian/Ubuntu 可安装并切换 LightDM。"
      : manager === "gdm" && !gdmXdmcpCapable
      ? `当前 GDM${managerVersion ? ` ${managerVersion}` : ""} 不提供可用的 XDMCP 服务端；GDM 50 起已移除该能力，Debian/Ubuntu 可安装并切换 LightDM。`
      : manager === "unknown" || manager === "xdm"
        ? "当前显示管理器无法由 TunnelDesk 自动配置。"
      : "XDMCP 不加密，只应在可信局域网使用。"
  };
  const packagePlans = {
    lightdm:xdmcpPackagePlan(result, "install-lightdm"),
    xfce:xdmcpPackagePlan(result, "install-xfce"),
    rdp:rdpPackagePlan({...result, platform:"linux"}) || xdmcpPackagePlan(result, "install-rdp")
  };
  const selectedAction = String(detectedAction);
  const selectedPlan = packagePlans[selectedAction === "install-xfce" ? "xfce" : selectedAction === "install-lightdm" ? "lightdm" : selectedAction === "install-rdp" ? "rdp" : "lightdm"];
  result.package_plans = packagePlans;
  result.package_plan = selectedPlan;
  result.install_plan = selectedPlan?.component_plan || null;
  result.rdp_install_plan = packagePlans.rdp;
  result.uninstall_plan = packagePlans.lightdm?.uninstall || null;
  return result;
}

function firewallConfigurationScript(firewall, enable) {
  const marker = "/var/lib/tunneldesk/xdmcp-firewall-owner";
  if (enable && firewall === "ufw-active") return String.raw`td_firewall_marker=${shellQuote(marker)}
if ! ufw status 2>/dev/null | grep -Eiq '(^|[[:space:]])177/udp([[:space:]]|$)'; then
  ufw allow 177/udp comment 'TunnelDesk XDMCP'
  mkdir -p "$(dirname "$td_firewall_marker")"
  printf 'ufw\n' > "$td_firewall_marker"
fi`;
  if (enable && firewall === "firewalld-active") return String.raw`td_firewall_marker=${shellQuote(marker)}
if ! firewall-cmd --permanent --query-port=177/udp >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=177/udp
  firewall-cmd --reload
  mkdir -p "$(dirname "$td_firewall_marker")"
  printf 'firewalld\n' > "$td_firewall_marker"
fi`;
  if (!enable) return String.raw`td_firewall_marker=${shellQuote(marker)}
if [ -f "$td_firewall_marker" ]; then
  td_firewall_owner=$(cat "$td_firewall_marker" 2>/dev/null || true)
  if [ "$td_firewall_owner" = "ufw" ] && command -v ufw >/dev/null 2>&1; then
    ufw --force delete allow 177/udp || true
  elif [ "$td_firewall_owner" = "firewalld" ] && command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --remove-port=177/udp || true
    firewall-cmd --reload || true
  fi
  rm -f "$td_firewall_marker"
fi`;
  return ":";
}

function rootWrapper(script) {
  const payload = Buffer.from(script, "utf8").toString("base64");
  return `td_payload=${shellQuote(payload)}; if [ "$(id -u 2>/dev/null)" = "0" ]; then printf '%s' "$td_payload" | base64 -d | sh; elif sudo -n true >/dev/null 2>&1; then printf '%s' "$td_payload" | base64 -d | sudo -n sh; else echo '需要 root 或免密 sudo 权限' >&2; exit 77; fi`;
}

const GDM_EDITOR = String.raw`import pathlib, shutil, sys, time
p = pathlib.Path(sys.argv[1])
enabled = sys.argv[2] == "1"
text = p.read_text(encoding="utf-8") if p.exists() else ""
if p.exists():
    shutil.copy2(p, p.with_name(p.name + ".tunneldesk-backup-" + str(int(time.time()))))

def set_key(source, section, key, value):
    lines = source.splitlines()
    header = "[" + section + "]"
    start = next((i for i, line in enumerate(lines) if line.strip().lower() == header.lower()), None)
    if start is None:
        if lines and lines[-1].strip(): lines.append("")
        lines.extend([header, key + "=" + value])
        return "\n".join(lines) + "\n"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].strip().startswith("[")), len(lines))
    for i in range(start + 1, end):
        clean = lines[i].lstrip("#; ")
        if clean.lower().startswith(key.lower() + "="):
            lines[i] = key + "=" + value
            return "\n".join(lines) + "\n"
    lines.insert(end, key + "=" + value)
    return "\n".join(lines) + "\n"

text = set_key(text, "xdmcp", "Enable", "true" if enabled else "false")
if enabled:
    text = set_key(text, "daemon", "WaylandEnable", "false")
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(text, encoding="utf-8")
`;

function gdmConfigurationScript({enable, restart, firewall}) {
  const editor = Buffer.from(GDM_EDITOR, "utf8").toString("base64");
  return rootWrapper(String.raw`set -eu
td_file=""
for td_candidate in /etc/gdm/custom.conf /etc/gdm3/custom.conf /etc/gdm3/daemon.conf; do
  [ -f "$td_candidate" ] && td_file=$td_candidate && break
done
[ -n "$td_file" ] || td_file=/etc/gdm/custom.conf
command -v python3 >/dev/null 2>&1 || { echo '自动配置 GDM 需要 python3' >&2; exit 69; }
td_editor=/tmp/tunneldesk-gdm-xdmcp-$$.py
trap 'rm -f "$td_editor"' EXIT
printf '%s' '${editor}' | base64 -d > "$td_editor"
python3 "$td_editor" "$td_file" '${enable ? "1" : "0"}'
${firewallConfigurationScript(firewall, enable)}
${restart ? "systemctl restart gdm.service 2>/dev/null || systemctl restart gdm3.service" : ":"}
printf 'TD_CONFIGURED=gdm\nTD_ENABLED=${enable ? "1" : "0"}\n'
`);
}

function x11DesktopInstallScript(packageManager) {
  if (packageManager === "apt") return String.raw`export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y xfce4 dbus-x11`;
  if (packageManager === "dnf") return String.raw`dnf group install -y "Xfce"
dnf install -y dbus-x11`;
  if (packageManager === "pacman") return String.raw`pacman -S --noconfirm xfce4 dbus`;
  throw new Error("当前系统没有可自动安装的 XFCE 包管理器");
}

function xrdpXfceConfigurationScript() {
  return String.raw`if command -v xrdp >/dev/null 2>&1 && [ -f /etc/xrdp/startwm.sh ]; then
  td_xrdp_file=/etc/xrdp/startwm.sh
  cp -a "$td_xrdp_file" "$td_xrdp_file.tunneldesk-backup-$(date +%s)"
  cat > "$td_xrdp_file" <<'TD_XRDP_STARTWM'
#!/bin/sh
set -eu
if test -r /etc/profile; then . /etc/profile; fi
if test -r "$HOME/.profile"; then . "$HOME/.profile"; fi
unset DBUS_SESSION_BUS_ADDRESS
unset XDG_RUNTIME_DIR
export XDG_CURRENT_DESKTOP=XFCE
export XDG_SESSION_DESKTOP=xfce
export DESKTOP_SESSION=xfce
exec dbus-run-session -- startxfce4
TD_XRDP_STARTWM
  chmod 0755 "$td_xrdp_file"
  systemctl restart xrdp.service 2>/dev/null || true
  printf 'TD_XRDP_CONFIGURED=xfce\n'
fi`;
}

function lightdmConfigurationScript({
  enable,
  restart,
  install,
  firewall,
  session,
  installDesktop = false,
  packageManager = "",
  installCommand = "",
  desktopInstallCommand = "",
  forceUserSession = false,
  previousService = ""
}: {
  enable:boolean;
  restart:boolean;
  install:boolean;
  firewall:string;
  session:string;
  installDesktop?:boolean;
  packageManager?:string;
  installCommand?:string;
  desktopInstallCommand?:string;
  forceUserSession?:boolean;
  previousService?:string;
}) {
  const previousServiceUnit = /^[A-Za-z0-9_.@-]+$/.test(previousService) && previousService !== "lightdm"
    ? `${previousService}.service`
    : "";
  return rootWrapper(String.raw`set -eu
 ${install ? installCommand ? String.raw`${installCommand}
 command -v lightdm >/dev/null 2>&1 || { echo 'LightDM 离线安装命令已结束，但仍未检测到 lightdm' >&2; exit 69; }` : String.raw`if ! command -v lightdm >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || { echo '当前系统不支持自动安装 LightDM' >&2; exit 69; }
  export DEBIAN_FRONTEND=noninteractive
  command -v debconf-set-selections >/dev/null 2>&1 && printf 'lightdm shared/default-x-display-manager select lightdm\n' | debconf-set-selections
  apt-get update
  apt-get install -y lightdm lightdm-gtk-greeter
 fi` : "command -v lightdm >/dev/null 2>&1 || { echo 'LightDM 未安装' >&2; exit 69; }"}
 ${installDesktop ? desktopInstallCommand || x11DesktopInstallScript(packageManager) : ""}
${installDesktop ? xrdpXfceConfigurationScript() : ""}
td_dir=/etc/lightdm/lightdm.conf.d
td_file=$td_dir/90-tunneldesk-xdmcp.conf
mkdir -p "$td_dir"
[ ! -f "$td_file" ] || cp -a "$td_file" "$td_file.tunneldesk-backup-$(date +%s)"
cat > "$td_file" <<'TD_XDMCP_CONFIG'
[XDMCPServer]
enabled=${enable ? "true" : "false"}
port=177
${enable && session ? `
[Seat:*]
user-session=${session}` : ""}
TD_XDMCP_CONFIG
${enable && session ? String.raw`td_login_user="${"$"}{SUDO_USER:-$(id -un)}"
td_login_home=$(getent passwd "$td_login_user" 2>/dev/null | cut -d: -f6)
if [ -n "$td_login_home" ]; then
  td_dmrc="$td_login_home/.dmrc"
  td_saved_session=$(sed -n 's/^[[:space:]]*Session[[:space:]]*=[[:space:]]*//p' "$td_dmrc" 2>/dev/null | head -n 1)
  td_saved_valid=0
  if [ -n "$td_saved_session" ] && [ -f "/usr/share/xsessions/$td_saved_session.desktop" ]; then td_saved_valid=1; fi
  if [ "$td_saved_session" = default ] || [ "$td_saved_session" = lightdm-xsession ]; then
    td_default_target=$(readlink -f /usr/bin/x-session-manager 2>/dev/null || true)
    [ -n "$td_default_target" ] && [ -x "$td_default_target" ] && td_saved_valid=1
  fi
  if [ "${forceUserSession ? "1" : "0"}" = 1 ] || [ "$td_saved_valid" = 0 ]; then
    [ ! -f "$td_dmrc" ] || cp -a "$td_dmrc" "$td_dmrc.tunneldesk-backup-$(date +%s)"
    printf '[Desktop]\nSession=%s\n' '${session}' > "$td_dmrc"
    chown "$(id -u "$td_login_user"):$(id -g "$td_login_user")" "$td_dmrc"
    chmod 0644 "$td_dmrc"
  fi
fi` : ":"}
${firewallConfigurationScript(firewall, enable)}
${install ? String.raw`td_dm_backup=""
if [ -f /etc/X11/default-display-manager ]; then
  td_dm_backup="/etc/X11/default-display-manager.tunneldesk-backup-$(date +%s)"
  cp -a /etc/X11/default-display-manager "$td_dm_backup"
fi
mkdir -p /var/lib/tunneldesk
printf 'previous_service=%s\nbackup=%s\n' ${shellQuote(previousService)} "$td_dm_backup" > /var/lib/tunneldesk/xdmcp-lightdm-owner
printf '/usr/sbin/lightdm\n' > /etc/X11/default-display-manager
${previousServiceUnit ? `systemctl disable ${previousServiceUnit} 2>/dev/null || true` : ":"}
systemctl enable --force lightdm.service
systemctl daemon-reload` : ""}
${restart ? (install ? `${previousServiceUnit ? `systemctl stop ${previousServiceUnit} 2>/dev/null || true\n` : ""}systemctl restart lightdm.service` : "systemctl restart lightdm.service") : ":"}
printf 'TD_CONFIGURED=lightdm\nTD_ENABLED=${enable ? "1" : "0"}\n'
`);
}

function remoteGraphicalCleanupScript(diagnostics: any = {}) {
  const display = String(diagnostics.plasma_display || "").trim();
  const sessionIds = (diagnostics.matching_remote_graphical_sessions || [])
    .map(item => String(item?.id || ""))
    .filter(id => /^[A-Za-z0-9_.:-]+$/.test(id));
  return rootWrapper(String.raw`set -eu
td_login_user="${"$"}{SUDO_USER:-$(id -un)}"
td_login_uid=$(id -u "$td_login_user")
td_target_display=${shellQuote(display)}
td_target_display_normalized=$(printf '%s' "$td_target_display" | tr '[:upper:]' '[:lower:]' | sed 's/\.0$//')
td_expected_sessions=${shellQuote(sessionIds.join(" "))}
[ -n "$td_target_display_normalized" ] || { echo '没有可清理的图形 DISPLAY' >&2; exit 78; }
[ -n "$td_expected_sessions" ] || { echo '没有可清理的远程图形会话' >&2; exit 78; }
td_normalize_display() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/\.0$//'
}
td_local_sessions=""
if command -v loginctl >/dev/null 2>&1; then
  for td_session_id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    td_session_uid=$(loginctl show-session "$td_session_id" -p User --value 2>/dev/null || true)
    [ "$td_session_uid" = "$td_login_uid" ] || continue
    td_session_type=$(loginctl show-session "$td_session_id" -p Type --value 2>/dev/null || true)
    case "$td_session_type" in x11|wayland) ;; *) continue ;; esac
    td_session_class=$(loginctl show-session "$td_session_id" -p Class --value 2>/dev/null || true)
    [ "$td_session_class" = user ] || continue
    td_session_state=$(loginctl show-session "$td_session_id" -p State --value 2>/dev/null || true)
    case "$td_session_state" in closing|dead) continue ;; esac
    td_session_display=$(loginctl show-session "$td_session_id" -p Display --value 2>/dev/null || true)
    [ "$(td_normalize_display "$td_session_display")" = "$td_target_display_normalized" ] || continue
    td_session_seat=$(loginctl show-session "$td_session_id" -p Seat --value 2>/dev/null || true)
    if [ -n "$td_session_seat" ]; then
      td_local_sessions="$td_local_sessions $td_session_id"
    fi
  done
fi
[ -z "$td_local_sessions" ] || { echo "检测到同 DISPLAY 的本地图形会话，TunnelDesk 不会自动结束：$td_local_sessions" >&2; exit 78; }
td_cleaned=0
for td_session_id in $td_expected_sessions; do
  td_session_uid=$(loginctl show-session "$td_session_id" -p User --value 2>/dev/null || true)
  [ "$td_session_uid" = "$td_login_uid" ] || continue
  td_session_type=$(loginctl show-session "$td_session_id" -p Type --value 2>/dev/null || true)
  case "$td_session_type" in x11|wayland) ;; *) continue ;; esac
  td_session_class=$(loginctl show-session "$td_session_id" -p Class --value 2>/dev/null || true)
  [ "$td_session_class" = user ] || continue
  td_session_state=$(loginctl show-session "$td_session_id" -p State --value 2>/dev/null || true)
  case "$td_session_state" in closing|dead) continue ;; esac
  td_session_seat=$(loginctl show-session "$td_session_id" -p Seat --value 2>/dev/null || true)
  [ -z "$td_session_seat" ] || continue
  td_session_display=$(loginctl show-session "$td_session_id" -p Display --value 2>/dev/null || true)
  [ "$(td_normalize_display "$td_session_display")" = "$td_target_display_normalized" ] || continue
  if loginctl terminate-session "$td_session_id" 2>/dev/null; then
    td_cleaned=$((td_cleaned + 1))
  fi
done
td_process_ids=""
for td_process_name in plasmashell kwin_x11 ksmserver kded5 kglobalaccel5 xembedsniproxy ksplashqml; do
  for td_process_pid in $(pgrep -u "$td_login_uid" -x "$td_process_name" 2>/dev/null || true); do
    td_process_ids="$td_process_ids $td_process_pid"
  done
done
for td_process_pid in $(pgrep -u "$td_login_uid" -f '(^|/)(startplasma-x11|x-session-manager)([[:space:]]|$)' 2>/dev/null || true); do
  td_process_ids="$td_process_ids $td_process_pid"
done
for td_process_pid in $td_process_ids; do
  [ -r "/proc/$td_process_pid/environ" ] || continue
  td_process_display=$(tr '\0' '\n' < "/proc/$td_process_pid/environ" 2>/dev/null | sed -n 's/^DISPLAY=//p' | head -n 1)
  [ "$(td_normalize_display "$td_process_display")" = "$td_target_display_normalized" ] || continue
  kill -TERM "$td_process_pid" 2>/dev/null || true
done
sleep 1
printf 'TD_CLEANED_SESSIONS=%s\nTD_CLEANED_USER=%s\nTD_CLEANED_DISPLAY=%s\n' "$td_cleaned" "$td_login_user" "$td_target_display"
`);
}

function buildConfigurationScript(diagnostics, action, restart = true, options: any = {}) {
  if (!diagnostics.privileged) throw new Error("所选 SSH 连接需要 root 或免密 sudo 权限");
  if (action === "cleanup-sessions") {
    if (!diagnostics.can_cleanup_remote_sessions) throw new Error("没有可由 TunnelDesk 安全结束的远程图形会话");
    return remoteGraphicalCleanupScript(diagnostics);
  }
  if (action === "uninstall-lightdm") {
    const plan = lightdmUninstallPlan(diagnostics);
    if (!plan?.available || !plan.command) throw new Error(plan?.reason || "当前 LightDM 不能安全自动卸载");
    return plan.command;
  }
  const detectedSession = String(diagnostics.preferred_session?.id || "");
  const session = /^[A-Za-z0-9_.+-]+$/.test(detectedSession) ? detectedSession : "";
  if (action === "install-lightdm") {
    if (!diagnostics.replacement_available) throw new Error("当前系统不支持自动安装并切换 LightDM");
    return lightdmConfigurationScript({enable:true, restart, install:true, firewall:diagnostics.firewall, session, previousService:String(diagnostics.service || ""), installCommand:String(options.install_command || "")});
  }
  if (action === "repair-xrdp") {
    if (!diagnostics.xrdp_needs_repair) throw new Error("当前系统没有检测到需要修复的 XFCE xrdp 会话");
    return rootWrapper(String.raw`set -eu
${xrdpXfceConfigurationScript()}
printf 'TD_XRDP_CONFIGURED=xfce\n'
`);
  }
  if (action === "install-xfce") {
    if (diagnostics.manager !== "lightdm" || !diagnostics.can_install_xfce) throw new Error("当前系统无法由 TunnelDesk 自动安装并配置 XFCE");
    return lightdmConfigurationScript({
      enable:true,
      restart,
      install:false,
      firewall:diagnostics.firewall,
      session:"xfce",
      installDesktop:true,
      packageManager:diagnostics.package_manager,
      desktopInstallCommand:String(options.install_command || ""),
      forceUserSession:true
    });
  }
  if (!diagnostics.supported) throw new Error("当前显示管理器无法由 TunnelDesk 自动配置 XDMCP");
  const enable = action !== "disable";
  return diagnostics.manager === "gdm"
    ? gdmConfigurationScript({enable, restart, firewall:diagnostics.firewall})
    : lightdmConfigurationScript({enable, restart, install:false, firewall:diagnostics.firewall, session, forceUserSession:action === "repair-session"});
}

async function detectXdmcpServer(profile, dependencies) {
  const connection = resolveManagementConnection(profile, dependencies);
  const result = await dependencies.runSshCommandForConnection(connection, buildRemotePosixCommand(DETECT_SCRIPT), 30000);
  if (result.status !== 0) {
    const message = `${result.stderr || result.stdout || result.error?.message || "远端探测失败"}`.trim();
    throw new Error(message || "远端 XDMCP 探测失败");
  }
  return {
    ok:true,
    ...parseDetectionOutput(result.stdout),
    ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user}
  };
}

async function configureXdmcpServer(profile, data, dependencies) {
  const action = String(data?.action || "enable");
  const localActionMap = new Map([
    ["install-lightdm-local-offline", "install-lightdm"],
    ["install-xfce-local-offline", "install-xfce"],
    ["install-rdp-local-offline", "install-rdp"],
    ["install-local-offline", "install-lightdm"]
  ]);
  const offlineActionMap = new Map([
    ["install-lightdm-offline", "install-lightdm"],
    ["install-xfce-offline", "install-xfce"]
  ]);
  let localAction = localActionMap.get(action) || "";
  if (action === "install-local-offline") {
    const target = String(data?.target_action || data?.target || data?.component || "lightdm").toLowerCase();
    localAction = target.includes("xfce") || target.includes("desktop")
      ? "install-xfce"
      : target.includes("rdp") || target.includes("xrdp")
        ? "install-rdp"
        : "install-lightdm";
  }
  const offlineAction = offlineActionMap.get(action) || "";
  if (!new Set(["enable", "disable", "restart", "install-lightdm", "uninstall-lightdm", "install-xfce", "repair-xrdp", "repair-session", "cleanup-sessions", ...localActionMap.keys(), ...offlineActionMap.keys()]).has(action)) throw new Error("XDMCP 管理操作无效");
  const confirmation = String(data?.confirmation || "");
  if (action === "uninstall-lightdm") {
    if (confirmation !== "XDMCP_UNINSTALL_LIGHTDM") throw new Error("请确认卸载 LightDM 并恢复原显示管理器");
  } else if (action === "cleanup-sessions") {
    if (confirmation !== "XDMCP_END_REMOTE_SESSIONS") throw new Error("请确认结束同账号的远程图形会话");
  } else if (confirmation !== "XDMCP_TRUSTED_LAN") throw new Error("请确认只在可信局域网启用 XDMCP");
  const connection = resolveManagementConnection(profile, dependencies);
  const before: any = await detectXdmcpServer(profile, dependencies);
  const privileged = typeof dependencies.runPrivilegedSshCommandForConnection === "function";
  if (localAction) {
    const planKey = localAction === "install-xfce" ? "xfce" : localAction === "install-rdp" ? "rdp" : "lightdm";
    const packagePlan = before.package_plans?.[planKey] || xdmcpPackagePlan(before, localAction);
    const localPlan = packagePlan?.component_plan?.local_offline || packagePlan?.local_offline;
    const packages = localPlan?.package_names || packagePlan?.local_offline_packages || [];
    if (!before.platform_unsupported && before.package_manager !== "apt" && !localPlan?.available) {
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
    if (!localPlan?.available || !packages.length) throw new Error("当前 XDMCP 操作没有可用的本机离线软件包方案");
    if (typeof dependencies.startRemoteOfflineInstall !== "function") throw new Error("当前后端未启用远端组件离线任务中心");
    const configuredBefore = privileged && !before.privileged ? {...before, privileged:true} : before;
    const configurationScript = buildConfigurationScript(configuredBefore, localAction, data?.restart !== false, {install_command:":"});
    const task = await dependencies.startRemoteOfflineInstall({
      connection,
      component:`xdmcp-${localAction}`,
      component_label:localAction === "install-xfce" ? "XDMCP 兼容桌面" : localAction === "install-rdp" ? "RDP 服务" : "LightDM XDMCP 服务",
      packages,
      action,
      scope:`xdmcp.${action}`,
      before,
      configure_label:"正在配置并启用 XDMCP 服务",
      after_install:async onChunk => {
        const command = buildRemotePosixCommand(configurationScript);
        const result = privileged
          ? await dependencies.runPrivilegedSshCommandForConnection(connection, command, 10 * 60 * 1000)
          : await dependencies.runSshCommandForConnection(connection, command, 10 * 60 * 1000);
        if (result?.stdout) onChunk(Buffer.from(result.stdout), "stdout");
        if (result?.stderr) onChunk(Buffer.from(result.stderr), "stderr");
        return result;
      },
      verify:() => detectXdmcpServer(profile, dependencies),
      validate:after => Boolean(after?.enabled) || "离线安装已结束，但 XDMCP 仍未启用"
    });
    return {ok:true, action, mode:"local-offline", before, package_plan:packagePlan, install_plan:packagePlan?.component_plan || null, task, defer_grant_release:true};
  }
  let installCommand = "";
  if (offlineAction) {
    const packagePlan = before.package_plans?.[offlineAction === "install-xfce" ? "xfce" : "lightdm"] || xdmcpPackagePlan(before, offlineAction);
    const selected = componentInstallCommand(packagePlan?.component_plan || packagePlan?.install_plan || packagePlan, "offline");
    installCommand = String(selected?.command || packagePlan?.offline_command || "").trim();
    if (!installCommand) throw new Error("远端没有可用的 XDMCP 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明");
  }
  const effectiveAction = offlineAction || action;
  const script = buildConfigurationScript(privileged && !before.privileged ? {...before, privileged:true} : before, effectiveAction, data?.restart !== false, {install_command:installCommand});
  const command = buildRemotePosixCommand(script);
  const timeoutMs = ["install-lightdm", "uninstall-lightdm", "install-xfce"].includes(effectiveAction) ? 10 * 60 * 1000 : 90000;
  if (typeof dependencies.startRemoteCommandTask === "function") {
    const actionLabels = {
      enable:"启用", disable:"关闭", restart:"重新启动", "install-lightdm":"在线安装",
      "install-lightdm-offline":"使用远端缓存安装", "uninstall-lightdm":"卸载",
      "install-xfce":"安装兼容桌面", "install-xfce-offline":"使用远端缓存安装兼容桌面",
      "repair-xrdp":"修复 RDP 会话", "repair-session":"修复桌面会话", "cleanup-sessions":"结束冲突会话"
    };
    const task = dependencies.startRemoteCommandTask({
      connection,
      component:effectiveAction.includes("lightdm") ? "xdmcp-lightdm" : effectiveAction.includes("xfce") ? "xdmcp-desktop" : "xdmcp",
      component_label:effectiveAction.includes("lightdm") ? "LightDM XDMCP 服务" : effectiveAction.includes("xfce") ? "XDMCP 兼容桌面" : "XDMCP 服务",
      action,
      action_label:actionLabels[action] || actionLabels[effectiveAction] || "配置",
      mode:effectiveAction === "uninstall-lightdm" ? "uninstall" : offlineAction ? "offline" : effectiveAction.startsWith("install-") ? "online" : "service",
      command:script,
      before,
      timeout_ms:timeoutMs,
      verify:() => detectXdmcpServer(profile, dependencies),
      validate:after => {
        if (effectiveAction === "uninstall-lightdm") return after?.manager !== "lightdm" || "LightDM 卸载命令已结束，但远端仍在使用 LightDM";
        if (effectiveAction === "disable") return !after?.enabled && !after?.listening || "XDMCP 关闭命令已结束，但 UDP 177 仍在监听";
        if (effectiveAction === "repair-xrdp") return !after?.xrdp_needs_repair || "RDP 会话修复命令已结束，但仍检测到配置异常";
        if (effectiveAction === "cleanup-sessions") return !after?.session_conflict || "冲突会话清理命令已结束，但仍检测到同账号图形会话冲突";
        return Boolean(after?.enabled) || "XDMCP 配置命令已结束，但远端仍未启用 XDMCP";
      }
    });
    return {
      ok:true,
      action,
      mode:effectiveAction === "uninstall-lightdm" ? "uninstall" : offlineAction ? "offline" : "online",
      before,
      package_plan:before.package_plan || null,
      install_plan:before.install_plan || null,
      uninstall_plan:before.uninstall_plan || null,
      task,
      defer_grant_release:true,
      temporary_authorization:privileged
    };
  }
  const result = privileged
    ? await dependencies.runPrivilegedSshCommandForConnection(connection, command, timeoutMs)
    : await dependencies.runSshCommandForConnection(connection, command, timeoutMs);
  if (result.status !== 0) {
    const message = `${result.stderr || result.stdout || result.error?.message || "配置失败"}`.trim();
    throw new Error(message || "XDMCP 配置失败");
  }
  const after = await detectXdmcpServer(profile, dependencies);
  return {ok:true, action, mode:offlineAction ? "offline" : "online", before, after, output:String(result.stdout || "").trim(), temporary_authorization:privileged};
}

module.exports = {
  DETECT_SCRIPT,
  buildConfigurationScript,
  configureXdmcpServer,
  detectXdmcpServer,
  lightdmUninstallPlan,
  xdmcpPackagePlan,
  parseDetectionOutput,
  remoteGraphicalCleanupScript,
  resolveManagementConnection
};
