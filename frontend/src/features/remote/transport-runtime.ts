import {terminalServices} from '@/features/terminal/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {normalizeTermaLanguage} from '@/shared/i18n/ui-phrase';
import {createTerminalLogId} from '@/features/terminal/terminal-identity';
import {terminalLibraries} from '../terminal/terminal-libraries';
import { createFtpService, type FtpPort } from './ftp-service';
import { createRemoteTerminalService, type RemoteEngine, type RemoteSocket, type RemoteTerminalPort } from './terminal-service';
import { ftpDialogs, paintFtpWorkspace, paintTerminalWorkspace } from './transport-view-runtime';
import { authenticationFailure, type RemoteProfile } from './profile-model';
import { remoteFtpHost, remoteTerminalHost } from './remote-host';

type FtpHost = Pick<FtpPort, 'profile' | 'unlocked' | 'tr' | 'api' | 'repair' | 'workspace' | 'persist' | 'notify'> & {
  localize(message: string): string;
  formatBytes(value: number): string;
};
type TerminalHost = Omit<RemoteTerminalPort, 'paint' | 'release' | 'retained'> & {
  localize(message: string): string;
  endpoint(profile: RemoteProfile): string;
  edit(id: number): void;
};

const terminalTheme = () => terminalServices.termaTerminalSettingsModel?.theme(terminalServices.termaTerminalSettings?.current());
const terminalHost: TerminalHost = {
  ...remoteTerminalHost,
  load: () => terminalLibraries.ensure(),
  engine(profile, key) {
    const term = terminalLibraries.terminal({cursorBlink: true, convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: Number(localStorage.getItem('terminalFontSize') || 13), theme: terminalTheme()});
    const fit = terminalLibraries.fit();
    term.loadAddon(fit);
    return {key, profile, term, fit, socket: null, connected: false, logId: createTerminalLogId(), resizeObserver: null};
  },
  socket(profile, session) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const language = normalizeTermaLanguage(document.documentElement.lang || 'zh-CN');
    const title = encodeURIComponent(profile.name || '');
    return new WebSocket(`${scheme}://${location.host}/ws/remote-terminal?id=${profile.id}&cols=${session.term.cols || 80}&rows=${session.term.rows || 24}&title=${title}&log_id=${session.logId}&language=${encodeURIComponent(language)}`) as RemoteSocket;
  },
  observe(mount, resize) {
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    return observer;
  },
  theme: terminalTheme
};

async function uploadFtp(port: FtpHost, id: number, path: string, file: File, signal: AbortSignal) {
  const body = new FormData();
  body.append('path', path);
  body.append('file', file, file.name);
  const response = await fetch(`/api/remote-profiles/${id}/ftp/upload`, {method: 'POST', body, signal});
  if (!response.ok) {
    const error = await sharedServices.termaPublicErrors.fromResponse(response, port.tr('sftp:ftp.upload.failed_item', {name: file.name}));
    error.remoteProfileId ||= id;
    throw error;
  }
  return response.json().catch(() => ({}));
}

function downloadFtp(id: number, path: string, name: string) {
  const link = document.createElement('a');
  link.href = `/api/remote-profiles/${id}/ftp/download?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  link.download = name;
  link.click();
}

function ftpService(host: FtpHost) {
  const service = createFtpService({
    ...host, ...ftpDialogs(host),
    authenticationFailure: error => authenticationFailure(error, 'ftp'),
    upload: (...args) => uploadFtp(host, ...args), download: downloadFtp,
    paint: state => paintFtpWorkspace(state, service, host),
    release: state => {
      if (state.view?.dataset.ftpTabKey === state.key) remoteServices.termaRemoteViews?.release(state.view);
    },
    resetUpload: state => {
      if (state.view?.dataset.ftpTabKey !== state.key) return;
      const input = state.view.querySelector<HTMLInputElement>('[data-ftp-upload]');
      if (input) input.value = '';
    }
  });
  return service;
}

function terminalService(host: TerminalHost) {
  const service = createRemoteTerminalService({
    ...host,
    retained: view => Boolean(workspaceServices.termaWorkspaceViews?.retains(view)),
    paint: (key, state) => paintTerminalWorkspace(key, state, service, host),
    release: (key, state) => {
      if (state.view?.dataset.remoteTerminalKey === key) remoteServices.termaRemoteViews?.release(state.view);
    }
  });
  return service;
}

export function installRemoteTransport() {
  let ftp: ReturnType<typeof ftpService> | undefined;
  let terminal: ReturnType<typeof terminalService> | undefined;
  const close = (key: string) => { ftp?.close(key); terminal?.close(key); };
  remoteServices.termaRemoteTransport = {
    get ftp() { return ftp ||= ftpService(remoteFtpHost); },
    get terminal() { return terminal ||= terminalService(terminalHost); },
    close,
    releaseWorkspace(key) { remoteServices.termaVncRuntime?.close(key); close(key); },
    socketStatus(key) { return terminal?.sessions.get(key)?.socket?.readyState; }
  };
  const refresh = () => { ftp?.refresh(); terminal?.refresh(); };
  window.addEventListener('terma:language-changed', refresh);
  const theme = new MutationObserver(() => { terminal?.theme(); refresh(); });
  theme.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  window.addEventListener('beforeunload', () => {
    theme.disconnect();
    window.removeEventListener('terma:language-changed', refresh);
    ftp?.dispose(); terminal?.dispose();
  }, {once: true});
}



export interface InstalledFeaturesRemoteTransportRuntimeServices {
  termaRemoteTransport: {
      readonly ftp: ReturnType<typeof ftpService>;
      readonly terminal: ReturnType<typeof terminalService>;
      close(key: string): void;
      releaseWorkspace(key: string): void;
      socketStatus(key: string): number | undefined;
    };
}
