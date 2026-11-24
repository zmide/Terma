import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {keepTerminalKeyboardClosed} from '@/shared/browser-ui';
import {applicationState} from '@/shared/application-state';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSurfaceCache,terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import { terminalShortcutConfig } from '../../../../src/shared/terminal-shortcut-config';
import type { TerminalShortcut } from '../../../../src/shared/terminal-shortcut-config';
import type { TerminalKeysModel, TerminalKeyShortcutView } from './TerminalKeysView';
import type { TerminalViewportSession } from './terminal-viewport-service';

export interface TerminalKeysPort {
  visible: boolean;
  ctrlArmed: boolean;
  ctrlLocked: boolean;
  shortcuts(): readonly TerminalShortcut[];
  cursorMode(key: string): unknown;
  send(key: string, data: string): unknown;
  refresh(key: string): void;
  surfaceKeys(): Iterable<string>;
  refreshToolbar(key: string): void;
  fit(key: string): void;
  persistVisible(visible: boolean): void;
  keepKeyboard(event: PointerEvent): void;
  showSettings(key: string): Promise<unknown>;
  selectShortcuts(): void;
  tr(key: string, params?: Record<string, unknown>): string;
}

const arrowNames: Record<string, TerminalKeyShortcutView['arrow']> = {
  Up: 'up', Left: 'left', Down: 'down', Right: 'right'
};
const navigationKeys: Record<string, string> = {
  Esc: 'Esc', Tab: 'Tab', Home: 'Home', End: 'End', PgUp: 'PgUp', PgDn: 'PgDn',
  '↑': 'Up', '↓': 'Down', '→': 'Right', '←': 'Left'
};

export function createTerminalKeysService(port: TerminalKeysPort) {
  function model(key: string): TerminalKeysModel {
    return {
      key,
      visible: Boolean(port.visible),
      ctrlArmed: Boolean(port.ctrlArmed),
      ctrlLocked: Boolean(port.ctrlLocked),
      ctrlOnceTitle: port.tr('terminal:keys.ctrl_once_hint', { defaultValue: 'Ctrl 一次：下一个字母按 Ctrl 组合键发送' }),
      ctrlOnceLabel: port.tr('terminal:keys.ctrl_once', { defaultValue: 'Ctrl一次' }),
      ctrlLockTitle: port.tr('terminal:keys.ctrl_lock_hint', { defaultValue: 'Ctrl 锁定：连续发送 Ctrl 组合键，再点一次关闭' }),
      ctrlLockLabel: port.tr('terminal:keys.ctrl_lock', { defaultValue: 'Ctrl锁' }),
      configureLabel: port.tr('terminal:shortcuts.configure', { defaultValue: '配置快捷键' }),
      shortcuts: port.shortcuts().flatMap((shortcut, index) => shortcut.enabled ? [{
        index,
        label: terminalShortcutConfig.label(shortcut),
        title: terminalShortcutConfig.label({ ...shortcut, label: '' }),
        arrow: !shortcut.label && !shortcut.ctrl && !shortcut.alt && !shortcut.shift ? arrowNames[shortcut.key] : undefined
      }] : [])
    };
  }

  function consumeCtrl(key: string) {
    if (!port.ctrlLocked) port.ctrlArmed = false;
    port.refresh(key);
  }

  function sendCtrl(key: string, letter: string) {
    const code = String(letter).toUpperCase().charCodeAt(0) - 64;
    if (code < 1 || code > 26) return;
    port.send(key, String.fromCharCode(code));
    consumeCtrl(key);
  }

  function sendShortcut(key: string, index: unknown) {
    const shortcut = port.shortcuts()[Number(index)];
    if (!shortcut?.enabled) return;
    if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift && /^[A-Z]$/.test(shortcut.key) && (port.ctrlArmed || port.ctrlLocked)) {
      sendCtrl(key, shortcut.key);
      return;
    }
    port.send(key, terminalShortcutConfig.sequence(shortcut, port.cursorMode(key) === true));
    consumeCtrl(key);
  }

  function sequence(label: string, key: string) {
    const mapped = navigationKeys[label];
    if (!mapped) return label;
    return terminalShortcutConfig.sequence({ key: mapped, label: '', ctrl: false, alt: false, shift: false, enabled: true }, Boolean(port.cursorMode(key)));
  }

  function sendKey(key: string, label: string) {
    if ((port.ctrlArmed || port.ctrlLocked) && /^[A-Za-z]$/.test(label)) {
      sendCtrl(key, label);
      return;
    }
    port.send(key, sequence(label, key));
    consumeCtrl(key);
  }

  function transformInput(key: string, data: string) {
    if (!(port.ctrlArmed || port.ctrlLocked) || !/^[A-Za-z]$/.test(data)) return data;
    const code = data.toUpperCase().charCodeAt(0) - 64;
    consumeCtrl(key);
    return String.fromCharCode(code);
  }

  function toggle(key: string) {
    port.visible = !port.visible;
    port.persistVisible(port.visible);
    for (const tabKey of new Set([key, ...port.surfaceKeys()])) {
      port.refresh(tabKey);
      port.refreshToolbar(tabKey);
      port.fit(tabKey);
    }
  }

  function armCtrl(key: string) {
    port.ctrlArmed = !port.ctrlArmed;
    port.refresh(key);
  }

  function toggleCtrlLock(key: string) {
    port.ctrlLocked = !port.ctrlLocked;
    port.ctrlArmed = false;
    port.refresh(key);
  }

  async function showSettings(key: string) {
    await port.showSettings(key);
    port.selectShortcuts();
  }

  function createHost(key: string) {
    const host = document.createElement('div');
    host.id = 'terminalKeys';
    host.className = port.visible ? 'terminal-keys' : 'terminal-keys hidden';
    host.dataset.workspaceTabKey = key;
    host.dataset.terminalTabKey = key;
    return host;
  }

  return { createHost, model, sendShortcut, sequence, sendKey, sendCtrl, transformInput, toggle, armCtrl, toggleCtrlLock, showSettings, keepKeyboard: port.keepKeyboard };
}



