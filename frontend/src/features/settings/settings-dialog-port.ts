import type { SettingsViewPort } from './settings-port';

export type SettingsDialogKind = 'language-onboarding' | 'xserver-local' | 'directory' | 'public-key'
  | 'key-properties' | 'key-deploy' | 'key-import' | 'key-wizard' | 'key-result' | 'choice' | 'input' | 'host-trust';

export interface SettingsDialogPort extends Pick<SettingsViewPort, 'tr'> {
  $: (id: string) => HTMLInputElement | null;
  closeModal: () => void;
  connections: { id: number; [key: string]: any }[];
}
