function renderTerminalKeys(key) {
  const ctrlOnceTitle = tr("terminal:keys.ctrl_once_hint", {defaultValue:"Ctrl 一次：下一个字母按 Ctrl 组合键发送"});
  const ctrlOnceLabel = tr("terminal:keys.ctrl_once", {defaultValue:"Ctrl一次"});
  const ctrlLockTitle = tr("terminal:keys.ctrl_lock_hint", {defaultValue:"Ctrl 锁定：连续发送 Ctrl 组合键，再点一次关闭"});
  const ctrlLockLabel = tr("terminal:keys.ctrl_lock", {defaultValue:"Ctrl锁"});
  return `<div id="terminalKeys" class="terminal-keys ${terminalKeysVisible ? "" : "hidden"}">
    ${renderTerminalShortcutButtons(key)}
    <button class="${terminalCtrlArmed || terminalCtrlLocked ? "active" : ""}" title="${escAttr(ctrlOnceTitle)}" aria-label="${escAttr(ctrlOnceTitle)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="armTerminalCtrl(event)">${esc(ctrlOnceLabel)}</button>
    <button class="${terminalCtrlLocked ? "active" : ""}" title="${escAttr(ctrlLockTitle)}" aria-label="${escAttr(ctrlLockTitle)}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="toggleCtrlLock()">${esc(ctrlLockLabel)}</button>
    <button class="icon-button terminal-shortcut-configure" title="${escAttr(tr("terminal:shortcuts.configure"))}" aria-label="${escAttr(tr("terminal:shortcuts.configure"))}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="showTerminalShortcutSettings('${escAttr(key)}')">${icon("settings")}</button>
  </div>`;
}

async function showTerminalShortcutSettings(key=activeTabKey) {
  await showTerminalGlobalSettings(key);
  selectTerminalSettingsTab("shortcuts");
}

function renderTerminalShortcutButtons(key) {
  const shortcuts = currentTerminalGlobalSettings().shortcut_keys;
  const buttons = shortcuts.map((shortcut, index) => shortcut.enabled ? `<button data-i18n-skip="true" data-shortcut-index="${index}" title="${escAttr(termaTerminalShortcuts.label({...shortcut, label:""}))}" onpointerdown="keepTerminalKeyboardClosed(event)" onclick="sendTerminalShortcut('${escAttr(key)}',${index})">${esc(termaTerminalShortcuts.label(shortcut))}</button>` : "");
  for (let index = 0; index <= shortcuts.length - 4; index++) {
    const group = shortcuts.slice(index, index + 4);
    if (group.every((shortcut, offset) => shortcut.key === ["Up", "Left", "Down", "Right"][offset] && shortcut.enabled && !shortcut.label && !shortcut.ctrl && !shortcut.alt && !shortcut.shift)) {
      buttons[index] = `<span class="terminal-arrow-pad" data-i18n-skip="true">${group.map((shortcut, offset) => buttons[index + offset].replace("<button ", `<button class="arrow-${shortcut.key.toLowerCase()}" `)).join("")}</span>`;
      buttons.splice(index + 1, 3, "", "", "");
      index += 3;
    }
  }
  return buttons.join("");
}

function sendTerminalShortcut(key, index) {
  const shortcut = currentTerminalGlobalSettings().shortcut_keys[Number(index)];
  if (!shortcut?.enabled) return;
  if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift && /^[A-Z]$/.test(shortcut.key) && (terminalCtrlArmed || terminalCtrlLocked)) {
    sendCtrlCombo(key, shortcut.key);
    return;
  }
  const application = terminalSessions.get(key)?.term?.modes?.applicationCursorKeysMode === true;
  sendTerminalData(key, termaTerminalShortcuts.sequence(shortcut, application));
  if (!terminalCtrlLocked) terminalCtrlArmed = false;
  rerenderTerminalKeys(key);
}

function rerenderTerminalKeys(key=activeTabKey) {
  const box = terminalElementForKey(key, "#terminalKeys");
  if (!box) return;
  const left = box.scrollLeft;
  box.outerHTML = renderTerminalKeys(key);
  const next = terminalElementForKey(key, "#terminalKeys");
  if (next) next.scrollLeft = left;
}

function toggleTerminalKeys(key) {
  terminalKeysVisible = !terminalKeysVisible;
  localStorage.setItem("terminalKeysVisible", terminalKeysVisible ? "1" : "0");
  const keys = new Set([key, ...terminalSurfaceCache.keys()]);
  for (const tabKey of keys) {
    rerenderTerminalKeys(tabKey);
    const button = terminalElementForKey(tabKey, ".terminal-action-keys");
    if (button) {
      button.title = tr(terminalKeysVisible ? "terminal:toolbar.hide_shortcuts" : "terminal:toolbar.show_shortcuts");
      button.setAttribute("aria-label", button.title);
      const label = button.querySelector("span");
      if (label) label.textContent = tr(terminalKeysVisible ? "terminal:toolbar.hide_shortcuts_short" : "terminal:toolbar.shortcuts");
    }
    const session = terminalSessions.get(tabKey);
    if (session) fitTerminalPreservingViewport(session);
  }
}

function armTerminalCtrl() {
  terminalCtrlArmed = !terminalCtrlArmed;
  rerenderTerminalKeys();
}

function toggleCtrlLock() {
  terminalCtrlLocked = !terminalCtrlLocked;
  terminalCtrlArmed = false;
  rerenderTerminalKeys();
}

function terminalSequence(label, key=activeTabKey) {
  const prefix = terminalSessions.get(key)?.term?.modes?.applicationCursorKeysMode ? "\x1bO" : "\x1b[";
  return {
    Esc:"\x1b", Tab:"\t", Home:`${prefix}H`, End:`${prefix}F`, PgUp:"\x1b[5~", PgDn:"\x1b[6~",
    "↑":`${prefix}A`, "↓":`${prefix}B`, "→":`${prefix}C`, "←":`${prefix}D`
  }[label] || label;
}
