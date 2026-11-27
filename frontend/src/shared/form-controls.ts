import {sharedServices} from '@/shared/installed-services';
import {tr,registerTermaI18nRenderer} from '@/shared/i18n/workspace-bootstrap';
import {settleNativeFileDialogViewport} from '@/shared/viewport-service';
import { render } from 'vue';
import { createPasswordVisibilityControl } from '../features/settings/SettingsPasswordField';

type FormRoot = ParentNode & { matches?: (selector: string) => boolean };
type Translate = (key: string, options?: Record<string, unknown>) => string;
interface FormControlsPort {
  document: Document;
  tr: Translate;
  settleFileDialog(): void;
}
const PASSWORD_SELECTOR = "input[type='password'], input[data-password-visibility-input]";
const OWNED_PASSWORD_SELECTOR = '[data-terma-settings-owned], [data-terma-settings-dialog], .terma-connections-root, [data-remote-admin-owned]';

export function filePickerPresentation(files: ArrayLike<File> | null, tr: Translate) {
  const count = files?.length || 0;
  const key = count ? undefined : 'common:auto.not_selected';
  const text = count > 1
    ? tr('common:local_files.selected_files', { count, defaultValue: `已选择 ${count} 个文件` })
    : count ? files![0].name : tr('common:auto.not_selected', { defaultValue: '未选择文件' });
  return { text, key, count: count > 1 ? String(count) : undefined, skip: count ? 'true' : undefined };
}

export function createFormControls(port: FormControlsPort) {
  const passwords = new Map<HTMLInputElement, { host: HTMLElement; button: ReturnType<typeof createPasswordVisibilityControl> }>();

  function releaseDisconnected() {
    for (const [input, mount] of passwords) {
      if (input.isConnected && mount.host.isConnected) continue;
      render(null, mount.host);
      mount.host.remove();
      delete input.dataset.passwordVisibilityInput;
      passwords.delete(input);
    }
  }

  function syncPassword(input: HTMLInputElement | null | undefined) {
    if (!input?.matches?.('input[data-password-visibility-input]')) return;
    const control = input.closest<HTMLElement>('.password-input-control');
    const mount = passwords.get(input);
    if (!control || !mount) return;
    render(mount.button(input.type === 'text', input.disabled,
      port.tr('common:auto.show_password', { defaultValue: '显示密码' }),
      port.tr('common:auto.hide_password', { defaultValue: '隐藏密码' })), mount.host);
    if (input.hidden) {
      control.hidden = true;
      control.dataset.hiddenByPasswordInput = 'true';
    } else if (control.dataset.hiddenByPasswordInput === 'true') {
      control.hidden = false;
      delete control.dataset.hiddenByPasswordInput;
    }
  }

  function enhancePasswords(root: FormRoot = port.document) {
    releaseDisconnected();
    const inputs = [...root.querySelectorAll<HTMLInputElement>(PASSWORD_SELECTOR)];
    if (root.matches?.(PASSWORD_SELECTOR)) inputs.unshift(root as HTMLInputElement);
    for (const input of inputs) {
      if (input.tagName !== 'INPUT' || input.closest(OWNED_PASSWORD_SELECTOR)) continue;
      if (!passwords.has(input)) {
        let control = input.closest<HTMLElement>('.password-input-control');
        if (control?.querySelector('.password-visibility-toggle[data-terma-button]')) continue;
        if (!control) {
          const focused = port.document.activeElement === input;
          const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection] as const;
          control = port.document.createElement('div');
          control.className = 'password-input-control';
          input.before(control);
          control.appendChild(input);
          if (focused) {
            input.focus({preventScroll:true});
            if (selection[0] !== null && selection[1] !== null) input.setSelectionRange(selection[0], selection[1], selection[2] || undefined);
          }
        }
        const host = port.document.createElement('span');
        host.className = 'terma-vue-root password-visibility-mount';
        host.style.display = 'contents';
        control.appendChild(host);
        const button = createPasswordVisibilityControl(() => input, visible => {
          input.type = visible ? 'text' : 'password';
          syncPassword(input);
        });
        passwords.set(input, { host, button });
        input.dataset.passwordVisibilityInput = 'true';
      }
      syncPassword(input);
    }
  }

  function updateFilePicker(input: HTMLInputElement | null | undefined) {
    const name = input?.closest('.file-picker')?.querySelector<HTMLElement>('.file-picker-name');
    if (name) {
      const state = filePickerPresentation(input!.files, port.tr);
      name.textContent = state.text;
      if (state.key) name.setAttribute('data-i18n', state.key);
      else name.removeAttribute('data-i18n');
      if (state.skip) name.setAttribute('data-i18n-skip', state.skip);
      else name.removeAttribute('data-i18n-skip');
      if (state.count) name.dataset.filePickerCount = state.count;
      else delete name.dataset.filePickerCount;
    }
    port.settleFileDialog();
  }

  function syncFilePickerLabels(root: FormRoot = port.document) {
    for (const name of root.querySelectorAll<HTMLElement>('.file-picker-name[data-file-picker-count]')) {
      const count = Number(name.dataset.filePickerCount);
      if (Number.isSafeInteger(count) && count > 1) {
        name.textContent = port.tr('common:local_files.selected_files', { count, defaultValue: `已选择 ${count} 个文件` });
      }
    }
  }

  function dispose() {
    for (const mount of passwords.values()) {
      render(null, mount.host);
      mount.host.remove();
    }
    for (const input of passwords.keys()) delete input.dataset.passwordVisibilityInput;
    passwords.clear();
  }

  return { enhancePasswords, syncPassword, updateFilePicker, syncFilePickerLabels, releaseDisconnected, dispose };
}

export function installFormControls() {
  if (sharedServices.termaFormControls) return;
  const service = createFormControls({
    document,
    tr: (key, options) => tr!(key, options),
    settleFileDialog: () => settleNativeFileDialogViewport?.()
  });
  sharedServices.termaFormControls = service;
  registerTermaI18nRenderer?.(() => {
    service.enhancePasswords();
    service.syncFilePickerLabels();
  });
  new MutationObserver(service.releaseDisconnected).observe(document.body, { childList: true, subtree: true });
}


export const syncPasswordVisibilityControl=(input:HTMLInputElement)=>sharedServices.termaFormControls?.syncPassword(input);
export const enhancePasswordInputs=(root:ParentNode=document)=>sharedServices.termaFormControls?.enhancePasswords(root);
export const updateFilePicker=(input:HTMLInputElement)=>sharedServices.termaFormControls?.updateFilePicker(input);
export const syncFilePickerLabels=(root:ParentNode=document)=>sharedServices.termaFormControls?.syncFilePickerLabels(root);

export interface InstalledSharedFormControlsServices {
  termaFormControls?: ReturnType<typeof createFormControls>;
}
