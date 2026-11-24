import type { QuickConnectionSearchRecord, QuickSshSearchTarget, QuickViewHost } from './quick-port';

export type QuickSshSubmission = {
  form: HTMLFormElement;
  cancelled: boolean;
};

export type QuickSshTicketPayload = {
  [key: string]: unknown;
  name: string;
  ssh_user: string;
  ssh_host: string;
  ssh_port: number;
  auth_type: 'password' | 'key';
  ssh_password: string;
  identity_file: string;
  private_key_passphrase: string;
  quick_connection_id: number;
};

export type QuickSshSubmitOptions = {
  form: HTMLFormElement;
  trigger: HTMLElement | null;
  submission: QuickSshSubmission;
  payload: QuickSshTicketPayload;
};

export type QuickSshSubmitResult = {
  cancelled: boolean;
  ticket?: { connection: Record<string, unknown>; token: string };
};

export type QuickSshService = {
  endpoint(target?: Partial<QuickSshSearchTarget>): string;
  parse(value: unknown): QuickSshSearchTarget | null;
  matching(target: QuickSshSearchTarget | null): QuickConnectionSearchRecord[];
  submit(options: QuickSshSubmitOptions): Promise<QuickSshSubmitResult>;
};

function endpoint(target: Partial<QuickSshSearchTarget> = {}) {
  const host = String(target.host || '');
  const displayHost = host.includes(':') ? `[${host}]` : host;
  return `${target.user ? `${target.user}@` : ''}${displayHost}:${Number(target.port || 22)}`;
}

