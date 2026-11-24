import { defineComponent, computed, h, type PropType } from 'vue';
import { getButtonStyleKeys, isButtonDisabled } from '../lib/core';
import type { ButtonVariant, ButtonSize } from '../lib/core';
import styles from './button.module.scss';

export const Button = defineComponent({
	name: 'Button',
	props: {
		variant: {
			type: String as PropType<ButtonVariant>,
			default: 'default',
		},
		size: {
			type: String as PropType<ButtonSize>,
			default: 'default',
		},
		loading: { type: Boolean, default: false },
		disabled: { type: Boolean, default: false },
		type: {
			type: String as PropType<'button' | 'submit' | 'reset'>,
			default: 'button',
		},
	},
	setup(props, { slots }) {
		const styleKeys = computed(() => getButtonStyleKeys(props.variant, props.size));
		const computedDisabled = computed(() => isButtonDisabled(props.disabled, props.loading));
		const classes = computed(() => [styles[styleKeys.value.base], styles[styleKeys.value.variant], styles[styleKeys.value.size]]);

		return () => {
			const children: any[] = [];
			if (props.loading) {
				children.push(
					h(
						'svg',
						{
							class: styles.spinner,
							xmlns: 'http://www.w3.org/2000/svg',
							width: '16',
							height: '16',
							viewBox: '0 0 24 24',
							fill: 'none',
							stroke: 'currentColor',
							'stroke-width': '2',
							'stroke-linecap': 'round',
							'stroke-linejoin': 'round',
						},
						[h('circle', { cx: '12', cy: '12', r: '10' })],
					),
				);
			}
			if (slots.default) {
				children.push(slots.default());
			}
			return h(
				'button',
				{
					class: classes.value,
					disabled: computedDisabled.value,
					type: props.type,
				},
				children,
			);
		};
	},
});

export default Button;
