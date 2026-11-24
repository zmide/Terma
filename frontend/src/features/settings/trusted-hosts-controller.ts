import {sharedServices} from '@/shared/installed-services';
import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import { confirmModal } from '@/shared/workspace-prompts';
import { errorMessage, type Translate } from '../operations/operations-types';
import { createSettingsRequestLifecycle } from './settings-request-lifecycle';
import { queryTrustedHosts, trustedHostsPath, type SettingsTrustedHostsResponse, type TrustedHost } from './settings-service';

function createTrustedHostsController(port: {
  request: (typeof sharedServices)['termaWorkspaceRequest'];
  refreshRegion(): void;
  confirm: typeof confirmModal;
  notify: typeof notify;
  tr: Translate;
}) {
  const read = createSettingsRequestLifecycle();
  const removing = new Set<string>();
  let page = 1, pageSize = 5, total = 0, totalPages = 0, query = '';
  let requestedPage = 1, requestedQuery = '';
  let hosts: TrustedHost[] = [];

  async function load(nextPage = requestedPage, nextQuery = requestedQuery) {
    requestedPage = Math.max(1, Number(nextPage) || 1);
    requestedQuery = nextQuery.trim();
    const request = read.begin();
    try {
      const result = await port.request<SettingsTrustedHostsResponse>(queryTrustedHosts(requestedPage, pageSize, requestedQuery),
        {signal: request.signal, skipSftpConnect: true, skipHostTrustPrompt: true});
      if (!request.current()) return;
      hosts = Array.isArray(result.hosts) ? result.hosts : [];
      page = requestedPage = Number(result.page || requestedPage);
      pageSize = Number(result.page_size || pageSize);
      total = Number(result.total || 0);
      totalPages = Number(result.total_pages || 0);
      query = requestedQuery;
      port.refreshRegion();
    } catch (error) {
      if (!request.current()) return;
      requestedPage = page;
      requestedQuery = query;
      throw error;
    } finally { request.finish(); }
  }

  async function show(pageNumber: number, search = requestedQuery) {
    try { await load(pageNumber, search); }
    catch (error) { port.notify(errorMessage(error, '') || port.tr('errors:backend.request_failed'), 'error'); }
  }

  async function remove(record: TrustedHost) {
    if (!record.id || removing.has(record.id)) return;
    removing.add(record.id);
    const t = port.tr;
    try {
      const agreed = await port.confirm(t('settings:trust.delete_confirm', {
        host: record.host_label || record.host, type: record.key_type || t('settings:trust.unknown_algorithm')
      }), t('settings:trust.delete_title'), t('common:actions.delete'), t('common:actions.cancel'), true);
      if (!agreed || !hosts.some(item => item.id === record.id && item.fingerprint === record.fingerprint)) return;
      await port.request(trustedHostsPath, {method: 'DELETE', body: JSON.stringify({id: record.id}), skipHostTrustPrompt: true});
      await load();
      port.notify(t('settings:trust.deleted'), 'success');
    } catch (error) {
      port.notify(errorMessage(error, '') || t('settings:trust.delete_failed'), 'error');
    } finally { removing.delete(record.id); }
  }

  return {
    snapshot: () => ({hosts, page, total, totalPages, query}), load, remove,
    search: (value: string) => show(1, value),
    changePage: (target: number) => {
      const next = Math.max(1, Math.min(totalPages || 1, target));
      if (next !== requestedPage || !hosts.length) return show(next);
    }
  };
}

export function installTrustedHostsController(refreshRegion: () => void) {
  settingsServices.termaTrustedHosts = createTrustedHostsController({
    request: (path, options) => sharedServices.termaWorkspaceRequest(path, options),
    refreshRegion, confirm: (...args) => confirmModal(...args),
    notify: (...args) => notify(...args), tr: (...args) => tr(...args)
  });
}



export interface InstalledFeaturesSettingsTrustedHostsControllerServices {
  termaTrustedHosts: ReturnType<typeof createTrustedHostsController>
}
