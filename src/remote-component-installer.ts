function installMode(id, label, command = "", description = "", options: any = {}) {
  const value = String(command || "").trim();
  return {
    id:String(id || ""),
    label:String(label || ""),
    available:options.available === undefined ? Boolean(value) || id === "manual" : Boolean(options.available),
    command:value,
    description:String(description || ""),
    package_names:Array.isArray(options.package_names) ? [...options.package_names] : []
  };
}

function componentInstallPlan(options: any = {}) {
  const online = installMode("online", options.online_label || "在线安装", options.online_command, options.online_description || "通过远端包管理器联网安装", {available:options.online_available});
  const offline = installMode("offline", options.offline_label || "离线安装", options.offline_command, options.offline_description || "仅使用远端已有的软件包缓存", {available:options.offline_available});
  const localOfflineAvailable = options.local_offline_available === undefined
    ? Boolean(options.local_offline_command || options.local_offline_remote_command || (Array.isArray(options.local_offline_packages) && options.local_offline_packages.length))
    : Boolean(options.local_offline_available);
  const localOfflineDescription = options.local_offline_description || (localOfflineAvailable
    ? "仅适用于 Debian/Ubuntu 及兼容 APT/.deb 系统：Terma 在本机下载匹配的软件包和依赖，再通过 SFTP 上传并安装"
    : "本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前系统无法自动解析并上传对应的软件包依赖");
  const localOffline = installMode("local-offline", options.local_offline_label || "本机下载后离线安装", options.local_offline_command || options.local_offline_remote_command || "", localOfflineDescription, {
    available:localOfflineAvailable,
    package_names:options.local_offline_packages
  });
  const manual = installMode("manual", options.manual_label || "手动说明", "", options.manual_description || "查看适合当前系统的安装与配置步骤");
  return {
    component:String(options.component || "remote-component"),
    label:String(options.label || "远端组件"),
    modes:[online, offline, localOffline, manual],
    online,
    offline,
    local_offline:localOffline,
    manual
  };
}

function componentInstallCommand(plan: any, actionValue = "install") {
  const action = String(actionValue || "install").trim().toLowerCase();
  const mode = ["install", "online-install", "install-online", "online"].includes(action)
    ? plan?.online
    : ["offline-install", "install-offline", "offline"].includes(action)
      ? plan?.offline
      : ["local-offline-install", "install-local-offline", "local-offline", "offline-local"].includes(action)
        ? plan?.local_offline
      : null;
  if (!mode?.available) return null;
  const command = String(mode.command || "").trim();
  return {
    mode:String(mode.id || ""),
    command,
    description:String(mode.description || ""),
    package_names:Array.isArray(mode.package_names) ? [...mode.package_names] : []
  };
}

module.exports = { componentInstallCommand, componentInstallPlan, installMode };
