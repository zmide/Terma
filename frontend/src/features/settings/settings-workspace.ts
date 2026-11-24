import {settingsServices} from '@/features/settings/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {api} from '@/shared/api/workspace-request';
import {$} from '@/shared/workspace-dom';
import {applicationState} from '@/shared/application-state';
import { setWorkspace } from '@/features/workspace/workspace-dock-runtime';
import { workspaceTabByKey, workspaceFindPaneForTab } from '@/features/workspace/workspace-dock-state';
import { currentWorkspacePaneId, runInWorkspacePane, captureWorkspaceTab } from '@/features/workspace/workspace-pane-scope';
import type { AboutInfo } from '@/app/AboutPage';
import { errorMessage } from '../operations/operations-types';
import { loadSecuritySettings } from './security-settings-actions';
import type { SettingsViewPort } from './settings-port';
import type { WorkspaceTab } from '../workspace/workspace-tab-runtime';

type Tab = Pick<WorkspaceTab, 'key' | 'kind'>;
type Page = { about?: AboutInfo; loadState?: SettingsViewPort['loadState']; pending?: Promise<void> };
type InPane = <T>(action: () => T) => T | undefined;

export function createSettingsWorkspace(paint: (target: HTMLElement, page: Page, inPane: InPane, key: string) => void) {
  const pages = new WeakMap<Tab, Page>();

  function pageFor(tab: Tab) {
    let page = pages.get(tab);
    if (!page) { page = {}; pages.set(tab, page); }
    return page;
  }

  function render(tab = workspaceTabByKey(applicationState.activeTabKey)) {
    if (tab?.kind !== 'settings') return;
    const captured = captureWorkspaceTab(tab.key);
    const inPane: InPane = action => workspaceTabByKey(tab.key) === tab ? captured(action) : undefined;
    inPane(() => {
      const target = $('view-settings');
      if (target && !target.hidden) paint(target, pageFor(tab), inPane, tab.key);
    });
  }

  async function load(tab: Tab, page: Page) {
    try {
      const [, about] = await Promise.all([
        loadSecuritySettings(),
        api<AboutInfo>('/api/about').catch(error => ({product_name: 'Terma', repository_url: 'https://github.com/zmide/Terma', load_error: errorMessage(error, tr('settings:auto.load_failed'))})),
        settingsServices.termaTrustedHosts.load(), settingsServices.termaRuntimeReader.load(),
        settingsServices.termaDesktopStorage.load(), settingsServices.termaProgramCache.load({quiet: true})
      ]);
      page.about = about;
      page.loadState = undefined;
    } catch (error) {
      page.loadState = {error: errorMessage(error, tr('settings:auto.load_failed'))};
    } finally {
      page.pending = undefined;
    }
    if (workspaceTabByKey(tab.key) !== tab) return;
    render(tab);
    if (!page.loadState) void settingsServices.termaUpdateStatus.refresh();
  }

  function open(updateTab = true, tabKey = applicationState.activeTabKey) {
    const current = workspaceTabByKey(tabKey);
    const key = !updateTab && current?.kind === 'settings' ? current.key : 'settings';
    const pane = workspaceFindPaneForTab(key)?.id ?? currentWorkspacePaneId();
    runInWorkspacePane(pane, () => setWorkspace(tr('settings:title'), settingsServices.termaSettingsNavigation.label(), 'settings', key, updateTab, true, {kind: 'settings'}));
    const tab = workspaceTabByKey(key);
    if (!tab) return Promise.resolve();
    const page = pageFor(tab);
    if (!page.about || page.loadState) page.loadState = {loading: true};
    render(tab);
    page.pending ??= Promise.resolve().then(() => load(tab, page));
    return page.pending;
  }

  return { open, render, currentAbout: () => {
    const tab = workspaceTabByKey(applicationState.activeTabKey);
    return tab ? pages.get(tab)?.about : undefined;
  } };
}
