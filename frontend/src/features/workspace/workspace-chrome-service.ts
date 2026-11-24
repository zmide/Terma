import {workspaceServices} from '@/features/workspace/installed-services';
type ResizeOptions = { persist?: boolean; fit?: boolean };
type ChromePort = { mobile(): boolean; operationCollapsed(): boolean; fitContent(): void };

const dimensions = {
  header: {
    min: 34, max: 64, initial: 42, key: 'workspaceHeaderHeight', prefix: '--workspace-header-',
    axis: 'clientY', step: 1, handle: 'workspaceHeaderResize', classes: ['workspace-chrome-resizing', 'workspace-header-resizing'],
    metrics: [
      ['title-size', 14, .2, 12, 18],
      ['subtitle-size', 10, .12, 9, 13],
      ['control-height', 30, .27, 27, 36],
      ['control-font-size', 12, .1, 11, 14],
      ['icon-size', 14, .13, 13, 17]
    ]
  },
  tabs: {
    min: 26, max: 48, initial: 32, key: 'workspaceTabHeight', prefix: '--workspace-tab-',
    axis: 'clientY', step: 1, classes: ['workspace-chrome-resizing', 'workspace-tab-resizing'],
    metrics: [
      ['font-size', 12, .18, 10.5, 15],
      ['dot-size', 7, .1, 6, 9],
      ['close-size', 18, .2, 16, 22],
      ['horizontal-padding', 8, .2, 6, 11]
    ]
  },
  activity: {
    min: 36, max: 64, initial: 40, key: 'activityBarWidth', prefix: '--activity-bar-',
    axis: 'clientX', step: 1, classes: ['activity-bar-resizing']
  },
  operation: {
    min: 260, max: 520, initial: 292, key: 'operationPaneWidth', prefix: '--operation-pane-',
    axis: 'clientX', step: 4, handle: 'operationPaneResize', classes: ['operation-pane-resizing']
  }
} as const;

type ResizeKind = keyof typeof dimensions;
const kinds = Object.keys(dimensions) as ResizeKind[];

