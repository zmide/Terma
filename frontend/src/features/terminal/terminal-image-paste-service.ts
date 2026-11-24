import {terminalServices} from '@/features/terminal/installed-services';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']
]);

type Translate = (key: string, params?: Record<string, unknown>) => string;
type ClipboardPayload = { ok?: boolean; reason?: string; error?: string; data?: unknown; byte_length?: number };
type ClipboardReader = () => Promise<ClipboardPayload>;
type ClipboardImageItem = Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>;
type ClipboardConnection = { id: number; x11_mode?: string };
type ClipboardSession = {
  connected?: boolean;
  effectiveX11Mode?: string;
  currentDirectoryKnown?: boolean;
  currentDirectory?: string;
};

export interface TerminalImagePastePort {
  key: string;
  session?: ClipboardSession;
  connection?: ClipboardConnection;
  isCurrent(): boolean;
  readImage(file?: File | null): Promise<File | null>;
  initializeDirectory(): Promise<string>;
  api(url: string, options: {
    method: string;
    headers: Record<string, string>;
    body: ArrayBuffer;
    skipSftpConnect: boolean;
  }): Promise<{ ready?: boolean }>;
  upload?: (files: { file: File; relativePath: string }[], connectionId: number, directory: string,
    options: { conflict: string; private: boolean; isCurrent?: () => boolean }) => Promise<unknown>;
  joinPath(directory: string, name: string): string;
  sendData(data: string): unknown;
  pasteText(text: string): Promise<unknown>;
  notify(message: string, type: 'info' | 'success' | 'error'): void;
  focus(): void;
  tr: Translate;
  imageFromPasteEvent(event: ClipboardEvent | null | undefined): File | null;
  mayContainImage(event: ClipboardEvent | null | undefined, imageFile: File | null,
    clipboardReaderAvailable: boolean): boolean;
}

