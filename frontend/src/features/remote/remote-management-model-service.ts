import { endpointProbeReason, vncComponentLabel, vncDiagnosticCopy, vncSourceLabel } from './management-diagnostics';
import type { ManagementAction, ManagementModel, ManagementNotice } from './RemoteManagementView';
import type { RemoteProfile } from './profile-model';
import { normalizedVncClientMode, type RemoteClientMode } from './client-service';
import type { VncDiagnostics, VncSession } from './vnc-types';
import type { GraphicsRenderingDiagnostics } from './graphics-rendering-model';

export interface RemoteManagementDiagnostics {
  management_available?: boolean;
  diagnostics_available?: boolean;
  ssh_connection?: { id?: number; name?: string };
  ssh_error?: string;
  graphics_rendering?: GraphicsRenderingDiagnostics;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export interface RemoteEndpointProbe {
  supported?: boolean;
  ok?: boolean;
  method?: string;
  response?: string;
  responded?: boolean;
  reason_code?: string;
  reason_params?: unknown;
  raw_error?: string;
  error?: string;
}

export interface RdpManagementDiagnostics extends RemoteManagementDiagnostics {
  endpoint_probe?: RemoteEndpointProbe;
  platform_supported?: boolean;
  xrdp_installed?: boolean;
  xrdp_active?: boolean;
  xrdp_listening?: boolean;
  has_desktop?: boolean;
  connection?: { id?: number; name?: string };
}

export interface XdmcpManagementDiagnostics extends RemoteManagementDiagnostics {
  endpoint_probe?: RemoteEndpointProbe;
  ready_for_login?: boolean;
  listening?: boolean;
  enabled?: boolean;
  supported?: boolean;
  platform_unsupported?: boolean;
  replacement_available?: boolean;
  has_x11_session?: boolean;
  usable_sessions?: { id?: string; name?: string }[];
  sessions?: { id?: string; name?: string }[];
  preferred_session?: { id?: string; name?: string };
  resolved_saved_session_label?: string;
  saved_session?: string;
  config_file?: string;
  firewall?: string;
  firewall_managed?: boolean;
  session_conflict?: boolean;
  plasma_display?: string;
  can_uninstall_lightdm?: boolean;
}

export interface VncManagementComponent {
  key?: string;
  label?: string;
  installed?: boolean;
  install_required?: boolean;
  listening?: boolean;
  running?: boolean;
  manual_only?: boolean;
  service_unit?: string;
  service_state?: string;
  listener_process?: string;
}

export interface VncManagementSource {
  display?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface VncManagementDiagnostics extends RemoteManagementDiagnostics, VncDiagnostics, VncManagementComponent {
  status?: string;
  port?: number;
  endpoint_probe?: RemoteEndpointProbe;
  commands?: string[];
  operation_error?: string;
  server_mode?: string;
  source_display?: string;
  source_xrdp?: boolean;
  vnc_process?: string;
  server_session_configurable?: boolean;
  server_session_selection_matches_running?: boolean;
  server_session_selection?: {
    mode?: string; display?: string; component?: string; component_state?: VncManagementComponent;
    requires_selection?: boolean; install_required?: boolean; manual_only?: boolean; source_available?: boolean;
  };
  selected_component?: VncManagementComponent;
  running_component?: VncManagementComponent;
  session_sources?: VncManagementSource[];
  xrdp_software_rendering?: boolean;
  start_plan?: { kind?: string; persistent?: boolean } | null;
  install_plan?: Record<string, unknown>;
}

export interface VncManagementOptions {
  connectionHelp?: boolean;
  serviceAvailable?: boolean;
  detail?: string;
  preflight?: boolean;
  connectionAttempt?: boolean;
  showConnect?: boolean;
  showTemporaryPassword?: boolean;
}

export interface RemoteManagementModelPort {
  tr(key: string, params?: Record<string, unknown>): string;
  endpoint(profile: RemoteProfile): string;
  connection(id: number): { name?: string; ssh_user?: string } | undefined;
  managementConnectionId(profile: RemoteProfile): number;
  authenticationFailure(error: unknown): boolean;
  newManagementConnection(profileId: number): void;
  repairManagementCredentials(profileId: number, protocol: string): void;
  rdpInstallPlan(diagnostics: RemoteManagementDiagnostics): Record<string, unknown> | null;
  rdpActionKey(profileId: number): string;
  rdpInstallServer(profileId: number, key: string, button: HTMLElement, mode: string): void;
  rdpSetupGuide(profileId: number): void;
  rdpServerAction(profileId: number, key: string, action: string, button: HTMLElement): void;
  xdmcpManagerLabel(diagnostics: XdmcpManagementDiagnostics): string;
  xdmcpWarning(diagnostics: XdmcpManagementDiagnostics): string;
  xdmcpAction(diagnostics: XdmcpManagementDiagnostics): { action: string; label: string; icon: string; danger?: boolean } | null;
  xdmcpActionKey(profileId: number): string;
  xdmcpInstallAction(action: string): boolean;
  xdmcpInstallOptions(profileId: number, action: string): void;
  xdmcpConfigure(profileId: number, action: string, button: HTMLElement): void;
  linuxDesktop(profileId: number): void;
  vncActionKey(profileId: number): string;
  vncSaveSource(profileId: number, select: HTMLSelectElement, key: string): void;
  vncSession(key: string): Pick<VncSession, 'workspace'> | undefined;
  vncServerAction(profileId: number, key: string, action: string, button: HTMLElement): void;
  vncInstallServer(profileId: number, key: string, button: HTMLElement, mode: string): void;
  vncSetupGuide(profileId: number): void;
  vncReconnect(profileId: number, key: string): void;
  vncOpenEmbedded(profileId: number, key: string, button: HTMLElement): void;
  launchDesktop(profileId: number, key: string, button: HTMLElement): void;
  vncTemporaryPassword(profileId: number, key: string, button: HTMLElement, mode: RemoteClientMode): void;
  editProfile(profileId: number): void;
  action(id: string, label: string, icon: string, run: (button: HTMLElement) => void, actionKey?: string, className?: string): ManagementAction;
  installModel(
    plan: Record<string, unknown>,
    run: (mode: string, button: HTMLElement) => void,
    manual: (button: HTMLElement) => void,
    actionKey: string
  ): NonNullable<ManagementModel['install']>;
  protocolGuide(protocol: string, diagnostics: RemoteManagementDiagnostics, profile: RemoteProfile): NonNullable<ManagementModel['guide']>;
  renderingModel(diagnostics: RemoteManagementDiagnostics): ManagementModel['rendering'];
}

export function createRemoteManagementModelService(port: RemoteManagementModelPort) {
  function endpointNotice(profile: RemoteProfile, probe: RemoteEndpointProbe = {}): ManagementNotice[] {
    if (!probe.supported) return [];
    const endpoint = port.endpoint({...profile, username: ''});
    const error = endpointProbeReason(probe, port.tr);
    if (probe.method === 'xdmcp-query') {
      const willing = probe.ok && probe.response === 'willing';
      const responded = Boolean(probe.responded);
      return [{
        title: port.tr(willing
          ? 'remote:endpoint_probe.xdmcp_title_willing'
          : responded
            ? 'remote:endpoint_probe.xdmcp_title_rejected'
            : 'remote:endpoint_probe.xdmcp_title_no_response', {
          defaultValue: willing ? 'XDMCP 服务已响应' : 'XDMCP 探测未通过'
        }),
        detail: port.tr(willing
          ? 'remote:endpoint_probe.xdmcp_willing'
          : responded
            ? 'remote:endpoint_probe.xdmcp_rejected'
            : 'remote:endpoint_probe.xdmcp_no_response', {
          endpoint,
          error,
          defaultValue: `${endpoint} · ${error}`
        }),
        tone: willing ? 'success' : responded ? 'error' : 'warning',
        icon: willing ? 'radio-tower' : 'circle-help'
      }];
    }
    return [{
      title: port.tr(probe.ok ? 'remote:endpoint_probe.title_reachable' : 'remote:endpoint_probe.title_unreachable', {
        protocol: String(profile.protocol).toUpperCase(),
        defaultValue: probe.ok ? '端口可达' : '端口不可达'
      }),
      detail: port.tr(probe.ok ? 'remote:endpoint_probe.reachable' : 'remote:endpoint_probe.unreachable', {
        endpoint,
        error,
        defaultValue: `${endpoint} · ${error}`
      }),
      tone: probe.ok ? 'success' : 'error',
      icon: probe.ok ? 'radio-tower' : 'unplug'
    }];
  }

  function unavailableNotice(profile: RemoteProfile, diagnostics: RemoteManagementDiagnostics, protocol: string): ManagementNotice {
    const unlinked = diagnostics.management_available === false
      || diagnostics.diagnostics_available === false && !diagnostics.ssh_connection;
    const repair = !unlinked && port.authenticationFailure({
      code: diagnostics.code,
      message: diagnostics.error || diagnostics.ssh_error
    });
    const detail = unlinked && ['rdp', 'xdmcp'].includes(protocol)
      ? port.tr(`remote:${protocol === 'rdp' ? 'rdp_status' : 'xdmcp_status'}.ssh_management_optional`)
      : String(diagnostics.error || diagnostics.ssh_error || port.tr('remote:diagnostics.ssh_management_optional', {
        protocol: protocol.toUpperCase(),
        defaultValue: '关联 SSH 后可管理远端服务。'
      }));
    return {
      title: port.tr(unlinked ? 'remote:diagnostics.ssh_management_unlinked' : 'remote:diagnostics.ssh_probe_unavailable', {
        defaultValue: unlinked ? '未关联 SSH 管理连接' : 'SSH 深度探测不可用'
      }),
      detail,
      tone: 'warning',
      icon: 'server-off',
      actions: unlinked
        ? [port.action(
          'new-management',
          port.tr('remote:diagnostics.new_ssh_management_connection', {defaultValue: '新建 SSH 管理连接'}),
          'server-cog',
          () => port.newManagementConnection(Number(profile.id || 0))
        )]
        : repair
          ? [port.action(
            'repair-management',
            port.tr('remote:diagnostics.repair_ssh_credentials', {defaultValue: '修复 SSH 管理凭据'}),
            'key-round',
            () => port.repairManagementCredentials(Number(profile.id || 0), protocol)
          )]
          : []
    };
  }

  function rdpManagementModel(diagnostics: RdpManagementDiagnostics, profile: RemoteProfile, key: string): ManagementModel {
    const notices = endpointNotice(profile, diagnostics.endpoint_probe);
    if (diagnostics.error || diagnostics.management_available === false) {
      return {notices: [...notices, unavailableNotice(profile, diagnostics, 'rdp')]};
    }
    const linux = diagnostics.platform_supported !== false;
    const installed = Boolean(diagnostics.xrdp_installed);
    const active = Boolean(diagnostics.xrdp_active);
    const ready = installed && active && Boolean(diagnostics.xrdp_listening);
    const profileId = Number(profile.id || 0);
    const actionKey = port.rdpActionKey(profileId);
    const plan = port.rdpInstallPlan(diagnostics) || {};
    const text = (id: string, fallback: string) => port.tr(`remote:rdp_status.${id}`, {defaultValue: fallback});
    const connection = port.connection(port.managementConnectionId(profile));
    const connectionName = diagnostics.connection?.name || connection?.name
      || port.tr('remote:diagnostics.ssh_management_connection', {defaultValue: 'SSH 管理连接'});
    const detail = `${connectionName} · ${
      !linux
        ? text('non_linux_detail', '')
        : !installed
          ? text('install_hint', '')
          : [
            text(active ? 'service_running' : 'service_stopped', ''),
            text(diagnostics.xrdp_listening ? 'tcp_listening' : 'tcp_not_listening', 'TCP 3389'),
            text(diagnostics.has_desktop ? 'desktop_available' : 'desktop_not_detected', '')
          ].join(' · ')
    }`;
    return {
      notices,
      head: {
        title: text(!linux ? 'non_linux_title' : installed ? 'installed_title' : 'not_installed_title', ''),
        detail,
        icon: !linux ? 'info' : ready ? 'circle-check' : installed ? 'circle-alert' : 'package-x',
        tone: !linux || ready ? 'ready' : 'warning'
      },
      install: linux && !installed
        ? port.installModel(
          plan,
          (mode, button) => port.rdpInstallServer(profileId, key, button, mode),
          () => port.rdpSetupGuide(profileId),
          actionKey
        )
        : undefined,
      meta: linux && installed
        ? [
          {icon: 'package-check', text: text('installed_meta', '')},
          {icon: active ? 'circle-play' : 'circle-stop', text: text(active ? 'service_running' : 'service_stopped', '')},
          {icon: 'radio-tower', text: text(diagnostics.xrdp_listening ? 'port_listening' : 'port_not_listening', '')},
          {icon: 'monitor', text: text(diagnostics.has_desktop ? 'desktop_available' : 'desktop_install_required', '')}
        ]
        : [],
      guide: port.protocolGuide('rdp', diagnostics, profile),
      rendering: port.renderingModel(diagnostics),
      actions: linux && installed
        ? [
          port.action(active ? 'stop' : 'start', text(active ? 'stop_service' : 'start_service', ''), active ? 'circle-stop' : 'circle-play',
            button => port.rdpServerAction(profileId, key, active ? 'stop' : 'start', button), actionKey),
          port.action('uninstall', text('uninstall_service', ''), 'package-minus',
            button => port.rdpServerAction(profileId, key, 'uninstall', button), actionKey, 'danger')
        ]
        : []
    };
  }

  function xdmcpManagementModel(diagnostics: XdmcpManagementDiagnostics, profile: RemoteProfile): ManagementModel {
    if (diagnostics.error) {
      return {notices: [...endpointNotice(profile, diagnostics.endpoint_probe), unavailableNotice(profile, diagnostics, 'xdmcp')]};
    }
    const text = (id: string, fallback = '', params: Record<string, unknown> = {}) => port.tr(`remote:xdmcp_status.${id}`, {...params, defaultValue: fallback});
    const profileId = Number(profile.id || 0);
    const manager = port.xdmcpManagerLabel(diagnostics);
    const ready = Boolean(diagnostics.ready_for_login);
    const action = port.xdmcpAction(diagnostics);
    const actionKey = port.xdmcpActionKey(profileId);
    const state = text(diagnostics.listening ? 'enabled_listening' : diagnostics.enabled ? 'configured_restart_pending' : 'disabled_not_listening');
    const sessions = (diagnostics.usable_sessions || diagnostics.sessions || [])
      .map(item => item.name || item.id).filter((name): name is string => Boolean(name));
    const warning = port.xdmcpWarning(diagnostics);
    const meta: NonNullable<ManagementModel['meta']> = [
      {icon: 'file-cog', text: diagnostics.config_file || text('config_not_detected'), title: text('config_file')},
      {icon: 'shield', text: diagnostics.firewall === 'none' ? text('no_active_firewall')
        : text(diagnostics.firewall_managed ? 'firewall_managed' : 'firewall_auto_open', '', {firewall: diagnostics.firewall}), title: text('firewall_status')}
    ];
    const preferred = diagnostics.preferred_session?.name || diagnostics.preferred_session?.id;
    const saved = diagnostics.resolved_saved_session_label || diagnostics.saved_session;
    if (preferred) meta.push({icon: 'sparkles', text: text('x11_session_available', `X11：${preferred}`, {session: preferred}), title: text('login_desktop_title')});
    if (saved) meta.push({icon: 'user-round-cog', text: text('account_desktop_mapping', '', {session: saved}), title: text('saved_desktop_title')});
    if (diagnostics.session_conflict) meta.push({icon: 'monitor-x', text: text('bound_display', '', {display: diagnostics.plasma_display || text('other_display')}), title: text('plasma_display_title')});
    const notices: ManagementNotice[] = [];
    if (!sessions.length) notices.push({detail: text(diagnostics.platform_unsupported ? 'macos_no_session' : 'no_login_session'), tone: 'warning'});
    if (diagnostics.has_x11_session && diagnostics.supported && !diagnostics.listening) {
      notices.push({detail: text(diagnostics.enabled ? 'pending_restart' : 'pending_enable', '', {manager})});
    }
    if (warning) notices.push({detail: warning, tone: ready ? '' : 'warning'});
    if (!diagnostics.has_x11_session && !diagnostics.platform_unsupported) {
      notices.push({
        detail: port.tr('remote:diagnostics.linux_desktop_missing', {protocol: 'XDMCP', defaultValue: '未检测到可用的 Linux 图形桌面。'}),
        tone: 'warning', icon: 'monitor-off', className: 'linux-desktop-missing-notice',
        actions: [port.action('linux-desktop', port.tr('remote:diagnostics.open_linux_desktop_manager', {defaultValue: '前往 Linux 桌面管理'}), 'monitor-cog', () => port.linuxDesktop(profileId))]
      });
    }
    const actions = action ? [port.action(action.action, action.label, action.icon,
      button => port.xdmcpInstallAction(action.action)
        ? port.xdmcpInstallOptions(profileId, action.action)
        : port.xdmcpConfigure(profileId, action.action, button), actionKey, action.danger ? 'danger' : 'primary')] : [];
    if (diagnostics.can_uninstall_lightdm) {
      actions.push(port.action('uninstall-lightdm', text('uninstall_restore_manager'), 'package-minus',
        button => port.xdmcpConfigure(profileId, 'uninstall-lightdm', button), actionKey, 'danger'));
    }
    return {
      notices,
      head: {
        title: text('display_manager', '', {manager}),
        detail: `${state} · ${diagnostics.ssh_connection?.name || port.tr('remote:diagnostics.ssh_management_connection', {defaultValue: 'SSH 管理连接'})}`,
        icon: ready ? 'circle-check' : 'circle-alert',
        tone: ready ? 'ready' : diagnostics.platform_unsupported || !diagnostics.supported && !diagnostics.replacement_available ? 'error' : 'warning'
      },
      meta, sessions: sessions.length ? {label: text('available_x11_desktops'), names: sessions} : undefined,
      guide: port.protocolGuide('xdmcp', diagnostics, profile), rendering: port.renderingModel(diagnostics), actions
    };
  }

  function vncSourceUnavailable(diagnostics: VncManagementDiagnostics) {
    const selection = diagnostics.server_session_selection;
    if (diagnostics.server_session_configurable !== true || !selection) return '';
    const key = selection.requires_selection ? 'multiple_sources'
      : selection.source_available === false ? (selection.display ? 'selected_display_missing' : 'select_active_display') : '';
    return key ? port.tr(`remote:vnc_status.${key}`, {display: selection.display, defaultValue: ''}) : '';
  }

  function vncSourceManagementModel(profile: RemoteProfile, diagnostics: VncManagementDiagnostics, key: string): ManagementModel['source'] {
    if (String(diagnostics.platform || '').toLowerCase() !== 'linux') return undefined;
    const text = (id: string, params: Record<string, unknown> = {}) => port.tr(`remote:vnc_status.${id}`, {...params, defaultValue: ''});
    const selection = diagnostics.server_session_selection || {};
    const current = diagnostics.server_mode === 'virtual' ? vncComponentLabel(port.tr, 'tigervnc')
      : diagnostics.source_display ? text('running_shared', {display: diagnostics.source_display, suffix: diagnostics.source_xrdp ? text('xrdp_session_suffix') : ''})
        : text(diagnostics.vnc_process ? 'process_source_unknown' : 'no_running_desktop');
    if (diagnostics.server_session_configurable === false) {
      return !diagnostics.server_mode || diagnostics.server_mode === 'unknown' ? undefined
        : {label: text('current_server_source'), current, id: '', value: '', help: text('readonly_source_help')};
    }
    const profileId = Number(profile.id || 0);
    const value = selection.mode === 'virtual' ? 'virtual' : selection.mode === 'shared' && selection.display ? `shared|${selection.display}` : 'auto';
    const component = vncComponentLabel(port.tr, selection.component || selection.component_state?.key || diagnostics.selected_component?.key);
    const warning = selection.requires_selection ? text('multiple_sources')
      : selection.install_required || selection.manual_only ? text(selection.manual_only ? 'component_manual_only' : 'component_install_required', {component})
        : vncSourceUnavailable(diagnostics);
    const sources = (diagnostics.session_sources || []).map(source => ({
      value: `shared|${source.display}`,
      label: vncSourceLabel(port.tr, source) + (source.kind === 'xrdp' && diagnostics.xrdp_software_rendering ? text('java_gui_risk_suffix') : '')
    }));
    if (value.startsWith('shared|') && !sources.some(source => source.value === value)) {
      sources.push({value, label: text('selected_display_missing', {display: selection.display})});
    }
    return {
      label: text('current_running_source'), current, target: text('target_desktop_source'),
      id: `vnc_server_session_source_${profileId}`, value, help: text('source_help'), warning,
      actionKey: port.vncActionKey(profileId),
      options: [
        {value: 'auto', label: text('source_auto')},
        ...sources,
        {value: 'virtual', label: vncComponentLabel(port.tr, 'tigervnc')}
      ],
      change: select => port.vncSaveSource(profileId, select, key)
    };
  }

  function vncManagementModel(profile: RemoteProfile, diagnostics: VncManagementDiagnostics = {}, key: string, options: VncManagementOptions = {}): ManagementModel {
    const text = (id: string, params: Record<string, unknown> = {}) => port.tr(`remote:vnc_status.${id}`, {...params, defaultValue: ''});
    const selection = diagnostics.server_session_selection || {};
    const component = diagnostics.selected_component || selection.component_state;
    const scoped = diagnostics.server_session_configurable === true && Boolean(component);
    const missing = scoped && (selection.install_required === true || component?.install_required === true);
    const status = scoped ? missing ? 'not-installed' : component?.listening ? 'ready' : component?.running ? 'not-listening' : component?.installed ? 'stopped' : 'not-installed'
      : String(diagnostics.status || '').toLowerCase();
    const installed = scoped ? component?.installed === true : Boolean(diagnostics.installed || diagnostics.service_unit || diagnostics.commands?.length);
    const running = scoped ? component?.listening === true && diagnostics.server_session_selection_matches_running !== false
      : Boolean(options.serviceAvailable || diagnostics.listening || ['ready', 'reachable'].includes(status));
    const macos = String(diagnostics.platform || '').toLowerCase() === 'macos';
    const pending = diagnostics.server_session_configurable === true && diagnostics.server_session_selection_matches_running === false;
    const unavailableSource = vncSourceUnavailable(diagnostics);
    const ready = running && !unavailableSource && !pending;
    const componentLabel = vncComponentLabel(port.tr, component?.key || selection.component, component?.label);
    const connectionAttempt = options.connectionAttempt === true;
    const diagnosticCopy = () => vncDiagnosticCopy(port.tr, diagnostics, options.serviceAvailable, options.detail, options);
    const copy = connectionAttempt ? diagnosticCopy() : missing ? {
      title: text('component_not_installed', {component: componentLabel}),
      summary: text(component?.manual_only || selection.manual_only ? 'component_manual_only' : 'component_install_required', {component: componentLabel})
    } : unavailableSource ? {title: unavailableSource, summary: ''}
      : pending ? {title: text('selection_pending_title'), summary: text('selection_pending_summary')}
      : options.preflight && ready ? {title: text('ready_title'), summary: text('ready_summary')}
        : diagnosticCopy();
    const profileId = Number(profile.id || 0);
    const actionKey = port.vncActionKey(profileId);
    const mode = normalizedVncClientMode(profile.options);
    const embedded = mode === 'embedded';
    const active = port.vncSession(key);
    const actions: ManagementAction[] = [];
    const serviceAction = (action: string, label: string, icon: string, className = '') => port.action(action, label, icon,
      button => port.vncServerAction(profileId, key, action, button), actionKey, className);
    if ((options.serviceAvailable || diagnostics.listening) && diagnostics.start_plan && pending) {
      actions.push(serviceAction('restart', text('apply_source_restart'), 'refresh-cw', 'primary'));
    }
    const needsStart = ['stopped', 'not-listening', 'blocked'].includes(status) && diagnostics.start_plan;
    if (needsStart) {
      const label = status === 'blocked' ? 'allow_and_start' : diagnostics.start_plan?.kind === 'service' ? 'start_vnc'
        : diagnostics.start_plan?.kind === 'tigervnc-systemd' ? 'configure_tigervnc' : 'configure_and_start';
      actions.push(serviceAction('start', text(label), 'play', 'primary'));
    }
    if (installed && !macos) {
      if (running || !needsStart && diagnostics.start_plan) actions.push(serviceAction(running ? 'stop' : 'start', text(running ? 'stop_service' : 'start_service'), running ? 'circle-stop' : 'circle-play'));
      actions.push(serviceAction('change-password', text('change_password'), 'key-round'), serviceAction('uninstall', text('uninstall_service'), 'package-minus', 'danger'));
    }
    if (!options.preflight) actions.push(port.action('setup', port.tr('remote:auto.manual_install', {defaultValue: '手动安装/配置说明'}), 'book-open-check', () => port.vncSetupGuide(profileId)));
    if (options.showConnect !== false) {
      const label = active?.workspace || !options.preflight && !running ? 'remote:vnc_status.reconnect'
        : embedded ? 'remote:actions.open_embedded_vnc' : mode === 'bundled' || mode === 'auto' ? 'remote:actions.open_bundled_tigervnc' : 'remote:vnc_status.open_system_client';
      actions.push(port.action('connect', port.tr(label, {defaultValue: '打开远程桌面'}), 'monitor', button => embedded
        ? active?.workspace ? port.vncReconnect(profileId, key) : port.vncOpenEmbedded(profileId, key, button)
        : port.launchDesktop(profileId, key, button), '', 'primary'));
    }
    if (!embedded && options.showTemporaryPassword !== false) actions.push(port.action('temporary-password', port.tr('remote:vnc_ui.use_other_password', {defaultValue: '本次使用其他密码'}), 'key-round', button => port.vncTemporaryPassword(profileId, key, button, mode)));
    if (!options.preflight) actions.push(port.action('settings', port.tr('remote:actions.connection_settings', {defaultValue: '连接设置'}), 'settings-2', () => port.editProfile(profileId)));
    const notices: ManagementNotice[] = [];
    if (diagnostics.operation_error) notices.push({detail: String(diagnostics.operation_error), tone: 'error', icon: 'circle-alert'});
    if (macos) {
      for (const id of ['macos_settings_path', 'macos_step_enable', 'macos_step_account', 'macos_step_password', 'macos_legacy_path']) notices.push({detail: text(id)});
    } else notices.push({title: text('check_items'), detail: text('check_items_value', {port: Number(diagnostics.port || profile.port || 5900)})});
    if (['shared-x11', 'shared-wayland'].includes(String(diagnostics.server_mode).toLowerCase()) && !embedded) notices.push({detail: text('shared_tigervnc_clipboard_hint'), tone: 'warning'});
    const service = diagnostics.running_component || diagnostics.selected_component || diagnostics;
    const meta: NonNullable<ManagementModel['meta']> = [];
    if (service.service_unit || diagnostics.service_unit) meta.push(
      {icon: 'server-cog', text: text('service_unit', {unit: service.service_unit || diagnostics.service_unit})},
      {icon: 'activity', text: text('service_state', {state: service.service_state || diagnostics.service_state || text('unknown')})}
    );
    const listener = String(service.listener_process || diagnostics.listener_process || '');
    if (listener) meta.push({icon: 'radio-tower', title: listener, text: text('listener', {process: listener.match(/(?:^|\/)\b(Xtigervnc|Xvnc|x11vnc|wayvnc|gnome-remote-desktop)\b/i)?.[1] || text('listener_process')})});
    if (diagnostics.start_plan?.persistent) meta.push({icon: 'power', text: text('managed_persistent')});
    return {
      className: 'remote-service-state vnc-connection-help-panel',
      head: {title: copy.title, detail: copy.summary, icon: connectionAttempt ? 'monitor-off' : ready ? 'circle-check' : missing ? 'package-x' : 'monitor-off', tone: connectionAttempt || missing ? 'error' : ready ? 'ready' : 'warning'},
      notices, meta, source: vncSourceManagementModel(profile, diagnostics, key),
      install: (missing || status === 'not-installed' || ['stopped', 'not-listening'].includes(status) && !diagnostics.start_plan && !installed) && !macos
        ? port.installModel(diagnostics.install_plan || {}, (mode, button) => port.vncInstallServer(profileId, key, button, mode), () => port.vncSetupGuide(profileId), actionKey) : undefined,
      rendering: port.renderingModel(diagnostics), actions
    };
  }

  function state(protocol: 'rdp' | 'xdmcp' | 'vnc', diagnostics: RemoteManagementDiagnostics,
    profile: RemoteProfile, key: string, options: VncManagementOptions = {}): ManagementModel {
    if (protocol === 'rdp') return rdpManagementModel(diagnostics, profile, key);
    if (protocol === 'xdmcp') return xdmcpManagementModel(diagnostics, profile);
    const vnc: VncManagementDiagnostics = diagnostics;
    if (options.connectionHelp) return vncManagementModel(profile, vnc, key, options);

    const notices = endpointNotice(profile, vnc.endpoint_probe);
    const unavailable = (vnc.error && !vnc.status) || (vnc.diagnostics_available === false && !vnc.ssh_connection);
    if (unavailable) return {notices: [...notices, unavailableNotice(profile, vnc, 'vnc')]};
    if (vnc.status === 'ssh-unreachable' || vnc.status === 'probe-failed') notices.push(unavailableNotice(profile, vnc, 'vnc'));
    const model = vncManagementModel(profile, vnc, key, options);
    return {...model, notices: [...notices, ...(model.notices || [])]};
  }

  return {state, endpointNotice, unavailableNotice, rdp: rdpManagementModel, xdmcp: xdmcpManagementModel, vncSource: vncSourceManagementModel, vnc: vncManagementModel};
}
