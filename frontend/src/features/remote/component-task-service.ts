import type { ManagementModel } from './RemoteManagementView';
import type { DesktopTask } from './desktop-service';
import type { LinuxTaskOptions } from './LinuxDesktopView';

export interface RemoteComponentTask extends Partial<DesktopTask> {
  component?: string; component_key?: string; component_label?: unknown;
  action_key?: string; action_label?: unknown; current_key?: string; current?: unknown;
  current_params?: Record<string, unknown>; error_code?: string;
  error_params?: Record<string, unknown>; preserve_error_message?: boolean;
  resource_conflict_message?: unknown;
}
interface RemoteTaskRequest {
  task?: RemoteComponentTask; error?: unknown;
  task_conflict?: boolean; conflict_same_action?: boolean;
}
export interface RemoteTaskScope {
  profileId?: number; key?: string; paneId?: string; containerId?: string; container?: HTMLElement | null;
}
export interface RemoteTaskWatchOptions {
  scope?: RemoteTaskScope; title?: string;
  current?(): boolean;
  container?: HTMLElement | null | (() => HTMLElement | null);
  onUpdate?(task: RemoteComponentTask, container: HTMLElement | null): unknown;
  onDone?(task: RemoteComponentTask, container: HTMLElement | null): unknown;
  onFailed?(task: RemoteComponentTask, container: HTMLElement | null): unknown;
}
export interface RemoteComponentTaskPort {
  tr(key: string, params?: Record<string, unknown>): string;
  localize(value: string): string;
  hasTranslation(key: string): boolean;
  language(): string;
  notify(message: string, kind: 'success' | 'error' | 'info'): void;
  publicError(error: {error_code: string; error_params?: Record<string, unknown>; preserve_error_message: boolean}, raw: string): string;
  action: (id: string, label: string, icon: string, run: (button: HTMLElement, event?: MouseEvent) => void) => NonNullable<ManagementModel['progress']>['action'];
  openTaskCenter(button: HTMLElement, event?: MouseEvent): void;
  now(): number;
  read(id: string): Promise<RemoteComponentTask>;
  schedule(callback: () => void, delay: number): unknown;
  unschedule(timer: unknown): void;
  scopeMatches(scope?: RemoteTaskScope): boolean;
  container(scope: RemoteTaskScope | undefined, candidate: HTMLElement | null): HTMLElement | null;
  render(container: HTMLElement, model: () => ManagementModel): void;
  refreshJobs(): void;
  reportSubscriberError(): void;
}

