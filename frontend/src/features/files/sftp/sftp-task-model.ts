import type {PresentationJob} from './task-presentation';
/** API task snapshots projected for both the task drawer and floating progress. */
export interface TaskRecord extends PresentationJob {
  id: string; type: string; status: string;
  connection_id?:number;updated_at?:number;finished_at?:number|string|null;
  delivery_mode?:string;archive_source_paths?:string[];download_name?:string;archive_filename_encoding?:string;received_bytes?:number;
  can_cancel?:boolean;can_pause?:boolean;can_resume?:boolean;resume_supported?:boolean;
  progress?:number;progress_known?:boolean;size_known?:boolean;two_stage_upload?:boolean;
  average_bps?:number;delivery_status?:string;saved_path?:string;
  raw_sync_id?:string|number;raw_desktop_id?:string|number;raw_component_id?:string|number;
  total?:number;completed?:number;errors?:Array<{relative?:string;error?:string}>;
  desktop_label?:string;component?:string;component_label?:string;action?:string;action_label?:string;stage?:string;
  logs?:Array<{at?:number;text?:string}>;renamed_files?:Array<{source?:string;target?:string}>;
}
export interface TaskSources {
  transfer?: unknown; sync?: unknown; desktop?: unknown; component?: unknown; generated?: unknown;
}
export interface TaskProjectionPort {
  tr(key: string, params?: Record<string, unknown>): string;
  localize(value: string): string;
  connectionName(id: number): string;
}
export const sftpActiveStatuses: ReadonlySet<string> = new Set(['running', 'pending', 'paused']);
const terminal = new Set(['done', 'failed', 'cancelled']);
const queueTypes = new Set(['upload', 'download', 'cross-copy', 'local-delivery', 'native-drag']);
const number = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
type TaskSnapshot=Omit<TaskRecord,'id'>&{id:string|number};
const records = (value: unknown): TaskSnapshot[] => Array.isArray(value) ? value.filter(item => item &&
  typeof item === 'object' && !Array.isArray(item) && ['string', 'number'].includes(typeof item.id) &&
  String(item.id).trim() && !String(item.id).includes('\0')) as TaskSnapshot[] : [];
const stageKeys: Record<string, string> = {
  prepare: 'sftp:task_ui.stage_prepare', packages: 'sftp:task_ui.stage_packages',
  refresh: 'sftp:task_ui.stage_refresh', verify: 'sftp:task_ui.stage_verify', done: 'tasks:status.done'
};

