const { buildRemotePosixCommand } = require("./remote-posix");
const { publicError } = require("./public-error");
const { componentInstallCommand, componentInstallPlan } = require("./remote-component-installer");
const { connectVncSocket } = require("./vnc-handshake");
const { XRDP_RENDER_PROBE_SCRIPT, createVncRenderingDiagnostics } = require("./remote-graphics-rendering");
const { selectRemoteProbeLines } = require("./remote-probe-protocol");
const { formatRemoteEndpoint } = require("./remote-host");
const {
  LEGACY_VNC_PREFIX,
  TERMA_VNC_PREFIX,
  boolValue,
  commandList,
  isManagedVncUnit,
  managedVncConflictCommands,
  managedVncUnitFor,
  managedVncUnitInfo,
  managedVncUnits,
  normalizeTigerVncWrapperCommand,
  numericPort,
  platformFor,
  shellQuote,
  systemctlExecutable,
  systemdEscape,
  tigerVncDisplayNumber,
  tigerVncRunnerPath,
  tigerVncRunnerPathFor,
  tigerVncServiceName,
  validPosixName
} = require("./vnc-server-core");

const VNC_SSH_DIAGNOSTIC_TIMEOUT_MS = 8000;

/**
 * The probe intentionally uses only read-only commands. It can run as the
 * saved SSH user; installation/start operations use the separate privilege
 * grant flow in server.ts.
 */
