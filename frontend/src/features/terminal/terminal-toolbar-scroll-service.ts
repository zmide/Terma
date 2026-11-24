import {terminalServices} from '@/features/terminal/installed-services';
import {sharedServices} from '@/shared/installed-services';
export type TerminalToolbarScrollElement = {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
};

export type TerminalToolbarScrollSnapshot = {
  overflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

export function terminalToolbarScrollSnapshot(actions: TerminalToolbarScrollElement): TerminalToolbarScrollSnapshot {
  const overflow = actions.scrollWidth > actions.clientWidth + 1;
  const canScrollLeft = overflow && actions.scrollLeft > 1;
  const canScrollRight = overflow && actions.scrollLeft + actions.clientWidth < actions.scrollWidth - 1;
  return {overflow, canScrollLeft, canScrollRight};
}

export function terminalToolbarScrollStep(actions: TerminalToolbarScrollElement) {
  return Math.max(120, Math.round(actions.clientWidth * 0.78));
}

export function terminalToolbarScrollTarget(actions: TerminalToolbarScrollElement, direction: number) {
  if (actions.scrollWidth <= actions.clientWidth + 1) return actions.scrollLeft;
  const step = terminalToolbarScrollStep(actions);
  return Math.max(0, Math.min(actions.scrollWidth - actions.clientWidth, actions.scrollLeft + direction * step));
}

export function terminalToolbarScrollLabel(direction: string, translate: (key: string, params?: Record<string, unknown>) => string) {
  return direction === 'left'
    ? translate('common:auto.scroll_left', {defaultValue: '向左滚动快捷按钮'})
    : translate('common:auto.scroll_right', {defaultValue: '向右滚动快捷按钮'});
}

type ScrollBinding = {
  toolbar: HTMLElement;
  actions: HTMLElement;
  originalTabIndex: string | null;
  frame: number;
  lastState: TerminalToolbarScrollSnapshot | null;
  onWheel: (event: WheelEvent) => void;
  onScroll: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  resizeObserver: ResizeObserver | null;
  mutationObserver: MutationObserver | null;
};

const bindings = new WeakMap<HTMLElement, ScrollBinding>();

export function terminalToolbarScrollState(actions: HTMLElement) {
  const binding = bindings.get(actions);
  if (!binding) return;
  const snapshot = terminalToolbarScrollSnapshot(actions);
  if (binding.lastState
    && binding.lastState.overflow === snapshot.overflow
    && binding.lastState.canScrollLeft === snapshot.canScrollLeft
    && binding.lastState.canScrollRight === snapshot.canScrollRight) return;
  binding.lastState = snapshot;
  window.dispatchEvent(new CustomEvent('terma:terminal-toolbar-scroll-state', {
    detail: {
      key: binding.toolbar.dataset.workspaceTabKey || binding.toolbar.dataset.terminalTabKey || '',
      ...snapshot
    }
  }));
}

export function scheduleTerminalToolbarScrollState(actions: HTMLElement) {
  const binding = bindings.get(actions);
  if (!binding || binding.frame) return;
  const update = () => {
    binding.frame = 0;
    if (bindings.get(actions) === binding) terminalToolbarScrollState(actions);
  };
  binding.frame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(update) : window.setTimeout(update, 0);
}

export function scrollTerminalToolbarActions(actions: HTMLElement | null, direction: number) {
  if (!actions || !bindings.has(actions) || actions.scrollWidth <= actions.clientWidth + 1) return;
  actions.scrollLeft = terminalToolbarScrollTarget(actions, direction);
  terminalToolbarScrollState(actions);
}

export function releaseTerminalToolbarScroll(toolbar: HTMLElement | null) {
  if (!toolbar) return;
  const binding = bindings.get(toolbar);
  if (!binding) return;
  binding.resizeObserver?.disconnect();
  binding.mutationObserver?.disconnect();
  if (binding.frame) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(binding.frame);
    else window.clearTimeout(binding.frame);
  }
  binding.actions.removeEventListener('wheel', binding.onWheel);
  binding.actions.removeEventListener('scroll', binding.onScroll);
  binding.actions.removeEventListener('keydown', binding.onKeydown);
  binding.actions.removeAttribute('data-workspace-horizontal-scroll');
  if (binding.originalTabIndex === null) binding.actions.removeAttribute('tabindex');
  else binding.actions.setAttribute('tabindex', binding.originalTabIndex);
  bindings.delete(binding.toolbar);
  bindings.delete(binding.actions);
}

