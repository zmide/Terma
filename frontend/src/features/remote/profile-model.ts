export const remoteProtocols = ['rdp', 'vnc', 'xdmcp', 'ftp', 'telnet', 'serial'] as const;
export type RemoteProtocol = typeof remoteProtocols[number];
export type RemoteOptions = Record<string, string | number | boolean | null | undefined>;
export interface RemoteProfile {
  id?: number; protocol: RemoteProtocol; name?: string; group_name?: string; host?: string;
  port?: number | null; username?: string; has_password?: boolean; tags?: string; options?: RemoteOptions;
}
export type ProfileDraft = Record<string, string | boolean>;
export interface ProfilePayload {
  protocol: RemoteProtocol; name: string; group_name: string; host: string; port: number | null;
  username: string; password: string; clear_password: boolean; tags: string; options: RemoteOptions;
}
export const remoteProtocolMeta = {
  rdp: {label:'RDP', icon:'monitor-up', port:3389, workspace:'desktop'},
  vnc: {label:'VNC', icon:'monitor', port:5900, workspace:'desktop'},
  xdmcp: {label:'XDMCP', icon:'panels-top-left', port:177, workspace:'desktop'},
  ftp: {label:'FTP', icon:'folder-sync', port:21, workspace:'files'},
  telnet: {label:'Telnet', icon:'square-terminal', port:23, workspace:'terminal'},
  serial: {label:'Serial', icon:'usb', port:0, workspace:'terminal'}
} as const satisfies Record<RemoteProtocol, {label:string; icon:string; port:number; workspace:'desktop'|'files'|'terminal'}>;

type Translate = (key: string, params?: Record<string, unknown>) => string;
export function createRemoteProfilePresentation(tr: Translate) {
  const metadata = (value: unknown) => isRemoteProtocol(value) ? remoteProtocolMeta[value] : undefined;
  const normalize = (value: unknown) => String(value || '').toLowerCase();
  function label(protocol: unknown) {
    const value = normalize(protocol), fallback = metadata(value)?.label || value.toUpperCase();
    return value === 'serial' ? tr('remote:auto.serial', {defaultValue:fallback}) : fallback;
  }
  function action(protocol: unknown) {
    const value = normalize(protocol);
    if (value === 'xdmcp') return tr('remote:actions.open_graphical_desktop');
    const workspace = metadata(value)?.workspace;
    return tr(workspace === 'desktop' ? 'remote:actions.open_remote_desktop'
      : workspace === 'files' ? 'remote:actions.open_files' : 'remote:actions.open_terminal');
  }
  function endpoint(profile: RemoteProfile) {
    if (profile.protocol === 'serial') return String(profile.options?.path || tr('remote:management.serial_not_selected'));
    if (profile.protocol === 'xdmcp' && profile.options?.mode === 'broadcast') {
      return tr('remote:management.lan_broadcast_endpoint', {port:profile.port || remoteProtocolMeta.xdmcp.port});
    }
    const rawHost = String(profile.host || '').trim();
    const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
    return `${profile.username ? profile.username + '@' : ''}${host.includes(':') ? `[${host}]` : host}:${profile.port}`;
  }
  return {metadata:remoteProtocolMeta, label, action, endpoint, icon:(protocol: unknown) => metadata(protocol)?.icon || 'plug'};
}
export const isRemoteProtocol = (value: unknown): value is RemoteProtocol => remoteProtocols.includes(value as RemoteProtocol);
export function profileOptions(draft: ProfileDraft, profile: RemoteProfile): RemoteOptions {
  const text = (key: string) => String(draft['remote_' + key] ?? '');
  const num = (key: string) => Number(text(key));
  const yes = (key: string) => draft['remote_' + key] === true;
  const protocol = text('protocol');
  const source = num('source_ssh_connection_id');
  const withSource = (options: RemoteOptions) => source > 0 ? {...options, source_ssh_connection_id:source} : options;
  if (protocol === 'rdp') return withSource({domain:text('domain').trim(), display_mode:text('rdp_display_mode'), fullscreen:text('rdp_display_mode') === 'fullscreen', width:num('rdp_width'), height:num('rdp_height'), admin_session:yes('admin_session'), clipboard:yes('clipboard'), audio:text('audio'), allow_password_transfer:yes('rdp_password_transfer')});
  if (protocol === 'vnc') {
    const sourceId = num('vnc_ssh_connection');
    const options: RemoteOptions = {client_mode:text('vnc_client_mode'), cursor_mode:text('vnc_cursor_mode'), display_mode:text('vnc_display_mode'), server_session_mode:profile.options?.server_session_mode || 'auto', server_display:profile.options?.server_display || '', view_only:yes('view_only'), auto_sync_images:yes('vnc_auto_sync_images'), shared:yes('shared'), quality:num('quality')};
    return sourceId > 0 ? {...options, source_ssh_connection_id:sourceId} : options;
  }
  if (protocol === 'xdmcp') return withSource({mode:text('xdmcp_mode'), window_mode:text('xdmcp_window_mode'), width:num('xdmcp_width'), height:num('xdmcp_height'), local_address:text('xdmcp_local_address').trim(), ssh_connection_id:num('xdmcp_ssh_connection')});
  if (protocol === 'ftp') return withSource({secure:text('ftp_secure'), passive:true, reject_unauthorized:yes('reject_unauthorized'), base_path:text('base_path').trim() || '/'});
  if (protocol === 'telnet') return withSource({terminal_type:text('terminal_type').trim(), encoding:text('encoding')});
  return withSource({path:text('serial_path').trim(), baud_rate:num('baud_rate'), data_bits:num('data_bits'), stop_bits:num('stop_bits'), parity:text('parity'), rts_cts:yes('rts_cts'), xon:yes('xon'), xoff:yes('xoff'), encoding:text('encoding')});
}
export function profilePayload(draft: ProfileDraft, profile: RemoteProfile, defaultGroup: string): ProfilePayload {
  const text = (key: string) => String(draft['remote_' + key] ?? '');
  const protocol = text('protocol');
  if (!isRemoteProtocol(protocol)) throw new Error('Unsupported remote protocol');
  return {protocol, name:text('name').trim(), group_name:text('group') || defaultGroup,
    host:protocol === 'serial' ? '' : text('host').trim(), port:protocol === 'serial' ? null : Number(text('port')),
    username:['telnet','serial','xdmcp'].includes(protocol) ? '' : text('username').trim(),
    password:['rdp','ftp','vnc'].includes(protocol) ? text('password') : '', clear_password:draft.remote_clear_password === true,
    tags:text('tags').trim(), options:profileOptions(draft, profile)};
}
export function authenticationFailure(value: unknown, protocol = ''): boolean {
  if (protocol !== 'ftp') return false;
  const error = value as {code?: unknown; details?: {code?: unknown}; message?: unknown; error?: unknown} | null;
  const code = String(error?.code || error?.details?.code || '').toUpperCase();
  return code === 'FTP_AUTHENTICATION_FAILED' || /\b530\b|not logged in|login incorrect|ftp 认证失败|authentication failed/i.test(String(error?.message || error?.error || value || ''));
}
