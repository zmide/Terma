const DESKTOP_IDS = ["xfce", "gnome", "plasma", "mate", "cinnamon", "lxqt"];
const { componentInstallPlan } = require("./remote-component-installer");
const { XRDP_RENDER_PROBE_SCRIPT, createXrdpRenderingDiagnostics } = require("./remote-graphics-rendering");
const { selectRemoteProbeLines } = require("./remote-probe-protocol");
const LINUX_OS_IDS = new Set([
  "almalinux", "alpine", "amzn", "arch", "centos", "debian", "elementary", "fedora", "gentoo",
  "kali", "linux", "linuxmint", "manjaro", "neon", "nixos", "ol", "opensuse", "oracle", "pop",
  "raspbian", "rhel", "rocky", "sled", "sles", "ubuntu"
]);

function isLinuxPlatform(osId, osLike = "", kernel = "") {
  const id = String(osId || "").toLowerCase();
  const like = String(osLike || "").toLowerCase();
  return /^linux$/i.test(String(kernel || "").trim())
    || LINUX_OS_IDS.has(id)
    || like.split(/\s+/).some(item => LINUX_OS_IDS.has(item) || item.includes("linux"));
}

const DESKTOP_META = {
  xfce: { label: "XFCE", icon: "layout-dashboard" },
  gnome: { label: "GNOME", icon: "panels-top-left" },
  plasma: { label: "KDE Plasma", icon: "monitor" },
  mate: { label: "MATE", icon: "grid-2x2" },
  cinnamon: { label: "Cinnamon", icon: "apple" },
  lxqt: { label: "LXQt", icon: "layout-grid" }
};

