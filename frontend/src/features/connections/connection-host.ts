import {connectionsServices} from '@/features/connections/installed-services';
import {logsServices} from '@/features/logs/installed-services';
import {batchServices} from '@/features/batch/installed-services';
import {forwardsServices} from '@/features/forwards/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {x11Services} from '@/features/x11/installed-services';
import {tr,translatedTermaPhrase} from '@/shared/i18n/workspace-bootstrap';
import {closeTabsByKey,setWorkspace} from '@/features/workspace/workspace-dock-runtime';
import {api} from '@/shared/api/workspace-request';
import {notify,createProgressToast} from '@/features/efficiency/notification-actions';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {captureUiState,restoreUiState} from '@/shared/ui-snapshot-service';
import {saveGroupState,saveRemoteGroupState} from '@/shared/expanded-groups';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {setButtonBusy} from '@/shared/ui-action-service';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import {refreshIcons} from '@/shared/ui/icon-service';
import {normalizeActionMenuActions} from '@/shared/action-menu';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import {quickConnectionsById} from '@/features/terminal/terminal-quick-registry';
import {openTerminal} from '@/features/terminal/terminal-page';
import { captureWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { confirmModal, inputModal } from '@/shared/workspace-prompts';
import { connectionGroupDisplayName, DEFAULT_CONNECTION_GROUP } from '@/shared/connection-group';
import { closeWorkspaceModal } from '../workspace/workspace-modal-host';
import type { TerminalDisplayMenuAction } from '../terminal/TerminalDisplayMenuView';
import type { ConnectionMenuPort } from './connection-menu-service';
import type { ConnectionViewPort } from './connection-port';
import { readConnectionFormPayload } from './connection-form-service';
import { connectionFormIdentityWarning, connectionIdentityUnsafeFallback, connectionIdentityWarningMessage } from './connection-identity-warning';
import { loadConnectionKeys, uploadConnectionKey } from './connection-key-options';
import { renderExtraArgsDiagnostics, updateAdvancedStatus } from './connection-validation-view';

export function connectionViewHost(): ConnectionViewPort {
  let drag: ConnectionViewPort['connectionGroupDrag'] = null;
  const startupSummaries = new WeakMap<HTMLElement, NonNullable<ReturnType<ConnectionViewPort['startupSummaryStatus']>>>();
  const startupTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
  const startupRequests = new WeakSet<HTMLElement>();
  async function loadStartupSummary(box: HTMLElement | null = $('startupSummary')) {
    if (!box?.isConnected || startupRequests.has(box)) return;
    clearTimeout(startupTimers.get(box));
    startupRequests.add(box);
    try {
      const status = await api<NonNullable<ConnectionViewPort['startupSummaryStatus'] extends (...args:never[])=>infer T?T:never>>('/api/startup-status');
      if (!box.isConnected) return;
      startupSummaries.set(box, status);
      connectionsServices.termaConnectionViews?.renderStartupSummary(box);
      if (status.state === 'starting') startupTimers.set(box, setTimeout(() => void loadStartupSummary(box), 1200));
    } catch {
      startupSummaries.delete(box);
      if (box.isConnected) {
        connectionsServices.termaConnectionViews?.release(box);
        box.replaceChildren();
      }
    } finally {
      startupRequests.delete(box);
    }
  }
  return {
    get connectionGroupDrag() { return drag; }, set connectionGroupDrag(value) { drag = value; },
    get primaryView() { return applicationState.primaryView; }, get $() { return $; },
    notify, localizedTermaUiPhrase,
    renderLogs: () => logsServices.termaLogList.renderExplorer(), renderCommandTemplates: options => batchServices.termaBatch.renderExplorer(options),
    renderRunningForwards: () => forwardsServices.termaForwardWorkspace.renderRunning(),
    captureUiState, restoreUiState,
    get connectionVirtual() { return applicationState.connectionVirtual; }, get remoteProfiles() { return applicationState.remoteProfiles; },
    get connections() { return applicationState.connections; }, get selectedConnectionIds() { return applicationState.selectedConnectionIds; },
    get groupOpen() { return applicationState.groupOpen; }, get remoteGroupOpen() { return applicationState.remoteGroupOpen; },
    get connectionSearch() { return applicationState.connectionSearch; }, set connectionSearch(value) { applicationState.connectionSearch = value; },
    get connectionBulkMode() { return applicationState.connectionBulkMode; }, set connectionBulkMode(value) { applicationState.connectionBulkMode = value; },
    get selectedId() { return applicationState.selectedId; }, set selectedId(value) { applicationState.selectedId = value; },
    get quickConnectionsById() { return quickConnectionsById; }, defaultGroup: DEFAULT_CONNECTION_GROUP,
    filteredConnections: () => connectionsServices.termaConnectionList!.filteredConnections(),
    orderedConnectionGroupNames: (view = applicationState.primaryView) => connectionsServices.termaConnectionList!.orderedConnectionGroupNames(view === 'remote' ? 'remote' : 'connections'),
    connectionGroupDisplayName, beginConnectionGroupDrag: (event, group) => connectionsServices.termaConnectionGroupDrag?.begin(event, group),
    tr, api,
    syncConnectionBulkBar: () => connectionsServices.termaConnectionViews?.syncConnectionBulkBar(),
    saveGroupState, saveRemoteGroupState,
    saveConnectionGroupOrder: names => connectionsServices.termaConnectionList!.saveGroupOrder(names),
    renderConnections: () => connectionsServices.termaConnectionViews?.renderConnections(),
    renderExplorerTools: () => connectionsServices.termaConnectionViews?.renderExplorerTools(),
    renderWelcome: () => connectionsServices.termaConnectionViews?.renderWelcome(),
    closeModal: closeWorkspaceModal, inputModal, confirmModal,
    refreshGroupSelection: (...args) => connectionsServices.termaConnectionFormWorkspace.refreshGroupSelection(...args as [string, string]),
    syncSelectedConnectionRow: id => connectionsServices.termaConnectionViews?.syncSelectedConnectionRow(id),
    captureWorkspacePane, loadAll: (...args) => sharedServices.termaWorkspaceRefresh.load(...args),
    get healthResults() { return applicationState.healthResults; }, translatedTermaPhrase,
    connectionIdentityWarningMessage, connectionFormIdentityWarning, connectionIdentityUnsafeFallback,
    connectionHasRunningForwards: connection => (connection.forwards || []).some((forward: {status: string}) => forward.status === 'running'),
    get remoteConnectionSearch() { return remoteServices.termaRemoteList.getSearch(); },
    filteredRemoteProfiles: () => remoteServices.termaRemoteList.visible(),
    get REMOTE_PROTOCOL_META() { return remoteServices.termaRemoteProfiles.presentation.metadata; },
    normalizedVncClientMode: options => remoteServices.termaRemoteClients.normalizedVncClientMode(options),
    remoteProtocolAction: protocol => remoteServices.termaRemoteProfiles.presentation.action(protocol),
    remoteProtocolLabel: protocol => remoteServices.termaRemoteProfiles.presentation.label(protocol),
    remoteProfileEndpoint: profile => remoteServices.termaRemoteProfiles.presentation.endpoint(profile),
    remoteProfileBusy: id => remoteServices.termaRemoteList.busy(Number(id)),
    showRemoteProfileMenu: (event, id) => remoteServices.termaRemoteList.show(event, id),
    openRemoteProfile: (id, options) => remoteServices.termaRemoteProfiles.open(id, options),
    requireConfigEncryptionUnlocked,
    ensureConnectionExtraArgsValid: form => connectionsServices.termaConnectionValidationActions!.ensureValid(form),
    field: (form, id) => connectionsServices.termaConnectionTerminal!.field(form, id),
    connectionPayload: readConnectionFormPayload,
    loadKeys: loadConnectionKeys, uploadOneKey: uploadConnectionKey,
    renderConnectionExtraArgsDiagnostics: renderExtraArgsDiagnostics, updateConnectionAdvancedStatus: updateAdvancedStatus,
    resetConnectionForm: form => connectionsServices.termaConnectionFormWorkspace.reset(form),
    setButtonBusy,
    markConnectionTerminalDetectionStale: form => connectionsServices.termaConnectionTerminal!.markDetectionStale(form),
    setConnectionLocalizedText: (target, key, options) => connectionsServices.termaConnectionTerminal!.setLocalizedText(target, key, options),
    renderConnectionTerminalProfiles: (form, capabilities) => connectionsServices.termaConnectionTerminal!.renderProfiles(form, capabilities),
    resetConnectionTerminalProfileSelect: (form, saved) => connectionsServices.termaConnectionTerminal!.resetProfileSelect(form, saved),
    currentConnection: id => connectionsServices.termaConnectionController!.current(id),
    createProgressToast,
    get activeTabKey() { return applicationState.activeTabKey; }, get tabs() { return applicationState.tabs; },
    closeTabsByKey, openTerminal,
    get pendingGroup() { return applicationState.pendingGroup; }, set pendingGroup(value) { applicationState.pendingGroup = value; },
    groupNames: (extra, kind) => connectionsServices.termaConnectionList!.groupNames(extra, kind),
    localizedIdentityFileLabel,
    refreshIcons, setWorkspace,
    loadStartupSummary, startupSummaryStatus: box => startupSummaries.get(box),
    syncOperationPaneState: workspaceShell.syncOperationPane,
  };
}

export function connectionMenuHost(dashboard: ConnectionMenuPort['dashboard']): ConnectionMenuPort {
  return {
    connection: id => applicationState.connections.find((item: {id: number}) => item.id === id), tr: key => tr(key),
    open: (event, actions) => terminalServices.termaTerminalActionMenu?.open(event, () => normalizeActionMenuActions(actions())),
    sftp: id => sharedServices.termaActionRegistry?.runAction('connection.sftp', {connectionId: id}),
    dashboard, health: id => connectionsServices.termaConnectionHealthActions?.check(id),
    x11: id => x11Services.termaX11TerminalMenu?.actions(id) || [],
    remoteOpen: id => remoteServices.termaRemoteDesktop.relations.actionsForSsh(id),
    remoteCreate: id => remoteServices.termaRemoteList.fromSsh(id),
    duplicate: id => connectionsServices.termaConnectionController?.duplicate(id),
    edit: id => connectionsServices.termaConnectionFormWorkspace.edit(id),
    remove: id => connectionsServices.termaConnectionController?.remove(id),
    groups: () => connectionsServices.termaConnectionList?.orderedConnectionGroupNames(applicationState.primaryView === 'remote' ? 'remote' : 'connections') ?? [],
    rename: group => connectionsServices.termaConnectionGroups?.rename(group),
    move: (group, delta) => connectionsServices.termaConnectionList?.moveGroup(group, delta),
  };
}
