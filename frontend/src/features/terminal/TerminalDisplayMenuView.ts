import {tr} from '@/shared/i18n/workspace-bootstrap';
import { defineComponent, Fragment, h, nextTick, onMounted, onUpdated, ref, type PropType } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';
import { TermaButton } from '@/shared/ui/TermaButton';

export type TerminalMenuEvent=Partial<Pick<MouseEvent,'clientX'|'clientY'|'target'|'currentTarget'|'preventDefault'|'stopPropagation'>>;
export interface TerminalDisplayMenuAction {
  key?: string;
  label: string;
  icon?: string;
  separator?: boolean;
  danger?: boolean;
  selected?: boolean;
  children?: TerminalDisplayMenuAction[] | (() => TerminalDisplayMenuAction[]);
  run?: (event: MouseEvent) => unknown;
}

export const TerminalDisplayMenuView = defineComponent({
  name: 'TerminalDisplayMenuView',
  props: {
    actions: { type: Array as PropType<TerminalDisplayMenuAction[]>, required: true },
    mobile: { type: Boolean, required: true },
    left: { type: Number, required: true },
    top: { type: Number, required: true },
    closeLabel: { type: String, required: true },
    menuLabel: { type: String, required: true },
    onChoose: { type: Function as PropType<(action: TerminalDisplayMenuAction, event: MouseEvent) => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true }
  },
  setup(props) {
    const mobilePath = ref<number[]>([]);
    const desktopPath = ref<number[]>([]);
    const desktopAnchorRect = ref<DOMRect | null>(null);
    const desktopPosition = ref({ left: 0, top: 0 });
    const rootMenu = ref<HTMLElement | null>(null);

    const childrenOf = (action: TerminalDisplayMenuAction) =>
      typeof action.children === 'function' ? action.children() : action.children || [];

    const actionsAt = (path: number[]) => {
      let actions = props.actions;
      for (const index of path) {
        const parent = actions[index];
        if (!parent || parent.separator) return [];
        actions = childrenOf(parent);
      }
      return actions;
    };

    const parentAt = (path: number[]) => {
      let actions = props.actions;
      let parent: TerminalDisplayMenuAction | undefined;
      for (const index of path) {
        parent = actions[index];
        if (!parent || parent.separator) return undefined;
        actions = childrenOf(parent);
      }
      return parent;
    };

    const positionDesktopMenus = () => {
      if (props.mobile) return;
      const root = rootMenu.value;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      root.style.left = `${Math.max(8, Math.min(props.left, window.innerWidth - rootRect.width - 8))}px`;
      root.style.top = `${Math.max(8, Math.min(props.top, window.innerHeight - rootRect.height - 8))}px`;
      if (!desktopPath.value.length || !desktopAnchorRect.value) return;
      const menu = document.getElementById('actionSubMenu');
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const anchor = desktopAnchorRect.value;
      const parentRect = root.getBoundingClientRect();
      const right = parentRect.right + 4;
      const left = right + rect.width <= window.innerWidth - 8
        ? right
        : Math.max(8, parentRect.left - rect.width - 4);
      const top = Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8));
      if (desktopPosition.value.left !== left || desktopPosition.value.top !== top) {
        desktopPosition.value = { left, top };
      }
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };

    onMounted(positionDesktopMenus);
    onUpdated(() => void nextTick(positionDesktopMenus));

    const chooseOrOpen = (
      action: TerminalDisplayMenuAction,
      index: number,
      path: number[],
      event: MouseEvent
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (action.children) {
        if (!childrenOf(action).length) return;
        if (props.mobile) {
          mobilePath.value = [...path, index];
        } else {
          desktopAnchorRect.value = (event.currentTarget as HTMLElement).getBoundingClientRect();
          desktopPath.value = [...path, index];
          void nextTick(positionDesktopMenus);
        }
        return;
      }
      props.onChoose(action, event);
    };

    const renderActions = (actions: TerminalDisplayMenuAction[], path: number[]) => actions.map((action, index) =>
      action.separator
        ? h('div', { key: `separator-${path.join('-')}-${index}`, class: 'menu-separator', role: 'separator' })
        : h(TermaButton, {
          key: action.key || `action-${path.join('-')}-${index}`,
          type: 'button',
          class: ['terminal-display-menu-item', action.danger ? 'danger' : '', action.children ? 'has-submenu' : ''],
          role: action.selected ? 'menuitemradio' : 'menuitem',
          'aria-checked': action.selected === undefined ? undefined : String(action.selected),
          'aria-haspopup': action.children ? 'menu' : undefined,
          'aria-expanded': action.children
            ? String((props.mobile ? mobilePath.value : desktopPath.value).join('.') === [...path, index].join('.'))
            : undefined,
          'data-terminal-display-action': action.key || `action-${index}`,
          onMouseenter: (event: MouseEvent) => {
            if (!action.danger && action.selected !== true) {
              (event.currentTarget as HTMLElement).style.setProperty('background-color', 'color-mix(in srgb, var(--text) 5%, var(--panel))', 'important');
            }
          },
          onMouseleave: (event: MouseEvent) => {
            (event.currentTarget as HTMLElement).style.removeProperty('background-color');
          },
          onClick: (event: MouseEvent) => chooseOrOpen(action, index, path, event)
        }, () => [
          settingsIcon(action.icon || (action.selected ? 'check' : 'circle')),
          h('span', null, action.label),
          action.children ? settingsIcon('chevron-right') : null
        ]));

    return () => {
      const currentPath = props.mobile ? mobilePath.value : [];
      const currentActions = actionsAt(currentPath);
      const desktopParent = parentAt(desktopPath.value);
      const menu = h('div', {
        id: 'actionMenu',
        ref: rootMenu,
        class: ['context-menu', 'action-menu', 'terma-vue-root', 'terma-terminal-controls-root', props.mobile ? 'mobile-action-menu' : ''],
        role: 'menu',
        'aria-label': props.mobile && currentPath.length ? parentAt(currentPath)?.label : props.menuLabel,
        'data-terma-vue-display-menu': 'true',
        style: props.mobile ? undefined : { left: `${props.left}px`, top: `${props.top}px` }
      }, [
        props.mobile && currentPath.length
          ? h(Fragment, null, [
            h(TermaButton, { type: 'button', class: 'action-menu-back', 'data-terminal-menu-back': 'true', onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); mobilePath.value = currentPath.slice(0, -1); } }, () => [settingsIcon('arrow-left'), h('span', null, tr?.('common:auto.back_to_parent_menu', { defaultValue: '返回上一级' }) || '返回上一级')]),
            h('div', { class: 'menu-separator', role: 'separator' })
          ])
          : null,
        ...renderActions(currentActions, currentPath),
        props.mobile ? h(TermaButton, { type: 'button', class: 'action-menu-close', onClick: props.onClose }, () => [settingsIcon('x'), h('span', null, props.closeLabel)]) : null
      ]);
      const submenu = !props.mobile && desktopPath.value.length
        ? h('div', {
          id: 'actionSubMenu',
          class: ['context-menu', 'action-menu', 'action-submenu', 'terma-vue-root', 'terma-terminal-controls-root'],
          role: 'menu',
          'aria-label': desktopParent?.label || props.menuLabel,
          'data-terma-vue-submenu': 'true',
          style: { left: `${desktopPosition.value.left}px`, top: `${desktopPosition.value.top}px` }
        }, renderActions(actionsAt(desktopPath.value), desktopPath.value))
        : null;
      return h(Fragment, null, [
        props.mobile ? h('button', { id: 'actionMenuBackdrop', class: 'action-menu-backdrop', type: 'button', 'aria-label': props.closeLabel, onClick: props.onClose }) : null,
        menu,
        submenu
      ]);
    };
  }
});
