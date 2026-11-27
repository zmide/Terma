import {tr} from '@/shared/i18n/workspace-bootstrap';
import '@/styles/dialog-window.css';

const cardSelector = '.modal-card, .forward-dialog-root, [role="dialog"], [role="alertdialog"]';
const nestedSelector = '.automation-layer, .sftp-automation-confirm-layer';
const headingSelector = 'h1, h2, [data-dialog-title], .quick-panel-search';
const interactive = 'button, a, input, textarea, select, label, [contenteditable], [role="button"]';
const margin = 6;
type Box = { left: number; top: number; width: number; height: number };
type WindowControl = { card: HTMLElement; grip: HTMLButtonElement; title?: HTMLElement; x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

function bounds(card: HTMLElement): Box {
  const layer = card.parentElement?.closest(nestedSelector)?.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const left = Math.max(viewportLeft, layer?.left ?? 0) + margin;
  const top = Math.max(viewportTop, layer?.top ?? 0) + margin;
  const right = Math.min(viewportLeft + (viewport?.width || document.documentElement.clientWidth), layer?.right ?? Infinity) - margin;
  const bottom = Math.min(viewportTop + (viewport?.height || document.documentElement.clientHeight), layer?.bottom ?? Infinity) - margin;
  return { left, top, width: right - left, height: bottom - top };
}

function setGeometry(control: WindowControl, base: Box, dx: number, dy: number, resize: boolean) {
  const { card } = control;
  const limit = bounds(card);
  if (limit.width <= 0 || limit.height <= 0) return;
  const width = clamp(base.width + (resize ? dx : 0), Math.min(260, limit.width), limit.width);
  const height = clamp(base.height + (resize ? dy : 0), Math.min(135, limit.height), limit.height);
  if (resize || base.width > limit.width || base.height > limit.height) {
    card.dataset.dialogSized = '';
    card.style.setProperty('--dialog-width', `${width}px`);
    card.style.setProperty('--dialog-height', `${height}px`);
  }
  const rect = card.getBoundingClientRect();
  const left = clamp(base.left + (resize ? 0 : dx), limit.left, limit.left + limit.width - rect.width);
  const top = clamp(base.top + (resize ? 0 : dy), limit.top, limit.top + limit.height - rect.height);
  control.x += left - rect.left;
  control.y += top - rect.top;
  card.style.setProperty('--dialog-offset', `${control.x}px ${control.y}px`);
}

export function installDialogWindows(modal: HTMLElement, options: { palette?: boolean; label?: () => string } = {}) {
  const controls = new Map<HTMLElement, WindowControl>();
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let quickPanel: HTMLElement | null = null;
  let gesture: { control: WindowControl; pointer: number; x: number; y: number; base: Box; resize: boolean } | null = null;
  let scheduled = false;
  const localize = (grip: HTMLElement) => {
    const text = options.label?.() ?? tr!('common:actions.adjust_dialog_window');
    grip.title = text;
    grip.setAttribute('aria-label', text);
  };

  function collect() {
    scheduled = false;
    if (options.palette && !quickPanel) {
      quickPanel = document.getElementById('quickPanel');
      if (quickPanel) observer.observe(quickPanel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-command-page'] });
    }
    const embedded = options.palette && Boolean(modal.closest('#quickPanel'));
    const candidates = [...modal.querySelectorAll<HTMLElement>(cardSelector)].filter(card => {
      const outer = card.parentElement?.closest(cardSelector);
      const layer = card.parentElement?.closest(nestedSelector);
      return (!embedded || layer) && (!outer || layer && !layer.contains(outer));
    });
    const palette = quickPanel?.querySelector<HTMLElement>('.quick-panel-dialog');
    if (palette) candidates.push(palette);
    for (const [card, control] of controls) {
      if (!candidates.includes(card) || card.closest('[hidden]')) {
        control.grip.remove();
        control.title?.removeAttribute('data-dialog-drag');
        delete card.dataset.dialogWindow;
        delete card.dataset.dialogSized;
        for (const property of ['--dialog-width', '--dialog-height', '--dialog-offset']) card.style.removeProperty(property);
        controls.delete(card);
      }
    }
    for (const card of candidates) {
      if (card.closest('[hidden]')) continue;
      let control = controls.get(card);
      if (!control) {
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'dialog-window-resize';
        localize(grip);
        control = { card, grip, x: 0, y: 0 };
        card.dataset.dialogWindow = '';
        controls.set(card, control);
      }
      if (control.grip.parentElement !== card) card.append(control.grip);
      const heading = card.querySelector<HTMLElement>('.command-page-toolbar') || card.querySelector<HTMLElement>(headingSelector);
      const title = heading?.closest<HTMLElement>('.modal-title-row, .terma-about-modal-head, .forward-editor > header, .command-page-toolbar, .sftp-editor-head') || heading;
      if (control.title !== title) {
        control.title?.removeAttribute('data-dialog-drag');
        control.title = title || undefined;
        title?.setAttribute('data-dialog-drag', '');
      }
    }
  }

  function schedule() {
    if (scheduled || signal.aborted) return;
    scheduled = true;
    queueMicrotask(() => { if (!signal.aborted) collect(); });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(modal, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  // The command palette is mounted lazily next to the application shell.
  if (options.palette) observer.observe(document.body, { childList: true });
  collect();

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('.dialog-window-resize, [data-dialog-drag]');
    const card = target?.closest<HTMLElement>('[data-dialog-window]');
    const control = card && controls.get(card);
    if (!target || !card || !control) return;
    const resize = target === control.grip;
    if (!resize && event.target.closest(interactive)) return;
    if (!event.target.closest(nestedSelector) && [...card.querySelectorAll(nestedSelector)].some(layer => layer.checkVisibility())) return;
    gesture = { control, pointer: event.pointerId, x: event.clientX, y: event.clientY, base: card.getBoundingClientRect(), resize };
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { signal });
  document.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointer !== event.pointerId || !gesture.control.card.isConnected) return;
    if (event.clientX === gesture.x && event.clientY === gesture.y && !gesture.control.x && !gesture.control.y) return;
    setGeometry(gesture.control, gesture.base, event.clientX - gesture.x, event.clientY - gesture.y, gesture.resize);
  }, { signal });
  const finish = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) gesture = null; };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) document.addEventListener(name, finish, { signal });
  document.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches('.dialog-window-resize')) return;
    const card = event.target.parentElement;
    const control = card && controls.get(card);
    const step = event.shiftKey ? 32 : 12;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!control || (!dx && !dy)) return;
    event.preventDefault();
    setGeometry(control, control.card.getBoundingClientRect(), dx, dy, !event.altKey);
  }, { signal });
  document.addEventListener('scroll', event => {
    const control = event.target instanceof HTMLElement && controls.get(event.target);
    if (!control) return;
    control.grip.style.translate = `${control.card.scrollLeft}px ${control.card.scrollTop}px`;
  }, { capture: true, signal });
  const constrainWindows = () => {
    for (const control of controls.values()) {
      if (control.card.checkVisibility() && (control.x || control.y || 'dialogSized' in control.card.dataset)) {
        setGeometry(control, control.card.getBoundingClientRect(), 0, 0, false);
      }
    }
  };
  window.addEventListener('resize', constrainWindows, { signal });
  window.visualViewport?.addEventListener('resize', constrainWindows, { signal });
  window.visualViewport?.addEventListener('scroll', constrainWindows, { signal });
  const updateLabels = () => controls.forEach(({ grip }) => localize(grip));
  window.addEventListener('terma:language-changed', updateLabels, { signal });
  const language = new MutationObserver(updateLabels);
  if (options.label) language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => {
    lifetime.abort();
    observer.disconnect();
    language.disconnect();
    for (const { grip } of controls.values()) grip.remove();
    controls.clear();
  };
}
