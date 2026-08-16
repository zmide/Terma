const terminalQuickCommandStorage = Object.freeze({
  visible:"terminalQuickCommandsVisible",
  height:"terminalQuickCommandsHeight"
});
const terminalQuickCommandHeightLimits = Object.freeze({min:32, max:280, fallback:76});
let terminalQuickCommandDrag = null;
let terminalQuickCommandSuppressClick = {id:0, until:0};

function terminalQuickCommandsVisible() {
  return localStorage.getItem(terminalQuickCommandStorage.visible) !== "0";
}

function terminalQuickCommandsHeight() {
  const value = Number(localStorage.getItem(terminalQuickCommandStorage.height));
  return Number.isFinite(value)
    ? Math.max(terminalQuickCommandHeightLimits.min, Math.min(terminalQuickCommandHeightLimits.max, value))
    : terminalQuickCommandHeightLimits.fallback;
}

function terminalQuickCommandToolbarButton(key) {
  const visible = terminalQuickCommandsVisible();
  const label = tr(visible ? "terminal:quick_commands.hide" : "terminal:quick_commands.show");
  return `<button class="terminal-action-quick-commands${visible ? " active" : ""}" data-terminal-quick-command-toggle data-terminal-key="${escAttr(key)}" title="${escAttr(label)}" aria-label="${escAttr(label)}" aria-pressed="${visible}">${icon("list-checks")}<span>${esc(tr("terminal:quick_commands.toolbar"))}</span></button>`;
}

function renderTerminalQuickCommandBar(key) {
  const visible = terminalQuickCommandsVisible();
  const compact = terminalQuickCommandsHeight() <= 54;
  return `<section class="terminal-quick-command-bar${visible ? "" : " hidden"}${compact ? " compact" : ""}" data-terminal-quick-command-bar data-terminal-key="${escAttr(key)}" style="--terminal-quick-command-height:${terminalQuickCommandsHeight()}px" aria-label="${escAttr(tr("terminal:quick_commands.bar"))}">
    <div class="terminal-quick-command-resizer" data-terminal-quick-command-resizer role="separator" aria-label="${escAttr(tr("terminal:quick_commands.resize"))}" aria-orientation="horizontal" tabindex="0"></div>
    <button type="button" class="icon-button terminal-quick-command-manage" data-terminal-quick-command-manage title="${escAttr(tr("terminal:quick_commands.manage"))}" aria-label="${escAttr(tr("terminal:quick_commands.manage"))}">${icon("sliders-horizontal")}</button>
    <div class="terminal-quick-command-list" data-terminal-quick-command-list title="${escAttr(tr("terminal:quick_commands.double_click_add"))}"></div>
  </section>`;
}

