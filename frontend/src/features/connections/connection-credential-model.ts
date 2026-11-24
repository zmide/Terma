export type SshCredentialConnection = {
  id?: unknown;
  name?: unknown;
  ssh_host?: unknown;
  ssh_port?: unknown;
  ssh_user?: unknown;
  identity_file?: unknown;
  auth_type?: unknown;
  [key: string]: unknown;
};

export type SshCredentialValues = {
  ssh_user?: unknown;
  ssh_port?: unknown;
  auth_type?: unknown;
  ssh_password?: unknown;
  identity_file?: unknown;
  private_key_passphrase?: unknown;
};

export type TemporarySshTicket = {
  connection?: SshCredentialConnection;
  token?: unknown;
};

export function sshAuthenticationFailure(value: unknown) {
  const error = value as {code?: unknown; details?: {code?: unknown}; message?: unknown; error?: unknown; output?: unknown} | null;
  const code = String(error?.code || error?.details?.code || '').toUpperCase();
  if (code === 'SSH_AUTHENTICATION_FAILED') return true;
  const text = String(error?.message || error?.error || error?.output || value || '').toLowerCase();
  return /ssh 认证失败|authentication failed|all configured authentication methods failed|no more authentication methods available|permission denied \((?:publickey|password|keyboard-interactive)/.test(text);
}

export function sshCredentialRepairPayload(connection: SshCredentialConnection, values: SshCredentialValues = {}) {
  const authType = values.auth_type === 'key' ? 'key' : 'password';
  const identityFile = authType === 'key' ? String(values.identity_file || '') : '';
  const passphrase = authType === 'key' ? String(values.private_key_passphrase || '') : '';
  const changedIdentity = authType === 'key' && identityFile !== String(connection.identity_file || '');
  return {
    ...connection,
    id: Number(connection.id),
    ssh_user: String(values.ssh_user || '').trim(),
    ssh_port: Number(values.ssh_port || 22),
    auth_type: authType,
    identity_file: identityFile,
    ssh_password: authType === 'password' ? String(values.ssh_password || '') : '',
    private_key_passphrase: passphrase,
    clear_private_key_passphrase: authType !== 'key' || (changedIdentity && !passphrase),
    ssh_agent_mode: 'off'
  };
}

export function createTemporarySshConnection(ticket: TemporarySshTicket) {
  const connection = {
    ...(ticket.connection || {}),
    id: Number(ticket.connection?.id || 0),
    quick_connection: true,
    quick_token: String(ticket.token || ''),
    terminal_font_family_inherit: 1,
    terminal_font_size_inherit: 1,
    terminal_mobile_font_size_inherit: 1,
    terminal_line_height: 1,
    terminal_font_weight: 'normal'
  };
  if (!Number.isSafeInteger(connection.id) || connection.id >= 0 || !connection.quick_token) {
    throw new Error('temporary SSH credential creation failed');
  }
  return connection;
}
