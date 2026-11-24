export type SftpDownloadProgress = (percent: number, loaded: number) => void;
export interface SftpDownloadMessages { failed(): string; connectionFailed(): string }
export interface SftpDownloadPlatform {
  createRequest(): XMLHttpRequest;
  readError(response: Blob): Promise<string>;
  save(response: Blob, filename: string): void;
}

export function sftpDownloadFilename(disposition: string, fallbackName: string) {
  const extended = disposition.match(/(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  if (extended) {
    const value = (extended[1] ?? extended[2] ?? '').trim();
    const encoded = value.match(/^([^']*)'[^']*'(.*)$/);
    if (encoded?.[1] && /^utf-8$/i.test(encoded[1])) {
      try { return decodeURIComponent(encoded[2]); } catch { /* Fall back to the plain filename. */ }
    }
  }
  const plain = disposition.match(/(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/i);
  if (!plain) return fallbackName;
  return (plain[1] ?? plain[2] ?? '').trim().replace(/\\(["\\])/g, '$1') || fallbackName;
}

export function createSftpDownloadTransport(platform: SftpDownloadPlatform) {
  function download(messages: SftpDownloadMessages, url: string, onProgress: SftpDownloadProgress, fallbackName = 'download') {
    return new Promise<void>((resolve, reject) => {
      const xhr = platform.createRequest();
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };
      const fail = (error: unknown) => finish(() => reject(error));
      try {
        xhr.open('GET', url);
        xhr.responseType = 'blob';
        xhr.onprogress = event => {
          try {
            if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)), event.loaded);
            else onProgress(-1, event.loaded || 0);
          } catch (error) { fail(error); }
        };
        xhr.onload = async () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            const fallback = xhr.statusText || messages.failed();
            try {
              const body = JSON.parse(await platform.readError(xhr.response as Blob)) as { error?: unknown };
              fail(new Error(typeof body?.error === 'string' && body.error ? body.error : fallback));
            } catch {
              fail(new Error(fallback));
            }
            return;
          }
          try {
            const filename = sftpDownloadFilename(xhr.getResponseHeader('Content-Disposition') || '', fallbackName);
            platform.save(xhr.response as Blob, filename);
            finish(resolve);
          } catch (error) { fail(error); }
        };
        xhr.onerror = () => fail(new Error(messages.connectionFailed()));
        xhr.send();
      } catch (error) { fail(error); }
    });
  }
  return { download };
}

function readBlobText(response: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read response'));
    reader.readAsText(response);
  });
}

export interface SftpDownloadLink {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface SftpDownloadSavePlatform {
  createLink(): SftpDownloadLink;
  createObjectURL(response: Blob): string;
  revokeObjectURL(url: string): void;
  append(link: SftpDownloadLink): void;
  defer(callback: () => void, delay: number): unknown;
}

export function saveSftpDownloadBlob(response: Blob, filename: string, platform: SftpDownloadSavePlatform) {
  const link = platform.createLink();
  const url = platform.createObjectURL(response);
  link.href = url;
  link.download = filename;
  try {
    platform.append(link);
    link.click();
  } catch (error) {
    platform.revokeObjectURL(url);
    link.remove();
    throw error;
  }
  const cleanup = () => {
    platform.revokeObjectURL(url);
    link.remove();
  };
  try { platform.defer(cleanup, 1000); } catch { cleanup(); }
}

export function saveSftpBrowserBlob(response: Blob, filename: string) {
  saveSftpDownloadBlob(response, filename, {
    createLink: () => document.createElement('a'),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    append: link => document.body.appendChild(link as HTMLAnchorElement),
    defer: (callback, delay) => setTimeout(callback, delay)
  });
}
