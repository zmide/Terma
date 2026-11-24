import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {applicationState} from '@/shared/application-state';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import { renderTabs } from './workspace-dock-tabs';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { activeWorkspaceSubtitle, localizedWorkspaceTabTitle, syncWorkspaceDocumentTitle } from './workspace-tab-presentation';
import type { WorkspaceTab } from './workspace-tab-runtime';
import type { Connection } from '../forwards/forward-model';
import type { Translate } from '../operations/operations-types';
import {localizeConnectionDashboard} from '../connections/connection-dashboard';


export function refreshWorkspaceLanguage() {
  connectionsServices.termaConnectionViews?.refreshWelcome();
  remoteServices.termaVncRuntime?.refreshWorkspace();
  connectionsServices.termaConnectionViews?.renderConnections();
  connectionsServices.termaConnectionViews?.renderExplorerTools();
  forwardsServices.termaForwardWorkspace?.renderRunning();
  if (document.getElementById("updateCheckArea")) settingsServices.termaUpdateStatus.repaint();
  if (typeof applicationState.tabs !== "undefined" && Array.isArray(applicationState.tabs)) {
    for (const tab of applicationState.tabs) {
      if (tab.key === "welcome" || tab.kind === "welcome") {
        tab.title = tr("common:workspace.welcome_title", {defaultValue:"开始使用"});
        tab.subtitle = tr("common:workspace.welcome_subtitle", {defaultValue:"选择左侧项目后开始操作"});
        continue;
      }
      if (tab.kind === "import") {
        tab.title = tr("navigation:auto.import_export", {defaultValue:"导入导出"});
        tab.subtitle = tr("settings:auto.import_migration", {defaultValue:"迁移 SSH config、数据库备份和连接配置快照。"});
        continue;
      }
      if (tab.kind === "settings") {
        tab.title = tr("settings:title", {defaultValue:"设置"});
        tab.subtitle = tr("settings:subtitle", {defaultValue:"访问保护、通知、运行信息与开源许可"});
        continue;
      }
      if (tab.kind === "forward-manager") {
        tab.title = tr("connections:forward_manager.title", {defaultValue:"转发列表"});
        tab.subtitle = forwardsServices.termaForwardWorkspace?.managerSubtitle() || "";
        continue;
      }
      if (tab.kind === "dashboard") {
        localizeConnectionDashboard(tab);
        continue;
      }
      if (tab.kind !== "forwards") continue;
      const connection = typeof applicationState.connections !== "undefined" ? applicationState.connections.find(item => Number(item.id) === Number(tab.id)) : null;
      if (!connection) continue;
      tab.title = tr("connections:forwards.workspace_tab", {name:connection.name, defaultValue:`${connection.name} · 转发列表`});
      tab.subtitle = tr("connections:forwards.short_count", {count:(connection.forwards || []).length, defaultValue:`${(connection.forwards || []).length} 条转发`});
    }
    if (typeof renderTabs === "function") renderTabs();
    const activeTab = typeof applicationState.activeTabKey !== "undefined" ? applicationState.tabs.find(tab => tab.key === applicationState.activeTabKey) : null;
    const workspaceSubtitle = document.getElementById("workspaceSubtitle");
    const welcomeActive = typeof applicationState.activeView !== "undefined" && applicationState.activeView === "welcome";
    const welcome = welcomeActive || activeTab?.key === "welcome" || activeTab?.kind === "welcome";
    const description = welcome ? tr("common:workspace.welcome_subtitle", {defaultValue:"选择左侧项目后开始操作"})
      : activeTab ? activeWorkspaceSubtitle(activeTab) : "";
    if (workspaceSubtitle && (welcome || activeTab)) workspaceShell.setHeading(description);
    if (activeTab) syncWorkspaceDocumentTitle(localizedWorkspaceTabTitle(activeTab), description, activeTab.viewName || activeTab.kind, activeTab.key, activeTab);
  }
  if (typeof terminalSessions !== "undefined" && terminalSessions instanceof Map) {
    for (const key of terminalSessions.keys()) {
      terminalServices.termaTerminalToolbar?.refresh(key);
    }
  }
}

