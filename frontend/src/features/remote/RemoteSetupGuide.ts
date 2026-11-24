import { h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';

export interface RemoteSetupGuideModel {
  protocol: 'rdp' | 'vnc' | 'xdmcp';
  title: string;
  endpoint: string;
  closeLabel: string;
  service: { title: string; detail: string; tone: 'success' | 'warning' };
  management: { title: string; detail: string; action: string };
  guide: { icon: string; tag: string; title: string; detail: string; extra?: string; risk?: boolean };
}

export interface RemoteSetupGuideOptions {
  model(): RemoteSetupGuideModel;
  close(): void;
  manage(): void;
}

export function renderRemoteSetupGuide(target: HTMLElement, options: RemoteSetupGuideOptions) {
  const model = options.model();
  const titleId = `${model.protocol}SetupGuideTitle`;
  const notice = (title: string, detail: string, tone: string, symbol: string, action = false) => h('div', {
    class: `connection-test-status remote-diagnostic-status ${tone}`
  }, [
    h('span', { class: 'remote-diagnostic-icon', 'aria-hidden': 'true' }, [icon(symbol)]),
    h('span', { class: 'remote-diagnostic-copy' }, [h('b', null, title), h('span', null, detail)]),
    action ? h('span', { class: 'remote-diagnostic-actions' }, [
      h(TermaButton, { type: 'button', 'data-remote-setup-manage': '', onClick: options.manage }, () => [icon('server-cog'), h('span', null, model.management.action)])
    ]) : null
  ]);

  render(h('div', {
    class: `modal-card wide x11-install-guide remote-install-dialog terma-remote-setup-guide ${model.protocol === 'vnc' ? 'vnc-setup-guide' : ''}`,
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); options.close(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    }
  }, [
    h('div', { class: 'modal-title-row' }, [
      h('div', null, [h('h2', { id: titleId }, model.title), h('span', { class: 'muted' }, model.endpoint)]),
      h(TermaButton, { class: 'icon-button', type: 'button', title: model.closeLabel, 'aria-label': model.closeLabel, onClick: options.close }, () => icon('x'))
    ]),
    notice(model.service.title, model.service.detail, model.service.tone, model.protocol === 'xdmcp' ? 'panels-top-left' : 'monitor-up'),
    notice(model.management.title, model.management.detail, 'warning', 'server-off', true),
    h('div', { class: 'remote-protocol-guide' }, [
      h('span', { class: 'remote-protocol-guide-icon', 'aria-hidden': 'true' }, [icon(model.guide.icon)]),
      h('div', null, [
        h('span', { class: 'remote-protocol-guide-tag' }, model.guide.tag), h('strong', null, model.guide.title),
        h('small', null, model.guide.detail),
        model.guide.extra ? h('small', { class: model.guide.risk ? 'remote-protocol-guide-risk' : '' }, model.guide.extra) : null
      ])
    ]),
    h('div', { class: 'actions' }, [h(TermaButton, { type: 'button', onClick: options.close }, () => model.closeLabel)])
  ]), target);
}