function parse(value: unknown): QuickSshSearchTarget | null {
  const raw = String(value || '').trim();
  if (!raw || /[\0\r\n\t ]/.test(raw) || /[\\/?#]/.test(raw)) return null;
  const at = raw.lastIndexOf('@');
  const user = at >= 0 ? raw.slice(0, at) : '';
  const endpoint = at >= 0 ? raw.slice(at + 1) : raw;
  if (at >= 0 && !user) return null;
  if (!endpoint || user.startsWith('-') || endpoint.startsWith('-')) return null;
  if (user && /[:\\/]/.test(user)) return null;
  let host = endpoint;
  let port = 22;
  if (endpoint.startsWith('[')) {
    const closing = endpoint.indexOf(']');
    if (closing <= 1) return null;
    host = endpoint.slice(1, closing);
    const suffix = endpoint.slice(closing + 1);
    if (suffix) {
      if (!/^:\d+$/.test(suffix)) return null;
      port = Number(suffix.slice(1));
    }
  } else if ((endpoint.match(/:/g) || []).length === 1) {
    const separator = endpoint.lastIndexOf(':');
    const candidatePort = endpoint.slice(separator + 1);
    if (!/^\d+$/.test(candidatePort)) return null;
    host = endpoint.slice(0, separator);
    port = Number(candidatePort);
  }
  if (!host || host.startsWith('-') || !/^[A-Za-z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {raw, user, host, port, user_missing: !user};
}

function clearPayloadSecrets(payload: QuickSshTicketPayload) {
  payload.ssh_password = '';
  payload.private_key_passphrase = '';
  payload.identity_file = '';
}

function statusElement(port: QuickViewHost) {
  return port.$('quickSshStatus') as HTMLElement | null;
}

export function createQuickSshService(port: QuickViewHost): QuickSshService {
  function matching(target: QuickSshSearchTarget | null) {
    if (!target) return [];
    const host = String(target.host || '').toLowerCase();
    const user = String(target.user || '');
    return port.connections.filter(connection =>
      String(connection.ssh_host || '').toLowerCase() === host
      && Number(connection.ssh_port || 22) === Number(target.port || 22)
      && (!user || String(connection.ssh_user || '') === user));
  }

  async function submit(options: QuickSshSubmitOptions): Promise<QuickSshSubmitResult> {
    const {form, trigger, submission, payload} = options;
    if (form.dataset.submitting === '1') return {cancelled: true};

    form.dataset.submitting = '1';
    port.setButtonBusy(trigger, true, port.tr('connections:quick_ssh.connecting', {defaultValue: '连接中...'}));
    const status = statusElement(port);
    if (status) {
      status.textContent = port.tr('connections:quick_ssh.verifying_host', {defaultValue: '正在校验 SSH 主机身份...'});
      status.className = 'quick-ssh-status';
    }

    try {
      await port.api('/api/ssh/preflight', {
        method: 'POST',
        body: JSON.stringify({
          connection: {
            ssh_user: payload.ssh_user,
            ssh_host: payload.ssh_host,
            ssh_port: payload.ssh_port
          }
        })
      });
      if (submission.cancelled) {
        clearPayloadSecrets(payload);
        return {cancelled: true};
      }
      if (status) status.textContent = port.tr('connections:quick_ssh.creating_ticket', {defaultValue: '正在创建一次性连接凭据...'});
      const ticket = await port.api('/api/terminal/quick-tickets', {
        method: 'POST',
        body: JSON.stringify(payload)
      }) as {connection: Record<string, unknown>; token: string};
      clearPayloadSecrets(payload);
      if (submission.cancelled) {
        await port.api('/api/terminal/quick-tickets', {
          method: 'DELETE',
          body: JSON.stringify({token: ticket.token}),
          skipSftpConnect: true,
          skipHostTrustPrompt: true
        }).catch(() => {});
        return {cancelled: true};
      }
      return {cancelled: false, ticket};
    } catch (error: any) {
      clearPayloadSecrets(payload);
      if (status) {
        status.textContent = port.localizedTermaUiPhrase(error?.message || port.tr('connections:quick_ssh.failed', {defaultValue: '快速连接失败'}));
        status.className = 'quick-ssh-status error';
      }
      throw error;
    } finally {
      form.dataset.submitting = '';
      port.setButtonBusy(trigger, false);
    }
  }

  return {endpoint, parse, matching, submit};
}

export function createQuickSshFlow(port: QuickViewHost, service: QuickSshService, view: {
  closeLauncher(): void;
  closeAuth(): void;
  openAuth(target: Partial<QuickSshSearchTarget>): Promise<unknown>;
}) {
  let pending: QuickSshSubmission | null = null;
  const input = (id: string) => port.$(id) as HTMLInputElement | null;
  const value = (id: string) => input(id)?.value || '';
  const authType = () => (port.$('modal') as HTMLElement | null)?.querySelector<HTMLInputElement>('input[name="quickSshAuthType"]:checked')?.value === 'key' ? 'key' as const : 'password' as const;

  function clearSecrets() {
    for (const id of ['quickSshPassword', 'quickSshPassphrase']) {
      const field = input(id);
      if (field) field.value = '';
    }
  }

  function cancel() {
    if (pending) pending.cancelled = true;
    clearSecrets();
  }

  function closeSurfaces() {
    view.closeLauncher();
    port.closeQuickPanel();
  }

  function formTarget(form: HTMLFormElement | null): Partial<QuickSshSearchTarget> {
    return {user: value('quickSshUser').trim(), host: form?.dataset.host || '', port: Number(value('quickSshPort') || 22)};
  }

  async function submit(form: HTMLFormElement, trigger: HTMLElement | null) {
    if (form.dataset.submitting === '1') return;
    if (pending) pending.cancelled = true;
    const submission = {form, cancelled: false};
    pending = submission;
    const reconnectKey = form.dataset.reconnectKey || '';
    const target = formTarget(form);
    const auth = authType();
    try {
      const result = await service.submit({form, trigger, submission, payload: {
        name: service.endpoint(target),
        ssh_user: target.user || '',
        ssh_host: target.host || '',
        ssh_port: target.port ?? 22,
        auth_type: auth,
        ssh_password: auth === 'password' ? value('quickSshPassword') : '',
        identity_file: auth === 'key' ? value('quickSshIdentity') : '',
        private_key_passphrase: auth === 'key' ? value('quickSshPassphrase') : '',
        quick_connection_id: port.quickSessionId(reconnectKey)
      }});
      if (result.cancelled || !result.ticket) return;
      clearSecrets();
      view.closeAuth();
      if (reconnectKey) port.resumeQuickTerminal(reconnectKey, result.ticket.connection, result.ticket.token);
      else port.openQuickTerminal(result.ticket.connection, result.ticket.token);
    } finally {
      if (pending === submission) pending = null;
    }
  }

  function prefill(target: Partial<QuickSshSearchTarget> = {}) {
    closeSurfaces();
    if (port.$('modal')?.dataset.quickSshAuth === '1') view.closeAuth();
    if (port.newSshConnection() === false) return;
    const fields = {
      conn_name: service.endpoint(target).replace(/:22$/, '') || target.host || '',
      conn_user: target.user || '',
      conn_host: target.host || '',
      conn_port: String(target.port || 22)
    };
    for (const [id, text] of Object.entries(fields)) {
      const field = input(id);
      if (field) field.value = text;
    }
    setTimeout(() => input(target.user ? 'conn_name' : 'conn_user')?.focus({preventScroll: true}), 0);
  }

  function runDefault(query: string) {
    const target = service.parse(query);
    if (!target) return false;
    const saved = service.matching(target)[0];
    if (saved) {
      closeSurfaces();
      port.openSavedTerminal(Number(saved.id));
    } else {
      void view.openAuth(target).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        port.notify(port.localizedTermaUiPhrase(message || port.tr('connections:quick_ssh.failed', {defaultValue: '快速连接失败'})), 'error');
      });
    }
    return true;
  }

  return {authType, clearSecrets, cancel, closeSurfaces, formTarget, submit, prefill, runDefault};
}



export interface InstalledFeaturesQuickQuickSshServiceServices {
  termaQuickSshService: QuickSshService;
  termaQuickSshFlow: ReturnType<typeof createQuickSshFlow>;
}
