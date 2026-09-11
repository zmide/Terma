const terminalToolbarScrollStates = new WeakMap();

function terminalToolbarScrollLabel(direction) {
  return direction === "left"
    ? tr("common:auto.scroll_left", {defaultValue:"向左滚动快捷按钮"})
    : tr("common:auto.scroll_right", {defaultValue:"向右滚动快捷按钮"});
}

function terminalToolbarScrollState(actions) {
  const state = terminalToolbarScrollStates.get(actions);
  if (!state) return;
  const overflow = actions.scrollWidth > actions.clientWidth + 1;
  const canScrollLeft = overflow && actions.scrollLeft > 1;
  const canScrollRight = overflow && actions.scrollLeft + actions.clientWidth < actions.scrollWidth - 1;
  state.shell.classList.toggle("is-scrollable", overflow);
  state.shell.classList.toggle("can-scroll-left", canScrollLeft);
  state.shell.classList.toggle("can-scroll-right", canScrollRight);
  state.left.hidden = !overflow;
  state.right.hidden = !overflow;
  state.left.disabled = !canScrollLeft;
  state.right.disabled = !canScrollRight;
  state.left.setAttribute("aria-disabled", String(!canScrollLeft));
  state.right.setAttribute("aria-disabled", String(!canScrollRight));
}

function scheduleTerminalToolbarScrollState(actions) {
  const state = terminalToolbarScrollStates.get(actions);
  if (!state || state.frame) return;
  const update = () => {
    state.frame = 0;
    terminalToolbarScrollState(actions);
  };
  state.frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(update) : setTimeout(update, 0);
}

function scrollTerminalToolbarActions(actions, direction) {
  if (!actions || actions.scrollWidth <= actions.clientWidth + 1) return;
  const step = Math.max(120, Math.round(actions.clientWidth * 0.78));
  const target = Math.max(0, Math.min(actions.scrollWidth - actions.clientWidth, actions.scrollLeft + direction * step));
  actions.scrollLeft = target;
  terminalToolbarScrollState(actions);
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("terminal-toolbar-scroll", ({element}) => {
    const actions = element.closest(".terminal-actions-scroll-shell")?.querySelector(".terminal-actions");
    scrollTerminalToolbarActions(actions, element.dataset.scrollDirection === "left" ? -1 : 1);
  });
}

function bindTerminalToolbarScroll(toolbar) {
  const actions = toolbar?.querySelector?.(".terminal-actions");
  if (!actions || actions.dataset.workspaceHorizontalScroll === "1") return;
  actions.dataset.workspaceHorizontalScroll = "1";
  actions.tabIndex = 0;
  actions.addEventListener("wheel", event => {
    if (actions.scrollWidth <= actions.clientWidth + 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const previous = actions.scrollLeft;
    actions.scrollLeft += delta;
    terminalToolbarScrollState(actions);
    if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
  }, {passive:false});
  actions.addEventListener("scroll", () => terminalToolbarScrollState(actions), {passive:true});
  actions.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || actions.scrollWidth <= actions.clientWidth + 1) return;
    const previous = actions.scrollLeft;
    if (event.key === "Home") actions.scrollLeft = 0;
    else if (event.key === "End") actions.scrollLeft = actions.scrollWidth;
    else actions.scrollLeft += event.key === "ArrowLeft" ? -120 : 120;
    terminalToolbarScrollState(actions);
    if (Math.abs(actions.scrollLeft - previous) > 0.5) event.preventDefault();
  });

  const shell = document.createElement("div");
  shell.className = "terminal-actions-scroll-shell";
  shell.setAttribute("data-terminal-actions-scroll-shell", "true");
  const leftLabel = terminalToolbarScrollLabel("left");
  const rightLabel = terminalToolbarScrollLabel("right");
  const left = document.createElement("button");
  left.type = "button";
  left.className = "terminal-actions-scroll-button terminal-actions-scroll-left icon-button";
  left.dataset.action = "terminal-toolbar-scroll";
  left.dataset.scrollDirection = "left";
  left.dataset.i18nTitle = "common:auto.scroll_left";
  left.dataset.i18nAriaLabel = "common:auto.scroll_left";
  left.title = leftLabel;
  left.setAttribute("aria-label", leftLabel);
  left.innerHTML = icon("chevron-left");
  const right = document.createElement("button");
  right.type = "button";
  right.className = "terminal-actions-scroll-button terminal-actions-scroll-right icon-button";
  right.dataset.action = "terminal-toolbar-scroll";
  right.dataset.scrollDirection = "right";
  right.dataset.i18nTitle = "common:auto.scroll_right";
  right.dataset.i18nAriaLabel = "common:auto.scroll_right";
  right.title = rightLabel;
  right.setAttribute("aria-label", rightLabel);
  right.innerHTML = icon("chevron-right");
  actions.parentElement?.insertBefore(shell, actions);
  shell.append(left, actions, right);
  const state = {shell, left, right, frame:0};
  terminalToolbarScrollStates.set(actions, state);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => scheduleTerminalToolbarScrollState(actions)) : null;
  observer?.observe(actions);
  const mutationObserver = typeof MutationObserver === "function" ? new MutationObserver(() => scheduleTerminalToolbarScrollState(actions)) : null;
  mutationObserver?.observe(actions, {childList:true, subtree:true, attributes:true, attributeFilter:["class", "style", "hidden"]});
  state.resizeObserver = observer;
  state.mutationObserver = mutationObserver;
  terminalToolbarScrollState(actions);
}
