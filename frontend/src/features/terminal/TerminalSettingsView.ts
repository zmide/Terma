import { h, type VNode, type VNodeChild } from 'vue';
import { TermaButton } from '@/shared/ui/TermaButton';
import { settingsIcon as icon } from '@/features/settings/settings-icon';
import type { TerminalSettingsPort, TerminalShortcut } from './terminal-settings-port';

export const textFields = {
  terminalSettingFontFamily: 'font_family', terminalSettingFontSize: 'font_size', terminalSettingScrollback: 'scrollback_lines',
  terminalSettingBackgroundColor: 'background_color', terminalSettingMiddleMouse: 'middle_mouse_action', terminalSettingRightMouse: 'right_mouse_action',
  terminalSettingUrlPrefixes: 'url_prefixes', terminalSettingWordSeparators: 'word_separators', terminalSettingMultilinePaste: 'multiline_paste_mode'
} as const;
export const checkFields = {
  terminalSettingCtrlClick: 'ctrl_left_click_moves_cursor', terminalSettingUrlLinks: 'url_links_enabled', terminalSettingUrlCtrlClick: 'url_ctrl_click',
  terminalSettingShiftDoubleClick: 'shift_double_click_uses_separators', terminalSettingNonWhitespaceBlock: 'select_non_whitespace_block',
  terminalSettingAutoCopy: 'auto_copy_selection', terminalSettingTabsToSpaces: 'copy_tabs_to_spaces', terminalSettingTrailingNewline: 'copy_include_trailing_newline',
  terminalSettingTrimSpaces: 'copy_trim_trailing_spaces'
} as const;
export const settingsTabs = [
  ['appearance', 'Appearance', 'palette', 'terminal:settings.appearance'],
  ['interaction', 'Interaction', 'mouse-pointer-2', 'terminal:settings.mouse_and_links'],
  ['clipboard', 'Clipboard', 'copy', 'terminal:settings.selection_and_paste'],
  ['shortcuts', 'Shortcuts', 'keyboard', 'terminal:shortcuts.title']
] as const;

export interface TerminalSettingsState {
  port: TerminalSettingsPort;
  fields: Record<string, string | boolean>;
  backgroundMode: string;
  rows: { id: number; value: TerminalShortcut }[];
  tab: string;
  error: boolean;
  busy: boolean;
  change(id: string, value: string | boolean): void;
  selectTab(name: string, focus?: boolean): void;
  selectBackground(value: string): void;
  reset(): void;
  resetShortcuts(): void;
  resetSeparators(): void;
  editShortcut(index: number, action: string): void;
  addShortcut(): void;
  save(): void;
  close(): void;
}

