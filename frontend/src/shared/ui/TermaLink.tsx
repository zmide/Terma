import { defineComponent, h, type PropType } from 'vue';
import styles from '@/components/ui/button/button.module.scss';

type TermaLinkVariant = 'default' | 'outline';

export const TermaLink = defineComponent({
  name: 'TermaLink',
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    href: { type: String, required: true },
    target: { type: String, default: undefined },
    rel: { type: String, default: undefined },
    title: { type: String, default: undefined },
    variant: { type: String as PropType<TermaLinkVariant>, default: 'outline' }
  },
  setup(props, { attrs, slots }) {
    return () => h('a', {
      ...attrs,
      id: props.id,
      href: props.href,
      target: props.target,
      rel: props.rel,
      title: props.title,
      class: [
        styles.button,
        styles.sizeDefault,
        props.variant === 'default' ? styles.variantDefault : styles.variantOutline,
        'terma-link',
        attrs.class
      ]
    }, slots);
  }
});