export function projectSftpTasks(sources: TaskSources, port: TaskProjectionPort): TaskRecord[] {
  const jobs = [
    ...records(sources.transfer).map(task => {
      if (task.type !== 'native-drag') return { ...task,id:String(task.id) };
      const name = String(task.label || '').match(/^拖出\s+(.+?)\s+到本机$/)?.[1];
      const labelKey = name ? 'sftp:task_ui.drag_file_local' : 'sftp:task_ui.drag_items_local';
      const params = name ? { name } : { count: Math.max(1, number(task.item_count)) };
      const native = { ...task,id:String(task.id), label: port.tr(labelKey, params), label_i18n: true, label_i18n_key: labelKey, label_i18n_params: params };
      // Older persisted records retain a process message after the system callback.
      if (terminal.has(task.status)) return { ...native, phase: '', current: '', current_i18n_key: '', can_cancel: false, can_pause: false, can_resume: false };
      return { ...native, ...(task.phase === 'system-saving' ? { current_i18n_key: 'tasks:phase.system_saving' } : {}) };
    }),
    ...records(sources.sync).map(task => {
      const labelKey = task.type === 'sync-scan' ? 'sftp:task_ui.directory_compare' : 'sftp:task_ui.directory_sync';
      return { ...task, id: `sync:${task.id}`, raw_sync_id: task.id,
        label: port.tr(labelKey), label_i18n: true, label_i18n_key: labelKey,
        connection_name: port.connectionName(Number(task.connection_id)),
        status: task.status === 'completed' ? 'done' : task.status,
        size: number(task.total), transferred: number(task.completed), progress_unit: 'items', progress_known: number(task.total) > 0,
        can_cancel: task.status === 'running', can_pause: false,
        finished_at: ['completed', 'failed', 'cancelled'].includes(task.status) ? task.updated_at : null,
        error: Array.isArray(task.errors) ? task.errors.filter(Boolean).map(item => `${item.relative ? `${item.relative}：` : ''}${item.error || ''}`).join('\n') : '' };
    }),
    ...(['desktop', 'component'] as const).flatMap(source => records(sources[source]).map(task => {
      const desktop = source === 'desktop';
      const session = !desktop && /^terminal-session-(tmux|screen)$/.exec(task.component || '');
      const componentKey = desktop ? 'sftp:task_ui.linux_desktop' : session ? `terminal:session.component_${session[1]}` : 'sftp:task_ui.remote_component';
      const component = session ? '' : (desktop ? task.desktop_label : task.component_label) || '';
      const sessionAction = session && ['install', 'install-offline', 'install-local-offline', 'uninstall'].includes(task.action || '');
      const actionKey = desktop ? task.action === 'uninstall' ? 'sftp:task_ui.uninstall' : 'sftp:task_ui.install' : sessionAction ? `remote:task_actions.${task.action}` : task.action_label ? '' : 'sftp:task_ui.offline_install';
      const action = actionKey ? port.tr(actionKey) : port.localize(task.action_label || '');
      const currentKey = desktop ? stageKeys[task.stage||''] || '' : '';
      return { id: `${source}:${task.id}`, [desktop ? 'raw_desktop_id' : 'raw_component_id']: task.id,
        type: desktop ? 'linux-desktop' : 'remote-component', status: task.status,
        label: port.tr('sftp:task_ui.component_action', { component: component || port.tr(componentKey), action }),
        label_i18n: true, label_i18n_key: 'sftp:task_ui.component_action',
        label_component: component, label_component_key: componentKey, label_action: desktop ? '' : task.action_label || '', label_action_key: actionKey,
        connection_id: Number(task.connection_id || 0), connection_name: task.connection_name || '',
        phase: task.stage || 'prepare', current: desktop ? currentKey ? port.tr(currentKey) : task.stage || '' : task.current || '', current_i18n_key: currentKey,
        size: 100, transferred: number(task.progress), progress: number(task.progress), progress_unit: 'percent', progress_known: true,
        can_cancel: false, can_pause: false, finished_at: task.finished_at || null, updated_at: task.updated_at || 0,
        logs: Array.isArray(task.logs) ? task.logs : [], error: task.error || '' };
    })),
    ...records(sources.generated).map(task => ({ ...task,id:String(task.id) }))
  ];
  return jobs;
}

export function sftpTaskProgress(job?: Partial<TaskRecord>) {
  const size = number(job?.size);
  if (!(job?.progress_known === true || job?.size_known === true || size > 0)) return null;
  const transferred = Math.min(size, number(job?.transferred));
  const explicit = Number(job?.progress);
  let percent = Number.isFinite(explicit) ? explicit : size ? transferred / size * 100 : 0;
  if (sftpActiveStatuses.has(job?.status || '')) percent = Math.min(99, percent);
  if (job?.status === 'done') percent = 100;
  return { size, transferred, percent: Math.max(0, Math.min(100, percent)), weightable: size > 0 && !job?.two_stage_upload };
}
export function sftpTaskCollections(jobs: TaskRecord[]) {
  const current = jobs.filter(job => sftpActiveStatuses.has(job.status));
  const deliveryFailed = (job: TaskRecord) => job.status === 'done' && job.type === 'download' && job.delivery_status === 'failed';
  const failed = jobs.filter(job => job.status === 'failed' || deliveryFailed(job));
  const history = jobs.filter(job => ['done', 'cancelled'].includes(job.status) && !deliveryFailed(job));
  return { current, failed, history, activeCount: current.length, failedCount: failed.length };
}
export function sftpTaskQueue(jobs: TaskRecord[]) {
  return jobs.filter(job => queueTypes.has(job.type) && sftpActiveStatuses.has(job.status));
}
export function sftpTaskCenterProgress(jobs: TaskRecord[]) {
  const entries = jobs.filter(job => sftpActiveStatuses.has(job.status)).map(job => ({ job, progress: sftpTaskProgress(job) }));
  if (!entries.length) return null;
  const known = entries.filter((entry): entry is typeof entry & { progress: NonNullable<typeof entry.progress> } => entry.progress !== null);
  if (!known.length) return { activeCount: entries.length, percent: 0, determinate: false };
  const canWeight = new Set(known.map(entry => entry.job.progress_unit || 'bytes')).size === 1 && known.every(entry => entry.progress.weightable);
  const weight = canWeight ? known.reduce((sum, entry) => sum + entry.progress.size, 0) : known.length;
  const percent = known.reduce((sum, entry) => sum + entry.progress.percent * (canWeight ? entry.progress.size : 1), 0) / weight;
  return { activeCount: entries.length, percent: Math.max(0, Math.min(99, percent)), determinate: known.length === entries.length };
}
