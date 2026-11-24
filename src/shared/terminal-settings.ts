import { terminalShortcutConfig, type TerminalShortcut } from './terminal-shortcut-config';

export interface TerminalSettingsValues {
  font_family: string;
  font_size: number;
  scrollback_lines: number;
  background_mode: string;
  background_color: string;
  middle_mouse_action: string;
  right_mouse_action: string;
  ctrl_left_click_moves_cursor: boolean;
  url_links_enabled: boolean;
  url_prefixes: string[];
  url_ctrl_click: boolean;
  word_separators: string;
  shift_double_click_uses_separators: boolean;
  auto_copy_selection: boolean;
  copy_tabs_to_spaces: boolean;
  copy_include_trailing_newline: boolean;
  copy_trim_trailing_spaces: boolean;
  select_non_whitespace_block: boolean;
  multiline_paste_mode: string;
  shortcut_keys: TerminalShortcut[];
}

export const defaultTerminalSettings: TerminalSettingsValues = Object.freeze({
  font_family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  font_size: 13,
  scrollback_lines: 30000,
  background_mode: 'theme',
  background_color: '#0f1720',
  middle_mouse_action: 'paste_clipboard',
  right_mouse_action: 'context_menu',
  ctrl_left_click_moves_cursor: true,
  url_links_enabled: true,
  url_prefixes: ['http://', 'https://', 'ftp://', 'ssh://', 'telnet://'],
  url_ctrl_click: true,
  word_separators: ' ()[]{}\',"`',
  shift_double_click_uses_separators: false,
  auto_copy_selection: false,
  copy_tabs_to_spaces: false,
  copy_include_trailing_newline: false,
  copy_trim_trailing_spaces: false,
  select_non_whitespace_block: false,
  multiline_paste_mode: 'prompt',
  shortcut_keys: [...terminalShortcutConfig.defaults]
});
Object.freeze(defaultTerminalSettings.shortcut_keys);

export const terminalMouseActionOptions = Object.freeze([
  ['none', 'terminal:settings.mouse_none'],
  ['context_menu', 'terminal:settings.mouse_context_menu'],
  ['paste_clipboard', 'terminal:settings.mouse_paste_clipboard'],
  ['open_settings', 'terminal:settings.mouse_open_settings'],
  ['send_enter', 'terminal:settings.mouse_send_enter'],
  ['paste_selection', 'terminal:settings.mouse_paste_selection']
] as const);

export const terminalMouseActions = Object.freeze(terminalMouseActionOptions.map(([value]) => value));
