import {terminalServices} from '@/features/terminal/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {isMobileLayout} from '@/shared/browser-ui';
import {notify} from '@/features/efficiency/notification-actions';
import { Fragment, h, reactive, render } from 'vue';
import { TerminalDisplayMenuView, type TerminalDisplayMenuAction,type TerminalMenuEvent } from './TerminalDisplayMenuView';
import { TerminalKeysView, type TerminalKeysModel } from './TerminalKeysView';
import { TerminalMobileComposerView, type TerminalMobileComposerModel } from './TerminalMobileComposerView';
import '@/styles/terminal-controls.css';

type KeysMount = { target: HTMLElement; model: TerminalKeysModel };
type ComposerMount = { target: HTMLElement; model: TerminalMobileComposerModel };
type DisplayMenuOwner = { actions: () => TerminalDisplayMenuAction[]; trigger: HTMLElement | null; x: number; y: number; mobile: boolean };

const keyMounts = new Map<string, KeysMount>();
const composerMounts = new Map<string, ComposerMount>();
let menuTarget: HTMLElement | null = null;
let menuOwner: DisplayMenuOwner | null = null;

function syncTheme(target: HTMLElement) {
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function keysTargetForKey(key: string) {
  return [...document.querySelectorAll<HTMLElement>('.terminal-keys[data-workspace-tab-key]')]
    .find(target => target.dataset.workspaceTabKey === key)
    || terminalServices.termaTerminalSurface?.element(key, '.terminal-keys') || null;
}

function mountKeys(target: HTMLElement): boolean {
  const key = target.dataset.workspaceTabKey || target.dataset.terminalTabKey || '';
  if (!key) return false;
  const existing = keyMounts.get(key);
  if (existing?.target === target) return refreshKeys(key);
  if (existing) releaseKeys(key);
  const snapshot = terminalServices.termaTerminalKeysService?.model(key);
  if (!snapshot) return false;
  target.classList.add('terma-vue-root', 'terma-terminal-controls-root');
  target.classList.toggle('hidden', !snapshot.visible);
  target.dataset.termaVueTerminalKeys = 'true';
  target.setAttribute('data-i18n-skip', '');
  syncTheme(target);
  const model = reactive(snapshot);
  keyMounts.set(key, { target, model });
  target.replaceChildren();
  render(h(TerminalKeysView, { model }), target);
  return true;
}

function refreshKeys(key: string): boolean {
  const target = keysTargetForKey(key);
  const entry = keyMounts.get(key);
  if (!target) return false;
  if (!entry || entry.target !== target) return mountKeys(target);
  const snapshot = terminalServices.termaTerminalKeysService?.model(key);
  if (!snapshot) return false;
  Object.assign(entry.model, snapshot);
  target.classList.toggle('hidden', !snapshot.visible);
  syncTheme(target);
  return true;
}

function releaseKeys(key: string) {
  const entry = keyMounts.get(key);
  if (!entry) return;
  render(null, entry.target);
  entry.target.classList.remove('terma-vue-root', 'terma-terminal-controls-root');
  entry.target.removeAttribute('data-i18n-skip');
  delete entry.target.dataset.theme;
  delete entry.target.dataset.termaVueTerminalKeys;
  keyMounts.delete(key);
}

function refreshAllKeys() {
  for (const [key, entry] of [...keyMounts]) {
    if (!retainsControl(key, entry.target, '.terminal-keys')) releaseKeys(key);
    else refreshKeys(key);
  }
  for (const target of document.querySelectorAll<HTMLElement>('.terminal-keys[data-workspace-tab-key]')) mountKeys(target);
}

function retainsControl(key: string, target: HTMLElement, selector: string) {
  return target.isConnected || workspaceServices.termaWorkspaceViews?.retains(target)
    || terminalServices.termaTerminalSurface?.element(key, selector) === target;
}

function composerModel(key: string): TerminalMobileComposerModel {
  return {
    key,
    placeholder: tr?.('terminal:toolbar.command_placeholder') || '',
    sendLabel: tr?.('terminal:toolbar.send_command') || ''
  };
}

function mountComposer(target: HTMLElement) {
  const key = target.dataset.terminalTabKey || '';
  if (!key) return;
  const entry = composerMounts.get(key);
  if (entry?.target === target) {
    Object.assign(entry.model, composerModel(key));
    syncTheme(target);
    return;
  }
  if (entry) releaseComposer(key);
  const model = reactive(composerModel(key));
  composerMounts.set(key, { target, model });
  target.classList.add('terma-vue-root', 'terma-terminal-controls-root');
  syncTheme(target);
  target.setAttribute('data-i18n-skip', '');
  render(h(TerminalMobileComposerView, { model }), target);
}

function releaseComposer(key: string) {
  const entry = composerMounts.get(key);
  if (!entry) return;
  render(null, entry.target);
  entry.target.classList.remove('terma-vue-root', 'terma-terminal-controls-root');
  delete entry.target.dataset.theme;
  entry.target.removeAttribute('data-i18n-skip');
  composerMounts.delete(key);
}

function refreshAllControls() {
  refreshAllKeys();
  for (const [key, entry] of [...composerMounts]) {
    if (!retainsControl(key, entry.target, '[data-terminal-composer]')) releaseComposer(key);
    else mountComposer(entry.target);
  }
  for (const target of document.querySelectorAll<HTMLElement>('[data-terminal-composer]')) mountComposer(target);
}

function isMobile() {
  return isMobileLayout?.() ?? window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;
}

function renderDisplayMenu() {
  if (!menuTarget || !menuOwner) return;
  const owner = menuOwner;
  owner.mobile = isMobile();
  menuTarget.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  render(h(TerminalDisplayMenuView, {
    actions: owner.actions(),
    mobile: owner.mobile,
    left: owner.x,
    top: owner.y,
    closeLabel: tr?.('common:actions.close', { defaultValue: '关闭' }) || '关闭',
    menuLabel: tr?.('terminal:display.menu_label', { defaultValue: '终端显示选项' }) || '终端显示选项',
    onChoose: chooseDisplayAction,
    onClose: () => closeDisplayMenu(true)
  }), menuTarget);
}

function chooseDisplayAction(action: TerminalDisplayMenuAction, event: MouseEvent) {
  closeDisplayMenu(true);
  Promise.resolve(action.run?.(event)).catch(error => {
    
    if (typeof notify === 'function') notify(error?.message || tr?.('common:auto.operation_failed', { defaultValue: '操作失败' }) || '操作失败', 'error');
  });
}

function closeDisplayMenu(restoreFocus = false) {
  const owner = menuOwner;
  const target = menuTarget;
  menuOwner = null;
  menuTarget = null;
  document.removeEventListener('keydown', menuKeydown, true);
  document.removeEventListener('pointerdown', menuOutsidePointerdown, true);
  window.removeEventListener('resize', menuResize);
  if (target) {
    render(null, target);
    target.remove();
  }
  if (restoreFocus && owner?.trigger?.isConnected) owner.trigger.focus({ preventScroll: true });
}

function menuKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menuOwner) return;
  event.preventDefault?.();
  event.stopImmediatePropagation();
  closeDisplayMenu(true);
}

