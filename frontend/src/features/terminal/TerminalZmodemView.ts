import {tr} from '@/shared/i18n/workspace-bootstrap';
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';

export interface TerminalZmodemViewModel {
  hidden?: boolean;
  icon?: string;
  title?: string;
  titleKey?: string;
  titleOptions?: Record<string, unknown>;
  detail?: string;
  detailKey?: string;
  detailOptions?: Record<string, unknown>;
  progress?: number;
  showProgress?: boolean;
  primaryAction?: string;
  primaryIcon?: string;
  primaryLabel?: string;
  primaryLabelKey?: string;
  primaryLabelOptions?: Record<string, unknown>;
}



function text(view: TerminalZmodemViewModel, field: 'title' | 'detail' | 'primaryLabel', fallbackKey = '', fallback = '') {
  const key = String(view[`${field}Key` as keyof TerminalZmodemViewModel] || '');
  const options = { ...((view[`${field}Options` as keyof TerminalZmodemViewModel] as Record<string, unknown> | undefined) || {}) };
  if (!Object.prototype.hasOwnProperty.call(options, 'defaultValue') && fallback) options.defaultValue = fallback;
  if (key && typeof tr === 'function') return tr(key, options);
  const value = view[field];
  return value !== undefined && value !== null ? String(value) : (fallbackKey && typeof tr === 'function' ? tr(fallbackKey, { defaultValue: fallback }) : fallback);
}

export const TerminalZmodemView = defineComponent({
  name: 'TerminalZmodemView',
  props: { view: { type: Object as PropType<TerminalZmodemViewModel>, required: true } },
  setup(props) {
    return () => {
      const view = props.view;
      if (view.hidden) return null;
      const progress = Math.max(0, Math.min(100, Number(view.progress || 0)));
      const title = text(view, 'title', 'terminal:zmodem.title', 'ZMODEM 文件传输');
      const detail = text(view, 'detail');
      const primaryLabel = text(view, 'primaryLabel', 'terminal:zmodem.continue', '继续');
      const cancelLabel = typeof tr === 'function'
        ? tr('terminal:zmodem.cancel_hint', { defaultValue: '取消本次 ZMODEM 传输（Ctrl+C）' })
        : '取消本次 ZMODEM 传输（Ctrl+C）';
      const actions: VNodeChild[] = [];
      if (view.primaryAction) {
        actions.push(h(TermaButton, {
          type: 'button',
          class: 'primary',
          'data-zmodem-action': view.primaryAction,
          title: primaryLabel,
          'aria-label': primaryLabel
        }, () => [settingsIcon(view.primaryIcon || 'folder-open'), h('span', null, primaryLabel)]));
      }
      actions.push(h(TermaButton, {
        type: 'button',
        class: 'icon-button',
        'data-zmodem-action': 'cancel',
        title: cancelLabel,
        'aria-label': cancelLabel
      }, () => settingsIcon('x')));
      return h('div', { class: 'terma-zmodem-content' }, [
        h('div', { class: 'terminal-zmodem-icon' }, settingsIcon(view.icon || 'arrow-left-right')),
        h('div', { class: 'terminal-zmodem-copy' }, [
          h('strong', null, title),
          h('span', null, detail),
          view.showProgress ? h('div', {
            class: 'terminal-zmodem-progress',
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-valuenow': String(Math.round(progress))
          }, h('i', { style: { width: `${progress}%` } })) : null
        ]),
        h('div', { class: 'terminal-zmodem-actions' }, actions)
      ]);
    };
  }
});
