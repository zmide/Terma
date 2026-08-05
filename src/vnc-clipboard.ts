const { buildRemotePosixCommand } = require("./remote-posix");
const { componentInstallPlan } = require("./remote-component-installer");

const MAX_CLIPBOARD_BYTES = 32 * 1024;
const CAPABILITY_TTL_MS = 5 * 60 * 1000;
const CLIPBOARD_COMMAND_TIMEOUT_MS = 8000;
const capabilityCache = new Map();

function sourceConnectionId(profile) {
  return Number(profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
}

function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (host.startsWith("::ffff:")) host = host.slice(7);
  return host;
}

function matchingSourceConnections(profile, dependencies) {
  const host = normalizeHost(profile?.host);
  if (!host || typeof dependencies.listConnections !== "function") return [];
  const username = String(profile?.username || "").trim().toLowerCase();
  return dependencies.listConnections()
    .filter(item => normalizeHost(item?.ssh_host) === host)
    .sort((left, right) => {
      const leftUser = username && String(left?.ssh_user || "").trim().toLowerCase() === username ? 1 : 0;
      const rightUser = username && String(right?.ssh_user || "").trim().toLowerCase() === username ? 1 : 0;
      return rightUser - leftUser
        || Number(Boolean(right?.favorite)) - Number(Boolean(left?.favorite))
        || Number(left?.id || 0) - Number(right?.id || 0);
    });
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function bridgeContext(profile, dependencies) {
  if (!profile || profile.protocol !== "vnc") throw new Error("该连接不是 VNC 连接");
  const requestedConnectionId = sourceConnectionId(profile);
  if (requestedConnectionId) {
    try {
      const connection = dependencies.getConnection(requestedConnectionId);
      if (connection) return { connectionId:requestedConnectionId, connection, resolvedBy:"configured", reason:"" };
    } catch {}
  }
  const connection = matchingSourceConnections(profile, dependencies)[0] || null;
  if (connection) return { connectionId:Number(connection.id), connection, resolvedBy:"host", reason:"" };
  const reason = requestedConnectionId
    ? "VNC 连接关联的 SSH 连接已失效，并且没有找到同主机的可用 SSH 连接"
    : "没有找到同主机的 SSH 连接；请在 VNC 工具栏中选择 SSH 剪贴板辅助连接";
  return { connectionId:0, connection:null, resolvedBy:"", reason };
}

function commandFailure(result, fallback) {
  return String(result?.stderr || result?.stdout || result?.error?.message || fallback || "远端剪贴板命令执行失败").trim();
}

function buildClipboardDetectionScript(vncPort = 5900) {
  const normalizedVncPort = Number.isInteger(Number(vncPort)) && Number(vncPort) > 0 && Number(vncPort) <= 65535 ? Number(vncPort) : 5900;
  const script = String.raw`set +e
td_emit() { printf 'TD_VNC_CLIPBOARD_%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\r\n=' '   ')"; }
td_os=$(uname -s 2>/dev/null || printf unknown)
td_mode=unsupported
td_tool=""
td_display="\${DISPLAY:-}"
td_xauthority="\${XAUTHORITY:-}"
td_wayland_display="\${WAYLAND_DISPLAY:-}"
td_runtime_dir="\${XDG_RUNTIME_DIR:-}"
td_session_user=$(id -un 2>/dev/null || printf unknown)
td_session_uid=$(id -u 2>/dev/null || printf -1)
td_session_home=\${HOME:-}
td_session_type=\${XDG_SESSION_TYPE:-}
td_package_manager=""
td_root=false
[ "$(id -u 2>/dev/null)" = 0 ] && td_root=true
td_is_local_display() {
  case "$1" in
    :[0-9]*|unix:[0-9]*) return 0 ;;
  esac
  return 1
}

for td_manager in apt dnf yum pacman zypper apk; do
  if command -v "$td_manager" >/dev/null 2>&1; then
    td_package_manager=$td_manager
    break
  fi
done

if [ "$td_os" = Darwin ] && [ -x /usr/bin/pbpaste ] && [ -x /usr/bin/pbcopy ]; then
  td_mode=macos
  td_tool=pbcopy
elif [ "$td_os" = Linux ]; then
  # A managed x11vnc process identifies the exact desktop shared by this VNC
  # profile. Prefer it over unrelated Xvfb/XRDP displays found in /proc.
  td_vnc_args=$(ps -eo args= 2>/dev/null | grep '[x]11vnc' | grep -E '(^|[[:space:]])-rfbport[[:space:]]+${normalizedVncPort}([[:space:]]|$)' | head -n 1)
  if [ -n "$td_vnc_args" ]; then
    td_candidate_display=$(printf '%s\n' "$td_vnc_args" | sed -n 's/.*[[:space:]]-display[[:space:]]\([^[:space:]]*\).*/\1/p')
    td_candidate_auth=$(printf '%s\n' "$td_vnc_args" | sed -n 's/.*[[:space:]]-auth[[:space:]]\([^[:space:]]*\).*/\1/p')
    [ -n "$td_candidate_display" ] && td_display=$td_candidate_display
    [ -n "$td_candidate_auth" ] && td_xauthority=$td_candidate_auth
  fi

  # DISPLAY values copied from SSH X11-forwarded processes point back to a
  # client-side X server (for example 192.168.x.x:1.0). They are unrelated to
  # the desktop exported by VNC and become stale as soon as that SSH session
  # ends, so never use them as the clipboard target.
  td_is_local_display "$td_display" || td_display=""

  # Prefer environment values from an active graphical process owned by the
  # SSH user. Root may also inspect the selected desktop user's process.
  for td_env in /proc/[0-9]*/environ; do
    [ -r "$td_env" ] || continue
    td_pid=\${td_env#/proc/}; td_pid=\${td_pid%/environ}
    td_owner_uid=$(stat -c %u "/proc/$td_pid" 2>/dev/null || printf -1)
    [ "$td_session_uid" = 0 ] || [ "$td_owner_uid" = "$td_session_uid" ] || continue
    td_values=$(tr '\000' '\n' < "$td_env" 2>/dev/null)
    td_candidate_display=$(printf '%s\n' "$td_values" | sed -n 's/^DISPLAY=//p' | head -n 1)
    td_candidate_wayland=$(printf '%s\n' "$td_values" | sed -n 's/^WAYLAND_DISPLAY=//p' | head -n 1)
    td_is_local_display "$td_candidate_display" || td_candidate_display=""
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
    break
  done

  if [ -z "$td_display" ]; then
    td_display=$(ps -eo args= 2>/dev/null | sed -n 's/.*[[:space:]]\(:[0-9][0-9]*\)\([[:space:]].*\)\{0,1\}$/\1/p' | head -n 1)
  fi
  if [ -z "$td_display" ]; then
    td_socket=$(find /tmp/.X11-unix -maxdepth 1 -type s -name 'X[0-9]*' 2>/dev/null | sort -V | head -n 1)
    [ -n "$td_socket" ] && td_display=:\${td_socket##*/X}
  fi
  if [ -z "$td_xauthority" ]; then
    td_xauthority=$(ps -eo args= 2>/dev/null | sed -n 's/.*[[:space:]]-auth[[:space:]]\([^[:space:]]*\).*/\1/p' | head -n 1)
  fi
  if [ -z "$td_session_home" ] || [ ! -d "$td_session_home" ]; then
    td_session_home=$(getent passwd "$td_session_user" 2>/dev/null | cut -d: -f6)
  fi
  if [ -z "$td_xauthority" ] && [ -n "$td_session_home" ]; then
    [ -r "$td_session_home/.Xauthority" ] && td_xauthority="$td_session_home/.Xauthority"
  fi
  if [ -z "$td_xauthority" ] && [ -n "$td_session_home" ] && [ -d "$td_session_home" ]; then
    td_xauthority=$(find "$td_session_home" -maxdepth 5 -type f -name .Xauthority -readable 2>/dev/null | head -n 1)
  fi
  if [ -z "$td_runtime_dir" ] && [ "$td_session_uid" -ge 0 ] 2>/dev/null; then
    [ -d "/run/user/$td_session_uid" ] && td_runtime_dir="/run/user/$td_session_uid"
  fi
  if [ -z "$td_wayland_display" ] && [ -n "$td_runtime_dir" ]; then
    td_wayland_socket=$(find "$td_runtime_dir" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | sort | head -n 1)
    [ -n "$td_wayland_socket" ] && td_wayland_display=\${td_wayland_socket##*/}
  fi

  if command -v wl-copy >/dev/null 2>&1 && command -v wl-paste >/dev/null 2>&1 && [ -n "$td_runtime_dir" ] && [ -n "$td_wayland_display" ]; then
    td_mode=linux-wayland
    td_tool=wl-clipboard
  elif command -v xclip >/dev/null 2>&1 && [ -n "$td_display" ]; then
    td_mode=linux-x11
    td_tool=xclip
  elif command -v xsel >/dev/null 2>&1 && [ -n "$td_display" ]; then
    td_mode=linux-x11
    td_tool=xsel
  fi
  if [ -z "$td_session_type" ]; then
    [ -n "$td_wayland_display" ] && td_session_type=wayland
    [ -z "$td_session_type" ] && [ -n "$td_display" ] && td_session_type=x11
  fi
fi

td_emit MODE "$td_mode"
td_emit TOOL "$td_tool"
td_emit OS "$td_os"
td_emit DISPLAY "$td_display"
td_emit XAUTHORITY "$td_xauthority"
td_emit WAYLAND_DISPLAY "$td_wayland_display"
td_emit XDG_RUNTIME_DIR "$td_runtime_dir"
td_emit SESSION_USER "$td_session_user"
td_emit SESSION_UID "$td_session_uid"
td_emit SESSION_HOME "$td_session_home"
td_emit SESSION_TYPE "$td_session_type"
td_emit PACKAGE_MANAGER "$td_package_manager"
td_emit ROOT "$td_root"`;
  return script.replace(/\\\$\{/g, "${");
}

function parseClipboardDetection(output, connectionId) {
  const values = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^TD_VNC_CLIPBOARD_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2]);
  }
  const mode = String(values.get("MODE") || "unsupported").toLowerCase();
  const available = ["macos", "linux-x11", "linux-wayland"].includes(mode);
  const transport = mode === "macos" ? "ssh-macos" : mode === "linux-x11" ? "ssh-linux-x11" : mode === "linux-wayland" ? "ssh-linux-wayland" : "rfb";
  const platform = mode === "macos" ? "macos" : mode.startsWith("linux-") ? "linux" : String(values.get("OS") || "").toLowerCase();
  const normalizedPlatform = platform === "darwin" ? "macos" : platform;
  const reason = available
    ? ""
    : normalizedPlatform === "macos"
      ? "macOS 自带 pbcopy/pbpaste，无需安装；请确认 SSH 账号已登录图形桌面，并允许该会话访问系统剪贴板"
      : normalizedPlatform === "linux"
        ? "Linux 远端没有可用的 Unicode 系统剪贴板辅助工具；可安装 xclip/xsel（X11）或 wl-clipboard（Wayland）"
        : "远端没有可用的 Unicode 系统剪贴板辅助工具；请先确认 SSH 连接对应的操作系统和图形会话";
  return {
    available,
    transport,
    connection_id:connectionId,
    platform:normalizedPlatform,
    tool:String(values.get("TOOL") || ""),
    display:String(values.get("DISPLAY") || ""),
    xauthority:String(values.get("XAUTHORITY") || ""),
    wayland_display:String(values.get("WAYLAND_DISPLAY") || ""),
    xdg_runtime_dir:String(values.get("XDG_RUNTIME_DIR") || ""),
    session_user:String(values.get("SESSION_USER") || ""),
    session_uid:Number(values.get("SESSION_UID") || -1),
    session_home:String(values.get("SESSION_HOME") || ""),
    session_type:String(values.get("SESSION_TYPE") || "").toLowerCase(),
    package_manager:String(values.get("PACKAGE_MANAGER") || "").toLowerCase(),
    root:String(values.get("ROOT") || "").toLowerCase() === "true",
    reason
  };
}

