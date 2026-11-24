import type { ManagementModel, ManagementOptions } from './RemoteManagementView';
import type { RemoteProfile } from './profile-model';
import type { RemoteSetupGuideModel, RemoteSetupGuideOptions } from './RemoteSetupGuide';
import type {
  RemoteManagementDiagnostics, RemoteManagementModelPort, RdpManagementDiagnostics,
  XdmcpManagementDiagnostics, VncManagementDiagnostics
} from './remote-management-model-service';

type InstallPlan = Record<string, unknown>;
type InstallModel = NonNullable<ManagementModel['install']>;
type ManualModel = NonNullable<ManagementModel['manual']>;
export type RemoteGuideProtocol = 'rdp' | 'vnc' | 'xdmcp';
export interface ManagedInstallGuidePresentation {
  show(options: ManagementOptions): void;
  close(): void;
  refresh(): void;
  syncActions(key: string): void;
  read(): Promise<RemoteManagementDiagnostics | null>;
  authenticationFailure(error: {code?: unknown; message?: unknown}): boolean;
  repair(): unknown;
}

export interface ManualInstallOptions {
  commands?: string[]; steps?: unknown[]; note?: unknown; open?: boolean;
}
export interface RdpGuideDiagnostics extends RdpManagementDiagnostics {
  package_manager?: string;
  connection?: { id?: number; name?: string; ssh_user?: string };
}
export interface XdmcpGuideDiagnostics extends XdmcpManagementDiagnostics {
  os_id?: string; os_like?: string; needs_desktop_install?: boolean; root_plasma_risk?: boolean;
  required_action?: string; action?: string; package_manager?: string;
}
export interface VncGuideDiagnostics extends VncManagementDiagnostics {
  guide?: { title?: unknown; summary?: unknown; steps?: unknown[]; commands?: string[] };
}
export interface DesktopGuideDiagnostics {
  connection?: { name?: string }; package_manager?: string;
  desktop_install_plans?: Record<string, InstallPlan>;
}
export interface RemoteInstallGuidePort extends Pick<RemoteManagementModelPort,
  'tr' | 'action' | 'connection' | 'endpoint' | 'managementConnectionId' | 'rdpInstallPlan' | 'rdpActionKey'
  | 'rdpInstallServer' | 'rdpServerAction' | 'xdmcpManagerLabel' | 'xdmcpWarning'
  | 'xdmcpInstallAction' | 'xdmcpActionKey' | 'vncActionKey' | 'vncInstallServer' | 'vncServerAction'> {
  copy(text: string): Promise<unknown>;
  notify(message: string, kind: string): void;
  actionInFlight(key: string): boolean;
  safeTaskText(value: unknown, fallback?: string): string;
  localizeTaskText(value: unknown): string;
  openLinuxDesktop(connectionId: number): void;
  xdmcpInstallPlan(diagnostics: XdmcpGuideDiagnostics, action: string): InstallPlan | null;
  xdmcpConfigure(profileId: number, action: string, button: HTMLElement, mode?: string): void;
  xdmcpSetupTerminal(connectionId: number, command: string): void;
  vncServerReady(diagnostics: VncGuideDiagnostics): boolean;
  vncSessionKey(profileId: number): string;
  desktopLabel(desktopId: string): string;
  desktopActionKey(connectionId: number): string;
  installDesktop(desktopId: string, mode: string, button: HTMLElement): void;
}

// Some older backends report a missing component without supplying a package plan.
function legacyXdmcpInstallCommand(diagnostics: XdmcpGuideDiagnostics, desktopMissing: boolean, managerMissing: boolean) {
  if (diagnostics.platform_unsupported || !desktopMissing && !managerMissing) return '';
  switch (String(diagnostics.package_manager || '').toLowerCase()) {
    case 'apt':
      return desktopMissing ? 'sudo apt-get update && sudo apt-get install -y xfce4 dbus-x11'
        : 'sudo apt-get update && sudo apt-get install -y lightdm lightdm-gtk-greeter';
    case 'dnf':
      return desktopMissing ? 'sudo dnf group install -y "Xfce" && sudo dnf install -y dbus-x11'
        : 'sudo dnf install -y lightdm lightdm-gtk-greeter';
    case 'pacman':
      return desktopMissing ? 'sudo pacman -S --noconfirm xfce4 dbus'
        : 'sudo pacman -S --noconfirm lightdm lightdm-gtk-greeter';
    default:
      return '';
  }
}

