import { defineComponent, Fragment, h, type PropType } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';
import { handleMobileTerminalInput, sendMobileTerminalInput } from './terminal-input-actions';

export interface TerminalMobileComposerModel {
  key: string;
  placeholder: string;
  sendLabel: string;
}

export const TerminalMobileComposerView = defineComponent({
  name: 'TerminalMobileComposerView',
  props: { model: { type: Object as PropType<TerminalMobileComposerModel>, required: true } },
  setup(props) {
    return () => h(Fragment, null, [
      h('input', {
        id: 'terminalMobileInput',
        type: 'text',
        enterkeyhint: 'send',
        autocomplete: 'off',
        autocapitalize: 'none',
        spellcheck: 'false',
        placeholder: props.model.placeholder,
        'aria-label': props.model.placeholder,
        onKeydown: (event: KeyboardEvent) => handleMobileTerminalInput(event, props.model.key)
      }),
      h(TermaButton, {
        class: 'primary icon-button',
        title: props.model.sendLabel,
        'aria-label': props.model.sendLabel,
        onClick: () => sendMobileTerminalInput(props.model.key)
      }, () => settingsIcon('send'))
    ]);
  }
});
