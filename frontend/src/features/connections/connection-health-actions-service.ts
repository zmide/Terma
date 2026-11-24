import type { ConnectionViewPort } from './connection-port';
import { bindConnectionHealthFormatting } from './connection-health-service';

export type ConnectionHealthActionOptions = {
  skipCredentialRepair?: boolean;
  button?: HTMLElement | null;
  context?: string;
  error?: unknown;
  onSaved?: (connection: unknown) => unknown;
  onTemporary?: (connection: unknown, token: string) => unknown;
};

export type ConnectionHealthActionsService = {
  check(id: number, button?: HTMLElement | null, options?: ConnectionHealthActionOptions): Promise<unknown>;
  repairCredentials(id: number, options?: ConnectionHealthActionOptions): Promise<unknown>;
  repairDashboardCredentials(id: number, options?: ConnectionHealthActionOptions): Promise<unknown>;
};

type HealthActionsPort = Pick<ConnectionViewPort, 'connections' | 'currentConnection' | 'healthResults' | 'api'
  | 'renderConnections' | 'createProgressToast' | 'setButtonBusy' | 'tr'> & {
    authenticationFailure(value: unknown): boolean;
    repairSshCredentials(id: number, options: ConnectionHealthActionOptions): unknown;
  };

export function createConnectionHealthActionsService(port: HealthActionsPort, formatting: ReturnType<typeof bindConnectionHealthFormatting>): ConnectionHealthActionsService {
  async function repairCredentials(id: number, options: ConnectionHealthActionOptions = {}) {
    return port.repairSshCredentials(id, {
      ...options,
      context: options.context || port.tr('connections:health.authentication_failed', {defaultValue: '健康检查认证失败'})
    });
  }

  async function repairDashboardCredentials(id: number, options: ConnectionHealthActionOptions = {}) {
    return repairCredentials(id, {
      ...options,
      context: options.context || port.tr('connections:health.inspection_auth_failed', {defaultValue: '服务器巡检认证失败'})
    });
  }

  async function check(id: number, button: HTMLElement | null = null, options: ConnectionHealthActionOptions = {}) {
    const connection = port.currentConnection(id) || port.connections.find((item: any) => Number(item.id) === Number(id));
    const progress = port.createProgressToast({
      title: port.tr('connections:health.checking_connection', {
        name: connection?.name || port.tr('connections:health.ssh_connection', {defaultValue: 'SSH 连接'}),
        defaultValue: `正在检查 ${connection?.name || 'SSH 连接'}`
      }),
      detail: formatting.identity(connection, {id}),
      icon: 'activity'
    });
    port.setButtonBusy(button, true, port.tr('connections:health.checking', {defaultValue: '检查中...'}));
    try {
      const result = await port.api(`/api/connections/${id}/health`, {method: 'POST'});
      port.healthResults.set(id, result);
      port.renderConnections();
      const message = formatting.message(connection, result);
      if (result.ok) progress.finish(message, 3500);
      else {
        progress.fail(message);
        if (!options.skipCredentialRepair && formatting.authenticationResult(result)) {
          await repairCredentials(id, {button});
        }
      }
      return result;
    } catch (error: any) {
      const identity = formatting.identity(connection, {id});
      const message = port.tr('connections:health.check_failed', {
        identity,
        error: error?.message || String(error),
        defaultValue: `${identity} 健康检查失败\n${error?.message || String(error)}`
      });
      progress.fail(message);
      if (!options.skipCredentialRepair && port.authenticationFailure(error)) {
        await repairCredentials(id, {button, error});
      }
      return null;
    } finally {
      port.setButtonBusy(button, false);
    }
  }

  return {check, repairCredentials, repairDashboardCredentials};
}



export interface InstalledFeaturesConnectionsConnectionHealthActionsServiceServices {
  termaConnectionHealthActions?: ConnectionHealthActionsService;
}
