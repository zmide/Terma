import { Fragment, h, render, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';

export interface ManagementAction {
  id: string; label: string; icon?: string; className?: string; disabled?: boolean;
  actionKey?: string; run(button: HTMLElement, event?: MouseEvent): void;
}
export interface ManagementNotice {
  title?: string; detail: string; tone?: string; icon?: string; className?: string;
  actions?: ManagementAction[];
}
export interface ManagementSource {
  label: string; current: string; target?: string; id: string; value: string; help: string;
  options?: { value: string; label: string }[]; warning?: string; actionKey?: string; disabled?: boolean;
  change?(select: HTMLSelectElement): void;
}
export interface ManagementModel {
  className?: string; title?: string; subtitle?: string; titleId?: string; closeLabel?: string;
  loading?: string; notices?: ManagementNotice[];
  head?: { title: string; detail: string; icon: string; tone: string };
  meta?: { text: string; icon: string; title?: string }[];
  sessions?: { label: string; names: string[] };
  guide?: { icon: string; tag: string; title: string; detail: string; extra?: string; risk?: boolean };
  rendering?: { summary: string; detail: string; meta: string; tone: string; icon: string; actions: ManagementAction[] };
  source?: ManagementSource;
  install?: { label: string; modes: (ManagementAction & { description: string; state: string; mode: string })[] };
  manual?: { label: string; steps: string[]; commands: string[]; note: string; reference: string; unavailable: string; copy: ManagementAction; open?: boolean };
  taskHostId?: string; actions?: ManagementAction[];
  progress?: { title: string; detail: string; percent: number; tone: string; icon: string; action: ManagementAction; error: string };
}
export interface ManagementOptions { model(): ManagementModel; close?(): void; dismissed?(): void }

function actionButton(action: ManagementAction, extra: Record<string, unknown> = {}, children?: VNodeChild[]) {
  return h(TermaButton, {
    key: action.id, type: 'button', class: action.className, disabled: action.disabled,
    'data-management-action': action.id, 'data-ui-action-key': action.actionKey,
    onClick: (event: MouseEvent) => action.run(event.currentTarget as HTMLElement, event), ...extra
  }, () => children || [action.icon ? icon(action.icon) : null, h('span', null, action.label)]);
}

export function managementContent(m: ManagementModel, modal = false): VNodeChild[] {
  const notices = (m.notices || []).map((notice, index) => h('div', {
    key: `notice-${index}`, class: ['connection-test-status remote-diagnostic-status', notice.tone || '', notice.className || '']
  }, [
    h('span', { class: 'remote-diagnostic-icon', 'aria-hidden': 'true' }, [icon(notice.icon || 'info')]),
    h('span', { class: 'remote-diagnostic-copy' }, [notice.title ? h('b', null, notice.title) : null, h('span', null, notice.detail)]),
    notice.actions?.length ? h('span', { class: 'remote-diagnostic-actions' }, notice.actions.map(item => actionButton(item))) : null
  ]));
  const body: VNodeChild[] = [
    m.loading ? h('div', { class: 'xdmcp-server-loading', role: 'status' }, [icon('loader-circle'), h('span', null, m.loading)]) : null,
    ...notices,
    m.head ? h('div', { class: 'remote-service-head' }, [
      h('span', { class: `remote-service-icon ${m.head.tone}`, 'aria-hidden': 'true' }, [icon(m.head.icon)]),
      h('div', { class: 'vnc-connection-help-copy' }, [h('strong', null, m.head.title), h('small', null, m.head.detail)])
    ]) : null,
    m.meta?.length ? h('div', { class: 'remote-service-meta' }, m.meta.map(item => h('span', { key: item.text, title: item.title }, [icon(item.icon), item.text]))) : null,
    m.sessions ? h('div', { class: 'xdmcp-sessions', 'aria-label': m.sessions.label }, m.sessions.names.map(name => h('span', { key: name }, [icon('monitor'), name]))) : null,
    m.source ? h('div', { class: ['vnc-server-source', !m.source.options ? 'readonly' : ''] }, [
      h('span', { class: 'vnc-server-source-label' }, m.source.label), h('strong', null, m.source.current),
      m.source.options ? h('label', { class: 'vnc-server-source-label', for: m.source.id }, m.source.target) : null,
      m.source.options ? h('select', { id: m.source.id, value: m.source.value, disabled:m.source.disabled, 'data-ui-action-key': m.source.actionKey,
        onChange: (event: Event) => m.source?.change?.(event.currentTarget as HTMLSelectElement)
      }, m.source.options.map(item => h('option', { key: item.value, value: item.value }, item.label))) : null,
      h('small', null, m.source.help),
      m.source.warning ? h('div', { class: 'connection-test-status warning' }, m.source.warning) : null
    ]) : null,
    m.install ? h('div', { class: 'remote-install-modes', role: 'group', 'aria-label': m.install.label }, m.install.modes.map(mode => actionButton(mode, {
      class: 'remote-install-mode', 'data-install-mode': mode.mode
    }, [
      h('span', { class: 'remote-install-mode-icon', 'aria-hidden': 'true' }, [icon(mode.icon || 'package')]),
      h('span', { class: 'remote-install-mode-copy' }, [h('strong', null, mode.label), h('small', null, mode.description)]),
      h('span', { class: 'remote-install-mode-state' }, mode.disabled ? mode.state : icon(mode.mode === 'manual' ? 'chevron-down' : 'chevron-right'))
    ]))) : null,
    m.guide ? h('div', { class: 'remote-protocol-guide' }, [
      h('span', { class: 'remote-protocol-guide-icon', 'aria-hidden': 'true' }, [icon(m.guide.icon)]),
      h('div', null, [h('span', { class: 'remote-protocol-guide-tag' }, m.guide.tag), h('strong', null, m.guide.title),
        h('small', null, m.guide.detail), m.guide.extra ? h('small', { class: m.guide.risk ? 'remote-protocol-guide-risk' : '' }, m.guide.extra) : null])
    ]) : null,
    m.rendering ? h('div', { class: `remote-rendering-state ${m.rendering.tone}` }, [
      h('span', { class: 'remote-rendering-icon', 'aria-hidden': 'true' }, [icon(m.rendering.icon)]),
      h('div', { class: 'remote-rendering-copy' }, [h('strong', null, m.rendering.summary), h('small', null, m.rendering.detail), m.rendering.meta ? h('span', null, m.rendering.meta) : null]),
      m.rendering.actions.length ? h('div', { class: 'remote-rendering-actions' }, m.rendering.actions.map(item => actionButton(item))) : null
    ]) : null,
    m.manual ? h('details', { class: 'remote-install-manual', open: m.manual.open }, [
      h('summary', null, [icon('book-open-check'), h('span', null, m.manual.label)]),
      h('div', { class: 'remote-install-manual-body' }, [
        m.manual.steps.length ? h('ol', { class: 'x11-install-steps' }, m.manual.steps.map((step, index) => h('li', { key: index }, step))) : null,
        m.manual.commands.length ? h(Fragment, null, [h('label', null, m.manual.reference), ...m.manual.commands.map((command, index) => h('pre', { key: index, class: 'x11-install-command' }, command)), actionButton(m.manual.copy, { class: 'remote-install-copy' })]) : h('div', { class: 'connection-test-status warning' }, m.manual.unavailable),
        h('div', { class: 'x11-install-note' }, m.manual.note)
      ])
    ]) : null,
    m.taskHostId ? h('div', { id: m.taskHostId }) : null,
    m.progress ? h('div', { class: `remote-component-progress ${m.progress.tone}`, role: 'status', 'aria-live': 'polite' }, [
      h('div', { class: 'remote-component-progress-head' }, [h('span', { class: `remote-service-icon ${m.progress.tone}` }, [icon(m.progress.icon)]), h('div', null, [h('b', null, m.progress.title), h('small', null, m.progress.detail)]), h('strong', null, `${Math.round(m.progress.percent)}%`)]),
      h('div', { class: 'remote-component-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(m.progress.percent) }, [h('i', { style: { width: `${m.progress.percent}%` } })]),
      m.progress.error ? h('div', { class: 'connection-test-status error' }, m.progress.error) : null,
      h('div', { class: 'actions tight' }, [actionButton(m.progress.action)])
    ]) : null,
    m.actions?.length ? h('div', { class: modal ? 'actions' : 'remote-service-actions' }, m.actions.map(item => actionButton(item))) : null
  ];
  return body;
}

export function renderManagement(target: HTMLElement, options: ManagementOptions, modal = false) {
  const oldCard=modal ? target.querySelector<HTMLElement>('.terma-managed-install') : null;
  const scrollTop=oldCard?.scrollTop || 0;
  const m = options.model();
  const body = managementContent(m, modal);
  if (!modal) { render(h('div', { class: ['remote-management-view', m.className], 'data-management-owned': '' }, body), target); return; }
  render(h('div', { class: ['modal-card wide x11-install-guide remote-install-dialog terma-managed-install', m.className], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': m.titleId,
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); options.close?.(); }
      if (event.key !== 'Tab') return;
      const fields = [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')].filter(element => element.checkVisibility());
      if (event.shiftKey && (document.activeElement === fields[0] || !target.contains(document.activeElement))) { event.preventDefault(); fields.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === fields.at(-1) || !target.contains(document.activeElement))) { event.preventDefault(); fields[0]?.focus(); }
    }
  }, [h('div', { class: 'modal-title-row' }, [h('div', null, [h('h2', { id: m.titleId }, m.title), h('span', { class: 'muted' }, m.subtitle)]),
    h(TermaButton, { class: 'icon-button', type: 'button', title: m.closeLabel, 'aria-label': m.closeLabel, onClick: options.close }, () => icon('x'))]), ...body]), target);
  const card=target.querySelector<HTMLElement>('.terma-managed-install');
  if(oldCard && card)card.scrollTop=scrollTop;
}
