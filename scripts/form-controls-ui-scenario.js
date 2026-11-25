const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runFormControlsUiScenario(browser) {
  const directory = process.env.TERMA_FORM_CONTROLS_VISUAL_DIR || path.join(process.cwd(), 'data', 'form-controls-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const screenshots = [], groups = [];
  let checks = 0;
  const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
  const settle = () => execute('(async()=>{await window.termaConnectionLocalizationReady;await window.termaQuickLocalizationReady;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
  const capture = async name => {
    await settle();
    await delay(80);
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), (await browser.webContents.capturePage()).toPNG());
    screenshots.push(file);
  };
  const click = async selector => {
    const point = await evaluate(selector => {
      const button = document.querySelector(selector);
      button?.scrollIntoView({ block: 'nearest' });
      const box = button?.getBoundingClientRect();
      if (!box || !button.checkVisibility()) throw Error('Hidden control ' + selector);
      const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      if (!button.contains(document.elementFromPoint(point.x, point.y))) throw Error('Covered control ' + selector);
      return point;
    }, selector);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) browser.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
  };
  const key = async keyCode => {
    browser.webContents.focus();
    browser.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    browser.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  };
  const inspect = () => evaluate(() => {
    const input = document.getElementById('fixturePassword');
    const control = input.closest('.password-input-control');
    const button = control.querySelector('button');
    const fieldBox = input.getBoundingClientRect(), buttonBox = button.getBoundingClientRect();
    const iconBox = button.querySelector('svg').getBoundingClientRect();
    const label = input.type === 'text' ? tr('common:auto.hide_password') : tr('common:auto.show_password');
    const han = [];
    const root = document.getElementById('formControlFixture');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (/[\u3400-\u9fff]/.test(walker.currentNode.textContent)) han.push(walker.currentNode.textContent.trim());
    for (const element of root.querySelectorAll('*')) for (const attribute of ['title','aria-label','placeholder']) {
      if (/[\u3400-\u9fff]/.test(element.getAttribute(attribute) || '')) han.push(element.getAttribute(attribute));
    }
    return {
      masked: input.type === 'password', owned: button.hasAttribute('data-terma-button'),
      single: control.querySelectorAll('button').length === 1 && control.querySelectorAll('.password-visibility-mount').length === 1,
      translated: button.title === label && button.getAttribute('aria-label') === label,
      pressed: button.getAttribute('aria-pressed') === String(input.type === 'text'),
      focused: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd, input.selectionDirection],
      value: input.value === 'synthetic-password',
      buttonFits: buttonBox.left >= fieldBox.left && buttonBox.right <= fieldBox.right + .5 && buttonBox.top >= fieldBox.top && buttonBox.bottom <= fieldBox.bottom + .5,
      geometry: { field: fieldBox.toJSON(), button: buttonBox.toJSON() },
      centered: Math.abs((iconBox.left + iconBox.right - buttonBox.left - buttonBox.right) / 2) < 1,
      language: document.documentElement.lang, han,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  const selectFiles = async (id, names) => evaluate((id, names) => {
    const input = document.getElementById(id), transfer = new DataTransfer();
    names.forEach(name => transfer.items.add(new File(['synthetic fixture'], name, { type: 'text/plain' })));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, id, names);
  await execute('(async()=>{await window.termaI18nReady;await window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();closeModal();dismissToast();})()');
  try {
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const prefix = `${width}-${language}-${theme}`;
      browser.setContentSize(width, 844);
      // Read idle title attributes with the pointer clear of the previous fixture.
      browser.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
      await evaluate(async (theme, language) => {
        closeModal();
        await setTermaLanguage(language);
        applyTheme(theme);
        const modal = document.getElementById('modal');
        modal.hidden = false;
        modal.innerHTML = '<div class="modal-card" id="formControlFixture"><h2 data-i18n-skip="true">Fixture</h2><label><span data-i18n-skip="true">Fixture password</span><input id="fixturePassword" type="password" autocomplete="off"></label><label class="file-picker"><input id="fixtureFiles" type="file" multiple data-change-action="static-file-picker"><span class="file-picker-button" data-i18n="common:auto.choose_file"></span><span class="file-picker-name" data-i18n="common:auto.not_selected"></span></label><div id="fixtureIcons"></div><div data-terma-settings-owned="fixture"><input id="fixtureOwnedPassword" type="password" hidden></div><div class="password-input-control" id="fixtureIndependentOwned" hidden><input type="password"><button class="password-visibility-toggle" data-terma-button type="button"></button></div></div>';
        const input = document.getElementById('fixturePassword');
        input.value = 'synthetic-password';
        window.__formOriginalInput = input;
        window.__formLabelInjection = false;
        const icons = document.getElementById('fixtureIcons');
        icons.innerHTML = icon('server', '"><img src=x onerror=window.__formLabelInjection=true>') + x11Icon('X11 fixture') + '<i data-lucide="arrow-left"></i>' + icon('missing-fixture');
        refreshIcons();
        refreshIcons();
        window.termaFormControls.enhancePasswords(input);
        window.termaFormControls.updateFilePicker(document.getElementById('fixtureFiles'));
        applyTermaTranslations(modal);
      }, theme, language);
      await settle();
      const initial = await inspect();
      groups.push({width,theme,language,initial});
      if (!initial.buttonFits) console.log('[form-controls] geometry', initial.geometry);
      for (const property of ['masked','owned','single','translated','pressed','value','buttonFits','centered']) equal(initial[property], true, prefix + ' initial ' + property);
      equal(initial.overflow, false, prefix + ' no page overflow');
      if (language === 'en-US') { assert.deepEqual(initial.han, [], 'English fixed text and hidden attributes translate'); checks++; }
      equal(await evaluate(() => !document.getElementById('fixtureOwnedPassword').closest('.password-input-control')), true, 'Vue owned password is skipped');
      equal(await evaluate(() => document.querySelectorAll('#fixtureIndependentOwned button').length === 1 && !document.querySelector('#fixtureIndependentOwned .password-visibility-mount')), true, 'shared Vue password control is skipped outside page ownership roots');
      equal(await evaluate(() => document.getElementById('fixtureIcons').querySelectorAll('svg').length), 3, 'legacy placeholders and composite icons render');
      equal(await evaluate(() => !document.getElementById('fixtureIcons').querySelector('img,script') && !window.__formLabelInjection), true, 'icon labels remain escaped');
      await capture(prefix + '-masked');

      await evaluate(() => { const input = document.getElementById('fixturePassword'); input.focus(); input.setSelectionRange(2, 8, 'backward'); });
      await click('#fixturePassword + .password-visibility-mount button');
      const shown = await inspect();
      equal(shown.masked, false, 'pointer reveals password');
      equal(shown.focused && shown.value && shown.translated && shown.pressed, true, 'pointer preserves input focus and updates accessible labels');
      equal(await evaluate(() => { const button = document.querySelector('.password-visibility-mount button'), style = getComputedStyle(button); return button.matches(':hover') && style.transform === 'none' && style.boxShadow === 'none'; }), true, 'actual hover stays flat');
      assert.deepEqual(shown.selection, [2,8,'backward']); checks++;
      await capture(prefix + '-shown');
      await key('Tab');
      equal(await evaluate(() => document.activeElement.matches('.password-visibility-toggle')), true, 'Tab reaches the visibility button');
      equal(await evaluate(() => document.activeElement.matches(':focus-visible')), true, 'keyboard focus is visible');
      await key('Space');
      equal((await inspect()).masked, true, 'keyboard toggles password');
      await capture(prefix + '-keyboard');

      const rawName = '原文 <img onerror=alert(1)>.txt';
      await selectFiles('fixtureFiles', [rawName]);
      equal(await evaluate(() => document.querySelector('#formControlFixture .file-picker-name').textContent), rawName, 'single filename preserves raw text');
      equal(await evaluate(() => !document.querySelector('#formControlFixture .file-picker-name img')), true, 'filename cannot inject markup');
      await selectFiles('fixtureFiles', ['one.txt', 'two.txt']);
      equal(await evaluate(() => document.querySelector('#formControlFixture .file-picker-name').textContent === tr('common:local_files.selected_files',{count:2})), true, 'multiple files have a localized count');
      await evaluate(() => { const input = document.getElementById('fixturePassword'); input.focus(); input.setSelectionRange(3, 7, 'backward'); });
      const alternate = language === 'en-US' ? 'zh-CN' : 'en-US';
      await evaluate(async language => { await setTermaLanguage(language); }, alternate);
      await settle();
      const localized = await inspect();
      equal(localized.focused && localized.value && localized.translated && localized.single, true, 'live language preserves password focus and draft');
      if (localized.language === 'en-US') { assert.deepEqual(localized.han, [], 'live English fixed text and hidden attributes translate'); checks++; }
      assert.deepEqual(localized.selection, [3,7,'backward']); checks++;
      equal(await evaluate(() => document.getElementById('fixturePassword') === window.__formOriginalInput), true, 'language preserves the input node');
      equal(await evaluate(() => document.querySelector('#formControlFixture .file-picker-name').textContent === tr('common:local_files.selected_files',{count:2})), true, 'selected count translates live');
      await capture(prefix + '-live-' + alternate);
      await evaluate(async language => { await setTermaLanguage(language); }, language);
      await selectFiles('fixtureFiles', []);
      equal(await evaluate(() => document.querySelector('#formControlFixture .file-picker-name').getAttribute('data-i18n')), 'common:auto.not_selected', 'empty picker restores translation binding');
      await evaluate(() => { const input = document.getElementById('fixturePassword'); input.disabled = true; window.termaFormControls.syncPassword(input); });
      equal(await evaluate(() => document.querySelector('.password-visibility-mount button').disabled), true, 'disabled input disables visibility');
      await capture(prefix + '-disabled');
      await evaluate(() => { const input = document.getElementById('fixturePassword'); input.disabled = false; input.hidden = true; window.termaFormControls.syncPassword(input); });
      equal(await evaluate(() => document.getElementById('fixturePassword').closest('.password-input-control').hidden), true, 'hidden input hides its wrapper');
      await evaluate(() => { const input = document.getElementById('fixturePassword'); input.hidden = false; window.termaFormControls.syncPassword(input); });
      equal(await evaluate(() => !document.getElementById('fixturePassword').closest('.password-input-control').hidden), true, 'restored input restores its wrapper');
      await evaluate(() => { window.__formDetachedHost = document.querySelector('.password-visibility-mount'); document.getElementById('formControlFixture').remove(); });
      await settle();
      equal(await evaluate(() => window.__formDetachedHost.childElementCount), 0, 'removed password releases its Vue root');
      await evaluate(() => { const modal = document.getElementById('modal'); modal.appendChild(window.__formOriginalInput); window.termaFormControls.enhancePasswords(window.__formOriginalInput); });
      equal(await evaluate(() => document.getElementById('modal').querySelectorAll('.password-visibility-toggle').length), 1, 'detached input can be enhanced again once');

      await evaluate(() => { closeModal(); window.termaWorkspaceShell.showPrimary('connections'); window.termaConnectionFormWorkspace.create(); document.getElementById('connAdvancedOptions').open = true; if (isMobileLayout()) window.termaWorkspaceShell.showMobileWorkspace(); document.getElementById('conn_name').value = 'Unsaved fixture'; });
      await settle();
      await selectFiles('key_upload', ['selected-fixture.key']);
      await evaluate(() => { window.__formSelectedInput = document.getElementById('key_upload'); });
      await evaluate(async language => { await setTermaLanguage(language); }, alternate);
      await settle();
      equal(await evaluate(() => document.querySelector('#view-edit .file-picker-name').textContent), 'selected-fixture.key', 'Vue connection file label survives live language');
      equal(await evaluate(() => document.getElementById('key_upload') === window.__formSelectedInput && document.getElementById('key_upload').files.length === 1), true, 'Vue locale keeps the selected FileList');
      equal(await evaluate(() => document.getElementById('conn_name').value), 'Unsaved fixture', 'connection draft survives language');
      await evaluate(async language => { await setTermaLanguage(language); }, language);
      await settle();
      await evaluate(() => document.querySelector('#view-edit .file-picker').scrollIntoView({block:'center'}));
      await capture(prefix + '-connection-file');
      await evaluate(async () => { await window.termaQuickViews.startQuickSshConnection({host:'fixture.example',user:'fixture',port:22}); document.getElementById('quickSshPassword').value='synthetic-password'; refreshIcons(); });
      await settle();
      equal(await evaluate(() => document.getElementById('quickSshPassword').closest('.password-input-control').querySelector('button').hasAttribute('data-terma-button')), true, 'quick SSH uses the shared Vue password button');
      await capture(prefix + '-quick-password');
      await evaluate(() => window.termaQuickViews.closeQuickSshAuthModal());
      console.log('[form-controls] passed ' + prefix);
    }
    return {groups:groups.length,checks,screenshots:screenshots.length};
  } catch (error) {
    await capture('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({groups,checks,screenshots},null,2));
    await execute('closeModal();delete window.__formOriginalInput;delete window.__formSelectedInput;delete window.__formDetachedHost;');
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = { runFormControlsUiScenario };