export function terminalSettingsView(state: TerminalSettingsState): VNode {
  const { port, fields } = state;
  const t = port.tr;
  const text = (id: string) => String(fields[id] ?? '');
  const checked = (id: string) => fields[id] === true;
  const input = (id: string, attrs: Record<string, unknown> = {}) => h('input', {
    id, value: text(id), ...attrs, onInput: (event: Event) => state.change(id, (event.target as HTMLInputElement).value)
  });
  const check = (id: string, label: string, attrs: Record<string, unknown> = {}) => h('label', { class: 'check-row', for: id }, [
    h('input', { id, type: 'checkbox', checked: checked(id), ...attrs, onChange: (event: Event) => state.change(id, (event.target as HTMLInputElement).checked) }), ` ${t(label)}`
  ]);
  const button = (label: string, action: () => void, attrs: Record<string, unknown> = {}, glyph = '') => h(TermaButton, {
    type: 'button', disabled: state.busy, ...attrs, onClick: action
  }, () => [glyph ? icon(glyph) : null, attrs.class === 'icon-button' ? null : h('span', null, label)]);
  const label = (id: string, key: string) => h('label', { for: id }, t(key));
  const hint = (key: string) => h('div', { class: 'muted' }, t(key));
  const section = (name: string, title: string, children: VNodeChild[], className = '') => h('div', { class: ['terminal-settings-section', className] }, [h('h3', null, [icon(name), t(title)]), ...children]);
  const select = (id: string, items: [string, string][], attrs: Record<string, unknown> = {}) => h('select', {
    id, value: text(id), ...attrs, onChange: (event: Event) => state.change(id, (event.target as HTMLSelectElement).value)
  }, items.map(([value, title]) => h('option', { value, key: value }, title)));
  const panel = (name: string, suffix: string, children: VNodeChild[]) => h('section', {
    id: `terminalSettingsPanel${suffix}`, class: 'terminal-settings-panel', role: 'tabpanel',
    'aria-labelledby': `terminalSettingsTab${suffix}`, hidden: state.tab !== name
  }, children);
  const preview = port.preview({ background_mode: state.backgroundMode, background_color: text('terminalSettingBackgroundColor') });
  const previewSpan = (className: string, content: string, color: string) => h('span', { class: className, style: { color } }, content);
  const closeText = t('common:actions.close');
  const shortcutLabel = t('terminal:shortcuts.label');
  const shortcutKeys: [string, string][] = [...port.shortcutKeys.map(key => [key, port.shortcutLabel({ key })] as [string, string]), ['custom', t('terminal:shortcuts.character')]];
  const shortcutAction = (index: number, action: string, glyph: string, name: string, disabled: boolean) => button(name, () => state.editShortcut(index, action), {
    class: 'icon-button', title: name, 'aria-label': name, 'data-shortcut-action': action, 'data-shortcut-row': index, disabled: state.busy || disabled
  }, glyph);
  return h('div', { class: 'modal-card terminal-settings-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'terminalSettingsTitle', 'aria-busy': String(state.busy) }, [
    h('div', { class: 'terminal-settings-head' }, [h('div', null, [h('h2', { id: 'terminalSettingsTitle' }, t('terminal:settings.title')), h('span', null, t('terminal:settings.scope'))]),
      button('', state.close, { class: 'icon-button', title: closeText, 'aria-label': closeText }, 'x')]),
    h('div', { class: 'terminal-settings-tabs', role: 'tablist', 'aria-label': t('terminal:settings.categories'), onKeydown: (event: KeyboardEvent) => {
      const index = settingsTabs.findIndex(item => item[0] === state.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : event.key === 'ArrowLeft' ? (index + 3) % 4 : event.key === 'ArrowRight' ? (index + 1) % 4 : -1;
      if (next < 0) return;
      event.preventDefault(); state.selectTab(settingsTabs[next]![0], true);
    } }, settingsTabs.map(([name, suffix, glyph, title]) => button(t(title), () => state.selectTab(name), {
      id: `terminalSettingsTab${suffix}`, class: { active: state.tab === name }, role: 'tab', tabindex: state.tab === name ? 0 : -1,
      'aria-selected': String(state.tab === name), 'aria-controls': `terminalSettingsPanel${suffix}`
    }, glyph))),
    h('fieldset', { class: 'terminal-settings-panels', disabled: state.busy }, [
      panel('appearance', 'Appearance', [h('div', { class: 'terminal-settings-background-layout' }, [
        section('type', 'terminal:settings.default_font', [
          h('div', { class: 'terminal-settings-field-grid' }, [
            h('div', null, [label('terminalSettingFontFamily', 'terminal:settings.font_family'), input('terminalSettingFontFamily', { list: 'terminalSettingFontOptions' }),
              h('datalist', { id: 'terminalSettingFontOptions' }, port.fonts.map(([value, title], index) => h('option', { value }, index === 0 ? t('terminal:display.system_font') : title)))]),
            h('div', null, [label('terminalSettingFontSize', 'terminal:settings.default_font_size'), input('terminalSettingFontSize', { type: 'number', min: 10, max: 32, step: 1 })]),
            h('div', null, [label('terminalSettingScrollback', 'terminal:settings.scrollback_lines'), input('terminalSettingScrollback', { type: 'number', min: 1000, max: 100000, step: 1000 }), hint('terminal:settings.scrollback_hint')])
          ]), hint('terminal:settings.font_hint')
        ], 'terminal-settings-font-section'),
        section('monitor-cog', 'terminal:settings.background', [h('div', { class: 'terminal-background-choices', role: 'radiogroup', 'aria-label': t('terminal:settings.background_color') },
          ['theme', 'black', 'white', 'custom'].map(mode => h('label', { class: ['terminal-background-choice', { active: mode === state.backgroundMode, 'terminal-background-custom': mode === 'custom' }] }, [
            h('input', { class: 'sr-only', type: 'radio', name: 'terminalSettingBackgroundMode', value: mode, checked: mode === state.backgroundMode, onChange: () => state.selectBackground(mode) }),
            mode === 'custom' ? input('terminalSettingBackgroundColor', { class: 'terminal-color-picker', type: 'color', title: t('terminal:settings.choose_custom_background'), 'aria-label': t('terminal:settings.choose_custom_background') }) : h('span', { class: `terminal-background-swatch terminal-background-${mode}` }),
            h('span', null, t(`terminal:settings.${mode === 'theme' ? 'follow_theme' : mode}`)),
            mode === 'custom' ? h('output', { id: 'terminalSettingBackgroundColorValue' }, text('terminalSettingBackgroundColor').toLowerCase()) : null
          ]))
        )], 'terminal-settings-background-section'),
        h('div', { id: 'terminalBackgroundPreview', class: 'terminal-background-preview', 'aria-label': t('terminal:settings.color_preview'), style: {
          background: preview.background, color: preview.foreground, fontFamily: text('terminalSettingFontFamily') || port.defaults.font_family,
          fontSize: `${port.previewFontSize(text('terminalSettingFontSize'))}px`
        } }, [
          h('div', null, [previewSpan('terminal-preview-green', 'root@server', preview.green!), ':', previewSpan('terminal-preview-blue', '~', preview.blue!), '$ ls']),
          h('div', null, [previewSpan('terminal-preview-blue', 'docs', preview.blue!), '\u00a0\u00a0', previewSpan('terminal-preview-cyan', 'config.yml', preview.cyan!), '\u00a0\u00a0', previewSpan('terminal-preview-red', 'error.log', preview.red!)]),
          h('div', null, ['$ ', h('span', { class: 'terminal-preview-cursor', style: { background: preview.cursor } }, '\u00a0')])
        ])
      ])]),
      panel('interaction', 'Interaction', [h('div', { class: 'terminal-settings-grid' }, [
        section('mouse-pointer-2', 'terminal:settings.mouse', [h('div', { class: 'terminal-settings-field-grid' }, [
          h('div', null, [label('terminalSettingMiddleMouse', 'terminal:settings.middle_mouse'), select('terminalSettingMiddleMouse', port.mouseActions())]),
          h('div', null, [label('terminalSettingRightMouse', 'terminal:settings.right_mouse'), select('terminalSettingRightMouse', port.mouseActions())])
        ]), check('terminalSettingCtrlClick', 'terminal:settings.ctrl_click_cursor')]),
        section('link', 'terminal:settings.links', [check('terminalSettingUrlLinks', 'terminal:settings.detect_urls'), label('terminalSettingUrlPrefixes', 'terminal:settings.url_prefixes'),
          input('terminalSettingUrlPrefixes', { disabled: !checked('terminalSettingUrlLinks') }), check('terminalSettingUrlCtrlClick', 'terminal:settings.ctrl_click_link', { disabled: !checked('terminalSettingUrlLinks') })])
      ])]),
      panel('clipboard', 'Clipboard', [h('div', { class: 'terminal-settings-grid terminal-settings-clipboard-grid' }, [
        section('text-select', 'terminal:settings.selection', [label('terminalSettingWordSeparators', 'terminal:settings.double_click_separators'),
          h('div', { class: 'terminal-settings-inline' }, [input('terminalSettingWordSeparators'), button(t('terminal:settings.reset'), state.resetSeparators)]),
          check('terminalSettingShiftDoubleClick', 'terminal:settings.shift_double_click'), check('terminalSettingNonWhitespaceBlock', 'terminal:settings.non_whitespace_block')]),
        section('copy', 'terminal:settings.copy', [h('div', { class: 'terminal-settings-check-grid' }, [
          check('terminalSettingAutoCopy', 'terminal:settings.auto_copy'), check('terminalSettingTabsToSpaces', 'terminal:settings.tabs_to_spaces'),
          check('terminalSettingTrailingNewline', 'terminal:settings.trailing_newline'), check('terminalSettingTrimSpaces', 'terminal:settings.trim_spaces')
        ])]),
        section('clipboard-paste', 'terminal:settings.paste', [label('terminalSettingMultilinePaste', 'terminal:settings.multiline_behavior'), select('terminalSettingMultilinePaste', [
          ['prompt', t('terminal:settings.multiline_prompt')], ['paste', t('terminal:settings.multiline_direct')], ['single_line', t('terminal:settings.multiline_single')]
        ])], 'terminal-settings-paste-section')
      ])]),
      panel('shortcuts', 'Shortcuts', [h('div', { class: 'terminal-settings-section terminal-shortcut-settings' }, [
        h('div', { class: 'terminal-shortcut-heading' }, [h('h3', null, [icon('keyboard'), `${t('terminal:shortcuts.title')} `, h('small', { id: 'terminalShortcutCount' }, `${state.rows.length} / 48`)]),
          button(t('terminal:settings.restore_defaults'), state.resetShortcuts, {}, 'rotate-ccw')]),
        h('div', { id: 'terminalShortcutRows', class: 'terminal-shortcut-rows' }, state.rows.length ? state.rows.map(({ id, value }, index) => {
          const name = port.shortcutLabel({ ...value, label: '' });
          return h('div', { class: 'terminal-shortcut-row', key: id }, [
            h('input', { type: 'checkbox', checked: value.enabled, 'aria-label': t('terminal:shortcuts.enabled', { key: name }), 'data-shortcut-enabled': index,
              onChange: (event: Event) => { value.enabled = (event.target as HTMLInputElement).checked; } }),
            h('code', { 'data-i18n-skip': '' }, name),
            h('input', { class: 'terminal-shortcut-row-label', value: value.label, maxlength: 24, 'aria-label': shortcutLabel, placeholder: name, 'data-shortcut-label': index,
              onInput: (event: Event) => { value.label = (event.target as HTMLInputElement).value; } }),
            h('div', { class: 'terminal-shortcut-row-actions' }, [
              shortcutAction(index, 'up', 'arrow-up', t('terminal:shortcuts.move_up'), index === 0),
              shortcutAction(index, 'down', 'arrow-down', t('terminal:shortcuts.move_down'), index === state.rows.length - 1),
              shortcutAction(index, 'remove', 'trash-2', t('common:actions.delete'), false)
            ])
          ]);
        }) : [hint('terminal:shortcuts.empty')]),
        h('div', { class: 'terminal-shortcut-add' }, [
          h('div', null, [label('terminalShortcutKey', 'terminal:shortcuts.key'), select('terminalShortcutKey', shortcutKeys)]),
          h('div', { id: 'terminalShortcutCharacterField', hidden: text('terminalShortcutKey') !== 'custom' }, [label('terminalShortcutCharacter', 'terminal:shortcuts.character'), input('terminalShortcutCharacter', { maxlength: 1, autocomplete: 'off', spellcheck: false })]),
          h('div', null, [label('terminalShortcutLabel', 'terminal:shortcuts.label'), input('terminalShortcutLabel', { maxlength: 24, autocomplete: 'off' })]),
          h('div', { class: 'terminal-shortcut-modifiers', 'data-i18n-skip': '' }, ['Ctrl', 'Alt', 'Shift'].map(name => h('label', { class: 'check-row' }, [
            h('input', { id: `terminalShortcut${name}`, type: 'checkbox', checked: checked(`terminalShortcut${name}`), onChange: (event: Event) => state.change(`terminalShortcut${name}`, (event.target as HTMLInputElement).checked) }), ` ${name}`
          ]))),
          button(t('terminal:shortcuts.add'), state.addShortcut, { id: 'terminalShortcutAdd', disabled: state.busy || state.rows.length >= 48 }, 'plus')
        ]),
        h('div', { id: 'terminalShortcutError', class: 'terminal-shortcut-error', role: 'alert', hidden: !state.error }, state.error ? t('errors:backend.terminal_shortcuts_invalid') : '')
      ])])
    ]),
    h('div', { class: 'actions terminal-settings-actions' }, [
      button(t('terminal:settings.restore_defaults'), state.reset), button(t('common:actions.cancel'), state.close),
      button(t(state.busy ? 'common:auto.saving' : 'terminal:settings.save'), state.save, { id: 'terminalSettingsSave', class: 'primary', 'aria-busy': String(state.busy) }, state.busy ? '' : 'save')
    ])
  ]);
}
