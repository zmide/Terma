import {forwardsServices} from '@/features/forwards/installed-services';
import type { Forward } from '../forwards/forward-model';
import type {
  QuickConnectionSearchForward,
  QuickConnectionSearchRecord,
  QuickSshSearchTarget
} from './quick-port';

type QuickConnectSearchPort = {
  connections: QuickConnectionSearchRecord[];
  tr(key: string, options?: Record<string, unknown>): string;
  parseQuickSshTarget(value: unknown): QuickSshSearchTarget | null;
  quickSshExactConnections(target: QuickSshSearchTarget | null): QuickConnectionSearchRecord[];
};

type SearchCacheEntry = {
  signature: string;
  text: string;
};

export type QuickForwardSearchRow = {
  connection: QuickConnectionSearchRecord;
  forward: QuickConnectionSearchForward;
};

export const QUICK_RESULT_LIMIT = 120;

export type QuickConnectSearchService = {
  connectionRows(query?: unknown): QuickConnectionSearchRecord[];
  forwardRows(query?: unknown): QuickForwardSearchRow[];
  forwardSearchText(connection: QuickConnectionSearchRecord, forward: QuickConnectionSearchForward): string;
};



function searchSignature(values: unknown[]) {
  return values.map(value => String(value ?? '')).join('\u0001').toLowerCase();
}

export function createQuickConnectSearchService(port: QuickConnectSearchPort): QuickConnectSearchService {
  const connectionSearchCache = new WeakMap<QuickConnectionSearchRecord, SearchCacheEntry>();
  const forwardSearchCache = new WeakMap<QuickConnectionSearchForward, SearchCacheEntry>();

  function connectionSearchText(connection: QuickConnectionSearchRecord) {
    const signature = searchSignature([
      connection.name,
      connection.group_name,
      connection.tags,
      connection.ssh_host,
      connection.ssh_user,
      connection.ssh_port,
      `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`
    ]);
    const cached = connectionSearchCache.get(connection);
    if (cached?.signature === signature) return cached.text;
    const result = {signature, text:signature.replaceAll('\u0001', ' ')};
    connectionSearchCache.set(connection, result);
    return result.text;
  }

  function forwardSearchAliases(forward: QuickConnectionSearchForward) {
    const mode = {
      local:`local ${port.tr('connections:quick_open.search_alias_local', {defaultValue:'local forwarding'})}`,
      remote:`remote ${port.tr('connections:quick_open.search_alias_remote', {defaultValue:'remote forwarding'})}`,
      socks:`socks socks5 ${port.tr('connections:quick_open.search_alias_socks', {defaultValue:'dynamic forwarding'})}`
    }[forward.mode || ''] || forward.mode;
    const status = {
      running:`running ${port.tr('connections:quick_open.search_alias_running', {defaultValue:'running'})}`,
      stopped:`stopped ${port.tr('connections:quick_open.search_alias_stopped', {defaultValue:'stopped'})}`,
      failed:`failed ${port.tr('connections:quick_open.search_alias_failed', {defaultValue:'failed to start'})}`,
      reconnecting:`reconnecting ${port.tr('connections:quick_open.search_alias_reconnecting', {defaultValue:'reconnecting'})}`
    }[forward.status || ''] || forward.status;
    return `${mode || ''} ${status || ''}`;
  }

  function forwardSearchText(connection: QuickConnectionSearchRecord, forward: QuickConnectionSearchForward) {
    const signature = searchSignature([
      connection.name,
      connection.group_name,
      connection.tags,
      connection.ssh_host,
      connection.ssh_user,
      connection.ssh_port,
      forward.service_name,
      forward.service_type,
      forward.service_note,
      forward.mode,
      forward.status,
      forward.url_scheme,
      forward.url_path,
      forward.bind_host,
      forward.bind_port,
      forward.target_host,
      forward.target_port,
      `${forward.bind_host}:${forward.bind_port}`,
      `${forward.target_host}:${forward.target_port}`,
      forwardSearchAliases(forward)
    ]);
    const cached = forwardSearchCache.get(forward);
    if (cached?.signature === signature) return cached.text;
    const result = {signature, text:signature.replaceAll('\u0001', ' ')};
    forwardSearchCache.set(forward, result);
    return result.text;
  }

  function connectionRows(query: unknown = '') {
    const needle = String(query || '').trim().toLowerCase();
    const target = port.parseQuickSshTarget(query);
    const exactIds = new Set(port.quickSshExactConnections(target).map(connection => Number(connection.id)));
    return [...port.connections]
      .filter(connection => !needle || exactIds.has(Number(connection.id)) || connectionSearchText(connection).includes(needle))
      .sort((left, right) => Number(right.favorite || 0) - Number(left.favorite || 0)
        || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', {numeric:true}));
  }

  function forwardRows(query: unknown = '') {
    const needle = String(query || '').trim().toLowerCase();
    const rows: QuickForwardSearchRow[] = [];
    for (const connection of port.connections) {
      for (const forward of connection.forwards || []) {
        if (!needle || forwardSearchText(connection, forward).includes(needle)) rows.push({connection, forward});
      }
    }
    return rows.sort((left, right) => Number(right.forward.status === 'running') - Number(left.forward.status === 'running')
      || Number(right.connection.favorite || 0) - Number(left.connection.favorite || 0)
      || String(left.forward.service_name || left.connection.name || '').localeCompare(
        String(right.forward.service_name || right.connection.name || ''),
        'zh-CN',
        {numeric:true}
      )
      || Number(left.forward.id || 0) - Number(right.forward.id || 0));
  }

  return {connectionRows, forwardRows, forwardSearchText};
}

export function createQuickForwardPresentation(tr: QuickConnectSearchPort['tr'], search: QuickConnectSearchService) {
  const knownModes = new Set(['local', 'remote', 'socks']);
  const knownStatuses = new Set(['running', 'stopped', 'failed', 'reconnecting']);
  const mode = (forward: QuickConnectionSearchForward) => knownModes.has(forward.mode || '')
    ? forwardsServices.termaForwardRuntime.modeText(forward.mode!) : String(forward.mode || '');
  const status = (forward: QuickConnectionSearchForward) => knownStatuses.has(forward.status || '')
    ? forwardsServices.termaForwardRuntime.statusText(forward.status!) : String(forward.status || '');
  const name = (forward: QuickConnectionSearchForward) => forward.service_name
    || (forward.service_type && forward.service_type !== 'other' ? String(forward.service_type).toUpperCase() : '')
    || (knownModes.has(forward.mode || '') ? mode(forward) : tr('connections:quick_open.forward_rule', {defaultValue: '转发规则'}));
  const rule = (forward: QuickConnectionSearchForward) => forwardsServices.termaForwardRuntime.compactText(forward as Forward);
  const url = (forward: QuickConnectionSearchForward) => forwardsServices.termaForwardRuntime.runningUrl(forward as Forward);
  const describe = (connection: QuickConnectionSearchRecord, forward: QuickConnectionSearchForward) => ({
    name: name(forward), rule: rule(forward), status: status(forward), url: url(forward),
    search: search.forwardSearchText(connection, forward)
  });
  return {mode, status, name, rule, url, describe};
}

export interface InstalledFeaturesQuickQuickConnectSearchServiceServices {
  termaQuickConnectSearch: QuickConnectSearchService;
  termaQuickForwardPresentation: ReturnType<typeof createQuickForwardPresentation>;
}
