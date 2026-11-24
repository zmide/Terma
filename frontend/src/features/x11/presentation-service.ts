import {sharedServices} from '@/shared/installed-services';
import {rememberTermaRawUiPhrase} from '@/shared/i18n/workspace-bootstrap';
import {backendPublicErrorParams} from '../../shared/api/public-errors';
import type {X11Application, X11Diagnostics, X11Discovery, X11Port} from './x11-types';

export interface X11PresentationPort extends Pick<X11Port, 'tr'> {
  language(): string;
  preserve(message: string): string;
}

const categoryKeys: Record<string, string> = {
  terminal: 'category_terminal', tool: 'category_tool', file: 'category_file',
  browser: 'category_browser', desktop: 'category_desktop'
};
const applicationKeys: Record<string, string> = {
  dolphin: 'application_dolphin', nautilus: 'application_nautilus', thunar: 'application_thunar',
  plasma: 'application_plasma', gnome: 'application_gnome', xfce: 'application_xfce'
};
const reasonKeys: Record<string, string> = {
  desktop_xserver_authorization_required_running: 'reason_authorization_required_running',
  desktop_xserver_authorization_required: 'reason_authorization_required',
  desktop_xserver_standalone_unavailable: 'standalone_backend_unavailable',
  xserver_ready: 'reason_xserver_ready',
  xserver_display_unavailable: 'reason_xserver_display_unavailable',
  xserver_installed_stopped: 'reason_xserver_installed_stopped',
  xserver_runtime_missing: 'reason_xserver_runtime_missing',
  xquartz_ready: 'reason_xquartz_ready',
  xquartz_display_unavailable: 'reason_xquartz_display_unavailable',
  xquartz_installed_stopped: 'reason_xquartz_installed_stopped',
  xquartz_not_installed: 'reason_xquartz_not_installed',
  linux_x11_ready: 'reason_linux_x11_ready',
  linux_x11_ready_xephyr_missing: 'reason_linux_x11_ready_xephyr_missing',
  linux_xauth_missing: 'reason_linux_xauth_missing',
  linux_display_missing: 'reason_linux_display_missing',
  xserver_unavailable: 'reason_xserver_unavailable'
};
const modeKeys: Record<string, string> = {
  bundled: 'common:x11.mode_bundled', system: 'common:x11.mode_system',
  native: 'common:x11.mode_native', missing: 'common:auto.not_installed'
};

export function createX11PresentationService(port: X11PresentationPort) {
  const t = (key: string) => port.tr(`common:x11.${key}`);

  function categoryLabel(item: Partial<X11Application> = {}): string {
    const key = categoryKeys[String(item.category || '')];
    return typeof key === 'string' ? t(key) : item.category_label || t('category_application');
  }

  function applicationLabel(item: Partial<X11Application> = {}): string {
    const key = applicationKeys[String(item.id || '')];
    return typeof key === 'string' ? t(key) : item.label || item.command || item.id || '';
  }

  function discoveryWarning(discovery: X11Discovery = {}): string {
    if (discovery.xauth_available) return '';
    return t(discovery.platform === 'macos' ? 'warning_xquartz_missing' : 'warning_xauth_missing');
  }

  function reason(diagnostics: X11Diagnostics = {}, fallback = ''): string {
    const code = String(diagnostics?.reason_code || '').trim().toLowerCase();
    const raw = String(diagnostics?.reason || '').trim();
    if (raw && diagnostics?.reason_preserve_message === true) return port.preserve(raw);
    const key = reasonKeys[code];
    if (typeof key === 'string') {
      return port.tr(`common:x11.${key}`, backendPublicErrorParams(diagnostics?.reason_params));
    }
    if (raw && (port.language() !== 'en-US' || !/[\u3400-\u9fff]/.test(raw))) return raw;
    return fallback || t('reason_xserver_unavailable');
  }

  function modeLabel(value: string): string {
    const key = modeKeys[value];
    return typeof key === 'string' ? port.tr(key) : value || port.tr('common:auto.unknown');
  }

  return {categoryLabel, applicationLabel, discoveryWarning, reason, modeLabel};
}

export const x11Presentation = createX11PresentationService({
  tr: (key, params) => sharedServices.termaI18nRuntime!.translate(key, params),
  language: () => sharedServices.termaI18nRuntime!.getLanguage(),
  preserve: message => rememberTermaRawUiPhrase(message)
});
