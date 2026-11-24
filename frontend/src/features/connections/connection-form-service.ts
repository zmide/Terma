import {connectionsServices} from '@/features/connections/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {applicationState} from '@/shared/application-state';
import { formConfig, resetStartup, setLocalizedText } from './connection-terminal-service';
import { openAdvancedOptions, resetAdvancedOptions } from './connection-validation-view';
import { DEFAULT_CONNECTION_GROUP } from '@/shared/connection-group';
import { connectionFormIdentityWarning, connectionIdentityUnsafeFallback } from './connection-identity-warning';

const field = <T extends HTMLElement = HTMLInputElement>(form: HTMLFormElement, id: string) => form.querySelector<T>(`#${id}`);

export type RemoteManagementSshDraft = {
  profileId: number;
  group: string;
  profileName: string;
  name: string;
  host: string;
  port: number;
  user: string;
};

export function fillRemoteManagementDraft(form: HTMLFormElement, draft: RemoteManagementSshDraft) {
  const fields = Object.entries({conn_name: draft.name, conn_host: draft.host, conn_port: draft.port, conn_user: draft.user})
    .map(([id, value]) => ({field: form.querySelector<HTMLInputElement>(`#${id}`), value}));
  if (!fields.every(({field}) => field) || !Number.isSafeInteger(draft.profileId) || draft.profileId < 1) return false;
  clearRemoteManagementDraft(form);
  form.dataset.remoteProfileLinkId = String(draft.profileId);
  const notice = document.createElement('div');
  notice.className = 'connection-test-status remote-management-link-notice';
  setLocalizedText(notice, 'remote:management.link_after_save', {name: draft.profileName});
  form.prepend(notice);
  for (const {field, value} of fields) {
    if (!field) continue;
    field.value = String(value);
    field.dispatchEvent(new Event('input', {bubbles: true}));
  }
  window.setTimeout(() => {
    if (form.isConnected && form.checkVisibility()) form.querySelector<HTMLInputElement>('#conn_user')?.focus({preventScroll: true});
  }, 0);
  return true;
}

export function clearRemoteManagementDraft(form: HTMLFormElement) {
  delete form.dataset.remoteProfileLinkId;
  form.querySelector('.remote-management-link-notice')?.remove();
}

export type ConnectionFormPayloadValues = {
  id?: unknown;
  name?: unknown;
  groupName?: unknown;
  defaultGroup?: string;
  sshUser?: unknown;
  sshHost?: unknown;
  sshPort?: unknown;
  sortOrder?: unknown;
  authType?: unknown;
  identityFile?: unknown;
  sshPassword?: unknown;
  privateKeyPassphrase?: unknown;
  clearPrivateKeyPassphrase?: unknown;
  sshAgentMode?: unknown;
  jumpConnectionId?: unknown;
  connectTimeoutSeconds?: unknown;
  keepaliveIntervalSeconds?: unknown;
  keepaliveCountMax?: unknown;
  tcpKeepalive?: unknown;
  x11Mode?: unknown;
  tags?: unknown;
  autostartForwards?: unknown;
  extraArgs?: unknown;
  startup?: Record<string, unknown>;
};

