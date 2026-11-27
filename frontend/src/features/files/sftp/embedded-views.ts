import {workspaceAllTabs, workspaceTabByKey} from '@/features/workspace/workspace-dock-state';
import type {WorkspaceTab} from '@/features/workspace/workspace-tab-runtime';

/** Embedded file surfaces own regular SFTP runtimes without entering saved workspace tabs. */
export interface EmbeddedSftpView {
  tab: WorkspaceTab & {id: number; kind: 'sftp'; embedded: true};
  root: HTMLElement;
  beforeAction(action: string): void;
  focus(): void;
}
export const embeddedSftpViews = new Map<string, EmbeddedSftpView>();
export const sftpWorkspaceTabs = () => [...workspaceAllTabs(), ...[...embeddedSftpViews.values()].map(view => view.tab)];
export const sftpWorkspaceTab = (key: string) => embeddedSftpViews.get(key)?.tab || workspaceTabByKey(key);
