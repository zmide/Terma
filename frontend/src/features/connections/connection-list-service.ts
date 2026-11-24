import {connectionsServices} from '@/features/connections/installed-services';
import type { ConnectionViewPort } from './connection-port';

export type ConnectionListService = {
  bindScroll(): void;
  groupNames(extra?: string, kind?: 'ssh' | 'remote' | 'all'): string[];
  filteredConnections(): any[];
  orderedConnectionGroupNames(view?: 'connections' | 'remote'): string[];
  setSearch(value: unknown): void;
  toggleBulkMode(): void;
  setSelected(id: unknown, checked: boolean): void;
  toggleAll(checked: boolean): void;
  toggleGroup(group: string): boolean;
  saveGroupOrder(names: string[]): Promise<void>;
  moveGroup(group: string, delta: number): Promise<void>;
  toggleFavorite(id: number, favorite: number): Promise<void>;
  noteUsage(id: number, action?: string): void;
};

function groupName(item: any, defaultGroup: string) {
  return String(item?.group_name || defaultGroup);
}

function searchableConnectionValues(connection: any) {
  return [
    connection?.name,
    connection?.group_name,
    connection?.tags,
    connection?.ssh_host,
    connection?.ssh_user,
    connection?.ssh_port,
    ...(connection?.forwards || []).flatMap((forward: any) => [
      forward?.mode,
      forward?.bind_host,
      forward?.bind_port,
      forward?.target_host,
      forward?.target_port
    ])
  ];
}

export function createConnectionListService(port: ConnectionViewPort): ConnectionListService {
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let scrollTarget: HTMLElement | undefined;

  function onScroll(event: Event) {
    if (event.currentTarget instanceof HTMLElement) port.connectionVirtual.scrollTop = event.currentTarget.scrollTop;
    clearTimeout(scrollTimer);
    if (port.primaryView !== 'connections') return;
    scrollTimer = setTimeout(() => {
      if (port.primaryView === 'connections') port.renderConnections();
    }, 40);
  }

  function bindScroll() {
    const target = port.$('connectionGroups') as HTMLElement | null;
    if (target === scrollTarget) return;
    clearTimeout(scrollTimer);
    scrollTarget?.removeEventListener('scroll', onScroll);
    scrollTarget = target ?? undefined;
    scrollTarget?.addEventListener('scroll', onScroll, {passive: true});
  }

  function filteredConnections() {
    const query = String(port.connectionSearch || '').trim().toLowerCase();
    if (!query) return port.connections;
    return port.connections.filter((connection: any) => searchableConnectionValues(connection)
      .some(value => String(value ?? '').toLowerCase().includes(query)));
  }

  function orderedConnectionGroupNames(view: 'connections' | 'remote' = 'connections') {
    const items: any[] = view === 'remote' ? port.remoteProfiles || [] : port.connections;
    return Array.from(new Set(items.map((item: any) => groupName(item, port.defaultGroup))));
  }

  function groupNames(extra = '', kind: 'ssh' | 'remote' | 'all' = 'all') {
    const names = new Set(kind === 'remote' ? orderedConnectionGroupNames('remote') : orderedConnectionGroupNames());
    if (kind === 'all') orderedConnectionGroupNames('remote').forEach(name => names.add(name));
    names.add(port.defaultGroup);
    if (extra) names.add(extra);
    return [...names];
  }

  function setSearch(value: unknown) {
    port.connectionSearch = String(value || '');
    if (typeof localStorage !== 'undefined') localStorage.setItem('connectionSearch', port.connectionSearch);
    port.renderConnections();
  }

  function toggleBulkMode() {
    port.connectionBulkMode = !port.connectionBulkMode;
    port.selectedConnectionIds.clear();
    if (port.connectionBulkMode) {
      filteredConnections().forEach((connection: any) => port.groupOpen.add(groupName(connection, port.defaultGroup)));
    }
    port.saveGroupState();
    port.renderExplorerTools?.();
    port.renderConnections();
  }

  function setSelected(id: unknown, checked: boolean) {
    const connectionId = Number(id);
    if (checked) port.selectedConnectionIds.add(connectionId);
    else port.selectedConnectionIds.delete(connectionId);
    port.syncConnectionBulkBar();
  }

  function toggleAll(checked: boolean) {
    filteredConnections().forEach((connection: any) => {
      if (checked) port.selectedConnectionIds.add(connection.id);
      else port.selectedConnectionIds.delete(connection.id);
    });
    port.renderConnections();
  }

  function toggleGroup(group: string) {
    if (port.groupOpen.has(group)) port.groupOpen.delete(group);
    else port.groupOpen.add(group);
    port.saveGroupState();
    port.renderConnections();
    return true;
  }

  async function saveGroupOrder(names: string[]) {
    const allNames: string[] = Array.from(new Set([
      ...port.connections,
      ...(port.remoteProfiles || [])
    ].map((item: any) => groupName(item, port.defaultGroup))));
    const mergedNames = [...names, ...allNames.filter(name => !names.includes(name))];
    await port.api('/api/connection-groups/reorder', {
      method: 'POST',
      body: JSON.stringify({names: mergedNames})
    });
    const order = new Map(mergedNames.map((name, index) => [name, index]));
    const indexOf = (item: any) => order.get(groupName(item, port.defaultGroup)) ?? mergedNames.length;
    port.connections.sort((left: any, right: any) => indexOf(left) - indexOf(right));
    if (port.remoteProfiles) port.remoteProfiles.sort((left: any, right: any) => indexOf(left) - indexOf(right));
    port.renderConnections();
  }

  async function moveGroup(group: string, delta: number) {
    const names = orderedConnectionGroupNames('connections');
    const index = names.indexOf(group);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= names.length) return;
    [names[index], names[target]] = [names[target], names[index]];
    await saveGroupOrder(names);
  }

  async function toggleFavorite(id: number, favorite: number) {
    await port.api(`/api/connections/${id}/flags`, {
      method: 'POST',
      body: JSON.stringify({
        favorite: Number(favorite),
        notifications_muted: Number(port.currentConnection(id)?.notifications_muted || 0)
      })
    });
    await port.loadAll();
  }

  function noteUsage(id: number, action = 'open') {
    const connection = port.currentConnection(Number(id));
    if (connection) connection.last_used_at = Date.now();
    void port.api(`/api/connections/${Number(id)}/usage`, {
      method: 'POST',
      body: JSON.stringify({action})
    }).catch(() => {});
  }

  return {
    bindScroll,
    groupNames,
    filteredConnections,
    orderedConnectionGroupNames,
    setSearch,
    toggleBulkMode,
    setSelected,
    toggleAll,
    toggleGroup,
    saveGroupOrder,
    moveGroup,
    toggleFavorite,
    noteUsage
  };
}

export function installConnectionListService(host: ConnectionViewPort) {
  if (!connectionsServices.termaConnectionList) {
    connectionsServices.termaConnectionList = createConnectionListService(host);
    connectionsServices.termaConnectionList.bindScroll();
  }
}



export interface InstalledFeaturesConnectionsConnectionListServiceServices {
  termaConnectionList?: ConnectionListService;
}
