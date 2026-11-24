import type { PermissionPrincipals } from './permission-principals';
export type SftpDialogText = (key: string, params?: Record<string, unknown>) => string;
export type SftpPermissionDraft = { mode: string; owner: string; group: string; recursive: boolean };
export type SftpRecycleItem = { id: string; name?: string; original_path: string; type?: string; storage?: string; deleted_at?: string };
export type SftpRecyclePage = { items: SftpRecycleItem[]; page: number; total: number; total_pages: number; enabled: boolean };
export type SftpDirectory = { path: string; entries: { name: string; type: string }[] };
export type SftpDirectoryNode = { path: string; name: string; expanded: boolean; loading: boolean; error: string; children: SftpDirectoryNode[] };
export type SftpConfirmation = { title: string; message: string; confirm: string; danger: boolean };
export interface SftpDialogBase { tr: SftpDialogText; valid?: () => boolean; dispose?: () => void }
export interface SftpInputOptions extends SftpDialogBase { titleKey: string; labelKey: string; value: string; validate?: (value: string) => boolean; apply?: (value: string) => Promise<void>; errorText?: (error: unknown) => string }
export interface FileTextOptions extends SftpDialogBase { name: string; path: string; content: string; writable: boolean; save(content: string): Promise<void>; errorText?(error: unknown): string }
export interface SftpPermissionOptions extends SftpDialogBase {
  metadata: { mode: string; owner: string; group: string; mixedMode: boolean; hasDirectory: boolean };
  count: number;
  principals?: () => Promise<PermissionPrincipals>;
  apply: (draft: SftpPermissionDraft) => Promise<void>;
}
export interface SftpArchiveOptions extends SftpDialogBase {
  mode: string; filename: string; path: string; target: string; encoding: string; titleKey?: string;
  encodings: readonly (readonly [string, string])[];
  list: (path: string) => Promise<SftpDirectory>;
  mkdir: (path: string, name: string) => Promise<void>;
  parent: (path: string) => string;
  join: (path: string, name: string) => string;
  folderName: string;
}
export interface SftpArchiveResult { filename?: string; target?: string; encoding: string; overwrite?: boolean; namedFolder?: boolean }
export interface SftpRecycleOptions extends SftpDialogBase {
  page: number;
  load: (page: number) => Promise<SftpRecyclePage>;
  restore: (item: SftpRecycleItem) => Promise<void>;
  remove: (item: SftpRecycleItem) => Promise<void>;
  clear: () => Promise<void>;
}
export type SftpDialogModel = {
  kind: 'input' | 'text' | 'confirm' | 'permissions' | 'archive' | 'recycle'; tr: SftpDialogText;
  busy: boolean; error: string; mode: string; owner: string; group: string; originalOwner: string; originalGroup: string; recursive: boolean;
  principals: PermissionPrincipals; principalsLoading: boolean;
  value: string; titleKey: string; labelKey: string; count: number; mixedMode: boolean; hasDirectory: boolean; readOnly: boolean;
  confirmation: (() => SftpConfirmation) | null;
  archiveMode: string; filename: string; path: string; target: string; encoding: string; encodings: readonly (readonly [string, string])[];
  overwrite: boolean; namedFolder: boolean; browser: boolean; browserPath: string; browserLoading: boolean; browserError: string;
  directories: SftpDirectoryNode[]; newDirectory: boolean; newName: string;
  recycle: SftpRecyclePage | null; page: number;
};
export type SftpDialogActions = {
  close: () => void; submit: () => void; cancelConfirmation: () => void;
  change: (key: keyof SftpDialogModel, value: string | boolean) => void;
  permission: (prefix: string, bit: number, checked: boolean) => void;
  browse: (action: string, path?: string) => void;
  expand: (node: SftpDirectoryNode) => void;
  recycle: (action: string, item?: SftpRecycleItem, page?: number) => void;
};
