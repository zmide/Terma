import {sharedServices} from '@/shared/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {api} from '@/shared/api/workspace-request';
import {apiErrorFromResponse,localizedBackendPublicError} from '@/shared/api/public-errors';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {notify} from '@/features/efficiency/notification-actions';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import {applicationState} from '@/shared/application-state';
import { setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import { workspaceAllTabs, workspaceDockState, workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { currentWorkspacePaneId, workspaceElementForTab, captureWorkspaceTab } from '@/features/workspace/workspace-pane-scope';
import { selectExplorerSection, workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { errorMessage } from '../operations/operations-types';
import { sectionKey, type Candidate, type ExchangePort, type ExchangeScope } from './exchange-model';
import { loadSecuritySettings } from '../settings/security-settings-actions';

const snapshotReasons = new Map([
  ['调整 SSH 连接分组顺序前自动快照', 'group_order'], ['批量修改 SSH 连接前自动快照', 'bulk_edit'],
  ['批量删除 SSH 连接前自动快照', 'bulk_delete'], ['批量导入前自动快照', 'bulk_import'],
  ['重命名 SSH 连接分组前自动快照', 'group_rename'], ['批量应用转发模板前自动快照', 'forward_template'],
  ['回滚前自动快照', 'restore'], ['恢复数据库前自动快照', 'database_restore'], ['手动快照', 'manual']
]);

function scope(key: string): ExchangeScope | null {
  const tab = workspaceTabByKey(key);
  if (tab?.kind !== 'import') return null;
  return {
    owner: tab, key: tab.key,
    valid: () => workspaceAllTabs().includes(tab),
    element: () => workspaceElementForTab(tab.key, '#view-import')
  };
}

export function exchangeWorkspace(upload: ExchangePort['upload']): ExchangePort {
  return {
    api: (...args) => api(...args), http: (url, options) => fetch(url, options),
    tr: (...args) => tr(...args), responseError: (...args) => apiErrorFromResponse(...args),
    phrase: value => localizedTermaUiPhrase(value),
    error: (value, fallback) => localizedBackendPublicError(value, errorMessage(value, fallback)),
    notify: (...args) => notify(...args), reload: () => sharedServices.termaWorkspaceRefresh.load(),
    unlocked: context => requireConfigEncryptionUnlocked(context),
    async security() {
      const {encryption_enabled, encryption_ready} = await loadSecuritySettings();
      return {encryption_enabled: Boolean(encryption_enabled), encryption_ready: Boolean(encryption_ready)};
    },
    upload, identityLabel: item => localizedIdentityFileLabel(item, { permission: true }),
    clipboard: value => navigator.clipboard.writeText(value),
    reason(value) {
      const key = snapshotReasons.get(value);
      return key ? tr('settings:auto.snapshot_reason_' + key) : localizedTermaUiPhrase(String(value || ''));
    },
    open(update) {
      const key = (update ? null : scope(applicationState.activeTabKey))?.key ?? 'import';
      setWorkspace(tr('navigation:auto.import_export'), tr('settings:auto.import_migration'), 'import', key, update, true, { kind: 'import' });
      return scope(applicationState.activeTabKey);
    },
    current: () => scope(applicationState.activeTabKey), scope,
    heading(key, value, move) {
      if (key !== applicationState.activeTabKey || currentWorkspacePaneId() !== workspaceDockState.focusedPaneId) return;
      captureWorkspaceTab(key)(() => {
        selectExplorerSection(value);
        workspaceShell.setHeading(tr(sectionKey(value)));
        if (move) {
          if (isMobileLayout()) workspaceShell.showMobileWorkspace();
          workspaceElementForTab(key, '#view-import')?.closest('.workspace')?.scrollTo({ top: 0, behavior: 'instant' });
        }
      });
    }
  };
}
