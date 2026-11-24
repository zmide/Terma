import type { Translate } from '../operations/operations-types';

const maximumImageBytes = 25 * 1024 * 1024;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface DesktopImage {
  ok?: boolean;
  reason?: string;
  error?: string;
  data?: unknown;
}

interface DesktopSnapshot {
  text_available?: boolean;
  text?: string;
  image_available?: boolean;
  image_revision?: string;
  image?: DesktopImage;
}

interface DesktopClipboard {
  readClipboardText?(): Promise<string>;
  writeClipboardText?(text: string): Promise<void>;
  readClipboardImage?(): Promise<DesktopImage>;
  writeClipboardImage?(bytes: Uint8Array): Promise<void>;
  readClipboardSnapshot?(options: { includeImage: boolean }): Promise<DesktopSnapshot>;
}

interface Port {
  tr: Translate;
  desktop(): DesktopClipboard | undefined;
  browser(): Clipboard | undefined;
  writeManualText(text: string): Promise<void>;
}

export interface VncClipboardSnapshot {
  textAvailable: boolean;
  text: string;
  imageAvailable: boolean;
  imageRevision: string;
  image: Uint8Array<ArrayBuffer> | null;
}

const dataField = (value: unknown) => value && typeof value === 'object' && 'data' in value ? value.data : undefined;
const findType = (item: ClipboardItem, match: (type: string) => boolean) => item.types.find(type => match(type.toLowerCase()));

export function createVncLocalClipboard(port: Port) {
  const t = port.tr;
  function imageBytes(value: unknown): Uint8Array<ArrayBuffer> {
    const source = dataField(value) ?? value;
    const array = Array.isArray(source) ? source : dataField(source);
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source)
      : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : Array.isArray(array) ? array : null;
    if (!bytes) throw new Error(t('remote:clipboard.image_invalid'));
    if (!bytes.length) throw new Error(t('remote:clipboard.image_empty'));
    if (bytes.length > maximumImageBytes) throw new Error(t('remote:clipboard.image_too_large'));
    if (!pngSignature.every((byte, index) => bytes[index] === byte)) throw new Error(t('remote:clipboard.image_not_png'));
    if (bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer) {
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return Uint8Array.from(bytes);
  }

  async function readText() {
    const desktop = port.desktop();
    if (desktop?.readClipboardText) return String(await desktop.readClipboardText());
    const clipboard = port.browser();
    if (!clipboard?.readText) throw new Error(t('remote:clipboard.browser_read_unsupported'));
    return String(await clipboard.readText());
  }

  async function writeText(text: string, manual = false) {
    const value = String(text ?? '');
    const desktop = port.desktop();
    if (desktop?.writeClipboardText) return desktop.writeClipboardText(value);
    if (manual) return port.writeManualText(value);
    const clipboard = port.browser();
    if (!clipboard?.writeText) throw new Error(t('remote:clipboard.browser_write_unsupported'));
    await clipboard.writeText(value);
  }

  async function readImage() {
    const desktop = port.desktop();
    if (desktop?.readClipboardImage) {
      const payload = await desktop.readClipboardImage();
      if (payload?.ok) return imageBytes(payload);
      if (payload?.reason === 'empty') return null;
      throw new Error(payload?.error || t('remote:clipboard.local_image_read_failed'));
    }
    const clipboard = port.browser();
    if (clipboard?.read) {
      for (const item of await clipboard.read()) {
        const type = findType(item, mime => mime === 'image/png');
        if (type) return imageBytes(await (await item.getType(type)).arrayBuffer());
      }
    }
    return null;
  }

  async function writeImage(value: unknown) {
    const bytes = imageBytes(value);
    const desktop = port.desktop();
    if (desktop?.writeClipboardImage) {
      await desktop.writeClipboardImage(bytes);
    } else {
      const clipboard = port.browser();
      if (!clipboard?.write || typeof ClipboardItem !== 'function') throw new Error(t('remote:clipboard.local_image_write_unsupported'));
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    }
    return true;
  }

  async function imageHash(value: unknown) {
    const bytes = imageBytes(value);
    if (!globalThis.crypto?.subtle) throw new Error(t('remote:clipboard.image_hash_unavailable'));
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function readSnapshot(includeImage = false): Promise<VncClipboardSnapshot> {
    const desktop = port.desktop();
    if (desktop?.readClipboardSnapshot) {
      const snapshot = await desktop.readClipboardSnapshot({ includeImage });
      const textAvailable = snapshot?.text_available === true;
      const imageAvailable = snapshot?.image_available === true;
      let image = null;
      if (includeImage && imageAvailable) {
        if (!snapshot.image?.ok) throw new Error(snapshot.image?.error || t('remote:clipboard.local_image_read_failed'));
        image = imageBytes(snapshot.image);
      }
      return { textAvailable, text: textAvailable ? String(snapshot.text ?? '') : '',
        imageAvailable, imageRevision: String(snapshot?.image_revision || ''), image };
    }
    const clipboard = port.browser();
    const snapshot: VncClipboardSnapshot = { textAvailable: false, text: '', imageAvailable: false, imageRevision: '', image: null };
    if (!clipboard?.read) return { ...snapshot, textAvailable: true, text: await readText() };
    for (const item of await clipboard.read()) {
      const imageType = findType(item, mime => mime === 'image/png');
      if (imageType) {
        snapshot.imageAvailable = true;
        if (includeImage && !snapshot.image) snapshot.image = imageBytes(await (await item.getType(imageType)).arrayBuffer());
      }
      const textType = findType(item, mime => mime.startsWith('text/plain'));
      if (textType && !snapshot.textAvailable) {
        snapshot.textAvailable = true;
        snapshot.text = await (await item.getType(textType)).text();
      }
    }
    return snapshot;
  }

  return { readText, writeText, readImage, writeImage, imageBytes, imageHash, readSnapshot };
}
