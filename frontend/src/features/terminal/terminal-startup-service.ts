import type { TerminalStartupOptions, TerminalStartupProfile } from './TerminalStartupView';
import { createTerminalSessionComponentService, type TerminalSessionManagementPort } from './terminal-session-component-service';

import { normalizeTerminalStartupConfig, terminalSessionBackendForStartup } from './terminal-startup-model';
export { normalizeTerminalStartupConfig, terminalSessionBackendForStartup } from './terminal-startup-model';
type Startup = ReturnType<typeof normalizeTerminalStartupConfig>;

type Capabilities = {
  platform?: string; platform_label?: string;
  default_shell?: {label?: string; name?: string};
  profiles?: TerminalStartupProfile[];
  tools?: {label?: string; name?: string; version?: string}[];
  warnings?: string[];
};
type Connection = Partial<Startup> & {id: number; terminal_capabilities?: Capabilities};
type Target = 'current' | 'new' | 'split';
type StartupFormFields = {
  terminal_startup_mode: string;
  terminal_profile_name: string;
  terminal_profile_kind: string;
  terminal_program_path: string;
  terminal_program_args: string;
  terminal_working_directory: string;
  terminal_program_platform: string;
};

export interface TerminalStartupPort {
  componentManagement?: TerminalSessionManagementPort;
  api<T>(path: string, options?: {method: string; body: string}): Promise<T>;
  tr(key: string, params?: Record<string, unknown>): string;
  notify(message: string, kind: 'success' | 'error'): void;
  connection(key: string, id: number): Connection | null;
  savedConnection(id: number): Connection | null;
  enqueue<T>(id: number, operation: () => Promise<T>): Promise<T>;
  effective(connection: Connection, key: string): Startup;
  temporary(key: string): boolean;
  override(key: string, value: Startup | null): void;
  context(): unknown;
  isCurrent(context: unknown, key: string, id: number): boolean;
  applying(): boolean;
  busy(context: unknown, value: boolean): void;
  buttonBusy(button: HTMLElement | null, value: boolean, label?: string): void;
  formValue(): StartupFormFields;
  saveDefaultChecked(): boolean;
  refresh(): void;
  close(key: string, focus: boolean): void;
  updateButton(key: string, connection: Connection): void;
  updateButtons(id: number): void;
  reconnect(id: number, key: string): void;
  mobile(): boolean;
  duplicate(key: string, splitZone: string, beforeOpen: (key: string) => void): {key: string; split: boolean} | null;
}

function errorMessage(cause: unknown): string {
  return cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '';
}

function startupFromForm(port: TerminalStartupPort): Startup {
  const fields = port.formValue();
  const values: Record<string, string> = {};
  const fieldRules = [
    ['terminal_profile_name', 'terminal:startup.profile_name', 120],
    ['terminal_program_path', 'terminal:startup.program_path', 2048],
    ['terminal_program_args', 'terminal:startup.startup_args', 4096],
    ['terminal_working_directory', 'terminal:startup.working_directory_short', 2048]
  ] as const;
  for (const [field, label, maximum] of fieldRules) {
    const value = String(fields[field] || '').trim();
    if (/[\r\n\0]/.test(value)) {
      throw new Error(port.tr('terminal:startup.single_line_only', {field: port.tr(label)}));
    }
    if (value.length > maximum) {
      throw new Error(port.tr('terminal:startup.maximum_characters', {field: port.tr(label), maximum}));
    }
    values[field] = value;
  }
  const mode: Startup['terminal_startup_mode'] = fields.terminal_startup_mode === 'default' ? 'default' : 'program';
  if (mode === 'program' && !values.terminal_program_path) {
    throw new Error(port.tr('terminal:startup.path_required'));
  }
  return normalizeTerminalStartupConfig({
    terminal_startup_mode: mode,
    terminal_profile_name: values.terminal_profile_name,
    terminal_profile_kind: fields.terminal_profile_kind || 'custom',
    terminal_program_path: values.terminal_program_path,
    terminal_program_args: values.terminal_program_args,
    terminal_working_directory: values.terminal_working_directory,
    terminal_program_platform: (fields.terminal_program_platform || 'auto') as Startup['terminal_program_platform']
  });
}

