import {workspaceServices} from '@/features/workspace/installed-services';
import type { createTerminalBroadcastService } from '../efficiency/terminal-broadcast-service';

export interface WorkspaceTab {
  [key:string]:unknown;
  resumePolicy?: string;
  key: string;
  kind?: string;
  id?: number;
  title?: string;
  subtitle?: string;
  viewName?: string;
  closable?: boolean;
  protocol?: string;
  path?: string;
  fileSource?: 'browser' | 'server';
  pinned?: boolean;
  activityState?: string;
  connectionStatus?: string;
  sessionMode?: string;
  sessionBackend?: string;
  persistentSessionId?: string;
  lastKnownCwd?: string;
  quick_connection?: boolean;
  transient?: boolean;
  logTitleSource?: string;
}

interface RenderOptions { fast?: boolean; paneId?: string }
interface RuntimePort {
  tabs(): WorkspaceTab[];
  tab(key: string): WorkspaceTab | null | undefined;
  terminal(id: number | undefined, key: string, title?: string): unknown;
  quickTerminal(tab: WorkspaceTab): unknown;
  forwards(id?: number): unknown;
  forwardManager(): unknown;
  edit(id?: number): unknown;
  importData(): unknown;
  log(path?: string, title?: string): unknown;
  command(): unknown;
  sftp(id: number | undefined, path: string, key: string, options?: RenderOptions): unknown;
  local(tab: WorkspaceTab): unknown;
  dashboard(id?: number): unknown;
  remoteEdit(id: number | undefined, protocol: string): unknown;
  remoteDesktop(id?: number): unknown;
  linuxDesktop(id: number): unknown;
  remoteTerminal(id: number | undefined, key: string, title?: string): unknown;
  ftp(id: number | undefined, path: string, key: string): unknown;
  settings(key: string): unknown;
  fallback(tab: WorkspaceTab): unknown;
  viewed(key: string): void;
  rememberClosed(keys: string[]): void;
  releaseLocal(key: string): void;
  releaseTerminal(key: string): void;
  releaseRemote(key: string): void;
  releaseSftp(key: string): void;
  releaseSftpCache(key: string): void;
  releaseLog(key: string): void;
  releaseCommand(key: string): void;
  broadcast(): ReturnType<typeof createTerminalBroadcastService> | undefined;
  stopBroadcast(): void;
  repaintBroadcast(): void;
  defer(callback: () => void): void;
}

const SSH_CONNECTION_TAB_KINDS = new Set(['terminal', 'sftp', 'forwards', 'dashboard', 'linux-desktop']);
const REMOTE_CONNECTION_TAB_KINDS = new Set(['remote-desktop', 'remote-terminal', 'ftp']);

function connectionKind(tab: WorkspaceTab) {
  if (!tab.kind) return undefined;
  if (SSH_CONNECTION_TAB_KINDS.has(tab.kind)) return 'ssh';
  if (REMOTE_CONNECTION_TAB_KINDS.has(tab.kind)) return 'remote';
  return undefined;
}

export function createWorkspaceTabRuntime(port: RuntimePort) {
  function render(tab: WorkspaceTab, options?: RenderOptions) {
    switch (tab.kind) {
      case 'terminal': return port.terminal(tab.id, tab.key, tab.title);
      case 'quick-terminal': return port.quickTerminal(tab);
      case 'forwards': return port.forwards(tab.id);
      case 'forward-manager': return port.forwardManager();
      case 'edit': return port.edit(tab.id);
      case 'import': return port.importData();
      case 'log': return port.log(tab.path, tab.title);
      case 'command': return port.command();
      case 'sftp': return port.sftp(tab.id, tab.path || '.', tab.key, options && { ...options, fast: Boolean(options.fast) });
      case 'local-files': return port.local(tab);
      case 'dashboard': return port.dashboard(tab.id);
      case 'remote-edit': return port.remoteEdit(tab.id, tab.protocol || 'rdp');
      case 'remote-desktop': return port.remoteDesktop(tab.id);
      case 'linux-desktop': return port.linuxDesktop(Number(tab.id || tab.key.match(/^linux-desktop-(\d+)$/)?.[1] || 0));
      case 'remote-terminal': return port.remoteTerminal(tab.id, tab.key, tab.title);
      case 'ftp': return port.ftp(tab.id, tab.path || '/', tab.key);
      case 'settings': return port.settings(tab.key);
      default: return port.fallback(tab);
    }
  }

  function activated(key: string) {
    port.viewed(key);
    const tab = port.tab(key);
    if (tab?.activityState) tab.activityState = '';
  }

  function closing(keys: readonly string[]) {
    const requested = new Set(keys);
    const targets = port.tabs().filter(tab => requested.has(tab.key) && !tab.pinned);
    if (targets.length) port.rememberClosed(targets.map(tab => tab.key));
    for (const tab of targets) if (tab.kind === 'local-files') port.releaseLocal(tab.key);
    return new Map(targets.map(tab => [tab.key, tab]));
  }

  function cleanup(tabs: ReadonlyMap<string, WorkspaceTab>, deferred = false) {
    const run = () => {
      for (const [key, tab] of tabs) {
        // Rendering the fallback may already have opened a fresh tab using the same key.
        if (deferred && port.tab(key)) continue;
        port.releaseTerminal(key);
        port.releaseRemote(key);
        if (tab.kind === 'sftp') port.releaseSftp(key);
        if (tab.kind === 'log') port.releaseLog(key);
        port.releaseSftpCache(key);
        if (tab.kind === 'command') port.releaseCommand(key);
      }
    };
    if (deferred) port.defer(run); else run();
  }

  function closed() {
    const service = port.broadcast();
    if (!service?.state.targets.size) return;
    const remaining = service.openTargets(port.tabs().filter(tab => tab.kind === 'terminal').map(tab => tab.key));
    if (remaining.length < 2) port.stopBroadcast();
    else if (remaining.length !== service.state.targets.size) {
      service.setTargets(remaining);
      port.repaintBroadcast();
    }
  }

  return { render, activated, closing, cleanup, closed, connectionKind };
}

export function installWorkspaceTabRuntime(port: RuntimePort) {
  workspaceServices.termaWorkspaceTabRuntime = createWorkspaceTabRuntime(port);
}



export interface InstalledFeaturesWorkspaceWorkspaceTabRuntimeServices {
  termaWorkspaceTabRuntime: ReturnType<typeof createWorkspaceTabRuntime>;
}
