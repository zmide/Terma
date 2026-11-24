import {filesServices} from '@/features/files/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {tr as translateWorkspace} from '@/shared/i18n/workspace-bootstrap';
import { Fragment, h, render } from 'vue';
import { settingsIcon } from '../settings/settings-icon';
import { TermaButton } from '../../shared/ui/TermaButton';
import { createNotificationToastService, notificationDisplayPreferences, type ToastAction, type ToastModel } from './notification-toast-service';
import { runDownloadLocationAction, type DownloadLocationAction } from '../files/sftp/download-location';

interface NotificationToastContext {
  preferences?: Parameters<typeof notificationDisplayPreferences>[0];
  localize(value: string): string;
}

function runTaskAction(kind: DownloadLocationAction, jobId: string, generated: boolean, button: HTMLButtonElement) {
  if (!generated) return runDownloadLocationAction(kind, jobId, button);
  const files = filesServices.termaGeneratedFiles.current();
  if (kind === 'open-file') return files.open(jobId);
  if (kind === 'open-directory') return files.directory(jobId);
  return files.deleteFile(jobId);
}

export function installNotificationToasts(context:()=>NotificationToastContext) {
  if (efficiencyServices.termaNotificationToasts) return;
  let frame = 0;
  const stack = () => document.getElementById('toast');
  const element = (id: string) => [...(stack()?.querySelectorAll<HTMLElement>('.toast') || [])].find(item => item.dataset.toastId === id);
  const tr = (key: string) => translateWorkspace(key);
  const localize = (value: string) => context()?.localize(value) ?? value;
  const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  function syncLayout() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      const host = stack(), topbar = document.querySelector('.topbar');
      const offset = host?.querySelector('.toast') && topbar
        ? Math.max(0, Math.ceil(host.getBoundingClientRect().bottom - topbar.getBoundingClientRect().bottom)) : 0;
      document.documentElement.style.setProperty('--notification-stack-offset', `${offset}px`);
    });
  }
  function actionButtons(action: ToastAction | undefined) {
    if (!action || (!action.download_job_id && !action.generated_task_id)) return [];
    const jobId = String(action.generated_task_id || action.download_job_id);
    const generated = Boolean(action.generated_task_id);
    const actions = [
      { allowed: action.can_open_file, kind: 'open-file', key: 'tasks:actions.open_file', icon: 'external-link' },
      { allowed: action.can_open_directory, kind: 'open-directory', key: 'tasks:actions.open_directory', icon: 'folder-open' },
      { allowed: action.can_delete_file, kind: 'delete-file', key: 'sftp:menu.delete_downloaded_file', icon: 'trash-2' }
    ] as const;
    return actions.filter(item => item.allowed).map(item => h(TermaButton, {
      key: item.kind, class: ['toast-action', { danger: item.kind === 'delete-file' }],
      'data-toast-action': item.kind, title: tr(item.key),
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        void runTaskAction(item.kind, jobId, generated, event.currentTarget as HTMLButtonElement);
      }
    }, () => [settingsIcon(item.icon), h('span', null, tr(item.key))]));
  }
  function card(model: ToastModel) {
    const progress = model.progress;
    const closeLabel = tr('common:auto.close_hint');
    const pauseLabel = tr(progress?.paused ? 'common:actions.continue' : 'common:actions.pause');
    const stopLabel = tr('common:auto.stop');
    const detail = model.detailKey ? tr(model.detailKey)
      : progress ? localize(model.detail)
      : model.detail.split('\n').map(localize).join('\n').trim();
    const progressActions = progress ? [
      h('div', {
        class: ['toast-progress-track', { indeterminate: progress.value === null }],
        hidden: progress.failed, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': progress.value === null ? undefined : String(Math.round(progress.value))
      }, h('i', { style: { width: progress.value === null ? '' : `${progress.value}%` } })),
      h('div', { class: 'toast-progress-actions', hidden: progress.settled || (!progress.pausable && !progress.cancellable) }, [
        h(TermaButton, {
          class: 'toast-progress-pause', hidden: !progress.pausable, 'aria-label': pauseLabel,
          onClick: () => service.toggleProgress(model.id)
        }, () => [settingsIcon(progress.paused ? 'play' : 'pause'), h('span', null, pauseLabel)]),
        h(TermaButton, {
          class: 'toast-progress-cancel', hidden: !progress.cancellable,
          onClick: () => service.cancelProgress(model.id)
        }, () => [settingsIcon('square'), h('span', null, stopLabel)])
      ])
    ] : [];
    const actions = actionButtons(model.action);
    return h('div', {
      key: model.id, class: ['toast', 'terma-vue-root', 'terma-notification-root', model.level, { 'toast-progress': !!progress, paused: progress?.paused, 'is-leaving': model.leaving }],
      'data-toast-id': model.id, 'data-toast-replace-key': model.replaceKey || undefined,
      'data-terma-notification-owned': '', 'data-i18n-skip': '',
      role: !progress && model.level === 'error' ? 'alert' : 'status', 'aria-atomic': 'true',
      onPointerenter: () => service.pause(model.id, 'pointer'),
      onPointerleave: () => service.resume(model.id, 'pointer'),
      onFocusin: () => service.pause(model.id, 'focus'),
      onFocusout: () => queueMicrotask(() => {
        if (!element(model.id)?.contains(document.activeElement)) service.resume(model.id, 'focus');
      })
    }, [
      h('div', { class: 'toast-head' }, [
        h('span', { class: 'toast-icon' }, settingsIcon(model.icon)),
        h('div', { class: 'toast-copy' }, [h('strong', null, model.titleKey ? tr(model.titleKey) : localize(model.title)), h('span', { hidden: !detail }, detail)]),
        h(TermaButton, {
          class: ['icon-button', { 'toast-progress-close': !!progress }], title: closeLabel, 'aria-label': closeLabel,
          onClick: () => progress ? service.cancelProgress(model.id) : service.dismiss(model.id)
        }, () => settingsIcon('x'))
      ]),
      ...progressActions,
      actions.length ? h('div', { class: 'toast-actions' }, actions) : null
    ]);
  }
  const service = createNotificationToastService({
    available: () => !!stack(),
    clearNotice() {
      const notice = document.getElementById('notice');
      if (notice) { notice.textContent = ''; notice.className = 'notice'; }
    },
    preferences: () => notificationDisplayPreferences(context()?.preferences),
    defaultText: kind => tr(kind === 'processing' ? 'common:auto.processing_now' : kind === 'done' ? 'common:auto.done' : 'common:auto.operation_failed'),
    now: () => Date.now(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: timer => window.clearTimeout(timer as number),
    paint(models) {
      const host = stack();
      if (!host) return;
      const previous = new Map([...host.querySelectorAll<HTMLElement>('.toast')].map(node => [node.dataset.toastId, node.getBoundingClientRect().top]));
      render(h(Fragment, null, models.map(card)), host);
      if (!reducedMotion()) for (const node of host.querySelectorAll<HTMLElement>('.toast')) {
        if (node.classList.contains('is-leaving')) continue;
        const top = previous.get(node.dataset.toastId);
        if (top === undefined) node.animate?.([{ opacity: 0, transform: 'translateY(-10px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        else {
          const delta = top - node.getBoundingClientRect().top;
          if (Math.abs(delta) >= 1) node.animate?.([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
      syncLayout();
    },
    leave(id, finish) {
      const node = element(id);
      if (!node || reducedMotion() || typeof node.animate !== 'function') { finish(); return () => {}; }
      const animation = node.animate([{ opacity: 1, transform: 'translateX(0) scale(1)' }, { opacity: 0, transform: 'translateX(18px) scale(.98)' }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      const timer = window.setTimeout(finish, 240);
      animation.onfinish = finish;
      return () => { clearTimeout(timer); animation.onfinish = null; animation.cancel(); };
    }
  });
  efficiencyServices.termaNotificationToasts = service;
  window.addEventListener('terma:language-changed', service.repaint);
  window.addEventListener('pagehide', () => {
    service.dispose();
    cancelAnimationFrame(frame);
    frame = 0;
    document.documentElement.style.setProperty('--notification-stack-offset', '0px');
  });
}



export interface InstalledFeaturesEfficiencyNotificationToastViewServices {
  termaNotificationToasts?: ReturnType<typeof createNotificationToastService>;
}
