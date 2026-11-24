import {settingsServices} from '@/features/settings/installed-services';
import {sharedServices} from '@/shared/installed-services';
import type { ApiRequestOptions } from '../../shared/api/client';

interface ManagedKeyReference {
  path: string;
  scope: string;
}

export interface ManagedKey extends ManagedKeyReference {
  name: string;
  type: string;
  key_type?: string;
  bits: number;
  fingerprint: string;
  comment: string;
  has_passphrase: boolean;
}

interface ManagedKeyEdits {
  comment: string;
  currentPassphrase: string;
  newPassphrase: string;
}

export type SshKeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa';
export interface GeneratedSshKey {
  private_path: string;
  public_path: string;
  public_key: string;
  has_passphrase: boolean;
}

type ManagedKeyRequest = <T>(path: string, options?: ApiRequestOptions & { rawBody?: boolean }) => Promise<T>;



function createManagedKeysService(request: ManagedKeyRequest) {
  const root = '/api/managed-keys';
  return {
    generate(input: { name: string; comment: string; passphrase: string; key_type: SshKeyAlgorithm; key_bits: number }) {
      return request<GeneratedSshKey>('/api/ssh/keys/generate', { method: 'POST', body: JSON.stringify(input) });
    },
    async list() {
      const result = await request<{ items?: ManagedKey[] }>(root);
      return Array.isArray(result.items) ? result.items : [];
    },
    properties: (key: ManagedKeyReference) =>
      request<ManagedKey>(`${root}/properties`, { method: 'POST', body: JSON.stringify(key) }),
    async publicKey({ path, scope }: ManagedKeyReference) {
      const query = new URLSearchParams({ scope, path });
      return (await request<{ public_key: string }>(`${root}/public?${query}`)).public_key;
    },
    save({ path, scope }: ManagedKeyReference, edits: ManagedKeyEdits) {
      return request(`${root}/properties`, {
        method: 'PUT',
        body: JSON.stringify({
          path, scope, comment: edits.comment,
          current_passphrase: edits.currentPassphrase,
          new_passphrase: edits.newPassphrase,
          change_passphrase: Boolean(edits.currentPassphrase || edits.newPassphrase)
        })
      });
    },
    importFile(scope: string, file: File) {
      const form = new FormData();
      form.append('key', file, file.name);
      return request(`${root}/import?scope=${encodeURIComponent(scope)}`, { method: 'POST', body: form, rawBody: true });
    },
    deploy(connectionId: number, publicPath: string) {
      return request(`/api/connections/${connectionId}/ssh-key/deploy`, {
        method: 'POST', body: JSON.stringify({ public_path: publicPath })
      });
    },
    remove: (key: ManagedKeyReference) => request(root, { method: 'DELETE', body: JSON.stringify(key) })
  };
}

export function installManagedKeysService() {
  settingsServices.termaManagedKeys = createManagedKeysService(sharedServices.termaWorkspaceRequest);
}

export interface InstalledFeaturesSettingsManagedKeysServiceServices {
  termaManagedKeys?: ReturnType<typeof createManagedKeysService>;
}
