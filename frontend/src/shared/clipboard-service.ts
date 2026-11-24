import {sharedServices} from '@/shared/installed-services';
type ClipboardWriter = (text: string) => Promise<unknown>;

export interface ClipboardPort {
  nativeWriter(): ClipboardWriter | null;
  browserWriter(): ClipboardWriter | null;
  document(): Document;
  text(key: string): string;
  notify(message: string, kind: 'success' | 'error'): void;
}

export function createClipboardService(port: ClipboardPort) {
  async function write(text: unknown): Promise<void> {
    const value = String(text ?? '');
    const native = port.nativeWriter();
    if (native) {
      await native(value);
      return;
    }
    const browser = port.browserWriter();
    if (browser) {
      try {
        await browser(value);
        return;
      } catch {
        // An insecure or denied browser clipboard may still support user-gesture copy.
      }
    }
    const doc = port.document();
    const field = doc.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    let copied = false;
    try {
      doc.body.appendChild(field);
      field.select();
      field.setSelectionRange(0, field.value.length);
      copied = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      field.remove();
    }
    if (!copied) throw new Error(port.text('common:notifications.copy_unsupported'));
  }

  async function copy(text: unknown): Promise<boolean> {
    try {
      await write(text);
      port.notify(port.text('common:notifications.copied'), 'success');
      return true;
    } catch (error) {
      const message = (error as {message?: string} | null)?.message || port.text('common:notifications.copy_fallback');
      port.notify(message, 'error');
      return false;
    }
  }
  return {write, copy};
}

export function installClipboardService(port:ClipboardPort) {
  if (!sharedServices.termaClipboard) {
    sharedServices.termaClipboard = createClipboardService(port);
  }
}




export const writeClipboardText=(text:string)=>sharedServices.termaClipboard.write(text);
export const copyText=(text:string)=>sharedServices.termaClipboard.copy(text);

export interface InstalledSharedClipboardServiceServices {
  termaClipboard: ReturnType<typeof createClipboardService>;
}