function createWorkspaceChromeService(port: ChromePort) {
  const values = Object.fromEntries(kinds.map(kind => [kind, dimensions[kind].initial])) as Record<ResizeKind, number>;
  const handles = new Map<HTMLElement, { kind: ResizeKind; listeners: AbortController }>();
  let drag: { kind: ResizeKind; handle: HTMLElement; pointerId: number; startPosition: number; startValue: number } | undefined;
  let dragListeners: AbortController | undefined;
  let fitFrame = 0;
  let fitTimer = 0;
  let lastFit = 0;

  function fit() {
    if (fitFrame || fitTimer) return;
    const remaining = drag ? 64 - (performance.now() - lastFit) : 0;
    if (remaining > 0) {
      fitTimer = window.setTimeout(() => {
        fitTimer = 0;
        fit();
      }, remaining);
      return;
    }
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      lastFit = performance.now();
      port.fitContent();
    });
  }

  function apply(kind: ResizeKind, requested: number, options: ResizeOptions = {}) {
    const config = dimensions[kind];
    const { min, max, initial, key, prefix, axis } = config;
    const value = Number.isFinite(requested) ? Math.max(min, Math.min(max, Math.round(requested))) : initial;
    values[kind] = value;
    const root = document.documentElement;
    root.style.setProperty(prefix + (axis === 'clientX' ? 'width' : 'height'), `${value}px`);
    if ('metrics' in config) {
      for (const [name, base, slope, lower, upper] of config.metrics) {
        const scaled = Math.max(lower, Math.min(upper, base + (value - initial) * slope));
        root.style.setProperty(prefix + name, scaled.toFixed(2) + 'px');
      }
    } else {
      root.classList.toggle('operation-pane-narrow', values.operation - values.activity < 228);
    }
    for (const [handle, binding] of handles) {
      if (binding.kind === kind) handle.setAttribute('aria-valuenow', String(value));
    }
    if (options.persist) {
      try { localStorage.setItem(key, String(value)); } catch { /* Storage may be disabled. */ }
    }
    if (options.fit !== false) fit();
  }

  function restore() {
    for (const kind of kinds) {
      let saved: string | null = null;
      try { saved = localStorage.getItem(dimensions[kind].key); } catch { /* Use the default. */ }
      apply(kind, saved?.trim() ? Number(saved) : dimensions[kind].initial, { fit: false });
    }
  }

  function finish(cancelled: boolean, refit = true) {
    if (!drag) return;
    const { kind, handle, pointerId, startValue } = drag;
    drag = undefined;
    dragListeners?.abort();
    dragListeners = undefined;
    try {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } catch { /* The browser may already have released the pointer. */ }
    document.body.classList.remove(...dimensions[kind].classes);
    clearTimeout(fitTimer);
    fitTimer = 0;
    apply(kind, cancelled ? startValue : values[kind], { persist: !cancelled, fit: refit });
  }

  function canResize(kind: ResizeKind) {
    return !port.mobile() && (kind !== 'operation' || !port.operationCollapsed());
  }

  function begin(event: PointerEvent, handle: HTMLElement, kind: ResizeKind) {
    if (event.button !== 0 || !canResize(kind)) return;
    finish(true);
    event.preventDefault();
    event.stopPropagation();
    const { pointerId } = event;
    const { axis } = dimensions[kind];
    drag = { kind, handle, pointerId, startPosition: event[axis], startValue: values[kind] };
    try { handle.setPointerCapture(pointerId); } catch { /* Capture is optional for synthetic input. */ }
    document.body.classList.add(...dimensions[kind].classes);
    dragListeners = new AbortController();
    const { signal } = dragListeners;
    window.addEventListener('pointermove', move => {
      if (!drag || move.pointerId !== drag.pointerId) return;
      move.preventDefault();
      apply(kind, drag.startValue + move[axis] - drag.startPosition);
    }, { passive: false, signal });
    window.addEventListener('pointerup', up => { if (up.pointerId === pointerId) finish(false); }, { signal });
    window.addEventListener('pointercancel', cancel => { if (cancel.pointerId === pointerId) finish(true); }, { signal });
    window.addEventListener('blur', () => finish(false), { signal });
  }

  function bind(handle: HTMLElement, kind: ResizeKind) {
    if (handles.has(handle)) return;
    const listeners = new AbortController();
    handles.set(handle, { kind, listeners });
    const { signal } = listeners;
    const { min, max, initial, axis, step } = dimensions[kind];
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(values[kind]));
    handle.addEventListener('pointerdown', event => begin(event, handle, kind), { signal });
    handle.addEventListener('pointercancel', event => {
      if (drag?.handle === handle && drag.pointerId === event.pointerId) finish(true);
    }, { signal });
    handle.addEventListener('lostpointercapture', event => {
      if (drag?.handle === handle && drag.pointerId === event.pointerId) finish(false);
    }, { signal });
    handle.addEventListener('dblclick', event => {
      if (port.mobile()) return;
      event.preventDefault();
      event.stopPropagation();
      apply(kind, initial, { persist: true });
    }, { signal });
    handle.addEventListener('keydown', event => {
      if (!canResize(kind)) return;
      const delta = step * (event.shiftKey ? 4 : 1);
      const [decrease, increase] = axis === 'clientX' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      const changes = { [decrease]: values[kind] - delta, [increase]: values[kind] + delta, Home: min, End: max };
      if (!Object.hasOwn(changes, event.key)) return;
      event.preventDefault();
      apply(kind, changes[event.key as keyof typeof changes], { persist: true });
    }, { signal });
  }

  function unbind(handle: HTMLElement) {
    handles.get(handle)?.listeners.abort();
    handles.delete(handle);
    if (drag?.handle === handle) finish(true);
  }

  window.addEventListener('pagehide', () => {
    finish(true, false);
    cancelAnimationFrame(fitFrame);
    clearTimeout(fitTimer);
    fitFrame = fitTimer = 0;
  });

  return {
    apply, restore, fit, bind, unbind, value: (kind: ResizeKind) => values[kind],
    cancel: () => finish(true)
  };
}

export function installWorkspaceChromeService(port: ChromePort) {
  if (workspaceServices.termaWorkspaceChrome) return;
  const chrome = createWorkspaceChromeService(port);
  workspaceServices.termaWorkspaceChrome = chrome;
  chrome.restore();
  for (const kind of kinds) {
    const config = dimensions[kind];
    if (!('handle' in config)) continue;
    const element = document.getElementById(config.handle);
    if (element) chrome.bind(element, kind);
  }
}



export interface InstalledFeaturesWorkspaceWorkspaceChromeServiceServices {
  termaWorkspaceChrome?: ReturnType<typeof createWorkspaceChromeService>;
}
