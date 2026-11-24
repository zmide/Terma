import type { TerminalShortcut } from '../../../../src/shared/terminal-shortcut-config';
import type { TerminalSettingsValues } from '../../../../src/shared/terminal-settings';

export type { TerminalShortcut, TerminalSettingsValues };

export interface TerminalSettingsPort {
  settings: TerminalSettingsValues;
  defaults: TerminalSettingsValues;
  fonts: [string, string][];
  mouseActions(): [string, string][];
  shortcutKeys: readonly string[];
  normalizeShortcuts(value: unknown): TerminalShortcut[];
  shortcutLabel(value: Partial<TerminalShortcut>): string;
  tr(key: string, params?: Record<string, unknown>): string;
  preview(values: Pick<TerminalSettingsValues, 'background_mode' | 'background_color'>): Record<string, string>;
  previewFontSize(value: unknown): number;
  save(values: TerminalSettingsValues): Promise<void>;
  saveError(error: unknown): void;
  close(): void;
}

export interface TerminalPasteOptions {
  value: string;
  tr: TerminalSettingsPort['tr'];
  singleLine(value: string): string;
}
