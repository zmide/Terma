import {terminalServices} from '@/features/terminal/installed-services';
import {workspaceServices} from '@/features/workspace/installed-services';
import { h, nextTick, reactive, render } from 'vue';
import { TerminalToolbarView, type TerminalToolbarModel } from './TerminalToolbarView';
import { bindTerminalToolbarScroll, releaseTerminalToolbarScroll } from './terminal-toolbar-scroll-service';

type ToolbarMount = { target: HTMLElement; model: TerminalToolbarModel };
type ScrollState = { key: string; overflow: boolean; canScrollLeft: boolean; canScrollRight: boolean };



const mounts = new Map<string, ToolbarMount>();

function syncTheme(target: HTMLElement) {
  target.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function targetForKey(key: string) {
  return [...document.querySelectorAll<HTMLElement>('.terminal-toolbar[data-workspace-tab-key]')]
    .find(target => target.dataset.workspaceTabKey === key) || null;
}

function mount(target: HTMLElement): boolean {
  const key = target.dataset.workspaceTabKey || target.dataset.terminalTabKey || '';
  if (!key) return false;
  const existing = mounts.get(key);
  if (existing?.target === target) return refresh(key);
  if (existing) release(key);
  const snapshot = terminalServices.termaTerminalToolbarService?.model(key);
  if (!snapshot) return false;
  target.classList.add('terma-vue-root');
  syncTheme(target);
  target.dataset.termaVueTerminalToolbar = 'true';
  target.setAttribute('data-i18n-skip', '');
  const model = reactive(snapshot);
  const entry = { target, model };
  mounts.set(key, entry);
  // Older restored hosts can still contain markup. Vue owns their children.
  target.replaceChildren();
  render(h(TerminalToolbarView, { model }), target);
  void nextTick(() => {
    if (mounts.get(key) === entry && target.isConnected) bindTerminalToolbarScroll(target);
  });
  return true;
}

function refresh(key: string): boolean {
  const target = targetForKey(key);
  if (!target) return false;
  const entry = mounts.get(key);
  if (!entry || entry.target !== target) return mount(target);
  const snapshot = terminalServices.termaTerminalToolbarService?.model(key);
  if (!snapshot) return false;
  // Geometry belongs to the scroll binding; a status/locale refresh must not reset it.
  const { scrollOverflow, scrollCanLeft, scrollCanRight, ...content } = snapshot;
  Object.assign(entry.model, content);
  syncTheme(target);
  void nextTick(() => {
    if (mounts.get(key) === entry && target.isConnected) bindTerminalToolbarScroll(target);
  });
  return true;
}

function refreshAll() {
  for (const [key, entry] of [...mounts]) {
    if (!entry.target.isConnected && !workspaceServices.termaWorkspaceViews?.retains(entry.target)) {
      release(key);
      continue;
    }
  }
  for (const target of document.querySelectorAll<HTMLElement>('.terminal-toolbar[data-workspace-tab-key]')) mount(target);
}

function release(key: string) {
  const entry = mounts.get(key);
  if (!entry) return;
  releaseTerminalToolbarScroll(entry.target);
  render(null, entry.target);
  entry.target.classList.remove('terma-vue-root');
  delete entry.target.dataset.theme;
  delete entry.target.dataset.termaVueTerminalToolbar;
  entry.target.removeAttribute('data-i18n-skip');
  mounts.delete(key);
}

function updateScrollState(event: Event) {
  const state = (event as CustomEvent<ScrollState>).detail;
  const entry = state && mounts.get(state.key);
  if (!entry) return;
  Object.assign(entry.model, {
    scrollOverflow: state.overflow,
    scrollCanLeft: state.canScrollLeft,
    scrollCanRight: state.canScrollRight
  });
}

export function installTerminalToolbar() {
  terminalServices.termaTerminalToolbar = {
    mount: key => {
      const target = targetForKey(key);
      return target ? mount(target) : false;
    },
    refresh,
    refreshAll,
    release,
    isMounted: key => mounts.has(key)
  };
  window.addEventListener('terma:terminal-toolbar-scroll-state', updateScrollState);
  window.addEventListener('terma:terminal-toolbar-ready', event => {
    const key = String((event as CustomEvent<{ key?: string }>).detail?.key || '');
    if (key) terminalServices.termaTerminalToolbar?.mount(key);
  });
  window.addEventListener('terma:language-changed', refreshAll);
  window.addEventListener('resize', refreshAll, { passive: true });
  new MutationObserver(() => {
    for (const entry of mounts.values()) syncTheme(entry.target);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const observer = new MutationObserver(() => refreshAll());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-workspace-tab-key', 'data-terminal-tab-key']
  });
  refreshAll();
}

export interface InstalledFeaturesTerminalTerminalToolbarMountServices {
  termaTerminalToolbar?: {
      mount: (key: string) => boolean;
      refresh: (key: string) => boolean;
      refreshAll: () => void;
      release: (key: string) => void;
      isMounted: (key: string) => boolean;
    };
}
