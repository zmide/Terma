import type {RemoteEndpointProbe, RemoteManagementDiagnostics, VncManagementDiagnostics, VncManagementOptions, VncManagementSource, XdmcpManagementDiagnostics} from './remote-management-model-service';

type Translate = (key: string, params?: Record<string, unknown>) => string;
type InstallPlan = Record<string, unknown>;
interface RdpInstallDiagnostics extends RemoteManagementDiagnostics {
  rdp_install_plan?: InstallPlan;
  install_plan?: InstallPlan;
  package_plan?: InstallPlan & {install_plan?: InstallPlan};
}
interface XdmcpDiagnosticDetails extends XdmcpManagementDiagnostics {
  action?: string;
  required_action?: string;
  manager?: string;
  manager_label?: string;
  manager_version?: string;
  warning?: string;
  privileged?: boolean;
  matching_local_graphical_sessions?: unknown[];
  matching_remote_graphical_sessions?: unknown[];
  login_user?: string;
  root_plasma_risk?: boolean;
  session_needs_repair?: boolean;
  gdm_xdmcp_capable?: boolean;
  rdp_install_plan?: InstallPlan;
  package_plans?: Record<string, InstallPlan>;
}
interface XdmcpAction { action: string; label: string; icon: string; danger?: boolean }

export function vncServerReady(diagnostics: VncManagementDiagnostics = {}) {
  const selection = diagnostics?.server_session_selection || {};
  const selectedComponent = diagnostics?.selected_component || selection.component_state || null;
  if (diagnostics?.server_session_configurable === true) {
    if (selection.requires_selection || selection.source_available === false || diagnostics?.server_session_selection_matches_running === false) return false;
    if (selectedComponent) return selectedComponent.install_required !== true && selectedComponent.listening === true;
  }
  const status = String(diagnostics?.status || "").toLowerCase();
  return diagnostics?.listening === true || ["ready", "reachable"].includes(status);
}

export function classifyVncFailure(detail: string) {
  const value = String(detail || '').trim();
  const unsupported = value.match(/Unsupported security types\s*\(types:\s*([^)]*)\)/i);
  if (unsupported) return {kind:'unsupported-security', types:String(unsupported[1] || '').trim()} as const;
  if (/Too many security failures/i.test(value)) return {kind:'too-many-security-failures'} as const;
  return {kind:'generic'} as const;
}

const vncFailureTitleKeys = {
  'unsupported-security':'remote:vnc_status.unsupported_security_title',
  'too-many-security-failures':'remote:vnc_status.too_many_security_failures_title',
  generic:'remote:vnc_status.connection_failed_title'
} as const;

export function vncFailureTitleKey(detail: string) {
  return vncFailureTitleKeys[classifyVncFailure(detail).kind];
}

function vncConnectionCopy(detail: string, tr: Translate) {
  const failure = classifyVncFailure(detail), title = tr(vncFailureTitleKeys[failure.kind]);
  if (failure.kind === 'unsupported-security') return {title, summary:tr('remote:vnc_status.unsupported_security_summary', {types:failure.types})};
  if (failure.kind === 'too-many-security-failures') return {title, summary:tr('remote:vnc_status.too_many_security_failures_summary')};
  const raw = String(detail || '').trim();
  const reason = String(raw.match(/reason:\s*(.*?)\)?\s*$/i)?.[1] || raw).trim();
  return {title, summary:reason ? tr('remote:vnc_status.connection_failed_with_detail', {detail:reason}) : tr('remote:vnc_status.connection_failed_summary')};
}

