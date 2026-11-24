import type {RemoteClientDiagnostics, RemoteClientItem, RemoteClientProtocol} from './client-service';
import type {RemoteDesktopPrepareOptions, RemoteDesktopPrepareResult} from './remote-desktop-service';
import type {RemoteDesktopLaunchState} from './RemoteDesktopViews';

type Translate = (key: string, params?: Record<string, unknown>) => string;

const clientLabels: Record<string, string> = {
  '远程桌面连接': 'windows_remote_desktop',
  '屏幕共享': 'macos_screen_sharing',
  '系统 VNC 客户端': 'system_vnc',
  'Terma 内置 VNC': 'terma_embedded_vnc',
  'Terma 内置 X Server': 'terma_embedded_xserver',
  'Terma 内置 XDMCP（XQuartz）': 'terma_embedded_xdmcp_xquartz',
  'Terma XDMCP（Xephyr）': 'terma_xdmcp_xephyr'
};
const installLabels: Record<string, string> = {
  '安装 Windows App': 'install_windows_app',
  '安装 FreeRDP': 'install_freerdp',
  '安装 XQuartz': 'install_xquartz',
  '安装 Xephyr': 'install_xephyr'
};
const clientReasons: Record<string, string> = {
  '未找到 FreeRDP 或 Remmina': 'reason_rdp_missing',
  '当前 Terma 没有可用的图形桌面 DISPLAY': 'reason_display_missing',
  '未找到系统 VNC 客户端': 'reason_vnc_missing',
  '未检测到可用的 XDMCP X Server': 'reason_xdmcp_xserver_missing',
  '未检测到 VcXsrv、Xming、X410 或 DISPLAY': 'reason_windows_xserver_missing',
  '已找到 X Server，但尚未运行': 'reason_xserver_not_running',
  '未安装 XQuartz': 'reason_xquartz_missing',
  '已安装 XQuartz，但尚未运行': 'reason_xquartz_not_running'
};

export function createRemoteDesktopPresentation(tr: Translate) {
  function localizedCopy(labels: Record<string, string>, value: unknown) {
    const raw = String(value || '').trim();
    const key = Object.hasOwn(labels, raw) ? labels[raw] : '';
    return key ? tr(`remote:clients.${key}`, {defaultValue: raw}) : raw;
  }
  const clientLabel = (value: unknown, protocol: RemoteClientProtocol) => localizedCopy(clientLabels, value) || protocol.toUpperCase();
  const installLabel = (value: unknown, protocol: RemoteClientProtocol) => localizedCopy(installLabels, value)
    || tr('remote:auto.install_client_for', {protocol: protocol.toUpperCase()});
  function reason(item: RemoteClientItem, diagnostics: RemoteClientDiagnostics, protocol: RemoteClientProtocol) {
    const protocolLabel = protocol.toUpperCase();
    if (diagnostics.authorization_required) return tr('remote:clients.authorization_required', {protocol: protocolLabel});
    if (item.reason_code === 'vnc_client_selection_required') return tr('remote:clients.reason_vnc_selection_required');
    return localizedCopy(clientReasons, item.reason || diagnostics.message)
      || tr('remote:capabilities.client_missing', {client: protocolLabel});
  }
  function statusText(protocol: RemoteClientProtocol, options: RemoteDesktopPrepareOptions, result: RemoteDesktopPrepareResult) {
    const {item, serverState, diagnostics} = result;
    const detected = (client: string) => tr('remote:capabilities.client_detected', {client});
    const client = clientLabel(item.client, protocol);
    if (options.embeddedVnc) return detected(tr('remote:clients.terma_embedded_vnc'));
    if (options.managedVnc) {
      if (options.vncClientMode === 'auto') {
        if (serverState.server_mode === 'shared-x11' || serverState.server_mode === 'shared-wayland') {
          return tr('remote:capabilities.shared_desktop_tigervnc_hint');
        }
        return item.bundled_available ? detected(client) : tr('remote:capabilities.bundled_unavailable_fallback');
      }
      if (options.vncClientMode === 'bundled') {
        return item.bundled_available ? detected(tr('remote:capabilities.bundled_tigervnc'))
          : tr('remote:capabilities.bundled_tigervnc_unavailable');
      }
      if (options.vncClientMode === 'system') {
        const system = item.system && typeof item.system === 'object' ? item.system as RemoteClientItem : undefined;
        return item.system_available ? detected(clientLabel(system?.client, protocol))
          : reason(system || item, diagnostics, protocol);
      }
    }
    return item.available ? detected(client) : reason(item, diagnostics, protocol);
  }
  function launchAction(protocol: RemoteClientProtocol, result: RemoteDesktopPrepareResult) {
    if (protocol !== 'xdmcp') return {disabled: !result.launchAllowed || !result.rdpEndpointReady || result.vncServiceBlocked};
    const {launchAllowed, serverState} = result;
    let titleKey = 'remote:xdmcp_status.not_safe_to_start';
    if (!launchAllowed) titleKey = 'remote:xdmcp_status.client_required';
    else if (serverState.error) titleKey = 'remote:xdmcp_status.probe_unavailable_launch_anyway';
    else if (serverState.ready_for_login) titleKey = 'remote:actions.new_graphical_login';
    return {disabled: !launchAllowed || (!serverState.error && !serverState.ready_for_login), title: tr(titleKey)};
  }
  function status(protocol: RemoteClientProtocol, options: RemoteDesktopPrepareOptions, result: RemoteDesktopPrepareResult): RemoteDesktopLaunchState {
    return {
      statusClass: result.statusAvailable ? 'success' : result.clientLaunchable ? 'warning' : 'error',
      statusText: statusText(protocol, options, result),
      clientAvailable: result.launchAllowed,
      actions: {
        remoteDesktopInstallButton: {hidden: !result.item.can_install, label: installLabel(result.item.install_label, protocol)},
        remoteDesktopXServerButton: {hidden: !result.item.requires_xserver,
          label: tr(result.item.xserver_installed ? 'remote:auto.start_xquartz' : 'remote:auto.install_xquartz')},
        remoteDesktopLaunchButton: launchAction(protocol, result)
      }
    };
  }
  return {status, reason};
}
