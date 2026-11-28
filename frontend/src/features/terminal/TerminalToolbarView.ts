import {terminalServices} from '@/features/terminal/installed-services';
import { defineComponent, Fragment, h, type PropType, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';

export interface TerminalToolbarModel {
  key: string;
  connectionId: number;
  quick: boolean;
  address: string;
  statusText: string;
  statusTitle: string;
  connectionStatusCode: string;
  connectionState: string;
  shellMode: 'temporary' | 'persistent' | 'normal';
  sessionEnabled: boolean;
  sessionTitle: string;
  sessionLabel: string;
  shellLabel: string;
  temporaryLabel: string;
  sftpTitle: string;
  hasLocalFiles: boolean;
  localFilesTitle: string;
  hasRemoteJump: boolean;
  remoteJumpTitle: string;
  remoteJumpProfileId: number;
  forwardListTitle: string;
  fontSize: number;
  fontSizeTitle: string;
  decreaseFontTitle: string;
  increaseFontTitle: string;
  encoding: string;
  encodingTitle: string;
  encodingAriaLabel: string;
  fontTitle: string;
  fontLabel: string;
  startupVisible: boolean;
  startupTitle: string;
  startupLabel: string;
  startupTemporary: boolean;
  x11Title: string;
  x11Active: boolean;
  aiTitle: string;
  aiOpen: boolean;
  globalSettingsTitle: string;
  keysVisible: boolean;
  keysTitle: string;
  keysLabel: string;
  recentTitle: string;
  recentLabel: string;
  forwardListLabel: string;
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  reconnectTitle: string;
  reconnectLabel: string;
  scrollOverflow: boolean;
  scrollCanLeft: boolean;
  scrollCanRight: boolean;
  scrollLeftTitle: string;
  scrollRightTitle: string;
}

type ToolbarAction = (event: MouseEvent) => void;

function button(
  model: TerminalToolbarModel,
  className: string,
  icon: string,
  label: string,
  title: string,
  onClick?: ToolbarAction,
  extra: Record<string, unknown> = {}
): VNodeChild {
  const { trailingIcon, key: rawKey, ...attributes } = extra;
  const key = typeof rawKey === 'string' || typeof rawKey === 'number' ? rawKey : `${className}:${icon}`;
  return h(TermaButton, {
    key,
    class: className,
    title,
    'aria-label': title || label,
    onPointerdown: (event: PointerEvent) => terminalServices.termaTerminalToolbarService?.actions.keepKeyboard(event),
    onClick,
    ...attributes
  }, { default: () => [settingsIcon(icon), label ? h('span', null, label) : null, trailingIcon ? settingsIcon(String(trailingIcon)) : null] });
}

export const TerminalToolbarView = defineComponent({
  name: 'TerminalToolbarView',
  props: { model: { type: Object as PropType<TerminalToolbarModel>, required: true } },
  setup(props) {
    return () => {
      const model = props.model;
      const actionsPort = terminalServices.termaTerminalToolbarService?.actions;
      const actions: VNodeChild[] = [
        button(model, 'icon-button terminal-action-sftp', 'folder-sync', 'SFTP', model.sftpTitle, () => actionsPort?.sftp(model.connectionId)),
      ];
      if (model.hasLocalFiles) actions.push(button(model, 'icon-button local-files-open-button', 'hard-drive', '', model.localFilesTitle, undefined, {
        'data-action': 'local-files-new-tab', 'data-tab-key': model.key
      }));
      if (model.hasRemoteJump) actions.push(button(model, 'icon-button workspace-jump-button remote-desktop-jump-button', 'monitor-up', '', model.remoteJumpTitle, event => {
        actionsPort?.remoteJump(event, model.connectionId);
      }));
      if (!model.quick) actions.push(button(model, `icon-button terminal-session-button${model.sessionEnabled ? ' active' : ''}`, 'archive-restore', model.sessionLabel, model.sessionTitle, event => actionsPort?.session(event, model.key), {
        'aria-pressed': String(model.sessionEnabled), trailingIcon: 'chevron-down'
      }));
      actions.push(
        button(model, 'icon-button terminal-action-font', 'minus', '', model.decreaseFontTitle, () => actionsPort?.fontSize(model.key, -1)),
        h('output', { class: 'terminal-font-size-readout', title: model.fontSizeTitle }, `${model.fontSize}px`),
        button(model, 'icon-button terminal-action-font', 'plus', '', model.increaseFontTitle, () => actionsPort?.fontSize(model.key, 1)),
        button(model, 'terminal-dropdown-button terminal-action-display terminal-action-encoding', 'earth', model.encoding, model.encodingTitle, event => actionsPort?.encoding(event, model.key, model.connectionId), {
          'aria-label': model.encodingAriaLabel, trailingIcon: 'chevron-down'
        }),
        button(model, 'terminal-dropdown-button terminal-action-display', 'type', model.fontLabel, model.fontTitle, event => actionsPort?.font(event, model.key, model.connectionId), {
          'aria-label': model.fontTitle, 'data-has-dropdown': 'true', trailingIcon: 'chevron-down'
        })
      );
      if (model.startupVisible) actions.push(button(model, `icon-button terminal-startup-button${model.startupTemporary ? ' has-temporary-startup' : ''}`, 'command', model.startupLabel, model.startupTitle, () => actionsPort?.startup(model.key, model.connectionId)));
      actions.push(
        button(model, `icon-button terminal-x11-button${model.x11Active ? ' active' : ''}`, 'x11', '', model.x11Title, event => {
          if (model.quick) actionsPort?.quickX11(event, model.key);
          else actionsPort?.x11(event, model.connectionId, model.key);
        }),
        button(model, `icon-button terminal-ai-button${model.aiOpen ? ' active' : ''}`, 'bot', '', model.aiTitle, undefined, {
          'aria-pressed': String(model.aiOpen), 'data-action': 'terminal-ai-toggle', 'data-terminal-ai-key': model.key
        }),
        button(model, 'icon-button terminal-global-settings-button', 'settings', '', model.globalSettingsTitle, () => actionsPort?.settings(model.key)),
        button(model, 'terminal-action-keys', 'keyboard', model.keysLabel, model.keysTitle, () => actionsPort?.keys(model.key), {
          class: ['terminal-action-keys', model.keysVisible ? 'active' : ''], 'aria-pressed': String(model.keysVisible)
        }),
        button(model, 'terminal-action-recent', 'history', model.recentLabel, model.recentTitle, () => actionsPort?.recent(model.key)),
        button(model, `terminal-action-reconnect${model.connected ? ' is-connected' : ''}`, model.connected ? 'link-2-off' : model.connecting || model.reconnecting ? 'loader-circle' : 'link-2', model.reconnectLabel, model.reconnectTitle, () => actionsPort?.connection(model.connectionId, model.key), {
          disabled: model.connecting || model.reconnecting
        })
      );
      if (!model.quick) {
        actions.push(button(model, 'terminal-action-forward-list', 'route', model.forwardListLabel, model.forwardListTitle, () => actionsPort?.forwards(model.connectionId)));
      }

      return h(Fragment, null, [
        h('div', { class: 'terminal-title-row' }, [
          h('span', { class: `terminal-connection-dot ${model.connectionState}` }),
          h('div', {
            id: 'terminalStatus',
            class: 'terminal-status',
            title: model.statusTitle,
            'data-connection-address': model.address,
            'data-connection-state': model.connectionStatusCode
          }, model.statusText),
          model.quick ? h('span', { class: 'terminal-quick-badge' }, model.temporaryLabel) : h('span', { class: `terminal-session-badge ${model.shellMode}`, 'data-terminal-shell-status': model.shellMode }, model.shellLabel)
        ]),
        h('div', { class: ['terminal-actions-scroll-shell', model.scrollOverflow ? 'is-scrollable' : '', model.scrollCanLeft ? 'can-scroll-left' : '', model.scrollCanRight ? 'can-scroll-right' : ''], 'data-terminal-actions-scroll-shell': 'true' }, [
          h(TermaButton, { class: 'terminal-actions-scroll-button terminal-actions-scroll-left icon-button', title: model.scrollLeftTitle, 'aria-label': model.scrollLeftTitle, hidden: !model.scrollOverflow, disabled: !model.scrollCanLeft, 'aria-disabled': String(!model.scrollCanLeft), 'data-action': 'terminal-toolbar-scroll', 'data-scroll-direction': 'left' }, { default: () => [settingsIcon('chevron-left')] }),
          h('div', { class: 'actions terminal-actions', tabindex: 0 }, actions),
          h(TermaButton, { class: 'terminal-actions-scroll-button terminal-actions-scroll-right icon-button', title: model.scrollRightTitle, 'aria-label': model.scrollRightTitle, hidden: !model.scrollOverflow, disabled: !model.scrollCanRight, 'aria-disabled': String(!model.scrollCanRight), 'data-action': 'terminal-toolbar-scroll', 'data-scroll-direction': 'right' }, { default: () => [settingsIcon('chevron-right')] })
        ])
      ]);
    };
  }
});
