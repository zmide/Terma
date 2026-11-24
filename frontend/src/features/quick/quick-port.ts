import type { WorkspaceRequestOptions } from '@/shared/api/workspace-request';
import type { QuickSshService, createQuickSshFlow } from './quick-ssh-service';
import type { QuickConnectSearchService } from './quick-connect-search-service';

export type QuickSshSearchTarget = {
raw: string;
user: string;
host: string;
port: number;
user_missing: boolean;
};
export type QuickConnectionSearchForward = {
id?: number | string;
service_name?: string;
service_type?: string;
service_note?: string;
mode?: string;
status?: string;
url_scheme?: string;
url_path?: string;
bind_host?: string;
bind_port?: number | string;
target_host?: string;
target_port?: number | string;
};
export type QuickConnectionSearchRecord = {
id: number | string;
name?: string;
group_name?: string;
tags?: unknown;
ssh_host?: string;
ssh_user?: string;
ssh_port?: number | string;
favorite?: unknown;
forwards?: QuickConnectionSearchForward[];
};
export interface QuickViewHost {
  tr(key: string, options?: Record<string, unknown>): string;
  closeQuickPanel(): void;
  refreshIcons(): void;
  $(id: string): HTMLElement | null;
  readonly connections: QuickConnectionSearchRecord[];
  openSavedTerminal(id: number): unknown;
  newSshConnection(): unknown;
  quickSessionId(key: string): number;
  openQuickTerminal(connection: Record<string, unknown>, token: string): unknown;
  resumeQuickTerminal(key: string, connection: Record<string, unknown>, token: string): unknown;
  api<T = unknown>(url: string, options?: WorkspaceRequestOptions): Promise<T>;
  localizedIdentityFileLabel(identity: unknown, options?: {permission?: boolean; repair?: boolean}): string;
  closeModal(): void;
  notify(message: string, kind: string): void;
  syncUiActionControls(key: string, busy: boolean): void;
  isUiActionInFlight(key: string): boolean;
  sshAuthenticationFailure(error: unknown): boolean;
  localizedTermaUiPhrase(message: unknown): string;
  setButtonBusy(button: HTMLElement | null, busy: boolean, message?: string): void;
}

export interface QuickViewPort extends QuickViewHost {
  ssh: QuickSshService;
  sshFlow: ReturnType<typeof createQuickSshFlow>;
  search: QuickConnectSearchService;
  cancelQuickSearch(): void;
}