function buildDetectionScript(port = 5900) {
  const targetPort = numericPort(port);
  const script = String.raw`set +e
terma_emit() { printf 'TERMA_VNC_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
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
td_tiger_wrapper_command=""
td_tiger_wrapper_kind=""
if [ "$td_platform" = linux ]; then
  if command -v tigervncserver >/dev/null 2>&1; then
    td_tiger_wrapper_command=tigervncserver
    td_tiger_wrapper_kind=tigervnc
  elif command -v vncserver >/dev/null 2>&1; then
    td_vncserver_path=$(command -v vncserver 2>/dev/null | head -n 1)
    td_vncserver_real=$(readlink -f "$td_vncserver_path" 2>/dev/null || printf '%s' "$td_vncserver_path")
    td_vncserver_signature=$(head -n 120 "$td_vncserver_real" 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
    td_vncserver_probe=$(printf '%s:%s:%s' "$td_vncserver_path" "$td_vncserver_real" "$td_vncserver_signature" | tr '[:upper:]' '[:lower:]')
    case "$td_vncserver_probe" in
      *tigervnc*|*xtigervnc*) td_tiger_wrapper_command=vncserver; td_tiger_wrapper_kind=tigervnc ;;
      *)
        td_vncserver_help=""
        if command -v timeout >/dev/null 2>&1; then
          td_vncserver_help=$(timeout 2 vncserver -help </dev/null 2>&1 | head -n 120 | tr '[:upper:]' '[:lower:]')
        fi
        case "$td_vncserver_help" in
          *tigervnc*|*xtigervnc*) td_tiger_wrapper_command=vncserver; td_tiger_wrapper_kind=tigervnc ;;
          *) td_tiger_wrapper_kind=unknown ;;
        esac
        ;;
    esac
  fi
fi
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
for td_package in x11vnc tigervnc-server tigervnc-standalone-server tigervnc-common tigervnc-tools tigervnc wayvnc gnome-remote-desktop; do
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
td_listening=0
td_listener_line=""
td_listener_pid=""
td_listener_process=""
td_listener_component=""
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
  td_vnc_process_units=""
  td_vnc_process_pids=$(ps -eo pid=,args= 2>/dev/null | awk '/[x]11vnc|[X]tigervnc|[X]vnc|[v]ncserver|[w]ayvnc/ {print $1}')
  td_vnc_display_number=$((${targetPort} - 5899))
  [ "$td_vnc_display_number" -ge 1 ] 2>/dev/null && [ "$td_vnc_display_number" -le 99 ] 2>/dev/null || td_vnc_display_number=1

  # Resolve the process which owns the configured TCP port before ranking
  # systemd units. A stale VNC process on another port must not win merely
  # because it appears first in ps output.
  if command -v ss >/dev/null 2>&1; then
    td_listener_line=$(ss -H -lntp 2>/dev/null | awk '$4 ~ /:'${targetPort}'$/ {print; exit}')
    [ -n "$td_listener_line" ] && td_listening=1
  elif command -v netstat >/dev/null 2>&1; then
    td_listener_line=$(netstat -lntp 2>/dev/null | awk '$4 ~ /:'${targetPort}'$/ {print; exit}')
    [ -n "$td_listener_line" ] && td_listening=1
  elif command -v lsof >/dev/null 2>&1; then
    td_listener_line=$(lsof -nP -iTCP:${targetPort} -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1)
    [ -n "$td_listener_line" ] && td_listening=1
  fi
  if [ "$td_listening" = 0 ] && command -v nc >/dev/null 2>&1; then
    nc -z -w 2 127.0.0.1 ${targetPort} >/dev/null 2>&1 && td_listening=1
  fi
  if [ -n "$td_listener_line" ]; then
    td_listener_pid=$(printf '%s\n' "$td_listener_line" | sed -n -e 's/.*pid=\([0-9][0-9]*\).*/\1/p' -e 's/^[^[:space:]]*[[:space:]]*\([0-9][0-9]*\)[[:space:]].*/\1/p' | head -n 1)
    if [ -n "$td_listener_pid" ] && [ -r "/proc/$td_listener_pid/cmdline" ]; then
      td_listener_process=$(tr '\000' ' ' < "/proc/$td_listener_pid/cmdline" 2>/dev/null)
    fi
    [ -n "$td_listener_process" ] || td_listener_process=$(printf '%s\n' "$td_listener_line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n 1)
  fi
  # ss -p and lsof hide PIDs from an unprivileged SSH account on some
  # distributions. Recover the VNC PID by matching the listening socket inode
  # against the candidate VNC processes owned by the account.
  if [ -z "$td_listener_pid" ] && [ "$td_listening" = 1 ]; then
    td_listener_inode=""
    td_listener_hex_port=$(printf '%04X' ${targetPort} 2>/dev/null)
    for td_socket_table in /proc/net/tcp /proc/net/tcp6; do
      [ -r "$td_socket_table" ] || continue
      td_listener_inode=$(awk -v port="$td_listener_hex_port" '$4 == "0A" {split($2, address, ":"); if (toupper(address[2]) == toupper(port)) {print $10; exit}}' "$td_socket_table" 2>/dev/null)
      [ -n "$td_listener_inode" ] && break
    done
    if [ -n "$td_listener_inode" ]; then
      for td_process_pid in $td_vnc_process_pids; do
        [ -r "/proc/$td_process_pid/fd" ] || continue
        for td_fd in /proc/$td_process_pid/fd/*; do
          [ -e "$td_fd" ] || [ -L "$td_fd" ] || continue
          td_fd_target=$(readlink "$td_fd" 2>/dev/null || true)
          if [ "$td_fd_target" = "socket:[$td_listener_inode]" ]; then
            td_listener_pid="$td_process_pid"
            break 2
          fi
        done
      done
    fi
  fi
  if [ -n "$td_listener_pid" ] && [ -r "/proc/$td_listener_pid/cmdline" ]; then
    td_listener_process=$(tr '\000' ' ' < "/proc/$td_listener_pid/cmdline" 2>/dev/null)
  fi
  # Prefer the exact listener process; otherwise prefer a VNC command that
  # explicitly names the configured RFB port before falling back to any VNC
  # process for legacy servers which omit -rfbport.
  td_target_vnc_process=""
  if [ -n "$td_listener_pid" ]; then
    td_vnc_process=$(ps -p "$td_listener_pid" -o pid=,user=,args= 2>/dev/null | sed 's/^[[:space:]]*//' | head -n 1)
  fi
  [ -n "$td_vnc_process" ] || td_target_vnc_process=$(ps -eo pid=,user=,args= 2>/dev/null | awk -v port="${targetPort}" '/[x]11vnc|[X]tigervnc|[X]vnc|[v]ncserver|[w]ayvnc/ { if ($0 ~ ("-rfbport[= ]?" port "([[:space:]]|$)")) {sub(/^[[:space:]]+/, ""); print; exit} }')
  [ -n "$td_vnc_process" ] || td_vnc_process="$td_target_vnc_process"
  [ -n "$td_vnc_process" ] || td_vnc_process=$(ps -eo pid=,user=,args= 2>/dev/null | awk '/[x]11vnc|[X]tigervnc|[X]vnc|[v]ncserver|[w]ayvnc/ {sub(/^[[:space:]]+/, ""); print; exit}')
  [ -n "$td_listener_process" ] || td_listener_process="$td_target_vnc_process"
  case "$td_listener_process" in
    *x11vnc*) td_listener_component=x11vnc ;;
    *Xtigervnc*|*Xvnc*|*tigervnc*|*vncserver*) td_listener_component=tigervnc ;;
    *wayvnc*) td_listener_component=wayvnc ;;
    *gnome-remote-desktop*) td_listener_component=gnome-remote-desktop ;;
  esac
  td_vnc_listener_units=""
  td_listener_process_unit_names=""
  if [ -n "$td_listener_pid" ] && [ -r "/proc/$td_listener_pid/cgroup" ]; then
    td_listener_process_unit_names=$(awk -F: '{print $3}' "/proc/$td_listener_pid/cgroup" 2>/dev/null | tr '/' '\n' | sed -n '/[.]service$/p')
  fi
  for td_listener_process_unit_raw in $td_listener_process_unit_names; do
    td_listener_process_unit=$(printf '%s' "$td_listener_process_unit_raw" | sed 's/\\x2d/-/g; s/\\x3a/:/g; s/\\x40/@/g')
    case "$td_listener_process_unit" in
      *x11vnc*.service|*tigervnc*.service|*vncserver*.service|terma-*.service|tunneldesk-*.service)
        case " $td_vnc_listener_units " in
          *" $td_listener_process_unit "*) ;;
          *) td_vnc_listener_units="$td_vnc_listener_units $td_listener_process_unit" ;;
        esac
        ;;
    esac
  done
  for td_process_pid in $td_vnc_process_pids; do
    [ -r "/proc/$td_process_pid/cgroup" ] || continue
    td_process_command=""
    [ -r "/proc/$td_process_pid/cmdline" ] && td_process_command=$(tr '\000' ' ' < "/proc/$td_process_pid/cmdline" 2>/dev/null)
    case "$td_process_command" in
      *x11vnc*|*Xtigervnc*|*Xvnc*|*tigervnc*|*vncserver*|*wayvnc*) ;;
      *) continue ;;
    esac
    td_process_unit_names=$(awk -F: '{print $3}' "/proc/$td_process_pid/cgroup" 2>/dev/null | tr '/' '\n' | sed -n '/[.]service$/p')
    for td_process_unit_raw in $td_process_unit_names; do
      td_process_unit=$(printf '%s' "$td_process_unit_raw" | sed 's/\\x2d/-/g; s/\\x3a/:/g; s/\\x40/@/g')
      case "$td_process_unit" in
        *x11vnc*.service|*tigervnc*.service|*vncserver*.service|terma-*.service|tunneldesk-*.service)
          case " $td_vnc_process_units " in
            *" $td_process_unit "*) ;;
            *) td_vnc_process_units="$td_vnc_process_units $td_process_unit" ;;
          esac
          ;;
      esac
    done
  done
  for td_command in xclip xsel wl-copy wl-paste; do
    command -v "$td_command" >/dev/null 2>&1 && td_clipboard_tools="\${td_clipboard_tools}\${td_clipboard_tools:+,}$td_command"
  done
fi
if [ "$td_platform" = macos ]; then
  if command -v lsof >/dev/null 2>&1; then
    td_listener_line=$(lsof -nP -iTCP:${targetPort} -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n 1)
    if [ -n "$td_listener_line" ]; then
      td_listening=1
      td_listener_pid=$(printf '%s\n' "$td_listener_line" | awk '{print $2; exit}')
      td_listener_process=$(printf '%s\n' "$td_listener_line" | awk '{print $1; exit}')
    fi
  fi
  if [ "$td_listening" = 0 ] && command -v nc >/dev/null 2>&1; then
    nc -z -w 2 127.0.0.1 ${targetPort} >/dev/null 2>&1 && td_listening=1
  fi
fi
td_service_unit=""
td_service_state=missing
td_service_enabled=0
td_service_seen=""
td_service_best_rank=999
td_unit_enabled_from_wants() {
  td_enabled_unit="$1"
  [ -n "$td_enabled_unit" ] || return 1
  for td_wants in /etc/systemd/system/*.target.wants /run/systemd/system/*.target.wants; do
    if [ -e "$td_wants/$td_enabled_unit" ] || [ -L "$td_wants/$td_enabled_unit" ]; then return 0; fi
  done
  return 1
}
td_process_owns_unit() {
  td_owned_unit="$1"
  case " $td_vnc_listener_units " in
    *" $td_owned_unit "*) return 0 ;;
  esac
  return 1
}
td_consider_service_unit() {
  td_candidate_unit="$1"
  td_candidate_state="$2"
  td_candidate_enabled="$3"
  td_candidate_substate="$4"
  td_candidate_result="$5"
  td_candidate_exec_status="$6"
  [ -n "$td_candidate_unit" ] || return 0
  case " $td_service_seen " in *" $td_candidate_unit "*) return 0 ;; esac
  if td_process_owns_unit "$td_candidate_unit"; then
    td_candidate_state=active
    [ -n "$td_candidate_substate" ] || td_candidate_substate=running
  fi
  if [ "$td_candidate_enabled" != 1 ] && td_unit_enabled_from_wants "$td_candidate_unit"; then
    td_candidate_enabled=1
  fi
  td_service_seen="$td_service_seen $td_candidate_unit"
  terma_emit SERVICE_CANDIDATE "$td_candidate_unit|$td_candidate_state|$td_candidate_enabled|$td_candidate_substate|$td_candidate_result|$td_candidate_exec_status"
  td_rank=50
  case "$td_candidate_state" in
    active|activating) td_rank=10 ;;
    failed) td_rank=30 ;;
    inactive|deactivating) td_rank=40 ;;
  esac
  case "$td_listener_component:$td_candidate_unit" in
    x11vnc:*x11vnc*) td_rank=$((td_rank - 20)) ;;
    tigervnc:*tigervnc*|tigervnc:*vncserver*) td_rank=$((td_rank - 20)) ;;
  esac
  td_process_owns_unit "$td_candidate_unit" && td_rank=$((td_rank - 40))
  if [ -z "$td_service_unit" ] || [ "$td_rank" -lt "$td_service_best_rank" ]; then
    td_service_unit="$td_candidate_unit"
    td_service_state="$td_candidate_state"
    td_service_enabled="$td_candidate_enabled"
    td_service_best_rank="$td_rank"
  fi
}
if [ "$td_platform" = macos ]; then
  td_installed=1
  if launchctl print system/com.apple.screensharing >/dev/null 2>&1; then
    td_service_unit=com.apple.screensharing
    td_service_state=active
  elif [ "$td_listening" = 1 ]; then
    td_service_unit=com.apple.screensharing
    td_service_state=active
  else
    td_service_state=inactive
  fi
else
  td_service_units="$td_vnc_process_units terma-x11vnc.service terma-tigervnc-$td_vnc_display_number.service tunneldesk-x11vnc.service tunneldesk-tigervnc-$td_vnc_display_number.service x11vnc.service vncserver@:$td_vnc_display_number.service tigervncserver@:$td_vnc_display_number.service vncserver@:1.service tigervncserver@:1.service wayvnc.service gnome-remote-desktop.service"
  td_consider_systemctl_unit() {
    td_unit="$1"
    [ -n "$td_unit" ] || return 0
    td_candidate_load_state=$("$td_systemctl_path" show "$td_unit" -p LoadState --value 2>/dev/null | head -n 1)
    [ -n "$td_candidate_load_state" ] && [ "$td_candidate_load_state" != not-found ] || return 0
    td_candidate_state=$("$td_systemctl_path" is-active "$td_unit" 2>/dev/null | head -n 1)
    [ -n "$td_candidate_state" ] || td_candidate_state=inactive
    td_candidate_enabled=0
    td_candidate_enable_state=$("$td_systemctl_path" is-enabled "$td_unit" 2>/dev/null | head -n 1)
    case "$td_candidate_enable_state" in enabled|enabled-runtime) td_candidate_enabled=1 ;; esac
    td_candidate_substate=$("$td_systemctl_path" show "$td_unit" -p SubState --value 2>/dev/null | head -n 1)
    td_candidate_result=$("$td_systemctl_path" show "$td_unit" -p Result --value 2>/dev/null | head -n 1)
    td_candidate_exec_status=$("$td_systemctl_path" show "$td_unit" -p ExecMainStatus --value 2>/dev/null | head -n 1)
    td_consider_service_unit "$td_unit" "$td_candidate_state" "$td_candidate_enabled" "$td_candidate_substate" "$td_candidate_result" "$td_candidate_exec_status"
  }
  if [ "$td_systemctl_usable" = 1 ]; then
    for td_unit in $td_service_units; do
      td_consider_systemctl_unit "$td_unit"
    done
    # Keep every matching distribution unit as a candidate. A stale unit
    # must not mask the component that owns the configured VNC port.
    td_loaded_units=$("$td_systemctl_path" list-units --all --type=service --plain --no-legend 2>/dev/null | awk '$1 ~ /(x11vnc|tigervnc|vncserver|wayvnc|gnome-remote-desktop)/ {print $1}')
    td_file_units=$("$td_systemctl_path" list-unit-files --type=service --no-legend 2>/dev/null | awk '$1 ~ /(x11vnc|tigervnc|vncserver|wayvnc|gnome-remote-desktop)/ {print $1}')
    for td_unit in $td_loaded_units $td_file_units; do
      td_consider_systemctl_unit "$td_unit"
    done
  fi
  if [ "$td_systemd_available" = 1 ] && [ "$td_systemctl_usable" != 1 ]; then
    for td_unit in $td_vnc_listener_units; do
      td_consider_service_unit "$td_unit" active 0 running
    done
  fi
  if [ "$td_systemd_available" = 1 ]; then
    for td_unit_dir in /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
      for td_unit in $td_service_units; do
        if [ -e "$td_unit_dir/$td_unit" ] || [ -L "$td_unit_dir/$td_unit" ]; then
          td_candidate_state=inactive
          case "$td_listener_component:$td_unit" in
            x11vnc:*x11vnc*|tigervnc:*tigervnc*|tigervnc:*vncserver*) td_candidate_state=active ;;
          esac
          td_consider_service_unit "$td_unit" "$td_candidate_state" 0
        fi
      done
    done
  fi
  if [ -z "$td_service_unit" ] && [ "$td_installed" = 1 ]; then
    td_service_state=manual
  fi
fi
td_vnc_server_mode=unknown
td_vnc_source_display=""
case "$td_vnc_process" in
  *x11vnc*) td_vnc_server_mode=shared-x11 ;;
  *wayvnc*) td_vnc_server_mode=shared-wayland ;;
  *Xtigervnc*|*Xvnc*|*tigervnc*|*vncserver*) td_vnc_server_mode=virtual ;;
  *)
    case "$td_service_unit" in
      *x11vnc*) td_vnc_server_mode=shared-x11 ;;
      *wayvnc*) td_vnc_server_mode=shared-wayland ;;
      *tigervnc*|*vncserver*) td_vnc_server_mode=virtual ;;
    esac
    ;;
esac
if [ -n "$td_vnc_process" ]; then
  td_vnc_source_display=$(printf '%s\n' "$td_vnc_process" | grep -Eo ':[0-9]+([.][0-9]+)?' | head -n 1)
fi
[ -n "$td_vnc_source_display" ] || td_vnc_source_display="$td_display"
${XRDP_RENDER_PROBE_SCRIPT}
td_vnc_session_source_count=0
td_vnc_session_source_displays=""
if [ "$td_platform" = linux ] && command -v loginctl >/dev/null 2>&1; then
  for td_source_session_id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    td_source_type=$(loginctl show-session "$td_source_session_id" -p Type --value 2>/dev/null || true)
    [ "$td_source_type" = x11 ] || continue
    td_source_class=$(loginctl show-session "$td_source_session_id" -p Class --value 2>/dev/null || true)
    [ "$td_source_class" = user ] || continue
    td_source_display=$(loginctl show-session "$td_source_session_id" -p Display --value 2>/dev/null || true)
    [ -n "$td_source_display" ] || continue
    case "$td_source_display" in :[0-9]*) ;; *) continue ;; esac
    td_source_uid=$(loginctl show-session "$td_source_session_id" -p User --value 2>/dev/null || true)
    td_source_user=$(getent passwd "$td_source_uid" 2>/dev/null | cut -d: -f1)
    [ -n "$td_source_user" ] || td_source_user="$td_source_uid"
    td_source_home=$(getent passwd "$td_source_user" 2>/dev/null | cut -d: -f6)
    td_source_service=$(loginctl show-session "$td_source_session_id" -p Service --value 2>/dev/null || true)
    td_source_seat=$(loginctl show-session "$td_source_session_id" -p Seat --value 2>/dev/null || true)
    td_source_desktop=$(loginctl show-session "$td_source_session_id" -p Desktop --value 2>/dev/null || true)
    td_source_state=$(loginctl show-session "$td_source_session_id" -p State --value 2>/dev/null || true)
    case "$td_source_state" in active|online) ;; *) continue ;; esac
    td_source_leader=$(loginctl show-session "$td_source_session_id" -p Leader --value 2>/dev/null || true)
    td_source_auth=""
    if [ -n "$td_source_leader" ] && [ -r "/proc/$td_source_leader/environ" ]; then
      td_source_values=$(tr '\000' '\n' < "/proc/$td_source_leader/environ" 2>/dev/null)
      td_source_auth=$(printf '%s\n' "$td_source_values" | sed -n 's/^XAUTHORITY=//p' | head -n 1)
      [ -n "$td_source_desktop" ] || td_source_desktop=$(printf '%s\n' "$td_source_values" | sed -n -e 's/^XDG_CURRENT_DESKTOP=//p' -e 's/^DESKTOP_SESSION=//p' | head -n 1)
    fi
    if [ -z "$td_source_auth" ]; then
      td_source_display_base=\${td_source_display%%.*}
      td_source_auth=$(ps -eo args= 2>/dev/null | awk -v display="$td_source_display_base" '
        {
          matched=0
          for (i=1; i<=NF; i++) if ($i == display) matched=1
          if (matched) for (i=1; i<NF; i++) if ($i == "-auth") { print $(i+1); exit }
        }')
    fi
    if [ -n "$td_source_auth" ]; then
      case "$td_source_auth" in
        /*) ;;
        *) [ -n "$td_source_home" ] && td_source_auth="\${td_source_home%/}/$td_source_auth" ;;
      esac
      [ -r "$td_source_auth" ] || td_source_auth=""
    fi
    td_source_kind=x11
    td_source_normalized=$(printf '%s' "$td_source_display" | sed 's/[.]0$//')
    td_xrdp_normalized=$(printf '%s' "$td_render_xrdp_display" | sed 's/[.]0$//')
    case "$td_source_service" in *xrdp*) td_source_kind=xrdp ;; esac
    if [ "$td_source_kind" != xrdp ] && [ -n "$td_xrdp_normalized" ] && [ "$td_source_normalized" = "$td_xrdp_normalized" ]; then td_source_kind=xrdp; fi
    if [ "$td_source_kind" = x11 ] && { [ -n "$td_source_seat" ] || [ "$td_source_normalized" = :0 ]; }; then td_source_kind=physical; fi
    terma_emit SESSION_SOURCE "$td_source_kind|$td_source_display|$td_source_user|$td_source_desktop|$td_source_state|$td_source_auth|$td_source_uid|$td_source_home|$td_source_service|$td_source_session_id"
    td_vnc_session_source_displays="\${td_vnc_session_source_displays} $(printf '%s' "$td_source_display" | sed 's/[.]0$//')"
    td_vnc_session_source_count=$((td_vnc_session_source_count + 1))
  done
fi
if [ "$td_platform" = linux ] && command -v ps >/dev/null 2>&1; then
  ps -eo args= 2>/dev/null | grep -E '(^|[[:space:]])([^[:space:]]*/)?Xorg[[:space:]]+:[0-9]+' | while IFS= read -r td_xorg_line; do
    td_xorg_display=$(printf '%s\n' "$td_xorg_line" | grep -Eo ':[0-9]+([.][0-9]+)?' | head -n 1)
    case "$td_xorg_display" in :[0-9]*) ;; *) continue ;; esac
    printf '%s\n' "$td_xorg_line" | grep -Eiq 'xrdp/xorg\.conf|xorgxrdp' && continue
    td_xorg_display_normalized=$(printf '%s' "$td_xorg_display" | sed 's/[.]0$//')
    td_xorg_seen=0
    for td_existing_source in $td_vnc_session_source_displays; do
      [ "$td_existing_source" = "$td_xorg_display_normalized" ] && td_xorg_seen=1
    done
    [ "$td_xorg_seen" = 0 ] || continue
    td_xorg_auth=$(printf '%s\n' "$td_xorg_line" | sed -n 's/.*[[:space:]]-auth[[:space:]]\([^[:space:]]*\).*/\1/p' | head -n 1)
    terma_emit SESSION_SOURCE "physical|$td_xorg_display|root|系统 X11|active|$td_xorg_auth|0|/root|lightdm|xorg"
    td_vnc_session_source_displays="\${td_vnc_session_source_displays} $td_xorg_display_normalized"
    td_vnc_session_source_count=$((td_vnc_session_source_count + 1))
  done
fi
if [ -z "$td_vnc_session_source_displays" ] && [ "$td_session_active" = 1 ] && [ -n "$td_display" ]; then
  td_source_kind=x11
  td_source_normalized=$(printf '%s' "$td_display" | sed 's/[.]0$//')
  td_xrdp_normalized=$(printf '%s' "$td_render_xrdp_display" | sed 's/[.]0$//')
  if [ -n "$td_xrdp_normalized" ] && [ "$td_source_normalized" = "$td_xrdp_normalized" ]; then td_source_kind=xrdp
  elif [ "$td_source_normalized" = :0 ]; then td_source_kind=physical
  fi
  terma_emit SESSION_SOURCE "$td_source_kind|$td_display|$td_session_user||active|$td_xauthority|$td_session_uid|$td_session_home||fallback"
fi
td_vnc_source_xrdp=0
td_vnc_source_normalized=$(printf '%s' "$td_vnc_source_display" | sed 's/[.]0$//')
td_vnc_xrdp_normalized=$(printf '%s' "$td_render_xrdp_display" | sed 's/[.]0$//')
if [ "$td_vnc_server_mode" = shared-x11 ] && [ -n "$td_vnc_source_normalized" ] && [ "$td_vnc_source_normalized" = "$td_vnc_xrdp_normalized" ]; then
  td_vnc_source_xrdp=1
fi
td_service_substate=""
td_service_result=""
td_service_exec_status=""
td_service_log=""
if [ -n "$td_service_unit" ] && [ "$td_systemctl_usable" = 1 ] && [ "$td_service_unit" != com.apple.screensharing ]; then
  td_service_substate=$("$td_systemctl_path" show "$td_service_unit" -p SubState --value 2>/dev/null | head -n 1)
  td_service_result=$("$td_systemctl_path" show "$td_service_unit" -p Result --value 2>/dev/null | head -n 1)
  td_service_exec_status=$("$td_systemctl_path" show "$td_service_unit" -p ExecMainStatus --value 2>/dev/null | head -n 1)
  if [ "$td_service_state" = failed ] || { [ "$td_service_state" != active ] && [ "$td_listening" = 0 ]; }; then
    command -v journalctl >/dev/null 2>&1 && td_service_log=$(journalctl -u "$td_service_unit" -n 24 --no-pager -o cat 2>/dev/null | tail -c 5000)
  fi
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
terma_emit PLATFORM "$td_platform"
terma_emit OS_ID "$td_os_id"
terma_emit OS_LIKE "$td_os_like"
terma_emit KERNEL "$td_kernel"
terma_emit PACKAGE_MANAGER "$td_package_manager"
terma_emit UID "$td_uid"
terma_emit PRIVILEGED "$td_privileged"
terma_emit INIT_SYSTEM "$td_init_system"
terma_emit SYSTEMD_AVAILABLE "$td_systemd_available"
terma_emit SYSTEMCTL_PATH "$td_systemctl_path"
terma_emit SYSTEMCTL_USABLE "$td_systemctl_usable"
terma_emit INSTALLED "$td_installed"
terma_emit COMMANDS "$td_commands"
terma_emit TIGER_WRAPPER_COMMAND "$td_tiger_wrapper_command"
terma_emit TIGER_WRAPPER_KIND "$td_tiger_wrapper_kind"
terma_emit PACKAGES "$td_packages"
terma_emit SERVICE_UNIT "$td_service_unit"
terma_emit SERVICE_STATE "$td_service_state"
terma_emit SERVICE_ENABLED "$td_service_enabled"
terma_emit SERVICE_SUBSTATE "$td_service_substate"
terma_emit SERVICE_RESULT "$td_service_result"
terma_emit SERVICE_EXEC_STATUS "$td_service_exec_status"
terma_emit SERVICE_LOG "$td_service_log"
terma_emit LISTENING "$td_listening"
terma_emit LISTENER_PID "$td_listener_pid"
terma_emit LISTENER_PROCESS "$td_listener_process"
terma_emit LISTENER_COMPONENT "$td_listener_component"
terma_emit FIREWALL "$td_firewall"
terma_emit FIREWALL_TOOL "$td_firewall_tool"
terma_emit SESSION_USER "$td_session_user"
terma_emit SESSION_UID "$td_session_uid"
terma_emit SESSION_HOME "$td_session_home"
terma_emit SESSION_ACTIVE "$td_session_active"
terma_emit DISPLAY "$td_display"
terma_emit XAUTHORITY "$td_xauthority"
terma_emit WAYLAND_DISPLAY "$td_wayland_display"
terma_emit XDG_RUNTIME_DIR "$td_runtime_dir"
terma_emit PASSWORD_FILE "$td_password_file"
terma_emit DESKTOP_COMMAND "$td_desktop_command"
terma_emit VNC_PROCESS "$td_vnc_process"
terma_emit SERVER_MODE "$td_vnc_server_mode"
terma_emit SOURCE_DISPLAY "$td_vnc_source_display"
terma_emit SOURCE_XRDP "$td_vnc_source_xrdp"
terma_emit XRDP_RENDER_DISPLAY "$td_render_xrdp_display"
terma_emit XRDP_RENDER_LOG "$td_render_xrdp_log"
terma_emit XRDP_DRM_DEVICE "$td_render_xrdp_drm_device"
terma_emit XRDP_DRM_AVAILABLE "$td_render_xrdp_drm_available"
terma_emit XRDP_SOFTWARE_RENDERING "$td_render_xrdp_software"
terma_emit CLIPBOARD_TOOLS "$td_clipboard_tools"
terma_emit PORT "${targetPort}"
`;
  // String.raw keeps the escape used to prevent TypeScript template
  // interpolation; remove only that marker before sending the shell script.
  return script.replace(/\\\$\{/g, "${");
}

const DETECT_SCRIPT = buildDetectionScript(5900);

function parseDetectionOutput(output: string, requestedPort = 5900) {
  const values = new Map<string, string>();
  const sessionSources = [];
  const serviceCandidates = [];
  for (const line of selectRemoteProbeLines(output, "VNC_")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === "SESSION_SOURCE") {
      const [kind="x11", display="", user="", desktop="", state="", xauthority="", uid="", home="", service="", session_id=""] = match[2].split("|");
      const normalizedDisplay = String(display || "").replace(/\.0$/, "");
      if (normalizedDisplay && !sessionSources.some(item => String(item.display || "").replace(/\.0$/, "") === normalizedDisplay)) {
        sessionSources.push({kind, display, user, desktop, state, xauthority, uid:Number(uid || -1), home, service, session_id});
      }
    } else if (match[1] === "SERVICE_CANDIDATE") {
      const [unit="", state="unknown", enabled="0", substate="", result="", execStatus="-1"] = match[2].split("|");
      if (/^[-a-zA-Z0-9_@.:]+\.service$/.test(unit) && !serviceCandidates.some(item => item.unit === unit)) {
        serviceCandidates.push({unit, state:String(state || "unknown").toLowerCase(), enabled:enabled === "1", substate, result, exec_status:Number(execStatus || -1)});
      }
    } else values.set(match[1], match[2]);
  }
  const port = numericPort(values.get("PORT") || requestedPort);
  const platform = String(values.get("PLATFORM") || platformFor(values.get("OS_ID") || "", values.get("KERNEL") || "", values.get("OS_LIKE") || "")).toLowerCase();
  const installed = boolValue(values, "INSTALLED");
  const listening = boolValue(values, "LISTENING");
  const serviceState = String(values.get("SERVICE_STATE") || "unknown").toLowerCase();
  const firewall = String(values.get("FIREWALL") || "unknown").toLowerCase();
  const uid = Number(values.get("UID") || -1);
  const serverMode = String(values.get("SERVER_MODE") || "unknown").toLowerCase();
  const sourceDisplay = String(values.get("SOURCE_DISPLAY") || values.get("DISPLAY") || "");
  const graphicsRendering = createVncRenderingDiagnostics({
    installed,
    platform,
    server_mode:serverMode,
    display:values.get("DISPLAY") || "",
    source_display:sourceDisplay,
    source_xrdp:boolValue(values, "SOURCE_XRDP"),
    xrdp_display:values.get("XRDP_RENDER_DISPLAY") || "",
    xrdp_drm_device:values.get("XRDP_DRM_DEVICE") || "",
    xrdp_drm_device_available:boolValue(values, "XRDP_DRM_AVAILABLE"),
    xrdp_software_rendering:boolValue(values, "XRDP_SOFTWARE_RENDERING"),
    xrdp_log_file:values.get("XRDP_RENDER_LOG") || ""
  });
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
  const parsed:any = {
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
    tiger_wrapper_command:values.has("TIGER_WRAPPER_COMMAND") ? normalizeTigerVncWrapperCommand(values.get("TIGER_WRAPPER_COMMAND")) : undefined,
    tiger_wrapper_kind:values.has("TIGER_WRAPPER_KIND") ? String(values.get("TIGER_WRAPPER_KIND") || "").toLowerCase() : undefined,
    packages:commandList(values, "PACKAGES"),
    service_unit:String(values.get("SERVICE_UNIT") || ""),
    service_state:serviceState,
    service_enabled:boolValue(values, "SERVICE_ENABLED"),
    service_substate:String(values.get("SERVICE_SUBSTATE") || "").toLowerCase(),
    service_result:String(values.get("SERVICE_RESULT") || "").toLowerCase(),
    service_exec_status:Number(values.get("SERVICE_EXEC_STATUS") || -1),
    service_log:String(values.get("SERVICE_LOG") || ""),
    service_candidates:serviceCandidates,
    listening,
    listener_pid:Number(values.get("LISTENER_PID") || 0),
    listener_process:String(values.get("LISTENER_PROCESS") || ""),
    listener_component:String(values.get("LISTENER_COMPONENT") || "").toLowerCase(),
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
    server_mode:serverMode,
    source_display:sourceDisplay,
    source_xrdp:boolValue(values, "SOURCE_XRDP"),
    session_sources:sessionSources,
    xrdp_display:String(values.get("XRDP_RENDER_DISPLAY") || ""),
    xrdp_drm_device:String(values.get("XRDP_DRM_DEVICE") || ""),
    xrdp_drm_device_available:boolValue(values, "XRDP_DRM_AVAILABLE"),
    xrdp_software_rendering:boolValue(values, "XRDP_SOFTWARE_RENDERING"),
    xrdp_log_file:String(values.get("XRDP_RENDER_LOG") || ""),
    graphics_rendering:graphicsRendering,
    clipboard_tools:commandList(values, "CLIPBOARD_TOOLS"),
    port,
    status,
    recommended_action:recommendedAction,
    can_install:platform === "linux" && ["apt", "dnf", "yum", "pacman", "zypper", "apk"].includes(String(values.get("PACKAGE_MANAGER") || "").toLowerCase())
  };
  parsed.component_states = {
    x11vnc:vncServerComponentState(parsed, "x11vnc"),
    tigervnc:vncServerComponentState(parsed, "tigervnc")
  };
  parsed.current_component = serverMode === "shared-x11"
    ? parsed.component_states.x11vnc
    : serverMode === "virtual"
      ? parsed.component_states.tigervnc
      : null;
  return parsed;
}

