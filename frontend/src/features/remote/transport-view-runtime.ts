import {remoteServices} from '@/features/remote/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import type { FtpState, createFtpService } from './ftp-service';
import type { RemoteTerminalState, createRemoteTerminalService } from './terminal-service';
import type { RemoteFtpLabels } from './RemoteFtpView';
import type { RemoteProfile } from './profile-model';

interface TextPort {
  tr(key: string, params?: Record<string, unknown>): string;
  localize(message: string): string;
}

const ftpText = (port: TextPort, key: string, params?: Record<string, unknown>) => port.tr(`sftp:ftp.${key}`, params);

export function ftpLabels(port: TextPort): RemoteFtpLabels {
  const t = (key: string) => ftpText(port, key);
  return {
    parent: t('toolbar.parent'), path: t('toolbar.path'), refresh: t('toolbar.refresh'),
    create: t('toolbar.create_directory'), upload: t('toolbar.upload_file'), retry: t('error.retry'),
    emptyTitle: t('empty.title'), emptyDetail: t('empty.detail'), loadingTitle: t('loading.title'),
    loadingDetail: t('loading.detail'), errorTitle: t('error.title'), name: t('table.name'),
    size: t('table.size'), modified: t('table.modified'), actions: t('table.actions'), open: t('entry.open'),
    download: t('entry.download'), rename: t('entry.rename'), remove: t('entry.delete'),
    confirm: port.tr('common:auto.confirm'), cancel: port.tr('common:actions.cancel'),
    createTitle: t('create.title'), createLabel: t('create.label'), renameTitle: t('dialogs.rename'),
    renameLabel: t('dialogs.new_name'), deleteTitle: t('delete.title'), deleteAction: t('delete.action'), deleteCancel: t('delete.cancel'),
    deleteMessage: (name, type) => ftpText(port, 'delete.confirm', {name, suffix: type === 'directory' ? t('delete.with_contents') : ''})
  };
}

export function ftpDialogs(port: TextPort) {
  return {
    input(intent: 'create' | 'rename', name: string, ownerSignal: AbortSignal) {
      const labels = ftpLabels(port);
      return remoteServices.termaRemoteViews?.promptInput({intent, defaultValue: name, ownerSignal,
        title: intent === 'create' ? labels.createTitle : labels.renameTitle,
        label: intent === 'create' ? labels.createLabel : labels.renameLabel,
        confirmText: labels.confirm, cancelText: labels.cancel}) ?? Promise.resolve('');
    },
    confirm(name: string, type: string, ownerSignal: AbortSignal) {
      const labels = ftpLabels(port);
      return remoteServices.termaRemoteViews?.confirm({intent: 'delete', name, suffix: type, ownerSignal,
        title: labels.deleteTitle, message: labels.deleteMessage(name, type), confirmText: labels.deleteAction,
        cancelText: labels.deleteCancel, danger: true}) ?? Promise.resolve(false);
    }
  };
}

function attached(view: HTMLElement) {
  return view.isConnected || Boolean(workspaceServices.termaWorkspaceViews?.retains(view));
}

export function paintFtpWorkspace(state: FtpState, service: ReturnType<typeof createFtpService>,
  port: TextPort & { formatBytes(value: number): string; notify(message: string, kind: 'error'): void }) {
  const { key, view } = state;
  if (!view || view.dataset.ftpTabKey !== key || !attached(view)) return;
  const active = () => service.states.get(key) === state && state.view === view &&
    view.dataset.ftpTabKey === key && view.isConnected && view.checkVisibility?.() !== false;
  const run = (action: () => Promise<unknown>) => {
    if (!active()) return;
    void action().catch(error => {
      if (active()) port.notify(port.localize(error instanceof Error ? error.message : String(error)), 'error');
    });
  };
  remoteServices.termaRemoteViews?.renderFtp(view, {
    model: {key, path: state.path, pathDraft: state.pathDraft, entries: state.entries,
      loading: state.loading, busy: state.busy, error: state.error && port.localize(state.error)},
    labels: ftpLabels(port), formatBytes: port.formatBytes,
    actions: {
      pathDraft: value => { if (active()) service.draft(key, value); },
      navigate: path => run(() => service.load(key, path)),
      parent: () => run(() => service.parent(key)),
      refresh: () => run(() => service.load(key, null, true)),
      create: () => run(() => service.mutate(key, 'create')),
      upload: files => run(() => service.mutate(key, 'upload', '', '', Array.from(files || []))),
      open: entry => run(() => service.openDirectory(key, entry.name)),
      download: entry => run(() => service.download(key, entry.name)),
      rename: entry => run(() => service.mutate(key, 'rename', entry.name)),
      remove: entry => run(() => service.mutate(key, 'delete', entry.name, entry.type))
    }
  });
}

export function paintTerminalWorkspace(key: string, state: RemoteTerminalState,
  service: ReturnType<typeof createRemoteTerminalService>,
  port: TextPort & { endpoint(profile: RemoteProfile): string; edit(id: number): void }) {
  const { view } = state;
  if (!view || view.dataset.remoteTerminalKey !== key || !attached(view)) return;
  const active = () => service.views.get(key) === state && state.view === view &&
    view.dataset.remoteTerminalKey === key && view.isConnected && view.checkVisibility?.() !== false;
  const t = port.tr;
  const status = {connected: 'connected', connecting: 'connecting', error: 'connection_error', disconnected: 'disconnected_reconnect'}[state.status];
  remoteServices.termaRemoteViews?.renderTerminal(view, {
    key, status: state.status, statusText: t(`remote:terminal.${status}`, {endpoint: port.endpoint(state.profile)}),
    draft: state.draft, error: state.error && port.localize(state.error),
    labels: {reconnect: t('terminal:toolbar.reconnect'), reconnectShort: t('terminal:toolbar.reconnect_short'),
      settings: t('remote:actions.connection_settings'), send: t('remote:terminal.send'),
      input: t('remote:terminal.input_placeholder'), loadFailed: t('terminal:components.load_failed')},
    reconnect: () => { if (active()) service.reconnect(Number(state.profile.id), key); },
    settings: () => { if (active()) port.edit(Number(state.profile.id)); },
    draftChange: value => { if (active()) service.draft(key, value); },
    send: () => { if (active()) service.send(key); }
  });
}
