import {quickServices} from '@/features/quick/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {downloadBlob} from '../../shared/ui/browser-download';
import {errorMessage, request, type Api, type Translate} from '../operations/operations-types';
import type {RemoteProfile} from '../remote/profile-model';
import type {WorkspaceLayoutNode} from '../workspace/workspace-layout-service';
import type {WorkspaceStateGroup, WorkspaceStateTab, createWorkspaceStateService} from '../workspace/workspace-state-service';
import {
  asRecord, bindingKey, createWorkspaceReferences, isRemoteKind, isSshKind,
  remoteReference, sshReference, validIds, type BindingKind, type Connection, type Layout
} from './named-workspace-references';

export interface NamedWorkspace {
  id: number;
  name: string;
  description?: string;
  layout: Record<string, unknown>;
}

type SavedGroup = Omit<WorkspaceStateGroup, 'tabs'> & {tabs: WorkspaceStateTab[]};
type WorkspaceSnapshot = {
  tabs: WorkspaceStateTab[];
  groups: SavedGroup[];
  layout: WorkspaceLayoutNode | null;
  activeKey: string;
  activeGroupId: string;
  focusedPaneId: string;
};
type Notice = 'info' | 'success' | 'error';

interface Port {
  api: Api;
  tr: Translate;
  connections(): Connection[];
  profiles(): RemoteProfile[];
  profileLabel(protocol: RemoteProfile['protocol']): string;
  localFiles(): boolean;
  tabs(): WorkspaceStateTab[];
  activeGroup(): {id: string; name: string} | null;
  snapshot(): WorkspaceSnapshot;
  rememberFilePath(key: string): string | undefined;
  applyLayout(saved: Record<string, unknown>): boolean;
  closeWorkspace(tabs: WorkspaceStateTab[]): void;
  refresh(): Promise<unknown>;
  input(title: string, label: string, value: string): Promise<string | null | undefined>;
  confirm(message: string, title: string, ok: string, cancel: string, danger: boolean): Promise<boolean>;
  notify(message: string, kind: Notice): void;
}

const presetsPath = '/api/named-workspaces';
const exportableSshKinds = new Set(['terminal', 'sftp', 'forwards']);
const independentKinds = new Set(['settings', 'import', 'command', 'log', 'forward-manager']);
const fileSizeLimit = 16 * 1024 * 1024;

interface MissingBinding {
  kind: BindingKind;
  id: number;
  name: string;
  detail: string;
  value: string;
  options: {value: string; label: string}[];
}

