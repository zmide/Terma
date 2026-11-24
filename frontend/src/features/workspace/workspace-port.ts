import type { ClosingWorkspaceTab } from './WorkspaceCloseDialog';

export interface WorkspaceTabView {
  key: string;
  kind: string;
  protocol?: string;
  title: string;
  label: string;
  tooltip: string;
  closeLabel: string;
  active: boolean;
  selected: boolean;
  broadcast: boolean;
  pinned: boolean;
  closable: boolean;
  activity: string;
  status: string;
  statusLabel: string;
  // Drag feedback remains owned by the existing file transfer controller.
  dropTarget?: boolean;
}

export type WorkspaceLayout = { type: 'pane'; id: string } | {
  type: 'split'; id: string; direction: 'row' | 'column'; ratio: number;
  first: WorkspaceLayout; second: WorkspaceLayout;
};

// Session engines and persistence stay behind this adapter; Vue owns the chrome.
export interface WorkspaceViewPort {
  tr: (key: string) => string;
  action: (name: string, event: Event, element: HTMLElement) => void;
  pane: (id: string) => HTMLElement;
  focus: (id: string) => void;
  views: (id: string) => DocumentFragment;
  scroll: (id: string, direction: number) => void;
  tabScroll: (id: string) => void;
  tabWheel: (id: string, event: WheelEvent) => void;
  tabsMenu: (event: MouseEvent) => void;
  splitStart: (id: string, event: PointerEvent) => void;
  splitKey: (id: string, event: KeyboardEvent) => void;
  splitReset: (id: string) => void;
  minRatio: number;
  maxRatio: number;
}

export interface WorkspaceViews {
  presentation: typeof import("./workspace-tab-presentation").workspaceTabPresentation;
  retains: (target: Node) => boolean;
  unmountDialog: () => void;
  confirmClose: (target: HTMLElement, tabs: ClosingWorkspaceTab[], tr: (key: string, values?: Record<string, unknown>) => string) => Promise<false | 'detach' | 'terminate'>;
  createPane: (id: string, port: WorkspaceViewPort) => HTMLElement;
  releasePane: (pane: HTMLElement) => void;
  layout: (target: HTMLElement, tree: WorkspaceLayout, port: WorkspaceViewPort) => void;
  tabs: (target: HTMLElement, tabs: WorkspaceTabView[], port: WorkspaceViewPort, mobile?: boolean) => void;
  menu: (target: HTMLElement, items: WorkspaceMenuItem[]) => void;
  groups: (target: HTMLElement, groups: WorkspaceGroupView[], selection: { text: string; confirm: string; cancel: string; enabled: boolean } | null, combine: string) => void;
  unmount: (target: HTMLElement) => void;
}

export interface WorkspaceGroupView {
  id: string;
  name: string;
  active: boolean;
  count: number;
  activity: boolean;
  activityLabel: string;
  label: string;
}

export interface WorkspaceMenuItem {
  label: string;
  icon: string;
  enabled: boolean;
  action: () => void;
}



export interface InstalledFeaturesWorkspaceWorkspacePortServices {
  termaWorkspaceViews?: WorkspaceViews
}
