type TabDragSource = {
  paneId: string;
  activeTabKey: string;
  tab: HTMLElement;
};

export type WorkspaceTabDragPort = {
  context: () => string;
  mobile: () => boolean;
  selectionMode: () => boolean;
  source: (key: string) => TabDragSource | null;
  activateSource: (key: string, source: TabDragSource) => void;
  presentation: (key: string) => { icon: string; title: string };
  hideMenu: () => void;
  render: () => void;
};

type DockTabTarget = {
  scrollArea: (paneId: string) => { tabs: HTMLElement; shell: HTMLElement } | null;
  update: (clientX: number, clientY: number) => HTMLElement | null | undefined;
  clear: () => void;
  apply: (key: string, sourceActiveTabKey: string) => boolean;
};

type TabDrag = {
  key: string;
  context: string;
  source: TabDragSource;
  tab: HTMLElement;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  dragging: boolean;
  ghost: HTMLElement | null;
  autoScrollFrame: number;
  controller: AbortController;
};

const DRAG_THRESHOLD = 5;
const CLICK_SUPPRESSION_MS = 350;

export function workspaceTabInsertion(tabs: Element, clientX: number, selector = '.tab:not(.tab-dragging)') {
  const candidates = [...tabs.querySelectorAll<HTMLElement>(selector)];
  const index = candidates.findIndex(tab => {
    const rect = tab.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  return { index: index < 0 ? candidates.length : index, before: candidates[index] || null };
}

function createDragGhost(drag: TabDrag, presentation: { icon: string; title: string }) {
  const ghost = document.createElement('div');
  ghost.className = 'workspace-tab-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  if (presentation.icon) ghost.insertAdjacentHTML('beforeend', presentation.icon);
  const title = document.createElement('span');
  title.textContent = presentation.title || drag.tab.textContent?.trim() || '';
  ghost.appendChild(title);
  document.body.appendChild(ghost);
  drag.ghost = ghost;
}

function updateDragGhost(drag: TabDrag, hint?: HTMLElement | null) {
  const ghost = drag.ghost;
  if (!ghost) return;
  const { pointerX, pointerY } = drag;
  const rect = ghost.getBoundingClientRect();
  const gap = 12;
  const left = Math.max(8, Math.min(pointerX - rect.width / 2, window.innerWidth - rect.width - 8));
  const preferredTop = pointerY - rect.height - gap;
  let top = preferredTop >= 8 ? preferredTop : Math.min(pointerY + gap, window.innerHeight - rect.height - 8);
  const hintRect = hint?.getBoundingClientRect();
  if (hintRect && left < hintRect.right && left + rect.width > hintRect.left
      && top < hintRect.bottom && top + rect.height > hintRect.top) {
    const aboveHint = hintRect.top - rect.height - gap;
    const belowHint = hintRect.bottom + gap;
    if (aboveHint >= 8) top = aboveHint;
    else if (belowHint + rect.height <= window.innerHeight - 8) top = belowHint;
  }
  ghost.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
}

function markDragging(tab: HTMLElement, active: boolean) {
  tab.classList.toggle('tab-dragging', active);
  if (active) tab.setAttribute('aria-grabbed', 'true');
  else tab.removeAttribute('aria-grabbed');
}

function scrollTabs(drag: TabDrag, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const edge = Math.min(42, Math.max(20, rect.width / 5));
  const amount = drag.pointerX < rect.left + edge ? -10 : drag.pointerX > rect.right - edge ? 10 : 0;
  const previous = container.scrollLeft;
  if (amount) container.scrollLeft += amount;
  return container.scrollLeft !== previous;
}

export function createWorkspaceTabDrag(port: WorkspaceTabDragPort, dock: DockTabTarget) {
  let pending: TabDrag | null = null;
  let suppressClickUntil = 0;

  function stillOwnsSource(drag: TabDrag) {
    return port.context() === drag.context && port.source(drag.key)?.paneId === drag.source.paneId;
  }

  function finish(cancelled: boolean, event?: PointerEvent, exiting = false) {
    const drag = pending;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    pending = null;
    drag.controller.abort();
    if (drag.autoScrollFrame) cancelAnimationFrame(drag.autoScrollFrame);
    const capture = drag.source.tab;
    try {
      if (capture.hasPointerCapture(drag.pointerId)) capture.releasePointerCapture(drag.pointerId);
    } catch { /* The original tab can be replaced during a drag. */ }
    document.body.classList.remove('workspace-tab-drag-active');
    markDragging(drag.tab, false);
    drag.ghost?.remove();
    if (drag.dragging) suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;

    const owned = drag.dragging && !exiting && stillOwnsSource(drag);
    let applied = false;
    try {
      if (owned && !cancelled) applied = dock.apply(drag.key, drag.source.activeTabKey);
    } finally {
      dock.clear();
    }
    if (owned && !applied) port.render();
  }

  function autoScroll(drag: TabDrag) {
    if (!stillOwnsSource(drag)) return finish(true);
    const area = dock.scrollArea(drag.source.paneId);
    const rect = area?.shell.getBoundingClientRect();
    if (area && rect && drag.pointerY >= rect.top && drag.pointerY <= rect.bottom && scrollTabs(drag, area.tabs)) {
      updateDragGhost(drag, dock.update(drag.pointerX, drag.pointerY));
    }
    drag.autoScrollFrame = requestAnimationFrame(() => autoScroll(drag));
  }

  function move(drag: TabDrag, event: PointerEvent) {
    if (event.pointerId !== drag.pointerId) return;
    const source = port.source(drag.key);
    if (!source || source.paneId !== drag.source.paneId || port.context() !== drag.context) return finish(true);
    if (source.tab !== drag.tab) {
      markDragging(drag.tab, false);
      drag.tab = source.tab;
      if (drag.dragging) markDragging(drag.tab, true);
    }
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    if (!drag.dragging) {
      const dx = Math.abs(drag.pointerX - drag.startX);
      const dy = Math.abs(drag.pointerY - drag.startY);
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (dy > dx && port.mobile() && drag.pointerType === 'touch') return finish(true);
      drag.dragging = true;
      try { drag.tab.setPointerCapture(drag.pointerId); } catch { /* Synthetic events cannot capture a native pointer. */ }
      markDragging(drag.tab, true);
      document.body.classList.add('workspace-tab-drag-active');
      createDragGhost(drag, port.presentation(drag.key));
      port.hideMenu();
      drag.autoScrollFrame = requestAnimationFrame(() => autoScroll(drag));
    }
    event.preventDefault();
    updateDragGhost(drag, dock.update(drag.pointerX, drag.pointerY));
  }

  function begin(event: PointerEvent, key: string) {
    if (event.button !== 0 || (event.target as Element | null)?.closest('.tab-close')
        || port.selectionMode() || event.ctrlKey || event.metaKey) return;
    finish(true);
    const source = port.source(key);
    if (!source) return;
    port.activateSource(key, source);
    const tab = port.source(key)?.tab;
    if (!tab) return;
    const controller = new AbortController();
    const drag = pending = {
      key, context: port.context(), source: { ...source, tab }, tab, pointerId: event.pointerId, pointerType: event.pointerType,
      startX: event.clientX, startY: event.clientY, pointerX: event.clientX, pointerY: event.clientY,
      dragging: false, ghost: null, autoScrollFrame: 0, controller
    };
    const { signal } = controller;
    window.addEventListener('pointermove', event => move(drag, event), { passive: false, signal });
    window.addEventListener('pointerup', event => finish(false, event), { signal });
    window.addEventListener('pointercancel', event => finish(true, event), { signal });
    window.addEventListener('keydown', event => { if (event.key === 'Escape') finish(true); }, { signal });
    window.addEventListener('pagehide', () => finish(true, undefined, true), { signal });
  }

  return { begin, suppressClick: () => Date.now() < suppressClickUntil, dispose: () => finish(true, undefined, true) };
}
