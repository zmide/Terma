import type {RunningForward} from '../operations/running-forwards';
import type {RemoteProfile} from '../remote/profile-model';
import type {createWorkspaceStateService, WorkspaceStateTab} from '../workspace/workspace-state-service';

export type Layout = Record<string, unknown>;
export type Connection = {
  id: number;
  name: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  forwards?: RunningForward[];
};
export type BindingKind = 'ssh' | 'remote';
type LayoutState = Pick<ReturnType<typeof createWorkspaceStateService>, 'eachNamedWorkspaceTab' | 'namedWorkspaceSavedTabs'>;
type Reference = {id: number; name?: string; host?: string; port?: number; user?: string; protocol?: string; path?: string};

const kindFields = {ssh: 'connection_refs', remote: 'remote_profile_refs'} as const;
const sshKinds = new Set(['terminal', 'sftp', 'forwards', 'dashboard', 'edit']);
const remoteKinds = new Set(['remote-edit', 'remote-desktop', 'remote-terminal', 'ftp']);
export const isSshKind = (kind: unknown) => sshKinds.has(String(kind));
export const isRemoteKind = (kind: unknown) => remoteKinds.has(String(kind));
export const bindingKey = (kind: BindingKind, id: number) => `${kind}:${id}`;
function bindingKind(tab: WorkspaceStateTab): BindingKind | undefined {
  if (isSshKind(tab.kind)) return 'ssh';
  if (isRemoteKind(tab.kind)) return 'remote';
}

export function asRecord(value: unknown): Layout | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Layout : undefined;
}
export function validIds(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => typeof value === 'number' || typeof value === 'string' ? Number(value) : 0)
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}
const records = (value: unknown) => Array.isArray(value) ? value.map(asRecord).filter(row => row !== undefined) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const refs = (layout: Layout, kind: BindingKind): Reference[] => records(layout[kindFields[kind]])
  .filter(item => validIds([item.id]).length > 0).map(item => ({
    id: Number(item.id), name: text(item.name), host: text(item.host), port: Number(item.port) || undefined,
    user: text(item.user), protocol: text(item.protocol), path: text(item.path)
  }));

export function sshReference(item: Connection) {
  return {id: item.id, name: item.name, host: item.ssh_host, port: item.ssh_port, user: item.ssh_user};
}
export function remoteReference(item: RemoteProfile) {
  return {id: item.id, name: item.name, protocol: item.protocol, host: item.host, port: item.port, path: item.options?.path || ''};
}

export function createWorkspaceReferences(state: LayoutState, connections: () => Connection[], profiles: () => RemoteProfile[]) {
  const connection = (id: number) => connections().find(item => Number(item.id) === id);
  const profile = (id: number) => profiles().find(item => Number(item.id) === id);
  const saved = (layout: Layout) => state.namedWorkspaceSavedTabs(layout).filter(tab => asRecord(tab));
  const tabIds = (layout: Layout, kind: BindingKind) => validIds(saved(layout).filter(tab => bindingKind(tab) === kind).map(tab => tab.id));
  const matchSsh = (ref: Reference) => connections().find(item => ref.host && item.ssh_host === ref.host
    && Number(item.ssh_port || 22) === (ref.port || 22) && item.ssh_user === ref.user)
    || connections().find(item => ref.name && item.name === ref.name);
  const matchRemote = (ref: Reference) => {
    const compatible = profiles().filter(item => !ref.protocol || item.protocol === ref.protocol);
    return compatible.find(item => ref.protocol && ref.host && item.host === ref.host && Number(item.port || 0) === (ref.port || 0))
      || compatible.find(item => ref.protocol && ref.path && item.options?.path === ref.path)
      || compatible.find(item => ref.name && item.name === ref.name);
  };

  function missing(layout: Layout) {
    const ssh = refs(layout, 'ssh');
    const remote = refs(layout, 'remote');
    return {
      ssh: tabIds(layout, 'ssh').filter(id => !connection(id)).map(id => {
        const ref = ssh.find(item => item.id === id) ?? {id};
        return {ref, options: connections(), matched: matchSsh(ref)};
      }),
      remote: tabIds(layout, 'remote').filter(id => !profile(id)).map(id => {
        const ref = remote.find(item => item.id === id) ?? {id};
        return {ref, options: profiles().filter(item => item.id && (!ref.protocol || item.protocol === ref.protocol)), matched: matchRemote(ref)};
      })
    };
  }

  function applyBindings(layout: Layout, bindings: ReadonlyMap<string, number>) {
    state.eachNamedWorkspaceTab(layout, tab => {
      const kind = bindingKind(tab);
      const id = kind && bindings.get(bindingKey(kind, Number(tab.id)));
      if (id) tab.id = id;
    });
    for (const kind of ['ssh', 'remote'] as const) {
      const references = refs(layout, kind);
      const original = new Map(references.map(item => [item.id, item]));
      for (const [key, id] of bindings) {
        const [type, source] = key.split(':');
        if (type !== kind) continue;
        const ssh = kind === 'ssh' ? connection(id) : undefined;
        const remote = kind === 'remote' ? profile(id) : undefined;
        const metadata = ssh ? sshReference(ssh) : remote ? remoteReference(remote) : {};
        original.set(Number(source), {...original.get(Number(source)), ...metadata, id});
      }
      layout[kindFields[kind]] = [...original.values()];
    }
    return layout;
  }

  function remapImported(layout: Layout) {
    const bindings = new Map<string, number>();
    const matchedSsh = new Map<number, number>();
    const unmatchedSsh = new Set<number>();
    for (const kind of ['ssh', 'remote'] as const) {
      const references = refs(layout, kind);
      const localIds = new Set(validIds((kind === 'ssh' ? connections() : profiles()).map(item => item.id)));
      const taken = new Set([...localIds, ...tabIds(layout, kind), ...references.map(ref => ref.id)]);
      let nextUnused = Number.MAX_SAFE_INTEGER;
      for (const ref of references) {
        const matched = kind === 'ssh' ? matchSsh(ref) : matchRemote(ref);
        const id = Number(matched?.id);
        if (id > 0) {
          bindings.set(bindingKey(kind, ref.id), id);
          if (kind === 'ssh') matchedSsh.set(ref.id, id);
        } else {
          if (kind === 'ssh') unmatchedSsh.add(ref.id);
          if (!localIds.has(ref.id)) continue;
          while (taken.has(nextUnused)) nextUnused--;
          bindings.set(bindingKey(kind, ref.id), nextUnused--);
        }
      }
    }
    const forwardMap = new Map<number, number>();
    for (const ref of records(layout.forward_refs)) {
      const sourceId = Number(ref.connection_id);
      if (unmatchedSsh.has(sourceId)) continue;
      const match = connection(matchedSsh.get(sourceId) || sourceId)?.forwards?.find(forward => forward.mode === ref.mode
        && forward.bind_host === ref.bind_host && Number(forward.bind_port) === Number(ref.bind_port)
        && forward.target_host === ref.target_host && Number(forward.target_port) === Number(ref.target_port));
      if (match) forwardMap.set(Number(ref.id), Number(match.id));
    }
    layout.running_forward_ids = validIds(validIds(layout.running_forward_ids).map(id => forwardMap.get(id) || 0));
    layout.forward_refs = records(layout.forward_refs).flatMap(ref => {
      const id = forwardMap.get(Number(ref.id));
      return id ? [{...ref, id, connection_id: matchedSsh.get(Number(ref.connection_id)) || Number(ref.connection_id)}] : [];
    });
    return applyBindings(layout, bindings);
  }

  return {connection, profile, tabIds, saved, missing, applyBindings, remapImported};
}
