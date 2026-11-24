import { defineComponent, h, nextTick, ref } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from './settings-icon';

export function createPasswordVisibilityControl(readInput: () => HTMLInputElement | undefined, change: (visible: boolean) => void) {
  const selection = () => {
    const field = readInput();
    return { start: field?.selectionStart, end: field?.selectionEnd, direction: field?.selectionDirection, focused: document.activeElement === field, value: field?.value };
  };
  let pointerSelection: ReturnType<typeof selection> | undefined;
  let selectionRevision = 0;
  return (visible: boolean, disabled: boolean, showLabel: string, hideLabel: string) => h(TermaButton, {
    class: 'password-visibility-toggle', type: 'button', disabled,
    title: visible ? hideLabel : showLabel,
    'aria-label': visible ? hideLabel : showLabel,
    'aria-pressed': String(visible),
    onPointerdown: (event: PointerEvent) => { pointerSelection = selection(); event.preventDefault(); },
    onPointercancel: () => { pointerSelection = undefined; },
    onClick: (event: MouseEvent) => {
      const field = readInput();
      if (!field || field.disabled) return;
      const { start, end, direction, focused, value } = event.detail > 0 && pointerSelection ? pointerSelection : selection();
      pointerSelection = undefined;
      change(field.type !== 'text');
      const revision = ++selectionRevision;
      // Chromium resets the selection after a password type change.
      if (focused) void nextTick(() => requestAnimationFrame(() => {
        const current = readInput();
        if (revision !== selectionRevision || !current?.isConnected || document.activeElement !== current || current.value !== value) return;
        if (start != null && end != null) current.setSelectionRange(start, end, direction || undefined);
      }));
    }
  }, () => settingsIcon(visible ? 'eye-off' : 'eye'));
}

export const SettingsPasswordField = defineComponent({
  name: 'SettingsPasswordField',
  inheritAttrs: false,
  props: { showLabel: { type: String, required: true }, hideLabel: { type: String, required: true } },
  setup(props, { attrs }) {
    const visible = ref(false);
    const input = ref<HTMLInputElement>();
    const button = createPasswordVisibilityControl(() => input.value, value => { visible.value = value; });
    return () => <div class="password-input-control" hidden={Boolean(attrs.hidden)}>
      {h('input', { ...attrs, ref: input, type: visible.value ? 'text' : 'password' })}
      {button(visible.value, Boolean(attrs.disabled), props.showLabel, props.hideLabel)}
    </div>;
  }
});
