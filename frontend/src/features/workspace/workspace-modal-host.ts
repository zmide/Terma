import {remoteServices} from '@/features/remote/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {$} from '@/shared/workspace-dom';
import { releaseOperationsModal } from '@/features/operations/operations-modal';
import { unmountSettingsDialog } from '@/features/settings/settings-dialog-mount';


export function closeWorkspaceModal() {
  const modal = $('modal');
  if (!modal || remoteServices.termaRemoteProfiles?.busy()) return;
  settingsServices.termaSettingsRequests?.directory.cancel();
  remoteServices.termaRemoteProfiles?.cancel();
  releaseOperationsModal();
  filesServices.termaSftpDialogs?.release();
  filesServices.termaSftpGlobalSettings?.release();
  if (modal.dataset.quickSshAuth === '1') quickServices.termaQuickViews?.closeQuickSshAuthModal();
  terminalServices.termaTerminalViews?.releaseDialog();
  remoteServices.termaRemoteViews?.releaseDialog();
  connectionsServices.termaConnectionViews?.release(modal);
  quickServices.termaQuickViews?.release(modal);
  if (modal.dataset.workspaceDialog) workspaceServices.termaWorkspaceViews?.unmountDialog();
  if (modal.dataset.termaSettingsDialog) unmountSettingsDialog();
  modal.hidden = true;
  modal.replaceChildren();
}


export {closeWorkspaceModal as closeModal};
