const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runUiInteractionUiScenario(browser) {
  const directory = process.env.TERMA_UI_INTERACTION_VISUAL_DIR || path.join(process.cwd(), 'data', 'ui-interaction-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  let checks = 0;
  const screenshots = [], groups = [];
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const settle = async () => {
    await execute('(async()=>{await window.termaConnectionLocalizationReady;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
    await delay(100);
  };
  const shot = async name => {
    await settle();
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), (await browser.webContents.capturePage()).toPNG());
    screenshots.push(file);
  };
  const point = selector => evaluate(selector => {
    const button = document.querySelector(selector);
    button?.scrollIntoView({ block: 'center' });
    const box = button?.getBoundingClientRect();
    if (!box || !button.checkVisibility()) throw Error('Hidden interaction control ' + selector);
    const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (!button.contains(document.elementFromPoint(point.x, point.y))) throw Error('Covered interaction control ' + selector);
    return point;
  }, selector);
  const click = async selector => {
    const position = await point(selector);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) browser.webContents.sendInputEvent({ type, ...position, button: 'left', clickCount: 1 });
    await settle();
  };
  const key = async keyCode => {
    browser.webContents.focus();
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({ type, keyCode });
    await settle();
  };
  const inspect = selector => evaluate(selector => {
    const root = document.querySelector(selector), han = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (/[\u3400-\u9fff]/.test(walker.currentNode.textContent)) han.push(walker.currentNode.textContent.trim());
    for (const element of root.querySelectorAll('*')) for (const name of ['title','aria-label','placeholder']) {
      if (/[\u3400-\u9fff]/.test(element.getAttribute(name) || '')) han.push(element.getAttribute(name));
    }
    const buttons = [...root.querySelectorAll('button')].filter(button => button.checkVisibility());
    return {
      han,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      fits: buttons.every(button => {
        const box = button.getBoundingClientRect(), outer = root.getBoundingClientRect();
        return box.left >= outer.left - 1 && box.right <= outer.right + 1 && box.left >= -1 && box.right <= innerWidth + 1;
      }),
      icons: buttons.every(button => {
        const icon = button.querySelector('svg'), text = button.querySelector('span');
        if (!icon || !text) return true;
        return icon.getBoundingClientRect().right <= text.getBoundingClientRect().left + 1;
      }),
      boxes: buttons.map(button => ({ id: button.id, disabled: button.disabled, box: button.getBoundingClientRect().toJSON() }))
    };
  }, selector);
  await execute('(async()=>{await window.termaI18nReady;await window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();closeModal();window.termaNotificationToasts.dispose();})()');
  try {
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const prefix = `${width}-${language}-${theme}`, alternate = language === 'zh-CN' ? 'en-US' : 'zh-CN';
      browser.setContentSize(width, 844);
      await evaluate(async (theme, language) => {
        closeModal(); await setTermaLanguage(language); applyTheme(theme);
        window.termaWorkspaceShell.showPrimary('connections');
        const originalApi = api;
        api = (url, ...args) => url === '/api/identity-files'
          ? new Promise(resolve => { window.__interactionResolveKeys = () => resolve([]); })
          : originalApi(url, ...args);
        try { window.termaConnectionFormWorkspace.create(); } finally { api = originalApi; }
        if (isMobileLayout()) window.termaWorkspaceShell.showMobileWorkspace();
        document.getElementById('conn_name').value = 'Unsaved interaction draft';
        const button = document.getElementById('connTestBtn'), peer = document.getElementById('connSaveAndClear');
        button.dataset.uiActionKey = peer.dataset.uiActionKey = 'fixture-action';
        window.__interactionCount = 0;
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopImmediatePropagation();
          if (beginUiAction('fixture-action', button)) window.__interactionCount++;
        }, true);
        window.__interactionButton = button;
      }, theme, language);
      await settle();
      const initial = await inspect('#connectionForm');
      groups.push({ width, theme, language, initial });
      equal(initial.overflow, false, 'form has no horizontal overflow');
      equal(initial.fits && initial.icons, true, 'form button bounds and icon order fit');
      equal(await evaluate(() => document.getElementById('conn_key').options.length === 0
        && document.getElementById('keyStatus').textContent === tr('connections:auto.no_private_key_selected')),
      true, 'empty private key status uses the current language while the list is still loading');
      if (language === 'en-US') equal(initial.han, [], 'English form scans rendered hidden text and attributes');
      await evaluate(() => document.getElementById('keyStatus').scrollIntoView({ block: 'center' }));
      await shot(prefix + '-key-status-loading');
      await point('#connTestBtn');
      await shot(prefix + '-ready');
      const position = await point('#connTestBtn');
      browser.webContents.sendInputEvent({ type: 'mouseMove', ...position });
      await settle();
      equal(await evaluate(() => {
        const style = getComputedStyle(document.getElementById('connTestBtn'));
        return style.transform === 'none' && style.boxShadow === 'none';
      }), true, 'real pointer hover stays flat');
      await shot(prefix + '-hover');
      await click('#connTestBtn');
      equal(await evaluate(() => window.__interactionCount), 1, 'pointer starts one action');
      equal(await evaluate(() => ['connTestBtn','connSaveAndClear'].every(id => document.getElementById(id).disabled && document.getElementById(id).getAttribute('aria-busy') === 'true')), true, 'shared Vue controls stay disabled');
      equal(await evaluate(() => beginUiAction('fixture-action', document.getElementById('connSaveAndClear'))), false, 'duplicate action is rejected');
      await shot(prefix + '-busy');
      await evaluate(async alternate => { await setTermaLanguage(alternate); }, alternate);
      await settle();
      equal(await evaluate(() => document.getElementById('connTestBtn') === window.__interactionButton && document.getElementById('connTestBtn').disabled && document.getElementById('connSaveAndClear').disabled), true, 'Vue redraw preserves the shared action lock');
      equal(await evaluate(() => document.getElementById('connTestBtn').textContent.trim() === tr('common:auto.processing')), true, 'busy default text translates live');
      equal(await evaluate(() => document.getElementById('conn_name').value), 'Unsaved interaction draft', 'live language preserves form draft');
      equal(await evaluate(() => document.getElementById('keyStatus').textContent === tr('connections:auto.no_private_key_selected')),
      true, 'empty private key status also translates before the list loads');
      await evaluate(() => { window.__interactionResolveKeys(); delete window.__interactionResolveKeys; });
      const liveForm = await inspect('#connectionForm');
      groups.at(-1).liveForm = { language: alternate, ...liveForm };
      equal(liveForm.fits && !liveForm.overflow, true, 'live form buttons retain their bounds');
      await shot(prefix + '-busy-live-language');
      await evaluate(() => endUiAction('fixture-action', window.__interactionButton));
      await settle();
      equal(await evaluate(() => !document.getElementById('connTestBtn').disabled && !document.getElementById('connSaveAndClear').disabled && !window.termaUiActions.isInFlight('fixture-action')), true, 'completion releases both controls');
      await evaluate(() => document.getElementById('connSaveAndClear').focus());
      await key('Tab');
      equal(await evaluate(() => document.activeElement === document.getElementById('connTestBtn') && document.activeElement.matches(':focus-visible')), true, 'Tab exposes keyboard focus');
      await shot(prefix + '-keyboard');
      await key('Space');
      equal(await evaluate(() => window.__interactionCount), 2, 'keyboard starts the same guarded action');
      await evaluate(() => endUiAction('fixture-action', window.__interactionButton));
      await shot(prefix + '-complete');

      await evaluate(async language => {
        await setTermaLanguage(language);
        const modal = document.getElementById('modal');
        modal.hidden = false;
        modal.innerHTML = '<div class="modal-card" id="interactionFixture"><h2 data-i18n="common:auto.processing"></h2><details id="interactionDetails" open><summary data-i18n="common:actions.save"></summary><textarea id="interactionDraft" name="draft[&quot;name" aria-label="Draft"></textarea></details><label class="file-picker"><input id="interactionFile" type="file"><span class="file-picker-button" data-i18n="common:auto.choose_file"></span><span class="file-picker-name" data-i18n-skip="true">chosen.key</span></label><input id="interactionNumber" type="number" value="7"><div class="actions"><button id="interactionLegacy" type="button" data-ui-action-key="fixture-legacy"><span data-i18n="common:actions.save"></span></button><button id="interactionDisabled" type="button" data-ui-action-key="fixture-legacy" disabled data-i18n="common:actions.cancel"></button></div><div id="interactionScroll" style="height:90px;overflow:auto"><div style="height:300px">Fixture scroll</div></div></div>';
        applyTermaTranslations(modal);
        const draft = document.getElementById('interactionDraft');
        draft.value = 'Snapshot draft stays local'; draft.focus(); draft.setSelectionRange(3,8,'backward');
        const file = document.getElementById('interactionFile'), transfer = new DataTransfer();
        transfer.items.add(new File(['fixture'], 'chosen.key')); file.files = transfer.files;
        window.__interactionSnapshot = captureUiState(document.getElementById('interactionFixture'));
        window.__interactionSavedScroll = [window.__interactionSnapshot.treeScrollTop, window.__interactionSnapshot.workspaceScrollTop];
        window.__interactionOriginalChild = document.querySelector('#interactionLegacy span');
        window.__interactionChildClicks = 0;
        window.__interactionOriginalChild.addEventListener('click', () => window.__interactionChildClicks++);
        document.getElementById('interactionScroll').scrollTop = 45;
        const original = document.getElementById('interactionDraft'), replacement = original.cloneNode();
        original.replaceWith(replacement);
        document.getElementById('interactionDetails').open = false;
        document.getElementById('connectionGroups').scrollTop = 0;
        window.termaWorkspacePaneScope.currentWorkspaceDomScope().querySelector('.workspace').scrollTop = 0;
        restoreUiState(window.__interactionSnapshot);
      }, language);
      await settle();
      equal(await evaluate(() => {
        const draft = document.getElementById('interactionDraft');
        return draft.value === 'Snapshot draft stays local' && document.activeElement === draft
          && draft.selectionStart === 3 && draft.selectionEnd === 8 && draft.selectionDirection === 'backward'
          && document.getElementById('interactionDetails').open;
      }), true, 'snapshot restores replacement field draft focus selection and details');
      equal(await evaluate(() => [...document.querySelectorAll('#interactionFixture [data-i18n]')].every(element => element.textContent.trim() === tr(element.getAttribute('data-i18n')))), true, 'snapshot labels resolve before the first capture');
      equal(await evaluate(() => [document.getElementById('connectionGroups').scrollTop, window.termaWorkspacePaneScope.currentWorkspaceDomScope().querySelector('.workspace').scrollTop]), await evaluate(() => window.__interactionSavedScroll), 'snapshot restores tree and current workspace scroll');
      await shot(prefix + '-snapshot-restored');
      await evaluate(async alternate => { await setTermaLanguage(alternate); }, alternate);
      await settle();
      equal(await evaluate(() => document.getElementById('interactionDraft').value === 'Snapshot draft stays local' && document.activeElement.id === 'interactionDraft' && document.getElementById('interactionScroll').scrollTop === 45), true, 'live language retains snapshot focus draft and scroll');
      equal(await evaluate(() => document.getElementById('interactionFile').files[0]?.name), 'chosen.key', 'snapshot retains the selected FileList');
      const localized = await inspect('#interactionFixture');
      equal(localized.fits && !localized.overflow, true, 'fixture buttons fit both viewports');
      equal(await evaluate(() => !document.getElementById('interactionFixture').textContent.includes('common:')), true, 'fixture translation keys resolve');
      if (alternate === 'en-US') equal(localized.han, [], 'live English scans hidden text and attributes');
      await shot(prefix + '-snapshot-live-language');
      await evaluate(() => {
        beginUiAction('fixture-legacy', document.getElementById('interactionLegacy'), '<img src=x onerror=alert(1)>');
      });
      equal(await evaluate(() => !document.querySelector('#interactionLegacy img') && document.getElementById('interactionLegacy').textContent.startsWith('<img')), true, 'legacy busy label stays text');
      await evaluate(() => setButtonBusy(document.getElementById('interactionLegacy'), true, () => tr('common:auto.processing')));
      await shot(prefix + '-legacy-busy');
      await evaluate(() => {
        endUiAction('fixture-legacy', document.getElementById('interactionLegacy'));
        endUiAction('fixture-legacy', document.getElementById('interactionLegacy'));
        document.querySelector('#interactionLegacy span').click();
      });
      equal(await evaluate(() => document.querySelector('#interactionLegacy span') === window.__interactionOriginalChild && window.__interactionChildClicks === 1 && document.getElementById('interactionDisabled').disabled), true, 'legacy completion retains original nodes listeners and disabled state');
      await evaluate(() => {
        const file = document.getElementById('interactionFile'); file.focus();
        const snapshot = captureUiState(document.getElementById('interactionFixture'));
        restoreUiState({ ...snapshot, activeValue: 'C:\\fakepath\\blocked.key' });
        const number = document.getElementById('interactionNumber'); number.focus();
        restoreUiState(captureUiState(document.getElementById('interactionFixture')));
      });
      equal(await evaluate(() => document.getElementById('interactionFile').files[0]?.name), 'chosen.key', 'file restore cannot assign a synthetic path');
      await shot(prefix + '-legacy-complete');
      await evaluate(() => closeModal());
      console.log('[ui-interaction] passed ' + prefix);
    }
    return { groups: groups.length, checks, screenshots: screenshots.length };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ groups, checks, screenshots }, null, 2));
    await execute("endUiAction('fixture-action',window.__interactionButton);endUiAction('fixture-legacy',document.getElementById('interactionLegacy'));closeModal();delete window.__interactionSnapshot;delete window.__interactionOriginalChild;delete window.__interactionButton;");
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = { runUiInteractionUiScenario };
