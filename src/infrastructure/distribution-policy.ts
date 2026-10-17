import { publicError } from "../public-error";

export function isFnosDistribution(): boolean {
  return process.env.TERMA_DISTRIBUTION === "fnos";
}
export function distributionPolicy() {
  return {
    distribution:isFnosDistribution() ? "fnos" : "standard",
    listen_locked:isFnosDistribution(),
    storage_locked:isFnosDistribution(),
    updates_managed_by:isFnosDistribution() ? "fnos" : ""
  };
}

export function assertDistributionSecurityOptions(data: any): void {
  if (!isFnosDistribution()) return;
  if ((data.auth_mode !== undefined && data.auth_mode !== "always")
    || data.lan_auth_enabled === false || data.allow_disable_lan_auth === true
    || data.local_direct_desktop_integration_enabled === true
    || data.manage_user_ssh_keys_enabled === true) {
    throw publicError("FNOS_SECURITY_MANAGED", "飞牛应用必须保持所有访问经过登录验证，且不能启用宿主桌面权限");
  }
}

export function assertDistributionListenSettings(data: any, current: any): void {
  if (!isFnosDistribution()) return;
  const hosts = (value: any) => [...(Array.isArray(value) ? value : String(value).split(/[\s,]+/))].sort().join(",");
  if ((data.listen_port !== undefined && Number(data.listen_port) !== Number(current.listen_port))
    || (data.listen_hosts !== undefined && hosts(data.listen_hosts) !== hosts(current.listen_hosts))) {
    throw publicError("FNOS_LISTEN_MANAGED", "飞牛应用的监听地址和端口由应用包管理");
  }
}
