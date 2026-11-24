import {forwardsServices} from '@/features/forwards/installed-services';
import {operationsServices} from '@/features/operations/installed-services';
import { request } from '../operations/operations-types';
import { installRunningViews } from '../operations/RunningForwardViews';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';
import { createForwardActions } from './forward-actions';
import { createForwardConflictService } from './forward-conflict';
import { createForwardGlobalService } from './forward-global-service';
import type { Connection, ForwardPort, Template } from './forward-model';
import { createForwardRuntime, type ForwardRuntimePort } from './forward-runtime';
import { installForwardPages } from './ForwardPages';

type View = 'forwards' | 'forward-manager';
export type ForwardWorkspaceHost = Pick<ForwardPort, 'api' | 'tr' | 'connections' | 'templates' | 'groupName' | 'reload' | 'copy' | 'logs' | 'notify'>
  & Pick<ForwardRuntimePort, 'pageHost' | 'isLoopback' | 'escape'> & {
    groupSources(): readonly {group_name?: string}[];
    defaultGroup: string;
    setTemplates(templates: Template[]): void;
    activeTab(): WorkspaceTab | null | undefined;
    tabs(): WorkspaceTab[];
    captureTab(key: string): (action: () => void) => unknown;
    selectedId(): number;
    select(id: number, options: {render: boolean; reveal: boolean}): Connection | null | undefined;
    used(id: number): void;
    show(title: string, subtitle: string, view: View, key: string, updateTab: boolean, meta: {kind: View; id?: number}): void;
    view(id: string): HTMLElement | null;
    openTerminal(id: number, key: string, title: string): void;
    focusTerminal(key: string): void;
    runningVisible(): boolean;
    releaseConnectionList(root: HTMLElement): void;
    authenticationFailed(error: unknown): boolean;
    repairCredentials(id: number, options: {context: string; error: unknown; onSaved: () => void}): Promise<unknown>;
    setBusy(button: unknown, busy: boolean, text: string): void;
  };
const ownsTab = (host: ForwardWorkspaceHost, tab = host.activeTab()) => () => !tab || host.tabs().includes(tab);

export function createForwardWorkspace(host: ForwardWorkspaceHost, pages: (typeof forwardsServices)['termaForwardPages'], running: (typeof operationsServices)['termaRunning']) {
  const t = host.tr;
  function managerSubtitle() {
    return t('connections:forward_manager.subtitle', {count: host.connections().reduce((count, c) => count + (c.forwards?.length || 0), 0)});
  }
  function openManager(updateTab = true, focusId = 0) {
    host.show(t('connections:forward_manager.title'), managerSubtitle(), 'forward-manager', 'forward-manager', updateTab, {kind: 'forward-manager'});
    const target = host.view('view-forward-manager');
    if (target) return pages.manage(target, focusId);
  }
  function openConnection(id: number, updateTab = true, focusId = 0) {
    const connection = host.select(id, {render: updateTab, reveal: updateTab});
    if (!connection) return;
    if (updateTab) host.used(connection.id);
    const {name, forwards} = connection;
    host.show(t('connections:forwards.workspace_tab', {name}), t('connections:forwards.short_count', {count: forwards.length}), 'forwards', `forwards-${connection.id}`, updateTab, {kind: 'forwards', id: connection.id});
    const target = host.view('view-forwards');
    if (target) return pages.connection(target, connection.id, focusId);
  }
  function capture(connectionId = host.selectedId()) {
    const tab = host.activeTab();
    const valid = ownsTab(host, tab);
    const inTab = host.captureTab(tab?.key || '');
    return {
      valid,
      focus() { if (tab?.kind === 'terminal' && valid()) inTab(() => host.focusTerminal(tab.key)); },
      refresh() {
        if (!tab || !valid()) return;
        inTab(() => {
          if (tab.kind === 'forward-manager') openManager(false);
          else if (Number(tab.id) === Number(connectionId)) {
            if (tab.kind === 'forwards') openConnection(connectionId, false);
            else if (tab.kind === 'terminal') host.openTerminal(connectionId, tab.key, tab.title || '');
          }
        });
      }
    };
  }
  function renderRunning() {
    if (!host.runningVisible()) return;
    const target = host.view('connectionGroups');
    if (!target) return;
    host.releaseConnectionList(target);
    running.mountList(target);
  }
  function find(id: number) {
    for (const connection of host.connections()) {
      const forward = connection.forwards?.find(rule => rule.id === id);
      if (forward) return forward;
    }
    return null;
  }
  return {managerSubtitle, openManager, openConnection, capture, renderRunning, find};
}

export function installForwardWorkspace(host: ForwardWorkspaceHost) {
  const locale = () => document.documentElement.lang || 'zh-CN';
  const runtime = createForwardRuntime({...host, locale, lanHost: () => location.hostname});
  const common = {
    api: host.api, tr: host.tr, connections: host.connections, reload: host.reload, notify: host.notify,
    locale, copy: host.copy, logs: host.logs, access: runtime.openUrl, quality: runtime.quality
  };
  const repair: ForwardPort['repair'] = async (id, error) => {
    if (!host.authenticationFailed(error)) return;
    await host.repairCredentials(id, {context: host.tr('connections:forwards.auth_failed_context'), error, onSaved: () => pages.refresh()});
  };
  // Both installers retain lazy mounting. These callbacks first run after the workspace is installed.
  const pages = installForwardPages({
    ...common, repair, templates: host.templates, groupName: host.groupName,
    groups: () => [...new Set(host.groupSources().map(value => value.group_name || host.defaultGroup))],
    stored: key => localStorage.getItem(key), store: (key, value) => localStorage.setItem(key, value),
    scopeOwner: () => host.activeTab() || null,
    scope: () => ownsTab(host),
    async reloadTemplates() {
      const templates = await request<Template[]>(host.api, '/api/forward-templates');
      host.setTemplates(templates);
      pages.refresh();
      return templates;
    },
    diagnose: id => actions.diagnose(id), openConnection: id => workspace.openConnection(id)
  });
  const running = installRunningViews({
    ...common, visible: host.runningVisible,
    stored: () => localStorage.getItem('runningFilter') || '', store: value => localStorage.setItem('runningFilter', value),
    conflict: id => actions.prepareRetry(id, host.runningVisible), manage: id => workspace.openManager(true, id)
  });
  const workspace = createForwardWorkspace(host, pages, running);
  const actions = createForwardActions({...common, repair, ask: pages.ask, capture: workspace.capture, setBusy: host.setBusy, diagnosisMessage: runtime.diagnosisMessage});
  const conflicts = createForwardConflictService(common);
  forwardsServices.termaForwardGlobal = {service: createForwardGlobalService({...common, setBusy: host.setBusy, prepare: connection => conflicts.prepare(connection, pages.ask)})};
  forwardsServices.termaForwardRuntime = runtime;
  forwardsServices.termaForwardActions = actions;
  forwardsServices.termaForwardWorkspace = workspace;
}



export interface InstalledFeaturesForwardsForwardWorkspaceServices {
  termaForwardWorkspace: ReturnType<typeof createForwardWorkspace>;
  termaForwardRuntime: ReturnType<typeof createForwardRuntime>;
  termaForwardActions: ReturnType<typeof createForwardActions>;
  termaForwardGlobal: {service: ReturnType<typeof createForwardGlobalService>};
}
