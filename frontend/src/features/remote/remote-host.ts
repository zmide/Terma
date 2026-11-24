import {remoteServices} from '@/features/remote/installed-services';
import {filesServices} from '@/features/files/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {sshCredentialRuntime} from '@/features/connections/ssh-credential-runtime';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {showActionMenu} from '@/shared/action-menu';
import {refreshIcons} from '@/shared/ui/icon-service';
import {saveRemoteGroupState} from '@/shared/expanded-groups';
import {localizedIdentityFileLabel} from '@/features/connections/identity-labels';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {$} from '@/shared/workspace-dom';
import {currentConnection} from '@/features/connections/connection-selection';
import {applicationState} from '@/shared/application-state';
import {openTerminal} from '@/features/terminal/terminal-page';
import {repairSshCredentials} from '@/features/connections/ssh-credential-runtime';
import {quickConnectionRequestHeaders} from '@/features/terminal/terminal-quick-registry';
import { closeTabsByKey, setWorkspaceTabConnectionStatus, setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import { workspaceAllTabs, workspaceDockState, workspaceFindPane, workspaceFindPaneForTab, workspaceTabByKey } from '@/features/workspace/workspace-dock-state';
import { workspaceElementForTab, runInWorkspacePane } from '@/features/workspace/workspace-pane-scope';
import { workspaceShell } from '@/features/workspace/workspace-shell-controller';
import { formatFileBytes as formatBytes } from '@/shared/format-file-bytes';
import { runtimePreferences } from '@/features/settings/runtime-settings-model';
import { DEFAULT_CONNECTION_GROUP } from '@/shared/connection-group';
import type {DesktopPort} from './desktop-service';
import type {RemoteProfileRelationsPort} from './profile-relations';
import type {ManagementConnection} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {createRemoteProtocolView} from './remote-protocol-view';
import type {createRemoteWorkspaceScope} from './remote-workspace-scope';
import type {WorkspaceTab} from '../workspace/workspace-tab-runtime';
import type {DesktopWorkspaceHost} from './remote-desktop-workspace';
import type {ListProfile, RemoteListPort} from './profile-list-service';
import type {RemoteProfileMenuPort} from './profile-menu-actions';
import type {RemoteProfileEditorHost} from './profile-editor-runtime';
import type {FtpPort} from './ftp-service';
import type {RemoteTerminalPort} from './terminal-service';
import {runtimeConfiguredBackgroundIntervalMs} from '../settings/runtime-settings-model';
import {remoteQuickOpen} from '../settings/quick-open-preference';
import { profileHostGroups } from './profile-host-groups';

type WorkspaceScopePort = Parameters<typeof createRemoteWorkspaceScope>[0];
type ManagementHost = Omit<DesktopPort,'probe'|'authorize'|'resetLog'|'paint'|'paintTask'|'label'|'options'|'begin'|'end'|'jobs'|'seedSsh'> & {
  diagnostics: {icons(): void};
  protocol: Pick<Parameters<typeof createRemoteProtocolView>[0], 'element' | 'tabLifetime'>;
  desktopView(): HTMLElement | null;
  desktopVisible(): boolean;
  formatConnectionIssues(issues: unknown[]): string;
  repairCredentials(id: number, options: {context: string; onSaved(): Promise<void>}): Promise<unknown>;
  setting(key: string): unknown;
  backgroundInterval(key: string, fallback: number): number;
  replaceStoredProfile(id: number, profile: RemoteProfile): void;
};

// Resolve the existing workspace and connection stores at invocation time. Pane
// activation can temporarily switch the classic bindings to a different pane.










const tab = (key: string) => applicationState.tabs.find(item => item.key === key);
const connection = (id: number) => currentConnection(id);
export const remoteProfileById = (id: number) => applicationState.remoteProfiles.find(item => Number(item.id) === Number(id));
export const openRemoteActionMenu: RemoteProfileRelationsPort['showMenu'] = (event, actions) => showActionMenu(event, actions);
function selectProfile(profile: RemoteProfile | null, reveal: boolean) {
  applicationState.selectedRemoteProfileId = profile?.id ?? null;
  if (reveal) profileHostGroups.reveal(profile);
}

export const remoteWorkspaceScopeHost: WorkspaceScopePort = {
  paneForTab: key => workspaceFindPaneForTab(key), pane: id => workspaceFindPane(id), tab,
  activeKey: () => applicationState.activeTabKey, focusedPane: () => workspaceDockState.focusedPaneId,
  selectTab: key => {applicationState.activeTabKey = key;}, closeTab: key => {if (tab(key)) closeTabsByKey([key], key);},
  markStatus: (key, status) => setWorkspaceTabConnectionStatus(key, status),
  selectedProfile: () => applicationState.selectedRemoteProfileId,
  elementForTab: (key, selector) => workspaceElementForTab(key, selector),
  element: id => document.getElementById(id), inPane: (id, render) => runInWorkspacePane(id, render)
};

export const remoteProfileRelationsHost: Omit<RemoteProfileRelationsPort, 'managementConnectionId'> = {
  profiles: () => applicationState.remoteProfiles, connection, tr: (...args) => tr(...args),
  protocolLabel: protocol => remoteServices.termaRemoteProfiles.presentation.label(protocol),
  protocolIcon: protocol => remoteServices.termaRemoteProfiles.presentation.icon(protocol),
  showMenu: openRemoteActionMenu, notify: (message, kind) => notify(message, kind),
  open: profile => remoteServices.termaRemoteProfiles.open(profile), terminal: id => openTerminal(id), sftp: id => filesServices.termaSftpPage.open(id)
};

export const remoteDesktopWorkspaceHost: Omit<DesktopWorkspaceHost, 'jumpActions' | 'sharedVnc'> = {
  profile: remoteProfileById,
  select: selectProfile,
  endpoint: profile => remoteServices.termaRemoteProfiles.presentation.endpoint(profile),
  metadata: protocol => remoteServices.termaRemoteProfiles.presentation.metadata[protocol],
  show: (profile, key, update, connectionStatus) => setWorkspace(profile.name || '',
    remoteServices.termaRemoteProfiles.presentation.endpoint(profile), 'remote-desktop', key, update, true,
    {kind: 'remote-desktop', id: profile.id, protocol: profile.protocol, connectionStatus}),
  view: () => $('view-remote-desktop'), quickOpen: () => remoteQuickOpen.enabled.value,
  newWindowOnQuickOpen: () => runtimePreferences.snapshot?.saved?.vnc_quick_open_new_window !== false,
  edit: id => remoteServices.termaRemoteProfiles.editor.edit(id, true),
  markDisconnected: key => setWorkspaceTabConnectionStatus(key, 'disconnected'), refreshIcons: () => refreshIcons()
};

export const remoteManagementHost: ManagementHost = {
  api: (url, options) => api(url, options), tr: (...args) => tr(...args), notify: (message, kind) => notify(message, kind),
  unlocked: context => requireConfigEncryptionUnlocked(context), connections: () => applicationState.connections, connection, profile: remoteProfileById,
  setting: key => (runtimePreferences.snapshot?.saved as Record<string, unknown> | undefined)?.[key], backgroundInterval: (key, fallback) => runtimeConfiguredBackgroundIntervalMs(key, fallback),
  replaceStoredProfile(id, profile) {
    const index = applicationState.remoteProfiles.findIndex(item => Number(item.id) === id);
    // Profile updates return the complete stored record from the same endpoint as list loading.
    if (index >= 0) applicationState.remoteProfiles[index] = profile as ListProfile;
  },
  quickHeaders: id => typeof quickConnectionRequestHeaders === 'function' ? quickConnectionRequestHeaders(id) : {},
  identityLabel: item => localizedIdentityFileLabel(item, {permission: true, repair: true}),
  promptAdmin: options => remoteServices.termaRemoteViews?.promptAdmin(options) ?? Promise.resolve(null),
  localize: message => typeof localizedTermaUiPhrase === 'function' ? localizedTermaUiPhrase(message) : message,
  now: () => Date.now(),
  scope() {
    const key = applicationState.activeTabKey, source = tab(key);
    return () => applicationState.activeTabKey === key && (!source || applicationState.tabs.includes(source));
  },
  protocol: {element: id => $(id), tabLifetime: key => {
    const source = tab(key);
    return () => !source || applicationState.tabs.includes(source);
  }},
  diagnostics: {icons: () => refreshIcons()},
  desktopVisible: () => tab(applicationState.activeTabKey)?.kind === 'linux-desktop', desktopView: () => $('view-linux-desktop'),
  formatConnectionIssues: issues => connectionsServices.termaConnectionValidationService?.formatError(issues) ?? '',
  repairCredentials: (id, options) => repairSshCredentials(id, options),
  show: (id, update) => setWorkspace(tr('remote:linux_desktop.title'), tr('remote:linux_desktop.workspace_subtitle'),
    'linux-desktop', `linux-desktop-${id || 'select'}`, update, true, {kind: 'linux-desktop', id}),
  selectTab(id) {
    const source = tab(applicationState.activeTabKey);
    if (source?.kind === 'linux-desktop') {source.id = id; workspaceServices.termaWorkspacePersistence?.save();}
  },
  schedule: (callback, delay) => setTimeout(callback, delay), unschedule: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
};

const {api: remoteApi, tr: remoteTranslate, notify: remoteNotify, unlocked, localize} = remoteManagementHost;
const profileApi = {api: remoteApi, tr: remoteTranslate, notify: remoteNotify, unlocked, profile: remoteProfileById,
  reload: () => sharedServices.termaWorkspaceRefresh.load()};

export const remoteListHost: RemoteListPort & RemoteProfileMenuPort = {
  ...profileApi, profiles: () => applicationState.remoteProfiles, connection,
  paint: () => {if (applicationState.primaryView === 'remote' || applicationState.primaryView === 'connections') connectionsServices.termaConnectionViews?.renderConnections();},
  scope() {
    const view = applicationState.primaryView, key = applicationState.activeTabKey;
    return () => applicationState.primaryView === view && applicationState.activeTabKey === key;
  },
  reveal: id => {const profile = remoteProfileById(id); if (profile) selectProfile(profile, true);},
  showRemote: () => workspaceShell.showPrimary('remote'),
  deleted(id) {
    if (applicationState.selectedRemoteProfileId === id) applicationState.selectedRemoteProfileId = null;
    profileHostGroups.clearSelection(id);
    const keys = workspaceAllTabs().filter(item => ['remote-edit','remote-desktop','remote-terminal','ftp'].includes(item.kind || '')
      && Number(item.id) === id).map(item => item.key);
    if (keys[0]) closeTabsByKey(keys, keys[0]);
  },
  groups: () => [...new Set(applicationState.remoteProfiles.map(profile => profile.group_name || DEFAULT_CONNECTION_GROUP))]
    .map(name => ({name, open: applicationState.remoteGroupOpen.has(name)})),
  setGroup(name, open) {if (open) applicationState.remoteGroupOpen.add(name); else applicationState.remoteGroupOpen.delete(name);},
  saveGroups: () => saveRemoteGroupState(),
  open: profile => remoteServices.termaRemoteProfiles.open(profile), edit: remoteDesktopWorkspaceHost.edit,
  test: id => remoteServices.termaRemoteProfiles.test(id),
  create: (protocol, group) => remoteServices.termaRemoteProfiles.editor.create(protocol, group), menu: openRemoteActionMenu
};

export const remoteProfileEditorHost: RemoteProfileEditorHost & {closeModal(): void; sshRepairActive(): boolean} = {
  ...profileApi, localize,
  defaultGroup: DEFAULT_CONNECTION_GROUP,
  pendingGroup: () => applicationState.pendingGroup,
  endpoint: remoteDesktopWorkspaceHost.endpoint, protocolLabel: remoteProfileRelationsHost.protocolLabel,
  select: selectProfile,
  workspace: (item, update) => setWorkspace(item.title, item.subtitle, 'edit', item.key, update, true,
    {kind: 'remote-edit', id: item.id, protocol: item.protocol}),
  activeTab: () => tab(applicationState.activeTabKey), owns: owner => applicationState.tabs.some(item => item === owner), close: key => closeTabsByKey([key], key),
  groupDialog: apply => connectionsServices.termaConnectionViews?.openGroupModal(apply),
  rememberGroup: name => {applicationState.remoteGroupOpen.add(name); saveRemoteGroupState();},
  async closeVnc(id) {
    const key = `remote-desktop-${id}`;
    remoteServices.termaVncRuntime.close(key);
    setWorkspaceTabConnectionStatus(key, 'disconnected');
    await remoteServices.termaVncRuntime.windows.close(id).catch(() => {});
  },
  paintList: () => connectionsServices.termaConnectionViews?.renderConnections(), open: (profile, options) => remoteServices.termaRemoteProfiles.open(profile, options),
  render: (profile, binding) => connectionsServices.termaConnectionViews?.renderRemoteProfileEditor(profile, binding),
  closeModal: () => closeModal(), sshRepairActive: () => typeof sshCredentialRuntime.active() !== 'undefined' && sshCredentialRuntime.active()
};

export const remoteFtpHost = {
  profile: remoteProfileById, unlocked, tr: remoteTranslate, api: remoteApi, localize,
  workspace(profile, state, update) {
    selectProfile(profile, update);
    setWorkspace(profile.name || '', remoteDesktopWorkspaceHost.endpoint(profile), 'ftp', state.key, update, true,
      {kind: 'ftp', id: profile.id, path: state.path, protocol: 'ftp'});
    return $('view-ftp')!;
  },
  repair: (id, options) => remoteServices.termaRemoteProfiles.repair(id, options),
  persist(state) {
    const owner = workspaceTabByKey(state.key);
    if (owner) owner.path = state.path;
    workspaceServices.termaWorkspacePersistence?.save();
  },
  formatBytes: size => formatBytes(size),
  notify: (message, kind) => remoteNotify(localize(message), kind)
} satisfies Pick<FtpPort, 'profile' | 'unlocked' | 'tr' | 'api' | 'repair' | 'workspace' | 'persist' | 'notify'> & {
  formatBytes(size: number): string;
  localize(message: string): string;
};

export const remoteTerminalHost = {
  profile: remoteProfileById, unlocked, tr: remoteTranslate, localize,
  endpoint: remoteDesktopWorkspaceHost.endpoint,
  edit: (id: number) => remoteServices.termaRemoteProfiles.editor.edit(id),
  workspace(profile, key, title, update, connectionStatus) {
    selectProfile(profile, update);
    const label = remoteProfileRelationsHost.protocolLabel(profile.protocol);
    setWorkspace(title, `${label} · ${remoteDesktopWorkspaceHost.endpoint(profile)}`, 'remote-terminal', key, update, true,
      {kind: 'remote-terminal', id: profile.id, protocol: profile.protocol, connectionStatus});
    return $('view-remote-terminal')!;
  },
  canFocus: (view, key) => remoteServices.termaRemoteDesktop.scope.activeWorkspace(view, key),
  tabStatus: (key, status) => setWorkspaceTabConnectionStatus(key, status),
  tabExists: key => Boolean(tab(key))
} satisfies Pick<RemoteTerminalPort, 'profile' | 'unlocked' | 'tr' | 'workspace' | 'canFocus' | 'tabStatus' | 'tabExists'> & {
  localize(message: string): string;
  endpoint(profile: RemoteProfile): string;
  edit(id: number): void;
};
