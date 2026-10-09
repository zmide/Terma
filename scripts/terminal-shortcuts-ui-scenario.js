const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runTerminalShortcutsUiScenario(window) {
  const initialSize = window.getContentSize();
  const nextFrame = () => window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  try {
    await window.webContents.executeJavaScript(`(async () => {
      window.shortcutUiFixture = {saved:{settings:terminalGlobalSettings, runtime:runtimeSettings, api, notify, element:terminalElementForKey, send:sendTerminalData, visible:terminalKeysVisible, armed:terminalCtrlArmed, locked:terminalCtrlLocked}, writes:[], sent:[], bars:new Map()};
      const fixture = window.shortcutUiFixture;
      terminalGlobalSettings = normalizeTerminalGlobalSettings(defaultTerminalGlobalSettings);
      terminalKeysVisible = true;
      terminalCtrlArmed = false;
      terminalCtrlLocked = false;
      for (const key of ['shortcut-ui-left', 'shortcut-ui-right']) {
        const host = document.createElement('div');
        host.innerHTML = renderTerminalKeys(key);
        fixture.bars.set(key, host);
        terminalSurfaceCache.set(key, {});
      }
      terminalElementForKey = (key, selector) => fixture.bars.has(key) ? fixture.bars.get(key).querySelector(selector) : fixture.saved.element(key, selector);
      sendTerminalData = (key, data) => { fixture.sent.push({key,data}); return true; };
      notify = () => {};
      api = async (url, options) => {
        if (url !== '/api/runtime-settings' || options?.method !== 'PUT') return fixture.saved.api(url, options);
        const terminal = normalizeTerminalGlobalSettings(JSON.parse(options.body).terminal);
        fixture.writes.push(terminal);
        return {saved:{terminal}};
      };
      await showTerminalGlobalSettings('shortcut-ui-left');
      selectTerminalSettingsTab('shortcuts');
    })()`);
    await nextFrame();
    const edited = await window.webContents.executeJavaScript(`(() => {
      const initial = terminalShortcutSettingsFormValue().length;
      $('terminalShortcutKey').value = 'F5';
      $('terminalShortcutCtrl').checked = true;
      $('terminalShortcutAlt').checked = true;
      $('terminalShortcutLabel').value = 'Logs';
      $('terminalShortcutAdd').click();
      const added = terminalShortcutSettingsFormValue().length === initial + 1;
      const savedUnchanged = currentTerminalGlobalSettings().shortcut_keys.length === initial;
      const check = $('terminalShortcutRows').querySelector('input[type="checkbox"]');
      check.checked = false;
      check.dispatchEvent(new Event('change',{bubbles:true}));
      const disabled = terminalShortcutSettingsFormValue()[0].enabled === false;
      editTerminalShortcut(0,'remove');
      let index = terminalShortcutSettingsFormValue().length - 1;
      while (index > 0) editTerminalShortcut(index--,'up');
      return {added,savedUnchanged,disabled,removed:terminalShortcutSettingsFormValue().length === initial,reordered:terminalShortcutSettingsFormValue()[0].label === 'Logs'};
    })()`);
    for (const [name, value] of Object.entries(edited)) assert.equal(value, true, name);
    const layouts = [];
    for (const [width, height] of [[1200,800], [390,844]]) {
      window.setContentSize(width, height);
      await nextFrame();
      await window.webContents.executeJavaScript("selectTerminalSettingsTab('shortcuts')");
      await nextFrame();
      const layout = await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('.terminal-settings-modal');
        const panel = $('terminalSettingsPanelShortcuts');
        const rect = card.getBoundingClientRect();
        const controls = [...card.querySelectorAll('.terminal-settings-actions button,.terminal-shortcut-settings button,.terminal-shortcut-settings input,.terminal-shortcut-settings select')].filter(control=>control.getClientRects().length > 0);
        const outside = controls.filter(control=>{const r=control.getBoundingClientRect(); return r.left < rect.left - 1 || r.right > rect.right + 1 || control.scrollWidth > control.clientWidth + 1;}).map(control=>({id:control.id, text:control.textContent}));
        const tab = $('terminalSettingsTabShortcuts').getBoundingClientRect();
        const tabList = $('terminalSettingsTabShortcuts').parentElement.getBoundingClientRect();
        return {width:innerWidth, noOverflow:panel.scrollWidth <= panel.clientWidth + 1 && document.body.scrollWidth <= innerWidth + 1, fits:rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, activeTabVisible:tab.left >= tabList.left - 1 && tab.right <= tabList.right + 1, controls:outside.length === 0, outside};
      })()`);
      for (const [name, value] of Object.entries(layout)) if (typeof value === "boolean") assert.equal(value, true, `${width}: ${name}`);
      layouts.push(layout);
      if (process.env.TERMA_UI_VISUAL_DIR) {
        fs.mkdirSync(process.env.TERMA_UI_VISUAL_DIR, {recursive:true});
        fs.writeFileSync(path.join(process.env.TERMA_UI_VISUAL_DIR, `shortcuts-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    const saved = await window.webContents.executeJavaScript(`(async () => {
      await saveTerminalGlobalSettings('shortcut-ui-left');
      const fixture = window.shortcutUiFixture;
      const liveBars = [...fixture.bars.values()].every(host => host.querySelector('button[data-shortcut-index="0"]')?.textContent === 'Logs');
      sendTerminalShortcut('shortcut-ui-right',0);
      const writes = fixture.writes.length;
      await showTerminalGlobalSettings('shortcut-ui-left');
      fillTerminalShortcutSettings([]);
      closeTerminalGlobalSettings('shortcut-ui-left');
      return {liveBars, oneSave:writes === 1, sent:fixture.sent, cancelled:fixture.writes.length === writes && currentTerminalGlobalSettings().shortcut_keys[0].label === 'Logs', modalClosed:$('modal').hidden};
    })()`);
    assert.equal(saved.liveBars, true);
    assert.equal(saved.oneSave, true);
    assert.equal(saved.cancelled, true);
    assert.equal(saved.modalClosed, true);
    assert.deepEqual(saved.sent, [{key:"shortcut-ui-right",data:"\x1b[15;7~"}]);
    console.log("[ui-smoke] custom terminal shortcuts passed on desktop/mobile: edit, save, cancel, split bars, and key dispatch");
    return {edited, layouts, saved};
  } finally {
    await window.webContents.executeJavaScript(`(() => {
      const fixture = window.shortcutUiFixture;
      if (!fixture) return;
      closeModal();
      $('modal').onkeydown = null;
      terminalGlobalSettings = fixture.saved.settings;
      runtimeSettings = fixture.saved.runtime;
      api = fixture.saved.api; notify = fixture.saved.notify; terminalElementForKey = fixture.saved.element;
      sendTerminalData = fixture.saved.send; terminalKeysVisible = fixture.saved.visible;
      terminalCtrlArmed = fixture.saved.armed; terminalCtrlLocked = fixture.saved.locked;
      for (const key of fixture.bars.keys()) terminalSurfaceCache.delete(key);
      applyTerminalGlobalSettingsToSessions();
      delete window.shortcutUiFixture;
    })()`);
    window.setContentSize(...initialSize);
  }
}

module.exports = {runTerminalShortcutsUiScenario};
