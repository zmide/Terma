import {h, render, type VNode, type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {showActionMenu} from '@/shared/action-menu';
import {settingsIcon as icon} from '../settings/settings-icon';
import {panelLayout, type PanelRegion, type PanelTab, type createPanelModel} from './panel-model';
import type {WorkspaceLayoutNode} from '../workspace/workspace-layout-service';

export interface PanelTarget {key: string; connectionId: number; label: string; connected: boolean}
export interface PanelViewPort {
  text(key: string, params?: Record<string, unknown>): string;
  target(tab: PanelTab): PanelTarget | null;
  toggle(): void;
  dock(): void;
  resize(event: PointerEvent | KeyboardEvent, splitId?: string): void;
  close(key: string): void;
  content(tab: PanelTab, host: HTMLElement): void;
  release(key: string, host: HTMLElement): void;
  restore(value: unknown): void;
  drag(event: PointerEvent, key: string): void;
  suppressClick(): boolean;
  tools(tab: PanelTab): VNodeChild;
}

export function paintPanel(host: HTMLElement, model: ReturnType<typeof createPanelModel>, port: PanelViewPort, region: PanelRegion = 'bottom') {
  const {state} = model, current = model.current(), t = port.text;
  const layout = model.layout(region), panes = panelLayout.leaves(layout);
  const focused = panes.find(pane => pane.id === current.focusedPaneId) || panes[0];
  const button = (action: string, glyph: string, run: () => unknown, disabled = false, secondary = false) =>
    h(TermaButton, {class: ['icon-button', {'terminal-panel-action-secondary': secondary}], title: t(action), 'aria-label': t(action), 'data-panel-action': action,
      disabled, onClick: run}, () => icon(glyph));
  const extraActions = [
    ...(region === 'bottom' ? [{key: 'presets', glyph: 'layout-template', run: () => {state.presetsOpen = !state.presetsOpen; model.publish();}}] : []),
    ...(region === 'bottom' ? [{key: 'split_horizontal', glyph: 'columns-2', disabled: !focused || focused.tabs.length <= 1,
      run: () => {if (focused) model.move(focused.activeTabKey, {paneId: focused.id, zone: 'right'});}},
    {key: 'split_vertical', glyph: 'rows-2', disabled: !focused || focused.tabs.length <= 1,
      run: () => {if (focused) model.move(focused.activeTabKey, {paneId: focused.id, zone: 'bottom'});}}] : []),
    {key: region === 'bottom' ? 'dock_right' : 'dock_bottom', glyph: region === 'bottom' ? 'panel-right' : 'panel-bottom', run: port.dock}
  ];
  const actions = () => h('div', {class: 'terminal-panel-header-actions'}, [
    panes.length > 1 ? h('select', {class: 'terminal-panel-pane-switch',
      'aria-label': t('switch_pane'), value: focused?.id, onChange: (event: Event) => {
        const pane = model.findPane((event.target as HTMLSelectElement).value);
        if (pane) model.activate(pane.id, pane.activeTabKey);
      }}, panes.map((pane, index) => h('option', {value: pane.id}, t('pane_number', {number: index + 1})))) : null,
    ...extraActions.map(action => button(action.key, action.glyph, action.run, action.disabled, true)),
    h(TermaButton, {class: 'icon-button terminal-panel-action-menu', title: t('more_actions'), 'aria-label': t('more_actions'),
      'data-panel-action': 'more_actions', onClick: (event: MouseEvent) => showActionMenu(event, extraActions.map(action => ({
        label: t(action.key), icon: action.glyph, disabled: action.disabled, run: action.run
      })))}, () => icon('ellipsis')),
    button(state.maximized && state.maximizedRegion === region ? 'restore' : 'maximize',
      state.maximized && state.maximizedRegion === region ? 'minimize-2' : 'maximize-2', () => {
        state.maximized = !(state.maximized && state.maximizedRegion === region); state.maximizedRegion = region; model.publish();
      }),
    button('hide', 'x', port.toggle)
  ]);
  function tabButton(tab: PanelTab, paneId: string, active: boolean) {
    return h('div', {key: tab.key, class: ['terminal-panel-tab', {active}], role: 'presentation',
      'data-panel-tab-shell': tab.key, onPointerdown: (event: PointerEvent) => port.drag(event, tab.key)}, [
      h('button', {type: 'button', role: 'tab', 'aria-selected': active, tabindex: active ? 0 : -1,
        'aria-expanded': region === 'right' ? !state.collapsedRight.has(tab.key) : undefined,
        'data-panel-tab': tab.key, title: t(tab.kind), onClick: () => {
          if (!port.suppressClick()) {
            if (region === 'right') model.toggleSection(paneId, tab.key);
            else model.activate(paneId, tab.key);
          }
        },
        onKeydown: (event: KeyboardEvent) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const pane = model.findPane(paneId)!;
          const index = pane.tabs.indexOf(tab.key), next = event.key === 'Home' ? 0 : event.key === 'End'
            ? pane.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + pane.tabs.length) % pane.tabs.length;
          event.preventDefault(); model.activate(paneId, pane.tabs[next]);
          requestAnimationFrame(() => host.querySelector<HTMLButtonElement>(`[data-panel-tab="${pane.tabs[next]}"]`)?.focus());
        }}, [region === 'right' ? icon(state.collapsedRight.has(tab.key) ? 'chevron-right' : 'chevron-down') : null,
          h('span', {class: 'terminal-panel-tab-name'}, t(tab.kind))]),
      region === 'right' ? h('span', {class: 'tab-close'}, button('return_bottom', 'x', () => port.close(tab.key))) : null
    ]);
  }
  const contentView = (tab: PanelTab, hidden: boolean) =>
    h('div', {key: tab.key, class: 'terminal-panel-content', hidden,
      role: 'tabpanel', 'aria-label': t(tab.kind), 'data-panel-content': tab.key,
      onVnodeMounted: (vnode: VNode) => {if (vnode.el instanceof HTMLElement) port.content(tab, vnode.el);},
      onVnodeUpdated: (vnode: VNode) => {if (vnode.el instanceof HTMLElement) port.content(tab, vnode.el);},
      onVnodeBeforeUnmount: (vnode: VNode) => {if (vnode.el instanceof HTMLElement) port.release(tab.key, vnode.el);}});
  function paneView(node: WorkspaceLayoutNode): VNode {
    if (node.type === 'split') {
      return h('div', {key: node.id, class: `terminal-panel-split ${node.direction}`, 'data-panel-split': node.id,
        style: {'--panel-ratio': `${node.ratio * 100}%`}}, [
        paneView(node.first),
        h('div', {class: 'terminal-panel-divider', role: 'separator', tabindex: 0,
          'aria-label': t('resize_split'), 'aria-orientation': node.direction === 'row' ? 'vertical' : 'horizontal',
          'aria-valuemin': 20, 'aria-valuemax': 80, 'aria-valuenow': Math.round(node.ratio * 100),
          'data-panel-divider': node.id, onPointerdown: (event: PointerEvent) => port.resize(event, node.id),
          onKeydown: (event: KeyboardEvent) => port.resize(event, node.id)}),
        paneView(node.second)
      ]);
    }
    const tabs = node.tabs.flatMap(key => current.tabs.find(item => item.key === key) || []);
    const active = tabs.find(tab => tab.key === node.activeTabKey) || tabs[0];
    if (region === 'right') return h('section', {key: node.id,
      class: ['terminal-panel-pane', 'terminal-panel-accordion', {focused: focused?.id === node.id}],
      'data-panel-pane': node.id}, [
      ...tabs.map(tab => {
        const collapsed = state.collapsedRight.has(tab.key);
        return h('section', {key: tab.key, class: ['terminal-panel-section', {collapsed}],
          'data-panel-section': tab.key}, [
          h('div', {class: 'terminal-panel-tabbar'}, [
            h('div', {class: 'terminal-panel-tabs', role: 'tablist', 'aria-label': t('tabs')},
              [tabButton(tab, node.id, tab.key === active?.key)]),
            !collapsed ? port.tools(tab) : null,
            node.id === focused?.id && tab.key === active?.key ? actions() : null
          ]),
          contentView(tab, collapsed)
        ]);
      }),
      h('div', {class: 'terminal-panel-drop', 'data-panel-drop': '', hidden: true, 'aria-hidden': true}),
      h('div', {class: 'terminal-panel-insert', 'data-panel-insert': '', hidden: true})
    ]);
    return h('section', {key: node.id, class: ['terminal-panel-pane', {focused: focused?.id === node.id}],
      'data-panel-pane': node.id, onPointerdown: () => {
        if (current.focusedPaneId !== node.id && active) model.activate(node.id, active.key);
      }}, [
      h('div', {class: 'terminal-panel-tabbar'}, [
        h('div', {class: 'terminal-panel-tabs', role: 'tablist', 'aria-label': t('tabs')}, [
          ...tabs.map(tab => tabButton(tab, node.id, tab.key === active?.key)),
          h('div', {class: 'terminal-panel-insert', 'data-panel-insert': '', hidden: true})
        ]),
        active ? port.tools(active) : null,
        node.id === focused?.id ? actions() : null
      ]),
      ...tabs.map(tab => contentView(tab, tab.key !== active?.key)),
      h('div', {class: 'terminal-panel-drop', 'data-panel-drop': '', hidden: true, 'aria-hidden': true})
    ]);
  }
  render(h('div', {class: ['terminal-panel-inner', {maximized: state.maximized}]}, [
    state.presetsOpen && region === 'bottom' ? h('section', {class: 'terminal-panel-presets', 'aria-label': t('presets')}, [
      h('div', {class: 'terminal-panel-preset-controls'}, [
        h('input', {value: state.presetDraft, maxlength: 80, placeholder: t('preset_name'), 'aria-label': t('preset_name'),
          'data-panel-preset-name': '', onInput: (event: Event) => {state.presetDraft = (event.target as HTMLInputElement).value;}}),
        h(TermaButton, {'data-panel-save-preset': '', onClick: () => model.savePreset()}, () => t('save_preset')),
        h(TermaButton, {'data-panel-reset': '', onClick: () => port.restore(state.preferences.presets.find(item => item.id === state.preferences.defaultId)?.value || {})}, () => t('reset')),
        ...state.preferences.presets.map(preset => h('div', {class: 'terminal-panel-preset-row', key: preset.id}, [
          h(TermaButton, {onClick: () => port.restore(preset.value)}, () => preset.name),
          button(state.preferences.defaultId === preset.id ? 'default_preset' : 'set_default', 'star',
            () => {state.preferences.defaultId = preset.id; model.publish();}),
          button('rename_preset', 'pencil', () => model.renamePreset(preset.id)),
          button('delete_preset', 'trash-2', () => model.deletePreset(preset.id))
        ]))
      ])
    ]) : null,
    state.notice ? h('p', {class: 'terminal-panel-notice', role: 'status'}, state.notice) : null,
    h('div', {class: 'terminal-panel-layout'}, layout ? [paneView(layout)] : [])
  ]), host);
}

export const releasePanel = (host: HTMLElement) => render(null, host);
