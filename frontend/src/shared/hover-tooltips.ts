import { getTooltipPosition, TOOLTIP_VIEWPORT_MARGIN } from '@/components/ui/lib/core';

const tooltipDelay = 450;

export function installHoverTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'terma-hover-tooltip';
  tooltip.setAttribute('aria-hidden', 'true'); // The trigger already supplies its accessible name or description.
  let hovered: Element | null = null;
  let hoverTitle: string | null = null;
  let focused: Element | null = null;
  let timer: number | undefined;

  const titleOwner = (target: EventTarget | null) => target instanceof Element ? target.closest('[title]') : null;
  const hide = () => {
    window.clearTimeout(timer);
    tooltip.remove();
  };
  function show(anchor: Element, text: string | null) {
    if (!text?.trim() || !anchor.isConnected || !anchor.getClientRects().length) return;
    tooltip.textContent = text;
    (document.fullscreenElement || document.body).append(tooltip);
    const triggerRect = anchor.getBoundingClientRect();
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const contentSize = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
    const sideOffset = 6;
    const side = triggerRect.bottom + sideOffset + contentSize.height <= height - TOOLTIP_VIEWPORT_MARGIN ? 'bottom' : 'top';
    const position = getTooltipPosition({ triggerRect, contentSize, side, sideOffset, viewport: { width, height } });
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  }
  const titleObserver = new MutationObserver(() => {
    if (!hovered) return;
    hoverTitle = hovered.getAttribute('title');
    if (hoverTitle) {
      hovered.setAttribute('title', '');
      titleObserver.takeRecords();
    }
    if (!hoverTitle || !hovered.isConnected) hide();
    else if (tooltip.isConnected) show(hovered, hoverTitle);
  });
  function releaseHover() {
    titleObserver.disconnect();
    if (hovered?.getAttribute('title') === '' && hoverTitle) hovered.setAttribute('title', hoverTitle);
    hovered = null;
    hoverTitle = null;
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch' || event.buttons) return;
    const anchor = titleOwner(event.target);
    if (anchor === hovered || (hovered && hovered.contains(event.target as Node) && !anchor)) return;
    releaseHover();
    hide();
    const text = anchor?.getAttribute('title');
    if (!anchor || !text?.trim()) return;
    focused = null;
    hovered = anchor;
    hoverTitle = text;
    // Suppress the native Chromium tooltip only while the pointer is over this title.
    anchor.setAttribute('title', '');
    titleObserver.observe(anchor, { attributes: true, attributeFilter: ['title'] });
    timer = window.setTimeout(() => {
      if (hovered === anchor) show(anchor, hoverTitle);
    }, tooltipDelay);
  }, true);
  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch' || !hovered?.contains(event.target as Node) || hovered.contains(event.relatedTarget as Node | null)) return;
    releaseHover();
    hide();
  }, true);
  document.addEventListener('focusin', event => {
    const anchor = titleOwner(event.target);
    if (!anchor?.matches(':focus-visible') || anchor === hovered) return;
    hide();
    focused = anchor;
    timer = window.setTimeout(() => {
      if (focused === anchor) show(anchor, anchor.getAttribute('title'));
    }, tooltipDelay);
  });
  document.addEventListener('focusout', event => {
    if (focused !== event.target) return;
    focused = null;
    hide();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, true);
  document.addEventListener('pointerdown', () => { releaseHover(); hide(); }, true);
  document.addEventListener('contextmenu', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', () => { releaseHover(); focused = null; hide(); });
}