function normalizedDisplay(value: any) {
  const display = String(value || "").trim();
  return /^:[0-9]+(?:\.[0-9]+)?$/.test(display) ? display.replace(/\.0$/, "") : "";
}

function componentKeyForSelection(mode: any) {
  return String(mode || "") === "shared" ? "x11vnc" : String(mode || "") === "virtual" ? "tigervnc" : "";
}

function componentUnitMatches(component: string, unit: any) {
  const value = String(unit || "").toLowerCase();
  if (!value) return false;
  return component === "x11vnc"
    ? value.includes("x11vnc")
    : component === "tigervnc" && (value.includes("tigervnc") || value.includes("vncserver"));
}

function componentLabel(component: string) {
  return component === "x11vnc" ? "x11vnc 共享桌面" : "TigerVNC 独立虚拟桌面";
}

function vncServiceCandidateForComponent(diagnostics: any = {}, component = "tigervnc") {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  const candidates = (Array.isArray(diagnostics.service_candidates) ? diagnostics.service_candidates : [])
    .filter(item => componentUnitMatches(key, item?.unit))
    .map(item => ({
      unit:String(item.unit || ""),
      state:String(item.state || "unknown").toLowerCase(),
      enabled:item.enabled === true,
      substate:String(item.substate || "").toLowerCase(),
      result:String(item.result || "").toLowerCase(),
      exec_status:Number(item.exec_status ?? -1)
    }));
  const aggregateUnit = String(diagnostics.service_unit || "");
  if (componentUnitMatches(key, aggregateUnit) && !candidates.some(item => item.unit === aggregateUnit)) {
    candidates.push({
      unit:aggregateUnit,
      state:String(diagnostics.service_state || "unknown").toLowerCase(),
      enabled:diagnostics.service_enabled === true,
      substate:String(diagnostics.service_substate || "").toLowerCase(),
      result:String(diagnostics.service_result || "").toLowerCase(),
      exec_status:Number(diagnostics.service_exec_status ?? -1)
    });
  }
  const expectedDisplay = tigerVncDisplayNumber(diagnostics.port);
  const expectedUnit = key === "x11vnc" ? managedVncUnitFor("x11vnc") : tigerVncServiceName(expectedDisplay);
  const rank = candidate => {
    let value = candidate.unit === expectedUnit ? 0 : candidate.unit === aggregateUnit ? 2 : 5;
    if (key === "tigervnc" && new RegExp(`@:${expectedDisplay}\\.service$`).test(candidate.unit)) value -= 2;
    value += ({active:0, activating:1, failed:3, deactivating:5, inactive:6}[candidate.state] ?? 8) * 10;
    return value;
  };
  candidates.sort((left, right) => rank(left) - rank(right));
  return candidates[0] || null;
}

