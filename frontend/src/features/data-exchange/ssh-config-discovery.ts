import {quickServices} from '@/features/quick/installed-services';
import {dataExchangeServices} from '@/features/data-exchange/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import { confirmModal } from '@/shared/workspace-prompts';
import { errorMessage, request, type Api, type Translate } from '../operations/operations-types';

interface DetectedConfig { available: boolean; count: number; text: string; conflicts?: string[] }
interface DiscoveryPort {
  api: Api;
  tr: Translate;
  confirm(message: string, title: string, confirm: string, cancel: string): Promise<boolean>;
  dismiss(): void;
  notify(text: string, kind: 'info' | 'error'): void;
}
const seenKey = 'sshConfigDetectionSeenV1';

function createSshConfigDiscovery(port: DiscoveryPort) {
  let seen = false;
  const t = port.tr;
  const detect = () => request<DetectedConfig>(port.api, '/api/ssh/config/detect');
  async function preview() {
    const nav = quickServices.termaCommandNavigation;
    const current = nav.active() ? nav.guard() : () => true;
    try {
      const detected = await detect();
      if (!current()) return;
      if (!detected.available || !detected.count || !detected.text?.trim()) {
        port.notify(t('common:ssh_config_import.no_hosts'), 'info');
        return;
      }
      const conflicts = detected.conflicts?.length
        ? '\n' + t('common:ssh_config_import.conflicts', { names: detected.conflicts.join(t('common:named_workspaces.connection_separator')) }) : '';
      if (!await port.confirm(t('common:ssh_config_import.confirm_message', { count: detected.count }) + conflicts,
        t('common:ssh_config_import.title'), t('common:ssh_config_import.preview'), t('common:actions.cancel'))) return;
      port.dismiss();
      await dataExchangeServices.termaExchange.feature().previewConfig(detected.text);
    } catch (error) { port.notify(errorMessage(error, t('errors:backend.request_failed')), 'error'); }
  }
  return {
    open: () => quickServices.termaCommandNavigation.page('ssh-config-import', preview),
    async firstUse() {
      if (seen) return;
      seen = true;
      try {
        if (localStorage.getItem(seenKey) === '1') return;
        localStorage.setItem(seenKey, '1');
      } catch { /* This optional notice still runs once per page without storage. */ }
      const config = await detect().catch(() => null);
      if (config?.count) port.notify(t('common:ssh_config_import.detected_notice', { count: config.count }), 'info');
    }
  };
}

export function installSshConfigDiscovery() {
  dataExchangeServices.termaSshConfigDiscovery = createSshConfigDiscovery({
    api: (...args) => api(...args), tr: (...args) => tr(...args),
    confirm: (...args) => confirmModal(...args), notify: (...args) => notify(...args),
    dismiss() { closeModal(); efficiencyServices.termaEfficiency.palette.close(); }
  });
}



export interface InstalledFeaturesDataExchangeSshConfigDiscoveryServices {
  termaSshConfigDiscovery: ReturnType<typeof createSshConfigDiscovery>;
}
