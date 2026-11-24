import {sharedServices} from '@/shared/installed-services';
import { readApiPayload, sendApiRequest, type ApiRequestOptions } from './client';
import type { createPublicErrors } from './public-errors';
import type { SshHostTrustChallenge } from '@/features/settings/ssh-host-trust-dialog-service';

type HostTrustChallenge = SshHostTrustChallenge & { token?: string };
type Task = Record<string, unknown> & {id?: string; type?: string; action?: string};
type WorkspaceError = {code?: string; error?: string; challenge?: HostTrustChallenge; task?: Task};

export interface WorkspaceRequestOptions extends ApiRequestOptions {
  skipSftpConnect?: boolean;
  skipHostTrustPrompt?: boolean;
  hostTrustAttempt?: number;
  rawBody?: boolean;
  responseType?: 'json' | 'arrayBuffer';
}

export interface WorkspaceRequestPort {
  fetch: typeof fetch;
  tr(key: string, options: Record<string, unknown>): string;
  quickToken(id: number): string;
  connectSftp(id: number): Promise<boolean>;
  confirmHost(challenge: HostTrustChallenge): Promise<'once' | 'persist' | null>;
  refreshTrustedHosts(): Promise<unknown>;
  extraArgsError(value: WorkspaceError): string;
  requireLogin(): void;
}

const CONNECTION_RESOURCE = /^\/api\/connections\/(-?\d+)\/(sftp|x11-forwarding|x11-applications|terminal-clipboard)(?:[/?]|$)/;
const QUICK_CONNECTION_HEADER = 'X-Terma-Quick-Connection';

function requestedAction(body: ApiRequestOptions['body']): string {
  if (typeof body !== 'string') return '';
  try { return String(JSON.parse(body)?.action || '').trim().toLowerCase(); }
  catch { return ''; }
}

function taskConflict(task: Task, message: string, body: ApiRequestOptions['body']) {
  const existing = {...task, resource_conflict: true, resource_conflict_message: message};
  if (task.type !== 'remote-component') return existing;
  const requested = requestedAction(body);
  const running = String(task.action || '').trim().toLowerCase();
  const same = Boolean(requested && running && requested === running);
  return {ok: same, reused_task: same, task_conflict: true, conflict_same_action: same,
    requested_action: requested, running_action: running, error: message, task: existing};
}

export function createWorkspaceRequest(port: WorkspaceRequestPort, errors: ReturnType<typeof createPublicErrors>) {
  async function request<T = unknown>(route: string, options: WorkspaceRequestOptions = {}): Promise<T> {
    const {skipSftpConnect, skipHostTrustPrompt, hostTrustAttempt = 0, rawBody = false,
      responseType = 'json', ...requestOptions} = options;
    const resource = route.match(CONNECTION_RESOURCE);
    const connectionId = Number(resource?.[1] || 0);
    const headers = new Headers(requestOptions.headers);
    if (connectionId < 0) {
      const token = port.quickToken(connectionId) || headers.get(QUICK_CONNECTION_HEADER);
      if (!token) throw new Error(port.tr('common:notifications.temporary_credentials_expired', {defaultValue: '临时连接凭据已失效，请先重新连接'}));
      headers.set(QUICK_CONNECTION_HEADER, token);
    }
    if (resource?.[2] === 'sftp' && !route.includes('/sftp/session') && !skipSftpConnect) {
      if (await port.connectSftp(connectionId) === false) throw new DOMException(port.tr('sftp:editor.open_aborted', {}), 'AbortError');
    }
    const response = await sendApiRequest(port.fetch, route, {...requestOptions, headers}, rawBody);
    if (responseType === 'arrayBuffer' && response.ok) {
      const data = await response.arrayBuffer();
      return {data, contentType: response.headers.get('content-type') || '', byteLength: data.byteLength} as T;
    }
    const value = await readApiPayload(response);
    if (response.ok) return value as T;
    const data = (value || {}) as WorkspaceError;
    if (response.status === 401) {
      port.requireLogin();
      throw new Error(port.tr('common:api.login_required', {defaultValue: '请先登录'}));
    }
    if (response.status === 409 && (data.code === 'SSH_HOST_KEY_UNKNOWN' || data.code === 'SSH_HOST_KEY_CHANGED')
      && !skipHostTrustPrompt && hostTrustAttempt < 4) {
      const challenge = data.challenge || {};
      const mode = await port.confirmHost(challenge);
      if (!mode) throw Object.assign(new Error(port.tr('common:api.ssh_connection_cancelled', {defaultValue: '已取消 SSH 连接'})), {code: 'SSH_HOST_TRUST_CANCELLED'});
      await request('/api/ssh/host-trust', {method: 'POST', body: JSON.stringify({token: challenge.token, mode}), skipSftpConnect: true, skipHostTrustPrompt: true});
      const result = await request<T>(route, {...options, hostTrustAttempt: hostTrustAttempt + 1});
      if (mode === 'persist') void port.refreshTrustedHosts().catch(() => {});
      return result;
    }
    if (response.status === 409 && data.code === 'REMOTE_TASK_CONFLICT' && data.task?.id) {
      const message = errors.message(data, data.error || port.tr('common:api.task_conflict', {defaultValue: '已有任务正在执行'}));
      return taskConflict(data.task, message, requestOptions.body) as T;
    }
    const localized = data.code === 'SSH_EXTRA_ARGS_INVALID' ? port.extraArgsError(data) : '';
    throw errors.create(data, localized || errors.message(data, data.error || response.statusText), response.status, connectionId);
  }

  return request;
}

export function installWorkspaceRequest(base:Omit<WorkspaceRequestPort,'confirmHost'|'connectSftp'>, confirmHost: WorkspaceRequestPort['confirmHost'], connectSftp: WorkspaceRequestPort['connectSftp']) {
  const port = {...base,confirmHost,connectSftp};
  sharedServices.termaWorkspaceRequest = createWorkspaceRequest(port, sharedServices.termaPublicErrors);
}



export function api<T=unknown>(path:string,options?:WorkspaceRequestOptions):Promise<T>{return sharedServices.termaWorkspaceRequest<T>(path,options);}

export interface InstalledSharedApiWorkspaceRequestServices {
  termaWorkspaceRequest: ReturnType<typeof createWorkspaceRequest>;
}
