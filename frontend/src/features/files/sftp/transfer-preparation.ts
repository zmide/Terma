import { normalizeDroppedPath } from './dropped-files';
import { joinRemotePath } from './directory-state';

export interface SftpDownloadSettings { delivery_mode?: string; effective_directory?: string }
interface NoticePort {
  remembered(key: string): boolean;
  remember(key: string): void;
  mobile(): boolean;
  text(key: string, values?: Record<string, string>): string;
  confirm(message: () => string, title: () => string, accept: () => string, cancel: () => string): Promise<boolean>;
}
interface TransferTab { key: string; kind: string; id?: number; path?: string }
interface TransferRuntime { state: { connectionId: number; path?: string } }
interface TargetPort { tabs(): readonly TransferTab[]; runtime(key: string): TransferRuntime | undefined }
interface DirectoryPort {
  isCurrent(): boolean;
  api(url: string, request: { method: string; body: string }): Promise<unknown>;
  invalidPath(): Error;
}

/** The confirmation and its acceptance belong to one delivery mode, across concurrent downloads. */
export function createSftpDownloadNotice() {
  const pending = new Map<string, Promise<boolean>>();
  function confirm(port: NoticePort, settings: SftpDownloadSettings) {
    const desktop = settings?.delivery_mode === 'desktop';
    const key = desktop ? 'sftpDesktopDownloadNoticeV1' : 'sftpBrowserDownloadNoticeV1';
    if (port.remembered(key)) return Promise.resolve(true);
    const existing = pending.get(key);
    if (existing) return existing;
    const directory = settings?.effective_directory;
    const request = Promise.resolve().then(async () => {
      const accepted = await port.confirm(
        () => desktop
          ? port.text('sftp:transfer.desktop_download_notice', { path: directory || port.text('sftp:settings.system_download_directory') })
          : port.text('sftp:transfer.browser_download_notice', { device: port.text(port.mobile() ? 'sftp:transfer.phone' : 'sftp:transfer.device') }),
        () => port.text('sftp:transfer.first_download_title'),
        () => port.text('sftp:transfer.continue_download'),
        () => port.text('common:actions.cancel'));
      if (accepted) port.remember(key);
      return accepted;
    });
    pending.set(key, request);
    const release = () => { if (pending.get(key) === request) pending.delete(key); };
    request.then(release, release);
    return request;
  }
  return { confirm };
}

/** A replaced tab/runtime must not receive work that was confirmed for its predecessor. */
export function captureSftpTransferTarget(port: TargetPort, key: string, connectionId: number, directory: string) {
  const tab = port.tabs().find(item => item.key === key);
  const runtime = port.runtime(key);
  return () => !key || Boolean(tab && port.tabs().includes(tab) && Number(tab.id) === Number(connectionId)
    && port.runtime(key) === runtime
    && (!runtime || (Number(runtime.state.connectionId) === Number(connectionId) && String(runtime.state.path || '.') === directory))
    && (runtime || tab.kind !== 'sftp' || String(tab.path || '.') === directory));
}

/** Resolve all relative paths before creating anything; visit each parent before its descendants. */
export async function prepareSftpUploadDirectories(port: DirectoryPort, connectionId: number, root: string,
  files: readonly { file: Pick<File, 'name'>; relativePath?: string }[], selectedDirectories: readonly string[] = []) {
  const directories = new Set<string>();
  if (!Number.isSafeInteger(connectionId) || !connectionId || String(root).includes('\0')) throw port.invalidPath();
  const append = (parts: string[]) => {
    let current = String(root || '.');
    for (const part of parts) {
      current = joinRemotePath(current, part);
      directories.add(current);
    }
  };
  try {
    for (const item of files) {
      const parts = normalizeDroppedPath(item.relativePath || '', item.file.name).split('/');
      parts.pop(); append(parts);
    }
    for (const relative of selectedDirectories) {
      const path = normalizeDroppedPath(relative, '');
      if (path) append(path.split('/'));
    }
  } catch { throw port.invalidPath(); }
  for (const path of directories) {
    if (!port.isCurrent()) return;
    await port.api(`/api/connections/${connectionId}/sftp/mkdir`, { method: 'POST', body: JSON.stringify({ path }) }).catch(error => {
      if (!/exist|存在/i.test(String(error?.message || ''))) throw error;
    });
  }
}
