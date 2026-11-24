import { openFileLimit, type DecodedText } from './text-codec';
export interface OpenProgress {
  update(value: { progress?: number; detail?: string; paused?: boolean; pausable?: boolean; cancellable?: boolean }): void;
  complete(): void;
}
export interface FileOpenPort {
  tr(key: string, params?: Record<string, unknown>): string; formatBytes(value: number): string;
  ensure(id: number): Promise<unknown>; headers(id: number): Record<string, string>;
  fetch(url: string, options: RequestInit): Promise<Response>; responseError(response: Response): Promise<string>;
  progress(options: { title: string; detail: string; icon: string; onPauseChange(paused: boolean): void; onCancel(): void }): OpenProgress;
  worker(): Worker; preferredEncoding(id: number): string;
  settings(): { sftp_text_editor_mode?: string; sftp_light_editor_threshold_mb?: number };
}
interface OpenState { paused: boolean; cancelled: boolean; resume: (() => void) | null; cancelCurrent: (() => void) | null }
class IncompleteReadError extends Error {}
export function transportInterrupted(error: unknown) { return (error as Error)?.name === 'TypeError' || /network error|failed to fetch|load failed|terminated|远程文件读取不完整/i.test(String((error as Error)?.message || error || '')); }
export function textEditorKind(size: number, settings: ReturnType<FileOpenPort['settings']>) {
  const threshold = Number(settings.sftp_light_editor_threshold_mb || 10);
  return settings.sftp_text_editor_mode === 'light' || settings.sftp_text_editor_mode === 'auto' && size >= (Number.isFinite(threshold) ? Math.max(1, threshold) : 10) * 1024 * 1024 ? 'light' : 'ace';
}
export function previewImageType(path: string) { return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' } as Record<string, string>)[path.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream'; }
export function createFileOpenService(port: FileOpenPort) {
  const tr = port.tr, formatBytes = port.formatBytes;
  const cancelled = (state: OpenState, error?: unknown) => state.cancelled || (error as Error)?.name === 'AbortError';
  const interrupted = () => new Error(tr('sftp:editor.transfer_interrupted'));
  const wait = async (state: OpenState) => { if (state.paused && !state.cancelled) await new Promise<void>(resolve => { state.resume = resolve; }); };
  async function read(connectionId: number, remotePath: string) {
    if (!Number.isSafeInteger(connectionId) || !connectionId || !remotePath || remotePath.includes('\0')) throw new Error(tr('sftp:editor.remote_read_failed'));
    const state: OpenState = { paused: false, cancelled: false, resume: null, cancelCurrent: null }, controller = new AbortController();
    let received = 0, total = 0, limit = openFileLimit, lastProgressAt = 0;
    const progress = port.progress({ title: tr('sftp:editor.opening_file', { name: remotePath.split(/[\\/]/).pop() || tr('sftp:editor.remote_file') }), detail: tr('sftp:editor.preparing_remote_file'), icon: 'file-down',
      onPauseChange(paused) { state.paused = paused; if (!paused) { state.resume?.(); state.resume = null; } progress.update({ paused, detail: tr(paused ? 'sftp:editor.paused_progress' : 'sftp:editor.reading_progress', { received: formatBytes(received), total: formatBytes(total || limit) }) }); },
      onCancel() { state.cancelled = true; state.resume?.(); state.resume = null; controller.abort(); state.cancelCurrent?.(); }
    });
    let delivered = false;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          received = total = 0; await wait(state); if (state.cancelled) return null;
          if (await port.ensure(connectionId) === false || state.cancelled) return null;
          const response = await port.fetch(`/api/connections/${connectionId}/sftp/open?path=${encodeURIComponent(remotePath)}`, { signal: controller.signal, cache: 'no-store', headers: port.headers(connectionId) });
          if (!response.ok) throw new Error(await port.responseError(response));
          total = Number(response.headers.get('X-Terma-File-Size') || response.headers.get('Content-Length') || 0);
          const declaredLimit = Number(response.headers.get('X-Terma-File-Limit') || openFileLimit);
          if (!Number.isSafeInteger(declaredLimit) || declaredLimit <= 0 || !Number.isSafeInteger(total) || total < 0 || total > Math.min(declaredLimit, openFileLimit)) { await response.body?.cancel(); throw new Error(tr('sftp:editor.invalid_size_response')); }
          limit = Math.min(declaredLimit, openFileLimit);
          if (!response.body) throw new Error(tr('sftp:editor.streaming_unsupported'));
          const bytes = new Uint8Array(total); reader = response.body.getReader();
          while (true) {
            await wait(state); if (state.cancelled) return null;
            const { done, value } = await reader.read(); if (done) break;
            if (received + value.byteLength > total) throw new Error(tr('sftp:editor.content_exceeds_declared_size'));
            bytes.set(value, received); received += value.byteLength;
            const now = performance.now();
            if (now - lastProgressAt >= 80 || received === total) { lastProgressAt = now; progress.update({ progress: total ? received / total * 100 : 100, detail: tr('sftp:editor.reading_progress', { received: formatBytes(received), total: formatBytes(total) }) }); }
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          if (received !== total) throw new IncompleteReadError(tr('sftp:editor.read_incomplete', { received: formatBytes(received), total: formatBytes(total) }));
          progress.update({ progress: 100, detail: tr('sftp:editor.read_complete', { size: formatBytes(total) }) });
          delivered = true;
          return { bytes, size: total, limit, progress, state };
        } catch (error) {
          if (cancelled(state, error)) return null;
          if (!attempt && (transportInterrupted(error) || error instanceof IncompleteReadError)) {
            progress.update({ progress: NaN, detail: tr('sftp:editor.retrying_transfer'), pausable: true });
            await new Promise<void>(resolve => { const timer = setTimeout(done, 350); function done() { controller.signal.removeEventListener('abort', done); clearTimeout(timer); resolve(); } controller.signal.addEventListener('abort', done, { once: true }); if (state.cancelled) done(); }); continue;
          }
          throw transportInterrupted(error) ? interrupted() : error;
        } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      }
      throw interrupted();
    } finally { if (!delivered) progress.complete(); }
  }
  function decode(bytes: Uint8Array<ArrayBuffer>, encoding: string, progress: OpenProgress, state: OpenState) {
    progress.update({ progress: NaN, detail: tr('sftp:editor.parsing_encoding'), pausable: false, cancellable: true });
    return new Promise<DecodedText>((resolve, reject) => {
      const worker = port.worker(); let settled = false;
      const finish = (value: DecodedText | Error) => { if (settled) return; settled = true; clearTimeout(timer); state.cancelCurrent = null; worker.terminate(); if (value instanceof Error) reject(value); else resolve(value); };
      const timer = setTimeout(() => finish(new Error(tr('sftp:editor.parse_timeout'))), 120000);
      state.cancelCurrent = () => finish(new DOMException(tr('sftp:editor.open_aborted'), 'AbortError'));
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        const data = event.data as Partial<DecodedText> & { error_code?: string };
        if (data?.ok && typeof data.content === 'string' && typeof data.encoding === 'string' && Number.isSafeInteger(data.line_count) && ['lf', 'crlf', 'cr'].includes(data.line_ending || '')) finish(data as DecodedText);
        else finish(new Error(tr(`sftp:editor.${data?.error_code === 'binary_content' ? 'binary_content' : data?.error_code === 'unsupported_encoding' ? 'unsupported_encoding' : 'parse_failed'}`)));
      }, { once: true });
      worker.addEventListener('error', () => finish(new Error(tr('sftp:editor.parse_failed'))), { once: true });
      if (state.cancelled) { state.cancelCurrent(); return; }
      try { worker.postMessage({ buffer: bytes.buffer, encoding }, [bytes.buffer]); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async function text(id: number, path: string, encoding = '') {
    const opened = await read(id, path); if (!opened) return null;
    let delivered = false;
    try {
      const preferred = port.preferredEncoding(id) || 'auto';
      const decoded = await decode(opened.bytes, encoding || preferred, opened.progress, opened.state); if (opened.state.cancelled) return null;
      const editorKind = textEditorKind(opened.size, port.settings());
      opened.progress.update({ progress: NaN, detail: tr(editorKind === 'light' ? 'sftp:editor.parse_light' : 'sftp:editor.parse_ace'), pausable: false, cancellable: true });
      delivered = true;
      return { ...decoded, editor_kind: editorKind, preferred_encoding: preferred, size: opened.size, limit: opened.limit, progress: opened.progress, is_cancelled: () => opened.state.cancelled };
    } catch (error) {
      if (cancelled(opened.state, error)) return null;
      throw error;
    } finally { if (!delivered) opened.progress.complete(); }
  }
  async function image(id: number, path: string, onRead?: (progress: OpenProgress) => void) {
    const opened = await read(id, path); if (!opened) return null;
    const blob = new Blob([opened.bytes], { type: previewImageType(path) });
    if (onRead) {
      opened.progress.update({ progress: NaN, detail: tr('sftp:editor.read_complete', { size: formatBytes(opened.size) }), pausable: false, cancellable: false });
      onRead(opened.progress);
    } else opened.progress.complete();
    return blob;
  }
  return { read, decode, text, image };
}


export interface InstalledFeaturesFilesSftpFileOpenServiceServices {
  termaFileOpen: ReturnType<typeof createFileOpenService>
}