export function imageFromPasteEvent(event: ClipboardEvent | null | undefined) {
  for (const item of Array.from(event?.clipboardData?.items || []) as ClipboardImageItem[]) {
    if (item.kind !== 'file' || !String(item.type || '').toLowerCase().startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function pasteEventMayContainImage(event: ClipboardEvent | null | undefined, imageFile: File | null,
  clipboardReaderAvailable: boolean) {
  if (imageFile) return true;
  const types = Array.from(event?.clipboardData?.types || [], type => String(type || '').toLowerCase());
  return types.some(type => type.startsWith('image/')) || clipboardReaderAvailable;
}

function imageFilename(extension: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
  const random = crypto.getRandomValues(new Uint8Array(4));
  const suffix = [...random].map(value => value.toString(16).padStart(2, '0')).join('');
  return `terma-clipboard-${stamp}-${suffix}.${extension}`;
}

function imageBytes(payload: ClipboardPayload, tr: Translate): Uint8Array {
  const source = payload.data;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (Array.isArray(source)) return Uint8Array.from(source);
  if (source && typeof source === 'object' && 'data' in source && Array.isArray(source.data)) {
    return Uint8Array.from(source.data);
  }
  throw new Error(tr('terminal:clipboard.imageInvalid', { defaultValue: '剪贴板图片数据无效' }));
}

export async function readTerminalImage(file: File | null, reader: ClipboardReader | undefined, tr: Translate) {
  if (file) {
    if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0) {
      throw new Error(tr('terminal:clipboard.imageEmpty', { defaultValue: '剪贴板中的图片为空' }));
    }
    if (Number(file.size) > MAX_IMAGE_BYTES) {
      throw new Error(tr('terminal:clipboard.imageTooLarge', { defaultValue: '剪贴板图片超过 25 MB，无法粘贴到远端终端' }));
    }
    const mime = String(file.type || '').toLowerCase();
    const extension = IMAGE_EXTENSIONS.get(mime);
    if (!extension) {
      throw new Error(tr('terminal:clipboard.imageUnsupported', { defaultValue: '剪贴板图片格式不受支持，请使用 PNG、JPEG、WebP 或 GIF' }));
    }
    return new File([file], imageFilename(extension), { type: mime, lastModified: Date.now() });
  }
  if (!reader) return null;
  const payload = await reader();
  if (!payload?.ok) {
    if (payload?.reason === 'empty') return null;
    throw new Error(payload?.error || tr('terminal:clipboard.imageReadFailed', { defaultValue: '无法读取剪贴板图片' }));
  }
  const bytes = imageBytes(payload, tr);
  if (!bytes.byteLength || bytes.byteLength !== Number(payload.byte_length || bytes.byteLength)) {
    throw new Error(tr('terminal:clipboard.imageInvalid', { defaultValue: '剪贴板图片数据无效' }));
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(tr('terminal:clipboard.imageTooLarge', { defaultValue: '剪贴板图片超过 25 MB，无法粘贴到远端终端' }));
  }
  return new File([new Uint8Array(bytes).buffer], imageFilename('png'), { type: 'image/png', lastModified: Date.now() });
}

async function writeDirect(port: TerminalImagePastePort, file: File) {
  if (String(file.type || '').toLowerCase() !== 'image/png') return false;
  const mode = String(port.session?.effectiveX11Mode || port.connection?.x11_mode || 'off').trim().toLowerCase();
  if (!['trusted', 'untrusted'].includes(mode) || typeof file.arrayBuffer !== 'function') return false;
  try {
    const body = await file.arrayBuffer();
    if (!port.isCurrent()) return false;
    const result = await port.api(`/api/connections/${encodeURIComponent(port.connection!.id)}/terminal-clipboard/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Terma-Terminal-X11-Mode': mode },
      body,
      skipSftpConnect: true
    });
    if (!port.isCurrent() || !result?.ready) return false;
    return port.sendData('\x16') !== false;
  } catch {
    return false;
  }
}

export async function pasteTerminalImage(port: TerminalImagePastePort, imageFile: File | null = null) {
  if (!port.session?.connected || !port.connection || !port.isCurrent()) {
    port.notify(port.tr('terminal:clipboard.notConnected', { defaultValue: '终端尚未连接，无法粘贴图片' }), 'error');
    return false;
  }
  try {
    const file = await port.readImage(imageFile);
    if (!port.isCurrent()) return false;
    if (!file) {
      port.notify(port.tr('terminal:clipboard.noImage', { defaultValue: '剪贴板中没有可粘贴的文本或图片' }), 'info');
      port.focus();
      return false;
    }
    const direct = await writeDirect(port, file);
    if (!port.isCurrent()) return false;
    if (direct) {
      port.notify(port.tr('terminal:clipboard.imageClipboardPasted', { defaultValue: '剪贴板图片已写入远端图形剪贴板' }), 'success');
      port.focus();
      return true;
    }
    if (!port.upload) throw new Error(port.tr('terminal:clipboard.uploadUnavailable', { defaultValue: '当前版本不支持把剪贴板图片上传到远端' }));
    const currentDirectory = port.session.currentDirectoryKnown
      ? port.session.currentDirectory : await port.initializeDirectory();
    if (!port.isCurrent()) return false;
    if (!currentDirectory) throw new Error(port.tr('terminal:clipboard.directoryUnknown', { defaultValue: '无法确认终端当前目录，请先重连终端' }));
    const directory = String(currentDirectory).startsWith('/') ? '/tmp' : currentDirectory;
    const uploaded = await port.upload([{ file, relativePath: file.name }], Number(port.connection.id), directory, { conflict: 'error', private: true, isCurrent: () => port.isCurrent() });
    if (uploaded === false) return false;
    if (!port.isCurrent()) return false;
    const pasted = await port.pasteText(port.joinPath(directory, file.name));
    if (!port.isCurrent() || pasted === false) return false;
    port.notify(port.tr('terminal:clipboard.imagePasted', { defaultValue: '剪贴板图片已上传并粘贴到终端' }), 'success');
    port.focus();
    return true;
  } catch (error) {
    if (!port.isCurrent()) return false;
    port.notify(error instanceof Error ? error.message : port.tr('terminal:clipboard.imagePasteFailed', { defaultValue: '粘贴剪贴板图片失败' }), 'error');
    port.focus();
    return false;
  }
}

export async function pasteTerminalCtrlV(port: TerminalImagePastePort, data = '\x16') {
  if (!port.isCurrent()) return false;
  try {
    const file = await port.readImage();
    if (!port.isCurrent()) return false;
    if (file) return pasteTerminalImage(port, file);
  } catch {
    // A non-image clipboard still follows the terminal's normal Ctrl+V path.
  }
  return port.isCurrent() ? port.sendData(data) : false;
}



export function installTerminalImagePasteService(createPort:(key:string,connectionId:number)=>TerminalImagePastePort) {
  const handleCtrlV = (key: string, connectionId = 0, data = '\x16') =>
    pasteTerminalCtrlV(createPort(key, connectionId), data);
  terminalServices.termaTerminalImagePaste = {
    handleCtrlV,
    interceptCtrlV(key, connectionId = 0, data = '\x16') {
      const desktop = window.termaDesktop as {readClipboardImage?: ClipboardReader} | undefined;
      if (data !== '\x16' || typeof desktop?.readClipboardImage !== 'function') return false;
      void handleCtrlV(key, connectionId, data).catch(() => {});
      return true;
    },
    async handleImage(key, connectionId = 0, image = null) {
      const port = createPort(key, connectionId);
      return pasteTerminalImage(port, image);
    },
    readImage: readTerminalImage,
    pasteImage: pasteTerminalImage,
    pasteCtrlV: pasteTerminalCtrlV,
    imageFromPasteEvent,
    mayContainImage: pasteEventMayContainImage
  };
}

export interface InstalledFeaturesTerminalTerminalImagePasteServiceServices {
  termaTerminalImagePaste?: {
      handleCtrlV(key: string, connectionId?: number, data?: string): Promise<unknown>;
      interceptCtrlV(key: string, connectionId?: number, data?: string): boolean;
      handleImage(key: string, connectionId?: number, image?: File | null): Promise<boolean>;
      readImage: typeof readTerminalImage;
      pasteImage: typeof pasteTerminalImage;
      pasteCtrlV: typeof pasteTerminalCtrlV;
      imageFromPasteEvent: typeof imageFromPasteEvent;
      mayContainImage: typeof pasteEventMayContainImage;
    };
}
