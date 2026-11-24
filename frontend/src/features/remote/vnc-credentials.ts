import type {VncCredentialDialogOptions, VncCredentialLabels} from './RemoteDesktopViews';
import type {RemoteProfile} from './profile-model';
import type {VncCredentialResult, VncSession, VncSessionPort} from './vnc-types';

type LiveText = string | (() => string);
export interface VncCredentialRequest {
  owner?: VncSession;
  title?: LiveText;
  failureReason?: LiveText;
  submitLabel?: LiveText;
  noPasswordLabel?: LiveText;
  passwordStorageHint?: LiveText;
  updateByDefault?: boolean;
  allowNoPassword?: boolean;
}

export type VncCredentialPromptOptions = Omit<VncCredentialDialogOptions, 'labels' | 'submit' | 'cancel'> & {
  labels(): VncCredentialLabels;
};

interface VncCredentialPort extends Pick<VncSessionPort, 'tr' | 'notify'> {
  show(state: VncCredentialPromptOptions, owner?: VncSession): Promise<VncCredentialResult | null>;
  refresh(state: VncCredentialPromptOptions): void;
}

export function createVncCredentialPrompt(port: VncCredentialPort) {
  const text = (value: LiveText | undefined) => typeof value === 'function' ? value() : value;
  const t = (key: string, params?: Record<string, unknown>) => port.tr(`remote:vnc_ui.${key}`, params);
  return (profile: RemoteProfile, types: readonly string[] = [], options: VncCredentialRequest = {}) => {
    const state: VncCredentialPromptOptions = {
      title: () => text(options.title) || t('connect_named', {name: profile.name}),
      get failureReason() {return text(options.failureReason) || '';},
      username: types.includes('username') ? profile.username || '' : null,
      target: types.includes('target') ? '' : null,
      password: '',
      allowNoPassword: false,
      noPasswordAvailable: options.allowNoPassword === true,
      savePassword: Boolean(options.updateByDefault),
      busy: false,
      labels: () => ({
        username: t('username'), target: t('target_session'), password: t('vnc_password'),
        allowNoPassword: text(options.noPasswordLabel) || t('allow_no_password'), noPasswordWarning: t('no_password_warning'),
        savePassword: t(profile.has_password ? 'update_saved_password' : 'save_password'),
        updatePassword: t('update_saved_password'), passwordStorageHint: text(options.passwordStorageHint) || t('password_storage_hint'),
        cancel: t('cancel'), connect: text(options.submitLabel) || t('connect')
      }),
      change(field, value) {state[field] = value;},
      toggleNoPassword(value) {
        if (!state.noPasswordAvailable) return;
        state.allowNoPassword = value;
        if (value) {state.password = ''; state.savePassword = false;}
        port.refresh(state);
      },
      toggleSavePassword(value) {state.savePassword = !state.allowNoPassword && value;},
      invalidPassword() {port.notify(t('password_or_no_password_required'), 'error');}
    };
    return port.show(state, options.owner);
  };
}

export async function vncServerPublicKeyFingerprint(value: unknown): Promise<string> {
  const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes?.byteLength || !globalThis.crypto?.subtle) return '';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
}
