import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {api} from '@/shared/api/workspace-request';
import {localizedTermaUiPhrase} from '@/shared/i18n/ui-phrase';
import {refreshIcons} from '@/shared/ui/icon-service';
import type {RemoteComponentTaskPort, RemoteComponentTask} from './component-task-service';
import type {RemoteGuideProtocol} from './install-guide-service';
import type {ManagementAction} from './RemoteManagementView';

export const remoteServerActionKey = (id: number, protocol: RemoteGuideProtocol) => `${protocol}-server:${Number(id || 0)}`;
export const linuxDesktopActionKey = (id: number) => `linux-desktop:${Number(id || 0)}`;

export function managementAction(id: string, label: string, icon: string, run: ManagementAction['run'], actionKey = '', className = ''): ManagementAction {
  return {id, label, icon, run, actionKey: actionKey || undefined, className,
    disabled: Boolean(actionKey && sharedServices.termaUiActions.isInFlight(actionKey))};
}

export function setRemoteComponentTaskHost(container: HTMLElement, active: boolean) {
  container.classList.toggle('remote-component-task-host', active);
}

export function remoteWorkspaceQuery(container: HTMLElement, selector: string, fallbackId = ''): HTMLElement | null {
  return container.closest('.workspace-pane')?.querySelector<HTMLElement>(selector)
    || (fallbackId ? document.getElementById(fallbackId) : null);
}

export function syncRemoteAction(key: string) {
  const actions = sharedServices.termaUiActions;
  actions.syncControls(key, actions.isInFlight(key));
}

export interface RemoteManagementTaskNavigation {
  open(event?: {target?: EventTarget | null; preventDefault?(): void; stopPropagation?(): void}): Promise<void>;
  refresh(): Promise<unknown>;
}

export function createRemoteComponentTaskPort(tr: RemoteComponentTaskPort['tr'], notify: RemoteComponentTaskPort['notify'], taskCenter: RemoteManagementTaskNavigation): RemoteComponentTaskPort {
  const scope = remoteServices.termaRemoteDesktop.scope;
  return {
    tr, notify,
    localize: value => localizedTermaUiPhrase(value),
    hasTranslation: key => Boolean(window.i18next?.exists(key)),
    language: () => sharedServices.termaI18nRuntime!.getLanguage(),
    publicError: (error, raw) => sharedServices.termaPublicErrors.message(error, raw),
    action: managementAction,
    openTaskCenter: (_button, event) => { void taskCenter.open(event); },
    now: Date.now,
    read: id => api(`/api/remote-component/tasks/${encodeURIComponent(id)}`),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    unschedule: timer => window.clearTimeout(Number(timer)),
    scopeMatches: scope.current,
    container: scope.resolve,
    render(container, model) {
      setRemoteComponentTaskHost(container, true);
      remoteServices.termaRemoteViews?.renderManagement(container, {model});
      refreshIcons();
    },
    refreshJobs: () => { void taskCenter.refresh(); },
    reportSubscriberError: () => console.warn('Remote component task subscriber failed')
  };
}
