export interface AppDataSnapshot {
  connections: unknown;
  remoteProfiles: unknown[];
  forwardTemplates: unknown[];
  security: unknown;
}

export interface DataRefreshChanges {
  connectionsChanged: boolean;
  remoteProfilesChanged: boolean;
  forwardTemplatesChanged: boolean;
}

export interface DataRefreshOptions {
  silent?: boolean;
  forceRender?: boolean;
}

export interface DataRefreshPort {
  request: <T>(pathname: string) => Promise<T>;
  readCurrent: () => AppDataSnapshot;
  editingSettings?: () => boolean;
  commit: (snapshot: AppDataSnapshot) => void | Promise<void>;
  render: (changes: DataRefreshChanges, options: DataRefreshOptions & { renderUnchanged: boolean }) => void | Promise<void>;
}

export interface DataRefreshService {
  load(options?: DataRefreshOptions): Promise<void>;
  getSnapshot(): { inFlight: boolean; changedAt: number };
}

function changed(previous: unknown, next: unknown): boolean {
  if (previous === next) return false;
  try {
    return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
  } catch {
    return true;
  }
}

export function createDataRefreshService(port: DataRefreshPort): DataRefreshService {
  let inFlight = false;
  let changedAt = Date.now();

  return {
    async load(options = {}) {
      if (inFlight) return;
      inFlight = true;
      changedAt = Date.now();
      try {
        const current = port.readCurrent();
        const editingSettings = port.editingSettings?.() === true;
        const [connectionRows, remoteRows, templateRows, security] = await Promise.all([
          port.request<unknown>('/api/connections'),
          port.request<unknown[]>('/api/remote-profiles').catch(() => current.remoteProfiles),
          port.request<unknown[]>('/api/forward-templates').catch(() => current.forwardTemplates),
          editingSettings
            ? Promise.resolve(current.security)
            : port.request<unknown>('/api/security').catch(() => current.security)
        ]);
        const snapshot: AppDataSnapshot = {
          connections: connectionRows,
          remoteProfiles: remoteRows || [],
          forwardTemplates: templateRows || [],
          security
        };
        const changes: DataRefreshChanges = {
          connectionsChanged: changed(current.connections, snapshot.connections),
          remoteProfilesChanged: changed(current.remoteProfiles, snapshot.remoteProfiles),
          forwardTemplatesChanged: changed(current.forwardTemplates, snapshot.forwardTemplates)
        };
        const renderUnchanged = options.silent !== true || options.forceRender === true;
        await port.commit(snapshot);
        await port.render({ ...changes }, { ...options, renderUnchanged });
      } catch (error) {
        if (!options.silent) throw error;
      } finally {
        inFlight = false;
        changedAt = Date.now();
      }
    },
    getSnapshot() {
      return { inFlight, changedAt };
    }
  };
}

interface WorkspaceDataRefreshPort extends Omit<DataRefreshPort, 'render'> {
  primaryView(): string;
  activeView(): string;
  renderConnections(): void;
  renderWelcome(): void;
  renderRunning(): void;
  renderForwards(): void;
}

export function createWorkspaceDataRefresh(port: WorkspaceDataRefreshPort) {
  return createDataRefreshService({
    ...port,
    render({connectionsChanged, remoteProfilesChanged, forwardTemplatesChanged}, {renderUnchanged}) {
      const primary = port.primaryView();
      if (renderUnchanged || connectionsChanged || forwardTemplatesChanged) port.renderForwards();
      if (primary === 'connections' && (renderUnchanged || connectionsChanged)) port.renderConnections();
      else if (primary === 'remote' && (renderUnchanged || connectionsChanged || remoteProfilesChanged)) port.renderConnections();
      else if (primary === 'running' && (renderUnchanged || connectionsChanged)) port.renderRunning();
      if (port.activeView() === 'welcome') port.renderWelcome();
    }
  });
}