function vncClipboardHelperUninstallPlan(capability: any = {}) {
  const platform = String(capability.platform || "unknown").toLowerCase();
  if (platform !== "linux") return {
    available:false,
    command:"",
    package_manager:"",
    package_names:[],
    reason:platform === "macos"
      ? "macOS 的 pbcopy/pbpaste 是系统自带工具，TunnelDesk 不提供卸载"
      : "尚未识别到可卸载剪贴板辅助工具的 Linux 远端"
  };
  const manager = String(capability.package_manager || "").toLowerCase();
  const tool = String(capability.tool || "").toLowerCase();
  const packages = tool === "wl-clipboard"
    ? ["wl-clipboard"]
    : tool === "xclip" || tool === "xsel"
      ? [tool]
      : [];
  if (!packages.length) return {
    available:false,
    command:"",
    package_manager:manager,
    package_names:[],
    reason:"当前没有检测到可安全自动卸载的 Linux 剪贴板辅助软件包"
  };
  const args = packages.map(shellQuote).join(" ");
  const commands = {
    apt:`td_packages=""; for td_package in ${args}; do dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_packages`,
    dnf:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || dnf remove -y $td_packages`,
    yum:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || yum remove -y $td_packages`,
    pacman:`td_packages=""; for td_package in ${args}; do pacman -Q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || pacman -R --noconfirm $td_packages`,
    zypper:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || zypper --non-interactive remove $td_packages`,
    apk:`td_packages=""; for td_package in ${args}; do apk info -e "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || apk del $td_packages`
  };
  const command = commands[manager] || "";
  return {
    available:Boolean(command),
    command,
    package_manager:manager,
    package_names:packages,
    reason:command ? "" : "当前 Linux 软件包管理器没有可安全自动执行的剪贴板辅助卸载方案",
    warning:`卸载会移除 ${packages.join("/")}；依赖该工具的其他桌面程序也可能受影响`
  };
}

