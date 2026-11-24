import type {RemoteTaskScope} from './component-task-service';
import type {ConnectionStatus} from './remote-desktop-workspace';

interface RemoteWorkspaceScopePort {
  paneForTab(key: string): {id: string} | null | undefined;
  pane(id: string): {activeTabKey: string} | null | undefined;
  tab(key: string): {kind?: string; id?: number} | null | undefined;
  activeKey(): string;
  focusedPane(): string;
  selectTab(key: string): void;
  closeTab(key: string): void;
  markStatus(key: string, status: ConnectionStatus): void;
  selectedProfile(): number | null;
  elementForTab(key: string, selector: string): HTMLElement | null;
  element(id: string): HTMLElement | null;
  inPane<T>(id: string, run: () => T): T;
}
interface DesktopRenderScope extends RemoteTaskScope {
  request: object;
}

export function createRemoteWorkspaceScope(port: RemoteWorkspaceScopePort) {
  const requests = new WeakMap<HTMLElement, object>();
  function activeWorkspace(workspace: HTMLElement, key: string) {
    const pane = workspace.closest<HTMLElement>('.workspace-pane');
    if (!pane) return port.activeKey() === key;
    const paneId = pane.dataset.paneId, focused = port.focusedPane();
    if (paneId && focused && paneId !== focused) return false;
    const active = paneId && port.pane(paneId)?.activeTabKey;
    return !active || active === key;
  }
  function capture(profileId: number, key = '', container: HTMLElement | null = null): RemoteTaskScope {
    const pane = container?.closest<HTMLElement>('.workspace-pane');
    const paneId = pane?.dataset.paneId || (key ? port.paneForTab(key)?.id : '') || '';
    return {profileId, key, paneId, containerId: container?.id || '', container};
  }
  function current(scope?: RemoteTaskScope) {
    if (!scope) return true;
    const {key, paneId, profileId} = scope;
    if (paneId) {
      const pane = port.pane(paneId);
      if (!pane || (key && pane.activeTabKey !== key)) return false;
      const tab = key ? port.tab(key) : null;
      return tab?.kind !== 'remote-desktop' || !profileId || Number(tab.id) === profileId;
    }
    const activeKey = port.activeKey();
    return (!key || !activeKey || activeKey === key) && (!profileId || Number(port.selectedProfile()) === profileId);
  }
  function resolve(scope: RemoteTaskScope | undefined, container: HTMLElement | null): HTMLElement | null {
    if (!current(scope)) return null;
    function belongs(node: HTMLElement | null | undefined): node is HTMLElement {
      if (!node || node.isConnected === false) return false;
      const pane = node.closest<HTMLElement>('.workspace-pane');
      return !pane || !scope?.paneId || pane.dataset.paneId === scope.paneId;
    }
    if (belongs(container)) return container;
    if (belongs(scope?.container)) return scope.container;
    if (!scope?.containerId) return null;
    const replacement = scope.key && port.elementForTab(scope.key, `#${scope.containerId}`);
    if (replacement && belongs(replacement)) {
      scope.container = replacement;
      return replacement;
    }
    if (scope.paneId) return null;
    const fallback = port.element(scope.containerId);
    if (!belongs(fallback)) return null;
    scope.container = fallback;
    return fallback;
  }
  function begin(profileId: number, key: string, view: HTMLElement): DesktopRenderScope {
    const request = {};
    requests.set(view, request);
    return {...capture(profileId, key, view), request};
  }
  function view(scope: DesktopRenderScope) {
    const mount = scope.container;
    return mount && mount.isConnected !== false && current(scope) && requests.get(mount) === scope.request ? mount : null;
  }
  function paint<T>(scope: DesktopRenderScope, render: (mount: HTMLElement) => T): T | undefined {
    const run = () => {
      const mount = view(scope);
      return mount ? render(mount) : undefined;
    };
    return scope.paneId ? port.inPane(scope.paneId, run) : run();
  }
  return {capture, current, resolve, begin, view, paint, activeWorkspace,
    selectTab:port.selectTab, closeTab:port.closeTab, markStatus:port.markStatus};
}