function terminalQuickCommandItems() {
  return productivityState.snippets.filter(item => Number(item.quick_visible)).sort((left, right) => {
    const leftOrder = Math.max(0, Number(left.quick_sort_order || 0));
    const rightOrder = Math.max(0, Number(right.quick_sort_order || 0));
    if (leftOrder && rightOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (Boolean(leftOrder) !== Boolean(rightOrder)) return leftOrder ? -1 : 1;
    return Number(left.created_at || left.id || 0) - Number(right.created_at || right.id || 0)
      || Number(left.id || 0) - Number(right.id || 0);
  });
}

function paintTerminalQuickCommandBar(bar) {
  const list = bar?.querySelector("[data-terminal-quick-command-list]");
  if (!list) return;
  const items = terminalQuickCommandItems();
  list.innerHTML = items.length
    ? items.map(item => {
      const badge = commandSnippetBadgeGlyph(item.quick_badge);
      return `<button type="button" class="terminal-quick-command ${escAttr(item.quick_color || "blue")}${badge ? "" : " no-badge"}" data-terminal-quick-command-id="${Number(item.id)}" title="${escAttr(item.description || item.command)}"><span class="terminal-quick-command-drag" data-terminal-quick-command-drag role="button" tabindex="0" title="${escAttr(tr("terminal:quick_commands.drag_reorder"))}" aria-label="${escAttr(tr("terminal:quick_commands.drag_named", {name:item.name}))}">${icon("grip-vertical")}</span>${badge ? `<span class="terminal-quick-command-badge" aria-hidden="true">${esc(badge)}</span>` : ""}<span class="terminal-quick-command-name">${esc(item.name)}</span><small>${esc(tr(item.quick_action === "insert" ? "terminal:quick_commands.insert" : "terminal:quick_commands.execute"))}</small></button>`;
    }).join("")
    : `<div class="terminal-quick-command-empty">${icon("plus")}<span>${esc(tr("terminal:quick_commands.double_click_add"))}</span></div>`;
  refreshIcons();
}

function syncTerminalQuickCommandCompact(bar, height=terminalQuickCommandsHeight()) {
  bar?.classList.toggle("compact", Number(height) <= 54);
}

async function persistTerminalQuickCommandOrder(list) {
  const ids = [...list.querySelectorAll("[data-terminal-quick-command-id]")].map(button => Number(button.dataset.terminalQuickCommandId)).filter(Boolean);
  if (!ids.length) return;
  const previous = new Map(productivityState.snippets.map(item => [Number(item.id), Number(item.quick_sort_order || 0)]));
  ids.forEach((id, index) => {
    const item = productivityState.snippets.find(row => Number(row.id) === id);
    if (item) item.quick_sort_order = index + 1;
  });
  refreshTerminalQuickCommandBars();
  try {
    for (const id of ids) {
      const item = productivityState.snippets.find(row => Number(row.id) === id);
      if (item) await api(`/api/command-snippets/${id}`, {method:"PUT", body:JSON.stringify(item)});
    }
  } catch (error) {
    productivityState.snippets.forEach(item => {
      if (previous.has(Number(item.id))) item.quick_sort_order = previous.get(Number(item.id));
    });
    refreshTerminalQuickCommandBars();
    notify(tr("terminal:quick_commands.sort_save_failed", {error:error.message || tr("terminal:batch.operation_failed")}), "error");
  }
}

function moveTerminalQuickCommandByKeyboard(handle, direction) {
  const button = handle.closest("[data-terminal-quick-command-id]");
  const list = button?.parentElement;
  if (!button || !list) return;
  const items = [...list.querySelectorAll("[data-terminal-quick-command-id]")];
  const index = items.indexOf(button);
  const target = items[index + direction];
  if (!target) return;
  if (direction < 0) list.insertBefore(button, target);
  else list.insertBefore(target, button);
  const id = Number(button.dataset.terminalQuickCommandId);
  void persistTerminalQuickCommandOrder(list);
  requestAnimationFrame(() => list.querySelector(`[data-terminal-quick-command-id="${id}"] [data-terminal-quick-command-drag]`)?.focus());
}

function beginTerminalQuickCommandDrag(event) {
  const handle = event.target.closest?.("[data-terminal-quick-command-drag]");
  const button = handle?.closest?.("[data-terminal-quick-command-id]");
  const list = button?.parentElement;
  if (!handle || !button || !list || event.button !== 0 || terminalQuickCommandDrag) return;
  event.preventDefault();
  event.stopPropagation();
  const state = {handle,button,list,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,moved:false};
  terminalQuickCommandDrag = state;
  try { handle.setPointerCapture?.(event.pointerId); } catch {}
  button.classList.add("dragging");
  const move = moveEvent => {
    if (terminalQuickCommandDrag !== state || moveEvent.pointerId !== state.pointerId) return;
    if (!state.moved && Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY) < 4) return;
    state.moved = true;
    const direct = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.("[data-terminal-quick-command-id]");
    const target = direct?.parentElement === list && direct !== button ? direct : [...list.querySelectorAll("[data-terminal-quick-command-id]")]
      .filter(item => item !== button)
      .find(item => {
        const box = item.getBoundingClientRect();
        return moveEvent.clientX >= box.left && moveEvent.clientX <= box.right && moveEvent.clientY >= box.top && moveEvent.clientY <= box.bottom;
      });
    if (!target || target === button || target.parentElement !== list) return;
    const rect = target.getBoundingClientRect();
    const sameRow = moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom;
    const before = sameRow ? moveEvent.clientX < rect.left + rect.width / 2 : moveEvent.clientY < rect.top + rect.height / 2;
    list.insertBefore(button, before ? target : target.nextSibling);
  };
  const finish = finishEvent => {
    if (terminalQuickCommandDrag !== state) return;
    terminalQuickCommandDrag = null;
    button.classList.remove("dragging");
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    if (finishEvent.type === "pointercancel") paintTerminalQuickCommandBar(button.closest("[data-terminal-quick-command-bar]"));
    else if (state.moved) {
      terminalQuickCommandSuppressClick = {id:Number(button.dataset.terminalQuickCommandId), until:Date.now() + 500};
      void persistTerminalQuickCommandOrder(list);
    }
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
}

function refreshTerminalQuickCommandBars() {
  document.querySelectorAll("[data-terminal-quick-command-bar]").forEach(bar => {
    bar.classList.toggle("hidden", !terminalQuickCommandsVisible());
    bar.style.setProperty("--terminal-quick-command-height", `${terminalQuickCommandsHeight()}px`);
    syncTerminalQuickCommandCompact(bar);
    paintTerminalQuickCommandBar(bar);
  });
  document.querySelectorAll("[data-terminal-quick-command-toggle]").forEach(button => {
    const visible = terminalQuickCommandsVisible();
    const label = tr(visible ? "terminal:quick_commands.hide" : "terminal:quick_commands.show");
    button.classList.toggle("active", visible);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(visible));
  });
  scheduleTerminalFit();
}

