import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {requireConfigEncryptionUnlocked} from '@/features/settings/encryption-guard';
import {refreshIcons} from '@/shared/ui/icon-service';
import {saveGroupState} from '@/shared/expanded-groups';
import {notify} from '@/features/efficiency/notification-actions';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import { setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import {fillRemoteManagementDraft, fillSavedConnection, resetConnectionFormFields, updateConnectionAuthFields, type RemoteManagementSshDraft} from './connection-form-service';
import {fillStartup} from './connection-terminal-service';
import {openAdvancedOptions, renderExtraArgsDiagnostics, updateAdvancedStatus} from './connection-validation-view';
import {loadConnectionKeys} from './connection-key-options';
import { DEFAULT_CONNECTION_GROUP, connectionGroupDisplayName } from '@/shared/connection-group';
import { connectionIdentityWarningMessage } from './connection-identity-warning';

type SavedConnection = Parameters<typeof fillSavedConnection>[1] & {
  group_name?: string;
  jump_connection_id?: number;
  identity_file?: string;
};

const boundForms = new WeakSet<HTMLFormElement>();
const selectedGroups = new WeakMap<HTMLSelectElement, string>();
const scheduleValidation = (form: HTMLFormElement, delay?: number) => connectionsServices.termaConnectionValidationActions?.schedule(form, delay);

function mountForm() {
  const target = $('view-edit');
  if (!target || !connectionsServices.termaConnectionViews) return null;
  connectionsServices.termaConnectionViews.form(target);
  refreshIcons();
  return target.querySelector<HTMLFormElement>('#connectionForm');
}

function loadFormKeys(form: HTMLFormElement, selected?: string) {
  const select = form.querySelector<HTMLSelectElement>('#conn_key');
  if (!select) return;
  void loadConnectionKeys(selected, select).catch(error => {
    if (form.isConnected && form.checkVisibility()) {
      notify(localizedTermaUiPhrase(error instanceof Error ? error.message : String(error)), 'error');
    }
  });
}

function renderGroups(form: HTMLFormElement, group = '') {
  const select = form.querySelector<HTMLSelectElement>('#conn_group');
  if (!select) return;
  const value = group || applicationState.pendingGroup || DEFAULT_CONNECTION_GROUP;
  const names = connectionsServices.termaConnectionList?.groupNames(value, 'ssh') ?? [value];
  select.replaceChildren(...names.map(name => new Option(connectionGroupDisplayName(name), name)),
    new Option(tr('connections:groups.new_option'), '__new_group__'));
  select.value = value;
  selectedGroups.set(select, value);
}

function updateSelectedGroup(form: HTMLFormElement, select: HTMLSelectElement) {
  if (select.value !== '__new_group__') {
    selectedGroups.set(select, select.value);
    return;
  }
  select.value = selectedGroups.get(select) || DEFAULT_CONNECTION_GROUP;
  connectionsServices.termaConnectionViews?.openGroupModal((name: string) => {
    if (!form.isConnected || !form.contains(select)) return;
    applicationState.pendingGroup = name;
    applicationState.groupOpen.add(name);
    saveGroupState();
    renderGroups(form, name);
  });
}

function refreshGroupSelection(oldName: string, newName: string) {
  const select = $('conn_group');
  if (!(select instanceof HTMLSelectElement) || !select.isConnected || !select.form) return;
  renderGroups(select.form, select.value === oldName ? newName : select.value);
}

function renderJumpHosts(form: HTMLFormElement, selected?: number, current = 0) {
  const select = form.querySelector<HTMLSelectElement>('#conn_jump');
  if (!select) return;
  const candidates = applicationState.connections.filter(connection => Number(connection.id) !== Number(current) && !connection.jump_connection_id);
  select.replaceChildren(new Option(tr('connections:auto.direct'), ''), ...candidates.map(connection =>
    new Option(`${connection.name} · ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`, String(connection.id))));
  select.value = selected ? String(selected) : '';
}

function resetForm(form: HTMLFormElement, group = '') {
  resetConnectionFormFields(form);
  renderGroups(form, group);
  renderJumpHosts(form);
}

function bindForm(form: HTMLFormElement) {
  if (boundForms.has(form)) return;
  boundForms.add(form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const trigger = event.submitter;
    const action = trigger?.dataset.saveAction;
    void connectionsServices.termaConnectionSave?.save(form, {trigger, connectAfterSave: action === 'open', closeAfterSave: action === 'close' || action === 'open'});
  });
  form.addEventListener('invalid', event => {
    if (event.target instanceof Element && event.target.closest('#connAdvancedOptions')) openAdvancedOptions(form);
  }, true);
  form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0);
  const stale = () => {
    form._terminalCredentialRevision = Number(form._terminalCredentialRevision || 0) + 1;
    connectionsServices.termaConnectionTerminal?.markDetectionStale(form);
  };
  form.addEventListener('input', ({target}) => {
    if (!(target instanceof Element) || !target.matches('#conn_host,#conn_port,#conn_user,#conn_password,#conn_key_passphrase,#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count')) return;
    stale();
    if (target.matches('#conn_extra,#conn_connect_timeout,#conn_keepalive_interval,#conn_keepalive_count')) scheduleValidation(form);
  });
  form.addEventListener('change', ({target}) => {
    if (target instanceof HTMLSelectElement && target.id === 'conn_group') updateSelectedGroup(form, target);
    if (!(target instanceof Element) || !target.matches('#conn_host,#conn_port,#conn_user,#conn_auth_type,#conn_key,#conn_agent_mode,#conn_jump,#conn_extra,#conn_tcp_keepalive')) return;
    stale();
    if (target.matches('#conn_extra,#conn_tcp_keepalive')) scheduleValidation(form, 0);
  });
}

