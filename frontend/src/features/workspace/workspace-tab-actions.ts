import {workspaceServices} from '@/features/workspace/installed-services';
import type { ClosingWorkspaceTab } from './WorkspaceCloseDialog';
import type { WorkspaceMenuItem } from './workspace-port';
import type { WorkspaceTab } from './workspace-tab-runtime';
import type { PreparedRecord } from '../session-efficiency/persistent-session-service';

type CloseMode = 'current' | 'others' | 'right' | 'all';
type Choice = false | 'detach' | 'terminate';
type Scope = {id: string; tabs: WorkspaceTab[]; docked: boolean};
interface ConnectionState { terminal?: number; remote?: number; vnc?: boolean }
interface TabActionsPort {
  tabs(): WorkspaceTab[];
  scope(key: string): Scope | undefined;
  focus(scope: Scope): void;
  text(key: string, values?: Record<string, unknown>): string;
  transport(key: string): ConnectionState;
  connectionKind(tab: WorkspaceTab): 'ssh' | 'remote' | undefined;
  edit(id: number, kind: 'ssh' | 'remote'): void;
  confirm(rows: ClosingWorkspaceTab[]): Promise<Choice>;
  prepare(tab: WorkspaceTab): PreparedRecord | null;
  terminate(record: PreparedRecord): Promise<boolean>;
  save(): void;
  error(error: unknown): void;
  close(keys: string[], anchor: string): void;
  combine(key: string): void;
  pin(key: string): void;
  duplicate(key: string): void;
  move(key: string, offset: -1 | 1): void;
  show(menu: HTMLElement, items: WorkspaceMenuItem[]): void;
  unmount(menu: HTMLElement): void;
}

const persistent = (tab: WorkspaceTab) => tab.kind === 'terminal' && tab.sessionMode === 'persistent' && Boolean(tab.persistentSessionId);
const canClose = (tab: WorkspaceTab) => tab.closable && !tab.pinned;
const targetIdentity = (tab: WorkspaceTab) => JSON.stringify([tab.key,tab.kind,tab.protocol,tab.id]);
const sessionIdentity = (tab: WorkspaceTab) => JSON.stringify([tab.sessionMode,tab.persistentSessionId]);
const activeSocket = (readyState: number | undefined) => readyState === 0 || readyState === 1;

function closeCandidates(tabs: WorkspaceTab[], key: string, mode: string) {
  const index = tabs.findIndex(tab => tab.key === key);
  if (index < 0) return [];
  const candidates = mode === 'current' ? [tabs[index]!] : mode === 'others' ? tabs.filter(tab => tab.key !== key)
    : mode === 'right' ? tabs.slice(index + 1) : mode === 'all' ? tabs : [];
  return candidates.filter(canClose).map(tab => tab.key);
}

