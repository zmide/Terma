const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Uses the real browser and API-to-view normalizer, with isolated task fixtures.
async function runTaskUiScenario(browser) {
  const directory = process.env.TERMA_TASK_VISUAL_DIR || path.join(process.cwd(), 'data', 'task-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const call = (fn, ...args) => execute('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const reports = [];
  let screenshots = 0;
  const capture = async name => {
    await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await delay(100);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, name.replace(/:/g, '-') + '.png'), (await browser.webContents.capturePage()).toPNG());
    screenshots++;
  };
  const click = async selector => {
    const point = await call(async selector => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const element = document.querySelector(selector);
        if (!element?.checkVisibility()) throw Error('Missing task control: ' + selector);
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const target = document.querySelector(selector);
        if (!target) continue;
        const r = target.getBoundingClientRect();
        const point={ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },hit=document.elementFromPoint(point.x,point.y);
        window.__taskReview.lastClick={selector,point,hit:hit?.className};
        if(hit===target||target.contains(hit))return point;
      }
      throw Error('Task click target is covered '+JSON.stringify(window.__taskReview.lastClick));
    }, selector);
    const client = browser.webContents.debugger;
    const detach = !client.isAttached();
    if (detach) client.attach('1.3');
    try {
      await client.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await client.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await client.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
    } finally { if(detach)client.detach(); }
    await delay(90);
  };
  await call(async () => {
    await window.termaI18nReady;
    window.__taskReview = { api, connections, runtimeSettings: window.termaRuntimeSettingsModel.snapshot, desktop: window.termaDesktop, jobs: window.termaSftpTaskWorkspace.state.jobs, writes: [],
      anchorClick:HTMLAnchorElement.prototype.click,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL };
    // Exercise the real blob saver, but never write a fixture report to the host.
    HTMLAnchorElement.prototype.click=function(){
      const review=window.__taskActionReview;
      if(review&&this.download.startsWith('terma-sync-')){review.saved.push({name:this.download,url:this.href,attached:this.isConnected});return;}
      return window.__taskReview.anchorClick.call(this);
    };
    URL.createObjectURL=function(blob){const url=window.__taskReview.createObjectURL.call(URL,blob);window.__taskActionReview?.blobs.push({url,blob});return url;};
    URL.revokeObjectURL=function(url){window.__taskActionReview?.revoked.push(url);return window.__taskReview.revokeObjectURL.call(URL,url);};
    closeModal(); window.termaEfficiency.palette.close(); window.termaSftpTaskWorkspace.runtime.close();
    const now = Date.UTC(2026, 9, 19, 3, 15, 20);
    const make = (id, type, status, extra = {}) => ({
      id, type, status, label: type, connection_name: 'Review host', connection_id: 7901,
      remote_path: '/review/' + id + '.txt', size: 1024, transferred: status === 'done' ? 1024 : 256,
      finished_at: ['done', 'failed', 'cancelled'].includes(status) ? now : null, ...extra
    });
    window.__taskTransferFixtures = [
      make('download-running', 'download', 'running', { resume_supported: true, can_pause: true }),
      make('upload-paused', 'upload', 'paused', { resume_supported: true, can_resume: true }),
      make('copy-pending', 'cross-copy', 'pending', { source_connection_name: 'Source host', item_count: 2 }),
      make('upload-committing', 'upload', 'running', { phase: 'committing', can_pause: false }),
      make('download-failed', 'download', 'failed', { can_resume: true, error: 'Review transfer error' }),
      make('delivery-failed', 'download', 'done', { delivery_status: 'failed', delivery_error: 'Review save error' }),
      ...['saved', 'delivered', 'expired', 'cache_cleared', 'ready'].map(delivery_status =>
        make('download-' + delivery_status, 'download', 'done', { delivery_status,
          ...(delivery_status === 'saved' ? { saved_path: 'C:/Review/.dmrc', renamed_files: [{ source: '.dmrc', target: '.dmrc (2)' }] } : {}) })),
      make('upload-done', 'upload', 'done'),
      make('delete-done', 'delete', 'done', { label: '删除 3 项', size: 3, transferred: 3, progress_unit: 'items', item_count: 3 }),
      make('copy-cancelled', 'cross-copy', 'cancelled', { item_count: 2 }),
      make('generated-saved', 'local-generated', 'done', { label: 'Review report.csv', delivery_status: 'saved', saved_path: 'C:/Review/report.csv' }),
      make('generated-delivered', 'local-generated', 'done', { label: 'Review result.csv', delivery_status: 'delivered' }),
      ...['running', 'done', 'failed', 'cancelled'].map(status =>
        make('native-' + status, 'native-drag', status, { label: '拖出 Review report.txt 到本机', item_count: 1,
          phase: 'system-saving', current: '正在由系统保存', can_cancel: true,
          ...(status === 'failed' ? { error: 'Review system save error' } : {}) })),
      make('unknown-running', 'download', 'running', { size: 0, transferred: 0 })
    ];
    window.__taskSyncFixtures = [
      { id: 'sync-running', type: 'sync', status: 'running', connection_id: 7901, total: 10, completed: 3 },
      { id: 'scan-done', type: 'sync-scan', status: 'completed', connection_id: 7901, total: 10, completed: 10, updated_at: now },
      { id: 'sync-failed', type: 'sync', status: 'failed', connection_id: 7901, total: 10, completed: 6, updated_at: now, errors: [{ relative: 'review.txt', error: 'Review sync error' }] }
    ];
    const logs = Array.from({ length: 12 }, (_, index) => ({ at: now + index * 1000, text: 'Review log ' + index + ' <img src=x onerror=alert(1)>' }));
    window.__taskDesktopFixtures = [
      { id: 'install-running', status: 'running', connection_id: 7901, action: 'install', stage: 'packages', progress: 42, logs },
      { id: 'uninstall-done', status: 'done', connection_id: 7901, action: 'uninstall', stage: 'done', progress: 100, finished_at: now, logs }
    ];
    window.__taskComponentFixtures = [
      { id: 'component-running', status: 'running', connection_id: 7901, component_label: 'X11', progress: 55, stage: 'prepare', logs },
      { id: 'component-failed', status: 'failed', connection_id: 7901, component_label: 'X11', progress: 23, finished_at: now, error: 'Review install error', logs }
    ];
    connections = [{ id: 7901, name: 'Review host',group_name:'Review group',ssh_host:'review.invalid',ssh_port:22,ssh_user:'review' }];
    window.termaDesktop = {};
    window.termaRuntimeSettingsModel.snapshot = { ...window.termaRuntimeSettingsModel.snapshot, saved: { ...window.termaRuntimeSettingsModel.snapshot?.saved, sftp_floating_progress_enabled: true } };
    api = async (route, options = {}) => {
      const action=window.__taskActionReview;
      if(action&&route===`/api/sftp/sync/jobs/sync-failed${action.kind==='retry'?'/retry':''}`){
        action.requests.push({route,method:options.method||'GET'});
        return new Promise((resolve,reject)=>{action.pending={resolve,reject};});
      }
      if (options.method && options.method !== 'GET') {
        window.__taskReview.writes.push(route);
        throw Error('Task review blocked a mutation');
      }
      if (route === '/api/sftp/jobs') return window.__taskTransferFixtures;
      if (route === '/api/sftp/sync/jobs') return window.__taskSyncFixtures;
      if (route === '/api/linux-desktop/tasks') return window.__taskDesktopFixtures;
      if (route === '/api/remote-component/tasks') return window.__taskComponentFixtures;
      return window.__taskReview.api(route, options);
    };
    await window.termaSftpTaskWorkspace.runtime.refresh();
    window.termaSftpTransferLifecycle.polling.stop();
    window.__taskNormalizedFixtures = window.termaSftpTaskWorkspace.state.jobs.slice();
    const style = document.createElement('style'); style.id = 'task-review-hide-notices';
    style.textContent = '#toast,#notice{visibility:hidden!important}';
    document.head.append(style);
  });
  const check = async (name, selector, floating = false) => {
    if (selector === '#sftpTaskCenterDrawer') await call(sync => {
      document.getElementById('sftpTaskCenterList').scrollTop = 0;
      if(sync)document.querySelector('.sftp-job[data-task-id="sync:sync-failed"]')?.scrollIntoView({block:'center'});
    },name.includes('-sync-'));
    const result = await call((name, selector, floating, sync) => {
      const root = document.querySelector(selector);
      if (!root?.checkVisibility()) throw Error('Task view hidden: ' + name + ' (' + selector + ')');
      const text = root.textContent;
      const han = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (/[\u3400-\u9fff]/.test(walker.currentNode.textContent)) han.push(walker.currentNode.textContent);
      for (const element of [root, ...root.querySelectorAll('*')]) for (const attr of ['title', 'placeholder', 'aria-label'])
        if (/[\u3400-\u9fff]/.test(element.getAttribute(attr) || '')) han.push(element.getAttribute(attr));
      const cards = [...root.querySelectorAll('.sftp-job')];
      const times = cards.map(card => {
        const job = window.termaSftpTaskWorkspace.state.jobs.find(job => String(job.id) === card.dataset.taskId);
        const time = card.querySelector('time');
        return { id: card.dataset.taskId, expected: Boolean(job.finished_at),
          valid: !job.finished_at || (time?.dateTime === new Date(job.finished_at).toISOString() &&
            time.textContent === new Date(job.finished_at).toLocaleString(document.documentElement.lang)) };
      });
      const bounds = element => element.getBoundingClientRect();
      const inside = (child, parent) => { const a = bounds(child), b = bounds(parent); return a.left >= b.left - 1 && a.right <= b.right + 1; };
      const actionOverflow = cards.filter(card => [...card.querySelectorAll('.actions button')].some(button => !inside(button, card))).map(card => card.dataset.taskId);
      const stackedActions = cards.flatMap(card => [...card.querySelectorAll('.actions button')].filter(button => {
        const icon = button.querySelector('svg'), label = button.querySelector('span');
        if (!icon || !label) return false;
        const a = bounds(icon), b = bounds(label);
        return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) > 2;
      }).map(button => button.textContent));
      let geometry;
      if (floating) {
        const open = root.querySelector('.sftp-task-float-open'), icon = root.querySelector('.sftp-task-float-icon');
        const copy = root.querySelector('.sftp-task-float-copy'), title = copy.querySelector('strong'), detail = copy.querySelector('span');
        const a = bounds(open), b = bounds(icon), c = bounds(copy), d = bounds(title), e = bounds(detail), actions = bounds(root.querySelector('.sftp-task-float-actions'));
        geometry = { iconAtLeft: Math.abs(b.left - a.left) <= 1, copyAfterIcon: Math.abs(c.left - b.right - 8) <= 1,
          textAligned: Math.abs(d.left - e.left) <= 1 && getComputedStyle(open).textAlign === 'left',
          verticallyCentered: Math.abs(b.y + b.height / 2 - c.y - c.height / 2) <= 1,
          separateActions: c.right <= actions.left + 1, borderless: parseFloat(getComputedStyle(open).borderLeftWidth) === 0,
          contained: inside(open, root) && [...root.querySelectorAll('.icon-button')].filter(b => b.checkVisibility()).every(b => inside(b, root)) };
      }
      const target=sync?root.querySelector('.sftp-job[data-task-id="sync:sync-failed"]'):null,r=target?.getBoundingClientRect();
      const targetVisible=!sync||Boolean(target?.checkVisibility()&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&target.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)));
      return { language: document.documentElement.lang, han, objectText: text.includes('[object Object]'), times, actionOverflow, stackedActions,targetVisible,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1 ||
          bounds(root).left < -1 || bounds(root).right > innerWidth + 1,
        logInjection: root.querySelector('pre img') !== null, geometry, count: cards.length };
    }, name, selector, floating,name.includes('-sync-'));
    assert.equal(result.objectText, false, name + ' serializes no UI objects');
    assert.ok(result.times.every(time => time.valid), name + ' completion timestamps use time elements and current locale');
    if (result.language === 'en-US') assert.deepEqual(result.han, [], name + ' live translated task text and attributes');
    assert.deepEqual(result.actionOverflow, [], name + ' action buttons fit');
    assert.deepEqual(result.stackedActions, [], name + ' action icon and caption share a row');
    assert.equal(result.overflow, false, name + ' no horizontal overflow');
    assert.equal(result.logInjection, false, name + ' logs rendered as text');
    assert.equal(result.targetVisible,true,name+' target task is visible and unobstructed');
    if (floating) for (const [key, valid] of Object.entries(result.geometry)) assert.equal(valid, true, name + ' ' + key);
    reports.push({ name, ...result });
    await capture(name);
    if (selector === '#sftpTaskCenterDrawer') {
      const positions = await call(() => {
        const list = document.getElementById('sftpTaskCenterList'), max = list.scrollHeight - list.clientHeight;
        const positions = []; for (let top = Math.floor(list.clientHeight * .8); top < max; top += Math.floor(list.clientHeight * .8)) positions.push(top);
        if (max > 0) positions.push(max); return positions;
      });
      for (let i = 0; i < positions.length; i++) {
        await call(top => { document.getElementById('sftpTaskCenterList').scrollTop = top; }, positions[i]);
        await capture(name + '-scroll-' + i);
      }
    }
  };
  try {
    for (const width of [1200, 390]) for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
      browser.setContentSize(width, 844);
      await delay(120);
      await call(async (language, theme) => {
        window.termaSftpTaskWorkspace.runtime.close(); closeModal();
        await setTermaLanguage(language); await window.termaQuickLocalizationReady; applyTheme(theme);
        window.termaBatch.open();
        if (isMobileLayout()) window.termaWorkspaceShell.showMobileWorkspace();
        window.termaSftpTaskWorkspace.state.jobs = window.__taskNormalizedFixtures;
        window.termaSftpTaskWorkspace.state.view = 'current'; window.termaSftpTaskWorkspace.state.paint(); await window.termaSftpTaskWorkspace.runtime.open();
        window.termaSftpTransferLifecycle.polling.stop();
      }, language, theme);
      const prefix = language + '-' + theme + '-' + width;
      console.log('[task-ui] ' + prefix);
      await call(() => window.termaSftpTaskWorkspace.runtime.close());
      await click('#sftpTaskCenterButton');
      await call(async () => { await window.termaSftpTaskWorkspace.runtime.stale(Number.MAX_SAFE_INTEGER); window.termaSftpTransferLifecycle.polling.stop(); });
      await capture(prefix + '-joined-trigger');
      const joined = await call(() => {
        const button = document.getElementById('sftpTaskCenterButton');
        const drawer = document.getElementById('sftpTaskCenterDrawer');
        const connector = getComputedStyle(button.parentElement, '::after');
        const host = button.parentElement.getBoundingClientRect();
        const topEdge = drawer.getBoundingClientRect().top;
        return {
          open: button.getAttribute('aria-expanded') === 'true' && drawer.checkVisibility(),
          flush: Math.abs(host.bottom - topEdge) <= 1 && connector.content !== 'none',
          surfaces: [getComputedStyle(button).backgroundColor, connector.backgroundColor, getComputedStyle(drawer, '::after').backgroundColor]
        };
      });
      assert.ok(joined.open && joined.flush && new Set(joined.surfaces).size === 1, prefix + ' task button joins the drawer ' + JSON.stringify(joined));
      for (const view of ['Current', 'Failed', 'History']) {
        await click('#sftpTaskCenter' + view + 'Tab');
        await check(prefix + '-' + view, '#sftpTaskCenterDrawer');
      }
      await click('#sftpTaskCenterCurrentTab');
      await call(() => {
        const card = document.querySelector('.sftp-job[data-task-id="desktop:install-running"]');
        const button = [...card.querySelectorAll('button')].find(node=>node.textContent.trim()===tr('tasks:actions.view'));
        button.dataset.reviewDesktopTask = 'true';
        const desktop = window.termaRemoteManagement.desktop;
        window.__taskReview.openDesktopTask = desktop.openTask;
        desktop.openTask = (...args) => { window.__taskReview.desktopTaskArgs = args; };
      });
      try {
        await click('[data-review-desktop-task]');
        assert.deepEqual(await call(() => window.__taskReview.desktopTaskArgs), [7901, 'install-running'], prefix + ' opens the correct desktop task');
        await capture(prefix + '-open-linux-desktop-task');
      } finally {
        await call(() => {
          window.termaRemoteManagement.desktop.openTask = window.__taskReview.openDesktopTask;
          delete window.__taskReview.desktopTaskArgs;
        });
      }
      // Use actual task-card clicks, delayed responses and the real busy-button
      // adapter; late refreshes and language changes must retain the open view.
      for(const kind of ['retry','export']){
        await call(kind=>{
          window.termaSftpTransferLifecycle.polling.stop();
          window.termaSftpTaskWorkspace.state.jobs=window.__taskNormalizedFixtures.filter(job=>job.id==='sync:sync-failed');
          window.termaSftpTaskWorkspace.state.view='failed';window.termaSftpTaskWorkspace.state.paint();
          window.__taskActionReview={kind,requests:[],saved:[],blobs:[],revoked:[]};
          const card=document.querySelector('.sftp-job[data-task-id="sync:sync-failed"]');
          const caption=tr(kind==='retry'?'tasks:actions.retry_failed':'tasks:actions.export_result');
          const button=[...card.querySelectorAll('button')].find(button=>button.textContent.trim()===caption);
          if(!button)throw Error('Missing sync '+kind+' action');button.dataset.taskReviewAction=kind;
          const state=window.__taskActionReview;
          state.pointer=[];
          state.listeners=new AbortController();
          for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{
            const target=event.target instanceof Element?event.target.closest('button'):null;
            state.pointer.push({type,x:event.clientX,y:event.clientY,target:target?.dataset.taskReviewAction||target?.id||'' ,
              hit:event.target instanceof Element?`${event.target.tagName}#${event.target.id}.${event.target.className}`:null});
          },{capture:true,signal:state.listeners.signal});
          window.addEventListener('error',event=>{state.eventError=event.message;},{once:true,signal:state.listeners.signal});
        },kind);
        const selector=`[data-task-review-action="${kind}"]`;
        await click(selector);
        assert.deepEqual(await call(async(kind,selector)=>{
          const state=window.__taskActionReview,button=document.querySelector(selector);
          state.listeners.abort();
          if(state.requests.length!==1||!button?.disabled||!window.termaTaskActions.current.isPending('sftp-task:sync-'+kind+':sync-failed'))
            throw Error('Task action did not become busy after the real click '+JSON.stringify({kind,events:state.pointer,error:state.eventError,requests:state.requests,lastClick:window.__taskReview.lastClick,button:button?.outerHTML}));
          const duplicate=await window.termaTaskActions.current.sync('sync-failed',kind);
          return {requests:state.requests.length,disabled:button.disabled,duplicate:duplicate===null};
        },kind,selector),{requests:1,disabled:true,duplicate:true},prefix+' sync '+kind+' deduplicates');
        await check(prefix+'-sync-'+kind+'-busy','#sftpTaskCenterDrawer');
        const alternate=language==='zh-CN'?'en-US':'zh-CN';
        await call(async language=>{await setTermaLanguage(language);await window.termaQuickLocalizationReady;},alternate);
        await check(prefix+'-sync-'+kind+'-live-language','#sftpTaskCenterDrawer');
        await call(()=>window.__taskActionReview.pending.reject(new Error('Review temporary sync error')));
        await delay(120);
        assert.equal(await call(kind=>window.termaTaskActions.current.isPending('sftp-task:sync-'+kind+':sync-failed'),kind),false);
        await check(prefix+'-sync-'+kind+'-failed','#sftpTaskCenterDrawer');
        await call(async(kind,language)=>{
          await setTermaLanguage(language);await window.termaQuickLocalizationReady;
          const card=document.querySelector('.sftp-job[data-task-id="sync:sync-failed"]');
          const caption=tr(kind==='retry'?'tasks:actions.retry_failed':'tasks:actions.export_result');
          [...card.querySelectorAll('button')].find(button=>button.textContent.trim()===caption).dataset.taskReviewAction=kind;
        },kind,language);
        await click(selector);
        await call(()=>window.__taskActionReview.pending.resolve({id:'sync-failed',total:4,status:'failed',errors:[{relative:'review.txt',error:'Review sync error'}]}));
        await delay(kind==='export'?1150:120);
        const result=await call(async kind=>{
          const state=window.__taskActionReview;
          return {requests:state.requests.length,methods:state.requests.map(request=>request.method),pending:window.termaTaskActions.current.isPending('sftp-task:sync-'+kind+':sync-failed'),
            open:!document.getElementById('sftpTaskCenterDrawer').hidden,
            exports:state.saved.length,attached:state.saved.every(item=>item.attached),
            report:kind==='export'?JSON.parse(await state.blobs[0].blob.text()).id:null,
            clean:state.saved.every(item=>state.revoked.includes(item.url)&&![...document.querySelectorAll('a')].some(link=>link.href===item.url))};
        },kind);
        assert.equal(result.requests,2);assert.deepEqual(result.methods,kind==='retry'?['POST','POST']:['GET','GET']);
        assert.equal(result.pending,false);assert.equal(result.open,true);assert.equal(result.exports,kind==='export'?1:0);
        if(kind==='export'){assert.equal(result.report,'sync-failed');assert.equal(result.attached,true);assert.equal(result.clean,true);}
        reports.push({name:prefix+'-sync-'+kind+'-outcome',...result});
        await check(prefix+'-sync-'+kind+'-success','#sftpTaskCenterDrawer');
        await call(()=>{delete window.__taskActionReview;window.termaSftpTransferLifecycle.polling.stop();window.termaSftpTaskWorkspace.state.jobs=window.__taskNormalizedFixtures;window.termaSftpTaskWorkspace.state.paint();});
      }
      // Older native records kept a saving message after completion. Show every
      // outcome on its own so a screenshot cannot pass with the card offscreen.
      for (const status of ['running', 'done', 'failed', 'cancelled']) {
        const result = await call(status => {
          const job = window.__taskNormalizedFixtures.find(job => job.id === 'native-' + status);
          window.termaSftpTaskWorkspace.state.jobs = [job];
          window.termaSftpTaskWorkspace.state.view = status === 'running' ? 'current' : status === 'failed' ? 'failed' : 'history';
          window.termaSftpTaskWorkspace.state.paint();
          const card = document.querySelector('.sftp-job[data-task-id="native-' + status + '"]');
          card?.scrollIntoView({ block: 'nearest' });
          const rect = card?.getBoundingClientRect();
          const x = rect ? rect.left + rect.width / 2 : -1, y = rect ? rect.top + rect.height / 2 : -1;
          return { visible: Boolean(card?.checkVisibility() && rect.top >= 0 && rect.bottom <= innerHeight &&
              rect.left >= 0 && rect.right <= innerWidth && card.contains(document.elementFromPoint(x, y))),
            saving: card?.textContent.includes(tr('tasks:phase.system_saving')),
            actions: [...(card?.querySelectorAll('button') || [])].filter(button => button.checkVisibility()).length,
            progress: card?.querySelector('.progress')?.getAttribute('aria-label'), error: job.error };
        }, status);
        assert.equal(result.visible, true, prefix + ' native ' + status + ' card visible and unobstructed');
        assert.equal(result.saving, status === 'running', prefix + ' saving message only on the active task');
        if (status === 'done') assert.equal(result.progress, '100%');
        if (status === 'failed') assert.equal(result.error, 'Review system save error');
        reports.push({ name: prefix + '-native-' + status + '-visibility', ...result });
        await check(prefix + '-native-' + status, '#sftpTaskCenterDrawer');
      }
      await call(() => { window.termaSftpTaskWorkspace.state.jobs = window.__taskNormalizedFixtures; window.termaSftpTaskWorkspace.state.paint(); });
      for (const [view, button, name] of [
        ['Current', '#sftpTaskCenterClearQueueButton', 'clear-queue'],
        ['Failed', '#sftpTaskCenterClearButton', 'clear-failed'],
        ['History', '#sftpTaskCenterClearButton', 'clear-history'],
        ['History', '.sftp-job[data-task-id="download-saved"] button.danger', 'delete-record']
      ]) {
        if (await call(() => document.getElementById('sftpTaskCenterDrawer').hidden)) await click('#sftpTaskCenterButton');
        await click('#sftpTaskCenter' + view + 'Tab'); await click(button);
        await check(prefix + '-confirm-' + name, '#modal');
        await click('#modal [data-choice="1"]');
      }
      if (await call(() => document.getElementById('sftpTaskCenterDrawer').hidden)) await click('#sftpTaskCenterButton');
      await call(() => { window.termaSftpTaskWorkspace.state.jobs = []; window.termaSftpTaskWorkspace.state.paint(); });
      for (const view of ['Current', 'Failed', 'History']) {
        await click('#sftpTaskCenter' + view + 'Tab');
        await check(prefix + '-empty-' + view, '#sftpTaskCenterDrawer');
      }
      await call(() => { window.termaSftpTaskWorkspace.runtime.close(); });
      for (const id of ['download-running', 'upload-paused', 'upload-committing', 'unknown-running', 'desktop:install-running', 'component:component-running', 'multiple']) {
        await call(id => {
          window.termaSftpTaskWorkspace.state.jobs = id === 'multiple' ? window.__taskNormalizedFixtures : window.__taskNormalizedFixtures.filter(job => job.id === id);
          window.termaSftpTaskWorkspace.state.dismissed.clear(); window.termaSftpTaskWorkspace.state.paint();
        }, id);
        await check(prefix + '-float-' + id, '#sftpTaskFloat', true);
      }
      await click('.sftp-task-float-mute');
      await call(async()=>{for(let attempt=0;attempt<100;attempt++){if(document.getElementById('modal')?.checkVisibility())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Mute confirmation did not open '+JSON.stringify({lastClick:window.__taskReview.lastClick,writes:window.__taskReview.writes,modalHidden:document.getElementById('modal')?.hidden}));});
      await check(prefix + '-confirm-mute', '#modal');
      await click('#modal [data-choice="1"]');
    }
    // Preserve expanded logs and scroll while translating an already-open drawer, without polling.
    await call(async () => {
      await setTermaLanguage('zh-CN'); await window.termaQuickLocalizationReady;
      window.termaSftpTaskWorkspace.state.jobs = window.__taskNormalizedFixtures; window.termaSftpTaskWorkspace.state.view = 'current'; window.termaSftpTaskWorkspace.state.paint();
      await window.termaSftpTaskWorkspace.runtime.open(); window.termaSftpTransferLifecycle.polling.stop();
      const log = document.querySelector('.global-task-log'); log.open = true;
      log.querySelector('pre').scrollTop = 30;
      document.getElementById('sftpTaskCenterList').scrollTop = 80;
    });
    // Keep the drawer open across desktop/mobile transitions, including persisted desktop constraints.
    for (const width of [1200, 390, 1200, 390]) {
      browser.setContentSize(width, 844);
      await delay(150);
      await call(() => { if (isMobileLayout()) window.termaWorkspaceShell.showMobileWorkspace(); });
      await delay(100);
      await check('open-resize-' + width + '-' + reports.length, '#sftpTaskCenterDrawer');
    }
    for (const language of ['en-US', 'zh-CN']) {
      const scroll = await call(() => {
        const list = document.getElementById('sftpTaskCenterList');
        list.scrollTop = 80;
        return list.scrollTop;
      });
      await call(async language => { await setTermaLanguage(language); await window.termaQuickLocalizationReady; }, language);
      assert.equal(await call(() => document.querySelector('.global-task-log').open), true, 'live language retains expanded task logs');
      assert.equal(await call(() => document.getElementById('sftpTaskCenterList').scrollTop), scroll, 'live language retains task list scroll');
      await check('live-' + language + '-logs', '#sftpTaskCenterDrawer');
    }
    // The last screenshot leaves the list at its bottom. Translation may make
    // the content shorter, so an old offset beyond the new maximum must clamp.
    for (const language of ['en-US', 'zh-CN']) {
      const bottom = await call(() => document.getElementById('sftpTaskCenterList').scrollTop);
      await call(async language => { await setTermaLanguage(language); await window.termaQuickLocalizationReady; }, language);
      const scroll = await call(() => {
        const list = document.getElementById('sftpTaskCenterList');
        return { top: list.scrollTop, max: Math.max(0, list.scrollHeight - list.clientHeight) };
      });
      assert.equal(scroll.top, Math.min(bottom, scroll.max), 'live language clamps task scroll only at the list boundary');
    }
    assert.deepEqual(await call(() => window.__taskReview.writes), [], 'task audit never writes to host or remote');
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ views: reports.length, screenshots, reports }, null, 2));
    return { views: reports.length, screenshots, directory };
  } catch (error) {
    await capture('failure');
    throw error;
  } finally {
    await call(() => {
      closeModal(); window.termaSftpTaskWorkspace.runtime.close(); window.termaSftpTransferLifecycle.polling.stop();
      const original = window.__taskReview;
      api = original.api; connections = original.connections; window.termaRuntimeSettingsModel.snapshot = original.runtimeSettings;
      HTMLAnchorElement.prototype.click=original.anchorClick;URL.createObjectURL=original.createObjectURL;URL.revokeObjectURL=original.revokeObjectURL;
      delete window.__taskActionReview;
      window.termaDesktop = original.desktop; window.termaSftpTaskWorkspace.state.jobs = original.jobs; window.termaSftpTaskWorkspace.state.paint();
      document.getElementById('task-review-hide-notices')?.remove();
    });
  }
}
module.exports = { runTaskUiScenario };
