const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runSshHostTrustUiScenario(browser) {
  const directory = process.env.TERMA_HOST_TRUST_VISUAL_DIR || path.join(process.cwd(), 'data', 'ssh-host-trust-visual');
  fs.mkdirSync(directory, { recursive: true });
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const evaluate = (callback, ...args) => execute(`(${callback.toString()})(...${JSON.stringify(args)})`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const reports = [];
  const screenshots = [];
  let checks = 0;
  const equal = (actual, expected, name) => { assert.equal(actual, expected, name); checks++; };
  const capture = async name => {
    await execute('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await delay(100);
    const filename = name + '.png';
    fs.writeFileSync(path.join(directory, filename), (await browser.webContents.capturePage()).toPNG());
    screenshots.push(filename);
  };
  const click = async selector => {
    const point = await evaluate(selector => {
      const element = document.querySelector(selector);
      if (!element?.checkVisibility()) throw Error('Missing visible control ' + selector);
      element.scrollIntoView({ block: 'nearest' });
      const box = element.getBoundingClientRect();
      const x = Math.round(box.left + box.width / 2), y = Math.round(box.top + box.height / 2);
      if (!element.contains(document.elementFromPoint(x, y))) throw Error('Covered control ' + selector);
      return { x, y };
    }, selector);
    browser.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    browser.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    browser.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await delay(50);
  };
  const key = async (keyCode, modifiers = []) => {
    browser.webContents.focus();
    browser.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    browser.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await delay(50);
  };
  const wait = async expression => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await execute(expression)) return;
      await delay(50);
    }
    throw Error('Timed out waiting for ' + expression);
  };
  const open = async challenge => {
    await evaluate(challenge => {
      window.__hostTrustResult = 'pending';
      window.__hostTrustPromise = window.termaWorkspaceRequestPort.confirmHost(challenge).then(result => {
        window.__hostTrustResult = result;
        return result;
      });
    }, challenge);
    await delay(80);
  };
  const inspect = () => evaluate(() => {
    const modal = document.getElementById('modal');
    const card = modal.querySelector('.ssh-host-trust-modal');
    const box = card?.getBoundingClientRect();
    const buttons = [...card?.querySelectorAll('.ssh-host-trust-actions > button') || []];
    const actionBounds = buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    });
    const han = /[\u3400-\u9fff]/;
    const text = [...modal.querySelectorAll('*')].flatMap(element => [
      ...[...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent),
      ...['title', 'aria-label', 'placeholder'].map(name => element.getAttribute(name) || '')
    ]);
    return {
      visible: Boolean(card?.checkVisibility() && !modal.hidden),
      owner: modal.dataset.termaSettingsDialog,
      role: card?.getAttribute('role'),
      focused: document.activeElement?.id,
      actions: buttons.map(button => button.textContent.trim()),
      title: modal.querySelector('h2')?.textContent,
      expectedTitle: tr(card?.classList.contains('changed') ? 'common:dialogs.ssh_host_changed_title' : 'common:dialogs.ssh_host_verify_title'),
      hasPrevious: Boolean(card?.querySelector('.previous')),
      danger: Boolean(card?.querySelector('#sshHostTrustPersist')?.classList.contains('danger')),
      bounded: Boolean(box && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1 && card.scrollWidth <= card.clientWidth + 1),
      actionsFit: actionBounds.length === 3 && actionBounds.every(Boolean),
      translated: document.documentElement.lang !== 'en-US' || text.every(value => !han.test(value)),
      tileButtons: buttons.every(button => button.hasAttribute('data-terma-button')),
      escaped: !modal.querySelector('img,script,[onerror]'),
      text: card?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });

  await execute(`(async () => {
    await window.termaI18nReady;
    await window.termaWorkspaceRefresh.stop();
    window.termaSftpTransferLifecycle.polling.stop();
    closeModal();
    dismissToast();
    window.__hostTrustOriginalFetch = window.fetch;
    window.__hostTrustWrites = [];
    window.__hostTrustRequests = [];
    window.__hostTrustFailure = false;
    window.__hostTrustQuickActive = false;
    window.__hostTrustOriginalConnect = window.termaTerminalConnection.connect;
    window.termaTerminalConnection.connect = async connection => {
      window.__hostTrustQuickOpened = {id: connection.id, token:connection.quick_token};
    };
    window.fetch = async (route, options = {}) => {
      if (window.__hostTrustQuickActive && route === '/api/ssh/preflight') {
        window.__hostTrustQuickPreflights++;
        return new Response(JSON.stringify(window.__hostTrustQuickPreflights === 1 ? {
          code: 'SSH_HOST_KEY_UNKNOWN',
          challenge: {token: 'fixture-quick-token', state: 'unknown', host_label: 'quick-fixture.example:22', key_type: 'ssh-ed25519', fingerprint: 'SHA256:QUICK'}
        } : {ok: true}), {status: window.__hostTrustQuickPreflights === 1 ? 409 : 200});
      }
      if (window.__hostTrustQuickActive && route === '/api/terminal/quick-tickets') {
        window.__hostTrustQuickTickets++;
        return new Response(JSON.stringify({connection: {id: -999123, ssh_host: 'quick-fixture.example', ssh_user: 'fixture'}, token: 'fixture-ticket'}));
      }
      if (route === '/api/fixture/host-trust') {
        window.__hostTrustRequests.push({body: options.body, headers: Object.fromEntries(new Headers(options.headers))});
        const index = window.__hostTrustRequests.length;
        return new Response(JSON.stringify(index < 3 ? {
          code: index === 1 ? 'SSH_HOST_KEY_UNKNOWN' : 'SSH_HOST_KEY_CHANGED',
          challenge: {token: 'fixture-token-' + index, state: index === 1 ? 'unknown' : 'changed', host_label: 'fixture.example:22', key_type: 'ssh-ed25519', fingerprint: 'SHA256:NEW', previous_fingerprint: 'SHA256:OLD'}
        } : {ok: true}), {status: index < 3 ? 409 : 200});
      }
      if (route === '/api/ssh/host-trust') {
        window.__hostTrustWrites.push(JSON.parse(options.body));
        return new Response(JSON.stringify(window.__hostTrustFailure ? {error: 'Expired fixture challenge'} : {ok: true}), {status: window.__hostTrustFailure ? 400 : 200});
      }
      const listing = window.__trustListing;
      if (listing && route === '/api/ssh/trusted-hosts' && options.method === 'DELETE') {
        listing.deleted.push(JSON.parse(options.body));
        return Response.json({ok:true});
      }
      if (listing && typeof route === 'string' && route.startsWith('/api/ssh/trusted-hosts?')) {
        const params = new URL(route, location.origin).searchParams;
        const q = params.get('q'), page = Number(params.get('page'));
        const data = name => Response.json({page, page_size:5, total:6, total_pages:2, hosts:[{id:'fixture-trusted',host_label:name + '.example:22',fingerprint:'SHA256:TEST'}]});
        if (listing.deleted.length) return Response.json({page:1, page_size:5, total:0, total_pages:0, hosts:[]});
        if (q === 'old&query') return new Promise(resolve => { listing.old = {signal:options.signal, resolve:() => resolve(data('stale'))}; });
        return data(page === 2 ? 'page-two' : 'current');
      }
      return window.__hostTrustOriginalFetch(route, options);
    };
  })()`);
  try {
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      browser.setContentSize(width, 844);
      await evaluate(async (theme, language) => {
        await setTermaLanguage(language);
        applyTheme(theme);
        syncResponsivePane();
      }, theme, language);
      const prefix = `${width}-${language}-${theme}`;
      const group = { width, language, theme, states: [] };
      reports.push(group);
      for (const state of ['unknown', 'changed']) {
        await open({
          state, host_label: 'fixture.example:22', key_type: 'ssh-ed25519',
          fingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          previous_fingerprint: 'SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
        });
        const result = await inspect();
        group.states.push({ state, ...result });
        await capture(prefix + '-' + state);
        for (const name of ['visible', 'bounded', 'actionsFit', 'translated', 'tileButtons', 'escaped']) equal(result[name], true, prefix + ' ' + state + ' ' + name);
        equal(result.owner, 'host-trust', 'Vue owns host trust');
        equal(result.role, 'alertdialog', 'security alert role');
        equal(result.focused, 'sshHostTrustCancel', 'cancel receives initial focus');
        equal(result.title, result.expectedTitle, 'title uses current language');
        equal(result.hasPrevious, state === 'changed', 'old fingerprint appears only for changed keys');
        equal(result.danger, state === 'changed', 'changed key permanent action is dangerous');
        equal(result.overflow, false, 'page stays within viewport');

        await key('Tab');
        equal(await evaluate(() => document.activeElement?.classList.contains('dialog-window-resize')), true, 'resize handle is reachable after Cancel');
        await key('Tab');
        equal(await evaluate(() => document.activeElement?.id), 'sshHostTrustOnce', 'Tab loops from resize to first action');
        await key('Tab', ['shift']);
        equal(await evaluate(() => document.activeElement?.classList.contains('dialog-window-resize')), true, 'Shift Tab loops to resize handle');
        await key('Tab', ['shift']);
        equal(await evaluate(() => document.activeElement?.id), 'sshHostTrustCancel', 'Shift Tab reaches Cancel');
        await key('Tab');
        await key('Tab');
        await key('Tab');
        const keyboard = await evaluate(() => {
          const element = document.activeElement, style = getComputedStyle(element);
          return { id: element?.id, visible: element.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth, documentFocused: document.hasFocus() };
        });
        group.states.push({ state, keyboard });
        equal(keyboard.visible && keyboard.outline !== 'none', true, 'keyboard focus remains visible ' + JSON.stringify(keyboard));
        await evaluate(() => document.getElementById('sshHostTrustCancel').focus());
        await capture(prefix + '-' + state + '-keyboard');
        const hoverPoint = await evaluate(() => {
          const button = document.getElementById('sshHostTrustOnce');
          const box = button.getBoundingClientRect();
          return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
        });
        browser.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint });
        await delay(100);
        equal(await evaluate(() => {
          const button = document.getElementById('sshHostTrustOnce'), style = getComputedStyle(button);
          return button.matches(':hover') && style.boxShadow === 'none' && style.transform === 'none';
        }), true, 'pointer hover stays flat');
        await capture(prefix + '-' + state + '-hover');
        await evaluate(() => {
          window.__hostTrustCard = document.querySelector('.ssh-host-trust-modal');
          window.__hostTrustCancel = document.getElementById('sshHostTrustCancel');
          document.querySelector('#modal .modal-card').scrollTop = 4;
        });
        const alternate = language === 'zh-CN' ? 'en-US' : 'zh-CN';
        await evaluate(async language => { await setTermaLanguage(language); }, alternate);
        const live = await inspect();
        equal(live.bounded && live.actionsFit, true, 'live language keeps every action inside the viewport');
        equal(live.translated, true, 'open dialog and attributes translate immediately');
        equal(live.title, live.expectedTitle, 'open dialog title translates');
        equal(await evaluate(() => document.querySelector('.ssh-host-trust-modal') === window.__hostTrustCard && document.activeElement === window.__hostTrustCancel), true, 'live language preserves dialog and focus');
        await capture(prefix + '-' + state + '-live-' + alternate);
        await evaluate(async language => { await setTermaLanguage(language); }, language);
        await evaluate(() => document.getElementById('modal').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        equal(await evaluate(() => window.__hostTrustResult), 'pending', 'backdrop does not grant or cancel');
        await click(state === 'unknown' ? '#sshHostTrustOnce' : '#sshHostTrustPersist');
        equal(await evaluate(() => window.__hostTrustResult), state === 'unknown' ? 'once' : 'persist', 'explicit pointer action returns its trust mode');
        equal(await evaluate(() => document.getElementById('modal').hidden), true, 'resolved dialog closes');
      }

      await open({ host_label: '<img src=x onerror="window.hostTrustInjected=true">', fingerprint: 'SHA256:<script>probe</script>' });
      equal((await inspect()).escaped, true, 'challenge values render as text');
      equal(await evaluate(() => window.hostTrustInjected === undefined), true, 'challenge cannot execute markup');
      await capture(prefix + '-escaped-input');
      await key('Escape');
      equal(await evaluate(() => window.__hostTrustResult), null, 'Escape cancels trust');
      await open({});
      equal((await inspect()).visible, true, 'missing display fields remain cancellable');
      await click('#sshHostTrustCancel');
      equal(await evaluate(() => window.__hostTrustResult), null, 'cancel button denies trust');
      await open({ host_label: 'long-host-' + 'a'.repeat(180) + '.example:2222', fingerprint: 'SHA256:' + 'C'.repeat(128) });
      equal((await inspect()).bounded && (await inspect()).actionsFit, true, 'long host and fingerprint wrap inside the dialog');
      await capture(prefix + '-long-values');
      await key('Escape');

      await open({ host_label: 'first.example:22' });
      await evaluate(() => { window.__firstHostTrust = window.__hostTrustPromise; });
      await open({ host_label: 'second.example:22' });
      equal(await evaluate(() => window.__firstHostTrust), null, 'a new challenge cancels the old one');
      equal((await inspect()).visible, true, 'replacement stays visible');
      await capture(prefix + '-replacement');
      await evaluate(() => closeModal());
      equal(await evaluate(() => window.__hostTrustResult), null, 'external close cancels trust');
      await open({ host_label: 'replace-with-input.example:22' });
      await evaluate(() => { void inputModal('Fixture input', 'Fixture value', 'unsaved'); });
      equal(await evaluate(() => window.__hostTrustResult), null, 'another dialog cancels trust');
      equal(await evaluate(() => !document.getElementById('modal').hidden && document.getElementById('modalInputValue')?.value === 'unsaved'), true, 'replacement input remains visible');
      await evaluate(() => closeModal());

      await evaluate(() => {
        window.__hostTrustRequests = [];
        window.__hostTrustWrites = [];
        window.__hostTrustApiResult = null;
        window.__hostTrustApiPromise = api('/api/fixture/host-trust', { method: 'POST', body: '{"connection_id":123}', headers: { 'X-Fixture': 'preserve' } }).then(
          value => { window.__hostTrustApiResult = value; },
          error => { window.__hostTrustApiResult = {error: error.message, code: error.code}; }
        );
      });
      await delay(100);
      await capture(prefix + '-api-unknown');
      await click('#sshHostTrustOnce');
      await delay(100);
      equal((await inspect()).hasPrevious, true, 'API retry presents changed key separately');
      await capture(prefix + '-api-changed');
      await click('#sshHostTrustPersist');
      await evaluate(() => window.__hostTrustApiPromise);
      const retry = await evaluate(() => ({
        result: window.__hostTrustApiResult,
        writes: window.__hostTrustWrites,
        requests: window.__hostTrustRequests
      }));
      equal(retry.result.ok, true, 'request resumes after trust');
      assert.deepEqual(retry.writes, [{ token: 'fixture-token-1', mode: 'once' }, { token: 'fixture-token-2', mode: 'persist' }]); checks++;
      equal(retry.requests.length, 3, 'two challenges cause exactly two retries');
      equal(retry.requests.every(request => request.body === '{"connection_id":123}' && request.headers['x-fixture'] === 'preserve'), true, 'retry preserves request body and headers');

      await evaluate(() => {
        window.__hostTrustRequests = [];
        window.__hostTrustWrites = [];
        window.__hostTrustApiPromise = api('/api/fixture/host-trust').catch(error => { window.__hostTrustApiResult = {code: error.code}; });
      });
      await delay(100);
      await click('#sshHostTrustCancel');
      await evaluate(() => window.__hostTrustApiPromise);
      equal(await evaluate(() => window.__hostTrustApiResult.code), 'SSH_HOST_TRUST_CANCELLED', 'API cancellation keeps existing code');
      equal(await evaluate(() => window.__hostTrustWrites.length), 0, 'cancelled challenge never grants trust');

      await evaluate(() => {
        window.__hostTrustFailure = true;
        window.__hostTrustRequests = [];
        window.__hostTrustWrites = [];
        window.__hostTrustApiPromise = api('/api/fixture/host-trust').catch(error => {
          window.__hostTrustApiResult = {status: error.status, details: error.details};
        });
      });
      await delay(100);
      await click('#sshHostTrustPersist');
      await evaluate(() => window.__hostTrustApiPromise);
      equal(await evaluate(() => window.__hostTrustApiResult.status), 400, 'trust rejection reaches the caller');
      equal(await evaluate(() => window.__hostTrustApiResult.details.error), 'Expired fixture challenge', 'trust rejection keeps its response details');
      equal(await evaluate(() => window.__hostTrustRequests.length), 1, 'trust rejection prevents retrying the original request');
      equal(await evaluate(() => window.__hostTrustWrites.length), 1, 'trust rejection is submitted only once');
      equal(await evaluate(() => document.getElementById('modal').hidden), true, 'trust rejection leaves no pending confirmation');
      await evaluate(() => { window.__hostTrustFailure = false; });

      await evaluate(async () => {
        window.__hostTrustQuickActive = true;
        window.__hostTrustQuickPreflights = 0;
        window.__hostTrustQuickTickets = 0;
        window.__hostTrustQuickOpened = null;
        await window.termaQuickViews.startQuickSshConnection({host: 'quick-fixture.example', user: 'fixture', port: 22});
        document.getElementById('quickSshPassword').value = 'synthetic-test-password';
        window.__hostTrustQuickPassword = document.getElementById('quickSshPassword');
        window.__hostTrustQuickForm = document.querySelector('.quick-ssh-auth-modal');
        window.__hostTrustQuickPromise = window.termaQuickSshFlow.submit(window.__hostTrustQuickForm, document.getElementById('quickSshConnect'));
      });
      await wait("Boolean(document.querySelector('.ssh-host-trust-modal')?.checkVisibility())");
      equal(await evaluate(() => window.__hostTrustQuickPassword.value), '', 'quick SSH handoff clears detached password');
      equal(await evaluate(() => window.__hostTrustQuickForm.dataset.submitting), '1', 'host verification keeps the submitted request active');
      await capture(prefix + '-quick-ssh-handoff');
      await click('#sshHostTrustOnce');
      await evaluate(() => window.__hostTrustQuickPromise);
      await wait("Boolean(window.__hostTrustQuickOpened)");
      equal(await evaluate(() => window.__hostTrustQuickOpened?.id), -999123, 'quick SSH resumes after explicit trust');
      equal(await evaluate(() => window.__hostTrustQuickTickets), 1, 'quick SSH creates exactly one ticket');
      equal(await evaluate(() => document.getElementById('modal').hidden), true, 'quick SSH handoff closes confirmation');
      await evaluate(() => {
        window.__hostTrustQuickActive = false;
        const keys=tabs.filter(tab=>tab.kind==='quick-terminal').map(tab=>tab.key);
        for(const key of keys)disconnectTerminal(key);
        closeTabsByKey(keys);
      });

      await evaluate(async () => {
        window.__trustListing = {deleted:[]};
        window.termaWorkspaceShell.showPrimary('settings'); await window.termaSettingsViews.open();
        window.termaSettingsNavigation.show('settings-basic');
        const input = document.getElementById('sshHostTrustSearch');
        input.value = 'old&query';
        input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
        input.value = ' new search ';
        input.closest('.ssh-trust-search').querySelector('button').click();
      });
      await wait("Boolean(window.__trustListing.old?.signal.aborted && window.termaTrustedHosts.snapshot().query === 'new search')");
      await evaluate(() => window.__trustListing.old.resolve());
      await delay(50);
      equal(await evaluate(() => document.querySelector('#sshHostTrustPanel .ssh-trust-record-main').textContent.includes('current.example:22')),
        true, 'stale response cannot replace the latest search result');
      await click('#sshHostTrustPanel .ssh-trust-pager button:last-child');
      await wait("document.querySelector('#sshHostTrustPanel .ssh-trust-record-main')?.textContent.includes('page-two.example:22')");
      await capture(prefix + '-settings-trusted-page');
      const removeSelector = '#sshHostTrustPanel .ssh-trust-record-side button';
      await click(removeSelector);
      await capture(prefix + '-settings-trusted-confirm');
      await click('#modal [data-choice="1"]');
      equal(await evaluate(() => window.__trustListing.deleted.length), 0, 'cancel never deletes a trust record');
      await click(removeSelector);
      await click('#modal [data-choice="0"]');
      await wait("!document.querySelector('#sshHostTrustPanel .ssh-trust-record') && window.__trustListing.deleted.length === 1");
      assert.deepEqual(await evaluate(() => window.__trustListing.deleted), [{id:'fixture-trusted'}]); checks++;
      await capture(prefix + '-settings-trusted-empty');
      await evaluate(() => { delete window.__trustListing; });
      console.log('[host-trust] passed ' + prefix);
    }
    return { scenario: 'ssh-host-trust', groups: reports.length, checks, screenshots: screenshots.length };
  } catch (error) {
    await capture('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ groups: reports, checks, screenshots }, null, 2));
    await execute(`closeModal(); window.fetch = window.__hostTrustOriginalFetch; window.termaTerminalConnection.connect = window.__hostTrustOriginalConnect; delete window.__hostTrustOriginalFetch; delete window.__hostTrustOriginalConnect;`);
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = { runSshHostTrustUiScenario };