/**
 * Keep the aggregate probe (`installed`, `service_state`, `listening`) for
 * connection diagnostics, but expose an independent state for the component
 * the user selected. This prevents a running x11vnc process from making a
 * missing TigerVNC wrapper look ready (and vice versa).
 */
function vncServerComponentState(diagnostics: any = {}, component = "tigervnc") {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  const commands = commandListFromDiagnostics(diagnostics);
  const packages = new Set((Array.isArray(diagnostics.packages) ? diagnostics.packages : []).map(value => String(value || "")));
  const serverMode = String(diagnostics.server_mode || "").toLowerCase();
  const runningModeMatches = serverMode === (key === "x11vnc" ? "shared-x11" : "virtual");
  const detectedListenerComponent = String(diagnostics.listener_component || "").toLowerCase();
  const listenerEvidence = `${String(diagnostics.listener_process || "")}\n${String(diagnostics.vnc_process || "")}`;
  const listenerComponent = detectedListenerComponent
    || (/x11vnc/i.test(listenerEvidence)
      ? "x11vnc"
      : /Xtigervnc|Xvnc|tigervnc|vncserver/i.test(listenerEvidence)
        ? "tigervnc"
        : serverMode === "shared-x11"
          ? "x11vnc"
          : serverMode === "virtual"
            ? "tigervnc"
            : "");
  const listenerMatches = Boolean(listenerComponent) && listenerComponent === key;
  const process = runningModeMatches && listenerMatches ? String(diagnostics.listener_process || diagnostics.vnc_process || "") : "";
  const x11Command = commands.has("x11vnc");
  const explicitTigerWrapperProbe = typeof diagnostics.tiger_wrapper_command === "string";
  const tigerWrapperCommand = explicitTigerWrapperProbe
    ? tigerVncWrapperCommand(diagnostics, commands)
    : tigerVncWrapperCommand({}, commands);
  const tigerWrapper = Boolean(tigerWrapperCommand);
  const tigerRaw = commands.has("Xtigervnc") || commands.has("Xvnc");
  const x11Package = packages.has("x11vnc");
  const tigerPackage = ["tigervnc-server", "tigervnc-standalone-server", "tigervnc-common", "tigervnc-tools", "tigervnc"].some(value => packages.has(value));
  const commandAvailable = key === "x11vnc" ? x11Command : tigerWrapper;
  const packageInstalled = key === "x11vnc" ? x11Package : tigerPackage;
  const rawServerAvailable = key === "tigervnc" && tigerRaw;
  const installed = key === "x11vnc"
    ? x11Command || x11Package || (runningModeMatches && Boolean(process))
    : tigerWrapper || tigerRaw || tigerPackage || (runningModeMatches && Boolean(process));
  // TigerVNC's X server binary is not enough for Terma to create and
  // supervise a session. The vncserver/tigervncserver wrapper is required.
  const installRequired = key === "tigervnc" ? !tigerWrapper : !x11Command;
  const manualOnly = key === "tigervnc" && installRequired && (tigerRaw || tigerPackage || Boolean(process));
  let reason = "";
  if (key === "x11vnc" && installRequired) {
    reason = x11Package ? "检测到 x11vnc 软件包，但没有找到可执行的 x11vnc；请修复安装或重新安装该组件" : "未检测到 x11vnc，无法自动共享已选择的图形桌面";
  } else if (key === "tigervnc" && installRequired) {
    reason = manualOnly
      ? "检测到 Xtigervnc/Xvnc，但缺少 vncserver/tigervncserver 包装器；原始 X 服务器只能手动管理，Terma 不会自动创建或监督独立桌面"
      : "未检测到 vncserver/tigervncserver 包装器，无法自动创建独立 TigerVNC 桌面";
  }
  const service = vncServiceCandidateForComponent(diagnostics, key);
  const serviceUnit = String(service?.unit || "");
  const serviceState = serviceUnit ? String(service?.state || "unknown").toLowerCase() : installed ? "manual" : "missing";
  const serviceEnabled = serviceUnit ? service?.enabled === true : false;
  const serviceSubstate = serviceUnit && serviceUnit === String(diagnostics.service_unit || "")
    ? String(diagnostics.service_substate || service?.substate || "").toLowerCase()
    : String(service?.substate || "").toLowerCase();
  const serviceResult = serviceUnit && serviceUnit === String(diagnostics.service_unit || "")
    ? String(diagnostics.service_result || service?.result || "").toLowerCase()
    : String(service?.result || "").toLowerCase();
  const serviceExecStatus = serviceUnit && serviceUnit === String(diagnostics.service_unit || "")
    ? Number(diagnostics.service_exec_status ?? service?.exec_status ?? -1)
    : Number(service?.exec_status ?? -1);
  const running = runningModeMatches && listenerMatches && (Boolean(process) || Boolean(diagnostics.listening))
    || Boolean(serviceUnit) && ["active", "activating"].includes(serviceState);
  const listening = listenerMatches && diagnostics.listening === true && (runningModeMatches || Boolean(serviceUnit));
  const status = listening ? "ready" : !installed ? "not-installed" : manualOnly ? "manual-only" : running ? "not-listening" : "stopped";
  return {
    key,
    component:key,
    label:componentLabel(key),
    installed,
    command_available:commandAvailable,
    package_installed:packageInstalled,
    wrapper_available:key === "tigervnc" ? tigerWrapper : x11Command,
    wrapper_command:key === "tigervnc" ? tigerWrapperCommand : "",
    raw_server_available:rawServerAvailable,
    automatic_manageable:!installRequired,
    install_required:installRequired,
    manual_only:manualOnly,
    reason,
    service_unit:serviceUnit,
    service_state:serviceState,
    service_enabled:serviceEnabled,
    service_substate:serviceSubstate,
    service_result:serviceResult,
    service_exec_status:serviceExecStatus,
    service_log:serviceUnit === String(diagnostics.service_unit || "") ? String(diagnostics.service_log || "") : "",
    listener_component:listenerComponent,
    listener_component_detected:detectedListenerComponent,
    listener_process:String(diagnostics.listener_process || ""),
    listener_mismatch:Boolean(diagnostics.listening) && Boolean(listenerComponent) && !listenerMatches,
    running,
    listening,
    status,
    process
  };
}

function validateVncServerComponent(diagnostics: any = {}, component = "tigervnc", expectedInstalled = true) {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  const state = vncServerComponentState(diagnostics, key);
  if (expectedInstalled) {
    return state.automatic_manageable === true
      || state.reason
      || `${componentLabel(key)}安装命令已结束，但远端仍未检测到可自动管理的组件`;
  }
  if (state.running) return `${componentLabel(key)}卸载命令已结束，但目标组件仍在运行`;
  return !state.installed || `${componentLabel(key)}卸载命令已结束，但远端仍检测到目标组件`;
}

