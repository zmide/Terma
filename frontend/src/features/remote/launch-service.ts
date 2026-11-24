import type { RemoteProfile } from './profile-model';
import {
  clientAvailability,
  normalizedVncClientMode,
  type RemoteClientDiagnostics,
  type RemoteClientItem,
  type RemoteClientMode,
  type RemoteClientPort,
  type RemoteClientProtocol
} from './client-service';

export interface RemoteLaunchResult {
  canceled?: boolean;
  protocol?: string;
  client?: string;
  credentials?: string;
  password_transfer_requested?: boolean;
  password_transfer_supported?: boolean;
  [key: string]: unknown;
}

export interface RemoteLaunchPort extends RemoteClientPort {
  clientReason(item: RemoteClientItem, diagnostics: RemoteClientDiagnostics, protocol: RemoteClientProtocol): string;
  setStatus(state: 'success' | 'error', message: string): void;
  managementConnectionId(profile: RemoteProfile): number;
  readXdmcp(id: number): Promise<RemoteClientItem | null>;
  cleanupXdmcp(id: number): Promise<{ after?: RemoteClientItem } | null>;
}

export interface RemoteLaunchClients {
  diagnostics(): Promise<RemoteClientDiagnostics>;
}

const launchProtocols: RemoteClientProtocol[] = ['rdp', 'vnc', 'xdmcp'];
const clientLaunchProtocols: RemoteClientProtocol[] = ['rdp', 'vnc'];
const clientModes: RemoteClientMode[] = ['auto', 'bundled', 'embedded', 'system'];
const isLaunchProtocol = (value: RemoteProfile['protocol']): value is RemoteClientProtocol => launchProtocols.includes(value as RemoteClientProtocol);
const isClientLaunchProtocol = (value: RemoteClientProtocol): value is Extract<RemoteClientProtocol, 'rdp' | 'vnc'> => clientLaunchProtocols.includes(value);

