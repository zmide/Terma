import type {ManagementOptions} from './RemoteManagementView';
import type {createRemoteWorkspaceScope} from './remote-workspace-scope';
import type {createRemoteComponentTaskService} from './component-task-service';
import type {createRemoteDiagnosticsView} from './remote-diagnostics-view';
import type {RemoteGuideProtocol} from './install-guide-service';
import type {ProtocolDiagnostics, ProtocolView} from './protocol-service';

type DiagnosticsElement = HTMLElement & {
  _rdpDiagnostics?: ProtocolDiagnostics;
  _xdmcpDiagnostics?: ProtocolDiagnostics;
  _vncDiagnostics?: ProtocolDiagnostics;
};

const states = {rdp: 'rdpServerState', xdmcp: 'xdmcpServerState', vnc: 'vncServerState'} as const;
const diagnosticsFields = {rdp: '_rdpDiagnostics', xdmcp: '_xdmcpDiagnostics', vnc: '_vncDiagnostics'} as const;

type ProtocolViewer = {
  target?: HTMLElement | null;
  initial?: ProtocolDiagnostics | null;
  render(container: HTMLElement | null, diagnostics: ProtocolDiagnostics): boolean;
};

interface ProtocolViewPort {
  element(id: string): HTMLElement | null;
  tabLifetime(key: string): () => boolean;
  scope: Pick<ReturnType<typeof createRemoteWorkspaceScope>, 'capture' | 'current'>;
  diagnostics: ReturnType<typeof createRemoteDiagnosticsView>;
  tasks: Pick<ReturnType<typeof createRemoteComponentTaskService>, 'watch' | 'requested'>;
  tr(key: string): string;
  paint(container: HTMLElement, options: ManagementOptions): void;
  taskHost(container: HTMLElement, active: boolean): void;
}

export function createRemoteProtocolView(port: ProtocolViewPort) {
  function capture(id: number, protocol: RemoteGuideProtocol, key: string, target: HTMLElement | null,
    viewerForKey?: (key: string) => ProtocolViewer | undefined): ProtocolView {
    const viewer = viewerForKey?.(key);
    const container: DiagnosticsElement | null = target || port.element(states[protocol]) || viewer?.target || null;
    const scope = port.scope.capture(id, key, container);
    const tabExists = port.tabLifetime(key);
    const initial = container?.[diagnosticsFields[protocol]] || viewer?.initial;
    let pending = false;
    const current = () => port.scope.current(scope) && tabExists() && (!container || container.isConnected);
    const render = (diagnostics: ProtocolDiagnostics) => {
      pending = false;
      if (!current() || viewer?.render(container, diagnostics)) return;
      if (container) port.diagnostics.render(container, protocol, diagnostics, id, key);
    };

    return {
      owner: container || scope, current, render,
      loading: () => { if (current() && container) port.diagnostics.loading(container, protocol); },
      pending(label) {
        if (!current() || !container) return;
        pending = true;
        port.taskHost(container, false);
        port.paint(container, {model: () => ({loading: label(), ...(protocol === 'vnc' ? {} : {
          notices: [{detail: port.tr('remote:xdmcp_setup.progress_wait_notice'), tone: 'info'}]
        })})});
      },
      finish() { if (pending && initial) render(initial); },
      async watch(result, title, done) {
        pending = false;
        if (!result.task) return false;
        const completion = port.tasks.watch(result.task, {container, scope, title, current: tabExists,
          onDone: (_, active) => active ? done(capture(id, protocol, key, active, viewerForKey)) : null});
        const accepted = port.tasks.requested(result, title);
        await completion;
        return accepted;
      }
    };
  }
  return capture;
}
