import type { ITheme } from '@xterm/xterm';
import type { TerminalSettingsValues } from './terminal-settings-port';
import { defaultTerminalSettings, terminalMouseActions, terminalMouseActionOptions } from '../../../../src/shared/terminal-settings';
import { terminalShortcutConfig } from '../../../../src/shared/terminal-shortcut-config';

export interface TerminalSettingsModelPort {
  tr(key: string): string;
  dark(): boolean;
}

function luminance(hexColor: string) {
  const color = String(hexColor || '#000000').replace('#', '');
  const channels = [0, 2, 4].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string) {
  const firstLuminance = luminance(first), secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function mix(first: string, second: string, amount: number) {
  const channels = (color: string) => [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  const start = channels(first), end = channels(second);
  return `#${start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function readable(candidate: string, background: string, fallback: string, minimumRatio = 4.5) {
  if (contrast(candidate, background) >= minimumRatio) return candidate;
  for (let step = 1; step <= 64; step += 1) {
    const adjusted = mix(candidate, fallback, step / 64);
    if (contrast(adjusted, background) >= minimumRatio) return adjusted;
  }
  return fallback;
}

export function createTerminalSettingsModel(port: TerminalSettingsModelPort) {
  const defaults = defaultTerminalSettings;
  const mouseActions = new Set<unknown>(terminalMouseActions);
  const backgroundModes = new Set<unknown>(['theme', 'black', 'white', 'custom']);
  const pasteModes = new Set<unknown>(['prompt', 'paste', 'single_line']);

  function fontSize(size: number) {
    if (!Number.isInteger(size) || size < 10 || size > 32) throw new Error(port.tr('terminal:settings.invalid_font_size'));
    return size;
  }

  function previewFontSize(value: unknown) {
    try {
      return fontSize(Number(value));
    } catch {
      return defaults.font_size;
    }
  }

  function normalize(value: unknown = {}): TerminalSettingsValues {
    const source: Partial<Record<keyof TerminalSettingsValues, unknown>> = value && typeof value === 'object' ? value : {};
    const backgroundColor = String(source.background_color || defaults.background_color).trim();
    const fontFamily = String(source.font_family || defaults.font_family).trim();
    const size = Number(source.font_size ?? defaults.font_size);
    const scrollbackLines = Number(source.scrollback_lines ?? defaults.scrollback_lines);
    if (!fontFamily || fontFamily.length > 300 || /[\0\r\n]/.test(fontFamily)) throw new Error(port.tr('terminal:settings.invalid_font'));
    fontSize(size);
    if (!Number.isInteger(scrollbackLines) || scrollbackLines < 1000 || scrollbackLines > 100000) throw new Error(port.tr('terminal:settings.invalid_scrollback'));
    const prefixes = (Array.isArray(source.url_prefixes) ? source.url_prefixes : String(source.url_prefixes || '').split(/[|,\s]+/))
      .map(item => String(item || '').trim()).filter(Boolean).slice(0, 10);
    return {
      font_family: fontFamily,
      font_size: size,
      scrollback_lines: scrollbackLines,
      background_mode: backgroundModes.has(source.background_mode) ? String(source.background_mode) : defaults.background_mode,
      background_color: /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor.toLowerCase() : defaults.background_color,
      middle_mouse_action: mouseActions.has(source.middle_mouse_action) ? String(source.middle_mouse_action) : defaults.middle_mouse_action,
      right_mouse_action: mouseActions.has(source.right_mouse_action) ? String(source.right_mouse_action) : defaults.right_mouse_action,
      ctrl_left_click_moves_cursor: source.ctrl_left_click_moves_cursor !== false,
      url_links_enabled: source.url_links_enabled === undefined ? defaults.url_links_enabled : source.url_links_enabled === true,
      url_prefixes: prefixes.length ? prefixes : [...defaults.url_prefixes],
      url_ctrl_click: source.url_ctrl_click !== false,
      word_separators: String(source.word_separators || defaults.word_separators).slice(0, 128),
      shift_double_click_uses_separators: source.shift_double_click_uses_separators === true,
      auto_copy_selection: source.auto_copy_selection === undefined ? defaults.auto_copy_selection : source.auto_copy_selection === true,
      copy_tabs_to_spaces: source.copy_tabs_to_spaces === true,
      copy_include_trailing_newline: source.copy_include_trailing_newline === undefined ? defaults.copy_include_trailing_newline : source.copy_include_trailing_newline === true,
      copy_trim_trailing_spaces: source.copy_trim_trailing_spaces === true,
      select_non_whitespace_block: source.select_non_whitespace_block === true,
      multiline_paste_mode: pasteModes.has(source.multiline_paste_mode) ? String(source.multiline_paste_mode) : defaults.multiline_paste_mode,
      shortcut_keys: terminalShortcutConfig.normalize(source.shortcut_keys ?? defaults.shortcut_keys)
    };
  }

  function background(settings: unknown) {
    const values = normalize(settings);
    if (values.background_mode === 'black') return '#000000';
    if (values.background_mode === 'white') return '#ffffff';
    if (values.background_mode === 'custom') return values.background_color;
    return port.dark() ? '#000000' : '#ffffff';
  }

  function theme(settings: unknown): ITheme & Record<string, string> & { background: string } {
    const resolved = background(settings), backgroundLuminance = luminance(resolved);
    const dark = 1.05 / (backgroundLuminance + 0.05) >= (backgroundLuminance + 0.05) / 0.05;
    const foreground = dark ? '#ffffff' : '#000000';
    const palette = dark ? {
      black: '#2e3436', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#2dd4bf', white: '#e5e7eb',
      brightBlack: '#6b7280', brightRed: '#f87171', brightGreen: '#86efac', brightYellow: '#fde047',
      brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff'
    } : {
      black: '#1f2937', red: '#b91c1c', green: '#15803d', yellow: '#854d0e',
      blue: '#1d4ed8', magenta: '#7e22ce', cyan: '#0f766e', white: '#d1d5db',
      brightBlack: '#4b5563', brightRed: '#dc2626', brightGreen: '#16a34a', brightYellow: '#a16207',
      brightBlue: '#2563eb', brightMagenta: '#9333ea', brightCyan: '#0891b2', brightWhite: '#f8fafc'
    };
    const readablePalette = Object.fromEntries(Object.entries(palette).map(([name, color]) => [
      name, readable(color, resolved, foreground)
    ]));
    return {
      background: resolved,
      foreground,
      cursor: foreground,
      cursorAccent: resolved,
      selectionBackground: dark ? '#2563eb99' : '#2563eb55',
      selectionForeground: foreground,
      selectionInactiveBackground: dark ? '#2563eb66' : '#2563eb33',
      scrollbarSliderBackground: dark ? '#475569' : '#cbd5e1',
      scrollbarSliderHoverBackground: dark ? '#64748b' : '#94a3b8',
      scrollbarSliderActiveBackground: dark ? '#94a3b8' : '#64748b',
      overviewRulerBorder: resolved,
      ...readablePalette
    };
  }

  function wordSeparator(settings: Pick<TerminalSettingsValues, 'select_non_whitespace_block' | 'word_separators'>) {
    return settings.select_non_whitespace_block ? ' \t\r\n' : settings.word_separators;
  }

  function mouseOptions(): [string, string][] {
    return terminalMouseActionOptions.map(([value, key]) => [value, port.tr(key)]);
  }

  return { defaults, mouseOptions, normalize, previewFontSize, background, luminance, contrast, mix, readable, theme, wordSeparator };
}




export interface InstalledFeaturesTerminalTerminalSettingsModelServices {
  termaTerminalSettingsModel?: ReturnType<typeof createTerminalSettingsModel>;
}
