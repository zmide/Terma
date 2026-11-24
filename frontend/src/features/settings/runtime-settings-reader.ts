import {settingsServices} from '@/features/settings/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {termaI18nLanguageRevision,setTermaLanguage,tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {$} from '@/shared/workspace-dom';
import { errorMessage } from '../operations/operations-types';
import type { SharedApiBridge } from '@/shared/api/bridge';
import { runtimePreferences, normalizeRuntimeSettingsResponse, type RuntimeSettingsSnapshot as RuntimeSettings } from './runtime-settings-model';
import type { TermaLanguage } from '@/shared/i18n/runtime';
import { remoteQuickOpen } from './quick-open-preference';

interface RuntimeReaderPort {
  request: SharedApiBridge['request'];
  current(): RuntimeSettings | null;
  normalize(result: unknown): RuntimeSettings;
  publish(settings: RuntimeSettings): void;
  languageRevision(): number;
  applyLanguage(language: TermaLanguage, options: {render: boolean; emit: boolean}): Promise<unknown>;
  quickOpenRevision(): number;
  syncQuickOpen(enabled: boolean): void;
  syncFloatingTasks(): void;
  captureRefresh(): () => void;
  loadError(): string;
}

export function createRuntimeSettingsReader(port: RuntimeReaderPort) {
  let latestRead = 0;

  async function load(refreshUi = false) {
    const read = ++latestRead;
    const previousLanguage = port.current()?.saved?.language;
    const languageRevision = port.languageRevision();
    const quickOpenRevision = port.quickOpenRevision();
    const refresh = refreshUi ? port.captureRefresh() : undefined;
    let next: RuntimeSettings;
    try {
      const response = await port.request('/api/runtime-settings');
      if (read !== latestRead) return port.current() ?? port.normalize(response);
      next = port.normalize(response);
    } catch (error) {
      if (read !== latestRead) return port.current() ?? port.normalize({});
      next = port.normalize({...port.current(), error: errorMessage(error, port.loadError())});
    }
    const currentLanguage = port.current()?.saved?.language;
    const languageChanged = languageRevision !== port.languageRevision() || currentLanguage !== previousLanguage;
    if (languageChanged && currentLanguage) {
      next.language = currentLanguage;
      next.saved.language = currentLanguage;
    }
    const quickOpenChanged = quickOpenRevision !== port.quickOpenRevision();
    if (quickOpenChanged && port.current()?.saved) {
      next.saved.remote_desktop_quick_open_enabled = port.current()?.saved.remote_desktop_quick_open_enabled === true;
    }
    port.publish(next);
    if (!next.error) {
      if (!quickOpenChanged) port.syncQuickOpen(next.saved.remote_desktop_quick_open_enabled === true);
      if (!languageChanged && previousLanguage !== next.saved.language) {
        const live = Boolean(previousLanguage);
        try { await port.applyLanguage(next.saved.language, {render: live, emit: live}); }
        catch (error) {
          if (read === latestRead) port.publish(port.normalize({...port.current(), error: errorMessage(error, port.loadError())}));
        }
      }
    }
    if (read === latestRead) {
      port.syncFloatingTasks();
      refresh?.();
    }
    return port.current() ?? next;
  }
  return {load};
}

export function installRuntimeSettingsReader() {
  settingsServices.termaRuntimeReader = createRuntimeSettingsReader({
    request: (path, options) => api(path, options),
    current: () => runtimePreferences.snapshot,
    normalize: value => normalizeRuntimeSettingsResponse(value),
    publish: value => { runtimePreferences.snapshot = value; },
    languageRevision: () => termaI18nLanguageRevision,
    applyLanguage: (language, options) => setTermaLanguage(language, options),
    quickOpenRevision: remoteQuickOpen.revision,
    syncQuickOpen: remoteQuickOpen.applyLoaded,
    syncFloatingTasks: () => filesServices.termaSftpTaskWorkspace.state.float(),
    captureRefresh() {
      const target = $('view-settings');
      return () => { if (target?.isConnected && !target.hidden) settingsServices.termaRefreshVueSettings?.(target, 'runtimeSettingsPanel'); };
    },
    loadError: () => tr('settings:auto.runtime_load_failed')
  });
}



export interface InstalledFeaturesSettingsRuntimeSettingsReaderServices {
  termaRuntimeReader: ReturnType<typeof createRuntimeSettingsReader>
}