function vncClipboardHelperInstallPlan(capability: any = {}) {
  const platform = String(capability.platform || "unknown").toLowerCase();
  if (platform === "macos") {
    const plan = componentInstallPlan({
      component:"vnc-clipboard-helper",
      label:"macOS 系统剪贴板",
      online_available:false,
      online_description:"macOS 已内置 pbcopy/pbpaste，不需要在线安装",
      offline_description:"macOS 已内置系统剪贴板工具，不需要离线安装",
      local_offline_available:false,
      local_offline_description:"macOS 不需要下载 Linux 剪贴板软件包",
      manual_description:"查看 macOS 图形登录会话、SSH 账号与剪贴板权限检查方法"
    });
    plan.uninstall = vncClipboardHelperUninstallPlan(capability);
    return plan;
  }
  if (platform !== "linux") {
    const plan = componentInstallPlan({
      component:"vnc-clipboard-helper",
      label:"Unicode 剪贴板辅助工具",
      online_available:false,
      offline_description:"需要先通过 SSH 识别远端操作系统和软件包管理器",
      local_offline_available:false,
      local_offline_description:"尚未识别远端为 Debian/Ubuntu 或兼容 APT/.deb 系统，无法使用本机下载后离线安装",
      manual_description:"查看 SSH 关联、系统识别和手动安装说明"
    });
    plan.uninstall = vncClipboardHelperUninstallPlan(capability);
    return plan;
  }
  const manager = String(capability.package_manager || "").toLowerCase();
  const sessionType = String(capability.session_type || "").toLowerCase();
  const packages = sessionType === "wayland" ? ["wl-clipboard"] : ["xclip"];
  const packageAlternatives = sessionType === "wayland" ? [] : [["xclip", "xsel"]];
  const joined = packages.join(" ");
  const onlineCommands = {
    apt:sessionType === "wayland" ? `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${joined}` : `DEBIAN_FRONTEND=noninteractive apt-get update && (DEBIAN_FRONTEND=noninteractive apt-get install -y xclip || DEBIAN_FRONTEND=noninteractive apt-get install -y xsel)`,
    dnf:sessionType === "wayland" ? `dnf install -y ${joined}` : `(dnf install -y xclip || dnf install -y xsel)`,
    yum:sessionType === "wayland" ? `yum install -y ${joined}` : `(yum install -y xclip || yum install -y xsel)`,
    pacman:sessionType === "wayland" ? `pacman -S --noconfirm ${joined}` : `(pacman -S --noconfirm xclip || pacman -S --noconfirm xsel)`,
    zypper:sessionType === "wayland" ? `zypper --non-interactive install ${joined}` : `(zypper --non-interactive install xclip || zypper --non-interactive install xsel)`,
    apk:sessionType === "wayland" ? `apk add ${joined}` : `(apk add xclip || apk add xsel)`
  };
  const offlineCommands = {
    apt:sessionType === "wayland" ? `DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${joined}` : `(DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y xclip || DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y xsel)`,
    dnf:sessionType === "wayland" ? `dnf --cacheonly install -y ${joined}` : `(dnf --cacheonly install -y xclip || dnf --cacheonly install -y xsel)`,
    yum:sessionType === "wayland" ? `yum -C install -y ${joined}` : `(yum -C install -y xclip || yum -C install -y xsel)`,
    pacman:sessionType === "wayland" ? `pacman -S --noconfirm --cachedir /var/cache/pacman/pkg ${joined}` : `(pacman -S --noconfirm --cachedir /var/cache/pacman/pkg xclip || pacman -S --noconfirm --cachedir /var/cache/pacman/pkg xsel)`
  };
  const plan = componentInstallPlan({
    component:"vnc-clipboard-helper",
    label:"Unicode 剪贴板辅助工具",
    online_command:onlineCommands[manager] || "",
    online_description:`使用远端 ${manager || "软件包管理器"} 安装 ${joined}`,
    offline_command:offlineCommands[manager] || "",
    offline_description:"仅使用远端软件包缓存，不访问软件源",
    local_offline_available:manager === "apt",
    local_offline_packages:manager === "apt" ? packages : [],
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：本机下载匹配的软件包和依赖，通过 SFTP 上传到远端安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}，无法自动解析并上传剪贴板工具依赖`,
    manual_description:`查看 ${sessionType === "wayland" ? "Wayland" : sessionType === "x11" ? "X11" : "Linux 图形会话"}对应的安装和权限检查命令`
  });
  plan.package_alternatives = packageAlternatives;
  plan.uninstall = vncClipboardHelperUninstallPlan(capability);
  return plan;
}

function vncClipboardHelperGuide(capability: any = {}) {
  const platform = String(capability.platform || "unknown").toLowerCase();
  if (platform === "macos") return {
    title:"macOS 剪贴板辅助检查说明",
    summary:"macOS 自带 pbcopy/pbpaste，TunnelDesk 不会在 macOS 上安装 Linux 的 xclip、xsel 或 wl-clipboard。",
    steps:[
      "确认 SSH 辅助连接使用的是当前 VNC 所在的 macOS 主机和账号。",
      "确认该账号已经登录 macOS 图形桌面；仅有后台 SSH 会话时，系统剪贴板可能不可访问。",
      "在终端执行 /usr/bin/pbcopy 和 /usr/bin/pbpaste 验证该账号能否读写系统剪贴板。",
      "若命令存在但仍无法读写，请退出并重新登录图形桌面，再返回 TunnelDesk 重新检测。"
    ],
    commands:["command -v /usr/bin/pbcopy /usr/bin/pbpaste", "printf 'TunnelDesk clipboard test' | /usr/bin/pbcopy && /usr/bin/pbpaste"]
  };
  const sessionType = String(capability.session_type || "").toLowerCase();
  const manager = String(capability.package_manager || "").toLowerCase();
  const packages = sessionType === "wayland" ? "wl-clipboard" : sessionType === "x11" ? "xclip（也可使用 xsel）" : "xclip/xsel 或 wl-clipboard";
  const offlineStep = manager === "apt"
    ? "Debian/Ubuntu 及兼容 APT/.deb 系统在远端不能联网时，可选择“本机下载后离线安装”；本机也不能联网时，请按发行版文档准备软件包后手动安装。"
    : manager
      ? `当前检测到 ${manager}，不支持“本机下载后离线安装”；请使用界面中仍可用的在线安装、远端缓存或手动安装/配置说明。`
      : "尚未识别远端包管理器，不能使用“本机下载后离线安装”；请先完成 SSH 系统探测，或查看手动安装/配置说明。";
  return {
    title:"Linux Unicode 剪贴板辅助安装说明",
    summary:`当前图形会话${sessionType ? `识别为 ${sessionType}` : "类型未识别"}，建议安装 ${packages}。`,
    steps:[
      "X11 会话安装 xclip 或 xsel；Wayland 会话安装 wl-clipboard。",
      "SSH 辅助账号必须能访问正在运行的图形会话，并具有正确的 DISPLAY/XAUTHORITY 或 WAYLAND_DISPLAY/XDG_RUNTIME_DIR。",
      "安装后返回 TunnelDesk 重新检测，无需重建 VNC 连接。",
      offlineStep
    ],
    commands:["printf '%s\\n' \"XDG_SESSION_TYPE=$XDG_SESSION_TYPE\" \"DISPLAY=$DISPLAY\" \"WAYLAND_DISPLAY=$WAYLAND_DISPLAY\"", "command -v xclip xsel wl-copy wl-paste"]
  };
}

async function inspectVncClipboardHelper(profile, dependencies) {
  const capability = await detectVncClipboardBridge(profile, dependencies);
  const installPlan = vncClipboardHelperInstallPlan(capability);
  return {...capability, install_plan:installPlan, uninstall_plan:installPlan.uninstall || null, guide:vncClipboardHelperGuide(capability)};
}

function vncClipboardHelperGuideResult(capability: any = {}) {
  const inspection = {...capability};
  return {
    ...inspection,
    ok:true,
    action:"guide",
    before:inspection,
    after:inspection,
    install_plan:inspection.install_plan,
    uninstall_plan:inspection.uninstall_plan || inspection.install_plan?.uninstall || null,
    guide:inspection.guide
  };
}

async function detectVncClipboardBridge(profile, dependencies) {
  const { connectionId, connection, resolvedBy, reason } = bridgeContext(profile, dependencies);
  if (!connection) return { available:false, transport:"rfb", connection_id:0, reason };
  const key = `${connectionId}:${connection.ssh_user || ""}@${connection.ssh_host || ""}:${connection.ssh_port || 22}`;
  const cached = capabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await dependencies.runSshCommandForConnection(connection, buildRemotePosixCommand(buildClipboardDetectionScript(profile?.port)), CLIPBOARD_COMMAND_TIMEOUT_MS);
  const value: any = result?.status === 0
    ? parseClipboardDetection(result.stdout, connectionId)
    : { available:false, transport:"rfb", connection_id:connectionId, reason:commandFailure(result, "远端剪贴板辅助通道探测失败") };
  value.connection_name = String(connection.name || connection.ssh_host || "");
  value.resolved_by = resolvedBy;
  capabilityCache.set(key, { expiresAt:Date.now() + CAPABILITY_TTL_MS, value });
  return value;
}

function clipboardEnvironment(capability) {
  const values = [];
  if (capability.display) values.push(`DISPLAY=${shellQuote(capability.display)}`);
  if (capability.xauthority) values.push(`XAUTHORITY=${shellQuote(capability.xauthority)}`);
  if (capability.wayland_display) values.push(`WAYLAND_DISPLAY=${shellQuote(capability.wayland_display)}`);
  if (capability.xdg_runtime_dir) values.push(`XDG_RUNTIME_DIR=${shellQuote(capability.xdg_runtime_dir)}`);
  return values.length ? `env ${values.join(" ")} ` : "";
}

function clipboardReadCommand(capability) {
  const env = clipboardEnvironment(capability);
  if (capability.transport === "ssh-macos") return "LANG=en_US.UTF-8 LC_CTYPE=UTF-8 /usr/bin/pbpaste -Prefer txt";
  if (capability.transport === "ssh-linux-wayland") return `${env}wl-paste --no-newline --type text 2>/dev/null || ${env}wl-paste --no-newline`;
  if (capability.transport === "ssh-linux-x11" && capability.tool === "xsel") return `timeout 2 ${env}xsel --clipboard --output`;
  if (capability.transport === "ssh-linux-x11") return `timeout 2 ${env}xclip -selection clipboard -o`;
  throw new Error(capability.reason || "远端剪贴板辅助通道不可用");
}

function detachedClipboardWrite(command) {
  return `( td_clip_error=$(mktemp); ${command} >/dev/null 2>"$td_clip_error"; td_clip_status=$?; if [ "$td_clip_status" -ne 0 ]; then cat "$td_clip_error" >&2; fi; rm -f "$td_clip_error"; exit "$td_clip_status" )`;
}

function clipboardWriteCommand(capability) {
  const env = clipboardEnvironment(capability);
  if (capability.transport === "ssh-macos") return "LANG=en_US.UTF-8 LC_CTYPE=UTF-8 /usr/bin/pbcopy";
  if (capability.transport === "ssh-linux-wayland") return detachedClipboardWrite(`${env}wl-copy --type text/plain;charset=utf-8`);
  if (capability.transport === "ssh-linux-x11" && capability.tool === "xsel") return detachedClipboardWrite(`${env}xsel --clipboard --input`);
  if (capability.transport === "ssh-linux-x11") return detachedClipboardWrite(`${env}xclip -selection clipboard -i`);
  throw new Error(capability.reason || "远端剪贴板辅助通道不可用");
}

async function readVncRemoteClipboard(profile, dependencies) {
  const capability = await detectVncClipboardBridge(profile, dependencies);
  if (!capability.available) throw new Error(capability.reason || "远端剪贴板辅助通道不可用");
  const { connection } = bridgeContext(profile, dependencies);
  const readCommand = clipboardReadCommand(capability);
  const base64Command = capability.transport === "ssh-macos" ? "/usr/bin/base64" : "base64";
  const emptySelectionAllowed = capability.transport === "ssh-linux-x11";
  const script = [
    "td_clip=$(mktemp /tmp/tunneldesk-vnc-clipboard.XXXXXX)",
    "td_clip_err=$(mktemp /tmp/tunneldesk-vnc-clipboard-error.XXXXXX)",
    "trap 'rm -f \"$td_clip\" \"$td_clip_err\"' EXIT HUP INT TERM",
    `${readCommand} > "$td_clip" 2>"$td_clip_err"`,
    "td_status=$?",
    emptySelectionAllowed
      ? `if [ "$td_status" -ne 0 ]; then if [ "$td_status" -eq 124 ] || grep -qiE 'target .* not available|no selection|selection .* not available' "$td_clip_err"; then : > "$td_clip"; else cat "$td_clip_err" >&2; exit "$td_status"; fi; fi`
      : `if [ "$td_status" -ne 0 ]; then cat "$td_clip_err" >&2; exit "$td_status"; fi`,
    "td_size=$(wc -c < \"$td_clip\" | tr -d ' ')",
    "printf 'TD_SIZE=%s\\nTD_DATA=' \"$td_size\"",
    `dd if="$td_clip" bs=${MAX_CLIPBOARD_BYTES} count=1 2>/dev/null | ${base64Command} | tr -d '\\r\\n'`,
    "printf '\\n'"
  ].join("\n");
  const result = await dependencies.runSshCommandForConnection(connection, buildRemotePosixCommand(script), CLIPBOARD_COMMAND_TIMEOUT_MS);
  if (result?.status !== 0) throw new Error(commandFailure(result, "读取远端系统剪贴板失败"));
  const output = String(result.stdout || "");
  const size = Number(/(?:^|\n)TD_SIZE=(\d+)/.exec(output)?.[1] || 0);
  const encoded = /(?:^|\n)TD_DATA=([A-Za-z0-9+/=]*)/.exec(output)?.[1] || "";
  const text = Buffer.from(encoded, "base64").toString("utf8");
  return {
    available:true,
    transport:capability.transport,
    connection_id:capability.connection_id,
    connection_name:capability.connection_name,
    resolved_by:capability.resolved_by,
    platform:capability.platform,
    tool:capability.tool,
    text,
    bytes:size,
    truncated:size > MAX_CLIPBOARD_BYTES,
    max_bytes:MAX_CLIPBOARD_BYTES
  };
}

async function writeVncRemoteClipboard(profile, text, dependencies) {
  const capability = await detectVncClipboardBridge(profile, dependencies);
  if (!capability.available) throw new Error(capability.reason || "远端剪贴板辅助通道不可用");
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_CLIPBOARD_BYTES) throw new Error(`剪贴板文本超过 ${MAX_CLIPBOARD_BYTES / 1024} KiB，无法通过 SSH 辅助通道同步`);
  const encoded = Buffer.from(value, "utf8").toString("base64");
  const { connection } = bridgeContext(profile, dependencies);
  const decode = capability.transport === "ssh-macos" ? "/usr/bin/base64 -D" : "base64 -d";
  const command = clipboardWriteCommand(capability);
  const script = `printf '%s' ${shellQuote(encoded)} | ${decode} | ${command}`;
  const result = await dependencies.runSshCommandForConnection(connection, buildRemotePosixCommand(script), CLIPBOARD_COMMAND_TIMEOUT_MS);
  if (result?.status !== 0) throw new Error(commandFailure(result, "写入远端系统剪贴板失败"));
  return {
    ok:true,
    available:true,
    transport:capability.transport,
    connection_id:capability.connection_id,
    connection_name:capability.connection_name,
    resolved_by:capability.resolved_by,
    platform:capability.platform,
    tool:capability.tool,
    bytes
  };
}

function clearVncClipboardCapabilityCache() {
  capabilityCache.clear();
}

module.exports = {
  MAX_CLIPBOARD_BYTES,
  buildClipboardDetectionScript,
  clearVncClipboardCapabilityCache,
  detectVncClipboardBridge,
  inspectVncClipboardHelper,
  parseClipboardDetection,
  readVncRemoteClipboard,
  sourceConnectionId,
  vncClipboardHelperGuide,
  vncClipboardHelperGuideResult,
  vncClipboardHelperInstallPlan,
  writeVncRemoteClipboard
};
