import { connectionStamp, type ManagementConnection } from '../remote/management-types';
import type { createRemoteInstallGuideService } from '../remote/install-guide-service';
import type { createRemoteComponentTaskService, RemoteComponentTask } from '../remote/component-task-service';
import type { ManagementModel } from '../remote/RemoteManagementView';
import type { TerminalStartupOptions, TerminalStartupSession } from './TerminalStartupView';
import type { TerminalStartupPort } from './terminal-startup-service';

type Action = 'install' | 'install-offline' | 'install-local-offline' | 'uninstall';
type Plan = Record<string, unknown>;
export interface TerminalSessionManagementPort {
  options(): TerminalStartupOptions | null;
  connection(id: number): ManagementConnection | undefined;
  unlocked(label: string): boolean;
  guides(): Pick<ReturnType<typeof createRemoteInstallGuideService>, 'install' | 'manual' | 'mode'>;
  tasks(): Pick<ReturnType<typeof createRemoteComponentTaskService>, 'watch' | 'model'>;
  prompt<T>(options: TerminalStartupOptions, selector: string, run: (valid: () => boolean) => Promise<T>, valid: () => boolean): Promise<T | null>;
  confirmLocal(): Promise<boolean>;
  authorize(id: number, label: string, scope: string, valid: () => boolean): Promise<{admin_grant_id: string} | null>;
  copy(commands: string[]): Promise<void>;
  refreshTasks(): void;
}