export function openNewConnectionForm(groupName = '') {
  if (!requireConfigEncryptionUnlocked(tr('connections:list.new_connection_context'))) return false;
  applicationState.selectedId = null;
  connectionsServices.termaConnectionViews?.syncSelectedConnectionRow(null);
  const form = mountForm();
  if (!form) return false;
  const group = groupName || applicationState.pendingGroup;
  setWorkspace(tr('connections:list.add_ssh'), group
    ? tr('connections:list.group_subtitle', {name: connectionGroupDisplayName(group)})
    : tr('connections:list.new_connection'), 'edit');
  resetForm(form, group);
  loadFormKeys(form);
  bindForm(form);
  return true;
}

export function openSavedConnectionForm(id?: number, updateTab = true) {
  if (!requireConfigEncryptionUnlocked(tr('connections:form.edit_context'))) return;
  const connection = connectionsServices.termaConnectionController?.select(id, {render: updateTab, reveal: updateTab}) as SavedConnection | undefined;
  if (!connection) return;
  const form = mountForm();
  if (!form) return;
  fillSavedConnection(form, connection, connectionIdentityWarningMessage(connection));
  renderGroups(form, connection.group_name);
  renderJumpHosts(form, connection.jump_connection_id, connection.id);
  fillStartup(form, connection);
  updateConnectionAuthFields(form);
  loadFormKeys(form, connection.identity_file);
  bindForm(form);
  scheduleValidation(form, 0);
  setWorkspace(tr('connections:form.edit_title', {name: connection.name}),
    `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`, 'edit', `edit-${connection.id}`, updateTab, true, {kind: 'edit', id: connection.id});
}

export function seedRemoteConnectionForm(draft: RemoteManagementSshDraft) {
  if (!openNewConnectionForm(draft.group)) return false;
  const form = $('connectionForm');
  return form instanceof HTMLFormElement && fillRemoteManagementDraft(form, draft);
}

const advanced = {render: renderExtraArgsDiagnostics, update: updateAdvancedStatus};



export function installConnectionFormWorkspace() {
  connectionsServices.termaConnectionFormWorkspace = {create: openNewConnectionForm, edit: openSavedConnectionForm, reset: resetForm, refreshGroupSelection, updateAuth: updateConnectionAuthFields, advanced};
}

export interface InstalledFeaturesConnectionsConnectionFormWorkspaceServices {
  termaConnectionFormWorkspace: {create: typeof openNewConnectionForm; edit: typeof openSavedConnectionForm; reset: typeof resetForm; refreshGroupSelection: typeof refreshGroupSelection; updateAuth: typeof updateConnectionAuthFields; advanced: typeof advanced};
}
