const { componentInstallPlan } = require("./remote-component-installer");

const RDP_PACKAGE_SETS = {
  apt:["xrdp", "xorgxrdp"],
  dnf:["xrdp", "xorgxrdp"],
  yum:["xrdp", "xorgxrdp"],
  pacman:["xrdp"],
  zypper:["xrdp", "xorgxrdp"],
  apk:["xrdp"]
};
const LINUX_IDS = new Set(["almalinux", "alpine", "amzn", "arch", "centos", "debian", "fedora", "kali", "linux", "linuxmint", "manjaro", "opensuse", "oracle", "raspbian", "rhel", "rocky", "sles", "ubuntu"]);

function shellJoin(values) {
  return values.map(value => `'${String(value).replace(/'/g, `'\\''`)}'`).join(" ");
}

function serviceActionPlan(diagnostics: any = {}, actionValue = "start") {
  const action = String(actionValue || "start").toLowerCase();
  const systemd = {
    start:"systemctl start xrdp.service",
    stop:"systemctl stop xrdp.service",
    restart:"systemctl restart xrdp.service",
    enable:"systemctl enable --now xrdp.service",
    disable:"systemctl disable --now xrdp.service"
  }[action];
  if (!systemd) return null;
  const openrc = {
    start:"rc-service xrdp start",
    stop:"rc-service xrdp stop",
    restart:"rc-service xrdp restart",
    enable:"rc-update add xrdp default >/dev/null 2>&1 || true; rc-service xrdp start",
    disable:"rc-service xrdp stop 2>/dev/null || true; rc-update del xrdp default >/dev/null 2>&1 || true"
  }[action];
  const sysv = {
    start:"service xrdp start",
    stop:"service xrdp stop",
    restart:"service xrdp restart",
    enable:"service xrdp start",
    disable:"service xrdp stop"
  }[action];
  return {
    action,
    available:Boolean(diagnostics.xrdp_installed),
    command:`if command -v systemctl >/dev/null 2>&1; then ${systemd}; elif command -v rc-service >/dev/null 2>&1; then ${openrc}; elif command -v service >/dev/null 2>&1; then ${sysv}; else echo '未检测到可管理 xrdp 的服务管理器' >&2; exit 1; fi`,
    manual_description:"使用远端系统的服务管理器启动、停止或设置 xrdp 开机状态"
  };
}

function uninstallPlan(diagnostics: any = {}) {
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const packages = RDP_PACKAGE_SETS[manager] || [];
  if (!packages.length) return null;
  const args = shellJoin(packages);
  const removeCommands = {
    apt:`td_packages=""; for td_package in ${args}; do dpkg-query -W -f='${"${Status}"}' "$td_package" 2>/dev/null | grep -q 'install ok installed' && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || DEBIAN_FRONTEND=noninteractive apt-get purge -y $td_packages`,
    dnf:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || dnf remove -y $td_packages`,
    yum:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || yum remove -y $td_packages`,
    pacman:`td_packages=""; for td_package in ${args}; do pacman -Q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || pacman -R --noconfirm $td_packages`,
    zypper:`td_packages=""; for td_package in ${args}; do rpm -q "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || zypper --non-interactive remove $td_packages`,
    apk:`td_packages=""; for td_package in ${args}; do apk info -e "$td_package" >/dev/null 2>&1 && td_packages="$td_packages $td_package" || true; done; [ -z "$td_packages" ] || apk del $td_packages`
  };
  const remove = removeCommands[manager] || "";
  if (!remove) return null;
  return {
    available:true,
    package_manager:manager,
    package_names:packages,
    command:`${serviceActionPlan({...diagnostics, xrdp_installed:true}, "disable").command} 2>/dev/null || true\n${remove}`,
    warning:"卸载会停止 RDP 服务并移除 xrdp 组件，但不会自动卸载桌面环境"
  };
}

function packagePlan(diagnostics: any = {}) {
  const platform = String(diagnostics.platform || diagnostics.kernel || "").toLowerCase();
  const osId = String(diagnostics.os_id || "").toLowerCase();
  const manager = String(diagnostics.package_manager || "").toLowerCase();
  const osLike = String(diagnostics.os_like || "").toLowerCase();
  const linux = platform.includes("linux") || LINUX_IDS.has(osId) || osLike.split(/\s+/).some(item => LINUX_IDS.has(item) || item.includes("linux")) || Boolean(diagnostics.platform_supported);
  const packages = linux ? (RDP_PACKAGE_SETS[manager] || []) : [];
  if (!packages.length) return null;
  const packageArgs = shellJoin(packages);
  const onlineCommands = {
    apt:`apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packageArgs}`,
    dnf:`dnf install -y ${packageArgs}`,
    yum:`yum install -y ${packageArgs}`,
    pacman:`pacman -S --noconfirm ${packageArgs}`,
    zypper:`zypper --non-interactive install ${packageArgs}`,
    apk:`apk add ${packageArgs}`
  };
  const offlineCommands = {
    apt:`DEBIAN_FRONTEND=noninteractive apt-get --no-download install -y ${packageArgs}`,
    dnf:`dnf --cacheonly install -y ${packageArgs}`,
    yum:`yum -C install -y ${packageArgs}`,
    pacman:`td_pkgs=$(find /var/cache/pacman/pkg -maxdepth 1 -type f \( ${packages.map(item => `-name '${item}-*.pkg.tar.*'`).join(" -o ")} \) 2>/dev/null | sort -V); [ -n "$td_pkgs" ] || { echo '未找到 xrdp 离线缓存包' >&2; exit 1; }; pacman -U --noconfirm $td_pkgs`,
    zypper:`zypper --non-interactive --no-refresh install ${packageArgs}`,
    apk:`apk add --no-network ${packageArgs}`
  };
  const online = onlineCommands[manager] || "";
  const offline = offlineCommands[manager] || "";
  const plan = componentInstallPlan({
    component:"rdp-server",
    label:"RDP 服务",
    online_command:online,
    online_description:"通过远端包管理器联网安装 xrdp 和 Xorg 后端",
    offline_command:offline,
    offline_description:"只使用远端包管理器已经缓存的软件包，不访问软件源",
    local_offline_available:manager === "apt",
    local_offline_packages:manager === "apt" ? packages : [],
    local_offline_command:manager === "apt" ? offline : "",
    local_offline_description:manager === "apt"
      ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：TunnelDesk 在本机下载匹配的 xrdp 软件包和依赖，再通过 SFTP 上传并安装"
      : `本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${manager || "未识别包管理器"}，无法自动解析并上传 xrdp 软件包依赖`,
    manual_description:"查看当前发行版的 xrdp 安装、桌面会话和防火墙配置说明"
  });
  return {
    package_manager:manager,
    package_names:packages,
    packages,
    command:online,
    online_command:online,
    offline_command:offline,
    local_offline_packages:manager === "apt" ? packages : [],
    local_offline_command:manager === "apt" ? offline : "",
    component_plan:plan,
    install_plan:plan,
    modes:plan.modes,
    online:plan.online,
    offline:plan.offline,
    local_offline:plan.local_offline,
    manual:plan.manual,
    uninstall:uninstallPlan({...diagnostics, package_manager:manager}),
    service_actions:Object.fromEntries(["start", "stop", "restart", "enable", "disable"].map(action => [action, serviceActionPlan(diagnostics, action)]))
  };
}

module.exports = { RDP_PACKAGE_SETS, packagePlan, serviceActionPlan, uninstallPlan };