function numberOr(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function buildConnectionPayload(values: ConnectionFormPayloadValues) {
  const passwordAuth = values.authType === 'password';
  const groupName = String(values.groupName || '').trim() || String(values.defaultGroup || '默认');
  return {
    id: String(values.id || ''),
    name: String(values.name || '').trim(),
    group_name: groupName,
    ssh_user: String(values.sshUser || '').trim(),
    ssh_host: String(values.sshHost || '').trim(),
    ssh_port: numberOr(values.sshPort, 22),
    sort_order: numberOr(values.sortOrder, 1),
    auth_type: passwordAuth ? 'password' : 'key',
    identity_file: passwordAuth ? '' : String(values.identityFile || ''),
    ssh_password: passwordAuth ? String(values.sshPassword || '') : '',
    private_key_passphrase: passwordAuth ? '' : String(values.privateKeyPassphrase || ''),
    clear_private_key_passphrase: Boolean(values.clearPrivateKeyPassphrase),
    ssh_agent_mode: passwordAuth ? 'off' : String(values.sshAgentMode || 'auto'),
    jump_connection_id: numberOr(values.jumpConnectionId, 0) || null,
    connect_timeout_seconds: numberOr(values.connectTimeoutSeconds, 10),
    keepalive_interval_seconds: numberOr(values.keepaliveIntervalSeconds, 60),
    keepalive_count_max: numberOr(values.keepaliveCountMax, 3),
    tcp_keepalive: numberOr(values.tcpKeepalive, 1),
    x11_mode: String(values.x11Mode || 'off'),
    tags: String(values.tags || '').trim(),
    autostart_forwards: numberOr(values.autostartForwards, 0),
    extra_args: String(values.extraArgs || '').trim(),
    ...(values.startup || {})
  };
}

export function readConnectionFormPayload(form: HTMLFormElement, validateStartup = false) {
  const value = (id: string) => field(form, id)?.value;
  const group = value('conn_group');
  const authType = value('conn_auth_type');
  const selectedKey = field<HTMLSelectElement>(form, 'conn_key')?.selectedOptions[0];
  if (authType !== 'password' && selectedKey?.dataset.legacyUnsafe === '1') {
    throw new Error(connectionFormIdentityWarning(form) || connectionIdentityUnsafeFallback());
  }
  const startup = formConfig(form);
  if (validateStartup && startup.terminal_startup_mode === 'program' && !startup.terminal_program_path) {
    openAdvancedOptions(form);
    const program = field(form, 'conn_terminal_program_path');
    program?.focus({preventScroll:true});
    program?.scrollIntoView({block:'center', behavior:'smooth'});
    throw new Error(tr('connections:form.program_path_required'));
  }
  return buildConnectionPayload({
    id: value('conn_id'), name: value('conn_name'), groupName: group === '__new_group__' ? applicationState.pendingGroup : group,
    defaultGroup: DEFAULT_CONNECTION_GROUP, sshUser: value('conn_user'), sshHost: value('conn_host'),
    sshPort: value('conn_port'), sortOrder: value('conn_sort_order'), authType, identityFile: value('conn_key'),
    sshPassword: value('conn_password'), privateKeyPassphrase: value('conn_key_passphrase'),
    clearPrivateKeyPassphrase: field(form, 'conn_clear_key_passphrase')?.checked, sshAgentMode: value('conn_agent_mode'),
    jumpConnectionId: value('conn_jump'), connectTimeoutSeconds: value('conn_connect_timeout'),
    keepaliveIntervalSeconds: value('conn_keepalive_interval'), keepaliveCountMax: value('conn_keepalive_count'),
    tcpKeepalive: value('conn_tcp_keepalive'), x11Mode: value('conn_x11_mode'), tags: value('conn_tags'),
    autostartForwards: value('conn_autostart'), extraArgs: value('conn_extra'), startup
  });
}

export function updateConnectionAuthFields(form: HTMLFormElement) {
  const password = field<HTMLSelectElement>(form, 'conn_auth_type')?.value === 'password';
  for (const [id, hidden] of [['keyAuthBox', password], ['passwordAuthBox', !password]] as const) {
    const section = field<HTMLElement>(form, id);
    if (!section) continue;
    section.hidden = hidden;
    section.setAttribute('aria-hidden', String(hidden));
    section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')
      .forEach(control => { control.disabled = hidden; });
  }
  const x11 = field<HTMLSelectElement>(form, 'conn_x11_mode');
  if (x11) x11.title = tr(password ? 'connections:form.x11_password_hint' : 'connections:form.x11_key_hint');
}

export function resetConnectionFormFields(form: HTMLFormElement) {
  connectionsServices.termaConnectionValidationActions?.invalidate(form);
  form.reset();
  clearRemoteManagementDraft(form);
  delete form.dataset.identityFileStatus;
  delete form.dataset.identityFileMessage;
  field<HTMLSelectElement>(form, 'conn_key')?.querySelector('option[data-legacy-unsafe]')?.remove();
  const values = {
    conn_id: '', conn_port: '22', conn_sort_order: '1', conn_auth_type: 'key', conn_password: '',
    conn_key_passphrase: '', conn_agent_mode: 'auto', conn_connect_timeout: '10', conn_keepalive_interval: '60',
    conn_keepalive_count: '3', conn_tcp_keepalive: '1', conn_x11_mode: 'off', conn_remote_generation: '',
    conn_tags: '', conn_autostart: '0', conn_extra: ''
  };
  for (const [id, value] of Object.entries(values)) {
    const control = field(form, id);
    if (control) control.value = value;
  }
  const clearPassphrase = field(form, 'conn_clear_key_passphrase');
  if (clearPassphrase) clearPassphrase.checked = false;
  const passphraseLine = field<HTMLElement>(form, 'connClearPassphraseLine');
  if (passphraseLine) passphraseLine.hidden = true;
  const generationLine = field<HTMLElement>(form, 'connRemoteGenerationLine');
  if (generationLine) generationLine.hidden = false;
  const testStatus = field<HTMLElement>(form, 'connTestStatus');
  if (testStatus) {
    testStatus.hidden = true;
    testStatus.className = 'connection-test-status';
    testStatus.textContent = '';
  }
  resetStartup(form);
  resetAdvancedOptions(form);
  updateConnectionAuthFields(form);
}

type SavedConnectionFormRecord = {
  id: number;
  name: string;
  ssh_user: string;
  ssh_host: string;
  ssh_port: number;
  identity_file_status?: string;
  sort_order?: number;
  auth_type?: string;
  ssh_agent_mode?: string;
  has_private_key_passphrase?: boolean;
  connect_timeout_seconds?: number;
  keepalive_interval_seconds?: number | string | null;
  keepalive_count_max?: number;
  tcp_keepalive?: number | string | null;
  x11_mode?: string;
  tags?: string;
  autostart_forwards?: number;
  extra_args?: string;
};

export function fillSavedConnection(form: HTMLFormElement, connection: SavedConnectionFormRecord, identityWarning: string) {
  const values = {
    conn_id: connection.id,
    conn_name: connection.name,
    conn_user: connection.ssh_user,
    conn_host: connection.ssh_host,
    conn_port: connection.ssh_port,
    conn_sort_order: connection.sort_order || 1,
    conn_auth_type: connection.auth_type || 'key',
    conn_password: '',
    conn_key_passphrase: '',
    conn_agent_mode: connection.ssh_agent_mode || 'auto',
    conn_connect_timeout: connection.connect_timeout_seconds || 10,
    conn_keepalive_interval: Number.isInteger(Number(connection.keepalive_interval_seconds)) ? Number(connection.keepalive_interval_seconds) : 60,
    conn_keepalive_count: connection.keepalive_count_max || 3,
    conn_tcp_keepalive: Number(connection.tcp_keepalive ?? 1) ? 1 : 0,
    conn_x11_mode: connection.x11_mode || 'off',
    conn_tags: connection.tags || '',
    conn_autostart: connection.autostart_forwards || 0,
    conn_extra: connection.extra_args || '',
  };
  form.dataset.identityFileStatus = String(connection.identity_file_status || 'none');
  form.dataset.identityFileMessage = identityWarning;
  for (const [id, value] of Object.entries(values)) {
    const field = form.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
    field.value = String(value);
  }
  const generationLine = form.querySelector<HTMLElement>('#connRemoteGenerationLine');
  if (generationLine) generationLine.hidden = true;
  form.querySelector<HTMLElement>('#connClearPassphraseLine')!.hidden = !connection.has_private_key_passphrase;
  form.querySelector<HTMLInputElement>('#conn_clear_key_passphrase')!.checked = false;
}

