import {settingsServices} from '@/features/settings/installed-services';
import {applicationState} from '@/shared/application-state';
import {translate as tr} from '@/shared/i18n/runtime';
import {notify} from '@/features/efficiency/notification-actions';
export function configEncryptionLocked() {
  return Boolean(
    applicationState.securitySettings?.encryption_enabled
    && (applicationState.securitySettings?.encryption_ready === false || applicationState.securitySettings?.encryption_transition_pending)
  );
}

export function requireConfigEncryptionUnlocked(action="") {
  if (!configEncryptionLocked()) return true;
  const actionLabel = action || tr("common:dialogs.modify_encrypted_config", {defaultValue:"修改加密配置"});
  notify(
    applicationState.securitySettings?.encryption_transition_pending
      ? tr("common:notifications.encryption_transition_locked_action", {action:actionLabel, defaultValue:`配置加密切换尚未完成，输入主密码继续修复后才能${actionLabel}`})
      : tr("common:notifications.encryption_locked_action", {action:actionLabel, defaultValue:`配置加密已锁定，解锁后才能${actionLabel}`}),
    "error"
  );
  void settingsServices.termaSettingsNavigation?.open("settings-basic");
  return false;
}