export function vncDiagnosticCopy(tr: Translate, diagnostics?: VncManagementDiagnostics | null, available = false, detail = '', options: VncManagementOptions = {}) {
  if (options.connectionAttempt === true) return vncConnectionCopy(detail, tr);
  const status = String(diagnostics?.status || '').toLowerCase();
  const text = (key: string) => tr(`remote:vnc_status.${key}`);
  const copy = (key: string, summary = `${key}_summary`) => ({title:text(`${key}_title`), summary:text(summary)});
  if (available || status === 'ready' || status === 'reachable') return copy('accessible');
  if (diagnostics?.diagnostics_available === false || status === 'unknown' || status === 'unmanaged') return copy('probe_unavailable', 'probe_unavailable_connection_summary');
  if (String(diagnostics?.platform || '').toLowerCase() === 'macos') return copy('macos_disabled');
  if (status === 'not-installed') return copy('not_installed');
  if (status === 'not-listening') return copy('not_listening');
  if (status === 'stopped' || status === 'blocked') return copy(status);
  if (status === 'ssh-unreachable' || status === 'probe-failed') return copy('probe_unavailable');
  const failure = /ECONNREFUSED|refused|拒绝/i.test(detail) ? 'refused'
    : /ETIMEDOUT|timeout|超时/i.test(detail) ? 'timeout'
      : /ENOTFOUND|EAI_AGAIN|resolve|解析/i.test(detail) ? 'resolve' : 'unreachable';
  return {title:text('unavailable_title'), summary:text(`failure_${failure}`)};
}

export function vncComponentLabel(tr: Translate, component = '', fallback = '') {
  const key = String(component || '').toLowerCase();
  if (key === 'x11vnc') return tr('remote:vnc_status.component_x11vnc');
  if (key === 'tigervnc') return tr('remote:vnc_status.component_tigervnc');
  return String(fallback || '') || tr('remote:vnc_status.component_selected');
}

export function vncSourceLabel(tr: Translate, source: VncManagementSource) {
  const key = source.kind === 'xrdp' ? 'source_xrdp' : source.kind === 'physical' ? 'source_physical' : 'source_x11';
  const display = source.display || tr('remote:vnc_status.unknown_display');
  return `${tr(`remote:vnc_status.${key}`)} ${[display, source.user, source.desktop].filter(Boolean).join(' · ')}`;
}

export function rdpInstallPlan(diagnostics: RdpInstallDiagnostics = {}) {
  return diagnostics.rdp_install_plan || diagnostics.install_plan || diagnostics.package_plan?.install_plan || diagnostics.package_plan || null;
}

export function xdmcpServerAction(diagnostics: XdmcpDiagnosticDetails, tr: Translate): XdmcpAction | null {
  if (diagnostics.action === "manual" && diagnostics.required_action && diagnostics.required_action !== "manual") {
    const authorized = xdmcpServerAction({...diagnostics, action:diagnostics.required_action, privileged:true}, tr);
    return authorized ? {...authorized, label:tr("remote:xdmcp_status.after_temporary_authorization", {action:authorized.label, defaultValue:`临时授权后${authorized.label}`})} : null;
  }
  if (diagnostics.action === "cleanup-sessions") return {action:"cleanup-sessions", label:tr("remote:xdmcp_status.end_conflicting_sessions", {defaultValue:"结束冲突会话"}), icon:"monitor-x", danger:true};
  if (diagnostics.action === "repair-xrdp") return {action:"repair-xrdp", label:tr("remote:xdmcp_status.repair_rdp_session", {defaultValue:"修复 RDP 会话"}), icon:"wrench", danger:true};
  if (diagnostics.action === "install-xfce") return {action:"install-xfce", label:tr("remote:xdmcp_status.install_compatible_desktop", {defaultValue:"安装兼容桌面"}), icon:"package-plus", danger:true};
  if (diagnostics.action === "repair-session") return {action:"repair-session", label:tr("remote:xdmcp_status.repair_default_desktop", {defaultValue:"修复默认桌面"}), icon:"wand-sparkles", danger:true};
  if (diagnostics.listening) return {action:"disable", label:tr("remote:xdmcp_status.close_xdmcp", {defaultValue:"关闭 XDMCP"}), icon:"circle-stop", danger:true};
  if (diagnostics.action === "install-lightdm") return {action:"install-lightdm", label:tr("remote:xdmcp_status.install_switch_lightdm", {defaultValue:"安装并切换 LightDM"}), icon:"package-plus", danger:true};
  if (diagnostics.action === "enable") return {action:"enable", label:tr("remote:xdmcp_status.enable_service", {defaultValue:"启用 XDMCP 服务"}), icon:"power", danger:true};
  if (diagnostics.action === "restart") return {action:"enable", label:tr("remote:xdmcp_status.apply_restart", {defaultValue:"应用并重启"}), icon:"refresh-cw", danger:true};
  return null;
}

