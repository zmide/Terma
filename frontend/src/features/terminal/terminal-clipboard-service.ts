import type { TerminalPasteOptions, TerminalSettingsValues } from './terminal-settings-port';

interface TerminalClipboardTarget {
  isCurrent(): boolean;
  send(data: string): boolean;
  focus(): void;
}

export interface TerminalClipboardPort {
  settings(): Pick<TerminalSettingsValues, 'copy_tabs_to_spaces' | 'copy_trim_trailing_spaces'
    | 'copy_include_trailing_newline' | 'multiline_paste_mode'>;
  capture(key: string): TerminalClipboardTarget;
  selection(key: string): string | null;
  copy(text: string): Promise<boolean>;
  readText(): Promise<string>;
  imageAvailable(): boolean;
  pasteImage?(key: string): Promise<unknown>;
  prompt(options: TerminalPasteOptions): Promise<string | null> | undefined;
  notify(message: string, type: 'info' | 'error'): void;
  tr: TerminalPasteOptions['tr'];
}

export function createTerminalClipboardService(port: TerminalClipboardPort) {
  function format(text: unknown, settings = port.settings()) {
    let result = String(text || '').replace(/\r\n?/g, '\n');
    if (settings.copy_tabs_to_spaces) result = result.replace(/\t/g, '    ');
    if (settings.copy_trim_trailing_spaces) result = result.split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n');
    if (settings.copy_include_trailing_newline) {
      if (result && !result.endsWith('\n')) result += '\n';
    } else result = result.replace(/\n+$/g, '');
    return result;
  }

  function singleLine(text: unknown) {
    return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join(' ');
  }

  function input(text: unknown) {
    return String(text || '').replace(/\r\n|\r|\n/g, '\r');
  }

  function prompt(value: string) {
    const pending = port.prompt({ value, tr: port.tr, singleLine });
    if (pending) return pending;
    port.notify(port.tr('terminal:settings.save_failed'), 'error');
    return Promise.resolve(null);
  }

  async function sendTo(target: TerminalClipboardTarget, text: unknown) {
    const value = String(text || '');
    if (!value) return false;
    const normalized = value.replace(/\r\n?/g, '\n');
    const mode = port.settings().multiline_paste_mode;
    if (!normalized.includes('\n') || mode === 'paste') return target.send(input(value));
    if (mode === 'single_line') return target.send(singleLine(value));
    const edited = await prompt(normalized);
    if (!target.isCurrent()) return false;
    if (!edited) {
      if (edited !== null) port.notify(port.tr('terminal:settings.paste_empty'), 'info');
      target.focus();
      return false;
    }
    return target.send(input(edited));
  }

  async function copy(key: string) {
    const text = port.selection(key);
    if (text === null) return port.notify(port.tr('terminal:notifications.session_missing'), 'error');
    if (!text) return port.notify(port.tr('terminal:notifications.select_text_first'), 'info');
    await port.copy(format(text));
  }

  async function paste(key: string) {
    const target = port.capture(key);
    let text: string | null;
    try {
      text = await port.readText();
    } catch {
      if (!target.isCurrent()) return false;
      if (port.imageAvailable() && port.pasteImage) return port.pasteImage(key);
      port.notify(port.tr('terminal:notifications.clipboard_read_fallback'), 'info');
      text = await prompt('');
      if (!target.isCurrent()) return false;
      if (text === null) {
        target.focus();
        return false;
      }
    }
    if (!target.isCurrent()) return false;
    if (!text && port.pasteImage) return port.pasteImage(key);
    if (!text) return port.notify(port.tr('terminal:notifications.clipboard_no_text'), 'info');
    return sendTo(target, text);
  }

  return { format, singleLine, input, prompt, copy, paste,
    send: (key: string, text: unknown) => sendTo(port.capture(key), text) };
}



export interface InstalledFeaturesTerminalTerminalClipboardServiceServices {
  termaTerminalClipboard?: ReturnType<typeof createTerminalClipboardService>;
}
