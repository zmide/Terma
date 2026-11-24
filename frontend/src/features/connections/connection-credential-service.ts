import {connectionsServices} from '@/features/connections/installed-services';
import { showOperationsModal } from '../operations/operations-modal';
import { connectionCredentialView, type ConnectionCredentialDialogState, type ConnectionCredentialIdentity } from './ConnectionCredentialDialog';
import { uploadConnectionKey } from './connection-key-options';
import { createTemporarySshConnection, sshAuthenticationFailure, sshCredentialRepairPayload, type SshCredentialConnection, type SshCredentialValues, type TemporarySshTicket } from './connection-credential-model';
export type { SshCredentialConnection, SshCredentialValues, TemporarySshTicket } from './connection-credential-model';

export type ConnectionCredentialPromptOptions = {
  context?: string;
  onTemporary?: (connection: SshCredentialConnection, token: string) => Promise<void> | void;
};

type ConnectionCredentialPort = {
  api(url: string, options?: {method?: string; body?: string}): Promise<any>;
  tr(key: string, values?: Record<string, unknown>): string;
  localize?(message: string): string;
  notify(message: string, kind?: string): void;
  localizedIdentityFileLabel?(identity: ConnectionCredentialIdentity, options?: Record<string, unknown>): string;
};

function promptLabels(port: ConnectionCredentialPort, connection: SshCredentialConnection, temporaryAllowed: boolean) {
  const t = (key: string, values?: Record<string, unknown>) => port.tr(`connections:credentials.${key}`, values);
  return {
    title: t('repair_title', {defaultValue: '修复 SSH 认证'}),
    close: port.tr('common:actions.close', {defaultValue: '关闭'}),
    cancel: port.tr('common:actions.cancel', {defaultValue: '取消'}),
    hostHint: t('host_unchanged_hint', {defaultValue: '主机地址保持不变；可修正当前账号和 SSH 端口。'}),
    username: port.tr('connections:auto.ssh_user', {defaultValue: 'SSH 用户名'}),
    port: port.tr('connections:auto.ssh_port', {defaultValue: '端口'}),
    loginMethod: port.tr('connections:auto.login_method', {defaultValue: '认证方式'}),
    passwordLogin: port.tr('connections:auto.password_login', {defaultValue: '密码'}),
    keyLogin: port.tr('connections:auto.key_login', {defaultValue: '私钥'}),
    password: port.tr('connections:auto.ssh_password', {defaultValue: 'SSH 密码'}),
    identity: port.tr('connections:auto.key_login', {defaultValue: '私钥'}),
    selectIdentity: port.tr('connections:identity.select', {defaultValue: '请选择私钥'}),
    uploadKey: port.tr('connections:auto.upload_key', {defaultValue: '上传私钥'}),
    passphrase: port.tr('connections:auto.key_passphrase', {defaultValue: '私钥口令（可选）'}),
    save: t('save_to_connection', {name: connection.name || connection.ssh_host, defaultValue: `保存到“${connection.name || connection.ssh_host}”连接`}),
    verifyFirst: t('verify_first', {defaultValue: '连接前会先验证新凭据。'}),
    temporaryHint: t('temporary_hint', {defaultValue: '取消保存时只创建当前终端或 SFTP 使用的临时会话，最长 12 小时。'}),
    saveRequiredHint: t('save_required_hint', {defaultValue: '当前操作需要保存凭据后重试。'}),
    uploadHint: t('upload_management_hint', {defaultValue: '上传的私钥会进入 Terma 密钥管理；即使不保存此连接，也不会自动删除已上传的密钥。'}),
    verifyConnect: t('verify_connect', {defaultValue: '验证并连接'}),
    verifying: t('verifying', {defaultValue: '验证中...'}),
    uploading: t('uploading_checking', {defaultValue: '正在上传并检查私钥权限...'}),
    saving: t('verified_saving', {defaultValue: '验证成功，正在保存连接...'}),
    temporary: t('verified_creating_temporary', {defaultValue: '验证成功，正在创建临时会话...'}),
    fileNotSelected: port.tr('common:auto.not_selected', {defaultValue: '未选择文件'}),
    temporaryAllowed
  };
}