export function mountTerminalKeys(port: TerminalKeysPort) {
  return terminalServices.termaTerminalKeysService ??= createTerminalKeysService(port);
}

export function installTerminalKeysService() {
  return mountTerminalKeys({
    get visible() { return applicationState.terminalKeysVisible; },
    set visible(value) { applicationState.terminalKeysVisible = value; },
    get ctrlArmed() { return applicationState.terminalCtrlArmed; },
    set ctrlArmed(value) { applicationState.terminalCtrlArmed = value; },
    get ctrlLocked() { return applicationState.terminalCtrlLocked; },
    set ctrlLocked(value) { applicationState.terminalCtrlLocked = value; },
    shortcuts: () => terminalServices.termaTerminalSettings?.current().shortcut_keys ?? terminalShortcutConfig.defaults,
    cursorMode: key => terminalSessions.get(key)?.term?.modes?.applicationCursorKeysMode,
    send: (key, data) => sendTerminalData(key, data),
    refresh: key => terminalServices.termaTerminalKeys?.refresh(key),
    surfaceKeys: () => terminalSurfaceCache.keys(),
    refreshToolbar: key => terminalServices.termaTerminalToolbar?.refresh(key),
    fit: key => {
      const session = terminalSessions.get(key);
      if (session) terminalViewport.fitSession(session);
    },
    persistVisible: visible => localStorage.setItem('terminalKeysVisible', visible ? '1' : '0'),
    keepKeyboard: event => keepTerminalKeyboardClosed(event),
    showSettings: async key => terminalServices.termaTerminalSettings?.open(key),
    selectShortcuts: () => terminalServices.termaTerminalViews?.selectTab('shortcuts'),
    tr: (key, params) => tr(key, params)
  });
}

export interface InstalledFeaturesTerminalTerminalKeysServiceServices {
  termaTerminalKeysService?: ReturnType<typeof createTerminalKeysService>;
}