export function createTerminalSessionComponentService(port: TerminalStartupPort) {
  const requests = new WeakMap<TerminalStartupOptions, number>();
  const mutations = new Set<number>();
  const management = port.componentManagement;
  const current = (options: TerminalStartupOptions, context: unknown) => (!management || management.options() === options) && port.isCurrent(context, options.key, options.connectionId);
  const message = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : '';
  const mode = (action: Action) => action === 'install-local-offline' ? 'local-offline' : action === 'install-offline' ? 'offline' : 'online';
  const actionKeys: Record<string, string> = {
    install: 'install_online', 'install-offline': 'install_offline', 'install-local-offline': 'install_local', uninstall: 'uninstall'
  };
  const label = (action: string) => port.tr(`terminal:session.${actionKeys[action] || 'operation_failed'}`);
  const running = (options: TerminalStartupOptions, component: string) => {
    const task = options.session.tasks?.[component];
    return task && !['done', 'failed', 'cancelled'].includes(String(task.status).toLowerCase());
  };

  async function detect(options: TerminalStartupOptions, valid: () => boolean) {
    const request = (requests.get(options) || 0) + 1;
    requests.set(options, request);
    try {
      const response = await port.api<TerminalStartupSession>(`/api/connections/${options.connectionId}/terminal-session-components`);
      if (!valid() || requests.get(options) !== request) return;
      Object.assign(options.session, {
        status: 'success', supported: response?.supported !== false, root: response?.root === true,
        components: response?.components || {}, message: ''
      });
    } catch (cause) {
      if (valid() && requests.get(options) === request) throw cause;
    }
  }

  async function refresh(options: TerminalStartupOptions) {
    const context = port.context();
    if (!current(options, context)) return;
    options.session.status = 'loading';
    port.refresh();
    try {
      await detect(options, () => current(options, context));
    } catch (cause) {
      if (current(options, context)) Object.assign(options.session, {status: 'warning', message: message(cause)});
    } finally {
      if (current(options, context)) port.refresh();
    }
  }

  function available(options: TerminalStartupOptions, component: string, action: Action) {
    const item = options.session.components?.[component];
    if (!management || !['tmux', 'screen'].includes(component) || options.session.status !== 'success' || options.session.supported === false || !item) return false;
    return action === 'uninstall'
      ? item.installed === true && item.uninstall_plan?.available === true
      : item.installed !== true && management.guides().mode(item.install_plan || {}, mode(action)).available;
  }

  async function manage(options: TerminalStartupOptions, component: string, action: string) {
    const id = options.connectionId, context = port.context();
    if (!management || !['install', 'install-offline', 'install-local-offline', 'uninstall'].includes(action)
      || !available(options, component, action as Action) || options.busy || running(options, component) || mutations.has(id) || !current(options, context)) return;
    const source = management.connection(id);
    if (!source || !management.unlocked(label(action))) return;
    const stamp = connectionStamp(source);
    const validSource = () => {
      const next = management.connection(id);
      return management.options() === options && port.context() === context && !!port.connection(options.key, id) && !!next && connectionStamp(next) === stamp;
    };
    const same = () => validSource() && current(options, context);
    const actionLabel = () => label(action);
    mutations.add(id);
    port.busy(context, true);
    try {
      if (action === 'install-local-offline') {
        const confirmed = await management.prompt(options, '.settings-choice-modal', management.confirmLocal, validSource);
        if (!confirmed || !same()) return;
      }
      let auth: {admin_grant_id: string} | null = null;
      if (!options.session.root) {
        auth = await management.prompt(options, '.remote-admin-modal',
          valid => management.authorize(id, actionLabel(), `terminal-session.${component}.${action}`, valid), validSource);
        if (!auth || !same()) return;
      }
      if (!same() || !management.unlocked(actionLabel())) return;
      const result = await port.api<{task?: RemoteComponentTask}>(`/api/connections/${id}/terminal-session-components`, {
        method: 'POST', body: JSON.stringify({component, action, ...(auth ? {admin_auth: auth} : {})})
      });
      if (!result?.task || typeof result.task.id !== 'string' || !result.task.id || result.task.id.length > 200 || result.task.connection_id !== id) {
        throw Error(port.tr('remote:tasks.status_read_failed'));
      }
      watch(options, component, result.task, context, validSource);
      management.refreshTasks();
      if (!same()) return;
      port.notify(port.tr('terminal:session.task_started', {modeLabel: actionLabel()}), 'success');
      await refresh(options);
    } catch (cause) {
      if (same()) port.notify(message(cause) || port.tr('terminal:session.operation_failed'), 'error');
    } finally {
      mutations.delete(id);
      options.busy = false;
      if (port.context() === context && current(options, context)) port.busy(context, false);
    }
  }

  function watch(options: TerminalStartupOptions, component: string, task: RemoteComponentTask, context: unknown, validSource: () => boolean) {
    if (!management) return;
    const same = () => validSource() && current(options, context);
    const update = (value: RemoteComponentTask) => {
      if (!same()) return;
      options.session.tasks ||= {};
      options.session.tasks[component] = value;
      port.refresh();
    };
    update(task);
    void management.tasks().watch(task, {
      scope: {key: options.key},
      onUpdate: update,
      onDone: async () => { if (same()) await refresh(options); }
    }).catch(cause => {
      if (same()) port.notify(message(cause) || port.tr('terminal:session.operation_failed'), 'error');
    });
  }

  function model(options: TerminalStartupOptions, component: string): ManagementModel {
    const item = options.session.components?.[component];
    if (!management || !item) return {};
    const plan: Plan = item.install_plan || {}, guides = management.guides();
    const run = (action: string) => () => { void manage(options, component, action); };
    const install = item.installed ? undefined : guides.install(plan, selected => {
      void manage(options, component, selected === 'local-offline' ? 'install-local-offline' : selected === 'offline' ? 'install-offline' : 'install');
    }, button => {
      const details = button.closest('.terminal-session-component-row')?.querySelector<HTMLDetailsElement>('details');
      if (details) { details.open = true; details.scrollIntoView({block: 'nearest'}); }
    });
    const busy = Boolean(options.busy || running(options, component));
    if (install) install.modes.forEach(item => { item.disabled ||= Boolean(options.busy || busy && item.mode !== 'manual'); });
    const manual = guides.manual(plan, {
      steps: [port.tr('terminal:session.manual_component', {component: component === 'screen' ? 'GNU screen' : component})],
      note: port.tr('terminal:session.manual_note')
    });
    manual.copy.run = () => {
      if (options.busy || !current(options, port.context())) return;
      void management.copy(manual.commands).catch(cause => {
        if (current(options, port.context())) port.notify(message(cause) || port.tr('terminal:session.operation_failed'), 'error');
      });
    };
    manual.copy.disabled = options.busy;
    const task = options.session.tasks?.[component];
    const progress = task ? management.tasks().model(task).progress : undefined;
    if (progress) {
      const open = progress.action.run;
      progress.action = {...progress.action, disabled: Boolean(options.busy || progress.action.disabled), run: (button, event) => {
        if (!current(options, port.context())) return;
        event?.stopPropagation();
        port.close(options.key, false);
        open(button);
      }};
    }
    return {
      install, manual, progress,
      actions: item.installed && item.uninstall_plan?.available
        ? [{id: 'uninstall', label: label('uninstall'), icon: 'package-minus', className: 'terminal-session-uninstall', disabled: busy, run: run('uninstall')}] : [],
    };
  }

  function bind(options: TerminalStartupOptions) {
    if (!management) return;
    options.session.model = component => model(options, component);
    options.actions.manageComponent = (component, action) => manage(options, component, action);
    options.actions.refreshComponents = () => refresh(options);
  }
  return {detect, refresh, manage, bind, label};
}