export function createTerminalStartupService(port: TerminalStartupPort) {
  const components = createTerminalSessionComponentService(port);
  function saveDefault(id: number, startup: Startup) {
    const snapshot = {...startup};
    return port.enqueue(id, () => saveDefaultNow(id, snapshot));
  }

  async function saveDefaultNow(id: number, startup: Startup) {
    const connection = port.savedConnection(id);
    if (!connection) throw new Error(port.tr('terminal:startup.connection_missing'));
    const response = await port.api<Partial<Startup> & {startup?: Partial<Startup>}>(`/api/connections/${id}/terminal-startup`, {
      method: 'POST', body: JSON.stringify(startup)
    });
    const latest = port.savedConnection(id);
    if (latest) {
      Object.assign(latest, normalizeTerminalStartupConfig(response.startup || response));
      port.updateButtons(id);
    }
    return latest;
  }

  async function apply(key: string, id: number, target: Target, button: HTMLElement | null = null, splitZone = '', draft: Startup | null = null, save: boolean | null = null) {
    let connection = port.connection(key, id);
    const context = port.context();
    if (!connection || port.applying() || !port.isCurrent(context, key, id)) return;
    port.busy(context, true);
    port.buttonBusy(button, true, port.tr(target === 'current' ? 'terminal:startup.opening' : 'terminal:startup.creating'));
    let defaultSaved = false;
    try {
      const startup = draft ? normalizeTerminalStartupConfig(draft) : startupFromForm(port);
      const saveDefaultValue = save == null ? port.saveDefaultChecked() : save;
      if (saveDefaultValue) {
        connection = await saveDefault(id, startup);
        defaultSaved = true;
      }
      if (!connection || !port.isCurrent(context, key, id)) return;
      if (target === 'current') {
        port.override(key, saveDefaultValue ? null : startup);
        port.close(key, true);
        port.updateButton(key, connection);
        port.reconnect(id, key);
        port.notify(port.tr(saveDefaultValue ? 'terminal:startup.saved_reconnecting' : 'terminal:startup.temporary_reconnecting'), 'success');
        return;
      }
      const result = port.duplicate(key, target === 'split' && !port.mobile() ? splitZone : '', newKey =>
        port.override(newKey, saveDefaultValue ? null : startup));
      if (!result) throw new Error(port.tr('terminal:startup.new_tab_failed'));
      port.close(key, false);
      const destination = port.tr(result.split ? 'terminal:startup.new_split' : 'terminal:startup.new_tab');
      port.notify(port.tr(saveDefaultValue ? 'terminal:startup.saved_opened' : 'terminal:startup.temporary_opened', {destination}), 'success');
    } catch (cause) {
      if (!port.isCurrent(context, key, id)) return;
      const message = errorMessage(cause);
      port.notify(defaultSaved
        ? port.tr('terminal:startup.saved_open_failed', {error: message || port.tr('terminal:startup.unknown_error')})
        : message || port.tr('terminal:startup.apply_failed'), 'error');
    } finally {
      port.buttonBusy(button, false);
      if (port.context() === context) port.busy(context, false);
    }
  }

  function restore(key: string, id: number) {
    const context = port.context(), connection = port.connection(key, id);
    if (!connection || port.applying() || !port.isCurrent(context, key, id)) return;
    port.override(key, null);
    port.close(key, true);
    port.updateButton(key, connection);
    port.reconnect(id, key);
    port.notify(port.tr('terminal:startup.restored_saved'), 'success');
  }

  function options(key: string, id: number): TerminalStartupOptions | null {
    const connection = port.connection(key, id);
    if (!connection) return null;
    let request = 0;
    const value: TerminalStartupOptions = {
      key, connectionId: id, temporary: port.temporary(key),
      draft: normalizeTerminalStartupConfig(port.effective(connection, key)), saved: normalizeTerminalStartupConfig(connection),
      profiles: [], saveDefault: false, isMobile: port.mobile(), busy: false,
      capability: {status: 'idle'}, session: {status: 'idle'}, tr: port.tr,
      actions: {
        close: () => { if (!value.busy) port.close(key, true); },
        restore: () => restore(key, id),
        detect,
        apply: (target, splitZone, draft, save) => apply(key, id, target, null, splitZone, draft, save)
      }
    };
    function populate(capabilities: Capabilities) {
      Object.assign(value.capability, {
        status: 'success', error: undefined, headline: '',
        platform: capabilities.platform_label || capabilities.platform || '',
        shell: capabilities.default_shell?.label || capabilities.default_shell?.name || '',
        detected: (Array.isArray(capabilities.tools) ? capabilities.tools : []).map(tool => `${tool.label || tool.name}${tool.version ? ` ${tool.version}` : ''}`),
        warnings: Array.isArray(capabilities.warnings) ? capabilities.warnings.filter(Boolean) : []
      });
      value.profiles = Array.isArray(capabilities.profiles) ? capabilities.profiles : [];
    }
    async function detect() {
      const context = port.context(), attempt = ++request;
      const current = () => request === attempt && port.isCurrent(context, key, id);
      if (value.busy || !current()) return;
      value.capability.status = 'loading';
      value.session.status = 'loading';
      port.refresh();
      try {
        const response = await port.api<Capabilities & {capabilities?: Capabilities}>(`/api/connections/${id}/terminal-capabilities`, {method: 'POST', body: '{}'});
        if (!current()) return;
        const capabilities = response.capabilities || response || {};
        populate(capabilities);
        connection!.terminal_capabilities = capabilities;
      } catch (cause) {
        if (!current()) return;
        const message = errorMessage(cause);
        value.capability.status = 'warning';
        value.capability.error = message;
      }
      if (!current()) return;
      try {
        await components.detect(value, current);
      } catch (cause) {
        if (current()) Object.assign(value.session, {status: 'warning', message: errorMessage(cause)});
      } finally {
        if (current()) port.refresh();
      }
    }
    if (connection.terminal_capabilities) populate(connection.terminal_capabilities);
    components.bind(value);
    return value;
  }

  function label(config: unknown) {
    const value = normalizeTerminalStartupConfig(config);
    if (value.terminal_startup_mode === 'default') return port.tr('terminal:startup.server_default_shell', {defaultValue: '服务器默认 Shell'});
    return value.terminal_profile_name || value.terminal_program_path.split(/[\\/]/).pop() || port.tr('terminal:startup.custom_program', {defaultValue: '自定义程序'});
  }

  return {options, saveDefault, apply, restore, components, normalize: normalizeTerminalStartupConfig,
    backend: terminalSessionBackendForStartup, label};
}

