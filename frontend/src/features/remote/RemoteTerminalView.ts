import { Fragment, h, render } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';

export interface RemoteTerminalOptions {
  key: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  statusText: string;
  draft: string;
  error: string;
  labels: { reconnect: string; reconnectShort: string; settings: string; send: string; input: string; loadFailed: string };
  reconnect(): void;
  settings(): void;
  draftChange(value: string): void;
  send(): void;
}

// xterm owns the opaque mount's children; Vue updates only the surrounding view.
export function renderRemoteTerminal(target: HTMLElement, options: RemoteTerminalOptions) {
  const button = (name: string, label: string, action: () => void, children?: string) => h(TermaButton, {
    class: 'icon-button', type: 'button', title: label, 'aria-label': label, onClick: action
  }, () => [icon(name), children ? h('span', null, children) : null]);
  render(h(Fragment, null, [
    h('div', { class: 'terminal-toolbar' }, [
      h('div', { class: 'terminal-title-row' }, [
        h('span', { class: ['terminal-connection-dot', options.status === 'error' ? 'disconnected' : options.status], 'aria-hidden': 'true' }),
        h('div', { class: 'terminal-status', role: 'status', 'data-remote-terminal-status': '' }, options.statusText)
      ]),
      h('div', { class: 'actions terminal-actions' }, [
        button('refresh-cw', options.labels.reconnect, options.reconnect, options.labels.reconnectShort),
        button('settings-2', options.labels.settings, options.settings)
      ])
    ]),
    h('div', { class: 'terminal-box', 'data-remote-terminal-mount': '' }),
    h('div', { class: 'remote-terminal-error', hidden: !options.error }, [
      h('div', { class: 'ui-state error', role: 'alert' }, [
        h('span', { class: 'ui-state-icon', 'aria-hidden': 'true' }), h('strong', null, options.labels.loadFailed),
        h('span', null, options.error), h('div', { class: 'actions' }, [button('refresh-cw', options.labels.reconnect, options.reconnect)])
      ])
    ]),
    h('div', { class: 'terminal-mobile-composer' }, [
      h('input', { type: 'text', enterkeyhint: 'send', autocomplete: 'off', autocapitalize: 'none', spellcheck: false,
        'data-remote-terminal-input': '', 'aria-label': options.labels.input, placeholder: options.labels.input, value: options.draft,
        onInput: (event: Event) => options.draftChange((event.target as HTMLInputElement).value),
        onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); options.send(); } }
      }),
      h(TermaButton, { class: 'primary icon-button', type: 'button', title: options.labels.send, 'aria-label': options.labels.send,
        disabled: options.status !== 'connected', onClick: options.send }, () => icon('send'))
    ])
  ]), target);
}
