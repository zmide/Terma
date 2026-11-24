import {filesServices} from '@/features/files/installed-services';
import { h, Fragment, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { quickIcon, paintQuickView } from './quick-mount';
import { renderSftpJob } from './quick-views';
import type { TaskCardPort } from '../files/sftp/TaskCard';

import type {TaskRecord} from '../files/sftp/sftp-task-model';
export type TaskJob=TaskRecord;
export interface TaskCenterPort extends TaskCardPort {
  sftpLatestJobs: TaskJob[];
  sftpTaskCenterView: string;
  SFTP_ACTIVE_JOB_STATUSES: ReadonlySet<string>;
  sftpDismissedFloatingJobIds: Set<string>;
  sftpTaskCollections: (jobs: TaskJob[]) => { current: TaskJob[]; failed: TaskJob[]; history: TaskJob[]; activeCount: number; failedCount: number };
  sftpTaskCenterProgress: (jobs: TaskJob[]) => { determinate: boolean; percent: number } | null;
  sftpTransferQueueJobs: (jobs: TaskJob[]) => TaskJob[];
  sftpTransferJobCanPause: (job: TaskJob) => boolean;
  sftpTransferJobCanResume: (job: TaskJob) => boolean;
  sftpTransferJobCanCancel: (job: TaskJob) => boolean;
  captureSftpTaskLogViewStates: (root: HTMLElement | null) => void;
  bindSftpTaskLogViewStates: (root: HTMLElement | null) => void;
  sftpFloatingProgressEnabled: () => boolean;
  sftpFloatingJobDetail: (job: TaskJob) => string;
  dismissSftpTaskFloat: () => void;
  muteSftpTaskFloat: () => void;
}

type ButtonAttrs = {class?:string;hidden?:boolean;disabled?:boolean;onClick?:(event:MouseEvent)=>void;[key:`data-${string}`]:string|undefined};
function button(id: string | undefined, text: string, icon: string, attrs: ButtonAttrs = {}) {
  return h(TermaButton, { id, title: text, 'aria-label': text, ...attrs }, { default: () => [quickIcon(icon), ...(attrs.class?.includes('icon-button') ? [] : [h('span', null, text)])] });
}

export function renderTaskCenter(scope: TaskCenterPort, jobs = scope.sftpLatestJobs) {
  const host = document.getElementById('sftpTaskCenter');
  if (!host) return;
  const open = document.getElementById('sftpTaskCenterDrawer')?.hidden === false;
  const t = scope.tr;
  const { current, failed, history, activeCount, failedCount } = scope.sftpTaskCollections(jobs);
  const view = scope.sftpTaskCenterView;
  const visible = view === 'history' ? history : view === 'failed' ? failed : current;
  const progress = scope.sftpTaskCenterProgress(jobs);
  const status = failedCount ? 'failed' : activeCount ? 'running' : 'idle';
  const attention = current.length + failed.length;
  const summary = [activeCount ? t('tasks:auto.running_count', { count: activeCount }) : '', failedCount ? t('tasks:auto.failed_count', { count: failedCount }) : ''].filter(Boolean).join(t('tasks:auto.summary_separator'));
  const title = summary ? t('tasks:auto.center_summary', { summary }) : t('tasks:title');
  const queue = scope.sftpTransferQueueJobs(current);
  const queueVisible = view === 'current' && queue.length > 0;
  const tabs = [['current', 'Current', 'common:auto.current_tasks', current], ['failed', 'Failed', 'tasks:status.failed', failed], ['history', 'History', 'common:auto.history', history]] as const;
  const previousList = document.getElementById('sftpTaskCenterList');
  const scrollTop = previousList?.scrollTop || 0;
  scope.captureSftpTaskLogViewStates(previousList);
  const content: VNodeChild = [
    h(TermaButton, { id: 'sftpTaskCenterButton', class: ['icon-button sftp-task-center-button', { 'is-running': activeCount > 0, 'is-failed': failedCount > 0 }], type: 'button', 'data-action': 'static-task-center-toggle', 'data-status': status, title, 'aria-label': title, 'aria-expanded': String(open), 'aria-controls': 'sftpTaskCenterDrawer' }, { default: () => [h('span', { id: 'sftpTaskCenterIcon', class: 'sftp-task-center-icon' }, [quickIcon(status === 'failed' ? 'circle-alert' : status === 'running' ? 'loader-circle' : 'list-checks')]), h('span', { id: 'sftpTaskCenterBadge', class: 'sftp-task-center-badge', hidden: !attention }, attention > 99 ? '99+' : String(attention))] }),
    h('span', { id: 'sftpTaskCenterProgress', class: ['sftp-task-center-progress', { 'is-indeterminate': progress && !progress.determinate }], role: 'progressbar', 'aria-label': t('common:auto.task_total_progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': progress?.determinate ? String(Math.round(progress.percent)) : undefined, 'aria-valuetext': progress ? progress.determinate ? `${Math.round(progress.percent)}%` : t('sftp:task_ui.calculating_progress') : undefined, hidden: !progress }, [h('i', { style: { width: `${Math.round(progress?.percent || 0)}%` } })]),
    h('aside', { id: 'sftpTaskCenterDrawer', class: 'sftp-task-center-drawer', 'aria-label': t('tasks:title'), hidden: !open }, [
      h('header', { class: 'sftp-task-center-head' }, [h('div', null, [h('strong', null, t('tasks:title')), h('span', { id: 'sftpTaskCenterSummary' }, summary || t('tasks:auto.empty_current'))]), h('div', { class: 'sftp-task-center-head-actions' }, [button('sftpTaskCenterResetSizeButton', t('common:auto.reset_task_center_size'), 'minimize-2', { class: 'icon-button', 'data-action': 'static-task-resize-reset' }), button(undefined, t('common:auto.close_task_center'), 'x', { class: 'icon-button', 'data-action': 'static-task-center-close' })])]),
      h('div', { class: 'sftp-task-center-tabs', role: 'tablist', 'aria-label': t('common:auto.task_view') }, tabs.map(([key, id, label, items]) => h(TermaButton, { id: `sftpTaskCenter${id}Tab`, role: 'tab', 'aria-selected': String(view === key), class: { active: view === key }, 'data-action': 'static-task-center-view', 'data-task-view': key }, { default: () => [h('span', null, t(label)), h('small', { id: `sftpTaskCenter${id}Count` }, String(items.length))] }))),
      h('div', { id: 'sftpTaskCenterList', class: 'sftp-task-center-list', role: 'tabpanel', 'aria-labelledby': `sftpTaskCenter${tabs.find(tab => tab[0] === view)?.[1] || 'Current'}Tab` }, visible.length ? visible.map(job => h(Fragment, { key: job.id }, [renderSftpJob(scope, job)])) : [h('div', { class: 'sftp-task-empty' }, t(`tasks:auto.empty_${view}`))]),
      h('footer', { id: 'sftpTaskCenterFooter', class: 'sftp-task-center-footer', hidden: !(queueVisible || (view === 'history' && history.length) || (view === 'failed' && failed.length)) }, [h('div', { id: 'sftpTaskCenterQueueActions', class: 'sftp-task-center-queue-actions', hidden: !queueVisible }, [button('sftpTaskCenterPauseAllButton', t('tasks:actions.pause_all'), 'pause', { 'data-action': 'static-task-center-pause-all', disabled: !queue.some(scope.sftpTransferJobCanPause) }), button('sftpTaskCenterResumeAllButton', t('tasks:actions.resume_all'), 'play', { 'data-action': 'static-task-center-resume-all', disabled: !queue.some(scope.sftpTransferJobCanResume) }), button('sftpTaskCenterClearQueueButton', t('tasks:actions.clear_queue'), 'list-x', { class: 'danger', 'data-action': 'static-task-center-clear-queue', disabled: !queue.some(scope.sftpTransferJobCanCancel) })]), h(TermaButton, { id: 'sftpTaskCenterClearButton', class: 'danger', 'data-action': 'static-task-center-clear', hidden: view === 'current', title: t(view === 'failed' ? 'tasks:auto.delete_all_failed' : 'tasks:auto.delete_all_history'), 'aria-label': t(view === 'failed' ? 'tasks:auto.delete_all_failed' : 'tasks:auto.delete_all_history') }, { default: () => [quickIcon('trash-2'), h('span', { id: 'sftpTaskCenterClearLabel' }, t(view === 'failed' ? 'tasks:dialogs.clear_failed_action' : 'tasks:dialogs.clear_history_action'))] })]),
      h('div', { id: 'sftpTaskCenterResize', class: 'sftp-task-center-resize-handle', role: 'button', tabindex: '0', 'aria-label': t('common:auto.adjust_task_center'), title: t('common:auto.adjust_task_center_hint'), 'data-pointerdown-action': 'static-task-resize-start', 'data-dblclick-action': 'static-task-resize-reset', 'data-keydown-action': 'static-task-resize-key' })
    ])
  ];
  paintQuickView(host, content);
  scope.bindSftpTaskLogViewStates(document.getElementById('sftpTaskCenterList'));
  const list = document.getElementById('sftpTaskCenterList');
  if (list) list.scrollTop = Math.min(scrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
  renderTaskFloat(scope, jobs);
}

export function renderTaskFloat(scope: TaskCenterPort, jobs = scope.sftpLatestJobs) {
  const box = document.getElementById('sftpTaskFloat'); if (!box) return;
  box.setAttribute('aria-label', scope.tr('common:auto.task_floating_progress'));
  const active = jobs.filter(job => scope.SFTP_ACTIVE_JOB_STATUSES.has(job.status));
  const ids = new Set(active.map(job => String(job.id)));
  for (const id of scope.sftpDismissedFloatingJobIds) if (!ids.has(id)) scope.sftpDismissedFloatingJobIds.delete(id);
  box.hidden = !scope.sftpFloatingProgressEnabled() || !active.some(job => !scope.sftpDismissedFloatingJobIds.has(String(job.id)));
  if (!active.length) { paintQuickView(box, []); return; }
  const t = scope.tr, one = active.length === 1 ? active[0] : null;
  const progress = scope.sftpTaskCenterProgress(active);
  const percent = progress?.percent || 0;
  const action = one?.status === 'running' && one.resume_supported && one.can_pause !== false ? 'pause' : one?.status === 'paused' && one.can_resume ? 'resume' : '';
  const speed = active.filter(job => job.status === 'running').reduce((sum, job) => sum + Math.max(0, Number(job.speed_bps || 0)), 0);
  const detail = one ? scope.sftpFloatingJobDetail(one) : [
    ...(['running', 'pending', 'paused'] as const).map(status => { const count = active.filter(job => job.status === status).length; return count ? t(`sftp:task_ui.${status}_items`, { count }) : ''; }),
    speed ? `${scope.formatBytes(speed)}/s` : '', progress?.determinate ? `${Math.round(percent)}%` : ''
  ].filter(Boolean).join(' · ');
  const title = one ? scope.sftpJobDisplayLabel(one) || t('sftp:task_ui.background_task') : t('sftp:task_ui.background_tasks', { count: active.length });
  paintQuickView(box, [h('div', { class: 'sftp-task-float-head' }, [h(TermaButton, {class:'sftp-task-float-open',title:t('tasks:actions.open_center')},{default:()=>[h('span', { class: 'sftp-task-float-icon' }, [active.some(job => job.status === 'running') ? h('span', { class: 'sftp-task-spinner', 'aria-hidden': 'true' }) : quickIcon('pause')]), h('span', { class: 'sftp-task-float-copy' }, [h('strong', { class: 'sftp-task-float-title' }, title), h('span', { class: 'sftp-task-float-detail' }, detail)])]}), h('span', { class: 'sftp-task-float-actions' }, [button(undefined, t(action === 'pause' ? 'tasks:actions.pause' : 'tasks:actions.resume'), action === 'pause' ? 'pause' : 'play', { class: 'icon-button sftp-task-float-pause', hidden: !action, 'data-action': action, 'data-job-id': one?.id || '', onClick: (event: MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.floatAction(event.currentTarget as HTMLButtonElement); } }), button(undefined, t('tasks:actions.stop'), 'square', { class: 'icon-button sftp-task-float-cancel', hidden: !one || one.can_cancel === false || (one.type === 'upload' && one.phase === 'committing'), 'data-job-id': one?.id || '', onClick: (event: MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.single(one?.id || '', 'cancel', event.currentTarget as HTMLButtonElement); } }), button(undefined, t('tasks:actions.close_floating'), 'x', { class: 'icon-button sftp-task-float-close', onClick: (event: MouseEvent) => { event.stopPropagation(); scope.dismissSftpTaskFloat(); } }), button(undefined, t('tasks:actions.mute_floating'), 'bell-off', { class: 'icon-button sftp-task-float-mute', onClick: (event: MouseEvent) => { event.stopPropagation(); scope.muteSftpTaskFloat(); } })])]), h('div', { class: ['progress', { indeterminate: !progress?.determinate }], role: 'progressbar', 'aria-label': t('tasks:actions.progress'), 'aria-valuenow': progress?.determinate ? String(Math.round(percent)) : undefined, 'aria-valuemin': progress?.determinate ? '0' : undefined, 'aria-valuemax': progress?.determinate ? '100' : undefined }, [h('i', { style: { width: progress?.determinate ? `${percent}%` : '' } })])]);

}
