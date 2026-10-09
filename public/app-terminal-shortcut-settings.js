let terminalShortcutDraft = [];

function terminalShortcutSettingsHtml() {
  const reset = tr("terminal:settings.restore_defaults");
  return `<section id="terminalSettingsPanelShortcuts" class="terminal-settings-panel" role="tabpanel" aria-labelledby="terminalSettingsTabShortcuts" hidden>
    <div class="terminal-settings-section terminal-shortcut-settings">
      <div class="terminal-shortcut-heading"><h3>${icon("keyboard")}${esc(tr("terminal:shortcuts.title"))} <small id="terminalShortcutCount"></small></h3><button type="button" onclick="fillTerminalShortcutSettings(termaTerminalShortcuts.defaults)">${icon("rotate-ccw")}<span>${esc(reset)}</span></button></div>
      <div id="terminalShortcutRows" class="terminal-shortcut-rows"></div>
      <div class="terminal-shortcut-add">
        <div><label for="terminalShortcutKey">${esc(tr("terminal:shortcuts.key"))}</label><select id="terminalShortcutKey" onchange="syncTerminalShortcutCharacter()">${termaTerminalShortcuts.keys.map(key => `<option data-i18n-skip="true" value="${escAttr(key)}">${esc(termaTerminalShortcuts.label({key}))}</option>`).join("")}<option value="custom">${esc(tr("terminal:shortcuts.character"))}</option></select></div>
        <div id="terminalShortcutCharacterField" hidden><label for="terminalShortcutCharacter">${esc(tr("terminal:shortcuts.character"))}</label><input id="terminalShortcutCharacter" maxlength="1" autocomplete="off" spellcheck="false"></div>
        <div><label for="terminalShortcutLabel">${esc(tr("terminal:shortcuts.label"))}</label><input id="terminalShortcutLabel" maxlength="24" autocomplete="off"></div>
        <div class="terminal-shortcut-modifiers" data-i18n-skip="true">${["Ctrl", "Alt", "Shift"].map(name => `<label class="check-row"><input id="terminalShortcut${name}" type="checkbox"> ${name}</label>`).join("")}</div>
        <button id="terminalShortcutAdd" type="button" onclick="addTerminalShortcut()">${icon("plus")}<span>${esc(tr("terminal:shortcuts.add"))}</span></button>
      </div>
      <div id="terminalShortcutError" class="terminal-shortcut-error" role="alert" hidden></div>
    </div>
  </section>`;
}

function terminalShortcutSettingsFormValue() {
  return termaTerminalShortcuts.normalize(terminalShortcutDraft);
}

function fillTerminalShortcutSettings(value) {
  terminalShortcutDraft = termaTerminalShortcuts.normalize(value);
  renderTerminalShortcutSettingsRows();
}

function terminalShortcutActionHtml(index, action, glyph, label, disabled=false) {
  return `<button class="icon-button" type="button" data-shortcut-action="${action}" data-shortcut-row="${index}" title="${escAttr(label)}" aria-label="${escAttr(label)}" onclick="editTerminalShortcut(${index},'${action}')" ${disabled ? "disabled" : ""}>${icon(glyph)}</button>`;
}

function renderTerminalShortcutSettingsRows() {
  const rows = $("terminalShortcutRows");
  if (!rows) return;
  const scroll = rows.scrollTop;
  rows.innerHTML = terminalShortcutDraft.length ? terminalShortcutDraft.map((shortcut, index) => {
    const keyName = termaTerminalShortcuts.label({...shortcut, label:""});
    return `<div class="terminal-shortcut-row">
      <input type="checkbox" ${shortcut.enabled ? "checked" : ""} aria-label="${escAttr(tr("terminal:shortcuts.enabled", {key:keyName}))}" onchange="terminalShortcutDraft[${index}].enabled=this.checked">
      <code data-i18n-skip="true">${esc(keyName)}</code>
      <input class="terminal-shortcut-row-label" value="${escAttr(shortcut.label)}" maxlength="24" aria-label="${escAttr(tr("terminal:shortcuts.label"))}" placeholder="${escAttr(keyName)}" oninput="terminalShortcutDraft[${index}].label=this.value">
      <div class="terminal-shortcut-row-actions">${terminalShortcutActionHtml(index, "up", "arrow-up", tr("terminal:shortcuts.move_up"), index === 0)}${terminalShortcutActionHtml(index, "down", "arrow-down", tr("terminal:shortcuts.move_down"), index === terminalShortcutDraft.length - 1)}${terminalShortcutActionHtml(index, "remove", "trash-2", tr("common:actions.delete"))}</div>
    </div>`;
  }).join("") : `<div class="muted">${esc(tr("terminal:shortcuts.empty"))}</div>`;
  rows.scrollTop = scroll;
  $("terminalShortcutCount").textContent = `${terminalShortcutDraft.length} / 48`;
  $("terminalShortcutAdd").disabled = terminalShortcutDraft.length >= 48;
  if ($("terminalShortcutError")) $("terminalShortcutError").hidden = true;
}

function editTerminalShortcut(index, action) {
  if (!Number.isInteger(index) || !terminalShortcutDraft[index]) return;
  const destination = index + (action === "up" ? -1 : 1);
  if (action === "remove") terminalShortcutDraft.splice(index, 1);
  else if (["up", "down"].includes(action) && destination >= 0 && destination < terminalShortcutDraft.length) {
    [terminalShortcutDraft[index], terminalShortcutDraft[destination]] = [terminalShortcutDraft[destination], terminalShortcutDraft[index]];
  } else return;
  renderTerminalShortcutSettingsRows();
  const next = Math.min(action === "remove" ? index : destination, terminalShortcutDraft.length - 1);
  $("terminalShortcutRows")?.querySelector(`[data-shortcut-row="${next}"][data-shortcut-action="${action}"]:not(:disabled)`)?.focus();
}

function syncTerminalShortcutCharacter() {
  $("terminalShortcutCharacterField").hidden = $("terminalShortcutKey").value !== "custom";
}

function addTerminalShortcut() {
  try {
    const key = $("terminalShortcutKey").value;
    const shortcut = {
      key:key === "custom" ? $("terminalShortcutCharacter").value : key,
      label:$("terminalShortcutLabel").value,
      ctrl:$("terminalShortcutCtrl").checked,
      alt:$("terminalShortcutAlt").checked,
      shift:$("terminalShortcutShift").checked,
      enabled:true
    };
    terminalShortcutDraft = termaTerminalShortcuts.normalize([...terminalShortcutDraft, shortcut]);
    renderTerminalShortcutSettingsRows();
    $("terminalShortcutRows").scrollTop = $("terminalShortcutRows").scrollHeight;
    $("terminalShortcutLabel").value = "";
    $("terminalShortcutKey").focus();
  } catch {
    $("terminalShortcutError").textContent = tr("errors:backend.terminal_shortcuts_invalid");
    $("terminalShortcutError").hidden = false;
  }
}
