const LINUX_IDS = new Set([
  "almalinux", "alpine", "amzn", "arch", "centos", "debian", "fedora", "gentoo",
  "kali", "linux", "linuxmint", "manjaro", "nixos", "opensuse", "oracle", "raspbian",
  "rhel", "rocky", "sles", "ubuntu"
]);
const { buildRemotePosixCommand } = require("./remote-posix");
const { componentInstallCommand, componentInstallPlan } = require("./remote-component-installer");
const { connectVncSocket } = require("./vnc-handshake");

const VNC_SSH_DIAGNOSTIC_TIMEOUT_MS = 8000;

function shellQuote(value: any) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function numericPort(value: any, fallback = 5900) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function platformFor(osId: string, kernel: string, osLike = "") {
  const id = String(osId || "").toLowerCase();
  const rawKernel = String(kernel || "").toLowerCase();
  const like = String(osLike || "").toLowerCase();
  if (rawKernel.includes("darwin") || id === "macos" || id === "darwin" || like.includes("darwin")) return "macos";
  if (rawKernel.includes("linux") || LINUX_IDS.has(id) || like.includes("linux")) return "linux";
  return "unknown";
}

function commandList(values: Map<string, string>, key: string) {
  return String(values.get(key) || "").split(",").map(item => item.trim()).filter(Boolean);
}

function boolValue(values: Map<string, string>, key: string) {
  return values.get(key) === "1";
}

/**
 * The probe intentionally uses only read-only commands. It can run as the
 * saved SSH user; installation/start operations use the separate privilege
 * grant flow in server.ts.
 */