function promptError(port: ConnectionCredentialPort, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return port.localize?.(message) || message;
}

export function createConnectionCredentialService() {
  let active: {busy: boolean; cancel(): void} | null = null;
  async function prompt(connection: SshCredentialConnection, options: ConnectionCredentialPromptOptions = {}, port: ConnectionCredentialPort) {
    if (active) {
      port.notify(port.tr('connections:credentials.repair_active', {defaultValue: '已有 SSH 凭据修复窗口，请先完成当前操作'}), 'info');
      return null;
    }
    const modal = document.getElementById('modal');
    if (!modal) return null;
    const identities = await port.api('/api/identity-files').catch(() => []) as ConnectionCredentialIdentity[];
    const temporaryAllowed = typeof options.onTemporary === 'function';
    const state: ConnectionCredentialDialogState = {
      user: String(connection.ssh_user || ''),
      port: String(Number(connection.ssh_port || 22)),
      authType: connection.auth_type === 'password' ? 'password' : 'key',
      password: '',
      identityFile: String(connection.identity_file || ''),
      passphrase: '',
      save: true,
      busy: false,
      phase: 'idle',
      error: '',
      fileName: '',
      identities: Array.isArray(identities) ? identities : []
    };
    const context = port.localize?.(options.context || port.tr('connections:credentials.reconnect', {defaultValue: '重新连接'}))
      || options.context
      || port.tr('connections:credentials.reconnect', {defaultValue: '重新连接'});
    let settled = false;
    let binding: {alive(): boolean; paint(): void; close(): void} | null = null;
    let resolvePrompt: ((value: {saved: true; connectionId: number} | {saved: false; ticket: TemporarySshTicket} | null) => void) | null = null;
    const clearSecrets = () => { state.password = ''; state.passphrase = ''; };
    const finish = (value: {saved: true; connectionId: number} | {saved: false; ticket: TemporarySshTicket} | null) => {
      if (settled) return;
      settled = true;
      clearSecrets();
      active = null;
      modal.dataset.sshCredentialRepair = '';
      binding?.close();
      resolvePrompt?.(value);
      resolvePrompt = null;
    };
    const paint = () => binding?.paint();
    const setError = (message: string) => {
      state.busy = false;
      state.phase = 'error';
      state.error = message;
      paint();
    };
    const service = {
      busy: false,
      cancel: () => { if (!state.busy) finish(null); }
    };
    active = service;
    const promise = new Promise<{saved: true; connectionId: number} | {saved: false; ticket: TemporarySshTicket} | null>(resolve => {
      resolvePrompt = resolve;
      const actions = {
        change(field: 'user' | 'port' | 'authType' | 'password' | 'identityFile' | 'passphrase' | 'save', value: string | boolean) {
          if (field === 'authType') state.authType = value === 'key' ? 'key' : 'password';
          else if (field === 'save') state.save = Boolean(value);
          else state[field] = String(value) as never;
          state.error = '';
          if (state.phase === 'error') state.phase = 'idle';
          paint();
        },
        async upload(file?: File) {
          if (!file || settled || state.busy) return;
          state.busy = true;
          state.phase = 'uploading';
          state.error = '';
          state.fileName = file.name;
          paint();
          try {
            const saved = await uploadConnectionKey(file);
            if (settled) return;
            state.identities = [...state.identities, saved];
            state.identityFile = String(saved.path || '');
            state.phase = 'idle';
          } catch (error) {
            setError(promptError(port, error, port.tr('connections:credentials.upload_failed', {defaultValue: '私钥上传失败'})));
          } finally {
            if (!settled) {
              state.busy = false;
              paint();
            }
          }
        },
        async submit() {
          if (settled || state.busy) return;
          const user = state.user.trim();
          const portNumber = Number(state.port || 22);
          if (!user) return port.notify(port.tr('connections:credentials.user_required', {defaultValue: '请输入 SSH 用户名'}), 'error');
          if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return port.notify(port.tr('connections:credentials.port_invalid', {defaultValue: 'SSH 端口必须在 1-65535 之间'}), 'error');
          if (state.authType === 'password' && !state.password) return port.notify(port.tr('connections:credentials.password_required', {defaultValue: '请输入 SSH 密码'}), 'error');
          if (state.authType === 'key' && !state.identityFile) return port.notify(port.tr('connections:credentials.key_required', {defaultValue: '请选择或上传私钥'}), 'error');
          const payload = sshCredentialRepairPayload(connection, {
            ssh_user: user,
            ssh_port: portNumber,
            auth_type: state.authType,
            ssh_password: state.password,
            identity_file: state.identityFile,
            private_key_passphrase: state.passphrase
          });
          state.busy = true;
          service.busy = true;
          state.phase = 'verifying';
          state.error = '';
          paint();
          try {
            await port.api('/api/ssh/preflight', {
              method: 'POST',
              body: JSON.stringify({connection: {ssh_user: payload.ssh_user, ssh_host: payload.ssh_host, ssh_port: payload.ssh_port}})
            });
            const tested = await port.api('/api/test-ssh', {method: 'POST', body: JSON.stringify(payload)});
            if (!tested?.ok) throw new Error(tested?.output || tested?.error || port.tr('connections:credentials.verification_failed', {defaultValue: 'SSH 凭据验证失败'}));
            const save = Boolean(state.save || !temporaryAllowed);
            if (save) {
              state.phase = 'saving';
              paint();
              await port.api(`/api/connections/${Number(connection.id)}`, {method: 'PUT', body: JSON.stringify(payload)});
              finish({saved: true, connectionId: Number(connection.id)});
              return;
            }
            state.phase = 'temporary';
            paint();
            const name = connection.name || connection.ssh_host;
            const ticket = await port.api('/api/terminal/quick-tickets', {
              method: 'POST',
              body: JSON.stringify({...payload, name: port.tr('connections:credentials.temporary_name', {name, defaultValue: `${name} · 临时认证`})})
            }) as TemporarySshTicket;
            finish({saved: false, ticket});
          } catch (error) {
            setError(promptError(port, error, port.tr('connections:credentials.verification_failed', {defaultValue: 'SSH 凭据验证失败'})));
          } finally {
            state.busy = false;
            service.busy = false;
            clearSecrets();
            if (!settled) paint();
          }
        },
        cancel: () => service.cancel()
      };
      binding = showOperationsModal(() => connectionCredentialView({
        connection,
        context,
        temporaryAllowed,
        state,
        labels: promptLabels(port, connection, temporaryAllowed),
        identityLabel: identity => port.localizedIdentityFileLabel?.(identity, {permission: true}) || String(identity.path || ''),
        actions
      }), () => finish(null), () => state.busy);
      modal.dataset.sshCredentialRepair = '1';
      queueMicrotask(() => {
        if (!binding?.alive()) return;
        document.getElementById(state.authType === 'password' ? 'sshCredentialPassword' : 'sshCredentialIdentity')?.focus({preventScroll: true});
      });
    });
    return promise;
  }
  return {
    authenticationFailure: sshAuthenticationFailure,
    repairPayload: sshCredentialRepairPayload,
    temporaryConnection: createTemporarySshConnection,
    prompt
  };
}

export function installConnectionCredentialService() {
  if (!connectionsServices.termaConnectionCredentials) connectionsServices.termaConnectionCredentials = createConnectionCredentialService();
}



export interface InstalledFeaturesConnectionsConnectionCredentialServiceServices {
  termaConnectionCredentials?: ReturnType<typeof createConnectionCredentialService>;
}