const DETECT_SCRIPT = String.raw`set +e
td_original_path=$PATH
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[ -z "$td_original_path" ] || PATH="$PATH:$td_original_path"
export PATH
terma_emit() { printf 'TERMA_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
td_kernel=$(uname -s 2>/dev/null || printf unknown)
td_os_id=""
td_os_like=""
if [ -r /etc/os-release ]; then
  td_os_id=$(sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"')
  td_os_like=$(sed -n 's/^ID_LIKE=//p' /etc/os-release | head -n 1 | tr -d '"')
fi
if [ -z "$td_os_id" ]; then
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) td_os_id=macos; td_os_like=darwin ;;
    Linux) td_os_id=linux ;;
  esac
fi
td_package_manager=none
command -v apt-get >/dev/null 2>&1 && td_package_manager=apt
command -v dnf >/dev/null 2>&1 && td_package_manager=dnf
command -v yum >/dev/null 2>&1 && td_package_manager=yum
command -v pacman >/dev/null 2>&1 && td_package_manager=pacman
command -v zypper >/dev/null 2>&1 && td_package_manager=zypper
td_manager=unknown
td_service=$(basename "$(readlink -f /etc/systemd/system/display-manager.service 2>/dev/null)" 2>/dev/null | sed 's/\.service$//')
[ -n "$td_service" ] || [ ! -r /etc/X11/default-display-manager ] || td_service=$(basename "$(cat /etc/X11/default-display-manager 2>/dev/null)")
case "$td_service" in
  gdm|gdm3) td_manager=gdm ;;
  lightdm) td_manager=lightdm ;;
  sddm) td_manager=sddm ;;
  xdm) td_manager=xdm ;;
esac
td_login_user=$(id -un 2>/dev/null || true)
td_login_home=$(getent passwd "$td_login_user" 2>/dev/null | cut -d: -f6)
[ -n "$td_login_home" ] || td_login_home=$HOME

td_system_session=""
td_system_session_source=""
td_xdmcp_session=""
td_xdmcp_session_source=""
td_xdmcp_enabled=0
if [ "$td_manager" = "lightdm" ]; then
  td_lightdm_config=$(lightdm --show-config 2>&1 || true)
  td_system_session=$(printf '%s\n' "$td_lightdm_config" | awk '
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
  [ -z "$td_system_session" ] || td_system_session_source=lightdm
  if printf '%s\n' "$td_lightdm_config" | awk '
    /^[[:space:]]*\[XDMCPServer\]/{inside=1;next}
    /^[[:space:]]*\[/{inside=0}
    inside && /^[[:space:]]*([[:upper:]][[:space:]]+)?enabled[[:space:]]*=[[:space:]]*(true|yes|1)[[:space:]]*$/ {found=1}
    END{exit found?0:1}
  '; then td_xdmcp_enabled=1; fi
  td_xdmcp_session="$td_system_session"
  td_xdmcp_session_source="$td_system_session_source"
elif [ "$td_manager" = "gdm" ]; then
  for td_gdm_file in /etc/gdm/custom.conf /etc/gdm3/custom.conf /etc/gdm3/daemon.conf; do
    [ -r "$td_gdm_file" ] || continue
    if awk '
      /^[[:space:]]*\[xdmcp\]/{inside=1;next}
      /^[[:space:]]*\[/{inside=0}
      inside && /^[[:space:]]*Enable[[:space:]]*=[[:space:]]*(true|yes|1)[[:space:]]*$/ {found=1}
      END{exit found?0:1}
    ' "$td_gdm_file" 2>/dev/null; then td_xdmcp_enabled=1; fi
  done
elif [ "$td_manager" = "sddm" ]; then
  for td_config_file in /etc/sddm.conf $(find /etc/sddm.conf.d -maxdepth 1 -type f -name '*.conf' -print 2>/dev/null); do
    [ -r "$td_config_file" ] || continue
    td_candidate=$(awk '
      /^[[:space:]]*\[General\]/{inside=1;next}
      /^[[:space:]]*\[/{inside=0}
      inside && /^[[:space:]]*Session[[:space:]]*=/ {
        line=$0
        sub(/^[^=]*=[[:space:]]*/, "", line)
        print line
        exit
      }
    ' "$td_config_file" 2>/dev/null)
    [ -n "$td_candidate" ] || continue
    td_system_session="$td_candidate"
    td_system_session_source="$td_config_file"
  done
fi

td_session_manager_target=""
if [ -e /usr/bin/x-session-manager ]; then
  td_session_manager_target=$(readlink -f /usr/bin/x-session-manager 2>/dev/null || true)
fi
if [ -z "$td_system_session" ] && [ -n "$td_session_manager_target" ]; then
  td_system_session="$td_session_manager_target"
  td_system_session_source=x-session-manager
fi

td_saved_session=""
td_saved_session_source=""
if [ -n "$td_login_home" ] && [ -r "$td_login_home/.dmrc" ]; then
  td_saved_session=$(sed -n 's/^[[:space:]]*Session[[:space:]]*=[[:space:]]*//p' "$td_login_home/.dmrc" | head -n 1)
  [ -z "$td_saved_session" ] || td_saved_session_source="$td_login_home/.dmrc"
fi
if [ -z "$td_saved_session" ] && [ -n "$td_login_user" ] && [ -r "/var/lib/AccountsService/users/$td_login_user" ]; then
  td_saved_session=$(sed -n 's/^[[:space:]]*XSession[[:space:]]*=[[:space:]]*//p' "/var/lib/AccountsService/users/$td_login_user" | head -n 1)
  [ -z "$td_saved_session" ] || td_saved_session_source="/var/lib/AccountsService/users/$td_login_user"
fi

td_xrdp_session=""
td_xrdp_session_source=""
for td_xrdp_file in "$td_login_home/.xsession" "$td_login_home/.Xclients" /etc/xrdp/startwm.sh; do
  [ -n "$td_login_home" ] || [ "$td_xrdp_file" = /etc/xrdp/startwm.sh ] || continue
  [ -r "$td_xrdp_file" ] || continue
  td_candidate=$(sed 's/[[:space:]]*#.*$//' "$td_xrdp_file" 2>/dev/null | grep -Ei '(startxfce4|xfce4-session|gnome-session|gnome-shell|startplasma-(x11|wayland)|startkde|mate-session|cinnamon-session|startlxqt|lxqt-session)' | tail -n 1)
  [ -n "$td_candidate" ] || continue
  td_xrdp_session="$td_candidate"
  td_xrdp_session_source="$td_xrdp_file"
  break
done

td_vnc_session=""
td_vnc_session_source=""
for td_vnc_config in "$td_login_home/.config/tigervnc/config" "$td_login_home/.vnc/config" /etc/tigervnc/vncserver-config-defaults; do
  [ -n "$td_login_home" ] || [ "$td_vnc_config" = /etc/tigervnc/vncserver-config-defaults ] || continue
  [ -r "$td_vnc_config" ] || continue
  td_candidate=$(sed -n 's/^[[:space:]]*session[[:space:]]*=[[:space:]]*//Ip' "$td_vnc_config" | head -n 1)
  [ -n "$td_candidate" ] || continue
  td_vnc_session="$td_candidate"
  td_vnc_session_source="$td_vnc_config"
  break
done
if [ -z "$td_vnc_session" ]; then
  for td_vnc_xstartup in "$td_login_home/.config/tigervnc/xstartup" "$td_login_home/.vnc/xstartup"; do
    [ -n "$td_login_home" ] || continue
    [ -r "$td_vnc_xstartup" ] || continue
    td_candidate=$(sed 's/[[:space:]]*#.*$//' "$td_vnc_xstartup" 2>/dev/null | grep -Ei '(startxfce4|xfce4-session|gnome-session|gnome-shell|startplasma-(x11|wayland)|startkde|mate-session|cinnamon-session|startlxqt|lxqt-session)' | tail -n 1)
    [ -n "$td_candidate" ] || continue
    td_vnc_session="$td_candidate"
    td_vnc_session_source="$td_vnc_xstartup"
    break
  done
fi
td_privileged=0
[ "$(id -u 2>/dev/null)" = "0" ] && td_privileged=1
[ "$td_privileged" = "1" ] || sudo -n true >/dev/null 2>&1 && td_privileged=1
td_xrdp_active=0
td_xrdp_listening=0
td_xrdp_enabled=0
td_xrdp_installed=0
if command -v xrdp >/dev/null 2>&1 || [ -x /usr/sbin/xrdp ] || [ -x /usr/sbin/xrdp-sesman ]; then
  td_xrdp_installed=1
elif command -v dpkg-query >/dev/null 2>&1 && dpkg-query -s xrdp 2>/dev/null | grep -q '^Status:[[:space:]]*install ok installed$'; then
  td_xrdp_installed=1
elif command -v rpm >/dev/null 2>&1 && rpm -q xrdp >/dev/null 2>&1; then
  td_xrdp_installed=1
elif command -v apk >/dev/null 2>&1 && apk info -e xrdp >/dev/null 2>&1; then
  td_xrdp_installed=1
elif command -v pacman >/dev/null 2>&1 && pacman -Q xrdp >/dev/null 2>&1; then
  td_xrdp_installed=1
fi
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet xrdp.service 2>/dev/null; then
  td_xrdp_enabled=1
elif command -v rc-update >/dev/null 2>&1 && rc-update show default 2>/dev/null | grep -Eq '(^|[[:space:]])xrdp([[:space:]]|$)'; then
  td_xrdp_enabled=1
fi
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet xrdp.service 2>/dev/null; then
  td_xrdp_active=1
elif command -v service >/dev/null 2>&1 && service xrdp status >/dev/null 2>&1; then
  td_xrdp_active=1
elif pgrep -x xrdp >/dev/null 2>&1; then
  td_xrdp_active=1
fi
if command -v ss >/dev/null 2>&1; then
  ss -ltn 2>/dev/null | awk 'NR > 1 {print $4}' | grep -Eq '(^|[.:])3389$' && td_xrdp_listening=1
elif command -v netstat >/dev/null 2>&1; then
  netstat -ltn 2>/dev/null | awk 'NR > 2 {print $4}' | grep -Eq '(^|[.:])3389$' && td_xrdp_listening=1
fi
${XRDP_RENDER_PROBE_SCRIPT}
terma_emit OS_ID "$td_os_id"
terma_emit OS_LIKE "$td_os_like"
terma_emit KERNEL "$td_kernel"
terma_emit PACKAGE_MANAGER "$td_package_manager"
terma_emit DISPLAY_MANAGER "$td_manager"
terma_emit PRIVILEGED "$td_privileged"
terma_emit XRDP_INSTALLED "$td_xrdp_installed"
terma_emit XRDP_ACTIVE "$td_xrdp_active"
terma_emit XRDP_LISTENING "$td_xrdp_listening"
terma_emit XRDP_ENABLED "$td_xrdp_enabled"
terma_emit XRDP_RENDER_DISPLAY "$td_render_xrdp_display"
terma_emit XRDP_RENDER_LOG "$td_render_xrdp_log"
terma_emit XRDP_DRM_DEVICE "$td_render_xrdp_drm_device"
terma_emit XRDP_DRM_AVAILABLE "$td_render_xrdp_drm_available"
terma_emit XRDP_DRI3_CONFIGURED "$td_render_xrdp_dri3"
terma_emit XRDP_SOFTWARE_RENDERING "$td_render_xrdp_software"
terma_emit VNC_SERVER "$(command -v vncserver >/dev/null 2>&1 || command -v Xtigervnc >/dev/null 2>&1 || command -v Xvnc >/dev/null 2>&1 || command -v x11vnc >/dev/null 2>&1 || command -v wayvnc >/dev/null 2>&1 && printf 1 || printf 0)"
terma_emit LOGIN_USER "$td_login_user"
terma_emit SYSTEM_SESSION "$td_system_session"
terma_emit SYSTEM_SESSION_SOURCE "$td_system_session_source"
terma_emit XDMCP_ENABLED "$td_xdmcp_enabled"
terma_emit XDMCP_SESSION "$td_xdmcp_session"
terma_emit XDMCP_SESSION_SOURCE "$td_xdmcp_session_source"
terma_emit SAVED_SESSION "$td_saved_session"
terma_emit SAVED_SESSION_SOURCE "$td_saved_session_source"
terma_emit SESSION_MANAGER_TARGET "$td_session_manager_target"
terma_emit XRDP_SESSION "$td_xrdp_session"
terma_emit XRDP_SESSION_SOURCE "$td_xrdp_session_source"
terma_emit VNC_CONFIGURED_SESSION "$td_vnc_session"
terma_emit VNC_CONFIGURED_SOURCE "$td_vnc_session_source"
terma_emit SESSION_COUNT "0"
command -v startxfce4 >/dev/null 2>&1 && terma_emit DESKTOP xfce
command -v gnome-session >/dev/null 2>&1 && terma_emit DESKTOP gnome
( command -v startplasma-x11 >/dev/null 2>&1 || command -v startplasma-wayland >/dev/null 2>&1 ) && terma_emit DESKTOP plasma
command -v mate-session >/dev/null 2>&1 && terma_emit DESKTOP mate
command -v cinnamon-session >/dev/null 2>&1 && terma_emit DESKTOP cinnamon
command -v startlxqt >/dev/null 2>&1 && terma_emit DESKTOP lxqt
if [ -d /usr/share/xsessions ]; then
  find /usr/share/xsessions -maxdepth 1 -type f -name '*.desktop' -print 2>/dev/null | while IFS= read -r td_file; do
    td_id=$(basename "$td_file" .desktop)
    td_name=$(sed -n 's/^Name=//p' "$td_file" | head -n 1)
    [ -n "$td_name" ] || td_name="$td_id"
    terma_emit SESSION "$td_id|$td_name"
  done
fi
if [ -d /usr/share/wayland-sessions ]; then
  find /usr/share/wayland-sessions -maxdepth 1 -type f -name '*.desktop' -print 2>/dev/null | while IFS= read -r td_file; do
    td_id=$(basename "$td_file" .desktop)
    td_name=$(sed -n 's/^Name=//p' "$td_file" | head -n 1)
    [ -n "$td_name" ] || td_name="$td_id"
    terma_emit WAYLAND_SESSION "$td_id|$td_name"
  done
fi
if command -v loginctl >/dev/null 2>&1; then
  for td_session_id in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    td_session_type=$(loginctl show-session "$td_session_id" -p Type --value 2>/dev/null || true)
    case "$td_session_type" in x11|wayland) ;; *) continue ;; esac
    td_session_class=$(loginctl show-session "$td_session_id" -p Class --value 2>/dev/null || true)
    [ "$td_session_class" = user ] || continue
    td_session_uid=$(loginctl show-session "$td_session_id" -p User --value 2>/dev/null || true)
    td_session_user=$(getent passwd "$td_session_uid" 2>/dev/null | cut -d: -f1)
    [ -n "$td_session_user" ] || td_session_user="$td_session_uid"
    td_session_service=$(loginctl show-session "$td_session_id" -p Service --value 2>/dev/null || true)
    td_session_display=$(loginctl show-session "$td_session_id" -p Display --value 2>/dev/null || true)
    td_session_seat=$(loginctl show-session "$td_session_id" -p Seat --value 2>/dev/null || true)
    td_session_desktop=$(loginctl show-session "$td_session_id" -p Desktop --value 2>/dev/null || true)
    td_session_state=$(loginctl show-session "$td_session_id" -p State --value 2>/dev/null || true)
    if [ -z "$td_session_desktop" ]; then
      td_session_leader=$(loginctl show-session "$td_session_id" -p Leader --value 2>/dev/null || true)
      if [ -n "$td_session_leader" ] && [ -r "/proc/$td_session_leader/environ" ]; then
        td_session_desktop=$(tr '\0' '\n' < "/proc/$td_session_leader/environ" 2>/dev/null | sed -n -e 's/^XDG_CURRENT_DESKTOP=//p' -e 's/^DESKTOP_SESSION=//p' | head -n 1)
      fi
    fi
    terma_emit GRAPHICAL_SESSION "$td_session_id|$td_session_user|$td_session_service|$td_session_display|$td_session_seat|$td_session_desktop|$td_session_state"
  done
fi
if command -v ps >/dev/null 2>&1; then
  ps -eo pid=,user=,comm=,args= 2>/dev/null | while read -r td_vnc_pid td_vnc_user td_vnc_command td_vnc_args; do
    case "$td_vnc_command" in
      x11vnc|wayvnc) td_vnc_kind=shared ;;
      Xtigervnc|Xvnc) td_vnc_kind=virtual ;;
      *) continue ;;
    esac
    td_vnc_display=""
    td_vnc_desktop=""
    if [ -r "/proc/$td_vnc_pid/environ" ]; then
      td_vnc_display=$(tr '\0' '\n' < "/proc/$td_vnc_pid/environ" 2>/dev/null | sed -n 's/^DISPLAY=//p' | head -n 1)
      td_vnc_desktop=$(tr '\0' '\n' < "/proc/$td_vnc_pid/environ" 2>/dev/null | sed -n -e 's/^XDG_CURRENT_DESKTOP=//p' -e 's/^DESKTOP_SESSION=//p' | head -n 1)
    fi
    [ -n "$td_vnc_display" ] || td_vnc_display=$(printf '%s' "$td_vnc_args" | grep -Eo ':[0-9]+([.][0-9]+)?' | head -n 1)
    terma_emit VNC_PROCESS "$td_vnc_pid|$td_vnc_user|$td_vnc_kind|$td_vnc_display|$td_vnc_desktop|$td_vnc_command"
  done
fi
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function rootWrapper(script) {
  const payload = Buffer.from(script, "utf8").toString("base64");
  return `td_payload=${shellQuote(payload)}; if [ "$(id -u 2>/dev/null)" = "0" ]; then printf '%s' "$td_payload" | base64 -d | sh; elif sudo -n true >/dev/null 2>&1; then printf '%s' "$td_payload" | base64 -d | sudo -n sh; else echo 'Terma requires root or passwordless sudo' >&2; exit 77; fi`;
}

function normalizeDesktopId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/(^|[^a-z])(?:xfce|xfce4|xubuntu|startxfce4)([^a-z]|$)/.test(text)) return "xfce";
  if (/(^|[^a-z])(?:mate|mate-session)([^a-z]|$)/.test(text)) return "mate";
  if (/(?:plasma|startplasma|kde|startkde)/.test(text)) return "plasma";
  if (/(?:cinnamon|cinnamon-session)/.test(text)) return "cinnamon";
  if (/(?:lxqt|startlxqt)/.test(text)) return "lxqt";
  if (/(?:gnome|ubuntu)/.test(text)) return "gnome";
  return "";
}

function resolveSessionDescriptor(rawValue, sessions, source = "", fallback = null) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const generic = ["default", "lightdm-xsession"].includes(normalized);
  const matched = sessions.find(item => String(item.id || "").toLowerCase() === normalized)
    || sessions.find(item => String(item.name || "").toLowerCase() === normalized);
  const desktopId = normalizeDesktopId(matched?.id || matched?.name || raw)
    || (generic ? String(fallback?.desktop_id || "") : "");
  return {
    id:matched?.id || raw,
    name:matched?.name || (desktopId ? DESKTOP_META[desktopId]?.label || raw : raw),
    raw,
    source:String(source || ""),
    desktop_id:desktopId,
    resolved_from_default:Boolean(generic && desktopId)
  };
}

function parseDetectionOutput(output) {
  const values = new Map();
  const sessions = [];
  const waylandSessions = [];
  const graphicalSessions = [];
  const vncProcesses = [];
  const detectedDesktopIds = [];
  for (const line of selectRemoteProbeLines(output)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === "DESKTOP") {
      const id = String(match[2] || "").trim().toLowerCase();
      if (DESKTOP_IDS.includes(id) && !detectedDesktopIds.includes(id)) detectedDesktopIds.push(id);
    } else if (match[1] === "SESSION" || match[1] === "WAYLAND_SESSION") {
      const separator = match[2].indexOf("|");
      const item = { id: separator < 0 ? match[2] : match[2].slice(0, separator), name: separator < 0 ? match[2] : match[2].slice(separator + 1) };
      (match[1] === "SESSION" ? sessions : waylandSessions).push(item);
    } else if (match[1] === "GRAPHICAL_SESSION") {
      const [id="", user="", service="", display="", seat="", desktop="", state=""] = match[2].split("|");
      if (id) graphicalSessions.push({id, user, service, display, seat, desktop, state});
    } else if (match[1] === "VNC_PROCESS") {
      const [pid="", user="", kind="", display="", desktop="", command=""] = match[2].split("|");
      if (pid) vncProcesses.push({pid, user, kind, display, desktop, command});
    } else values.set(match[1], match[2]);
  }
  const usableSessions = [...sessions, ...waylandSessions].filter(item => item.id && !["default", "lightdm-xsession"].includes(item.id));
  const desktopAliases = {
    xfce:["xfce"], gnome:["gnome"], plasma:["plasma", "kde"], mate:["mate"], cinnamon:["cinnamon"], lxqt:["lxqt"]
  };
  const desktops = [];
  const add = (id, aliases = desktopAliases[id] || [id]) => {
    if (detectedDesktopIds.includes(id) || (!detectedDesktopIds.length && usableSessions.some(item => aliases.some(alias => item.id.toLowerCase().includes(alias))))) {
      desktops.push({ id, ...(DESKTOP_META[id] || { label: id, icon: "monitor" }) });
    }
  };
  for (const id of DESKTOP_IDS) add(id);
  const knownAliases = Object.values(desktopAliases).flat();
  const allSessions = [...sessions, ...waylandSessions];
  const systemDefaultSession = resolveSessionDescriptor(values.get("SYSTEM_SESSION"), allSessions, values.get("SYSTEM_SESSION_SOURCE"));
  const userSavedSession = resolveSessionDescriptor(values.get("SAVED_SESSION"), allSessions, values.get("SAVED_SESSION_SOURCE"), systemDefaultSession);
  const xdmcpConfiguredSession = resolveSessionDescriptor(values.get("XDMCP_SESSION"), allSessions, values.get("XDMCP_SESSION_SOURCE"), systemDefaultSession);
  const xrdpConfiguredSession = resolveSessionDescriptor(values.get("XRDP_SESSION"), allSessions, values.get("XRDP_SESSION_SOURCE"));
  const vncConfiguredSession = resolveSessionDescriptor(values.get("VNC_CONFIGURED_SESSION"), allSessions, values.get("VNC_CONFIGURED_SOURCE"));
  const xdmcpEnabled = values.get("XDMCP_ENABLED") === "1";
  const xrdpInstalled = values.get("XRDP_INSTALLED") === "1";
  const xrdpActive = values.get("XRDP_ACTIVE") === "1";
  const xrdpListening = values.get("XRDP_LISTENING") === "1";
  const xrdpEnabled = values.get("XRDP_ENABLED") === "1";
  const xrdpRendering = createXrdpRenderingDiagnostics({
    installed:xrdpInstalled,
    active:xrdpActive,
    display:values.get("XRDP_RENDER_DISPLAY") || "",
    drm_device:values.get("XRDP_DRM_DEVICE") || "",
    drm_device_available:values.get("XRDP_DRM_AVAILABLE") === "1",
    software_rendering:values.get("XRDP_SOFTWARE_RENDERING") === "1",
    log_file:values.get("XRDP_RENDER_LOG") || ""
  });
  const vncServerInstalled = values.get("VNC_SERVER") === "1";
  const activeGraphicalSessions = graphicalSessions
    .filter(item => !["closing", "dead"].includes(String(item.state || "").toLowerCase()))
    .map(item => {
      let desktopId = normalizeDesktopId(item.desktop);
      let inferredFrom = "";
      let protocol = "";
      if (/xrdp/i.test(String(item.service || ""))) {
        protocol = "rdp";
        if (!desktopId && xrdpConfiguredSession?.desktop_id) {
          desktopId = xrdpConfiguredSession.desktop_id;
          inferredFrom = "xrdp-config";
        }
      } else if (!item.seat && xdmcpEnabled && /^(?:lightdm|gdm|gdm-password|xdm)$/i.test(String(item.service || ""))) {
        protocol = "xdmcp";
        if (!desktopId && xdmcpConfiguredSession?.desktop_id) {
          desktopId = xdmcpConfiguredSession.desktop_id;
          inferredFrom = "xdmcp-config";
        }
      }
      return {...item, desktop_id:desktopId, inferred_from:inferredFrom, protocol};
    });
  const normalizeDisplay = value => String(value || "").trim().toLowerCase().replace(/\.0$/, "");
  const loginUser = String(values.get("LOGIN_USER") || "");
  const activeVncSessions = vncProcesses.map(item => {
    const display = normalizeDisplay(item.display);
    const sameUserSessions = activeGraphicalSessions.filter(session => !item.user || !session.user || session.user === item.user);
    const matchedSession = (display ? sameUserSessions.find(session => normalizeDisplay(session.display) === display) : null)
      || (item.kind === "shared" && sameUserSessions.length === 1 ? sameUserSessions[0] : null);
    const configuredSource = String(vncConfiguredSession?.source || "");
    const configurationApplies = configuredSource.startsWith("/etc/") || !item.user || !loginUser || item.user === loginUser;
    const configuredDesktopId = item.kind === "virtual" && configurationApplies ? String(vncConfiguredSession?.desktop_id || "") : "";
    return {
      ...item,
      desktop_id:normalizeDesktopId(item.desktop) || String(matchedSession?.desktop_id || "") || configuredDesktopId,
      graphical_session_id:matchedSession?.id || "",
      shared:item.kind === "shared",
      virtual:item.kind === "virtual"
    };
  });
  const desktopUsage = Object.fromEntries(DESKTOP_IDS.map(id => [id, {
    system_default:false,
    account_default:false,
    xdmcp_configured:false,
    xdmcp_saved:false,
    xdmcp_active:false,
    rdp_configured:false,
    rdp_active:false,
    vnc_configured:false,
    vnc_shared:false,
    vnc_virtual_active:false,
    vnc_sessions:[],
    active:false,
    local_active:false,
    remote_active:false,
    active_sessions:[]
  }]));
  const mark = (descriptor, field) => {
    const id = String(descriptor?.desktop_id || "");
    if (desktopUsage[id]) desktopUsage[id][field] = true;
  };
  mark(systemDefaultSession, "system_default");
  mark(userSavedSession, "account_default");
  if (xdmcpEnabled) {
    mark(xdmcpConfiguredSession, "xdmcp_configured");
    mark(userSavedSession, "xdmcp_saved");
  }
  if (xrdpInstalled) mark(xrdpConfiguredSession, "rdp_configured");
  if (vncServerInstalled) mark(vncConfiguredSession, "vnc_configured");
  for (const session of activeGraphicalSessions) {
    if (!desktopUsage[session.desktop_id]) continue;
    desktopUsage[session.desktop_id].active = true;
    desktopUsage[session.desktop_id][session.seat ? "local_active" : "remote_active"] = true;
    if (session.protocol === "rdp") desktopUsage[session.desktop_id].rdp_active = true;
    if (session.protocol === "xdmcp") desktopUsage[session.desktop_id].xdmcp_active = true;
    desktopUsage[session.desktop_id].active_sessions.push(session);
  }
  for (const session of activeVncSessions) {
    if (!desktopUsage[session.desktop_id]) continue;
    desktopUsage[session.desktop_id][session.shared ? "vnc_shared" : "vnc_virtual_active"] = true;
    desktopUsage[session.desktop_id].vnc_sessions.push(session);
  }
  const desktopSelection = {
    system_default:{state:systemDefaultSession?.desktop_id ? "configured" : "unknown", session:systemDefaultSession},
    account_default:{state:userSavedSession?.desktop_id ? "configured" : "login-selection", session:userSavedSession},
    xdmcp:{state:!xdmcpEnabled ? "disabled" : xdmcpConfiguredSession?.desktop_id ? "configured" : userSavedSession?.desktop_id ? "account-saved" : "login-selection", session:xdmcpConfiguredSession || userSavedSession},
    rdp:{state:!xrdpInstalled ? "not-installed" : xrdpConfiguredSession?.desktop_id ? "configured" : "unknown", session:xrdpConfiguredSession},
    vnc:{state:!vncServerInstalled ? "not-installed" : activeVncSessions.length ? activeVncSessions.some(item => item.desktop_id) ? "active" : "active-unknown" : vncConfiguredSession?.desktop_id ? "configured" : "login-selection", session:vncConfiguredSession}
  };
  return {
    os_id: String(values.get("OS_ID") || "").toLowerCase(),
    os_like: String(values.get("OS_LIKE") || "").toLowerCase(),
    kernel: String(values.get("KERNEL") || "").toLowerCase(),
    package_manager: String(values.get("PACKAGE_MANAGER") || "none").toLowerCase(),
    display_manager: String(values.get("DISPLAY_MANAGER") || "unknown").toLowerCase(),
    privileged: values.get("PRIVILEGED") === "1",
    xrdp_installed: xrdpInstalled,
    xrdp_active: xrdpActive,
    xrdp_listening: xrdpListening,
    xrdp_enabled: xrdpEnabled,
    xrdp_dri3_configured: values.get("XRDP_DRI3_CONFIGURED") === "1",
    graphics_rendering:xrdpRendering,
    vnc_server_installed: vncServerInstalled,
    sessions,
    wayland_sessions: waylandSessions,
    login_user: values.get("LOGIN_USER") || "",
    system_default_session: systemDefaultSession,
    account_default_session: userSavedSession,
    xdmcp_enabled: xdmcpEnabled,
    xdmcp_configured_session: xdmcpConfiguredSession,
    xdmcp_saved_session: userSavedSession,
    xrdp_configured_session: xrdpConfiguredSession,
    vnc_configured_session: vncConfiguredSession,
    graphical_sessions: graphicalSessions,
    active_graphical_sessions: activeGraphicalSessions,
    active_vnc_sessions: activeVncSessions,
    desktop_selection: desktopSelection,
    desktop_usage: desktopUsage,
    desktops,
    has_desktop: desktops.length > 0 || usableSessions.some(item => !knownAliases.some(alias => item.id.toLowerCase().includes(alias))),
    platform_supported: isLinuxPlatform(values.get("OS_ID"), values.get("OS_LIKE"), values.get("KERNEL")),
    recommended: desktops.some(item => item.id === "xfce") ? "xfce" : desktops[0]?.id || "xfce"
  };
}

function desktopInstallPlan(diagnostics: any = {}) {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const debian = String(diagnostics.os_id || "").toLowerCase() === "debian";
  const plans = {
    apt: {
      xfce: "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y xfce4 xfce4-goodies dbus-x11",
      gnome: `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${debian ? "gnome-core dbus-x11" : "ubuntu-desktop-minimal"}`,
      plasma: "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y kde-plasma-desktop",
      mate: `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${debian ? "mate-desktop-environment dbus-x11" : "ubuntu-mate-desktop"}`,
      cinnamon: "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y cinnamon-desktop-environment",
      lxqt: "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y lxqt dbus-x11"
    },
    dnf: {
      xfce: "dnf group install -y Xfce && dnf install -y dbus-x11",
      gnome: "dnf group install -y 'GNOME Desktop Environment'",
      plasma: "dnf group install -y 'KDE Plasma Workspaces'",
      mate: "dnf group install -y 'MATE Desktop'",
      cinnamon: "dnf install -y cinnamon",
      lxqt: "dnf group install -y 'LXQt Desktop'"
    },
    yum: {
      xfce: "yum groupinstall -y Xfce && yum install -y dbus-x11",
      gnome: "yum groupinstall -y 'GNOME Desktop'",
      plasma: "yum groupinstall -y 'KDE Plasma Workspaces'",
      mate: "yum groupinstall -y 'MATE Desktop'",
      cinnamon: "yum install -y cinnamon",
      lxqt: "yum groupinstall -y 'LXQt Desktop'"
    },
    pacman: {
      xfce: "pacman -S --noconfirm xfce4 xfce4-goodies dbus",
      gnome: "pacman -S --noconfirm gnome gnome-extra",
      plasma: "pacman -S --noconfirm plasma",
      mate: "pacman -S --noconfirm mate mate-extra",
      cinnamon: "pacman -S --noconfirm cinnamon",
      lxqt: "pacman -S --noconfirm lxqt"
    },
    zypper: {
      xfce: "zypper --non-interactive install patterns-openSUSE-xfce xfce4-goodies dbus-1-x11",
      gnome: "zypper --non-interactive install patterns-openSUSE-gnome",
      plasma: "zypper --non-interactive install patterns-openSUSE-kde",
      mate: "zypper --non-interactive install mate-desktop",
      cinnamon: "zypper --non-interactive install cinnamon",
      lxqt: "zypper --non-interactive install patterns-openSUSE-lxqt"
    }
  };
  const command = plans[manager]?.[String(diagnostics.requested_desktop || "xfce")];
  if (!command) return null;
  const requested = String(diagnostics.requested_desktop || "xfce").toLowerCase();
  const aptPackages = manager === "apt"
    ? {
      xfce:["xfce4", "xfce4-goodies", "dbus-x11"],
      gnome:debian ? ["gnome-core", "dbus-x11"] : ["ubuntu-desktop-minimal"],
      plasma:["kde-plasma-desktop"],
      mate:debian ? ["mate-desktop-environment", "dbus-x11"] : ["ubuntu-mate-desktop"],
      cinnamon:["cinnamon-desktop-environment"],
      lxqt:["lxqt", "dbus-x11"]
    }[requested] || []
    : [];
  const localOfflineCommand = aptPackages.length
    ? `DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${aptPackages.map(item => `'${item.replace(/'/g, `'\\''`)}'`).join(" ")}`
    : "";
  const offlineCommand = manager === "apt" ? localOfflineCommand : "";
  const plan = componentInstallPlan({
    component:"linux-desktop",
    label:`Linux 桌面 · ${DESKTOP_META[requested]?.label || requested}`,
    online_command:command,
    offline_command:offlineCommand,
    offline_description:"只使用远端包管理器已缓存的软件包，不访问软件源",
    local_offline_available:manager === "apt" && aptPackages.length > 0,
    local_offline_packages:aptPackages,
    local_offline_command:localOfflineCommand,
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：Terma 在本机下载匹配的桌面软件包和依赖，再通过 SFTP 上传并安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}，无法自动解析并上传桌面软件包依赖`,
    manual_description:"查看当前发行版对应的桌面安装、卸载和会话配置说明"
  });
  return {
    package_manager:manager,
    desktop_id:requested,
    command,
    offline_command:offlineCommand,
    local_offline_packages:aptPackages,
    local_offline_command:localOfflineCommand,
    component_plan:plan,
    modes:plan.modes,
    online:plan.online,
    offline:plan.offline,
    local_offline:plan.local_offline,
    manual:plan.manual
  };
}

function desktopUninstallPlan(diagnostics: any = {}) {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const aptPurge = (packages) => {
    const candidates = packages.join(" ");
    return `td_installed=""; for td_package in ${candidates}; do dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_installed="$td_installed $td_package" || true; done; if [ -n "$td_installed" ]; then DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_installed; fi`;
  };
  const plans = {
    apt: {
      xfce: aptPurge(["xfce4", "xfce4-goodies", "xfce4-session", "xfdesktop4", "xfwm4"]),
      gnome: aptPurge(["ubuntu-desktop-minimal", "gnome-core", "gnome-shell", "gnome-session", "gnome-session-bin"]),
      plasma: aptPurge(["kde-plasma-desktop", "plasma-desktop", "plasma-workspace", "plasma-workspace-wayland"]),
      mate: aptPurge(["ubuntu-mate-desktop", "mate-desktop-environment", "mate-session-manager", "mate-panel", "marco"]),
      cinnamon: aptPurge(["cinnamon-desktop-environment", "cinnamon-core", "cinnamon-session", "cinnamon"]),
      lxqt: aptPurge(["lxqt", "lxqt-core", "lxqt-session", "openbox"])
    },
    dnf: {
      xfce: "dnf group remove -y Xfce",
      gnome: "dnf group remove -y 'GNOME Desktop Environment'",
      plasma: "dnf group remove -y 'KDE Plasma Workspaces'",
      mate: "dnf group remove -y 'MATE Desktop'",
      cinnamon: "dnf remove -y cinnamon",
      lxqt: "dnf group remove -y 'LXQt Desktop'"
    },
    yum: {
      xfce: "yum groupremove -y Xfce",
      gnome: "yum groupremove -y 'GNOME Desktop'",
      plasma: "yum groupremove -y 'KDE Plasma Workspaces'",
      mate: "yum groupremove -y 'MATE Desktop'",
      cinnamon: "yum remove -y cinnamon",
      lxqt: "yum groupremove -y 'LXQt Desktop'"
    },
    pacman: {
      xfce: "pacman -Rns --noconfirm xfce4 xfce4-goodies",
      gnome: "pacman -Rns --noconfirm gnome gnome-extra",
      plasma: "pacman -Rns --noconfirm plasma",
      mate: "pacman -Rns --noconfirm mate mate-extra",
      cinnamon: "pacman -Rns --noconfirm cinnamon",
      lxqt: "pacman -Rns --noconfirm lxqt"
    },
    zypper: {
      xfce: "zypper --non-interactive remove patterns-openSUSE-xfce xfce4-goodies",
      gnome: "zypper --non-interactive remove patterns-openSUSE-gnome",
      plasma: "zypper --non-interactive remove patterns-openSUSE-kde",
      mate: "zypper --non-interactive remove mate-desktop",
      cinnamon: "zypper --non-interactive remove cinnamon",
      lxqt: "zypper --non-interactive remove patterns-openSUSE-lxqt"
    }
  };
  const command = plans[manager]?.[String(diagnostics.requested_desktop || "xfce")];
  return command ? { package_manager: manager, command } : null;
}

function buildDesktopTaskScript(diagnostics: any, desktopId, action = "install", installMode = "online") {
  const requested = String(desktopId || "").toLowerCase();
  if (!DESKTOP_IDS.includes(requested)) throw new Error("不支持的 Linux 桌面类型");
  const plan: any = (action === "uninstall" ? desktopUninstallPlan : desktopInstallPlan)({...diagnostics, requested_desktop: requested});
  if (!plan) throw new Error("当前包管理器没有可用的自动桌面操作方案");
  const normalizedMode = action === "install" && String(installMode || "online").toLowerCase() === "offline" ? "offline" : "online";
  const command = normalizedMode === "offline" ? String(plan.offline_command || plan.offline?.command || "").trim() : String(plan.command || "").trim();
  if (!command) throw new Error(normalizedMode === "offline" ? "远端没有可用的 Linux 桌面离线缓存包" : "当前包管理器没有可用的自动桌面操作命令");
  const label = DESKTOP_META[requested]?.label || requested;
  const verb = action === "uninstall" ? "卸载" : "安装";
  const script = String.raw`set -eu
terma_emit() { printf 'TERMA_DESKTOP_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
terma_emit STAGE "prepare"
terma_emit LOG "正在准备${verb} ${label}"
terma_emit STAGE "packages"
terma_emit LOG "正在使用 ${plan.package_manager} 包管理器处理软件包"
${command}
terma_emit STAGE "refresh"
terma_emit LOG "软件包处理完成，正在重新探测桌面会话"
terma_emit STAGE "verify"
terma_emit LOG "${label} ${verb}命令已完成"
`;
  return rootWrapper(script);
}

function buildInstallScript(diagnostics, desktopId, installMode = "online") {
  return buildDesktopTaskScript(diagnostics, desktopId, "install", installMode);
}

function buildUninstallScript(diagnostics, desktopId) {
  return buildDesktopTaskScript(diagnostics, desktopId, "uninstall");
}

module.exports = {
  DESKTOP_IDS,
  LINUX_OS_IDS,
  DESKTOP_META,
  DETECT_SCRIPT,
  buildDesktopTaskScript,
  buildInstallScript,
  buildUninstallScript,
  desktopUninstallPlan,
  desktopInstallPlan,
  isLinuxPlatform,
  normalizeDesktopId,
  parseDetectionOutput
};
