import type { DesktopPort, createDesktopService } from './desktop-service';
import type { DesktopDiagnostics, DesktopSession } from './resource-probe';
import type { LinuxDesktopOptions } from './LinuxDesktopView';
import type { RemoteInstallGuidePort } from './install-guide-service';
import type { RemoteManagementModelPort } from './remote-management-model-service';

type Text = DesktopPort['tr'];
const desktopLabels = new Map(Object.entries({xfce:'XFCE',gnome:'GNOME',plasma:'KDE Plasma',mate:'MATE',cinnamon:'Cinnamon',lxqt:'LXQt'}));
export const desktopLabel = (id: string, tr: Text) => desktopLabels.get(id) || id || tr('remote:management.linux_desktop');

const usageKinds = {
  system_default:'configured', account_default:'configured', xdmcp_configured:'protocol', rdp_configured:'protocol',
  vnc_configured:'protocol', local_active:'active', xdmcp_active:'active', rdp_active:'active', remote_active:'active',
  vnc_shared:'active', vnc_virtual_active:'active'
} as const;

function usageBadges(diagnostics: DesktopDiagnostics, id: string, text: Text) {
  const usage = diagnostics.desktop_usage?.[id];
  return usage ? Object.entries(usageKinds).flatMap(([key, kind]) =>
    usage[key] && !(key === 'remote_active' && (usage.xdmcp_active || usage.rdp_active))
      ? [{kind, label:text(`usage.${key}`), title:text(`usage_hints.${key}`)}] : []) : [];
}

function selectionSummary(d: DesktopDiagnostics, text: Text, label: (id: string) => string): LinuxDesktopOptions['summary'] {
  const selection = d.desktop_selection || {};
  const session = (item: DesktopSession | undefined, fallback: string) => item?.desktop_id ? label(item.desktop_id) : item?.name || item?.raw || fallback;
  const names = (items: DesktopSession[]) => [...new Set(items.flatMap(item => item.desktop_id ? [label(item.desktop_id)] : []))].join(' / ');
  const graphical = Array.isArray(d.active_graphical_sessions) ? d.active_graphical_sessions : [];
  const vnc = Array.isArray(d.active_vnc_sessions) ? d.active_vnc_sessions : [];
  const shared = vnc.filter(item => item.shared), virtual = vnc.filter(item => item.virtual);
  let vncValue = text('choose_at_login');
  if (selection.vnc?.state === 'not-installed') vncValue = text('not_installed');
  else if (shared.length) vncValue = text('shared_session', {desktop:names(shared) || text('desktop_unknown')});
  else if (virtual.length) vncValue = names(virtual) ? text('virtual_session', {desktop:names(virtual)}) : text('virtual_session_configured');
  else if (selection.vnc?.state === 'configured') vncValue = text('configured_not_running', {desktop:session(selection.vnc.session, text('configured'))});
  return [
    ['settings-2', text('system_default'), session(selection.system_default?.session, text('unknown'))],
    ['user-round', text('account_default'), session(selection.account_default?.session, text('choose_at_login'))],
    ['panels-top-left', 'XDMCP', selection.xdmcp?.state === 'disabled' ? text('not_enabled') : session(selection.xdmcp?.session, text('choose_at_login'))],
    ['monitor', 'RDP', selection.rdp?.state === 'not-installed' ? text('not_installed') : session(selection.rdp?.session, text('unknown'))],
    ['radio-tower', 'VNC', vncValue],
    ['activity', text('current_graphical_session'), graphical.length ? names(graphical) || text('active_unknown') : text('not_detected')]
  ];
}

export interface LinuxDesktopModelPort extends Pick<DesktopPort,'tr'|'localize'|'connection'|'connections'>,
  Pick<RemoteInstallGuidePort,'desktopActionKey'|'action'|'actionInFlight'>, Pick<RemoteManagementModelPort,'authenticationFailure'> {
  formatConnectionIssues(issues: unknown[]): string;
  repair(id: number): unknown;
}

