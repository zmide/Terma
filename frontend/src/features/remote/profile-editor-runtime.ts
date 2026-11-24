import { isRemoteProtocol, type RemoteProfile, type RemoteProtocol } from './profile-model';
import type { ListProfile } from './profile-list-service';
import type { ProfileEditorPort, RemoteServicePort } from './profile-service';

interface EditorTab { key: string; pinned?: boolean }
export interface RemoteEditorBinding {
  ownerKey?: string;
  defaultGroup: string;
  onCreateGroup(apply: (name: string) => boolean): void;
  onTest(id: number, button: HTMLButtonElement | null): Promise<unknown>;
  onClose(): void;
  servicePort: ProfileEditorPort;
}

export interface RemoteProfileEditorHost extends RemoteServicePort {
  defaultGroup: string;
  pendingGroup(): string;
  profile(id: number): ListProfile | undefined;
  endpoint(profile: RemoteProfile): string;
  protocolLabel(protocol: RemoteProtocol): string;
  select(profile: ListProfile | null, updateTab: boolean): void;
  workspace(tab: {title: string; subtitle: string; key: string; id: number; protocol: RemoteProtocol}, updateTab: boolean): void;
  activeTab(): EditorTab | undefined;
  owns(tab: EditorTab): boolean;
  close(key: string): void;
  groupDialog(apply: (name: string) => void): void;
  rememberGroup(name: string): void;
  closeVnc(id: number): Promise<unknown>;
  reload(): Promise<void>;
  paintList(): void;
  render(profile: RemoteProfile, binding: RemoteEditorBinding): void;
  open(profile: ListProfile, options: {forceLaunch: boolean}): unknown;
  localize(message: string): string;
}

export function createRemoteProfileEditor(host: RemoteProfileEditorHost, test: RemoteEditorBinding['onTest']) {
  const tr = host.tr;
  function render(profile: RemoteProfile) {
    const tab = host.activeTab();
    const owned = () => !tab || host.owns(tab);
    host.render(profile, {
      ownerKey: tab?.key, defaultGroup: host.defaultGroup,
      onCreateGroup: apply => host.groupDialog(name => {
        if (owned() && apply(name)) host.rememberGroup(name);
      }),
      onTest: test,
      onClose: () => { if (tab && owned()) host.close(tab.key); },
      servicePort: {
        api: host.api, tr, notify: host.notify, unlocked: host.unlocked, defaultGroup: host.defaultGroup, localize: host.localize,
        refreshSaved: async (id, group, invalidateVnc) => {
          if (invalidateVnc) await host.closeVnc(id);
          host.rememberGroup(group);
          await host.reload();
          host.paintList();
        },
        complete: (id, action) => {
          if (!tab || !owned() || (action !== 'close' && action !== 'open')) return;
          tab.pinned = false;
          host.close(tab.key);
          if (action === 'open') {
            const saved = host.profile(id);
            if (saved) host.open(saved, {forceLaunch: true});
          }
        }
      }
    });
  }

  function create(protocol = 'rdp', groupName = '', updateTab = true) {
    if (!host.unlocked(tr('remote:auto.add_connection'))) return;
    const kind = isRemoteProtocol(protocol) ? protocol : 'rdp';
    host.select(null, updateTab);
    host.workspace({title: tr('remote:auto.add_protocol_short', {protocol: host.protocolLabel(kind)}),
      subtitle: groupName ? tr('remote:auto.group_named', {name: groupName}) : tr('remote:auto.new_remote_connection'),
      key: `remote-new-${kind}`, id: 0, protocol: kind}, updateTab);
    render({protocol: kind, group_name: groupName || host.pendingGroup() || host.defaultGroup, options: {}});
  }

  function edit(id: number, updateTab = true) {
    if (!host.unlocked(tr('remote:actions.edit'))) return;
    const profile = host.profile(id);
    if (!profile) return;
    host.select(profile, updateTab);
    host.workspace({title: tr('remote:auto.edit_named', {name: profile.name}), subtitle: host.endpoint(profile),
      key: `remote-edit-${id}`, id, protocol: profile.protocol}, updateTab);
    render(profile);
    if (updateTab) host.paintList();
  }
  return {create, edit, render};
}