function vncServerStartValidation(diagnostics: any = {}, component = "tigervnc") {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  const state = vncServerComponentState(diagnostics, key);
  if (state.listening) return true;
  if (state.install_required) return state.reason || `${componentLabel(key)}尚未完整安装`;
  const port = numericPort(diagnostics.port);
  const selection = diagnostics.server_session_selection || {};
  const selectedDisplay = normalizedDisplay(selection.display || diagnostics.display);
  const selectedSource = selection.source || {};
  if (key === "x11vnc" && selection.source_available === false) {
    return selection.reason || `所选共享桌面 ${selectedDisplay || "显示"} 当前不存在，请重新探测并选择活动桌面`;
  }
  if (key === "x11vnc" && String(selectedSource.kind || "") === "xrdp" && !String(selectedSource.xauthority || diagnostics.xauthority || "").trim()) {
    return `所选 XRDP 会话 ${selectedDisplay || ""} 没有可用的 XAUTHORITY 认证文件；请保持该 RDP 会话登录，或重新探测后再启动 x11vnc`;
  }
  if (state.listener_mismatch) {
    const owner = state.listener_component === "x11vnc"
      ? "x11vnc"
      : state.listener_component === "tigervnc"
        ? "TigerVNC/Xvnc"
        : state.listener_process || "其他进程";
    return `TCP ${port} 已由 ${owner} 监听，不是当前选择的${componentLabel(key)}；请先停止占用端口的旧 VNC 服务，再重新应用来源`;
  }
  const log = String(state.service_log || "");
  const journalTail = log
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join("；");
  if (/address already in use|bind[^\n]*(?:fail|error)|rfbport[^\n]*(?:used|listen)/i.test(log)) {
    return `${componentLabel(key)}无法监听 TCP ${port}：端口已被占用；请停止旧 VNC 服务或改用其他端口`;
  }
  if (key === "x11vnc" && /xopendisplay|unable to open display|failed to open display|authorization required|no protocol specified|auth[^\n]*(?:fail|error|not found|does not exist)|xauthority/i.test(log)) {
    const auth = String(selectedSource.xauthority || diagnostics.xauthority || "").trim();
    return `x11vnc 无法访问所选 X11 显示 ${selectedDisplay || ""}${auth ? `（XAUTHORITY ${auth}）` : ""}；请确认该桌面仍在线且认证文件可读`;
  }
  const virtualSessionUser = String(diagnostics.session_user || "").trim();
  const virtualDesktopCommand = String(diagnostics.desktop_command || "").trim();
  if (key === "tigervnc" && virtualSessionUser === "root" && /startplasma|plasma_session|gnome-session|gnome-shell/i.test(`${virtualDesktopCommand}\n${log}`)) {
    return `TigerVNC 当前尝试以 root 启动 ${virtualDesktopCommand || "GNOME/Plasma 桌面"}，该桌面通常不支持 root 图形会话；请把 VNC 的 SSH 管理连接改为普通 Linux 账号，或安装并选择 XFCE 后重试`;
  }
  if (key === "tigervnc" && /session startup|xstartup|desktop session|startxfce4|startplasma|mate-session|dbus-run-session|exited too early/i.test(log)) {
    return `TigerVNC 已创建显示但桌面会话启动失败；请确认 ${diagnostics.desktop_command || "桌面启动命令"} 可用，并检查 ~/.vnc/xstartup`;
  }
  if (key === "tigervnc" && /could not acquire fully qualified host name|fully qualified host name|hostname[^\n]*(?:name or service not known|not known|getaddrinfo)/i.test(log)) {
    return "TigerVNC 启动失败：远端主机无法解析自身的完整主机名（hostname -f）。已加入不修改 /etc/hosts 的兼容回退；请重新应用并启动 VNC 配置。";
  }
  if (/passwordfile|vncauth|securitytypes|password file|passwd/i.test(log)) {
    return `${componentLabel(key)}的 VNC 密码文件或认证方式无效；请重新输入 VNC 密码后配置并启动`;
  }
  if (state.service_state === "failed" || (state.service_result && !["success", "done"].includes(state.service_result))) {
    const exit = Number.isInteger(state.service_exec_status) && state.service_exec_status >= 0 ? `，退出码 ${state.service_exec_status}` : "";
    return `${componentLabel(key)}服务 ${state.service_unit || ""} 启动失败${exit}${journalTail ? `：${journalTail}` : "；请查看远端 systemctl status 和 journalctl 日志"}`;
  }
  if (["active", "activating"].includes(state.service_state)) {
    return `${componentLabel(key)}服务已运行，但 TCP ${port} 尚未监听；请检查配置端口、显示号和服务日志`;
  }
  if (state.service_unit && ["inactive", "deactivating"].includes(state.service_state)) {
    return `${componentLabel(key)}服务 ${state.service_unit} 启动后已退出，TCP ${port} 未监听；请检查显示/XAUTHORITY、桌面启动命令和服务日志`;
  }
  return `${componentLabel(key)}启动命令已结束，但 TCP ${port} 未监听`;
}

function vncServerStopValidation(diagnostics: any = {}, component = "tigervnc") {
  const key = component === "x11vnc" ? "x11vnc" : "tigervnc";
  const state = vncServerComponentState(diagnostics, key);
  if (!state.running && !state.listening) return true;
  if (state.service_unit && ["active", "activating", "deactivating"].includes(state.service_state)) {
    return `${componentLabel(key)}服务 ${state.service_unit} 仍在运行或停止中`;
  }
  return `${componentLabel(key)}停止命令已结束，但目标组件仍在运行`;
}

function finalizeVncSelection(diagnostics: any, selection: any) {
  const component = componentKeyForSelection(selection?.mode);
  if (!component) return {...selection, component:"", component_state:null};
  const state = vncServerComponentState(diagnostics, component);
  return {
    ...selection,
    component,
    component_state:state,
    install_required:state.install_required,
    automatic_manageable:state.automatic_manageable,
    manual_only:state.manual_only,
    reason:selection.reason || state.reason || ""
  };
}

function resolveVncServerSessionSelection(diagnostics: any = {}, options: any = {}) {
  const requestedMode = new Set(["auto", "shared", "virtual"]).has(String(options?.server_session_mode))
    ? String(options.server_session_mode)
    : "auto";
  const requestedDisplay = normalizedDisplay(options?.server_display);
  const sources = (Array.isArray(diagnostics.session_sources) ? diagnostics.session_sources : [])
    .filter(item => normalizedDisplay(item?.display))
    .map(item => ({...item, display:normalizedDisplay(item.display)}));
  const findSource = display => sources.find(item => item.display === normalizedDisplay(display)) || null;
  const currentMode = String(diagnostics.server_mode || "");
  const currentDisplay = diagnostics.vnc_process && currentMode === "shared-x11"
    ? normalizedDisplay(diagnostics.source_display)
    : "";
  if (requestedMode === "shared") {
    const source = findSource(requestedDisplay);
    return finalizeVncSelection(diagnostics, source
      ? {requested_mode:requestedMode, mode:"shared", display:source.display, source, requires_selection:false, source_available:true, install_required:!commandListFromDiagnostics(diagnostics).has("x11vnc")}
      : {requested_mode:requestedMode, mode:"shared", display:requestedDisplay, source:null, requires_selection:false, source_available:false, install_required:false, reason:requestedDisplay ? `所选显示 ${requestedDisplay} 当前不存在` : "请选择要共享的活动显示"});
  }
  if (requestedMode === "virtual") {
    return finalizeVncSelection(diagnostics, {requested_mode:requestedMode, mode:"virtual", display:`:${Math.max(1, numericPort(diagnostics.port) - 5899)}`, source:null, requires_selection:false, source_available:true});
  }
  if (currentMode === "virtual" && diagnostics.vnc_process) {
    return finalizeVncSelection(diagnostics, {requested_mode:"auto", mode:"virtual", display:normalizedDisplay(diagnostics.source_display) || `:${Math.max(1, numericPort(diagnostics.port) - 5899)}`, source:null, requires_selection:false, source_available:true, inferred_from:"running-service"});
  }
  const currentSource = findSource(currentDisplay);
  if (currentSource) return finalizeVncSelection(diagnostics, {requested_mode:"auto", mode:"shared", display:currentSource.display, source:currentSource, requires_selection:false, source_available:true, inferred_from:"running-service"});
  if (sources.length === 1) return finalizeVncSelection(diagnostics, {requested_mode:"auto", mode:"shared", display:sources[0].display, source:sources[0], requires_selection:false, source_available:true, inferred_from:"single-session"});
  if (sources.length > 1) return finalizeVncSelection(diagnostics, {requested_mode:"auto", mode:"unresolved", display:"", source:null, requires_selection:true, source_available:false, install_required:false, reason:"检测到多个活动图形桌面，请明确选择物理桌面、XRDP 会话或独立虚拟桌面"});
  return finalizeVncSelection(diagnostics, {requested_mode:"auto", mode:"virtual", display:`:${Math.max(1, numericPort(diagnostics.port) - 5899)}`, source:null, requires_selection:false, source_available:true, inferred_from:"no-shared-session"});
}

function commandListFromDiagnostics(diagnostics: any = {}) {
  return new Set((Array.isArray(diagnostics.commands) ? diagnostics.commands : []).map(value => String(value || "")));
}

function tigerVncWrapperCommand(diagnostics: any = {}, commands = commandListFromDiagnostics(diagnostics)) {
  if (typeof diagnostics.tiger_wrapper_command === "string") {
    return normalizeTigerVncWrapperCommand(diagnostics.tiger_wrapper_command);
  }
  return commands.has("tigervncserver") ? "tigervncserver" : commands.has("vncserver") ? "vncserver" : "";
}

function applyVncServerSessionSelection(diagnostics: any = {}, selection: any = null) {
  const resolved = selection || resolveVncServerSessionSelection(diagnostics, diagnostics.profile_options || {});
  const targetComponent = componentKeyForSelection(resolved?.mode);
  const targetState = targetComponent ? (resolved?.component_state || vncServerComponentState(diagnostics, targetComponent)) : null;
  if (resolved?.mode === "shared" && resolved.source_available && resolved.source) {
    const source = resolved.source;
    return {
      ...diagnostics,
      selection_required:false,
      desired_server_mode:"shared",
      target_component:targetComponent,
      selected_component:targetState,
      session_active:true,
      display:source.display,
      xauthority:String(source.xauthority || ""),
      source_kind:String(source.kind || "x11"),
      source_service:String(source.service || ""),
      session_user:String(source.user || diagnostics.session_user || ""),
      session_uid:Number.isFinite(Number(source.uid)) ? Number(source.uid) : diagnostics.session_uid,
      session_home:String(source.home || diagnostics.session_home || ""),
      graphics_rendering:createVncRenderingDiagnostics({
        installed:targetState?.installed === true,
        platform:diagnostics.platform,
        server_mode:"shared-x11",
        source_display:source.display,
        source_xrdp:String(source.kind || "") === "xrdp",
        xrdp_display:diagnostics.xrdp_display,
        xrdp_drm_device:diagnostics.xrdp_drm_device,
        xrdp_drm_device_available:diagnostics.xrdp_drm_device_available,
        xrdp_software_rendering:diagnostics.xrdp_software_rendering,
        xrdp_log_file:diagnostics.xrdp_log_file
      })
    };
  }
  if (resolved?.mode === "virtual") {
    return {
      ...diagnostics,
      selection_required:false,
      desired_server_mode:"virtual",
      target_component:targetComponent,
      selected_component:targetState,
      session_active:false,
      display:"",
      xauthority:"",
      source_kind:"virtual",
      source_service:"",
      graphics_rendering:createVncRenderingDiagnostics({installed:targetState?.installed === true, platform:diagnostics.platform, server_mode:"virtual", source_display:resolved.display})
    };
  }
  return {...diagnostics, selection_required:true, desired_server_mode:"unresolved", target_component:"", selected_component:null, session_active:false, display:"", xauthority:""};
}

function componentPlanningDiagnostics(diagnostics: any = {}, selection: any = null) {
  const resolved = selection || diagnostics.server_session_selection || null;
  const component = componentKeyForSelection(resolved?.mode || diagnostics.desired_server_mode);
  if (!component) return {...diagnostics, target_component:"", selected_component:null};
  // Recompute from the planning snapshot: a managed unit may have been
  // switched to the selected component after the initial aggregate probe.
  const state = vncServerComponentState(diagnostics, component);
  const planning = {
    ...diagnostics,
    target_component:component,
    selected_component:state,
    selected_component_state:state,
    installed:state.installed,
    service_unit:state.service_unit,
    service_state:state.service_state,
    service_enabled:state.service_enabled,
    listening:state.listening,
    vnc_process:state.process,
    component_install_required:state.install_required,
    component_manual_only:state.manual_only,
    component_reason:state.reason
  };
  return planning;
}