type WorkspaceState = Pick<ReturnType<typeof createWorkspaceStateService>, 'namedWorkspaceSavedTabs' | 'eachNamedWorkspaceTab' | 'prepareNamedWorkspaceLayout'>;
export function createNamedWorkspaceService(port: Port, state: WorkspaceState) {
  const {tr} = port;
  const label = (name: string, values?: Record<string, unknown>) => tr(`common:named_workspaces.${name}`, values);
  let workspaces: NamedWorkspace[] = [];
  const items = () => workspaces;
  const find = (id: number) => workspaces.find(item => item.id === id);
  const resources = createWorkspaceReferences(state, port.connections, port.profiles);
  let listing: {generation: number; result: Promise<NamedWorkspace[]>} | undefined;
  let generation = 0;
  let applying = false;
  let revision = 0;

  function tabExists(tab: WorkspaceStateTab) {
    if (isSshKind(tab.kind)) return Boolean(resources.connection(Number(tab.id)));
    if (isRemoteKind(tab.kind)) return Boolean(resources.profile(Number(tab.id)));
    if (tab.kind === 'local-files') return port.localFiles();
    return independentKinds.has(String(tab.kind));
  }

  function list(): Promise<NamedWorkspace[]> {
    const started = generation;
    if (listing?.generation === started) return listing.result;
    const result = request<NamedWorkspace[]>(port.api, presetsPath)
      .then(items => {
        if (started !== generation) return list();
        if (!Array.isArray(items)) throw new Error(label('operation_failed'));
        workspaces = items;
        return items;
      })
      .finally(() => { if (listing?.generation === started) listing = undefined; });
    listing = {generation: started, result};
    return result;
  }

  async function write(path: string, method: 'POST' | 'PUT' | 'DELETE', data?: Record<string, unknown>) {
    await port.api(path, {method, body: data && JSON.stringify(data)});
    generation++;
  }

  function references(tabs: WorkspaceStateTab[]) {
    const connections = port.connections();
    const connectionIds = validIds(tabs.filter(tab => exportableSshKinds.has(String(tab.kind))).map(tab => tab.id));
    const profileIds = validIds(tabs.filter(tab => isRemoteKind(tab.kind)).map(tab => tab.id));
    const connection_refs = connectionIds.map(id => {
      const item = connections.find(connection => connection.id === id);
      return item ? sshReference(item) : {id};
    });
    const remote_profile_refs = profileIds.map(id => {
      const item = resources.profile(id);
      return item ? remoteReference(item) : {id};
    });
    const forward_refs = connections.flatMap(connection => (connection.forwards || []).filter(forward => forward.status === 'running').map(forward => ({
      id: forward.id, connection_id: connection.id, mode: forward.mode, bind_host: forward.bind_host,
      bind_port: forward.bind_port, target_host: forward.target_host, target_port: forward.target_port
    })));
    return {connection_refs, remote_profile_refs, forward_refs, running_forward_ids: validIds(forward_refs.map(forward => forward.id))};
  }

  function capture() {
    const paths = new Map<string, string>();
    for (const tab of port.tabs()) {
      if (tab.kind !== 'sftp' || typeof tab.key !== 'string') continue;
      const path = port.rememberFilePath(tab.key);
      if (path) paths.set(tab.key, path);
    }
    const snapshot = port.snapshot();
    const persist = (tabs: WorkspaceStateTab[]) => tabs
      .filter(tab => tab.kind !== 'remote-edit' || Number(tab.id) > 0)
      .map(tab => {
        const path = tab.kind === 'sftp' ? paths.get(String(tab.key)) : undefined;
        return path ? {...tab, path} : tab;
      });
    const groups = snapshot.groups.map(group => ({...group, tabs: persist(group.tabs)}));
    const active = groups.find(group => group.id === snapshot.activeGroupId) || groups[0];
    const tabs = active?.tabs || persist(snapshot.tabs);
    return {
      version: 1, tabs, layout: snapshot.layout, activeTabKey: snapshot.activeKey, focusedPaneId: snapshot.focusedPaneId,
      workspace_groups_version: groups.length ? 1 : 0, workspace_groups: groups,
      active_workspace_group_id: snapshot.activeGroupId,
      ...references(groups.length ? groups.flatMap(group => group.tabs) : tabs)
    };
  }

  async function save() {
    if (!port.tabs().some(tab => tab.kind)) return port.notify(label('no_tabs_to_save'), 'info');
    const group = port.activeGroup();
    const name = (await port.input(label('save_title'), label('preset_name'), group?.name || ''))?.trim();
    if (!name || group?.id !== port.activeGroup()?.id) return;
    const layout = capture();
    if (!state.namedWorkspaceSavedTabs(layout).length) return port.notify(label('no_tabs_to_save'), 'info');
    await write(presetsPath, 'POST', {name, layout});
    await list().catch(() => items());
    port.notify(label('saved', {name}), 'success');
  }

  async function startForwards(ids: number[]) {
    const results = await Promise.allSettled(ids.map(id => port.api(`/api/forwards/${id}/start`, {method: 'POST', body: '{}'})));
    await port.refresh();
    return ids.filter((_, index) => results[index]?.status === 'rejected');
  }

  async function apply(id: number, alive = () => true) {
    if (applying) return;
    applying = true;
    const serial = ++revision;
    try {
      const workspace = await request<NamedWorkspace>(port.api, `${presetsPath}/${id}/use`, {method: 'POST', body: '{}'});
      if (!alive()) return;
      const rawLayout = workspace.layout || {};
      const saved = state.prepareNamedWorkspaceLayout(rawLayout, tabExists);
      const tabs = state.namedWorkspaceSavedTabs(saved);
      if (!tabs.length) return port.notify(label('no_restorable_tabs'), 'error');
      port.closeWorkspace(port.tabs());
      const applied = port.applyLayout({
        workspaceGroups: saved.workspace_groups, activeWorkspaceGroupId: saved.active_workspace_group_id,
        tabs, layout: rawLayout.layout, activeTabKey: rawLayout.activeTabKey, focusedPaneId: rawLayout.focusedPaneId
      });
      if (!applied) return port.notify(label('no_restorable_tabs'), 'error');
      const failed = await startForwards(validIds(rawLayout.running_forward_ids));
      if (failed.length) return {name: workspace.name, failed, serial};
      port.notify(label('opened', {name: workspace.name}), 'success');
    } finally {
      applying = false;
    }
  }

  async function retry(failure: {failed: number[]; serial: number}) {
    if (applying || revision !== failure.serial) return;
    applying = true;
    try {
      const failed = await startForwards(failure.failed);
      port.notify(failed.length ? label('still_failed', {count: failed.length}) : label('failed_all_started'), failed.length ? 'error' : 'success');
    } finally {
      applying = false;
    }
  }

  async function rename(id: number) {
    const item = find(id);
    if (!item) return false;
    const name = (await port.input(label('rename_title'), label('name_label'), item.name))?.trim();
    const latest = find(id);
    if (!name || !latest) return false;
    await write(`${presetsPath}/${id}`, 'PUT', {...latest, name});
    return true;
  }

  async function duplicate(id: number) {
    await write(`${presetsPath}/${id}/duplicate`, 'POST', {});
    return true;
  }

  async function remove(id: number) {
    if (!await port.confirm(label('delete_message'), label('delete_title'), tr('common:actions.delete'), tr('common:actions.cancel'), true)) return false;
    await write(`${presetsPath}/${id}`, 'DELETE');
    return true;
  }

  function missing(layout: Layout): MissingBinding[] {
    const {ssh, remote} = resources.missing(layout);
    return [
      ...ssh.map(({ref, options, matched}): MissingBinding => ({
        kind: 'ssh', id: ref.id, name: ref.name || `SSH #${ref.id}`,
        detail: [ref.user, ref.host].filter(Boolean).join('@'),
        value: matched ? String(matched.id) : '',
        options: options.map(item => ({value: String(item.id), label: `${item.name} · ${item.ssh_user}@${item.ssh_host}`}))
      })),
      ...remote.map(({ref, options, matched}): MissingBinding => ({
        kind: 'remote', id: ref.id, name: ref.name || label('remote_reference', {id: ref.id}),
        detail: ref.protocol || label('remote_protocol'),
        value: matched?.id ? String(matched.id) : '',
        options: options.map(item => ({value: String(item.id), label: `${item.name} · ${port.profileLabel(item.protocol)}`}))
      }))
    ];
  }

  function summary(layout: Layout) {
    const saved = resources.saved(layout);
    const ssh = resources.tabIds(layout, 'ssh');
    const remote = resources.tabIds(layout, 'remote');
    return {
      tabs: saved.length,
      groups: Array.isArray(layout.workspace_groups) ? layout.workspace_groups.length : 0,
      forwards: validIds(layout.running_forward_ids).length,
      missing: saved.filter(tab => (isSshKind(tab.kind) || isRemoteKind(tab.kind)) && !tabExists(tab)).length,
      connections: [
        ...ssh.map(id => resources.connection(id)?.name || label('deleted_ssh', {id})),
        ...remote.map(id => resources.profile(id)?.name || label('deleted_remote', {id}))
      ]
    };
  }

  function exportFile(id: number) {
    const item = find(id);
    if (!item) return;
    const workspace = {name: item.name, description: item.description || '', layout: item.layout};
    const data = {format: 'terma-named-workspace', version: 2, exported_at: new Date().toISOString(), workspace};
    const filename = (item.name || 'workspace').replace(/[\\/:*?"<>|]+/g, '-');
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}), `${filename}.terma-workspace.json`);
  }

  function importedName(value: unknown) {
    const name = (typeof value === 'string' ? value.trim() : '') || label('imported_default');
    const names = new Set(items().map(item => item.name.toLowerCase()));
    if (!names.has(name.toLowerCase())) return name;
    const base = label('imported_suffix', {name});
    let next = base, index = 2;
    while (names.has(next.toLowerCase())) next = `${base}${index++}`;
    return next;
  }

  async function importFile(file: File, alive: () => boolean) {
    if (file.size > fileSizeLimit) throw new Error(label('invalid_file'));
    let payload: Layout | undefined;
    try { payload = asRecord(JSON.parse(await file.text())); }
    catch { throw new Error(label('invalid_file')); }
    const source = asRecord(payload?.workspace) || payload;
    const layout = asRecord(source?.layout);
    if (!layout || !resources.saved(layout).length) throw new Error(label('invalid_file'));
    if (!alive()) return false;
    const name = importedName(source?.name);
    const description = typeof source?.description === 'string' ? source.description : '';
    resources.remapImported(layout);
    if (!Array.isArray(layout.tabs)) layout.tabs = resources.saved(layout);
    await write(presetsPath, 'POST', {name, description, layout});
    await list().catch(() => items());
    port.notify(label('imported', {name}), 'success');
    return true;
  }

  async function repair(id: number, values: ReadonlyMap<string, string>) {
    const item = find(id);
    if (!item) return false;
    const bindings = new Map<string, number>();
    for (const row of missing(item.layout)) {
      const key = bindingKey(row.kind, row.id);
      const target = values.get(key);
      if (!row.options.some(option => option.value === target)) {
        port.notify(label('select_all_missing'), 'info');
        return false;
      }
      bindings.set(key, Number(target));
    }
    if (!bindings.size) return true;
    const layout = resources.applyBindings(JSON.parse(JSON.stringify(item.layout)), bindings);
    await write(`${presetsPath}/${id}`, 'PUT', {...item, layout});
    await list();
    port.notify(label('rebound'), 'success');
    return true;
  }

  const displayError = (value: unknown) => errorMessage(value, label('operation_failed'));
  const notifyError = (value: unknown) => port.notify(displayError(value), 'error');
  return {
    tr, list, items, find, count: (layout: Layout) => resources.saved(layout).length,
    summary, missing, exportFile, importFile, repair, capture, save, apply, retry, rename, duplicate,
    remove, displayError, notifyError
  };
}

export function installNamedWorkspaceService(port: Port) {
  if (quickServices.termaNamedWorkspacePresets || !workspaceServices.termaWorkspaceState) return;
  quickServices.termaNamedWorkspacePresets = createNamedWorkspaceService(port, workspaceServices.termaWorkspaceState);
}



export interface InstalledFeaturesQuickNamedWorkspaceServiceServices {
  termaNamedWorkspacePresets: ReturnType<typeof createNamedWorkspaceService>;
}