export function createRemoteComponentTaskService(port: RemoteComponentTaskPort) {
  const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function translatedKey(group: string, value: unknown, params: Record<string, unknown> = {}) {
    const key = normalizeKey(value);
    const resource = `remote:${group}.${key}`;
    return key && port.hasTranslation(resource) ? port.tr(resource, {...params, defaultValue: ''}) : '';
  }
  function localize(value: unknown = '') {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'i18n_key' in value && value.i18n_key) {
      const entry = value as {i18n_key: unknown; params?: unknown; fallback?: unknown};
      const params = entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params) ? entry.params : {};
      return port.tr(String(entry.i18n_key), {...params, defaultValue: String(entry.fallback || entry.i18n_key)});
    }
    const raw = String(value || '');
    return (raw && port.localize(raw)) || raw;
  }
  function safeText(value: unknown, fallback = '') {
    if (!value || (typeof value !== 'object' && !String(value).trim())) return fallback;
    const message = localize(value).trim();
    return /^en(?:-|$)/i.test(port.language()) && /[\u3400-\u9fff]/.test(message) ? fallback : message;
  }
  function status(task: RemoteComponentTask = {}) {
    const state = String(task.status || 'pending').toLowerCase();
    if (state === 'done') return {label: port.tr('remote:tasks.done', {defaultValue: '已完成'}), icon: 'circle-check', className: 'success'};
    if (state === 'failed') return {label: port.tr('remote:tasks.failed', {defaultValue: '失败'}), icon: 'circle-alert', className: 'error'};
    if (state === 'cancelled') return {label: port.tr('remote:tasks.cancelled', {defaultValue: '已取消'}), icon: 'circle-stop', className: 'warning'};
    if (state === 'pending') return {label: port.tr('remote:tasks.pending', {defaultValue: '准备中'}), icon: 'package-clock', className: 'running'};
    return {label: port.tr('remote:tasks.running', {defaultValue: '执行中'}), icon: 'loader-circle', className: 'running'};
  }
  function componentLabel(task: RemoteComponentTask = {}) {
    const key = normalizeKey(task.component_key || task.component);
    const exact = translatedKey('task_components', key);
    if (exact) return exact;
    if (key.startsWith('linux-desktop-')) {
      const names: Record<string, string> = {xfce: 'XFCE', gnome: 'GNOME', plasma: 'KDE Plasma', mate: 'MATE', cinnamon: 'Cinnamon', lxqt: 'LXQt'};
      const id = key.slice('linux-desktop-'.length), name = names[id] || id;
      return port.tr('remote:task_components.linux-desktop-named', {name, defaultValue: `Linux 桌面 · ${name}`});
    }
    if (key.startsWith('xdmcp-')) {
      if (key.includes('lightdm')) return port.tr('remote:task_components.xdmcp-lightdm', {defaultValue: 'LightDM XDMCP 服务'});
      if (key.includes('desktop') || key.includes('xfce')) return port.tr('remote:task_components.xdmcp-desktop', {defaultValue: 'XDMCP 兼容桌面'});
      if (key.includes('rdp')) return port.tr('remote:task_components.rdp-server', {defaultValue: 'RDP 服务'});
      return port.tr('remote:task_components.xdmcp', {defaultValue: 'XDMCP 服务'});
    }
    return safeText(task.component_label, port.tr('remote:tasks.component_task', {defaultValue: '远程组件任务'}));
  }
  const actionLabel = (task: RemoteComponentTask = {}) => translatedKey('task_actions', task.action_key || task.action)
    || safeText(task.action_label, port.tr('remote:task_actions.configure', {defaultValue: '配置'}));
  const currentLabel = (task: RemoteComponentTask = {}) => translatedKey('task_stages', task.current_key || task.stage, task.current_params || {})
    || safeText(task.current || task.stage, status(task).label);
  function errorLabel(task: RemoteComponentTask = {}) {
    const raw = String(task.error || '').trim();
    if (!raw) return '';
    if (task.error_code) return port.publicError({
      error_code: task.error_code, error_params: task.error_params, preserve_error_message: task.preserve_error_message === true
    }, raw);
    return safeText(raw, port.tr('remote:tasks.operation_failed', {defaultValue: '远程组件操作失败'}));
  }
  function model(task: RemoteComponentTask, options: {title?: string} = {}): ManagementModel {
    const state = status(task), raw = Number(task.progress), percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    return {progress: {
      title: actionLabel(task) || safeText(options.title) || componentLabel(task),
      detail: `${currentLabel(task) || state.label} · ${state.label}`, percent,
      tone: state.className, icon: state.icon, error: errorLabel(task),
      action: port.action('task-center', port.tr('remote:tasks.open_center_logs', {defaultValue: '查看任务中心与日志'}), 'list-checks', port.openTaskCenter)
    }};
  }
  function requested(result: RemoteTaskRequest, label: string, queued?: string) {
    if (!result.task_conflict) {
      port.notify(queued ?? port.tr('remote:tasks.added_to_center', {action: actionLabel(result.task) || label}), 'success');
      return true;
    }
    const action = actionLabel(result.task) || componentLabel(result.task) || port.tr('remote:tasks.existing_operation');
    if (result.conflict_same_action) {
      port.notify(port.tr('remote:tasks.already_running_adopted', {action}), 'info');
      return true;
    }
    const reason = safeText(result.error || result.task?.resource_conflict_message)
      || port.tr('remote:tasks.operation_running', {action});
    port.notify(port.tr('remote:tasks.request_rejected', {action: label, reason}), 'error');
    return false;
  }
  function desktopModel(task: DesktopTask, view: {taskId: string; expanded: boolean}, toggle: () => void): LinuxTaskOptions {
    const logs = Array.isArray(task.logs) ? task.logs : [];
    const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
    const done = task.status === 'done', failed = task.status === 'failed', cancelled = task.status === 'cancelled';
    const action = task.action === 'uninstall' ? port.tr('remote:linux_desktop.action_uninstall', {defaultValue: '卸载'}) : port.tr('remote:linux_desktop.action_install', {defaultValue: '安装'});
    const state = cancelled ? port.tr('remote:tasks.cancelled') : done ? port.tr('remote:linux_desktop.task_state_done', {defaultValue: '完成'})
      : failed ? port.tr('remote:linux_desktop.task_state_failed', {defaultValue: '失败'}) : port.tr('remote:linux_desktop.task_state_running', {defaultValue: '中'});
    const desktop = task.desktop_label || port.tr('remote:linux_desktop.desktop_generic', {defaultValue: 'Linux 桌面'});
    const title = port.tr('remote:linux_desktop.task_title', {desktop, action, state, defaultValue: `${desktop}${action}${state}`});
    const taskStatus = cancelled ? port.tr('remote:tasks.cancelled') : done ? port.tr('common:auto.done', {defaultValue: '已完成'})
      : failed ? task.error || port.tr('remote:linux_desktop.task_failed', {action, defaultValue: `${action}失败`}) : `${progress}%`;
    return {
      title, detail: `${currentLabel(task)} · ${taskStatus}`, progress,
      label: port.tr('remote:linux_desktop.view_task_log', {action, defaultValue: `查看${action}日志`}),
      taskId: view.taskId, expanded: view.expanded,
      logs: logs.map(item => `[${new Date(item.at || port.now()).toLocaleTimeString()}] ${['stderr', 'error'].includes(item.stream || '') ? '! ' : ''}${item.text || ''}`).join('\n'),
      toggle
    };
  }

  interface Subscriber {options: RemoteTaskWatchOptions; finished?: boolean}
  interface Watcher {
    task: RemoteComponentTask; connectionId?: number; subscribers: Set<Subscriber>; timer: unknown;
    completion: Promise<RemoteComponentTask>; finish(task: RemoteComponentTask): void;
  }
  const watchers = new Map<string, Watcher>();
  let alive = true;
  const terminal = (task: RemoteComponentTask) => ['done', 'failed', 'cancelled'].includes(String(task.status || '').toLowerCase());
  const target = (subscriber: Subscriber) => {
    const options = subscriber.options;
    return port.container(options.scope, typeof options.container === 'function' ? options.container() : options.container || null);
  };
  async function publish(subscriber: Subscriber, task: RemoteComponentTask, finished = false) {
    if (!alive) return;
    if (finished) {
      if (subscriber.finished) return;
      subscriber.finished = true;
    }
    try {
      const options = subscriber.options;
      if (options.current?.() === false || !port.scopeMatches(options.scope)) return;
      const container = target(subscriber);
      if (!finished && container) port.render(container, () => model(task, options));
      if (!finished) await options.onUpdate?.(task, container);
      else if (String(task.status).toLowerCase() === 'done') await options.onDone?.(task, container);
      else if (String(task.status).toLowerCase() === 'failed') await options.onFailed?.(task, container);
    } catch {
      port.reportSubscriberError();
    }
  }
  function watch(task: RemoteComponentTask, options: RemoteTaskWatchOptions = {}): Promise<RemoteComponentTask> {
    if (!alive || !task?.id) return Promise.resolve(task);
    const id = String(task.id), previous = watchers.get(id), subscriber = {options};
    if (previous) {
      if (previous.connectionId !== task.connection_id) return Promise.resolve(task);
      previous.subscribers.add(subscriber);
      void publish(subscriber, previous.task);
      return previous.completion;
    }
    let resolve!: (task: RemoteComponentTask) => void;
    const completion = new Promise<RemoteComponentTask>(done => {resolve = done;});
    const watcher: Watcher = {
      task, connectionId: task.connection_id, subscribers: new Set([subscriber]), timer: null, completion,
      finish(result) {
        if (watchers.get(id) !== watcher) return;
        watchers.delete(id);
        if (watcher.timer !== null) port.unschedule(watcher.timer);
        resolve(result);
      }
    };
    watchers.set(id, watcher);
    const current = () => alive && watchers.get(id) === watcher;
    const notify = async (result: RemoteComponentTask, finished = false) => {
      if (current()) await Promise.all([...watcher.subscribers].map(item => publish(item, result, finished)));
    };
    const finish = async (result: RemoteComponentTask) => {
      while (current() && [...watcher.subscribers].some(item => !item.finished)) await notify(result, true);
      watcher.finish(result);
    };
    const tick = async (result: RemoteComponentTask) => {
      if (!current()) return;
      watcher.task = result;
      await notify(result);
      if (!current()) return;
      port.refreshJobs();
      if (terminal(result)) {
        await finish(result);
        return;
      }
      watcher.timer = port.schedule(() => {void poll();}, 1200);
    };
    const poll = async () => {
      if (!current()) return;
      try {
        const result = await port.read(id);
        if (!current()) return;
        if (!result || String(result.id) !== id || result.connection_id !== watcher.connectionId) throw Error(port.tr('remote:tasks.status_read_failed', {defaultValue: '远程组件任务状态读取失败'}));
        await tick(result);
      } catch (error) {
        if (!current()) return;
        const failed = {...watcher.task, status: 'failed', error: error instanceof Error ? error.message : port.tr('remote:tasks.status_read_failed', {defaultValue: '远程组件任务状态读取失败'})};
        watcher.task = failed;
        await notify(failed);
        await finish(failed);
      }
    };
    void tick(task).catch(() => watcher.finish(watcher.task));
    return completion;
  }
  function dispose() {
    alive = false;
    for (const watcher of [...watchers.values()]) watcher.finish(watcher.task);
  }
  return {status, componentLabel, actionLabel, currentLabel, errorLabel, model, desktopModel, localize, safeText, requested, watch, dispose};
}
