import {remoteServices} from '@/features/remote/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {createRemoteDesktopService, type RemoteDesktopPort} from './remote-desktop-service';
import {createRemoteDesktopPresentation} from './remote-desktop-presentation';
import {createRemoteWorkspaceScope} from './remote-workspace-scope';
import {createRemoteDesktopWorkspace, type DesktopWorkspaceHost} from './remote-desktop-workspace';
import {createRemoteProfileRelations} from './profile-relations';
import {remoteDesktopWorkspaceHost, remoteManagementHost, remoteProfileRelationsHost, remoteWorkspaceScopeHost} from './remote-host';

const port: RemoteDesktopPort = {
  tr: remoteManagementHost.tr,
  clientDiagnostics: () => remoteServices.termaRemoteClients.diagnostics(),
  inspect: (id, protocol, button) => (protocol === 'vnc'
    ? remoteServices.termaVncRuntime.management.inspect(id, button)
    : remoteServices.termaRemoteManagement.protocol.inspect(id, protocol, button)) as ReturnType<RemoteDesktopPort['inspect']>,
  inspectLinux: profile => remoteServices.termaRemoteManagement.inspectLinux(profile) as ReturnType<RemoteDesktopPort['inspectLinux']>,
  managementConnectionId: profile => remoteServices.termaRemoteManagement.connectionId(profile)
};

export function installRemoteDesktopRuntime() {
  const create = () => {
    const service = createRemoteDesktopService(port);
    const presentation = createRemoteDesktopPresentation(port.tr);
    const scope = createRemoteWorkspaceScope(remoteWorkspaceScopeHost);
    const relations = createRemoteProfileRelations({...remoteProfileRelationsHost,
      managementConnectionId: port.managementConnectionId});
    const workspace = createRemoteDesktopWorkspace({
      ...remoteDesktopWorkspaceHost, tr: port.tr, managementConnectionId: port.managementConnectionId,
      jumpActions: relations.workspaceActions, sharedVnc: relations.sharedVnc,
      manageLinuxDesktop: id => remoteServices.termaRemoteManagement.desktop.open(id),
      scope, prepare: service.prepare, status: presentation.status,
      diagnostics: () => remoteServices.termaRemoteManagement.diagnostics,
      render: (target, model) => remoteServices.termaRemoteViews?.renderDesktopLaunch(target, model),
      update: (target, state) => remoteServices.termaRemoteViews?.updateDesktopLaunch(target, state),
      release: target => remoteServices.termaRemoteViews?.release(target),
      session: key => remoteServices.termaVncRuntime.session.sessions.get(key),
      showManagement: (id, key) => remoteServices.termaVncRuntime.session.management(id, key),
      mountVnc: (profile, key) => remoteServices.termaVncRuntime.session.mount(profile, key),
      reserve: id => remoteServices.termaVncRuntime.windows.reserve(id),
      cancel: reservation => remoteServices.termaVncRuntime.windows.cancel(reservation),
      detach: (id, key, options) => remoteServices.termaVncRuntime.windows.open(id, key, options),
      openVnc: (id, key, button) => remoteServices.termaVncRuntime.session.open(id, key, button),
      launch: (...args) => remoteServices.termaRemoteClients.launch(...args),
      install: (...args) => remoteServices.termaRemoteClients.install(...args),
      closeVncSession: key => remoteServices.termaVncRuntime.close(key),
      setBusy: (button, busy, label) => sharedServices.termaUiActions.setButtonBusy(button, busy, label),
      notify: (message, kind) => efficiencyServices.termaNotificationToasts?.notify(message, kind),
      inspect: port.inspect,
      guide: (id, protocol) => remoteServices.termaRemoteManagement.setupGuide(id, protocol)
    });
    return {presentation, scope, workspace, relations, activeView:remoteDesktopWorkspaceHost.view};
  };
  let feature: ReturnType<typeof create> | undefined;
  const current = () => feature ||= create();
  remoteServices.termaRemoteDesktop = {
    open: (...args) => current().workspace.open(...args),
    captureVncOpen: (...args) => current().workspace.captureVncOpen(...args),
    activeView: () => current().activeView(),
    get presentation() { return current().presentation; },
    get scope() { return current().scope; },
    get relations() { return current().relations; },
    dispose: () => {
      feature = undefined;
    }
  };
  window.addEventListener('beforeunload', () => {
    feature = undefined;
  }, {once: true});
}



export interface InstalledFeaturesRemoteRemoteDesktopRuntimeServices {
  termaRemoteDesktop: {
      open: ReturnType<typeof createRemoteDesktopWorkspace>['open'];
      captureVncOpen: ReturnType<typeof createRemoteDesktopWorkspace>['captureVncOpen'];
      activeView(): ReturnType<DesktopWorkspaceHost['view']>;
      readonly presentation: ReturnType<typeof createRemoteDesktopPresentation>;
      readonly scope: ReturnType<typeof createRemoteWorkspaceScope>;
      readonly relations: ReturnType<typeof createRemoteProfileRelations>;
      dispose(): void;
    };
}
