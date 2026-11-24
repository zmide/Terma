import {workspaceServices} from '@/features/workspace/installed-services';
import type { WorkspaceDropZone } from './workspace-drag-service';
import type { WorkspaceTab } from './workspace-tab-runtime';

type SplitZone = Exclude<WorkspaceDropZone, 'tabs' | 'center'>;
type FileSource = NonNullable<WorkspaceTab['fileSource']>;
type CopyResult = {key: string; opened: boolean; split: boolean};
interface CopyOptions {
  splitZone?: string;
  beforeOpen?(key: string): void;
  result?: Partial<CopyResult>;
}

interface TabCopyPort {
  tabs(): WorkspaceTab[];
  pane(key: string): string | undefined;
  select(key: string, paneId: string): void;
  activate(key: string): void;
  add(tab: WorkspaceTab, key: string, title: string): void;
  render(paneId: string): void;
  split(key: string, paneId: string, zone: SplitZone): boolean;
  mobile(): boolean;
  defer(open: () => void): void;
  text(key: string, values?: Record<string, unknown>): string;
  nextTerminalIndex(id: number): number;
  connectionName(id: number): string | undefined;
  copyStartup(from: string, to: string): void;
  discardStartup(key: string): void;
  terminal(paneId: string, id: number, key: string, title: string): string | undefined;
  sftp(paneId: string, sourceKey: string, key: string): Promise<unknown>;
  fileLabel(source: FileSource): string;
  local(path: string, key: string, source?: FileSource): Promise<string>;
  hideMenu(): void;
  renderTabs(): void;
  save(): void;
  error(error: unknown): void;
}

const splitZone = (value: unknown): value is SplitZone => value === 'left' || value === 'right' || value === 'top' || value === 'bottom';

export function createWorkspaceTabCopy(port: TabCopyPort) {
  let serial = 0;
  const find = (key: string) => port.tabs().find(tab => tab.key === key);

  function copyIdentity(tab: WorkspaceTab) {
    const id = Number(tab.id || 0);
    if (tab.kind === 'terminal' && id) {
      const index = port.nextTerminalIndex(id);
      const name = port.connectionName(id);
      const suffix = index > 1 ? ` #${index}` : '';
      const title = name
        ? port.text('terminal:tabs.session', {name,suffix,defaultValue:`${name} · Terminal${suffix}`})
        : String(tab.title || port.text('common:auto.terminal', {defaultValue:'Terminal'})).replace(/\s+#\d+$/, '') + suffix;
      return {key:`terminal-${id}-${index}`,title};
    }
    const base = tab.key.replace(/-copy-\d+$/, '');
    let key: string;
    do { key = `${base}-copy-${++serial}`; } while (find(key));
    if (tab.kind === 'local-files') return {key,title:tab.fileSource ? port.fileLabel(tab.fileSource) : port.text('common:auto.local_files', {defaultValue:'Local Files'})};
    const marker = port.text('common:workspace.copy_suffix', {defaultValue:' · Copy'});
    let title = String(tab.title || port.text('navigation:auto.tab', {defaultValue:'Tab'}));
    const markerIndex = title.lastIndexOf(marker);
    if (markerIndex >= 0 && /^(?: \d+)?$/.test(title.slice(markerIndex + marker.length))) title = title.slice(0,markerIndex);
    const titles = new Set(port.tabs().map(tab => tab.title));
    for (let count = 1; count <= titles.size + 1; count++) {
      const label = port.text(count === 1 ? 'common:workspace.copy_title' : 'common:workspace.copy_title_numbered', {
        base:title,count,defaultValue:`${title} · Copy${count > 1 ? ` ${count}` : ''}`
      });
      if (!titles.has(label)) return {key,title:label};
    }
    return {key,title: `${title}${marker} ${serial}`};
  }

  function duplicate(sourceKey: string, options: CopyOptions = {}) {
    const source = find(sourceKey), pane = port.pane(sourceKey);
    if (!source || !pane) return '';
    port.hideMenu();
    port.select(sourceKey,pane);
    const {key,title} = copyIdentity(source);
    const id = Number(source.id || 0);
    const kind = source.kind, terminal = kind === 'terminal' && id > 0;
    const finish = (opened: string, split = false) => {
      if (!opened && terminal) port.discardStartup(key);
      if (options.result) Object.assign(options.result, {key:opened,opened:Boolean(opened),split});
    };
    if (options.beforeOpen) options.beforeOpen(key);
    else if (terminal) port.copyStartup(sourceKey,key);
    if (!port.mobile() && splitZone(options.splitZone)) {
      // A new terminal can carry startup preferences, but must never adopt a live session's identity.
      const copy = terminal ? {key:source.key,kind:source.kind,id:source.id,viewName:source.viewName,
        subtitle:source.subtitle,closable:source.closable,sessionMode:source.sessionMode,sessionBackend:source.sessionBackend} : source;
      port.add(copy,key,title);
      const split = port.split(key,pane,options.splitZone);
      if (!split) port.activate(key);
      finish(key,split);
    } else if (terminal || kind === 'sftp') {
      port.defer(() => {
        if (find(sourceKey) !== source || source.kind !== kind || Number(source.id || 0) !== id || port.pane(sourceKey) !== pane) return finish('');
        if (terminal) finish(port.terminal(pane,id,key,title) || '');
        else void port.sftp(pane,sourceKey,key).then(() => finish(find(key) ? key : '')).catch(port.error);
      });
    } else if (source.kind === 'local-files') {
      void port.local(source.path || '',key,source.fileSource).then(finish).catch(port.error);
    } else {
      port.add(source,key,title);
      port.render(pane);
      finish(key);
    }
    return key;
  }

  function togglePin(key: string) {
    const tab = find(key);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    port.hideMenu();
    port.renderTabs();
    port.save();
  }
  return {duplicate,togglePin};
}

export function installWorkspaceTabCopy(port: TabCopyPort) {
  workspaceServices.termaWorkspaceTabCopy = createWorkspaceTabCopy(port);
}



export interface InstalledFeaturesWorkspaceWorkspaceTabCopyServices {
  termaWorkspaceTabCopy: ReturnType<typeof createWorkspaceTabCopy>;
}