const installModePresentation = {
  online: {icon: 'cloud-download', key: 'online'},
  'local-offline': {icon: 'hard-drive-download', key: 'local_offline'},
  offline: {icon: 'database-zap', key: 'remote_cache'},
  manual: {icon: 'book-open-check', key: 'manual'}
} as const;

export type RemoteInstallMode = keyof typeof installModePresentation;
const installModes = Object.keys(installModePresentation) as RemoteInstallMode[];

function asPlan(value: unknown): InstallPlan {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InstallPlan : {};
}

export function revealInstallManual(button: HTMLElement) {
  const details = button.closest?.('.remote-install-modes')?.parentElement
    ?.querySelector<HTMLDetailsElement>(':scope > .remote-install-manual');
  if (!details) return;
  details.open = true;
  details.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}

export function createRemoteInstallGuideService(port: RemoteInstallGuidePort) {
  function vncGuideText(value: unknown, fallback = '') {
    const {key, params: rawParams} = asPlan(value);
    if (typeof key !== 'string' || !key) return port.localizeTaskText(value) || fallback;
    const {component_key: component, ...params} = asPlan(rawParams);
    if (component) {
      const id = String(component);
      params.component = port.tr(`remote:vnc_guide.components.${id}`, {defaultValue:id.toUpperCase()});
    }
    return port.tr(`remote:vnc_guide.${key}`, {...params, defaultValue:fallback || key});
  }

  function mode(value: InstallPlan, id: RemoteInstallMode) {
    const candidates = [value.install_plan, value.component_plan, asPlan(value.package_plan).install_plan, value];
    const plan = candidates.map(asPlan).find(item => Array.isArray(item.modes) || item.online || item.offline || item.local_offline || item.manual) || {};
    const key = id === 'local-offline' ? 'local_offline' : id;
    const entry = asPlan(plan[key] || (Array.isArray(plan.modes) ? plan.modes.find(item => asPlan(item).id === id) : undefined));
    const meta = installModePresentation[id];
    const description = port.tr(`remote:install.${meta.key}_description`);
    const command = String(entry.command || '').trim();
    return {
      id, command, label: port.tr(`remote:install.${meta.key}`), icon: meta.icon,
      description: entry.description ? port.safeTaskText(entry.description, description) : description,
      available: id === 'manual' || (entry.available === undefined ? Boolean(command) : Boolean(entry.available)),
      package_names: Array.isArray(entry.package_names) ? entry.package_names.filter((name): name is string => typeof name === 'string') : []
    };
  }

  async function copyReference(button: HTMLElement, commands: string[], vnc = false) {
    if (!button.isConnected || !commands.length) return;
    try {
      await port.copy(commands.join(vnc ? '\n' : '\n\n'));
      if (button.isConnected) port.notify(port.tr(vnc ? 'remote:vnc_ui.commands_copied' : 'remote:install.commands_copied'), 'success');
    } catch (cause) {
      if (button.isConnected) port.notify(cause instanceof Error && cause.message || port.tr(vnc ? 'remote:vnc_ui.copy_commands_failed' : 'remote:install.copy_failed'), 'error');
    }
  }

  function install(plan: InstallPlan, run: (mode: RemoteInstallMode, button: HTMLElement) => void,
    manual: (button: HTMLElement) => void = revealInstallManual, actionKey = ''): InstallModel {
    return {
      label: port.tr('remote:install.methods', {defaultValue: '安装方式'}),
      modes: installModes.map(modeId => {
        const item = mode(plan, modeId);
        return {
          ...port.action(modeId, item.label, item.icon, button => modeId === 'manual' ? manual(button) : run(modeId, button), modeId === 'manual' ? '' : actionKey),
          mode: modeId,
          disabled: !item.available || Boolean(modeId !== 'manual' && actionKey && port.actionInFlight(actionKey)),
          description: item.available ? item.description : port.tr('remote:install.unavailable_description', {
            description: item.description || port.tr('remote:install.no_plan', {defaultValue: '当前系统没有可用方案'}),
            defaultValue: `${item.description} · 当前不可用`
          }),
          state: port.tr('remote:install.unavailable', {defaultValue: '不可用'})
        };
      })
    };
  }

  function manual(plan: InstallPlan, options: ManualInstallOptions = {}): ManualModel {
    const commands = [...new Set([
      ...(options.commands || []), mode(plan, 'online').command, mode(plan, 'offline').command
    ].map(value => String(value || '').trim()).filter(Boolean))];
    const packages = mode(plan, 'local-offline').package_names;
    const steps = (options.steps || []).map(step => port.safeTaskText(step)).filter(Boolean);
    if (commands.length) steps.push(packages.length
      ? port.tr('remote:auto.manual_offline_packages', {packages: packages.join(', '), defaultValue: `请在匹配的联网设备准备 ${packages.join(', ')} 及全部依赖，再上传安装。`})
      : port.tr('remote:auto.manual_offline_components', {defaultValue: '请在匹配的联网设备准备所需组件及全部依赖，再上传安装。'}));
    return {
      label: port.tr('remote:auto.manual_install', {defaultValue: '手动安装/配置说明'}), steps, commands,
      note: port.localizeTaskText(options.note) || port.tr('remote:install.default_note', {defaultValue: '执行前请确认软件源或离线缓存，并保存图形会话。'}),
      reference: port.tr('remote:auto.reference_commands', {defaultValue: '参考命令'}),
      unavailable: port.tr('remote:auto.manual_commands_unavailable', {defaultValue: '当前系统没有可自动生成的命令。'}),
      copy: port.action('copy-reference', port.tr('remote:auto.copy_reference_commands', {defaultValue: '复制参考命令'}), 'copy', button => { void copyReference(button, commands); }),
      open: options.open
    };
  }

  function protocolGuide(protocol: string, diagnostics: RemoteManagementDiagnostics = {}, profile?: RemoteProfile): RemoteSetupGuideModel['guide'] {
    if (protocol === 'rdp') {
      const connection = profile ? port.connection(port.managementConnectionId(profile)) : undefined;
      const diagnosticConnection = diagnostics.connection as RdpGuideDiagnostics['connection'];
      const user = String(profile?.username || connection?.ssh_user || diagnosticConnection?.ssh_user || '').trim();
      return {
        icon: 'badge-check', tag: port.tr('remote:auto.recommended', {defaultValue: '推荐'}),
        title: port.tr('remote:auto.xrdp_xorg', {defaultValue: 'xrdp 使用 Xorg/xorgxrdp'}),
        detail: port.tr('remote:auto.xrdp_xorg_hint', {defaultValue: '默认优先选择 Xorg。'}),
        extra: user
          ? `${port.tr('remote:auto.rdp_login_user', {user, defaultValue: `XRDP 登录使用远端 Linux 桌面账号：${user}。`})} ${port.tr('remote:auto.rdp_password_not_admin', {defaultValue: '不要填写临时管理员授权密码、VNC 密码或 Windows 当前账号。'})}`
          : port.tr('remote:auto.rdp_login_hint', {defaultValue: 'XRDP 登录使用远端 Linux 桌面账号。'})
      };
    }
    if (protocol === 'vnc') return {
      icon: 'panels-top-left', tag: port.tr('remote:auto.desktop_relation', {defaultValue: '桌面关系'}),
      title: port.tr('remote:auto.vnc_source_summary', {defaultValue: '共享来源用 x11vnc，独立来源用 TigerVNC'}),
      detail: port.tr('remote:auto.vnc_source_detail', {defaultValue: 'x11vnc 镜像已有桌面，TigerVNC 创建独立桌面。'}),
      extra: port.tr('remote:auto.vnc_source_risk', {defaultValue: '独立 VNC 推荐使用单独的普通用户。'}), risk: true
    };
    return {
      icon: 'monitor-up', tag: port.tr('remote:auto.local_requirement', {defaultValue: '本机要求'}),
      title: port.tr('remote:auto.xdmcp_local_xserver_required', {defaultValue: '运行 Terma 的设备必须有可用的本机 X Server'}),
      detail: port.tr('remote:auto.xdmcp_local_xserver_hint', {defaultValue: 'Linux 常用 Xephyr，macOS 使用 XQuartz，Windows 需要 X Server。'})
    };
  }

  function standalone(profile: RemoteProfile | undefined, protocol: RemoteGuideProtocol,
    presentation: {show(options: RemoteSetupGuideOptions): void; close(): void; manage(): void}): boolean {
    if (!profile || profile.protocol !== protocol) return false;
    const section = {rdp: 'rdp_status', xdmcp: 'xdmcp_setup', vnc: 'vnc_ui'}[protocol];
    const text = (key: string) => port.tr(`remote:${section}.${key}`);
    presentation.show({
      model: (): RemoteSetupGuideModel => ({
        protocol, title: text('setup_title'),
        endpoint: `${profile.name || protocol.toUpperCase()} · ${port.endpoint(profile)}`,
        closeLabel: port.tr('common:actions.close'),
        service: {title: text('standalone_title'), detail: text('standalone_detail'), tone: protocol === 'xdmcp' ? 'warning' : 'success'},
        management: {
          title: port.tr('remote:diagnostics.ssh_management_unlinked'), detail: text('management_link_hint'),
          action: port.tr('remote:diagnostics.new_ssh_management_connection')
        },
        guide: protocolGuide(protocol, {}, profile)
      }),
      close: presentation.close,
      manage: () => { presentation.close(); presentation.manage(); }
    });
    return true;
  }

  function rdp(diagnostics: RdpGuideDiagnostics, profile: RemoteProfile, close: () => void): ManagementModel {
    const text = (id: string, fallback: string) => port.tr(`remote:rdp_status.${id}`, {defaultValue: fallback});
    const plan = port.rdpInstallPlan(diagnostics) || {};
    const installed = Boolean(diagnostics.xrdp_installed), active = Boolean(diagnostics.xrdp_active), linux = diagnostics.platform_supported !== false;
    const profileId = Number(profile.id || 0), actionKey = port.rdpActionKey(profileId), key = `remote-desktop-${profileId}`;
    const source = Number(diagnostics.connection?.id || port.managementConnectionId(profile));
    const steps = linux
      ? [text('guide_desktop', ''), text('guide_install', ''), text('guide_firewall', ''), text('guide_redetect', '')]
      : [text('guide_non_linux', ''), text('guide_native_server', '')];
    const actions = [port.action('close', port.tr('common:actions.close', {defaultValue: '关闭'}), '', close)];
    if (installed) actions.push(
      port.action(active ? 'stop' : 'start', text(active ? 'stop_service' : 'start_service', ''), active ? 'circle-stop' : 'circle-play', button => port.rdpServerAction(profileId, key, active ? 'stop' : 'start', button), actionKey),
      port.action('uninstall', text('uninstall_service', ''), 'package-minus', button => port.rdpServerAction(profileId, key, 'uninstall', button), actionKey, 'danger')
    );
    if (source) actions.push(port.action('linux-desktop', text('linux_desktop_management', ''), 'monitor-cog', () => {close(); port.openLinuxDesktop(source);}));
    return {
      title: text('install_setup_title', ''), subtitle: `${diagnostics.connection?.name || profile.name || text('remote_host', '')} · ${diagnostics.package_manager || text('unknown_package_manager', '')}`,
      titleId: 'rdpSetupGuideTitle', closeLabel: port.tr('common:actions.close', {defaultValue: '关闭'}),
      notices: [{detail: text(installed ? 'guide_installed' : !linux ? 'guide_unsupported' : 'guide_missing', ''), tone: installed ? 'success' : 'warning'}],
      guide: protocolGuide('rdp', diagnostics, profile),
      install: linux && !installed ? install(plan, (mode, button) => port.rdpInstallServer(profileId, key, button, mode), revealInstallManual, actionKey) : undefined,
      manual: manual(plan, {steps, note: text('guide_offline_note', '')}), actions
    };
  }

  function xdmcp(diagnostics: XdmcpGuideDiagnostics, profile: RemoteProfile, requestedAction: string, close: () => void): ManagementModel {
    const text = (id: string, fallback: string, params: Record<string, unknown> = {}) => port.tr(`remote:xdmcp_setup.${id}`, {...params, defaultValue: fallback});
    const manager = port.xdmcpManagerLabel(diagnostics) || text('unknown_display_manager', '');
    const macos = String(diagnostics.os_id || diagnostics.os_like || '').toLowerCase().includes('mac');
    const desktopMissing = Boolean(diagnostics.needs_desktop_install || diagnostics.root_plasma_risk);
    const managerMissing = diagnostics.required_action === 'install-lightdm' || diagnostics.action === 'install-lightdm' || Boolean(diagnostics.replacement_available && !diagnostics.supported);
    const operation = port.xdmcpInstallAction(requestedAction) ? requestedAction : desktopMissing ? 'install-xfce' : managerMissing ? 'install-lightdm' : '';
    const plan = operation ? port.xdmcpInstallPlan(diagnostics, operation) : null;
    const command = plan ? mode(plan, 'online').command : legacyXdmcpInstallCommand(diagnostics, desktopMissing, managerMissing);
    const profileId = Number(profile.id || 0), actionKey = port.xdmcpActionKey(profileId);
    const desktop = diagnostics.preferred_session?.name || diagnostics.preferred_session?.id || diagnostics.resolved_saved_session_label || text('detected_x11_desktop', '');
    const stepIds = macos ? ['step_macos_no_manager', 'step_macos_xquartz']
      : desktopMissing ? ['step_desktop_required', 'step_root_plasma', 'step_redetect_launch', 'step_udp_firewall']
      : managerMissing ? ['step_manager_missing', 'step_switch_lightdm', 'step_redetect_after_switch', 'step_trusted_lan']
      : diagnostics.listening ? ['step_ready', 'step_ready_launch']
      : diagnostics.supported && diagnostics.has_x11_session ? ['step_components_ready', 'step_enable_only', 'step_firewall_behavior']
      : ['step_confirm_manager', 'step_install_or_enable', 'step_redetect', 'step_trusted_lan'];
    const steps = stepIds.map(id => text(id, '', {manager, desktop}));
    if (diagnostics.listening || diagnostics.supported && diagnostics.has_x11_session) steps.push(port.tr('remote:xdmcp_status.security_warning', {defaultValue: 'XDMCP 不加密，只应在可信局域网使用。'}));
    const firewall = diagnostics.firewall === 'ufw-active' ? 'sudo ufw allow 177/udp'
      : diagnostics.firewall === 'firewalld-active' ? 'sudo firewall-cmd --permanent --add-port=177/udp && sudo firewall-cmd --reload' : '';
    const commands = [command, firewall].filter(Boolean);
    const target = operation === 'install-xfce' ? text('compatible_desktop', '') : operation === 'install-rdp' ? text('rdp_service', '') : 'LightDM';
    const title = operation ? text('install_methods_title', '', {target}) : command ? text('install_setup_title', '') : text('setup_title', '');
    const summary = diagnostics.listening ? text('enabled_listening', '') : diagnostics.enabled ? text('configured_not_listening', '')
      : diagnostics.supported ? text('manager_ready_disabled', '', {manager}) : port.xdmcpWarning(diagnostics) || text('service_not_detected', '');
    const warning = port.xdmcpWarning(diagnostics), source = Number(diagnostics.ssh_connection?.id || 0);
    const actions = [port.action('close', text('close', ''), '', close)];
    if (command && source) actions.push(port.action('reference-terminal', text('run_reference_terminal', ''), 'square-terminal', () => port.xdmcpSetupTerminal(source, command)));
    return {
      title, subtitle: `${manager} · ${diagnostics.ssh_connection?.name || port.tr('remote:diagnostics.ssh_management_connection', {defaultValue: 'SSH 管理连接'})}`,
      titleId: 'xdmcpSetupGuideTitle', closeLabel: text('close', ''),
      notices: [{detail: summary, tone: diagnostics.listening ? 'success' : 'warning'}, ...(warning && warning !== summary ? [{detail: warning, tone: 'warning'}] : [])],
      guide: protocolGuide('xdmcp', diagnostics, profile),
      install: plan ? install(plan, (mode, button) => port.xdmcpConfigure(profileId, operation, button, mode), revealInstallManual, actionKey) : undefined,
      manual: manual(plan || {}, {steps, commands, note: text('admin_install_note', '')}), actions
    };
  }

  function vnc(diagnostics: VncGuideDiagnostics, profile: RemoteProfile, close: () => void): ManagementModel {
    const text = (id: string, fallback: string) => port.tr(`remote:vnc_ui.${id}`, {defaultValue: fallback});
    const guide = diagnostics.guide || {}, commands = Array.isArray(guide.commands) ? guide.commands.filter(Boolean) : [];
    const steps = Array.isArray(guide.steps) ? guide.steps.map(step => vncGuideText(step)).filter(Boolean) : [];
    const selection = diagnostics.server_session_selection || {}, component = diagnostics.selected_component || selection.component_state;
    const scoped = diagnostics.server_session_configurable === true && Boolean(component);
    const installed = scoped ? component?.installed === true : Boolean(diagnostics.installed || diagnostics.service_unit || diagnostics.commands?.length);
    const running = scoped ? port.vncServerReady(diagnostics) : Boolean(diagnostics.listening || ['ready', 'reachable'].includes(diagnostics.status || ''));
    const profileId = Number(profile.id || 0), key = port.vncSessionKey(profileId), actionKey = port.vncActionKey(profileId), plan = diagnostics.install_plan || {};
    const actions = [port.action('close', text('close', ''), '', close)];
    if (installed && diagnostics.platform !== 'macos') {
      if (running || diagnostics.start_plan) actions.push(port.action(running ? 'stop' : 'start', port.tr(running ? 'remote:vnc_status.stop_service' : 'remote:vnc_status.start_service', {defaultValue: '服务操作'}), running ? 'circle-stop' : 'circle-play', button => port.vncServerAction(profileId, key, running ? 'stop' : 'start', button), actionKey));
      actions.push(
        port.action('change-password', port.tr('remote:vnc_status.change_password', {defaultValue: '修改服务密码'}), 'key-round', button => port.vncServerAction(profileId, key, 'change-password', button), actionKey),
        port.action('uninstall', port.tr('remote:vnc_status.uninstall_service', {defaultValue: '卸载服务'}), 'package-minus', button => port.vncServerAction(profileId, key, 'uninstall', button), actionKey, 'danger')
      );
    }
    if (commands.length) actions.push(port.action('copy-vnc', text('copy_commands', ''), 'copy', button => { void copyReference(button, commands, true); }));
    return {
      className: 'vnc-setup-guide', title: vncGuideText(guide.title, text('install_setup_title', '')),
      subtitle: diagnostics.ssh_connection?.name || diagnostics.platform || text('remote_host', ''), titleId: 'vncSetupGuideTitle', closeLabel: text('close', ''),
      notices: [{detail: vncGuideText(guide.summary, text('follow_steps', '')), tone: ['ready', 'reachable'].includes(diagnostics.status || '') ? 'success' : 'warning'}],
      install: (scoped ? component?.install_required === true : !installed) && diagnostics.platform !== 'macos'
        ? install(plan, (mode, button) => port.vncInstallServer(profileId, key, button, mode), revealInstallManual, actionKey) : undefined,
      manual: manual(plan, {steps, commands, note: text('install_privacy_note', '')}), taskHostId: 'vncSetupTaskState', actions
    };
  }

  function desktop(desktopId: string, sourceId: number, diagnostics: DesktopGuideDiagnostics,
    current: () => boolean, close: () => void): ManagementModel {
    const plan = diagnostics.desktop_install_plans?.[desktopId] || {}, label = port.desktopLabel(desktopId);
    const text = (id: string, params: Record<string, unknown> = {}) => port.tr(`remote:linux_desktop.${id}`, params);
    return {
      title: text('install_title', {desktop: label}), titleId: 'linuxDesktopInstallTitle',
      subtitle: `${diagnostics.connection?.name || port.tr('common:x11.remote_host')} · ${diagnostics.package_manager || text('unknown_package_manager')}`,
      closeLabel: port.tr('common:actions.close'), notices: [{detail: text('install_warning'), tone: 'warning'}],
      install: install(plan, (mode, button) => current() ? port.installDesktop(desktopId, mode, button) : close(), revealInstallManual, port.desktopActionKey(sourceId)),
      manual: manual(plan, {steps: [text('install_step_choose', {desktop: label}), text('install_step_local_offline'), text('install_step_remote_cache'), text('install_step_redetect')], note: text('install_offline_note')}),
      actions: [port.action('close', port.tr('common:actions.close'), '', close)]
    };
  }

  async function open(profile: RemoteProfile, protocol: RemoteGuideProtocol, requestedAction: string,
    presentation: ManagedInstallGuidePresentation) {
    let active = true;
    let diagnostics: RemoteManagementDiagnostics | null = null;
    let errorText = '';
    const close = () => presentation.close();
    const titleKeys = {
      rdp: 'remote:rdp_status.install_setup_title',
      xdmcp: 'remote:xdmcp_setup.setup_title',
      vnc: 'remote:vnc_ui.install_setup_title'
    } as const;
    const actionKey = {rdp: port.rdpActionKey, xdmcp: port.xdmcpActionKey, vnc: port.vncActionKey}[protocol];
    presentation.show({
      close,
      dismissed: () => { active = false; },
      model: () => {
        if (diagnostics) {
          if (protocol === 'rdp') return rdp(diagnostics, profile, close);
          if (protocol === 'xdmcp') return xdmcp(diagnostics, profile, requestedAction, close);
          return vnc(diagnostics, profile, close);
        }
        const closeLabel = port.tr('common:actions.close', {defaultValue: '关闭'});
        return {
          title: port.tr(titleKeys[protocol], {defaultValue: '安装/配置说明'}),
          titleId: `${protocol}SetupGuideTitle`,
          closeLabel,
          subtitle: profile.name,
          loading: errorText ? '' : port.tr('remote:diagnostics.detecting', {defaultValue: '探测中...'}),
          notices: errorText ? [{detail: errorText, tone: 'error'}] : [],
          actions: [port.action('close', closeLabel, '', close)]
        };
      }
    });
    try {
      const result = await presentation.read();
      if (!active) return null;
      if (!result) { close(); return null; }
      diagnostics = result;
      presentation.refresh();
      presentation.syncActions(actionKey(Number(profile.id)));
      return result;
    } catch (error) {
      if (!active) return null;
      const detail = (typeof error === 'object' && error !== null ? error : {}) as {code?: unknown; message?: unknown};
      if (presentation.authenticationFailure(detail)) {
        close();
        return presentation.repair();
      }
      errorText = String(detail.message || port.tr('remote:diagnostics.ssh_probe_unavailable', {defaultValue: 'SSH 深度探测不可用'}));
      presentation.refresh();
      return null;
    }
  }

  return {mode, install, manual, protocolGuide, standalone, rdp, xdmcp, vnc, desktop, open};
}
