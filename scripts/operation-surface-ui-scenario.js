const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runOperationSurfaceUiScenario(browser) {
  const directory = path.resolve(process.env.TERMA_OPERATION_SURFACE_VISUAL_DIR || 'data/operation-surface-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = [];
  const capture=async name=>{
    await execute('await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));');
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory,`${name}.png`),(await browser.webContents.capturePage()).toPNG());
  };
  await execute(`
    closeModal();window.termaEfficiency.palette.close();window.termaWorkspaceRefresh.stop();window.termaWorkspaceShell.setCollapsed(false);
    window.__welcomeOriginalApi=api;
    api=(url,options)=>url==='/api/startup-status'
      ? Promise.resolve({state:'ready',local_url:'http://127.0.0.1:8099',lan_urls:['http://192.0.2.22:8099','http://192.0.2.23:8099']})
      : window.__welcomeOriginalApi(url,options);
  `);
  const startupPolling = await execute(`
    const fixtureApi=api;
    let statusRequests=0;
    api=(url,options)=>url === '/api/startup-status'
      ? Promise.resolve({state:++statusRequests===1?'starting':'ready',local_url:'http://127.0.0.1:'+ (8200+statusRequests)})
      : fixtureApi(url,options);
    try {
      window.termaConnectionViews.renderWelcome();
      window.termaConnectionViews.renderWelcome();
      window.termaConnectionViews.renderWelcome();
      for(let attempt=0;attempt<100&&!$('startupSummary').textContent.includes('8202');attempt++) {
        await new Promise(done=>setTimeout(done,25));
      }
      return {statusRequests,address:$('startupSummary').querySelector('code')?.textContent};
    } finally {api=fixtureApi;}
  `);
  assert.deepEqual(startupPolling,{statusRequests:2,address:'http://127.0.0.1:8202'},'welcome deduplicates startup status and follows a starting response to ready');
  for (const width of [1200, 390]) for (const language of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
    browser.setContentSize(width, 844);
    await execute(`await setTermaLanguage('${language}');applyTheme('${theme}');syncResponsivePane();`);
    const welcome=await execute(`
      window.termaWorkspaceShell.showPrimary('connections');
      window.termaWorkspaceShell.setCollapsed(true);
      window.termaConnectionViews.renderWelcome();
      if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();
      for (let attempt=0; attempt<100 && !document.querySelector(".startup-addresses code"); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      dismissToast();
      const root=document.querySelector('.workspace-welcome');
      const button=root.querySelector('[data-action="workspace-show-connections"]');
      button.scrollIntoView({block:'nearest'});
      const {left,top,width,height}=button.getBoundingClientRect();
      const x=Math.round(left+width/2),y=Math.round(top+height/2);
      return {x,y,hit:button.contains(document.elementFromPoint(x,y)),
        fits:root.scrollWidth<=root.clientWidth+1,
        hasStatus:root.querySelectorAll('.startup-addresses code').length===3,
        untranslated:document.documentElement.lang==='en-US'&&/[\\u3400-\\u9fff]/.test(root.textContent)};
    `);
    assert.ok(welcome.hit&&welcome.fits&&welcome.hasStatus&&!welcome.untranslated, 'welcome controls and startup addresses are visible, translated and fit');
    const welcomeName=`${language}-${theme}-${width}-welcome`;
    await capture(welcomeName);
    const {x,y}=welcome;
    browser.webContents.sendInputEvent({type:'mouseMove',x,y});
    browser.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
    browser.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
    await delay(100);
    assert.ok(await execute(`return primaryView==='connections'&&(isMobileLayout()?!document.querySelector('.left-pane').classList.contains('mobile-hide'):!window.termaWorkspaceShell.isCollapsed())&&document.querySelector('.sidebar').checkVisibility();`),'View connections reveals the operation pane');
    await capture(`${welcomeName}-connections`);
  }
  await execute('api=window.__welcomeOriginalApi;delete window.__welcomeOriginalApi;');
  for (const width of [1200, 390]) for (const language of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
    browser.setContentSize(width, 844);
    await execute(`await setTermaLanguage('${language}');applyTheme('${theme}');syncResponsivePane();`);
    for (const primary of ['connections', 'remote', 'running', 'command', 'import', 'logs', 'settings']) {
      await execute(`window.termaWorkspaceShell.showPrimary('${primary}');window.termaWorkspaceShell.setCollapsed(false);if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();`);
      await delay(150);
      const colors = await execute(`
        const color = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
        const activity=color('.activity');
        return {activity, areas:['.left-pane','.brand','.sidebar','.explorer-tools',...(innerWidth<768?['.mobile-tabs']:[])].map(selector=>({selector,color:color(selector)})),
          scoped:[...document.querySelectorAll('.left-pane [data-theme]')].map(node=>getComputedStyle(node).getPropertyValue('--sidebar').trim()),
          activityToken:getComputedStyle(document.documentElement).getPropertyValue('--activity').trim(),
          overflow:document.documentElement.scrollWidth>innerWidth+1,
          tools:[...document.querySelectorAll('#explorerTools :is(.running-tools,.log-list-tools,.batch-tools) button')].map(button=>{
            const {top,bottom,left,right}=button.getBoundingClientRect();
            const caption=button.querySelector('span');
            const textFits=!caption||caption.scrollWidth<=caption.clientWidth+1;
            return {label:button.getAttribute('aria-label'),text:button.textContent.trim(),icon:!!button.querySelector('svg'),top,bottom,left,right,textFits};
          }),
          hasGlobalRefresh:[...document.querySelectorAll('[data-action="static-refresh"]')].some(b=>b.checkVisibility())};
      `);
      for (const area of colors.areas) assert.equal(area.color, colors.activity, `${primary}/${language}/${theme}/${width} ${area.selector}`);
      for (const color of colors.scoped) assert.equal(color, colors.activityToken, 'scoped Vue root uses activity surface');
      assert.equal(colors.overflow, false, 'no horizontal overflow');
      assert.equal(colors.hasGlobalRefresh, true, 'global refresh stays visible');
      if(['running','logs','command'].includes(primary)){
        const [main,...auxiliary]=colors.tools;
        assert.equal(auxiliary.length,primary==='command'?1:2,'operation toolbar excludes redundant refresh');
        assert.ok(main.text&&main.textFits&&main.icon,'primary caption is fully visible');
        assert.ok(auxiliary.every(b=>b.label&&b.icon&&!b.text),'auxiliary actions are labelled icons');
        assert.ok(auxiliary.every(b=>b.top===auxiliary[0].top),'auxiliary actions stay together');
        if(primary==='running'){
          assert.equal(auxiliary[0].top,main.top,'forward actions fit on the same row');
          assert.ok(auxiliary[0].left>=main.right,'auxiliary icons follow the primary action');
        }
      }
      browser.webContents.invalidate();
      const name = `${language}-${theme}-${width}-${primary}`;
      fs.writeFileSync(path.join(directory, name+'.png'), (await browser.webContents.capturePage()).toPNG());
      report.push({name, colors});
      if(primary==='running'&&width===1200){
        await execute(`document.querySelector('.running-tools').style.width='150px';`);
        try{
          const narrow=await execute(`
            const root=document.querySelector('.running-tools');
            const main=root.querySelector('.primary').getBoundingClientRect();
            const group=root.querySelector('.explorer-aux-actions').getBoundingClientRect();
            return {wraps:group.top>=main.bottom,fits:group.width<=root.clientWidth};
          `);
          assert.ok(narrow.wraps&&narrow.fits,'narrow forward toolbar wraps its icon group below the primary action');
          browser.webContents.invalidate();
          fs.writeFileSync(path.join(directory,name+'-narrow.png'),(await browser.webContents.capturePage()).toPNG());
        }finally{
          await execute(`document.querySelector('.running-tools').style.removeProperty('width');`);
        }
      }
    }
  }
  const refreshButton = await execute(`
    const originalApi=api;
    const f=window.__operationRefresh={originalApi,requests:[],suffix:'initial'};
    api=async (url,options)=>{
      f.requests.push(url);
      if(url==='/api/logs')return {system:[{path:'system/'+f.suffix+'.log',label:f.suffix}],batch:[],connections:[]};
      if(url==='/api/command-templates')return [{id:f.suffix,name:f.suffix,command:'whoami'}];
      return originalApi(url,options);
    };
    f.wait=async condition=>{
      for(let i=0;i<160;i++){
        if(condition())return;
        await new Promise(done=>setTimeout(done,50));
      }
      throw Error('Timed out waiting for refreshed operation data');
    };
    window.termaWorkspaceShell.showPrimary('logs');
    if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();
    await f.wait(()=>window.termaLogList.service().model.data.system[0]?.label==='initial');
    f.suffix='manual';
    f.requests.length=0;
    const button=[...document.querySelectorAll('[data-action="static-refresh"]')].find(node=>node.checkVisibility());
    const r=button.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
    if(!button.contains(document.elementFromPoint(x,y)))throw Error('Global refresh button cannot be clicked');
    return {x,y};
  `);
  try {
    for (const type of ['mouseMove','mouseDown','mouseUp']) {
      browser.webContents.sendInputEvent({type,...refreshButton,button:'left',clickCount:1});
    }
    await execute(`const f=window.__operationRefresh;
      await f.wait(()=>window.termaLogList.service().model.data.system[0]?.label==='manual'&&window.termaBatch.templates().model.items[0]?.name==='manual');
      if(!f.requests.includes('/api/connections'))throw Error('Global refresh did not reload connection and forwarding state');`);
    await capture('global-refresh-logs');
    await execute(`const f=window.__operationRefresh;
      f.suffix='scheduled-log';window.termaWorkspaceRefresh.start();
      await f.wait(()=>window.termaLogList.service().model.data.system[0]?.label===f.suffix);`);
    await capture('scheduled-refresh-logs');
    await execute(`const f=window.__operationRefresh;
      window.termaWorkspaceShell.showPrimary('command');await window.termaBatch.templates().load();f.suffix='scheduled-template';
      await f.wait(()=>window.termaBatch.templates().model.items[0]?.name===f.suffix);`);
    await capture('scheduled-refresh-templates');
  } finally {
    await execute('window.termaWorkspaceRefresh.stop();api=window.__operationRefresh.originalApi;delete window.__operationRefresh;');
  }
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(`Operation surfaces passed: ${report.length} page/theme/language/viewport combinations.`);
}
module.exports = { runOperationSurfaceUiScenario };
