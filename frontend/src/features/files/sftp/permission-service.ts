import type { SftpPermissionOptions, SftpDialogText, SftpPermissionDraft } from './sftp-dialog-types';
import type { PermissionPrincipals } from './permission-principals';
interface PermissionContext { connectionId: number; valid(): boolean }
interface PermissionPort {
  context(key: string): PermissionContext | null;
  api(url: string, options?: { method: string; body: string }): Promise<unknown>;
  open(options: SftpPermissionOptions): void;
  notify(message: string, kind: string): void;
  refresh(key: string): void;
  tr: SftpDialogText;
}
export function createSftpPermissionService(port: PermissionPort) {
  return { open(key: string, entries: { path: string }[], metadata: SftpPermissionOptions['metadata']) {
    const context = port.context(key); if (!context || !context.valid() || !entries.length) return;
    const paths = entries.map(entry => entry.path), connectionId = context.connectionId;
    const owns = () => context.valid() && port.context(key)?.connectionId === connectionId;
    port.open({ tr: port.tr, metadata: { ...metadata }, count: paths.length, valid: owns,
      principals: async () => {
        if (!owns()) return { users: [], groups: [] };
        return await port.api(`/api/connections/${connectionId}/sftp/principals`) as PermissionPrincipals;
      },
      apply: async (draft: SftpPermissionDraft) => {
        if (!owns()) return;
        await port.api(`/api/connections/${connectionId}/sftp/permissions`, { method: 'POST', body: JSON.stringify({ paths, ...draft }) });
        if (!owns()) return;
        port.notify(port.tr('sftp:permissions_editor.updated'), 'success'); port.refresh(key);
      }
    });
  } };
}