function menuOutsidePointerdown(event: PointerEvent) {
  if (!menuTarget || !menuOwner || !(event.target instanceof Node)) return;
  if (menuTarget.contains(event.target) || menuOwner.trigger?.contains(event.target)) return;
  closeDisplayMenu(false);
}

function menuResize() {
  renderDisplayMenu();
}

export function openDisplayMenu(event: TerminalMenuEvent, actions: () => TerminalDisplayMenuAction[]): boolean {
  event.preventDefault?.();
  event.stopPropagation?.();
  closeDisplayMenu(false);
  document.getElementById('actionMenu')?.remove();
  document.getElementById('actionSubMenu')?.remove();
  document.getElementById('actionMenuBackdrop')?.remove();
  const target = document.createElement('div');
  target.classList.add('terma-vue-root');
  target.setAttribute('data-i18n-skip', '');
  target.dataset.termaDisplayMenuMount = 'true';
  menuTarget = target;
  menuOwner = {
    actions,
    trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    x: event.clientX??0,
    y: event.clientY??0,
    mobile: isMobile()
  };
  document.body.append(target);
  document.addEventListener('keydown', menuKeydown, true);
  document.addEventListener('pointerdown', menuOutsidePointerdown, true);
  window.addEventListener('resize', menuResize, { passive: true });
  renderDisplayMenu();
  return true;
}

export function installTerminalControls() {
  terminalServices.termaTerminalControls = {
    release: key => {
      releaseKeys(key);
      releaseComposer(key);
    }
  };
  const actionMenu = {
    open: openDisplayMenu,
    close: closeDisplayMenu,
    active: () => !!menuOwner
  };
  terminalServices.termaTerminalActionMenu = actionMenu;
  terminalServices.termaTerminalDisplayMenu = actionMenu;
  terminalServices.termaTerminalKeys = {
    mount: key => {
      const target = keysTargetForKey(key);
      return target ? mountKeys(target) : false;
    },
    refresh: refreshKeys,
    refreshAll: refreshAllKeys,
    release: releaseKeys,
    isMounted: key => keyMounts.has(key)
  };
  window.addEventListener('terma:language-changed', () => {
    refreshAllControls();
    if (menuOwner) renderDisplayMenu();
  });
  window.addEventListener('terma:terminal-toolbar-ready', event => {
    const key = String((event as CustomEvent<{ key?: string }>).detail?.key || '');
    if (key) terminalServices.termaTerminalKeys?.mount(key);
  });
  window.addEventListener('resize', refreshAllControls, { passive: true });
  new MutationObserver(() => {
    for (const entry of keyMounts.values()) syncTheme(entry.target);
    for (const entry of composerMounts.values()) syncTheme(entry.target);
    if (menuTarget) syncTheme(menuTarget);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const observer = new MutationObserver(() => refreshAllControls());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-workspace-tab-key', 'data-terminal-tab-key']
  });
  refreshAllControls();
}

export interface InstalledFeaturesTerminalTerminalControlsMountServices {
  termaTerminalControls?: {
        release(key: string): void;
    };
  termaTerminalDisplayMenu?: {
        open(event: TerminalMenuEvent, actions: () => TerminalDisplayMenuAction[]): boolean;
        close(restoreFocus?: boolean): void;
        active(): boolean;
    };
  termaTerminalActionMenu?: {
        open(event: TerminalMenuEvent, actions: () => TerminalDisplayMenuAction[]): boolean;
        close(restoreFocus?: boolean): void;
        active(): boolean;
    };
  termaTerminalKeys?: {
        mount(key: string): boolean;
        refresh(key: string): boolean;
        refreshAll(): void;
        release(key: string): void;
        isMounted(key: string): boolean;
    };
}
