import {settingsServices} from '@/features/settings/installed-services';
export function createSettingsRequestLifecycle() {
  let sequence = 0;
  let pending: AbortController | undefined;

  function cancel() {
    sequence += 1;
    const request = pending;
    pending = undefined;
    request?.abort();
  }

  return {
    get sequence() { return sequence; },
    get pending() { return pending !== undefined; },
    cancel,
    begin() {
      cancel();
      const controller = new AbortController();
      pending = controller;
      const current = () => pending === controller && !controller.signal.aborted;
      return {
        signal: controller.signal,
        current,
        finish() {
          if (!current()) return false;
          pending = undefined;
          return true;
        }
      };
    }
  };
}

type SettingsRequestLifecycle = ReturnType<typeof createSettingsRequestLifecycle>;



export function installSettingsRequestLifecycles() {
  settingsServices.termaSettingsRequests = {
    directory: createSettingsRequestLifecycle(),
    updates: createSettingsRequestLifecycle()
  };
}

export interface InstalledFeaturesSettingsSettingsRequestLifecycleServices {
  termaSettingsRequests: { directory: SettingsRequestLifecycle; updates: SettingsRequestLifecycle };
}