export function createWorkspaceTabActions(port: TabActionsPort, doc: Document = document, viewport: Window = window) {
  function needsConfirmation(tab: WorkspaceTab) {
    if (tab.kind === 'remote-desktop' && tab.protocol !== 'vnc') return false;
    if (persistent(tab) || tab.connectionStatus === 'connected' || tab.connectionStatus === 'connecting') return true;
    if (tab.connectionStatus === 'disconnected') return false;
    const sessions = port.transport(tab.key);
    return activeSocket(sessions.terminal) || activeSocket(sessions.remote) || Boolean(sessions.vnc);
  }
  function confirm(tabs: WorkspaceTab[]) {
    return port.confirm(tabs.map(tab => ({title:tab.title || '',status:tab.connectionStatus || 'connecting',persistent:persistent(tab)})));
  }
  async function requestClose(keys: readonly string[], anchor = '') {
    const requested = new Set(keys);
    const targets = port.tabs().filter(tab => requested.has(tab.key) && canClose(tab));
    if (!targets.length) return false;
    const pending = targets.map(tab => ({tab,target:targetIdentity(tab),session:sessionIdentity(tab),confirm:needsConfirmation(tab)}));
    const connected = pending.filter(item => item.confirm).map(item => item.tab);
    const records = connected.filter(persistent).map(tab => ({tab,record:port.prepare(tab)}));
    const terminated = new Set<WorkspaceTab>();
    const current = () => {
      const open = port.tabs();
      return pending.every(({tab,target,session,confirm}) => open.includes(tab) && canClose(tab) && target === targetIdentity(tab)
        && (session === sessionIdentity(tab) || terminated.has(tab) && !persistent(tab) && !tab.persistentSessionId)
        && (confirm || !needsConfirmation(tab)));
    };
    const choice = connected.length ? await confirm(connected) : 'detach';
    if (!choice || !current()) return false;
    if (choice === 'terminate') {
      if (records.some(item => !item.record)) return false;
      for (const {tab,record} of records) {
        try {
          if (!current() || !record || !await port.terminate(record)) return false;
          terminated.add(tab);
        }
        catch (error) { port.error(error); return false; }
      }
      if (!current()) return false;
      port.save();
    }
    port.close(targets.map(tab => tab.key),anchor);
    return true;
  }

  function closeMode(mode: CloseMode, key: string) {
    const scope = port.scope(key);
    hideMenu();
    return scope ? requestClose(closeCandidates(scope.tabs,key,mode),key) : Promise.resolve(false);
  }

  function hideMenu() {
    const menu = doc.getElementById('tabContextMenu');
    if (menu) { port.unmount(menu); menu.remove(); }
  }
  function showMenu(event: MouseEvent, key: string) {
    event.preventDefault();event.stopPropagation();hideMenu();
    const scope = port.scope(key), index = scope?.tabs.findIndex(tab => tab.key === key) ?? -1;
    const tab = scope?.tabs[index];
    if (!scope || !tab) return;
    port.focus(scope);
    const current = () => { const next = port.scope(key); return next?.id === scope.id && next.tabs.includes(tab); };
    const item = (label: string, icon: string, enabled: boolean, action: () => void): WorkspaceMenuItem => ({
      label:port.text(label),icon,enabled,action:() => { if (current()) action(); else hideMenu(); }
    });
    const closeItem = (mode: CloseMode, label: string, icon: string) => item(label,icon,closeCandidates(scope.tabs,key,mode).length > 0,() => { void closeMode(mode,key); });
    const editId = Number(tab.id || 0), editKind = port.connectionKind(tab);
    const editable = !tab.quick_connection && !tab.transient && Number.isInteger(editId) && editId > 0 && editKind;
    const items = [
      ...(editable ? [item('common:command_palette.edit_connection','pencil',true,() => {hideMenu();port.edit(editId,editable);})] : []),
      ...(scope.docked ? [
        item('navigation:auto.combine_workspace','combine',true,() => port.combine(key)),
        item(tab.pinned ? 'common:auto.unpin_tab' : 'common:auto.pin_tab','pin',true,() => port.pin(key)),
        item('common:auto.duplicate_tab','copy',Boolean(tab.kind),() => port.duplicate(key))
      ] : []),
      item('common:auto.move_left','arrow-left',index > 0,() => port.move(key,-1)),
      item('common:auto.move_right','arrow-right',index < scope.tabs.length - 1,() => port.move(key,1)),
      closeItem('current','common:auto.close_current_tab','x'),
      closeItem('others','common:auto.close_other_tabs','circle-x'),
      closeItem('right','common:auto.close_right_tabs','panel-right-close'),
      closeItem('all',scope.docked ? 'navigation:auto.close_pane_tabs' : 'common:auto.close_all_tabs','panel-top-close')
    ];
    const menu = doc.createElement('div');
    menu.id = 'tabContextMenu';menu.className = 'context-menu tab-context-menu';
    port.show(menu,items);doc.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0,Math.min(event.clientX,viewport.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(0,Math.min(event.clientY,viewport.innerHeight - rect.height - 8))}px`;
  }
  return {confirm,requestClose,closeMode,hideMenu,showMenu};
}

export function installWorkspaceTabActions(port: TabActionsPort) {
  workspaceServices.termaWorkspaceTabActions = createWorkspaceTabActions(port);
}



export interface InstalledFeaturesWorkspaceWorkspaceTabActionsServices {
  termaWorkspaceTabActions: ReturnType<typeof createWorkspaceTabActions>;
}