export function createRemoteLaunchService(port: RemoteLaunchPort, clients: RemoteLaunchClients) {
  let alive = true;

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }

  function launchStatusMessage(result: RemoteLaunchResult, profile: RemoteProfile) {
    const protocol = String(result.protocol || profile.protocol);
    if (protocol === 'xdmcp') {
      return port.tr('remote:clients.opened_in', {
        client: result.client || 'X Server',
        defaultValue: `已在 ${result.client || 'X Server'} 打开`
      });
    }
    if (protocol === 'vnc' && result.credentials === 'temporary-password') {
      return port.tr('remote:clients.opened_vnc_temporary_password', {
        client: result.client || port.tr('remote:capabilities.bundled_tigervnc', { defaultValue: 'TigerVNC Viewer' }),
        defaultValue: `已交给 ${result.client || 'TigerVNC Viewer'} 打开，仅使用本次输入的 VNC 密码`
      });
    }
    if (protocol === 'vnc' && result.credentials === 'saved-password') {
      return port.tr('remote:clients.opened_vnc_saved_password', {
        client: result.client || port.tr('remote:capabilities.bundled_tigervnc', { defaultValue: 'TigerVNC Viewer' }),
        defaultValue: `已交给 ${result.client || 'TigerVNC Viewer'} 打开，已通过一次性密码文件传递保存的 VNC 密码`
      });
    }
    if (protocol === 'rdp' && result.credentials === 'stdin') {
      return port.tr('remote:clients.opened_password_stdin', {
        client: result.client || 'FreeRDP',
        defaultValue: `已交给 ${result.client || 'FreeRDP'} 打开，已通过标准输入传递保存的密码`
      });
    }
    if (protocol === 'rdp' && result.credentials === 'windows-credential-manager') {
      return port.tr('remote:clients.opened_windows_credentials', {
        client: result.client || port.tr('remote:clients.windows_remote_desktop', { defaultValue: 'Windows 远程桌面' }),
        defaultValue: `已交给 ${result.client || 'Windows 远程桌面'} 打开，已通过当前 Windows 用户的临时凭据传递密码`
      });
    }
    if (protocol === 'rdp' && result.password_transfer_requested && !result.password_transfer_supported) {
      return port.tr('remote:clients.opened_prefill_unsupported', {
        client: result.client || port.tr('remote:clients.system_client', { defaultValue: '系统客户端' }),
        defaultValue: `已交给 ${result.client || '系统客户端'} 打开；该客户端不支持安全预填充，仍会显示凭据窗口`
      });
    }
    return port.tr('remote:clients.opened_client_prompts', {
      client: result.client || port.tr('remote:clients.system_client', { defaultValue: '系统客户端' }),
      defaultValue: `已交给 ${result.client || '系统客户端'} 打开，凭据由客户端提示`
    });
  }

  async function readXdmcpState(profileId: number, profile: RemoteProfile) {
    const managementConnectionId = port.managementConnectionId(profile);
    if (!managementConnectionId) return {};
    return await port.readXdmcp(profileId).catch(() => null) || {};
  }

  async function launch(
    profileId: number,
    key = '',
    button: HTMLElement | null = null,
    clientModeOverride = '',
    temporaryCredentials: Record<string, unknown> = {},
    allowFallback = true
  ): Promise<RemoteLaunchResult | null> {
    if (!alive) return null;
    if (button) port.setBusy(button, true, port.tr('remote:vnc_ui.starting', { defaultValue: '启动中...' }));
    let automaticVnc = false;
    try {
      const profile = port.profile(profileId);
      if (!profile || !isLaunchProtocol(profile.protocol)) {
        throw new Error(port.tr('remote:vnc_ui.detached_profile_missing', { defaultValue: '远程连接不存在' }));
      }

      const effectiveClientMode = clientModes.includes(clientModeOverride as RemoteClientMode)
        ? clientModeOverride as RemoteClientMode
        : normalizedVncClientMode(profile.options);
      automaticVnc = profile.protocol === 'vnc' && effectiveClientMode === 'auto';
      const temporaryVncPassword = profile.protocol === 'vnc' && Object.prototype.hasOwnProperty.call(temporaryCredentials, 'password')
        ? String(temporaryCredentials.password || '')
        : '';
      if (temporaryVncPassword.length > 4096 || /[\0\r\n]/.test(temporaryVncPassword)) {
        throw new Error(port.tr('remote:vnc_ui.password_invalid', { defaultValue: 'VNC 密码无效' }));
      }

      const scopes = profile.protocol === 'xdmcp' ? ['remote-client', 'xserver'] : ['remote-client'];
      if (!await port.ensureAuthorized(scopes)) return null;

      if (isClientLaunchProtocol(profile.protocol)) {
        const diagnostics = await clients.diagnostics();
        const item = diagnostics[profile.protocol] || {};
        const mode = profile.protocol === 'vnc' ? effectiveClientMode : 'auto';
        const availability = clientAvailability(profile.protocol, mode, item);
        if (!availability.launchAllowed) {
          throw new Error(port.clientReason(item, diagnostics, profile.protocol));
        }
      }

      if (profile.protocol === 'xdmcp') {
        let serverState = await readXdmcpState(profileId, profile);
        if (serverState.session_conflict) {
          if (!serverState.can_cleanup_remote_sessions) {
            throw new Error(
              Array.isArray(serverState.local_graphical_sessions) && serverState.local_graphical_sessions.length
                ? port.tr('remote:xdmcp_setup.local_plasma_conflict', {
                  defaultValue: '同一账号正在 Linux 本地桌面运行 Plasma。请先注销本地桌面，或使用另一个 Linux 账号登录 XDMCP。'
                })
                : port.tr('remote:xdmcp_setup.remote_plasma_conflict', {
                  defaultValue: 'Plasma 已绑定到其他图形会话，Terma 无法安全自动结束。请先注销旧会话。'
                })
            );
          }
          const cleanup = await port.cleanupXdmcp(profileId);
          if (!cleanup) return null;
          serverState = cleanup.after || {};
          if (serverState.session_conflict) {
            throw new Error(port.tr('remote:xdmcp_setup.conflict_cleanup_incomplete', {
              defaultValue: '旧的 Plasma 图形会话仍未完全退出，请稍后重新探测再启动'
            }));
          }
        }
      }

      const launchPayload: Record<string, string> = {};
      if (profile.protocol === 'vnc' && effectiveClientMode !== normalizedVncClientMode(profile.options)) {
        launchPayload.client_mode = effectiveClientMode;
      }
      if (temporaryVncPassword) launchPayload.vnc_password = temporaryVncPassword;
      const result = await port.api(`/api/remote-profiles/${profileId}/launch`, {
        method: 'POST',
        body: JSON.stringify(launchPayload)
      }) as RemoteLaunchResult;
      if (result?.canceled) return null;

      port.setStatus('success', launchStatusMessage(result, profile));
      port.notify(
        result.protocol === 'xdmcp'
          ? port.tr('remote:clients.xdmcp_started', { defaultValue: '已启动 XDMCP 图形桌面' })
          : port.tr('remote:clients.system_client_opened', { defaultValue: '已打开远程桌面客户端' }),
        'success'
      );
      return result;
    } catch (error) {
      const message = errorMessage(error, port.tr('remote:clients.launch_failed', { defaultValue: '远程桌面客户端启动失败' }));
      port.setStatus('error', message);
      if (automaticVnc && allowFallback) {
        try {
          const systemFallback = await launch(profileId, key, null, 'system', temporaryCredentials, false);
          if (systemFallback) {
            port.notify(port.tr('remote:clients.system_fallback_opened', {
              defaultValue: '内置 TigerVNC Viewer 启动失败，已改用系统 VNC 客户端'
            }), 'info');
            return { ...systemFallback, fallback: 'system', error: message };
          }
        } catch {
          // The original failure is more useful when the fallback also fails.
        }
      }
      port.notify(message, 'error');
      return null;
    } finally {
      if (button) port.setBusy(button, false);
    }
  }

  return {
    launch,
    dispose() {
      alive = false;
    }
  };
}