type Desktop = ReturnType<typeof createDesktopService>;
export function linuxDesktopModel(port: LinuxDesktopModelPort, desktop: Desktop): LinuxDesktopOptions {
  const {connectionId:selected, diagnostics:d, sshX11:x11, error, loading, task} = desktop.state;
  const connection = port.connection(selected);
  const text: Text = (key, params) => port.tr(`remote:linux_desktop.${key}`, params);
  const label = (id: string) => desktopLabel(id, port.tr);
  const platformSupported = d?.platform_supported !== false;
  const macos = d?.os_id === 'macos' || x11?.platform === 'macos';
  const diagnostic = d && selected ? {
    title:d.connection?.name || port.tr('common:x11.remote_host'),
    detail:macos ? text('macos_x11_environment') : `${d.os_id || 'Linux'} · ${d.package_manager || text('unknown_package_manager')} · ${d.display_manager || text('unknown_display_manager')}`,
    ready:macos ? Boolean(x11?.ready) : Boolean(d.has_desktop),
    status:macos ? text(x11?.ready ? 'x11_ready' : x11?.xquartz_installed ? 'xquartz_config_pending' : 'xquartz_missing')
      : d.has_desktop ? text('desktop_count', {count:d.desktops?.length || 0}) : text('no_desktop')
  } : undefined;
  const actionKey = port.desktopActionKey(selected);
  const installed = new Set(d?.desktops?.map(item => item.id));
  const installable = new Set(d?.installable_desktops);
  const busy = desktop.running(task) || port.actionInFlight(actionKey);
  const catalog: NonNullable<DesktopDiagnostics['desktop_catalog']> = d?.desktop_catalog || [...desktopLabels.keys()].map(id => ({id}));
  return {
    title:text(macos ? 'macos_title' : 'title'), subtitle:text(macos ? 'macos_subtitle' : 'subtitle'), selected, loading,
    connectionLabel:text('management_connection'), connections:[{value:0,label:text('select_host')},
      ...port.connections().map(c => ({value:Number(c.id),label:`${c.name} · ${c.ssh_user}@${c.ssh_host}`}))],
    detectLabel:text(loading ? 'detecting' : 'detect_again'), select:value => desktop.select(Number(value)), detect:desktop.load,
    diagnostic, summary:d && diagnostic && platformSupported ? selectionSummary(d,text,label) : [],
    cards:d && diagnostic && platformSupported ? catalog.map(item => {
      const present = installed.has(item.id), available = installable.has(item.id), enabled = (present || available) && !busy;
      const actionLabel = port.tr(present ? 'common:actions.remove' : 'common:actions.install');
      const run = (button: HTMLElement) => present ? desktop.uninstall(item.id,button) : desktop.install(item.id);
      return {id:item.id,label:item.label || label(item.id),icon:item.icon || 'monitor',installed:present,
        status:text(present ? 'installed_available' : available ? 'auto_installable' : 'no_auto_plan'),
        badges:present ? usageBadges(d,item.id,text) : [],
        action:{...port.action(`desktop-${item.id}`,actionLabel,present ? 'trash-2' : 'package-plus',run,actionKey,enabled && !present ? 'primary' : ''),disabled:!enabled}};
    }) : [],
    x11:diagnostic && connection ? {connection, diagnostics:x11 || {}} : undefined,
    hint:text(platformSupported ? 'hint' : macos ? 'macos_hint' : 'unsupported_hint'),
    empty:loading ? text('detecting_host', {host:connection?.name || port.tr('common:x11.remote_host')}) : text(selected ? 'preparing' : 'select_to_detect'),
    error:error ? (Array.isArray(error.issues) && port.formatConnectionIssues(error.issues)) || port.localize(error.message || port.tr('common:notifications.exact.linux_desktop_probe_failed')) : '',
    repair:error && port.authenticationFailure(error) ? port.action('repair-desktop',port.tr('common:actions.repair_credentials'),'key-round',() => port.repair(selected)) : undefined,
    task:Boolean(task)
  };
}
