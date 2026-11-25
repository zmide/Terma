const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runTerminalShortcutsUiScenario(window) {
  const initialSize = window.getContentSize();
  const nextFrame = () => window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  try {
    await window.webContents.executeJavaScript(`(async () => {
      window.shortcutUiFixture = {saved:{settings:terminalGlobalSettings, runtime:window.termaRuntimeSettingsModel.snapshot, api, notify, visible:terminalKeysVisible, armed:terminalCtrlArmed, locked:terminalCtrlLocked}, writes:[], sent:[], bars:new Map(), sessions:new Map()};
      const fixture = window.shortcutUiFixture;
      terminalGlobalSettings = window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults);
      terminalKeysVisible = true;
      terminalCtrlArmed = false;
      terminalCtrlLocked = false;
      for (const key of ['shortcut-ui-left', 'shortcut-ui-right']) {
        const host = document.createElement('div');
        host.appendChild(window.termaTerminalKeysService.createHost(key));
        fixture.bars.set(key, host);
        window.termaTerminalState.terminalSurfaceCache.set(key, host);
        fixture.sessions.set(key,window.termaTerminalState.terminalSessions.get(key));
        window.termaTerminalState.terminalSessions.set(key,{
          id:-1,connection:{id:-1},term:{options:{},focus(){}},
          socket:{readyState:WebSocket.OPEN,send:data=>fixture.sent.push({key,data})}
        });
      }
      for (const key of fixture.bars.keys()) termaTerminalKeys.mount(key);
      notify = () => {};
      api = async (url, options) => {
        if (url !== '/api/runtime-settings' || options?.method !== 'PUT') return fixture.saved.api(url, options);
        const terminal = window.termaTerminalSettingsModel.normalize(JSON.parse(options.body).terminal);
        fixture.writes.push(terminal);
        return {saved:{terminal}};
      };
      await window.termaTerminalSettings.open('shortcut-ui-left');
      window.termaTerminalViews.selectTab('shortcuts');
    })()`);
    await nextFrame();
    const edited = await window.webContents.executeJavaScript(`(() => {
      const initial = window.termaTerminalViews?.readShortcuts().length;
      $('terminalShortcutKey').value = 'F5';
      $('terminalShortcutCtrl').checked = true;
      $('terminalShortcutAlt').checked = true;
      $('terminalShortcutLabel').value = 'Logs';
      $('terminalShortcutAdd').click();
      const added = window.termaTerminalViews?.readShortcuts().length === initial + 1;
      const savedUnchanged = window.termaTerminalSettings.current().shortcut_keys.length === initial;
      const check = $('terminalShortcutRows').querySelector('input[type="checkbox"]');
      check.checked = false;
      check.dispatchEvent(new Event('change',{bubbles:true}));
      const disabled = window.termaTerminalViews?.readShortcuts()[0].enabled === false;
      window.termaTerminalViews?.editShortcut(0,'remove');
      let index = window.termaTerminalViews?.readShortcuts().length - 1;
      while (index > 0) window.termaTerminalViews?.editShortcut(index--,'up');
      return {added,savedUnchanged,disabled,removed:window.termaTerminalViews?.readShortcuts().length === initial,reordered:window.termaTerminalViews?.readShortcuts()[0].label === 'Logs'};
    })()`);
    for (const [name, value] of Object.entries(edited)) assert.equal(value, true, name);
    const layouts = [];
    for (const [width, height] of [[1200,800], [390,844]]) {
      window.setContentSize(width, height);
      await nextFrame();
      await window.webContents.executeJavaScript("window.termaTerminalViews.selectTab('shortcuts')");
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
      await window.termaTerminalViews.saveSettings();
      const fixture = window.shortcutUiFixture;
      const liveBars = [...fixture.bars.values()].every(host => host.querySelector('button[data-shortcut-index="0"]')?.textContent === 'Logs');
      window.termaTerminalKeysService.sendShortcut('shortcut-ui-right',0);
      const writes = fixture.writes.length;
      await window.termaTerminalSettings.open('shortcut-ui-left');
      window.termaTerminalViews?.fillShortcuts([]);
      window.termaTerminalViews.closeSettings();
      return {liveBars, oneSave:writes === 1, sent:fixture.sent, cancelled:fixture.writes.length === writes && window.termaTerminalSettings.current().shortcut_keys[0].label === 'Logs', modalClosed:$('modal').hidden};
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
      window.termaRuntimeSettingsModel.snapshot = fixture.saved.runtime;
      api = fixture.saved.api; notify = fixture.saved.notify;
      terminalKeysVisible = fixture.saved.visible;
      terminalCtrlArmed = fixture.saved.armed; terminalCtrlLocked = fixture.saved.locked;
      for (const key of fixture.bars.keys()) {
        termaTerminalKeys.release(key);
        window.termaTerminalState.terminalSurfaceCache.delete(key);
        const original=fixture.sessions.get(key);
        if(original)window.termaTerminalState.terminalSessions.set(key,original);
        else window.termaTerminalState.terminalSessions.delete(key);
      }
      window.termaTerminalSettings.applyAll();
      delete window.shortcutUiFixture;
    })()`);
    window.setContentSize(...initialSize);
  }
}

module.exports = {runTerminalShortcutsUiScenario};