export function bindTerminalToolbarScroll(toolbar: HTMLElement | null) {
  if (!toolbar) return;
  const actions = toolbar.querySelector<HTMLElement>('.terminal-actions');
  const current = bindings.get(toolbar);
  if (actions && current?.actions === actions) {
    scheduleTerminalToolbarScrollState(actions);
    return;
  }
  if (current) releaseTerminalToolbarScroll(toolbar);
  if (!actions || !toolbar.hasAttribute('data-terma-vue-terminal-toolbar')) return;
  const originalTabIndex = actions.getAttribute('tabindex');
  actions.tabIndex = 0;
  actions.dataset.workspaceHorizontalScroll = '1';
  const binding: ScrollBinding = {
    toolbar, actions, originalTabIndex, frame: 0, lastState: null,
    onWheel: event => {
      if (actions.scrollWidth <= actions.clientWidth + 1) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const previous = actions.scrollLeft;
      actions.scrollLeft += delta;
      terminalToolbarScrollState(actions);
      if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
    },
    onScroll: () => terminalToolbarScrollState(actions),
    onKeydown: event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        || actions.scrollWidth <= actions.clientWidth + 1) return;
      const previous = actions.scrollLeft;
      if (event.key === 'Home') actions.scrollLeft = 0;
      else if (event.key === 'End') actions.scrollLeft = actions.scrollWidth;
      else actions.scrollLeft += event.key === 'ArrowLeft' ? -120 : 120;
      terminalToolbarScrollState(actions);
      if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
    },
    resizeObserver: typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => scheduleTerminalToolbarScrollState(actions)) : null,
    mutationObserver: typeof MutationObserver === 'function'
      ? new MutationObserver(() => scheduleTerminalToolbarScrollState(actions)) : null
  };
  bindings.set(toolbar, binding);
  bindings.set(actions, binding);
  actions.addEventListener('wheel', binding.onWheel, { passive: false });
  actions.addEventListener('scroll', binding.onScroll, { passive: true });
  actions.addEventListener('keydown', binding.onKeydown);
  binding.resizeObserver?.observe(actions);
  binding.resizeObserver?.observe(toolbar);
  binding.mutationObserver?.observe(actions, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']
  });
  terminalToolbarScrollState(actions);
}



export function installTerminalToolbarScrollService() {
  terminalServices.termaTerminalToolbarScroll = {
    snapshot: terminalToolbarScrollSnapshot,
    target: terminalToolbarScrollTarget,
    label: terminalToolbarScrollLabel,
    bind: bindTerminalToolbarScroll,
    release: releaseTerminalToolbarScroll,
    state: terminalToolbarScrollState,
    schedule: scheduleTerminalToolbarScrollState,
    scroll: scrollTerminalToolbarActions,
    has: element => bindings.has(element)
  };
  sharedServices.termaEventRegistry?.register("terminal-toolbar-scroll", ({element}) => {
    const actions = element.closest(".terminal-actions-scroll-shell")?.querySelector<HTMLElement>(".terminal-actions");
    if (actions) scrollTerminalToolbarActions(actions, element.getAttribute("data-scroll-direction") === "left" ? -1 : 1);
  });
}

export interface InstalledFeaturesTerminalTerminalToolbarScrollServiceServices {
  termaTerminalToolbarScroll?: {
      snapshot: typeof terminalToolbarScrollSnapshot;
      target: typeof terminalToolbarScrollTarget;
      label: typeof terminalToolbarScrollLabel;
      bind: typeof bindTerminalToolbarScroll;
      release: typeof releaseTerminalToolbarScroll;
      state: typeof terminalToolbarScrollState;
      schedule: typeof scheduleTerminalToolbarScrollState;
      scroll: typeof scrollTerminalToolbarActions;
      has: (element: HTMLElement) => boolean;
    };
}