function buildDetectionScript(port = 5900) {
  const targetPort = numericPort(port);
  const script = String.raw`set +e
td_emit() { printf 'TD_VNC_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
td_os_id=""
td_os_like=""
td_kernel="$(uname -s 2>/dev/null || printf unknown)"
if [ -r /etc/os-release ]; then
  td_os_id=$(sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"')
  td_os_like=$(sed -n 's/^ID_LIKE=//p' /etc/os-release | head -n 1 | tr -d '"')
fi
if [ -z "$td_os_id" ]; then
  case "$td_kernel" in
    Darwin) td_os_id=macos; td_os_like=darwin ;;
    Linux) td_os_id=linux ;;
  esac
fi
td_package_manager=none
command -v apt-get >/dev/null 2>&1 && td_package_manager=apt
command -v dnf >/dev/null 2>&1 && td_package_manager=dnf
[ "$td_package_manager" = none ] && command -v yum >/dev/null 2>&1 && td_package_manager=yum
[ "$td_package_manager" = none ] && command -v pacman >/dev/null 2>&1 && td_package_manager=pacman
[ "$td_package_manager" = none ] && command -v zypper >/dev/null 2>&1 && td_package_manager=zypper
[ "$td_package_manager" = none ] && command -v apk >/dev/null 2>&1 && td_package_manager=apk
td_uid=$(id -u 2>/dev/null || printf -1)
td_privileged=0
[ "$td_uid" = 0 ] && td_privileged=1
[ "$td_privileged" = 1 ] || sudo -n true >/dev/null 2>&1 && td_privileged=1
td_init_system=$(ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]')
td_systemd_available=0
td_systemctl_path=""
td_systemctl_usable=0
if command -v systemctl >/dev/null 2>&1; then
  td_systemctl_path=$(command -v systemctl 2>/dev/null | head -n 1)
elif [ "$td_init_system" = systemd ]; then
  # Some hardened distributions make systemctl executable only by root. The
  # saved SSH user can still detect it and use it later through temporary
  # administrator authorization.
  for td_candidate in /bin/systemctl /usr/bin/systemctl /sbin/systemctl /usr/sbin/systemctl; do
    if [ -e "$td_candidate" ]; then td_systemctl_path=$td_candidate; break; fi
  done
fi
if [ "$td_init_system" = systemd ] && [ -n "$td_systemctl_path" ]; then
  td_systemd_available=1
  [ -x "$td_systemctl_path" ] && td_systemctl_usable=1
fi
td_platform=unknown
case "$td_kernel:$td_os_id:$td_os_like" in
  Darwin:*|*:macos:*|*:darwin:* ) td_platform=macos ;;
  Linux:*|*:linux:*|*:*:*linux* ) td_platform=linux ;;
esac
td_commands=""
td_installed=0
for td_command in x11vnc vncserver tigervncserver vncpasswd Xtigervnc Xvnc wayvnc gnome-remote-desktop; do
  if command -v "$td_command" >/dev/null 2>&1; then
    td_commands="\${td_commands}\${td_commands:+,}$td_command"
    td_installed=1
  fi
done
td_packages=""
td_has_package() {
  case "$td_package_manager" in
    apt) dpkg-query -W -f='\${Status}' "$1" 2>/dev/null | grep -q 'install ok installed' ;;
    dnf|yum) rpm -q "$1" >/dev/null 2>&1 ;;
    pacman) pacman -Q "$1" >/dev/null 2>&1 ;;
    zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    apk) apk info -e "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}
for td_package in x11vnc tigervnc-server tigervnc-standalone-server tigervnc-common wayvnc gnome-remote-desktop; do
  if td_has_package "$td_package"; then
    td_packages="\${td_packages}\${td_packages:+,}$td_package"
    td_installed=1
  fi
done
td_session_user=$(id -un 2>/dev/null || printf unknown)
td_session_uid=$td_uid
td_session_home=\${HOME:-}
td_session_active=0
td_display="\${DISPLAY:-}"
td_xauthority="\${XAUTHORITY:-}"
td_wayland_display="\${WAYLAND_DISPLAY:-}"
td_runtime_dir="\${XDG_RUNTIME_DIR:-}"
td_password_file=""
td_desktop_command=""
td_vnc_process=""
td_clipboard_tools=""
if [ "$td_platform" = linux ]; then
  for td_env in /proc/[0-9]*/environ; do
    [ -r "$td_env" ] || continue
    td_pid=\${td_env#/proc/}; td_pid=\${td_pid%/environ}
    td_owner_uid=$(stat -c %u "/proc/$td_pid" 2>/dev/null || printf -1)
    [ "$td_uid" = 0 ] || [ "$td_owner_uid" = "$td_uid" ] || continue
    td_args=$(tr '\000' ' ' < "/proc/$td_pid/cmdline" 2>/dev/null)
    case "$td_args" in
      *plasmashell*|*xfce4-session*|*xfdesktop*|*gnome-shell*|*gnome-session*|*mate-session*|*cinnamon-session*|*lxqt-session*|*startplasma*|*startxfce4*) ;;
      *) continue ;;
    esac
    td_values=$(tr '\000' '\n' < "$td_env" 2>/dev/null)
    td_candidate_display=$(printf '%s\n' "$td_values" | sed -n 's/^DISPLAY=//p' | head -n 1)
    td_candidate_wayland=$(printf '%s\n' "$td_values" | sed -n 's/^WAYLAND_DISPLAY=//p' | head -n 1)
    [ -n "$td_candidate_display$td_candidate_wayland" ] || continue
    [ -n "$td_display" ] || td_display=$td_candidate_display
    [ -n "$td_wayland_display" ] || td_wayland_display=$td_candidate_wayland
    [ -n "$td_xauthority" ] || td_xauthority=$(printf '%s\n' "$td_values" | sed -n 's/^XAUTHORITY=//p' | head -n 1)
    [ -n "$td_runtime_dir" ] || td_runtime_dir=$(printf '%s\n' "$td_values" | sed -n 's/^XDG_RUNTIME_DIR=//p' | head -n 1)
    td_owner_user=$(stat -c %U "/proc/$td_pid" 2>/dev/null || true)
    if [ -n "$td_owner_user" ] && [ "$td_owner_user" != UNKNOWN ]; then
      td_session_user=$td_owner_user
      td_session_uid=$td_owner_uid
      td_session_home=$(getent passwd "$td_session_user" 2>/dev/null | cut -d: -f6)
    fi
    td_session_active=1
    break
  done
  if [ -z "$td_display" ]; then
    td_display=$(ps -eo args= 2>/dev/null | sed -n 's/.*[[:space:]]\(:[0-9][0-9]*\)\([[:space:]].*\)\{0,1\}$/\1/p' | head -n 1)
  fi
  if [ -z "$td_display" ]; then
    td_socket=$(find /tmp/.X11-unix -maxdepth 1 -type s -name 'X[0-9]*' 2>/dev/null | sort -V | head -n 1)
    [ -n "$td_socket" ] && td_display=:\${td_socket##*/X}
  fi
  if [ -z "$td_session_home" ] || [ ! -d "$td_session_home" ]; then
    td_session_home=$(getent passwd "$td_session_user" 2>/dev/null | cut -d: -f6)
  fi
  if [ -z "$td_xauthority" ] && [ -n "$td_session_home" ]; then
    [ -r "$td_session_home/.Xauthority" ] && td_xauthority="$td_session_home/.Xauthority"
  fi
  if [ -z "$td_xauthority" ] && [ -n "$td_display" ]; then
    td_display_base=\${td_display%%.*}
    td_candidate_auth=$(ps -eo args= 2>/dev/null | awk -v display="$td_display_base" '
      {
        matched=0
        for (i=1; i<=NF; i++) if ($i == display) matched=1
        if (matched) for (i=1; i<NF; i++) if ($i == "-auth") { print $(i+1); exit }
      }')
    if [ -n "$td_candidate_auth" ]; then
      case "$td_candidate_auth" in
        /*) td_xauthority=$td_candidate_auth ;;
        *) [ -n "$td_session_home" ] && td_xauthority="\${td_session_home%/}/$td_candidate_auth" ;;
      esac
      [ -r "$td_xauthority" ] || td_xauthority=""
    fi
  fi
  if [ -z "$td_xauthority" ] && [ -n "$td_session_home" ] && [ -d "$td_session_home" ]; then
    td_xauthority=$(find "$td_session_home" -maxdepth 5 -type f -name .Xauthority -readable 2>/dev/null | head -n 1)
  fi
  if [ -z "$td_xauthority" ]; then
    td_xauthority=$(ps -eo args= 2>/dev/null | sed -n 's/.*[[:space:]]-auth[[:space:]]\([^[:space:]]*\).*/\1/p' | head -n 1)
  fi
  if [ -z "$td_runtime_dir" ] && [ "$td_session_uid" -ge 0 ] 2>/dev/null && [ -d "/run/user/$td_session_uid" ]; then
    td_runtime_dir="/run/user/$td_session_uid"
  fi
  if [ -z "$td_wayland_display" ] && [ -n "$td_runtime_dir" ]; then
    td_wayland_socket=$(find "$td_runtime_dir" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | sort | head -n 1)
    [ -n "$td_wayland_socket" ] && td_wayland_display=\${td_wayland_socket##*/}
  fi
  for td_candidate in "$td_session_home/.vnc/passwd" "\${HOME:-}/.vnc/passwd" /root/.vnc/passwd; do
    [ -n "$td_candidate" ] && [ -f "$td_candidate" ] && td_password_file=$td_candidate && break
  done
  for td_command in startxfce4 startplasma-x11 mate-session cinnamon-session startlxqt gnome-session; do
    if command -v "$td_command" >/dev/null 2>&1; then td_desktop_command=$td_command; break; fi
  done
  td_vnc_process=$(ps -eo pid=,user=,args= 2>/dev/null | awk '/[x]11vnc|[X]tigervnc|[X]vnc|[v]ncserver|[w]ayvnc/ {sub(/^[[:space:]]+/, ""); print; exit}')
  for td_command in xclip xsel wl-copy wl-paste; do
    command -v "$td_command" >/dev/null 2>&1 && td_clipboard_tools="\${td_clipboard_tools}\${td_clipboard_tools:+,}$td_command"
  done
fi
td_service_unit=""
td_service_state=missing
td_service_enabled=0
if [ "$td_platform" = macos ]; then
  td_installed=1
  if launchctl print system/com.apple.screensharing >/dev/null 2>&1; then
    td_service_unit=com.apple.screensharing
    td_service_state=active
  else
    td_service_state=inactive
  fi
else
  td_vnc_display_number=$((${targetPort} - 5899))
  [ "$td_vnc_display_number" -ge 1 ] 2>/dev/null && [ "$td_vnc_display_number" -le 99 ] 2>/dev/null || td_vnc_display_number=1
  for td_unit in tunneldesk-x11vnc.service "tunneldesk-tigervnc-$td_vnc_display_number.service" x11vnc.service "vncserver@:$td_vnc_display_number.service" "tigervncserver@:$td_vnc_display_number.service" vncserver@:1.service tigervncserver@:1.service wayvnc.service gnome-remote-desktop.service; do
    [ -n "$td_unit" ] || continue
    if [ "$td_systemctl_usable" = 1 ] && "$td_systemctl_path" list-unit-files "$td_unit" 2>/dev/null | grep -q "$td_unit"; then
      td_service_unit="$td_unit"
      td_service_state=$("$td_systemctl_path" is-active "$td_unit" 2>/dev/null | head -n 1)
      [ -n "$td_service_state" ] || td_service_state=inactive
      "$td_systemctl_path" is-enabled "$td_unit" >/dev/null 2>&1 && td_service_enabled=1
      break
    fi
    if [ "$td_systemd_available" = 1 ]; then
      for td_unit_dir in /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
        if [ -e "$td_unit_dir/$td_unit" ]; then
          td_service_unit="$td_unit"
          [ -n "$td_vnc_process" ] && td_service_state=active || td_service_state=inactive
          break 2
        fi
      done
    fi
  done
  if [ -z "$td_service_unit" ] && [ "$td_systemctl_usable" = 1 ]; then
    td_service_unit=$("$td_systemctl_path" list-unit-files --type=service --no-legend 2>/dev/null | awk '$1 ~ /(x11vnc|tigervnc|vncserver|wayvnc)/ {print $1; exit}')
    if [ -n "$td_service_unit" ]; then
      td_service_state=$("$td_systemctl_path" is-active "$td_service_unit" 2>/dev/null | head -n 1)
      [ -n "$td_service_state" ] || td_service_state=inactive
      "$td_systemctl_path" is-enabled "$td_service_unit" >/dev/null 2>&1 && td_service_enabled=1
    fi
  fi
  if [ -n "$td_service_unit" ] && [ "$td_service_enabled" = 0 ]; then
    for td_wants in /etc/systemd/system/*.target.wants; do
      [ -e "$td_wants/$td_service_unit" ] && td_service_enabled=1 && break
    done
  fi
  if [ -z "$td_service_unit" ] && [ "$td_installed" = 1 ]; then
    td_service_state=manual
  fi
fi
td_listening=0
if command -v ss >/dev/null 2>&1; then
  ss -H -lnt 2>/dev/null | awk '$4 ~ /:'${targetPort}'$/ {found=1} END {exit(found ? 0 : 1)}' && td_listening=1
elif command -v netstat >/dev/null 2>&1; then
  netstat -lnt 2>/dev/null | awk '$4 ~ /:'${targetPort}'$/ {found=1} END {exit(found ? 0 : 1)}' && td_listening=1
elif command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:${targetPort} -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q . && td_listening=1
fi
if [ "$td_listening" = 0 ] && command -v nc >/dev/null 2>&1; then
  nc -z -w 2 127.0.0.1 ${targetPort} >/dev/null 2>&1 && td_listening=1
fi
td_firewall=unknown
td_firewall_tool=none
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi '^Status: active'; then
  td_firewall_tool=ufw
  td_firewall=active
  ufw status 2>/dev/null | grep -Eq '[[:space:]]'${targetPort}'/tcp[[:space:]]+ALLOW' && td_firewall=allow
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then
  td_firewall_tool=firewalld
  td_firewall=active
  firewall-cmd --query-port=${targetPort}/tcp >/dev/null 2>&1 && td_firewall=allow
elif command -v pfctl >/dev/null 2>&1 && [ "$td_platform" = macos ]; then
  td_firewall_tool=pf
  td_firewall=system
else
  td_firewall=none
fi
td_emit PLATFORM "$td_platform"
td_emit OS_ID "$td_os_id"
td_emit OS_LIKE "$td_os_like"
td_emit KERNEL "$td_kernel"
td_emit PACKAGE_MANAGER "$td_package_manager"
td_emit UID "$td_uid"
td_emit PRIVILEGED "$td_privileged"
td_emit INIT_SYSTEM "$td_init_system"
td_emit SYSTEMD_AVAILABLE "$td_systemd_available"
td_emit SYSTEMCTL_PATH "$td_systemctl_path"
td_emit SYSTEMCTL_USABLE "$td_systemctl_usable"
td_emit INSTALLED "$td_installed"
td_emit COMMANDS "$td_commands"
td_emit PACKAGES "$td_packages"
td_emit SERVICE_UNIT "$td_service_unit"
td_emit SERVICE_STATE "$td_service_state"
td_emit SERVICE_ENABLED "$td_service_enabled"
td_emit LISTENING "$td_listening"
td_emit FIREWALL "$td_firewall"
td_emit FIREWALL_TOOL "$td_firewall_tool"
td_emit SESSION_USER "$td_session_user"
td_emit SESSION_UID "$td_session_uid"
td_emit SESSION_HOME "$td_session_home"
td_emit SESSION_ACTIVE "$td_session_active"
td_emit DISPLAY "$td_display"
td_emit XAUTHORITY "$td_xauthority"
td_emit WAYLAND_DISPLAY "$td_wayland_display"
td_emit XDG_RUNTIME_DIR "$td_runtime_dir"
td_emit PASSWORD_FILE "$td_password_file"
td_emit DESKTOP_COMMAND "$td_desktop_command"
td_emit VNC_PROCESS "$td_vnc_process"
td_emit CLIPBOARD_TOOLS "$td_clipboard_tools"
td_emit PORT "${targetPort}"
`;
  // String.raw keeps the escape used to prevent TypeScript template
  // interpolation; remove only that marker before sending the shell script.
  return script.replace(/\\\$\{/g, "${");
}

const DETECT_SCRIPT = buildDetectionScript(5900);

function parseDetectionOutput(output: string, requestedPort = 5900) {
  const values = new Map<string, string>();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^TD_VNC_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  const port = numericPort(values.get("PORT") || requestedPort);
  const platform = String(values.get("PLATFORM") || platformFor(values.get("OS_ID") || "", values.get("KERNEL") || "", values.get("OS_LIKE") || "")).toLowerCase();
  const installed = boolValue(values, "INSTALLED");
  const listening = boolValue(values, "LISTENING");
  const serviceState = String(values.get("SERVICE_STATE") || "unknown").toLowerCase();
  const firewall = String(values.get("FIREWALL") || "unknown").toLowerCase();
  const uid = Number(values.get("UID") || -1);
  let status = "unknown";
  let recommendedAction = "guide";
  if (listening) {
    status = "ready";
    recommendedAction = "connect";
  } else if (platform === "macos") {
    status = serviceState === "active" ? "not-listening" : "stopped";
    recommendedAction = "guide";
  } else if (!installed) {
    status = "not-installed";
    recommendedAction = "install";
  } else if (["inactive", "manual", "missing"].includes(serviceState)) {
    status = "stopped";
    recommendedAction = "start";
  } else {
    status = "not-listening";
    recommendedAction = "start";
  }
  return {
    diagnostics_available:true,
    platform,
    os_id:String(values.get("OS_ID") || "").toLowerCase(),
    os_like:String(values.get("OS_LIKE") || "").toLowerCase(),
    kernel:String(values.get("KERNEL") || ""),
    package_manager:String(values.get("PACKAGE_MANAGER") || "none").toLowerCase(),
    uid,
    root:uid === 0,
    privileged:boolValue(values, "PRIVILEGED"),
    init_system:String(values.get("INIT_SYSTEM") || "").toLowerCase(),
    systemd_available:values.has("SYSTEMD_AVAILABLE") ? boolValue(values, "SYSTEMD_AVAILABLE") : true,
    systemctl_path:String(values.get("SYSTEMCTL_PATH") || ""),
    systemctl_usable:values.has("SYSTEMCTL_USABLE") ? boolValue(values, "SYSTEMCTL_USABLE") : true,
    builtin:platform === "macos",
    installed,
    commands:commandList(values, "COMMANDS"),
    packages:commandList(values, "PACKAGES"),
    service_unit:String(values.get("SERVICE_UNIT") || ""),
    service_state:serviceState,
    service_enabled:boolValue(values, "SERVICE_ENABLED"),
    listening,
    firewall,
    firewall_tool:String(values.get("FIREWALL_TOOL") || "none").toLowerCase(),
    session_user:String(values.get("SESSION_USER") || ""),
    session_uid:Number(values.get("SESSION_UID") || -1),
    session_home:String(values.get("SESSION_HOME") || ""),
    session_active:boolValue(values, "SESSION_ACTIVE"),
    display:String(values.get("DISPLAY") || ""),
    xauthority:String(values.get("XAUTHORITY") || ""),
    wayland_display:String(values.get("WAYLAND_DISPLAY") || ""),
    xdg_runtime_dir:String(values.get("XDG_RUNTIME_DIR") || ""),
    password_file:String(values.get("PASSWORD_FILE") || ""),
    desktop_command:String(values.get("DESKTOP_COMMAND") || ""),
    vnc_process:String(values.get("VNC_PROCESS") || ""),
    clipboard_tools:commandList(values, "CLIPBOARD_TOOLS"),
    port,
    status,
    recommended_action:recommendedAction,
    can_install:platform === "linux" && ["apt", "dnf", "yum", "pacman", "zypper", "apk"].includes(String(values.get("PACKAGE_MANAGER") || "").toLowerCase())
  };
}

function packagePlan(diagnostics: any = {}) {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const virtualSession = diagnostics.session_active !== true || !String(diagnostics.display || "").trim();
  const aptPackages = virtualSession
    ? ["tigervnc-standalone-server", "tigervnc-tools"]
    : ["x11vnc"];
  const onlineCommands: Record<string, string> = virtualSession ? {
    apt:"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y tigervnc-standalone-server tigervnc-tools",
    dnf:"dnf install -y tigervnc-server",
    yum:"yum install -y tigervnc-server",
    pacman:"pacman -S --noconfirm tigervnc",
    zypper:"zypper --non-interactive install tigervnc",
    apk:"apk add tigervnc"
  } : {
    apt:"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y x11vnc",
    dnf:"dnf install -y x11vnc",
    yum:"yum install -y x11vnc",
    pacman:"pacman -S --noconfirm x11vnc",
    zypper:"zypper --non-interactive install x11vnc",
    apk:"apk add x11vnc"
  };
  const offlineCommands: Record<string, string> = virtualSession ? {
    apt:"DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y tigervnc-standalone-server tigervnc-tools",
    dnf:"dnf --cacheonly install -y tigervnc-server",
    yum:"yum -C install -y tigervnc-server",
    pacman:"td_pkg=$(find /var/cache/pacman/pkg -maxdepth 1 -type f -name 'tigervnc-*.pkg.tar.*' 2>/dev/null | sort -V | tail -n 1); [ -n \"$td_pkg\" ] || { echo '未找到 TigerVNC 离线缓存包' >&2; exit 1; }; pacman -U --noconfirm \"$td_pkg\""
  } : {
    apt:"DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y x11vnc",
    dnf:"dnf --cacheonly install -y x11vnc",
    yum:"yum -C install -y x11vnc",
    pacman:"td_pkg=$(find /var/cache/pacman/pkg -maxdepth 1 -type f -name 'x11vnc-*.pkg.tar.*' 2>/dev/null | sort -V | tail -n 1); [ -n \"$td_pkg\" ] || { echo '未找到 x11vnc 离线缓存包' >&2; exit 1; }; pacman -U --noconfirm \"$td_pkg\""
  };
  const command = onlineCommands[manager] || "";
  const offlineCommand = offlineCommands[manager] || "";
  if (!command && !offlineCommand) return null;
  const component = componentInstallPlan({
    component:"vnc-server",
    label:"VNC 服务",
    online_command:command,
    offline_command:offlineCommand,
    offline_description:"只使用远端包管理器已经缓存的软件包，不访问软件源",
    local_offline_available:manager === "apt",
    local_offline_packages:manager === "apt" ? aptPackages : [],
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：TunnelDesk 在本机下载匹配的 VNC 软件包和依赖，再通过 SFTP 上传并安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}，无法自动解析并上传 VNC 软件包依赖`,
    manual_description:"查看当前发行版、桌面会话和防火墙对应的命令"
  });
  return {
    package_manager:manager,
    package_name:virtualSession ? "tigervnc" : "x11vnc",
    server_mode:virtualSession ? "virtual-session" : "shared-session",
    command,
    offline_command:offlineCommand,
    local_offline_packages:manager === "apt" ? aptPackages : [],
    component_plan:component,
    modes:component.modes,
    online:component.online,
    offline:component.offline,
    local_offline:component.local_offline,
    manual:component.manual,
    uninstall:uninstallPlan({...diagnostics, package_manager:manager, server_mode:virtualSession ? "virtual-session" : "shared-session"}),
    service_actions:Object.fromEntries(["stop", "disable"].map(action => [action, stopPlan(diagnostics, action)]))
  };
}

function validPosixName(value) {
  const text = String(value || "").trim();
  return /^[a-z_][a-z0-9_-]*[$]?$/i.test(text) ? text : "";
}

function systemdEscape(value, label = "systemd 值") {
  const text = String(value ?? "");
  if (!text || /[\0\r\n]/.test(text)) throw new Error(`${label}无效`);
  // Keep paths and environment values safe in a unit file. Percent signs are
  // escaped because systemd treats them as specifiers; the PIDFile host
  // specifier is appended separately below.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%");
}

function tigerVncServiceName(displayNumber) {
  const value = Number(displayNumber);
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error("VNC 显示编号无效");
  return `tunneldesk-tigervnc-${value}.service`;
}

function tigerVncRunnerPath(displayNumber) {
  const value = Number(displayNumber);
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error("VNC 显示编号无效");
  return `/usr/local/libexec/tunneldesk-tigervnc-${value}`;
}

function tigerVncDisplayNumber(portValue) {
  const candidate = numericPort(portValue) - 5899;
  return candidate >= 1 && candidate <= 99 ? candidate : 1;
}

function systemctlExecutable(diagnostics: any = {}) {
  const candidate = String(diagnostics.systemctl_path || "").trim();
  return /^\/(?:[A-Za-z0-9._+-]+\/)*systemctl$/.test(candidate) ? shellQuote(candidate) : "systemctl";
}

function stopPlan(diagnostics: any = {}, actionValue = "stop") {
  const action = String(actionValue || "stop").toLowerCase();
  if (!['stop', 'disable'].includes(action)) return null;
  if (String(diagnostics.platform || "").toLowerCase() === "macos") {
    return {action, available:false, command:"", reason:"macOS 屏幕共享需要在系统设置中关闭"};
  }
  const unit = String(diagnostics.service_unit || "").trim();
  if (unit) {
    const systemctl = systemctlExecutable(diagnostics);
    return {
      action,
      available:true,
      unit,
      command:action === "disable"
        ? `${systemctl} disable --now ${shellQuote(unit)}`
        : `${systemctl} stop ${shellQuote(unit)}`
    };
  }
  const pid = Number(/^\s*(\d+)/.exec(String(diagnostics.vnc_process || ""))?.[1] || 0);
  if (action === "stop" && Number.isInteger(pid) && pid > 1) {
    return {action, available:true, unit:"", command:`kill -TERM ${pid}`};
  }
  return {action, available:false, command:"", reason:action === "disable" ? "当前 VNC 进程没有可禁用的系统服务" : "没有检测到可停止的 VNC 服务或进程"};
}

function uninstallPlan(diagnostics: any = {}) {
  if (String(diagnostics.platform || "").toLowerCase() !== "linux") return null;
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const virtualSession = diagnostics.server_mode === "virtual-session" || diagnostics.session_active !== true || !String(diagnostics.display || "").trim();
  const packagesByManager = virtualSession ? {
    apt:["tigervnc-standalone-server", "tigervnc-tools", "tigervnc-common"],
    dnf:["tigervnc-server"], yum:["tigervnc-server"], pacman:["tigervnc"], zypper:["tigervnc"], apk:["tigervnc"]
  } : {
    apt:["x11vnc"], dnf:["x11vnc"], yum:["x11vnc"], pacman:["x11vnc"], zypper:["x11vnc"], apk:["x11vnc"]
  };
  const packages = packagesByManager[manager] || [];
  if (!packages.length) return null;
  const args = packages.map(shellQuote).join(" ");
  const removeCommands = {
    apt:`td_packages=""; for td_package in ${args}; do dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_packages`,
    dnf:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || dnf remove -y $td_packages`,
    yum:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || yum remove -y $td_packages`,
    pacman:`td_packages=""; for td_package in ${args}; do pacman -Q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || pacman -R --noconfirm $td_packages`,
    zypper:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || zypper --non-interactive remove $td_packages`,
    apk:`td_packages=""; for td_package in ${args}; do apk info -e "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || apk del $td_packages`
  };
  const stop = stopPlan(diagnostics, "disable");
  const unit = String(diagnostics.service_unit || "");
  const managed = /^tunneldesk-(?:x11vnc|tigervnc-\d+)\.service$/.test(unit);
  const managedTigerDisplay = /^tunneldesk-tigervnc-([1-9][0-9]*)\.service$/.exec(unit)?.[1] || "";
  const cleanup = managed
    ? `rm -f -- ${shellQuote(`/etc/systemd/system/${unit}`)}${managedTigerDisplay ? ` ${shellQuote(tigerVncRunnerPath(Number(managedTigerDisplay)))}` : ""}; ${systemctlExecutable(diagnostics)} daemon-reload`
    : "";
  return {
    available:true,
    package_manager:manager,
    package_names:packages,
    command:[stop?.available ? `${stop.command} 2>/dev/null || true` : "", cleanup, removeCommands[manager]].filter(Boolean).join("\n"),
    warning:"卸载会停止 VNC 服务并移除 VNC Server 软件包，但保留用户密码和桌面配置"
  };
}

function firewallPlan(diagnostics: any = {}) {
  if (String(diagnostics.firewall || "").toLowerCase() !== "active") return null;
  const port = numericPort(diagnostics.port);
  const tool = String(diagnostics.firewall_tool || "").toLowerCase();
  if (tool === "ufw") return {tool, command:`ufw allow ${port}/tcp`};
  if (tool === "firewalld") return {tool, command:`firewall-cmd --permanent --add-port=${port}/tcp && firewall-cmd --reload`};
  return null;
}

function passwordSetupScript(diagnostics: any = {}, password = "", options: any = {}) {
  const sessionUser = validPosixName(diagnostics.session_user) || "root";
  const sessionHome = String(diagnostics.session_home || (sessionUser === "root" ? "/root" : `/home/${sessionUser}`));
  if (!sessionHome.startsWith("/")) throw new Error("VNC 桌面用户主目录无效");
  const passwordFile = String(diagnostics.password_file || `${sessionHome.replace(/\/$/, "")}/.vnc/passwd`);
  if (!passwordFile.startsWith("/")) throw new Error("VNC 密码文件路径无效");
  const allowNoPassword = options.allow_no_password === true;
  if (!password && allowNoPassword) return {sessionUser, sessionHome, passwordFile:"", command:"", noPassword:true};
  if (!password && diagnostics.password_file) return {sessionUser, sessionHome, passwordFile, command:"", noPassword:false};
  if (!password) throw new Error("请提供 VNC 密码，或明确允许以无密码模式启动 VNC 服务");
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  if (!commands.has("x11vnc") && !commands.has("vncpasswd")) throw new Error("远端缺少 x11vnc 或 vncpasswd，无法安全创建 VNC 密码文件");
  const encoded = Buffer.from(String(password), "utf8").toString("base64");
  const directory = passwordFile.replace(/\/[^/]+$/, "") || sessionHome;
  const store = commands.has("x11vnc")
    ? `x11vnc -storepasswd "$td_vnc_password" ${shellQuote(passwordFile)} >/dev/null`
    : `printf '%s' "$td_vnc_password" | vncpasswd -f > ${shellQuote(passwordFile)}`;
  const command = [
    `install -d -m 700 ${shellQuote(directory)}`,
    `td_vnc_password=$(printf '%s' ${shellQuote(encoded)} | base64 -d)`,
    store,
    "unset td_vnc_password",
    `chmod 600 ${shellQuote(passwordFile)}`,
    `chown -R ${shellQuote(sessionUser)} ${shellQuote(directory)}`
  ].join("\n");
  return {sessionUser, sessionHome, passwordFile, command, noPassword:false};
}

function buildVncStartCommand(diagnostics: any = {}, password = "", options: any = {}) {
  const unit = String(diagnostics.service_unit || "").trim();
  const firewall = firewallPlan(diagnostics)?.command || "";
  const managedTigerVncUnit = /^tunneldesk-tigervnc-[1-9][0-9]*\.service$/.test(unit);
  const managedX11VncUnit = unit === "tunneldesk-x11vnc.service";
  const systemdAvailable = diagnostics.systemd_available !== false;
  const systemctl = systemctlExecutable(diagnostics);
  if (!systemdAvailable) return "";
  if (unit && unit !== "com.apple.screensharing" && !managedTigerVncUnit && !managedX11VncUnit && /^[-a-zA-Z0-9_@.:]+$/.test(unit)) {
    return [`${systemctl} start ${shellQuote(unit)}`, firewall].filter(Boolean).join("\n");
  }
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  const setup = passwordSetupScript(diagnostics, password, options);
  const port = numericPort(diagnostics.port);
  const display = String(diagnostics.display || "").trim();
  if (commands.has("x11vnc") && display && diagnostics.session_active === true) {
    const xauthority = String(diagnostics.xauthority || "").trim();
    const authArg = xauthority ? shellQuote(xauthority) : "guess";
    const service = [
      "[Unit]",
      "Description=TunnelDesk x11vnc desktop sharing",
      "After=display-manager.service network.target",
      "",
      "[Service]",
      "Type=simple",
      `ExecStart=/usr/bin/env x11vnc -display ${display} -auth ${authArg} ${setup.noPassword ? "-nopw" : `-rfbauth ${setup.passwordFile}`} -forever -shared -repeat -rfbport ${port}`,
      "Restart=on-failure",
      "RestartSec=2",
      "",
      "[Install]",
      "WantedBy=graphical.target"
    ].join("\n");
    return [
      "set -eu",
      setup.command,
      `cat > /etc/systemd/system/tunneldesk-x11vnc.service <<'TD_VNC_UNIT'\n${service}\nTD_VNC_UNIT`,
      `${systemctl} daemon-reload`,
      `${systemctl} enable --now tunneldesk-x11vnc.service`,
      firewall
    ].filter(Boolean).join("\n");
  }
  const desktopCommand = String(diagnostics.desktop_command || "").trim();
  const tigerVncCommand = commands.has("vncserver") ? "vncserver" : commands.has("tigervncserver") ? "tigervncserver" : "";
  if (tigerVncCommand && desktopCommand && /^[a-zA-Z0-9_.+-]+$/.test(desktopCommand)) {
    const displayNumber = tigerVncDisplayNumber(port);
    const serviceName = tigerVncServiceName(displayNumber);
    const runnerPath = tigerVncRunnerPath(displayNumber);
    const xstartup = `${setup.sessionHome.replace(/\/$/, "")}/.vnc/xstartup`;
    const escapedHome = systemdEscape(setup.sessionHome, "VNC 桌面用户主目录");
    const startup = [
      "#!/bin/sh",
      "set -eu",
      "unset SESSION_MANAGER",
      "unset DBUS_SESSION_BUS_ADDRESS",
      `if command -v dbus-run-session >/dev/null 2>&1; then exec dbus-run-session -- ${desktopCommand}; fi`,
      `exec ${desktopCommand}`,
      ""
    ].join("\n");
    const serverArgs = `:${displayNumber} -rfbport ${port} -geometry 1440x900 -localhost no ${setup.noPassword ? "-SecurityTypes None --I-KNOW-THIS-IS-INSECURE" : `-SecurityTypes VncAuth -PasswordFile ${shellQuote(setup.passwordFile)}`}`;
    const runner = [
      "#!/bin/sh",
      "set -eu",
      `/usr/bin/env ${tigerVncCommand} -kill :${displayNumber} >/dev/null 2>&1 || true`,
      `if /usr/bin/env ${tigerVncCommand} -help 2>&1 | grep -q -- '[-]fg'; then`,
      `  exec /usr/bin/env ${tigerVncCommand} ${serverArgs} -fg`,
      "fi",
      `/usr/bin/env ${tigerVncCommand} ${serverArgs}`,
      `while ps -u "$(id -u)" -o args= 2>/dev/null | grep -Eq '(^|/)([X]tigervnc|[X]vnc)[[:space:]]+:${displayNumber}([[:space:]]|$)'; do sleep 2; done`,
      "exit 1",
      ""
    ].join("\n");
    const unit = [
      "[Unit]",
      `Description=TunnelDesk TigerVNC virtual desktop :${displayNumber}`,
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `User=${setup.sessionUser}`,
      `WorkingDirectory=${escapedHome}`,
      `Environment=\"HOME=${escapedHome}\"`,
      `Environment=\"USER=${setup.sessionUser}\"`,
      `Environment=\"LOGNAME=${setup.sessionUser}\"`,
      "Environment=\"XDG_SESSION_TYPE=x11\"",
      "UMask=0077",
      `ExecStart=${runnerPath}`,
      `ExecStop=-/usr/bin/env ${tigerVncCommand} -kill :${displayNumber}`,
      "Restart=on-failure",
      "RestartSec=3",
      "TimeoutStartSec=120",
      "TimeoutStopSec=30",
      "KillMode=control-group",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      ""
    ].join("\n");
    return [
      "set -eu",
      setup.command,
      `install -d -m 700 ${shellQuote(`${setup.sessionHome.replace(/\/$/, "")}/.vnc`)}`,
      `td_xstartup_tmp=$(mktemp /tmp/tunneldesk-tigervnc-xstartup.XXXXXX)`,
      `cat > \"$td_xstartup_tmp\" <<'TD_VNC_XSTARTUP'\n${startup}TD_VNC_XSTARTUP`,
      `install -m 700 \"$td_xstartup_tmp\" ${shellQuote(xstartup)}`,
      `rm -f \"$td_xstartup_tmp\"`,
      `chown ${shellQuote(setup.sessionUser)} ${shellQuote(xstartup)}`,
      "install -d -m 755 /usr/local/libexec",
      `td_runner_tmp=$(mktemp /tmp/tunneldesk-tigervnc-runner.XXXXXX)`,
      `cat > "$td_runner_tmp" <<'TD_VNC_RUNNER'\n${runner}TD_VNC_RUNNER`,
      `install -m 755 "$td_runner_tmp" ${shellQuote(runnerPath)}`,
      `rm -f "$td_runner_tmp"`,
      `td_unit_tmp=$(mktemp /tmp/tunneldesk-tigervnc-unit.XXXXXX)`,
      `cat > \"$td_unit_tmp\" <<'TD_VNC_UNIT'\n${unit}TD_VNC_UNIT`,
      `install -m 644 \"$td_unit_tmp\" ${shellQuote(`/etc/systemd/system/${serviceName}`)}`,
      `rm -f \"$td_unit_tmp\"`,
      `${systemctl} daemon-reload`,
      `${systemctl} enable ${shellQuote(serviceName)}`,
      `${systemctl} restart ${shellQuote(serviceName)}`,
      firewall
    ].filter(Boolean).join("\n");
  }
  return "";
}

function startPlan(diagnostics: any = {}) {
  const unit = String(diagnostics.service_unit || "").trim();
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  const display = String(diagnostics.display || "").trim();
  const desktopCommand = String(diagnostics.desktop_command || "").trim();
  const managedTigerVncUnit = /^tunneldesk-tigervnc-[1-9][0-9]*\.service$/.test(unit);
  const managedX11VncUnit = unit === "tunneldesk-x11vnc.service";
  const hasTigerVncWrapper = commands.has("vncserver") || commands.has("tigervncserver");
  const systemdAvailable = diagnostics.systemd_available !== false;
  if (!systemdAvailable) return null;
  if (managedTigerVncUnit && hasTigerVncWrapper && desktopCommand) {
    const displayNumber = tigerVncDisplayNumber(diagnostics.port);
    return {
      kind:"tigervnc-systemd",
      action:"configure-enable-start",
      command:"",
      unit:tigerVncServiceName(displayNumber),
      display:`:${displayNumber}`,
      desktop_command:desktopCommand,
      persistent:true,
      autostart:true,
      managed:true,
      requires_vnc_password:false,
      supports_no_password:true
    };
  }
  if (managedX11VncUnit && commands.has("x11vnc") && display && diagnostics.session_active === true) {
    return {
      kind:"x11vnc-session",
      action:"configure-start",
      command:"",
      unit:"tunneldesk-x11vnc.service",
      display,
      xauthority:String(diagnostics.xauthority || ""),
      persistent:true,
      autostart:true,
      managed:true,
      requires_vnc_password:false,
      supports_no_password:true
    };
  }
  if (unit && unit !== "com.apple.screensharing" && /^[-a-zA-Z0-9_@.:]+$/.test(unit)) {
    return {kind:"service", action:"start", command:buildVncStartCommand(diagnostics), unit, persistent:false, autostart:false, managed:false, requires_vnc_password:false};
  }
  if (commands.has("x11vnc") && display && diagnostics.session_active === true) {
    return {kind:"x11vnc-session", action:"configure-start", command:"", display, xauthority:String(diagnostics.xauthority || ""), requires_vnc_password:false, supports_no_password:true};
  }
  if (hasTigerVncWrapper && desktopCommand) {
    const displayNumber = tigerVncDisplayNumber(diagnostics.port);
    return {
      kind:"tigervnc-systemd",
      action:"configure-enable-start",
      command:"",
      unit:tigerVncServiceName(displayNumber),
      display:`:${displayNumber}`,
      desktop_command:desktopCommand,
      persistent:true,
      autostart:true,
      managed:true,
      requires_vnc_password:false,
      supports_no_password:true
    };
  }
  return null;
}

function manualGuide(diagnostics: any = {}, port = 5900) {
  const targetPort = numericPort(port);
  const platform = String(diagnostics.platform || "unknown").toLowerCase();
  if (platform === "macos") {
    return {
      title:"macOS VNC 手动开启说明",
      summary:"macOS 自带屏幕共享/VNC 服务，不需要另外安装 VNC Server。",
      steps:[
        "打开“系统设置 > 通用 > 共享”。",
        "开启“屏幕共享”；在详细信息中允许本次连接使用的 macOS 账号。",
        "如使用 VNC 密码，打开屏幕共享的访问设置，启用“VNC 观看者可以使用密码控制屏幕”并设置密码。",
        `返回 TunnelDesk 重新探测 ${targetPort}/TCP；如果仍不可达，请检查 macOS 防火墙和局域网访问权限。`
      ],
      commands:[],
      platform:"macos"
    };
  }
  if (platform !== "linux") {
    return {
      title:"VNC 服务检测/配置说明",
      summary:"当前 VNC 连接没有可用的 SSH 管理通道，TunnelDesk 暂时无法识别远端系统，也无法判断服务是未安装还是未启动。",
      steps:[
        "在连接设置中关联同一台主机的 SSH 连接，TunnelDesk 才能执行只读探测和临时授权安装。",
        `也可以在远端手动确认是否有 VNC Server 监听 ${targetPort}/TCP。`,
        "如果远端是 macOS，请在“系统设置 > 通用 > 共享”中开启“屏幕共享”或“远程管理”；Linux 请使用对应发行版的包管理器安装 x11vnc 或 TigerVNC。"
      ],
      commands:[],
      platform:"unknown"
    };
  }
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const packages = packagePlan(diagnostics);
  const install = packages?.command || "";
  const offlineInstall = packages?.offline_command || "";
  const firewall = firewallPlan(diagnostics)?.command || "";
  const start = startPlan(diagnostics);
  const virtualSession = packages?.server_mode === "virtual-session";
  const installStep = virtualSession
    ? "安装 TigerVNC 和剪贴板辅助组件后，先为目标账号执行 vncpasswd，再使用 vncserver 创建独立桌面会话。"
    : "安装 x11vnc 和剪贴板辅助组件后，先执行 x11vnc -storepasswd 创建 VNC 密码文件；TunnelDesk 只有在连接设置已保存 VNC 密码时才会自动创建该文件。";
  const startCommand = virtualSession
    ? `vncpasswd ~/.vnc/passwd && vncserver :1 -rfbport ${targetPort} -geometry 1440x900 -localhost no`
    : `x11vnc -display :0 -auth $XAUTHORITY -rfbauth ~/.vnc/passwd -forever -shared -rfbport ${targetPort}`;
  const session = diagnostics.session_active && diagnostics.session_user && diagnostics.display
    ? `已识别图形会话：${diagnostics.session_user} · DISPLAY ${diagnostics.display}${diagnostics.xauthority ? ` · XAUTHORITY ${diagnostics.xauthority}` : ""}`
    : "尚未识别到可复用的活动图形会话；如果需要独立桌面，请使用 TigerVNC 和 Linux 桌面管理。";
  return {
    title:"Linux VNC 服务安装/配置说明",
    summary:diagnostics.installed
      ? (start ? "已检测到 VNC 组件，但当前端口没有可用监听；TunnelDesk 可以尝试配置并启动，或按下面命令手动操作。" : "已检测到 VNC 组件，但当前没有可自动启动的服务方案；请先准备图形桌面，再按下面命令手动配置。")
      : "当前主机没有检测到 VNC Server 组件；可以使用 TunnelDesk 临时管理员授权安装，或在终端手动安装。",
    steps:[
      session,
      installStep,
      "在已有图形桌面上启动 x11vnc，并确认 DISPLAY 和 XAUTHORITY 指向当前桌面。没有活动桌面时，请先在 Linux 桌面管理中安装 XFCE、Plasma 或其他桌面，再使用 TigerVNC 创建独立会话。",
      `确认服务监听 ${targetPort}/TCP，再在 TunnelDesk 中重新探测。`,
      "Linux X11 中文剪贴板需要 xclip/xsel；Wayland 会话需要 wl-clipboard。缺少这些工具时，TunnelDesk 会保留手动同步，但不会把中文降级成问号。"
    ],
    commands:[install, ...(offlineInstall ? [offlineInstall] : []), startCommand].filter(Boolean).concat(firewall ? [firewall] : []),
    install_plan:packages?.component_plan || null,
    start_plan:start,
    platform:"linux",
    package_manager:manager
  };
}

async function detectVncServer(profile: any, dependencies: any = {}) {
  const sourceId = Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
  const connection = sourceId && dependencies.getConnection ? dependencies.getConnection(sourceId) : null;
  if (!connection || !dependencies.runSshCommandForConnection) {
    return {
      diagnostics_available:false,
      platform:"unknown",
      port:numericPort(profile?.port),
      status:"unknown",
      recommended_action:"guide",
      can_install:false,
      ssh_connection:null,
      guide:manualGuide({platform:"unknown"}, profile?.port)
    };
  }
  const port = numericPort(profile?.port);
  let result: any;
  try {
    result = await dependencies.runSshCommandForConnection(connection, buildRemotePosixCommand(buildDetectionScript(port)), VNC_SSH_DIAGNOSTIC_TIMEOUT_MS);
  } catch (error) {
    return {
      diagnostics_available:false,
      platform:"unknown",
      port,
      status:"ssh-unreachable",
      recommended_action:"guide",
      can_install:false,
      ssh_error:String(error?.message || error),
      ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user},
      guide:manualGuide({platform:"unknown"}, port)
    };
  }
  if (result?.status !== 0) {
    const output = `${result?.stderr || ""}${result?.stdout || ""}${result?.error ? result.error.message : ""}`.trim();
    return {
      diagnostics_available:false,
      platform:"unknown",
      port,
      status:"probe-failed",
      recommended_action:"guide",
      can_install:false,
      ssh_error:output,
      ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user},
      guide:manualGuide({platform:"unknown"}, port)
    };
  }
  const diagnostics = parseDetectionOutput(result.stdout, port);
  const packages = packagePlan(diagnostics);
  const start = startPlan(diagnostics);
  return {
    ...diagnostics,
    ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user},
    install_plan:packages,
    package_plan:packages,
    uninstall_plan:packages?.uninstall || null,
    start_plan:start,
    service_actions:{
      start,
      restart:start,
      enable:start,
      stop:stopPlan(diagnostics, "stop"),
      disable:stopPlan(diagnostics, "disable")
    },
    firewall_plan:firewallPlan(diagnostics),
    guide:manualGuide(diagnostics, port)
  };
}

