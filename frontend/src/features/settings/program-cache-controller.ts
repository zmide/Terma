import {sharedServices} from '@/shared/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import { confirmModal } from '@/shared/workspace-prompts';
import { errorMessage } from '../operations/operations-types';
import { createSettingsRequestLifecycle } from './settings-request-lifecycle';
import { programCachePath, type ProgramCacheUsage } from './settings-service';

export function installProgramCacheController(paint: () => void, clearSftpDirectoryCache: () => void) {
  const reads = createSettingsRequestLifecycle();
  let usage: ProgramCacheUsage = {};
  let confirming = false;
  let clearing: string | null = null;

  async function load({quiet = false} = {}) {
    if (clearing !== null) return;
    const read = reads.begin();
    try {
      const result = await sharedServices.termaWorkspaceRequest<ProgramCacheUsage>(programCachePath(), {signal: read.signal});
      if (!read.current()) return;
      usage = result || {};
      paint();
    } catch (error) {
      if (!quiet && read.current()) notify(errorMessage(error, '') || tr('settings:auto.cache_usage_failed'), 'error');
    } finally { read.finish(); }
  }

  async function clear(category = '', label = tr('settings:auto.cache_all')) {
    if (confirming || clearing !== null) return;
    confirming = true;
    try {
      const agreed = await confirmModal(tr('settings:auto.cache_clear_confirm', {label}),
        tr('settings:auto.cache_cleanup'), tr('settings:auto.cache_clear'), tr('common:actions.cancel'), true);
      if (!agreed) return;
      reads.cancel();
      clearing = category;
      paint();
      const result = await sharedServices.termaWorkspaceRequest<ProgramCacheUsage>(programCachePath(category), {method: 'DELETE'});
      usage = result || {};
      if (!category || category.startsWith('sftp_')) {
        clearSftpDirectoryCache();
        filesServices.termaSftpDragWorkspace.drag.state.cache.clear();
      }
      notify(tr('common:notifications.cache_cleared', {name: label}), 'success');
    } catch (error) {
      notify(errorMessage(error, '') || tr('settings:auto.cache_failed'), 'error');
    } finally {
      confirming = false;
      if (clearing !== null) {
        clearing = null;
        paint();
      }
    }
  }

  settingsServices.termaProgramCache = {snapshot: () => ({usage, clearing}), load, clear};
}



export interface InstalledFeaturesSettingsProgramCacheControllerServices {
  termaProgramCache: {
      snapshot(): {usage: ProgramCacheUsage; clearing: string | null};
      load(options?: {quiet?: boolean}): Promise<void>;
      clear(category?: string, label?: string): Promise<void>;
    };
}
