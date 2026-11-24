import { defineComponent, h, ref, watch, onMounted, onBeforeUnmount, nextTick, type PropType } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon } from '@/features/settings/settings-icon';
import { principalLabel, type PermissionPrincipal } from './permission-principals';

export const SftpPrincipalPicker = defineComponent({
  props: { id: { type: String, required: true }, value: { type: String, required: true }, kind: { type: String as PropType<'owner' | 'group'>, required: true },
    items: { type: Array as PropType<PermissionPrincipal[]>, required: true }, disabled: Boolean, label: String, placeholder: String, emptyText: String },
  emits: { change: (_value: string) => true },
  setup(p, { emit }) {
    const expanded = ref(false), root = ref<HTMLElement | null>(null);
    const draft = ref<string | null>(null); let lastInput = '';
    watch(() => p.value, value => { if (value !== lastInput) draft.value = null; });
    const outside = (event: Event) => { if (!root.value?.contains(event.target as Node)) expanded.value = false; };
    onMounted(() => document.addEventListener('pointerdown', outside, true));
    onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true));
    return () => h('div', { class: 'sftp-principal-picker', ref: root, onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded.value) { event.preventDefault(); event.stopPropagation(); expanded.value = false; root.value?.querySelector('input')?.focus(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); expanded.value = true; nextTick(() => {
        const buttons = [...(root.value?.querySelectorAll<HTMLButtonElement>('[role=option]') || [])];
        buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + 1) % buttons.length]?.focus();
      }); }
    } }, [
      h('div', { class: 'sftp-principal-control' }, [
        h('input', { id: p.id, role: 'combobox', autocomplete: 'off', value: draft.value ?? principalLabel(p.value, p.items, p.kind), disabled: p.disabled,
          placeholder: p.placeholder, 'aria-expanded': expanded.value ? 'true' : 'false', 'aria-controls': `${p.id}Options`, 'aria-autocomplete': 'list',
          onBlur: () => { draft.value = null; },
          onInput: (event: Event) => { expanded.value = false; lastInput = (event.target as HTMLInputElement).value; draft.value = lastInput; emit('change', lastInput); } }),
        h(TermaButton, { type: 'button', class: 'icon-button', disabled: p.disabled, 'aria-label': p.label, 'aria-expanded': expanded.value ? 'true' : 'false',
          onClick: () => { expanded.value = !expanded.value; } }, () => settingsIcon('chevron-down'))
      ]),
      expanded.value ? h('div', { id: `${p.id}Options`, role: 'listbox', 'aria-label': p.label, class: 'sftp-principal-options' }, [
        h(TermaButton, { role: 'option', type: 'button', 'aria-selected': !p.value, onClick: () => { emit('change', ''); expanded.value = false; root.value?.querySelector('input')?.focus(); } }, () => p.placeholder),
        ...p.items.map(item => h(TermaButton, { key: item.id, role: 'option', type: 'button', 'data-principal-id': item.id, 'aria-selected': p.value === item.id || p.value === item.name,
          onClick: () => { emit('change', item.id); expanded.value = false; root.value?.querySelector('input')?.focus(); } }, () => principalLabel(item.id, [item], p.kind))),
        !p.items.length ? h('span', { class: 'sftp-principal-empty', role: 'status' }, p.emptyText) : null
      ]) : null
    ]);
  }
});
