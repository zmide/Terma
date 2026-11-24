import {settingsServices} from '@/features/settings/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {applicationState} from '@/shared/application-state';
import { workspaceDockState } from '@/features/workspace/workspace-dock-state';
import { currentWorkspacePaneId } from '@/features/workspace/workspace-pane-scope';
import { formatFileBytes as formatBytes } from '@/shared/format-file-bytes';
import { Fragment, h, render, type VNode } from 'vue';
import type { i18n } from 'i18next';
import { renderSettingsBody } from './SettingsPage';
import { renderSettingsNavigation } from './SettingsNavigation';
import type { SettingsViewPort } from './settings-port';
import '@/styles/settings.css';
import { TermaButton } from '@/shared/ui/TermaButton';
import { installTrustedHostsController } from './trusted-hosts-controller';
import { installProgramCacheController } from './program-cache-controller';
import { installSettingsNavigation } from './settings-navigation-controller';
import { createSettingsWorkspace } from './settings-workspace';
import { runtimePreferences } from './runtime-settings-model';


type Mount = { scope: SettingsViewPort; navigation: boolean };
const mounts = new Map<HTMLElement, Mount>();



// Service refreshes preserve unrelated, unsaved form values during the API transition.
function captureForm(target: HTMLElement, region: string) {
  const excluded = region && region !== 'selection' ? target.querySelector(`#${region}`) : null;
  return [...target.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')]
    .filter(field => !excluded?.contains(field) && !field.closest('[data-terma-managed-fields]'))
    .map(field => ({ field, id: field.id, value: field.value, disabled: field.disabled, hidden: field.hidden, checked: 'checked' in field ? field.checked : undefined }));
}

function paint(target: HTMLElement, mount: Mount, region?: string) {
  const focus = target.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const fields = region ? captureForm(target, region) : focus ? captureForm(target, 'selection').filter(({field}) =>
    field === focus && (!(field instanceof HTMLInputElement) || !['file', 'checkbox', 'radio'].includes(field.type))) : [];
  const selection = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement
    ? { start: focus.selectionStart, end: focus.selectionEnd } : null;
  const scrolls = [...target.querySelectorAll<HTMLElement>('details[open], [id]')]
    .filter(element => element.scrollTop || element.scrollLeft || element instanceof HTMLDetailsElement && element.open)
    .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft, open: element instanceof HTMLDetailsElement }));
  target.classList.add('terma-vue-root', mount.navigation ? 'terma-settings-nav' : 'terma-settings-root');
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  target.setAttribute('data-i18n-skip', '');
  target.dataset.termaSettingsOwned = mount.navigation ? 'navigation' : 'page';
  const scope = Object.create(mount.scope) as SettingsViewPort;
  const content = mount.navigation ? renderSettingsNavigation(scope) : scope.loadState
    ? [h('div', {class:['ui-state', scope.loadState.error?'error':'loading']}, [h('strong',null,scope.tr(scope.loadState.error?'settings:auto.load_failed':'settings:auto.loading')), h('span',null,scope.loadState.error||scope.tr('settings:auto.loading_detail')),scope.loadState.error?h(TermaButton,{onClick:()=>scope.openSettings(false)},()=>scope.tr('common:actions.retry')):null])]
    : renderSettingsBody(scope);
  render(h(Fragment, null, content as VNode[]), target);
  for (const field of fields) {
    const element = field.field.isConnected ? field.field : field.id ? target.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${field.id}`) : null;
    if (!element) continue;
    element.value = field.value;
    element.disabled = field.disabled; element.hidden = field.hidden;
    if (field.checked !== undefined && element instanceof HTMLInputElement) element.checked = field.checked;
  }
  for (const state of scrolls) {
    if (!state.element.isConnected) continue;
    state.element.scrollTop = state.top; state.element.scrollLeft = state.left;
    if (state.open && state.element instanceof HTMLDetailsElement) state.element.open = true;
  }
  if (focus?.isConnected) {
    focus.focus({ preventScroll: true });
    if (selection?.start !== null && selection?.start !== undefined && (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement)) {
      focus.setSelectionRange(selection.start, selection.end);
    }
  }
}

export function installSettingsViews(i18n: i18n, clearSftpDirectoryCache: () => void) {
  function mount(target: HTMLElement, scope: SettingsViewPort, navigation: boolean) {
    if (!mounts.has(target)) target.replaceChildren();
    const next = {scope, navigation};
    mounts.set(target, next);
    paint(target, next);
  }
  function viewScope(target: HTMLElement, inPane: <T>(action: () => T) => T | undefined, key?: string): SettingsViewPort {
    const storage = settingsServices.termaDesktopStorage;
    return {
      settingsRoot: target, aboutI18n: i18n, tr, formatBytes,
      get activeSettingsSection() { return settingsServices.termaSettingsNavigation.section; },
      get desktopSettings() { return storage.snapshot; },
      get runtimeSettings() { return runtimePreferences.snapshot; },
      get securitySettings() { return applicationState.securitySettings; },
      openSettings: async () => { await inPane(() => workspace.open(false, key)); },
      saveDesktopSettings: (button?: HTMLElement) => inPane(() => storage.saveDesktopSettings(button)),
      saveWebStorageSettings: (button?: HTMLElement) => inPane(() => storage.saveWebStorageSettings(button)),
      syncDesktopCustomDataMode: () => inPane(storage.syncDesktopCustomDataMode),
      chooseDesktopDataDirectory: () => inPane(storage.chooseDesktopDataDirectory),
      openStorageDirectoryBrowser: () => inPane(() => storage.openStorageDirectoryBrowser()),
      chooseDesktopVncClient: () => inPane(storage.chooseDesktopVncClient)
    };
  }
  const workspace = createSettingsWorkspace((target, page, inPane, key) => {
    settingsServices.termaUnmountVueAbout?.(target);
    const scope = viewScope(target, inPane, key);
    scope.aboutSettings = page.about;
    scope.loadState = page.loadState;
    mount(target, scope, false);
    if (!page.loadState) {
      settingsServices.termaDesktopStorage.syncDesktopCustomDataMode();
      if (currentWorkspacePaneId() === workspaceDockState.focusedPaneId) {
        settingsServices.termaSettingsNavigation.show(undefined, {moveToWorkspace: false});
        settingsServices.termaUpdateNotice.sync();
      }
    }
  });
  installSettingsNavigation(workspace.open);
  const repaintRegion = (region: string) => {
    for (const [target, mount] of mounts) {
      if ((target.isConnected || workspaceServices.termaWorkspaceViews?.retains(target)) && !mount.navigation && target.querySelector(`#${region}`)) paint(target, mount, region);
    }
  };
  installTrustedHostsController(() => repaintRegion('sshHostTrustPanel'));
  installProgramCacheController(() => repaintRegion('cacheManagementPanel'), clearSftpDirectoryCache);
  window.addEventListener('terma:language-changed', () => {
    for (const [target, mount] of mounts) {
      if (target.isConnected || workspaceServices.termaWorkspaceViews?.retains(target)) paint(target, mount, 'selection');
    }
  });
  settingsServices.termaSettingsViews = {...workspace, navigation: target => mount(target, viewScope(target, action => action()), true)};
  settingsServices.termaRefreshVueSettings = (target, region = 'selection') => {
    const mount = mounts.get(target);
    if (!mount) return false;
    paint(target, mount, region);
    return true;
  };
  settingsServices.termaUnmountVueSettings = target => {
    if (!mounts.has(target)) return;
    render(null, target); mounts.delete(target);
    target.classList.remove('terma-vue-root', 'terma-settings-nav', 'terma-settings-root');
    delete target.dataset.termaSettingsOwned;
    target.removeAttribute('data-i18n-skip');
  };
  new MutationObserver(() => {
    for (const [target, mount] of mounts) {
      if (!target.isConnected && !workspaceServices.termaWorkspaceViews?.retains(target)) { settingsServices.termaUnmountVueSettings?.(target); continue; }
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      if (target.dataset.theme !== theme) paint(target, mount, 'selection');
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
}

export interface InstalledFeaturesSettingsSettingsMountServices {
  termaSettingsViews?: ReturnType<typeof createSettingsWorkspace> & {navigation(target: HTMLElement): void};
  termaRefreshVueSettings?: (target: HTMLElement, region?: string) => boolean;
  termaUnmountVueSettings?: (target: HTMLElement) => void;
}