export function xdmcpInstallPlan(diagnostics: XdmcpDiagnosticDetails, action: string) {
  const key = action === "install-xfce" ? "xfce" : action === "install-rdp" ? "rdp" : "lightdm";
  return diagnostics?.package_plans?.[key] || (key === "rdp" ? diagnostics?.rdp_install_plan : null) || null;
}

export function xdmcpInstallAction(action: string) {
  return ["install-lightdm", "install-xfce", "install-rdp"].includes(String(action || ""));
}

export function xdmcpManagerLabel(diagnostics: XdmcpDiagnosticDetails, tr: Translate) {
  const raw = String(diagnostics.manager_label || "").trim();
  return !raw || raw === "未知" ? tr("remote:xdmcp_status.unknown_manager", {defaultValue:"未知"}) : raw;
}

export function xdmcpWarning(diagnostics: XdmcpDiagnosticDetails, tr: Translate) {
  const raw = String(diagnostics.warning || "").trim();
  if (!raw) return "";
  if (diagnostics.platform_unsupported) return tr("remote:xdmcp_status.warning_macos", {defaultValue:"macOS 不提供可由 Terma 配置的 XDMCP 图形登录服务。请使用 VNC 共享桌面，或通过 SSH X11 打开单个图形程序。"});
  if (!diagnostics.privileged && diagnostics.action === "manual") return tr("remote:xdmcp_status.warning_privilege", {defaultValue:"当前 SSH 管理账号没有 root 或免密 sudo 权限。可点击操作按钮输入一次性管理员账号、密码、私钥或 SSH Agent，也可以在终端中手动执行。"});
  if (diagnostics.session_conflict) {
    const localSessions = Array.isArray(diagnostics.matching_local_graphical_sessions) ? diagnostics.matching_local_graphical_sessions : [];
    const remoteSessions = Array.isArray(diagnostics.matching_remote_graphical_sessions) ? diagnostics.matching_remote_graphical_sessions : [];
    const display = diagnostics.plasma_display || "";
    if (localSessions.length) return tr("remote:xdmcp_status.warning_local_conflict", {user:diagnostics.login_user || tr("remote:xdmcp_status.current_management_account", {defaultValue:"当前管理账号"}), display, defaultValue:`账号 ${diagnostics.login_user || "当前管理账号"} 已在本地桌面运行 Plasma（${display}），同账号再次登录 XDMCP 可能只显示壁纸。请先注销本地桌面或改用另一个账号。`});
    return tr("remote:xdmcp_status.warning_remote_conflict", {count:remoteSessions.length, display, defaultValue:`检测到 ${remoteSessions.length} 个同账号远程图形会话，Plasma 仍绑定在 ${display}；可先结束这些会话，再启动新的 XDMCP 桌面。`});
  }
  if (diagnostics.root_plasma_risk) return tr("remote:xdmcp_status.warning_root_plasma", {defaultValue:"当前使用 root 账号启动 Plasma X11，KDE 会话容易因 DBus/KDE 运行时冲突黑屏。建议安装并切换到 XFCE 等轻量 X11 会话，或使用普通桌面账号。"});
  if (!diagnostics.has_x11_session) {
    if (diagnostics.listening) return tr("remote:xdmcp_status.warning_no_desktop_listening", {defaultValue:"XDMCP 已启用且 UDP 177 正在监听，但远端没有可启动的 X11 桌面会话；直接登录通常会得到黑屏。请先安装 XFCE、Plasma X11 或其他 X11 桌面。"});
    if (diagnostics.enabled) return tr("remote:xdmcp_status.warning_no_desktop_enabled", {defaultValue:"XDMCP 配置已经写入，但 UDP 177 尚未监听；同时远端没有可启动的 X11 桌面会话。请先安装桌面，再应用并重启显示管理器。"});
    return tr("remote:xdmcp_status.warning_no_desktop_disabled", {defaultValue:"XDMCP 尚未启用、UDP 177 未监听，并且远端没有可启动的 X11 桌面会话。请先安装桌面，再启用 XDMCP 服务。"});
  }
  if (diagnostics.session_needs_repair) return tr("remote:xdmcp_status.warning_session_repair", {session:diagnostics.saved_session || "default", preferred:diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || "", defaultValue:`管理账号保存的桌面会话 ${diagnostics.saved_session || "default"} 无法启动完整桌面，可由 Terma 自动改为 ${diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || ""}。`});
  const manager = String(diagnostics.manager || "").toLowerCase();
  if (manager === "sddm") return tr("remote:xdmcp_status.warning_sddm", {defaultValue:"当前 SDDM 不提供 XDMCP 服务端；Debian/Ubuntu 可安装并切换 LightDM。"});
  if (manager === "gdm" && !diagnostics.gdm_xdmcp_capable) return tr("remote:xdmcp_status.warning_gdm", {version:diagnostics.manager_version ? ` ${diagnostics.manager_version}` : "", defaultValue:`当前 GDM${diagnostics.manager_version ? ` ${diagnostics.manager_version}` : ""} 不提供可用的 XDMCP 服务端；GDM 50 起已移除该能力，Debian/Ubuntu 可安装并切换 LightDM。`});
  if (manager === "unknown" || manager === "xdm") return tr("remote:xdmcp_status.warning_manager_unsupported", {defaultValue:"当前显示管理器无法由 Terma 自动配置。"});
  if (raw === "XDMCP 不加密，只应在可信局域网使用。" || diagnostics.ready_for_login) return tr("remote:xdmcp_status.security_warning", {defaultValue:"XDMCP 不加密，只应在可信局域网使用。"});
  return raw;
}