function packagePlan(diagnostics: any = {}) {
  if (diagnostics.selection_required) return null;
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const targetComponent = diagnostics.target_component || (diagnostics.selected_component?.key || "");
  const virtualSession = targetComponent ? targetComponent === "tigervnc" : diagnostics.session_active !== true || !String(diagnostics.display || "").trim();
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
    label:targetComponent === "tigervnc" ? "TigerVNC 独立虚拟桌面" : targetComponent === "x11vnc" ? "x11vnc 共享桌面" : "VNC 服务",
    online_command:command,
    offline_command:offlineCommand,
    offline_description:"只使用远端包管理器已经缓存的软件包，不访问软件源",
    local_offline_available:manager === "apt",
    local_offline_packages:manager === "apt" ? aptPackages : [],
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：Terma 在本机下载匹配的 VNC 软件包和依赖，再通过 SFTP 上传并安装"
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
    uninstall:uninstallPlan({...diagnostics, package_manager:manager, target_component:targetComponent || (virtualSession ? "tigervnc" : "x11vnc"), server_mode:virtualSession ? "virtual-session" : "shared-session"}),
    service_actions:Object.fromEntries(["stop", "disable"].map(action => [action, stopPlan(diagnostics, action)]))
  };
}

function stopPlan(diagnostics: any = {}, actionValue = "stop") {
  const action = String(actionValue || "stop").toLowerCase();
  if (!['stop', 'disable'].includes(action)) return null;
  if (String(diagnostics.platform || "").toLowerCase() === "macos") {
    return {action, available:false, command:"", reason:"macOS 屏幕共享需要在系统设置中关闭"};
  }
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || "";
  const targetState = targetComponent ? (diagnostics.selected_component || vncServerComponentState(diagnostics, targetComponent)) : null;
  const unit = String(targetComponent ? targetState?.service_unit || "" : diagnostics.service_unit || "").trim();
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
  const process = targetComponent ? targetState?.process || "" : diagnostics.vnc_process || "";
  const pid = Number(/^\s*(\d+)/.exec(String(process))?.[1] || 0);
  if (action === "stop" && Number.isInteger(pid) && pid > 1) {
    return {action, available:true, unit:"", command:`kill -TERM ${pid}`};
  }
  return {action, available:false, command:"", target_component:targetComponent, reason:action === "disable" ? `${targetComponent ? componentLabel(targetComponent) : "当前 VNC 进程"}没有可禁用的系统服务` : `没有检测到可停止的${targetComponent ? componentLabel(targetComponent) : " VNC 服务或进程"}`};
}