function toggleTerminalQuickCommandBar(key="") {
  localStorage.setItem(terminalQuickCommandStorage.visible, terminalQuickCommandsVisible() ? "0" : "1");
  refreshTerminalQuickCommandBars();
  if (key) focusTerminalSession(key);
}

function setTerminalQuickCommandHeight(height) {
  const value = Math.round(Math.max(terminalQuickCommandHeightLimits.min, Math.min(terminalQuickCommandHeightLimits.max, Number(height) || terminalQuickCommandHeightLimits.fallback)));
  localStorage.setItem(terminalQuickCommandStorage.height, String(value));
  document.querySelectorAll("[data-terminal-quick-command-bar]").forEach(bar => {
    bar.style.setProperty("--terminal-quick-command-height", `${value}px`);
    syncTerminalQuickCommandCompact(bar, value);
  });
  scheduleTerminalFit();
}

function bindTerminalQuickCommandResize(bar) {
  const handle = bar.querySelector("[data-terminal-quick-command-resizer]");
  if (!handle) return;
  handle.addEventListener("keydown", event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    setTerminalQuickCommandHeight(terminalQuickCommandsHeight() + (event.key === "ArrowUp" ? 12 : -12));
  });
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalQuickCommandsHeight();
    bar.classList.add("resizing");
    handle.setPointerCapture?.(event.pointerId);
    const move = moveEvent => setTerminalQuickCommandHeight(startHeight + startY - moveEvent.clientY);
    const finish = () => {
      bar.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}

async function runTerminalQuickCommand(key, id, action="") {
  const snippet = productivityState.snippets.find(item => Number(item.id) === Number(id));
  const session = terminalSessions.get(key);
  if (!snippet || !session) return notify(tr("terminal:quick_commands.missing_session"), "error");
  const connection = session.connection || currentConnection(session.id);
  const command = await expandSnippetCommand(snippet, connection);
  const mode = ["execute", "insert"].includes(action) ? action : (snippet.quick_action === "insert" ? "insert" : "execute");
  const sent = sendTerminalData(key, mode === "execute" ? `${command}\r` : command);
  if (!sent) return;
  if (mode === "execute") {
    if (typeof noteTerminalCommandStarted === "function") noteTerminalCommandStarted(key);
    saveRecentTerminalCommand(command);
    if (connection) void trackTerminalDirectoryCommand(session, connection, key, command);
  }
  snippet.last_used_at = Math.floor(Date.now() / 1000);
  void api(`/api/command-snippets/${snippet.id}/use`, {method:"POST", body:"{}"}).catch(() => {});
}

