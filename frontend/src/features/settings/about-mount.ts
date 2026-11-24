import {settingsServices} from '@/features/settings/installed-services';
import {refreshIcons} from '@/shared/ui/icon-service';
import { createApp } from 'vue';
import type { i18n } from 'i18next';
import { AboutPage, type AboutInfo } from '@/app/AboutPage';

type AboutMount = HTMLDivElement & { __termaAboutInfo?: AboutInfo };
type AboutMountScope = ParentNode & { matches?: (selector: string) => boolean; contains?: (node: Node) => boolean };
type AboutApp = ReturnType<typeof createApp>;



export function installAboutMount(i18n: i18n, retains: (target: Element) => boolean = () => false) {
  const apps = new Map<AboutMount, AboutApp>();

  function targetsIn(scope: AboutMountScope): AboutMount[] {
    const targets: AboutMount[] = [];
    if (scope.matches?.('[data-terma-about-mount="all"]')) targets.push(scope as AboutMount);
    targets.push(...Array.from(scope.querySelectorAll<AboutMount>('[data-terma-about-mount="all"]')));
    return targets;
  }

  function mount(target: AboutMount) {
    if (!target.isConnected || apps.has(target)) return;
    target.setAttribute('data-i18n-skip', '');
    syncTheme(target);
    const app = createApp(AboutPage, {
      i18n,
      embedded: true,
      part: 'all',
      initialInfo: target.__termaAboutInfo
    });
    apps.set(target, app);
    app.mount(target);
    refreshIcons?.();
  }

  function syncTheme(target: AboutMount) {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    if (target.dataset.theme !== theme) target.dataset.theme = theme;
  }

  function scan(scope: AboutMountScope = document) {
    for (const target of targetsIn(scope)) {
      syncTheme(target);
      mount(target);
    }
    for (const [target, app] of apps) {
      if (!target.isConnected && !retains(target)) {
        app.unmount();
        apps.delete(target);
      } else syncTheme(target);
    }
  }

  settingsServices.termaMountVueAbout = (scope, info) => {
    for (const target of targetsIn(scope)) {
      if (info) target.__termaAboutInfo = info;
      mount(target);
    }
  };
  settingsServices.termaUnmountVueAbout = scope => {
    for (const [target, app] of apps) {
      if (scope === target || scope.contains?.(target)) {
        app.unmount();
        apps.delete(target);
      }
    }
  };

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  scan();
}

export interface InstalledFeaturesSettingsAboutMountServices {
  termaMountVueAbout?: (scope: AboutMountScope, info?: AboutInfo) => void;
  termaUnmountVueAbout?: (scope: AboutMountScope) => void;
}