function uninstallPlan(diagnostics: any = {}) {
  if (String(diagnostics.platform || "").toLowerCase() !== "linux") return null;
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || "";
  const virtualSession = targetComponent ? targetComponent === "tigervnc" : diagnostics.server_mode === "virtual-session" || diagnostics.session_active !== true || !String(diagnostics.display || "").trim();
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
  const planning = targetComponent && !diagnostics.selected_component
    ? componentPlanningDiagnostics(diagnostics, {mode:targetComponent === "tigervnc" ? "virtual" : "shared", component:targetComponent})
    : diagnostics;
  const stop = stopPlan(planning, "disable");
  const component = targetComponent || (virtualSession ? "tigervnc" : "x11vnc");
  const systemctl = systemctlExecutable(diagnostics);
  const managedUnits = managedVncUnits(planning).filter(value => managedVncUnitInfo(value)?.component === component);
  const managedStops = managedUnits.map(value => `${systemctl} disable --now ${shellQuote(value)} 2>/dev/null || true`);
  const cleanupFiles = managedUnits.flatMap(value => {
    const info = managedVncUnitInfo(value);
    if (!info) return [];
    return [
      `/etc/systemd/system/${info.unit}`,
      ...(info.component === "tigervnc" ? [tigerVncRunnerPathFor(info.display, info.brand)] : [])
    ];
  });
  const cleanup = cleanupFiles.length
    ? `rm -f -- ${[...new Set(cleanupFiles)].map(shellQuote).join(" ")}; ${systemctl} daemon-reload`
    : "";
  return {
    available:true,
    package_manager:manager,
    package_names:packages,
    command:[...managedStops, !managedStops.length && stop?.available ? `${stop.command} 2>/dev/null || true` : "", cleanup, removeCommands[manager]].filter(Boolean).join("\n"),
    target_component:component,
    component_label:componentLabel(component),
    warning:`卸载会停止并移除 ${componentLabel(component)} 软件包，但保留用户密码和桌面配置`
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
  if (!sessionHome.startsWith("/")) throw publicError("VNC_SESSION_HOME_INVALID", "VNC 桌面用户主目录无效");
  const passwordFile = String(diagnostics.password_file || `${sessionHome.replace(/\/$/, "")}/.vnc/passwd`);
  if (!passwordFile.startsWith("/")) throw publicError("VNC_PASSWORD_FILE_INVALID", "VNC 密码文件路径无效");
  const allowNoPassword = options.allow_no_password === true;
  if (!password && allowNoPassword) return {sessionUser, sessionHome, passwordFile:"", command:"", noPassword:true};
  if (!password && diagnostics.password_file) return {sessionUser, sessionHome, passwordFile, command:"", noPassword:false};
  if (!password) throw publicError("VNC_PASSWORD_REQUIRED", "请提供 VNC 密码，或明确允许以无密码模式启动 VNC 服务");
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  if (!commands.has("x11vnc") && !commands.has("vncpasswd")) throw publicError("VNC_PASSWORD_TOOL_UNAVAILABLE", "远端缺少 x11vnc 或 vncpasswd，无法安全创建 VNC 密码文件");
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

function vncPortProbeFunctions(port: number) {
  return [
    "td_vnc_port_free() {",
    "  if command -v ss >/dev/null 2>&1; then",
    `    ! ss -H -lnt 2>/dev/null | awk '$4 ~ /:${port}$/ { found=1 } END { exit found ? 1 : 0 }'`,
    "  elif command -v netstat >/dev/null 2>&1; then",
    `    ! netstat -lnt 2>/dev/null | awk '$4 ~ /:${port}$/ { found=1 } END { exit found ? 1 : 0 }'`,
    "  elif command -v lsof >/dev/null 2>&1; then",
    `    ! lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | grep -q .`,
    "  elif command -v nc >/dev/null 2>&1; then",
    `    ! nc -z -w 1 127.0.0.1 ${port} >/dev/null 2>&1`,
    "  else",
    "    return 1",
    "  fi",
    "}",
    "td_vnc_port_listening() {",
    "  if command -v ss >/dev/null 2>&1; then",
    `    ss -H -lnt 2>/dev/null | awk '$4 ~ /:${port}$/ { found=1 } END { exit found ? 0 : 1 }'`,
    "  elif command -v netstat >/dev/null 2>&1; then",
    `    netstat -lnt 2>/dev/null | awk '$4 ~ /:${port}$/ { found=1 } END { exit found ? 0 : 1 }'`,
    "  elif command -v lsof >/dev/null 2>&1; then",
    `    lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | grep -q .`,
    "  elif command -v nc >/dev/null 2>&1; then",
    `    nc -z -w 1 127.0.0.1 ${port} >/dev/null 2>&1`,
    "  else",
    "    return 1",
    "  fi",
    "}"
  ];
}

function legacyVncMigrationScript(diagnostics: any = {}, legacyUnit = "", targetComponent = "", newUnit = "", newRunner = "") {
  const legacy = managedVncUnitInfo(legacyUnit);
  if (!legacy || legacy.brand !== LEGACY_VNC_PREFIX || legacy.component !== targetComponent || !newUnit) return {prepare:[], commit:[]};
  const systemctl = systemctlExecutable(diagnostics);
  const port = numericPort(diagnostics.port);
  const legacyUnitFile = `/etc/systemd/system/${legacy.unit}`;
  const legacyRunner = legacy.component === "tigervnc" ? tigerVncRunnerPathFor(legacy.display, LEGACY_VNC_PREFIX) : "";
  const newUnitFile = `/etc/systemd/system/${newUnit}`;
  const rollbackFiles = [shellQuote(newUnitFile), ...(newRunner ? [shellQuote(newRunner)] : [])].join(" ");
  const legacyFiles = [shellQuote(legacyUnitFile), ...(legacyRunner ? [shellQuote(legacyRunner)] : [])].join(" ");
  return {
    prepare:[
      ...vncPortProbeFunctions(port),
      `td_legacy_vnc_unit=${shellQuote(legacy.unit)}`,
      "td_legacy_vnc_was_enabled=0",
      "td_legacy_vnc_was_active=0",
      `${systemctl} is-enabled "$td_legacy_vnc_unit" >/dev/null 2>&1 && td_legacy_vnc_was_enabled=1 || true`,
      `${systemctl} is-active "$td_legacy_vnc_unit" >/dev/null 2>&1 && td_legacy_vnc_was_active=1 || true`,
      "td_legacy_vnc_restore() {",
      `  ${systemctl} disable --now ${shellQuote(newUnit)} >/dev/null 2>&1 || true`,
      `  rm -f -- ${rollbackFiles} || true`,
      `  ${systemctl} daemon-reload >/dev/null 2>&1 || true`,
      `  [ "$td_legacy_vnc_was_enabled" = 1 ] && ${systemctl} enable "$td_legacy_vnc_unit" >/dev/null 2>&1 || true`,
      `  [ "$td_legacy_vnc_was_active" = 1 ] && ${systemctl} restart "$td_legacy_vnc_unit" >/dev/null 2>&1 || true`,
      "}",
      "td_legacy_vnc_migrated=0",
      `trap 'td_legacy_vnc_status=$?; [ "\${td_legacy_vnc_migrated:-0}" = 1 ] || td_legacy_vnc_restore; exit "$td_legacy_vnc_status"' 0`,
      `${systemctl} stop "$td_legacy_vnc_unit"`,
      "td_legacy_vnc_port_free=0",
      "td_legacy_vnc_attempt=0",
      "while [ \"$td_legacy_vnc_attempt\" -lt 12 ]; do",
      "  if td_vnc_port_free; then td_legacy_vnc_port_free=1; break; fi",
      "  td_legacy_vnc_attempt=$((td_legacy_vnc_attempt + 1))",
      "  sleep 1",
      "done",
      `[ "$td_legacy_vnc_port_free" = 1 ] || { echo ${shellQuote(`旧 VNC 服务 ${legacy.unit} 已停止，但 TCP ${port} 仍被占用；不会覆盖为 Terma 服务`)} >&2; exit 48; }`
    ],
    commit:[
      "td_terma_vnc_listening=0",
      "td_terma_vnc_attempt=0",
      "while [ \"$td_terma_vnc_attempt\" -lt 12 ]; do",
      `  if ${systemctl} is-active ${shellQuote(newUnit)} >/dev/null 2>&1 && td_vnc_port_listening; then td_terma_vnc_listening=1; break; fi`,
      "  td_terma_vnc_attempt=$((td_terma_vnc_attempt + 1))",
      "  sleep 1",
      "done",
      `[ "$td_terma_vnc_listening" = 1 ] || { echo ${shellQuote(`Terma VNC 服务 ${newUnit} 启动后未监听 TCP ${port}，正在恢复旧服务`)} >&2; exit 49; }`,
      `${systemctl} disable --now "$td_legacy_vnc_unit" >/dev/null 2>&1 || true`,
      `rm -f -- ${legacyFiles} || true`,
      `${systemctl} daemon-reload`,
      "td_legacy_vnc_migrated=1",
      "trap - 0"
    ]
  };
}

function buildVncStartCommand(diagnostics: any = {}, password = "", options: any = {}) {
  const selection = diagnostics.server_session_selection || null;
  if (selection?.requires_selection || selection?.source_available === false) return "";
  const actualUnit = String(diagnostics.service_unit || "").trim();
  diagnostics = selection ? applyVncServerSessionSelection(diagnostics, selection) : diagnostics;
  const unit = actualUnit;
  const firewall = firewallPlan(diagnostics)?.command || "";
  const managedUnit = managedVncUnitInfo(unit);
  const managedTigerVncUnit = managedUnit?.component === "tigervnc";
  const managedX11VncUnit = managedUnit?.component === "x11vnc";
  const systemdAvailable = diagnostics.systemd_available !== false;
  const systemctl = systemctlExecutable(diagnostics);
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || "";
  if (targetComponent === "x11vnc" && !commands.has("x11vnc")) return "";
  const tigerVncCommand = tigerVncWrapperCommand(diagnostics, commands);
  const tigerWrapperAvailable = Boolean(tigerVncCommand);
  if (targetComponent === "tigervnc" && !tigerWrapperAvailable) return "";
  if (!systemdAvailable) return "";
  if (unit && unit !== "com.apple.screensharing" && !managedTigerVncUnit && !managedX11VncUnit && /^[-a-zA-Z0-9_@.:]+$/.test(unit)) {
    return [`${systemctl} start ${shellQuote(unit)}`, firewall].filter(Boolean).join("\n");
  }
  const setup = passwordSetupScript(diagnostics, password, options);
  const port = numericPort(diagnostics.port);
  const display = normalizedDisplay(diagnostics.display);
  const sourceKind = String(diagnostics.source_kind || diagnostics.server_session_selection?.source?.kind || "").toLowerCase();
  // XRDP's Xorg backend can expose shared-memory pixmaps that x11vnc cannot
  // reliably read across the session boundary. Disable MIT-SHM only for XRDP;
  // physical X11 sessions keep the faster default path.
  const sharedMemoryArg = sourceKind === "xrdp" ? " -noshm" : "";
  if (commands.has("x11vnc") && display && diagnostics.session_active === true) {
    const serviceName = managedVncUnitFor("x11vnc");
    const migration = legacyVncMigrationScript(diagnostics, unit, "x11vnc", serviceName);
    const conflictCommands = managedVncConflictCommands(diagnostics, targetComponent, serviceName, migration.prepare.length ? unit : "");
    const xauthority = String(diagnostics.xauthority || "").trim();
    if (sourceKind === "xrdp" && !xauthority) return "";
    const authArg = xauthority ? shellQuote(xauthority) : "guess";
    const displayNumber = Number(display.slice(1));
    const preflight = [
      `[ -S ${shellQuote(`/tmp/.X11-unix/X${displayNumber}`)} ] || { echo ${shellQuote(`所选 X11 显示 ${display} 不存在或对应会话已退出`)} >&2; exit 41; }`,
      xauthority ? `[ -r ${shellQuote(xauthority)} ] || { echo ${shellQuote(`XAUTHORITY ${xauthority} 不存在或不可读`)} >&2; exit 42; }` : ""
    ].filter(Boolean);
    const service = [
      "[Unit]",
      "Description=Terma x11vnc desktop sharing",
      "After=display-manager.service network.target",
      "",
      "[Service]",
      "Type=simple",
      "StandardOutput=journal",
      "StandardError=journal",
      `ExecStart=/usr/bin/env x11vnc -display ${display} -auth ${authArg} ${setup.noPassword ? "-nopw" : `-rfbauth ${setup.passwordFile}`}${sharedMemoryArg} -forever -shared -repeat -rfbport ${port}`,
      "Restart=on-failure",
      "RestartSec=2",
      "",
      "[Install]",
      "WantedBy=graphical.target"
    ].join("\n");
    return [
      "set -eu",
      ...conflictCommands,
      ...migration.prepare,
      ...preflight,
      setup.command,
      `cat > /etc/systemd/system/${serviceName} <<'TERMA_VNC_UNIT'\n${service}\nTERMA_VNC_UNIT`,
      `${systemctl} daemon-reload`,
      `${systemctl} enable ${shellQuote(serviceName)}`,
      `${systemctl} reset-failed ${shellQuote(serviceName)} 2>/dev/null || true`,
      `${systemctl} restart ${shellQuote(serviceName)}`,
      firewall,
      ...migration.commit
    ].filter(Boolean).join("\n");
  }
  const desktopCommand = String(diagnostics.desktop_command || "").trim();
  if (tigerVncCommand && desktopCommand && /^[a-zA-Z0-9_.+-]+$/.test(desktopCommand)) {
    const displayNumber = tigerVncDisplayNumber(port);
    const serviceName = tigerVncServiceName(displayNumber);
    const runnerPath = tigerVncRunnerPath(displayNumber);
    const migration = legacyVncMigrationScript(diagnostics, unit, "tigervnc", serviceName, runnerPath);
    const conflictCommands = managedVncConflictCommands(diagnostics, targetComponent, serviceName, migration.prepare.length ? unit : "");
    const vncDirectory = `${setup.sessionHome.replace(/\/$/, "")}/.vnc`;
    const xstartup = `${vncDirectory}/xstartup`;
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
      // Debian's TigerVNC wrapper calls `hostname -f` and exits when the
      // machine has no FQDN in DNS or /etc/hosts. Keep that workaround local
      // to this service instead of changing the host's global name mapping.
      "td_vnc_tool_dir=''",
      "td_cleanup() { [ -z \"${td_vnc_tool_dir:-}\" ] || rm -rf -- \"$td_vnc_tool_dir\"; }",
      "trap td_cleanup EXIT",
      `td_vnc_wrapper_bin=$(command -v ${tigerVncCommand} 2>/dev/null || true)`,
      `[ -n \"$td_vnc_wrapper_bin\" ] || { echo \"${tigerVncCommand} wrapper not found\" >&2; exit 45; }`,
      "td_hostname_bin=$(command -v hostname 2>/dev/null || printf /bin/hostname)",
      "td_vnc_tool_dir=$(mktemp -d /tmp/terma-tigervnc-tools.XXXXXX)",
      `ln -s \"$td_vnc_wrapper_bin\" \"$td_vnc_tool_dir/${tigerVncCommand}\" 2>/dev/null || cp -f \"$td_vnc_wrapper_bin\" \"$td_vnc_tool_dir/${tigerVncCommand}\"`,
      "cat > \"$td_vnc_tool_dir/hostname\" <<'TERMA_HOSTNAME_SHIM'",
      "#!/bin/sh",
      "td_real_hostname=\"${TERMA_REAL_HOSTNAME:-/bin/hostname}\"",
      "case \"${1:-}\" in",
      "  -f|--fqdn)",
      "    td_name=$(\"$td_real_hostname\" 2>/dev/null || true)",
      "    td_name=$(printf '%s' \"$td_name\" | tr -cd 'A-Za-z0-9.-')",
      "    td_name=${td_name#.}",
      "    td_name=${td_name%.}",
      "    [ -n \"$td_name\" ] || td_name=terma",
      "    case \"$td_name\" in *.*) printf '%s\\n' \"$td_name\" ;; *) printf '%s.terma.local\\n' \"$td_name\" ;; esac",
      "    ;;",
      "  *) exec \"$td_real_hostname\" \"$@\" ;;",
      "esac",
      "TERMA_HOSTNAME_SHIM",
      "chmod 755 \"$td_vnc_tool_dir/hostname\"",
      "export TERMA_REAL_HOSTNAME=\"$td_hostname_bin\"",
      "export PATH=\"$td_vnc_tool_dir:$PATH\"",
      "if [ \"${1:-}\" = --stop ]; then",
      `  /usr/bin/env ${tigerVncCommand} -kill :${displayNumber}`,
      "  exit $?",
      "fi",
      `/usr/bin/env ${tigerVncCommand} -kill :${displayNumber} >/dev/null 2>&1 || true`,
      `if /usr/bin/env ${tigerVncCommand} -help 2>&1 | grep -q -- '[-]fg'; then`,
      `  /usr/bin/env ${tigerVncCommand} ${serverArgs} -fg`,
      "  exit $?",
      "fi",
      `/usr/bin/env ${tigerVncCommand} ${serverArgs}`,
      `while ps -u "$(id -u)" -o args= 2>/dev/null | grep -Eq '(^|/)([X]tigervnc|[X]vnc)[[:space:]]+:${displayNumber}([[:space:]]|$)'; do sleep 2; done`,
      "exit 1",
      ""
    ].join("\n");
    const serviceUnitContent = [
      "[Unit]",
      `Description=Terma TigerVNC virtual desktop :${displayNumber}`,
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "StandardOutput=journal",
      "StandardError=journal",
      `User=${setup.sessionUser}`,
      `WorkingDirectory=${escapedHome}`,
      `Environment=\"HOME=${escapedHome}\"`,
      `Environment=\"USER=${setup.sessionUser}\"`,
      `Environment=\"LOGNAME=${setup.sessionUser}\"`,
      "Environment=\"XDG_SESSION_TYPE=x11\"",
      "UMask=0077",
      `ExecStart=${runnerPath}`,
      `ExecStop=-${runnerPath} --stop`,
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
      ...conflictCommands,
      ...migration.prepare,
      `[ -d ${shellQuote(setup.sessionHome)} ] || { echo ${shellQuote(`TigerVNC 桌面用户主目录不存在：${setup.sessionHome}`)} >&2; exit 43; }`,
      `id -u ${shellQuote(setup.sessionUser)} >/dev/null 2>&1 || { echo ${shellQuote(`TigerVNC 桌面用户不存在：${setup.sessionUser}`)} >&2; exit 44; }`,
      setup.command,
      // systemd runs the generated unit as the target desktop user. The
      // directory may have been created by the privileged setup command (or
      // by an earlier root-run VNC session), so repair ownership before the
      // wrapper attempts to create its pid/log files.
      `install -d -m 700 ${shellQuote(vncDirectory)}`,
      `td_xstartup_tmp=$(mktemp /tmp/terma-tigervnc-xstartup.XXXXXX)`,
      `cat > \"$td_xstartup_tmp\" <<'TERMA_VNC_XSTARTUP'\n${startup}TERMA_VNC_XSTARTUP`,
      `install -m 700 \"$td_xstartup_tmp\" ${shellQuote(xstartup)}`,
      `rm -f \"$td_xstartup_tmp\"`,
      `chown -R ${shellQuote(setup.sessionUser)} ${shellQuote(vncDirectory)}`,
      `chmod 700 ${shellQuote(vncDirectory)}`,
      "install -d -m 755 /usr/local/libexec",
      `td_runner_tmp=$(mktemp /tmp/terma-tigervnc-runner.XXXXXX)`,
      `cat > "$td_runner_tmp" <<'TERMA_VNC_RUNNER'\n${runner}TERMA_VNC_RUNNER`,
      `install -m 755 "$td_runner_tmp" ${shellQuote(runnerPath)}`,
      `rm -f "$td_runner_tmp"`,
      `td_unit_tmp=$(mktemp /tmp/terma-tigervnc-unit.XXXXXX)`,
      `cat > \"$td_unit_tmp\" <<'TERMA_VNC_UNIT'\n${serviceUnitContent}TERMA_VNC_UNIT`,
      `install -m 644 \"$td_unit_tmp\" ${shellQuote(`/etc/systemd/system/${serviceName}`)}`,
      `rm -f \"$td_unit_tmp\"`,
      `${systemctl} daemon-reload`,
      `${systemctl} enable ${shellQuote(serviceName)}`,
      `${systemctl} reset-failed ${shellQuote(serviceName)} 2>/dev/null || true`,
      `${systemctl} restart ${shellQuote(serviceName)}`,
      firewall,
      ...migration.commit
    ].filter(Boolean).join("\n");
  }
  return "";
}

function startPlan(diagnostics: any = {}) {
  if (diagnostics.selection_required) return null;
  const unit = String(diagnostics.service_unit || "").trim();
  const commands = new Set((diagnostics.commands || []).map(value => String(value)));
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || "";
  const display = String(diagnostics.display || "").trim();
  const desktopCommand = String(diagnostics.desktop_command || "").trim();
  const managedUnit = managedVncUnitInfo(unit);
  const managedTigerVncUnit = managedUnit?.component === "tigervnc";
  const managedX11VncUnit = managedUnit?.component === "x11vnc";
  const hasTigerVncWrapper = Boolean(tigerVncWrapperCommand(diagnostics, commands));
  if (targetComponent === "x11vnc" && !commands.has("x11vnc")) return null;
  if (targetComponent === "tigervnc" && !hasTigerVncWrapper) return null;
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
    const sourceKind = String(diagnostics.source_kind || diagnostics.server_session_selection?.source?.kind || "").toLowerCase();
    if (sourceKind === "xrdp" && !String(diagnostics.xauthority || "").trim()) return null;
    return {
      kind:"x11vnc-session",
      action:"configure-start",
      command:"",
      unit:managedVncUnitFor("x11vnc"),
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
    const sourceKind = String(diagnostics.source_kind || diagnostics.server_session_selection?.source?.kind || "").toLowerCase();
    if (sourceKind === "xrdp" && !String(diagnostics.xauthority || "").trim()) return null;
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

function startPlanReason(diagnostics: any = {}) {
  if (diagnostics.selection_required) return "检测到多个活动图形桌面，请先选择物理桌面、XRDP 会话或独立虚拟桌面";
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || "";
  const state = targetComponent ? (diagnostics.selected_component || vncServerComponentState(diagnostics, targetComponent)) : null;
  if (state?.install_required) return state.reason || (targetComponent === "tigervnc" ? "缺少 vncserver/tigervncserver 包装器，无法自动创建独立虚拟桌面" : "缺少 x11vnc，无法自动共享图形桌面");
  if (diagnostics.systemd_available === false) return "当前主机没有可用的 systemd，Terma 无法生成持久 VNC 服务单元";
  const tigerWrapperAvailable = Boolean(tigerVncWrapperCommand(diagnostics));
  if (targetComponent === "tigervnc" && !tigerWrapperAvailable) {
    return "检测到 TigerVNC 原始 X 服务器，但缺少 vncserver/tigervncserver 包装器；请手动配置，或安装完整 TigerVNC Server 包";
  }
  if (targetComponent === "x11vnc" && !(diagnostics.commands || []).includes("x11vnc")) return "未检测到 x11vnc，无法自动共享已选择的图形桌面";
  if (targetComponent === "x11vnc" && diagnostics.session_active !== true) return "所选共享桌面当前没有活动 X11 会话";
  if (targetComponent === "x11vnc" && String(diagnostics.source_kind || diagnostics.server_session_selection?.source?.kind || "").toLowerCase() === "xrdp" && !String(diagnostics.xauthority || "").trim()) {
    return "所选 XRDP 会话没有可用的 XAUTHORITY 认证文件，无法安全启动 x11vnc";
  }
  if (targetComponent === "tigervnc" && !String(diagnostics.desktop_command || "").trim()) return "没有检测到可用于 TigerVNC 独立桌面的 Linux 桌面启动命令";
  return "没有检测到可自动配置/启动的 VNC 服务方案，请打开手动配置说明";
}

function vncGuideText(key: string, params: any = {}) {
  return {key, params};
}

function manualGuide(diagnostics: any = {}, port = 5900) {
  const targetPort = numericPort(port);
  const platform = String(diagnostics.platform || "unknown").toLowerCase();
  if (platform === "macos") {
    return {
      title:vncGuideText("macos_title"),
      summary:vncGuideText("macos_summary"),
      steps:[
        vncGuideText("macos_open_settings"),
        vncGuideText("macos_enable_sharing"),
        vncGuideText("macos_password"),
        vncGuideText("macos_redetect", {port:targetPort})
      ],
      commands:[],
      platform:"macos"
    };
  }
  if (platform !== "linux") {
    return {
      title:vncGuideText("unknown_title"),
      summary:vncGuideText("unknown_summary"),
      steps:[
        vncGuideText("unknown_link_ssh"),
        vncGuideText("unknown_check_port", {port:targetPort}),
        vncGuideText("unknown_platform_help")
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
  const targetComponent = diagnostics.target_component || diagnostics.selected_component?.key || (packages?.server_mode === "virtual-session" ? "tigervnc" : "x11vnc");
  const componentState = diagnostics.selected_component || vncServerComponentState(diagnostics, targetComponent);
  const virtualSession = targetComponent === "tigervnc";
  const selectedDisplay = normalizedDisplay(diagnostics.display) || ":0";
  const selectedSourceKind = String(diagnostics.source_kind || diagnostics.server_session_selection?.source?.kind || "").toLowerCase();
  const manualSharedMemoryArg = selectedSourceKind === "xrdp" ? " -noshm" : "";
  const tigerWrapperAvailable = componentState?.wrapper_available === true;
  const installStep = virtualSession
    ? componentState?.manual_only
      ? vncGuideText("linux_install_tigervnc_manual")
      : vncGuideText("linux_install_tigervnc")
    : vncGuideText("linux_install_x11vnc");
  const startCommand = virtualSession
    ? tigerWrapperAvailable || !componentState?.manual_only
      ? `vncpasswd ~/.vnc/passwd && vncserver :1 -rfbport ${targetPort} -geometry 1440x900 -localhost no`
      : componentState?.raw_server_available ? `Xtigervnc :1 -rfbport ${targetPort} -geometry 1440x900 -localhost no` : ""
    : `x11vnc -display ${selectedDisplay} -auth $XAUTHORITY -rfbauth ~/.vnc/passwd${manualSharedMemoryArg} -forever -shared -rfbport ${targetPort}`;
  const session = diagnostics.session_active && diagnostics.session_user && diagnostics.display
    ? vncGuideText("linux_session_detected", {
        user:String(diagnostics.session_user),
        display:String(diagnostics.display),
        xauthority:diagnostics.xauthority ? ` · XAUTHORITY ${diagnostics.xauthority}` : ""
      })
    : vncGuideText("linux_session_missing");
  const componentKey = targetComponent === "tigervnc" ? "tigervnc" : "x11vnc";
  return {
    title:vncGuideText("linux_title"),
    summary:componentState?.install_required
      ? vncGuideText("linux_component_install_required", {component_key:componentKey})
      : componentState?.installed
        ? (start
          ? vncGuideText("linux_installed_stopped", {component_key:componentKey})
          : vncGuideText("linux_installed_manual", {component_key:componentKey}))
        : vncGuideText("linux_component_missing", {component_key:componentKey}),
    steps:[
      session,
      installStep,
      virtualSession
        ? vncGuideText("linux_virtual_session")
        : vncGuideText("linux_shared_session", {display:selectedDisplay}),
      vncGuideText("linux_redetect", {port:targetPort}),
      vncGuideText("linux_clipboard")
    ],
    commands:[install, ...(offlineInstall ? [offlineInstall] : []), startCommand].filter(Boolean).concat(firewall ? [firewall] : []),
    install_plan:packages?.component_plan || null,
    start_plan:start,
    start_plan_reason:start ? "" : startPlanReason(diagnostics),
    target_component:targetComponent,
    component_state:componentState,
    platform:"linux",
    package_manager:manager
  };
}

async function detectVncServer(profile: any, dependencies: any = {}) {
  let connection = null;
  let managementError: any = null;
  if (dependencies.getConnection && dependencies.listConnections) {
    try {
      const { resolveManagementConnection } = require("./xdmcp-server-core");
      connection = resolveManagementConnection(profile, dependencies);
    } catch (error) {
      managementError = error;
    }
  }
  if (!connection || !dependencies.runSshCommandForConnection) {
    return {
      diagnostics_available:false,
      platform:"unknown",
      port:numericPort(profile?.port),
      status:"unknown",
      recommended_action:"guide",
      can_install:false,
      ssh_error:String(managementError?.message || ""),
      code:String(managementError?.code || ""),
      remote_profile_id:Number(profile?.id || 0),
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
      code:String(error?.code || ""),
      connection_id:Number(connection.id || 0),
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
      code:String(result?.error?.code || ""),
      connection_id:Number(connection.id || 0),
      ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user},
      guide:manualGuide({platform:"unknown"}, port)
    };
  }
  const diagnostics = parseDetectionOutput(result.stdout, port);
  const unit = String(diagnostics.service_unit || "");
  const managedUnit = isManagedVncUnit(unit);
  const serverSessionConfigurable = diagnostics.platform === "linux" && (!unit || managedUnit);
  const selection = resolveVncServerSessionSelection(diagnostics, profile?.options || {});
  let planning = serverSessionConfigurable ? applyVncServerSessionSelection(diagnostics, selection) : {...diagnostics, target_component:selection.component || "", selected_component:selection.component_state || null};
  if (serverSessionConfigurable && managedUnit) {
    const targetReady = selection.component_state?.automatic_manageable === true;
    planning = {
      ...planning,
      service_unit:selection.mode === "shared"
        ? targetReady ? managedVncUnitFor("x11vnc") : ""
        : selection.mode === "virtual"
          ? targetReady ? tigerVncServiceName(tigerVncDisplayNumber(port)) : ""
          : unit
    };
  }
  planning = componentPlanningDiagnostics(planning, selection);
  const packages = selection.requires_selection ? null : packagePlan(planning);
  const start = selection.requires_selection || selection.component_state?.install_required ? null : startPlan(planning);
  const startReason = start ? "" : startPlanReason(planning);
  const actualDisplay = normalizedDisplay(diagnostics.source_display);
  const selectionMatchesRunning = !diagnostics.vnc_process
    || (selection.mode === "virtual" && diagnostics.server_mode === "virtual")
    || (selection.mode === "shared" && diagnostics.server_mode === "shared-x11" && actualDisplay === normalizedDisplay(selection.display));
  const graphicsRendering = diagnostics.vnc_process || !serverSessionConfigurable || selection.requires_selection
    ? diagnostics.graphics_rendering
    : planning.graphics_rendering;
  const componentStates = {
    x11vnc:vncServerComponentState(diagnostics, "x11vnc"),
    tigervnc:vncServerComponentState(diagnostics, "tigervnc")
  };
  const runningComponent = diagnostics.server_mode === "shared-x11"
    ? componentStates.x11vnc
    : diagnostics.server_mode === "virtual"
      ? componentStates.tigervnc
      : null;
  return {
    ...diagnostics,
    graphics_rendering:graphicsRendering,
    server_session_configurable:serverSessionConfigurable,
    server_session_selection:selection,
    server_session_selection_matches_running:selectionMatchesRunning,
    component_states:componentStates,
    running_component:runningComponent,
    selected_component:planning.selected_component || selection.component_state || null,
    selected_status:planning.selected_component?.status || selection.component_state?.status || "unresolved",
    start_plan_reason:startReason,
    ssh_connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user},
    install_plan:packages,
    package_plan:packages,
    uninstall_plan:packages?.uninstall || null,
    start_plan:start,
    service_actions:{
      start,
      restart:start,
      enable:start,
      stop:stopPlan(planning, "stop"),
      disable:stopPlan(planning, "disable")
    },
    firewall_plan:firewallPlan(planning),
    guide:manualGuide(planning, port)
  };
}

async function testVncProfile(id: number, dependencies: any = {}) {
  const profile = dependencies.getRemoteProfile ? dependencies.getRemoteProfile(id) : null;
  if (!profile) throw publicError("VNC_PROFILE_NOT_FOUND", "VNC 连接不存在");
  const port = numericPort(profile.port);
  const endpoint = formatRemoteEndpoint(profile.host, port);
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
      client:"Terma 内置 VNC",
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
  vncServerComponentState,
  validateVncServerComponent,
  vncServerStartValidation,
  vncServerStopValidation,
  resolveVncServerSessionSelection,
  applyVncServerSessionSelection,
  componentPlanningDiagnostics,
  packagePlan,
  buildVncStartCommand,
  firewallPlan,
  startPlan,
  startPlanReason,
  stopPlan,
  uninstallPlan,
  manualGuide,
  detectVncServer,
  testVncProfile
};
