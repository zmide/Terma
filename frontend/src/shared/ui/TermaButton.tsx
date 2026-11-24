import { defineComponent, h, ref, type PropType } from 'vue';
import { Button } from '@/components/ui/button';

// Adapt the upstream component at the product boundary, keeping its source intact.
export const TermaButton = defineComponent({
  name: 'TermaButton',
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    title: { type: String, default: undefined },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    type: { type: String as PropType<'button' | 'submit' | 'reset'>, default: 'button' }
  },
  emits: { click: (_event: MouseEvent) => true },
  setup(props, { attrs, slots, emit }) {
    const busy = ref(false);
    const actionLocked = ref(false);
    const busyText = ref<string | (() => string)>('');
    return () => h(Button, {
      ...attrs,
      id: props.id,
      title: props.title,
      class: ['terma-button', attrs.class],
      variant: 'outline',
      type: props.type,
      disabled: props.disabled || busy.value || actionLocked.value,
      loading: props.loading,
      'data-terma-button': '',
      'aria-busy': busy.value || actionLocked.value || props.loading ? 'true' : attrs['aria-busy'],
      onTermaButtonActionLock: (event: CustomEvent<{ busy: boolean }>) => {
        actionLocked.value = event.detail.busy;
      },
      onTermaButtonBusy: (event: CustomEvent<{ busy: boolean; text?: string | (() => string) }>) => {
        busy.value = event.detail.busy;
        busyText.value = event.detail.text || '';
      },
      onClick: (event: MouseEvent) => { emit('click', event); }
    }, busy.value && busyText.value ? { default: () => typeof busyText.value === 'function' ? busyText.value() : busyText.value } : slots);
  }
});
