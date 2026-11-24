import {workspaceServices} from '@/features/workspace/installed-services';
import type { WorkspaceTabView, WorkspaceViewPort } from './workspace-port';

type WorkspaceMobilePort = {
  isMobile: () => boolean;
  models: () => WorkspaceTabView[];
  label: () => string;
  tabs: () => WorkspaceViewPort;
  hasTab: (key: string) => boolean;
  activate: (key: string) => void;
  showWorkspace: () => void;
};

function revealActiveTab(list: HTMLElement) {
  if (list.hidden || !list.getBoundingClientRect().width) return;
  const active = (list.contains(document.activeElement)
    ? document.activeElement?.closest('.mobile-workspace-tab')
    : null)
    || list.querySelector('[aria-selected="true"]')?.closest('.mobile-workspace-tab');
  if (!active) return;
  const bounds = list.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  if (item.left < bounds.left) list.scrollLeft -= bounds.left - item.left;
  else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
}

export function createWorkspaceMobileService(port: WorkspaceMobilePort) {
  function render() {
    const lists = ['mobileWorkspaceTabs', 'mobileExplorerTabs']
      .map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!lists.length) return;
    const models = port.models();
    const mobile = port.isMobile();
    const label = port.label();
    const tabs = port.tabs();
    for (const list of lists) {
      list.hidden = !mobile || !models.length;
      list.setAttribute('aria-label', label);
      const previousScroll = list.scrollLeft;
      workspaceServices.termaWorkspaceViews?.tabs(list, models, tabs, true);
      list.scrollLeft = previousScroll;
      revealActiveTab(list);
    }
  }

  function activate(key: string) {
    if (!port.hasTab(key)) return;
    port.activate(key);
    port.showWorkspace();
  }

  return { render, activate };
}

export function installWorkspaceMobileService(port: WorkspaceMobilePort) {
  if (workspaceServices.termaWorkspaceMobile) return;
  workspaceServices.termaWorkspaceMobile = createWorkspaceMobileService(port);
}



export interface InstalledFeaturesWorkspaceWorkspaceMobileServiceServices {
  termaWorkspaceMobile?: ReturnType<typeof createWorkspaceMobileService>;
}