async function removeTerminalQuickCommand(id) {
  const item = productivityState.snippets.find(row => Number(row.id) === Number(id));
  if (!item) return;
  await api(`/api/command-snippets/${id}`, {method:"PUT", body:JSON.stringify({...item, quick_visible:0})});
  await loadCommandSnippets();
  notify(tr("terminal:quick_commands.removed"), "success");
}

async function deleteTerminalQuickCommand(id) {
  if (!await confirmModal(tr("terminal:snippets.delete_message"), tr("terminal:snippets.delete_title"), tr("common:actions.delete"), tr("common:actions.cancel"), true)) return;
  await api(`/api/command-snippets/${id}`, {method:"DELETE"});
  await loadCommandSnippets();
  notify(tr("terminal:quick_commands.deleted"), "success");
}

function showTerminalQuickCommandMenu(event, key, id) {
  showActionMenu(event, [
    {label:tr("terminal:quick_commands.execute_now"), icon:"play", run:()=>runTerminalQuickCommand(key, id, "execute")},
    {label:tr("terminal:quick_commands.insert_only"), icon:"text-cursor-input", run:()=>runTerminalQuickCommand(key, id, "insert")},
    {separator:true},
    {label:tr("terminal:quick_commands.edit"), icon:"pencil", run:()=>openCommandSnippetEditor(id, {quick:true})},
    {label:tr("terminal:quick_commands.remove"), icon:"panel-bottom-close", run:()=>removeTerminalQuickCommand(id)},
    {label:tr("terminal:quick_commands.delete"), icon:"trash-2", danger:true, run:()=>deleteTerminalQuickCommand(id)}
  ]);
}

function mountTerminalQuickCommandBar(key, root=document) {
  const bar = root.querySelector?.(`[data-terminal-quick-command-bar][data-terminal-key="${cssEscape(key)}"]`)
    || root.querySelector?.("[data-terminal-quick-command-bar]");
  if (!bar || bar.dataset.mounted === "1") return;
  bar.dataset.mounted = "1";
  const toggle = root.querySelector?.("[data-terminal-quick-command-toggle]");
  toggle?.addEventListener("pointerdown", keepTerminalKeyboardClosed);
  toggle?.addEventListener("click", () => toggleTerminalQuickCommandBar(key));
  paintTerminalQuickCommandBar(bar);
  bindTerminalQuickCommandResize(bar);
  const list = bar.querySelector("[data-terminal-quick-command-list]");
  list?.addEventListener("wheel", event => {
    if (!bar.classList.contains("compact") || list.scrollWidth <= list.clientWidth + 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const canScroll = delta < 0 ? list.scrollLeft > 0 : list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    if (!delta || !canScroll) return;
    event.preventDefault();
    list.scrollLeft += delta;
  }, {passive:false});
  bar.addEventListener("click", event => {
    const manage = event.target.closest("[data-terminal-quick-command-manage]");
    if (manage) return void openCommandSnippetManager();
    if (event.target.closest("[data-terminal-quick-command-drag]")) return;
    const button = event.target.closest("[data-terminal-quick-command-id]");
    const id = Number(button?.dataset.terminalQuickCommandId || 0);
    if (button && !(terminalQuickCommandSuppressClick.id === id && terminalQuickCommandSuppressClick.until > Date.now())) void runTerminalQuickCommand(key, id);
  });
  bar.addEventListener("pointerdown", beginTerminalQuickCommandDrag);
  bar.addEventListener("keydown", event => {
    const handle = event.target.closest?.("[data-terminal-quick-command-drag]");
    if (!handle || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    moveTerminalQuickCommandByKeyboard(handle, ["ArrowLeft","ArrowUp"].includes(event.key) ? -1 : 1);
  });
  bar.addEventListener("contextmenu", event => {
    const button = event.target.closest("[data-terminal-quick-command-id]");
    if (button) showTerminalQuickCommandMenu(event, key, Number(button.dataset.terminalQuickCommandId));
  });
  bar.addEventListener("dblclick", event => {
    if (event.target.closest("button,[data-terminal-quick-command-resizer]")) return;
    openCommandSnippetEditor(0, {quick:true});
  });
  refreshIcons();
}