const endpointCodes = new Set([
  'tcp_reachable', 'tcp_target_invalid', 'tcp_timeout',
  'tcp_failed', 'probe_request_failed', 'xdmcp_target_invalid',
  'host_resolution_failed', 'xdmcp_no_response', 'xdmcp_udp_failed',
  'xdmcp_response_invalid', 'xdmcp_version_unsupported', 'xdmcp_willing',
  'xdmcp_login_rejected', 'xdmcp_opcode_unexpected', 'xdmcp_send_failed',
  'xdmcp_broadcast_probe_unsupported', 'protocol_probe_unsupported'
]);

export function endpointProbeFailure(error: unknown, method: 'tcp' | 'xdmcp-query') {
  const failure = error as {preserveMessage?: boolean; publicCode?: string; message?: string} | undefined;
  const raw = failure?.preserveMessage === true || !failure?.publicCode ? String(failure?.message || '') : '';
  return {
    supported: true, method, ok: false,
    ...(method === 'xdmcp-query' ? {responded: false, response: ''} : {}),
    reason_code: 'probe_request_failed', reason_params: {}, raw_error: raw, error: raw
  };
}

export function endpointProbeReason(probe: RemoteEndpointProbe, tr: Translate) {
  const code = String(probe?.reason_code || '').trim();
  const params = probe?.reason_params;
  const values = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
  // Use only expected interpolation inputs from the server, never translation options.
  const reason = endpointCodes.has(code) ? tr(`remote:endpoint_probe.reasons.${code}`, {
    version: String(values.version ?? ''), opcode: String(values.opcode ?? ''), protocol: String(values.protocol ?? '')
  }) : '';
  const raw = String(probe?.raw_error || '').trim();
  const detail = raw || (code ? '' : String(probe?.error || '').trim());
  return reason && detail && reason !== detail ? tr('remote:endpoint_probe.reason_with_detail', {reason, detail}) : reason || detail;
}
