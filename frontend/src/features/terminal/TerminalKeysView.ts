import {terminalServices} from '@/features/terminal/installed-services';
import { defineComponent, Fragment, h, type PropType, type VNodeChild } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';

export interface TerminalKeyShortcutView {
  index: number;
  label: string;
  title: string;
  arrow?: 'up' | 'left' | 'down' | 'right';
}

export interface TerminalKeysModel {
  key: string;
  visible: boolean;
  ctrlArmed: boolean;
  ctrlLocked: boolean;
  ctrlOnceTitle: string;
  ctrlOnceLabel: string;
  ctrlLockTitle: string;
  ctrlLockLabel: string;
  configureLabel: string;
  shortcuts: TerminalKeyShortcutView[];
}

function shortcutButton(model: TerminalKeysModel, shortcut: TerminalKeyShortcutView): VNodeChild {
  return h(TermaButton, {
    key: shortcut.index,
    type: 'button',
    class: ['terminal-key-shortcut', shortcut.arrow ? `arrow-${shortcut.arrow}` : ''],
    title: shortcut.title,
    'aria-label': shortcut.title || shortcut.label,
    'data-i18n-skip': 'true',
    'data-shortcut-index': shortcut.index,
    onPointerdown: (event: PointerEvent) => terminalServices.termaTerminalKeysService?.keepKeyboard(event),
    onClick: () => terminalServices.termaTerminalKeysService?.sendShortcut(model.key, shortcut.index)
  }, () => shortcut.label);
}

export const TerminalKeysView = defineComponent({
  name: 'TerminalKeysView',
  props: { model: { type: Object as PropType<TerminalKeysModel>, required: true } },
  setup(props) {
    return () => {
      const model = props.model;
      const shortcuts: VNodeChild[] = [];
      for (let index = 0; index < model.shortcuts.length; index++) {
        const group = model.shortcuts.slice(index, index + 4);
        if (group.length === 4 && group.map(item => item.arrow).join(',') === 'up,left,down,right') {
          shortcuts.push(h('span', { key: `arrows-${group[0]!.index}`, class: 'terminal-arrow-pad', 'data-i18n-skip': 'true' }, group.map(item => shortcutButton(model, item))));
          index += 3;
        } else {
          shortcuts.push(shortcutButton(model, model.shortcuts[index]!));
        }
      }
      return h(Fragment, null, [
        ...shortcuts,
        h(TermaButton, {
          type: 'button',
          class: ['terminal-key-ctrl-once', model.ctrlArmed || model.ctrlLocked ? 'active' : ''],
          title: model.ctrlOnceTitle,
          'aria-label': model.ctrlOnceTitle,
          'aria-pressed': String(model.ctrlArmed || model.ctrlLocked),
          onPointerdown: (event: PointerEvent) => terminalServices.termaTerminalKeysService?.keepKeyboard(event),
          onClick: () => terminalServices.termaTerminalKeysService?.armCtrl(model.key)
        }, () => model.ctrlOnceLabel),
        h(TermaButton, {
          type: 'button',
          class: ['terminal-key-ctrl-lock', model.ctrlLocked ? 'active' : ''],
          title: model.ctrlLockTitle,
          'aria-label': model.ctrlLockTitle,
          'aria-pressed': String(model.ctrlLocked),
          onPointerdown: (event: PointerEvent) => terminalServices.termaTerminalKeysService?.keepKeyboard(event),
          onClick: () => terminalServices.termaTerminalKeysService?.toggleCtrlLock(model.key)
        }, () => model.ctrlLockLabel),
        h(TermaButton, {
          type: 'button',
          class: 'icon-button terminal-shortcut-configure',
          title: model.configureLabel,
          'aria-label': model.configureLabel,
          onPointerdown: (event: PointerEvent) => terminalServices.termaTerminalKeysService?.keepKeyboard(event),
          onClick: () => terminalServices.termaTerminalKeysService?.showSettings(model.key)
        }, () => settingsIcon('settings'))
      ]);
    };
  }
});