async function testVncProfile(id: number, dependencies: any = {}) {
  const profile = dependencies.getRemoteProfile ? dependencies.getRemoteProfile(id) : null;
  if (!profile) throw new Error("VNC 连接不存在");
  const port = numericPort(profile.port);
  const endpoint = `${profile.host}:${port}`;
  const diagnosticsPromise = detectVncServer(profile, dependencies).catch(error => ({
    diagnostics_available:false,
    platform:"unknown",
    port,
    status:"probe-failed",
    recommended_action:"guide",
    can_install:false,
    ssh_error:String(error?.message || error),
    guide:manualGuide({platform:"unknown"}, port)
  }));
  const tcpPromise = connectVncSocket(profile.host, port);
  try {
    const connection = await tcpPromise;
    connection.socket.destroy();
    dependencies.updateRemoteProfileUsage?.(profile.id);
    void diagnosticsPromise.catch(() => {});
    return {
      ok:true,
      protocol:"vnc",
      endpoint,
      client:"TunnelDesk 内置 VNC",
      status:"reachable",
      diagnostics:{diagnostics_available:false, status:"reachable", port}
    };
  } catch (error) {
    const diagnostics: any = await diagnosticsPromise;
    const serviceReady = diagnostics?.listening === true || diagnostics?.status === "ready";
    const blocked = serviceReady && String(diagnostics?.firewall || "").toLowerCase() === "active";
    const status = blocked ? "blocked" : diagnostics?.status === "unknown" ? "unreachable" : diagnostics?.status;
    const resolvedDiagnostics = blocked ? {...diagnostics, status:"blocked", recommended_action:"firewall"} : diagnostics;
    return {
      ok:false,
      protocol:"vnc",
      endpoint,
      status,
      message:String(error?.message || "VNC 服务不可访问"),
      diagnostics:resolvedDiagnostics
    };
  }
}

module.exports = {
  DETECT_SCRIPT,
  buildDetectionScript,
  parseDetectionOutput,
  packagePlan,
  buildVncStartCommand,
  firewallPlan,
  startPlan,
  stopPlan,
  uninstallPlan,
  manualGuide,
  detectVncServer,
  testVncProfile
};
