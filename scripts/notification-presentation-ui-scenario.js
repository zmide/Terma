const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runNotificationPresentationUiScenario(browser) {
  const directory = process.env.TERMA_NOTIFICATION_VISUAL_DIR || path.join(process.cwd(), 'data', 'notification-presentation-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  let checks = 0;
  const screenshots = [], groups = [];
  const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
  const settle = async () => {
    await execute('(async()=>{await window.termaConnectionLocalizationReady;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
    await delay(300);
  };
  const shot = async name => {
    await settle();
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), (await browser.webContents.capturePage()).toPNG());
    screenshots.push(file);
  };
  const move = async (x, y) => {
    browser.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await delay(30);
  };
  const point = selector => evaluate(selector => {
    const button = document.querySelector(selector);
    const box = button?.getBoundingClientRect();
    if (!box || !button.checkVisibility()) throw Error('Hidden notification control ' + selector);
    const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (!button.contains(document.elementFromPoint(point.x, point.y))) throw Error('Covered notification control ' + selector);
    return point;
  }, selector);
  const click = async selector => {
    const position = await point(selector);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) browser.webContents.sendInputEvent({ type, ...position, button: 'left', clickCount: 1 });
    await settle();
  };
  const key = async keyCode => {
    browser.webContents.focus();
    browser.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    browser.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  };
  const inspect = () => evaluate(() => {
    const root = document.getElementById('toast'), cards = [...root.querySelectorAll('.toast')];
    const within = box => box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
    const han = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (/[\u3400-\u9fff]/.test(walker.currentNode.textContent)) han.push(walker.currentNode.textContent.trim());
    for (const node of root.querySelectorAll('*')) for (const attribute of ['title','aria-label','placeholder']) {
      if (/[\u3400-\u9fff]/.test(node.getAttribute(attribute) || '')) han.push(node.getAttribute(attribute));
    }
    return {
      count: cards.length,
      owned: cards.every(card => card.hasAttribute('data-terma-notification-owned') && !card.querySelector('[onclick]')),
      visible: cards.every(card => card.checkVisibility() && within(card.getBoundingClientRect())),
      buttonsFit: cards.every(card => [...card.querySelectorAll('button')].filter(button => button.checkVisibility()).every(button => {
        const box = button.getBoundingClientRect(), outer = card.getBoundingClientRect();
        return within(box) && box.left >= outer.left && box.right <= outer.right + 1;
      })),
      uncovered: cards.every(card => {
        const box = card.getBoundingClientRect();
        return card.contains(document.elementFromPoint(box.left + 10, box.top + 10));
      }),
      icons: cards.every(card => {
        const holder = card.querySelector('.toast-icon').getBoundingClientRect(), glyph = card.querySelector('.toast-icon svg')?.getBoundingClientRect();
        return glyph && Math.abs(glyph.left + glyph.width / 2 - holder.left - holder.width / 2) < 1 && Math.abs(glyph.top + glyph.height / 2 - holder.top - holder.height / 2) < 1;
      }),
      noOverlap: cards.slice(1).every((card, index) => card.getBoundingClientRect().top >= cards[index].getBoundingClientRect().bottom + 1),
      noMarkup: !root.querySelector('img,script') && !window.__notificationInjected,
      closeLabels: cards.every(card => card.querySelector('.toast-head button').getAttribute('aria-label') === tr('common:auto.close_hint')),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      han,
      cards: cards.map(card => ({ box: card.getBoundingClientRect().toJSON(), text: card.innerText }))
    };
  });
  await execute('(async()=>{await window.termaI18nReady;await window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();closeModal();window.termaNotificationToasts.dispose();})()');
  try {
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const prefix = `${width}-${language}-${theme}`;
      browser.setContentSize(width, 844);
      await move(5, 120);
      await evaluate(async (theme, language) => {
        window.termaNotificationToasts.dispose();
        await setTermaLanguage(language); applyTheme(theme);
        window.termaWorkspaceShell.showPrimary('connections'); window.termaConnectionFormWorkspace.create();
        if (isMobileLayout()) window.termaWorkspaceShell.showMobileWorkspace();
        document.getElementById('conn_name').value = 'Unsaved notification draft';
        window.termaRuntimeSettingsModel.snapshot.saved.notification_display = {
          info: { enabled: true, duration_ms: 60000 }, success: { enabled: true, duration_ms: 60000 },
          error: { enabled: true, duration_ms: 60000 }, progress: { enabled: true, success_duration_ms: 60000, error_duration_ms: 60000 }
        };
        window.__notificationInjected = false;
        window.__notificationPauses = [];
        window.__notificationCancels = 0;
        notify('Fixture <img src=x onerror=window.__notificationInjected=true>\nRaw <script> content stays text', 'info', { replaceKey: 'fixture' });
        notify('Fixture success', 'success');
        notify('Fixture error', 'error');
      }, theme, language);
      await settle();
      const initial = await inspect();
      equal(await evaluate(() => [...document.querySelectorAll('#toast .toast-copy strong')].every(node => getComputedStyle(node).fontSize === '12px')), true, prefix + ' compact notification text');
      groups.push({ width, theme, language, initial });
      for (const name of ['owned','visible','buttonsFit','uncovered','icons','noOverlap','noMarkup','closeLabels']) equal(initial[name], true, prefix + ' ' + name);
      equal(initial.count, 3, 'three notification levels render');
      equal(initial.overflow, false, 'notification stack does not overflow');
      if (language === 'en-US') { assert.deepEqual(initial.han, [], 'English notifications and hidden attributes translate'); checks++; }
      equal(await evaluate(() => document.querySelector('.toast.error').getAttribute('role')), 'alert', 'error announces alert');
      await shot(prefix + '-stack');
      await evaluate(() => {
        window.__notificationReplaced = document.querySelector('[data-toast-replace-key="fixture"]');
        notify('Replacement title\nReplacement detail', 'success', { replaceKey: 'fixture' });
      });
      equal(await evaluate(() => document.querySelector('[data-toast-replace-key="fixture"]') === window.__notificationReplaced && document.querySelectorAll('#toast .toast').length === 3), true, 'replacement retains one DOM card');
      await click('.toast:first-of-type .toast-head button');
      equal(await evaluate(() => document.querySelectorAll('#toast .toast').length), 2, 'pointer closes one card');
      await shot(prefix + '-reflow');
      await evaluate(() => {
        window.termaNotificationToasts.dispose();
        window.__notificationProgress = createProgressToast({
          progress: 37, onCancel: () => window.__notificationCancels++,
          onPauseChange: value => window.__notificationPauses.push(value)
        });
        window.__notificationProgressNode = document.querySelector('.toast-progress');
      });
      await settle();
      equal(await evaluate(() => document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')), '37', 'determinate progress has accessible value');
      await click('.toast-progress-pause');
      equal(await evaluate(() => document.querySelector('.toast-progress').classList.contains('paused')), true, 'pointer pauses progress');
      equal(await evaluate(() => { const button = document.querySelector('.toast-progress-pause'); const style = getComputedStyle(button); return button.matches(':hover') && style.transform === 'none' && style.boxShadow === 'none'; }), true, 'notification hover stays flat');
      await evaluate(() => document.querySelector('.toast-progress-close').focus());
      await key('Tab');
      equal(await evaluate(() => document.activeElement.matches('.toast-progress-pause') && document.activeElement.matches(':focus-visible')), true, 'keyboard reaches progress with visible focus');
      await shot(prefix + '-keyboard');
      await key('Space');
      equal(await evaluate(() => JSON.stringify(window.__notificationPauses)), '[true,false]', 'keyboard resumes progress once');
      await evaluate(() => {
        window.__notificationFocus = document.activeElement;
        window.__notificationProgressScroll = document.querySelector('.workspace')?.scrollTop || 0;
      });
      const alternate = language === 'en-US' ? 'zh-CN' : 'en-US';
      await evaluate(async language => { await setTermaLanguage(language); }, alternate);
      await settle();
      equal(await evaluate(() => document.activeElement === window.__notificationFocus && document.querySelector('.toast-progress') === window.__notificationProgressNode), true, 'live language retains notification node and focus');
      equal(await evaluate(() => document.getElementById('conn_name').value === 'Unsaved notification draft' && (document.querySelector('.workspace')?.scrollTop || 0) === window.__notificationProgressScroll), true, 'live language retains page draft and scroll');
      equal(await evaluate(() => document.querySelector('.toast-copy strong').textContent === tr('common:auto.processing_now') && document.querySelector('.toast-progress-pause').textContent === tr('common:actions.pause')), true, 'open progress controls translate immediately');
      const localized = await inspect();
      equal(localized.buttonsFit && localized.closeLabels, true, 'translated controls fit and labels update');
      if (alternate === 'en-US') { assert.deepEqual(localized.han, [], 'live English scans hidden progress controls'); checks++; }
      await shot(prefix + '-live-' + alternate);
      await evaluate(async language => { await setTermaLanguage(language); window.__notificationProgress.update({ progress: undefined }); }, language);
      equal(await evaluate(() => document.querySelector('.toast-progress-track').classList.contains('indeterminate') && !document.querySelector('.toast-progress-track').hasAttribute('aria-valuenow')), true, 'indeterminate progress clears accessible value');
      await shot(prefix + '-indeterminate');
      await evaluate(() => window.__notificationProgress.finish());
      equal(await evaluate(() => document.querySelector('.toast-progress').classList.contains('success') && document.querySelector('.toast-progress-actions').hidden && document.querySelector('.toast-copy span').textContent === tr('common:auto.done')), true, 'success settles and hides actions');
      await shot(prefix + '-finished');
      await click('.toast-progress-close');
      equal(await evaluate(() => window.__notificationCancels), 0, 'settled close does not cancel the task');
      await evaluate(() => {
        window.__notificationProgress = createProgressToast({ onCancel: () => window.__notificationCancels++ });
        window.__notificationProgress.fail();
      });
      equal(await evaluate(() => document.querySelector('.toast-progress-track').hidden && document.querySelector('.toast-progress-actions').hidden && document.querySelector('.toast-copy span').textContent === tr('common:auto.operation_failed')), true, 'failure hides track and updates text');
      await shot(prefix + '-failed');
      await evaluate(() => {
        window.termaNotificationToasts.dispose();
        window.__notificationProgress = createProgressToast({ onCancel: () => window.__notificationCancels++ });
      });
      await settle();
      await click('.toast-progress-cancel');
      await evaluate(() => { window.__notificationProgress.dismiss(); window.__notificationProgress.update({ title: 'late update' }); });
      equal(await evaluate(() => window.__notificationCancels === 1 && window.termaNotificationToasts.size === 0), true, 'cancel and late controller execute once');

      await evaluate(() => {
        window.__notificationActionCalls = [];
        window.__notificationOriginalActions = [window.termaWorkspaceRequest, window.termaGeneratedFiles.current().open, window.termaGeneratedFiles.current().directory, window.termaGeneratedFiles.current().deleteFile];
        window.termaWorkspaceRequest = (path, options) => {
          if (!path.startsWith('/api/sftp/download-settings/')) return window.__notificationOriginalActions[0](path, options);
          const action = path.slice('/api/sftp/download-settings/'.length);
          const id = JSON.parse(options.body).job_id;
          const busy = window.termaUiActions.isInFlight(`sftp-task:${action}:${id}`);
          window.__notificationActionCalls.push([action, id, options.method, busy]);
          if (action === 'open-file') return new Promise((_, reject) => { window.__notificationOpenFailed = reject; });
          return Promise.resolve({});
        };
        window.termaGeneratedFiles.current().open = (id, button) => window.__notificationActionCalls.push(['generated-file', id, button instanceof HTMLButtonElement]);
        window.termaGeneratedFiles.current().directory = (id, button) => window.__notificationActionCalls.push(['generated-directory', id, button instanceof HTMLButtonElement]);
        window.termaGeneratedFiles.current().deleteFile = (id, button) => window.__notificationActionCalls.push(['generated-delete', id, button instanceof HTMLButtonElement]);
      });
      for (const generated of [false, true]) {
        await evaluate(generated => {
          window.termaNotificationToasts.dispose();
          notify('Fixture task actions', 'success', { action: {
            [generated ? 'generated_task_id' : 'download_job_id']: 'fixture-job',
            can_open_file: true, can_open_directory: true, can_delete_file: true
          } });
        }, generated);
        await settle();
        const actions = await inspect();
        equal(actions.buttonsFit && actions.icons && actions.uncovered, true, 'task action buttons remain visible and within card');
        equal(await evaluate(() => {
          const button = document.querySelector('[data-toast-action="delete-file"]');
          const probe = document.createElement('span');
          probe.style.color = 'var(--danger)'; button.parentElement.append(probe);
          const expected = getComputedStyle(probe).color; probe.remove();
          return getComputedStyle(button).color === expected;
        }), true, 'danger action retains theme semantic color');
        if (language === 'en-US') { assert.deepEqual(actions.han, [], 'task action fixed labels translate'); checks++; }
        await shot(prefix + (generated ? '-generated-actions' : '-download-actions'));
        for (const kind of ['open-file','open-directory','delete-file']) {
          await click(`[data-toast-action="${kind}"]`);
          if (!generated && kind === 'open-file') {
            equal(await evaluate(() => {
              const button = document.querySelector('[data-toast-action="open-file"]');
              const wasBusy = button.disabled;
              button.dispatchEvent(new MouseEvent('click', {bubbles:true}));
              window.__notificationOpenFailed(new Error('Fixture E902'));
              return wasBusy;
            }), true, 'opening a downloaded file locks its button');
            await settle();
            const restored = await evaluate(() => ({
              disabled: document.querySelector('[data-toast-action="open-file"]').disabled,
              inFlight: window.termaUiActions.isInFlight('sftp-task:open-file:fixture-job'),
              errors: Array.from(document.querySelectorAll('.toast.error')).map(toast => toast.querySelector('.toast-copy strong')?.textContent)
            }));
            assert.deepEqual(restored, {disabled:false, inFlight:false, errors:['Fixture E902']}, 'download failure releases the lock and shows an error');
            checks++;
          }
        }
        equal(await evaluate(() => {
          const button = document.querySelector('[data-toast-action="delete-file"]'), style = getComputedStyle(button);
          const probe = document.createElement('span');
          probe.style.color = 'var(--danger)'; button.parentElement.append(probe);
          const expected = getComputedStyle(probe).color; probe.remove();
          return button.matches(':hover') && style.color === expected && style.transform === 'none' && style.boxShadow === 'none';
        }), true, 'hovered danger action retains theme semantic color');
        await shot(prefix + (generated ? '-generated-hover' : '-download-hover'));
      }
      assert.deepEqual(await evaluate(() => window.__notificationActionCalls), [
        ['open-file','fixture-job','POST',true], ['open','fixture-job','POST',false], ['delete-file','fixture-job','POST',true],
        ['generated-file','fixture-job',false], ['generated-directory','fixture-job',false], ['generated-delete','fixture-job',false]
      ], 'toast actions route each job correctly and send only one request while the file action is busy');
      checks++;
      await evaluate(() => {
        [window.termaWorkspaceRequest, window.termaGeneratedFiles.current().open, window.termaGeneratedFiles.current().directory, window.termaGeneratedFiles.current().deleteFile] = window.__notificationOriginalActions;
        delete window.__notificationOriginalActions;
        window.termaNotificationToasts.dispose();
        window.termaRuntimeSettingsModel.snapshot.saved.notification_display.info.duration_ms = 180;
        notify('Hover lifetime fixture', 'info');
      });
      const hover = await point('.toast-head button');
      await move(hover.x, hover.y);
      await delay(350);
      equal(await evaluate(() => document.querySelectorAll('#toast .toast:not(.is-leaving)').length), 1, 'real pointer suspends automatic dismissal');
      await shot(prefix + '-hover-paused');
      await move(5, 120);
      equal(await evaluate(() => !document.querySelector('#toast .toast:hover')), true, 'pointer has left the notification card');
      await delay(600);
      equal(await evaluate(() => window.termaNotificationToasts.size), 0, 'pointer departure resumes automatic dismissal');
      await shot(prefix + '-hover-dismissed');
      await evaluate(() => {
        window.termaRuntimeSettingsModel.snapshot.saved.notification_display.success.enabled = false;
        window.termaRuntimeSettingsModel.snapshot.saved.notification_display.progress.enabled = false;
        notify('suppressed success', 'success');
        const disabled = createProgressToast({ onCancel: () => window.__notificationCancels++ });
        disabled.dismiss(); disabled.finish();
      });
      equal(await evaluate(() => window.termaNotificationToasts.size === 0 && window.__notificationCancels === 1), true, 'category preferences suppress cards and return inert progress controller');
      console.log('[notifications] passed ' + prefix);
    }
    const polling = await evaluate(async () => {
      const originalApi = api, originalNotify = notify, originalDesktop = window.termaSystemNotifications.show;
      const state = window.termaNotificationState.state;
      const requests = [], displayed = [], desktop = [];
      let release, response = null;
      try {
        api = (route, options) => {
          if (!String(route).startsWith('/api/notifications?')) return originalApi(route, options);
          requests.push(route);
          return response === null ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response);
        };
        notify = (...args) => displayed.push(args);
        window.termaSystemNotifications.show = event => desktop.push(event.id);
        state.lastId = 0; state.cursorInitialized = false;
        const first = window.termaNotificationPolling.initialize(), second = window.termaNotificationPolling.initialize();
        await Promise.resolve();
        const poll = window.termaNotificationPolling.poll();
        await window.termaNotificationPolling.poll();
        const singleRequest = requests.length === 1;
        release([{ id: 50 }, { id: 'invalid' }]);
        await Promise.all([first, second, poll]);
        const historySkipped = displayed.length === 0 && state.lastId === 50 && Number(localStorage.getItem('lastNotificationId')) === 50;
        response = [
          { id: 50, title: 'Duplicate history' },
          { id: 51, title: 'Silent fixture', silent: true },
          { id: 52, title: 'Visible fixture' },
          { id: 52, title: 'Duplicate fixture' },
          { id: 'invalid', title: 'Invalid fixture' }
        ];
        await window.termaNotificationPolling.poll();
        const deduplicated = displayed.length === 1 && desktop.length === 1 && state.lastId === 52 && Number(localStorage.getItem('lastNotificationId')) === 52;
        response = { invalid: true };
        await window.termaNotificationPolling.poll();
        const failedUnlocked = Boolean(window.termaNotificationPolling.lastError) && !state.pollInFlight;
        response = [];
        await window.termaNotificationPolling.poll();
        return {
          singleRequest, historySkipped, deduplicated, failedUnlocked,
          recovered: window.termaNotificationPolling.lastError === null && !state.pollInFlight && state.lastId === 52,
          language: requests.every(route => route.includes('&language=')),
          getsOnly: requests.every(route => route.startsWith('/api/notifications?since=')),
          requests
        };
      } finally { api = originalApi; notify = originalNotify; window.termaSystemNotifications.show = originalDesktop; }
    });
    groups.push({ polling });
    for (const name of ['singleRequest','historySkipped','deduplicated','failedUnlocked','recovered','language','getsOnly']) equal(polling[name], true, 'browser polling ' + name);
    await evaluate(async () => {
      window.termaNotificationToasts.dispose();
      await setTermaLanguage('en-US');
      window.termaRuntimeSettingsModel.snapshot.saved.notification_display.info.duration_ms = 60000;
      notify('Fixture multiline\n已完成\n操作失败', 'info');
    });
    equal(await evaluate(() => document.querySelector('.toast-copy span').textContent === [tr('common:auto.done'), tr('common:auto.operation_failed')].join('\n')), true, 'multiline notifications preserve per-line localization');
    await evaluate(() => {
      window.termaNotificationToasts.dispose();
      window.termaRuntimeSettingsModel.snapshot.saved.notification_display.progress.enabled = true;
      window.__notificationPagehide = createProgressToast();
      notify('Pagehide timer fixture', 'info');
    });
    equal(await evaluate(() => window.termaNotificationToasts.size === 2 && window.termaNotificationToasts.timerCount > 0), true, 'pagehide fixture owns active cards and timers');
    await evaluate(() => window.dispatchEvent(new Event('pagehide')));
    equal(await evaluate(() => window.termaNotificationToasts.size === 0 && window.termaNotificationToasts.timerCount === 0 && !document.querySelector('#toast .toast')), true, 'pagehide releases cards and all notification timers');
    return { groups: groups.length, checks, screenshots: screenshots.length };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ groups, checks, screenshots }, null, 2));
    await execute(`window.termaNotificationToasts.dispose();if(window.__notificationOriginalActions){[window.termaWorkspaceRequest,window.termaGeneratedFiles.current().open,window.termaGeneratedFiles.current().directory,window.termaGeneratedFiles.current().deleteFile]=window.__notificationOriginalActions;}closeModal();`);
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = { runNotificationPresentationUiScenario };
