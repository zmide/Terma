import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {isMobileLayout} from '@/shared/browser-ui';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {focusTerminalSession} from '@/features/terminal/terminal-page';
import {terminalSurfaceCache,terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalViewport} from '@/features/terminal/terminal-viewport-service';
import {terminalFontOptions} from '@/features/terminal/terminal-metadata';
import { runtimePreferences } from '../settings/runtime-settings-model';
import type { WorkspaceRequestOptions } from '../../shared/api/workspace-request';
import { terminalShortcutConfig } from '../../../../src/shared/terminal-shortcut-config';
import { createTerminalSettingsModel } from './terminal-settings-model';
import { createTerminalSettingsService, type TerminalSettingsServicePort } from './terminal-settings-service';
import type { TerminalSettingsPort, TerminalSettingsValues } from './terminal-settings-port';

interface TerminalSettingsHost {
  api: TerminalSettingsServicePort['api'];
  current: TerminalSettingsServicePort['current'];
  commit(values: TerminalSettingsValues): void;
  sessions: TerminalSettingsServicePort['sessions'];
  surfaceKeys: TerminalSettingsServicePort['surfaceKeys'];
  rerenderKeys: TerminalSettingsServicePort['rerenderKeys'];
  mobile: TerminalSettingsServicePort['mobile'];
  capture: TerminalSettingsServicePort['capture'];
  fit: TerminalSettingsServicePort['fit'];
  refreshToolbar: TerminalSettingsServicePort['refreshToolbar'];
  modal: TerminalSettingsServicePort['modal'];
  fonts: TerminalSettingsPort['fonts'];
  tr: TerminalSettingsPort['tr'];
  focus(key: string): void;
  notify(message: string, kind: 'success' | 'error'): void;
}

export function mountTerminalSettings(port: TerminalSettingsHost) {
  const model = terminalServices.termaTerminalSettingsModel = createTerminalSettingsModel({
    tr: port.tr,
    dark: () => document.documentElement.dataset.theme === 'dark'
  });
  const settings = terminalServices.termaTerminalSettings = createTerminalSettingsService({
    api: (route, options) => port.api(route, options), current: port.current,
    commit(values, response) {
      port.commit(values);
      const previous = runtimePreferences.snapshot;
      if (response && previous) runtimePreferences.snapshot = { ...previous, ...response } as typeof previous;
    }, sessions: port.sessions,
    surfaceKeys: port.surfaceKeys, rerenderKeys: port.rerenderKeys, mobile: port.mobile,
    capture: port.capture, fit: port.fit, refreshToolbar: port.refreshToolbar,
    modal: port.modal, defaults: model.defaults, normalize: model.normalize,
    theme: model.theme, wordSeparator: model.wordSeparator, luminance: model.luminance,
    show(key, values) {
      if (!terminalServices.termaTerminalViews?.showSettings) return false;
      terminalServices.termaTerminalViews.showSettings(viewPort(key, values));
      return true;
    },
    openError: () => port.notify(port.tr('terminal:settings.save_failed'), 'error')
  });
  function viewPort(key: string, values: TerminalSettingsValues): TerminalSettingsPort {
    return {
      settings: values, defaults: model.defaults, fonts: port.fonts,
      mouseActions: model.mouseOptions, shortcutKeys: terminalShortcutConfig.keys,
      normalizeShortcuts: terminalShortcutConfig.normalize, shortcutLabel: terminalShortcutConfig.label,
      tr: port.tr, preview: model.theme, previewFontSize: model.previewFontSize,
      async save(values) {
        await settings.save(values);
        port.notify(port.tr('terminal:settings.saved'), 'success');
      },
      saveError(error) {
        const info = error as {code?: unknown; message?: unknown} | null;
        const message = info?.code === 'terminal_shortcuts_invalid' ? port.tr('errors:backend.terminal_shortcuts_invalid')
          : typeof info?.message === 'string' && info.message || port.tr('terminal:settings.save_failed');
        port.notify(message, 'error');
      },
      close: () => port.focus(key)
    };
  }
  return settings;
}

export function installTerminalSettingsWorkspace() {
  if (terminalServices.termaTerminalSettings) return terminalServices.termaTerminalSettings;
  return mountTerminalSettings({
    api: (path, options) => api(path, options), current: () => applicationState.terminalGlobalSettings,
    commit: values => { applicationState.terminalGlobalSettings = values; },
    sessions: () => terminalSessions.values(), surfaceKeys: () => terminalSurfaceCache.keys(),
    rerenderKeys: key => terminalServices.termaTerminalKeys?.refresh(key), mobile: () => isMobileLayout(),
    capture: session => terminalViewport.captureSession(session), fit: (session, anchor) => terminalViewport.fitSession(session, anchor),
    refreshToolbar: key => terminalServices.termaTerminalToolbar?.refresh(key), modal: () => $('modal'),
    fonts: terminalFontOptions, tr: (key, params) => tr(key, params),
    notify: (message, kind) => notify(message, kind), focus: key => focusTerminalSession(key)
  });
}
