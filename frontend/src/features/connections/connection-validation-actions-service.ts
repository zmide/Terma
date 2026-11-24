import {connectionsServices} from '@/features/connections/installed-services';
import {buildConnectionExtraArgsValidationPayload, type ConnectionValidationIssue} from './connection-validation-service';
import {focusExtraArgsIssue, renderExtraArgsDiagnostics} from './connection-validation-view';
import type { ConnectionViewPort } from './connection-port';

export type ConnectionValidationActionsPort = {
  field: (form: any, id: string) => any;
  api: (url: string, options?: Record<string, unknown>) => Promise<any>;
  renderDiagnostics: (form: any, issues: ConnectionValidationIssue[]) => void;
  focusIssue: (form: any, issue: ConnectionValidationIssue) => void;
  notify: (message: string, kind?: string) => void;
  tr: (key: string, values?: Record<string, unknown>) => string;
};

export type ConnectionValidationActionsService = {
  validate(form: HTMLFormElement): Promise<any>;
  schedule(form: HTMLFormElement, delay?: number): void;
  invalidate(form: HTMLFormElement): void;
  ensureValid(form: HTMLFormElement): Promise<boolean>;
};

export function createConnectionValidationActionsService(port: ConnectionValidationActionsPort): ConnectionValidationActionsService {
  type ValidationState = {revision: number; timer?: ReturnType<typeof setTimeout>};
  const states = new WeakMap<HTMLFormElement, ValidationState>();
  function stateFor(form: HTMLFormElement) {
    const current = states.get(form);
    if (current) return current;
    const state: ValidationState = {revision: 0};
    states.set(form, state);
    return state;
  }

  async function validate(form: HTMLFormElement, background = false) {
    if (!form?.isConnected) return {ok: true, args: [], issues: []};
    const state = stateFor(form);
    clearTimeout(state.timer);
    state.timer = undefined;
    const revision = ++state.revision;
    const isCurrent = () => form.isConnected && state.revision === revision;
    const payload = buildConnectionExtraArgsValidationPayload({
      extraArgs: port.field(form, 'conn_extra')?.value,
      connectTimeoutSeconds: port.field(form, 'conn_connect_timeout')?.value,
      keepaliveIntervalSeconds: port.field(form, 'conn_keepalive_interval')?.value,
      keepaliveCountMax: port.field(form, 'conn_keepalive_count')?.value,
      tcpKeepalive: port.field(form, 'conn_tcp_keepalive')?.value
    });
    if (!String(payload.extra_args || '').trim()) {
      const result = {ok: true, args: [], issues: []};
      port.renderDiagnostics(form, result.issues);
      return result;
    }
    try {
      const result = await port.api('/api/ssh/extra-args/validate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!isCurrent()) return result;
      port.renderDiagnostics(form, Array.isArray(result?.issues) ? result.issues : []);
      return result;
    } catch (error: any) {
      if (isCurrent() && Array.isArray(error?.details?.issues)) port.renderDiagnostics(form, error.details.issues);
      if (!background) throw error;
      return null;
    }
  }

  function schedule(form: HTMLFormElement, delay = 180) {
    if (!form?.isConnected) return;
    const state = stateFor(form);
    clearTimeout(state.timer);
    ++state.revision;
    state.timer = setTimeout(() => { void validate(form, true); }, delay);
  }

  function invalidate(form: HTMLFormElement) {
    const state = states.get(form);
    if (!state) return;
    clearTimeout(state.timer);
    state.timer = undefined;
    ++state.revision;
  }

  async function ensureValid(form: HTMLFormElement) {
    if (!form?.isConnected) return false;
    const request = validate(form);
    const state = stateFor(form);
    const revision = state.revision;
    const isCurrent = () => form.isConnected && revision === state.revision;
    const result = await request.catch(error => {
      if (isCurrent()) throw error;
      return null;
    });
    if (!isCurrent()) return false;
    const firstError = result?.issues?.find((item: ConnectionValidationIssue) => item?.severity === 'error');
    if (!firstError) return true;
    port.focusIssue(form, firstError);
    port.notify(port.tr('common:notifications.ssh_extra_argument_line', {
      line: firstError.line || 1,
      defaultValue: `SSH 附加参数第 ${firstError.line || 1} 行需要修正`
    }), 'error');
    return false;
  }

  return {validate, schedule, invalidate, ensureValid};
}

export function installConnectionValidationActionsService(port: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionValidationActions) {
    connectionsServices.termaConnectionValidationActions = createConnectionValidationActionsService({
      field: port.field,
      api: port.api,
      renderDiagnostics: renderExtraArgsDiagnostics,
      focusIssue: focusExtraArgsIssue,
      notify: port.notify,
      tr: port.tr
    });
  }
}



export interface InstalledFeaturesConnectionsConnectionValidationActionsServiceServices {
  termaConnectionValidationActions?: ConnectionValidationActionsService;
}
