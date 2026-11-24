import {settingsServices} from '@/features/settings/installed-services';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import type { UpdateRecord } from './update-status-model';

export const updateReadKey = 'termaUpdateReadVersion';
const legacyReadKey = 'tunneldeskUpdateReadVersion';
type ReadStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface NoticePort {
  update(): UpdateRecord | null;
  readingAbout(): boolean;
  storage(): ReadStorage;
  paint(visible: boolean): void;
}

export function createUpdateNotice(port: NoticePort) {
  let inMemory = '';
  try {
    const store = port.storage();
    const migrated = store.getItem(updateReadKey) || store.getItem(legacyReadKey);
    if (migrated) store.setItem(updateReadKey, inMemory = migrated);
  } catch { /* The notice remains available if session storage is blocked. */ }

  function readVersion() {
    try { return port.storage().getItem(updateReadKey) || ''; }
    catch { return inMemory; }
  }

  function key() {
    const update = port.update();
    const version = String(update?.latest_version || '').trim().replace(/^v/i, '');
    if (!version) return '';
    return update?.republished_available ? `${version}:r${Math.max(0, Number(update.release_revision || 0))}` : version;
  }

  function available() {
    const update = port.update();
    return Boolean(update?.update_available || update?.republished_available);
  }

  function visible() {
    const version = key();
    return available() && !port.update()?.update_ignored && !!version && version !== readVersion();
  }

  function paint() { port.paint(visible()); }

  function markRead() {
    const version = key();
    if (!version || !available()) return;
    inMemory = version;
    try { port.storage().setItem(updateReadKey, version); } catch { /* Keep the in-memory value. */ }
    paint();
  }

  function clearCurrentRead() {
    const current = key();
    if (!current || current !== readVersion()) return;
    inMemory = '';
    try {
      const store = port.storage();
      store.removeItem(updateReadKey);
      store.removeItem(legacyReadKey);
    } catch { /* Keep the in-memory value. */ }
  }

  function sync() {
    if (port.readingAbout() && available() && key()) markRead();
    else paint();
  }

  return { key, visible, paint, markRead, clearCurrentRead, sync };
}




export function installUpdateNotice() {
  settingsServices.termaUpdateNotice = createUpdateNotice({
    update: () => settingsServices.termaUpdateStatus.current(), readingAbout: () => applicationState.activeView === 'settings' && settingsServices.termaSettingsNavigation.section === 'settings-about',
    storage: () => sessionStorage,
    paint(visible) {
      workspaceShell.refresh();
      for (const id of ['navSettingsUpdateDot', 'mobileSettingsUpdateDot', 'settingsExplorerUpdateDot']) {
        const dot = $(id);
        if (dot && !dot.closest('[data-terma-shell-owned]')) dot.hidden = !visible;
      }
    }
  });
}



export interface InstalledFeaturesSettingsUpdateNoticeServices {
  termaUpdateNotice: ReturnType<typeof createUpdateNotice>
}
