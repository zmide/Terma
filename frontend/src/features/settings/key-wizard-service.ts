import {sharedServices} from '@/shared/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import {currentConnection} from '@/features/connections/connection-selection';
import {$} from '@/shared/workspace-dom';
import { openSettingsDialog, refreshSettingsDialog } from '@/features/settings/settings-dialog-mount';
import { confirmModal } from '@/shared/workspace-prompts';
import type { Translate } from '../operations/operations-types';
import { errorMessage } from '../operations/operations-types';
import { downloadBlob } from '../../shared/ui/browser-download';
import { filenameFromPath } from '../../shared/file-path';
import type { GeneratedSshKey, SshKeyAlgorithm } from './managed-keys-service';
import { loadManagedKeys } from './managed-key-settings';

export const sshKeySizes = { ed25519: [256], rsa: [2048, 3072, 4096], ecdsa: [256, 384, 521] } as const;
export const sshKeyAlgorithm = (value: unknown): SshKeyAlgorithm => value === 'rsa' || value === 'ecdsa' ? value : 'ed25519';

interface Target { id: number; name: string; ssh_user: string; ssh_host: string; ssh_port: number }



interface WizardPort {
  tr: Translate;
  notify(text: string, kind: 'success' | 'info' | 'error'): void;
  connection(id: number): Target | null | undefined;
  refreshKeys(): Promise<void>;
  confirm(message: string, title: string, confirm: string, cancel: string): Promise<boolean>;
}
export interface WizardView {
  wizardType: SshKeyAlgorithm;
  busy?: boolean;
  changeType(type: SshKeyAlgorithm): void;
  submit(draft: { name: string; comment: string; passphrase: string; type: SshKeyAlgorithm; bits: number }): Promise<void>;
  dismiss(): void;
}
export interface KeyResultView {
  result: GeneratedSshKey;
  copy(): Promise<void>;
  download(): void;
  deploy(id: number): Promise<void>;
  done(): void;
}

function createKeyWizard(port: WizardPort) {
  const t = port.tr;
  const report = (error: unknown) => port.notify(errorMessage(error, t('errors:backend.request_failed')), 'error');
  function showResult(result: GeneratedSshKey) {
    let deploying = false;
    const data: KeyResultView = {
      result,
      async copy() {
        try {
          await sharedServices.termaClipboard.write(result.public_key);
          port.notify(t('common:notifications.public_key_copied'), 'success');
        } catch (error) { report(error); }
      },
      download() {
        downloadBlob(new Blob([`${result.public_key.trim()}\n`], { type: 'text/plain;charset=utf-8' }),
          filenameFromPath(result.public_path) || 'id_ed25519.pub');
      },
      async deploy(id) {
        if (deploying) return;
        const target = port.connection(id);
        const selectTarget = () => port.notify(t('common:notifications.select_target_ssh'), 'info');
        if (!target) return selectTarget();
        const { name, ssh_user: user, ssh_host: host, ssh_port: sshPort } = target;
        deploying = true;
        try {
          if (!await port.confirm(t('common:dialogs.deploy_public_key_message', { name, user, host }),
            t('common:dialogs.deploy_public_key_title'), t('common:auto.confirm'), t('common:actions.cancel'))) return;
          const current = port.connection(id);
          if (!current || current.name !== name || current.ssh_user !== user || current.ssh_host !== host || current.ssh_port !== sshPort) return selectTarget();
          await settingsServices.termaManagedKeys!.deploy(id, result.public_path);
          port.notify(t('common:notifications.public_key_deployed', { name }), 'success');
        } catch (error) { report(error); }
        finally { deploying = false; }
      },
      done() { void port.refreshKeys().catch(report); }
    };
    return quickServices.termaCommandNavigation.page('ssh-key-result', () => openSettingsDialog('key-result', { ...data }));
  }
  function openPage() {
    let alive = true;
    let busy = false;
    const values: WizardView = {
      wizardType: 'ed25519',
      changeType(type) {
        refreshSettingsDialog({ wizardType: type });
      },
      async submit({ name, comment, passphrase, type, bits }) {
        if (busy || !alive) return;
        busy = true;
        const sizes: readonly number[] = sshKeySizes[type];
        refreshSettingsDialog({ busy });
        try {
          const result = await settingsServices.termaManagedKeys!.generate({
            name: name.trim(), comment: comment.trim(), passphrase, key_type: type,
            key_bits: sizes.includes(bits) ? bits : sizes[0]!
          });
          void port.refreshKeys().catch(report);
          if (alive) showResult(result);
        } catch (error) { if (alive) report(error); }
        finally {
          busy = false;
          if (alive) refreshSettingsDialog({ busy });
        }
      },
      dismiss() { alive = false; }
    };
    openSettingsDialog('key-wizard', { ...values });
  }
  return { open: () => quickServices.termaCommandNavigation.page('ssh-key-wizard', openPage) };
}

export function installKeyWizard() {
  settingsServices.termaKeyWizard = {
    open() {
      const view = $('view-settings');
      return createKeyWizard({
        tr, notify, connection: currentConnection, confirm: confirmModal,
        refreshKeys: () => loadManagedKeys(view)
      }).open();
    }
  };
}



export interface InstalledFeaturesSettingsKeyWizardServiceServices {
  termaKeyWizard: ReturnType<typeof createKeyWizard>;
}
